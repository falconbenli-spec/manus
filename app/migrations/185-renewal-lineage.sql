-- ترحيل 185 — سلسلة التجديد (الحزمة 4، P4-CRM-6): فرصة التجديد تُفتح من العقد السابق قبل نهايته وتحمل نطاقه وأسعاره،
-- وعقد التجديد يسمّي سابقه مرة واحدة، والفوترة الدورية على عقد لا تتجاوز مدته.
--
-- قبله: «تجديد أو توسعة حساب عميل» (ACC-RENEWAL) طلب نصي بحقل «العميل» و«القيمة»؛ لا يعرف أي عقد يجدّد ولا ما فيه، ولا موعد
-- نهاية يذكّر به أحدًا. وقرار التجديد في سجل العقود («التجديد») يُسجَّل بلا فرصة تتابعه، والجدولة الدورية بلا نهاية تبقى
-- تجهّز مسودات فواتير بعد انتهاء العقد.
--
-- هذا الترحيل:
--   (1) opportunities.kind ('new' أو 'renewal') وrenews_contract_id وrenewal_basis: لقطة نطاق العقد السابق وبنوده وأسعاره لحظة فتح
--       فرصة التجديد. تُكتب عند الإنشاء ولا تتغير؛ والعقد السابق عقدُ عميل الفرصة نفسه. فرصة تجديد قائمة واحدة لكل عقد.
--   (2) contract_records.renews_id: عقد التجديد يسمّي سابقه — عقدًا ساريًا لنفس العميل — وعقد واحد قائم يجدّد كل سابق.
--   (3) contract_renewal_reminders: تذكير التجديد يصل مرة واحدة لكل دورة (العقد، نهاية مدته السارية).
--   (4) billing_schedules.contract_id: الجدولة على عقد تبدأ داخله وتنتهي عند نهاية مدته السارية أو قبلها.
-- لا ملء لصفوف قائمة: الفرص القائمة «new»، والعقود والجداول القائمة بلا سابق ولا عقد، ويحكمها الجديد من اليوم.

/* ───── (1) فرصة التجديد ───── */
ALTER TABLE opportunities ADD COLUMN kind TEXT NOT NULL DEFAULT 'new' CHECK(kind IN ('new','renewal'));
ALTER TABLE opportunities ADD COLUMN renews_contract_id TEXT REFERENCES contract_records(id);
ALTER TABLE opportunities ADD COLUMN renewal_basis TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(renewal_basis) AND json_type(renewal_basis)='object');
-- فرصة تجديد واحدة غير خاسرة لكل عقد: الثانية تُفتح فقط إذا خسرنا الأولى والعقد ما زال ساريًا.
CREATE UNIQUE INDEX opportunities_renewal_once ON opportunities(renews_contract_id) WHERE renews_contract_id IS NOT NULL AND status<>'lost';
CREATE TRIGGER opportunities_renewal_shape BEFORE INSERT ON opportunities
WHEN (NEW.kind='renewal')<>(NEW.renews_contract_id IS NOT NULL)
  OR (NEW.kind='renewal' AND NEW.renewal_basis='{}')
  OR (NEW.renews_contract_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM contract_records c
        WHERE c.id=NEW.renews_contract_id AND c.tenant_id=NEW.tenant_id AND c.party_kind='client' AND c.client_id=NEW.client_id AND c.status='active'))
BEGIN SELECT RAISE(ABORT,'a renewal opportunity renews a contract in force of its own client, and carries what it renews'); END;
CREATE TRIGGER opportunities_renewal_fixed BEFORE UPDATE ON opportunities
WHEN NEW.kind<>OLD.kind OR NEW.renews_contract_id IS NOT OLD.renews_contract_id OR NEW.renewal_basis<>OLD.renewal_basis
BEGIN SELECT RAISE(ABORT,'a renewal opportunity keeps the contract it renews and the scope it copied'); END;

/* ───── (2) عقد التجديد يسمّي سابقه ───── */
ALTER TABLE contract_records ADD COLUMN renews_id TEXT REFERENCES contract_records(id);
-- عقد قائم واحد يجدّد كل سابق (المسودة الملغاة لا تحجز السابق).
CREATE UNIQUE INDEX contract_records_renews_once ON contract_records(renews_id) WHERE renews_id IS NOT NULL AND status<>'cancelled';
CREATE TRIGGER contract_records_renews_same_client BEFORE INSERT ON contract_records
WHEN NEW.renews_id IS NOT NULL AND (NEW.renews_id=NEW.id OR NEW.party_kind<>'client' OR NOT EXISTS(SELECT 1 FROM contract_records p
  WHERE p.id=NEW.renews_id AND p.tenant_id=NEW.tenant_id AND p.party_kind='client' AND p.client_id=NEW.client_id AND p.status='active'))
BEGIN SELECT RAISE(ABORT,'a renewal contract renews a contract in force of the same client'); END;
CREATE TRIGGER contract_records_renews_same_client_update BEFORE UPDATE OF renews_id,client_id,party_kind ON contract_records
WHEN NEW.renews_id IS NOT NULL AND (NEW.renews_id=NEW.id OR NEW.party_kind<>'client' OR NOT EXISTS(SELECT 1 FROM contract_records p
  WHERE p.id=NEW.renews_id AND p.tenant_id=NEW.tenant_id AND p.party_kind='client' AND p.client_id=NEW.client_id AND p.status='active'))
BEGIN SELECT RAISE(ABORT,'a renewal contract renews a contract in force of the same client'); END;
CREATE TRIGGER contract_records_renews_fixed BEFORE UPDATE ON contract_records
WHEN OLD.status<>'draft' AND NEW.renews_id IS NOT OLD.renews_id
BEGIN SELECT RAISE(ABORT,'a contract in force keeps the contract it renews'); END;

/* ───── (3) تذكير التجديد مرة لكل دورة ───── */
CREATE TABLE contract_renewal_reminders (
  contract_id TEXT NOT NULL,
  tenant_id TEXT NOT NULL,
  term_end_date TEXT NOT NULL CHECK(term_end_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  window_opened_on TEXT NOT NULL CHECK(window_opened_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  recipients TEXT NOT NULL CHECK(json_valid(recipients) AND json_type(recipients)='array'),
  sent_at TEXT NOT NULL,
  PRIMARY KEY(contract_id,term_end_date),
  FOREIGN KEY(contract_id,tenant_id) REFERENCES contract_records(id,tenant_id)
) STRICT;
CREATE TRIGGER contract_renewal_reminders_fixed BEFORE UPDATE ON contract_renewal_reminders
BEGIN SELECT RAISE(ABORT,'a renewal reminder is a record of what was sent'); END;
CREATE TRIGGER contract_renewal_reminders_no_delete BEFORE DELETE ON contract_renewal_reminders
BEGIN SELECT RAISE(ABORT,'a renewal reminder is a record of what was sent'); END;

/* ───── (4) الجدولة الدورية داخل مدة عقدها ───── */
ALTER TABLE billing_schedules ADD COLUMN contract_id TEXT REFERENCES contract_records(id);
-- المدة السارية = نهاية العقد أو آخر تمديد بملحق مؤكَّد (كما يحسبها app/contracts-register.mjs effective()).
CREATE TRIGGER billing_schedules_within_contract BEFORE INSERT ON billing_schedules
WHEN NEW.contract_id IS NOT NULL AND (NEW.end_date IS NULL OR NOT EXISTS(SELECT 1 FROM contract_records c
  WHERE c.id=NEW.contract_id AND c.tenant_id=NEW.tenant_id AND c.party_kind='client' AND c.client_id=NEW.client_id AND c.status='active'
    AND NEW.start_date>=c.start_date
    AND NEW.end_date<=max(c.end_date,COALESCE((SELECT MAX(a.new_end_date) FROM contract_amendments a WHERE a.contract_id=c.id AND a.confirmed_at IS NOT NULL),c.end_date))))
BEGIN SELECT RAISE(ABORT,'a billing schedule on a contract starts inside it and ends no later than its term'); END;
CREATE TRIGGER billing_schedules_within_contract_update BEFORE UPDATE OF end_date,contract_id ON billing_schedules
WHEN NEW.contract_id IS NOT OLD.contract_id
  OR (NEW.contract_id IS NOT NULL AND (NEW.end_date IS NULL OR NEW.end_date>OLD.end_date))
BEGIN SELECT RAISE(ABORT,'a billing schedule keeps its contract, and its end only moves earlier'); END;
