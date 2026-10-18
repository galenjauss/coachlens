import {
  Alternatives, AgentRunDetail, AgentRunView, AgentsSummary, AgentTaskRun, RedraftResponse, type AgentTask, Coverage, Deck, ModeId, NextStudent, ReviewItem, RosterStudent, StartSessionResponse, StudentDetail,
  SuggestResponse, Today, UtteranceResponse, WrapUp, type DeckPatch,
  ExtractResponse, OnboardingCommitResponse, OnboardingStatus, type ExtractRequest, type OnboardingCommit,
} from '@matside/shared'
import { z } from 'zod'

export class ApiError extends Error {
  status: number
  constructor(status: number, message: string) { super(message); this.status = status }
}
export class NetworkError extends Error {}

export type Api = ReturnType<typeof createApi>
/** One agent run started by an utterance (GET /v1/utterances/:id/runs). Status kept loose: the server may add values. */
export const UtteranceRun = z.object({ agent: z.string(), summary: z.string(), status: z.string(), createdAt: z.string() })
export type UtteranceRun = z.infer<typeof UtteranceRun>
export type UtterancePayload = { sessionId: string; drillId: string | null; mode: 'note' | 'attendance'; text: string | null; audio: Blob | null }

export function createApi(baseUrl: string, getToken: () => Promise<string | null>, fetchImpl: typeof fetch = (...a) => fetch(...a)) {
  async function req<T>(path: string, init: RequestInit & { json?: unknown } = {}, schema?: z.ZodType<T>): Promise<T> {
    const headers = new Headers(init.headers)
    const token = await getToken()
    if (token) headers.set('Authorization', `Bearer ${token}`)
    let body = init.body
    if (init.json !== undefined) { headers.set('Content-Type', 'application/json'); body = JSON.stringify(init.json) }
    let res: Response
    try { res = await fetchImpl(`${baseUrl}${path}`, { ...init, headers, body }) } catch (e) { throw new NetworkError(e instanceof Error ? e.message : 'network') }
    const raw: unknown = await res.json().catch(() => undefined)
    if (!res.ok) {
      const msg = raw && typeof raw === 'object' ? (raw as { error?: unknown }).error : undefined
      throw new ApiError(res.status, typeof msg === 'string' ? msg : res.statusText)
    }
    if (!schema) return (raw ?? {}) as T
    const parsed = schema.safeParse(raw)
    if (!parsed.success) throw new ApiError(502, 'bad_response')
    return parsed.data
  }
  const post = <T>(path: string, json: unknown = {}, schema?: z.ZodType<T>) => req(path, { method: 'POST', json }, schema)
  const ok = z.object({ ok: z.literal(true) })
  const ClassRow = z.object({ id: z.string(), name: z.string(), mode: ModeId, modeLabel: z.string() })
  return {
    pair: (code: string) => post('/pair', { code }, z.object({ token: z.string() })),
    classes: () => req('/v1/classes', {}, z.array(ClassRow)),
    today: (classId?: string) => req(classId ? `/v1/today?classId=${encodeURIComponent(classId)}` : '/v1/today', {}, Today),
    startSession: (classId: string) => post('/v1/sessions', { classId }, StartSessionResponse),
    attendance: (sessionId: string, presentIds: string[]) => post(`/v1/sessions/${sessionId}/attendance`, { presentIds }, Coverage),
    endSession: (sessionId: string) => post(`/v1/sessions/${sessionId}/end`, {}, WrapUp),
    remind: (sessionId: string, studentIds: string[]) => post(`/v1/sessions/${sessionId}/remind`, { studentIds }, ok),
    logDrill: (sessionId: string, drillId: string, event: 'start' | 'end') => post(`/v1/sessions/${sessionId}/drills/${drillId}/${event}`, {}, ok),
    utterance: (p: UtterancePayload) => {
      const f = new FormData()
      f.set('sessionId', p.sessionId); f.set('mode', p.mode)
      if (p.drillId) f.set('drillId', p.drillId)
      if (p.text) f.set('text', p.text)
      if (p.audio) f.set('audio', p.audio, 'note.wav')
      return req('/v1/utterance', { method: 'POST', body: f }, UtteranceResponse)
    },
    /** Agent progress for one utterance; null when the endpoint (or utterance) is not there yet (404). */
    utteranceRuns: async (utteranceId: string): Promise<UtteranceRun[] | null> => {
      try { return await req(`/v1/utterances/${encodeURIComponent(utteranceId)}/runs`, {}, z.array(UtteranceRun)) } catch (e) {
        if (e instanceof ApiError && e.status === 404) return null
        throw e
      }
    },
    undo: (utteranceId: string) => post(`/v1/utterances/${utteranceId}/undo`, {}, z.object({ coverage: Coverage.nullable() })),
    assignNote: (noteId: string, studentId: string) => post(`/v1/notes/${noteId}/assign`, { studentId }, z.object({ coverage: Coverage.nullable(), nextStudent: NextStudent.nullable() })),
    dismissNote: (noteId: string) => post(`/v1/notes/${noteId}/dismiss`, {}, ok),
    review: () => req('/v1/review', {}, z.array(ReviewItem)),
    approve: (id: string, edits: { subject?: string; body?: string } = {}) => post(`/v1/review/outbox/${id}/approve`, edits, ok),
    skip: (id: string) => post(`/v1/review/outbox/${id}/skip`, {}, ok),
    approveAll: (ids: string[]) => post('/v1/review/outbox/approve-all', { ids }, z.object({ sent: z.number(), failed: z.number() })),
    handleBilling: (id: string, note?: string) => post(`/v1/review/billing/${id}/handle`, { note }, ok),
    noteBilling: (id: string, note: string) => post(`/v1/review/billing/${id}/note`, { note }, ok),
    deck: (id: string) => req(`/v1/decks/${id}`, {}, Deck),
    patchDeck: (id: string, patch: DeckPatch) => req(`/v1/decks/${id}`, { method: 'PATCH', json: patch }, Deck),
    suggest: (id: string, text: string) => post(`/v1/decks/${id}/suggest`, { text }, SuggestResponse),
    acceptDiff: (id: string, remember: boolean) => post(`/v1/diffs/${id}/accept`, { remember }, Deck),
    undoDiff: (id: string) => post(`/v1/diffs/${id}/undo`, {}, ok),
    alternatives: (drillId: string) => post(`/v1/drills/${drillId}/alternatives`, {}, Alternatives),
    students: () => req('/v1/students', {}, z.array(RosterStudent)),
    student: (id: string) => req(`/v1/students/${id}`, {}, StudentDetail),
    feed: (since?: string) => req(`/v1/agents/feed${since ? `?since=${encodeURIComponent(since)}` : ''}`, {}, z.array(AgentRunView)),
    agentsSummary: () => req('/v1/agents/summary', {}, AgentsSummary),
    agentTask: (task: AgentTask, limit = 50) => req(`/v1/agents/${task}?limit=${limit}`, {}, z.array(AgentTaskRun)),
    agentRun: (id: string) => req(`/v1/agents/runs/${encodeURIComponent(id)}`, {}, AgentRunDetail),
    redraft: (outboxId: string, instruction: string) => post(`/v1/review/outbox/${outboxId}/redraft`, { instruction }, RedraftResponse),
    patchStudentAliases: (id: string, aliases: string[]) => req(`/v1/students/${id}`, { method: 'PATCH', json: { aliases } }, z.object({ id: z.string(), aliases: z.array(z.string()) })),
    runReportCards: (studentIds?: string[]) => post('/v1/report-cards/run', { studentIds }, z.object({ started: z.number() })),
    onboardingStatus: () => req('/v1/onboarding/status', {}, OnboardingStatus),
    onboardingExtract: (body: ExtractRequest) => post('/v1/onboarding/extract', body, ExtractResponse),
    onboardingCommit: (body: OnboardingCommit) => post('/v1/onboarding/commit', body, OnboardingCommitResponse),
  }
}
