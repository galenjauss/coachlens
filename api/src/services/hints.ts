import { eq } from 'drizzle-orm'
import { HTTPException } from 'hono/http-exception'
import type { Db } from '../db/client'
import { enrollments, sessions, students } from '../db/schema'
import { sttHints } from './vocab'

/** Where STT hints come from: a session (its class roster) or a class directly. */
export type HintScope = { sessionId?: string | null; classId?: string | null }

/**
 * Words the speech-to-text should expect: enrolled students' names and aliases, custom vocabulary,
 * and the session deck's drill names (capped; see sttHints).
 * The single place STT hints are built (both /v1/utterance and /v1/transcribe); extend it here
 * (e.g. custom vocabulary) so both endpoints pick it up. An unknown session is a 404.
 */
export async function hintsFor(db: Db, scope: HintScope): Promise<string[]> {
  let classId = scope.classId ?? null
  let deckId: string | null = null
  if (scope.sessionId) {
    const [s] = await db.select({ classId: sessions.classId, deckId: sessions.deckId }).from(sessions).where(eq(sessions.id, scope.sessionId))
    if (!s) throw new HTTPException(404, { message: 'session not found' })
    classId = s.classId
    deckId = s.deckId
  }
  if (!classId) return sttHints(db, [], null)
  const roster = await db.select({ name: students.name, aliases: students.aliases })
    .from(enrollments).innerJoin(students, eq(students.id, enrollments.studentId)).where(eq(enrollments.classId, classId))
  return sttHints(db, roster.flatMap(r => [r.name, ...(r.aliases ?? [])]), deckId)
}
