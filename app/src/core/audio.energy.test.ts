import { describe, expect, it } from 'vitest'
import { MIN_SPEECH_MS, Recorder, SPEECH_RMS, selectMic, speechMsIn } from './audio'

/** Synthetic 16 kHz s16le mono PCM: a sine of `amp` (0 = silence) for `ms`, plus optional white noise. */
export function tone(ms: number, amp: number, noise = 0): Uint8Array {
  const n = Math.round((ms / 1000) * 16000)
  const b = new Uint8Array(n * 2)
  const v = new DataView(b.buffer)
  let seed = 7
  const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff - 0.5 }
  for (let i = 0; i < n; i++) v.setInt16(i * 2, Math.max(-32768, Math.min(32767, Math.round(amp * Math.sin((2 * Math.PI * 220 * i) / 16000) + noise * rnd()))), true)
  return b
}
const bridge = () => ({ audioControl: async () => true })

describe('F14 · speech energy, not bytes', () => {
  it('silence and faint hiss have no speech; talking-level audio does', () => {
    expect(speechMsIn(tone(1000, 0))).toBe(0)
    expect(speechMsIn(tone(1000, 0, 300))).toBe(0) // room hiss, RMS ≈ 87
    expect(speechMsIn(tone(1000, 4000))).toBeCloseTo(1000, -1)
    expect(speechMsIn(tone(500, SPEECH_RMS * 1.5))).toBeGreaterThan(400)
  })

  it('picks the glasses when they carry speech, the phone when the glasses are silent', () => {
    const speech = { bytes: 32000, speechMs: 900 }
    const silent = { bytes: 32000, speechMs: 0 }
    expect(selectMic(speech, speech)).toBe('glasses')
    expect(selectMic(silent, speech)).toBe('phone') // lots of glasses bytes, but silent: phone fallback
    expect(selectMic({ bytes: 32000, speechMs: MIN_SPEECH_MS - 1 }, { bytes: 32000, speechMs: 40 })).toBe('glasses')
    expect(selectMic({ bytes: 32000, speechMs: 20 }, { bytes: 32000, speechMs: 60 })).toBe('phone') // louder of two quiet ones
    expect(selectMic(silent, silent)).toBe('glasses')
    expect(selectMic({ bytes: 0, speechMs: 0 }, { bytes: 0, speechMs: 0 })).toBe('glasses')
    expect(selectMic({ bytes: 100, speechMs: 0 }, { bytes: 32000, speechMs: 0 })).toBe('phone')
  })

  it('dual recorder: silent glasses + speaking phone → the phone WAV is sent', async () => {
    const r = new Recorder(bridge(), { dual: true })
    await r.start()
    r.push(tone(1500, 0), 'glasses')
    r.push(tone(1000, 5000), 'phone')
    const out = await r.stop()
    expect(r.source).toBe('phone')
    expect(out.wav).not.toBeNull()
  })

  it('both silent: the audio is STILL returned (flagged lowEnergy) so the server decides, never discarded on the client', async () => {
    const r = new Recorder(bridge(), { dual: true })
    await r.start()
    r.push(tone(1500, 0, 200), 'glasses')
    r.push(tone(1500, 0, 200), 'phone')
    const out = await r.stop()
    expect(out.wav).not.toBeNull()
    expect(out).toMatchObject({ lowEnergy: true })
    const single = new Recorder(bridge())
    await single.start()
    single.push(tone(1000, 0))
    expect(await single.stop()).toMatchObject({ lowEnergy: true })
    const loud = new Recorder(bridge())
    await loud.start()
    loud.push(tone(1000, 5000))
    expect((await loud.stop() as { lowEnergy?: boolean }).lowEnergy).toBeUndefined()
  })

  it('a short clip is still "too_short", no audio is still "no_audio"', async () => {
    const r = new Recorder(bridge())
    await r.start()
    r.push(tone(100, 5000))
    expect(await r.stop()).toMatchObject({ reason: 'too_short' })
    await r.start()
    expect(await r.stop()).toMatchObject({ reason: 'no_audio' })
  })
})
