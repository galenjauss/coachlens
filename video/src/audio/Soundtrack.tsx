import { Audio } from '@remotion/media'
import { Sequence, staticFile, useCurrentFrame } from 'remotion'
import { lin } from '../lib/anim'
import { CUES, type Cue, FPS, MUSIC_JUMP_AT, MUSIC_JUMP_TO_SEC, SECTIONS } from '../timeline'
import { IMPACTS, SFX } from './sfx'

const MAIN_GAIN = 0.46
/** Overall SFX trim so the mix peaks under -1 dBFS (measured with scripts/audio-check.mjs). */
const SFX_TRIM = 0.8
const IMPACT_FRAMES = CUES.filter(c => IMPACTS.includes(c.s)).map(c => c.f)

/** ~3 dB duck under impacts, plus a deeper dip in the originality breakdown ("near silence"). */
const duck = (f: number): number => {
  const hit = IMPACT_FRAMES.some(i => f >= i - 2 && f < i + 14) ? 0.7 : 1
  const quiet = lin(f, [SECTIONS.origin.from, SECTIONS.origin.from + 20, SECTIONS.origin.from + 220, SECTIONS.origin.from + 240], [1, 0.62, 0.62, 1])
  return hit * quiet
}

const MAIN = 'audio/music/main-minimal-techno-120bpm.mp3'
/** Frames of crossfade at the jump (centred on the bar line, so no click and no audible seam). */
const XF = 3

/** Film 0→124 s: the track from the top. */
function MainMusic() {
  const f = useCurrentFrame()
  const out = lin(f, [MUSIC_JUMP_AT, MUSIC_JUMP_AT + XF], [1, 0])
  return <Audio src={staticFile(MAIN)} volume={MAIN_GAIN * duck(f) * out} />
}

/** Film 124→150 s: the same track from its drop phrase (track 104 s, a bar and phrase line). */
function DropMusic() {
  const f = useCurrentFrame()
  const g = MUSIC_JUMP_AT - XF + f
  const fadeIn = lin(g, [MUSIC_JUMP_AT - XF, MUSIC_JUMP_AT], [0, 1])
  const fadeOut = lin(g, [SECTIONS.close.to - 45, SECTIONS.close.to - 1], [1, 0])
  return <Audio src={staticFile(MAIN)} trimBefore={MUSIC_JUMP_TO_SEC * FPS - XF} volume={MAIN_GAIN * duck(g) * fadeIn * fadeOut} />
}

function CueSound({ cue }: { cue: Cue }) {
  const meta = SFX[cue.s]
  const gain = meta.gain * (cue.v ?? 1) * SFX_TRIM
  const rate = cue.rate ?? 1
  if (cue.len !== undefined) {
    const trimStart = Math.max(0, meta.hit - cue.len)
    return <Audio src={staticFile(`audio/sfx/${cue.s}.mp3`)} trimBefore={Math.round(trimStart * FPS)} durationInFrames={Math.round((cue.len + 0.15) * FPS)} volume={gain} />
  }
  const len = Math.max(2, Math.round((meta.dur / rate) * FPS))
  return <Audio src={staticFile(`audio/sfx/${cue.s}.mp3`)} durationInFrames={len} playbackRate={rate} volume={(fr: number) => gain * lin(fr, [len - 4, len], [1, 0])} />
}

/** Music beds and every SFX cue from timeline.ts, each placed so its hit lands on its frame. */
export function Soundtrack() {
  return (
    <>
      <Sequence name="music-main" durationInFrames={MUSIC_JUMP_AT + XF + 1}>
        <MainMusic />
      </Sequence>
      <Sequence name="music-drop" from={MUSIC_JUMP_AT - XF}>
        <DropMusic />
      </Sequence>
      {CUES.map((c, i) => {
        const meta = SFX[c.s]
        const lead = c.len !== undefined ? Math.round(c.len * FPS) : Math.round((meta.hit / (c.rate ?? 1)) * FPS)
        const from = Math.max(0, c.f - lead)
        return (
          <Sequence key={i} name={`sfx-${c.s}`} from={from} durationInFrames={Math.round(((c.len ?? meta.dur) + 0.3) * FPS)}>
            <CueSound cue={c} />
          </Sequence>
        )
      })}
    </>
  )
}
