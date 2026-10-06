# تسليم وحدة `cash-close` — التنبؤ النقدي وقائمة الإقفال وإطفاء المدفوعات المقدمة

## 1. الملفات

أنشأت (ولم أعدّل أي ملف قائم):

- `app/migrations/052-cash-and-close.sql` — هجرتي المحجوزة.
- `app/cash-forecast.mjs` — التنبؤ النقدي المتجدد (مهمة أ).
- `app/close-checklist.mjs` — قائمة الإقفال الشهري وقفل الفترة (مهمة ب).
- `app/accruals.mjs` — إطفاء المدفوعات المقدمة والاستحقاقات (مهمة ج).
- `app/static/cash-close-ui.mjs` — ثلاث شاشات في ملف واحد: `cashForecastUI` و`closeChecklistUI` و`accrualsUI`.
- `tests/cash-forecast.test.mjs` · `tests/close-checklist.test.mjs` · `tests/accruals.test.mjs`.
- `docs/implementation/handoff/cash-close.md` (هذا الملف).

لم ألمس `app/server.mjs` ولا `app/static/operations.mjs` ولا `app/access.mjs` ولا `app/reports.mjs` ولا `app/inbox.mjs` ولا `STATUS.md` ولا أي اختبار قائم ولا أي هجرة غير 052. لم أضف أي صنف CSS جديد؛ استخدمت الأصناف القائمة فقط.

## 2. الهجرة 052 وجداولها

**التنبؤ النقدي بلا جداول عمدًا.** كل رقم فيه يُشتق من مستندات المنصة وقت العرض، والرصيد الافتتاحي والسيناريوهات معاملات إدخال تُحسب فورًا ولا تُحفظ. اختبار `nothing it computes becomes a stored fact` يثبت أن الوحدة لا تملك جدولًا، وأن قراءة سيناريو لا تكتب ولا سطر تدقيق.

| الجدول | ما فيه | ما يحميه في SQL |
|---|---|---|
| `close_task_templates` | قالب مهمة إقفال يضعه مالك الإجراء: عنوان، مالك، يوم استحقاق من الشهر التالي (1–28)، **سند** يشرح من قرر المهمة ولماذا، وحالة تفعيل. | `UNIQUE(tenant_id,title)`، `CHECK` على طول العنوان والسند، `TRIGGER` يفرض تقدّم `version` ويمنع الحذف (إيقاف لا حذف). |
| `close_periods` | فترة إقفال شهرية: `period_key` بصيغة `YYYY-MM`، ربط اختياري بفترة محاسبية، حالة `open`/`approved`، من فتحها ومن اعتمدها وسند اعتماده، `ledger_locked`، و`reopen_count`. | `CHECK((status='approved')=(approved_by ومعه approved_at وسند ≥10 حرفًا))`. `TRIGGER close_period_approver_independent`: **من فتح الفترة أو نفّذ فيها مهمة لا يعتمد إقفالها**. `TRIGGER close_period_tasks_complete`: لا اعتماد ومهمة واحدة مفتوحة. `TRIGGER close_period_versioned` يثبّت الهوية ويمنع نسيان قفل صدر. لا حذف. |
| `close_tasks` | مهمة الفترة: عنوان، مالك، موعد، حالة، **دليل تنفيذ**، من نفّذها ومتى. | `CHECK((status='done')=(منفِّذ ووقت ودليل ≥5 أحرف))`. `TRIGGER close_tasks_locked_insert/update`: **الإقفال المعتمد لا يقبل مهمة جديدة ولا تعديلًا**. `TRIGGER close_tasks_evidence_final`: المهمة المنفذة تحتفظ بمنفّذها ودليلها. لا حذف. |
| `close_reopenings` | طلب فتح إقفال معتمد: معتمد الإقفال السابق ووقته، طالب الفتح، **سبب ≥10 أحرف**، حالة `pending`/`approved`/`rejected`، ومن قرر وسنده. | `CHECK(requested_by<>previous_approved_by)` و`CHECK(approved_by<>requested_by AND approved_by<>previous_approved_by)` — **شخص ثالث حقيقي**. فهرس جزئي: طلب فتح معلق واحد لكل فترة. `TRIGGER close_reopen_final`: يُقرَّر مرة ولا يُعاد كتابته. لا حذف. |
| `amortization_schedules` | جدول إطفاء: نوع (`prepaid`/`accrual`)، فاتورة مورد اختيارية، مرجع المستند، القيمة الكاملة بالهللات، بداية ونهاية فترة الإطفاء وعدد أشهرها، **الحسابان ومركز التكلفة يختارهم المحاسب**، سند الفترة، وحالة `active`/`cancelled` بسببها. | `CHECK(debit_account_id<>credit_account_id)`، `CHECK((status='cancelled')=(سبب ≥10 أحرف))`، `UNIQUE(tenant_id,kind,source_reference)`. `TRIGGER amortization_schedule_fixed`: **القيمة والفترة والحسابان لا تتغير**؛ التصحيح بإلغاء وإعداد جدول جديد. لا حذف. |
| `amortization_entries` | قسط شهري **مقترح**: شهره وتاريخ قيده وترتيبه ومبلغه، وحالته `proposed`/`approved`/`cancelled` مع معتمده وسنده. | `UNIQUE(schedule_id,period_key)` و`UNIQUE(schedule_id,position)`. `TRIGGER amortization_entry_independent`: **من أعدّ الجدول لا يعتمد قسطه**. `TRIGGER amortization_entry_final`: يُقرَّر مرة، ومبلغه وشهره وتاريخه لا تتغير أبدًا. لا حذف. |

## 3. المسارات التي يحتاجها المنسّق في `app/server.mjs`

الاستيرادات:

```js
import * as cashForecast from './cash-forecast.mjs';
import * as closeChecklist from './close-checklist.mjs';
import * as accruals from './accruals.mjs';
```

### قراءة (GET، خارج المعاملة)

| الطريقة | المسار | الدالة | ملاحظة |
|---|---|---|---|
| GET | `/api/cash-forecast` | `cashForecast.cashForecastBoard(db,u)` | دالة `load` للشاشة. ترمي 403 `not_permitted` لمن لا يحمل `finance.forecast.view`. |
| GET | `/api/close-checklist` | `closeChecklist.closeBoard(db,u)` | دالة `load`. حامل `finance.close.manage` يرى كل الفترات؛ مالك مهمة يرى فتراته فقط. |
| GET | `/api/close-checklist/periods/:periodId` | `closeChecklist.getClosePeriod(db,u,periodId)` | اختيارية؛ اللوحة تعيد كل شيء. |
| GET | `/api/accruals` | `accruals.accrualsBoard(db,u)` | دالة `load`. تحتاج `finance.close.manage`. |
| GET | `/api/accruals/:scheduleId` | `accruals.getSchedule(db,u,scheduleId)` | اختيارية. |

### حساب «ماذا لو» (POST قراءة محضة — **لا يكتب شيئًا**)

| المسار | الدالة | ملاحظة |
|---|---|---|
| POST | `/api/cash-forecast/project` | `cashForecast.cashForecastBoard(db,u,input)` | `input` = `{opening_balance?,opening_source?,opening_note?,scenarios?}`. **لا `Idempotency-Key` ولا حاجة لمعاملة**: الدالة لا تنفّذ `INSERT` ولا `UPDATE` ولا `audit`. لفّها بمعاملة إن كان المسار العام يفعل ذلك — لا ضرر. |

`scenarios` مصفوفة حتى ثمانية عناصر، كل عنصر `{kind,case_id?,delay_days?,monthly_amount?,starts_on?,label?}` و`kind` واحد من `client_delay` · `client_lost` · `new_hire` · `collection_delay`.

### كتابة (POST، **داخل `transaction`**)

| المسار | الدالة | `Idempotency-Key` |
|---|---|---|
| POST `/api/close-checklist/templates` | `closeChecklist.createTemplate(db,u,input)` | نعم |
| POST `/api/close-checklist/templates/:id/(activate_template\|deactivate_template)` | `closeChecklist.templateAction(db,u,id,action,input)` | لا (`version`) |
| POST `/api/close-checklist/periods` | `closeChecklist.openClosePeriod(db,u,input)` | نعم |
| POST `/api/close-checklist/periods/:id/(add_task\|approve_close\|request_reopen\|approve_reopen\|reject_reopen)` | `closeChecklist.periodAction(db,u,id,action,input)` | لا (`version`) |
| POST `/api/close-checklist/tasks/:id/(complete_task\|reassign_task)` | `closeChecklist.taskAction(db,u,id,action,input)` | لا (`version`) |
| POST `/api/accruals` | `accruals.createSchedule(db,u,input)` | نعم |
| POST `/api/accruals/:id/cancel_schedule` | `accruals.scheduleAction(db,u,id,'cancel_schedule',input)` | لا (`version`) |
| POST `/api/accruals/entries/:id/(approve_entry\|cancel_entry)` | `accruals.entryAction(db,u,id,action,input)` | لا (`version`) |

المعرّفات كلها `[a-f0-9-]{36}` عدا `period_key` الذي يأتي في جسم الطلب لا في المسار.

### حقول جسم الطلب لكل فعل كتابة (كما تتحقق منها `v.object`؛ أي حقل زائد يُرفض بـ`invalid_fields`)

| الدالة / الفعل | الحقول |
|---|---|
| `createTemplate` | `title` · `owner_id` · `due_day` (عدد صحيح 1–28) · `basis` |
| `templateAction` (`activate_template`/`deactivate_template`) | `version` · `note` |
| `openClosePeriod` | `period_key` (`YYYY-MM`) · `finance_period_id` (أو `null`) — تعيد `{id,tasks}` |
| `periodAction` · `add_task` | `version` · `title` · `owner_id` · `due_date` |
| `periodAction` · `approve_close` | `version` · `note` (≥10 أحرف) |
| `periodAction` · `request_reopen` | `version` · `reason` (≥10 أحرف) |
| `periodAction` · `approve_reopen`/`reject_reopen` | `version` · `note` (≥10 أحرف) |
| `taskAction` · `complete_task` | `version` (نسخة المهمة) · `evidence` (≥5 أحرف) |
| `taskAction` · `reassign_task` | `version` · `owner_id` · `note` |
| `createSchedule` | `kind` (`prepaid`/`accrual`) · `invoice_id` (أو `null`) · `source_reference` · `description` · `amount` (نص عشري) · `starts_on` · `ends_on` · `debit_account_id` · `credit_account_id` · `cost_center_id` · `basis` — تعيد `{id,months}` |
| `scheduleAction` · `cancel_schedule` | `version` · `reason` (≥10 أحرف) |
| `entryAction` · `approve_entry`/`cancel_entry` | `version` (نسخة القسط) · `note` |

`version` في `periodAction` هي نسخة **الفترة**، وتتقدم مع كل فعل عليها (بما فيه `add_task` و`request_reopen`) حتى لا يعتمد أحد قائمة قرأها قبل تغيّرها. أفعال الإنشاء الثلاثة ذات `Idempotency-Key` تعيد كائنًا فيه `id`، فيصلح معها نمط `once(()=>…,id=>({id}))` المتبع في الخادم.

## 4. مفاتيح الوحدات في `operationModules` والملف الثابت

في `app/static/operations.mjs`:

```js
import { cashForecastUI, closeChecklistUI, accrualsUI } from './cash-close-ui.mjs';
// ... داخل operationModules:
'cash-forecast':cashForecastUI,'close-checklist':closeChecklistUI,accruals:accrualsUI
```

وفي القائمة البيضاء للملفات الثابتة في `app/server.mjs` (السطر الذي يسجّل وحدات `app/static/`): **`cash-close-ui`** (ملف واحد يخدم المفاتيح الثلاثة).

مجموعة التنقّل المقترحة: **المالية** للثلاثة. `cash-forecast` شاشة قيادية (تصريحها حساس) فيصح وضعها قرب اللوحة التنفيذية.

## 5. ما ينبغي أن يظهر في «بانتظار قراري»

- `closeBoard(db,u).inbox` — يعيد: مهام الإقفال المفتوحة التي يملكها المستخدم، ودعوة اعتماد إقفال اكتملت مهامه (لمن يحق له الاعتماد فقط)، وطلب فتح إقفال ينتظر قرار شخص ثالث. الشكل مطابق لما يستهلكه `app/inbox.mjs` (`{id,title,due_date,created_at,actions}`).
- `accrualsBoard(db,u).inbox` — أقساط إطفاء انتهى شهرها وتنتظر اعتماد شخص غير مُعِدّ الجدول.
- التنبؤ النقدي **لا يعيد صندوقًا**: لا قرار فيه، وهو شاشة قراءة.

السطران المقترحان في `app/inbox.mjs` (المنسّق يضيفهما، لم ألمس الملف):

```js
['close-checklist','الإقفال الشهري',(db,u)=>({periods:closeBoard(db,u).inbox})],
['accruals','الإطفاء والاستحقاقات',(db,u)=>({entries:accrualsBoard(db,u).inbox})],
```

## 6. ما لم أبنه ولماذا، وما يحتاج قرار المالك أو مالك إجراء

### الرصيد الافتتاحي والمطابقة البنكية

كما طُلب، **لم أستورد `app/bank-reconciliation.mjs` ولم أعتمد عليه**. الرصيد الافتتاحي معامل إدخال اختياري مع `opening_source` من قيمتين: `accountant` أو `bank_reconciliation`. الشاشة تصرّح بأنه إدخال يدوي وأن المنصة غير متصلة بأي بنك.

**الوصلة التي يصلها المنسّق لاحقًا:** آخر تسوية معتمدة موجودة الآن في `bank_reconciliations` حيث `status='approved'`، والعمود المفيد هو `statement_closing_minor` (ومعه `period_end` و`bank_account_id`). عند الربط تُملأ `opening_balance` منه ويُضبط `opening_source='bank_reconciliation'`، ويبقى `opening_note` حاملًا مرجع التسوية. لم أفعل ذلك بنفسي لأن الوحدة كانت تحت الإنشاء وقت كتابتي.

### الاشتراكات المتعاقد عليها — وُصلت

وحدة `billing-recurring` (الهجرة 051) نزلت أثناء عملي، فوصلت التنبؤ بها مباشرة: `billing_schedules` السارية تعطي تدفقًا **متوقعًا** في تواريخ فوترتها، و`billing_drafts` بحالة `pending_review` تعطي تدفقًا متوقعًا كذلك. الفترة التي وُلّدت لها مسودة (`billing_schedule_runs`) لا تُحسب من الجدولة، والمسودة التي صدرت فاتورتها تنتقل تلقائيًا إلى مجرى الذمم الصادرة — فلا ازدواج، ويثبته اختبار `counted once`.

استوردت `duePeriods` من `app/billing-recurring.mjs` **عمدًا** بدل نسخ قاعدة الدورية: مصدر حقيقة واحد لمتى تُفوتر الجدولة. إن غيّر صاحب تلك الوحدة توقيع الدالة فليخبرني المنسّق.

### ما لم يُبنَ، وهو يحتاج قرارًا

1. **المصروفات المتكررة (إيجار، اشتراكات برمجية، مرافق) غير مشمولة في التنبؤ.** لا يوجد في المنصة سجل التزامات متكررة بدورية سداد. `contract_records` في سجل العقود يحفظ `value_minor` كقيمة إجمالية بلا دورية، وتوزيعها على الأسابيع **اختراع لا اشتقاق**، فامتنعت. الشاشة تقول ذلك حرفيًا وتذكر عدد عقود الموردين السارية التي لا تدخل. **قرار المالك:** إما سجل التزامات متكررة (مبلغ + دورية + مالك + سند) وهو أنظف، أو الاكتفاء بتسجيلها أوامر شراء.
2. **الدفعات المقدمة المسجلة غير المقبوضة** (`advance_invoices` بحالة `recorded`) لا تدخل التنبؤ: الجدول لا يحفظ لها تاريخ استحقاق، ووضعها في أسبوع بعينه تخمين. تظهر في «ما لا يشمله التنبؤ» بعددها.
3. **حصة المنشأة في التأمينات الاجتماعية ومستحقات نهاية الخدمة** لا تدخل التدفق الخارج: المنصة تحسب استقطاع الموظف فقط ولا تعرف حصة المنشأة (نسبة نظامية لا تُكتب في الكود). **قرار مالك إجراء الرواتب:** إدخالها كمعامل سياسة بسندها.
4. **موعد صرف الرواتب** مأخوذ من `pay_day` في سياسة دورة الرواتب المعتمدة، **على الشهر نفسه**. السياسة تحدد اليوم ولا تحدد الشهر. هذا الافتراض **معلَن** في `assumptions` ويظهر على الشاشة. **قرار مالك الإجراء:** هل الصرف في شهر الاستحقاق أم في الذي يليه؟ إن كان الثاني فالتعديل سطر واحد في `payrollItems`.
5. **أوامر الدفع المعتمدة لا تحمل تاريخ سداد** في `payment_orders`، فتُنسب إلى تاريخ اعتمادها ويظهر ما مضى منها في الأسبوع الأول موسومًا `overdue`. مُعلَن في `assumptions`.
6. **لا نسبة تحصيل ولا احتمال في أي مكان.** `collection_history` يُحسب فعلًا من `ar_receipts` المؤكدة مقابل `ar_claims.due_date` (وسيط الفرق بالأيام وأقله وأقصاه)، ومعه **حجم العينة** و`reliable:false` إن كانت أقل من 12، والنص يقول صراحة إن التنبؤ **لا يطبّق** هذا المتوسط على أي بند. إن أراد المالك تطبيقه فهو قرار صريح لا افتراض صامت.
7. **قفل الفترات موجود أصلًا ولم أكرره.** `finance_periods.status` و`openPeriod` في `app/finance.mjs` هما القفل: أي قيد بتاريخ داخل فترة مقفلة يُرفض بـ`period_closed`. اعتماد الإقفال عندي يستدعي `financeReferenceAction(db,u,'periods',id,'close',…)` فيقفل الفترة المرتبطة. **أثران يحتاجان انتباه المنسّق:**
   - معتمِد الإقفال يجب أن يحمل تفويض `configure` المالي أيضًا، وإلا فشل الاعتماد برسالة الدفتر. هذا شرط الدفتر لا شرطي.
   - **الدفتر لا يعيد فتح فترة محاسبية مقفلة إطلاقًا** (`financeReferenceAction` يرفض ذلك نصًا). لذلك فتح الإقفال عندي يعيد **قائمة المهام** مفتوحة ويبقي `ledger_locked=1`؛ تصحيح القيود يكون بقيد عكس في فترة مفتوحة. لم أغيّر ذلك لأن `finance.mjs` ليس ملكي. **قرار المالك:** أهذا مقبول أم يلزم مسار إعادة فتح محاسبي موثّق؟
   - `finance_periods` في البذرة التجريبية **سنوية**. اعتماد إقفال شهر مرتبط بفترة سنوية يقفل السنة كلها. لذلك: أرفض الربط إن كانت الفترة لا تغطي الشهر، وأعرض مدى الفترة على الشاشة وفي نص التأكيد قبل الاعتماد، وأسمح بفترة إقفال **بلا** ربط محاسبي مع تصريح واضح بأن القيود لن تُمنع. **قرار مالك الإجراء:** إنشاء فترات محاسبية شهرية إن أُريد قفل شهري حقيقي.
8. **قائمة مهام الإقفال تبدأ فارغة.** لم أخترع قائمة محاسبية جاهزة: مالك الإجراء يضع القوالب وكل قالب يحمل **سندًا** يشرح من قرر المهمة. الشاشة تقول ذلك حين لا توجد قوالب.
9. **الأقساط المعتمدة لا تُرحَّل.** اعتماد قسط الإطفاء يعني «صحيح ومستحق هذا الشهر» فقط؛ `posting_status` يبقى `not_posted` وكل قسط يحمل نصًا يقول إن الترحيل قيد يدوي في الدفتر المالي بتفويضه المستقل. لم أنشئ قيدًا آليًا ولم أضف غرضًا محاسبيًا إلى `PURPOSES` في `app/ledger.mjs` (ليس ملكي، وإضافته تغيّر سلوك وحدة أخرى) — بدلًا من ذلك يختار المحاسب الحسابين من دليل الحسابات مع تحقق من نوعيهما: `prepaid` = مصروف مدين مقابل **أصل**، و`accrual` = مصروف مدين مقابل **التزام**.
   **تحسين لاحق يحتاج قرارًا:** ربط زر «رحّل» يستدعي `createJournal` في الدفتر من القسط المعتمد، مع بقاء الاعتماد والترحيل قرارين منفصلين. لم أبنه حتى لا أخلق مسارًا يلتف على تفويضات الدفتر.
10. **إطفاء استحقاق عند وصول الفاتورة** (قيد العكس) لم أؤتمته: عند وصول فاتورة المورد يُلغى الجدول بسبب موثّق وتُسجَّل الفاتورة عادةً. الأتمتة تحتاج ربطًا بين `procurement_invoices` والجدول لم يطلبه أحد بعد.
11. **الصلاحيات:** استعملت مفتاحيّ المحجوزين كما هما ولم ألمس `app/access.mjs`. `finance.forecast.view` حساس (لا يُمنح بحكم الدور، ويلزمه منح صريح، ويخضع لإلزام التحقق بخطوتين إن فُعّل). `finance.close.manage` يُمنح صراحة كذلك. **قرار مسؤول الصلاحيات:** من يحمل كلًا منهما، ولاحظ أن الفصل يعمل فقط إن حمل التصريح **شخصان مختلفان على الأقل** (منفّذ ومعتمد، وثالث للفتح).

## 7. نتيجة تشغيل اختباراتي

```
$ node --test tests/cash-forecast.test.mjs tests/close-checklist.test.mjs tests/accruals.test.mjs
ℹ tests 24
ℹ pass 24
ℹ fail 0
```

(11 اختبارًا للتنبؤ، 7 للإقفال، 6 للإطفاء = 24 — يشمل كل ملف اختبار عرض يتحقق من أن الشاشة تُبنى من بيانات لوحة حقيقية بلا `style=` ولا `<script>` ولا `undefined`.)

ثم تحققت من أنني لم أكسر ما حولي:

```
$ node --test tests/finance.test.mjs tests/ledger.test.mjs tests/receivables.test.mjs tests/payroll.test.mjs \
    tests/payables.test.mjs tests/invoices.test.mjs tests/access.test.mjs tests/migrations.test.mjs \
    tests/static-modules.test.mjs tests/billing-recurring.test.mjs tests/platform.test.mjs \
    tests/security-regressions.test.mjs tests/company-scale.test.mjs tests/inbox.test.mjs \
    tests/service-cards.test.mjs tests/compliance.test.mjs
ℹ tests 76
ℹ pass 76
ℹ fail 0

$ node scripts/check.mjs
Syntax checked: 279 JavaScript modules. Source hashes match. Traceability: 220 requirements / 22 domains.
```

لم أشغّل `npm test` كاملًا كما تنص قواعد العمل المشترك (وكلاء آخرون يعملون الآن).
