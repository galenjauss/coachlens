import { describe, expect, it } from 'vitest'
import { queuedBanner } from './outboxLogic'

describe('queuedBanner', () => {
  it('names the waiting notes, singular and plural; nothing when empty', () => {
    expect(queuedBanner(0)).toBeNull()
    expect(queuedBanner(-1)).toBeNull()
    expect(queuedBanner(1)).toBe('1 note waiting to send')
    expect(queuedBanner(2)).toBe('2 notes waiting to send')
  })
})
