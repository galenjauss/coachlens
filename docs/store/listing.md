# Even Hub store listing: CoachLens

Copy for the Even Hub developer portal. The display name must match `app/app.json` `name` and the on-glasses name.

## Name
CoachLens

## Tagline (short)
Hands-free notes and AI agents for coaches and teachers.

## Description
CoachLens is for the people at the front of the room: martial-arts instructors, personal trainers and tutors. Your hands are full, twenty people need your attention, and the follow-up work piles up after class.

With CoachLens, your drill, time and the next student who still needs feedback stay quietly in your line of sight. Tap your temple and just talk: "Priya keeps dropping her guard". Agents take it from there:

- **Progress:** notes are filed to the right student. Recurring issues go into the report card and next class's plan.
- **Families:** urgent notes and requested updates become email drafts you approve.
- **Planning:** talk through the next class with your assistant in the lobby, and the plan reshapes itself, with undo.
- **Attendance:** "everyone except Jake and Mia".
- **Questions:** "who is forgetting to keep their guard up?" puts the answer in the lens.
- **Insights:** agents notice what you didn't ask about, such as a student coming back after three missed classes or someone ready to test, and tell you at the right moment. Mid-class, only if it's urgent.

You decide how much the agents do on their own: Auto, Review or Off, per agent. Billing items are reminders only; CoachLens never handles payments.

Works for martial arts, personal training and tutoring. Setup reads your roster, schedule and curriculum from a paste, a file or a photo.

## Keywords / category
Education · Productivity

## Release notes (v0.1.0)
Tap your glasses and speak a note about a student. CoachLens files it, drafts family emails for your approval, adjusts your next lesson plan, takes attendance by voice, and surfaces insights about your class right in the lens.

## Privacy policy URL
https://coachlens-phone.vercel.app/privacy.html (source: docs/privacy.md)

## Support URL
https://github.com/galenjauss/coachlens

## Backend domain (for reviewers)
`coachlens-api.vercel.app`: the developer's own Hono API on Vercel (source in `api/` of the repo). It is the only host in the network whitelist.

## Reviewer notes
- To get started, pair the phone with the code the developer provides. The glasses show "Pair on your phone…" until then, never a blank screen.
- Root double-tap opens the system exit dialog (`shutDownPageContainer(1)`).
- Demo data: martial-arts class "Kids · Tue". Try "everyone's here" at roll call, then "who is forgetting to keep their guard up?".
