# تسليم `review-rounds` — المراجعة الإبداعية والتعليق على المادة

## 1. الملفات

أُنشئت (ولم يُعدَّل أي ملف قائم):

- `app/migrations/059-review-rounds.sql`
- `app/review-rounds.mjs`
- `app/static/review-rounds-ui.mjs`
- `tests/review-rounds.test.mjs`
- `docs/implementation/handoff/review-rounds.md` (هذا الملف)

لم أعدّل `app/studio.mjs` ولا `app/migrations/009-studio.sql` ولا `app/access.mjs` ولا أي ملف مشترك ولا أي اختبار قائم.

## 2. الهجرة 059 وجداولها

| الجدول | ما فيه |
|---|---|
| `review_route_templates` | قالب مسار محفوظ لإعادة الاستخدام (يُتقاعد ولا يُحذف) |
| `review_template_stages` | مراحل القالب: الترتيب، الاسم، الجمهور، المراجعون (JSON)، المُدد |
| `review_routes` | مسار مراجعة واحد لكل `studio_output_versions.id` (**`UNIQUE`**)، بمالك ملف وحالة ونسخة تفاؤلية |
| `review_stages` | مراحل المسار؛ المراحل المتساوية في `position` **متوازية** وتبدأ معًا |
| `review_stage_reviewers` | مراجعو كل مرحلة (قد يكونون أكثر من واحد) |
| `review_decisions` | قرار واحد لكل مرحلة: `approved` · `approved_with_changes` · `changes_required` |
| `review_media` | المادة نفسها داخل المنصة: صورة/PDF/فيديو/صوت/نص، بـ`digest` وبايتات مخزنة |
| `review_annotations` | تعليق مثبَّت على موضع، بإحداثيات **نسبية** أو طابع زمني أو مدى أحرف، وبحقل `visibility` صريح |
| `review_notices` | تذكير المرحلة وتصعيدها داخل المنصة (انظر §6) |

القواعد المفروضة في SQL لا في الكود وحده:

- `review_decisions_no_update` / `_no_delete`: **القرار لا يُعدَّل ولا يُحذف بعد صدوره.**
- `review_decision_authority`: القرار من مراجع مسمى في مرحلة **مفتوحة**، ومن غير معدّ النسخة (`studio_output_versions.created_by`) وغير فاتح المسار.
- `review_decision_client_evidence`: مرحلة `audience='client'` لا تُغلق إلا بسجل `external_approvals` موثّق (`documented`/`verified`) **على النسخة نفسها**؛ و`review_decision_internal_scope` يمنع مرجع عميل على مرحلة داخلية.
- `review_stage_reviewer_independent`: معدّ النسخة وفاتح المسار لا يُسمَّيان مراجعين.
- `review_annotations_content_fixed`: نص التعليق وموضعه و**جمهوره** لا تتغير؛ ما يُسجَّل لاحقًا هو الإغلاق مرة واحدة (`version+1`).
- `review_annotation_anchor_matches_media`: الموضع يناسب نوع المادة ويقع داخل حدودها (صفحة ≤ عدد الصفحات، ثانية ≤ المدة، حرف ≤ طول النص).
- `review_routes_versioned` / `review_stages_versioned`: الهوية ثابتة، والنسخة تفاؤلية، والمغلق لا يُعاد فتحه.
- `CHECK(owner_id<>created_by)` على `review_routes`، و`CHECK(status<>'wont_fix' OR length(trim(resolution_note))>=3)` على التعليقات.
- `x`/`y` من النوع `REAL` بـ`CHECK` بين 0 و1 — لا بكسل في المخطط أصلًا.

## 3. المسارات التي تحتاج ربطًا في `app/server.mjs`

كلها خلف `can(db,u,'review.manage')` داخل الوحدة نفسها؛ لا حاجة لفحص إضافي في الخادم.

| الطريقة | المسار | الدالة | معاملة؟ | `Idempotency-Key` |
|---|---|---|---|---|
| GET | `/api/review-rounds` | `reviewBoard(db,u)` | لا | لا |
| POST | `/api/review-rounds` | `createRoute(db,u,input)` → `{id}` | **نعم** | نعم |
| POST | `/api/review-rounds/:id/add_media` | `reviewAction(db,u,id,'add_media',input)` | **نعم** | نعم |
| POST | `/api/review-rounds/:id/annotate` | `reviewAction(db,u,id,'annotate',input)` | **نعم** | نعم |
| POST | `/api/review-rounds/:id/decide` | `reviewAction(db,u,id,'decide',input)` | **نعم** | لا |
| POST | `/api/review-rounds/:id/save_template` | `reviewAction(db,u,id,'save_template',input)` | **نعم** | نعم |
| POST | `/api/review-rounds/:id/cancel` | `reviewAction(db,u,id,'cancel',input)` | **نعم** | لا |
| POST | `/api/review-rounds/:id/notify` | `reviewAction(db,u,id,'notify',input)` | **نعم** | لا |
| POST | `/api/review-rounds/:id/client-pack` | `clientPack(db,u,id)` | لا (قراءة) | لا |
| POST | `/api/review-rounds/annotations/:id/address` | `annotationAction(db,u,id,'address',input)` | **نعم** | لا |
| POST | `/api/review-rounds/annotations/:id/wont_fix` | `annotationAction(db,u,id,'wont_fix',input)` | **نعم** | لا |
| GET | `/api/review-rounds/media/:id` | `previewMedia(db,u,id)` → `{filename,media_type,content}` | لا | لا |
| POST | `/api/review-rounds/notices/:id/read` | `markReviewNotice(db,u,id)` | **نعم** | لا |

ملاحظات ربط:

1. **رتّب `…/annotations/:id/:action` و`…/media/:id` و`…/notices/:id/read` قبل النمط العام `…/:id/:action`**، وإلا التقط النمط العام الكلمة `annotations` بوصفها معرّف مسار.
2. كل أفعال `reviewAction` تتحقق من `input.version` مقابل `review_routes.version` (تعارض تفاؤلي)، وأفعال التعليق تتحقق من `review_annotations.version`. الواجهة ترسلها تلقائيًا.
3. `/client-pack` قراءة صرفة لكنها POST لأن الواجهة تعرضها عبر `after` في نموذج. اجعلها GET إن فضّلت؛ الدالة لا تكتب شيئًا.

### مسار المعاينة — انتبه للترويسات

`previewMedia` يعيد النوع الحقيقي (`image/png` · `image/jpeg` · `application/pdf` · `video/mp4` · `audio/mpeg`). **لا تنسخ ترويسات `/api/files/:id` كما هي**: هناك `Content-Type: application/octet-stream` مع `Content-Disposition: attachment` و`nosniff`، وهذا يمنع العرض داخل `<img>` و`<iframe>` و`<video>`. المطلوب:

```
Content-Type: <f.media_type>
Content-Disposition: inline; filename*=UTF-8''<encodeURIComponent(f.filename)>
X-Content-Type-Options: nosniff
Content-Length: <f.content.length>
```

وCSP الصفحة الحالية فيها `object-src 'none'`، لذلك استعملتُ `<iframe>` لا `<object>` لملفات PDF (‏`frame-src` يرث `default-src 'self'` فيمر)، و`<img>` تمر بـ`img-src 'self'`، و`<video>`/`<audio>` تمر بوراثة `media-src` من `default-src 'self'`. **لم أستطع التحقق من هذا في متصفح** (ممنوع تشغيل خادم)، وأخصّ بالذكر أن عارض PDF المدمج قد يُحجب إن وُضعت `Content-Security-Policy: sandbox` على الاستجابة؛ إن حدث ذلك فالبديل الأمين رابط تنزيل بدل الإطار، والباقي (صورة، فيديو، صوت، نص) لا يتأثر.

## 4. مفاتيح `operationModules` والقائمة البيضاء

في `app/static/operations.mjs`:

```js
import { reviewRoundsUI, annotationsUI } from './review-rounds-ui.mjs';
// …
'review-rounds':reviewRoundsUI, annotations:annotationsUI
```

في `app/server.mjs` سطر القائمة البيضاء للوحدات الثابتة أضف الاسم: **`review-rounds-ui`** (ملف واحد يصدّر المفتاحين).

مجموعة التنقل: **«التشغيل»** إلى جانب `studio` و`approvals`. أقترح ترتيبها بعد `studio` مباشرة، لأنها تبني عليه.

## 5. «بانتظار قراري»

في `app/inbox.mjs` أضف إلى `SOURCES`:

```js
['review-rounds','جولات المراجعة',reviewBoard],
```

الفعل الوحيد الذي يجب أن يظهر في الصندوق هو **`decide`** (مُعرَّف أصلًا في خريطة `DECISIONS` داخل `inbox.mjs` باسم «قرار»). بقية الأفعال (`add_media` · `annotate` · `notify` · `save_template` · `cancel` · `address` · `wont_fix`) تسقط تلقائيًا بقواعد `NOT_DECISIONS` و`labelFor`، وتحققتُ من ذلك بقراءة الملف. لا يحتاج `inbox.mjs` أي تعديل آخر.

## 6. ما لم أبنه، ولماذا، وما يحتاج قرارًا

1. **لا رابط مراجعة خارجي للعميل ولا حساب له** — كما نصّ التكليف. مرحلة `audience='client'` لا تُغلق إلا بسجل `external_approvals` موثّق على النسخة نفسها، ويُفرض ذلك بـ`TRIGGER` لا بالواجهة. وقرار المرحلة يجب أن يطابق ما وثّقه السجل بخريطة صريحة: `approved→approved` · `approved_with_conditions→approved_with_changes` · `changes_requested|rejected→changes_required`. أي قرار لا يطابقها يُرفض بـ`client_decision_mismatch`. القرار بفتح بوابة للعميل ما زال معلقًا عند المالك ولم يُبتّ.

2. **الإشعارات في `review_notices` لا في `notifications`** — وهذا انحراف عن التكليف أذكره صراحة: جدول `notifications` في `app/schema.sql` فيه `request_id TEXT NOT NULL REFERENCES requests(id)`، ومسار المراجعة ليس طلب خدمة، فلا يمكن كتابة صف فيه دون طلب وهمي أو تعديل المخطط المشترك — وكلاهما ممنوع عليّ. صنعتُ `review_notices` بالشكل نفسه (مستخدم · نوع · `read_at` · `created_at`) ليسهل دمجه لاحقًا. **قرار مطلوب من المنسّق:** هل يوحَّد الجدولان بترحيل يملكه هو (جعل `request_id` قابلًا لـ`NULL` وإضافة مرجع كيان عام)؟ **لا بريد ولا `outbox`**؛ الاختبار يثبت أن عدد صفوف `outbox` صفر.

3. **لا مجدول** — التذكير والتصعيد يُستخرجان عند الطلب بفعل `notify` (أو عند ربط مهمة دورية لاحقًا). الاستدعاء المكرر لا يضاعف شيئًا (`UNIQUE(stage_id,user_id,kind)`), والاختبار يثبت ذلك.

4. **المُدد بلا قيم افتراضية** — `due_days` و`reminder_days` و`escalation_days` كلها `NULL` ما لم يدخلها صاحب المسار، والمرحلة بلا مدة تحمل `due_note` صريحًا: «بلا موعد: لم تُدخل مدة لهذه المرحلة، فلا تذكير ولا تصعيد». الموعد يُحسب بأيام العمل عبر `addWorkingDays` و`holidaySet` من `app/work-calendar.mjs`.

5. **عدد صفحات PDF ومدة الفيديو/الصوت يدخلهما الرافع** — المنصة لا تستخرجهما من الملف (لا تبعيات خارجية)، ولا تفترض قيمة. صفحات PDF مطلوبة لأن رقم الصفحة في التعليق يُتحقق منها؛ المدة اختيارية وإن تُركت فارغة لا يُتحقق من حد الطابع الزمني.

6. **المقارنة على البيانات الوصفية فقط** — نسخة سابقة وحالية وقائمة فروق (العنوان، القناة، الصيغة، المقاس، اللغة، مرجع الهوية، معيار القبول، عدد الأصول، طول النص، عدد المواد). **لا مقارنة بكسلات ولا كشف فروق بصرية**، والشاشة تصرّح بذلك.

7. **طبقة التعليقات فوق المادة لم تُبنَ** — تثبيت عنصر في موضع نسبي يحتاج `style="inset:…"` أو قاعدة CSS مولّدة، وكلاهما يكسر الـCSP أو الملف المشترك. فالتعليقات تُعرض **قائمة مرقّمة بجانب المادة** مع موضعها مكتوبًا (`٪ أفقيًا · ٪ رأسيًا` أو `الدقيقة mm:ss` أو `الأحرف من–إلى`)، والإحداثيات النسبية محفوظة كاملة في قاعدة البيانات فتصبح الطبقة المرئية إضافةً لاحقة بلا أي تغيير في البيانات.

8. **أصناف CSS أحتاجها منك إن أردت الطبقة المرئية لاحقًا** (لم أضف أيًّا منها، والشاشة تعمل بدونها):
   - `review-canvas` — حاوية `position:relative` للمادة.
   - `review-pin` — علامة مرقّمة `position:absolute` تُوضع بـ`left`/`top` من متغيرَي CSS مخصصين.
   - `review-media` — `max-width:100%` و`height:auto` للصورة والفيديو، و`min-height` معقول للإطار.
   وكذلك يفيد صنف صغير `review-text` بـ`white-space:pre-wrap` لعرض المادة النصية دون فقد الأسطر.

9. **التعليقات المفتوحة = قائمة عمل النسخة التالية** — تُعاد في `worklist` لكل مسار وتُعرض في شاشة «التعليقات». لم أنسخ التعليقات تلقائيًا إلى مسار النسخة الجديدة: الترحيل التلقائي يخفي قرارًا بشريًا («هل ما زالت هذه الملاحظة قائمة؟»). إن أردت الترحيل التلقائي فهو قرار مالك.

10. **`review.manage` وحده لا يفتح شيئًا** — كل استعلام محدود بـ`tenant_id` وبعضوية المشروع (`project_members`)؛ حامل التصريح خارج المشروع لا يرى المسار ولا المادة، والاختبار يثبت ذلك.

## 7. نتيجة تشغيل الاختبارات

`node --test tests/review-rounds.test.mjs`:

```
✔ a review route runs its stages in order: parallel stages at the same position open together, the next position opens only when all of them are decided, and three decisions exist — not two
✔ a decision belongs to one version: the author never decides, a decision is never edited, and reversing it needs a new version with its own route
✔ changes_required stops the route at once and cancels what is left; nothing downstream is silently treated as decided
✔ an internal annotation never reaches the client: the separation is enforced in the query, not in the screen
✔ annotations are pinned to a place in the material with relative coordinates, never pixels, and only inside the material they belong to
✔ every annotation closes with a stated outcome, “will not fix” needs its reason, and what stays open becomes the worklist for the next version
✔ a client stage closes only on an external approval documented against the same version; the platform opens no external review link and sends no mail
✔ reminders and escalation stay inside the platform, are repeatable without piling up, and a route saved as a template rebuilds the same stages
✔ tenant isolation, the capability and optimistic locking all hold, and neither screen emits inline style or script
ℹ tests 9  ℹ pass 9  ℹ fail 0
```

الاختبارات القريبة، شُغّلت بالاسم بعد التغيير ولم يفشل منها شيء:

```
node --test tests/studio.test.mjs tests/client-approvals.test.mjs tests/static-modules.test.mjs \
  tests/migrations.test.mjs tests/access.test.mjs tests/ui-render.test.mjs tests/inbox.test.mjs tests/workflow-review.test.mjs
ℹ tests 32  ℹ pass 32  ℹ fail 0

node --test tests/security-regressions.test.mjs tests/platform.test.mjs tests/files-security.test.mjs \
  tests/service-cards.test.mjs tests/operations-http.test.mjs
ℹ tests 32  ℹ pass 32  ℹ fail 0
```

لم أشغّل `npm test` كاملًا كما نصّ عقد العمل (وكلاء آخرون يعملون الآن). كل اختبار يُنهي بـ`verifyAudit(db)`، وكل بيانات الاختبار مصطنعة بحسابات تجريبية لا أسماء حقيقية.
