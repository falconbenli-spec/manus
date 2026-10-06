# Design package C — components and the single filled action

Date: 2026-09-18. Resumed run: an earlier attempt was cut off by a usage limit. This run inspected what was there, kept it, fixed four defects and added what was missing.

## Files touched

- `app/static/style.css` (the only product file; layers `components` and `fill`, plus five `@keyframes` outside layers as the plan allows)
- `docs/implementation/handoff/design-C.md` (this file)

Nothing else was edited. No test, no screen module, no migration, `.env`, `work/` or port 3600 was touched. A throwaway verify server ran from the session scratchpad on `127.0.0.1:3793` with its own temporary synthetic database; it is stopped and the database deleted.

## What this run found and changed

The file left by the cut-off run was structurally complete (both layers closed, every class family of plan §2-C present). Defects found and fixed:

1. **Custom-property collision with package A.** C used `--w` as the mark's width; A uses `--w` as the inherited word colour of a state (`.is-late{--w:var(--stop)}`). On any element with a state, the painter's `inline-size:var(--w,8px)` received a colour and became invalid (mark collapses). Renamed C's property to `--mk` everywhere.
2. **C was redefining state colours on alerts** (`--c/--m` on `.vn-alert`, `.notice`, `.error`), which the plan forbids ("no painter redefines a colour") and which overrode A's state layer because `components` beats `state`. Removed; C now only consumes `var(--c)` for the ruler and the `strong`.
3. **`.btn.small` touch target was 42px, not 44px** (absolute inset counts from the padding box, inside the 1px edge). Inset is now -5px. Measured 44px.
4. **A2 first action**: the first button in `.vn-head`/`.vn-body` action bars is now a full 44px edged pill even when the markup says `small` (spec §6.5). Size only; no `:first-child` grants a fill.

Added or tightened:

- `.vn-board` (was missing): section rhythm, and `:is(.vn-block,.vn-board) > h2|h3` get the title/label treatment and the label mark.
- vn-block fold now carries the plan's selector literally, narrowed to the safe shape: `.vn-block:not(:has(ul,ol,table,dl,.vn-tiles)):has(> :is(h3,.panel-head):first-child + p.subtle:last-child)`. The bare spec selector would also fold blocks that hold a form or prose.
- Page-level error is scoped to what `app.mjs:263` really renders: `#main > .error:is(:only-child,:first-child:has(+ .btn:last-child))` (the spec's `:only-child` never matches because a reload button follows; the previous `:first-child` was too broad).
- `.ai-output` font size uses `--fs-body-l` instead of a literal 17px (contract 1: no literal sizes). It renders 18–20px, not 17.

## What is done (plan §2-C coverage)

Structure (`.operations .panel .panel-head .panel-body .vn-head .vn-board .vn-grid .split .vn-block .vn-group`), tiles (`.vn-tiles .vn-tile .stats .stat .stat-label .stat-number .counts .hr-focus .figure .pt-tiles .pt-tile .acc-stats`), record card (`.vn-card .vn-code .vn-name .vn-flags .vn-body .vn-reqs .vn-req .vn-chips`, sticky summary at `--stick-2`, two-line grid at 375), `.sig-filter` size and `--stick-1`, alerts, routes and pipelines (`.vn-pipeline .vn-step .vn-days .journey .journey-step .step-no .journey-path .journey-stop .ex-flow .ex-step .ex-arrow`), bars, buttons and `.text-button`, `details.sig-more`, dialog and phone sheet (`#dialog .drawer .launcher .dialog-head .dialog-body .sheet-close .form-actions #dialog-error`), journey dialog family and the three tour hides, `#toast`, `.empty` (route-based good/missing), page-level error, `.timeline .timeline-item details.sig-older .file .ai-output`, `#main.journey-enter` per tier and sensitive routes, forced-colours block. `@layer fill` holds the attribute whitelist.

All three designs and both modes arrive through tokens only: no literal colour, no `[data-design]` rule was needed in this file.

## Deliberate deviations (recorded, not reopened)

- **Inbox first-row fill is not in the whitelist** (decision 12): `app/inbox.mjs` ordering was not verified as oldest-first, so every inbox row link stays text.
- **One light per scene** is enforced inside the whitelist: a later `.btn.primary`, `punch_out` beside `punch_in`, and `submit`/`claim`/`complete` beside a stronger transition are excluded. The spec lists `submit` unconditionally; this is stricter.
- `.journey-step` derives `--c/--m` from the badge inside it (`:has(.badge.approved)` …) because the markup carries no state class there. Tokens only.
- `.vn-days`: the markup carries a full date plus a sentence per day, so each day is a record row (grid of 260px columns from 760), not the spec's 28px cell strip.
- Bars: the 63° end cut is not drawn; at 2px height it is under one pixel.
- Tiles use flex-wrap, not `grid auto-fit`; same visual result, no orphan stretching.

## Checks run, literal results

Static (on `app/static/style.css`):
- `grep -nE 'box-shadow|backdrop-filter|(^|[^-])gradient\('` → empty
- `grep -n '!important'` → one line: the three tour hides (allowed)
- `grep -nE 'outline:(none|0)'` → empty; physical properties (`left/right/top/width/height…`) → empty; `letter-spacing` → empty; hex/rgb literals → empty; `https?://` → empty; `grep -c 16A085` → 0
- Brace/layer scan: depth ends 0; top-level blocks are exactly five `@keyframes`, `@layer components`, `@layer fill`
- Every `var(--token)` used exists in `signature.css` except C's own locals (`--btn-bg --btn-h --btn-w --c0 --m0 --mk`) and `--drag` (written by `signature.mjs`)
- Size: **33,289 bytes. Over the plan's 24KB target.** Total CSS is 206KB against the 101KB budget; every package is over. Not trimmed in this run.

Tests:
- `node --test tests/static-modules.test.mjs tests/dialog-races.test.mjs tests/ui-race.test.mjs tests/motion-cards.test.mjs tests/ui-render.test.mjs` → 7 pass, 0 fail
- `npm run check` → "Syntax checked: 363 JavaScript modules. Source hashes match. Traceability: 220 requirements / 22 domains."
- `npm test`, run twice at the end: first run had a failure inside `tests/ring-engine.test.mjs` (a new test of package E's `motion-cards.mjs` engine, which was being written at that moment; it does not read `style.css`). Second run minutes later: **684 tests, 684 pass, 0 fail.**
- No test in `tests/` reads `style.css` (grep: none).

Browser (Chromium pane, computed styles and geometry through JS; void/dark unless noted):
- Route walk, all nav routes, checking horizontal overflow, filled buttons visible > 1, and any `.btn`/`.text-button`/`sig-more summary` target < 44px: manager 59 routes at 375, 1024, 1440 → no finding; hr 55 routes at 375 → no finding.
- `#attendance`: `button.btn.outline.small[data-operation=punch_in]` inside `.vn-head .operation-actions` is filled (rgb(22,160,133), black text, 56px); the others are 44px text actions. The layer test passes.
- Dialog at 1440: 640px centred, 1px `--line-strong` edge, radius 0, `::backdrop` rgba(0,0,0,.94), `#app` opacity 1, close 44×44, `#dialog-error` order -1 sticky, submit filled 48px, cancel edged 44px. At 375: bottom sheet, 24px top corners, top edge only, `column-reverse`, both buttons 52px full width, no horizontal overflow.
- Sticky ladder on `#vendors` (7 cards, filter present) at 1440: topbar bottom 64, siblings 108, filter 108–152, open summary sticks at 152 with height 64 and opaque canvas.
- `#contracts` at 375: head actions wrap, `sig-more` holds the rest and opens full-width with 44px text actions; summary is three lines, not sticky.
- Injected fixtures (debug only): transition sets `approve+reject+return`, `submit+cancel`, `claim+cancel`, `complete`, `claim+complete`, `approve+submit+claim` each light exactly one button; alert grades, journey steps (passed / current 16px turquoise / next), `sig-older` summary 44px, timeline mark, toast (pill, 32px from the bottom, z 120) all as specified.
- Designs: filled CTA on `#portal` reads `--action/--on-action` correctly in void, field and slate, both modes (text on fill 6.4:1; slate light 4.85:1). In `field` home the hero tokens flip to black-on-white and C's rules follow with no design-scoped rule.

## Not done / not verified

- **No screenshot was looked at.** The browser pane was not displayed for most of the run, so screenshots timed out; one early frame (a sibling package's harness) showed the filled and edged pills rendering correctly. Everything above is computed-style and geometry, not a visual review. A human pass on the ten screens is still needed.
- Request detail (`[data-transition]`) and `sig-older` were checked with injected markup, because the synthetic seed holds no requests.
- Light modes and `field`/`slate` were checked for the filled action and tokens only, not route by route.
- Not run: `forced-colors` emulation, `prefers-contrast:more`, reduced-motion/`data-motion=off` behaviour of C's animations (they are ordinary `animation`/`transition` declarations, so B's kill layer covers them by construction; not observed), keyboard Tab walk, Safari.
- The shared browser tabs were being navigated by other packages' agents during the run; two walks were cut off and re-run in a fresh tab. Reported results are from completed runs only.
- A's `forced-colors` list already names C's painters; C also carries its own block. The duplication is harmless but could be reduced by A.
