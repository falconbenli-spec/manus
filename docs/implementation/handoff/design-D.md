# design-D — package D handoff (data surfaces, `@layer surfaces`)

Date: 2026-09-18. Resumed run: an earlier attempt was cut off by a usage limit. This run inspected what it left, kept what was correct, fixed what was wrong, and verified the result.

## Files touched

- `app/static/journey.css` — the only product file. 589 lines, 52,912 bytes. One top-level block: `@layer surfaces{…}`.
- `docs/implementation/handoff/design-D.md` — this file.

Nothing else was edited. No test, screen module, migration, `.env`, `work/` or port 3600 was touched. No commit, no deploy.

## What the earlier attempt had left

A structurally complete file (571 lines, balanced, inside the layer) with no handoff and no recorded checks. It was not finished. Defects found and fixed in this run:

1. **Phone decision bar never moved to the bottom.** `:has(+ section.panel > .journey)` outweighed the phone rule, so `order:99` lost to `order:-3`. The sibling test is now wrapped in `:where()`. Measured after the fix: `order:99`, `position:sticky`.
2. **Desktop sticky decision panel could not travel.** `.details-grid{align-items:start}` made the column as short as its content. Columns now stretch.
3. **The lit action ignored the spec heights.** Package C's fill layer wins over this layer, so heights are now passed through C's own hooks: `--btn-h:56px` and `--btn-w:100%` on the desk, `--btn-h:52px` in the phone bar. Measured: 503×56 at 1440, 52px at 375.
4. **Wide-table edge fade never matched.** It selected `table[data-cols]` beyond 6, but `signature.mjs` removes the attribute above 6 columns. It now keys on `.table-wrap.is-wide` with an uncounted table, and the last column gets clearance.
5. **Duplicate selectors owned by A:** `.is-late-text` and `.is-warn-text` removed from this file (rule 0.2). Redundant `--c/--m` re-declarations for `.required`, `.rq-tip`, `.ex-note`, `.is-personal` removed; A's map is read, not repeated.
6. **Undefined token** `--s12` replaced by `calc(var(--s6) * 2)` (48px).
7. **The global `select` rule overrode A's `.filters select` arrow placement** (a later layer beats specificity). It is now `select:where(:not(.filters select))`.
8. **`.wk-check` was an inline label**, so its 48px minimum did nothing (measured 20px). Now `display:flex`, measured 48px.
9. **`#accounts` filter could not stick** (it sits alone in a `.panel-body`), which would have left a 44px hole above the sticky `th`. The wrapper `.panel-body:has(> .acc-filter:only-child)` sticks instead. Measured after scrolling 1500px: filter 108–152, `th` 152–187, no gap.
10. **Dialog table header did not really stick**: `overflow-x:auto` makes the wrapper the sticky reference. At ≥1024 the wrapper inside `#dialog` is now also the vertical scroller (`max-block-size:60dvh`). Measured: header offset 0 after scrolling the wrapper 600px. `rows-field` tables are excluded.
11. Ten copies of a 150-byte `data-cols` selector list collapsed to `table[data-cols]` (the enhancer only sets the attribute for ≤ 6 columns).

Added in this run: the 6px comma between "label: value" pairs in the phone record (spec 6.10); the `#inbox` row format (72px rows, "your turn" mark on rows that carry no state, spec 7.2-4); `.rq-compose-head` layout; `padding-inline-end:20px` on `.filters select`.

## What is done

Everything in the plan's package D list: row lists and their heirs, row actions as text with 44px targets, `#projects`, tables (hairlines only, sticky header ladder `--stick-2`/`--stick-3`, `.is-wide` valve, density, phone record form driven by `td[data-label]`, pinned first column for wider tables), work forms ("writing frame"), selects with `var(--select-arrow)`, always-visible hints, `.required`, `.form-grid`, `.builder-field`, `.checks-field`, ink-filled checkboxes, `.rows-field` (desk table, labelled vertical blocks on the phone), writing-line placements (size and position only), `.vn-facts`/`.detail-data`, `.details-grid` (A5) with the phone decision bar and `html.is-kbd`, `.sig-arc`, and the families `rq-*`, departments, `pt-*`, `ex-*`, `wk-*`, `org-*`, `acc-*`, inner empties, the legacy home, plus a forced-colours block. No design-specific rule (addendum: none for D). No motion beyond the 120ms row tint, the 4px `rq-go` nudge and the `rq-enter` fade.

## What is not done, and known limits

- **Size.** 52.9KB against the 30KB target. A whitespace-and-comment minification estimate is about 45KB, so the target is not reachable with the plan's class list. The five stylesheets total about 150KB against the 101KB acceptance limit; every package is over its share. This needs a coordinator decision.
- **Not seen in the real app.** All measurements come from a static harness (hand-written markup copied from the modules, the five real stylesheets, served read-only from the scratchpad on 127.0.0.1:38417, stopped afterwards). No screenshots were possible (the browser pane was hidden); results are computed styles and box geometry in Chromium only. Safari was not tested. No route-by-route 375px tour was run; that is package V's job.
- `:focus-visible` rendering could not be confirmed (a background tab does not take focus). The rules exist; no `outline:none` anywhere.
- Tab order on `#request/:id` with `order` was not checked by hand.
- Paper, `field` and `slate` were not inspected beyond one token read on paper (canvas, mark, checkbox and `th` ground resolved correctly).
- `#inbox` rows all get the turquoise mark, while C has (correctly, by its own note) left the first-row fill off because the server does not sort oldest first.
- `.panel-body` belongs to C; this file positions it in one case only (`:has(> .acc-filter:only-child)`), as the placement of D's own filter.
- For package A: `.filters select{padding-inline-end:20px}` in `signature.css` loses to A's own primitive (its `:is(#login-form,…)` carries ID weight). This file sets the padding as sizing, so the result is right today.
- Mask gradients use `transparent` and `#000` as alpha stops (`linear-gradient` inside `mask`, which the plan allows).
- While testing I navigated the shared browser tab `tab-4` (another agent's page on 127.0.0.1:3793) to my harness by mistake. I restored its URL and viewport afterwards and used private tabs from then on.

## Checks run, with literal results

- `node --test` on `company-scale`, `structured-fields`, `workspace`, `procurement`, `static-modules`, `ui-render`, `departments`, `service-catalog`, `motion-cards`: `tests 37 · pass 37 · fail 0`.
- `npm test` (once, at the end): `tests 676 · pass 676 · fail 0 · cancelled 0 · skipped 0`.
- `npm run check`: `Syntax checked: 362 JavaScript modules. Source hashes match. Traceability: 220 requirements / 22 domains.` Exit 0.
- Forbidden patterns on `journey.css` (`box-shadow|backdrop-filter|(^|[^-])gradient\(`): no match. `!important`: none. `outline:none|0`: none. `letter-spacing`: none. Physical `left/right` properties: none. `https?://`: none. `@keyframes`/`animation`: none.
- Structure: brace balance 0; one top-level block; every rule inside `@layer surfaces`.
- Tokens: every `var(--…)` used is defined in `signature.css`, except `--row-ink` (local to this file) and `--rq-delay` (set by `motion-cards.mjs`).
- Chromium CSSOM: 408 style rules in the source, 408 parsed, 0 dropped, 0 empty.
- Harness at 375: page `scrollWidth` 375 on both pages; ≤6-column table renders as records (`thead` clipped to 1px, labels from `data-label`, action cell full width 44px); 10-column table scrolls inside its wrapper only; `rows-field` rows are grids with visible labels, 52px inputs, 44×44 remove button; checkbox 22px with ink fill; row action targets extend 12px above and below.
- Harness at 1440: `scrollWidth` 1440; `th` sticky at 152px with the filter at 108px; ledger tier 10-column table 1360px wide with no inner scroll, rows 44px; `.details-grid` 503/705 with the statement column at the inline start; `wk-board` three columns, 48px gap.
