# depth-b — the WebGL «الحلقة» engine (`depth-scene.mjs`)

Date: 2026-09-19. This is a drop-in alternative to `mountBackdrop` in `motion-cards.mjs`. It is written from scratch, has zero dependencies and is a single ES module.

## Files touched

- `app/static/depth-scene.mjs` (new, about 33 KB). Shaders are string literals inside the module, so it fits the CSP (`script-src 'self'`). It uses no blob: or data: URLs, no workers, no fetches and no textures.
- `tests/depth-scene.test.mjs` (new, 14 tests).
- `app/server.mjs`: only the asset whitelist changed. Three lines add `/depth-scene.mjs` (text/javascript), `/depth.css` (text/css) and `/classic.css` (text/css, added at the coordinator's request).
- `work/design-verify/depth/` (throwaway): `server.mjs`, `index.html`, `page.css`, `page.mjs`. This is a port-3620 static page used to look at the scene on a real GPU. It is not part of the app.
- This file.

Nothing else was edited: not app.mjs, signature.*, preferences, hr-design.css, depth.css, index.html or `.env`. Nothing was committed or pushed.

## API

```js
import { mountDepth } from './depth-scene.mjs';
const engine = mountDepth(canvas, { view = globalThis, reduced = false });
engine.ok            // false → no WebGL2, and no WebGL1 with ANGLE_instanced_arrays, or a shader failed: fall back to mountBackdrop
engine.setScene(name, { cx, cy, R, mirror }?)  // 'login' | 'home' | 'index' | anything else = 'off'; ~900 ms camera+formation tween (400 ms if same scene)
engine.setData({ progress, closed, late })     // ink law head (0..1), close the 60° gap, swap the 3% slot to --stop. `pending` is accepted and ignored
engine.setExclusions([{ x, y, w, h }])         // CSS px relative to the canvas; up to 6; particles fade to 0 inside, 48 px feather
engine.dim(v)        // 0..1, 200 ms fade
engine.pulse()       // 700 ms camera dolly push (sin² bump, 8.5%)
engine.pause() / engine.resume()
engine.enableTilt()  // Promise<boolean>; bind it to the first tap. On iOS it calls DeviceOrientationEvent.requestPermission() inside that gesture
engine.destroy()     // cancels rAF, removes every listener and observer, deletes buffers/programs, zeroes the canvas
```

The key set is exactly the eight `mountBackdrop` methods plus `ok` and `enableTilt`. When `ok` is false, all nine methods are harmless no-ops (tested). The geometry box works the same way as in the 2D engine. `(cx, cy)` becomes an NDC lens shift, and `R` sets camera distance so that the ring's outer radius is `R` CSS px. `mirror: true` (for `dir=ltr`) reverses the ink direction. With no box, the defaults come from `sceneTarget`. On portrait screens without a box, the camera backs off so the ring fits the width and lifts it, like the 2D horizon.

Pure exports for Node: `commaMesh`, `commaOutline`, `torusLattice`, `sceneTarget`, `SCENE_NAMES`, `countFor`, `parseColor`, `mat4`, `SHADERS`.

## What it draws

- **Particle.** It is the brand COMMA quad `[.372,0] [1,0] [.539,1] [0,1]` in its 1.373:1 box, the same shape the `commaField` mask uses. It is extruded with depth 0.3 and a 0.04 bevel. The wide top corners are rounded slightly (r .08), and the narrow bottom corners less (r .045). At 3 segments it has 130 vertices and 128 triangles; on coarse pointers it uses 2 segments. The solid is convex, so back-face culling alone gives correct self-occlusion, and the context is created with `depth:false`.
  - **Deliberate deviation.** The brief said "circle head + tapering tail". The design spec (§4.1) and the logo SVG both define the comma as this slanted quad, so I kept the brand shape. It already tapers from a 0.862-wide head to a 0.74-wide tail. `commaOutline({head, tail})` changes the rounding if the owner wants something softer.
- **Slant.** Each comma is billboarded in view space and only yaws and pitches: a slow wobble of ±0.25–0.45 rad plus pointer lean. There is no roll term anywhere, so the on-screen slant is always the logo's slant.
- **Formation (`torusLattice`).** Per instance it stores `x y z scale colour phase`. `phase` is kind plus fract, where kind is 0 band, 1 halo or 2 drifter. The mix is about 80% band, 13% halo and 7% drifters, and the total is always exactly `count`:
  - The band is an orthogonal lattice in (angle × radial × height) at the brand pitch ratio 1:1.13, masked to an elliptical tube. The ring's outer edge is 1.
  - The halo is two thin outer rows.
  - Drifters sit on a flattened shell at 1.45–2.55× the ring.
  - A deterministic hash sets colour to 77/10/10/3. At 8000 it measures 77.35 / 9.54 / 10.49 / 2.63%.
  - Scattered start positions (a sphere of radius 2.1) go in a second instanced buffer.
- **Ink law, as in 2D.** Twelve o'clock is the far side. Ink runs anticlockwise over 300° as `k = t≤p ? 1 : max(.15, 1−1.06(t−p)/(1−p))`. The 60° gap is hidden until `closed`, then drawn at 0.15. Size is `0.45+0.55k` and alpha is `k`. The whole figure turns rigidly, so the gap turns with it.
- **Rendering.**
  - One `drawElementsInstanced` for all commas (`drawElementsInstancedANGLE` on WebGL1).
  - Before it, one `drawArrays(POINTS)` of 64 soft bokeh sprites (28 on phones).
  - Premultiplied alpha, `blendFunc(ONE, ONE_MINUS_SRC_ALPHA)`, transparent clear, so the CSS ground shows.
- **Fragment shading.**
  - Wrap-lambert key light plus a fresnel rim in a turquoise derived from `--ring-a`. The rim is lightened on dark canvases and deepened on light ones.
  - A small specular term.
  - Exponential-squared depth fog toward `--canvas`, which also lowers alpha.
  - Depth-of-field alpha (up to −55% away from the focus distance).
  - Near particles lower their output alpha, which makes them additive-ish. This only applies on dark canvases.
  - Exclusion rectangles are tested against `gl_FragCoord`.
- **Colour.** `--ring-a..d`, `--stop` and `--canvas` are read through `getComputedStyle(documentElement)` and parsed from hex (3/4/6/8 digits), `rgb()`/`rgba()` (comma or space syntax) or `color(srgb …)`. The fallback is #16A085. Colours are re-read when `html` `data-theme`, `data-design` or `data-motion` change (MutationObserver) and when `setData` flips `late`. A canvas whose luminance is above 0.5 switches on light mode.

### Uniforms

Comma VS: `uView uProj uShift uLean uTime uOrbit uOrbitSlow uMorph uFlatten uProgress uClosed uInkMix uMirror uDim uFocus uWobble uColors[4]`
Comma FS: `uCanvas uRim uLightTheme uFogStart uFogK uRects[6] uRectN uFeather`
Dust: `uView uProj uShift uOrbit uTime uPx uMaxPt uDim uCol uLightTheme`

No uniform is declared in both stages of the same program, so there are no precision-mismatch link errors.

### Scenes (`sceneTarget`)

| scene | dist | elev | fov | spin rad/s | camera sway | flatten | ink law | dim |
|---|---|---|---|---|---|---|---|---|
| login | 2.6 (close) | 62° | 40 | .03 | .06 | 1 | 1 | 1 |
| home | 3.5 | 38° | 36 | .012 | .22 (slow orbit) | 1 | 1 | .92 |
| index | 4.8 (pulled back) | 11° | 34 | .006 | .05 | .3 (orbit plane) | .35 | .7 |
| off | 7.5 (far) | 30° | 34 | 0 (frozen) | 0 | 1 | 1 | .15 |

On the first `login` of a session (`sessionStorage['36t-depth-intro']`), particles start scattered and converge over 2.8 s. The convergence sweeps from the head, with a spiral swirl while they are in flight. After that, a scene change is a 900 ms ease of camera and formation.

## Performance

- **Counts (`countFor`).**
  - Desktop: 8000, then 4800 at tier 1, then 2400 at tier 2.
  - Phone (`(pointer: coarse)` or width < 760): 2500, then 1500, then 750.
  - Tier 3 returns 0, which means frozen.
- **DPR cap.** 1.5 on desktop and 1.25 on phones (the test checks both). MSAA is on only for fine pointers.
- **Governor.** It measures the interval between drawn frames. If 30 of the last 60 frames are slow (over 22 ms on desktop, over 40 ms on phones), it drops a tier. After tier 2 it freezes into a static frame of the settled formation.
  - The 40 ms phone threshold copies `motion-cards`. Without it, iOS Low Power Mode's 30 fps cap would freeze every phone. Change it if the owner wants a strict 22 ms everywhere.
- **Frame cap.** Frames are capped at about 60 fps on high-refresh screens.
- **The loop stops when:**
  - `document.hidden` is true;
  - an IntersectionObserver reports the canvas off-screen;
  - scene `off` has settled;
  - it is idle (12 s on phones, 60 s on desktop, with no pointer, scroll, tilt, scene change or pulse) and nothing is animating. The last frame stays on screen.
- **Context loss.** On `webglcontextlost`, `preventDefault` is called and the loop halts. On restore, the programs and buffers are rebuilt and the scene redraws.
- **Resize.** A ResizeObserver resizes the backing store and redraws immediately.
- **Reduced motion.** The engine renders one static settled frame (time 0, no parallax, no intro) when any of these is set: the `reduced` flag, `prefers-reduced-motion`, `html[data-motion=off]`, `localStorage['36t-motion-paused']`, or `pause()`. It re-renders that frame on resize, on theme or token change, and on a media-query change.
- **No per-frame allocations.** Matrices and the rect buffer are reused.

## Verification

- `node --check` on the new module, the test file and server.mjs: OK.
- `node --test tests/depth-scene.test.mjs`: **14/14 pass**. Covered:
  - mesh indices, unit normals, non-degenerate CCW-from-outside triangles, and brand slant and proportions;
  - determinism, exact counts, colour mix within ±2%, and band/halo/drifter placement;
  - count tiers and the four scenes; colour parsing; mat4 helpers;
  - `ok:false` for six broken canvases;
  - WebGL1 without the instancing extension gives `ok:false`, and WebGL1 with it draws through ANGLE;
  - a recorded-call WebGL2 Proxy stub for mount, animate, scene changes, data, exclusions, pause/resume, `off` stopping, and destroy freeing buffers, programs and listeners;
  - reduced motion never loops and redraws on theme change;
  - idle stop and wake, governor 8000 → 4800 → 2400 → freeze, hidden stop and resume.
- `npm test`: **700 tests, 700 pass, 0 fail**.
- `npm run check`: syntax 365 modules, hashes match, traceability 220 / 22.
- **Real GPU (Browser pane, Chrome, ANGLE Metal on an Apple M1), throwaway page on port 3620:**
  - WebGL2 and forced WebGL1 both compile and link with `getError() = 0`.
  - I checked the login, home and index scenes in the dark theme, the light theme (fog fades to white), and a 375×812 phone viewport (backing store 469×1015, so the DPR cap applies).
  - Exclusion feathering, `closed`, `progress`, scene tweens and `off` stopping behaved as described.
  - The commas read as slanted brand quads.
  - Two bugs were found and fixed there:
    1. `atan(y, -0.0)` picked the wrong quadrant on ANGLE/Metal and lit a whole lattice column with head ink.
    2. A governor freeze during the intro left the scatter on screen. Every static frame now settles the formation.

## Not verified (no access, or not measurable here)

- **Frame rate on the actual targets.** The Browser pane was hidden, so the verify page drove frames with a 16 ms timer and faked `document.hidden=false`. That confirms correctness and GPU acceptance, not real rAF timing. Timer-driven WebGL1 at 8000 instances averaged about 17 ms per frame on the M1. Mid-range Android and older iPhones have not been measured, and the phone budget of 2500 × 128 triangles is an estimate.
- **Devices and browsers.** Safari/WebKit (including the iOS `requestPermission` tilt flow), Firefox, and real `webglcontextlost` or restore were not exercised on a GPU; they were only tested with stubs. Pointer and device-tilt parallax were not visually checked.
- **Integration.** Nothing mounts this engine yet. The caller (app.mjs or signature.mjs, owned by other agents) must:
  - try `mountDepth` first and fall back to `mountBackdrop` when `ok` is false;
  - bind `enableTilt()` to the first tap;
  - pass the same `{cx, cy, R, mirror}` boxes it gives the 2D engine.
- **Look-and-feel sign-off** by the owner. The values are tuned by eye on one machine. The parameters worth revisiting are `SCENES` (distances, elevations, spin) and the shader's light and fog constants.
