import type { DrillKind, ModeId } from '@matside/shared'
import type { Db } from './client'
import * as t from './schema'
import { addDays, nextDateForWeekday, weekStart } from '../logic/dates'
import { pastSessions, recordAttendance, sessionNotes } from './seedHistory'

// Demo worlds for the personal-training and tutoring modes (the martial-arts world lives in seed.ts).

type Person = readonly [name: string, level: string, birthYear: number]
interface Ctx { instructorId: string; today: string; guardianEmail: (i: number) => string; emailOffset: number }

const item = (name: string, minutes: number, kind: DrillKind, cues: string[], rationale: string, focus: string[] = []) =>
  ({ name, minutes, kind, cues, rationale, focusStudentIds: focus })

const at = (today: string, daysAgo: number) => new Date(`${addDays(today, -daysAgo)}T01:00:00Z`)

/** Six past sessions with attendance (absences by sessions-ago, 0 = latest) and one in-session note per person. */
async function seedHistory(db: Db, ctx: Ctx, w: { classId: string; ids: string[]; by: (first: string) => { id: string } }, weekday: number,
  absent: Record<string, number[]>, notes: [first: string, ago: number, text: string][]) {
  const past = await pastSessions(db, w.classId, weekday, ctx.today)
  const nameOf = new Map(Object.keys(absent).map(f => [w.by(f).id, f]))
  const ordered = await recordAttendance(db, past, new Map([[w.classId, w.ids]]), id => absent[nameOf.get(id) ?? ''] ?? [])
  await sessionNotes(db, ordered, notes.map(([f, ago, text]) => ({ studentId: w.by(f).id, ago, text })))
}

/** Readings as [key, num, unit, daysAgo], oldest first per key. */
async function seedMetrics(db: Db, today: string, studentId: string, rows: [string, number, string, number][]) {
  await db.insert(t.studentMetrics).values(rows.map(([key, num, unit, ago]) => ({
    studentId, key, num, unit, value: unit === '%' ? `${num}%` : `${num} ${unit}`, source: 'seed' as const, recordedAt: at(today, ago),
  })))
}

async function seedClass(db: Db, ctx: Ctx, a: {
  name: string; weekday: number; startTime: string; mode: ModeId; people: readonly Person[]
  guardianName: (name: string) => string; weekly: string; due: string[]
}) {
  const [cls] = await db.insert(t.classes).values({ instructorId: ctx.instructorId, name: a.name, weekday: a.weekday, startTime: a.startTime, mode: a.mode }).returning()
  const people = await db.insert(t.students).values(a.people.map(([name, belt, birthYear]) => ({ name, belt, birthYear }))).returning()
  await db.insert(t.guardians).values(people.map((p, i) => ({ studentId: p.id, name: a.guardianName(p.name), email: ctx.guardianEmail(ctx.emailOffset + i) })))
  await db.insert(t.enrollments).values(people.map(p => ({ classId: cls!.id, studentId: p.id })))
  const thisWeek = weekStart(ctx.today)
  // This week and next, so the next session's plan always has its program block / unit.
  await db.insert(t.curriculum).values([0, 7].map(d => ({ weekStart: addDays(thisWeek, d), mode: a.mode, theme: a.weekly, formsDue: a.due })))
  const forDate = nextDateForWeekday(addDays(ctx.today, -1), a.weekday)
  const [deck] = await db.insert(t.decks).values({ classId: cls!.id, forDate }).returning()
  const by = (first: string) => people.find(p => p.name.startsWith(first))!
  return { classId: cls!.id, deckId: deck!.id, by, ids: people.map(p => p.id), count: people.length }
}

const CLIENTS: readonly Person[] = [
  ['Maria Gomez', 'client', 1990], ['Tom Becker', 'client', 1985], ['Priyanka Shah', 'client', 1993],
  ['Derek Owens', 'client', 1978], ['Lena Fischer', 'client', 1996],
]

export async function seedPersonalTraining(db: Db, ctx: Ctx) {
  const w = await seedClass(db, ctx, {
    name: 'PT · Mon 6:00', weekday: 1, startTime: '18:00', mode: 'personal_training', people: CLIENTS,
    guardianName: name => name, // the client receives their own emails
    weekly: 'Lower-body strength', due: ['Squat 5×5', 'Deadlift form check'],
  })
  const maria = w.by('Maria').id
  await db.insert(t.notes).values([
    { studentId: maria, text: 'Squat depth cut short on the last reps', tags: ['depth'], createdAt: at(ctx.today, 11) },
    { studentId: maria, text: 'Hips stayed high on goblet squats, not hitting depth', tags: ['depth'], createdAt: at(ctx.today, 5) },
    { studentId: w.by('Tom').id, text: 'Great bracing on deadlifts', tags: ['bracing'], createdAt: at(ctx.today, 6) },
  ])
  const plan = [
    item('Bike + hip openers', 8, 'warmup', ['easy pace', 'open the hips'], 'Warm-up'),
    item('Back squat 5×5', 12, 'technique', ['5×5 @ RPE 7', 'chest up · drive through heels'], 'Goal: squat 5×5'),
    item('Deadlift form check', 10, 'technique', ['3×5 light', 'brace · push the floor away'], 'Goal: deadlift form check'),
    item('Goblet box squat', 6, 'drill', ['3×8 to the box', 'knees out · sit between heels'], 'Depth focus', [maria]),
    item('Walking lunges', 6, 'drill', ['3×10 each leg', 'tall torso'], 'Accessory: single-leg strength'),
    item('Sled push finisher', 5, 'game', ['4 lengths', 'drive with the legs'], 'Finisher'),
    item('Cool-down stretch', 6, 'warmup', ['slow nasal breathing'], 'Cool-down'),
  ]
  await db.insert(t.drills).values(plan.map((x, i) => ({ ...x, deckId: w.deckId, position: i + 1 })))
  await seedHistory(db, ctx, w, 1, { Derek: [4], Lena: [2] }, [
    ['Maria', 1, 'Solid tempo on RDLs'], ['Tom', 0, 'Kept a neutral spine on every rep'], ['Priyanka', 2, 'Great consistency, no missed sessions'],
    ['Derek', 0, 'Moved well on lunges after the warm-up'], ['Lena', 1, 'Breathing steady through the finisher'],
  ])
  // new_pr: Maria's squat PR 3 days ago. Deadlift best stays 215 so the live "Maria hit 225 on deadlift" is PR +10.
  await seedMetrics(db, ctx.today, maria, [
    ['squat', 165, 'lb', 35], ['squat', 175, 'lb', 21], ['squat', 185, 'lb', 3],
    ['deadlift', 195, 'lb', 35], ['deadlift', 205, 'lb', 21], ['deadlift', 215, 'lb', 10],
    ['bench_press', 95, 'lb', 35], ['bench_press', 100, 'lb', 21], ['bench_press', 100, 'lb', 10],
  ])
  await seedMetrics(db, ctx.today, w.by('Tom').id, [['deadlift', 275, 'lb', 28], ['deadlift', 285, 'lb', 14], ['squat', 225, 'lb', 14]])
  return { classId: w.classId, mariaId: maria, count: w.count }
}

const ALGEBRA: readonly Person[] = [
  ['Sam Patel', 'grade 8', 2012], ['Ava Brooks', 'grade 8', 2012], ['Noah Kim', 'grade 7', 2013], ['Zoe Alvarez', 'grade 8', 2012],
]

export async function seedTutoring(db: Db, ctx: Ctx) {
  const w = await seedClass(db, ctx, {
    name: 'Algebra · Wed 4:00', weekday: 3, startTime: '16:00', mode: 'tutoring', people: ALGEBRA,
    guardianName: name => `${name.split(' ')[1]} family`,
    weekly: 'Linear equations', due: ['Unit quiz Fri'],
  })
  const sam = w.by('Sam').id
  await db.insert(t.notes).values([
    { studentId: sam, text: 'Forgot to distribute the negative in 2(x − 3)', tags: ['procedure'], createdAt: at(ctx.today, 9) },
    { studentId: sam, text: 'Skipped the distribute step again on homework check', tags: ['procedure'], createdAt: at(ctx.today, 4) },
    { studentId: w.by('Ava').id, text: 'Explained her reasoning clearly at the board', tags: ['reasoning'], createdAt: at(ctx.today, 4) },
  ])
  const plan = [
    item('Warm-up: 3 quick equations', 5, 'warmup', ['show your steps'], 'Warm-up problem'),
    item('Concept: inverse operations', 8, 'technique', ['undo in reverse order'], 'Linear equations focus'),
    item('Guided: distribute first', 10, 'drill', ['distribute the negative', 'show your steps'], 'Procedure focus', [sam]),
    item('Independent practice set', 15, 'drill', ['check by substituting'], 'Independent practice'),
    item('Equation relay', 8, 'game', ['one step per turn'], 'Quiz prep: unit quiz Fri'),
    item('Exit ticket', 5, 'drill', ['two problems, solo'], 'Exit ticket'),
  ]
  await db.insert(t.drills).values(plan.map((x, i) => ({ ...x, deckId: w.deckId, position: i + 1 })))
  await seedHistory(db, ctx, w, 3, { Zoe: [3] }, [
    ['Sam', 1, 'Checked his answers by substituting'], ['Ava', 0, 'Finished the practice set early and helped Noah'],
    ['Noah', 2, 'Asked good questions about inverse operations'], ['Zoe', 0, 'Neat, complete steps on the exit ticket'],
  ])
  // grade_drop: Noah's latest unit test is 12 points below the one before.
  await seedMetrics(db, ctx.today, w.by('Noah').id, [['unit_test', 84, '%', 24], ['unit_test', 72, '%', 4]])
  await seedMetrics(db, ctx.today, sam, [['unit_test', 76, '%', 24], ['unit_test', 81, '%', 4]])
  await seedMetrics(db, ctx.today, w.by('Ava').id, [['unit_test', 90, '%', 24], ['unit_test', 93, '%', 4]])
  await seedMetrics(db, ctx.today, w.by('Zoe').id, [['unit_test', 85, '%', 24], ['unit_test', 88, '%', 4]])
  return { classId: w.classId, samPatelId: sam, count: w.count }
}
