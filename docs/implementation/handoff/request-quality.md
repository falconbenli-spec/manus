# تسليم: request-quality — جودة حقول الخدمة

## 1. الملفات

| الملف | الحالة |
|---|---|
| `app/validation.mjs` | معدّل (استثناء خاص بهذه الجولة): `fieldVisible` و`visibleFields`، و`validatePayload` يفرض `show_when` و`min_length` و`max_length` و`pattern`/`pattern_message`. الحقول القديمة بلا هذه المفاتيح تُفحص كما كانت بالضبط. |
| `app/service-catalog.mjs` | معدّل (استثناء خاص): المولّدات `t/long/day/num/pick` تقبل وسيطًا أخيرًا للإرشاد. أُضيف `FIELD_GUIDANCE_KEYS` و`coreField` و`fieldModel` و`enrichFields`. `installServiceCatalog` ينشئ الخدمات ويقارنها بالشكل المخزَّن وحده. **كل حقول الخدمات الـ139 فيها الآن `why`**، وفي كثير منها `hint` و`example` وحدود طول. |
| `app/catalog-quality.mjs` | جديد: `catalogQualityBoard`، `reportFieldGap`، `REASONS`. |
| `app/migrations/071-request-quality.sql` | جديد. |
| `app/static/catalog-quality-ui.mjs` | جديد: `catalogQualityUI`. |
| `tests/request-quality.test.mjs` | جديد: 7 اختبارات. |

لم أعدّل أي ملف مشترك آخر ولا أي اختبار قائم. لم أضف خدمة ولم أحذف واحدة (العدد باقٍ 139 + 3 أساسية = 142، وهو ما يفحصه `tests/service-quality.test.mjs` مقابل سجل البحث).

## 2. الهجرة 071

`service_field_feedback`: سبب ارتداد مرتبط بحقل، لكل (طلب، نسخة، حقل، سبب) سجل واحد.
- `reason` من: `missing_field` (حقل لازم غير موجود؛ `field_key` فارغ إلزامًا بقيد CHECK)، `unclear_field`، `wrong_options`، `insufficient_answer`، `not_needed`.
- قادح `service_field_feedback_returner_only`: يُرفض الإدخال إن كان المسجِّل صاحب الطلب، أو لم يكن هو من قرر `returned` في هذه النسخة، أو اختلف المستأجر.
- قادحان يمنعان التعديل والحذف: السجل يبقى كما كُتب.
- لا عمود `version`: السجل غير قابل للتعديل أصلًا.

## 3. المسارات المطلوبة في `app/server.mjs`

| الطريقة | المسار | الدالة | معاملة | `Idempotency-Key` |
|---|---|---|---|---|
| GET | `/api/catalog-quality` | `catalogQualityBoard(db,u)` | لا | لا |
| POST | `/api/catalog-quality/requests/:id/field-gap` | `reportFieldGap(db,u,id,body)`، الجسم `{field_key,reason,note}` | نعم (الدالة ترفض العمل خارجها) | نعم |

الصلاحية: التقرير الكامل لمن يملك `catalog.manage` (مفتاح قائم، لم أضف مفتاحًا). أي مستخدم يرى في اللوحة نفسها الطلبات التي أعادها هو فقط (`my_returns`) ويسجّل سببها.

## 4. الواجهة

- المفتاح في `operationModules`: `'catalog-quality': catalogQualityUI`، يُستورد من `./catalog-quality-ui.mjs`.
- أضف `catalog-quality-ui.mjs` إلى القائمة البيضاء للملفات الثابتة.
- مجموعة التنقل: **إدارة المنصة** (بجوار بطاقات الخدمات).
- الأصناف المستخدمة كلها قائمة. لا CSS جديد.

### ما يحتاجه نموذج الطلب في `app/static/app.mjs` (ملف مشترك؛ لم ألمسه)

1. **مصدر الإرشاد:** قائمة الخدمات التي تصل الواجهة تحمل الحقول المخزنة فقط. مرّر حقول كل خدمة عبر `enrichFields(s.code,s.fields)` من `app/service-catalog.mjs` في المسار الذي يعيد الكتالوج للواجهة (أو في `wf.catalog` عند العرض). الخدمات خارج الكتالوج تمر كما هي.
2. **في `fieldInput(f)`:**
   - تحت الحقل: `f.hint` في `<small class="subtle">`، و`f.example` مسبوقًا بـ«مثال: »، و`f.why` مسبوقًا بـ«لماذا نسأل: ». كلها عبر `e()`.
   - `maxlength="${f.max_length}"` و`minlength="${f.min_length}"` حين وُجدا، و`pattern="${f.pattern}"` مع `title="${f.pattern_message}"`.
   - للحقل المشروط: غلّف الحقل بعنصر يحمل `data-show-field="${f.show_when.field}"` و`data-show-values="${JSON.stringify(f.show_when.equals)}"` (مهرّبًا)، وابدأه بـ`hidden` وحقوله بـ`disabled` ما لم يتحقق الشرط على القيمة الابتدائية.
3. **الإظهار والإخفاء بلا سكربت مضمّن:** في مستمع `change` القائم في `app.mjs` على `#request-form`، بعد تبديل الخدمة أو تغيير أي `select`:
   ```js
   for(const box of form.querySelectorAll('[data-show-field]')){
     const on=JSON.parse(box.dataset.showValues).includes(form.elements[box.dataset.showField]?.value);
     box.hidden=!on; box.querySelectorAll('input,select,textarea').forEach(x=>x.disabled=!on);
   }
   ```
   تعطيل الحقل يخرجه من `FormData`. وإن وصلت قيمة حقل مخفي رغم ذلك فالخادم يسقطها ولا يطلبها.

## 5. «بانتظار قراري»

اختياري ومنخفض الأولوية: عناصر `my_returns` (طلب أعاده المستخدم ولم يسجّل سبب إعادته بعد) بفعل `report_field_gap`. ليس قرارًا يوقف أحدًا، فلا أوصي بإبرازه كقرار عاجل.

## 6. ما لم يُبن، وما يحتاج قرارًا

### أ. فرض `show_when` و`pattern` والطول في الإنتاج يحتاج تعديلًا صغيرًا في `app/workflow.mjs` (ملف المنسّق)

`createService` يقبل فقط `key/label/type/required/options` في كل حقل (`v.object(f,[…])`) ويخزّن هذه المفاتيح وحدها. وجدول `services` عليه قادح يمنع التعديل. لذلك:
- **اليوم** يُخزَّن الشكل الأساسي، ويُخزَّن الحقل المشروط **غير مطلوب** (`coreField`). النتيجة: لا يُطالَب أحد بحقل لا يظهر له، ولا تراجع في أي سلوك قائم. لكن `validatePayload` داخل `createRequest/editRequest/submit` لا يرى `show_when` ولا `pattern`، فلا يفرضهما بعد. المنطق نفسه مكتوب ومختبر في `validatePayload` على نموذج الكتالوج الكامل.
- **لتفعيله:** في `createService` اقبل `FIELD_GUIDANCE_KEYS` (مستوردة من `service-catalog.mjs` أو منسوخة) وانسخها إلى الحقل المخزَّن بعد التحقق من أنواعها. بعد ذلك احذف تخفيض `required` في `coreField` (أعِد `required:f.required`).
- **تحذير لا أستطيع معالجته:** بعد التفعيل سيفشل `tests/service-catalog.test.mjs` في «every service accepts a complete request»، لأن `sample()` يعطي نصًا ثابتًا لكل حقل نصي، وهذا لا يطابق حقول الصيغة المطلوبة: `HR-PAYROLL-INQUIRY.month`، `HR-RETRO-ADJUSTMENT.from_month/to_month`، `EXP-RECOGNITION.month`، `HR-BANK-CHANGE.iban_last4`، `PRC-VENDOR-BANK.iban_last4`، وحقول الوقت في `ADM-ROOM-BOOKING` و`ADM-VISITOR` و`ADM-VEHICLE` و`IT-MEETING-SUPPORT` و`DIG-SOCIAL-POST`. ويلزم أيضًا أن يملأ الاختبار الحقول المشروطة حين يظهر شرطها. تعديل ذلك الاختبار قرارك أنت.

### ب. تغييرات الحقول

**أُضيف:**
- الموارد البشرية: `HR-ATTENDANCE-FIX.evidence`، `HR-REFERRAL.candidate_aware`.
- تقنية المعلومات: `IT-ACCESS.system_owner` و`duration`، `IT-DEVICE.fault`، `IT-SOFTWARE.data_scope`، `IT-SECURITY-INCIDENT.affected`، `IT-NEW-ACCOUNT.reports_to`، `IT-CHANGE-REQUEST.impact`.
- الإبداعي والقانونية والعلاقات العامة: `CRT-DESIGN.for_whom` و`client`، `CRT-REVISION.source`، `LEG-CONTRACT-REVIEW.draft_source`، `PR-MEDIA-REQUEST.on_behalf` و`client`، `PR-ISSUE-ALERT.about`.
- التسويق الرقمي: `DIG-SOCIAL-POST.client_approved`، `DIG-PERFORMANCE-REPORT.for_whom`، `DIG-BUDGET-CHANGE.client_approved`.
- المشاريع والحوكمة والبيانات: `PMO-NEW-PROJECT.basis`، `PMO-SUBCONTRACT.client_data`، `GOV-POLICY.owner`، `DAT-DASHBOARD.decision`، `DAT-AI-USE.client_facing`، `STR-COMPETITOR.questions`.

**حُذف:**
- `PRC-PURCHASE-REQUEST.quantity`: رقم واحد لطلب متعدد الأصناف لا يغيّر قرارًا، والكميات مكتوبة في حقل الأصناف.
- خيار «الحساب البنكي» من `HR-PROFILE-UPDATE`: للحساب البنكي خدمة مستقلة بضوابطها.

**صار مشروطًا (10 حقول):**
- `HR-PROFILE-UPDATE.document_expiry`
- `HR-ATTENDANCE-FIX.from_time` و`to_time` (نسيان بصمة، استئذان، تأخير بعذر)
- `IT-ACCESS.access_level` و`access_until`
- `IT-DEVICE.fault`، `CRT-DESIGN.client`، `FIN-CUSTODY.settle_by`، `PR-MEDIA-REQUEST.client`، `DIG-AD-ACCOUNT.access_until`

**الأثر على البيئات القائمة:** التثبيت التالي للكتالوج سينشئ نسخة جديدة لكل خدمة تغيّر شكلها المخزَّن. الطلبات القائمة تبقى على نسختها.

**الأوصاف:** صُحّح أكثر من 25 وصفًا لتقول ما لا تفعله الخدمة: لا ترسل ولا تدفع ولا تحجز ولا تتصل بجهة رسمية. ومن ذلك `LEG-WHISTLEBLOW`: الطلب يحمل اسم صاحبه، والمنصة لا توفر بلاغًا مجهول الهوية.

### ج. قيود البيانات

لم يُضف أي حقل هوية أو صحة أو حساب بنكي. حقل «آخر 4 أرقام» في `HR-BANK-CHANGE` و`PRC-VENDOR-BANK` قُيّد بصيغة أربعة أرقام، ويشرح `why` فيه لماذا لا يُكتب الحساب كاملًا. ولا مدة ولا مبلغ ولا نسبة نظامية في أي إرشاد. `LEG-PRIVACY-REQUEST.deadline` يطلب صراحة ألا يُقدَّر الموعد النظامي.

### د. ملاحظات على مسارات الاعتماد (لم أغيّر شيئًا؛ القرار لمالكي الإجراءات)

1. `HR-JOB-CHANGE` يعتمده الموارد البشرية وحدها، ومن خياراته «تعديل الأجر». لا خطوة للمدير رغم أن الوصف يقول «يرفعه المدير»، ولا خطوة مالية أو تنفيذية لتغيير أجر.
2. `HR-BANK-CHANGE` خطوة واحدة (الموارد البشرية) لأكثر مداخل الاحتيال شيوعًا. يُقترح تحقق ثانٍ مستقل.
3. `PRC-VENDOR-BANK` يعتمده مدير المشتريات وحده، مع أن في المنصة تصريحًا قائمًا `vendors.bank` («التحقق المالي من بيانات دفع الموردين»). المالية ليست في مسار الطلب.
4. `HR-GRIEVANCE` و`LEG-WHISTLEBLOW` و`GOV-CONFLICT-DISCLOSURE`: لا مسار بديل حين يكون موضوع الشكوى هو الإدارة المستقبِلة نفسها (الموارد البشرية أو الحوكمة).
5. `IT-SECURITY-INCIDENT` و`IT-OUTAGE` و`ADM-SAFETY` و`PR-ISSUE-ALERT` تمر بخطوة «اعتماد» قبل التنفيذ. البلاغ العاجل لا يحتاج اعتمادًا ليُعالَج، والخطوة تؤخر الاحتواء.
6. `CRT-DESIGN` و`CRT-CONTENT` و`CRT-REVISION` و`CRT-TRANSLATION` خطوتها الوحيدة المدير المباشر، والإدارة الإبداعية بلا رئيس مسمى (`head:null`).
7. `CRT-ASSET-REQUEST` تملكه «العلامة التجارية» ويعتمده المدير المباشر لصاحب الطلب. لا يمر بمن يملك حقوق الأصل.
8. `DAT-AI-USE` و`DAT-DATA-ACCESS` (مع بيانات شخصية) و`EXP-SURVEY` (بخيار «باسم الموظف») بلا خطوة خصوصية أو التزام.
9. `INF-CONTRACT` و`PRO-FREELANCER` و`PMO-SUBCONTRACT` التزامات بأجر بلا خطوة مالية.
10. `ADM-VISITOR` خطوتان (المدير ثم مكتب الرئيس) لتصريح زائر: إجراء ثقيل مقارنة بأثره.

### هـ. ما لم يُبن

- اعتماد مالكي الإجراءات للإرشاد: كل `why/hint/example` اقتراح من إعداد الكتالوج، واللوحة تقول ذلك صراحة.
- عرض الإرشاد في نموذج الطلب الفعلي (يحتاج البند 4 في `app.mjs`).
- ربط تسجيل سبب الارتداد بلحظة الإعادة نفسها في `transition('return')`: ملف المنسّق. اليوم يسجّله المعيد من لوحة جودة الكتالوج ما دامت النسخة المعادة هي الحالية؛ بعد إعادة التقديم يُغلق التسجيل لتلك النسخة (`not_returner`).

## 7. نتيجة الاختبارات

```
node --test tests/request-quality.test.mjs
✔ legacy fields without guidance keys validate exactly as before
✔ a conditional field is neither required nor stored while hidden, and is enforced once its condition holds
✔ the catalog explains every field, and every rule it declares is well formed
✔ stored service versions keep the createService shape and guidance is overlaid on read
✔ only the approver who returned the revision records which field caused it, once, and the record is immutable
✔ the quality board ranks services by real use, names each gap, and is limited to the catalog manager and the tenant
✔ the interface escapes every value and only offers the action the board granted
ℹ tests 7  pass 7  fail 0
```

الاختبارات القائمة القريبة، مشغّلة بالاسم: service-catalog، service-cards، service-quality، request-intake، workflow-review، structured-fields، platform، approvals، approval-policy، routing-portal، company-scale، migrations، static-modules، ui-render، lifecycle، workspace، work-calendar، attendance، access، employees، search، security-regressions، inbox، operations-http، ui-race، dialog-races، employee-assistant، ai، traceability.

```
ℹ tests 114  pass 114  fail 0
```

`node scripts/workflow-review.mjs`: 142 خدمة، 0 ملاحظة.
