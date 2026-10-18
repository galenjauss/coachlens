import type { LensState } from './state'

export type TextSpec = { id: number; name: string; x: number; y: number; w: number; h: number; border: boolean; capture: boolean; content: string }
export type ListSpec = { id: number; name: string; x: number; y: number; w: number; h: number; items: string[] }
/** `key` names the container LAYOUT: same key → only changed texts are upgraded; new key → one rebuild. */
export type PageSpec = { key: string; texts: TextSpec[]; list: ListSpec | null }

const W = 576
const H = 288
const MAX_ITEMS = 20
const MAX_ITEM_CHARS = 64

const t = (id: number, name: string, x: number, y: number, w: number, h: number, content: string, o: { border?: boolean; capture?: boolean } = {}): TextSpec =>
  ({ id, name, x, y, w, h, content, border: o.border ?? false, capture: o.capture ?? false })

/** Whole-minute time text, so the lens changes at most once a minute: '3m left' | '<1m left' | '+2m over'. */
export function minutesLeft(minutes: number, startedAt: number, now: number): string {
  const leftMs = minutes * 60_000 - (now - startedAt)
  if (leftMs >= 0) {
    const m = Math.floor(leftMs / 60_000)
    return m < 1 ? '<1m left' : `${m}m left`
  }
  return `+${Math.ceil(-leftMs / 60_000)}m over`
}

export function bar(fraction: number, width = 24): string {
  const f = Math.max(0, Math.min(width, Math.round(fraction * width)))
  return '━'.repeat(f) + '─'.repeat(width - f)
}

const dots = (covered: number, present: number) => {
  const c = Math.min(covered, 14)
  return '●'.repeat(c) + '○'.repeat(Math.max(0, Math.min(present, 14) - c))
}

/** Panel layout: header, bordered body (captures input), footer. One key for every panel. */
function panel(header: string, body: string, footer: string): PageSpec {
  return { key: 'panel', list: null, texts: [
    t(1, 'hdr', 0, 0, W, 40, header),
    t(2, 'body', 0, 44, W, 196, body, { border: true, capture: true }),
    t(3, 'foot', 0, 246, W, 40, footer),
  ] }
}

function listPage(name: string, header: string, rawItems: string[]): PageSpec {
  const items = (rawItems.length ? rawItems : ['(empty)']).slice(0, MAX_ITEMS).map(i => i.slice(0, MAX_ITEM_CHARS))
  return { key: `list:${name}`, texts: [t(1, 'hdr', 0, 0, W, 40, header)],
    list: { id: 2, name: 'list', x: 0, y: 44, w: W, h: H - 44, items } }
}

const DARK: PageSpec = { key: 'dark', list: null, texts: [t(1, 'dark', 0, 0, W, H, '', { capture: true })] }

function context(s: LensState, now: number) {
  const drills = s.today?.deck.drills ?? []
  const active = drills.find(d => d.id === s.active?.drillId) ?? null
  const time = active && s.active ? minutesLeft(active.minutes, s.active.startedAt, now) : ''
  const cov = `Feedback ${s.coverage.covered}/${s.coverage.present}`
  const nextLine = s.nextStudent ? `> Next feedback: ${s.nextStudent.name} (${s.nextStudent.reason})` : s.coverage.present ? '> Everyone has feedback ✓' : ''
  const drillHeader = active ? `${active.name.toUpperCase()} · ${time}` : cov
  return { drills, active, time, cov, nextLine, drillHeader }
}

function home(s: LensState): PageSpec {
  const td = s.today
  let body: string
  if (td) {
    const action = s.starting ? 'Starting class…' : s.loadError ? `${s.loadError} · tap to retry` : '> Tap to start class'
    body = `${td.className} · ${td.startTime}\nTheme: ${td.theme}\n${td.planUnit}: ${td.deck.drills.length}\n\n${action}`
  } else if (s.loadError) {
    body = `Can't load class.\n${s.loadError}\n\n> Tap to retry`
  } else {
    body = 'Loading class…\nPair on your phone if this stays.'
  }
  return panel('COACHLENS', body, s.status ?? '2×: exit')
}

function peek(s: LensState, now: number): PageSpec {
  const c = context(s, now)
  const frac = c.active && s.active ? (now - s.active.startedAt) / (c.active.minutes * 60_000) : 0
  const box = c.active
    ? [`${c.active.name.toUpperCase()}  ${c.time}`, bar(frac), c.active.cues.length ? `cue: ${c.active.cues.join(' · ')}` : ''].join('\n')
    : 'No drill running\n\n> Swipe to pick one'
  return { key: 'peek', list: null, texts: [
    t(1, 'hdrL', 0, 0, 380, 36, `${(s.today?.theme ?? '').toUpperCase()} · ${s.today?.className ?? ''}`),
    t(2, 'hdrR', 384, 0, 192, 36, c.cov),
    t(3, 'box', 0, 40, W, 132, box, { border: true, capture: true }),
    t(4, 'next', 0, 180, W, 40, s.status ?? c.nextLine),
  ] }
}

function wrapup(s: LensState): PageSpec {
  const w = s.wrapup
  if (!w) return panel('CLASS DONE', 'Wrapping up…', '2×: back')
  const missed = w.missed.map(m => m.name).join(', ') || 'nobody!'
  return panel(`CLASS DONE · ${w.minutes} min · ${w.drillsRun} drills`,
    `Feedback ${w.coverage.covered}/${w.coverage.present} ${dots(w.coverage.covered, w.coverage.present)}\nmissed: ${missed}\n${w.agentActions} agent actions · ${w.pendingReview} to review`,
    w.missed.length ? '> Tap: missed kids first next class' : '> Tap to finish')
}

export function render(s: LensState, now: number): PageSpec {
  switch (s.screen) {
    case 'dark': return DARK
    case 'peek': return peek(s, now)
    case 'home': return home(s)
    case 'wrapup': return wrapup(s)
    case 'firstRun':
      return panel('WELCOME TO COACHLENS', 'The lens stays dark while you teach.\ntap: talk · tilt head down: peek\nswipe: deck · 2×: end class / undo\n\n> Pair on your phone, then tap here.', '')
    case 'attendance':
      return panel(`${(s.today?.className ?? '').toUpperCase()} · ${(s.today?.theme ?? '').toUpperCase()}`,
        `Say who's absent\n"Everyone except Jake and Mia"\n\n● Listening… tap when done`, '2×: skip · or check in on phone')
    case 'attendanceDone': {
      const drills = s.today?.deck.drills ?? []
      const mins = drills.reduce((n, d) => n + d.minutes, 0)
      return panel(s.attendanceLines.join(' · '), `${s.today?.planUnit ?? 'Deck'} ready · ${drills.length} · ${mins} min\n${s.today?.focus[0]?.label ?? ''}\n\n> Tap to start the first one`, '')
    }
    case 'deck': {
      const c = context(s, now)
      const unit = (s.today?.planUnit ?? 'Deck').toUpperCase()
      return listPage('deck', `${unit} · ${c.drills.length} · tap to run`,
        c.drills.map(d => `${d.name} · ${d.minutes}m${d.focusStudentIds.length ? ` (${d.focusStudentIds.length} kids)` : ''}`))
    }
    case 'recording': {
      const c = context(s, now)
      return panel(c.drillHeader, `● Listening… ${s.pending?.viaLongPress ? 'release' : 'tap'} to send`, c.nextLine)
    }
    case 'sending': return panel(context(s, now).drillHeader, '● Sending to agents…', '')
    case 'card': {
      const c = context(s, now)
      return panel(c.drillHeader, (s.card?.lines ?? []).join('\n'), `${c.cov} · 2×: undo`)
    }
    case 'disambiguation': {
      const d = s.disambiguation
      return listPage('dis', d ? `Heard "${d.heard}" · who?` : 'Who?', d ? d.options.map(o => o.name) : [])
    }
    case 'confirmEnd': return panel(context(s, now).cov, 'End class?\n\n> Tap to confirm\nAny other gesture cancels', '')
  }
}
