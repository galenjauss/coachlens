import { eq, like } from 'drizzle-orm'
import type { Db } from './client'
import * as t from './schema'
import { addDays, nextDateForWeekday, weekStart } from '../logic/dates'
import { seedPersonalTraining, seedTutoring } from './seedModes'
import { pastSessions, recordAttendance, sessionNotes } from './seedHistory'

const KIDS = [
  ['Priya Rao', 'orange', 2018], ['Leonardo Diaz', 'yellow', 2017], ['Jake Ross', 'white', 2019], ['Mia Lopez', 'white', 2019],
  ['Maya Chen', 'yellow', 2018], ['Sam Lee', 'green', 2016], ['Ava Kim', 'green', 2016], ['Ben Ortiz', 'white', 2018],
  ['Cal Wu', 'yellow', 2017], ['Dee Park', 'orange', 2017], ['Eli Shah', 'white', 2019], ['Fay Ng', 'yellow', 2018],
  ['Gus Hill', 'green', 2015], ['Ivy Cruz', 'orange', 2016],
] as const

const drill = (name: string, minutes: number, kind: 'warmup' | 'technique' | 'drill' | 'forms' | 'game' | 'sparring', cues: string[], rationale: string, focus: string[] = []) =>
  ({ name, minutes, kind, cues, rationale, focusStudentIds: focus })

export async function seed(db: Db, opts: { today: string; guardianEmail: (i: number) => string }) {
  for (const table of [t.agentRuns, t.reportCards, t.outbox, t.billingFlags, t.issues, t.notes, t.utterances, t.deckDiffs, t.drills, t.decks, t.attendance, t.sessions, t.curriculum, t.enrollments, t.guardians, t.students, t.classes, t.instructors, t.preferences, t.studentMetrics, t.insights]) {
    await db.delete(table)
  }
  // A reseed replays the demo: insight run/live-check bookkeeping goes too (settings and vocabulary are kept).
  await db.delete(t.kv).where(like(t.kv.key, 'insights:%'))
  const [ins] = await db.insert(t.instructors).values({ name: 'Coach Galen', email: 'coach@matside.dev' }).returning()
  const [tue, thu] = await db.insert(t.classes).values([
    { instructorId: ins!.id, name: 'Kids · Tue', weekday: 2, startTime: '17:00' },
    { instructorId: ins!.id, name: 'Kids · Thu', weekday: 4, startTime: '17:00' },
  ]).returning()
  const kids = await db.insert(t.students).values(KIDS.map(([name, belt, birthYear]) => ({ name, belt, birthYear, nickname: name.startsWith('Leonardo') ? 'Leo' : null }))).returning()
  await db.insert(t.guardians).values(kids.map((k, i) => ({ studentId: k.id, name: `${k.name.split(' ')[1]} family`, email: opts.guardianEmail(i) })))
  await db.insert(t.enrollments).values(kids.flatMap(k => [{ classId: tue!.id, studentId: k.id }, { classId: thu!.id, studentId: k.id }]))

  const thisWeek = weekStart(opts.today)
  await db.insert(t.curriculum).values([
    { weekStart: addDays(thisWeek, -14), theme: 'Hands', formsDue: ['Kata 1'] },
    { weekStart: addDays(thisWeek, -7), theme: 'Legs', formsDue: ['Kata 1'] },
    { weekStart: thisWeek, theme: 'Stances', formsDue: ['Kata 2 (yellow+)', 'Kata 1 (white)'] },
    { weekStart: addDays(thisWeek, 7), theme: 'Blocks', formsDue: ['Kata 2 (yellow+)'] },
  ])

  const by = (first: string) => kids.find(k => k.name.startsWith(first))!
  const at = (daysAgo: number) => new Date(`${addDays(opts.today, -daysAgo)}T01:00:00Z`)
  await db.insert(t.notes).values([
    { studentId: by('Priya').id, text: 'Guard drops after the jab', tags: ['guard'], createdAt: at(12) },
    { studentId: by('Priya').id, text: 'Hands low when tired in sparring', tags: ['guard'], createdAt: at(5) },
    { studentId: by('Priya').id, text: 'Remembered every move of Kata 1', tags: ['forms'], createdAt: at(8) },
    { studentId: by('Sam').id, text: 'Guard drops on the cross', tags: ['guard'], createdAt: at(10) },
    { studentId: by('Sam').id, text: 'Guard low again', tags: ['guard'], createdAt: at(6) },
    { studentId: by('Sam').id, text: 'Guard drops when kicking', tags: ['guard'], createdAt: at(3) },
    { studentId: by('Ava').id, text: 'Guard low in pad work', tags: ['guard'], createdAt: at(9) },
    { studentId: by('Ava').id, text: 'Kicks getting higher', tags: ['kicks'], createdAt: at(4) },
    { studentId: by('Ben').id, text: 'Guard drops on the jab', tags: ['guard'], createdAt: at(4) },
    { studentId: by('Maya').id, text: 'Front stance too short', tags: ['stance'], createdAt: at(6) },
    { studentId: by('Leonardo').id, text: 'Great respect bowing in', tags: ['respect'], createdAt: at(24) },
    { studentId: by('Cal').id, text: 'Talking in line-up', tags: ['focus'], createdAt: at(7) },
  ])
  await db.insert(t.issues).values([
    { studentId: by('Sam').id, tag: 'guard', openedAt: at(3) },
    { studentId: by('Ava').id, tag: 'guard', openedAt: at(9) },
  ])

  // Ranks: everyone has a rank date. Priya ~8 months (her open focus issue keeps her off ready-to-test); Gus 120 days
  // with no open issues -> ready_to_test. Everyone else is under 90 days.
  const RANK_DAYS: Record<string, number> = { Priya: 243, Gus: 120, Leonardo: 75, Jake: 60, Mia: 45, Maya: 70, Sam: 50, Ava: 80, Ben: 30, Cal: 65, Dee: 40, Eli: 21, Fay: 55, Ivy: 85 }
  for (const k of kids) {
    const days = RANK_DAYS[k.name.split(' ')[0]!] ?? 30
    await db.update(t.students).set({ rankSince: addDays(opts.today, -days) }).where(eq(t.students.id, k.id))
  }
  // issue_resolved: Priya's focus issue, opened 25 days ago with no focus notes since. (Not guard: the live demo's
  // third guard note must still mark guard recurring and adjust the plan, which an open guard issue would block.)
  await db.insert(t.issues).values({ studentId: by('Priya').id, tag: 'focus', openedAt: at(25) })
  // billing_repeat: two open notes for Leo's family (notes only, never a payment).
  await db.insert(t.billingFlags).values([
    { studentId: by('Leonardo').id, urgency: 'med', note: 'Dad still owes for sparring gear', amount: 45, createdAt: at(9) },
    { studentId: by('Leonardo').id, urgency: 'low', note: 'October dues not in yet', createdAt: at(4) },
  ])
  // Six past Tue and six past Thu classes. Positions count back from the latest (0). Jake missed the last three, so
  // he is the attendance_decline hit and, once marked present in the live class, "Jake's back after 3 missed".
  const kidPast = [...await pastSessions(db, tue!.id, 2, opts.today), ...await pastSessions(db, thu!.id, 4, opts.today)]
  const ABSENT: Record<string, number[]> = { Jake: [0, 1, 2], Priya: [3], Leonardo: [7], Ava: [5, 10], Ben: [9], Cal: [4], Fay: [8], Gus: [11] }
  const firstOf = (id: string) => kids.find(k => k.id === id)!.name.split(' ')[0]!
  const allKids = kids.map(k => k.id)
  const ordered = await recordAttendance(db, kidPast, new Map([[tue!.id, allKids], [thu!.id, allKids]]), id => ABSENT[firstOf(id)] ?? [])
  // Every kid but Jake (absent) and Eli got feedback in one of their last 3 classes: Eli is the no_feedback hit.
  const SESSION_NOTES: [string, number, string][] = [
    ['Priya', 2, 'Strong kiai, great energy in pad work'], ['Leonardo', 1, 'Helped a newer student with bowing in'],
    ['Mia', 0, 'Big improvement on her front kick chamber'], ['Maya', 1, 'Kept her stance low all through the game'],
    ['Sam', 2, 'Good hustle in sharks and minnows'], ['Ava', 0, 'Sharp blocks in Kata 2'], ['Ben', 1, 'Listened well in line-up'],
    ['Cal', 0, 'Calm and steady in Kata 1'], ['Dee', 2, 'Really clean roundhouse'], ['Fay', 1, 'Counted Kata 1 out loud for the group'],
    ['Gus', 0, 'Led the warm-up confidently'], ['Ivy', 2, 'Great control in partner drills'],
  ]
  await sessionNotes(db, ordered, SESSION_NOTES.map(([name, ago, text]) => ({ studentId: by(name).id, ago, text })))

  const tueDate = nextDateForWeekday(addDays(opts.today, -1), 2)
  const thuDate = nextDateForWeekday(addDays(opts.today, -1), 4)
  const [tueDeck, thuDeck] = await db.insert(t.decks).values([{ classId: tue!.id, forDate: tueDate }, { classId: thu!.id, forDate: thuDate }]).returning()
  const guardKids = [by('Priya').id, by('Sam').id, by('Ava').id, by('Ben').id]
  const deck = [
    drill('Warm-up: stance tag', 5, 'warmup', ['low stances only'], 'Warm-up: stances focus'),
    drill('Horse stance holds', 4, 'technique', ['knees out', 'back tall'], 'Stances focus'),
    drill('Front stance transitions', 5, 'technique', ['back leg straight', 'hips square'], 'Maya: short front stance', [by('Maya').id]),
    drill('Guard-up jab drill', 6, 'drill', ['hands back to cheeks', 'chin down'], '4 kids have guard notes', guardKids),
    drill('Kata 2 · yellow belts', 8, 'forms', ['slow and sharp'], 'Forms cycle: Kata 2 due'),
    drill('Kata 1 · white belts', 6, 'forms', ['count out loud'], 'Forms cycle: Kata 1'),
    drill('Sharks & minnows', 5, 'game', ['stances when tagged'], 'Fun reset'),
    drill('Pad rotation: kicks', 6, 'drill', ['chamber first'], 'Mixed skill practice'),
    drill('Bow-out & reflection', 2, 'warmup', ['one thing you improved'], 'Calm finish'),
  ]
  for (const d of [tueDeck!, thuDeck!]) await db.insert(t.drills).values(deck.map((x, i) => ({ ...x, deckId: d.id, position: i + 1 })))

  const ctx = { instructorId: ins!.id, today: opts.today, guardianEmail: opts.guardianEmail }
  const pt = await seedPersonalTraining(db, { ...ctx, emailOffset: kids.length })
  const tut = await seedTutoring(db, { ...ctx, emailOffset: kids.length + pt.count })
  return {
    instructorId: ins!.id,
    classIds: { tue: tue!.id, thu: thu!.id, pt: pt.classId, algebra: tut.classId },
    priyaId: by('Priya').id, mariaId: pt.mariaId, samPatelId: tut.samPatelId,
  }
}
