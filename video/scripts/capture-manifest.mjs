#!/usr/bin/env node
/** Merges lens-manifest.json (capture-lens.mjs) and phone-manifest.json (capture-phone.mjs) into captures/manifest.json. */
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'captures')
const read = f => JSON.parse(readFileSync(join(DIR, f), 'utf8'))
const flows = (m, kind, extra) => Object.fromEntries(Object.entries(m).map(([name, frames]) => [name, { kind, ...extra, frames }]))
const manifest = {
  about: 'Real CoachLens footage. lens/: the official Even Hub simulator (v0.9.5) rendering real LensStates (reached through the real reducer, drawn by the real render()); 576×288 RGBA PNG, alpha = lit pixels. phone/: the real phone UI against the local api with the demo seed, driven by real taps; 860×1864 (430×932 CSS px at 2x), tight crops alongside. holdMs = suggested hold per frame.',
  lens: flows(read('lens-manifest.json'), 'lens', { size: [576, 288] }),
  phone: flows(read('phone-manifest.json'), 'phone', { size: [860, 1864], cssViewport: [430, 932] }),
}
writeFileSync(join(DIR, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`)
console.log(Object.entries({ ...manifest.lens, ...manifest.phone }).map(([k, v]) => `${k}:${v.frames.length}`).join(' '))
