import { TIME_ZONES, type Draft } from './onboardingLogic'

const zoneLabel = (z: string) => z.replace(/_/g, ' ').replace('/', ' · ')

export function StepBasics({ basics, onChange }: { basics: Draft['basics']; onChange(b: Draft['basics']): void }) {
  let detected: string | null = null
  try { detected = Intl.DateTimeFormat().resolvedOptions().timeZone || null } catch { detected = null }
  const zones = [...new Set([basics.timeZone, ...(detected ? [detected] : []), ...TIME_ZONES])]
  const set = (k: keyof Draft['basics']) => (v: string) => onChange({ ...basics, [k]: v })
  return (
    <div className="ob-form">
      <div className="ob-field">
        <label className="label" htmlFor="ob-school">School or business name</label>
        <input id="ob-school" autoComplete="organization" maxLength={80} value={basics.schoolName} onChange={e => set('schoolName')(e.target.value)} placeholder="Tiger Dojo" />
      </div>
      <div className="ob-field">
        <label className="label" htmlFor="ob-coach">Your name</label>
        <input id="ob-coach" autoComplete="name" maxLength={60} value={basics.coachName} onChange={e => set('coachName')(e.target.value)} placeholder="Coach Ana" />
        <p className="muted ob-help">Parents and clients see this name on emails you approve.</p>
      </div>
      <div className="ob-field">
        <label className="label" htmlFor="ob-tz">Time zone</label>
        <select id="ob-tz" className="ob-select" value={basics.timeZone} onChange={e => set('timeZone')(e.target.value)}>
          {zones.map(z => <option key={z} value={z}>{zoneLabel(z)}{z === detected ? ' (this phone)' : ''}</option>)}
        </select>
      </div>
    </div>
  )
}
