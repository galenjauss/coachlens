import {
  CreateStartUpPageContainer, ListContainerProperty, ListItemContainerProperty, RebuildPageContainer,
  TextContainerProperty, TextContainerUpgrade, type EvenAppBridge,
} from '@evenrealities/even_hub_sdk'
import type { PageSpec } from './render'

export type GlassesBridge = Pick<EvenAppBridge, 'createStartUpPageContainer' | 'rebuildPageContainer' | 'textContainerUpgrade'>

// List items can't be upgraded in place, so they are part of the layout identity.
const layoutKey = (spec: PageSpec) => (spec.list ? `${spec.key}\u0000${spec.list.items.join('\u0001')}` : spec.key)

/**
 * PageSpec → SDK calls, as few as possible over Bluetooth:
 * - first page: createStartUpPageContainer (once per launch);
 * - new layout key: one rebuildPageContainer;
 * - same key: textContainerUpgrade only for containers whose text changed (nothing if none did).
 * Calls are serialized and bursts coalesce to the latest page.
 */
const RETRY_MS = 2000

export class Glasses {
  private key: string | null = null
  private latest: PageSpec | null = null
  private retry: ReturnType<typeof setTimeout> | null = null
  private created = false
  private last = new Map<number, string>()
  private pending: PageSpec | null = null
  private running: Promise<void> | null = null

  constructor(private bridge: GlassesBridge) {}

  /** Forget what the glasses show, so the next show() sends a full rebuild (e.g. after the app was backgrounded). */
  invalidate(): void {
    this.key = null
  }

  show(spec: PageSpec): Promise<void> {
    if (this.retry) { clearTimeout(this.retry); this.retry = null }
    this.latest = spec
    this.pending = spec
    if (!this.running) this.running = this.drain(true)
    return this.running
  }

  private async drain(allowRetry: boolean): Promise<void> {
    while (this.pending) {
      const spec = this.pending
      this.pending = null
      try {
        await this.apply(spec)
      } catch (e) {
        console.error('[glasses]', e instanceof Error ? e.message : String(e))
        this.key = null // force a full rebuild on the next show
        if (!this.pending && allowRetry) this.scheduleRetry()
      }
    }
    this.running = null
  }

  /** One retry slot: re-send the latest page once after RETRY_MS unless something newer was shown. */
  private scheduleRetry(): void {
    if (this.retry) clearTimeout(this.retry)
    const spec = this.latest
    if (!spec) return
    this.retry = setTimeout(() => {
      this.retry = null
      if (this.latest !== spec) return
      this.pending = spec
      if (!this.running) this.running = this.drain(false)
    }, RETRY_MS)
  }

  private async apply(spec: PageSpec): Promise<void> {
    const layout = layoutKey(spec)
    if (layout === this.key) return this.upgrade(spec)
    const textObject = spec.texts.map(x => new TextContainerProperty({
      xPosition: x.x, yPosition: x.y, width: x.w, height: x.h, borderWidth: x.border ? 2 : 0, borderColor: 5, borderRadius: 4,
      paddingLength: 6, containerID: x.id, containerName: x.name, content: x.content, isEventCapture: x.capture ? 1 : 0,
    }))
    const listObject = spec.list ? [new ListContainerProperty({
      xPosition: spec.list.x, yPosition: spec.list.y, width: spec.list.w, height: spec.list.h, borderWidth: 0, paddingLength: 4,
      containerID: spec.list.id, containerName: spec.list.name, isEventCapture: 1,
      itemContainer: new ListItemContainerProperty({ itemCount: spec.list.items.length, itemWidth: spec.list.w - 8, isItemSelectBorderEn: 1, itemName: spec.list.items }),
    })] : []
    const containerTotalNum = textObject.length + listObject.length
    if (!this.created) {
      const r = await this.bridge.createStartUpPageContainer(new CreateStartUpPageContainer({ containerTotalNum, textObject, listObject }))
      // Non-zero usually means a page already exists (webview reloaded mid-session): rebuild it instead.
      if (r !== 0 && !(await this.bridge.rebuildPageContainer(new RebuildPageContainer({ containerTotalNum, textObject, listObject })))) {
        throw new Error(`createStartUpPageContainer failed: ${r}`)
      }
      this.created = true
    } else {
      const ok = await this.bridge.rebuildPageContainer(new RebuildPageContainer({ containerTotalNum, textObject, listObject }))
      if (!ok) throw new Error('rebuildPageContainer failed')
    }
    this.key = layout
    this.last = new Map(spec.texts.map(x => [x.id, x.content]))
  }

  private async upgrade(spec: PageSpec): Promise<void> {
    for (const x of spec.texts) {
      if (this.last.get(x.id) === x.content) continue
      const ok = await this.bridge.textContainerUpgrade(new TextContainerUpgrade({ containerID: x.id, containerName: x.name, content: x.content }))
      if (!ok) throw new Error(`textContainerUpgrade failed: ${x.name}`)
      this.last.set(x.id, x.content)
    }
  }
}
