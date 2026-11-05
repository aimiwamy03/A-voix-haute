import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { readSession, signSession } from '../server/auth.js';
import { createApp } from '../server/app.js';

async function withServer(fn) {
  const dir = await mkdtemp(path.join(tmpdir(), 'oral-auth-'));
  const sessionsDir = path.join(dir, 'sessions');
  const usersFile = path.join(dir, 'users.json');
  const app = createApp({
    apiKey: '',
    llmConfigured: false,
    sessionsDir,
    usersFile,
    authSecret: 'test-secret',
  });
  const server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    await fn(base, { sessionsDir, usersFile });
  } finally {
    server.close();
    await rm(dir, { recursive: true, force: true });
  }
}

function sessionCookie(res) {
  const raw = res.headers.getSetCookie()[0] ?? '';
  const pair = raw.split(';')[0];
  assert.match(pair, /^oral_session=\S+/);
  assert.match(raw, /HttpOnly/);
  assert.match(raw, /SameSite=Lax/);
  return pair;
}

function post(url, body, cookie) {
  return fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: JSON.stringify(body),
  });
}

test('expired and tampered session cookies are rejected', () => {
  const id = 'ab'.repeat(16);
  const live = signSession(id, 'secret');
  assert.equal(readSession(live, 'secret'), id);
  assert.equal(readSession(live, 'other'), null);
  assert.equal(readSession(`${live}x`, 'secret'), null);
  const expired = signSession(id, 'secret', Date.now() - 31 * 24 * 60 * 60 * 1000);
  assert.equal(readSession(expired, 'secret'), null);
});

test('register, login, and logout', async () => {
  await withServer(async (base, { usersFile }) => {
    assert.equal((await fetch(`${base}/api/auth/me`)).status, 401);
    assert.equal((await fetch(`${base}/api/sessions`)).status, 401);

    const created = await post(`${base}/api/auth/register`, {
      name: '  Camille  ',
      email: 'Camille@Example.com',
      password: 'motdepasse',
    });
    assert.equal(created.status, 201);
    const cookie = sessionCookie(created);
    const { user } = await created.json();
    assert.equal(user.name, 'Camille');
    assert.equal(user.email, 'camille@example.com');
    assert.equal(user.passwordHash, undefined);

    const me = await fetch(`${base}/api/auth/me`, { headers: { Cookie: cookie } });
    assert.equal(me.status, 200);
    assert.equal((await me.json()).user.email, 'camille@example.com');

    const stored = JSON.parse(await readFile(usersFile, 'utf8'));
    assert.equal(stored[0].passwordHash.startsWith('scrypt$'), true);
    assert.equal(JSON.stringify(stored).includes('motdepasse'), false);

    const again = await post(`${base}/api/auth/register`, {
      name: 'Camille',
      email: 'camille@example.com',
      password: 'motdepasse',
    });
    assert.equal(again.status, 409);

    const loggedOut = await fetch(`${base}/api/auth/logout`, { method: 'POST' });
    assert.equal(loggedOut.status, 204);
    assert.match(loggedOut.headers.getSetCookie()[0], /Max-Age=0/);

    const login = await post(`${base}/api/auth/login`, {
      email: 'camille@example.com',
      password: 'motdepasse',
    });
    assert.equal(login.status, 200);
    assert.equal((await login.json()).user.name, 'Camille');

    const wrong = await post(`${base}/api/auth/login`, {
      email: 'camille@example.com',
      password: 'mauvais-mot',
    });
    assert.equal(wrong.status, 401);
    const missing = await post(`${base}/api/auth/login`, {
      email: 'inconnu@example.com',
      password: 'motdepasse',
    });
    assert.equal(missing.status, 401);
    const short = await post(`${base}/api/auth/register`, {
      name: 'Lou',
      email: 'lou@example.com',
      password: 'court',
    });
    assert.equal(short.status, 400);

    const named = await fetch(`${base}/api/auth/me`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ name: '  Camille R.  ' }),
    });
    assert.equal(named.status, 200);
    assert.equal((await named.json()).user.name, 'Camille R.');

    const blank = await fetch(`${base}/api/auth/me`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ name: '   ' }),
    });
    assert.equal(blank.status, 400);

    const password = await post(`${base}/api/auth/password`, {
      current: 'motdepasse',
      next: 'nouveaupass',
    }, cookie);
    assert.equal(password.status, 200);

    const old = await post(`${base}/api/auth/login`, {
      email: 'camille@example.com',
      password: 'motdepasse',
    });
    assert.equal(old.status, 401);
    const fresh = await post(`${base}/api/auth/login`, {
      email: 'camille@example.com',
      password: 'nouveaupass',
    });
    assert.equal(fresh.status, 200);
  });
});

test('each account sees only its own orals, and the first account keeps older ones', async () => {
  await withServer(async (base, { sessionsDir }) => {
    await mkdir(sessionsDir, { recursive: true });
    await writeFile(path.join(sessionsDir, 'old-1.json'), JSON.stringify({
      id: 'old-1',
      title: 'Avant',
      createdAt: '2026-08-01T00:00:00.000Z',
      monologue: { text: 'Un oral déjà là' },
    }));

    const first = await post(`${base}/api/auth/register`, {
      name: 'Camille',
      email: 'camille@example.com',
      password: 'motdepasse',
    });
    const camille = sessionCookie(first);
    const second = await post(`${base}/api/auth/register`, {
      name: 'Noa',
      email: 'noa@example.com',
      password: 'autre-mot',
    });
    const noa = sessionCookie(second);

    const camilleList = await fetch(`${base}/api/sessions`, { headers: { Cookie: camille } }).then((r) => r.json());
    assert.deepEqual(camilleList.sessions.map((item) => item.id), ['old-1']);
    const noaList = await fetch(`${base}/api/sessions`, { headers: { Cookie: noa } }).then((r) => r.json());
    assert.deepEqual(noaList.sessions, []);

    const oral = { title: 'Sujet', createdAt: '2026-09-03T00:00:00.000Z', monologue: { text: 'Bonjour' } };
    assert.equal((await fetch(`${base}/api/sessions/noa-1`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Cookie: noa },
      body: JSON.stringify(oral),
    })).status, 204);

    const after = await fetch(`${base}/api/sessions`, { headers: { Cookie: noa } }).then((r) => r.json());
    assert.deepEqual(after.sessions.map((item) => item.id), ['noa-1']);
    const stillCamille = await fetch(`${base}/api/sessions/noa-1`, { headers: { Cookie: camille } });
    assert.equal(stillCamille.status, 404);
    assert.equal((await readdir(sessionsDir)).includes('old-1.json'), false);
  });
});
