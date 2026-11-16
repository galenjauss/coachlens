# Even Hub store listing: CoachLens

Copy for the Even Hub developer portal. The v0.1.0 submission used the earlier tagline ("Hands-free notes…"); the corrected copy below goes in with the next build (see `docs/claims-to-update.md`). The display name must match `app/app.json` `name` and the on-glasses name.

## Name
CoachLens

## Tagline (short)
Eyes-up notes and AI follow-up for coaches

(The portal caps the tagline at 50 characters; the longer "…for coaches and teachers." does not fit.)

## Description
CoachLens is for the people at the front of the room: martial-arts instructors, personal trainers and tutors. Your hands are full, twenty people need your attention, and the follow-up work piles up after class.

With CoachLens, your drill, time and the next student who still needs feedback stay quietly in your line of sight. Tap your temple and just talk: "Priya keeps dropping her guard". Agents handle the follow-up:

- **Progress:** notes are filed to the right student. Recurring issues go into the report card and next class's plan.
- **Families:** urgent notes and requested updates become email drafts you approve.
- **Planning:** talk through the next class with your assistant in the lobby, and the plan reshapes itself, with undo.
- **Attendance:** "everyone except Jake and Mia".
- **Questions:** "who is forgetting to keep their guard up?" puts the answer in the lens.
- **Insights:** agents notice what you didn't ask about, such as a student coming back after three missed classes or someone due a rank review, and tell you at the right moment. Mid-class, only if it's urgent.

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

Privacy, deletion and export requests go to the developer contact on this listing, not to public GitHub issues (see the privacy policy).

## Backend domain (for reviewers)
`coachlens-api.vercel.app`: the developer's own Hono API on Vercel (source in `api/` of the repo). It is the only host in the network whitelist.

## Reviewer notes
- No code or account from the developer is needed: tap **Get started** on the phone to create a private account, then add a class in setup (paste a short roster such as "Kids Tue 5pm: Priya, Leo, Mia"). Until then the glasses show "Not connected yet" or "No classes yet", never a blank screen.
- Root double-tap opens the system exit dialog (`shutDownPageContainer(1)`).
- Each account has a daily allowance of AI and speech-to-text calls; past it, notes still save and are processed later.
- For accounts created in the app, CoachLens never sends email itself: approved parent drafts are copied into the coach's own email app.
