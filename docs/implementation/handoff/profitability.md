# تسليم وحدة `profitability` — تكلفة الساعة وربحية المشروع والعميل

## 1. الملفات

أُنشئت (ولم يُعدَّل أي ملف قائم، ولا أي ملف مشترك):

- `app/migrations/053-cost-rates-profitability.sql`
- `app/profitability.mjs`
- `app/static/profitability-ui.mjs`
- `tests/profitability.test.mjs`

## 2. الهجرة 053 وما فيها

| الجدول | ماذا يحفظ | الحماية في SQL |
|---|---|---|
| `job_categories` | الفئات الوظيفية (مصمم أول، منتج، مدير حساب…) بترميز فريد لكل كيان | `version` تفاؤلي بـ`TRIGGER`، ومنع الحذف (توقَف ولا تُحذف) |
| `category_cost_rates` | معدل تكلفة الساعة لكل فئة بنسخ مؤرّخة (`effective_from`)، بالهللات وبـ`SAR` | `CHECK(decided_by<>prepared_by)` · `TRIGGER` يرفض أي تعديل بعد الاعتماد · فهرس فريد يمنع معدلين حيَّين لنفس الفئة والتاريخ |
| `employee_job_categories` | انتماء الشخص لفئة، مؤرّخ هو الآخر. **لا مبلغ في هذا الجدول** | `TRIGGER` يرفض التعديل والحذف: التصحيح بإسناد جديد مؤرّخ |
| `overhead_rates` | معدل التحميل العام: مبلغ لكل ساعة أو نسبة من التكلفة المباشرة، بنسخ مؤرّخة ومصدر مكتوب | نفس فصل المهام ونفس منع التعديل بعد الاعتماد |
| `project_service_tags` | وسم المشروع بعائلة خدمة (من `FAMILIES` في `app/agency.mjs`) لتقرير ربحية الخدمة | `version` تفاؤلي، منع الحذف |

**القاعدة الحاكمة مفروضة في المخطط لا في الكود وحده:** لا عمود `user_id` في `category_cost_rates` إطلاقًا. اختبار قائم يفحص أعمدة الجدول ويفشل إن أضافه أحد لاحقًا.

## 3. المسارات التي يحتاجها المنسّق في `app/server.mjs`

استيراد: `import * as profitability from './profitability.mjs';`

### قراءة (خارج المعاملة، بلا `Idempotency-Key`)

| الطريقة | المسار | الدالة |
|---|---|---|
| GET | `/api/cost-rates` | `profitability.costRatesBoard(db,u)` |
| GET | `/api/profitability` | `profitability.profitabilityBoard(db,u,query)` — `query` يقبل `project_id` و`client_id` و`from` و`to` فقط |

### كتابة (كلها **داخل معاملة**)

| الطريقة | المسار | الدالة | `Idempotency-Key` |
|---|---|---|---|
| POST | `/api/cost-rates/categories` | `createCategory(db,u,input)` | نعم |
| POST | `/api/cost-rates/categories/:id/:action` | `categoryAction(db,u,id,action,input)` — `action` ∈ `activate_category`,`deactivate_category` | لا (محمي بـ`version`) |
| POST | `/api/cost-rates/rates` | `prepareCostRate(db,u,input)` | نعم |
| POST | `/api/cost-rates/rates/:id/:action` | `costRateAction(db,u,id,action,input)` — `action` ∈ `approve_rate`,`reject_rate` | لا (محمي بـ`version`) |
| POST | `/api/cost-rates/assignments` | `assignCategory(db,u,input)` | نعم |
| POST | `/api/cost-rates/overhead` | `prepareOverheadRate(db,u,input)` | نعم |
| POST | `/api/cost-rates/overhead/:id/:action` | `overheadRateAction(db,u,id,action,input)` — `action` ∈ `approve_overhead`,`reject_overhead` | لا (محمي بـ`version`) |
| POST | `/api/profitability/tags` | `tagProjectService(db,u,input)` | نعم |

معرّفات السجلات `UUID` (نمط `[a-f0-9-]{36}`) عدا `categories/:id` وهو `UUID` أيضًا.

### دوال تُستدعى برمجيًا (ليست مسارات)

`projectProfitability(db,u,{project_id,from,to,forecast})` · `clientProfitability(db,u,{client_id,from,to,forecast})` · `serviceProfitability(db,u,{from,to})` · `clientProjects(db,tenantId,clientId)`.

## 4. مفتاح الوحدة في `operationModules` والملف الثابت

الملف الثابت الواحد: `profitability-ui.mjs` — يُضاف إلى القائمة البيضاء في `app/server.mjs` (سطر `assets.set`).

يصدّر ثابتين، ولكلٍّ مفتاح مستقل:

```js
import { costRatesUI, profitabilityUI } from './profitability-ui.mjs';
// operationModules: {..., 'cost-rates':costRatesUI, profitability:profitabilityUI}
```

مجموعة التنقّل: **المالية** لكليهما. `cost-rates` شاشة إعداد (لحاملي `costing.manage`) و`profitability` شاشة تقرير (لحاملي `profitability.view`)، والتصريحان منفصلان عمدًا: من يضبط المعدلات لا يرى الهوامش بالضرورة، والعكس. مُختبَر.

## 5. صندوق «بانتظار قراري»

`costRatesBoard(...).awaiting_me` يعيد مصفوفة جاهزة بالشكل المتبع (`{id,title,created_at,actions}`):

- معدل ساعة مسودة أعدّه **شخص آخر** → الفعل `approve_rate`
- معدل تحميل عام مسودة أعدّه شخص آخر → الفعل `approve_overhead`

لا يظهر للمُعِدّ نفسه أبدًا. شاشة الربحية لا تولّد عناصر قرار.

## 6. ما لم أبنه، ولماذا، وما يحتاج قرار مالك

1. **لا رقم نظامي ولا معدل افتراضي في الكود.** لا معدل ساعة ولا نسبة تحميل: كلها حقول فارغة يدخلها صاحب الإجراء بمصدره وتاريخه. بلا نسخة معتمدة تبقى الساعة «غير مُكلَّفة» وتُعلن كذلك، ولا تُحسب صفرًا.
2. **قرار المالك المطلوب — اعتماد الفئات ومعدلاتها.** الشاشة فارغة حتى يعرّف صاحب الإجراء الفئات، ويسند الناس إليها، ويدخل معدل كل فئة بمصدره، ويعتمده شخص ثانٍ. قبل ذلك كل تقرير ربحية يظهر بتحفظ صريح.
3. **لم أستورد `app/resourcing.mjs` ولم أعتمد عليها** (يبنيها وكيل آخر الآن). «المحجوز مستقبلًا» و«المتبقي المجدول» و«الميزانية» و«الإيراد المتوقع» كلها **معاملات اختيارية** تُمرَّر في كائن `forecast`:
   `{budget_minor, committed_future_minor, remaining_cost_minor | remaining_minutes, expected_revenue_minor}`.
   **هذه نقطة الوصل التي يصلها المنسّق:** حين تجهز وحدة تخطيط الموارد، يقرأ منها المنسّق الحجوزات المستقبلية والساعات المجدولة المتبقية ويمرّرها هنا. إلى أن يفعل، تقول الشاشة حرفيًا إن الرقم لم يصلها وإن الهامش عند الاكتمال «يفترض ألّا عمل متبقيًا، وهو افتراض متفائل».
4. **اعتماد كشوف الوقت يبنيه وكيل آخر** (`timesheets.approve`). أحسب من `time_entries.status='approved'` القائم في `app/agency.mjs`. حين تصل وحدة الاعتماد الجديدة، إن غيّرت دلالة الحالة فالمكان الوحيد الذي يقرؤها هو `timeCost()` في `app/profitability.mjs`.
5. **أساس الإيراد:** الفواتير الصادرة **بالصافي دون ضريبة القيمة المضافة** (الضريبة أمانة لا إيراد)، ناقص الإشعارات الدائنة الصادرة، منسوبة بـ`supply_date`. **قرار محاسبي يستحق تأكيد المالك** إن أراد أساسًا آخر (تاريخ الإصدار مثلًا).
6. **«الميزانية» في حرق الميزانية** — عند عدم تمريرها — مجموع `project_budgets` النشطة، وهي **مخصصات مشتريات** لا ميزانية تكلفة كاملة. الشاشة تقول ذلك حرفيًا. **يحتاج قرار المالك:** هل يُعتمد مخصص تكلفة كامل للمشروع؟
7. **ربحية الخدمة تعتمد وسمًا يدويًا.** لا يوجد في المنصة رابط بين المشروع وباقة الكتالوج، فلم أخترع واحدًا: يوسم صاحب الإجراء المشروع بعائلة خدمة، والمشروع غير الموسوم يظهر مستقلًا ولا يُوزَّع بالتخمين.
8. **الرقم المجمّع من الرواتب** موجود كمرجع فقط، لا يُعرض إلا لحامل `hr.compensation.review`، ولا يُخزَّن في جدول المعدلات ولا يملأ أي حقل، ويُحجب عن أي فئة أفرادها أقل من 5 حتى لا يكون «المتوسط» راتب شخص واحد.
9. **لم أبنِ تكلفة المستقلين والموردين كبند وقت.** تدخل ضمن المشتريات والمصروفات المنسوبة للمشروع فقط.
10. **صنف CSS جديد:** لا شيء. استخدمت الأصناف القائمة وحدها، ولا `style=""` ولا `<script>` ولا مورد خارجي (مُتحقَّق منه).

## 7. نتيجة تشغيل الاختبارات

`node --test tests/profitability.test.mjs`:

```
✔ cost rates: the rate belongs to a job category and never to a person, its author never approves it, and an approved dated rate is final
✔ profitability: every approved hour is valued at the rate in force on the date of that hour, not the rate in force today
✔ profitability: unapproved hours and hours with no rate are declared, never silently valued at zero
✔ profitability: overhead is loaded only from an approved dated rate, and its author never approves it
✔ profitability: the forecast takes future commitments from outside this module and says plainly when it did not get them
✔ profitability: every read is bounded by tenant and by its own capability, and service lines are tagged by a person, never guessed
✔ profitability: category lifecycle is versioned and an inactive category cannot be priced or assigned
ℹ tests 7   ℹ pass 7   ℹ fail 0
```

التغطية الإلزامية: منع الاعتماد الذاتي · منع تعديل المعتمد (كودًا و`TRIGGER`) · تعارض `version` · عزل `tenant` · صلاحية كل دور · `verifyAudit(db)` في آخر كل اختبار.

الاختبارات المجاورة بعد تغييري، ولم أعدّل أيًا منها:

```
node --test tests/migrations.test.mjs tests/static-modules.test.mjs tests/ui-render.test.mjs tests/platform.test.mjs tests/access.test.mjs
ℹ tests 24   ℹ pass 24   ℹ fail 0
```

`ui-render.test.mjs` لا يغطي شاشتيّ بعد لأنهما ليستا في `operationModules`؛ شغّلت الفحص نفسه يدويًا على الشاشتين لكل دور (عرض + فتح كل زر) بلا `undefined` ولا `NaN` ولا مخالفة CSP. يسري عليهما الاختبار المشترك تلقائيًا فور ربط المنسّق للمفتاحين.
