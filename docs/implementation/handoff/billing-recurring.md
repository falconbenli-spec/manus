# تسليم `billing-recurring` — الفوترة الدورية والدفعات المقدمة والإيراد المؤجل

## 1. الملفات

أنشأت:

- `app/migrations/051-recurring-billing.sql`
- `app/billing-recurring.mjs`
- `app/static/billing-recurring-ui.mjs`
- `tests/billing-recurring.test.mjs`
- `docs/implementation/handoff/billing-recurring.md` (هذا الملف)

لم أعدّل أي ملف قائم. لم ألمس `app/access.mjs` (التصريح `billing.recurring.manage` كان محجوزًا فيه مسبقًا)، ولا `app/server.mjs`، ولا `app/static/operations.mjs`، ولا أي اختبار قائم، ولا أي هجرة غير 051.

## 2. الهجرة 051 وجداولها

| الجدول | ما فيه |
| --- | --- |
| `billing_schedules` | عميل، سجل تجاري اختياري، دورية (`monthly`/`quarterly`)، يوم الإصدار (1–28)، بنود الفاتورة، الإجمالي بالهللات، مرجع العقد، بداية ونهاية، حالة (`active`/`paused`/`ended`)، مالك، `version` |
| `billing_drafts` | مسودة فاتورة الفترة: بنود ومبلغ وحالة (`pending_review`/`issued`/`dismissed`) ورابط الفاتورة الصادرة. **بلا رقم وبلا تسلسل وبلا بصمة** |
| `billing_schedule_runs` | سجل التشغيل، مفتاحه `(schedule_id, period_start)` |
| `advance_invoices` | الدفعة المقدمة: مبلغ، مقبوض، تاريخ القبض، حالة (`recorded`/`paid`)، من سجّل ومن أكد |
| `advance_draws` | السحب: المخطط والمطبَّق وحالته (`awaiting_payment`/`ready`/`partial`/`drawn`) |
| `retainer_agreements` | اتفاق الاشتراك: الأساس (`hours` بالدقائق أو `money` بالهللات)، خيارا الترحيل، صاحب العقد ومن سجّله |
| `retainer_periods` | الفترة: ميزانية، مستهلك، مرحَّل داخلًا، مرحَّل خارجًا (يكون سالبًا عند الخصم)، حالة (`open`/`closed`) |
| `retainer_consumption` | قيود الاستهلاك، لا تُعدل ولا تُحذف |
| `retainer_alert_rules` | عتبات التنبيه بالنقاط الأساسية ومستلموها — إعداد لا ثابت في الكود |
| `retainer_alerts` | التنبيهات الواقعة، مفتاحها `(period_id, threshold_bp)` |

القواعد المفروضة في SQL لا في الكود وحده:

- `advance_draws_within_paid_insert/_update`: مجموع المسحوب لا يتجاوز الرصيد المدفوع.
- `advance_draws_within_advance` و`advance_paid_floor`: السحب المخطط لا يتجاوز الدفعة، والرصيد المدفوع لا ينزل تحت ما سُحب.
- `advance_invoices`: `CHECK(confirmed_by<>recorded_by)` — من سجّل الدفعة لا يؤكد قبضها.
- `retainer_agreements`: `CHECK(owner_id<>recorded_by)` — من سجّل الاتفاق ليس صاحبه.
- `billing_drafts_never_born_issued` و`billing_drafts_human_issue`: الجدولة لا تولّد إلا مسودة، ولا تُغلق المسودة إلا بفاتورة `status='issued'` في `tax_invoices`.
- `billing_drafts_decided_final` و`retainer_periods_closed_final` و`billing_schedules_state_only`: المحسوم لا يُعدَّل، وكل تعديل يرفع `version` واحدًا.

## 3. المسارات التي يحتاجها المنسّق في `app/server.mjs`

استيراد: `import * as billingRecurring from './billing-recurring.mjs';`

قراءة (خارج المعاملة):

| الطريقة | المسار | الدالة |
| --- | --- | --- |
| GET | `/api/billing-schedules` | `billingRecurring.schedulesBoard(db,u)` |
| GET | `/api/retainers` | `billingRecurring.retainersBoard(db,u)` |
| GET | `/api/deferred-revenue` | `billingRecurring.deferredRevenue(db,u,query.as_of)` (اختياري؛ اللوحة الأولى تتضمن الورقة أصلًا) |

كتابة (كلها **داخل المعاملة** التي يفتحها الخادم، وكلها تتحقق من `billing.recurring.manage`):

| الطريقة | المسار | الدالة ومعاملاتها | `Idempotency-Key` |
| --- | --- | --- | --- |
| POST | `/api/billing-schedules` | `createSchedule(db,u,input)` | نعم (`once`) |
| POST | `/api/billing-schedules/:id/(pause_schedule\|resume_schedule\|end_schedule)` | `scheduleAction(db,u,id,action,input)` | لا — يحمي `version` |
| POST | `/api/billing-drafts/:id/(mark_issued\|dismiss_draft)` | `draftAction(db,u,id,action,input)` | لا — `version` |
| POST | `/api/advances` | `recordAdvance(db,u,input)` | نعم |
| POST | `/api/advances/:id/confirm` | `confirmAdvance(db,u,id,input)` | لا — `version` |
| POST | `/api/advances/:id/draws` | `planDraw(db,u,id,input)` | نعم |
| POST | `/api/advance-draws/:id/apply` | `applyDraw(db,u,id,input)` | لا — `version` |
| POST | `/api/retainer-agreements` | `createAgreement(db,u,input)` | نعم |
| POST | `/api/retainer-agreements/:id/carry-rules` | `setCarryRules(db,u,id,input)` | لا — `version` |
| POST | `/api/retainer-agreements/:id/threshold` | `setThreshold(db,u,id,input)` | لا |
| POST | `/api/retainer-periods` | `openPeriod(db,u,input)` | نعم |
| POST | `/api/retainer-periods/:id/consumption` | `recordConsumption(db,u,id,input)` | نعم |
| POST | `/api/retainer-periods/:id/close` | `closePeriod(db,u,id,input)` | لا — `version` |

المعرّفات كلها `[a-f0-9-]{36}` عدا `action` المحصور في القيم أعلاه.

**مؤقّت الخادم:** `billingRecurring.runDueSchedules(db)` — تُستدعى كما تُستدعى `reportSchedules.runDueSchedules` وبجوارها في السطر نفسه من `createApp`. **لا تضعها داخل معاملة ولا خلف مسار POST:** الدالة تفتح معاملة لكل فترة بنفسها. تشغيلها مرارًا بلا أثر مضاعف، وسقفها أربع وعشرون فترة لكل جدولة في الدفعة الواحدة.

## 4. مفاتيح الوحدة في `operationModules`

ملف الواجهة: `billing-recurring-ui` (يُضاف إلى قائمة الأصول البيضاء في `app/server.mjs` بجوار `payables-ui` وأخواته).

```js
import { billingSchedulesUI, retainersUI } from './billing-recurring-ui.mjs';
// ...
'billing-schedules': billingSchedulesUI,
retainers: retainersUI,
```

مجموعة التنقّل: **المالية** (مع `invoices` و`receivables` و`payables`).

## 5. ما ينبغي أن يظهر في «بانتظار قراري»

لحامل `billing.recurring.manage` فقط:

1. **مسودات الفترات بانتظار المراجعة والإصدار:** `SELECT id FROM billing_drafts WHERE tenant_id=? AND status='pending_review'` — الإجراءان `mark_issued` و`dismiss_draft`.
2. **دفعات مقدمة بانتظار تأكيد القبض:** `SELECT id FROM advance_invoices WHERE tenant_id=? AND status='recorded' AND recorded_by<>?` — الإجراء `confirm_advance` (من سجّلها لا يراها في صندوقه).
3. **فترات مفتوحة بانتظار إقفال صاحب العقد:** فترات `status='open'` التي `retainer_agreements.owner_id` فيها هو المستخدم — الإجراء `close_period`.

لم ألمس `app/inbox.mjs`؛ الاستعلامات أعلاه جاهزة للنقل كما هي.

## 6. ما لم أبنه ولماذا، وما يحتاج قرارًا

- **ربط المسودة بالفاتورة توثيق لا أتمتة.** الجدولة لا تُنشئ `ar_claims` ولا `tax_invoices`: الاستحقاق في المنصة اليوم يقوم على مخرج مقبول، والفاتورة تُبنى من استحقاق معتمد. فمن يفوتر يصدر الفاتورة في شاشة الفواتير الضريبية (بمن هو غير من أعدها)، ثم يلصق معرفها في المسودة. **قرار المالك المطلوب:** هل تُولَّد للفوترة الدورية استحقاقات من نوع `basis='advance'` — وهو نوع يسمح به مخطط `ar_claims` أصلًا ولا ينشئه أي كود اليوم — أم يبقى الربط توثيقيًا؟ اخترت التوثيق حتى لا ألمس ترقيم الفواتير ولا مسار الاعتماد القائم.
- **تحذير ضريبي صريح:** معالجة الدفعات المقدمة في الفاتورة الإلكترونية لها متطلب خاص في مواصفة هيئة الزكاة والضريبة والجمارك. ما بنيته سجل داخلي للالتزام والسحب منه، **ولا يصلح أساسًا لأي إصدار فعلي قبل تأكيد المختص الضريبي**. النص مكتوب في الشاشة (`ZATCA_ADVANCE_WARNING`) ولا يجوز حذفه عند الدمج.
- **لا نسب ضريبية هنا.** مبالغ البنود شاملة الضريبة كما يتعامل `ar_claims` مع المبلغ، والتصنيف والنسبة يُحددان عند إعداد الفاتورة في `app/invoices.mjs`. لم أُدخل أي نسبة ولا عتبة افتراضية في الكود: عتبات التنبيه كلها إعداد يدخله صاحب العقد بمستلميه.
- **لا قيود اعتراف آلية.** `deferredRevenue` ورقة عمل للقراءة فقط: المقبوض بتاريخ قبضه المؤكد، والسحب بتاريخ تسجيله في المنصة (لا يوجد في المنصة تاريخ عمل مستقل للسحب — أُعلن هذا في نص الورقة). الاعتراف قرار يعتمده المحاسب.
- **لا إرسال خارج المنصة.** تنبيهات العتبات سجلات تظهر في الشاشة لمستلميها؛ لا بريد ولا رسائل.
- **الريال فقط.** لا تحويل عملة، اتساقًا مع `invoices.mjs`.
- **العزل:** الوصول هنا بالتصريح المالي لا بعضوية فريق الحساب (كما في `receivables`/`invoices`)، بخلاف `agency.mjs` الذي يعزل بالعضوية. إن أراد المالك حصر الفوترة الدورية بفرق الحسابات فهو تغيير سياسة لا تغيير كود كبير.
- **ما لم يُغطَّ باختبار سعيد:** مسار `mark_issued` الناجح يحتاج فاتورة صادرة فعلًا (سلسلة عميل ← عرض ← عقد ← مخرج مقبول ← استحقاق معتمد ← إصدار)، ولم أبنِ هذه التهيئة. المختبَر هو الحارس: الرفض حين لا تكون الفاتورة صادرة، والرفض على مستوى قاعدة البيانات لأي محاولة لادعاء الإصدار.
- **صنف CSS جديد:** لا شيء. الواجهة تستخدم الأصناف القائمة فقط، وتحققت من ذلك بفحص محلي لكل صنف ظهر في الخرج.

## 7. نتيجة تشغيل الاختبارات

```
$ node --test tests/billing-recurring.test.mjs
✔ a recurring schedule prepares a draft for the period and never an issued invoice, and rerunning it changes nothing (270.367833ms)
✔ an advance is a liability whose receipt a second person confirms, and drawn amounts never exceed the paid balance (282.773958ms)
✔ carry-forward and overage deduction are independent contract options that move entitlement only, never the invoice amount (280.49225ms)
✔ usage thresholds are configuration set by the contract owner, and each threshold alerts once per period (268.009917ms)
✔ recurring billing is closed to accounts without the capability and never reaches another tenant (252.568834ms)
ℹ tests 5
ℹ pass 5
ℹ fail 0
```

المثال المطلوب في التكليف يمر داخل الاختبار الثالث: ميزانية 50 ساعة واستهلاك 60 مع تفعيل خيار الخصم ⇒ `carried_out_units = -600` دقيقة، والفترة التالية تبدأ بـ`carried_in_units = -600`، ومبلغ الجدولة ومسوداتها لم يتغير.

الاختبارات القريبة من الوحدة شُغّلت بأسمائها ولم يكسرها التغيير:

```
$ node --test tests/migrations.test.mjs tests/invoices.test.mjs tests/receivables.test.mjs \
      tests/agency.test.mjs tests/commercial.test.mjs tests/access.test.mjs tests/static-modules.test.mjs
ℹ tests 41 · pass 41 · fail 0

$ node --test tests/ui-render.test.mjs tests/platform.test.mjs tests/security-regressions.test.mjs \
      tests/operations-http.test.mjs tests/traceability.test.mjs tests/finance.test.mjs
ℹ tests 38 · pass 38 · fail 0
```

لم أشغّل `npm test` كاملًا كما ينص عقد العمل المشترك.
