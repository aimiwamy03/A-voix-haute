import { LLM_INSTRUCTION } from './instruction.js';
import { UPSTREAM_TIMEOUT_MS } from '../shared/constants.js';
import { buildConfig } from '../shared/limits.js';
import { extractErrorMessage, mapTranscribeResponse } from '../shared/response.js';

const ENDPOINT = 'https://dictation.assemblyai.com/v1/transcribe/live';

export async function postDictation(buffer, incoming, deps) {
  const config = buildConfig(incoming, LLM_INSTRUCTION);
  const form = new FormData();
  form.append('config', new Blob([JSON.stringify(config)], { type: 'application/json' }));
  form.append('audio', new Blob([buffer], { type: 'audio/wav' }), 'audio.wav');

  let upstream;
  try {
    upstream = await deps.fetchImpl(ENDPOINT, {
      method: 'POST',
      headers: { Authorization: deps.apiKey },
      body: form,
      signal: AbortSignal.timeout(deps.timeoutMs ?? UPSTREAM_TIMEOUT_MS),
    });
  } catch (err) {
    const timedOut = err?.name === 'TimeoutError' || err?.name === 'AbortError';
    return {
      ok: false,
      status: timedOut ? 504 : 502,
      error: timedOut
        ? 'Le service de transcription n\'a pas répondu à temps.'
        : 'Le service de transcription est injoignable.',
    };
  }

  const raw = await upstream.text();
  if (!upstream.ok) {
    return {
      ok: false,
      status: upstream.status,
      error: extractErrorMessage(raw),
      retryAfter: upstream.headers.get('retry-after'),
    };
  }

  try {
    return { ok: true, status: 200, body: mapTranscribeResponse(JSON.parse(raw)) };
  } catch {
    return { ok: false, status: 502, error: 'Réponse illisible du service de transcription.' };
  }
}
