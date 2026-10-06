# Reference app workflows vs. the 3,6T platform (19 September 2026)

**What this is.** A process-by-process reading of the older internal HR app that 3,6T used, set against the company's own approved work regulations (لائحة تنظيم العمل) and against our platform's code. It ends with what to adopt, what to drop, and a prioritised backlog.

**State of everything proposed here: proposed only.** Nothing in this document is built, tested, or accepted by the process owner. Every rule taken from the regulations needs the HR manager's acceptance before real use (owner rule: the HR manager signs off HR and payroll rules; no invented statutory rates).

**Sources and how far to trust them**

| Source | Status | Caveat |
|---|---|---|
| `work/reference/manus-app/server/work-regulations.txt` | Primary. The company's regulations, approved on the Qiwa platform (April 2025, 52 pages). | The text is PDF-extracted Arabic in visual order. I normalised it (Unicode NFKC and reversed word order per line). Prose reads cleanly. Some penalty-table cells are scrambled, and I resolved them by hand. **Check every number against the signed PDF before encoding.** |
| `server/index.ts`, `server/zohoDb.ts`, `server/servicesDb.ts`, `server/emailSystem.ts` | Read in full or by route | Many modules the routes import are missing from the snapshot (listed in §6). |
| `server/portal-app.html`, `vite.config.ts` (it contains dev copies of API routes and the AI assistant's prompt) | Read by grep | — |
| Client pages: Leave, LeaveRequestsTab, Attendance, MyTasks, EmployeePortal, Engagement, SkillsMatrix, Dashboard, AdminSettings | Read by grep and excerpt | These pages import `warningLetter.ts`, `salaryDocuments.ts`, `leaveTypes.json` and `Surveys.tsx`, which are all missing. |
| `todo.md` | Development history | Records intent, not verified behaviour. "Done" items were not re-tested. |
| Our platform, `app/*.mjs` | Read in code. File and function names are cited below. | "Encoded" means the code enforces it locally. It does not mean the rule is accepted. |

No personal data, names, credentials or company identifiers are reproduced here. The old app contains several of each (see §5, "drop").

---

## 1. Process map of the old app

Legend: **Actors** use the old app's own roles. Its role model was `owner`, `admin`, `manager` and `employee`. In the portal, "manager" meant *job title contains the word مدير*, and "HR" meant *department name equals the HR department's name* (`index.ts`, `/api/employee/portal-pending-approvals`).

### 1.1 Leave request and approval

| Item | Old app behaviour | Evidence |
|---|---|---|
| Steps | (1) Employee opens the portal and picks a type (annual, sick, emergency, marriage, bereavement, hajj, maternity or paternity by gender, exam), dates, a reason and, for every type except annual and emergency, a required attachment. (2) The server rejects overlapping dates. (3) A `leave_requests` row is created with `managerApproval=pending` and `hrApproval=pending`, and a copy goes to `self_service_requests`. (4) Direct manager approves or rejects. (5) HR gives the final approval. | `portal-app.html` `toggleLeaveAttachment`, `index.ts` `POST /api/employee/portal-leave-request`, `PATCH /api/leave-requests` |
| Approval chain | Hard-coded manager, then HR. An `approval_chains` table and an admin screen existed (`AdminSettings.tsx`, `zohoDb.ts replaceApprovalChain`), but the chain was **not enforced**. A "chain approver" simply saw every pending request in every department at manager level. HR saw every manager-level request too and could act as manager. | `index.ts` lines 2708–2873 |
| Day count | Calendar days `(end − start) + 1`, with no calendar and no holidays. | `portal-leave-request` |
| Balance | `leave_balances(total, used, pending)`. Pending days were added on submit only on the admin path. HR approval moved pending to used. **Approvals made in the portal did not touch the balance at all.** Defaults were inconsistent: annual 21 in the admin tab and 30 in the portal; emergency 5; exam 5; hajj 15; maternity 70; paternity 3; sick 120. | `LeaveRequestsTab.tsx` l.133, `portal-app.html` l.1923–1933 |
| SLA | None. | — |
| Notifications | In-app notifications to HR for some request types. Email templates existed, but the triggers live in missing files. | `createNotification`, `emailSystem.ts` |
| Documents | None. The attachment went to external storage. | `/api/employee/portal-upload` |
| Edge cases handled | Overlap check. Rejected or cancelled requests excluded from the overlap check. | — |
| Edge cases missed | Balance sufficiency was not checked. HR could approve before the manager did (the admin path `approvalLevel` defaulted to `hr`). The admin `POST /api/leave-requests` took `employeeId` from the request body. Leave during probation was allowed. The sick-leave pay tiers were never modelled. Half-day emergency leave was impossible. Requests spanning two years were not handled. The data came from Zoho and local JSON files as well as the database. | — |

### 1.2 Attendance, lateness penalties and the violation-letter flow

| Item | Old app behaviour | Evidence |
|---|---|---|
| Capture | Two sources. (a) Zoho People attendance synced daily into `zoho_attendance`. (b) Portal check-in with GPS **geofence enforced by blocking** (HTTP 403 outside the zone), a device fingerprint, IP, user agent and a mock-location flag, plus alerts when one device is shared by several employees. | `index.ts` `POST /api/employee/checkin`, `todo.md` §"تطوير نظام الحضور" |
| Corrections | "Permission" (استئذان, a time range) and "attendance edit" (تعديل البصمة) requests. Manager approves, then HR. "HR" was detected with `session.userId.includes('hr')`. **An approved edit did not change the attendance record.** | `index.ts` l.893–1053 |
| Exemptions | An owner or admin could list employees as "exempt from fingerprint". They then counted as present, with a free-text reason and no end date. | `/api/admin/attendance-exemptions`, `Attendance.tsx` |
| Violation detection | Portal: absent means high severity; late means low (≤15 min), medium (16–30) or high (>30). Back office: a "penalty engine" (`penaltyEngine.ts`, **missing**) that, per `todo.md` l.716–765: counted lateness after 09:05, later **09:15**; counted early leave before 17:00 and absence without notice; applied a **progressive ladder: verbal warning → written warning → ¼ day → ½ day → 1 day → 2 days + investigation**; **reset the counter monthly**; capped deductions at **5 days a month**; treated a **missing check-out as a ½-day deduction**; and **waived lateness when 8 hours were completed**. | `todo.md`, `vite.config.ts` `/api/tasks/penalties/*` |
| Penalty log | `turki_penalties_log` held employee, violation date and type, action, due date and status (open, "done", "exempt"). HR could **exempt** a whole penalty or selected days with a reason, and **mark done**. There was no second approver. | `MyTasks.tsx`, `vite.config.ts` l.2626–2720 |
| Violation letter | From the grouped log, HR picked the most severe open penalty and generated a **bilingual warning letter** (Arabic right, English left). It listed the violation type as a checkbox, the violation dates, "the article of the labour law" and the penalty, and had signature blocks. Previewed on screen and exported as **.docx**. | `MyTasks.tsx` l.1131–1146, `generateWarningLetter` in the missing `lib/warningLetter.ts` |
| Notifications | An alert when an employee reaches 3 consecutive attendance violations, a weekly attendance email, and a violation email template. | `todo.md` l.776, 869; `emailSystem.ts generateAttendanceViolationEmail` |
| Payroll link | Manual. The HR officer's checklist says to "send deductions to finance before payroll approval". | `MyTasks.tsx` checklist |
| Missing controls | No written notice and no employee statement before a penalty. No 30-day limitation. No 180-day recidivism window. No appeal. No fines register. No separation between the person who proposes a penalty and the person who decides it. The ladder itself did not match the approved regulation (see §3.3). | — |

### 1.3 Salary and employment letters

| Item | Old app behaviour |
|---|---|
| Steps | (1) Employee requests a letter in two steps: choose the addressee type (bank, embassy, government body, housing programme, general), then the specific bank or embassy from a list with logos, plus notes. (2) Stored in `salary_letter_requests` as `pending`, language `both`. (3) HR manager approves or rejects (`PATCH /api/salary-letters/:id`, any `manager+`). (4) On approval, a **bilingual PDF** is generated client-side from the contract data (`salaryDocuments.ts`, missing) and attached as `documentUrl`. |
| Chain / SLA | HR only. No SLA. |
| Notification | Planned "notify employee on approval or rejection" (`todo.md` l.215, unchecked). |
| Documents | Bilingual salary letter in the company's official template: header, two tables, closing text, signature, footer. |
| Edge cases | The admin route accepted `employeeId` from the body. No verification code or serial number. No template approval. Experience certificates and advance requests were **removed at the user's request** (`todo.md` l.1086–1087). |

### 1.4 Expenses and custody

| Item | Old app behaviour |
|---|---|
| Steps | `expenses(category, amount, receipt_url, status: pending → manager_approved → finance_approved → paid / rejected)`. `custodies(amount, purpose, status: active / partial / settled, settled_amount)`. |
| Chain | Intended "direct manager → finance → executive" (`todo.md` l.358, unchecked). The status enum supports manager then finance. The routes that enforce it (`servicesRoutes.ts`) are **missing**. |
| Edge cases | No duplicate-receipt check. Custody settlement was a number, not a reconciliation against expense claims. No "one open custody per person" rule. |

### 1.5 Tasks and work requests

| Item | Old app behaviour |
|---|---|
| Inter-department work requests | `work_requests(from_dept, to_dept, priority low…urgent, status new → reviewing → in_progress → pending_approval → completed / rejected / cancelled, assignee, due_date, rating 1–5 + comment on delivery)`. |
| HR officer's workspace (MyTasks) | Personal task list; a **weekly plan with recurrence** (daily, weekly, monthly, quarterly, yearly); an attendance log, contracts log and penalties log; an **execution guide** for each HR task (method, sources, output, "alert", e.g. *"do not apply a penalty without a supporting document"*); a **pre-meeting checklist**. |
| Portal tasks | `GET /api/employee/portal-tasks` returns an empty list ("connect later"). |
| Generic workflow | `workflow_requests` for promotion, transfer and HR tickets, via the missing `workflowDb.ts`. |

### 1.6 Onboarding and offboarding

- **Onboarding** was present: `onboarding.json` tasks, a completion percentage, an assigned buddy, templates by department (`todo.md` l.484–486), and a welcome email. The pages (`Onboarding.tsx`, `OnboardingJourney.tsx`) are missing.
- **Offboarding** was **not present** in the snapshot or in the manifest. No resignation flow, no clearance, and end-of-service calculation left unchecked in `todo.md` (l.332, 456).

### 1.7 Surveys and engagement

- `surveys(type: satisfaction / pulse / custom / eNPS, status draft → active → closed, anonymous flag)` with typed questions. `survey_responses` **stored `employee_id` even for "anonymous" surveys**. Invitations went by email.
- The Engagement page also held events with budget tiers, 2026 initiatives, an "engagement hub", recognition and gamification (points and badges), and a suggestion box.

### 1.8 Performance, skills and succession

- `performance_reviews(review_type self / manager / peer / 360, overall_rating, status draft → submitted → acknowledged)` and OKRs with three key results.
- `skills` and `employee_skills(current_level, target_level)`, plus competencies.
- `critical_positions` and `succession_candidates(readiness)`. **But the SkillsMatrix page generates the succession view from job titles with seeded arrays.** Performance, potential, readiness, 9-box position and "committee decision" are fabricated (`SkillsMatrix.tsx` `generateInitialData`, l.137–200).

### 1.9 Contracts and contract expiry

- An expiry list and a contract-expiry email to owner and admin (`/api/contracts/expiring`, `/api/contracts/notify`). A dashboard widget for contracts ending within 100 days. Notifications at 30, 60 and 90 days (`todo.md` l.774). Email colour bands at ≤14, ≤30 and ≤60 days.
- MyTasks contracts log with a "suggested action" and a **renew button that overwrites the start and end dates in place**, with no approval and no new version (`vite.config.ts` `POST /api/tasks/contracts/renew`). `todo.md` l.31 records a bulk "renewal" of 23 expired contracts to one fixed date.

### 1.10 Other flows found

These fall outside the brief but are relevant: overtime request (manager, then HR); "delegation" request (secondment to an external organisation with additional salary; manager, then HR); insurance dependant request (collected the dependant's **national ID number**); personal data update with HR approval; an AI assistant, "Ask Turki", over the regulations; a PDPL consent notice.

---

## 2. Step-by-step comparison with our platform

Legend: ✅ we match or exceed · ◐ partial · ✗ missing · ⊘ we deliberately do not do it

### 2.1 Leave

| Step | Old app | Ours (file → function) | Verdict |
|---|---|---|---|
| Balance source | Manual `leave_balances` with hard-coded defaults | `leave.mjs grantLeaveOpening` (HR opens it with a reason and evidence, as a ledger entry) and `leave-accrual.mjs runAccrualCycle` (accrual, carry-over and expiry by a policy the HR manager accepts) | ✅ Ours is ledger-based and needs no defaults |
| Submit | Any type; attachment required for most | `leave.mjs createLeaveRequest` → `calculate` (year split, calendar range, overlap, sufficient balance, working-day list) | ◐ No attachment rule per type, no per-type rules |
| Day unit | Calendar days | Working days only (`calculate` counts `weekdays` minus `holidays`) | ◐ **Mismatch with regulation Art. 86:** annual leave is 30 *calendar* days. See §3.2 |
| Route | Manager, then HR (HR could skip the manager) | `leave.mjs route`, `requestActions`, `leaveAction`: `pending_manager → pending_hr`; the HR step verifies that the manager who approved is still the manager (`routing_changed`); self-approval blocked | ✅ Stricter |
| Duration-based approver | — | Not supported (always manager, then HR) | ✗ Art. 91.5 needs "manager ≤5 working days, authority above that" for unpaid leave |
| Balance movement | Broken in the portal path | `movement`: reserve, release, debit, refund | ✅ |
| Return / resubmit | — | `leaveAction('resubmit')` | ✅ |
| Cancel after approval | — | `cancel` refunds | ✅ |
| Extension / late return | — | Not supported. Late return shows as `unexplained` in `attendance.mjs dayStates` | ◐ Art. 92 needs an extension request before leave ends |
| Probation block | — | Not checked | ✗ Art. 86.3 |
| Calendar view | Manager calendar page (missing) | `listLeave.calendar_entries` | ✅ |

### 2.2 Attendance, penalties and the violation letter

| Step | Old app | Ours | Verdict |
|---|---|---|---|
| Punch | GPS geofence (blocking), fingerprint, IP | `attendance.mjs punch`: server time only, once per day | ◐ Ours has less surveillance by design. See §4 for an optional evidence flag |
| Working-time rule | Hard-coded 09:05, later 09:15, and 17:00 | `hr-contracts.mjs acceptedPolicy('working_time')` gives workdays, start, end and grace, **accepted by the HR manager**; `attendance-extras.mjs assignShift` for shifts | ✅ |
| Day classification | Present, late, absent, "single punch" | `attendance.mjs dayStates`: present, late, incomplete, unexplained, leave, unpaid absence, off, holiday, mission | ✅ |
| Correction | Two approvals, but the record never changed | `requestCorrection` / `decideCorrection`: the manager **or** HR decides and the record is updated | ✅ Although the old app's two-level chain is stricter on paper, it had no effect |
| Permission (استئذان) | Time-range request | Folded into the catalog service `HR-ATTENDANCE-FIX` (steps `manager → hr`); no time-range record feeds attendance | ◐ |
| Unpaid absence | Deducted automatically | `proposeAbsence` (HR) → `stateAbsence` (employee statement) → `decideAbsence` (a different person; waits 3 days if no statement) | ✅ Close to the regulation's hearing rule |
| Exemptions | Open-ended list | None | ◐ Adopt as a time-bound, approved record (P2) |
| **Violation → penalty** | Automatic ladder (wrong ladder) | **No disciplinary module at all.** No penalty record, no tiers, no fines register. `hr-cases.mjs` `violation_report` is an employee's report *about* wrongdoing, not a disciplinary case | ✗ **Largest gap** (P1) |
| Violation letter | Bilingual .docx | `letters.mjs` supports employee-requested letters only (`requestLetter` is initiated by the subject) | ✗ Needs an HR-initiated notice type with delivery evidence |
| Payroll link | Manual | `payroll-extras.mjs ADJUSTMENT_KINDS` has a generic `deduction`; `payroll.mjs` sums it as `other_deductions` | ◐ No "fine" kind, no cap, no fines register (Art. 116, 123) |

### 2.3 Salary and employment letters

| Step | Old app | Ours | Verdict |
|---|---|---|---|
| Request | Addressee type, then bank or embassy list | `letters.mjs requestLetter(type_code, addressee, purpose)`; catalog `HR-SALARY-CERT`, `HR-EXPERIENCE-CERT`, `HR-LETTER` (confidential, `hr` step) | ◐ Free-text addressee only |
| Template | Hard-coded in the client | `saveTemplate` → `approveTemplate` (the writer cannot approve), versioned, placeholders limited to `PLACEHOLDERS` | ✅ |
| Prepare / issue | One step | `letterAction`: `prepare` (the person who prepares cannot issue), `issue` with serial, reference and **verification code** (`verifyLetter`); salary derived from the active contract at issue | ✅ Stronger |
| Language | Arabic and English | One body per template | ◐ No bilingual layout |
| Fields | Name, ID, nationality, basic, housing, transport, total, hire date | `employee_name`, `job_title`, `hire_date`, `salary_total`, `addressee` | ◐ Banks and embassies often ask for the breakdown and nationality. Any addition needs HR-manager approval of the placeholder |
| Notification | Planned | In-app via the request record | ✅ |

### 2.4 Expenses and custody

| Step | Old app | Ours (`expenses.mjs`) | Verdict |
|---|---|---|---|
| Claim | Amount, category, receipt | `submitClaim`: duplicate receipt blocked (date, amount and normalised reference), no future dates, optional project | ✅ |
| Chain | Manager, then finance (routes missing) | `claimAction`: `manager_approve → finance_approve → record_reimbursement`; the claimant never decides | ✅ |
| Custody | Amount and settled amount | `requestCustody` (one open custody per person) → `approve_custody` → `issue_custody` → claims settle it → `close_custody` requires the returned amount to equal the open balance exactly | ✅ Much stronger |
| Clearance | — | `lifecycle.mjs deriveClearance` pulls open custody, assets, equipment, advances, tasks and delegations | ✅ |
| Regulation link | — | The penalty tables punish **negligence with custody items** and **late handover of collected cash** (Org. table row 9; Behaviour table row 7) | ✗ No link. Belongs to the disciplinary module |
| Mission (انتداب) allowance | "Delegation" request (misnamed) | `attendance-extras.mjs requestMission` records dates and destination for attendance; category `travel` in expenses | ◐ Regulation Art. 62–65: a mission decision with task and dates, a daily allowance by grade, a ¼ rule, tickets. None of this is modelled |

### 2.5 Tasks and work requests

| Step | Old app | Ours | Verdict |
|---|---|---|---|
| Request between departments | `work_requests` from/to department | Service catalog: `workflow.mjs createRequest / transition`; `routing.mjs transferRequest`, `assignRequestTask`, `settleRequestTask` | ✅ |
| SLA | Due date only | `routing.mjs targetDays` and `work-calendar.mjs clockFor` (working days, Fri/Sat off, approved holidays, **paused while returned**); `service-catalog.mjs defaultTargetDays` (HR = 3) | ✅ |
| Escalation | — | `workflow.mjs escalateApproval` (once, after 24 h), `executiveFor`, `approvalFallback` | ✅ |
| Closure and rating | Status plus 1–5 rating | `request-closure.mjs closeWithEvidence`, `requestReopen`; `service-feedback.mjs recordFeedback`; `request-timeline.mjs` dwell time | ✅ |
| HR officer's recurring plan and execution guide | MyTasks weekly plan, guide and checklist | `compliance.mjs` (recurring obligations with evidence); `service-cards.mjs` (procedure card per service, approved by the named owner); `inbox.mjs` | ◐ No HR-specific recurring template set |

### 2.6 Onboarding and offboarding

| Step | Old app | Ours | Verdict |
|---|---|---|---|
| Onboarding | Task list, percentage, buddy | `lifecycle.mjs openBundle(kind='onboarding')` with parallel steps across departments, each with owner, duration and acceptance criterion | ✅ |
| Resignation | — | Catalog `HR-RESIGNATION` (`manager → hr`) | ◐ No 30-day deemed acceptance and no 60-day deferral (Art. 34); does not open the offboarding bundle (WORKFLOW-AUDIT #13); no block while under investigation |
| Clearance | — | `deriveClearance`, `clearItem`, `clearanceBlockers` | ✅ |
| Settlement | — | `payroll-extras.mjs prepareSettlement / computeSettlement` using the HR-manager-accepted `end_of_service` policy (tiers configurable) | ◐ Service days = contract span. **Unpaid leave above 20 days is not excluded** (Art. 91.3). No 7- or 14-day payment deadline (Art. 50.2) |

### 2.7 Surveys and engagement

| Step | Old app | Ours (`engagement.mjs`) | Verdict |
|---|---|---|---|
| Anonymity | Flag only; employee ID stored | Company-level results only; no department slicing; minimum respondents ≥ `MIN_RESPONDENTS_FLOOR` (5) | ✅ |
| Cycle control | Draft, active, closed | `createCycle → approveCycle` (another person) `→ closeCycle` | ✅ |
| Recognition | Points and badges | `sendRecognition`, no points or leaderboard (`RECOGNITION_NOTE`) | ⊘ Deliberate |
| Announcements | Email | In-app with acknowledgement (`acknowledgeAnnouncement`) | ✅ |
| Events and budget tiers | Present | Not present | Out of scope for HR operations |

### 2.8 Performance, skills and succession

| Step | Old app | Ours | Verdict |
|---|---|---|---|
| Review cycle | Self, manager, peer, 360 → acknowledged | `talent.mjs createCycle` (scale 3–10), `reviewAction`: self → manager → calibration → release → acknowledge or **appeal (14 days)** → decision by someone else | ✅ Stronger. Appeal window differs from Art. 126 (see §3.5) |
| 360 / 1:1s | Types only | `feedback.mjs` (upward-anonymity floor, 1:1 privacy) | ✅ |
| Skills matrix | Current and target level | `career-profile.mjs` self-declared skills; qualifications verified by HR | ◐ No target level and no manager assessment |
| Succession | **Fabricated seeded data** | `talent.mjs` succession plans with readiness, managed by `hr.succession.manage`; holders and candidates cannot see their own plan | ✅ |
| Raise link | "Link OKRs to bonuses" | `compensation.mjs`: no formula from score to raise (by design) | ✅ Regulation only sets eligibility: "average or above after one year" |

### 2.9 Contracts and expiry

| Step | Old app | Ours | Verdict |
|---|---|---|---|
| Record | Contract log (dates) | `hr-contracts.mjs`: draft → pending → active, a different approver, versioned `amend_contract`, pay lines limited by the accepted `pay_components` policy, probation ≤180 days | ✅ |
| Renewal | Overwrite dates | Amendment creates a new version through approval | ✅ |
| Alerts | 30, 60, 90 and 100 days, by email | `listContracts` alerts: probation end ≤14 days, fixed-term end ≤60 days (**hard-coded**); `expiry.mjs` for documents with windows the process owner enters | ◐ Make the contract alert windows owner-set like `expiry.mjs` |
| Commercial contracts | — | `contracts-register.mjs` (clients and vendors, not staff) | n/a |

**Gaps in the other direction** (what we have that the old app lacked): segregation of duties everywhere; beneficiary exclusion; delegation; confidential services; versioned requests with audit hash; working-day SLAs with pause; clearance derivation; verified letters; ledger-based leave; accepted-policy gating; privacy floors. The old app's real strengths were **breadth of employee self-service in one portal**, **coverage of daily HR officer routines**, and **attempting to encode the disciplinary regulation at all**.

---

## 3. Work regulations: rule checklist

Columns: **Encoded?** ✅ enforced · ◐ configurable, or partly enforced · ✗ absent. **Where** = our file and function. **Match** = whether the current behaviour matches the regulation. **HR-mgr** = needs HR-manager acceptance before real use (✱ = all of them; ✱✱ = also needs legal or finance review because it moves money or ends employment).

Article numbers are the regulation's own. Where the text uses "authority holder" (صاحب الصلاحية), our equivalent is a role or capability per the approved authority matrix (مصفوفة الصلاحيات), which is **not in the snapshot**. It is needed.

### 3.1 Working hours and attendance

| # | Rule (regulation) | Art. | Encoded? | Where | Match | HR-mgr |
|---|---|---|---|---|---|---|
| W1 | 5 working days a week; weekly rest Friday and Saturday, fully paid; rest day cannot be paid out in cash | 73.1 | ✅ | `work-calendar.mjs WEEKEND`; `working_time.workdays` | Yes | ✱ |
| W2 | 8 hours a day | 73.2 | ◐ | `working_time.start/end`; contract `weekly_hours ≤48` | Yes if configured | ✱ |
| W3 | Ramadan: 6 hours a day, at most 36 actual hours a week, for Muslim workers | 73.2, 74.2 | ✗ | Shifts could approximate (`assignShift`), but there is no religion-scoped rule | No | ✱ |
| W4 | Prayer time is not counted as working time | 74.4 | ✗ | — | n/a | ✱ |
| W5 | At most 5 continuous hours without a break of at least 30 minutes; at most 11 hours on site a day | 74.7 | ✗ | — | n/a | ✱ |
| W6 | No leaving early without the manager's approval; log time out, place and expected return | 74.8 | ◐ | `HR-ATTENDANCE-FIX` (permission) | Partly: no time-range record | ✱ |
| W7 | Attendance must be proved by the approved method, chosen by the authority holder | 74.9, 79 | ✅ | `punch` (server time) | Yes | ✱ |
| W8 | Staying after hours needs manager approval | 74.10 | ✗ | — | n/a | ✱ |
| W9 | Employee informs the manager of lateness or absence the same day; manager reports absences | 75 | ◐ | `stateAbsence` (statement), `dayStates` | Partly | ✱ |
| W10 | Overtime needs a prior written assignment stating hours and days, approval by the authority holder, an approved budget and written HR approval; it must not stem from the employee's own negligence | 76.1, 77.2–3, 77.7 | ◐ | `attendance-extras.mjs requestOvertime` is **after the fact** (up to 30 days back); catalog `HR-OVERTIME` | **No:** there is no prior-assignment path | ✱ |
| W11 | Overtime pay = hours × actual hourly wage + 50% of basic hourly wage; paid at month end | 76.2, 77.4 | ◐ | `overtimeToPayroll` proposes an adjustment and the amount is keyed in manually | Not computed. The formula is in the regulation, so it can become an accepted policy parameter | ✱✱ |
| W12 | Overtime caps: 3 h on a working day, 8 h on a holiday, 20 h a week; yearly pay cap = 6 months' basic | 77.5, 77.8 | ✗ | `requestOvertime` allows 15–720 minutes a day | **No** | ✱ |
| W13 | Paid compensatory leave instead of overtime pay, with the employee's consent; cash if service ends first | 77.6 | ✗ | — | n/a | ✱ |
| W14 | Overtime pay cannot be combined with a mission assignment | 77.9 | ✗ | Missions and overtime are not cross-checked | No | ✱ |
| W15 | Public holidays: Eid al-Fitr 4 days (from the day after 29 Ramadan, Umm al-Qura), Eid al-Adha 4 days (from Arafat), National Day 1, Founding Day (22 Feb) 1; compensate when a holiday falls on weekly rest, except Eid overlapping National or Founding Day; HR issues a yearly circular | 81, 84.4 | ◐ | `attendance-extras.mjs proposeHoliday/decideHoliday` → `public_holidays` | Circular ✅; compensation rule ✗ | ✱ |
| W16 | Eid leave boundaries shift to the adjacent weekend | 84.1–2 | ✗ | — | n/a | ✱ |
| W17 | The CEO may grant up to 5 extra days a year, not counted against leave | 84.3 | ✗ | — | n/a | ✱ |

### 3.2 Leave entitlements

| # | Rule | Art. | Encoded? | Where | Match | HR-mgr |
|---|---|---|---|---|---|---|
| L1 | Annual leave: **30 calendar days** a year, fully paid, counted from start date | 80, 86.1–2 | ◐ | `grantLeaveOpening`, `leave-accrual.mjs` | **Unit mismatch:** `calculate` deducts working days. Either grant in working-day equivalents or add a per-type calendar-day unit | ✱ |
| L2 | Accrual suspended during unpaid leave beyond 20 days | 86.2b, 91.6 | ✗ | — | No | ✱ |
| L3 | No annual leave during probation | 86.3 | ✗ | `leave.mjs calculate` | No | ✱ |
| L4 | Take leave in its year; defer with approval; employer deferral ≤90 days, beyond that only with the employee's written consent, and never past the end of the following year | 86.4 | ◐ | `leave-accrual.mjs` carry-over and expiry runs | Configurable | ✱ |
| L5 | Splitting: ≤ balance, **≤6 splits a year**, **≤50 working days taken a year**; the authority holder may make exceptions | 86.5 | ✗ | — | No | ✱ |
| L6 | No cash in lieu except at end of service, on the last actual wage | 86.6 | ◐ | `leave-accrual.mjs payoutEligibleDays`, `computeSettlement` (daily = monthly/30) | Yes if the policy is set | ✱✱ |
| L7 | Emergency leave: ≤3 working days a year, paid, after notifying the manager; can be taken in half days (4 h) | 87 | ✗ | Integer days only | No | ✱ |
| L8 | Sick leave (medical report from an approved centre): first 30 days full pay, next 60 at 75%, next 30 unpaid, within a year starting from the first sick leave; afterwards referred to a committee; Eid, National Day and Founding Day not counted; foreign reports must be authenticated | 83, 88 | ✗ | No pay tiers; payroll does not read sick days | No | ✱✱ |
| L9 | Work injury: report immediately; GOSI occupational-hazard rules apply | 88.4, 99 | ✗ | — | n/a | ✱ |
| L10 | Kidney dialysis days: full pay | 88.6, 94.2 | ✗ | — | n/a | ✱ |
| L11 | Exam leave: paid for actual exam days if the company approved enrolment and the year is not repeated; unpaid if repeated; otherwise taken from annual leave; apply ≥15 days before; proof of attendance | 89 | ✗ | Old app: flat 5 days (wrong) | No | ✱ |
| L12 | Patient companion: ≤15 days full pay; the excess comes from annual or emergency leave, then unpaid; medical documents; approval by the authority holder | 90 | ✗ | — | n/a | ✱ |
| L13 | Unpaid leave: only with no annual or emergency balance and ≥1 year of service; >20 days deducted from end-of-service service; ≤6 months (exceptions up to 18 in total); **manager approves ≤5 working days, the authority holder approves more**; >6 months in a year removes the annual raise | 91 | ✗ | Leave route is fixed | No | ✱✱ |
| L14 | Late return from leave: request an extension before leave ends with documents; otherwise treated as absent and disciplined | 92 | ◐ | `dayStates` shows `unexplained` | Partly | ✱ |
| L15 | Every leave action documented and signed, on paper or electronically | 93 | ✅ | `leave_decisions`, `leave_request_versions`, `audit` | Yes | — |
| L16 | Marriage 5 days; birth of a child 3; death of spouse, parent or descendant 5; death of a sibling 3; iddah 4 months 10 days (Muslim) or 15 days (non-Muslim); supporting documents may be requested | 82, 94.1 | ✗ | Old app: bereavement 5 flat, paternity 3 | No | ✱ |
| L17 | Maternity: **12 weeks** fully paid (6 compulsory after birth; up to 4 weeks before); shortfall from a late birth is unpaid; optional +1 month unpaid; +1 month paid for a sick or disabled newborn (+1 unpaid) | 105 (replaces 101) | ✗ | Old app: 70 days (**wrong**; Art. 101 was superseded) | No | ✱ |
| L18 | Nursing breaks for 24 months, counted as working time, no pay cut | 102 | ✗ | — | n/a | ✱ |
| L19 | No dismissal or dismissal warning during pregnancy or maternity leave (or related illness up to 180 days) | 103 | ✗ | Should block disciplinary dismissal steps | n/a | ✱✱ |
| L20 | Leave may be joined to Eid holidays, before or after | 85 | ✅ | Implicit | Yes | — |
| L21 | Hajj leave | — | n/a | Old app offered 15 days. **Not in the company regulation**; confirm the source before encoding | — | ✱ |

### 3.3 Lateness and absence penalty tables

Penalties escalate by occurrence: 1st → 2nd → 3rd → 4th. **Recidivism window 180 days** (Art. 114): after 180 days, the same violation counts as a first again. Percentages are of the **daily wage** (Art. 111.2 speaks of "a part of the daily wage"; confirm with the HR manager). "Day" means one day's wage. Rows 1–7 also deduct the late minutes or hours; rows 8–9 deduct the time missed; rows 11–14 deduct the absent days' wage.

| # | Violation | 1st | 2nd | 3rd | 4th |
|---|---|---|---|---|---|
| T1 | Late ≤15 min, no disruption to others | Written warning | 5% | 10% | 20% |
| T2 | Late ≤15 min, disrupting others | Written warning | 15% | 25% | 50% |
| T3 | Late 15–30 min, no disruption | 10% | 15% | 25% | 50% |
| T4 | Late 15–30 min, disrupting | 25% | 50% | 75% | 1 day |
| T5 | Late 30–60 min, no disruption | 25% | 50% | 75% | 1 day |
| T6 | Late 30–60 min, disrupting | 30% | 50% | 1 day | 2 days |
| T7 | Late >60 min (either case) | Written warning | 1 day | 2 days | 3 days |
| T8 | Leaving early ≤15 min without permission | Written warning | 10% | 25% | 1 day |
| T9 | Leaving early >15 min without permission | 10% | 25% | 50% | 1 day |
| T10 | Staying or returning after hours without permission | Written warning | 10% | 25% | 1 day |
| T11 | Absence of 1 day without written permission or accepted excuse (contract year) | 2 days | 3 days | 4 days | No promotion or raise, once |
| T12 | Continuous absence of 2–6 days | 2 days | 3 days | 4 days | No promotion or raise, once |
| T13 | Continuous absence of 7–10 days | 4 days | 5 days | No promotion or raise, once | Dismissal with end-of-service award if total absence ≤30 days |
| T14 | Continuous absence of 11–14 days | 5 days | No promotion or raise, once, plus a dismissal warning (labour-law Art. 80) | Dismissal under labour-law Art. 80 | — |
| T15 | More than 15 continuous days without legitimate cause | Dismissal without award, notice or compensation, **preceded by a written warning after 10 days' absence** | | | |
| T16 | Intermittent absence totalling more than 30 days in a contract year | Same, **with the warning after 20 days** | | | |

**Old app vs. this table (reasons to drop the old engine):** a verbal warning is not a sanction under Art. 111; the monthly counter reset contradicts the 180-day window; "missing check-out = ½ day" and "8 hours completed = no penalty" appear nowhere in the table; the ladder of ¼ day, ½ day, 1 day, 2 days does not match any row; the 09:05 and 09:15 thresholds do not exist in the regulation (the start time must come from the accepted `working_time` policy). **The AI assistant's own prompt in `vite.config.ts` (around l.2850) misquotes T1, T2, T3, T6 and T9, and states maternity leave as 10 weeks.**

**Other tables (summary; same four-occurrence structure).** Relevance to our modules is noted.

- *Work organisation (18 rows):* being away from the assigned place; private visitors; private use of company equipment; interfering in others' work; wrong entry or exit; neglecting machines; tools not returned to place; damaging notices; **negligence with custody items: 2 → 3 → 5 days → dismissal with award** (link to `equipment.mjs`, `assets.mjs`); eating or sleeping at work; loitering; **tampering with attendance records: 1 day → 2 days → no promotion or raise → dismissal with award** (link to `attendance.mjs`, which is how the old app's "shared device" alerts should have ended up: as an evidence-based case, not an automatic flag); disobeying ordinary orders; inciting; smoking; negligence harming safety.
- *Conduct (16 rows):* quarrels; malingering; refusing a medical examination; health rules; graffiti; refusing exit inspection; **not handing over collected cash on time: 2 → 3 → 5 days → dismissal with award** (link to `expenses.mjs` custody and `receivables`); refusing protective equipment; seclusion; indecency; verbal or electronic abuse of colleagues; physical assault (dismissal under Art. 80); assault on the employer or a manager (dismissal under Art. 80); malicious complaint; ignoring a summons from the investigation committee; dress code.

| # | Rule | Encoded? | Where | Match | HR-mgr |
|---|---|---|---|---|---|
| P1 | All three tables as versioned data with article references | ✗ | — | — | ✱✱ |
| P2 | Tier chosen from prior same-violation count within 180 days | ✗ | — | — | ✱ |
| P3 | Lateness bands measured from the accepted start time (no grace unless the policy sets one) | ◐ | `dayStates` has `late` with `grace_minutes` | Band size not recorded | ✱ |
| P4 | "Disrupting others" is a human judgement, never inferred | ✗ | — | — | ✱ |

### 3.4 Disciplinary procedure

| # | Rule | Art. | Encoded? | Where | Match | HR-mgr |
|---|---|---|---|---|---|---|
| D1 | Sanctions allowed: written warning; fine (part of a day up to 5 days' wage a month); suspension without pay ≤5 days a month; no promotion or raise for up to 1 year; dismissal with award; dismissal without award (labour-law Art. 80). Proportionate to the violation | 111 | ✗ | — | — | ✱✱ |
| D2 | Imposed by the authority holder or a delegate, who may substitute a lighter sanction | 113 | ✗ | Capability model exists (`access.mjs holds`) | — | ✱ |
| D3 | Several violations from one act: impose only the heaviest | 115 | ✗ | — | — | ✱ |
| D4 | One sanction per violation; fine ≤5 days' wage per violation; ≤5 days' wage deducted a month for fines | 116 | ✗ | `payroll-extras.mjs proposeAdjustment('deduction')` has no cap | No | ✱✱ |
| D5 | Any sanction above 1 day's fine requires written notice of the charge, a hearing and a written record in the file; simple cases (warning or ≤1 day) may be heard orally but must be recorded | 117, 126.1 | ✗ | The pattern exists in `attendance.mjs` absence (statement, then a second decider) | — | ✱✱ |
| D6 | No sanction for off-premises conduct unless it is work-related | 118 | ✗ | — | — | ✱ |
| D7 | No discipline if 30 days pass after the company learns of it without starting an investigation; no sanction more than 30 days after the violation is proved | 119, 120 | ✗ | — | — | ✱✱ |
| D8 | Written notice of the sanction, its amount, and the sanction for a repeat; if the employee refuses or is absent, registered mail to the address on file or the personal email in the contract, with full legal effect | 121 | ✗ | In-app notifications only | No | ✱✱ |
| D9 | A penalty sheet per employee (violation, date, sanction) kept in the service file | 122 | ✗ | — | — | ✱ |
| D10 | Fines recorded in a special register and spent for workers' benefit through the labour committee, or with ministry approval if there is none; **never company revenue** | 123 | ✗ | `payroll.mjs` treats deductions as ordinary | No | ✱✱ (finance) |
| D11 | Managers detect and report violations; HR advises, verifies and applies | 124 | ◐ | Roles exist | — | ✱ |
| D12 | Grievance: in writing within 30 days (excluding official holidays) of notification; decision within 15 days; then labour court within 30 days of rejection or silence; no retaliation. (Art. 125 said 3 and 5 working days; Art. 126 states that it replaces it) | 126.2 | ◐ | `hr-cases.mjs` grievance + `setCaseTarget`; `HR-GRIEVANCE` | Target configurable; no 30-day intake window or "deemed rejected" notice | ✱ |
| D13 | Harassment complaint: filed within 5 working days; committee investigates and recommends within 5 working days; may separate the parties | 107–110 | ◐ | `hr-cases.mjs` confidential case | No committee or 5-day target | ✱ |
| D14 | Resignation not accepted while the employee is under investigation or suspended | 37.5 | ✗ | `HR-RESIGNATION` | No | ✱ |

### 3.5 Other rules that touch our workflows

| # | Rule | Art. | Encoded? | Where | Match | HR-mgr |
|---|---|---|---|---|---|---|
| O1 | Probation ≤180 days; termination during probation without award | 23, 27 | ✅ | `hr-contracts.mjs` `probation_days 0–180` | Yes | ✱ |
| O2 | Contract may be cancelled if the employee does not start within 7 working days of signing | 19 | ✗ | — | — | ✱ |
| O3 | Resignation: dated letter to the manager, copy to HR; **deemed accepted after 30 days** without a reply; deferral up to 60 days for business need; the authority holder sets the last day, including notice | 34, 37 | ◐ | `HR-RESIGNATION` | No clocks | ✱✱ |
| O4 | End-of-service award: half a month a year for the first 5 years, a month a year after; resignation factors (<2 y none, 2–5 y ⅓, 5–10 y ⅔, >10 y full); last actual wage; pro-rata fractions | 36 | ◐ | `hr-contracts.mjs` `end_of_service` params; `computeSettlement` | Matches if configured this way | ✱✱ |
| O5 | Month = 30 days for money calculations | 50.1 | ✅ | `payroll_cycle.day_basis='thirty'`; settlement daily = /30 | Yes if set | ✱ |
| O6 | Final dues within **7 days** (company ends the contract) or **14 days** (employee ends it) | 50.2 | ✗ | — | No SLA | ✱✱ |
| O7 | Money amounts **rounded up to the nearest riyal** | 50.5 | ✗ | `halfUp` to the halala | **No** | ✱✱ (finance) |
| O8 | Deductions without consent only for: employer loans (**≤10% of wage**), GOSI, savings fund, housing scheme, **fines and damage**, court debt (**≤25%**) | 51 | ✗ | `proposeAdvance` has no percentage cap | No | ✱✱ |
| O9 | Emergency advance by the CEO, recovered monthly | 71 | ◐ | `HR-SALARY-ADVANCE`, `proposeAdvance/decideAdvance` | Approver is a capability, not "CEO" | ✱ |
| O10 | Performance report at least yearly: competence, behaviour, attendance; **5-level scale**; prepared by the direct supervisor, approved by the authority holder, copy to the employee, appeal under the grievance rules | 52–55 | ◐ | `talent.mjs` (scale configurable; appeal **14 days**) | Appeal window ≠ 30 days in Art. 126 | ✱ |
| O11 | Annual raise eligibility: at least "average" rating after 1 year | 56 | ✗ | `compensation.mjs` has no eligibility gate | No | ✱ |
| O12 | Housing allowance 25% of basic (company rule); transport allowance paid during paid leave, not when company transport is provided; relocation = 1 month's basic | 67–69 | ◐ | Pay components are free amounts | Not validated | ✱✱ |
| O13 | Mission (انتداب): decision states the task, duration and dates; extension only after reviewing progress; daily allowance by grade (a table in the regulation); cut to ¼ when housing and transport are provided; tickets | 62–65 | ◐ | `requestMission` (dates, destination) | No allowance | ✱✱ |
| O14 | HR keeps records confidential; salary data restricted to HR and Finance | 29, 49 | ✅ | `hr-contracts.mjs seesPay`; confidential services | Yes | — |

---

## 4. Recommendations

### 4.1 Adopt (and how each improves our design)

1. **Encode the disciplinary regulation, as the old app tried to, but correctly.** The old app proved there is daily demand: penalty logs, grouped views, warning letters. Our platform has the right parts (the statement-then-second-decider pattern in `attendance.mjs`, capabilities, the audit trail, a payroll deduction kind) but no disciplinary case. Build it as data, from an HR-manager-accepted policy, and let it propose, never apply.
2. **The violation or warning letter as a governed document.** Take the old bilingual layout (violation checkbox, dates, article reference, sanction, signatures) into `letters.mjs` as an **HR-initiated** letter type issued from a disciplinary decision. Add delivery evidence (in person, registered mail, contract email) to satisfy Art. 121.
3. **Per-type leave rules**, from the regulation, not the old app's defaults: unit (calendar or working day), attachment requirement, half-day flag, probation block, sick-leave pay tiers feeding payroll, duration-based approver for unpaid leave. This fixes the Art. 86 unit mismatch in `leave.mjs calculate`.
4. **Addressee types for letters** (bank, embassy, government body, housing programme, general) as a controlled list with an optional named entity, and a bilingual template option. The list is data the owner maintains; no bundled logos from third parties.
5. **HR officer operating rhythm.** The old weekly plan, execution guide and pre-meeting checklist map onto `compliance.mjs` recurring items and `service-cards.mjs`. Seed *names only*, with no deadlines (consistent with `compliance.mjs` line 10).
6. **Attendance exemptions**, rebuilt as approved, time-bound records with reason, evidence and an approver other than the proposer. They should show up in `dayStates` as their own state, not as "present".
7. **Contract alert windows set by the owner.** Keep the old app's idea of staged alerts (30, 60, 90 days) but make the windows data, as `expiry.mjs` already does, instead of the 14 and 60 hard-coded in `hr-contracts.mjs listContracts`.

### 4.2 Drop (and why)

| Old process or feature | Why drop |
|---|---|
| Zoho sync as the attendance and leave source; Zoho-driven penalty sync | Owner rule: the platform is the only system. It also mixed three sources (Zoho, JSON files, database) into one view |
| The automatic penalty engine (verbal warning, ¼ and ½ day ladder, monthly reset, 09:15 threshold, missing check-out = ½ day, 8-hour waiver, clerk-only "exempt" and "mark done") | Contradicts Art. 111, 114, 116, 117 and 119–121; no hearing, no second decider, no appeal. Automatic penalties also contradict our HR-03 principle (`attendance.mjs` `rule`) |
| AI assistant grounded on a hand-written rule summary | It misquotes the regulation (T1, T2, T3, T6, T9, maternity). Answers must cite the accepted, versioned rule set |
| Configurable approval chains editable by any logged-in user; roles inferred from job-title text; HR able to act on the manager step for everyone; approval endpoints without role checks | Control failures. Our `workflow.mjs planApprovals`, `authorizedStep` and `delegationFor` already do this properly |
| Contract "renew" that overwrites dates; bulk renewal to one fixed date | Destroys history and bypasses approval. Ours versions through `amend_contract` |
| Seeded succession and 9-box data | Fabricated personnel judgements; violates the owner's no-synthetic-as-real rule |
| "Anonymous" surveys that store the employee ID | False promise of anonymity. Ours enforces it structurally |
| Blocking geofence, device fingerprinting, mock-location heuristics, shared-device alerts | Disproportionate for a 30–60 person office; personal-data risk under PDPL; blocks legitimate missions and remote work. If ever wanted: a non-blocking location *evidence* flag, with a privacy notice and HR-manager acceptance (P3) |
| Dependant national-ID capture | `benefits.mjs` deliberately stores only relation and date of birth; enrolment happens with the insurer |
| Email-first notifications carrying personal data; birthday and achievement emails; gamification points | Our design is in-platform notifications (see `engagement.mjs ANNOUNCEMENT_NOTE`); points are rejected in `RECOGNITION_NOTE` |
| Resignation-risk AI predictions (`todo.md` l.792) | `workforce.mjs` explicitly refuses individual flight-risk scoring |
| A predictable default-password pattern for employees | Security defect. Not reproduced here |

### 4.3 Prioritised backlog

All items start as **proposed**. "Accepted" requires the HR manager (and finance where marked).

#### P1: needed before any real HR use of attendance, leave or payroll

| ID | Item | Acceptance criteria |
|---|---|---|
| **P1-1** | **Disciplinary schedule as an accepted policy.** New policy kind `disciplinary_schedule` in `hr-contracts.mjs POLICY_KINDS` (or its own module). Rows: violation code, table, article, four tiers, "plus deduct time" flag, the 180-day window. | (a) Cannot activate until someone other than the preparer, holding `hr.policy.accept`, accepts it. (b) Each row stores its article number and source page. (c) Versioned; a case uses the version in force on the violation date. (d) Test: reproduces rows T1–T16 exactly as signed. |
| **P1-2** | **Disciplinary case flow** (`disciplinary.mjs`): record (from an attendance day or a manager report, with evidence) → proposed tier (count of the same code in the prior 180 days) → **written notice** → **employee statement** (wait period set by policy) → **decision by the authority holder** (not the proposer, not the subject; may lighten) → notification with a delivery-method record → **appeal** window → payroll deduction. | (a) No sanction above 1 day's fine without a notice and statement on record (D5). (b) Rejects a decision more than 30 days after knowledge without investigation, or more than 30 days after proof (D7). (c) One sanction per violation; heaviest wins for one act (D3, D4). (d) The fine cannot exceed 5 days' wage per violation, and the sum of fine deductions in a payroll month cannot exceed 5 days' wage (D4). (e) Blocks dismissal-type decisions during pregnancy or maternity leave (L19). (f) Every step audited; the subject sees their own penalty sheet (D9). (g) Never created automatically from attendance: the attendance screen offers "open a case" only. |
| **P1-3** | **Fines kind and fines register.** Add a `fine` adjustment kind in `payroll-extras.mjs` linked to a decided case; the payroll run posts fines to a fines register, not income. | (a) A `fine` needs a decided case ID. (b) Monthly cap check (D4). (c) Register report per month; finance confirms the account treatment (D10). |
| **P1-4** | **HR-initiated notice letters.** In `letters.mjs`: a letter type with `initiator='hr'`, issued from a case decision, bilingual template, placeholders (violation, dates, article, sanction, repeat sanction), delivery evidence. | (a) Template approved by someone other than its writer (as today). (b) Issue requires a decided case. (c) Records the delivery method and date; registered-mail or email reference required when "refused/absent" (D8). (d) Carries a verification code like other letters. |
| **P1-5** | **Per-type leave rules** (`leave_type_rules`, an accepted policy): unit (calendar or working days), entitlement source article, attachment required, half-day allowed, blocked during probation, pay tiers (sick), max per event, approver by duration. | (a) Annual leave deducts calendar days when the policy says so (Art. 86); tests for a 30-calendar-day balance. (b) Emergency leave accepts 0.5 days, total ≤3 working days a year. (c) Sick leave passes tier days (100%, 75%, 0%) to payroll as unpaid or part-paid lines. (d) Unpaid leave >5 working days routes to the authority holder (L13). (e) Probation blocks annual leave (L3). (f) Maternity is 84 days (L17). Nothing active until accepted. |
| **P1-6** | **Overtime conformance.** Prior-assignment path (manager assigns → authority approves → employee works → hours confirmed), caps from policy (3 h a working day, 8 h a holiday, 20 h a week, yearly cap), rate formula parameters accepted by the HR manager, optional compensatory leave, no overlap with an approved mission. | (a) `requestOvertime` rejects hours above the caps. (b) After-the-fact requests are marked as exceptions, needing the authority holder. (c) The computed amount is shown for the payroll preparer to confirm; the formula is taken from the accepted policy, not the code. (d) Same-day mission and overtime are rejected (W14). |

#### P2: next, to close regulation gaps in adjacent flows

| ID | Item | Acceptance criteria |
|---|---|---|
| P2-1 | **Resignation clocks** on `HR-RESIGNATION` | 30-day deemed acceptance shown on the request; deferral ≤60 days with reason; blocked while a disciplinary case is open (D14); on acceptance, opens a `lifecycle` offboarding bundle (closes WORKFLOW-AUDIT #13). |
| P2-2 | **Settlement conformance** | Unpaid leave above 20 days excluded from service days (Art. 91.3); SLA of 7 or 14 days from end date to payment (Art. 50.2); rounding rule decided by finance and the HR manager (Art. 50.5). |
| P2-3 | **Deduction caps** | Advance installment ≤10% of wage (Art. 51.1), court-order deductions ≤25%, fines ≤5 days a month. `payroll.mjs` pre-run check flags any breach. |
| P2-4 | **Ramadan and break rules** in the `working_time` policy | Date-ranged Ramadan hours (6 h a day, 36 h a week) applied to the eligible group; `dayStates` uses them; prayer-time and break rules documented as policy text. |
| P2-5 | **Performance appeal alignment** | The appeal window and decision target in `talent.mjs` come from the accepted policy (default proposal: 30 and 15 days per Art. 126, excluding holidays), or the HR manager records why they differ. A 5-level scale is proposed as the default. |
| P2-6 | **Mission decision and allowance** | `requestMission` gains a task statement, an extension-with-review step, and an allowance computed from a grade table the HR manager enters from the regulation, with the ¼ rule; links to expenses for tickets. |
| P2-7 | **Attendance exemptions and permissions** | Exemption record (reason, from/to, approver ≠ proposer) shown as its own day state; a time-range "permission" record from `HR-ATTENDANCE-FIX` feeds `dayStates` so an approved early leave is not counted as T8 or T9. |
| P2-8 | **Holiday rules** | Weekly-rest compensation (except the Eid/national overlap), Eid boundary shift, sick leave excluding holidays, CEO extra days (≤5, not counted). |
| P2-9 | **Letter addressee types and bilingual templates** | Controlled addressee list; bilingual template option; extra placeholders (nationality, pay breakdown) only after the HR manager approves each one and its source. |
| P2-10 | **Owner-set contract alert windows** | Replace the hard-coded 14 and 60 days in `hr-contracts.mjs listContracts` with windows stored like `expiry.mjs watchSettings`; staged alerts. |

#### P3: useful, lower risk

| ID | Item | Acceptance criteria |
|---|---|---|
| P3-1 | HR operating-rhythm templates in `compliance.mjs` | Names seeded without dates; the owner adds cadence and evidence. |
| P3-2 | Skills matrix with target levels | Manager-assessed level plus target per skill; no seeded or synthetic values; visible to the employee, the manager and HR only. |
| P3-3 | Optional location evidence on punch | Non-blocking flag; privacy notice; HR-manager acceptance; off by default; missions and remote days exempt. |
| P3-4 | Assistant grounded on accepted rules | Answers cite the policy version and article; refuses when no accepted rule exists. |
| P3-5 | Link the custody and cash-handover violations (Org. row 9, Conduct row 7) | From an overdue custody or unreturned equipment in `expenses.mjs` or `equipment.mjs`, HR can "open a case" with the evidence attached. Never automatic. |

---

## 5. Notes on what the old app got right, for the record

- It reached employees where they are: one mobile-friendly portal with leave, attendance, letters, requests, approvals and team view. Our equivalent is spread across modules. `routing.mjs portal` and `inbox.mjs` are the anchors to keep strengthening.
- It treated the HR officer's routine as a first-class workload (plan, guide, checklist). This is missing from our HR side.
- It attempted to turn the regulation into operations. The attempt was wrong in detail, but the direction was right.

## 6. Missing from the snapshot (still arriving, per `_manus-app-fetch/manifest.tsv`)

**Server:** `penaltyEngine.ts` (+ `penaltyEngine.test.ts`, `penalties.test.ts`), `tasksDb.ts`, `hcmRoutes.ts`, `servicesRoutes.ts`, `workflowDb.ts`, `employeeDb.ts`, `syncScheduler.ts`, `notificationsDb.ts`, `emailService.ts`, `emailRoutes.ts`, `attendanceExcel.ts`, `reportsExcel.ts`, `security.ts`, `securityHardening.ts`, `hcmValidation.ts`, `zohoService.ts`, `leaveBalances.test.ts`, `employee-portal.test.ts`.
**Client pages:** `Expenses`, `Payroll`, `Onboarding`, `OnboardingJourney`, `Performance`, `PerformanceEval`, `OKRsDashboard`, `Surveys`, `EngagementHub`, `WorkRequests`, `WorkflowEngine`, `HRApprovals`, `SelfService`, `Compliance`, `CareerPlanning`, `ManagerLeaveCalendar`, `Documents`, `Recruitment*`.
**Client libs and data:** `lib/warningLetter.ts`, `lib/salaryDocuments.ts`, `lib/attendanceEngine.ts`, `data/leaveTypes.json`, `data/saudiBanks.json`, `data/saudiEmbassies.json`.
**Notes:** `attendance-policy-rules.md`, `violation-letter-template-notes.txt`, `run-penalty-sync.mjs`.
**Not in the manifest at all:** any offboarding page, the approval authority matrix (مصفوفة الصلاحيات) referenced by the regulation, and the regulation's benefits matrix (Annex 1) and mission-allowance grade table in legible form.

When `penaltyEngine.ts`, `attendance-policy-rules.md` and `violation-letter-template-notes.txt` arrive, re-check §1.2 and §3.3. They may show the old engine was closer to the regulation than `todo.md` suggests.
