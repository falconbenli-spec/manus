# depth-E — integration of packages A–D

Date: 2026-09-19. I made no commit and no push. I did not touch `.env`, any migration, the live DB (`work/hr-design-preview-20260914.sqlite`), or ports 3600 and 3601.

## Files touched

| File | Change |
|---|---|
| `app/static/signature.mjs` | Engine selection and swap, the ring-live gate, tilt permission, pulse on navigation, the docked sidebar, and the index orbit. |
| `app/static/app.mjs` | View transition on route change (`routeRender`) and pointer tilt on every screen (`paintTilt`). |
| `app/static/motion-cards.mjs` | `mountCards` covers `.vn-tile`, `.pt-tile`, `.department-card` and `.journey-stop` for tilt, and adds the option `enter:false`. |
| `app/static/classic.css` | One token, `--sidebar-docked:1`, in the ≥1024px token block. The temporary `.sidebar[inert]` fallback (two rules) is removed. |
| `work/design-verify/duplicate-selectors.mjs` | The file list now includes `depth.css` and `classic.css`. |

## 1. Engine choice (signature.mjs)

- `token(name)` reads a computed custom property on `<html>`, and `scene3d()` is `token('--scene-3d')==='1'`. No branch in this code names a design.
- **`mountEngine()` is idempotent.** It chooses `'3d'` when `--scene-3d` is 1 and WebGL has not already failed, and `'2d'` otherwise. It returns early if the wanted engine is already live.
- **When it swaps**, it:
  1. calls `destroy()` on the live engine;
  2. releases the old WebGL context with `WEBGL_lose_context`;
  3. removes every `body > canvas.sig-depth`;
  4. resets `sceneKey`, `dataKey` and `sceneName`.
- **3D.** It creates `canvas.sig-depth[aria-hidden]` as a direct child of `<body>`, right after `.sig-aurora` and outside `#app`, then calls `mountDepth(canvas)`. If `ok` is false, it destroys that engine, removes the canvas, sets `depthFailed`, and falls back to `mountBackdrop` on `.sig-aurora`.
- **When it runs:**
  - at boot;
  - in every `enhance()`, where it costs nothing if the right engine is already live and catches a stylesheet that arrives late;
  - in the `<html>` observer on `data-design`, before `applyScene(true)`.
- **Calls reach the live engine.** Every call already went through `engine()` or `backdrop`: `setScene`, `setData`, `setExclusions`, `dim`, `pulse`, `pause`, `resume`, the reduced-motion `onMedia`, `visibilitychange`, the motion row and the toast pulse. `applyScene` now takes its geometry origin from `engineCanvas`, not from `.sig-aurora`.
- **`liveScene()` and `pushData()` read `sceneName`,** which is the scene the engine was actually given, not `data-scene`.
- **The `--ring-live` gate.** When `--ring-live` is 0 and the 2D engine is live, `applyScene` passes `off` for every scene, login included. This closes classic handoff item 4. `wake()` no longer resumes on the classic login, because `sceneName` is `off`.
  - The old check for the home scene inside `sceneGeometry` was folded into this gate.
  - Field's `[data-scene=home]{--ring-live:0}` behaves exactly as before.
- **The index scene in 3D** also resumes or pauses, based on `still()` and `document.hidden`.
- **Tilt.** `armTilt()` runs after each successful 3D mount. It adds capture listeners for `pointerdown`, `touchstart` and `click`. When the 3D engine is live, each of these calls `enableTilt()`. The listeners are removed on success, or after the attempt made from a `click`.
  - **Deviation from the brief:** WebKit does not count `touchstart` or `pointerdown` as the user activation that `requestPermission` needs, so `click` is included as the fallback. Without it, iOS would never grant the permission.
- **Pulse.** `hashchange` stamps `pulseWanted`. The next `applyScene` that hands a non-`off` scene within 2 s calls `pulse()`, but only when the 3D engine is live and motion is allowed.

## 2. Docked sidebar (signature.mjs and classic.css)

- `docked()` returns `!compact() && token('--sidebar-docked')==='1'`. Classic declares the token only in its ≥1024 token block.
- **When docked, `syncDrawer()`:**
  - removes `is-menu-open` if it is set, for example after switching from depth with the index open;
  - removes `role` and `aria-modal` from `.sidebar`, which leaves it a plain `aside` landmark;
  - sets `inert=false` on the sidebar and never sets `inert` on `.stage`, `.sig-tabs` or `.skip`.
- **When docked, `openDrawer()`** only focuses `#nav-search`.
- **It is re-evaluated** on the existing 1024px media listener, in every `enhance()`, and on a `data-design` change.
- The `.sidebar[inert]` fallback in classic.css is removed. With the JS change it can never match.

## 3. View transitions (app.mjs)

- **Only the `hashchange` listener changed.** It calls `routeRender()` instead of `render()`. Every other re-render (theme, language, reload, forms, toasts) is untouched.
- **`sceneTransition()` requires all of these:**
  - `typeof document.startViewTransition==='function'`
  - `typeof getComputedStyle==='function'`
  - no `html[data-motion=off]`
  - no match for `(prefers-reduced-motion: reduce)`
  - `--scene-3d` computed as 1

  Everything sits in try/catch, so the VM sandbox (no `matchMedia` or `getComputedStyle`) returns false.
- **The callback starts `render()`** and resolves on whichever comes first: the render finishing, or 320 ms. The page is therefore never frozen while it waits on the server. On a slow load the new snapshot is the loading shell, and the data then paints normally.
- **Rejections are handled.** `ready` and `finished` get `.catch`. Without this, skipped transitions logged `Uncaught (in promise) InvalidStateError`, which I saw in the browser and then fixed.
- **Ordering.** `routeRender` resolves only after `updateCallbackDone` and the render promise. No focus or other work ran after `render()` in the hashchange path, so nothing had to move. No new top-level `document.addEventListener` was added to app.mjs; the sandbox keeps one listener per event.

## 4. Index orbit (signature.mjs)

- **`syncOrbit()`** runs from `enhance()`, from the design observer, and on `#nav-search` input, where it resets to the first visible group.
  - It is on only when `--scene-3d` is 1 and the viewport is not compact (≥1024).
  - When on, it writes `--i` on each visible `.sidebar > .nav > .hr-nav-group` (hidden groups get no `--i`), and writes `--n` and `--orbit` on `.nav`.
  - Otherwise it removes all three properties.
  - DOM order never changes.
- **Rest position.** A new `.nav`, and every `openDrawer()`, rests on the group that holds the active link. `--orbit` is exactly `-(i·360/n)deg`.
- **`orbitTo(i)`** turns the shortest way with an ease-out cubic over 240–520 ms of rAF frames. With reduced motion or motion paused it snaps with no animation. A timer at the end of the duration forces the exact rest value if rAF was throttled.
- **Input:**
  - **Drag:** pointer events, horizontal only. The drag is armed after 6 px and uses pointer capture. Sensitivity is `360/n` degrees per card width (`offsetWidth`). The release snaps to the nearest group. The `click` that follows a drag is cancelled in the window capture phase, and `dragstart` inside the orbit is prevented. A tap under 6 px clicks normally.
  - **Wheel:** a listener on `.nav` itself (`passive:false`). Horizontal delta, or Shift with vertical delta, steps one group per 48 px. Plain vertical wheel still scrolls the card.
  - **Keys:** ArrowRight brings the card on the right (i+1), and ArrowLeft brings the card on the left. Focus moves to the first link of that group.
  - **Focus:** `focusin` turns the orbit to the group that received focus.
  - After a drag or a wheel step, focus left in an off-front group moves to the front group. Otherwise `:focus-within{opacity:1}` would keep a hidden card painted over the front one.

## 5. Tilt (motion-cards.mjs and app.mjs)

- `ENTER` is `.rq-card:not(.is-static),.rq-dept`. `SELECTOR` is `ENTER` plus `.vn-tile,.pt-tile,.department-card,.journey-stop`.
- The entrance classes (`rq-enter`, `--rq-delay`, `rq-shown`) go only to `ENTER` matches. Nodes without `matches()` count as `ENTER`, which keeps the existing test mocks valid.
- The tilt properties go to all `SELECTOR` matches.
- `mountCards(root,{enter:false})` is tilt only.
- `app.mjs` `paintTilt(#main)` runs after each route render except the catalog, which keeps `paintMotion`. It has its own `clearTilt`, and a missing `mountCards` in the VM sandbox is caught.

## 6. duplicate-selectors

Its file list now has seven stylesheets.

**Limitation:** the script does not expand CSS nesting. Classic's `:root[data-design=classic]{ & … }` is therefore counted as one rule. This is harmless for this check, because every classic rule is scoped under the design attribute.

## 7. Verification (literal output)

```
$ node --check app/static/signature.mjs app/static/app.mjs app/static/motion-cards.mjs app/static/depth-scene.mjs work/design-verify/duplicate-selectors.mjs   # each: ok
$ npm test
ℹ tests 700
ℹ pass 700
ℹ fail 0
$ npm run check
Syntax checked: 365 JavaScript modules. Source hashes match. Traceability: 220 requirements / 22 domains.
$ node work/design-verify/contrast-designs.mjs     (exit 0)
All pairs with a floor pass.
$ node work/design-verify/duplicate-selectors.mjs
selectors parsed: 1735 · defined in more than one file: 35 (of which set the same property twice: 18) · under a named exception: 5
```

The procurement test did not flake in either full run.

### Browser (Chrome in the Browser pane, throwaway instance on 3625)

**Setup.**

- A small launcher, now deleted, did the following:
  1. opened a fresh DB at `work/design-verify/integ.sqlite`;
  2. ran `scripts/seed.mjs`'s `seed()` with a random password that was never printed or stored;
  3. inserted a session row for the synthetic `hr` account;
  4. used a throwaway `FIELD_KEY_PATH`.
- **No password was typed anywhere.** Another instance's HttpOnly `session` cookie on `127.0.0.1` shadows cookies at `/`, so the browser was given the session as a `path=/api` cookie. I cleared that cookie afterwards.
- `.env` was never loaded, because `createApp` was imported directly.

**Checked and passing:**

- **Depth login** at 1440 in dark and light, and at 375 in dark: `canvas.sig-depth` is mounted as a child of BODY (2160×1350 at 1440, 469×1015 at 375, so the DPR cap applies), the 3D ring renders, and `.sig-aurora` is never mounted.
- **Depth home** at 1440 in dark and light, and at 375 in dark. **Requests** and **payroll** (tier ledger) at 1440 in dark.
- **Design switching** without a reload, through the topbar picker, in the order depth → classic → void → field → slate → depth → classic → depth. Canvases after each step:

  | Design | Canvases |
  |---|---|
  | depth | `[sig-aurora 0×0, sig-depth]` |
  | classic, void, field, slate | `[sig-aurora]` only, never a stray `sig-depth` |

  The sidebar in classic at 1440 has no `role`, no `aria-modal`, `inert=false`, and `.stage` is not inert. Back in depth it is `role=dialog` and inert while closed. There were no `[signature]` warnings, and the console was clean except for the expected pre-login 401s.
- **The design picker on the login screen** swapped classic → depth and mounted the 3D canvas.
- **Classic login** has `--ring-live` 0 and `--scene-3d` empty, so the scene is sent `off`: `.sig-aurora` is `display:none` and 0×0, and the engine is no longer given `login`.
- **Classic desktop sidebar:** a real pointer click on «بانتظار قراري» in the sidebar navigated to `#inbox`. The menu never opened, and `.top-avatar` stays `display:none`. At 375 the sidebar is `role=dialog` and inert again; opening it from the tab bar makes the stage inert and focuses `.side-done`, and closing it restores that.
- **Classic `#portal` at 1440 light** matches the owner's photo layout.
- **Index orbit (depth, 1440):**
  - On open: `.nav` is `display:grid`, `--n` is 6, `--i` runs 0 to 5, and opacities are `1,0,0,0,0,0`.
  - ArrowRight gives −60deg; ArrowLeft twice wraps to −300deg, where group 6 is the only opaque card.
  - A 400 px drag moves the ring live to −46.3deg, snaps to exactly −60deg, suppresses the click (no hashchange, index still open), and moves focus to group 2.
  - A horizontal wheel step goes to −120deg. A vertical wheel step leaves the angle alone.
  - A tap under 6 px goes through and closes the index.
  - Searching «رواتب» re-indexes to `0,h,1,h,h,h` with `--n` 2 and rests at 0deg. Clearing the search restores `--n` 6.
  - Reopening the index rests on the active group (0deg).
- **Motion paused** (`data-motion=off`) through the account row: no `startViewTransition` calls on navigation (0, against 1 with motion on), the orbit snaps at once (−60deg synchronously), and `.nav` falls back to `display:block`.
- **Five rapid hashchanges** end on the right page, with no unhandled rejections and no view transition left active.

**Frame time: not measured on real frames.**

- The Browser pane was hidden. `document.hidden` was true and rAF was throttled to about 1 Hz; two 3-second samples gave `median 1015.7 ms`.
- Two samples that happened to run at full rate right after a screenshot gave the following. The engine's own loop was most likely halted by `document.hidden` during both, so these numbers describe page compositing, **not** the WebGL engine. This still needs a measurement in a visible window on the target machines.

  | Sample | Frames | Median | p95 | Max |
  |---|---|---|---|---|
  | 1 | 180 | 16.70 ms | 18.40 ms | 34.8 ms |
  | 2 | 180 | 16.70 ms | 18.50 ms | 31.7 ms |

**Screenshots: not saved.**

- The Browser tool returns images inline only and cannot write files. `screencapture` was not allowed, so `work/design-verify/shots/` was not created.
- I did look at these: depth login at 1440 in dark and light and at 375 in dark; depth home at 1440 in dark and light and at 375 in dark; the depth index orbit at 1440 in dark; depth requests and payroll at 1440 in dark; classic portal at 1440 in light; classic inbox at 1440.

**Cleanup:** the server is stopped, and the DB, WAL, session file, log and launcher are deleted. The browser tab is closed, the viewport is reset and the test cookie is removed.

## Remaining defects and risks

1. **Hidden-pane artefacts, not app bugs, but worth knowing.**
   - While the page is hidden, the view-transition animation does not advance. The first screenshot after a navigation showed the frozen old or loading snapshot until the page became visible.
   - Entrance animations in classic `#portal` likewise showed a blank main area on the first frame.
2. **Frame time of the WebGL engine** on real hardware is still unmeasured (see above).
3. **The iOS tilt permission** flow is untested on a device. The code tries on `pointerdown`/`touchstart` and then on `click`.
4. **The requests empty state** in depth shows a very large «لا توجد طلبات هنا بعد». This is a pre-existing style, outside this package, and the owner should judge it.
5. **Arrow-key direction in RTL is visual.** ArrowRight brings the card on the right, which is i+1 in DOM order. If the owner prefers the reading direction (ArrowLeft = next in Arabic), swap the sign in `orbitKey`.
6. **The account's saved design follows the picker.** Switching designs while signed in saves to the account, as package A intended. The verification account therefore ended on depth/dark. That account was throwaway.
