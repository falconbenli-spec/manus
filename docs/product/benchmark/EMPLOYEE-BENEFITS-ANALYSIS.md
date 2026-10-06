# Employee benefits («المزايا حقت الموظف»): analysis and target model

Date: 19 September 2026. Status of the build that follows from this analysis: **built locally and tested locally**, not accepted by the process owner. Every benefit in the catalogue is a draft until the HR manager accepts it.

Sources read:

- `docs/product/audits/EMPLOYEE-PORTAL-AUDIT-20260919.md` (gap G12, item 9, services table)
- `docs/product/benchmark/REF-APP-BACKEND.md` (S16, S17, P2-05), `REF-APP-WORKFLOWS.md`, `REF-APP-FRONTEND.md`, `REF-APP-GAP-REPORT-20260919.md`
- the work regulations (`work/reference/manus-app/server/work-regulations.txt`, read-only), Articles 39–45, 57–59, 66–72, 95–103 and the definitions section
- `app/benefits.mjs`, `app/compensation.mjs`, `app/engagement.mjs`, `app/talent.mjs`, `app/hr-contracts.mjs`, `app/payroll-extras.mjs`, `app/static/leave-benefits-ui.mjs`, `app/service-catalog.mjs` (HR-BENEFIT-CLAIM, HR-SALARY-ADVANCE, TAL-TRAINING)

Benchmark notes on Workday, Rippling, BambooHR, Jisr, Menaqa and ZenHR come from their publicly described feature sets, not from a hands-on trial. Treat them as orientation, not as a feature-by-feature audit.

---

## 1. What the regulations actually say

The article numbers below were checked against the regulation text. Where the brief's numbering differed from the text, the text wins.

| Topic | Article | What it says | Consequence for the platform |
|---|---|---|---|
| Housing and transport, general | 66 | The company provides suitable housing and transport if the contract says so, or pays cash allowances. | An allowance is either in the contract or provided in kind. |
| Housing allowance | 67 | 25% of basic wage, paid monthly across the year (67/2). Paid in advance only as an exception, after probation (67/1). | Seeded as `percent_of_basic` 25%. |
| Transport allowance | 68 | Paid during annual and other paid leave and company holidays. Not paid if the company provides transport or a car, or the worker lives in on-site housing. No amount. | Seeded as `contract` (the amount is whatever the contract says). |
| Relocation | 69 (and 40) | One month of basic wage when moved to another city for at least a year, unless at the worker's own request. Art. 40 adds travel and baggage for the worker and dependants. | Seeded as `months_of_basic` 1, event-based. |
| Other benefits | 70 | The CEO, with the board chair's approval, may grant benefits "according to the attached benefits matrix (Annex 1)". **Annex 1 is not in the file.** | Anything not written in an article is marked «يحتاج اعتماد مصفوفة المزايا». |
| Emergency advance | 71 | At the CEO's discretion, recovered in monthly instalments. | Routed to the existing salary-advance flow. |
| Housing/transport replacement | 72 | "Replaces the article on housing and transport": housing in kind or "a suitable cash allowance", no percentage. | **Conflicts with Art. 67's 25%.** Owner must say which governs. |
| Travel on annual leave | 39/2 | Travel costs for the worker or family on annual leave "as agreed in the contract". | The ticket is a contract term. HR checks the clause. |
| Ticket classes | 41 | First class for the CEO and deputies; business for general managers; economy (الضيافة) for the rest. Cash value of the entitled class allowed (41/1/ث). | Class is set by HR at processing; cash option supported. |
| Training | 42–45 | Full training costs for Saudi workers, including tickets and living costs (42). A matching service period may be required, and costs recovered if the worker leaves early (44). General training for all (45). | Seeded with `nationality: saudi`; non-Saudis see "does not apply" for this item. |
| Rewards | 57–59 | Thanks letter or up to 5 extra paid days a year (58). Lump-sum incentive up to 4 monthly actual wages at CEO discretion "per the benefits and allowances table" (59/3), which is also not attached. | Informational only. |
| Health insurance | 95, 98 | Insure all workers under the cooperative health insurance law (95). Health insurance for the worker **and family** per the policy (98/1). Family of a deceased worker covered until the policy ends (98/3). | Medical benefit seeded; dependants rule follows the family definition. |
| Worker's family | Definitions | Spouse, unmarried sons and unmarried daughters. | Parents are **outside** the family definition. |
| Occupational hazards | 95, 99 | GOSI occupational-hazards branch for all workers. | Informational; registration ends at GOSI. |
| Nursing hour | 102 | Up to one hour a day for 24 months after the birth, counted as working time, no pay cut; the worker notifies in writing. | Seeded, female + event-based. |

What the regulations leave open: medical class per grade, whether upgrading class at the employee's cost is allowed, the service period before the first ticket, whether the ticket covers family members, education allowance, parents' insurance, gym, phone allowance, employee discounts, and the reward table.

---

## 2. Inventory: what an employee can see and do today (before this change)

| Area | Employee can see | Employee can do | Source |
|---|---|---|---|
| Medical insurance | Own enrolment row and tier on «التأمين والمزايا» **only if** they hold `hr.benefits.manage`; the nav item is hidden otherwise. No card, no policy number, no dependants. | Nothing on the screen. | `benefits.mjs`, `app.mjs:133` |
| Dependants | Nothing. Only the benefits capability holder sees them. | Only a free-text catalogue request (HR-BENEFIT-CLAIM, manager → HR) that changes nothing in the register. | `service-catalog.mjs:121` |
| Allowances | Own contract pay lines under «عقدي وراتبي». No link to the rule that produced them. | Nothing. | `hr-contracts.mjs` |
| Air ticket, education, gym, parents' insurance | Nothing. | The same free-text catalogue request. | — |
| Emergency advance | Catalogue service «سلفة على الراتب». | Request; payroll staff propose the advance separately. | `payroll-extras.mjs` |
| Training | Catalogue service «طلب تدريب»; «التدريب والتطوير» for training plans. | Request. | `talent.mjs` |
| Rewards | «التقدير» peer recognition. | Give recognition. | `engagement.mjs` |
| Eligibility and waiting periods | Nothing. | — | — |
| HR side | Medical policy register, enrolments, dependants, expiry and leaver alerts. | Record policy, enrolment, dependant add/remove (HR only). | `benefits.mjs` |

Known defect: `POST /api/benefits/enrolments/:id/dependants` ignored `:id` and trusted `input.enrolment_id` (WIRING-SPEC §8.3). **Fixed in this change.**

---

## 3. Benchmark

| Capability | Workday Benefits | Rippling | BambooHR | Jisr | Menaqa | ZenHR | 3,6T before | 3,6T after |
|---|---|---|---|---|---|---|---|---|
| Benefit plans with eligibility rules | Yes, rule engine (tenure, location, worker type, grade) | Yes | Basic plans, tracking | Allowances and insurance per employee | Allowances, insurance | Allowances, benefits | No | Yes: tenure, probation, contract type, employment type, nationality, gender, event; grade flagged as "no record" |
| "When do I become eligible" | Yes, waiting periods | Yes | Limited | Limited | Limited | Limited | No | Yes: «تصبح مؤهلًا بعد 4 أشهر (في 19 يناير 2027)» |
| Employee sees own medical class, card, dependants | Yes | Yes | Partly | Yes (Saudi) | Yes | Yes | No | Yes: class, masked policy and member numbers, dependants, card download |
| Add newborn/spouse (life event) | Yes | Yes | Request | Yes | Yes | Yes | Free-text only | Yes, with document; HR confirms; register updated |
| Class upgrade at own cost | Plan change in open enrolment | Yes | — | Common in Saudi practice | Some | Some | No | Yes, only if the accepted policy allows it |
| Air-ticket allowance / annual ticket | Not native (custom) | Custom | No | Yes (Saudi) | Yes | Yes | No | Yes: ticket or cash, class per Art. 41, one a year |
| Education allowance | Custom | Custom | No | Yes | Yes | Yes | No | Placeholder until the owner decides |
| Benefit letter | Via documents | Via documents | — | Yes | Yes | Yes | No | Yes (HR issues and attaches) |
| Payout goes to payroll | Integrated | Integrated | Via payroll | Integrated | Integrated | Integrated | — | **Proposed only**; handed to payroll movements as a proposed adjustment |
| Rules approved by a second person | Configurable approvals | Configurable | No | No | No | No | Leave policy only | Yes: propose, then a different person accepts |

Saudi norms to keep in mind (to be confirmed with the insurer and the HR manager, not asserted as law here):

- **CCHI medical classes.** Insurers sell tiered classes (often named VIP, A, B, C). The CCHI unified policy sets the minimum. The class per job grade is a company decision; it is not in the regulations.
- **Dependants.** Our regulation's family definition is spouse and unmarried children. Insurers apply their own age rules for sons; the HR manager should confirm them with the insurer.
- **Tickets.** Common practice is one return ticket a year (or every two years) after twelve months' service, sometimes for family members, often paid as a cash allowance. Our Art. 39/2 defers to the contract.
- **Education allowance.** Common for expatriate staff, capped per child and per year, paid against invoices.
- **Phone allowance** and **employee discounts** are common in agencies. Neither appears in the regulations; both would need the Annex 1 matrix.

---

## 4. Gap list (ranked)

| # | Gap | Status after this change |
|---|---|---|
| 1 | The employee sees nothing about their benefits (audit G12) | Closed: «مزاياي» |
| 2 | No catalogue of benefits with rules, sources and value basis | Closed: 13 seeded drafts with article citations |
| 3 | No eligibility or waiting-period computation | Closed: engine plus per-staff matrix for HR |
| 4 | Dependant requests don't update the register; `:id` route defect | Closed: request → HR confirm → `medical_dependants` via `benefits.mjs` |
| 5 | Benefit rules could become "real" without anyone accepting them | Closed: draft until a different person with `hr.policy.accept` accepts; enforced in the schema |
| 6 | Money claims have no finance step and no link to payroll | Closed: HR → finance → proposal → payroll movement **proposed** |
| 7 | Annex 1 benefits matrix missing | **Open: owner decision** |
| 8 | Art. 67 (25%) vs Art. 72 (no percentage) conflict | **Open: owner decision** |
| 9 | No job grade on the employee record, so grade-based rules (medical class, ticket class) cannot be computed | Open: grade rules show "بيانات ناقصة" rather than guessing |
| 10 | Medical class change after an approved upgrade is not written back to the enrolment | Open: HR changes it at the insurer; follow-up to add a tier-change action in `benefits.mjs` |
| 11 | Benefit letter is recorded here, not generated from `letters.mjs` templates | Open: plug into letters after branch 102 merges |
| 12 | The catalogue service HR-BENEFIT-CLAIM still exists as free text | Open: map it to the option keys once the service-variant model (branch 101) lands |
| 13 | Nursing hour, relocation: no request path | By design: informational, HR-initiated |

---

## 5. Target benefits model

### 5.1 Entities

- **Benefit template** (global, fixed): the seed wording taken from the regulations.
- **Benefit catalogue revision** (per tenant): `type/category`, `name`, `summary`, `source_kind` (`regulation` with an article, or `needs_matrix`), `source_note`, eligibility `rules`, `value_basis` (`fixed`, `percent_of_basic`, `months_of_basic`, `contract`, `policy`, `informational`) with parameters, `frequency`, `claim_method` (`automatic`, `request`, `enrolment`, `informational`), the request option it opens, and required `documents`. Status `draft → accepted → retired`, or `rejected`. At most one accepted and one draft per benefit. The proposer never accepts; a `needs_matrix` item needs a written basis to be accepted.
- **Benefit request** (one request type, six options): `dependant_add`, `dependant_remove`, `class_upgrade`, `ticket_claim`, `education_claim`, `benefit_letter`. Each option has its own fields, documents and chain.
- **Payout proposal**: `payroll_addition`, `payroll_deduction` or `company_expense`, status `proposed → handed_to_payroll | withdrawn`. There is no "paid" state.
- **Benefit document**: request attachments and the insurance card, visible only to the employee and the benefits capability (and finance for money claims).

### 5.2 Chains

| Option | Chain | Money | Result |
|---|---|---|---|
| Add dependant | Employee → HR (`hr.benefits.manage`) | No | Dependant written to `medical_dependants` through `benefits.mjs`, SoD enforced there and in SQL |
| Remove dependant | Employee → HR | No | Removal date written |
| Class upgrade | Employee (consents to deduction) → HR sets premium difference → Finance | Yes | `payroll_deduction` proposal |
| Air ticket | Employee → HR sets class (Art. 41) and amount → Finance | Yes | Cash: `payroll_addition`; ticket: `company_expense` |
| Education | Employee (invoice) → HR sets amount ≤ invoice → Finance | Yes | `payroll_addition` |
| Benefit letter | Employee → HR issues and attaches | No | Letter reference and file |

Finance is a separate capability, `benefits.finance.confirm`, and the HR decider cannot confirm. A payroll preparer (`payroll.prepare`) hands a proposal to payroll movements, where it becomes a **proposed** `payroll_adjustments` row that the payroll approver decides on.

### 5.3 Visibility

- «مزاياي»: the employee, and holders of `hr.benefits.manage`. Nobody else, including the line manager.
- Draft benefits drawn from articles are shown to employees with a "draft, not an entitlement" label. Draft placeholders that need the matrix are hidden from employees and counted.
- Eligibility across staff: HR (benefits, policy prepare/accept). No amounts in the matrix.
- No medical information anywhere: no diagnosis, claim or condition fields.

### 5.4 Seeded catalogue (all drafts)

| Benefit | Source | Rules | Value | Frequency | Claim |
|---|---|---|---|---|---|
| Housing | Art. 66, 67 (and 72) | — | 25% of basic | Monthly | Automatic (contract/payroll) |
| Transport | Art. 66, 68 (and 72) | — | Per contract | Monthly | Automatic |
| Medical insurance and family | Art. 95, 98 | — | Per policy; upgrade at own cost **off** | Policy term | Enrolment; dependant requests |
| Annual air ticket | Art. 39, 41 | ≥ 12 months (proposed), contract clause | Class per Art. 41, cash allowed | Annual | Request |
| Relocation | Art. 69 (and 40) | On relocation | 1 month basic | Per event | Automatic (HR) |
| Emergency advance | Art. 71 | — | CEO discretion | Per event | Salary-advance service |
| Training support | Art. 42–45 | Saudi | Programme costs | Per event | Training service |
| Nursing hour | Art. 102 | Female, after childbirth | ≤ 1 h/day, 24 months | Daily | Informational |
| Rewards | Art. 57–59 | — | CEO discretion | Per event | Informational |
| Social insurance | Art. 95, 99 | — | Company contribution | Policy term | Automatic |
| Parents' insurance | «يحتاج اعتماد مصفوفة المزايا» | ≥ 6 months (old app) | Owner decides | Policy term | Dependant request (parent) once accepted |
| Children's education | «يحتاج اعتماد مصفوفة المزايا» | ≥ 6 months (old app) | Owner decides cap | Per academic year | Request |
| Gym | «يحتاج اعتماد مصفوفة المزايا» | ≥ 6 months (old app) | Owner decides | Annual | Informational |

---

## 6. Owner decisions needed

1. **Annex 1 benefits matrix (Art. 70).** Supply it, or decide item by item: parents' insurance (who pays the premium, which class), children's education (cap per child, number of children, stages), gym (cap, club), phone allowance, employee discounts, and the reward table in Art. 59.
2. **Art. 67 vs Art. 72.** Does housing stay at 25% of basic, or is it "a suitable cash allowance" per contract?
3. **Medical class per grade.** Which class for which grade, and is upgrading at the employee's own cost allowed? (Seeded as not allowed.) The platform also has no job-grade record yet.
4. **Ticket policy.** Service period before the first ticket (seeded at 12 months as a proposal), frequency (every year or every two years), whether family members are covered, whether cash is allowed, and the destination rule (home country or any).
5. **Acceptance.** The HR manager (holder of `hr.policy.accept`) accepts each benefit. Someone must be granted `benefits.finance.confirm` for the finance step.
