# CoachLens demo script (2:30)

Even Hub app name: **CoachLens**. Lens text below is the exact string where the app fixes it; values in *italics* come from the seed and may differ slightly on the day.

| Time | G2 shows | Phone shows | Voiceover |
|---|---|---|---|
| **0:00–0:12** Hook | (lens dark) | (in pocket) | "I teach kids martial arts. Twenty kids, both hands on pads, no time. I correct a dozen kids a class and remember two by dinner. Who is this for? Coaches like me. What moment? The middle of class." |
| **0:12–0:22** Home → lobby | Home: class list, swipe to *Kids · Tue*, tap. Lobby: class name, start time, plan length, first 3 drills, footer `tap start · 2× plan · swipe back` | — | "My glasses show tonight's class. Before we start, I plan it with my assistant." |
| **0:22–0:40** Planning conversation | Double-tap. `● Planning · 0:14` with the last words heard. Tap to stop: `Thinking · updating the plan…`, then the diff: `+ Partner sparring 6m` / `− Kata 2` / `~ Warm-up 10→5m` | — | (Coach and assistant talk naturally: "Let's cut Kata 2, shorter warm-up, add partner sparring.") "We just talk. The planner reshapes the drills and shows me the diff. Double-tap would undo it." |
| **0:40–0:58** Start class, roll call, insight | Tap OK, tap start. Tap, say "Everyone except Mia." Card: what was said, then attendance done. Then the banner: `💡 Jake's back after 3 missed` / `welcome him` | — | "Roll call is one sentence. Jake is here, and the insights agent noticed he'd missed three classes. A returning kid is high urgency, so it shows now; everything else waits." |
| **0:58–1:30** Notes | Tap, "Priya needs to keep her hands up, guard keeps dropping." Card: transcript left, progress right (`✓ sorted`, `✓ logged`, `✓ plan`). Tap, "Dee rolled her ankle and sat out the last drill." Card: urgent, `… email` (parent note drafting). Cut to the *PT · Mon 6:00* session: "Maria hit 225 on deadlift." Card: `✓ Maria · deadlift 225 lb (PR +10)`. Tap, "How's Priya doing?" Brief: *`Priya Rao · orange (8 mo)`*, *`●●○●●● steady`*, last notes, latest metric | — | "No commands. What I said shows first, then what the agents did. A routine correction goes to her progress and the next plan. An injury drafts a parent email. A lift becomes a PR. And I can ask about any kid without picking up my phone. This is not a note-taker: every note triggers agents with outcomes." |
| **1:30–1:50** End-of-class summary | Double-tap, tap to confirm. `40 min · 6 drills · 9/12 got feedback` / `Missed: Jake, Leo, Ava` / `7 agent actions · 3 to review` / `tap: put Jake, Leo first next class`. Tap | — | "When class ends, I see who got no feedback. One tap puts them first next class." |
| **1:50–2:15** Agents acting | (lens dark) | **Review:** the Dee email draft, tap Send (lands in the demo inbox). **Today → From your agents:** `Maria ready to test`, tap **Do it**, outcome shown inline. **Agents → Parent email:** autonomy control **Auto · Review · Off**, set on Review | "After class the agents have already done the work. The email waits for me. The insights agent noticed Maria is ready to test, and one tap drafts it. Every agent has Auto, Review or Off; emails never leave without me unless I choose Auto." |
| **2:15–2:30** Close | Nod: lens dark | Title card: CoachLens, "Install: Even app → Me → Beta tester → CoachLens" | "Made for G2: hands free, line of sight. Quiet by design: dark until it matters. To our knowledge, the first Even Hub app for coaches and teachers. Try it on our loaner right now. CoachLens: teach the class, the agents do the rest." |

## Recording checklist

- [ ] **Reseed first.** From the repo root with the production env loaded: `DATABASE_URL=... SEED_GUARDIAN_EMAILS=... npm run seed -w api` (the seed is idempotent; it sets up Jake's absences, Priya's guard issue, Maria's PR and the ready-to-test hit).
- [ ] **`DEMO_EMAIL_OVERRIDE` is set** in the Vercel env so every email goes to the owned demo inbox.
- [ ] Insights autonomy on **Review** (so `Maria ready to test` is waiting) and parent email on **Review**.
- [ ] **Footage:** through-the-lens capture if bright enough, otherwise the Even Hub simulator (`cd app && npx evenhub-simulator <url>`) for the lens shots. Record the phone with the iOS screen recorder as a safety take.
- [ ] Warm the API: open `https://matside-api.vercel.app/health` once (keep-warm takes over once class starts).
- [ ] iPhone charged, Do Not Disturb on, the martial-arts class selected.
- [ ] Check the 💡 glyph renders on the G2; if not, `INSIGHT_GLYPH` falls back to `✦` (update this script's lens text to match).
- [ ] If the nod misfires on camera, skip it; a tap in the dark wakes the lens.

## At the table (live)

The team pairs the loaner G2 in person (the pairing code is never written down). Let judges tap a class, tap start, say a roll call and one note about a student, and watch the card. Then show the end-of-class summary and the phone's Review tab.
