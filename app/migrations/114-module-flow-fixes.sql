-- ترحيل 114 — إصلاحات مسارات الوحدات من تدقيق 20 سبتمبر (D-08، D-09، D-11).
-- لا يُعاد بناء أي جدول قائم ولا يُعدَّل أي صف: إضافة أعمدة وجداول وقوادح ونص مبدئي فقط.

-- 1) D-11: إشعار الجزاء (م121) — الترحيل 097 أضاف نوع الخطاب بلا نص مبدئي، فكان adopt_starter يرد 404
--    ويقف الملف عند «صدر القرار» بلا إبلاغ كتابي، فلا تبدأ مهلة التظلم ولا تُحصَّل الغرامة.
--    النص هنا مسودة كغيره في الترحيل 102: يتبناه معد القوالب باسمه ويعتمده شخص آخر يملك الإصدار. لا يُنشر من الترحيل.
--    عناصره النائبة كلها تملؤها وحدة الانضباط من القرار المحسوم؛ لا عنصر يكتبه إنسان عند الإصدار.
INSERT INTO letter_template_starters(type_code,body,status_note,created_at) VALUES
('discipline_notice','إشعار بجزاء تأديبي (م121 من لائحة تنظيم العمل)

إلى: {{employee_name}}
رقم القضية: {{case_reference}}

نفيدكم بأنه بعد التحقيق وسماع دفاعكم، ثبتت المخالفة الآتية:
{{violation_ar}}
تاريخ وقوعها: {{violation_date}}
سندها: {{article}}

وقد تقرر توقيع الجزاء الآتي: {{penalty_ar}}

وعند تكرار المخالفة نفسها يكون الجزاء المقرر: {{repeat_penalty_ar}}

ولكم التظلم من هذا الجزاء كتابةً خلال {{grievance_days}} يومًا من تاريخ إبلاغكم به، عدا أيام العطل الرسمية. تقديم التظلم لا يضركم (م126).
---- English ----
Notice of a disciplinary penalty (Art. 121 of the work regulations)

To: {{employee_name}}
Case reference: {{case_reference}}

Following the investigation and the hearing of your defence, the following violation was established:
{{violation_en}}
Date of the act: {{violation_date}}
Basis: {{article}}

The penalty imposed is: {{penalty_en}}

Should the same violation recur, the scheduled penalty will be: {{repeat_penalty_en}}

You may file a written grievance against this penalty in writing within {{grievance_days}} days of being notified of it, excluding official holidays. Filing a grievance shall not be held against you (Art. 126).',
 'مسودة مبدئية ثنائية اللغة تحتاج اعتماد الموارد البشرية قبل أي إصدار: يتبناها معد القوالب باسمه ويعتمدها شخص آخر يملك إصدار الخطابات. السند ({{article}}) يُملأ بالعربية في النصين لأن اللائحة لا تحمل صيغة إنجليزية لبنودها في المنصة.','2026-09-20T00:00:00.000Z');

-- 2) D-09: لا سبيل لصاحب المطالبة أو العهدة أن يسحب ما قدّمه، فمخرجه الوحيد أن يطلب من مديره رفض مطالبته هو.
--    السحب قبل أول قرار فقط، ويبقى الصف بحالته ليحفظ أثره؛ خانة السحب هي التي تُنهيه. الحالة لا تُغيَّر لأن جدول 032
--    لا يقبل حالة جديدة إلا بإعادة بنائه، وإعادة بناء جدول عليه مراجع أجنبية حية خطر لا يبرره وسم.
ALTER TABLE expense_claims ADD COLUMN withdrawn_at TEXT;
ALTER TABLE expense_claims ADD COLUMN withdrawal_reason TEXT;
ALTER TABLE custodies ADD COLUMN withdrawn_at TEXT;
ALTER TABLE custodies ADD COLUMN withdrawal_reason TEXT;
-- الإيصال المسحوب لا يحجز نفسه: إعادة تقديمه بالمبلغ الصحيح مسموحة كما تُسمح بعد الرفض.
DROP INDEX expense_claims_receipt;
CREATE UNIQUE INDEX expense_claims_receipt ON expense_claims(tenant_id,claimant_id,expense_date,amount_minor,receipt_reference)
  WHERE status<>'rejected' AND withdrawn_at IS NULL;
-- المسحوب نهائي: لا يُعاد فتحه ولا يُقرَّر فيه، ولا يُسحب إلا ما لم يُقرَّر فيه بعد.
CREATE TRIGGER expense_claims_withdrawn_final BEFORE UPDATE ON expense_claims
WHEN OLD.withdrawn_at IS NOT NULL BEGIN SELECT RAISE(ABORT,'a withdrawn claim is final'); END;
CREATE TRIGGER expense_claims_withdraw_before_decision BEFORE UPDATE ON expense_claims
WHEN NEW.withdrawn_at IS NOT NULL AND (OLD.status<>'submitted' OR OLD.manager_id IS NOT NULL OR OLD.finance_id IS NOT NULL)
BEGIN SELECT RAISE(ABORT,'a claim is withdrawn only before its first decision'); END;
CREATE TRIGGER custodies_withdrawn_final BEFORE UPDATE ON custodies
WHEN OLD.withdrawn_at IS NOT NULL BEGIN SELECT RAISE(ABORT,'a withdrawn custody request is final'); END;
CREATE TRIGGER custodies_withdraw_before_decision BEFORE UPDATE ON custodies
WHEN NEW.withdrawn_at IS NOT NULL AND (OLD.status<>'requested' OR OLD.approved_by IS NOT NULL)
BEGIN SELECT RAISE(ABORT,'a custody request is withdrawn only before its first decision'); END;

-- 3) D-08: مطالبة التذكرة بنمط «حجز» تنتهي مقترحًا على المالية (company_expense) لا يقرأه أحد: صفر إجراء لكل دور،
--    وhand_to_payroll مرفوض بحق لأنه ليس حركة مسير. الخطوة التالية هنا ومالكها حامل تصريح المزايا:
--    الحجز يجري لدى وكيل السفر خارج المنصة (المنصة لا تحجز ولا تدفع)، ويُسجَّل مرجعه هنا فيُقفل المسار ويُبلَّغ الموظف.
CREATE TABLE benefit_ticket_bookings (
  proposal_id TEXT PRIMARY KEY REFERENCES benefit_payout_proposals(id),
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  request_id TEXT NOT NULL,
  employee_id TEXT NOT NULL,
  reference TEXT NOT NULL CHECK(length(trim(reference))>=3),
  booked_on TEXT NOT NULL CHECK(booked_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  note TEXT NOT NULL DEFAULT '',
  recorded_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY(request_id,tenant_id) REFERENCES benefit_requests(id,tenant_id),
  FOREIGN KEY(employee_id,tenant_id) REFERENCES users(id,tenant_id),
  FOREIGN KEY(recorded_by,tenant_id) REFERENCES users(id,tenant_id),
  CHECK(recorded_by<>employee_id)
) STRICT;
CREATE TRIGGER benefit_ticket_bookings_fixed BEFORE UPDATE ON benefit_ticket_bookings BEGIN SELECT RAISE(ABORT,'a ticket booking reference is recorded once'); END;
CREATE TRIGGER benefit_ticket_bookings_no_delete BEFORE DELETE ON benefit_ticket_bookings BEGIN SELECT RAISE(ABORT,'ticket booking references are retained'); END;
