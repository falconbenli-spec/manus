# depth-C (Dala rewrite): `data-design=depth` CSS

Date: 2026-09-19. I made no commit and no push.

## Why

The owner judged the earlier depth design a failure. It covered everything in frosted glass, borders, a veil, tilted cards and shadows. His reference is the Dala site (`~/Downloads/DESIGN.md` and video frames f00–f15), which looks like this:

- a pure black void
- no panels, borders, shadows or cards
- an oversized headline at weight 400
- light body copy
- one filled pill
- a small amber eyebrow
- a particle constellation filling the other half of the hero

`app/static/depth.css` is rewritten to that look, in the 3,6T identity.

## Files touched

| File | Change |
|---|---|
| `app/static/depth.css` | Rewritten: 467 → 336 lines. The previous version is kept in the scratchpad as `depth.css.before-dala`. |
| `work/design-verify/contrast-designs.mjs` | `depthBlocks()` is replaced by the pairs of the new model. The file header also notes that ratios ignore font weight. |
| This file | New. |

I did not touch `signature.css`, `depth-scene.mjs` (another agent is rewriting it), `signature.mjs`, `server.mjs` or any other file.

## Contracts kept

- **Structure.** The file is `@layer tokens{@media screen{…}}` plus `@layer depth{@media screen{…}}`, and the layer order is still declared on line 1 of signature.css. Every selector is scoped to `:root[data-design=depth]` and applies on screen only. There is one print line, `.sig-depth{display:none}`, and one guard, `:root:not([data-design=depth]) .sig-depth{display:none}`.
- **Specificity of the token blocks** is unchanged:
  - Night is `html:root[data-design=depth]:not(#_)`, which is (1,2,1). It ties the forced-dark login block `:root:has(> body > #app > .login)` and wins by source order.
  - Day is (1,3,1).
  - As a result, the login screen follows the depth tokens in both themes.
- **`--scene-3d:1`** is still set.
- **The scene canvas.** `canvas.sig-depth` is `position:fixed; inset:0; z-index:var(--z-canvas)` with `pointer-events:none`. `#app` has z 1, so the canvas stays below all content. `.sig-aurora` is hidden once `canvas.sig-depth` exists.
- **The index orbit** (`--i`, `--n`, `--orbit`, and the `[style*="--i"]` gate) keeps its geometry. The groups are now bare typographic blocks on black, with no glass, border or shadow. `@property --orbit` is still registered.
- **The phone "eye stage"** (below 760px) is kept. I only removed the old `::before` plate selector from it.
- **Other behaviour kept:** view transitions (now a 200/320 ms fade-and-rise, and a plain fade on the ledger tier), reduced motion, `data-motion=off`, forced colours and print.

## Removed

- The `#app::before` veil and vignette.
- The slab and pane `::before` elements on work screens and heroes, and the hero plate.
- The platters, the `.sig-eye` lens, the login title lens, and the glass chips on `.story-copy p`, `.hr-values` and `.login-footer`.
- Every `backdrop-filter`, including the glass on the top bar, dock, siblings bar, sidebar, dialog, palette, toast and design menu.
- The luminous conic edges, the `--lift-*` shadows and the `--text-depth` text shadow.
- Card tilt and hover `translateZ`, and the `--tilt-x/--tilt-y/--z` registrations.
- The raised 3D buttons, the recessed-well fields and the fog gradients on `<html>`.

## Tokens

Contrast pairs are in the verify script.

- **Night:**
  - Ground: `--canvas:#000`.
  - Inks: `#FFF`, `#EBEBEB`, `#BDBDBD` (Dala's silver mist), `#9A9A9A` (Dala's ash) and `#858585`. The last one is the floor; `#7A7A7A` is only 4.29 on the ledger backing.
  - Hairlines: `--line` is `rgba(255,255,255,.14)`; `--line-strong` is `.45`.
  - Action: `--action` is `var(--brand-turquoise)` with a `#000` label (6.40), the one filled pill.
  - Eyebrow: `--spark:#F1C40F`.
  - `--stop:#FF6B5B`, because `#E74C3C` is only 4.82 on the backing.
  - Particles: `--ring-a..d` are turquoise, brand sky, white and spark.
- **Day:**
  - Ground: `#FFF`. Inks: `#000`, `#262626`, `#4A4E52`, `#5A5F64` and `#5F6469`.
  - The pill is still turquoise with a `#000` label: the fill is 3.28 on white, the label 6.40.
  - `--spark:#7A5C00`, `--turn:#0E6B59`, `--stop:#B03324`.
  - Particles: `--ring-*` use the darker shades turquoise-deep, charcoal, `#0E6B59` and `#7A5C00`.
- **The Dala scale:**
  - `--fs-hero:clamp(48px,7.2vw,113px)`
  - `--lh-hero:1.1` for Arabic; Latin tightens to 1.05 through a `[dir=ltr]` rule
  - `--fs-lede:18px`, `--lh-lede:1.5`
  - `--fs-nav:14px`
  - `--gap-dala:clamp(60px,8vw,120px)`, applied as `--gap-section` on stage screens from 1024px
- **`--depth-back`:**
  - Night: `rgba(0,0,0,.92)`, which is `#141414` over a white particle.
  - Day: `rgba(255,255,255,.92)`, which is `#EBEBEB`.
  - It becomes the solid canvas under reduced transparency and under more contrast.
- **Login sculpture seat:** from 1024px, `--ring-x:25vw` (75vw in LTR), `--ring-y:50vh` and `--ring-r:min(34vh,19vw)`. Phone and tablet values put it at the top of the screen.

## Type

- **Headlines** use `--fs-hero` at weight 400: `.story-copy h1` on login, `.sig-greeting` on home and `.journey-copy h1` on the portal.
  - Arabic has letter-spacing 0. `-0.04em` applies to Latin only, through `[dir=ltr]`.
  - Page titles are one step down: desk and stage use `clamp(36px,…,64px)` and ledger uses `clamp(28px,…,40px)`. Titles with `.is-long` or `.is-xlong` keep their step-down.
- **Body copy** is 18/1.5 at `font-weight:var(--fw-light,400)`. `--fw-light:200` is now defined and served, so it renders as true 200. This applies to the login story line, `.sig-census`, the portal lede, the `.hr-hero`, `.ex-hero` and `.empty` ledes. Their colour is `--ink-2` (17.6:1), so the thin weight keeps a large margin.
- **Quiet copy under 16px** (page descriptions, `.vn-head > p`, `.panel-head p`, the login note and the footer) uses `--fw-stage-body`, which is 300. 200 was too thin at that size.
- **Eyebrows** are 14px, 700, in `--spark`: the login story eyebrow, `.journey-greeting`, and the home/portal `h1`, which is styled as a label. Latin eyebrows are uppercase with `.025em`.
- **Nav** items are 14px, 700, grey, and white when active, with no underline. The `.025em` tracking is Latin only.

## Composition

- **Top bar.** It is transparent with no border and no blur. It turns into the void itself (`--canvas`) only when `.is-condensed` is set. The siblings bar does the same, through `:has(.topbar.is-condensed)`. The dock below 1024px is the void with no top border.
- **Login from 1024px.** Everything sits in grid columns 1 to 6, the right half in RTL:
  - Rows: brand · air · story (eyebrow, headline, body up to 28em) · the card with no panel · air · values · footer.
  - The fields are the bare underlined writing line at 48px.
  - The pill is auto width and 48px tall.
  - The card's intro `<p>` is visually hidden, as it already was on phones. It stays in the accessibility tree.
  - The left half is left empty for the sculpture.
  - `h1.is-long` no longer shrinks the title, because the old ring-eye guard does not apply to this layout.
- **Login on phones.** The sculpture sits at the top, and the story and form follow. At 390×844 it fits in one screen.
- **Home and portal from 1024px.** The hero is a 12-column band with `min-block-size` of about one viewport:
  - The copy takes columns 1 to 6, with a maximum of 560px (600px for the portal).
  - `.sig-eye` is centred in columns 7 to 12, and `--hero-ring-r` is `min(170px,11.5vw,22dvh)`. signature.mjs hands the engine that centre, so the ring grows in the empty half.
  - The home copy order, at every size, is: date · greeting · spark eyebrow (the h1) · census · quiet description.
  - The portal order is: headline · eyebrow · lede · the pill beside a ghost text link.
- **Work screens** show the base's hairline rows on the void, with nothing overridden. The ledger tier and the sensitive routes put `--depth-back` on `#app` with `min-block-size:100dvh`. That covers the whole viewport evenly, so no edge is ever visible.
  - A first attempt put the backing on `#main.page`. It left a visible bottom edge where the dust started again, so I moved it.
- **Floating layers** (dialog, design menu and toast) keep the base void surface and get a `--line` hairline.

## Contrast

`work/design-verify/contrast-designs.mjs` now has four depth blocks:

- the night void `#000`
- the night ledger backing `#141414`
- the day void `#FFF`
- the day ledger backing `#EBEBEB`

They cover the inks, turn, spark, stop, lines, focus, the pill fill and its label for rest, hover and press, the select arrow, the particle colours, condolence and contrast-more. Rejected values (`#7A7A7A` and `#E74C3C` on the backing, a white label on turquoise, and paper `--ink-5` on the day backing) are reported without a floor.

## Checks (literal output)

```
$ node work/design-verify/contrast-designs.mjs
All pairs with a floor pass.
$ node work/design-verify/duplicate-selectors.mjs
selectors parsed: 1694 · defined in more than one file: 35 (of which set the same property twice: 18) · under a named exception: 5
# none of the 35 involve depth.css (grep -c depth.css → 0)
$ npm test
ℹ tests 702
ℹ pass 702
ℹ fail 0
$ npm run check
Syntax checked: 365 JavaScript modules. Source hashes match. Traceability: 220 requirements / 22 domains.
Checks cover syntax, source integrity and traceability. No TypeScript compiler or production bundle is configured for this JavaScript build.
```

**Chrome parse check:** Chrome parsed 112 style rules from depth.css, which matches the 112 in the source, and none came back empty.

## Visual check

**Setup:**

- A throwaway instance on port 3641, built with a copy of the scratchpad `depth-preview.mjs`: a fresh seeded DB in a temp dir, a random password that was never printed, and a session for the synthetic `hr` user.
- Headless Chromium with GPU (ANGLE/Metal) at DPR 2.
- The design and theme were switched through the picker click. The app reported `depth/dark` or `depth/light` for every shot.

**Screenshots** are in `work/design-verify/depth-css/shots/`:

| Screen | Night | Day |
|---|---|---|
| Login | `login-1440-dark.png` · `login-390-dark.png` | `login-1440-light.png` |
| Home | `home-1440-dark.png` · `home-390-dark.png` | `home-1440-light.png` |
| Portal | `portal-1440-dark.png` · `portal-390-dark.png` | — |
| Requests | `requests-1440-dark.png` · `requests-390-dark.png` | — |
| Payroll | `payroll-1440-dark.png` · `payroll-390-dark.png` | `payroll-1440-light.png` |

**Compared with frames f00, f03, f06, f10, f13 and f15:**

- Black void, no panels.
- A huge weight-400 headline, a spark eyebrow, and light 18px body.
- One turquoise pill with a ghost link.
- Transparent nav, grey items, white for the active one.
- The constellation alone in the left half at 1440, and on top on phones.

**Iterations after looking:**

- The home copy margins were zeroed by a more specific rule. I set the margins explicitly.
- The home description kept athar's `min-inline-size:72ch`. I reset it to 0.
- The login column overflowed 900px. I tightened the rows, moved the brand padding to `--s8`, and hid the card intro as phones already do.
- The login lede ran into the sculpture. I capped it at 28em.
- On phones the home hero had a 24px row gap on top of the margins. I set `row-gap:0`.
- The ledger backing showed an edge. I moved it to `#app`.

**Screenshot harness:**

- Each shot runs in its own Chrome process, and any leftover Chrome on the debugging port is killed first.
- A zombie Chrome from a crashed run had kept the port, which gave me a stale page with no cookie. That looked like a login bug but was not one.

**Cleanup:** the server is stopped, and the temp DB directory and token are gone. No Chrome is left running.

## Known, not mine (engine in progress)

- The WebGL scene was being rewritten while I worked. The shots show large outlined prisms, and a near-solid white/turquoise torus on home and portal.
  - Ambient prisms cross the hero copy on phones and the eye's small label (`لا شيء ينتظرك`).
  - The old CSS lens no longer protects that label, by design. The engine's exclusions (the text boxes, which signature.mjs still sends) should keep particles off the words.
- On home and portal, the lists below the hero are stage-tier and have no backing, as the brief asked. If the engine does not thin the dust there, `#app` could take `--depth-back` on `[data-scene=home]` below the hero. That is a one-line change.
- The login sculpture's drawn size is larger than `--ring-r`. At 1440 its edge reaches about 60px into the text half. The lede is capped so it stops before the sculpture, and the headline's full stop just touches it.
- The design name in the picker changed during the run (`كوكبة 360` and `عُمق 360`), and the login card greeting changed as well. That came from other agents' edits, not from CSS.
