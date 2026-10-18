import { clampMinutes, clip, NAME_MAX } from '../logic/planNormalize'
import { and, eq, gte, sql } from 'drizzle-orm'
import { ANSWER_BRIEF_NAME, isRealDate, type Brief, type Disambiguation, type Intent, type UtteranceResponse } from '@matside/shared'
import type { Deps } from '../deps'
import { attendance, billingFlags, drills, issues, notes, students, utterances } from '../db/schema'
import { routeUtterance } from '../agents/router'
import { safeDefer, withRun } from '../agents/runs'
import { draftParentEmail } from '../agents/parentEmail'
import { acceptDiff, autoAdjustNextDeck, markAutonomy, nextDeckFor, suggestDiff } from '../agents/planner'
import { resolveName } from '../logic/names'
import { parseAttendance, type RollCall } from '../logic/attendance'
import { isRecurring, RECURRING_WINDOW_DAYS } from '../logic/recurring'
import { buildCardLines, type CardAction } from '../logic/cardLines'
import { getAutonomy } from './settings'
import { buildBrief } from './brief'
import { applyRank, recordMetric } from './metrics'
import { isGradeMetric, metricPhrase, normalizeKey, shortDate } from '../logic/metrics'
import { localDate } from '../logic/dates'
import { coverageAndNext, loadSessionContext, markPresent, type SessionContext } from './context'
import { detectOnAttendance } from './insights'
import { answerQuestion } from '../agents/answer'

const DAY = 86_400_000
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
  let brief: Brief | null = null

  const parsed = input.mode === 'attendance' ? parseAttendance(input.transcript) : null
  if (parsed) {
    const rc = await applyRollCall(deps, ctx, utteranceId, parsed)
    if (rc) actions.push(rc)
  } else {
    const intents = await routeUtterance(deps, { sessionId: ctx.sessionId, utteranceId, transcript: input.transcript, roster: ctx.roster, drillName: ctx.drill?.name ?? null, theme: ctx.theme, mode: ctx.mode })
    if (!intents) {
      await db.insert(notes).values({ sessionId: ctx.sessionId, utteranceId, drillId: ctx.drill?.id ?? null, text: input.transcript })
      actions.push({ kind: 'saved_unsorted' })
    }
    for (const intent of intents ?? []) {
      const r = await applyIntent(deps, ctx, utteranceId, intent)
      actions.push(...r.actions)
      disambiguation ??= r.disambiguation
      brief ??= r.brief ?? null
    }
  }
  const { coverage, next } = await coverageAndNext(db, ctx, deps.now())
  const attendanceChanged = actions.some(a => a.kind === 'attendance' || a.kind === 'marked')
  return {
    utteranceId,
    transcript: input.transcript,
    cardLines: buildCardLines(actions),
    coverage,
    nextStudent: next,
    disambiguation,
    ...(brief ? { brief } : {}),
    ...(attendanceChanged ? { attendanceChanged: true } : {}),
  }
}

async function applyRollCall(deps: Deps, ctx: SessionContext, utteranceId: string, parsed: RollCall): Promise<CardAction | null> {
  const run = { agent: 'attendance', trigger: 'roll_call', sessionId: ctx.sessionId, utteranceId }
  if (await getAutonomy(deps.db, 'attendance') === 'off') {
    await withRun(deps, run, async () => ({ result: false, summary: 'Roll call skipped (off)', reason: 'autonomy: off — voice attendance is turned off in Settings' }))
    return null
  }
  const named = new Map<string, string>()
  const unresolved: string[] = []
  if (parsed.kind !== 'all') {
    for (const n of parsed.names) {
      const m = resolveName(n, ctx.roster)
      if (m.kind === 'match') named.set(m.student.id, first(m.student.name))
      else unresolved.push(n)
    }
  }
  // "everyone except A, B": the named are absent. "present: A, B": everyone else is absent.
  const absent = parsed.kind === 'present'
    ? new Map(ctx.roster.filter(s => !named.has(s.id)).map(s => [s.id, first(s.name)] as const))
    : named
  if (unresolved.length) {
    await withRun(deps, run, async () => ({
      result: false, summary: `Roll call not applied, unclear: ${unresolved.join(', ')}`, reason: 'unresolved names',
    }))
    return { kind: 'rollcall_unclear', names: unresolved }
  }
  if (ctx.roster.length) {
    await deps.db.insert(attendance)
      .values(ctx.roster.map(s => ({ sessionId: ctx.sessionId, studentId: s.id, status: absent.has(s.id) ? 'absent' as const : 'present' as const, source: 'voice' as const })))
      .onConflictDoUpdate({ target: [attendance.sessionId, attendance.studentId], set: { status: sql`excluded.status`, source: 'voice' } })
  }
  await withRun(deps, run, async () => ({
    result: true, summary: `${ctx.roster.length - absent.size} present, absent: ${[...absent.values()].join(', ') || 'none'}`, reason: parsed.kind === 'present' ? 'voice roll call (named present)' : 'voice roll call',
  }))
  // Before the reply: the lens polls insights right after it, and the returning-student row must be there.
  await detectOnAttendance(deps, ctx)
  return { kind: 'attendance', present: ctx.roster.length - absent.size, absentNames: [...absent.values()] }
}

type Applied = { actions: CardAction[]; disambiguation: Disambiguation | null; brief?: Brief }

async function applyIntent(deps: Deps, ctx: SessionContext, utteranceId: string, intent: Intent): Promise<Applied> {
  switch (intent.type) {
    case 'feedback': return applyFeedback(deps, ctx, utteranceId, intent)
    case 'billing': return applyBilling(deps, ctx, utteranceId, intent)
    case 'metric': return applyMetric(deps, ctx, utteranceId, intent)
    case 'student_query': return applyStudentQuery(deps, ctx, utteranceId, intent)
    case 'question': return applyQuestion(deps, ctx, utteranceId, intent)
    case 'attendance': return applyAttendanceIntent(deps, ctx, utteranceId, intent)
    case 'plan_request': {
      safeDefer(deps, 'plan_request', (async () => {
        const deckId = await nextDeckFor(deps, ctx.classId, ctx.forDate, utteranceId)
        const s = deckId ? await suggestDiff(deps, deckId, intent.content, ctx.sessionId, utteranceId) : null
        if (s) {
          const auto = await getAutonomy(deps.db, 'planner') === 'auto'
          if (auto) await acceptDiff(deps, s.diffId, { remember: false })
          await markAutonomy(deps, ctx.sessionId, utteranceId, auto, s.diffId, 'plan_request')
        }
      })())
      return { actions: [{ kind: 'plan_request' }], disambiguation: null }
    }
    case 'parent_message': {
      const actions: CardAction[] = []
      const mailAutonomy = await getAutonomy(deps.db, 'parent_email')
      for (const n of intent.studentNames) {
        const m = resolveName(n, ctx.roster)
        if (m.kind !== 'match') { actions.push({ kind: 'name_unclear', name: n }); continue }
        safeDefer(deps, 'parent_email', draftParentEmail(deps, { studentId: m.student.id, sessionId: ctx.sessionId, utteranceId, trigger: { kind: 'request', content: intent.content } }))
        if (mailAutonomy !== 'off') actions.push({ kind: 'parent_note', name: first(m.student.name) })
      }
      return { actions, disambiguation: null }
    }
    case 'add_drill': {
      const minutes = clampMinutes(intent.minutes ?? 5)
      const name = clip(intent.content, NAME_MAX) || 'Drill'
      const position = (ctx.drill?.position ?? 0) + 1
      await withRun(deps, { agent: 'planner', trigger: 'add_drill', sessionId: ctx.sessionId, utteranceId }, async () => {
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
  // Urgent feedback we can't attach to a student keeps its urgency on the note and gets one loud line.
  const unresolvedBase = { ...base, urgent: intent.urgent }
  const unassigned = (): CardAction => (intent.urgent ? { kind: 'urgent_unassigned' } : { kind: 'unassigned' })
  if (!intent.studentNames.length) {
    await db.insert(notes).values(unresolvedBase)
    return { actions: [unassigned()], disambiguation: null }
  }
  const progressOn = await getAutonomy(db, 'progress') === 'auto'
  const deck = await getAutonomy(db, 'planner')
  const mail = await getAutonomy(db, 'parent_email')
  let urgentFlagged = false
  const flagUrgent = () => {
    if (!intent.urgent || urgentFlagged) return
    urgentFlagged = true
    actions.push({ kind: 'urgent_unassigned' })
  }
  for (const heard of intent.studentNames) {
    const m = resolveName(heard, ctx.roster)
    if (m.kind === 'ambiguous') {
      const [n] = await db.insert(notes).values({ ...unresolvedBase, heard }).returning()
      if (disambiguation) { if (intent.urgent) flagUrgent(); else actions.push({ kind: 'unassigned' }) }
      else { disambiguation = { noteId: n!.id, heard, options: m.options }; flagUrgent() }
      continue
    }
    if (m.kind === 'none') {
      await db.insert(notes).values({ ...unresolvedBase, heard })
      if (intent.urgent) flagUrgent()
      else actions.push({ kind: 'unassigned' })
      continue
    }
    const s = m.student
    const [note] = await db.insert(notes).values({ ...base, studentId: s.id }).returning({ id: notes.id })
    await markPresent(db, ctx.sessionId, s.id, 'backstop')
    const tag = intent.skillTags[0] ?? null
    let count = 1
    let recurring = false
    if (tag) {
      const since = new Date(deps.now().getTime() - RECURRING_WINDOW_DAYS * DAY)
      const recent = await db.select({ tags: notes.tags }).from(notes).where(and(eq(notes.studentId, s.id), gte(notes.createdAt, since)))
      count = recent.filter(r => r.tags.includes(tag)).length
      const [open] = await db.select().from(issues).where(and(eq(issues.studentId, s.id), eq(issues.tag, tag), eq(issues.status, 'open')))
      recurring = isRecurring(count, Boolean(open)) && progressOn
      if (recurring) {
        // v2: a recurring issue feeds the report card and the next plan; it no longer emails home.
        await db.insert(issues).values({ studentId: s.id, tag })
        safeDefer(deps, 'auto_adjust', autoAdjustNextDeck(deps, { classId: ctx.classId, afterDate: ctx.forDate, sessionId: ctx.sessionId, utteranceId, requestText: `Add a short${ctx.mode.recipient === 'parent' ? ', fun' : ''} ${ctx.mode.planItem} targeting ${tag} for ${s.name} [${s.id}] (recurring issue).` }))
      }
    }
    if (intent.urgent) safeDefer(deps, 'parent_email', draftParentEmail(deps, { studentId: s.id, sessionId: ctx.sessionId, utteranceId, trigger: { kind: 'urgent', content: intent.content } }))
    const reason = recurring ? `${tag} ${count}× in ${RECURRING_WINDOW_DAYS} days → marked recurring, added to report card` : tag ? `${tag} note #${count} in ${RECURRING_WINDOW_DAYS} days` : 'feedback note'
    await withRun(deps, { agent: 'progress', trigger: 'feedback', sessionId: ctx.sessionId, utteranceId, links: { noteId: note!.id, studentId: s.id } }, async () => ({
      result: true,
      summary: `Logged "${intent.content.slice(0, 60)}" → ${first(s.name)}${ctx.drill ? ` · drill: ${ctx.drill.name}` : ''}`,
      reason: [intent.urgent ? `urgent · ${reason}` : reason, progressOn ? '' : 'autonomy: off — recurring-issue tracking skipped'].filter(Boolean).join(' · '),
    }))
    actions.push({ kind: 'feedback', name: first(s.name), tag, count, recurring, urgent: intent.urgent, deck, mail })
  }
  return { actions, disambiguation }
}

async function applyBilling(deps: Deps, ctx: SessionContext, utteranceId: string, intent: Intent): Promise<Applied> {
  const heard = intent.studentNames[0]
  const m = heard ? resolveName(heard, ctx.roster) : { kind: 'none' as const }
  const student = m.kind === 'match' ? m.student : null
  const urgency = intent.urgency ?? 'med'
  if (await getAutonomy(deps.db, 'billing') === 'off') {
    await withRun(deps, { agent: 'billing', trigger: 'billing', sessionId: ctx.sessionId, utteranceId }, async () => ({ result: false, summary: 'Billing flag skipped (off)', reason: 'autonomy: off — billing flags are turned off in Settings' }))
    return { actions: [], disambiguation: null }
  }
  const [flag] = await deps.db.insert(billingFlags).values({ studentId: student?.id ?? null, utteranceId, urgency, note: intent.content, amount: intent.amount }).returning({ id: billingFlags.id })
  const links = { billingFlagId: flag!.id, ...(student ? { studentId: student.id } : {}) }
  await withRun(deps, { agent: 'billing', trigger: 'billing', sessionId: ctx.sessionId, utteranceId, links }, async () => ({
    result: true, summary: `Flagged ${student ? first(student.name) : heard ?? 'unknown'}: ${intent.content.slice(0, 60)}`, reason: `urgency ${urgency.toUpperCase()} (note only, no payment)`,
  }))
  return { actions: [{ kind: 'billing', name: student ? first(student.name) : heard ?? '?', urgency }], disambiguation: null }
}

async function applyAttendanceIntent(deps: Deps, ctx: SessionContext, utteranceId: string, intent: Intent): Promise<Applied> {
  const actions: CardAction[] = []
  const status = intent.attendanceStatus ?? 'present'
  if (await getAutonomy(deps.db, 'attendance') === 'off') {
    await withRun(deps, { agent: 'attendance', trigger: 'voice', sessionId: ctx.sessionId, utteranceId }, async () => ({ result: false, summary: 'Attendance update skipped (off)', reason: 'autonomy: off — voice attendance is turned off in Settings' }))
    return { actions: [], disambiguation: null }
  }
  for (const heard of intent.studentNames) {
    const m = resolveName(heard, ctx.roster)
    if (m.kind !== 'match') continue
    await withRun(deps, { agent: 'attendance', trigger: 'voice', sessionId: ctx.sessionId, utteranceId, links: { studentId: m.student.id } }, async () => {
      await deps.db.insert(attendance).values({ sessionId: ctx.sessionId, studentId: m.student.id, status, source: 'voice' })
        .onConflictDoUpdate({ target: [attendance.sessionId, attendance.studentId], set: { status, source: 'voice' } })
      return { result: true, summary: `Marked ${first(m.student.name)} ${status}`, reason: 'voice attendance update' }
    })
    actions.push({ kind: 'marked', name: first(m.student.name), status })
  }
  if (status === 'present' && actions.length) await detectOnAttendance(deps, ctx)
  return { actions, disambiguation: null }
}

/** A progress reading ("Maria hit 225 on deadlift"): saved as a metric row; a rank change also moves the belt and rank-since. */
async function applyMetric(deps: Deps, ctx: SessionContext, utteranceId: string, intent: Intent): Promise<Applied> {
  const { db } = deps
  const run = { agent: 'progress', trigger: 'metric', sessionId: ctx.sessionId, utteranceId }
  if (await getAutonomy(db, 'progress') === 'off') {
    await withRun(deps, run, async () => ({ result: false, summary: 'Progress reading skipped (off)', reason: 'autonomy: off — progress logging is turned off in Settings' }))
    return { actions: [{ kind: 'metric_off' }], disambiguation: null }
  }
  const key = normalizeKey(intent.metricKey ?? '')
  const num = intent.metricNum ?? null
  const unit = intent.metricUnit?.trim() || null
  const value = intent.metricValue?.trim() || (num === null ? '' : `${num}${unit ? ` ${unit}` : ''}`)
  if (!key || !value) {
    await db.insert(notes).values({ sessionId: ctx.sessionId, utteranceId, drillId: ctx.drill?.id ?? null, text: intent.content || value || 'progress reading' })
    return { actions: [{ kind: 'saved_unsorted' }], disambiguation: null }
  }
  // An unreal date ('2026-02-31') is ignored up front, so a rank is never half-applied.
  const since = intent.metricSince && isRealDate(intent.metricSince) ? intent.metricSince : null
  const actions: CardAction[] = []
  for (const heard of intent.studentNames) {
    const m = resolveName(heard, ctx.roster)
    if (m.kind !== 'match') { actions.push({ kind: 'name_unclear', name: heard }); continue }
    const s = m.student
    const text = await withRun(deps, { ...run, links: { studentId: s.id } }, async () => {
      const { row, change } = await recordMetric(db, { studentId: s.id, key, value, num, unit, source: 'voice', utteranceId }, isGradeMetric(ctx.mode.id, unit))
      let phrase = metricPhrase(key, row.value, row.num, row.unit, change)
      let reason = change ? (change.kind === 'pr' ? 'new personal best' : 'grade change vs the last one') : 'recorded'
      if (key === 'rank') {
        phrase = since ? `rank ${value} (since ${shortDate(since)})` : `rank ${value}`
        reason = await applyRank(db, s.id, value, since, localDate(deps.now(), deps.env.timeZone))
      }
      return { result: phrase, summary: `${first(s.name)}: ${phrase}`, reason }
    })
    if (text) actions.push({ kind: 'metric', name: first(s.name), text })
  }
  return { actions, disambiguation: null }
}

/** "How's Priya doing?": no writes; the response carries the brief for the lens. */
async function applyStudentQuery(deps: Deps, ctx: SessionContext, utteranceId: string, intent: Intent): Promise<Applied> {
  const heard = intent.studentNames[0]
  const m = heard ? resolveName(heard, ctx.roster) : { kind: 'none' as const }
  if (m.kind !== 'match') return { actions: [{ kind: 'name_unclear', name: heard ?? 'who' }], disambiguation: null }
  const brief = await withRun(deps, { agent: 'progress', trigger: 'student_query', sessionId: ctx.sessionId, utteranceId, links: { studentId: m.student.id } }, async () => ({
    result: await buildBrief(deps.db, m.student.id, ctx.mode, deps.now(), deps.env.timeZone), summary: `Brief for ${first(m.student.name)}`, reason: 'instructor asked about the student',
  }))
  if (!brief) return { actions: [{ kind: 'name_unclear', name: first(m.student.name) }], disambiguation: null }
  return { actions: [{ kind: 'student_query', name: first(m.student.name) }], disambiguation: null, brief }
}

/** "Who is forgetting to keep their guard up?": no writes; the answer rides the brief field (titled ANSWER on the lens). */
async function applyQuestion(deps: Deps, ctx: SessionContext, utteranceId: string, intent: Intent): Promise<Applied> {
  const question = (intent.question?.trim() || intent.content.trim() || 'question')
  const lines = await answerQuestion(deps, { sessionId: ctx.sessionId, drillId: ctx.drill?.id ?? null, utteranceId, question })
  if (!lines) return { actions: [{ kind: 'answer_failed' }], disambiguation: null }
  return { actions: [{ kind: 'question', question }], disambiguation: null, brief: { name: ANSWER_BRIEF_NAME, lines } }
}
