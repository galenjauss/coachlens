import { MODES, type ModeId } from '@matside/shared'
import {
  emailSummary, inClass, removeClass, removeRow, renameClass, setAllInClass, toggleEnrollment, unassignedCount, updateRow,
  type Draft,
} from './onboardingLogic'
import type { DraftUpdate } from './StepUpload'
import { ClassTable, StudentTable, WeekTable } from './tables'

export function StepReview({ draft, mode, update, errors, onEdit }: {
  draft: Draft; mode: ModeId; update: DraftUpdate; errors: string[]; onEdit(stepIndex: number): void
}) {
  const m = MODES[mode]
  const classNames = draft.classes.map(c => c.name)
  const unassigned = unassignedCount(draft)
  return (
    <div className="ob-review">
      <p className="ob-lead">Nothing is saved until you tap <b>Save everything</b>. Tap any cell to fix it.</p>

      <dl className="ob-tally" aria-label="Summary">
        <div><dt>Classes</dt><dd>{draft.classes.length}</dd></div>
        <div><dt>{m.people}</dt><dd>{draft.students.length}</dd></div>
        <div><dt>Weeks</dt><dd>{draft.weeks.length}</dd></div>
      </dl>

      <section className="ob-section" aria-labelledby="ob-r-basics">
        <div className="ob-section-head"><h3 id="ob-r-basics">Basics</h3><button type="button" className="ob-chip-btn" onClick={() => onEdit(1)}>Edit</button></div>
        <p className="ob-basics"><b>{draft.basics.schoolName || '—'}</b> · {draft.basics.coachName || '—'} · {draft.basics.timeZone.replace(/_/g, ' ')} · {m.label}</p>
      </section>

      <section className="ob-section" aria-labelledby="ob-r-classes">
        <div className="ob-section-head"><h3 id="ob-r-classes">Classes</h3><button type="button" className="ob-chip-btn" onClick={() => onEdit(2)}>Add more</button></div>
        {draft.classes.length ? (
          <ClassTable rows={draft.classes}
            onRename={(k, n) => update(d => renameClass(d, k, n))}
            onPatch={(k, p) => update(d => ({ ...d, classes: updateRow(d.classes, k, p) }))}
            onRemove={k => update(d => removeClass(d, k))} />
        ) : <p className="muted">No classes yet.</p>}
      </section>

      <section className="ob-section" aria-labelledby="ob-r-roster">
        <div className="ob-section-head"><h3 id="ob-r-roster">{m.people[0]!.toUpperCase() + m.people.slice(1)}</h3><button type="button" className="ob-chip-btn" onClick={() => onEdit(3)}>Add more</button></div>
        {draft.students.length > 0 && <p className="muted ob-sub">{emailSummary(draft.students, mode)} · emails are only drafted for rows with an email</p>}
        {draft.students.length > 0 && draft.classes.length > 0 && (
          <div className="ob-assign" role="group" aria-label="Assign everyone to a class">
            <span className="muted">Everyone in:</span>
            {draft.classes.map(c => {
              const all = draft.students.every(s => inClass(s, c.name))
              return (
                <button key={c.key} type="button" className="ob-chip-btn" aria-pressed={all} onClick={() => update(d => ({ ...d, students: setAllInClass(d.students, c.name, !all) }))}>
                  {c.name}
                </button>
              )
            })}
          </div>
        )}
        {unassigned > 0 && draft.classes.length > 0 && <p className="ob-warn" role="note">{unassigned} not in any class yet. Tap the class columns to assign.</p>}
        {draft.students.length ? (
          <StudentTable rows={draft.students} mode={mode} classNames={classNames}
            onPatch={(k, p) => update(d => ({ ...d, students: updateRow(d.students, k, p) }))}
            onRemove={k => update(d => ({ ...d, students: removeRow(d.students, k) }))}
            onToggleClass={(k, n) => update(d => ({ ...d, students: toggleEnrollment(d.students, k, n) }))} />
        ) : <p className="muted">No {m.people} yet. You can add them later too.</p>}
      </section>

      <section className="ob-section" aria-labelledby="ob-r-weeks">
        <div className="ob-section-head"><h3 id="ob-r-weeks">Curriculum</h3><button type="button" className="ob-chip-btn" onClick={() => onEdit(4)}>Add more</button></div>
        {draft.weeks.length ? (
          <WeekTable rows={draft.weeks} mode={mode}
            onPatch={(k, p) => update(d => ({ ...d, weeks: updateRow(d.weeks, k, p) }))}
            onRemove={k => update(d => ({ ...d, weeks: removeRow(d.weeks, k) }))} />
        ) : <p className="muted">No weeks yet. Plans will use general skills until you add some.</p>}
      </section>

      {errors.length > 0 && (
        <div className="ob-errors" role="alert">
          <b>Fix these first</b>
          <ul>{errors.map(e => <li key={e}>{e}</li>)}</ul>
        </div>
      )}
    </div>
  )
}
