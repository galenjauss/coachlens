import {
  Alternatives, AgentRunDetail, AgentRunView, AgentsSummary, AgentTaskRun, RedraftResponse, type AgentTask, Coverage, Deck, ModeId, NextStudent, ReviewItem, RosterStudent, StartSessionResponse, StudentDetail, StudentMetric,
  SuggestResponse, Today, TranscribeResponse, VoicePlanResponse, type ReplaceSource, UtteranceResponse, WrapUp, type DeckPatch,
  SettingsResponse, type SettingsPatch,
  InsightsResponse, InsightAcceptResponse, type InsightsQuery,
  ExtractResponse, OnboardingCommitResponse, OnboardingStatus, type ExtractRequest, type OnboardingCommit,
  UndoResponse, NoteCandidates, type StudentCreate, type StudentUpdate, type ClassCreate, type ClassUpdate,
} from '@matside/shared'
import { z } from 'zod'
import { bus } from './bus'

export class ApiError extends Error {
  status: number
  /** From a `Retry-After` header (seconds or an HTTP date), when the server sent one. */
  retryAfterMs?: number
  constructor(status: number, message: string, retryAfterMs?: number) { super(message); this.status = status; this.retryAfterMs = retryAfterMs }
}

/** `Retry-After: 7` or `Retry-After: <HTTP date>` → milliseconds from now; undefined when absent or unreadable. */
export function parseRetryAfter(v: string | null, now = Date.now()): number | undefined {
  if (!v) return undefined
  const t = v.trim()
  if (/^\d+$/.test(t)) return Number(t) * 1000
  const at = Date.parse(t)
  return Number.isNaN(at) ? undefined : Math.max(0, at - now)
}
export class NetworkError extends Error {}
/**
 * A 2xx JSON reply that didn't match the schema: our server DID the work (e.g. saved the note), we
 * just can't read the reply. Never retry it (that would duplicate the work): `delivered` is true.
 * Only thrown when the body really was JSON with a JSON content-type; anything else is NonJsonResponseError.
 */
export class BadResponseError extends ApiError {
  readonly delivered = true
  constructor() { super(502, 'bad_response') }
}

/**
 * A 2xx that was NOT our API's JSON (captive-portal HTML, an empty body, a proxy page): the request
 * likely never reached the server, so it is a network failure — retryable, and the outbox keeps the note.
 */
export class NonJsonResponseError extends NetworkError {
  constructor() { super('non_json_response') }
}

export type Api = ReturnType<typeof createApi>
/**
 * A request that hangs (dead serverless instance, stalled radio) fails instead of leaving a screen on
 * "Loading…" forever. Generous: a first plan draft can take 15–30 s.
 */
export const REQUEST_TIMEOUT_MS = 45_000
/** One agent run started by an utterance (GET /v1/utterances/:id/runs). Status kept loose: the server may add values. */
export const UtteranceRun = z.object({ agent: z.string(), summary: z.string(), status: z.string(), createdAt: z.string() })
export type UtteranceRun = z.infer<typeof UtteranceRun>
/** Transcript-first: how long the lens waits for /v1/transcribe before falling back to sending the audio. */
export const TRANSCRIBE_TIMEOUT_MS = 5_000
/** `opId`: the outbox item id, sent as the C1 idempotency key (optional for transcribe: it saves nothing). */
export type TranscribeScope = { sessionId?: string | null; classId?: string | null; opId?: string }
/** C1: a stable operation id per queued item; the server replays the first outcome on a retry. */
export type UtteranceOpts = { opId?: string }
/** GET /v1/classes row; startTime and weekday when the server sends them (needed to edit a class). */
export const ClassRow = z.object({ id: z.string(), name: z.string(), mode: ModeId, modeLabel: z.string(), startTime: z.string().optional(), weekday: z.number().int().optional() })
export type ClassRow = z.infer<typeof ClassRow>
/** A student's editable details when the server includes them (classIds, guardians); absent on older servers. */
export const StudentEditable = StudentDetail.extend({
  nickname: z.string().nullable().optional(),
  classIds: z.array(z.string()).optional(),
  guardians: z.array(z.object({ name: z.string(), email: z.string() })).optional(),
})
export type StudentEditable = z.infer<typeof StudentEditable>
/** Review items; `urgent` is added by the server's batch 1 (optional until then). */
export const ReviewItemClient = z.intersection(ReviewItem, z.object({ urgent: z.boolean().optional() }))
export type ReviewItemClient = z.infer<typeof ReviewItemClient>
/** C2 reply; `coverage` kept when an older or richer server still sends it. */
const UndoReply = UndoResponse.extend({ coverage: Coverage.nullable().optional() })
export type UndoReply = z.infer<typeof UndoReply>
export type UtterancePayload = { sessionId: string; drillId: string | null; mode: 'note' | 'attendance'; text: string | null; audio: Blob | null }

/** A token read (bridge storage) that hangs longer than this counts as no token: the request still goes (401 → pair). */
export const TOKEN_READ_TIMEOUT_MS = 3000
async function readToken(getToken: () => Promise<string | null>): Promise<string | null> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const late = new Promise<null>(r => { timer = setTimeout(() => r(null), TOKEN_READ_TIMEOUT_MS) })
  try { return await Promise.race([getToken().catch(() => null), late]) } finally { clearTimeout(timer) }
}

export function createApi(baseUrl: string, getToken: () => Promise<string | null>, fetchImpl: typeof fetch = (...a) => fetch(...a)) {
  async function req<T>(path: string, init: RequestInit & { json?: unknown; timeoutMs?: number } = {}, schema?: z.ZodType<T>): Promise<T> {
    const headers = new Headers(init.headers)
    const token = await readToken(getToken)
    if (token) headers.set('Authorization', `Bearer ${token}`)
    let body = init.body
    if (init.json !== undefined) { headers.set('Content-Type', 'application/json'); body = JSON.stringify(init.json) }
    const ctl = new AbortController()
    const { timeoutMs = REQUEST_TIMEOUT_MS, json: _json, ...rest } = init
    const timer = setTimeout(() => ctl.abort(), timeoutMs)
    let res: Response
    let raw: unknown
    let isJson = false
    try {
      try { res = await fetchImpl(`${baseUrl}${path}`, { ...rest, headers, body, signal: ctl.signal }) } catch (e) {
        throw new NetworkError(ctl.signal.aborted ? 'timeout' : e instanceof Error ? e.message : 'network')
      }
      const text = await res.text().catch(() => '')
      try { raw = text ? JSON.parse(text) : undefined; isJson = text !== '' } catch { raw = undefined }
    } finally { clearTimeout(timer) }
    if (!res.ok) {
      const msg = raw && typeof raw === 'object' ? (raw as { error?: unknown }).error : undefined
      if (res.status === 401 && path !== '/pair') bus.emit('unauthorized', undefined) // token no longer valid: re-pair
      throw new ApiError(res.status, typeof msg === 'string' ? msg : res.statusText, parseRetryAfter(res.headers.get('retry-after')))
    }
    if (!schema) return (raw ?? {}) as T
    const jsonType = /\bjson\b/i.test(res.headers.get('content-type') ?? '')
    if (!isJson || !jsonType) throw new NonJsonResponseError() // not our API's reply: retry later, never "delivered"
    const parsed = schema.safeParse(raw)
    if (!parsed.success) throw new BadResponseError()
    return parsed.data
  }
  const post = <T>(path: string, json: unknown = {}, schema?: z.ZodType<T>) => req(path, { method: 'POST', json }, schema)
  const ok = z.object({ ok: z.literal(true) })
  const StudentRow = z.object({ id: z.string(), name: z.string() }).loose()
  return {
    pair: (code: string) => post('/pair', { code }, z.object({ token: z.string() })),
    classes: () => req('/v1/classes', {}, z.array(ClassRow)),
    today: (classId?: string) => req(classId ? `/v1/today?classId=${encodeURIComponent(classId)}` : '/v1/today', {}, Today),
    startSession: (classId: string) => post('/v1/sessions', { classId }, StartSessionResponse),
    attendance: (sessionId: string, presentIds: string[]) => post(`/v1/sessions/${sessionId}/attendance`, { presentIds }, Coverage),
    endSession: (sessionId: string) => post(`/v1/sessions/${sessionId}/end`, {}, WrapUp),
    remind: (sessionId: string, studentIds: string[]) => post(`/v1/sessions/${sessionId}/remind`, { studentIds }, ok),
    logDrill: (sessionId: string, drillId: string, event: 'start' | 'end') => post(`/v1/sessions/${sessionId}/drills/${drillId}/${event}`, {}, ok),
    /** C1: `opId` goes as the form field AND the Idempotency-Key header; a replayed 200 is an ordinary success. */
    utterance: (p: UtterancePayload, opts: UtteranceOpts = {}) => {
      const f = new FormData()
      f.set('sessionId', p.sessionId); f.set('mode', p.mode)
      if (p.drillId) f.set('drillId', p.drillId)
      if (p.text) f.set('text', p.text)
      if (p.audio) f.set('audio', p.audio, 'note.wav')
      if (opts.opId) f.set('opId', opts.opId)
      return req('/v1/utterance', { method: 'POST', body: f, headers: opts.opId ? { 'Idempotency-Key': opts.opId } : undefined }, UtteranceResponse)
    },
    /** Speech-to-text only (nothing saved); roster hints from the session or class. 422 = nothing heard. */
    transcribe: async (wav: Blob, scope: TranscribeScope = {}, timeoutMs = TRANSCRIBE_TIMEOUT_MS): Promise<string> => {
      const f = new FormData()
      if (scope.sessionId) f.set('sessionId', scope.sessionId)
      if (scope.classId) f.set('classId', scope.classId)
      f.set('audio', wav, 'note.wav')
      if (scope.opId) f.set('opId', scope.opId)
      const headers = scope.opId ? { 'Idempotency-Key': scope.opId } : undefined
      return (await req('/v1/transcribe', { method: 'POST', body: f, timeoutMs, headers }, TranscribeResponse)).transcript
    },
    /** Keep-warm ping (no auth needed). */
    health: () => req('/health', {}, z.object({ ok: z.boolean() })),
    /** Agent progress for one utterance; null when the endpoint (or utterance) is not there yet (404). */
    utteranceRuns: async (utteranceId: string): Promise<UtteranceRun[] | null> => {
      try { return await req(`/v1/utterances/${encodeURIComponent(utteranceId)}/runs`, {}, z.array(UtteranceRun)) } catch (e) {
        if (e instanceof ApiError && e.status === 404) return null
        throw e
      }
    },
    /** C2: what was reversed, cancelled, or could not be. 409 already_undone, 404 unknown id. */
    undo: (utteranceId: string) => post(`/v1/utterances/${encodeURIComponent(utteranceId)}/undo`, {}, UndoReply),
    /** C3: the roster of the note's own class, with its name and capture time. */
    noteCandidates: (noteId: string) => req(`/v1/notes/${encodeURIComponent(noteId)}/candidates`, {}, NoteCandidates),
    assignNote: (noteId: string, studentId: string) => post(`/v1/notes/${noteId}/assign`, { studentId }, z.object({ coverage: Coverage.nullable(), nextStudent: NextStudent.nullable() })),
    dismissNote: (noteId: string) => post(`/v1/notes/${noteId}/dismiss`, {}, ok),
    review: () => req('/v1/review', {}, z.array(ReviewItemClient)),
    approve: (id: string, edits: { subject?: string; body?: string } = {}) => post(`/v1/review/outbox/${id}/approve`, edits, ok),
    skip: (id: string) => post(`/v1/review/outbox/${id}/skip`, {}, ok),
    approveAll: (ids: string[]) => post('/v1/review/outbox/approve-all', { ids }, z.object({ sent: z.number(), failed: z.number() })),
    handleBilling: (id: string, note?: string) => post(`/v1/review/billing/${id}/handle`, { note }, ok),
    noteBilling: (id: string, note: string) => post(`/v1/review/billing/${id}/note`, { note }, ok),
    deck: (id: string) => req(`/v1/decks/${id}`, {}, Deck),
    patchDeck: (id: string, patch: DeckPatch) => req(`/v1/decks/${id}`, { method: 'PATCH', json: patch }, Deck),
    suggest: (id: string, text: string) => post(`/v1/decks/${id}/suggest`, { text }, SuggestResponse),
    /** Replaces a not-started deck's items from another plan (409 once the class has started). */
    replaceDeck: (deckId: string, source: ReplaceSource) => post(`/v1/decks/${deckId}/replace`, { source }, Deck),
    /** Voice plan edit: applies the spoken changes at once; undo with undoDiff(diffId). */
    voicePlan: (classId: string, transcript: string) => post('/v1/plan/voice', { classId, transcript }, VoicePlanResponse),
    acceptDiff: (id: string, remember: boolean) => post(`/v1/diffs/${id}/accept`, { remember }, Deck),
    undoDiff: (id: string) => post(`/v1/diffs/${id}/undo`, {}, ok),
    alternatives: (drillId: string) => post(`/v1/drills/${drillId}/alternatives`, {}, Alternatives),
    students: () => req('/v1/students', {}, z.array(RosterStudent)),
    student: (id: string) => req(`/v1/students/${id}`, {}, StudentEditable),
    /** C3 roster maintenance. Delete removes the student's personal data too. */
    createStudent: (body: StudentCreate) => post('/v1/students', body, StudentRow),
    updateStudent: (id: string, patch: StudentUpdate) => req(`/v1/students/${encodeURIComponent(id)}`, { method: 'PATCH', json: patch }, StudentRow),
    deleteStudent: (id: string) => req(`/v1/students/${encodeURIComponent(id)}`, { method: 'DELETE' }, ok),
    createClass: (body: ClassCreate) => post('/v1/classes', body, ClassRow),
    updateClass: (id: string, patch: ClassUpdate) => req(`/v1/classes/${encodeURIComponent(id)}`, { method: 'PATCH', json: patch }, ClassRow),
    /** 409 while a session of the class is live. */
    deleteClass: (id: string) => req(`/v1/classes/${encodeURIComponent(id)}`, { method: 'DELETE' }, ok),
    /** C4: revoke this phone's token on the server (the caller then clears it locally). */
    unpair: () => post('/v1/unpair', {}, ok),
    feed: (since?: string) => req(`/v1/agents/feed${since ? `?since=${encodeURIComponent(since)}` : ''}`, {}, z.array(AgentRunView)),
    agentsSummary: () => req('/v1/agents/summary', {}, AgentsSummary),
    agentTask: (task: AgentTask, limit = 50) => req(`/v1/agents/${task}?limit=${limit}`, {}, z.array(AgentTaskRun)),
    agentRun: (id: string) => req(`/v1/agents/runs/${encodeURIComponent(id)}`, {}, AgentRunDetail),
    redraft: (outboxId: string, instruction: string) => post(`/v1/review/outbox/${outboxId}/redraft`, { instruction }, RedraftResponse),
    patchStudentAliases: (id: string, aliases: string[]) => req(`/v1/students/${id}`, { method: 'PATCH', json: { aliases } }, z.object({ id: z.string(), aliases: z.array(z.string()) })),
    patchStudentRank: (id: string, p: { belt?: string; rankSince?: string | null }) => req(`/v1/students/${id}`, { method: 'PATCH', json: p }, z.object({ id: z.string(), aliases: z.array(z.string()), belt: z.string().optional(), rankSince: z.string().nullable().optional() })),
    addMetric: (id: string, body: { key: string; value: string; num?: number | null; unit?: string | null }) => post(`/v1/students/${id}/metrics`, body, StudentMetric),
    deleteMetric: (id: string) => req(`/v1/metrics/${id}`, { method: 'DELETE' }, ok),
    settings: () => req('/v1/settings', {}, SettingsResponse),
    patchSettings: (patch: SettingsPatch) => req('/v1/settings', { method: 'PATCH', json: patch }, SettingsResponse),
    /** New insights; in a live session only its high items. scope=class needs a classId (or a sessionId). */
    insights: (params: InsightsQuery = {}) => {
      const q = new URLSearchParams()
      for (const [k, v] of Object.entries(params)) if (v) q.set(k, v)
      const qs = q.toString()
      return req(`/v1/insights${qs ? `?${qs}` : ''}`, {}, InsightsResponse)
    },
    acceptInsight: (id: string) => post(`/v1/insights/${encodeURIComponent(id)}/accept`, {}, InsightAcceptResponse),
    dismissInsight: (id: string) => post(`/v1/insights/${encodeURIComponent(id)}/dismiss`, {}, ok),
    runReportCards: (studentIds?: string[]) => post('/v1/report-cards/run', { studentIds }, z.object({ started: z.number() })),
    onboardingStatus: () => req('/v1/onboarding/status', {}, OnboardingStatus),
    onboardingExtract: (body: ExtractRequest) => post('/v1/onboarding/extract', body, ExtractResponse),
    onboardingCommit: (body: OnboardingCommit) => post('/v1/onboarding/commit', body, OnboardingCommitResponse),
  }
}
