# The brain, strong and interactive — depth design hero + platform interaction

Date: 2026-09-19. State: **built locally, tested locally** (unit tests, `npm run check`, the contrast script, and headless-Chromium screenshots against a throwaway synthetic instance). It is not yet accepted by the owner. I made no commit and no push. I did not touch `.env`, any migration, the live DB, or ports 3600, 3601 and 3630.

The owner picked Direction A's brain (`work/design-verify/directions/A/shots/phone-brain.png`, «احس الدماغ احلى واحد بس خله قوي وخالي من البكسله والمنصه كلها تكون تفاعليه») and confirmed that image as the look to keep. This work keeps that look (the 3/4 side view, the mint-glowing outlined commas, the bright rim, the teal volume on black, and dense but separate marks) and makes the brain sculpted, crisp at @3 and interactive.

## Files touched

| File | Change |
|---|---|
| `app/static/depth-scene.mjs` | Rewritten on Direction A's renderer. It adds a procedural-SDF brain, a key light with approximate occlusion, a neural layer (sparks, waves, flinch), `spark()`, the `36t:brain` listener and a soft home-count window. The torus and sculpture code is removed. |
| `tests/depth-scene.test.mjs` | Rewritten: 20 tests. |
| `app/static/interact.mjs` | **New.** Platform-wide micro-interactions and the brain hooks. |
| `tests/interact.test.mjs` | **New.** 6 tests. |
| `app/static/depth.css` | Adds §14 interaction, a mint `--eyebrow`, mint value separators and `--ring-d`, a slightly taller phone login stage, and header contract comments. |
| `app/server.mjs` | One whitelist line: `/interact.mjs`. |
| `app/static/index.html` | One `<script type="module" src="/interact.mjs">`, loaded after `signature.mjs`. |
| `app/static/signature.mjs` | **Unchanged.** The mount call `mountDepth(canvas)` already fits, and the engine listens to the window event itself. |
| `app/static/app.mjs` | **Unchanged.** Success and errors are read from `#toast` and the inline error slots. |

## 1. Engine (`depth-scene.mjs`)

**The contract is kept.** `mountDepth(canvas,{view,reduced})` returns `{ok,setScene,setData,setExclusions,dim,pulse,pause,resume,destroy,enableTilt}`, plus `spark(x,y)` and `stats()`. With no WebGL, or a failed compile, it returns `ok:false` with no-op methods, and `signature.mjs` falls back to the 2D ring. Also kept:
- reduced motion, a stored pause and `html[data-motion=off]` each give one settled frame, and no neural events are drawn;
- the loop stops when the tab is hidden, when the canvas is off screen (IntersectionObserver), and when idle (90 s desktop, 30 s phone, 20 s / 8 s in the dust);
- after context loss, programs, buffers and the six FBOs are rebuilt;
- a theme watcher redraws on change;
- exclusion rects fade marks to zero with a 40 px feather.

**Renderer (Direction A, ported):**
- One point sprite per mark. The fragment shader measures the exact distance to the brand quad `[[.372,0],[1,0],[.539,1],[0,1]]` (the half comma below 5 CSS px). The line core is about 1 device px with a Gaussian edge.
- Native DPR: min(dpr,3) on phones and min(dpr,2) on desktop.
- Adaptive governor: DPR × .85 → .72 → .6, then 60 % of the count, then a still frame. A steady 30 Hz cadence never costs resolution.
- HDR half-float target and a real bloom chain (1/2 → 1/4 → 1/8, separable Gaussians).
- Per-mark depth of field (circle of confusion), depth grading and exponential fog.
- Every morph passes through the galaxy.
- Marks only yaw and pitch, never roll.

**Palette:** only `--brand-turquoise`, `--brand-turquoise-deep`, `--brand-sky`, `--brand-paper` (and `--canvas` for the paper theme). The ramp is abyss (deep teal toward black) → deep turquoise → turquoise → mint (the turquoise lifted in its own hue) → sky → paper. The engine no longer reads `--spark`, `--occasion-*`, `--ring-d` or `--stop`; a test asserts this. `late` now quickens the currents instead of turning a rim red. On a light canvas the composite re-inks the light in deep teal (`work/design-verify/brain/harness-paper-theme.png`).

**Scenes:**

| Scene | Form | Notes |
|---|---|---|
| `login` | brain | 3/4 side view, slow sway |
| `home` (home and «ملخصي») | brain | the count sits in a soft elliptical window (`uHole`), not a hard rect |
| `index` | globe | |
| `off` (work screens) | galaxy dust | dim .10, clock .25×, bloom × .45; the pointer does not wake it |

## 2. The brain

It is a procedural signed distance field in model space (x lateral, y up, z front). Its proportions are a real cerebrum's: length 2.2, width ≈ .70 L, height ≈ .57 L.
- **Lobes:** one hemisphere mirrored by |x|. A core ellipsoid is smooth-unioned with frontal, parietal and occipital ellipsoids (k .14–.16) and a temporal ellipsoid (small k .05, so a crease stays above it). The cerebellum is a mirrored ellipsoid under the back. The brainstem is a tapered capsule plus a pons.
- **Longitudinal fissure:** a medial cut, `smax(d, GAP−|x|)` with GAP .02, gives two flat medial walls. Marks on those walls are rejected, because they are occluded inside the fissure.
- **Lateral (Sylvian) sulcus:** a carved groove along a rising segment on the lateral face, 0.13 deep.
- **Gyri and sulci:** these are the nodal lines of a random-wave field with one wavenumber (Berry's random-wave model, 18 plane waves, light domain warp). Its zero set is a near-even labyrinth, the pattern that Turing-type reaction–diffusion also gives and that cortical folding resembles.
  - The distance to the nearest sulcus along the surface is |u| / |∇u tangent|, so every sulcus has the same width whatever the local spacing.
  - Height: rounded crowns (+.035) and narrow V sulci (−.075). The wavelength is .48 on desktop and .50 on phone, and the widths scale with it.
- **Sampling:**
  1. Rejection from the SDF shell (|d|<.05 in a bounding box), with quotas per part.
  2. Newton projection onto the base surface.
  3. Displacement along the base normal by the fold height.
  4. The orientation comes from the displaced surface's normal (two neighbours), so the fold walls tilt the cards.
  5. About 82 % of the marks at the bottom of each sulcus are dropped, which leaves dark channels.
- **Tone:** sulcus floors are abyss and small. Sulcus lips are mint, and they read as mint rim lines along every fold. Gyral crowns are the brightest: mint with sky and paper highlights. The cerebellum has concentric folia.
- **Light:** a key light on the true normal (half-Lambert plus a tight specular), and an approximate occlusion (a back-facing mark recedes to 36 %). The silhouette rim (1−|n·v|) lights the sulcus walls and the outline in mint and sky. The focal band sits on the front surface, so the brain's face is sharp and its back softens.
- **Counts:** 16,000 marks on desktop and 8,000 on phone. The brain form is 64 % cortex, 8.5 % cerebellum, 2.2 % stem, and the rest faint interior volume.
- **Motion:** yaw −1.3 ± .34 rad over about 90 s. This is a slow turn about a near-side view with the front to the left, the same view as the baseline. The camera is 24° above.

## 3. Interactive brain («عصبي»)

- **Pointer and touch:** parallax, gentle local repulsion (softened so a tap never leaves a hole), and a lit neighbourhood.
- **Synapses:** hover or drag spawns a spark from the fold nearest the pointer every 160 ms (70 ms while dragging).
  - Each spark travels along the nodal line it starts on and is re-projected onto the folded surface every step.
  - It lights nearby marks through 18 uniform slots, and it draws its own 7-comma comet in the brain's frame.
- **Tap or click:** a neural pulse wave (a screen-space ring) plus two sparks. It is ignored inside form fields.
- **Tilt:** tilt on phones is unchanged; `enableTilt` is still armed by `signature.mjs` on the first gesture.
- **API and events:**
  - `pulse()` merges repeated calls within 600 ms.
  - `spark(x,y)` sends a burst from folds scattered around (x,y), or across the brain when no point is given.
  - The engine listens to `window` `'36t:brain'` CustomEvents with `{kind:'spark'|'pulse'|'dim',x?,y?}`. `dim` is a brief flinch to 42 % over about 1 s.
  - On work screens, `spark` and `pulse` are a soft wave in the dust.
- These are pure helpers that are unit-tested: `brainSurface`, `foldAt`, `makeSpark`, `stepSpark` and `sparkLight`.

## 4. Platform interactivity (`interact.mjs`)

**Activation.** It is active only while the computed `--scene-3d` is `1`. It is a no-op in every other design, and fully off under `prefers-reduced-motion` or `html[data-motion=off]`. When active it sets `html[data-ix]`, and `depth.css` §14 draws every effect from that attribute. It writes CSS custom properties through the CSSOM only; it writes no style text and injects no DOM.

**Effects:**
- **Light spot** (mouse): `--mx`/`--my` on the row, card or tile under the pointer, drawn as a 260 px turquoise radial at 14 %.
- **Magnetic pill:** the filled action (the `@layer fill` selector list) leans up to 6 × 3 px toward the cursor through `translate`. Its rect is cached before it moves, so there is no feedback loop.
- **Press:** rows, cards and tiles `scale:.98` on `:active`. Buttons already had it.
- **Count-up:** figures that enter the view after render (IntersectionObserver; figures already visible are left to `signature.mjs`'s own count-up) count up in an overlay, `::after{content:attr(data-ix-shown) / ""}`. The real text is made transparent, but the DOM text is always the true number. Screen readers read it, and the overlay's alt text is empty. The tabular digits and the box are unchanged, and the overlay is skipped on the ledger tier.
- **Staggered rows:** after a route change, the first 14 rows get `--ix-i` and `html[data-ix-enter]` in the same microtask as the DOM insertion. They rise with a 28 ms stagger in a CSS animation that ends at the natural state. No row ever waits on an observer.
- **Focus ring:** `:focus-visible` glows with a turquoise halo. This is static, so it stays on under reduced motion, and it is off in forced colours.
- **Touch ripple:** a ripple from the tap point instead of hover. Two alternating animation names restart it without a reflow.

**Hooks (no `app.mjs` edit):**
- `hashchange` → `pulse`.
- A submit is recorded with its button's centre. A toast that starts «تم …»/"Saved" → `spark` at that button. Any other toast → `dim`.
- An `.error` inserted into `#dialog-error` or `#login-error` → `dim`.
- A successful sign-in (the `.login` view leaves after `login-form`) → `spark`.

**Performance:** listeners are passive and pointer work is rAF-throttled, with reads before writes and rect caches dropped on scroll and resize.

## 5. Verification

**Setup:**
- A throwaway instance: `scratchpad/brain/preview.mjs`, a copy of `depth-preview.mjs` on port 3670, with its own token file `brain-preview.token`, a fresh temporary synthetic database and a random password.
- Headless Chrome for Testing 1234, using `--use-angle=metal --enable-gpu --ignore-gpu-blocklist`.
- The logout shots use `Network.clearBrowserCookies`.

**Screenshots:** all in `work/design-verify/brain/`.

| Shot | Files |
|---|---|
| Phone 390×844 @3 (canvas 1170×2532) | `phone-login.png`, `phone-home.png`, `phone-portal.png`, and 4× nearest-neighbour crops `phone-*-zoom4x.png` (crisp outlines, no blockiness) |
| Desktop 1440×900 @2 (canvas 2880×1800) | `desk-login.png`, `desk-home.png`, `desk-portal.png`, and `desk-*-zoom4x.png` |
| Baseline side by side | `compare-baseline-vs-new-phone.png` (Direction A's `phone-brain.png` next to the new login @3) |
| Interaction | `desk-interaction-sequence.png` (rest → hover sparks → +350 ms → click +90/+350/+800 ms → a `36t:brain` spark → a `36t:brain` dim), `desk-interaction-hover-sparks.png`, `desk-interaction-click-pulse.png`, `phone-tap-sequence.png` |
| Index globe | `desk-index-globe.png`, taken at **1920×1080**. At 1440×900, `signature.mjs`'s index geometry finds less than 200 px of free strip beside the two-column nav and hands the engine `off` (the dust). That is existing behaviour and is not changed here. |
| Work screen | `desk-work-dust.png` and `phone-work-dust.png` (`#work`, very dim dust) |
| Paper theme | `harness-paper-theme.png` (the harness with `--canvas:#fff`) |

**Performance.** Each window is 4 s, after the form settled; `perf.mjs` is in the scratchpad. The engine frame interval counts frames the engine actually drew. "Busy" means a `spark()` every 330 ms, so six sparks and waves are live. The GPU time comes from `EXT_disjoint_timer_query_webgl2` (debug-only `{gpu:true}`); the synced draw (readPixels finish) is an upper bound.

| Size | Buffer | Marks | Engine frame interval, median / p95 | Busy | GPU timer | Synced draw | CPU submit | Governor |
|---|---|---|---|---|---|---|---|---|
| Phone 390×844 @3 | 1170×2532 RGBA16F | 8,000 | 16.7 / 18.5 ms | 16.6 / 18.4 ms | **4.84 / 8.82 ms** | 5.8 / 6.1 ms | 0.1 / 0.2 ms | level 0 (DPR 3) |
| Desktop 1440×900 @2 | 2880×1800 RGBA16F | 16,000 | 16.7 / 18.4 ms | 16.6 / 18.3 ms | **7.90 / 14.54 ms** | 8.9 / 9.5 ms | 0.1 / 0.3 ms | level 0 (DPR 2) |

In the real app (raw rAF, brain live) the frame interval is 16.7 / 18.4 ms on phone login, 16.6 / 18.4 ms on phone home, 16.6 / 18.3 ms on desktop login and 16.6 / 18.4 ms on desktop home. The particle build takes about 170–240 ms of CPU on desktop and 70–115 ms on phone in Node on this Mac. It runs once per device class. The higher values were taken while the machine sat at a load average of about 100 from other processes.

**Checks:**
- `npm test`: 723 / 723 pass. That includes `tests/depth-scene.test.mjs` (20) and `tests/interact.test.mjs` (6).
- `npm run check`: passes (369 modules, source hashes match).
- `node work/design-verify/contrast-designs.mjs`: "All pairs with a floor pass".
- The new eyebrow token, computed separately: `#78F2D5` is 15.46 on the void and 13.56 on the ledger backing; the day value `#0E6B59` is 6.43 on white and 5.39 on the backing.

## 6. Honest caveats

- **No real iPhone was measured.** An iPhone GPU is several times weaker than an M-series GPU. On a real phone the governor would step to DPR 2.55 and then 2.16 if frames fall behind. The desktop GPU p95 of 14.5 ms was taken while other agents' Chromes shared the GPU.
- **The contrast script is stale for the depth night eyebrow.** `contrast-designs.mjs` hardcodes depth's pairs. It still checks `--spark #F1C40F` (still valid, because `--spark` remains the status colour for "due soon" and "needs info") but it has no row for the new `--eyebrow`. The ratios above were computed by hand. That script is not in this package.
- **Portal eye layout.** On «ملخصي» the count's `<b>` sits near the top of the eye box, so it lands on the upper edge of the soft window. The eye's layout is `signature.mjs` and `journey` territory.
- **Particle build cost.** The build is about 2× Direction A's (a richer SDF). It is still one-off, but on a slow phone it is roughly 150–250 ms of main-thread work at first mount.
- **The server appearance overrides localStorage.** The light-theme screenshot of the real app could not be taken with a localStorage override, because the server's appearance wins. Paper rendering was checked in the harness instead.
