# Design package E — the ring engine, login, stage heroes, horizon, threshold

Date: 2026-09-18. Layer: `stage`. This was a resumed run: the earlier attempt had written the engine and a first test file, and had not touched `athar.css`. I kept what was correct, fixed what was wrong, and wrote the rest.

## Files touched

| File | State |
|---|---|
| `app/static/motion-cards.mjs` | `mountCards` and `prefersReducedMotion` untouched. New exports `ringField`, `commaField`, `mountBackdrop`. 16,619 bytes |
| `app/static/athar.css` | Written from the one-line placeholder. Everything inside `@layer stage` except three `@keyframes`. 21,780 bytes |
| `tests/ring-engine.test.mjs` | New. 24 tests |
| `docs/implementation/handoff/design-E.md` | This file |

Nothing else in the project was edited. Verification servers and the harness page lived in the session scratchpad, not in `work/` and not in `app/static`. Port 3600 was never touched. Nothing was committed or deployed.

## What is done

**Engine (contract 4).**
- `ringField(opts)` and `commaField(opts)`: pure, deterministic, Node-testable, `{data:Float32Array, count}` with 10 floats per mark (`x y hx hy t k c f d ph`). Orthogonal lattice `pitch x 1.13 pitch`, band mask, hashed edge halo up to 1.12 R, exclusion rectangles with a feather, per-node mirror flag, 77/10/10/3 colour hash, 300 degree arc from 12 o'clock with a 60 degree gap (`t = -1`), the guideline ink law, up to 12 moons as promoted lattice nodes, optional drifters. `mirror:true` reverses `t`, the node flags and the Form A fade.
- `mountBackdrop(canvas,{view,reduced})` returns exactly `setScene setData setExclusions dim pulse pause resume destroy`; all eight are no-ops when `getContext` fails or throws.
- Geometry comes only from `setScene`/`setExclusions`. The engine never measures the DOM (a test greps the source for it). It observes the canvas size (`ResizeObserver`), the canvas visibility (`IntersectionObserver`: the hero leaving the viewport stops the loop) and three `<html>` attributes.
- Colours are read from `--ring-a --ring-b --ring-c --ring-d --stop --ink-1` with `getComputedStyle` at every (re)start and again when `data-theme`, `data-design` or `data-motion` changes. No colour literal exists in the file (tested).
- Off the stage: `canvas.width = canvas.height = 0`, no rAF, no timer, no pointer listener.
- Still frame (no rAF) for `reduced`, `36t-motion-paused`, `html[data-motion=off]`, `document.hidden`, the governor's last step and the `index` scene; it is redrawn on resize, theme/design change, every changed `setData`, and by a 60 s `setTimeout`.
- Opening once per session (`sessionStorage 36t-ring-intro`): 300 ms on a Form A block, 1,400 ms flight with angle delay and `1-(1-u)^3`; marks in flight are outlined, settled marks are filled in batches (one path and one fill per colour x bucket, at most 40). A scene change re-forms the same marks in 700 ms.
- Idle ladder: 30 fps, 12 fps after 20 s, stop after 60 s (12 s under 760 px). Governor on the rAF interval: drifters, then 35% of the marks (edge first), then a still frame for the session. DPR cap 2, and 1.5 under 1024 px.
- Pointer repulsion on the desktop login only, passive listener, removed everywhere else.
- `pulse()`: six fading ghosts in 900 ms; also fired when the gap closes.

**Fixes made to the inherited engine in this run.**
1. `index` geometry: `signature.mjs` passes the centre of the 760 x 554 box and `R` = half its height; the engine had read `R` as half the width and drew a smaller comma. Now `w = 2R x 1.373`, `h = 2R`.
2. `closed` on the login scene: `signature.mjs` sends `pending:null, closed:true` on submit. The engine honoured `closed` only with `pending === 0`, so the login ring never closed. Now: home needs an explicit zero; login takes `closed` as the submit signal. `pending:null` still never closes anything on home (tested).
3. `signature.mjs` calls `setScene` then `setExclusions`; the second rebuild replaced the opening with a 700 ms re-form. A rebuild in mid-flight now keeps the running clock, and the opening block respects the exclusions (tested).
4. The per-minute progress tick (plus the `resume()` F sends with it) restarted the 60 s idle ladder every minute, so the loop never stopped during working hours. A progress-only change under 0.01 is now drawn without restarting the ladder (tested).
5. The login density rotation wrapped inside the arc and produced a dense patch next to the gap. The whole figure (arc and gap) now turns 1 degree per second; gap nodes keep their angle in `d` (500..600 ms).
6. The `MutationObserver` no longer listens to `class` (every `is-kbd`/`is-menu-open` toggle restarted the loop).
7. A hidden document now gets one settled frame instead of nothing.
8. `W/H` are no longer zeroed on `off`, which could leave `home` without a ring after a design change with an unchanged canvas box.
9. Pointer coordinates use `pageX/pageY`, because the login canvas now scrolls with the page.

**`athar.css`.** `.sig-aurora` per scene; login ring geometry per size and `dir`; login (two columns from 1024 px, one column below, short landscape without a ring, OTP fold, password gate, `#password-form` inside the dialog); threshold (`html.is-threshold::before/::after`, logo mask built from the four `d=` strings of `brand-logo.mjs` verbatim); home/portal hero (`.sig-date .sig-greeting .sig-census .sig-eye`, phone composition); `.journey-hero .journey-greeting .journey-copy .journey-cta` (position only), `.rq-hero .rq-hero-copy .rq-kicker .rq-search .rq-search-icon`, `.ex-hero .ex-hero-copy .ex-figures .ex-figure .ex-figure-label`, `.pt-tiles` position; `.page-head::after` (horizon, ledger strip, 6 px strip on the eleven sensitive routes via `:is()`); `.empty-symbol` (hollow by default, full on `inbox notifications work`, colour `--ghost`); `.loading` (consumes `rq-sheen`); `.rq-search` focus line (consumes `rq-beam`); `.dialog-head::before` and `.side-head::before`; the field design's still ring on `.sig-eye::before` and `display:none` on the canvas there.

Owner decisions applied: display weight `--fw-display`, labels `--fw-label`, stage paragraphs `--fw-stage-body` (degrade to 400/700 today); no `@font-face`; no `.part` reference; `--logo` and `--ink-display` on the login and the greeting; turquoise only through `--brand-turquoise`.

## Decisions I took that differ from the letter of the spec

- **Login canvas is `position:absolute`, not `fixed`.** It is one viewport tall and scrolls with the page, so exclusion rectangles measured at layout stay true when a short screen scrolls. The phone login is 924 px tall on an 812 px screen; with `fixed` the marks would pass behind the form. `index` stays `fixed`.
- **Form column at inline-start, ring at inline-end.** The spec's words ("end side") contradict its numbers (`--ring-x:34vw`, `66vw` in LTR). The numbers win: Arabic has the form on the right and the ring on the left; English mirrors.
- `.login-story` and `.login-form` are `display:contents`; `.story-copy` is an absolutely positioned box on the ring centre (not `contents`), which is what lets the title sit in the eye at every size.
- Under 760 px `.page-head::after` is the 6 px strip, not the 204 x 95 block (the block would sit behind the full-width action).
- `.journey-copy h1` steps down to `--fs-display-m` when the hero above already greets at `--fs-display-l`.
- `.rq-search kbd` is hidden: the "/" shortcut was removed by F, so the hint would be false.
- The login title reveal (`clip-path`, 420 ms) replays if the login view is re-rendered (language switch); "once per session" needs JS that F does not provide.
- The white of the threshold logo is `--brand-paper` (#FAF9FF), the only always-light token; no literal colour was added.

## Not done / known limits

- **Size budgets are exceeded.** `motion-cards.mjs` is 16,619 bytes (plan: 12.5 KB). `athar.css` is 21,780 bytes (plan: 14 KB). I did not cut specified behaviour to meet them. The five stylesheets together are about 194 KB against a 101 KB target; that is not mine alone.
- The spec's sprite atlas (`drawImage`) for marks in flight and the 256-entry sine table are not implemented; marks in flight are stroked paths. JS cost per frame measured in Node with a no-op context: 0.46 ms during the opening, 0.04 ms idle, 2,594 marks. **Real raster cost was not measured**: the browser pane reports `document.hidden = true`, so no rAF ever ran there. The 3.5 ms / 6 ms frame budget is unverified.
- Desktop login at 1440 x 900 generates 2,594 marks plus 40 drifters; the spec says about 2,200.
- Not seen in a browser: the app after sign-in (I do not enter passwords), so the hero, index and threshold were checked on a scratchpad harness page that loads the five real stylesheets and the real engine, not inside the real shell. The login to home morph, `#password-form` inside the real dialog, the drag handles on the real sheets, `forced-colors`, `prefers-contrast:more`, and Safari were not checked.
- `field` hero: no gap and no moons (declared limit of the addendum).
- English login title wraps to four short lines at 72 px; it stays inside the eye and no mark is behind it.

## Checks run, literal results

| Command | Result |
|---|---|
| `node --check app/static/motion-cards.mjs` | OK |
| `grep -c "eval(" app/static/motion-cards.mjs` | 0 |
| `grep -nE "style=\|<style\|https?://\|eval\(" app/static/motion-cards.mjs` | no output |
| `node --test tests/motion-cards.test.mjs tests/ring-engine.test.mjs tests/static-modules.test.mjs tests/ui-render.test.mjs tests/ui-race.test.mjs` | tests 30, pass 30, fail 0 |
| `npm run check` | "Syntax checked: 363 JavaScript modules. Source hashes match. Traceability: 220 requirements / 22 domains." |
| `npm test` (once, at the end) | tests 684, pass 684, fail 0 |
| `grep -nE 'box-shadow\|backdrop-filter\|(^\|[^-])gradient\(' athar.css` | no output |
| `grep -nE '!important\|outline:(none\|0)' athar.css` | no output |
| physical `left/right/top/bottom` properties in `athar.css` | none |
| `letter-spacing` in `athar.css` | four `0`, one `.08em` on the Latin lock-up `.login-card .eyebrow` |
| `https?://` in `athar.css` | only `xmlns` inside three `data:` URIs |
| `grep -c '#16A085' app/static/*.css` | 1, in `signature.css` |
| top-level blocks of `athar.css` | three `@keyframes`, one `@layer stage` |

Browser, real login page on a throwaway server (temp database, 127.0.0.1:3795, now stopped and deleted): painted canvas pixels inside the boxes of `.login-card`, `.story-copy h1`, `.story-copy p`, `.story-copy .eyebrow`, `.hr-values`, `.login-footer` and the logo were **0** at 1440 x 900, 1280 x 720, 820 x 1180 and 375 x 812 in Arabic, and at 1440 x 900 and 1280 x 720 in English (`dir=ltr`). No horizontal overflow at any of them. At 812 x 375: `data-scene=off`, `canvas.width = 0`. Harness: home hero in `void` dark and light and in `field` (canvas `display:none`, `width 0`, CSS ring shown), phone hero at 375 (eye 134 px, no overflow), `index` giant comma, threshold still frame with `data-motion=off`, empty state on the `inbox` route, loading mark.
