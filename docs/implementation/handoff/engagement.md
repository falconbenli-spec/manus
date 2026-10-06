# تسليم وحدة `engagement` — النبض والتقدير والإعلانات

## 1. الملفات

أُنشئت (ولم يُعدَّل أي ملف قائم):

- `app/migrations/065-engagement.sql`
- `app/engagement.mjs`
- `app/static/engagement-ui.mjs`
- `tests/engagement.test.mjs`
- `docs/implementation/handoff/engagement.md` (هذا الملف)

لم يُلمس أي ملف مشترك: لا `app/server.mjs` ولا `app/static/operations.mjs` ولا `app/access.mjs` ولا `app/inbox.mjs` ولا `app/static/style.css` ولا أي هجرة غير 065.

## 2. الهجرة 065 وجداولها

| الجدول | ماذا يحمل |
|---|---|
| `survey_privacy_settings` | الحد الأدنى للمستجيبين: **إعداد مؤرّخ** بسنده ومن قرره. لا صف افتراضي ولا قيمة في الكود. لا يُعدَّل ولا يُحذف؛ تغييره صف جديد بتاريخ سريان لاحق. |
| `pulse_cycles` | دورة النبض: مسودة ← مفتوحة ← مغلقة، تحمل `version` ولقطة `min_respondents` لحظة الفتح. `CHECK(opened_by<>prepared_by)` + `TRIGGER` يمنع إعادة كتابة دورة فُتحت. |
| `pulse_questions` | أسئلة الدورة (`scale` / `enps` / `comment`). تُستبدل ما دامت مسودة، وتتجمد بالفتح بـ`TRIGGER`. |
| `pulse_answers` | **الإجابات. بلا عمود مستخدم، بلا إدارة، بلا طابع زمني، و`WITHOUT ROWID` فلا ترتيب إدخال.** `TRIGGER` يمنع التعديل والحذف، وآخر يرفض أي إدخال والدورة ليست مفتوحة. |
| `pulse_participants` | «فلان شارك» فقط، بتاريخ اليوم لا بلحظته. `PRIMARY KEY(cycle_id,user_id)`، لا تعديل ولا حذف. |
| `recognition_values` | القيم المؤسسية التي يعرّفها صاحب الإجراء بسندها وتاريخ سريانها. تُسحب بسبب ولا تُعاد صياغتها تحت البطاقات التي استشهدت بها. |
| `recognition_cards` | بطاقة تقدير: مُرسِل، مُستقبِل، قيمة، نص، ظهور علني/خاص. `CHECK(from_user_id<>to_user_id)`، لا تعديل ولا حذف. **لا عمود نقاط ولا وزن ولا رتبة.** |
| `announcements` | إعلان بعنوان ونص وجمهور (الكل/إدارة) وتاريخي نشر وانتهاء، و`requires_ack` بسببه. `CHECK(published_by<>prepared_by)` + `TRIGGER` يمنع تعديل المنشور (يُسحب بسبب ويُنشر غيره). |
| `announcement_attachments` | مرفقات الإعلان (PDF/PNG/JPEG حتى 2MB) بالمحتوى والبصمة. غير قابلة للتعديل، ولا تُحذف بعد النشر. |
| `announcement_reads` | إقرار القراءة باسم صاحبه ووقته. لا تعديل ولا حذف. |
| `internal_events` | تقويم فعاليات بسيط (عنوان، تاريخ، وقت اختياري، مكان، جمهور). يُلغى بسبب مع `version`، ولا يُحذف. |

## 3. المسارات التي يحتاجها المنسّق في `app/server.mjs`

استيراد: `import * as engagement from './engagement.mjs';`

### GET (خارج المعاملة)

| المسار | الدالة |
|---|---|
| `GET /api/engagement/pulse` | `engagement.pulseBoard(db,u)` |
| `GET /api/engagement/recognition` | `engagement.recognitionBoard(db,u)` |
| `GET /api/engagement/announcements` | `engagement.announcementsBoard(db,u)` |

### تنزيل مرفق (داخل معاملة، ورد خام لا JSON)

`GET /api/engagement/announcements/files/<uuid>` ← `engagement.downloadAnnouncementFile(db,u,id)`
يعيد `{filename,media_type,content:Buffer}`. يُخدم بالطريقة نفسها التي يُخدم بها `/api/files/<id>` حاليًا (نفس ترويسات `sandbox` و`nosniff` و`Content-Disposition`). المسار الذي تبنيه الواجهة في `engagement-ui.mjs` هو هذا بالضبط.

### POST (كلها داخل معاملة الكتابة)

| المسار | الدالة | `Idempotency-Key` |
|---|---|---|
| `POST /api/engagement/pulse/privacy` | `setSurveyPrivacy(db,u,input)` | نعم (`once`) |
| `POST /api/engagement/pulse/cycles` | `createCycle(db,u,input)` | نعم (`once`) |
| `POST /api/engagement/pulse/cycles/<uuid>` | `editCycle(db,u,id,input)` | لا |
| `POST /api/engagement/pulse/cycles/<uuid>/approve` | `approveCycle(db,u,id,input)` | لا |
| `POST /api/engagement/pulse/cycles/<uuid>/close` | `closeCycle(db,u,id,input)` | لا |
| `POST /api/engagement/pulse/cycles/<uuid>/respond` | `submitPulse(db,u,id,input)` | نعم (`once`) |
| `POST /api/engagement/recognition/values` | `defineValue(db,u,input)` | نعم (`once`) |
| `POST /api/engagement/recognition/values/<uuid>/retire` | `retireValue(db,u,id,input)` | لا |
| `POST /api/engagement/recognition/cards` | `sendRecognition(db,u,input)` | نعم (`once`) |
| `POST /api/engagement/announcements` | `draftAnnouncement(db,u,input)` | نعم (`once`) |
| `POST /api/engagement/announcements/<uuid>` | `editAnnouncement(db,u,id,input)` | لا |
| `POST /api/engagement/announcements/<uuid>/attachments` | `attachToAnnouncement(db,u,id,input)` | نعم (`once`) |
| `POST /api/engagement/announcements/<uuid>/approve` | `approveAnnouncement(db,u,id,input)` | لا |
| `POST /api/engagement/announcements/<uuid>/withdraw` | `withdrawAnnouncement(db,u,id,input)` | لا |
| `POST /api/engagement/announcements/<uuid>/acknowledge` | `acknowledgeAnnouncement(db,u,id)` — **بلا `input`** | لا |
| `POST /api/engagement/announcements/events` | `createEvent(db,u,input)` | نعم (`once`) |
| `POST /api/engagement/announcements/events/<uuid>/cancel` | `cancelEvent(db,u,id,input)` | لا |

كل الدوال الكاتبة تبدأ بـ`if(!db.isTransaction)fail(500,'transaction_required',…)` وتتحقق من التصريح بنفسها؛ لا حاجة إلى `access.require` في الخادم.

## 4. مفاتيح `operationModules` والقائمة البيضاء

- الملف الثابت: أضف `'engagement-ui'` إلى قائمة الوحدات المخدومة في `app/server.mjs` (سطر `assets.set`).
- في `app/static/operations.mjs`:
  `import { pulseUI, recognitionUI, announcementsUI } from './engagement-ui.mjs';`
  ثم ثلاثة مفاتيح في `operationModules`: `pulse:pulseUI` و`recognition:recognitionUI` و`announcements:announcementsUI`.
- مجموعة التنقّل المقترحة: `pulse` و`recognition` مع **خدمات الموظف** (بجوار `performance` و`growth`)، و`announcements` مع **الأساس** (بجوار `inbox`) لأنها تخص كل موظف لا الموارد البشرية وحدها.

## 5. صندوق «بانتظار قراري»

اللوحتان تعرضان `awaiting_me` جاهزة. المقترح في `app/inbox.mjs` (ملكك أنت):

```js
['announcements','الإعلانات الداخلية',(db,u)=>({announcements:announcementsBoard(db,u).awaiting_me})]
```

الأفعال التي تظهر بالقاموس القائم في `inbox.mjs` دون أي تعديل عليه:

- `acknowledge` → «إقرارك مطلوب» (إعلان يستوجب إقرارًا ولم تقرّ به بعد).
- `approve_announcement` → «اعتماد» (مسودة إعلان كتبها غيرك وتنتظر نشرك).

**لم أُدرج استبيان النبض في الصندوق عمدًا.** `answer_pulse` و`approve_cycle` و`close_cycle` لا تنتج تسمية في `inbox.mjs` بتصميمه الحالي، وهذا هو الصواب هنا: دعوة إلى استبيان طوعي ليست قرارًا منتظرًا، ووضعها في صندوق «بانتظار قراري» يحوّل المشاركة إلى واجب مُتابَع. إن رأى المالك غير ذلك فهو قراره، ويحتاج مفتاحًا جديدًا في `DECISIONS` داخل `inbox.mjs`.

## 6. ما لم أبنِه ولماذا، وما يحتاج قرارًا

1. **لا إشعار في جدول `notifications` القائم.** الجدول في `app/schema.sql` معرّف `request_id TEXT NOT NULL REFERENCES requests(id)`، فلا يقبل سطرًا لإعلان لا طلب له. توسيعه يعني تعديل مخطط مطبّق وهو ممنوع عليّ. البديل المطبَّق: الإعلان يظهر في شاشته وفي صندوق «بانتظار قراري» عبر `acknowledge`. **قرار المنسّق/المالك:** إما هجرة لاحقة تجعل `request_id` اختياريًا وتضيف `entity_type`، أو البقاء على ما هو عليه. الشاشة تقول بصراحة إن الإشعار داخل المنصة فقط.
2. **لا بريد إلكتروني إطلاقًا.** لا مزوّد بريد مربوط، فلا رسالة تُرسل لأحد. مكتوب في نص الشاشة وفي قائمة «من لم يطّلع بعد».
3. **مرفقات الإعلان في جدول مستقل لا في `stored_files`.** `stored_files` يحصر `entity_type` بـ`CHECK` في الهجرة 035 على أربعة أنواع لا تشمل الإعلانات، وتوسيعه يتطلب إعادة بناء جدول مطبّق لوحدة ليست لي. الجدول الجديد يطبّق القيود نفسها: النوع من توقيع المحتوى لا من الامتداد، حد 2MB، بصمة تُتحقق عند التنزيل، لا تعديل ولا حذف بعد النشر. **قرار لاحق:** توحيد المخزنين في هجرة يملكها صاحب `files.mjs`.
4. **لا نتائج للدورة المفتوحة، بأي حال.** قراءة النتيجة الجارية مرتين — مع معرفة من شارك بينهما — تكشف إجابة ذلك الشخص بالطرح. النتائج تُحسب بعد الإغلاق فقط. هذا يعني أن مدير الموارد البشرية لا يرى «كيف تسير الدورة»؛ يرى عدد المشاركين فقط.
5. **دورة أُغلقت دون الحد الأدنى لا تُعرض نتائجها أبدًا**، ولا حتى بعد خفض الحد لاحقًا: كل دورة تحمل لقطة الحد الذي وُعد به من شارك.
6. **أسماء من شارك في الاستبيان ومن لم يشارك محجوبة عن الجميع** في اللوحة (العدد فقط). جدول المشاركة موجود لمنع الإجابة مرتين لا لصنع قائمة ضغط. عكسه تمامًا في الإعلانات: هناك الاسم والوقت هما الغرض.
7. **لا تحليل مشاعر ولا نموذج لغوي ولا تصنيف على التعليقات**، ولا استيراد من `ai.mjs`. التعليق يعود كما كُتب لحامل `hr.survey.manage` فقط، ومعه تحذير في الشاشة بأن الأسلوب قد يكشف كاتبه.
8. **لا مقارنات معيارية بقطاعات** ولا حقل لها.
9. **فصل المهام يحتاج حاملَي تصريح `hr.survey.manage`.** من يعدّ الدورة لا يفتحها، ومن يكتب الإعلان لا ينشره. **قرار المالك:** منح التصريح لشخصين على الأقل، وإلا تعطّلت هذه الأفعال عمليًا. حاليًا يملكه دور `hr` افتراضيًا؛ في الاختبار مُنح للمدير عبر `grantAccess`.
10. **مالك إجراء القيم المؤسسية.** ربطتها بـ`hr.survey.manage` لأنه التصريح المحجوز لي؛ الأصح تنظيميًا أن يعرّف القيم مالك إجراء مسمّى في بطاقة الخدمة. لا قيم مكتوبة في الكود إطلاقًا: بلا قيمة معرّفة لا تُرسل بطاقة تقدير.
11. **لا تكامل مع `talent.mjs`.** التقدير لا يُحتسب في تقييم الأداء آليًا ولا يُمرَّر إليه. الربط — لو أراده المالك — يكون عرضًا للبطاقات دليلًا يختاره صاحبها، لا درجة تُحسب.
12. **لا حساب لنسبة مشاركة مستهدفة ولا مؤشر ارتباط مركّب.** أي رقم من هذا النوع يحتاج تعريفًا يقرره المالك بمصدره، لا معادلة تخترعها الوحدة.
13. **لا أصناف CSS جديدة.** الشاشات الثلاث تستخدم الأصناف القائمة فقط: `panel` `panel-body` `vn-head` `vn-board` `vn-tiles` `vn-tile` `vn-block` `vn-list` `vn-alert` `operation-actions` `badge` `subtle` `muted` `btn` `outline` `small` `is-ok` `is-due` `is-late` `is-old`. لا `style=""` ولا `<script>` ولا مورد خارجي.

## 7. نتيجة تشغيل الاختبارات

```
$ node --test tests/engagement.test.mjs
✔ pulse: an answer is stored with nothing that ties it to a person — not a name, not a time, not an insertion order (300.949208ms)
✔ pulse: a distribution is withheld whole when any band is smaller than the minimum, because showing the rest with the total discloses it by subtraction (280.545291ms)
✔ pulse: no result exists before the cycle closes, none ever exists below the minimum, and nothing is ever split by department or compared to an industry (287.335084ms)
✔ pulse: the minimum is a dated setting nobody can backdate, the author of the questions cannot open the cycle, and an opened cycle is closed rather than rewritten (295.814042ms)
✔ recognition: a card is tied to a value its owner defined, never to itself, and nothing in the module counts, scores or ranks a person (272.905708ms)
✔ announcements: the author does not broadcast their own notice, a published notice is withdrawn rather than reworded, and read receipts exist only where they were justified (260.856625ms)
✔ events: a simple calendar anyone in the audience can read, cancelled with a reason and never deleted (283.526209ms)
ℹ tests 7
ℹ suites 0
ℹ pass 7
ℹ fail 0
ℹ duration_ms 2103.799834
```

اختبارات الجوار بعد التغيير (لم يكسر شيء):

```
$ node --test tests/migrations.test.mjs tests/access.test.mjs tests/static-modules.test.mjs tests/ui-render.test.mjs
ℹ tests 10
ℹ pass 10
ℹ fail 0
```

كما فُحصت الشاشات الثلاث بمحاكاة حرفية لحلقة `tests/ui-render.test.mjs` (خارج المستودع، لأن وحدتي ليست مسجلة في `operationModules` بعد): **15 رسمة شاشة لخمسة أدوار، و46 نموذجًا فُتح، بلا `undefined` ولا `NaN` ولا `style=""` ولا `<script>`، وبأصناف CSS قائمة فقط.** يعيد المنسّق تشغيل `ui-render` بعد تسجيل المفاتيح الثلاثة لتغطيتها رسميًا.

`node --check` نظيف على الملفات الأربعة.
