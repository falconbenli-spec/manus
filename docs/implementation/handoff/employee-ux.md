# Employee first: Today card, my requests, my profile, one front door, variants, PWA — 19 September 2026

**Sources.** `docs/product/audits/EMPLOYEE-PORTAL-AUDIT-20260919.md` (G1, G5, G7, B8, B11–B14, B16, B26–B29, quick wins 3, 6, 7, 12, 13, 15), `docs/product/benchmark/REF-APP-FRONTEND.md` (P1-1, P1-2, P1-4, P1-5 badge only, P2-1, P2-2), `REF-APP-GAP-REPORT-20260919.md` (P1 #7, #8, #9), and the owner's scope addition of the same day: options inside one request («طريقة الاختيار من نفس الطلبات»).

**State.** Built locally and tested locally. **Not accepted by any process owner.** Nothing here is connected to an outside party. Install and offline need HTTPS hosting, which is still an owner decision (see the last section).

## 1. What was built

### 1.1 Home «اليوم» card and quick actions
- `app/home.mjs`: `todayCard()` and `quickActions()`; the home payload gains `today_card` and `quick_actions`.
  - Attendance comes from `dayStates()` in `app/attendance.mjs` itself (no second rule). The card shows check-in and check-out in server time and one button.
  - Day status: on approved leave, public holiday, rest day under the working-time policy, approved mission, or a working day. Also the next leave (approved or awaiting) and the next approved public holiday.
  - Next deadline: the earliest of an open catalog request's service-level due date, an assigned task's due date, or one of the employee's own documents within 60 days. Overdue items come first.
- `app/static/home-ui.mjs`: the card, then the quick-action row, then the existing tiles and lists. The long auditor-style intro became one sentence (B29). Finance sources the employee does not hold are no longer named on the page (`unavailable_notice`); the data still names them for tests and admins. Drafts read «مسودة لم تُقدَّم بعد» instead of «null يوم عمل متبق» (B8).
- **One-tap punch.** `data-action="punch"` in `app/static/app.mjs` calls the existing `POST /api/attendance/punch` with `{kind}` and toasts the server time from the response. A 409 shows the server's Arabic message. Hidden for admin. **This makes home no longer read-only for this one action; REF-APP-FRONTEND P1-1 asks the owner to confirm that.**
- Quick actions: طلب إجازة `#leave/new`, طلب خطاب `#letters/new`, قسيمة الراتب `#payroll/latest`, تصحيح حضور `#attendance/correction`, خدمة جديدة `#catalog/new`. An action whose module cannot take the request now is hidden, not dead: leave needs a balance with days; letters need a published template.
- The «طلباتي المفتوحة» tile now counts the unified list, not catalog requests alone.

### 1.2 Deep links
- `app/static/deep-links.mjs` (pure, no DOM): `DEEP_LINKS`, `parseDeepLink(hash)`, `unavailableText()`, `MODULE_SHORTCUTS`, `DEEP_LINK_FIELDS`.
- `followDeepLink()` in `app.mjs` runs after a screen renders: it clicks the screen's own `[data-operation]` button once, so the form keeps the screen's rules; then `history.replaceState` puts the URL back to the screen (`#leave`), so a reload does not reopen the form and closing it leaves the employee on the screen.
- Parameters: `?id=<row>` picks that row's button (a specific leave balance). Other parameters only prefill fields listed in `DEEP_LINK_FIELDS` and only with a value that exists in the field's list; `#letters/new?type=salary` sets `type_code=salary`. Unsafe values are dropped.
- If the button is missing, a toast says when the form becomes available (no balance yet, no approved template, no payslip until payroll approval).
- `#payroll/latest` opens and scrolls to the newest payslip (`data-payslip` added in `payroll-ui.mjs`). `#catalog/new` opens the new-request launcher.
- Guarded with `typeof parseDeepLink` because `tests/dialog-races.test.mjs` and `ui-race.test.mjs` run `app.mjs` in a VM sandbox with imports stripped.

### 1.3 «طلباتي» — one list of the employee's own requests
- `GET /api/my-requests` → `myRequests()` in `app/my-requests.mjs`. No `user_id` parameter: the list belongs to the caller.
- Sources, each read by the module's own board function as the caller, then filtered to what the caller filed: catalog requests (`listRequests`), leave (`listLeave`), expense claims and cash custody (`expensesBoard`), letters (`lettersBoard`), HR cases (`hrCasesBoard().my_cases`; anonymous reports are never linked to an account and never appear), overtime and missions (`attendanceExtras`), training (`growthBoard`).
  - **Exception:** attendance corrections are read directly with `user_id=caller`. The first visibility clause of the attendance module is "the owner of the correction", and building the whole attendance board would compute every employee's month for an HR user.
- One status vocabulary (مسودة، قيد الاعتماد، معاد إليك، معتمد، قيد التنفيذ، مكتمل، مرفوض، ملغى) with the module's own status name beside it. Due dates only where a service level exists (catalog services, HR cases with a target).
- Order: waiting for you, then open by nearest due date, then most recent.
- Screen: `app/static/my-requests-ui.mjs` (`#my-requests`). The nav entry «أين طلباتي» now opens this list («طلباتي»); the old per-request holder view stays at `#my-request-timeline`, linked from the page.

### 1.4 «ملفي» — the employee's own profile
- `GET /api/profile` (own) and `GET /api/profile/<id>` → `profileView()` in `app/my-profile.mjs`; screen `app/static/profile-ui.mjs` (`#profile`).
- Shows job title, department, line manager, hire date, employment type, contract type, contract end, work location; ID/iqama/passport/work permit with the number masked `••••1234` and expiry state; the verified salary account with the IBAN masked (only `iban_last4` is read; the sealed IBAN column is never selected); dependants; every document.
- **Privacy:** the owner and people officers only. A people officer is `role='hr'` or an explicit `employees.view` grant (`holds`, so platform-admin rights alone do not open a file). The line manager, colleagues and admin get 404 (not 403, so the page does not confirm who works here).
- **Dependants** are read through a new `dependantsOfEmployee()` in `app/benefits.mjs`, so that module remains the only reader of `medical_dependants` (an existing test checks this). Visible to the employee themself and to `hr.benefits.manage` holders; `null` for anyone else. **This widens the earlier rule "only the benefits capability sees dependants" to include the employee. Owner decision recorded as the instruction of 19 September; the data-protection owner should confirm.**
- Nothing is editable. Each section has a button that opens the matching catalog request (HR-PROFILE-UPDATE, HR-DOC-RENEWAL, HR-BANK-CHANGE, HR-BENEFIT-CLAIM).
- B14: the employee's own rows in «انتهاء الوثائق» and on home now link to `#profile`, not the 403 `#employees`. The request picker no longer offers the «السجل الوظيفي» workspace link to people who would get 403.

### 1.5 One front door: duplicated catalog services open their module
- `app/module-routes.mjs`: `MODULE_ROUTES` (11 services routed), `KEPT_AS_REQUESTS` (5 kept, with reasons), `routeReadiness()`, `annotateCatalog()`. `/api/catalog` adds `module_link`, `module_key` and `module_name` to a routed service **only when that module can take the request from this account**; otherwise the generic request stays, so nobody is sent to a dead end.

| Catalog code | Opens | Routed when |
|---|---|---|
| HR-LETTER, HR-SALARY-CERT, HR-EXPERIENCE-CERT | `#letters/new` | a letter type has a published template |
| HR-ATTENDANCE-FIX | `#attendance/correction` | any employee account |
| HR-OVERTIME | `#attendance/overtime` | any employee account |
| HR-GRIEVANCE | `#hr-cases/new` | any employee account |
| TAL-TRAINING | `#growth/training` | any employee account |
| TAL-PERFORMANCE-REVIEW | `#performance` | the employee has a review in an opened cycle |
| ADM-EXPENSE-CLAIM | `#expenses/new` | any employee account |
| FIN-CUSTODY | `#expenses/custody` | any employee account |
| PMO-TIMESHEET | `#timesheets` | any employee account |

Kept as generic requests, because the module gives the employee no form: HR-BENEFIT-CLAIM (benefits is HR-only), HR-DOC-RENEWAL (expiry only watches dates), HR-RESIGNATION (lifecycle is HR-only), HR-BANK-CHANGE and HR-SALARY-ADVANCE (payroll movements are for the payroll team). The audit's count of 13 is covered by these 11 plus the 5 explained (the audit table did not list its 13 explicitly).

- The catalog codes stay in the catalog for search and for existing requests. The admin is not redirected.
- **Not enforced on the server.** `POST /api/requests` still accepts these codes. Blocking them would break drafts in flight and ~20 existing tests that use HR-LETTER as the seed service. **Owner decision:** whether to block generic requests for routed services once each module is live.

### 1.6 Service variants (owner's scope addition)
One card for near-duplicate services; the first step of its form is choosing the type.

**Model (for other agents to plug in)** — `SERVICE_VARIANTS` in `app/service-catalog.mjs`:

```js
{code:'VAR-IT', name_ar, name_en, section, department_id, words:[…], description,
 options:[{code:'repair', name_ar, name_en,
           service:'IT-SUPPORT',            // catalog service the request is created on: its fields, approval chain and SLA
           link:'#…', ready:'letter:salary', // optional module form, used when ready for this account (as in module-routes)
           preset:{field:value},            // fixed values, hidden from the form and enforced by the server
           docs:['…'],                      // required documents shown before submit
           words:['…']}]}                   // extra search words; option name and service code are always searched
```
- **Chain, SLA and fields per option** come from the option's service, so the chosen option drives the fields, the routing (`planApprovals`) and the due date (`serviceClock`) through the existing engine, with no second copy. `chainPreview()` builds «سيمر طلبك على: مديرك ← الموارد البشرية، خلال 3 أيام عمل» (Arabic and English) from the service policy and `service_directory.target_days`; the client shows the same sentence (`routePreview()` in `request-picker.mjs`) under every composer, variant or not.
- **Server:** `GET /api/catalog/variants` → `variantCatalog()` (groups as this account sees them; an option is offered if its service is in the catalog or its module is ready; a group with no option is hidden). `POST /api/requests` accepts `variant:{group,option}`; `applyVariant()` resolves the service on the server, rejects an unknown option (400 `variant_unknown`), a mismatched `service_id` (400 `variant_mismatch`) or a module-only option (409 `variant_module`), and writes `preset` values over whatever the browser sent. Required fields are enforced at submit as for any request.
- **Aliases:** old service codes stay in the catalog and in existing requests. The launcher hides aliased services from browsing and shows the group card instead; search matches group names, option names, option words and old codes, and preselects the best option. «تعريف» lands on «خطاب» with «تعريف بالراتب» chosen; «HR-SALARY-CERT» and «IT-SUPPORT» land on their cards.
- **Groups today:** «خطاب» (salary, employment, experience, bank, embassy; each opens `#letters/new?type=<code>` when that type has a published template, otherwise the catalog letter service), «إجازة» (options are the employee's own balances with available days, each `#leave/new?type=<type>&id=<balance>`), «تعديل بيانات» (address, contact, bank, dependants, qualifications, ID, passport), «طلب إداري» (8 ADM services), «أجهزة وتقنية» (device, repair, access, software, password), «مزايا» (medical claim, salary advance).
- **Plug-in points:**
  - Letters/payroll agent: the letters wizard can read `type` from the deep link; today it is mapped to `type_code` in `DEEP_LINK_FIELDS`.
  - Leave agent: the leave card lists balances from `listLeave`; if the leave policy adds types, they appear once a balance exists. Leave types without a balance are not offered.
  - Benefits agent: add options to «مزايا» with `link:'#benefits…'` and a `ready` key once an employee-facing form exists.
- Client: `mergeVariants`, `searchVariants`, `variantComposer` in `request-picker.mjs`; `pick-variant` and `showVariant()` in `app.mjs`; the request form sends `variant_group`/`variant_option`.

### 1.7 Employee-first navigation
- `app/access.mjs`: `requirements.view` is no longer granted to everyone. The super admin keeps it; anyone else needs an explicit grant. «نطاق المنصة» and «تطوير الخدمات» (and their APIs) follow it.
- `app/static/app.mjs` `shell()`: an ordinary employee (`role='employee'`) no longer sees «ملخصي», «الطلبات», «الإدارات», «بطاقات الخدمات», «نواقص دليل الخدمات» (now `catalog.manage` or `executive.view`), «مراجعة المصادر» (now `knowledge.manage`), «المراكز التخصصية», «المساعدون الذكيون» (disabled placeholder), «انتهاء الوثائق» (own documents are in «ملفي»), «تقويم الالتزامات» or «مركز التقارير». Delivery screens (clients, campaigns, content, offerings, project templates, scope guard, hours, call sheets, equipment) show only for an employee on a client team or project (`delivery_member` in `/api/me`). New entries: «طلباتي», «ملفي». In the live check the employee menu had **28** entries (was 49).
- Page headings use the account's own nav label («إجازاتي», not «الإجازات والأرصدة») (B13). «مراجعة الرواتب» reads «زياداتي» for employees.
- **Three dashboards merged:** `#portal` (ملخصي) now renders home for every role and has left the menu; «مهامي» stays as the to-do list. Home's lists cover the portal's content. `portal-ui.mjs` is no longer imported.
- **Phone tab bar** (`signature.mjs`, tab-bar code only): for employees الرئيسية، طلباتي، الإشعارات، إجازاتي، then «المزيد» (opens the index). Other roles: الرئيسية، قراراتي، طلباتي، الإشعارات + «الفهرس». `app.mjs` writes `html[data-audience]`.
- **Unread badge:** new `GET /api/notifications/count` (`{unread}`), painted on the notifications nav row and tab after every render. No polling. The notifications agent (migration 100) may own this endpoint later; it is one line in `server.mjs`.
- The catalog page's «خدمات التشغيل المتخصصة» cards now list only screens the account can open (B14).
- English: home, «طلباتي», «ملفي», the Today card and quick actions are fully bilingual through a `tr()` passed to screens by `app.mjs` (`render(data,{e,button,money,tr,lang,date})`). Data values written by the server (service and leave-type names, some status names) stay Arabic; other modules' bodies stay Arabic.

### 1.8 Installable PWA
- `app/static/manifest.webmanifest`: Arabic name, `lang:'ar'`, `dir:'rtl'`, `start_url:'/#home'`, standalone, brand charcoal `#353535` with a light `#FAF9FF` entry under `user_preferences.color_scheme` (per-scheme colours; the live `theme-color` meta is still synced by `signature.mjs`), shortcuts to leave, my requests and attendance correction.
- Icons `app/static/icons/icon-192.png`, `icon-512.png`, `icon-maskable-512.png`, `apple-touch-icon.png`: drawn from `brand-logo.mjs` by `scripts/make-icons.mjs` with a local headless Chromium (`CHROME_PATH`), no new artwork, no npm package.
- `app/static/sw.js`: network-first for navigation with an Arabic offline page (503, its own strict CSP, no script); caches only static files (`.mjs`, `.css`, `.js`, `.webmanifest`, fonts, icons), network-first; **never** intercepts `/api/*` or `/verify/*`; never caches `sw.js`; old versions deleted on activate. No offline punch queue.
- `app/static/pwa.mjs`: registers only on HTTPS or localhost; `clearOfflineCaches()` runs on logout (deletes our caches and unregisters the worker).
- `server.mjs` whitelist: manifest (`application/manifest+json`), `sw.js` (`Cache-Control: no-cache`), the four icons (`image/png`), and the new modules. CSP unchanged.
- `index.html`: only `<link rel="manifest">` was added, as instructed. **Not added:** `<link rel="apple-touch-icon">` and per-scheme `theme-color` metas. iOS reads the manifest icons from 16.4, but an explicit apple-touch-icon link is still recommended; it is one line for whoever owns `index.html` next.

## 2. Files
- **New:** `app/module-routes.mjs`, `app/my-requests.mjs`, `app/my-profile.mjs`, `app/static/deep-links.mjs`, `app/static/pwa.mjs`, `app/static/sw.js`, `app/static/manifest.webmanifest`, `app/static/icons/*.png`, `app/static/my-requests-ui.mjs`, `app/static/profile-ui.mjs`, `scripts/make-icons.mjs`, `tests/employee-ux.test.mjs`, `docs/testing/test-results-employee-ux-20260919.txt`.
- **Changed:** `app/server.mjs` (routes, whitelist, `delivery_member`), `app/access.mjs`, `app/home.mjs`, `app/expiry.mjs`, `app/benefits.mjs` (one export), `app/service-catalog.mjs` (variants appended), `app/static/app.mjs`, `home-ui.mjs`, `request-picker.mjs`, `operations.mjs`, `hr-design.mjs`, `payroll-ui.mjs` (one attribute), `signature.mjs` (tab bar only), `index.html` (manifest link only), `journey.css` (new section 9), `tests/platform.test.mjs` and `tests/service-quality.test.mjs` (see 3), `docs/traceability.json` and its mirror (re-recorded results for those two files).
- **Not touched:** migrations, `.env`, `depth-scene.mjs`, `depth.css`, `interact.mjs`. No migration was needed (101 unused).

## 3. Tests
- **New:** `tests/employee-ux.test.mjs`, 12 tests: my-requests aggregation and privacy (module sources, colleague and manager excluded, forged `user_id`, 401); profile masking and privacy (masks, sealed IBAN never read, manager/colleague/admin 404, HR and an explicit grant allowed, dependants hidden without the benefits capability, B14 link); deep-link parsing; Today card and quick-action readiness; catalog dedup routing and readiness; nav gating per role through `app.mjs` in a VM sandbox plus server 403/200; manifest, icons (PNG signature and size) and `sw.js` served with correct types; `sw.js` run in a simulated worker (no `/api` or `/verify` interception, only static files cached, offline page); variant routing and due date; chain and SLA per option; alias search; variant field validation and preset enforcement over HTTP.
- **Changed, on purpose:**
  - `tests/platform.test.mjs`: the employee now gets 403 on `/api/requirements` and the admin reads the 220 requirements. The other-tenant check accepts 403 or 404 (the capability check now comes before the tenant check).
  - `tests/service-quality.test.mjs`: the employee gets 403 on `/api/service-benchmark` until an explicit `requirements.view` grant, then 200.
  - Both encoded the old default that every employee holds `requirements.view`, which the audit (B12, quick win 6) and this task remove. Their traceability results were re-recorded with `npm run trace -- --record-results docs/testing/test-results-employee-ux-20260919.txt`.
- **`npm test`:** 726 tests, 726 pass, 0 fail (714 before; 12 new).
- **`npm run check`:** syntax of 376 modules passed, source hashes match, traceability 220 requirements / 22 domains.

## 4. Visual check
A throwaway instance on port 3690 with a fresh synthetic database (seed, service catalog, `expandDemo`, `seedHrDemo`, plus synthetic leave balances, requests, documents, a verified salary account and a published salary-letter template), a random field key and random password never printed, and an in-process employee session. Headless Chromium through DevTools, Classic light, Arabic. The script (`scratchpad/employee-ux-preview.mjs`, outside the repo) stopped the server and deleted the database, key and browser profile at the end; port 3690 is free.

Screenshots in `work/design-verify/employee-ux/` (gitignored, like earlier audits):
- `home-390x844.png`, `home-1440x900.png`, `my-requests-390x844.png`, `my-requests-1440x900.png`, `profile-390x844.png`, `profile-1440x900.png`
- `deep-link-leave-new-390x844.png`: `#leave/new` opened the leave form on the annual balance and the URL returned to `#leave`.
- `variant-letter-390x844.png`: searching «تعريف» opened «خطاب» with «تعريف بالراتب» chosen (module form, because the template is published).
- `variant-it-repair-390x844.png`: searching «IT-SUPPORT» opened «أجهزة وتقنية» with «إصلاح أو دعم فني» chosen and that service's fields.

Checked by script: no horizontal scroll at either size, no console errors or exceptions, the tab bar read الرئيسية · طلباتي · الإشعارات (badge 1) · إجازاتي · المزيد, headings «الرئيسية», «طلباتي», «ملفي».

## 5. Open decisions for the owner
1. **HTTPS hosting.** Install to home screen and the offline page need a secure context on a host employees can reach. Localhost on a laptop is not reachable from a phone. Hosting is still undecided (TASK-0).
2. **One-tap punch on home** makes home write one thing (P1-1 asks for confirmation).
3. **Server-side single chain.** Whether `POST /api/requests` should refuse a routed catalog service once its module is live (1.5).
4. **Dependants visible to the employee themself** (1.4); the data-protection owner should confirm.
5. **`requirements.view` removed from everyone.** Who besides the platform admin should hold it (for example the owner's delivery lead)?
6. **«ملخصي» merged into home for every role**, not only employees. Managers lose the separate portal page; its content is on home.
7. **The five services kept as requests** (1.5) until their modules give employees a form.
8. `index.html` still lacks `apple-touch-icon` and per-scheme `theme-color` metas (1.8), because this change was limited to the manifest link.
9. Letter and leave types in the variant cards follow the letters and leave agents' data; their owners should review the option names and required documents (`docs`), which are proposals.
