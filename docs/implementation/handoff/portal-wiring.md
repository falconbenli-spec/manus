# Portal wiring: closing five gaps from the 19 September integration — 20 September 2026

**Branch** `worktree-agent-ab46d52e98114e649`, cut from `codex/local-foundation` at `6e9fb81`. Nothing was pushed. `.env` was not touched. Migrations 001–104 were not edited.

**State: built locally and tested locally on synthetic data.** No process owner has accepted any of it. Every regulation value still comes from the drafts of migrations 097–103 and still needs its owner. The platform still moves no money, sends no email (delivery is off), and talks to no insurer.

**Scope.** The five items marked as gaps in `integration-20260919.md` §5:

| # | Gap in §5 | Now |
|---|---|---|
| 1 | «طلباتي» lists neither resignations, nor travel decisions, nor benefit requests | all three are listed, each read through its own module's board |
| 2 | Resignation and travel notify nobody | subject kinds `resignation` and `travel_decision`, wired into both modules |
| 3 | Benefit letters are recorded, not generated | the benefit-letter option opens a real letter request; the employee downloads an issued document with its QR code |
| 4 | The discipline link panel in `portal-ui.mjs` no longer renders | «مخالفاتي وجزاءاتي» is on home for anyone who has a case or a penalty |
| 5 | An approved class upgrade does not change the enrolment tier | it does, with an audit line and a notice — **the insurer must still be told, by hand** |

## 1. Files

**New**

- `app/migrations/105-benefit-letter-type.sql` — the only migration. Two inserts, no table touched. See §4.
- `tests/portal-wiring.test.mjs` — 5 tests, one per gap.
- this file.

**Changed**

| File | Change |
|---|---|
| `app/my-requests.mjs` | three imports, three source names, three read blocks. The returned shape is unchanged. |
| `app/module-notices.mjs` | `resignationNotice` and `travelNotice`, plus one private helper for the capability holders. Nothing existing was edited. |
| `app/resignations.mjs` | one import and four notice calls (submit, the three decisions, the deemed-acceptance job). |
| `app/travel.mjs` | one import and six notice calls. |
| `app/notices.mjs` | two lines: `SUBJECT_LINKS` gains `resignation` and `travel_decision`; the `my_requests` category name now names them. |
| `app/benefits-portal.mjs` | the benefit-letter option opens a letter request; the class upgrade writes the register. |
| `app/benefits.mjs` | one new export, `applyClassUpgrade`. |
| `app/letters.mjs` | a `TYPE_RULES` entry for `benefit_letter`, and two read-only exports for the benefits module (`letterRequestSummary`, `letterTypeReady`). |
| `app/home.mjs` | `disciplineSummary()`, one payload key, one conditional card. |
| `app/static/home-ui.mjs` | the «مخالفاتي وجزاءاتي» section and its card name. |
| `app/static/benefits-portal-ui.mjs` | shows the generated letter's status and reference; the HR form no longer asks for a hand-typed reference when one was generated. |
| `app/static/portal-ui.mjs` | the dead panel removed, replaced by a comment saying where it went. |

Not touched: `server.mjs` (no new route), `access.mjs` (no new capability), `workflow.mjs`, `service-catalog.mjs`, `app/static/app.mjs` (the menu entry «مخالفاتي وجزاءاتي» is unchanged), migrations 001–104, `.env`, `docs/traceability.json`.

## 2. «طلباتي» (gap 1)

`myRequests()` gains sources 9, 10 and 11. The rule of the page is unchanged: **each source is read by its own module's board function, as the caller, and then filtered to what the caller filed.** There is still no `user_id` parameter.

| Source | Read through | Kept | Status mapping | Link |
|---|---|---|---|---|
| `resignation` | `resignationsBoard` | `own` | submitted, deferred → `pending`; accepted, deemed_accepted → `approved`; withdrawn → `cancelled` | `#resignations` |
| `travel` | `travelBoard` | `own` | proposed → `pending`; approved → `approved`, or `completed` once the last day has passed; rejected; cancelled | `#travel` |
| `benefit` | `myBenefits` | its own requests (the function has no employee id, so it reads the caller) | pending_hr, pending_finance → `pending`; completed; rejected; withdrawn → `cancelled` | `#my-benefits` |

Details worth keeping:

- **The resignation's due date is the deemed-acceptance day** (Art. 34/1), and only once the HR manager has accepted the resignation rule. It is shown as a date and is **never** marked "past due": it is a statutory date, not a service level, and the existing `overdue` flag means a missed service level.
- **An approved trip whose last day has passed reads «مكتمل»**, the same reading already used for approved leave that has ended.
- **The benefit row's title is the option name and its reference only** — `خطاب بالمزايا — BEN-2026-0001`. The module's own summary for `dependant_add` carries a relation and a birth date; that is third-party personal data and does not belong in a general list, even the owner's own.
- A manager sees the team's travel in «الانتداب» and a resignation addressed to him in «الاستقالة»; neither appears among **his** requests. The test asserts this.

## 3. Notifications for resignation and travel (gap 2)

Two subject kinds, both passing the shape rule of migration 099 (`[a-z_]`, 3–40 characters) and both added to `SUBJECT_LINKS`:

- `resignation` → `#resignations`
- `travel_decision` → `#travel`

**Email categories (migration 100).** The category list is a closed `CHECK` on `notifications.category`, so no category was added. Each notice names its category explicitly rather than relying on the fallback:

- what waits for someone's decision → `approvals`
- everything that reaches the person the record is about → `my_requests`, whose displayed name now reads «… واستقالتي وانتدابي» so the employee choosing email categories knows what is in the group.

**Events**

| Event | Who hears | Kind |
|---|---|---|
| Resignation submitted | the employee (a receipt, with the deemed date when the rule is accepted) | `resignation_submitted` |
| | the department manager it is addressed to, and every `hr.contracts.approve` holder | `resignation_decision_needed` |
| Deferred | the employee | `resignation_deferred` |
| Accepted | the employee, with the last working day and whether notice was waived | `resignation_accepted` |
| Deemed accepted (the queue job) | the employee **and** whoever still owed a decision | `resignation_deemed_accepted` |
| Last working day set | the employee | `resignation_last_day_set` |
| Withdrawn | whoever was waiting to decide | `resignation_withdrawn` |
| Travel proposed | the traveller (when someone else proposed it) and the authority holders | `travel_proposed`, `travel_decision_needed` |
| Approved / rejected / cancelled | the traveller | `travel_approved`, `travel_rejected`, `travel_cancelled` |
| Extension requested | the authority holders, and the traveller when someone else asked | `travel_extension_needed`, `travel_extension_requested` |
| Extension approved / rejected | the traveller | `travel_extension_approved`, `travel_extension_rejected` |

**What a notice never carries**, following `notices.mjs`: the reason for the resignation, the written reason for a deferral, the decision note, and **any per-diem figure**. The travel-approval notice says the allowance is a proposed payroll movement and leaves the amount to the screen; the test asserts the body has no digit in it at all.

**One deliberate exception to "nobody is told of their own action".** The submit receipt goes to the person who submitted, exactly as «استلمنا طلبك» does for a catalog request. Deemed acceptance also ignores the rule, because nobody acted: the queue job runs under the account that enqueued it, which is usually the employee's own.

## 4. Benefit letters are generated (gap 3)

**Migration 105** adds, and does nothing else:

1. a shared base letter type `benefit_letter` («خطاب بالمزايا») in `letter_types`, alongside the six of migrations 048, 097 and 102;
2. a bilingual **draft** starter in `letter_template_starters`, in the same shape as the six starters of migration 102 — Arabic, the `---- English ----` line, English.

Nothing is published by the migration. As with every other type, a preparer adopts the starter as their own draft (`adopt_starter`) and a **different** `hr.letters.issue` holder approves it.

The starter's placeholders are `{{addressee}}`, `{{employee_name}}`, `{{job_title}}`, `{{hire_date}}`. **There is no salary placeholder and no insurance-tier or policy-number placeholder**: the platform is a register, not an issuer of cover, and the text says the cover details come from the insurer. The wording is a draft for the HR manager to rewrite or accept.

**Flow.** In «مزاياي», choosing «خطاب بالمزايا»:

1. If the type has an approved template, `submitBenefitRequest` opens a **real letter request** through `letters.requestLetter`, under the employee's own name, in the same transaction — addressee kind `other` with the text the employee typed (so the letters module's free-text rule applies), the chosen language, the purpose name, digital delivery, one copy. Its id is stored in the benefit request's `details`, which the schema then freezes.
2. The benefits team's approval no longer asks for a hand-typed reference. It completes the benefit request and records the link.
3. The letters chain runs unchanged: one person prepares, a **different** `hr.letters.issue` holder issues, and the employee gets a document with the yearly gapless reference, the print page and the QR verification path. The employee is notified by the letters module, as for any other letter.
4. «مزاياي» shows the letter's status and reference and links to «خطاباتي»; the text and the verification code stay there, under the letters module's own visibility rule.

**Fallbacks that are not failures.** Before the template is approved, the option still works and keeps the old behaviour: HR issues the letter outside the platform, records its reference and uploads the file. The option reports `letter_ready: false` so a screen can say so. And while a benefit letter request is open in «خطاباتي», the option is unavailable with that reason — the letters module refuses a second open request of one type, and the employee is told before submitting rather than after.

## 5. «مخالفاتي وجزاءاتي» on home (gap 4)

`portal-ui.mjs` stopped being imported when employee UX merged «ملخصي» into home, so migration 097's link panel had been dead since that merge. It is removed from `portal-ui.mjs` (with a comment saying where it went) and rebuilt on home.

`homeBoard()` gains `discipline`, built from `myDiscipline()` read as the caller, and **it is `null` unless the person has a case or a penalty**: nobody is reminded of violations they do not have. When it is present, home also gains one card, `discipline`.

The section carries the case reference, its status, the effective penalty label, the nearest statutory deadline (Art. 119, 117, 120, 126/2, from the module), whether something waits for the employee, and the count of penalties in force. **It carries no accusation text, no defence, no grievance and no fine amount** — those stay in «مخالفاتي وجزاءاتي», where the module's own visibility rule governs them. The menu entry is unchanged.

## 6. The insurance register follows an approved upgrade (gap 5)

`benefits.mjs` gains `applyClassUpgrade(db, actor, employeeId, tier, {reason, reference})`. It refuses when there is no open enrolment, when the tier is not one of the policy's tiers, when the tier is unchanged, and when the actor is the insured employee. It updates `medical_enrolments.tier` and writes a `benefits.class_upgraded` audit line with the old and new tier and the request reference.

It is called from **`financeDecision`**, the last gate of the `class_upgrade` chain, because that option needs money: HR sets the premium difference, finance confirms it, and the schema of migration 103 already enforces that the employee decides nothing and that the finance confirmer is not the HR decider. The function therefore carries no capability check of its own — the authorisation came from that chain — but it keeps the separation of duties. The register does **not** move at the HR step; the test asserts that.

The employee is notified (`benefit_class_upgraded`), and the request's `outcome` records `enrolment_id`, `from_tier` and `tier`. The premium difference remains what it was: a **proposed** payroll deduction.

> **The insurer is still not told.** The platform is not connected to any insurer; `benefits.mjs` `CONNECTION_NOTE` has always said so. Changing the class in the register is the record of a decision, not the act. **Someone on the benefits team must change the class with the insurer, by hand, and the platform has no way to know whether they did.** The employee's notice says this in as many words. If a reconciliation against the insurer's member list is ever wanted, that is new work.

## 7. Tests

`npm test`: **822 tests, 821 pass, 1 fail.** The failure is `timesheets: billable is the approver's determination…`, which is the known Sunday failure: today is Sunday 20 September, `addDays(today,-1)` falls in the previous week, so the week holds one entry instead of two and the "every entry needs a determination" assertion does not throw. It fails identically when run alone and has nothing to do with this work. The procurement conflict-of-interest test, the other known flake, passed both in the suite and alone (13/13).

Before this work the same suite was **817 tests, 816 pass, 1 fail** — the same timesheets failure. The five new tests are in `tests/portal-wiring.test.mjs`:

1. «طلباتي» carries the resignation, the travel decision and the benefit request, with the right status words, dates and links; a colleague sees none of them; the manager sees neither the team's travel nor the resignation addressed to him among his own; a finished trip reads «مكتمل»; the aggregation shape and counts are unchanged; the screen renders the three source names.
2. Resignation and travel notices: the submit receipt (and that it carries no reason), the decision notice to the authority holder in the `approvals` category, deferral, acceptance with the last working day, deemed acceptance through the real queue job to both sides, the last working day being set with the notice waiver, travel proposal, approval with **no figure in the body**, and the extension both ways.
3. The benefit letter: no letter request before the template is approved and the old recorded path still works; after approval a real letter request is opened with the right addressee, language and delivery; a second one is refused with a readable reason; the HR form drops the hand-typed reference; whoever prepares does not issue; the issued document carries the reference and a working QR verification code, the bilingual template text, and no salary figure.
4. The discipline section: `null` and absent from the screen for someone with no case, present with its card and deadline once a case exists, `needs_you` once a defence is owed, and the accusation text never reaching home.
5. The class upgrade: unavailable until the accepted policy allows upgrading at the employee's cost, register unchanged after the HR step, changed after the finance confirmation, with the audit line, the outcome, the notice naming the insurer step, and the deduction still only proposed.

`npm run check`: passes. 408 modules (was 407), source hashes match, traceability 220 requirements / 22 domains.

**Migration smoke tests**, the same two the integration used:

- **Fresh database:** 002 → 105 applied in order, `schema_migrations` holds 90 rows (version 1 plus 89 files), max version 105. `integrity_check` ok, `foreign_key_check` empty, before and after `scripts/seed.mjs`.
- **A copy of the live preview database** (`work/hr-design-preview-20260914.sqlite`, copied with its `-wal` and `-shm`): 89 rows / max 104 → **90 rows / max 105**. `integrity_check` ok, `foreign_key_check` empty. The source's SHA-1 was `32a2a884…` before and after; the source file was never opened.

## 8. Left out on purpose

1. **No browser walkthrough.** Same gap as the integration: only `ui-render` and the node tests cover these screens. The home section, the «طلباتي» rows and the «مزاياي» letter row have not been looked at in a browser.
2. **The benefit letter offers Arabic or English, not both.** The letters wizard supports «العربية والإنجليزية»; the «مزاياي» option's own form has always offered two choices and was left as it is. Adding «both» is one line in `optionDetails` plus the form.
3. **The `benefit_letter` type is not in the «خطاب» variant card** of the employee-UX variant model. It is reachable from «مزاياي» and from the letters wizard. Adding it to the card is the letters/UX owner's call.
4. **No notice for travel receipts or for opening an offboarding bundle.** Both are actions the person already knows about.
5. **No new email category and no change to `mailer.mjs`.** Resignation and travel notices ride `my_requests` and `approvals`. A separate «استقالتي وانتدابي» category would need a migration to widen the closed `CHECK` of migration 100, and the owner has not chosen the default categories yet (§6.3 of the integration handoff).
6. **`docs/traceability.json` was not changed**, as in the integration handoff, to avoid conflicting with the two agents working in parallel. `npm run check` does not require it.
7. **The insurer reconciliation** described in §6.
8. **The §5 items that are not mine:** the two unpaid-leave thresholds, the two Art. 116 fine caps, and the traceability evidence entries.

## 9. Decisions this adds to the owner's list

1. **The `benefit_letter` template text.** The starter in migration 105 is a draft written from the platform's own records. The HR manager rewrites or accepts it, in both languages, and a different `hr.letters.issue` holder approves it. Until then the benefit-letter option keeps recording letters issued outside the platform.
2. **Who changes the class with the insurer**, and whether the platform should carry a "told the insurer on …" record beside the tier, rather than leaving that step invisible (§6).
3. **Whether the deemed-acceptance date should be shown as a due date in «طلباتي»** at all. It is shown but never called late; an owner may prefer it not to sit in the same column as a service level.
4. **Whether the home discipline section should appear for a manager or an HR user who happens to have a case of their own.** It does today, because the section is about the person, not the role.
