import assert from 'node:assert/strict';
import test from 'node:test';
import { LLM_INSTRUCTION } from '../server/instruction.js';
import { utf8Bytes } from '../shared/limits.js';
import { FORBIDDEN_CONFIG_KEYS, buildConfig, fitKeyterms, fitPrompt } from '../shared/limits.js';
import { mapTranscribeResponse } from '../shared/response.js';
import { sttPromptForTurn } from '../shared/stt.js';

test('llm instruction stays under the byte cap', () => {
  assert.ok(utf8Bytes(LLM_INSTRUCTION) > 700);
  assert.ok(utf8Bytes(LLM_INSTRUCTION) <= 2048);
});

test('empty prompt and terms are absent, and forbidden keys never appear', () => {
  const config = buildConfig({
    stt_prompt: '   ',
    keyterms_prompt: ['  ', ''],
    language_code: 'fr',
    prompt: 'x',
    llm_instruction: 'from the client',
  }, LLM_INSTRUCTION);
  assert.equal('stt_prompt' in config, false);
  assert.equal('keyterms_prompt' in config, false);
  assert.equal(config.llm_instruction, LLM_INSTRUCTION);
  assert.equal(config.sample_rate, 16000);
  assert.equal(config.channels, 1);
  for (const key of FORBIDDEN_CONFIG_KEYS) assert.equal(key in config, false);
});

test('keyterm count cap and byte cap are independent', () => {
  const many = Array.from({ length: 150 }, (_, i) => `mot${i}`);
  assert.equal(fitKeyterms(many).length, 100);

  const heavy = Array.from({ length: 10 }, (_, i) => `${'é'.repeat(200)}${i}`);
  const fitted = fitKeyterms(heavy);
  assert.ok(fitted.length < 100);
  assert.ok(fitted.length >= 1);
  assert.ok(fitted.reduce((sum, term) => sum + utf8Bytes(term), 0) <= 2048);
  assert.ok(fitted.reduce((sum, term) => sum + utf8Bytes(term), 0) + utf8Bytes(heavy[fitted.length]) > 2048);
});

test('over-long prompt keeps the tail and stays within 4096 scalars', () => {
  const answer = 'REPONSE_FINALE';
  const joined = `${'D'.repeat(5000)}\n\n${answer}`;
  const fitted = fitPrompt(joined);
  assert.equal([...fitted].length, 4096);
  assert.ok(fitted.endsWith(answer));
  assert.equal(fitPrompt('court'), 'court');
});

test('turn 2 prompt places the first answer last', () => {
  const prompt = sttPromptForTurn('Titre', 'Un résumé.', 'Ma première réponse.');
  assert.ok(prompt.endsWith('Ma première réponse.'));
  assert.ok(prompt.indexOf('Titre') < prompt.indexOf('Ma première réponse.'));
});

test('blank rewrite never falls back to the transcript', () => {
  for (const llm_response of [null, '', '   ']) {
    const mapped = mapTranscribeResponse({ text: 'bonjour', llm_response });
    assert.equal(mapped.stronger, null);
    assert.equal(mapped.text, 'bonjour');
    assert.notEqual(mapped.stronger, mapped.text);
  }
  assert.equal(mapTranscribeResponse({ text: 'bonjour', llm_response: 'salut' }).stronger, 'salut');
});
