-- تصحيح الحضور جانبًا واحدًا — 30 سبتمبر 2026.
--
-- طلب المالك بالحرف: «غيّر تصحيح الحضور والانصراف وخلّ الموظف يقدر يختار إذا يبي يعدّل دخول
-- أو خروج، كل واحد لحال أو كلهم».
--
-- العيب: proposed_in وproposed_out كلاهما NOT NULL، ومعهما CHECK(proposed_out>proposed_in).
-- فمن نسي بصمة الانصراف وحدها مضطرٌّ أن يكتب وقت حضورٍ أيضًا — وهو وقتٌ مسجَّل أصلًا وصحيح،
-- فيعيد كتابته ليمرّ الشرط. وأسوأ منه: من لم يبصم ذلك اليوم إطلاقًا لا سجلَّ له يُنقل منه،
-- فيخترع وقتًا ليُقبل طلبه. النموذج كان يفرض جانبين على من يملك جانبًا واحدًا.
--
-- ما يتغيّر: الجانبان يصيران اختياريين، وشرطٌ جديد يمنع طلبًا فارغًا (لا بد من جانب واحد على
-- الأقل)، وشرط الترتيب يُفحص حين يُعرف الجانبان فقط. وما لم يُقترح لا يُمسّ عند الاعتماد:
-- app/attendance.mjs يكتب الجانب المقترح ويُبقي الآخر كما هو، فلا يمحو تصحيحُ الانصراف حضورًا.
--
-- لماذا إعادة بناء: SQLite لا ترفع NOT NULL ولا تُبدّل CHECK بـALTER. فالجدول يُعاد بناؤه
-- بالصفوف والفهرس والمحفّزين، ثم يُعاد تسميته. والمحفّزان يُعادان بنصّهما مضبوطًا على الأعمدة
-- التي صارت تقبل NULL: المقارنة <> على قيمة NULL تعطي NULL لا true، فيمرّ تعديلٌ كان يجب أن
-- يُمنع. لذلك تُستعمل IS NOT في المحفّز الحارس بدل <>.
--
-- والصفوف القائمة تُنقل كما هي: كلها تحمل الجانبين، وتبقى صالحة تحت الشرط الجديد.

PRAGMA foreign_keys=off;

CREATE TABLE attendance_corrections_new (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  user_id TEXT NOT NULL,
  work_date TEXT NOT NULL,
  -- اختياريان: من يصحّح جانبًا واحدًا يترك الآخر فارغًا، ولا يُمسّ عند الاعتماد.
  proposed_in TEXT,
  proposed_out TEXT,
  reason TEXT NOT NULL CHECK(length(trim(reason))>=10),
  previous_in TEXT,
  previous_out TEXT,
  status TEXT NOT NULL CHECK(status IN ('pending','approved','rejected')),
  decided_by TEXT REFERENCES users(id),
  decided_at TEXT,
  decision_note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  FOREIGN KEY(user_id,tenant_id) REFERENCES users(id,tenant_id),
  -- طلبٌ لا يقترح شيئًا ليس طلبًا.
  CHECK(proposed_in IS NOT NULL OR proposed_out IS NOT NULL),
  -- الترتيب يُفحص حين يُعرف الجانبان في الطلب نفسه. وحين يُعرف أحدهما فقط فالآخر يأتي من
  -- السجل القائم، وترتيبُ الاثنين معًا يفحصه الخادم عند الطلب وعند الاعتماد لأن السجل قد يتغيّر بينهما.
  CHECK(proposed_in IS NULL OR proposed_out IS NULL OR proposed_out>proposed_in),
  CHECK(decided_by IS NULL OR decided_by<>user_id),
  CHECK((status='pending')=(decided_by IS NULL))
) STRICT;

INSERT INTO attendance_corrections_new
  SELECT id,tenant_id,user_id,work_date,proposed_in,proposed_out,reason,previous_in,previous_out,
         status,decided_by,decided_at,decision_note,created_at
  FROM attendance_corrections;

DROP TRIGGER attendance_corrections_fixed;
DROP TRIGGER attendance_corrections_no_delete;
DROP INDEX attendance_corrections_one_pending;
DROP TABLE attendance_corrections;
ALTER TABLE attendance_corrections_new RENAME TO attendance_corrections;

CREATE UNIQUE INDEX attendance_corrections_one_pending ON attendance_corrections(user_id,work_date) WHERE status='pending';

-- IS NOT بدل <>: على عمودٍ يقبل NULL تعطي المقارنة <> قيمةَ NULL لا true، فيمرّ تعديلٌ يجب منعه.
CREATE TRIGGER attendance_corrections_fixed BEFORE UPDATE ON attendance_corrections
WHEN OLD.status<>'pending' OR NEW.user_id IS NOT OLD.user_id OR NEW.work_date IS NOT OLD.work_date
  OR NEW.proposed_in IS NOT OLD.proposed_in OR NEW.proposed_out IS NOT OLD.proposed_out OR NEW.reason IS NOT OLD.reason
BEGIN SELECT RAISE(ABORT,'a decided correction is final'); END;

CREATE TRIGGER attendance_corrections_no_delete BEFORE DELETE ON attendance_corrections
BEGIN SELECT RAISE(ABORT,'corrections are retained'); END;

PRAGMA foreign_keys=on;
