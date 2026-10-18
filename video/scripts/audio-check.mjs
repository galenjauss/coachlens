#!/usr/bin/env node
/**
 * Audio checks with Remotion's bundled ffmpeg (no system ffmpeg needed).
 *   node scripts/audio-check.mjs out/coachlens-launch-v2.mp4     # peak dBFS + RMS per 10 s of a render
 *   node scripts/audio-check.mjs --sfx public/audio/sfx/*.mp3    # onset/peak times used in src/audio/sfx.ts
 */
import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'

const C = resolve(import.meta.dirname, '../node_modules/@remotion/compositor-darwin-arm64')
const RATE = 44100

function decode(file, ch = 1) {
  const buf = execFileSync(`${C}/ffmpeg`, ['-v', 'error', '-i', file, '-ac', String(ch), '-ar', String(RATE), '-c:a', 'pcm_s16le', '-f', 'wav', '-'], {
    env: { ...process.env, DYLD_LIBRARY_PATH: C },
    maxBuffer: 1 << 30,
  })
  let o = 12
  while (o < buf.length) {
    const id = buf.toString('ascii', o, o + 4)
    let size = buf.readUInt32LE(o + 4)
    if (id === 'data') {
      if (size === 0 || size === 0xffffffff || o + 8 + size > buf.length) size = buf.length - o - 8
      const n = Math.floor(size / 2)
      const out = new Float32Array(n)
      for (let i = 0; i < n; i++) out[i] = buf.readInt16LE(o + 8 + i * 2) / 32768
      return out
    }
    o += 8 + size + (size & 1)
  }
  throw new Error('no data chunk')
}
const db = x => (20 * Math.log10(Math.max(x, 1e-9))).toFixed(1)

const args = process.argv.slice(2)
if (args[0] === '--sfx') {
  for (const f of args.slice(1)) {
    const s = decode(f)
    let pi = 0
    for (let i = 0; i < Math.min(s.length, RATE * 20); i++) if (Math.abs(s[i]) > Math.abs(s[pi])) pi = i
    let on = 0
    for (let i = 0; i < s.length; i++) if (Math.abs(s[i]) > 0.05) { on = i; break }
    console.log(f.split('/').pop().padEnd(28), 'onset', (on / RATE).toFixed(2), 'peakAt', (pi / RATE).toFixed(2), 'peak', db(Math.abs(s[pi])))
  }
} else {
  // Stereo, interleaved: the peak is the max over both channels.
  const s = decode(args[0], 2)
  const R2 = RATE * 2
  let peak = 0
  for (const v of s) peak = Math.max(peak, Math.abs(v))
  console.log(`peak ${db(peak)} dBFS (sample peak, both channels)`)
  for (let t = 0; t < s.length / R2; t += 10) {
    let sum = 0, pk = 0
    const a = t * R2, b = Math.min(s.length, (t + 10) * R2)
    for (let i = a; i < b; i++) { sum += s[i] * s[i]; pk = Math.max(pk, Math.abs(s[i])) }
    console.log(`${String(t).padStart(3)}s rms ${db(Math.sqrt(sum / (b - a)))} peak ${db(pk)}`)
  }
}
