# تسليم وكيل `privacy` — سجلات حماية البيانات الشخصية

## 1. الملفات

أنشأتُ هذه الملفات فقط، ولم أعدّل أي ملف قائم:

| الملف | المحتوى |
| --- | --- |
| `app/migrations/056-privacy.sql` | خمسة جداول وقيودها ومحفزاتها |
| `app/privacy.mjs` | وحدة الخلفية: اللوحات والأفعال والفحص الذاتي وخريطة بيانات الشخص |
| `app/static/privacy-ui.mjs` | واجهتان: `privacyUI` و`subjectRequestsUI` |
| `tests/privacy.test.mjs` | 11 اختبارًا بـ`node:test` |
| `docs/implementation/handoff/privacy.md` | هذا الملف |

## 2. الهجرة 056

| الجدول | الغرض | أبرز القيود |
| --- | --- | --- |
| `processing_activities` | سجل أنشطة المعالجة | `approved_by<>prepared_by` · أساس نظامي أو مدة احتفاظ **لا تُقبل بلا مصدر (10 أحرف فأكثر) وتاريخ تأكيد** · `..._approved_frozen` يرفض تعديل المعتمد إلا انتقاله إلى `superseded` · `..._no_delete` |
| `data_transfers` | نقل البيانات خارج المملكة | `approved_by<>assessed_by` · الاعتماد يتطلب ضمانة وتقييم مخاطر مسجلين · `..._assessment_frozen` يرفض إعادة كتابة تقييم مسجل · `UNIQUE(tenant_id,slug)` للنقل المشتق من المنصة |
| `subject_requests` | طلبات أصحاب البيانات | `answered_by` يتطلب `identity_verified_by` **ويخالفه** · `..._identity_frozen` يسجل التحقق مرة واحدة · المهلة `due_date` لا تُقبل بلا `due_source` · `..._answer_frozen` · `..._no_delete` |
| `retention_rules` | جدول الاحتفاظ | مدة بلا مصدر وتاريخ تأكيد مرفوضة · `..._no_delete` (تُوقف ولا تُحذف) |
| `privacy_incidents` | حوادث الخصوصية | مهلة الإبلاغ بلا مصدرها مرفوضة · `closed_by<>reported_by` · الإقفال يتطلب معالجة ودروسًا · `..._closed_frozen` · `..._no_delete` |

كل الجداول `STRICT`، وكلها تحمل `tenant_id` و`version` ومحفز `..._versioned` يرفض أي تحديث لا يزيد النسخة واحدًا.

**القاعدة الحاكمة مفروضة في SQL لا في الكود وحده:** لا مدة احتفاظ ولا أساس نظامي ولا مهلة إبلاغ ولا مهلة رد مكتوبة في أي ملف من ملفاتي. كلها حقول تبدأ فارغة، وترفض القاعدة قبولها بلا مصدر وتاريخ تأكيد، وتُعرض في الواجهة مقرونة بعبارة «يحتاج مراجعة قانونية».

## 3. المسارات التي يحتاجها المنسّق في `app/server.mjs`

قراءة (خارج المعاملة):

| الطريقة | المسار | الاستدعاء |
| --- | --- | --- |
| GET | `/api/privacy` | `privacy.privacyBoard(db,u)` |
| GET | `/api/subject-requests` | `privacy.subjectRequestsBoard(db,u)` |

كتابة (**كلها داخل معاملة**، على نمط `compliance` في الملف):

| الطريقة | المسار | الاستدعاء | `Idempotency-Key` |
| --- | --- | --- | --- |
| POST | `/api/privacy/activities` | `privacy.saveActivity(db,u,input)` → `{id}` | نعم (ينشئ حين لا `input.id`، ويعدّل المسودة حين وُجد مع `input.version`) |
| POST | `/api/privacy/activities/suggest` | `privacy.draftSuggestedActivities(db,u,input)` → `{created,skipped}` | نعم |
| POST | `/api/privacy/activities/:id/:action` | `privacy.activityAction(db,u,id,action,input)` | لا |
| POST | `/api/privacy/transfers` | `privacy.recordTransfer(db,u,input)` → `{id}` | نعم |
| POST | `/api/privacy/transfers/:id/:action` | `privacy.transferAction(db,u,id,action,input)` | لا |
| POST | `/api/privacy/retention` | `privacy.saveRetentionRule(db,u,input)` → `{id}` | نعم |
| POST | `/api/privacy/retention/:id/:action` | `privacy.retentionAction(db,u,id,action,input)` | لا |
| POST | `/api/privacy/incidents` | `privacy.recordIncident(db,u,input)` → `{id}` | نعم |
| POST | `/api/privacy/incidents/:id/:action` | `privacy.incidentAction(db,u,id,action,input)` | لا |
| POST | `/api/subject-requests` | `privacy.createSubjectRequest(db,u,input)` → `{id,reference}` | نعم |
| POST | `/api/subject-requests/:id/:action` | `privacy.requestAction(db,u,id,action,input)` | لا |

الأفعال المسموح بها في كل `:action` (المعرّف `[a-f0-9-]{36}`):

- الأنشطة: `approve_activity|supersede_activity`
- النقل: `assess_transfer|approve_transfer|stop_transfer`
- الاحتفاظ: `record_check|deactivate_rule|activate_rule`
- الحوادث: `update_incident|close_incident`
- الطلبات: `verify_identity|set_due_date|answer_request|refuse_request|close_request`

كل الدوال تفحص `can(db,u,'privacy.manage')` بنفسها وترمي `403 not_permitted`، ولم أعدّل `app/access.mjs`.

## 4. التسجيل في الواجهة

- `app/static/operations.mjs`: `import { privacyUI, subjectRequestsUI } from './privacy-ui.mjs';` ثم في `operationModules`: `privacy:privacyUI,'subject-requests':subjectRequestsUI`.
- القائمة البيضاء في `app/server.mjs` (سطر 73): إضافة `'privacy-ui'` — ملف واحد يحمل الواجهتين.
- التنقل في `app/static/app.mjs`، بعد سطر `compliance`:
  `if(has('privacy.manage'))nav.push(['privacy','⛨','حماية البيانات الشخصية','Personal data protection'],['subject-requests','✉','طلبات أصحاب البيانات','Data subject requests']);`
- مجموعة التنقل: `القيادة` في `groupedNavigation` بـ`app/static/hr-design.mjs` — إضافة `'privacy','subject-requests'` إلى مفاتيح المجموعة بجوار `compliance`.
- الواجهة تستورد `./dates.mjs` فقط (مُقدَّم أصلًا)، ولا تضيف أي صنف CSS جديد ولا `style=""` ولا مورد خارجي.

## 5. صندوق «بانتظار قراري»

كل لوحة تعيد `inbox` جاهزًا بالشكل المتبع (`{id,title,due_date,created_at,actions}`):

- `privacyBoard(db,u).inbox`: نشاط معالجة ينتظر اعتماد مالكه · نقل مُقيَّم ينتظر اعتماد غير مقيّمه · مراجعة احتفاظ حان موعدها لمالكها (تنبيه قبل 30 يومًا) · حادثة مفتوحة لمالكها.
- `subjectRequestsBoard(db,u).inbox`: طلب ينتظر التحقق من الهوية · طلب تحققت هويته وينتظر ردًا ممن لم يتحقق منه.

مجموعتان مقترحتان في `app/inbox.mjs`: `privacy` («حماية البيانات») و`subject-requests` («طلبات أصحاب البيانات»).

## 6. ما بنيتُه وما لم أبنه ولماذا

**ما اشتققتُه من المنصة فعلًا** (لا قوائم مكتوبة يدويًا):

- خريطة بيانات الشخص ومقياس الحذف يمسحان `sqlite_master` و`PRAGMA foreign_key_list` وقت التشغيل: كل عمود يشير إلى `users` بمفتاح أجنبي، وكل محفز `BEFORE DELETE`، وعدد الجداول التي تشير إلى كل جدول. تبقى صحيحة كلما أضاف وكيل آخر جداول، دون أن ألمس ملفه.
- اقتراح أنشطة المعالجة (`suggestedActivities` / `draftSuggestedActivities`، على نمط `draftMissingCards`): تسعة أنشطة مرشحة من الوحدات القائمة (الرواتب، الحضور والإجازات، السجل الوظيفي، التوظيف، الأداء، المشتريات، العملاء، المصروفات، الدخول والتدقيق). فئات البيانات تُشتق من **أسماء أعمدة موجودة فعلًا**، ووسم الحساسية يُقترح من أعمدة مالية أو اعتمادية أو تقييمية قائمة — ويُكتب في السجل أن التصنيف قرار المختص لا استنتاج المنصة. المسودة تُنشأ **بلا أساس نظامي وبلا مدة احتفاظ عمدًا**، ومالك غير معدّها هو من يكملها ويعتمدها.

**ما لم أبنه:**

- **لا حذف إطلاقًا.** لا توجد عبارة `DELETE FROM` واحدة في `app/privacy.mjs` (يحرسها اختبار). `deletionAssessment` يعرض لكل جدول: هل يمنعه محفز في القاعدة، وهل السجلات فيه أثر فعل الشخص في عمل غيره، وكم جدولًا يشير إليه — والصفوف التي لا مانع تقني لها تُوسم صراحة بأن القرار بشري يحتاج سندًا.
- **لا تنفيذ إتلاف عند بلوغ المدة.** `retention_rules` تنبّه مالكها ويوثّق هو ما فعله، ولا تلمس المنصة بيانات.
- **لا درجة امتثال ولا نسبة مئوية.** `privacyPosture(db,u)` يعيد أعدادًا فقط ومعها `no_score:true` و`score_note` يشرح لماذا: نسبة مئوية هنا تمنح طمأنينة كاذبة.
- **لا مسح بيانات مرشحين ولا موظفين من هذه الشاشة**، ولا تعديل على `app/ai.mjs` (قرأته فقط).
- خريطة بيانات الشخص **لا تعمل إلا لمن له حساب في المنصة**؛ طلب مرشح أو جهة اتصال عميل يُبحث فيه يدويًا من شاشته. ولا تُحسب الخريطة إلا بعد التحقق من الهوية، ولطلبات الاطلاع والنقل والحذف وحدها.

**ما يحتاج قرار المالك أو مالك إجراء:**

1. **نقل البيانات خارج المملكة عبر وحدة المساعدين (`app/ai.mjs`).** أدرجتُه صراحة كنقل تفعله المنصة نفسها (`slug: ai_model_provider`)، مربوطًا بحالة المزود **كما هي فعلًا**: هل فعّل الأدمن الأول المساعدين، وكم تشغيلًا خرج إلى مزود خارجي حقًا (`ai_runs.provider<>'retrieval'`) ومتى آخرها. يظهر «بانتظار قرار المالك» ما دام غير مسجل أو غير مُقيَّم. **بلد المزود وضمانته التعاقدية وتقييم مخاطره كلها فراغات ينتظر ملؤها من مختص.**
2. تسمية مالك لكل نشاط معالجة، ومختص يدخل الأساس النظامي ومدة الاحتفاظ بمصدرهما — لا شيء منها في الكود.
3. مهلة الرد على طلب صاحب البيانات، ومهلة الإبلاغ عن الحادثة: كلاهما حقل فارغ لا تعرفه المنصة.
4. قرار: هل تُمنح `privacy.manage` لشخصين على الأقل؟ فصل المهام مفروض بالهوية (المعدّ ليس المعتمد، والمتحقق من الهوية ليس من يرد)، فحامل واحد للتصريح يعطّل نصف المسارات.

## 7. نتيجة الاختبارات كما ظهرت

`node --test tests/privacy.test.mjs`

```
✔ privacy records: a duration or a legal basis is never stored without its source and the date its owner confirmed it
✔ processing activities: the platform proposes candidates from its own tables, and a human approves them; nothing is recorded automatically
✔ processing activities: the preparer never approves, and an approved record is replaced by a new one instead of being edited
✔ tenant isolation: activities of another tenant never appear in this tenant board or self-check
✔ cross-border transfer: the platform own call to a model hosted abroad shows as awaiting the owner decision until someone assesses it
✔ subject requests: identity verification cannot be skipped, and the verifier is not the one who answers
✔ subject data map: table names and record counts only, never the contents of anyone record
✔ erasure is never automatic: the assessment names what cannot be removed and why, and the module contains no delete statement
✔ retention schedule and incidents: the platform alerts and records, it never disposes and never knows a statutory deadline
✔ both screens render for the capability holder, every button opens a valid form, and nothing breaks the strict content policy
✔ self-check: the platform reports its gaps as counts and refuses to hand out a compliance score
ℹ tests 11  ℹ pass 11  ℹ fail 0
```

كل اختبار ينتهي بـ`verifyAudit(db)`، ويغطي مجتمعًا: منع الاعتماد الذاتي، ومنع تعديل المعتمد، وتعارض `version`، وعزل `tenant`، وصلاحية كل دور.

الاختبارات المجاورة بعد تغييري (لم أشغّل `npm test` كاملًا لوجود وكلاء آخرين يعملون):

```
node --test tests/migrations.test.mjs tests/static-modules.test.mjs tests/access.test.mjs tests/compliance.test.mjs   → 11/11 ✔
node --test tests/ui-render.test.mjs tests/platform.test.mjs tests/security-regressions.test.mjs                      → 20/20 ✔
```
