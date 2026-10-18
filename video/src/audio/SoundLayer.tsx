import { Audio } from '@remotion/media'
import { Fragment } from 'react'
import { getStaticFiles, interpolate, Sequence, staticFile, useVideoConfig } from 'remotion'
import { DURATION, MUSIC_SRC, SCENES, sceneFrames, type SceneId } from '../config'
import { AGENTS_CUES } from '../scenes/S05Agents'
import { ASK_CUES } from '../scenes/S07Ask'
import { CLOSE_CUES } from '../scenes/S13Close'
import { HOOK_CUES } from '../scenes/S01Hook'
import { MEET_CUES } from '../scenes/S03Meet'
import { MOSAIC_CUES } from '../scenes/S12Mosaic'
import { NOTES_CUES } from '../scenes/S06Notes'
import { NOTICE_CUES } from '../scenes/S08Notice'
import { ORIGINALITY_CUES } from '../scenes/S11Originality'
import { PHONE_CUES } from '../scenes/S10Phone'
import { PLAN_CUES } from '../scenes/S04Plan'
import { PROBLEM_CUES } from '../scenes/S02Problem'
import { WRAPUP_CUES } from '../scenes/S09Wrapup'

type Kind = 'tap' | 'tick' | 'shimmer' | 'whoosh' | 'thump'
type Cues = Partial<Record<Kind, readonly number[]>>

/** Each scene's sound cues, in scene-local frames (exported next to the motion they belong to). */
const CUES: Record<SceneId, Cues> = {
  hook: HOOK_CUES, problem: PROBLEM_CUES, meet: MEET_CUES, plan: PLAN_CUES, agents: AGENTS_CUES, notes: NOTES_CUES, ask: ASK_CUES,
  notice: NOTICE_CUES, wrapup: WRAPUP_CUES, phone: PHONE_CUES, originality: ORIGINALITY_CUES, mosaic: MOSAIC_CUES, close: CLOSE_CUES,
}
const GAIN: Record<Kind, number> = { tap: 0.55, tick: 0.35, shimmer: 0.45, whoosh: 0.32, thump: 0.95 }
const LEN: Record<Kind, number> = { tap: 6, tick: 6, shimmer: 42, whoosh: 26, thump: 36 }

/** −18 dB music bed, when public/music.mp3 is present. */
const MUSIC_GAIN = 10 ** (-18 / 20)

export const SoundLayer: React.FC = () => {
  const { fps } = useVideoConfig()
  const files = new Set(getStaticFiles().map(f => f.name))
  const hasMusic = files.has(MUSIC_SRC)
  const padGain = hasMusic ? 0.35 : 1
  return (
    <>
      <Audio
        name="Pad bed" src={staticFile('sfx/pad.wav')} loop
        volume={f => padGain * interpolate(f, [0, 3 * fps, DURATION - 3 * fps, DURATION], [0, 1, 1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })}
      />
      {hasMusic ? (
        <Audio name="Music" src={staticFile(MUSIC_SRC)} volume={f => MUSIC_GAIN * interpolate(f, [0, fps, DURATION - 2 * fps, DURATION], [0, 1, 1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })} />
      ) : null}
      {SCENES.map(s => {
        const { from } = sceneFrames(s.id)
        const vo = `vo/${s.id}.mp3`
        const cues = CUES[s.id]
        return (
          <Fragment key={s.id}>
            {files.has(vo) ? <Audio name={`VO ${s.id}`} from={from} src={staticFile(vo)} /> : null}
            {(Object.keys(cues) as Kind[]).flatMap(kind =>
              (cues[kind] ?? []).map((at, i) => (
                <Sequence key={`${kind}${i}`} name={`${kind} ${s.id}`} from={from + at} durationInFrames={LEN[kind]} layout="none">
                  <Audio src={staticFile(`sfx/${kind}.wav`)} volume={GAIN[kind]} />
                </Sequence>
              )),
            )}
          </Fragment>
        )
      })}
    </>
  )
}
