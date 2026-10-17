# MatSide Plan, Part 2: Review, decks API, report cards, deploy (Tasks 10–13)

> Index and Global Constraints: [2026-10-17-matside.md](2026-10-17-matside.md). Builds on Part 1 (Tasks 1–9).

---

### Task 10: Review queue and email sending

**Files:**
- Create: `api/src/services/review.ts`
- Modify: `api/src/app.ts` (add review routes before `return app`)
- Test: `api/src/services/review.test.ts`

**Interfaces:**
- Consumes: `outbox`, `billingFlags`, `notes`, `deckDiffs`, `students` tables; `Deps.mail`; `withRun`; `ReviewItem` (shared).
- Produces:
  - **Functions:**
    - `listReview(db): Promise<ReviewItem[]>` (newest first)
    - `approveOutbox(deps, id, edits?: { subject?: string; body?: string }): Promise<{ ok: true } | { ok: false; error: string }>`
    - `skipOutbox(db, id)`
    - `approveAllOutbox(deps): Promise<{ sent: number; failed: number }>`
    - `handleBilling(db, id, extraNote?: string)`
    - `noteBilling(db, id, extraNote: string)`
  - **Routes:**
    - `GET /v1/review` → `ReviewItem[]`
    - `POST /v1/review/outbox/:id/approve` `{ subject?, body? }`
    - `POST /v1/review/outbox/:id/skip`
    - `POST /v1/review/outbox/approve-all`
    - `POST /v1/review/billing/:id/handle` `{ note? }`
    - `POST /v1/review/billing/:id/note` `{ note }`
    - `POST /v1/notes/:id/dismiss`

- [ ] **Step 1: Failing tests**

`api/src/services/review.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { eq } from 'drizzle-orm'
import { makeTestDb, makeDeps } from '../test/helpers'
import { listReview, approveOutbox, approveAllOutbox, handleBilling, skipOutbox } from './review'
import { students, outbox, billingFlags, notes, agentRuns } from '../db/schema'

async function world() {
  const db = await makeTestDb()
  const [s] = await db.insert(students).values({ name: 'Priya Rao', belt: 'orange', birthYear: 2018 }).returning()
  const [o1] = await db.insert(outbox).values({ kind: 'parent_email', studentId: s!.id, toEmail: 'anita@example.com', subject: 'Guard', body: 'Hi' }).returning()
  const [o2] = await db.insert(outbox).values({ kind: 'parent_email', studentId: s!.id, toEmail: 'anita@example.com', subject: 'Kata', body: 'Hi' }).returning()
  const [b] = await db.insert(billingFlags).values({ studentId: s!.id, urgency: 'high', note: 'owes for gear' }).returning()
  await db.insert(notes).values({ text: 'unsorted thing', heard: 'Mya' })
  return { db, o1: o1!.id, o2: o2!.id, b: b!.id }
}

describe('review', () => {
  it('lists email, billing and unassigned items', async () => {
    const { db } = await world()
    const items = await listReview(db)
    expect(items.map(i => i.kind).sort()).toEqual(['billing', 'parent_email', 'parent_email', 'unassigned_note'])
  })

  it('approve sends with edits, honoring DEMO_EMAIL_OVERRIDE, and logs a run', async () => {
    const { db, o1 } = await world()
    const deps = makeDeps(db)
    deps.env.demoEmailOverride = 'me@example.com'
    expect(await approveOutbox(deps, o1, { subject: 'Edited' })).toEqual({ ok: true })
    expect(deps.sent[0]).toMatchObject({ to: 'me@example.com', subject: 'Edited' })
    const [row] = await db.select().from(outbox).where(eq(outbox.id, o1))
    expect(row!.status).toBe('sent')
    expect((await db.select().from(agentRuns))[0]!.agent).toBe('mailer')
  })

  it('send failure keeps item pending with the error', async () => {
    const { db, o1 } = await world()
    const deps = makeDeps(db, { mail: { async send() { throw new Error('smtp down') } } })
    expect(await approveOutbox(deps, o1)).toEqual({ ok: false, error: 'smtp down' })
    const [row] = await db.select().from(outbox).where(eq(outbox.id, o1))
    expect(row).toMatchObject({ status: 'pending_review', error: 'smtp down' })
  })

  it('approve-all, skip, and handle billing', async () => {
    const { db, o1, o2, b } = await world()
    const deps = makeDeps(db)
    await skipOutbox(db, o2)
    expect(await approveAllOutbox(deps)).toEqual({ sent: 1, failed: 0 })
    await handleBilling(db, b, 'paid in cash')
    const [bill] = await db.select().from(billingFlags).where(eq(billingFlags.id, b))
    expect(bill).toMatchObject({ status: 'handled' })
    expect(bill!.note).toContain('paid in cash')
    expect((await listReview(db)).map(i => i.kind)).toEqual(['unassigned_note'])
    void o1
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `npm test -w api -- review`
Expected: FAIL.

- [ ] **Step 3: Implement `review.ts`**

`api/src/services/review.ts`:
```ts
import { and, desc, eq, isNull } from 'drizzle-orm'
import type { ReviewItem } from '@matside/shared'
import type { Db } from '../db/client'
import type { Deps } from '../deps'
import { billingFlags, deckDiffs, notes, outbox, students } from '../db/schema'
import { withRun } from '../agents/runs'

const iso = (d: Date) => d.toISOString()
const first = (n: string | null) => (n ? n.split(' ')[0]! : 'Unknown')

export async function listReview(db: Db): Promise<ReviewItem[]> {
  const mail = await db.select({ o: outbox, name: students.name }).from(outbox).innerJoin(students, eq(students.id, outbox.studentId)).where(eq(outbox.status, 'pending_review'))
  const bills = await db.select({ b: billingFlags, name: students.name }).from(billingFlags).leftJoin(students, eq(students.id, billingFlags.studentId)).where(eq(billingFlags.status, 'open'))
  const loose = await db.select().from(notes).where(isNull(notes.studentId)).orderBy(desc(notes.createdAt)).limit(20)
  const diffs = await db.select().from(deckDiffs).where(eq(deckDiffs.status, 'pending'))
  const items: ReviewItem[] = [
    ...mail.map(({ o, name }) => ({ kind: o.kind, id: o.id, studentName: first(name), to: o.toEmail, subject: o.subject, body: o.body, createdAt: iso(o.createdAt) }) as ReviewItem),
    ...bills.map(({ b, name }) => ({ kind: 'billing' as const, id: b.id, studentName: first(name), urgency: b.urgency, note: b.note, amount: b.amount, createdAt: iso(b.createdAt) })),
    ...loose.map(n => ({ kind: 'unassigned_note' as const, id: n.id, heard: n.heard, text: n.text, createdAt: iso(n.createdAt) })),
    ...diffs.map(d => ({ kind: 'deck_diff' as const, id: d.id, deckId: d.deckId, requestText: d.requestText, diff: d.diff, createdAt: iso(d.createdAt) })),
  ]
  return items.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}

export async function approveOutbox(deps: Deps, id: string, edits: { subject?: string; body?: string } = {}): Promise<{ ok: true } | { ok: false; error: string }> {
  const { db } = deps
  const [row] = await db.select().from(outbox).where(and(eq(outbox.id, id), eq(outbox.status, 'pending_review')))
  if (!row) return { ok: false, error: 'not pending' }
  const subject = edits.subject ?? row.subject
  const body = edits.body ?? row.body
  const to = deps.env.demoEmailOverride ?? row.toEmail
  try {
    await deps.mail.send({ to, subject, text: body })
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e)
    await db.update(outbox).set({ subject, body, error }).where(eq(outbox.id, id))
    return { ok: false, error }
  }
  await db.update(outbox).set({ subject, body, status: 'sent', sentAt: deps.now(), error: null }).where(eq(outbox.id, id))
  await withRun(deps, { agent: 'mailer', trigger: 'approved', sessionId: row.sessionId }, async () => ({
    result: true, summary: `Sent "${subject}" to ${row.toEmail}${deps.env.demoEmailOverride ? ' (demo inbox)' : ''}`, reason: 'instructor approved',
  }))
  return { ok: true }
}

export async function skipOutbox(db: Db, id: string) {
  await db.update(outbox).set({ status: 'skipped' }).where(eq(outbox.id, id))
}

export async function approveAllOutbox(deps: Deps): Promise<{ sent: number; failed: number }> {
  const pending = await deps.db.select({ id: outbox.id }).from(outbox).where(eq(outbox.status, 'pending_review'))
  let sent = 0, failed = 0
  for (const p of pending) ((await approveOutbox(deps, p.id)).ok ? sent++ : failed++)
  return { sent, failed }
}

export async function noteBilling(db: Db, id: string, extraNote: string) {
  const [b] = await db.select().from(billingFlags).where(eq(billingFlags.id, id))
  if (!b) throw new Error('billing flag not found')
  await db.update(billingFlags).set({ note: `${b.note}\n— ${extraNote}` }).where(eq(billingFlags.id, id))
}

export async function handleBilling(db: Db, id: string, extraNote?: string) {
  if (extraNote) await noteBilling(db, id, extraNote)
  await db.update(billingFlags).set({ status: 'handled' }).where(eq(billingFlags.id, id))
}
```

- [ ] **Step 4: Add routes**

Add to `api/src/app.ts`:
- Imports (top):
  ```ts
  import { listReview, approveOutbox, skipOutbox, approveAllOutbox, handleBilling, noteBilling } from './services/review'
  ```
- Routes, before `return app`:
  ```ts
  app.get('/v1/review', async c => c.json(await listReview(db)))
  app.post('/v1/review/outbox/approve-all', async c => c.json(await approveAllOutbox(deps)))
  app.post('/v1/review/outbox/:id/approve', async c => {
    const edits = await json(c.req.raw, z.object({ subject: z.string().min(1).max(120).optional(), body: z.string().min(1).max(5000).optional() }))
    const r = await approveOutbox(deps, c.req.param('id'), edits)
    return r.ok ? c.json(r) : c.json(r, 502)
  })
  app.post('/v1/review/outbox/:id/skip', async c => { await skipOutbox(db, c.req.param('id')); return c.json({ ok: true }) })
  app.post('/v1/review/billing/:id/handle', async c => {
    const { note } = await json(c.req.raw, z.object({ note: z.string().max(500).optional() }))
    await handleBilling(db, c.req.param('id'), note)
    return c.json({ ok: true })
  })
  app.post('/v1/review/billing/:id/note', async c => {
    const { note } = await json(c.req.raw, z.object({ note: z.string().min(1).max(500) }))
    await noteBilling(db, c.req.param('id'), note)
    return c.json({ ok: true })
  })
  app.post('/v1/notes/:id/dismiss', async c => { await db.delete(notes).where(eq(notes.id, c.req.param('id'))); return c.json({ ok: true }) })
  ```

The `approve-all` route must be registered **before** `:id/approve`, as shown.

- [ ] **Step 5: Run tests**

Run: `npm test -w api`
Expected: all PASS.

- [ ] **Step 6: Commit**

```bash
git add api/src
git commit -m "feat(api): review queue with approve/skip/send and billing flag handling

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 11: Decks API, alternatives, nightly planner job

**Files:**
- Modify: `shared/src/contracts.ts` (add `SuggestResponse`, `DeckPatch`, `Alternatives`)
- Modify: `api/src/agents/planner.ts` (add `alternativesFor`, `undoDiff`)
- Modify: `api/src/services/decks.ts` (add `patchDeck`)
- Modify: `api/src/app.ts` (deck routes + `/jobs/plan`)
- Test: `api/src/services/decks.test.ts`

**Interfaces:**
- Consumes: Task 6 planner, Task 4 `totalMinutes`.
- Produces:
  - **Shared contracts:**
    - `SuggestResponse = { diffId, diff: DeckDiff, totalBefore: number, totalAfter: number }`
    - `DeckPatch = { drills: (DrillDraft & { id: string | null })[] }`
    - `Alternatives = { alternatives: DrillDraft[] }`
  - **Functions:**
    - `patchDeck(db, deckId, patch: DeckPatch): Promise<Deck>`
    - `alternativesFor(deps, drillId): Promise<DrillDraft[]>`
    - `undoDiff(db, diffId)`
  - **Routes:**
    - `GET /v1/decks/:id` → `Deck`
    - `PATCH /v1/decks/:id` `DeckPatch` → `Deck`
    - `POST /v1/decks/:id/suggest` `{ text }` → `SuggestResponse`
    - `POST /v1/diffs/:id/accept` `{ remember: boolean }` → `Deck`
    - `POST /v1/diffs/:id/undo` → `{ ok }`
    - `POST /v1/drills/:id/alternatives` → `Alternatives`
    - `GET /jobs/plan` (header `Authorization: Bearer ${CRON_SECRET}`) → `{ drafted: number }`

- [ ] **Step 1: Add the contracts**

Append to `shared/src/contracts.ts`:
```ts
export const SuggestResponse = z.object({ diffId: z.string(), diff: DeckDiff, totalBefore: z.number().int(), totalAfter: z.number().int() })
export type SuggestResponse = z.infer<typeof SuggestResponse>

export const DeckPatch = z.object({ drills: z.array(DrillDraft.extend({ id: z.string().nullable() })).min(1).max(20) })
export type DeckPatch = z.infer<typeof DeckPatch>

export const Alternatives = z.object({ alternatives: z.array(DrillDraft).length(3) })
export type Alternatives = z.infer<typeof Alternatives>
```

- [ ] **Step 2: Failing tests**

`api/src/services/decks.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { makeTestDb, makeDeps, fakeLlm } from '../test/helpers'
import { patchDeck, getDeck } from './decks'
import { alternativesFor, undoDiff } from '../agents/planner'
import { classes, decks, drills, deckDiffs } from '../db/schema'
import { eq } from 'drizzle-orm'

const draft = (name: string) => ({ name, minutes: 5, kind: 'drill' as const, cues: [], focusStudentIds: [], rationale: '' })

describe('decks', () => {
  it('patchDeck reorders, edits, deletes and adds', async () => {
    const db = await makeTestDb()
    const [c] = await db.insert(classes).values({ instructorId: 'i', name: 'K', weekday: 2, startTime: '17:00' }).returning()
    const [d] = await db.insert(decks).values({ classId: c!.id, forDate: '2026-10-20' }).returning()
    const [a, b, x] = await db.insert(drills).values(['A', 'B', 'X'].map((n, i) => ({ ...draft(n), deckId: d!.id, position: i + 1 }))).returning()
    const deck = await patchDeck(db, d!.id, { drills: [{ ...draft('B2'), id: b!.id }, { ...draft('New'), id: null }, { ...draft('A'), id: a!.id }] })
    expect(deck.drills.map(r => [r.name, r.position])).toEqual([['B2', 1], ['New', 2], ['A', 3]])
    expect((await db.select().from(drills).where(eq(drills.id, x!.id)))).toHaveLength(0)
  })

  it('alternatives come from the planner; undo marks the diff', async () => {
    const db = await makeTestDb()
    const [c] = await db.insert(classes).values({ instructorId: 'i', name: 'K', weekday: 2, startTime: '17:00' }).returning()
    const [d] = await db.insert(decks).values({ classId: c!.id, forDate: '2026-10-20' }).returning()
    const [a] = await db.insert(drills).values({ ...draft('Jab'), deckId: d!.id, position: 1 }).returning()
    const deps = makeDeps(db, { llm: fakeLlm(() => ({ alternatives: [draft('Freeze'), draft('Pads'), draft('Mirror')] })) })
    expect((await alternativesFor(deps, a!.id)).map(x => x.name)).toEqual(['Freeze', 'Pads', 'Mirror'])
    const [diff] = await db.insert(deckDiffs).values({ deckId: d!.id, requestText: 'x', diff: { added: [], changed: [], removed: [], rememberSuggestion: null } }).returning()
    await undoDiff(db, diff!.id)
    expect((await db.select().from(deckDiffs))[0]!.status).toBe('undone')
    expect((await getDeck(db, d!.id)).drills).toHaveLength(1)
  })
})
```

- [ ] **Step 3: Run to verify failure**

Run: `npm test -w api -- decks`
Expected: FAIL.

- [ ] **Step 4: Implement**

Append to `api/src/services/decks.ts`:
```ts
import { inArray } from 'drizzle-orm'
import type { DeckPatch } from '@matside/shared'

export async function patchDeck(db: Db, deckId: string, patch: DeckPatch): Promise<Deck> {
  const current = await getDeck(db, deckId)
  const keep = new Set(patch.drills.flatMap(d => (d.id ? [d.id] : [])))
  const unknown = [...keep].filter(id => !current.drills.some(d => d.id === id))
  if (unknown.length) throw new Error(`drills not in deck: ${unknown.join(',')}`)
  const del = current.drills.filter(d => !keep.has(d.id)).map(d => d.id)
  if (del.length) await db.delete(drills).where(inArray(drills.id, del))
  for (const [i, d] of patch.drills.entries()) {
    const { id, ...fields } = d
    if (id) await db.update(drills).set({ ...fields, position: i + 1 }).where(eq(drills.id, id))
    else await db.insert(drills).values({ ...fields, deckId, position: i + 1 })
  }
  return getDeck(db, deckId)
}
```
Merge this `inArray` import into the existing `drizzle-orm` import line at the top of the file instead of adding a second import.

Append to `api/src/agents/planner.ts`:
```ts
import { Alternatives, type DrillDraft as DrillDraftT } from '@matside/shared'
import type { Db } from '../db/client'

export async function alternativesFor(deps: Deps, drillId: string): Promise<DrillDraftT[]> {
  const [d] = await deps.db.select().from(drills).where(eq(drills.id, drillId))
  if (!d) throw new Error('drill not found')
  const deck = await getDeck(deps.db, d.deckId)
  const ctx = await planningContext(deps, deck.classId, deck.forDate)
  const r = await withRun(deps, { agent: 'planner', trigger: 'alternatives', sessionId: null }, async () => {
    const out = await deps.llm.object({
      name: 'planner.alternatives', instructions: PLANNER_INSTRUCTIONS, schema: Alternatives,
      prompt: `Give exactly 3 alternative drills that serve the same purpose as "${d.name}" (${d.minutes}m, ${d.kind}; why: ${d.rationale}). Vary format: one game, one partner drill, one solo/line drill. Keep the same focusStudentIds: ${JSON.stringify(d.focusStudentIds)}.\n${ctx.text}`,
    })
    return { result: out.alternatives, summary: `3 alternatives for "${d.name}"`, reason: 'instructor asked to swap' }
  })
  if (!r) throw new Error('planner unavailable')
  return r
}

export async function undoDiff(db: Db, diffId: string) {
  await db.update(deckDiffs).set({ status: 'undone' }).where(and(eq(deckDiffs.id, diffId), eq(deckDiffs.status, 'pending')))
}
```
Merge the `Alternatives` import into the existing `@matside/shared` import line, and confirm `Db` is imported once.

- [ ] **Step 5: Routes + nightly job**

Add to `api/src/app.ts`:
- Imports:
  ```ts
  import { DeckPatch } from '@matside/shared'
  import { getDeck, patchDeck } from './services/decks'
  import { acceptDiff, alternativesFor, nextDeckFor, suggestDiff, undoDiff } from './agents/planner'
  import { applyDiff, totalMinutes } from './logic/deckDiff'
  import { localDate } from './logic/dates'
  ```
- Routes:
  ```ts
  const cronAuth = (c: { req: { header(n: string): string | undefined } }) => {
    if (c.req.header('authorization') !== `Bearer ${deps.env.cronSecret}`) throw new HTTPException(401, { message: 'cron only' })
  }

  app.get('/jobs/plan', async c => {
    cronAuth(c)
    const today = localDate(deps.now(), deps.env.timeZone)
    let drafted = 0
    for (const cl of await db.select().from(classes)) if (await nextDeckFor(deps, cl.id, today)) drafted++
    return c.json({ drafted })
  })

  app.get('/v1/decks/:id', async c => c.json(await getDeck(db, c.req.param('id'))))
  app.patch('/v1/decks/:id', async c => c.json(await patchDeck(db, c.req.param('id'), await json(c.req.raw, DeckPatch))))
  app.post('/v1/decks/:id/suggest', async c => {
    const { text } = await json(c.req.raw, z.object({ text: z.string().min(2).max(500) }))
    const deck = await getDeck(db, c.req.param('id'))
    const s = await suggestDiff(deps, deck.id, text)
    if (!s) throw new HTTPException(502, { message: 'planner unavailable' })
    return c.json({ diffId: s.diffId, diff: s.diff, totalBefore: totalMinutes(deck.drills), totalAfter: totalMinutes(applyDiff(deck.drills, s.diff)) })
  })
  app.post('/v1/diffs/:id/accept', async c => {
    const { remember } = await json(c.req.raw, z.object({ remember: z.boolean() }))
    return c.json(await acceptDiff(deps, c.req.param('id'), { remember }))
  })
  app.post('/v1/diffs/:id/undo', async c => { await undoDiff(db, c.req.param('id')); return c.json({ ok: true }) })
  app.post('/v1/drills/:id/alternatives', async c => c.json({ alternatives: await alternativesFor(deps, c.req.param('id')) }))
  ```

- [ ] **Step 6: Run tests + typecheck**

Run: `npm test -w api && npm run typecheck -w api && npm test -w shared`
Expected: all PASS.

- [ ] **Step 7: Commit**

```bash
git add shared api
git commit -m "feat(api): deck editing, planner suggest/accept/undo, alternatives, nightly plan job

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 12: Report card agent, students, agents feed

**Files:**
- Create: `api/src/agents/reportCard.ts`, `api/src/services/students.ts`
- Modify: `api/src/app.ts`
- Test: `api/src/agents/reportCard.test.ts`

**Interfaces:**
- Consumes: `ReportCardContent`, `StudentDetail`, `AgentRunView`, `RosterStudent` (shared); `withRun`; `localDate`.
- Produces:
  - **Functions:**
    - `draftReportCard(deps, studentId, month: string): Promise<string | null>` (outbox id; idempotent per student+month)
    - `runReportCards(deps, studentIds?: string[]): Promise<{ drafted: number }>` (concurrency 4)
    - `listStudents(db): Promise<RosterStudent[]>`
    - `getStudentDetail(deps, id): Promise<StudentDetail>`
    - `agentFeed(db, since: Date | null): Promise<AgentRunView[]>`
  - **Routes:**
    - `GET /v1/students` → `RosterStudent[]`
    - `GET /v1/students/:id` → `StudentDetail`
    - `GET /v1/agents/feed?since=ISO` → `AgentRunView[]`
    - `POST /v1/report-cards/run` `{ studentIds?: string[] }` → `{ started: number }` (runs via `defer`)
    - `GET /jobs/report-cards` (cron) → `{ drafted }`

- [ ] **Step 1: Failing tests**

`api/src/agents/reportCard.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { makeTestDb, makeDeps, fakeLlm } from '../test/helpers'
import { draftReportCard } from './reportCard'
import { getStudentDetail, agentFeed } from '../services/students'
import { students, guardians, notes, outbox, reportCards } from '../db/schema'

const content = { strengths: ['Energy'], workingOn: ['Guard'], coachNotes: [{ date: '2026-10-14', drill: 'Jab drill', quote: 'guard drops' }], attendance: '9 of 10 classes', nextGoal: 'Orange stripe test' }

describe('report cards', () => {
  it('drafts once per month, exposes it on student detail, and logs to the feed', async () => {
    const db = await makeTestDb()
    const [s] = await db.insert(students).values({ name: 'Priya Rao', belt: 'orange', birthYear: 2018 }).returning()
    await db.insert(guardians).values({ studentId: s!.id, name: 'Anita', email: 'anita@example.com' })
    await db.insert(notes).values({ studentId: s!.id, text: 'guard drops', tags: ['guard'] })
    const deps = makeDeps(db, { llm: fakeLlm(() => ({ content, subject: "Priya's October report card", body: 'Hi Anita…' })) })
    const id1 = await draftReportCard(deps, s!.id, '2026-10')
    const id2 = await draftReportCard(deps, s!.id, '2026-10')
    expect(id1).toBe(id2)
    expect(await db.select().from(reportCards)).toHaveLength(1)
    expect((await db.select().from(outbox))[0]).toMatchObject({ kind: 'report_card', status: 'pending_review' })
    const detail = await getStudentDetail(deps, s!.id)
    expect(detail.reportCard?.content.nextGoal).toBe('Orange stripe test')
    expect(detail.age).toBe(2026 - 2018)
    expect((await agentFeed(db, null))[0]!.agent).toBe('report_card')
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `npm test -w api -- reportCard`
Expected: FAIL.

- [ ] **Step 3: Implement**

`api/src/agents/reportCard.ts`:
```ts
import { and, count, desc, eq, gte } from 'drizzle-orm'
import { z } from 'zod'
import { ReportCardContent } from '@matside/shared'
import type { Deps } from '../deps'
import { attendance, drills, guardians, issues, notes, outbox, reportCards, sessions, students } from '../db/schema'
import { withRun } from './runs'

export const REPORT_CARD_INSTRUCTIONS = `You write a monthly progress report card for a child in a martial arts class, for their parent.
- Ground every statement in the coach notes provided. Quote 2-4 notes in coachNotes with their date and drill.
- strengths: up to 3 short phrases. workingOn: up to 3 short phrases. nextGoal: one concrete goal for next month.
- body: a 120-180 word warm email that summarizes the card in plain text. Sign as the coach. No medical/financial advice, never mention other children.`

const Out = z.object({ content: ReportCardContent, subject: z.string().min(3).max(80), body: z.string().min(60) })
const DAY = 86_400_000

export async function draftReportCard(deps: Deps, studentId: string, month: string): Promise<string | null> {
  const { db } = deps
  const [existing] = await db.select().from(reportCards).where(and(eq(reportCards.studentId, studentId), eq(reportCards.month, month)))
  if (existing) return existing.outboxId
  return withRun(deps, { agent: 'report_card', trigger: 'monthly', sessionId: null }, async () => {
    const [s] = await db.select().from(students).where(eq(students.id, studentId))
    const [g] = await db.select().from(guardians).where(eq(guardians.studentId, studentId))
    if (!s || !g) throw new Error(`no student/guardian ${studentId}`)
    const since = new Date(deps.now().getTime() - 30 * DAY)
    const recent = await db.select({ text: notes.text, at: notes.createdAt, drill: drills.name }).from(notes).leftJoin(drills, eq(drills.id, notes.drillId))
      .where(and(eq(notes.studentId, studentId), gte(notes.createdAt, since))).orderBy(desc(notes.createdAt)).limit(15)
    const [present] = await db.select({ n: count() }).from(attendance).innerJoin(sessions, eq(sessions.id, attendance.sessionId))
      .where(and(eq(attendance.studentId, studentId), eq(attendance.status, 'present'), gte(sessions.startedAt, since)))
    const open = await db.select({ tag: issues.tag }).from(issues).where(and(eq(issues.studentId, studentId), eq(issues.status, 'open')))
    const firstName = s.name.split(' ')[0]!
    const prompt = [
      `Coach: ${deps.env.instructorName}`, `Student: ${firstName}, ${s.belt} belt`, `Parent: ${g.name}`, `Month: ${month}`,
      `Classes attended in the last 30 days (recorded): ${present?.n ?? 0}`, `Open focus areas: ${open.map(o => o.tag).join(', ') || 'none'}`,
      'Coach notes:', ...recent.map(r => `- ${r.at.toISOString().slice(0, 10)} [${r.drill ?? 'class'}] ${r.text}`),
    ].join('\n')
    const out = await deps.llm.object({ name: 'report_card', instructions: REPORT_CARD_INSTRUCTIONS, prompt, schema: Out })
    const [o] = await db.insert(outbox).values({ kind: 'report_card', studentId, toEmail: g.email, subject: out.subject, body: out.body }).returning()
    await db.insert(reportCards).values({ studentId, month, content: out.content, outboxId: o!.id })
    return { result: o!.id, summary: `Drafted ${month} report card for ${firstName}`, reason: `${recent.length} notes, ${present?.n ?? 0} classes`, output: out.content }
  })
}

export async function runReportCards(deps: Deps, studentIds?: string[]): Promise<{ drafted: number }> {
  const month = new Intl.DateTimeFormat('en-CA', { timeZone: deps.env.timeZone, year: 'numeric', month: '2-digit' }).format(deps.now())
  const ids = studentIds ?? (await deps.db.select({ id: students.id }).from(students)).map(r => r.id)
  let drafted = 0
  for (let i = 0; i < ids.length; i += 4) {
    const batch = await Promise.all(ids.slice(i, i + 4).map(id => draftReportCard(deps, id, month)))
    drafted += batch.filter(Boolean).length
  }
  return { drafted }
}
```

`api/src/services/students.ts`:
```ts
import { and, asc, count, desc, eq, gt } from 'drizzle-orm'
import type { AgentRunView, RosterStudent, StudentDetail } from '@matside/shared'
import type { Db } from '../db/client'
import type { Deps } from '../deps'
import { agentRuns, attendance, drills, issues, notes, outbox, reportCards, students } from '../db/schema'

export async function listStudents(db: Db): Promise<RosterStudent[]> {
  return db.select({ id: students.id, name: students.name, nickname: students.nickname, belt: students.belt }).from(students).orderBy(asc(students.name))
}

export async function getStudentDetail(deps: Deps, id: string): Promise<StudentDetail> {
  const { db } = deps
  const [s] = await db.select().from(students).where(eq(students.id, id))
  if (!s) throw new Error('student not found')
  const [cc] = await db.select({ n: count() }).from(attendance).where(and(eq(attendance.studentId, id), eq(attendance.status, 'present')))
  const iss = await db.select().from(issues).where(eq(issues.studentId, id))
  const ns = await db.select({ at: notes.createdAt, text: notes.text, drill: drills.name }).from(notes).leftJoin(drills, eq(drills.id, notes.drillId))
    .where(eq(notes.studentId, id)).orderBy(desc(notes.createdAt)).limit(20)
  const [rc] = await db.select({ r: reportCards, status: outbox.status }).from(reportCards).innerJoin(outbox, eq(outbox.id, reportCards.outboxId))
    .where(eq(reportCards.studentId, id)).orderBy(desc(reportCards.month)).limit(1)
  return {
    id: s.id, name: s.name, belt: s.belt,
    age: Number(new Intl.DateTimeFormat('en-CA', { timeZone: deps.env.timeZone, year: 'numeric' }).format(deps.now())) - s.birthYear,
    classCount: cc?.n ?? 0,
    issues: iss.map(i => ({ tag: i.tag, status: i.status })),
    notes: ns.map(n => ({ date: n.at.toISOString().slice(0, 10), drillName: n.drill, text: n.text })),
    reportCard: rc ? { id: rc.r.id, month: rc.r.month, content: rc.r.content, outboxId: rc.r.outboxId, status: rc.status } : null,
  }
}

export async function agentFeed(db: Db, since: Date | null): Promise<AgentRunView[]> {
  const rows = await db.select().from(agentRuns).where(since ? gt(agentRuns.createdAt, since) : undefined).orderBy(desc(agentRuns.createdAt)).limit(50)
  return rows.map(r => ({ id: r.id, agent: r.agent, summary: r.summary, reason: r.reason, status: r.status, createdAt: r.createdAt.toISOString() }))
}
```

- [ ] **Step 4: Routes**

Add to `api/src/app.ts`:
- Imports:
  ```ts
  import { runReportCards } from './agents/reportCard'
  import { agentFeed, getStudentDetail, listStudents } from './services/students'
  ```
- Routes:
  ```ts
  app.get('/jobs/report-cards', async c => { cronAuth(c); return c.json(await runReportCards(deps)) })
  app.get('/v1/students', async c => c.json(await listStudents(db)))
  app.get('/v1/students/:id', async c => c.json(await getStudentDetail(deps, c.req.param('id'))))
  app.get('/v1/agents/feed', async c => {
    const since = c.req.query('since')
    const d = since ? new Date(since) : null
    if (d && Number.isNaN(d.getTime())) throw new HTTPException(400, { message: 'bad since' })
    return c.json(await agentFeed(db, d))
  })
  app.post('/v1/report-cards/run', async c => {
    const { studentIds } = await json(c.req.raw, z.object({ studentIds: z.array(z.string()).max(50).optional() }))
    deps.defer(runReportCards(deps, studentIds))
    return c.json({ started: studentIds?.length ?? (await listStudents(db)).length })
  })
  ```

- [ ] **Step 5: Run tests**

Run: `npm test -w api && npm run typecheck -w api`
Expected: all PASS.

- [ ] **Step 6: Commit**

```bash
git add api/src
git commit -m "feat(api): report card agent, student detail, agent activity feed

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 13: Deploy (Vercel + Neon + env + crons) and smoke test

**Files:**
- Create: `api/src/prod.ts`, `api/src/index.ts`, `api/src/dev-server.ts`, `api/vercel.json`, `api/.env.example`, `api/scripts/smoke.sh`

**Interfaces:**
- Consumes: `createApp`, `gatewayLlm`, `Deps`.
- Produces:
  - `prodDeps(): Deps` (reads env; throws if required vars are missing).
  - Deployed API URL, saved as `API_URL` and used in Part 3.

- [ ] **Step 1: Production deps + entry**

`api/src/prod.ts`:
```ts
import { neon } from '@neondatabase/serverless'
import { drizzle } from 'drizzle-orm/neon-http'
import OpenAI, { toFile } from 'openai'
import { Resend } from 'resend'
import { waitUntil } from '@vercel/functions'
import * as schema from './db/schema'
import type { Db } from './db/client'
import type { Deps } from './deps'
import { gatewayLlm } from './agents/llm'

const need = (k: string) => {
  const v = process.env[k]
  if (!v) throw new Error(`missing env ${k}`)
  return v
}

export function prodDeps(): Deps {
  const db = drizzle({ client: neon(need('DATABASE_URL')), schema }) as unknown as Db
  const openai = new OpenAI({ apiKey: need('OPENAI_API_KEY') })
  const resend = new Resend(need('RESEND_API_KEY'))
  const from = need('MAIL_FROM')
  return {
    db,
    llm: gatewayLlm(),
    stt: {
      async transcribe(wav, hints) {
        const r = await openai.audio.transcriptions.create({
          file: await toFile(Buffer.from(wav), 'note.wav', { type: 'audio/wav' }),
          model: process.env.STT_MODEL ?? 'gpt-4o-transcribe',
          prompt: `A kids' martial arts instructor speaking during class. Student names: ${hints.join(', ')}.`,
        })
        return r.text
      },
    },
    mail: {
      async send(m) {
        const { data, error } = await resend.emails.send({ from, to: m.to, subject: m.subject, text: m.text })
        if (error || !data) throw new Error(error?.message ?? 'send failed')
        return { id: data.id }
      },
    },
    now: () => new Date(),
    defer: p => waitUntil(p.catch(e => console.error('[defer]', e))),
    env: {
      pairingCode: need('PAIRING_CODE'),
      cronSecret: need('CRON_SECRET'),
      allowedOrigins: need('ALLOWED_ORIGINS').split(',').map(s => s.trim()),
      demoEmailOverride: process.env.DEMO_EMAIL_OVERRIDE || null,
      instructorName: process.env.INSTRUCTOR_NAME ?? 'Coach',
      timeZone: process.env.TZ_NAME ?? 'America/Los_Angeles',
    },
  }
}
```

`api/src/index.ts`:
```ts
import { createApp } from './app'
import { prodDeps } from './prod'

const app = createApp(prodDeps())
export default app
```

`api/src/dev-server.ts`:
```ts
import { serve } from '@hono/node-server'
import { createApp } from './app'
import { prodDeps } from './prod'

const deps = { ...prodDeps(), defer: (p: Promise<unknown>) => { p.catch(e => console.error('[defer]', e)) } }
serve({ fetch: createApp(deps).fetch, port: 8787, hostname: '0.0.0.0' }, i => console.log(`api on http://0.0.0.0:${i.port}`))
```

`api/vercel.json`:
```json
{
  "crons": [
    { "path": "/jobs/plan", "schedule": "0 9 * * *" },
    { "path": "/jobs/report-cards", "schedule": "0 13 1 * *" }
  ]
}
```

`api/.env.example`:
```
DATABASE_URL=
AI_GATEWAY_API_KEY=
OPENAI_API_KEY=
RESEND_API_KEY=
MAIL_FROM=MatSide <onboarding@resend.dev>
PAIRING_CODE=
CRON_SECRET=
ALLOWED_ORIGINS=*
DEMO_EMAIL_OVERRIDE=
INSTRUCTOR_NAME=Coach Galen
TZ_NAME=America/Los_Angeles
STT_MODEL=gpt-4o-transcribe
SEED_GUARDIAN_EMAILS=
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck -w api`
Expected: clean.

- [ ] **Step 3: Create the Vercel project and database (needs the user)**

```bash
cd ~/lahacks
npm i -g vercel@latest
vercel link --yes --project matside-api
```
In the Vercel dashboard for `matside-api`:
- Settings → General → Root Directory = `api`. Keep "Include files outside the root directory" **enabled**, because `@matside/shared` lives in `../shared`.
- Then install a Postgres database from the Marketplace:
  ```bash
  vercel integration add neon
  ```
  (load the `vercel:marketplace` skill first; connect the store to `matside-api` for all environments). This sets `DATABASE_URL`.

- [ ] **Step 4: Environment variables (the user supplies the secret values; never paste them in chat)**

Ask the user to run each of these and paste the value at the prompt:
```bash
vercel env add OPENAI_API_KEY production
vercel env add RESEND_API_KEY production
vercel env add AI_GATEWAY_API_KEY production
vercel env add DEMO_EMAIL_OVERRIDE production
```
Then set the non-secret values (generate the secrets locally):
```bash
printf 'MatSide <onboarding@resend.dev>' | vercel env add MAIL_FROM production
openssl rand -hex 3 | vercel env add PAIRING_CODE production
openssl rand -hex 24 | vercel env add CRON_SECRET production
printf '*' | vercel env add ALLOWED_ORIGINS production
printf 'Coach Galen' | vercel env add INSTRUCTOR_NAME production
vercel env pull api/.env.local --environment=production
```
`ALLOWED_ORIGINS=*` is temporary. Task 20 Step 3 narrows it to the WebView origin. Resend's `onboarding@resend.dev` can only send to the account owner's address, so set `DEMO_EMAIL_OVERRIDE` to that address.

- [ ] **Step 5: Migrate and seed Neon**

```bash
cd ~/lahacks/api
set -a; . ./.env.local; set +a
npx drizzle-kit migrate
SEED_GUARDIAN_EMAILS="$DEMO_EMAIL_OVERRIDE" npm run seed
```
Expected: `seeded { instructorId: …, classIds: …, priyaId: … }`.

- [ ] **Step 6: Run the router evals against the real model**

Run: `npm run eval -w api`
Expected: `≥13/15`. If below, tune `ROUTER_INSTRUCTIONS` in `api/src/agents/router.ts`, re-run `npm test -w api` (unit tests still pass), and commit.

- [ ] **Step 7: Deploy and smoke test**

```bash
cd ~/lahacks && vercel deploy --prod
```
Save the production URL as `API_URL`.

`api/scripts/smoke.sh`:
```bash
#!/usr/bin/env bash
set -euo pipefail
: "${API_URL:?}" "${PAIRING_CODE:?}"
curl -fsS "$API_URL/health"; echo
TOKEN=$(curl -fsS -X POST "$API_URL/pair" -H 'Content-Type: application/json' -d "{\"code\":\"$PAIRING_CODE\"}" | node -pe 'JSON.parse(require("fs").readFileSync(0)).token')
H="Authorization: Bearer $TOKEN"
TODAY=$(curl -fsS "$API_URL/v1/today" -H "$H")
echo "$TODAY" | node -pe 'const t=JSON.parse(require("fs").readFileSync(0)); `${t.className} · ${t.theme} · ${t.deck.drills.length} drills`'
CLASS=$(echo "$TODAY" | node -pe 'JSON.parse(require("fs").readFileSync(0)).classId')
SID=$(curl -fsS -X POST "$API_URL/v1/sessions" -H "$H" -H 'Content-Type: application/json' -d "{\"classId\":\"$CLASS\"}" | node -pe 'JSON.parse(require("fs").readFileSync(0)).sessionId')
time curl -fsS -X POST "$API_URL/v1/utterance" -H "$H" -F sessionId="$SID" -F mode=note -F text="Priya, guard drops on the jab again, great energy though"; echo
curl -fsS "$API_URL/v1/agents/feed" -H "$H" | node -pe 'JSON.parse(require("fs").readFileSync(0)).slice(0,5).map(r=>r.agent+": "+r.summary).join("\n")'
```
Run: `chmod +x api/scripts/smoke.sh && API_URL=… PAIRING_CODE=… api/scripts/smoke.sh`

Expected:
- the health JSON;
- the class/theme/drills line;
- an utterance response whose `cardLines[0]` is `✓ Priya · guard (3rd time)`, in **≤3 s real time**;
- a feed that shows `router`, `progress`, and within a few seconds `parent_email` and `planner`.

**If the deploy builds but `/health` returns 404 or the function fails to import `@matside/shared`:**
1. Check the build log (`vercel inspect --logs <url>`).
2. Fall back to bundling: add `"build": "esbuild src/index.ts --bundle --platform=node --format=esm --outfile=dist/index.mjs --packages=external --alias:@matside/shared=../shared/src/index.ts"` (add `esbuild` as a devDependency).
3. Add `api/api/index.ts` with `export { default } from '../dist/index.mjs'`.
4. Redeploy. Verify against Vercel's current Hono docs (load the `vercel:vercel-functions` skill).

**If latency is above 3 s:** check `agent_runs.ms` for the router. If it's over 1.5 s, cut the roster prompt to first names and check that the gateway region is close.

- [ ] **Step 8: Commit**

```bash
git add api
git commit -m "chore(api): production deps, vercel entry, crons, smoke script

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
