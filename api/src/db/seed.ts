import type { Db } from './client'
import * as t from './schema'
import { addDays, nextDateForWeekday, weekStart } from '../logic/dates'

const KIDS = [
  ['Priya Rao', 'orange', 2018], ['Leonardo Diaz', 'yellow', 2017], ['Jake Ross', 'white', 2019], ['Mia Lopez', 'white', 2019],
  ['Maya Chen', 'yellow', 2018], ['Sam Lee', 'green', 2016], ['Ava Kim', 'green', 2016], ['Ben Ortiz', 'white', 2018],
  ['Cal Wu', 'yellow', 2017], ['Dee Park', 'orange', 2017], ['Eli Shah', 'white', 2019], ['Fay Ng', 'yellow', 2018],
  ['Gus Hill', 'green', 2015], ['Ivy Cruz', 'orange', 2016],
] as const

const drill = (name: string, minutes: number, kind: 'warmup' | 'technique' | 'drill' | 'forms' | 'game' | 'sparring', cues: string[], rationale: string, focus: string[] = []) =>
  ({ name, minutes, kind, cues, rationale, focusStudentIds: focus })

export async function seed(db: Db, opts: { today: string; guardianEmail: (i: number) => string }) {
  for (const table of [t.agentRuns, t.reportCards, t.outbox, t.billingFlags, t.issues, t.notes, t.utterances, t.deckDiffs, t.drills, t.decks, t.attendance, t.sessions, t.curriculum, t.enrollments, t.guardians, t.students, t.classes, t.instructors, t.preferences]) {
    await db.delete(table)
  }
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

  const tueDate = nextDateForWeekday(addDays(opts.today, -1), 2)
  const thuDate = nextDateForWeekday(addDays(opts.today, -1), 4)
  const [tueDeck, thuDeck] = await db.insert(t.decks).values([{ classId: tue!.id, forDate: tueDate }, { classId: thu!.id, forDate: thuDate }]).returning()
  const guardKids = [by('Priya').id, by('Sam').id, by('Ava').id, by('Ben').id]
  const deck = [
    drill('Warm-up: stance tag', 5, 'warmup', ['low stances only'], 'Warm-up on this week\'s theme'),
    drill('Horse stance holds', 4, 'technique', ['knees out', 'back tall'], 'Stances theme'),
    drill('Front stance transitions', 5, 'technique', ['back leg straight', 'hips square'], 'Maya: short front stance', [by('Maya').id]),
    drill('Guard-up jab drill', 6, 'drill', ['hands back to cheeks', 'chin down'], '4 kids have guard notes', guardKids),
    drill('Kata 2 · yellow belts', 8, 'forms', ['slow and sharp'], 'Forms cycle: Kata 2 due'),
    drill('Kata 1 · white belts', 6, 'forms', ['count out loud'], 'Forms cycle: Kata 1'),
    drill('Sharks & minnows', 5, 'game', ['stances when tagged'], 'Fun reset'),
    drill('Pad rotation: kicks', 6, 'drill', ['chamber first'], 'Mixed skill practice'),
    drill('Bow-out & reflection', 2, 'warmup', ['one thing you improved'], 'Calm finish'),
  ]
  for (const d of [tueDeck!, thuDeck!]) await db.insert(t.drills).values(deck.map((x, i) => ({ ...x, deckId: d.id, position: i + 1 })))
  return { instructorId: ins!.id, classIds: { tue: tue!.id, thu: thu!.id }, priyaId: by('Priya').id }
}
