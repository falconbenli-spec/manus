# Team workspace implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** تحويل «مهام» إلى مساحة عمل جماعية تشمل القوائم والملفات والرسائل والمحادثة والجدول والبطاقات والأسئلة الدورية والأشخاص والبحث والتقارير.

**Architecture:** كل مساحة تعاون ترتبط بسجل مشروع أو إدارة أو مبادرة دون نسخ بياناته. مهام المشاريع القائمة تبقى في `tasks` وتكتسب قائمة وترتيبًا؛ مهام الإدارات والمبادرات تحفظ في `space_tasks`. لوحة البطاقات والقوائم تقرآن العقد نفسه. المحتوى الرسمي والمحادثة والتقويم والأسئلة موارد مستقلة بصلاحيات المساحة وسجل تدقيق واحد.

**Tech Stack:** Node.js 24.14، JavaScript ESM، SQLite STRICT، HTML مولد، CSS أصلي، `node:test`.

**Spec:** `docs/superpowers/specs/2026-10-02-omni-experience-executive-cockpit-design.md`، القسم 5.7.

## Execution status — 2 October 2026

Tasks 1–10 are implemented on `codex/team-workspace`. Focused verification passed 28/28. The repository gate passed 9/9 with 2,222/2,222 tests, zero failures, and zero skips. Evidence is in `docs/testing/team-workspace-20261002/`. The remaining work is operational acceptance and the external services explicitly excluded by this plan.

## Global constraints

- لا قاعدة مشاريع بديلة. `collaboration_spaces.target_kind/target_id` رابط واحد إلى المصدر.
- مهام الطلبات تظهر في «عملي» للقراءة والفعل الأصلي، ولا تصبح بطاقات حرة.
- البطاقة والقائمة تمثلان المهمة نفسها.
- دليل السجل الحالي ثابت. الملف التعاوني يحتاج نشر نسخة صريحة قبل استعماله دليلًا.
- الإعلان المؤسسي في `announcements` لا يختلط بمنشور المشروع.
- Campfire لا يعتمد طلبًا ولا يغلق قرارًا أو مخرجًا.
- الأسئلة الدورية معلنة الهوية ولا تستخدم جداول Pulse المجهولة.
- الضيف الخارجي/العميل معطل في هذه الخطة؛ الأنواع موجودة في العقد لكن الخادم يرفض منحها حتى قرار المالك.
- لا إشعار خارجي، بريد، Teams، أو Basecamp API.
- الترحيلات المحجوزة: `196` للأساس والمهام، و`197` للمحتوى التعاوني.
- تعديلات Claude في `app/static/home-ui.mjs`, `app/static/classic.css`, و`app/static/app.mjs` تبقى خارج العمل حتى Task 9.

## Review focus

- عضوية منتهية أو مزالة: تمنع القراءة والتنزيل فورًا، ويغطيها Task 2.
- نقلان متزامنان لبطاقة: يفشل الإصدار القديم بدل فقد ترتيب، ويغطيه Task 3.
- ملف جديد بعد نشر نسخة منه دليلًا: لا يغير الدليل، ويغطيه Task 4.
- رسالة مسحوبة أو محادثة محجوبة: يبقى الأثر ولا يتسرب النص لقارئ غير مخول، ويغطيه Task 5.
- سؤال دوري قرب تغير التوقيت/المنطقة: يولد دورة واحدة بتوقيت الرياض، ويغطيه Task 6.

---

### Task 1: مخطط المساحات والقوائم والمهام

**Files:**
- Create: `app/migrations/196-collaboration-core.sql`
- Create: `app/collaboration-space.mjs`
- Test: `tests/collaboration-space.test.mjs`

**Interfaces:**
- Produces: `spaceForTarget(db,user,{kind,id})`, `spaceById(db,user,id)`, `ensureSpace(db,user,{kind,id})`, `spaceCapabilities(db,user,space)`.
- Valid targets: `project`, `department`, `initiative`.

- [ ] **Step 1: Write schema and tenant-isolation tests**

```js
test('one target has one space and membership never crosses tenants',t=>{
  const {db,manager}=fixture(t);
  const a=tx(db,()=>ensureSpace(db,manager,{kind:'project',id:'project-1'}));
  const b=tx(db,()=>ensureSpace(db,manager,{kind:'project',id:'project-1'}));
  assert.equal(a.id,b.id);
  assert.throws(()=>db.prepare("INSERT INTO collaboration_memberships(id,tenant_id,space_id,user_id,role,starts_at) VALUES('x','isolated',?,'employee','member',?)").run(a.id,now()));
});
```

- [ ] **Step 2: Run the test and verify the missing-table failure**

Run: `node --test tests/collaboration-space.test.mjs`

Expected: FAIL with `no such table: collaboration_spaces`.

- [ ] **Step 3: Create the core schema and authorization module**

The migration creates:

```text
collaboration_spaces, collaboration_memberships, work_lists,
space_tasks, space_task_contributors, space_task_comments,
space_activity
```

It adds nullable `list_id`, `sort_order`, `start_on`, and `priority` to existing `tasks`. Membership roles are `owner`, `manager`, `member`, `internal_guest`, `external_guest`; inserting `external_guest` is blocked by a trigger until a future adopted setting exists. `ensureSpace` derives initial members from `project_members` or active department users and does not copy customer, budget, or project status.

- [ ] **Step 4: Run the core tests**

Run: `node --test tests/collaboration-space.test.mjs tests/project-axes.test.mjs tests/workspace.test.mjs`

Expected: PASS; existing project behavior remains unchanged.

- [ ] **Step 5: Commit**

```bash
git add app/migrations/196-collaboration-core.sql app/collaboration-space.mjs tests/collaboration-space.test.mjs
git commit -m "feat: add governed collaboration spaces"
```

### Task 2: العضوية وصلاحيات مساحة العمل

**Files:**
- Create: `app/collaboration-access.mjs`
- Test: `tests/collaboration-access.test.mjs`
- Modify: `app/access.mjs`

**Interfaces:**
- Produces: `collaborationActor(db,user,spaceId)`, `canSpace(db,user,space,action)`, `addSpaceMember`, `removeSpaceMember`, `changeSpaceRole`.
- Actions: `space.read`, `space.organize`, `space.task`, `space.publish`, `space.chat`, `space.files`, `space.people`.

- [ ] **Step 1: Write expiry, removal, and admin-separation tests**

```js
test('removing a member revokes every new read but keeps authorship',t=>{
  const {db,owner,member,space}=fixture(t);
  tx(db,()=>removeSpaceMember(db,owner,space.id,member.id,{reason:'انتهاء المشاركة التجريبية'}));
  assert.throws(()=>spaceById(db,member,space.id),error=>error.status===404);
  assert.equal(db.prepare('SELECT removed_by FROM collaboration_memberships WHERE space_id=? AND user_id=?').get(space.id,member.id).removed_by,owner.id);
  assert.throws(()=>spaceById(db,user(db,'admin'),space.id),error=>error.status===404);
});
```

- [ ] **Step 2: Run the test and verify missing functions**

Run: `node --test tests/collaboration-access.test.mjs`

Expected: FAIL.

- [ ] **Step 3: Implement server-side capability checks**

`collaborationActor` checks tenant, active account, membership dates, removal, and target visibility. Project owners cannot add people who fail the existing project scope. Department owners use department permission levels. Every membership change records reason and audit event; past activity keeps the original actor ID.

- [ ] **Step 4: Run access regression tests**

Run: `node --test tests/collaboration-access.test.mjs tests/access.test.mjs tests/department-permissions.test.mjs tests/project-participation.test.mjs`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/collaboration-access.mjs app/access.mjs tests/collaboration-access.test.mjs
git commit -m "feat: enforce collaboration space membership"
```

### Task 3: القوائم والمهام وجدول البطاقات

**Files:**
- Create: `app/collaboration-tasks.mjs`
- Modify: `app/projects.mjs`
- Modify: `app/workspace.mjs`
- Test: `tests/collaboration-tasks.test.mjs`
- Modify: `tests/workspace.test.mjs`

**Interfaces:**
- Produces: `taskBoard(db,user,spaceId)`, `createList`, `reorderList`, `createSpaceTask`, `updateSpaceTask`, `moveTask`, `completeSpaceTask`, `reopenSpaceTask`, `commentOnTask`.
- `taskBoard` normalizes project and space tasks to `{id,source,list_id,title,accountable_id,contributors,start_on,due_on,priority,status,acceptance,evidence,version,position,actions}`.

- [ ] **Step 1: Write ordering, evidence, and dependency tests**

```js
test('card movement cannot bypass evidence or overwrite a newer order',t=>{
  const {db,manager,space}=fixture(t);
  const task=tx(db,()=>createSpaceTask(db,manager,space.id,{list_id:'doing',title:'تسليم نسخة مصطنعة',accountable_id:'employee',due_on:'2026-10-08',acceptance:'رابط النسخة المقبولة'}));
  assert.throws(()=>tx(db,()=>moveTask(db,manager,space.id,task.id,{version:task.version,to_list_id:'done',position:0})),code('evidence_required'));
  const moved=tx(db,()=>moveTask(db,manager,space.id,task.id,{version:task.version,to_list_id:'doing',position:1}));
  assert.throws(()=>tx(db,()=>moveTask(db,manager,space.id,task.id,{version:task.version,to_list_id:'later',position:0})),code('version_conflict'));
  assert.equal(moved.position,1);
});
```

- [ ] **Step 2: Run and verify the missing service failure**

Run: `node --test tests/collaboration-tasks.test.mjs`

Expected: FAIL.

- [ ] **Step 3: Implement lists, task adapters, and transactions**

Use one transaction for a move: verify version, close the old position gap, open the new gap, update list/status/version, append `space_activity`, and audit. Mapping an end column to completed calls the source-specific completion rule. Request tasks remain links to their original action and reject `moveTask`.

- [ ] **Step 4: Run task and project tests**

Run: `node --test tests/collaboration-tasks.test.mjs tests/workspace.test.mjs tests/project-axes.test.mjs tests/project-spine.test.mjs`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/collaboration-tasks.mjs app/projects.mjs app/workspace.mjs tests/collaboration-tasks.test.mjs tests/workspace.test.mjs
git commit -m "feat: add shared task lists and card transitions"
```

### Task 4: المستندات والملفات والإصدارات

**Files:**
- Create: `app/migrations/197-collaboration-content.sql`
- Create: `app/collaboration-files.mjs`
- Test: `tests/collaboration-files.test.mjs`

**Interfaces:**
- Produces: `filesBoard`, `createFolder`, `createDocument`, `saveDocumentRevision`, `uploadWorkspaceFile`, `publishFileAsEvidence`, `downloadWorkspaceFile`.
- Scan states: `pending`, `clean`, `blocked`, `unavailable`.

- [ ] **Step 1: Write immutable-evidence and authorization tests**

```js
test('publishing a file as evidence pins one digest',t=>{
  const {db,member,space}=fixture(t);
  const file=tx(db,()=>uploadWorkspaceFile(db,member,space.id,pdf('v1')));
  const proof=tx(db,()=>publishFileAsEvidence(db,member,space.id,file.id,{version:file.version,entity_type:'space_task',entity_id:'task-1',label:'التسليم'}));
  tx(db,()=>uploadWorkspaceFile(db,member,space.id,pdf('v2'),{replaces_id:file.id}));
  assert.equal(db.prepare('SELECT digest FROM workspace_evidence_links WHERE id=?').get(proof.id).digest,file.digest);
});
```

- [ ] **Step 2: Run and verify the missing-table failure**

Run: `node --test tests/collaboration-files.test.mjs`

Expected: FAIL.

- [ ] **Step 3: Add content schema and file service**

The migration creates `workspace_folders`, `workspace_documents`, `workspace_document_revisions`, `workspace_files`, `workspace_file_versions`, and `workspace_evidence_links`. Blob versions are content-addressed and immutable. A new upload starts `unavailable` when no scanner is configured; only `clean` can be downloaded in a production-classified environment, while synthetic local tests can explicitly permit `unavailable` and display the state.

- [ ] **Step 4: Run file security tests**

Run: `node --test tests/collaboration-files.test.mjs tests/files-security.test.mjs tests/platform-ops-pii.test.mjs`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/migrations/197-collaboration-content.sql app/collaboration-files.mjs tests/collaboration-files.test.mjs
git commit -m "feat: add versioned workspace documents and files"
```

### Task 5: لوحة الرسائل وCampfire

**Files:**
- Create: `app/collaboration-messages.mjs`
- Test: `tests/collaboration-messages.test.mjs`

**Interfaces:**
- Produces: `messageBoard`, `publishTopic`, `reviseTopic`, `withdrawTopic`, `commentOnTopic`, `chatLines`, `postChatLine`, `reviseChatLine`, `redactChatLine`, `convertToTask`.

- [ ] **Step 1: Write separation and redaction tests**

```js
test('chat cannot become approval and redaction keeps the audit trail',t=>{
  const {db,member,space}=fixture(t);
  const line=tx(db,()=>postChatLine(db,member,space.id,{body:'ملاحظة سريعة مصطنعة'}));
  assert.throws(()=>tx(db,()=>postChatLine(db,member,space.id,{body:'اعتمدت الصرف',effect:'approve'})),code('unexpected_field'));
  tx(db,()=>redactChatLine(db,member,space.id,line.id,{version:line.version,reason:'احتوى معلومة غير لازمة'}));
  assert.equal(chatLines(db,member,space.id).items[0].body,null);
  assert.ok(db.prepare('SELECT 1 FROM chat_line_revisions WHERE line_id=?').get(line.id));
});
```

- [ ] **Step 2: Run and verify missing functions**

Run: `node --test tests/collaboration-messages.test.mjs`

Expected: FAIL.

- [ ] **Step 3: Implement formal topics and quick chat**

Topics have revisions and flat comments tied to the parent topic. Chat lines use cursor pagination by `(created_at,id)`. Mentions resolve only active space members. `convertToTask` writes `source_kind/source_id` on the task and never changes the message. Withdrawing or redacting needs a reason and preserves a restricted revision.

- [ ] **Step 4: Run message and announcement tests**

Run: `node --test tests/collaboration-messages.test.mjs tests/engagement.test.mjs tests/platform-ops-pii.test.mjs`

Expected: PASS; company announcements still require their existing preparation and approval path.

- [ ] **Step 5: Commit**

```bash
git add app/collaboration-messages.mjs tests/collaboration-messages.test.mjs
git commit -m "feat: add workspace messages and Campfire chat"
```

### Task 6: الجدول والأسئلة الدورية

**Files:**
- Create: `app/collaboration-schedule.mjs`
- Create: `app/collaboration-checkins.mjs`
- Test: `tests/collaboration-schedule.test.mjs`
- Test: `tests/collaboration-checkins.test.mjs`

**Interfaces:**
- Produces: `scheduleBoard`, `createEvent`, `cancelEvent`, `checkinBoard`, `createCheckin`, `runDueCheckins`, `answerCheckin`, `convertAnswerToTask`.

- [ ] **Step 1: Write recurrence and privacy tests**

```js
test('a due weekly check-in creates one Riyadh cycle and keeps named answers out of Pulse',t=>{
  const {db,manager,employee,space}=fixture(t,'2026-10-04T05:00:00.000Z');
  const checkin=tx(db,()=>createCheckin(db,manager,space.id,{prompt:'وش أنجزت هذا الأسبوع؟',cadence:'weekly',weekday:0,due_time:'09:00'}));
  tx(db,()=>runDueCheckins(db,{at:'2026-10-04T06:01:00.000Z'}));
  tx(db,()=>runDueCheckins(db,{at:'2026-10-04T06:02:00.000Z'}));
  assert.equal(db.prepare('SELECT COUNT(*) n FROM workspace_checkin_cycles WHERE checkin_id=?').get(checkin.id).n,1);
  tx(db,()=>answerCheckin(db,employee,checkin.id,{body:'أنجزت مهمة تجريبية'}));
  assert.equal(db.prepare('SELECT COUNT(*) n FROM pulse_answers').get().n,0);
});
```

- [ ] **Step 2: Run and verify missing modules**

Run: `node --test tests/collaboration-schedule.test.mjs tests/collaboration-checkins.test.mjs`

Expected: FAIL.

- [ ] **Step 3: Implement events and recurring check-ins**

Events store UTC plus `timezone='Asia/Riyadh'`, cancellation reason, attendees, and recurrence rule limited to none/daily/weekly/monthly. Check-in generation uses a unique `(checkin_id,scheduled_for)` key. Reminders create in-app notifications/jobs only. Non-response is visible to `space.organize` and never writes performance or discipline data.

- [ ] **Step 4: Run schedule and engagement tests**

Run: `node --test tests/collaboration-schedule.test.mjs tests/collaboration-checkins.test.mjs tests/engagement.test.mjs tests/workflow-timer-clock.test.mjs`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/collaboration-schedule.mjs app/collaboration-checkins.mjs tests/collaboration-schedule.test.mjs tests/collaboration-checkins.test.mjs
git commit -m "feat: add workspace schedule and team check-ins"
```

### Task 7: البحث والنشاط والتقارير

**Files:**
- Create: `app/collaboration-reports.mjs`
- Modify: `app/search.mjs`
- Test: `tests/collaboration-search.test.mjs`
- Test: `tests/collaboration-reports.test.mjs`

**Interfaces:**
- Adds search entity types `space_task`, `workspace_document`, `workspace_topic`, `workspace_event`, `workspace_checkin`.
- Produces: `activityFeed(db,user,spaceId,{cursor})`, `workspaceReport(db,user,spaceId,{from,to})`.

- [ ] **Step 1: Write title-leak and report-drilldown tests**

```js
test('search never reveals a workspace title after membership removal',t=>{
  const {db,owner,member,space}=fixture(t);
  tx(db,()=>publishTopic(db,owner,space.id,{title:'خطة سرية مصطنعة',body:'نص تجريبي'}));
  tx(db,()=>reindex(db,'36t'));
  assert.ok(searchAll(db,member,'خطة سرية').total>0);
  tx(db,()=>removeSpaceMember(db,owner,space.id,member.id,{reason:'انتهاء المشاركة'}));
  assert.equal(searchAll(db,member,'خطة سرية').total,0);
});
```

- [ ] **Step 2: Run and verify the entity types are missing**

Run: `node --test tests/collaboration-search.test.mjs tests/collaboration-reports.test.mjs`

Expected: FAIL.

- [ ] **Step 3: Extend the derived index and reporting**

Join every collaboration index row to `collaboration_memberships` with active dates in the SQL scope. Do not index raw chat or file contents. Reports return counts and rows from the same filtered query, so every number drills to its source list. Workload is labeled as task count/estimate and never as an employee score.

- [ ] **Step 4: Run search regressions**

Run: `node --test tests/collaboration-search.test.mjs tests/collaboration-reports.test.mjs tests/search.test.mjs tests/definitions-leak.test.mjs`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/collaboration-reports.mjs app/search.mjs tests/collaboration-search.test.mjs tests/collaboration-reports.test.mjs
git commit -m "feat: index and report workspace activity"
```

### Task 8: خادم مساحة العمل

**Files:**
- Modify: `app/server.mjs`
- Test: `tests/collaboration-api.test.mjs`

**Interfaces:**
- Adds REST resources under `/api/spaces/:spaceId/` for lists, tasks, files, documents, topics, chat, events, check-ins, people, activity, and reports.

- [ ] **Step 1: Write route, CSRF, idempotency, and pagination tests**

```js
test('workspace writes require CSRF and creation is idempotent',async t=>{
  const {call,token,csrf,space}=await serverFixture(t);
  assert.equal((await call(`/api/spaces/${space.id}/tasks`,{method:'POST',token,body:{title:'مهمة'}})).status,403);
  const headers={'x-csrf-token':csrf,'idempotency-key':'workspace-task-1'};
  const a=await call(`/api/spaces/${space.id}/tasks`,{method:'POST',token,headers,body:validTask});
  const b=await call(`/api/spaces/${space.id}/tasks`,{method:'POST',token,headers,body:validTask});
  assert.equal(a.body.id,b.body.id);
});
```

- [ ] **Step 2: Run and verify routes return 404**

Run: `node --test tests/collaboration-api.test.mjs`

Expected: FAIL.

- [ ] **Step 3: Wire resource routes**

Parse UUIDs and cursor/limit centrally. Writes run in `transaction` and use the server `once` helper for creates. Never return blob content in board endpoints. Download routes recheck membership on every request and use `Cache-Control: private, no-store`.

- [ ] **Step 4: Run API and access tests**

Run: `node --test tests/collaboration-api.test.mjs tests/collaboration-access.test.mjs tests/access.test.mjs tests/definitions-leak.test.mjs`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/server.mjs tests/collaboration-api.test.mjs
git commit -m "feat: expose workspace collaboration APIs"
```

### Task 9: واجهة «مهام» المتجاوبة والدمج

**Files:**
- Create: `app/static/workspace-ui.mjs`
- Create: `app/static/workspace.css`
- Modify after Claude checkpoint: `app/static/work-ui.mjs`
- Modify after Claude checkpoint: `app/static/app.mjs`
- Modify: `app/static/index.html`
- Modify: `app/static/sw.js`
- Modify: `app/server.mjs`
- Test: `tests/workspace-ui.test.mjs`
- Test: `tests/workspace-responsive.test.mjs`

**Interfaces:**
- Produces: `workspaceUI.render(data,ui)`, `workspaceUI.form(action,id,data)`, and route `#workspace/:spaceId/:tool?`.
- Extends `#work` with `my_work` and `spaces` entry tabs while preserving the current personal board.

- [ ] **Step 1: Write all-tool and accessibility tests**

```js
test('workspace navigation contains every contracted tool without rendering all panels together',()=>{
  const html=workspaceUI.render(fixture,{e,button,date});
  for(const label of ['المهام','البطاقات','الرسائل','المحادثة','الجدول','الملفات','الأسئلة','الأشخاص','النشاط'])assert.match(html,new RegExp(label));
  assert.equal((html.match(/data-tool-panel/g)||[]).length,1);
  assert.doesNotMatch(html,/style=|<script|undefined|NaN/);
});
```

- [ ] **Step 2: Run and verify the missing UI failure**

Run: `node --test tests/workspace-ui.test.mjs tests/workspace-responsive.test.mjs`

Expected: FAIL.

- [ ] **Step 3: Implement the Apple-inspired workspace UI**

Use a large context title, compact tool bar, one active tool panel, bottom tool picker on mobile, explicit move buttons next to drag and drop, keyboard reorder controls, and reduced-motion styles. Use `app/static/icons.mjs`; do not use Apple assets.

- [ ] **Step 4: Integrate after checking Claude's checkpoint**

Record live dirty files, merge or rebase the committed Claude design work, then make the smallest imports/router changes in `app/static/app.mjs` and `work-ui.mjs`. Register `workspace.css` and `workspace-ui.mjs` in index, server assets, and service worker.

- [ ] **Step 5: Run focused and full gates**

```bash
node --test tests/collaboration-*.test.mjs tests/workspace*.test.mjs tests/search.test.mjs tests/engagement.test.mjs tests/files-security.test.mjs
npm run check
npm run gate:quick
npm test
```

Expected: all pass; verify 360, 390, 414, 768, and 1280 widths with no hidden action or horizontal overflow.

- [ ] **Step 6: Update traceability, evidence, and commit**

Update `GOV-04`, `GOV-08`, `EXP-01`, `DAT-06`, and `PLT-07` evidence without process-owner acceptance. Write `docs/testing/team-workspace-20261002/README.md`, update `STATUS.md`, then commit:

```bash
git add app/static/workspace-ui.mjs app/static/workspace.css app/static/work-ui.mjs app/static/app.mjs app/static/index.html app/static/sw.js app/server.mjs tests/workspace-ui.test.mjs tests/workspace-responsive.test.mjs docs/traceability.json docs/implementation/REQUIREMENTS.json docs/testing/team-workspace-20261002/README.md STATUS.md
git commit -m "feat: integrate the professional team workspace"
```
