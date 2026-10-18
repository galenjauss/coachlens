import { Composition } from 'remotion'
import { Calibrate } from './Calibrate'
import { CoachLensDemo } from './CoachLensDemo'
import { DURATION, FPS, HEIGHT, WIDTH } from './config'

export const RemotionRoot: React.FC = () => (
  <>
    <Composition id="CoachLensDemo" component={CoachLensDemo} durationInFrames={DURATION} fps={FPS} width={WIDTH} height={HEIGHT} />
    <Composition id="Calibrate" component={Calibrate} durationInFrames={1} fps={FPS} width={1920} height={1500} />
  </>
)
