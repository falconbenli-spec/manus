# Design fixer handoff: `app/static/athar.css`

Date: 2026-09-18. One file touched: `app/static/athar.css`. Nothing else was edited. No commit, no deploy, port 3600 and `work/` untouched.

## Defect 1 (high): the home hero opened with the page description

Verified before the change at 1440x900, manager account, synthetic data: `.page-head` 438px against `--hero-h` 380px, the description 588x112 above the date and the greeting.

What changed, all inside `@layer stage`:

- `:root[data-scene=home] .page-head > div:first-child` is now `display:contents`, so `h1` and its `p` are grid items of the hero.
- `h1` keeps row 1. The description is row 5, the last hero row, whole and unclipped, in the quiet voice of `.vn-head > p` (spec 6.1): 13px, `--ink-4`, up to 72ch.
- Below 1024 the eye spans rows 1 to 3, so it sits in the first row beside the label, the date and the census. From 1024 it spans rows 1 to 5 so the description shares the height of the eye.
- From 1024, `.sig-date` takes `margin-block-start:-16px` (label and date read as a pair) and the description sits 8px closer to the census. These two make the text column 280.7px against the 284px the band allows.
- The integrator's canvas patch (`block-size:max(100%, ...)` below 1024) is removed. The eye is inside the hero box again, so the canvas is back to `--sticky-top + --hero-h + --s24`.

One thing the integrator should know. `.page-head h1+p` in `hr-design.css` is in `@layer shell`, which outranks `stage`, and `!important` is banned. `font-size`, `color`, `margin-block-start` and `max-inline-size` of that paragraph cannot be set from this file. The rule reads tokens, so the fix re-scopes `--fs-body`, `--ink-3` and `--s3` on the paragraph itself, and uses `min-inline-size:min(72ch,100%)`, which outranks the shell's `max-inline-size:52ch`. The field hero already re-scopes ink tokens on `.page-head` in `signature.css`, so this follows an existing pattern. If package B prefers, the same result is one rule in `hr-design.css` scoped to `[data-route=home]`, and the three token lines here can then go.

`signature.mjs` builds the ring exclusion list from `#main > .page-head > :not(.sig-eye)`. The dissolved wrapper has no box, so `h1` and the description are no longer in that list. Both sit in grid cells outside the eye square (2.24 R, halo included), so the ring does not pass behind them. The date, the greeting and the census are still excluded.

Measured after the change (real reloads, `getBoundingClientRect`):

| viewport | `.page-head` height | eye top | greeting top | description | canvas box |
|---|---|---|---|---|---|
| 1440x900 | 380 | 148 | 234 | 662x62.4, 3 lines, y=394 | 584 |
| 1280x800 | 380 | 148 | 239 | 662x62.4 | 584 |
| 1024x768 | 380 | 148 | 233 | 513x83.2, 4 lines, ends at the band's padding edge | 584 |
| 768x1024 | 435 | 84 | 323 | 662x62.4 | 348 |
| 375x812 | 400 (was 502) | 84 (was 334) | 242 (was 493) | 343x124.8, 6 lines | 348 (eye ends at 218) |

Same heights with `data-design` set to `void`, `slate` and `field` (380 at 1440, 400 at 375). Description colour: void `rgb(154,154,154)`, slate `rgb(180,180,180)`, field `rgb(22,22,22)` on `rgb(22,160,133)`.

Not reached: the spec's 375 estimate of about 211px. That estimate counts neither the `h1` label nor the description. Without the description the phone hero is 251px; the description adds 149px. `.vn-tiles` now start at y=723, above the 812 fold (was 824). Making the phone hero shorter means hiding the description, which is a content decision and was not taken here.

Fragility: the 380px band holds for the one Arabic description in `home-ui.mjs`. A longer description, or a fourth line at 1280 to 1440, grows the band by 20.8px per line.

## Defect 2 (medium): the phone login did not fit 375x812

Verified before the change: `scrollHeight` 924 against 812, pill 52px, language button at y=820, footer at y=880.

What changed, in one `@media (max-width:759.98px)` block:

- `.login:not(.password-gate) .login-card > p` (the intro line and `.login-note`) is visually hidden with the same sr-only pattern the file already uses for `.sig-eye span`. Both stay in the accessibility tree. The forced password gate keeps its explanation.
- `#login-form` margin 24px to 16px, pill `--btn-h` 56px, language button margin 8px to 0, `.login` bottom padding 24px to 16px. The reviewer's three changes recovered 102px of the 112px needed, so the last two were added.

Measured after: `scrollHeight` 812 = `innerHeight` 812 in Arabic and in English. Pill 343x56 at y=653, language button y=709 to 753, footer y=769 to 790. 760px and wider is untouched.

Not checked: phones shorter than 812px (they scroll, as before), the open OTP field and the error state (both grow the form, as the spec allows), the password gate on a phone.

## Checks run

- `grep -c '!important' app/static/athar.css`: 0. `grep -cE 'outline:(none|0)'`: 0. No physical `left`/`right` property. Braces 160/160. Outside `@layer stage`: the three `@keyframes` only.
- `node --test tests/static-modules.test.mjs tests/motion-cards.test.mjs`: 4 pass, 0 fail. No test reads `athar.css` by name; these are the two that read the front-end stylesheets.
- `npm run check`: "Syntax checked: 363 JavaScript modules. Source hashes match. Traceability: 220 requirements / 22 domains."
- Browser: a private server on port 3863 with a throwaway synthetic database in the session scratchpad, stopped afterwards. The Browser pane was hidden, so **no screenshot was taken and nothing was looked at by eye**. Every result above is a DOM measurement or a computed style. The ring canvas does not paint in a hidden pane, so the drawn ring was not checked; only that the eye box lies inside the canvas box.
- Not run: the full `npm test`, forced-colours, print, Safari.

---

# Round 3 (2026-09-19): the #inbox zero state had no comma

One file touched: `app/static/athar.css`. No commit, no deploy, port 3600 and `work/` untouched.

Verified first: `inbox-ui.mjs` line 9 emits `<section class="panel panel-body">لا شيء ينتظر قرارك الآن.</section>` with no `.empty`/`.empty-symbol`, so the `.empty-symbol::before` rules never matched. Spec 7.2 item 4 asks for the sentence plus the filled giant comma, and the style.css handoff left the comma to E. The reviewer was right.

What changed, inside `@layer stage`, right after the `.empty-symbol` rules:

- `html[data-route=inbox] .operations > .vn-board + .panel.panel-body:last-child{isolation:isolate}`
- the same selector `::before`: filled `--m-done` mask, `--ghost` colour, `z-index:-1`, `block-size:calc(var(--fs-display-l) * 1.75)`, `aspect-ratio:1.373`, `inset-block-start:calc(var(--s10) - var(--fs-display-l) * .25)`, `inset-inline-start:calc(var(--s4) * -1)`, `pointer-events:none`. Same geometry as `.empty-symbol::before`; `--s10` replaces `--s14` because the sentence starts at the section's own 40px padding.
- the same `::before` added to this file's `forced-colors` list, for parity with `.empty-symbol::before` in A's list.

`:last-child` is inherited from the style.css selector: when «تعذر قراءة» follows, neither the display scale nor the comma applies.

Measured (throwaway server 127.0.0.1:3684, temp SQLite in the scratchpad, synthetic `employee` session, stopped and its directory removed, no listener left):

| viewport / design | sentence | `::before` | colour | page scrollWidth |
|---|---|---|---|---|
| 1440x900 void dark | 71.97px | 172.9 x 125.9, top 22px, inline-start -16px, z -1 | rgb(20,20,20) | 1440 |
| 1440 slate, field dark (attribute switched in place) | same | same | rgb(64,64,64) | not re-read |
| 375x812 field light | 36px | 86.5 x 63, top 31px, inline-start -16px | rgb(221,230,237) | 375 |

No ancestor clips (`overflow-x:visible` up to `body`) and none has an opaque background.

Seen by eye: one 1440 void screenshot at reduced scale. `#141414` on black is nearly invisible there, as on `#notifications`; this is the spec's ghost colour. The 375 light screenshot could not be taken (Browser pane not displayed, and other agents were navigating the shared tab), so the phone result is computed style only. Forced-colours, print and Safari were not run.

Checks: `grep -c '!important'` 0, `outline:none|0` 0, no physical left/right, braces 172/172. `node --test tests/static-modules.test.mjs tests/motion-cards.test.mjs`: tests 4, pass 4, fail 0 (no test names `athar.css`; these are the two that read the stylesheets). `npm run check`: "Syntax checked: 363 JavaScript modules. Source hashes match. Traceability: 220 requirements / 22 domains." Full `npm test` not run.
