import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { prodDeps } from './prod'
import { SttUnavailableError } from './deps'

const REQUIRED: Record<string, string> = {
  DATABASE_URL: 'postgres://u:p@localhost/db',
  ANTHROPIC_API_KEY: 'test-anthropic',
  RESEND_API_KEY: 'test-resend',
  MAIL_FROM: 'CoachLens <onboarding@resend.dev>',
  PAIRING_CODE: 'abc123',
  CRON_SECRET: 'cron-secret',
  ALLOWED_ORIGINS: 'https://a.example, https://b.example',
}
let saved: NodeJS.ProcessEnv
beforeEach(() => { saved = { ...process.env }; Object.assign(process.env, REQUIRED, { OPENAI_API_KEY: 'test-openai' }) })
afterEach(() => { process.env = saved })

describe('prodDeps env validation', () => {
  it('builds with all required env', () => {
    const d = prodDeps()
    expect(d.env.allowedOrigins).toEqual(['https://a.example', 'https://b.example'])
    expect(d.env.pairingCode).toBe('abc123')
  })
  for (const k of Object.keys(REQUIRED)) {
    it(`throws when ${k} is missing`, () => {
      delete process.env[k]
      expect(() => prodDeps()).toThrow(new RegExp(k))
    })
  }
  it('S2: the per-instructor AI cap defaults to the global cap; only an explicit env sets a lower one; self-serve accounts get their own pool', () => {
    process.env.AI_DAILY_CAP = '400'
    delete process.env.AI_INSTRUCTOR_DAILY_CAP
    expect(prodDeps().env).toMatchObject({ aiDailyCap: 400, aiInstructorDailyCap: 400, publicAi: { cap: 300, instructorCap: 40 } })
    process.env.AI_INSTRUCTOR_DAILY_CAP = '150'
    expect(prodDeps().env.aiInstructorDailyCap).toBe(150)
    process.env.AI_INSTRUCTOR_DAILY_CAP = '900' // never above the global ceiling
    expect(prodDeps().env.aiInstructorDailyCap).toBe(400)
  })
  it('F20: OPENAI_API_KEY is optional: speech-to-text reports unconfigured and fails with a typed error', async () => {
    expect(prodDeps().env).toMatchObject({ sttConfigured: true, aiDailyCap: 400 })
    delete process.env.OPENAI_API_KEY
    const d = prodDeps()
    expect(d.env.sttConfigured).toBe(false)
    await expect(d.stt.transcribe(new Uint8Array(4), [])).rejects.toBeInstanceOf(SttUnavailableError)
  })
  it('rejects a pairing code shorter than 6 chars', () => {
    process.env.PAIRING_CODE = '12345'
    expect(() => prodDeps()).toThrow(/PAIRING_CODE/)
  })
  it('treats empty AI_DAILY_CAP as the default', () => {
    process.env.AI_DAILY_CAP = ''
    expect(() => prodDeps()).not.toThrow()
  })
  for (const bad of ['abc', '0', '-5']) {
    it(`rejects AI_DAILY_CAP=${bad}`, () => {
      process.env.AI_DAILY_CAP = bad
      expect(() => prodDeps()).toThrow(/AI_DAILY_CAP/)
    })
  }
})
