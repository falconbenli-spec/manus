# تسليم: `contracts-register` — سجل العقود والالتزامات والتجديدات

عقود الوكالة التجارية: العملاء والموردون والمستقلون وتراخيص البرمجيات. **ليست عقود الموظفين** — تلك في
`app/hr-contracts.mjs` ولم أفتحه ولم ألمسه.

## 1. الملفات

أنشأتها:

- `app/migrations/057-contracts-register.sql`
- `app/contracts-register.mjs`
- `app/static/contracts-register-ui.mjs`
- `tests/contracts-register.test.mjs`

لم أعدّل أي ملف قائم: لا `app/server.mjs` ولا `app/access.mjs` ولا `app/inbox.mjs` ولا `app/campaigns.mjs`
ولا `app/agency.mjs` ولا `app/vendors.mjs` ولا `app/static/operations.mjs` ولا أي اختبار قائم ولا أي هجرة أخرى.

## 2. الهجرة 057 وجداولها

| الجدول | ما فيه |
| --- | --- |
| `contract_records` | العقد: الطرف (`party_kind` + `client_id`/`vendor_id`/`party_name`)، النوع، الموضوع، السريان والانتهاء، القيمة بالهللات، شروط التجديد (`auto_renew` + `notice_days` + `renewal_note`)، الحالة، المالك، مكان حفظ الأصل الموقّع ومن وقّعه ومتى، وربط اختياري بـ`scope_baselines`. |
| `contract_amendments` | الملحق: رقمه المتسلسل على العقد، تاريخه، موضوعه، أثره على القيمة (`value_delta_minor`) وعلى المدة (`new_end_date`)، من اعتمده ومن سجّله ومن أكّده. |
| `contract_renewal_decisions` | قرار التجديد لدورة بعينها: `renew` / `do_not_renew` / `renegotiate`، ومرجع الإشعار المرسل خارج المنصة. |
| `contract_obligations` | البنود المستخرجة: النوع، العنوان، رقم البند، المالك، التكرار، أول استحقاق، دليل التنفيذ المتوقع، و`extraction` مقفل على `'manual'`. |
| `contract_obligation_fulfilments` | دليل التنفيذ لكل استحقاق، ومن تحقق منه. |
| `contract_alert_settings` | مهل التنبيه الثلاث وسندها ومن أدخلها. صف واحد لكل كيان. |

القواعد المفروضة في SQL لا في الكود وحده:

- **العقد الساري لا يُعدَّل:** `contract_records_in_force_not_edited` يرفض أي تغيير على بيانات العقد بعد خروجه من المسودة.
- **فصل المهام:** `CHECK(owner_id<>created_by)` و`CHECK(activated_by<>created_by)` على العقد،
  `CHECK(approved_by<>recorded_by)` و`CHECK(confirmed_by=approved_by)` على الملحق،
  `CHECK(verified_by<>completed_by)` على دليل التنفيذ.
- **تجديد تلقائي بلا مهلة إشعار مرفوض:** `CHECK((auto_renew=1)=(notice_days IS NOT NULL))`.
- **قرار عدم التجديد بلا مرجع إشعار مرفوض:** `CHECK(decision<>'do_not_renew' OR length(trim(notice_reference))>=5)`.
- `version` على كل جدول قابل للتعديل مع `TRIGGER` يرفض النسخة القديمة، ولا حذف من أي جدول.

## 3. المسارات التي يحتاجها المنسّق في `app/server.mjs`

استيراد: `import * as contractsRegister from './contracts-register.mjs';`

| الطريقة | المسار | الدالة | معاملة؟ | `Idempotency-Key`؟ |
| --- | --- | --- | --- | --- |
| GET | `/api/contracts-register` | `contractsRegisterBoard(db,u)` | لا | لا |
| POST | `/api/contracts-register` | `createContract(db,u,input)` | نعم | نعم (`once`) |
| POST | `/api/contracts-register/settings` | `setAlertSettings(db,u,input)` | نعم | لا |
| POST | `/api/contracts-register/{id}/edit_contract` | `updateContract(db,u,id,input)` | نعم | لا |
| POST | `/api/contracts-register/{id}/{action}` | `contractAction(db,u,id,action,input)` | نعم | لا |
| POST | `/api/contracts-register/{id}/record_amendment` | `recordAmendment(db,u,id,input)` | نعم | نعم (`once`) |
| POST | `/api/contracts-register/{id}/add_obligation` | `addObligation(db,u,id,input)` | نعم | نعم (`once`) |
| POST | `/api/contracts-register/amendments/{id}/confirm_amendment` | `amendmentAction(db,u,id,'confirm_amendment',input)` | نعم | لا |
| POST | `/api/contracts-register/obligations/{id}/{action}` | `obligationAction(db,u,id,action,input)` | نعم | لا |

- `{id}` في كل الحالات UUID بـ36 حرفًا: `[a-f0-9-]{36}`.
- `{action}` على العقد: `activate_contract|cancel_contract|terminate_contract|decide_renewal`.
- `{action}` على البند: `complete_obligation|verify_obligation|deactivate_obligation|activate_obligation`.
- مسارا `amendments/` و`obligations/` لا يتعارضان مع نمط `{id}/{action}` لأن الأول جزء نصي لا UUID، لكن الأأمن
  مطابقتهما قبله.
- الصلاحيات كلها داخل الدوال (`contracts.register.view` و`contracts.register.manage`)، فلا حاجة لـ`access.require`
  في الخادم.

## 4. مفتاح الوحدة والملف الثابت

- المفتاح في `operationModules`: **`contracts-register`** ← `contractsRegisterUI` من `./contracts-register-ui.mjs`.
- اسم الملف للقائمة البيضاء في `app/server.mjs` (سطر `for(const module of [...])`): **`contracts-register-ui`**.
- مجموعة التنقّل المقترحة في `app/static/app.mjs`: مع مجموعة التشغيل، بعد «الموردون والتأهيل» ملاصقًا لسجلات
  الوكالة، بشرط تصريح:
  `if(['contracts.register.view','contracts.register.manage'].some(has))nav.push(['contracts-register','▤','سجل العقود','Contract register']);`
  الاسم مقصود ألا يتشابه مع مدخل `contracts` القائم («عقدي وراتبي» / عقود الموظفين).
- الوحدة تستورد `./dates.mjs` فقط من الملفات الثابتة، وهو مُقدَّم أصلًا.
- أصناف CSS المستخدمة كلها قائمة في `app/static/signature.css` و`style.css`: إضافة إلى الأصناف المذكورة في العقد
  المشترك استخدمت `vn-card` و`vn-code` و`vn-name` و`vn-flags` و`vn-flag` و`vn-body` كما تستخدمها
  `service-cards-ui.mjs` و`vendors-ui.mjs`. **لم أضف أي CSS.**

## 5. صندوق «بانتظار قراري»

الدالة: `contractAlerts(db,u)` في `app/contracts-register.mjs`.

قرأت `app/inbox.mjs` ولم أعدّله. الشكل مطابق لما يقرأه `collect` هناك: شجرة كائنات، وكل عقدة تحمل
`id` و`title` و`created_at` و`actions`. مفاتيح المجموعات مختارة لتصيب خريطة `KINDS` في الصندوق:

```js
['contracts-register','سجل العقود والتجديدات',contractAlerts]
```

يُضاف إلى مصفوفة `SOURCES` في `app/inbox.mjs`. الأفعال التي ستظهر وتسمياتها كما تشتقها `labelFor` هناك:

| الفعل | مفتاح المجموعة | التسمية في الصندوق | المصدر |
| --- | --- | --- | --- |
| `decide_renewal` | `contracts` → «عقد» | «قرار» (من `DECISIONS.decide`) | تنبيه الإشعار بعدم التجديد أو الانتهاء |
| `confirm_amendment` | `amendments` | «تأكيد» (من `DECISIONS.confirm`) | ملحق ينتظر تأكيد معتمده |
| `complete_obligation` | `obligations` → «التزام دوري» | «تنفيذ وتوثيق» | بند مستحق على مالكه |
| `verify_obligation` | `obligations` | «تحقق من الدليل» | دليل نفّذه غيرك ينتظر تحققك |

كل هذه المفاتيح موجودة في `DECISIONS` بـ`app/inbox.mjs` اليوم، فلا يحتاج الصندوق أي تعديل غير سطر `SOURCES`.
ترتيب تنبيهات العقود داخل `contracts` بالأولوية: تفويت موعد الإشعار (1) ثم اقترابه أو التجديد غير المسجل (2)
ثم قرب الانتهاء (3) — لأن تفويت موعد الإشعار يجدّد العقد رغمًا عن الشركة بينما الانتهاء يمكن تداركه.

## 6. ما لم أبنه ولماذا

- **لا توقيع إلكتروني ولا حجية.** لم أبنِ أي آلية توقيع، ولا وصفت أي شيء بأنه ذو أثر نظامي. الحجية من مزوّد مرخّص
  خارج المنصة. ما في السجل: مكان حفظ الأصل الموقّع، ومن وقّع عن كل طرف، وتاريخ التوقيع — وتصرّح الشاشة بذلك
  في كل بطاقة عقد.
- **لا استخراج آلي للبنود.** كل بند يدخله إنسان قرأ العقد، وعمود `extraction` مقفل في SQL على `'manual'` حتى لا
  يتسلل بند مولّد فيُقرأ كأن إنسانًا أقرّه. **مقترح لا أكثر:** يمكن لاحقًا إضافة «مسودة اقتراح بنود» بمساعدة نموذج
  لغوي تُعرض بوسم واضح وتحتاج إقرار إنسان قبل الحفظ، على غرار `app/ai.mjs`. لم أبنِ منها شيئًا.
- **لا إرسال إشعار.** المنصة لا ترسل إشعار عدم التجديد؛ تسجّل مرجع الإشعار الذي أرسله إنسان خارجها، وترفض
  قرار «عدم التجديد» بلا مرجع.
- **لا عملة غير الريال.** العقد بعملة أجنبية (وهو شائع في تراخيص البرمجيات) لا يمكن تسجيل مبلغه هنا: المنصة أحادية
  العملة بالهللات كما في العقد المشترك، والعمود مقيّد بـ`CHECK(currency='SAR')`. الشاشة تقول ذلك صراحة وتترك حقل
  القيمة فارغًا. **قرار المالك مطلوب:** هل تُضاف عملات وأسعار صرف مؤرّخة على مستوى المنصة، أم يُكتفى بتسجيل
  المبلغ الأجنبي نصًا في الموضوع؟
- **لا مهل افتراضية.** التنبيهات معطلة كليًا حتى يدخل حامل تصريح الإدارة المهل الثلاث بسندها. **قرار المالك مطلوب:**
  كم يومًا قبل موعد الإشعار بعدم التجديد، وكم قبل الانتهاء، وكم قبل استحقاق بند الالتزام.
- **لا نسخ من الأصل الموقّع داخل المنصة.** ربط المرفقات بـ`app/files.mjs` لم أبنه؛ الحقل اليوم نص يصف مكان الحفظ.
  يحتاج قرارًا لأنه يمسّ سياسة حفظ المستندات وصلاحيات الاطلاع.
- **دورة التجديد الثانية.** قرار التجديد يُسجَّل لدورة `term_end_date` الحالية. حين يتجدد العقد فعلًا، المدة الجديدة
  تدخل بملحق (فتنتقل الدورة تلقائيًا)، وإن لم يُسجَّل ملحق يبقى التنبيه `renewed_unrecorded` مفتوحًا ولا تدّعي
  المنصة معرفة المدة الجديدة.
- **لا ربط تلقائي بالفواتير أو المشتريات.** العقد يشير إلى خط أساس النطاق فقط؛ ربط `payables`/`invoices` بعقد
  يحتاج قرار مالك إجراء المالية.

## 7. نتيجة الاختبارات

`node --test tests/contracts-register.test.mjs`:

```
✔ contracts register: the recorder is never the owner, a contract in force is amended by a numbered annex and never edited, and the annex only bites once its named approver confirms it
✔ contracts register: no alert exists until the owner enters the lead times, and the non-renewal notice deadline outranks the expiry date
✔ contract obligations are entered by a human clause by clause, and the evidence is verified by someone other than whoever completed it
✔ the contracts register screen renders for every role that reaches it and every button it offers opens a valid form
ℹ tests 4  ℹ pass 4  ℹ fail 0
```

الاختبارات القريبة، شُغّلت بأسمائها بعد التغيير ولم يفشل منها شيء:

```
node --test tests/migrations.test.mjs tests/compliance.test.mjs tests/campaigns.test.mjs tests/agency.test.mjs \
  tests/vendors.test.mjs tests/access.test.mjs tests/inbox.test.mjs
ℹ tests 27  ℹ pass 27  ℹ fail 0

node --test tests/static-modules.test.mjs tests/ui-render.test.mjs tests/platform.test.mjs tests/company-scale.test.mjs
ℹ tests 23  ℹ pass 23  ℹ fail 0
```

لم أشغّل `npm test` كاملًا كما ينص العقد المشترك؛ وكلاء آخرون يعملون الآن.
