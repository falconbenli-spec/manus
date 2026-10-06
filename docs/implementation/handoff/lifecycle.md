# تسليم `lifecycle` — حِزم التعيين والمغادرة وإخلاء الطرف

## 1. الملفات

أُنشئت (لم يُعدَّل أي ملف قائم):

- `app/migrations/072-lifecycle.sql`
- `app/lifecycle.mjs`
- `app/static/lifecycle-ui.mjs` (يصدّر `lifecycleUI` و`clearanceUI`)
- `tests/lifecycle-bundles.test.mjs`
- `docs/implementation/handoff/lifecycle.md`

**تعارض اسم:** `tests/lifecycle.test.mjs` ملف قائم يخص دورة حياة الخدمات (`scripts/lifecycle-audit.mjs`) وليس لي، فلم ألمسه. اختباري باسم `tests/lifecycle-bundles.test.mjs` بتوجيه المنسّق.

قُرئت ولم تُعدَّل: `people.mjs` `employees.mjs` `workflow.mjs` `routing.mjs` `delegations.mjs` `payroll-extras.mjs` `assets.mjs` `access.mjs`. الاستيراد الوحيد من وحدة الرواتب هو القراءة `outstandingAdvances`.

## 2. الهجرة 072

| الجدول | الغرض | القيود المفروضة في SQL |
|---|---|---|
| `lifecycle_step_templates` | قالب الخطوات، **يبدأ فارغًا** | FK مركّب يمنع اعتمادية تعبر الكيان أو النوع؛ `CHECK(depends_on<>id)`؛ TRIGGER للإصدار وثبات الرمز والنوع؛ لا حذف |
| `lifecycle_bundles` | الحزمة (تعيين/مغادرة) | صاحب الرحلة لا يفتحها ولا يملكها ولا يقفلها (3 CHECK)؛ حزمة مفتوحة واحدة لكل شخص ونوع (فهرس فريد جزئي)؛ المغلقة نهائية (TRIGGER)؛ `effective_date` و`date_basis` إلزاميان بلا قيمة افتراضية |
| `lifecycle_steps` | خطوات الحزمة | `employee_id` منسوخ + FK مركّب للحزمة؛ `CHECK(closed_by<>employee_id)` و`CHECK(owner_id<>employee_id)`؛ «مغلقة» تستلزم دليلًا ≥10 أحرف؛ الاعتمادية داخل الحزمة نفسها (FK مركّب)؛ المغلقة نهائية ومعيار القبول لا يتغير بعد الفتح |
| `lifecycle_escalations` | قرارات مالك الحزمة في التأخر | لا تعديل ولا حذف |
| `lifecycle_clearance_items` | بنود إخلاء الطرف | **`CHECK(cleared_by IS NULL OR cleared_by<>employee_id)`** — لا أحد يخلي طرف نفسه؛ الإغلاق يستلزم دليلًا؛ البند المالي يستلزم مبلغًا؛ فريد على `(bundle_id,source,source_id)`؛ المغلق نهائي والمصدر لا يتغير |

## 3. المسارات المطلوب ربطها في `app/server.mjs`

`import * as lifecycle from './lifecycle.mjs';`

| الطريقة | المسار | الدالة | معاملة | Idempotency-Key |
|---|---|---|---|---|
| GET | `/api/lifecycle` | `lifecycle.lifecycleBoard(db,u)` | لا | لا |
| GET | `/api/clearance` | `lifecycle.clearanceBoard(db,u)` | لا | لا |
| POST | `/api/lifecycle/templates` | `lifecycle.saveStepTemplate(db,u,body)` | نعم | **نعم** |
| POST | `/api/lifecycle/templates/:id` | `lifecycle.updateStepTemplate(db,u,id,body)` | نعم | لا (version) |
| POST | `/api/lifecycle/bundles` | `lifecycle.openBundle(db,u,body)` | نعم | **نعم** |
| POST | `/api/lifecycle/bundles/:id/:action` | `lifecycle.bundleAction(db,u,id,action,body)` — `close_bundle` `cancel_bundle` `refresh_clearance` | نعم | لا (version) |
| POST | `/api/lifecycle/steps/:id/:action` | `lifecycle.stepAction(db,u,id,action,body)` — `close_step` `cancel_step` `decide_late_step` | نعم | لا (version) |
| POST | `/api/clearance/items/:id` | `lifecycle.clearItem(db,u,id,body)` | نعم | لا (version) |

المعرّفات `randomUUID`؛ نمط مقترح للمطابقة: `[0-9a-f-]{36}` وللفعل `[a-z_]{3,30}`. الفعل المجهول يعيد 404 من الدالة نفسها. كل دوال الكتابة ترفض العمل خارج معاملة (`transaction_required`).

### ربط التسوية النهائية — أين توضع `clearanceBlockers` بالضبط

الدالة: `clearanceBlockers(db,u,employeeId)` → `{employee_id,bundle_id,blocked,blockers:[{source,source_id,title,reason,amount_minor}],note}`. قراءة صرفة لا تكتب شيئًا، فتُستدعى بأمان داخل معاملة غيرها.

لم أعدّل وحدة الرواتب. الموضع: **`app/payroll-extras.mjs` ← `decideSettlement`**، بعد سطر فحص فصل المهام مباشرة:

```js
if(s.prepared_by===u.id||s.user_id===u.id)fail(409,'separation_of_duties',…);
// ← هنا
if(decision==='approve'){const c=clearanceBlockers(db,u,s.user_id);if(c.blocked)fail(409,'clearance_open',`${c.note} (${c.blockers.map(b=>b.title).join('، ')})`);}
```

مع `import { clearanceBlockers } from './lifecycle.mjs';`. **تنبيه استيراد دائري:** `lifecycle.mjs` يستورد `outstandingAdvances` من `payroll-extras.mjs`. الدورة آمنة في ESM هنا لأن الطرفين يستدعيان بعضهما داخل دوال لا عند التحميل، وإن فضّل المنسّق تجنبها كليًا فالبديل أن يُوضع الفحص في معالج المسار في `server.mjs` قبل استدعاء `decideSettlement` (يقرأ `user_id` من `service_settlements`).

سلوك يجب أن يعرفه المنسّق:
- **لا حزمة مغادرة = ممنوع** (`reason:'no_bundle'`): لا إخلاء تحقّقت منه المنصة. هذا سيكسر `PAY-09` في `tests/payroll-extras.test.mjs` إن اعتمد تسوية بلا حزمة؛ عندها يفتح الاختبارُ حزمة أولًا أو يقرر المالك أن غياب الحزمة لا يمنع (انظر §6).
- الدالة تقارن الالتزامات المالية **الحيّة الآن** بما أُغلق بدليله، فعهدة صُرفت بعد فتح الحزمة تمنع (`reason:'not_recorded'`) ولو لم تُحدَّث القائمة.
- الرفض (`reject`) لا يُفحص.

## 4. مفاتيح `operationModules` والقائمة البيضاء

- `lifecycle: lifecycleUI` و`clearance: clearanceUI` من `./lifecycle-ui.mjs`.
- يُضاف `'lifecycle-ui'` إلى قائمة الوحدات الثابتة في `server.mjs` (السطر 73). الملف يستورد `./dates.mjs` المدرج أصلًا.
- مجموعة التنقل: **خدمات الموظف** (بجوار `people` و`employees`)؛ الشاشتان بتصريح `people.manage` في التنقل، مع أن القراءة متاحة أيضًا لمالك حزمة أو خطوة (يرى حزمه فقط) — فإن كان التنقل يُخفى بالتصريح فمالك الخطوة من إدارة أخرى يصل عبر «بانتظار قراري» أو رابط مباشر `#lifecycle`.
- لم أحتج أي صنف CSS جديد.

## 5. «بانتظار قراري»

يُضاف في `app/inbox.mjs` إلى `SOURCES`:

```js
['lifecycle','حزم التعيين والمغادرة',lifecycleBoard],
```

وإلى `KINDS`: `bundles:'حزمة موظف', steps:'خطوة رحلة', clearance:'بند إخلاء طرف'`.

الأفعال التي تظهر بقواعد `labelFor` القائمة دون تعديل:
- `decide_late_step` → «قرار»: خطوة تجاوزت مدتها، تُعرض **لمالك الحزمة** (ولحامل `people.manage`). هذا هو التصعيد.
- `verify_clearance` → «تحقق»: بند إخلاء مفتوح، يُعرض لمالك الحزمة ولحامل `people.manage`، ولا يُعرض للمغادر أبدًا.

أما `close_step` و`cancel_*` و`refresh_clearance` و`edit_template` فيستبعدها `NOT_DECISIONS` القائم (عمل جارٍ لا قرار). `close_bundle` يستبعده نمط `close` أيضًا. مصدر واحد يكفي لأن `lifecycleBoard` يحمل بنود الإخلاء داخل كل حزمة.

## 6. ما لم أبنه، وما يحتاج قرارًا

- **لا سحب ولا تعطيل آلي.** إغلاق بند «صلاحية نشطة» أو «حساب نشط» يسجّل دليل فعل بشري فقط؛ `access_grants.revoked_at` و`users.active` و`custodies.status` لا تُمس (مُثبت باختبار).
- **لا مدة إشعار ولا مهلة نظامية** في الكود ولا المخطط. `effective_date` و`date_basis` إدخال إلزامي، و`target_days` لكل خطوة يضعه مالكها بسنده.
- **قرار المالك:** هل غياب حزمة مغادرة يمنع التسوية؟ اخترت «نعم» لأنه الأحوط. إن كان الجواب «لا» فالتعديل سطر واحد في `clearanceBlockers`.
- **قرار المالك:** من يغلق بند الإخلاء؟ الآن: مالك الحزمة أو حامل `people.manage`، عدا المغادر. لم أربط كل بند بمالك إجراء مصدره (المالية للعهد، مسؤول الصلاحيات للمنح) لأن ذلك يحتاج تصاريح خارج `people.manage`. حقل `action_owner` نص إرشادي فقط.
- **مالك الخطوة يُحل آليًا** بحساب نشط **واحد** بالدور في الإدارة؛ إن وُجد صفر أو أكثر رُفض فتح الحزمة (`step_owner_unavailable`) بدل التخمين. في شركة فيها أكثر من HR في الإدارة سيلزم تعيين صريح — لم أبنِ شاشة تعيين مالك بالاسم في القالب. المالك البديل عند التصعيد يُدخل بمعرّف الحساب نصًا (لا قائمة منسدلة بعد).
- المدة المستهدفة تُحسب **بأيام عمل من يوم فتح الحزمة** (`addWorkingDays`)، لا من تاريخ المباشرة/المغادرة.
- اعتمادية ملغاة بسبب موثق لا تُجمّد ما بعدها؛ اعتمادية على خطوة قالب معطّلة تسقط عند فتح الحزمة.
- قيمة المعدة غير المرتبطة بأصل ثابت = 0 مع نص «قيمتها غير مسجلة»، ويظل البند مانعًا.
- لم أربط الحزمة بـ`people_candidates` (تهيئة التوظيف القائمة) ولا بتغيير الحالة `left` في `employees.mjs`؛ الربط الآلي بينهما قرار منسّق.
- لا إشعارات: جدول `notifications` يشترط `request_id`، والحزمة ليست طلبًا. الاعتماد على «بانتظار قراري».
- لم يُختبر المسار عبر HTTP ولا الشاشة في متصفح (الربط في ملفات المنسّق). اختبار العرض يتحقق من التهريب وغياب `style=`/`<script>` وبناء النماذج فقط.

## 7. نتيجة الاختبارات

`node --test tests/lifecycle-bundles.test.mjs`:

```
✔ lifecycle: the step template starts empty, no bundle opens without owner-defined steps, and each department owner defines only their own department’s steps
✔ lifecycle: a dependency chain that loops back on itself is rejected on save, in code and in SQL
✔ lifecycle: one request fans out into parallel steps; a dependent step stays visible with its reason; progress counts only steps closed with evidence; the person never closes their own journey
✔ lifecycle: a step past its target escalates to the bundle owner as a recorded decision
✔ clearance: the list is derived from what the platform actually knows about the person, nobody clears themselves — in code and by CHECK — and nothing is revoked or disabled automatically
✔ clearance: the final settlement stays blocked until the financial items are closed, and a stale list cannot be used to slip past it
✔ lifecycle: another tenant sees nothing and reaches nothing, and the screens render every value escaped under a strict CSP
ℹ tests 7 · pass 7 · fail 0
```

المجاورة بالاسم (`lifecycle` القائم، `people`، `employees`، `payroll-extras`، `expenses-assets`، `access`، `migrations`، `inbox`، `static-modules`): **41 من 41 ناجحة**. لم أشغّل `npm test` كاملًا وفق العقد.
