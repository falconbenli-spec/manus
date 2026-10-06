# تسليم hr-cases-comp

## 1. الملفات

أُنشئت (لم يُعدَّل أي ملف قائم):

- `app/migrations/068-hr-cases-compensation.sql`
- `app/hr-cases.mjs`
- `app/compensation.mjs`
- `app/workforce.mjs`
- `app/static/hr-cases-comp-ui.mjs`
- `tests/hr-cases.test.mjs` · `tests/compensation.test.mjs` · `tests/workforce.test.mjs`

قُرئت ولم تُعدَّل: `app/talent.mjs` و`app/hr-contracts.mjs` و`app/employees.mjs` و`app/access.mjs`.

## 2. الهجرة 068

| الجدول | الغرض والقيود |
|---|---|
| `hr_case_settings` | المدة المستهدفة لكل فئة (أيام عمل)، مؤرّخة وبأساسها. لا تعديل ولا حذف. لا قيمة افتراضية. |
| `hr_cases` | الحالة. CHECK: المسؤول ≠ المشكو منه، والمسؤول ≠ صاحب الحالة، وصاحب الحالة ≠ المشكو منه. صاحب الحالة لا يغلقها إلا سحبًا. TRIGGER: الحالة المغلقة لا تُعدَّل، وما رُفع (الوصف والفئة والأطراف) لا يُعاد كتابته، و`version` يلزم أن يزيد 1. |
| `hr_case_events` | كل ملاحظة ورد وقرار سطر بسببه (`visible_to_reporter` يفصل الداخلي). إلحاق فقط، ولا إدخال بعد الإغلاق. |
| `anonymous_reports` | البلاغ المجهول. **لا عمود يشير إلى المُبلِّغ**، و`token_hash` = sha256 للرمز، والتاريخ باليوم فقط (`received_on`). CHECK: المعالج ≠ المذكور. المغلق نهائي. |
| `anonymous_report_messages` | رسائل المتابعة. رسالة المُبلِّغ `author_id IS NULL` بقيد CHECK. |
| `salary_bands` | نطاق لكل فئة وظيفية (`job_categories` من الهجرة 053) ومستوى: أدنى ≤ أوسط ≤ أعلى، ومصدر مكتوب إلزامي، ونسخ مؤرّخة. CHECK: المعتمِد ≠ المُعِد. TRIGGER: المعتمد لا يُعدَّل. |
| `compensation_cycles` | الدورة السنوية بميزانية شهرية إجمالية ومصدرها. CHECK: من فتحها ≠ من أنشأها. الميزانية لا تتغير بعد الإنشاء، والمغلقة نهائية. |
| `compensation_proposals` | المقترح. CHECK: `proposed_by<>user_id` (لا يقترح أحد لنفسه) · المعتمِد ≠ المقترِح ≠ صاحب الزيادة · خارج النطاق أو بلا نطاق يلزمه `exception_note` ≥ 20 حرفًا ومعتمِد غير المقيّم. TRIGGER: مجموع المقترح الحي لا يتجاوز الميزانية (`compensation_proposals_budget`)، والإدخال في دورة مفتوحة فقط، والمقرر نهائي. |
| `compensation_recommendations` | ناتج الاعتماد: توصية بالراتب الشهري الجديد وتاريخ سريانه. لا تكتب في العقود. تُقفل بربط نسخة عقد جديدة أو بإسقاط مسبَّب. |
| `compensation_privacy_settings` | الحد الأدنى لحجم المجموعة في تحليل فجوة الأجر (3–500)، مؤرّخ وبأساسه، بلا قيمة افتراضية. |
| `employee_demographics` | جدول ملحق (لا تعديل على `users` ولا `employee_profiles`): `nationality_group` (سعودي/غير سعودي فقط) و`gender` اختياري و`source` (نوع الوثيقة بلا رقم). CHECK: المسجِّل ≠ صاحب السجل. |

الجنسية لم تكن مخزّنة في المنصة (`employees.mjs` يحفظ نوع الوثيقة فقط)، فأُضيف الجدول الملحق.

## 3. المسارات المطلوبة في `app/server.mjs`

كل دوال الكتابة تتحقق من `db.isTransaction`، فتُستدعى داخل `transaction`. «مفتاح» = `Idempotency-Key` عبر `once(...)`.

### حالات الموارد البشرية — `import * as hrCases from './hr-cases.mjs'`

| الطريقة | المسار | الدالة | معاملة | مفتاح |
|---|---|---|---|---|
| GET | `/api/hr-cases` | `hrCasesBoard(db,u)` | لا | — |
| GET | `/api/hr-cases/:id` | `getCase(db,u,id)` | لا | — |
| POST | `/api/hr-cases` | `fileCase(db,u,input)` | نعم | نعم `once(()=>…,id=>({id}))` |
| POST | `/api/hr-cases/targets` | `setCaseTarget(db,u,input)` | نعم | نعم |
| POST | `/api/hr-cases/:id/:action` | `caseAction(db,u,id,action,input)` — action ∈ `take_case,add_info,withdraw_case,note_case,reply_case,decide_case,reassign_case,close_case` | نعم | لا |
| POST | `/api/hr-cases/anonymous` | `submitAnonymousReport(db,u,input)` | نعم | **لا — ممنوع** |
| POST | `/api/hr-cases/anonymous/follow` | `followAnonymousReport(db,u,input)` | لا (قراءة) | لا |
| POST | `/api/hr-cases/anonymous/reply` | `replyAnonymousReport(db,u,input)` | نعم | **لا** |
| POST | `/api/hr-cases/anonymous/:id/:action` | `reportAction(db,u,id,action,input)` — action ∈ `take_report,reply_report,handover_report,close_report` | نعم | لا |

**تنبيه للمنسّق بخصوص البلاغ المجهول:** مسارات `anonymous` و`anonymous/follow` و`anonymous/reply` يجب ألا تمر بـ`once` (جدول `idempotency_keys` يحفظ `user_id` مع معرّف السجل)، وألا يُسجَّل جسم الطلب أو الرمز في أي سجل خادم، والرمز يُرسل في الجسم لا في URL. سطّر هذه المسارات قبل أي مسار عام من نمط `/api/hr-cases/:id/:action` حتى لا تُطابقه كلمة `anonymous`.

### مراجعة التعويضات — `import * as compensation from './compensation.mjs'`

| الطريقة | المسار | الدالة | معاملة | مفتاح |
|---|---|---|---|---|
| GET | `/api/compensation` | `compensationBoard(db,u)` | لا | — |
| POST | `/api/compensation/bands` | `prepareBand(db,u,input)` | نعم | نعم |
| POST | `/api/compensation/bands/:id/(approve\|reject)` | `decideBand(db,u,id,decision,input)` | نعم | لا |
| POST | `/api/compensation/cycles` | `createCompCycle(db,u,input)` | نعم | نعم |
| POST | `/api/compensation/cycles/:id/(open\|close)` | `compCycleAction(db,u,id,action,input)` | نعم | لا |
| POST | `/api/compensation/proposals` | `proposeIncrease(db,u,input)` | نعم | نعم |
| POST | `/api/compensation/proposals/:id/(assess\|approve\|reject\|withdraw)` | `proposalAction(db,u,id,action,input)` | نعم | لا |
| POST | `/api/compensation/recommendations/:id/(link\|drop)` | `recommendationAction(db,u,id,action,input)` | نعم | لا |
| POST | `/api/compensation/privacy` | `setGapPrivacy(db,u,input)` | نعم | نعم |

### تركيبة القوى العاملة — `import * as workforce from './workforce.mjs'`

| الطريقة | المسار | الدالة | معاملة | مفتاح |
|---|---|---|---|---|
| GET | `/api/workforce` (اختياري `?from=&to=`) | `workforceBoard(db,u,{from,to})` — مرّر فقط المعاملات الموجودة | لا | — |
| POST | `/api/workforce/simulate` | `simulateSaudization(db,u,input)` — قراءة فقط لا تكتب | لا | لا |
| POST | `/api/workforce/demographics/:userId` | `recordDemographics(db,u,userId,input)` | نعم | لا (مُتحقق بـ`version`) |

## 4. الواجهة

- الملف الثابت للقائمة البيضاء: `hr-cases-comp-ui` (`app/static/hr-cases-comp-ui.mjs`).
- الصادرات: `hrCasesUI` و`compensationUI` و`workforceUI`، ومعها `hrCasesCompModules` بالمفاتيح الثلاثة.
- في `operationModules`: `'hr-cases':hrCasesUI` · `compensation:compensationUI` · `workforce:workforceUI`.
- مجموعة التنقل: «خدمات الموظف». `hr-cases` لكل موظف (رفع الحالة والبلاغ المجهول متاحان للجميع). `compensation` لكل موظف (المدير يقترح لفريقه، والموظف يرى زيادته المعتمدة). `workforce` لحامل `hr.workforce.view` فقط (الخادم يرد 403 لغيره).
- الواجهة تستخدم الأصناف القائمة فقط بلا `style` ولا `script`. تستعمل `after` (المستخدم في `app.mjs`) لعرض رمز المتابعة مرة واحدة ونتيجة المتابعة والمحاكاة. لا أصناف CSS جديدة.

## 5. صندوق «بانتظار قراري»

- `hr-cases`: الحالات غير المسندة لحامل `hr.cases.handle` (`intake`)، والحالات المسندة إليه المتجاوزة `target_due_on`، والبلاغات المجهولة بحالة `received`. لا تعرض في الصندوق وصفًا ولا اسم صاحب الحالة.
- `compensation`: المقترحات `proposed` (تقييم النطاق) و`assessed` (قرار) لحامل `hr.compensation.review` ممن ليس المقترِح ولا صاحب الزيادة، والنطاقات `draft` لغير معدّها، والدورات `draft` لغير منشئها، والتوصيات `open` لحامل `hr.contracts.manage` عدا توصيته.

## 6. ما لم يُبنَ وما يحتاج قرارًا

- **«الاعتماد الأعلى» للمقترح خارج النطاق** نُفّذ هكذا: يعتمده حامل `hr.compensation.review` غير الذي قيّمه وكتب المبرر، ويلزم أن يحمل أيضًا `hr.contracts.approve`. يحتاج تأكيد مدير الموارد البشرية أو المالك أن هذا هو المستوى الأعلى المقصود.
- **نقطة الوصل مع العقود:** الاعتماد يُنشئ سطرًا في `compensation_recommendations` فقط. صاحب `hr.contracts.manage` يُعدّ نسخة العقد من المسار القائم `POST /api/hr/contracts/:id/amend` (`prepareContract(db,u,input,amendsId)`) ويعتمدها صاحب `hr.contracts.approve` كالمعتاد، ثم يربطها بـ`POST /api/compensation/recommendations/:id/link`. الربط يقبل نسخة للموظف نفسه أُنشئت بعد التوصية، ويعرض إن كان مبلغها يطابق التوصية. لا شيء في الوحدة يكتب في `employment_contracts`.
- **الراتب الحالي** لقطة من `employment_contracts.monthly_total_minor` للعقد الساري وقت الاقتراح. من لا عقد ساريًا له في المنصة لا يُقترح له.
- **المقترِح:** المدير المباشر لفريقه. من لا مدير نشطًا له يقترح له حامل `hr.compensation.review`. المدير لا يرى الراتب الحالي ولا النطاق ولا الميزانية المتبقية، ورسالة تجاوز الميزانية لا تذكر المتبقي.
- **النطاق المنطبق** يُختار من النطاقات المعتمدة السارية لفئة الموظف الوظيفية (`employee_job_categories`). الموظف بلا فئة يُقيَّم «بلا نطاق» بمبرر إلزامي. «المستوى» لا يُخزَّن للموظف في أي مكان، فيختاره المقيّم.
- **المعايرة** تُعرض (آخر درجة نهائية صادرة من `performance_reviews`) للاطلاع فقط. لا معادلة من الدرجة إلى نسبة زيادة، وعُلّق ذلك في الكود.
- **فجوة الأجر:** الوسيط الشهري حسب الجنس، للمنشأة كلها ولكل فئة وظيفية، ويُحجب كل تقسيم تقل فيه إحدى المجموعتين عن الحد الأدنى، مع عدده أيضًا. لا تحليل قبل تحديد الحد. الجنس اختياري في `employee_demographics`.
- **التوطين:** نسبة فقط، بالنص المطلوب حرفيًا، وتُحسب على من سُجلت جنسيتهم مع عرض عدد غير المسجلين. لا نطاق ولا لون ولا امتثال. المحاكاة لا تكتب. لا تحليل تنبؤي للاستقالات، وعُلّق ذلك في `app/workforce.mjs`.
- **الدوران:** المغادرة من `employee_changes` (`status→left` مطبَّق)، والالتحاق من `employee_profiles.join_date`. من لا ملف له يُستبعد من حساب الفترة ويُذكر عدده.
- **تسجيل الجنسية** لموظف دوره `hr` ويحمل `hr.workforce.view`. التصريح المحجوز «عرض»، فالحامل من غير الموارد البشرية يرى ولا يسجل. إن أراد المالك تصريح كتابة مستقلًا فهذا قرار في `access.mjs` خارج نطاقي.
- **الإحالة لجهة خارج الشركة** (مثل جهة رسمية) توثَّق يدويًا بنتيجة `referred`. لا إرسال ولا اتصال خارجي.
- **المدد المستهدفة** بلا قيم: يدخلها حامل `hr.cases.handle` بأساسها. الحالة المرفوعة قبل تحديد المدة لا يكون لها موعد مستهدف.
- لم تُبنَ إشعارات للحالات. أي إشعار يجب ألا يكشف الفئة أو الأطراف لغير صاحب الحالة والمسؤول.

## 7. نتيجة الاختبارات

```
node --test tests/hr-cases.test.mjs tests/compensation.test.mjs tests/workforce.test.mjs
✔ salary bands: entered with a written source, approved by someone other than the preparer, and never revised once approved
✔ compensation cycle: the budget is a hard ceiling in SQL, no one proposes for themselves, and only direct managers propose
✔ compensation confidentiality: a manager sees only their team’s proposals without salaries, and no one sees a proposal about themselves
✔ compensation decision: out-of-band needs a written case and a higher, different approver; the proposer never approves; approval changes no contract
✔ pay gap analysis: aggregate only, unavailable until a minimum group size is set, and small groups are suppressed with their counts
✔ hr case: the direct manager named in a complaint never sees it, and anyone outside the case gets 404 rather than 403
✔ hr case: a handler who is the subject of a complaint cannot see it, take it or receive it, in code and in SQL
✔ hr case: every decision carries its reason, internal notes stay internal, a stale version is refused, and a closed case is final
✔ anonymous report: no stored column or audit row can lead back to the reporter, and only the token holder can follow it
✔ workforce: saudization is a ratio from platform records with the mandated wording, and no band, colour or compliance level is computed
✔ workforce: the hire/leave simulation returns the ratio only, writes nothing and passes no compliance judgement
✔ workforce: joiners, leavers and turnover come from dated records, people without a profile are disclosed rather than guessed
✔ workforce: nationality is recorded by HR from a document, never by the employee, never with an ID number, with version checks and tenant isolation
ℹ tests 13
ℹ pass 13
ℹ fail 0
```

وشُغّلت الاختبارات القريبة بالاسم، وكلها ناجحة: `static-modules` (1) · `migrations` (1) · `hr-contracts` (5) · `talent` (4) · `engagement` (7) · `employees` (4) · `access` (7) · `benefits` (7) · `inbox` و`contracts-register` (5).
