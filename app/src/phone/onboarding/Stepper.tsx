import { STEPS } from './onboardingLogic'

/** Six-step progress: done steps are tappable, future steps unlock as you reach them. */
export function Stepper({ index, reached, onJump }: { index: number; reached: number; onJump(i: number): void }) {
  const step = STEPS[index]!
  return (
    <nav className="ob-stepper" aria-label="Setup steps">
      <div className="ob-progress" role="progressbar" aria-label="Setup progress" aria-valuemin={1} aria-valuemax={STEPS.length} aria-valuenow={index + 1} aria-valuetext={`Step ${index + 1} of ${STEPS.length}: ${step.title}`}>
        <span style={{ transform: `scaleX(${(index + 1) / STEPS.length})` }} />
      </div>
      <ol>
        {STEPS.map((s, i) => {
          const state = i === index ? 'current' : i < index || i <= reached ? 'done' : 'todo'
          return (
            <li key={s.id} className={`ob-node-${state}`}>
              <button type="button" disabled={i > reached} aria-current={i === index ? 'step' : undefined} onClick={() => onJump(i)}
                aria-label={`Step ${i + 1}, ${s.title}${i < index ? ', done' : ''}`}>
                <span className="ob-node" aria-hidden="true">{i < index ? '✓' : i + 1}</span>
                <span className="ob-node-label" aria-hidden="true">{s.short}</span>
              </button>
            </li>
          )
        })}
      </ol>
    </nav>
  )
}
