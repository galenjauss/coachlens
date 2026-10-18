// Pure helpers for images that arrive as base64 (Even bridge camera / album). No DOM, no SDK: unit-tested.
import { MAX_IMAGE_BASE64 } from '@matside/shared'

/** The fields of the SDK's AppImageAsset this app reads (`path`, `name`, `size` are not needed). */
export interface ImageAssetLike { base64?: string | null; mimeType?: string | null }

const BASE64_BODY = /^[A-Za-z0-9+/]+={0,2}$/
const DEFAULT_MIME = 'image/jpeg'

/**
 * A bridge image asset as a `data:` URL the canvas downscaler can load. Accepts raw base64 or a full
 * data URL (some hosts send one), tolerates whitespace/newlines, defaults a missing mimeType to JPEG.
 * null = nothing picked (cancel); throws when the asset is not a readable image.
 */
export function assetToDataUrl(asset: ImageAssetLike | null | undefined): string | null {
  const raw = asset?.base64?.trim()
  if (!raw) return null
  const prefix = /^data:([^;,]*)(;base64)?,/i.exec(raw)
  const body = (prefix ? raw.slice(prefix[0].length) : raw).replace(/\s+/g, '')
  const mime = (asset?.mimeType?.trim() || prefix?.[1] || DEFAULT_MIME).toLowerCase()
  if (!mime.startsWith('image/')) throw new Error('That isn’t a photo. Pick an image instead.')
  if (!body || !BASE64_BODY.test(body)) throw new Error('Couldn’t open that image.')
  return `data:${mime};base64,${body}`
}

/** The image as it will be uploaded must fit the API's cap (MAX_IMAGE_BASE64 base64 chars). */
export function checkUploadSize(base64: string, max = MAX_IMAGE_BASE64): void {
  if (base64.length > max) throw new Error('That photo is too large. Try a closer, simpler shot.')
}
