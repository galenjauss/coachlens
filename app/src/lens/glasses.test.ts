import { describe, it, expect, vi } from 'vitest'
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

  it('retries create if the first create fails', async () => {
    const b = fakeBridge()
    ;(b.createStartUpPageContainer as ReturnType<typeof vi.fn>).mockResolvedValueOnce(1)
    const g = new Glasses(b)
    await g.show(dark)
    await g.show(dark)
    expect((b.createStartUpPageContainer as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(2)
  })
})
