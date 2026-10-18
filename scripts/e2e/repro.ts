/**
 * Re-run of the audit's queue repro (docs/audit-2026-10-18/repro/queue-failure.ts) against the fixed Outbox: the
 * real class with in-memory storage and five injected 429s. The audit saw the note dropped on the fifth; now it must
 * stay queued with its reason, then go once. (The API-level repros are scenarios S8 undo-attendance and S9 retry.)
 */
import { Outbox } from '../../app/src/core/outbox'
import { memoryKV } from '../../app/src/core/storage'
import { ApiError } from '../../app/src/core/api'
import { writeEvidence } from './lib'
import { check, run, scenario } from './results'

export async function repro429() {
  const s = scenario('R1', 'Audit repro queue-failure.ts re-run (five 429s)', 'F07')
  await run(s, async () => {
    const o = new Outbox(memoryKV())
    await o.enqueue({ sessionId: 'disposable', drillId: null, mode: 'note', audioB64: null, text: 'synthetic pending note' })
    const rounds: unknown[] = []
    for (let i = 0; i < 5; i++) {
      const r = await o.flush(async () => { throw new ApiError(429, 'rate limited', 2000) }, { force: true })
      rounds.push({ attempt: i + 1, remaining: r.remaining, failedCount: r.failedCount, retrying: [...r.retrying.values()] })
    }
    let sent = 0
    const last = await o.flush(async () => { sent++; return { utteranceId: 'u1', transcript: 'synthetic pending note', cardLines: [], coverage: { covered: 0, present: 0 }, nextStudent: null } as never }, { force: true })
    writeEvidence('logs/r1-queue-429.json', JSON.stringify({ rounds, afterSuccess: { remaining: last.remaining, sent } }, null, 2))
    s.evidence.push('docs/audit-2026-10-18/e2e/logs/r1-queue-429.json')
    check(s, 'still queued after each of five 429s (never dropped, never failed)', rounds.every(r => (r as { remaining: number; failedCount: number }).remaining === 1 && (r as { failedCount: number }).failedCount === 0), rounds)
    check(s, 'sent exactly once when the server recovers', sent === 1 && last.remaining === 0, { sent, remaining: last.remaining })
  })
}
