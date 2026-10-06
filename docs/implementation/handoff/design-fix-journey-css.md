# Design fix — `app/static/journey.css` (2026-09-18)

One file edited: `app/static/journey.css`. Nothing else in the project was touched (no test, no screen module, no `work/`, no `.env`, no port 3600, no commit, no deploy). Verification ran on a throwaway server from the session scratchpad (`127.0.0.1:3857`, cookie proxy `38571`, private synthetic SQLite); both are stopped and the database is deleted.

## Defects, each reproduced before the change

| # | Reproduced | Change |
|---|---|---|
| 1 | Yes. 375x812, payroll card injected with the literal markup of `payroll-ui.mjs:20`: first `td` 378px in a 325px wrapper, `position:sticky`, `white-space:nowrap`. | In the `<760` block the pinned first column is now `white-space:normal; overflow-wrap:break-word; min-inline-size = max-inline-size = min(38vw,10rem)`; the other cells keep `nowrap`. `[colspan]` cells (empty-state rows) are excluded from the pin. A plain `max-inline-size` alone left the column at its minimum in Blink's auto table layout, so both bounds carry the same value. |
| 2 | Yes. `small` computed `display:inline`, same line as `strong`. | `td a strong,td a small,td > strong + small{display:block;}` |
| 3 | Yes. `scrollIntoView({block:'nearest'})` on «تعديل المسودة» and «إضافة ملف» landed under the bar; `elementFromPoint` returned `section.panel` / `button.btn.dark`. | The reviewer's proposal (override `html{scroll-padding-block-end}`) cannot work from this file: that declaration lives in `@layer shell`, which outranks `@layer surfaces` whatever the specificity, and contract 5 keeps every rule of this file inside `surfaces`. The room is reserved on the controls instead: `html:not(.is-kbd) .details-grid:has(section.panel [data-transition]) section.panel:not(:has([data-transition])) :is(a,button,input,select,textarea,summary,label,[tabindex]){scroll-margin-block-end:40dvh}` inside the `<760` block (40dvh is the bar's own `max-block-size`). Same pattern as `style.css:294`. |
| 4 | Mechanism yes: the hidden link measured 44x20, `position:absolute`. With my single seeded row it sat at x=8.8 at 1024, so the page did not overflow on my data; the overflow depends on where the static position falls. | Added `min-inline-size:0; min-block-size:0; margin:-1px; padding:0; border:0; white-space:nowrap` to the rule. |
| 5 | Yes. `#statements` as the accountant: fourth headless table, first cell 320px sticky+nowrap in a 343px wrapper, `scrollWidth` 427. | The pin/nowrap rules now require `:has(> thead)`. Headless tables get `white-space:normal; overflow-wrap:anywhere` and `td:last-child:not(:first-child){white-space:nowrap}`. No `text-align:end`: the file's rule is "no text-align:end anywhere" (numeric columns keep the start edge). |

## Measured after the change (Chromium, built-in browser, pane hidden — no screenshot was usable)

- Payroll injected card, 375: pinned column 143px = 44% of the 325px wrapper; money column 139px fits the remaining 182px; sampled scroll positions show columns 2, 4, 5, 6, 8 and 10 fully clear of the pinned cell; `small` is `display:block` and sits below `strong`; page overflow 0.
- `#attendance` as hr, 375: 7 columns, pinned column 143px of 343 (42%), still sticky, page overflow 0.
- `#statements` as accountant, 375: all four tables `scrollWidth == clientWidth == 343`, `is-wide` off, no amount cell outside its wrapper, first cell static and wrapping, amount `nowrap`.
- `#request/<id>` (draft, manager), 375x812: bar y 611–756; both controls now land at y 371–407 and `elementFromPoint` at top, middle and bottom returns the control itself; computed `scroll-margin-bottom` 324.8px.
- `#requests` as manager at 820 and 1280: hidden link 1x1, `scrollWidth == innerWidth`. After a real Tab key press the link is `:focus-visible`, `position:relative`, 44x20 again.

## Not done / not verified

- Only the default look (void/dark) was measured; the rules carry no colour and no design-specific selector. Light mode, `field` and `slate` were not re-measured.
- Only Chromium. `max-inline-size` on table cells and `:has()` were not checked in Safari or Firefox.
- Defect 4's page overflow itself was not reproduced on my data (see above); the 1x1 collapse was.
- Defect 3 with `html.is-kbd` was not exercised (needs a real on-screen keyboard); the selector simply stops matching.
- The focused «فتح» link is 20px tall (it was before this change too); not in scope.

## Checks, literal results

- `npm test`: `tests 684 · pass 684 · fail 0 · cancelled 0 · skipped 0 · todo 0`. No test reads `journey.css` by name (grep of `tests/`).
- `npm run check`: `Syntax checked: 363 JavaScript modules. Source hashes match. Traceability: 220 requirements / 22 domains.`
- `node work/design-verify/duplicate-selectors.mjs` (read only): `selectors parsed: 1505 · defined in more than one file: 35 (of which set the same property twice: 18) · under a named exception: 5` — same 35/18/5 as the integrator's baseline.
- grep of the file for `style="`, `<style`, physical `left/right` properties, negative letter-spacing, `outline:none`, colour literals: none (the two pre-existing `mask:linear-gradient(...#000...)` lines are untouched). Braces balanced 431/431.

---

# Round 2 — `app/static/journey.css` (2026-09-19)

One file edited again: `app/static/journey.css`. Verification ran on a static harness in the session scratchpad (`127.0.0.1:3861`, serves `app/static/*.css` read-only plus one harness page carrying the literal markup of `app.mjs:67` `table()` after the enhancer — `table[data-cols=4]`, `.table-wrap.is-wide`, `td[data-label]` — and a work form built as `label > span + control (+ small.subtle)`). Not the real app, no login, no database. Server stopped afterwards. Port 3600, `work/`, tests and screen modules untouched.

| # | Reproduced | Change |
|---|---|---|
| 1 (medium) `:user-invalid` was hue + 1px only | Yes. After `form.requestSubmit()` on the empty form the three required frame controls were `:user-invalid`, border 2px `rgb(231,76,60)`, label `::before`/`::after` content `none`. | The wrapping label now carries the shape and the word: `label:has(> control:user-invalid)::before` = 13x8 `--m-stop` mask painted `--stop`, absolutely placed at the inline start of the last line (the label becomes `position:relative` only while invalid); `::after` = «غير صحيح», or «مطلوب أو غير صحيح» when the control is `:required` (`html[dir=ltr]`: "Not valid" / "Required or not valid"), `--stop`, 13px at the label weight (inherited), `padding-inline-start:20px` to clear the mark. Separate rules, so a browser without `:has`/`:user-invalid` drops only them. Forced colours: own rule sets the mark to `CanvasText` (kept out of the shared list so an unknown pseudo-class cannot void it). The reviewer's alternative (colour the whole label text) was not taken: the word the spec asks for would still be missing. |
| 2 (high) record view overflows on one long token | Yes. 375: first `td` 815px in a 375px `tr`, `scrollWidth` 815. | `min-inline-size:0; overflow-wrap:anywhere` added to `table[data-cols]:not(.rows-field *) td` in the `<760` block. |
| 3 (medium) hidden «فتح» link widens the page at 760–1023 | Yes. 768: wrapper 768/982 with `overflow-x:auto`, `scrollWidth` 982 with the cell `position:static`. | `html[data-route=requests] td:last-child{position:relative;}` beside the hidden-link rule. |

Measured after (Chromium built-in browser, void/dark, RTL):
- 375: `td` 375, `tr` 375, `strong` 375 wide / 72 high (wraps), `scrollWidth` 375, no element of `#main` outside the viewport; toggling the old values back through a constructable sheet gives 815 again.
- 768: `scrollWidth` 768 (982 when the cell is forced back to `static`), wrapper still scrolls 768/982, hidden link 1px wide at left −214, clipped by the wrapper.
- Form: every invalid required frame control shows mark + «مطلوب أو غير صحيح» (screenshot checked); an optional `type=email` holding `abc` shows «غير صحيح» after blur, below its always-visible hint; valid fields and the checkbox label get nothing; page `scrollWidth` stays 375. `dir=ltr`: content "Required or not valid", mark `left:0`; RTL: `right:0`.

Not done / not verified:
- Not run in the real app (no seeded server this round); the harness uses the real CSS files and literal markup only. Designs `field`/`slate`, light mode, Safari and Firefox not measured. Contrast of `--stop` as 13px text was not re-measured here (it is already the state text colour `--wc` of package A).
- A required checkbox/radio that is invalid still has no mark or word: those labels are row layouts outside the "writing frame" rule the reviewer reported; left alone.
- The word is generic (CSS cannot tell a missing value from a bad format); the specific message stays with the native bubble and the dialog's `.error` node.
- The `:focus-visible` state of the hidden «فتح» link at 768 was not re-tested (that rule is untouched; the cell is now `position:relative`, which does not affect a link that becomes in-flow on focus).

Checks, literal results:
- `node --test tests/lifecycle-bundles.test.mjs tests/platform.test.mjs` (the two tests whose source mentions "journey"): `tests 21 · pass 21 · fail 0`.
- `npm test`: `tests 684 · pass 683 · fail 1`. The failure is `tests/request-intake.test.mjs:81` «service level: a date sooner than the working-day target…» — `assert.ok(gate.advisory.some(a=>a.code==='needed_by_tight')||gate.ready)`. It is server-side, reads no CSS or static file (grep: 0 hits for `css|static`), and builds its date from `Date.now()+1h`; it was run at Sat 2026-09-19 00:46 +03 (weekend, UTC date still Friday). I believe it is clock-dependent and not caused by this file; I did not investigate further (frozen for me).
- `npm run check`: `Syntax checked: 363 JavaScript modules. Source hashes match. Traceability: 220 requirements / 22 domains.`
- `node work/design-verify/duplicate-selectors.mjs` (read only): `selectors parsed: 1529 · defined in more than one file: 35 (of which set the same property twice: 18) · under a named exception: 5` — same 35/18/5 baseline.
- File greps: no `style="`, `<style`, physical left/right, `outline:none`, negative letter-spacing; braces 449/449.
