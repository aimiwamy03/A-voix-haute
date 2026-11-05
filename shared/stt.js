export function sttPrompt(title, summary) {
  return `Un candidat en français langue étrangère présente oralement son point de vue lors de l'épreuve de production orale du DELF. Sujet du document : ${title}. ${summary}`;
}

/** Turn 2 places the first answer last, so a later trim keeps that answer. */
export function sttPromptForTurn(title, summary, previousAnswer) {
  const description = sttPrompt(title, summary);
  const answer = typeof previousAnswer === 'string' ? previousAnswer.trim() : '';
  if (!answer) return description;
  return `${description}\n\n${answer}`;
}
