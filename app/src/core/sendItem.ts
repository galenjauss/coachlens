import type { Api } from './api'
import { bus } from './bus'
import type { Outbox, OutboxItem } from './outbox'
import { fromB64 } from './wav'

/** Send one outbox item as an utterance. C1: the item id is the operation id (form field + Idempotency-Key). */
export function sendOutboxItem(api: Pick<Api, 'utterance'>, i: OutboxItem) {
  return api.utterance({
    sessionId: i.form.sessionId, drillId: i.form.drillId, mode: i.form.mode, text: i.form.text,
    audio: i.form.audioB64 ? new Blob([fromB64(i.form.audioB64) as BlobPart], { type: 'audio/wav' }) : null,
  }, { opId: i.id })
}

/** Phone-only boot (no lens controller): the phone's Retry / Send now flushes the outbox itself, ignoring backoff. */
export function wirePhoneOnlyRetry(outbox: Outbox, api: Pick<Api, 'utterance'>): () => void {
  return bus.on('outboxRetry', () => {
    void outbox.flush(i => sendOutboxItem(api, i), { force: true }).catch(e => console.error('[outbox] phone flush failed', e))
  })
}
