export function extractErrorMessage(raw) {
  let msg = String(raw ?? '').trim().slice(0, 500);
  try {
    const body = JSON.parse(raw);
    msg = body.error || body.detail || body.title || msg;
  } catch {
    // Keep the trimmed raw body.
  }
  return String(msg).trim().slice(0, 500);
}

/** A blank rewrite becomes null. Never fall back to the verbatim transcript. */
export function mapTranscribeResponse(body) {
  const rewrite = typeof body?.llm_response === 'string' ? body.llm_response.trim() : '';
  return {
    text: typeof body?.text === 'string' ? body.text : '',
    stronger: rewrite || null,
    words: Array.isArray(body?.words) ? body.words : [],
    sessionId: body?.session_id ?? null,
    llmError: body?.llm_error ?? null,
    durationMs: body?.audio_duration_ms ?? null,
    confidence: body?.confidence ?? null,
  };
}
