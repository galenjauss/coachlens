import type { Api } from '../core/api'
import { MODE_EMOJI } from './classPref'
import { usePoll } from './usePoll'

export function ClassPicker({ api, value, loading, onChange }: { api: Api; value: string | null; loading?: boolean; onChange(classId: string): void }) {
  const { data, error, reload } = usePoll(() => api.classes(), null)
  if (!data && error) return <div className="picker-wrap"><button type="button" className="picker-retry" onClick={reload}>Classes unavailable · Retry</button></div>
  if (!data || data.length < 2) return null
  return (
    <div className="picker-wrap">
      <div className="picker" role="group" aria-label="Choose class">
        {data.map(c => (
          <button key={c.id} type="button" aria-pressed={value === c.id} onClick={() => onChange(c.id)}>
            <span aria-hidden="true">{MODE_EMOJI[c.mode]}</span> {c.name}
          </button>
        ))}
      </div>
      {loading && <p className="muted picker-status" role="status">Loading…</p>}
    </div>
  )
}
