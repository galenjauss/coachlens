# CoachLens Privacy Policy

_Last updated: October 18, 2026_

CoachLens is an Even Hub app for instructors (martial arts, personal training, tutoring). The instructor uses it to record notes about their students and to let AI agents handle follow-up work. This policy explains what CoachLens collects, why, where it goes, and how to remove it.

CoachLens is used by **instructors**. Students, clients and parents never sign in, and CoachLens never collects data directly from children. Instructors are responsible for having the right to record information about the students they teach.

## What we collect

| Data | Comes from | Used for |
|---|---|---|
| Voice recordings | The microphone, only while you are recording a note (tap or hold on the glasses) or a planning conversation (double-tap in a class lobby) | Turned into text. **Audio is not stored**: it is sent to the speech-to-text service, the text is kept, and the audio is discarded. |
| Transcripts and notes | Your voice notes, typed edits | Progress tracking, report cards, lesson plans, answers to your questions |
| Class and roster information | Onboarding (typed, pasted, CSV, or a photo you choose), the phone app | Names, ranks or levels, schedules, curriculum, attendance |
| Parent, guardian or client email addresses | You, during onboarding or in the phone app | Sending emails **you approve** (or that you set an agent to send automatically) |
| Progress metrics | Your notes or phone entries (e.g. time in rank, lift records, test scores) | Student profiles, progress insights |
| Billing notes | Your voice notes | A reminder list for you. **CoachLens never processes payments** and never stores card or bank details. |
| Photos | Your camera or photo library, only during setup and only when you tap **Read with AI** | Reading a schedule, sign-in sheet or curriculum into your class setup. The photo is sent for that one extraction and is not stored. |
| Head-motion data | The glasses' motion sensor | Detecting a nod to turn the lens display on or off. It is processed on your phone and never sent to our servers. |

We do not collect your location, contacts, advertising identifiers, or browsing data. There are no ads and no third-party analytics.

## App permissions

| Permission | Why CoachLens asks for it |
|---|---|
| `g2-microphone` | Record voice notes and planning conversations from the glasses microphone. |
| `phone-microphone` | Record from the phone's microphone when the glasses audio isn't coming through. |
| `network` | Connect to the CoachLens service at `coachlens-api.vercel.app`. |
| `camera` | Take a photo of a schedule, sign-in sheet or curriculum during setup. |
| `album` | Choose that photo from your photo library instead. |

## Where data goes (service providers)

CoachLens runs its own backend at **`coachlens-api.vercel.app`**, built and operated by the CoachLens developer. That backend uses these processors:

| Provider | What it receives | Purpose |
|---|---|---|
| Vercel (hosting) | API requests | Runs the CoachLens service |
| Neon (database) | Your class data, notes, transcripts and settings | Storage |
| OpenAI (speech-to-text) | Note audio | Transcription only |
| Anthropic (Claude) | Transcripts, class context, setup text and photos you choose to read | Sorting notes, drafting emails, report cards and plans, answering your questions |
| Resend (email) | The emails you approve, or that you set an agent to send automatically | Email delivery |

API providers receive data only to perform these tasks for CoachLens. We do not sell or share your data for advertising.

## Automated actions and your control

Each agent has an **Auto / Review / Off** setting. Emails to parents and clients default to **Review**: nothing is sent until you approve it. You can turn any agent off. CoachLens does not give medical, legal or financial advice. Injury notes are passed on to families as observations only.

## Retention and deletion

Your data is kept while you use CoachLens. To delete a student, a note or your whole account's data, or to get a copy of it, open an issue at https://github.com/galenjauss/coachlens/issues or contact the developer through the Even Hub listing. We delete it within 30 days. Uninstalling the app removes the pairing token from your phone.

## Security

Requests are sent over HTTPS. The phone pairs with a one-time code and then uses a hashed access token. AI provider keys stay on the server and are never included in the app package.

## Changes

If this policy changes, the date above and the Even Hub listing will be updated.
