# 3,6T Platform — Code Handoff for Manus

This archive is the **code only** of the 3,6T company platform (release/unified-20261005). It contains **no live database and no real company data**. Do not ask for, and do not expect, production data: all verification is done with the synthetic seeds included here.

## Stack (deliberately minimal — keep it that way)
- Node.js 24 (uses the built-in `node:sqlite`). **Zero npm dependencies** — do not add any.
- Raw `node:http` server on port 3600: `npm start` (entry `app/server.mjs`).
- Frontend: plain-JS RTL Arabic SPA under `app/static/` — no framework, no build step, strict CSP (no inline scripts/styles).
- Database: SQLite, schema built by ordered migrations in `app/migrations/NNN-*.sql`. **Never edit an existing migration file; only append new ones** (next number after the highest present).

## How to run
```bash
npm run setup   # seeds a synthetic database
npm start       # serves http://127.0.0.1:3600
npm test        # full suite (node --test tests/*.test.mjs)
npm run check   # syntax + source fingerprints
```

## Hard rules (the owner's gate will reject violations)
1. `node scripts/quality-ratchet.mjs` — quality counters may only go down, never up.
2. `node scripts/riyadh-time-guard.mjs` — business dates use Asia/Riyadh time (`riyadhDay` in `app/static/dates.mjs`, SQL `date(x,'+3 hours')`), never UTC slicing of ISO strings.
3. Golden tests (`tests/ui-golden.test.mjs`, `tests/catalog-golden.test.mjs`) fingerprint every screen. If you intentionally change UI, regenerate with `UPDATE_GOLDEN=1` / `UPDATE_CATALOG_GOLDEN=1` and say so in your summary.
4. The platform's user-facing voice is everyday Saudi Arabic (Najdi), RTL. English is secondary (`tr('عربي','English')`).
5. The requirements register is `docs/implementation/REQUIREMENTS.json` (mirror `docs/traceability.json`); update it via `node scripts/trace.mjs --sync`, never by hand-editing summaries.
6. No secrets, no external services, no telemetry, no CDN assets — everything ships in this repo.

## Delivering your work back
Return changes as a git patch series or a branch diff against this archive's state, with: what changed, why, test results (`npm test` output tail), and ratchet/guard output. The owner's team reviews, merges, and deploys locally — you never deploy.
