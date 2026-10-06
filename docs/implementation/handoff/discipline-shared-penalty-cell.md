# Handoff: correcting the shared-penalty cell in the in-force penalty schedule

**Why.** The in-force schedule (`discipline_schedules`, tenant `36t`, accepted 22 September 2026, prepared from the platform extract `discipline-regulation-v1`) marks rows **A01–A05** with `extra_deduction: "late_time"` and row **A11** with `extra_deduction: "absence_time"`. The signed pages do not.

**What the signed pages print** (read from the page images, not from the extracted text):

| Signed page | Item | Shared-penalty cell («العقوبة المشتركة») |
| --- | --- | --- |
| p043 | 1, 2, 3 | none printed |
| p044 | 4, 5 | none printed |
| p044 | 6 | «بالإضافة إلى حسم أجر دقائق التأخر» |
| p044 | 7 | «بالإضافة إلى حسم أجر ساعات التأخر» |
| p044 | 8 | «بالإضافة إلى حسم أجر مدة ترك العمل» |
| p045 | 9 | «بالإضافة إلى حسم أجر مدة ترك العمل» |
| p045 | 10, **11** | none printed |
| p045 | 12, 13 | «بالإضافة إلى حسم أجر مدة الغياب» |
| p046 | 14 | «بالإضافة إلى حسم أجر مدة الغياب» |

So the six rows to correct are **A01, A02, A03, A04, A05** (the `late_time` cell the pages print under item 6 only) and **A11** (the `absence_time` cell the pages print under items 12–14 only). A06–A09 and A12–A14 stay exactly as they are.

These two errors are the open questions the extraction itself flagged as `parameters.uncertain` **U1** and **U2**. The signed pages answer both with "no".

## What changed in the code (this branch)

A preparer could change a penalty per occurrence and two settings, but **not** a shared-penalty cell — so an extraction error in that cell could only be fixed by editing an applied migration. `prepareSchedule` now also accepts `{code, extra_deduction}` in `changes`:

- allowed values: `null` (the page prints no cell under that item), `"late_time"`, `"left_time"`, `"absence_time"` — the same three the schedule already uses, now validated in `checkParameters` as well;
- **removing** a cell (`null`) is exactly as available as adding one, because the error that costs an employee money is a cell added to an item that does not carry one;
- a cell correction is its own entry in `changes` and is refused if it is mixed with `occurrence`/`penalty` in the same entry;
- the audit event `discipline_schedule.prepared` records each correction as `{code, from, to}`, not just a count.

The screen (`app/static/discipline-ui.mjs`, action `prepare_schedule`) exposes it as a second rows field, **«تصحيح خانة العقوبة المشتركة بعد المطابقة مع PDF الموقع»**, whose first option is «لا خانة عقوبة مشتركة تحت هذا البند». The schedule table now prints the cell's own wording instead of a generic label. No migration and no schema change: the schedule's rows live in the JSON `parameters` column.

## The sequence to run on the live database

Two people, as always: whoever prepares the version cannot accept it.

### 1. HR preparer (holds `hr.policy.prepare`) — screen «المخالفات والجزاءات» → the in-force schedule → **«إعداد نسخة للكيان»**

- **Source**: the in-force company version (not the platform extract), so nothing else in it changes.
- **العنوان**: e.g. «جدول المخالفات والجزاءات — نسخة مصححة بعد مطابقة الصفحات الموقعة».
- **السند**: «لائحة تنظيم العمل المعتمدة رقم 351743 بتاريخ 25-10-1446هـ — شهادة الاعتماد؛ جداول المخالفات والجزاءات، الصفحات p043–p046 من النسخة الموقعة.»
- **تاريخ السريان المقترح**: the date the acceptor will confirm below.
- **مهلة الدفاع المكتوب**: leave at the current value (3). It is a company choice, not م117 — see `docs/implementation/handoff/` note in the same commit.
- **تصحيح خانة «العقوبة المشتركة»** — six rows, each with «لا خانة عقوبة مشتركة تحت هذا البند»:

  | البند | الخانة |
  | --- | --- |
  | A01 | لا خانة عقوبة مشتركة تحت هذا البند |
  | A02 | لا خانة عقوبة مشتركة تحت هذا البند |
  | A03 | لا خانة عقوبة مشتركة تحت هذا البند |
  | A04 | لا خانة عقوبة مشتركة تحت هذا البند |
  | A05 | لا خانة عقوبة مشتركة تحت هذا البند |
  | A11 | لا خانة عقوبة مشتركة تحت هذا البند |

- **تصحيح خانات التكرار**: leave empty. No occurrence cell changes.
- **تأكيد U1** (paste as written):
  > الصفحتان p043 وp044 من النسخة الموقعة: لا تُطبع خانة «العقوبة المشتركة» تحت البنود 1 و2 و3 و4 و5؛ أول خانة مطبوعة هي «بالإضافة إلى حسم أجر دقائق التأخر» تحت البند 6 وحده، و«ساعات التأخر» تحت البند 7. فالجواب: لا، ليست خانة مدمجة تغطي البنود 1–6.
- **تأكيد U2** (paste as written):
  > الصفحة p045 من النسخة الموقعة: لا تُطبع خانة «العقوبة المشتركة» تحت البند 11 (غياب يوم)، وتُطبع «بالإضافة إلى حسم أجر مدة الغياب» تحت البندين 12 و13، وتُطبع تحت البند 14 في p046. فالجواب: لا، البند 11 لا يشمل حسم أجر يوم الغياب من هذا الجدول.

### 2. HR acceptor (holds `hr.policy.accept`, and is **not** the preparer) — **«قبول الجدول»**

- **تاريخ السريان**: the date the company decides. The correction is an extraction fix, not a new policy, but the platform dates every version; cases recorded before that date keep the schedule that was in force when the act happened, by design.
- **أساس القرار**:
  > قبول النسخة المصححة بعد مطابقة الصفحات الموقعة p043–p046: البنود A01–A05 وA11 لا تحمل خانة «العقوبة المشتركة» في الأصل الموقع، وقد أُزيلت. أُجيب عن U1 وU2 بالنفي بنص الصفحتين.

### 3. After acceptance — verify

- The schedule card shows the six rows without a cell, and A06–A09 and A12–A14 unchanged.
- `SELECT json_extract(parameters,'$.rows') ...` is not needed: the screen prints each cell's own wording.
- The audit trail carries `discipline_schedule.prepared` with the six `{code, from, to}` entries and `discipline_schedule.accepted` with the acceptor's name.

## What this does **not** do

The platform has never applied the extra deduction to anyone's pay from this column — the discipline module proposes only the penalty itself, and absence pay is handled by the unpaid-absence path. Correcting the cell therefore removes a **false statement of the regulation shown to HR and to the employee** and closes the door on anyone applying it later; it does not by itself refund anything. If the column was applied by hand off-platform for items 1–5 or 11, that is a payroll matter for the lead, not something this change reaches.
