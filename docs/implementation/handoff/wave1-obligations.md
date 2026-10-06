# Wave 1 «ما عليّ» — one obligations surface

Branch `wave1/obligations`, cut from `integration-20260920` at `43428fb`. The worktree arrived on another lineage (`3f250b1`), so the branch was created fresh from `43428fb`; nothing was reset. Nothing was pushed. `.env` and the live database were not touched. **No migration was added.** Everything runs on synthetic data; nothing here is accepted by a process owner.

## The defect, and what replaced it

The manager's home printed «6 ما ينتظر قراري» beside «0 اعتماداتي المعلقة» and then «لا اعتماد معلق عليك». Two definitions of one phrase sat fifty lines apart in `app/home.mjs`, `#work` computed a third, the «طلباتي المفتوحة» tile counted one list while the block under it showed another, and «مهامي» left out personal tasks and silently dropped the seventh project task.

`app/obligations.mjs` now answers the question once. `obligations(db,user,options?)` returns

```
{ user_id, today, waiting_limit_days, items, counts:{decide,respond,do,late}, watching, unavailable, note }
```

Every item carries `bucket, source, source_name, kind, id, title, context, link, actions, action_keys, since, age_days, due_on, due_basis, due_basis_name, overdue, owner_of_record, unblocks, optional` (and `shared:true` on a department-queue item).

| Bucket | What is in it |
|---|---|
| **decide** «أقرّر» | Catalogue requests whose pending step is mine (`needs_me`), plus everything the inbox walker finds. The walker is unchanged in kind: it still reads every module board **with the user's own identity**, so visibility stays in each module. |
| **respond** «أجيب» | My returned catalogue requests, returned leave, returned timesheets, a written defence asked of me, and walker items whose action is a reply (`answer_request`, `state_absence`, `acknowledge`, `submit_self`, `submit_360`, `consent_deduction`). Satisfaction surveys (`answer`), reopen prompts (`reopen`) and my own drafts are `optional:true`: **never late, never counted**. |
| **do** «أنفّذ» | `request_tasks`; requests `in_progress` assigned to me; claimable department-queue requests (`shared:true`); project `tasks` with **no cap**; open `personal_tasks`; `work_packages` I lead; `governance_commitments` I own; `lifecycle_steps` I own. |

`watching` is the list of my own open requests across modules (from `myRequests`). It is not an obligation; it is returned so the «طلباتي المفتوحة» tile and the list under it read one source.

`options`: `requests` / `projects` (lists the caller already read with the same identity), `at` (the instant to measure against — the daily reminder passes its job time), `watching:false` (skip `watching`; the badge and the inbox do).

A commitment that is overdue was shown by its board as a decision and is owned as work. It is one item, in **do**; the walker copy is dropped by id.

## Honest time

- **Arrival, not `updated_at`.** `workflow.stepArrivedAt(db,r,step)` is the logic that lived inline in `escalatableSteps` (sequential: the previous step's `decided_at`; parallel or first step: the revision's submission). `escalatableSteps` now calls it. `pendingStepsFor(db,user,r)` returns my pending steps with `arrived_at`. A decide item's `since` is that arrival. Pressing the follow-up button still bumps `requests.updated_at`, and it no longer resets the age the daily reminder measures.
- **Service target first.** A request item takes `due_on`, `overdue` and `due_basis:'service_target'` from `routing.serviceClock`. `work-calendar.computeClock` gained one additive field, `target_on`: the day the target falls due even after it has passed (`due_on` stays hidden once overdue, as before, because it is used as an "expected" date).
- **Working days otherwise.** An item with no target ages by `workingDaysBetween` (Sunday–Thursday, minus approved holidays) from its arrival, against `reminder_settings.pending_approval_days`. `due_on` is arrival plus that many working days, `due_basis:'working_days_waiting'`. The flat "three calendar days, Friday and Saturday included" is gone from `app/inbox.mjs`. If the owner sets the limit to empty, nothing without a date is called late (`due_basis:'none'`).
- A record that carries its own date (`due_date`, `due_on`, `target_due_on`) is measured by it: `due_basis:'record_due_date'` or `'task_due_date'`. A personal task with no date is never late.

## One source for every surface

- `home.card(key,title,list,link,tone)` takes **the list** and sets `value:list.length`. Handed anything that is not an array it throws `TypeError`. `home.figure(...)` is the constructor for a real quantity (leave balance; the penalties count when no case is open). Cards carry `basis:'list'|'quantity'`.
- Home: `decisions`, `respond`, `my_requests`, `tasks` are all mapped from `obligations()`. New tile `respond` «ما ينتظر ردّي», shown only when something non-optional awaits a reply.
- The manager tile is now `request_approvals` «طلبات تنتظر اعتمادي» and counts `home.manager.request_approvals`, the requests subset of **decide**. `home.manager.pending_approvals` is kept and now holds the full decide list, because the block that `home-ui.mjs` titles «اعتماداتي المعلقة» prints it, and must not say «لا اعتماد معلق عليك» while decisions wait.
- Nav badge: `/api/inbox/count` → `inboxCount` → `obligations().counts.decide`. The 20-second per-user cache and `clearInboxCache()` after every successful write are unchanged. The payload also carries `late`, `respond`, `do`.
- `#inbox`: `inbox()` groups the decide bucket by screen and adds a `respond` list. `#work`: `workspace.workBoard` no longer computes any list; it returns `decisions`, `respond`, `optional`, `doing`, `mine`, `personal`, `counts`.
- Daily reminder and manager digest (`app/reminders.mjs`) read `obligations(db,person,{at})`. The overdue reminder counts late decide and late non-optional respond items. Title «قرارات وردود تأخرت عندك: N»; the working-day rule is in the body.

## Inbox repairs (`app/inbox.mjs`)

- The record link is no longer overwritten with `'#'+key`. `recordLink(key,item,options)` gives `#<screen>?focus=<id>`, or the source's own record page (`#forms/<id>`, `#request/<id>`). A request task links to `#request/<rid>?focus=<taskId>`.
- One generic handler: `app/static/focus-record.mjs` (`parseFocus`, `focusRecord`). After a screen renders it finds `[data-id="<id>"]`, opens any closed `<details>` above it, marks the enclosing row `.is-focused`, scrolls to it, and rewrites the address back to the screen. If the record is not on the screen it says so in a toast instead of staying silent.
- Counting happens before slicing. `walkBoards()` never truncates; `inbox()` shows `INBOX_PAGE` (50) per screen with `total`, `shown`, `truncated`, `shown_note` «يُعرض 50 من N».
- `collect()` now keeps `action_keys` (the raw action names), `person` and the record's own `due_on`.
- New sources: `forms`, `project-handover`, `project-receipt`, `change-requests`, `discipline`, `resignations`, `travel`, `hr-cases`, `benefits-admin`, and — found by the coverage test, not by the plan — `benefit-extras`, `hr-policies`, `approval-settings`, `pricing`, `margin-exceptions`; the `attendance` source now also reads the attendance rules board (permissions, notices, exemptions, overtime assignments, sites, punch-location reviews).
- Sensitive sources pass a minimal row: a discipline case by its reference and employee name with no accusation text; an HR case by its category and date only, exactly what its triage list shows.
- `INBOX_COVERAGE` registers every module that names an approve-type action and is not a source, with a written reason (`inbox:false`), the source that covers it (`via`), or `partial:true` for a source that leaves one action out on purpose. `SCREENS_WITHOUT_QUEUE` records `project-kickoff`.

## The executive gate

`workspace.canReadExecutive(db,user)` is now `can(db,user,'executive.view')`. It gates `executiveOverview` itself, so `/api/executive` and the home block use the same predicate, and home renders the button only when it is true. Nobody was granted anything.

On a fresh seed plus the company catalogue (24 active accounts, no grant of `executive.view` anywhere):

- **Had the button before (21):** `admin`, `hr`, `manager`, `ceo`, `vp-growth`, `vp-corporate`, and the fifteen `head-*` accounts. Of these, the route opened for `admin` only; the other twenty got «لا يوجد تصريح لهذه الشاشة».
- **Keep the button (1):** `admin`, the first admin, who holds every non-sensitive capability.
- **Lose the button (20):** `hr`, `manager`, `ceo`, `vp-growth`, `vp-corporate`, `head-accounts`, `head-brand`, `head-business-dev`, `head-campaigns-audit`, `head-ceo-office`, `head-comms`, `head-epmo`, `head-finance`, `head-grc`, `head-hr`, `head-it`, `head-marketing`, `head-pr`, `head-procurement`, `head-production`. None of them could open the screen; they lose a dead button, not access.

On the live database the keepers are `admin` plus whoever holds a live grant: `SELECT user_id FROM access_grants WHERE capability='executive.view' AND revoked_at IS NULL`. I did not read it. The owner's own account (`ceo`) still cannot open the board; granting it is the Wave 3 decision.

## `popular` list

Deleted from `routing.portal`. `routing.usedServices(db,user,limit)` derives the list from the person's own request history; `home.top_services` and `portal.quick_services` both use it. The cap of six on `portal.project_tasks` is gone.

## Before and after

Measured on one synthetic database (seed, company catalogue, the four demo seeds, and a small scene), built once and read by the code at `43428fb` and by this branch.

| Account | Surface | Before | After |
|---|---|---|---|
| `manager` | home «ما ينتظر قراري» tile / rows under it | 8 / 6 | 8 / 8 |
| | home manager tile | «اعتماداتي المعلقة» 2 | «طلبات تنتظر اعتمادي» 2 |
| | `#inbox` total · badge | 8 · 8 | 8 · 8 |
| | `#work` «ينتظر قرارك» | 2 | 8 |
| | «مهامي» tile · `#work` heading | 0 · 0 (2 personal tasks shown elsewhere) | 2 · 2 |
| | executive button · route | shown · 403 | hidden · 403 |
| `employee` | home «ما ينتظر قراري» · `#inbox` · badge | 2 · 2 · 2, all of it two satisfaction surveys | 0 · 0 · 0; three optional items listed apart |
| | `#work` «ينتظر قرارك» | 0 | 0 |
| | «طلباتي المفتوحة» tile / list | 5 / 2 | 5 / 5 (`#work`: 2 → 5) |
| | «مهامي» tile · `#work` heading | 6 (capped) · 8 | 10 · 10 |
| `ceo` | home tile · `#inbox` · badge · `#work` | 3 · 3 · 3 · 1 | 3 · 3 · 3 · 3 |
| | «مهامي» tile | 0 | 2 |
| | executive button · route | shown · 403 | hidden · 403 |

The «6 / 0» pair of the live database needs a manager with module decisions and no pending catalogue request; on this scene the same defect shows as 8 on home and 2 on `#work`.

## `app/static/app.mjs` — exact lines

Three places, six added lines and two changed:

- line 15: `import { parseFocus,focusRecord } from './focus-record.mjs';`
- line 284 (was 283), inside `render()`: `route` becomes the hash path without its query (`hash` keeps the full hash), so `#screen?focus=…` and `#request/<id>?focus=…` resolve. Guarded with `typeof parseFocus==='function'` because three tests evaluate `app.mjs` in a sandbox with imports stripped.
- lines 345–350 (was 344): `followDeepLink(hash,turn)` instead of `(route,turn)`, then the five-line focus block.

Side effect worth knowing: `#forms?project_id=…` (the «نماذج المشروع» link on a project card) used to resolve `view` to `forms?project_id=…` and land on «الصفحة غير متاحة». It now opens the forms screen.

Other static files: `focus-record.mjs` (new, registered in `server.mjs`), `inbox-ui.mjs`, `work-ui.mjs`, `signature.mjs` (one token: `routeKey()` ignores the hash query), `style.css` (two unlayered rules at the end: `.is-focused` using the `--focus` token, and `.wk-top > .wk-wide`).

## What `home-ui.mjs` still needs

`app/static/home-ui.mjs` belongs to Wave 0 and was not edited. The payload was shaped so the unmodified page tells no lie; these are the label-level edits left for whoever merges:

1. `cardNames`: drop `pending_approvals`; add `request_approvals:['طلبات تنتظر اعتمادي','Requests awaiting my approval']` and `respond:['ما ينتظر ردّي','Awaiting my reply']`. Without them the two tiles show their Arabic server title in English mode.
2. Manager block: title «طلبات تنتظر اعتمادي», list `data.manager.request_approvals`, empty text «لا طلب ينتظر اعتمادك.». Until then the block lists the full decide list under «اعتماداتي المعلقة», which repeats the top block but is true.
3. `decisionRow`: class from `r.overdue` instead of the hard-coded `r.age_days>=3`; say «يوم عمل»; optionally show `r.unblocks`.
4. `taskRow`: read `t.due_on` and omit «الموعد» when it is null. For now `due_date` carries «غير محدد» for an undated task so the row reads «الموعد غير محدد» instead of a dangling word.
5. Optionally a «ما ينتظر ردّي» block from `data.respond`.

## Where this contradicts the plan

1. **`project-kickoff` has no approve-type action.** Its board offers only `record_kickoff` to the receiving project manager. It is recorded in `SCREENS_WITHOUT_QUEUE` with that reason, not added as a source.
2. **The missing queues are not ten (nor the eight of defect 11).** The coverage test found real queues the plan does not name: the four-seat pricing sheet approval, margin exceptions, pricing policies and the issuer decision (`pricingBoard.awaiting_me` was built for the inbox and never read); attendance permissions, notices, exemptions, overtime assignment authorisation and budget, attendance sites; the three extra benefits; leave-types policy, discipline schedule and regulation rules through the unified HR policies board; proposed approval thresholds. All have sources now.
3. **`decide_target` is left out on purpose.** Adopting a service target is available to the admin for all 142 services at all times; it is a standing availability, not a queue. It belongs to the Wave 3 readiness screen.
4. **`record_client_approval` on a change request** is offered by the board to every project member who sees it. In the inbox it goes to the receiving project manager only.
5. **The navigation entry was already right.** `app.mjs` lists «اللوحة التنفيذية» only with `executive.view`; the home button and `executiveOverview` were the role-based half.
6. **`app/pricing.mjs` contains a raw NUL byte** (line 246). `grep` and `file` treat it as binary, so a shell survey of approve-type actions skips the whole module. The coverage test reads files through Node and caught it. Any scanner added to `scripts/check.mjs` should do the same.
7. The service clock covers the whole request, approval and execution together. An approver's item takes that date as instructed; a per-step target does not exist yet.

## Limits, stated plainly

- No browser review was done. The three screens were rendered in Node and read as text; the focus handler was exercised through `parseFocus` only. A work package has no screen yet (Wave 5), so its link opens `#projects` and the toast says the record is not shown there.
- Reminder candidates are unchanged: an employee with no pending approval step is not visited, so a returned request does not yet remind its owner. That is Wave 2.
- `since` for walker items is still whatever date the board exposes (`created_at`, `submitted_at`, `updated_at`, `requested_at`, in that order); only catalogue requests, returned leave and the execution queue have a true arrival time.
- The measurement script created a gitignored `work/keys/field.key` inside this worktree. It is a scratch key, unrelated to the live one.

## Verification

- `npm test`: **1076 tests, 1070 pass, 0 fail, 6 skipped, 0 cancelled** (baseline at `43428fb`: 1064 tests, 1058 pass, 0 fail, 6 skipped). Full output: `docs/testing/test-results-wave1-full-20260921.txt`.
- `npm run check`: syntax checked **452** JavaScript modules (baseline 449), source hashes match, traceability 220 requirements / 22 domains.
- Traceability: only the two tests whose source changed and that the register names were re-recorded (`tests/inbox.test.mjs` and the new obligations test, both under `PLT-10`), from a targeted run saved as `docs/testing/test-results-wave1-obligations-20260921.txt` (12 tests, 12 pass). Recording the full run would have rewritten about 400 result entries in `REQUIREMENTS.json` and its mirror and made the hand merge with Wave 0 painful; this way each file changes by 34 lines. If both waves touch those two files, take either side and re-run `npm run trace -- --record-results <saved output>`.
- New: `tests/obligations.test.mjs` (11 tests). Extended: `tests/inbox.test.mjs`, `tests/home.test.mjs` (one new test, three updated). Updated because they encoded the old behaviour: `tests/workspace.test.mjs` (role-based executive gate), `tests/routing-portal.test.mjs` (the hard-coded quick services), `tests/notifications-email.test.mjs` (aged the item through `updated_at`).
- `PLT-10` in `docs/implementation/REQUIREMENTS.json` lists the new module and test. Its status and coverage were not changed.
