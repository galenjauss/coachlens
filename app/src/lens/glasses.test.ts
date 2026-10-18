import { afterEach, describe, it, expect, vi } from 'vitest'
import { Glasses, changedSpan, type GlassesBridge } from './glasses'
import type { PageSpec } from './render'

const text = (id: number, name: string, content: string, capture = false) => ({ id, name, x: 0, y: id * 40, w: 576, h: 40, border: false, capture, content })
const pageA = (body: string): PageSpec => ({ key: 'panel', list: null, texts: [text(1, 'hdr', 'H'), text(2, 'body', body, true)] })
const dark: PageSpec = { key: 'dark', list: null, texts: [{ id: 1, name: 'dark', x: 0, y: 0, w: 576, h: 288, border: false, capture: true, content: '' }] }
const list: PageSpec = { key: 'list:deck', texts: [text(1, 'hdr', 'DECK')], list: { id: 2, name: 'list', x: 0, y: 44, w: 576, h: 244, items: ['a', 'b'] } }

function fakeBridge(): GlassesBridge & { calls: string[] } {
  const calls: string[] = []
  return {
    calls,
    createStartUpPageContainer: vi.fn(async (c: { textObject?: { containerName?: string }[] }) => { calls.push(`create:${c.textObject?.map(t => t.containerName).join(',')}`); return 0 }),
    rebuildPageContainer: vi.fn(async (c: { textObject?: { containerName?: string }[]; listObject?: unknown[] }) => { calls.push(`rebuild:${c.textObject?.map(t => t.containerName).join(',')}${c.listObject?.length ? '+list' : ''}`); return true }),
    textContainerUpgrade: vi.fn(async (c: { containerName?: string; content?: string; contentOffset?: number; contentLength?: number }) => {
      calls.push(c.contentOffset === undefined ? `upgrade:${c.containerName}=${c.content}` : `partial:${c.containerName}@${c.contentOffset}+${c.contentLength}=${c.content}`)
      return true
    }),
  } as unknown as GlassesBridge & { calls: string[] }
}

describe('Glasses', () => {
  it('creates once, then upgrades only changed containers for the same layout key', async () => {
    const b = fakeBridge()
    const g = new Glasses(b)
    await g.show(pageA('one'))
    await g.show(pageA('one'))
    await g.show(pageA('two'))
    expect(b.calls).toEqual(['create:hdr,body', 'upgrade:body=two'])
  })

  it('rebuilds on key change, including lists', async () => {
    const b = fakeBridge()
    const g = new Glasses(b)
    await g.show(pageA('x'))
    await g.show(list)
    await g.show(dark)
    await g.show(dark)
    expect(b.calls).toEqual(['create:hdr,body', 'rebuild:hdr+list', 'rebuild:dark'])
  })

  it('rebuilds a list page whose items changed even with the same key', async () => {
    const b = fakeBridge()
    const g = new Glasses(b)
    await g.show(list)
    await g.show({ ...list, list: { ...list.list!, items: ['a', 'c'] } })
    expect(b.calls).toEqual(['create:hdr', 'rebuild:hdr+list'])
  })

  it('coalesces bursts: only the latest pending page is sent', async () => {
    const b = fakeBridge()
    const g = new Glasses(b)
    void g.show(pageA('1'))
    void g.show(pageA('2'))
    await g.show(pageA('3'))
    expect(b.calls).toEqual(['create:hdr,body', 'upgrade:body=3'])
  })

  it('a failed upgrade forces a full rebuild next time', async () => {
    const b = fakeBridge()
    const g = new Glasses(b)
    await g.show(pageA('1'))
    ;(b.textContainerUpgrade as ReturnType<typeof vi.fn>).mockResolvedValueOnce(false)
    await g.show(pageA('2'))
    await g.show(pageA('2'))
    expect(b.calls.at(-1)).toBe('rebuild:hdr,body')
  })

  it('falls back to rebuild when create fails (page already exists, e.g. after a webview reload)', async () => {
    const b = fakeBridge()
    ;(b.createStartUpPageContainer as ReturnType<typeof vi.fn>).mockResolvedValueOnce(1)
    const g = new Glasses(b)
    await g.show(pageA('1'))
    await g.show(pageA('2'))
    expect(b.createStartUpPageContainer).toHaveBeenCalledTimes(1) // mocked failure: not logged in calls
    expect(b.calls).toEqual(['rebuild:hdr,body', 'upgrade:body=2'])
  })

  it('retries create next time if both create and the rebuild fallback fail', async () => {
    const b = fakeBridge()
    ;(b.createStartUpPageContainer as ReturnType<typeof vi.fn>).mockResolvedValueOnce(1)
    ;(b.rebuildPageContainer as ReturnType<typeof vi.fn>).mockResolvedValueOnce(false)
    const g = new Glasses(b)
    await g.show(dark)
    await g.show(dark)
    expect((b.createStartUpPageContainer as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(2)
  })

  it('invalidate forces exactly one full rebuild on the next show', async () => {
    const b = fakeBridge()
    const g = new Glasses(b)
    await g.show(dark)
    await g.show(dark)
    g.invalidate()
    await g.show(dark)
    await g.show(dark)
    expect(b.calls).toEqual(['create:dark', 'rebuild:dark'])
  })

  describe('retry after failure', () => {
    afterEach(() => { vi.useRealTimers() })
    it('retries the latest spec once after 2 s', async () => {
      vi.useFakeTimers()
      const b = fakeBridge()
      const g = new Glasses(b)
      await g.show(pageA('1'))
      ;(b.textContainerUpgrade as ReturnType<typeof vi.fn>).mockResolvedValueOnce(false)
      await g.show(pageA('2'))
      expect(b.calls).toEqual(['create:hdr,body'])
      await vi.advanceTimersByTimeAsync(1999)
      expect(b.calls).toHaveLength(1)
      await vi.advanceTimersByTimeAsync(1)
      expect(b.calls).toEqual(['create:hdr,body', 'rebuild:hdr,body'])
      await vi.advanceTimersByTimeAsync(10_000)
      expect(b.calls).toHaveLength(2)
    })
    it('background shows (ticks) during a pending retry only update the page the retry sends', async () => {
      vi.useFakeTimers()
      const b = fakeBridge()
      const g = new Glasses(b)
      await g.show(pageA('1'))
      ;(b.textContainerUpgrade as ReturnType<typeof vi.fn>).mockResolvedValueOnce(false)
      await g.show(pageA('2'))
      await g.show(pageA('3'), { background: true })
      await g.show(pageA('4'), { background: true })
      expect(b.calls).toEqual(['create:hdr,body'])
      await vi.advanceTimersByTimeAsync(2000)
      expect(b.calls).toEqual(['create:hdr,body', 'rebuild:hdr,body'])
      await g.show(pageA('4'))
      expect(b.calls).toHaveLength(2) // the retry sent page 4
    })
    it('a newer show cancels the pending retry', async () => {
      vi.useFakeTimers()
      const b = fakeBridge()
      const g = new Glasses(b)
      await g.show(pageA('1'))
      ;(b.textContainerUpgrade as ReturnType<typeof vi.fn>).mockResolvedValueOnce(false)
      await g.show(pageA('2'))
      await g.show(dark)
      await vi.advanceTimersByTimeAsync(5000)
      expect(b.calls).toEqual(['create:hdr,body', 'rebuild:dark'])
    })
  })

  it('invalidate during an in-flight apply is not lost: the next show rebuilds', async () => {
    const b = fakeBridge()
    let release: (v: number) => void = () => {}
    ;(b.createStartUpPageContainer as ReturnType<typeof vi.fn>).mockImplementationOnce(() => new Promise<number>(r => { release = r }))
    const g = new Glasses(b)
    const first = g.show(dark)
    g.invalidate()
    release(0)
    await first
    await g.show(dark)
    expect(b.calls).toEqual(['rebuild:dark'])
  })

  it('dispose cancels a pending retry', async () => {
    vi.useFakeTimers()
    try {
      const b = fakeBridge()
      const g = new Glasses(b)
      await g.show(pageA('1'))
      ;(b.textContainerUpgrade as ReturnType<typeof vi.fn>).mockResolvedValueOnce(false)
      await g.show(pageA('2'))
      g.dispose()
      await vi.advanceTimersByTimeAsync(5000)
      expect(b.calls).toEqual(['create:hdr,body'])
    } finally { vi.useRealTimers() }
  })

  describe('partial upgrades (per-second clock)', () => {
    const timerPage = (time: string, partial = true): PageSpec => ({ key: 'peek', list: null, texts: [
      text(1, 'drill', 'HOLDS', true), { ...text(2, 'timer', time), ...(partial ? { partial: true } : {}) },
    ] })

    it('changedSpan: only the differing characters of same-length ASCII text', () => {
      expect(changedSpan('3:12 left', '3:11 left')).toEqual({ offset: 3, length: 1, text: '1' })
      expect(changedSpan('3:00 left', '2:59 left')).toEqual({ offset: 0, length: 4, text: '2:59' })
      expect(changedSpan('10:00 left', '9:59 left')).toBeNull()
      expect(changedSpan('0:00 left', '0:00 left')).toBeNull()
      expect(changedSpan('━─', '━━')).toBeNull()
    })

    it('sends only the clock characters with contentOffset/contentLength; other containers untouched', async () => {
      const b = fakeBridge()
      const g = new Glasses(b)
      await g.show(timerPage('3:12 left'))
      await g.show(timerPage('3:11 left'))
      await g.show(timerPage('3:00 left'))
      await g.show(timerPage('2:59 left'))
      await g.show(timerPage('2:59 left'))
      expect(b.calls).toEqual(['create:drill,timer', 'partial:timer@3+1=1', 'partial:timer@2+2=00', 'partial:timer@0+4=2:59'])
    })

    it('falls back to a full upgrade when the length changes, or when not marked partial / disabled', async () => {
      const b = fakeBridge()
      const g = new Glasses(b)
      await g.show(timerPage('10:00 left'))
      await g.show(timerPage('9:59 left'))
      await g.show(timerPage('9:58 left', false))
      const off = fakeBridge()
      const g2 = new Glasses(off, { partial: false })
      await g2.show(timerPage('3:12 left'))
      await g2.show(timerPage('3:11 left'))
      expect(b.calls).toEqual(['create:drill,timer', 'upgrade:timer=9:59 left', 'upgrade:timer=9:58 left'])
      expect(off.calls).toEqual(['create:drill,timer', 'upgrade:timer=3:11 left'])
    })

    it('a failed partial upgrade forces a full rebuild next time', async () => {
      const b = fakeBridge()
      const g = new Glasses(b)
      await g.show(timerPage('3:12 left'))
      ;(b.textContainerUpgrade as ReturnType<typeof vi.fn>).mockResolvedValueOnce(false)
      await g.show(timerPage('3:11 left'))
      await g.show(timerPage('3:10 left'))
      expect(b.calls.at(-1)).toBe('rebuild:drill,timer')
    })
  })
})
