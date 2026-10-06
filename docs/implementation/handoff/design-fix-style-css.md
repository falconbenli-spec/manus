# Fixer handoff — app/static/style.css

Only `app/static/style.css` was edited (plus this note). Nothing committed or deployed; port 3600, `work/`, `.env`, tests and screen modules untouched.

## What changed

1. **Inbox zero state (high) — fixed.** New rule in section 11:
   `html[data-route=inbox] .operations > .vn-board + .panel.panel-body:last-child` takes `--fs-display-l`, `--fw-display`, `--lh-display`, `--ink-1`, `padding-block:var(--s10)`, `max-inline-size:18em`, `text-wrap:balance`, `position:relative`.
   No media query: `--fs-display-l` is already a 36 → 72 clamp. `:last-child` is deliberate: when inbox-ui appends «تعذر قراءة …» the sentence stays body copy, because "nothing" is then not certain.
2. **Page-level `.empty > strong` (medium) — fixed.** Added `#main > .panel > .empty:only-child > strong` to the `--fs-display-l` selector list. Verified in `app.mjs`: notifications, projects and the requests table all emit `.empty` as the only child of `section.panel` under `#main`.
3. **Focus obscured by the sticky card summary, WCAG 2.4.11 (medium) — fixed.** The reviewer placed the sticky rule in a 1024 block; it actually lives in the 760 block, so the fix is there too:
   `.vn-card[open] > :not(summary) :is(a,button,input,select,textarea,summary,[tabindex])` and direct focusable children get `scroll-margin-block-start:calc(var(--filter-h) + var(--summary-h))`.
   In the 1024 block, controls in `td` of a non-wide table inside an open card add `+ var(--row-h)` for the th that journey.css sticks at `--stick-3`.
   I did not add the reviewer's extra `--s4`: html's scroll-padding already carries `sticky-top + s4`, and scroll-margin adds to it, so the 16px of air is already there. `--filter-h` is included because the summary sticks at `--stick-2`, below the filter row when one exists.

## Checks run (literal results)

Static harness only: real CSS files from `app/static` served by a scratch node server on 127.0.0.1:3623 (stopped), with markup copied from `inbox-ui.mjs` line 9, `app.mjs` `empty()` and the `vn-card` skeleton. I did **not** log in to the running app, so nothing was checked against live data or the real shell markup.

- Inbox zero, 1440, void dark: font-size 71.972px, weight 400 (`--fw-display` is 400 today), line-height 89.965px, colour rgb(255,255,255), padding 40px, position relative, no horizontal overflow. 375: 36px, two lines, no overflow. Screenshots looked at for both. With a trailing `p.subtle`: stays 16px.
- Notifications fixture, 1440: `.empty > strong` 71.972px (was 43.96px per the reviewer).
- Card probe, 1440x900, scroll to bottom then `scrollIntoView({block:'nearest'})`, `elementFromPoint` at top/middle/bottom of the control:
  - before (backup of style.css): body buttons land at y 124..168 under the summary 108..172, table buttons at 124..144; hit = false for all 6.
  - after: body buttons at 188..232, table buttons at 240..260 (th 172..207); hit = true for all 6.
  - 800x900: summary sticky 52..116, controls land at 132, hit = true.
- `node --test tests/static-modules.test.mjs tests/motion-cards.test.mjs tests/ui-render.test.mjs tests/ui-race.test.mjs tests/dialog-races.test.mjs`: tests 7, pass 7, fail 0.
- `npm run check`: "Syntax checked: 363 JavaScript modules. Source hashes match. Traceability: 220 requirements / 22 domains."
- Full `npm test` not run.

## Not done / for other owners

- **E (athar.css line 170):** add `#main > .panel > .empty:only-child > .empty-symbol` to the `--e-fs:var(--fs-display-l)` selector so the comma scales with the headline, and hang the filled `--m-done` giant comma on `html[data-route=inbox] .operations > .vn-board + .panel.panel-body:last-child::before` (the node is `position:relative`; it has no `isolation`, add it there if `z-index:-1` is used).
- **D (journey.css):** the same 2.4.11 failure exists for controls in a page-level table outside a card: th sticks at `--stick-2` (about 35px tall) while scroll-padding clears only `sticky-top + s4`. A `scroll-margin-block-start:calc(var(--filter-h) + var(--row-h))` on `.table-wrap:not(.is-wide) td :is(a,button,input,select)` at >= 1024 would close it. Not measured by me, derived from the rules.
- Inside `#dialog` the open-card summary still sticks at `--stick-2` of the page ladder although the dialog is its own scroller; not part of this task, not changed.
- Filter-present case (`--filter-h:44px`) was not probed in the browser; the formula includes the token.
- Motion, forced-colors, light modes and field/slate were not checked for these three rules; they use tokens only.

---

## Round 2026-09-18: #home opens on prose (medium) — fixed

File touched: `app/static/style.css` only (one rule + comment, section 1, directly under the `.vn-head` rules).

`html[data-route=home] .operations > .vn-head{order:1}`

Verified before changing: `home-ui.mjs` line 59 returns `head` first, then the personal `.vn-board`, then the role boards; `app.mjs` line 219 wraps them in `.operations` (already `display:flex;flex-direction:column`); no stylesheet reordered it. The head on home holds three `<p>` and no link, button or field, so moving it changes no Tab stop. Spec 7.2 item 2 asks for tiles then the grid under the hero and «أول قائمة مباشرة» at 375; spec 6.1 already lists `vn-head` among the places `order` is allowed. The text is kept whole.

Placed in section 1 rather than section 11 as the reviewer proposed: section 11 in this file is empty states, and the rule belongs beside the other `.vn-head` order rules.

Consequence to know: for a user with role boards (manager, HR, finance, executive) the head lands after the last board, as a page footnote, not between the personal board and the role boards. Putting it in between would need `order` on `.vn-board` too, which the spec does not allow.

Checks run (literal results):
- Static harness only (real CSS from `app/static`, scratch node server on 127.0.0.1:3624, stopped; markup copied from `home-ui.mjs`; no shell, no hero, no login, void dark only). 375x812: before head y=0 h=123, board 1 y=179; after board 1 y=0, board 2 y=314, head y=600, computed order 1, no horizontal overflow. Focusable elements' y in DOM order: 0, 0, 162, 222, 508 (monotonic). 1280x800: boards y=0 and 412, head y=821, no overflow. With `data-route` set to another value the head returns to y=0.
- `node --test tests/static-modules.test.mjs tests/motion-cards.test.mjs tests/ui-render.test.mjs`: tests 5, pass 5, fail 0. No test reads `style.css` by name (grep over `tests/`).
- `npm run check`: "Syntax checked: 363 JavaScript modules. Source hashes match. Traceability: 220 requirements / 22 domains."
- Not run: full `npm test`, the real logged-in app, light themes, field/slate designs, forced-colors.
