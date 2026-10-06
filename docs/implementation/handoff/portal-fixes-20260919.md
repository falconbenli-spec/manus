# Employee portal fixes — 19 September 2026

**Source.** `docs/product/audits/EMPLOYEE-PORTAL-AUDIT-20260919.md`. This round fixes the critical bug and the high bugs that are clear and contained: B1, B2, B4, B5 and B6. It also fixes the parts of B7 (medium) that the notification work needed.

**State.** Built locally and tested locally. Nothing has been committed. **Not accepted by any process owner.** The HR manager should see the leave and notification wording before it counts as done.

## Fixes

### 1. B1 (critical): report snapshots leaked across people and scopes

**Rule.** A snapshot is visible to:
- its creator, as long as the creator may still run the report
- anyone whose current rights cover all of the data the creator saw

The rule is checked on every read (`app/reports.mjs:108-142`). Each report is classed by how its data depends on the person running it (`AUDIENCE`, `app/reports.mjs:115`):

| Class | Reports | Who else sees a colleague's snapshot |
|---|---|---|
| uniform | R02–R05, R09, R12, R26–R40 | Anyone allowed to run the report. The data is the same for all of them. |
| executive | R06–R08, R10, R11, R14, R16, R17, R24, R25 | `executive.view` holders only. For everyone else these reports are cut down to their own department, projects or team. |
| executive_finance | R01 | `executive.view` holders. If the snapshot has the finance section, they must also hold finance read. |
| creator | R15, R19–R22 (client-team reports) | Nobody. No capability goes beyond client-team membership. |

An unclassified report fails closed and is treated as "creator".

**Where the rule is enforced:**
- **Open:** `readSnapshot` (`app/reports.mjs:161`).
- **Print, CSV and XLSX:** these routes call `readSnapshot` (`app/server.mjs:234-242`, unchanged), so they get the same check.
- **List:** `reportsIndex` (`app/reports.mjs:143`).
- **Search:** the report entity now uses `visibleSnapshotIds` (`app/search.mjs:74-77`). Before, search matched titles by report key alone.

### 2. B2 (high): anyone could approve someone else's snapshot

- `approve_snapshot` is offered only to a non-creator whose rights cover the data (`app/reports.mjs:133-138`). The decision inbox reads these actions, so it no longer shows snapshot approvals to employees.
- The server action enforces the same rule (`app/reports.mjs:165-175`):
  - A snapshot you cannot see returns 404.
  - A creator trying to approve gets `separation_of_duties`.
  - Any other approver without coverage gets 403.

### 3. B4 and B25 (high/low): wrong leave balance and raw type codes

- **ملخصي.** `app/routing.mjs:131-132` read `remaining_days`, a field that never existed. It now reads `available_days`, which is posted days minus reserved days. It also returns `type` (the Arabic name), `type_code`, `posted` and `reserved`.
- **الرئيسية card.** `leaveCardValue` (`app/home.mjs:43-51`, used at `:158`) shows this year's *annual* balance. It used to add up every type, which is meaningless for annual plus sick leave. The list below the card shows every type by name.
- **Type names.** `LEAVE_TYPES` and `leaveTypeName` (`app/leave.mjs:16-25`) give Arabic names such as «الإجازة السنوية» and «الإجازة المرضية».
  - A code starting with `synthetic_` gets «(رصيد تجريبي)» after its name.
  - An unknown code reads «نوع إجازة آخر (code)».
  - Balances, requests and calendar entries now carry `leave_type_name`.
- **Screens.**
  - `leave-ui.mjs` shows type names.
  - HR's opening form is now a type picker that defaults to `annual`. It used to be a free-text field prefilled with `synthetic_annual`.
  - `home-ui.mjs` and `portal-ui.mjs` show available days and any days reserved by pending requests.

### 4. B5 (high): policy acknowledgement always sent "not confirmed"

- **Cause.** `operationFields` rendered every checkbox with `value=""`. A ticked box therefore sent an empty string, and `v.confirm==='on'` was always false.
- **Fix.** Checkboxes now render `value="on"`, the browser default, and are pre-ticked when their value is `true` (`app/static/operations.mjs:110-118`).
- **Also fixed by the same change:**
  - the influencer disclosure checkbox (`influencers-ui.mjs:170`)
  - the access-review «accept incomplete» checkbox (`knowledge-access-ui.mjs:96`)

### 5. B6 (high) and part of B7: notifications

**Schema: migration `096-notifications-subjects.sql`.** The `notifications` table is rebuilt using the rename, create, copy, drop pattern from `030-payables.sql`.
- `request_id` can now be empty.
- New columns: `subject_kind`, `subject_id`, `title` and `body`.
- A CHECK requires a subject and a title whenever there is no request.
- Every existing row is copied unchanged. Old rows without a title get one when they are read, from the request title.

**Shared templates: `app/notices.mjs` (new).**
- `notifySubject` writes notices for records that are not service requests.
- `requestNotice` holds one Arabic template per request event kind.
- Date helpers produce text such as «من 4 إلى 5 أكتوبر».
- No template contains an amount, a national ID or an approver's free-text note. The note stays on the record's own page.

**Service requests (`app/workflow.mjs`).** `notify` (`:202`) now stores the request title and what happened.
- The employee gets a receipt on submit, such as «استلمنا طلبك «…»» (`:463`).
- Decisions say the outcome:
  - «اعتُمد طلبك «…»» when approved
  - «اجتاز طلبك «…» خطوة اعتماد» when one step of several is approved
  - «أُعيد إليك طلبك «…» للتعديل» when returned
  - «رُفض طلبك «…»» when rejected
- Cancelling a request no longer notifies the person who cancelled it (`:475`).
- `notifications()` (`:518`) returns `title`, `body` and `link` for each row, and includes non-request notices addressed to the user.
- The notifications page (`app/static/app.mjs:257`) shows the title and body instead of «تحديث على طلبك».

**Leave (`app/leave.mjs:151-161`, `:193-194`, `:229-238`)**

| Event | Who is told | Example |
|---|---|---|
| Submitted | The employee (receipt) and the line manager | «طلب إجازة ينتظر قرارك: …» |
| Manager approves | The employee, and HR approvers in scope | «وافق مديرك على إجازتك من 4 إلى 5 أكتوبر» |
| HR approves | The employee | «اعتُمدت إجازتك من 4 إلى 5 أكتوبر», with «خُصم 2 يوم عمل من رصيد الإجازة السنوية» |
| Returned, rejected or resubmitted | The employee, or the manager for a resubmission | Wording says the reserved days went back to the balance |

**Expenses (`app/expenses.mjs:106-112`, `:146-148`)**
- **Claims:** a notice for manager approval, finance approval, rejection and reimbursement. The text names the category and the expense date, never the amount.
- **Cash custody:** a notice when it is approved, rejected, issued or closed.

**Letters (`app/letters.mjs:257`, `:267`)**
- **Issued:** «صدر خطابك: <type>» with the reference number. The salary figure in the letter body never enters the notice; the test checks this.
- **Rejected:** a notice pointing to the reason on the letters screen.

**Attendance corrections (`app/attendance.mjs:153-157`).** The employee is told whether the correction was approved or rejected, and for which day.

Nobody receives a notice about their own action.

## Tests

- **New:** `tests/portal-audit-fixes.test.mjs`, 11 tests.
  - **B1:**
    - an employee is denied the list, open, approve, inbox, print, CSV and XLSX (the last three over HTTP)
    - the creator is allowed
    - `executive.view` sees and approves
    - a manager's department R07 is hidden from another department's manager and from employees
    - a company-wide R07 is hidden from managers
    - the R01 finance section needs finance read
    - every report is classified
  - **B4:** the portal and home show 19 available days per type with Arabic names, reservations are shown, and the HR form is a type picker.
  - **B5:** the rendered checkbox has `value="on"`, so the form sends `confirm:true` and the server accepts it; an unticked box sends `false`.
  - **Migration 096:** the new columns exist, the CHECK holds, and a row in the old shape survives the rebuild.
  - **B7:** request receipt; decision titles for approve, return and reject; the free-text note stays out; no notice to yourself on cancel.
  - **B6:** leave at each stage; expense, attendance and letter notices with no amount or ID number; nothing reaches a colleague.
- **Changed:** one assertion in `tests/search.test.mjs:128`. It expected a manager to find an R07 snapshot saved by someone else, just because the manager may run R07. **That is the B1 leak itself**, so the assertion was wrong. It now expects the snapshot to be hidden from the manager, and found once the manager holds `executive.view`.
- **`npm test`:** 714 tests, 714 pass, 0 fail. Before this change it was 703 of 703; the 11 new tests make up the difference. The procurement test did not flake in this run.
- **`npm run check`:** syntax check of 367 modules passed, source hashes match, traceability is 220 requirements in 22 domains.

## Live check

The instance ran on port 3680 with a fresh synthetic database in a temp folder under the scratchpad.
- **Data setup:** `seed`, `installServiceCatalog`, `expandDemo` and `seedHrDemo`.
- **Credentials:** a random field key and random passwords, never printed.
- **Sessions:** employee, manager, HR, outsider, and one executive (`executive.view`) account used only for this check.

The script, `scratchpad/portal-fixes-verify.mjs`, made every check through HTTP API calls. **Result: 30 of 30 passed.**

| Item | What was checked | Result |
|---|---|---|
| 1 | An employee cannot list, open, print, or export the snapshot as CSV or XLSX: 404, with no project name in the response | Pass |
| 1 | The creator can open and print the snapshot | Pass |
| 1 | The executive sees it and has the approve action | Pass |
| 1 | The manager's R07 snapshot is hidden from employees | Pass |
| 2 | The employee's inbox has no reports group, and `approve_snapshot` returns 404 | Pass |
| 2 | The executive's inbox lists the snapshot, and approval returns 201 | Pass |
| 3 | After leave was approved: ملخصي shows annual 19 and sick 5 with Arabic names, the الرئيسية card shows 19, and إجازاتي has no raw codes | Pass |
| 4 | A payload built from the rendered form is accepted: 201 | Pass |
| 5 | Request receipt and decision titles are present, with no «تحديث على طلبك» rows | Pass |
| 5 | Leave notices: «اعتُمدت إجازتك من … أكتوبر» and the manager-step notice | Pass |
| 5 | The expense notice has no amount; the attendance correction notice is present | Pass |
| 5 | The manager is told a leave awaits him; the outsider sees none of the employee's notices | Pass |
| 5 | Migration 096 is applied | Pass |

**Clean-up.**
- The server was stopped, and the temp database, field key and sessions were deleted.
- A leftover temp folder from a first run that crashed was also removed. That run failed because `seedHrDemo` already creates a user with id `ceo`.
- Port 3680 is free.
- The live database was not touched, and neither were ports 3600, 3601 or 3630.

## Skipped, with reasons

**Product gaps and decisions**
- **B3, leave cannot be requested out of the box.** This is a product gap: there is no screen to create a leave calendar or public holidays, no leave service in the catalog, and balances come only from HR openings. It belongs to recommendation 2, the full leave journey, and needs the HR manager's entitlement rules.
- **B33, leave routing needs a same-department manager.** Fixing it means deciding who approves when the line manager sits in another department: that manager, or the department's escalation contact as in the generic workflow. The HR manager or owner must decide; this is not a code bug.

**Notifications not covered this round**
- **HR cases and training.** The owner's list for this round named leave, expenses, letters and attendance corrections. HR cases are confidential, and their notice wording needs HR's agreement. Training, timesheets and performance are also still without notices.
- **Other attendance decisions.** Missions, overtime and proposed unpaid absences still send nothing.
- **Letters: prepared and cancelled.** Only issue and reject notify the employee.

**Behaviour to review**
- **Client-team snapshots (R15, R19–R22) are creator-only.** Nobody else can open them, so nobody can approve them. If they need approval, the owner should name who covers client data.
- **The rest of B7.** Still missing: "mark all as read", the ready-for-execution notice after a multi-step chain (B21), and a merged notification feed that includes `review_notices` from migration 059.

**Medium and low bugs.** B8–B32 were not in scope, apart from B25 and the B7 parts above.
