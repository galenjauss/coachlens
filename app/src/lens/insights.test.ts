import { describe, expect, it } from 'vitest'
import type { Insight, Today } from '@matside/shared'
import { INSIGHT_BANNER_MS, INSIGHT_GLYPH } from '../config'
import { topInsight } from './insights'
import { BANNER_HIDDEN, STATUS_MS, initialState, reduce } from './reducer'
import { ANSWER_HEADER, BRIEF_HINT, INSIGHT_HINT, remindHint, render, summaryRow, type PageSpec } from './render'
import type { Card, LensEvent, LensState } from './state'
import { colsFor, fitNames, rowsFor } from './text'

const drill = (id: string, name: string) => ({ id, position: 1, name, minutes: 5, kind: 'technique' as const, cues: [], focusStudentIds: [], rationale: '', startedAt: null, endedAt: null })
const today = {
  classId: 'c1', className: 'Kids · Tue', startTime: '17:00', forDate: '2026-10-20', sessionId: null, theme: 'Stances', formsDue: [], focus: [], roster: [],
  mode: 'martial_arts', modeLabel: 'Martial arts', weeklyLabel: 'Weekly theme', itemsDueLabel: 'Forms due', planUnit: 'Drill deck', people: 'students',
  deck: { id: 'k1', classId: 'c1', forDate: '2026-10-20', status: 'draft', drills: ['Tag', 'Holds', 'Sprawls', 'Kata'].map((n, i) => drill(`d${i}`, n)) },
} as Today
const ins = (id: string, o: Partial<Insight> = {}): Insight => ({
  id, kind: 'no_feedback', studentId: 'j', studentName: 'Jake', classId: 'c1', title: 'Jake: no feedback in 3 classes',
  detail: 'Last note Oct 2 · a quick word on his guard today would help', urgency: 'high', status: 'new',
  createdAt: '2026-10-20T17:05:00Z', actionLabel: 'Plan focus', ...o,
})
const SESSION_START = Date.parse('2026-10-20T17:00:00Z')
const peekState: LensState = {
  ...initialState(true), screen: 'peek', today, session: { id: 's1', startedAt: SESSION_START },
  coverage: { covered: 3, present: 12 }, nextStudent: { id: 'p', name: 'Priya', reason: 'guard' },
}
const run = (s: LensState, ...events: LensEvent[]) => events.reduce<{ state: LensState; effects: unknown[] }>((acc, e) => {
  const r = reduce(acc.state, e); return { state: r.state, effects: [...acc.effects, ...r.effects] }
}, { state: s, effects: [] })
const polled = (...insights: Insight[]): LensEvent => ({ type: 'insightsLoaded', scope: 'session', insights })
const txt = (p: PageSpec, name: string) => p.texts.find(t => t.name === name)?.content

describe('mid-class insight banner', () => {
  it('a new high item shows atop peek for INSIGHT_BANNER_MS, then collapses to a ★1 suffix', () => {
    let r = run(peekState, polled(ins('a')))
    expect(r.state.insightBanner?.id).toBe('a')
    expect(r.effects).toEqual([{ type: 'expireBanner', ms: INSIGHT_BANNER_MS }])
    expect(INSIGHT_BANNER_MS).toBe(8000)
    let p = render(r.state, 0)
    expect(txt(p, 'hdr')).toBe(`${INSIGHT_GLYPH} Jake: no feedback in 3 classes`)
    expect(txt(p, 'drill')).toContain('Last note Oct 2')
    expect(txt(p, 'next')).not.toContain(INSIGHT_GLYPH) // the banner itself is not "unseen"
    const peekKey = render(peekState, 0).key
    expect(p.key).toBe(peekKey) // same layout: only the changed containers are re-sent

    r = run(r.state, { type: 'bannerExpired' })
    expect(r.state.insightBanner).toBeNull()
    expect(r.state.insightUnseen.map(i => i.id)).toEqual(['a'])
    p = render(r.state, 0)
    expect(txt(p, 'hdr')).toBe(render(peekState, 0).texts[0]!.content) // the class header is back
    expect(txt(p, 'next')).toBe(`> Next feedback: Priya (guard) ${INSIGHT_GLYPH}1`)
  })

  it('a poll never re-shows a known item; low urgency and handled items never banner', () => {
    const shown = run(peekState, polled(ins('a'))).state
    const again = reduce(shown, polled(ins('a'), ins('low', { urgency: 'low' }), ins('done', { status: 'dismissed' })))
    expect(again.state).toBe(shown) // nothing new: no state change, no repaint
    expect(again.effects).toEqual([])
    const second = run(shown, polled(ins('a'), ins('b'))).state
    expect(second.insightBanner?.id).toBe('a') // one banner at a time
    expect(second.insightUnseen.map(i => i.id)).toEqual(['b'])
  })

  it('tap on the banner dismisses it (no recording); swipe opens the detail', () => {
    const shown = run(peekState, polled(ins('a'))).state
    const tapped = run(shown, { type: 'tap' })
    expect(tapped.state).toMatchObject({ screen: 'peek', insightBanner: null, insightUnseen: [], status: BANNER_HIDDEN, pending: null })
    expect(tapped.effects).toEqual([{ type: 'expireStatus', ms: STATUS_MS }]) // no startMic: the tap hid the banner
    expect(BANNER_HIDDEN).toBe('Insight hidden · tap to record')
    expect(txt(render(tapped.state, 0), 'next')).toBe(BANNER_HIDDEN)
    expect(run(tapped.state, { type: 'tap' }).state.screen).toBe('recording') // the next tap records
    const swiped = run(shown, { type: 'swipeDown' })
    expect(swiped.state).toMatchObject({ screen: 'insight', insightBanner: null })
    expect(swiped.state.insightDetail?.id).toBe('a')
    const p = render(swiped.state, 0)
    expect(txt(p, 'hdr')).toBe(`${INSIGHT_GLYPH} INSIGHT · Jake · Plan focus on phone`)
    expect(txt(p, 'body')).toContain('Jake: no feedback in 3 classes')
    expect(txt(p, 'foot')).toBe(INSIGHT_HINT)
    expect(run(swiped.state, { type: 'tap' }).state).toMatchObject({ screen: 'peek', insightDetail: null })
    expect(run(swiped.state, { type: 'swipeUp' }).state.screen).toBe('deck')
  })

  it('long-press or double-tap still work while the banner is up (it collapses to the suffix)', () => {
    const shown = run(peekState, polled(ins('a'))).state
    const hold = run(shown, { type: 'longPress' })
    expect(hold.state.screen).toBe('recording')
    expect(hold.state.insightUnseen.map(i => i.id)).toEqual(['a'])
    expect(run(shown, { type: 'doubleTap' }).state).toMatchObject({ screen: 'confirmEnd', insightBanner: null })
  })

  it('after the collapse, swipe on peek opens the unseen insight once, then the deck', () => {
    const collapsed = run(peekState, polled(ins('a')), { type: 'bannerExpired' }).state
    const open = run(collapsed, { type: 'swipeDown' }).state
    expect(open.screen).toBe('insight')
    expect(open.insightUnseen).toEqual([]) // seen
    const back = run(open, { type: 'doubleTap' }).state
    expect(back.screen).toBe('peek')
    expect(txt(render(back, 0), 'next')).not.toContain(INSIGHT_GLYPH)
    expect(run(back, { type: 'swipeDown' }).state.screen).toBe('deck')
  })

  it('never interrupts recording, the card, planning or a dark lens: it waits behind the suffix', () => {
    const card: Card = { lines: ['√ Jake · guard'], transcript: 'Jake guard up', utteranceId: 'u', runs: null, runsFinal: false, page: 0 }
    const screens: Array<Partial<LensState>> = [
      { screen: 'recording', pending: { mode: 'note', returnTo: 'peek', viaLongPress: false, at: 0 }, mic: { tick: 0, audio: true, source: 'glasses' } },
      { screen: 'card', card },
      { screen: 'sending', pending: { mode: 'note', returnTo: 'peek', viaLongPress: false, at: 0 } },
      { screen: 'dark', darkFrom: 'peek' },
      { screen: 'deck' },
    ]
    for (const over of screens) {
      const st = { ...peekState, ...over } as LensState
      const r = run(st, polled(ins('a')))
      expect(r.state.screen).toBe(st.screen)
      expect(r.state.insightBanner).toBeNull()
      expect(r.state.insightUnseen.map(i => i.id)).toEqual(['a'])
      expect(r.effects).toEqual([])
      expect(JSON.stringify(render(r.state, 0))).toBe(JSON.stringify(render(st, 0))) // the screen itself is untouched
    }
    // Planning happens before class: no session, nothing is surfaced.
    const planning = { ...peekState, session: null, screen: 'planning' as const, planning: { stage: 'listening' as const, sec: 1, heard: '' } }
    expect(reduce(planning, polled(ins('a'))).state).toBe(planning)
  })

  it('an insight polled in during roll call becomes the banner when the tap leaves for peek', () => {
    const cov = { covered: 0, present: 12 }
    const sending = { ...peekState, screen: 'sending' as const, active: null, pending: { mode: 'attendance' as const, returnTo: 'peek' as const, viaLongPress: false, at: 0 } }
    const res = { utteranceId: 'u', transcript: 'x', cardLines: ['12 present'], coverage: cov, nextStudent: null, disambiguation: null }
    const roll = run(sending, { type: 'utteranceResult', res }, polled(ins('back', { kind: 'returning_student', title: "Jake's back" })))
    expect(roll.state.screen).toBe('attendanceDone')
    expect(roll.state.insightBanner).toBeNull()
    expect(roll.state.insightUnseen.map(i => i.id)).toEqual(['back'])
    const r = reduce(roll.state, { type: 'tap', now: SESSION_START })
    expect(r.state).toMatchObject({ screen: 'peek', insightUnseen: [] })
    expect(r.state.insightBanner?.id).toBe('back')
    expect(r.effects).toContainEqual({ type: 'expireBanner', ms: INSIGHT_BANNER_MS })
    expect(r.effects).toContainEqual(expect.objectContaining({ type: 'logDrill', event: 'start' }))
  })

  it('dismissing the card to peek promotes a pending high insight; with none pending it is a plain peek', () => {
    const card: Card = { lines: ['√ Jake · present'], transcript: 'mark Jake present', utteranceId: 'u', runs: null, runsFinal: false, page: 0 }
    const onCard = run({ ...peekState, screen: 'card', card }, polled(ins('a'))).state
    const r = reduce(onCard, { type: 'tap' })
    expect(r.state).toMatchObject({ screen: 'peek', card: null, insightUnseen: [] })
    expect(r.state.insightBanner?.id).toBe('a')
    expect(r.effects).toEqual([{ type: 'expireBanner', ms: INSIGHT_BANNER_MS }])
    const plain = reduce({ ...peekState, screen: 'card', card }, { type: 'tap' })
    expect(plain.state).toMatchObject({ screen: 'peek', insightBanner: null })
    expect(plain.effects).toEqual([])
  })

  it('a new session and the end of class clear every insight surface', () => {
    const st = run(peekState, polled(ins('a'), ins('b'))).state
    const started = run({ ...st, session: null }, { type: 'sessionStarted', res: { sessionId: 's2', startedAt: '2026-10-20T18:00:00Z', coverage: { covered: 0, present: 0 }, nextStudent: null }, resumed: true, now: 0 }).state
    expect(started).toMatchObject({ insightBanner: null, insightUnseen: [], insightKnown: [] })
  })
})

describe('lobby insight', () => {
  const lobby: LensState = { ...initialState(true), screen: 'lobby', today }
  it('home tap asks for the class insight; the top one (high first) fills the two-row slot', () => {
    const r = run({ ...initialState(true), today }, { type: 'tap' })
    expect(r.effects).toEqual([{ type: 'loadInsights', classId: 'c1' }])
    const low = ins('low', { urgency: 'low', title: 'Mia is close to her next belt' })
    const st = run(lobby, { type: 'insightsLoaded', scope: 'lobby', classId: 'c1', insights: [low, ins('hi')] }).state
    expect(st.lobbyInsight?.id).toBe('hi')
    const p = render(st, 0)
    expect(p.key).toBe('lobbyI')
    expect(txt(p, 'insight')).toBe(`${INSIGHT_GLYPH} Jake: no feedback in 3 classes\nLast note Oct 2 · a quick word on his…`)
    expect(txt(p, 'body')).toBe('1 Tag · 5m\n2 Holds · 5m\n3 Sprawls · 5m\n+1 more')
    expect(txt(p, 'foot')).toBe('tap start · 2× plan · swipe back')
    expect(p.texts.filter(t => t.capture)).toHaveLength(1)
  })
  it('nothing renders without an insight; another class\'s answer is ignored; a class change clears it', () => {
    expect(txt(render(lobby, 0), 'insight')).toBe('')
    expect(render(lobby, 0).key).toBe('lobby')
    expect(reduce(lobby, { type: 'insightsLoaded', scope: 'lobby', classId: 'c2', insights: [ins('x')] }).state).toBe(lobby)
    expect(reduce(lobby, { type: 'insightsLoaded', scope: 'lobby', classId: 'c1', insights: [] }).state).toBe(lobby)
    const filled = run(lobby, { type: 'insightsLoaded', scope: 'lobby', classId: 'c1', insights: [ins('x')] }).state
    expect(run(filled, { type: 'todayLoaded', today: { ...today, classId: 'c2' } }).state.lobbyInsight).toBeNull()
    expect(run(filled, { type: 'todayLoaded', today }).state.lobbyInsight?.id).toBe('x')
  })
  it('a lobby error or start line takes the "+N more" row when the banner is up', () => {
    const filled = run(lobby, { type: 'insightsLoaded', scope: 'lobby', classId: 'c1', insights: [ins('x')] }).state
    expect(txt(render({ ...filled, starting: true }, 0), 'body')).toBe('1 Tag · 5m\n2 Holds · 5m\n3 Sprawls · 5m\nStarting class…')
  })
})

describe('end-of-class summary', () => {
  const wrapup = { sessionId: 's1', minutes: 40, drillsRun: 6, coverage: { covered: 9, present: 12 }, agentActions: 7, pendingReview: 3,
    missed: ['Jake', 'Mia', 'Leo'].map((name, i) => ({ id: `${i}`, name })) }
  const atWrap: LensState = { ...peekState, screen: 'wrapup', wrapup }
  it('≤4 rows: time · drills · feedback, missed, agent actions, the top insight; the exact tap hint', () => {
    const st = run(atWrap, { type: 'insightsLoaded', scope: 'wrapup', insights: [ins('old', { createdAt: '2026-10-19T10:00:00Z', title: 'Old news' }), ins('now', { urgency: 'low', title: 'Leo hit a new PR' })] }).state
    expect(st.wrapupInsight?.id).toBe('now') // this session's first, even when an older one is high
    const p = render(st, 0)
    expect(txt(p, 'body')!.split('\n')).toEqual([
      '40 min · 6 drills · 9/12 got feedback',
      'Missed: Jake, Mia, Leo',
      '7 agent actions · 3 to review',
      `${INSIGHT_GLYPH} Leo hit a new PR`,
    ])
    expect(txt(p, 'foot')).toBe('tap: put Jake, Mia first next class\n2×: done')
    expect(txt(p, 'hdr')).toBe('CLASS DONE')
  })
  it('without an insight it is 3 rows; nobody missed means tap is just done', () => {
    const p = render({ ...atWrap, wrapup: { ...wrapup, missed: [], drillsRun: 1, agentActions: 1 } }, 0)
    expect(txt(p, 'body')).toBe('40 min · 1 drill · 9/12 got feedback\nMissed: nobody!\n1 agent action · 3 to review')
    expect(txt(p, 'foot')).toBe('tap: done')
  })
  it('tap = remind (missed first next class) and home; double-tap = home; insights are cleared', () => {
    const st = run(atWrap, { type: 'insightsLoaded', scope: 'wrapup', insights: [ins('now')] }).state
    const tap = run(st, { type: 'tap' })
    expect(tap.effects).toContainEqual({ type: 'remind', sessionId: 's1', studentIds: ['0', '1', '2'], names: ['Jake', 'Mia', 'Leo'] })
    expect(tap.state).toMatchObject({ screen: 'home', wrapupInsight: null, insightUnseen: [] })
    const dbl = run(st, { type: 'doubleTap' })
    expect(dbl.state.screen).toBe('home')
    expect(dbl.effects.some(e => (e as { type: string }).type === 'remind')).toBe(false)
  })
  it('the hint drops names that do not fit (they are listed in row 2), never splitting one', () => {
    expect(remindHint(['Jake', 'Mia'])).toBe('tap: put Jake, Mia first next class')
    expect(remindHint(['Alexandria', 'Bartholomew'])).toBe('tap: put Alexandria first next class')
    expect(remindHint(['Maximilianus-Augustin'])).toBe('tap: put 1 kid first next class')
    for (const n of [['A'], ['Jake', 'Mia', 'Leo', 'Ann'], ['Christopher', 'Bo']]) expect(remindHint(n).length).toBeLessThanOrEqual(colsFor(576))
    expect(fitNames(['Jake', 'Mia', 'Leo'], 12)).toBe('Jake, Mia +1')
  })
  it('row 1 never cuts the feedback count: "fed back" when "got feedback" does not fit, then the time is cut', () => {
    const big = { ...wrapup, minutes: 120, drillsRun: 12, coverage: { covered: 10, present: 12 } }
    expect(`120 min · 12 drills · 10/12 got feedback`.length).toBeGreaterThan(colsFor(576, true))
    expect(summaryRow(big)).toBe('120 min · 12 drills · 10/12 fed back')
    expect(txt(render({ ...atWrap, wrapup: big }, 0), 'body')!.split('\n')[0]).toBe('120 min · 12 drills · 10/12 fed back')
    expect(summaryRow(wrapup)).toBe('40 min · 6 drills · 9/12 got feedback')
    const huge = { ...wrapup, minutes: 1200, drillsRun: 120, coverage: { covered: 100, present: 120 } }
    expect(summaryRow(huge, 30)).toBe('1200 min… · 100/120 fed back') // drills cut at a word boundary, count intact
    expect(summaryRow(huge, 30).endsWith(' · 100/120 fed back')).toBe(true)
    expect(summaryRow(huge, 30).length).toBeLessThanOrEqual(30)
  })
  it('a late wrap-up insight after the coach left the screen is ignored', () => {
    const home = { ...atWrap, screen: 'home' as const }
    expect(reduce(home, { type: 'insightsLoaded', scope: 'wrapup', insights: [ins('x')] }).state).toBe(home)
  })
})

describe('student brief on the agent card', () => {
  const brief = { name: 'Jake · green belt', lines: ['12 classes · last Oct 14', 'Open: guard drops (3 notes)', 'Best: 42 push-ups (Oct 9)', 'Report card: sent Oct 1'] }
  const res = { utteranceId: 'u1', transcript: 'how is Jake doing', cardLines: ['Jake · brief'], coverage: { covered: 3, present: 12 }, nextStudent: null, disambiguation: null, brief }
  const sending: LensState = { ...peekState, screen: 'sending', pending: { mode: 'note', returnTo: 'peek', viaLongPress: false, at: 0 } }
  it('page 1 shows the brief in place of agent progress; swipe pages to the transcript and back', () => {
    let st = run(sending, { type: 'utteranceResult', res }).state
    expect(st.card?.brief).toEqual(brief)
    let p = render(st, 0)
    expect(txt(p, 'hdr')).toBe('1/2 swipe · Jake · green belt')
    expect(txt(p, 'said')).toBe(brief.lines.join('\n'))
    expect(txt(p, 'agents')).toBe(`${BRIEF_HINT}\ntap: close · 2×: undo`)
    st = run(st, { type: 'swipeDown' }).state
    expect(st.card?.page).toBe(1)
    p = render(st, 0)
    expect(txt(p, 'hdr')).toBe('2/2 swipe · Jake · brief')
    expect(txt(p, 'said')).toBe('"how is Jake doing"')
    expect(txt(p, 'agents')).not.toContain(BRIEF_HINT)
    expect(run(st, { type: 'swipeDown' }).state).toBe(st) // last page
    expect(run(st, { type: 'swipeUp' }).state.card?.page).toBe(0)
  })
  it('without a brief the card is unchanged (transcript first)', () => {
    const st = run(sending, { type: 'utteranceResult', res: { ...res, brief: undefined } }).state
    expect(st.card?.brief).toBeNull()
    expect(txt(render(st, 0), 'said')).toBe('"how is Jake doing"')
    expect(reduce(st, { type: 'swipeDown' }).state).toBe(st)
  })
})

describe('class-question answer on the agent card', () => {
  const answer = { name: 'Answer', lines: ['Guard: Priya (3), Leo (2), Sam (1)'] }
  const res = { utteranceId: 'u2', transcript: 'who is forgetting to keep their guard up', cardLines: ['? Who is forgetting to keep their…'], coverage: { covered: 3, present: 12 }, nextStudent: null, disambiguation: null, brief: answer }
  const sending: LensState = { ...peekState, screen: 'sending', pending: { mode: 'note', returnTo: 'peek', viaLongPress: false, at: 0 } }
  it('the brief page is headed ANSWER (not a student name); swipe still reaches the transcript', () => {
    let st = run(sending, { type: 'utteranceResult', res }).state
    let p = render(st, 0)
    expect(txt(p, 'hdr')).toBe(`1/2 swipe · ${ANSWER_HEADER}`)
    expect(txt(p, 'said')).toBe('Guard: Priya (3), Leo (2), Sam (1)')
    expect(txt(p, 'agents')).toBe(`${BRIEF_HINT}\ntap: close · 2×: undo`)
    st = run(st, { type: 'swipeDown' }).state
    p = render(st, 0)
    expect(txt(p, 'hdr')).toMatch(/^2\/2 swipe · \? Who is forgetting/)
  })
})

describe('insight surfaces stay within the G2 limits', () => {
  const long = ins('L', { title: 'Priyanka Venkataraman has not had feedback in four classes', detail: 'x '.repeat(5) + 'Her last note was about sign errors moving terms across the equals sign; a quick check-in today would close the loop before report cards go out'.slice(0, 140), studentName: 'Priyanka Venkataraman', actionLabel: 'Draft parent email' })
  const card: Card = { lines: ['√ x'], transcript: 'how is Priyanka doing', utteranceId: 'u', runs: null, runsFinal: false, page: 0, brief: { name: 'Priyanka Venkataraman · algebra', lines: ['a'.repeat(38), 'b', 'c', 'd', 'e'] } }
  const states: LensState[] = [
    { ...peekState, insightBanner: long, insightUnseen: [long, long], queued: 3 },
    { ...peekState, screen: 'insight', insightDetail: long },
    { ...peekState, screen: 'lobby', session: null, lobbyInsight: long, loadError: 'Server error 503 while starting' },
    { ...peekState, screen: 'wrapup', wrapupInsight: long, wrapup: { sessionId: 's', minutes: 120, drillsRun: 12, coverage: { covered: 10, present: 12 }, agentActions: 17, pendingReview: 13, missed: ['Alexander', 'Benjamin', 'Charlotte'].map((name, i) => ({ id: `${i}`, name })) } },
    { ...peekState, screen: 'card', card },
  ]
  it('every line fits its container, rows fit, ≤8 texts, exactly one capture', () => {
    for (const st of states) {
      const p = render(st, 0)
      expect(p.texts.length).toBeLessThanOrEqual(8)
      expect(p.texts.filter(t => t.capture).length + (p.list ? 1 : 0)).toBe(1)
      for (const t of p.texts) {
        expect(t.name.length).toBeLessThanOrEqual(16)
        const lines = t.content ? t.content.split('\n') : []
        expect(lines.length, `${st.screen}/${t.name}`).toBeLessThanOrEqual(rowsFor(t.h, t.border))
        for (const l of lines) expect(l.length, `${st.screen}/${t.name}: "${l}"`).toBeLessThanOrEqual(colsFor(t.w, t.border))
      }
    }
  })
  it('topInsight: session items first, then high urgency; handled ones never', () => {
    const a = ins('a', { urgency: 'low' }), b = ins('b', { createdAt: '2026-10-01T00:00:00Z' }), c = ins('c', { status: 'accepted' })
    expect(topInsight([a, b, c])?.id).toBe('b')
    expect(topInsight([a, b, c], SESSION_START)?.id).toBe('a')
    expect(topInsight([c])).toBeNull()
  })
})
