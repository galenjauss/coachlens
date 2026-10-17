import { and, eq, inArray, isNull } from 'drizzle-orm'
import type { FocusItem, Today } from '@matside/shared'
import type { Deps } from '../deps'
import { classes, curriculum, enrollments, issues, sessions, students } from '../db/schema'
import { localDate, localWeekday, weekStart } from '../logic/dates'
import { draftDeck } from '../agents/planner'
import { getDeck } from './decks'

const TAG_LABEL: Record<string, string> = {
  stance: 'Stances', guard: 'Guard drops', kicks: 'Kicks', strikes: 'Strikes', forms: 'Forms', footwork: 'Footwork',
  focus: 'Focus', effort: 'Effort', respect: 'Respect', sparring: 'Sparring',
}

export async function getToday(deps: Deps): Promise<Today> {
  const { db } = deps
  const now = deps.now()
  const forDate = localDate(now, deps.env.timeZone)
  const dow = localWeekday(now, deps.env.timeZone)
  const all = await db.select().from(classes)
  if (!all.length) throw new Error('no classes')
  const cls = all.find(c => c.weekday === dow) ?? [...all].sort((a, b) => ((a.weekday - dow + 7) % 7) - ((b.weekday - dow + 7) % 7))[0]!
  const deckId = await draftDeck(deps, cls.id, forDate)
  if (!deckId) throw new Error('deck unavailable')
  const roster = await db.select({ id: students.id, name: students.name, nickname: students.nickname, belt: students.belt })
    .from(enrollments).innerJoin(students, eq(students.id, enrollments.studentId)).where(eq(enrollments.classId, cls.id))
  const ids = roster.map(r => r.id)
  const open = ids.length ? await db.select().from(issues).where(and(inArray(issues.studentId, ids), eq(issues.status, 'open'))) : []
  const byTag = new Map<string, string[]>()
  for (const i of open) byTag.set(i.tag, [...(byTag.get(i.tag) ?? []), i.studentId])
  const nameOf = (id: string) => roster.find(r => r.id === id)?.name.split(' ')[0] ?? '?'
  const focus: FocusItem[] = [...byTag].sort((a, b) => b[1].length - a[1].length).map(([tag, sids]) => ({
    label: `${TAG_LABEL[tag] ?? tag} · ${sids.length === 1 ? nameOf(sids[0]!) : `${sids.length} kids`}`, studentIds: sids, studentNames: sids.map(nameOf),
  }))
  if (cls.remindIds.length) focus.push({ label: `First on feedback list: ${cls.remindIds.map(nameOf).join(', ')}`, studentIds: cls.remindIds, studentNames: cls.remindIds.map(nameOf) })
  const [cur] = await db.select().from(curriculum).where(eq(curriculum.weekStart, weekStart(forDate)))
  const [open1] = await db.select().from(sessions).where(and(eq(sessions.classId, cls.id), eq(sessions.forDate, forDate), isNull(sessions.endedAt)))
  return {
    classId: cls.id, className: cls.name, startTime: cls.startTime, forDate, sessionId: open1?.id ?? null,
    theme: cur?.theme ?? 'General skills', formsDue: cur?.formsDue ?? [], focus, deck: await getDeck(db, deckId), roster,
  }
}
