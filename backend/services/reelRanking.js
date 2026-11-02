// Educational-content ranking only. No symptoms, clinical records or patient embeddings.
export const RANKING_VERSION = 'hybrid-v1';
export function cosine(a, b) {
  if (!a?.length || a.length !== b?.length) return 0;
  let dot = 0, aa = 0, bb = 0;
  for (let i = 0; i < a.length; i++) { if (!Number.isFinite(a[i]) || !Number.isFinite(b[i])) return 0; dot += a[i] * b[i]; aa += a[i] ** 2; bb += b[i] ** 2; }
  return aa && bb ? Math.max(-1, Math.min(1, dot / Math.sqrt(aa * bb))) : 0;
}
export function interestVector(history, now = Date.now()) {
  let vector = null;
  for (const { reel, signal = {}, liked = false, saved = false } of history) {
    if (!reel?.embedding?.length) continue;
    const completion = Math.min(1, (signal.watchMs || 0) / Math.max(1, reel.duration * 1000));
    const recent = Math.exp(-Math.max(0, now - new Date(signal.lastSeenAt || now).getTime()) / (14 * 86400000));
    const weight = (completion * 2 + Number(liked) * 2 + Number(saved) * 3 - Math.min(2, signal.skips || 0)) * recent;
    if (!vector) vector = new Array(reel.embedding.length).fill(0);
    if (vector.length !== reel.embedding.length) continue;
    reel.embedding.forEach((value, i) => { vector[i] += value * weight; });
  }
  const norm = Math.sqrt(vector?.reduce((s, x) => s + x * x, 0) || 0);
  return norm ? vector.map(x => x / norm) : [];
}
export function rankReels(candidates, { vector = [], topics = [], followed = [], signals = new Map(), now = Date.now(), explore = false } = {}) {
  const interest = new Set(topics), doctors = new Set(followed.map(String));
  const scored = candidates.map(reel => {
    const signal = signals.get(String(reel._id)) || {}, c = reel.counts || {};
    const freshness = Math.exp(-Math.max(0, now - new Date(reel.publishedAt || now).getTime()) / (7 * 86400000));
    // Bayesian smoothing prevents a single self-like from dominating unseen content.
    const quality = Math.min(1, ((c.likes || 0) + 2 * (c.saves || 0) + .5 * (c.shares || 0) + 2) / ((c.views || 0) + 20));
    const affinity = vector.length ? Math.max(-1, cosine(vector, reel.embedding)) : 0;
    const topic = (reel.topics || []).filter(x => interest.has(x)).length / Math.max(1, interest.size);
    const seen = signal.lastSeenAt ? .25 : 0, skipped = Math.min(.8, (signal.skips || 0) * .2);
    const score = (explore ? .15 : .48) * affinity + .16 * topic + .13 * quality + .17 * freshness + .12 * Number(doctors.has(String(reel.doctorId))) - seen - skipped;
    return { reel, score, freshness };
  }).sort((a, b) => b.score - a.score || String(a.reel._id).localeCompare(String(b.reel._id)));
  // Greedy diversity penalty + every fifth position explores an unseen recent creator.
  const result = [], authorCounts = new Map(), topicCounts = new Map();
  while (scored.length) {
    let selected = 0, best = -Infinity;
    for (let i = 0; i < scored.length; i++) {
      const item = scored[i], author = String(item.reel.doctorId);
      const diversity = .18 * (authorCounts.get(author) || 0) + .03 * (item.reel.topics || []).reduce((s, t) => s + (topicCounts.get(t) || 0), 0);
      const exploration = result.length % 5 === 4 && !signals.has(String(item.reel._id)) ? .35 * item.freshness : 0;
      const score = item.score - diversity + exploration;
      if (score > best) { best = score; selected = i; }
    }
    const { reel } = scored.splice(selected, 1)[0]; result.push(reel);
    const author = String(reel.doctorId); authorCounts.set(author, (authorCounts.get(author) || 0) + 1);
    for (const topic of reel.topics || []) topicCounts.set(topic, (topicCounts.get(topic) || 0) + 1);
  }
  return result;
}
