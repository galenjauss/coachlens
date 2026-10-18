import { createRoot } from 'react-dom/client'
import type { Api } from '../core/api'
import type { KV } from '../core/storage'
import { App } from './App'

export type PhoneDeps = { api: Api; kv: KV; hasGlasses: boolean }

export function mountPhone(d: PhoneDeps): void {
  const el = document.getElementById('root')
  if (!el) throw new Error('#root missing')
  createRoot(el).render(<App {...d} />)
}
