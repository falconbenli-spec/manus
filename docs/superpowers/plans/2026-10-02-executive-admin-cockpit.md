# Executive and admin cockpit implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** بناء مقصورة قيادة للرئيس التنفيذي ومركز تشغيل للأدمن، بمصادر أرقام معلنة وصلاحيات منفصلة وتصميم مستلهم من Apple.

**Architecture:** يضاف سجل تعريف للمؤشرات وطبقة قراءة جديدة فوق وحدات المال والمشاريع والعملاء والأفراد والمخاطر. يبقى `/api/executive` مدخل القيادة المحمي بـ`executive.view`، ويضاف `/api/platform-health` للأدمن. واجهتا القيادة والتشغيل منفصلتان، وتشتركان فقط في مكونات العرض وحالات الصدق.

**Tech Stack:** Node.js 24.14، JavaScript ESM، SQLite STRICT، HTML مولد من وحدات `.mjs`، CSS أصلي، واختبارات `node:test`.

**Spec:** `docs/superpowers/specs/2026-10-02-omni-experience-executive-cockpit-design.md`

## Global constraints

- لا React أو TypeScript أو Tailwind أو Framer Motion، ولا اعتماديات إنتاج جديدة.
- المظهر الكلاسيكي محفوظ. التنسيق الجديد في `app/static/cockpit.css`، وتعديل `classic.css` لا يتم إلا في نقطة الدمج وبعد حفظ عمل Claude.
- لا قيمة تنفيذية بلا `status`, `source_module`, `source_link`, `as_of`, `quality_state`, `owner`, `scope`, و`period`.
- `unavailable` ليست صفرًا، و`forecast` لا تعرض كقيمة محققة.
- دور `admin` لا يمنح `executive.view`، وتصريح القيادة لا يمنح أدوات تشغيل المنصة.
- لا أسماء موظفين أو عملاء أو طلبات في ملخص القيادة. التفصيل يمر بصلاحية الوحدة الأصلية.
- كل اختبار يستخدم بيانات مصطنعة. لا اتصال خارجي ولا نشر.
- الترحيل المحجوز لهذه الخطة: `195`. إذا صار الرقم موجودًا عند بدء التنفيذ، توقف هذه الخطة قبل أي كتابة وأعد ترقيم ترحيلات الخطط الثلاث معًا.
- ملفات الالتقاء مع عمل Claude: `app/static/app.mjs`, `app/static/home-ui.mjs`, `app/static/classic.css`, `app/static/reports-ui.mjs`. لا تعدل حتى نقطة الدمج في Task 7.

## Review focus

- مؤشر بلا بيانات: يعرض `unavailable` وسبب الغياب، ويغطيه اختبار Task 2.
- أدمن بلا `executive.view`: يحصل على 403 من `/api/executive`، ويغطيه اختبار Task 3.
- قائد بلا تصريح للوحدة الأصلية: يرى التجميع ولا يرى أسماء السجلات في التفصيل، ويغطيه اختبار Task 4.
- فحص صحة يفشل أو يتأخر: يعرض `unknown` أو `failed` مع وقت الفحص، ولا يعرض نجاحًا قديمًا، ويغطيه اختبار Task 5.
- حجم شاشة 360px أو حركة مخفضة: لا تمدد ولا حركة إجبارية، ويغطيه اختبار Task 6.

---

### Task 1: قاموس المؤشرات وعقد القيمة

**Files:**
- Create: `app/migrations/195-executive-metric-definitions.sql`
- Create: `app/executive-metrics.mjs`
- Test: `tests/executive-metrics.test.mjs`

**Interfaces:**
- Produces: `metricDefinition(db, tenantId, key)`, `metricValue(definition, input)`, `listMetricDefinitions(db, tenantId)`.
- `metricValue` returns `{key,label,value,unit,period,scope,status,source_module,source_link,definition_version,as_of,sample_size,quality_state,owner,note}`.

- [ ] **Step 1: Write the migration test**

```js
test('metric definitions are versioned and cannot be rewritten after use',t=>{
  const db=fixture(t),row=db.prepare("SELECT * FROM executive_metric_definitions WHERE key='cash.overdue'").get();
  assert.equal(row.source_module,'receivables');
  db.prepare("INSERT INTO executive_metric_observations(id,tenant_id,metric_key,definition_version,status,observed_at,payload) VALUES('o1','36t',?,?,'actual',?,'{}')").run(row.key,row.version,now());
  assert.throws(()=>db.prepare('UPDATE executive_metric_definitions SET formula=? WHERE tenant_id=? AND key=? AND version=?').run('changed','36t',row.key,row.version));
});
```

- [ ] **Step 2: Run the test and verify the missing-table failure**

Run: `node --test tests/executive-metrics.test.mjs`

Expected: FAIL with `no such table: executive_metric_definitions`.

- [ ] **Step 3: Add the schema and contract**

The migration creates `executive_metric_definitions` keyed by `(tenant_id,key,version)` and an append-only `executive_metric_observations` table. Seed definitions for `cash.overdue`, `growth.weighted_pipeline`, `delivery.blocked`, `people.headcount`, `risk.red`, and `quality.unavailable`. `metricValue` rejects incomplete metadata:

```js
export function metricValue(definition,input){
  const status=input.status??'unavailable';
  if(!['actual','derived','forecast','unavailable'].includes(status))fail(500,'metric_status','حالة المؤشر غير صالحة');
  return {key:definition.key,label:definition.label,value:status==='unavailable'?null:input.value,unit:definition.unit,
    period:input.period,scope:input.scope,status,source_module:definition.source_module,source_link:input.source_link??definition.source_link,
    definition_version:definition.version,as_of:input.as_of,sample_size:input.sample_size??0,
    quality_state:input.quality_state??(status==='unavailable'?'unavailable':'measured'),owner:definition.owner,note:input.note??''};
}
```

- [ ] **Step 4: Run the focused tests**

Run: `node --test tests/executive-metrics.test.mjs`

Expected: PASS; invalid status and missing metadata tests also pass.

- [ ] **Step 5: Commit**

```bash
git add app/migrations/195-executive-metric-definitions.sql app/executive-metrics.mjs tests/executive-metrics.test.mjs
git commit -m "feat: define governed executive metrics"
```

### Task 2: مجاميع القيادة وحالات جودة البيانات

**Files:**
- Create: `app/executive-cockpit.mjs`
- Modify: `app/workspace.mjs`
- Test: `tests/executive-cockpit.test.mjs`
- Modify: `tests/workspace.test.mjs`
- Modify: `tests/executive-scope.test.mjs`

**Interfaces:**
- Consumes: `metricValue`, `listMetricDefinitions` from Task 1.
- Produces: `executiveCockpit(db, user, {from,to})` and `executiveDrilldown(db,user,key,{from,to,cursor})`.
- `workspace.executiveOverview` delegates to `executiveCockpit` and keeps the old `totals`, `by_status`, `departments`, and `portfolio` keys during migration.

- [ ] **Step 1: Write failing provider tests**

```js
test('a missing cash source is unavailable, never zero',t=>{
  const {db,chief}=fixture(t);
  db.prepare('DELETE FROM ar_claims').run();
  const board=executiveCockpit(db,chief,{from:'2026-10-01',to:'2026-10-31'});
  const cash=board.dimensions.find(x=>x.key==='cash').metrics.find(x=>x.key==='cash.overdue');
  assert.equal(cash.status,'unavailable');
  assert.equal(cash.value,null);
  assert.match(cash.note,/لا توجد عينة|غير مهيأ/);
});
```

- [ ] **Step 2: Run the test and verify `executiveCockpit` is missing**

Run: `node --test tests/executive-cockpit.test.mjs`

Expected: FAIL because `app/executive-cockpit.mjs` does not exist.

- [ ] **Step 3: Implement six providers and the narrative**

Use provider functions named `cashDimension`, `growthDimension`, `deliveryDimension`, `peopleDimension`, `riskDimension`, and `qualityDimension`. Each returns `{key,label,state,metrics,attention}`. Build `summary` from deterministic rules over those states, not from a language model. Keep tenant filters in every SQL statement.

- [ ] **Step 4: Run scope and compatibility tests**

Run: `node --test tests/executive-metrics.test.mjs tests/executive-cockpit.test.mjs tests/workspace.test.mjs tests/executive-scope.test.mjs tests/executive-timeliness.test.mjs`

Expected: PASS; the serialized aggregate contains none of the fixture secrets from `tests/executive-scope.test.mjs`.

- [ ] **Step 5: Commit**

```bash
git add app/executive-cockpit.mjs app/workspace.mjs tests/executive-cockpit.test.mjs tests/workspace.test.mjs tests/executive-scope.test.mjs
git commit -m "feat: build truthful executive cockpit read model"
```

### Task 3: مسارات القيادة والتفصيل

**Files:**
- Modify: `app/server.mjs`
- Test: `tests/executive-cockpit-api.test.mjs`
- Modify: `tests/access.test.mjs`

**Interfaces:**
- Consumes: `executiveCockpit`, `executiveDrilldown` from Task 2.
- Produces: `GET /api/executive?from&to` and `GET /api/executive/drilldown/:key?from&to&cursor`.

- [ ] **Step 1: Write route authorization tests**

```js
test('admin and executive permissions stay separate',async t=>{
  const {call,tokens}=await serverFixture(t);
  assert.equal((await call('/api/executive',{token:tokens.employee})).status,403);
  assert.equal((await call('/api/platform-health',{token:tokens.executive})).status,403);
  assert.equal((await call('/api/executive',{token:tokens.adminWithoutExecutive})).status,403);
});
```

- [ ] **Step 2: Run the route test**

Run: `node --test tests/executive-cockpit-api.test.mjs`

Expected: FAIL because the drilldown route and separated fixture do not exist.

- [ ] **Step 3: Add strict query parsing and routes**

Dates use `validation.date`; the range is at most 366 days; unknown metric keys return 404. The drilldown function checks both `executive.view` and the source module capability before returning named rows. Without source permission it returns aggregate causes and `details_withheld:true`.

- [ ] **Step 4: Run API and access tests**

Run: `node --test tests/executive-cockpit-api.test.mjs tests/access.test.mjs tests/executive-scope.test.mjs`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/server.mjs tests/executive-cockpit-api.test.mjs tests/access.test.mjs
git commit -m "feat: expose scoped executive cockpit routes"
```

### Task 4: واجهة مقصورة القيادة

**Files:**
- Create: `app/static/executive-cockpit-ui.mjs`
- Create: `app/static/cockpit.css`
- Test: `tests/executive-cockpit-ui.test.mjs`
- Test: `tests/cockpit-responsive.test.mjs`

**Interfaces:**
- Consumes: the Task 2 cockpit contract.
- Produces: `executiveCockpitUI.render(data, ui)` and `executiveCockpitUI.form(action,id,data)`.

- [ ] **Step 1: Write the renderer test**

```js
test('cockpit renders truth state and accessible drilldown controls',()=>{
  const html=executiveCockpitUI.render(fixture,{e,button});
  assert.match(html,/نبض الشركة/);
  assert.match(html,/غير مقاس/);
  assert.doesNotMatch(html,/undefined|NaN| style=|<script/);
  assert.equal((html.match(/data-action="open-metric"/g)||[]).length,fixture.actionable.length);
});
```

- [ ] **Step 2: Run UI tests and verify the module is missing**

Run: `node --test tests/executive-cockpit-ui.test.mjs tests/cockpit-responsive.test.mjs`

Expected: FAIL because the UI module and stylesheet do not exist.

- [ ] **Step 3: Implement the bento layout and progressive disclosure**

Use semantic sections and buttons. Render at most seven hero metrics and five attention items. The stylesheet uses existing tokens, `@media (prefers-reduced-motion:reduce)`, container queries or existing breakpoints, and no remote assets. The drilldown is returned through the existing dialog/drawer system.

- [ ] **Step 4: Run UI tests**

Run: `node --test tests/executive-cockpit-ui.test.mjs tests/cockpit-responsive.test.mjs tests/screen-truthfulness.test.mjs`

Expected: PASS at 360, 390, 414, 768, and 1280 widths.

- [ ] **Step 5: Commit**

```bash
git add app/static/executive-cockpit-ui.mjs app/static/cockpit.css tests/executive-cockpit-ui.test.mjs tests/cockpit-responsive.test.mjs
git commit -m "feat: add Apple-inspired executive cockpit UI"
```

### Task 5: قراءة صحة المنصة للأدمن

**Files:**
- Create: `app/platform-health.mjs`
- Test: `tests/platform-health.test.mjs`
- Modify: `app/server.mjs`

**Interfaces:**
- Produces: `platformHealth(db,user,{build,checks})` and `GET /api/platform-health`.
- Returns `{generated_at,build,database,jobs,security,access_reviews,integrations,data_quality}` with each check carrying `{state,checked_at,evidence,note}`.

- [ ] **Step 1: Write failure-state and secret-redaction tests**

```js
test('stale and failed checks are not reported healthy',t=>{
  const {db,admin}=fixture(t),data=platformHealth(db,admin,{build:{commit:'abc'},checks:{backup:null}});
  assert.equal(data.database.backup.state,'unknown');
  assert.doesNotMatch(JSON.stringify(data),/password|token|secret|DATABASE_URL/i);
});
```

- [ ] **Step 2: Run the test and verify the missing-module failure**

Run: `node --test tests/platform-health.test.mjs`

Expected: FAIL.

- [ ] **Step 3: Implement read-only health aggregation**

Read existing build fingerprint, migration level, job queue, feature flags, access reviews, AI inventory, and integration states. Do not run backup, restore, migration, or external probe from the GET request. A missing independent check is `unknown`; a recorded failure is `failed`; only current evidence is `healthy`.

- [ ] **Step 4: Run platform tests**

Run: `node --test tests/platform-health.test.mjs tests/platform-ops-jobs.test.mjs tests/platform-ops-feature-flags.test.mjs tests/platform-ops-pii.test.mjs`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/platform-health.mjs app/server.mjs tests/platform-health.test.mjs
git commit -m "feat: add read-only platform health summary"
```

### Task 6: واجهة مركز الأدمن

**Files:**
- Create: `app/static/admin-cockpit-ui.mjs`
- Modify: `app/static/cockpit.css`
- Test: `tests/admin-cockpit-ui.test.mjs`

**Interfaces:**
- Consumes: Task 5 `/api/platform-health` contract.
- Produces: `adminCockpitUI.render(data,ui)` with links to existing jobs, feature flags, access reviews, integrations, and AI governance screens.

- [ ] **Step 1: Write the renderer and link tests**

```js
test('admin cockpit links to source tools and never renders business KPIs',()=>{
  const html=adminCockpitUI.render(fixture,{e,button});
  for(const href of ['#jobs','#feature-flags','#access-reviews','#integrations','#ai-governance'])assert.match(html,new RegExp(href));
  assert.doesNotMatch(html,/رواتب|ربحية عميل|قيمة القمع/);
});
```

- [ ] **Step 2: Run the test and verify the missing-module failure**

Run: `node --test tests/admin-cockpit-ui.test.mjs`

Expected: FAIL.

- [ ] **Step 3: Implement the four admin sections**

Render service health, operations, security/access, and data/integrations. Every state includes its evidence time. Reuse `cockpit.css`, existing badges, and icon functions from `app/static/icons.mjs`.

- [ ] **Step 4: Run UI and PII tests**

Run: `node --test tests/admin-cockpit-ui.test.mjs tests/platform-ops-pii.test.mjs tests/screen-truthfulness.test.mjs`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/static/admin-cockpit-ui.mjs app/static/cockpit.css tests/admin-cockpit-ui.test.mjs
git commit -m "feat: add admin operations cockpit UI"
```

### Task 7: دمج الواجهات وتوثيق الدليل

**Files:**
- Modify after Claude checkpoint: `app/static/app.mjs`
- Modify: `app/static/index.html`
- Modify: `app/static/sw.js`
- Modify: `app/server.mjs`
- Modify: `docs/traceability.json`
- Modify: `docs/implementation/REQUIREMENTS.json`
- Create: `docs/testing/executive-admin-cockpit-20261002/README.md`
- Modify: `STATUS.md`
- Test: `tests/cockpit-integration.test.mjs`

**Interfaces:**
- Registers `executive-cockpit-ui`, `admin-cockpit-ui`, and `cockpit.css` in the asset server and app router.
- Adds navigation key `platform-health` only for the current admin capability predicate.

- [ ] **Step 1: Check the live integration boundary**

Run: `git -C /Users/abdulaziz/Documents/Codex/2026-09-09/3-6t-live status --short`

Expected: record the exact dirty files in the evidence README. If Claude is editing `app/static/app.mjs`, wait for its checkpoint or integrate its committed version before this task.

- [ ] **Step 2: Write the integration test**

```js
test('served assets and navigation agree with route capabilities',async t=>{
  const {call,tokens}=await serverFixture(t);
  assert.equal((await call('/executive-cockpit-ui.mjs')).status,200);
  assert.equal((await call('/admin-cockpit-ui.mjs')).status,200);
  assert.equal((await call('/cockpit.css')).status,200);
  assert.equal((await call('/api/platform-health',{token:tokens.employee})).status,403);
});
```

- [ ] **Step 3: Wire the assets, routes, and navigation**

Import both UI modules in `app/static/app.mjs`; render the existing `executive` route with the new module; add `platform-health` to the admin navigation. Add `<link rel="stylesheet" href="/cockpit.css">`, server asset mapping, and precache entry.

- [ ] **Step 4: Run focused and repository gates**

Run in order:

```bash
node --test tests/executive-*.test.mjs tests/platform-health.test.mjs tests/admin-cockpit-ui.test.mjs tests/cockpit-*.test.mjs
npm run check
npm run gate:quick
npm test
```

Expected: all pass with zero skipped tests introduced by this plan. Record commit, Node version, counts, duration, migration 195, and schema fingerprint.

- [ ] **Step 5: Update evidence and commit**

Update `GOV-01`, `GOV-02`, and `DAT-01..04` evidence without marking owner acceptance. Then commit:

```bash
git add app/static/app.mjs app/static/index.html app/static/sw.js app/server.mjs docs/traceability.json docs/implementation/REQUIREMENTS.json docs/testing/executive-admin-cockpit-20261002/README.md STATUS.md tests/cockpit-integration.test.mjs
git commit -m "feat: integrate executive and admin cockpits"
```
