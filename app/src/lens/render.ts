import { QUEUED_GLYPH } from '../config'
import { progressLines } from './agentRuns'
import { SAID_COLS, clip, clipWithSuffix, classHeader, colsFor, paginate, rowsFor, transcriptPages, wrap } from './text'

export { clip, wrap } from './text'
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
  if (leftMs >= 0) return leftMs < 60_000 ? '<1m left' : `${Math.ceil(leftMs / 60_000)}m left`
  return `+${Math.ceil(-leftMs / 60_000)}m over`
}

/**
 * Per-second countdown from the drill start: 3:00 left → 2:59 left → … → 0:00 left → +0:01 over.
 * Each whole second elapsed since `startedAt` takes one second off; the full line is re-sent.
 */
export function clock(minutes: number, startedAt: number, now: number): string {
  const remaining = minutes * 60 - Math.floor(Math.max(0, now - startedAt) / 1000)
  const fmt = (sec: number) => `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`
  return remaining >= 0 ? `${fmt(remaining)} left` : `+${fmt(-remaining)} over`
}

/** The progress bar only moves every BAR_STEP_MS, so it is re-sent at most that often. */
export const BAR_STEP_MS = 5000

export function bar(fraction: number, width = 24): string {
  const f = Math.max(0, Math.min(width, Math.round(fraction * width)))
  return '━'.repeat(f) + '─'.repeat(width - f)
}


/** Char budget of a full-width unbordered line (headers, footers) and of a full-width bordered box. */
const FULL = colsFor(W)
const BOXC = colsFor(W, true)
/** Deck list items: word-boundary cut to one visible line (and the SDK's 64-char cap). */
const ITEM_COLS = Math.min(MAX_ITEM_CHARS, FULL - 2)
/** The "hearing you" line and the thinking dots step this often (≤ 1 lens update per 500 ms). */
export const MIC_TICK_MS = 500

const dots = (covered: number, present: number) => {
  const c = Math.min(covered, 14)
  return '●'.repeat(c) + '○'.repeat(Math.max(0, Math.min(present, 14) - c))
}

/** Every body line wrapped to the box's char budget (blank lines kept). */
const boxed = (body: string, cols = BOXC): string => body.split('\n').flatMap(l => (l ? wrap(l, cols) : [''])).join('\n')

/** Panel layout: header, bordered body (captures input), footer. One key for every panel. */
function panel(header: string, body: string, footer: string): PageSpec {
  return { key: 'panel', list: null, texts: [
    t(1, 'hdr', 0, 0, W, 40, clip(header, FULL)),
    t(2, 'body', 0, 44, W, 196, boxed(body), { border: true, capture: true }),
    t(3, 'foot', 0, 246, W, 40, clip(footer, FULL)),
  ] }
}

function listPage(name: string, header: string, rawItems: string[]): PageSpec {
  const items = (rawItems.length ? rawItems : ['(empty)']).slice(0, MAX_ITEMS).map(i => clip(i, ITEM_COLS))
  return { key: `list:${name}`, texts: [t(1, 'hdr', 0, 0, W, 40, clip(header, FULL))],
    list: { id: 2, name: 'list', x: 0, y: 44, w: W, h: H - 44, items } }
}

/** Agent line on a transcript-first card while the note is still on its way. */
export const SORTING_LINE = '… sorting'

/** Compact status-row suffix while notes wait in the outbox: ` ⟳ 2 queued` ('' when none). */
export const queuedSuffix = (n: number): string => (n > 0 ? ` ${QUEUED_GLYPH} ${n} queued` : '')

/**
 * Status-row lines with the queued suffix: appended to the last line when it fits, else on a spare
 * row when `rows` allows one, else the last line is cut at a word boundary to make room.
 */
function withQueued(lines: string[], n: number, rows = 1, cols = FULL): string[] {
  const suffix = queuedSuffix(n)
  if (!suffix) return lines
  const last = lines.at(-1)
  if (!last) return [...lines.slice(0, -1), suffix.trim()]
  if (last.length + suffix.length <= cols) return [...lines.slice(0, -1), `${last}${suffix}`]
  if (lines.length < rows) return [...lines, suffix.trim()]
  return [...lines.slice(0, -1), clipWithSuffix(last, suffix, cols)]
}

const DARK: PageSpec = { key: 'dark', list: null, texts: [t(1, 'dark', 0, 0, W, H, '', { capture: true })] }

function context(s: LensState, now: number) {
  const drills = s.today?.deck.drills ?? []
  const active = drills.find(d => d.id === s.active?.drillId) ?? null
  const time = active && s.active ? minutesLeft(active.minutes, s.active.startedAt, now) : ''
  const cov = `Feedback ${s.coverage.covered}/${s.coverage.present}`
  const nextLine = s.nextStudent ? `> Next feedback: ${s.nextStudent.name} (${s.nextStudent.reason})` : s.coverage.present ? '> Everyone has feedback' : ''
  const drillHeader = active ? clipWithSuffix(active.name.toUpperCase(), ` · ${time}`, FULL) : cov
  return { drills, active, time, cov, nextLine, drillHeader }
}

function home(s: LensState): PageSpec {
  const td = s.today
  const n = s.classes.length
  const shownId = s.selectedClassId ?? td?.classId
  const shown = s.classes.find(c => c.id === shownId)
  const pos = n > 1 && shown ? ` (${s.classes.indexOf(shown) + 1}/${n})` : ''
  const footer = withQueued([s.status ?? (n > 1 ? 'swipe: change class · 2×: exit' : '2×: exit')], s.queued)[0]!
  if (s.selectedClassId && shown && td?.classId !== s.selectedClassId) {
    return panel(`COACHLENS${pos}`, `${shown.name}\n${shown.modeLabel}\n\n${s.loadError ? `${s.loadError} · tap to retry` : 'Loading class…'}`, footer)
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

/*
 * Peek geometry. The drill name gets two lines on the left; the clock and feedback count stack on the
 * right, so the name never shares a line it can't fit in. The box (bar + cues) and the next line
 * share what is left; peekFit decides how.
 */
const PEEK = { nameW: 356, sideX: 360, sideW: 216, boxY: 120, next2Y: 216, next1Y: 248 }
const NAME_COLS = colsFor(PEEK.nameW)
const BOX_ROWS_2 = rowsFor(PEEK.next2Y - 4 - PEEK.boxY, true) // box rows when the next line keeps 2 rows
const BOX_ROWS_1 = rowsFor(PEEK.next1Y - 4 - PEEK.boxY, true) // ... when it is moved to 1 row
const cueLines = (cues: string[]) => (cues.length ? wrap(`cue: ${cues.join(' · ')}`, BOXC) : [])

/**
 * Fit the drill's cues in the peek box, shrinking in order: drop the bar → drop the 2nd+ cues →
 * move the next-feedback line to one row → (last resort) cut the cue at a word boundary and point to
 * the deck detail, which always shows the full drill. Depends only on the drill, so the layout is
 * stable while it runs.
 */
export function peekFit(cues: string[]): { bar: boolean; cues: string[]; nextRows: 1 | 2; more: boolean } {
  const all = cueLines(cues)
  const one = cueLines(cues.slice(0, 1))
  if (all.length + 1 <= BOX_ROWS_2) return { bar: true, cues: all, nextRows: 2, more: false }
  if (all.length <= BOX_ROWS_2) return { bar: false, cues: all, nextRows: 2, more: false }
  if (one.length <= BOX_ROWS_2) return { bar: false, cues: one, nextRows: 2, more: false }
  if (one.length <= BOX_ROWS_1) return { bar: false, cues: one, nextRows: 1, more: false }
  return { bar: false, cues: wrap(`cue: ${cues[0]}`, BOXC, BOX_ROWS_1), nextRows: 1, more: true }
}

/**
 * Peek: the class-time rest screen. The clock has its own small container, so the per-second update
 * re-sends only ~10 characters; the bar sits in the box and moves every 5 s. Nothing is cut mid-word.
 */
function peek(s: LensState, now: number): PageSpec {
  const c = context(s, now)
  const a = c.active && s.active ? { drill: c.active, startedAt: s.active.startedAt } : null
  const fit = a ? peekFit(a.drill.cues) : { bar: false, cues: [], nextRows: 2 as const, more: false }
  const total = a ? a.drill.minutes * 60_000 : 1
  const elapsed = a ? now - a.startedAt : 0
  const barFrac = (elapsed - (((elapsed % BAR_STEP_MS) + BAR_STEP_MS) % BAR_STEP_MS)) / total
  const box = a ? [...(fit.bar ? [bar(barFrac)] : []), ...fit.cues].join('\n') || bar(barFrac) : '> Swipe to pick one'
  const nextY = fit.nextRows === 2 ? PEEK.next2Y : PEEK.next1Y
  const short = s.nextStudent ? `> Next: ${s.nextStudent.name}` : c.nextLine
  const nextText = s.status ?? (fit.more ? 'swipe: full drill in the deck' : fit.nextRows === 2 ? c.nextLine : short)
  const td = s.today
  return { key: `peek${fit.nextRows}`, list: null, texts: [
    t(1, 'hdr', 0, 0, W, 40, td ? classHeader(td.theme, td.className, td.modeLabel, FULL) : ''),
    t(2, 'drill', 0, 44, PEEK.nameW, 72, a ? wrap(a.drill.name, NAME_COLS, 2).join('\n') : 'No drill running'),
    t(3, 'timer', PEEK.sideX, 44, PEEK.sideW, 36, a ? clock(a.drill.minutes, a.startedAt, now) : ''),
    t(4, 'cov', PEEK.sideX, 80, PEEK.sideW, 36, c.cov),
    t(5, 'box', 0, PEEK.boxY, W, nextY - 4 - PEEK.boxY, box, { border: true, capture: true }),
    t(6, 'next', 0, nextY, W, H - nextY, withQueued(wrap(nextText, FULL, fit.nextRows), s.queued, fit.nextRows).join('\n')),
  ] }
}

/**
 * Agent card: main result (header), the WHOLE transcript across the full width (5 lines per page,
 * swipe pages through longer ones), then ONE compact agent-progress line (wraps to 2) + hints.
 */
function card(s: LensState, now: number): PageSpec {
  const c = context(s, now)
  const cd = s.card
  const pages = transcriptPages(cd?.transcript ?? '')
  const page = Math.min(cd?.page ?? 0, pages.length - 1)
  const pageTag = pages.length > 1 ? `${page + 1}/${pages.length} swipe · ` : ''
  const progress = cd ? wrap((cd.provisional ? [SORTING_LINE] : progressLines(cd)).join(' · '), SAID_COLS, 2) : []
  const bottom = [...progress, cd?.provisional ? 'tap: close' : 'tap: close · 2×: undo'].slice(0, 2)
  return { key: 'card', list: null, texts: [
    t(1, 'hdr', 0, 0, W, 40, clip(`${pageTag}${cd?.lines[0] ?? c.drillHeader}`, FULL)),
    t(2, 'said', 0, 44, W, 164, pages[page]!.join('\n'), { border: true, capture: true }),
    t(3, 'agents', 0, 212, W, 76, bottom.join('\n')),
  ] }
}

const mmss = (sec: number) => `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`

/**
 * Alexa-style "hearing you" line, driven by real mic events: `○ waiting for mic…` until audio bytes
 * arrive, then `● LISTENING  0:04` with the dot pulsing ●/○ each 500 ms tick and the time counting up.
 */
export function micLine(m: LensState['mic']): string {
  if (!m) return ''
  const phone = m.source === 'phone'
  if (!m.audio) return phone ? '○ waiting for phone mic…' : '○ waiting for mic…'
  const sec = Math.floor((m.tick * MIC_TICK_MS) / 1000)
  return `${m.tick % 2 ? '○' : '●'} LISTENING${phone ? ' (phone)' : ''}  ${mmss(sec)}`
}

const STAGES = ['heard', 'sending', 'thinking', 'agents'] as const

/** `heard > SENDING·· > thinking > agents`: the current stage in caps with a 1–3 dot cycle per tick. */
export function stageLine(th: LensState['thinking']): string {
  const cur = th?.stage ?? 'heard'
  const trail = '·'.repeat(((th?.tick ?? 0) % 3) + 1)
  return STAGES.map(st => (st === cur ? `${st.toUpperCase()}${trail}` : st)).join(' > ')
}

/**
 * Capture layout (recording + roll call): header, body (capture), a small live mic line, footer.
 * Only the mic line changes while recording (≤ every 500 ms); the header time is static.
 */
function capture(header: string, body: string, s: LensState, footer: string): PageSpec {
  return { key: 'rec', list: null, texts: [
    t(1, 'hdr', 0, 0, W, 40, clip(header, FULL)),
    t(2, 'body', 0, 44, W, 156, boxed(body), { border: true, capture: true }),
    t(3, 'mic', 0, 204, W, 40, micLine(s.mic)),
    t(4, 'foot', 0, 248, W, 40, clip(footer, FULL)),
  ] }
}

function attendance(s: LensState): PageSpec {
  const enrolled = s.today?.roster.length ?? 0
  return capture(`${(s.today?.className ?? '').toUpperCase()} · ${(s.today?.theme ?? '').toUpperCase()}`,
    `Roll call · ${enrolled} enrolled\nSay "Everyone except …"\nor "Present: …"\nspeak, then tap`, s, '2×: skip · or check in on phone')
}

/** Wrap-up: who was missed, then the explicit choice — tap queues them first next class, 2x just finishes. */
function wrapup(s: LensState): PageSpec {
  const w = s.wrapup
  if (!w) return panel('CLASS DONE', 'Wrapping up…', '2×: back')
  const missed = w.missed.length ? `Missed: ${w.missed.map(m => m.name).join(', ')}` : 'Missed: nobody!'
  const body = [...wrap(missed, BOXC, 2), `Feedback ${w.coverage.covered}/${w.coverage.present} ${dots(w.coverage.covered, w.coverage.present)}`,
    `${w.agentActions} agent actions · ${w.pendingReview} to review`]
  return { key: 'wrapup', list: null, texts: [
    t(1, 'hdr', 0, 0, W, 40, clip(`CLASS DONE · ${w.minutes} min · ${w.drillsRun} drills`, FULL)),
    t(2, 'body', 0, 44, W, 152, boxed(body.join('\n')), { border: true, capture: true }),
    t(3, 'foot', 0, 200, W, 84, w.missed.length ? 'Tap = coach them first next class\n2x = done' : 'Tap = done'),
  ] }
}

const DETAIL_ROWS = rowsFor(196, true)

/** Deck item detail: the full drill name and every cue, wrapped (never cut), paged when long. */
export function detailPages(s: LensState): string[][] {
  const d = s.detail ? s.today?.deck.drills[s.detail.index] : undefined
  if (!d) return [[]]
  const cues = d.cues.flatMap(c => wrap(`cue: ${c}`, BOXC))
  return paginate([...wrap(d.name, BOXC), ...(cues.length ? ['', ...cues] : [])], DETAIL_ROWS)
}

function drillDetail(s: LensState): PageSpec {
  const list = s.today?.deck.drills ?? []
  const i = s.detail?.index ?? 0
  const d = list[i]
  if (!d) return panel('DECK', 'Drill not found', '2×: back')
  const pages = detailPages(s)
  const page = Math.min(s.detail?.page ?? 0, pages.length - 1)
  const kids = d.focusStudentIds.length ? ` · ${d.focusStudentIds.length} kids` : ''
  const running = s.active?.drillId === d.id ? ' · running' : ''
  const more = pages.length > 1 ? ` · swipe ${page + 1}/${pages.length}` : ''
  return panel(`${i + 1}/${list.length} · ${d.minutes}m${kids}${running}`, pages[page]!.join('\n'), `tap: start · 2×: back${more}`)
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
      const roll = s.attendanceLines.flatMap(l => wrap(l, BOXC)).slice(0, 3)
      return panel('ROLL CALL DONE', [...roll, `${s.today?.planUnit ?? 'Deck'} ready · ${drills.length} · ${mins} min`, '', '> Tap to start the first one'].join('\n'),
        s.today?.focus[0]?.label ?? '')
    }
    case 'deck': {
      const c = context(s, now)
      const unit = (s.today?.planUnit ?? 'Deck').toUpperCase()
      return listPage('deck', `${unit} · ${c.drills.length} · tap to view`,
        c.drills.map(d => clipWithSuffix(d.name, ` · ${d.minutes}m${d.focusStudentIds.length ? ` (${d.focusStudentIds.length} kids)` : ''}`, ITEM_COLS)))
    }
    case 'drillDetail': return drillDetail(s)
    case 'recording': {
      const c = context(s, s.pending?.at ?? now) // static time: no display updates compete with mic audio
      return capture(c.drillHeader, [`speak, then ${s.pending?.viaLongPress ? 'release' : 'tap'}`, '', ...wrap(c.nextLine, BOXC, 2)].join('\n'), s, '2×: cancel')
    }
    case 'sending': return panel(context(s, s.pending?.at ?? now).drillHeader, stageLine(s.thinking), '')
    case 'card': return card(s, now)
    case 'disambiguation': {
      const d = s.disambiguation
      return listPage('dis', d ? `Heard "${d.heard}" · who?` : 'Who?', d ? d.options.map(o => o.name) : [])
    }
    case 'confirmEnd': return panel(context(s, now).cov, 'End class?\n\n> Tap to confirm\nAny other gesture cancels', '')
  }
}
