# Handoff: the secondment circular and the three new benefits (migration 112)

State: **built locally, tested locally.** Nothing is connected to an insurer, a bank, a payroll provider or a travel agency. Nothing is accepted by the process owner: the circular's allowance table is a draft that cannot be activated until someone enters an effective date, and the three benefits stay drafts in the benefits catalogue until the HR manager accepts them.

This branch **extends** migration 102 (`app/travel.mjs`, secondment) and migration 103 (`app/benefits-portal.mjs`, the benefits catalogue). It rebuilds neither. Read `payroll-rules.md` and `benefits-portal.md` first.

## 1. Files

Created:

- `app/migrations/112-secondment-benefits.sql`
- `app/secondment-benefits.mjs` — job grades, dated allowance versions, the per-diem calculation with its steps, the Art. 41 ticket rules, the manager attestation, the overtime-overlap check, and the three new benefit flows
- `tests/secondment-benefits.test.mjs` (13 tests)
- this file

Edited (small and separate):

- `app/travel.mjs` — imports the new module; `approve_travel` now resolves the allowance version in force at the secondment's **start date**, refuses an overtime overlap, requires the attestation when the version in force demands it, and writes the full calculation into `basis.steps`. `travelBoard` and the decision view carry the version, the attestation and the recorded tickets.
- `app/server.mjs` — one import, two GET routes and one POST block.

Not edited: `.env`, any migration 001–106, `app/benefits-portal.mjs`, `app/payroll-rules.mjs`, `app/overtime-rules.mjs`, `app/hr-policies.mjs`, `app/hr-rule-basis.mjs`.

## 2. Migration 112

| Table | Purpose |
|---|---|
| `job_grades` | Reference data: A الرئيس التنفيذي, B نواب الرئيس, C مدراء الإدارات / مدراء العموم, D العاملون, each mapped to the existing travel grade keys (`ceo`/`deputy`/`gm`/`employee`). `needs_confirmation` is set on B and C, with the reason on the row. |
| `employee_job_grades` | An employee's grade, recorded by HR. **No grade is assumed.** A request that depends on a grade is refused with "درجتك الوظيفية غير مسجلة". |
| `secondment_allowance_templates` / `..._template_grades` | The seed text of both versions, so the per-tenant seed and the new-tenant trigger read the same source. |
| `secondment_allowance_versions` | Dated versions per tenant: `draft → active → expired`. `CHECK(status='draft' OR effective_from IS NOT NULL)` is what blocks activation until the date is entered. Activating a version expires the current one at `effective_from − 1` and links them through `superseded_by`. |
| `secondment_allowance_grades` | Per grade: daily rate inside/outside KSA, the entitled ticket class, its source, and the conflict text where there is one. |
| `secondment_attestations` | The manager's written attestation that nobody already in the mission area could do the task. One row per secondment, never edited, never deleted. |
| `secondment_tickets` | Art. 41 outcomes: mode, fares, distance, driver, the computed amount, `payable_via`, and the calculation steps in `basis`. SQL checks enforce the rules that are not merely advisory (no ticket with a company car, a distance needs a rate and a measuring point, a higher class needs its reason). |
| `benefit_extra_source` | The three benefits' catalogue text from the deck, used by the migration and by the `benefit_catalog` trigger. |
| `benefit_extra_settings` | Per tenant: the appraisal threshold (default 70%), the parents' 5% and 2500 SAR cap, the instalment ceiling (12), the education cap basis (**empty**), the children ceiling (2), the sports default (5500 SAR), and `parents_year_basis` (**empty**). |
| `education_grade_caps` | **Starts empty.** The source does not state the amounts. |
| `sports_grade_caps` | Seeded at 5500 SAR for every grade, because the source states both the amount and «حسب الفئة الوظيفية». |
| `benefit_extra_requests` | The three new request kinds with their own chain. A separate table from `benefit_requests` because that table's `option` list is closed by a CHECK in migration 103 and these flows have steps it does not have. |
| `benefit_extra_parents` / `_children` | Request lines. `seq IN (1,2)` is the two-children and two-parents ceiling in SQL, not only in code. |
| `benefit_extra_invoices` | `UNIQUE(tenant_id, invoice_number, supplier_tax_number)` — an invoice is never reimbursed twice. |
| `benefit_extra_instalments` | Proposed payroll movements. A trigger refuses any insert that is not `proposed`. **There is no paid state.** |

The three benefits already existed as drafts from migration 103. Migration 112 rewrites those drafts to cite the deck, carry the shared eligibility and the new ceilings, and renames «اشتراك النادي الرياضي» to «الأندية الصحية والأجهزة الرياضية». A trigger on `benefit_catalog` does the same for a tenant created later, so it does not depend on the firing order of the two `AFTER INSERT ON tenants` triggers.

## 3. The circular

**Version selection is by the secondment's start date.** `versionInForce(db, tenant, date)` returns the version whose range covers that date. A decision approved today for a secondment that started in May reads the May table. The regulation version is kept as an expired row, not deleted.

Seeded values, both versions (SAR/day, inside KSA / outside):

| Grade | Regulation (Art. 65) | Circular |
|---|---|---|
| A الرئيس التنفيذي | 2100 / 2500 | 2100 / 2500 (the circular is silent, so Art. 65 stands) |
| B نواب الرئيس | 1000 / 1500 | 1000 / 1500 |
| C مدراء الإدارات | 600 / 900 | 900 / 1200 |
| D العاملون | 400 / 500 | 700 / 900 |

Ticket classes after the circular: A first (Art. 41), B business (the circular; the regulation says first — see the decisions below), C business, D economy.

The circular version also carries `rounding = riyal_up` (Art. 50), `mileage_rate_minor = 100` (1 SAR per kilometre) and `requires_attestation = 1`. The regulation version keeps the behaviour that was in force with it (halala rounding, no attestation), so activating the circular is what switches those on — and no past decision changes.

**Activation is blocked until the effective date is entered.** The circular states none. `activateAllowanceVersion` refuses an empty date with `effective_from_required`, refuses a date on or before the current version's, and is limited to `hr.policy.accept`.

Art. 41 ticket rules, all implemented in `computeTicket` and recorded per secondment:

- `cash_lowest_fare` — cash at the lowest fare for the entitled class.
- `fare_difference` — the difference when a lower class was issued for lack of availability.
- `company_car` — no ticket; the note records that the company bears fuel and maintenance.
- `mileage` — `km × 2 × 1 SAR`, measured from the workplace or the nearest airport (a recorded choice).
- `higher_class` — allowed only with `ceo` or `official_guests` as the reason.
- `driver` / `driver_assistant` — the ticket value for a driver and their assistant, for transporting company materials or accompanying the CEO.
- `contract_or_authority` — for collaborators, consultants and secondees, a free-text field for the contract clause or the authority holder's decision, at least 10 characters.

Also enforced: the existing distance thresholds (75 / 40 / 15 km) still refuse the allowance and name the threshold; the manager attestation; and the overtime overlap. `overtimeOverlap` reads both `overtime_assignments` (proposed, authorised, budget_approved) and `overtime_requests` (pending, approved), which is the same pair `app/overtime-rules.mjs` guards from the other direction with `missionOverlap`. The warning that `payroll-rules.mjs::ruleChecks` already raises on a payroll run is unchanged; this is the refusal at the moment of the decision.

**The calculation is shown in full.** `perDiemBreakdown` returns six ordered Arabic lines — grade and version, daily rate, days, the reduction and its reason, the multiplication, and the rounding — stored in `travel_decisions.basis.steps` so the employee and every approver read the same numbers at every step. Ticket and benefit calculations carry their own `steps`.

## 4. The three benefits

Shared gate (`sharedEligibility`), refusing with the unmet condition named: regular full-time, probation passed, and the last released appraisal at or above the setting. The appraisal is read from `performance_reviews.final_score_bp` and converted to a percentage against the cycle's `scale_max`, because that column is a score on the cycle scale, not a percentage.

**تأمين الوالدين.** employee → HR verifies documents and enters the insurer's quotation → the system computes `min(policy value × 5%, 2500 × number of parents)` → the employee confirms and consents → the authority holder approves → an instalment schedule is created as proposed payroll deductions. The consent is a mandatory recorded acknowledgement citing Art. 51; the request cannot reach the authority holder without it (a SQL CHECK, not only code), and a recorded consent can never be rewritten (a trigger). Payment in one deduction or up to 12 months.

**دراسة الأبناء.** Blocked with `caps_not_set` until both the per-grade table and the cap basis (per child or per employee) are filled. Up to two children. A tax invoice and proof of enrolment per child; a duplicate invoice number plus supplier tax number is refused. HR document check → finance → completion sets the reimbursement month and reports the last day of that Gregorian month.

**الأندية الصحية والأجهزة الرياضية.** 5500 SAR per grade by default, in a per-grade table. Club subscriptions and sports equipment only. One request per Gregorian year: a unique partial index closes the balance once a live request exists, and the employee must acknowledge the warning before submitting. The system pays `min(invoice, cap)`.

No money moves. Every path ends in a `proposed` payroll movement that `payroll.prepare` hands over and the payroll approver decides, in the existing module.

## 5. Open decisions — flagged, not assumed

`openDecisions(db, tenantId)` returns these on both boards:

1. **`circular_effective_from`** — the circular states no effective date. The new table cannot be activated until the administration enters one; until then Art. 65 applies.
2. **`deputy_ticket_class`** — the regulation (Art. 41) gives VPs first class; the circular gives them business. The platform defaults to the circular and records the conflict on the rate row.
3. **`grade_c_naming`** — the regulation says «مدراء العموم», the circular says «مدراء الإدارات». They are treated as one grade for now; the owner must confirm.
4. **`education_amounts`** — the annual amount per grade, and whether the cap is per child or per employee, are not in the source. The table is empty and requests are blocked.
5. **`parents_year_basis`** — the 2500 SAR cap is per parent per «العام المالي». Whether that is the Gregorian year used everywhere else is unconfirmed, so the period is not computed automatically.
6. **`benefits_deck_links`** — the benefits deck references another entity's website. Its links were not used and nothing was copied from them.

## 6. Tests

`tests/secondment-benefits.test.mjs`, 13 tests, all passing:

1. Job grades as reference data, the naming conflict on the record, the six open decisions, and the three catalogue drafts citing their source.
2. The circular as a dated version: no activation without the date, the regulation version expiring the day before, selection by date, grade A unchanged, and the ticket classes.
3. The owner's worked case: grade D, 4 days outside the Kingdom, housing provided only — `4 × 900 × 0.5 = 1800 SAR`, end to end, with the calculation on the decision and a proposed payroll adjustment.
4. Version selection by date: a secondment starting before the circular keeps 600 SAR/day and halala rounding; one starting after gets 900 SAR/day and riyal-up.
5. The distance refusal, naming the threshold, with nothing proposed to payroll.
6. The attestation: mandatory, never written by the traveller, recorded once.
7. The overtime overlap refusal (Art. 77/9).
8. The kilometre allowance, both measuring points.
9. The Art. 41 ticket rules, each mode.
10. Parents' insurance at exactly the 2500 SAR cap, the consent requirement, the 12-month schedule, and the cap scaling with two parents.
11. Children's education: blocked until the table is filled, two children maximum, duplicate invoice refused.
12. Sports: the 5500 default, the per-grade table, the warning, one request a year, `min(amount, cap)`.
13. Eligibility refusals naming each unmet condition.

`npm test`: 860 tests, 860 passing, 0 failing. `npm run check`: 416 modules checked, source hashes match, traceability 220 requirements / 22 domains.

## 7. Known gaps

- **No screen yet.** The boards (`secondmentBoard`, `benefitExtrasBoard`) and every action are on the server behind authorisation and are reachable over HTTP, but no `app/static/*-ui.mjs` module renders them. The circular's values and the three benefits are therefore not visible in the SPA on this branch.
- The catalogue cards for the three benefits keep the old app's `min_tenure_months: 6` alongside the new rules, because that is what migration 103 recorded and the owner has not decided it. The **request** gate is the shared rule (full-time, probation, appraisal); the card's six months is display only and is flagged in the source note.
- Ticket amounts are computed and recorded; they are not yet pushed into an expense claim or a payroll proposal automatically. `payable_via` says which route each one belongs to.
- Every value in the circular was typed from an automatically extracted text and must be matched against the signed copy before anyone activates it. The activation note field exists for exactly that.
