import assert from 'node:assert/strict';
import test from 'node:test';
import { wordDiff } from '../shared/diff.js';
import { EXAMPLE } from '../shared/example.js';

test('changed words are marked added or removed', () => {
  const ops = wordDiff('je suis allé au marché', 'je suis allée au marché');
  assert.ok(ops.some((op) => op.op === 'removed' && op.word === 'allé'));
  assert.ok(ops.some((op) => op.op === 'added' && op.word === 'allée'));
  assert.ok(ops.some((op) => op.op === 'same' && op.word === 'marché'));
});

test('punctuation does not split equal words', () => {
  const ops = wordDiff('bonjour,', 'bonjour');
  assert.deepEqual(ops.map((op) => op.op), ['same']);
});

test('the example retour has a visible diff', () => {
  const ops = wordDiff(EXAMPLE.monologue.text, EXAMPLE.monologue.stronger);
  assert.ok(ops.some((op) => op.op === 'added'));
  assert.ok(ops.some((op) => op.op === 'removed'));
});
