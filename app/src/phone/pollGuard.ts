/** Drops only out-of-order older responses: a response applies iff it is newer than the last applied one. */
export function createSeqGuard() {
  let issued = 0
  let lastApplied = 0
  return {
    next: () => ++issued,
    accept(n: number): boolean { if (n > lastApplied) { lastApplied = n; return true } return false },
  }
}
