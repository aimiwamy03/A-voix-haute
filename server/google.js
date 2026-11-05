import { createHash, createPublicKey, randomBytes, verify } from 'node:crypto';
import { validEmail, validName } from './users.js';

const CLIENT_ID = /^[0-9]{6,}-[A-Za-z0-9_-]+\.apps\.googleusercontent\.com$/;
const CERTS = 'https://www.googleapis.com/oauth2/v3/certs';
const ISSUERS = new Set(['https://accounts.google.com', 'accounts.google.com']);

let certCache = { keys: null, exp: 0 };

export class GoogleAuthError extends Error {
  constructor() {
    super('La connexion Google a échoué.');
    this.status = 401;
  }
}

export function googleClientId(value) {
  const id = String(value ?? '').trim();
  return CLIENT_ID.test(id) ? id : '';
}

function decodeJson(part) {
  try {
    return JSON.parse(Buffer.from(part, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
}

async function googleCerts(fetchImpl, now) {
  if (certCache.keys && certCache.exp > now) return certCache.keys;
  const response = await fetchImpl(CERTS, { signal: AbortSignal.timeout(10_000) });
  if (!response.ok) throw new GoogleAuthError();
  const body = await response.json();
  if (!Array.isArray(body.keys)) throw new GoogleAuthError();
  certCache = { keys: body.keys, exp: now + 60 * 60 * 1000 };
  return body.keys;
}

// Checks the signed ID token from Google's sign-in button. The page never trusts the profile itself.
export async function verifyGoogleIdToken(credential, clientId, options = {}) {
  const now = options.now ?? Date.now();
  const token = String(credential ?? '');
  const parts = token.split('.');
  if (token.length < 20 || token.length > 20_000 || parts.length !== 3 || parts.some((part) => !part)) {
    throw new GoogleAuthError();
  }
  const header = decodeJson(parts[0]);
  if (!header || header.alg !== 'RS256' || typeof header.kid !== 'string') throw new GoogleAuthError();

  const fetchImpl = options.fetchImpl ?? fetch;
  let keys = options.keys;
  if (!keys) keys = await googleCerts(fetchImpl, now);
  let jwk = keys.find((key) => key.kid === header.kid && key.kty === 'RSA');
  if (!jwk && !options.keys) {
    certCache.exp = 0;
    keys = await googleCerts(fetchImpl, now);
    jwk = keys.find((key) => key.kid === header.kid && key.kty === 'RSA');
  }
  if (!jwk) throw new GoogleAuthError();

  let key;
  try {
    key = createPublicKey({ key: jwk, format: 'jwk' });
  } catch {
    throw new GoogleAuthError();
  }
  const signed = Buffer.from(`${parts[0]}.${parts[1]}`);
  let signature;
  try {
    signature = Buffer.from(parts[2], 'base64url');
  } catch {
    throw new GoogleAuthError();
  }
  if (!verify('RSA-SHA256', signed, key, signature)) throw new GoogleAuthError();

  const payload = decodeJson(parts[1]);
  if (!payload || !ISSUERS.has(payload.iss)) throw new GoogleAuthError();
  const audiences = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (!audiences.includes(clientId)) throw new GoogleAuthError();
  if (payload.azp && payload.azp !== clientId) throw new GoogleAuthError();
  if (typeof payload.exp !== 'number' || payload.exp * 1000 + 60_000 <= now) throw new GoogleAuthError();
  if (typeof payload.nbf === 'number' && payload.nbf * 1000 > now + 60_000) throw new GoogleAuthError();
  if (payload.email_verified !== true) throw new GoogleAuthError();

  const email = validEmail(payload.email);
  const sub = typeof payload.sub === 'string' && /^[A-Za-z0-9_-]{1,255}$/.test(payload.sub) ? payload.sub : '';
  const name = validName(payload.name) || validName(String(payload.email ?? '').split('@')[0]);
  if (!email || !sub || !name) throw new GoogleAuthError();
  return { sub, email, name };
}

export function googleAuthRequest({ clientId, redirectUri, state, challenge }) {
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'openid email profile',
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    prompt: 'select_account',
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
}

export function createGooglePkce() {
  const verifier = randomBytes(32).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  const state = randomBytes(24).toString('base64url');
  return { verifier, challenge, state };
}

export async function exchangeGoogleCode({ code, clientId, clientSecret, redirectUri, verifier, fetchImpl = fetch }) {
  const body = new URLSearchParams({
    code,
    client_id: clientId,
    redirect_uri: redirectUri,
    grant_type: 'authorization_code',
    code_verifier: verifier,
  });
  if (clientSecret) body.set('client_secret', clientSecret);
  const response = await fetchImpl('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
    signal: AbortSignal.timeout(10_000),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || typeof payload.id_token !== 'string') {
    if (payload.error) console.error(`google token: ${payload.error}`);
    throw new GoogleAuthError();
  }
  return payload.id_token;
}

export function googleDonePage(message, ok = false) {
  const safe = String(message).replace(/[&<>]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[char]));
  const color = ok ? '#4CD97B' : '#FF6961';
  return `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>À voix haute</title>
</head>
<body style="margin:0;min-height:100vh;display:grid;place-items:center;background:#0E0E10;color:#F5F5F7;font:17px -apple-system,BlinkMacSystemFont,sans-serif">
  <p style="max-width:28rem;padding:32px;text-align:center;color:${color}">${safe}</p>
</body>
</html>`;
}
