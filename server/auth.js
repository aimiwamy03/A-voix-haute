import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

export const COOKIE = 'oral_session';
const MAX_AGE_S = 60 * 60 * 24 * 30;
const USER_ID = /^[a-f0-9]{32}$/;

export function loadAuthSecret(file) {
  if (existsSync(file)) {
    const value = readFileSync(file, 'utf8').trim();
    if (value) return value;
  }
  const value = randomBytes(32).toString('base64url');
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `${value}\n`, { mode: 0o600 });
  return value;
}

export function signSession(userId, secret, now = Date.now()) {
  const body = Buffer.from(JSON.stringify({ sub: userId, exp: now + MAX_AGE_S * 1000 })).toString('base64url');
  const sig = createHmac('sha256', secret).update(body).digest('base64url');
  return `${body}.${sig}`;
}

export function readSession(token, secret, now = Date.now()) {
  const parts = String(token ?? '').split('.');
  if (parts.length !== 2) return null;
  const [body, sig] = parts;
  const expected = createHmac('sha256', secret).update(body).digest('base64url');
  const actual = Buffer.from(sig);
  const wanted = Buffer.from(expected);
  if (actual.length !== wanted.length || !timingSafeEqual(actual, wanted)) return null;
  let payload;
  try {
    payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  if (!payload || typeof payload.sub !== 'string' || typeof payload.exp !== 'number') return null;
  if (!USER_ID.test(payload.sub) || payload.exp < now) return null;
  return payload.sub;
}

export function cookieHeader(token, options = {}) {
  const value = token ? encodeURIComponent(token) : '';
  const maxAge = token ? MAX_AGE_S : 0;
  const secure = options.secure ? '; Secure' : '';
  return `${COOKIE}=${value}; HttpOnly; SameSite=Lax; Path=/${secure}; Max-Age=${maxAge}`;
}

export function cookieValue(header) {
  for (const part of String(header ?? '').split(';')) {
    const eq = part.indexOf('=');
    if (eq < 1) continue;
    if (part.slice(0, eq).trim() !== COOKIE) continue;
    try {
      return decodeURIComponent(part.slice(eq + 1).trim());
    } catch {
      return '';
    }
  }
  return '';
}

export function resolveAuthSecret(options, root) {
  if (options.authSecret) return options.authSecret;
  if (process.env.AUTH_SECRET) return process.env.AUTH_SECRET;
  const file = options.authSecretFile ?? process.env.AUTH_SECRET_FILE;
  if (options.requireAuth === false && !file) return 'ephemeral';
  return loadAuthSecret(file ?? path.join(root, 'data', 'auth-secret'));
}
