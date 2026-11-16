/**
 * Drafts-only email: a self-serve account's approved drafts are sent by the coach from their own email app, never by
 * CoachLens. These helpers build what the coach pastes or opens.
 */

/** The whole draft as one block to paste: recipient, subject, then the body. */
export function emailText(to: string, subject: string, body: string): string {
  return `To: ${to}\nSubject: ${subject}\n\n${body}`
}

/** A mailto: link that opens the phone's email app with the draft filled in. */
export function mailtoHref(to: string, subject: string, body: string): string {
  return `mailto:${encodeURIComponent(to)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`
}

/** Copies text, with a fallback for WebViews without the async Clipboard API. Throws when neither works. */
export async function copyText(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    try { await navigator.clipboard.writeText(text); return } catch { /* fall back below */ }
  }
  const area = document.createElement('textarea')
  area.value = text
  area.setAttribute('readonly', '')
  area.style.position = 'fixed'
  area.style.opacity = '0'
  document.body.appendChild(area)
  area.select()
  const ok = document.execCommand('copy')
  area.remove()
  if (!ok) throw new Error('Couldn’t copy on this phone. Use Open in Mail, or Edit and copy the text yourself.')
}
