import './theme.css'
import { createRoot, type Root } from 'react-dom/client'
import type { Api } from '../core/api'
import type { KV } from '../core/storage'
import { App } from './App'
import { KVContext } from './kvContext'

export type PhoneDeps = { api: Api; kv: KV; hasGlasses: boolean }

let root: Root | null = null

export function mountPhone(d: PhoneDeps): void {
  const el = document.getElementById('root')
  if (!el) throw new Error('#root missing')
  root = createRoot(el)
  root.render(<KVContext.Provider value={d.kv}><App {...d} /></KVContext.Provider>)
}

/** Tear down the phone UI (used to remount with bridge storage when the bridge arrives late). */
export function unmountPhone(): void {
  root?.unmount()
  root = null
}
