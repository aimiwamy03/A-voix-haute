const STRUCTURE_KEYS = ['problematique', 'plan', 'exemples', 'conclusion'];

export function stripFences(raw) {
  return String(raw ?? '')
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
}

export function parseFeedback(raw, transcript) {
  const cleaned = stripFences(raw);
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start < 0 || end <= start) {
    throw new Error('Le retour n\'est pas du JSON.');
  }
  const data = JSON.parse(cleaned.slice(start, end + 1));
  const structure = {};
  for (const key of STRUCTURE_KEYS) {
    const block = data.structure?.[key] ?? {};
    const quote = typeof block.quote === 'string' && block.quote && transcript.includes(block.quote)
      ? block.quote
      : null;
    structure[key] = {
      ok: Boolean(block.ok) && quote != null,
      quote,
    };
  }
  const fixes = [];
  for (const item of data.fixes ?? []) {
    if (fixes.length === 3) break;
    if (!item || typeof item.quote !== 'string' || !item.quote) continue;
    if (!transcript.includes(item.quote)) continue;
    fixes.push({
      quote: item.quote,
      probleme: String(item.probleme ?? ''),
      mieux: String(item.mieux ?? ''),
    });
  }
  return { structure, fixes };
}

export function cleanQuestion(raw) {
  const stripped = stripFences(raw).replace(/^["«]+|["»]+$/g, '').trim();
  const lines = stripped.split(/\n+/).map((line) => line.trim()).filter(Boolean);
  const line = lines.find((item) => item.endsWith('?')) || lines[0] || '';
  return line.replace(/^(question\s*:)\s*/i, '').trim();
}
