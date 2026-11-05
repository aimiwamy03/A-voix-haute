import { KEYTERMS_BYTE_CAP, KEYTERMS_COUNT_CAP, STT_PROMPT_CAP } from './constants.js';

export const FORBIDDEN_CONFIG_KEYS = [
  'prompt',
  'keyterms',
  'word_boost',
  'language_code',
  'language_codes',
  'conversation_context',
  'llm',
];

export function utf8Bytes(value) {
  return new TextEncoder().encode(value).length;
}

export function scalarLength(value) {
  return [...value].length;
}

/** Keep the tail: what the answer continues from matters most. */
export function fitPrompt(value) {
  const chars = [...value];
  return chars.length <= STT_PROMPT_CAP ? value : chars.slice(-STT_PROMPT_CAP).join('');
}

/**
 * Both caps are independent. Stop at the first term that would break either one.
 * Empty strings are dropped. Duplicates are dropped. Never emit [].
 */
export function fitKeyterms(terms) {
  const out = [];
  let used = 0;
  const seen = new Set();
  for (const raw of terms || []) {
    const term = String(raw).trim();
    if (!term || seen.has(term)) continue;
    seen.add(term);
    const size = utf8Bytes(term);
    if (out.length === KEYTERMS_COUNT_CAP || used + size > KEYTERMS_BYTE_CAP) break;
    out.push(term);
    used += size;
  }
  return out;
}

/** Only the five documented keys. llm_instruction is the server copy, never the client's. */
export function buildConfig(incoming, llmInstruction) {
  if (utf8Bytes(llmInstruction) > 2048) {
    throw new Error('llm_instruction over 2048 bytes');
  }
  const config = { sample_rate: 16000, channels: 1 };
  const prompt = typeof incoming?.stt_prompt === 'string' ? incoming.stt_prompt.trim() : '';
  if (prompt) config.stt_prompt = fitPrompt(prompt);
  const terms = fitKeyterms(Array.isArray(incoming?.keyterms_prompt) ? incoming.keyterms_prompt : []);
  if (terms.length) config.keyterms_prompt = terms;
  config.llm_instruction = llmInstruction;
  return config;
}
