// Browser-only image helpers for onboarding uploads (canvas + Even bridge camera / album).
import { waitForEvenAppBridge } from '@evenrealities/even_hub_sdk'
import { fitWithin } from './onboardingLogic'
import { assetToDataUrl, checkUploadSize, type ImageAssetLike } from './imageAsset'

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
  checkUploadSize(base64) // the same cap the API enforces (MAX_IMAGE_BASE64)
  return { base64, mimeType: 'image/jpeg', previewUrl: dataUrl, bytes: Math.round(base64.length * 0.75) }
}

export async function prepareFile(file: File): Promise<PreparedImage> {
  const url = URL.createObjectURL(file)
  try { return await downscale(url) } finally { URL.revokeObjectURL(url) }
}

/** The Even bridge's image APIs (SDK 0.0.16: both resolve an AppImageAsset, or null on cancel). */
export interface ImageBridge {
  captureImageFromCamera(): Promise<ImageAssetLike | null>
  pickImageFromAlbum(): Promise<ImageAssetLike | null>
}

/** The Even bridge if it is up within a moment and has the image APIs (null in a plain browser). */
export async function imageBridge(): Promise<ImageBridge | null> {
  try {
    const bridge = await Promise.race([waitForEvenAppBridge(), new Promise<null>(r => setTimeout(() => r(null), BRIDGE_WAIT_MS))])
    const b = bridge as Partial<ImageBridge> | null
    return b && typeof b.captureImageFromCamera === 'function' && typeof b.pickImageFromAlbum === 'function' ? (bridge as unknown as ImageBridge) : null
  } catch { return null }
}

/** A bridge asset → the same JPEG `PreparedImage` the file input produces (raw base64, ≤1600 px, ≤ MAX_IMAGE_BASE64). */
async function prepareAsset(asset: ImageAssetLike | null): Promise<PreparedImage | null> {
  const url = assetToDataUrl(asset)
  return url ? downscale(url) : null
}

/** Opens the phone camera through the Even app; null when the coach cancels. */
export async function captureWithBridge(bridge: ImageBridge): Promise<PreparedImage | null> {
  return prepareAsset(await bridge.captureImageFromCamera())
}

/** Opens the phone's photo library through the Even app; null when the coach cancels. */
export async function pickWithBridge(bridge: ImageBridge): Promise<PreparedImage | null> {
  return prepareAsset(await bridge.pickImageFromAlbum())
}

/** Text from a CSV/TXT file (capped so a huge export can't freeze the page). */
export async function readTextFile(file: File, max = 20_000): Promise<string> {
  const text = await file.text()
  return text.slice(0, max)
}
