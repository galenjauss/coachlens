import type { Api } from '../core/api'
import { MODE_EMOJI } from './classPref'
import { usePoll } from './usePoll'

export function ClassPicker({ api, value, onChange }: { api: Api; value: string | null; onChange(classId: string): void }) {
  const { data } = usePoll(() => api.classes(), null)
  if (!data || data.length < 2) return null
  return (
    <div className="picker" role="group" aria-label="Choose class">
      {data.map(c => (
        <button key={c.id} type="button" aria-pressed={value === c.id} onClick={() => onChange(c.id)}>
          <span aria-hidden="true">{MODE_EMOJI[c.mode]}</span> {c.name}
        </button>
      ))}
    </div>
  )
}
