/** Cosine similarity for normalized embeddings. */
export function cosine(a, b) {
  let sum = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i++) sum += a[i] * b[i];
  return sum;
}

/** Adds each hint to its closest qualifying group, or starts a new group. */
export class Clusterer {
  constructor(threshold = 0.36) { this.threshold = threshold; }

  add(groups, hint, embedding) {
    let best = null;
    let bestScore = this.threshold;
    for (const group of groups) {
      const score = cosine(group.centroid, embedding);
      if (score >= bestScore) {
        bestScore = score;
        best = group;
      }
    }

    if (!best) {
      best = {
        id: `g${groups.length + 1}`,
        centroid: new Float32Array(embedding),
        memberHintIds: [],
        distinctUsers: new Set(),
        level: 3,
        repText: hint.text,
      };
      groups.push(best);
    }

    const count = best.memberHintIds.length;
    for (let i = 0; i < embedding.length; i++) {
      best.centroid[i] = (best.centroid[i] * count + embedding[i]) / (count + 1);
    }
    best.memberHintIds.push(hint.id);
    best.distinctUsers.add(hint.userId);
    best.level = Math.min(best.level, hint.level ?? 0);
    if (count === 0) best.repText = hint.text;
    return best;
  }
}
