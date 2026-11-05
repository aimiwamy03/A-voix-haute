export function feedbackPrompt(document, text) {
  return `You are a DELF oral examiner giving practice feedback. Using the document and the candidate's verbatim transcript below, return ONLY this JSON, with no preamble or code fences:

{
  "structure": {
    "problematique": { "ok": bool, "quote": string | null },
    "plan":          { "ok": bool, "quote": string | null },
    "exemples":      { "ok": bool, "quote": string | null },
    "conclusion":    { "ok": bool, "quote": string | null }
  },
  "fixes": [
    { "quote": string, "probleme": string, "mieux": string }
  ]
}

Rules: exactly 3 fixes, the most important first. Every quote must appear verbatim in the transcript. Explanations in simple French. Ignore disfluencies unless they block understanding.

DOCUMENT:
${document}

TRANSCRIPT:
${text}`;
}

function cut(value, max) {
  const text = String(value ?? '').trim();
  return text.length <= max ? text : `${text.slice(0, max)}…`;
}

export function followUpPrompt({ document = '', monologue = '', stance = '', thread = [], forceClose = false, judgeOnly = false } = {}) {
  const turns = Array.isArray(thread) ? thread : [];
  const last = turns[turns.length - 1];
  if (judgeOnly) {
    return `You are a DELF examiner. Did the candidate answer the question, or slide past it? Return ONLY this JSON: {"addressed": true or false}.
addressed is true only if they engaged the point, even to disagree. False if they changed the subject or stayed too vague to count as an answer.

QUESTION:
${cut(last?.question, 500)}

ANSWER:
${cut(last?.answer, 2000)}`;
  }

  const used = [...new Set(turns.map((turn) => turn.move).filter(Boolean))];
  const earlier = turns.slice(0, -1).map((turn, index) => (
    `${index + 1}. [${turn.move}] ${cut(turn.question, 300)}\nRéponse : ${cut(turn.answer, 400)}`
  )).join('\n\n');
  const next = turns.length + 1;
  const stanceLine = stance
    ? `Your stance, copy it unchanged into "stance": ${cut(stance, 300)}`
    : 'No stance yet. Choose one sentence: the strongest objection grounded in the document. You defend that side for the whole debate.';
  const closeLine = forceClose
    ? 'This MUST be the closing question. move is "conclusion" and continue is false. Still react to what they just said.'
    : 'continue is true. Do not close, and do not use the conclusion move. Only question 3 closes the debate.';

  return `You are a DELF examiner in the interaction, not a quiz. You hold ONE stance and stay on that side. Ask the next question from the candidate's latest answer.

Return ONLY this JSON, no preamble or code fences:
{
  "stance": "one sentence",
  "addressed": true or false or null,
  "move": "reprise" | "objection" | "exemple" | "cas_limite" | "nuance" | "conclusion",
  "question": "one French sentence, at most 25 words, ending with ?",
  "continue": true or false
}

Rules:
- One question only. Never two.
- It must pick up something they just said. On question 1, pick it up from the monologue.
- Do not repeat a point they already answered.
- "Pouvez-vous développer ?" is forbidden unless you name what was missing.
- Moves already used: ${used.length ? used.join(', ') : 'aucune'}. Prefer a move not yet used.
- If the last answer was vague or dodged, you may reuse that same move once, narrower, and set addressed to false.
- If they conceded, do not hammer that point. Ask whether they are dropping their opening idea.
- addressed is about the previous debate answer only. null when there is no previous debate answer. true if they engaged the point.
- You are asking question ${next} of 3.
- ${closeLine}
- ${stanceLine}

DOCUMENT:
${cut(document, 3500)}

MONOLOGUE:
${cut(monologue, 2200)}
${earlier ? `\nEARLIER EXCHANGES:\n${earlier}\n` : ''}
LAST ANSWER:
${last ? cut(last.answer, 1800) : '(none yet — this is the first question, react to the monologue)'}`;
}

function provider() {
  const choice = (process.env.LLM_PROVIDER || '').toLowerCase();
  if (choice === 'openai' && process.env.OPENAI_API_KEY) return 'openai';
  if (choice === 'anthropic' && process.env.ANTHROPIC_API_KEY) return 'anthropic';
  if (process.env.ANTHROPIC_API_KEY) return 'anthropic';
  if (process.env.OPENAI_API_KEY) return 'openai';
  return null;
}

function clip(value) {
  return String(value ?? '').slice(0, 300);
}

async function completeOpenAI({ user, maxTokens }) {
  const base = (process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, '');
  const res = await fetch(`${base}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
      temperature: 0.2,
      max_tokens: maxTokens,
      messages: [{ role: 'user', content: user }],
    }),
    signal: AbortSignal.timeout(60_000),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(clip(data.error?.message || 'Le modèle a refusé la demande.'));
    err.status = res.status === 401 || res.status === 403 ? 503 : 502;
    throw err;
  }
  const content = data.choices?.[0]?.message?.content;
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) return content.map((part) => part.text || '').join('');
  return '';
}

async function completeAnthropic({ user, maxTokens }) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-5',
      max_tokens: maxTokens,
      temperature: 0.2,
      messages: [{ role: 'user', content: user }],
    }),
    signal: AbortSignal.timeout(60_000),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(clip(data.error?.message || 'Le modèle a refusé la demande.'));
    err.status = res.status === 401 || res.status === 403 ? 503 : 502;
    throw err;
  }
  return (data.content || []).map((part) => part.text || '').join('');
}

export async function defaultComplete(options) {
  const name = provider();
  if (!name) {
    const err = new Error('Aucune clé LLM. Définissez ANTHROPIC_API_KEY dans .env.');
    err.status = 503;
    throw err;
  }
  const text = name === 'anthropic' ? await completeAnthropic(options) : await completeOpenAI(options);
  if (!text.trim()) {
    const err = new Error('Le modèle a renvoyé une réponse vide.');
    err.status = 502;
    throw err;
  }
  return text;
}

export function llmConfigured() {
  return Boolean(provider());
}
