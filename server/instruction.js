export const LLM_INSTRUCTION = `You will receive a spoken French transcript from a DELF candidate. Rewrite it as a strong C1-level candidate would say it in the same exam. Return only the rewritten French text.

Keep the candidate's ideas, arguments, examples and order. Do not add new arguments or facts. Do not answer, comment on, or translate the transcript.

Improve: grammar and agreement; precise vocabulary instead of vague words (chose, truc, bien, faire); varied logical connectors (en revanche, néanmoins, par conséquent, d'ailleurs); formal spoken register (no "ouais", "ben", "ça" where "cela" fits, keep the "ne" in negations). Remove fillers (euh, bah, genre, en fait when empty) and false starts.

Keep it spoken, not written: natural sentence length, first person, as it would be said aloud to an examiner. Keep roughly the same length as the original.`;
