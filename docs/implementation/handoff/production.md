# تسليم وحدة الإنتاج والتصوير — `production`

## 1. الملفات

أُنشئت:

- `app/migrations/061-production.sql`
- `app/production.mjs`
- `app/static/production-ui.mjs`
- `tests/production.test.mjs`
- `docs/implementation/handoff/production.md` (هذا الملف)

لم يُعدَّل أي ملف قائم. لم تُلمس `app/server.mjs` ولا `app/static/operations.mjs` ولا `app/access.mjs` ولا `app/inbox.mjs` ولا `app/static/hr-design.mjs` ولا `app/print-documents.mjs` ولا أي اختبار قائم ولا أي هجرة أخرى.

## 2. الهجرة 061 وجداولها

`app/migrations/061-production.sql` — ثمانية جداول `STRICT`:

| الجدول | ما فيه | أبرز ما يفرضه SQL |
|---|---|---|
| `productions` | المشروع الإنتاجي: الرمز، النوع (إعلان · محتوى اجتماعي · فيديو مؤسسي · تصوير ثابت)، الحالة، المنتِج المسؤول، مدة التصوير، الربط بعميل أو حملة أو مشروع | لا بد من ربط واحد على الأقل · `closed_by<>producer_id` · `status='closed'` يلزمه `closed_by` · `TRIGGER` يمنع تعديل المقفل أو الملغى ويثبّت الرمز والمنتِج ويشترط `version+1` · لا حذف |
| `production_crew` | الدور، داخلي/خارجي، `user_id` أو `vendor_id`، معدّل اليوم وعدد الأيام للخارجي فقط | `(source='internal')=(user_id IS NOT NULL)` و`(source='external')=(vendor_id IS NOT NULL)` · `CHECK` يمنع تخزين أي `day_rate_minor` أو `days` لموظف داخلي · فهرس فريد يمنع تكرار الشخص بالدور نفسه · الاستبعاد بـ`active=0` وسبب، لا حذف |
| `production_talent` | الموهبة ونوعها ووكالتها، وتصريح استخدام الصورة: الحالة والتاريخ والمدة والنطاق والوسائط ومكان حفظ الأصل الموقّع | «موقّع» أو «منتهٍ» يلزمه تاريخ توقيع ونطاق ومكان حفظ · غير ذلك يلزمه خلو حقول التوقيع · لا حذف |
| `production_locations` | الموقع وعنوانه ورابط خريطته وجهة اتصاله، و«هل يتطلب تصريحًا؟» وسند القرار وحالة التصريح ورقمه ومصدره وانتهاؤه ومكان حفظه | `(permit_required=0)=(permit_status='not_required')` · «يتطلب» يلزمه سند مكتوب · «صدر» يلزمه رقم ومصدر وانتهاء ومكان حفظ · لا حذف |
| `shoot_schedule` | أيام التصوير ومشاهدها مع `sort_order` وموقع ووقت بدء ومدة مقدرة | فهرس `(production_id,shoot_date,sort_order)` |
| `shot_list` | اللقطة ووصفها وحجمها وزاويتها ومرجعها البصري وحالتها (مخططة · صُوِّرت · أُعيدت) | تغيّر الحالة يلزمه ملاحظة |
| `call_sheets` | ورقة الاستدعاء: اليوم، وقت التجمع والانتهاء، الموقع ورابط الخريطة، جدول اليوم بالساعات (JSON)، السلامة، الطقس، أقرب مستشفى وعنوانه، اسم وهاتف اتصال الطوارئ، النسخة و`supersedes_id` و`change_summary` | `issued_by<>prepared_by` · لا تُصدَر بلا موقع وأقرب مستشفى واتصال طوارئ وجدول غير فارغ · النسخة >1 يلزمها بيان ما تغير · فهرسان فريدان: مسودة واحدة وورقة صادرة واحدة لكل يوم · `TRIGGER call_sheets_issued_immutable` يرفض أي تعديل على الصادرة عدا الانتقال إلى «استُبدلت» أو «ملغاة» · لا حذف |
| `call_sheet_invitees` | المستدعى (طاقم أو موهبة)، حسابه إن وُجد، وقت حضوره، قناة التبليغ، وحالته: أُرسل · اطّلع · أكّد · اعتذر، ومصدر الرد | `(delivery='in_platform')=(user_id IS NOT NULL)` · الرد المسجَّل نيابةً يلزمه بيان كيف وصل · `TRIGGER` يمنع نقل السطر لورقة أخرى أو إعادته إلى «أُرسل» أو تعديله بعد أن تُستبدل ورقته |

## 3. المسارات التي يحتاجها المنسّق في `app/server.mjs`

`import * as production from './production.mjs';`

كل مسارات `POST` داخل معاملة. مسارات الإنشاء تحتاج `Idempotency-Key` (نمط `once(...)`).

| الطريقة | المسار | الدالة | داخل معاملة | Idempotency-Key |
|---|---|---|---|---|
| GET | `/api/productions` | `production.productionsBoard(db,u)` | لا | لا |
| POST | `/api/productions` | `production.createProduction(db,u,input)` | نعم | نعم |
| POST | `/api/productions/:id/(edit\|start\|wrap\|close\|cancel)` | `production.productionAction(db,u,id,action,input)` | نعم | لا |
| POST | `/api/productions/:id/crew` | `production.addCrew(db,u,id,input)` | نعم | نعم |
| POST | `/api/production-crew/:id/(edit\|remove)` | `production.crewAction(db,u,id,action,input)` | نعم | لا |
| POST | `/api/productions/:id/talent` | `production.addTalent(db,u,id,input)` | نعم | نعم |
| POST | `/api/production-talent/:id/(edit\|release\|remove)` | `production.talentAction(db,u,id,action,input)` | نعم | لا |
| POST | `/api/productions/:id/locations` | `production.addLocation(db,u,id,input)` | نعم | نعم |
| POST | `/api/production-locations/:id/(edit\|permit\|remove)` | `production.locationAction(db,u,id,action,input)` | نعم | لا |
| POST | `/api/productions/:id/schedule` | `production.saveSchedule(db,u,id,input)` | نعم | لا |
| POST | `/api/productions/:id/shots` | `production.addShot(db,u,id,input)` | نعم | نعم |
| POST | `/api/shots/:id/(edit\|status)` | `production.shotAction(db,u,id,action,input)` | نعم | لا |
| GET | `/api/call-sheets` | `production.callSheetsBoard(db,u)` | لا | لا |
| POST | `/api/call-sheets` | `production.createCallSheet(db,u,input)` | نعم | نعم |
| POST | `/api/call-sheets/:id/(edit\|add_invitee\|remove_invitee\|issue\|revise\|cancel)` | `production.callSheetAction(db,u,id,action,input)` | نعم | لا |
| POST | `/api/call-sheets/invitees/:id/respond` | `production.respondToCallSheet(db,u,id,input)` | نعم | لا |
| GET | `/api/call-sheets/:id/print` | `production.callSheetPrintable(production.getCallSheet(db,u,id))` | لا | لا |

معرّفات السجلات كلها `[a-f0-9-]{36}`. صفحة الطباعة تُرسل بـ`Content-Type: text/html; charset=utf-8` على نمط `/api/invoices/:id/print` القائم، وتستعمل `/report-print.css` كما هي دون إضافة CSS.

ملف الواجهة يُضاف إلى قائمة الأصول البيضاء في `app/server.mjs`: الاسم `production-ui` (يُقدَّم على `/production-ui.mjs`).

## 4. مفاتيح `operationModules` والتنقّل

في `app/static/operations.mjs`:

```js
import { productionsUI, callSheetsUI } from './production-ui.mjs';
// داخل operationModules:
productions:productionsUI,'call-sheets':callSheetsUI
```

في مجموعات التنقّل بـ`app/static/hr-design.mjs`: كلا المفتاحين ضمن مجموعة **«التشغيل»**، بجوار `campaigns` و`content` و`studio`. `productions` تُعرض لحاملي `production.manage` فقط؛ `call-sheets` تُعرض لكل حساب لأن شاشة «استدعاءاتي» تخص الموظف المستدعى ولو لم يحمل أي تصريح.

## 5. ما ينبغي أن يظهر في «بانتظار قراري»

أضف إلى `SOURCES` في `app/inbox.mjs`:

```js
['productions','الإنتاج والتصوير',productionsBoard],
['call-sheets','أوراق الاستدعاء',callSheetsBoard],
```

الأفعال التي يلتقطها `labelFor` القائم دون أي تعديل عليه، وهي وحدها القرارات المنتظرة فعلًا:

- `issue_sheet` ← «إصدار»: مسودة ورقة استدعاء تنتظر من يصدرها، ويظهر لغير من أعدّها.
- `accept_close` ← «اعتماد»: إنتاج انتهى تصويره وينتظر إقفال طرف ثانٍ غير منتجه.
- `confirm` ← «تأكيد»: ورقة استدعاء صادرة تنتظر تأكيد حضور المستدعى صاحب الحساب.

بقية أفعال الوحدة (تحرير، إضافة، تسجيل، إلغاء، إصدار نسخة جديدة، تسجيل رد وصل خارج المنصة) يستبعدها `NOT_DECISIONS` القائم لأنها عمل صاحب السجل لا قرار ينتظره غيره. ولوحة `callSheetsBoard` لا ترمي `403` لمن لا تصريح له، فالصندوق يقرؤها لكل مستخدم.

## 6. ما لم يُبنَ ولماذا، وما يحتاج قرارًا

1. **لا إشعار في جدول `notifications`.** الجدول المشترك في `app/schema.sql` يعرّف `request_id TEXT NOT NULL REFERENCES requests(id)`، وورقة الاستدعاء ليست طلب خدمة؛ ولن أختلق طلبًا ولا أعدّل جدولًا مشتركًا. البديل المنفَّذ: سطر المستدعى نفسه هو الإشعار — يحمل `notified_at` وقت الإصدار وحالته، ويظهر للموظف في «استدعاءاتي» وفي صندوق «بانتظار قراري» عبر الفعل `confirm`. **قرار للمنسّق:** إما توسيع `notifications` ليقبل كيانًا غير الطلب (تغيير جدول مشترك يخص وحدات أخرى أيضًا)، أو إبقاء الحال وتوثيقه.
2. **لا رابط مشاركة لمن لا حساب له.** المستقل الخارجي والموهبة لا حساب لهما، فالورقة لا تصلهما من المنصة. الحقل `delivery='outside_platform'` مصرَّح به في الشاشة والطباعة نصًّا، ويسجل المنتج ردهم مع بيان كيف وصل. لم أبنِ أي رابط عام.
3. **لا رفع مرفق للمرجع البصري في قائمة اللقطات.** `stored_files.entity_type` مقيَّد بـ`CHECK` بأربعة أنواع في الهجرة 035، وتوسيعه يعني إعادة بناء جدول مشترك قد يعيد وكيل آخر بناءه في الهجرة نفسها ويضيع عمله. المنفَّذ: حقل `reference_note` نصي يكتب فيه المنتج مكان المرجع، والشاشة تقول ذلك صراحة. **قرار للمنسّق:** توسيع أنواع `stored_files` و`ENTITIES` في `app/files.mjs` مركزيًا ليقبل `production_shot`، ثم ربط الحقل.
4. **الترتيب بالسحب والإفلات غير مبني.** `sort_order` مخزَّن ويُحفظ ويُعاد ترتيبه كما طُلب، لكن التفاعل نفسه يحتاج JS وCSS في ملفات مشتركة ممنوعة. المنفَّذ: حقل `rows` يحفظ الترتيب بترتيب صفوفه، والشاشة تقول إن السحب غير متاح في هذه النسخة.
5. **لا طقس ولا خرائط ولا أقرب مستشفى آليًّا.** كلها حقول يدوية، وكل شاشة ونسخة طباعة تقول ذلك نصًّا. ولا تُصدَر ورقة استدعاء قبل أن يملأ المنتج أقرب مستشفى واتصال الطوارئ — يفرضه `CHECK` لا الواجهة وحدها.
6. **لا مسار دفع موازٍ.** المستقل الخارجي مورد في `vendors` فقط، و`production_crew` يحفظ معدّل يومه وعدد أيامه كبيان تعاقدي لا أكثر. لم أُنشئ مستحقًا ولا أمر دفع ولا ربطًا آليًا بـ`payables`؛ الصرف يبقى في دورة المشتريات والفواتير والمدفوعات القائمة. **قرار للمالك:** هل يُشترط أن يكون المورد «معتمدًا» قبل تكليفه في الإنتاج؟ الآن لا يُشترط (التكليف واقعة، والدفع هو المحكوم بالبوابة في `payables`)، والشاشة تعرض حالة تأهيل المورد.
7. **أجر الموظف الداخلي وتكلفته غير موجودين.** لا في الجداول ولا في اللوحة ولا في الطباعة، ويرفض `CHECK` في SQL تخزين أي رقم لموظف داخلي حتى بكتابة مباشرة على قاعدة البيانات.
8. **الميزانية غير مكررة.** `productions.project_id` هو الرابط، واللوحة تعيد نصًّا يدل على شاشة «مخصصات المشاريع». لم أقرأ `project_budgets` ولم أعرض أي مبلغ منه، لأن `app/budgets.mjs` يحصر أرقامه بحاملي التفويض المالي ونطاق المشروع.
9. **لا نِسَب ولا مُهَل ولا أسعار ولا متطلبات نظامية.** «هل يتطلب هذا الموقع تصريحًا؟» حقل يحدده المنتج مع سنده المكتوب، ولا قيمة افتراضية ولا افتراض عن أي جهة.
10. **تصريح استخدام الصورة ليس توقيعًا إلكترونيًا** ولا تدّعي المنصة له حجية: تُسجَّل الواقعة فقط — هل وُقّع، ومتى، ولأي نطاق، وأين حُفظ الأصل.
11. **التصريح `production.manage` مستخدم كما هو محجوزًا** ولم أضف غيره ولم ألمس `app/access.mjs`. هو تصريح قابل للحصر بإدارة، لكن سجلات الإنتاج ليست ذات إدارة مالكة، فالتحقق يتم بـ`can(db,u,'production.manage')` دون تمرير إدارة. **قرار للمالك:** هل تُحصر وحدة الإنتاج بإدارة بعينها؟
12. **فصل المهام المطبَّق:** منتج العمل يُعِدّ ورقة الاستدعاء ولا يصدرها (`issued_by<>prepared_by` في SQL)، والمنتج لا يقفل إنتاجه (`closed_by<>producer_id` في SQL)، وصاحب الحساب يرد على استدعائه بنفسه ولا يرد عنه المنتج.

## 7. نتيجة تشغيل الاختبارات

`node --test tests/production.test.mjs`:

```
✔ production crew: the external freelancer is a vendor with a day rate, the internal employee is a user whose pay never appears here (287.5565ms)
✔ talent release and location permit: a recorded fact and a producer decision, never a signature nor an assumed legal requirement (284.148042ms)
✔ call sheet: the producer never issues their own sheet, and an issued sheet is replaced by a revision that states what changed (284.29975ms)
✔ call sheet delivery: the platform notifies only people who hold an account, and it never claims to have reached anyone else (294.054ms)
✔ production lifecycle: the producer does not close their own production, a closed one is frozen, and stale versions and other tenants are refused (282.839625ms)
✔ shoot schedule and shot list: the day keeps the order it was saved in, and a shot that changed state says why (298.328042ms)
✔ production screens: every offered action opens a form, nothing is inlined past the strict CSP, and the screens say what they cannot do (286.287542ms)
ℹ tests 7
ℹ suites 0
ℹ pass 7
ℹ fail 0
```

`verifyAudit(db)` في آخر كل اختبار كتابة. وللتأكد من عدم كسر الجوار شُغّلت بالاسم:

```
node --test tests/migrations.test.mjs tests/static-modules.test.mjs tests/access.test.mjs tests/inbox.test.mjs \
  tests/service-cards.test.mjs tests/campaigns.test.mjs tests/budgets.test.mjs tests/payables.test.mjs tests/vendors.test.mjs
ℹ tests 32 · pass 32 · fail 0

node --test tests/platform.test.mjs tests/company-scale.test.mjs tests/legacy-access.test.mjs tests/init-pilot.test.mjs \
  tests/security-regressions.test.mjs tests/operations-http.test.mjs tests/mobile-preview.test.mjs tests/print-documents.test.mjs
ℹ tests 39 · pass 39 · fail 0
```

لم يُشغَّل `npm test` كاملًا كما ينص عقد العمل، لأن وكلاء آخرين يعملون على المستودع الآن.

## 8. أصناف CSS

لم يُضف أي صنف CSS جديد. الشاشتان تستعملان الأصناف القائمة فقط: `panel` `panel-body` `vn-head` `vn-group` `vn-card` `vn-code` `vn-name` `vn-flags` `vn-flag` `vn-body` `vn-block` `vn-list` `vn-tiles` `vn-tile` `vn-alert` `detail-data` `table-wrap` `operation-actions` `badge` `subtle` `btn` `outline` `small` `is-ok` `is-late` `is-due` `is-old` `is-warn` `is-block`. ولا `style=""` ولا `<script>` ولا أي مورد خارجي — يتحقق منه الاختبار السابع.
