# تسليم: request-transparency — الخط الزمني والإغلاق والتجربة وتنقيب العمليات

## 1. الملفات

أنشأتها كلها، ولم أعدّل أي ملف قائم.

| الملف | الغرض |
|---|---|
| `app/migrations/076-request-transparency.sql` | الهجرة (انظر 2) |
| `app/request-timeline.mjs` | الخط الزمني، وزمن المكوث، و«الخطوة التالية»، ولوحة «أين طلباتي» |
| `app/request-closure.mjs` | الإغلاق بدليل، وإعادة الفتح بجولة جديدة، ومهلة إعادة الفتح، ولوحة سلامة الإغلاق |
| `app/service-experience.mjs` | سؤال التجربة الواحد، والنتائج المجمّعة، والحد الأدنى |
| `app/process-insight.mjs` | تنقيب العمليات: المسارات، والاختناقات، وإعادة العمل، والالتزام بالمدة، ومحمّل الشاشة المجمّع |
| `app/insight-scope.mjs` | ملف صغير مشترك بين وحدتَي القياس: نطاق التصريح، وسطر «لا لوم على أشخاص». فصلته لتجنّب الاستيراد الدائري |
| `app/static/request-transparency-ui.mjs` | الواجهة: `myRequestTimelineUI` و`serviceInsightUI` |
| `tests/request-transparency-fixture.mjs` | مساعد الاختبارات (بيانات مصطنعة موسومة «تجريبي»، وقاعدة في الذاكرة فقط) |
| `tests/request-timeline.test.mjs` · `tests/request-closure.test.mjs` · `tests/service-experience.test.mjs` · `tests/process-insight.test.mjs` · `tests/request-transparency-ui.test.mjs` | الاختبارات |

## 2. الهجرة 076

- **`request_closures`**: سطر لكل جولة إغلاق، يحمل وصف ما سُلِّم (20 حرفًا على الأقل)، ومن أغلق، والإدارة المنفذة. الإضافة فقط، بلا تعديل ولا حذف. يمنع TRIGGER صاحبَ الطلب من إغلاق طلبه بنفسه.
- **`request_reopenings`**: جولة جديدة مرتبطة بإغلاق الجولة السابقة، ولا يُمحى الإغلاق الأول. تفرض TRIGGERs ثلاثة أمور: أن يعيد الفتحَ صاحبُ الطلب وحده، وأن تتبع الجولةُ إغلاقَ الجولة التي قبلها مباشرة (`round-1`)، وألا يُعدَّل السطر أو يُحذف. تُثبَّت المهلة وتاريخ انتهائها وقت إعادة الفتح.
- **`reopen_settings`**: مهلة إعادة الفتح بأيام العمل، لكل خدمة أو عامة (`scope_code='*'`)، ومعها السند وتاريخ التأكيد. لا يُعدَّل السطر، بل يُستبدل بسطر جديد مؤرَّخ. **لا قيمة افتراضية**: ما لم تُحدَّد المهلة فإعادة الفتح غير متاحة.
- **`experience_settings`**: الحد الأدنى لعدد الإجابات قبل عرض أي نتيجة مجمّعة. القيد `CHECK(3..50)`، ولا يُعدَّل السطر بل يُستبدل. **لا قيمة افتراضية**: ما لم يُحدَّد الحد لا تُعرض نتيجة مجمّعة.

الجداول الأربعة كلها بلا عمود `version`، لأنها إضافة فقط أو تُستبدل بسطر جديد، فلا يوجد سجل يُعدَّل. التحقق من `version` يجري على `requests.version` في كل فعل كتابة.

## 3. المسارات لربطها في `app/server.mjs`

كل المسارات تحت `/api`. أفعال الكتابة تُنفَّذ داخل `transaction(db,…)`، والدوال ترفض العمل خارج معاملة.

| الطريقة | المسار | الدالة | معاملة | Idempotency-Key |
|---|---|---|---|---|
| GET | `/api/my-request-timeline` | `myTimelineBoard(db,u)` من request-timeline | لا | لا |
| POST | `/api/request-timeline/:id/view` | `timeline(db,u,id)` (قراءة؛ POST لأن نمط `view` في `form` يرسل POST كما في `service-cards/:code/view`) | لا | لا |
| GET | `/api/request-timeline/:id` | `timeline(db,u,id)` (للربط من صفحة الطلب إن رغبت) | لا | لا |
| GET | `/api/service-insight` | `serviceInsightScreen(db,u,query)` من process-insight، و`query.service_code` اختياري | لا | لا |
| POST | `/api/request-closure/:id/close` | `closeWithEvidence(db,u,id,{version,delivered})` | نعم | نعم |
| POST | `/api/request-closure/:id/reopen` | `requestReopen(db,u,id,{version,reason})` | نعم | نعم |
| POST | `/api/request-closure/window` | `setReopenWindow(db,u,{scope_code,window_days,basis,confirmed_on})` | نعم | نعم |
| GET | `/api/request-closure/:id` | `closureView(db,u,id)` | لا | لا |
| POST | `/api/service-experience/:id/answer` | `answerExperience(db,u,id,{version,answer,comment})` | نعم | نعم |
| GET | `/api/service-experience/:id` | `experienceQuestion(db,u,id)` | لا | لا |
| POST | `/api/service-experience/threshold` | `setExperienceThreshold(db,u,{min_responses,basis,confirmed_on})` | نعم | نعم |

`closureBoard(db,u)` و`insightBoard(db,u,query)` و`experienceSummary(db,u,{group_by})` داخلة في `serviceInsightScreen`، ولا تحتاج مسارًا مستقلًا.

**توصية للمنسّق:** أن يُوجَّه زر «إكمال» في صفحة الطلب العامة (`transition(...,'complete')`) إلى `/api/request-closure/:id/close`. الطلب الذي يُغلق من المسار العام لا يُسجَّل له إغلاق بدليل، فلا يمكن إعادة فتحه (يرفضه الكود بـ`no_closure_record`)، ويظهر في لوحة «سلامة الإغلاق» تحت «بلا دليل مسجل».

## 4. الواجهة

- الملف `app/static/request-transparency-ui.mjs`. يُضاف `'request-transparency-ui'` إلى القائمة البيضاء في `server.mjs` (السطر 73).
- في `operationModules` بـ`app/static/operations.mjs`:
  - `'my-request-timeline': myRequestTimelineUI`، في مجموعة «الأساس / طلباتي»، ويُعرض لكل موظف.
  - `'service-insight': serviceInsightUI`، في مجموعة «القيادة». الشاشة نفسها تعرض لمن لا يملك التصريح أن لوحات القياس محجوبة عنه، وتُبقي له الإعدادات التي تخصه.
- لم أُضف أي صنف CSS جديد، واستعملت الأصناف القائمة فقط، ولا `style=""` ولا `<script>` ولا مورد خارجي.

## 5. صندوق «بانتظار قراري»

- **صاحب الطلب:** الطلبات المكتملة التي لها `actions` تتضمن `answer` (سؤال التجربة) أو `reopen` قبل انتهاء المهلة. المصدر `myTimelineBoard(...).rows`.
- **المنفّذ:** `myTimelineBoard(...).closable`، أي طلبات يباشرها وجاهزة للإغلاق بدليل، ومنها الجولات الثانية بعد إعادة الفتح.

## 6. ما لم أبنه، وما يحتاج قرارًا

- **التصريح:** لا مفاتيح محجوزة لي في `access.mjs`، فاستعملت مفاتيح قائمة ولم أضف شيئًا:
  - لوحات القياس ونتائج التجربة: `executive.view`. المنح المقيّد بإدارة يحصر اللوحة في تلك الإدارة.
  - الحد الأدنى والمهلة العامة: `catalog.manage`.
  - مهلة خدمة بعينها: مالك الإجراء المسمى في بطاقتها المنشورة (`service_cards.owner_id`).

  **قرار للمالك:** هل يرى مدير كل إدارة أرقام إدارته افتراضيًا؟ ذلك يحتاج منحًا مقيّدًا بالإدارة أو مفتاحًا جديدًا في `access.mjs`، والملف ملك المنسّق.
- **سؤال التجربة:** وجدت `app/service-feedback.mjs` موجودًا (تقييم من 1 إلى 5 في `request_feedback`)، **فبنيت عليه ولم أكرره**. تُخزَّن الخيارات الثلاثة في العمود القائم (نعم=5، جزئيًا=3، لا=1)، وتُقرأ التقييمات القديمة بتجميع صريح (4–5 نعم، 3 جزئيًا، 1–2 لا). حدّ ذلك أن الإجابة **مرة واحدة لكل طلب لا لكل جولة**: بعد إعادة الفتح تبقى الإجابة الأولى إن وُجدت. الإجابة لكل جولة تحتاج قرارًا من مالك وحدة التقييم، لأن جدولها مفتاحه `request_id` وغير قابل للتعديل. الشاشة القديمة في `service-quality-ui.mjs` (من 1 إلى 5) ما زالت تعمل، ويُستحسن أن يقرر المالك إبقاء واجهة واحدة.
- **القيم الغائبة عمدًا:** لا قيمة افتراضية لمهلة إعادة الفتح ولا للحد الأدنى. حتى يضعهما مالك الإجراء بسندهما، إعادة الفتح غير متاحة والنتائج المجمّعة محجوبة، وتقول الشاشة ذلك صراحة.
- **التعليقات في النتائج المجمّعة:** لا تُعرض إلا في مجموعة بلغت الحد الأدنى وفيها تعليقان على الأقل، بلا صاحب، ومرتبة أبجديًا لا زمنيًا حتى لا تُربط بطلب بعينه. يبقى خطر أن يكشف مضمونُ تعليق كاتبَه، وهذا لا يحله الكود.
- **الالتزام بالمدة** يُقاس على زمن الخدمة في الدليل (`service_directory.target_days`) لا على زمن الأولوية من `request-intake`. الأولوية لا تُحفظ مع الطلب زمنًا مجمّدًا يمكن القياس عليه، ولا يجوز لي تعديل وحدة الاستقبال.
- **سبب الارتداد** يُستنتج من الحقول التي تغيّرت بين النسخة المُعادة والنسخة التالية، لا من نص سبب الإرجاع. الطلب المُعاد الذي لم يُقدَّم ثانية لا يظهر له حقل.
- **العزل في الخط الزمني:** يرى صاحب الطلب قرار الاعتماد، ولا يرى نص ملاحظة الاعتماد، ولا سبب التحويل الداخلي، ولا المهام، ولا متابعات غيره. سبب الإرجاع والرفض يُعرض له لأنه موجّه إليه.
- **لا نسبة بطء لشخص:** لا يقرأ `process-insight.mjs` اسم أي مستخدم، ولا يجمّع على `actor_id` أو `approver_id` أو `assigned_to`. الاختبار يفحص ذلك في المخرجات وفي نص الكود. الاسم الوحيد في شاشة القياس هو اسم من وضع الإعداد، بجانب سنده، في قسم الإعدادات.

## 7. نتيجة الاختبارات

```
node --test tests/request-transparency-ui.test.mjs tests/request-timeline.test.mjs tests/request-closure.test.mjs tests/service-experience.test.mjs tests/process-insight.test.mjs
ℹ tests 16
ℹ pass 16
ℹ fail 0
```

الاختبارات القريبة، دون أي تعديل عليها:

```
node --test tests/service-quality.test.mjs tests/routing-portal.test.mjs tests/work-calendar.test.mjs tests/request-intake.test.mjs tests/service-cards.test.mjs tests/migrations.test.mjs tests/workflow-review.test.mjs tests/approvals.test.mjs tests/static-modules.test.mjs tests/ui-render.test.mjs
ℹ tests 29
ℹ pass 29
ℹ fail 0
```
