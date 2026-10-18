// Browser-only image helpers for onboarding uploads (canvas + Even bridge camera).
import { waitForEvenAppBridge } from '@evenrealities/even_hub_sdk'
import { fitWithin } from './onboardingLogic'

export const MAX_EDGE = 1600
const JPEG_QUALITY = 0.82
const BRIDGE_WAIT_MS = 1500

export interface PreparedImage { base64: string; mimeType: 'image/jpeg'; previewUrl: string; bytes: number }

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('Couldn’t open that image.'))
    img.src = src
  })
}

/** Downscales any browser-readable image to ≤1600px on the long edge, re-encoded as JPEG. */
export async function downscale(src: string): Promise<PreparedImage> {
  const img = await loadImage(src)
  const { w, h } = fitWithin(img.naturalWidth || img.width, img.naturalHeight || img.height, MAX_EDGE)
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('This phone can’t process images here.')
  ctx.fillStyle = '#fff' // transparent PNGs become white, not black
  ctx.fillRect(0, 0, w, h)
  ctx.drawImage(img, 0, 0, w, h)
  const dataUrl = canvas.toDataURL('image/jpeg', JPEG_QUALITY)
  const base64 = dataUrl.slice(dataUrl.indexOf(',') + 1)
  return { base64, mimeType: 'image/jpeg', previewUrl: dataUrl, bytes: Math.round(base64.length * 0.75) }
}

export async function prepareFile(file: File): Promise<PreparedImage> {
  const url = URL.createObjectURL(file)
  try { return await downscale(url) } finally { URL.revokeObjectURL(url) }
}

type CameraBridge = { captureImageFromCamera(): Promise<{ base64: string; mimeType: string } | null> }

/** The Even bridge if it is up within a moment (null in a plain browser). */
export async function cameraBridge(): Promise<CameraBridge | null> {
  try {
    const bridge = await Promise.race([waitForEvenAppBridge(), new Promise<null>(r => setTimeout(() => r(null), BRIDGE_WAIT_MS))])
    return bridge && typeof (bridge as Partial<CameraBridge>).captureImageFromCamera === 'function' ? (bridge as unknown as CameraBridge) : null
  } catch { return null }
}

/** Opens the phone camera through the Even app; null when the coach cancels. */
export async function captureWithBridge(bridge: CameraBridge): Promise<PreparedImage | null> {
  const shot = await bridge.captureImageFromCamera()
  if (!shot?.base64) return null
  const raw = shot.base64.replace(/^data:[^,]*,/, '')
  return downscale(`data:${shot.mimeType || 'image/jpeg'};base64,${raw}`)
}

/** Text from a CSV/TXT file (capped so a huge export can't freeze the page). */
export async function readTextFile(file: File, max = 20_000): Promise<string> {
  const text = await file.text()
  return text.slice(0, max)
}
