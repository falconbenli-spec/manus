# Handoff: «مزاياي» and benefits administration (migration 103)

State: **built locally, tested locally.** Not connected to any insurer, bank, GOSI or payroll provider. Not accepted by the process owner: every seeded benefit is a draft until the HR manager accepts it.

Analysis and benchmark: `docs/product/benchmark/EMPLOYEE-BENEFITS-ANALYSIS.md`.

## 1. Files

Created:

- `app/migrations/103-benefits-portal.sql`
- `app/benefits-portal.mjs`: catalogue, eligibility, the employee view, the benefit request and its chain, payout proposals, documents
- `app/static/benefits-portal-ui.mjs`: exports `myBenefitsUI` (`#my-benefits`) and `benefitsAdminUI` (`#benefits-admin`)
- `tests/benefits-portal.test.mjs` (10 tests)
- `docs/product/benchmark/EMPLOYEE-BENEFITS-ANALYSIS.md`
- this file

Edited (minimal):

- `app/benefits.mjs`: `addDependant(db,u,input,pathEnrolmentId)` takes the path id and refuses a body id that differs (**WIRING-SPEC §8.3 fixed**). New read and apply helpers for «مزاياي»: `coverageOf`, `enrolmentOwner`, `hasOpenEnrolment`, `activeDependant`, `applyDependantAddition`, `applyDependantRemoval`. The privacy note now says the employee sees their own dependants in «مزاياي». `benefits.mjs` stays the only module that reads `medical_dependants` (existing test enforces it).
- `app/server.mjs`: import, routes (below), the dependants route passes `:id`, and `benefits-portal-ui` in the static list.
- `app/access.mjs`: new capability `benefits.finance.confirm` (finance group, sensitive, no default role).
- `app/notices.mjs`: `SUBJECT_LINKS` gains `benefit_request → #my-benefits`, `benefit_review → #benefits-admin`, `benefit_catalog → #benefits-admin` (one `Object.assign` line).
- `app/static/operations.mjs`: registers `'my-benefits'` and `'benefits-admin'`.
- `app/static/app.mjs`: nav «مزاياي» for all staff after «قسائم راتبي»; «إدارة المزايا» for holders of any of `hr.benefits.manage`, `hr.policy.prepare`, `hr.policy.accept`, `benefits.finance.confirm`, `payroll.prepare`.
- `app/static/hr-design.mjs`: glyphs, nav groups, and the department-directory exclusion list.

Not edited: `service-catalog.mjs`, `files.mjs`, `workflow.mjs`, any migration 001–096, `.env`.

## 2. Migration 103

| Table | Purpose |
|---|---|
| `benefit_templates` | 13 fixed seed texts from the regulations (article, source note, rules, value basis, frequency, claim method, documents). Immutable. |
| `benefit_catalog` | Per-tenant revisions. `draft → accepted → retired`, or `rejected`. One accepted and one draft per benefit (partial unique indexes). `CHECK(decided_by<>proposed_by)`; a `needs_matrix` item needs a decision note of 10+ characters to be accepted. Decided rows are frozen by trigger; no delete. Seeded as drafts for every existing tenant and, by an `AFTER INSERT ON tenants` trigger, for every new tenant. `proposed_by IS NULL` means "platform draft from the regulation text"; whoever edits a draft becomes its proposer and cannot accept it. |
| `benefit_requests` | One request type with `option` in `dependant_add`, `dependant_remove`, `class_upgrade`, `ticket_claim`, `education_claim`, `benefit_letter`. Status `pending_hr → pending_finance → completed`, or `rejected` / `withdrawn`. SQL checks: the employee never decides; the finance confirmer differs from the HR decider; completion needs the finance step when money is involved. Final states are frozen; no delete. Human references `BEN-YYYY-NNNN`. |
| `benefit_payout_proposals` | `payroll_addition`, `payroll_deduction`, `company_expense`. Insert only as `proposed` (trigger); updates only to `handed_to_payroll` (with a `payroll_adjustments` id) or `withdrawn`. **No paid state exists.** |
| `benefit_documents` | Request attachments and insurance cards. Own table, not `stored_files`: family documents stay out of search and reports, and it avoids the `stored_files` rebuild in branch 098. PDF/PNG/JPEG by content signature, 2 MB, immutable. |

Notifications: **migration 103 does not touch the `notifications` table** (coordinator instruction). The subject kinds `benefit_request`, `benefit_review`, `benefit_catalog` match the shape rule introduced by migration 099. On a branch without 099 the 096 closed list rejects them; `notify()` in `benefits-portal.mjs` wraps the insert in a savepoint so that only the notice is dropped and the action still commits. Tests and the preview apply the 099 shape themselves (no-op once 099 is merged).

## 3. Routes

| Method | Path | Function |
|---|---|---|
| GET | `/api/my-benefits[?employee=ID]` | `myBenefits` (other employees: `hr.benefits.manage` only) |
| GET | `/api/benefits-admin` | `benefitsAdmin` |
| GET | `/api/my-benefits/documents/:id` | `downloadBenefitDocument` (attachment, sandbox CSP) |
| POST | `/api/my-benefits/requests` | `submitBenefitRequest` (idempotent) |
| POST | `/api/my-benefits/requests/:id/withdraw` | `withdrawBenefitRequest` |
| POST | `/api/my-benefits/documents` | `uploadBenefitDocument` (idempotent) |
| POST | `/api/benefits-admin/catalog/:key/propose` | `proposeBenefit` |
| POST | `/api/benefits-admin/catalog/:id/accept\|reject` | `decideBenefit` |
| POST | `/api/benefits-admin/requests/:id/hr_approve\|hr_reject\|finance_approve\|finance_reject` | `hrDecision` / `financeDecision` |
| POST | `/api/benefits-admin/proposals/:id/hand_to_payroll` | `handToPayroll` → `payrollExtras.proposeAdjustment` |

## 4. Who does what

| Step | Capability | Guard |
|---|---|---|
| See «مزاياي» | self; `hr.benefits.manage` for others | line manager and colleagues get 404 |
| Submit a request | the employee (not platform admins) | option must be available now |
| HR decision, apply dependant change | `hr.benefits.manage` | not on own request; SoD also in `benefits.mjs` and SQL |
| Finance confirmation | `benefits.finance.confirm` | not the employee, not the HR decider |
| Hand to payroll | `payroll.prepare` | creates a *proposed* payroll adjustment; `payroll.approve` decides it in «حركات الرواتب» |
| Propose a benefit | `hr.policy.prepare` or `hr.benefits.manage` | — |
| Accept or reject a benefit | `hr.policy.accept` (HR manager) | not the proposer (code and SQL) |

Availability rules: dependant add/remove and the benefit letter work on the existing enrolment and do not wait for catalogue acceptance. Class upgrade, ticket and education need the benefit accepted, and upgrade additionally needs `upgrade_at_employee_cost: true` in the accepted revision (seeded false). One ticket claim per calendar year. Parent dependants only once `parents_insurance` is accepted and the employee is eligible.

## 5. Eligibility engine

`evaluateEligibility(rules,facts,date)`: facts come from `employee_profiles.join_date` (else first contract start), the active contract (type, probation, pay lines), `employee_demographics` (nationality group, gender). Order: explicit mismatch → `not_eligible`; missing data → `unknown` with the list; future date → `upcoming` with «تصبح مؤهلًا بعد N أشهر (في …)»; event rule → `on_event`; else `eligible`. Months are calendar months with month-end clamping (31 Aug + 6 = 28 Feb). A `grades` rule always returns `unknown` because the platform has no grade record; it never passes silently.

## 6. Plugging into the service-variant model (branch 101)

Branch 101 was not in this worktree. «مزاياي» uses a local option picker: option cards on the page, one endpoint, `option` as the discriminator. When the variant model lands, map the variants of catalogue service `HR-BENEFIT-CLAIM` to `OPTIONS[].key` in `app/benefits-portal.mjs` and let the variant deep-link to `#my-benefits` (or open `myBenefitsUI.form('request_option', key, data)`). Fields, documents and chains stay defined here. The free-text HR-BENEFIT-CLAIM service should then be retired or reduced to "أخرى".

## 7. Merge notes

- **099/100:** no notifications rebuild here. If neither 099 nor 100 merges, benefit notices are silently dropped (actions still work).
- **098:** `stored_files` becomes a registry there; benefit documents use their own table, so no conflict.
- **102 (payroll/letters):** `handToPayroll` calls `payrollExtras.proposeAdjustment(db,u,{user_id,kind,month,amount,reason})`. If 102 changes that signature, update this one call. The benefit letter is recorded here (reference plus uploaded file), not generated from letter templates; switch to `letters.mjs` once 102 settles.
- Traceability (`docs/implementation/REQUIREMENTS.json`, PAY-10) and `STATUS.md` were not updated, to avoid conflicts with parallel branches. PAY-10 can reference `app/benefits-portal.mjs` and `tests/benefits-portal.test.mjs` as partial evidence.

## 8. Verification

- `node --test tests/benefits-portal.test.mjs`: 10/10.
- `npm test`: 724/724 pass (714 existing + 10 new), including `benefits.test.mjs` and `security-hr-benefits.test.mjs` unchanged.
- `npm run check`: 370 modules, source hashes match, traceability 220/22.
- Visual check on a throwaway instance (port 3695, synthetic seeded DB, sessions for employee, hr, manager, it). Screenshots in `work/design-verify/benefits/` (main checkout): employee page (depth design, full), mobile 390 px, open benefit card, dependant request dialog, HR admin (full), HR manager acceptance view, finance view. Bidi fixed for masked numbers, ISO dates and article codes during the check.

## 9. Known limits

- No job grade on the employee record: medical class and ticket class are chosen by HR at processing.
- An approved class upgrade does not change the enrolment tier in the register; HR changes it at the insurer. A tier-change action in `benefits.mjs` is the follow-up.
- `company_expense` proposals (ticket booked by the company) have no handoff action yet; finance books the ticket outside this module.
- Relocation and nursing hour have no request path by design (HR-initiated / written notice).
- The benchmark column for competitors is from their public feature descriptions, not a trial.

## 10. Owner decisions

1. Annex 1 benefits matrix (Art. 70): parents' insurance, children's education, gym, phone allowance, discounts, reward table.
2. Art. 67 (25% housing) vs Art. 72 (in kind or "suitable" cash).
3. Medical class per grade, and whether upgrading at own cost is allowed.
4. Ticket policy: service before first ticket (seeded 12 months, proposed), frequency, family coverage, cash equivalent, destination.
5. Grant `hr.policy.accept` to the HR manager and `benefits.finance.confirm` to a finance person.
