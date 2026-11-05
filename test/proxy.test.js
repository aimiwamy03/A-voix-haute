import assert from 'node:assert/strict';
import test from 'node:test';
import { createApp } from '../server/app.js';
import { LLM_INSTRUCTION } from '../server/instruction.js';
import { FORBIDDEN_CONFIG_KEYS } from '../shared/limits.js';

function tinyWav(bytes = 3200) {
  const dataSize = bytes;
  const buf = Buffer.alloc(44 + dataSize);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + dataSize, 4);
  buf.write('WAVEfmt ', 8);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(16000, 24);
  buf.writeUInt32LE(32000, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36);
  buf.writeUInt32LE(dataSize, 40);
  return buf;
}

async function listen(app) {
  return new Promise((resolve) => {
    const server = app.listen(0, '127.0.0.1', () => resolve(server));
  });
}

test('proxy clamps config, keeps order, and never falls back to text', async () => {
  let seen;
  const app = createApp({
    apiKey: 'test-key',
    llmConfigured: true,
    requireAuth: false,
    fetchImpl: async (url, opts) => {
      seen = { url, headers: opts.headers, form: opts.body };
      return new Response(JSON.stringify({
        text: 'bonjour',
        llm_response: '   ',
        session_id: 's1',
      }), { status: 200 });
    },
  });
  const server = await listen(app);
  try {
    const fd = new FormData();
    fd.append('config', JSON.stringify({
      stt_prompt: `${'A'.repeat(5000)}FIN_DU_PROMPT`,
      keyterms_prompt: ['Paris', ''],
      language_code: 'fr',
      llm_instruction: 'nope',
    }));
    fd.append('audio', new Blob([tinyWav()]), 'audio.wav');
    const res = await fetch(`http://127.0.0.1:${server.address().port}/api/transcribe`, {
      method: 'POST',
      body: fd,
    });
    const json = await res.json();
    assert.equal(res.status, 200);
    assert.equal(json.text, 'bonjour');
    assert.equal(json.stronger, null);
    assert.equal(seen.headers.Authorization, 'test-key');
    assert.equal([...seen.form.keys()][0], 'config');
    const config = JSON.parse(await seen.form.get('config').text());
    assert.equal([...config.stt_prompt].length, 4096);
    assert.ok(config.stt_prompt.endsWith('FIN_DU_PROMPT'));
    assert.deepEqual(config.keyterms_prompt, ['Paris']);
    assert.equal(config.llm_instruction, LLM_INSTRUCTION);
    for (const key of FORBIDDEN_CONFIG_KEYS) assert.equal(config[key], undefined);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('upstream errors pass through with status and Retry-After', async () => {
  const app = createApp({
    apiKey: 'test-key',
    requireAuth: false,
    fetchImpl: async () => new Response(JSON.stringify({ status: 429, detail: 'slow down' }), {
      status: 429,
      headers: { 'retry-after': '3' },
    }),
  });
  const server = await listen(app);
  try {
    const fd = new FormData();
    fd.append('audio', new Blob([tinyWav()]), 'audio.wav');
    const res = await fetch(`http://127.0.0.1:${server.address().port}/api/transcribe`, {
      method: 'POST',
      body: fd,
    });
    const json = await res.json();
    assert.equal(res.status, 429);
    assert.equal(json.error, 'slow down');
    assert.equal(res.headers.get('retry-after'), '3');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('feedback drops quotes that are not in the transcript', async () => {
  const app = createApp({
    apiKey: 'test-key',
    llmConfigured: true,
    requireAuth: false,
    complete: async ({ user }) => {
      assert.match(user, /bonjour les amis/);
      return JSON.stringify({
        structure: {
          problematique: { ok: true, quote: 'bonjour les amis' },
          plan: { ok: true, quote: 'inventé' },
          exemples: { ok: false, quote: null },
          conclusion: { ok: false, quote: null },
        },
        fixes: [
          { quote: 'bonjour les amis', probleme: 'vague', mieux: 'bonjour à vous' },
          { quote: 'citation absente', probleme: 'x', mieux: 'y' },
        ],
      });
    },
  });
  const server = await listen(app);
  try {
    const res = await fetch(`http://127.0.0.1:${server.address().port}/api/feedback`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ document: 'Un document.', text: 'bonjour les amis' }),
    });
    const json = await res.json();
    assert.equal(res.status, 200);
    assert.equal(json.fixes.length, 1);
    assert.equal(json.structure.plan.ok, false);
    assert.equal(json.structure.problematique.ok, true);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('followup keeps one stance and will not close before the third question', async () => {
  let seen = '';
  const app = createApp({
    apiKey: 'test-key',
    llmConfigured: true,
    requireAuth: false,
    complete: async ({ user }) => {
      seen = user;
      return JSON.stringify({
        stance: 'Le modèle veut changer de camp.',
        addressed: true,
        move: 'conclusion',
        question: 'Vous abandonnez ? Et ensuite ?',
        continue: false,
      });
    },
  });
  const server = await listen(app);
  try {
    const res = await fetch(`http://127.0.0.1:${server.address().port}/api/followup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        document: 'Un document.',
        monologue: 'Je défends le télétravail.',
        stance: 'Deux jours au bureau restent nécessaires.',
        thread: [],
      }),
    });
    const json = await res.json();
    assert.equal(res.status, 200);
    assert.equal(json.question, 'Vous abandonnez ?');
    assert.equal(json.continue, true);
    assert.notEqual(json.move, 'conclusion');
    assert.equal(json.addressed, null);
    assert.equal(json.stance, 'Deux jours au bureau restent nécessaires.');
    assert.match(seen, /Je défends le télétravail/);
    assert.match(seen, /Deux jours au bureau restent nécessaires/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('missing audio and missing key are rejected', async () => {
  const app = createApp({ apiKey: '', requireAuth: false });
  const server = await listen(app);
  try {
    const health = await fetch(`http://127.0.0.1:${server.address().port}/api/health`);
    assert.deepEqual(await health.json(), { ok: true, assemblyai: false, llm: false });
    const res = await fetch(`http://127.0.0.1:${server.address().port}/api/transcribe`, { method: 'POST' });
    assert.equal(res.status, 503);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
