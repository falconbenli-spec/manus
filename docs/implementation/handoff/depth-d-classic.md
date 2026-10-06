# depth-d — the «الكلاسيكي» design (`data-design=classic`)

Date: 2026-09-19.

## The request

The owner asked to have the earlier Apple-style look back as a design people can choose. It is the look from before VOID 360, shown in his photo of the portal: a grey ground, a macOS-style sidebar with coloured icon tiles, rounded white cards and a dark green primary pill.

The reference is commit **10c745e**. Its CSS is byte-identical to 6a94387, and its navigation DOM already has the grouped sidebar with sub-headings that the photo shows. The old stylesheet is `git show 10c745e:app/static/signature.css`, 939 lines. Its `style.css`, `journey.css` and `athar.css` were empty stubs, and its `hr-design.css` held only the motion rules for the service cards.

## Files touched

- `app/static/classic.css` (new): 1,158 lines, about 119 KB.
- `docs/implementation/handoff/depth-d-classic.md`: this file.

No other file was edited. I made no commit and no push, and I did not touch `.env`, the live database or ports 3600 and 3601. Other agents own the `<link>`, the server whitelist, the picker, `theme-boot.js`, `preferences.mjs` and the layer order on line 1 of `signature.css`. Those were already in place when I verified.

## How the file is built

There are two blocks, and both are screen-only (`@media screen`). Print never sees this design.

1. **`@layer tokens`.** It maps the old palette onto the current token names:
   - `--canvas`, `--ink-1..5`, `--line` and `--line-strong`
   - `--action` = `#0a7560`, the old `--tint-fill`, with `--on-action` = `#fff`
   - `--turn`, `--spark`, `--stop` and `--ok`
   - the scrim, selection, `--select-arrow` (the old grey chevron) and `--logo`

   It also re-enables the legacy aliases that VOID neutralised: `--surface`, `--material*`, `--shadow-*`, `--label*`, `--separator*` and `--tint*`. It adds the old names the ported rules need: `--fill*`, the iOS system colours, the `*-ink` colours, `--r-sm/md/lg/xl` and the `--fs-*` scale.

   The blocks follow the same structure as field and slate:
   - a light base, which covers `light` and `auto` on a light device
   - an `@media (prefers-color-scheme:dark)` block for `[data-theme=auto]`
   - a `[data-theme=dark]` block
   - a `prefers-contrast:more` block

   Every colour selector also carries a `:has(> body > #app > .login)` twin. That twin has specificity 1,3,1, which beats the forced-dark login block (1,2,1). So the classic login follows the chosen mode, as the old one did.

   The file also sets `--ring-live:0` (the engine gets `off` for the home scene), `--siblings-h:0` and `--hero-h:0`, plus the old font stack. The turquoise hex is never written: `#16A085` appears 0 times.
2. **`@layer classic`.** It holds one nested block, `:root[data-design=classic]{ & … }`. Every nested selector starts with an explicit `&`, which works in Safari 16.5+, Chrome 112+ and Firefox 117+. The block does three things:
   - **Turns off the VOID marks** with zero-weight `:where(…)::before/::after{content:none}` lists: the comma masks, row rulers, the counter, the horizon, the giant ghost comma, the INDEX and Esc labels, and the busy strip. Hides `.sig-aurora`, `.sig-depth`, the ring eye, the injected date, greeting and census, the siblings strip, the recent list, the ring frames and the athar canvas.
   - **Ports the old 939-line file section by section** onto the current class names: base, shell, topbar, floating tab capsule, bottom-sheet menu, persistent desktop sidebar, page head, panels, tiles, cards, lists, alerts, badges, buttons, fields, tables, sheets and dialogs, toast, Spotlight palette, rows, journeys and timelines, departments and the request picker, portal, executive, daily work, org, and login.
   - **Handles accessibility:** reduced transparency, reduced motion (the rq-enter cards) and forced colours.

### Working with the `fill` layer

`@layer fill`, the lit action, still outranks `classic`. Instead of fighting it, `.btn` in classic sets the variables that the fill rule reads:

- `--btn-h:44px`
- `--btn-w:auto`
- `--s8:20px` (the fill rule's padding)
- `--fs-table:var(--fs-callout)` (its font size)

The lit action therefore comes out as the old 44px dark green pill. The login button sets `--btn-h:50px` and `--btn-w:100%`.

### What the photo shows, and where it comes from

| In the photo | Where it comes from |
|---|---|
| The coloured iOS-Settings icon tiles | CSS only. `hr-design.mjs` still writes `nav-icon tint-<colour>` on every row. Classic restores `--icon` and `background:var(--icon)`, which VOID had neutralised. |
| The grey active pill | The old desktop rule. |
| The «2» count | The plain grey `.nav-count`. |
| The pale-green 01/02/03 chips | `.journey-stop > span` |
| The large-radius summary tiles with dot, label and number | `.pt-tile` and `.vn-tile` |

## Verification

The browser was run with throwaway servers:

- 10c745e in a `git worktree` under `work/design-verify/old-10c745e`, on port 3622.
- The current tree on port 3623.

Each had its own database, seeded by that commit's own `seed()` into `work/design-verify/*.sqlite`, and a throwaway `FIELD_KEY_PATH`.

Both origins are `127.0.0.1`, and cookies ignore the port, so the two sessions overwrote each other. The current tree was therefore reached through a small local proxy on 3624, opened as `localhost`, which rewrote Host, Origin and Referer.

Each screen was signed in as `hr`. It was compared at 1440×900 and 375×812, in light and dark.

| Screen | Result |
|---|---|
| Login, desktop light | Same layout. The green story panel and the card match. The masthead has no mode button because the current DOM moved design, mode and language into `.login-appearance` under the card, which is styled as tint text buttons. |
| Login, mobile dark | Matches the old iOS dark login. |
| `#portal` (the owner's photo), desktop light | Indistinguishable from the old one apart from the design, mode and language icons at the end of the topbar (see below). |
| `#portal`, dark | Matches. |
| `#portal`, 375 light | Matches, including the floating tab capsule. |
| `#home`, 1440 | Matches the old one once the ring eye was hidden. |
| Bottom-sheet menu, 375 | Matches: the grabber, the profile card, the search, the grouped card with icon tiles and chevrons. The only difference is the label text «الفهرس / إغلاق», which comes from app.mjs. |
| `#employees` (list, cards, tiles), 1440 and 375, light and dark | Matches, including the open card and the chevron placement. |
| `#requests` (filters, empty state) | Matches. |
| `#attendance` (table, pipeline, condensed topbar) | Matches. |
| New-request dialog with the compose form | Matches: the sheet, the grouped fields, the trail and the sticky material action bar. |

The current CSS was re-read after each edit and the page reloaded.

Fixes made during verification:

1. `.page-head > a` also caught `a.sig-eye`. The eye showed as a giant «0» and widened the page to 1476px. It is now excluded, and the eye stays hidden.
2. The tiles inherited `align-items:center` from VOID's grid, which centred the numbers. They are now `stretch`.
3. The card chevron used `grid-area:auto` after `grid-column`, which dropped it to its own row on the phone. It now uses `grid-area:1 / 2`.
4. Filter buttons were shrunk to row-action size. They are back to the 44px `.btn`.
5. `Alexandria` was removed from the font fallback chain so the fallback is exactly the old one. With Alexandria in the chain, Arabic fell to Alexandria before Tahoma.

The scoping was checked by switching `data-design` on a live page between `classic`, `void`, `field` and `depth`. Only classic got the system font, the filled 14px-radius inputs and the `#f2f2f7`/`#000` canvas. The others kept their own values, for example `depth` with canvas `#041311`.

The servers and the proxy were stopped, and `git worktree remove` was run. The verify databases, key, logs and helper scripts were deleted.

## What could not match exactly, and why

1. **The desktop sidebar needs one JS change.** This is the only real blocker.
   - The problem: `signature.mjs` `syncDrawer()` (line 215) sets `side.inert = !open`, `role="dialog"` and `aria-modal`. So the sidebar, which classic makes permanent at ≥1024, is **visible but not clickable** until the index is opened.
   - The CSS fallback in place now: while `.sidebar[inert]` is present, classic shows the avatar button in the topbar again, and dims the inert stage while the index is open. Navigation works, but with an extra click.
   - The fix, in `signature.mjs` (owned elsewhere): when `root.dataset.design==='classic' && !compact()`:
     - `syncDrawer()` should leave `.sidebar` non-inert and drop `role`/`aria-modal` (it is the `aside` landmark), and should not set `inert` on `.stage` or `.sig-tabs`.
     - `openDrawer()` on the desk should only focus `#nav-search` and not add `html.is-menu-open`.
     - It must also re-run on the 1024px media change and on a `data-design` change. The existing `<html>` observer covers the design change.
   - After that, the fallback switches itself off, because it keys on `[inert]`.
2. **The topbar appearance cluster.** `signature.mjs` now injects `.sig-appearance` (design, mode, language) into the topbar. The old topbar had only the title and search. Classic shows it on the desk as three small tint icon buttons and hides it on the phone, where the sheet has the same rows. It is the way back out of classic.
3. **Font.** The old design used the platform font (`-apple-system` / `SF Arabic`, then Segoe UI, then Tahoma). Classic restores that stack and weights 500/600, so on Apple devices it reads as in the photo.
   - The house rule is «Alexandria 400/700 only». No new font file is loaded, but classic does not use Alexandria.
   - If the owner wants Alexandria kept even here, change `--font` and `--font-rounded` in the first tokens block. Weights 500/600 will then resolve to 400/700.
4. **Ring and depth scene.** The old design had no ring. Classic hides the canvases.
   - The home ring gets `off` through `--ring-live:0`.
   - The **login** scene is not gated by `--ring-live` in `signature.mjs`, so the engine still draws into the hidden canvas on the login screen. That wastes CPU but shows nothing.
   - The `.is-threshold` turquoise flash after sign-in is suppressed.
5. **Additions the old design never had** are styled in its idiom, not removed:
   - the `details.sig-more` «المزيد» actions: tint text
   - `#design-menu`: an iOS material popover
   - the phone «record» layout of tables with ≤ 6 columns: kept, with iOS separators and grey labels
   - the request-transparency arc `svg.sig-arc`: hidden
6. **Things dropped because they were VOID behaviour:**
   - the sticky decision bar and the sticky desk panel on request details
   - sticky filters, sticky `th` and sticky open card summaries
   - the `#inbox` 5/7 grid and the `#home` reordering of the board

   Classic restores the old static flow. The request details go back to the old 1.5fr/1fr grid.
7. **Wording.** Text differences come from app.mjs, not from CSS:
   - tab labels: «الرئيسية/ملخصي» instead of «يومي/بوابتي»
   - «الفهرس/إغلاق» instead of «القائمة/تم»

## Tests

`npm test`, with the other agents' in-progress edits present:

```
ℹ tests 700
ℹ pass 700
ℹ fail 0
```

No test reads `classic.css`. The only CSS test (`tests/motion-cards.test.mjs`) reads `hr-design.css`, which I did not touch.
