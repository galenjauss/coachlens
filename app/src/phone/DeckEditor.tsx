import { useCallback, useEffect, useRef, useState } from 'react'
import type { Deck, ModeId, RosterStudent, SuggestResponse } from '@matside/shared'
import { ApiError, type Api } from '../core/api'
import { bus } from '../core/bus'
import { DrillDetail } from './DrillDetail'
import {
  appendItem, blankItem, buildPatch, canAdd, canDelete, chipsFor, deckErrorOutcome, diffCountsText, diffTotalText, labelsFor,
  moveItem, nameMap, removeItem, replaceItem, toEditable, totalMinutes, type Editable,
} from './deckLogic'
import { DiffList } from './Review'

type Editing = number | 'new' | null

const itemCount = (L: { item: string; itemPlural: string }, n: number) => (n === 1 ? L.item : L.itemPlural)

const loadErrorText = (e: unknown) => (e instanceof ApiError && e.status === 404 ? 'This plan no longer exists. Go back to Today.' : 'Couldn’t load this plan. Check your connection and retry.')

export function DeckEditor({ api, deckId, onClose }: { api: Api; deckId: string; onClose(): void }) {
  const [deck, setDeck] = useState<Deck | null>(null)
  const [mode, setMode] = useState<ModeId | null>(null) // null until known: chips and mode wording show a skeleton rather than guessing a mode
  const [modeFailed, setModeFailed] = useState(false)
  const [announce, setAnnounce] = useState('')
  const listRef = useRef<HTMLOListElement>(null)
  const pendingFocus = useRef<string | null>(null)
  const [roster, setRoster] = useState<RosterStudent[]>([])
  const [editing, setEditing] = useState<Editing>(null)
  const [ask, setAsk] = useState('')
  const [asked, setAsked] = useState('')
  const [suggestion, setSuggestion] = useState<SuggestResponse | null>(null)
  const [remember, setRemember] = useState(false)
  const [busy, setBusy] = useState(false) // a planner or save request is in flight
  const [err, setErr] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [loadErr, setLoadErr] = useState<string | null>(null)
  const lock = useRef(false)

  const load = useCallback(async (alive: () => boolean = () => true) => {
    setLoadErr(null)
    try {
      const d = await api.deck(deckId)
      if (!alive()) return
      setDeck(d)
      setModeFailed(false)
      api.today(d.classId).then(
        t => { if (alive()) { setMode(t.mode); setRoster(t.roster) } },
        // today() failed: fall back to the class list for the mode; roster stays empty.
        () => api.classes().then(cs => {
          const m = cs.find(c => c.id === d.classId)?.mode
          if (!alive()) return
          if (m) setMode(m); else setModeFailed(true)
        }, () => { if (alive()) setModeFailed(true) }),
      )
    } catch (e) { if (alive()) setLoadErr(loadErrorText(e)) }
  }, [api, deckId])
  useEffect(() => { let on = true; void load(() => on); return () => { on = false } }, [load])

  /** Runs one request at a time; credit-costing planner calls are never retried. */
  async function exclusive<T>(f: () => Promise<T>): Promise<T | undefined> {
    if (lock.current) return undefined
    lock.current = true; setBusy(true); setErr(null); setNotice(null)
    try { return await f() } finally { lock.current = false; setBusy(false) }
  }

  // After a reorder settles, put focus back on the same item's arrow (it may now be disabled at an edge).
  useEffect(() => {
    const key = pendingFocus.current
    if (!key || busy) return
    pendingFocus.current = null
    const [id, dir] = key.split(':')
    const q = (d: string) => listRef.current?.querySelector<HTMLButtonElement>(`[data-move="${CSS.escape(id!)}:${d}"]`)
    const target = q(dir!)
    ;(target && !target.disabled ? target : q(dir === 'up' ? 'down' : 'up'))?.focus()
  }, [deck, busy])

  const L = mode ? labelsFor(mode) : null
  if (!deck) {
    return (
      <main className="screen">
        <button type="button" className="back" onClick={onClose}>‹ Today</button>
        {loadErr ? <><p className="error" role="alert">{loadErr}</p><div className="btns"><button type="button" onClick={() => void load()}>Retry</button></div></> : <p className="muted" role="status">Loading…</p>}
      </main>
    )
  }

  const list: Editable[] = deck.drills.map(toEditable)

  /** Resolves true only when the server accepted the change. */
  const save = async (next: Editable[]): Promise<boolean> => (await exclusive(async () => {
    try { setDeck(await api.patchDeck(deck.id, buildPatch(next))); bus.emit('deckChanged', undefined); return true } catch (e) { setErr(deckErrorOutcome(e, 'save').text); return false }
  })) === true
  const suggest = (text: string) => exclusive(async () => {
    try { setSuggestion(await api.suggest(deck.id, text)); setAsked(text); setRemember(false) } catch (e) { setErr(deckErrorOutcome(e, 'suggest').text) }
  })
  const discard = (clearAsk: boolean) => exclusive(async () => {
    if (!suggestion) return
    try { await api.undoDiff(suggestion.diffId); setSuggestion(null); if (clearAsk) setAsk('') } catch (e) { setErr(deckErrorOutcome(e, 'save').text) }
  })
  const accept = () => exclusive(async () => {
    if (!suggestion) return
    try {
      setDeck(await api.acceptDiff(suggestion.diffId, remember))
      bus.emit('deckChanged', undefined)
      setSuggestion(null); setAsk('')
      setNotice('Plan updated. The glasses will use the new plan.')
    } catch (e) {
      const o = deckErrorOutcome(e, 'accept')
      if (o.kind === 'gone') { setSuggestion(null); setNotice(o.text); await load() } else setErr(o.text)
    }
  })

  if (editing !== null) {
    const isNew = editing === 'new'
    const current = isNew ? blankItem() : list[editing]
    if (!current) { setEditing(null); return null }
    return (
      <DrillDetail key={isNew ? 'new' : current.id ?? editing} api={api} drill={current} isNew={isNew} item={L?.item ?? 'item'} people={L?.people ?? 'people'} roster={roster} deleteAllowed={canDelete(list.length)}
        saving={busy} error={err}
        onBack={() => { setErr(null); setEditing(null) }}
        onDelete={async () => { if (!isNew && await save(removeItem(list, editing))) setEditing(null) }}
        onSave={async d => { if (await save(isNew ? appendItem(list, d) : replaceItem(list, editing, d))) setEditing(null) }} />
    )
  }

  if (suggestion) {
    return (
      <main className="screen">
        <h1>Planner’s changes</h1>
        <div className="sub">You said “{asked}” · {diffCountsText(suggestion.diff)} · {diffTotalText(suggestion.totalBefore, suggestion.totalAfter)}</div>
        <section className="card"><DiffList diff={suggestion.diff} names={nameMap(deck)} /></section>
        {suggestion.diff.rememberSuggestion && (
          <label className="card row remember">
            <input type="checkbox" checked={remember} onChange={e => setRemember(e.target.checked)} />
            <span>Remember for future plans: <i>“{suggestion.diff.rememberSuggestion}”</i></span>
          </label>
        )}
        <div role="alert">{err && <p className="error">{err}</p>}</div>
        <div className="btns">
          <button type="button" disabled={busy} onClick={() => void discard(true)}>Undo all</button>
          <button type="button" disabled={busy} onClick={() => void discard(false)}>Tweak request</button>
          <button type="button" className="primary" disabled={busy} onClick={() => void accept()}>{busy ? 'Applying…' : 'Accept'}</button>
        </div>
      </main>
    )
  }

  const mins = totalMinutes(list)
  const move = async (i: number, dir: -1 | 1) => {
    const moved = list[i]!
    pendingFocus.current = `${moved.id}:${dir === -1 ? 'up' : 'down'}`
    if (await save(moveItem(list, i, dir))) setAnnounce(`${moved.name} moved to position ${i + dir + 1} of ${list.length}`)
    else pendingFocus.current = null
  }
  return (
    <main className="screen">
      <button type="button" className="back" onClick={onClose}>‹ Today</button>
      {L ? <h1>{L.planUnit}</h1> : <h1 aria-busy="true"><span className="chip-skel title-skel" aria-hidden="true" /><span className="sr-only">Loading…</span></h1>}
      <div className="sub">{deck.forDate} · {L ? `${list.length} ${itemCount(L, list.length)}` : `${list.length}`} · {mins} min</div>
      <div aria-live="polite">{notice && <p className="notice">{notice} <button type="button" className="inline" onClick={() => setNotice(null)}>Dismiss</button></p>}</div>
      <div className="sr-only" role="status" aria-live="polite">{announce}</div>
      <ol ref={listRef} className="rowlist plan" aria-label={L?.planUnit ?? 'Plan'}>
        {list.map((d, i) => (
          <li key={d.id ?? i} className="card row plan-item">
            <div className="reorder">
              <button type="button" data-move={`${d.id}:up`} aria-label={`Move ${d.name} up`} disabled={busy || i === 0} onClick={() => move(i, -1)}>▲</button>
              <button type="button" data-move={`${d.id}:down`} aria-label={`Move ${d.name} down`} disabled={busy || i === list.length - 1} onClick={() => move(i, 1)}>▼</button>
            </div>
            <button type="button" className="grow plan-open" disabled={busy} onClick={() => { setErr(null); setAnnounce(''); setEditing(i) }}>
              <b>{d.name}</b>
              <span className="muted">{d.minutes}m · {d.cues[0] ? `cue: ${d.cues[0]}` : d.kind}{d.focusStudentIds.length ? ` · ${d.focusStudentIds.length} focus` : ''}</span>
            </button>
          </li>
        ))}
      </ol>
      <div className="btns"><button type="button" disabled={busy || !L || !canAdd(list.length)} onClick={() => { setErr(null); setEditing('new') }}>＋ Add{L ? ` ${L.item}` : ''}</button></div>
      {!canAdd(list.length) && <p className="muted">A plan holds at most 20 items.</p>}
      <section className="card planner" aria-busy={busy}>
        <div className="label">Tell the planner</div>
        {mode ? (
          <div className="chips" role="group" aria-label="Quick requests">
            {chipsFor(mode).map(c => <button key={c} type="button" disabled={busy} onClick={() => { setAsk(c); void suggest(c) }}>{c}</button>)}
          </div>
        ) : modeFailed ? (
          <p className="muted">Couldn’t load quick requests. <button type="button" className="inline" onClick={() => void load()}>Retry</button></p>
        ) : (
          <div className="chips skeleton" aria-hidden="true">{[0, 1, 2, 3].map(i => <span key={i} className="chip-skel" />)}</div>
        )}
        <form className="row ask" onSubmit={e => { e.preventDefault(); if (ask.trim().length >= 2) void suggest(ask.trim()) }}>
          <input aria-label="Tell the planner" enterKeyHint="send" placeholder="e.g. they were wild last class, more structure" value={ask} onChange={e => setAsk(e.target.value)} />
          <button type="submit" className="primary" disabled={busy || ask.trim().length < 2}>{busy ? '…' : 'Ask'}</button>
        </form>
        <p className="muted hint-left">The planner proposes changes; nothing applies until you accept.</p>
        <div role="alert">{err && <p className="error">{err}</p>}</div>
      </section>
    </main>
  )
}
