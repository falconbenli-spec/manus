# Design fix — `app/static/signature.css` (2026-09-18, round 2)

Fixer for one file. Only `app/static/signature.css` was edited (plus this note). Port 3600, `work/`, `.env`, tests, screen modules and every other file were not touched. Nothing committed or deployed.

## Defects

1. **`field` portal hero is not the turquoise stage — fixed (token half; the ground half is B's).**
   Verified: `portal-ui.mjs:16` emits `section.journey-hero`, never `.page-head`; `signature.mjs` sets `data-scene=home` for both `home` and `portal`. Block C4 matched only `#main > .page-head`.
   Change: `:root[data-design=field][data-scene=home] #main > .journey-hero` added to the C4 selector list and to its `prefers-contrast:more` twin. No token value changed.
   The matching ground rule was already in `hr-design.css:218` when I edited (`#main > :is(.page-head,.journey-hero){background-color:var(--canvas)…}`, written by the parallel hr-design fixer), so the two halves are together.
   The reviewer's alternative (scoping `--ring-live:0` so the live ring draws on the portal) was not applied and would not work: `sceneGeometry('home')` in `signature.mjs` needs `#main > .page-head > .sig-eye`, which the portal never has, so the canvas ring is off on the portal in every design, not only in `field`. `--ring-live` is unchanged.
2. **Unmapped raw statuses fall to the full comma — partly fixed, partly rejected.**
   Verified: `vendors-ui.mjs:38` and `approvals-ui.mjs:15` put the raw status in the badge class, and `in_review`, `conditional`, `requalification`, `merged` (022) and `pending_evidence`, `documented` (023) were in no group.
   Added: wait group `.in_review,.requalification,.documented`; spark/wait group `.conditional,.pending_evidence`; idle group `.merged`.
   Differences from the proposal, with reasons:
   - `documented` went to the **wait** group, not done: `approvals-ui.mjs` labels it «موثق بانتظار التحقق» and flags its tile `is-due`; the finished state is `verified`, which is already mapped.
   - `pending_evidence` went to the spark/wait group next to `needs_info` (the module flags it `is-late`). Same shape as the proposal (`--m-wait`), alerting colour.
   - `reversed`, `pending_review`, `under_review` not added: no screen module emits them as a badge class (`receivables-ui.mjs` puts the claim status there — draft/pending/approved/rejected/cancelled, all mapped; the string `reversed` does not occur in that file).
   - **Family default NOT changed** (`.badge{--m:var(--m-done)}` stays). 67 badges in the screen modules are bare `class="badge"` neutral tags, and line 468 documents the contract that a bare «مؤكد» badge is the full comma against the hollow `.badge.subtle` «مبدئي». Making the default `--m-wait` would turn all of those into "in progress" marks and erase that pair. Unmapped raw values must be added by name.
   Not done: about 95 other schema status values remain unmapped, but their modules translate them to `approved/pending/rejected/suspended/is-*` before writing the class; I found no other raw emitter with an unmapped domain (checked `app.mjs` `badge()`, `portal-ui`, `leave-ui`, `invoices-ui`, `contracts-ui`, `receivables-ui`, `review-rounds-ui`).
3. **`details.panel.panel-body > summary` 28px tall on `#finance` — fixed.**
   Verified: `finance-ui.mjs` is the only module emitting `details class="panel panel-body"`, and no stylesheet sizes that summary.
   Change: `:where(details:not([class]),details.panel) > summary:not([class]){padding-block:10px}`. Still inside `:where()`, specificity unchanged.

## Checks run (literal results)

- Static harness (scratchpad page linking the five real stylesheets, synthetic DOM, read-only file server on 127.0.0.1:3877, 375x812; the server has exited). No login, no database, no real data. Computed values:
  - field dark and field light: `.journey-hero` background `rgb(22, 160, 133)`, colour `rgb(0, 0, 0)`; `h1` `rgb(255, 255, 255)` at `36px` (large-text rule); greeting `rgb(22, 22, 22)`; paragraph `rgb(13, 13, 13)`; `.btn.primary` fill `rgb(0, 0, 0)` label `rgb(255, 255, 255)`; `--line` `rgba(0,0,0,.30)`.
  - void and slate, dark and light: `.journey-hero` background `rgba(0, 0, 0, 0)` (unchanged).
  - `details.panel > summary` 48px and bare `details > summary` 48px in all six design/mode pairs.
  - badges (field dark): `in_review`, `requalification`, `documented` → wait mask, mark `rgb(180,180,180)`; `conditional`, `pending_evidence` → wait mask, `rgb(241,196,15)`; `merged` → dash mask; `approved` and bare `badge` → full comma `M5.11 0h8.62L7.4 10H0z` (unchanged). Light mode: spark `rgb(122, 92, 0)`.
  - The harness showed 16px horizontal overflow in `field` only; the harness `#main` lacks the real `.page` class that pads by `--shell-pad`, which the bleed rule in `hr-design.css` relies on. Not checked in the real shell.
- NOT run: the real app with a session (no login performed), so `#portal`, `#vendors` and `#finance` were not looked at live; no screenshot; `prefers-contrast:more` twin not exercised; LTR not opened.
- `grep -l "signature.css" tests/*.mjs`: no test reads this file by name. Ran the front-end readers anyway: `node --test tests/production.test.mjs tests/platform.test.mjs tests/ring-engine.test.mjs tests/static-modules.test.mjs tests/motion-cards.test.mjs tests/files-security.test.mjs` → tests 53, pass 53, fail 0.
- `npm test` → tests 684, pass 684, fail 0.
- `npm run check` → «Syntax checked: 363 JavaScript modules. Source hashes match. Traceability: 220 requirements / 22 domains.»
- grep on the file for `style=` and `outline:none`: none.
