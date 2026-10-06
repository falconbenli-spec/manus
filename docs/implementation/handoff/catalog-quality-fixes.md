# Service catalogue and request engine: the contract a card declares is now the contract the server keeps — 20 September 2026

**Source.** `docs/product/audits/CATALOG-SWEEP-20260920.md` (branch `worktree-agent-ac80d5231a99d2fcf`), where all 142 catalogue cards were walked over HTTP from creation to closure, twice. This branch fixes defects 1, 2, 3, 5, 9 and 12 from that sweep's table, plus section 4-أ (one-step chains on financial and access services) and the `vendors.bank` capability the vendor-bank service never called.

**State.** Built and tested locally. **Nothing here is accepted by a process owner.** Every change that alters who approves a request, or how long a service has, ships as a *draft proposal* with a screen to adopt or reject it. The live chains and service levels on this branch are what they were, except for the two items the audit called defects rather than policy questions: the stored field contract, and the vendor-bank financial verification.

---

## 1. What was wrong, and what the server does now

### 1.1 A conditionally required field was never required (sweep defect 2)

`coreField` built the version of a service that actually gets stored, and it dropped `show_when` and forced `required:false` on any conditional field. `validatePayload` reads only the stored version. So the rule existed in `app/service-catalog.mjs` and was enforced nowhere.

Proven in the sweep: `HR-PROFILE-UPDATE` submitted with `change_type:'الهوية أو الإقامة'` and **no document expiry** returned 201.

- `app/validation.mjs:20` — `FIELD_RULE_KEYS` names the five keys that are rules rather than presentation (`min_length`, `max_length`, `pattern`, `pattern_message`, `show_when`). It lives here because this file is what enforces them, and because `service-catalog.mjs` and `workflow.mjs` import each other, so neither is a safe home for a constant read at module load.
- `app/service-catalog.mjs:37` — `coreField` stores `required` as written and carries every rule key into the stored service version.
- `app/workflow.mjs:282` — `fieldRules()`, called from `createService` at `app/workflow.mjs:311`, validates and persists them: a pattern must compile and must carry an Arabic message saying what is acceptable; a length bound must be an integer 1–3000 on a text field with min ≤ max; a condition must name an earlier **select** field in the same service, must not itself be conditional, and its values must be among that field's options.

All 10 conditional fields in the catalogue are now enforced. `HR-PROFILE-UPDATE` without the expiry is refused 400 `missing_field`, naming the field.

### 1.2 Format and length rules were never applied (sweep defect 3)

Same root cause. Proven in the sweep: `HR-ATTENDANCE-FIX` accepted `from_time:'قبل الظهر'` and `to_time:'99:99'` and stored both verbatim.

All 14 pattern-bearing fields are now enforced. The refusal names the field and says what is acceptable, taken from the field's own `pattern_message`:

> من الساعة: اكتب الوقت بأربع خانات على مدار 24 ساعة، مثل 09:30

**Coordination with the other agent's work on refusal wording.** The existing refusal strings in `app/validation.mjs` are untouched. The one addition (`app/validation.mjs:52`) fires only for a field that *declares* a length bound — which today only catalogue fields do — and it keeps the existing `invalid_text` code, so no other path's contract changes. It replaces a bare «قيمة غير صالحة» with the acceptable range for that field: «السبب: اكتب 5 حرفًا على الأقل».

### 1.3 Field guidance never reached the employee (sweep defect 5)

`/api/catalog` returned the stripped stored shape; `enrichFields` was called only by the admin quality board. `HR-PROFILE-UPDATE` reached the form with 0 of its 3 fields carrying guidance.

- `app/service-catalog.mjs:52` — `enrichCatalog()`.
- `app/server.mjs:258` — `/api/catalog` serves the enriched shape. `app/server.mjs:167` does the same for a request's own service, so editing a draft shows the same guidance; `app/service-catalog.mjs:1270` does it for the variant composer.
- `enrichFields` now overlays **presentation only** (`hint`, `example`, `why`). Rules come from the stored version, so what the form shows about a condition is what the server enforces — the file can no longer disagree with the database.
- `app/static/app.mjs:376` — `fieldInput` renders the hint, the reason the field is asked and its example under the field, carries `maxlength`/`minlength`/`pattern`, and hides a conditional field until its condition holds. `applyFieldConditions` (`app/static/app.mjs:387`) runs when the composer opens and on every change; a hidden field's control is disabled, so its value is never submitted. **The hiding is presentation; the enforcement is `validatePayload`.**

`/api/catalog` now returns 3 of 3 guided fields for `HR-PROFILE-UPDATE`.

### 1.4 The vendor-bank service never called `vendors.bank` (sweep section 4-أ) — fixed directly

`PRC-VENDOR-BANK` closed on a free-text note saying the verification had happened. The platform's own `vendors.bank` capability («التحقق المالي من بيانات دفع الموردين») — which already enforces an independent verification method and that the verifier is not the person who collected the details — was never invoked.

`app/service-routes.mjs:68` — `vendorBankGate()`. The request does not close until the vendor named in the form exists in the vendor register **and** a bank account for it has been verified there after this request was submitted. The verification that closed the request is written to the request's own audit trail as `service.vendor_bank_verified`, so the closure is not its own evidence. Refusals: `vendor_not_registered` (naming the vendor and what to do) and `bank_verification_required`.

This is a behaviour change on a live service, and it is deliberate: it is the one item in section 4-أ the audit called a defect rather than a policy question.

### 1.5 SLAs could not express less than a working day (sweep defect 9)

`setServiceTarget` took days; `computeClock` counted days. A Thursday-afternoon security incident was due Sunday.

- `app/migrations/115-service-hours-and-deputies.sql` — `service_directory.target_hours` (nullable; NULL means «days, as before»).
- `app/work-calendar.mjs:41` — `SERVICE_DAY` is 09:00–17:00 Riyadh: eight working hours, the same divisor already written in the attendance rules draft (`hour_divisor_hours:8`). `addWorkingHours`, `workingHoursBetween` and `riyadhStamp` measure inside that window on Sunday–Thursday, skipping approved holidays. A report arriving outside the window starts its clock when the window next opens, so no hour is charged to a department that was not on duty.
- `app/workflow.mjs:371` — `setServiceTarget(db,u,code,days,hours)`. `app/routing.mjs:25` — `serviceTarget()` reads both, and the clock prefers hours when they are set. `app/request-timeline.mjs` reads the same target, so the request page and its timeline cannot disagree.

Thursday 14:00 + 2 working hours is now **Thursday 16:00**, not Sunday. Thursday 16:30 + 2 hours rolls to Sunday 10:30, which is correct: only thirty minutes of that day remained.

### 1.6 A closed request lost its due date (sweep defect 12)

`computeClock` returned `due_on:null` for every closed status, so adherence could not be read from the request at all. It is now computed from the submission and the moment of closure, and the result carries `met` and `closed_on`. A draft still has no due date, because it was never submitted. Time spent waiting on the requester still does not count against the department.

Two existing tests asserted the defect («a closed request has no clock», «a closed request stops the clock»). Both were rewritten with a note explaining what changed: the clock stops *running* at closure; it is no longer *erased*.

---

## 2. Proposals awaiting an owner's adoption

All drafts. Nothing in this section is applied on this branch. They appear on **إعداد الاعتماد** (`/api/approval-settings`, `app/static/approval-settings-ui.mjs`), each with its reasoning, the chain before and after, and any warning — all shown *above* the adopt button.

### 2.1 Sixteen corrected approval chains (item C1)

`CHAIN_PROPOSALS` in `app/service-catalog.mjs:933`. Each is a function of the current catalogue policy, so it follows any later change to the service. The reasoning names what the service touches, not the change:

| Code | Now | Proposed | Why (as shown to the owner) |
|---|---|---|---|
| PRC-VENDOR-BANK | مدير المشتريات | + مدير المالية | يمسّ بيانات دفع مورد: تغيير الآيبان ناقل احتيال معروف |
| FIN-BUDGET-TRANSFER | مدير المالية | + الرئاسة | ينقل مالًا بين بنود الميزانية بقرار فرد |
| HR-BANK-CHANGE | موظف الموارد البشرية | مديرك ← الموارد البشرية | يغيّر وجهة الراتب |
| HR-GOSI-CORRECTION | موظف الموارد البشرية | + مدير المالية | يغيّر الأجر الخاضع للاشتراك |
| HR-JOB-CHANGE | موظف الموارد البشرية | مديرك ← الموارد البشرية | يغيّر المسمى والدرجة |
| DIG-BUDGET-CHANGE | مدير التسويق | + مدير المالية | يغيّر إنفاقًا إعلانيًا حيًّا |
| DIG-AD-ACCOUNT | مدير التسويق | مديرك ← مدير الإدارة | يمنح صلاحية إنفاق على منصة خارجية |
| INF-PROOF-PAYMENT | مدير العلاقات العامة | + مدير المالية | إقرار بالتنفيذ يسبق السداد، من الجهة الطالبة نفسها |
| LEG-PRIVACY-REQUEST | مدير الحوكمة | + الرئاسة | طلب بيانات شخصية له أثر نظامي ومهلة |
| IT-NEW-ACCOUNT | مدير التقنية | مديرك ← تقنية المعلومات | ينشئ هوية جديدة بلا طلب موثق |
| ACC-CHANGE-REQUEST | مدير الحسابات | + مدير إدارة الأعمال | التزام تجاري يمسّ النطاق والسعر |
| ACC-RENEWAL | مدير الحسابات | + مدير إدارة الأعمال | تجديد أو توسعة حساب عميل |
| ACC-BRIEF-INTAKE | مدير الحسابات | مديرك ← مدير الإدارة | تكليف يلزم الفرق بعمل |
| ACC-CLIENT-COMPLAINT | مدير الحسابات | + مدير إدارة الأعمال | شكوى تُغلق داخل الإدارة المشكو منها |
| ACC-MEETING-MINUTES | مدير الحسابات | مديرك ← مدير الإدارة | محضر يصير مرجعًا لما التُزم به |
| ACC-STATUS-REPORT | مدير الحسابات | مديرك ← مدير الإدارة | تقرير يذهب للعميل باسم الشركة |

### 2.2 Five service levels in hours (item C2)

`TARGET_PROPOSALS` in `app/service-catalog.mjs:1025`, adopted or rejected through `decideServiceTarget` (`app/service-catalog.mjs:1039`, `POST /api/approval-settings/targets/:key/decide`), recorded append-only in `service_target_adoptions` with its basis. A rejection is recorded too, so it is not shown again as undecided.

| Code | Now | Proposed |
|---|---|---|
| IT-SECURITY-INCIDENT | 1 working day | 2 working hours |
| IT-OUTAGE | 1 working day | 2 working hours |
| IT-PASSWORD-UNLOCK | 1 working day | 1 working hour |
| ADM-SAFETY | 1 working day | 2 working hours |
| PR-ISSUE-ALERT | 1 working day | 2 working hours |

**The other 137 service levels are untouched.** They are listed on the same screen for owner review, because every one is still derived from the service's code family by `defaultTargetDays` and signed off by nobody — including the 82 in the five-day and seven-day buckets that the sweep named in section 4-ب, and the 17 that land in the ten-day default only because their prefix matches no rule.

### 2.3 Separation of duties: the warning, and the named deputy (sweep defect 1)

Adopting proposal B3 today makes 13 financial and access services unexecutable: the approver is the only person in the department, so the request sits at «approved» with 409 `no_executor` indefinitely. The platform's own health check already detected this — **after** adoption.

- **The warning now comes first.** `proposalImpact()` (`app/service-catalog.mjs:1230`) computes the policy the proposal *would* produce and checks it, so the adoption screen names the 13 services before the owner clicks, with a banner at the top of the page. It identifies exactly the 13 the sweep named:

  `FIN-PAYMENT-REQUEST`, `FIN-REFUND`, `FIN-BUDGET-TRANSFER`, `FIN-CUSTODY`, `PRC-PURCHASE-REQUEST`, `PRC-EMERGENCY`, `PRC-PO-CHANGE`, `PRC-VENDOR-BANK`, `DIG-AD-ACCOUNT`, `DIG-BUDGET-CHANGE`, `INF-PROOF-PAYMENT`, `DAT-DATA-ACCESS`, `LEG-PRIVACY-REQUEST`

  Once a deputy is named for a service, its warning becomes «أثر مغطّى» rather than disappearing.

- **The named deputy is the way out.** `execution_deputies` (migration 115) holds one explicitly named person per service, from another department, with a written basis, assigned by whoever manages structure and escalation (`setExecutionDeputy`, `app/workflow.mjs:672`, `POST /api/approval-settings/deputies`). `deputyExecutor()` (`app/workflow.mjs:84`) admits them **only** when separation of duties has left no executor at all in the handling department. Separation of duties still binds the deputy: one who approved a step of the current revision cannot execute, nor can the requester or the beneficiary. The deputy sees that request and nothing else in that department. Every execution by a deputy is written to the audit as `execution.deputy_claimed` with the basis of their appointment, so it never reads as ordinary execution by the department.

---

## 3. Evidence

### 3.1 Tests

`npm test` — **865 tests, 865 pass, 0 fail** (baseline at HEAD `9f95cde`: 847 tests, 847 pass, 0 fail).
`npm run check` — 417 modules, source hashes match, 220 requirements / 22 domains.

New: `tests/catalog-quality-fixes.test.mjs`, 14 tests, one per defect, each walking the sweep's own reproduction rather than an abstraction of it.

**Each fails first.** Run against a pristine copy of HEAD `9f95cde`, the seven defect probes fail 7/7, and pass 7/7 on this branch:

| Probe | at HEAD | after |
|---|---|---|
| conditional field is required when its condition holds | ✖ | ✔ |
| `99:99` is refused, with the acceptable format named | ✖ | ✔ |
| `/api/catalog` carries field guidance | ✖ | ✔ |
| an hour-based target exists and is honoured | ✖ | ✔ |
| the adoption screen warns about the 13 before adoption | ✖ | ✔ |
| a closed request keeps its due date | ✖ | ✔ |
| PRC-VENDOR-BANK cannot close on a text note | ✖ | ✔ |

Existing tests changed, each for a stated reason:
- `tests/request-quality.test.mjs` — the test that passed only because it validated the model rather than the stored service now runs against the stored service. Its companion asserted the defect (`required:false` on a conditional field, rule keys absent); it now asserts that rules are stored and only presentation is overlaid.
- `tests/work-calendar.test.mjs`, `tests/routing-portal.test.mjs` — the two assertions that encoded the lost due date.
- `tests/service-catalog.test.mjs`, `scripts/lifecycle-audit.mjs` — their generated sample values now honour the contract each field declares, which is the point: a service that declares a format no value can satisfy now fails there, instead of passing with a value that is not acceptable. `lifecycle-audit.mjs` also performs the vendor registration and financial verification for `PRC-VENDOR-BANK` the way a real executor would, so the walk still reaches closure through the new gate rather than around it.

### 3.2 The sweep harness, before and after

`scripts/qa-catalog-sweep.mjs` and `tests/catalog-sweep.test.mjs` were copied in byte-for-byte from `worktree-agent-ac80d5231a99d2fcf`; that branch was not merged. Both runs below are on the same machine:

| | HEAD `9f95cde` | this branch |
|---|---|---|
| **As the platform ships** | | |
| created / submitted / fully approved | 142 / 142 / 142 | 142 / 142 / 142 |
| closed with evidence | 138 | 137 |
| stopped at a gate awaiting an owner | 4 | 5 |
| broke with no gate waiting on anyone | 0 | 0 |
| **Fully enabled (every proposal adopted)** | | |
| created / submitted / fully approved | 142 / 142 / 142 | 142 / 142 / 142 |
| closed with evidence | 125 | 125 |
| `no_executor` | 13 | 13 |
| stopped at a gate awaiting an owner | 4 | 4 |

The single difference is `PRC-VENDOR-BANK`, which moved from «closed on a text note» to «stopped at `vendor_not_registered`, waiting for the financial verification to be done in the vendor's file». The three letter services and the resignation were already waiting on owner decisions before this branch.

**142 of 142 still create and submit in both modes**, with values generated from each card's own field definitions. That is the check that the newly enforced field rules did not break a single card.

The 13 `no_executor` in the enabled run are unchanged by design: the harness adopts every proposal and names no deputy. That is exactly the situation the adoption screen now warns about, and the deputy mechanism is what resolves it.

---

## 4. What an owner has to decide

1. **Sixteen approval chains** (§2.1) — adopt, reject or amend each. Adoption creates a new service version and does not touch requests already submitted.
2. **Five service levels in hours** (§2.2) — adopt or reject each. Rejecting keeps the current whole-day target.
3. **The other 137 service levels** — none was ever signed off; all are derived from the code prefix. The screen lists them.
4. **Separation of duties (B3)** — if adopted, 13 services need a named deputy first, or they stop. The screen says which, before adoption.
5. **The service-clock window** — 09:00–17:00 Riyadh is the platform's setting for measuring an hour-based target, taken from the eight-hour divisor already in the attendance rules draft. It is not the company's approved working-time policy, which remains an HR decision.

## 5. Not done, and why

- One-step services outside section 4-أ were left alone: the sweep did not call them mismatched, and proposing a chain for every service would bury the sixteen that matter.
- `mode:'parallel'` is still used by no service (sweep defect 15), and the 11 services that accept both a generic request and a module request (defect 11) remain an open owner decision recorded in `employee-ux.md` §1.5. Neither is in this branch's scope.
- Nothing was sent, published or connected to any outside party. No migration numbered 001–106 was touched; this branch adds 115 only.
