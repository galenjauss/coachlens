import { and, asc, eq, inArray, isNull } from 'drizzle-orm'
import { modeConfig, type ClassSummary, type FocusItem, type Today } from '@matside/shared'
import type { Db } from '../db/client'
import type { Deps } from '../deps'
import { classes, enrollments, issues, sessions, students } from '../db/schema'
import { localWeekday, upcomingClassDate } from '../logic/dates'
import { draftDeck } from '../agents/planner'
import { getDeck } from './decks'
import { curriculumFor } from './context'

export async function listClasses(db: Db): Promise<ClassSummary[]> {
  const rows = await db.select().from(classes).orderBy(asc(classes.weekday), asc(classes.startTime), asc(classes.name))
  return rows.map(c => {
    const mode = modeConfig(c.mode) // unknown stored values fall back to martial_arts
    return { id: c.id, name: c.name, mode: mode.id, modeLabel: mode.label }
  })
}

/** Today's class: the explicit classId (demo class picker) or the class on today's weekday, else the next one. */
async function pickClass(db: Db, dow: number, classId: string | undefined) {
  if (classId) {
    const [c] = await db.select().from(classes).where(eq(classes.id, classId))
    if (!c) throw new Error(`class ${classId} not found`)
    return c
  }
  const all = await db.select().from(classes)
  if (!all.length) throw new Error('no classes')
  return all.find(c => c.weekday === dow) ?? [...all].sort((a, b) => ((a.weekday - dow + 7) % 7) - ((b.weekday - dow + 7) % 7))[0]!
}

export async function getToday(deps: Deps, classId?: string): Promise<Today> {
  const { db } = deps
  const now = deps.now()
  const cls = await pickClass(db, localWeekday(now, deps.env.timeZone), classId)
  const forDate = upcomingClassDate(now, deps.env.timeZone, cls.weekday)
  const mode = modeConfig(cls.mode)
  const deckId = await draftDeck(deps, cls.id, forDate)
  if (!deckId) throw new Error('deck unavailable')
  const roster = await db.select({ id: students.id, name: students.name, nickname: students.nickname, belt: students.belt })
    .from(enrollments).innerJoin(students, eq(students.id, enrollments.studentId)).where(eq(enrollments.classId, cls.id))
  const ids = roster.map(r => r.id)
  const open = ids.length ? await db.select().from(issues).where(and(inArray(issues.studentId, ids), eq(issues.status, 'open'))) : []
  const byTag = new Map<string, string[]>()
  for (const i of open) byTag.set(i.tag, [...(byTag.get(i.tag) ?? []), i.studentId])
  const nameOf = (id: string) => roster.find(r => r.id === id)?.name.split(' ')[0] ?? '?'
  const group = mode.id === 'martial_arts' ? 'kids' : mode.people
  const focus: FocusItem[] = [...byTag].sort((a, b) => b[1].length - a[1].length).map(([tag, sids]) => ({
    label: `${mode.tagLabels[tag] ?? tag} · ${sids.length === 1 ? nameOf(sids[0]!) : `${sids.length} ${group}`}`, studentIds: sids, studentNames: sids.map(nameOf),
  }))
  if (cls.remindIds.length) focus.push({ label: `First on feedback list: ${cls.remindIds.map(nameOf).join(', ')}`, studentIds: cls.remindIds, studentNames: cls.remindIds.map(nameOf) })
  const cur = await curriculumFor(db, mode, forDate)
  const [open1] = await db.select().from(sessions).where(and(eq(sessions.classId, cls.id), eq(sessions.forDate, forDate), isNull(sessions.endedAt)))
  return {
    classId: cls.id, className: cls.name, startTime: cls.startTime, forDate, sessionId: open1?.id ?? null,
    mode: mode.id, modeLabel: mode.label, weeklyLabel: mode.weeklyLabel, itemsDueLabel: mode.itemsDueLabel, planUnit: mode.planUnit, people: mode.people,
    theme: cur?.theme ?? 'General skills', formsDue: cur?.formsDue ?? [], focus, deck: await getDeck(db, deckId), roster,
  }
}
