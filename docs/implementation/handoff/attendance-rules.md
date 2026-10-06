# Attendance rules from the regulations — 19 September 2026

**Source.** `docs/product/benchmark/REF-APP-GAP-REPORT-20260919.md` P1 #3 (overtime), #4 (permission and early leave), #5 (location), plus the P2 items it pulls in (Ramadan hours, attendance exemptions, attendance reports). Detail from `REF-APP-BACKEND.md` P1-03/04/05 and `REF-APP-FRONTEND.md` §3.3-D.

**State.** Built locally and tested locally on branch `worktree-agent-aaa1902297d5153cc`. **Not accepted by the HR manager.** Every regulation value is a parameter of a draft `working_time` policy. None of them applies until the HR manager accepts that policy with `hr.policy.accept`. Without it the platform behaves as before, and the attendance screen lists what is still unset.

**Migration.** `app/migrations/099-attendance-rules.sql`.

## What was built

### 1. Overtime (Art. 76–77)

`app/overtime-rules.mjs` (new). Changes in `app/attendance-extras.mjs`.

- **Prior written assignment.** The flow is: `assignOvertime` → `decideAssignment(authorise)` → `decideAssignment(budget)`. Four different people take part, and a database CHECK enforces it:
  - the employee
  - the direct manager, who writes the assignment
  - the authority holder (`hr.attendance.approve`), who pre-approves
  - HR (`hr.attendance.manage`), who approves the budget in writing and records an estimated cost
- **Other assignment rules.** An assignment starts today or later, lasts at most 14 days, and cannot overlap another live assignment.
- **Actual hours.** The employee records actual hours against a budget-approved assignment with `requestOvertime({assignment_id})`. The hours cannot exceed the assigned minutes per day. The direct manager, the assigner or the approver then approves them with `decideOvertime`.
- **Retroactive path.** The old after-the-fact request still works. It is now stored with `retroactive=1`, needs a justification of at least 20 characters, and appears as «بأثر رجعي» on screen and in the payroll adjustment reason. All existing rows were marked retroactive by the migration.
- **Caps (Art. 77(8)).** The limits come from the policy:
  - 3 h on a working day
  - 8 h on a rest day or approved holiday
  - 20 h a week, Sunday to Saturday
  They apply to assignments and to actual hours, retroactive ones included. The weekly load counts each day once, at the larger of the assigned and the recorded minutes.
- **Suggested pay (Art. 76(2), 77(4)).** `minutes × (actual monthly / 30 / 8 + 50% × basic monthly / 30 / 8)` in halalas, rounded half up. The 30, the 8 and the 50% are policy parameters. The contract in force supplies the pay, and "actual" is the sum of all pay lines. The backend example gives 2 h → SAR 91.67, and a test checks it.
- **Sending pay to payroll.** `overtimeToPayroll` only ever **proposes** a `payroll_adjustments` row, which someone with `payroll.approve` must then approve:
  - With no amount entered, it uses the suggested amount.
  - A different amount needs a written basis, and the reason records the suggested figure next to it.
- **Annual cap (Art. 77(5)).** The overtime pay proposed or approved in the calendar year of the work date may not exceed 6 × monthly basic. This is checked when the budget is approved and again when pay is sent to payroll.
- **Time off instead of pay (Art. 77(6)).** Only the employee can choose it, when they record their hours (`compensation:'time_off'`). A trigger stores and requires `consent_at`, and another trigger blocks a payroll adjustment for such a row. The screen shows the balance of time off in lieu.
- **Mission overlap (Art. 77(9)).** Overtime is refused on any day with a pending or approved work mission, for assignments, actual hours and retroactive requests alike. A mission is refused over live overtime.

### 2. Permission (استئذان), early leave and the same-day notice (Art. 74(8), 75)

`app/attendance-rules.mjs` (new). `dayStates` in `app/attendance.mjs`.

- **Permission.** A permission is an attendance record of kind `late_arrival`, `during_day` or `early_leave`. The employee requests it. The direct manager or the `hr.attendance.approve` holder decides it, never the requester (enforced in code and by a CHECK). An approved permission turns `late` or `early_leave` into `present_permission` for its period only, and the day carries `excused_by` with the permission ID. A pending permission changes nothing.
- **Monthly cap.** The cap is the policy parameter `permission_monthly_cap_minutes`. Until HR sets it, no cap applies. Once set, a request over the cap is refused with code `permission_cap` and the remaining minutes (`details.remaining_minutes`).
- **Early leave without approval.** A check-out before the end of the day, with no approved permission covering the time until the end, is now the day state `early_leave` («انصراف مبكر بلا إذن — يحتاج توضيحًا»). Overnight shifts are not judged for early leave.
- **Same-day notice.** «سأتأخر / سأغيب اليوم» (`giveNotice`) is dated today on the server and reaches the manager at once. If the manager accepts it:
  - a late arrival up to the stated time is not flagged;
  - an absence becomes `excused` instead of `unexplained`, so no unpaid absence can be proposed for that day.
- **Catalogue.** `HR-ATTENDANCE-FIX` with kind «استئذان» or «تأخير بعذر» is refused at draft creation (409 `use_attendance_screen`) and the employee is pointed to the attendance screen. The hook is one line in `workflow.createRequest`, calling `catalogAttendanceRoute` in `app/attendance-policy.mjs`. The service already opens the attendance screen through `SERVICE_MODULES`. «نسيان بصمة» and the other kinds stay in the generic request, because `tests/service-catalog.test.mjs` requires every catalogue service to accept its first option.

### 3. Ramadan hours (Art. 73(2), 74(2))

- **Policy option.** The optional `working_time` parameter is `ramadan:{from,to,start,end}`, stored as dates. Validation allows at most 6 h a day, at most 36 h a week across the policy's workdays, and a range of at most 31 days.
- **How the day is judged.** `effectiveHours` in `app/attendance-policy.mjs` checks in this order: an assigned shift, then Ramadan hours if the date falls in the range, then the normal day. Lateness, early leave and the expected minutes follow that result.

### 4. Location as evidence at check-in (flag, never block)

`app/attendance-location.mjs` (new). Changes to `punch`.

- **Sites.** The `attendance_sites` table holds name, lat/lng and a radius of 50–2000 m in steps of 25. A site is proposed with `hr.attendance.manage` and approved by a different person with `hr.attendance.approve`. An approved site can be retired, not edited.
- **Punch.** `punch` accepts optional `location:{lat,lng,accuracy}`, `location_error` and `location_notice_ack`, and nothing else. A client verdict such as `within` is rejected as an invalid field.
  - The server computes the haversine distance to the nearest approved site and stores `in_zone`, `out_of_zone` or `no_location`, with the distance rounded to 10 m and the accuracy.
  - Accuracy worse than `max_accuracy_m` counts as `no_location/low_accuracy`, not out of zone.
  - Out of zone or no location → `needs_explanation=1`, unless the day is an approved exemption or mission.
  - The punch is always recorded first. The zone only adds a flag.
- **When it is active.** Only when the accepted policy has `location:{retention_days,privacy_notice,max_accuracy_m}` **and** there is at least one approved site. Otherwise nothing is stored, even if the browser sent coordinates.
- **Privacy notice before first use.** The punch dialog shows the policy's notice text with a checkbox, and GPS sampling starts only after the box is ticked. The server stores the acknowledgement per policy version (`attendance_location_notices_seen`). Coordinates sent without it are not saved, and the result is `no_location/notice_not_acknowledged`.
- **Retention.** Each saved coordinate queues a job `attendance.location_purge` in `app/jobs.mjs`, due at `captured_at + retention_days`. The handler nulls every expired lat/lng in the tenant, so one job also covers any that failed before it. Only the zone, distance and accuracy remain. Triggers block putting coordinates back and block any change to the result. The HR view counts coordinates kept past their retention.
- **Explanation and review.** The employee explains a flagged punch. The manager or HR reviews it, and the employee is notified. A review never deducts anything.
- **Header.** `Permissions-Policy` is now `camera=(), microphone=(), geolocation=(self)`. It is a single-line hunk in `app/server.mjs`, kept apart from the route hunks.
- **UI.** The large punch button is now the first control on the attendance screen (`.att-punch` in `hr-design.css`). Opening the punch dialog starts `sampleLocation`: the first fix of 20 m or better, otherwise the best fix after 10 s, giving up at 12 s. There is no tracking after the punch. Before the punch the dialog shows the distance to the nearest site and the accuracy. The denied, timeout and unsupported cases use Arabic copy and still record the punch. The site form fills lat/lng from the current position; it uses no map tiles.
- **App hook.** One generic line was added in `app/static/app.mjs`: `operationSpec.opened?.(form)` after an operation dialog opens.

### 5. Attendance exemptions

- **Records.** An exemption is a record with start and end dates. It is proposed with `hr.attendance.manage` and approved by a different person, who is not the employee, with `hr.attendance.approve`.
- **Effect.** Exempt days get the state `exempt`. They are judged neither late nor absent, no unpaid absence can be proposed for them, and no location flag is raised.

### 6. Lateness in reports

- **R37** now has the columns `late`, `early_leave` and `excused`, counted from `dayStates`. The approved permission, the accepted notice, exemptions and Ramadan are all taken into account.
- **Weekly shortfall.** `GET /api/attendance/shortfall?week=YYYY-MM-DD`, also shown on the attendance screen for HR and managers. Shortfall = expected − worked − approved permission. It is for follow-up only, never a deduction.
- **Monthly workbook.** `GET /api/attendance/workbook.xlsx?month=YYYY-MM` is built with `app/xlsx.mjs`. It has a summary sheet, one sheet per employee the caller may see (self, team, or everyone for HR) and a definitions sheet. Each export is audited.
- **Report keys.** No new R-keys were added, to avoid clashing with the other parallel agents.

### 7. Notifications

- **Coverage.** Every decision notifies the employee through `notifySubject`. The employee's manager is also told of a new permission request or a same-day notice. The decisions covered are:
  - assignment written, authorised, budget approved, rejected or cancelled
  - overtime hours approved or rejected
  - permission approved or rejected
  - notice accepted or rejected
  - exemption approved or rejected
  - site approved or rejected (to the proposer)
  - punch reviewed
  - mission approved or rejected
  - shift assigned or ended
- **New subject kinds.** They were added to `SUBJECT_LINKS` as a separate `Object.assign` line in `app/notices.mjs`. All of them open `#attendance`.
- **Schema change.** Migration 099 rebuilds `notifications` because the 096 CHECK was a closed list of subject kinds. The new CHECK is a format rule: 3–40 characters, lowercase letters and underscores only. The code already only writes kinds listed in `SUBJECT_LINKS`.

## Shared files touched (small, separate hunks)

| File | Change |
|---|---|
| `app/server.mjs` | Imports three modules; the one-line `Permissions-Policy` change; the attendance GET adds `rules:`; two GET routes (shortfall, workbook); one POST block for the new routes |
| `app/hr-contracts.mjs` | The `working_time` branch accepts `RULE_KEYS` and merges `attendanceRuleParameters` |
| `app/notices.mjs` | One `Object.assign` line for the new subject kinds |
| `app/workflow.mjs` | One import and one line in `createRequest` |
| `app/reports.mjs` | One import; R37 columns |
| `app/static/app.mjs` | One `opened?.()` line |
| `app/static/hr-design.css` | A 4-line block at the end |

## Merge risks for the integrator

1. **Notifications table.** If migration 100 (notifications) rebuilds `notifications` again with a closed list, it must include these kinds: `overtime_assignment`, `overtime_request`, `attendance_permission`, `attendance_notice`, `attendance_site`, `attendance_exemption`, `attendance_location`, `work_mission`, `shift_assignment`. It should preferably keep the format CHECK from 099. If 097 or 098 add *columns* to `notifications`, the 099 rebuild copies only the 096 columns and must be widened.
2. **`hr_policies.kind`.** This work adds no new policy kind. Everything lives in `working_time`, so it does not collide with 097, 098 or 102.
3. **Contracts screen.** Preparing a `working_time` policy from the contracts screen (`contracts-ui.mjs`) still sends only the base fields. A policy prepared there would supersede the rule values. Use «إعداد مسودة سياسة بقواعد اللائحة» on the attendance screen instead, or extend that form later.
4. **Leave ledger.** Time off in lieu is a balance on the attendance screen. It is **not** credited to the leave ledger (`leave.mjs`, agent 098). That link is open.
5. **STATUS.md** was not updated, to avoid top-of-file conflicts between parallel agents. This file is the completion note.

## Tests

- **New file.** `tests/attendance-rules.test.mjs` has 14 tests: the formula and the 91.67 example, haversine and zones, GPS sampling, draft versus accepted policy, the overtime flow with caps, the annual cap, time off and the retroactive flag, mission overlap, permission removing late and early-leave flags and the monthly cap, the same-day notice, Ramadan hours, location flags with the privacy notice, explanation and review, purge by the job queue, exemptions, R37, shortfall and the workbook, catalogue routing, and the header.
- **Totals.** `npm test` passes 728/728: 714 existing tests, unchanged, plus the 14 new ones. `npm run check` passes (372 modules, traceability 220/22).

## Open decisions for the owner and the HR manager

1. **Grace minutes.** Already a policy parameter (0–120). The regulations give none.
2. **Monthly permission cap.** A parameter, unset. The regulations give none.
3. **Coordinate retention days.** A parameter from 1 to 365, unset. The location feature stays off until it is set together with the privacy notice text.
4. **Flag versus block.** Only flag is built, as instructed. Block mode is not implemented.
5. **Authority holder.** Pre-approval is mapped to `hr.attendance.approve`, the same capability that confirms unpaid absence. The owner may want a separate capability or an approval-engine threshold.
6. **Rounding rule.** Suggested pay is rounded half up to the halala. The accepted policy should state the rounding rule.
7. **Overtime year.** The annual cap uses the calendar (Gregorian) year of the work date. It could instead run from the contract anniversary.
8. **Ramadan eligibility.** Art. 73(2) speaks of Muslim workers. The platform does not record religion and should not, so the Ramadan hours apply to everyone the policy covers. This needs the HR manager's confirmation.
9. **Honesty note.** Browser location is easy to spoof. It shows that a phone *reported* a position, not that its owner was on site. It is also only available over HTTPS on a host employees can reach, which does not exist yet.
