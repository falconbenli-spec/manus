# تسليم محرك الاعتماد — تدقيق سير العمل B1–B9

**المرجع:** `docs/product/audits/WORKFLOW-AUDIT.md`، القسم 1.1 (B1–B9)، والإصلاحات 1 و3 و4 و10 و11، وقسم «ما يصلحه المنسّق تقنيًا».
**النتيجة:** `npm test` كاملًا: **652 اختبارًا، 652 ناجحًا، 0 فاشل**. كانت الحصيلة قبل التعديل 607 ناجحًا، والفرق اختباراتي الاثنا عشر واختبارات وكلاء آخرين أضيفت أثناء العمل. `npm run check` ناجح: فحص صياغة 359 وحدة، وبصمات المصادر مطابقة، والتتبع 220 متطلبًا في 22 مجالًا. لم يُعدَّل أي اختبار مسجل.

## 1. الملفات

عُدِّلت:
- `app/workflow.mjs`: نموذج الخطوة، وحل المعتمدين، والأعلام، والرؤية، والتنفيذ، والإعدادات.
- `app/service-catalog.mjs`: أعلام السرية، والمقترحات القابلة للتبني، و`catalogHealth`، و`approvalSettings`، و`HR-JOB-CHANGE`، ووصف `HR-GRIEVANCE`.
- `app/service-cards.mjs`: `SERVICE_MODULES` و`PENDING_SERVICE_MODULES`، وأسماء الخطوات الجديدة، والأعلام في البطاقة.

أُنشئت:
- `app/migrations/093-approval-engine.sql`
- `app/static/approval-settings-ui.mjs` (بمفتاح `approval-settings`، لم يُسجَّل بعد)
- `tests/approval-engine.test.mjs` (12 اختبارًا)
- هذا الملف

لم ألمس `server.mjs` ولا `access.mjs` ولا `request-intake.mjs` ولا `routing.mjs` ولا أي ملف آخر في `app/static/` ولا أي هجرة قائمة. لم أُجرِ commit.

**استيراد دائري مقصود:** `workflow.mjs` يستورد `escalationFor` من `service-catalog.mjs` (كما طُلب)، و`service-catalog.mjs` يستورد من `workflow.mjs`. هذا آمن لأن أيًّا من الوحدتين لا يستدعي الأخرى وقت التحميل، بل داخل الدوال فقط. من يضيف استدعاءً على المستوى الأعلى في أيٍّ منهما يكسر ذلك.

## 2. قيد حاسم: ما لم يُطبَّق تلقائيًا ولماذا

ثلاثة اختبارات مسجلة تمنع تطبيق بعض الأعلام على خدمات الكتالوج عند التثبيت:
- `CATALOG: every service … routes to its approvers` يشترط أن يكون كل طلب في الكتالوج `pending` بعد تقديمه.
- `REVIEW` (`scripts/workflow-review.mjs`) يرفض أي خدمة في الكتالوج بلا خطوة اعتماد.
- `LIFECYCLE` (`scripts/lifecycle-audit.mjs`) ينفذ كل خدمة بأول حساب بدور `handler_role`، وهو في أغلب الخدمات من اعتمدها. لذلك يكسره `sod`، ويكسره `member` لأن لا حساب بدور `member`.

لذلك **المسار المباشر (B2) وفصل المهام (B3) مقترحات تحتاج تبنّيًا مسجلًا**، وليست جزءًا من `catalogServices`:
- `policyProposals` في `service-catalog.mjs`: لكل مقترح `key` و`code` و`item` و`reason` ودالة `apply(policy)` تُطبَّق على سياسة الكتالوج الحالية، فيتبع المقترح أي تعديل لاحق لتعريف الخدمة.
- `adoptPolicyProposal(db,admin,key,{basis, withdraw?})` يعمل داخل معاملة ولمسؤول منصة يملك `catalog.manage`. يُنشئ نسخة خدمة جديدة ويكتب سجلًا إلحاقيًا في `approval_policy_adoptions` بالسند. `withdraw:true` يرجع عن المقترح.
- `installServiceCatalog` يطبق المقترحات المتبناة (`effectivePolicy`). لذلك لا تُلغي إعادة التثبيت تبنّيًا، ويبقى التثبيت الثاني بلا مراجعات جديدة (`revised:0`).

أما **السرية (B6)** فمطبقة مباشرة في الكتالوج، لأنها لا تغيّر المعتمد ولا المنفذ، والاختبارات المسجلة تمر بها.

## 3. ما تغيّر لكل بند

### B1: خطوات عابرة للإدارات وتدرج بالمبلغ
- الخطوة إما نص بالشكل القديم (`manager` و`department_manager` و`hr` و`it` و`pm`)، أو كائن `{role, department?, when?}`.
- `{role:'department_manager',department:'finance'}` يُحل إلى مدير المالية بالمنطق القديم نفسه: التوجيه المعيّن في `department_routing`، أو مدير وحيد، أو التصعيد إذا كان الطالب هو المدير. يصح `department` مع `hr` و`it` و`pm` كذلك.
- `{role:'executive', department?}` يُحل عبر `escalationFor(department)` (نائب القطاع أو الرئيس التنفيذي). إذا كان المعتمد الناتج هو الطالب أو المستفيد، يُصعَّد إلى الرئيس التنفيذي. إذا غاب الحساب يُستعمل مرجع التصعيد المسجل. ويتحقق `authorizedStep` عند القرار من أن المعتمد ما زال في الرئاسة.
- `when:{field,gte_setting}` يشترط حقلًا من نوع `number`، والحقل مكتوب بالريال بخانتين عشريتين. يُحوَّل المبلغ إلى هللات بعمليات نصية دون حساب عشري عائم (`toMinor`)، ويُقارن بالحد الساري للمفتاح.
- `when:{field,in:[…]}` و`when:{field,not_in:[…]}` شرطان على حقل اختيار، وقيمهما من خيارات الحقل نفسه. استعملته لبدل الفاقد في B2.
- **الحد لا يُكتب في الكود ولا في الخدمة.** `when:{gte:…}` مرفوض (`invalid_fields`). الحد سجل في `approval_thresholds`: المفتاح، والمبلغ بالهللات، والسند، وتاريخ السريان، ومن أدخله، ومن قرره. يُدخله من يملك `catalog.manage` (`proposeThreshold`). ويعتمده أو يرفضه شخص من الرئاسة (`decideThreshold`)، أي مرجع تصعيد مسجل لإدارة ما أو الرئيس التنفيذي. قيد في قاعدة البيانات يمنع أن يكون المُدخل هو المعتمد. والحد يُحسم مرة واحدة، ويُغيَّر باقتراح حد جديد. ولا حذف.
- الحد الساري للمفتاح هو آخر حد معتمد بلغ تاريخ سريانه. الحد المقترح أو المرفوض أو الذي لم يحن تاريخه لا يسري.
- **السلوك الآمن الذي اخترته:** إذا لم يكن للمفتاح حد ساري، **لا تُتخطى الخطوة بل تُطلب احتياطًا**. تُضاف ملاحظة «حد الاعتماد غير معرّف (المفتاح): طُلبت الخطوة احتياطًا…» إلى لقطة النسخة، وتظهر في `detail().approval_notes`. والسلوك نفسه حين يكون المبلغ فارغًا.
- رُفع الحد الأقصى للخطوات من 3 إلى 5.
- تبقى الخطوة في موضعها من السياسة حتى إذا تُخطيت خطوة قبلها، فقد تكون المواضع 0 ثم 2. لذلك تبقى `approval_policy.steps[position]` صحيحة في كل من يقرؤها.
- الخدمة غير المباشرة تلزمها خطوة واحدة على الأقل بلا شرط، حتى لا تتخطى الشروط كل الخطوات فيبقى الطلب بلا معتمد.

### B2: المسار المباشر
- `{steps:[], mode:'direct'}`: عند التقديم يدخل الطلب `approved`، ويُكتب حدث `request.approved` في `outbox` كما في أي اعتماد، ويُشعَر المنفذون فورًا بنوع إشعار جديد `ready_for_execution`. في الخدمة السرية يُشعَر مدير الإدارة المنفذة وحده.
- إذا كان لخدمة `mode:'direct'` خطوات مشروطة، تعمل الخطوات السارية متسلسلة. وإذا لم يسرِ أي منها يدخل الطلب مباشرة.
- المقترحات (تحتاج تبنّيًا، انظر القسم 2):
  - `b2-safety-direct` لخدمة `ADM-SAFETY`.
  - `b2-issue-alert-direct` لخدمة `PR-ISSUE-ALERT`.
  - `b2-lost-card-direct` لخدمة `ADM-ACCESS-CARD`. **بدل الفاقد ليس خدمة مستقلة** بل خيار في الحقل `action`. لذلك تصير الخطوتان مشروطتين بـ`not_in:['بدل فاقد']`: بدل الفاقد يمر مباشرة، والإصدار الجديد وتعديل الصلاحية يبقيان باعتماد المدير ثم مكتب الرئيس.

### B3 مع الإصلاح 3: فصل الاعتماد عن التنفيذ
- `sod:true` يعني أن من اعتمد أي خطوة في النسخة الحالية، بنفسه أو بتفويض (`decided_by` أو `approver_id`)، لا يُعرض له `claim` ولا `complete`، ويرفضهما `transition` بالرمز `transition_denied`.
- `handler_role:'member'` يعني أن المنفذ أي عضو نشط في الإدارة المنفذة عدا حساب إدارة المنصة.
- **لم يعد مقترحًا ينتظر تبنّيًا**: `sod:true` و`handler_role:'member'` في تعريف كل واحدة من `SOD_SERVICES`، كما أن `confidential` في تعريف `CONFIDENTIAL_SERVICES`. يصل الضابط مُشغَّلًا مع الكتالوج، ولا يحتاج قرار كيان. الخطوات لا تتغير، فمن يعتمد يبقى كما هو. و`separationOfDutiesState(db,tenantId)` تقرأ النسخ المخزَّنة فتقول أيَّ خدمة لم تبلغها النسخةُ الحاملة للضابط (قاعدة ثُبّت فيها الكتالوج قبل هذا التغيير).
- قائمة الخدمات الحسّاسة (`SOD_SERVICES`):
  - مال: `FIN-PAYMENT-REQUEST` و`FIN-REFUND` و`FIN-BUDGET-TRANSFER` و`FIN-CUSTODY` و`PRC-VENDOR-BANK` و`PRC-PURCHASE-REQUEST` و`PRC-EMERGENCY` و`PRC-PO-CHANGE` و`INF-PROOF-PAYMENT` و`DIG-BUDGET-CHANGE` و`ADM-EXPENSE-CLAIM` و`HR-SALARY-ADVANCE` و`HR-RETRO-ADJUSTMENT` و`HR-BANK-CHANGE` و`HR-GOSI-CORRECTION` و`HR-JOB-CHANGE`.
  - صلاحيات: `IT-ACCESS` و`IT-NEW-ACCOUNT` و`IT-CHANGE-REQUEST` و`DIG-AD-ACCOUNT` و`DAT-DATA-ACCESS`.
  - بيانات شخصية: `LEG-PRIVACY-REQUEST`.

### B4: دمج الاعتماد المكرر
- إذا حُلّت خطوة إلى شخص يعتمد خطوة سابقة في الطلب نفسه، **تُصعَّد الخطوة إلى `escalationApprover` لإدارتها ولا تُحذف**. يُسجَّل أساسها `duplicate_escalation` ومعه من حلّت إليه أصلًا (`replaced_user_id`)، في `approval_step_basis` وفي `approval_plan` داخل لقطة النسخة، مع ملاحظة.
- إذا لم يوجد مرجع أعلى مختلف، مثل رئيس يعتمد خطوتين لمدير المكتب، تبقى الخطوة كما كانت، ويُعلَّم ذلك بـ`duplicate_unresolved` مع ملاحظة تطلب تعيين مرجع. هكذا لا يتوقف طلب كان يعمل اليوم.
- **ينطبق على كل الخدمات دون علَم.** مثال: موظف في المالية مديره مدير المالية يطلب `FIN-CUSTODY`، فكانت الخطوتان عند مدير المالية، وصارت الثانية عند نائب القطاع المؤسسي.

### B5: المعتمد البديل
- جدول جديد `approval_fallbacks` (الإدارة، الدور، البديل، السبب)، مستقل عن `department_routing` ولم يُعدَّل ذلك الجدول. يعيّن البديل من يملك `structure.manage` (`setApprovalFallback`)، ويُمرَّر `fallback_user_id:null` للإزالة.
- إذا كان المعتمد المعيّن لخطوة `hr` أو `it` أو `pm` أو `department_manager` هو الطالب، بالتوجيه أو لأنه الوحيد بالدور، تُحال الخطوة إلى البديل المسجل، وإلا إلى مرجع تصعيد الإدارة. وإذا غاب الاثنان يبقى الخطأ `self_approval` كما كان.
- **يستطيع موظف الموارد البشرية المعتمد طلب تعريف بالراتب لنفسه.** دون بديل يعتمده نائب القطاع المؤسسي، ومع بديل يعتمده البديل، والاختبار يغطي الحالتين. إذا سُحب البديل قبل القرار يسقط حقه في الخطوة، لأن `authorizedStep` يعيد التحقق عند كل قرار.
- منطق خطوة `manager` (المدير المباشر) لم يتغير. الحالة القديمة لمدير مباشر هو الطالب نفسه ما زالت تُرفض بـ`self_approval`.
- **ينطبق دون علَم:** طلب كان يفشل بـ`self_approval` صار يُحال.

### B6 مع الإصلاح 10: الخدمات السرية
- في الخدمة المعلّمة `confidential:true`، بعد الاعتماد لا يرى الطلب فريق الإدارة المنفذة كله. يراه فقط: صاحب الطلب، ومعتمدو النسخة الحالية، والمسند إليه ما دام في الإدارة المنفذة، ومدير الإدارة المنفذة (معتمد `department_manager` المعيّن أو مديرها)، ومن أُسندت له مهمة.
- لأن الرؤية ضاقت، **يستطيع مدير الإدارة المنفذة استلام الخدمة السرية** إضافة إلى من يحمل دور المنفذ ويراها. بدون ذلك قد يبقى الطلب بلا منفذ، مثلًا حين يكون المعتمد بديلًا من خارج الدور.
- الخدمات المعلّمة مباشرة في الكتالوج (`CONFIDENTIAL_SERVICES`): `HR-GRIEVANCE` و`HR-SALARY-ADVANCE` و`HR-BENEFIT-CLAIM` و`HR-BANK-CHANGE` و`HR-EXIT-INTERVIEW` و`HR-SALARY-CERT` و`HR-PAYROLL-INQUIRY` و`HR-RETRO-ADJUSTMENT` و`HR-GOSI-CORRECTION` و`LEG-WHISTLEBLOW`.
- **لم أحذف خطوة المدير المباشر** من `HR-SALARY-ADVANCE` و`HR-BENEFIT-CLAIM` و`HR-EXIT-INTERVIEW`. حذفها قرار مالك الإجراء (الموارد البشرية)، واختبار B6 يثبت أنها باقية.
- عُدِّل وصف `HR-GRIEVANCE` ليطابق الرؤية الجديدة.

### B7: المستفيد لا يعتمد ولا ينفّذ
- `beneficiaryOf(db,r)` يقرأ `request_intake.beneficiary_id` بـSQL مباشر، ولا يستورد `request-intake.mjs`.
- في `authorizedStep`: يُرفض إذا كان المستخدم أو صاحب الخطوة هو المستفيد.
- في `actions`: لا يُعرض للمستفيد `claim` ولا `complete` ولا `transfer` ولا `assign_task`.
- عند التقديم: إذا حُلّت خطوة إلى المستفيد تُستبدل بالطريقة نفسها في B5، أي البديل ثم مرجع التصعيد، وإلا يُرفض الطلب بـ`beneficiary_approval`.
- `HR-JOB-CHANGE`: **حُذف خيار «تعديل الأجر»**. الوصف وإرشاد الحقل يقولان إن تعديل الأجر يتم بتعديل عقد الموظف في شاشة عقود الموظفين (`hr-contracts.mjs`)، حيث يعدّه شخص ويعتمده آخر. وإرشاد حقل اسم الموظف يطلب تحديده في خانة «المستفيد».

### B8: ربط الخدمات بوحداتها
- أُضيف إلى `SERVICE_MODULES`، وكلها وحدات مسجلة في `operationModules`:
  - `HR-BANK-CHANGE` و`HR-SALARY-ADVANCE` و`HR-RETRO-ADJUSTMENT` إلى `payroll-extras`.
  - `GOV-CONFLICT-DISCLOSURE` إلى `procurement-extras`.
  - `FIN-PAYMENT-REQUEST` إلى `payables`.
  - `FIN-CLIENT-INVOICE` إلى `receivables`.
  - `FIN-REFUND` إلى `invoices`.
  - `PMO-NEW-PROJECT` إلى `commercial`.
- **أُزيل ربط `DIG-BUDGET-CHANGE` الخاطئ بـ`campaigns`** ووُضع في `PENDING_SERVICE_MODULES` مربوطًا بـ`media-spend`. سبب إبقائه هناك: اختبار `service-cards.test.mjs` المسجل يتحقق أن كل وحدة في `SERVICE_MODULES` مسجلة في `operationModules`، و`media-spend` ليست مسجلة بعد.
- `PENDING_SERVICE_MODULES` قائمة منفصلة بالربط الصحيح إلى وحدات لم تُسجَّل بعد:
  - `INF-*` الأربع إلى `influencers`.
  - `PRO-SHOOT` و`PRO-LOCATION` و`PRO-FREELANCER` إلى `production`، و`PRO-EQUIPMENT` إلى `equipment`.
  - `HR-SALARY-CERT` و`HR-EXPERIENCE-CERT` و`HR-LETTER` إلى `letters`.
  - `LEG-PRIVACY-REQUEST` إلى `privacy`.
  - `HR-RESIGNATION` و`IT-NEW-ACCOUNT` إلى `lifecycle`.
  - `DAT-AI-USE` إلى `ai-governance`.
  - `DIG-BUDGET-CHANGE` إلى `media-spend`.
- `serviceModulesFor(operationModules)` يدمج من القائمة المعلقة ما صارت وحدته مسجلة. وأُضيفت أسماء الوحدات الجديدة إلى `MODULE_NAMES`.

### B9: فحص الإعداد
`catalogHealth(db,tenantId)` في `service-catalog.mjs` يفحص كل خدمة سارية ويعيد `{services_checked, issues[], summary}`. أنواع الملاحظات:
- `no_executor` (عالية): لا حساب نشط بدور المنفذ في الإدارة، أو لا مدير يستلم خدمة سرية.
- `step_unresolvable` (عالية): إدارة الخطوة مؤرشفة، أو لا معتمد، أو أكثر من معتمد محتمل بلا توجيه، أو لا حساب في الرئاسة. خطوة `manager` تتبع الطالب فلا تُفحص.
- `threshold_undefined` (متوسطة): خطوة مشروطة بمفتاح بلا حد ساري.
- `sod_no_executor` (عالية): خدمة بفصل مهام لا منفذ فيها غير من يعتمدها.
- `no_substitute` (منخفضة): لا بديل ولا مرجع تصعيد، فطلب المعتمد نفسه لهذه الخدمة سيتوقف.

## 4. شكل `approval_policy` الجديد

الشكل القديم يُقبل ويُخزَّن حرفيًا كما هو، والاختبار يتحقق من ذلك:
```json
{"steps":["manager","department_manager"],"handler_role":"manager"}
```

الحقول الاختيارية الجديدة:
- `steps`: من 0 إلى 5 خطوات، نصية أو كائنية.
- `mode`: `sequential` أو `parallel` أو `direct`.
- `handler_role`: أُضيف إليه `member`.
- `sod` و`confidential`: قيمتان منطقيتان.

أمثلة:
```json
// تدرج بالمبلغ: المدير المباشر دائمًا، والمالية إذا بلغ المبلغ حدها، والرئاسة إذا بلغ حدها
{"steps":["manager",
  {"role":"department_manager","department":"finance","when":{"field":"amount","gte_setting":"fin.payment.finance_review"}},
  {"role":"executive","when":{"field":"amount","gte_setting":"fin.payment.executive_review"}}],
 "handler_role":"member","sod":true}

// بلاغ مباشر
{"steps":[],"mode":"direct","handler_role":"manager"}

// مباشر لبدل الفاقد فقط
{"steps":[{"role":"manager","when":{"field":"action","not_in":["بدل فاقد"]}},
          {"role":"department_manager","when":{"field":"action","not_in":["بدل فاقد"]}}],
 "mode":"direct","handler_role":"manager"}

// خدمة سرية
{"steps":["hr"],"handler_role":"hr","confidential":true}
```

قواعد التحقق في `validatePolicy`:
- لكل خطوة زوج (دور، إدارة) مختلف.
- `manager` لا يقبل `department`.
- الإدارة موجودة ونشطة.
- `gte_setting` يلزمه حقل رقمي ومفتاح يطابق `^[a-z][a-z0-9_.]{2,59}$`.
- `in` و`not_in` يلزمهما حقل اختيار وقيم من خياراته.
- الخدمة غير المباشرة تلزمها خطوة بلا شرط.

## 5. الهجرة 093

| الجدول | الغرض | القيود |
|---|---|---|
| `approval_thresholds` | حدود الاعتماد بالهللات بسندها وتاريخ سريانها | المُدخل ≠ المعتمد (CHECK)، يُحسم مرة واحدة، لا تعديل للقيمة، لا حذف |
| `approval_fallbacks` | المعتمد البديل لكل (إدارة، دور) | الدور من `department_manager/hr/it/pm`، سبب إلزامي |
| `approval_step_basis` | أساس إسناد كل خطوة (`standard`/`fallback`/`escalation`/`duplicate_escalation`/`executive`) ومن استُبدل ونتيجة الشرط | لا تعديل ولا حذف |
| `approval_policy_adoptions` | سجل تبنّي المقترحات والرجوع عنها بسندها | إلحاقي، لا تعديل ولا حذف |

لم يُعدَّل أي جدول قائم. الخطوات التي أُنشئت قبل 093 ليس لها سجل أساس، فتُفحص بالمنطق القديم حرفيًا.

## 6. ما يحتاجه المنسّق

### 6.1 مسارات الخادم (`server.mjs`)
| المسار | الدالة | ملاحظة |
|---|---|---|
| `GET /approval-settings` | `approvalSettings(db,u)` من `service-catalog.mjs` | يُتاح لمن يملك `catalog.manage` أو `structure.manage` أو للرئاسة |
| `POST /approval-settings/thresholds` | `proposeThreshold(db,u,{setting_key,amount_minor,basis,effective_from})` من `workflow.mjs` | داخل `transaction`، ويُستحسن مفتاح idempotency |
| `POST /approval-settings/thresholds/:id/decide` | `decideThreshold(db,u,id,{version,decision,note})` | `decision`: `approve` أو `reject` |
| `POST /approval-settings/fallbacks` | `setApprovalFallback(db,u,{department_id,step_role,fallback_user_id,note})` | `fallback_user_id:null` للإزالة |
| `POST /approval-settings/proposals/:key/adopt` | `adoptPolicyProposal(db,u,key,{basis,withdraw?})` من `service-catalog.mjs` | لحساب إدارة المنصة |

الفحص وحده متاح عبر `catalogHealth(db,tenantId)`، وهو مضمَّن في `approvalSettings().health`.

### 6.2 الواجهة
- سجّل `approvalSettingsUI` من `app/static/approval-settings-ui.mjs` في `operationModules` بالمفتاح `'approval-settings'`، وأضفه إلى القائمة لمن يملك `catalog.manage` أو `structure.manage` أو للرئاسة.
- الشاشة تعرض: مفاتيح الحدود المستعملة وقيمها السارية، وسجل الحدود، والبدلاء، والمقترحات، وفحص الكتالوج. تكتب الحد بالريال وترسله بالهللات عبر `riyalsToMinor`، بعمليات نصية لا عشرية.
- **سجّل الوحدات المعلقة** (`letters` و`privacy` و`lifecycle` و`media-spend` و`ai-governance` و`influencers` و`production` و`equipment`) في `operationModules`. بعدها إما أن تنقل مدخلاتها من `PENDING_SERVICE_MODULES` إلى `SERVICE_MODULES`، وإما أن تستبدل `SERVICE_MODULES` بـ`serviceModulesFor(operationModules)` حيث تُقرأ.
- أضف تسمية لنوع الإشعار الجديد `ready_for_execution` («طلب جاهز للتنفيذ»).
- اعرض `detail().approval_notes` في شاشة الطلب، مثل «حد الاعتماد غير معرّف» و«صُعّدت الخطوة» و«مسار مباشر».

### 6.3 وحدات تقرأ السياسة بالشكل القديم
لا يظهر أثر هذه الوحدات إلا في خدمة بخطوات كائنية أو `member` أو `direct`. لا خدمة في الكتالوج الحالي كذلك قبل التبني.
- `routing.mjs`: الدالة `executing` والمستقبِلون في `transferRequest` يقارنون `u.role===handler_role` حرفيًا، فلا يعمل التحويل ولا إسناد المهام في خدمة `member`. الإصلاح في سطر واحد: `executing=(db,u,r)=>wf.isHandler(db,u,r)`، ومستقبِلون من `executorsFor(db,service,target.id,tenant)`. قبل ذلك، `actions()` تُخفي `transfer` و`assign_task` عمن سيرفضه `routing`، حتى لا يظهر فعل يفشل.
- `search.mjs` (السطر 50) و`request-closure.mjs` (السطر 98): شرط `handler_role=u.role` لا يطابق `member`، ولا يعرف أن مدير الإدارة المنفذة يرى السري. انسخ شرط `listRequests` الجديد: `handler_role IN (?, 'member') OR ?='manager'`. التحقق النهائي يبقى في `getRequest` عبر `visible()`، فلا كشف بيانات.
- `request-timeline.mjs` و`process-insight.mjs` و`ai.mjs` و`static/request-picker.mjs` و`admin.mjs` و`delegations.mjs` تفترض أن الخطوة نص. بخطوة كائنية تظهر التسمية «[object Object]»، ولا يُعرض التفويض لخطوة إدارة أخرى. استعمل `normalizeStep(step).role`، وللتسمية انظر `stepName` في `service-cards.mjs`.
- `scripts/lifecycle-audit.mjs` و`scripts/workflow-review.mjs` لا يعرفان `member` ولا `direct` ولا الخطوة الكائنية. هما السبب في بقاء B2 وB3 مقترحين. إذا قرر المالك تثبيتهما افتراضيًا، يُحدَّث الاختباران عبر من يملكهما، لا بتعديل صامت.
- `request-intake.mjs`: جعل `beneficiary_id` إلزاميًا للخدمات التي تقع على شخص آخر، مثل `HR-JOB-CHANGE` و`TAL-SUCCESSION` و`EXP-RECOGNITION` و`ADM-WORKSPACE`. المحرك يطبق منع المستفيد متى وُجد، لكنه لا يُلزم بتحديده.
- `STATUS.md`: نقطة الاستكمال، لأنه خارج ملفاتي.

### 6.4 تغييرات سلوك تنطبق دون علَم
هذه الثلاثة سدّ ثغرات عامة طلبها التدقيق، وتنطبق على كل الخدمات. الاختبارات المسجلة كلها ناجحة معها:
1. **B4:** التكرار يُصعَّد.
2. **B5:** المعتمد الذاتي في `hr` و`it` و`pm` و`department_manager` المعيّن يُحال إلى البديل أو التصعيد، بعد أن كان يفشل.
3. **B7:** المستفيد مستبعد من الاعتماد والتنفيذ.

وتغيّرت نسخ هذه الخدمات عند إعادة التثبيت:
- السرية على 10 خدمات.
- حذف خيار «تعديل الأجر» ووصف جديد في `HR-JOB-CHANGE`.
- وصف `HR-GRIEVANCE`.

## 7. قرارات مالك الإجراء

1. **الرئاسة:** مصفوفة الصلاحيات المالية، أي قيم الحدود ومن يعتمد عند كل حد. الآلية جاهزة ولا رقم في الكود. تُدخل الحدود بسندها ويعتمدها غير مُدخلها. ويلزم تحديد أي الخدمات تُضاف إليها خطوات المالية أو الرئاسة: `FIN-BUDGET-TRANSFER` و`CRM-PRICING` و`ADM-TRAVEL` و`PRO-EVENT` و`GOV-DECISION` و`PMO-RESOURCE` و`DAT-DATA-ACCESS` وغيرها في القسم 1.2 من التدقيق. **لم أغيّر معتمد أي خدمة قائمة.**
2. **كل مالك إجراء:** تأكيد قائمة `SOD_SERVICES` ثم تبنّي المقترحات. قبل التبني يعرض `catalogHealth` الخدمات التي لا منفذ فيها غير معتمدها، وهي في البيئة التجريبية كل إدارة فيها مدير وحيد.
3. **مكتب الرئيس والعلاقات العامة:** تبنّي المسار المباشر لـ`ADM-SAFETY` و`PR-ISSUE-ALERT` ولبدل الفاقد في `ADM-ACCESS-CARD`.
4. **الموارد البشرية:**
   - حذف خطوة المدير المباشر من `HR-BENEFIT-CLAIM` و`HR-EXIT-INTERVIEW`، وهل تبقى في `HR-SALARY-ADVANCE`. لم أحذفها.
   - تأكيد قائمة الخدمات السرية العشر.
   - من يعتمد الترقية والنقل في `HR-JOB-CHANGE`.
5. **الهيكل:** تعيين معتمد بديل لكل دور موجَّه، خاصة `hr` و`it`. بدونه يُحال طلب المعتمد لنفسه إلى نائب القطاع. مثال: موظف التقنية الذي يطلب جهازًا، وخطوته الأولى نفسها عند نائب القطاع، فتُعلَّم `duplicate_unresolved`.
6. **الرئاسة (B9):** تسمية مدير للخدمات الإبداعية أو نقل خدماتها. الفحص يكشف ذلك متى غاب المنفذ.

## 8. اختبارات `tests/approval-engine.test.mjs`
- **B1، التحقق:** حد أقصى 5 خطوات، ورفض المبلغ المكتوب في الخدمة، وحقل رقمي للحد، وإدارة صالحة، وخطوة بلا شرط، وتخزين الشكل القديم حرفيًا.
- **B1، الحدود:** الحد غير المعرّف يطلب الخطوة مع ملاحظة، والمقترح غير نافذ، والمُدخل لا يعتمد (في الكود وفي قاعدة البيانات)، والتدرج عند الحدين، والسريان المستقبلي، ومنع حذف الحد.
- **B2:** اعتماد فوري وإشعار المنفذ و`outbox`. المقترح لا يسري بلا تبنٍّ، والتبني يصمد أمام إعادة التثبيت، والرجوع عنه يعمل. بدل الفاقد مباشر والإصدار الجديد باعتمادين.
- **B3:** المعتمد لا يستلم، وعضو آخر في المالية ينفذ ويغلق. الخطوات لا تتغير، والرجوع يعيد السياسة.
- **B4:** التصعيد إلى نائب القطاع مع التسجيل في اللقطة، والشخص نفسه لا يعتمد مرتين، والمسار العادي بلا تغيير في شكل اللقطة.
- **B5:** التصعيد ثم البديل، وسحب البديل يُسقط حقه، والاعتماد الذاتي القديم للمدير ما زال مرفوضًا.
- **B6:** عضو HR آخر لا يرى التظلم، وخدمة غير سرية تبقى مرئية للفريق، ومدير الإدارة يرى، وخطوة المدير باقية.
- **B7:** المستفيد لا يعتمد ولا يستلم، وخيار «تعديل الأجر» محذوف.
- **B8:** كل ربط يشير إلى شاشة موجودة، وقائمة المعلق، والدمج عند التسجيل.
- **B9:** الحد غير المعرّف، و`sod` بلا منفذ ثانٍ، وخدمة بلا منفذ، وخطوة لا تُحل، والصلاحيات على شاشة الإعداد.
- **بطاقة الخدمة:** أسماء الخطوات الجديدة، وعلَما فصل المهام والسرية.
- **شاشة الإعداد:** تعرض دون خطأ، وتحويل الريال إلى هللات دقيق.
