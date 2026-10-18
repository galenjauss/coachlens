#!/usr/bin/env node
/** Renders pacing contact sheets from public/_sheet (see ContactSheet.tsx) to out/v2/sheets/. */
import { mkdirSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { bundle } from '@remotion/bundler'
import { renderStill, selectComposition } from '@remotion/renderer'
import { webpackOverride } from '../webpack-override.mjs'

const ROOT = resolve(import.meta.dirname, '..')
process.chdir(ROOT)
const n = readdirSync(join(ROOT, 'public/_sheet')).length
const serveUrl = await bundle({ entryPoint: join(ROOT, 'src/index.ts'), webpackOverride })
mkdirSync(join(ROOT, 'out/v2/sheets'), { recursive: true })
for (let start = 1; start <= n; start += 60) {
  const composition = await selectComposition({ serveUrl, id: 'ContactSheet', inputProps: { start } })
  const output = join(ROOT, 'out/v2/sheets', `sheet-${String(start).padStart(3, '0')}.jpg`)
  await renderStill({ composition, serveUrl, output, frame: 0, imageFormat: 'jpeg', inputProps: { start } })
  console.log(output)
}
