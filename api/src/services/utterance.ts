import { and, eq, gte, sql } from 'drizzle-orm'
import type { Disambiguation, Intent, UtteranceResponse } from '@matside/shared'
import type { Deps } from '../deps'
import { attendance, billingFlags, drills, issues, notes, utterances } from '../db/schema'
import { routeUtterance } from '../agents/router'
import { withRun } from '../agents/runs'
import { draftParentEmail } from '../agents/parentEmail'
import { autoAdjustNextDeck, nextDeckFor, suggestDiff } from '../agents/planner'
import { resolveName } from '../logic/names'
import { parseAttendance } from '../logic/attendance'
import { isRecurring, RECURRING_WINDOW_DAYS } from '../logic/recurring'
import { buildCardLines, type CardAction } from '../logic/cardLines'
import { coverageAndNext, loadSessionContext, markPresent, type SessionContext } from './context'

const DAY = 86_400_000
function safeDefer(deps: Deps, label: string, p: Promise<unknown>) {
  deps.defer(p.catch(e => { console.error(`[defer:${label}]`, e) }))
}
const first = (name: string) => name.split(' ')[0]!

export async function handleUtterance(
  deps: Deps,
  input: { sessionId: string; drillId: string | null; mode: 'note' | 'attendance'; transcript: string },
): Promise<UtteranceResponse> {
  const { db } = deps
  const ctx = await loadSessionContext(db, input.sessionId, input.drillId)
  const [utt] = await db.insert(utterances).values({ sessionId: ctx.sessionId, transcript: input.transcript, mode: input.mode }).returning()
  const utteranceId = utt!.id
  const actions: CardAction[] = []
  let disambiguation: Disambiguation | null = null

  const parsed = input.mode === 'attendance' ? parseAttendance(input.transcript) : null
  if (parsed) {
    actions.push(await applyRollCall(deps, ctx, parsed))
  } else {
    const intents = await routeUtterance(deps, { sessionId: ctx.sessionId, transcript: input.transcript, roster: ctx.roster, drillName: ctx.drill?.name ?? null, theme: ctx.theme })
    if (!intents) {
      await db.insert(notes).values({ sessionId: ctx.sessionId, utteranceId, drillId: ctx.drill?.id ?? null, text: input.transcript })
      actions.push({ kind: 'saved_unsorted' })
    }
    for (const intent of intents ?? []) {
      const r = await applyIntent(deps, ctx, utteranceId, intent)
      actions.push(...r.actions)
      disambiguation ??= r.disambiguation
    }
  }
  const { coverage, next } = await coverageAndNext(db, ctx, deps.now())
  return {
    utteranceId,
    transcript: input.transcript,
    cardLines: buildCardLines(actions),
    coverage,
    nextStudent: next,
    disambiguation,
  }
}

async function applyRollCall(deps: Deps, ctx: SessionContext, parsed: { kind: 'except'; names: string[] } | { kind: 'all' }): Promise<CardAction> {
  const absent = new Map<string, string>()
  const unresolved: string[] = []
  if (parsed.kind === 'except') {
    for (const n of parsed.names) {
      const m = resolveName(n, ctx.roster)
      if (m.kind === 'match') absent.set(m.student.id, first(m.student.name))
      else unresolved.push(n)
    }
  }
  if (unresolved.length) {
    await withRun(deps, { agent: 'attendance', trigger: 'roll_call', sessionId: ctx.sessionId }, async () => ({
      result: false, summary: `Roll call not applied, unclear: ${unresolved.join(', ')}`, reason: 'unresolved names',
    }))
    return { kind: 'rollcall_unclear', names: unresolved }
  }
  if (ctx.roster.length) {
    await deps.db.insert(attendance)
      .values(ctx.roster.map(s => ({ sessionId: ctx.sessionId, studentId: s.id, status: absent.has(s.id) ? 'absent' as const : 'present' as const, source: 'voice' as const })))
      .onConflictDoUpdate({ target: [attendance.sessionId, attendance.studentId], set: { status: sql`excluded.status`, source: 'voice' } })
  }
  await withRun(deps, { agent: 'attendance', trigger: 'roll_call', sessionId: ctx.sessionId }, async () => ({
    result: true, summary: `${ctx.roster.length - absent.size} present, absent: ${[...absent.values()].join(', ') || 'none'}`, reason: 'voice roll call',
  }))
  return { kind: 'attendance', present: ctx.roster.length - absent.size, absentNames: [...absent.values()] }
}

type Applied = { actions: CardAction[]; disambiguation: Disambiguation | null }

async function applyIntent(deps: Deps, ctx: SessionContext, utteranceId: string, intent: Intent): Promise<Applied> {
  switch (intent.type) {
    case 'feedback': return applyFeedback(deps, ctx, utteranceId, intent)
    case 'billing': return applyBilling(deps, ctx, utteranceId, intent)
    case 'attendance': return applyAttendanceIntent(deps, ctx, intent)
    case 'plan_request': {
      safeDefer(deps, 'plan_request', (async () => {
        const deckId = await nextDeckFor(deps, ctx.classId, ctx.forDate)
        if (deckId) await suggestDiff(deps, deckId, intent.content, ctx.sessionId)
      })())
      return { actions: [{ kind: 'plan_request' }], disambiguation: null }
    }
    case 'parent_message': {
      const actions: CardAction[] = []
      for (const n of intent.studentNames) {
        const m = resolveName(n, ctx.roster)
        if (m.kind !== 'match') { actions.push({ kind: 'unassigned' }); continue }
        safeDefer(deps, 'parent_email', draftParentEmail(deps, { studentId: m.student.id, sessionId: ctx.sessionId, trigger: { kind: 'request', content: intent.content } }))
        actions.push({ kind: 'parent_note', name: first(m.student.name) })
      }
      return { actions, disambiguation: null }
    }
    case 'add_drill': {
      const minutes = intent.minutes ?? 5
      const name = intent.content.slice(0, 40)
      const position = (ctx.drill?.position ?? 0) + 1
      await withRun(deps, { agent: 'planner', trigger: 'add_drill', sessionId: ctx.sessionId }, async () => {
        const existing = await deps.db.select().from(drills).where(eq(drills.deckId, ctx.deckId))
        for (const d of existing.filter(x => x.position >= position)) await deps.db.update(drills).set({ position: d.position + 1 }).where(eq(drills.id, d.id))
        await deps.db.insert(drills).values({ deckId: ctx.deckId, position, name, minutes, kind: 'drill', rationale: 'added live by instructor' })
        return { result: true, summary: `Added drill "${name}" (${minutes}m) at position ${position}`, reason: 'instructor request during class' }
      })
      return { actions: [{ kind: 'add_drill', name, minutes }], disambiguation: null }
    }
  }
}

async function applyFeedback(deps: Deps, ctx: SessionContext, utteranceId: string, intent: Intent): Promise<Applied> {
  const { db } = deps
  const actions: CardAction[] = []
  let disambiguation: Disambiguation | null = null
  const base = { sessionId: ctx.sessionId, utteranceId, drillId: ctx.drill?.id ?? null, text: intent.content, tags: intent.skillTags }
  if (!intent.studentNames.length) {
    await db.insert(notes).values(base)
    return { actions: [{ kind: 'unassigned' }], disambiguation: null }
  }
  for (const heard of intent.studentNames) {
    const m = resolveName(heard, ctx.roster)
    if (m.kind === 'ambiguous') {
      const [n] = await db.insert(notes).values({ ...base, heard }).returning()
      if (disambiguation) actions.push({ kind: 'unassigned' })
      else disambiguation = { noteId: n!.id, heard, options: m.options }
      continue
    }
    if (m.kind === 'none') {
      await db.insert(notes).values({ ...base, heard })
      actions.push({ kind: 'unassigned' })
      continue
    }
    const s = m.student
    await db.insert(notes).values({ ...base, studentId: s.id })
    await markPresent(db, ctx.sessionId, s.id, 'backstop')
    const tag = intent.skillTags[0] ?? null
    let count = 1
    let recurring = false
    if (tag) {
      const since = new Date(deps.now().getTime() - RECURRING_WINDOW_DAYS * DAY)
      const recent = await db.select({ tags: notes.tags }).from(notes).where(and(eq(notes.studentId, s.id), gte(notes.createdAt, since)))
      count = recent.filter(r => r.tags.includes(tag)).length
      const [open] = await db.select().from(issues).where(and(eq(issues.studentId, s.id), eq(issues.tag, tag), eq(issues.status, 'open')))
      recurring = isRecurring(count, Boolean(open))
      if (recurring) {
        await db.insert(issues).values({ studentId: s.id, tag })
        safeDefer(deps, 'parent_email', draftParentEmail(deps, { studentId: s.id, sessionId: ctx.sessionId, trigger: { kind: 'recurring', tag } }))
        safeDefer(deps, 'auto_adjust', autoAdjustNextDeck(deps, { classId: ctx.classId, afterDate: ctx.forDate, sessionId: ctx.sessionId, requestText: `Add a short, fun drill targeting ${tag} for ${s.name} [${s.id}] (recurring issue).` }))
      }
    }
    await withRun(deps, { agent: 'progress', trigger: 'feedback', sessionId: ctx.sessionId }, async () => ({
      result: true,
      summary: `Logged "${intent.content.slice(0, 60)}" → ${first(s.name)}${ctx.drill ? ` · drill: ${ctx.drill.name}` : ''}`,
      reason: recurring ? `${tag} ${count}× in ${RECURRING_WINDOW_DAYS} days → marked recurring` : tag ? `${tag} note #${count} in ${RECURRING_WINDOW_DAYS} days` : 'feedback note',
    }))
    actions.push({ kind: 'feedback', name: first(s.name), tag, count, recurring })
  }
  return { actions, disambiguation }
}

async function applyBilling(deps: Deps, ctx: SessionContext, utteranceId: string, intent: Intent): Promise<Applied> {
  const heard = intent.studentNames[0]
  const m = heard ? resolveName(heard, ctx.roster) : { kind: 'none' as const }
  const student = m.kind === 'match' ? m.student : null
  const urgency = intent.urgency ?? 'med'
  await deps.db.insert(billingFlags).values({ studentId: student?.id ?? null, utteranceId, urgency, note: intent.content, amount: intent.amount })
  await withRun(deps, { agent: 'billing', trigger: 'billing', sessionId: ctx.sessionId }, async () => ({
    result: true, summary: `Flagged ${student ? first(student.name) : heard ?? 'unknown'}: ${intent.content.slice(0, 60)}`, reason: `urgency ${urgency.toUpperCase()} (note only, no payment)`,
  }))
  return { actions: [{ kind: 'billing', name: student ? first(student.name) : heard ?? '?', urgency }], disambiguation: null }
}

async function applyAttendanceIntent(deps: Deps, ctx: SessionContext, intent: Intent): Promise<Applied> {
  const actions: CardAction[] = []
  const status = intent.attendanceStatus ?? 'present'
  for (const heard of intent.studentNames) {
    const m = resolveName(heard, ctx.roster)
    if (m.kind !== 'match') continue
    await withRun(deps, { agent: 'attendance', trigger: 'voice', sessionId: ctx.sessionId }, async () => {
      await deps.db.insert(attendance).values({ sessionId: ctx.sessionId, studentId: m.student.id, status, source: 'voice' })
        .onConflictDoUpdate({ target: [attendance.sessionId, attendance.studentId], set: { status, source: 'voice' } })
      return { result: true, summary: `Marked ${first(m.student.name)} ${status}`, reason: 'voice attendance update' }
    })
    actions.push({ kind: 'marked', name: first(m.student.name), status })
  }
  return { actions, disambiguation: null }
}
