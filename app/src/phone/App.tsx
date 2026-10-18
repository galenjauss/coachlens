import type { PhoneDeps } from './mount'

// Placeholder until Task 17 builds the phone UI.
export function App({ hasGlasses }: PhoneDeps) {
  return <main style={{ padding: 24 }}>CoachLens is running. {hasGlasses ? 'Check the glasses.' : 'No glasses bridge (browser mode).'}</main>
}
