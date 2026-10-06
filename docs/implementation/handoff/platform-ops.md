# تسليم وكيل `platform-ops`: طابور المهام، أعلام الميزات، حوكمة الذكاء الاصطناعي، حجب البيانات الشخصية

## 1. الملفات

أنشأتُ هذه الملفات فقط. لم أعدّل أي ملف قائم ولا أي اختبار قائم (قرأت `app/ai.mjs` و`app/report-schedules.mjs` و`app/access.mjs` دون تعديل).

| الملف | المحتوى |
| --- | --- |
| `app/migrations/069-platform-ops.sql` | 10 جداول بقيودها ومحفزاتها |
| `app/jobs.mjs` | طابور المهام الخلفية: `registerHandler` و`enqueue` و`runDue` و`claimNext` ولوحة المسؤول |
| `app/feature-flags.mjs` | أعلام الميزات: `flagOn` ولوحتها وأفعالها |
| `app/ai-governance.mjs` | جرد المساعدين وتقييم مخاطرهم و`assetGate` |
| `app/ai-evals.mjs` | حزمة التقييم بفحوص حتمية |
| `app/pii.mjs` | `redact` و`restore` و`redactionReport` و`withRedaction` |
| `app/static/platform-ops-ui.mjs` | `jobsUI` و`featureFlagsUI` و`aiGovernanceUI`، ومعها `platformOpsModules` |
| `tests/platform-ops-jobs.test.mjs` | 6 اختبارات |
| `tests/platform-ops-feature-flags.test.mjs` | 5 اختبارات |
| `tests/platform-ops-ai-governance.test.mjs` | 3 اختبارات |
| `tests/platform-ops-ai-evals.test.mjs` | 4 اختبارات |
| `tests/platform-ops-pii.test.mjs` | 6 اختبارات |
| `docs/implementation/handoff/platform-ops.md` | هذا الملف |

## 2. الهجرة 069 وجداولها

كل الجداول `STRICT`، ولكل جدول محفز `..._no_delete`.

| الجدول | أبرز ما يفرضه SQL |
| --- | --- |
| `jobs` | `UNIQUE(tenant_id,idempotency_key)` · `source_entity/source_id` إلزاميان (لا مهمة بلا فعل معتمد نشأت عنه) · `(status='running')=(locked_by IS NOT NULL)` · `jobs_fixed`: الإصدار يزيد واحدًا، والحمولة والنوع والمصدر ثابتة، و`done` و`cancelled` نهائيتان، و`dead` لا تخرج إلا إلى `queued` أو `cancelled`، و`done` لا تأتي إلا من `running` |
| `feature_flags` | `expires_on NOT NULL` بصيغة تاريخ · `UNIQUE(tenant_id,key)` · المسحوب مطفأ (`status='live' OR enabled=0`) · المحفز يمنع تغيير المفتاح وإحياء المسحوب |
| `feature_flag_targets` | أهداف نطاق «إدارة» أو «مستخدم» |
| `ai_assets` | `UNIQUE(tenant_id,assistant_key)` · CHECK: `active` يلزمه `owner_id` و`approved_assessment_id` و`next_review_on` · `ai_assets_guard`: **لا تفعيل إلا بتقييم معتمد لهذا المساعد، اعتمده غير مُعِدّه، ومالكه هو المالك المسجل** · الإدخال `proposed` فقط |
| `ai_asset_assessments` | CHECK: `decided_by<>prepared_by AND decided_by<>owner_id` · خروج البيانات من المملكة `0/1` إلزامي، و`1` يلزمه وصف النقل · تقييم واحد مفتوح لكل مساعد · المحفز يمنع تعديل التقييم بعد القرار؛ إعادة التقييم نسخة جديدة وتبقى القديمة |
| `eval_suites` | إصدار تفاؤلي · المساعد ثابت · حساب التقييم من الكيان نفسه |
| `eval_cases` | الحالة الذهبية لا تُعدَّل؛ تُسحب فقط (`retired_at`) |
| `eval_runs` | لا تحديث ولا حذف إطلاقًا (دليل حوكمة مؤرّخ) · `total=passed+failed+errors` · `previous_run_id` للمقارنة |

لا عمود «درجة ثقة» ولا نسبة أمان في أي جدول.

## 3. المسارات المطلوبة في `app/server.mjs`

كل الأفعال تحت `/api`، ومعرّفاتها UUID. لم أضف مسارًا لإنشاء مهمة في الطابور، وهذا مقصود (انظر §6).

| الطريقة | المسار | الدالة | داخل معاملة | `Idempotency-Key` |
| --- | --- | --- | --- | --- |
| GET | `/api/jobs` | `jobs.jobsBoard(db,u)` | لا | لا |
| POST | `/api/jobs/:id/retry` | `jobs.retryJob(db,u,id,input)` ← `{version,reason}` | نعم | لا |
| POST | `/api/jobs/:id/cancel` | `jobs.cancelJob(db,u,id,input)` ← `{version,reason}` | نعم | لا |
| GET | `/api/feature-flags` | `flags.flagsBoard(db,u)` | لا | لا |
| POST | `/api/feature-flags` | `flags.createFlag(db,u,input)` ← `{key,description,scope,targets,enabled,expires_on,reason}` | نعم | **نعم** (عبر `createOnce`) |
| POST | `/api/feature-flags/:id` | `flags.updateFlag(db,u,id,input)` ← `{version,description,scope,targets,enabled,expires_on,reason}` | نعم | لا |
| POST | `/api/feature-flags/:id/retire` | `flags.retireFlag(db,u,id,input)` ← `{version,reason}` | نعم | لا |
| GET | `/api/ai-governance` | `gov.aiGovernanceBoard(db,u)` | لا | لا |
| POST | `/api/ai-governance/seed` | `gov.seedInventory(db,u)` | نعم | لا (يتكرر بلا أثر مضاعف) |
| POST | `/api/ai-governance/assets/:id/assessments` | `gov.submitAssessment(db,u,id,input)` ← `{version,owner_id,data_categories,data_leaves_kingdom,transfer_note,risk_level,risk_notes,mitigations}` | نعم | لا |
| POST | `/api/ai-governance/assessments/:id/decide` | `gov.decideAssessment(db,u,id,input)` ← `{decision:'approve'|'return',note,next_review_on}` | نعم | لا |
| POST | `/api/ai-governance/assets/:id/activate` | `gov.activateAsset(db,u,id,input)` ← `{version,reason}` | نعم | لا |
| POST | `/api/ai-governance/assets/:id/suspend` | `gov.suspendAsset(db,u,id,input)` ← `{version,reason}` | نعم | لا |
| GET | `/api/ai-evals` | `evals.evalsBoard(db,u)` | لا | لا |
| POST | `/api/ai-evals/suites` | `evals.createSuite(db,u,input)` ← `{name,assistant_key,subject_user_id,description}` | نعم | **نعم** |
| POST | `/api/ai-evals/suites/:id/cases` | `evals.addCase(db,u,id,input)` ← `{version,title,input,checks,acceptance}` | نعم | لا |
| POST | `/api/ai-evals/cases/:id/retire` | `evals.retireCase(db,u,id,input)` ← `{version,reason}` | نعم | لا |
| POST | `/api/ai-evals/suites/:id/run` | `await evals.runSuite(db,u,id,input)` ← `{version}` | **لا**: غير متزامنة مثل `ai.runAssistant`، وتفتح معاملتها بنفسها | لا |

الدوال التي تأخذ `today` معاملًا أخيرًا (`flagsBoard` و`createFlag` و`updateFlag` و`aiGovernanceBoard` و`decideAssessment` و`activateAsset` و`assetGate`) تُستدعى من الخادم بدونه، فتأخذ تاريخ الرياض الحالي.

### مؤقّت الطابور
أضف بجانب مؤقّت `runDueSchedules` (السطر ~533):
`const drain=()=>{try{const r=jobs.runDue(db,{worker:\`server-${process.pid}\`});if(r.length)console.log(\`Jobs: ${r.length}\`);}catch(error){console.error('Jobs failed:',error.message);}};`
ويُستدعى كل دقيقة مثلًا. `runDue` تفتح معاملاتها بنفسها، فلا تُستدعى داخل معاملة.

### نقطتا الوصل في `app/ai.mjs` (لم أعدّله)
1. **الجرد**، في `runAssistant` بعد `if(!assistant)…` وقبل `prepare`:
   `const gate=assetGate(db,u.tenant_id,key);if(flagOn(db,u,'ai.asset_gate')&&!gate.allowed)fail(503,'ai_not_inventoried',gate.reason);`
   أقترح ربطها خلف العلم `ai.asset_gate` حتى يكتمل الجرد، وإلا تتوقف المساعدات كلها يوم الربط. وبعد اكتمال الجرد يُحذف شرط العلم ويُسحب العلم.
2. **الحجب**، في `provider()`: تُلفّ كلتا القيمتين المرجعتين بـ`withRedaction(...)`، أي المزوّد المحقون والمزوّد الحقيقي. هكذا يُحجب نص المستخدم قبل الإرسال وتُعاد القيم في الناتج. يبقى قرار للمنسّق: هل يُحفظ في `ai_runs.output` الناتج بعد إعادة القيم أم قبلها؟ حفظه قبلها يعني أن صاحبه يرى البدائل بدل القيم.

## 4. مفاتيح `operationModules`

- الملف الثابت للقائمة البيضاء: `platform-ops-ui`.
- الاستيراد: `import { jobsUI, featureFlagsUI, aiGovernanceUI } from './platform-ops-ui.mjs';`
- المفاتيح: `jobs:jobsUI` و`'feature-flags':featureFlagsUI` و`'ai-governance':aiGovernanceUI`. والكائن `platformOpsModules` يجمعها جاهزة للدمج.
- مجموعة التنقل: **إدارة المنصة**. تظهر `jobs` و`feature-flags` لمن يحمل `platform.flags`، و`ai-governance` لمن يحمل `ai.govern` أو يملك مساعدًا مجرودًا.
- أصناف CSS: استعملت القائم فقط (`panel` و`vn-*` و`badge` و`is-*` و`detail-data` و`operation-actions` و`subtle` و`muted`). لا حاجة لصنف جديد. عرض الحمولة للمهمة الميتة في `<pre>` داخل `<details>`.

## 5. صندوق «بانتظار قراري»

- `aiGovernanceBoard(db,u).awaiting_me`: تقييمات مخاطر تنتظر قرار حامل `ai.govern` ليس مُعِدّها ولا المالك المسمى فيها. الشكل `{id,title,actions:['decide_assessment']}`، ومفتاح مقترح `ai-governance`.
- المهام الميتة (`jobsBoard(...).dead`) تنبيه لمسؤول المنصة أكثر منها قرارًا. أقترح إظهار عددها في الصندوق لحامل `platform.flags`.

## 6. ما لم أبنه، ولماذا، وما يحتاج قرارًا

- **لا مسار HTTP لإنشاء مهمة ولا معالج مسجل بعد.** `enqueue` تُستدعى من وحدة أخرى داخل معاملة فعلها المعتمد. والطابور لا يقرر شيئًا. المعالج الذي يكتب في سجل مالي أو موارد بشرية يُرفض تسجيله دون `authorise(db,job)`، وهي دالة تتحقق وقت التنفيذ أن الفعل المعتمد ما زال ساريًا. إن لم يعد ساريًا تموت المهمة دون أثر.
- **المعالجات متزامنة وتكتب في القاعدة فقط**، وأثرها وعلامة `done` في معاملة واحدة. لا شيء في الطابور يرسل خارج المنصة، لأن الأثر الخارجي لا تحميه المعاملة.
- **لم أنقل `report-schedules.mjs` إلى الطابور.** نقله قرار للمنسّق: يُسجَّل `report.snapshot` معالجًا، ويُستبدل المؤقت الخاص.
- **قيم تقنية لا نظامية**: التراجع الأسي يبدأ من 30 ثانية ويبلغ ساعة حدًا أقصى، والمحاولات 5 افتراضيًا ويُسمح بـ1 إلى 20، والقفل 5 دقائق. للعلم أفق أقصى 180 يومًا، والتنبيه قبل انتهائه بـ14 يومًا. يمكن تغيير أي منها بقرار المالك.
- **حجب البيانات الشخصية جزئي**: **الأسماء العربية لا تُكشف بالأنماط** وتمر كما هي، وكذلك العناوين والأوصاف المعرِّفة. `redactionReport` يقول ذلك صراحة. الحل الحقيقي تقليل ما يُرسل إلى المزوّد.
- **خريطة الحجب في الذاكرة فقط**: `RedactionMap.toJSON` ترمي خطأ حتى لا تُخزَّن سهوًا. القيمة نفسها بصيغ متعددة (مثلًا `05…` و`+9665…`) تأخذ بديلًا واحدًا، وتعود بصيغتها الأولى.
- **فئات البيانات المقترحة لكل مساعد** وتلميح «خروج البيانات» مشتقان من قراءة `ai.mjs`، الذي يستدعي `api.anthropic.com`. لم يعتمدهما أحد. **الإجابة عن مقر المعالجة تحتاج مالك إجراء يملك عقد المزوّد.** لا أدّعي أن البيانات تبقى في المملكة.
- **تشغيل حزمة التقييم** يمر بـ`runAssistant` نفسه بحساب تقييم يسمّيه المسؤول، فيخضع لحدود المساعدين وسقوفهم ويُسجَّل في `ai_runs` باسم ذلك الحساب. ويكلف ما يكلفه التشغيل العادي إن كان المزوّد مهيأ. يلزم قرار المالك بإنشاء حساب تقييم تجريبي مخصص. لا يُحفظ نص الناتج، بل بصمته ونتائج الفحوص.
- **الفحوص لا تقيس صحة المعنى** ولا جودة الصياغة، وذلك مراجعة بشرية. و«الاستشهاد» يعني أن الناتج يذكر عنوان مصدر أو رمزه، فمساعد مصدره نص ملصوق (`brief_gaps`) لا يجتاز فحص الاستشهاد بطبيعته.
- **مراجعة الجرد المتأخرة** تنبيه ولا توقف مساعدًا مُفعَّلًا، لكنها تمنع إعادة تفعيل مساعد موقوف حتى يُعتمد تقييم جديد. أما إيقاف المُفعَّل عند التأخر فقرار مالك.
- لم أبنِ إدراج مساعد يدوي خارج `ASSISTANTS` (العمود `origin='manual'` جاهز له).
- `ai.govern` و`platform.flags` تصريحان إداريان. الأدمن الأول يملكهما ضمنًا، واعتماد التقييم يحتاج حاملًا ثانيًا غير المُعِدّ. في البيانات التجريبية أدمن واحد، فعلى المالك منح `ai.govern` لأدمن ثانٍ قبل أي اعتماد.

## 7. نتيجة الاختبارات

`node --test tests/platform-ops-*.test.mjs`:

```
ℹ tests 24
ℹ pass 24
ℹ fail 0
```

وللتأكد من عدم كسر المجاور: `node --test tests/ai.test.mjs tests/access.test.mjs tests/report-schedules.test.mjs tests/service-cards.test.mjs`:

```
ℹ tests 15
ℹ pass 15
ℹ fail 0
```

`node --check` نجح على الملفات الستة، ولا يرد في أي منها النص `eval(` الذي يرفضه `scripts/check.mjs`. لم أشغّل `npm test` كاملًا ولا `npm run check`، التزامًا بالعقد.
