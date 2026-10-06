# Integration of 19 September 2026: branch `integration-20260919`

**State.** The work is merged and tested locally on synthetic data. No process owner has accepted any of it. Nothing was pushed, and `.env` was not touched. Every value taken from the regulations is still a draft until its owner accepts it; the owners are listed in §6.

**Worktree.** `.claude/worktrees/integration`. The main checkout was not touched.

## 1. What was merged, in order

| # | Branch | Work | Migration | Handoff |
|---|---|---|---|---|
| (before) | `codex/local-foundation` (brain c103f67, portal fixes 54fdc02) | foundation | up to 096 | `portal-fixes-20260919.md`, `brain-interactive.md` |
| (before) | `worktree-agent-a608046eea0dbf459` | violations register and penalty schedule (P1-01) | 097 | `discipline.md` |
| (before) | `worktree-agent-aaa1902297d5153cc` | attendance rules | 099 | `attendance-rules.md` |
| 1 | `worktree-agent-af3d8bb3d469cffa4` | statutory leave types (P1-02) | 098, plus 104 added during integration | `leave-types.md` |
| 2 | `worktree-agent-ab8efac6bd18ead2d` | notifications, email (off), reminders, idle timeout | 100 (edited before the merge, see §3) | `notifications-email.md` |
| 3 | `worktree-agent-a2671b7b1a1772372` | employee UX: «اليوم» card, «طلباتي», «ملفي», service variants, PWA | none (101 unused) | `employee-ux.md` |
| 4 | `worktree-agent-aac4a29ebc985b9c4` | payroll rules, resignation clocks, travel, letter wizard | 102 | `payroll-rules.md` |
| 5 | `worktree-agent-a4fbf57df509a7e08` | «مزاياي» and benefits administration | 103 | `benefits-portal.md` |

The merge commits, in order, are `7422689`, `3b8482f`, `f8fde17`, `4c6bca0` and `83f9921`. The last commit on the branch also holds this file, `STATUS.md`, `.gitignore` and the test output.

All three late branches (101, 102 and 103) were complete when they were first polled, at 18:27 and 18:44 Riyadh time. No branch was still open, so no 3-hour timeout was reached.

## 2. Test counts after each merge

| After | `npm test` | `npm run check` |
|---|---|---|
| Starting point (097 + 099 + foundation) | 751 pass | — |
| 098 leave types + 104 | 763 tests: 762 pass, 1 fail. The failure was the procurement conflict-of-interest load flake, which passes when run alone. | pass, 381 modules |
| 100 notifications | 775 / 775 | pass, 389 modules |
| 101 employee UX | 789 / 789 | pass, 398 modules |
| 102 payroll rules | 803 / 803 | pass, 404 modules |
| 103 benefits | 814 / 814 | pass, 407 modules |

Each `npm run check` result also reported 220 requirements in 22 domains, and the source hashes matched.

The final run is saved in `docs/testing/test-results-integration-20260919.txt`.

These counts include the integration tests added during the merges:
- one assertion in `discipline` (evidence upload)
- one test in `discipline` (open cases hold resignation)
- a stricter mission-notice assertion in `notifications-email`
- two tests in `leave-types` (statutory leave entry points)
- two tests in `employee-ux` (letter deep links and «مزاياي» deep links).

## 3. Migrations

**Order on a fresh database:** 002 → … → 096, 097 `discipline`, 098 `leave-types`, 099 `attendance-rules`, 100 `notifications-email`, 102 `payroll-rules`, 103 `benefits-portal`, 104 `discipline-file-entity`. Number 101 is unused.

**Smoke tests.** These ran after every merge, through `app/db.mjs openDb` and `scripts/seed.mjs`.
- **Fresh temp DB.** Every file from 002 to 104 applied in order: 89 rows in `schema_migrations` (version 1 plus 88 files). `integrity_check` returned ok, and `foreign_key_check` found nothing.
- **Copy of the live preview DB** (`work/hr-design-preview-20260914.sqlite`). The copy included its `-wal` and `-shm` files, and the source's SHA-1 was checked before and after. The copy went from max 95 (81 rows) to **max 104 (89 rows)**, with none missing. `integrity_check` returned ok, and `foreign_key_check` found nothing. The source file was never opened.

**Integration changes to migrations:**
1. **New `104-discipline-file-entity.sql`.**
   - 097 registered `discipline_case` in `files.mjs` but never allowed it in `stored_files`.
   - Before 098, the closed CHECK from 035 rejected every evidence upload. After 098, the foreign key to `stored_file_entity_types` rejected it.
   - 104 inserts the one missing row. No applied file was edited.
   - `tests/discipline.test.mjs` now uploads a real evidence file, and that test fails without 104.
2. **`100-notifications-email.sql` edited before the merge.** This is acceptable because 100 had never been applied to any kept database.
   - Its section 1 rebuilt `notifications` a second time, after 099.
   - It is replaced with the alternative from `notifications-email.md` §8: `ALTER TABLE notifications ADD COLUMN category …` (the same CHECK), plus the `notifications_unread` and `notifications_created` indexes.
   - With this change, 099 and 100 compose on a fresh DB, and 099's `subject_kind` format rule stays the only one.
3. **Subject kinds.** All 29 `SUBJECT_LINKS` keys, and every literal subject kind in `app/`, pass 099's rule (3–40 characters, `[a-z_]`). `request` is written only on request rows and also passes.

## 4. Conflicts and how they were resolved

**098 leave types**
- `files.mjs`: both imports and both entity types were kept, `discipline_case` and `leave_request`.
- `server.mjs`: the `leave-count` and `module-services` assets were added, and the `discipline-ui` asset was kept.
- `app.mjs`: both operation-form hooks were kept, the leave `live` preview and the attendance `opened` hook.

**100 notifications**
- `notices.mjs`: 100's list, categories, `notifyMany` and `hrCaseNotice` were combined with 099's attendance kinds and 097's `discipline_case`.
  - 100's `overtime` kind was folded into 099's `overtime_request`, so each record has one kind.
  - `discipline_case` notices use the `hr_cases` email category.
- `attendance-extras.mjs`: 099's rules and decision notices were kept, and so were 100's manager notices on new mission and overtime requests. 100's decision notices were dropped where 099 already notifies the employee, so the employee gets one notice per decision.
- `server.mjs`: `Permissions-Policy` keeps `geolocation=(self)` for 099, and adds 100's COOP, `X-Permitted-Cross-Domain-Policies` and `Origin-Agent-Cluster` headers.
- `workflow.mjs`, `hr-design.mjs` and `operations.mjs`: both sides were kept.

**101 employee UX**
- `STATUS.md`: both entries were kept.
- `server.mjs`: 101's `/api/notifications/count` now returns `wf.unreadCount` from 100, so the badge counts what the list shows.
- `app.mjs`: 098's `autoOpen` (`#leave/request`) runs first, then 101's `followDeepLink`.
- `request-picker.mjs`: search shows 098's HR-LEAVE module service unless 101's leave variant matched, and a shortcut is not repeated. «الأكثر طلبًا» keeps both.
- **Semantic fixes.** These have tests in `leave-types.test.mjs`.
  - `#leave/new` falls back to the statutory `request` button once the policy is accepted.
  - `?kind=` preselects the statutory type.
  - The «إجازة» variant card lists the statutory types.
  - The home quick action is ready under an accepted policy.

**102 payroll rules**
- `letters.mjs`: the wizard is combined with 097's discipline placeholders and the `HR_INITIATED` guard, so `discipline_notice` stays out of the wizard.
- `workflow.mjs`: all three imports were kept.
- Screens and assets were registered.
- **Semantic fixes:**
  - `resignations.mjs` treats discipline statuses `notified`, `not_proven` and `lapsed` as closed. Before this, any notified penalty blocked resignation forever. A case that is `recorded`, `investigating` or `proven` now holds a resignation (Art. 37(5)). This is tested.
  - `discipline.mjs` classes a proposed fine as `fine` in `payroll_adjustment_classes`, so 102's Art. 116 pre-run cap sees it. This is tested.
  - `#letters/new?type=` opens the wizard's `type:<code>` button (102's `route()` contract) and never falls back to another type. This is tested.

**103 benefits**
- `benefits.mjs`: 101's `dependantsOfEmployee` and 103's helpers were both kept, and the closing brace they shared was restored.
- `notices.mjs`: the merged list plus 103's three kinds.
- Screens and assets were registered.
- **Semantic fix.** 101's «مزايا» card gains a «مزاياي» option (103 handoff §6), and `#my-benefits/new?option=<key>` opens that one option. This is tested.

**Menu decisions made during integration.** Each is reversible in one line of `app/static/app.mjs`. 101's employee menu has a limit of 30 entries, which its test enforces. After 097 («مخالفاتي وجزاءاتي») and 103 («مزاياي») were added, the ordinary employee (`role='employee'`) no longer sees these three entries in the menu:
- «الاستقالة» and «الانتداب» (102). They open from their catalog cards and from `#resignations` and `#travel`.
- «إعدادات الإشعارات» (100). It opens from the button on the notifications page.

Approvers, managers and HR still see all three.

## 5. Known gaps after integration

- **Browser check.** No merged screen was walked through in a browser. Only `ui-render` and the node tests cover them.
- **Two thresholds for unpaid leave over 20 days.**
  - The accrual stop reads 098's leave policy.
  - Settlement reads 102's `unpaid_leave_threshold_days` and `unpaid_leave_mode`.
  - Both read the same unpaid leave rows, but they are two separate settings. They should be decided once and kept equal.
- **Two Art. 116 fine caps.** 097 checks its own cap at proposal time, and 102 checks all fines before the run. They agree now, but only if the discipline wage basis equals 102's cap basis (see §6, finance).
- **Portal panel.** 097's link panel in `portal-ui.mjs` no longer renders, because 101 merged the portal into home. «مخالفاتي وجزاءاتي» is still in the menu.
- **Notifications for resignations and travel.** 102 sends none yet. Kinds such as `resignation` and `travel_decision` would pass 099's rule.
- **Benefit letters.** 103 records them rather than generating them from 102's letter templates.
- **My-requests list.** «طلباتي» (101) does not list resignations, travel decisions or benefit requests yet.
- **Traceability.** `docs/traceability.json` was not changed. `npm run check` does not require new modules to be listed, and every recorded test source still matches its hash.
  - P1-01: `app/discipline.mjs` and `tests/discipline.test.mjs` can be added as evidence.
  - P1-02: `app/leave-types.mjs`.
  - PAY-10: `app/benefits-portal.mjs`.

## 6. Open decisions, collected from every handoff

The source of each item is shown in brackets: 097 discipline, 098 leave, 099 attendance, 100 notifications, 101 employee UX, 102 payroll, 103 benefits, and «integration» for decisions made during this merge.

### Owner

1. **Authority matrix (مصفوفة الصلاحيات).** Name the authority holder (صاحب الصلاحية), then grant these capabilities. None of them is granted to any role by default:
   - `hr.discipline.decide` (097)
   - `hr.leave.authority`: until it is granted, unpaid leave over 5 days and patient-companion leave are refused (098)
   - the pre-approval mapping to `hr.attendance.approve` (099)
   - `hr.contracts.approve` for resignation and travel (102).
2. **Grants that nothing works without:**
   - `hr.policy.accept` to the HR manager (098, 102, 103)
   - `hr.letters.issue` to the letter issuer (097, 102)
   - `benefits.finance.confirm` to a finance person (103)
   - who else holds `requirements.view` (101).
3. **Email (100):**
   - the provider (data residency, price, idempotency, DPA)
   - the sending domain and its SPF, DKIM and DMARC records
   - key custody and rotation
   - the default email categories. All are on today, including `hr_cases`, and discipline notices now follow `hr_cases` too (integration).
4. **Security values (100):**
   - the idle timeout: 30 minutes for sensitive sessions and none for others, as seeded
   - the failed-login threshold (5)
   - whether unknown usernames alert.
5. **HTTPS hosting on a host employees can reach** (099, 101). GPS check-in, installing the app and the offline page all need it.
6. **Location check-in:**
   - flag or block (only flag is built)
   - the coordinate retention days and the privacy notice text (099).
   The platform shows only what a phone reported, not where its owner was.
7. **Employee UX:**
   - the one-tap punch on home
   - whether `POST /api/requests` refuses routed catalog services
   - whether «ملخصي» stays merged into home for every role
   - the five services kept as generic requests
   - `apple-touch-icon` in `index.html` (101)
   - **(integration)** hiding «الاستقالة», «الانتداب» and «إعدادات الإشعارات» from the ordinary employee's menu.
8. **Data protection (PDPL):**
   - employees seeing their own dependants (101, 103)
   - the cross-border transfer and retention terms for email (100)
   - the location retention (099).
9. **Benefits matrix (Annex 1, Art. 70):**
   - parents' insurance, children's education, gym, phone, discounts and the reward table
   - the ticket policy: service before the first ticket, frequency, family, cash equivalent and destination (103).
10. **Art. 36(2) end-of-service reading:** literal (70,000) or labour-law (45,000). No settlement can be approved until it is chosen (102, with the HR manager).

### HR manager

**Discipline (097):**
1. Confirm cells U1 and U2 against the signed PDF.
2. Set the written-defence window (draft: 3 days).
3. Confirm the chain reading of Art. 114.
4. Decide whether A11–A14 share one chain.
5. Decide whether the original decider may answer the grievance.
6. Write and approve the bilingual `discipline_notice` template.

**Leave (098):**
1. Holidays inside annual leave.
2. Whether marriage, birth and death leave count working or calendar days.
3. Iddah in Hijri or Gregorian months.
4. Patient companion per year or per case.
5. Decide whether the three limits that are shown but not enforced should be enforced:
   - 50 days of annual leave in the year
   - split exceptions
   - carry-over.
6. Recalculation of retroactive sick leave.
7. The medical committee after 120 days.
8. An editor for draft values.
9. The Eid extension, and the CEO's five extra days.
10. Gender and religion are not stored, so maternity and iddah leave are checked by document.
11. **(integration)** Keep 098's and 102's unpaid-leave thresholds equal.

**Attendance (099):**
1. Grace minutes.
2. The monthly permission cap.
3. The overtime year: calendar year or contract anniversary.
4. Ramadan hours for everyone the policy covers.

**Notifications (100):**
1. Reminder values: 3 days for overdue decisions, the manager digest on, and the `expiry_watch_settings` lead times. **Until these are set, no expiry reminder is sent.**
2. Recipients: vendor documents to `vendors.manage`, contract end not sent to the employee, probation to the line manager or HR.
3. The Art. 25 probation wording.

**Payroll (102):**
1. Art. 91.3 mode: `excess` or `total_when_over`.
2. The Art. 34.2 deferral anchor.
3. The deemed-acceptance day (submission + 31).
4. The death award factor, confirmed with the labour law.
5. The Art. 65 travel grade table against the signed PDF.
6. Letter lists (banks, embassies, government), the English name and job-title placeholders, and the 1-day and 3-day SLA.
7. Adopt and approve the six starter templates (an issuer other than the preparer).

**Benefits (103):**
1. Art. 67 (25% housing) against Art. 72 (in kind or suitable cash).
2. Medical class per grade, and upgrading at the employee's own cost.

**Employee UX (101):** review the option names and required documents in the letter and leave variant cards.

### Finance and payroll

1. **One rounding rule** (098, 099, 102): halala (the default) or `riyal_up` (Art. 50.5). It applies to:
   - pay lines
   - the sick-leave deduction
   - suggested overtime pay.
   Finance confirms, and the HR manager chooses it when accepting the pay rules.
2. **One wage basis for fines and caps** (097, 102):
   - the daily wage for fines (097's draft: basic + housing + transport + other ÷ 30)
   - the base for the 10% advance cap and the 25% court-order cap (102: the monthly contract total).
   Choose between the full wage and basic only. Keep the two modules equal so that the Art. 116 caps agree.
3. **Sick-leave deduction basis** (098): the contract total ÷ the day basis.
4. **Accounting treatment of the workers' benefit fund liability** (Art. 123), and the payout route through the labour committee or ministry approval (097).
5. **Unpaid leave above 20 days in service** (098, 102): deduct the excess only, or the whole period. Payroll owner.
6. **`company_expense` benefit proposals** (tickets booked by the company) have no handoff action yet (103).
7. **Notices to the payroll preparer** about proposed or withdrawn leave pay effects are not built (098 to 100).
