#!/usr/bin/env node
/**
 * Generates the video's sound-design layer as WAVs in public/sfx/ (no samples, no copyrighted audio):
 * tap, tick, shimmer (lens on), whoosh, thump (the 0), and a seamless pad loop.
 * Usage: node scripts/sfx.mjs
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'sfx')
mkdirSync(OUT, { recursive: true })

/** Deterministic PRNG so the files are byte-identical on every run. */
function rng(seed) {
  let s = seed >>> 0
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296) * 2 - 1
}

function wav(name, samples, rate) {
  const n = samples.length
  const buf = Buffer.alloc(44 + n * 2)
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + n * 2, 4); buf.write('WAVE', 8)
  buf.write('fmt ', 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22)
  buf.writeUInt32LE(rate, 24); buf.writeUInt32LE(rate * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34)
  buf.write('data', 36); buf.writeUInt32LE(n * 2, 40)
  for (let i = 0; i < n; i++) buf.writeInt16LE(Math.round(Math.max(-1, Math.min(1, samples[i])) * 32767), 44 + i * 2)
  writeFileSync(join(OUT, name), buf)
  console.log(`${name}: ${(n / rate).toFixed(2)} s, ${(buf.length / 1024).toFixed(0)} KB`)
}

/** RBJ band-pass / low-pass biquad with a per-sample cutoff. */
function biquad(type) {
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0
  return (x, f, q, rate) => {
    const w = (2 * Math.PI * Math.min(f, rate * 0.45)) / rate
    const a = Math.sin(w) / (2 * q)
    const cos = Math.cos(w)
    let b0, b1, b2
    if (type === 'lp') { b0 = (1 - cos) / 2; b1 = 1 - cos; b2 = (1 - cos) / 2 } else { b0 = a; b1 = 0; b2 = -a }
    const a0 = 1 + a, a1 = -2 * cos, a2 = 1 - a
    const y = (b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2) / a0
    x2 = x1; x1 = x; y2 = y1; y1 = y
    return y
  }
}

const R = 44100
const seconds = (s, rate = R) => Math.round(s * rate)

// Tap: a soft, dry click with a little body.
{
  const n = seconds(0.09); const out = new Float32Array(n); const noise = rng(1)
  for (let i = 0; i < n; i++) {
    const t = i / R
    out[i] = 0.32 * Math.sin(2 * Math.PI * 2100 * t) * Math.exp(-t / 0.006) + 0.35 * Math.sin(2 * Math.PI * 190 * t) * Math.exp(-t / 0.022) + 0.05 * noise() * Math.exp(-t / 0.003)
  }
  wav('tap.wav', out, R)
}

// Tick: a tiny glassy tick for highlights and chips.
{
  const n = seconds(0.08); const out = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    const t = i / R
    out[i] = 0.2 * (Math.sin(2 * Math.PI * 3400 * t) + 0.4 * Math.sin(2 * Math.PI * 5100 * t)) * Math.exp(-t / 0.012)
  }
  wav('tick.wav', out, R)
}

// Shimmer: the lens lighting up. Band-passed noise sweeping up + a soft sine sweep with a fifth.
{
  const dur = 1.3; const n = seconds(dur); const out = new Float32Array(n); const noise = rng(7); const bp = biquad('bp')
  let ph1 = 0, ph2 = 0
  for (let i = 0; i < n; i++) {
    const t = i / R; const u = t / dur
    const env = Math.min(1, t / 0.08) * Math.exp(-Math.max(0, t - 0.1) / 0.38)
    const f = 600 + 1300 * Math.pow(u, 0.6)
    ph1 += (2 * Math.PI * f) / R; ph2 += (2 * Math.PI * f * 1.5) / R
    const air = bp(noise(), 2400 + 5200 * u, 2.2, R)
    out[i] = env * (0.13 * Math.sin(ph1) + 0.06 * Math.sin(ph2) + 0.5 * air)
  }
  wav('shimmer.wav', out, R)
}

// Whoosh: low-passed noise with a cutoff that rises and falls under a bell envelope.
{
  const dur = 0.75; const n = seconds(dur); const out = new Float32Array(n); const noise = rng(3); const lp = biquad('lp')
  for (let i = 0; i < n; i++) {
    const u = i / n
    const bell = Math.pow(Math.sin(Math.PI * Math.pow(u, 0.8)), 2)
    out[i] = 0.55 * bell * lp(noise(), 250 + 3800 * bell, 0.9, R)
  }
  wav('whoosh.wav', out, R)
}

// Thump: a low hit for the 0, pitch dropping 110 → 42 Hz, with a short transient.
{
  const dur = 1.1; const n = seconds(dur); const out = new Float32Array(n); const noise = rng(9); const lp = biquad('lp')
  let ph = 0
  for (let i = 0; i < n; i++) {
    const t = i / R
    const f = 42 + 68 * Math.exp(-t / 0.06)
    ph += (2 * Math.PI * f) / R
    out[i] = 0.9 * Math.sin(ph) * Math.exp(-t / 0.32) + 0.25 * lp(noise(), 900, 0.7, R) * Math.exp(-t / 0.012)
  }
  wav('thump.wav', out, R)
}

// Pad: a 12 s seamless loop. Every partial completes whole cycles in 12 s; the filter LFO does one cycle.
{
  const RP = 22050; const L = 12; const n = seconds(L, RP); const lp = biquad('lp'); const out = new Float32Array(n)
  const partials = [[110, 0.5], [110.5, 0.45], [165, 0.28], [220.25, 0.16], [329.75, 0.07], [55, 0.3]]
  const sample = t => partials.reduce((s, [f, a]) => s + a * Math.sin(2 * Math.PI * f * t) + 0.25 * a * Math.sin(2 * Math.PI * 2 * f * t), 0)
  // Warm the filter up over one full loop so the second pass starts in steady state (seamless join).
  for (let pass = 0; pass < 2; pass++) {
    for (let i = 0; i < n; i++) {
      const t = i / RP
      const cutoff = 500 + 350 * (0.5 - 0.5 * Math.cos((2 * Math.PI * t) / L))
      const y = lp(sample(t), cutoff, 0.8, RP)
      if (pass === 1) out[i] = 0.075 * y * (0.85 + 0.15 * Math.sin((2 * Math.PI * 2 * t) / L))
    }
  }
  wav('pad.wav', out, RP)
}
