// A context change invalidates every outstanding request from the previous queue.
export const createSnapshotGuard = () => {
  let context, queueKey, generation = 0, sequence = 0, applied = 0, revision = -1;
  return {
    begin(nextContext) {
      if (context !== nextContext) { context = nextContext; generation++; applied = 0; revision = -1; queueKey = undefined; }
      return { generation, sequence: ++sequence };
    },
    accept(ticket, snapshot) {
      if (ticket.generation !== generation || ticket.sequence < applied) return false;
      // An automatically selected queue can change after completion or midnight.
      if (snapshot?.queueKey !== queueKey) { queueKey = snapshot?.queueKey; revision = -1; }
      const next = Number(snapshot?.queueRevision);
      if (Number.isFinite(next) && next < revision) return false;
      applied = ticket.sequence;
      if (Number.isFinite(next)) revision = next;
      return true;
    },
    isCurrent(ticket) { return ticket.generation === generation && ticket.sequence === sequence; },
    reset() { generation++; context = undefined; revision = -1; applied = 0; },
  };
};
