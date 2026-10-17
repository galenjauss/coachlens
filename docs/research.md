# Research notes (2026-10-17)

Evidence labels: STRONG = primary data or peer-reviewed research; MODERATE = vendor-observed data from a large sample; WEAK = blog posts, unsourced figures, anecdotes.

## Market
- US martial arts studios: about 40k–76k (IBISWorld 2026: 76,364, MODERATE; Glofox: about 42k, WEAK). The gap likely depends on whether sole proprietors are counted.
- Industry: about $21.0B revenue and 127k employees (IBISWorld 2025). That is fewer than 2 employees per studio, consistent with mostly owner-operated schools.
- Gymdesk 2026 Benchmark (4,594 gyms, observed data, MODERATE): about 57% have fewer than 100 members. 78% run a kids program. Kids-program gyms average 237 members vs 107 for adults-only. 43% still take attendance by hand. https://gymdesk.com/gym-benchmark-report
- Share of schools run by a solo instructor: NOT FOUND.

## Pain: churn and follow-through (Gymdesk Benchmark, MODERATE)
- About 1 in 5 new members quit within 90 days. After that, monthly churn is 2–3.5%.
- 24-month cancellation falls as attendance rises: 44.2% (less than once every 2 weeks) → 23.2% (3+ times a week).
- Trial conversion: **85.4% with automated software follow-up vs 70.8% with manual owner follow-up.**
- Youth sports (Aspen Project Play, STRONG–MODERATE): kids quit when it stops being fun; 29% said "not good enough", 21% said bad coaching.

## Why personalized feedback and parent communication matter
- Kraft & Rogers 2015 (randomized trial, n=435, STRONG): weekly one-sentence personalized teacher→parent messages cut course failure from 15.8% to 9.3% (−41% relative). "What to improve" messages worked best. https://annenberg.brown.edu/publications/underutilized-potential-teacher-parent-communication-evidence-field-experiment
- Wisniewski, Zierer & Hattie 2020 meta-analysis (435 studies, STRONG): feedback d=0.48 overall; motor skills d=0.63; **high-information feedback d=0.99 vs praise/punishment d=0.24.** https://pmc.ncbi.nlm.nih.gov/articles/PMC6987456
- PE: pre-service teachers gave feedback about once every 56–86 s, mostly generic praise. Only 51% of students said the teacher often talked to them (WEAK–MODERATE). Low-fitness students feel "seen" less (Lagestad 2019, n=26, WEAK).
- "Invisible middle": no rigorous study names or measures it, so present it as a hypothesis.
- **Prior art for a heads-up "who needs attention" display:** Lumilo (CMU, Holstein et al., AIED 2018). Mixed-reality glasses showed teachers per-student status. Students learned more when teachers wore it (n=286).

## Competitors
- Kicksite, Zen Planner, Spark ($199/mo), Gymdesk (from $75/mo), Mindbody (from $99/mo), Martialytics, OnMat. All offer rank tracking plus email/SMS. Where AI exists, it targets marketing or the front desk.
- **No instructor-side voice-first or hands-free capture during class found.** The closest are student-side voice training logs (RollForge, Grappling AI).
- No martial arts or teaching-coach app found on G2 / Even Hub.

## Platform facts (Even docs, STRONG)
- iOS: the app's web view keeps running when the phone is locked, and mic capture continues. Android: may be suspended; mic and sockets stop; treat resume as a cold start. → Demo on iPhone; persist state in localStorage.
- No built-in speech-to-text: bring your own through a server proxy. Never bundle API keys.
- Network: whitelist full HTTPS origins in app.json, and the server must send CORS headers.
- Review rules: double-tap on the root page → exit dialog; first run shows instructions on the glasses ("never a black screen"); reviewers lock the phone and expect timers to finish and the app to respond after 2 minutes idle.
- Prohibited categories: medical diagnosis, financial advice, emergency routing. Billing = neutral flags only.
- Glance design: about 2 s per glance, ≤3 rows. No font size control; build hierarchy with position, borders and glyphs (`>`, `━─`, `●○`).
- Even's direction: Conversate / Prep Notes = preload context → live prompts on the lens → act afterwards. Pitch: **"Prep Notes for the dojo."**
- Hackathon pattern (WEAK): winners pick a specific hands-busy, eyes-up user, give a live and visceral demo where the AI does real work, and keep a narrow, polished scope (e.g. HackMIT 2025 Mentra-track winner Marvis: step-by-step handyman instructions on G1).
