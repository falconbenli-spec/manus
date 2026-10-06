# تسليم وحدة `einvoice-gateway` — طبقة الفوترة الإلكترونية القابلة للتوصيل

**الحالة بصدق: غير مربوط. المرحلة الأولى فقط. الربط يحتاج قرار المالك واعتماد المختص الضريبي.**
لم أتصل بأي جهة، ولم أكتب مواصفة جهة، ولم أدّعِ امتثالًا في أي نص أو شاشة. المبني طبقة تجعل الربط لاحقًا «مزوّدًا جديدًا يُحقن» بدل إعادة بناء دورة الفاتورة.

## 1. الملفات

أنشأت (ولم أعدّل أي ملف قائم):

- `app/migrations/070-einvoice-gateway.sql` — هجرتي المحجوزة. **طُبّقت على القاعدة المحلية الحية؛ لم تُعدَّل بعد تطبيقها.** أي تصحيح لاحق في المخطط يكون بالهجرة 077 كما حدد المنسّق. لم أحتج 077.
- `app/einvoice-gateway.mjs` — العقد المجرّد والمزوّد `disconnected` واللوحة وأفعال الطابور وفحص المشتري.
- `app/einvoice-selfcheck.mjs` — مراجعة «الوظائف المحظورة» بالكود.
- `app/static/einvoice-ui.mjs` — شاشتان: `einvoiceUI` و`einvoiceSelfcheckUI`.
- `tests/einvoice-gateway.test.mjs` (9 اختبارات) · `tests/einvoice-selfcheck.test.mjs` (4 اختبارات) · `tests/einvoice-fixture.mjs` (تجهيز مشترك بينهما، على نمط `tests/budget-fixture.mjs`).

لم ألمس `app/invoices.mjs` ولا `tests/invoices.test.mjs` ولا `app/access.mjs` ولا `app/server.mjs` ولا `app/static/operations.mjs` ولا أي هجرة أخرى ولا `.env`. لا CSS جديد، ولا `style=""` ولا `<script>`. لا حزمة جديدة.

## 2. الهجرة 070 وجداولها

| الجدول | ما فيه | ما يحميه في SQL |
|---|---|---|
| `einvoice_counters` | آخر رقم متسلسل لكل (كيان، نوع) وآخر مستند أخذه. | `einvoice_counter_never_resets`: يزيد واحدًا واحدًا فقط. `einvoice_counter_no_delete`: لا يُمسح. |
| `einvoice_archive` | نسخة كل مستند صادر بصيغة `platform-json-v1` مع بصمته وبصمة سابقه ورمز QR. | لا `UPDATE` ولا `DELETE`. `einvoice_archive_issued_only`: لا يدخله إلا مستند صادر ببصمته ورقمه كما صدر. `CHECK` يلزم الإشعار بمرجع أصله. |
| `einvoice_submissions` | طابور الإرسال: القناة، الحالة (`queued` `sent` `accepted` `accepted_with_warnings` `rejected` `failed`)، عدد المحاولات، موعد التالية، **سبب مكتوب إلزامي**، `version`. | `einvoice_submission_flow`: آلة حالات، القرار النهائي مقفل، السبب يتغير مع كل حالة، القناة لا تُغيَّر بعد تحديدها، **ومن حدد القناة لا يُجري المحاولة**. `einvoice_submission_buyer_guard`: لا محاولة لمشتر ناقص البيانات بلا تجاوز موثّق. لا `DELETE`. |
| `einvoice_attempts` | سطر لكل استدعاء للبوابة: العملية، المزوّد، النتيجة، الرسالة، الفاعل. | لا `UPDATE` ولا `DELETE`. |
| `einvoice_buyer_overrides` | تجاوز نقص بيانات المشتري: العميل، الناقص، السبب (20 حرفًا فأكثر)، صاحبه. | لا `UPDATE` ولا `DELETE`. |

محفّزات على `tax_invoices` (دون تعديل جدوله ولا كوده):

- `einvoice_sequence_monotonic` + `einvoice_sequence_advance`: كل رقم يُمنح يمر بالعدّاد؛ لا فجوة ولا إعادة استخدام ولا رجوع.
- `einvoice_chain_link`: بصمة السابق ورقم الحلقة يُفرضان عند الإصدار في SQL، لا في الكود وحده.
- `einvoice_issue_archives`: **الإصدار نفسه** يكتب نسخة الأرشيف ويفتح سجل الطابور، فلا يفلت مستند من أيهما ولا يحتاج `invoices.mjs` أي تعديل.
- تعبئة رجعية: ما صدر قبل الهجرة دخل العدّاد والأرشيف والطابور.

**لا عمود لمفتاح أو شهادة أو سر في أي جدول.** مكانها خزنة أسرار يقررها المالك عند الربط؛ المنصة لا تقرأ `.env` ولا تعرض سرًا.

## 3. المسارات التي يحتاجها المنسّق في `app/server.mjs`

```js
import * as einvoice from './einvoice-gateway.mjs';
import { einvoiceSelfcheck } from './einvoice-selfcheck.mjs';
```

| الطريقة | المسار | الدالة | معاملة؟ | `Idempotency-Key` |
|---|---|---|---|---|
| GET | `/api/einvoice` | `einvoice.einvoiceBoard(db,u)` | لا | — |
| GET | `/api/einvoice/selfcheck` | `einvoiceSelfcheck(db,u)` | لا | — |
| GET | `/api/einvoice/buyers/:caseId` | `einvoice.buyerReadiness(db,u,caseId)` — اختياري، اللوحة تعيده مضمّنًا | لا | — |
| POST | `/api/einvoice/submissions/:id/channel` | `einvoice.assignChannel(db,u,id,input)` — `{version,channel,reason}` | **نعم** | لا (`version`) |
| POST | `/api/einvoice/buyer-overrides` | `einvoice.recordBuyerOverride(db,u,input)` — `{case_id,reason}` | **نعم** | **نعم** |
| POST | `/api/einvoice/submissions/:id/attempt` | `await einvoice.attemptSubmission(db,u,id,input,transaction)` — `{version,note}` | **لا تغلّفها**: دالة `async` تستدعي المزوّد ثم تفتح معاملتها بنفسها، على نمط `runAssistant` في `app/ai.mjs` | لا (`version`) |
| POST | `/api/einvoice/submissions/:id/status` | `await einvoice.refreshSubmissionStatus(db,u,id,input,transaction)` — `{version,note}` | كالسابق | لا (`version`) |

كل المسارات تتطلب `einvoice.manage` وترمي 403 `not_permitted` بدونه. معرّفات الطابور UUID بنمط `[a-f0-9-]{36}` (تُولَّد في المحفّز).
`assertBuyerReady(db,u,caseId)` حارس جاهز (409 `buyer_incomplete`) يستطيع مالك دورة الفاتورة استدعاءه قبل `prepareInvoice` متى قرر المالك ذلك — انظر البند 6.

## 4. مفاتيح الوحدة في `operationModules`

- `einvoice` ← `einvoiceUI` · `einvoice-selfcheck` ← `einvoiceSelfcheckUI`
- `import { einvoiceUI, einvoiceSelfcheckUI } from './einvoice-ui.mjs';`
- القائمة البيضاء: `einvoice-ui.mjs` (يستورد `./dates.mjs` فقط، وهو مقدَّم أصلًا).
- مجموعة التنقّل: **المالية**، بجوار `invoices`. تظهر لحامل `einvoice.manage` فقط.
- `tests/ui-render.test.mjs` سيغطي الشاشتين تلقائيًا بعد إضافتهما. جرّبت العرض يدويًا على بيانات حقيقية من اللوحة: لا `style=` ولا `<script>`.

## 5. صندوق «بانتظار قراري»

لا شيء اليوم، عمدًا: لا يوجد فعل اعتماد معلّق على شخص بعينه، والطابور لا يرسل. عند الربط يُقترح عنصران: `einvoice_submission` بحالة `rejected` أو `failed` (يحتاج تصرفًا بشريًا)، ومستند في الطابور بلا قناة (`assign_channel`). كلاهما متاح من `einvoiceBoard(...).submissions[].actions`.

## 6. ما لم أبنه، وما يحتاج قرارًا

**سلوك الرفض — مقترح، يحتاج تأكيد المختص الضريبي، وليس محسومًا.**
المقترح: إذا رفضت جهة خارجية مستندًا صادرًا بعد الربط، يبقى المستند ورقمه وحلقته في السلسلة كما هي، وتُغلق محاولته بحالة «رُفض» وسببها المكتوب، ويُصحَّح الأثر بإشعار دائن ثم فاتورة جديدة تأخذ الرقم التالي؛ لا فجوة ولا إعادة ترقيم. ما هو **مفروض فعلًا اليوم في SQL**: الرقم لا يُسحب ولا يُعاد استخدامه، والعدّاد لا يرجع. **السؤال المفتوح:** هل يقبل المختص أن يبقى الرقم مستهلكًا لمستند مرفوض؟ لم أبنِ أي آلية إلغاء أو إعادة ترقيم، والنص نفسه معروض في الشاشة وفي `REJECTION_POLICY` بحالة `proposed`.
(الفاتورة التي يرفضها **المعتمد الداخلي** قبل الإصدار لا تأخذ رقمًا أصلًا — سلوك قائم في `invoices.mjs` ومختبَر، ولم أغيّره.)

- **لا مزوّد حقيقي، ولا مفاتيح، ولا شهادات، ولا عناوين جهة، ولا توقيع، ولا XML.** المزوّد الوحيد `disconnected` يرفض الاستدعاءات الثلاثة ويُسجَّل رفضه. `setGateway()` للاختبارات فقط.
- **فحص المشتري ليس موصولًا بـ`prepareInvoice`** لأن `app/invoices.mjs` خارج نطاقي، ولأن اختبارًا قائمًا يُصدر فاتورة بنسبة الصفر لعميل بلا رقم ضريبي (سلوك مقصود). المنع مفروض اليوم عند **حد البوابة** (كود + محفّز SQL): لا محاولة إرسال لمشتر ناقص بلا تجاوز موثّق. **قرار المالك:** هل يُستدعى `assertBuyerReady` قبل الإعداد أيضًا؟ تغيير سطر واحد عند مالك دورة الفاتورة.
- **حدود «اكتمال بيانات المشتري» غير معلومة يقينًا.** المنصة تفحص الرقم الضريبي وعناصر العنوان الخمسة وتعرض النقص؛ أي الفواتير يلزمها ذلك يحدده المختص. لذلك التجاوز ممكن وموثّق.
- **القناة (تصديق/إبلاغ) لا تستنتجها المنصة.** `tax_invoices` لا يحمل تصنيف «مبسّطة/ضريبية». يحددها إنسان بسببه، مرة واحدة.
- **الإشعار المدين غير موجود في المنصة أصلًا** (`kind` يقبل `invoice` و`credit_note` فقط في الهجرة 024). الإشعار الدائن يحمل مرجع أصله إلزامًا في المستند وفي الأرشيف. إضافة الإشعار المدين عمل على جدول الفواتير عند مالكه، بقرار المالك.
- **صيغة الأرشيف `platform-json-v1` صيغة المنصة**، وليست مواصفة جهة. عند الربط يُضاف تمثيل الجهة بجانبها بهجرة جديدة؛ الأرشيف الحالي لا يُمس.
- **التراجع الأسي** 5 دقائق تتضاعف حتى سقف 24 ساعة: تباعد تشغيلي، **ليس مهلة نظامية**. لا مجدول يعيد المحاولة تلقائيًا؛ المحاولة فعل بشري اليوم. لا نسبة ولا موعد حكومي في الكود.
- `reporting_status` في `tax_invoices` يبقى `not_reported` دائمًا (قيد `CHECK` في 024)؛ حالة الإرسال تعيش في الطابور وحده.

**نتائج الفحص الذاتي على الكود الحالي (أنفع ما في التسليم):**

| البند | الحكم | الدليل باختصار |
|---|---|---|
| حذف فاتورة | مستوفى | `tax_invoices_no_delete` + لا `DELETE` على الجدول في أي وحدة |
| تعديل فاتورة صادرة | مستوفى | `tax_invoices_fixed` + أرشيف مقفل |
| إعادة ضبط العدّاد أو فجوة | مستوفى | `tax_invoices_gapless` + الفهرس الفريد + محفّزات العدّاد |
| سلسلة البصمات | مستوفى | `einvoice_chain_link` + إعادة تشغيل `verifyInvoiceChain` |
| دخول مجهول / كلمة مرور افتراضية | مستوفى | `authenticate` (401) + scrypt بملح + لا كلمة مكتوبة في `auth.mjs` |
| إدارة الجلسات وانتهاؤها | مستوفى، **بحد معلن**: لا انتهاء بالخمول ولا حد للجلسات المتزامنة | `expires_at` + إلغاء عند تغيير كلمة المرور وسحب التصريح |
| إصدار بتاريخ ماضٍ | مستوفى | `issued_at` من ساعة الخادم، لا من الإدخال |
| تغيير تاريخ النظام | **لم يُتحقق منه** | ضابط على مستوى الخادم (NTP وصلاحيات النظام)، خارج المنصة — قرار المالك |
| تغطية سجل التدقيق | **غير مستوفى** | كل كتابة مسجّلة، لكن **القراءة والطباعة والتصدير لا تترك أثرًا** (`listInvoices` و`getInvoice`) — فجوة حقيقية |
| أسرار مخزّنة | مستوفى | لا أعمدة أسرار + المزوّد `disconnected` |
| إفلات مستند من الأرشيف/الطابور | مستوفى | الأرشفة بالمحفّز نفسه الذي يُصدر |

الفحص يُحسب من المخطط والكود الحيّين: اختبار يُسقط محفّزًا ويعبث بمستند فينقلب الحكم إلى «غير مستوفى». **لا يُعامل أي «مستوفى» شهادةَ توافق.**

## 7. نتيجة تشغيل الاختبارات

```
$ node --test tests/einvoice-gateway.test.mjs tests/einvoice-selfcheck.test.mjs
✔ the only built-in gateway is disconnected: it refuses all three calls, sends nothing, and says so
✔ issuing a document archives it and queues it in the same statement, and the archive can never be edited or deleted
✔ the counter never resets, never skips and never goes back, and the hash chain link is enforced by the database itself
✔ whoever classifies the channel never performs the attempt, the channel is fixed once set, and a stale version is refused
✔ today an attempt sends nothing: the refusal is logged with its reason and the next attempt backs off exponentially
✔ an injected gateway drives every queue state, a decision is final, and a rejected document keeps its number and its place in the counter
✔ a buyer with missing tax data blocks the attempt until a documented override is recorded, and the override is permanent
✔ a complete buyer needs no override, and a credit note is archived with the reference of its original invoice
✔ the screen needs the einvoice capability, and another tenant sees and touches nothing
✔ every control carries one of four verdicts and evidence from the code, and the report never claims compliance
✔ the verdicts match what the platform really does: deletion and counter reset fail, and what was not checked is not guessed
✔ the report is computed from the live schema: a removed guard or a tampered document turns its control to not met
✔ an injected gateway is reported as such, and the report needs the einvoice capability inside its own tenant
ℹ tests 13  ℹ pass 13  ℹ fail 0
```

الاختبارات القريبة بعد تغييري، دون تعديل أي منها:

```
$ node --test tests/invoices.test.mjs tests/migrations.test.mjs tests/receivables.test.mjs tests/billing-recurring.test.mjs \
    tests/tax-returns.test.mjs tests/print-documents.test.mjs tests/static-modules.test.mjs tests/seed-finance-demo.test.mjs \
    tests/access.test.mjs tests/security-regressions.test.mjs
ℹ tests 39  ℹ pass 39  ℹ fail 0

$ node scripts/check.mjs
Syntax checked: 304 JavaScript modules. Source hashes match. Traceability: 220 requirements / 22 domains.
```

لم أشغّل `npm test` كاملًا كما ينص عقد العمل.
