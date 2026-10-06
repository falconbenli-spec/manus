# Design integration — packages A–G together (2026-09-18)

Synthetic data only. Throwaway server on 127.0.0.1:3614 with the scratch `verify.sqlite`, plus a scratch cookie helper on 3615; both stopped. Port 3600, `.env`, applied migrations, existing tests and screen modules were not touched. Nothing committed or deployed.

## Files touched

| File | Change |
|---|---|
| `app/static/hr-design.css` | `.page-actions>.btn` gets `background-color:var(--canvas)`. The horizon block (`.page-head::after`, 204×95) and `.page-actions` share the lower end corner by specification; an edged pill («العودة للطلبات») showed the lattice through its label. The `fill` layer still wins for the lit action. |
| `app/static/athar.css` | Below 1024 the home canvas is `max(100%, sticky-top + hero-h + s24)`. `--hero-h` is only a minimum there; at 375 `a.sig-eye` sat at 326–461px and the 348px canvas cut the ring to its top 22px. |
| `app/static/signature.css` | `:where(details:not([class])) > summary:not([class]){padding-block:10px}` (base layer). Bare disclosures from screen modules measured 28px (17 on `#service-benchmark`). |
| `app/static/app.mjs` | (1) the shared `date()` formatter locale `ar-SA-u-ca-gregory` → `ar-SA-u-ca-gregory-nu-latn`: request detail and timeline printed Arabic-Indic digits. (2) the appearance form previews its preselected design as soon as it opens (was: only on a `change` event, G's note for B). No new import. |
| `work/design-verify/duplicate-selectors.mjs` | New. Lists selectors defined in more than one of the five stylesheets, outside the plan's named exceptions. |

## Checks, literal results (final run)

- `node --check` on every changed `.mjs`/`.js`: no error.
- `npm test`: `tests 684 · pass 684 · fail 0 · cancelled 0 · skipped 0 · todo 0`.
- `npm run check`: `Syntax checked: 363 JavaScript modules. Source hashes match. Traceability: 220 requirements / 22 domains.`
- `node work/design-verify/contrast-designs.mjs`: `All pairs with a floor pass.`
- `node work/design-verify/duplicate-selectors.mjs`: `selectors parsed: 1484 · defined in more than one file: 35 (of which set the same property twice: 18) · under a named exception: 5`. All 35 read and classified: A's state map (`--c/--m/--wc` only), A's print layer (`display/visibility`), A's forced-colors painter list (`background-color`), A's `tnum` list, the frozen reduced-motion head of `hr-design.css` (`.rq-enter`, `.rq-dept.is-live`; required by `motion-cards.test`), the kill layer (`*::before/after`), the `field` hero (tokens at A, ground at B, as the addendum says), and `.btn` border in forced colors. No component is shaped in two files.
- `signature.mjs` line 6 imports `mountBackdrop` from `./motion-cards.mjs`; no stub.
- `style="`/`<style`/inline `<script>`/external URL in the redesign's files: none. `.style.setProperty` in `signature.mjs` is CSSOM, which the CSP allows.

## Seen in the browser (screenshots) vs measured only

The Browser pane was hidden for the whole run. Screenshots worked only straight after a viewport resize and stopped working once; `requestAnimationFrame`, CSS transitions and animations do not advance in a hidden pane. So: **no motion was observed at all**, and every colour reading was taken with transitions disabled through a constructable stylesheet.

Screenshots looked at: login 1440 (void dark, void light, field, slate light) and 375 (void dark); home 1440 (void dark/light, field light, slate light) and 375 (void dark, field dark); index scene 1440 and 375; inbox 375; requests list 1440 (slate dark); request detail 1440 and 375; new-request launcher and the long form 1440 (slate light); edit sheet 375; payroll 1440 (void light); employees 1440 (field dark); vendors 1440 (slate light); appearance 1440 and 375, its form, and the locked state; portal 375.

Measured only (overflow, contrast of every visible text node against its composited ground, clipping, targets under 44px), in all six looks: manager 64 routes at 1440 and at 375; launcher, long form, edit sheet, index; login at 375. Result after fixes: no horizontal overflow, no text under its contrast floor, no clipped text. Tables: ≤ 6 columns become the record view at 375; 7–8 columns scroll inside `.table-wrap.is-wide`; sticky `th` at 1440.

Functional, through the real UI on the scratch database: create a request from the launcher, save, open its detail; save a personal design (persists across a real reload, per user: the accountant still got void/dark on the same device); company default + lock by the first admin (manager forced to slate/light, toggle refused with «المظهر موحّد من إدارة المنصة», choose buttons gone); unlock restores the manager's own field/dark; logout returns to login. Console: only the expected 401 from `/api/me` when logged out.

## Not fixed / not verified

- **Motion of any kind** (ring opening, idle, pulse, threshold, login→home, sheet drag, `e-reveal`, `c-fade`): not observed; hidden pane. The frame budget is still unmeasured.
- The home ring in a hidden tab is the opening's first still frame (a partial arc). Whether a visible tab completes it was not seen.
- `app/static/commercial-ui.mjs:73` carries `style="flex-wrap:wrap;justify-content:flex-start"`. Frozen screen module, dated 10 Sep, not part of this redesign; the CSP drops it silently.
- `app/static/delegations-ui.mjs:19` formats dates with `ar-SA-u-ca-gregory` (Arabic-Indic digits). Frozen screen module.
- Size budgets: the five stylesheets total 172,753 bytes against the plan's 101KB; `motion-cards.mjs` 16,619 against 12.5KB. Not trimmed.
- `.sig-siblings` links are 43px tall (44px row minus its 1px line) and `.top-search` is 40px at ≥ 1280 (the spec's own number). Desktop-only rows; left as is.
- The siblings row stays as an empty 44px band on routes outside the index (request detail). Reserved height by specification; left as is.
- The synthetic seed has no wide finance ledger with rows; the widest real tables seen were 8 columns (`#resourcing`) and 7 (`#attendance`).
- Not run: forced-colors, prefers-contrast, prefers-reduced-motion emulation, keyboard Tab walk with visible focus rings, English/`dir=ltr`, Safari/Firefox, 1024 and 1280 widths (B ran those in a harness).
- `STATUS.md` and `docs/traceability.json` not updated (outside the integrator's files).
- The eight `fonts/*.woff2.part` files are still in `app/static/fonts/`, unreferenced, as owner decision 6 leaves them.
