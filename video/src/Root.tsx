import { Composition } from 'remotion'
import { FPS, HEIGHT, WIDTH } from './config'
import { FILM_END } from './timeline'
import { ContactSheet } from './ContactSheet'
import { Film } from './Film'

export const RemotionRoot = () => (
  <>
    <Composition id="CoachLensLaunch" component={Film} durationInFrames={FILM_END} fps={FPS} width={WIDTH} height={HEIGHT} />
    <Composition id="ContactSheet" component={ContactSheet} durationInFrames={1} fps={FPS} width={1920} height={720} defaultProps={{ start: 1 }} />
  </>
)
