# تدقيق دورة العميل والمشروع من طرف إلى طرف — 20 سبتمبر 2026

**السؤال:** هل تعمل دورة العميل والمشروع كاملة في المنصة اليوم، وأين تنكسر بالضبط؟

**الجواب في سطر:** الدورة تعمل من تأهيل العميل المحتمل إلى التحصيل الكامل وسداد المورد — 179 نداءً ناجحًا من 181 على نسخة حية — لكنها **لا تُقفل**، ولا تعرف **أمر شراء العميل**، ولا **الدفعة المقدمة**، ولا **أمر المباشرة**، وتنقسم على نفسها في **حالة سداد المورد**. الدورة تمشي ولا تنتهي.

**كيف أُجري التدقيق:** قراءة 31 وحدة ومساراتها في `app/server.mjs`، ثم تشغيل نسخة مؤقتة على المنفذ 3720 بقاعدة مصطنعة جديدة (`scripts/seed.mjs` + `scripts/expand-demo.mjs`)، وقيادة مشروع كامل عبر واجهة HTTP الحقيقية بجلسات حقيقية لكل دور. سجل التشغيل الكامل في §3. لم تُمس قاعدة العمل ولا المنافذ 3600/3601/3630 ولا ملف `.env`.

---

## 1. خريطة المراحل: أين تقع كل خطوة من الـ24

الرموز: **يعمل** = مسار وحالة وبوابة. **جزئي** = يوجد أثر لكنه ناقص حالةً أو بوابةً أو ربطًا. **غائب** = لا مسار ولا كيان.

| # | خطوة دليل العمل | الوحدة | المسار | الحالة المخزنة | التقييم |
|---|---|---|---|---|---|
| 1 | تأهيل العميل المحتمل (BD-01) | `commercial.mjs` | `POST /api/commercial` ثم `/qualify` ثم `/approve_qualification` | `commercial_cases.status`: `lead → qualification_pending → qualified` | **يعمل** — الاعتماد من المدير المباشر، ومعد التأهيل لا يعتمده |
| 2 | ملف العميل وفريق الحساب | `agency.mjs` | `POST /api/clients`، `/add_member`، `/link_case` | `clients.status` (محتمل/نشط/متوقف/مقفل) | **يعمل** — العزل بالعضوية لا بالتصريح |
| 3 | الفرصة وخط الأنابيب | `pipeline-estimates.mjs` | `POST /api/pipeline/stages`، `/opportunities` | `opportunities.status` + `stage_code` | **يعمل** — لا مراحل ولا احتمالات مفترضة في الكود |
| 4 | التسليم الداخلي (BD-04) | — | — | — | **غائب** — لا كيان «تسليم من التطوير إلى إدارة المشروع». الانتقال ضمني: `create_project` |
| 5 | استلام المشروع (PM-01) | `commercial.mjs` + `projects.mjs` | `POST /api/commercial/:id/create_project` | `commercial_cases.status='project_active'` فقط | **جزئي** — `projects` **بلا عمود حالة**؛ لا «مستلم/مبدوء» |
| 6 | الانطلاقة (PM-02) | — | — | — | **غائب** — لا محضر انطلاقة ولا قائمة تحقق. أقرب بديل: `agency.applyTemplate` (قالب مهام) |
| 7 | موجزات الإدارات (إبداع/تصميم/محتوى) | `studio.mjs` | `POST /api/studio` ثم `/submit_brief` `/approve_brief` | `studio_workspaces.status`: `draft → brief_pending → production` | **يعمل** |
| 8 | موجز الإنتاج | `production.mjs` | `POST /api/productions` | `productions.state`: `planning → in_production → wrapped → closed` | **جزئي** — الربط بالمشروع اختياري، والإقفال يزعم فحص التصاريح والإفراجات ولا يفحصها |
| 9 | موجز الحملات | `campaigns.mjs` | `POST /api/campaigns`، `/content` | `campaigns.status`، `content_items.status` | **جزئي** — مربوط بالعميل لا بالمشروع؛ «موافقة العميل» نص حر |
| 10 | موجز العلاقات العامة | `pr.mjs` | `POST /api/pr/lists`، `/pitches` | `pr_pitches.status` | **جزئي** — بلا ربط بمشروع، وبلا عزل فريق الحساب |
| 11 | التسعير (MOD-BD-02) | `estimates.mjs` + `profitability.mjs` | `/api/cost-rates/*`، `/api/estimates/price-cards`، `/api/estimates` | `estimates.status`: `draft → submitted → approved` | **يعمل** — لا سعر افتراضي ولا تكلفة صفرية |
| 12 | عرض السعر للعميل | `estimates.mjs` → `commercial.mjs` | `POST /api/estimates/:id/handoff` ثم `/to-quote` | `commercial_cases.status`: `quote_draft → quote_pending → quote_approved` | **جزئي** — العرض مستند داخلي؛ لا إصدار للعميل ولا صلاحية مُرسَلة ولا رقم عرض |
| 13 | العقد | `commercial.mjs` (+ `contracts-register.mjs`) | `POST /api/commercial/:id/register_contract` | `status='contracted'` | **جزئي** — `internal_only:true` صراحة؛ وسجل العقود المستقل **لا FK** له مع الملف التجاري ولا المشروع |
| 14 | أمر الشراء من العميل | — | — | — | **غائب** — لا حقل ولا كيان ولا بوابة. أقرب بديل: نص `agreement_evidence` الحر |
| 15 | التنفيذ | `projects.mjs`، `studio.mjs`، `resourcing.mjs` | `/api/projects/:id/tasks`، `/api/resourcing/bookings` | `tasks.status`، `resource_bookings.status` | **جزئي** — لا حزمة عمل بإدارة مسؤولة؛ `tasks` جدول مسطح |
| 16 | طلبات التعديل (PM-03) | `review-rounds.mjs` | `POST /api/review-rounds`، `/annotate`، `/decide` | `review_routes.status`، `review_annotations.status` | **يعمل** — ثلاثة قرارات، والتعليق مثبَّت على موضع |
| 17 | موافقة العميل | `client-approvals.mjs` | `POST /api/approvals`، `/verify` | `external_approvals.status`: `pending_evidence → documented → verified` | **يعمل** — ومرحلة العميل في المراجعة لا تُغلق بدونها |
| 18 | تقرير الإنجاز | `commercial.mjs` | `POST /api/commercial/:id/submit_delivery` | `commercial_deliveries` + مراجعة معلقة | **جزئي** — دليل نصي، لا مستند مرقّم |
| 19 | شهادة الإنجاز | `commercial.mjs` | `POST /api/commercial/:id/accept_delivery` | `commercial_reviews.status='approved'` + `evidence_json` | **جزئي** — **البوابة موجودة وتعمل**، لكن الشهادة نفسها نص داخل مراجعة، بلا رقم ولا حالة ولا توقيع طرفين |
| 20 | فاتورة العميل | `receivables.mjs` + `invoices.mjs` | `/api/receivables` → `/api/invoices` → `/submit` `/issue` | `ar_claims.status`، `tax_invoices.status` + سلسلة بصمات | **يعمل** — لا فاتورة بلا استحقاق معتمد، ولا استحقاق بلا مخرج مقبول |
| 21 | قائمة التحقق المالية | `close-checklist.mjs` | `/api/close-checklist/*` | `close_periods`، `close_tasks` | **جزئي** — قائمة إقفال شهري للفترة المحاسبية، لا قائمة تحقق لمشروع |
| 22 | إشعار التحويل والتحصيل | `receivables.mjs` | `/api/receivables/:id/receipts` ثم `/confirm` | `ar_receipts.status`: `pending → confirmed` | **يعمل** — لا يتجاوز الاستحقاق، ومسجل القبض لا يطابقه |
| 23 | اتفاقية خدمة المورد وبطاقة أسعاره | `vendors.mjs` | `POST /api/vendors` + الوثائق | `vendors.status` + `vendor_documents` | **جزئي** — `payment_terms` نص حر؛ لا اتفاقية إطارية ولا بطاقة أسعار مورد |
| 24 | موجز المورد | — | — | — | **غائب** — `procurement_purchases.specification` نص المواصفات، لا موجز مورد |
| 25 | عرض سعر المورد | `procurement.mjs` | `POST /api/procurement/:id/add_quote` | `procurement_quotes` | **يعمل** |
| 26 | التحقق المالي من عروض المنافسة (F-03/F-04) | `procurement.mjs` + `budgets.mjs` | `POST /api/procurement/:id/award` | `procurement_awards` + `project_budget_reservations.status='reserved'` | **يعمل** — ثلاثة عروض، ومخصص معتمد ساري، ومورد مؤهل، ولا ترسية ذاتية |
| 27 | أمر الشراء للمورد | `procurement.mjs` | `POST /api/procurement/:id/approve_order` | `status='ordered'` + `reservations='committed'` | **يعمل** |
| 28 | أمر المباشرة | — | — | — | **غائب** — `POST /api/procurement/:id/commence` يرد `invalid_action` |
| 29 | تنفيذ المورد وتقرير/شهادة الإنجاز | `procurement.mjs` | `POST /api/procurement/:id/receive` | `status='part_received' → 'received'` | **جزئي** — محضر استلام نصي، لا شهادة |
| 30 | فاتورة المورد | `procurement.mjs` | `/record_invoice` ثم `/match` | `procurement_invoices` + `procurement_payables` | **يعمل** — مطابقة ثلاثية حقيقية |
| 31 | سند الدفع وتوثيق التحويل | `payables.mjs` | `/api/payables/orders` → `/approve_order` → `/record_execution` | `payment_orders.status`: `pending → approved → executed` | **يعمل** — ثلاثة أشخاص مختلفون |
| 32 | الفاتورة الضريبية للمورد | `payables.mjs` | `/api/payables/input-tax` ثم `/verify` | `procurement_invoice_tax.status` | **يعمل** |
| 33 | الإقفال الفني | — | — | — | **غائب** |
| 34 | الإقفال المالي | — | — | — | **غائب** — أقرب بديل: `POST /api/budgets/:id/close` (يقفل المخصص لا المشروع) |

---

## 2. البوابات: ما تفرضه المنصة فعلًا وما لا تفرضه

### 2.1 بوابات قائمة وتعمل (مثبتة بالتشغيل الحي وبالاختبارات الجديدة)

| البوابة | أين | الدليل من التشغيل |
|---|---|---|
| معد التأهيل لا يعتمده | `commercial.allowedActions` | نداء 27: `403 commercial_transition` |
| معد التقدير لا يعتمده | `estimates.estimateAction` | نداء 43: `403 self_approval` |
| لا عرض قبل تأهيل معتمد، ولا عقد قبل عرض معتمد، ولا مشروع قبل عقد | `commercial.allowedActions` + `requireApproved` | `tests/delivery-cycle.test.mjs` |
| مرحلة العميل لا تُغلق إلا بموافقة خارجية موثقة على **النسخة نفسها**، والقرار يطابق ما وُثّق | `review-rounds.decideStage` | نداء 76: `409 client_evidence_required` |
| من سلّم لا يقبل تسليمه | `commercial.allowedActions` | نداء 151: `403 commercial_transition` |
| **لا استحقاق قبل قبول المخرج** (هذه هي بوابة «لا فاتورة بلا شهادة إنجاز» كما تنفذها المنصة) | `receivables.createClaim` | نداء 159: `404 delivery_not_billable` |
| لا فاتورة بلا استحقاق معتمد | `invoices.prepareInvoice` | نداء 158: `404 claim_not_billable` |
| من أعدّ الفاتورة لا يصدرها | `invoices.actionsFor` | نداء 165: `403 transition_denied` |
| التحصيل لا يتجاوز الاستحقاق، ومسجل القبض لا يطابقه | `receivables.recordReceipt` / `receiptAction` | نداءات 168–171 |
| الترسية تحتاج ثلاثة عروض، أو شراء طارئ معتمد | `procurement.award` | نداء 128: `409 comparison_required` |
| طالب الشراء لا يرسي طلبه | `procurement.allowedActions` | نداء 132: `403 transition_denied` |
| **لا ترسية بلا مخصص مشروع معتمد وساري لنفس مركز التكلفة وموعد الاحتياج** | `budgets.usableBudget` | `tests/delivery-cycle.test.mjs`: `project_budget_required` |
| مورد مسجل غير مؤهل لا يُرسى عليه إلا باستثناء مفوض | `vendors.requireVendorGate` | `tests/delivery-cycle.test.mjs`: `vendor_blocked` |
| لا استلام قبل أمر الشراء | `procurement.allowedActions` | نداء 134: `403 transition_denied` |
| مسجل فاتورة المورد لا يعتمد مطابقتها، والمطابقة ثلاثية حقيقية | `procurement.match` | نداء 139: `403 transition_denied` |
| المورد لا يُدفع له قبل التأهيل وحساب بنكي متحقق منه وساري | `payables.payee` | `tests/payables.test.mjs` |
| معد أمر الدفع لا يعتمده، ومن اعتمده لا يوثق تنفيذه، وجامع بيانات الحساب لا يوثقه | `payables.orderView` | نداءان 143 و145: `409 action_unavailable` |
| اعتماد المخرج يحتاج نجاح فحوص الجودة الخمسة، وحزمة التسليم لا تضم إلا مخرجات معتمدة بأصول مفحوصة وحقوق سارية | `studio.mjs` | `tests/studio.test.mjs` |

### 2.2 بوابات يفرضها دليل العمل ولا تفرضها المنصة

| البوابة المطلوبة | الواقع | الدليل |
|---|---|---|
| **لا تنفيذ قبل تأكيد الدفعة المقدمة** | لا كيان «دفعة مقدمة» على الملف التجاري ولا شرط عليه. بعد `create_project` مباشرة نجح `submit_delivery` و`budgets` و`procurement` بلا أي مقبوض | نداء 150 نجح، وأول قبض مؤكد كان في النداء 169 |
| **لا بدء للمورد قبل أمر شراء + أمر مباشرة** | النصف الأول موجود، والنصف الثاني غائب تمامًا | نداء 136: `400 invalid_action` |
| أمر شراء العميل شرط للتنفيذ | لا كيان ولا حقل | نداء 50 سجّل عقدًا في سجل منفصل لا يعرف الملف التجاري |
| إقفال فني ثم مالي | لا إجراء ولا حالة | نداء 174: `400 unknown_action`؛ نداء 173: الحالة بقيت `project_active` بعد التحصيل الكامل |

---

## 3. سجل التشغيل الحي

**البيئة:** قاعدة `sqlite` مصطنعة جديدة في مجلد مؤقت، مفتاح حقول عشوائي، منفذ 3720، كلمة مرور عشوائية لم تُطبع ولم تُكتب في متصفح. الجلسات أُنشئت عبر `POST /api/login` بالمساعد البرمجي. أُوقف الخادم وحُذفت القاعدة بعد التشغيل.

**الحسابات:** `admin` (أدمن أول)، `manager` (مدير الفريق الإبداعي)، `employee` (مسؤول الحساب/معد المعاملة)، `pm` (مدير مشروع)، `finance-preparer` / `finance-approver` / `finance-treasury` (ثلاثة تفويضات مالية منفصلة)، `producer` (إدارة ثانية).

**النتيجة الإجمالية: 179 نداء ناجح من 181.** النداءان الفاشلان هما محاولتا استدعاء ما لا وجود له (`close_financially`، وأول صياغة لسجل العقود).

### 3.1 الخطوات بالترتيب

| # | الخطوة | الفاعل | النداء | النتيجة |
|---|---|---|---|---|
| 1–24 | منح التصاريح | `admin` | `POST /api/access/grants` ×24 | 201 لكل منح |
| 25–28 | تأهيل العميل المحتمل | `employee` ثم `manager` | `/commercial`, `/qualify`, `/approve_qualification` | 201، و**403 على الاعتماد الذاتي** |
| 29–32 | ملف العميل وفريقه وربطه بالملف التجاري | `employee` | `/clients`, `/add_member`×2, `/link_case` | 201 |
| 33–35 | مرحلة خط الأنابيب وفرصة | `employee`+`manager` | `/pipeline/stages`, `/approve_stage`, `/opportunities` | 201 |
| 36–38 | فئة تكلفة ومعدل ساعة معتمد | `employee`+`manager` | `/cost-rates/categories`, `/rates`, `/approve_rate` | 201 |
| 39–40 | بطاقة أسعار معتمدة | `employee`+`manager` | `/estimates/price-cards`, `/approve_card` | 201 |
| 41–45 | تقدير بمصفوفة دور×مخرج، اعتماده، تحميله | `employee`+`manager` | `/estimates`, `/submit`, `/approve`, `/handoff` | 201، و**403 على الاعتماد الذاتي** |
| 46–48 | بناء عرض السعر من التقدير واعتماده | `employee`+`manager` | `/estimates/:id/to-quote`, `/submit_quote`, `/approve_quote` | 201 |
| 49 | تسجيل العقد | `employee` | `/commercial/:id/register_contract` | 201 — واللقطة تحمل `internal_only:true` |
| 50–51 | **أمر شراء العميل** | `manager`+`pm` | `/contracts-register` ثم `/activate_contract` | 201 في **سجل منفصل بلا FK** إلى الملف التجاري أو المشروع |
| 52 | محاولة تنفيذ قبل الدفعة المقدمة | `employee` | `/submit_delivery` | 403 — **لكن السبب أن المشروع لم يُفتح بعد، لا أن دفعة مقدمة مطلوبة** |
| 53 | فتح المشروع | `manager` | `/create_project` | 201 |
| 54–55 | إدارة ثانية وموظف فيها | `admin` | `/admin/departments`, `/admin/accounts` | 201 |
| 56–57 | حزمتا عمل | `manager` | `/projects/:id/tasks` ×2 | 201 |
| 58 | **حزمة عمل لموظف إدارة أخرى** | `manager` | `/projects/:id/tasks` | **400 `assignee`** |
| 59–62 | سعة أسبوعية وحجز مؤكد | `manager` | `/resourcing/capacity` ×2، `/bookings`, `/confirm` | 201 |
| 63–70 | موجز الاستوديو واعتماده، أصل مفحوص، مخرج معتمد بخمسة فحوص | `employee`+`manager` | `/studio/*` | 201 |
| 71–75 | جولة مراجعة بمرحلتين، مادة، تعليق مثبت، قرار داخلي | `pm`+`manager` | `/review-rounds/*` | 201 |
| 76 | **إغلاق مرحلة العميل بلا دليل** | `manager` | `/decide` | **409 `client_evidence_required`** |
| 77–82 | تسجيل مفوض العميل، توثيق موافقته، التحقق منها، ثم إغلاق مرحلة العميل | `employee`+`pm`+`manager` | `/approvals/*`, `/decide` | 201 |
| 83–120 | تسجيل المورد وتأهيله: جهة اتصال موثقة، حساب بنكي مقترح ومتحقق منه، أربع وثائق، خمس مراجعات، اعتماد | `employee`/`manager`/`pm` | `/vendors/*` (38 نداء) | 201 لكل خطوة |
| 121–125 | نطاق مالي للمشروع، مخصص مُعد ومقدَّم ومعتمد | `manager`+`finance-*` | `/finance-scope`, `/budgets`, `/submit`, `/approve` | 201 |
| 126–127 | احتياج المورد وتقديمه | `employee` | `/procurement`, `/submit` | 201 |
| 128 | **ترسية بعرض واحد** | `manager` | `/award` | **409 `comparison_required`** |
| 129–131 | ثلاثة عروض موردين | `employee` | `/add_quote` ×3 | 201 |
| 132 | **ترسية ذاتية** | `employee` | `/award` | **403 `transition_denied`** |
| 133 | الترسية (نظير F-03/F-04) | `manager` | `/award` | 201 — حجزت المخصص |
| 134 | **استلام قبل أمر الشراء** | `employee` | `/receive` | **403 `transition_denied`** |
| 135 | أمر الشراء للمورد | `manager` | `/approve_order` | 201 — حوّلت الحجز إلى التزام |
| 136 | **أمر المباشرة** | `manager` | `/commence` | **400 `invalid_action` — لا مسار** |
| 137–138 | استلام العمل وفاتورة المورد | `employee` | `/receive`, `/record_invoice` | 201 |
| 139 | **مطابقة ذاتية** | `employee` | `/match` | **403 `transition_denied`** |
| 140 | المطابقة الثلاثية | `manager` | `/match` | 201 — نشأ مستحق 35,000 ريال |
| 141–142 | إعداد أمر الدفع | `finance-preparer` | `/payables/orders` | 201 |
| 143 | **اعتماد ذاتي لأمر الدفع** | `finance-preparer` | `/approve_order` | **409 `action_unavailable`** |
| 144 | اعتماد أمر الدفع | `finance-approver` | `/approve_order` | 201 |
| 145 | **من اعتمد يوثق التنفيذ** | `finance-approver` | `/record_execution` | **409 `action_unavailable`** |
| 146 | توثيق التحويل | `finance-treasury` | `/record_execution` | 201 — `executed_minor = 3,500,000` هللة |
| 147–148 | الفاتورة الضريبية للمورد والتحقق منها | `finance-preparer`+`finance-approver` | `/payables/input-tax`, `/verify` | 201 |
| 149–150 | تقرير الإنجاز للبند الأول | `employee` | `/submit_delivery` | 201 — **بلا أي مقبوض من العميل حتى الآن** |
| 151 | **قبول ذاتي** | `employee` | `/accept_delivery` | **403 `commercial_transition`** |
| 152 | شهادة الإنجاز (قبول المخرج) | `manager` | `/accept_delivery` | 201 |
| 153–154 | البند الثاني: سُلّم ولم يُقبل | `employee` | `/submit_delivery` | 201 |
| 155–157 | البيانات الضريبية للمنشأة واعتمادها، وللعميل | `finance-*` | `/invoices/company-profiles`, `/approve`, `/customer-profiles` | 201 |
| 158 | **فاتورة بلا استحقاق معتمد** | `finance-preparer` | `/invoices` | **404 `claim_not_billable`** |
| 159 | **استحقاق على مخرج لم يُقبل** | `finance-preparer` | `/receivables` | **404 `delivery_not_billable`** |
| 160–162 | استحقاق مُعد ومقدَّم ومعتمد | `finance-*` | `/receivables`, `/submit`, `/approve` | 201 |
| 163–164 | إعداد فاتورة العميل وتقديمها | `finance-preparer` | `/invoices`, `/submit` | 201 |
| 165 | **إصدار ذاتي** | `finance-preparer` | `/issue` | **403 `transition_denied`** |
| 166 | إصدار الفاتورة | `finance-approver` | `/issue` | 201 — رقم متسلسل وبصمة مسلسلة ورمز QR |
| 167–171 | دفعة جزئية 15,000 ثم تكملة 25,000، كل منهما بمطابقة مستقلة | `finance-*` | `/receipts`, `/confirm` ×2 | 201 — الرصيد صفر |
| 172–173 | **حالة الملف بعد التحصيل الكامل** | — | `GET /commercial` | **`project_active` — لم تتغير** |
| 174 | **الإقفال الفني** | `manager` | `/close_project` | **400 `unknown_action`** |
| 175 | **الإقفال المالي** | `finance-approver` | `/close_financially` | **404 — الإجراء غير موجود** |
| 176 | إقفال المخصص (أقرب بديل) | `finance-approver` | `/budgets/:id/close` | 201 — يقفل المخصص لا المشروع |

### 3.2 اللقطة النهائية بعد اكتمال الدورة

```json
{
  "case":        { "status": "project_active", "deliveries": 2 },
  "receivables": [{ "status": "approved", "amount": "4000000", "confirmed": "4000000",
                    "balance": "0", "bucket": "مسدد داخليًا" }],
  "invoices":    { "invoiced_minor": 4000000, "output_vat_minor": 521739 },
  "payables":    { "unpaid_minor": 0, "executed_minor": 3500000,
                   "verified_input_vat_minor": 456522 },
  "procurement": [{ "status": "received", "payment_status": "not_paid",
                    "posting_status": "not_posted", "payable_minor": 3500000 }],
  "projects":    [{ "keys": ["id","tenant_id","name","brief","created_by","created_at"],
                    "tasks": 2 }]
}
```

ثلاث حقائق في هذه اللقطة:

1. **`procurement.payment_status = "not_paid"` بينما `payables.executed_minor = 3,500,000`.** الشاشتان تتناقضان على الحدث نفسه.
2. **`projects` بلا عمود حالة.** المشروع كائن بلا دورة حياة.
3. **الملف التجاري بقي `project_active`** بعد تسليم وقبول وفوترة وتحصيل كامل وسداد مورد.

---

## 4. الكسور مرتبة بالخطورة

### حرجة — تمنع الاعتماد على المنصة كسجل وحيد

**B1 — لا شيء يربط التنفيذ بالدفعة المقدمة.**
لا كيان «دفعة مقدمة» على الملف التجاري. `ar_claims` تولد من مخرج **مقبول** فقط، فلا يمكن أصلًا إنشاء استحقاق دفعة مقدمة قبل التسليم. النتيجة: كل مشروع في المنصة يبدأ التنفيذ ويُنفق على الموردين بلا أي مقبوض، والمنصة لا ترى ذلك ولا تقوله. **الأثر المالي مباشر.**
*الدليل:* نداءات 125 (مخصص معتمد)، 135 (أمر شراء مورد)، 146 (تحويل منفذ 35,000)، 150 (تسليم) — كلها قبل أول قبض مؤكد في النداء 169.

**B2 — لا إقفال، لا فنيًا ولا ماليًا.**
`commercial_cases.status` تقف عند `project_active` ولا تتقدم أبدًا. `projects` لا تحمل عمود حالة إطلاقًا. لا يوجد في الكود كله `close_project` ولا ما يقابله. النتيجة: لا أحد يستطيع أن يقول «هذه المشاريع منتهية وهذه جارية»، ولا يمكن بناء أي تقرير محفظة، ولا يمكن تحرير موارد، ولا معرفة متى يبدأ الضمان.
*الدليل:* نداءان 174 و175؛ ولقطة `projects.keys`.

**B3 — حالة سداد المورد مكذوبة في شاشة المشتريات.**
`procurement.stateData` (السطر 121–122 من `app/procurement.mjs`) يعيد:
```js
payment_status:'not_paid',
posting_status:'not_posted',
```
نصين ثابتين لا يُقرآن من `payment_orders` ولا من `finance_postings`. بعد توثيق التحويل بالكامل يظل طلب الشراء «غير مدفوع» في شاشته. وحدتان تقولان شيئين مختلفين عن الحدث نفسه، والمستخدم الذي يفتح المشتريات سيدفع مرتين.

**B4 — لا مسار لمنح التفويض المالي.**
`finance_grants` هو ما يفتح كل المالية (الاستحقاقات، الفواتير، المدفوعات، الدفتر، المخصصات). يُقرأ في `finance.currentActor` ولا يكتبه أي `POST` في `app/server.mjs` — لا شيء. التفويض المالي لا يُمنح إلا بإدراج SQL مباشر (كما تفعل `scripts/expand-demo.mjs` والاختبارات). **على قاعدة حقيقية، المالية كلها مقفلة على الجميع إلى الأبد، ولا سبيل لفتحها من المنصة.**

### عالية — تكسر الدورة كما يصفها دليل العمل

**B5 — لا أمر شراء من العميل.**
لا حقل ولا كيان ولا بوابة. `register_contract` يخزن `agreement_evidence` نصًا حرًا ويصف اللقطة بـ`internal_only:true`. وسجل العقود المستقل (`contracts-register.mjs`) **لا FK** له مع `commercial_cases` ولا `projects`، فالعقد المسجل فيه لا يعرف المشروع المنفَّذ تحته ولا العكس.

**B6 — لا أمر مباشرة للمورد.**
`approve_order` هو أمر الشراء، وليس إذن البدء. لا سجل لتاريخ المباشرة ولا لمن أصدره، ولا شرط عليه قبل الاستلام. في أعمال الإنتاج والفعاليات هذا هو الفرق بين «تعاقدنا» و«ابدأ التصوير غدًا».

**B7 — حزم العمل لإدارة واحدة فقط.**
`commercial.create_project` يشترط أن يكون كل عضو في **إدارة الملف التجاري** و**تابعًا للمدير المباشر** (`app/commercial.mjs` السطر 277). و`projects.createTask` يشترط عضوية المشروع. موظف إدارة أخرى يُرفض بـ`400 assignee` (النداء 58). مشروع «متعدد الإدارات» — وهو الحالة الطبيعية في وكالة — **لا يمكن تمثيله**. وأصلًا لا يوجد مفهوم «حزمة عمل»: `tasks` جدول مسطح بلا إدارة ولا مرحلة ولا حالة غير `open/completed`.

**B8 — التسليم الداخلي (BD-04) والانطلاقة (PM-02) غير موجودين.**
لا محضر تسليم من التطوير إلى إدارة المشروع، ولا محضر انطلاقة، ولا قائمة تحقق. الانتقال ضمني في `create_project`، ومن يفتح المشروع هو المدير نفسه الذي اعتمد العرض.

**B9 — شهادة الإنجاز وتقرير الإنجاز نصان داخل مراجعة.**
البوابة تعمل (لا استحقاق بلا قبول)، لكن ما يُخزَّن هو `acceptance_evidence` و`customer_representative` نصًا داخل `commercial_reviews.evidence_json`. لا مستند مرقّم، ولا حالة، ولا توقيع طرفين، ولا ربط بتقرير الإنجاز. لا يمكن طباعة شهادة إنجاز ولا إرسالها ولا مطالبة العميل بتوقيعها.

### متوسطة — تضعف الدورة أو تفتح ثغرة في الاتساق

**B10 — سجل العقود جزيرة.** `scope_baselines.contract_reference` و`retainers.contract_reference` و`campaigns.budget_reference` كلها **نصوص حرة** لا مفاتيح أجنبية إلى `contract_records`. لا طريق من عقد موقّع إلى العمل المنفَّذ تحته.

**B11 — وحدات التسليم مربوطة بالعميل لا بالمشروع.** `campaigns` و`content_items` و`scope_baselines` و`client_reports` و`media_plans` وجداول العلاقات العامة كلها `client_id` فقط. و`profitability` تحسب التكلفة على مستوى **المشروع**. فلا يمكن ضم تكلفة حملة إلى ربحية مشروعها، والإنفاق الإعلامي لا يدخل نموذج التكلفة إطلاقًا.

**B12 — `production.accept_close` يعد بفحص لا يجريه.** النص يقول إن الطرف الثاني يشهد بتوثيق التصاريح وإفراجات الصورة، والكود يحسب `talent_without_release` و`permits_open` ثم **لا يستخدمهما**. يمكن إقفال إنتاج بإفراجات غير موقعة وتصاريح معلقة.

**B13 — `pr.mjs` بلا عزل فريق الحساب.** كل وحدات التسليم الأخرى تمر بـ`clientFor`. `pr.mjs` يكتفي بتصريح `pr.manage`، فحامله يقرأ ويكتب بيانات العلاقات العامة **لكل عملاء الكيان** — وهي بيانات أشخاص من طرف ثالث تصفها الوحدة نفسها بالحساسة.

**B14 — `commercial.mjs` خارج نظام التصاريح.** `/api/commercial` لا يستدعي `access.require` ولا `can()` إطلاقًا؛ الوصول بملكية الملف ودور المدير فقط. بينما `pipeline-estimates` و`estimates` و`media-spend` و`client-reports` تشترط `commercial.use`. تصريح «المبيعات والتسليم» لا يحكم المسار التجاري الأساسي.

**B15 — لا مسار قراءة لكيان واحد في ثلاث وحدات.** لا `GET /api/review-rounds/:id` ولا `GET /api/payables/orders/:id` مربوط بمسار فعلي؛ تُقرأ اللوحة كاملة لاستخراج صف واحد. على حجم حقيقي هذا يعني تحميل كل جولات المراجعة (بموادها وتعليقاتها) لقراءة واحدة.

### منخفضة

**B16 — عرض السعر لا يُصدَر للعميل.** لا رقم عرض ولا نسخة قابلة للطباعة ولا تاريخ إرسال. `valid_until` موجود لكن لا يُبنى عليه شيء تجاه العميل.

**B17 — لا موجز مورد ولا بطاقة أسعار مورد ولا اتفاقية إطارية.** `payment_terms` نص حر في ملف المورد، و`specification` نص في طلب الشراء.

**B18 — قائمة التحقق المالية على مستوى الفترة لا المشروع.** `close-checklist` تقفل الشهر المحاسبي، ولا تربط مشروعًا بقائمة تحقق قبل إصدار فاتورته.

**B19 — اختبار `timesheets` هش بالتاريخ.** عند تشغيل التدقيق (الأحد 2026-09-20) فشل `tests/timesheets.test.mjs:48` لأن `addDays(today,-1)` يقع على السبت فيخرج من أسبوع العمل. فشل قائم قبل هذا العمل ولا علاقة له به.

---

## 5. المحاور السبعة: ماذا يوجد فعلًا

المالك يطلب محاور منفصلة. هذا ما وجدناه:

| المحور المطلوب | هل يوجد؟ | أين يُخزَّن | الملاحظة |
|---|---|---|---|
| **1. الحالة التجارية** | ✅ موجود | `commercial_cases.status` | `lead → qualification_pending → qualified → quote_draft → quote_pending → quote_approved → contracted → project_active` — محور سليم ومستقل |
| **2. جاهزية البدء** | ❌ **غائب تمامًا** | — | لا دفعة مقدمة، لا أمر شراء عميل، لا أمر مباشرة. البدء يحدث لأن `create_project` نُفذ، لا لأن شرطًا استوفي |
| **3. تقدم التنفيذ** | ⚠️ **مُشتَّت** | `tasks.status` (`open/completed`)، `studio_workspaces.status`، `productions.state`، `campaigns.status`، `content_items.status` | خمسة محاور متوازية لخمس وحدات، **ولا محور واحد على المشروع**. `projects` بلا عمود حالة |
| **4. قبول العميل** | ✅ موجود | `external_approvals.status` + `review_decisions` + `commercial_reviews(kind='delivery')` | ثلاثة سجلات في ثلاث وحدات تقول الشيء نفسه بثلاث لغات، لكن المحور قائم ومربوط بنسخة محددة |
| **5. فوترة العميل** | ✅ موجود | `ar_claims.status` + `tax_invoices.status` | محور سليم، والبصمة المسلسلة تمنع التعديل الخارجي |
| **6. تحصيل العميل** | ✅ موجود | `ar_receipts.status` + `aging_bucket` المشتق | محور سليم ومستقل عن الفوترة |
| **7. سداد المورد** | ⚠️ **موجود ومكذوب في مكانين** | `payment_orders.status` (صحيح) و`procurement_purchases.payment_status` (نص ثابت `not_paid`) | المحور موجود في `payables` وغائب فعليًا عن `procurement` |
| **8. الإقفال النهائي** | ❌ **غائب تمامًا** | — | لا حالة ولا إجراء ولا حتى عمود |

### الخلاصة على المحاور

**من الثمانية: أربعة سليمة (تجاري، قبول، فوترة، تحصيل)، واحد موجود ومتناقض (سداد المورد)، واحد مشتَّت على خمس وحدات بلا محور جامع (تقدم التنفيذ)، واثنان غائبان تمامًا (جاهزية البدء، الإقفال النهائي).**

**وأخطر من عدد المحاور: كيف تُقرأ.** ثلاثة أسئلة مختلفة تمامًا يجيب عنها اليوم **الحقل نفسه** `commercial_cases.status='project_active'`:
- هل بدأ العمل؟
- هل ما زال العمل جاريًا؟
- هل انتهى المشروع ولم يُقفل؟

الحالة `project_active` تعني «فُتح مشروع» وتظل تعني ذلك إلى الأبد. فهي ليست محورًا لتقدم التنفيذ ولا للإقفال — هي **نهاية المحور التجاري** استُعملت بديلًا عن محورين لا وجود لهما. هذا هو الالتباس الجوهري: لا محاور مدموجة بقدر ما هناك محور واحد يُسأل عمّا لا يعرفه.

ومثله في طرف آخر: `procurement_purchases.status='received'` يخلط «وصلت البضاعة» بـ«انتهى التعامل مع هذا المورد» — والسداد الذي يميزهما نص ثابت لا يُقرأ.

---

## 6. قائمة الإصلاح مرتبة

### الموجة الأولى — بلا هذه لا يكون النظام سجلًا ماليًا

1. **مسار منح التفويض المالي (B4).** `POST /api/finance/grants` و`/revoke` للأدمن الأول، بتصريح حساس، وسجل تدقيق. بدونه لا أحد على قاعدة حقيقية يستطيع إصدار فاتورة أو اعتماد دفعة. **أصغر إصلاح وأكبر أثر.**
2. **قراءة حالة السداد والترحيل من مصدرها (B3).** استبدال النصين الثابتين في `procurement.stateData` باستعلامين على `payment_orders` و`finance_source_links`. **سطران، ويوقفان خطر الدفع مرتين.**
3. **محور الإقفال (B2).** عمود `closure_state` على `projects` أو حالتان جديدتان على `commercial_cases` (`closed_technically` ثم `closed_financially`)، مع إجراءين: الإقفال الفني يشترط ألا يبقى بند عقد غير مقبول ولا مهمة مفتوحة؛ والمالي يشترط رصيد استحقاقات صفرًا ولا مستحق مورد غير مدفوع. هذا يعيد أيضًا المعنى إلى `project_active`.
4. **محور جاهزية البدء والدفعة المقدمة (B1).** كيان `advance` على الملف التجاري يولّد `ar_claim` من بند العقد لا من التسليم، وحالة `ready_to_start` تشترط دفعة مقدمة مؤكدة أو إعفاءً مسجلًا باسم من أعفى. ثم يشترطها `create_project` أو `submit_delivery`.

### الموجة الثانية — دورة المالك كما يصفها

5. **أمر شراء العميل (B5)** حقلًا وكيانًا على الملف التجاري، ومفتاحًا أجنبيًا بين `contract_records` و`commercial_cases` (B10) كي يعرف العقد المسجل مشروعه.
6. **أمر المباشرة (B6)**: سجل بتاريخه ومن أصدره، ويشترطه `receive`.
7. **حزم العمل متعددة الإدارات (B7)**: عمود `department_id` و`status` و`phase` على `tasks` (أو جدول `work_packages`)، وتوسيع نطاق عضوية المشروع خارج فريق المدير المباشر بقيد صريح مسجل.
8. **شهادة الإنجاز مستندًا (B9)**: رقم وحالة وطرفان وقابلية طباعة، مبنية على القبول القائم لا بديلًا عنه.

### الموجة الثالثة — الاتساق

9. **`commercial.use` يحكم المسار التجاري (B14)** كما يحكم أخواته.
10. **عزل فريق الحساب في `pr.mjs` (B13).**
11. **`production.accept_close` يفحص ما يعد به (B12)** — `talent_without_release` و`permits_open` محسوبان أصلًا.
12. **`project_id` على وحدات التسليم (B11)** كي تصل تكلفة الحملة والإنتاج والإعلام إلى ربحية مشروعها.
13. **مسارات قراءة لكيان واحد (B15)** في `review-rounds` و`payables`.
14. **تثبيت اختبار `timesheets` الهش بالتاريخ (B19).**

---

## 7. ما يحرسه هذا التدقيق

`tests/delivery-cycle.test.mjs`:

- **7 اختبارات نافذة** تثبّت بوابات تعبر الوحدات: سلسلة الاعتمادات التجارية، وأن الاستحقاق يولد من مخرج **مقبول** فقط، وأن الفاتورة تعلّق على استحقاق معتمد ولا يصدرها معدّها، وأن التحصيل بشخصين ولا يتجاوز الاستحقاق، وأن مرحلة العميل لا تُغلق إلا بموافقة موثقة على النسخة نفسها وبالقرار نفسه، وأن الترسية تحتاج مقارنة ومخصصًا ومورّدًا مؤهلًا، وأن سداد المورد يحتاج أمر شراء واستلامًا ومطابقة وثلاثة أشخاص.
- **8 اختبارات مُعلَّمة `skip`** بسبب مكتوب لكل بوابة غائبة (B1، B2، B3، B5، B6، B7، B9 ومحور الإقفال)، حتى لا يُقرأ غيابها نجاحًا وحتى يكون لكل إصلاح مكان ينتظره.

**الاختبارات:** 832 اختبارًا، 823 ناجحة، 8 متجاوزة بسبب مكتوب، وفشل واحد قائم قبل هذا العمل (`tests/timesheets.test.mjs:48`، هش بالتاريخ، B19؛ كان 817/816 قبل إضافة هذا الملف). **الفحص:** `npm run check` يمر: 408 وحدة، وبصمات المصادر مطابقة.
