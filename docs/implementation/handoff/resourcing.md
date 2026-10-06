# تسليم وحدة `resourcing` — اعتماد كشوف الوقت وتخطيط الموارد والسعة

## 1. الملفات

أُنشئت. **لم يُعدَّل أي ملف قائم إطلاقًا**، ولا أي ملف مشترك، ولا أي اختبار قائم، ولا `app/access.mjs`:

- `app/migrations/058-resourcing.sql`
- `app/timesheets.mjs` — المهمة أ
- `app/resourcing.mjs` — المهمة ب
- `app/resource-weeks.mjs` — ملف ثالث صغير أملكه: حساب الأسابيع وأيام العمل، تحتاجه الوحدتان ولا تستورد إحداهما الأخرى (تجنّب الاستيراد الدائري كما في §3 من العقد)
- `app/static/resourcing-ui.mjs` — يصدّر `timesheetsUI` و`resourcingUI`
- `tests/timesheets.test.mjs` · `tests/resourcing.test.mjs`
- هذا الملف

قرأتُ ولم أعدّل: `app/projects.mjs` · `app/agency.mjs` (فيه جدول `time_entries` وساعات اليوم فعليًا، لا في `projects.mjs`) · `app/leave.mjs` · `app/attendance-extras.mjs` · `app/work-calendar.mjs`.
لم أستورد `app/profitability.mjs`.

## 2. الهجرة 058 وما فيها

| الجدول | ماذا يحفظ | الحماية في SQL |
|---|---|---|
| `timesheet_lock_settings` | مدة القفل المجدول لكل كيان: `lock_after_days` + `basis`. **بلا صف ابتدائي وبلا قيمة افتراضية** | `version` تفاؤلي بـ`TRIGGER`، منع الحذف |
| `timesheet_periods` | أسبوع عمل لكل موظف: `open · submitted · approved · returned · locked` | `CHECK(approved_by<>user_id)` — **الموظف لا يعتمد أسبوعه** · `TRIGGER` يرفض إعادة فتح المعتمد ويرفض أي تعديل على المقفل · `TRIGGER` يفرض أن الأسبوع يبدأ أحدًا ويمتد سبعة أيام · منع الحذف |
| `timesheet_entry_decisions` | قرار المعتمِد بقابلية الفوترة لكل إدخال، ومعه `claimed_billable` (ما ادّعاه المُسجِّل) | `UNIQUE(entry_id)` · `TRIGGER` يرفض أي تعديل أو حذف: القرار نهائي |
| `timesheet_corrections` | ربط الإدخال المصحِّح بالأصل مع سبب مكتوب | `TRIGGER` يرفض ربطًا لا يقع في **أسبوع لاحق** ولنفس الشخص · منع التعديل والحذف |
| `timesheet_reminders` | تذكير من لم يرسل أسبوعه، داخل المنصة | `UNIQUE(tenant_id,user_id,week_start)` · `CHECK(raised_by<>user_id)` · منع الحذف |
| `resource_capacity` | السعة الأسبوعية للشخص بنسخ مؤرّخة مع `basis`. **لا 40 ساعة مفترضة** | `TRIGGER` يرفض التعديل والحذف: التصحيح بنسخة بتاريخ سريان جديد |
| `role_placeholders` | العنصر النائب («مصمم قادم») على مشروع: `open · filled · cancelled` | `CHECK` يربط `filled` بوجود الشخص والوقت والمقرِّر · `TRIGGER` يرفض أي تعديل بعد الخروج من `open`: يُستبدل مرة واحدة |
| `resource_bookings` | الحجز: `tentative · confirmed · released`، على شخص **أو** عنصر نائب | `CHECK((user_id IS NULL)<>(placeholder_id IS NULL))` · `CHECK(confirmed_by<>user_id)` — **المحجوز لا يؤكد حجز نفسه** · `TRIGGER` يرفض العودة من مؤكد إلى مبدئي، ويرفض تغيير المدى أو الساعات أو المشروع أو الشخص بعد الإسناد · منع الحذف |

### مشغّلات على `time_entries` (جدول قائم لم أعدّل ملفه ولا هجرته)

هذه هي نقطة الفرض الحقيقية للقاعدتين «المعتمد لا يُعدَّل» و«لا إدخال بأثر رجعي بعد القفل»، ومفروضة على الجدول نفسه فيسري المنع على أي مسار في المنصة لا على وحدتي وحدها:

- `time_entries_closed_week_no_update` / `..._no_delete`: يرفضان تعديل أو حذف إدخال يقع في أسبوع **معتمد أو مقفل**؛ والحذف يُرفض كذلك في الأسبوع **المُرسَل**.
- `time_entries_locked_window_no_insert`: يرفض إدخالًا جديدًا في أسبوع مُرسَل أو معتمد أو مقفل، **أو** أقدم من `today - lock_after_days` متى وُجد إعداد المالك. بلا إعداد لا يُرفض شيء.

**ملاحظة تفاعل:** بعد اعتماد الأسبوع لم يعد `agency.decideTime` (اعتماد الإدخال المفرد) قادرًا على تعديل إدخالاته — وهذا مقصود: القرار انتقل إلى مستوى الأسبوع. اعتماد الأسبوع يختم الإدخالات بنفسه (`status='approved'` و`billable` بقرار المعتمِد) قبل أن ينقلب الأسبوع إلى `approved`، فتقرأ بقية المنصة (التقارير والربحية) الرقم المعتمد لا ادعاء المُسجِّل.

## 3. المسارات التي يحتاجها المنسّق في `app/server.mjs`

استيراد: `import * as timesheets from './timesheets.mjs';` و`import * as resourcing from './resourcing.mjs';`

### قراءة (خارج المعاملة، بلا `Idempotency-Key`)

| الطريقة | المسار | الدالة |
|---|---|---|
| GET | `/api/timesheets` | `timesheets.timesheetsBoard(db,u,weekDate)` — `weekDate` اختياري من `?week=YYYY-MM-DD` |
| GET | `/api/timesheets/:id` | `timesheets.getPeriod(db,u,id)` |
| GET | `/api/resourcing` | `resourcing.resourcingBoard(db,u,{from,to})` — من `?from=&to=` ويقبلهما فارغين |
| GET | `/api/resourcing/capacity` | `resourcing.capacityBoard(db,u,{from,to})` (لوحة السعة وحدها إن أردتها منفصلة) |
| GET | `/api/resourcing/bookings/:id` | `resourcing.getBooking(db,u,id)` |

### كتابة (كلها **داخل معاملة**)

| الطريقة | المسار | الدالة | `Idempotency-Key` |
|---|---|---|---|
| POST | `/api/timesheets/submit` | `submitTimesheet(db,u,input)` | نعم |
| POST | `/api/timesheets/:id/approve` | `decideTimesheet(db,u,id,'approve',input)` | لا (محمي بـ`version`) |
| POST | `/api/timesheets/:id/return` | `decideTimesheet(db,u,id,'return',input)` | لا (محمي بـ`version`) |
| POST | `/api/timesheets/correction` | `logCorrection(db,u,input)` | نعم |
| POST | `/api/timesheets/lock-window` | `setLockWindow(db,u,input)` | لا (محمي بـ`version`) |
| POST | `/api/timesheets/lock` | `lockDuePeriods(db,u,input)` | نعم |
| POST | `/api/timesheets/remind` | `remindMissing(db,u,input)` | نعم |
| POST | `/api/timesheets/reminders/:id/read` | `markReminderRead(db,u,id)` | لا |
| POST | `/api/resourcing/capacity` | `setCapacity(db,u,input)` | نعم |
| POST | `/api/resourcing/bookings` | `createBooking(db,u,input)` | نعم |
| POST | `/api/resourcing/bookings/:id/confirm` | `confirmBooking(db,u,id,input)` | لا (محمي بـ`version`) |
| POST | `/api/resourcing/bookings/:id/release` | `releaseBooking(db,u,id,input)` | لا (محمي بـ`version`) |
| POST | `/api/resourcing/placeholders` | `createPlaceholder(db,u,input)` | نعم |
| POST | `/api/resourcing/placeholders/:id/fill` | `fillPlaceholder(db,u,id,input)` | لا (محمي بـ`version`) |
| POST | `/api/resourcing/placeholders/:id/cancel` | `cancelPlaceholder(db,u,id,input)` | لا (محمي بـ`version`) |

كل دالة كتابة تبدأ بفحص `db.isTransaction` وترفع `transaction_required` بدونها.

## 4. مفاتيح الوحدة في `operationModules`

في `app/static/operations.mjs` (ملكك أنت):

```js
import { timesheetsUI, resourcingUI } from './resourcing-ui.mjs';
// ثم داخل operationModules:
timesheets:timesheetsUI, resourcing:resourcingUI
```

- اسم الملف الثابت للقائمة البيضاء: `resourcing-ui.mjs`.
- مجموعة التنقّل في `app/static/hr-design.mjs`: **التشغيل** — بجوار `time` و`projects`.
- التصاريح: `timesheets` تحتاج `portal.use` للعرض الذاتي وتُظهر أفعال الاعتماد لحامل `timesheets.approve`؛ `resourcing` تحتاج `resourcing.view` (وترفض بـ403 `not_permitted` بدونه)، والكتابة تحتاج `resourcing.plan`.

## 5. ما ينبغي أن يظهر في «بانتظار قراري» (`app/inbox.mjs` — ملكك)

| المصدر | الشرط | الوجهة |
|---|---|---|
| `timesheet_periods` | `status='submitted'` و`users.manager_id = u.id` وللمستخدم `timesheets.approve` | `#timesheets` — «أسبوع ينتظر اعتمادك» |
| `timesheet_periods` | `status='returned'` و`user_id = u.id` | `#timesheets` — «أسبوعك أُعيد إليك بسبب مكتوب» |
| `timesheet_reminders` | `user_id = u.id` و`read_at IS NULL` | `#timesheets` — «لم ترسل كشف أسبوع منتهٍ» |
| `resource_bookings` | `status='tentative'` وللمستخدم `resourcing.plan` و`user_id <> u.id` | `#resourcing` — «حجز مبدئي ينتظر تأكيدًا أو إطلاقًا» |

المعطيات جاهزة في `timesheetsBoard(...).pending` و`.missing` و`.reminders`، وفي `resourcingBoard(...).bookings` مع `actions` لكل سجل.

## 6. ما لم أبنه ولماذا · وما يحتاج قرار المالك

### أ. التنبيهات لم تُكتب في جدول `notifications` القائم — وهذا انحراف عن التكليف أصرّح به

`notifications` في `app/schema.sql` فيه `request_id TEXT NOT NULL REFERENCES requests(id)`، و`workflow.notifications()` يرشّح كل صف بـ`getRequest(db,u,n.request_id)` فيسقط أي صف بلا طلب، و`app/static/app.mjs` يبني للصف رابط `#request/<request_id>`. كشف الوقت ليس «طلبًا» في `requests`، فإدخاله هناك يتطلب إما اختلاق طلب وهمي، أو إعادة بناء جدول `notifications` الأساسي وتعديل `app/workflow.mjs` و`app/static/app.mjs` — والأخير **ملف مشترك ممنوع عليّ**، وإعادة بناء جدول أساسي بينما يعمل وكلاء آخرون خطر غير مبرر. `outbox` مقيَّد بالطريقة نفسها.

لذلك: التذكير يُسجَّل في `timesheet_reminders` (قناة `in_platform`، غير قابلة للحذف، مرة واحدة لكل شخص وأسبوع)، ويظهر في لوحة الموظف ولوحة المدير. **قرار المنسّق مطلوب:** إما قبول هذا، أو فتح `notifications` لكيانات غير الطلبات بهجرة يملكها المنسّق (`request_id` قابل للفراغ + عمودا `entity_type`/`entity_id`) مع تعديل `workflow.notifications()` ومُصيِّر الرابط في `app.mjs`. عند ذلك يكفي سطر إدخال واحد في `remindMissing`.

**لا بريد إطلاقًا**، كما في التكليف. لا شيء في الكود يدّعي إرسال بريد.

### ب. ما يحتاج قرار المالك أو مالك إجراء (حقول فارغة بلا افتراض)

1. **مدة القفل المجدول** — لا قيمة في الكود. بلا إدخالها لا يقفل شيء ولا يُرفض إدخال بأثر رجعي، والشاشة تقول ذلك نصًا. تُدخل بسندها من شاشة كشوف الوقت.
2. **السعة الأسبوعية لكل شخص** — لا 40 ساعة مفترضة (بخلاف شاشة `time` القائمة في `agency.mjs` التي تفترضها وتعلن افتراضها). من لم تُدخل سعته يظهر في `missing_capacity` بلا رقم، وخلاياه `null` لا صفر.
3. **من يملك تصريح `timesheets.approve` و`resourcing.plan`** فعليًا خارج الدورين `manager`/`pm` — قرار مسؤول الصلاحيات.

### ج. ما لم أبنه عمدًا

- **لا جدولة آلية ولا اقتراح أشخاص بخوارزمية.** لا يوجد في الوحدة أي دالة تختار شخصًا أو توزع عملًا. اللوحة تعرض السعة والمؤكد والمبدئي والمتاح وفرط التحميل، والقرار للمدير.
- **لا نسبة استغلال** في مخرجات هذه الوحدة: فرط التحميل بالساعات فقط (اختبار يفشل إن ظهر مفتاح فيه `percent` أو `utilization`).
- **لا ربط بالربحية ولا بالفوترة**: الوحدة تُنتج الساعة المعتمدة وقرار قابليتها للفوترة على `time_entries`، ومن يبني الربحية يقرأها من مصدرها.
- **نطاق الرؤية**: لوحة السعة تعرض من يديرهم المستخدم ومن يشاركهم مشروعًا وهو نفسه — لا كل الشركة — لأن أيام الإجازة والمهمات بيان شخصي. توسيعه قرار خصوصية لا قرار تقني.
- **`released`** حالة ثالثة للحجز أضفتها ليُسحب الحجز دون حذف؛ لم تُطلب صراحة لكن بدونها كان البديل حذف سجل.
- **صنف CSS جديد**: لم أضف أيًّا. استخدمت `table-wrap`/`table` القائمين في `app/static/style.css` إلى جانب الأصناف المذكورة في العقد. لا `style=""` ولا `<script>` ولا مورد خارجي (اختبار يفحص ذلك في الشاشتين).

## 7. نتيجة تشغيل الاختبارات كما ظهرت

```
$ node --test tests/timesheets.test.mjs
✔ timesheets: a week is submitted by the person who worked it and decided by their manager; nobody approves their own week, and SQL refuses it even if the code is bypassed
✔ timesheets: billable is the approver’s determination, and what the logger claimed is kept beside it rather than overwritten silently
✔ timesheets: an approved week is closed to edits, additions and deletions, and the only correction is a later-week entry that points at the original
✔ timesheets: the lock window is a setting its owner enters with a source — with none entered nothing locks and no backdated entry is refused
✔ timesheets: a stale version, another tenant’s week and a role without the capability are all refused
✔ timesheets: reminders name who has not submitted a finished week and stay inside the platform — no mail is claimed
✔ timesheets screen: it states what it does not do, offers only the actions the record allows, and carries no inline style
ℹ tests 7   ℹ pass 7   ℹ fail 0

$ node --test tests/resourcing.test.mjs
✔ resourcing: a tentative booking is shown but never counted — it stays out of scheduled hours and out of the overload figure until someone confirms it by name
✔ resourcing: capacity is a figure its owner enters with a source; with none entered the board says so and invents no forty-hour week
✔ resourcing: approved leave, approved missions and public holidays come off capacity automatically and in hours
✔ resourcing: overload is reported in hours, not a percentage, and only confirmed hours can cause it
✔ resourcing: a role placeholder is booked before anyone is hired and carries all its bookings to the real person in one move
✔ resourcing: planning is refused without the capability, across tenants, on a stale version, and nobody confirms their own booking
✔ resourcing screen: the capacity table is plain text, tells tentative from confirmed with an existing CSS class, and carries no inline style
ℹ tests 7   ℹ pass 7   ℹ fail 0
```

كل اختبار ينتهي بـ`verifyAudit(db)` صحيحًا.

الاختبارات القريبة من الوحدة، شُغّلت بالاسم بعد التغيير ولم يسقط منها شيء (53 اختبارًا):
`agency` · `leave` · `attendance-extras` · `attendance` · `migrations` · `platform` · `access`،
ثم `company-scale` · `security-regressions` · `operations-http` (19)، ثم `profitability` · `reports` · `reports-library` (14).

```
$ npm run check
Syntax checked: 285 JavaScript modules. Source hashes match. Traceability: 220 requirements / 22 domains.
```

لم أشغّل `npm test` كاملًا: وكلاء آخرون يعملون الآن على الشجرة نفسها.
