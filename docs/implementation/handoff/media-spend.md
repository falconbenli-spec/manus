# تسليم وحدة الصرف الإعلامي وتقرير العميل — `media-spend`

## 1. الملفات

أنشئت (ولم يُعدَّل أي ملف قائم):

- `app/migrations/073-media-spend.sql`
- `app/media-spend.mjs` — المهمة أ: المخطط مقابل الفعلي
- `app/client-reports.mjs` — المهمة ب: تقرير العميل الدوري ونسخة طباعته
- `app/static/media-spend-ui.mjs` — شاشتان: `mediaSpendUI` و`clientReportsUI`
- `tests/media-spend.test.mjs`
- `tests/client-reports.test.mjs`
- `docs/implementation/handoff/media-spend.md` (هذا الملف)

لم أعدّل `app/campaigns.mjs` ولا `app/agency.mjs` ولا `app/reports.mjs` ولا `app/print-documents.mjs` ولا `app/procurement.mjs` ولا `app/payables.mjs` ولا `app/access.mjs` ولا `app/server.mjs` ولا `app/static/operations.mjs` ولا `app/inbox.mjs` ولا أي اختبار قائم ولا أي هجرة أخرى. أستورد من وحدات قائمة دون تعديلها: `clientFor`/`memberClients` (agency)، `CHANNELS` (campaigns)، `parseCsv` (bank-reconciliation)، `purchaseFor` (procurement)، `financeCapabilities` (finance). لا استيراد دائري.

## 2. الهجرة 073 وجداولها

| الجدول | ماذا يحفظ | أهم القيود |
|---|---|---|
| `media_plans` | خطة صرف الحملة بنسخ مرقّمة ومرجع اعتماد التوزيع | `approved_by<>prepared_by` (CHECK)، نسخة معتمدة واحدة ومسودة واحدة لكل حملة (فهرسان فريدان)، مُشغّل يمنع تعديل المعتمد إلا انتقاله إلى `superseded`، ويتحقق أن الخطة لكيان الحملة وعميلها، ولا حذف |
| `media_plan_lines` | سطر لكل قناة: المدة، الميزانية المخططة بالهللات، المؤشر المستهدف وقيمته ووحدته | فريد (خطة، قناة)، يُكتب فقط والخطة مسودة، لا تعديل في مكانه، لا حذف بعد القرار |
| `media_import_profiles` | تعيين أعمدة ملف CSV لكل قناة (الفاصل، صيغة التاريخ، الترويسة، الأعمدة) | يُوقف ولا يُعاد كتابته ولا يُحذف |
| `media_spend_imports` | دفعة استيراد: اسم الملف، بصمته SHA-256، نوع المصدر ومرجعه، عدد السطور ومجموعها | `UNIQUE(tenant_id,file_digest)` يمنع استيراد الملف نفسه مرتين، الإلغاء كامل بسبب مكتوب ولا تعديل غيره |
| `media_spend_entries` | الصرف الفعلي: التاريخ، القناة (عبر السطر)، المبلغ، **نوع المصدر ومرجعه**، طريقة الإدخال، من دفع (`client_direct`/`agency_on_behalf`)، من أدخله ومتى | `evidence_kind` من ثلاثة و`evidence_reference` ≥ 5 أحرف (رقم بلا مصدر يرفضه المخطط نفسه)، يُسجّل على خطة معتمدة فقط، لا تعديل ولا حذف، التصحيح بسطر جديد `corrects_id` مرة واحدة بسبب مكتوب |
| `media_spend_commitments` | ربط سطر صرف الوكالة نيابة عن العميل بأمر شراء داخلي (`procurement_orders`) وفاتورة المورد اختياريًا | مفاتيح خارجية إلى جداول المشتريات القائمة، مُشغّل يرفض ربط صرف دفعه العميل مباشرة، لا تعديل ولا حذف |
| `media_spend_billings` | ما فُوتر للعميل من هذا الصرف: إشارة إلى استحقاق معتمد قائم في `ar_claims` بالمبلغ المنسوب | مُشغّل: الاستحقاق معتمد وبالريال ومن الكيان نفسه ولا يُنسب إليه أكثر من قيمته، لا تعديل ولا حذف |
| `media_spend_thresholds` | عتبة تنبيه بنسبة من الميزانية المخططة (نقاط أساس) وأساسها | مُشغّل: يضبطها مالك الحملة وحده، **لا قيمة افتراضية**، تُوقف ولا تُعدّل |
| `media_spend_acknowledgements` | الإقرار المكتوب ببلوغ عتبة أو بتجاوز الميزانية: المرصود والمخطط والقرار (`continue`/`reduce`/`pause_requested`) والنص | نص ≥ 20 حرفًا، إقرار واحد لكل عتبة ولتجاوز الميزانية، لا تعديل ولا حذف |
| `client_report_templates` | قالب لكل عميل: الاسم، الدورية، الأقسام | تحت عميل من الكيان نفسه، `version`، يُوقف ولا يُحذف |
| `client_reports` | لقطة التقرير (`body` JSON) وبصمتها، التعليق والخطوة التالية، الموقِّع واسمه ووقته، والتقرير الذي يصححه | `signed_by<>prepared_by` (CHECK)، لا توقيع بلا تعليق ≥ 20 حرفًا، مُشغّل يمنع تعديل الأرقام والبصمة والفترة في **أي** حالة ويمنع تعديل الموقَّع إلا انتقاله إلى `superseded`، ولا حذف |

## 3. المسارات التي يحتاجها المنسّق في `app/server.mjs`

الاستيراد:
```js
import * as mediaSpend from './media-spend.mjs';
import * as clientReports from './client-reports.mjs';
```

كل الكتابات داخل المعاملة القائمة (الدوال ترمي `transaction_required` خارجها). `:id` = `[a-f0-9-]{36}`.

| الطريقة | المسار | الدالة | `Idempotency-Key` |
|---|---|---|---|
| GET | `/api/media-spend` | `mediaSpend.mediaSpendBoard(db,u)` | — |
| POST | `/api/media-spend/plans` | `mediaSpend.prepareMediaPlan(db,u,input)` | نعم (`once`) |
| POST | `/api/media-spend/plans/:id/(edit_plan\|approve_plan\|discard_plan)` | `mediaSpend.mediaPlanAction(db,u,id,action,input)` | لا (`version`) |
| POST | `/api/media-spend/campaigns/:id/spend` | `mediaSpend.recordMediaSpend(db,u,id,input)` | نعم |
| POST | `/api/media-spend/campaigns/:id/imports` | `mediaSpend.importMediaSpend(db,u,id,input)` | نعم (والبصمة تمنع التكرار أيضًا) |
| POST | `/api/media-spend/campaigns/:id/thresholds` | `mediaSpend.setThreshold(db,u,id,input)` | نعم |
| POST | `/api/media-spend/campaigns/:id/acknowledge` | `mediaSpend.acknowledgeSpend(db,u,id,input)` | لا (فريد في المخطط) |
| POST | `/api/media-spend/campaigns/:id/billings` | `mediaSpend.recordBilling(db,u,id,input)` | نعم |
| POST | `/api/media-spend/entries/:id/correct` | `mediaSpend.correctMediaSpend(db,u,id,input)` | لا (تصحيح واحد لكل سطر) |
| POST | `/api/media-spend/entries/:id/commitment` | `mediaSpend.linkCommitment(db,u,id,input)` | لا (فريد) |
| POST | `/api/media-spend/imports/:id/cancel` | `mediaSpend.cancelMediaImport(db,u,id,input)` | لا (`version`) |
| POST | `/api/media-spend/thresholds/:id/retire` | `mediaSpend.retireThreshold(db,u,id,input)` | لا (`version`) |
| POST | `/api/media-spend/profiles` | `mediaSpend.saveMediaProfile(db,u,input)` | نعم |
| POST | `/api/media-spend/profiles/:id/deactivate` | `mediaSpend.deactivateMediaProfile(db,u,id,input)` | لا (`version`) |
| GET | `/api/client-reports` | `clientReports.clientReportsBoard(db,u)` | — |
| POST | `/api/client-reports/templates` | `clientReports.createTemplate(db,u,input)` | نعم |
| POST | `/api/client-reports/templates/:id/(edit_template\|deactivate_template)` | `clientReports.templateAction(db,u,id,action,input)` | لا (`version`) |
| POST | `/api/client-reports` | `clientReports.generateReport(db,u,input)` | نعم |
| POST | `/api/client-reports/:id/(write_commentary\|sign_report\|discard_report)` | `clientReports.reportAction(db,u,id,action,input)` | لا (`version`) |
| GET | `/api/client-reports/:id/print` | `clientReports.clientReportPrintable(clientReports.readClientReport(db,u,id))` — يُرسل `text/html; charset=utf-8` كما يفعل مسار `reports/.../print` | — |

ملاحظات للربط:
- مسار `‎/api/client-reports/templates` يجب أن يسبق نمط `‎/api/client-reports/:id/...` (النمط بـ`[a-f0-9-]{36}` لا يطابق `templates` أصلًا، لكن الترتيب يحسم).
- مسار الطباعة يُستحسن أن يسجّل `audit(db,u,'client_report',id,'client_report.printed',{}, {})` كما يسجّل مسار التقارير التصدير؛ لم أضعه داخل `readClientReport` لأنها دالة قراءة تستدعيها اللوحة أيضًا.
- كل الدوال تتحقق بنفسها من: عضوية فريق حساب العميل (`clientFor`/`memberClients`) ثم تصريح `commercial.use` بنطاق إدارة المستخدم (`can(db,u,'commercial.use',u.department_id)`). لا حاجة لحارس إضافي في الخادم.

## 4. مفاتيح الوحدة في `operationModules`

```js
import { mediaSpendUI, clientReportsUI } from './media-spend-ui.mjs';
// …
'media-spend':mediaSpendUI,'client-reports':clientReportsUI
```

- اسم الملف للقائمة البيضاء في `server.mjs`: `media-spend-ui`.
- مجموعة التنقل: مع التشغيل الإبداعي (`clients`/`campaigns`/`content`/`scope`)، مشروطة بالتصريح:
  `if(has('commercial.use'))nav.push(['media-spend','◔','الصرف الإعلامي','Media spend'],['client-reports','▤','تقارير العملاء','Client reports']);`
- لا CSS جديد. الأصناف المستخدمة كلها قائمة: `panel` `panel-body` `vn-head` `vn-card` `vn-name` `vn-code` `vn-flags` `vn-flag` `is-block` `is-warn` `vn-body` `vn-tiles` `vn-tile` `vn-block` `vn-list` `vn-alert` `table-wrap` `operation-actions` `badge` `subtle` `btn` `outline` `small` `is-late` `is-ok` `is-old`. لا `style=""` ولا `<script>` ولا مورد خارجي (اختبار في كل ملف يثبت ذلك على المخرج الفعلي).
- رابط «نسخة للطباعة / PDF» في شاشة التقارير يشير إلى `/api/client-reports/:id/print` ويفتح في لسان جديد، على نمط `reports-ui`.

## 5. ما ينبغي أن يظهر في «بانتظار قراري»

إن أُضيفت اللوحتان إلى `SOURCES` في `app/inbox.mjs`:

| الفعل | يظهر لمن | المعنى |
|---|---|---|
| `approve_plan` | عضو الفريق غير مُعِدّ الخطة | اعتماد خطة صرف (يُقرأ «اعتماد» تلقائيًا من `DECISIONS`) |
| `acknowledge_spend` | مالك الحملة ومسؤول الحساب | بلوغ عتبة أو تجاوز ميزانية بلا إقرار مكتوب (يُقرأ «إقرارك مطلوب» عبر `acknowledge`) |
| `sign_report` | مسؤول الحساب إن لم يكن هو من ولّد التقرير | **ليس في `DECISIONS` اليوم** — يحتاج سطرًا: `sign_report:'توقيع تقرير عميل'` |

بقية الأفعال (`prepare_*`, `record_*`, `import_*`, `set_*`, `retire_*`, `correct_*`, `link_*`, `cancel_*`, `edit_*`, `discard_*`, `write_commentary`, `generate_report`) عمل جارٍ لا قرار. تنبيه: `write_commentary` لا يطابقه `NOT_DECISIONS` ولا `DECISIONS` فلن يظهر، وهذا المقصود.

السطر المقترح: `['media-spend','الصرف الإعلامي',mediaSpendBoard],['client-reports','تقارير العملاء',clientReportsBoard]` — مع ملاحظة أن اللوحتين ترميان `not_permitted` لمن لا يحمل `commercial.use`؛ إن كان `inbox` لا يلتقط الأخطاء لكل مصدر فيلزم تغليفهما.

## 6. ما لم أبنه ولماذا، وما يحتاج قرارًا

1. **لا اتصال بأي منصة إعلانية.** لا API ولا OAuth ولا سحب تلقائي. الصرف يُدخل يدويًا أو يُلصق محتوى ملف CSV صدّره المستخدم بنفسه. الشاشة تقول ذلك نصًا في رأسها وفي نموذج الاستيراد.
2. **الاستيراد:** تعيين الأعمدة يُحفظ لكل قناة ويُعاد استخدامه؛ بصمة الملف تمنع تكراره؛ **وملفان مختلفان بأيام متداخلة لقناة واحدة يُرفضان** (يضاعفان الصرف دون أن تتطابق البصمة). سطور الحملات الأخرى في الملف نفسه تُتجاوز وتُعدّ ولا تُنسب. العملة غير الريال تُرفض (لا تحويل عملات). منصات الإعلان تصدّر كسورًا أطول من هللة فتُقرَّب إلى أقرب هللة، والشاشة تقول ذلك. قراءة الملف تستخدم `parseCsv` المصدَّر من `bank-reconciliation.mjs`. الاستيراد يتداخل مع إدخال يدوي لليوم نفسه **مسموح** ويُعاد في النتيجة `manual_overlap_dates` لينبّه المستخدم — القرار: هل يُمنع؟
3. **وتيرة الصرف** = الميزانية المخططة لكل قناة × (الأيام المنقضية ÷ أيام السطر)، بلا أوزان لأيام الأسبوع. هي مرجع مقارنة لا توقع، والشاشة تقول ذلك.
4. **العتبات والتجاوز:** لا نسبة في الكود ولا في المخطط. مالك الحملة يضبطها بأساسها. البلوغ أو التجاوز **لا يمنع التسجيل ولا يوقف الحملة**؛ يطلب إقرارًا مكتوبًا من مالك الحملة أو مسؤول الحساب، والإقرار نفسه لا ينفذ شيئًا («نطلب الإيقاف» يُنفَّذ من شاشة الحملات بفعل مستقل). الاختبار يثبت أن الحملة تبقى `live`.
5. **الصرف نيابة عن العميل:** لا مسار مالي موازٍ. السطر يُربط بأمر شراء داخلي قائم (ونطاق الرؤية نطاق المشتريات نفسه عبر `purchaseFor`) ولا يتجاوز مجموع المربوط قيمة الأمر. ما فُوتر للعميل **إشارة** إلى استحقاق معتمد في `ar_claims` مرتبط بسجل تجاري للعميل نفسه (`client_links`). الشاشة تعرض: الملتزم به، المربوط وغير المربوط بأمر، المفوتر، و**ما لم يُفوتر**.
   - **لم أختبر ربط استحقاق حقيقي** لأن بناء `ar_claims` يتطلب عقدًا وعرضًا وتسليمًا من مسار المبيعات؛ الاختبار يثبت الرفض لاستحقاق غير موجود وأن الفرق يظهر كاملًا بلا فوترة، والمُشغّل في المخطط يحرس الشروط. يستحق اختبارًا متكاملًا حين يتوفر مُثبِّت (fixture) للذمم.
   - **قرار مطلوب:** هل يُلزَم كل صرف `agency_on_behalf` بالربط بأمر شراء قبل أن يُعدّ؟ اليوم يُسجَّل ويظهر «بلا ربط» بمبلغه.
6. **تقرير العميل:** يُولَّد من سجلات المنصة وحدها (قيود نتائج الحملات، تقويم المحتوى المنشور، قيود الصرف السارية وخطته المعتمدة، رصيد الاشتراك وحارس النطاق). كل رقم `{label,value,type,source,as_of}`، وحارس في `buildReportBody` يوقف التوليد إن خرج رقم بلا مصدر أو تاريخ. غياب القيد يُكتب «لا قيد» لا صفرًا.
   - **لا تعليق تلقائي ولا نص من نموذج لغوي.** حقلا `commentary` و`next_step` يكتبهما مسؤول الحساب (مالك ملف العميل) ويوقّع باسمه. **مساعدة النموذج ممكنة لاحقًا كمسودة يراجعها بشر**: تُعرض اقتراحًا منفصلًا ولا تُحفظ في `commentary` إلا بعد أن يحرّرها مسؤول الحساب ويوقّع؛ يحتاج ذلك قرار المالك وتسجيل المساعد في `ai.govern`.
   - **فصل المهام:** من ولّد التقرير لا يوقّعه (في الكود وفي CHECK). النتيجة العملية: مسؤول الحساب يوقّع ما ولّده عضو آخر في الفريق؛ إن كان وحده في الفريق فعليه إضافة عضو. الشاشة تشرح ذلك عند المسودة. **قرار مطلوب:** هل يُقبل هذا القيد لحسابات فردية؟
   - الأرقام لا تُحرّر في أي حالة. التصحيح تقرير جديد من القالب نفسه يحل محل الموقَّع عند توقيعه، ويبقى الأول `superseded`.
   - **لا بوابة عميل ولا إرسال:** لا مزوّد بريد ولا رابط خارجي. التقرير يُطبع أو يُحفظ PDF من المتصفح ويرسله مسؤول الحساب بنفسه. النص في الشاشة وفي صفحة الطباعة.
   - صفحة الطباعة `clientReportPrintable` في `app/client-reports.mjs` على نمط `print-documents.mjs` (عربية، `report-print.css`، `body.doc`، تاريخ مزدوج عبر `dual`)، والمسودة تُطبع موسومة «لا يُرسل للعميل قبل توقيع مسؤول الحساب».
7. **العزل:** كل شيء يُقرأ عبر عضوية فريق حساب العميل ثم تصريح `commercial.use` بنطاق إدارة المستخدم. فريق حساب آخر يرى «غير متاح»، وحساب بلا التصريح يُمنع ولو كان في الفريق. تعيينات أعمدة الملفات على مستوى الكيان (شكل ملف المنصة ليس سرّ عميل)، لكن لا يحفظها إلا عضو في فريق حساب.
8. التواريخ بتوقيت الرياض، المبالغ بالهللات بعملة `SAR` فقط، وكل فعل كتابة يمر بـ`audit`.

## 7. نتيجة تشغيل الاختبارات

`node --test tests/media-spend.test.mjs tests/client-reports.test.mjs`:

```
✔ client report: generated from platform records only, every figure carries its source and date, and a missing record reads "no entry" not zero
✔ client report: the account manager writes and signs the commentary in their own name, the person who generated it cannot sign, and a signed report is corrected by a new one
✔ client report isolation: only the account team of that client sees its reports — another account team, another tenant and an account without the permission get nothing
✔ client report print page: Arabic, escapes every value, states that the platform sends nothing, and never labels a draft as final
✔ client reports screen: says nothing is sent from the platform, shows every figure with its source, and every offered action opens a form
✔ media plan: the person who prepares the spend plan never approves it, the plan never exceeds the client-approved budget, and an approved plan is replaced by a new revision instead of being edited
✔ actual spend: a figure without its source is refused, each entry keeps who entered it and when, a correction is a new entry, and pacing compares with an even spread over the channel days
✔ platform file import: nothing connects to an ad platform, a saved column mapping per channel is reused, the same file is never imported twice, and overlapping days are refused
✔ alerts: thresholds are set only by the campaign owner with no percentage in the code, and crossing one or the budget never blocks spend — it asks for a written acknowledgement
✔ spend on behalf of the client: it is linked to an internal purchase order in the existing procurement path, never beyond the order, and the gap between what we committed and what we billed is shown
✔ isolation: another account team, an account without the commercial permission, and another tenant see nothing of the campaign spend
✔ media spend screen: states it is not connected to any ad platform, escapes values, uses no inline style, and every offered action opens a form
ℹ tests 12
ℹ pass 12
ℹ fail 0
```

الاختبارات المجاورة — `node --test tests/migrations.test.mjs tests/campaigns.test.mjs tests/agency.test.mjs tests/payables.test.mjs tests/bank-reconciliation.test.mjs tests/procurement.test.mjs`: `tests 34 / pass 34 / fail 0`.

`node scripts/check.mjs`: `Syntax checked: 346 JavaScript modules. Source hashes match. Traceability: 220 requirements / 22 domains.`

التغطية: منع الاعتماد الذاتي للخطة ومنع توقيع مولّد التقرير (في الكود وبـCHECK) · منع تعديل الخطة المعتمدة وسطورها وقيود الصرف والتعيينات والإقرارات والتقرير الموقّع وأرقام أي تقرير (مُشغّلات) · تعارض `version` · عزل فريق الحساب وعزل الكيان · صلاحية كل دور (عضو، مالك حملة، مسؤول حساب، فريق آخر، بلا تصريح) · `verifyAudit(db)` في آخر كل اختبار.
