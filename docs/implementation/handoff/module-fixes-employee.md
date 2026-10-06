# Handoff: employee-facing fixes from the module-flows sweep (20 September 2026)

State: **built locally, tested locally.** Nothing here is accepted by a process owner, and nothing was run against the live
database or ports 3600/3601/3630. Every fix below closes a defect recorded in
`docs/product/audits/MODULE-FLOWS-SWEEP-20260920.md`; the sweep's own wording is quoted where it drove the design.

Branch: `worktree-agent-a83d140679c25d9bc` (from `codex/local-foundation`, HEAD `9f95cde`).

Ten defects were assigned: **D-10, D-11, D-03, D-04, D-08, D-06, D-09, D-07, D-14+D-24, D-21+D-20.** All ten are fixed.
Out of scope by instruction and untouched: `finance_grants` (D-02), `procurement.mjs`, migrations 107/108/109/112,
the employee-document routes in `app/server.mjs` (D-01c), `leave-types.mjs` pay effects (D-01a), `lifecycle.mjs`
clearance (D-01b), `resignations.mjs` (D-12), `payroll-extras.mjs` settlement (D-15), `leave-accrual.mjs` (D-05).

## 1. Migration 114

`app/migrations/114-module-flow-fixes.sql`. It **adds** only — no applied table is rebuilt and no existing row is edited.

| Part | What it does | Defect |
|---|---|---|
| `letter_template_starters` row for `discipline_notice` | The bilingual article-121 starter text that migration 097 never shipped. A draft like every other starter: adopted by the template preparer, approved by someone else who holds `hr.letters.issue`. Ten placeholders, all filled by the discipline module from the decided case. | D-11 |
| `withdrawn_at` / `withdrawal_reason` on `expense_claims` and `custodies` | The withdrawal mark. Two triggers make a withdrawal final and confine it to before the first decision. The receipt uniqueness index is dropped and recreated with `AND withdrawn_at IS NULL`, so a withdrawn receipt does not block re-filing. | D-09 |
| `benefit_ticket_bookings` | Where a booking made at the travel agent (outside the platform) is recorded against a `company_expense` payout proposal, closing the ticket flow. | D-08 |

**Why a mark and not a new status for D-09.** `expense_claims.status` and `custodies.status` carry a `CHECK` list from
migration 032, and SQLite cannot widen a `CHECK` without rebuilding the table. Both tables sit under live foreign keys
(`travel_expense_links.claim_id`, `expense_claims.custody_id`) and `PRAGMA foreign_keys` is ON inside the migration
transaction, so a rebuild is a real risk for a cosmetic gain. The row keeps its status for the trace; `withdrawn_at`
ends it. Every reader that could have miscounted a withdrawn record was fixed with it (§4).

## 2. Defects, file by file

### D-10 — disciplinary fine percentages, high, reaches the article-121 notice
`app/discipline.mjs:65` (`pct`). The old expression `(bp/100).toFixed(bp%100?2:0).replace(/\.?0+$/,'')` stripped the
integer zeros along with the fractional ones: `fine:5000` (50%) printed «5%», identical to `fine:500`; `fine:1000`
printed «1%». The unit is unchanged and correct — `day_bp` is ten-thousandths of a day's wage, so the percentage of the
daily wage is `bp/100` — the rendering was wrong. The integer part and its fraction are now formatted separately and
only a trailing fractional zero is dropped. One function feeds all four call sites the sweep traced: the decider's menu
(`:330`), the case view (`:271`), the **م121 notice** (`:452`) and the م122 penalty sheet (`:545`).

### D-11 — the article-121 notice could not be issued, high
- `app/migrations/114-...sql` ships the starter, so `POST /api/letters/templates/discipline_notice/adopt_starter`
  returns 201 instead of 404 and the type shows `adopt_starter` in the templates board.
- `app/letters.mjs` — new `templateGap(db,tenantId,code)` and `templateRequired(...)`. The gap computes, once, the exact
  next step (`add_letter_type` / `activate_letter_type` / `approve_template` / `adopt_starter` / `draft_template`), the
  capability it needs, the named holders of that capability, who grants it when nobody holds it, and the template's
  placeholders with their Arabic names. `issueInitiatedLetter` and `adoptStarter` now refuse with that text and carry it
  in `error.details`.
- `app/discipline.mjs` — `noticeGate(db,c)` puts the same thing on the case itself as `notice_gate`, for a case at
  `decided` with no notice yet, including the consequence («لا يبدأ سريان مهلة التظلم (م126)…»). The employee sees it on
  their own case, not only HR.
- **The approval gate stays**: adopting creates a draft, the adopter cannot approve their own draft
  (`separation_of_duties`), and an account without `hr.letters.issue` cannot approve at all.

### D-03 — the employee was never told anything about medical cover, critical
`app/benefits.mjs`. The file imported no notifier. It now imports `notifySubject` and has a `tell()` helper (savepoint-
guarded, the same pattern `benefits-portal.mjs` already uses) that notifies the subject on **enrolment**
(`recordEnrolment`), **confirmation** and **removal** (`enrolmentAction`), and on **dependant added / removed**
(`addDependant`, `removeDependant`). `app/notices.mjs` gains `medical_enrolment → #my-benefits`.
No medical detail, no policy number, no member number, no dependant relation or birth date and not HR's free-text
removal reason travels in any notice — only what happened, its date, and where to read the rest.

### D-04 — the benefits letter claimed an attachment that did not exist, high
`app/benefits-portal.mjs`. The fallback branch (no published `benefit_letter` template) told the employee
«الخطاب مرفق في «مزاياي» أو يسلّمه فريق الموارد البشرية» while `letters`, `letter_requests` and `requestView.documents`
were all empty. It now asserts only what is true: the letters-module path when a letter request exists, the attachment
when a document is actually on the request, and otherwise that **no platform document was issued**, naming the reference
HR recorded and that it is handed over outside the platform. The option list also warns before submission
(`options[benefit_letter].note`) when the type has no approved template.

### D-08 — booking-type ticket claims dead-ended, high
`app/benefits-portal.mjs` + migration 114. A `company_expense` proposal had `actions: []` for every role and no reader.
It now has a next step and a named owner: **`record_booking`, held by `hr.benefits.manage`** (the benefits team books at
the travel agent outside the platform and records the reference). Added: `recordTicketBooking`, `bookingState` on the
proposal in both the employee's and the admin's view, a notice to the benefits-capability holders when the proposal is
created, a notice to the employee with the booking reference, and a `record_booking` route
(`POST /api/benefits-admin/proposals/:id/record_booking`). `hand_to_payroll` still refuses — correctly, it is not a
payroll movement — but the refusal now names the real next step and its owner. The employee's completion notice says who
will book the ticket instead of «مقترح على المالية ولم يُنفذ بعد».

### D-06 — the leave notice never stated the pay tier, high
`app/leave.mjs`. New exported `paySummary(terms)` groups `leave_request_terms.pay_json` by `rate_bp` and returns the
tiers with their day counts, `unpaid_days`, `reduced_days`, a sentence, and whether a deduction will be proposed. It is
attached to the leave record as `terms.pay_summary` and used in the approval notice. 60 sick days at 75% then 0% now
read «…الأجر: 30 يوم تقويمي بنسبة 75% من الأجر، 30 يوم تقويمي بلا أجر. يُقترح على المسير خصم…» instead of
«سُجلت 60 يوم تقويمي». A fully paid leave says so rather than staying silent. **No amount is in the notice** — the money
is computed in payroll, and the notice points at «الإجازات» و«قسائم راتبي».

### D-09 — no expense claim or custody could be withdrawn, high
`app/expenses.mjs`, `app/server.mjs`, migration 114. New owner actions **`withdraw_claim`** and **`withdraw_custody`**,
available to the filer alone and only before the first decision (status `submitted` with no manager or finance decision;
custody `requested` with no approval). Both are audited (`expense.withdrawn`, `custody.withdrawn`) with the reason, and
both are enforced twice: in the view's action list and by trigger. A withdrawn record shows
«مسحوبة بطلب مقدّمها» / «مسحوب بطلب صاحبه» and has no further actions for anyone.

### D-07 — prior-assignment overtime refused without naming what was missing, high
`app/access.mjs` gains `capabilityName`, `capabilityHolders` and **`capabilityGap(db,tenantId,capability,{exclude})`** —
one source for "which capability, who holds it, who may act after separation of duties, whether any default role carries
it, and who grants it". `app/overtime-rules.mjs` gains `assignmentGap(db,a)`, which names the stopped step
(`authorise_assignment` → `hr.attendance.approve`; `approve_assignment_budget` → `hr.attendance.manage`) and its
separation rule («…فالمسار يحتاج أربعة أشخاص متمايزين»). It feeds three places: the refusal, `next_step` on the
assignment in the board, and the employee's own notice, which no longer promises a decision nobody can take.
`hr.attendance.approve` still has **no default role** — see §5.

### D-14 and D-24 — the platform's commonest refusals, applied centrally
`app/validation.mjs` is the single place:
- **`text()`** now distinguishes missing, wrong type, too short, too long and a control character, names the limit and
  what was entered, says how much to shorten, and carries `details {label, min_length, max_length, length, reason}`.
  A 5-character and a 5,000-character self-assessment no longer produce the same sentence. An optional field (`min=0`)
  still accepts an empty string exactly as before.
- **`moneyMinor()`** is new and is now the only money parser in `expenses.mjs` and `benefits-portal.mjs`. A missing
  amount is `missing_field` with an example; a malformed one is `invalid_money` and quotes what was entered.
- **`actionUnavailable(action,{...})`** builds the refusal from the same computed state the board uses for its buttons:
  what was asked, the record's state, why it was refused, what *is* available to this account, and who owns the next
  step — plus `details` for the UI.

Call sites converted: `discipline.mjs` (case actions), `expenses.mjs` (claims and custodies), `letters.mjs` (letter
requests), `benefits-portal.mjs` (withdraw, HR step, finance step, hand-to-payroll), `overtime-rules.mjs` (assignments),
`talent.mjs` (performance reviews — the `invalid_state` the sweep traced at `:128`, now naming the missing
`hr.performance.calibrate` and its holders), `travel.mjs` (`:136`). `resignations.mjs` was left to its owner.

### D-21 and D-20 — modules that notified nobody
`app/notices.mjs` gains the subject kinds and their screens (`one_to_one`, `follow_up_item`, `feedback_note`,
`feedback_request`, `review_360_nomination`, `recognition_card`, `policy_ack_round`, `medical_enrolment`) and their mail
categories; without the `SUBJECT_LINKS` entry the guard would have dropped every call silently.

- `app/feedback.mjs` (was a whole-file grep miss for `notifySubject`): one-to-one scheduled, agenda item added, meeting
  held, meeting cancelled, follow-up assigned, follow-up closed, feedback note written, note withdrawn, feedback
  requested, answered, declined, 360 nomination awaiting a third party, 360 nomination approved (the rater is told to
  respond). **No notice on a 360 submission** — anonymity first.
- `app/policy-acknowledgements.mjs`: recipients are told when a round opens and when they are added by
  `sync_recipients`; `remind_round` **sends the reminder** and now returns `{pending, reminded, channel}` where
  `reminded` is what was actually delivered, not a counter that moved.
- `app/engagement.mjs`: a recognition card notifies its recipient. The card text stays on its screen.
- `app/timesheets.mjs`: `remindMissing` writes the reminder row **and** the notice, and returns `notified`.
  `{"created":2}` with zero notifications was the sweep's D-20.

Note: no notice carries a body, a note, a minute or an amount. Every one of them says what happened and where to read it.

## 3. Files touched

Added: `app/migrations/114-module-flow-fixes.sql`, `tests/module-fixes-employee.test.mjs`, this file.

Edited: `app/validation.mjs`, `app/access.mjs`, `app/notices.mjs`, `app/discipline.mjs`, `app/letters.mjs`,
`app/benefits.mjs`, `app/benefits-portal.mjs`, `app/leave.mjs`, `app/expenses.mjs`, `app/overtime-rules.mjs`,
`app/talent.mjs`, `app/travel.mjs`, `app/feedback.mjs`, `app/policy-acknowledgements.mjs`, `app/engagement.mjs`,
`app/timesheets.mjs`, `app/reports.mjs` (one predicate), `app/static/expenses-ui.mjs` (two button labels),
`app/server.mjs` (two route lines: the withdrawal actions and `record_booking`; the employee-document routes were not
touched).

## 4. Readers checked for the withdrawal mark

`custodyBalance` pending total, the duplicate-receipt check, the open-custody check (all `expenses.mjs`) and report R34
(`reports.mjs`) now exclude withdrawn records. `bank-reconciliation.mjs`, `cash-forecast.mjs`, `ledger.mjs`,
`profitability.mjs`, `travel.mjs` and `lifecycle.mjs` read only `finance_approved` / `reimbursed` / `issued` / `closed`
/ `approved`, which a withdrawal can never reach, so they need no change.

## 5. Left for an owner decision — deliberately not changed

1. **`hr.attendance.approve` has no default role** (`app/access.mjs:38`). Giving it one would silently hand a statutory
   approval (م76(2)) to a role the owner never chose, so the refusal was made specific instead. Until someone is granted
   it, no prior-assignment overtime can start — the platform now says exactly that, to the manager and to the employee.
2. **Who owns a booked ticket.** `record_booking` was put on `hr.benefits.manage` because that is the team that arranges
   cover and benefits today. If the owner wants procurement or finance to hold it, it is one capability constant
   (`BOOKING_OWNER_CAP` in `benefits-portal.mjs`) and one migration for the notice.
3. **The article-121 starter text is a draft, not an approved template.** Its Arabic and English halves are a faithful
   rendering of م121's requirements, but the company's legal wording is the owner's to write. It ships unapproved by
   design, and HR approval remains mandatory before any notice is issued.
4. **A withdrawn claim keeps `status='submitted'`.** Honest and safe, but it means a future reader that filters on
   status alone could miscount. The four readers that mattered were fixed; a new one must remember `withdrawn_at IS NULL`.
   Widening the `CHECK` properly needs a table rebuild and an owner willing to accept that risk.
5. **The `benefit_letter` fallback still exists.** D-04 was fixed by telling the truth, not by removing the manual path,
   because removing it would block the letter entirely until someone approves the migration-105 template. Once that
   template is approved the platform issues a real document with a reference and a QR code, and the fallback is dead.

## 6. Verification

`npm run check` passes. `npm test` passes. `tests/module-fixes-employee.test.mjs` holds 17 tests, each written to fail
on the code before its fix. They run against the modules over their real entry points with real transactions and real
capability grants; no module function was bent to make a journey pass.
