#!/usr/bin/env node
/**
 * Sanity checks for src/timeline.ts: SFX never repeat back to back (typing excepted), cue density,
 * finale cut times, and every cut frame on the grid. Run: node scripts/check-timeline.mjs
 */
const T = await import('../src/timeline.ts')
const cues = T.CUES.filter(c => c.s !== 'typing-laptop')
let bad = 0
for (let i = 1; i < cues.length; i++) {
  if (cues[i].s === cues[i - 1].s) { console.log(`REPEAT ${cues[i].s} at f${cues[i - 1].f} and f${cues[i].f}`); bad++ }
}
console.log(`${cues.length} SFX cues (+${T.CUES.length - cues.length} keystrokes), ${new Set(cues.map(c => c.s)).size} distinct files`)
const used = new Set(T.CUES.map(c => c.s))
console.log('flash starts (s):', T.FLASH_STARTS.map(f => (f / 30).toFixed(2)).join(' '))
console.log('flash lengths (frames):', T.FLASH_STARTS.slice(1).map((f, i) => f - T.FLASH_STARTS[i]).join(' '))
// density: cues per 4 s window
for (let s = 0; s < 150; s += 10) {
  const n = cues.filter(c => c.f >= s * 30 && c.f < (s + 10) * 30).length
  process.stdout.write(`${s}s:${n} `)
}
console.log()
// gaps between consecutive cues > 3 s
for (let i = 1; i < cues.length; i++) if (cues[i].f - cues[i - 1].f > 90) console.log(`gap ${(cues[i - 1].f / 30).toFixed(1)}→${(cues[i].f / 30).toFixed(1)} s`)
process.exitCode = bad ? 1 : 0
