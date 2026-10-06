# تسليم الربط — وصل الوحدات الجديدة بالمنصة

**المرجع:** `docs/implementation/WIRING-SPEC.md` (§1–§9)، وتسليمات `docs/implementation/handoff/*.md`، و`docs/implementation/handoff/approval-engine.md` (بنودها الخمسة التي أُضيفت إلى نطاقي أثناء العمل).
**النتيجة:** `npm test`: **652 اختبارًا، 652 ناجحًا، 0 فاشل**. `npm run check` ناجح. اختبار دخان HTTP حقيقي على المنفذ 3612: **288 طلب GET (72 مسارًا × 4 أدوار) بلا أي 500**. لم أعدّل أي اختبار مسجل ولا أي هجرة، ولم أُجرِ commit.

## 1. الملفات التي عدّلتها

| الملف | ماذا |
|---|---|
| `app/server.mjs` | 52 استيراد مساحة جديدًا، 32 ملفًا ثابتًا في القائمة البيضاء، مسار التحقق العام، محلِّل `costRate`، 72 مسار GET، مساران غير متزامنين، كتلة POST كاملة، بوابة الاستقبال، مؤقّتا الفوترة الدورية وطابور المهام، وحقل `details` في رد الخطأ |
| `app/static/operations.mjs` | 33 استيرادًا و**65 مفتاح `operationModules`** جديدًا (المجموع 104) |
| `app/inbox.mjs` | 34 استيرادًا، 22 مفتاح `DECISIONS`، 29 مفتاح `KINDS`، **43 سطر `SOURCES`** |
| `app/reports.mjs` | ضم `GOVERNANCE_REPORTS` إلى `REPORTS` (R02 وR03 وR05؛ المجموع 37 تقريرًا بلا تكرار مفاتيح) |
| `app/static/{equipment,resourcing,pr,tax-returns,profitability}-ui.mjs` | إصلاحات ربط صغرى (§5) |
| `app/reports-governance.mjs` | كلمتان في R05 (§4، البند 6) |
| `app/{routing,search,request-closure,workflow,service-cards,request-timeline,delegations}.mjs` و`app/static/{app,request-picker}.mjs` | بنود تسليم محرك الاعتماد (§6) |
| `docs/implementation/NAV-PLAN.md` | خطة التنقل (لم تُنفَّذ) |

لم ألمس: `app/static/hr-design.mjs` ولا `signature.*` ولا أي CSS ولا `index.html` ولا `app/service-catalog.mjs` ولا وحدات الخلفية التي يعملها وكيل الإصلاح الأمني (رُبطت كما هي)، ولا أي اختبار أو هجرة.

## 2. ما رُبط

### 2.1 المسارات (`server.mjs`)
- **قراءة:** 72 مسار GET جديدًا تغطي الوحدات الـ29 + المنسّق: المطابقة البنكية · الفوترة الدورية والاشتراكات · التنبؤ النقدي والإقفال والإطفاء · سجل العقود · النبض والتقدير والإعلانات (ومرفق الإعلان) · اللقاءات والتغذية الراجعة و360 (ودليل التقييم) · الأهداف والمخاطر والقرارات · الرئيسية ومراقبة الانتهاء · المؤثرون · استحقاق الإجازات والمزايا · الخطابات (ولوحة القوالب وطباعة الخطاب) · العلاقات العامة والمعدات (وQR وصورة الحركة) · الخصوصية وطلبات أصحاب البيانات · الإنتاج وأوراق الاستدعاء (والطباعة) · معدلات التكلفة والربحية · كشوف الوقت والموارد والسعة · جولات المراجعة ووسائطها · البحث · الضرائب (وتصدير CSV) · حماية الأجور والمطابقة والشذوذ · الحِزم وإخلاء الطرف · الفوترة الإلكترونية والفحص الذاتي · استقبال الطلب · الخط الزمني والإغلاق والتجربة والقياس · المعرفة والسياسات ومراجعة الصلاحيات · الفرص والتقديرات · الطابور والأعلام وحوكمة المساعدين وتقييماتها · جودة الحقول · الحالات والتعويضات والقوى العاملة · الصرف الإعلامي وتقارير العملاء (والطباعة) · إعدادات مسارات الاعتماد.
- **كتابة:** كتلة POST واحدة قبل `if(match)` بترتيب المواصفة: المسارات الخاصة قبل العامة في كل وحدة (`amendments/` و`obligations/` قبل مسار العقد، `vat/boxes` قبل مسار الورقة، `annotations/` و`notices/` و`media/` قبل `/:id/`، `anonymous*` و`targets` قبل مسار الحالة، `price-cards` و`to-quote` قبل مسار التقدير، `entries` قبل `cancel_schedule`، `reminders/read` و`lock` و`lock-window` قبل قرار الكشف، `flagRetire` قبل `flagUpdate`).
- **غير متزامن (خارج المعاملة):** `POST /api/einvoice/submissions/:id/(attempt|status)` و`POST /api/ai-evals/suites/:id/run`، بجوار `assistantRun`.
- **`once`:** طُبّق حيث ترسل الواجهة `Idempotency-Key` فقط، وبالتغليف حيث لا تعيد الدالة `id` (الإطفاء، التسوية، الوسم، القفل والتذكير، النشاط والقاعدة في الخصوصية، مقاييس الاستقبال، الإغلاق والتجربة، فجوة الحقل)، وبالتفريع الشرطي في `expiry/settings/:doc_kind` و`privacy/activities` و`privacy/retention` (مفتاح عند الإنشاء فقط).
- **المؤقّتات (خارج أي معاملة، بعد مؤقّت التقارير):** `billingRecurring.runDueSchedules` كل 15 دقيقة، و`jobs.runDue` كل دقيقة، كلاهما `try/catch` و`unref()`.

### 2.2 الشاشات
65 مفتاحًا جديدًا في `operationModules` (48 من §1.4 + 16 من §9.8 + `approval-settings`)، و32 ملفًا ثابتًا في القائمة البيضاء. اختبار `tests/static-modules.test.mjs` يمر: كل ملف تستورده الواجهة يقدّمه الخادم.

### 2.3 «بانتظار قراري»
43 مصدرًا جديدًا في `SOURCES`، و22 فعلًا في `DECISIONS`، و29 مفتاحًا في `KINDS`. **مفتاح كل مصدر هو مفتاح شاشته المسجلة**، فرابط البند `#<key>` يفتح الشاشة التي يُتخذ فيها القرار. المصادر التي تمرَّر جزئيًا عمدًا (§6.3): الخصوصية · الموارد · اللقاءات الفردية · حماية الأجور · مطابقة الأجور.

### 2.4 بوابة الاستقبال (`request-intake`) — مفعّلة فعلًا
في `server.mjs` داخل فرع `/api/requests/:id/(submit|return|…)`:
1. عند `submit`، وبعد التأكد أن `wf.actions(...)` تعطي `submit` للمستخدم (وإلا فليرد `transition` برفضه المعتاد)، يُستدعى `requestIntake.submissionGate`.
2. إن بقي مانع **من موانع الاستقبال** يُرد **409 `intake_blocked`** مع `error.details.blocking` و`error.details.advisory`.
3. بعد التقديم الناجح: `requestIntake.freezeIntake(db,u,id)`.
4. بعد الإعادة الناجحة: `requestIntake.thawIntakeOnReturn(db,u.tenant_id,id)`.

تحقّق حي على المنفذ 3612 (الناتج حرفيًا):
```
service HR-LETTER [ [ 'purpose', 'textarea', true ], [ 'recipient', 'text', true ] ]
create 201 949cdeed-d929-47fe-8bfe-420ca7e43a82
intake GET 200 configured= false gate.ready= true
submit (legacy, no intake) 201 pending
intake save 201 [ 'cost_without_justification' ]
submit (blocked) 409 intake_blocked [ 'cost_without_justification' ]
submit (after fix) 201 pending
frozen_at set
submit 201 pending frozen= set
return by manager 201 returned
after return: status returned frozen= null editable= true
```

### 2.5 المسار العام `/verify/letter/:code`
بلا جلسة، GET فقط (غيرها 405)، وحدّ معدل في الذاكرة لكل عنوان IP: **30 طلبًا في الدقيقة**، ثم 429 مع `Retry-After`. العدّاد داخل `createApp` فلا يتسرب بين النسخ، ويُنظَّف عند تجاوز 10,000 مدخل. لا يُعاد إلا ما تعيده `letters.verifyLetter`، ورمز غير صالح يلقى الرد نفسه («لا يوجد خطاب ساري») فلا يميّز المهاجم بين صيغة خاطئة ورمز غير موجود. الناتج حرفيًا:
```
verify (no session) 200 {"found":false,"statement":"لا يوجد خطاب ساري بهذا الرمز."}
verify POST 405 method_not_allowed
rate limited responses out of 35: 6 retry-after 60
```

### 2.6 وسائط المراجعة الإبداعية
`GET /api/review-rounds/media/:id` بترويسات تخص هذا الرد وحده: النوع الحقيقي (المتحقَّق من توقيعه عند الرفع) · `X-Content-Type-Options: nosniff` · `Content-Disposition: inline` للصورة والفيديو وPDF و`attachment` لما عداها · `X-Frame-Options: SAMEORIGIN` و`frame-ancestors 'self'` و`frame-src 'self'` **لهذا المسار فقط**. تحقّق حي (مسار كامل ببيانات مصطنعة):
```
status 200 bytes 36
  content-type = image/png
  content-disposition = inline; filename="material"; filename*=UTF-8''shot.png
  x-content-type-options = nosniff
  x-frame-options = SAMEORIGIN
  content-security-policy = default-src 'none'; img-src 'self'; media-src 'self'; object-src 'self'; frame-src 'self'; style-src 'unsafe-inline'; frame-ancestors 'self'; base-uri 'none'; form-action 'none'
pdf 200 application/pdf | inline; … | SAMEORIGIN
audio 200 audio/mpeg | attachment; … | SAMEORIGIN
unknown media -> 404
```
ملاحظة صريحة: **لم أفتح متصفحًا**؛ لم يُختبر عرض PDF داخل `<iframe>` بصريًا، والمتحقَّق منه هو الترويسات والمحتوى.

## 3. ما لم يُربط ولماذا

| البند | لماذا |
|---|---|
| بوابة `clearanceBlockers` قبل اعتماد التسوية النهائية (§2.21) | المواصفة نفسها تقول إنها **تكسر `PAY-09` في `tests/payroll-extras.test.mjs`**، وتعديل الاختبار ممنوع، والقرار معلّق للمالك (§7 البند 23). الكتلة جاهزة في المواصفة سطرًا واحدًا متى تبنّاها المالك |
| دمج `anomaly.runAnomalies` في `GET /api/payroll` (§2.20) | وصفته المواصفة «اختياريًا»؛ يضيف حسابًا لكل مسير على كل فتح للشاشة وقد يرفع زمنها، ولا تطلبه أي واجهة اليوم |
| نقاط الوصل في `app/ai.mjs` (`knowledgeWarnings` و`assetGate` و`withRedaction`) | خارج ملفاتي الأربعة وخارج ما أُضيف إليها |
| `openFollowUps` في `app/home.mjs` وبطاقتها (§4) | `home.mjs` من وحدات وكيل الإصلاح الأمني |
| `proofFileAccess` في `app/files.mjs` و`'HR-LETTER':'letters'` في `SERVICE_MODULES` (§4) | الأول خارج نطاقي؛ والثاني صار مربوطًا فعلًا عبر `PENDING_SERVICE_MODULES` (§6) |
| إرشاد الحقول من request-quality في `wf.catalog` و`fieldInput` و`createService` (§9.5) | المواصفة تقول صراحة إنه **يكسر `tests/service-catalog.test.mjs`**؛ قرار مالك (§9.9 البند 45) |
| توجيه «إكمال» العام إلى `/api/request-closure/:id/close` (§9.1) | تعديل في `app.mjs` يغيّر سلوك إغلاق كل الطلبات؛ قرار مالك (§9.9 البند 41)، ومساراه مربوطان كلاهما |
| التنقل (`nav.push` و`groupedNavigation` و`allowed()`) | بتوجيه المنسّق: الخطة في `docs/implementation/NAV-PLAN.md` ويطبقها هو |
| بايت NUL في `app/estimates.mjs` (§9.3) | الملف خارج ملفاتي؛ لا يمنع التشغيل (Node يقرؤه) لكنه يخفي صادراته عن `grep`. يُستبدل بهروب صريح متى فُتح الملف |

## 4. كل انحراف عن المواصفة

1. **موانع البوابة المتروكة لـ`transition`:** لا يرد 409 عن `missing_field` و`missing_title`. السبب: `submissionGate` لا يحترم `fieldVisible`/`show_when` بينما `validatePayload` داخل `transition` يحترمه، فحقل مخفي بشرطه كان سيمنع تقديمًا يمر اليوم. النتيجة أن الطلبات القديمة تُقدَّم كما هي حرفيًا، والرسالة عن الحقل الناقص تبقى رسالة `transition` الأدق (`missing_field` باسم الحقل).
2. **`error.details`:** أُضيف حقل اختياري في رد الأخطاء (4xx فقط) ليحمل قائمة الموانع والتنبيهات. لم يكن في المواصفة، ولا يظهر في أي رد آخر.
3. **مصدرا الضرائب في الصندوق:** بدل سطر `['tax-returns',…]` الواحد (ومفتاحه ليس مفتاح شاشة)، سطران: `['vat-worksheet',…]` و`['withholding',…]`. السبب الذي ذكرته المواصفة نفسها (§2.19): رفض إحدى اللوحتين بـ403 كان يُسقط الأخرى، وإضافةً: الرابط الآن يفتح الشاشة الصحيحة.
4. **`KINDS`:** لم أضف `advances:'دفعة مقدمة'` من §1.7 لأن `advances` مفتاح قائم في `KINDS` («سلفة» لسلف الرواتب)؛ إضافته كانت ستعيد تسمية بنود الرواتب في الصندوق. مفتاح الدفعات المقدمة يبقى بلا وسم حتى يُسمّى اسمًا خاصًا.
5. **عدد المفاتيح:** §1.4 تقول «49 مفتاحًا» وهي 48، و§9.8 تقول «المجموع 65» وهو 64. المسجَّل فعلًا: 39 قائمًا + 64 جديدًا + `approval-settings` = **104**.
6. **`app/reports-governance.mjs`:** ضم R05 كان يُسقط اختبارًا مسجلًا (`tests/benefits.test.mjs`) لأن الاختبار يمنع ظهور «تابع» في أي تقرير حمايةً لبيانات التابعين، وعنوان R05 كان «قرارات الإدارة و**متابعة** أثرها». غيّرت كلمتين: العنوان صار «قرارات الإدارة وتتبّع أثرها»، والملاحظة «تتبّع الأثر هنا هو تتبّع الالتزامات الناشئة فقط». المعنى كما هو، والتقارير الثلاثة مضمومة.
7. **CSP رد الوسائط:** المواصفة اقترحت `default-src 'none'; frame-ancestors 'self'` فقط. أضفت `img-src`/`media-src`/`object-src`/`frame-src 'self'` و`style-src 'unsafe-inline'` لأن `default-src 'none'` وحده يمنع عارض الصور والـPDF في المتصفح من تحميل ما يعرضه، و`base-uri 'none'; form-action 'none'`.
8. **صيغة رمز التحقق:** المواصفة قيّدت المسار بـ`[23456789A-HJ-NP-Z]{12}`؛ استعملت `[^/]{1,64}` وتركت الحكم لـ`verifyLetter` (تفحص `^[0-9A-Z]{8,40}$`)، حتى لا يميز الرد بين «صيغة خاطئة» (كان سيصير 401 بعد `authenticate`) و«رمز غير موجود».

## 5. تعديلات ملفات `*-ui.mjs` (كلها الحد الأدنى لتعمل الوحدة)

| الملف | التعديل | لماذا |
|---|---|---|
| `profitability-ui.mjs` | نماذج `set_period` و`view_project` و`view_client` صارت `dynamicEndpoint` يبني `?from=&to=&project_id=` مع `toPayload:()=>undefined`، والمرشح يُحفظ في `sessionStorage` ويقرؤه `load` (نمط `search-ui`)، ومرشح لسجل لم يعد متاحًا يُمسح وتُحمَّل الصورة العامة | كانت تعلن `method:'GET'` وتعيد كائنًا، و`api()` يضع جسمًا لأي `data!==undefined` فيرمي `fetch` (GET بجسم). §8 البند 6 من المواصفة |
| `equipment-ui.mjs` | زر «حجز جديد» لا يظهر بلا مستلم عهدة ولا قطعة متاحة/طقم قابل للحجز | كان النموذج يرمي «الإجراء غير متاح» فيفشل `tests/ui-render.test.mjs` |
| `resourcing-ui.mjs` | زرّا «حجز جديد» و«عنصر نائب» لا يظهران بلا مشروع (زر السعة يبقى) | السبب نفسه |
| `pr-ui.mjs` | زر «تسجيل مراسلة» لا يظهر بلا جهة إعلامية في الدليل | السبب نفسه |
| `tax-returns-ui.mjs` | زر «تسجيل دفعة لغير مقيم» لا يظهر بلا نسبة مؤكدة، وتظهر مكانه الرسالة نفسها التي كان النموذج يرميها | السبب نفسه، مع بقاء الإرشاد ظاهرًا |

## 6. بنود تسليم محرك الاعتماد (أُضيفت إلى نطاقي)

1. **المسارات الخمسة:** `GET /api/approval-settings` · `POST /api/approval-settings/thresholds` (بمفتاح) · `/thresholds/:id/decide` · `/fallbacks` (يعيد `{removed:true}` عند الإزالة بدل `null`) · `/proposals/:key/adopt`. وسُجّل `approval-settings` في `operationModules` والقائمة البيضاء.
2. **`PENDING_SERVICE_MODULES`:** الوحدات الثماني صارت مسجلة، فصار `derived()` في `service-cards.mjs` يقرأ خريطة مدموجة `LINKED_MODULES` (عبر `serviceModulesFor` وقائمة الوحدات المسجلة بأسمائها). **لم أنقل المدخلات نصًا** لأن `tests/approval-engine.test.mjs` (مسجَّل) يشترط بقاء القائمتين منفصلتين وأن `SERVICE_MODULES['DIG-BUDGET-CHANGE']===undefined`. وصحّحت مفتاح شاشة الإنتاج في القائمة المعلقة من `production` إلى `productions` (المفتاح المسجَّل فعلًا)، ومعه اسمه في `MODULE_NAMES`. `tests/service-cards.test.mjs` و`tests/approval-engine.test.mjs` يمران.
3. **`routing.mjs`:** `executing` صار `isHandler(db,u,r)`، ومستقبِلو التحويل من `executorsFor(...)`، و`transferTargets` يصفّي الإدارات بوجود منفذ فعلي بدل مقارنة الدور نصًا. ومعها في `workflow.mjs`: `actions()` تعرض `transfer`/`assign_task` بـ`handler(...)` نفسها، فلا يظهر فعل سيرفضه `routing`.
4. **`search.mjs`:** شرط الطلبات صار `handler_role IN (?, 'member') OR ?='manager'` كما في `listRequests`. **`request-closure.mjs`:** إشعار إعادة الفتح يذهب إلى `executorsFor(...)` بدل استعلام الدور الحرفي.
5. **تسميات الخطوة الكائنية:** `request-timeline.mjs` (`stepLabel` عبر `normalizeStep` + اسم الإدارة + `executive` في خريطة الأسماء) · `app/static/request-picker.mjs` (`approvalTrail` والمسار المختصر يقرآن `{role,department,when}`، والخطوة المشروطة تُعلَّم «(بشرط)») · `app/delegations.mjs` (شاشة التفويض تعرض الخدمة التي خطوتها كائنية بدور المفوِّض) · `app/static/app.mjs` (تسمية الإشعار الجديد `ready_for_execution`: «طلب جاهز للتنفيذ»). لم ألمس التنقل في `app.mjs` ولا `hr-design.mjs` كما طلب المنسّق.

## 7. نتائج التحقق (حرفيًا)

### `node --check app/server.mjs`
بلا مخرجات (ناجح). وكذلك كل ملف عدّلته.

### `npm test`
```
ℹ tests 652
ℹ suites 0
ℹ pass 652
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 43235.862208
```
(قبل عملي كانت الحصيلة 640 اختبارًا بفشل واحد قائم في `LIFECYCLE` سببه وكلاء آخرون؛ ثم صارت 652 بعد وصول اختبارات محرك الاعتماد. الفشل الوحيد الذي أحدثه ربطي — `tests/benefits.test.mjs` عند ضم تقارير الحوكمة — عولج في §4 البند 6.)

### `npm run check`
```
Syntax checked: 359 JavaScript modules. Source hashes match. Traceability: 220 requirements / 22 domains.
Checks cover syntax, source integrity and traceability. No TypeScript compiler or production bundle is configured for this JavaScript build.
```

### اختبار الدخان (خادم على المنفذ 3612 بقاعدة تحقق مصطنعة وحدها)
بُنيت القاعدة بـ`scratchpad/build-verify.mjs` (كل الخطوات `ok`)، وشُغّلت نسخة `LOCAL_DB_PATH=<verify.sqlite> PORT=3612 node app/server.mjs` ثم أُوقفت. لم يُلمس المنفذ 3600 ولا 3611 ولا `work/`.

72 مسار GET جديدًا × 4 أدوار = **288 طلبًا، ولا 500 ولا 404 في أي منها**:

| الدور | 200 | 403 |
|---|---|---|
| admin | 45 | 27 |
| hr | 38 | 34 |
| manager | 39 | 33 |
| employee | 33 | 39 |

(الـ403 رفض صلاحية من الوحدات نفسها لا خلل ربط؛ القاعدة المصطنعة لا تمنح كل تصريح لكل دور.)

وبمعرّفات غير موجودة على 22 مسارًا ذا معرّف (وسائط المراجعة، طباعة الخطاب وورقة الاستدعاء وتقرير العميل، تصدير الضريبة، QR المعدات وصورتها، ملف الأجور، فترة الإقفال، الإطفاء، كشف الوقت، الحجز، الحالة، الخط الزمني، الإغلاق، التجربة، دليل التقييم، تسوية الاستحقاق، مشتري الفوترة، تقرير الشذوذ، فحوص الأجور، اقتراحات المطابقة): **404 أو 403، ولا 500**.

## 8. ما ينبغي أن يعرفه المنسّق قبل الدمج

1. **`home` صار وحدة مسجلة**، فيطغى على الفرع اليدوي في `app.mjs` (`operationModules[view]` يُفحص أولًا)، و`#home` هو المسار الافتراضي. يبقى الفرع لـ`requests` وحدها. التنظيف وتوحيد الاسم في NAV-PLAN §3.
2. **مؤقّتان جديدان يعملان عند تشغيل الخادم** (`node app/server.mjs`): الفوترة الدورية كل ربع ساعة وطابور المهام كل دقيقة. كلاهما يكتب في القاعدة المحلية. من يشغّل نسخة على قاعدة عرض ينتبه أن مسودات الفواتير ستُنشأ تلقائيًا.
3. **حد معدل التحقق في الذاكرة لكل نسخة خادم**، فلا يصمد أمام إعادة التشغيل ولا يوزَّع. كافٍ لإبطاء التخمين لا لصد هجوم، ولا يزال قرار المالك قائمًا على أثر تدقيقي لمسار التحقق (§7 البند 27 من المواصفة).
4. **قرارات المالك المعلّقة لم تتغير** (§7 و§9.9 من المواصفة). أضفت إليها ثلاثة يفرضها الربط: هل تُفعَّل بوابة الإخلاء قبل التسوية (تكسر اختبارًا)؛ وهل يُدمج فحص الشذوذ في شاشة الرواتب؛ وأي الشاشتين تبقى لكل زوج مكرر المعنى (`retainers`/الاشتراكات، `timesheets`/`time`، `feedback`/تقييم جودة الخدمة).
