/** Scenario results: each check is recorded with its evidence; the scenario status is derived, never hand-set. */
import { ctl, writeEvidence } from './lib'

export type Status = 'PASS' | 'FAIL' | 'BLOCKED' | 'PENDING-B2'
export interface Check { name: string; ok: boolean | 'pending-b2' | 'blocked'; detail?: unknown }
export interface Scenario {
  id: string; title: string; findings: string; checks: Check[]; evidence: string[]; notes: string[]; status?: Status; error?: string
}

export const results: Scenario[] = []

export function scenario(id: string, title: string, findings: string): Scenario {
  const s: Scenario = { id, title, findings, checks: [], evidence: [], notes: [] }
  results.push(s)
  return s
}

export function check(s: Scenario, name: string, ok: Check['ok'], detail?: unknown): boolean {
  s.checks.push({ name, ok, ...(detail === undefined ? {} : { detail }) })
  console.log(`  [${ok === true ? 'ok' : ok === false ? 'FAIL' : ok}] ${s.id} · ${name}`)
  return ok === true
}

export function statusOf(s: Scenario): Status {
  if (s.error && !s.checks.some(c => c.ok === 'pending-b2')) return 'BLOCKED'
  if (s.checks.some(c => c.ok === false)) return 'FAIL'
  if (s.checks.some(c => c.ok === 'blocked')) return 'BLOCKED'
  if (s.checks.some(c => c.ok === 'pending-b2')) return 'PENDING-B2'
  return s.checks.length ? 'PASS' : 'BLOCKED'
}

/** Runs one scenario body; an exception marks it BLOCKED (with the error), never silently passed. */
export async function run(s: Scenario, body: (s: Scenario) => Promise<void>) {
  console.log(`\n== ${s.id} ${s.title}`)
  try {
    // Every scenario starts clean: no fault rules or canned transcripts left over from an earlier one.
    await ctl('/clear-rules', { method: 'POST' })
    await ctl('/scenario', { method: 'POST', body: s.id })
    await body(s)
  } catch (e) {
    s.error = e instanceof Error ? e.message : String(e)
    console.error(`  [error] ${s.id}: ${s.error}`)
  }
  s.status = statusOf(s)
  console.log(`== ${s.id}: ${s.status}`)
}

export function writeResults(meta: Record<string, unknown>) {
  return writeEvidence('results.json', `${JSON.stringify({ ...meta, scenarios: results }, null, 2)}\n`)
}
