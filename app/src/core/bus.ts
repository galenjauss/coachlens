type Events = { paired: void; startClass: void; sessionChanged: string | null }
type Handler<T> = (p: T) => void
const handlers: { [K in keyof Events]?: Handler<Events[K]>[] } = {}
export const bus = {
  on<K extends keyof Events>(k: K, h: Handler<Events[K]>) {
    const list = (handlers[k] ??= []) as Handler<Events[K]>[]
    list.push(h)
    return () => { handlers[k] = list.filter(x => x !== h) as never }
  },
  emit<K extends keyof Events>(k: K, p: Events[K]) { for (const h of (handlers[k] ?? []) as Handler<Events[K]>[]) h(p) },
}
