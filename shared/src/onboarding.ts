import { z } from 'zod'
import { ModeId } from './modes'

// ---- Onboarding quiz: AI extraction per step, then one idempotent commit ----

export const ONBOARDING_STEPS = ['mode', 'classes', 'roster', 'curriculum'] as const
export const OnboardingStep = z.enum(ONBOARDING_STEPS)
export type OnboardingStep = z.infer<typeof OnboardingStep>

/** Max base64 characters for one image (≈3 MB of bytes). Larger bodies get 413. */
export const MAX_IMAGE_BASE64 = 4_000_000
export const MAX_ONBOARDING_TEXT = 20_000
export const IMAGE_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'] as const
export const ImageMime = z.enum(IMAGE_MIME_TYPES)

const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/

export const ExtractRequest = z.object({
  step: OnboardingStep,
  text: z.string().max(MAX_ONBOARDING_TEXT).optional(),
  imageBase64: z.string().min(16).max(MAX_IMAGE_BASE64).regex(BASE64, 'not base64').optional(),
  mimeType: ImageMime.optional(),
  /** The mode chosen in step 1: steers labels and the default class mode. */
  mode: ModeId.optional(),
}).refine(r => Boolean(r.text?.trim()) || Boolean(r.imageBase64), { message: 'text or image required' })
export type ExtractRequest = z.infer<typeof ExtractRequest>

export const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/
export const YMD = /^\d{4}-\d{2}-\d{2}$/

export const ClassDraft = z.object({
  name: z.string().trim().min(1).max(60),
  weekday: z.number().int().min(0).max(6), // 0 = Sunday
  startTime: z.string().regex(HHMM),
  mode: ModeId,
})
export type ClassDraft = z.infer<typeof ClassDraft>

export const StudentDraft = z.object({
  name: z.string().trim().min(1).max(80),
  nickname: z.string().trim().max(40).nullable(),
  /** Belt, level or grade, whatever the mode calls it. */
  level: z.string().trim().max(40).nullable(),
  age: z.number().int().min(2).max(99).nullable(),
  guardianName: z.string().trim().max(80).nullable(),
  guardianEmail: z.email().max(120).nullable(),
  /** Names of classes this student attends (matched to the commit's classes, then existing ones). */
  classNames: z.array(z.string().trim().min(1).max(60)).max(30),
})
export type StudentDraft = z.infer<typeof StudentDraft>

export const CurriculumWeekDraft = z.object({
  /** 1 = the current week, 2 = next week, … (used when the source has no dates). */
  week: z.number().int().min(1).max(52),
  /** Monday of that week when the source gives a date. */
  weekStart: z.string().regex(YMD).nullable(),
  theme: z.string().trim().min(1).max(80),
  itemsDue: z.array(z.string().trim().min(1).max(80)).max(10),
})
export type CurriculumWeekDraft = z.infer<typeof CurriculumWeekDraft>

export const ModeProposal = z.object({ mode: ModeId, reason: z.string().max(300) })
export type ModeProposal = z.infer<typeof ModeProposal>

/** Typed proposal for one step; `notes` says what the AI could not read or what is missing. */
export const ExtractResponse = z.discriminatedUnion('step', [
  z.object({ step: z.literal('mode'), mode: ModeId, reason: z.string() }),
  z.object({ step: z.literal('classes'), classes: z.array(ClassDraft).max(30), notes: z.string() }),
  z.object({ step: z.literal('roster'), students: z.array(StudentDraft).max(300), notes: z.string() }),
  z.object({ step: z.literal('curriculum'), weeks: z.array(CurriculumWeekDraft).max(52), notes: z.string() }),
])
export type ExtractResponse = z.infer<typeof ExtractResponse>

export function isTimeZone(tz: string): boolean {
  try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return true } catch { return false }
}

export const OnboardingBasics = z.object({
  schoolName: z.string().trim().min(1).max(80),
  coachName: z.string().trim().min(1).max(60),
  timeZone: z.string().min(1).max(64).refine(isTimeZone, 'unknown time zone'),
})
export type OnboardingBasics = z.infer<typeof OnboardingBasics>

export const CommitWeek = z.object({
  weekStart: z.string().regex(YMD),
  theme: z.string().trim().min(1).max(80),
  itemsDue: z.array(z.string().trim().min(1).max(80)).max(10),
})
export type CommitWeek = z.infer<typeof CommitWeek>

export const OnboardingCommit = z.object({
  mode: ModeId,
  basics: OnboardingBasics,
  classes: z.array(ClassDraft).min(1).max(30),
  students: z.array(StudentDraft).max(300),
  curriculum: z.array(CommitWeek).max(52),
})
export type OnboardingCommit = z.infer<typeof OnboardingCommit>

export const OnboardingCommitResponse = z.object({
  classIds: z.array(z.string()),
  studentCount: z.number().int(),
  created: z.object({ classes: z.number().int(), students: z.number().int(), guardians: z.number().int() }),
  weeks: z.number().int(),
  plansQueued: z.number().int(),
})
export type OnboardingCommitResponse = z.infer<typeof OnboardingCommitResponse>

export const OnboardingStatus = z.object({
  needsOnboarding: z.boolean(),
  classCount: z.number().int(),
  studentCount: z.number().int(),
  coachName: z.string().nullable(),
  schoolName: z.string().nullable(),
  timeZone: z.string().nullable(),
})
export type OnboardingStatus = z.infer<typeof OnboardingStatus>
