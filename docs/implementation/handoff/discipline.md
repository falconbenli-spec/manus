# Handoff: violations register and penalty schedule (P1-01, migration 097)

**Source of the rules:** the company work regulations, Arts. 111–126 and the annexed schedule of violations and penalties (pp. 42–51), read from `work/reference/manus-app/server/work-regulations.txt` after NFKC normalisation. Background: `docs/product/benchmark/REF-APP-GAP-REPORT-20260919.md` P1 #1, `REF-APP-BACKEND.md` P1-01, and `REF-APP-WORKFLOWS.md` §3.3–3.4.

**Stance.** The platform proposes and people decide. It counts the repeat number and proposes the penalty from a schedule that the HR manager has accepted. It then refuses every step that the regulations do not allow. It never imposes a penalty, never approves a payroll movement and never ends a contract.

## 1. Files

New:
- `app/migrations/097-discipline.sql`: seven tables, the regulation extract as a platform draft, and the base letter type `discipline_notice`. It does not touch `notifications`.
- `app/discipline.mjs`: schedule, register, due process, decision, notice, grievance, fines register, penalty sheet.
- `app/static/discipline-ui.mjs`: two screens, `discipline` (HR and the authority holder) and `my-discipline` (the employee).
- `tests/discipline.test.mjs`: 14 tests.
- This file.

Shared files. Every edit is an addition marked with a `ترحيل 097` comment:
- `app/access.mjs`: two capabilities after `hr.cases.handle`:
  - `hr.discipline.propose` (default for the `hr` role)
  - `hr.discipline.decide` (sensitive, explicit grant only).
- `app/notices.mjs`: one line, `SUBJECT_LINKS.discipline_case='#my-discipline'`.
- `app/letters.mjs`:
  - ten discipline placeholders, restricted to `discipline_notice`
  - `HR_INITIATED`, so an employee cannot request that type, and a letters preparer who cannot issue cannot see it
  - a refusal to save a discipline placeholder in another type's template
  - a new export `issueInitiatedLetter`.
- `app/files.mjs`: the entity `discipline_case` for evidence files.
- `app/server.mjs`: one import, one asset line, four GET routes after `hr-cases`, and three POST routes after `hr-cases`.
- `app/static/operations.mjs`: one import, and one `Object.assign` after the registry.
- `app/static/app.mjs`: two `nav.push` lines, `my-discipline` after `hr-cases` and `discipline` after `letter-templates`.
- `app/static/hr-design.mjs`: two separate statements after the existing constants (glyphs, and placement in the navigation groups). No existing line was changed.
- `app/static/portal-ui.mjs`: one panel linking to `#my-discipline`.

**Merge dependency on 099.** This branch sends notifications with `subject_kind='discipline_case'` and does not change `notifications` (at the coordinator's request). Before 099, the closed list from 096 rejects that value, so the notification insert fails and every notifying step fails with it. On this branch alone, 13 of the 14 discipline tests fail. Migration 099 (attendance rules) replaces the closed list with a format rule: 3–40 lowercase letters or underscores. `discipline_case` meets it.

To check the merged state, I added a temporary copy of 099's `notifications` section (not committed) and ran:
- `discipline`, `letters`, `ui-render`, `static-modules`, `migrations` and `portal-audit-fixes`: 33 of 33 passed
- the full suite: see §3.

**Merge both 097 and 099, or neither.**

I did not change `hr_policies`. Its `kind` CHECK would need a rebuild of a table that contracts, payroll runs and settlements reference. The schedule therefore lives in its own table, `discipline_schedules`. It follows the same pattern: a dated draft, acceptance by `hr.policy.accept`, and the preparer cannot accept.

## 2. What is built

### Schedule (`discipline_schedules`)
- **The platform extract.** One row with `tenant_id NULL` and id `discipline-regulation-v1`. It is a permanent draft that nobody can edit (trigger). It holds:
  - 50 rows: Table A (working time, 16 rows), Table B (work organisation, 18) and Table C (conduct, 16).
  - For each row: code, table, item, page, Arabic and English text, the article citation, up to four penalties, the "extra deduction" column, and the flag for an uncertain cell.
  - The parameters, each with its article:
    - repeat window 180 days (Art. 114)
    - fine caps of 5 days' wage per violation and per month (Art. 116)
    - oral questioning allowed up to a 1-day fine (Arts. 117, 126(1))
    - 30 days to start an investigation (Art. 119) and 30 days to impose a penalty (Art. 120)
    - grievance: 30 days to file and 15 days to answer (Art. 126)
    - 30-day month (Art. 50(1)).
- **Nothing applies until acceptance.** `recordViolation` refuses with `schedule_required` until a company version is accepted and in force on the date of the act.
- **Company version.** Accepting the platform extract creates a company row, prepared by nobody, so any holder of `hr.policy.accept` may accept it. `prepareSchedule` lets an `hr.policy.prepare` holder:
  - correct cells
  - set the two values the regulations leave open
  - record a confirmation for each uncertain cell against the signed PDF.

  Someone else accepts that version. A case keeps the schedule that was in force on the date of the act.
- **Penalty format.**
  - `warning`
  - `fine:<bp>`, where 10000 = one day's wage
  - `deprivation`
  - `dismissal_award`
  - `dismissal_no_award`

### Register and repeat counting (Art. 114)
- The HR role, or a direct manager for their own team, records a case. A case is one act, with one or more item codes. It stores:
  - the date of the act and the date the company learned of it
  - a description
  - the source (manager's report, HR observation, attendance day, or other)
  - evidence files (PDF/PNG/JPEG, 2 MB, through `files.mjs`).
- **An attendance day is evidence, not a trigger.**
  - `dayStates` is read and saved as a snapshot.
  - A day of leave, holiday, rest or mission is refused.
  - Lateness items need a day marked `late`.
  - Absence items need an unpaid absence already confirmed through the two-person process (HR-03 is unchanged).
  - Nothing is ever created automatically.
- **How the repeat number is counted.** It is a chain on the same item code:
  - A violation is a repeat when no more than 180 days have passed since the previous one. Its number is the previous number plus one.
  - At 181 days or more it counts as a first again.
  - After the fourth, the last penalty in the table stays.
- **What is counted.**
  - At recording, decided cases count, and earlier open cases count provisionally.
  - At decision, the count is taken again from penalties that stand. Withdrawn, unproven, time-barred and grievance-cancelled cases do not count.
  - The decision can never be harsher than the charge the employee answered in the investigation.
- **Art. 115.** When one act breaks several items, the proposal is the harshest of them. The decision is one penalty and at most one fine.

### Due process (Arts. 117, 119, 120, 126(1))
- **Written process.** It is compulsory when the proposal is above a 1-day fine:
  - a written charge, with its delivery date
  - hearing minutes
  - the employee's defence, typed by the employee in their own page (only once), or a defence window that has passed. The window is a company value (§4).
- **Oral process.** It is allowed only for a warning or a fine of up to one day, and the minutes are required.
- **Time limits, with countdowns on the case, the board and the employee page:**
  - The investigation must start within 30 days of discovery. Recording refuses a discovery date older than that (`time_barred`).
  - The penalty must be decided within 30 days of proof.
  - After either limit, the action disappears, the server refuses it, and HR closes the case as `lapsed`.

### Decision (Arts. 113, 115, 116)
- `hr.discipline.decide` decides. The recorder and the subject cannot, and a CHECK in the database enforces this as well.
- The decider may pick any penalty up to the maximum. A lighter one needs a written reason. A harsher one is refused (`harsher_than_schedule`).
- A fine above 5 days is refused.
- Loss of increment and dismissal are recorded only. The screen says that executing them is a separate step with legal review.

### Notice (Art. 121)
- `issue_notice` calls `letters.issueInitiatedLetter`:
  - The notice comes from the approved `discipline_notice` template, with a reference, a QR verification code and a printable copy.
  - The decider is recorded as the author. The issuer holds `hr.letters.issue` and is neither the decider nor the subject.
  - The placeholders are bilingual: violation, date, article, penalty, the penalty for a repeat, and the grievance days.
- **Delivery.**
  - The methods are by hand, registered mail, or the email stated in the contract. Mail and email need a reference.
  - "Refused to sign" is recorded for hand delivery and leaves the case undelivered until a mail or email delivery follows.
  - The first effective delivery sets `notified_on`, and the grievance window starts from it.

### Grievance (Art. 126)
- **Deadlines.**
  - Filing: within 30 days of `notified_on`, not counting approved official holidays. Fridays and Saturdays count (`addDaysExcludingHolidays` with `holidaySet` from `work-calendar.mjs`). The last day is included.
  - Answer: within 15 days, on the same count.
- **Who answers.** An `hr.discipline.decide` holder who is neither the subject nor the recorder.
- **Outcomes.** Upheld (the penalty is cancelled and the fine is cancelled), reduced (strictly lighter; `not_lighter` otherwise) or rejected (the answer states the labour-court right). Nothing can make it harsher.
- **No harm to the employee.**
  - The text is visible only to the employee and to decide holders. HR staff see only that a grievance exists, and managers see nothing.
  - Payroll proposals are blocked while a grievance is open.
  - A cancelled penalty no longer counts as a previous occurrence.

### Payroll (Art. 116) and fines register (Art. 123)
- **Who proposes.** `propose_deduction` is available to `payroll.prepare`, after notice and with no open grievance. It calls `payroll-extras.proposeAdjustment` with `kind:'deduction'`. The adjustment stays `proposed`, and only the payroll approver decides it. No code path approves anything.
- **The monthly cap.**
  - It is the sum of discipline deductions in the month that are not rejected.
  - Only what fits under 5 days' wage is proposed. The rest waits for a later month.
  - A full month is refused with `monthly_fine_cap`.
  - A rejected adjustment frees its place under the cap.
- **Daily wage.** The contract lines in `wage_components` ÷ `day_basis_days`, rounded half-up to the halala.
- **The register.**
  - `discipline_fines` records each fine against `fund='workers_benefit_fund'` (a CHECK). A fine can only go down or be cancelled (trigger).
  - It shows each fine, its deductions, what was collected (an approved adjustment in an approved run) and the liability to the fund.
  - When a grievance reduces a fine below what was already proposed, the register flags the excess for the payroll approver.
  - Amounts are shown only to decide and payroll holders.

### Penalty sheet (Art. 122)
- Decided and notified cases for each employee, with any grievance outcome. A cancelled penalty stays visible, marked cancelled.
- The employee sees their own sheet. HR and decide holders see everyone's. Managers and colleagues get 404.

### Notifications
`notifySubject` with `subject_kind='discipline_case'` is sent at each step:
- recorded
- charge, or oral questioning
- hearing
- proven, or not proven
- decided
- notice issued, and notified
- grievance filed, and grievance answered
- deduction proposed
- withdrawn, or lapsed.

Titles carry the case reference only. There are no amounts and no charge text.

### Who sees what
| Viewer | What they see |
|---|---|
| Subject | Their own cases in full, in `my-discipline` only (never on the HR board) |
| `hr.discipline.propose` / `decide` | All cases in full, except their own |
| `hr.letters.issue` | Summary of decided and notified cases |
| Payroll | Summary of cases with a fine |
| Direct manager | Summary of their team's cases, with no texts, defence, grievance or files |
| Anyone else | 404 |

The audit trail stores codes and status, never the description or the defence.

## 3. Tests

`tests/discipline.test.mjs` has 14 tests. Time limits and grievance windows use `t.mock.timers` on `Date`. The tests cover:
- the seeded extract: 50 rows, Table A cell by cell against §3.3, pages and articles, the two flags, and inactive until accepted
- the rule that the preparer does not accept, and the Art. 116 cap in the schedule
- the 180-day chain: occurrences 1→4 give warning / 5% / 10% / 20%, the 5th stays at 20%, 181 days gives 1, and exactly 180 days gives 2
- cases that do not count (withdrawn, cancelled on grievance)
- Art. 115 (the harshest, one fine)
- Art. 113 (lighter needs a reason; harsher refused)
- Arts. 117 and 126(1): written only above one day; the minutes, defence and window gates
- Arts. 119 and 120: time-barred at recording, countdowns, a lapse after 30 days, and `close_lapsed`
- separation of duties (in the code and by CHECK)
- Art. 121: the template is required, the notice is bilingual, the letter is hidden from preparers, and a refusal is followed by registered mail
- Art. 126: holidays excluded, the last day included, the 15-day answer, reduced must be lighter, the text is private, deductions are blocked, and a notification at every step with no amounts
- payroll: proposed only, the wage arithmetic, the monthly cap with a partial amount and a carry-over, a rejection freeing the cap, the fines register, and the sheet
- no automatic penalty from attendance
- privacy across the employee, a colleague, the manager, another tenant, files and the audit trail.

The existing `tests/ui-render.test.mjs` renders both screens for every seeded role and opens every form.

Results:
- Before the coordinator's change, with the `notifications` rebuild still in 097: `npm test` 728 of 728 passed.
- After removing the rebuild, with a temporary copy of 099's `notifications` section added (not committed): `npm test` 728 of 728 passed.
- On this branch alone, without 099: the discipline tests fail at the notification insert (see §1).
- `npm run check`: passed (370 modules; source hashes match; 220 requirements in 22 domains).

## 4. Open decisions for the HR manager

1. **Confirm the two uncertain cells against the signed PDF.** Record the answer as a confirmation in a company version.
   - U1: does the "plus deduction of the late minutes" cell, which appears after item A06, cover items A01–A05 as a merged cell?
   - U2: does item A11 (a one-day absence) include deducting that day's wage?

   Until they are confirmed, the module never applies the extra "deduct the time" column. Pay for absent days is handled only by the existing unpaid-absence process.
2. **Daily wage basis for fines.** Art. 111(2) says "daily wage". The draft uses basic, housing, transport and other allowances ÷ 30. Choose between the full actual wage and basic only.
3. **Written-defence window.** The regulations do not set one. The draft uses 3 days, as in the unpaid-absence process.
4. **Repeat counting.** The draft reads Art. 114 as a chain: a violation is a repeat when it comes within 180 days of the previous same violation. The alternative reading counts every same violation in the 180 days before. Confirm the chain reading.
5. **"Same violation".** The draft counts by item code, so A11 (1 day) and A12 (2–6 days) are separate chains. Decide whether all absence items (A11–A14) should share one chain.
6. **Who answers a grievance.** The draft allows any `hr.discipline.decide` holder other than the subject and the recorder, which includes the original decider. Decide whether the answer must come from someone other than the original decider.
7. **Name the authority holder (صاحب الصلاحية) in the authority matrix.** Grant `hr.discipline.decide` accordingly.
8. **Write and approve the bilingual `discipline_notice` template** in «قوالب الخطابات». No template ships, so no notice can be issued until one is approved. The ten discipline placeholders are listed on that screen.
9. **Finance: the account treatment of the workers' benefit fund liability** (Art. 123), and how money is paid out through the labour committee or with ministry approval. The platform keeps the register but posts no journal entry.
10. **Not built yet:**
    - suspension without pay (Art. 111(3)): not in the schedule, so not offered
    - blocking dismissal-type decisions during pregnancy or maternity leave (Art. 103 / L19)
    - Art. 118 (conduct outside work): a human judgement
    - the Art. 37(5) block on resignation while under investigation
    - listing attendance "candidates" on the HR screen.

## 5. Not touched

- No applied migration (001–096).
- No `.env`.
- Not `STATUS.md` or `docs/traceability.json`: several agents are working in parallel. The coordinator should add a completion line and the P1-01 evidence when merging.
