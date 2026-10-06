# Unifying the duplicated HR rules, and one screen to accept them

Branch `worktree-agent-a8d1416721d7f48e9`, from `codex/local-foundation` at `6e9fb81`. Nothing was pushed, `.env` was not touched, and no applied migration (002–104) was edited. **No migration was added:** everything here is code-level, for the reason in §6.

The seven HR modules were built by separate agents, so some decisions ended up written in two places. This change makes each of those one decision, entered once, read everywhere; and it adds a single «سياسات الموارد البشرية» screen where the HR manager sees every draft policy and what is still blocking the modules.

**Nothing here is accepted.** Every value is still a draft until its owner accepts it. The open decisions in `integration-20260919.md` §6 stay open — this change only makes sure each of them is asked **once**.

---

## 1. Unpaid leave over 20 days — one setting

**Before.** Two settings, seeded to the same numbers, with nothing keeping them equal:

| | Where | Read by |
|---|---|---|
| Threshold | `leave-types.mjs` unpaid type `limits.accrual_stops_after_days: 20` | `leave-accrual.mjs` — stops the annual accrual |
| Threshold | `regulation_policies` kind `settlement`, `unpaid_leave_threshold_days: 20` | `payroll-extras.mjs` — deducts service days |
| Mode | `leave-types.mjs` unpaid type `open[]` — an **unanswered question** | nothing |
| Mode | `settlement` rule `unpaid_leave_mode: 'excess'` — an **answered, enforced** choice | `excludedServiceDays` |
| (dead) | `limits.service_deduction_after_days: 20` | **nobody** — declared a rule the module did not own |

**After.** The leave-types policy is the authoritative home, because the regulation puts the rule there (Art. 91.3 sits in the leave chapter, alongside Art. 86.2b and 91.6).

- `REGULATION_LEAVE_TYPES.unpaid.limits` no longer carries either day count. The decision lives in a new top-level `unpaid_leave` block in the policy parameters: `{threshold_days, mode, articles}`, `mode` starting `null`.
- `prepareLeaveTypesDraft` takes an optional `unpaid_leave_mode` (`excess` | `total_when_over`). The preparer writes it into the dated draft; the HR manager accepts or rejects the draft as written. Acceptance does **not** edit the policy, because migration 098's `leave_type_policies_fixed` trigger forbids that on purpose.
- `app/hr-rule-basis.mjs` `unpaidLeaveRule(db,tenant,date)` resolves the live value and says where each half came from.
- `leave-accrual.mjs` and `payroll-extras.mjs` both read that one resolver. The dead `service_deduction_after_days` is gone.
- Accepting a `settlement` rule no longer asks for the threshold or the mode a second time: `decideRule` copies them from the accepted leave policy and records the copy in the audit entry (`unpaid_leave_from_leave_policy`). The two stores cannot drift.

**Migration-safe path for what is already stored.** `leavePolicyUnpaidRule` reads the old shape (`types[unpaid].limits.accrual_stops_after_days`) when a policy accepted before this change has no `unpaid_leave` block. A tenant that accepted only the settlement rule keeps being decided by it (`threshold_source: 'settlement_policy'`). No stored number changes, no calculation stops, no accepted decision is reinterpreted. When the two stores disagree, the leave policy wins **and the disagreement is printed** in `mismatch[]`, on the new screen and in the readiness checklist — it is never silently resolved.

**Surfaced once.** The «سياسات الموارد البشرية» screen shows it under «قيم تقرأها أكثر من وحدة» with its articles, its source policy, and the list of modules that read it.

Tests: `tests/hr-policy-unify.test.mjs`, first three tests.

---

## 2. The Art. 116 fine cap — one wage basis, one cap

**Before.** The monthly Art. 116 ceiling was defined twice, agreeing only by luck:

| | 097 discipline schedule | 102 `deductions` rule |
|---|---|---|
| Monthly cap | `monthly_fine_cap_days: 5`, range **1–5** | `fines_cap_days: 5`, range **0–30** |
| Day divisor | `day_basis_days: 30`, range 28–31 | `day_basis_days: 30`, range 28–31 |
| Wage | `wage_components` — configurable, and listed in the schedule's own `open_values` | hardcoded `monthly_total_minor` (the whole contract) |

`discipline.mjs propose_deduction` classes its adjustment as `fine` (integration fix, 20260919), so both caps govern the same money. If the HR manager narrowed `wage_components` to basic-only — which the schedule explicitly invites — discipline would compute a fine on basic while the pre-run check measured it against a cap computed on the full total. Art. 116 would then be enforced against the wrong wage in one of the two places.

**After.** The `deductions` rule is the authoritative home (it is the policy whose subject is «سقوف الاستقطاع من الأجر», citing م51 and م116), and it gains `wage_components`.

- `capBasis(db,tenant,date)` in `app/hr-rule-basis.mjs` returns `{monthly_fine_cap_days, day_basis_days, wage_components}` with a source for each: the `deductions` policy, else the accepted discipline schedule, else the pre-change default.
- `discipline.mjs propose_deduction` computes the daily wage and the monthly ceiling from `capBasis`, not from its own schedule parameters.
- `payroll-rules.mjs` measures the same wage: `activeWage` (advance cap, classified-deduction cap) and `ruleChecks` (pre-run) now sum the contract's pay lines filtered by `capBasis.wage_components` instead of taking `monthly_total_minor`.
- `fines_cap_days` is range-corrected to **1–5**, matching the discipline schedule, so neither store accepts a number the other would reject.
- Where the two stores disagree, `capBasis().mismatch` says so and names the one the platform obeys. The discipline board now carries `cap_basis` so whoever proposes a fine sees the number the payroll run will check it against.
- The Arabic strings that hardcoded «خمسة أيام» (the employee's rights list, the deduction notice) now read the number from the basis.

**Nothing changes today.** The seeded `wage_components` on acceptance is all four components, which is exactly `monthly_total_minor`. The test asserts that the caps are byte-identical.

**The test asked for.** `tests/hr-policy-unify.test.mjs`, "Art. 116: a discipline fine and another fine in the same month land exactly on the cap": a 10,000.00 monthly wage, cap = 5 × 1,000,000 ÷ 30 = **166,666 halala**. A discipline fine of a quarter day (2,500 bp) proposes 8,333; a second classified fine of 1,583.33 brings the month to **exactly 166,666** and is accepted; one more halala is refused with `deduction_cap` by the same check the run will apply.

A second test narrows the schedule's `wage_components` to `['basic']`, shows the schedule answering while no `deductions` policy is accepted, then shows the `deductions` policy taking over and the mismatch being reported rather than hidden.

---

## 3. The full duplicate sweep

Swept across `app/hr-contracts.mjs`, `leave-types.mjs`, `leave-accrual.mjs`, `attendance-policy.mjs`, `attendance-rules.mjs`, `attendance-extras.mjs`, `attendance.mjs`, `discipline.mjs`, `payroll-rules.mjs`, `payroll.mjs`, `benefits-portal.mjs`, `benefits.mjs`, `work-calendar.mjs`, `overtime-rules.mjs`, `static/leave-count.mjs`, and migrations 097, 098, 099, 102, 103.

Legend: **(a)** the same value or logic literally duplicated · **(b)** the same decision with different shapes or defaults · **(c)** genuinely different, only looks alike.

### Unified in this change

| # | Concept | Was | Now |
|---|---|---|---|
| D1 | Unpaid-leave threshold **(a)** | `leave-types.mjs:79` `accrual_stops_after_days:20` · `102:50` `unpaid_leave_threshold_days:20` | one value, `unpaidLeaveRule()` |
| D2 | Unpaid-leave mode **(b)** | `leave-types.mjs:82` open question · `payroll-rules.mjs:17` enforced choice | one decision in the leave policy, copied into the settlement rule on accept |
| D3 | `service_deduction_after_days` **(a, dead)** | `leave-types.mjs:79`, read by nobody | removed |
| D4 | Art. 116 monthly cap **(a)** | `discipline` `monthly_fine_cap_days` (1–5) · `payroll-rules` `fines_cap_days` (0–30) | `capBasis().monthly_fine_cap_days`, both ranges 1–5 |
| D5 | Wage basis under the caps **(b)** | `discipline` `wage_components` (configurable) · `payroll-rules` `monthly_total_minor` (fixed) | `capBasis().wage_components`, read by both |
| D6 | `day_basis_days` in the caps **(a)** | `097:51` and `102:56`, both 30, two owners | `capBasis().day_basis_days` |
| D7 | `day_basis` enum resolver **(a)** | `payroll.mjs:34` used `range.days`; `leave-types.mjs:392` used a string slice | one `cycleDayBasis()` |
| D8 | `halfUp` money division **(a)** | five identical private copies | exported once from `hr-rule-basis.mjs`; `discipline`, `payroll-rules` and `leave-types` import it (`payroll.mjs` and `payroll-extras.mjs` keep theirs, §5) |
| D9 | Accepted rounding rule not honoured **(b)** | `roundMoney`/`riyal_up` obeyed by `payroll.mjs` alone | the discipline fine and the leave pay-effect deduction now pass through `roundMoney(…, roundingMode(…))`. Provably a no-op under the default `halala`; it only takes effect once the HR manager accepts `riyal_up` (م50/5) |
| D10 | Payday shift ignored the tenant's working days **(b)** | `payroll-rules.mjs:291` used `work-calendar`'s hardcoded `WEEKEND={5,6}` (the **service SLA** week) | `shiftToWorkingDay` takes an optional workday set; `paydayFor` passes the accepted `working_time` policy's `workdays`. Falls back to the old behaviour when no policy is accepted (م48) |
| D11 | Hardcoded «العشرين» / «خمسة أيام» in Arabic strings **(a)** | `leave-accrual.mjs:252`, `discipline.mjs:519`, `discipline.mjs:593` | all three read the live number, so the text cannot contradict the setting |

### Found, named, and deliberately left alone

Each of these is real. They are listed here rather than changed, with the reason.

| # | Concept | Where | Why left alone |
|---|---|---|---|
| L1 | **Grace minutes has two rival write paths** | `static/contracts-ui.mjs:51` submits only `{workdays,start,end,grace_minutes}` and **silently drops** `ramadan`, `overtime`, `permission_monthly_cap_minutes`, `location`; `static/attendance-ui.mjs:168` submits the full set | A portal-UI bug in a shared static file that the parallel "portal bugs" agent owns. **This is the most consequential unfixed item**: preparing a `working_time` policy from the Contracts screen wipes the overtime, Ramadan, permission-cap and location rules. It needs one owner, not two edits |
| L2 | Grace default 30 in `contracts-ui.mjs:43` vs prefilled from policy in `attendance-ui.mjs:163` | same two files | same owner as L1 |
| L3 | Grace window vs discipline lateness bands A01–A07 **(c)** | `attendance.mjs:83` vs `097` rows «لغاية 15 دقيقة» | Genuinely different, but **coupled**: `discipline.mjs:359` needs `state==='late'`, produced by the grace comparison. A 30-minute grace makes A01/A02 unreachable. This is a policy question for the HR manager, not a code duplicate — added to the open decisions below |
| L4 | `day_basis` enum (`thirty`/`calendar`) vs `day_basis_days` integer **(b)** | `payroll_cycle` policy vs `deductions`/`discipline`/`overtime` | **Made explicit instead of merged.** They are different subjects: one is the day basis for *paying* a month's wage, the other the fixed divisor for *caps and fines* (م116 reads with م50/1). `cycleDayBasis()` carries a comment saying so. A tenant picking `calendar` still gets a flat 30 in the caps — a deliberate reading that the finance owner should confirm |
| L5 | Rounding in overtime and benefits still `Math.round` | `attendance-policy.mjs:100`, `benefits-portal.mjs:182,301` | `overtimeAmountMinor` is a pure function with no db handle, and the benefits figures are employee-facing estimates. Wiring the accepted rounding rule into them changes amounts the employee sees; it belongs with the finance owner's decision (§6 item 1 of the integration handoff) |
| L6 | Three notions of a working day/week's hours **(b)** | `hour_divisor_hours` (pay divisor, default 8) · `expectedMinutes` (real shift length from `start`/`end`) · `weekly_hours` (typed per contract, 1–48) | Nothing validates they agree; during Ramadan the 6-hour day is still divided by 8. A real defect, but the fix is a policy decision about which is authoritative, not a merge |
| L7 | Three stores of "which days are working days" **(b)** | `working_time.workdays` (tenant) · `shift_assignments.workdays_json` (per employee) · `leave_calendars.weekdays_json` (per department) | Three legitimate scopes that can still contradict each other for one employee on one date. Merging them is a data-model change, not a rule unification |
| L8 | `[0,1,2,3,4]` and `WEEKEND={5,6}` hardcoded **(a)** | `static/leave-count.mjs:18` · `work-calendar.mjs:4` | The same Sun–Thu week stated twice, inversely. `work-calendar` is the **service SLA** calendar used by ~20 modules; changing it globally is out of scope. Only the payday path was corrected (D10) |
| L9 | Four hand-rolled copies of the approved-holidays query **(a)** | `work-calendar.mjs:10` (Set) · `leave-types.mjs:160` (Array) · `attendance.mjs:45` (Map) · `overtime-rules.mjs:42` (exists?) | Same query, four return shapes. Merging touches `attendance.mjs`, which the parallel agents are in |
| L10 | A second holiday store **(b)** | `leave_calendars.holidays_json`, unioned in `leave-types.mjs:163` | `leave-types.mjs:158` already documents the intent («مصدر العطل واحد») and new calendars are created with `'[]'`. Legacy calendars can still inject holidays that `holidaySet` — and so discipline deadlines and payday shifting — never see. Needs a data audit before the union is dropped |
| L11 | Housing = 25% of basic, three copies **(a)** | `102:62` `housing_bp_of_basic:2500` · `103:33` `{"percent":25}` · **`benefits-portal.mjs:301` hardcoded `25`** | Two modules raise the *same* warning about the *same* discrepancy to two audiences, and the hardcoded one will keep saying "25%" after HR changes the policy. In `benefits-portal.mjs`, owned by the parallel wiring agent |
| L12 | Probation end off by one **(a/b)** | `hr-contracts.mjs:59` and `leave-types.mjs:291` inclusive (`-1`); **`benefits-portal.mjs:138` exclusive** | Benefits unlock one day later than leave eligibility for the identical contract. A one-line bug in the parallel agent's file — flagged, not touched |
| L13 | Art. 116 five-day ceiling hardcoded in the parser | `discipline.mjs:57` `bp>50000` | **Correct as written**: that is the statutory maximum, while `fine_cap_days_per_violation` is the tenant's narrower choice, enforced at `:97` and `:437`. Named here so nobody "unifies" it away |
| L14 | Per-violation cap vs monthly cap **(c)** | `fine_cap_days_per_violation` vs `monthly_fine_cap_days` | Art. 116 imposes both. Correctly modelled. The per-violation cap stays in the discipline schedule (it constrains what the authority may choose); only the monthly cap moved to the deductions policy (it constrains what payroll may withhold). `capBasis()` returns both, with a comment saying why they live apart |
| L15 | Sick-leave tiers stated four times **(a)** | `leave-types.mjs:32,33,35,313` — `pay_tiers`, the prose, `entitlement.days:120` (= 30+60+30), and the referral message | Editing the tiers without editing 120 moves the medical-committee referral. Derivable, but `entitlement.days` is read by the generic event/window logic for every type; deriving it for one type only would make the shape inconsistent |
| L16 | Overtime caps restated in their own citation string **(a)** | `attendance-policy.mjs:16` numbers vs `:10` `RULE_ARTICLES.overtime` prose («سقوف 3 و8 و20 ساعة») | The citation is persisted into the policy and shown to the accepter, so editing `RULE_DRAFT` leaves the citation lying. Same file family as L1 |
| L17 | Annual entitlement in two accepted policies **(b)** | `leave-types.mjs:26` `entitlement.days:30` (displayed) vs `leave_accrual_policies.accrual_days` (enforced) | The employee is shown 30 while the real number is whatever the accrual policy says. No constraint ties them. A genuine second source that needs the HR manager to decide which one is the entitlement |
| L18 | `addDays` × 8, Riyadh `today()` × 8 | across the modules | Date arithmetic, not a rule value. `attendance.mjs` and `overtime-rules.mjs` use a hardcoded `RIYADH_OFFSET` while the rest use `Intl`; equivalent today, worth one helper eventually |
| L19 | `end_of_service.wage_base` vs `discipline.wage_components` **(a, structurally)** | `hr-contracts.mjs:107` vs `discipline.mjs:91` | Both are "pick the pay components that make up الأجر", written twice. **Deliberately kept apart and now named for it**: the end-of-service base (م36) and the deduction-cap base (م51/م116) are different articles and may legitimately differ. The cap base is now `capBasis().wage_components`; the award base stays `wage_base` |
| L20 | Permission monthly cap | `attendance-policy.mjs:17,49` + `attendance-rules.mjs:39` | **Already single-sourced and correct.** Listed as the template the others should follow |

---

## 4. One HR policy screen — «سياسات الموارد البشرية»

`app/hr-policies.mjs` + `app/static/hr-policies-ui.mjs`, at `#hr-policies`, `GET /api/hr-policies`.

It gathers every policy from all six stores that previously needed six screens: `hr_policies` (pay components, working time, payroll cycle, end of service), `leave_type_policies`, `leave_accrual_policies`, `discipline_schedules`, `regulation_policies` (the five 102 rules), and `benefit_catalog`.

Each row carries its **article citations**, **status** (مسودة / معتمدة / مرفوضة / استُبدلت), **who prepared it and when**, who decided it and when, the decision note, and **what stays off while it is unaccepted** — spelled out, e.g. for `working_time`: «شاشة الحضور لا تحكم بتأخر ولا انصراف مبكر · لا تسري ساعات رمضان ولا سقف الاستئذان · يوم صرف الراتب يُزاح على أسبوع تقويم الخدمات لا على أيام دوامكم».

**It bypasses no capability check.** The module is read-only. It offers no write endpoint of its own: every accept/reject posts to the originating module's existing endpoint (`/leave/types/:id/accept`, `/discipline/schedules/:id/accept`, `/payroll-rules/:id/accept`, `/hr/policies/:id/accept`, `/benefits-admin/catalog/:id/accept`, `/leave-accrual/policies/:id/accept`), so the two-person rule and the capability check stay exactly where they were written. The screen itself:

- requires `hr.policy.prepare` or `hr.policy.accept`, and refuses the platform administrator;
- offers an action only when the underlying module would allow it — `hr.policy.accept` **and** not the preparer. A preparer sees their own draft marked `own_draft` with no buttons and no `accept_path`;
- **does not offer** an accept button for a `regulation_policies` draft with an unresolved choice (Art. 36(2) reading, the rounding rule). Those need the choice selectors in «قواعد اللائحة في الرواتب», so the row links there and says why, instead of showing a button the server would reject;
- sends each store exactly the fields its own function accepts (`version` only where the module takes one, `effective_from` only where it is required), because a stray field is refused by `v.object`.

It also shows the shared values from §1 and §2 once, with their source policy, their articles, the list of modules that read them, and any contradiction in red.

## 5. The readiness checklist

On the same screen, under the policies. Every line says what is blocking, why it matters, and links to the screen that fixes it.

- **Capabilities nobody holds** — «لم يُمنح `hr.discipline.decide` لأحد» with its effect («تقف كل قضية عند ثبتت وتسقط بمضي المدة، م120»), linking to `#access`. Nine capabilities: `hr.policy.accept`, `hr.policy.prepare`, `hr.discipline.decide`, `hr.leave.authority`, `hr.contracts.approve`, `hr.letters.issue`, `hr.attendance.approve`, `payroll.approve`, `benefits.finance.confirm`.
- **Policies not accepted** — «لم تُعتمد سياسة الدوام» and the other ten, each with the count of drafts waiting and what stays off, linking to its screen.
- **«لا يوجد قالب خطاب معتمد»**, plus the specific `discipline_notice` template without which no penalty can be notified (م121) and the grievance clock never starts.
- **Contradictions** — the `mismatch` lists from §1 and §2, as one line that is green only when no value is written in two disagreeing places.
- **Unresolved choices** — Art. 91.3's mode, named as its own line.

**`app/integration-readiness.mjs` was not reused.** It does not fit: it is about external connectors (Qiwa, GOSI, Mudad, ZATCA, mail, storage), returns `not_connected` blockers for each, and is gated on `admin`/`manager`/`pm` roles — a different subject, a different audience and a different permission. Folding HR policy readiness into it would have widened who can read HR policy state. It is left untouched.

## 6. Why there is no migration 105

The first draft of this change added one. It cannot work, and should not:

- `regulation_policies_fixed` (102) aborts any UPDATE where `OLD.tenant_id IS NULL OR OLD.status<>'draft'`. The seeded `reg-seed-deductions` row and every accepted rule are immutable by design — "a seeded or decided regulation policy is never rewritten; prepare a new draft".
- `leave_type_policies_fixed` (098) aborts any UPDATE that changes `parameters`, including on a draft.

Both guarantees are worth more than the convenience. So `wage_components` is defaulted in code (`capBasis` falls back to all four components — exactly the previous `monthly_total_minor`), `cleanParameters` writes it into the new row the acceptance creates, and the `unpaid_leave` block is written by `prepareLeaveTypesDraft` into new drafts. Policies accepted before this change keep working unchanged through the legacy read paths. **Migration number 105 remains free.**

## 7. Tests and checks

- `npm test`: **826 tests, 825 pass, 1 fail.** The one failure is the known, unrelated `tests/timesheets.test.mjs` billable test, which fails on Sundays (today, 2026-09-20, is a Sunday) and fails the same way when run alone. The baseline before this change on the same machine was 817 tests, 816 pass, the same 1 fail. The procurement conflict-of-interest flake did not appear in this run and passes alone (13/13).
- New: `tests/hr-policy-unify.test.mjs`, **9 tests**, all passing.
- `npm run check`: pass — 411 JavaScript modules (was 407), source hashes match, 220 requirements in 22 domains.
- `docs/traceability.json` was not changed, as in the integration handoff.

## 8. Open decisions this change did not make

Added to the list in `integration-20260919.md` §6:

**HR manager**
1. **Art. 91.3's mode is now asked once**, in the leave-types draft, not twice. It still has to be answered: `excess` or `total_when_over`.
2. **Grace minutes and the discipline lateness bands (L3).** The signed schedule's rows A01–A07 are written in 15/30/60-minute bands. A grace window of 30 minutes makes A01 and A02 («لغاية 15 دقيقة») unreachable. Pick the grace so the bands stay meaningful, or confirm that the overlap is intended.
3. **Annual entitlement (L17).** The employee is shown 30 days from the leave-types policy while the accrual policy decides the real number. Say which is the entitlement.

**Finance and payroll**
4. **The day basis split (L4).** The caps and fines divide by a fixed 28–31 (default 30, م50/1) even when the payroll cycle is set to `calendar`. Confirm that reading.
5. **Rounding beyond the payroll run (L5, D9).** The discipline fine and the leave deduction now follow the accepted rounding rule; overtime suggestions and benefits estimates still round to the halala regardless. Confirm whether they should follow it too.
6. **The wage basis (L19).** `capBasis().wage_components` (م51, م116) and `end_of_service.wage_base` (م36) are now deliberately separate. Confirm that they may differ, or say they must be equal.

**For the portal agents**
7. **L1 is the item to fix next.** Preparing a `working_time` policy from the Contracts screen silently drops the Ramadan, overtime, permission-cap and location rules. One screen should own that policy.
8. **L12** (probation off by one in `benefits-portal.mjs:138`) and **L11** (hardcoded 25% in `benefits-portal.mjs:301`) are one-line fixes in a file this change did not touch.
