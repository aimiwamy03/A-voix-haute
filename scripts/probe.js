import { readFileSync } from 'node:fs';
import { loadEnv } from '../server/env.js';
import { postDictation } from '../server/dictation.js';

loadEnv();
const file = process.argv[2];
if (!file) {
  console.error('Usage: npm run probe -- clips/mon-essai.wav');
  process.exit(1);
}
const key = process.env.ASSEMBLYAI_API_KEY;
if (!key) {
  console.error('ASSEMBLYAI_API_KEY manquant dans .env');
  process.exit(1);
}
const audio = readFileSync(file);
const result = await postDictation(audio, {
  stt_prompt: 'Un candidat en français langue étrangère présente oralement son point de vue lors de l\'épreuve de production orale du DELF.',
}, { apiKey: key, fetchImpl: fetch });

if (!result.ok) {
  console.error(`${result.status} ${result.error}`);
  process.exit(1);
}
console.log('--- text ---');
console.log(result.body.text || '(vide)');
console.log('--- stronger ---');
console.log(result.body.stronger ?? '(unavailable)');
console.log('--- session ---');
console.log(result.body.sessionId);
if (!result.body.text?.trim()) process.exit(1);
