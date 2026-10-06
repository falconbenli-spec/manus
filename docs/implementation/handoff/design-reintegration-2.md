# Design re-integration after fix round 2 (2026-09-18)

Synthetic data only. Throwaway server on 127.0.0.1:3672 (own temp SQLite in the session scratchpad, `createApp(db)`, no `.env`, synthetic `manager` session row), stopped afterwards; its database directory was removed and the port checked (no listener). Port 3600, `work/`, `.env`, applied migrations, existing tests and screen modules were not touched. Nothing committed or deployed. Node v26.8.2 (the `engines` field asks for 24.x; npm did not refuse).

## Files changed by fix round 2 (read, not edited here unless listed below)

`app/static/style.css`, `app/static/hr-design.css`, `app/static/signature.css`, `app/static/signature.mjs` (rounds 2 and 3 of its fixer). `athar.css`, `journey.css`, every test and `app/preferences.mjs` were not changed by the round.

## Result of the requested checks before any edit of mine

All green: `node --check` OK on the eight scripts, `npm test` 684/684, `npm run check` exit 0. Nothing red, so no code had to change for the checks.

## Files touched by this pass

| File | Change |
|---|---|
| `app/static/athar.css` (rules after `.journey-hero`, and three lines in its `min-width:1024px` block) | Seam left open by the `signature.mjs` fixer (its round 3, «NEEDS placement in athar.css»): the script now appends `a.sig-eye` to `section.journey-hero` on `#portal`, and no stylesheet placed it. Measured before, 1440x900 void: eye 332x332 at y 384–716 **under** the copy, hero 632px tall, canvas box ends at y 584 (ring cut), «اختر خطوتك التالية» pushed to y 844. Fix: `.journey-hero` is a grid. Below 760 two columns (`minmax(0,1fr) auto`), `.journey-copy` is `display:contents`, the greeting label sits beside the eye in row 1 and the headline, paragraph and buttons run the full width under it (same structure the spec gives the home hero at 375). From 760 the copy is one block in column 1 and the eye in column 2. From 1024 twelve columns, copy `1 / span 7`, eye `8 / span 5`, `min-block-size:var(--hero-h)`, and uneven block margins on the eye (`-s2` / `-s10`) so the ring sits on the same y as on `#home`. `align-self:start` everywhere, so a taller copy cannot push the ring past the canvas box. Logical properties only, no new colour, no `!important`, all inside `@layer stage`. |

## Measured after (Chromium built-in browser, manager session, `#portal`)

The pane was hidden for the whole pass: **no screenshot, nothing seen by eye, no motion, canvas buffer 0x0 (`document.hidden` true), no real key press.** Boxes are `x,y,w,h`.

- 1440x900, void / slate / field (design switched by writing `data-design` by hand): hero `80,116,1280,380` (field band `0,116,1440,380`, background `rgb(22,160,133)`, static ring `::before` present), eye `80,148,332,332`, copy column 737 wide, headline one line, buttons `1169,352,191,56` and `939,358,214,44`, next heading at y 592, horizontal overflow 0. `#home` in the same session: head `80,116,1280,380`, eye `80,148,332,332` — identical boxes on the two routes.
- 1280x800: hero 424 tall (headline wraps to two lines at 66.6px), eye `64,148,332,332`, canvas box to 584, overflow 0.
- 1024x768: hero 402, eye `64,148,332,332`, overflow 0.
- 800x900 and 760x900: eye `32,84,215,215` (canvas box to 348), copy 497 / 457 wide, hero 350 / 346, overflow 0; field at 800: band `0,60,800,350`, overflow 0.
- 375x812, void / slate / field: eye `16,84,134,134`, greeting `166,182,193,36` beside it, headline `16,226,343,90`, buttons 52 and 44 tall, hero 513 tall, next heading at y 629, overflow 0. Without the eye (rules switched off through CSSOM) the hero was 397 tall and the headline was already two lines, so the phone hero grew by 116px.
- 320x640: same layout, greeting wraps to three lines (55px), overflow 0.
- One `a.sig-eye` on the page; focus order in the hero is primary button, outline button, eye.
- All 59 sidebar routes at 1440 and at 375 (59 distinct `data-route` values seen): no horizontal overflow, no empty `#main`, no `.table-wrap` outside the viewport, no `error`, no unhandled rejection, no `securitypolicyviolation`.
- Spot checks of round 2 in the real shell: `#home` at 375 — first `.vn-board` starts at the hero's bottom edge (y 460), the prose head has `order:1` and lands last (y 2912). Palette at 1440 — opens with focus on the input and `#app.inert` true; a synthetic Escape on `document` closes it and lifts `inert`.
- Console: one 404 caused by my own probe fetching `/static/athar.css` (wrong path); nothing from the app.

## Checks, literal results (final run, after the edit)

- `node --check` on `signature.mjs`, `app.mjs`, `motion-cards.mjs`, `appearance-ui.mjs`, `hr-design.mjs`, `operations.mjs`, `theme-boot.js`, `app/preferences.mjs`: all OK.
- `npm test`: exit 0. `tests 684 · pass 684 · fail 0 · cancelled 0 · skipped 0 · todo 0`. (Same result on the run before the edit. The intermittent `tests/procurement-extras.test.mjs:80` failure the hr-design fixer saw once did not occur in either run.)
- `npm run check`: exit 0. `Syntax checked: 363 JavaScript modules. Source hashes match. Traceability: 220 requirements / 22 domains.`
- `node work/design-verify/duplicate-selectors.mjs` (read only): `selectors parsed: 1518 · defined in more than one file: 34 (of which set the same property twice: 18) · under a named exception: 5` (1509 · 34 · 18 · 5 before the edit; no new cross-file duplicate).
- `node work/design-verify/contrast-designs.mjs`: `All pairs with a floor pass.`
- Static greps on the five stylesheets: braces balanced (275, 198, 441, 164, 170); no `outline:none`; no physical `left/right` property (`float` values are `inline-start`/`inline-end`/`none`); `!important` only in the frozen reduced-motion and kill-layer lines of `hr-design.css` and `style.css:238`; negative letter-spacing only on `html:lang(en) h1` and `[data-num]`. No file under `tests/` is newer than the previous re-integration note.

## Not done / not verified

- Anything by eye, in any design or mode; the ring actually drawing on `#portal` (the signature fixer saw a live 2880x1168 buffer before this placement existed; I only measured the eye box the engine reads). Light mode, LTR, `prefers-contrast`, forced colours, Safari and Firefox were not opened for the new rules; they use tokens and logical properties only.
- Phone, owner's call: on `#portal` below 760 the eye shows the number alone (its label is visually hidden there, as on `#home`, but the portal has no census sentence beside it), and the hero is 116px taller than before the eye existed. Hiding the eye below 760 on the portal would undo both; I did not, because the spec puts the ring on both routes at 375.
- Below 760 the eye is drawn above the two buttons but follows them in the DOM, so Tab reaches it after them. From 760 up visual and DOM order agree.
- `details.panel > summary` height on `#finance` (signature.css round 2) was not seen live: the manager's `#finance` renders no `details.panel`. The index-scene comma and the sticky-pause fix were not re-measured here (hidden pane: no canvas, no rAF).
- Still open from earlier notes: the giant comma behind the inbox zero sentence (E, design addition), 2.4.11 for controls in a page-level table under a sticky `th` (D, not measured by anyone), `#work`'s «طلب جديد» not lit (fill whitelist in `style.css`), and everything under "Not fixed / not verified" in `design-integrator.md` (size budgets, frozen-module `style=""` in `commercial-ui.mjs:73`, Arabic-Indic dates in `delegations-ui.mjs:19`, `STATUS.md` and traceability not updated).
