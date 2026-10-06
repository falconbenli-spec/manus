# Design fix — `app/static/hr-design.css` (2026-09-18)

Fixer for one file. Synthetic data only: throwaway server on 127.0.0.1:3641 with a scratch database, stopped afterwards. Port 3600, `work/`, `.env`, tests, screen modules and every other file were not touched. Nothing committed or deployed.

## Files touched

`app/static/hr-design.css` only (plus this note). All edits are inside `@layer shell`; the frozen three-line motion block is unchanged.

## Defects

1. **Index scene, giant comma missing at >= 1024 — fixed.** Reproduced first: 1440x900 void dark, `.sidebar .nav` rect x 80..896 full height, 21 lit canvas pixels. `signature.mjs` bans the full-height bounding column of `.nav`, which covered the comma box (x 64..784). Fix: `.nav{margin-inline-end:calc((100vw - 2*var(--shell-pad))*.25)}` in the `min-width:1024px` block (a margin, because the ban uses the bounding rect), and `.nav .hr-nav-rows{columns:3 184px;column-gap:var(--s10)}` (was `3 200px` / `--s14`) so two columns still fit the narrower work column at 1280.
   Measured after: 1440x900 nav x 400..896, 42,211 lit pixels, bbox x 66–395, mean alpha per 50 CSS px band from the outer edge 213, 189, 178, 158, 142, 130, 76 (dense outside, fading toward the text); 1280x800 nav x 352..795, two columns, comma seen in a screenshot; 1024x768 nav x 288..624, one column, 18,317 lit pixels; 1920x1080 70,948. No horizontal overflow in `.sidebar` or `.nav`, no wrapped nav label at any of these sizes; the work column still scrolls.
2. **Field hero band glued to the next section — fixed.** Reproduced: band bottom 546.35 = `.operations` top 546.35. Added `margin-block-end:var(--s10)` to the existing `:root[data-design=field][data-scene=home] #main > .page-head` rule. After: gap 40px in field dark and field light at 1440 and at 375; void and slate unchanged (gap 0, their 40px is the head's own padding); no horizontal overflow.
3. **Bare `.btn` in `.page-head` crushed into one grid column (`#org`, `#work`) — fixed.** Reproduced at 1440: 84.7px wide, label on 2–3 lines. Added `.page-head>.btn{grid-column:span 5;justify-self:end;white-space:nowrap}` at >= 1024, extended the canvas ground to `.page-actions>.btn,.page-head>.btn`, and `.page-head>.btn{justify-self:start}` at >= 760 so it keeps its natural width like `.page-actions>.btn` does there. After: `#org` 194x44 and `#work` 148x44, one line, label inside the pill at 1440, 1024 and 800; full width 343x44 at 375; `#requests` (`.page-actions`) unchanged.

## Not done / notes

- `#work`'s «طلب جديد» is a `.btn.primary` outside `.page-actions`, so the fill whitelist in `style.css` (`@layer fill`) does not light it. It is an edged pill, as before. That list is not in this file.
- The index screenshot in `field` was taken after switching `data-design` by hand; the ground looked black, not turquoise. I did not investigate (tokens are package A's); the comma itself drew the same 42,211 pixels.
- The Browser pane was hidden and shared with other agents: no motion observed; LTR (English) index not opened — the fix uses logical properties only.

## Checks run

- `node --test tests/motion-cards.test.mjs` (the test that reads this file): 3 pass, 0 fail.
- `node --test tests/static-modules.test.mjs tests/ui-race.test.mjs`: 2 pass, 0 fail.
- `npm test`: 684 tests, 684 pass, 0 fail.
- `npm run check`: «Syntax checked: 363 JavaScript modules. Source hashes match. Traceability: 220 requirements / 22 domains.»
- grep on the file for `outline:none`, `style=`, physical `left:`/`right:`: none.

---

# Round 2 — field ground on the portal hero (2026-09-18)

One file edited: `app/static/hr-design.css` (plus this note). No test, screen module, `work/`, `.env`, port 3600, commit or deploy.

## Defect

**`field` paints the turquoise ground on `#home` only; the portal hero (`section.journey-hero`) gets none — fixed.**
Verified first by reading: addendum §ج line 44 promises the ground for «بطل الرئيسية/البوابة»; `signature.mjs` sets `data-scene=home` for both `home` and `portal` (`HERO`); `portal-ui.mjs:16` emits `section.journey-hero` as the first child of `#main`, and no `.page-head`. The rule at line 218 matched `.page-head` only, so the reviewer is right.
Change: the selector is now `:root[data-design=field][data-scene=home] #main > :is(.page-head,.journey-hero)`; declarations untouched, specificity unchanged (`:is()` takes the class's weight).

Ordering with the token selector: while I worked, `signature.css` gained `:root[data-design=field][data-scene=home] #main > .journey-hero` in the C4 block and in its `prefers-contrast` companion (lines 301 and 329, not my file, not my edit). My half alone would have been harmless (without the scoped tokens `--canvas` is the page ground, so the band is invisible); the dangerous order is the other one (black ink on a transparent hero over charcoal, 1.71). Both halves are in the tree now.

## Measured (Chromium, built-in browser)

I did not log in to a platform server (that needs a password typed into a form). Instead: a static harness in the session scratchpad on `127.0.0.1:3688` served the real `app/static/*.css` files and a page with the shell skeleton (`#app > .shell > .stage > main#main`) and the literal hero markup of `portal-ui.mjs`, with `data-design=field data-scene=home` set in the markup. No app JS ran. Server stopped afterwards (port checked: no listener).

- 1280x800, `data-theme=dark`: `.journey-hero` box 0,108 1280x340.9, background `rgb(22,160,133)`, colour `rgb(0,0,0)`; greeting `rgb(22,22,22)`, lead paragraph `rgb(13,13,13)`, `h1` `rgb(255,255,255)` at 66.6px (large text, 3.28), primary button black fill / white label, outline button black label with `rgba(0,0,0,.64)` edge; horizontal overflow 0. Screenshot looked right.
- 1280x800, `data-theme=light`: same band and same inks on `html` `rgb(250,249,255)`; overflow 0.
- 375x812, light: band 0,52 375x397, copy inset 16px (343 wide), `h1` 36px white, buttons 52 and 44px tall, overflow 0.
- Gap to «اختر خطوتك التالية»: 96px at 1280, 56px at 375 — that is `.journey-heading`'s own top margin; the rule's `margin-block-end:var(--s10)` collapses into it, so the portal's vertical rhythm did not move.

## Not done / not verified

- Not seen inside the real logged-in app: the harness has an empty sidebar and no topbar content, so the band's inline extent next to the real shell at >= 1024 was not measured on `#portal` (the same declarations were measured on `#home` in round 1).
- `void` and `slate` were not re-measured; the selector requires `data-design=field`.
- `prefers-contrast:more`, forced colours, Safari and Firefox not checked.
- The static ring (`.sig-eye::before`, E's rule) is mounted by `signature.mjs` only into `#main > .page-head`, so the portal band carries no ring. Not in this file.

## Checks, literal results

- `node --test tests/motion-cards.test.mjs` (the only test that reads this file by name): `tests 3 · pass 3 · fail 0`.
- `node --test tests/motion-cards.test.mjs tests/static-modules.test.mjs tests/ui-race.test.mjs`: `tests 5 · pass 5 · fail 0`.
- `npm test`, first run: `tests 684 · pass 683 · fail 1` — `tests/procurement-extras.test.mjs:80` «conflict of interest…», `Missing expected exception` at line 86. That test is server-side procurement logic and reads no CSS or static file (grep: 0 matches); run alone three times it passed 3/3 each time. `npm test`, second run: `tests 684 · pass 684 · fail 0`. I believe it is an intermittent failure unrelated to this change; I did not investigate it.
- `npm run check`: «Syntax checked: 363 JavaScript modules. Source hashes match. Traceability: 220 requirements / 22 domains.»
- `node work/design-verify/duplicate-selectors.mjs` (read only): `selectors parsed: 1509 · defined in more than one file: 34 (of which set the same property twice: 18) · under a named exception: 5`.
- grep of the file for `outline:none` and `style="`: 0. Braces 198/198.
