# CoachLens app (Even Hub)

This is the Even Hub package for CoachLens. A single Vite + TypeScript WebView drives both the G2 lens (through the Even Hub SDK) and the phone UI (React) inside the Even Realities app. The repo-level [README](../README.md) has the full install and run guide, the project status and the API setup.

## Run

From the repo root, after `npm ci`:

```bash
npm run dev -w app                                       # Vite on :5173
cd app && npx evenhub-simulator http://localhost:5173    # G2 simulator
```

In dev, the app calls the local API at `http://localhost:8787` (start it with `npm run dev -w api`). Set `VITE_API_URL` to point at another API.

To run on real glasses over the LAN (with Even developer mode on), use `npx evenhub qr --url http://<your-lan-ip>:5173`, then scan the code from the Even app. This gives you a development build, not the installed Beta. The installed-Beta checks are in [`docs/beta-acceptance.md`](../docs/beta-acceptance.md).

## Test, typecheck, build, pack

```bash
npm test              # vitest (from app/)
npm run typecheck
npm run build         # tsc + vite build into dist/
npx evenhub pack app.json dist -o coachlens.ehpk
```

For every package you upload, record `shasum -a 256 coachlens.ehpk` and the git commit, so the installed Beta can be matched to its source.

## Layout

| Path | What |
|---|---|
| `src/lens/` | Pure reducer for every lens screen, G2 text-container renderers, gestures, planning listen |
| `src/phone/` | React phone companion: Today, Review, Agents, Students, plan editor, onboarding |
| `src/core/` | API client, offline outbox (notes and their audio wait here until delivery), dual-mic audio |
| `public/privacy.html` | Privacy policy served at `/privacy.html`, generated from [`docs/privacy.md`](../docs/privacy.md) |
| `app.json` | Even Hub manifest: `com.coachlens.app`, five permissions, network whitelist `https://coachlens-api.vercel.app` |

## Limits

- The packaged build talks to the single-coach demo deployment, which holds synthetic data only.
- iPhone is the supported phone. On Android, the WebView may pause when the phone locks.
