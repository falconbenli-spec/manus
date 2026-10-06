# تسليم `pr-equipment` — العلاقات العامة (062) وحجز المعدات والعهد (063)

## 1. الملفات

أُنشئت (ولم يُعدَّل أي ملف قائم، ولا ملف مشترك، ولا اختبار قائم):

- `app/migrations/062-pr.sql`
- `app/migrations/063-equipment.sql`
- `app/pr.mjs`
- `app/equipment.mjs`
- `app/static/pr-ui.mjs`
- `app/static/equipment-ui.mjs`
- `tests/pr.test.mjs`
- `tests/equipment.test.mjs`
- `docs/implementation/handoff/pr-equipment.md` (هذا الملف)

## 2. الهجرتان وجداولهما

### 062-pr.sql

| الجدول | ما فيه | أبرز القيود في SQL |
|---|---|---|
| `media_contacts` | الصحفي/المحرر، الوسيلة ونوعها، مجالات التغطية، لغة التواصل، التفضيلات، بريد وهاتف اختياريان، **وأساس جمع البيانات ومصدره وتاريخه** | `lawful_basis` من قائمة مغلقة، `basis_note` ≥ 10 حروف، `collected_on` و`source` إلزاميان، `version`، منع الحذف نهائيًا (الأرشفة بديلًا)، منع تعديل المؤرشف قبل إعادته |
| `media_lists` | قائمة منتقاة لحملة أو خبر، مربوطة اختياريًا بعميل وحملة | `locked_by <> created_by` (من انتقى لا يعتمد)، القفل يحتاج سببًا ≥ 10، والمقفلة لا تُعدَّل (trigger) |
| `media_list_members` | أعضاء القائمة | لا إضافة ولا إزالة ولا تعديل على قائمة مقفلة (triggers) |
| `pr_pitches` | المراسلة: لمن، متى، بأي زاوية، وكيف أُرسلت، وحالتها (`sent/replied/declined/published`) | الحالة غير `sent` تلزمها نتيجة بتاريخ وملاحظة، والمرفوضة/المنشورة نهائية، ولا يتغير المرسَل إليه ولا الزاوية ولا تاريخ الإرسال |
| `pr_coverage` | التغطية: الرابط، الوسيلة ونوعها، التاريخ، النبرة وسببها بتقدير بشري، «من الأبرز» بسببه، والربط بالعميل والحملة والمراسلة | `UNIQUE(tenant_id,url)` فلا تُحتسب التغطية مرتين، `tone_reason` ≥ 10، `highlight` يلزمه سبب، منع الحذف |

### 063-equipment.sql

| الجدول | ما فيه | أبرز القيود في SQL |
|---|---|---|
| `equipment_items` | القطعة، رقمها التسلسلي، فئتها، حالتها المادية، مكانها، **وربطها بسجل الأصل `fixed_assets`** | `UNIQUE` على الرقم التسلسلي وعلى `asset_id` (ربط لا تكرار)، «مفقود» يلزمه بلاغ ومقرّ مختلف عنه بسبب مكتوب، والمفقودة/المستبعدة نهائية |
| `equipment_kits` + `equipment_kit_items` | أطقم متعددة القطع | القطعة في طقم واحد على الأكثر (`UNIQUE(item_id)`) |
| `equipment_bookings` | حجز بمدى تواريخ، بحامل عهدة مسمّى، ومشروع اختياري ومرجع إنتاج نصي | **منع الحجز المزدوج بمحفّزين في SQL** على الإدراج والتعديل (أي تقاطع مدى مع حجز `reserved/out` يُرفض)، ومنع حجز قطعة في الصيانة أو مفقودة أو مستبعدة، والمقفل نهائي |
| `equipment_movements` | تسليم/استلام بحالة القطعة وإقرار المستلم باسمه ووقته | `released_by <> received_by`، `acknowledged_by = received_by`، حركة واحدة من كل نوع لكل حجز، الاستلام بعد التسليم، ولا تعديل ولا حذف |
| `equipment_photos` | صور الحالة عند التسليم وعند الاستلام (PNG/JPEG، ≤ 2 ميغابايت، بتوقيع محتوى) | دليل يُضاف ولا يُعدَّل ولا يُحذف |
| `equipment_maintenance` | أوامر عمل الصيانة بتكلفتها ومرجع فاتورتها | الإقفال يلزمه سبب ≥ 10، التكلفة تلزمها مرجع، والمقفل نهائي |
| `equipment_inventory_checks` + `equipment_inventory_scans` | جولة جرد وتأكيد وجود القطع | `closed_by <> started_by`، ولا مسح على جولة مقفلة، والمسح لا يُعدَّل ولا يُحذف |

## 3. المسارات التي يحتاجها المنسّق في `app/server.mjs`

كل `POST` داخل معاملة (`transaction`) لأن دوال الكتابة ترفض بلا معاملة. عمود «مفتاح التكرار» يعني `Idempotency-Key` كما في `once(...)` المتبع للإنشاء.

### العلاقات العامة (`import * as pr from './pr.mjs'`)

| الطريقة | المسار | الدالة | معاملة | Idempotency-Key |
|---|---|---|---|---|
| GET | `/api/pr` | `pr.prBoard(db,u,{client_id:url.searchParams.get('client_id')??undefined,campaign_id:url.searchParams.get('campaign_id')??undefined})` | لا | لا |
| GET | `/api/media-contacts` | `pr.mediaContactsBoard(db,u)` | لا | لا |
| GET | `/api/pr/report` (اختياري) | `pr.coverageReport(db,u,{client_id,campaign_id})` | لا | لا |
| POST | `/api/media-contacts` | `pr.createContact(db,u,input)` | نعم | نعم |
| POST | `/api/media-contacts/:id/(edit\|archive\|restore)` | `pr.contactAction(db,u,id,action,input)` | نعم | لا |
| POST | `/api/pr/lists` | `pr.createList(db,u,input)` | نعم | نعم |
| POST | `/api/pr/lists/:id/(add\|remove\|lock)` | `pr.listAction(db,u,id,action,input)` | نعم | لا |
| POST | `/api/pr/pitches` | `pr.createPitch(db,u,input)` | نعم | نعم |
| POST | `/api/pr/pitches/:id/(reply\|decline\|published)` | `pr.pitchAction(db,u,id,action,input)` | نعم | لا |
| POST | `/api/pr/coverage` | `pr.createCoverage(db,u,input)` | نعم | نعم |
| POST | `/api/pr/coverage/:id/edit` | `pr.coverageAction(db,u,id,'edit',input)` | نعم | لا |

`:id` في كل ما سبق `[a-f0-9-]{36}`.

### المعدات (`import * as equipment from './equipment.mjs'`)

| الطريقة | المسار | الدالة | معاملة | Idempotency-Key |
|---|---|---|---|---|
| GET | `/api/equipment` | `equipment.equipmentBoard(db,u,{days:Number(url.searchParams.get('days'))||undefined})` | لا | لا |
| GET | `/api/equipment/items/:id/qr` | `equipment.itemQr(db,u,id)` | لا | لا |
| GET | `/api/equipment/photos/:id` | `equipment.movementPhoto(db,u,id)` | لا | لا |
| POST | `/api/equipment/items` | `equipment.createItem(db,u,input)` | نعم | نعم |
| POST | `/api/equipment/items/:id/(edit\|report_lost\|confirm_lost\|reject_lost\|retire\|return_to_service)` | `equipment.itemAction(db,u,id,action,input)` | نعم | لا |
| POST | `/api/equipment/kits` | `equipment.createKit(db,u,input)` | نعم | نعم |
| POST | `/api/equipment/kits/:id/(add_item\|remove_item\|archive)` | `equipment.kitAction(db,u,id,action,input)` | نعم | لا |
| POST | `/api/equipment/bookings` | `equipment.createBooking(db,u,input)` | نعم | نعم |
| POST | `/api/equipment/bookings/:id/(hand_out\|hand_in\|cancel)` | `equipment.bookingAction(db,u,id,action,input)` | نعم | لا |
| POST | `/api/equipment/work-orders` | `equipment.openWorkOrder(db,u,input)` | نعم | نعم |
| POST | `/api/equipment/work-orders/:id/(start\|complete\|cancel)` | `equipment.workOrderAction(db,u,id,action,input)` | نعم | لا |
| POST | `/api/equipment/inventory` | `equipment.startCheck(db,u,input)` | نعم | نعم |
| POST | `/api/equipment/inventory/:id/(scan\|close)` | `equipment.checkAction(db,u,id,action,input)` | نعم | لا |

ملاحظتان على مساري GET الخاصين:

- **رمز QR:** `itemQr` يعيد `{id,code,name,target,svg,note}`. الواجهة تضع رابطًا إلى `/api/equipment/items/<id>/qr?format=svg`، فإن كانت `format=svg` أرسل `result.svg` بترويسة `Content-Type: image/svg+xml` ليُفتح ويُطبع مباشرة؛ وإلا فأرسل الكائن JSON. `target` هو `/#equipment/item/<id>`: يلزم أن يقبل موجّه `app.mjs` هذا المسار ويفتح صفحة القطعة (وإلا فغيّر `qrTarget` في `app/equipment.mjs` إلى الشكل الذي يعتمده الموجّه).
- **الصور:** `movementPhoto` يعيد `{id,label,media_type,size,content}` حيث `content` هو BLOB. أرسله كما تُرسل `files.downloadFile` (ترويسات التنزيل الصارمة نفسها) مع `Content-Type: image/png|image/jpeg`.

## 4. مفاتيح الوحدات في `operationModules` وقائمة الملفات الثابتة

| المفتاح | الثابت المصدَّر | الملف | مجموعة التنقّل | التصريح |
|---|---|---|---|---|
| `pr` | `prUI` | `app/static/pr-ui.mjs` | التشغيل | `pr.manage` |
| `media-contacts` | `mediaContactsUI` | `app/static/pr-ui.mjs` | التشغيل | `pr.manage` |
| `equipment` | `equipmentUI` | `app/static/equipment-ui.mjs` | التشغيل | `equipment.manage` (وشاشة مختصرة «عهدي» لمن لا يحمله) |

يلزم إضافة `'pr-ui'` و`'equipment-ui'` إلى قائمة الملفات الثابتة البيضاء في `app/server.mjs` (السطر الذي يبني `assets` من أسماء الوحدات)، وإلا كسرت الصفحة كلها في المتصفح.

## 5. ما ينبغي أن يظهر في «بانتظار قراري»

| الحدث | لمن | الاستعلام |
|---|---|---|
| قائمة إعلامية مسودة فيها جهة واحدة على الأقل، لغير من أعدّها | حاملو `pr.manage` عدا `created_by` | `media_lists WHERE status='draft'` مع وجود عضو |
| بلاغ فقد بانتظار الإقرار | مدير (`role='manager'`) غير `lost_reported_by` | `equipment_items WHERE status='lost_review'` |
| حجز مُسلَّم تجاوز تاريخ إعادته | فريق المخزن وحامل العهدة | `equipment_bookings WHERE status='out' AND end_date < اليوم` |
| جولة جرد مفتوحة بانتظار إقفال من غير من بدأها | حاملو `equipment.manage` عدا `started_by` | `equipment_inventory_checks WHERE status='open'` |

`app/inbox.mjs` ملك المنسّق فلم أمسّه؛ الأعلام جاهزة في اللوحات (`late`, `overdue`, `actions`).

## 6. ما لم أبنه ولماذا، وما يحتاج قرار المالك

1. **لا إرسال بريد ولا أي إرسال من المنصة.** لا مزوّد بريد موصول؛ المراسلة تُرسل يدويًا من بريد الموظف أو هاتفه، والمنصة تسجّل ما جرى. الشاشة تقول ذلك نصًا.
2. **لا رصد إعلامي آلي ولا حصة صوت ولا تحليل مشاعر.** كلها تحتاج اشتراكًا خارجيًا؛ النبرة هنا تقدير بشري مكتوب باسم من سجّله ومعه سببه.
3. **لا «قيمة إعلانية مكتسبة» (AVE).** أي رقم من هذا النوع يحتاج منهجية معلنة لا نملكها؛ التقرير عدّ وتوزيع وأبرز ما وسمه الإنسان فقط، وفي اختباره تأكيد أن الحقل غير موجود أصلًا.
4. **بيانات جهات الإعلام بيانات شخصية لأطراف خارجية**: محصورة بحامل `pr.manage`، لكل سجل أساس ومصدر وتاريخ جمع، وبيانات التواصل لا تدخل سجل التدقيق، والحذف الفيزيائي ممنوع بمحفّز. **يخص سجل معالجة البيانات**: وكيل آخر يبني `app/privacy.mjs` ولم أستورده؛ يلزم ربط نشاط معالجة باسم «دليل جهات الإعلام» ومسار لطلبات أصحاب البيانات (اطلاع/تصحيح/حذف). **قرار المالك:** مدة الاحتفاظ، ومن يبت في طلب الحذف، وهل يُحذف السجل فعليًا أم يُطمس محتواه.
5. **ربط الإنتاج نص حر.** `production_ref` حقل نصي اختياري لأن `app/production.mjs` يبنيه وكيل آخر الآن ولم أستورده؛ **المنسّق يصل الحقلين** (مفتاح `production_id` مع قيد مرجعي في هجرة لاحقة).
6. **صور الحالة في جدول الوحدة نفسها** (`equipment_photos`) لا في `app/files.mjs`، لأن إضافة نوع سجل هناك تعديل على ملف يستعمله وكلاء آخرون. إن أراد المنسّق توحيد مخزن الملفات فالتحويل هجرة لاحقة.
7. **الإقرار ليس توقيعًا ذا حجية.** عهدة المستلم إقرار داخلي باسمه ووقته؛ لم أربطه بـ`signature.mjs` ولا أدّعي أثرًا نظاميًا. **قرار المالك:** هل يكفي هذا الإقرار للمطالبة بقيمة قطعة مفقودة، أم يلزم نموذج عهدة موقّع ورقيًا كذلك؟
8. **تكلفة الصيانة تُسجَّل ولا تُرحَّل محاسبيًا.** لا قيد في الدفتر ولا ربط بالمشتريات أو المستحقات؛ الحقل مبلغ بالهللات مع مرجع فاتورته. **قرار المالك أو مالك إجراء المالية:** هل تُرحَّل أوامر الصيانة إلى المصروفات؟
9. **إقرار الاستلام متاح لحامل العهدة ولو لم يحمل `equipment.manage`** — وإلا وقّع أمين المخزن نيابة عن المستلم وضاع معنى العهدة. كل ما عدا ذلك (تسجيل قطعة، حجز، استلام الإعادة، صيانة، جرد) يلزمه التصريح.
10. **إقرار الفقد مشروط بدور `manager` أو الأدمن الأول** بوصفه «المسؤول الأعلى» المتاح في نموذج الأدوار القائم. إن أراد المالك سلسلة تصعيد أدق (مدير الإدارة مثلًا) فهذا إعداد يدخله صاحبه لا قيمة مبرمجة.
11. **لا أرقام نظامية ولا أسعار ولا مهل حكومية** في الهجرتين ولا في الوحدتين. حد «لا يُسجل حجز أقدم من ثلاثين يومًا» قيد إدخال تشغيلي لا مهلة نظامية.
12. **الاستغلال يُحسب من أيام التسليم الفعلي** المسجلة في المنصة فقط: لا ساعات تشغيل ولا قراءة من الجهاز.

## 7. نتيجة تشغيل الاختبارات

```
$ node --test tests/pr.test.mjs tests/equipment.test.mjs
✔ media contacts: an outside person is never recorded without a lawful basis, a source and a collection date, and the directory is closed to accounts without the capability and to other tenants
✔ media list: the person who picked the list does not lock it, and a locked list is replaced rather than edited
✔ pitches and coverage: the platform records a hand-sent pitch, a published pitch is final, coverage counts once per link with a human tone judgement, and the report invents no advertising value
✔ equipment item: the capability guards the store, the accounting asset is linked and never duplicated, and a QR code points at the internal item page
✔ booking: SQL itself refuses an overlapping booking, a kit is booked as one block, and an item in maintenance is not booked
✔ custody: the one who releases is never the one who receives, the custodian signs their own receipt in the platform, and a custody record is never rewritten
✔ lost and inventory: whoever reports a loss never confirms it, confirmation is a higher manager decision with a written reason, the person who starts a stock check does not close it, and utilisation counts handed-out days only
ℹ tests 7 · pass 7 · fail 0
```

والاختبارات القريبة من الوحدتين، شُغّلت بأسمائها بعد التغيير ولم يكسر منها شيء:

```
$ node --test tests/migrations.test.mjs tests/qr.test.mjs tests/expenses-assets.test.mjs tests/access.test.mjs tests/campaigns.test.mjs tests/static-modules.test.mjs
ℹ tests 19 · pass 19 · fail 0
```

(لم أشغّل `npm test` كاملًا كما ينص عقد العمل، لوجود وكلاء آخرين يعملون الآن.)

كل اختبار ينتهي بـ`verifyAudit(db)`، ويغطي الملفان: منع الاعتماد الذاتي (قفل القائمة، إقرار الفقد، إقفال الجرد، التسليم والاستلام)، ومنع تعديل المعتمد (القائمة المقفلة، المراسلة المنشورة، الحركة، الصورة، أمر العمل المقفل، القطعة المفقودة)، وتعارض `version`، وعزل `tenant`، وصلاحية كل دور، ومنع الحجز المزدوج بإدخال SQL مباشر يتجاوز الكود.
