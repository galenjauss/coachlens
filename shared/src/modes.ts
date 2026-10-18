import { z } from 'zod'

export const MODE_IDS = ['martial_arts', 'personal_training', 'tutoring'] as const
export const ModeId = z.enum(MODE_IDS)
export type ModeId = z.infer<typeof ModeId>

export interface ModeConfig {
  id: ModeId
  label: string
  person: string
  people: string
  recipient: 'parent' | 'client'
  planUnit: string
  planItem: string
  planShape: string
  tags: readonly string[]
  tagLabels: Record<string, string>
  weeklyLabel: string
  itemsDueLabel: string
  reportCardFocus: string
  billingExamples: string
  guardrails: string
  cueExamples: string
}

export const MODES: Record<ModeId, ModeConfig> = {
  martial_arts: {
    id: 'martial_arts',
    label: 'Martial arts',
    person: 'student',
    people: 'students',
    recipient: 'parent',
    planUnit: 'Drill deck',
    planItem: 'drill',
    planShape: 'warm-up → technique on the weekly theme → drills → forms due → game → calm finish; 8–12 items, 40–50 min',
    tags: ['stance', 'guard', 'kicks', 'strikes', 'forms', 'footwork', 'focus', 'effort', 'respect', 'sparring'],
    tagLabels: {
      stance: 'Stances', guard: 'Guard drops', kicks: 'Kicks', strikes: 'Strikes', forms: 'Forms', footwork: 'Footwork',
      focus: 'Focus', effort: 'Effort', respect: 'Respect', sparring: 'Sparring',
    },
    weeklyLabel: 'Theme',
    itemsDueLabel: 'Forms due',
    reportCardFocus: 'belt progress, focus areas, effort and respect',
    billingExamples: 'gear, monthly dues, testing fees',
    guardrails: 'No medical advice. Never mention other students.',
    cueExamples: 'knees out · back tall',
  },
  personal_training: {
    id: 'personal_training',
    label: 'Personal training',
    person: 'client',
    people: 'clients',
    recipient: 'client',
    planUnit: 'Session plan',
    planItem: 'exercise',
    planShape: 'warm-up → main lifts (sets × reps in cues) → accessory → finisher → cool-down; 6–10 items, 45–60 min',
    tags: ['form', 'depth', 'tempo', 'bracing', 'range', 'breathing', 'load', 'effort', 'consistency', 'recovery'],
    tagLabels: {
      form: 'Form', depth: 'Depth', tempo: 'Tempo', bracing: 'Bracing', range: 'Range of motion', breathing: 'Breathing',
      load: 'Load', effort: 'Effort', consistency: 'Consistency', recovery: 'Recovery',
    },
    weeklyLabel: 'Program block',
    itemsDueLabel: 'Goals',
    reportCardFocus: 'progress toward goals, PRs, consistency',
    billingExamples: 'sessions left in package, renewal',
    guardrails: 'No medical, injury or nutrition advice; refer to a professional. Never mention other clients.',
    cueExamples: 'chest up · drive through heels',
  },
  tutoring: {
    id: 'tutoring',
    label: 'Tutoring',
    person: 'student',
    people: 'students',
    recipient: 'parent',
    planUnit: 'Lesson plan',
    planItem: 'activity',
    planShape: 'warm-up problem → concept explanation → guided practice → independent practice → exit ticket; 5–8 items, 45–60 min',
    tags: ['concept', 'procedure', 'accuracy', 'speed', 'vocabulary', 'reasoning', 'focus', 'effort', 'confidence', 'homework'],
    tagLabels: {
      concept: 'Concept gaps', procedure: 'Procedure', accuracy: 'Accuracy', speed: 'Speed', vocabulary: 'Vocabulary',
      reasoning: 'Reasoning', focus: 'Focus', effort: 'Effort', confidence: 'Confidence', homework: 'Homework',
    },
    weeklyLabel: 'Unit',
    itemsDueLabel: 'Upcoming',
    reportCardFocus: 'mastery by topic, next skills, effort',
    billingExamples: 'session pack balance',
    guardrails: 'No grade guarantees. Never mention other students.',
    cueExamples: 'show your steps',
  },
}

export const ALL_TAGS: string[] = [...new Set(MODE_IDS.flatMap(id => MODES[id].tags))]

export function modeConfig(id: string | null | undefined): ModeConfig {
  const parsed = ModeId.safeParse(id)
  return MODES[parsed.success ? parsed.data : 'martial_arts']
}
