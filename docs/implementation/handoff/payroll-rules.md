# Payroll rules from the work regulations, 19 September 2026

**Sources.**
- `docs/product/benchmark/REF-APP-GAP-REPORT-20260919.md` (P1 #10 and the P2 payroll items).
- `REF-APP-WORKFLOWS.md` §3 (rows O3–O8, O12, O13, D4, D14, L13).
- `REF-APP-BACKEND.md` P2-01 and P2-02.
- The owner's scope addition for the letter-request wizard.
- The regulation text itself (`work/reference/manus-app/server/work-regulations.txt`, Art. 34, 36–38, 48, 50, 51, 63–65, 67, 91, 116).

**State: built locally and tested locally. Nothing here is accepted by the process owner.**
- Every regulation value is a **draft** policy that cites its article. None of it applies until the HR manager accepts it.
- The regulation text is PDF-extracted in reversed visual order. Every number must be checked against the signed PDF before acceptance.
- The platform moves no money. Allowances are *proposed* payroll adjustments; settlement dues and letters are recorded, not paid or sent.

## 1. What was built

| Area | Where | Behaviour |
|---|---|---|
| Regulation policies | `app/payroll-rules.mjs`, table `regulation_policies` | Five seeded drafts: `resignation`, `settlement`, `deductions`, `pay_rules`, `travel_per_diem`. Each carries its article list and source. The HR manager (`hr.policy.accept`) adopts a draft for the tenant with an effective date. Choices the manager must make personally are listed in `pending_choices`; acceptance is refused until they are made. `hr.policy.prepare` can prepare an edited tenant draft, which its preparer cannot accept. |
| Resignation (Art. 34, 37) | `app/resignations.mjs`, table `resignations` | A dated letter addressed to the department manager, with HR copied. **Deemed accepted** on the first day more than 30 days after submission (`deemed_after_days + 1`). **Deferral** is recorded by the authority holder, with a written reason, before the deemed date, and is capped at `deferral_max_days` (60) from submission. The authority holder accepts, sets the last working day (notice enforced unless waived) and may waive notice. Blocked on submission and held on acceptance while an investigation or suspension is open. Acceptance, explicit or deemed, opens the offboarding bundle. |
| Daily clock | `jobs.mjs` handler `resignation.deemed_acceptance` | Enqueued at submission, due at Riyadh midnight of the deemed date. When it wakes it re-checks everything: accepted rule, deferral date, open investigations. If it cannot accept yet, it reschedules itself for the next day or the deferral date. It is sensitive, and `authorise` checks the resignation still exists. |
| Investigation hook | `openInvestigationsFor(db,tenantId,userId)` and `registerInvestigationSource(key,fn)` in `resignations.mjs` | Reads open `hr_cases` where the employee is the respondent (complaint, violation report, grievance). It also reads any source the discipline module registers. With no registration, it reads `disciplinary_cases`, `discipline_cases`, `discipline_investigations` or `employee_suspensions` if such a table exists with `tenant_id`, a person column (`employee_id`, `subject_id` or `user_id`) and `status`. |
| Offboarding trigger | `lifecycle.mjs openOffboardingFor` (new export; `openBundle` now delegates to an internal `createBundle`) | Called inside a savepoint. If no offboarding template exists or a step owner is ambiguous, the acceptance stands. The reason goes to `offboarding_note`, and `open_offboarding` is offered to `people.manage` holders. Owner: the first active HR-role account holding `people.manage`. |
| Settlement | `payroll-extras.mjs prepareSettlement / decideSettlement`, table `settlement_rule_basis` | Both Art. 36(2) readings are computed and stored side by side (`settlementReadings`). Unpaid leave over the threshold is excluded from service (Art. 91.3). The dues deadline is 7 days after service end when the company ends the contract and 14 days when the worker does (Art. 50.2), with a countdown. Death (`end_reason:'other', death:true`) gives the heirs the full month's wage and the leave balance (Art. 38.3). Rounding follows the accepted pay rule. **Approval is refused until the accepted settlement policy names a reading, and the draft was prepared under that policy and reading.** Dues payment is recorded once (`record_dues_payment`), by someone other than the preparer. |
| Deduction caps (Art. 51, 116) | `payroll-rules.mjs capBreaches / assertAdvanceWithinCap / assertClassWithinCap`, table `payroll_adjustment_classes` | Three caps, each checked when the deduction is proposed. **Advance/loan:** the monthly instalment is at most 10% of the wage (`proposeAdvance`). **Court order:** at most 25% (`proposeClassifiedDeduction` with class `court_order`). **Fines:** at most 5 days' wage per month (class `fine`, or an adjustment `kind='fine'` if the discipline agent adds one, plus `registerFineSource`). **Pre-run checks:** the same caps are a `block` level in `preRunChecks`, and `runAction` refuses `submit_run` and `approve_run` while any block remains. |
| Pay rules | `paydayFor`, `ruleChecks`, `payroll.mjs baseLines` | **Payday (Art. 48):** a payday on a Friday, Saturday or approved holiday moves to the previous working day. It shows as proposed until accepted. **Housing (Art. 67):** housing ≠ 25% of basic is a warning, never an automatic change. **Rounding (Art. 50.5):** `riyal_up` rounds every earning and deduction line up to the riyal, and only after the HR manager chooses it. The default stays halala. |
| Business travel (Art. 63–65) | `app/travel.mjs`, tables `travel_decisions`, `travel_extensions`, `travel_expense_links` | A decision records the task, destination, domestic or abroad, and the dates. **Eligibility:** 75 km paved, 40 unpaved, 15 rough; abroad is always eligible. **Grade table:** seeded as draft. **Reductions:** ¼ with housing and transport, ½ with housing only. The exceptions hold: temporary housing, and housing or transport from another party, leave the rate unchanged unless the cost is charged to the company. **Extensions:** at most 14 days in total, after a written progress review, decided by the authority holder. **Allowance:** a **proposed** `allowance` adjustment, class `travel_per_diem`. **Receipts** (visa, fees, tickets) go in as ordinary `expenses.mjs` claims, category `travel`, and are linked back. Same-day approved overtime is flagged (Art. 77.9). |
| Catalog routing | `app/service-routes.mjs`, hooks in `workflow.transition`, table `service_request_links` | **HR-SALARY-CERT, HR-EXPERIENCE-CERT, HR-LETTER:** on approval (or when the type's template is later approved) a letter request is opened under the employee's name, and the catalog request cannot complete until that letter is issued or rejected. **HR-RESIGNATION:** submission creates the dedicated resignation, and the request cannot complete while the resignation is open. **ADM-TRAVEL:** approval opens a proposed travel decision that the authority holder completes. |
| Letter wizard | `letters.mjs`, `static/letters-ui.mjs`, tables `letter_request_options`, `letter_addressees`, `letter_template_starters`, new base type `to_whom` | Each step is described in §2. |

## 2. Letter wizard

1. **Type.** There is one button per type with an approved template: تعريف بالراتب (`salary`), تعريف بدون راتب (`employment`), خبرة (`experience`), سفارة (`embassy`), بنك (`bank`) and لمن يهمه الأمر (`to_whom`). `TYPE_RULES` sets, per type, whether salary shows, which addressees are allowed, whether a purpose is required and whether travel dates are needed.
2. **Addressee.** Choose one of:
   - a Saudi bank (13 names);
   - an embassy (44 countries, with the embassy name and the country);
   - a government entity (8 names);
   - «لمن يهمه الأمر»;
   - free text. Free text must contain letters and must not contain `<>{}`, links or `@`.
   The lists hold names only, are seeded in migration 102 and are for the owner to review.
3. **Language.** Arabic, English or both. Templates are bilingual: the Arabic text, then a line `---- English ----`, then the English text. List addressees and embassy countries render in each language. The employee's name and job title stay in Arabic in both parts, because the platform stores no English form of them.
4. **Salary detail** (salary, embassy and bank only). Choose the total or a breakdown (basic, housing, transport, other), and a monthly or annual figure. It is computed at issue from the active contract. New placeholders `salary_basic`, `salary_housing`, `salary_transport` and `salary_other` follow the `salary_total` rule: they are sensitive and never stored. Legacy requests without options render exactly as before.
5. **Purpose.** Optional. Required for bank letters. Required for embassy letters too, together with the travel dates and destination (the destination defaults to the embassy's country).
6. **Delivery.** Digital (the print page with the QR code, saved as PDF from the browser) or printed and stamped (1–5 copies; HR records the handover). An urgent flag needs a reason. The SLA is 1 working day urgent and 3 normal (`LETTER_SLA_DAYS`). These are proposed defaults for HR to confirm.
7. **Preview.** `POST /api/letters/preview` returns the exact text with the salary masked (`••••••`) and writes nothing. The employee confirms, and the chain then runs as before: HR prepares, a different issuer issues, the employee is notified and downloads the letter.
8. **Reuse.** «اطلبه مرة أخرى» on the employee's own issued, rejected or cancelled letter opens the wizard prefilled. `reused_from` is stored.

**Starter templates.** Six bilingual drafts sit in `letter_template_starters`, each marked «مسودة … تحتاج اعتماد الموارد البشرية». A preparer adopts one as their own draft (`adopt_starter`), and a different `hr.letters.issue` holder approves it. Nothing is published out of the box.

**Deep-link contract for the employee-UX agent:** `#letters/new?type=<code>`, where `<code>` is `salary`, `employment`, `experience`, `embassy`, `bank` or `to_whom`.
- **Screen side:** call `operationModules.letters.route(new URLSearchParams('type=salary'))`. It returns `{action:'request_letter', id:'type:salary'}`. Then open `operationModules.letters.form(action,id,data)` the same way a button click does.
- **Catalog side:** service cards expose `service.module.link` for HR-SALARY-CERT, HR-EXPERIENCE-CERT and HR-LETTER. `service-routes.mjs LETTER_WIZARD_LINKS` holds the same map. `lettersBoard().new_request_route` is `'#letters/new?type='`.

## 3. Routes added to `app/server.mjs`

| Method | Path | Function |
|---|---|---|
| GET | `/api/payroll-rules` | `payrollRules.rulesBoard` |
| POST | `/api/payroll-rules` | `prepareRule` ← `{based_on, parameters, note}` |
| POST | `/api/payroll-rules/:id/(accept\|reject)` | `decideRule` ← `{effective_from, choices, note}` |
| GET / POST | `/api/resignations` | `resignationsBoard` / `submitResignation` ← `{letter_date, proposed_last_day, reason}` |
| POST | `/api/resignations/:id/(withdraw_resignation\|accept_resignation\|defer_resignation\|set_last_day\|open_offboarding)` | `resignationAction` |
| GET / POST | `/api/travel` | `travelBoard` / `proposeTravel` |
| POST | `/api/travel/:id/(approve_travel\|reject_travel\|cancel_travel\|request_extension\|submit_receipt)` | `travelAction` |
| POST | `/api/travel/extensions/:id/(approve_extension\|reject_extension)` | `extensionAction` |
| POST | `/api/payroll/deductions` | `proposeClassifiedDeduction` ← `{user_id, month, amount, reason, class, reference}` |
| POST | `/api/payroll/settlements/:id/record_dues_payment` | `recordSettlementDues` ← `{paid_on, reference}` |
| POST | `/api/letters/preview` | `previewLetter` (no write) |
| POST | `/api/letters/templates/:code/adopt_starter` | `adoptStarter` |
| POST | `/api/letters/:id/record_handover` | `letterAction` |

Screens: `resignations`, `travel` and `payroll-rules` (`static/payroll-rules-ui.mjs`), registered in `operations.mjs` and the nav in `app.mjs`. The service card for ADM-TRAVEL now links to `travel`, and HR-RESIGNATION links to `resignations`.

## 4. Shared files touched (small edits)

- `workflow.mjs`: one import, a `beforeComplete` call and an `afterTransition` call.
- `lifecycle.mjs`: `openBundle` split into a guard plus `createBundle`, and the new `openOffboardingFor`.
- `payroll.mjs`: blocks on `submit_run`/`approve_run`, and rounding in `baseLines`.
- `payroll-checks.mjs`: appends `ruleChecks`.
- `payroll-extras.mjs`: settlement, the advance cap, classified deductions, dues.
- `letters.mjs`: the wizard, starter adoption, handover, bilingual render.
- `service-cards.mjs`: module links.
- `server.mjs`: routes and asset.
- `static/operations.mjs` and `static/app.mjs`: registration and nav.
- `scripts/lifecycle-audit.mjs`: routed services do their module work before closing.
- `tests/payroll-extras.test.mjs` PAY-09: one line accepts the settlement policy with the labor-law reading before preparing. That is the new rule "no settlement approval without a chosen Art. 36(2) reading".
- `docs/traceability.json` and its mirror `docs/implementation/REQUIREMENTS.json`: because that test file changed, its four named tests were re-recorded through `npm run trace -- --record-results docs/testing/test-results-payroll-rules-20260919.txt`. Requirement completion states were not changed.

No change to migrations 001–096, to `.env`, to `hr_policies`, to `payroll_adjustments` or to `notifications`. The coordinator's note on 099 is respected: migration 102 does not alter notifications, and this work adds no new notification subject kinds.

## 5. Open decisions for the owner and the HR manager

1. **Art. 36(2) reading.** Literal (70,000 for 7 years at 10,000) or labor law (45,000). No settlement can be approved until it is chosen.
2. **Art. 91.3 unpaid leave.** Deduct only the days above 20 (`excess`, the seeded default) or the whole total once it exceeds 20 (`total_when_over`, the literal text).
3. **Art. 34.2 deferral anchor.** Are the 60 days counted from submission (seeded) or from the end of the 30-day period?
4. **Deemed-acceptance day.** Seeded as submission + 31 days, reading «أكثر من ثلاثين يومًا» literally.
5. **Authority holder.** Resignation acceptance and deferral, travel decisions and extensions use `hr.contracts.approve` (a policy parameter), because the authority matrix (مصفوفة الصلاحيات) is missing.
6. **Rounding (Art. 50.5).** `riyal_up` or halala. It must be chosen when accepting pay rules, and the default stays halala until then. Finance should confirm too.
7. **Death award factor.** Seeded at 100%. The regulation states only the month's wage and the leave. Confirm with the labour law.
8. **Travel grade.** It is entered on each decision, because contracts carry no grade. Confirm the grade table (Art. 65) against the signed PDF.
9. **Wage base for caps.** The monthly contract total is used for the 10% and 25% caps, and total ÷ 30 for fines. Confirm whether «الأجر» means the total or the basic.
10. **Letter issuer.** `hr.letters.issue` stays a sensitive grant held by no role. The super admin must grant it to the HR manager for letters to issue in a fresh install.
11. **Letter lists and SLA.** Review the bank, embassy and government names; the English name and job title placeholders; the embassy extras (nationality, passport); and the 1/3-day SLA.
12. **Notifications.** Resignation and travel events do not notify yet. Once 099 lands, `resignation` and `travel_decision` subject kinds can be added under its format rule.

## 6. Tests

`tests/payroll-rules.test.mjs` has 12 tests:
- regulation policies and choices;
- deemed acceptance and deferral limits (runs the job with an injected clock);
- the investigation block and hold, and the discipline hook;
- the offboarding trigger;
- settlement: both readings (70,000 / 45,000), unpaid-leave exclusion, the dues deadline and payment record, death;
- each deduction cap, and a blocked run;
- the payday shift, housing and rounding;
- per-diem: reductions, exceptions, distance, extension cap, proposed adjustment, receipts;
- starter templates;
- every wizard option path, with a masked preview;
- end to end with a printed handover, reuse and "salary never persists";
- the catalog HR-SALARY-CERT routing.
