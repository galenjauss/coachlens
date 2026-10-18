import { loadFont as loadInstrumentSerif } from '@remotion/google-fonts/InstrumentSerif'
import { loadFont as loadInterTight } from '@remotion/google-fonts/InterTight'
import { loadFont as loadJetBrains } from '@remotion/google-fonts/JetBrainsMono'
import { loadFont as loadRajdhani } from '@remotion/google-fonts/Rajdhani'

const inter = loadInterTight('normal', { weights: ['600', '700', '800'], subsets: ['latin'] })
const mono = loadJetBrains('normal', { weights: ['500', '700'], subsets: ['latin'] })
const serif = loadInstrumentSerif('italic', { weights: ['400'], subsets: ['latin'] })
/** Only for the hypothetical use-case lens strips in the finale (the one allowed exception). */
const lens = loadRajdhani('normal', { weights: ['400', '500'], subsets: ['latin'] })

export const FONT = {
  head: inter.fontFamily,
  mono: mono.fontFamily,
  serif: serif.fontFamily,
  lens: `${lens.fontFamily}, "Helvetica Neue", sans-serif`,
} as const

/** The v2 palette: black + lens green, four full-bleed field colours. */
export const C = {
  black: '#07090A',
  ink: '#07090A',
  green: '#3DFF7A',
  orange: '#FF5B1F',
  cobalt: '#2B46FF',
  paper: '#ECEFEA',
  white: '#ECEFEA',
  muted: '#8A938C',
  amber: '#F2C14E',
  red: '#FF6B5E',
} as const

export type FieldName = 'black' | 'orange' | 'cobalt' | 'green' | 'paper'

export const FIELD: Record<FieldName, { bg: string; ink: string; soft: string }> = {
  black: { bg: C.black, ink: C.paper, soft: 'rgba(236,239,234,0.55)' },
  orange: { bg: C.orange, ink: C.black, soft: 'rgba(7,9,10,0.62)' },
  cobalt: { bg: C.cobalt, ink: C.paper, soft: 'rgba(236,239,234,0.66)' },
  green: { bg: C.green, ink: C.black, soft: 'rgba(7,9,10,0.62)' },
  paper: { bg: C.paper, ink: C.black, soft: 'rgba(7,9,10,0.55)' },
}

/** Phosphor glow for real lens captures (lit pixels are green on transparent). */
export const PHOSPHOR = 'drop-shadow(0 0 2px rgba(61,255,122,0.9)) drop-shadow(0 0 10px rgba(61,255,122,0.45)) drop-shadow(0 0 28px rgba(61,255,122,0.22))'
