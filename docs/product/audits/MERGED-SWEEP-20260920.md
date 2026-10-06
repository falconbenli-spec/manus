# Browser sweep of the merged platform — 20 September 2026

**Why.** The integration of 19 September closed with a named gap: «No merged screen was walked through in a browser.
Only `ui-render` and the node tests cover them» (`docs/implementation/handoff/integration-20260919.md` §5).
This is that walk-through.

**State.** Run locally on a synthetic database. **Not accepted by any process owner.** «Renders» here means the screen
drew, answered, and could be read and acted on in a browser — not that its owner has seen it.

---

## 1. Method

**Instance.** Port 3710, a fresh database in a temp folder under the scratchpad, created with `scripts/seed.mjs`,
then `installServiceCatalog` (139 services), `expandDemo`, `expandPeopleDemo`, `expandFinanceDemo` and `seedHrDemo`.
A random field key and random passwords, none of them printed. Sessions in a 0600 file.
The live database and ports 3600, 3601 and 3630 were not touched. At the end the server was stopped and the
temp database, field key and session file were deleted.

**Grants made for the sweep,** all of them owner decisions in real use (integration handoff §6) and all inside the
throwaway database only: `hr.letters.prepare`, `hr.policy.accept`, `hr.attendance.approve`, `hr.leave.authority`,
`hr.discipline.decide`, `hr.contracts.approve` and `benefits.finance.confirm` to `hr`;
`hr.letters.issue` and `hr.letters.prepare` to `manager` (a template is approved by someone other than its preparer);
and a synthetic finance delegation to a new `treasurer` account (see S-05).

**Browser.** Headless Chromium over the DevTools protocol. Every screen got its own full document load — a hash-only
change does not reload the app, and that would have mixed one screen's console and network into the next.

**Coverage.** 346 screens.

| Pass | Role | Design | Theme | Size | Screens |
|---|---|---|---|---|---|
| emp-depth-desk | employee | كوكبة 360 | dark | 1440×900 | 40 |
| emp-depth-phone | employee | كوكبة 360 | dark | 390×844 | 40 |
| emp-classic-desk | employee | الكلاسيكي | light | 1440×900 | 40 |
| emp-classic-phone | employee | الكلاسيكي | light | 390×844 | 40 |
| mgr-depth-desk / -phone / mgr-classic-desk | manager | both | | both | 32 each |
| hr-depth-desk / -phone / hr-classic-desk | HR | both | | both | 30 each |

The employee's 40 screens are the 30 in her own menu, read out of the rendered navigation rather than the code, plus
ten that open only by typing the URL: `my-request-timeline`, `notification-settings`, `resignations`, `travel`,
`search`, `requirements`, `employees`, `expiry`, `requests`, `departments`. The manager and HR passes cover the 32 and
30 screens they have that she does not; their shared screens are covered by her passes.

**What was recorded per screen.** Does it render (a heading, readable text, no error panel, not stuck on «جارٍ
التحميل…»); any uncaught exception or console error; any HTTP response of 400 or worse; any text whose contrast
against its own computed backdrop falls below 3:1 (the «cannot read this» floor, not the AA floor); any element that
hides its own content behind `overflow:hidden` without a way to scroll; whether the page scrolls sideways; and
whether a primary action is present and clickable.

**Screenshots.** `work/design-verify/sweep-20260920/`, one PNG per screen, named `<pass>-<screen>.png`.

### A note on how the design is chosen

The design picker writes the choice to the **account** (`POST /api/account/appearance`), and `app.mjs` calls
`applyAppearance(me.appearance)` on every load, which overwrites `localStorage`. A sweep that only seeds
`localStorage` therefore renders the account's design, not the one it asked for. The first classic passes did exactly
that and had to be re-run after the harness was changed to set the account preference, which is what the picker does.
Worth knowing before the next sweep.

---

## 2. Findings

Severity: Blocking, High, Medium, Low. «Fixed» means fixed on this branch with a test.

| # | Severity | Screen | What happens | Reproduce | Where | Status |
|---|---|---|---|---|---|---|
| **S-01** | Medium | Every screen, every role | The browser asks for `/favicon.ico` on every page load. It is not in the asset map, so it falls through to the authenticated API router and returns **401**. A console error on **335 of 346** screens, which buries any real error; and the tab, bookmark and history entry have no icon although `icons/icon-192.png` exists. | Open any screen and read the developer console. | `app/static/index.html:16-19` (the icon link), `app/server.mjs:152-154` (the asset map) | **Fixed.** An icon link in the page and `/favicon.ico` served from the existing 192px icon. After the fix the classic re-passes logged **0** console errors on 142 screens. |
| **S-02** | High | إجازاتي | Leave still cannot be requested out of the box. On a database with the full catalog and every demo seed, the employee's leave screen shows two paragraphs of explanation and **no button**: no accepted leave-types policy (0 types), no accrual rule, and no opening balance. | Seed, `installServiceCatalog`, `expandDemo`, `seedHrDemo`; open `#leave` as `employee`. Screenshot `emp-depth-phone-leave.png`. | `app/leave-types.mjs` (the policy gate), `app/leave.mjs:229` (an opening is HR-only and manual) | **Not fixed.** This is audit B3 and gap G2 — the full leave journey, which needs the HR manager's entitlement rules. Once HR grants an opening it works end to end (§3). |
| **S-03** | High | خطاباتي | No letter can be requested until someone adopts one of the six starter templates, a **second** person approves it, and `hr.letters.issue` is granted — and no role holds that capability by default. Out of the box the employee's screen has no action and the API answers `template_required`. | Open `#letters` as `employee`; then `POST /api/letters` → 409 `template_required`. | `app/letters.mjs:298-310`, `app/access.mjs` (`hr.letters.issue` has no `roles`) | **Not fixed.** The grant is owner decision 2 in the integration handoff §6. Verified in §3 that the whole chain works once it is made: the letter was issued with reference `2026-00001`. |
| **S-04** | Medium | دليل الخدمات | Two different counts for the same thing on one screen: the heading said «142 خدمة في 16 إدارة» while the department rail under it said «كل الخدمات 127». The heading counted the raw catalog; the rail counted the list after option cards replace their member services. | Open `#catalog`. Screenshot `emp-depth-desk-catalog.png` (before the fix). | `app/static/request-picker.mjs:231-236` (heading) vs `:177` (rail) | **Fixed.** Both count the list the employee actually browses. |
| **S-05** | High | مصروفاتي وعهدي, and every finance screen | The finance delegation that gates finance approval, cash custody, the ledger and supplier payments **cannot be created by the platform**. Nothing writes `finance_grants` except `scripts/expand-demo.mjs`: there is no API route and no screen. On a pilot-shaped database an expense claim can be approved by the line manager and then stops forever. Separately, the table's CHECK allows `granted_role` of only `employee`, `manager` or `pm`, so a person whose role is `hr` or `it` can never be a finance approver. | Submit a claim, have the manager approve it, then look for anyone who can take the finance step. | `scripts/expand-demo.mjs:57` (the only writer), `app/migrations/007-finance.sql:1-17` (the role CHECK), `app/expenses.mjs:35-42` (the gate) | **Not fixed.** Who holds financial authority is owner decision 1 in the integration handoff §6 («authority matrix»); building the screen before that names a delegate would be guessing. The sweep created one by hand in the throwaway database to finish the journey. |
| **S-07** | Medium | Any screen the server refuses | A 403 filled the page with a display-size red headline and a single «إعادة المحاولة» button, which retries the same refusal and cannot succeed. There was no way back. This is the remainder of audit B14: the message improved in the merge, the dead end did not. | Type `#employees` or `#requirements` as `employee`. Screenshot `emp-depth-desk-employees.png`. | `app/static/app.mjs:327-329` | **Fixed.** «العودة إلى الرئيسية» sits next to the retry, which stays for a genuine network failure. |
| **S-08** | Low | الرئيسية, the «اليوم» card | The card printed dates raw — «الإجازة السنوية · 2026-10-04 — 2026-10-06» — while its own header and every list below it write the Gregorian and Hijri dates together. | Approve a future leave, open `#home`. Screenshot `emp-classic-desk-home.png` (before the fix). | `app/static/home-ui.mjs:26-33` | **Fixed.** Single dates take the dual form; a range stays Gregorian with one Hijri after it, so the line does not become four dates. |
| **S-06** | Low | Every screen | `class="error"` means two different things: the panel that says the screen failed to load, and an inline advisory line inside a screen that loaded fine. On قواعد اللائحة في الرواتب the Art. 36(2) note is styled as a failure. It also makes «did this screen fail?» impossible to answer automatically. | Open `#payroll-rules` as HR. | `app/static/app.mjs:329` vs `app/static/payroll-rules-ui.mjs:110`, `:22`, `:106` | **Not fixed.** Splitting the class touches the stylesheet and every screen that uses the inline form; it is a contained change but not a small one, and it belongs with the copy pass (audit recommendation 10). |
| **S-09** | Low | بانتظار قراري, الشكاوى والاستفسارات | Two screens were still on «جارٍ التحميل…» when the sweep looked at 2.8 s, in one pass out of ten. | — | — | **Not reproduced.** Both rendered in the re-run. Recorded as a first-paint timing note, not a defect. |

### Two counts worth having in writing

- **No screen scrolls sideways.** 346 screens, both designs, both themes, 1440×900 and 390×844: horizontal overflow
  was zero everywhere.
- **No unreadable text.** Every visible text node was measured against its own computed backdrop. Nothing fell below
  3:1 in either design or either theme.
- **No uncaught exception** on any screen.
- **No clipped content.** The two patterns the detector flagged are deliberate and correct: `sr-only` text, and the
  table header that phones fold away when each row becomes a record (`app/static/journey.css:209-210`).

### Screens with no primary action

149 of 346. Most are read-only or empty by design (قسائم راتبي before a payroll run, الإعلانات before HR publishes,
المراكز التخصصية, تقويم الالتزامات). Two are findings and are already above: **إجازاتي** (S-02) and **خطاباتي**
(S-03) — the employee opens her flagship self-service screen and there is nothing she can press.

---

## 3. The six journeys, end to end

Run over the API on a fresh database, with the approver steps taken by the manager, HR, a second
letter issuer and a finance delegate. **41 steps; every journey completed.** Four lines are marked as observations
rather than failures and are explained under the table.

| Journey | Result |
|---|---|
| **Leave** | HR grants a 21-day opening → the employee requests 2 working days → the manager approves → HR approves → the employee has a decision notice and the leave appears in «طلباتي». *Observation: with no policy and no accrual, the opening is the only way in (S-02).* |
| **Salary letter through the wizard** | HR adopts the starter `salary` template → the manager, as a different person, approves it → the employee requests the letter → HR prepares it → the manager issues it → the employee has an issued letter with reference **2026-00001**. *Observation: nothing was requestable before the template was adopted and approved (S-03).* |
| **Expense claim** | The employee claims 230.00 → the manager approves → someone without a finance delegation is refused → the finance delegate approves → the reimbursement is recorded → the claim shows in «طلباتي» and the employee has a notice with no amount in it. |
| **Attendance punch** | Check in, check out, then a correction for a past day which the manager approves. *Observation: the check-out probe read a snapshot taken before the check-in, so it reported one time rather than two; the record itself is correct.* |
| **Benefit request** | «مزاياي» offers six options, one of them available; the employee requests a benefit letter and it is recorded as `BEN-2026-0001`, «بانتظار الموارد البشرية». The five unavailable options each say why (no insurance registration, ticket policy still a draft, education allowance not accepted). |
| **HR case** | The employee files an inquiry → her line manager gets 404 on it → HR takes it, replies and closes it → the employee is notified. Confidentiality held. |

---

## 4. What was fixed here, and what was left

**Fixed on this branch, each with a test in `tests/portal-fixes-round2.test.mjs`:** S-01, S-04, S-07, S-08.

**Left, with the reason:**
- **S-02 and S-03** are the leave and letter journeys. Both need decisions from the owner and the HR manager
  (entitlement rules; who holds `hr.letters.issue`), not code. Both were proved to work once those decisions are made.
- **S-05** needs the authority matrix first. Recommended next step, in this order: (1) the owner names the finance
  delegates; (2) a delegation screen for `accounts.manage` holders that writes `finance_grants` with a reason and an
  end date, as `grantAccess` already does for capabilities; (3) revisit the `granted_role` CHECK in 007, which today
  makes an HR or IT person ineligible whatever the owner decides.
- **S-06** belongs with the copy pass.
- **S-09** did not reproduce.

Nothing here has been accepted by a process owner.
