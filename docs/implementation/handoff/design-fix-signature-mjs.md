# design-fix-signature-mjs — fixer handoff (command palette modality)

## File touched
- `app/static/signature.mjs` only. Nothing else in `app/`, `tests/`, `work/` was edited. No commit, no deploy, port 3600 untouched.

## Defect (medium): `.sig-cmd` declares `aria-modal=true` but is not modal; Esc only works from the input
Verified before editing by reading the code: the only `closePalette()`-on-Escape path was the `keydown` listener on the palette `<input>`; the capture-phase document handler had no palette branch; `openPalette()` made nothing inert. The reviewer's report is correct.

### Fix (5 small edits)
1. New `sealPage(on)`: guarded write of `inert` on `#app` and `body > .skip` (same guarded pattern as `syncDrawer()`). `#app` rather than `.stage/.sig-tabs`, because `syncDrawer()` owns `inert` on those and rewrites it on every `enhance()`; `#app` itself is never replaced by a render. The palette, `#toast` and `#dialog` are siblings of `#app` under `<body>`, so they stay interactive.
2. `openPalette()` calls `sealPage(true)` after `paletteReturn` is captured and before `input.focus()`.
3. `closePalette()` calls `sealPage(false)` before restoring focus to `paletteReturn` (so `choose()` → `closePalette(false)` also lifts `inert` before the hidden `new-request` trigger is clicked inside `#app`).
4. Document-level capture `keydown`: first Escape branch is now `if(palette&&!palette.hidden){e.preventDefault();closePalette();return;}`. The input-level Escape branch was removed (replaced by a comment).
5. Safety net in `enhance()`: when the render has no `.shell/.nav` (e.g. session expired to the login screen) `closePalette(false)` runs, so `#app` can never stay inert behind a palette that Ctrl+K can no longer toggle.

## Checks run (literal results)
- `node --check app/static/signature.mjs` → OK.
- `node --test tests/ring-engine.test.mjs tests/platform.test.mjs tests/production.test.mjs tests/client-approvals.test.mjs tests/files-security.test.mjs tests/contracts-register.test.mjs` (every test file that mentions "signature") → tests 57, pass 57, fail 0.
- `grep -nE 'style=|<style|https?://' app/static/signature.mjs` → one hit, line 560 `SVG_NS='http://www.w3.org/2000/svg'` (pre-existing namespace string, not a resource, not mine).
- Browser, throwaway server from the scratchpad (own temp sqlite, `createApp(db)`, no `.env`, not `work/`) on `localhost:3657`, synthetic `manager` session inserted directly in the temp DB, 1440x900, `#home`:
  - Click `[data-shell=search]`: palette open, activeElement `INPUT`, 14 items, `#app.inert === true`, `.skip.inert === true`.
  - Tab x17: activeElement still inside `.sig-cmd` (`closest('.sig-cmd')` non-null). Before the fix the reviewer measured it on `BUTTON.sig-theme` behind the scrim.
  - Escape: palette `hidden`, `html.is-searching` removed, `#app.inert === false`, focus back on `BUTTON.top-btn.top-search`.
  - Reopen, Tab x4 → focus on `BUTTON.sig-cmd-item`, Escape → palette closed, inert lifted, focus restored to the search button.
  - Index drawer regression: open → `.stage.inert true`, `#app.inert false`; Escape → closed, `.stage.inert false`.
  - Click on a result row → palette closed, `#app.inert false`.
  - Console: only two 401s from the page loads before the session cookie existed.
  - Server stopped afterwards; its temp directory was removed; port 3657 no longer listening.

## Not run
- 375x812, `field`/`slate` designs, light mode, and the service-row (`new-request`) path in the browser — the change is pure JS behaviour with no design/mode dependency; the service path was checked by code order only.
- Screen-reader announcement was not tested.
- Full `npm test` was not run; only the six test files that reference signature by name.

---

# Round 3 — ring on #portal, index comma, sticky pause (2026-09-18)

## File touched
- `app/static/signature.mjs` only (plus this handoff). No test, CSS, screen module, `work/`, `.env`, port 3600, commit or deploy.

## 1. Ring missing on `#portal` — fixed in JS, NEEDS placement in `athar.css` (E)
Verified: `portal-ui.mjs` emits `section.journey-hero` as the first child of `#main`, no `.page-head`; `mountHero` only looked for `#main > .page-head`, so no eye, `sceneGeometry('home')` returned null and the engine went `off`.
- `mountHero()`: on a HERO route without `#main > .page-head` it falls back to `#main > .journey-hero` and appends only `a.sig-eye` (no `sig-date/sig-greeting/sig-census`: the journey hero has its own greeting and h1). The `.page-head` path is unchanged (same order: div, sig-date, sig-greeting, sig-census, sig-eye).
- `sceneGeometry('home')`: eye is `#main > :is(.page-head,.journey-hero) > .sig-eye`; exclusions are the eye's siblings, and for the journey hero the children of `.journey-copy` (text boxes, not the wrapper).
- **Open, not mine:** `athar.css` has no rule placing `.journey-hero > .sig-eye`. Measured at 1440x900 (void): the eye is a 332px square at x=80, y=376–708, i.e. BELOW the copy, while `canvas.sig-aurora` is 584px tall, so the ring is clipped below y=584. E must make `.journey-hero` a two-column grid (copy 7/12, eye 5/12, as §7.2(1)) so the eye sits beside the copy inside the hero strip. On phones `.sig-eye span` is sr-only and the portal has no `sig-census` next to it, so the number stands alone there — E's call.

## 2. Index comma sliced into a wedge — fixed
Verified from CSS: `hr-design.css` gives `.nav` `margin-inline-end:calc((100vw - 2*var(--shell-pad))*.25)` (the three free end columns), while the comma box was `min(760, vw*.5)` = 720 wide from the gutter, so the full-height `.nav` exclusion cut it vertically.
- `sceneGeometry('index')`: `w=min(760, vw*.5, freeBand)` where `freeBand=(ltr ? vw-nav.right : nav.left) - gutter`; `w<200` ⇒ no scene; `h`, `cx`, `cy`, `R` derived as before; the three exclusions stay.
- Measured 1440x900, void, manager: nav x=380; canvas marks bbox x 43–369, y 331–565; per-50px band the edges are 163–369, 127–346, 103–321, 79–286, 54–250, 43–225 — both edges slanted (a whole comma), nothing pinned at the nav edge. (The pane was hidden, so the canvas kept its 584px home backing height; x positions are unaffected.)

## 3. Sticky pause freezes the home ring — fixed
Verified: `motion-cards.mjs` `pause()` sets a sticky `paused`; `visibilitychange` pauses on any route; `wake()` returns early off-stage; `applyScene()` called `armIdle()` and never `resume`. Reviewer's Node harness (`scratchpad/r2fe/paused.mjs`) re-run: `frames scheduled after entering home while still paused: 0`, after `resume()`: 1.
- `applyScene()`: `fieldFocused=editable(document.activeElement); still()||document.hidden||(fieldFocused&&compact()) ? engine('pause') : wake();` — `wake()` carries all guards, calls `resume` and re-arms idle. Re-measuring `fieldFocused` covers an input removed from the DOM without `focusout`. `editable` is declared above every boot call, so no TDZ.
- Browser check (pane hidden, `document.hidden` overridden by a getter, rAF wrapped and attributed by stack): `#requests` → hidden → visible → `#home`: engine rAF requests after entering home = 1 (was 0 by the harness). The visibilitychange listener was left as is.

## Checks run (literal results)
- `node --check app/static/signature.mjs` → OK.
- `node --test` on the six test files that mention "signature" (client-approvals, files-security, contracts-register, production, platform, ring-engine) → `tests 57 · pass 57 · fail 0`.
- `npm run check` → `Syntax checked: 363 JavaScript modules. Source hashes match. Traceability: 220 requirements / 22 domains.`
- `grep -nE 'style=|<style|https?://' app/static/signature.mjs` → only the pre-existing `SVG_NS` namespace string.
- Browser: throwaway server on 127.0.0.1:3683 (scratch SQLite, synthetic manager session), own tab; `#home` hero order unchanged, one eye; `#portal`: `html[data-scene=home]`, one `a.sig-eye[href="#inbox"]` as last child of `.journey-hero`, no injected date/greeting/census, canvas live (2880x1168). No console messages from signature. Server stopped, temp dir removed, tab closed.

## Not run
- Full `npm test`. 1280, 375, `field`/`slate`, light mode, LTR. No screenshots or motion (the Browser pane was hidden: no compositing, no rAF delivery). The compact login `focusout` path was not reproduced, only covered by the re-measure.

# Round 4 — palette under a modal, focus lost on the mode button (2026-09-19)

## File touched
- `app/static/signature.mjs` only (plus this handoff). No test, CSS, screen module, `work/`, `.env`, port 3600, commit or deploy.

## 1. Ctrl/Cmd+K while a modal `<dialog>` is open — fixed (half of the proposed fix rejected)
Verified by code: `openPalette()` had no dialog guard; the palette is a `<body>` child, so a `showModal()` dialog makes it inert and covers it, while `sealPage(true)` + `html.is-searching` were still applied and the next Esc was eaten by the palette branch.
- `openPalette()`: `if(!document.querySelector('.nav')||document.querySelector('dialog[open]'))return;`
- The keydown handler is intentionally UNCHANGED (still `preventDefault` + `stopImmediatePropagation` for Ctrl/Cmd+K whenever `.nav` exists). The reviewer's second half (do not capture the key while a dialog is open) was tried and measured to be a regression: `journey.mjs:49` has its own document Ctrl+K listener that calls `popup.showModal()`; once signature stops swallowing the key, `#journey-dialog` opens on top of the open `#dialog` (measured: after Ctrl+K the open modal was `journey-dialog`, stacked over the operation form). A comment in the handler records why.
- Measured after the fix (1440x900, void, manager, `#appearance`, «تغيير الوضع» form, `:modal===true`): Ctrl+K → `dialog[open]` = [`dialog`] only, palette not shown, `#app.inert=false`, `is-searching=false`; Esc → `defaultPrevented=false` (not swallowed), focus still inside the dialog. Without a dialog: Ctrl+K opens (focus in palette, `#app.inert=true`), Esc closes (`#app.inert=false`, focus back on `.top-search`), Cmd+K toggles open/closed.

## 2. Mode button drops focus to `<body>` — fixed
Verified by code: `app.mjs:293` runs `await render()` (or `loginView()`), which replaces `#app` innerHTML; nothing refocused the replacement. I did not re-measure the "before" state in the browser.
- Capture-phase click listener records `themeRefocus={el,where:'side'|'login'|'bar',at}` only when the pressed `[data-action="theme"]` holds focus (keyboard, or a mouse click in browsers that focus buttons); any other click and `hashchange` clear it; it expires after 5 s.
- `restoreThemeFocus()` runs last in `enhance()`: waits while the original button is still connected (render pending, or appearance locked → no re-render → nothing to do), then, only if focus is on `<body>`/a detached node and no dialog/palette is open, focuses `.sidebar [data-action="theme"]`, `.login [data-action="theme"]` or `.topbar > .sig-theme` with `{preventScroll:true}`.
- Measured (void, manager): 1440, `.topbar > .sig-theme` focused + click x3 → dark → auto → light, each time `activeElement` = the NEW `.sig-theme` (old `isConnected=false`), aria-label updated. Click with nothing focused → `activeElement` stays BODY (no focus stealing). 375 with the index open, `.sidebar [data-action=theme]` x2: sidebar re-rendered, `is-menu-open` kept, `.stage.inert=true`, `.sidebar.inert=false`, `activeElement` = the new theme row inside the new sidebar.

## Checks run (literal results)
- `node --check app/static/signature.mjs` → OK.
- `node --test tests/ring-engine.test.mjs` (the only test that reads this file by name) → `tests 24 · pass 24 · fail 0`.
- `npm run check` → `Syntax checked: 363 JavaScript modules. Source hashes match. Traceability: 220 requirements / 22 domains.`
- `grep -nE 'style=|<style|https?://|outline' app/static/signature.mjs` → only the pre-existing `SVG_NS` string.
- Browser: throwaway server on 127.0.0.1:3741 (scratch SQLite in the scratchpad, synthetic manager session), own background tab; console errors: one 404 (my own probe of a wrong URL) and three 401s from loads before the cookie. Server stopped, temp dir removed, tab closed, viewport reset.

## Not run
- Full `npm test`. The login-screen theme button refocus (`where:'login'`) and the locked-appearance path were not exercised in the browser. `field`/`slate`, LTR, 1280, real keyboard events (synthetic `KeyboardEvent`/`click()` were used; the pane was hidden), screen readers. Once during the session the tab fell back to the login screen after a reload with a `?r=2` query (401); re-issuing the synthetic cookie restored it; cause not investigated, no signature code involved in auth.
