# Brain scroll fix («كوكبة 360», data-design=depth), 20 September 2026

**Source.** The owner's bug report from his iPhone, with two screenshots: «التصميم ينزل تحت عدله». Three problems:
1. The WebGL brain did not scroll with the page. Scrolling home, it stayed pinned and drew over the stat figures and labels («ما ينتظر قراري», «طلباتي المفتوحة»).
2. At the top of home, the brain reached up under the topbar icons and down over the date line.
3. «٦ بانتظار قرارك» seemed to use an Arabic-Indic digit.

**State: built and verified locally on a throwaway instance (port 3700, seeded synthetic DB, employee session). Not yet seen by the owner on his phone.** Nothing touched the live DB or port 3600.

## 1. What was wrong

- `canvas.sig-depth` was `position:fixed` over the whole viewport. The brain was drawn at the `.sig-eye` centre in *viewport* coordinates. So:
  - **Problem 1.** Scrolling moved the hero and every word but not the brain. From about 250 px of scroll, the brain sat over the stats and lists (`before/before-390x844-home-s600.png`, `before-390x844-home-s1200.png`).
  - **Problem 2 has the same root cause.** `signature.mjs` re-measures the scene on almost any event: the inbox count arriving, the iOS toolbar collapsing (a resize), fonts, or the browser restoring the scroll position on reload. Each re-measure used the eye's *current* viewport position. If the page was scrolled at that moment, the brain was seated higher than its stage, up under the topbar and over the date. That matches the owner's second screenshot: the date line sits at about 185 CSS px there, against 302 at rest.

  At scroll 0 in a fresh load, the stage itself was already right (brain at 81–251 px, topbar ends at 52, date at 302 on a 390 phone).
- **Problem 3 is not a wrong digit.** The string is `${pending} بانتظار قرارك.` and `pending` is a JS number, so the digit was the Latin «1». The count was 1, which matches the «1» badge in the same screenshot. At the census's weight-200 body style, Alexandria draws the proportional Latin «1» as a stem with a flag and no foot, and on a phone that reads as «٦». Zoomed crops show this: `brain-scroll/before/owner-census-crop.png` (the owner's pixels) and `after/390x844-home-s0-census1.png`.

## 2. The approach: (b) the canvas is absolute in the document for the brain's scenes

`app/static/depth.css` §1 now has:

```css
:root[data-design=depth]:is([data-scene=home],[data-scene=login]) .sig-depth{position:absolute;inset:0 0 auto;block-size:100vh;
  mask-image:linear-gradient(#000 calc(100% - 120px),transparent)}   /* and the -webkit- twin */
```

The dust (`off`) and the index globe keep the fixed full-viewport canvas.

**Why this rather than (a), re-measuring on scroll:**
- **No jank by construction.** The compositor scrolls the canvas together with the hero, on the same frame, at 60 or 120 Hz. There is no scroll listener and no rAF re-measure, and nothing gets redrawn to follow the page. Option (a) redraws on the main thread one frame behind a compositor-driven scroll, so on iOS the brain would visibly trail the text.
- **Scroll-invariant geometry.** `sceneGeometry()` already measures every box against `canvas.getBoundingClientRect()`. Once the canvas lives at the top of the document, the eye centre, the exclusion rects and the stage are the same numbers at any scroll position. This fixes problem 2's root cause: a re-measure while scrolled is now harmless.
- **The brain can never cover the content below the hero.** It moves up with its anchor, and once the hero is gone the brain is gone. The engine's existing `IntersectionObserver` then halts the render loop, so there is no GPU cost while reading the rest of home.
- **This matches the 2D fallback**, which has been `position:absolute` since the start (`athar.css` `.sig-aurora`).
- **`100vh` is the iOS *large* viewport**, so the toolbar collapsing does not resize (and clear) the canvas.
- **The mask.** Once scrolled, the canvas's lower edge comes into view. The 120 px mask fades the faint haze and far dust out over that distance instead of stopping on a line. The brain itself ends well above the fade at every size.

**The bar over the brain.** Between about scroll 30 and 250, the brain scrolls up under the top bar, which in this design was transparent until the page title condensed. On home, the bar now turns to the void over the first 24 px of scroll. That uses a CSS scroll timeline (`animation-timeline:scroll(root)`, `animation-range:0 24px`), as depth.css §10 already does with `view()`. The desktop siblings row does the same. The brain reaches the bar's edge after about 29 px on phones and 57 px on the desktop, so it always passes *under* the bar and its icons, never behind them. At rest the bar stays clear, so the haze runs to the top edge with no line. A browser without scroll timelines gets the void bar from the start, which differs by at most 4/255 at rest. The scroll timeline is scroll-linked, not motion, and there is still no JS scroll listener.

## 3. The stage fit (phone and desktop, home)

- **`signature.mjs`** `stageAround()` hands the engine a `fit` box in canvas px:
  - top edge: the hero's top, plus 16 px;
  - bottom edge: the first text box below the eye that shares its column (on a phone, the date line), minus 20 px;
  - side edges: the canvas edges, inset 16 px.
- **`depth-scene.mjs`** `fitRadius()` shrinks the seat radius R until the brain's drawn extent (`BRAIN_EXTENT` = .96 R wide, .7 R up, .7 R down, measured on rendered frames) fits that box. It never grows the brain.
- On all three phone sizes and the desktop, the approved size already fits, so **the look is unchanged**. The fit is a guarantee for layouts that get tighter: a taller safe-area bar, larger text, or a future hero change.
- **Login is deliberately not fitted.** Its seat comes from `--ring-y` / `--ring-r` / `.story-copy` (depth.css §5), and a fit would have shrunk the approved login brain by about 12 % on a 375×667 phone.
- `setScene(name,{cx,cy,R,fit,mirror})` is the only API change. `fit` is optional, and the 2D engine ignores it.

## 4. Exclusions and layout changes

- The exclusion rects are measured in canvas coordinates, so they stay on their text after scrolling. The pixel check below confirms it.
- Re-sent on layout change:
  - The `ResizeObserver` now watches the hero as well as the eye.
  - `document.fonts.ready` schedules one re-measure, because a web font can move text boxes without resizing the hero.
  - Resize, the inbox count, design and theme changes behave as before. `applyScene` still sends only when the geometry actually changed.
- Pointer picking in the engine converts client coordinates to canvas coordinates (`local()`), so hover sparks still find the folds on a scrolled canvas.

## 5. The census digit

`paintCensus()` splits the leading count into `<span class="sig-census-n" data-num dir="ltr">`. The existing `[data-num]` rule (signature.css) gives it tabular lining figures, and Alexandria's tabular «1» has its foot, like every other figure on the platform. The span is idempotent: it is rebuilt only when the text changes. The count stays Latin, from `String(Number)`.

## 6. Contracts kept

- Reduced motion and `data-motion=off`: one settled frame, no loop. Verified at 390, scroll 600, reduced.
- Idle stop, hidden-tab stop, context loss, the governor, tilt, the neural layer: untouched.
- No scroll listener was added in `signature.mjs`. There is still no `style` attribute in markup. CSP: CSS only, no new inline anything.
- The brain's form, palette, marks, bloom and camera: untouched.

## 7. Verification

Headless Chromium with GPU (ANGLE Metal), mobile emulation with touch at DPR 3 on phones, DPR 2 at 1440×900. Tools and captures are in `work/design-verify/brain-scroll/` (`tools/`, `before/`, `after/`). Each capture has:
- `name.png`: the page;
- `name.scene.png`: the same frame with every glyph, icon and fill made transparent. The opaque bars are kept, because they really cover the scene;
- a pixel verdict: every visible text line box in the viewport is scanned in the scene-only frame, and a pixel counts as bright above luminance 0.25.

**Before** (fix stashed, same checker). The brain stays pinned while the content scrolls under it:

| Capture | Brain (CSS px) | Text lines with bright scene pixels | Worst line |
|---|---|---|---|
| 390×844 home, scroll 120 | 81–253 | 7 | the date line, 4,659 bright px |
| 390×844 home, scroll 300 | 81–262 | 3 | the greeting, 4,605 px |
| **390×844 home, scroll 600** | 81–253 | 3 | «سجّل حضورك», 7,203 px |
| 390×844 home, scroll 1200 | 81–253 | 4 | «طلباتي المفتوحة», 3,308 px |
| 375×667 home, scroll 600 | 80–254 | 3 | «سجّل حضورك», 8,774 px |
| 430×932 home, scroll 600 | 85–274 | 4 | «سجّل حضورك», 17,975 px |

**After.** Every capture has **0** text lines with a bright scene pixel. The worst luminance inside any text box is 0.029 on a 0–1 scale, which is the void's own dither and haze.

| Capture | Canvas | Brain (CSS px) | Top bar ends / date starts | Notes |
|---|---|---|---|---|
| 390×844 home, scroll 0 | absolute, top 0 | 81–251 | 52 / 302 | 29 px clear under the bar, 51 px above the date |
| 390×844 home, scroll 120 | top −120 | 52–133 | bar opaque | passes under the bar and its icons |
| 390×844 home, scroll 300 / 600 / 1200 | top −300 / −600 / −1200 | none | | the brain has left with its hero |
| 375×667 home, scroll 0 / 120 / 300 / 600 / 1200 | absolute | 80–245 at rest, then gone | 52 / 296 | 28 px under the bar, 51 px above the date |
| 430×932 home, scroll 0 / 120 / 300 / 600 / 1200 | absolute | 84–272 at rest, then gone | 52 / 325 | 32 px / 53 px |
| 1440×900 home, scroll 0 / 300 / 600 / 1200 | absolute | the brain moves up with the hero and is gone by 600 | 64 (+ siblings) / 265 | the siblings row turns to the void, as the bar does |
| login 390 / 375 / 430 / 1440 | absolute | unchanged approved seat | | 375×667 scrolled to its end (171 px): the brain leaves with the page |
| 390×844, `#portal` (alias of home), scroll 0 / 600 | absolute | as home | | |
| 390×844, reload at 600, back to 0 | absolute | 81–262 | 52 / 302 | geometry measured while scrolled is still right |
| 390×844, reduced motion, scroll 0 / 120 / 600 | absolute | 81–256, then under the bar, then gone | | one settled frame, no loop |
| 390×844, census with 1 pending | | | | «1 بانتظار قرارك.» with a footed tabular 1 (`after/390x844-home-s0-census1.png`) |

**The eye's own figure.** The count inside the brain («0») sits in the engine's soft elliptical window, as designed. The brightest scene pixel inside its box is 0.42–0.43 on phones and 0.76 on the desktop. That is the halo at the edge of the window, not the brain at full brightness.

**The top bar at rest.** Measured on the rendered pixels (`tools/rowprobe.mjs`): the band just above and just below the bar's edge is the same value (about 0.6, 4.4, 3.7 out of 255), so the bar cuts no line into the haze at rest. It turns to pure void over the first 24 px of scroll.

**Before/after at scroll 600 on a 390 phone:** `work/design-verify/brain-scroll/before/before-390x844-home-s600.png` and `work/design-verify/brain-scroll/after/390x844-home-s600.png`. Every row of both tables is in `work/design-verify/brain-scroll/results.txt`.

Tests: `node --test tests/depth-scene.test.mjs` adds three tests:
- `fitRadius` bounds, and never growing;
- the engine honours `fit` and leaves the approved size alone, and hover picking works on a canvas scrolled −600 px;
- the absolute/fixed CSS contract, the stage hand-over, no scroll listener, and the census `[data-num]` run.

- `npm test`: 817 tests, 816 pass, 1 fail. The failure is `timesheets: billable is the approver’s determination…`. It fails the same way at d6ca944 with this fix stashed, because it depends on the weekday: on a Sunday, `addDays(today,-1)` falls in the previous week. It is reported separately and is not touched here. The procurement test did not flake in this run.
- `node --test tests/depth-scene.test.mjs`: 23 of 23 pass, including the three new tests.
- `npm run check`: passes.

## 8. For the owner to check on the iPhone

1. Open home and scroll slowly. The brain should leave upward with the greeting, slide under the top bar, and be gone before the stats.
2. Pull to refresh while scrolled, then scroll back up. The brain should be back in its stage between the top bar and the date.
3. Check that the census reads «1 بانتظار قرارك.» with a footed Latin 1.
