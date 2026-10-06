# Module flow fixes — the critical and high defects of the 20 September sweep

**Branch.** `worktree-agent-a364b0daa58cf5a2f`, from `codex/local-foundation` at `9f95cde`.
**Source.** `docs/product/audits/MODULE-FLOWS-SWEEP-20260920.md` (branch `worktree-agent-af98046fb937088fa`).
**Scope.** D-01a, D-01b, D-01c, D-05, D-12, D-15. Nothing else was touched.

**State.** Run locally against synthetic databases. **Not accepted by any process owner.** «Fixed» here means the
journey was exercised and the effect verified in the database or a read API — not that anyone signed off on the
behaviour. Every message added below is Arabic prose written to the platform's existing rules: it names the cause,
the rule and the fix, and it carries no salary amount into a notification.

Deliberately left alone, as instructed: `finance_grants` (D-02), `procurement.mjs` state data, migrations 107–109
and 112, and the employee-facing defects owned by the other fix agent — `discipline.mjs`, `benefits*.mjs`, the
leave notices in `leave.mjs`, and the expenses withdrawal path.

---

## 1. What changed, defect by defect

### D-01c (critical) — `POST /api/employees/:id/documents` and `/changes` returned 500 unconditionally

**Cause, not symptom.** `app/idempotency.mjs:19` bound `result.id` into `idempotency_keys.resource_id`, which is
`TEXT NOT NULL` (`app/migrations/002-integrity.sql:6`). Both routes (`app/server.mjs:824` and `:826`) wrapped a
creator that returns `employees.employeeRecord(...)` — an employee record, which has no `.id` at all. So every
call bound `undefined`, and the insert failed after the document had already been written in the same
transaction, rolling the whole thing back. With no key the request never reached the creator at all
(`400 idempotency_required`). Either way: zero rows, and no document with an expiry could ever be recorded, which
disabled the entire expiry-reminder feature downstream.

`/profile` on the same route family has no `once()` wrapper, which is why it worked — the control the sweep named.

**Fix.** Not a catch. The contract between `createOnce` and its callers is now explicit:

- `app/idempotency.mjs:10` — `createOnce` takes an optional `resourceId` reader. The default keeps the existing
  behaviour for the ~50 callers that return the row they created. It now **checks the identifier before binding
  it** and fails with a named `idempotency_resource` (500) naming the operation, instead of letting a NOT NULL
  constraint surface as an opaque platform fault. A future mis-wiring names itself.
- `app/server.mjs:572` — the route helper `once(create, read, resourceId)` passes that reader through.
- `app/server.mjs:824,826` — the two routes say which field identifies what they wrote: `r.document_id`,
  `r.change_id`.
- `app/employees.mjs:110,130` — `addDocument` and `recordChange` return the employee record **plus** the id of the
  row they just created. The response shape is unchanged for every existing reader; the idempotency row now points
  at the real document or change.

**Verified.** Document and change both written over real HTTP with a key; the repeat with the same key writes no
second row and returns the same record; the same key with a different body is `409`; no key is `400`; the
idempotency row's `resource_id` equals the created row's id.

### D-01a (critical) — every unpaid or part-paid leave died `unpriced`

**What was true.** `app/leave-types.mjs:402` wrote `status:'unpriced'` and returned when there was no contract or
no accepted `payroll_cycle` policy — the shipped state. That state itself is right: the platform must not invent a
rate. What was wrong is that it was a dead end in three ways at once — the employee was never told, the payroll
preparer never saw it, and the trigger `leave_pay_effects_fixed` (migration 098) forbade writing `amount_minor`
or `adjustment_id` after insert, so an effect born unpriced stayed unpriced forever even if the policy was
accepted the next day.

**Fix — the state is now explicit, visible and blocking.**

- `app/migrations/113-module-flow-fixes.sql` — the trigger is rebuilt to permit exactly one new transition:
  `unpriced → proposed`, writing a positive amount and an adjustment id that were both NULL. Everything else is
  as before: request, month, dates and lost days never change; a written amount is never rewritten; `withdrawn`
  remains the only other terminal state.
- `app/leave-types.mjs` — `priceLostDays()` is factored out as the single pricing rule (the contract in force on
  those days, and the day basis from the cycle policy in force on the month's last day) and returns a **named
  reason** (`no_contract` / `no_cycle`) instead of a price when it cannot compute one. `proposePayEffects()` uses
  it. Two new reads/acts: `pendingPricing(db, tenantId, month)` lists what is waiting with *today's* blocker (a
  policy accepted since does make it priceable), and `priceLeaveEffect()` prices one item — a human act, by a
  holder of payroll preparation, computed from the accepted sources, never from a number typed in.
- `app/payroll.mjs:113` — every run view carries `pending_pricing`. `submit_run` and `approve_run` are **blocked**
  while it is non-empty, with a `409 pricing_required` that names each employee, month, lost pay-days and whether
  it is ready to price or what is still missing. A new run action `price_leave_effect` clears items.
- `app/leave.mjs` — `getLeaveRequest` now returns `pay_effects`. The pending state reads
  «بانتظار التسعير — لم تُحسم بعد سياسة تحدد أجر اليوم لهذه الأيام، فلم يُحسب مبلغ ولم يصل المسير. الخصم قائم ولم يسقط.»
  The employee sees a stated pending decision, not a blank.
- UI: `app/static/payroll-ui.mjs` renders the blocking panel and the pricing form;
  `app/static/leave-ui.mjs` renders the effect on the request card and no longer says the bare «غير مسعّر».

Pricing produces a `proposed` adjustment. Approving the deduction stays a separate decision by the payroll
approver, exactly as the normal path.

### D-01b (critical) — the final-settlement clearance gate was dead code

`app/lifecycle.mjs:334` defined `clearanceBlockers`; nothing called it. Settlements approved over open custody,
unreturned equipment, fixed assets and outstanding advances.

- `app/payroll-extras.mjs:260` (`decideSettlement`) now **calls it on every approval**, reading the live state at
  the moment of the decision rather than a stale list.
- `app/lifecycle.mjs:344` — blockers now carry `action_owner`, so the refusal says who closes each item. The
  refusal reads: how many are open, then for each one its title, its outstanding amount, and who acts —
  «عهدة نقدية — … (500.00 SAR) — المالية: إقفال العهدة بمستند الإرجاع في شاشة المصروفات والعهد».
- **The override is real, narrow and audited.** `clearance_override` is a written reason of at least 20
  characters, and it is **not** available to the payroll approver by virtue of approving: it requires
  `people.manage`, the capability that owns offboarding and clearance. Migration 113 adds
  `clearance_blockers`, `clearance_override_by/_reason/_at` to `service_settlements` with a trigger that refuses
  an override missing its holder, its time or its reason. What was open at the moment of the decision is stored
  on the settlement, and the override is its own audit event (`settlement.clearance_overridden`), not a footnote
  on the approval.

A rejection passes no gate — there is no entitlement in a rejected settlement.

### D-15 (high) — the departing employee was told nothing about their settlement

- `app/payroll-extras.mjs` — `mySettlement(db, user)` is a read path for the subject alone: no employee id in the
  input, approved settlements only. It carries the award, **which article-36 reading was applied** (by name, with
  both readings side by side), the leave payout, the deductions, the net, the statutory deadline and its
  countdown. Every explicit open is logged to `settlement_views` (migration 113), as a payslip view is.
- Routes and lists: `GET /api/payroll/settlements/mine` (logged), `listPayroll().settlement` on the employee's own
  payroll screen, and a `settlement` entry in `/api/my-requests` whose due date is the м50/2 deadline and which
  reads overdue once it passes.
- `app/module-notices.mjs` — `settlementNotice` on approval. It carries the deadline and its countdown and points
  at the screen. **It carries no amount**, following the platform's own rule in `app/notices.mjs` — notices go out
  by email, and salary figures do not belong there. The figures are one click away in the read path.
- `app/static/payroll-ui.mjs` renders the whole thing for the subject.

No other employee's data is reachable: manager, preparer and approver all read `null` from this path.

### D-12 (high) — accepting a resignation succeeded loudly while the offboarding bundle failed silently

Two halves, both fixed:

- **Visible and actionable.** `app/resignations.mjs:195` still opens the bundle inside a savepoint — a template
  failure must not undo an accepted resignation — but the outcome is now part of the response
  (`offboarding_opened`, `offboarding_blocked`, `offboarding_note`, `offboarding_next`), a flag on the record
  (`offboarding_blocked`, `offboarding_action_owner`) and an `alerts` entry on the board. The staff-only note that
  no screen surfaced is no longer the only trace.
- **The right holder.** `app/module-notices.mjs` — a new `offboardingNotice` tells the holders of `people.manage`,
  the account that can actually open the bundle, in both cases: `offboarding_opened` («افتح «رحلة الموظف» …
  التسوية النهائية لا تُعتمد قبل إغلاقها») or `offboarding_blocked` («… استعمل «فتح حزمة المغادرة» بعد معالجة
  السبب»). In the shipped seed that account is disjoint from the `hr.contracts.approve` holders who were being
  notified before. The deemed-acceptance job handler does the same, since it has no human actor.

### D-05 (high) — leave accrual had no scheduler

A run stays a human decision; nothing was automated.

- `app/leave-accrual.mjs` — `dueAccrualPeriods()` / `allDueAccrualPeriods()` name the periods that have completed
  under an accepted policy and were never run (capped at 24 back). A period that has not finished is never called
  due. `accrualBoard` gains `due_periods` and an `accrual_due` alert.
- `app/reminders.mjs` — a new section in the existing daily `reminders.daily` job, through the existing queue,
  reminds the holders of `hr.policy.accept` — the owners of the run decision. **Once per period**, keyed in
  `reminder_log`, not once a day. The body ends «افتح «استحقاق الإجازات» لتشغيلها بقرارك؛ المنصة لا تُشغّلها
  آليًا.» The reminder posts nothing: no `accrual_runs` row, no ledger entry.
- The employee-facing zero state: `app/leave-types.mjs` — `pendingAccrual()` feeds both the refusal and the
  balance row. «المتاح 0 يوم» is still stated plainly, and is now followed by
  «… فترة استحقاق اكتملت (…) ولم يُقيَّدها مدير الموارد البشرية بعد؛ الرصيد المعروض لا يشملها. التقييد قرار يدوي
  ولا يجري آليًا.» The balance board carries the same sentence and an `accrual_pending` object.

---

## 2. Migration

`app/migrations/113-module-flow-fixes.sql` — the only migration on this branch. Migrations 001–106 are untouched,
and 107–109 and 112 belong to the concurrent agent.

1. Rebuilds `leave_pay_effects_fixed` to allow the single `unpriced → proposed` pricing transition.
2. Adds `clearance_blockers`, `clearance_override_by`, `clearance_override_reason`, `clearance_override_at` to
   `service_settlements`, with a trigger requiring an override to carry holder, time and a written reason.
3. Adds `settlement_views`, so reading a settlement is logged as reading a payslip is.

---

## 3. Tests

`tests/module-fixes-critical.test.mjs` — 16 tests, one to three per defect. Each was run against pristine `9f95cde`
first and fails there; the pre-fix behaviour recorded from that run is:

| Defect | Behaviour on `9f95cde` |
|---|---|
| D-01c | `POST …/documents` → `500`, `POST …/changes` → `500`, `employee_documents` 0 rows, `employee_changes` 0 rows |
| D-01a | `allDueAccrualPeriods`/`pendingPricing`/`priceLeaveEffect` do not exist; effect stays `unpriced`, `payroll_adjustments` 0 |
| D-01b | `decideSettlement` → `{"status":"approved"}` over an issued custody and an outstanding advance |
| D-15 | subject notifications 0, `my-requests` settlement entries 0, `listPayroll().settlement` undefined |
| D-12 | accept returns `{id}` only; `lifecycle_bundles` 0; the `people.manage` holder's notifications `[]`; no board alerts |
| D-05 | the daily reminder result has no `accrual` section at all |

**Two existing tests were updated, not weakened.** `tests/payroll-extras.test.mjs` (PAY-09) and
`tests/payroll-rules.test.mjs` (the article-36 settlement test) both approved a settlement with no offboarding
bundle — the exact behaviour D-01b says must stop. Each now asserts the new `clearance_open` refusal first, then
opens a bundle and approves. `docs/testing/payroll-extras-20260920.txt` is the re-recorded run for the
traceability digest of the edited file (`npm run trace -- --record-results`); no requirement completion state was
changed.

---

## 4. What I found worse than the sweep reported

- **D-01c is worse than «the wrapper binds `undefined`».** The failure is a raw `TypeError` escaping as
  `internal_error` before any SQL constraint is reached, so the server log shows no business cause at all. And the
  blast radius is larger than the route: because no document with an expiry can be stored, the daily expiry
  reminder in `app/reminders.mjs` has nothing to read for employee documents. The whole expiry feature was dead,
  not merely the write path.
- **D-01a was unrecoverable, not merely silent.** The sweep says accepting a `payroll_cycle` policy «fixes it
  completely». It fixes it for *new* leave only. The trigger in migration 098 made every effect already written
  `unpriced` permanently unpriceable — the deduction was lost for good, with no path in the product to recover it.
  That is why this fix needed a migration rather than only a read.
- **D-01b's refusal had nowhere to point.** `clearanceBlockers` did not carry `action_owner`, so even once wired
  the refusal could only say *that* something was open, not who holds it. The owner text exists in
  `deriveClearance` and simply was not propagated.
- **`hr` already holds `payroll.prepare` and `hr.policy.prepare` by role**, so granting them explicitly fails with
  `already_default`. Worth knowing when writing fixtures; it cost a cycle here.

## 5. Not done, and deliberately

- The override for D-01b is gated on `people.manage`. In the shipped seed that account is usually **not** the
  payroll approver, so an override needs two people. That is the intent, but it means an install where one person
  holds both can self-override. Naming a separate capability for the override is an owner decision, not mine.
- D-01a prices into the leave effect's own month and routes the adjustment to the first open run month. The effect
  row's `month` stays the month the days fell in (the trigger forbids changing it), which differs from the
  original propose path, where the row carried the shifted month. Both are explained in the stored note, but the
  two paths are not identical and a reader comparing them will notice.
- The D-05 reminder fires for holders of `hr.policy.accept`. If nobody holds it — the shipped state — nothing is
  sent and nothing says so. The board alert is the only signal, and only to someone who already opens that screen.
