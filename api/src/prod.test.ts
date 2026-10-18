import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { prodDeps } from './prod'

const REQUIRED: Record<string, string> = {
  DATABASE_URL: 'postgres://u:p@localhost/db',
  ANTHROPIC_API_KEY: 'test-anthropic',
  OPENAI_API_KEY: 'test-openai',
  RESEND_API_KEY: 'test-resend',
  MAIL_FROM: 'CoachLens <onboarding@resend.dev>',
  PAIRING_CODE: 'abc123',
  CRON_SECRET: 'cron-secret',
  ALLOWED_ORIGINS: 'https://a.example, https://b.example',
}
let saved: NodeJS.ProcessEnv
beforeEach(() => { saved = { ...process.env }; Object.assign(process.env, REQUIRED) })
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
  it('rejects a pairing code shorter than 6 chars', () => {
    process.env.PAIRING_CODE = '12345'
    expect(() => prodDeps()).toThrow(/PAIRING_CODE/)
  })
})
