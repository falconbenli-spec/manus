# Notifications, email delivery, daily reminders and session security — 19 September 2026

**Source.** `docs/product/benchmark/REF-APP-GAP-REPORT-20260919.md` P1 #6 and the P2 security items; `REF-APP-ENGINEERING.md` §3 (headers, cron, e-mail pipeline, notifications, idle logout) and §5 P2-1 to P2-5; the open items in `portal-fixes-20260919.md`.

**State.** Built and tested locally on synthetic data. **Email is OFF**: no provider is configured and nothing leaves the platform until the owner sets the environment variables below. Nobody has accepted this work yet. The owner decides the provider, domain and policy values listed in §9.

## 1. Files

| File | Change |
|---|---|
| `app/migrations/100-notifications-email.sql` | New. See §2. |
| `app/mailer.mjs` | New. Zero-dependency sender: config from env, adapter interface, JSON adapter, escaped RTL templates, content guard. |
| `app/delivery.mjs` | New. Email preferences, work email, outbox planner, the `mail.send` worker, rate limit, admin board, requeue. |
| `app/reminders.mjs` | New. The `reminders.daily` job and its settings. |
| `app/security-alerts.mjs` | New. Alerts to platform admins and account owners. |
| `app/session-policy.mjs` | New. Idle timeout policy. |
| `app/module-notices.mjs` | New. Notice text for training, performance, timesheets, missions, overtime, absences and letters. |
| `app/static/notifications-ui.mjs` | New. `#notification-settings` for everyone, `#mail` for platform admins. |
| `tests/notifications-email.test.mjs` | New, 12 tests. |
| `app/jobs.mjs` | External handlers (`registerExternalHandler`, `runDueExternal`), `hasHandler`, `enqueue(...,{audit:false})`. The synchronous `runDue` no longer claims external job types. |
| `app/notices.mjs` | New subjects in `SUBJECT_LINKS`, `NOTICE_CATEGORIES`, `categoryOf`, `notifyMany`, confidential `hrCaseNotice`. |
| `app/workflow.mjs` | B21 fix, `category` on request notices, paging, `markAllNotifications`, `unreadCount`. |
| `app/auth.mjs` | Idle timeout in `authenticate`, `last_seen`, failed-login alert, named-column session insert. |
| `app/access.mjs`, `app/totp.mjs` | One alert call each (sensitive grant / new admin; MFA reset). |
| `app/hr-cases.mjs`, `app/talent.mjs`, `app/timesheets.mjs`, `app/attendance.mjs`, `app/attendance-extras.mjs`, `app/letters.mjs` | One import plus one-line notice calls after the existing audit lines. No logic changed. |
| `app/server.mjs` | Headers, conditional HSTS, routes (§7), handler registration and the mail tick. |
| `app/integration-readiness.mjs`, `app/static/integrations-ui.mjs` | Event count limited to `channel='event'`; mail status line. |
| `app/static/app.mjs` | «تعليم الكل كمقروء» button, link to settings, idle message on 401, two nav entries. |
| `app/static/operations.mjs`, `app/static/hr-design.mjs`, `app/static/security-ui.mjs` | Register the two screens; idle policy panel on `#security` for the super admin. |

## 2. Migration 100

1. **`notifications` rebuilt.** It keeps every column from 096 and uses the same `subject_kind` format rule as 099 (lower-case letters and underscore, 3–40 characters). It adds a nullable `category` column limited to the six categories. Existing rows are copied unchanged. **Merge note (§8):** 099 also rebuilds this table.
2. **`outbox` rebuilt** with `channel` (`event` | `email`) and `status` (`queued`, `sent`, `failed`, `blocked`, `suppressed`). It also gains `attempts`, `provider_id`, `last_error` and `sent_at`. The old `request.approved` rows are copied as `channel='event'` and stay `blocked`. The recipient address is **not** stored here. `notification_id` has no declared foreign key, so a later rebuild of `notifications` does not rewrite this table.
3. `employee_profiles.work_email`, nullable, with a format check.
4. `notification_email_prefs`: the categories each user receives by email.
5. `mail_delivery_state`: a per-tenant cursor. Notices from before the first planner run are never emailed.
6. `reminder_log` (append-only): one row per reminder key. `reminder_settings` holds a draft: 3 days for overdue decisions, manager digest on.
7. `sessions.last_seen`, plus `security_settings` columns for the idle policy. The draft default is 30 minutes for sensitive sessions and none for the rest.

## 3. Notifications

- **HR cases**, confidential. The text is generic and carries the case number only (first 8 hex characters of its id). There is no category, subject, party name or reply text.
  - «حالة سرية جديدة بانتظار الاستلام رقم …» goes to eligible handlers when a case is filed. The reporter and the named respondent are excluded.
  - The reporter gets «تحديث على حالتك رقم …» when the case is taken, reassigned, replied to or decided, and «أُغلقت حالتك رقم …» when it is closed.
  - The assignee gets «تحديث على الحالة المسندة إليك رقم …» when the reporter adds information or withdraws.
  - A new assignee is told the case is theirs.
  - Internal notes notify nobody. Anonymous reports send nothing.
- **Training:** the manager hears about a request, or the employee hears when a manager requests training for them. Approval and rejection go to the employee.
- **Performance:**
  - Everyone reviewed is told when the cycle opens and when results are released.
  - The manager hears when a self-review is in.
  - Calibrators hear about an appeal. The employee hears the appeal decision and any exclusion.
  - **No score appears in any notice.**
- **Timesheets:** the manager hears when a week is submitted. The employee hears when it is approved or returned.
- **Missions and overtime:** the manager hears about a request; the employee hears the decision.
- **Unpaid absences:** the employee is asked for a statement when an absence is proposed, then told whether it was confirmed or dismissed.
- **Letters:** the employee is told when a letter is prepared, when the request is cancelled, and when an issued letter is cancelled (with its reference).
- **B21:** after the last step of a multi-step chain, the handling department's executors get `ready_for_execution`. The final approver, requester and beneficiary are excluded, and so is anyone who approved a step when the service sets `sod`.
- **Page:**
  - `GET /api/notifications` still returns an array. It now takes `?limit=` (default 200, maximum 500), `?before=<created_at>` and `?unread=1`.
  - `POST /api/notifications/read-all` marks only the caller's own notices.
  - `GET /api/notifications/unread-count` returns `{unread, by_category, capped}`. This is the data source for the unread badge. The badge itself is left to the employee-UX work (101).

Free-text approver notes never enter a notice. The rule from 096 still holds.

## 4. Email pipeline

**Flow:**
1. A notice is always written in-app.
2. Once a minute, `planDeliveries` gives each new notice one outbox row.
   - `suppressed` if the account is inactive, the user has turned that category off, or the employee record has no work email.
   - `blocked` if mail is not configured.
   - Otherwise `queued`, and a `mail.send` job is added (no audit line per job, because the outbox row is the record).
3. `drainMail` runs `runDueExternal`:
   - **prepare**, inside a transaction: re-checks config, account and preference, reads the address from the employee record, and renders the message.
   - **perform**, outside any transaction: `fetch` to the provider.
   - **settle**, inside a transaction: records `sent` with the provider id, a retry, or `failed`.

**Retry:**
- The job backs off from 1 minute, doubling up to 1 hour, over 6 attempts.
- Network errors, timeouts, 429 and 5xx are retried. Any other 4xx fails at once.
- After the last attempt the outbox row is `failed`, and the job is `dead` on the jobs board.
- Every retry of a message sends the same `Idempotency-Key` (the outbox row id).
- `settle` writes the outbox row even when the job lock was lost, so a second worker sees `sent` and skips it.
- The admin can requeue `blocked` or `failed` mail from the last 7 days, up to 500 rows, with a written reason.

**Rate limit:** `MAIL_RATE_PER_MINUTE` per tenant (default 30). Mail sent in the last 60 seconds counts against it.

**Kill switch:** `MAIL_DELIVERY=off`.

**Content:** a greeting with the recipient's name, one generic line for the category, and a button that links to the record's screen (for example `…/#expenses`). The message never includes the notice title or body.
- **Why:** titles can hold a leave type («الإجازة المرضية» is health data), a person's name or a reference.
- `assertMailSafe` rejects any message that contains any of these:
  - six or more consecutive digits
  - an IBAN
  - a currency amount
  - salary words
  - health words
- A name that matches one of these patterns is dropped from the greeting, so a name such as «مرضي» does not block the message.
- Each message has an HTML part (`lang="ar" dir="rtl"`, every value escaped) and a plain-text part.

**Provider adapter:** `{name, request(config,message)→{url,init}, parse(status,body)→{providerId}}`. The one adapter, `json`, sends `POST {from,to,subject,html,text}` with `Authorization: Bearer` and `Idempotency-Key`. It reads the provider id from `id`, `messageId`, `MessageID`, `message_id` or `data.id`. A provider with another shape needs one more adapter object.

### Environment variables (read from `process.env`; the server loads `.env` itself at start)

| Variable | Required | Meaning |
|---|---|---|
| `MAIL_PROVIDER_URL` | yes | HTTPS endpoint of the provider's send API |
| `MAIL_API_KEY` | yes | Provider key. Never stored in the database and never shown on a screen; it is removed from stored error text. |
| `MAIL_FROM` | yes | Sender address on the company's verified domain |
| `MAIL_APP_URL` | no | HTTPS base URL for the button. Without it the message says «افتح المنصة» with no link. |
| `MAIL_FROM_NAME` | no | Display name (default «منصة 3,6T») |
| `MAIL_RATE_PER_MINUTE` | no | 1–600, default 30 |
| `MAIL_ALLOWED_DOMAIN` | no | Restricts the work emails HR can record to `@domain` |
| `MAIL_DELIVERY` | no | `off` stops all sending |
| `TRUST_PROXY` | no | `1`/`true`: honour `x-forwarded-proto=https` for HSTS |

If any required variable is missing or invalid, `#mail` shows «البريد غير مفعّل — يحتاج قرار المالك باختيار المزوّد» with the names of the missing variables, and the worker marks mail `blocked`.

**Work email:** HR (`employees.view`) records it through `POST /api/employees/:id/work-email` or on `#notification-settings`. The employee must already have a profile. Screens show the address masked, and the audit line holds the masked form.

**Preferences:** `#notification-settings` shows the six categories. In-app notices are always on. Until the owner decides otherwise, **all categories are emailed by default**.

## 5. Daily reminders

- **Schedule:** `scheduleDaily` runs on every jobs tick. From 08:00 Riyadh (UTC+3) it adds one `reminders.daily` job per tenant, with idempotency key `reminders.daily:<date>`. The job is registered to the tenant's first active super admin, as owner of the schedule.
- **Restarts and repeats:**
  - A restart or a second tick finds the existing job.
  - Before 08:00 nothing happens.
  - A day the server was down is not backfilled.
  - Every reminder writes its key to `reminder_log`, so a re-run of the same day sends nothing twice.
- **Expiry:**
  - **Lead times:** read from `expiry_watch_settings` only.
  - **Kinds with no setting:** send nothing. The job result lists them as `needs_owner_decision`, and `#mail` shows that list.
  - **Stages:** each document is reminded once per stage: first, second, and expired. Expired documents are reminded only within 30 days of expiry.
  - **Recipients:**
    - Employee documents: the employee and holders of `employees.view`.
    - Fixed-term contracts: holders of `hr.contracts.manage`. The employee is not told; the renewal decision is HR's.
    - Vendor documents: holders of `vendors.manage`.
  - **Content:** no document number.
- **Probation:**
  - **Due date:** the end of probation is `start_date + probation_days − 1`, and the manager's report is due 14 days before that (Article 25 of the regulations, as briefed).
  - **Recipients:** the line manager is reminded once, or the `employees.view` holders if there is no active manager.
- **Decisions pending N days (draft N = 3):**
  - **Source:** the «بانتظار قراري» inbox of each non-employee, plus anyone holding a pending approval step, so leave, expenses and every other decision screen count.
  - **Frequency:** one notice per person per day.
- **Manager digest (draft: on):**
  - **Content:** items waiting on the manager, how many are late, and the team members on approved leave today.
  - **When:** only if something is non-zero.
- **Settings:** `#mail` shows the settings, and the super admin can change them (`POST /api/mail/reminder-settings`, reason required, status becomes `approved`).

## 6. Security

**Alerts.** Recipients are the active platform admins, never the admin who acted. Category: `security`.

| Event | Trigger | Also told |
|---|---|---|
| Repeated failed logins | Exactly the 5th failure for the same account and address within the existing 15-minute window. Only for existing usernames. No IP in the text. | — |
| MFA reset | `resetTotp` | The account owner |
| Sensitive capability grant | `grantAccess` of a `sensitive` capability | The account owner |
| New admin | `setAdminLevel` from none to any level, or scoped to super; or a grant of an `admin` capability | — |

**Idle timeout:**
- **Enforcement:** `authenticate(db, cookie, {now})` deletes a session that has been idle past the limit and returns 401 `session_expired` with `details.reason='idle'`. The client then shows «انتهت الجلسة لعدم النشاط».
- **Activity:** any request counts as activity. `last_seen` is written at most once a minute.
- **Sensitive session:** the account is role `admin`, has a role that grants a sensitive capability by default (today `hr`), or holds a live sensitive grant.
- **Policy:** the draft (30 minutes for sensitive sessions, none otherwise) is **enforced as seeded**. The super admin sets the owner's values on `#security`, and the status then becomes `approved`.

**Headers:**
- Every response carries `Cross-Origin-Opener-Policy: same-origin`, `X-Permitted-Cross-Domain-Policies: none` and `Origin-Agent-Cluster: ?1`.
- `Strict-Transport-Security: max-age=31536000; includeSubDomains` is sent only in these cases:
  - the socket is TLS
  - a `previewOrigin` (always HTTPS) is set
  - `TRUST_PROXY` is set and the request has `x-forwarded-proto: https`
- The CSP is unchanged.

## 7. Routes added

| Method | Route |
|---|---|
| GET | `/api/notifications/unread-count`, `/api/notification-settings`, `/api/mail` |
| POST | `/api/notifications/read-all`, `/api/notification-settings`, `/api/employees/:id/work-email`, `/api/mail/requeue`, `/api/mail/reminder-settings`, `/api/admin/security/idle` |

`GET /api/account/totp` now also returns `idle`, which is set for the super admin only.

## 8. Merge notes for the coordinator

- **099 also rebuilds `notifications`.** Migration 100 rebuilds it once more to add `category`. It uses 099's `subject_kind` format rule word for word and copies every 096/099 column.
  - **Why the rebuild:** without 099, this branch still has 096's closed list of `subject_kind` values, which rejects `hr_case`, `training` and the other new subjects. SQLite cannot widen a CHECK in place.
  - **After the merge the result is the same.** If you want to drop the second rebuild, replace section 1 of 100 (from the `ALTER TABLE notifications RENAME` line to the last `CREATE INDEX notifications_*`) with these lines:

    ```sql
    ALTER TABLE notifications ADD COLUMN category TEXT CHECK(category IS NULL OR category IN ('approvals','my_requests','hr_cases','development','reminders','security'));
    CREATE INDEX notifications_unread ON notifications(user_id,read_at);
    CREATE INDEX notifications_created ON notifications(created_at);
    ```

    Only do this before 100 is applied to any database you keep.
- **Order of migrations on existing databases.** A database that ran 100 before 099 exists (for example, a local database started on this branch) will lose `category` when 099's rebuild runs after it. Recreate synthetic databases after the merge.
- **Attendance files.** `attendance.mjs` and `attendance-extras.mjs` gain one import and one notice call after each audit line. If 099 rewrites these functions, keep the `absenceNotice`, `missionNotice` and `overtimeNotice` calls.
- **`STATUS.md`** has a short entry at the top.

## 9. Owner decisions (nothing below is assumed as decided)

1. **Email provider.** Any HTTPS JSON API that fits the `json` adapter, or one more adapter object for another shape. Consider:
   - data residency
   - price
   - idempotency support
   - a signed DPA
2. **Sending domain and DNS.** The From domain, its SPF, DKIM and DMARC records, and a reply-to or no-reply policy.
3. **Key custody.** Decide:
   - who creates the provider key
   - where it is kept (the `.env` next to the server, readable by the server account only)
   - who rotates it, and how often
   - who revokes it if it is exposed

   The platform never stores or displays it.
4. **PDPL review.** Recipient addresses and the recipient's name leave the Kingdom if the provider stores mail abroad, so a cross-border transfer assessment is needed. Also record the lawful basis for work email notices and the provider's retention and deletion terms.
5. **Default email categories.** Today all six are on by default. Choose opt-in or opt-out per category, especially `hr_cases`.
6. **Idle timeout values.** The seed is 30 minutes for sensitive sessions and none for others. The engineering note suggested 2 hours for others.
7. **Reminder values:**
   - days before an overdue-decision reminder (draft 3)
   - whether the manager digest runs (draft on)
   - `expiry_watch_settings` lead times for each document kind. **Until these are entered, no expiry reminder is sent.**
8. **Recipients to confirm.**
   - Vendor documents go to `vendors.manage` holders.
   - Contract end is not sent to the employee.
   - Probation goes to the line manager, or HR if there is none.
   - Security alerts reach admins by email only if the admin has an employee profile with a work email.
9. **Failed-login alert threshold** (5, the engineering note's value), and whether unknown usernames should alert too.
10. **Article 25 wording** for the probation report. Confirm it against the signed regulations.

## 10. Tests and checks

- **New:** `tests/notifications-email.test.mjs`, 12 tests.
  1. Without configuration the worker blocks mail, and the admin screen shows the owner message.
  2. Sending through a mocked `fetch`:
     - Bearer key and idempotency key
     - provider id stored
     - key and address never shown or stored
     - preference suppression
  3. Retry with backoff:
     - 503 then success after one minute
     - rate limit of 1 per minute
     - 400 fails at once
     - six network failures dead-letter
     - requeue
  4. Template escaping, RTL, header-injection and link-injection fallbacks.
  5. No salary, ID, IBAN or health data in a sent mail, even when the in-app title has them. HR-case notices carry no case text.
  6. The daily job:
     - nothing before 08:00
     - one job per day
     - a duplicate after a simulated restart
     - reminders once per stage
     - no sending without lead times, with the kinds listed for a decision
  7. Probation, overdue decisions and the manager digest; settings for the super admin only.
  8. Mark-all-read over HTTP, the unread count, and paging.
  9. B21, missions and training notices.
  10. The four security alerts.
  11. The idle timeout with an injected clock, including the owner changing the policy.
  12. Security headers, with HSTS only over HTTPS or a trusted proxy.
- **`npm test`:** 726 tests, 726 pass, 0 fail (714 before + 12 new).
- **`npm run check`:** syntax check of 375 modules passed, source hashes match, traceability 220 requirements in 22 domains.
- **Not done:**
  - No live send to a real provider; no provider exists.
  - No browser check of the two new screens. Their render functions were smoke-tested in Node with real board data.
  - `docs/traceability.json` was not updated.
