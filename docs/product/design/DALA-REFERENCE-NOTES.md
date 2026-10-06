# Dala reference — measured notes and acceptance criteria for the constellation

Source: a 42.5 s, 60 fps, 1600×1000 screen recording of the Dala site (owner's reference), studied frame by frame
(16 evenly spaced frames plus 11 extra frames at 0.2 / 0.6 / 1.0 / 2.6 / 4.0 / 5.5 / 15.5 / 16.3 / 20.5 / 25.8 / 26.3 s), and the
style spec `DESIGN.md` that came with it. Measurements are in recording pixels (≈ CSS px at 1600 wide) unless noted. They are
estimates read off still frames, not instrumented numbers.

## What the reference is

| Aspect | Observation |
|---|---|
| Particle | A small **wireframe tetrahedron**: every edge drawn as a ~1.5–2 px bright line, inner edges visible, no fill. Additive: overlaps get brighter. Orientation is **coherent**: most particles point the same way, with small variation. It is not random-rotation confetti. |
| On-screen size | Shell particles on the form's face measure 10–16 px. Back-side and interior particles measure 3–6 px. A few foreground particles measure 20–30 px. Ambient particles measure 8–80 px, and the largest look defocused. |
| Form | A volumetric organic shape: the brain on the hero, then a lightbulb, then a globe. The **shell is dense**. There is an interior of tiny, dim specks that gives the form texture. The silhouette looks denser because the shell is seen edge-on. |
| Size and seat | The hero brain is ≈ 56 % of the viewport wide and ≈ 72 % tall. It sits in the half of the page opposite the headline and is centred vertically. Later forms are bigger, with the camera close enough to crop them. |
| Density | Face-on particle spacing is ≈ 18–22 px with front and back layers overlaid, so gaps are about one particle wide and each particle stays readable. Estimate: 3–6 k bright shell particles plus a much larger population of faint interior specks. |
| Colour | Colour sits in **coherent regions** like continents (violet, amber, teal, white and blue patches). It is not per-particle random. The **silhouette rim is bright amber/yellow**. The overall mix is dominated by violet, amber and teal, with white patches on the face. |
| Ambient | Sparse particles across the whole page at low opacity (≈ 0.2–0.5), roughly 60–150 visible per viewport. A few are large and near the camera. |
| Motion | Slow continuous rotation of the whole form (≈ 5–7°/s yaw in the first 3 s), small per-particle jitter, and slow ambient drift. |
| Morph | On scroll the brain **dissolves** into a galaxy-like dust (dense core, sparse outskirts) that the camera flies through. The dust then **re-forms** into the next shape (lightbulb, then globe). Particles fly individually, with staggered timing. |
| Background | Pure black. No gradients, no vignette. |

## 3,6T translation (owner's direction)

The Dala look is kept, with brand particles and brand colours:

- The particle is the 3,6T comma (`COMMA=[[.372,0],[1,0],[.539,1],[0,1]]`, 1.373:1) as a **3D wireframe prism**: front quad, back quad and 4 connectors, for 12 edges in total.
- The comma only yaws and pitches. Its horizontal edges stay horizontal, so the brand slant never rolls in-plane (DESIGN-SPEC §4.1).
- Below 5 px wide, the particle is the half-comma triangle.
- Violet is replaced by turquoise, and Dala's amber by `--spark` and `--occasion-congrats`. The palette also uses sky, white, `--occasion-baby-boy` and `--occasion-baby-girl`. Every colour is read from CSS tokens at runtime.
- The forms are:
  - login: **sculpture**, an organic lobed "360 globe" and the brand analog of the brain, never the wordmark;
  - home: **ring**, a thick torus «360»;
  - index: **globe**;
  - work screens: **dust**.

## Why point sprites and not instanced line meshes

Each particle is one `GL_POINTS` sprite. Its fragment shader measures the distance to the prism's 12 edge segments and draws an anti-aliased stroke of about 1.5 CSS px with a small glow.

- **Cost and quality:** one vertex per particle, and every line is anti-aliased at any DPR. Instanced `GL_LINES` would be 1 px aliased lines on most drivers.
- **Brand rules:** the half-comma LOD and the no-roll rule are enforced in the same shader.
- **Compatibility:** it works on WebGL1 without extensions.
- **Trade-off:** fragment cost grows with sprite area. The sprite is sized to the prism's projected bound plus the glow margin, and it is capped at the driver's point-size limit.

## Acceptance criteria

These are checked against the headless-GPU screenshots in `work/design-verify/constellation/shots/`.

| # | Criterion | Target (reference-derived) |
|---|---|---|
| A1 | Login form size and seat | Form height 65–80 % of viewport height; centre at 30–36 % of width (RTL; mirrored in LTR); vertically ~40–50 % |
| A2 | Particle count | Desktop 24–30 k plus ambient; phone 8–10 k |
| A3 | Size distribution | Face shell 8–14 CSS px wide; interior/back 2–6 px; 1–2 % foreground at 1.5–2.3× size; ambient up to ≈ 40–60 CSS px |
| A4 | Stroke | 1.2–1.6 CSS px anti-aliased line, additive, slight glow; wireframe (no fill) with visible inner edges |
| A5 | Density | Particles separately readable on the face (visible gaps ≈ one particle); denser toward the silhouette |
| A6 | Colour regions | Nearest-neighbour colour agreement ≥ 2.5× chance (coherent patches) |
| A7 | Rim | Silhouette band predominantly `--spark`/`--occasion-congrats` |
| A8 | Global colour mix | Turquoise family ≈ 40 %, yellow/orange ≈ 30 % (mostly rim), sky/white ≈ 18 %, blue/pink ≈ 12 % |
| A9 | Ambient | Sparse (≈ 1–3 % of the count), low alpha, a few large near ones, drifting across the whole viewport in every scene |
| A10 | Motion | Continuous yaw of 3–7°/s, breathing, per-particle drift, pointer parallax plus local repulsion |
| A11 | Morph | Dissolve and re-form with per-particle stagger in ~1.4 s; intro assembles from dust in ~2.5 s |
| A12 | Background | Pure black; the engine paints nothing but particles |
| A13 | Frame time | Median rAF delta ≤ 16.7 ms at 1440×900 DPR 2 with the full desktop count (Apple Silicon, headless Chromium with GPU) |
