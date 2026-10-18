#!/usr/bin/env node
/**
 * Review stills for the v2 film: renders key frames to out/v2/stills/fNNNN.png.
 * Usage: node scripts/stills.mjs            # the default key frames
 *        node scripts/stills.mjs 100 2400   # just these frames
 *        SCALE=0.5 node scripts/stills.mjs  # half-size for quick looks
 */
import { mkdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { bundle } from '@remotion/bundler'
import { renderStill, selectComposition } from '@remotion/renderer'
import { webpackOverride } from '../webpack-override.mjs'

const ROOT = resolve(import.meta.dirname, '..')
process.chdir(ROOT)
/** ~20 key frames across the film (one or two per section). */
export const KEY_FRAMES = [
  20, 75, 135, 200, 262, 330, 430, 545, 640, 800, 960, 1100, 1215, 1290, 1440, 1475, 1530, 1620, 1740,
  1900, 2040, 2200, 2440, 2580, 2700, 2800, 2950, 3135, 3200, 3320, 3420, 3540, 3690, 3760, 3990, 4300, 4450,
]
const args = process.argv.slice(2).map(Number).filter(n => Number.isFinite(n))
const todo = args.length ? args : KEY_FRAMES
const scale = Number(process.env.SCALE ?? 1)
const outDir = join(ROOT, 'out/v2/stills')

const serveUrl = await bundle({ entryPoint: join(ROOT, 'src/index.ts'), webpackOverride })
const composition = await selectComposition({ serveUrl, id: 'CoachLensLaunch' })
mkdirSync(outDir, { recursive: true })
for (const frame of todo) {
  const output = join(outDir, `f${String(frame).padStart(4, '0')}.png`)
  const t = Date.now()
  await renderStill({ composition, serveUrl, output, frame, imageFormat: 'png', scale, chromiumOptions: { gl: 'angle' } })
  console.log(`${output} ${Date.now() - t} ms`)
}
