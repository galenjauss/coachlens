# Submission checklist

**Do not submit yet.** Everything below is prepared; each step marked 👤 needs you.

## 1. Devpost (LA Hacks, deadline Sun 12:00 PM PT)

**Draft:** https://devpost.com/submit-to/30323-ai-hackathon-2026-by-la-hacks/manage/submissions/1244478-coachlens (AI Hackathon 2026 by LA Hacks). It is filled in except: the video link, the two attestation checkboxes, the ASI:One handle, and the final Terms checkbox and Submit. NOT submitted.


| Field | Ready | Source |
|---|---|---|
| Project name | CoachLens | |
| Tagline | Hands-free notes and AI agents for coaches and teachers | docs/store/listing.md |
| Story (Inspiration → What's next) | ✅ | docs/devpost.md, paste as-is |
| Judging criteria answers (Made for G2, Quiet by Design, Originality, Experience & Polish, Execution + the three questions) | ✅ | docs/devpost.md "Judging criteria" |
| Built with | Even Hub SDK, TypeScript, React, Vite, Hono, Vercel, Neon Postgres, Drizzle, Claude (Haiku + Sonnet), AI SDK, OpenAI speech-to-text, Resend | |
| GitHub repo | https://github.com/galenjauss/coachlens | public |
| Challenge | ✅ Select **Even Realities** | 👤 |
| Even Hub app name | **CoachLens** | |
| Demo video (2–3 min, shows G2 view) | ✅ final cut: `video/out/coachlens-launch-v3.2-web.mp4` (2:30, 27.5 MB) | 👤 upload to YouTube/Vimeo, paste the link into Devpost |
| Try it | Beta build on Even Hub; README "Install and run on G2" | |
| Team present at judging | 👤 | |

## 2. Before recording

1. 👤 Reseed: `npm run seed -w api` with the production env. **This wipes all data**; a backup of the earlier data is in `~/lahacks-backups/`.
2. Re-pair the phone with the pairing code.
3. Don't rehearse the roll call (insights only fire once per student per week).

## 3. Even Hub: Beta (required for judging)

**Status (Oct 18):** project `com.coachlens.app` created; build v0.1.0 uploaded (Private). Icon (drawn in the portal editor; the rule is that every lit pixel must belong to a filled 2×2 block), description, category Education, 5 tags, 7 screenshots and cover are saved. Permissions were read from the package.

**Left for you:** Privacy and terms (developer name, contact email/phone/address, then the privacy policy URL), and Testing group → Add user (your Even ID, which sends an invite).


1. 👤 Sign in at https://hub.evenrealities.com/login.
2. Create the project **CoachLens** (package `com.coachlens.app`), or open it.
3. Upload `app/coachlens.ehpk` → it lands in **Draft**.
4. Move it to **Test**, then add it to a Beta group with your Even account email.
5. On the iPhone: Even Realities app → Me → Beta tester → CoachLens → Install.
6. Run Even's pre-submission loop on the **beta** install:
   - lock the phone for 5 min, then check the app is alive and responsive;
   - root double-tap shows the system exit dialog and the WebView closes;
   - relaunch Conversate without restarting the glasses;
   - unlock, use another app, re-lock, and check the glasses session is unaffected;
   - the core flow works with the phone locked (glasses + ring only).

## 4. Even Hub: store listing (prepared)

| Item | File |
|---|---|
| Name / tagline / description / keywords | docs/store/listing.md |
| Icon foreground (greyscale, transparent) | docs/store/icon/foreground.png (1024²) |
| Icon background (greyscale) | docs/store/icon/background.png (1024²) |
| Screenshots (simulator captures of real renders) | docs/store/screenshots/ |
| Privacy policy URL | https://coachlens-phone.vercel.app/privacy.html |
| Release notes (v0.1.0) | docs/store/release-notes.md |
| Backend domain | coachlens-api.vercel.app (the only network whitelist entry) |

Reviewer rubric checks:
- package_id `com.coachlens.app`, edition 202601, name ≤20 characters without "Even", semver version, min_sdk_version set;
- every permission is used: g2-microphone and phone-microphone (notes), network (API), camera (`captureImageFromCamera`) and album (`pickImageFromAlbum`) in onboarding;
- the privacy policy covers every permission and the backend domain;
- first run without pairing shows an on-glasses message, never a black screen;
- root double-tap calls `shutDownPageContainer(1)`;
- no medical, financial or emergency features (billing is reminders only).

## 5. Even Hub: submit for review

**SUBMITTED Oct 17, 2026 11:57 PM PT:** v0.1.0 is In review (submitted by Claude with Galen's explicit OK). Even emails noreply@evenrealities.com when there's a decision; read the outcome in the dev portal inbox.


👤 **Explicit OK needed.** Moving Test → **Submitted** puts the build in Even's review queue. It can't be edited or withdrawn without support, and once approved, the version is permanent and public. Only do this after the beta checks in §3 pass on real hardware.
