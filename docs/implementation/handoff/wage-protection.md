# تسليم: wage-protection

ثلاث وحدات: ملف حماية الأجور (مواصفة كبيانات + فحوص ما قبل التصدير)، والمطابقة الثلاثية للأجر، وكشف شذوذ المسير.
لا اتصال بأي جهة، ولا رفع آلي، ولا تصحيح آلي، ولا نسبة ولا عمود ولا عتبة مكتوبة في الكود. منطق احتساب الرواتب لم يُمس.

## 1. الملفات

أُنشئت (كلها جديدة؛ لم يُعدَّل أي ملف قائم ولا أي اختبار قائم ولا `app/access.mjs`):

| الملف | الغرض |
|---|---|
| `app/migrations/067-wage-protection.sql` | الهجرة المحجوزة |
| `app/wage-basis.mjs` | أساس مشترك صغير للوحدات الثلاث (التصاريح، مدى الشهر، حساب الراتب المتحقق منه، وثيقة الهوية، من هو على رأس العمل، سطور المسير). يقرأ ولا يكتب. أُنشئ لتفادي التكرار والاستيراد الدائري بين الوحدات الثلاث |
| `app/wage-protection.mjs` | مهمة أ |
| `app/wage-reconciliation.mjs` | مهمة ب |
| `app/payroll-anomaly.mjs` | مهمة ج |
| `app/static/wage-protection-ui.mjs` | يصدّر `wpsUI` و`wageReconciliationUI` و`payrollAnomalyUI` |
| `tests/wage-fixture.mjs` | بيئة مصطنعة مشتركة (على نمط `tests/budget-fixture.mjs`؛ لا يلتقطه `npm test` لأنه ليس `*.test.mjs`) |
| `tests/wage-protection.test.mjs` · `tests/wage-reconciliation.test.mjs` · `tests/payroll-anomaly.test.mjs` | اختبارات الوحدات الثلاث |
| `docs/implementation/handoff/wage-protection.md` | هذا الملف |

## 2. الهجرة 067 وجداولها

| الجدول | ما فيه | القيود المفروضة في SQL |
|---|---|---|
| `wps_file_formats` | مواصفة الملف كبيانات: `columns` (JSON: الاسم، الترتيب، الطول، النوع، الحقل المصدر، إلزامي، القيمة الثابتة، جهة التعبئة وحرفها)، `layout` (فاصل/أطوال ثابتة)، `delimiter`، `encoding`، `line_ending`، `include_header`، `spec_source` (مصدر المواصفة)، `spec_confirmed_on` (تاريخ تأكيدها لدى الجهة)، `recorded_by`/`confirmed_by`، `revision`، `version` | `CHECK(confirmed_by<>recorded_by)` · مسودة واحدة ونسخة سارية واحدة لكل بنك (فهرسان فريدان جزئيان) · `TRIGGER wps_formats_fixed`: التعريف لا يتغير بعد إدخاله إطلاقًا، والمؤكدة لا تنتقل إلا إلى «متقاعدة»، و`version` يزيد بواحد · لا حذف إلا لمسودة |
| `wps_exports` | سجل كل تصدير: المسير، المواصفة، عدد السطور، المجموع، بصمة الملف، صورة الفحوص وقت التصدير، ثم توثيق الرفع اليدوي (تاريخ، مرجع، ملاحظة، من وثّق) | `CHECK(total_minor=run_total_minor)` — قاعدة «مجموع الملف = مجموع المسير المعتمد» مفروضة في القاعدة أيضًا · `CHECK(upload_recorded_by<>exported_by)` · `TRIGGER`: البصمة والفحوص لا تتغير، والرفع يُوثق مرة واحدة · لا حذف |
| `wage_registrations` | الأجر المسجّل لدى الجهة: المبلغ، `registered_on` (تاريخ التسجيل لدى الجهة)، `source_note`، من أدخله، `superseded_by` | `CHECK(recorded_by<>user_id)` · إدخال سارٍ واحد لكل موظف (فهرس فريد جزئي) · `TRIGGER`: الإدخال يُستبدل ولا يُعدَّل · لا حذف · مفتاح `superseded_by` الأجنبي `DEFERRABLE INITIALLY DEFERRED` ليُوسم القديم قبل إدخال الجديد داخل المعاملة نفسها |
| `wage_difference_notes` | قرار الإنسان في الفرق: الأرقام الثلاثة ملتقطة من الخادم وقت الكتابة، `resolution` (طلب تعديل التسجيل / طلب تصحيح العقد / تفسير)، النص، من كتبه | `CHECK(recorded_by<>user_id)` · `TRIGGER` يمنع أي تعديل أو حذف |
| `payroll_anomaly_settings` | عتبات كشف الشذوذ لكل مستأجر: `variance_bp`، `variance_amount_minor`، `deduction_ratio_bp`، `overtime_factor_bp` — **كلها `NULL` افتراضيًا**، مع `basis` (السند) و`version` | `TRIGGER`: التحديث بزيادة `version` بواحد · لا حذف |

## 3. المسارات المطلوب ربطها في `app/server.mjs`

الاستيراد المقترح:
`import * as wps from './wage-protection.mjs'; import * as wageRecon from './wage-reconciliation.mjs'; import * as anomaly from './payroll-anomaly.mjs';`

كل الدوال تأخذ `(db,u,…)`. «معاملة» = داخل `transaction(db,…)` (دوال الكتابة ترفض بـ`transaction_required` دونها).

| الطريقة | المسار | الدالة | معاملة | Idempotency-Key |
|---|---|---|---|---|
| GET | `/api/wps` | `wps.wpsBoard(db,u)` | لا | لا |
| POST | `/api/wps/formats` | `wps.recordFileFormat(db,u,input)` → `{id}` | نعم | نعم |
| POST | `/api/wps/formats/:id/(confirm\|reject\|retire\|withdraw)` | `wps.decideFileFormat(db,u,id,decision,input)` — `input={version,note}` | نعم | لا (محمي بـ`version`) |
| GET | `/api/wps/runs/:runId/checks` | `wps.preExportChecks(db,u,runId)` (اختياري؛ اللوحة تحمل الفحوص أصلًا) | لا | لا |
| POST | `/api/wps/exports` | `wps.prepareWageFile(db,u,input)` — `input={run_id}` → `{id}` | نعم | نعم |
| GET | `/api/wps/exports/:id/file` | `wps.wageFileContent(db,u,id)` → `{filename,content}` | **نعم** (تكتب حدث تدقيق للتنزيل) | لا |
| POST | `/api/wps/exports/:id/record_upload` | `wps.recordManualUpload(db,u,id,input)` — `input={version,uploaded_on,reference,note}` | نعم | لا (محمي بـ`version`) |
| GET | `/api/wage-reconciliation` (واختياريًا `?month=YYYY-MM`) | `wageRecon.wageReconciliation(db,u,month??null)` | لا | لا |
| POST | `/api/wage-reconciliation/registrations` | `wageRecon.recordWageRegistration(db,u,input)` → `{id}` | نعم | نعم |
| POST | `/api/wage-reconciliation/notes` | `wageRecon.recordWageDifferenceNote(db,u,input)` → `{id}` | نعم | نعم |
| GET | `/api/payroll-anomaly` | `anomaly.anomalyBoard(db,u)` | لا | لا |
| GET | `/api/payroll-anomaly/runs/:runId` | `anomaly.runAnomalyReport(db,u,runId)` | لا | لا |
| POST | `/api/payroll-anomaly/thresholds` | `anomaly.saveAnomalySettings(db,u,input)` | نعم | لا (محمي بـ`version`) |

ملاحظات الربط:
- تنزيل الملف يُقدَّم كما يُقدَّم `/api/payroll/payments/:id/file` اليوم: `Content-Disposition: attachment` باسم `filename`. الامتداد `.csv` للفاصل و`.txt` للأطوال الثابتة؛ نوع المحتوى `text/plain; charset=utf-8` آمن للحالتين. معرّفات السجلات `UUID`، فنمط `([a-f0-9-]{36})` مناسب.
- **اقتراح دمج اختياري** (لا يحتاج تعديل `payroll.mjs`): في مسار `GET /api/payroll` القائم، إلى جانب `checks:preRunChecks(...)`، يمكن إضافة `anomalies:anomaly.runAnomalies(db,u.tenant_id,r)` ليرى المراجع والمعتمد النتائج على بطاقة المسير نفسها. الدالة نقية القراءة ولا ترمي لحامل تصريح رواتب.

## 4. مفاتيح `operationModules` والملف الثابت

- الملف الثابت للقائمة البيضاء: `wage-protection-ui` (أي `/wage-protection-ui.mjs`).
- `import { wpsUI, wageReconciliationUI, payrollAnomalyUI } from './wage-protection-ui.mjs';`
- المفاتيح: `wps:wpsUI` · `'wage-reconciliation':wageReconciliationUI` · `'payroll-anomaly':payrollAnomalyUI`.
- مجموعة التنقل: **خدمات الموظف / الرواتب**، بجوار `payroll` و`payroll-extras`. تظهر لمن يحمل أيًّا من `payroll.prepare` أو `payroll.review` أو `payroll.approve` (اللوحات الثلاث ترفض غيرهم بـ`403 not_permitted`).
- لم أضف أي CSS. استخدمت أصنافًا من القائمة المسموحة فقط، مع `table-wrap` ضمنيًا عبر حقل `rows` القائم في `operations.mjs`.

توزيع الأفعال على التصاريح القائمة (لم أضف تصريحًا):

| الفعل | التصريح | فصل المهام |
|---|---|---|
| إدخال مواصفة ملف / سحب مسودتها | `payroll.prepare` | — |
| تأكيد المواصفة / رفضها / تقاعدها | `payroll.approve` | من أدخلها لا يؤكدها (كود + `CHECK`) |
| تصدير ملف الأجور | `payroll.prepare` | — |
| توثيق الرفع اليدوي | `payroll.review` أو `payroll.approve` | من صدّر لا يوثق الرفع (كود + `CHECK`) |
| تسجيل الأجر المسجّل لدى الجهة | `payroll.prepare` | لا يسجل الموظف أجره (كود + `CHECK`) |
| قرار في فرق المطابقة | `payroll.review` أو `payroll.approve` | لا يقرر الموظف في فرق أجره (كود + `CHECK`) |
| تحديد عتبات الشذوذ | `payroll.approve` | — |

## 5. ما ينبغي أن يظهر في «بانتظار قراري»

- **مواصفة ملف بانتظار التأكيد:** صفوف `wpsBoard(db,u).formats` التي تحوي `confirm_format` في `actions` (لحامل `payroll.approve` غير مُدخلها).
- **ملف مصدَّر لم يُوثَّق رفعه:** صفوف `wpsBoard(db,u).exports` التي تحوي `record_upload` في `actions`.
- **فرق أجر بلا قرار مكتوب:** صفوف `wageReconciliation(db,u).rows` حيث `state==='different'` و`notes.length===0` و`actions` تحوي `record_difference`.
- نتائج كشف الشذوذ **لا** تدخل الصندوق: هي استشارية وتُعرض مع المسير، وليست قرارًا مستقلًا.

## 6. ما لم أبنه ولماذا، وما يحتاج قرارًا

**حدود صريحة في التصميم (معلنة في الشاشات):**
1. **رقم الهوية الكامل غير موجود في المنصة.** `app/employees.mjs` يرفض عمدًا تخزين أرقام الهوية/الإقامة كاملة ويحفظ مرجعًا مختصرًا. لذلك المصدر المتاح للعمود هو `identity_reference` فقط، والفحص `identity_not_stored` ينبّه عند استخدامه. إن كانت مواصفة الجهة تطلب الرقم الكامل (وهو المرجح) فالملف **لا يكتمل من المنصة وحدها**. **يحتاج قرار المالك:** إما تخزين الرقم كاملًا مشفّرًا (بـ`crypto-fields.mjs` كالآيبان) مع ما يترتب عليه في حماية البيانات، أو إكمال العمود خارج المنصة قبل الرفع. لم أغيّر سياسة `employees.mjs` من عندي.
2. **الترميز UTF-8 فقط** (مع BOM أو دونه). Node بلا تبعيات لا ينتج `windows-1256`؛ بدل ادعاء ذلك قيّدت القائمة وقالت الشاشة إن التحويل خارج المنصة.
3. **لا سطر رأس/تذييل للملف** (سجل إجمالي، عدد السطور، رقم المنشأة في سطر مستقل). بعض المواصفات تطلبه، ولم أخترع شكله. إن طلبته مواصفة المنشأة الفعلية يُضاف كقسمين `header_columns`/`trailer_columns` في التعريف نفسه بهجرة لاحقة.
4. **مصادر الأعمدة قائمة مغلقة** (`WPS_SOURCE_FIELDS`، 21 مصدرًا مما تعرفه المنصة فعلًا). عمود تطلبه الجهة ولا تعرفه المنصة يُترك `blank` أو يُدخل `constant`. هذه القائمة هي الكود الوحيد الذي يعرف «حقول المنصة»، وليست أعمدة الملف.
5. **«على رأس العمل» = حساب نشط بعقد يتقاطع مع الشهر**، وهو معيار المسير نفسه. موظف موقوف الحساب وله عقد غطى جزءًا من الشهر (شهر نهاية الخدمة) **تنبيه لا مانع**؛ من لا عقد له يغطي أي يوم من الشهر **مانع**.
6. **الصافي السالب مستحيل أصلًا** (`CHECK(net_minor>=0)` في `payroll_lines`، و`payroll.mjs` يرفضه عند الحساب)، فالفحص الفعلي على الصفر. «السبب المسجّل» = `variance_note` على السطر. **قيد معروف:** `payroll.mjs` لا يسمح بكتابة التبرير إلا لسطر عليه `variance_flag` وأثناء المراجعة فقط؛ فسطر صافيه صفر بلا علم فرق لا يمكن تبريره بعد الاعتماد، وسيبقى مانعًا. لم أعدّل `payroll.mjs` (ممنوع). **يحتاج قرار مالك إجراء الرواتب:** هل يُسمح بتبرير أي سطر صافيه صفر أثناء المراجعة؟
7. **العمل الإضافي يُقاس بالمبالغ لا بالساعات.** المسير يحمل حركة `overtime` بمبلغ معتمد، والساعات في `overtime_requests` بشاشة الحضور. قارنت مبلغ الشهر بأعلى شهر سابق للموظف في آخر 6 مسيرات معتمدة. ربط الساعات نفسها يحتاج قراءة `attendance-extras`، وتركته خارج النطاق.
8. **المطابقة تقارن الأجر الشهري الكامل** (مجموع بنود العقد كما طبقها المسير) لا المصروف المجزأ، حتى لا يظهر كل من باشر خلال الشهر فرقًا زائفًا؛ والمصروف الفعلي ونسبة الشهر معروضان بجانبه.
9. **لوحة المطابقة تعرض آخر شهر له مسير افتراضيًا.** اختيار شهر آخر مدعوم في الخلفية (`?month=`) لكن نمط `load:api=>api('/x')` لا يمرر معاملًا، فلا منتقي شهر في الواجهة. يحتاج دعمًا في `app/static/app.mjs` (ملف مشترك).
10. **لم أكتب في `REQUIREMENTS.json` ولا `STATUS.md` ولا `docs/traceability.json`** (ملفات المنسّق).

**يحتاج إدخالًا بشريًا قبل أي استخدام حقيقي:** مواصفة الملف الفعلية من حساب المنشأة، وأرقام الأجر المسجّل لدى التأمينات لكل موظف، وعتبات الشذوذ بسندها. المنصة لا تحمل أيًّا منها، والشاشات تقول ذلك.

## 7. نتيجة الاختبارات

`node --test tests/wage-protection.test.mjs tests/wage-reconciliation.test.mjs tests/payroll-anomaly.test.mjs`

```
✔ one bank account behind two employees is the loudest finding on the board, and no finding ever stops the run
✔ every rule is deterministic and either has a threshold its owner entered or says plainly that it is not running
✔ the wage file format is data the establishment account dictates: the recorder never confirms it, a confirmed definition is replaced by a new revision, and no column lives in the code
✔ pre-export checks catch before the upload what would be rejected after it, and tell apart what blocks the file from what only warns
✔ the manual upload is an admission a second person records once, because the platform neither uploads the file nor reads the authority reply
✔ the file is assembled from the definition alone: fixed widths, the declared delimiter, and cells a spreadsheet cannot read as formulas
✔ the three wages are compared side by side, the gap is shown with its size and ordered by the largest, and recording the authority number changes nothing else
✔ a gap is never closed by the platform: it waits for a written human decision, and that decision is kept with the numbers that were true when it was written
ℹ tests 8 · pass 8 · fail 0
```

التغطية المطلوبة: منع الاعتماد الذاتي (المواصفة، توثيق الرفع، تسجيل الأجر، قرار الفرق) · منع تعديل المعتمد (أربعة `TRIGGER` مختبرة بـ`UPDATE` مباشر) · تعارض `version` (المواصفة، الرفع، العتبات) · عزل `tenant` (المواصفات، سجل الأجور، تكرار الحسابات، موظف كيان آخر) · صلاحية كل دور (موظف بلا تصريح، مُعد، مراجع، معتمد) · `verifyAudit(db)` في آخر كل اختبار يكتب.

الاختبارات المجاورة بالاسم — لم ينكسر شيء:
`payroll` · `payroll-checks` · `payroll-extras` · `payroll-retro` · `hr-contracts` · `employees` · `migrations` · `static-modules` · `ui-render` · `access` → `tests 30 · pass 30 · fail 0`.

فحص إضافي غير محفوظ في المستودع: شغّلت الواجهات الثلاث على بيانات لوحات حقيقية للأدوار الثلاثة، وتأكدت من خلو المخرجات من `style=` و`<script` ومن تهريب نص المستخدم، ومن أن `toPayload` لكل نموذج يقبله الخادم فعلًا (إدخال مواصفة، تأكيدها، تسجيل أجر، حفظ العتبات مرتين بـ`version`). لم أشغّل `npm test` كاملًا ولا خادمًا، وفق العقد.
