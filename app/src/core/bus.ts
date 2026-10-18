export type ImuSampleEvent = { x: number; y: number; z: number; nod: boolean }
type Events = {
  paired: void; startClass: void; sessionChanged: string | null; classChanged: string | null; deckChanged: void
  /** Every IMU sample the lens receives (for the phone calibration readout); `nod` = the detector fired on it. */
  imuSample: ImuSampleEvent
  /** The phone IMU readout opened (true) or closed (false): the lens keeps the IMU on while it is open. */
  imuDebug: boolean
}
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
