# تسليم وحدة `letters` — خطابات الموظفين بخدمة ذاتية

## 1. الملفات

أنشأت (ولم أعدّل أي ملف قائم):

- `app/migrations/048-letters.sql` — هجرتي المحجوزة.
- `app/letters.mjs` — وحدة الخلفية، وفيها دالة الطباعة `letterPrintable`.
- `app/static/letters-ui.mjs` — شاشتان: `lettersUI` و`letterTemplatesUI`.
- `tests/letters.test.mjs` — خمسة اختبارات.

لم ألمس `app/server.mjs` ولا `app/static/operations.mjs` ولا `app/access.mjs` ولا `app/inbox.mjs` ولا أي اختبار قائم ولا أي هجرة أخرى.

## 2. الهجرة 048 وجداولها

| الجدول | ما فيه | ما يحميه |
|---|---|---|
| `letter_types` | أنواع الخطابات جدولًا لا قائمة في الكود. الصف بلا `tenant_id` نوع أساسي مشترك (`employment` `salary` `experience` `bank` `embassy`)، وما له `tenant_id` يضيفه مالك الإجراء في كيانه. | `TRIGGER` يمنع تعديل الأنواع الأساسية أو حذف أي نوع؛ فهرس فريد على `(coalesce(tenant_id,'*'),code)`. |
| `letter_templates` | قالب لكل نوع بنسخ مؤرخة: `body` يبدأ فارغًا، `status` مسودة/منشور/محل محله. | `CHECK(published_by<>prepared_by)` — من كتب القالب لا يعتمده. `TRIGGER` يرفض تعديل المنشور (التصحيح نسخة جديدة). مسودة واحدة ومنشور واحد لكل نوع بفهرسين جزئيين. |
| `letter_requests` | طلب الخطاب: صاحبه، نوعه، الجهة، الغرض، ومساره `requested → prepared → issued` مع `rejected`/`cancelled`. | ثلاثة `CHECK` لفصل المهام: `prepared_by<>user_id`، `issued_by<>user_id`، `issued_by<>prepared_by`. `TRIGGER` للتحقق التفاؤلي من `version` ولمنع إعادة كتابة طلب بُتّ فيه. |
| `letters` | الخطاب المُصدَر: `reference` متسلسل بلا فجوات لكل سنة (`UNIQUE(tenant_id,year,serial)`)، `verify_code` عشوائي فريد، و`body` النص بعد ملء العناصر النائبة. **لا عمود للمبلغ إطلاقًا.** | `TRIGGER letters_immutable` يرفض أي `UPDATE`، و`TRIGGER` يرفض الحذف، و`CHECK` يكرر فصل المهام على مستوى SQL. |
| `letter_cancellations` | الإلغاء سجل جديد (سبب، من، متى) يبطل رمز التحقق ولا يمس نسخة الخطاب. | `TRIGGER` يمنع تعديله أو حذفه، وسجل واحد لكل خطاب. |

## 3. المسارات التي يحتاجها المنسّق في `app/server.mjs`

استيراد: `import * as letters from './letters.mjs';`

### قراءة (GET، خارج المعاملة)

| الطريقة | المسار | الدالة |
|---|---|---|
| GET | `/api/letters` | `letters.lettersBoard(db,u)` |
| GET | `/api/letters/templates` | `letters.templatesBoard(db,u)` — ترمي 403 `not_permitted` لمن لا يملك أي تصريح خطابات |
| GET | `/api/letters/:letterId/print` | `letters.letterPrintable(letters.letterDocument(db,u,letterId))` — تُرسَل `text/html; charset=utf-8` مع `Cache-Control: no-store` على نمط مسار `/print` القائم للفواتير والقسائم. `letterId` بنمط `[a-f0-9-]{36}`. |

### كتابة (POST، داخل `transaction`)

| المسار | الدالة | `Idempotency-Key` |
|---|---|---|
| `/api/letters` | `letters.requestLetter(db,u,input)` | نعم — عبر `once(()=>…,id=>({id}))` |
| `/api/letters/:id/(prepare_letter\|reject_letter\|cancel_request\|issue_letter\|cancel_letter)` | `letters.letterAction(db,u,id,action,input)` | لا (كل فعل يحمل `version`) |
| `/api/letters/templates/:code` | `letters.saveTemplate(db,u,code,input)` | لا |
| `/api/letters/templates/:code/approve` | `letters.approveTemplate(db,u,code,input)` | لا |
| `/api/letters/types` | `letters.addLetterType(db,u,input)` | نعم |
| `/api/letters/types/:code/(retire_letter_type\|activate_letter_type)` | `letters.letterTypeAction(db,u,code,action,input)` | لا |

`:id` معرّف UUID، و`:code` بنمط `[a-z][a-z0-9_-]{2,39}`. كل دوال الكتابة تبدأ بـ`if(!db.isTransaction)fail(500,'transaction_required',…)`.

### مسار التحقق العام — يحتاج قرارك

| GET | `/verify/letter/:code` | `letters.verifyLetter(db,code)` |

- **بلا مصادقة**: هذا هو المسار الذي يحمله رمز QR على ورق الخطاب، ويفتحه من خارج الشركة. لا بد من استثنائه من `authenticate` ومن فحص CSRF.
- **يجب أن يكون محدود المعدل**: الرمز 12 حرفًا عشوائيًا، لكن المسار مفتوح، فيلزمه حدّ معدل على العنوان (على نمط `login_attempts` في `app/auth.mjs`). لم أبنه لأنه يخص طبقة الخادم وحدها وهي ملكك.
- ما يعيده: `{found:true,issued_on,statement}` أو `{found:false,statement}` فقط. لا اسم ولا وظيفة ولا راتب ولا رقم مرجعي. الخطاب الملغى يعامل معاملة غير الموجود. أعيد كائن بيانات؛ إن أردت صفحة HTML للزائر فاكتبها في طبقتك من هذين الحقلين.
- **لا يسجّل في سجل التدقيق**: `audit` يلزمه فاعل، ولا فاعل هنا. إن أردت أثرًا لعمليات التحقق فهو قرار مالك يحتاج جدولًا مستقلًا بلا هوية زائر.

## 4. مفتاح الوحدة في `operationModules`

```js
import { lettersUI, letterTemplatesUI } from './letters-ui.mjs';
// …
letters: lettersUI, 'letter-templates': letterTemplatesUI
```

- اسم الملف للقائمة البيضاء في `app/server.mjs`: `letters-ui`.
- مجموعة التنقل: `letters` في **خدمات الموظف** بجوار «الإجازات» و«الحضور» — شاشة لكل موظف. و`letter-templates` في **خدمات الموظف** أيضًا لكنها لا تفتح إلا لمن يملك `hr.letters.prepare` أو `hr.letters.issue` (اللوحة ترمي 403 لغيرهم).
- لم أضف أي صنف CSS جديد. الشاشتان تستخدمان الأصناف القائمة فقط، وروابط الطباعة على نمط `invoices-ui.mjs`.

## 5. ما ينبغي أن يظهر في «بانتظار قراري»

اللوحتان تعيدان `awaiting_me` جاهزًا بالشكل الذي يقرأه `app/inbox.mjs`:

```js
['letters','خطابات الموظفين',(db,u)=>({letters:lettersBoard(db,u).awaiting_me})],
['letter-templates','قوالب الخطابات',(db,u)=>{try{return {templates:templatesBoard(db,u).awaiting_me};}catch{return {templates:[]};}}],
```

`templatesBoard` ترمي 403 لمن لا تصريح له، فتحتاج `try` كما في نمط `statements` عندك، أو استدعِ `holds` قبلها.

**تنبيه على `app/inbox.mjs` (ملفك أنت):**
- `issue_letter` يعمل تلقائيًا (`labelFor` يقرأ رأس `issue` ← «إصدار»).
- `approve_template` يعمل تلقائيًا (`approve` ← «اعتماد»).
- `prepare_letter` **لن يظهر**: ليس في `DECISIONS` ولا يطابق `NOT_DECISIONS`، فيعيد `labelFor` قيمة فارغة. إن أردت ظهوره أضف `prepare_letter:'إعداد الخطاب'` إلى `DECISIONS`، وأضف `letters:'خطاب موظف'` و`templates:'قالب خطاب'` إلى `KINDS`.

## 6. ما لم أبنه ولماذا، وما يحتاج قرارًا

1. **نص الخطابات نفسها.** هذا أهم بند: القوالب الخمسة تُنشأ فارغة، والمنصة لا تقترح جملة واحدة ولا صيغة رسمية. لا تصير المنصة قادرة على إصدار أي خطاب حتى يكتب **مالك الإجراء** (حامل `hr.letters.issue`) النص ويعتمده. حتى ذلك الحين تقول الشاشة صراحة: «أنواع بلا قالب معتمد بعد، فلا يمكن طلبها». **قرار مالك إجراء مطلوب: كتابة نصوص القوالب الخمسة واعتمادها.**
2. **العناصر النائبة محصورة في خمسة** (`employee_name` `job_title` `hire_date` `salary_total` `addressee`)، وأي عنصر آخر يُرفض عند الحفظ. ما لا تعرفه المنصة من سجلاتها لا يصير عنصرًا نائبًا. توسيع القائمة يحتاج حقلًا حقيقيًا في سجل الموظف أولًا.
3. **مصدر كل قيمة**: المسمى الوظيفي من العقد الساري ثم الملف الوظيفي، وتاريخ المباشرة من الملف الوظيفي ثم بداية العقد، والراتب من العقد الساري وقت الإصدار. **إن نقصت قيمة يطلبها القالب فالإعداد والإصدار يُرفضان بنص يسمي الناقص**؛ لا تُملأ فراغات ولا تُخمَّن قيمة.
4. **الراتب**: لا عمود له في `letters` ولا في `letter_requests` ولا في سجل التدقيق؛ يُشتق عند الإصدار ويُثبَّت داخل نص الخطاب وحده. ونص خطاب صادر عن قالب يذكر `{{salary_total}}` لا يقرؤه إلا صاحبه أو حامل `hr.letters.issue` — حتى المُعِدّ لا يقرؤه بعد الإصدار.
5. **الأنواع الأساسية الخمسة صفوف بلا `tenant_id`** (مرجع مشترك بين الكيانات، لا بيانات موظفين). كل استعلامات الموظفين والخطابات محدودة بـ`tenant_id`، واستعلام الأنواع محدود بـ`WHERE tenant_id=? OR tenant_id IS NULL`. **أثر هذا**: الكيان يضيف أنواعه ويوقفها، لكنه لا يستطيع إيقاف نوع أساسي لا يستخدمه (مثل «تعريف لسفارة»). لو أردت ذلك فالحل الأنظف جدول حالة لكل كيان — لم أبنه لأنه خارج ما طُلب. **قرار المنسّق.**
6. **الطلب نيابة عن موظف آخر** مدعوم في `requestLetter` عبر `user_id` لحامل تصريح خطابات، لكن الشاشة لا تعرضه بعد (تطلب لنفسك فقط). أضفته في الخلفية لأن الموارد البشرية تفتح طلبات عن موظفين لا يستخدمون المنصة؛ عرضه في الشاشة يحتاج قائمة موظفين في اللوحة.
7. **لا ربط بجدول `requests` ولا بخدمة `HR-LETTER` في الدليل.** الخدمة القائمة «طلب خطاب وظيفي» تبقى كما هي؛ هذه الشاشة هي التنفيذ الفعلي. ربطها في `SERVICE_MODULES` داخل `app/service-cards.mjs` (ملف وكيل آخر) يحتاج إضافة `'HR-LETTER':'letters'` هناك — **لم ألمسه**، وهو قرارك.
8. **لا ملف PDF ولا توقيع إلكتروني ولا ختم.** المستخدم يحفظ الصفحة PDF من المتصفح كما في باقي مستندات المنصة. الخطاب لا يدّعي توقيعًا ولا اعتمادًا نظاميًا خارجيًا.
9. **التسلسل بلا فجوات** يعتمد على `BEGIN IMMEDIATE` في `transaction` مع `UNIQUE(tenant_id,year,serial)`: لو تزامن إصداران فشل الثاني وأُعيد، ولا يُستهلك رقم. لا يوجد جدول عدّادات منفصل.

## 7. نتيجة الاختبارات كما ظهرت

```
$ node --test tests/letters.test.mjs
✔ letter templates: the platform writes no letter text, only the approved placeholders pass, and whoever writes a template never approves it (297.391541ms)
✔ letter types are rows, not a list in code: the procedure owner adds and retires them, and a type without an approved template cannot be requested (282.086667ms)
✔ employment letter: the employee requests it, one person prepares and another issues, and the reference is a gapless yearly serial carrying a QR verification path (340.945083ms)
✔ salary letter: the amount is derived from the live contract at issue time, is stored in no column, and its text reaches only its owner and whoever may issue it (288.446917ms)
✔ letters stay inside their tenant, and SQL refuses a request whose preparer is also its issuer or its subject (281.72325ms)
ℹ tests 5
ℹ pass 5
ℹ fail 0
```

وللتأكد أنني لم أكسر ما حولي (بلا `npm test` كامل):

```
$ node --test tests/migrations.test.mjs tests/hr-contracts.test.mjs tests/service-cards.test.mjs \
    tests/employees.test.mjs tests/print-documents.test.mjs tests/qr.test.mjs tests/inbox.test.mjs \
    tests/static-modules.test.mjs
ℹ tests 19 · pass 19 · fail 0

$ node --test tests/access.test.mjs tests/ui-render.test.mjs tests/platform.test.mjs
ℹ tests 22 · pass 22 · fail 0
```

`verifyAudit(db)` يُتحقق منه في آخر كل اختبار من اختباراتي الخمسة.

الشاشتان فُحصتا خارج المستودع بنفس منطق `tests/ui-render.test.mjs` (لأن الوحدة لم تُضف بعد إلى `operationModules` وهو ملفك): ترسمان للأدوار الخمسة، وكل زر يفتح نموذجًا صالحًا، ولا `undefined` ولا `style=""` ولا `<script>` في أي مخرج، بما في ذلك صفحة الطباعة.
