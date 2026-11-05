const norm = (word) => word.toLowerCase().replace(/[.,;:!?«»"]/g, '');

/** Word-level diff. Same-words keep the candidate spelling in `word` and the rewrite in `upgraded`. */
export function wordDiff(a, b) {
  const A = String(a ?? '').split(/\s+/).filter(Boolean);
  const B = String(b ?? '').split(/\s+/).filter(Boolean);
  const dp = Array.from({ length: A.length + 1 }, () => new Array(B.length + 1).fill(0));
  for (let i = A.length - 1; i >= 0; i--) {
    for (let j = B.length - 1; j >= 0; j--) {
      dp[i][j] = norm(A[i]) === norm(B[j]) ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const out = [];
  let i = 0;
  let j = 0;
  while (i < A.length && j < B.length) {
    if (norm(A[i]) === norm(B[j])) {
      out.push({ op: 'same', word: A[i], upgraded: B[j] });
      i += 1;
      j += 1;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      out.push({ op: 'removed', word: A[i] });
      i += 1;
    } else {
      out.push({ op: 'added', word: B[j] });
      j += 1;
    }
  }
  while (i < A.length) out.push({ op: 'removed', word: A[i++] });
  while (j < B.length) out.push({ op: 'added', word: B[j++] });
  return out;
}

export function attachConfidence(ops, words) {
  const queue = (words || [])
    .filter((word) => word && typeof word.text === 'string')
    .map((word) => ({ text: norm(word.text), confidence: word.confidence }));
  let index = 0;
  return ops.map((op) => {
    if (op.op === 'added') return op;
    const token = norm(op.word);
    if (index < queue.length && queue[index].text === token) {
      const confidence = queue[index].confidence;
      index += 1;
      return { ...op, confidence };
    }
    return op;
  });
}
