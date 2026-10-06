# تسليم `feedback`

اللقاءات الفردية · التغذية الراجعة المستمرة · تقييم 360.

## 1. الملفات

أنشأتها، ولم أعدّل أي ملف قائم إطلاقًا:

- `app/feedback.mjs` — وحدة الخلفية (لوحات القراءة وأفعال الكتابة).
- `app/static/feedback-ui.mjs` — ثلاث شاشات: `oneToOnesUI` · `feedbackUI` · `review360UI`.
- `app/migrations/064-feedback.sql` — هجرتي المحجوزة.
- `tests/feedback.test.mjs` — ستة اختبارات.

لم ألمس `app/talent.mjs` ولا `app/access.mjs` ولا `app/server.mjs` ولا `app/static/operations.mjs` ولا `app/home.mjs` ولا `app/inbox.mjs` ولا أي اختبار قائم ولا أي هجرة غير 064. لم أضف تصريحًا جديدًا: استخدمت `hr.feedback.manage` المحجوز لي كما هو. لم أضف صنف CSS جديدًا؛ استعملت الأصناف المسموحة فقط (`panel` `panel-body` `vn-head` `vn-board` `vn-tiles` `vn-tile` `vn-block` `vn-list` `vn-alert` `operation-actions` `badge` `subtle` `btn` `is-late` `is-due` `is-old`).

## 2. الهجرة 064 وجداولها

| الجدول | ما فيه | أهم قيد |
|---|---|---|
| `one_to_ones` | اللقاء: الطرفان، الموعد، الحالة، المحضر المشترك، **عمودان منفصلان للملاحظة الخاصة** لكل طرف | `CHECK(employee_id<>manager_id)` · `TRIGGER` يرفض أي تحديث بعد الانعقاد أو الإلغاء |
| `one_to_one_cadence` (VIEW) | ما تراه الموارد البشرية: المعرّف والطرفان والموعد والحالة و`held_at` | **لا أعمدة محتوى فيه أصلًا** |
| `one_to_one_agenda_items` | الأجندة المشتركة بكاتب كل بند | `TRIGGER` يرفض الإدراج من غير الطرفين أو بعد تسجيل الانعقاد؛ والبند لا يُعاد كتابته |
| `one_to_one_follow_ups` | بند متابعة: مالك وموعد وحالة وملاحظة إقفال | `TRIGGER` يرفض مالكًا من خارج الطرفين، ويرفض تعديل بند مقفل أو إعادة كتابة نصه |
| `feedback_requests` | الطلب الصريح: من يطلب، من يجيب، السؤال، الحالة | `CHECK(requester_id<>respondent_id)` · `TRIGGER` يقفل الطلب بعد الإجابة أو الاعتذار |
| `feedback_notes` | الملاحظة: كاتب، مستلم، نوع، **مرئية**، نص، تاريخ الواقعة، سحب بسبب | `CHECK(author_id<>subject_id)` · `TRIGGER` يمنع تغيير النص أو النوع أو المرئية بعد الكتابة؛ المسموح وحده هو السحب بسبب |
| `review_360_settings` | الحد الأدنى للمستجيبين في التقييم الصاعد، بأساسه وتاريخ تأكيده ومن أدخله | `CHECK(min BETWEEN 2 AND 20)` · صف حي واحد بفهرس فريد · `TRIGGER` يسمح بـ`superseded_at` فقط: القيمة تُستبدل بصف جديد مؤرخ ولا تُعدّل |
| `review_360_nominations` | ترشيح مقيِّم داخل دورة قائمة: مصدره، من رشّحه، من اعتمده | `CHECK(decided_by<>nominated_by AND decided_by<>rater_id AND decided_by<>subject_id)` — **اعتماد المقيِّمين لطرف ثالث مفروض في SQL** · `CHECK((source='self')=(rater_id=subject_id))` |
| `review_360_responses` | الاستجابة: نص القوة ونص التطوير فقط | **لا عمود مقيِّم ولا مرجع إلى ترشيحه**؛ ولا عمود درجة ولا ترتيب |
| `review_360_submissions` | واقعة أن ترشيحًا أُجيب عنه (لمنع الإجابة مرتين) | جدول منفصل حتى لا تُربط الاستجابة بكاتبها في قاعدة البيانات نفسها |

**الهجرة بلا صفوف ابتدائية.** لا حد افتراضي لعدد المستجيبين في الكود ولا في الهجرة: قبل أن يدخله مدير الموارد البشرية بأساسه وتاريخه، لا يُعرض تقييم صاعد إطلاقًا (الاستعلام نفسه يقارن بحد يستحيل بلوغه).

## 3. المسارات التي يحتاجها المنسّق في `app/server.mjs`

الاستيراد: `import * as feedback from './feedback.mjs';`

### قراءة (خارج المعاملة)

| الطريقة | المسار | الدالة |
|---|---|---|
| GET | `/api/one-to-ones` | `feedback.oneToOnesBoard(db,u)` |
| GET | `/api/feedback` | `feedback.feedbackBoard(db,u)` |
| GET | `/api/review-360` | `feedback.review360Board(db,u)` |
| GET | `/api/feedback/evidence/:reviewId` | `feedback.feedbackEvidence(db,u,reviewId)` — اختياري، انظر §6 |

```js
if(p==='/api/one-to-ones'&&req.method==='GET') {send(200,feedback.oneToOnesBoard(db,u));return;}
if(p==='/api/feedback'&&req.method==='GET') {send(200,feedback.feedbackBoard(db,u));return;}
if(p==='/api/review-360'&&req.method==='GET') {send(200,feedback.review360Board(db,u));return;}
const feedbackEvidence=p.match(/^\/api\/feedback\/evidence\/([a-f0-9-]{36})$/);
if(feedbackEvidence&&req.method==='GET') {send(200,feedback.feedbackEvidence(db,u,feedbackEvidence[1]));return;}
```

لا تحتاج هذه المسارات `access.require`: كل لوحة تقصر ما تعيده على ما يملكه صاحب الجلسة، و`hr.feedback.manage` يُفحص داخل الوحدة حيث يلزم. الحد الأدنى `portal.use`.

### كتابة (كلها **داخل** `transaction(db,()=>{ … })`)

| الطريقة | المسار | الدالة | Idempotency-Key |
|---|---|---|---|
| POST | `/api/one-to-ones` | `feedback.scheduleOneToOne(db,u,input)` | نعم |
| POST | `/api/one-to-ones/:id/:action` | `feedback.meetingAction(db,u,id,action,input)` — `add_agenda` `add_follow_up` `save_private_note` `record_held` `cancel_meeting` | لا (تحمي `version`) |
| POST | `/api/one-to-ones/items/:id/:action` | `feedback.followUpAction(db,u,id,action,input)` — `complete_item` `drop_item` | لا |
| POST | `/api/feedback/notes` | `feedback.writeFeedback(db,u,input)` | نعم |
| POST | `/api/feedback/notes/:id/withdraw_note` | `feedback.noteAction(db,u,id,'withdraw_note',input)` | لا |
| POST | `/api/feedback/requests` | `feedback.requestFeedback(db,u,input)` | نعم |
| POST | `/api/feedback/requests/:id/:action` | `feedback.requestAction(db,u,id,action,input)` — `answer_request` `decline_request` | لا |
| POST | `/api/review-360/threshold` | `feedback.setUpwardThreshold(db,u,input)` | لا |
| POST | `/api/review-360/nominations` | `feedback.nominate(db,u,input)` | نعم |
| POST | `/api/review-360/nominations/:id/:action` | `feedback.nominationAction(db,u,id,action,input)` — `approve_nomination` `reject_nomination` | لا |
| POST | `/api/review-360/nominations/:id/submit` | `feedback.submit360(db,u,id,input)` | لا (يمنعها `already_submitted`) |

اقتراح الصياغة:

```js
if(p==='/api/one-to-ones'&&req.method==='POST') return once(()=>feedback.scheduleOneToOne(db,u,input),id=>({id}));
const meetingStep=p.match(/^\/api\/one-to-ones\/([a-f0-9-]{36})\/(add_agenda|add_follow_up|save_private_note|record_held|cancel_meeting)$/);
if(meetingStep&&req.method==='POST') return feedback.meetingAction(db,u,meetingStep[1],meetingStep[2],input);
const followUpStep=p.match(/^\/api\/one-to-ones\/items\/([a-f0-9-]{36})\/(complete_item|drop_item)$/);
if(followUpStep&&req.method==='POST') return feedback.followUpAction(db,u,followUpStep[1],followUpStep[2],input);
if(p==='/api/feedback/notes'&&req.method==='POST') return once(()=>feedback.writeFeedback(db,u,input),id=>({id}));
const noteStep=p.match(/^\/api\/feedback\/notes\/([a-f0-9-]{36})\/withdraw_note$/);
if(noteStep&&req.method==='POST') return feedback.noteAction(db,u,noteStep[1],'withdraw_note',input);
if(p==='/api/feedback/requests'&&req.method==='POST') return once(()=>feedback.requestFeedback(db,u,input),id=>({id}));
const requestStep=p.match(/^\/api\/feedback\/requests\/([a-f0-9-]{36})\/(answer_request|decline_request)$/);
if(requestStep&&req.method==='POST') return feedback.requestAction(db,u,requestStep[1],requestStep[2],input);
if(p==='/api/review-360/threshold'&&req.method==='POST') return feedback.setUpwardThreshold(db,u,input);
if(p==='/api/review-360/nominations'&&req.method==='POST') return once(()=>feedback.nominate(db,u,input),id=>({id}));
const nominationStep=p.match(/^\/api\/review-360\/nominations\/([a-f0-9-]{36})\/(approve_nomination|reject_nomination)$/);
if(nominationStep&&req.method==='POST') return feedback.nominationAction(db,u,nominationStep[1],nominationStep[2],input);
const submit360=p.match(/^\/api\/review-360\/nominations\/([a-f0-9-]{36})\/submit$/);
if(submit360&&req.method==='POST') return feedback.submit360(db,u,submit360[1],input);
```

## 4. مفاتيح `operationModules` والملف الثابت

الملف الثابت الواحد الذي يُضاف للقائمة البيضاء: **`feedback-ui.mjs`**.

```js
import { oneToOnesUI, feedbackUI, review360UI } from './feedback-ui.mjs';
// داخل operationModules:
'one-to-ones':oneToOnesUI, feedback:feedbackUI, 'review-360':review360UI
```

| المفتاح | الشاشة | مجموعة التنقل المقترحة في `app.mjs` |
|---|---|---|
| `one-to-ones` | اللقاءات الفردية | «مساحتي» — بجوار `#work` و`#leave` (لكل موظف) |
| `feedback` | التغذية الراجعة | «مساحتي» — بجوار `one-to-ones` |
| `review-360` | تقييم 360 | «خدمات الموظف» — بجوار `performance` و`growth`، لأنه خيار داخل دورة التقييم لا دورة منفصلة |

## 5. «بانتظار قراري»

`app/inbox.mjs` يجمع تلقائيًا من اللوحات المسجَّلة في `SOURCES`. أضِف ثلاثة أسطر هناك (الملف ملك المنسّق):

```js
['one-to-ones','اللقاءات الفردية',(db,u)=>({items:feedback.oneToOnesBoard(db,u).my_open_items.map(i=>({...i,actions:['complete_item']}))})],
['feedback','التغذية الراجعة',(db,u)=>({records:feedback.feedbackBoard(db,u).requests_to_me.filter(r=>r.status==='open')})],
['review-360','تقييم 360',(db,u)=>({reviews:feedback.review360Board(db,u).cycles.flatMap(c=>[...c.my_tasks,...c.panels.flatMap(p=>p.nominations.filter(n=>n.actions.length))])})],
```

الأفعال التي ينبغي أن تظهر قرارات منتظرة: `approve_nomination` (اعتماد مقيِّم — قرار طرف ثالث) · `answer_request` (طلب تغذية راجعة وُجّه إليك) · `submit_360` (استجابة مطلوبة منك). تحتاج `DECISIONS` في `inbox.mjs` مفاتيح: `approve_nomination:'اعتماد مقيِّم'` · `answer_request:'إجابة مطلوبة'` · `submit_360:'تقييمك مطلوب'` · `complete_item:'بند متابعة عليك'`. **لا تضف `record_held` ولا `add_agenda`**: عمل جارٍ لا قرار منتظر، و`decline_request` و`reject_nomination` وجهان للقرار نفسه فيكفي أحدهما.

تنبيه خصوصية للمنسّق: لوحة `oneToOnesBoard` تعيد لصاحب الجلسة محتوى لقاءاته هو فقط، لكن `my_open_items` هو المناسب للصندوق. **لا تمرر `meetings` كاملة إلى الصندوق** حتى لا يظهر نص المحضر في قائمة عامة.

## 6. ما لم أبنه ولماذا · ما يحتاج قرار المالك

1. **بنود المتابعة في الصفحة الرئيسية — جاهزة ولم أركّبها.** `app/home.mjs` ملك وكيل `home-expiry` ويُعدَّل الآن، وتعديلي له يضيع عمله. الدالة جاهزة ومغطاة باختبار: `feedback.openFollowUps(db,u)` تعيد `[{id,item,due_date,scheduled_on,counterpart_name,overdue,link:'#one-to-ones'}]` لصاحبها وحده. الربط ثلاثة أسطر في `home.mjs`:

   ```js
   import { openFollowUps } from './feedback.mjs';
   const followUps=read('بنود اللقاءات الفردية',()=>openFollowUps(db,u))??[];
   home.follow_ups=followUps;
   // وفي home.cards:
   card('follow_ups','بنود متابعة عليّ',followUps.length,'#one-to-ones',followUps.some(i=>i.overdue)?'is-late':followUps.length?'is-due':'')
   ```
   وحتى يُركَّب، تظهر البنود المفتوحة في شاشة اللقاءات الفردية نفسها (بطاقة «بنودي المفتوحة»).

2. **عرض الأدلة داخل شاشة تقييم الأداء.** المطلوب أن تظهر الملاحظات المرئية للمقيِّم عند فتح التقييم في `app/talent.mjs`، وتعديل `talent.mjs` ممنوع عليّ. البديل المبني: `feedback.feedbackEvidence(db,u,reviewId)` جاهزة بمسارها، و`feedbackBoard` تعرض الأدلة لكل تقييم أنا مقيّمه في شاشة التغذية الراجعة. **قرار المنسّق:** إما ربط `GET /api/feedback/evidence/:reviewId` واستدعاؤه من `talent-ui.mjs` عند فتح تقييم، أو ترك الأدلة في شاشتها. في الحالتين لا يُنسخ شيء ولا يُحتسب.

3. **من يرى نتائج 360 ومتى — قاعدة اخترتها وتحتاج إقرار المالك.** صاحب اللوحة يرى نتائج دورته بعد انتقالها إلى المعايرة؛ ومديره المباشر وحامل `hr.feedback.manage` يريانها من فتح الدورة. السبب: لو رآها المدير المقيَّم أثناء الفتح لعرف من لم يجب بعد. إن أراد المالك غير ذلك فهو تغيير سطر واحد في `panelView`.

4. **حد المستجيبين لا يُطبَّق على تقييم الأقران.** المهمة نصّت على الصاعد، والمقيِّم يحتاج رأي الأقران دليلًا. أسماء الأقران لا تُخزَّن مع استجاباتهم أصلًا، لكن النص نفسه قد يدل على كاتبه في فريق صغير. **قرار المالك:** هل يُمدّ الحد نفسه إلى الأقران؟

5. **لم أبنِ إشعارات ولا تذكيرًا بموعد اللقاء.** المنصة لا ترسل خارجها، والتذكير يحتاج جدولة يملكها وكيل آخر.

6. **ما تسجله السجلات بصدق:** سجل التدقيق يثبت أن استجابة أُرسلت وفي أي ترشيح، ولا يحمل نصها. يعني هذا أن سرية التقييم الصاعد **مطلقة تجاه المقيَّم وتجاه الشاشات كلها** — لا وسيلة في المنصة تربط نصًا بكاتبه — لكن واقعة المشاركة مسجلة كغيرها. لم أدّعِ في الشاشة أكثر من ذلك.

7. **لا رقم نظاميًّا في الكود:** لا مدة دورية للقاء، ولا حد أدنى للمستجيبين، ولا سقف لعدد المقيِّمين. الحد الوحيد المكتوب في SQL هو «لا أقل من اثنين» وهو قيد منطقي لا نظامي: مستجيب واحد مكشوف بالتعريف.

## 7. نتيجة الاختبارات كما ظهرت

`node --test tests/feedback.test.mjs`

```
✔ one-to-one: the content belongs to the two parties, each private note to its writer alone, and HR sees that it happened and when — never what was said
✔ one-to-one follow-up items belong to their owner: only the owner closes one, and open items surface on the owner’s own list
✔ a feedback note is owned by its author and its recipient: visibility alone decides who else reads it, and HR is no exception
✔ feedback is requested with a specific question, and what the evaluator may see reaches the review cycle as evidence — never copied into it and never scored
✔ 360: the panel is approved by a third party — not the subject, not the nominator, not the rater
✔ 360: upward feedback is never revealed below the threshold the HR manager set, the threshold lives in the query, and no source is scored or ranked
ℹ tests 6  ℹ pass 6  ℹ fail 0
```

الاختبارات المجاورة بعد تغييري (لم أشغّل `npm test` كاملًا كما تقضي القواعد):

```
node --test tests/migrations.test.mjs tests/talent.test.mjs tests/access.test.mjs tests/inbox.test.mjs tests/static-modules.test.mjs
ℹ tests 14  ℹ pass 14  ℹ fail 0

node --test tests/ui-render.test.mjs tests/service-cards.test.mjs tests/platform.test.mjs
ℹ tests 17  ℹ pass 17  ℹ fail 0
```

وفحصت الشاشات الثلاث كما يفحصها `tests/ui-render.test.mjs` (رسم لكل دور وفتح نموذج كل زر): 18 رسمة و43 نموذجًا بلا `undefined` ولا `NaN` ولا `style=""` ولا `<script>`. سيغطيها ذلك الاختبار تلقائيًا بمجرد تسجيل المفاتيح الثلاثة في `operationModules`.
