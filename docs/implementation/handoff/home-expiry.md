# تسليم `home-expiry`

## 1. الملفات

أنشأتها (ولم أعدّل أي ملف قائم إطلاقًا):

- `app/home.mjs` — لوحة الصفحة الرئيسية حسب الدور.
- `app/static/home-ui.mjs` — شاشة الصفحة الرئيسية (`homeUI`).
- `app/expiry.mjs` — مراقبة انتهاء الوثائق وإعداد مدد التذكير.
- `app/static/expiry-ui.mjs` — شاشة مراقبة الانتهاء (`expiryUI`).
- `app/migrations/049-expiry-watch.sql` — هجرتي المحجوزة.
- `tests/home.test.mjs` · `tests/expiry.test.mjs`.

لم أُعدّل `app/workspace.mjs` ولا `app/routing.mjs` ولا `app/inbox.mjs` ولا `app/access.mjs` ولا أي ملف مشترك ولا أي اختبار قائم. لم أضف أي تصريح جديد؛ استخدمت `portal.use` و`employees.view` و`vendors.view` و`hr.contracts.manage` كما هي. لم أضف أي صنف CSS جديد.

## 2. الهجرة 049

جدول واحد: `expiry_watch_settings(tenant_id, doc_kind, first_reminder_days, second_reminder_days, basis, updated_by, updated_at, version)` بمفتاح أولي `(tenant_id, doc_kind)`.

- **يبدأ بلا صفوف.** لا مدة نظامية مفترضة في الكود ولا في الهجرة: ما لم يُدخل مالك الإجراء مدته يبقى بلا حالة «يقترب من الانتهاء».
- `basis` إلزامي بعشرة أحرف فأكثر: مصدر المدة ومن أكدها ومتى.
- `CHECK(first_reminder_days>second_reminder_days)` — الأول تنبيه مبكر والثاني تحذير قرب الموعد.
- `TRIGGER expiry_watch_settings_versioned` يرفض أي تحديث لا يرفع `version` بواحد أو يغيّر المفتاح (القاعدة 3 مفروضة في SQL لا في الكود وحده).
- `TRIGGER expiry_watch_settings_no_delete` — الإعداد يُستبدل بقيمة جديدة مؤرخة ولا يُحذف.

**ملاحظة على مبدأ فصل المهام:** الصف هنا إعداد يملكه صاحب الإجراء، لا سجل قرار يمر باعتماد، فلا يوجد فيه `approved_by` ليمنع الاعتماد الذاتي. أعمدة الجدول هي بالضبط ما نصّت عليه المهمة زائد `version`. إن أراد المالك جعل المدة قرارًا يعتمده شخص ثانٍ فذلك تغيير في السياسة يحتاج هجرة لاحقة وقراره — انظر §6.

## 3. المسارات التي يحتاجها المنسّق في `app/server.mjs`

| الطريقة | المسار | الدالة | داخل معاملة | Idempotency-Key |
|---|---|---|---|---|
| GET | `/api/home` | `home.homeBoard(db,u)` | لا | لا |
| GET | `/api/expiry` | `expiry.expiryBoard(db,u)` | لا | لا |
| POST | `/api/expiry/settings/:doc_kind` | `expiry.saveExpiryWatch(db,u,docKind,input)` | **نعم** | نعم عند الإدخال الأول فقط |

الاستيراد: `import * as home from './home.mjs';` و`import * as expiry from './expiry.mjs';`

اقتراح الصياغة داخل كتلة القراءة:

```js
if(p==='/api/home'&&req.method==='GET') {send(200,home.homeBoard(db,u));return;}
if(p==='/api/expiry'&&req.method==='GET') {send(200,expiry.expiryBoard(db,u));return;}
```

وداخل `transaction(db,()=>{ … })`:

```js
const expirySetting=p.match(/^\/api\/expiry\/settings\/([a-z][a-z_]*(?:\.[a-z_]+)?)$/);
if(expirySetting&&req.method==='POST') return once(()=>expiry.saveExpiryWatch(db,u,expirySetting[1],input),key=>({doc_kind:key}));
```

`doc_kind` حروف صغيرة وشرطة سفلية ونقطة واحدة اختيارية (`employee.passport`, `employment_contract`, `vendor.vat_certificate`). الدالة نفسها ترفض أي مفتاح خارج `WATCHED_KINDS` بـ`404 not_found`، فلا يعتمد الأمان على شكل المسار.

لا يحتاج أيٌّ من المسارين `access.require` في الخادم: `homeBoard` يقرأ كل مصدر بهوية المستخدم نفسه ويحذف ما يرفضه، و`expiryBoard` متاح لكل حساب ويعرض له وثائقه هو فقط ما لم يحمل تصريحًا أوسع. الحد الأدنى `portal.use` وهو للجميع.

## 4. مفاتيح `operationModules` والملفات الثابتة

| المفتاح | الملف الثابت | الاستيراد | مجموعة التنقل |
|---|---|---|---|
| `home` | `home-ui.mjs` | `import { homeUI } from './home-ui.mjs';` | «مساحتي» — المدخل `['home','◷','يومي','My day']` **موجود أصلًا** في `app.mjs` |
| `expiry` | `expiry-ui.mjs` | `import { expiryUI } from './expiry-ui.mjs';` | «مساحتي» — يحتاج مدخلًا جديدًا |

أضف الاسمين إلى قائمة الأصول البيضاء في `app/server.mjs` سطر 73: `'home-ui'` و`'expiry-ui'`.

**تنبيه مهم على المفتاح `home`:** المسار `#home` هو المسار الافتراضي للتطبيق (`location.hash.slice(1)||'home'`)، وله اليوم فرع مكتوب بخط اليد في `app/static/app.mjs` (السطر 129 وما بعده: `else if(['home','requests'].includes(view))`). و`app.mjs` يفحص `operationModules[view]` **أولًا**، فبمجرد تسجيل `home:homeUI` تحل شاشتي محل ذلك الفرع وتصبح صفحة الدخول الأولى. الفرع القديم يبقى ميتًا لمفتاح `home` ويظل عاملًا لمفتاح `requests`. هذا ملفك أنت يا منسّق: قرر إبقاء الفرع القديم أو تنظيفه، وقرر إبقاء تسمية «يومي» في التنقل أو تغييرها إلى «الرئيسية» (عنوان الوحدة).

**`expiry` يحتاج خطوتين في ملفين مشتركين لا أملكهما:**

1. في `app/static/app.mjs` داخل `shell()`: `nav.push(['expiry','◷','مراقبة انتهاء الوثائق','Document expiry']);` بلا شرط تصريح — كل موظف يرى وثائقه هو، ومن يحمل `employees.view` أو `vendors.view` أو `hr.contracts.manage` يرى نطاقه الأوسع، والوحدة نفسها هي التي تضيّق.
2. في `app/static/hr-design.mjs` داخل `groupedNavigation`: أضف `'expiry'` إلى مصفوفة مجموعة «مساحتي» (بعد `'home'`). بدون ذلك يسقط المدخل صامتًا لأن `groupedNavigation` لا يعرض إلا ما ورد في مجموعة.

## 5. «بانتظار قراري»

`expirySources(db,u)` يعيد الشكل الذي يبتلعه `app/inbox.mjs` بلا أي تعديل عليه:

```js
{ expiring: [ { id, title, created_at, expires_on, status, actions:['review_expiry'] } ] }
```

كيف يضمه المنسّق: سطر واحد في مصفوفة `SOURCES` في `app/inbox.mjs`:

```js
['expiry','انتهاء الوثائق',expirySources],
```

ما يعتمد عليه هذا الشكل في `inbox.mjs` بالضبط:

- `collect` يمشي على أي كائن أو مصفوفة ويلتقط العقدة التي فيها `actions` مصفوفة نصوص. المفتاح `expiring` **مقصود ألا يكون** في خريطة `KINDS` داخل `inbox.mjs`، فتأتي العقدة بـ`kind:''` ويظل النص كله من `title` — وهذا ما أردته حتى لا يوسم جواز سفر بأنه «مستند ضريبي».
- `labelFor('review_expiry')`: ليس في `ALWAYS_AVAILABLE`، ولا تطابقه `NOT_DECISIONS`، فيسقط إلى قاعدة رأس الفعل `DECISIONS['review']` ← **«مراجعة»**. لا حاجة لإضافة مفتاح إلى `DECISIONS`.
- `describe` يقرأ العنوان من `title` والتاريخ من `created_at`. وضعت في `created_at` **تاريخ الانتهاء نفسه** عمدًا: `age_days` في الصندوق يصير «كم مضى على الانتهاء»، وصفرًا لما لم ينتهِ بعد، و«متأخر» (ثلاثة أيام) يصير معناه «منتهٍ منذ ثلاثة أيام». إن رأيت أن الأنسب عمر السجل فالحقل `expires_on` موجود مستقلًا في كل عنصر.
- `link` يضبطه `inbox.mjs` بنفسه إلى `#expiry`.

الصندوق لا يعرض إلا ما حالته `expired` أو `due_soon`، ولا يعرض شيئًا لمن لا يملك الوثيقة ولا تصريح نطاقها.

`homeBoard` لا يحتاج شيئًا في الصندوق: هو يقرأ ولا يقرر.

## 6. ما لم أبنه ولماذا · ما يحتاج قرار مالك

1. **العقود التجارية لا تُراقَب.** فحصت `commercial_contracts` فعليًا: لا تحمل أي عمود انتهاء (لا `expires_on` ولا `valid_until` ولا `end_date`)، ولا `tenant_id` مباشرًا. لم أستنتج مدة من عندي ولم أضف عمودًا لجدول لا أملكه. الوحدة تصرّح بهذا في `not_watched` وتعرضه على الشاشة. **قرار المالك:** هل لسجل الاتفاق التجاري تاريخ سريان ينتهي؟ إن نعم فهو عمود في هجرة يملكها صاحب `commercial`.
2. **الشهادات الضريبية ووثائق التأمين** ليست جداول مستقلة: هي `kind` داخل `vendor_documents` (`vat_certificate`, `insurance`) و`doc_type` داخل `employee_documents` (`medical_insurance`). راقبتها من هناك ولم أنشئ جدولًا موازيًا. `company_tax_profiles` فحصتها: بلا تاريخ انتهاء (لها `effective_from` فقط)، فلم أدخلها.
3. **`employee_profiles.contract_end`** لم أدخله: هو تكرار لنهاية العقد في `employment_contracts` التي أراقبها، وإدخاله يعني رقمين لشيء واحد.
4. **لا تنبيه خارج المنصة.** لا بريد ولا رسالة ولا مهمة مجدولة. الرصد يظهر في الشاشة وفي صندوق القرارات فقط، والشاشة تصرّح بذلك.
5. **لا اعتماد ثانٍ على مدة التذكير** (انظر §2). قرار المالك: هل إدخال المدة فعل يكفي فيه مالك الإجراء وحده، أم قرار سياسة يعتمده شخص ثانٍ؟
6. **من يملك مدد وثائق الموردين:** استخدمت `vendors.view` لأنها التصريح القائم الذي يفتح دليل الموردين، وهي افتراضيًا لـ`manager` و`pm`. هذا يعني أن مدير فريق يستطيع إدخال مدة تذكير لوثائق الموردين. **قرار مالك الصلاحيات:** إن كان الأنسب `vendors.manage` فالتغيير سطر واحد في `WATCHED_KINDS` — لم أفعله لأن تعديل خريطة التصاريح خارج ما رُخّص لي.
7. **`homeBoard` لا يخترع صلاحية.** كل قسم يقرأ لوحته القائمة بهوية المستخدم نفسه (`listReceivables`, `listPayables`, `listFinance`, `listContracts`, `executiveOverview`)، وما يرد بـ403/404 يُحذف من الصفحة ويُذكر اسمه في `unavailable` بدل أن يُحتسب صفرًا كاذبًا. أرقام المدير والموارد البشرية محسوبة من `listRequests` بصلاحية الحساب نفسه، أي أنها «ما تراه أنت» لا «كل طلبات الكيان»، وهذا مكتوب في `scope_note` على الشاشة.
8. **القيادة:** أخذت من `executiveOverview` مجاميعه و`by_status` و`attention` فقط، بلا أسماء ولا عناوين طلبات، ومحروسة بـ`canReadExecutive` كما هي. الاختبار يتحقق من غياب أسماء الأشخاص وعناوين الطلبات من الكتلة.
9. **زمن الطلب** من `serviceClock` في `app/routing.mjs` كما هو. خدمة بلا `target_days` معتمد لا توصف بأنها في الموعد ولا متأخرة، بل تُعلن «بلا زمن مستهدف معتمد».
10. **`app/overview.mjs`** فيه `decisions` مشابهة؛ لم ألمسه ولم أبنِ عليه لأن `inbox.mjs` هو الصندوق المعتمد.

## 7. نتيجة تشغيل الاختبارات كما ظهرت

```
$ node --test tests/expiry.test.mjs
✔ expiry watch: the platform never assumes a reminder window — an expiry is only called “due soon” after its owner records the window with its source
✔ expiry watch: only the owner of the procedure records a window, the second write carries the version it read, and an unordered pair is refused
✔ expiry watch: an account is shown only the expiries it may open in detail, its own always, and never another tenant’s
✔ expiry sources: hands the shared decision box rows it can absorb unchanged, and keeps valid documents out of it
✔ expiry watch: a fixed-term contract end is watched like any other expiry, and only its holder and the contracts owner see it
✔ expiry watch: the watched kinds are exactly the expiry dates the existing tables really carry
✔ expiry screen: renders for every seeded role, offers the window form only to the owner of that kind, and never asks for a duration it invented
ℹ tests 7   ℹ pass 7   ℹ fail 0

$ node --test tests/home.test.mjs
✔ home: the page is built per role — an employee is shown their own work only, and each extra section appears with the permission that backs it
✔ home: leadership numbers stay aggregate — no request title and no person’s name reaches the leadership block
✔ home: the most used services are counted from this person’s own request history, never from a fixed list
✔ home: an open request carries the time left computed from the service clock, and a service with no agreed target time is never called on time or late
✔ home: a decision awaiting the approver appears with its age, and the manager’s oldest approval is the oldest one they can open
✔ home: expiring documents on the page are this person’s own, and a document is only called close to expiry once a window is recorded
✔ home: a tenant reads nothing of another tenant, and a screen reads only the sources its account may open
✔ home screen: renders for every seeded role with no escaping hole and no placeholder text
ℹ tests 8   ℹ pass 8   ℹ fail 0
```

الاختبارات القائمة القريبة من وحدتي، شُغّلت بالاسم بعد تغييري ولم يسقط منها شيء:

```
$ node --test tests/migrations.test.mjs tests/workspace.test.mjs tests/routing-portal.test.mjs \
    tests/inbox.test.mjs tests/employees.test.mjs tests/hr-contracts.test.mjs tests/static-modules.test.mjs
ℹ tests 19   ℹ pass 19   ℹ fail 0

$ node --test tests/vendors.test.mjs tests/ui-render.test.mjs tests/access.test.mjs tests/platform.test.mjs
ℹ tests 30   ℹ pass 30   ℹ fail 0

$ npm run check
Syntax checked: 221 JavaScript modules. Source hashes match. Traceability: 220 requirements / 22 domains.
```

لم أشغّل `npm test` كاملًا لأن وكلاء آخرين يعملون الآن. `tests/ui-render.test.mjs` لا يغطي شاشتيّ بعد لأنهما غير مسجلتين في `operationModules` (وهو ملفك)؛ غطيت الرسم والنماذج والتهريب و«لا `style=`» و«لا `<script>`» لكل دور داخل اختباريّ أنا.
