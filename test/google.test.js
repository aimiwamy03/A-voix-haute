import assert from 'node:assert/strict';
import { generateKeyPairSync, createSign } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createApp } from '../server/app.js';
import { GoogleAuthError, googleClientId, verifyGoogleIdToken } from '../server/google.js';

const CLIENT = '123456789012-abc.apps.googleusercontent.com';
const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'test-key' };

function sign(payload, { kid = 'test-key', alg = 'RS256' } = {}) {
  const header = Buffer.from(JSON.stringify({ alg, kid, typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const data = `${header}.${body}`;
  const signature = createSign('RSA-SHA256').update(data).sign(privateKey).toString('base64url');
  return `${data}.${signature}`;
}

function profile(extra = {}) {
  return {
    iss: 'https://accounts.google.com',
    aud: CLIENT,
    azp: CLIENT,
    sub: 'google-sub-1',
    email: 'Camille@Example.com',
    email_verified: true,
    name: 'Camille Martin',
    exp: Math.floor(Date.now() / 1000) + 3600,
    ...extra,
  };
}

test('google client ids must be web client ids', () => {
  assert.equal(googleClientId(`  ${CLIENT}  `), CLIENT);
  assert.equal(googleClientId('not-a-client'), '');
  assert.equal(googleClientId(''), '');
});

test('a signed Google id token is accepted once', async () => {
  const claims = await verifyGoogleIdToken(sign(profile()), CLIENT, { keys: [jwk] });
  assert.deepEqual(claims, { sub: 'google-sub-1', email: 'camille@example.com', name: 'Camille Martin' });

  const expired = sign(profile({ exp: Math.floor(Date.now() / 1000) - 120 }));
  await assert.rejects(() => verifyGoogleIdToken(expired, CLIENT, { keys: [jwk] }), GoogleAuthError);
  await assert.rejects(() => verifyGoogleIdToken(sign(profile({ aud: 'other.apps.googleusercontent.com' })), CLIENT, { keys: [jwk] }), GoogleAuthError);
  await assert.rejects(() => verifyGoogleIdToken(sign(profile({ email_verified: false })), CLIENT, { keys: [jwk] }), GoogleAuthError);
  await assert.rejects(() => verifyGoogleIdToken(sign(profile(), { alg: 'none' }), CLIENT, { keys: [jwk] }), GoogleAuthError);

  const token = sign(profile());
  const [header, body, signature] = token.split('.');
  const flipped = `${header}.${body}.${signature[0] === 'a' ? 'b' : 'a'}${signature.slice(1)}`;
  await assert.rejects(() => verifyGoogleIdToken(flipped, CLIENT, { keys: [jwk] }), GoogleAuthError);
});

async function withServer(fn, options = {}) {
  const dir = await mkdtemp(path.join(tmpdir(), 'oral-google-'));
  const app = createApp({
    apiKey: '',
    llmConfigured: false,
    sessionsDir: path.join(dir, 'sessions'),
    usersFile: path.join(dir, 'users.json'),
    authSecret: 'test-secret',
    googleClientId: CLIENT,
    ...options,
  });
  const server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    await fn(base, path.join(dir, 'users.json'));
  } finally {
    server.close();
    await rm(dir, { recursive: true, force: true });
  }
}

function post(url, body) {
  return fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

test('a public https origin is used for Google and the session cookie', async () => {
  await withServer(async (base) => {
    const created = await post(`${base}/api/auth/register`, {
      name: 'Camille',
      email: 'camille@example.com',
      password: 'motdepasse',
    });
    assert.match(created.headers.getSetCookie()[0], /Secure/);

    const started = await post(`${base}/api/auth/google/start`, {}, undefined);
    const { url } = await started.json();
    const auth = new URL(url);
    assert.equal(auth.searchParams.get('redirect_uri'), 'https://oral.example/api/auth/google/callback');
  }, {
    publicUrl: 'https://oral.example',
    googleClientSecret: 'test-google-secret',
  });
});

test('google sign-in is hidden until configured, then joins an existing e-mail', async () => {
  await withServer(async (base) => {
    assert.deepEqual(await fetch(`${base}/api/auth/config`).then((res) => res.json()), { googleClientId: null });
    assert.equal((await post(`${base}/api/auth/google`, { credential: 'token' })).status, 503);
  }, { googleClientId: '' });

  await withServer(async (base, usersFile) => {
    assert.equal((await fetch(`${base}/api/auth/config`).then((res) => res.json())).googleClientId, CLIENT);
    const created = await post(`${base}/api/auth/register`, {
      name: 'Camille',
      email: 'camille@example.com',
      password: 'motdepasse',
    });
    const first = await created.json();

    const google = await post(`${base}/api/auth/google`, { credential: 'good-token' });
    assert.equal(google.status, 200);
    const signedIn = await google.json();
    assert.equal(signedIn.user.id, first.user.id);
    assert.equal(signedIn.user.email, 'camille@example.com');

    const again = await post(`${base}/api/auth/google`, { credential: 'good-token' });
    assert.equal((await again.json()).user.id, first.user.id);

    const stored = JSON.parse(await readFile(usersFile, 'utf8'));
    assert.equal(stored.length, 1);
    assert.equal(stored[0].googleSub, 'google-sub-1');
    assert.equal(stored[0].passwordHash.startsWith('scrypt$'), true);

    const password = await post(`${base}/api/auth/login`, {
      email: 'camille@example.com',
      password: 'motdepasse',
    });
    assert.equal(password.status, 200);
  }, {
    verifyGoogle: async (credential) => {
      assert.equal(credential, 'good-token');
      return { sub: 'google-sub-1', email: 'camille@example.com', name: 'Camille Martin' };
    },
  });
});

test('the Mac app uses the client secret to finish Google in the browser', async () => {
  let exchanged;
  await withServer(async (base) => {
    const started = await post(`${base}/api/auth/google/start`, { desktop: true });
    const { state, url } = await started.json();
    const auth = new URL(url);
    assert.equal(auth.host, 'accounts.google.com');
    assert.equal(auth.searchParams.get('client_id'), CLIENT);
    assert.match(auth.searchParams.get('redirect_uri'), /\/api\/auth\/google\/callback$/);

    const callback = await fetch(`${base}/api/auth/google/callback?code=abc&state=${state}`);
    assert.equal(callback.status, 200);
    assert.match(await callback.text(), /Retournez à À voix haute/);
    assert.equal(exchanged.client_secret, 'test-google-secret');
    assert.equal(exchanged.code, 'abc');

    const done = await fetch(`${base}/api/auth/google/pending?state=${state}`);
    assert.equal((await done.json()).user.email, 'mac@example.com');
  }, {
    googleClientSecret: 'test-google-secret',
    fetchImpl: async (url, opts) => {
      assert.match(String(url), /oauth2\.googleapis\.com\/token/);
      exchanged = Object.fromEntries(new URLSearchParams(opts.body));
      return new Response(JSON.stringify({ id_token: 'signed' }), { status: 200 });
    },
    verifyGoogle: async (credential) => {
      assert.equal(credential, 'signed');
      return { sub: 'mac-sub', email: 'mac@example.com', name: 'Mac' };
    },
  });
});

test('the Mac app finishes Google sign-in from the browser', async () => {
  await withServer(async (base) => {
    const started = await post(`${base}/api/auth/google/start`, { desktop: true });
    assert.equal(started.status, 200);
    const { state, url } = await started.json();
    const page = new URL(url);
    assert.equal(page.pathname, '/google.html');
    assert.equal(page.searchParams.get('state'), state);
    assert.equal((await fetch(url)).status, 200);

    const waiting = await fetch(`${base}/api/auth/google/pending?state=${state}`);
    assert.equal(waiting.status, 204);

    const finished = await post(`${base}/api/auth/google/browser`, { state, credential: 'signed' });
    assert.equal(finished.status, 200);

    const done = await fetch(`${base}/api/auth/google/pending?state=${state}`);
    assert.equal(done.status, 200);
    const cookie = done.headers.getSetCookie()[0].split(';')[0];
    assert.equal((await done.json()).user.email, 'mac@example.com');
    const me = await fetch(`${base}/api/auth/me`, { headers: { Cookie: cookie } });
    assert.equal((await me.json()).user.name, 'Mac');
    assert.equal((await fetch(`${base}/api/auth/google/pending?state=${state}`)).status, 404);
  }, {
    verifyGoogle: async (credential) => {
      assert.equal(credential, 'signed');
      return { sub: 'mac-sub', email: 'mac@example.com', name: 'Mac' };
    },
  });
});

test('a new Google account has no password and keeps older orals', async () => {
  await withServer(async (base, usersFile) => {
    const { mkdir, writeFile } = await import('node:fs/promises');
    const sessionsDir = path.join(path.dirname(usersFile), 'sessions');
    await mkdir(sessionsDir, { recursive: true });
    await writeFile(path.join(sessionsDir, 'old-1.json'), JSON.stringify({
      id: 'old-1',
      title: 'Avant',
      createdAt: '2026-08-01T00:00:00.000Z',
      monologue: { text: 'Un oral déjà là' },
    }));

    const google = await post(`${base}/api/auth/google`, { credential: 'new-person' });
    assert.equal(google.status, 200);
    const cookie = google.headers.getSetCookie()[0].split(';')[0];
    const { user } = await google.json();
    assert.equal(user.name, 'Noa');

    const list = await fetch(`${base}/api/sessions`, { headers: { Cookie: cookie } }).then((res) => res.json());
    assert.deepEqual(list.sessions.map((item) => item.id), ['old-1']);

    const stored = JSON.parse(await readFile(usersFile, 'utf8'));
    assert.equal(stored[0].passwordHash, null);
    const password = await post(`${base}/api/auth/login`, {
      email: 'noa@example.com',
      password: 'motdepasse',
    });
    assert.equal(password.status, 401);

    const rejected = await post(`${base}/api/auth/google`, { credential: 'bad' });
    assert.equal(rejected.status, 401);
  }, {
    verifyGoogle: async (credential) => {
      if (credential === 'bad') throw new GoogleAuthError();
      return { sub: 'google-sub-2', email: 'noa@example.com', name: 'Noa' };
    },
  });
});
