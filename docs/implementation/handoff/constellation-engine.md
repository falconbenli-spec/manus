# Constellation engine: Dala-grade rebuild of `depth-scene.mjs`

Date: 2026-09-19.

Status: **built locally and tested locally**. It has not been accepted by the owner. It has not been seen inside the real app, because a parallel agent was rewriting `depth.css` at the time. Reference study and acceptance criteria: `docs/product/design/DALA-REFERENCE-NOTES.md`.

## Files

- `app/static/depth-scene.mjs` — rewritten renderer (≈ 40 KB, zero dependencies, shaders are string literals, CSP-safe).
- `tests/depth-scene.test.mjs` — rewritten (16 tests).
- `docs/product/design/DALA-REFERENCE-NOTES.md` — new.
- `work/design-verify/constellation/` — throwaway verification harness, not part of the app:
  - `index.html` and `page.mjs`: a black page with the brand tokens copied from `signature.css`;
  - `server.mjs`: a read-only static server on port 3640;
  - `shoot.mjs`: headless Chromium with GPU over DevTools, on port 9477; it refuses to start if the port is taken;
  - `shots/*.png`.

Not touched: `depth.css`, `signature.*`, `motion-cards.mjs`, `.env`, migrations. Nothing was committed or pushed.

## API (unchanged)

`mountDepth(canvas,{view,reduced})` → `{ok,setScene,setData,setExclusions,dim,pulse,pause,resume,destroy,enableTilt}`.

If WebGL is missing or a shader fails, it returns `ok:false` with callable no-ops.

Two changes from the previous engine:

- WebGL1 now mounts without `ANGLE_instanced_arrays`, because point sprites need no extension.
- `parseColor` and `mat4` keep their semantics. `mat4.rotation` was added.

## How it draws

Each particle is one `GL_POINTS` sprite. The fragment shader measures the distance to the 12 edges of a comma prism:

- the front quad and the back quad (the brand `COMMA`, 1.373:1);
- 4 connectors between them.

It draws those edges as an anti-aliased stroke of ≈ 1.5 CSS px with a small Gaussian glow, blended additively. On a light canvas it switches to normal blending, darker colours and no glow.

Each particle has a slowly animating yaw and pitch. They are applied as `Ry·Rx`, so the comma's x-axis stays horizontal and the slant never rolls. Under 5 device px wide, the particle is the half-comma triangle.

Size and brightness follow true perspective:

- near particles are bigger and brighter;
- back-side particles are dimmer;
- particles fade out near the camera.

Everything is one draw call for the constellation plus one for the ambient field.

## Forms

The builders are pure and deterministic, and they run in Node.

`buildParticles({count,seed})` gives every particle one unit direction: Fibonacci-even for the shell, uniform for the rest. It also assigns:

- one role: shell 12 %, sub-shell 6 %, core 52 % (tiny, dim texture) or halo 30 % (fuzz);
- one size;
- one colour.

The same direction places the particle in all four forms, so colour regions stay coherent as particles fly between them. The forms are:

- `sculpture` — an fbm-displaced, domed, lobed shell with a soft groove. It is organic, not the logo.
- `globe` — a clean sphere.
- `ring` — an area-uniform torus.
- `dust` — a swirled galaxy with a dense core, big enough for the camera to sit inside.

Storage order is a hash permutation, so the governor's tiers draw a uniform subsample.

Colour works like this:

- The region noise is ranked and assigned in bands, which gives exact shares: turquoise 30 / deep 14 / spark 9 / congrats 5 / blue 9 / pink 7 / sky 12 / white 14.
- The rim is lit in the shader from the form normal against the view direction. It turns silhouette particles to `--spark` (68 %) or `--occasion-congrats`. With `late`, congrats is replaced by `--stop`.
- Colours are read from CSS tokens at runtime: `--brand-turquoise`, `--brand-turquoise-deep`, `--spark`, `--occasion-congrats`, `--occasion-baby-boy`, `--occasion-baby-girl`, `--brand-sky`, `--stop` and `--canvas`, plus white.
- The only hex literal is the turquoise fallback.

`ambientField` holds 1.2 % extra particles in view space. They are large and faint, and they drift across the whole viewport in every scene.

## Scenes

| scene | form | seat | notes |
|---|---|---|---|
| login | sculpture | box `{cx,cy,R}` from `--ring-x/-y/-r`, R×0.8 (no box: 30 % width RTL / 70 % LTR) | yaw 0.075 rad/s; one intro per session (`36t-depth-intro`): dust assembles in 2.5 s |
| home | ring | `.sig-eye` box, R×1.7 (no box: left quarter) | elevation 30°, progress ink law on the 300° arc, gap closes with `closed` |
| index | globe | the index box, R×1.12 | yaw 0.04 rad/s |
| off | dust | whole viewport | dim 0.25, yaw 0.008 rad/s, 55 % of the count, 30 fps, stops after 20 s idle (8 s phone) |

A scene change runs two things together:

- a 1.4 s camera tween;
- a 1.4 s per-particle staggered morph with a fly-out arc.

If a morph is interrupted, the engine snapshots positions on the CPU and uploads them, so the next morph starts from where the particles are.

Motion:

- **Rotation and drift:** slow rotation plus a small pitch sway; breathing of ±1.2 %; curl-like drift.
- **Pointer:** parallax, lerped, and a local repulsion of radius 0.24 in NDC.
- **Tilt:** device tilt through `enableTilt`.
- **Pulse:** `pulse()` is a 700 ms camera dolly.

## Budgets and lifecycle

- **Particle count:** 26,000 on desktop and 9,000 on phones (`countFor`).
- **Pixel density:** DPR is capped at 1.5 on desktop and 1.25 on phones.
- **Frame governor:** 30 slow frames out of 60 drops the count to 60 %, then 30 %, then freezes on a static frame.
- **Frame rate:** capped at 60 fps, and at 30 fps after 15 s without input.
- **Idle:** the loop stops after 60 s on desktop and 12 s on phones. The last frame stays on screen.
- **Hidden or off-screen:** a hidden tab or an off-screen canvas stops the loop.
- **Context loss:** the context is rebuilt on restore.
- **Reduced motion:** `prefers-reduced-motion`, `data-motion=off` and pause each draw one settled frame and start no loop.
- **Exclusion rects:** these now dim particles to 30 % instead of cutting holes, so the sculpture reads as one form behind text, as in Dala.

## Verification

Headless Chromium 1234 with `--use-angle=metal --enable-gpu`, 1440×900 at DPR 2 (canvas 2160×1350 after the cap), 26,000 particles plus 312 ambient. rAF deltas over 3 s:

| scene | median | p95 | max |
|---|---|---|---|
| login | 16.7 ms | 18.3 ms | 18.7 ms |
| home | 16.7 ms | 18.2 ms | 18.7 ms |
| index | 16.7 ms | 18.2 ms | 18.7 ms |
| off | 16.7 ms | 18.6 ms | 18.6 ms |
| phone 390×844 DPR 3 (9,000) | 16.7 ms | 18.4 ms | 18.8 ms |

The deltas are vsync-bound. They show no dropped frames, but they do not show GPU headroom.

Screenshots are in `work/design-verify/constellation/shots/`:

| Screenshots | What they show |
|---|---|
| 01, 02 | login at two times (rotation) |
| 03 | pointer repulsion |
| 04 | home ring |
| 05 | index globe |
| 06 | off dust |
| 07–09b | intro assembly |
| 10–13 | dissolve into dust, then re-form into the globe |
| 14 | LTR mirror |
| 15 | phone |

Tests:

- `node --test tests/depth-scene.test.mjs`: 16 of 16 pass.
- `npm test`: 702 of 702 pass.
- `npm run check`: passes.

## Open issues

- **Not seen in the real app yet.** It still needs a pass with the new `depth.css`, the veil, the real login copy and the exclusion rects.
- **Login size:** the login sculpture is ≈ 70 % of viewport height. That matches the reference (≈ 72 %), not the brief's ~90 %. The seat uses `--ring-r` × 0.8; raise the `grow` value in `SCENES.login` if the owner wants it bigger.
- **Phone density:** the phone login form is dense (9 k particles inside the 190 px `--ring-r` box) and reads brighter than the desktop version. It may need a lower phone count or dimmer shell alpha once it is viewed on a real device.
- **Colour mix:** no violet in the brand palette, so the result is more turquoise and white than Dala's violet and amber. Blue and pink patches are present but quieter. The ≈ 30 % yellow/orange target depends on the rim and was judged by eye, not measured.
- **Dust brightness:** the intro's first ≈ 0.5 s shows the dust core bright near the login camera.
- **Build cost:** `buildParticles` takes ≈ 160 ms for 26 k particles on this Mac, once per device class, on the main thread. Expect several times longer on low-end phones.
- **Real devices:** real iOS and Android have not been measured.

## Refinement round 1 (after the integration captures)

Inputs: the coordinator's real-app captures `c5-login.png`, `c1-home.png`, `c2-portal.png` and `c4-phone-home.png` (1440×900 at DPR 2), compared against reference frames f00, f03 and f10.

Shots are in `work/design-verify/constellation/shots/`:

- `before/` holds the pre-refinement set.
- `after/` holds the new set:
  - 01–03: login at 2, 10 and 16 s;
  - 04: pointer;
  - 05: home;
  - 06: index;
  - 07: off;
  - 08–14: intro, dissolve and re-form;
  - 15: LTR;
  - 16–17: phone;
  - 18–19: the exclusion rects drawn as red outlines, for checking.

The verify page now sends exclusion rects measured from the coordinator's captures.

| Issue | Change |
|---|---|
| 1 Too dense and blowing out | Shell 12→8 %, sub-shell 6→4 %, halo 30→36 % (fuzz, tiny); shell size 0.85–1.2→0.9–1.22. The drawn count scales with the seat's screen area (full count at radius 0.35×viewport height; smaller seats draw a uniform subsample). Screen blending replaces additive (`ONE, ONE_MINUS_SRC_COLOR`), so overlaps saturate softly and never clip to white. The rim band is narrowed (smoothstep 0.7–0.94 on a true normal) and brighter. |
| 2 Weak 3D | The sculpture is rebuilt as a brain-like form: long front-to-back axis, a deep groove between two hemispheres, temporal lobes low at the sides with a notch above them, a back lobe and a notch above it, a frontal dome, a flattened base, and folds from ridged noise. The rim uses **true surface normals** of the displaced shell, precomputed per particle, uploaded as `aNA`/`aNB` and blended through morphs. Back hemisphere alpha is ×0.14 against front ×1.2. The camera is raised to 20° elevation with fov 38; yaw is 0.075→0.11 rad/s (≈ 6.3°/s). |
| 3 Overlaps the text | Login seat: the scale is `--ring-r`×0.7 (was 0.8), and the engine reads the login exclusion rects. It shrinks and shifts the form so that its right edge (half-width 1.45 R) stays ≥ 40 px clear of the text column (mirrored in LTR). Measured: 0 bright pixels inside the text rects (before: 38,396). The sculpture's rightmost bright pixel is x = 756 against text at 820. |
| 4 Heavy ambient | Count 1.2 %→0.6 % (156 on desktop). Sizes are capped; 1 in 32 is a big one, placed at mid-depth (3–6 on screen). Particles fade to **0** inside exclusion rects (40 px feather; was a 30 % floor). |
| 5 Home ring | The density fix applies (the ring seat draws ≈ 64 % of the set). The hole is excluded automatically: a rect at the `.sig-eye` centre of 1.24R × 0.9R. Measured: 0 bright pixels in the home text rects (before: 31,182); the count label area is empty. |
| 6 Phone | The phone density reference is a 170 px radius (home ring ≈ 36 % of 9 k, login ≈ 60 %). Global phone dim is ×0.8. The portrait crown clamp keeps the sculpture fully on screen. |

Frame time after the refinement, 1440×900 at DPR 2:

- **With vsync:** median 16.7 ms and p95 18.4–18.6 ms in every scene; phone the same.
- **With vsync disabled** (`--disable-gpu-vsync --disable-frame-rate-limit`): the rAF interval median is 11.0 ms on login, 11.5 on home and 8.5 on index, including frames where the engine draws. So drawing plus compositing fits well inside 16.7 ms.
- These are indirect measures: GPU timer queries are not available in Chrome.

Tests:

- `node --test tests/depth-scene.test.mjs`: 17 of 17 pass. New tests cover the brain groove, outward unit normals, rare big ambient commas, fade-to-zero in the shader, the login 40 px text clearance, the home hole rect, and density that scales with the seat.
- `npm test`: 703 of 703 pass.
- `npm run check`: passes.

Still open:

- Not re-checked in the real app. The verify page approximates the login and home rects from the captures; real `signature.mjs` rects will differ slightly.
- The engine re-seats on every `setExclusions` call, and the seat **snaps** rather than tweens when no scene tween is running. `signature.mjs` calls `setExclusions` right after `setScene`, so this is invisible at mount. A late rect change (for example a font swap moving the headline) would show as a small jump.
