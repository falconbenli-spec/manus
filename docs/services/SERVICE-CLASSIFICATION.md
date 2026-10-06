# تصنيف الخدمات الحيّة — 141 خدمة بدليل لكل صف

**قيست في:** 30 سبتمبر 2026 · **تكملة لـ:** [`SERVICE-COVERAGE-MATRIX.md`](SERVICE-COVERAGE-MATRIX.md)
**قاعدة القراءة:** نسخة من `work/hr-design-preview-20260914.sqlite` في `$TMPDIR`، قراءةً فقط.

تبني هذه الوثيقة على أرقام المصفوفة ولا تعيد قياسها: **139** تعريفًا في `catalogServices`،
و**142** رمزًا متمايزًا في القاعدة، و**141** معروضة (`CREATIVE-BRIEF` مخفية بقرار)، و425 صفًّا
لأن الجدول إلحاقي والساري `MAX(version)`. والإدارات 25 صفًّا، 18 نشطة، 16 تملك خدمة حيّة.

الـ141 المصنَّفة هنا = 139 من `catalogServices` + `HR-LETTER` + `IT-SUPPORT` (مبذورتان حيّتان).

> **مرساة أرقام الأسطر.** `app/service-catalog.mjs` كان يُعدَّل في جلسة أخرى أثناء هذه القراءة
> (نما من 1882 سطرًا إلى 1900)، فأُعيد توليد كل أرقام الأسطر على النسخة أدناه بعد التحقق من أن
> **مجموعة الخدمات لم تتغير**: 139 رمزًا، هي الرموز نفسها، و26 بطاقة، و16 مقترح سلسلة، و19 مقترح
> مسار، و5 أزمنة، و22 خدمة بفصل مهام. وإن تحرّك الملف مرة أخرى فالرموز والمفاتيح تبقى صحيحة
> والأسطر وحدها تُزاح.
>
> | الملف | الأسطر | بصمة SHA-256 (12) |
> |---|---:|---|
> | `app/service-catalog.mjs` | 1900 | `decc1b70d368` |
> | `app/service-cards.mjs` | 354 | `784d111f22bc` |
> | `app/module-routes.mjs` | 54 | `79b25775c014` |
> | `app/service-routes.mjs` | 121 | `529ddec4f778` |

---

## ١. كيف حُكم — القواعد الخمس وترتيبها

القرار لكل خدمة نتيجة قواعد مطبَّقة آليًا على الكود والقاعدة، لا قراءةً انطباعية. وحين تنطبق
قاعدتان تُقدَّم الأعلى في هذا الترتيب، ويُذكر الدليل الثاني في خانة الدليل.

| # | التصنيف | القاعدة المطبَّقة | المصدر المقروء |
|---|---|---|---|
| 1 | `retire` | **اقتراح لا تنفيذ.** حقولها مجموعة جزئية من خدمة أخرى + نفس سلسلة الاعتماد + صفر طلب | `service_availability` |
| 2 | `connect` | لا رابط من **أي** نوع، **و**وحدة مخصصة قائمة تملك سجل هذا العمل | الخمسة أدناه + مخطط القاعدة |
| 3 | `merge` | حقولها تكرر خدمة أخرى في الإدارة نفسها بسلسلة الاعتماد نفسها | `catalogServices` + `SERVICE_VARIANTS` |
| 4 | `deepen` | لها مدخل، ودورتها ناقصة بدليل: مسار أو زمن مصمَّم غير متبنّى، أو وحدة معروضة بلا بوابة إغلاق | `CHAIN_PROPOSALS`:975 · `policyProposals`:1020 · `TARGET_PROPOSALS`:1105 · `beforeComplete` |
| 5 | `keep` | لا وحدة تكررها ولا مقترح معلّق — الطلب نفسه هو السجل، أو دورته مغلقة ببوابة | الخمسة أدناه |

### مصادر الربط الخمسة التي قُرئت

| المصدر | الملف | العدد | ما يعنيه |
|---|---|---:|---|
| `SERVICE_VARIANTS` | `service-catalog.mjs:1579` | 26 بطاقة | تجمع **102** من الـ139 خيارًا داخل بطاقة واحدة |
| `SERVICE_MODULES` + `PENDING_SERVICE_MODULES` | `service-cards.mjs:31,42` | 51 رمزًا | البطاقة تُظهر وحدة تنفّذ العمل |
| `MODULE_ROUTES` | `module-routes.mjs:9-21` | 11 خدمة | بطاقة الدليل تفتح **نموذج الوحدة** بدل الطلب العام |
| `KEPT_AS_REQUESTS` | `module-routes.mjs:23-29` | 5 خدمات | قرار مكتوب بإبقائها طلبًا عامًا: وحدتها بلا نموذج للموظف |
| `ROUTED_SERVICES` | `service-routes.mjs:15` | 5 خدمات | الوحدة تُفتح آليًا، و`beforeComplete` يمنع الإغلاق بلا مخرجها |

### حقيقة قاسية عن دليل الطلبات: لا يصلح مؤشر إحالة

استعلام `requests` عبر `service_id → services.code` يعطي **عشر خدمات فقط عليها طلب، وكل واحدة
طلب واحد**؛ والـ131 الباقية صفر. فقاعدة «صفر طلب + مغطّاة بغيرها = مرشّح `retire` قوي» **لا
تُطبَّق هنا**: قاعدة معاينة بلا حركة تشغيلية تجعل الصفر سمةَ القاعدة لا سمةَ الخدمة. لذلك اتُّخذ
الصفر مؤشرًا مساندًا فقط — كما في `CREATIVE-BRIEF`، حيث كان الدليل الحامل هو **تداخل الحقول**
لا عدد الطلبات. الخدمات العشر: `ACC-BRIEF-INTAKE`، `ADM-TRAVEL`، `ADM-VISITOR`،
`CRM-OPPORTUNITY`، `HR-BANK-CHANGE`، `HR-DOC-RENEWAL`، `HR-LETTER`، `HR-SALARY-CERT`،
`IT-DEVICE`، `IT-SUPPORT`.

### والمصنَّفة سلفًا، لم يُعد تصنيفها

| الرمز | التصنيف | الحال |
|---|---|---|
| `CREATIVE-BRIEF` | `retire` | **نُفِّذ.** مخفية في `service_availability` بقرار مكتوب 29 سبتمبر — إخفاءٌ يُرجع عنه بصفٍّ ثانٍ، لا حذف. ليست ضمن الـ141 |
| `HR-LETTER` | `keep` | هدف بطاقة مميَّزة + `LETTER_WIZARD_LINKS` + طلب قائم |
| `IT-SUPPORT` | `keep` | بطاقة مميَّزة + خيار «إصلاح أو دعم فني» في `VAR-IT` + طلب قائم |

---

## ٢. الملخّص بالأرقام

| التصنيف | العدد | النسبة |
|---|---:|---:|
| `keep` | **79** | 56% |
| `deepen` | **50** | 35% |
| `connect` | **12** | 9% |
| `merge` | **0** | — |
| `retire` | **0** جديد (1 منفَّذ خارج الـ141) | — |
| **المجموع** | **141** | |

### التوزيع على الإدارات الستّ عشرة

| الإدارة | keep | deepen | connect | المجموع |
|---|---:|---:|---:|---:|
| رأس المال البشري | 14 | 3 | 5 | 22 |
| مكتب الرئيس التنفيذي | 12 | 3 | 1 | 16 |
| تقنية المعلومات | 6 | 4 | 1 | 11 |
| الحوكمة والالتزام والمخاطر | 5 | 2 | 3 | 10 |
| إدارة الأعمال | 6 | 3 | 0 | 9 |
| التواصل الداخلي | 8 | 0 | 0 | 8 |
| الإدارة التنفيذية للمشاريع | 7 | 1 | 0 | 8 |
| إدارة العلاقات العامة والمؤثرين | 3 | 5 | 0 | 8 |
| إدارة الحسابات | 1 | 6 | 0 | 7 |
| إدارة تدقيق الحملات | 5 | 2 | 0 | 7 |
| المالية | 2 | 3 | 2 | 7 |
| إدارة الإنتاج | 2 | 5 | 0 | 7 |
| إدارة التسويق الرقمي | 0 | 6 | 0 | 6 |
| المشتريات | 0 | 6 | 0 | 6 |
| إدارة العلامة التجارية | 5 | 0 | 0 | 5 |
| إدارة الخدمات الإبداعية | 3 | 1 | 0 | 4 |

**ما يقوله التوزيع:** إدارتان — التسويق الرقمي والمشتريات — كل خدماتها `deepen`، وإدارة الحسابات
ستٌّ من سبع. وهذه الثلاث هي بالضبط التي ترد أسماؤها في `CHAIN_PROPOSALS`: مسارات مصمَّمة
لخدمات تمسّ مالًا أو التزامًا تجاريًا، ولم تُتبنَّ. فليست إدارات «أضعف بناءً»، بل إدارات ينتظر
عملها قرار تبنٍّ واحدًا.

---

## ٣. ثلاث حقائق تسري على الـ141 كلها — لا تُكرَّر في الجدول

هذه ليست تصنيفًا لخدمة بعينها بل حالةُ طبقةٍ كاملة، فذُكرت مرة واحدة هنا بدل 141 مرة:

| البند | المقيس | الأثر |
|---|---|---|
| **بطاقات الخدمة** | **142 بطاقة، كلها `draft`، ولا واحدة منشورة** | `service-cards.mjs` يقول: «لا تُعدّ الخدمة جاهزة إلا ببطاقة منشورة مكتملة». وستة حقول لازمة (`requesters`, `trigger_note`, `outputs`, `acceptance_evidence`, `kpis`, `policy_reference`) **فارغة في 142 من 142**. المالك مسمّى في الكل، والمحتوى في الصفر |
| **الأزمنة المستهدفة** | `service_target_adoptions` = **0 صفًّا** | لا خدمة لها زمن مستهدف متبنّى. و`TARGET_PROPOSALS` (`service-catalog.mjs:1105`) يصمّم خمسةً للخدمات العاجلة ولم يُتبنَّ منها شيء |
| **سلاسل الاعتماد المقترحة** | `approval_policy_adoptions` = **0 صفًّا** | 16 مقترح سلسلة + 3 مقترحات مسار مباشر، كلها مكتوبة ومعلّلة في الكود وغير حيّة |

**قرار المالك المطلوب — واحد يحرّك الثلاثة:** تبنّي `approval_policy_adoptions` و
`service_target_adoptions`، ونشر بطاقات الخدمة بعد ملء الحقول الستة. كل خدمة `deepen` في
الجدول أدناه دليلُها الأول واحدٌ من هذه الثلاثة.

---

## ٤. الجدول — 141 خدمة

الدليل في كل صف: `ملف:سطر` من الكود، أو اسم جدول/مفتاح من القاعدة، أو عدد الطلبات القائمة.

### connect — 12 خدمة

| الرمز | الاسم | الإدارة | الدليل | القرار المطلوب من المالك |
|---|---|---|---|---|
| `GOV-POLICY` | اعتماد سياسة أو إجراء | الحوكمة والالتزام والمخاطر | service-catalog.mjs:525 — لا رابط من أي نوع (غائبة عن SERVICE_VARIANTS وSERVICE_MODULES وMODULE_ROUTES وKEPT_AS_REQUESTS وROUTED_SERVICES)؛ والوحدة قائمة: policy-library.mjs:23,24 — `policy_documents` (3 صفوف) و`policy_articles` (127 صفًّا) — بيانات حيّة | اعتماد ربط البطاقة بالوحدة |
| `GOV-RISK` | تسجيل خطر مؤسسي | الحوكمة والالتزام والمخاطر | service-catalog.mjs:515 — لا رابط من أي نوع (غائبة عن SERVICE_VARIANTS وSERVICE_MODULES وMODULE_ROUTES وKEPT_AS_REQUESTS وROUTED_SERVICES)؛ والوحدة قائمة: governance.mjs — `governance_risks`,`governance_risk_bands`,`_levels`,`_reviews`,`_acceptances` | اعتماد ربط البطاقة بالوحدة |
| `LEG-WHISTLEBLOW` | بلاغ مخالفة أو نزاع | الحوكمة والالتزام والمخاطر | service-catalog.mjs:358 — لا رابط من أي نوع (غائبة عن SERVICE_VARIANTS وSERVICE_MODULES وMODULE_ROUTES وKEPT_AS_REQUESTS وROUTED_SERVICES)؛ والوحدة قائمة: hr-cases.mjs:106 — `hr_cases` — سجل قضايا بمبلّغ وفئة ومشتكى عليه وزمن مستهدف | اعتماد ربط البطاقة بالوحدة |
| `FIN-BUDGET-TRANSFER` | مناقلة ميزانية | المالية | service-catalog.mjs:309 — لا رابط من أي نوع (غائبة عن SERVICE_VARIANTS وSERVICE_MODULES وMODULE_ROUTES وKEPT_AS_REQUESTS وROUTED_SERVICES)؛ والوحدة قائمة: budgets.mjs:49 — `project_budgets`,`project_budget_versions`,`project_budget_decisions`؛ وسلسلتها المصمَّمة في CHAIN_PROPOSALS غير متبنّاة (`approval_policy_adoptions`=0) | اعتماد ربط البطاقة بالوحدة |
| `FIN-TAX-QUERY` | استفسار ضريبي أو فاتورة غير مطابقة | المالية | service-catalog.mjs:677 — لا رابط من أي نوع (غائبة عن SERVICE_VARIANTS وSERVICE_MODULES وMODULE_ROUTES وKEPT_AS_REQUESTS وROUTED_SERVICES)؛ والوحدة قائمة: einvoice-selfcheck.mjs:40 — `procurement_invoice_tax`,`vat_worksheets` (tax-returns.mjs) | اعتماد ربط البطاقة بالوحدة |
| `IT-PLATFORM-FEEDBACK` | اقتراح تحسين على المنصة | تقنية المعلومات | service-catalog.mjs:627 — لا رابط من أي نوع (غائبة عن SERVICE_VARIANTS وSERVICE_MODULES وMODULE_ROUTES وKEPT_AS_REQUESTS وROUTED_SERVICES)؛ والوحدة قائمة: feedback.mjs / catalog-quality.mjs — `feedback_notes`,`service_field_feedback` | اعتماد ربط البطاقة بالوحدة |
| `HR-EXIT-INTERVIEW` | مقابلة خروج ونقل معرفة | رأس المال البشري | service-catalog.mjs:600 — لا رابط من أي نوع (غائبة عن SERVICE_VARIANTS وSERVICE_MODULES وMODULE_ROUTES وKEPT_AS_REQUESTS وROUTED_SERVICES)؛ والوحدة قائمة: lifecycle.mjs:98,186 — `lifecycle_bundles`,`lifecycle_steps`,`lifecycle_clearance_items` (المغادرة) | اعتماد ربط البطاقة بالوحدة |
| `HR-GOSI-CORRECTION` | تصحيح بيانات التأمينات الاجتماعية | رأس المال البشري | service-catalog.mjs:572 — لا رابط من أي نوع (غائبة عن SERVICE_VARIANTS وSERVICE_MODULES وMODULE_ROUTES وKEPT_AS_REQUESTS وROUTED_SERVICES)؛ والوحدة قائمة: payroll-insurance.mjs:56,298 — `employee_insurance_overrides` + `OVERRIDE_KINDS`؛ وسلسلتها المصمَّمة في CHAIN_PROPOSALS غير متبنّاة (`approval_policy_adoptions`=0) | اعتماد ربط البطاقة بالوحدة |
| `HR-JOB-CHANGE` | تغيير وظيفي | رأس المال البشري | service-catalog.mjs:130 — لا رابط من أي نوع (غائبة عن SERVICE_VARIANTS وSERVICE_MODULES وMODULE_ROUTES وKEPT_AS_REQUESTS وROUTED_SERVICES)؛ والوحدة قائمة: employees.mjs:144 — `employee_changes` (وفيه عمود `request_id` مهيّأ للربط أصلًا)؛ وسلسلتها المصمَّمة في CHAIN_PROPOSALS غير متبنّاة (`approval_policy_adoptions`=0) | اعتماد ربط البطاقة بالوحدة |
| `HR-REFERRAL` | ترشيح مرشح لوظيفة | رأس المال البشري | service-catalog.mjs:582 — لا رابط من أي نوع (غائبة عن SERVICE_VARIANTS وSERVICE_MODULES وMODULE_ROUTES وKEPT_AS_REQUESTS وROUTED_SERVICES)؛ والوحدة قائمة: people.mjs — `people_candidates` | اعتماد ربط البطاقة بالوحدة |
| `TAL-SUCCESSION` | ترشيح لمسار تعاقب أو ترقية | رأس المال البشري | service-catalog.mjs:594 — لا رابط من أي نوع (غائبة عن SERVICE_VARIANTS وSERVICE_MODULES وMODULE_ROUTES وKEPT_AS_REQUESTS وROUTED_SERVICES)؛ والوحدة قائمة: talent.mjs:14 — `succession_plans`,`succession_candidates` + تعداد `READINESS` | اعتماد ربط البطاقة بالوحدة |
| `ADM-SUBSCRIPTION` | تجديد اشتراك أو عقد خدمة | مكتب الرئيس التنفيذي | service-catalog.mjs:282 — لا رابط من أي نوع (غائبة عن SERVICE_VARIANTS وSERVICE_MODULES وMODULE_ROUTES وKEPT_AS_REQUESTS وROUTED_SERVICES)؛ والوحدة قائمة: contracts-register.mjs — `contract_records`,`contract_renewal_decisions`,`contract_alert_settings` | اعتماد ربط البطاقة بالوحدة |

### deepen — 50 خدمة

| الرمز | الاسم | الإدارة | الدليل | القرار المطلوب من المالك |
|---|---|---|---|---|
| `CRM-HANDOVER` | تسليم فرصة للتشغيل | إدارة الأعمال | service-catalog.mjs:820 — بطاقتها تُظهر وحدة `commercial` (service-cards.mjs SERVICE_MODULES/PENDING) ولا مدخل لها في MODULE_ROUTES ولا بوابة في `beforeComplete` (service-routes.mjs:89): تُغلق بملاحظة نصية بلا مخرج الوحدة — نمط العطب B15 | ربط المدخل أو إضافة بوابة إغلاق |
| `CRM-OPPORTUNITY` | تسجيل فرصة أو منافسة | إدارة الأعمال | service-catalog.mjs:468 — بطاقتها تُظهر وحدة `commercial` (service-cards.mjs SERVICE_MODULES/PENDING) ولا مدخل لها في MODULE_ROUTES ولا بوابة في `beforeComplete` (service-routes.mjs:89): تُغلق بملاحظة نصية بلا مخرج الوحدة — نمط العطب B15؛ 1 طلب قائم | ربط المدخل أو إضافة بوابة إغلاق |
| `CRM-PRICING` | تسعير أو استثناء هامش | إدارة الأعمال | service-catalog.mjs:810 — بطاقتها تُظهر وحدة `commercial` (service-cards.mjs SERVICE_MODULES/PENDING) ولا مدخل لها في MODULE_ROUTES ولا بوابة في `beforeComplete` (service-routes.mjs:89): تُغلق بملاحظة نصية بلا مخرج الوحدة — نمط العطب B15 | ربط المدخل أو إضافة بوابة إغلاق |
| `PRO-DELIVERY` | تسليم مخرج نهائي وأرشفته | إدارة الإنتاج | service-catalog.mjs:787 — بطاقتها تُظهر وحدة `studio` (service-cards.mjs SERVICE_MODULES/PENDING) ولا مدخل لها في MODULE_ROUTES ولا بوابة في `beforeComplete` (service-routes.mjs:89): تُغلق بملاحظة نصية بلا مخرج الوحدة — نمط العطب B15 | ربط المدخل أو إضافة بوابة إغلاق |
| `PRO-EQUIPMENT` | حجز معدات إنتاج | إدارة الإنتاج | service-catalog.mjs:451 — بطاقتها تُظهر وحدة `equipment` (service-cards.mjs SERVICE_MODULES/PENDING) ولا مدخل لها في MODULE_ROUTES ولا بوابة في `beforeComplete` (service-routes.mjs:89): تُغلق بملاحظة نصية بلا مخرج الوحدة — نمط العطب B15 | ربط المدخل أو إضافة بوابة إغلاق |
| `PRO-FREELANCER` | تعاقد مع مستقل أو طاقم | إدارة الإنتاج | service-catalog.mjs:775 — بطاقتها تُظهر وحدة `productions` (service-cards.mjs SERVICE_MODULES/PENDING) ولا مدخل لها في MODULE_ROUTES ولا بوابة في `beforeComplete` (service-routes.mjs:89): تُغلق بملاحظة نصية بلا مخرج الوحدة — نمط العطب B15 | ربط المدخل أو إضافة بوابة إغلاق |
| `PRO-LOCATION` | موقع تصوير وتصريح | إدارة الإنتاج | service-catalog.mjs:782 — بطاقتها تُظهر وحدة `productions` (service-cards.mjs SERVICE_MODULES/PENDING) ولا مدخل لها في MODULE_ROUTES ولا بوابة في `beforeComplete` (service-routes.mjs:89): تُغلق بملاحظة نصية بلا مخرج الوحدة — نمط العطب B15 | ربط المدخل أو إضافة بوابة إغلاق |
| `PRO-SHOOT` | تصوير أو إنتاج مرئي | إدارة الإنتاج | service-catalog.mjs:436 — بطاقتها تُظهر وحدة `productions` (service-cards.mjs SERVICE_MODULES/PENDING) ولا مدخل لها في MODULE_ROUTES ولا بوابة في `beforeComplete` (service-routes.mjs:89): تُغلق بملاحظة نصية بلا مخرج الوحدة — نمط العطب B15 | ربط المدخل أو إضافة بوابة إغلاق |
| `DIG-AD-ACCOUNT` | وصول لحساب إعلاني | إدارة التسويق الرقمي | service-catalog.mjs:753 — CHAIN_PROPOSALS (service-catalog.mjs:975+) يصمّم لها خطوة اعتماد ثانية، و`approval_policy_adoptions`=0 صفًّا: الخطوة غير حيّة، فالقرار اليوم بخطوة واحدة | تبنّي سلسلة الاعتماد |
| `DIG-BUDGET-CHANGE` | تعديل ميزانية أو تحسين حملة | إدارة التسويق الرقمي | service-catalog.mjs:759 — CHAIN_PROPOSALS (service-catalog.mjs:975+) يصمّم لها خطوة اعتماد ثانية، و`approval_policy_adoptions`=0 صفًّا: الخطوة غير حيّة، فالقرار اليوم بخطوة واحدة؛ وبطاقتها تُظهر وحدة `media-spend` بلا بوابة إغلاق في `beforeComplete` | تبنّي سلسلة الاعتماد |
| `DIG-CAMPAIGN` | حملة رقمية أو شراء إعلامي | إدارة التسويق الرقمي | service-catalog.mjs:416 — بطاقتها تُظهر وحدة `campaigns` (service-cards.mjs SERVICE_MODULES/PENDING) ولا مدخل لها في MODULE_ROUTES ولا بوابة في `beforeComplete` (service-routes.mjs:89): تُغلق بملاحظة نصية بلا مخرج الوحدة — نمط العطب B15 | ربط المدخل أو إضافة بوابة إغلاق |
| `DIG-CAMPAIGN-CLOSE` | إقفال حملة | إدارة التسويق الرقمي | service-catalog.mjs:765 — بطاقتها تُظهر وحدة `campaigns` (service-cards.mjs SERVICE_MODULES/PENDING) ولا مدخل لها في MODULE_ROUTES ولا بوابة في `beforeComplete` (service-routes.mjs:89): تُغلق بملاحظة نصية بلا مخرج الوحدة — نمط العطب B15 | ربط المدخل أو إضافة بوابة إغلاق |
| `DIG-PERFORMANCE-REPORT` | تقرير أداء حملة | إدارة التسويق الرقمي | service-catalog.mjs:429 — بطاقتها تُظهر وحدة `reports` (service-cards.mjs SERVICE_MODULES/PENDING) ولا مدخل لها في MODULE_ROUTES ولا بوابة في `beforeComplete` (service-routes.mjs:89): تُغلق بملاحظة نصية بلا مخرج الوحدة — نمط العطب B15 | ربط المدخل أو إضافة بوابة إغلاق |
| `DIG-SOCIAL-POST` | جدولة نشر على المنصات | إدارة التسويق الرقمي | service-catalog.mjs:423 — بطاقتها تُظهر وحدة `content` (service-cards.mjs SERVICE_MODULES/PENDING) ولا مدخل لها في MODULE_ROUTES ولا بوابة في `beforeComplete` (service-routes.mjs:89): تُغلق بملاحظة نصية بلا مخرج الوحدة — نمط العطب B15 | ربط المدخل أو إضافة بوابة إغلاق |
| `ACC-BRIEF-INTAKE` | استقبال تكليف من عميل | إدارة الحسابات | service-catalog.mjs:904 — CHAIN_PROPOSALS (service-catalog.mjs:975+) يصمّم لها خطوة اعتماد ثانية، و`approval_policy_adoptions`=0 صفًّا: الخطوة غير حيّة، فالقرار اليوم بخطوة واحدة؛ 1 طلب قائم | تبنّي سلسلة الاعتماد |
| `ACC-CHANGE-REQUEST` | طلب تغيير من عميل | إدارة الحسابات | service-catalog.mjs:480 — CHAIN_PROPOSALS (service-catalog.mjs:975+) يصمّم لها خطوة اعتماد ثانية، و`approval_policy_adoptions`=0 صفًّا: الخطوة غير حيّة، فالقرار اليوم بخطوة واحدة؛ وبطاقتها تُظهر وحدة `scope` بلا بوابة إغلاق في `beforeComplete` | تبنّي سلسلة الاعتماد |
| `ACC-CLIENT-COMPLAINT` | شكوى أو ملاحظة عميل | إدارة الحسابات | service-catalog.mjs:474 — CHAIN_PROPOSALS (service-catalog.mjs:975+) يصمّم لها خطوة اعتماد ثانية، و`approval_policy_adoptions`=0 صفًّا: الخطوة غير حيّة، فالقرار اليوم بخطوة واحدة | تبنّي سلسلة الاعتماد |
| `ACC-MEETING-MINUTES` | محضر اجتماع عميل وقراراته | إدارة الحسابات | service-catalog.mjs:916 — CHAIN_PROPOSALS (service-catalog.mjs:975+) يصمّم لها خطوة اعتماد ثانية، و`approval_policy_adoptions`=0 صفًّا: الخطوة غير حيّة، فالقرار اليوم بخطوة واحدة | تبنّي سلسلة الاعتماد |
| `ACC-RENEWAL` | تجديد أو توسعة حساب عميل | إدارة الحسابات | service-catalog.mjs:826 — CHAIN_PROPOSALS (service-catalog.mjs:975+) يصمّم لها خطوة اعتماد ثانية، و`approval_policy_adoptions`=0 صفًّا: الخطوة غير حيّة، فالقرار اليوم بخطوة واحدة | تبنّي سلسلة الاعتماد |
| `ACC-STATUS-REPORT` | تقرير حالة للعميل | إدارة الحسابات | service-catalog.mjs:910 — CHAIN_PROPOSALS (service-catalog.mjs:975+) يصمّم لها خطوة اعتماد ثانية، و`approval_policy_adoptions`=0 صفًّا: الخطوة غير حيّة، فالقرار اليوم بخطوة واحدة | تبنّي سلسلة الاعتماد |
| `CRT-DESIGN` | طلب تصميم | إدارة الخدمات الإبداعية | service-catalog.mjs:202 — بطاقتها تُظهر وحدة `studio` (service-cards.mjs SERVICE_MODULES/PENDING) ولا مدخل لها في MODULE_ROUTES ولا بوابة في `beforeComplete` (service-routes.mjs:89): تُغلق بملاحظة نصية بلا مخرج الوحدة — نمط العطب B15 | ربط المدخل أو إضافة بوابة إغلاق |
| `INF-CAMPAIGN` | حملة مؤثرين | إدارة العلاقات العامة والمؤثرين | service-catalog.mjs:408 — بطاقتها تُظهر وحدة `influencers` (service-cards.mjs SERVICE_MODULES/PENDING) ولا مدخل لها في MODULE_ROUTES ولا بوابة في `beforeComplete` (service-routes.mjs:89): تُغلق بملاحظة نصية بلا مخرج الوحدة — نمط العطب B15 | ربط المدخل أو إضافة بوابة إغلاق |
| `INF-CONTENT-APPROVAL` | اعتماد محتوى مؤثر قبل النشر | إدارة العلاقات العامة والمؤثرين | service-catalog.mjs:741 — بطاقتها تُظهر وحدة `influencers` (service-cards.mjs SERVICE_MODULES/PENDING) ولا مدخل لها في MODULE_ROUTES ولا بوابة في `beforeComplete` (service-routes.mjs:89): تُغلق بملاحظة نصية بلا مخرج الوحدة — نمط العطب B15 | ربط المدخل أو إضافة بوابة إغلاق |
| `INF-CONTRACT` | عرض وعقد مؤثر | إدارة العلاقات العامة والمؤثرين | service-catalog.mjs:733 — بطاقتها تُظهر وحدة `influencers` (service-cards.mjs SERVICE_MODULES/PENDING) ولا مدخل لها في MODULE_ROUTES ولا بوابة في `beforeComplete` (service-routes.mjs:89): تُغلق بملاحظة نصية بلا مخرج الوحدة — نمط العطب B15 | ربط المدخل أو إضافة بوابة إغلاق |
| `INF-PROOF-PAYMENT` | إثبات تنفيذ وسداد | إدارة العلاقات العامة والمؤثرين | service-catalog.mjs:747 — CHAIN_PROPOSALS (service-catalog.mjs:975+) يصمّم لها خطوة اعتماد ثانية، و`approval_policy_adoptions`=0 صفًّا: الخطوة غير حيّة، فالقرار اليوم بخطوة واحدة؛ وبطاقتها تُظهر وحدة `influencers` بلا بوابة إغلاق في `beforeComplete` | تبنّي سلسلة الاعتماد |
| `PR-ISSUE-ALERT` | تنبيه قضية إعلامية | إدارة العلاقات العامة والمؤثرين | service-catalog.mjs:403 — policyProposals/B2 (service-catalog.mjs:1020+) يصمّم لها مسارًا مباشرًا، و`approval_policy_adoptions`=0: البلاغ ينتظر اعتمادًا قبل أن يصل المنفّذ؛ TARGET_PROPOSALS يصمّم لها زمنًا مستهدفًا، و`service_target_adoptions`=0 صفًّا | تبنّي المسار/الزمن المستهدف |
| `DAT-AI-USE` | استخدام أداة ذكاء اصطناعي | إدارة تدقيق الحملات | service-catalog.mjs:551 — بطاقتها تُظهر وحدة `ai-governance` (service-cards.mjs SERVICE_MODULES/PENDING) ولا مدخل لها في MODULE_ROUTES ولا بوابة في `beforeComplete` (service-routes.mjs:89): تُغلق بملاحظة نصية بلا مخرج الوحدة — نمط العطب B15 | ربط المدخل أو إضافة بوابة إغلاق |
| `DAT-DASHBOARD` | طلب تقرير أو لوحة مؤشرات | إدارة تدقيق الحملات | service-catalog.mjs:540 — بطاقتها تُظهر وحدة `reports` (service-cards.mjs SERVICE_MODULES/PENDING) ولا مدخل لها في MODULE_ROUTES ولا بوابة في `beforeComplete` (service-routes.mjs:89): تُغلق بملاحظة نصية بلا مخرج الوحدة — نمط العطب B15 | ربط المدخل أو إضافة بوابة إغلاق |
| `PMO-NEW-PROJECT` | طلب فتح مشروع | الإدارة التنفيذية للمشاريع | service-catalog.mjs:488 — بطاقتها تُظهر وحدة `commercial` (service-cards.mjs SERVICE_MODULES/PENDING) ولا مدخل لها في MODULE_ROUTES ولا بوابة في `beforeComplete` (service-routes.mjs:89): تُغلق بملاحظة نصية بلا مخرج الوحدة — نمط العطب B15 | ربط المدخل أو إضافة بوابة إغلاق |
| `GOV-CONFLICT-DISCLOSURE` | إفصاح عن تضارب مصالح | الحوكمة والالتزام والمخاطر | service-catalog.mjs:521 — بطاقتها تُظهر وحدة `procurement-extras` (service-cards.mjs SERVICE_MODULES/PENDING) ولا مدخل لها في MODULE_ROUTES ولا بوابة في `beforeComplete` (service-routes.mjs:89): تُغلق بملاحظة نصية بلا مخرج الوحدة — نمط العطب B15 | ربط المدخل أو إضافة بوابة إغلاق |
| `LEG-PRIVACY-REQUEST` | طلب يتعلق بالبيانات الشخصية | الحوكمة والالتزام والمخاطر | service-catalog.mjs:350 — CHAIN_PROPOSALS (service-catalog.mjs:975+) يصمّم لها خطوة اعتماد ثانية، و`approval_policy_adoptions`=0 صفًّا: الخطوة غير حيّة، فالقرار اليوم بخطوة واحدة؛ وبطاقتها تُظهر وحدة `privacy` بلا بوابة إغلاق في `beforeComplete` | تبنّي سلسلة الاعتماد |
| `FIN-CLIENT-INVOICE` | طلب إصدار فاتورة لعميل | المالية | service-catalog.mjs:301 — بطاقتها تُظهر وحدة `receivables` (service-cards.mjs SERVICE_MODULES/PENDING) ولا مدخل لها في MODULE_ROUTES ولا بوابة في `beforeComplete` (service-routes.mjs:89): تُغلق بملاحظة نصية بلا مخرج الوحدة — نمط العطب B15 | ربط المدخل أو إضافة بوابة إغلاق |
| `FIN-PAYMENT-REQUEST` | طلب صرف لمورد | المالية | service-catalog.mjs:288 — بطاقتها تُظهر وحدة `payables` (service-cards.mjs SERVICE_MODULES/PENDING) ولا مدخل لها في MODULE_ROUTES ولا بوابة في `beforeComplete` (service-routes.mjs:89): تُغلق بملاحظة نصية بلا مخرج الوحدة — نمط العطب B15 | ربط المدخل أو إضافة بوابة إغلاق |
| `FIN-REFUND` | طلب إشعار دائن أو استرداد | المالية | service-catalog.mjs:681 — بطاقتها تُظهر وحدة `invoices` (service-cards.mjs SERVICE_MODULES/PENDING) ولا مدخل لها في MODULE_ROUTES ولا بوابة في `beforeComplete` (service-routes.mjs:89): تُغلق بملاحظة نصية بلا مخرج الوحدة — نمط العطب B15 | ربط المدخل أو إضافة بوابة إغلاق |
| `PRC-EMERGENCY` | شراء طارئ | المشتريات | service-catalog.mjs:692 — بطاقتها تُظهر وحدة `procurement-extras` (service-cards.mjs SERVICE_MODULES/PENDING) ولا مدخل لها في MODULE_ROUTES ولا بوابة في `beforeComplete` (service-routes.mjs:89): تُغلق بملاحظة نصية بلا مخرج الوحدة — نمط العطب B15 | ربط المدخل أو إضافة بوابة إغلاق |
| `PRC-PO-CHANGE` | تعديل أمر شراء | المشتريات | service-catalog.mjs:686 — بطاقتها تُظهر وحدة `procurement-extras` (service-cards.mjs SERVICE_MODULES/PENDING) ولا مدخل لها في MODULE_ROUTES ولا بوابة في `beforeComplete` (service-routes.mjs:89): تُغلق بملاحظة نصية بلا مخرج الوحدة — نمط العطب B15 | ربط المدخل أو إضافة بوابة إغلاق |
| `PRC-PURCHASE-REQUEST` | طلب شراء | المشتريات | service-catalog.mjs:321 — بطاقتها تُظهر وحدة `procurement` (service-cards.mjs SERVICE_MODULES/PENDING) ولا مدخل لها في MODULE_ROUTES ولا بوابة في `beforeComplete` (service-routes.mjs:89): تُغلق بملاحظة نصية بلا مخرج الوحدة — نمط العطب B15 | ربط المدخل أو إضافة بوابة إغلاق |
| `PRC-VENDOR-BANK` | تحديث حساب مورد البنكي | المشتريات | service-catalog.mjs:697 — CHAIN_PROPOSALS (service-catalog.mjs:975+) يصمّم لها خطوة اعتماد ثانية، و`approval_policy_adoptions`=0 صفًّا: الخطوة غير حيّة، فالقرار اليوم بخطوة واحدة | تبنّي سلسلة الاعتماد |
| `PRC-VENDOR-EVALUATION` | تقييم أداء مورد | المشتريات | service-catalog.mjs:701 — بطاقتها تُظهر وحدة `vendors` (service-cards.mjs SERVICE_MODULES/PENDING) ولا مدخل لها في MODULE_ROUTES ولا بوابة في `beforeComplete` (service-routes.mjs:89): تُغلق بملاحظة نصية بلا مخرج الوحدة — نمط العطب B15 | ربط المدخل أو إضافة بوابة إغلاق |
| `PRC-VENDOR-REGISTRATION` | تسجيل مورد جديد | المشتريات | service-catalog.mjs:327 — بطاقتها تُظهر وحدة `vendors` (service-cards.mjs SERVICE_MODULES/PENDING) ولا مدخل لها في MODULE_ROUTES ولا بوابة في `beforeComplete` (service-routes.mjs:89): تُغلق بملاحظة نصية بلا مخرج الوحدة — نمط العطب B15 | ربط المدخل أو إضافة بوابة إغلاق |
| `IT-NEW-ACCOUNT` | تجهيز حسابات موظف جديد | تقنية المعلومات | service-catalog.mjs:195 — CHAIN_PROPOSALS (service-catalog.mjs:975+) يصمّم لها خطوة اعتماد ثانية، و`approval_policy_adoptions`=0 صفًّا: الخطوة غير حيّة، فالقرار اليوم بخطوة واحدة؛ وبطاقتها تُظهر وحدة `lifecycle` بلا بوابة إغلاق في `beforeComplete` | تبنّي سلسلة الاعتماد |
| `IT-OUTAGE` | بلاغ توقف خدمة أو بطء | تقنية المعلومات | service-catalog.mjs:617 — TARGET_PROPOSALS يصمّم لها زمنًا مستهدفًا، و`service_target_adoptions`=0 صفًّا؛ ولا وحدة تكررها: observability.mjs (50 سطرًا) لقطة صحة لا سجل انقطاع | تبنّي المسار/الزمن المستهدف |
| `IT-PASSWORD-UNLOCK` | استعادة كلمة المرور | تقنية المعلومات | service-catalog.mjs:605 — TARGET_PROPOSALS يصمّم لها زمنًا مستهدفًا، و`service_target_adoptions`=0 صفًّا | تبنّي المسار/الزمن المستهدف |
| `IT-SECURITY-INCIDENT` | بلاغ أمني | تقنية المعلومات | service-catalog.mjs:189 — TARGET_PROPOSALS يصمّم لها زمنًا مستهدفًا، و`service_target_adoptions`=0 صفًّا؛ ولا وحدة تكررها: security-alerts.mjs (39 سطرًا) مُنبِّه لا سجل حوادث | تبنّي المسار/الزمن المستهدف |
| `HR-BANK-CHANGE` | تغيير حساب الراتب البنكي | رأس المال البشري | service-catalog.mjs:567 — CHAIN_PROPOSALS (service-catalog.mjs:975+) يصمّم لها خطوة اعتماد ثانية، و`approval_policy_adoptions`=0 صفًّا: الخطوة غير حيّة، فالقرار اليوم بخطوة واحدة؛ وبطاقتها تُظهر وحدة `payroll-extras` بلا بوابة إغلاق في `beforeComplete`؛ 1 طلب قائم | تبنّي سلسلة الاعتماد |
| `HR-HIRING-NEED` | طلب احتياج وظيفي | رأس المال البشري | service-catalog.mjs:588 — بطاقتها تُظهر وحدة `people` (service-cards.mjs SERVICE_MODULES/PENDING) ولا مدخل لها في MODULE_ROUTES ولا بوابة في `beforeComplete` (service-routes.mjs:89): تُغلق بملاحظة نصية بلا مخرج الوحدة — نمط العطب B15 | ربط المدخل أو إضافة بوابة إغلاق |
| `HR-RETRO-ADJUSTMENT` | تسوية مالية بأثر رجعي | رأس المال البشري | service-catalog.mjs:577 — بطاقتها تُظهر وحدة `payroll-extras` (service-cards.mjs SERVICE_MODULES/PENDING) ولا مدخل لها في MODULE_ROUTES ولا بوابة في `beforeComplete` (service-routes.mjs:89): تُغلق بملاحظة نصية بلا مخرج الوحدة — نمط العطب B15 | ربط المدخل أو إضافة بوابة إغلاق |
| `ADM-ACCESS-CARD` | بطاقة موظف أو بطاقة دخول | مكتب الرئيس التنفيذي | service-catalog.mjs:647 — policyProposals/B2 (service-catalog.mjs:1020+) يصمّم لها مسارًا مباشرًا، و`approval_policy_adoptions`=0: البلاغ ينتظر اعتمادًا قبل أن يصل المنفّذ | تبنّي المسار/الزمن المستهدف |
| `ADM-SAFETY` | بلاغ سلامة | مكتب الرئيس التنفيذي | service-catalog.mjs:277 — policyProposals/B2 (service-catalog.mjs:1020+) يصمّم لها مسارًا مباشرًا، و`approval_policy_adoptions`=0: البلاغ ينتظر اعتمادًا قبل أن يصل المنفّذ؛ TARGET_PROPOSALS يصمّم لها زمنًا مستهدفًا، و`service_target_adoptions`=0 صفًّا؛ ولا وحدة تكررها: لا سجل سلامة في المخطط | تبنّي المسار/الزمن المستهدف |
| `ADM-TRAVEL` | انتداب | مكتب الرئيس التنفيذي | service-catalog.mjs:242 — بطاقتها تُظهر وحدة `travel` (service-cards.mjs SERVICE_MODULES/PENDING) ولا مدخل لها في MODULE_ROUTES ولا بوابة في `beforeComplete` (service-routes.mjs:89): تُغلق بملاحظة نصية بلا مخرج الوحدة — نمط العطب B15؛ 1 طلب قائم | ربط المدخل أو إضافة بوابة إغلاق |

### keep — 79 خدمة

| الرمز | الاسم | الإدارة | الدليل | القرار المطلوب من المالك |
|---|---|---|---|---|
| `CRM-LOSS` | تسجيل خسارة فرصة | إدارة الأعمال | service-catalog.mjs:815 — خيار في بطاقة `VAR-OPPORTUNITY` (service-catalog.mjs:1579+)، ولا وحدة تكررها | — |
| `STR-CAMPAIGN-PLAN` | خطة حملة وقنوات | إدارة الأعمال | service-catalog.mjs:803 — خيار في بطاقة `VAR-RESEARCH` (service-catalog.mjs:1579+)، ولا وحدة تكررها | — |
| `STR-COMPETITOR` | تحليل منافسين | إدارة الأعمال | service-catalog.mjs:794 — خيار في بطاقة `VAR-RESEARCH` (service-catalog.mjs:1579+)، ولا وحدة تكررها | — |
| `STR-PITCH-SUPPORT` | دعم عرض أو منافسة | إدارة الأعمال | service-catalog.mjs:462 — خيار في بطاقة `VAR-RESEARCH` (service-catalog.mjs:1579+)، ولا وحدة تكررها | — |
| `STR-POST-CAMPAIGN` | مراجعة ما بعد الحملة | إدارة الأعمال | service-catalog.mjs:799 — خيار في بطاقة `VAR-RESEARCH` (service-catalog.mjs:1579+)، ولا وحدة تكررها | — |
| `STR-RESEARCH` | بحث أو تحليل سوق | إدارة الأعمال | service-catalog.mjs:457 — خيار في بطاقة `VAR-RESEARCH` (service-catalog.mjs:1579+)، ولا وحدة تكررها | — |
| `PRO-EDIT-REVIEW` | مونتاج أو مراجعة نسخة | إدارة الإنتاج | service-catalog.mjs:770 — خيار في بطاقة `VAR-PRODUCTION` (service-catalog.mjs:1579+)، ولا وحدة تكررها | — |
| `PRO-EVENT` | تنظيم فعالية لعميل | إدارة الإنتاج | service-catalog.mjs:443 — خيار في بطاقة `VAR-PRODUCTION` (service-catalog.mjs:1579+)، ولا وحدة تكررها | — |
| `ACC-ESCALATION` | تصعيد حساب عميل | إدارة الحسابات | service-catalog.mjs:922 — خيار في بطاقة `VAR-CLIENT` (service-catalog.mjs:1579+)، ولا وحدة تكررها | — |
| `CRT-CONTENT` | طلب كتابة محتوى | إدارة الخدمات الإبداعية | service-catalog.mjs:209 — خيار في بطاقة `VAR-CREATIVE` (service-catalog.mjs:1579+)، ولا وحدة تكررها | — |
| `CRT-REVISION` | طلب تعديل على مخرج | إدارة الخدمات الإبداعية | service-catalog.mjs:632 — خيار في بطاقة `VAR-CREATIVE` (service-catalog.mjs:1579+)، ولا وحدة تكررها | — |
| `CRT-TRANSLATION` | ترجمة أو تدقيق لغوي | إدارة الخدمات الإبداعية | service-catalog.mjs:641 — خيار في بطاقة `VAR-CREATIVE` (service-catalog.mjs:1579+)، ولا وحدة تكررها | — |
| `PR-EVENT-MEDIA` | دعوات واعتمادات إعلامية | إدارة العلاقات العامة والمؤثرين | service-catalog.mjs:723 — خيار في بطاقة `VAR-PR` (service-catalog.mjs:1579+)، ولا وحدة تكررها | — |
| `PR-IMPACT-REPORT` | تقرير تغطية وأثر إعلامي | إدارة العلاقات العامة والمؤثرين | service-catalog.mjs:728 — خيار في بطاقة `VAR-PR` (service-catalog.mjs:1579+)، ولا وحدة تكررها | — |
| `PR-MEDIA-REQUEST` | بيان صحفي أو ظهور إعلامي | إدارة العلاقات العامة والمؤثرين | service-catalog.mjs:395 — خيار في بطاقة `VAR-PR` (service-catalog.mjs:1579+)، ولا وحدة تكررها | — |
| `BRAND-ASSET-CREATE` | إنشاء أصل هوية | إدارة العلامة التجارية | service-catalog.mjs:889 — خيار في بطاقة `VAR-BRAND` (service-catalog.mjs:1579+)، ولا وحدة تكررها | — |
| `BRAND-COMPLIANCE` | مراجعة التزام بالهوية | إدارة العلامة التجارية | service-catalog.mjs:883 — خيار في بطاقة `VAR-BRAND` (service-catalog.mjs:1579+)، ولا وحدة تكررها | — |
| `BRAND-MERCH` | مطبوعات وهدايا دعائية | إدارة العلامة التجارية | service-catalog.mjs:898 — خيار في بطاقة `VAR-BRAND` (service-catalog.mjs:1579+)، ولا وحدة تكررها | — |
| `BRAND-NAMING` | اعتماد اسم أو تسمية | إدارة العلامة التجارية | service-catalog.mjs:893 — خيار في بطاقة `VAR-BRAND` (service-catalog.mjs:1579+)، ولا وحدة تكررها | — |
| `CRT-ASSET-REQUEST` | طلب أصل من المكتبة الرقمية | إدارة العلامة التجارية | service-catalog.mjs:637 — خيار في بطاقة `VAR-BRAND` (service-catalog.mjs:1579+)، ولا وحدة تكررها | — |
| `DAT-DATA-ACCESS` | طلب وصول لبيانات | إدارة تدقيق الحملات | service-catalog.mjs:546 — خيار في بطاقة `VAR-DATA` (service-catalog.mjs:1579+)، ولا وحدة تكررها | — |
| `DAT-DATA-QUALITY` | بلاغ خطأ في بيانات | إدارة تدقيق الحملات | service-catalog.mjs:871 — خيار في بطاقة `VAR-DATA` (service-catalog.mjs:1579+)، ولا وحدة تكررها | — |
| `DAT-KNOWLEDGE` | إضافة محتوى لقاعدة المعرفة | إدارة تدقيق الحملات | service-catalog.mjs:866 — خيار في بطاقة `VAR-DATA` (service-catalog.mjs:1579+)، ولا وحدة تكررها | — |
| `DAT-PROFITABILITY` | تحليل ربحية مشروع أو عميل | إدارة تدقيق الحملات | service-catalog.mjs:862 — خيار في بطاقة `VAR-REPORT` (service-catalog.mjs:1579+)، ولا وحدة تكررها | — |
| `DAT-ROI` | قياس عائد مبادرة | إدارة تدقيق الحملات | service-catalog.mjs:875 — خيار في بطاقة `VAR-REPORT` (service-catalog.mjs:1579+)، ولا وحدة تكررها | — |
| `GOV-INITIATIVE` | تسجيل مبادرة إستراتيجية | الإدارة التنفيذية للمشاريع | service-catalog.mjs:854 — خيار في بطاقة `VAR-STRATEGY` (service-catalog.mjs:1579+)، ولا وحدة تكررها | — |
| `GOV-OBJECTIVE` | اعتماد هدف أو مؤشر | الإدارة التنفيذية للمشاريع | service-catalog.mjs:531 — خيار في بطاقة `VAR-STRATEGY` (service-catalog.mjs:1579+)، ولا وحدة تكررها | — |
| `PMO-CLOSURE` | إقفال مشروع | الإدارة التنفيذية للمشاريع | service-catalog.mjs:838 — خيار في بطاقة `VAR-PROJECT` (service-catalog.mjs:1579+)، ولا وحدة تكررها | — |
| `PMO-RESOURCE` | طلب موارد لمشروع | الإدارة التنفيذية للمشاريع | service-catalog.mjs:497 — خيار في بطاقة `VAR-PROJECT` (service-catalog.mjs:1579+)، ولا وحدة تكررها | — |
| `PMO-RISK-ISSUE` | بلاغ خطر أو تأخر مشروع | الإدارة التنفيذية للمشاريع | service-catalog.mjs:504 — خيار في بطاقة `VAR-PROJECT` (service-catalog.mjs:1579+)، ولا وحدة تكررها | — |
| `PMO-SUBCONTRACT` | إسناد عمل لطرف خارجي | الإدارة التنفيذية للمشاريع | service-catalog.mjs:832 — خيار في بطاقة `VAR-PROJECT` (service-catalog.mjs:1579+)، ولا وحدة تكررها | — |
| `PMO-TIMESHEET` | تصحيح ساعات المشروع | الإدارة التنفيذية للمشاريع | service-catalog.mjs:843 — مدخلها وحدتها: MODULE_ROUTES (module-routes.mjs:10-20) → `timesheets` | — |
| `EXP-ANNOUNCEMENT` | نشر تعميم داخلي | التواصل الداخلي | service-catalog.mjs:368 — خيار في بطاقة `VAR-INTERNAL-COMMS` (service-catalog.mjs:1579+)، ولا وحدة تكررها | — |
| `EXP-FAREWELL` | توديع موظف | التواصل الداخلي | service-catalog.mjs:713 — خيار في بطاقة `VAR-INTERNAL-COMMS` (service-catalog.mjs:1579+)، ولا وحدة تكررها | — |
| `EXP-INTERNAL-EVENT` | فعالية داخلية | التواصل الداخلي | service-catalog.mjs:388 — خيار في بطاقة `VAR-INTERNAL-COMMS` (service-catalog.mjs:1579+)، ولا وحدة تكررها | — |
| `EXP-LEADERSHIP-MEETING` | طلب لقاء مع القيادة | التواصل الداخلي | service-catalog.mjs:718 — خيار في بطاقة `VAR-VOICE` (service-catalog.mjs:1579+)، ولا وحدة تكررها | — |
| `EXP-RECOGNITION` | ترشيح موظف الشهر | التواصل الداخلي | service-catalog.mjs:379 — خيار في بطاقة `VAR-VOICE` (service-catalog.mjs:1579+)، ولا وحدة تكررها | — |
| `EXP-SUGGESTION` | اقتراح تحسين | التواصل الداخلي | service-catalog.mjs:384 — خيار في بطاقة `VAR-VOICE` (service-catalog.mjs:1579+)، ولا وحدة تكررها | — |
| `EXP-SURVEY` | إطلاق استبيان | التواصل الداخلي | service-catalog.mjs:373 — خيار في بطاقة `VAR-VOICE` (service-catalog.mjs:1579+)، ولا وحدة تكررها | — |
| `EXP-WELCOME` | برنامج ترحيب بموظف جديد | التواصل الداخلي | service-catalog.mjs:707 — خيار في بطاقة `VAR-INTERNAL-COMMS` (service-catalog.mjs:1579+)، ولا وحدة تكررها | — |
| `LEG-CONSULTATION` | استشارة قانونية | الحوكمة والالتزام والمخاطر | service-catalog.mjs:346 — خيار في بطاقة `VAR-LEGAL` (service-catalog.mjs:1579+)، ولا وحدة تكررها | — |
| `LEG-CONTRACT-REVIEW` | مراجعة عقد | الحوكمة والالتزام والمخاطر | service-catalog.mjs:334 — خيار في بطاقة `VAR-LEGAL` (service-catalog.mjs:1579+)، ولا وحدة تكررها | — |
| `LEG-IP-RIGHTS` | حقوق ملكية فكرية أو علامة | الحوكمة والالتزام والمخاطر | service-catalog.mjs:354 — خيار في بطاقة `VAR-LEGAL` (service-catalog.mjs:1579+)، ولا وحدة تكررها | — |
| `LEG-LICENSE-PERMIT` | ترخيص أو تصريح حكومي | الحوكمة والالتزام والمخاطر | service-catalog.mjs:362 — خيار في بطاقة `VAR-LEGAL` (service-catalog.mjs:1579+)، ولا وحدة تكررها | — |
| `LEG-NDA` | اتفاقية عدم إفصاح | الحوكمة والالتزام والمخاطر | service-catalog.mjs:341 — خيار في بطاقة `VAR-LEGAL` (service-catalog.mjs:1579+)، ولا وحدة تكررها | — |
| `FIN-COLLECTION-FOLLOWUP` | متابعة تحصيل متأخر | المالية | service-catalog.mjs:314 — خيار في بطاقة `VAR-INVOICE` (service-catalog.mjs:1579+)، ولا وحدة تكررها | — |
| `FIN-CUSTODY` | عهدة نقدية أو تسويتها | المالية | service-catalog.mjs:296 — مدخلها وحدتها: MODULE_ROUTES (module-routes.mjs:10-20) → `expenses` | — |
| `IT-ACCESS` | طلب صلاحية نظام | تقنية المعلومات | service-catalog.mjs:169 — خيار في بطاقة `VAR-IT` (service-catalog.mjs:1579+)، ولا وحدة تكررها | — |
| `IT-CHANGE-REQUEST` | طلب نشر تغيير تقني | تقنية المعلومات | service-catalog.mjs:610 — لا وحدة تكررها: `change_classification_policies` تابع project-intake (نطاق مشروع) لا إدارة تغيير تقني؛ والطلب نفسه هو السجل | — |
| `IT-DEVICE` | طلب جهاز أو ملحقات | تقنية المعلومات | service-catalog.mjs:177 — خيار في بطاقة `VAR-IT` (service-catalog.mjs:1579+)، ولا وحدة تكررها؛ 1 طلب قائم | — |
| `IT-MEETING-SUPPORT` | دعم تقني لاجتماع | تقنية المعلومات | service-catalog.mjs:622 — لا وحدة تكررها: لا وحدة؛ والطلب نفسه هو السجل | — |
| `IT-SOFTWARE` | طلب برنامج أو ترخيص | تقنية المعلومات | service-catalog.mjs:182 — خيار في بطاقة `VAR-IT` (service-catalog.mjs:1579+)، ولا وحدة تكررها | — |
| `IT-SUPPORT` | طلب دعم تقني | تقنية المعلومات | مبذورة في القاعدة (خارج `catalogServices`) — بطاقة مميَّزة + هدف خيار «إصلاح أو دعم فني» في VAR-IT + طلب قائم — مصنَّفة سلفًا؛ 1 طلب قائم | — |
| `HR-ATTENDANCE-FIX` | تصحيح حضور أو استئذان | رأس المال البشري | service-catalog.mjs:118 — مدخلها وحدتها: MODULE_ROUTES (module-routes.mjs:10-20) → `attendance` | — |
| `HR-BENEFIT-CLAIM` | مطالبة مزايا أو تأمين طبي | رأس المال البشري | service-catalog.mjs:144 — قرار مكتوب بإبقائها طلبًا عامًا: KEPT_AS_REQUESTS (module-routes.mjs:23-29) — «التأمين والمزايا» شاشة لموظف الموارد البشرية؛ لا نموذج فيها للموظف. | — |
| `HR-DOC-RENEWAL` | تجديد إقامة أو رخصة | رأس المال البشري | service-catalog.mjs:562 — قرار مكتوب بإبقائها طلبًا عامًا: KEPT_AS_REQUESTS (module-routes.mjs:23-29) — «انتهاء الوثائق» ترصد التواريخ ولا تستقبل طلب تجديد.؛ 1 طلب قائم | — |
| `HR-EXPERIENCE-CERT` | شهادة خبرة | رأس المال البشري | service-catalog.mjs:558 — دورة مغلقة: `beforeComplete` يمنع الإغلاق بلا مخرج وحدة `letters` (service-routes.mjs:89-101) | — |
| `HR-GRIEVANCE` | شكوى أو تظلم سري | رأس المال البشري | service-catalog.mjs:136 — مدخلها وحدتها: MODULE_ROUTES (module-routes.mjs:10-20) → `hr-cases` | — |
| `HR-LETTER` | طلب خطاب وظيفي | رأس المال البشري | مبذورة في القاعدة (خارج `catalogServices`) — بطاقة مميَّزة في الرئيسية + `ROUTED_SERVICES`/`LETTER_WIZARD_LINKS` + طلب قائم — مصنَّفة سلفًا؛ 1 طلب قائم | — |
| `HR-OVERTIME` | اعتماد عمل إضافي | رأس المال البشري | service-catalog.mjs:125 — مدخلها وحدتها: MODULE_ROUTES (module-routes.mjs:10-20) → `attendance` | — |
| `HR-PAYROLL-INQUIRY` | استفسار أو تصحيح في الراتب | رأس المال البشري | service-catalog.mjs:148 — لا وحدة تكررها: payroll-checks.mjs تصدير واحد (فحص) ولا سجل استفسارات؛ والطلب نفسه هو السجل | — |
| `HR-PROFILE-UPDATE` | تحديث البيانات والوثائق الشخصية | رأس المال البشري | service-catalog.mjs:114 — خيار في بطاقة `VAR-PROFILE` (service-catalog.mjs:1579+)، ولا وحدة تكررها | — |
| `HR-RESIGNATION` | استقالة وإخلاء طرف | رأس المال البشري | service-catalog.mjs:140 — دورة مغلقة: `beforeComplete` يمنع الإغلاق بلا مخرج وحدة `resignations` (service-routes.mjs:89-101) | — |
| `HR-SALARY-ADVANCE` | سلفة على الراتب | رأس المال البشري | service-catalog.mjs:153 — قرار مكتوب بإبقائها طلبًا عامًا: KEPT_AS_REQUESTS (module-routes.mjs:23-29) — «حركات الرواتب» لفريق الرواتب؛ لا نموذج سلفة للموظف فيها. | — |
| `HR-SALARY-CERT` | تعريف بالراتب | رأس المال البشري | service-catalog.mjs:109 — دورة مغلقة: `beforeComplete` يمنع الإغلاق بلا مخرج وحدة `letters` (service-routes.mjs:89-101)؛ 1 طلب قائم | — |
| `TAL-PERFORMANCE-REVIEW` | مراجعة تقييم الأداء | رأس المال البشري | service-catalog.mjs:164 — مدخلها وحدتها: MODULE_ROUTES (module-routes.mjs:10-20) → `performance` | — |
| `TAL-TRAINING` | طلب تدريب أو شهادة مهنية | رأس المال البشري | service-catalog.mjs:157 — مدخلها وحدتها: MODULE_ROUTES (module-routes.mjs:10-20) → `growth` | — |
| `ADM-COURIER` | إرسال شحنة أو مستند | مكتب الرئيس التنفيذي | service-catalog.mjs:659 — خيار في بطاقة `VAR-ADMIN` (service-catalog.mjs:1579+)، ولا وحدة تكررها | — |
| `ADM-EXPENSE-CLAIM` | مطالبة مصروفات | مكتب الرئيس التنفيذي | service-catalog.mjs:261 — مدخلها وحدتها: MODULE_ROUTES (module-routes.mjs:10-20) → `expenses` | — |
| `ADM-GOVT-SERVICES` | إنهاء معاملة حكومية | مكتب الرئيس التنفيذي | service-catalog.mjs:665 — لا وحدة تكررها: لا وحدة — التعريف نفسه يقول إن المراجعة تجري خارج المنصة؛ والطلب نفسه هو السجل | — |
| `ADM-MAINTENANCE` | صيانة وإصلاح | مكتب الرئيس التنفيذي | service-catalog.mjs:216 — خيار في بطاقة `VAR-ADMIN` (service-catalog.mjs:1579+)، ولا وحدة تكررها | — |
| `ADM-OUTGOING-LETTER` | مراسلة رسمية صادرة | مكتب الرئيس التنفيذي | service-catalog.mjs:272 — لا وحدة تكررها: لا سجل صادر/وارد في المخطط؛ والطلب نفسه هو السجل | — |
| `ADM-ROOM-BOOKING` | حجز قاعة اجتماعات | مكتب الرئيس التنفيذي | service-catalog.mjs:221 — خيار في بطاقة `VAR-ADMIN` (service-catalog.mjs:1579+)، ولا وحدة تكررها | — |
| `ADM-SUPPLIES` | قرطاسية ومستلزمات مكتبية | مكتب الرئيس التنفيذي | service-catalog.mjs:267 — خيار في بطاقة `VAR-ADMIN` (service-catalog.mjs:1579+)، ولا وحدة تكررها | — |
| `ADM-VEHICLE` | طلب سيارة أو توصيل | مكتب الرئيس التنفيذي | service-catalog.mjs:652 — خيار في بطاقة `VAR-ADMIN` (service-catalog.mjs:1579+)، ولا وحدة تكررها | — |
| `ADM-VISITOR` | تصريح دخول زائر | مكتب الرئيس التنفيذي | service-catalog.mjs:229 — خيار في بطاقة `VAR-ADMIN` (service-catalog.mjs:1579+)، ولا وحدة تكررها؛ 1 طلب قائم | — |
| `ADM-WORKSPACE` | مكتب أو مقعد عمل | مكتب الرئيس التنفيذي | service-catalog.mjs:670 — خيار في بطاقة `VAR-ADMIN` (service-catalog.mjs:1579+)، ولا وحدة تكررها | — |
| `GOV-DECISION` | طلب قرار تنفيذي | مكتب الرئيس التنفيذي | service-catalog.mjs:510 — خيار في بطاقة `VAR-DECISION` (service-catalog.mjs:1579+)، ولا وحدة تكررها | — |
| `GOV-MEETING-ITEM` | إدراج بند في اجتماع | مكتب الرئيس التنفيذي | service-catalog.mjs:849 — خيار في بطاقة `VAR-DECISION` (service-catalog.mjs:1579+)، ولا وحدة تكررها | — |

---

## ٥. لماذا `merge` صفر — وليس إغفالًا

اختبار الازدواج طُبِّق آليًا على الـ139: لكل زوج في **الإدارة نفسها** بـ**سلسلة الاعتماد نفسها**،
حُسب تداخل مجموعتَي الحقول (معامل جاكار) وفُحصت علاقة الاحتواء التام. النتيجة:

- **صفر** علاقة احتواء تام بين أي خدمتين.
- **زوجان** فقط بتداخل ≥ 0.60، وكلاهما سقط عند القراءة:
  - `ADM-MAINTENANCE` ⟷ `ADM-SAFETY` (0.60): يتشاركان `location, description, urgency` ويفترقان في
    `category` ضد `hazard`. وأهم من الحقول: `ADM-SAFETY` له مقترح **مسار مباشر** (`b2-safety-direct`،
    `service-catalog.mjs:1021`) يُوصل البلاغ للمنفّذ بلا اعتماد، و`ADM-MAINTENANCE` لا. فدمجهما يُلزم
    بلاغ السلامة بمسار الصيانة — عكس المقصود.
  - `STR-RESEARCH` ⟷ `STR-COMPETITOR` (0.60): **مدموجان أصلًا** كخيارين في بطاقة `VAR-RESEARCH`.

ثم فُحص أقرب أربعة أزواج «عائلية» قراءةً لا حسابًا (نفس الإدارة ونفس القسم ونفس البطاقة)،
لأن `CREATIVE-BRIEF` كان احتواءً **معنويًا** لا تطابق مفاتيح — فلو اكتُفي بالحساب لفات:

| الزوج | النتيجة | لماذا |
|---|---|---|
| `ACC-ESCALATION` ⟷ `ACC-CLIENT-COMPLAINT` | **ليس ازدواجًا** | أقرب زوج وُجد: `client` و`proposed_action` مشتركان، و`risk`≈`severity`، و`background`≈`complaint`. لكن المُبادِر مختلف: الشكوى **من العميل** تُسجَّل وتُغلق بدليل، والتصعيد **من فريق الحساب** استباقًا «قبل فقد العميل». ولذلك افترقت سلسلتاهما: تصعيدٌ يُرفع عبر المدير، وشكوى تصل مدير الإدارة |
| `BRAND-ASSET-CREATE` ⟷ `CRT-ASSET-REQUEST` | **ليس ازدواجًا** | اتجاهان متضادّان على المكتبة نفسها: إنشاء أصل يُضاف إليها (بـ`due_date`)، وطلب أصل منها (بـ`rights` للتحقق من حقوق الاستخدام). ولا احتواء، والسلسلتان مختلفتان |
| `EXP-WELCOME` ⟷ `EXP-FAREWELL` | **ليس ازدواجًا** | حدثان متقابلان لا مكرَّران؛ يتشاركان `employee_name` وحده، ولوجستياتهما مختلفة (`buddy`+`kit` ضد `format`+`message`) |
| `ADM-COURIER` ⟷ `ADM-OUTGOING-LETTER` | **ليس ازدواجًا** | إرسال شحنة (بعنوان ومحتويات) ضد خطاب صادر يُقيَّد برقم صادر (بموضوع ونص ومفوَّض بالتوقيع)، وسلسلتاهما تختلفان |

**السبب البنيوي لصفر الازدواج:** المنصة حلّت الازدواج داخل العائلة قبل هذا التصنيف، بآلية
البطاقة متعددة الخيارات: **26 بطاقة تجمع 102 من الـ139**. والازدواج الحقيقي الوحيد الذي أنتجه
الاختبار — `CREATIVE-BRIEF` — كان **خارج** `catalogServices` (مبذورًا في القاعدة)، وقد أُخفي.
فصفر `merge` نتيجةٌ مقيسة لآلية تعمل، لا فراغُ فحصٍ.

---

## ٦. فجوات التغطية — بدليل من الإدارات ووظائفها

المرجع المقروء: `docs/traceability.json` — **220 متطلبًا** بمجالٍ ومالكٍ وأولوية، مأخوذة من
`sources/requirements.catalog.json`. والـ139 خدمة تحمل في حقل `req` **166** معرّفًا متمايزًا.
وكل إدارة في `companyDepartments` تُعلن نطاقاتها في حقل `domains`، فالمطابقة تجري إدارةً بإدارة
لا من قائمة عامة.

**نطاقات مكتملة 10/10:** `ACC`، `ADM`، `CRT`، `GOV`. وما دونها مفصَّل أدناه.

### أ. الفجوة الغالبة: **وظيفة لها وحدة تعمل، وليس لها باب في الدليل**

هذه ليست «عائلة بلا خدمة» بل عائلة بلا **مدخل**: الوحدة موجودة وتُشغَّل، والموظف لا يجد لها بطاقة.
وهي النمط نفسه الذي أنتج الـ12 `connect` في الجدول أعلاه.

| المتطلب | الأولوية | الإدارة (نطاقها) | الوحدة القائمة التي تنفّذه |
|---|---|---|---|
| `PR-01` قاعدة الإعلام | P1 | العلاقات العامة (`PR`) | `pr.mjs:53 mediaContactsBoard` + `media_contacts`, `media_lists`, `media_list_members` |
| `PR-02` الخطة الإعلامية | P1 | العلاقات العامة (`PR`) | `media_plans`, `media_plan_lines` |
| `INF-01` سجل المؤثر | P1 | العلاقات العامة (`INF`) | `influencers.mjs` |
| `TAL-03` تقييم المقابلات | P1 | رأس المال البشري (`TAL`) | `people.mjs:72-73` — `schedule_interview` و`evaluate` + `people_evaluations` |
| `TAL-04` العرض الوظيفي | P1 | رأس المال البشري (`TAL`) | `people.mjs:74-76` — `propose_offer`/`approve_offer`/`accept_offer` + حالتا `offer_pending`, `offer_approved` |
| `HR-04` رصيد الإجازة | P1 | رأس المال البشري (`HR`) | وحدة الإجازات، ولها **مدخل بالفعل** خارج `catalogServices`: `HR-LEAVE` في `MODULE_SERVICES` — قرار مقصود لا فجوة |
| `HR-08` الانضمام | P1 | رأس المال البشري (`HR`) | `lifecycle.mjs` + `people_onboarding_tasks` |
| `PAY-01`, `PAY-05`, `PAY-06` قواعد مؤرخة، مراجعة مزدوجة، تحقق مالي | P1 | المالية / رأس المال البشري (`PAY`) | `payroll-rules.mjs`, `payroll-checks.mjs`, `wage-protection.mjs` — ضوابط مسير لا خدمات طلب |
| `FIN-01` الدليل والفترات · `FIN-07` السيولة والبنوك | P1 | المالية (`FIN`) | `ledger.mjs` · `cash-forecast.mjs`, `bank-reconciliation.mjs` |
| `PRC-04` أمر الشراء · `PRC-05` الاستلام · `PRC-06` المطابقة الثلاثية | P1/P2 | المشتريات (`PRC`) | `procurement.mjs`, `procurement-guards.mjs` — والمطابقة مذكورة في `service-routes.mjs:11-14` |
| `LEG-06` الاحتفاظ والحقوق | P1 | الحوكمة (`LEG`) | `retention_rules` |
| `IT-01` هوية مؤسسية · `IT-05` إدارة الأسرار · `IT-08` النسخ والاستعادة · `IT-09` اختبار العزل | P1 | تقنية المعلومات (`IT`) | `tenant-identity.mjs`, `crypto-fields.mjs`, `environment.mjs` — **بنية تحتية لا تُطلَب بنموذج**، ولا يُتوقع لها خدمة |
| `STR-03` فهم الجمهور | P1 | إدارة الأعمال (`STR`) | `insight-scope.mjs` |
| `DIG-04` الإعداد والقياس | P1 | التسويق الرقمي (`DIG`) | `campaigns.mjs` |
| `CRM-06` نسخ العروض | P2 | إدارة الأعمال (`CRM`) | `estimates.mjs`, `pipeline-estimates.mjs` |
| `DAT-05` تحليل الطاقة · `DAT-08` مساعد المعاملات | P2 | تدقيق الحملات (`DAT`) | `resource-weeks.mjs`, `resourcing.mjs` · `ai.mjs`, `policy-assistant.mjs` |
| `PRO-05` جدول التصوير | P2 | الإنتاج (`PRO`) | `shoot_schedule` |
| `EXP-09` التوقيع والهوية | P2 | التواصل الداخلي (`EXP`) | `static/signature.mjs`. **ولا يُقترح لها خدمة:** قاعدة المالك القائمة أن الاعتماد يُلتقط بالهوية إلكترونيًا لا بصورة توقيع على ورقة |

### ب. الفجوة الحقيقية: **لا خدمة ولا وحدة** — خمس وظائف

تُحقَّق كل صفٍّ منها بغياب الجدول وغياب الوحدة معًا (لا `sqlite_master` ولا ملف في `app/`):

| المتطلب | الأولوية | الإدارة | ما ينقص فعلًا | الأثر |
|---|---|---|---|---|
| `PMO-03` الاعتماديات | **P1** | الإدارة التنفيذية للمشاريع | لا جدول اعتماديات بين مهام المشاريع (`medical_dependants` تأمينٌ لا اعتمادية) | أقوى فجوة مقيسة: مشروعٌ بلا اعتماديات لا يُحسب له مسار حرج، و`PMO-CLOSURE` تُغلق بلا فحص ما كان يعتمد عليها |
| `PRO-06` حقوق المشاركين | P2 | إدارة الإنتاج | لا سجل إقرارات ظهور/حقوق للمشاركين في التصوير | تعرّض نظاميّ على عمل عميل: `PRO-SHOOT` و`PRO-FREELANCER` و`PRO-EVENT` تعمل، ولا مكان يحفظ موافقة من ظهر في المخرَج |
| `STR-09` مراجعة الإستراتيجية | P2 | إدارة الأعمال | لا جدول مراجعة دورية للإستراتيجية | `GOV-OBJECTIVE` و`GOV-INITIATIVE` تُسجّل الأهداف، ولا دورة تراجعها |
| `PMO-07` التكلفة المتوقعة | P2 | الإدارة التنفيذية للمشاريع | لا تكلفة متوقعة عند الإتمام على المشروع (`cash-forecast` و`profitability` على مستوى الشركة والربحية لا المشروع) | — |
| `DIG-08` الرصد المجتمعي | P2 | التسويق الرقمي | لا جدول رصد أو إشارات أو انطباع | — |

**الخلاصة على التغطية:** من 220 متطلبًا، الفجوة الحقيقية **خمس وظائف، واحدة منها P1**. وما عدا
ذلك — نحو ثلاثين معرّفًا غير مذكور في `req` — **وظائف مبنيّة تنتظر بابًا، أو بنية تحتية لا تُطلَب
بنموذج أصلًا**. فالمنصة ليست ناقصة الخدمات؛ هي ناقصة المداخل. وهو الحكم نفسه الذي أنتجه
عمود `connect`.

**ولا يُقترح عدد إضافات.** المقترح المحدّد هنا: بابٌ واحد لكل صفٍّ في (أ)، وقرارُ مالكٍ على
الخمس في (ب) — وأولها `PMO-03`.

---

## ٧. حكمٌ على سؤال المالك: أربع خدمات للإبداع مقابل 22 لرأس المال البشري

**الحكم: ليست فجوة تغطية. والمقارنة نفسها غير متكافئة، والعطب الحقيقي في هذه الإدارة شيء آخر
تمامًا — ولم يكن العدد.**

### أ. المقارنة تقارن إدارةً بمجالٍ، لا إدارةً بإدارة

المجال `CRT` — مجال الإبداع في دليل المتطلبات — **مغطًّى 10/10**، وهو واحد من أربعة مجالات
مكتملة من أصل واحد وعشرين. والعشر خدمات الحاملة لمتطلباته موزَّعة على **ثلاث** إدارات:

| الخدمة | الإدارة | متطلب `CRT` |
|---|---|---|
| `CRT-DESIGN` طلب تصميم | الخدمات الإبداعية | `CRT-01`, `CRT-02` |
| `CRT-CONTENT` طلب كتابة محتوى | الخدمات الإبداعية | `CRT-03` |
| `CRT-REVISION` طلب تعديل على مخرج | الخدمات الإبداعية | `CRT-04`, `CRT-05` |
| `CRT-TRANSLATION` ترجمة أو تدقيق لغوي | الخدمات الإبداعية | `CRT-08` |
| `CRT-ASSET-REQUEST` طلب أصل من المكتبة الرقمية | **العلامة التجارية** | `CRT-06`, `CRT-10` |
| `BRAND-ASSET-CREATE` إنشاء أصل هوية | **العلامة التجارية** | `CRT-06` |
| `BRAND-COMPLIANCE` مراجعة التزام بالهوية | **العلامة التجارية** | `CRT-05`, `CRT-08` |
| `BRAND-NAMING` اعتماد اسم أو تسمية | **العلامة التجارية** | `CRT-03` |
| `BRAND-MERCH` مطبوعات وهدايا دعائية | **العلامة التجارية** | `CRT-09` |
| `LEG-IP-RIGHTS` حقوق ملكية فكرية أو علامة | **الحوكمة** | `CRT-07` |

والدليل القاطع على أن هذا تقسيمٌ لا نقص: **`creative` و`brand` تُعلنان النطاق نفسه**
(`service-catalog.mjs:71,76`):

```
{id:'brand',    name:'إدارة العلامة التجارية',   ... domains:['CRT']},
{id:'creative', name:'إدارة الخدمات الإبداعية', ... domains:['CRT']},
```

فالإبداع في هذه الشركة **عشر خدمات موزَّعة على إدارتين تتقاسمان مجالًا واحدًا**، لا أربعًا.
ومجموع الإدارتين 9 خدمات — لا 4.

### ب. والطرف الآخر من المقارنة منتفخ لسبب بنيوي مقروء

`hr` هي **الإدارة الوحيدة في الهيكل التي تحمل ثلاثة نطاقات**: `['HR','TAL','PAY']` — عمليات
رأس المال البشري، والتوظيف والأداء، والرواتب والمزايا. فالـ22 حصيلةُ ثلاثة مجالات، أي نحو
7.3 للمجال؛ و`creative`+`brand` عشر خدمات لمجال واحد. فحين يُقاس المجال بالمجال، **الإبداع
أكثف تغطيةً من رأس المال البشري**، لا أقل.

### ج. ونعم — الإبداع يُنفَّذ في الاستوديو وبطاقة `VAR-CREATIVE`، والدليل قائم

- `VAR-CREATIVE` (`service-catalog.mjs:1644`) تجمع الأربع في بطاقة واحدة: تصميم، محتوى، تعديل
  مخرج، ترجمة — فالموظف يرى **بطاقة واحدة** بخياراتها، لا أربع بطاقات متناثرة.
- و`SERVICE_MODULES` (`service-cards.mjs:31`) يربط `CRT-DESIGN` و`PRO-DELIVERY` (وكانت
  `CREATIVE-BRIEF`) بوحدة **`studio`**: العمل الإبداعي يُنفَّذ في الاستوديو، والخدمة بابٌ إليه.

فالفرضية التي طرحها المالك — «الإبداع يُنفَّذ عبر وحدة الاستوديو وبطاقة `VAR-CREATIVE`» —
**صحيحة بالدليل**، وهي تفسير العدد الصغير: البطاقة والوحدة تغنيان عن تكثير الخدمات.

### د. لكن في هذه الإدارة عطبٌ حقيقي، وليس العدد

`creative` هي **إحدى إدارتين في الهيكل بلا مدير** (`service-catalog.mjs:76`):

```
{id:'creative',name:'إدارة الخدمات الإبداعية',sector:GROWTH,head:null,domains:['CRT']},
```

والثانية `ops` «تشغيل المنصة» — وهي إدارةٌ تقنية بلا خدمات بقصد، فلا يضرّها. أما `creative`
فتملك أربع خدمات حيّة، وسلاسل اعتمادها تنادي `department_manager`. أي أن **الإدارة الأساسية
لشركة إبداعية تستقبل طلبات بمسار اعتماد يشير إلى منصبٍ لا يشغله أحد**، ويُحسم اليوم بآلية
الاحتياط (`approvalFallback`) لا بمدير الإدارة.

**القرار المطلوب من المالك — واحد، وليس «أضف خدمات إبداعية»:** تسمية مدير إدارة الخدمات
الإبداعية (`head-creative`)، أو قرارٌ مكتوب بأن اعتمادها يبقى لمنصبٍ آخر مسمّى. وهذا مما لا
يُنفَّذ بلا المالك: اسم شخص حقيقي في الهيكل.

**وملاحظة ثانية تخصّ ما أُخفي:** «التكليف الإبداعي» في دليل المتطلبات هو `STR-08`، ومالكه
**مدير الإستراتيجية** لا الخدمات الإبداعية. فـ`CREATIVE-BRIEF` — التي أُخفيت في `creative` —
لم تكن تغطّي `STR-08` أصلًا. فإن أراد المالك خدمةَ تكليفٍ إبداعيٍّ يومًا، فموضعها في
**إدارة الأعمال** بمتطلبها، لا إعادةَ إظهارِ ما أُخفي.

---

## ٨. ما لم أستطع الحكم فيه — ولماذا

| البند | لماذا تعذّر |
|---|---|
| **أيّ الخدمات يستعملها الناس فعلًا** | قاعدة المعاينة فيها **عشرة طلبات إجمالًا**، طلبٌ واحد على كل خدمة من عشر. فلا يُقاس رواج ولا إهمال، ولا تُبنى إحالةٌ على صفرٍ هو صفرُ القاعدة. يُحسم بعد تشغيلٍ حقيقي أو ببيانات اصطناعية تُحذف بعد الإثبات |
| **الفرق بين `deepen` و`keep` لـ22 خدمة حسّاسة** | `SOD_SERVICES` تفرض فصل المهام على 22 خدمة في تعريفها نفسه (لا مقترحًا)، وهذا يُغلق شقًّا من الدورة. لكن **أثر الفصل على الأرض** يحتاج تنفيذ طلبٍ فعلي بمستخدمين مختلفين — وهو فحص تشغيل لا قراءة كود، ولم أُجره (ولا أُشغّل اختبارات: وكيل آخر يشغّل الجولة) |
| **هل `LEG-WHISTLEBLOW` تُربط بـ`hr-cases` فعلًا** | صُنّفت `connect` لأن `hr_cases` سجلُّ قضايا بمبلّغ وفئة ومشتكى عليه وزمن مستهدف — وهو ما تسأله الخدمة بالحرف. لكن الوحدة **مقصورة على رأس المال البشري** بنطاق قراءة، والخدمة للحوكمة و`closed_circle`. فمدّ نطاق الوحدة إلى الحوكمة **قرار مالك** على من يقرأ بلاغ مخالفة، لا قرار مهندس |
| **جرد نماذج درايف الـ65** | خارج نطاق هذه الوثيقة، وما زال كما تركته المصفوفة: مجلد واحد مقروء من `FORM_CATALOGUE`. المطابقة على الـ141 لم تُجرَ |
| **`other` «اختبار العزل» في قاعدة التشغيل** | إدارةٌ نشطة اصطناعية بلا خدمة حيّة، فلم تدخل التصنيف. وحذف صفٍّ من قاعدة تعمل قرارُ مالك ومسألةُ نظافةِ بيانات — رُفعت في المصفوفة وتبقى معلَّقة |
| **أيّ الخمس في §٦-ب يستحق البناء أولًا** | رُتِّبت بالأولوية المكتوبة في دليل المتطلبات (`PMO-03` وحدها P1). لكن ترتيب البناء يتوقف على قيمةٍ لا أقيسها: كم مشروعًا فيه اعتماديات فعلية اليوم. القيمة للمالك |

---

## ٩. الخطوة التالية

1. **قرار تبنٍّ واحد** يحرّك 50 خدمة `deepen`: `approval_policy_adoptions` (16 سلسلة + 3 مسارات
   مباشرة) و`service_target_adoptions` (5 أزمنة)، ثم نشر بطاقات الخدمة بعد ملء حقولها الستة.
2. **اثنا عشر بابًا** للخدمات `connect`، تُضاف بالآلية القائمة نفسها (`SERVICE_MODULES` +
   `MODULE_ROUTES`) لا بآلية جديدة. وأثقلها أثرًا: `GOV-POLICY` (وحدتها فيها 127 مادة حيّة)،
   و`HR-JOB-CHANGE` (جدولها `employee_changes` فيه عمود `request_id` مهيَّأ للربط أصلًا).
3. **تسمية مدير إدارة الخدمات الإبداعية** — أو قرار مكتوب ببديله.
4. **قرار المالك على الخمس** في §٦-ب، وأولها `PMO-03` الاعتماديات.
5. `retire`: لا اقتراح جديد. `CREATIVE-BRIEF` وحدها، ومنفَّذة إخفاءً لا حذفًا.
