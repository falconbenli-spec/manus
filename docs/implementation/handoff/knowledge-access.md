# تسليم `knowledge-access`

## 1. الملفات

أنشأتُ هذه الملفات، ولم أعدّل أي ملف قائم:

- `app/migrations/075-knowledge-access.sql`
- `app/knowledge.mjs`: دورة التحقق من المعرفة ومقياس الصدق.
- `app/policy-acknowledgements.mjs`: إقرار الاطلاع على نسخة سياسة بعينها.
- `app/access-reviews.mjs`: حملات مراجعة الصلاحيات وطلبات السحب.
- `app/static/knowledge-access-ui.mjs`: يصدّر `knowledgeUI` و`policyAcknowledgementsUI` و`accessReviewsUI`، ومعها الخريطة `knowledgeAccessModules` بمفاتيحها الثلاثة.
- `tests/knowledge.test.mjs` و`tests/policy-acknowledgements.test.mjs` و`tests/access-reviews.test.mjs`

الملفات التي قرأتُها ولم ألمسها: `app/ai.mjs` و`app/access.mjs` و`app/hr-contracts.mjs` و`app/inbox.mjs`. من `access.mjs` أستورد `can` و`holds` و`CAPABILITIES` و`defaultCapabilities` و`isSuperAdmin` و`revokeAccess`. لا يوجد استيراد دائري، و`knowledge.mjs` لا تستورد `ai.mjs`.

## 2. الهجرة 075

| الجدول | ما فيه | القيود في SQL |
|---|---|---|
| `knowledge_sources` | لكل مصدر: النوع (`policy` أو `service_card` أو `procedure`)، والمرجع، والمالك، ودورية المراجعة بالأيام، وآخر تحقق (التاريخ ومن قام به)، وتاريخ الانتهاء، وعلَم «طُلب تحديثه»، و`version`. | `CHECK(owner_id<>created_by)`، فمن يسجّل المصدر لا يكون مالكه. المصدر لا يُحذف أبدًا (محفز). المحفز `verified_by_record` يرفض تحريك `expires_on` أو `last_verified_*` ما لم يوجد تأكيد مسجّل مطابق من المالك. والمصدر المسحوب نهائي. |
| `knowledge_verifications` | الفعل البشري نفسه: تأكيد أو طلب تحديث، بالملاحظة والاسم والتاريخ، مع تاريخ الانتهاء قبله وبعده. | محفز يمنع أن يسجّل التحقق أحدٌ غير المالك المسمّى. السجل لا يُعدَّل ولا يُحذف. |
| `policy_ack_rounds` | جولة إقرار مربوطة بصف `hr_policies` المعتمد، وبرقم نسخته، وببصمة SHA-256 لنصه، وبالفئة المعنية والموعد والمالك وعدّاد التذكير. | `UNIQUE(tenant_id,policy_id)`: جولة واحدة لكل نسخة. تُفتح الجولة لسياسة معتمدة فقط (محفز). الجولة المغلقة نهائية، والنسخة والبصمة لا تتغيران. |
| `policy_ack_recipients` | من طُلب منه الإقرار، مثبتًا لحظة الطلب. | لا يُحذف أحد ولا يُعدَّل. |
| `policy_acknowledgements` | من أقرّ، ومتى، وعلى أي نسخة وأي بصمة. | محفز يشترط أن تطابق النسخة والبصمة جولةً مفتوحة. `UNIQUE(round_id,user_id)`. السجل لا يُعدَّل ولا يُحذف. |
| `access_review_campaigns` | الحملة: بداية نافذة الاستعمال، والموعد، ومن فتحها ومن أغلقها، وملاحظة الإغلاق. | حملة مفتوحة واحدة لكل كيان. الحملة المغلقة لا تُعدَّل. |
| `access_review_items` | لكل موظف ولكل تصريح: المراجِع، ومصدر التصريح (منح صريح أو من الدور أو مستوى الأدمن الأول)، وهل هو حساس، والقرار وسببه، ولقطة الاستعمال، ومن قرّر ومتى. | `CHECK(reviewer_id<>subject_id)`، فالمدير لا يراجع تصاريح نفسه. `decided_by=reviewer_id`. سبب مكتوب إلزامي عند سحب أي تصريح أو الإبقاء على تصريح حساس. القرار يُسجَّل مرة واحدة، ولا يتغير شيء بعد إغلاق الحملة. |
| `access_revocation_requests` | طلب سحب ينشأ عن قرار «أسحبه». | `executed_by` لا يكون طالب السحب ولا صاحب التصريح. الطلب يُحسم مرة واحدة ولا يُحذف. |

## 3. المسارات المطلوب ربطها في `app/server.mjs`

كل مسارات POST داخل كتلة `transaction(...)`. عمود Idempotency-Key يعني تغليف الاستدعاء بـ`once(()=>…,id=>({id}))`.

| الطريقة | المسار | الدالة | Idempotency-Key |
|---|---|---|---|
| GET | `/api/knowledge` | `knowledge.knowledgeBoard(db,u)` | — |
| POST | `/api/knowledge/sources` | `knowledge.registerSource(db,u,input)` | نعم |
| POST | `/api/knowledge/sources/:uuid/(verify_source\|request_update\|edit_source\|retire_source)` | `knowledge.sourceAction(db,u,id,action,input)` | لا (تحمي منه `version`) |
| GET | `/api/policy-acknowledgements` | `policyAck.acknowledgementsBoard(db,u)` | — |
| POST | `/api/policy-acknowledgements/rounds` | `policyAck.openRound(db,u,input)` | نعم |
| POST | `/api/policy-acknowledgements/rounds/:uuid/(remind_round\|sync_recipients\|close_round)` | `policyAck.roundAction(db,u,id,action,input)` | لا (`version`) |
| POST | `/api/policy-acknowledgements/rounds/:uuid/acknowledge` | `policyAck.acknowledgePolicy(db,u,id,input)` | لا (يرفض قاعدة البيانات الإقرار المكرر) |
| GET | `/api/access-reviews` | `accessReviews.accessReviewBoard(db,u)` | — |
| POST | `/api/access-reviews/campaigns` | `accessReviews.openCampaign(db,u,input)` | نعم |
| POST | `/api/access-reviews/campaigns/:uuid/close` | `accessReviews.closeCampaign(db,u,id,input)` | لا (`version`) |
| POST | `/api/access-reviews/items/:uuid/decide` | `accessReviews.decideItem(db,u,id,input)` | لا (`version`) |
| POST | `/api/access-reviews/revocations/:uuid/(execute_revocation\|decline_revocation)` | `accessReviews.revocationAction(db,u,id,action,input)` | لا (`version`) |

كل المعرّفات UUID، ونمطها `[a-f0-9-]{36}`.

**التحذير في إجابة المساعد (يتطلب سطرًا منك في `app/ai.mjs`، لأنه ملف لا أعدّله):**
صدّرتُ `knowledgeWarnings(db,u,sources)` من `app/knowledge.mjs`. تعيد الدالة مصفوفة أسطر جاهزة من نوع «تنبيه — …: هذا المصدر تجاوز تاريخ مراجعته ولم يؤكده مالكه (آخر تحقق …، المالك …)». المقترح في `runAssistant`، بعد تحديد `output` وقبل الإدراج:

```js
const warnings=status==='completed'?knowledgeWarnings(db,u,prepared.sources):[];
if(warnings.length)output=`${output}\n\n${warnings.join('\n')}`;
```

وصدّرتُ كذلك `annotateSources(db,u,sources)`، لمن يريد وسم كل مصدر في الواجهة بدل إلحاق نص. المصدر المنتهي لا يُحجب أبدًا. إلى أن يُربط هذا السطر، لن يظهر التحذير في إجابة المساعد نفسها، وإنما في شاشة «صدق قاعدة المعرفة» فقط. التحذير مختبَر على مستوى الدالة، لا على مستوى `runAssistant`.

## 4. مفاتيح `operationModules` والقائمة البيضاء

- الملف الثابت: `knowledge-access-ui`، ويُضاف إلى قائمة `assets` في `server.mjs`.
- في `operations.mjs`:

```js
import { knowledgeUI, policyAcknowledgementsUI, accessReviewsUI } from './knowledge-access-ui.mjs';
// knowledge:knowledgeUI,'policy-acknowledgements':policyAcknowledgementsUI,'access-reviews':accessReviewsUI
```

- مجموعات التنقل المقترحة:
  - `knowledge` و`policy-acknowledgements` تحت «الأساس» (مجموعة تصريح `knowledge.manage`). الشاشتان تعملان لكل موظف: كل موظف يرى ما يملكه وما ينتظر إقراره.
  - `access-reviews` تحت «إدارة المنصة». يراها المدير أيضًا لأن بنود مراجعته تصله فيها.

## 5. صندوق «بانتظار قراري»

كل لوحة تعيد `awaiting_me` جاهزة، بالنمط نفسه الذي تتبعه `service-cards`. **اربط `awaiting_me` وحدها، لا اللوحة كلها**: اللوحات تحمل أفعالًا متاحة دائمًا للمالك (مثل `verify_source`) قد تظهر في الصندوق خطأً لو رُبطت كاملة.

```js
['knowledge','قاعدة المعرفة',(db,u)=>({items:knowledge.knowledgeBoard(db,u).awaiting_me})],
['policy-acknowledgements','إقرار السياسات',(db,u)=>({items:policyAck.acknowledgementsBoard(db,u).awaiting_me})],
['access-reviews','مراجعة الصلاحيات',(db,u)=>({items:accessReviews.accessReviewBoard(db,u).awaiting_me})],
```

| الفعل | متى يظهر | التسمية الحالية في `inbox.mjs` |
|---|---|---|
| `verify_source` | مراجعة لمالك مصدر متأخرة، أو قريبة (خلال 14 يومًا)، أو لم يؤكد المصدر أصلًا. | «تحقق» (تُطابَق البادئة `verify`) |
| `acknowledge_policy` | موظف بانتظار إقراره. | «إقرارك مطلوب» (تُطابَق البادئة `acknowledge`) |
| `review_access` | مدير بانتظار قراره. سطر واحد لكل موظف، لا لكل تصريح. | «مراجعة» |
| `decide_revocation` | طلب سحب بانتظار حامل `access.manage`. | «قرار» |

## 6. ما لم أبنه، وما يحتاج قرار المالك

- **لا تذكير خارج المنصة.** التذكير عدّاد وتاريخ، ويظهر في الشاشة وفي الصندوق فقط. لا بريد ولا رسائل.
- **الاستعمال في مراجعة الصلاحيات مستنتج لا مقيس.** مصدره `audit_events`: أفعال صاحب التصريح على أنواع السجلات المرتبطة به، وفق الخريطة `USAGE_TRACES` في `access-reviews.mjs`. الاطلاع وحده لا يُسجَّل في سجل التدقيق، فتصريح يُستعمل للقراءة فقط سيظهر «لم يُستعمل». التصاريح التي لا أثر كتابة لها تُعرض «لا يُقاس» لا «غير مستعمل». الشاشة تذكر ذلك صراحة. **يحتاج قرارًا:** مالك إجراء يراجع الخريطة، وهل يلزم تسجيل الاطلاع مستقبلًا.
- **نطاق المراجعة:** كل منح صريح، وكل تصريح حساس يأتي من الدور، والصلاحية الكاملة للأدمن الأول. تصاريح الدور غير الحساسة لا تدخل، لأنها جزء من تعريف الدور. **يحتاج قرار المالك** إن أراد مراجعة الأدوار نفسها.
- **من لا مدير فوقه** (المدير، والموارد البشرية، والأدمن الأول في البيانات التجريبية) يراجعه «مراجع أعلى» يسمّيه فاتح الحملة، ويراجع المراجعَ الأعلى «مراجع ثانٍ». المراجع لا يكون أدمن أول، لأن الأدمن الأول هو من ينفذ السحب. الحملة ترفض أن تُفتح إن بقي أحد بلا مراجع.
- **سحب تصريح يأتي من الدور أو من مستوى الأدمن الأول** لا تنفذه هذه الشاشة: يغيّره المنفّذ من «الموظفون والصلاحيات» ثم يوثّق هنا. أما المنح الصريح فتنفيذه يستدعي `revokeAccess` القائمة (بحكم الإنسان المنفّذ، وتنتهي جلسات صاحب التصريح).
- **سحب صلاحية الأدمن الأول الوحيد** لا يمكن تنفيذه، لأن صاحبها لا يقرر في تصريحه. يبقى الطلب مفتوحًا حتى يُعيَّن أدمن أول آخر. هذا مقصود.
- **رقم نسخة السياسة** هو ترتيب اعتمادها بين سياسات نوعها. `hr_policies` لا تحمل رقم نسخة، والجولة تثبّت الرقم وبصمة النص لحظة فتحها.
- **لا تُفتح جولة إقرار آليًا عند اعتماد سياسة**، لأن ذلك يتطلب تعديل `hr-contracts.mjs`. بدلًا من ذلك تعرض الشاشة «نسخ معتمدة لم يُطلب الإقرار بها» بزر «طلب الإقرار». **يحتاج قرارًا:** هل يُربط الفتح بالاعتماد لاحقًا.
- **الإقرار ليس إلزامًا نظاميًا ولا توقيعًا.** النص في الشاشة يصرّح بذلك، والاختبار يتحقق من العبارة.
- **مصادر «الإجراء»** تُراجَع في دورة التحقق، لكن المساعد لا يقتبسها اليوم، فعدّاد استشهادها صفر دائمًا. الشاشة تذكر ذلك.
- **نوافذ العرض الثابتة في الكود:** تنبيه المالك قبل 14 يومًا، وعدّ الاستشهادات على 90 يومًا. هذه نوافذ عرض وليست قيمًا نظامية. دورية المراجعة الفعلية يدخلها من يسجّل المصدر، ولا قيمة افتراضية لها.
- **لا أصناف CSS جديدة.** استعملتُ الأصناف القائمة فقط.

## 7. نتيجة الاختبارات

```
$ node --test tests/knowledge.test.mjs tests/policy-acknowledgements.test.mjs tests/access-reviews.test.mjs
✔ access review: each manager reviews those under them, sensitive and unused permissions come first, and no one reviews their own
✔ access review: revoking creates a request a human with access.manage executes — the platform never revokes by itself
✔ access review: a closed campaign is dated evidence — who reviewed what, when, with which decision — and cannot be edited
✔ knowledge: registering is not verifying, the registrar never owns the source, and only the named owner confirms it by name and date
✔ knowledge: an expired source is flagged in the assistant answer, never hidden or deleted, and the honesty board ranks the most-cited stale source first
✔ knowledge: each role sees only what it may, and a tenant never reads or acts on another tenant's sources
✔ policy acknowledgement: tied to the exact version, a new version needs a new acknowledgement, and the old one stays with its version
✔ policy acknowledgement: the owner sees a clear list of who has not acknowledged, can remind them, and a closed round is final evidence
✔ policy acknowledgement: tenants are isolated, only accepted policies can be put to acknowledgement, and the screen never calls it a legal obligation
ℹ tests 9 · pass 9 · fail 0
```

الاختبارات القريبة، بالاسم: `migrations` و`access` و`ai` و`hr-contracts` و`service-cards` و`inbox` و`employee-assistant`. النتيجة 23 نجاحًا و0 فشل. لم أشغّل `npm test` كاملًا، التزامًا بالعقد.

فحص إضافي بسكربت مؤقت خارج المشروع: عرضتُ الشاشات الثلاث للأدوار manager وhr وemployee وadmin. لا يوجد `style=""` ولا `<script>`، وكل زر ظاهر يفتح نموذجًا صالحًا.
