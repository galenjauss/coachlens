import { describe, it, expect } from 'vitest'
import { memoryKV } from '../core/storage'
import { copyMissing } from './kvHandoff'

describe('copyMissing', () => {
  it('copies keys the target lacks and never overwrites existing values', async () => {
    const from = memoryKV(), to = memoryKV()
    await from.set('token', 'browser-token'); await from.set('classId', 'c2')
    await to.set('classId', 'c1')
    const copied = await copyMissing(from, to, ['token', 'classId', 'absent'])
    expect(copied).toEqual(['token'])
    expect(await to.get('token')).toBe('browser-token')
    expect(await to.get('classId')).toBe('c1')
    expect(await to.get('absent')).toBeNull()
  })
  it('a failing key does not stop the others', async () => {
    const from = memoryKV(), to = memoryKV()
    await from.set('a', '1'); await from.set('b', '2')
    const flaky = { get: to.get, set: async (k: string, v: string) => { if (k === 'a') throw new Error('nope'); return to.set(k, v) } }
    expect(await copyMissing(from, flaky, ['a', 'b'])).toEqual(['b'])
  })
})
