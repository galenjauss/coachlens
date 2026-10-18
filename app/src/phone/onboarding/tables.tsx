import { useEffect, useState, type ReactNode } from 'react'
import { MODES, type ModeId } from '@matside/shared'
import {
  classIssues, inClass, studentIssues, WEEKDAYS, weekIssues, type ClassRow, type StudentRow, type WeekRow,
} from './onboardingLogic'

/** Horizontal scroll stays inside the table, never the page. Focusable so keyboards can scroll it. */
function TableWrap({ label, children }: { label: string; children: ReactNode }) {
  return <div className="ob-table-wrap" role="region" aria-label={label} tabIndex={0}><table className="ob-table">{children}</table></div>
}

/** Text cell that commits on blur/Enter so partial input (e.g. "Kata 1,") isn't normalized mid-typing. */
function CommitCell({ value, onCommit, label, invalid, placeholder, type = 'text', className }: {
  value: string; onCommit(v: string): void; label: string; invalid?: boolean; placeholder?: string; type?: string; className?: string
}) {
  const [text, setText] = useState(value)
  useEffect(() => setText(value), [value])
  const commit = () => { if (text !== value) onCommit(text) }
  return (
    <input
      className={`ob-cell ${className ?? ''}`} type={type} value={text} aria-label={label} aria-invalid={invalid || undefined} placeholder={placeholder}
      onChange={e => setText(e.target.value)} onBlur={commit} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); commit(); (e.target as HTMLInputElement).blur() } }}
    />
  )
}

const RemoveBtn = ({ label, onClick }: { label: string; onClick(): void }) => (
  <button type="button" className="ob-remove" aria-label={label} onClick={onClick}><span aria-hidden="true">×</span></button>
)

const orNull = (v: string): string | null => (v.trim() ? v.trim() : null)

export function ClassTable({ rows, onRename, onPatch, onRemove }: {
  rows: readonly ClassRow[]
  onRename(key: string, name: string): void
  onPatch(key: string, patch: Partial<ClassRow>): void
  onRemove(key: string): void
}) {
  return (
    <TableWrap label="Classes">
      <thead><tr><th scope="col" className="ob-sticky">Class</th><th scope="col">Day</th><th scope="col">Starts</th><th scope="col">Type</th><th scope="col"><span className="sr-only">Remove</span></th></tr></thead>
      <tbody>
        {rows.map((c, i) => {
          const bad = classIssues(c)
          return (
            <tr key={c.key}>
              <th scope="row" className="ob-sticky"><CommitCell value={c.name} label={`Class name, row ${i + 1}`} invalid={bad.includes('name')} onCommit={v => onRename(c.key, v.trim())} className="ob-w-name" /></th>
              <td>
                <select className="ob-cell ob-w-day" aria-label={`Day, ${c.name || `row ${i + 1}`}`} value={c.weekday} onChange={e => onPatch(c.key, { weekday: Number(e.target.value) })}>
                  {WEEKDAYS.map((d, n) => <option key={d} value={n}>{d}</option>)}
                </select>
              </td>
              <td><input className="ob-cell ob-w-time" type="time" aria-label={`Start time, ${c.name || `row ${i + 1}`}`} aria-invalid={bad.includes('time') || undefined} value={c.startTime} onChange={e => onPatch(c.key, { startTime: e.target.value })} /></td>
              <td>
                <select className="ob-cell ob-w-mode" aria-label={`Type, ${c.name || `row ${i + 1}`}`} value={c.mode} onChange={e => onPatch(c.key, { mode: e.target.value as ModeId })}>
                  {Object.values(MODES).map(m => <option key={m.id} value={m.id}>{m.label}</option>)}
                </select>
              </td>
              <td><RemoveBtn label={`Remove ${c.name || `class ${i + 1}`}`} onClick={() => onRemove(c.key)} /></td>
            </tr>
          )
        })}
      </tbody>
    </TableWrap>
  )
}

export function StudentTable({ rows, mode, classNames, onPatch, onRemove, onToggleClass }: {
  rows: readonly StudentRow[]
  mode: ModeId
  /** When given, adds one toggle column per class (review step). */
  classNames?: readonly string[]
  onPatch(key: string, patch: Partial<StudentRow>): void
  onRemove(key: string): void
  onToggleClass?(key: string, className: string): void
}) {
  const m = MODES[mode]
  const levelLabel = mode === 'martial_arts' ? 'Belt' : 'Level'
  const who = m.recipient === 'parent' ? 'Parent' : 'Contact'
  return (
    <TableWrap label={`${m.people[0]!.toUpperCase()}${m.people.slice(1)}`}>
      <thead>
        <tr>
          <th scope="col" className="ob-sticky">Name</th><th scope="col">Nickname</th><th scope="col">{levelLabel}</th><th scope="col">Age</th>
          {m.recipient === 'parent' && <th scope="col">{who}</th>}<th scope="col">{who} email</th>
          {classNames?.map(n => <th scope="col" key={n} className="ob-classcol"><span>{n}</span></th>)}
          <th scope="col"><span className="sr-only">Remove</span></th>
        </tr>
      </thead>
      <tbody>
        {rows.map((s, i) => {
          const bad = studentIssues(s)
          const who1 = s.name || `row ${i + 1}`
          return (
            <tr key={s.key}>
              <th scope="row" className="ob-sticky"><CommitCell value={s.name} label={`Name, row ${i + 1}`} invalid={bad.includes('name')} placeholder="Full name" onCommit={v => onPatch(s.key, { name: v.trim() })} className="ob-w-name" /></th>
              <td><CommitCell value={s.nickname ?? ''} label={`Nickname, ${who1}`} onCommit={v => onPatch(s.key, { nickname: orNull(v) })} className="ob-w-short" /></td>
              <td><CommitCell value={s.level ?? ''} label={`${levelLabel}, ${who1}`} onCommit={v => onPatch(s.key, { level: orNull(v) })} className="ob-w-short" /></td>
              <td><CommitCell value={s.age === null ? '' : String(s.age)} type="number" label={`Age, ${who1}`} invalid={bad.includes('age')} onCommit={v => onPatch(s.key, { age: v.trim() ? Number(v) : null })} className="ob-w-age" /></td>
              {m.recipient === 'parent' && <td><CommitCell value={s.guardianName ?? ''} label={`${who} name, ${who1}`} onCommit={v => onPatch(s.key, { guardianName: orNull(v) })} className="ob-w-mid" /></td>}
              <td><CommitCell value={s.guardianEmail ?? ''} type="email" label={`${who} email, ${who1}`} invalid={bad.includes('email')} placeholder="missing" onCommit={v => onPatch(s.key, { guardianEmail: orNull(v)?.toLowerCase() ?? null })} className={`ob-w-email ${s.guardianEmail ? '' : 'ob-missing'}`} /></td>
              {classNames?.map(n => {
                const on = inClass(s, n)
                return <td key={n} className="ob-classcol"><button type="button" className="ob-toggle" aria-pressed={on} aria-label={`${who1} in ${n}`} onClick={() => onToggleClass?.(s.key, n)}><span aria-hidden="true">{on ? '✓' : ''}</span></button></td>
              })}
              <td><RemoveBtn label={`Remove ${who1}`} onClick={() => onRemove(s.key)} /></td>
            </tr>
          )
        })}
      </tbody>
    </TableWrap>
  )
}

export function WeekTable({ rows, mode, onPatch, onRemove }: {
  rows: readonly WeekRow[]
  mode: ModeId
  onPatch(key: string, patch: Partial<WeekRow>): void
  onRemove(key: string): void
}) {
  const m = MODES[mode]
  return (
    <TableWrap label="Curriculum weeks">
      <thead><tr><th scope="col" className="ob-sticky">Week</th><th scope="col">{m.weeklyLabel}</th><th scope="col">{m.itemsDueLabel} <span className="ob-th-hint">(commas)</span></th><th scope="col"><span className="sr-only">Remove</span></th></tr></thead>
      <tbody>
        {rows.map((w, i) => (
          <tr key={w.key}>
            <th scope="row" className="ob-sticky">
              <input className="ob-cell ob-w-age" type="number" min={1} max={52} aria-label={`Week number, row ${i + 1}`} value={w.week}
                onChange={e => { const n = Math.round(Number(e.target.value)); if (n >= 1 && n <= 52) onPatch(w.key, { week: n, weekStart: null }) }} />
            </th>
            <td><CommitCell value={w.theme} label={`${m.weeklyLabel}, week ${w.week}`} invalid={weekIssues(w).includes('theme')} onCommit={v => onPatch(w.key, { theme: v.trim() })} className="ob-w-name" /></td>
            <td><CommitCell value={w.itemsDue.join(', ')} label={`${m.itemsDueLabel}, week ${w.week}`} onCommit={v => onPatch(w.key, { itemsDue: v.split(',').map(x => x.trim()).filter(Boolean).slice(0, 10) })} className="ob-w-email" /></td>
            <td><RemoveBtn label={`Remove week ${w.week}`} onClick={() => onRemove(w.key)} /></td>
          </tr>
        ))}
      </tbody>
    </TableWrap>
  )
}
