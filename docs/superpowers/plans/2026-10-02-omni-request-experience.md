# Omni command and request experience implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** جعل الوصول إلى الخدمة بنقرتين أو جملة واحدة، وتقديم الطلب في ثلاث خطوات مع حفظ تلقائي وتتبع وتكرار آمن.

**Architecture:** ينقل ترتيب البحث العربي إلى وحدة مشتركة يستعملها دليل الخدمات ومركز الأوامر. يعيد `/api/command-center` نتائج مصرحًا بها من الخدمات والإدارات والطلبات ومساحات العمل. يبقى الطلب في جداول workflow الحالية؛ المعالج ثلاثي الخطوات طبقة عرض فوق تعريف الحقول، والحفظ التلقائي يستعمل تعديل المسودة بإصدار متفائل.

**Tech Stack:** Node.js 24.14، JavaScript ESM، SQLite STRICT، HTML مولد، CSS أصلي، `node:test`.

**Spec:** `docs/superpowers/specs/2026-10-02-omni-experience-executive-cockpit-design.md`، الأقسام 5.1 إلى 5.6.

## Global constraints

- لا بحث سحابي ولا إرسال لعبارات المستخدم إلى مزود خارجي.
- لا تسمية البحث المحلي ذكاءً اصطناعيًا؛ هو قاموس واشتقاق خفيف ومسافة نصية.
- نتائج الأوامر تمر ببوابة النوع والنطاق قبل الاسترجاع.
- المعالج لا يسقط حقلًا ولا يغير `show_when` أو قواعد `request-intake`.
- الحفظ التلقائي على الخادم. لا تحفظ حقول الطلب الحساسة في `localStorage`.
- التكرار لا ينسخ المرفقات أو الموافقات أو القرارات أو المخرجات.
- تغيير أوزان الموسم والاستخدام المؤسسية خارج هذه الخطة حتى يصدر قرار مالك جديد.
- الترحيل المحجوز: `198` للتفضيلات وعلاقة النسخ وبيانات تصنيف الخطوات.
- نقاط الالتقاء مع Claude: `app/static/signature.mjs`, `app/static/catalog-home-ui.mjs`, `app/static/request-picker.mjs`, `app/static/home-ui.mjs`, `app/static/app.mjs`. تعدل فقط في Task 8 بعد حفظ عمله.

## Review focus

- عبارة عامية قصيرة أو بها أخطاء إملائية: تعيد خدمة صحيحة بسبب معلن، ويغطيها Task 1.
- نتيجة لطلب أو مساحة خارج الصلاحية: لا يظهر حتى العنوان، ويغطيها Task 2.
- حقل مشروط ينتقل بين الخطوات: يبقى التحقق مطابقًا للخادم، ويغطيه Task 5.
- حفظان متزامنان أو انقطاع شبكة: لا يفقد تعديلًا بصمت وتظهر حالة الفشل، ويغطيه Task 6.
- تكرار طلب قديم تغيرت خدمته أو أهليته: ينشئ مسودة على النسخة الحالية أو يرفض بسبب واضح، ويغطيه Task 7.

---

### Task 1: محرك اكتشاف عربي مشترك

**Files:**
- Create: `app/static/service-discovery.mjs`
- Modify: `app/static/catalog-search.mjs`
- Test: `tests/service-discovery.test.mjs`
- Modify: `tests/catalog-search.test.mjs`

**Interfaces:**
- Produces: `normalizeIntent(text)`, `rankService(query,entry,{synonyms,context})`, `searchServices(query,entries,options)`.
- Result: `{entry,score,reasons}` where reasons are stable keys such as `exact_name`, `synonym`, `token`, `fuzzy`, `department`, `recent`.

- [ ] **Step 1: Write colloquial and stability tests**

```js
test('colloquial Arabic finds the intended service with an explainable reason',()=>{
  const result=searchServices('أبي فلوس للسفر',entries,{synonyms});
  assert.equal(result[0].entry.code,'ADM-TRAVEL');
  assert.ok(result[0].reasons.includes('synonym'));
  assert.deepEqual(searchServices('عميل تأخر بالسداد',entries,{synonyms})[0].entry.code,'FIN-COLLECTION');
});
```

- [ ] **Step 2: Run and verify the missing-module failure**

Run: `node --test tests/service-discovery.test.mjs tests/catalog-search.test.mjs`

Expected: FAIL because the shared module does not exist.

- [ ] **Step 3: Extract one ranking implementation**

Move normalization, stopwords, light stemming, edit distance, and reason calculation into `app/static/service-discovery.mjs`. Keep it browser-safe so `app/static/catalog-search.mjs` and server modules can import the same implementation, as `app/catalog-home.mjs` already does with the catalog search module. Preserve all existing catalog-search fixtures before adding the new phrases.

- [ ] **Step 4: Run search tests**

Run: `node --test tests/service-discovery.test.mjs tests/catalog-search.test.mjs tests/catalog-golden.test.mjs tests/catalog-sweep.test.mjs`

Expected: PASS; no existing golden order changes except rows explicitly updated with a written reason.

- [ ] **Step 5: Commit**

```bash
git add app/static/service-discovery.mjs app/static/catalog-search.mjs tests/service-discovery.test.mjs tests/catalog-search.test.mjs
git commit -m "refactor: share Arabic service discovery ranking"
```

### Task 2: قراءة مركز الأوامر

**Files:**
- Create: `app/command-center.mjs`
- Test: `tests/command-center.test.mjs`

**Interfaces:**
- Consumes: `searchServices` from Task 1; collaboration search from the team-workspace plan when present.
- Produces: `commandCenter(db,user,{q,types,limit})` returning `{query,groups,recent_services,frequent_services,active_requests}`.

- [ ] **Step 1: Write access and ranking tests**

```js
test('command center omits inaccessible requests and services before ranking',t=>{
  const {db,employee,outsider}=fixture(t);
  const mine=commandCenter(db,employee,{q:'خطاب',limit:8});
  assert.ok(mine.groups.requests.some(x=>x.id==='employee-request'));
  const other=commandCenter(db,outsider,{q:'خطاب',limit:8});
  assert.ok(!JSON.stringify(other).includes('employee-request'));
});
```

- [ ] **Step 2: Run and verify missing function**

Run: `node --test tests/command-center.test.mjs`

Expected: FAIL.

- [ ] **Step 3: Implement scoped group loaders**

Use `catalog(db,user)`, `listRequests(db,user)`, `usedServices(db,user)`, navigation capability predicates, and active collaboration memberships. Recent services are the last three submitted or updated requests by this requester; frequent services are labeled personal frequency. A blank query returns only recent, frequent, and active sections.

- [ ] **Step 4: Run command and leak tests**

Run: `node --test tests/command-center.test.mjs tests/definitions-leak.test.mjs tests/search.test.mjs tests/request-launcher-scope.test.mjs`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/command-center.mjs tests/command-center.test.mjs
git commit -m "feat: add scoped command center read model"
```

### Task 3: التفضيلات والمفضلة وعلاقة تكرار الطلب

**Files:**
- Create: `app/migrations/198-command-preferences-and-request-copy.sql`
- Create: `app/command-preferences.mjs`
- Test: `tests/command-preferences.test.mjs`

**Interfaces:**
- Produces: `listPins`, `pinItem`, `unpinItem`, `reorderPins` for `service` and `department`.
- Adds nullable `requests.copied_from_request_id` with same-tenant trigger.
- Adds `service_directory.form_steps` JSON with values `need`, `evidence`, `review` per field key.

- [ ] **Step 1: Write tenant, stale-pin, and cycle tests**

```js
test('a stale pin grants no access and request copy links cannot cycle',t=>{
  const {db,employee}=fixture(t);
  tx(db,()=>pinItem(db,employee,{kind:'service',key:'HR-LETTER'}));
  hideService(db,'36t','HR-LETTER');
  assert.deepEqual(listPins(db,employee).services,[]);
  assert.throws(()=>db.prepare("UPDATE requests SET copied_from_request_id=id WHERE id='r1'").run());
});
```

- [ ] **Step 2: Run and verify migration is absent**

Run: `node --test tests/command-preferences.test.mjs`

Expected: FAIL.

- [ ] **Step 3: Add schema and preference service**

Create `catalog_pins(tenant_id,user_id,item_kind,item_key,position,created_at)` with unique keys and tenant FK. `listPins` joins current catalog visibility; hidden or removed items are omitted. `reorderPins` requires the complete visible pinned set once each and runs in a transaction.

- [ ] **Step 4: Run preference and migration tests**

Run: `node --test tests/command-preferences.test.mjs tests/catalog-home.test.mjs tests/migrations.test.mjs`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/migrations/198-command-preferences-and-request-copy.sql app/command-preferences.mjs tests/command-preferences.test.mjs
git commit -m "feat: add service pins and request copy lineage"
```

### Task 4: API مركز الأوامر والتفضيلات

**Files:**
- Modify: `app/server.mjs`
- Test: `tests/command-center-api.test.mjs`

**Interfaces:**
- Produces: `GET /api/command-center?q=&types=&limit=`, `GET /api/catalog-pins`, `POST /api/catalog-pins`, `POST /api/catalog-pins/reorder`, `POST /api/catalog-pins/:kind/:key/remove`.

- [ ] **Step 1: Write query limits and idempotency tests**

```js
test('command query is bounded and pin creation is idempotent',async t=>{
  const {call,token,csrf}=await serverFixture(t);
  assert.equal((await call('/api/command-center?q='+encodeURIComponent('x'.repeat(201)),{token})).status,400);
  const opts={method:'POST',token,headers:{'x-csrf-token':csrf,'idempotency-key':'pin-1'},body:{kind:'service',key:'HR-LETTER'}};
  const a=await call('/api/catalog-pins',opts),b=await call('/api/catalog-pins',opts);
  assert.equal(a.body.key,b.body.key);
});
```

- [ ] **Step 2: Run and verify the routes are missing**

Run: `node --test tests/command-center-api.test.mjs`

Expected: FAIL.

- [ ] **Step 3: Add validated routes**

Cap query at 200 characters and limit at 20. Parse types from a fixed set. Wrap writes in `transaction` and `once`. Return 404 for a pin outside current visibility instead of confirming that the hidden key exists.

- [ ] **Step 4: Run API and access tests**

Run: `node --test tests/command-center-api.test.mjs tests/access.test.mjs tests/definitions-leak.test.mjs`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/server.mjs tests/command-center-api.test.mjs
git commit -m "feat: expose command center and pin APIs"
```

### Task 5: معالج الطلب ثلاثي الخطوات

**Files:**
- Create: `app/request-wizard.mjs`
- Create: `app/static/request-wizard-ui.mjs`
- Test: `tests/request-wizard.test.mjs`
- Test: `tests/request-wizard-ui.test.mjs`

**Interfaces:**
- Produces: `wizardDefinition(service,directory)`, `wizardState(definition,payload,currentStep)`, `requestWizardUI.render(data,ui)`.
- Steps: `need`, `evidence`, `review`.

- [ ] **Step 1: Write field-coverage and conditional-field tests**

```js
test('every service field appears exactly once and conditional fields keep their rule',()=>{
  for(const service of services){
    const wizard=wizardDefinition(service,directoryFor(service.code));
    const keys=wizard.steps.flatMap(step=>step.fields.map(field=>field.key));
    assert.deepEqual(keys.sort(),JSON.parse(service.fields).map(x=>x.key).sort());
    assert.equal(new Set(keys).size,keys.length);
    for(const field of wizard.steps.flatMap(x=>x.fields))assert.deepEqual(field.show_when,JSON.parse(service.fields).find(x=>x.key===field.key).show_when);
  }
});
```

- [ ] **Step 2: Run and verify modules are missing**

Run: `node --test tests/request-wizard.test.mjs tests/request-wizard-ui.test.mjs`

Expected: FAIL.

- [ ] **Step 3: Implement step assignment and review contract**

Explicit `form_steps` wins. Unclassified fields use deterministic defaults: primary text/number/date/select in `need`, fields whose key/label indicates evidence/attachment/justification in `evidence`, and no editable field in `review`. Review calls the existing `request-intake` preflight and shows approval target and SLA as expected, with adoption note.

- [ ] **Step 4: Run wizard and request-condition tests**

Run: `node --test tests/request-wizard.test.mjs tests/request-wizard-ui.test.mjs tests/request-variant-conditions.test.mjs tests/request-intake.test.mjs`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/request-wizard.mjs app/static/request-wizard-ui.mjs tests/request-wizard.test.mjs tests/request-wizard-ui.test.mjs
git commit -m "feat: add three-step request wizard"
```

### Task 6: الحفظ التلقائي واستعادة المسودة

**Files:**
- Modify: `app/workflow.mjs`
- Create: `app/static/draft-autosave.mjs`
- Modify: `app/server.mjs`
- Test: `tests/request-autosave.test.mjs`
- Modify: `tests/request-unsaved-guard.test.mjs`

**Interfaces:**
- Produces: `saveDraft(db,user,requestId,{version,title,payload})`, `latestDraft(db,user)`, and browser `createDraftAutosave({save,delayMs,onState})`.
- API: `PATCH /api/requests/:id/draft` and `GET /api/requests/latest-draft`.

- [ ] **Step 1: Write conflict, ownership, and retry tests**

```js
test('stale autosave never overwrites a newer draft',t=>{
  const {db,employee,draft}=fixture(t);
  const first=tx(db,()=>saveDraft(db,employee,draft.id,{version:draft.version,title:'الأول',payload:draft.payload}));
  assert.throws(()=>tx(db,()=>saveDraft(db,employee,draft.id,{version:draft.version,title:'قديم',payload:draft.payload})),code('version_conflict'));
  assert.equal(getRequest(db,employee,draft.id).title,'الأول');
  assert.equal(first.version,draft.version+1);
});
```

- [ ] **Step 2: Run and verify missing autosave functions**

Run: `node --test tests/request-autosave.test.mjs tests/request-unsaved-guard.test.mjs`

Expected: FAIL.

- [ ] **Step 3: Implement debounced server drafts**

`saveDraft` delegates to the same payload validation as `editRequest`, restricts status to `draft/returned`, and audits a coalesced `draft.autosaved` event no more than once per five minutes while retaining the final content version. The browser controller has `idle/saving/saved/error/conflict` states, cancels stale requests, and never writes payload fields to local storage.

- [ ] **Step 4: Run autosave and workflow tests**

Run: `node --test tests/request-autosave.test.mjs tests/request-unsaved-guard.test.mjs tests/request-quality.test.mjs tests/request-intake.test.mjs`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/workflow.mjs app/static/draft-autosave.mjs app/server.mjs tests/request-autosave.test.mjs tests/request-unsaved-guard.test.mjs
git commit -m "feat: autosave request drafts with conflict protection"
```

### Task 7: تكرار الطلب والتتبع الموحد

**Files:**
- Create: `app/request-copy.mjs`
- Modify: `app/my-requests.mjs`
- Modify: `app/static/my-requests-ui.mjs`
- Modify: `app/server.mjs`
- Test: `tests/request-copy.test.mjs`
- Modify: `tests/request-timeline.test.mjs`

**Interfaces:**
- Produces: `copyRequestToDraft(db,user,requestId,{reason})` and `POST /api/requests/:id/copy`.
- Extends request cards with `next_step`, `timeline`, `can_copy`, and `copy_note`.

- [ ] **Step 1: Write non-copy and current-service tests**

```js
test('copy creates a clean draft on the current service version',t=>{
  const {db,employee,completed}=fixture(t);
  const copy=tx(db,()=>copyRequestToDraft(db,employee,completed.id,{reason:'طلب دوري مصطنع'}));
  assert.equal(copy.status,'draft');
  assert.equal(copy.copied_from_request_id,completed.id);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM attachments WHERE request_id=?').get(copy.id).n,0);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM approval_steps WHERE request_id=?').get(copy.id).n,0);
});
```

- [ ] **Step 2: Run and verify missing copy service**

Run: `node --test tests/request-copy.test.mjs tests/request-timeline.test.mjs`

Expected: FAIL.

- [ ] **Step 3: Implement safe copy and unified cards**

Resolve the latest visible service by code, map only field keys still present, discard hidden or invalid values, run eligibility and intake validation, and return advisory items for fields the user must complete. Never copy project ID unless the user still has project access. Cards use `request-timeline.mjs` for the next step instead of recalculating it.

- [ ] **Step 4: Run request regressions**

Run: `node --test tests/request-copy.test.mjs tests/request-timeline.test.mjs tests/request-transparency-ui.test.mjs tests/request-closure.test.mjs tests/home.test.mjs`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/request-copy.mjs app/my-requests.mjs app/static/my-requests-ui.mjs app/server.mjs tests/request-copy.test.mjs tests/request-timeline.test.mjs
git commit -m "feat: add safe recurring request copies"
```

### Task 8: واجهة مركز الأوامر ودمج رحلة الطلب

**Files:**
- Create: `app/static/command-center-ui.mjs`
- Create: `app/static/omni.css`
- Modify after Claude checkpoint: `app/static/signature.mjs`
- Modify after Claude checkpoint: `app/static/request-picker.mjs`
- Modify after Claude checkpoint: `app/static/catalog-home-ui.mjs`
- Modify after Claude checkpoint: `app/static/home-ui.mjs`
- Modify after Claude checkpoint: `app/static/app.mjs`
- Modify: `app/static/index.html`
- Modify: `app/static/sw.js`
- Modify: `app/server.mjs`
- Test: `tests/command-center-ui.test.mjs`
- Test: `tests/omni-responsive.test.mjs`

**Interfaces:**
- Produces: `mountCommandCenter({api,navigate,openService})` and routes service selection to the new request wizard without leaving the current page.

- [ ] **Step 1: Write keyboard, empty-state, and mobile tests**

```js
test('Cmd/Ctrl+K opens one dialog and exposes recent, frequent, and active sections',async()=>{
  const ui=fixtureDom();mountCommandCenter(ui.deps);
  ui.keydown({key:'k',metaKey:true});
  assert.equal(ui.document.querySelectorAll('[role=dialog][data-command-center]').length,1);
  for(const text of ['استخدمتها مؤخرًا','خدماتك المتكررة','طلباتك النشطة'])assert.match(ui.document.body.textContent,new RegExp(text));
});
```

- [ ] **Step 2: Run and verify missing UI**

Run: `node --test tests/command-center-ui.test.mjs tests/omni-responsive.test.mjs`

Expected: FAIL.

- [ ] **Step 3: Implement the command surface and wizard handoff**

Use one accessible dialog with focus trap, Escape close, arrow navigation, Enter selection, and request cancellation while typing. On service selection, close the command center and open the three-step drawer. Render reasons in plain Arabic such as «مطابقة اسم» or «من كلماتك المعتادة», without displaying raw scores.

- [ ] **Step 4: Integrate after Claude checkpoint**

Record the live dirty-file set. Rebase or merge Claude's committed design, then replace only the existing palette mount and request composer entry points. Keep catalog cards and home quick actions as alternate entry points to the same wizard.

- [ ] **Step 5: Run focused, performance, and full gates**

```bash
node --test tests/service-discovery.test.mjs tests/command-*.test.mjs tests/request-wizard*.test.mjs tests/request-autosave.test.mjs tests/request-copy.test.mjs tests/catalog-*.test.mjs
npm run check
npm run gate:quick
npm test
```

Expected: all pass. Measure command-center open under 100ms P95 after data load and first local result under 150ms P95. Test 360, 390, 414, 768, and 1280 widths.

- [ ] **Step 6: Update evidence and commit**

Write `docs/testing/omni-request-experience-20261002/README.md`; update traceability for the touched acceptance criteria without owner acceptance; update `STATUS.md`; commit:

```bash
git add app/static/command-center-ui.mjs app/static/omni.css app/static/signature.mjs app/static/request-picker.mjs app/static/catalog-home-ui.mjs app/static/home-ui.mjs app/static/app.mjs app/static/index.html app/static/sw.js app/server.mjs tests/command-center-ui.test.mjs tests/omni-responsive.test.mjs docs/testing/omni-request-experience-20261002/README.md docs/traceability.json docs/implementation/REQUIREMENTS.json STATUS.md
git commit -m "feat: integrate omni command and request journey"
```
