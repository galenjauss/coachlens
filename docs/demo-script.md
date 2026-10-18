# CoachLens demo script (2:30)

Even Hub app name: **CoachLens**. Lens text below is the exact string where the app fixes it; values in *italics* come from the seed and may differ slightly on the day.

| Time | G2 shows | Phone shows | Voiceover |
|---|---|---|---|
| **0:00–0:10** Hook | (lens dark) | (in pocket) | "I teach kids martial arts. Twenty kids, hands on pads. I correct a dozen a class and remember two by dinner. This is for coaches like me, in the middle of class." |
| **0:10–0:20** Home → lobby | Home: class list, swipe to *Kids · Tue*, tap. Lobby: class name, start time, plan length, first 3 drills, footer `tap start · 2× plan · swipe back` | — | "My glasses show tonight's class. Before we start, I plan it with my assistant." |
| **0:20–0:36** Planning conversation | Double-tap. `● Planning · 0:14` with the last words heard. Tap to stop: `Thinking · updating the plan…`, then the diff: `+ Partner sparring 6m` / `− Kata 2` / `~ Warm-up 10→5m` | — | (Coach and assistant talk naturally: "Let's cut Kata 2, shorter warm-up, add partner sparring.") "We just talk. The planner reshapes the drills and shows me the diff." |
| **0:36–0:52** Start class, roll call, insight | Tap OK, tap start. Tap, say "Everyone except Mia." Card: what was said, then attendance done. About 2 s later (an immediate insight check after attendance changes) the banner: `💡 Jake's back after 3 missed` / `welcome him` | — | "Roll call is one sentence. Jake is here, and two seconds later the insights agent notices he missed three in a row. A returning kid is high urgency, so it shows now; everything else waits." |
| **0:52–1:18** Notes | Tap, "Priya needs to keep her hands up, guard keeps dropping." Card: transcript left, progress right (`✓ sorted`, `✓ logged`, `✓ plan`); this is her 3rd guard note, so it is recurring and goes to the report card and the next plan. Tap, "Dee rolled her ankle and sat out the last drill." Card: urgent, `… email` (parent note drafting). Cut to the *PT · Mon 6:00* session: "Maria hit 225 on deadlift." Card: `✓ Maria · deadlift 225 lb (PR +10)`. Back in the martial-arts class, tap, "How's Priya doing?" Brief: *`Priya Rao · orange (8 mo)`*, *`●●○●●● improving`*, last notes, latest metric | — | "No commands. What I said shows first, then what the agents did. Priya's guard has dropped three times now, so it becomes a report card line and a change to next class's plan. An injury drafts a parent email. A lift becomes a PR. And I can ask about any kid without picking up my phone. Every note triggers agents with outcomes." |
| **1:18–1:32** Class questions | Tap, "Who is forgetting to keep their guard up?" ANSWER card: `Guard: Priya (3), Leo (2)`. Optional second ask if time allows: "Who hasn't gotten feedback today?" | — | "And I can ask the class a question. Who keeps dropping their guard? Priya three times, Leo twice, straight from tonight's notes. Counts like 'how many are here?' answer instantly with no AI call." |
| **1:32–1:50** End-of-class summary | Double-tap, tap to confirm. `40 min · 6 drills · 9/12 got feedback` / `Missed: Jake, Leo, Ava` / `7 agent actions · 3 to review` / `tap: put Jake, Leo first next class`. Tap | — | "When class ends, I see who got no feedback. One tap puts them first next class." |
| **1:50–2:15** Agents acting | (lens dark) | **Review:** the Dee email draft, tap Send (lands in the demo inbox). **Today → From your agents:** `Gus ready to test`, tap **Do it**, outcome shown inline. **Agents → Parent email:** autonomy control **Auto · Review · Off**, set on Review | "After class the agents have already done the work. The email waits for me. The insights agent noticed Gus is ready to test: 120 days at his rank and no open issues, and one tap drafts it. Every agent has Auto, Review or Off; emails never leave without me unless I choose Auto." |
| **2:15–2:30** Close | Nod: lens dark | Title card: CoachLens, "Install: Even app → Me → Beta tester → CoachLens" | "Made for G2: hands free, line of sight. Quiet by design: dark until it matters. To our knowledge, the first Even Hub app for coaches and teachers. Try it on our loaner right now. CoachLens: teach the class, the agents do the rest." |

## Recording checklist

- [ ] **Reseed first, the same day as recording.** From the repo root with the production env loaded: `DATABASE_URL=... SEED_GUARDIAN_EMAILS=... npm run seed -w api`. **This WIPES all data** before reseeding. The PR insight only counts for 7 days and insights dedupe weekly, so a stale seed loses beats. The seed sets up: Jake (missed 3 in a row), Priya (two earlier guard notes and a resolved `focus` issue; the live note is her 3rd), Gus (martial arts, ready to test), Maria Gomez (PT, squat PR 185 three days ago), Eli (no feedback), Noah (grade drop 84% → 72%) and Leo (repeated billing flags).
- [ ] **`DEMO_EMAIL_OVERRIDE` is set** in the Vercel env so every email goes to the owned demo inbox.
- [ ] Insights autonomy on **Review** (so `Gus ready to test` is waiting) and parent email on **Review**.
- [ ] **Footage:** through-the-lens capture if bright enough, otherwise the Even Hub simulator (`cd app && npx evenhub-simulator <url>`) for the lens shots. Record the phone with the iOS screen recorder as a safety take.
- [ ] Warm the API: open `https://matside-api.vercel.app/health` once (keep-warm takes over once class starts).
- [ ] iPhone charged, Do Not Disturb on, the martial-arts class selected.
- [ ] Check the 💡 glyph renders on the G2; if not, `INSIGHT_GLYPH` falls back to `✦` (update this script's lens text to match).
- [ ] If the nod misfires on camera, skip it; a tap in the dark wakes the lens.

## At the table (live)

The team pairs the loaner G2 in person (the pairing code is never written down). Let judges tap a class, tap start, say a roll call and one note about a student, ask "who is forgetting to keep their guard up?", and watch the card. Then show the end-of-class summary and the phone's Review tab.
