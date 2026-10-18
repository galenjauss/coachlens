/** Settings entry that (re)opens the setup quiz; re-running it updates by name instead of duplicating. */
export function SetupEntry({ onOpen }: { onOpen(): void }) {
  return (
    <button type="button" className="ob-entry" onClick={onOpen}>
      <span className="lens-ring" aria-hidden="true" />
      <span className="grow"><b>Set up CoachLens</b><span className="muted">Add classes, roster and curriculum from a paste, file or photo</span></span>
      <span aria-hidden="true" className="muted">›</span>
    </button>
  )
}
