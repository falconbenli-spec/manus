# تسليم `leave-benefits` — استحقاق الإجازات والتأمين الطبي والمزايا

## 1. الملفات

أُنشئت:

- `app/migrations/066-leave-accrual-benefits.sql`
- `app/leave-accrual.mjs`
- `app/benefits.mjs`
- `app/static/leave-benefits-ui.mjs` (يصدّر `leaveAccrualUI` و`benefitsUI`)
- `tests/leave-accrual.test.mjs`
- `tests/benefits.test.mjs`
- `docs/implementation/handoff/leave-benefits.md` (هذا الملف)

لم يُعدَّل أي ملف قائم إطلاقًا: لا `app/leave.mjs` ولا `app/migrations/006-leave.sql` ولا `app/access.mjs` ولا أي اختبار قائم ولا أي ملف مشترك.

## 2. الهجرة 066 وجداولها

| الجدول | ما فيه |
| --- | --- |
| `leave_accrual_policies` | قاعدة الاستحقاق لكل نوع إجازة: وحدة الاستحقاق (`month`/`year`)، المقدار `accrual_milli` (اليوم = 1000)، بدء الاستحقاق (`hire`/`after_period` + `waiting_days`)، `carryover_allowed` و`carryover_cap_milli`، `cash_on_end_of_service`، المصدر `basis` وتاريخ تأكيده `basis_confirmed_on`، `effective_from`، الحالة، المُعد والمقرر، `version`. |
| `accrual_runs` | تشغيل مؤرخ: النوع (`accrual`/`carryover`/`expiry`)، نوع الإجازة، السياسة المطبقة، مفتاح الفترة ومداها، تاريخ التشغيل، السبب، عدد الموظفين ومجموع الأيام وقائمة المستثنين بأسبابهم، ومن شغّله. |
| `leave_accrual_entries` | دفتر الحركات: `accrual` · `carryover_in` · `carryover_out` · `expiry` · `adjustment`، لكل حركة مقدارها ومصدرها النصي ومن اعتمدها وسنة الرصيد والفترة والسياسة والتشغيل. |
| `medical_policies` | وثيقة التأمين الجماعي: الشركة، رقم الوثيقة، السريان والانتهاء، الفئات (JSON)، مهلة التنبيه قبل الانتهاء بالأيام (يدخلها مسؤول المزايا)، `version`. |
| `medical_enrolments` | تسجيل الموظف: الوثيقة، الفئة، تاريخ الإرسال والتأكيد ورقم العضوية، الحذف وسببه، الحالة، `version`. |
| `medical_dependants` | التابع: صلة القرابة وتاريخ الميلاد وتاريخ الإضافة والحذف فقط. **لا اسم ولا هوية ولا حقل نصي حر ولا أي حقل يقبل بيانًا طبيًا.** |

القيود المفروضة في SQL (لا في الكود وحده):

- من أعدّ لا يعتمد: `CHECK(decided_by<>prepared_by)` في `leave_accrual_policies`، و`CHECK(recorded_by<>employee_id)` في `medical_enrolments`، و`CHECK(run_id IS NOT NULL OR approved_by<>employee_id)` للتسوية اليدوية.
- المعتمد لا يُعدَّل: `leave_accrual_policies_fixed` يرفض أي تعديل بعد القرار، `accrual_runs_no_update`، `leave_accrual_entries_no_update/no_delete` (الدفتر إلحاقي فقط)، `medical_enrolments_identity` يرفض إعادة فتح تسجيل محذوف.
- عدم التكرار عند إعادة التشغيل: `UNIQUE(tenant_id,kind,leave_type,period_key)` على التشغيل، وفهرس فريد جزئي `leave_accrual_run_once` على (مستأجر + موظف + نوع + حركة + فترة) لكل حركة ناتجة عن تشغيل.
- `leave_accrual_not_negative` يمنع أي حركة سالبة تُنزل رصيد السنة تحت الصفر.
- `accrual_runs_need_policy` يمنع أي تشغيل بلا سياسة معتمدة سارية في فترته.

## 3. المسارات التي يحتاجها المنسّق في `app/server.mjs`

استيراد: `import * as leaveAccrual from './leave-accrual.mjs';` و`import * as benefits from './benefits.mjs';`

### استحقاق الإجازات

| الطريقة | المسار | الدالة | معاملة | Idempotency-Key |
| --- | --- | --- | --- | --- |
| GET | `/api/leave-accrual` | `leaveAccrual.accrualBoard(db,u)` | لا | لا |
| GET | `/api/leave-accrual/settlement/:employeeId` | `leaveAccrual.accrualSettlementView(db,u,employeeId)` | لا | لا |
| POST | `/api/leave-accrual/policies` | `leaveAccrual.prepareAccrualPolicy(db,u,input)` | نعم | نعم (`once(...,id=>({id}))`) |
| POST | `/api/leave-accrual/policies/:id` | `leaveAccrual.updateAccrualPolicyDraft(db,u,id,input)` | نعم | لا (فيه `version`) |
| POST | `/api/leave-accrual/policies/:id/accept` \| `/reject` | `leaveAccrual.decideAccrualPolicy(db,u,id,'accept'\|'reject',input)` | نعم | لا |
| POST | `/api/leave-accrual/runs` | `leaveAccrual.runAccrualCycle(db,u,input)` | نعم | نعم (والتشغيل نفسه غير قابل للتكرار بمفتاحه) |
| POST | `/api/leave-accrual/adjustments` | `leaveAccrual.recordAccrualAdjustment(db,u,input)` | نعم | نعم |

`:id` معرف UUID. مسار القرار يُطابَق مثل `^\/api\/leave-accrual\/policies\/([0-9a-f-]{36})(?:\/(accept|reject))?$`.

### التأمين الطبي والمزايا

| الطريقة | المسار | الدالة | معاملة | Idempotency-Key |
| --- | --- | --- | --- | --- |
| GET | `/api/benefits` | `benefits.benefitsBoard(db,u)` | لا | لا |
| POST | `/api/benefits/policies` | `benefits.recordMedicalPolicy(db,u,input)` | نعم | نعم |
| POST | `/api/benefits/policies/:id` | `benefits.updateMedicalPolicy(db,u,id,input)` | نعم | لا (فيه `version`) |
| POST | `/api/benefits/enrolments` | `benefits.recordEnrolment(db,u,input)` | نعم | نعم |
| POST | `/api/benefits/enrolments/:id/confirm` | `benefits.enrolmentAction(db,u,id,'confirm_enrolment',input)` | نعم | لا |
| POST | `/api/benefits/enrolments/:id/remove` | `benefits.enrolmentAction(db,u,id,'remove_enrolment',input)` | نعم | لا |
| POST | `/api/benefits/enrolments/:id/dependants` | `benefits.addDependant(db,u,input)` | نعم | نعم |
| POST | `/api/benefits/dependants/:id/remove` | `benefits.removeDependant(db,u,id,input)` | نعم | لا |

كل دوال الكتابة تبدأ بفحص `db.isTransaction` وترفع `transaction_required` خارج المعاملة.

## 4. مفتاح الوحدة في `operationModules` والملف الثابت

- الملف الثابت للقائمة البيضاء في `app/server.mjs`: `leave-benefits-ui` (يخدم `/leave-benefits-ui.mjs`). لا يستورد أي ملف آخر ولا ينشئ أي صنف CSS جديد.
- في `app/static/operations.mjs`:
  - `import { leaveAccrualUI, benefitsUI } from './leave-benefits-ui.mjs';`
  - `'leave-accrual':leaveAccrualUI` — مجموعة التنقّل: **خدمات الموظف**، بجوار `leave`.
  - `benefits:benefitsUI` — مجموعة التنقّل: **خدمات الموظف**، بجوار `contracts` و`payroll-extras`.

## 5. ما ينبغي أن يظهر في «بانتظار قراري»

- `accrual_policy.prepared`: كل سياسة استحقاق حالتها `draft` تنتظر حامل `hr.policy.accept` (وليس مُعدّها). الفعل: `accept_accrual_policy` / `reject_accrual_policy` على `/api/leave-accrual/policies/:id/accept|reject`.
- تنبيهات المزايا ليست قرارات داخل المنصة بل أفعال خارجها (لدى شركة التأمين)، فلا تُدرَج في الصندوق؛ تظهر في شاشة المزايا كتنبيهات: انتهاء وثيقة، موظف جديد غير مسجَّل، موظف غادر ولم يُحذف.
- تشغيلات الاستحقاق والترحيل وانتهاء الصلاحية أفعال يبدأها مدير الموارد البشرية بنفسه، وليست عناصر انتظار.

## 6. ما لم يُبنَ ولماذا · وما يحتاج قرار المالك

1. **لا قاعدة استحقاق واحدة في المنصة عند التسليم.** لا مدة ولا نسبة ولا سقف ترحيل في الكود ولا في المخطط ولا في أي بذرة. الشاشة تبدأ فارغة وتطلب من مدير الموارد البشرية إدخال القاعدة بمصدرها وتاريخ تأكيدها، وتكرر عبارة «يحتاج مراجعة نظام العمل ولائحته». **قرار المالك المطلوب:** من يدخل القواعد، ومن يراجعها نظاميًا قبل الاعتماد.
2. **الفترة الجزئية لا تُحسب بنسبة.** الموظف الذي بدأ استحقاقه بعد بداية الفترة يُستثنى من التشغيل ويظهر سببه في `skipped`، وتُقيَّد فترته بتسوية يدوية بسبب مكتوب. لم أخترع قاعدة تناسب لأن التناسب نفسه قرار سياسة.
3. **الربط بمسير الرواتب للصرف النقدي — لا مسار صرف موازٍ.** هذه الوحدة لا تنشئ أي حركة مالية ولا سطر مسير. الصرف يجري في الآلية القائمة `prepareSettlement` في `app/payroll-extras.mjs`: `accrualSettlementView(db,u,employeeId)` تعيد الأيام المتبقية للأنواع التي تقول سياستها المعتمدة إنها تُصرف نقدًا، ويُدخلها مُعد الرواتب في حقل «أيام الإجازة المستحقة» بشاشة تسوية نهاية الخدمة. وحين تُعتمد التسوية تقرأ لوحة الاستحقاق منها حركة `payout` لتفسير الرصيد (قراءة فقط من `service_settlements`). **اقتراح للمنسّق:** إظهار هذه القراءة بجوار نموذج التسوية في شاشة الرواتب. إن وُجد أكثر من نوع إجازة قابل للصرف، تقول الوحدة صراحة إن التوزيع قرار مكتوب يُسجَّل بتسوية يدوية، ولا تخمّنه.
4. **الاستخدام لا يُنسخ.** أيام الإجازة المستخدمة تُقرأ من دفتر `leave_ledger` في وحدة الإجازات كما هي (`debit`/`refund`) ولا تُكتب مرة ثانية هنا. هذه الوحدة **لا تعدّل** أرصدة وحدة الإجازات ولا تحجز أيامًا ولا تعتمد طلبًا: منطق الحجز والرصيد فيها دقيق ومختبر وتُرك كما هو.
5. **نتيجة ذلك — قرار مطلوب:** الرصيد الذي يُحجز منه طلب الإجازة اليوم هو الرصيد الافتتاحي في وحدة الإجازات، لا الرصيد المستحق هنا. توحيدهما يعني تعديل `app/leave.mjs` وهو خارج نطاقي. اللوحة تُظهر الرصيد السالب كتنبيه صريح حين تتجاوز الأيام المستخدمة المستحقَّ المقيَّد. **قرار المالك:** هل يصبح رصيد الاستحقاق هو مصدر الحجز في مرحلة تالية؟
6. **المزايا: لا اتصال بشركة تأمين.** لا API ولا ملف تبادل ولا تأكيد آلي. الإضافة والحذف يجريان لدى الشركة خارج المنصة، والمنصة تسجّلهما بتاريخهما ورقم العضوية وتذكّر بما تأخر. النص مكتوب في الشاشة وفي `CONNECTION_NOTE`.
7. **لا بيانات طبية إطلاقًا.** لا تشخيص ولا مطالبة علاجية ولا حالة صحية، ولا حقل في المخطط يقبلها. بيانات التابعين (صلة القرابة وتاريخ الميلاد فقط) لا يراها إلا حامل `hr.benefits.manage` عبر `holds` (لا يكفي امتياز الأدمن الأول العام)، ولا تدخل سجل التدقيق ولا أي تقرير ولا تصدير — واختبار يثبت ذلك على كل تقرير متاح لكل دور، حيًا ومصدَّرًا CSV، ويثبت أن `app/benefits.mjs` هو الوحدة الوحيدة في المنصة التي تستعلم عن جدول التابعين.
8. **لم يُضف أي صنف CSS جديد.** الشاشتان تستعملان الأصناف القائمة فقط، بلا `style=""` وبلا `<script>` وبلا مورد خارجي.
9. **لا بذرة عرض تجريبية** لهاتين الوحدتين: أي بذرة تعني اختراع قاعدة استحقاق أو وثيقة تأمين، وكلاهما قرار صاحبه. البيانات في الاختبارات فقط وموسومة «مصطنع».

## 7. نتيجة تشغيل الاختبارات

```
$ node --test tests/leave-accrual.test.mjs
✔ no accrual amount exists until the HR manager accepts a dated rule with its source, and the preparer never accepts it
✔ whoever prepares a rule cannot accept it even when holding the acceptance capability
✔ an accrual run credits one dated entry per employee per period and re-running the same period changes nothing
✔ the balance is derived line by line: leave taken in the leave module reduces it without a second ledger
✔ carryover and expiry never happen quietly: each is a dated run the HR manager accepts, capped by the accepted rule
✔ a manual adjustment needs a written reason and an approver who is not its owner, and the ledger is append only
✔ a draft is edited only by its preparer under an optimistic version, and never after acceptance
✔ each tenant sees only its own accrual: an isolated tenant account reads nothing of the other
✔ cash payout stays in payroll: this engine only reports the days to enter in the end-of-service settlement
✔ the accrual screen renders for every role and every offered button opens a usable form
ℹ tests 10 · pass 10 · fail 0

$ node --test tests/benefits.test.mjs
✔ the medical policy is a record of what the insurer holds, and the screen says the platform is not connected to any insurer
✔ dependant data is third-party personal data: only the benefits capability reads it, and no report or export carries it
✔ no medical information can be stored at all: the schema offers no column that would accept it
✔ enrolment records an action taken at the insurer: never for yourself, never twice, and only in a tier of the policy
✔ the screen reminds what must be done at the insurer: nobody is added or removed by the platform itself
✔ an isolated tenant account reads and writes nothing of the other tenant benefits
✔ the benefits screen renders for every role and every offered button opens a usable form
ℹ tests 7 · pass 7 · fail 0
```

اختبارات الجوار بعد التغيير (لم يُكسر شيء):

```
$ node --test tests/leave.test.mjs tests/hr-contracts.test.mjs tests/payroll-extras.test.mjs \
    tests/migrations.test.mjs tests/static-modules.test.mjs tests/access.test.mjs
ℹ tests 36 · pass 36 · fail 0

$ node --test tests/ui-render.test.mjs tests/security-regressions.test.mjs tests/company-scale.test.mjs
ℹ tests 13 · pass 13 · fail 0
```
