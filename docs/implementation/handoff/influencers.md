# تسليم وحدة المؤثرين — `influencers`

## 1. الملفات

أنشئت (ولم يُعدَّل أي ملف قائم):

- `app/migrations/060-influencers.sql`
- `app/influencers.mjs`
- `app/static/influencers-ui.mjs`
- `tests/influencers.test.mjs`
- `docs/implementation/handoff/influencers.md` (هذا الملف)

لم أعدّل `app/access.mjs` ولا `app/server.mjs` ولا `app/static/operations.mjs` ولا `app/inbox.mjs` ولا أي اختبار قائم ولا أي هجرة أخرى.

## 2. الهجرة 060 وجداولها

| الجدول | ماذا يحفظ | أهم القيود |
|---|---|---|
| `influencers` | الاسم المهني، الفئة، جهة التواصل (وكيل أو مباشر)، الملاحظات، الحالة، ربط اختياري بملف مورد، وحقول الرخصة `licence_number` و`licence_expires_on` و`licence_source` | `version`، فريد بالكيان والاسم المهني، رقم رخصة بلا مصدر ممنوع، رخصة بلا تاريخ انتهاء ممنوعة، مُشغّل يمنع الحذف ويُلزم ترقيم النسخة |
| `influencer_accounts` | المنصات وحساباتها | الحساب يُعطَّل ولا يُعاد كتابته ولا يُحذف |
| `influencer_metrics` | أرقام أدخلها موظف يدويًا من لقطة | `entry_method='manual_snapshot'` إلزاميًا، `source` و`captured_on` إلزاميان، لا تعديل ولا حذف، والتصحيح بلقطة جديدة `corrects_id` مرة واحدة |
| `influencer_engagements` | الارتباط بحملة وعميل: المخرجات (`posts_count`/`stories_count`/`videos_count`)، الأتعاب بالهللات، المدة، شروط الإلغاء، الإفصاح الإعلاني المطلوب، حقوق الاستخدام (النطاق والمدة)، حالة الرخصة وإقرار المعتمد | `approved_by<>owner_id`، لا حالة `active` بلا معتمد، إقرار مكتوب (20 حرفًا) إن كانت الرخصة ناقصة أو منتهية أو تنتهي قبل نهاية الارتباط، ومُشغّل يثبّت المخرجات والأتعاب وحقوق الاستخدام بعد الاعتماد ويجعل المقفل نهائيًا |
| `influencer_content` | المحتوى المقترح ومساره: اعتماد داخلي ثم موافقة عميل موثقة | `internal_approved_by<>proposed_by`، لا موافقة عميل بلا مرجع دليل ومن سجّلها وتاريخ ورودها، والمنشور أو الملغى نهائي |
| `influencer_proofs` | إثبات النشر: الرابط، تاريخ النشر، مرجع اللقطة، تأكيد الإفصاح ودليله، ومن تحقق ومتى وكيف | `disclosure_confirmed=1` إلزاميًا، `verified_by<>recorded_by`، التحقق يحدث مرة واحدة ولا يُعاد كتابته، ولا حذف |
| `influencer_payments` | ربط الارتباط بأمر دفع قائم في `payment_orders` | فريد بأمر الدفع، ومُشغّلات ترفض: الربط بعد خروج الأمر من `pending`، وأمر دفع لمورد غير مورد المؤثر، واستثناء الدفع بلا إثبات إذا كتبه صاحب الارتباط نفسه؛ ولا تعديل ولا حذف |

## 3. المسارات التي يحتاجها المنسّق في `app/server.mjs`

الاستيراد: `import * as influencers from './influencers.mjs';`

| الطريقة | المسار | الدالة | معاملة | `Idempotency-Key` |
|---|---|---|---|---|
| GET | `/api/influencers` | `influencers.influencersBoard(db,u)` | لا | لا |
| POST | `/api/influencers` | `influencers.createInfluencer(db,u,input)` | نعم | نعم (`once`) |
| POST | `/api/influencers/:id/:action` | `influencers.influencerAction(db,u,id,action,input)` | نعم | لا (يحميها `version`) |
| GET | `/api/influencer-campaigns` | `influencers.influencerCampaignsBoard(db,u)` | لا | لا |
| POST | `/api/influencer-engagements` | `influencers.createEngagement(db,u,input)` | نعم | نعم (`once`) |
| POST | `/api/influencer-engagements/:id/content` | `influencers.addContent(db,u,id,input)` | نعم | نعم (`once`) |
| POST | `/api/influencer-engagements/:id/:action` | `influencers.engagementAction(db,u,id,action,input)` | نعم | لا |
| POST | `/api/influencer-content/:id/:action` | `influencers.contentAction(db,u,id,action,input)` | نعم | لا |
| POST | `/api/influencer-proofs/:id/verify` | `influencers.verifyProof(db,u,id,input)` | نعم | لا |

`:id` في كل المسارات `[a-f0-9-]{36}`. قيم `:action` المسموحة:

- المؤثر: `edit_influencer|add_account|retire_account|record_snapshot|set_licence|link_vendor|set_status`
- الارتباط: `edit_engagement|request_review|approve_engagement|return_engagement|complete_engagement|cancel_engagement|link_payment`
- المحتوى: `edit_content|submit_content|approve_content|return_content|record_client_approval|record_proof|cancel_content`

مسار `‎/content` يسبق مسار `‎/:action` في الترتيب (الكلمة `content` ليست من أسماء أفعال الارتباط، لكن الترتيب يحسم الالتباس).

كل الدوال تتحقق من التصريح ومن عضوية فريق الحساب بنفسها وترمي 403/404؛ لا حاجة لحارس إضافي في الخادم.

## 4. مفاتيح الوحدة في `operationModules`

من `app/static/influencers-ui.mjs`:

```js
import { influencersUI, influencerCampaignsUI } from './influencers-ui.mjs';
// …
influencers:influencersUI,'influencer-campaigns':influencerCampaignsUI
```

- اسم الملف للقائمة البيضاء في `server.mjs`: `influencers-ui`.
- مجموعة التنقل: مع مجموعة التشغيل الإبداعي (`clients`/`campaigns`/`content`/`scope`) في `app/static/app.mjs`، لكن **مشروطة بالتصريح** لا بالدور: الشاشتان ترميان `not_permitted` لمن لا يملك `influencers.manage`. المقترح:
  `if(has('influencers.manage'))nav.push(['influencers','◐','المؤثرون','Influencers'],['influencer-campaigns','◑','ارتباطات المؤثرين','Influencer engagements']);`
- لم أضف أي صنف CSS جديد. الشاشتان تستخدمان الأصناف القائمة فقط: `panel` `panel-body` `panel-head` `vn-head` `vn-tiles` `vn-tile` `vn-block` `vn-list` `vn-alert` `operation-actions` `badge` `subtle` `muted` `is-late` `is-due` `is-ok` `is-old`. لا `style=""` ولا `<script>` ولا مورد خارجي.

## 5. ما ينبغي أن يظهر في «بانتظار قراري»

إن أُضيفت اللوحتان إلى `SOURCES` في `app/inbox.mjs` فالأفعال التالية وحدها تُقرأ قرارات (بحسب جدول `DECISIONS` والاستثناءات القائمة هناك):

| الفعل | يظهر لمن | المعنى |
|---|---|---|
| `approve_engagement` | غير صاحب الارتباط | اعتماد ارتباط مؤثر (ومعه إقرار الرخصة إن لزم) |
| `return_engagement` | غير صاحب الارتباط | إعادته للإعداد |
| `approve_content` | غير مقترح المحتوى | الاعتماد الداخلي للمحتوى |
| `return_content` | فريق الحساب | إعادة المحتوى للتعديل |
| `record_client_approval` | فريق الحساب | توثيق موافقة العميل بمرجع دليلها |
| `verify_proof` | غير من سجّل الإثبات | التحقق البشري من إثبات النشر |

بقية الأفعال (`add_*`, `record_snapshot`, `record_proof`, `submit_*`, `edit_*`, `set_*`, `link_*`, `complete_*`, `cancel_*`, `retire_*`, `request_review`) لا تُقرأ قرارات منتظرة، وهذا مقصود.

المقترح للسطر في `SOURCES`:
`['influencers','المؤثرون',influencersBoard],['influencer-campaigns','ارتباطات المؤثرين',influencerCampaignsBoard]`
(اللوحة الأولى لا تنتج قرارات اليوم؛ الثانية هي التي تنتجها. إضافتها اختيارية.)

## 6. ما لم أبنه ولماذا، وما يحتاج قرارًا

1. **لا اتصال بأي منصة تواصل.** لا متابعين ولا مشاهدات ولا معدل تفاعل يُقرأ أو يُحتسب. كل رقم صف في `influencer_metrics` أدخله موظف بمصدره وتاريخه، ويُعرض في الشاشة موسومًا بـ«مُدخل يدويًا من لقطة، غير متحقق منه». الوحدة **لا تحسب** أي نسبة أو متوسط من هذه الأرقام عمدًا.
2. **لا تحقق آلي من النشر.** المنصة لا تفتح رابطًا ولا تزور منصة. `influencer_proofs` يحفظ ما سجّله إنسان، ولا يصير «متحققًا منه» إلا بفعل إنسان آخر يذكر طريقته وما طابقه.
3. **الرخصة — يحتاج قرار المختص القانوني.** نص الشاشة كما طُلب حرفيًا: «الترويج الإعلاني المدفوع لجمهور داخل المملكة يتطلب رخصة من الجهة المنظّمة. هذا المتطلب مصدره ثانوي ولم يُتحقق منه رسميًا — يحتاج تأكيد المختص القانوني.» لم أذكر اسم جهة ولا نظامًا بعينه، ولم أضع أي مهلة أو رسم أو نسبة. **انتهاء الرخصة لا يمنع التعاقد**: يظهر تنبيهًا ويُلزم المعتمد بإقرار مكتوب يُحفظ في `licence_ack_note` مع حالة الرخصة لحظة الاعتماد. القرار المطلوب من المالك: هل يُحوَّل هذا لاحقًا إلى منع؟ ومن المختص الذي يؤكد المتطلب ونطاقه؟
4. **الدفع لا يوجد له مسار موازٍ.** لا تُنشئ الوحدة دفعة ولا تعتمدها ولا توثق تنفيذها. المؤثر يُسجَّل موردًا في `vendors` بحساب بنكي متحقق منه، وتُعَد الدفعة أمر دفع في `payables` بمساره الكامل (إعداد/اعتماد/توثيق تنفيذ بثلاثة أشخاص)، ثم يربط فعل `link_payment` أمر الدفع بالارتباط في `influencer_payments`. الربط **يسبق اعتماد المالية** (مُشغّل يرفض الربط بعد خروج الأمر من `pending`) حتى يرى المعتمد على أي إثبات يدفع، ولا يُقبل أمر دفع لمورد غير مورد المؤثر. الدفع قبل اكتمال إثبات النشر المتحقق منه يحتاج **قرارًا مكتوبًا بالاستثناء** لا يكتبه صاحب الارتباط، ويبقى ظاهرًا في الشاشة وفي عدّاد «دفعات باستثناء مكتوب».
5. **حدّ ما تفعله الوحدة في المسار المالي**: لم أعدّل `app/payables.mjs` (ملف غيري)، فلا تستطيع الوحدة أن تمنع المالية من اعتماد أمر دفع غير مربوط بارتباط. ما تضمنه اليوم: أن أي دفعة مؤثر تُربط هنا لا تُعتمد لاحقًا إلا وقد سُجِّل أساسها. **قرار مطلوب**: هل يُضاف في `payables` فحص يمنع اعتماد أمر دفع لمورد مصنف `influencers` بلا ربط في `influencer_payments`؟ الدالة جاهزة للاستدعاء: `paymentGate(db,engagementRow,influencerRow,contentViews,date)` تُصدَّر من `app/influencers.mjs`.
6. **لقطة إثبات النشر كملف مرفق**: `stored_files` جاهز لاستقبالها بنوع `influencer_proof`، ولم أسجّل النوع في `app/files.mjs` لأنه ملف مشترك. صدّرتُ `proofFileAccess(db,u,proofId)` بالشكل الذي يتوقعه `ENTITIES` هناك؛ سطر واحد يربطها. حتى ذلك الحين الدليل هو `screenshot_reference` النصي (إلزامي)، والشاشة تعرض عدد الملفات المرفقة فعلًا (صفر اليوم) دون ادعاء.
7. **لا أسعار ولا نسب**: أتعاب المؤثر تُدخل يدويًا بالهللات بعملة `SAR` فقط، ولا سعر افتراضي ولا هامش مفترض في أي مكان.
8. **العزل**: سجل المؤثرين على مستوى الكيان بتصريح `influencers.manage`، أما الارتباطات فمقيدة بعضوية فريق حساب العميل (`clientFor` من `app/agency.mjs`)، فمن ليس في الفريق لا يرى الارتباط ولو حمل التصريح.

## 7. نتيجة تشغيل الاختبارات

`node --test tests/influencers.test.mjs`:

```
✔ influencer roster: the platform reads nothing from any social platform — every number is a dated manual snapshot corrected by a newer one, and a licence is an alert with a written acknowledgement, never an automatic block
✔ influencer engagement: the person who prepares it never approves it, an expired or missing licence needs a written acknowledgement instead of a silent block, and an approved engagement keeps its deliverables, fee and usage rights
✔ influencer content and proof: internal approval by another person, a client approval recorded with its evidence, and a publication proof a human verifies — the platform never visits a platform and never verifies by itself
✔ influencer payment: it rides the existing payables path on the vendor file, is linked before finance approves it, and paying before a verified proof needs a written exception from someone other than the engagement owner
ℹ tests 4
ℹ pass 4
ℹ fail 0
```

الاختبارات المجاورة بعد التغيير — `node --test tests/migrations.test.mjs tests/campaigns.test.mjs tests/payables.test.mjs tests/static-modules.test.mjs tests/agency.test.mjs`: `tests 14 / pass 14 / fail 0`.

`node scripts/check.mjs`: `Syntax checked: 273 JavaScript modules. Source hashes match. Traceability: 220 requirements / 22 domains.`

الاختبارات تغطي: منع الاعتماد الذاتي (في الكود وبقيد `CHECK` عند تجاوزه) · منع تعديل المعتمد والمقفل والمنشور (مُشغّلات) · تعارض `version` · عزل فريق الحساب وعزل الكيان · اختلاف الصلاحيات (حساب بلا تصريح يُمنع) · `verifyAudit(db)` في نهاية كل اختبار.
