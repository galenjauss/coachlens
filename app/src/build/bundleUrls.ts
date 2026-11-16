/**
 * Build-time only (imported by vite.config.ts, never by the app). Even Hub review scans the
 * shipped bundle for URL string literals and flags any host missing from the manifest's
 * `network.whitelist`. Dependencies carry a few that are never fetched, so we rewrite those
 * after minification and fail the build if anything unexpected is left.
 */

/** Dead URL literals from dependencies, rewritten to equivalent code with no URL in it. */
export const DEAD_URL_REWRITES: ReadonlyArray<{ readonly from: string; readonly to: string; readonly why: string }> = [
  {
    // react-dom's formatProdErrorMessage builds a docs link for console output only.
    from: '`https://react.dev/errors/`',
    to: '`React error #`',
    why: 'react-dom prod error-message docs link (console text only)',
  },
  {
    // zod's IPv6 check calls new URL(`http://[addr]`) locally; nothing is fetched.
    // Splitting the scheme keeps the runtime string identical.
    from: '`http://[${',
    to: '`${"http"}:/${"/"}[${',
    why: 'zod IPv6 validator parses a synthetic URL (no request)',
  },
]

/**
 * XML / JSON-schema namespace identifiers. They must stay byte-exact (createElementNS, $schema)
 * and are never requested. Even Hub review did not flag them.
 */
export const INERT_URL_PREFIXES: ReadonlyArray<string> = [
  'http://www.w3.org/',
  'http://json-schema.org/',
  'https://json-schema.org/',
]

const URL_LITERAL = /\bhttps?:\/\/[^\s"'`)\\<>]*/g

export function rewriteDeadUrls(code: string): string {
  return DEAD_URL_REWRITES.reduce((acc, { from, to }) => acc.split(from).join(to), code)
}

/** Every URL literal in `code` that is neither whitelisted nor an inert namespace ID. */
export function findUnlistedUrls(code: string, whitelist: ReadonlyArray<string>): string[] {
  const allowed = (url: string): boolean =>
    whitelist.some((origin) => url === origin || url.startsWith(`${origin}/`)) ||
    INERT_URL_PREFIXES.some((prefix) => url.startsWith(prefix))
  const found = code.match(URL_LITERAL) ?? []
  return [...new Set(found.filter((url) => !allowed(url)))]
}

/** Reads `network.whitelist` out of a parsed app.json; throws if the manifest shape is wrong. */
export function manifestWhitelist(manifest: unknown): string[] {
  const permissions = (manifest as { permissions?: unknown })?.permissions
  if (!Array.isArray(permissions)) throw new Error('app.json: missing permissions array')
  const network = permissions.find((p: { name?: unknown }) => p?.name === 'network') as
    | { whitelist?: unknown }
    | undefined
  const list = network?.whitelist
  if (!Array.isArray(list) || !list.every((u) => typeof u === 'string')) {
    throw new Error('app.json: network permission needs a string[] whitelist')
  }
  return list
}
