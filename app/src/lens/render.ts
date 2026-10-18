import { progressLines } from './agentRuns'
import type { LensState } from './state'

/** `partial`: same-length changes may be sent as a partial upgrade (contentOffset/contentLength). Keep such content ASCII. */
export type TextSpec = { id: number; name: string; x: number; y: number; w: number; h: number; border: boolean; capture: boolean; content: string; partial?: boolean }
export type ListSpec = { id: number; name: string; x: number; y: number; w: number; h: number; items: string[] }
/** `key` names the container LAYOUT: same key → only changed texts are upgraded; new key → one rebuild. */
export type PageSpec = { key: string; texts: TextSpec[]; list: ListSpec | null }

const W = 576
const H = 288
const MAX_ITEMS = 20
const MAX_ITEM_CHARS = 64

const t = (id: number, name: string, x: number, y: number, w: number, h: number, content: string, o: { border?: boolean; capture?: boolean; partial?: boolean } = {}): TextSpec =>
  ({ id, name, x, y, w, h, content, border: o.border ?? false, capture: o.capture ?? false, ...(o.partial ? { partial: true } : {}) })

/** Whole-minute time text, so the lens changes at most once a minute: '3m left' | '<1m left' | '+2m over'. */
export function minutesLeft(minutes: number, startedAt: number, now: number): string {
  const leftMs = minutes * 60_000 - (now - startedAt)
  if (leftMs >= 0) return leftMs < 60_000 ? '<1m left' : `${Math.ceil(leftMs / 60_000)}m left`
  return `+${Math.ceil(-leftMs / 60_000)}m over`
}

/** Per-second drill clock, ASCII only (partial upgrades): '3:12 left' | '0:00 left' | '+1:05 over'. */
export function clock(minutes: number, startedAt: number, now: number): string {
  const leftMs = minutes * 60_000 - (now - startedAt)
  const fmt = (sec: number) => `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`
  return leftMs >= 0 ? `${fmt(Math.ceil(leftMs / 1000))} left` : `+${fmt(Math.floor(-leftMs / 1000))} over`
}

/** The progress bar only moves every BAR_STEP_MS, so it is re-sent at most that often. */
export const BAR_STEP_MS = 5000

export function bar(fraction: number, width = 24): string {
  const f = Math.max(0, Math.min(width, Math.round(fraction * width)))
  return '━'.repeat(f) + '─'.repeat(width - f)
}

const HDR_MAX = 28
const CUE_MAX = 40
const LINE_MAX = 40
const SAID_COLS = 20
const SAID_LINES = 3
/** One line, at most `n` chars, ending in an ellipsis when cut. */
export const clip = (text: string, n: number): string => (text.length <= n ? text : `${text.slice(0, n - 1).trimEnd()}…`)

/** Word-wrap into at most `maxLines` lines of `cols` chars; ends in an ellipsis when text was cut. */
export function wrap(text: string, cols: number, maxLines: number): string[] {
  const words = text.trim().split(/\s+/).filter(Boolean)
  const lines: string[] = []
  let i = 0
  while (i < words.length && lines.length < maxLines) {
    let line = clip(words[i]!, cols)
    i++
    while (i < words.length && line.length + 1 + words[i]!.length <= cols) { line += ` ${words[i]}`; i++ }
    lines.push(line)
  }
  if (i < words.length && lines.length) {
    const last = lines[lines.length - 1]!
    lines[lines.length - 1] = last.length < cols ? `${last}…` : `${last.slice(0, cols - 1).trimEnd()}…`
  }
  return lines
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
  const n = s.classes.length
  const shownId = s.selectedClassId ?? td?.classId
  const shown = s.classes.find(c => c.id === shownId)
  const pos = n > 1 && shown ? ` (${s.classes.indexOf(shown) + 1}/${n})` : ''
  const footer = s.status ?? (n > 1 ? 'swipe: change class · 2×: exit' : '2×: exit')
  if (s.selectedClassId && shown && td?.classId !== s.selectedClassId) {
    return panel(`COACHLENS${pos}`, `${shown.name}\n${shown.modeLabel}\n\nLoading class…`, footer)
  }
  let body: string
  if (td) {
    const action = s.starting ? 'Starting class…' : s.loadError ? `${s.loadError} · tap to retry` : '> Tap to start class'
    body = `${td.className} · ${td.startTime}\n${td.modeLabel} · ${td.theme}\n${td.planUnit}: ${td.deck.drills.length}\n\n${action}`
  } else if (s.loadError) {
    body = `Can't load class.\n${s.loadError}\n\n> Tap to retry`
  } else {
    body = 'Loading class…\nPair on your phone if this stays.'
  }
  return panel(`COACHLENS${pos}`, body, footer)
}

/**
 * Peek: the class-time rest screen. The clock has its own small ASCII container so the per-second
 * update is a partial upgrade of a few characters; the bar sits in the box and moves every 5 s.
 */
function peek(s: LensState, now: number): PageSpec {
  const c = context(s, now)
  const a = c.active && s.active ? { drill: c.active, startedAt: s.active.startedAt } : null
  const total = a ? a.drill.minutes * 60_000 : 1
  const elapsed = a ? now - a.startedAt : 0
  const barFrac = (elapsed - (((elapsed % BAR_STEP_MS) + BAR_STEP_MS) % BAR_STEP_MS)) / total
  const box = a
    ? [bar(barFrac), a.drill.cues.length ? clip(`cue: ${a.drill.cues.join(' · ')}`, CUE_MAX) : ''].join('\n')
    : '> Swipe to pick one'
  return { key: 'peek', list: null, texts: [
    t(1, 'hdrL', 0, 0, 380, 40, clip(`${(s.today?.theme ?? '').toUpperCase()} · ${s.today?.className ?? ''}`, HDR_MAX)),
    t(2, 'hdrR', 384, 0, 192, 40, c.cov),
    t(3, 'drill', 0, 44, 396, 40, a ? clip(a.drill.name.toUpperCase(), 26) : 'No drill running'),
    t(4, 'timer', 400, 44, 176, 40, a ? clock(a.drill.minutes, a.startedAt, now) : '', { partial: true }),
    t(5, 'box', 0, 88, W, 88, box, { border: true, capture: true }),
    t(6, 'next', 0, 184, W, 40, s.status ?? c.nextLine),
  ] }
}

/** Agent card: result header, what was said (left), live agent progress (right), footer. */
function card(s: LensState, now: number): PageSpec {
  const c = context(s, now)
  const cd = s.card
  const said = cd?.transcript ? wrap(`"${cd.transcript}"`, SAID_COLS, SAID_LINES).join('\n') : '(no transcript)'
  return { key: 'card', list: null, texts: [
    t(1, 'hdr', 0, 0, W, 40, clip((cd?.lines ?? []).join(' · ') || c.drillHeader, LINE_MAX)),
    t(2, 'said', 0, 44, 300, 196, `You said:\n${said}`, { border: true, capture: true }),
    t(3, 'agents', 304, 44, 272, 196, cd ? progressLines(cd).join('\n') : ''),
    t(4, 'foot', 0, 246, W, 40, `${c.cov} · tap: close · 2×: undo`),
  ] }
}

function attendance(s: LensState): PageSpec {
  const enrolled = s.today?.roster.length ?? 0
  return panel(clip(`${(s.today?.className ?? '').toUpperCase()} · ${(s.today?.theme ?? '').toUpperCase()}`, LINE_MAX),
    `Roll call · ${enrolled} enrolled\nSay "Everyone except …"\nor "Present: …"\n\n● Listening… tap when done`, '2×: skip · or check in on phone')
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
      return panel('WELCOME TO COACHLENS', 'Your drill and timer stay on the lens.\ntap: talk · nod: lens off/on\nswipe: deck · 2×: end class / undo\n\n> Pair on your phone, then tap here.', '')
    case 'attendance': return attendance(s)
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
    case 'card': return card(s, now)
    case 'disambiguation': {
      const d = s.disambiguation
      return listPage('dis', d ? `Heard "${d.heard}" · who?` : 'Who?', d ? d.options.map(o => o.name) : [])
    }
    case 'confirmEnd': return panel(context(s, now).cov, 'End class?\n\n> Tap to confirm\nAny other gesture cancels', '')
  }
}
