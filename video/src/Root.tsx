import { Composition } from 'remotion'
import { DURATION, FPS, HEIGHT, WIDTH } from './config'
import { ContactSheet } from './ContactSheet'
import { Film } from './Film'

export const RemotionRoot = () => (
  <>
    <Composition id="CoachLensLaunch" component={Film} durationInFrames={DURATION} fps={FPS} width={WIDTH} height={HEIGHT} />
    <Composition id="ContactSheet" component={ContactSheet} durationInFrames={1} fps={FPS} width={1920} height={720} defaultProps={{ start: 1 }} />
  </>
)
