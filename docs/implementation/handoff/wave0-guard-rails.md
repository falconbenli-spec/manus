# الموجة صفر «السور» — Wave 0, the guard rails

Branch `wave0/guard-rails`, created from `integration-20260920` at `43428fb`. Nothing pushed, `.env` untouched, the live database untouched, **no migration added**, zero npm dependencies added.

> The worktree arrived on another lineage (`3f250b1`, 37 commits behind `43428fb` and one ahead). As instructed, nothing was reset: a fresh branch was cut from `43428fb`.

**What this wave is.** The audit's root cause was that nothing in the architecture makes the good version the default — every screen re-decides quality alone. This wave does not rewrite 88 modules. It adds one dictionary, one kit, one refusal standard, and a ratchet that stops each from regressing, then proves the pattern on a handful of daily screens.

**What this wave is not.** It does not migrate the remaining 51 local `tile` copies, the 1,312 short refusals, or the Wave 1 agent's files. Those now have a path of least resistance and a count that can only fall; they are not done.

---

## 1. The numbers, measured the same way before and after

The ratchet's own counters were run against a pristine export of `43428fb` and against this branch.

| Metric | `43428fb` | this branch | how |
|---|---:|---:|---|
| Local primitive definitions in UI files | 128 | **115** | six daily screens now take `tile` from `ctx.ui`; four local status/role dictionaries removed |
| Refusals of ≤ 25 characters in server files | 1,319 | **1,312** | seven daily modules adopted `actorOrRefuse` |
| Status literals outside the vocabulary | 22 | **3** | see §2; the 3 that remain are listed in §8 |
| Unresolved `#view/intent` literals | **1** | **0** | the one was `app/static/module-services.mjs:7 #leave/request` — the dead click |

The last row is the evidence that the link check is not decorative: pointed at the old code, it finds exactly the bug the audit found, and nothing else.

The audit quoted 1,260 short refusals, «الإجراء غير متاح» ×100 and «الحساب غير متاح» ×89. On this base the same counter gives 1,319, ×102 and ×92 — the base is 37 commits newer than the audit. The numbers above are the literal ones.

---

## 2. One phrase per status — the choice and why

`app/static/vocabulary.mjs` — pure, no DOM, no imports; read by the server (`app/my-requests.mjs`, `app/notices.mjs`) and the browser from the same file.

Seven full copies of the eight-status map existed. They agreed on five statuses and disagreed on three.

| Status | Chosen | Rejected | Why |
|---|---|---|---|
| `draft` | مسودة | — | unanimous (7/7) |
| `pending` | **بانتظار الاعتماد** | قيد الاعتماد (6 of 7 maps) | see below |
| `returned` | **معاد للتعديل** | معاد إليك (2 of 7) | «معاد إليك» is second person: true for the requester, false for the approver, the executor and the manager who read the same badge. A dictionary phrase must be viewer-neutral. It also says what is expected (an edit). |
| `approved` | **معتمد** | معتمد بانتظار التنفيذ (1 of 7) | the same label is drawn on each *approval step* in the request's route, where «بانتظار التنفيذ» is wrong. What the request waits for after approval belongs to the «المنتظر» line of «أين طلباتي», which already says it. |
| `in_progress` | قيد التنفيذ | — | unanimous |
| `completed` | مكتمل | — | unanimous |
| `rejected` | مرفوض | — | unanimous |
| `cancelled` | ملغى | — | unanimous |

**`pending` is the one real decision, and it goes against the majority of the seven maps.** Reasons, in order of weight:

1. **Platform-wide it is the majority.** Across `app/` the phrase «بانتظار الاعتماد» appears 41 times and «قيد الاعتماد» 11. The seven request maps were the minority dialect; every module (payment orders, journals, leave, the Today card itself) already says «بانتظار». Choosing «قيد» would have kept two phrases for one idea forever.
2. **It is what the English already says.** All seven maps translate the status as *Awaiting approval*. Only the Arabic disagreed with it.
3. **It tells the requester something.** «بانتظار» says the request is with a person, so it can be followed up. It matches the protected triad «أين هو / ما المنتظر / ما تستطيع».
4. **«قيد» collides with the accounting noun «قيد»** (journal entry) — which is exactly how the phrase the audit flagged came to exist.

**On «قيد بانتظار الاعتماد» — a correction to the audit.** It lives in `journalStatus` in `app/static/statements-ui.mjs`, where «قيد» is the noun *journal entry*: «قيد مسودة», «قيد معتمد بانتظار الترحيل». So it is *ambiguous*, not strictly ungrammatical. It still had to go: in a status badge it reads as a broken hybrid of the two `pending` phrases, and a badge on a journal row has no reason to repeat the row's noun. The journal statuses are now `MODULE_STATUS_MAP.journal` (مسودة / بانتظار الاعتماد / معتمد بانتظار الترحيل / مرحّل / مرفوض), and the phrase is banned by the ratchet.

**`MODULE_STATUS_MAP`** maps each module's own statuses onto the eight and keeps the module's phrase beside it (`canonicalStatus('leave','pending_manager')` → `{status:'pending', name:'بانتظار الاعتماد', module_phrase:'بانتظار المدير'}`). Eleven modules: leave, expense, custody, letter, hr_case, attendance_correction, training, resignation, travel, benefit, journal. The mapping was lifted from the eleven local maps `app/my-requests.mjs` carried; the phrases were taken from each module's own dictionary, and `tests/vocabulary.test.mjs` requires every phrase to appear literally in its module's source, so none can be invented. (That test caught two of my own first-draft phrases.)

**Role names** — six account roles, from the sidebar's wording: موظف، مدير فريق، الموارد البشرية، تقنية المعلومات، مدير مشروع، مسؤول المنصة. Approval-step roles («اعتماد المدير المباشر»…) are a different concept and stay in their modules.

### A latent bug this surfaced

`app/my-requests.mjs` never mapped the leave status `pending_authority` (a real status, eight references in `app/leave.mjs`). A leave waiting for the authority holder showed the raw key `pending_authority` as its unified status in «طلباتي». Adopting `MODULE_STATUS_MAP` fixes it; a test pins it.

---

## 3. The kit — `app/static/kit.mjs`

`kit(e,tr)` → frozen `{tile,row,card,empty,table,pageHead,statusBadge,refusal}`. Built once in `app.mjs` and injected as `ctx.ui` at the single `module.render(...)` call site, so a screen adopts it by adding `ui` to what it destructures — **no import line**.

**What the survey actually found**, because it shaped the design:

- **`tile` is uniform.** 60 of 65 definitions emit the same HTML and differ only in parameter names (`t` / `tone` / `state` / `flag`) and in whether `e` is a parameter or closed over. `kit.tile` is byte-identical to it, *including* `class="vn-tile "` with a trailing space when there is no tone, and an unescaped tone (a class name written by code, never by a user). `tests/kit.test.mjs` evaluates every surviving local copy in a VM and compares outputs over a hostile input matrix; it asserts they collapse to **one** shape once parameter names are normalised.
- **`row` and `card` are not uniform.** They share a *skeleton* (`<li class=tone><strong>…</strong><span>…</span>`, and `<details class="vn-card"><summary><span class="vn-code">…`) with module-specific bodies. The kit captures the skeleton and takes the body as `html` / `body`. It does not pretend they are identical, and no `row`/`card` was migrated in this wave.
- `empty`, `pageHead` and `statusBadge` are byte-identical to `empty`, `pageHead` and `badge` in `app.mjs` (the test extracts those functions from `app.mjs` and runs them).
- **`table({head,rows,empty})`** is byte-identical to the existing `table` helper when there are rows — the structure the mobile table enhancer in `signature.mjs` reads is unchanged — and with no rows it renders an empty state instead of a header over nothing.
- `refusal(error)` draws `error.details.refusal` (what / missing with why and owner / next step / link); a bare message keeps the existing `.error` shape.
- Nothing the kit emits contains `style=`, `<script` or an event attribute (tested) — the CSP holds.

**Naming note for Wave 1.** The plan's verification line «`card()` ترمي خطأ إن أُعطيت رقمًا» is about the *home card builder* (a card takes its list and derives its number). `kit.card` is the folding `vn-card` and is unrelated; the two should not be confused at merge.

### Migrated: six daily screens, zero bytes changed

`my-requests-ui` (طلباتي — also its inlined empty state), `request-transparency-ui` (أين طلباتي + قياس الخدمات), `letters-ui` (both screens), `expenses-ui`, `payroll-ui`, `engagement-ui` (الإعلانات، النبض، التقدير). Golden hashes before and after the migration: **0 of 520 differ.**

Not migrated, deliberately: `inbox-ui.mjs` (13 lines, one `tile`) sits in Wave 1's blast radius, and `home-ui.mjs`'s `tile` is a different thing (a linked card keyed by `cardNames`).

**Tests that render a migrated screen directly must now pass `ui`**, as `app.mjs` does: `ui:kit(e)`. Six call sites and the generic loop in `tests/ui-render.test.mjs` were updated. A screen rendered without it fails loudly (`Cannot destructure property 'tile' of 'ui'`), which is intended.

---

## 4. The refusal standard — `app/refusal.mjs`

`refuse(status, code, {what, missing:[{document,why,owner,owner_role}], next, link})`.

- The message composes as **«what: document — owner؛ next»**. Each missing item is written exactly as `gateMessage` writes it (tested by string equality against `gateMessage` itself). **`gateMessage` is unchanged** (a test pins its source).
- The structured form travels in `error.details.refusal`. `app/server.mjs` already forwards `details` for every sub-500 error, so the serialiser was not touched. `api()` in `app.mjs` now keeps `code` and `details` on the thrown `Error` instead of reducing it to its message.
- **The standard is enforced where the refusal is written.** `refuse()` throws a `TypeError` (a programmer error, not an `AppError`) if there is no `what`, or neither `missing` nor `next`, or a missing item without `document` and `owner`. «الإجراء غير متاح» cannot be expressed through it.

`actorOrRefuse(db,supplied)` replaces the «الحساب غير متاح» idiom. `currentUser` returns nothing when the account is suspended or not in this tenant, so that is what it says, with who re-activates it and what to do. Status `403` and code `forbidden` are unchanged, so the server's `access denied` audit and anything reading the code behave as before. Adopted in **seven** high-traffic daily modules: `my-requests`, `my-profile`, `letters`, `payroll`, `request-timeline`, `engagement`, `search`. The other ~85 occurrences are untouched, as instructed.

**A second latent bug.** The old idiom passed `undefined` into SQLite when no identity was supplied and surfaced as a 500 (`ERR_INVALID_ARG_TYPE`). `actorOrRefuse` refuses it as a 403 with a reason.

---

## 5. No silent dead click

**The instance.** The catalogue card «طلب إجازة» links `#leave/request`. `autoOpen` in `leave-ui.mjs` handled it only when the leave policy was ready; otherwise nothing registered it in `DEEP_LINKS`, and `followDeepLink` returned without a word. It is now registered (`request:{operation:'request',alternate:'create'}`).

**The class.** Three silent paths existed in `app.mjs`, not one:

1. An intent neither `autoOpen` nor `DEEP_LINKS` knows → returned silently. Now states «هذا الرابط لا يفتح نموذجًا في هذه الشاشة…» and returns the URL to the screen. Sub-routed views (`SUBROUTED_VIEWS`: `#request/<id>`, `#departments/<id>`, `#forms/<id>`, `#search/<q>`, `#policy-library/…`) are exempt because their second segment is a record, not an intent.
2. `autoOpen` names a button that is not drawn → `?.click()` swallowed it. Now falls through to `followDeepLink`, which opens the alternate or states the reason.
3. A failure before the form opened was swallowed by an empty `catch{}`. Now stated. (A failure while *prefilling* an already-open form stays silent — the form is in front of the user.)

**The reason is the screen's own.** A module may define `whyUnavailable(intent,data)`. `leave-ui` returns what the server computed (`statutory.missing`), or — with no approved leave-types policy at all — the very sentence the screen prints where the button would be. One constant feeds both, so the toast cannot say something the page does not.

**Home chips.** `quickRow` used to filter away every chip that was not ready. It now renders it disabled (`role="link" aria-disabled="true" tabindex="0"`, no `href`) **with its `reason` shown inside it**. Styling is in `journey.css` with existing design tokens only — no new colour, no inline style.

> **For the Wave 1 agent — `app/home.mjs:119`.** When the employee *has* a balance but lacks `leave.use`, the server sends `ready:false` with an **empty** `reason` (`reason:hasBalance?'':…`). The UI does not leave it blank — it falls back to «هذا النموذج غير متاح لحسابك الآن.» — but the right fix is a real reason from the server. I may not edit that file.

**Acceptance — a new employee, all four routes** (`tests/links.test.mjs`, driven through the real `app.mjs` router in a VM sandbox, and confirmed in a real browser against an in-memory synthetic database):

| Route | Result |
|---|---|
| Home chip | disabled, reason shown: «لا رصيد إجازة متاح لك بعد» |
| `#leave` | the screen opens and states the reason where the button would be |
| Search «إجازة» → `#leave/new` | toast with the screen's reason; URL returns to `#leave` |
| Catalogue card → `#leave/request` | toast with the screen's reason; URL returns to `#leave` (**was: nothing at all**) |

When the form *can* open, every route opens it (tested, including the opening-balance-only case via the `create` alternate).

---

## 6. The ratchet — `scripts/quality-ratchet.mjs`, run by `scripts/check.mjs`

Measured against the committed `scripts/quality-baseline.json`. **Counts may only fall; a new file must score zero** (a file absent from the baseline has a baseline of 0, and counting is per file, so moving a primitive from one file to another fails even though the total is unchanged).

| | Counts | Baseline |
|---|---|---:|
| (a) `primitives` | a renderer defined by name in a UI file — `tile`, `tileOf`, `row`, `card`, `empty`, `table`, `pageHead`, `badge`, `statusBadge` (arrow or `function`) — or a `statusNames` / `roleNames` dictionary. `const row=list.find(…)` is a data variable and is not counted. | **115** in 65 files |
| (b) `short_refusals` | `fail(status,'code','text')` whose literal text is ≤ 25 characters, per server file. A template with `${…}` names something specific and is not counted. | **1,312** in 120 files |
| (c) `status_literals` | the banned phrases — «قيد بانتظار الاعتماد», «معاد إليك», «معتمد بانتظار التنفيذ», and the old «قيد الاعتماد» — plus any local object holding ≥ 6 of the 8 status keys, under any name. | **3** in 2 files |
| (d) `links` | every `#view/intent` literal in `app/static/` must resolve. **Not a ratchet — it must be zero.** | 114 checked, **0** unresolved |

**The link scanner's rule is deliberately inverted.** Many links are plain function arguments (`block(title,'#inbox',…)`, `tile(n,label,'#requests')`), so an allow-list of "link contexts" would miss them; and a rule of "whatever looks like a screen is a link" would let a typo (`#leav/new`) pass silently as a non-link. So: *every* quoted `#word` is a link unless it is provably something else — a `querySelector`/`closest`/`matches` argument, a DOM id defined by `id="…"` in the static sources, a hex colour, or a GLSL directive. Anything left that does not resolve fails.

It prints which file regressed and by how much.

**It was made to fail on purpose, once, to show it is live.** A probe added a new UI file with a local `tile` and a typo'd link, and one short refusal to an existing server file; the ratchet exited 1 with:

```
✖ app/static/zz-ratchet-probe-ui.mjs: مكوّن محلي 0 → 1 (+1) — ملف جديد، وأساس الملف الجديد صفر
✖ app/search.mjs: رفض قصير 3 → 4 (+1)
✖ app/static/zz-ratchet-probe-ui.mjs:1: الرابط «#leave/reqest» لا يصل — النية «reqest» غير مسجلة في DEEP_LINKS.leave
```

The probe was removed in a `finally`, and the tree verified identical afterwards. `tests/quality-ratchet.test.mjs` keeps the same three rules under test.

**Speed:** 105–185 ms across runs (text reads and regular expressions, no child processes). `npm run check` took 26 s before this wave, almost all of it the existing per-file `node --check` loop; the ratchet adds about a fifth of a second to that.

```
node scripts/quality-ratchet.mjs               measure and compare (what npm run check calls)
node scripts/quality-ratchet.mjs --tighten     lower the baseline to current counts; refuses if anything rose
node scripts/quality-ratchet.mjs --rebaseline  rewrite it wholesale — raises numbers; needs a decision stated in the commit message
```

**A choice to know about:** a count *below* the baseline does not fail the check; it prints a reminder to `--tighten`. Failing on improvement would have made the Wave 1 merge go red for having made things better. The cost is that an un-tightened improvement can be spent again later, so **each wave should end with `--tighten`**.

---

## 7. Golden hashes — `tests/ui-golden.test.mjs`

Every screen in `operationModules` (130) is loaded from the real server and rendered under Node for four seeded personas (employee, manager, hr, admin) with the same context `app.mjs` passes. 520 pairs, 314 rendered; a screen the server refuses is recorded as `refused:403`, so a screen opening or closing for a persona is also a visible change. Baseline: `tests/ui-golden.baseline.json`. Runs in ~3 s.

**Stability.** All platform time comes from JavaScript `Date` (there is no SQL-side clock), so `Date` is frozen; random UUIDs and their 8-character short references are replaced by their order of first appearance. Two independent runs: **0 of 520 differ.**

**Intended differences from `43428fb` — the complete list.** Exactly **4 of 520** pairs differ:

| Pair | Difference |
|---|---|
| `employee/home`, `manager/home`, `hr/home` | purely additive: the two not-ready chips (طلب إجازة، طلب خطاب) now appear, disabled, with their reasons |
| `employee/my-requests` | `<span class="badge pending">قيد الاعتماد` → `بانتظار الاعتماد` |

Intended phrase changes the seeded data does **not** exercise, so they are in no hash and are listed here instead:

- «أين طلباتي»: «معاد إليك» → «معاد للتعديل»; «معتمد بانتظار التنفيذ» → «معتمد».
- Journal badges in القوائم المالية: «قيد مسودة» → «مسودة»; «قيد بانتظار الاعتماد» → «بانتظار الاعتماد»; «قيد معتمد بانتظار الترحيل» → «معتمد بانتظار الترحيل»; «قيد مرفوض» → «مرفوض».
- Request badges and the status filter in `app.mjs`, the executive board (`#executive` is not in `operationModules`), and the retired `portal-ui`: «قيد الاعتماد» → «بانتظار الاعتماد».
- Notification bodies (`app/notices.mjs`): «الحالة: قيد الاعتماد» → «الحالة: بانتظار الاعتماد» (twice); «الحالة: معاد.» → «الحالة: معاد للتعديل.». All nine status sentences now read the vocabulary. `noticeView`'s logic is untouched.
- «طلباتي» `module_status` for a leave at `pending_hr`: «بانتظار الموارد البشرية» → «بانتظار خدمات الموظف», the leave module's own phrase.

**When this test fails after an intended change:**

```
UPDATE_GOLDEN=1 node --test tests/ui-golden.test.mjs
git diff tests/ui-golden.baseline.json          # names every persona/screen that changed — that is the review list
GOLDEN_DUMP=<dir> node --test tests/ui-golden.test.mjs   # writes the normalised HTML, to diff two runs
```

> **Expect this at the Wave 1 merge.** Wave 1 changes home, inbox and work, so those pairs *will* differ. That is the test working: regenerate, and the diff is the list of screens Wave 1 changed.

**Environment caveat.** The baseline was generated on Node 26.8.2 / ICU as recorded in the file, because that is what this machine has; `package.json` asks for Node 24.x. Hijri dates come from ICU's Umm al-Qura calendar. If the hashes differ on Node 24 and the difference is all Hijri dates, the cause is the environment; the test says so in its failure message. I could not verify this on Node 24.

---

## 8. Still holding their own status map — owned by the Wave 1 agent

| File | What | Ratchet |
|---|---|---|
| **`app/home.mjs:26`** | `STATUS_NAMES` — a full eight-status map, with `pending:'قيد الاعتماد'` | 2 (the map + the phrase) |

That is the only one. Replace it with `import { REQUEST_STATUS_AR as STATUS_NAMES } from './static/vocabulary.mjs'` and run `--tighten`. Until then the server's `status_name` on home rows says «قيد الاعتماد» while the UI says «بانتظار الاعتماد»; `home-ui` prefers its own (vocabulary) phrase, so the old one shows only on grouped decision rows, which already carry a module phrase.

I found no status map in `app/inbox.mjs`, `app/workspace.mjs`, `app/routing.mjs`, `app/reminders.mjs`, `app/obligations.mjs` or `app/static/work-ui.mjs` on this base.

**Not Wave 1's, and left on purpose:** `app/receivables.mjs` — «قيد الاعتماد» there is the name of a receivables *ageing bucket*, pinned by `tests/receivables.test.mjs`. It is baselined at 1 and cannot spread.

---

## 9. Merging with Wave 1 — every shared line

### `app/static/app.mjs` — line numbers are in `43428fb`

| Old line(s) | Change |
|---|---|
| **12** | `deep-links` import gains `unknownIntentText, BUILTIN_VIEWS`; **two import lines added after it** (`vocabulary.mjs`, `kit.mjs`) |
| **39–40** | the `labels` and `roleNames` literals replaced by one line (plus a two-line comment): `const labels=REQUEST_STATUS,roleNames=ROLE_NAMES,uiKit=kit(e,tr);` |
| **77** | in `api()`: the thrown `Error` keeps `code` and `details` (one statement split over three lines) |
| **296** | the single `module.render(...)` call: context gains `ui:uiKit` |
| **341–342** | `autoOpen`: the button is looked up first; a missing button falls through instead of `?.click()` |
| **352–376** | `followDeepLink`: `let opened`; the unknown-intent branch; `whyUnavailable`; `opened=true` at two points; the final `catch{}` now states the error |

Nothing else in the file was touched — not `shell()`, not the nav block, not the `#work` / `#inbox` branches of `render()`, not line 285 (the inbox badge). The name is `uiKit`, not `ui`, because the test sandboxes already export `globalThis.ui`.

### `app/server.mjs`

Three lines inserted after the static-module `for` loop (old line 175), *before* the «سجل المخالفات والجزاءات (ترحيل 097)» comment: `assets.set('/vocabulary.mjs',…)` and `assets.set('/kit.mjs',…)`. Placed there, not at the end of the block, so an `assets.set` Wave 1 appends for `obligations-ui.mjs` merges cleanly. **The routes block is untouched.** Static files are a whitelist: without these two lines the whole app fails to load in the browser and no backend test notices — `tests/static-modules.test.mjs` is the guard, and it passes.

### Four things that will need a hand at merge

0. **The traceability register.** `scripts/trace.mjs` pins the SHA-256 of every test file linked to a requirement, and fails (`test changed after recorded run`) when one changes. I had to touch three linked files — `tests/ui-race`, `tests/dialog-races` (sandbox globals) and `tests/ui-render` (`ui` in the context) — which made **six** links stale (PLT-04 ×2, PLT-05, NFR-02, NFR-05, NFR-06). I followed the project's own procedure: a fresh, fully green run of exactly those three files is saved as `docs/testing/test-results-wave0-guard-rails-20260921.txt` and recorded with `node scripts/trace.mjs --record-results …`. It re-recorded those six references and nothing else; requirement completion states were not changed. I used a *targeted* run on purpose: recording a full run rewrites every linked test in `docs/implementation/REQUIREMENTS.json` and `docs/traceability.json`, which would guarantee a conflict with Wave 1. **If Wave 1 also re-recorded, those two JSON files will conflict.** Do not hand-merge them: take either side, finish the merge, run `npm test > docs/testing/<name>.txt`, and `--record-results` that file.
1. **Sandbox tests.** `app.mjs` now reads `REQUEST_STATUS`, `ROLE_NAMES` and `kit` at load. The three harnesses that evaluate `app.mjs` in a VM with imports stripped (`dialog-races`, `ui-race`, `employee-ux`) pass them as globals, following their existing convention. **If Wave 1 added a new sandbox test copied from the old pattern, it will fail with `REQUEST_STATUS is not defined`** — add the three names to its sandbox object.
2. **`BUILTIN_VIEWS`** in `deep-links.mjs` lists the views `render()` draws itself. `tests/links.test.mjs` fails if `render()` gains an `else if(view==='…')` branch that is not listed — by design, since the link check would otherwise not know the screen. If Wave 1 adds a built-in view, add it there.
3. **The golden baseline** — see §7.

---

## 10. Tests and checks — literal counts

| | `43428fb`, before any change | this branch, final run |
|---|---|---|
| `npm test` | 1064 tests · 1058 pass · **0 fail** · 6 skipped | **1108 tests · 1102 pass · 0 fail · 6 skipped** |
| `npm run check` | 450 modules, green | **459 modules, green**; ratchet: primitives 115/115 · short refusals 1312/1312 · status literals 3/3 · links 114 checked, **0 unresolved** |

The 44 new tests: `vocabulary` 9 · `kit` 12 · `links` 8 · `refusal` 7 · `quality-ratchet` 6 · `ui-golden` 2. The six skips are the same six as on the base; none is mine. The full output of the final run is `docs/testing/test-results-wave0-full-20260921.txt`.

The baseline was taken *first*, before any edit, so that anything red afterwards was provably mine. Two things did go red along the way and are worth knowing: tests that render a migrated screen without `ui` (fixed by passing it, §3), and the traceability hash guard (handled by the project's own re-record procedure, §9).

Both runs were on Node 26.8.2. The final run took 297 s rather than ~200 s only because another agent's suite was running on the same machine (load average ≈ 26); nothing flaked under that load.

---

## 11. Files

**New:** `app/static/vocabulary.mjs`, `app/static/kit.mjs`, `app/refusal.mjs`, `scripts/quality-ratchet.mjs`, `scripts/quality-baseline.json`, `tests/ui-golden.test.mjs`, `tests/ui-golden.baseline.json`, `tests/vocabulary.test.mjs`, `tests/kit.test.mjs`, `tests/links.test.mjs`, `tests/refusal.test.mjs`, `tests/quality-ratchet.test.mjs`, this file.

**Changed — interface:** `app.mjs`, `deep-links.mjs`, `home-ui.mjs`, `leave-ui.mjs`, `journey.css`, `my-requests-ui.mjs`, `request-transparency-ui.mjs`, `letters-ui.mjs`, `expenses-ui.mjs`, `payroll-ui.mjs`, `engagement-ui.mjs`, `executive-ui.mjs`, `portal-ui.mjs`, `statements-ui.mjs`, `leave-count.mjs` (a comment).

**Changed — server:** `server.mjs` (three whitelist lines), `my-requests.mjs`, `notices.mjs`, `my-profile.mjs`, `letters.mjs`, `payroll.mjs`, `request-timeline.mjs`, `engagement.mjs`, `search.mjs`.

**Changed — scripts and tests:** `scripts/check.mjs`; `tests/dialog-races`, `ui-race`, `employee-ux`, `portal-wiring`, `module-fixes-critical`, `request-transparency-ui`, `ui-render`. In `employee-ux` the home test's title and messages said a not-ready action is «hidden»; it still passed (a disabled chip carries no link) but no longer described the behaviour, so its wording was corrected and an assertion for the disabled chip and its reason added.

**Changed — records:** `docs/implementation/REQUIREMENTS.json` and its mirror `docs/traceability.json` (six re-recorded test references, see §9); new `docs/testing/test-results-wave0-guard-rails-20260921.txt` (the recorded evidence — **do not edit, its hash is pinned**) and `docs/testing/test-results-wave0-full-20260921.txt` (the full final run, for the record; not linked).

**Not touched:** `app/obligations.mjs`, `app/inbox.mjs`, `app/home.mjs`, `app/workspace.mjs`, `app/routing.mjs`, `app/reminders.mjs`, `app/static/work-ui.mjs`, `app/static/obligations-ui.mjs`, the routes block of `app/server.mjs`, `gateMessage`, every migration, `.env`.

---

## 12. What I did not verify

- **Node 24.** Everything ran on Node 26.8.2, the only Node on this machine. `engines` asks for `>=24.14 <25`.
- **Other designs and the light theme.** The disabled chip was checked in a real browser at desktop width and at 390 px (it fits, is 63 px tall — above the 44 px touch target — and the page does not scroll sideways), but only in the default `depth` design, dark theme. Its colours are existing tokens (`--ink-3`, `--line-strong`), so the other four designs should follow; I did not look at them.
- **The kit's `row`, `card`, `table` and `refusal` have no production caller yet.** They are unit-tested and CSP-clean, but only `tile` and `empty` are exercised by a migrated screen. `ui.refusal` in particular is not yet wired into the `render()` catch block in `app.mjs` — I left that block alone to keep the shared-file edits minimal (and `tests/portal-fixes-round2` pins its shape). It is the natural next adoption.
- **English.** `reason` arrives from the server in Arabic only; an English-mode disabled chip shows `reason_en` if the server ever sends one, else the Arabic reason.
