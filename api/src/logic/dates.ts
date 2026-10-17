export function localDate(d: Date, tz: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d)
}
export function localWeekday(d: Date, tz: string): number {
  const name = new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short' }).format(d)
  return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(name)
}
const toUtc = (date: string) => new Date(`${date}T12:00:00Z`)
const fmt = (d: Date) => d.toISOString().slice(0, 10)
export function addDays(date: string, n: number): string {
  const d = toUtc(date); d.setUTCDate(d.getUTCDate() + n); return fmt(d)
}
export function weekStart(date: string): string {
  const dow = toUtc(date).getUTCDay()
  return addDays(date, dow === 0 ? -6 : 1 - dow)
}
export function nextDateForWeekday(fromDate: string, weekday: number): string {
  const dow = toUtc(fromDate).getUTCDay()
  const delta = ((weekday - dow + 7) % 7) || 7
  return addDays(fromDate, delta)
}
