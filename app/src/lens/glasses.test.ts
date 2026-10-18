import { afterEach, describe, it, expect, vi } from 'vitest'
import { Glasses, type GlassesBridge } from './glasses'
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
    textContainerUpgrade: vi.fn(async (c: { containerName?: string; content?: string }) => { calls.push(`upgrade:${c.containerName}=${c.content}`); return true }),
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
})
