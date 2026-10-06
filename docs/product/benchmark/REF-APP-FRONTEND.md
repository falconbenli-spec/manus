# REF-APP-FRONTEND: the old HR app's frontend, employee portal and mobile, compared with the 3,6T platform

Date: 2026-09-19. This is a read-only analysis: no code was changed and nothing was committed.
Every item in section 4 has the state **proposed**. Nothing here is built, tested, connected or accepted by a process owner.

**Sources read (old app).** The partial snapshot is in `work/reference/manus-app/`:

- `client/src/pages/`: `EmployeePortal.tsx`, `Dashboard.tsx`, `Attendance.tsx`, `Leave.tsx`, `MyTasks.tsx`, `Engagement.tsx`, `SkillsMatrix.tsx`, `AdminSettings.tsx`.
- `client/src/components/LeaveRequestsTab.tsx`.
- `server/portal-app.html`, plus the parts of `server/index.ts` that serve it.
- `todo.md`, `vite.config.ts`, `package.json`.

**Sources read (ours).**

- Frontend: `app/static/index.html`, `app.mjs` (shell, navigation, notifications, router), `signature.mjs` (bottom tab bar, drawer), `portal-ui.mjs`, `home-ui.mjs`, `journey.mjs`, `hr-design.mjs`, `attendance-ui.mjs`, `leave-ui.mjs`, `letters-ui.mjs`, `payroll-ui.mjs`.
- Server: `app/server.mjs` (asset whitelist and security headers), `app/home.mjs`, `app/routing.mjs`, `app/attendance.mjs` (`punch`), `app/workflow.mjs` (`notifications`).
- Docs: `docs/product/design/03-current-ui-map.md`, `docs/product/audits/UX-COPY-AUDIT.md`, `docs/product/benchmark/04-service-platforms-and-tech.md`.

**Not available when written.**

- `docs/product/audits/EMPLOYEE-PORTAL-AUDIT-20260919.md` did not exist yet (checked at the start and again at the end of this work). The live audit is still running, so this document does not repeat or anticipate it. Where both documents touch the same screen, the live audit's observed behaviour takes precedence over the code reading here.
- The other ~44 pages of the old app are listed in section 5.

Personal data, office coordinates, keys and credentials in the old code are described only in general terms and are never reproduced.

---

## 0. Findings in brief

1. **The old app looked more finished than it was.** Several of its flows update the screen and show a success toast without saving anything:
   - the geofenced check-in in `Attendance.tsx`;
   - manual attendance entry;
   - the header "new leave" form in `Leave.tsx`;
   - most of `AdminSettings.tsx`;
   - all of `Engagement.tsx` and `SkillsMatrix.tsx`.

   Many mutations also never check `res.ok`. Its *interaction patterns* are worth borrowing; its *behaviour* is not.

   The server-rendered mobile portal (`portal-app.html`) does not run at all. A quoting error at line 2733 stops its whole inline script from parsing. It also relied on a CSP loosened to `'unsafe-inline' 'unsafe-eval'`.
2. **The old employee portal leaked data.** `EmployeePortal.tsx` downloads every employee's HR and payroll records and filters them in the browser (L190-223). If nothing matches, it falls back to the first employee (L256). Our server-side scoping is far stronger and must not be traded away for any pattern borrowed from it.
3. **What was genuinely good is small and specific:**
   - large check-in and check-out buttons that change state, next to a distance and accuracy readout;
   - multi-sample GPS reading: take the first fix within 20 m, otherwise the best fix after 10 s;
   - leave balances shown as tiles of "remaining out of total";
   - balance and overage shown *inside* the leave form while it is filled in;
   - a salary-certificate wizard (addressee type first, then bank or embassy);
   - filter chips that show counts;
   - a "Today" reset next to date pickers;
   - empty states that offer an action.
4. **Our employee screens are functionally deeper but take more taps on a phone:**
   - check-in takes 4 taps from launch;
   - leave balances appear on the home screen as one summed number labelled with the internal type code;
   - there is no quick-action row;
   - the bottom tab bar gives employees "My summary" and "Decisions" rather than attendance, leave or notifications;
   - notifications have no unread badge and cover only service-request events.
5. **Mobile foundations.**
   - Already in place: `viewport-fit=cover`, iOS web-app meta tags, safe-area tokens, a bottom tab bar and a bottom-sheet menu.
   - Missing: a manifest, icons, a service worker and push.
   - Geolocation is disabled outright by our own header: `Permissions-Policy: … geolocation=()` in `app/server.mjs`.
   - All of this depends on something we do not have: an HTTPS host that employees' phones can reach. `00-platform-inventory.md` lists hosting as absent.

---

## 1. The old app, screen by screen

Legend: **Good** = worth copying as a pattern. **Avoid** = do not copy.

### 1.1 `EmployeePortal.tsx`: employee self-service (React)

| Aspect | What it does |
|---|---|
| Purpose | Self-service for one employee. It has its own portal session (`/api/employee/portal-me`), falls back to the admin session, and otherwise redirects to a separate login page. Managers without an employee record get an employee picker. |
| Layout | Single column, `max-w-2xl`, `dir="rtl"`. Header shows an initial avatar, the name, "title — department" and a red logout button. Below it are **5 equal tabs in one row at `text-xs`**: بياناتي (my data), الحضور (attendance), الإجازات (leave), المخالفات (violations), التعريف (salary certificate). |
| Widgets | Job-info card (10 read-only rows). Contact card with an edit toggle. **Leave-balance tiles** in a 2-column grid showing "remaining, out of N days", red at 0. Today card with check-in and check-out times. **Location card** with a "locate me" button, an inside/outside-zone banner, distance, radius and GPS accuracy. Two 56 px check-in and check-out buttons. Violation cards with deduction days. Salary summary (basic, gross, net). Request histories with status badges. |
| Interactions | **Leave dialog**: type (9 Saudi leave types), native date inputs, reason; end date must not be before start; days counted as calendar days. **Salary certificate wizard**: step 1 is 5 addressee cards (bank, embassy, government, housing, general); step 2 is a bank select (from a JSON list), an embassy select, or a free Arabic/English name; submit stays disabled until the form is valid. **Check-in**: locate (`getCurrentPosition`, 10 s timeout, high accuracy), then a client-side haversine check; outside the zone it still saves and shows a warning toast. |
| Empty and error states | Empty: "no leave-balance data", "no violations recorded" with an encouraging "clean record" line, "no leave requests", "no previous certificate requests". Location errors show a banner. Every `load*` swallows its errors, so a failed load looks exactly like an empty list. |
| Mobile | Phone-first single column. The 5-tab row is cramped. Only the check-in buttons meet a 44 px target. No bottom navigation, no sticky actions. |
| **Good** | Big state-aware check-in and check-out buttons that disable at the right time. Distance, accuracy and radius shown before punching. Balance tiles. Two-step certificate wizard. Rejection reason shown inline. Friendly empty copy. |
| **Avoid** | Fetching all employees' HR and payroll data to the browser. Falling back to `employees[0]`. Matching violations by Arabic name. Unfiltered certificate list. Hard-coded office coordinates and radius fallback. Leave balance not shown in the leave dialog. No payslip history, tasks or notifications. Balances sit below two long cards and need a scroll. |

### 1.2 `Dashboard.tsx`: HR analytics home

| Aspect | What it does |
|---|---|
| Purpose | HR/admin overview. The overview is gated by `canSeeData`; the Contracts and Attendance tabs are not gated at all. |
| Widgets | Greeting with the long Arabic date. A 160 px hero with 4 figures. 4 KPI cards with trend-arrow chips. Pill tabs: overview, contracts, attendance. Recharts headcount-by-department bar chart: **clicking a bar opens a searchable employee grid** that leads to a profile modal. Gender bar, nationality chips, education bars. Live-attendance widget with a date picker capped at today, a **"Today" reset**, a rate %, a progress bar, **filter pills with counts** (present, absent, leave, exempt) and a scrolling list. Contract urgency list (30/60/90 days, colour-coded chips). 7-day present-vs-late area chart. Two SVG donuts. |
| States | No spinners; KPIs show "loading…". Empty: "no attendance data for this day — may be a holiday", "all contracts valid". Errors are swallowed. |
| Mobile | KPI grids collapse to 2 columns. The chart label area is fixed at 80 px and crowds on phones. Hover effects are done in JS and do nothing on touch. |
| **Good** | Drill-down from a chart to a list. Filter pills with counts. "Today" reset. Colour-coded contract urgency. |
| **Avoid** | A "Refresh" button that only shows a toast. A pulsing "auto-updated" label with no refresh behind it. 09:00 late rule and 8 h rule hard-coded in the UI. `toISOString()` dates (UTC, wrong day in Riyadh). Hero image hot-linked from a CDN. |

### 1.3 `Attendance.tsx`: attendance dashboard with a bolted-on check-in

| Aspect | What it does |
|---|---|
| Purpose | HR/manager attendance dashboard fed from an external HR SaaS, plus a check-in card on a "company location" tab. No role check at all. |
| Layout and widgets | Connection pill, last-sync time, from/to dates, 5 buttons. 7 KPI cards and an "under 8 h" banner. View tabs: دوام اليوم (today), جدول السجلات (records table), تحليل الموظفين (employee analytics), موقع الشركة (company location). Charts: grouped bar chart of attendance % vs compliance % for the top 20; a 14-day hours area chart per person; SVG compliance gauges; an `HoursBar` showing the shortfall against 8 h (e.g. "-1:30"). Status badges, hashed-colour avatars, a gold rank badge. No month calendar, heatmap or live clock. |
| Interactions | Day picker with a "Today" reset. Week/month toggle (week starts Saturday). Table filter chips with counts (all, present, absent, leave, under 8 h). Name/date search, employee select, 25-row pagination. Client-side Excel exports and a server `.xlsx`. "Manual entry" modal. |
| Check-in mechanics | `watchPosition` with `enableHighAccuracy` and `maximumAge: 0`. **It takes the first fix within 20 m, otherwise the most accurate fix after 10 s, and fails if there is none at 12 s.** Haversine against each active zone's radius, from `/api/geo-locations/active`, with a hard-coded fallback office and 200 m. Accuracy is displayed but not used in the decision. Error copy for unsupported, permission denied (tells the user to allow location in browser settings) and generic failure. **A successful check-in only sets local state and is never sent to the server.** No check-out, no correction flow. |
| States | Checking, loading ("fetching records…"), a red error banner, empty per period, per day and per filter. |
| Mobile | Inline styles only. `auto-fit` grids. Tables scroll at `minWidth: 700`. Buttons are 30-34 px. Text is 9-11 px. |
| **Good** | Best-of-N GPS sampling with an accuracy cut-off. Distance and accuracy shown on failure. Filter chips with counts. Shortfall bar. "Today" reset. |
| **Avoid** | Check-in that is never persisted. Client-side zone decision. Hard-coded office and radius. Google Maps iframe (external, and blocked by our CSP anyway). An "auto-refresh every 5 minutes" claim with no timer. UTC dates. |

### 1.4 `Leave.tsx`: HR leave dashboard

| Aspect | What it does |
|---|---|
| Purpose | HR leave overview based on the Saudi labour law. No gating on the page itself. |
| Layout and widgets | Status/date bar, refresh, Excel export. Tabs: نظرة عامة (overview), طلبات الإجازة (leave requests), أرصدة الموظفين (employee balances), سياسة الإجازات (leave policy), تقديم طلب إجازة (submit request, which embeds `LeaveRequestsTab`). 5 emoji KPI cards, per-type distribution bars, latest 8 requests. **Policy accordion** listing each leave type: paid or unpaid, days per year, conditions, higher entitlement after 5 years. |
| Interactions | Search, status and type filters, 15-row pagination, read-only table. |
| States | "Not connected" is shown even when data loaded from the fallback. "No leave data" error. "No requests yet". |
| **Good** | Leave policy readable by employees, with its legal basis next to each type. Leave-type description shown in the form. |
| **Avoid** | Two "new request" flows, one of them fake (a `setTimeout` and then a success toast). A "balances" tab that is really just totals of requests. A type filter that compares IDs with names. |

### 1.5 `LeaveRequestsTab.tsx`: the real leave workflow

| Aspect | What it does |
|---|---|
| Purpose | Employees see their own requests and can cancel pending ones. Admin/owner can approve, reject, delete, manage balances and file on someone's behalf. No manager tier. |
| Widgets | Segmented control: الطلبات (requests) / الأرصدة (balances). 4 stat tiles. **Status filter chips**. Expandable request cards rather than a table. **`BalanceCard`**: large "remaining" figure, used-plus-pending progress bar, warning icon and red border at 3 days or fewer. |
| Interactions | New-request form: choosing a start date auto-fills the end date, and the end date has `min=start`. **A live balance chip under the type select** shows paid/unpaid and available days (red at 3 or fewer) or "no balance set". **A days badge turns red and shows the overage.** Non-admins cannot exceed the balance. Reject dialog with a reason. Cancel. Delete via native `confirm()`. |
| States | Empty: "no requests" plus a call to action. Empty balances with role-aware help text (admin: manage balances; employee: contact HR). |
| Mobile | Modals are full-width, with 90vh maximum height and their own scrolling: good. The 4-column stat grid breaks on phones. |
| **Good** | Balance and overage inside the form. Start date auto-filling the end date. Role-aware empty copy. Reject reason captured. |
| **Avoid** | Unchecked mutations. Mixed status vocabularies. Saving a balance resets its used and pending days to 0. An external feed that is not filtered for non-admins. Calendar-day counting. |

### 1.6 `MyTasks.tsx`: HR officer workbench

| Aspect | What it does |
|---|---|
| Purpose | Personal workbench for an HR officer, with 8 tabs: dashboard, tasks, weekly plan, attendance, contracts, penalties, execution guide, checklist. |
| Widgets | SVG completion ring. **6 clickable KPI cards, each jumping to its tab.** Quick-access chip row. Weekly plan grouped by day with done/total badges and checkboxes. Recurrence filter chips with counts. Penalty cards (collapsible; avatar coloured by severity). Warning-letter preview with a Word download. Exemption dialog. |
| States | A shared `EmptyState` component (icon, message, hint, optional call to action). A spinner with "loading…". |
| Mobile | Tables scroll sideways. Icon buttons are small (14 px icons). Penalty text is hidden below `sm`. |
| **Good** | KPI cards that navigate. A consistent empty state with an action. Tasks grouped by day. |
| **Avoid** | Ticks that are lost on reload. Staff first names and meeting days hard-coded in the guide. Success toast even on failure. `dangerouslySetInnerHTML` letter preview. |

### 1.7 `Engagement.tsx`: events and initiatives

| Aspect | What it does |
|---|---|
| Purpose | 2026 engagement events and budget. Tabs: events, initiatives, engagement hub, surveys. |
| Widgets | **"Happening now" banner** with a pulsing dot. KPI cards. Dual-axis monthly bar chart (count and budget). Category donut. Sortable, searchable table with a totals footer. Event modal. Initiatives grouped by month. |
| States | "No events match the search". Nothing is fetched, so there are no loading or error states. |
| **Good** | Status derived from dates (upcoming, live, ended). Month-grouped timeline. |
| **Avoid** | All data is hard-coded arrays. Added events never appear. Budget tiers contradict the data. |

### 1.8 `SkillsMatrix.tsx`: succession and skills

| Aspect | What it does |
|---|---|
| Purpose | Mostly succession planning, with 7 tabs including a 9-box grid and committee report. No gating. |
| Widgets | CSS-only 9-box grid. Dot and segment rating bars. Readiness, criticality and coverage badges. Skills-gap chips. |
| **Avoid** | Positions, candidates and plans are *generated* from job titles with seeded ratings. Only skills are saved. Loading never ends when the employee list is empty. Not relevant to the employee portal. |

### 1.9 `AdminSettings.tsx`: settings

| Aspect | What it does |
|---|---|
| Real sections | **Geo zones**: list with an active toggle; editor with a map, a draggable and resizable circle, a "use my current location" button, a 50-2000 m radius slider with ± buttons, and a coordinates readout. **Attendance exemptions**: type-ahead employee picker plus a reason. **Approval chains**: 6 request types, each with ordered steps (direct manager, department head, HR, CEO, or a named employee). |
| Fake sections | General, users, security, notifications, integrations and backup only show toasts or keep local state. |
| **Good** | Zone editor combining "use my location", a radius slider and a numeric readout. Visual approval-chain builder. |
| **Avoid** | No role gating. About 60% mock. The leave workflow does not use the approval chains. The map depends on an external provider. |

### 1.10 `server/portal-app.html`: server-rendered mobile portal

**It does not run as shipped.** The page has one inline script of about 3,400 lines. Line 2733 puts `onclick="openLetterModal('bank')"` inside a single-quoted JS string. `node --check` on the extracted script fails with `SyntaxError: Unexpected identifier 'bank'` (verified for this document), so none of the script executes: no login, no tabs. Everything below describes the code's *intent*.

| Aspect | What it does |
|---|---|
| Purpose | A one-file employee portal served at `/api/employee/app` with an `emp_session` cookie. Views: login, forced password change, and the portal, with **14 tabs**: my info, attendance, leaves, requests, approvals (managers, HR, or anyone with pending approvals), tasks, performance, training, benefits, violations, team, org chart, reports, announcements. Eight modals: salary letter, leave, generic request, HR contact, time-off permission, attendance edit, insurance dependant, and an AI chat. |
| Navigation | A **sticky top strip of 14 horizontally scrolling tabs**, most of them off-screen on a phone. No bottom bar. |
| First screen | 1. Header with bell, theme and AR/EN toggles, avatar, name, title. 2. The tab strip. 3. A *duplicate* profile card. 4. Contact card. 5. Dashboard widgets: alerts ("not checked in", "pending requests", "low leave"), **4 stat tiles** (today's status, hours this week, days present this month, pending), an adherence bar, a conic-gradient donut, **leave-balance rings**. 6. A **quick-access grid** (leave, payslip, letter, check-in, surveys, rewards), which sits below the fold. 7. Job, contract and salary cards. |
| Check-in | "Get location" (`getCurrentPosition`, high accuracy, 10 s), then client-side haversine against zones from the server (default 200 m). Outside the zone: a red panel with distance and radius, and the buttons are disabled. The server also enforces the zone and returns an Arabic 403. There is a live "time since check-in" timer based on the server timestamp. Mock-location heuristics (accuracy < 1 m, or altitude exactly 0) and a canvas/user-agent device fingerprint. The error copy passes the browser's raw (often English) message through, and there is no specific "permission denied, here is how to re-enable" guidance. |
| Leave | Balance cards for 8 types (maternity or paternity chosen by gender), remaining = total − used − pending. **If the fetch fails, hard-coded default totals are shown as if real.** Modal: type, from, to, reason, and an attachment, required for all but annual and emergency and uploaded before submit. Client-side overlap check. No day-count or balance preview. History shows two approval chips (manager → HR). |
| Letters | A 3-step wizard: bank, embassy or general; then a bank list with logos, an embassy list, or free text; then notes and submit. The "letters" history tab is referenced in code but has no element, so letter history cannot be viewed. |
| Payslip | Not a payslip. It builds HTML from the salary structure and calls `window.open` + `document.write` + `print()`. That is unreliable in an iOS standalone PWA, and there is no history. |
| Tasks | A read-only list with a progress bar. |
| Notifications | A bell panel whose content is **generated locally**, not fetched. The unread badge is never updated. Because two profile fields are never returned, it always shows a "low leave, 0 days" warning and a greeting with an undefined name. |
| Offline and PWA | Registers `/sw.js` and links a manifest, but neither file is in the snapshot. An offline banner appears on the `offline` event. Nothing is cached. |
| Meta and mobile | `viewport-fit=cover` but **`maximum-scale=1` (zoom blocked)**. `black-translucent` status bar with no top safe-area inset, so the sticky strip and toasts sit under the notch. Only a bottom inset. A single dark `theme-color`. Dark by default, ignoring the system setting. The AR/EN dictionary flips `dir`, but layout uses physical left/right properties. |
| CSP and security | All CSS and JS are inline, with hundreds of `onclick` attributes and unescaped `innerHTML`. Employee-written text is shown to approvers, which is stored XSS. The route's CSP therefore allows `'unsafe-inline' 'unsafe-eval'` and several external origins. The server-side reading also found: login accepts the employee number as the password (the changed password is never checked); the check-in route trusts the employee id in the request body; no CSRF tokens. |
| **Good** | Bottom safe-area padding. Arabic by default. A server-enforced geofence. The distance-against-radius panel shown before punching. A live timer from the server clock. Two-stage approval chips. Attachment uploaded before submit. Quick-access grid (right idea, wrong position). A letter wizard that starts from the addressee type. |
| **Avoid** | Everything under "CSP and security". Placeholder numbers presented as real (balances, org stats, performance goals). Locally invented notifications. Zoom disabled. 14 top tabs. Quick actions below the fold. A duplicate profile card. |

### 1.11 Cross-cutting lessons

- **Copy the interaction, never the plumbing.** Each good pattern above has a server-side equivalent in our platform that is already stricter: server time for punches, balances kept as a ledger, a two-person rule for deductions.
- **Honest states.** The old app routinely claimed things that were not true: "auto-updated", "saved", "connected". Our reporting rules forbid this. Any pattern we borrow must keep our "only say what the server confirmed" behaviour.
- **One vocabulary.** The old app mixed English and Arabic status keys, and records fell out of filters because of it. Our `UX-COPY-AUDIT.md` §1.6 already fixes a single status vocabulary.

---

## 2. Employee portal: old vs ours

### 2.1 The employee's first screen

| | Old React portal (`EmployeePortal.tsx`) | Old mobile portal (`portal-app.html`) | Ours today |
|---|---|---|---|
| Landing route | Portal page, tab بياناتي (my data) | "My info" tab with dashboard widgets | `#home` (`app.mjs`: `location.hash.slice(1)\|\|'home'`) → `homeUI` |
| Above the fold (phone) | Avatar, name, title and department; logout; 5-tab row; start of the job-info card | Header (bell, toggles, avatar, name), the 14-tab strip, a duplicate profile card, contact card. The alerts, stat tiles and balance rings load below. | Top bar (logo, avatar/index, search). A head panel with name, department, the date in both calendars, and a long scope note. A tile grid: **ما ينتظر قراري** (awaiting my decision), **طلباتي المفتوحة** (my open requests), **مهامي** (my tasks), **رصيد إجازتي** (my leave balance), **وثائقي المقتربة من الانتهاء** (my documents nearing expiry). Then lists. The bottom tab bar shows **ملخصي** (my summary), **الرئيسية** (home), **مهامي** (my tasks), **قراراتي** (my decisions), plus **الفهرس** (index). |
| Primary action on screen | None; you must open a tab | A quick-access grid of 6 actions, **below the fold** | None on `home`. `portal` has «ابدأ طلبًا جديدًا» (start a new request) and a tour button. |
| Leave balance | Tiles showing remaining out of total, per type, below two cards | Rings per type on the dashboard, below the fold. They fall back to hard-coded totals on error. | Tile = **sum of remaining days across all types** (`home.mjs`, `card('leave',…)`). The per-type list further down shows the raw `leave_type` **code** (e.g. a local code such as `synthetic_annual`), because `routing.mjs` passes `b.leave_type` straight through. |
| Attendance today | Only on the Attendance tab | A "today's status" tile and a "not checked in" alert on the dashboard | Not on `home` or `portal`; only on `#attendance`. |

Our first screen is honest, scoped and linked. Every number comes from its source and opens its screen. That is better than the old portal's static profile. But it answers a manager's question ("what is waiting for me?") and not the everyday employee questions: have I checked in, how many annual-leave days do I have, where is my letter or payslip. Two overlapping screens (`home`, and `portal` labelled «ملخصي») also occupy two of the four tab slots. `UX-COPY-AUDIT.md` §2.2 already recommends merging `portal` into `home`.

### 2.2 Taps per common task (phone, employee role, starting from the landing screen)

Counting rules:

- A tap is a navigation or a button press. Typing into form fields is shown separately as "+ form".
- For ours, "Index" means the bottom-bar «الفهرس» button, which opens the menu sheet. The «مساحتي» group is expanded by default while on `home` (`groupedNavigation` in `hr-design.mjs`), so an item inside it is one more tap.

| Task | Old React portal | Old `portal-app.html` | **Ours today** | Ours after P1 (target) |
|---|---|---|---|---|
| Check in | 3 (Attendance tab → Locate → Check in) | 3 (4 the first time): quick action → Get location → (permission) → Check in | **4** (Index → «حضوري» → «تسجيل الحضور الآن» → confirm in dialog) | **1-2** (Today card on home → confirm) |
| Check leave balance | 0 taps plus a scroll; per type | 0 plus a scroll, or 1 (Leaves tab) | 0 for a single summed number; per type needs a scroll (and shows a code), or 2 (Index → «إجازاتي») | **0**, per type, labelled |
| Apply for leave | 2 + form (type, 2 dates, reason) + submit ≈ 6 | ≈ 4 + date pickers (after scrolling to the quick action) | 3 + form (2 dates, reason) + submit ≈ 7 (Index → «إجازاتي» → «طلب إجازة من هذا الرصيد»). From the home balance tile: 2 + form. | **1** + form (quick action "طلب إجازة" (request leave) opens the dialog directly) |
| Request a letter | 2 + wizard ≈ 5-6 (salary certificate only) | 4 (quick action → type → bank → submit) | 3 + form (type, addressee, purpose) + submit ≈ 7 (Index → «خطاباتي» → «طلب خطاب») | **1** + form |
| See latest payslip | Not available (only a basic/gross/net summary) | 1, but it prints the salary structure, not a payslip | **2** (Index → «قسائم راتبي»). Note: the latest slip is only auto-expanded for payroll staff (`slip(s,i===0&&!staff)`), so an ordinary employee needs a third tap to expand it. | **1** (quick action), latest expanded |
| See my tasks | Not available | 1-2 (Tasks tab, may need a swipe of the strip); read-only | **1** (tab «مهامي») | 1 |
| Notifications | Not available | 1 (bell), but the content is generated locally | 2 (Index → «الإشعارات»); no unread badge anywhere | **1** (tab with unread badge) |

Takeaway: our functional coverage is broader. We have payslips, tasks, letters of several types, corrections, missions and overtime, which the old React portal lacked. Our *path length* is worse for the two most frequent employee actions (check in, request leave) because they sit two levels deep behind the index sheet.

### 2.3 Notifications

| | Old app | Ours |
|---|---|---|
| In-app list | None in the React portal. `portal-app.html` has a bell panel, but its items are built in the browser (for example, time-of-day reminders shown only while the panel is open). The admin app had a notification bell (`todo.md`, marked done). | `#notifications` (`app.mjs`): rows with a generic title ("a request needs your decision" / "a request is ready to execute" / "your request was updated"), a date, an "open request" link and "mark read". |
| Unread badge | None | **None on notifications.** Only `#inbox` (decisions) gets a live `nav-count` from `/api/inbox/count`. The unread count exists server-side (`routing.mjs` → `unread`) and is shown only as a tile on `portal`. |
| Sources | Portal: none from the server. Its approvals badge is fetched once, at login. | **Service-request workflow only.** `INSERT INTO notifications` exists only in `workflow.mjs`. Leave decisions, letter issued, payslip published, attendance correction decided, absence proposed (which asks for the employee's statement) and policy to acknowledge produce no notification. |
| Content | — | The row does not name the request, so the user cannot tell two notifications apart without opening them. Opening a request does not mark it read. There is no "mark all read". |
| Refresh | No polling (the "auto-refresh" claims were false) | Counts refresh on each navigation (`render()`); no `visibilitychange` refresh. Honest, but stale if the app is left open. |
| Out-of-app | Transactional e-mail through an external e-mail API: templates, alerts, new-device and password-reset mail. It is marked done in `todo.md`, while domain verification and a test send are still open. Push is marked done in `todo.md`, but **no Push API code exists** in the snapshot. | None: no e-mail, no push. |

### 2.4 Where ours is already better (keep)

- **Server-scoped data.** No browser ever receives another employee's records. The old portal did the opposite.
- **Server time for punches.** `attendance.punch` ignores client time. A correction flow keeps the previous times. "Incomplete day" means *needs explanation*, never an automatic deduction.
- **Leave as a ledger.** Days are reserved on submission and debited on final approval. Approval is manager then HR. Resubmitting creates new versions. The old app's balance save reset usage to 0.
- **Payslip visible only to its owner, and only after approval.** Letters come from approved templates, with a QR print copy.
- **A bottom tab bar, a bottom-sheet index and ⌘K search** already exist. The old React portal had no bottom navigation.

---

## 3. Mobile

### 3.1 What the old app shipped (and what happened)

This is taken from `todo.md` (checkbox state as written), `package.json`, `vite.config.ts` and `server/index.ts`. **"Marked done" in `todo.md` did not mean "present in code".**

| Item | `todo.md` says | Code says |
|---|---|---|
| PWA plan: manifest, service worker, iOS meta tags, `vite-plugin-pwa`, icons, splash | Open (first plan). Later "PWA conversion", "Offline Mode" and "full PWA" are marked done. | `vite-plugin-pwa` is installed but **not configured**. The portal registers `/sw.js` and links a manifest, but **neither file exists** in the snapshot. Nothing is cached. |
| Capacitor iOS wrapper: App Store prep and docs | All open | Capacitor 8 packages are installed (`app`, `core`, `ios`, `haptics`, `keyboard`, `splash-screen`, `status-bar`) with `build:ios` / `cap:*` scripts. There is **no `capacitor.config`, no `ios/` project, and no Capacitor call** in the pages read. No geolocation or push plugin. |
| Geofenced check-in (React portal and HTML portal), 22 geofencing tests | Done | The React `EmployeePortal` saves the punch with a client-side zone check. `Attendance.tsx` never saves. The HTML portal's server route enforces zones (haversine, strict 403) but trusts the employee id in the body. Hard-coded office fallback coordinates are repeated in 3 places. |
| Attendance exemptions from geofencing | Done | The server check-in route read has no exemption check. |
| Anti-fraud: device fingerprint, IP, same-device alert, mock-location detection | Done. "Strict geofencing" is open. Device binding was skipped at the user's request. | Heuristics on the client. Mock location is a boolean the client reports. |
| Push notifications, biometric login | Done | **No Push API, `Notification`, WebAuthn or native plugin anywhere.** |
| E-mail system (templates, alerts, device and password mail) | Done; DNS verification and a test send are open | Present server-side through an external e-mail API. |
| CSP hardening ("no inline scripts") | Done | **Reversed later.** The helmet setting `script-src-attr 'none'` broke the portal's `onclick` handlers, so a portal-specific CSP with `'unsafe-inline' 'unsafe-eval'` was added. |
| "Portal enhancement" backlog (35 items: smart notifications, offline PWA, responsiveness, shift reminders, attendance map) | All open | — |

**What this history teaches us:**

- The native wrapper was set up as dependencies and scripts but never became a product.
- "PWA" and "push" were declared done without the files that make them work.
- The one mobile capability that shipped on the server, geofenced punching, was undermined by trusting client-supplied identity.
- Loosening the CSP to keep inline handlers working turned the portal into a stored-XSS risk. Our strict CSP and escaped template rendering are the right base, and are the reason a PWA here must use served files, never inline code.

### 3.2 Where we stand today

| Capability | State in our code |
|---|---|
| Viewport and iOS web-app tags | Present in `index.html`: `viewport-fit=cover`, `apple-mobile-web-app-capable`, `mobile-web-app-capable`, status-bar style, `apple-mobile-web-app-title`, `format-detection`. |
| Safe areas | `--safe-t/-b/-l/-r` tokens from `env(safe-area-inset-*)` in `signature.css`. |
| Bottom tab bar and sheet menu | `mountTabs()` in `signature.mjs`: the first 4 available of `portal, home, work, inbox, notifications, requests, leave`, plus «الفهرس». The sheet can be dragged. |
| `theme-color` | A single fixed `#000000`. It does not follow the theme (auto/dark/light) or the design choice (`03-current-ui-map.md` notes it must be updated). |
| Web app manifest | **Missing.** No `<link rel="manifest">` and no whitelisted `.webmanifest`. |
| Icons (`apple-touch-icon`, 192/512 PNG, maskable) | **Missing.** The static whitelist in `server.mjs` serves no images at all. |
| Service worker, offline | **Missing.** Also `Cache-Control: no-store` applies to every response, including static files. |
| Push | **Missing.** No subscription storage, no VAPID keys, no sender. |
| Geolocation | **Explicitly blocked**: `Permissions-Policy: camera=(), microphone=(), geolocation=()`. |
| CSP | `default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; …`. `worker-src` and `manifest-src` fall back to `'self'`, so a same-origin `/sw.js` and `/manifest.webmanifest` are **already allowed by CSP**. They only need whitelisting in `server.mjs`. |
| Hosting | None that employees can reach (`00-platform-inventory.md` line 78). **Every capability below requires HTTPS on a reachable host.** Service workers, push and geolocation all need a secure context, and `localhost` on a laptop is not reachable from a phone. |

### 3.3 Decisions

All four follow the zero-dependency rule (Node built-ins only, no npm packages, no CDN) and the strict CSP (no inline script or style, no external origins in the page).

**A. Home-screen installable PWA: adopt (P2, S). Build it in the same stage as hosting.**

1. Add `app/static/manifest.webmanifest`:
   - `name` "3,6T", `lang: "ar"`, `dir: "rtl"`, `display: "standalone"`, `start_url: "/#home"`, `scope: "/"`;
   - `background_color` and `theme_color` from the brand guideline (paper `#FAF9FF` or charcoal `#353535`; turquoise `#16A085` only as the accent);
   - icons at 192, 512 and 512-maskable.
2. Add `apple-touch-icon` 180 px PNGs. Draw them from the existing `brand-logo.mjs` mark, not new artwork.
3. In `server.mjs`, whitelist those files with correct MIME types (`application/manifest+json`, `image/png`) and add them to `tests/static-modules.test.mjs` expectations.
4. In `index.html`, add `<link rel="manifest">` and `<link rel="apple-touch-icon">`, and add two `theme-color` metas with `media="(prefers-color-scheme: …)"`. `theme-boot.js` can then update the one in use when the user forces a theme.
5. Do **not** add a custom "install" banner in the first pass. iOS has no `beforeinstallprompt`. A one-line help entry in «المظهر» (appearance) or «أمان حسابي» (account security) explaining "Share → Add to Home Screen" is enough.

**B. Offline shell: adopt a minimal one (P2, M). Never cache personal data.**

1. `app/static/sw.js`, served from `/sw.js` so its scope is `/`:
   - On install, precache the whitelisted static assets under a versioned cache name, derived from a build hash that `server.mjs` injects or from a constant bumped by `scripts/check.mjs`.
   - Serve them **network-first, falling back to the cache**, so a deploy is picked up immediately despite the current `no-store`.
   - **Never** put `/api/*` responses, `/api/*/print` documents or file downloads in the cache. Pass them through untouched.
2. When the network fails on navigation, show a static offline view (Arabic, RTL, brand colours): «لا يوجد اتصال. لا يُسجَّل الحضور ولا تُرسل الطلبات دون اتصال بالخادم.» ("No connection. Attendance cannot be recorded and requests cannot be sent without a connection to the server.")
3. **No offline punch queue.** Punch time is the server's time by rule (`attendance.punch`). A queued punch would either lie about the time or need a new client-time rule that the HR manager would have to accept.
4. On logout, and in `security` "sign out everywhere", call `caches.delete` on our cache names and `registration.unregister()` for a shared device.
5. `/sw.js` itself must be sent with `Cache-Control: no-cache` and `Service-Worker-Allowed` is not needed. CSP already permits it.

**C. Push notifications: adopt, but last (P3, L).** Prerequisites: hosting, the PWA (A) and wider notification sources (P1-5).

1. **Zero-dependency sender** in a new `app/push.mjs` using `node:crypto` only:
   - VAPID (RFC 8292) as an ES256 JWT signed with `crypto.sign('sha256', …, {dsaEncoding:'ieee-p1363'})`;
   - payload encryption `aes128gcm` (RFC 8291): ECDH P-256, then HKDF-SHA-256, then AES-128-GCM;
   - delivery by `fetch` to the subscription endpoint with `TTL` and `Urgency` headers.

   This is about 150 lines and needs no npm package.
2. **The server makes outbound calls.** This is the platform's first outbound network dependency: to Apple, Google and Mozilla push services. It needs the owner's explicit decision. Page CSP is unaffected: `connect-src` governs the page, and the subscription call is made by the browser.
3. **Payload rule:** no personal data in the notification body. Send a generic Arabic line ("لديك طلب ينتظر قرارك" (you have a request awaiting your decision) / "صدر تحديث على طلبك" (there is an update on your request)) plus an opaque notification id. The service worker's `notificationclick` opens `/#notifications` or the deep link *after* the session is checked. Do not put approve/reject buttons in the notification: `04-service-platforms-and-tech.md` requires an authenticated session for any decision.
4. **Opt-in UI:**
   - a switch in «أمان حسابي» or a new «التنبيهات» (alerts) row: "Enable alerts on this device";
   - per-device list with revoke;
   - on iOS, show the switch only when `navigator.standalone` is true (web push on iOS needs an installed PWA, 16.4+).

   Storage: a new `push_subscriptions` table (user, endpoint, keys, created, last success, revoked), and delete the row on HTTP 404 or 410.
5. **Declarative Web Push (iOS 18.4+)** can come later. It is not required.

**D. Geofenced attendance: adopt as evidence, not as a gate (P2, M-L).** Requires the HR manager's acceptance of a written location policy and a PDPL-compliant notice before any real use.

1. **Header:** change `geolocation=()` to `geolocation=(self)` in `server.mjs`. Keep `camera=()` and `microphone=()` blocked; there is no selfie check-in.
2. **Client** (`attendance-ui.mjs` and the Today card):
   - Only when the employee presses check-in, run a best-of-N reading taken from the old app: `watchPosition({enableHighAccuracy:true, maximumAge:0})`. Stop at the first fix with accuracy ≤ 20 m, otherwise use the most accurate fix after 10 s, and give up at 12 s.
   - Show "جارٍ تحديد موقعك…" (locating you…) and then distance and accuracy.
   - **No background tracking, no continuous watch** after the punch.
3. **Server** (`attendance.mjs` `punch`):
   - Accept an optional `{lat, lng, accuracy}` and compute haversine against HR-configured zones in a new `attendance_zones` table (name, centre, radius, active, proposed by / approved by).
   - Store only the *result*: `inside|outside|unavailable`, distance rounded to 10 m, and accuracy. Do not store raw coordinates, or store them with a short retention stated in the policy.
   - The client decision is never trusted.
4. **Outcome rule, consistent with our existing "no automatic deduction" principle.** An outside-zone or no-location punch is **recorded with a flag and joins the day's "needs explanation" list**. It is never refused and never deducted. The old app also saved out-of-zone punches, but only with a toast. Ours makes the flag visible to the employee and the manager.
5. **Zone editor for HR:** "use my current location", a numeric radius from 50 to 2000 m in steps of 25 with ± buttons, and a coordinates readout. **No map tiles**: they are an external origin, blocked by CSP and a privacy leak. The two-person rule applies, like holidays: proposed by one person, approved by another.
6. **Permission-denied copy:** "لم تسمح بالوصول إلى الموقع. يُسجَّل حضورك بلا موقع ويظهر لمديرك «يحتاج توضيحًا»." ("You did not allow location access. Your attendance is recorded without a location and shows to your manager as 'needs explanation'.") Then a short how-to for iOS Safari and Android Chrome settings.
7. **Honesty note for the owner.** Browser location is easy to spoof. It shows that a phone *reported* being on site. It does not prove that the person was there.

**E. iOS native wrapper (Capacitor or similar): do not adopt.**

- It breaks the zero-dependency rule: the Capacitor packages and the Xcode/CocoaPods toolchain.
- It adds App Store review, an Apple developer account and a second release pipeline.
- It buys nothing the PWA does not give us for this use case: home-screen icon, standalone window, push since iOS 16.4, foreground geolocation.
- The old app's own history supports this: it installed Capacitor and wrote App Store tasks, but never produced a native project or used a single native plugin (section 3.1).

Revisit only if the owner needs background geofencing (automatic punch on arrival), MDM distribution, or biometric-gated actions beyond WebAuthn.

---

## 4. Prioritised adoption list

Effort: **S** ≈ under a day, **M** ≈ 1-3 days, **L** ≈ a week or more (including tests).

Constraints that apply to every item:

- Screens (`*-ui.mjs`) carry no styling. New looks go in `signature.css`, `style.css` or `journey.css`.
- Design behaviour belongs in `signature.mjs`, not `app.mjs`, because of the `vm` tests (`03-current-ui-map.md` §0.3).
- A new static file requires a `server.mjs` whitelist entry.
- Colours come from the brand guideline only.
- Every item ends as "tested locally". Acceptance by the HR manager is a separate step.

### P1: shorten the everyday employee paths (no hosting needed)

| # | Change (concrete UI) | Files | Effort | Acceptance criteria |
|---|---|---|---|---|
| P1-1 | **"Today" card at the top of `home`.** Shows today's check-in and check-out times from the server and one large primary button: «سجّل حضورك» (record your check-in) or «سجّل انصرافك» (record your check-out), or "done today". The button uses the existing `/attendance/punch` with a one-step confirm that shows the server time, and a link «طلب تصحيح» (request correction). This means `home` is no longer strictly read-only for this one action; the owner should confirm that. | `app/home.mjs` (add `attendance:{check_in,check_out,can_check_in,can_check_out}` from `attendance.mjs`), `app/static/home-ui.mjs` (card and a `form('punch_in'\|'punch_out')` that reuses the attendance payload), `signature.css` | M | From `#home` on a 375 px viewport, check-in takes ≤ 2 taps. After a punch the card re-renders with the server time and the other button. A 409 (`already_checked_in`) shows the server's Arabic message. The button hides for `admin` (the server rejects staff-only screens). Covered by a `ui-render` test. |
| P1-2 | **Quick-action row on `home`**: طلب إجازة (request leave), طلب خطاب (request a letter), قسيمتي (my payslip), تصحيح حضور (attendance correction), طلب خدمة (request a service). Each is a 44 px chip. Actions that open a form go to a deep link such as `#leave/new` or `#letters/new`, which opens that screen's form once it has rendered. Only actions the account has permission for are shown. | `app/static/home-ui.mjs`, `app/static/signature.mjs` (after-render hook: when the route's second segment is `new`, click the screen's primary `[data-action]` once), `journey.css` | M | Each quick action reaches its form or document in 1 tap. With no balance, «طلب إجازة» is hidden, not dead. Back from the dialog returns to the screen, not to a blank page. No change to `app.mjs` imports. |
| P1-3 | **Leave balance at a glance, per type, labelled.** Replace the summed tile with the main type's remaining days (e.g. «سنوية: 12 يومًا» (annual: 12 days)). The list shows "remaining of posted" and "reserved" per type, with a thin bar. Show the leave-type *name*, never the local code. | `app/routing.mjs` / `app/home.mjs` (pass `posted_days`, `reserved_days` and a display name), `app/static/home-ui.mjs`, `portal-ui.mjs` | S | No raw code such as `synthetic_annual` appears on `home` or `portal`. Tile and list agree with `#leave` for the same user. 0 days shows as "لا أيام متاحة" (no days available), not red noise. |
| P1-4 | **Employee-first tab bar.** Make `tabOrder` role-aware. Employee: الرئيسية (home), مهامي (my tasks), الإشعارات (notifications), إجازاتي (my leave) + الفهرس (index). Manager/HR: الرئيسية, قراراتي (my decisions), مهامي, الإشعارات + الفهرس. Merge `portal` into `home` as `UX-COPY-AUDIT.md` §2.2 recommends: keep the `#portal` route as an alias. | `app/static/signature.mjs` (`tabOrder`/`mountTabs`), `app/static/app.mjs` (nav label only), `home-ui.mjs` (absorb portal's "most used services") | S-M | An employee with no decisions never sees an empty «قراراتي» tab. «ملخصي» no longer takes a tab slot. `#portal` still resolves. Tab labels match the index labels. |
| P1-5 | **Unread badge on notifications, and better rows.** Put a live count on the notifications tab and nav row, like `#inbox`. Show the request title in each row. Opening a notification marks it read. Add "mark all as read" (تعليم الكل كمقروء). Refresh the counts on `visibilitychange` (no polling). | `app/server.mjs` + `app/workflow.mjs` (`/api/notifications/count`, read-all, title in list), `app/static/app.mjs` (row markup; badge in the same guarded `.then` as the inbox count), `signature.mjs` (visibility refresh) | M | A new request update shows a badge within one navigation, or on returning to the tab. The count reaches 0 after opening. No timer-based polling. The server keeps its existing visibility filter. |
| P1-6 | **Attendance screen, employee first.** The punch button is primary and large. Today's times sit beside it. Correction, mission and overtime move into a secondary "more" row. HR actions go to a separate section below the employee's own block. | `app/static/attendance-ui.mjs` (markup order only), `signature.css` | S | On 375 px the punch button is the first control, at least 44 px, and never wraps into a row of 8 buttons. HR tools are not above the employee's own day. |
| P1-7 | **Leave screen, employee first.** For a non-HR user, lead with balance cards (remaining, reserved, posted) and the «طلب إجازة» (request leave) button. Keep the ledger inside the existing `<details>`. Remove the "بيانات مصطنعة للتطوير المحلي" (synthetic data for local development) panel from the screen body, as `UX-COPY-AUDIT.md` §3.1-هـ recommends; the synthetic label moves to the shell note. The leave form hint shows "المتاح: N يومًا من رصيد {year}" (available: N days of the {year} balance). | `app/static/leave-ui.mjs` | S | An employee sees their available days and the request button without scrolling on 375 × 812. The dialog shows available days before any date is typed. |

### P2: mobile platform and richer self-service (hosting-dependent items marked ⌂)

| # | Change | Files | Effort | Acceptance criteria |
|---|---|---|---|---|
| P2-1 ⌂ | **Installable PWA** (section 3.3-A): manifest, 180/192/512/maskable icons, `theme-color` per scheme. | new `app/static/manifest.webmanifest` and icon PNGs, `app/server.mjs` (whitelist and MIME types), `app/static/index.html`, `theme-boot.js`, `tests/static-modules.test.mjs` | S | Chrome Lighthouse reports "installable". On iOS, "Add to Home Screen" shows the 3,6T icon and opens standalone at `#home` with the right status-bar colour. CSP unchanged. No external URL in the manifest. |
| P2-2 ⌂ | **Offline shell** (section 3.3-B): versioned precache of static assets, network-first; Arabic offline view; `/api` is never cached; caches cleared on logout. | new `app/static/sw.js`, `app/static/signature.mjs` (register, guarded by `'serviceWorker' in navigator`), `app/server.mjs` (whitelist; `no-cache` for `sw.js`), `app.mjs` logout hook | M | Airplane mode shows the offline view, not a browser error. DevTools → Cache Storage contains no `/api/` entry. After a deploy the new assets load on the first online visit. Logout empties Cache Storage. `scripts/check.mjs` passes (no `eval`). |
| P2-3 ⌂ | **Geofenced check-in as evidence** (section 3.3-D): `geolocation=(self)`, best-of-N sampling, server-side haversine, zone editor with two-person approval, outside-zone or no-location → "needs explanation". | `app/server.mjs` (header, routes), `app/attendance.mjs` (`punch` accepts location; new zones functions), new migration `attendance_zones` plus result columns, `app/static/attendance-ui.mjs`, `home-ui.mjs` (Today card) | M-L | Denying permission still records the punch with the flag `unavailable`. A punch 500 m away is recorded as `outside` with the distance, and appears in the day's "needs explanation" list. The server ignores any client-computed `inside`. Raw coordinates are not stored beyond the stated retention. A zone cannot be activated by the person who proposed it. The HR manager has accepted the policy text before the feature flag is switched on. |
| P2-4 | **Live leave-day count in the form.** As dates are picked, show "N يوم عمل — يبقى M" (N working days — M left), using the balance's `calendar.weekdays` and holidays already in the payload. Show the overage in red and disable submit when it exceeds the available days; the server still decides. | `app/static/leave-ui.mjs` (hint data), `app/static/signature.mjs` (small input listener on `#dialog` for `[name=start_date],[name=end_date]`) | M | The count matches the server's `work_dates` for the same range in 10 sample ranges, including weekends and configured holidays. Submit is blocked client-side on overage. The server rejection is still shown if the client is wrong. |
| P2-5 | **Wider notification sources.** Leave decided, letter issued, payslip published, correction decided, absence proposed (asks for the employee's statement), policy awaiting acknowledgement. Each gets a Arabic title and a deep link. | `app/leave.mjs`, `letters.mjs`, `payroll.mjs`, `attendance.mjs`, `policy-acknowledgements.mjs` (write notifications), schema (`link`, `title` columns if `request_id` stays nullable), `app.mjs` row renderer | M-L | Each event creates exactly one notification for the right person and none for others (scoped test). A payslip notification never contains an amount. |
| P2-6 | **Filter chips with counts** on list screens employees use: my requests (open, awaiting me, completed), attendance days (present, late, needs explanation), notifications (unread, all). | `signature.mjs` (`mountCardFilter` already exists: extend it to show counts), screen markup `data-` attributes | S-M | The chip counts equal the rows shown after filtering. The chips are keyboard-operable with `aria-pressed`. |
| P2-7 | **Attendance month grid** («أيامي») as a 7-column calendar (week starting Sunday, per our `workdays`), with state tones (present, late, needs explanation, leave, holiday, mission) and a legend. Tapping a day shows its times and a «طلب تصحيح» (request correction) action. Include a "Today" reset. | `app/static/attendance-ui.mjs` (markup), `journey.css` | M | The grid for a month equals the current list (same states and counts). It is usable at 320 px. Day cells are at least 44 px. Tone names use `UX-COPY-AUDIT.md` §1.6 vocabulary. |
| P2-8 | **Empty states with an action**, borrowing the old `EmptyState` pattern, for employee screens that are empty today: no letters (→ طلب خطاب (request a letter)), no leave requests (→ طلب إجازة (request leave)), no payslip yet (explain "after payroll approval"), no notifications. | `app/static/app.mjs` (`empty()` accepts an optional action; guarded), relevant `*-ui.mjs` | S | Every employee-facing empty state has either one action or one sentence explaining when data will appear. No empty state claims data that the server did not return. |

### P3: later, or only on request

| # | Change | Files | Effort | Acceptance criteria |
|---|---|---|---|---|
| P3-1 ⌂ | **Web Push** (section 3.3-C): zero-dependency VAPID and `aes128gcm` sender, per-device opt-in, generic payloads, click opens the deep link after the session is checked. | new `app/push.mjs`, migration `push_subscriptions`, `app/server.mjs` (subscribe, unsubscribe, public key), `sw.js` (`push`, `notificationclick`), `security-ui.mjs` (device list) | L | On an installed iOS 16.4+ PWA and on Android Chrome, a new "awaiting your decision" event arrives within 1 minute. The payload has no name, amount or request title. Revoking a device stops delivery. A 410 response deletes the subscription. The owner has approved outbound calls to the push services. |
| P3-2 | **Letter wizard**: pick the addressee kind first (bank, embassy, government, other), then an HR-maintained list of addressees (not a bundled JSON). Show only templates that match that kind. | `app/static/letters-ui.mjs`, `app/letters.mjs` (addressee list managed by HR) | M | Two steps to a filled form. The list is editable only by `hr.letters.prepare`. The free-text addressee remains available. |
| P3-3 | **Team "who is out" strip** for managers on `home`: today and this week, drawn from approved leave, missions and holidays, with names only for the manager's own team. | `app/home.mjs`, `home-ui.mjs` | M | A manager sees only their direct team. An employee does not see this block. The data matches `#leave` calendar entries. |
| P3-4 | **Leave policy readable by employees**: a collapsible "what each leave type means" section on `#leave`, driven by HR-accepted policy text with its source (the pattern from the old app's accordion; its content is not copied). | `app/static/leave-ui.mjs`, the policy source already used by `leave-accrual`/`benefits` | S-M | No entitlement number appears unless it is present in an HR-accepted policy record. |
| P3-5 | **"Last updated hh:mm" line and a manual refresh** on `home` and `attendance` in place of any "live" wording. | `home-ui.mjs`, `attendance-ui.mjs` | S | The time shown is the server response time. No "auto-updated" wording anywhere. |
| — | **Native iOS wrapper**: not adopted (section 3.3-E). | — | — | — |

---

## 5. What I could not see

- **About 44 other pages of the old app** were not in the snapshot. Among them, whichever of these exist: its router and layout (`App.tsx`, sidebar, `PageTemplate`), `EmployeePortalLogin`, contexts (`EmployeeContext`, `useAuth`), `EmployeeProfileModal`, the Excel/PDF export helpers, `data/leaveTypes.json` and `saudiBanks.json`, any notifications page, payroll/payslip pages, and the Capacitor iOS project (`capacitor.config.*`, `ios/`). Route-level role gating therefore **cannot be confirmed**; no page-level gating exists in the pages read.
- **Screenshots and a running build of the old app.** All mobile behaviour above is read from classes and inline styles, not observed on a device.
- **The live employee-portal audit** (`EMPLOYEE-PORTAL-AUDIT-20260919.md`) did not exist when this was written. Observed tap counts there override the code-derived counts in section 2.2.
- **Our CSS at device width** was not rendered for this document. Statements about tap counts assume the index sheet opens with «مساحتي» expanded while on `home`, which is what `groupedNavigation` does.
