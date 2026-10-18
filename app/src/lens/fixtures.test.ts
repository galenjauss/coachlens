import { describe, expect, it } from 'vitest'
import { FIXTURE_NAMES, fixtureState, isFixtureName, noopApi } from './fixtures'
import { render, type PageSpec } from './render'
import { colsFor, rowsFor } from './text'

const NOW = Date.parse('2026-10-20T17:24:00Z')
const W = 576
const H = 288
const body = (p: PageSpec, name: string) => p.texts.find(t => t.name === name)?.content ?? ''
const all = (p: PageSpec) => [...p.texts.map(t => t.content), ...(p.list?.items ?? [])].join('\n')

/** The G2 page limits the app relies on (see render.test.ts): containers, names, bounds, text budget. */
function expectWithinG2(p: PageSpec, where: string) {
  expect(p.texts.length + (p.list ? 1 : 0), where).toBeLessThanOrEqual(8)
  expect(p.texts.filter(t => t.capture).length + (p.list ? 1 : 0), `${where}: one capturing container`).toBe(1)
  for (const t of p.texts) {
    expect(t.name.length, `${where}/${t.name} name`).toBeLessThanOrEqual(16)
    expect(t.x + t.w, `${where}/${t.name} x`).toBeLessThanOrEqual(W)
    expect(t.y + t.h, `${where}/${t.name} y`).toBeLessThanOrEqual(H)
    const lines = t.content ? t.content.split('\n') : []
    expect(lines.length, `${where}/${t.name} rows: ${t.content}`).toBeLessThanOrEqual(rowsFor(t.h, t.border))
    for (const l of lines) expect(l.length, `${where}/${t.name}: "${l}"`).toBeLessThanOrEqual(colsFor(t.w, t.border))
  }
  if (p.list) {
    expect(p.list.items.length).toBeLessThanOrEqual(20)
    for (const i of p.list.items) expect(i.length).toBeLessThanOrEqual(64)
  }
}

describe('screenshot fixtures', () => {
  it('every fixture renders within the G2 limits', () => {
    for (const name of FIXTURE_NAMES) expectWithinG2(render(fixtureState(name, NOW), NOW), name)
  })

  it('each fixture shows its store-screenshot content through the real render path', () => {
    const r = (n: (typeof FIXTURE_NAMES)[number]) => render(fixtureState(n, NOW), NOW)
    expect(body(r('home'), 'body')).toContain('Kids · Tue · 5:00 PM')
    expect(body(r('home'), 'hdr')).toBe('COACHLENS (1/4)')

    const lobby = r('lobby')
    expect(lobby.key).toBe('lobbyI')
    expect(body(lobby, 'insight')).toContain('★ Gus ready to test')
    expect(body(lobby, 'body').split('\n').filter(l => /^\d /.test(l))).toHaveLength(3)

    const planning = r('planning')
    expect(body(planning, 'hdr')).toBe('● Planning · 0:45')
    expect(body(planning, 'body')).toContain('cut the warm-up to six')

    expect(body(r('planResult'), 'body')).toBe('+ Partner pad drill 6m\n- Kata 2\n~ Warm-up 10→6m')

    const peek = r('peek')
    expect(body(peek, 'drill')).toBe('Pad rotation')
    expect(body(peek, 'timer')).toBe('3:45 left')
    expect(body(peek, 'box')).toMatch(/━+─+/)
    expect(body(peek, 'next')).toContain('Eli')

    const banner = r('banner')
    expect(body(banner, 'hdr')).toBe('★ Jake\'s back after 3 missed')
    expect(body(banner, 'drill')).toContain('Welcome him back')
    expect(body(banner, 'drill')).toContain('missed 3 in a row')

    const card = r('card')
    expect(body(card, 'hdr')).toBe('√ Priya · guard (3rd time)')
    expect(body(card, 'said').replace(/\n/g, ' ')).toBe('"Priya keeps dropping her guard on the jab"')
    expect(body(card, 'agents')).toBe('ok sorted · ok report · ok plan\ntap: close · 2×: undo')

    const answer = r('answer')
    expect(body(answer, 'hdr')).toBe('1/2 swipe · ANSWER')
    expect(body(answer, 'said')).toBe('Guard: Priya (3), Sam (3), Ava (1),\nBen (1)')

    expect(body(r('brief'), 'hdr')).toBe('1/2 swipe · Priya Rao')

    const wrap = all(r('wrapup'))
    for (const s of ['40 min · 6 drills · 9/12 got feedback', 'Missed: Eli, Mia, Leo', '7 agent actions · 3 to review', '★ Jake back after 3 missed', 'first next class']) expect(wrap).toContain(s)
  })

  it('names are validated and the no-op API never settles', async () => {
    expect(isFixtureName('peek')).toBe(true)
    expect(isFixtureName('nope')).toBe(false)
    expect(isFixtureName(null)).toBe(false)
    const api = noopApi()
    const settled = await Promise.race([api.today().then(() => 'settled'), new Promise(r => setTimeout(() => r('pending'), 10))])
    expect(settled).toBe('pending')
    expect((api as unknown as { then?: unknown }).then).toBeUndefined()
  })
})
