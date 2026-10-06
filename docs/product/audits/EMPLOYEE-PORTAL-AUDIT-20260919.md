# Employee portal audit — 19 September 2026

**Scope.** Everything an ordinary employee (role `employee`, no extra grants) can see and do in the 3,6T platform. Managers, HR and admins are out of scope except where they act on the employee's requests.

**Method.**
1. A code read of the shell, the portal, the service catalog, request intake, workflow and every self-service module.
2. A live walk-through on a throwaway instance (port 3660) with a freshly seeded synthetic database, driven by headless Chromium through the DevTools protocol, in the Classic light design, Arabic, at desktop size (1440×900) and phone size (390×844).

**Status vocabulary.** This follows the owner's reporting rule. "Real" means built locally and exercised in this walk-through. It does **not** mean accepted by the process owner; no screen here has that acceptance yet. "Partial" means built, but blocked or incomplete for an employee. "Placeholder" means an empty, readiness-only or not-relevant screen for this role.

**Evidence tags.**
- **[live]**: reproduced in the browser or through the API in this session.
- **[code]**: confirmed by reading the code, with the file and line given. Not reproduced live.

Screenshots are in `work/design-verify/portal-audit/`.

---

## 0. Summary

| | Count |
|---|---|
| Screens in an ordinary employee's menu | **49** (plus 6 more that open by typing the URL) |
| Catalog services offered to the employee | **142** across 16 departments; not filtered by role |
| Bugs logged | **35**: 1 critical, 6 high, 15 medium, 13 low. 26 reproduced live (some also traced in code), 9 confirmed in code only |
| Gaps against best-in-class self-service and Saudi practice | **22** |
| Quick wins (small, contained changes) | **18** |
| Screenshots | **55** key screens, plus 58 in the menu sweep (`sweep-*.png`) |

**Verdict.** The generic request engine is the strongest part of the portal. You pick a service, save a draft and submit it. The approval route is predicted, the due date is counted in working days, the timeline is audited, the requester can rate the service and ask to reopen it, and the phone layout holds up.

Around that engine, the employee experience is broken in several places:
- **One security leak.** An employee can open other people's report snapshots.
- **Leave cannot be requested out of the box.**
- **The balance shown on the two dashboards is wrong.**
- **Policy acknowledgement fails from the screen.**
- **Most HR modules never notify the employee.**
- **Several things duplicate each other.** Three overlapping dashboards, 13 catalog services that duplicate dedicated modules with different approval chains, a 49-item menu that includes internal development pages, and an English mode that stops at the menu.

### Top 10 issues and gaps (ranked by severity × reach)

| # | Issue | Type | Severity |
|---|---|---|---|
| 1 | Any employee can list, open and export report snapshots that other people saved, including data she is not allowed to see (B1) | Security | Critical |
| 2 | Any employee can **approve** another person's report snapshot, and it appears as a decision in her inbox (B2) | Separation of duties | High |
| 3 | Leave cannot be requested out of the box: calendars can only be created by a script, balances are manual "synthetic" openings, and the catalog has no leave service (B3, G2) | Core service missing | High |
| 4 | The leave balance shows **0** on الرئيسية and a blank number on ملخصي (B4) | Wrong data | High |
| 5 | Leave, expense, letter, attendance, HR-case and training decisions send **no notification**; the notifications page shows generic "تحديث على طلبك" rows with no title (B6, B7) | Notifications | High |
| 6 | Policy acknowledgement cannot be submitted from the screen because of the checkbox bug (B5) | Broken flow | High |
| 7 | There is no single "my requests" view: leave, expenses, letters, HR cases and training are missing from «أين طلباتي» and «الطلبات» (G5) | Gap | High |
| 8 | 13 catalog services duplicate dedicated modules with different approval chains, for example «مطالبة مصروفات» in the catalog vs «مصروفاتي وعهدي» (G7) | Friction and data split | High |
| 9 | Employees cannot see their own profile (ID or Iqama, bank, dependents, joining date); «السجل الوظيفي» returns 403 (G1) | Gap | High |
| 10 | The menu is overloaded (49 items, 3 overlapping dashboards) and exposes internal pages such as «نطاق المنصة» and «تطوير الخدمات» (B12, B13) | Clarity | Medium |

---

## 1. Inventory

### 1.1 What the employee is allowed to do

`app/access.mjs` gives every non-admin six capabilities: `portal.use`, `requests.use`, `org.view`, `leave.use`, `search.use` and `requirements.view`. The menu (`shell()` in `app/static/app.mjs:73-199`) is built from these plus role checks:
- `staff`: anyone who is not an admin
- `delivery`: employee, manager or pm

In the live session the employee's menu had 49 entries in six groups: مساحتي 23, الطلبات والخدمات 7, الموارد البشرية 5, العملاء والحملات 4, المشاريع والإنتاج 5, القيادة والحوكمة 4, and إدارة المنصة 1. Screenshot: `01-home-desktop.png`.

### 1.2 Screens and services

"Reached from" is the menu group › menu label. **Approvals**: M = line manager, HR = HR officer, F = finance.

| # | Service (Arabic as shown) | Reached from | What the employee can do | Backing module / main routes | State | Approvals |
|---|---|---|---|---|---|---|
| 1 | الرئيسية | مساحتي › اليوم; tab bar | Read-only cards: decisions, open requests with time left, tasks, leave balance, most-used services, expiring documents | `home-ui.mjs` → `home.mjs`, GET `/api/home` | Real, with bugs B4 and B8 | — |
| 2 | ملخصي | مساحتي; tab bar (default tab on phone) | Greeting, "ابدأ طلبًا جديدًا", 3-step tour, 4 tiles, quick services, "خدمات إدارتي", open requests, tasks, leave balance | `portal-ui.mjs` → `routing.portal`, GET `/api/portal` | Real, with bug B4. Overlaps with الرئيسية and مهامي | — |
| 3 | بانتظار قراري | مساحتي; tab bar «قراراتي» | Cross-module list of anything waiting for the user's decision | `inbox-ui.mjs` → `inbox.mjs` | Real. Leaks report approvals to employees (B2) | — |
| 4 | أين طلباتي | مساحتي | Per request: who holds it, what is awaited, expected date; reopen and experience question | `request-transparency-ui.mjs` → `request-timeline.mjs`, `request-closure.mjs` | Real, **generic catalog requests only** (G5) | — |
| 5 | مهامي | مساحتي; tab bar | Assigned tasks plus a personal to-do list (today / this week / later) | `work-ui.mjs` → `workspace.mjs`, `/api/work` | Real | — |
| 6 | الإشعارات | مساحتي | List, open the request, mark as read | built into `app.mjs:255-257` → `workflow.notifications` | Partial: generic-request events only, generic text (B6, B7) | — |
| 7 | الإعلانات | مساحتي | Read and acknowledge announcements; events calendar | `engagement-ui.mjs` → `engagement.mjs` | Real (empty until HR publishes) | — |
| 8 | حضوري | مساحتي › شؤوني | Clock in or out on server time; ask for a correction (up to 45 days back), a work mission, or overtime (15–720 min); reply to a proposed unpaid absence | `attendance-ui.mjs` → `attendance.mjs`, `attendance-extras.mjs` | Real. No working-time policy, so days are never late or absent | Correction: M or HR. Mission and overtime: M, or `hr.attendance.approve`, **which no role has** (B32) |
| 9 | إجازاتي (page heading «الإجازات والأرصدة») | مساحتي › شؤوني | Request leave from an existing balance (start, end, reason), cancel, resubmit | `leave-ui.mjs` → `leave.mjs`, POST `/api/leave/requests` | **Partial.** Unusable until a calendar exists, and one can only be created by a script. HR must also add a "synthetic" opening balance (B3) | M → HR. No time target and no notification |
| 10 | ساعاتي | مساحتي › شؤوني | Log project hours in 15-minute steps (up to 31 days back) | `agency-ui.mjs` → `agency.mjs`, `/api/time` | Real | Per entry: M (a second system beside #42, B31) |
| 11 | مصروفاتي وعهدي | مساحتي › شؤوني | Expense claim: date, 7 categories, amount incl. VAT, receipt ref, purpose, optional custody or project; receipt file uploaded afterwards. Cash custody request | `expenses-ui.mjs` → `expenses.mjs` | Real (no money moves) | Claim: M → F approve → F post. Custody: F |
| 12 | خطاباتي (heading «خطابات الموظفين») | مساحتي › شؤوني | Request a letter from an approved template; print the issued letter with a QR verification code | `letters-ui.mjs` → `letters.mjs` | **Partial.** No approved templates out of the box, and `hr.letters.issue` belongs to no role, so nothing can be requested or issued (B15) | HR prepares → a different person issues |
| 13 | عقدي وراتبي (heading «العقود وبنود الراتب») | مساحتي › شؤوني | Read own contract and pay lines (basic, housing, transport) | `contracts-ui.mjs` → `hr-contracts.mjs` | Real, read-only | — |
| 14 | قسائم راتبي | مساحتي › شؤوني | Read own payslips from approved payroll runs; print | `payroll-ui.mjs` → `payroll.mjs` | Real, empty until a run is approved | — |
| 15 | الشكاوى والاستفسارات (heading «حالات الموارد البشرية») | مساحتي › مشاركتي | Raise a confidential case (5 categories, optional respondent who is then excluded); anonymous report with a one-time follow-up code; add info; withdraw | `hr-cases-comp-ui.mjs` → `hr-cases.mjs` | Real; line manager excluded (checked). No time target configured | Any `hr.cases.handle` holder who is not a party |
| 16 | السياسات المطلوب إقرارها | مساحتي › مشاركتي | Read a policy version and acknowledge it | `knowledge-access-ui.mjs` → `policy-acknowledgements.mjs` | **Broken in the UI** (B5) | — |
| 17 | استبيان النبض | مساحتي › مشاركتي | Answer anonymous pulse and eNPS questions | `engagement-ui.mjs` → `engagement.mjs` | Real; defaults to the lowest score (B17) | — |
| 18 | التقدير | مساحتي › مشاركتي | Send a recognition card tied to a company value | `engagement.mjs` | Partial: hidden until HR defines values | — |
| 19 | اللقاءات الفردية | مساحتي › مشاركتي | Schedule a 1:1 with own manager; agenda, follow-ups, private note | `feedback-ui.mjs` → `feedback.mjs` | Real | — |
| 20 | ملاحظات الزملاء (heading «التغذية الراجعة») | مساحتي › مشاركتي | Write feedback (3 visibility levels); request feedback | `feedback.mjs` | Real; privacy issue B18 | — |
| 21 | أمان حسابي | مساحتي › حسابي | Set up two-step verification (TOTP) | `security-ui.mjs` → `totp.mjs` | Real | — |
| 22 | المساعدون الذكيون | مساحتي › حسابي | Run assistants (employee assistant, development plan, policy Q&A) | `ai-ui.mjs` → `ai.mjs` | **Placeholder**: every card reads «الخدمة غير مفعّلة من الأدمن الأول» | — |
| 23 | المظهر | مساحتي › حسابي | Pick a design and theme | `appearance-ui.mjs` | Real | — |
| 24 | طلب خدمة / «طلب جديد» | الطلبات والخدمات; buttons on every dashboard | Browse or search 142 services, save a draft, attach files, submit, cancel, follow up after 24 h, rate, reopen | `request-picker.mjs` + `app.mjs` → `workflow.mjs`, `/api/catalog`, `/api/requests*` | **Real (strongest flow)**. See 1.3 | Per service. See 1.3 |
| 25 | الطلبات | الطلبات والخدمات | List own requests; filter by status; search | `app.mjs` → `workflow.listRequests` | Real (generic requests only) | — |
| 26 | الإدارات | الطلبات والخدمات | Same catalog browser, entered from departments | `app.mjs` | Real; duplicates #24 | — |
| 27 | بطاقات الخدمات | الطلبات والخدمات | Read published service cards | `service-cards.mjs` | Placeholder for an employee (0 published) | — |
| 28 | نواقص دليل الخدمات | الطلبات والخدمات | Admin report on catalog quality | `catalog-quality.mjs` | Placeholder for an employee | — |
| 29 | مراجعة المصادر | الطلبات والخدمات | Owner view for knowledge sources | `knowledge.mjs` | Placeholder for an employee | — |
| 30 | تطوير الخدمات | الطلبات والخدمات | Internal benchmarking research (17 units, 142 services) | `service-quality-ui.mjs` | **Internal page** shown to staff (B12) | — |
| 31 | انتهاء الوثائق | الموارد البشرية | Own expiring documents and fixed-term contract | `expiry-ui.mjs` → `expiry.mjs` | Real; row links go to a 403 page (B14) | — |
| 32 | مراجعة الرواتب | الموارد البشرية | Own approved raise recommendations | `compensation.mjs` | Real; the label suggests the employee reviews salaries | — |
| 33 | تقييم الأداء | الموارد البشرية | Self-review, acknowledge, appeal within 14 days | `talent.mjs` | Real (empty until HR opens a cycle) | Self → M → calibration → release |
| 34 | تقييم 360 | الموارد البشرية | Nominate raters, give ratings | `feedback.mjs` | Real (inside a cycle) | A third party approves the raters |
| 35 | التدريب والتطوير | الموارد البشرية | Training request (title, provider, type, hours, dates, purpose), development goals, career profile, qualifications | `talent.mjs`, `career-profile.mjs` | Real | M or `hr.performance.manage` |
| 36–41 | العملاء · الباقات · الحملات · تقويم المحتوى · قوالب المشاريع · حارس النطاق | العملاء والحملات; المشاريع والإنتاج | Client-team work; empty unless the employee is on a client team | `agency.mjs`, `campaigns.mjs` | Real for delivery staff; noise for back-office staff | Internal review by another person |
| 42 | كشفي الأسبوعي (heading «اعتماد كشوف الوقت») | المشاريع والإنتاج | Submit the weekly timesheet; correct a past entry | `resourcing-ui.mjs` → `timesheets.mjs` | Real; approver-oriented heading and tiles (B13) | M, only if M holds `timesheets.approve` (B31) |
| 43 | أوراق الاستدعاء | المشاريع والإنتاج | Reply to a shoot call sheet | `production.mjs` | Real | — |
| 44 | المعدات وحجزها | المشاريع والإنتاج | See own equipment custody | `equipment.mjs` | Real, read-only | — |
| 45 | مركز التقارير | القيادة والحوكمة | Run R11 (projects), save a snapshot, schedule; open **others'** snapshots | `reports.mjs` | Real, with security bugs **B1 and B2** | Snapshot approval by "anyone but the creator" |
| 46 | الهيكل التنظيمي | القيادة والحوكمة | Departments, approvers, escalation, headcount | `org-ui.mjs` | Real (no people directory, G9) | — |
| 47 | المراكز التخصصية | القيادة والحوكمة | List of centres | `centres.mjs` | Placeholder (none active) | — |
| 48 | تقويم الالتزامات | القيادة والحوكمة | Obligations the employee owns | `compliance.mjs` | Real; empty for most staff | Verified by another person |
| 49 | نطاق المنصة | إدارة المنصة | The 220-requirement development scope register, most items «لم يبدأ» | `app.mjs` → `/api/requirements` | **Internal page** shown to every employee (B12) | — |
| — | البحث الشامل | URL `#search`, or Enter in «ابحث عن شاشة» | Text search over what the user may open | `search.mjs` | Real | — |
| — | التأمين والمزايا, التوظيف, المشتريات, التفويض | URL only | Empty boards with no data | various | Placeholder by URL | — |
| — | السجل الوظيفي | URL, and links from انتهاء الوثائق | 403 page with only «إعادة المحاولة» | `employees.mjs` | Dead end (B14) | — |

### 1.3 Catalog services an employee typically uses

Of the 142 services, 71 are in the corporate-services sector. The HR, admin and IT services below are the self-service core. "Target" is working days (`service_directory.target_days`).

**HR services** (every service here has a 3-day target)

| Code | Name as shown | Approval steps | Duplicates a module? |
|---|---|---|---|
| HR-LETTER | طلب خطاب وظيفي | M → HR | Yes, خطاباتي |
| HR-SALARY-CERT | تعريف بالراتب | HR | Yes, خطاباتي. **Tested live: completes with no document delivered** |
| HR-EXPERIENCE-CERT | شهادة خبرة | HR | Yes, خطاباتي |
| HR-ATTENDANCE-FIX | تصحيح حضور أو استئذان | M → HR | Yes, حضوري (there: M or HR) |
| HR-OVERTIME | اعتماد عمل إضافي | M → HR | Yes, حضوري |
| HR-PAYROLL-INQUIRY | استفسار أو تصحيح في الراتب | HR | — (tested live: validation) |
| HR-PROFILE-UPDATE | تحديث البيانات والوثائق الشخصية | HR | — (no profile screen to update, G1) |
| HR-BANK-CHANGE | تغيير حساب الراتب البنكي | HR | Payroll extras; employee has no access |
| HR-SALARY-ADVANCE | سلفة على الراتب | M → HR | Payroll extras; no repayment schedule shown |
| HR-BENEFIT-CLAIM | مطالبة مزايا أو تأمين طبي | M → HR | التأمين والمزايا, which says it stores no medical data |
| HR-DOC-RENEWAL | تجديد إقامة أو رخصة عمل أو تأشيرة | M → HR | انتهاء الوثائق |
| HR-GOSI-CORRECTION | تصحيح بيانات التأمينات الاجتماعية | HR | — (ends at GOSI, an outside party) |
| HR-GRIEVANCE | شكوى أو تظلم سري | HR | Yes, الشكاوى والاستفسارات. Checked live that the line manager cannot see it; there is no respondent exclusion |
| HR-RESIGNATION | استقالة وإخلاء طرف | M → HR | Lifecycle / clearance (HR only) |
| HR-EXIT-INTERVIEW | مقابلة خروج ونقل معرفة | M → HR | — |
| HR-REFERRAL | ترشيح مرشح (إحالة موظف) | HR | — |
| HR-RETRO-ADJUSTMENT | تسوية مالية بأثر رجعي | M → HR | — |
| HR-HIRING-NEED · HR-JOB-CHANGE · TAL-SUCCESSION | managers' services | M → HR / HR | Offered to every employee (G8) |
| TAL-TRAINING · TAL-PERFORMANCE-REVIEW | تدريب · مراجعة تقييم | M → HR | Yes, التدريب والتطوير and تقييم الأداء |

**Admin, finance and IT services**

| Code | Name as shown | Approval steps | Target | Duplicates a module? |
|---|---|---|---|---|
| ADM-EXPENSE-CLAIM | مطالبة مصروفات | M → head of the CEO office | 5 | **Yes, مصروفاتي وعهدي**, whose chain is M → finance |
| FIN-CUSTODY | طلب عهدة نقدية أو تسويتها | M → finance head | 7 | Yes, مصروفاتي وعهدي |
| ADM-TRAVEL, ADM-VEHICLE, ADM-ROOM-BOOKING, ADM-MAINTENANCE, ADM-SUPPLIES, ADM-ACCESS-CARD, ADM-VISITOR, ADM-WORKSPACE | travel, car, room, maintenance, supplies, card, visitor, desk | M and/or head of the CEO office | 2–5 | — |
| IT-SUPPORT, IT-PASSWORD-UNLOCK, IT-DEVICE, IT-SOFTWARE, IT-ACCESS, IT-OUTAGE, IT-SECURITY-INCIDENT, IT-PLATFORM-FEEDBACK | IT services | M → IT, or IT only | 1–2 | — |

The catalog has **no leave service**. Searching «إجازة» returns 22 unrelated HR services and no link to إجازاتي (`41-catalog-search-leave.png`).

---

## 2. Walk-through log

**Environment**
- Port 3660. The database was created in a new temp folder under the scratchpad with `scripts/seed.mjs`, a random field key and random passwords that were never printed.
- Sessions were created in-process for `employee`; `manager`, `hr` and `head-hr` sessions were added only to act on her requests.
- Tokens were kept in a 0600 file. Appearance was set to Classic and light through the employee's own appearance setting, which is what the design picker writes. Language was Arabic.
- The live DB and ports 3600, 3601 and 3630 were not touched.
- At the end the server was stopped and the temp DB, field key and token file were deleted.

**Two passes**
- **Pass A (bare seed, 3 services).** Menu sweep of all 49 entries plus 10 URL-only routes: text, actions, console and HTTP errors, one screenshot each (`sweep-NN-*.png`).
  - No JavaScript exceptions.
  - 403 on `#employees`, `#vendors`, `#finance` and `#payables`, reached by URL only.
  - On the bare seed the employee cannot request leave (no calendar) or a letter (no template).
- **Pass B (the pilot shape).** The same seed plus `installServiceCatalog` (142 services, as `scripts/init-pilot.mjs` does), `expandDemo` (a synthetic leave calendar) and `seedHrDemo` (an approved contract for the employee). All journeys below ran on pass B.

| Step | What I did as the employee | What happened | Screens |
|---|---|---|---|
| 1 | Opened الرئيسية and ملخصي | Both load. Home opens with a paragraph of disclaimers and tells an employee «مصادر خارج صلاحيتك لم تُحتسب هنا: مستحقات العملاء، أوامر الدفع، الدفتر المالي». ملخصي lists 6 "most used" services before any use, while الرئيسية says «لا طلبات سابقة لك بعد، فلا نقترح قائمة ثابتة» — the two dashboards contradict each other | `01`, `02`, `03` |
| 2 | «ابدأ طلبًا جديدًا» → launcher | 142 services, 16 departments, sectors, "most requested", own-department services with route and target («مديرك ← تنفيذ · 5 أيام»). Headline «وش تحتاج اليوم؟» is in dialect while the rest is formal | `04` |
| 3 | Searched «إجازة» | 22 HR services unrelated to leave; nothing points to إجازاتي | `05`, `41` |
| 4 | Opened استفسار أو تصحيح في الراتب and pressed «حفظ المسودة» without filling in the required fields | A draft is saved with every required field empty; the page shows «لم يُستكمل» everywhere and «النسخة المقدمة 0» | `06`, `07`, `08` |
| 5 | «تقديم للاعتماد» on that draft | Rejected with one field at a time: «الحقل مطلوب: شهر المسير» | `09` |
| 6 | Quick service تعريف بالراتب: filled in and saved, then submitted with a note | Status قيد الاعتماد, chip «يستحق 22/09/2026» (3 working days from Saturday), route «معتمدة خدمات الموظف». The employee got **no receipt notification**; HR got `approval_needed` | `10`, `11`, `12` |
| 7 | HR approved, took it for execution and completed it with a note (through the API) | The employee received 3 notifications (`decision_updated`, `execution_started`, `execution_completed`). All three render as the same «تحديث على طلبك» with no title and no outcome | `13` |
| 8 | Opened the completed request | Timeline of 5 events (dates only, no times); approval route shown; the rating card appears. **No document is attached**: HR's note says a PDF was handed over, but the employee has nothing to download | `14` |
| 9 | Rated 4/5 | Saved, but the timeline shows it as «إجراء آخر» / "Other action" | `15` |
| 10 | أين طلباتي, الطلبات | Correct lists. The draft counts as «ينتظر ردك أنت». The completed request shows «عند: —» and «مهلة إعادة الفتح لم يحددها مالك الإجراء بعد؛ لا تفترض المنصة مهلة لم يقررها أحد». Home shows the draft as «null يوم عمل متبق» | `16`, `17` |
| 11 | Switched to English | The menu, request page and notifications translate. ملخصي, الرئيسية, إجازاتي and every module stay Arabic; field labels and values stay Arabic; some timeline labels stay Arabic | `18`, `19`, `20`, `20b` |
| 12 | إجازاتي before HR setup | «لم يُضف رصيد افتتاحي في نطاقك بعد… يضيف HR رصيدًا مصطنعًا صريحًا» and no request button. The page is headed «بيانات مصطنعة للتطوير المحلي» | `sweep-08-leave` |
| 13 | HR added a 21-day opening (API); I then requested 1–8 Oct from إجازاتي | Form: start, end, reason; the leave type is the raw code «annual». Submitted: 6 working days reserved, 15 available, «بانتظار المدير» | `21`, `22`, `23` |
| 14 | Manager approved, then HR approved (API) | Status «معتمد محليًا», 15 days left. **No notification at any stage.** الرئيسية shows the leave card as **0** and the line «سنة 2026 · المتبقي يومًا»; ملخصي shows «يومًا» with no number. The leave does not appear in أين طلباتي. The employee can still cancel it | `24`, `25`, `26` |
| 15 | مصروفاتي وعهدي → «مطالبة مصروف» (230 SAR, hospitality, receipt INV-7781) | Saved as «بانتظار المدير المباشر». The amount field is a text input; the receipt image is uploaded afterwards from the claim card. No notification | `27`, `28` |
| 16 | حضوري → «تسجيل الحضور الآن» | Clock-in recorded at 16:47 Riyadh time; the button changes to «تسجيل الانصراف الآن». «لا توجد سياسة ساعات عمل معتمدة», so lateness is not judged | `29` |
| 17 | الشكاوى والاستفسارات → «رفع حالة» (استفسار) | Filed. «لا مدة مستهدفة محددة · لم تُسند بعد». The respondent picker lists every employee including the CEO. Filed the same topic as the catalog service HR-GRIEVANCE: the line manager and head of HR get 404 and HR sees it — the confidentiality holds | `30`, `31` |
| 18 | خطاباتي | «أنواع بلا قالب معتمد بعد، فلا يمكن طلبها: تعريف بالراتب، تعريف بالعمل…», so there is no action. The same letters are offered in the catalog | `32` |
| 19 | عقدي وراتبي, قسائم راتبي | Contract readable (10,500 SAR, Hijri start date, approvers named). The page points to «تحديث البيانات» and «استفسار الراتب», which are not the catalog names and are not links. No payslips yet | `33` |
| 20 | التدريب والتطوير → «طلب تدريب» | A clear form (for whom, title, provider, type, hours, dates, purpose) | `34` |
| 21 | «كيف تستخدم المنصة؟» | The 3-stop tour works | `35` |
| 22 | Security probe: the manager created a project the employee is not on and saved an R11 snapshot | The employee **sees and opens** the snapshot (project «مشروع سري للعميل س») even though `/api/projects` returns `[]` for her. The snapshot appears in her «بانتظار قراري» as «اعتماد», and she **approved it** («معتمدة من الموظفة التجريبية») | `36`, `37` |
| 23 | Typed `#employees` (also the target of the انتهاء الوثائق links) | «لا يوجد تصريح لهذه الشاشة…» with only «إعادة المحاولة» | `38` |
| 24 | نطاق المنصة, كشفي الأسبوعي | The development scope register is visible to staff; the timesheet page is headed «اعتماد كشوف الوقت» with manager tiles | `39`, `40` |
| 25 | Phone 390×844: الرئيسية, ملخصي, the menu sheet, launcher, form, request, إجازاتي, حضوري, الطلبات, الإشعارات, المصروفات, العقد | No sideways scrolling on any screen (checked by script). There is a bottom tab bar (ملخصي · الرئيسية · مهامي · قراراتي · الفهرس), the request table turns into cards, and the form has sticky actions. But the leave request button sits below two disclaimer panels; the tab bar has no "new request" or "my requests"; and the avatar shows «ا», which reads as "I" | `m01`–`m12` |

---

## 3. Bugs

Severity is Critical, High, Medium or Low. Each bug says whether it was confirmed [live] or in [code].

### Critical

**B1. Report snapshots leak across people and scopes. [live]**
- **Where:**
  - `app/reports.mjs:110-111`: the list filters only by `byKey.get(s.report_key)?.allowed(db,u)`.
  - `app/reports.mjs:122-125`: `readSnapshot` calls `definition(db,u,s.report_key)` and never checks the creator's scope.
  - R11 is allowed to every non-admin (`app/reports-more.mjs:82`).
- **Reproduce:**
  1. As the manager, create a project with only `outsider` as a member.
  2. As the manager, POST `/api/reports/R11/snapshots`.
  3. As `employee`, GET `/api/reports`: the snapshot is listed.
  4. As `employee`, POST `/api/reports/snapshots/<id>/open`: the rows include «مشروع سري للعميل س», even though `GET /api/projects` returns `[]` for her.
  5. The `print`, `export.csv` and `export.xlsx` routes use the same check.
- **Impact:** any employee can read, print and export whatever a more privileged colleague (executive, client lead) saved in a report they both may run. Client-team reports R15 and R19–R22 are exposed the same way.

### High

**B2. Any employee can approve another person's report snapshot. [live]**
- **Where:** `reports.mjs:111` offers `approve_snapshot` to anyone who is not the creator, with no capability check; the decision inbox then collects it.
- **Reproduce:**
  1. Continue from B1.
  2. As `employee`, open «بانتظار قراري»: it shows «لقطات التقارير · اعتماد».
  3. POST `/api/reports/snapshots/<id>/approve_snapshot` with `{"note":"…"}`: 201, `status: approved`.
  4. The reports page shows «معتمدة من الموظفة التجريبية».
- **Impact:** snapshot "approval" is meaningless as a control.

**B3. Leave cannot be requested out of the box. [live + code]**
- **Where:**
  - Leave calendars are only ever inserted by `scripts/expand-demo.mjs:21-22`; no API or screen creates one.
  - Balances come only from an HR "synthetic opening" (`/api/leave/openings`), whose form defaults the type to `synthetic_annual`.
  - The catalog has no leave service.
- **Reproduce:** start a clean or pilot database (`scripts/init-pilot.mjs`) and open إجازاتي as an employee. It shows «لم يُضف رصيد افتتاحي…» and no button.
- **Impact:** the most-used employee service is not usable in the pilot.

**B4. The leave balance shows 0 on الرئيسية and a blank on ملخصي. [live]**
- **Where:**
  - `app/routing.mjs:131` maps `remaining:b.remaining_days`, but `leave.mjs` returns `available_days`.
  - `home.mjs` sums the same missing field.
- **Reproduce:**
  1. Give the employee a balance and approve a leave, leaving 15 days available.
  2. الرئيسية card «رصيد إجازتي» shows **0**, and its list reads «سنة 2026 · المتبقي يومًا».
  3. ملخصي «رصيد إجازاتي» shows «annual · سنة 2026 · يومًا».
- **Screens:** `25-home-leave-zero.png`, `26-portal-leave-blank.png`.

**B5. Policy acknowledgement cannot be submitted. [code]**
- **Where:**
  - `operationFields` renders every input with `value="${e(f.value??'')}"` (`app/static/operations.mjs:114-116`), so the checkbox has `value=""`.
  - `knowledge-access-ui.mjs:60` then sends `confirm:v.confirm==='on'`, which is always `false`.
  - The server requires `confirm===true` (`policy-acknowledgements.mjs:114`).
- **Reproduce:** HR opens an acknowledgement round → the employee ticks «اطلعت على نص هذه النسخة» and submits → 400 «أكّد اطلاعك على نص السياسة».
- **Also affected:** the influencer disclosure checkbox (`influencers-ui.mjs:170`).

**B6. No notifications from HR modules. [live for leave, code for the rest]**
- **Where:**
  - `notifications.request_id` is `NOT NULL REFERENCES requests` (`app/schema.sql:14`).
  - As a result, leave, expenses, letters, attendance, HR cases, timesheets, training and performance never notify anyone.
- **Reproduce:** submit leave → manager approves → HR approves. The employee's `/api/notifications` is unchanged throughout.
- **Impact:** the employee learns of decisions only by revisiting each screen. There is no email or SMS channel either («لا مزوّد بريد مربوط»).

**B33. Leave fails when the employee has no manager in the same department. [code]**
- Leave routing requires a same-department line manager and HR in the calendar scope; otherwise it fails with 409.
- Unlike the generic workflow, it has no escalation fallback.
- Ranked High because it will hit real reporting lines, such as a manager who sits in another department.

### Medium

**B7. The notifications page cannot be read. [live]**
- **Where:** `app.mjs:257` maps only `approval_needed`, `approval_escalated` and `ready_for_execution`. Every other kind shows «تحديث على طلبك» with a ✓ icon:
  - `decision_updated`, `execution_started`, `execution_completed`
  - `task_assigned` (sent to an assignee, not the requester)
  - `request_transferred`, `request_reopened`
- **Other problems:**
  - No request title, outcome (approved, returned, rejected) or time.
  - One request produced three identical rows.
  - No "mark all as read".
  - No confirmation on submit.
  - Cancelling a request notifies the person who cancelled it (`workflow.mjs:470`).
- **Screen:** `13`.

**B8. Home shows "null يوم عمل متبق" for drafts. [live]**
- **Where:** `app/home.mjs:37`, where `clock.days_left` is `null` for a draft.
- **Reproduce:** save any draft and open الرئيسية.

**B9. Required fields are not enforced in the request form. [live]**
- **Where:** `fieldInput()` (`app.mjs:275`) shows the red * but never adds `required`.
- **Reproduce:** «حفظ المسودة» with an empty form saves a draft. «تقديم للاعتماد» then fails with only the first missing field («الحقل مطلوب: شهر المسير»); fixing it reveals the next.
- **Screens:** `07`, `08`, `09`.

**B10. The rating shows as «إجراء آخر» / "Other action" in the timeline. [live]**
- **Where:** the audit action `service.feedback_recorded` (`service-feedback.mjs:29`) is not in the `actionLabel` map (`app.mjs:40`), which only knows `feedback`.
- **Also:** the Arabic-only entries in that map («إنشاء المسودة», «إضافة مرفق», …) appear in Arabic in English mode.

**B11. Catalog search finds nothing useful for «إجازة». [live]**
- Returns «22 خدمة مطابقة», which is the whole HR department, and nothing about leave.
- **Screen:** `41`.

**B12. Internal and admin pages appear in the employee menu. [live]**
- Because `requirements.view` is given to everyone, and other entries are not gated, every employee sees:
  - «نطاق المنصة» (220 requirements, mostly «لم يبدأ»)
  - «تطوير الخدمات»
  - «نواقص دليل الخدمات», «مراجعة المصادر», «بطاقات الخدمات» and «المراكز التخصصية», which are empty or admin-oriented
- **Screen:** `39`.

**B13. Page headings are written for administrators. [live]**
- `app.mjs:224` always uses `module.title`, so the nav label and page heading disagree:

  | Menu says | Page heading says |
  |---|---|
  | كشفي الأسبوعي | «اعتماد كشوف الوقت» |
  | إجازاتي | «الإجازات والأرصدة» |
  | الشكاوى والاستفسارات | «حالات الموارد البشرية» |
  | عقدي وراتبي | «العقود وبنود الراتب» |
  | ملاحظات الزملاء | «التغذية الراجعة» |
  | مراجعة الرواتب | «مراجعة التعويضات» |

- The timesheet page also shows approver tiles («أسبوع ينتظر قراري», «لم يرسلوا أسبوعًا منتهيًا»).
- **Screen:** `40`.

**B14. Dead ends. [live + code]**
- `#employees` shows a 403 message with only «إعادة المحاولة». The following all link there:
  - Own-document rows in انتهاء الوثائق (`expiry.mjs:70`)
  - The HR workspace links in the request picker (`request-picker.mjs:81-83`)
- The catalog's «خدمات التشغيل المتخصصة» cards (`app.mjs:248`) send employees to empty «المشتريات», «التوظيف» and «العروض» boards.

**B15. Letters: two paths, and neither delivers a letter. [live]**
- خطاباتي cannot be used until someone approves templates and grants `hr.letters.issue`, which no role has.
- The catalog's تعريف بالراتب completes with only a text note; nothing is attached for the employee.
- **Screens:** `14`, `32`.

**B16. English mode is shallow. [live]**
- `tr()` exists only in `app.mjs`. Every operation module, and ملخصي, الرئيسية, the request picker, service field labels, service names in lists and all server error messages, stay Arabic.
- **Screens:** `18`–`20b`.

**B18. Feedback visibility widens after it is written. [code]**
- **Where:** `feedback.mjs:146` resolves `recipient_manager` against the recipient's *current* `manager_id`.
- **Impact:** a new manager can read notes written under the old one. This contradicts the screen's own promise «لا تُوسَّع المرئية بعد الكتابة».

**B19. Separation-of-duties gap on expense claims. [code]**
- **Where:** `expenses.mjs:33-34`. When the claimant has no line manager, a finance user with `approve` can take both the manager step and the finance step.

**B20. Approved leave can be cancelled at any time, even after it has been taken, and the days are refunded. [code]**
- **Where:** `leave.mjs:55` allows `cancel` on `approved` with no date guard.

**B31. Two competing time-approval systems. [code]**
- `/time` entries are approved per entry by `manager_id`; `/timesheets` weeks by a manager holding `timesheets.approve`.
- A line manager whose role is `hr` or `it` can never approve a week.

**B32. Attendance mission, overtime and unpaid-absence decisions can get stuck. [code]**
- These need `hr.attendance.approve`, which no role holds by default. With no line manager, they stay unresolved.

### Low

- **B17. Pulse answers default to the lowest score. [code]** The pulse survey selects have no blank option, so an untouched question submits 1 (or 0 for eNPS) (`engagement-ui.mjs:98`).
- **B21. Executors are not told when a request is ready. [code]** After the final approval of a multi-step chain, `ready_for_execution` is not sent (`workflow.mjs` ~458 vs ~466).
- **B22. Arabic number agreement. [live]** «3 خدمة», «10 خدمة», «3 خدمة في 3 إدارة», «3 موظفًا», «1 إدارات», «15 يوم», «6 يوم عمل», «1 طلبًا سابقًا».
- **B23. Empty optional fields look unfinished. [live]** They show as «لم يُستكمل» ("not completed"), which reads like an unmet obligation. Use «—».
- **B24. Request references are not human-friendly. [live]** Requests are identified by UUID fragments (`1d9713b2`), and a draft shows «النسخة المقدمة 0».
- **B25. Leave type shown as a raw code. [live]** «annual» (and `synthetic_annual` in HR's form); there are no Arabic leave-type names.
- **B26. Wrong avatar initial. [live]** The initial is taken from «ال», so «الموظفة التجريبية» shows «ا», which looks like "I".
- **B27. Expense form friction. [live]** The amount is `type="text"`, so phones show no number keypad, and the receipt image can only be uploaded after submitting.
- **B28. Contract page points to services that don't match. [live]** It names «تحديث البيانات» and «استفسار الراتب», which do not match the catalog names and are not links.
- **B29. Home copy is written for auditors, not employees. [live]** «صفحة قراءة فقط: كل رقم فيها مشتق من مصدره لحظيًا…», and it lists finance ledgers the employee cannot see.
- **B30. The two dashboards disagree. [live]** ملخصي calls a fixed list «خدماتي الأكثر استخدامًا»; الرئيسية computes the real one from usage.
- **B34. Timelines show dates without times. [live]** Same-day events cannot be ordered by eye, and service-level tracking is harder.
- **B35. Mixed tone in the new-request dialog. [live]** «وش تحتاج اليوم؟» is dialect while everything around it is formal Arabic. Pick one voice.

(B-numbers are not strictly consecutive, because code-only items were merged in after the live pass. Total: 35 distinct bugs.)

---

## 4. Gaps

Measured against best-in-class employee self-service (Workday, BambooHR, Rippling, SAP SuccessFactors) and the Saudi HR platforms Jisr, Menaqa and ZenHR, plus Saudi labour-law realities. Ranked by impact.

1. **G1. No "my profile".** The employee cannot see or request changes to their own record: national ID or Iqama and expiry, passport, national address, emergency contacts, dependents, IBAN, joining date, grade or job title, manager. Every Saudi HR platform opens with this page. «السجل الوظيفي» is 403 for employees.
2. **G2. Leave is not modelled on the Labour Law.**
   - No leave types: annual (21 days, 30 after 5 years), sick (paid-in-full, three-quarters and unpaid tiers), maternity, paternity, marriage, bereavement, Hajj, exam, iddah and unpaid.
   - No accrual visible to the employee.
   - No public-holiday calendar: Eid al-Fitr, Eid al-Adha, Founding Day and National Day, with «لا عطل مسجلة» today.
   - No half days, no sick-note attachment, no team calendar or cover, no balance forecast.
   - The accrual module exists for HR but is not connected to the employee's balance.
3. **G3. No end-of-service gratuity estimate.** Nothing links resignation to clearance and a final-settlement preview. Needed; the rules need sign-off by the HR manager.
4. **G4. No instant, verifiable documents.** Salary certificate, employment letter, experience letter and embassy letter as PDF with a QR code, self-issued or one-click approved, are standard in Jisr and ZenHR. Here, neither path delivers a document (B15).
5. **G5. No unified "my requests".** Leave, expenses, letters, HR cases, training, attendance corrections and timesheets are not in «أين طلباتي» or «الطلبات», and have no service-level time or status language in common.
6. **G6. Notifications are in-app only.** No email, SMS or push, no preferences, no daily digest, no reminders before a service-level deadline, and module events are missing entirely (B6).
7. **G7. No single front door.** 13 catalog services duplicate modules with different approval chains; for example, expense claims are M → CEO office in the catalog but M → finance in the module. The catalog should deep-link to the module.
8. **G8. The catalog is not filtered by role.** Every employee sees managers', finance and IT-admin services: headcount request, job change, succession, client invoice, budget transfer, new-employee accounts, executive decisions.
9. **G9. No people directory.** «الهيكل التنظيمي» lists departments and approvers only: no names, photos, phone or extension, and no "who is my HR partner".
10. **G10. Loans and advances are a plain request.** «سلفة على الراتب» has no installment schedule, no deduction tracking in payslips, and no balance shown to the employee.
11. **G11. Business travel has no per-diem.** «سفر وانتداب» has no per-diem calculation per company policy, no tickets or hotel, and no link to expense settlement.
12. **G12. Nothing on medical insurance for the employee.** No card, no class, no dependents, no "add newborn or spouse" request. التأمين والمزايا shows the employee nothing.
13. **G13. The attendance policy is not configured.** No working hours, Ramadan hours (reduced hours for Muslim staff), shifts, remote or flexible days, or geofenced or selfie clock-in. Overtime has no premium calculation (Labour Law Art. 107: 150%).
14. **G14. No service-level times in the HR modules.** Leave, expenses, letters and HR cases show «لا مدة مستهدفة محددة» or nothing, while catalog services show a due date.
15. **G15. No onboarding or offboarding journey for the employee.** The employee cannot see a first-week checklist, required documents, or a clearance checklist.
16. **G16. English is incomplete** (B16). A bilingual workforce (Saudi and expatriate staff) needs full Arabic and English parity, including service names, field labels and server messages.
17. **G17. No mobile app shell.** No installable app (PWA), push notifications, offline receipt capture or camera scan; the tab bar has no "new request" or "my requests".
18. **G18. The help assistant is off by default.** «مساعد الموظف» exists but reads «غير مفعّلة». There is no FAQ or knowledge base the employee can browse.
19. **G19. No e-acknowledgement of contract or offer.** The contract has a reference «عقد تجريبي؛ لا يوجد مستند فعلي» and no employee acknowledgement step.
20. **G20. Official transactions end outside the platform.** GOSI, Qiwa and Mudad/WPS records are HR-side only. Contract registration, GOSI registration and wage-protection status are out of scope for the platform to complete, and the employee cannot see their status. This must stay plainly labelled as ending at an outside party.
21. **G21. No human request numbers**, for example `HR-2026-00123`, for phone and email follow-up.
22. **G22. No proxy filing.** An employee cannot file on behalf of a colleague, for example an assistant booking travel; only the beneficiary's manager or HR can.

---

## 5. Quick wins

Each is a small change, testable on its own.

1. Fix the leave-balance field (`routing.mjs:131` and the home card) to use `available_days`. Fixes B4.
2. Render checkboxes with `value="on"` (or read `.checked`) in `operationFields`. Fixes B5.
3. Guard `days_left===null` in `home.mjs:37` so a draft reads «مسودة لم تُقدَّم». Fixes B8.
4. Notifications: map every kind to a sentence with the request title and outcome; add "mark all as read"; send a receipt on submit; don't notify the person who cancelled. Fixes B7.
5. Add `service.feedback_recorded` and the other missing actions to `actionLabel`, with English. Fixes B10.
6. Take `requirements.view` out of the defaults, and hide «تطوير الخدمات», «نواقص دليل الخدمات», «مراجعة المصادر», «بطاقات الخدمات» and «المراكز التخصصية» from plain employees. Fixes B12.
7. Use the nav label (the personal variant) as the page heading; hide approver tiles for non-approvers. Fixes B13.
8. Add `required` in `fieldInput` and show every missing field in one pass. Fixes B9.
9. Show «—» for empty optional fields. Fixes B23.
10. Add one Arabic number-and-noun helper («3 خدمات», «15 يومًا», «يوم واحد») and use it on every screen. Fixes B22.
11. Arabic leave-type names («سنوية»…) instead of codes. Fixes B25.
12. Replace the 403 dead end with «هذه الشاشة لفريق الموارد البشرية» and a link back; point own-document rows to the employee's own page. Fixes B14.
13. Add catalog search synonyms («إجازة», «راتب», «خطاب», «عهدة») that deep-link to the matching module. Fixes B11.
14. Give pulse selects a blank «اختر» option and make them required. Fixes B17.
15. Trim the الرئيسية intro to one sentence and don't list out-of-scope finance sources for employees. Fixes B29.
16. Expense amount: `inputmode="decimal"`; allow attaching the receipt in the claim form itself. Fixes B27.
17. Avatar initial: skip «ال». Fixes B26.
18. Contract page: link to the real catalog services by code. Fixes B28.

---

## 6. Recommendations

In order. Each is a staged, testable journey, following the owner's "one complete journey first" rule.

1. **Close the report-snapshot leak and the separation-of-duties gaps now** (B1, B2, B18, B19).
   - Snapshots should be listed and opened only by the creator and by holders of a report-approval capability.
   - Their data must be re-scoped to the viewer, or a snapshot shown only to people whose own scope covers it.
   - Approval should need a named capability.
   - Freeze `recipient_manager` visibility to the manager at the time of writing.
   - Block one person from holding both expense steps.
   - Add regression tests for each.
2. **Make leave a complete journey. It is the flagship self-service.**
   - HR screens to create the work calendar and public holidays.
   - Leave types that follow the Labour Law, with entitlements approved by the HR manager.
   - Accrual feeding the employee's balance.
   - A leave entry in the catalog that deep-links to إجازاتي.
   - The correct balance on both dashboards.
   - Notifications at each decision.
   - A date guard on cancellation.
   - A manager fallback matching the generic workflow.
   - Show it to the HR manager for acceptance before calling it done.
3. **One front door, one "my requests".**
   - Keep the catalog as the only place to start; for the 13 duplicated services, point the catalog entry at the module rather than running a second approval chain.
   - Build «طلباتي» on a shared envelope (status, holder, due date, timeline) that every module writes to, so leave, expense, letter and HR-case items appear next to generic requests with the same status words and service-level times.
   - Merge الرئيسية and ملخصي into one employee home.
4. **A real notification service.**
   - An events table not tied to `requests`, one template per event kind (Arabic and English), and an inbox with outcome and title.
   - Service-level reminders.
   - Then outbound channels through the company's own email and SMS gateways, once the owner provides them, with per-user preferences.
5. **"My profile" and documents.**
   - A read-mostly employee profile (ID or Iqama and expiry, contacts, dependents, IBAN, joining date, grade), with change requests routed to HR.
   - Instant or one-approval letters from approved templates with QR verification. Seed the five standard templates for the HR manager to approve, and grant `hr.letters.issue` to the HR manager role, so خطاباتي works out of the box and the duplicate catalog letters can be retired.
6. **Role-aware navigation.**
   - Around 15–18 items for a plain employee, grouped as: Today, My requests, My time and leave, My pay and documents, My growth, Company.
   - Delivery screens only for people on client teams; admin and development pages hidden.
   - Filter the catalog by audience (employee, manager, finance).
7. **Arabic and English parity.**
   - Move `tr()` into a shared module and translate module titles, descriptions, forms and statuses.
   - Serve `name_en` for services and English server messages when the user's language is English.
   - Add a test that fails on untranslated user-facing strings.
8. **Mobile-first polish.**
   - Put "new request" and "my requests" on the tab bar.
   - Move disclaimers below the primary action.
   - Add an installable app (PWA) with push once notifications exist.
   - Receipt capture by camera.
   - Clock-in with an optional office geofence (subject to a privacy decision by the owner).
9. **Saudi specifics, each signed off by the HR manager before real use:**
   - End-of-service gratuity estimator
   - Advances with repayment schedules
   - Travel per-diem
   - Overtime premium
   - Ramadan hours
   - A status view of the outside transactions (GOSI, Qiwa, Mudad) that is clearly labelled as ending with the outside party.
10. **Copy pass.**
    - Replace the auditor-style disclaimers with short employee-facing sentences, and keep the long explanations behind a «لماذا؟» link.
    - Fix number agreement.
    - Choose one register for headlines.

---

## Appendix: screenshots

All in `work/design-verify/portal-audit/`:

- **Desktop:** `01-home-desktop` … `41-catalog-search-leave` (numbered as in the walk-through log).
- **Phone (390×844):** `m01-home-mobile` … `m12-contract-mobile`.
- **Menu sweep (pass A, bare seed):** `sweep-01-portal` … `sweep-58-payables`.
