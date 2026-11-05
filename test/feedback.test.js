import assert from 'node:assert/strict';
import test from 'node:test';
import { parseFollowUp } from '../shared/debate.js';
import { EXAMPLE } from '../shared/example.js';
import { cleanQuestion, parseFeedback } from '../shared/feedback.js';
import { feedbackPrompt, followUpPrompt } from '../server/llm.js';

test('a fix whose quote is not in the transcript is discarded', () => {
  const transcript = 'bonjour les amis ici';
  const raw = `\`\`\`json
${JSON.stringify({
    structure: {
      problematique: { ok: true, quote: 'bonjour les amis' },
      plan: { ok: true, quote: 'pas dans le texte' },
      exemples: { ok: false, quote: null },
      conclusion: { ok: false },
    },
    fixes: [
      { quote: 'bonjour les amis', probleme: 'x', mieux: 'y' },
      { quote: 'citation inventée', probleme: 'x', mieux: 'y' },
      { quote: 'ici', probleme: 'court', mieux: 'ici même' },
    ],
  })}
\`\`\``;
  const parsed = parseFeedback(raw, transcript);
  assert.equal(parsed.structure.problematique.ok, true);
  assert.equal(parsed.structure.plan.ok, false);
  assert.equal(parsed.structure.plan.quote, null);
  assert.deepEqual(parsed.fixes.map((fix) => fix.quote), ['bonjour les amis', 'ici']);
});

test('example quotes are verbatim', () => {
  for (const fix of EXAMPLE.feedback.fixes) {
    assert.ok(EXAMPLE.monologue.text.includes(fix.quote));
  }
});

test('cleanQuestion keeps the single question', () => {
  assert.equal(cleanQuestion('Voici.\nPourquoi ce choix ?\n'), 'Pourquoi ce choix ?');
});

test('prompts ask for json fixes and one debate question', () => {
  assert.match(feedbackPrompt('doc', 'texte'), /exactly 3 fixes/);
  assert.match(feedbackPrompt('doc', 'texte'), /DOCUMENT:\ndoc/);
  assert.match(feedbackPrompt('doc', 'texte'), /TRANSCRIPT:\ntexte/);
  const first = followUpPrompt({ document: 'doc', monologue: 'texte' });
  assert.match(first, /One question only/);
  assert.match(first, /MONOLOGUE:\ntexte/);
  assert.match(first, /LAST ANSWER:\n\(none yet/);
  const next = followUpPrompt({
    document: 'doc',
    monologue: 'texte',
    stance: 'Je défends le bureau.',
    thread: [{ question: 'Pourquoi ?', move: 'objection', answer: 'Parce que.' }],
  });
  assert.match(next, /LAST ANSWER:\nParce que\./);
  assert.match(next, /Je défends le bureau/);
  assert.match(next, /question 2 of 3/);
  assert.match(followUpPrompt({ document: 'doc', monologue: 'texte', forceClose: true }), /MUST be the closing question/);
  assert.match(followUpPrompt({
    document: 'doc',
    monologue: 'texte',
    judgeOnly: true,
    thread: [{ question: 'Pourquoi ?', answer: 'Parce que.' }],
  }), /\{"addressed": true or false\}/);
});

test('the debate stays open for two questions and the third one closes', () => {
  const early = parseFollowUp(JSON.stringify({
    stance: 'Le bureau reste nécessaire.',
    addressed: false,
    move: 'conclusion',
    question: 'Alors vous abandonnez votre idée ? Et pourquoi ?',
    continue: false,
  }), { answered: 0, usedMoves: [] });
  assert.equal(early.addressed, null);
  assert.equal(early.continue, true);
  assert.notEqual(early.move, 'conclusion');
  assert.equal(early.question, 'Alors vous abandonnez votre idée ?');

  const second = parseFollowUp(JSON.stringify({
    stance: 'autre',
    addressed: true,
    move: 'conclusion',
    question: 'Si vous ne deviez garder qu\'un argument, lequel ?',
    continue: false,
  }), { answered: 1, stanceIn: 'Le bureau reste nécessaire.', usedMoves: ['objection'] });
  assert.equal(second.continue, true);
  assert.notEqual(second.move, 'conclusion');
  assert.equal(second.addressed, true);
  assert.equal(second.stance, 'Le bureau reste nécessaire.');

  const last = parseFollowUp(JSON.stringify({
    stance: 'Le bureau reste nécessaire.',
    addressed: false,
    move: 'objection',
    question: 'Et les plus jeunes ?',
    continue: true,
  }), { answered: 2, forceClose: true, usedMoves: ['objection'] });
  assert.equal(last.continue, false);
  assert.equal(last.move, 'conclusion');
  assert.equal(last.question, 'Et les plus jeunes ?');
});

test('a verdict on the last answer does not invent a new question', () => {
  assert.deepEqual(parseFollowUp('{"addressed": false}', { judgeOnly: true, answered: 4 }), { addressed: false });
  assert.deepEqual(parseFollowUp('{"addressed": true}', { judgeOnly: true }), { addressed: true });
});
