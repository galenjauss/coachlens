import { describe, expect, it } from 'vitest'
import { findUnlistedUrls, manifestWhitelist, rewriteDeadUrls } from './bundleUrls'

const WL = ['https://coachlens-api.vercel.app']

describe('rewriteDeadUrls', () => {
  it('removes the react.dev error link', () => {
    const out = rewriteDeadUrls('function n(e){var t=`https://react.dev/errors/`+e;return t}')
    expect(out).not.toContain('react.dev')
    expect(findUnlistedUrls(out, WL)).toEqual([])
  })

  it('keeps the zod IPv6 URL byte-identical at runtime', () => {
    const src = 'function Li(e){return `http://[${e}]`}'
    const out = rewriteDeadUrls(src)
    expect(findUnlistedUrls(out, WL)).toEqual([])
    // eslint-disable-next-line no-new-func
    const run = (code: string) => new Function(`${code};return Li('::1')`)() as string
    expect(run(out)).toBe(run(src))
    expect(run(out)).toBe('http://[::1]')
  })
})

describe('findUnlistedUrls', () => {
  it('allows whitelisted origins and their paths', () => {
    expect(findUnlistedUrls('`https://coachlens-api.vercel.app` "https://coachlens-api.vercel.app/x"', WL)).toEqual([])
  })

  it('does not let a look-alike host through', () => {
    expect(findUnlistedUrls('"https://coachlens-api.vercel.app.evil.com/x"', WL)).toEqual([
      'https://coachlens-api.vercel.app.evil.com/x',
    ])
  })

  it('ignores XML namespace IDs but flags anything else', () => {
    const code = '"http://www.w3.org/2000/svg" "https://example.com/a" "https://example.com/a"'
    expect(findUnlistedUrls(code, WL)).toEqual(['https://example.com/a'])
  })
})

describe('manifestWhitelist', () => {
  it('reads the network whitelist', () => {
    expect(manifestWhitelist({ permissions: [{ name: 'network', whitelist: WL }] })).toEqual(WL)
  })

  it('throws on a malformed manifest', () => {
    expect(() => manifestWhitelist({})).toThrow()
    expect(() => manifestWhitelist({ permissions: [{ name: 'network' }] })).toThrow()
  })
})
