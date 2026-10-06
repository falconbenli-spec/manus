# Design re-integration after fix round 1 (2026-09-18)

Synthetic data only. Throwaway server on 127.0.0.1:3671 (own temp SQLite in the session scratchpad, `createApp(db)`, no `.env`), stopped afterwards and its database removed. Port 3600, `work/`, `.env`, applied migrations, existing tests and screen modules were not touched. Nothing committed or deployed. Node v26.8.2 (the `engines` field asks for 24.x; npm did not refuse).

## Files changed by fix round 1 (read, not edited here unless listed below)

`app/static/style.css`, `app/static/hr-design.css`, `app/static/journey.css`, `app/static/athar.css`, `app/static/signature.mjs`.

## Files touched by this pass

| File | Change |
|---|---|
| `app/static/athar.css` line 185 | Added `#main > .panel > .empty:only-child > .empty-symbol` to the `--e-fs:var(--fs-display-l)` selector. Seam left by the style.css fixer: the headline of a page-level `.panel > .empty` went to `--fs-display-l` (72px) while the giant comma stayed at `--fs-display-m`. Measured after, 1440: comma 173x126 at y 310–436 behind the headline at y 328–418, inside `.empty` (272–502), on `#notifications` (filled), `#requests` and `#projects` (hollow). Before: 106x77. |

## Checks, literal results (final run, after the edit above)

- `node --check` on `signature.mjs`, `app.mjs`, `motion-cards.mjs`, `appearance-ui.mjs`, `hr-design.mjs`, `operations.mjs`, `theme-boot.js`, `app/preferences.mjs`: all OK.
- `npm test`: exit 0. `tests 684 · pass 684 · fail 0 · cancelled 0 · skipped 0 · todo 0`. (Same result on the run before the edit.)
- `npm run check`: exit 0. `Syntax checked: 363 JavaScript modules. Source hashes match. Traceability: 220 requirements / 22 domains.`
- `node work/design-verify/duplicate-selectors.mjs` (read only): `selectors parsed: 1506 · defined in more than one file: 35 (of which set the same property twice: 18) · under a named exception: 5`. Same 35/18/5 as the baseline.
- `node work/design-verify/contrast-designs.mjs`: `All pairs with a floor pass.`
- Static greps on the five stylesheets: braces balanced in all five (274, 164, 198, 441, 160); no `outline:none`; no physical `left/right` property; `!important` only in the frozen reduced-motion and kill-layer lines of `hr-design.css` and the old `.journey-tools` hide in `style.css:235`; negative letter-spacing only on `html:lang(en) h1` and `[data-num]`. In the redesign scripts, no `style="`, `<style`, inline `<script>` or external URL (one hit: the SVG namespace string).

## Browser, measured only (the pane was hidden: no screenshot, no real key press, no motion)

Manager session, void/dark unless noted.

- Home 1440: `.page-head` 380 high in all six looks, eye 332x332 inside it, description 662x62; `field` band gap to `.operations` 40, void and slate 0; no horizontal overflow.
- Home 375: head 400, eye at y 84–218, canvas box 348, tiles at y 723 (763 in `field`, which carries the 40px gap); no overflow in void, field, slate.
- Index scene 1440: `.nav` x 400–896, three columns, 59 links, none wrapped, sidebar and page overflow 0, canvas has lit pixels (25,621 counted in a hidden tab whose buffer had not been resized; the fixer's 42,211 was not reproduced and not contradicted). Escape (synthetic event) closes it and lifts `inert` from `.stage`.
- Palette: opens with focus on the input, 14 items, `#app.inert` and `.skip.inert` true, no element inside `#app` can take focus; Escape dispatched from a result row closes it, lifts both, focus back on `.top-search`.
- `#inbox` zero sentence 71.97px; `#org` head button 194x44 and `#work` 148x44, one line.
- All 59 sidebar routes at 1440 and at 375: no horizontal overflow, no empty `#main`, no `error`, no unhandled rejection, no `securitypolicyviolation`. At 375 no `.table-wrap` leaves the viewport; the only scrolling tables are the four 8-column ones on `#resourcing`, pinned first column 143px of 343 (42%).
- Login 375x812 (second origin `localhost:3671`, no session): `scrollHeight` 812 in void, field and slate; pill 343x56 at y 653, language button y 709–753, footer y 769–790.
- Console: the expected 401 from `/api/me` on the login origin, nothing else.

## Not done / not verified

- Anything by eye. Motion of any kind. Real Tab traversal (the hidden pane refuses key input); the palette seal was checked through `inert` and `focus()` instead.
- The second half of the style.css fixer's note for E (a filled giant comma behind the inbox zero sentence) was not added: it is a design addition, not a regression, and nothing in this pass could be looked at.
- The style.css fixer's note for D (2.4.11 for controls in a page-level table under a sticky `th`) was not applied: derived from rules, not measured by anyone yet.
- `#work`'s «طلب جديد» is still an edged pill, not lit (fill whitelist in `style.css`), as the hr-design fixer noted.
- Everything listed under "Not fixed / not verified" in `design-integrator.md` still stands (size budgets, frozen-module `style=""` in `commercial-ui.mjs:73`, Arabic-Indic dates in `delegations-ui.mjs:19`, forced-colors, LTR, Safari/Firefox, `STATUS.md` and traceability not updated).
