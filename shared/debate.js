import { DEBATE_MAX_TURNS, DEBATE_MIN_TURNS } from './constants.js';
import { cleanQuestion, stripFences } from './feedback.js';

export const MOVES = ['reprise', 'objection', 'exemple', 'cas_limite', 'nuance', 'conclusion'];

function readJson(raw) {
  const cleaned = stripFences(raw);
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('La question n\'est pas du JSON.');
  return JSON.parse(cleaned.slice(start, end + 1));
}

function firstQuestion(value) {
  const line = cleanQuestion(typeof value === 'string' ? value : '');
  const mark = line.indexOf('?');
  return mark >= 0 ? line.slice(0, mark + 1).trim() : line;
}

function unusedMove(used) {
  return MOVES.find((move) => move !== 'conclusion' && !used.includes(move)) || 'objection';
}

function readAddressed(value, applicable) {
  if (!applicable) return null;
  if (value === true || value === false) return value;
  return null;
}

export function parseFollowUp(raw, options = {}) {
  const {
    stanceIn = '',
    forceClose = false,
    judgeOnly = false,
    answered = 0,
    usedMoves = [],
  } = options;
  const data = readJson(raw);
  const addressed = readAddressed(data.addressed, answered > 0 || judgeOnly);
  if (judgeOnly) return { addressed };

  const next = answered + 1;
  let move = MOVES.includes(data.move) ? data.move : unusedMove(usedMoves);
  let continueDebate = data.continue !== false;
  if (next < DEBATE_MIN_TURNS) {
    continueDebate = true;
    if (move === 'conclusion') move = unusedMove(usedMoves);
  } else if (forceClose || next >= DEBATE_MAX_TURNS || !continueDebate || move === 'conclusion') {
    move = 'conclusion';
    continueDebate = false;
  }
  const question = firstQuestion(data.question);
  if (!question) throw new Error('La question de l\'examinateur est vide.');
  const stance = String(stanceIn || data.stance || '').trim().slice(0, 300);
  return { question, move, continue: continueDebate, stance, addressed };
}
