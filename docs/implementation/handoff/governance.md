# تسليم وكيل `governance` — سجلات الأهداف والمخاطر والقرارات

## 1. الملفات

أنشأتُ هذه الملفات فقط، ولم أعدّل أي ملف قائم ولا أي اختبار قائم:

| الملف | المحتوى |
| --- | --- |
| `app/migrations/055-governance-registers.sql` | 14 جدولًا وقيودها ومحفزاتها |
| `app/governance.mjs` | وحدة الخلفية: ثلاث لوحات وأفعالها |
| `app/reports-governance.mjs` | تعريفات R02 وR03 وR05 مصدَّرة في `GOVERNANCE_REPORTS` |
| `app/static/governance-ui.mjs` | ثلاث واجهات: `objectivesUI` و`risksUI` و`decisionsUI` |
| `tests/governance.test.mjs` | 7 اختبارات بـ`node:test` |
| `docs/implementation/handoff/governance.md` | هذا الملف |

لم ألمس `app/access.mjs` ولا `app/reports.mjs` ولا `app/reports-more.mjs` ولا `app/inbox.mjs` ولا `app/server.mjs` ولا `app/static/operations.mjs`.

## 2. الهجرة 055 وجداولها

كل الجداول `STRICT`، وكل جدول قابل للتعديل يحمل `version` ومحفزًا يرفض أي تحديث لا يزيدها واحدًا، ومحفز `..._no_delete`.

### أ. الأهداف

| الجدول | الغرض | أبرز ما يفرضه SQL |
| --- | --- | --- |
| `governance_objectives` | هدف لكل إدارة بمالك وفترة | `period_to>period_from` · `UNIQUE(tenant_id,department_id,period_from,title)` · `..._frozen` يرفض تعديل المقفل · الإقفال بلا خلاصة مرفوض |
| `governance_initiatives` | مبادرات الهدف بمالك وموعد وميزانية | `approved_by<>proposed_by` (**من يعتمدها ليس من اقترحها**) · `..._initial` يفرض الميلاد `proposed` بلا معتمد تحت هدف **قائم** من الكيان نفسه · `..._path` يفرض المسار مقترحة ← معتمدة ← جارية ← منجزة/متوقفة/ملغاة · `..._frozen` يجمّد العنوان والموعد والمالك والميزانية بعد الاعتماد ويجمّد كل شيء في الحالات النهائية |
| `governance_indicators` | خط أساس ومستهدف ووحدة ومصدر قياس مكتوب | `measurement_source` عشرة أحرف فأكثر · `..._frozen` يرفض تعديل مؤشر يحمل قياسات |
| `governance_measurements` | القياسات | `..._immutable` و`..._no_delete`: **القياس لا يُعدَّل ولا يُحذف**، والتصحيح صف جديد بـ`corrects_id` وسبب · `..._correction` يمنع تصحيح قياس مصحَّح أصلًا أو من مؤشر آخر |

الميزانية: `budget_minor` هللات صحيحة اختيارية، و`budget_id` ارتباط اختياري بـ`project_budgets` نشط من الكيان نفسه (يتحقق منه المحفز).

### ب. المخاطر

| الجدول | الغرض | أبرز ما يفرضه SQL |
| --- | --- | --- |
| `governance_risk_levels` | **مقياس الاحتمال والأثر كما يعرّفه صاحب الإجراء** | `UNIQUE(tenant_id,kind,value)` · `..._immutable` يمنع تعديل درجة في مكانها · `..._in_use` يمنع سحب درجة مستعملة في خطر مسجل |
| `governance_risk_bands` | نطاقات الدرجة باسمها ومداها (اختيارية) | `max_score>=min_score` · `UNIQUE(tenant_id,label)` و`UNIQUE(tenant_id,min_score)` |
| `governance_risks` | الخطر بوصفه ومالكه وفئته واستجابته وضوابطه وخطته ومراجعته التالية | `..._initial`/`..._updated` يرفضان قيمة احتمال أو أثر **خارج المقياس الذي عرّفه الكيان** · استجابة غير القبول تلزمها خطة بمالك · `..._accept` يرفض كتابة `response='accept'` بلا اعتماد مسجل لمالك الخطر الحالي · `..._link_*` يتحقق من أن المبادرة أو المشروع أو الالتزام المرتبط من الكيان نفسه |
| `governance_risk_acceptances` | من قبِل الخطر ولماذا | `accepted_by<>owner_id` · `..._above` يرفض الاعتماد إلا ممن هو **أعلى من المالك في سلسلة `manager_id`** (عبر `WITH RECURSIVE` داخل المحفز) · `..._immutable` و`..._no_delete` |
| `governance_risk_reviews` | المراجعة الدورية بتقديرها وموعد التالية | `..._immutable` و`..._no_delete` |

`response` خمس قيم: `avoid` `reduce` `transfer` `accept_proposed` `accept`. **`accept_proposed` قبول مقترح لا نافذ**، ولا يتحول إلى `accept` إلا بفعل `accept_risk` الذي يكتب صف الاعتماد أولًا.

### ج. القرارات

| الجدول | الغرض | أبرز ما يفرضه SQL |
| --- | --- | --- |
| `governance_decisions` | العنوان والسياق والبدائل والقرار ومن اتخذه ومتى وأثره ومرجعه | `..._immutable` يرفض **أي** `UPDATE` بلا شرط، و`..._no_delete` يرفض الحذف: **القرار المسجّل لا يُعدَّل إطلاقًا** · `..._links` يتحقق من أن القرار المعدول عنه والمحضر من الكيان نفسه وأن القرار لا يعدل عن نفسه · العدول بلا سبب مرفوض |
| `governance_minutes` | محضر بحاضرين وبنود | `approved_by<>prepared_by` · `..._initial` يفرض الميلاد مسودة · `..._frozen` يرفض تعديل المعتمد |
| `governance_minute_attendees` / `governance_minute_items` | الحاضرون والبنود | `..._sealed_insert` و`..._sealed_delete` يرفضان أي إضافة أو حذف بعد اعتماد المحضر · `..._no_update` (تُكتب كمجموعة أثناء المسودة) |
| `governance_commitments` | بنود العمل الناشئة عن قرار أو محضر | `decision_id IS NOT NULL OR minute_id IS NOT NULL` (**لا التزام بلا مصدر**) · الإغلاق أو الإلغاء بلا دليل مرفوض · `..._frozen` يرفض إعادة فتح المغلق أو إعادة كتابته |

## 3. المسارات التي يحتاجها المنسّق في `app/server.mjs`

الاستيراد: `import * as governance from './governance.mjs';`

قراءة (خارج المعاملة، على نمط `/api/compliance`):

| الطريقة | المسار | الاستدعاء |
| --- | --- | --- |
| GET | `/api/governance/objectives` | `governance.objectivesBoard(db,u)` |
| GET | `/api/governance/risks` | `governance.risksBoard(db,u)` |
| GET | `/api/governance/decisions` | `governance.decisionsBoard(db,u)` |

كتابة — **كلها داخل معاملة** (كل دالة تبدأ بـ`if(!db.isTransaction)fail(500,'transaction_required',…)`):

| الطريقة | المسار | الاستدعاء | `Idempotency-Key` |
| --- | --- | --- | --- |
| POST | `/api/governance/objectives` | `governance.createObjective(db,u,input)` → `{id}` | نعم |
| POST | `/api/governance/objectives/:id/(edit_objective\|close_objective)` | `governance.objectiveAction(db,u,id,action,input)` | لا |
| POST | `/api/governance/initiatives` | `governance.createInitiative(db,u,input)` → `{id}` | نعم |
| POST | `/api/governance/initiatives/:id/(edit_initiative\|approve_initiative\|start_initiative\|complete_initiative\|stop_initiative\|cancel_initiative)` | `governance.initiativeAction(db,u,id,action,input)` | لا |
| POST | `/api/governance/indicators` | `governance.createIndicator(db,u,input)` → `{id}` | نعم |
| POST | `/api/governance/indicators/:id/record_measurement` | `governance.recordMeasurement(db,u,id,input)` → `{id}` — **التوقيع `(db,u,indicatorId,input)` بلا وسيط `action`** | لا |
| POST | `/api/governance/risk-scale` | `governance.saveRiskScale(db,u,input)` → `{id:tenant_id}` — استبدال كامل للمقياس، متكرر بطبيعته | لا |
| POST | `/api/governance/risks` | `governance.createRisk(db,u,input)` → `{id}` | نعم |
| POST | `/api/governance/risks/:id/(edit_risk\|review_risk\|accept_risk\|close_risk)` | `governance.riskAction(db,u,id,action,input)` | لا |
| POST | `/api/governance/decisions` | `governance.recordDecision(db,u,input)` → `{id}` | نعم |
| POST | `/api/governance/minutes` | `governance.createMinute(db,u,input)` → `{id}` | نعم |
| POST | `/api/governance/minutes/:id/(edit_minute\|approve_minute)` | `governance.minuteAction(db,u,id,action,input)` | لا |
| POST | `/api/governance/commitments` | `governance.createCommitment(db,u,input)` → `{id}` | نعم |
| POST | `/api/governance/commitments/:id/(record_execution\|cancel_commitment)` | `governance.commitmentAction(db,u,id,action,input)` | لا |

كل المعرّفات `randomUUID`، فتصلح معها صيغة `([a-f0-9-]{36})` المتبعة في الملف.

## 4. الواجهة

- الملف الثابت للقائمة البيضاء في `app/server.mjs` السطر 73: **`governance-ui`**.
- مفاتيح `operationModules` في `app/static/operations.mjs`:

```js
import { objectivesUI, risksUI, decisionsUI } from './governance-ui.mjs';
// … objectives:objectivesUI, risks:risksUI, decisions:decisionsUI
```

- مجموعة التنقّل: **القيادة** (مع `compliance` و`executive` و`reports`).
- الواجهة لا تضيف أي صنف CSS جديد: تستعمل `panel` `panel-head` `panel-body` `vn-head` `vn-board` `vn-tiles` `vn-tile` `vn-block` `vn-list` `vn-alert` `operation-actions` `badge` `subtle` `btn` `outline` `small` `is-late` `is-due` `is-ok` `is-old` فقط. لا `style=""` ولا `<script>` ولا مورد خارجي، والاستيراد الوحيد `./dates.mjs`.
- بعد إضافة الملف إلى القائمة البيضاء سيشمله `tests/static-modules.test.mjs` و`tests/ui-render.test.mjs` تلقائيًا؛ شغّلتُ ما يعادلهما داخل اختباري ونجح.

## 5. التقارير

`app/reports-governance.mjs` يصدّر `GOVERNANCE_REPORTS` بثلاثة تقارير بالبنية نفسها المتبعة في `app/reports-more.mjs` (`key` `group` `title` `definition` `source` `allowed` `run`). **المنسّق هو من يضمها إلى `REPORTS`** في `app/reports.mjs` كما تُضم `MORE_REPORTS`:

```js
import { GOVERNANCE_REPORTS } from './reports-governance.mjs';
REPORTS.push(...MORE_REPORTS,...GOVERNANCE_REPORTS);REPORTS.sort(…);
```

| الرمز | العنوان | من يفتحه |
| --- | --- | --- |
| R02 | الأهداف والمبادرات | `executive.view` أو `governance.objectives.manage` |
| R03 | محفظة المشاريع والمخاطر | `executive.view` أو `governance.risks.manage` أو `governance.objectives.manage` |
| R05 | قرارات الإدارة ومتابعة أثرها | `executive.view` أو `governance.decisions.record` |

الثلاثة في مجموعة «الإدارة العليا»، وصفوفها تطابق أعمدتها، وأعمدة `number`/`money` أرقام أو `null`، فتمر بشروط `tests/reports-library.test.mjs` عند الضم (تحققت منها بالشروط نفسها داخل اختباري).

## 6. صندوق «بانتظار قراري»

كل لوحة تعيد مصفوفة `inbox` جاهزة على نمط `complianceBoard`. الإضافة المطلوبة في `app/inbox.mjs` (مصفوفة `SOURCES`):

```js
['objectives','الأهداف والمبادرات',(db,u)=>({initiatives:objectivesBoard(db,u).inbox})],
['risks','سجل المخاطر',(db,u)=>({risks:risksBoard(db,u).inbox})],
['decisions','القرارات والالتزامات',(db,u)=>({items:decisionsBoard(db,u).inbox})],
```

الأفعال التي تظهر فيه، وكلها موجودة أصلًا في خريطة `DECISIONS` داخل `inbox.mjs` فلا تحتاج تعديلها:

| الفعل | متى يظهر | التسمية الحالية |
| --- | --- | --- |
| `approve_initiative` | مبادرة مقترحة لحامل التصريح الذي لم يقترحها | اعتماد |
| `review_risk` | خطر تجاوز تاريخ مراجعته، لمالكه أو مالك معالجته أو حامل التصريح | مراجعة |
| `accept_risk` | خطر استجابته «قبول مقترح»، لمن هو أعلى من مالكه فقط | اعتماد |
| `approve_minute` | محضر مسودة لحامل التصريح الذي لم يعدّه | اعتماد |
| `record_execution` | التزام مفتوح فات موعده، لمالكه | توثيق التنفيذ |

الأفعال الأخرى (`edit_*` `start_*` `complete_*` `stop_*` `cancel_*` `add_*` `close_*` `record_measurement`) تسقط من الصندوق بقواعد `NOT_DECISIONS` القائمة، وهذا مقصود: عمل جارٍ لا قرار منتظر.

## 7. ما لم أبنه ولماذا

1. **لا نسبة إنجاز للمبادرة.** لا في الشاشة ولا في R02. المنصة تعرض القياس المسجَّل مقابل المستهدف والفجوة العددية بالوحدة نفسها فقط. نسبة مشتقة من عدد المهام رقم مخترع.
2. **لا مقياس مخاطر افتراضي ولا مصفوفة جاهزة.** لا يُسجَّل خطر قبل أن يعرّف صاحب الإجراء درجات الاحتمال والأثر بنفسه؛ الدرجة = الاحتمال × الأثر بقيمه هو، ونطاقات الدرجة اختيارية وبأسمائه. **يحتاج قرار مالك إجراء المخاطر:** ما درجات مقياسه وما نطاقاته.
3. **قبول الخطر يلزمه من هو أعلى من المالك في `users.manager_id`.** الخطر الذي مالكه بلا مدير مسجَّل في الهيكل **لا يمكن اعتماد قبوله**، وتقول الشاشة ذلك صراحة وتطلب تسجيل المدير المباشر أولًا. لم أخترع بديلًا (مثل السماح للأدمن)، لأن امتياز إدارة المنصة ليس علوًّا إداريًا.
4. **لا قياس لأثر القرار.** «الأثر» في R05 نصٌّ كتبه متخذ القرار وقتها، ومتابعة الأثر هي متابعة الالتزامات الناشئة فقط. ربط القرار بأرقام مالية أو تشغيلية لاحقة غير مبني ويحتاج قرار المالك.
5. **المشاريع في R03 بلا مراحل ولا خط أساس زمني**، لأن `projects` في المنصة لا يحمل موعدًا ولا حالة صحة. عمودا «الحالة» و«الموعد» فارغان للمشاريع، والتقرير يقول ذلك في ملاحظاته. إضافة المراحل وخط الأساس تخص وحدة المشاريع لا هذه الوحدة.
6. **المخاطر المرتبطة بالتزام نظامي لا تظهر كصفوف في R03** (صفوفه مشاريع ومبادرات)، وعددها مذكور في ملاحظات التقرير.
7. **الميزانية في المبادرة رقم مخطط**، وارتباطها بـ`project_budgets` ارتباط مرجعي فقط: لا تحجز مخصصًا ولا تلتزم به ولا تُطابَق مع الدفتر المالي. الشاشة تقول ذلك.
8. **المؤشر لا يُعدَّل بعد أول قياس** (خط أساس أو مستهدف أو وحدة)، فلم أُتِح فعل تعديل له أصلًا. تصحيح التعريف يكون بمؤشر جديد.
9. **لا جدولة تلقائية للمراجعة الدورية**: التاريخ التالي يكتبه المراجع في كل مراجعة. لا دورية محسوبة ولا تذكير خارج المنصة.
10. **لم أضف بيانات تجريبية** (`scripts/seed-*-demo.mjs`)؛ الاختبار يبني بياناته بنفسه وكلها مصطنعة.

## 8. نتيجة تشغيل اختباراتي

```
$ node --test tests/governance.test.mjs
✔ objectives: an initiative is approved by someone other than its proposer and never reports an invented completion percentage
✔ objectives: an owner without the register capability sees only their own objectives, and other tenants see none
✔ risks: the scale is defined by the procedure owner, an accepted risk needs approval from above its owner, and an overdue review reaches the inbox
✔ risks: a risk owned by someone with nobody above them cannot have its acceptance approved, and the board says so
✔ decisions: a recorded decision is never edited, an approved minute is sealed, and a commitment closes only with evidence
✔ governance screens render for every role and every button they offer opens a usable form
✔ governance reports: R02, R03 and R05 open for the roles that may read them and publish rows that match their columns
ℹ tests 7   ℹ pass 7   ℹ fail 0
```

الاختبارات القريبة، شُغّلت بالاسم بعد التغيير وكلها ناجحة (34 اختبارًا ثم 21 اختبارًا):

```
$ node --test tests/migrations.test.mjs tests/static-modules.test.mjs tests/ui-render.test.mjs \
    tests/reports-library.test.mjs tests/reports.test.mjs tests/access.test.mjs \
    tests/inbox.test.mjs tests/compliance.test.mjs tests/platform.test.mjs
ℹ tests 34   ℹ pass 34   ℹ fail 0

$ node --test tests/security-regressions.test.mjs tests/traceability.test.mjs \
    tests/departments.test.mjs tests/service-catalog.test.mjs tests/company-scale.test.mjs
ℹ tests 21   ℹ pass 21   ℹ fail 0

$ npm run check
Syntax checked: 288 JavaScript modules. Source hashes match. Traceability: 220 requirements / 22 domains.
```

لم أشغّل `npm test` كاملًا لأن وكلاء آخرين يعملون على المستودع الآن.
