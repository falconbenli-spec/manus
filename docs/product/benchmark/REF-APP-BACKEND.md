# Reference app backend benchmark: the old HR app vs the 3,6T platform

**Date:** 19 September 2026
**Status of this document:** analysis only. Nothing here is built. Every adoption item below is *proposed*. None has been accepted by the process owner, who is the HR manager (DEC16).
**Scope:** the server-side services of the old HR app that 3,6T used. That app was built with Manus on Express 4, raw MySQL through mysql2, and React 19.
**Snapshot location:** `work/reference/manus-app/`
**Our platform:** Node 24 ESM, zero dependencies, `node:sqlite`, `app/*.mjs`.

**Standing rules applied:**
- The platform is the only system of record. There is no Zoho and no Beem.
  - Every Zoho dependency in the old app is treated as a pattern **not** to copy.
  - Only the business need behind it is kept.
- No secrets, tokens, passwords, contact details, coordinates or employee names or IDs from the snapshot are reproduced here. Where they exist, only their *location* is given, as a security finding.

**Legend for verdicts:**

| Verdict | Meaning |
|---|---|
| **OURS BETTER** | We have it and ours is better. |
| **PARITY** | Equivalent. |
| **THEIRS BETTER AT X** | We have it, but the old app did X that we do not. |
| **MISSING** | Missing in ours. |
| **DO NOT COPY** | A Zoho or other external-system pattern. Only the business need is captured. |

**Effort scale:**
- **S** is up to 2 working days.
- **M** is 3 to 7 working days.
- **L** is more than 7 working days.

Each estimate includes the migration, the module, the route, tests and the screen.

---

## 0. Sources read, and what I could not see

### Read in full, or fully for the parts in scope

- `server/index.ts`: 2,918 lines and 109 route registrations.
- `server/servicesDb.ts`: 1,261 lines.
- `server/zohoDb.ts`: 1,641 lines.
- `server/emailSystem.ts`: 627 lines.
- `server/work-regulations.txt`: 2,207 lines. This is the company's regulations, approved on Qiwa and issued 24 April 2025.
- `vite.config.ts`: 3,694 lines. It is the second copy of the API, run as dev middleware.
- `todo.md`: 1,231 lines. It has 705 items done, 224 open and 3 skipped.
- `package.json` and `shared/const.ts`.
- `server/portal-app.html` was only grepped for API calls. It is 321 KB of client code.

### Our side

- `app/*.mjs`: 111 modules plus `server.mjs`.
- `app/access.mjs`.
- `app/migrations/`: **80 files**, numbered 002 to 095. The numbers 001, 011 and 077–089 are not used. The brief said 95 migrations; the highest number is 095, but there are 80 files.
- `docs/product/benchmark/COMPARISON-20260917.md`.
- `docs/implementation/WIRING-SPEC.md`.
- `STATUS.md`.

### Could not see (still in Drive)

Imported by `server/index.ts` but absent:
- `emailService`, `attendanceExcel`, `syncScheduler`, `zohoService`
- `security`, `securityHardening` (holds the middleware, sessions, lockout, Zod schemas and CSRF)
- `_core/storageProxy`
- `servicesRoutes` (production routes for surveys, OKRs, expenses, succession, policies and work requests)
- `emailRoutes`
- `hcmRoutes` (production routes for tasks, penalties, contracts, PDPL and notifications)
- `notificationsDb`
- `employeeDb` (delegation and overtime storage)

Imported by `vite.config.ts` but absent:
- `portalHtml`, `reportsExcel`
- `tasksDb`. This holds `syncPenaltiesFromAttendance`, **the actual penalty engine**.
- `workflowDb`

Named in `todo.md` but absent:
- `penaltyEngine`, `attendanceEngine.ts`, `salaryDocuments.ts`, `emailTemplates.ts`, `tokenEncryption.ts`, `seed-contracts.mjs`
- all `*.test.ts` files. The history claims 209 tests and 55 of them security tests.

Runtime data files read by the server but absent:
- `client/src/data/{employees, payroll, attendance, leaves, performance, onboarding}.json`

Client files absent:
- `index.html`, `main.tsx`, `App.tsx`
- the contexts (`AuthContext`, `EmployeeContext`, `ActivityLogContext`)
- `components/ui/*`
- `lib/excelExport`, `lib/warningLetter`
- `data/{leaveTypes, saudiBanks, saudiEmbassies}.json`
- the pages `Surveys` and `EngagementHub`

Only 8 pages and 1 component are present.

**Consequence:** where production behaviour lives in a missing file, I describe it from the `vite.config.ts` dev copy and from `todo.md`, and I mark it *(dev copy only)* or *(per todo.md)*. The penalty engine, the payslip generator and the warning-letter generator could not be read directly. Their rules are reconstructed from `todo.md` and the dev copy.

---

## 1. Inventory of the old app's services

Thirty-two groups follow, in rough request-flow order. "Data" means the MySQL tables. The tables are all created lazily with `CREATE TABLE IF NOT EXISTS` inside request handlers.

| ID | Service / route group | Purpose | Data kept | Business rules (as coded) | Quality notes |
|---|---|---|---|---|---|
| S01 | **Admin auth** `/api/auth/{login,logout,me}` | Sign-in for owner, admin and department managers. | In-memory `PASSWORD_HASHES` and `USER_ROLES` built from env vars; `hcm_sessions` table. | bcrypt cost 12. Lockout after 5 failures for 15 min. 8 h session cookie. There are 9 hard-wired department-manager accounts, each with a random password if its env var is unset. | The user store is env vars, not a table: no user admin, no rotation, no audit of role changes. Plaintext owner/admin/manager passwords are present in `vite.config.ts:176-186` [redacted]. |
| S02 | **Employee portal auth** `/api/employee/portal-{login,logout,me,change-password}` and `/api/admin/employee-passwords*` | Separate employee login (`emp_session`). | `employee_passwords` (hash, `must_change`). | Minimum 6 characters. Admin-set passwords force a change. `init-defaults` gives every employee a **predictable default derived from their ID** [pattern at `index.ts:2149-2158`, redacted]. | **Critical:** production login (`index.ts:1309-1312`) accepts `password === employeeId` and never checks the stored hash. `todo.md:276` marks this "fixed", so it regressed. Any known employee ID is a valid login. |
| S03 | **Zoho People integration** `/api/zoho/*` (13 routes), sync scheduler, `/api/leaves/synced`, `/api/attendance/synced`, `/api/zoho/leave-balance` | Pull attendance, leave and balances from Zoho People. | `zoho_settings` (OAuth tokens), `zoho_leaves`, `zoho_attendance`, sync log. | Startup sync if data is older than 6 h. Scheduled sync. OAuth `state` check in production only. UPSERT. | **DO NOT COPY.** The need behind it: attendance punches come from an outside capture source (biometric/Zoho), and leave history had to be seeded. The dev copy lets anyone overwrite the refresh token (`zoho/set-token` has no auth). |
| S04 | **Weekly attendance report** `/api/zoho/attendance/weekly-report` | Shows each person's shortfall against 8 h a day. | Read-only (Zoho). | Week starts Saturday. Target is 480 min a day. Shortfall = 480 − minutes worked. Compliance = days ≥ 8 h ÷ days worked. Weekends and holidays are skipped. Sorted by shortfall. | Useful view, but it is built on Zoho data and has no own-data equivalent. |
| S05 | **Geofenced check-in** `/api/employee/checkin`, `/checkin/today`, `/checkin-status`, `/checkins` and `/api/geo-locations` CRUD | Mobile check-in allowed only inside a company site. | `employee_checkins` (lat, lng, accuracy, distance, `within_zone`, device fingerprint, IP, user agent, mock flag); `geo_locations` (name, lat, lng, `radius_m`, active, `applicable_services`). | Haversine distance to each active zone. **Blocked (403) outside every zone.** Fallback is one hard-coded zone of 200 m [coordinates redacted]. Alerts HR when one device is used by several employees, or when the client reports a mock location. | Good idea, weak execution: <br>• `employeeId` is taken from the request body, so one person can punch for another. <br>• `?employeeId` lets anyone read others' check-ins. <br>• The mock-location flag is client-asserted. <br>• The date is taken in UTC, so punches between midnight and 03:00 Riyadh land on the wrong day. <br>• Raw coordinates are stored with no retention limit (a PDPL concern). <br>• The dev copy skips the zone check for "exempt" staff; production does not. |
| S06 | **Attendance exemptions** `/api/admin/attendance-exemptions*` and `/api/attendance/exemptions` | Staff excused from punching (executives, field staff). | `attendance_exemptions` (employee, reason, added_by). | Owner or admin adds. A seed endpoint inserts named defaults [names in `zohoDb.ts:1189-1200`, redacted]. | `isEmployeeExempt` falls back to a **first-name `LIKE` match**, which exempts anyone who shares a first name. No expiry and no second approver. |
| S07 | **Attendance edit requests** (طلب تعديل البصمة) `/api/employee/attendance-edit-request(s)` | An employee asks to fix a missing or wrong punch. | `attendance_edit_requests` (date, `edit_type`, requested in/out, reason, manager and HR decision). | Two levels: manager, then HR. | Anyone whose user ID contains the letters "hr" is treated as HR (`index.ts:1035`). No code I could see writes the approved times back into attendance. No time window. |
| S08 | **Permission requests** (استئذان) `/api/employee/permission-request(s)` | Short absence within a working day. | `permission_requests` (date, start, end, duration in minutes, reason, manager and HR decision). | Duration = end − start, must be > 0. Two levels. HR is notified in-app. | Same "hr in the user ID" test. No monthly quota. Not linked to lateness, so an approved permission does not cancel a lateness violation. |
| S09 | **Violations and penalties** `/api/employee/portal-violations`, `/api/tasks/penalties*` *(dev copy only)*, warning letter *(missing `lib/warningLetter`)* | Turn attendance into violations, progressive deductions and warning letters. | Portal side: computed from `attendance.json`. Tasks side: penalty tables (in missing `tasksDb`). | Portal severity: absence is high; late > 30 min is high; > 15 min is medium; otherwise low. No grace. **Per `todo.md`:** <br>• late means after 09:05, later changed to 09:15 <br>• leaving before 17:00 counts as early leave <br>• ladder: verbal warning → written warning → ¼ day → ½ day → 1 day → 2 days plus investigation <br>• the counter **resets monthly** <br>• deductions cap at 5 days a month <br>• no clock-out costs ½ day <br>• **completing 8 h cancels the lateness penalty**. <br>The dev grouping parses deduction amounts back out of Arabic free text ("quarter day" = 0.25 and so on). | The rules in the code and in `todo.md` **contradict the regulations** (see §3). The published penalty table exists **only as text in the AI prompt**, and the dev and production prompts differ from each other. `/tasks/*` is owner/admin only, but the employee portal calls `/penalties/grouped`, so employees get 403. |
| S10 | **Leave requests and balances** `/api/leave-requests` (GET/POST/PATCH/DELETE), `/api/leave-balances`, `/api/employee/portal-leave-request`, `portal-leaves`, `portal-leave-balances` | Request leave, two-level approval, per-type yearly balance. | `leave_requests` (type, dates, days, manager and HR status and notes); `leave_balances` (employee, type, year, total, used, pending, all **INT**). | Submitting reserves days as pending. Manager rejection releases them. HR approval moves pending to used. Overlap check on the portal path only. Days = calendar difference + 1, so weekends and holidays are counted. Attachment URL is supported. Low-balance warning at 3 days or fewer (per `todo.md`). | `POST /api/leave-requests` trusts `employeeId` from the body. `approvalLevel` comes from the client, so a manager can give the final HR approval. Approving through the portal does **not** touch balances, while the admin PATCH does, so the two paths disagree. No transactions, so a crash between two statements leaves the balance wrong. On failure, the portal leave route returns `success:true` and "request received" (`index.ts:1863-1866`), silently losing the request. |
| S11 | **Salary letters** (تعريف بالراتب) `/api/salary-letters`, `/api/employee/portal-salary-letter(s)` | Request, review and issue a salary certificate. | `salary_letter_requests` (purpose, recipient in Arabic and English, language `ar\|en\|both`, status, reviewer, `document_url`). | The manager or above approves or rejects and attaches a document URL. The document itself comes from the missing `salaryDocuments.ts` (.docx/PDF). | `POST /api/salary-letters` trusts `employeeId` from the body. No verification code on the issued letter. |
| S12 | **Salary structures and payslips** (`servicesDb.ts` §3) | Salary per employee and monthly payslip rows. | `salary_structures` (basic, housing, transport, other, GOSI, grade); `payslips` (month, the components, overtime, bonus, GOSI, absence deduction, loan deduction, other, net, status draft/approved/paid). | Status only. **No route exposes these functions.** The portal profile reads salary from `payroll.json` instead. | Payroll never ran on these tables. GOSI, absence deduction and end of service are all open items in `todo.md:326-333` and `450-457`. |
| S13 | **Overtime requests** `/api/employee/portal-overtime-request(s)`, `/api/manager/approve-overtime`, `/api/hr/approve-overtime` | Request and approve overtime. | Missing `employeeDb` (days, hours, reason, manager and HR status). | Two levels. | **Registered after the 404 handler and the SPA catch-all (`index.ts:2472-2500`), so these routes can never be reached in production.** The approve routes also have no role check. No rate, no caps. |
| S14 | **Delegation / secondment** (انتداب) `/api/employee/portal-delegation-request(s)`, `/api/{manager,hr}/approve-delegation` | Record a secondment or mission with extra pay. | Missing `employeeDb` (organisation, position, dates, `additional_salary`, reason). | Two levels. Extra pay is typed in freely. | Unreachable in production, same as S13. No per-diem schedule (the regulations have one; see §3). |
| S15 | **Approval chains and approvals inbox** `/api/approval-chains`, `/api/employee/portal-pending-approvals`, `/api/employee/portal-approve-request` | Configurable approvers per request type, and one inbox. | `approval_chains` (request_type, step_order, `approver_type` `direct_manager\|hr\|specific_employee`, approver). | Manager = job title contains "مدير". HR = department name equals one fixed string. Chain approver = named in any chain. Self-approval is filtered in the inbox list only. | **Chains are stored but never used to route anything.** They only mark a person as an approver. Any authenticated user can replace a chain (`requireAuth` only). Approve takes `requestId` and `approvalLevel` from the client with no department or ownership check. Replacing a chain is delete-then-insert with no transaction. |
| S16 | **Insurance dependants** `/api/employee/insurance-dependent-requests` | An employee asks to add a dependant to medical insurance. | `insurance_dependent_requests` (name, relationship, gender, date of birth, **national ID number**, attachment). | One-step manager-or-above decision. HR is notified. | Stores full ID numbers in clear. No check against the regulations' definition of family (Art. 5). |
| S17 | **Benefits status** `/api/employee/portal-benefits` (`servicesDb` `employee_benefits`) | Per-employee status for each benefit (used / not used). | `employee_benefits` (unique employee and benefit). | Eligible after 6 months of service (per `todo.md:1024`; enforced in client or missing code). The benefits catalogue is in the client. | The catalogue is not server data. |
| S18 | **Generic self-service requests and upload** `/api/employee/portal-request(s)`, `/api/self-service-requests`, `/api/employee/portal-upload` | Catch-all request inbox, plus file upload to Manus Forge storage. | `self_service_requests` (type, title, details JSON, status). | One-step manager-or-above status change. | Errors are swallowed (`catch(e){}`) and success is still returned. The upload parses multipart by hand with no size or type limit and a user-controlled extension, and depends on an outside store. |
| S19 | **Expenses and custody** (`servicesDb` §4, `/api/services/expenses\|custodies` *(dev copy only)*) | Expense claims and cash custody (عهدة). | `expenses` (category travel/supplies/entertainment/training/other, amount, receipt URL, status pending → manager_approved → finance_approved → paid/rejected); `custodies` (amount, purpose, `settled_amount`, active/partial/settled). | Status strings only. The manager → finance → executive chain in `todo.md:358` is **not implemented**. Custody "delete" sets status to returned. | Any session can do full CRUD (dev copy). No link between a claim and a custody. |
| S20 | **Surveys** (`servicesDb` §5, `/api/services/surveys*` *(dev)*) | Satisfaction, pulse, eNPS and custom surveys. | `surveys` (type, status, anonymous flag, `closes_at`); `survey_questions` (rating/text/choice/yes_no, options); `survey_responses` (**`employee_id` stored even when anonymous**). | Anonymous by default. | Anonymity is only a label. No limit of one response per person. No minimum number of respondents before results show. |
| S21 | **Policies and acknowledgements** (`servicesDb` §6) | Publish policies and record who has read them. | `policies` (category, content, version, status); `policy_acknowledgments`. | Record an acknowledgement. | CRUD only. |
| S22 | **OKRs and performance reviews** (`servicesDb` §8) | Individual OKRs, and self/manager/peer/360 reviews. | `okrs` (objective, 3 key results with 0–100 progress, quarter, year); `performance_reviews` (type, period, rating, strengths, improvements, goals, status draft/submitted/acknowledged). | None beyond storage. The review PUT/DELETE routes are TODO stubs (dev). | Fixed at 3 key results. No cascade. No calibration. |
| S23 | **Competencies, skills and succession** (`servicesDb` §7 and §9) | Competency framework, skills matrix, critical positions and successors. | `competencies`; `employee_competencies` (level); `skills`; `employee_skills` (current and target level); `critical_positions` (risk level); `succession_candidates` (readiness now / 1 yr / 2 yr / developing). | None beyond storage. | The client calls `/api/services/skills`, which exists in neither API copy. |
| S24 | **Work requests, projects and clients** (`servicesDb` §1–2) | Requests between departments, rated on completion; light project and task tracker. | `work_requests` (from and to department, priority, status, assignee, due date, rating); `clients`, `projects`, `project_tasks`. | Status flow new → reviewing → in progress → pending approval → completed / rejected / cancelled. The requester rates on completion. | CRUD. |
| S25 | **My Tasks and HR admin board** `/api/tasks/*` *(dev copy; production in missing `hcmRoutes`)* | HR officer's workbench: items, weekly plan, attendance, contracts (renewal), penalties, Excel exports. | Tables whose names include one staff member's name (in missing `tasksDb`). | Contract renewal. Penalty sync from attendance. Exemption of penalty dates. | A personal tool promoted to a system. Opening a database pool on every request. Owner/admin only. |
| S26 | **Contract expiry and daily scheduler** `/api/contracts/{expiring,notify}` and `startDailyScheduler` | Email HR about contracts nearing their end. | Missing `emailService`. | Checked daily with `setInterval(24h)`. Alerts at 30, 60 and 90 days (per `todo.md`). | Timer runs in the web process, with no record that it ran and no retry. |
| S27 | **Email system** (`emailSystem.ts`, missing `emailRoutes`) | Arabic right-to-left HTML emails through the Resend API, templates, bulk send, log. | `email_logs` (to, subject, template, category, status, error, `sent_by`, metadata); `email_templates` (subject and body with `{{var}}`). | Templates: welcome, contract expiry, attendance violation, birthday, achievement, announcement, weekly and monthly report, payroll, security alert, survey invite, custom. Bulk send waits 100 ms between emails. | **Values are put into HTML without escaping**, so HTML can be injected into emails. Sent inline, so a failure is logged but never retried. The sender is the provider's sandbox address. Delivery DNS was never verified (open in `todo.md`). |
| S28 | **In-app notifications** (missing `notificationsDb`; `/api/hcm/notifications*` in dev) | Bell notifications, "smart" rule runs, cleanup. | `notifications` (type, category, title, message, metadata). | Rules per `todo.md`: <br>• 3 or more consecutive attendance violations <br>• weekly overdue tasks <br>• ID or licence expiry <br>• payroll <br>• weekly report on Sundays <br>• birthdays | The rule engine is not visible. |
| S29 | **AI** `/api/employee/portal-ai-chat` (the portal assistant), `/api/ai/chat`, `/api/ai/analyze-sentiment`, `/api/ai/analytics-summary` | Answer HR questions; score employee sentiment; summarise analytics. | None. | The **regulations are hand-summarised into the system prompt.** Sentiment returns JSON with a mood label and a 0–100 score. | The prompt summary is **wrong in places** (§3.9). The analytics summary sends **hard-coded fake KPIs** (`orgHealth: 78` and so on). The prompt contains company contact details [redacted, `index.ts:~1893`]. Sentiment scoring of employees is a privacy and ethics risk. |
| S30 | **PDPL** `/api/hcm/{consent,dsar,retention}` *(dev)* | Consent, data subject requests (4 types), retention log. | Missing code. | 5-year retention after the employment ends (per `todo.md`). | Not visible. |
| S31 | **Portal read models**: `portal-{profile,attendance,team,directory,announcements,dashboard,performance,training,tasks}`, `/api/employee/personal-info` *(dev)* | The employee's home page. | Reads the **JSON files in `client/src/data`**, including `payroll.json`. | The org level is guessed from Arabic job-title substrings. A clock-in with status "absent" counts as present. | Master data and salaries live in the client source tree, where the build can bundle them. Announcements are hard-coded sample text. Tasks returns `[]`. `personal-info` has an IDOR (dev). |
| S32 | **Platform**: `/health`, `/api/admin/audit-log`, `/api/admin/attendance-excel`, security middleware stack | Operations and export. | In-memory audit log (the last 200 entries are served). | Helmet, CORS, rate limits, an attack-path blocker, an "XSS sanitizer", request size limit, parameter-pollution guard. Monthly Excel through exceljs. | The middleware is thorough in intent, but see §4. The audit log is not tamper-evident. |

**Route count:** `index.ts` registers 109 handlers. The dev copy registers about 110 prefix handlers covering about 180 method/path pairs.

Three groups of dev routes have no production equivalent in the code I could see, because their production files are missing:
- `/api/services/*`
- `/api/hcm/*`
- `/api/tasks/*`

The client also calls routes that exist in neither copy:
- `/api/geo-locations/active`
- `/api/services/skills`
- `/api/tasks/penalties/{mark-done, export-excel, exempt-days}`

---

## 2. Service-by-service comparison with our platform

| ID | Our equivalent (file → function / route) | Verdict | Notes |
|---|---|---|---|
| S01 | `app/auth.mjs` (scrypt, hashed session tokens, CSRF, lockout 10 per user+IP and 200 per IP), `app/totp.mjs`, `app/access.mjs` (`CAPABILITIES`, `holds`, `mfaSatisfied`), `app/admin.mjs` | **OURS BETTER** | Real user table, per-capability grants, optional TOTP, a `must_change_password` gate, and an audit log that is hash-chained and append-only (`db.mjs:verifyAudit`). |
| S02 | Same accounts as S01. There is no second login. | **OURS BETTER** | One identity for every employee. Nothing to copy. |
| S03 | Nothing (by rule). The punch source column is `attendance_records.source IN ('self','correction')` (migration 026). | **DO NOT COPY**, need **MISSING** | The real need is **importing punches from an outside capture device**. See P2-06. |
| S04 | `app/reports.mjs` R37, `app/report-schedules.mjs` (weekly and monthly snapshots) | **THEIRS BETTER AT** hours-worked and 8-hour-shortfall view | R37 counts complete and incomplete days, unpaid absences and corrections. It does not count late days, late minutes, early leave, or hours against the daily norm. |
| S05 | `app/attendance.mjs` → `punch`, `dayStates` | **THEIRS BETTER AT** proof of location | Ours is better at integrity: <br>• server time <br>• one in and one out per day <br>• Riyadh date <br>• must run inside a transaction <br>• corrections instead of re-punching <br>But nothing proves *where* the punch happened, and `server.mjs` sets `Permissions-Policy: geolocation=()`, which blocks location in the browser. See P1-03. |
| S06 | None | **MISSING** | Today a person who does not punch shows as "unexplained" every day. See P2-04. |
| S07 | `attendance.mjs` → `requestCorrection`, `decideCorrection` | **OURS BETTER** | Only for the last 45 days. One pending request per day. The decider is not the requester. The approved times are **written back** with `source='correction'` and the previous times kept. |
| S08 | Catalogue request `HR-ATTENDANCE-FIX` (kinds include استئذان) in `app/service-catalog.mjs:95` via `workflow.mjs` | **THEIRS BETTER AT** treating permission as a timed attendance object | Ours is a generic request that never reaches `dayStates`. So an approved استئذان does not change the day's state or the lateness. See P1-04. |
| S09 | Deliberately none: "لا يتحول إلى خصم أو مخالفة تلقائيًا (HR-03)" (`attendance.mjs:9-10`). The nearest things are `hr-cases.mjs` (`violation_report`, `grievance`) and `payroll-extras.mjs` → `proposeAdjustment(kind:'deduction')`. | **MISSING** (and theirs was **wrong**) | The regulations *require* a schedule of penalties with due process (Art. 111–126). Ours has the safe building blocks (proposal → statement → second-person confirm, as `proposeAbsence` / `stateAbsence` / `decideAbsence` already do) but no violation register. See P1-01. |
| S10 | `app/leave.mjs` → `createLeaveRequest`, `leaveAction`, `grantLeaveOpening`; `app/leave-accrual.mjs`; `app/work-calendar.mjs` | **OURS BETTER**, but **THEIRS BETTER AT** attachments and a type list | Ours has: <br>• a ledger of posted and reserved days <br>• versions for each revision <br>• counting in working days <br>• an overlap check (409) <br>• an HR scope check <br>• a re-check that the approving manager is still the manager. <br>Ours lacks: <br>• a statutory type catalogue (`leaveType` is any free code) <br>• a supporting document on a request (no attachment field in `leave.mjs`) <br>• sick-leave pay tiers. <br>See P1-02. |
| S11 | `app/letters.mjs` → `requestLetter`, `letterAction`, `saveTemplate`, `approveTemplate`, `verifyLetter` (QR code), `letterPrintable`; seeded `letter_types` `salary` / `experience` / `embassy` (migration 048) | **OURS BETTER**, but **THEIRS BETTER AT** English/bilingual output | Ours: <br>• the template author cannot approve the template <br>• the salary amount is computed at issue time and never stored <br>• the letter carries a public verification code with a rate limit. <br>Theirs had `language: ar\|en\|both` and a recipient name in each language. The five template texts are still pending (WIRING-SPEC §7 #27). |
| S12 | `app/payroll.mjs` → `computeLine`, `prepareRun`, `runAction`, `viewPayslip`; `payroll-extras.mjs`; `payroll-checks.mjs` → `preRunChecks`; `print-documents.mjs` → `payslipPrintable`; `wage-protection.mjs` | **OURS BETTER** | Theirs never ran payroll. Ours has: <br>• three different people prepare, review and approve <br>• a locked run once approved <br>• amounts in halalas (integer minor units) <br>• a payslip only its owner can see, with every view logged. <br>Missing on ours: deduction caps (see P2-02). |
| S13 | `attendance-extras.mjs` → `requestOvertime`, `decideOvertime`, `overtimeToPayroll` | **OURS BETTER**, **MISSING** the rate and caps | Ours works and reaches payroll through an adjustment that is approved separately. But the amount is typed in by hand ("لا معدل نظامي مكتوب هنا"), there is no prior assignment, and there are no caps. The regulations define all three (§3.2). See P1-05. |
| S14 | `attendance-extras.mjs` → `requestMission`, `decideMission` (up to 60 days); catalogue request `ADM-TRAVEL`; `expenses.mjs` category `travel` | **PARITY** on recording, **MISSING** the per-diem | Neither side computes the travel allowance. The regulations give the full schedule (Art. 63–65). See P2-01. |
| S15 | `app/workflow.mjs` → `planApprovals`, `transition`, `escalateApproval`, `thresholdFor`, `setApprovalFallback`; `app/delegations.mjs`; `app/inbox.mjs`; migration 093 | **OURS BETTER** | Ours: <br>• routes by role steps (`STEP_ROLES`) with conditional `when` steps and thresholds <br>• the beneficiary never approves their own request <br>• the same person appearing twice is escalated, not skipped <br>• escalation is allowed after 24 h <br>• delegation is dated and scoped to one service. <br>Theirs stored chains but never routed through them. One idea worth taking: **a named specific employee as a step** for a request type. Ours routes by role only. See P3-05. |
| S16 | `app/benefits.mjs` → `addDependant`, `removeDependant` (HR only); employee path via catalogue request `HR-BENEFIT-CLAIM` | **THEIRS BETTER AT** a direct employee request for a dependant | Ours stores relation and birth date only, and no full ID number, which is better for privacy. But the employee cannot start the request from the benefits screen. There is also a known route defect: the dependants route ignores `:id` (WIRING-SPEC §8.3). See P2-05. |
| S17 | `benefits.mjs` → `benefitsBoard`, `recordEnrolment`, `enrolmentAction` (medical only) | **PARITY** (different scope) | Theirs tracked non-medical perks (parents' insurance, education, gym) with a 6-month waiting period. The regulations defer these to "Annex 1 benefits matrix", which is not in the file (Art. 70). Build only when that annex is supplied. |
| S18 | `workflow.mjs` → `createRequest`; `service-catalog.mjs` (140 services); `files.mjs` → `uploadFile` (PDF/PNG/JPEG checked by signature, 2 MB) | **OURS BETTER** | Typed services with field guidance, an intake gate, and safe uploads. |
| S19 | `app/expenses.mjs` → `submitClaim`, `claimAction` (manager_approve → finance_approve → record_reimbursement), `requestCustody`, `custodyAction`, `custodyBalance`; `assets.mjs`; `equipment.mjs` | **OURS BETTER** | Ours has: <br>• a duplicate check <br>• one open custody per holder <br>• a claim cannot exceed the remaining custody <br>• closing requires the returned cash to match exactly. <br>Theirs was status strings only. |
| S20 | `app/engagement.mjs` → `createCycle`, `approveCycle`, `submitPulse`, `pulseBoard` (`MIN_RESPONDENTS_FLOOR=5`, eNPS 0–10); `feedback.mjs` (360, `MIN_UPWARD_FLOOR=3`) | **OURS BETTER**, **THEIRS BETTER AT** choice and yes/no questions | Ours enforces anonymity in the data and hides results below the respondent floor. Theirs allowed any survey shape. See P3-03. |
| S21 | `app/policy-acknowledgements.mjs`; `hr-contracts.mjs` (accepted, dated policies) | **OURS BETTER** | Acknowledgements run in rounds, and policies are versioned by effective date. |
| S22 | `app/talent.mjs` → `createCycle`, `reviewAction` (self → manager → calibrate → acknowledge → appeal within `APPEAL_DAYS=14`), `setGoal`, `goalAction`; `governance.mjs` (objectives) | **OURS BETTER** on reviews; **THEIRS BETTER AT** OKR key results with progress | Ours has personal development goals and company objectives, but no key results with measured progress that cascade to people. See P3-02. |
| S23 | `talent.mjs` → `createPlan`, `planAction` (succession, `READINESS`); `career-profile.mjs` (qualifications) | Succession **OURS BETTER**; competencies and skills **MISSING** | There is no competency framework and no skills matrix anywhere in `app/`. See P3-01. |
| S24 | `workflow.mjs` (requests between departments); `service-experience.mjs` (rating after close); `projects.mjs`, `agency.mjs`, `workspace.mjs` | **OURS BETTER** | Ours has service clocks, transfers, rating, and projects with tasks that need evidence to close. |
| S25 | `inbox.mjs`, `home.mjs`, `workspace.mjs` (personal tasks), `hr-contracts.mjs` (contract alerts: probation ending within 14 days, contract ending within 60) | **OURS BETTER** | There is no personal tool to copy. |
| S26 | `expiry.mjs` (`WATCHED_KINDS`, lead time from `expiry_watch_settings`); `hr-contracts.mjs` alerts; `jobs.mjs` (queue with backoff, **no production handler**) | **THEIRS BETTER AT** pushing reminders on a schedule | Ours shows alerts only when someone opens the board, and no lead time is set by default. See P2-07. |
| S27 | None. `outbox.status CHECK IN ('blocked')`; `engagement.mjs` `ANNOUNCEMENT_NOTE` states there is no email. | **MISSING** (by open decision) | This is the biggest usability gap for an HR system (COMPARISON §1 top gaps: "hosting plus notifications"). See P1-06. |
| S28 | `workflow.mjs` → `notifyUser`, `notifications`, `markNotification` | **PARITY**, but **THEIRS BETTER AT** notifications that are not about a request | `notifications.request_id` is `NOT NULL`, so an absence, a penalty notice or a document expiry cannot notify anyone (WIRING-SPEC §7 #1). |
| S29 | `app/ai.mjs` → `policy_answer` (answers only from accepted policy paragraphs, with citation or refusal), `employee_assistant`; `pii.mjs` masking; `ai-governance.mjs`, `ai-evals.mjs` | **OURS BETTER** | Ours cites the accepted policy and paragraph, or refuses. Sentiment analysis is deliberately excluded (COMPARISON §8). One idea worth taking: load the **regulations document itself** as the source. See P1-07. |
| S30 | `app/privacy.mjs` (PDPL registers) | **PARITY or better** | Their code was not visible. |
| S31 | `employees.mjs` → `employeeRecord`, `listEmployees`; `workspace.mjs` → `orgChart`; `engagement.mjs` announcements; `home.mjs` → `homeBoard` | **OURS BETTER** | Master data lives in the database with dated changes. The org chart comes from real manager links, not guessed from titles. |
| S32 | `db.mjs` (hash-chained audit, triggers `audit_no_update` and `audit_no_delete`), `reports.mjs` + `xlsx.mjs` (zero-dependency XLSX), `server.mjs` (Host/Origin allow-list, strict CSP, JSON-only bodies) | **OURS BETTER** | |

**Tally** (some groups carry two verdicts):
- OURS BETTER: S01, S02, S07, S10, S11, S12, S13, S15, S18, S19, S20, S21, S22 (reviews), S23 (succession), S24, S25, S29, S31, S32.
- PARITY: S14 (recording), S17, S28, S30.
- THEIRS BETTER AT X: S04, S05, S08, S10, S11, S16, S20, S22, S26, S28.
- MISSING: S06, S09, S13 (rate and caps), S14 (per-diem), S23 (competencies), S27, and the need behind S03.
- DO NOT COPY: S03.

The old app was wider. Ours is deeper and safer. What we lack is almost entirely **encoded HR rules** and **outbound delivery**, not structure.

---

## 3. The regulations: what our platform encodes and what is missing

**Source:** `server/work-regulations.txt`. "Art." means an article of the company's regulations; "LL" means the Saudi Labor Law.

The text was extracted from a PDF, so some Arabic lines and numbers are reversed. Readings flagged "uncertain" must be confirmed against the signed PDF before anything is coded.

**Design stance of our platform:** statutory numbers are **not hard-coded**. Each one is a dated parameter in an HR policy that the HR manager accepts (`hr-contracts.mjs` `POLICY_KINDS` = `pay_components`, `working_time`, `payroll_cycle`, `end_of_service`), and a feature refuses to act without an accepted policy.

So "encoded" below means *a policy parameter exists that can hold the rule*. "Missing" means *there is no place to put it and no code that applies it*.

### 3.1 Working time

| Rule | Art. | Ours | Where / gap |
|---|---|---|---|
| 5-day week; rest Friday and Saturday | 73(1) | **Encoded as a parameter** | `working_time.workdays`; `work-calendar.mjs` → `isWorkingDay` |
| 8 hours a day | 73(2) | **Encoded as a parameter** | `working_time.start` / `end` |
| Grace before a check-in counts as late | not in the regulations (the old app used 09:05, then 09:15) | Encoded as a parameter | `working_time.grace_minutes` (0–120). The value is the HR manager's decision. The regulations give no grace. |
| Ramadan: 6 h a day and 36 h a week for Muslim workers | 73(2), 74(2) | **Missing** | There is no dated override of the working-time policy for a period. Adding a new policy would replace the old one permanently. See P2-03. |
| At most 5 h of continuous work; a break of at least 30 min; at most 11 h a day at the workplace | 74(7) | **Missing** | No check of span or break. |
| Leaving early needs the manager's approval; field staff log exit, location and return | 74(8) | Partial | Catalogue request only. Early leave is not detected by `dayStates`. Missions cover field work. |
| Attendance must be recorded; the method is the authority holder's choice | 74(9), 79 | **Encoded** | `punch` |
| Unexpected absence or lateness is notified to the manager the same day | 75 | **Missing** | There is no same-day "I'm late / absent" notice that would later serve as the excuse. |

### 3.2 Overtime

| Rule | Art. | Ours | Where / gap |
|---|---|---|---|
| Prior written assignment (hours and days) from the authority holder, HR budget approval, not caused by the worker's negligence | 76(1), 77(2)(3)(7) | **Missing** | `requestOvertime` is after the fact (today or the last 30 days) and filed by the employee. |
| Rate = hours × (actual hourly wage + 50% of basic hourly wage), the same on rest days and holidays | 76(2), 77(4); LL 106 | **Missing** | `overtimeToPayroll` takes an amount typed by hand. |
| Caps: 3 h a working day, 8 h on a holiday, 20 h a week; overtime pay in a year ≤ 6 months of basic wage | 77(8), 77(5) | **Missing** | Ours only enforces 15–720 minutes in steps of 15, one request a day. |
| Time off instead of pay, with consent; unused time off paid in cash at exit | 77(6) | **Missing** | |
| No overtime pay and travel allowance for the same period | 77(9) | **Missing** | Missions and overtime are not cross-checked. |
| Paid at the end of the month in which it was worked | 47, 77(4) | Partial | The adjustment carries `month`, but nothing forces it to be the month worked. |

### 3.3 Violations and penalties

| Rule | Art. | Ours | Where / gap |
|---|---|---|---|
| Penalty types: warning, fine (% of daily wage or 1–5 days), suspension ≤ 5 days a month, loss of promotion or increment ≤ 1 year, dismissal with award, dismissal under LL 80 | 111 | **Missing** | |
| **Table A** (working-time violations), 16 rows × 4 occurrences. Examples: <br>• late ≤ 15 min, no disruption: warning / 5% / 10% / 20% <br>• late 15–30 min, no disruption: 10 / 15 / 25 / 50% <br>• late > 1 h: warning / 1 / 2 / 3 days <br>• early leave ≤ 15 min: warning / 10% / 25% / 1 day <br>• absent 1 day: 2 / 3 / 4 days / loses increment <br>• 2–6 days absent: 2 / 3 / 4 days / loses increment <br>• the escalation for 7–14 days <br>• > 15 consecutive or > 30 intermittent days: dismissal after a written warning at 10 or 20 days | Annexed table | **Missing** | The "additional deduction for the late or absent time" column may be a merged cell; *uncertain*. |
| **Table B** (18 work-organisation violations) and **Table C** (16 behaviour violations) | Annexed tables | **Missing** | These are HR-case categories. They are not derived from attendance. |
| The repeat window is **180 days**, after which the count starts again | 114 | **Missing** | The old app reset monthly, which is wrong. |
| When one act breaks several rules, only the harshest penalty applies | 115 | **Missing** | |
| A single fine ≤ 5 days' wage; total fines in a month ≤ 5 days' wage | 116 | **Missing** | Also absent as a payroll check. |
| Above a 1-day fine: written charge, hearing, defence and minutes; below it, questioning may be oral but is minuted | 117, 126(1) | Partial pattern | `proposeAbsence` → `stateAbsence` → `decideAbsence` already implements "proposal → employee statement → a second person confirms (or 3 days pass)". It is not generalised to violations. |
| No action 30 days after the violation is discovered without investigation; no penalty 30 days after it is proven | 119, 120 | **Missing** | |
| Written notice of the penalty stating what happens on a repeat; registered mail or e-mail counts as notice | 121 | **Missing** | Needs a letter type and delivery (P1-06). |
| A penalty sheet in each worker's file; a fines register (LL 73); fine money spent for the workers' benefit | 122, 123 | **Missing** | |
| Grievance: file within 30 days, company answers within 15 days, then the labor court within 30 days | 126 (replaces 125) | Partial | `hr-cases.mjs` has a `grievance` category and targets. The 30/15 statutory clock is not set. |

### 3.4 Absence

| Rule | Art. | Ours | Where / gap |
|---|---|---|---|
| A day with no record is not automatically absence | (safe design; HR-03) | **Encoded** | `dayStates` → `unexplained`. Unpaid absence only through the two-person process. |
| Unpaid absence is deducted from pay | Table A "additional deduction" | **Encoded** | `confirmedUnpaidDays` → `computeLine` (monthly total ÷ basis days × days) |
| Termination threshold: > 15 consecutive / > 30 intermittent days in a contract year, after a written warning at 10 / 20 days | Table A rows 15–16 | **Missing** | No counter or warning. |
| Late return from leave without an approved extension counts as absence | 92 | **Missing** | Leave does not know its return date for attendance purposes. |

### 3.5 Leave

| Rule | Art. | Ours | Where / gap |
|---|---|---|---|
| Annual leave: 30 calendar days on full pay per Gregorian year, from year 1 | 80, 86 | **Parameter only** | `leave-accrual.mjs` can accrue any rate. There is no statutory type. `leave.mjs` counts **working days**, while the regulations say **calendar days**; this must be decided per type. |
| Annual leave cannot be taken during probation | 86 | **Missing** | |
| Carry-over: needs the authority holder; the company may defer up to 90 days; not past the end of the next year | 86(4) | Partial | `carryover_cap_milli` and explicit dated runs. No 90-day or next-year limit. |
| At most 6 splits a year | 86(5) | **Missing** | |
| Cash-out only at the end of service, at the last actual wage; paid to heirs on death | 86(6), 38(3) | **Encoded** | `cash_on_end_of_service` flag; `computeSettlement` leave payout |
| Accrual stops for unpaid leave beyond 20 days | 86(2)(b), 91(6) | **Missing** | |
| Emergency leave: 3 working days a year, paid, may be taken in half days | 87 | **Missing** | Also no half-day unit in `leave.mjs`. |
| Marriage 5 days; paternity 3; death of spouse, parent or child 5; death of sibling 3 (counted from the date of death) | 82, 94 | **Missing** | |
| Iddah: Muslim widow 4 months 10 days on full pay; non-Muslim widow 15 days | 82 | **Missing** | |
| Sick leave: in any year from the first sick day, 30 days full pay, 60 days at 75%, 30 days unpaid; a certificate is required; holidays are not counted | 83, 88 | **Missing** | Payroll has no partial-pay leave. |
| Exam leave: paid for exam days if enrolment was approved; request at least 15 days ahead; otherwise taken from annual leave or unpaid | 89 | **Missing** | |
| Accompanying a sick relative: up to 15 days paid, at the authority holder's discretion | 90 | **Missing** | |
| Unpaid leave: requires ≥ 1 year of service and no annual or emergency balance; ≤ 6 months (≤ 18 over the whole service); manager approves ≤ 5 days, authority holder above | 91 | **Missing** | |
| Maternity: 12 weeks on full pay (6 mandatory after delivery); +1 month unpaid; +1 month paid for a child needing care | 105 (replaces 101) | **Missing** | |
| Nursing breaks: 1 h a day for 24 months, counted as working time | 102 | **Missing** | |
| Public holidays: Eid al-Fitr 4 days, Eid al-Adha 4 days, National Day, Founding Day (22 Feb); a holiday on a weekend is compensated; the CEO may add up to 5 days | 81, 84 | Partial | `attendance-extras.mjs` → `proposeHoliday` / `decideHoliday` (two people). There is **no annual seed**, and holidays are held in two places: `public_holidays` and `leave_calendars.holidays_json`. |
| Hajj leave | not in the regulations | n/a | The old app's prompt invented "10–15 days". |
| All leave actions go through signed forms | 93 | **Encoded** | Versioned requests and decisions (`leave_request_versions`, `leave_decisions`) |

### 3.6 Probation, contract and end of service

| Rule | Art. | Ours | Where / gap |
|---|---|---|---|
| Probation only if written in the contract, ≤ 180 days; a second probation only for a different job | 23–27 | Partial | `employment_contracts.probation_days`. No 180-day maximum was seen. |
| The manager's evaluation report is due at least 2 weeks before probation ends; the authority holder confirms | 25, 26 | Partial | Alert "probation ending within 14 days" (`hr-contracts.mjs:59`). No evaluation form and no confirmation decision. |
| Resignation deemed accepted after 30 days; may be deferred 60 days; not allowed while under investigation | 34, 37 | **Missing** | `lifecycle.mjs` handles offboarding, not the resignation clock. |
| End-of-service award on the last actual wage; resignation tiers: < 2 years 0, 2–5 years ⅓, 5–10 years ⅔, > 10 years full | 36 | **Encoded as parameters** | `computeSettlement` (`first_rate_bp`, `later_rate_bp`, resignation tiers). **Art. 36(2) wording differs from LL 84** (a literal reading pays a full month for *every* year once service exceeds 5). The HR manager must decide which applies. |
| Final settlement within 7 days (company ends employment) or 14 days (worker ends it) | 50(2) | **Missing** | No deadline alert. |
| Rehire conditions: not dismissed, > 1 year since leaving, previous service ≥ 1 year | 14 | **Missing** | |

### 3.7 Wages and allowances

| Rule | Art. | Ours | Where / gap |
|---|---|---|---|
| 30-day month for pay calculations | 5, 50(1) | **Encoded** | `payroll_cycle.day_basis='thirty'` |
| Paid through a Saudi bank under WPS; if payday falls on a rest day, pay on the previous working day; round up to the nearest riyal | 46, 48, 50 | Partial | `wage-protection.mjs`, `payroll_payments`. No rule to move payday off a rest day. Rounding is half-up in halalas, **not rounded up to the riyal**; the HR manager must decide. |
| Deductions allowed without consent: employer loans ≤ 10% of wage, court debts ≤ 25%, GOSI, fines | 51 | **Missing** (the caps) | Advances can take 1–24 instalments with no 10% cap. |
| Housing allowance 25% of basic | 67 | **Missing** | Any value is accepted under `pay_components`. |
| Transport allowance paid during leave, not paid when transport is provided | 68 | **Missing** | |
| Emergency advance at the CEO's discretion | 71 | **Encoded** | `proposeAdvance` / `decideAdvance` |
| Payroll is confidential to HR and Finance | 49(3) | **Encoded** | Contract and pay visible only to the owner and explicit HR holders; payslip views are logged |

### 3.8 Travel, rewards, training and appraisal

| Rule | Art. | Ours | Where / gap |
|---|---|---|---|
| Per-diem SAR per day (abroad / in the Kingdom): <br>• CEO 2,500 / 2,100 <br>• deputies 1,500 / 1,000 <br>• general managers 900 / 600 <br>• employees 500 / 400 <br>Cut to ¼ if housing and transport are provided, ½ if housing only. Distance threshold 75 / 40 / 15 km. Extension ≤ 2 weeks. | 63–65 | **Missing** | |
| Air-ticket class by grade | 41 | **Missing** | |
| Appraisal at least yearly, 5 levels, supervisor prepares, authority holder approves, grievance allowed | 52–55 | Partial | `talent.mjs` uses a **3–10 scale** with a 14-day appeal. The 5-level scale must be configurable. |
| Increment needs ≥ "average" after a full year; promotion needs "above average", a vacancy and qualifications, with a tie-break order | 56, 61–62 | **Missing** | `compensation.mjs` has bands and cycles but no eligibility rule. |
| Non-cash reward up to 5 paid days; cash reward up to 4 months' wage | 58–59 | **Missing** | Bonus adjustments have no cap. |
| Training bond: serve a period equal to the training period, or repay | 42–45 | **Missing** | `training_records` has no obligation. |

### 3.9 Rules the old app got wrong (do not port them)

In the portal assistant prompt (`index.ts:~1893-1960`):

| Rule | Old app | Regulations |
|---|---|---|
| Late ≤ 15 min, 4th time | 15% | **20%** |
| Late 15–30 min | 10 / 25 / 50 / 75% | **10 / 15 / 25 / 50%** without disruption; 25 / 50 / 75% / 1 day with |
| Maternity | 10 weeks | **12 weeks** (Art. 105 replaced Art. 101) |
| Hajj | 10–15 days | **Not in the regulations** |
| Unpaid leave | ≤ 20 days | **≤ 6 months** (Art. 91). 20 days is the threshold that stops accrual. |
| Probation | 90 days, extendable to 180 | **≤ 180 days, only if written in the contract** (Art. 23) |
| "Disruption" rows | Dropped entirely from the production prompt | Present in Table A |

In `todo.md`:
- The lateness counter **resets monthly**; Art. 114 sets a **180-day** window.
- **Completing 8 hours cancels the lateness penalty**; the regulations have no such rule.
- **No clock-out = ½ day deduction**; the regulations have no such rule, and our `incomplete` state is the correct treatment.
- A **verbal** warning as the first step; the regulations say *written* warning.

**Lesson:** rules must come from the accepted regulations into dated policy parameters. They must never come from a prompt, a to-do list or the old code.

---

## 4. Weaknesses to avoid

The old app was far weaker than ours on all of the following. Each item names our control, so that new work does not regress it.

1. **One 163 KB route file, plus a second divergent copy of the API.**
   - The dev middleware in `vite.config.ts` re-implements about 110 routes with **different auth** (about 20 routes open), **different business logic** (one-level versus two-level leave approval; exemptions skipped in one copy only) and **different response shapes**.
   - What worked in dev was not what ran in production.
   - *Our control:* one router (`server.mjs`) calling domain modules. Tests run against the same code that serves. **Keep new HR rules inside domain modules** (`attendance*.mjs`, `leave*.mjs`, `payroll*.mjs`), never in route handlers.
2. **Routes registered after the 404 and SPA catch-all.**
   - Overtime, delegation, approvals and approval chains (`index.ts:2541-2902`) were dead code in production.
   - *Our control:* add a route-table test that every documented route answers something other than 404 for an authorised user.
3. **Identity taken from the request body or query.**
   - `employeeId` came from the client in check-in, leave, salary letters and personal info.
   - `approvalLevel` came from the client in approvals.
   - *Our control:* the actor is always `currentUser(db, supplied)` from the session. Keep it that way for location punches (P1-03).
4. **Role derived from strings.**
   - "Manager" meant a job title containing مدير. "HR" meant a department name match or a user ID containing "hr".
   - *Our control:* capabilities in `access.mjs` with `holds()`, and manager links in `users.manager_id`.
5. **Authentication that doesn't authenticate.**
   - Password = employee ID (a regression of a "fixed" item).
   - Predictable default passwords.
   - Plaintext passwords in source.
   - *Our control:* scrypt, the `must_change_password` gate, lockout and TOTP. Add a test that no fixture or seed ships a usable default password.
6. **Master data and salaries in `client/src/data/*.json`**, read by the server and at risk of being bundled into the client.
   - *Our control:* everything lives in the database, pay is visible only to explicit capability holders, and pay amounts stay out of the audit log.
7. **Errors swallowed and success still returned.**
   - Examples: `portal-leave-request`, `portal-request`, many `catch(e){}` blocks.
   - *Our control:* `fail()` with a status and code; writes require a transaction (`writing(db)`). Never return `success` from a catch block.
8. **No transactions.**
   - Leave-balance updates, approval-chain replacement and the check-in with its alerts are each several statements with no transaction.
   - *Our control:* `db.isTransaction` is required for writes, and `once` / idempotency keys are used.
9. **Hand-patched data.**
   - `todo.md` records: <br>• contracts bulk-renewed <br>• dates rebased so penalties start on 2025-05-01 <br>• attendance deleted after 2025-05-16 <br>• default exemptions seeded by name <br>• one person's tasks pre-filled into the weekly plan <br>• passwords initialised for everyone.
   - *Our control:* data changes go through the domain functions, which are audited and approved by two people; seeds are labelled synthetic (`environment:'synthetic'`). **Any real-data import (P2-06) must be a reviewed, reversible import run, not a script.**
10. **Tables created lazily inside handlers** (`CREATE TABLE IF NOT EXISTS` / `ALTER TABLE … IF NOT EXISTS` on each call).
    - *Our control:* numbered migrations with triggers and CHECK constraints.
11. **Penalties computed from free text.**
    - Deduction days were parsed out of the Arabic `action_taken` string. Violation dates were read from `notes` with a regex.
    - *Rule for P1-01:* store the violation type code, occurrence number, penalty code and amount in basis points or days as typed columns.
12. **Automatic penalties with no due process.**
    - The old engine produced deductions straight from attendance.
    - *Our control:* HR-03 ("no automatic deduction") and the two-person absence flow. Keep both; the regulations *require* due process anyway (Art. 117).
13. **Client-asserted anti-fraud.**
    - The mock-location flag and device fingerprint came from the browser.
    - *Rule for P1-03:* compute distance on the server, store the accuracy, and treat device signals as hints for review, never as proof.
14. **Personal-data excess.**
    - Full dependant ID numbers, raw GPS coordinates kept indefinitely, and LLM "sentiment" scores on employees.
    - *Our control:* document numbers masked to the last 4 digits, and no sentiment feature (COMPARISON §8). For P1-03, store the zone ID, distance and accuracy, and purge raw coordinates after a short, owner-approved retention period.
15. **HTML e-mail built from unescaped values.**
    - *Rule for P1-06:* escape every variable, and use plain-text alternatives.
16. **Timers in the web process with no record that they ran** (`setInterval(24h)`).
    - *Our control:* `jobs.mjs` with backoff. Register real handlers and record each run.
17. **Fake data presented as analytics** (hard-coded KPIs sent to the LLM).
    - *Our control:* reports are computed from records, and synthetic data is labelled.
18. **A regulations summary pasted into the prompt.** It drifted from the source (§3.9).
    - *Our control:* `ai.mjs` `policy_answer` cites accepted policy paragraphs or refuses.

---

## 5. Prioritised adoption list

**Order of priority:**
1. Rules the regulations make mandatory, where getting them wrong costs money or legal exposure.
2. Daily-use gaps the old app had closed.
3. Nice-to-have depth.

**Gate for every item:**
- The rule values are prepared as a **draft policy** citing the article.
- They become effective only after the HR manager (`hr.policy.accept`) accepts them.
- The code refuses to act without an accepted policy, as `working_time` does today.

Each item's state stays at *proposed* until it is built, tested and accepted.

### P1: mandatory rules and core daily use

**P1-01. Violations register and penalty schedule (Table A, Art. 111–126)**
- **Build:**
  - A new policy kind `discipline_schedule`. Its parameters hold, for each violation code, the 4 occurrence penalties (warning / % of daily wage in basis points / days / loss of increment / dismissal), a disruption flag, and whether an additional deduction for the lost time applies. It also holds `repeat_window_days=180`, `monthly_fine_cap_days=5` and `limitation_days=30`.
  - A new module `app/discipline.mjs` with tables `violations` and `penalty_decisions`, and a migration.
  - The flow:
    1. **Candidates** come from attendance (a late band, early leave, an unexplained day that became a confirmed absence). A candidate is *never* a penalty by itself.
    2. HR proposes, with the violation code and the computed occurrence number within 180 days.
    3. The employee gives a statement. Above a 1-day fine, a written charge and minutes are required (Art. 117). Reuse the `proposeAbsence` / `stateAbsence` / `decideAbsence` pattern.
    4. A second person decides. The harshest-only rule (Art. 115) and the per-violation and monthly 5-day caps (Art. 116) are applied.
    5. Actions after the 30-day limitations are blocked (Art. 119/120).
  - Outputs:
    - a penalty notice through a letter type (Art. 121)
    - a penalty sheet on the employee record (Art. 122)
    - a proposed `deduction` adjustment in payroll
    - a grievance link to `hr-cases` with a 30-day filing and 15-day answer clock (Art. 126).
- **Extend:**
  - `attendance.mjs` → `dayStates`: add `late_minutes` and `early_minutes`.
  - `hr-contracts.mjs` → `POLICY_KINDS`.
  - `payroll-extras.mjs` → `proposeAdjustment`.
  - `hr-cases.mjs`, `letters.mjs`.
  - `access.mjs`: new `hr.discipline.propose`, and `hr.discipline.decide` (sensitive).
- **Effort:** L
- **Acceptance criteria:**
  1. With no accepted `discipline_schedule`, nothing proposes violations.
  2. Four late arrivals of 10 min within 180 days produce occurrences 1–4 with warning / 5% / 10% / 20% of the daily wage. A fifth arrival 181 days after the previous one is occurrence 1 again.
  3. Two violations from one act produce only the harshest penalty.
  4. Fines above 5 days' wage in a calendar month are refused, with a clear message.
  5. A proposal above a 1-day fine cannot be decided without a charge text and either a statement or 3 days elapsed.
  6. The proposer cannot decide.
  7. A decision more than 30 days after the violation was proven is refused.
  8. A decided fine appears as a pending payroll deduction and on the employee's penalty sheet.
  9. The employee sees their own violations only; the manager sees their team's; the amounts are visible only to discipline and payroll capability holders.
  10. Tests cover every row of Table A that is marked certain; the uncertain "additional deduction" rows stay disabled until the HR manager confirms them from the signed PDF.

**P1-02. Statutory leave-type catalogue and sick-leave pay tiers (Art. 80–94, 102, 105)**
- **Build:**
  - A policy kind `leave_types`. Each type has:
    - a code
    - an entitlement (days, and calendar or working days)
    - a period (Gregorian year, per event, or once in service)
    - pay tiers (for example sick: 30 days at 10000 bp, 60 at 7500, 30 at 0, over a rolling window from the first sick day)
    - a required document (with the 2 MB PDF/image limit of `files.mjs`)
    - a minimum notice (exam: 15 days)
    - eligibility (unpaid: ≥ 365 days of service and zero annual and emergency balance; no annual leave during probation)
    - a half-day unit (emergency)
    - a routing threshold (unpaid ≤ 5 days → manager, otherwise → an executive step).
  - Seed a **draft** from the regulations with article citations.
  - Payroll consumes the partial-pay days, like `confirmedUnpaidDays` but at a rate.
  - Unpaid leave beyond 20 days stops annual accrual and is excluded from end-of-service years.
  - Also close WIRING-SPEC §7 #26: `leave.mjs` should reserve against the accrued balance.
- **Extend:** `leave.mjs` (`createLeaveRequest`, `leaveAction`), `leave-accrual.mjs`, `payroll.mjs` → `computeLine`, `payroll-extras.mjs` → `computeSettlement`, `files.mjs`.
- **Effort:** L
- **Acceptance criteria:**
  1. A leave type that is not in the accepted catalogue is refused.
  2. A sick-leave request without a certificate cannot pass the manager step.
  3. A 100-day sickness produces 30 full-pay days, 60 days at 75% and 10 unpaid days in payroll, tested across a month boundary.
  4. An exam request fewer than 15 days before the exam is refused.
  5. An unpaid request from someone with remaining annual balance is refused; one over 5 days routes to an executive.
  6. Emergency leave accepts 0.5 days; a third day is allowed only as 2.5 + 0.5.
  7. Annual leave during probation is refused.
  8. The Eid holidays inside a sick leave are not counted.
  9. End of service excludes unpaid days beyond 20.
  10. Every value on screen shows its article number.

**P1-03. Location-verified punch (the need behind S05)**
- **Build:**
  - `attendance_sites` (name, lat, lng, radius, active, **mode `flag` or `block`**) through a two-person approval.
  - The punch accepts an optional `{lat, lng, accuracy}`.
  - The **server** computes the haversine distance and stores `site_id`, `distance_m`, `accuracy_m` and `within`.
  - Raw coordinates are purged after N days (owner decision; PDPL).
  - In `flag` mode, an out-of-zone punch is recorded and shown to HR as "needs review".
  - In `block` mode, it is refused, and the employee is pointed to a mission or a correction.
  - Approved missions and exemptions (P2-04) bypass the check.
  - Allow `geolocation=(self)` in `Permissions-Policy`, but only on the attendance screen.
  - No client "mock location" trust. A device hint may be stored for review only.
- **Extend:** `attendance.mjs` → `punch`, `dayStates`; `server.mjs` headers; `privacy.mjs` (register the processing purpose).
- **Effort:** M
- **Acceptance criteria:**
  1. The actor is the session user; there is no `employeeId` input.
  2. The distance is computed on the server; a spoofed `within:true` in the body is ignored.
  3. With no active site, behaviour is unchanged from today.
  4. In `flag` mode an out-of-zone punch succeeds and appears in the HR review list with the distance.
  5. In `block` mode it returns 403 with a pointer to missions or corrections.
  6. Accuracy worse than the configured limit is treated as "unverified", not as out of zone.
  7. Raw coordinates are gone after the retention period (tested with a clock).
  8. The privacy notice text exists before the feature flag can be turned on.

**P1-04. Permission (استئذان) and early leave as attendance objects (Art. 74(8), 75)**
- **Build:**
  - `attendance_permissions` (date, from, to, minutes, reason), approved by the direct manager or `hr.attendance.approve`, never by the requester.
  - `dayStates` treats approved permission minutes as excused: late or early minutes inside the permission are not a violation candidate for P1-01.
  - A policy parameter `permission_monthly_cap_minutes` (a value the HR manager decides; the regulations give none).
  - A same-day "late / absent notice" (Art. 75) that the manager can later accept as the excuse.
  - Retire the استئذان kind from the catalogue request `HR-ATTENDANCE-FIX`, or map it to this.
- **Extend:** `attendance-extras.mjs`, `attendance.mjs` → `dayStates`, `service-catalog.mjs`.
- **Effort:** M
- **Acceptance criteria:**
  1. An approved permission from 09:00 to 10:30 turns a 10:20 check-in from `late` to `present (permission)`.
  2. A pending permission does not.
  3. A request over the monthly cap is refused, with the remaining minutes shown.
  4. The requester cannot approve their own permission.
  5. The day's audit shows the permission ID.

**P1-05. Overtime per Art. 76–77**
- **Build:**
  - A prior **overtime assignment** (by manager, dated, hours, reason) with HR budget approval, as a workflow step through `approval_thresholds`.
  - Actual hours are recorded against the assignment.
  - `overtimeToPayroll` **computes a suggested amount** = hours × (actual hourly + 0.5 × basic hourly), from the active contract and `payroll_cycle.day_basis`, divided by the daily hours in `working_time`. The preparer can accept it, or override it with a written reason.
  - Caps enforced: 3 h a working day, 8 h on a holiday, 20 h a week, and annual overtime pay ≤ 6 × monthly basic.
  - A time-off-in-lieu option, with consent and a leave-ledger credit.
  - A block on overlap with an approved mission.
- **Extend:** `attendance-extras.mjs` (`requestOvertime`, `decideOvertime`, `overtimeToPayroll`), `payroll-extras.mjs`, `workflow.mjs` thresholds.
- **Effort:** M
- **Acceptance criteria:**
  1. Overtime without an approved assignment cannot be sent to payroll.
  2. For a contract of basic 6,000 + housing 1,500 + transport 500 on a 30-day basis with 8 h days, 2 hours suggest 2 × (8,000/240 + 0.5 × 6,000/240) = SAR 91.67 (the rounding rule comes from the accepted policy).
  3. A 4th hour on a working day, or a 21st hour in a week, is refused.
  4. Overtime on a mission day is refused.
  5. Choosing time off credits the leave ledger and creates no payroll adjustment.

**P1-06. Outbound delivery: notifications that are not about requests, plus e-mail (S27/S28)**
- **Build:**
  1. Allow `notifications` with a nullable `request_id` and a typed `subject_kind` / `subject_id`. This resolves WIRING-SPEC §7 #1.
  2. A `jobs.mjs` handler that drains the `outbox` (today it is permanently `blocked`) into a delivery log with retry and backoff.
  3. A zero-dependency SMTP submission client over `node:tls`, **off by default**, enabled only when the owner names a provider.
  4. Arabic right-to-left templates with **escaped** variables and a plain-text part, stored as approved templates like `letters.mjs`.
  5. Events: approvals waiting for me, decision on my request, penalty notice (Art. 121), document expiry, contract or probation ending, payslip available (a link only, never amounts).
- **Extend:** `workflow.mjs` → `notifyUser`, `jobs.mjs` (`registerHandler`), migration for `notifications`, `expiry.mjs`, `hr-contracts.mjs` alerts.
- **Effort:** M (L if SMS is added)
- **Owner decision needed:** the provider and the sender domain.
- **Acceptance criteria:**
  1. With delivery off, in-app notifications still appear for all the events.
  2. A notification for an absence works without a request.
  3. A value containing `<script>` renders as text in the email.
  4. A failed send is retried with backoff and ends as `failed` with the error.
  5. No email body contains salary amounts or document numbers.
  6. Every send is recorded in the delivery log (recipient, template, status).

**P1-07. The regulations as the assistant's source (S29 need, done safely)**
- **Build:**
  - Import the approved regulations as an HR policy document (a new `regulations` document kind) split into articles, accepted by the HR manager.
  - `policy_answer` then cites "Art. N".
  - Remove any hand-written rule summary from prompts.
- **Extend:** `hr-contracts.mjs` (a document policy), `ai.mjs` → `policyPassages`, `knowledge.mjs`.
- **Effort:** S
- **Acceptance criteria:**
  1. "كم إجازة الوضع؟" is answered with 12 weeks, citing Art. 105, not 10 weeks.
  2. "إجازة الحج؟" returns the refusal text, because the regulations have no such article.
  3. Superseded articles (101, 125) are marked replaced and are not cited.
  4. Before acceptance, the assistant refuses.

### P2: daily-use gaps and money rules

**P2-01. Travel allowance (انتداب) engine (Art. 63–65, 41, 77(9))**
- **Build:**
  - A `travel_per_diem` policy (grade × abroad/domestic, reduction factors ¼ and ½, distance thresholds 75/40/15 km, extension ≤ 14 days).
  - A mission gains a destination type, a distance, and "housing / transport provided" flags.
  - On approval, a per-diem is computed and proposed as an expense reimbursement or payroll allowance.
  - Grade comes from the contract.
- **Extend:** `attendance-extras.mjs` → `requestMission`, `decideMission`; `expenses.mjs`; `hr-contracts.mjs` (grade field).
- **Effort:** M
- **Acceptance criteria:**
  1. An employee on a 3-day domestic mission with housing provided gets 3 × 400 × ½ = SAR 600 proposed.
  2. A 60 km paved trip gets no per-diem.
  3. An extension over 14 days is refused.
  4. Overtime on those days is refused (Art. 77(9)).

**P2-02. Payroll deduction caps and pay rules (Art. 51, 116, 67, 48)**
- **Build:** add to `payroll-checks.mjs` → `preRunChecks` blocking checks:
  - loan or advance instalments ≤ 10% of wage
  - disciplinary fines ≤ 5 days' wage in the month
  - court deductions ≤ 25%
- Also:
  - a warning if housing ≠ 25% of basic (a policy parameter)
  - moving payday to the previous working day if it falls on a rest day
  - a rounding mode parameter (`round_up_riyal` or `half_up_halala`) chosen by the HR manager.
- **Extend:** `payroll-checks.mjs`, `payroll-extras.mjs` → `proposeAdvance` (limit the instalment size up front), `hr-contracts.mjs` `payroll_cycle`.
- **Effort:** S
- **Acceptance criteria:**
  1. An advance whose instalment exceeds 10% of wage is refused at request time.
  2. A run whose fines exceed 5 days for anyone cannot move to review.
  3. A payday on a Friday shows the Thursday date.

**P2-03. Dated working-time periods: Ramadan and daily limits (Art. 73(2), 74(2), 74(7))**
- **Build:**
  - `working_time` gains optional `periods: [{from, to, start, end, daily_hours}]` (Ramadan), without replacing the base policy.
  - `dayStates` uses the period that applies.
  - Add checks: presence over 11 h a day, and more than 5 h continuous work (only once breaks are recorded).
  - The Ramadan dates are proposed yearly by HR and approved by a second person.
- **Extend:** `hr-contracts.mjs`, `attendance.mjs` → `dayStates`, `attendance-extras.mjs`.
- **Effort:** S
- **Acceptance criteria:**
  1. During the accepted Ramadan period, the lateness threshold and the expected hours come from the period.
  2. Outside it, from the base policy.
  3. A presence span over 11 h appears on the HR board.

**P2-04. Attendance exemptions (S06, done right)**
- **Build:** `attendance_exemptions` (user ID only, reason, from, to, approved by a second person).
  - Exempt days show `exempt`, not `unexplained`.
  - Exempt staff are excluded from violation candidates.
  - No name matching.
- **Extend:** `attendance.mjs`.
- **Effort:** S
- **Acceptance criteria:**
  1. An exemption without an end date is refused, unless the policy allows open-ended exemptions.
  2. After it expires, days revert to normal states.
  3. The proposer cannot approve.

**P2-05. Employee-started dependant request (S16)**
- **Build:**
  - From the benefits screen, the employee proposes a dependant (relation limited to the Art. 5 family, which covers spouse and unmarried children; parents only if the benefits annex allows), with a document upload. HR decides.
  - Store the relation, birth date and a masked document reference only.
  - Fix the `:id` route defect (WIRING-SPEC §8.3).
- **Extend:** `benefits.mjs`.
- **Effort:** S
- **Acceptance criteria:**
  1. An employee can propose; only `hr.benefits.manage` can confirm.
  2. HR cannot confirm their own dependant.
  3. A full ID number in the reference field is rejected (6 or more digits).

**P2-06. Import of punches from an outside capture device (the need behind S03, without Zoho)**
- **Build:**
  - An import run: a CSV or XLSX of punches (employee code, date and time) is uploaded, validated (unknown codes, duplicates, future times), previewed, and approved by a second person.
  - It then writes `attendance_records` with a new `source='device'`. Existing self or correction records are never overwritten; conflicts are listed.
  - The whole run can be reversed.
- **Extend:** `attendance.mjs`, migration (the `source` CHECK), `files.mjs`, `xlsx.mjs` (read side).
- **Effort:** M
- **Acceptance criteria:**
  1. The same file imported twice changes nothing the second time.
  2. A conflict with a correction is reported and not applied.
  3. Reversing the run restores the previous state exactly.
  4. Every imported row cites the run ID in the audit.

**P2-07. Scheduled reminders (S26)**
- **Build:**
  - `jobs.mjs` handlers for: document expiry, probation ending (Art. 25: 14 days), contract ending, final-settlement deadline (Art. 50(2): 7 / 14 days), absence warnings at 10 consecutive or 20 intermittent days (Table A rows 15–16), and the leave return date (Art. 92).
  - Each run is recorded.
  - Delivery goes through P1-06.
- **Extend:** `jobs.mjs`, `expiry.mjs`, `hr-contracts.mjs`.
- **Effort:** S
- **Acceptance criteria:**
  1. Reminders fire once per event and lead time.
  2. A missed run catches up on the next start.
  3. No reminder fires before the owner accepts the lead-time settings.

**P2-08. Hours and lateness reporting (S04)**
- **Build:** extend R37 with:
  - late days and minutes
  - early-leave minutes
  - hours worked against the daily norm, including the shortfall and the share of days that met it (the old weekly-report metric)
  - permissions used.
- **Extend:** `reports.mjs` / `reports-more.mjs`.
- **Effort:** S
- **Acceptance criteria:**
  1. Totals match `dayStates` for the same month.
  2. The manager sees their team only.
  3. The export matches the screen.

**P2-09. Unified holiday calendar and annual holiday seed (Art. 81, 84)**
- **Build:**
  - One holiday source feeding both `leave_calendars` and `dayStates`.
  - Each year, HR proposes Eid al-Fitr (4 days), Eid al-Adha (4 days), National Day and Founding Day (22 Feb) with the weekend-compensation rule; a second person approves.
  - CEO extra days are limited to 5 a year.
- **Extend:** `attendance-extras.mjs` (`proposeHoliday`), `work-calendar.mjs`, `leave.mjs`.
- **Effort:** M
- **Acceptance criteria:**
  1. Approving a holiday changes both the leave working-day count and the attendance state.
  2. A sixth CEO day is refused.

**P2-10. Probation evaluation and confirmation (Art. 23–27)**
- **Build:**
  - The existing 14-day alert opens an evaluation form for the manager (recommend confirm / a different job / terminate). The confirmation is decided by an executive step.
  - A maximum of 180 days on `probation_days`.
- **Extend:** `hr-contracts.mjs`, `lifecycle.mjs`, `workflow.mjs`.
- **Effort:** S
- **Acceptance criteria:**
  1. A contract with probation over 180 days is refused.
  2. The evaluation is due 14 days before the end.
  3. Confirmation is recorded against the contract.

**P2-11. End-of-service wording decision and death case (Art. 36, 38(3))**
- **Build:**
  - Put both readings of Art. 36(2), the literal one and the Labor Law one (LL 84), side by side on the `end_of_service` policy screen, with a worked example, so the HR manager chooses.
  - Add a `death` end reason: the full month's wage plus the leave balance are paid to the heirs.
- **Extend:** `payroll-extras.mjs` → `computeSettlement`, `END_REASONS`.
- **Effort:** S
- **Acceptance criteria:**
  1. For 7 years' service on a 10,000 wage, the policy screen shows 70,000 (literal: a full month for every year) against 45,000 (LL: 5 × ½ month + 2 × 1 month).
  2. The chosen reading is the one computed.

### P3: depth

**P3-01. Competency framework and skills matrix (S23)**
- **Build:**
  - Competencies grouped by category with a level scale.
  - Assessed levels per employee: the assessor is the manager or HR, never the employee alone.
  - Target levels per job.
  - The gap feeds `development_goals` and succession readiness.
- **Extend:** `talent.mjs`, `career-profile.mjs`.
- **Effort:** M
- **Acceptance criteria:**
  1. A self-assessment is stored separately from the manager's assessment.
  2. Gap = target − manager level.
  3. Visible to the employee, their manager and HR only.

**P3-02. Key results on objectives (S22)**
- **Build:** measurable key results under `governance` objectives (company) and team or individual goals, with dated progress check-ins and no fixed count of 3. Progress never changes pay by itself (TAL-10).
- **Extend:** `governance.mjs`, `talent.mjs` → `setGoal`.
- **Effort:** M
- **Acceptance criteria:**
  1. A key result links to a parent objective.
  2. Each progress update keeps its history.
  3. The rollup equals the weighted children.

**P3-03. Choice and yes/no questions in pulse cycles (S20)**
- **Build:** extend `QUESTION_KINDS` with single-choice and yes/no, under the same respondent floor and suppression rules.
- **Extend:** `engagement.mjs`.
- **Effort:** S
- **Acceptance criteria:**
  1. Choice results are suppressed below the floor, like scale results.
  2. No per-person answer is readable by anyone.

**P3-04. Bilingual letters (S11)**
- **Build:** an English, or Arabic + English, variant of each letter type, with `addressee_en`, approved like the Arabic template.
- **Extend:** `letters.mjs`.
- **Effort:** S
- **Acceptance criteria:** an English salary letter prints with the same verification code and the computed salary.

**P3-05. A named person as an approval step (S15)**
- **Build:** allow a `specific_user` step, with an optional fallback, for request types where the regulations name a role holder (for example, the authority-holder decisions in §3). The beneficiary rule and escalation still apply.
- **Extend:** `workflow.mjs` (`STEP_ROLES`, `planApprovals`).
- **Effort:** S
- **Acceptance criteria:**
  1. If the named person is the beneficiary, the fallback takes the step.
  2. If the named person is deactivated, the request goes to the fallback, not to nobody.

**P3-06. Increment, promotion and reward eligibility (Art. 56, 58–62)**
- **Build:** eligibility checks on compensation proposals:
  - a rating of at least "average" and a full year since the last increment
  - "above average" plus a vacancy for promotion
  - a cash-reward cap of 4 months
  - non-cash leave rewards of up to 5 days
- **Extend:** `compensation.mjs`, `payroll-extras.mjs` (bonus cap).
- **Effort:** S
- **Acceptance criteria:**
  1. An ineligible proposal needs a written exception reason.
  2. A bonus over 4 months' wage is refused.

**P3-07. Training bond (Art. 42–45)**
- **Build:** an optional service obligation on approved training (a period equal to the training period) with the cost. On resignation within the period, `computeSettlement` shows the repayable amount for the HR manager to decide.
- **Extend:** `talent.mjs` → `trainingAction`, `payroll-extras.mjs`.
- **Effort:** S
- **Acceptance criteria:** the settlement lists the bond and its computation, and deducts nothing without an explicit decision.

**P3-08. Resignation clock and rehire rules (Art. 14, 34, 37)**
- **Build:**
  - A resignation request that is deemed accepted after 30 days unless deferred (up to 60 days, with a reason), and that is blocked while an HR case or discipline investigation is open.
  - A warning at rehire if the Art. 14 conditions fail.
- **Extend:** `lifecycle.mjs`, `people.mjs`.
- **Effort:** S
- **Acceptance criteria:**
  1. At 30 days with no decision, the request shows as accepted.
  2. A resignation during an open investigation is refused.

**Not adopting:**
- Zoho sync and OAuth (S03).
- The separate employee login (S02).
- LLM sentiment scoring of employees and LLM "analytics" over fabricated KPIs (S29).
- Personal-tool tables (S25).
- Client-asserted mock-GPS and device-sharing alerts as evidence.
- Automatic penalties with no statement and second-person decision.
- Non-medical benefits catalogue, until the regulations' Annex 1 is supplied (Art. 70).

---

## 6. Open points for the owner and the HR manager

1. Confirm the uncertain readings of the penalty table from the signed PDF:
   - which rows the "additional deduction" column covers
   - whether row 11 includes the day's deduction.
2. Choose the Art. 36(2) end-of-service reading: literal, or Labor Law 84 (P2-11).
3. Location punch (P1-03):
   - `flag` or `block` mode
   - the retention of raw coordinates
   - the privacy-notice text.
4. Choose an e-mail provider and sender domain, or keep delivery in-app only (P1-06).
5. Set the values the regulations leave undefined:
   - grace minutes
   - monthly permission cap
   - payday
   - notice-period days
   - rounding rule
   - annual leave in calendar or working days, per type.
6. Supply the benefits matrix (Annex 1) and the authority matrix referred to in Art. 5 and Art. 70.
7. The files listed in §0 that are still in Drive. When they arrive, re-check this report for:
   - S09: `tasksDb` / `penaltyEngine`
   - S12: `salaryDocuments`
   - S28: `notificationsDb`
   - S30: `hcmRoutes`
