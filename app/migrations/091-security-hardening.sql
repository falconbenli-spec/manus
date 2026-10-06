-- تقوية أمنية لثغرات مثبتة في مراجعة الأمن (2026-09-18). لا تُعدَّل هجرة قائمة؛ القيود الجديدة هنا محفّزات
-- لأن SQLite لا يغيّر CHECK في جدول قائم، والجداول الجديدة تحل محل ما كشف الهوية.

-- ===== القسم أ: المالية والحوكمة والتشغيل =====

-- أ-1. قبول الخطر: لقطة ما قُبل فعلًا (الدرجة والعنوان والوصف). جدول مستقل لأن سجل القبول نفسه لا يُعاد كتابته.
-- القبول الأقدم من هذه الهجرة بلا لقطة، فلا يثبت أنه قُبل على الحال الحالية؛ أول تعديل له يعيده إلى «قبول مقترح».
CREATE TABLE governance_risk_acceptance_snapshots (
  acceptance_id TEXT PRIMARY KEY REFERENCES governance_risk_acceptances(id),
  risk_id TEXT NOT NULL REFERENCES governance_risks(id),
  likelihood_value INTEGER NOT NULL,
  impact_value INTEGER NOT NULL,
  score INTEGER NOT NULL CHECK(score=likelihood_value*impact_value),
  title TEXT NOT NULL,
  description TEXT NOT NULL
) STRICT;
CREATE TRIGGER governance_risk_acceptance_snapshots_match BEFORE INSERT ON governance_risk_acceptance_snapshots
WHEN NOT EXISTS(SELECT 1 FROM governance_risk_acceptances a JOIN governance_risks r ON r.id=a.risk_id
  WHERE a.id=NEW.acceptance_id AND r.id=NEW.risk_id AND r.likelihood_value=NEW.likelihood_value AND r.impact_value=NEW.impact_value
    AND r.title=NEW.title AND r.description=NEW.description)
BEGIN SELECT RAISE(ABORT,'an acceptance snapshot records the risk exactly as it was accepted'); END;
CREATE TRIGGER governance_risk_acceptance_snapshots_immutable BEFORE UPDATE ON governance_risk_acceptance_snapshots
BEGIN SELECT RAISE(ABORT,'an acceptance snapshot is never rewritten'); END;
CREATE TRIGGER governance_risk_acceptance_snapshots_no_delete BEFORE DELETE ON governance_risk_acceptance_snapshots
BEGIN SELECT RAISE(ABORT,'acceptance snapshots are retained'); END;
-- قبول نافذ لا يبقى نافذًا إذا تغيّر الاحتمال أو الأثر أو العنوان أو الوصف أو المالك.
CREATE TRIGGER governance_risks_accept_frozen BEFORE UPDATE ON governance_risks
WHEN OLD.response='accept' AND NEW.response='accept'
  AND (NEW.likelihood_value<>OLD.likelihood_value OR NEW.impact_value<>OLD.impact_value OR NEW.title<>OLD.title
    OR NEW.description<>OLD.description OR NEW.owner_id<>OLD.owner_id)
BEGIN SELECT RAISE(ABORT,'changing an accepted risk returns it to proposed acceptance and needs a new approval'); END;
-- والانتقال إلى القبول النافذ يلزمه لقطة قبول تطابق الخطر كما هو الآن.
CREATE TRIGGER governance_risks_accept_snapshot BEFORE UPDATE ON governance_risks
WHEN NEW.response='accept' AND OLD.response<>'accept'
  -- غياب أي اعتماد يرفضه المحفّز الأصلي governance_risks_accept برسالته؛ هذا يرفض اعتمادًا لا يطابق الحال.
  AND EXISTS(SELECT 1 FROM governance_risk_acceptances a WHERE a.risk_id=NEW.id AND a.owner_id=NEW.owner_id)
  AND NOT EXISTS(SELECT 1 FROM governance_risk_acceptances a JOIN governance_risk_acceptance_snapshots s ON s.acceptance_id=a.id
    WHERE a.risk_id=NEW.id AND a.owner_id=NEW.owner_id AND s.likelihood_value=NEW.likelihood_value AND s.impact_value=NEW.impact_value
      AND s.title=NEW.title AND s.description=NEW.description)
BEGIN SELECT RAISE(ABORT,'an accepted risk needs an acceptance snapshot matching the risk as it stands'); END;

-- أ-2. المعدات: حامل العهدة أو من حجز القطعة بحجز قائم لا يقرّ فقدها.
CREATE TRIGGER equipment_items_lost_not_by_custodian BEFORE UPDATE ON equipment_items
WHEN NEW.status='lost' AND OLD.status<>'lost' AND EXISTS(
  SELECT 1 FROM equipment_bookings b WHERE b.item_id=NEW.id AND b.status IN ('reserved','out')
    AND (b.custodian_id=NEW.lost_confirmed_by OR b.booked_by=NEW.lost_confirmed_by))
BEGIN SELECT RAISE(ABORT,'the custodian or booker of a live booking never confirms the loss of that item'); END;
-- وحجز قائم لا يبقى على قطعة أُقرّ فقدها.
CREATE TRIGGER equipment_bookings_not_on_lost BEFORE UPDATE ON equipment_bookings
WHEN NEW.status IN ('reserved','out') AND (SELECT status FROM equipment_items WHERE id=NEW.item_id)='lost'
BEGIN SELECT RAISE(ABORT,'a booking on a lost item is closed, not kept open'); END;

-- أ-3. الفوترة المتكررة: المسودة لا تُربط إلا بفاتورة لعميلها نفسه (فاتورة ← مطالبة ← سجل تجاري ← ربط العميل).
CREATE TRIGGER billing_drafts_invoice_same_client BEFORE UPDATE ON billing_drafts
WHEN NEW.issued_invoice_id IS NOT NULL AND NEW.issued_invoice_id IS NOT OLD.issued_invoice_id AND NOT EXISTS(
  SELECT 1 FROM tax_invoices i JOIN ar_claims c ON c.id=i.claim_id JOIN client_links l ON l.case_id=c.case_id
  WHERE i.id=NEW.issued_invoice_id AND i.tenant_id=NEW.tenant_id AND l.client_id=NEW.client_id)
BEGIN SELECT RAISE(ABORT,'a billing draft is linked only to an invoice issued to its own client'); END;

-- ===== القسم ج: الموارد البشرية (360 والنبض ودورة الحياة والمزايا) =====

-- ج-1. تقييم 360: الاستجابة كانت تحمل لحظة إرسالها، ولحظة الإرسال نفسها في `review_360_submissions` مع الترشيح،
-- فيربط تطابق الوقت (أو ترتيب rowid مع ترتيب سجل التدقيق) كل نص بكاتبه. الجدول البديل بلا وقت ولا تاريخ ولا rowid،
-- ومفتاحه عشوائي، فلا ترتيب فيه يطابق ترتيب الإرسال. لا عمود مشترك مع جدول الإرسال غير الدورة والمقيَّم.
CREATE TABLE review_360_answers (
  id TEXT PRIMARY KEY CHECK(length(id)>=32),
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  cycle_id TEXT NOT NULL REFERENCES review_cycles(id),
  subject_id TEXT NOT NULL,
  source TEXT NOT NULL CHECK(source IN ('self','peer','upward')),
  strengths TEXT NOT NULL CHECK(length(trim(strengths))>=15),
  improvements TEXT NOT NULL CHECK(length(trim(improvements))>=15),
  FOREIGN KEY(subject_id,tenant_id) REFERENCES users(id,tenant_id)
) STRICT, WITHOUT ROWID;
CREATE INDEX review_360_answers_panel ON review_360_answers(tenant_id,cycle_id,subject_id,source);
CREATE TRIGGER review_360_answers_immutable BEFORE UPDATE ON review_360_answers
BEGIN SELECT RAISE(ABORT,'a submitted 360 response is final'); END;
CREATE TRIGGER review_360_answers_no_delete BEFORE DELETE ON review_360_answers
BEGIN SELECT RAISE(ABORT,'360 responses are retained'); END;
-- البيانات القائمة (مصطنعة) تُنقل بلا وقتها وبمفتاح عشوائي جديد، ثم يُحذف الجدول القديم بما حمله من أوقات وترتيب.
-- يبقى اسمه عرضًا للقراءة فقط فوق الجدول الجديد، بلا عمود وقت، فلا يُكتب فيه ولا يعيد ما حُذف.
INSERT INTO review_360_answers(id,tenant_id,cycle_id,subject_id,source,strengths,improvements)
  SELECT lower(hex(randomblob(16))),tenant_id,cycle_id,subject_id,source,strengths,improvements FROM review_360_responses;
DROP TABLE review_360_responses;
CREATE VIEW review_360_responses AS
  SELECT id,tenant_id,cycle_id,subject_id,source,strengths,improvements FROM review_360_answers;
-- واقعة الإرسال تحمل اليوم لا اللحظة، والقائم منها يُقصّ إلى يومه بتوقيت الرياض.
DROP TRIGGER review_360_submissions_immutable;
UPDATE review_360_submissions SET submitted_at=date(submitted_at,'+3 hours') WHERE length(submitted_at)>10;
CREATE TRIGGER review_360_submissions_immutable BEFORE UPDATE ON review_360_submissions
BEGIN SELECT RAISE(ABORT,'a submission mark is final'); END;
CREATE TRIGGER review_360_submissions_day_only BEFORE INSERT ON review_360_submissions
WHEN NEW.submitted_at NOT GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'
BEGIN SELECT RAISE(ABORT,'a submission mark carries the day, never the instant'); END;

-- ج-2. حد كشف التقييم الصاعد: لا يقل عن ثلاثة، ويُثبَّت في الدورة لحظة فتحها فلا يخفضه قرار لاحق.
CREATE TRIGGER review_360_settings_floor BEFORE INSERT ON review_360_settings
WHEN NEW.min_upward_respondents<3
BEGIN SELECT RAISE(ABORT,'the upward threshold is at least three: with two, one rater subtracts their own text'); END;
CREATE TABLE review_360_cycle_thresholds (
  cycle_id TEXT PRIMARY KEY REFERENCES review_cycles(id),
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  min_upward_respondents INTEGER NOT NULL CHECK(min_upward_respondents BETWEEN 3 AND 20),
  setting_id TEXT REFERENCES review_360_settings(id),
  pinned_on TEXT NOT NULL CHECK(pinned_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]')
) STRICT;
CREATE TRIGGER review_360_cycle_thresholds_immutable BEFORE UPDATE ON review_360_cycle_thresholds
BEGIN SELECT RAISE(ABORT,'a threshold pinned into a cycle is never changed'); END;
CREATE TRIGGER review_360_cycle_thresholds_no_delete BEFORE DELETE ON review_360_cycle_thresholds
BEGIN SELECT RAISE(ABORT,'pinned thresholds are retained'); END;
CREATE TRIGGER review_cycles_pin_upward_threshold AFTER UPDATE OF status ON review_cycles
WHEN OLD.status='draft' AND NEW.status<>'draft'
BEGIN
  INSERT OR IGNORE INTO review_360_cycle_thresholds(cycle_id,tenant_id,min_upward_respondents,setting_id,pinned_on)
    SELECT NEW.id,NEW.tenant_id,max(s.min_upward_respondents,3),s.id,date('now','+3 hours')
    FROM review_360_settings s WHERE s.tenant_id=NEW.tenant_id AND s.superseded_at IS NULL;
END;
-- الدورات المفتوحة قبل هذه الهجرة تُثبَّت على الإعداد الساري الآن، ولا يقل عن ثلاثة.
INSERT INTO review_360_cycle_thresholds(cycle_id,tenant_id,min_upward_respondents,setting_id,pinned_on)
  SELECT c.id,c.tenant_id,max(s.min_upward_respondents,3),s.id,date('now','+3 hours')
  FROM review_cycles c JOIN review_360_settings s ON s.tenant_id=c.tenant_id AND s.superseded_at IS NULL
  WHERE c.status<>'draft';

-- ج-3. استبيان النبض: الحد الأدنى للمستجيبين خمسة، ولا تُغلق الدورة قبل تاريخ إغلاقها.
CREATE TRIGGER survey_privacy_floor BEFORE INSERT ON survey_privacy_settings
WHEN NEW.min_respondents<5
BEGIN SELECT RAISE(ABORT,'the pulse minimum is at least five respondents'); END;
CREATE TRIGGER pulse_cycles_open_floor BEFORE UPDATE ON pulse_cycles
WHEN OLD.status='draft' AND NEW.status='open' AND (NEW.min_respondents IS NULL OR NEW.min_respondents<5)
BEGIN SELECT RAISE(ABORT,'a pulse cycle opens with a minimum of at least five respondents'); END;
CREATE TRIGGER pulse_cycles_no_early_close BEFORE UPDATE ON pulse_cycles
WHEN OLD.status='open' AND NEW.status='closed' AND date('now','+3 hours')<OLD.closes_on
BEGIN SELECT RAISE(ABORT,'a pulse cycle is not closed before its closing date'); END;

-- ج-4. كشوف الوقت: الأسبوع المرسَل ينتظر قرار مديره؛ القفل المجدول لا يسبق القرار.
CREATE TRIGGER timesheet_periods_submitted_not_locked BEFORE UPDATE ON timesheet_periods
WHEN OLD.status='submitted' AND NEW.status='locked'
BEGIN SELECT RAISE(ABORT,'a submitted week awaits its manager decision and is not locked'); END;

-- ج-5. المزايا: المؤمَّن عليه لا يؤكد تسجيله ولا يحذفه، ولا يضيف تابعًا لتسجيله ولا يحذفه، ولو حمل تصريح المزايا.
ALTER TABLE medical_enrolments ADD COLUMN decided_by TEXT REFERENCES users(id);
CREATE TRIGGER medical_enrolments_not_self_decided BEFORE UPDATE ON medical_enrolments
WHEN NEW.status<>OLD.status AND OLD.status<>'removed' AND (NEW.decided_by IS NULL OR NEW.decided_by=NEW.employee_id)
BEGIN SELECT RAISE(ABORT,'an enrolment is confirmed or removed by someone other than the insured employee'); END;
CREATE TRIGGER medical_dependants_not_by_employee BEFORE INSERT ON medical_dependants
WHEN NEW.recorded_by=(SELECT employee_id FROM medical_enrolments WHERE id=NEW.enrolment_id)
BEGIN SELECT RAISE(ABORT,'a dependant is added by someone other than the insured employee'); END;
-- حذف التابع لا يحمل عمود «من حذف» (جدول التابعين مغلق الأعمدة عمدًا كي لا يتسع لبيان طبي)، فمنع حذف المؤمَّن عليه تابعه في الكود.
