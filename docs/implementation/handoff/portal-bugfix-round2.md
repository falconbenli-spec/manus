# Employee portal fixes, round 2 — 20 September 2026

**Sources.** `docs/product/audits/EMPLOYEE-PORTAL-AUDIT-20260919.md` (35 bugs) and
`docs/implementation/handoff/portal-fixes-20260919.md` (round 1: B1, B2, B4, B5, B6, B25 and part of B7).
This round takes the medium and low bugs that were still open, and adds the first browser sweep of the merged
platform: `docs/product/audits/MERGED-SWEEP-20260920.md`.

**State.** Built and tested locally on synthetic data. **Not accepted by any process owner.** Nothing was pushed.
`.env`, the live database and ports 3600, 3601 and 3630 were not touched.

**Branch.** `worktree-agent-a41bec30b76e9f915`, from `codex/local-foundation` at `6e9fb81`.

---

## 1. First: eleven of the open bugs were already fixed by the merge

The audit was written against `codex/local-foundation` before the 19 September integration. Seven branches merged
after it, and they closed eleven of the bugs this round was asked to look at. Each was re-checked in the code and,
where it is visible, in the browser sweep. They are listed here so nobody fixes them twice.

| Bug | Audit severity | Where it was closed |
|---|---|---|
| B8 — «null يوم عمل متبق» for a draft | Medium | `app/home.mjs:41` now reads «مسودة لم تُقدَّم بعد» |
| B11 — catalog search finds nothing for «إجازة» | Medium | `MODULE_SHORTCUTS` in `app/static/deep-links.mjs:47-54` |
| B12 — internal pages in the employee menu | Medium | `requirements.view` is no longer a default (`app/access.mjs:90`); every development page is behind a capability (`app/static/app.mjs:131-135`) |
| B13 — administrator headings (the heading itself) | Medium | The page heading is the account's own nav label (`app/static/app.mjs:250`). The approver tiles are fixed in this round. |
| B14 — dead ends into `#employees` | Medium | Own-document rows point at `#profile` (`app/expiry.mjs:71`); the catalog's specialised cards are filtered by capability (`app/static/app.mjs:273-275`) |
| B21 — executors not told after a multi-step chain | Low | `app/workflow.mjs:478-482` |
| B29 — auditor copy on الرئيسية | Low | الرئيسية was rewritten as the employee home (`app/static/home-ui.mjs`) |
| B30 — the two dashboards disagree | Low | ملخصي was merged into الرئيسية; `#portal` is an alias (`app/static/app.mjs:238`) |
| B35 — dialect headline in the new-request dialog | Low | «ماذا تحتاج اليوم؟» (`app/static/request-picker.mjs:212`) |
| B7 — «mark all as read», titles and bodies | Medium | `app/static/app.mjs:284`; the rest of B7 is in this round |

---

## 2. Fixed in this round

Fourteen bugs. Each change is small and stands on its own.

### 2.1 Rules and separation of duties

**B18 (medium): feedback visibility widened when the recipient changed manager.**
The screen promises «لا تُوسَّع المرئية بعد الكتابة», but `visibility='recipient_manager'` was resolved against the
recipient's *current* `manager_id` on every read. A new manager could read notes written under the old one, and the
manager they were written for lost them.

- **Migration 106** (`app/migrations/106-feedback-visible-manager.sql`) adds `feedback_notes.visible_manager_id`
  and rebuilds the `feedback_notes_immutable` trigger from 064 so the new column is written once like the rest of the note.
- The manager of the day is stored at write time (`app/feedback.mjs:179-181` and `:220-223`).
- The read uses `COALESCE(n.visible_manager_id,s.manager_id)` (`app/feedback.mjs:148`). The COALESCE is for rows
  written before the migration only: they have nothing pinned, so they keep the old behaviour instead of vanishing.
  No manager is invented for them retroactively.

**B19 (medium): one person could take both steps on an expense claim.**
When a claimant has no line manager, the manager step opens to a finance approver (`app/expenses.mjs:34`). That same
person could then take the finance step. `finance_approve` is now offered only to someone other than the person who
took the manager step (`app/expenses.mjs:35-42`). `reject_claim` stays available to them, so a claim is never stuck
without a decision. `claimAction` enforces the list, so the server refuses it too.

**B20 (medium): an approved leave could be cancelled after it had been taken, and the days came back.**
`app/leave.mjs:84-89`: the employee may cancel an approved leave only before its start date. After the leave has
begun, withdrawing it is a decision for خدمات الموظف, who hold the attendance and payroll correction — they now get
`cancel` on an approved request within their scope (`app/leave.mjs:94-96`). The effect is unchanged (refund plus
`withdrawPayEffects`); who may cause it is not.

**B13 residual (medium): approver tiles on the weekly timesheet.**
«أسبوع ينتظر قراري» and «لم يرسلوا أسبوعًا منتهيًا» are drawn only for `data.can_approve`
(`app/static/resourcing-ui.mjs:31-32`). The blocks below them were already gated; only the tiles were not.

### 2.2 Forms

**B9 (medium): required fields were revealed one at a time.**
`validatePayload` now collects every missing required field and names them all in one message, with their keys in
`error.details.fields` (`app/validation.mjs:31-45`). One missing field keeps the old wording.
The request composer deliberately still does **not** carry `required` on its inputs: its only button is
«حفظ المسودة» and a half-finished draft is the point of a draft. The fields carry `aria-required` so a screen reader
hears what the red asterisk shows (`app/static/app.mjs:364-367`).

**B17 (low): the pulse survey submitted the lowest score for an untouched question.**
The rating and eNPS selects open on a blank «— اختر درجة —» option and stay required
(`app/static/engagement-ui.mjs:98-100`), so a question with no answer cannot be submitted as a 1 (or a 0).

**B27 (low): the expense amount opened a letter keyboard on a phone.**
`operationFields` passes through `inputmode` (`app/static/operations.mjs:136`), and both money fields ask for the
decimal keypad (`app/static/expenses-ui.mjs:19-20`). The field stays `type="text"` so the two-decimal rule on the
server is unchanged. Attaching the receipt inside the claim form is a product change, not a bug fix, and was left.

### 2.3 Copy and readability

**B10 (medium): «إجراء آخر» in the activity record.**
`actionLabel` knew twelve short keys. Everything the server writes in its full form — `service.feedback_recorded`,
`request.closed`, `request.transferred`, `intake.saved` and the task actions — read as «إجراء آخر», and the keys it
did know were Arabic-only in English mode. `auditNames` (`app/static/app.mjs:45-56`) is now the full list from
`app/request-timeline.mjs`, in both languages. A test fails if the server gains an action the record cannot name.

**B22 (low): Arabic number agreement.**
New module `app/static/arabic-count.mjs`: four shapes per noun (one, two, 3–10, 11+), plus a fraction rule so
half a day reads «1.5 يوم». Applied where employees meet counts most: the launcher and the catalog
(`app/static/request-picker.mjs`), the الرئيسية lists and tiles (`app/static/home-ui.mjs`), and the service-level
and event chips on the request page (`app/static/app.mjs`). «3 خدمة» is now «3 خدمات», «1 إدارات» is «إدارة واحدة»,
«15 يوم» is «15 يومًا», «6 يوم عمل» is «6 أيام عمل». **Not yet everywhere**: the leave, HR and finance screens still
write their own day counts; see §5.

**B23 (low): «لم يُستكمل» on empty optional fields.**
An empty optional field reads «—». «لم يُستكمل» is kept for a required field, where it is a real gap
(`app/static/app.mjs:65-67`).

**B24 (low): «النسخة المقدمة 0» on a draft, and bare UUIDs.**
A draft says «مسودة لم تُقدَّم بعد». The request page carries a short upper-case reference in its subtitle, and the
full identifier is labelled «المرجع الكامل» instead of sitting bare under the details
(`app/static/app.mjs:300`). A human request number such as `HR-2026-00123` is gap G21 and is not this.

**B26 (low): the avatar showed «ا» for everyone whose name starts with «ال».**
`nameInitial` (`app/static/app.mjs:57-62`) skips the definite article, so «الموظفة التجريبية» shows «م».

**B28 (low): the contract page named services that do not exist by those names.**
It now links: «ملفي» for data and documents, and the catalog for «استفسار أو تصحيح في الراتب»
(`app/static/contracts-ui.mjs:24`).

**B34 (low): the activity record had dates but no times.**
Timeline entries and submitted revisions carry a Riyadh date and time in a `<time>` element
(`app/static/app.mjs:69-71`), so same-day events can be ordered and a step can be measured.

### 2.4 Found in the sweep, fixed here

Full detail, severity and repro for each: `docs/product/audits/MERGED-SWEEP-20260920.md`.

**S-01 (medium): `/favicon.ico` returned 401 on every page load, on every screen, for every role.**
The page carries no `<link rel="icon">`, so every browser asks for `/favicon.ico`; it was not in the asset map, so it
fell through to the authenticated API router. A console error on 335 of the 346 screens swept, which buries any real
error, and no icon on the tab although `icons/icon-192.png` exists. Fixed in `app/static/index.html:16-19` and
`app/server.mjs:152-154`. After the fix the 142 re-swept screens logged zero console errors.

**S-04 (medium): the catalog showed two different service counts on one screen.**
The page heading counted the raw catalog («142 خدمة») while the department rail counted the list after option cards
replace their member services («كل الخدمات 127»). Both now count what the user actually browses
(`app/static/request-picker.mjs:231-236`).

**S-07 (medium): a refused screen was a dead end.**
A 403 filled the page with a display-size headline and one «إعادة المحاولة» button that retries the same refusal.
«العودة إلى الرئيسية» now sits beside it (`app/static/app.mjs:327-329`). This is the remainder of B14: the merge fixed
the message, not the dead end.

**S-08 (low): the «اليوم» card printed raw dates.**
«الإجازة السنوية · 2026-10-04 — 2026-10-06» while the header above it and every list below write the Gregorian and
Hijri dates together. Single dates now take the dual form; a range stays Gregorian with one Hijri after it, so the
line does not become four dates (`app/static/home-ui.mjs:26-33`).

**Found and left:** S-02 (leave still cannot be requested out of the box), S-03 (no letter until a template is
adopted, approved by a second person, and `hr.letters.issue` is granted), S-05 (the finance delegation that gates
every finance action has no API and no screen), S-06 (`class="error"` is both a failure panel and an inline
advisory). Reasons in the sweep document §4.

---

## 3. Tests

**New:** `tests/portal-fixes-round2.test.mjs`, 15 tests — B9, B10, B13, B17, B18, B19, B22 (two tests),
B23/B24/B26/B34, B27, B28, and the four sweep findings S-01, S-04, S-07, S-08.
**New:** `tests/leave.test.mjs` gains `B20: an approved leave can be cancelled before it starts and not after`.

**Changed tests.** Four leave tests cancelled an approved leave whose dates are fixed in the past, which is the bug
itself. They now book a future window computed from the run date (`soon()` in the `tests/leave.test.mjs` fixture),
so they do not go stale. One test in `tests/leave-types.test.mjs` cancels a sick leave that has already happened;
it now asserts the employee is refused and has خدمات الموظف withdraw it. One line in `tests/ui-race.test.mjs`
injects the two count helpers into its sandbox, which strips imports.

`app/static/arabic-count.mjs` is registered as a served asset (`app/server.mjs:157`); a test in `ui-render`
fails without that.

**`npm test`: 833 tests, 832 pass, 1 fail.** The one failure is the known timesheets billable test, which fails on a
Sunday because it logs «yesterday» into the previous week; today is Sunday 20 September. It fails when run alone too,
so it is the date and not load. The procurement conflict-of-interest test flaked once in a full run and passed alone
(13/13), as expected. Before this branch the count was 814.

**`npm run check`:** 409 modules, source hashes match, 220 requirements in 22 domains.

**Traceability.** `docs/traceability.json` had to be re-recorded: `tests/leave.test.mjs` is HR-04 evidence and its
hash no longer matched. `npm run trace -- --record-results docs/testing/test-results-portal-bugfix-round2-20260920.txt`
re-pointed all 412 named test references at this run, which is why the diff on that file is large. No requirement
completion state was changed, and no test result was claimed that this run did not produce.

## 4. Migration 106

`ALTER TABLE feedback_notes ADD COLUMN visible_manager_id`, one index, and a rebuilt trigger. Applied files 001–104
were not touched. On a fresh database: 89 migration files, `schema_migrations` max 106 (90 rows),
`integrity_check` ok, `foreign_key_check` empty.

## 5. Skipped, with reasons

**Product gaps, not bugs**
- **B15, letters deliver nothing out of the box.** Two paths exist and neither works until someone adopts and
  approves a template and `hr.letters.issue` is granted. The grant is an owner decision
  (integration handoff §6, «Grants that nothing works without»); the starter templates exist and adopting them is
  an HR act, not a code fix. Exercised in the sweep by doing both by hand — it then works end to end.
- **B16, English is shallow.** `tr()` reaches the shell, the request pages and the home screen; every operation
  module is Arabic. Recommendation 7 of the audit is a translation pass with a test that fails on untranslated
  strings, which is its own piece of work.
- **B31, two time-approval systems.** `/time` entries are approved by `manager_id`, `/timesheets` weeks by a holder
  of `timesheets.approve`, which is a default only for `manager` and `pm` (`app/access.mjs:74`). Which of the two is
  the system of record is a decision, not a bug.
- **B32, `hr.attendance.approve` belongs to no role.** Named in the integration handoff §6 as owner decision 1
  («the pre-approval mapping to `hr.attendance.approve`»).
- **The rest of B7.** A merged feed that also carries `review_notices` (migration 059) is a notification-service
  change, listed as still open in round 1.

**Partially done**
- **B22.** The helper exists and is used on the screens an employee meets most. The leave, payroll and finance
  screens still write «X يوم» by hand; moving them over is mechanical and safe, but it touches files two other
  agents are working in this week.
- **B24.** The bare UUID is now labelled and shortened. A real human reference number is gap G21.

---

## 6. Browser sweep

`docs/product/audits/MERGED-SWEEP-20260920.md` has the method, the findings table with severity and repro, and the
six end-to-end journeys. In short: **346 screens**, employee, manager and HR, in «كوكبة 360» and «الكلاسيكي», at
1440×900 and 390×844. No screen scrolls sideways, no text is unreadable over its background, no screen throws, and
nothing is clipped. Nine findings: three High and left with a named reason, four fixed here, one Low left, one that
did not reproduce. All six journeys completed end to end.

Screenshots: `work/design-verify/sweep-20260920/`, one PNG per screen.

**Clean-up.** The server on 3710 was stopped; the temp database, its field key and the session file were deleted.
Port 3710 is free, and 3600, 3601 and 3630 were not touched. The live database was not opened.
