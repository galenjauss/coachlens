import { AbsoluteFill, Img, staticFile } from 'remotion'
import { LensDisplay } from './components/LensDisplay'
import { fixtureSpec } from './lens/appLens'
import type { FixtureName } from '../../app/src/lens/fixtures'

/** Dev only: our LensDisplay vs the true simulator capture, at 2×, for font calibration. */
const ROWS: [FixtureName, string][] = [['wrapup', '10-wrapup.png'], ['peek', '05-peek.png'], ['card', '07-card.png']]
export const Calibrate: React.FC = () => (
  <AbsoluteFill style={{ background: '#000', flexDirection: 'column' }}>
    {ROWS.map(([n, f]) => (
      <div key={n} style={{ display: 'flex', gap: 40, padding: 20 }}>
        <div style={{ width: 576 * 1.6, height: 288 * 1.6, border: '1px solid #333' }}><LensDisplay spec={fixtureSpec(n)} scale={1.6} /></div>
        <Img src={staticFile(`ref/${f}`)} style={{ width: 576 * 1.6, height: 288 * 1.6, border: '1px solid #333' }} />
      </div>
    ))}
  </AbsoluteFill>
)
