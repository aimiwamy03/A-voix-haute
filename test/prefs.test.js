import assert from 'node:assert/strict';
import test from 'node:test';
import { DEFAULT_PREFS, PREP_SECONDS, normalizePrefs } from '../shared/prefs.js';

test('empty input becomes the defaults', () => {
  assert.deepEqual(normalizePrefs(null), DEFAULT_PREFS);
  assert.deepEqual(normalizePrefs({}), DEFAULT_PREFS);
});

test('known prep lengths stay, anything else falls back', () => {
  for (const seconds of PREP_SECONDS) {
    assert.equal(normalizePrefs({ prepSeconds: seconds }).prepSeconds, seconds);
  }
  assert.equal(normalizePrefs({ prepSeconds: 90 }).prepSeconds, DEFAULT_PREFS.prepSeconds);
});

test('only an explicit false turns a switch off', () => {
  assert.equal(normalizePrefs({ autoArmDebate: false }).autoArmDebate, false);
  assert.equal(normalizePrefs({ autoArmDebate: true }).autoArmDebate, true);
  assert.equal(normalizePrefs({ showNotesWhileSpeaking: 0 }).showNotesWhileSpeaking, true);
  assert.equal(normalizePrefs({ markUncertainWords: 'no' }).markUncertainWords, true);
});

test('unknown palettes are rejected when a list is given', () => {
  assert.equal(normalizePrefs({ palette: 'rose' }, ['argent', 'bleu']).palette, DEFAULT_PREFS.palette);
  assert.equal(normalizePrefs({ palette: 'bleu' }, ['argent', 'bleu']).palette, 'bleu');
});
