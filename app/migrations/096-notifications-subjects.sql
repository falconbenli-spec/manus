-- الإشعارات لغير طلبات الخدمة (B6 في تدقيق بوابة الموظف 19 سبتمبر، وWIRING-SPEC §7 #1).
-- كان request_id إلزاميًا ومرجعًا لجدول الطلبات، فلم تستطع الإجازات والمصروفات والخطابات وتصحيح الحضور إشعار أحد.
-- يُعاد بناء الجدول لأن NOT NULL لا يُرفع في مكانه: request_id يصبح اختياريًا، ويضاف موضوع الإشعار (نوعه ومعرّفه)
-- ونص عربي جاهز (عنوان ومتن) يُكتب عند الحدث. الصفوف القائمة تُنقل كما هي؛ عنوانها يُشتق عند القراءة من الطلب.
-- لا مبالغ رواتب ولا أرقام هوية في العنوان أو المتن: يكتبها الكود بقوالب محددة لا من مدخلات حرة.
ALTER TABLE notifications RENAME TO notifications_v1;
CREATE TABLE notifications (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  request_id TEXT REFERENCES requests(id),
  kind TEXT NOT NULL,
  read_at TEXT,
  created_at TEXT NOT NULL,
  subject_kind TEXT,
  subject_id TEXT,
  title TEXT,
  body TEXT,
  -- إشعار بلا طلب خدمة يلزمه موضوع ونص؛ لا صف فارغ لا يعرف قارئه عمّ يتحدث.
  CHECK(request_id IS NOT NULL OR (subject_kind IS NOT NULL AND subject_id IS NOT NULL AND length(trim(title))>0)),
  CHECK(subject_kind IS NULL OR subject_kind IN ('request','leave_request','expense_claim','custody','letter_request','attendance_correction')),
  CHECK(title IS NULL OR length(title)<=300),
  CHECK(body IS NULL OR length(body)<=600)
) STRICT;
INSERT INTO notifications(id,user_id,request_id,kind,read_at,created_at) SELECT id,user_id,request_id,kind,read_at,created_at FROM notifications_v1;
DROP TABLE notifications_v1;
CREATE INDEX notifications_user ON notifications(user_id,created_at);
CREATE INDEX notifications_subject ON notifications(subject_kind,subject_id);
