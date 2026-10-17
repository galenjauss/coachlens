export const RECURRING_THRESHOLD = 3
export const RECURRING_WINDOW_DAYS = 30
export function isRecurring(countInWindow: number, hasOpenIssue: boolean): boolean {
  return countInWindow >= RECURRING_THRESHOLD && !hasOpenIssue
}
