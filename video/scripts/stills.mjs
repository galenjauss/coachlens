#!/usr/bin/env node
/**
 * Renders one review still per scene (its key frame) to out/stills/NN-scene.png.
 * Usage: node scripts/stills.mjs [sceneNumber ...]   e.g. `node scripts/stills.mjs 4 5`
 */
import { mkdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { bundle } from '@remotion/bundler'
import { renderStill, selectComposition } from '@remotion/renderer'
import { webpackOverride } from '../webpack-override.mjs'

const ROOT = resolve(import.meta.dirname, '..')
process.chdir(ROOT)
/** [number, name, absolute frame] — each scene's most important frame. */
export const STILLS = [
  [1, 'hook', 190], [2, 'problem', 410], [3, 'meet', 600], [4, 'plan', 1060], [5, 'agents', 1400],
  [6, 'notes', 1980], [7, 'ask', 2370], [8, 'notice', 2860], [9, 'wrapup', 3090], [10, 'phone', 3620],
  [11, 'originality', 3860], [12, 'mosaic', 4340], [13, 'close', 4480],
]
const only = process.argv.slice(2).map(Number)
const extra = process.env.FRAMES ? process.env.FRAMES.split(',').map(f => [0, `f${f}`, Number(f)]) : []
const todo = extra.length ? extra : STILLS.filter(([n]) => !only.length || only.includes(n))

const serveUrl = await bundle({ entryPoint: join(ROOT, 'src/index.ts'), webpackOverride })
const composition = await selectComposition({ serveUrl, id: 'CoachLensDemo' })
mkdirSync(join(ROOT, 'out/stills'), { recursive: true })
for (const [n, name, frame] of todo) {
  const output = join(ROOT, 'out/stills', `${String(n).padStart(2, '0')}-${name}.png`)
  const t = Date.now()
  await renderStill({ composition, serveUrl, output, frame, imageFormat: 'png', chromiumOptions: { gl: 'angle' } })
  console.log(`${output} (frame ${frame}) ${Date.now() - t} ms`)
}
