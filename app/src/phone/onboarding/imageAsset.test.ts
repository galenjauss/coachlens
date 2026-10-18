import { describe, expect, it } from 'vitest'
import { MAX_IMAGE_BASE64 } from '@matside/shared'
import { assetToDataUrl, checkUploadSize } from './imageAsset'

const PNG_1PX = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

describe('assetToDataUrl (bridge camera / album asset → data URL)', () => {
  it('wraps raw base64 with its mimeType', () => {
    expect(assetToDataUrl({ base64: PNG_1PX, mimeType: 'image/png' })).toBe(`data:image/png;base64,${PNG_1PX}`)
  })
  it('accepts a full data URL without double-prefixing it', () => {
    expect(assetToDataUrl({ base64: `data:image/png;base64,${PNG_1PX}`, mimeType: 'image/png' })).toBe(`data:image/png;base64,${PNG_1PX}`)
  })
  it('takes the mime from the data URL when mimeType is missing, else defaults to JPEG', () => {
    expect(assetToDataUrl({ base64: `data:image/heic;base64,${PNG_1PX}` })).toBe(`data:image/heic;base64,${PNG_1PX}`)
    expect(assetToDataUrl({ base64: PNG_1PX, mimeType: null })).toBe(`data:image/jpeg;base64,${PNG_1PX}`)
    expect(assetToDataUrl({ base64: PNG_1PX, mimeType: '' })).toBe(`data:image/jpeg;base64,${PNG_1PX}`)
  })
  it('strips whitespace and line breaks inside the base64', () => {
    const wrapped = `${PNG_1PX.slice(0, 20)}\n${PNG_1PX.slice(20, 40)}\r\n ${PNG_1PX.slice(40)}`
    expect(assetToDataUrl({ base64: wrapped, mimeType: 'IMAGE/PNG' })).toBe(`data:image/png;base64,${PNG_1PX}`)
  })
  it('null when nothing was picked (cancel)', () => {
    expect(assetToDataUrl(null)).toBeNull()
    expect(assetToDataUrl(undefined)).toBeNull()
    expect(assetToDataUrl({ base64: '', mimeType: 'image/png' })).toBeNull()
    expect(assetToDataUrl({ base64: '   ' })).toBeNull()
  })
  it('rejects non-images and non-base64 bodies', () => {
    expect(() => assetToDataUrl({ base64: PNG_1PX, mimeType: 'application/pdf' })).toThrow(/photo/)
    expect(() => assetToDataUrl({ base64: 'not base64 at all!', mimeType: 'image/png' })).toThrow(/open/)
    expect(() => assetToDataUrl({ base64: 'data:image/png;base64,', mimeType: 'image/png' })).toThrow(/open/)
  })
})

describe('checkUploadSize', () => {
  it('allows up to MAX_IMAGE_BASE64 chars and rejects more', () => {
    expect(() => checkUploadSize('A'.repeat(MAX_IMAGE_BASE64))).not.toThrow()
    expect(() => checkUploadSize('A'.repeat(MAX_IMAGE_BASE64 + 1))).toThrow(/too large/)
    expect(() => checkUploadSize('AAAA', 3)).toThrow()
  })
})
