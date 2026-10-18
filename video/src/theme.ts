import { loadFont as loadInterTight } from '@remotion/google-fonts/InterTight'
import { loadFont as loadJetBrains } from '@remotion/google-fonts/JetBrainsMono'
import { loadFont as loadRajdhani } from '@remotion/google-fonts/Rajdhani'

const inter = loadInterTight('normal', { weights: ['500', '600', '700', '800'], subsets: ['latin', 'latin-ext'] })
const mono = loadJetBrains('normal', { weights: ['500'], subsets: ['latin'] })
const lens = loadRajdhani('normal', { weights: ['400'], subsets: ['latin', 'latin-ext'] })

export const FONT = {
  head: inter.fontFamily,
  mono: mono.fontFamily,
  /** Lens text: thin, squared technical sans; closest Google match to the G2 firmware font. */
  lens: `${lens.fontFamily}, "Helvetica Neue", sans-serif`,
} as const

export const C = {
  bg: '#07090A',
  panel: '#0E1210',
  panelHi: '#141A16',
  green: '#3DFF7A',
  greenDim: 'rgba(31, 122, 69, 0.35)',
  greenDimSolid: '#1F7A45',
  white: '#ECEFEA',
  muted: '#8A938C',
  faint: 'rgba(236, 239, 234, 0.08)',
  hair: 'rgba(236, 239, 234, 0.14)',
  red: '#FF6B5E',
  amber: '#F2C14E',
} as const

export const glow = (a = 1) =>
  `0 0 6px rgba(61, 255, 122, ${0.55 * a}), 0 0 22px rgba(61, 255, 122, ${0.28 * a})`

/** Entrance spring per the brief: damping ~200, mass 0.8. */
export const SPRING = { damping: 200, mass: 0.8 } as const
