# Submission checklist

Each step marked 👤 needs you.

**Status (Nov 16):** Even Hub rejected v0.1.0 on Oct 18 because its bundle held two URL strings outside `network.whitelist` (`https://react.dev/errors/` from react-dom and `http://[${e}]` from zod's IPv6 check). v0.1.1, built from `build` with the remediation, a build-time URL guard (`app/src/build/bundleUrls.ts`) and the corrected tagline/description, was submitted on Nov 16 and is in review (no approval confirmed). Earlier status: Even Hub v0.1.0 was submitted and in review. The **installed-Beta gate is OPEN**: run [`beta-acceptance.md`](beta-acceptance.md) on physical G2 and attach evidence before any copy says the installed Beta is verified. The API and phone app with the remediation were deployed on Oct 18, but the Even Hub v0.1.0 build under review does not contain it (`app/coachlens-0.1.1.ehpk` is not uploaded). Public copy that needs replacing is listed in [`claims-to-update.md`](claims-to-update.md).

## 1. Devpost (LA Hacks, deadline Sun 12:00 PM PT)

**Draft:** https://devpost.com/submit-to/30323-ai-hackathon-2026-by-la-hacks/manage/submissions/1244478-coachlens (AI Hackathon 2026 by LA Hacks). It is filled in except: the video link, the two attestation checkboxes, the ASI:One handle, and the final Terms checkbox and Submit. NOT submitted.


| Field | Ready | Source |
|---|---|---|
| Project name | CoachLens | |
| Tagline | Eyes-up notes and AI follow-up for coaches and teachers | docs/store/listing.md |
| Story (Inspiration → What's next) | ✅ | docs/devpost.md, paste as-is |
| Judging criteria answers (Made for G2, Quiet by Design, Originality, Experience & Polish, Execution + the three questions) | ✅ | docs/devpost.md "Judging criteria" |
| Built with | Even Hub SDK, TypeScript, React, Vite, Hono, Vercel, Neon Postgres, Drizzle, Claude (Haiku + Sonnet), AI SDK, OpenAI speech-to-text, Resend | |
| GitHub repo | https://github.com/galenjauss/coachlens | public |
| Challenge | ✅ Select **Even Realities** | 👤 |
| Even Hub app name | **CoachLens** | |
| Demo video (2–3 min, shows G2 view) | ⚠️ `video/out/coachlens-launch-v3.3-web.mp4` (2:21, 25.9 MB) contains **superseded claims** ("Now on the Even Hub store", "hands-free", "0 of 220+"). The source is corrected; a local re-render (v3.4) is pending. Nothing uploaded. | 👤 after the v3.4 render, replace the upload and the Devpost link (see `docs/claims-to-update.md` §2) |
| Try it | Beta build on Even Hub; README "Install and run on G2" | |
| Team present at judging | 👤 | |

## 2. Before recording

1. Reseed: done on Oct 18 (synthetic data: 1 instructor, 23 students, 4 classes, 39 notes). The earlier data is backed up in `~/lahacks-backups/prod-before-remediation-deploy-20261018-0836`. Re-run `npm run seed -w api` only if you need a clean slate; it wipes all data.
2. Pair the phone with the usual pairing code (the server holds it from `PAIRING_CODE`).
3. For developer-mode demos, scan `docs/screens/demo-qr-0.1.1.png`; it opens `https://coachlens-phone.vercel.app/?v=0.1.1` (the remediated client). A Beta install from the Even Hub portal still runs the old v0.1.0 client.
4. All outgoing mail goes to the demo inbox (`DEMO_EMAIL_OVERRIDE`), not to guardians.
5. Don't rehearse the roll call (insights only fire once per student per week).

## 3. Even Hub: Beta (required for judging)

**Status (Oct 18):** project `com.coachlens.app` created; build v0.1.0 uploaded (Private). Icon (drawn in the portal editor; the rule is that every lit pixel must belong to a filled 2×2 block), description, category Education, 5 tags, 7 screenshots and cover are saved. Permissions were read from the package.

**Left for you:** Privacy and terms (developer name, contact email/phone/address, then the privacy policy URL), and Testing group → Add user (your Even ID, which sends an invite).


1. 👤 Sign in at https://hub.evenrealities.com/login.
2. Create the project **CoachLens** (package `com.coachlens.app`), or open it.
3. Upload `app/coachlens.ehpk` → it lands in **Draft**.
4. Move it to **Test**, then add it to a Beta group with your Even account email.
5. On the iPhone: Even Realities app → Me → Beta tester → CoachLens → Install.
6. Run Even's pre-submission loop on the **beta** install. The full owner procedure, with pass/fail and evidence fields, is [`beta-acceptance.md`](beta-acceptance.md); the gate stays open until it is signed. Summary:
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

**SUBMITTED Oct 17, 2026 11:57 PM PT:** v0.1.0 is In review (submitted by Claude with Galen's explicit OK). **No approval has been confirmed.** Note that it was submitted before the §3 Beta checks were run on the installed build; those checks are still open. Even emails noreply@evenrealities.com when there's a decision; read the outcome in the dev portal inbox.


👤 **Explicit OK needed.** Moving Test → **Submitted** puts the build in Even's review queue. It can't be edited or withdrawn without support, and once approved, the version is permanent and public. Only do this after the beta checks in §3 pass on real hardware.
