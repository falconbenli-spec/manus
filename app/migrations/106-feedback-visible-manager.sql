-- B18 (تدقيق الموظفين 19 سبتمبر 2026): «لا تُوسَّع المرئية بعد الكتابة» وعد مكتوب في شاشة التغذية الراجعة،
-- لكن الاستعلام كان يحل visibility='recipient_manager' على manager_id الحالي للمستلم. فإذا تغيّر مديره بعد الكتابة
-- قرأ المدير الجديد ملاحظات كُتبت لمدير آخر، وفقد المدير الذي كُتبت له رؤيتها. المرئية تُثبَّت الآن وقت الكتابة.
--
-- العمود يقبل NULL: الملاحظة المكتوبة عن موظف بلا مدير وقتها لا يراها مدير لاحق، والصفوف السابقة على هذا الترحيل
-- تبقى NULL فتقرأ بالسلوك القديم (COALESCE في app/feedback.mjs) — لا يُخترع لها مدير بأثر رجعي.
ALTER TABLE feedback_notes ADD COLUMN visible_manager_id TEXT REFERENCES users(id);
CREATE INDEX feedback_notes_visible_manager ON feedback_notes(tenant_id,visible_manager_id);

-- قيد «تُكتب مرة واحدة» في 064 لم يكن يعرف العمود الجديد، فيُعاد بناؤه ليحرسه كما يحرس النص والمرئية.
DROP TRIGGER feedback_notes_immutable;
CREATE TRIGGER feedback_notes_immutable BEFORE UPDATE ON feedback_notes
WHEN NEW.version<>OLD.version+1 OR OLD.withdrawn_at IS NOT NULL
  OR NEW.author_id<>OLD.author_id OR NEW.subject_id<>OLD.subject_id OR NEW.body<>OLD.body OR NEW.kind<>OLD.kind OR NEW.visibility<>OLD.visibility OR NEW.occurred_on<>OLD.occurred_on
  OR NEW.visible_manager_id IS NOT OLD.visible_manager_id
BEGIN SELECT RAISE(ABORT,'a feedback note is written once; only its author may withdraw it with a reason'); END;
