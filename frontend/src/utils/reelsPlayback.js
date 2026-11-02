// Only media position changes from visible, actively playing video qualify.
// Discard jumps, pauses and seeking rather than inventing time from a timer.
export function watchedDelta(previous, current, { active, hidden, paused, seeking }) {
  const delta = current - previous
  return active && !hidden && !paused && !seeking && Number.isFinite(delta) && delta > 0 && delta < 2 ? delta * 1000 : 0
}
