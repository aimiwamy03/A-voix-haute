import assert from 'node:assert/strict';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createApp } from '../server/app.js';

async function withServer(fn) {
  const dir = await mkdtemp(path.join(tmpdir(), 'oral-sessions-'));
  const app = createApp({ apiKey: '', llmConfigured: false, sessionsDir: dir, requireAuth: false });
  const server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const base = `http://127.0.0.1:${server.address().port}/api/sessions`;
  try {
    await fn(base, dir);
  } finally {
    server.close();
    await rm(dir, { recursive: true, force: true });
  }
}

const put = (url, body) => fetch(url, {
  method: 'PUT',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

test('sessions save, list newest first, reopen, and delete', async () => {
  await withServer(async (base, dir) => {
    assert.deepEqual(await fetch(base).then((r) => r.json()), { sessions: [] });

    const older = { title: 'Sujet A', createdAt: '2026-09-01T10:00:00.000Z', monologue: { text: 'Je pense que…', stronger: 'Selon moi…' } };
    const newer = { title: 'Sujet B', createdAt: '2026-09-02T10:00:00.000Z', monologue: { text: 'Bonjour' }, reply: { text: 'Oui' } };
    assert.equal((await put(`${base}/a-1`, older)).status, 204);
    assert.equal((await put(`${base}/b-2`, newer)).status, 204);

    const { sessions } = await fetch(base).then((r) => r.json());
    assert.deepEqual(sessions.map((s) => [s.id, s.hasReply]), [['b-2', true], ['a-1', false]]);

    const saved = await fetch(`${base}/a-1`).then((r) => r.json());
    assert.equal(saved.monologue.stronger, 'Selon moi…');
    assert.equal(saved.id, 'a-1');

    assert.equal((await fetch(`${base}/a-1`, { method: 'DELETE' })).status, 204);
    assert.equal((await fetch(`${base}/a-1`)).status, 404);
    assert.deepEqual(await readdir(dir), ['b-2.json']);
  });
});

test('sessions reject path-like ids and empty transcripts', async () => {
  await withServer(async (base) => {
    assert.equal((await put(`${base}/..%2Fescape`, { monologue: { text: 'x' } })).status, 400);
    assert.equal((await put(`${base}/Bad.Id`, { monologue: { text: 'x' } })).status, 400);
    assert.equal((await put(`${base}/ok-1`, { monologue: { text: '  ' } })).status, 400);
    assert.equal((await fetch(`${base}/..%2Fpackage`)).status, 400);
  });
});
