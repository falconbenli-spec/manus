# tax-returns — ورقة عمل الإقرار الضريبي وسجل ضريبة الاستقطاع

القاعدة الحاكمة المطبَّقة في كل سطر: **لا نسبة ضريبية في الكود**. لا 15٪ ولا 5٪ ولا صفر. كل نسبة صف في
`tax_rate_settings` يدخله صاحبه بمصدره المكتوب وتاريخ تأكيده واسم المختص الذي أكده، ويؤكده شخص آخر قبل أن تُستعمل،
وتبقى مؤرّخة فتُطبَّق **نسبة الفترة لا نسبة اليوم** (`rateAt(db,tenant,kind,category,date)`).
الجداول تبدأ **بلا صفوف**. وكل شاشة ولوحة وملف تصدير يحمل النص: **«ورقة عمل للمراجعة، وليست إقرارًا. يحتاج تأكيد
المختص الضريبي قبل التقديم.»** (`DISCLAIMER`). المنصة لا تقدّم إقرارًا ولا تورّد ولا تتصل بأي جهة.

## 1. الملفات

| الملف | الحالة |
| --- | --- |
| `app/migrations/054-tax-returns.sql` | جديد |
| `app/tax-returns.mjs` | جديد |
| `app/static/tax-returns-ui.mjs` | جديد |
| `tests/tax-returns.test.mjs` | جديد |
| `docs/implementation/handoff/tax-returns.md` | جديد (هذا الملف) |

لم أعدّل أي ملف مشترك: لا `server.mjs` ولا `access.mjs` ولا `inbox.mjs` ولا `operations.mjs` ولا `compliance.mjs`
ولا أي اختبار قائم ولا أي هجرة غير 054.

## 2. الهجرة 054 وجداولها

| الجدول | ماذا يحفظ | أهم القيود |
| --- | --- | --- |
| `tax_rate_settings` | النسب المؤرّخة (`kind` = `vat` أو `withholding`) بتصنيفها ونسبتها بنقاط الأساس ومصدرها وتاريخ تأكيدها واسم المختص | `confirmed_by<>recorded_by` · `UNIQUE(tenant,kind,category,effective_from)` · `TRIGGER` يرفض تعديل نسبة مؤكدة (التصحيح إعداد جديد بتاريخ سريان جديد) · لا حذف |
| `vat_worksheets` | ورقة كل فترة ضريبية بنسخها: أرقام المُعِدّ + `ledger_snapshot` + `variance_minor` + `reconciliation_note` | `reviewed_by<>prepared_by` · `CHECK(status='draft' OR variance_minor=0 OR length(trim(reconciliation_note))>=10)` — **لا تُقفل الورقة والفرق غير مفسَّر** · `CHECK` يمنع «مقدَّمة» بلا مرجع تقديم ودليله · فهرسان فريدان: ورقة مفتوحة واحدة وورقة مقدَّمة واحدة لكل فترة · `TRIGGER` يمنع تعديل الأرقام بعد المراجعة ويحصر الانتقالات `draft→reviewed→filed→superseded` |
| `vat_export_boxes` | اسم الخانة الذي **يسميه المستخدم** لكل بند، ومن سماه | مفتاح `(tenant_id,line_key)` |
| `withholding_entries` | كل دفعة لغير مقيم: المستفيد وبلده ونوع الخدمة والمبلغ والنسبة المؤرّخة والمستقطع وتاريخ استحقاق التوريد وسنده وحالة التوريد ودليلها، ومن أفتى بالتصنيف ومتى | `rate_setting_id` مرجع إلى الإعداد المؤرّخ · `remitted_by<>recorded_by` · `CHECK` يربط حالة «مورَّد» بوجود مرجع ودليل · ربط اختياري بـ`payment_orders` بفهرس فريد · `TRIGGER` يمنع تعديل سجل بعد توثيقه |
| `zakat_worksheets` + `zakat_worksheet_lines` | هيكل ورقة وعاء الزكاة: بنود **يسميها المختص** ومبالغها تبقى `NULL` حتى يملأها | `reviewed_by<>prepared_by` · لا مجموع ولا بند مفترض في المخطط · `TRIGGER` يمنع إضافة أو تعديل أو حذف بند خارج المسودة |

## 3. المسارات التي يحتاجها المنسّق في `app/server.mjs`

`import * as taxReturns from './tax-returns.mjs';`

### قراءة (GET، خارج المعاملة)

| الطريقة | المسار | الدالة |
| --- | --- | --- |
| GET | `/api/tax-returns/vat` | `taxReturns.vatBoard(db,u)` |
| GET | `/api/tax-returns/withholding` | `taxReturns.withholdingBoard(db,u)` |
| GET | `/api/tax-returns/vat/{id}/export.csv` | `taxReturns.exportVatWorksheet(db,u,id)` |

التصدير يعيد `{filename,type,content:Buffer}` — يُرسل مثل تصدير التقارير:
```js
const file=taxReturns.exportVatWorksheet(db,u,m[1]);
audit(db,u,'vat_worksheet',m[1],'vat_worksheet.exported',{}, {format:'csv'});
res.writeHead(200,{...headers,'Content-Type':file.type,'Content-Disposition':`attachment; filename="${file.filename}"`,'Content-Length':file.content.length});res.end(file.content);
```
الصلاحية تُفحص داخل الدالة نفسها، فرابط التصدير لا يتجاوز ما يراه صاحبه على الشاشة.

### كتابة (POST، كلها **داخل معاملة**)

| المسار | الدالة | المعاملات | `Idempotency-Key` |
| --- | --- | --- | --- |
| `/api/tax-returns/rates` | `recordRateSetting(db,u,input)` | `{kind,category,label,percent,effective_from,source,confirmed_on,specialist_name}` → `{id}` | نعم |
| `/api/tax-returns/rates/{id}/confirm` | `confirmRateSetting(db,u,id,input)` | `{version,note}` | لا (محمي بـ`version`) |
| `/api/tax-returns/vat` | `createVatWorksheet(db,u,input)` | `{period_start,period_end}` → `{id}` | نعم |
| `/api/tax-returns/vat/{id}` | `saveVatWorksheet(db,u,id,input)` | `{version,sales_standard,output_vat,sales_zero_rated,sales_exempt,sales_out_of_scope,purchases,input_vat,adjustments,adjustments_note,reconciliation_note}` | لا |
| `/api/tax-returns/vat/{id}/open` | `getVatWorksheet(db,u,id)` | لا شيء (قراءة عبر POST كما في `/api/reports/snapshots/{id}/open`) | لا |
| `/api/tax-returns/vat/{id}/(review_worksheet\|record_filing\|revise_worksheet)` | `vatWorksheetAction(db,u,id,action,input)` | `review_worksheet:{version,note}` · `record_filing:{version,filing_reference,filing_evidence}` · `revise_worksheet:{version,note}` → `{id}` للنسخة الجديدة | `revise_worksheet` نعم، وغيره لا |
| `/api/tax-returns/vat/boxes` | `nameExportBoxes(db,u,input)` | `{boxes:[{line_key,box_label}]}` | لا |
| `/api/tax-returns/withholding` | `recordWithholding(db,u,input)` | `{payment_order_id,beneficiary_name,beneficiary_country,service_kind,payment_date,amount,rate_setting_id,remittance_due_date,due_date_basis,classified_by_name,classified_on,classification_note,treaty_note}` → `{id}` | نعم |
| `/api/tax-returns/withholding/{id}/(record_remittance\|cancel_entry)` | `withholdingAction(db,u,id,action,input)` | `record_remittance:{version,remitted_on,remittance_reference,remittance_evidence}` · `cancel_entry:{version,note}` | لا |
| `/api/tax-returns/zakat` | `createZakatWorksheet(db,u,input)` | `{fiscal_year,specialist_name,basis_note}` → `{id}` | نعم |
| `/api/tax-returns/zakat/{id}/lines` | `saveZakatLines(db,u,id,input)` | `{version,lines:[{label,amount,source_note}]}` | لا |
| `/api/tax-returns/zakat/{id}/(review_zakat\|revise_zakat)` | `zakatAction(db,u,id,action,input)` | `{version,note}` | `revise_zakat` نعم |

المعرّفات كلها `[a-f0-9-]{36}`.

## 4. وحدة الواجهة

`app/static/tax-returns-ui.mjs` يصدّر ثابتين:

| مفتاح `operationModules` | الثابت | مجموعة التنقّل |
| --- | --- | --- |
| `vat-worksheet` | `vatWorksheetUI` | المالية |
| `withholding` | `withholdingUI` | المالية |

`import { vatWorksheetUI, withholdingUI } from './tax-returns-ui.mjs';` ثم
`'vat-worksheet':vatWorksheetUI,withholding:withholdingUI` في `operationModules`.
وأضف `'tax-returns-ui'` إلى قائمة الملفات البيضاء في `app/server.mjs` (السطر الذي يبني `assets`)، وإلا لم تُقدَّم الوحدة.

شاشة `vat-worksheet` تعرض أوراق القيمة المضافة وبند التسوية وقائمة «مدخلات تنتظر التحقق» والنسب المؤرّخة **وورقة
وعاء الزكاة** (وضعتها هنا لأن المفتاحين المحجوزين اثنان فقط). لا `style=""` ولا `<script>` ولا مورد خارجي،
ولا صنف CSS خارج القائمة المسموحة (لم أحتج أي صنف جديد).

## 5. «بانتظار قراري»

اللوحتان تصدّران مصفوفة `inbox` جاهزة بالشكل الذي يقرؤه `app/inbox.mjs` (مثل `complianceBoard(...).inbox`):

```js
['tax-returns','أوراق العمل الضريبية',(db,u)=>({worksheets:taxReturns.vatBoard(db,u).inbox,entries:taxReturns.withholdingBoard(db,u).inbox})]
```

الأفعال التي تنتظر قرارًا: `confirm_rate` (تأكيد نسبة أدخلها غيرك) · `review_worksheet` · `record_filing` ·
`review_zakat` · `record_remittance`.

**تنبيه للمنسّق:** `labelFor` في `inbox.mjs` يسقط `record_filing` و`record_remittance` لأن `NOT_DECISIONS` يطابق
`record_(?!execution|reimbursement|client)`. إن أردتهما في الصندوق فأضف إلى `DECISIONS`:
`record_filing:'توثيق التقديم', record_remittance:'توثيق التوريد'` (وهي تُفحص قبل `NOT_DECISIONS`). الباقي يعمل كما هو:
`review_*` → «مراجعة»، `confirm_rate` → «تأكيد». القرار قراري لم أتخذه لأن `inbox.mjs` ملك المنسّق.

## 6. الربط بتقويم الالتزامات (`app/compliance.mjs`) — قرأته ولم أعدّله

لم أبنِ تقويمًا ثانيًا ولا موعدًا نظاميًا. الربط الذي أوصي به المنسّق:

1. `compliance.SUGGESTED` يحوي أصلًا «إقرار ضريبة القيمة المضافة» و«إقرار الزكاة السنوي». مالك الالتزام يسجّل الموعد
   وسنده كما هو، والمنصة لا تفترضه.
2. عند `complete_obligation` يكتب المالك في `evidence_reference` **مرجع تقديم الورقة** (`filing_reference`) وفترة
   الورقة؛ فيصير دليل التنفيذ في التقويم مساويًا لما وُثّق في ورقة العمل، ويتحقق منه شخص آخر بقاعدة التقويم نفسها.
3. إن أراد المنسّق ربطًا أقوى لاحقًا: `currentPeriod(o,date)` في `compliance.mjs` يعطي فترة الالتزام وموعدها، ويمكن
   مطابقتها بـ`period_start/period_end` في `vat_worksheets` لعرض «ورقة هذه الفترة» بجانب الالتزام. لم أفعلها لأنها
   تعديل في ملف مشترك.

## 7. ما تفعله الوحدة بالضبط

- **أ. ورقة القيمة المضافة:** تقرأ من الدفتر مخرجات الفترة من `tax_invoices` الصادرة بتاريخ التوريد مجمّعة بالتصنيف
  (والإشعار الدائن يطرح لا يضيف)، وضريبة المدخلات **المتحقق منها فقط** عبر `verifiedInputVat` من `app/payables.mjs`
  (يعيد `null` ما لم يُتحقق من أي فاتورة مورد، فتعرض الشاشة «لا رقم، وليس صفرًا»). أرقام المُعِدّ تُحفظ بجانب لقطة
  الدفتر، و**بند التسوية** يعرض الفرق بندًا بندًا. الورقة لا تُراجَع ولا تُقفل والفرق غير مفسَّر (قيد `CHECK` + فحص في
  الكود)، ولا تُراجَع إن تحرك الدفتر بعد آخر حفظ (`ledger_moved`).
- **ضريبة المدخلات غير المتحقق منها لا تدخل الورقة:** محاولة إدخال مبلغ يتجاوز المتحقق منه تُرفض بـ`unverified_input_vat`،
  وتظهر المعلّقة في قائمة «مدخلات تنتظر التحقق» مع أثرها لو تحقق منها.
- **ب. سجل الاستقطاع:** النسبة من الإعدادات المؤرّخة المؤكدة، ويُرفض اختيار نسبة ليست السارية في **تاريخ الدفعة**.
  حقول «من أفتى بالتصنيف ومتى وعلى أي أساس» إلزامية بقيد قاعدة بيانات، وأثر الاتفاقيات حقل يكتبه المختص. الربط بأمر
  الدفع اختياري ويُعرض للمستخدم دون أن تستنتج المنصة خضوع دفعة للاستقطاع. توثيق التوريد يقوم به شخص غير من سجّل.
- **ج. ورقة وعاء الزكاة:** هيكل فارغ. لا بند مقترح ولا مبلغ مفترض ولا مجموع يحسبه أحد غير المختص.
- **تصدير CSV:** خانات يسمّيها المستخدم (`vat_export_boxes`)، والملف نفسه يقول: «المنصة لا تفترض ترقيم خانات نموذج
  رسمي؛ التعيين على المستخدم والمختص الضريبي»، ويحمل التنبيه وفرق التسوية وبنده.

## 8. ما لم أبنه ولماذا

1. **لا ربط بأي جهة ولا تقديم إلكتروني.** المنصة توثّق فعلًا تم خارجها بمرجعه ودليله ومن قام به، ولا تدّعي اتصالًا.
2. **لا استنتاج لتصنيف ضريبي ولا لنسبة ولا لأثر اتفاقية.** كلها قرار المختص الضريبي، والمنصة تسجّل قراره باسمه وتاريخه.
3. **لا حساب لوعاء الزكاة ولا بنود مقترحة.**
4. **لا تعبئة تلقائية لأرقام الورقة من الدفتر.** الدفتر يُعرض بجانب الورقة ليُقارَن؛ نسخ رقم الدفتر إلى الورقة قرار
   مُعِدّها لا قرار المنصة. (قابل لإضافة زر «انسخ رقم الدفتر» لاحقًا إن أراده المالك.)
5. **قائمة «مدخلات تنتظر التحقق» مغطاة في الاختبار هيكليًا فقط** (قائمة فارغة + نصّها + رفض إدخال مدخلات غير متحقق
   منها). بناء صفوف `procurement_invoice_tax` يتطلب سلسلة المشتريات كاملة، وهي مغطاة في `tests/payables.test.mjs`
   القائم؛ لم أكرّرها.
6. **الورقة تقيس فرقًا واحدًا لكل بند** ولا تفصّل الفرق إلى أسبابه (فاتورة بعينها). تفصيل الفرق إلى مستنداته عمل
   لاحق يحتاج قرار المالك على شكل العرض.

## 9. ما يحتاج قرار المالك أو مالك إجراء

1. **من يملك تصريح `tax.returns.review`؟** التصريح حساس، ويجب ألا يكون بيد من يُعدّ الأوراق. قرار صاحب العمل.
2. **من هو المختص الضريبي المعتمد؟** اسمه يُكتب في كل نسبة وكل تصنيف استقطاع. المنصة لا تتحقق من صفته.
3. **مواعيد التوريد والتقديم** يدخلها من يعرفها بسندها؛ لم أضع أي مهلة افتراضية.
4. **تعيين بنود الورقة على خانات النموذج الرسمي** — على المستخدم والمختص، وقد أتحت تسميتها وحفظ من سماها.
5. هل يُسمح بإلغاء سجل استقطاع (`cancel_entry`) لحامل تصريح المراجعة وحده كما نفّذت، أم يحتاج موافقة أعلى؟

## 10. نتيجة تشغيل الاختبارات

`node --test tests/tax-returns.test.mjs`

```
✔ tax rates: the platform ships with none, a rate carries its source and confirmation date, the person who enters it does not confirm it, and a period keeps its own rate
✔ vat worksheet: the preparer never reviews it, an unexplained gap against the ledger blocks closing, and a reviewed worksheet is corrected by a new revision
✔ vat worksheet: figures come from the ledger, unverified input vat never enters the worksheet, and the CSV boxes are named by the user
✔ withholding: the rate comes from a dated confirmed setting at the payment date, the classifier is recorded by name, and whoever records it does not document its remittance
✔ zakat worksheet: the platform names no line and computes no pool, and the specialist’s worksheet is approved by someone other than its preparer
✔ both screens render for the preparer and the reviewer, every offered button opens a usable form, and each screen states it is a worksheet and not a return
ℹ tests 6 · pass 6 · fail 0
```

تغطي الاختبارات: منع الاعتماد الذاتي (النسبة والورقة والزكاة والاستقطاع) · منع تعديل المعتمد (أربعة `TRIGGER`) ·
تعارض `version` · عزل `tenant` (حساب بالتصريح نفسه في كيان `isolated` لا يرى شيئًا) · صلاحية كل دور ·
`verifyAudit(db)` في آخر كل اختبار.

الاختبارات المجاورة بعد التغيير (كلها تمر، لم أعدّل أيًّا منها):
`node --test tests/migrations.test.mjs tests/payables.test.mjs tests/invoices.test.mjs tests/compliance.test.mjs tests/access.test.mjs tests/static-modules.test.mjs tests/inbox.test.mjs` → 20/20
`node --test tests/ui-render.test.mjs tests/ledger.test.mjs tests/receivables.test.mjs` → 11/11
`npm run check` → 257 وحدة سليمة، بصمات المصادر مطابقة، التتبع 220 متطلبًا.
