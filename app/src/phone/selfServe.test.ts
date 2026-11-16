import { describe, it, expect } from 'vitest'
import { ApiError } from '../core/api'
import { emailText, mailtoHref } from './handOff'
import { pairingError } from './Pairing'

describe('self-serve phone helpers', () => {
  it('builds the hand-off text and a mailto link with everything encoded', () => {
    expect(emailText('p@example.com', 'Priya', 'Hi\nthere')).toBe('To: p@example.com\nSubject: Priya\n\nHi\nthere')
    expect(mailtoHref('p@example.com', 'A & B', 'line 1\nline 2')).toBe('mailto:p%40example.com?subject=A%20%26%20B&body=line%201%0Aline%202')
  })
  it('explains sign-up and pairing failures in plain words', () => {
    expect(pairingError(new ApiError(401, 'bad code'), true)).toBe('That code didn’t match.')
    expect(pairingError(new ApiError(429, 'slow down'), false)).toMatch(/Too many tries/)
    expect(pairingError(new ApiError(503, 'signups_paused'), false)).toMatch(/paused for today/)
    expect(pairingError(new Error('offline'), false)).toMatch(/Can’t reach/)
  })
})
