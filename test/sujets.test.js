import assert from 'node:assert/strict';
import test from 'node:test';
import { SUJETS, THEMES } from '../shared/sujets.js';
import { sttPrompt } from '../shared/stt.js';

const BANNED = ['néanmoins', 'en revanche', 'par conséquent', 'd\'ailleurs', 'ouais', 'ben'];

test('sujets carry topic words, not graded connectors', () => {
  assert.equal(SUJETS.length, 9);
  const themeIds = THEMES.map(([id]) => id);
  for (const id of themeIds) {
    assert.ok(SUJETS.filter((sujet) => sujet.theme === id).length >= 2);
  }
  for (const sujet of SUJETS) {
    assert.ok(themeIds.includes(sujet.theme));
    const body = sujet.paragraphs.join(' ');
    assert.ok(body.length > 400);
    assert.ok(sujet.keyterms.length > 0);
    for (const term of sujet.keyterms) {
      assert.equal(BANNED.includes(term.toLowerCase()), false);
      assert.ok(body.includes(term.split(' ')[0]) || body.includes(term));
    }
    const prompt = sttPrompt(sujet.title, sujet.summary);
    assert.match(prompt, /Sujet du document/);
    assert.doesNotMatch(prompt, /transcribe|keep the errors/i);
  }
});
