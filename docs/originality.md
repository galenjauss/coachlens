# CoachLens originality research (Even Realities G2 / Even Hub)

Date checked: 2026-10-17 (pages fetched via WebFetch/WebSearch on this date).

## Key limitation (read first)
The in-app Even Hub store listing is NOT publicly browsable. hub.evenrealities.com is a developer portal (SDK docs, Console, Discord) and contains no app catalog (fetched, confirmed). Press at launch (March 2026) says "nearly 50" / "around 50" apps and plug-ins. Therefore we could not enumerate the official store. The most complete public inventory is the community list `pangoleen/awesome-even-realities-g2` (~260 entries, about 220 of them apps/projects across categories). Any originality claim must be scoped to "apps we found", not "all apps in the store".

## Sources checked
- https://hub.evenrealities.com (landing: no catalog; Console at /hub, docs, Discord)
- https://hub.evenrealities.com/docs/get-started/overview (only "plugins" live; dashboard widgets and AI skills planned; no store listing described; no G1 statement)
- https://github.com/pangoleen/awesome-even-realities-g2 (main inventory below)
- https://github.com/galfaroth/awesome-even-realities-g1 (G1 list)
- https://apps.apple.com/us/app/even-realities/id6747017725 (first-party feature list, release notes)
- https://9to5google.com/2026/03/26/even-realities-even-hub-apps-and-better-conversate-mode/
- https://www.digitaltrends.com/wearables/even-realities-launches-even-hub-to-turn-g2-smart-glasses-into-a-full-app-ecosystem/ (fetch returned empty; used search snippet only)
- https://www.androidauthority.com/even-realities-g2-smart-glasses-apps-3654769 (fetch 403; search snippet only)
- https://www.wareable.com/wearable-tech/even-realities-g2-r1-review (fetch 403; search snippet only)
- https://evenrealities.com/even-g1-smart-glasses, https://www.evenrealities.com/en-AE/education-discount (search snippets)
- Repo READMEs fetched: tntpsu/Cue, abhishekj720/Cue-evenRealitiesG2, Tej-Sharma/even-reality-memory-system, cphizz/SalesEye, fabioglimb/even-workout
- Not reachable: Reddit, Discord (no public access), aleapc/speechcoach-g2 (404). Searches for teacher/coach/tutor/classroom/attendance returned no dedicated app.

## First-party G2 features (Even Realities app, App Store listing)
| Feature | What it does | Overlap with CoachLens |
|---|---|---|
| Conversate | Contextual AI during conversations: explains terms, bios, answers, subtitles, meeting summaries; Prep Notes (v2.1.1) upload docs to surface in conversation | Partial (transcribes/summarizes a conversation; not per-student, no agents, no outputs to parents) |
| Teleprompt | Scrolls a script paced to speech | None |
| Translate | Live subtitles, 35 languages | None |
| Navigate | Directions overlay | None |
| Even AI | Voice Q&A and feature control | Partial (generic voice assistant; no student model) |
| Dashboard | Widgets for health, headlines | None |
| Notification | Phone app updates in view | None |
| QuickList / Reminders | Voice to-dos with due dates | Partial (voice capture of tasks, not per person) |
| QuickNote | Create/view notes on G2 | Partial (voice note-taking; plain notes, no student link, no agents) |
| Health (with R1) | Vital signs | None |
| Terminal Mode (v2.2.1) | Control AI coding agents | None |
| Even Hub | Plugin gallery (v2.1.2) | The platform, not an app |

## Apps found (community inventory, awesome-even-realities-g2) 
Closest-to-CoachLens items, with detail:

| Name | Category | What it does | Overlap | Why |
|---|---|---|---|---|
| Cue (tntpsu) | AI/Coaching | Live conversation coach; shows 2-3 suggested replies (Date, Sales close, Listen well modes). Runs from Even Hub launcher | Partial | Coaches the wearer's own speech; no students/clients, no per-person tracking |
| Cue (abhishekj720) | AI memory | Voiceprint enroll; HUD card with name, intro, last spoke; double-tap adds note to last matched person. Needs laptop backend | Partial | Closest: notes about people. But it is a social-memory app: no roster, attendance, lesson plans, email drafts, billing, feedback coverage, or agents |
| Even Reality Memory System | AI memory | Spoken thoughts saved to a personal knowledge base, meeting transcripts, live cues | Partial | Personal KB for the wearer; per-person isolation not described |
| SalesEye | AI/Sales | Sales coach cues during live calls | Partial (name only) | Coaches the wearer in sales calls; not instructor-of-students |
| AI Sales Assistant | AI/Sales | Salesforce browsing and meeting cues | None | CRM for sales |
| speechcoach-g2 | Voice | Speech-pacing coach (page 404, description from list only) | None | Coaches the wearer's own speaking |
| Lingua Franca / lingua-lens | Voice/Learning | Language conversation / English phrase coach | None | Learner-side, not instructor |
| even-workout | Fitness | Guided workout, sets/reps/rest, history | Partial (fitness) | Self-training; not for trainers with clients (verified README) |
| hevy-g2, G2 Gym App | Fitness | Workout display / tracking | Partial (fitness) | Self-tracking (from list description) |
| EyeFit, golf-caddie-glasses, evenhub-running-tracker | Fitness | Eye exercises; golf data; run pace | None | Personal use |
| G2 Flashcards, SMRTi, Lenski, Quiz Flashcards, bible-memory-g2, kubectl Drill | Learning | Spaced-repetition / quiz study | None | Learner-side |
| Soniox Note, stt-even-g2, Convo Exchange | Voice | Transcription / voice notes | Partial | Plain transcription; no entity or agent layer |
| g2sidian, ER Markdown Notes, even-scribe, even-g2-obsidian, EvenG2_GoogleKeep, even-docs | Notes | View/edit/capture personal notes | Partial | Generic notes, not student-linked |
| powerslides | Productivity | Slide control + speaker notes | None (adjacent to teaching) | Presenter tool |
| whisprompt, PitchBeam, Even-LotH | Teleprompter | Scripts/pace | None | |
| G2 Captions | Voice | Accessibility captioning | None | |
| Pulse, Ethan HUD, Daily App | Productivity | Calendar/tasks dashboards | None | |
| even-g2-agentic-app, claude-code-g2, etc. | AI agents | Voice to coding agents/MCP | None | Agent frameworks for dev work, not instruction |

No entry in any category mentioned teachers, tutors, students, classroom, attendance, lesson plans, parent communication, or billing.

Remaining apps (all judged Overlap = none from name/one-line description; not individually fetched):
- Productivity (~85): weather-even-g2, epub-reader-g2, rdt-even-g2, even-stars, Glance, wordpeek-g2, PRLens, even-messages, even_score, tmux-on-g2, even-aozora-reader, Visionote, Nutshell, Simple HUD, My Pomodoro, even-matrix, G2Terminal, even-menu, NBA Pulse, even-prayer, even-g2-apps, x-for-even-g2, matrix-g2, even-kitchen, Bring-Lens, EvenAware, NOSnieuws_G2, Glance G2, BreakMate, SolarWorldClock, even-simple-calendar, even-simple-timer, notion-ultimate-brain-even-g2, flipctl, Even-G2-Sentinel-Ops, even-browser, G2-Gmail, G2-md-browser, even-todoist, 2FA-for-G2, Even-R-Clock, level-even-g2, reddit-feed-even, Birdie, Smokeless, even-traeger, fronius-even-g2, aviation-weather, Sun-Scout-Pro, calendar-companion, evenG2, even-my-news-hub, Status Deck, Sandevistan, Obsidian on G2, Even Browser, TeleGlance, VOX, G2 Network Scanner, Applied Resonance, Meater Cooks, CyberNews, Footy Live, World Cup Live Scores, Glim, Salah Companion, Moon Phase, Quick Tip. (Partial overlap check: even-todoist/Notion are personal task tools.)
- Navigation/transit (28): even-transit, wander, World-Monitor, moto-hud, G2 Drive Nav, MetroTracker, Perron-NS, JapanTrainTransit, geocache, Checkin, EUC-G2-Hud, adventure-hud, G2BusTracker, RoadView-G2, HUD-Navigation, Wondereye, StoryWalk, Hunter, compass, apexline-g2, EvenGo-Paris, KVV, glass-transit-511, subwaylens, Aviation HUD, TideView, HSL Stops, Peak Radar, Flight, ALPR Scout.
- Smart home/car (7): tesla-even-g2, even-home-assistant, Homekit integration, g2_macrodroid, connect-remote, glass-car-dash, Bambu G2.
- Finance (6): even-market, crypto-ticker, news-ticker, currency-hub, Even Balance, Market Intel G2.
- Games/learning (~28): EvenChess, Solitaire, snake, pong, tetris, arkanoid, flappy, gloss (ASL), Heads or Tails, HoppyRoads, Vault Zero, Card Pack, House Games, even-doom, EvenFoundryVTT, darts, sliding-puzzle, map-quiz, evenTaipan, Tamagotchi, Math Reader, WAD Player, CubeNet (plus learning apps above).
- Media (13) and Streaming (2): lyrics-glow, DisplayPlusMusic, Apple Music HUD, guitar tuner, MuSe, Sudden Karaoke, spotify-g2, now-playing, matrix rain, orpheus-g2, media-remote, multi-instrument tuner, Ambience; EvenTwitchChat, g2-twitch-hud.
- AI/agent (34): claude-code-g2, cc-g2, g2-caduceus, g2-channels, Even-Voice-AI, evenai-gemini-bridge, local-agent, openclaw-g2-hud, unofficial local assistant, GlassAI, Hermes clients, G2 OpenClaw, even-better, OpenVide, EvenHub-LocalLLM, cos-glasses-server, G2CC, claude-hud, even-terminal-pi, even-deimos, even-jarvis, EvenCode, HeadLenss, evenai-anthropic-bridge, Work Bench, Agent Home, AR Vision, EvenDash, xangi, ExEye, and the Cue / Memory apps above.
- Tooling/SDK/protocol repos (~90, not apps): excluded from app count.
- Count: roughly 220 community apps/projects (hand count of category lists, +/-5), plus 12 first-party features. The official store reportedly held ~50 listings at launch; which of the community projects are published in the store is unknown.

## G1 (previous model)
- Even Hub is documented only for G2; no official statement found that Even Hub plugins run on G1 (docs and G1 product page silent; R1 ring is G2-only per G1 page snippet).
- The G1 list (galfaroth/awesome-even-realities-g1) names only: EvenDemoApp, even_glasses (Python wrapper), g1_flutter_blue_plus, AugmentOS (listed "coming soon"). None involve teaching, coaching, students or notes about people. G2 compatibility not stated.
- G1 community apps in the G2 repo's legacy section: Fahrplan (life assistant), Helix (live transcription), Everse (dashboard/navigation), RSS reader, G1 Extended. None relate to instruction. G2 compatibility unverified.

## Defensible claim
Strongest true statement:

> "Of the ~220 community apps and projects we found for the Even G2 (plus Even Realities' own built-in features), none is built for instructors: we found no app that tracks a class roster, attributes spoken notes to individual students, takes attendance, drafts parent emails, plans lessons or flags billing. CoachLens is, to our knowledge, the first Even Hub app for coaches and teachers."

Caveats we should say aloud or keep in notes:
- The official Even Hub store is not publicly listable, so say "that we found" / "to our knowledge", not "the only".
- Honest partial overlaps: Even's QuickNote and Conversate record text/summaries; Cue (abhishekj720) stores per-person voiceprint notes; Cue (tntpsu) and SalesEye coach the wearer; even-workout/Hevy/Gym track the wearer's own training. Our difference: those capture or coach the wearer; CoachLens turns a spoken note about one student into agent actions (progress tracking, parent email draft, lesson/drill deck, attendance, billing flags) and shows feedback coverage in the lens.
- Re-check the in-app Hub listing on a real phone before the final submission to confirm no instructor app was published.
