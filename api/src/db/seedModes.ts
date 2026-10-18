import type { DrillKind, ModeId } from '@matside/shared'
import type { Db } from './client'
import * as t from './schema'
import { addDays, nextDateForWeekday, weekStart } from '../logic/dates'

// Demo worlds for the personal-training and tutoring modes (the martial-arts world lives in seed.ts).

type Person = readonly [name: string, level: string, birthYear: number]
interface Ctx { instructorId: string; today: string; guardianEmail: (i: number) => string; emailOffset: number }

const item = (name: string, minutes: number, kind: DrillKind, cues: string[], rationale: string, focus: string[] = []) =>
  ({ name, minutes, kind, cues, rationale, focusStudentIds: focus })

const at = (today: string, daysAgo: number) => new Date(`${addDays(today, -daysAgo)}T01:00:00Z`)

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
  return { classId: cls!.id, deckId: deck!.id, by, count: people.length }
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
  return { classId: w.classId, samPatelId: sam, count: w.count }
}
