-- سجل عقود الوكالة التجارية: العملاء والموردون والمستقلون وتراخيص البرمجيات.
-- ليس عقود الموظفين — تلك في 025-hr-contracts ولا علاقة لهذا السجل بها.
-- لا توقيع إلكتروني هنا ولا حجية نظامية: التوقيع يتم خارج المنصة لدى مزوّد مرخّص،
-- وهذا السجل يحفظ مكان حفظ الأصل الموقّع ومن وقّعه ومتى، ويذكّر بالمواعيد، لا أكثر.
CREATE TABLE contract_records (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  number TEXT NOT NULL,
  party_kind TEXT NOT NULL CHECK(party_kind IN ('client','vendor','freelancer','other')),
  client_id TEXT REFERENCES clients(id),
  vendor_id TEXT REFERENCES vendors(id),
  party_name TEXT NOT NULL DEFAULT '',
  contract_type TEXT NOT NULL CHECK(contract_type IN ('master_services','statement_of_work','retainer','nda','software_license','freelance','other')),
  subject TEXT NOT NULL CHECK(length(trim(subject))>=5),
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL CHECK(end_date>=start_date),
  value_minor INTEGER CHECK(value_minor IS NULL OR value_minor>0),
  -- المنصة أحادية العملة (هللات وريال). العقد بعملة أخرى يحتاج قرار المالك ودعمًا على مستوى المنصة، فلا يُسجَّل مبلغه هنا.
  currency TEXT NOT NULL DEFAULT 'SAR' CHECK(currency='SAR'),
  auto_renew INTEGER NOT NULL CHECK(auto_renew IN (0,1)),
  notice_days INTEGER CHECK(notice_days IS NULL OR notice_days BETWEEN 1 AND 365),
  renewal_note TEXT NOT NULL DEFAULT '',
  scope_baseline_id TEXT REFERENCES scope_baselines(id),
  owner_id TEXT NOT NULL,
  original_location TEXT NOT NULL CHECK(length(trim(original_location))>=5),
  signed_for_company TEXT NOT NULL DEFAULT '',
  signed_for_party TEXT NOT NULL DEFAULT '',
  signed_on TEXT,
  status TEXT NOT NULL CHECK(status IN ('draft','cancelled','active','terminated')),
  activated_by TEXT,
  activated_at TEXT,
  terminated_by TEXT,
  terminated_at TEXT,
  termination_note TEXT NOT NULL DEFAULT '',
  created_by TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(id,tenant_id),
  UNIQUE(tenant_id,number),
  FOREIGN KEY(owner_id,tenant_id) REFERENCES users(id,tenant_id),
  FOREIGN KEY(created_by,tenant_id) REFERENCES users(id,tenant_id),
  FOREIGN KEY(activated_by,tenant_id) REFERENCES users(id,tenant_id),
  FOREIGN KEY(terminated_by,tenant_id) REFERENCES users(id,tenant_id),
  -- من يسجّل العقد لا يكون مالكه ولا يضعه في حيز السريان: السريان قرار المالك المسمى.
  CHECK(owner_id<>created_by),
  CHECK(activated_by IS NULL OR activated_by<>created_by),
  CHECK((status IN ('active','terminated'))=(activated_by IS NOT NULL)),
  CHECK((activated_by IS NULL)=(activated_at IS NULL)),
  CHECK((status='terminated')=(terminated_by IS NOT NULL)),
  CHECK((terminated_by IS NULL)=(terminated_at IS NULL)),
  -- تجديد تلقائي بلا مهلة إشعار معروفة = فخ: العقد يتجدد رغمًا عن الشركة ولا أحد يعرف متى كان بالإمكان منعه.
  CHECK((auto_renew=1)=(notice_days IS NOT NULL)),
  CHECK(CASE party_kind
    WHEN 'client' THEN client_id IS NOT NULL AND vendor_id IS NULL
    WHEN 'vendor' THEN vendor_id IS NOT NULL AND client_id IS NULL
    ELSE client_id IS NULL AND vendor_id IS NULL AND length(trim(party_name))>=3 END),
  -- خط أساس النطاق عقد مع عميل بطبيعته.
  CHECK(scope_baseline_id IS NULL OR client_id IS NOT NULL)
) STRICT;
CREATE TRIGGER contract_records_versioned BEFORE UPDATE ON contract_records
WHEN NEW.version<>OLD.version+1 BEGIN SELECT RAISE(ABORT,'stale contract'); END;
-- العقد الساري لا يُعدَّل: تعديله ملحق مرقّم بتاريخه ومن اعتمده. المسودة وحدها قابلة للتصحيح.
CREATE TRIGGER contract_records_in_force_not_edited BEFORE UPDATE ON contract_records
WHEN OLD.status<>'draft' AND (
  NEW.number<>OLD.number OR NEW.party_kind<>OLD.party_kind OR NEW.client_id IS NOT OLD.client_id OR NEW.vendor_id IS NOT OLD.vendor_id
  OR NEW.party_name<>OLD.party_name OR NEW.contract_type<>OLD.contract_type OR NEW.subject<>OLD.subject
  OR NEW.start_date<>OLD.start_date OR NEW.end_date<>OLD.end_date OR NEW.value_minor IS NOT OLD.value_minor
  OR NEW.auto_renew<>OLD.auto_renew OR NEW.notice_days IS NOT OLD.notice_days OR NEW.scope_baseline_id IS NOT OLD.scope_baseline_id
  OR NEW.owner_id<>OLD.owner_id OR NEW.original_location<>OLD.original_location
  OR NEW.signed_for_company<>OLD.signed_for_company OR NEW.signed_for_party<>OLD.signed_for_party OR NEW.signed_on IS NOT OLD.signed_on)
BEGIN SELECT RAISE(ABORT,'a contract in force is amended by a numbered annex, never edited'); END;
CREATE TRIGGER contract_records_no_delete BEFORE DELETE ON contract_records BEGIN SELECT RAISE(ABORT,'contracts are retained'); END;
CREATE INDEX contract_records_term ON contract_records(tenant_id,status,end_date);

-- الملحق: رقمه وتاريخه ومن اعتمده، وأثره على القيمة والمدة ظاهر لا مدفون في نص.
-- من سجّل الملحق لا يؤكده؛ التأكيد لمن اعتمده، وقبل التأكيد لا أثر له على العقد.
CREATE TABLE contract_amendments (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  contract_id TEXT NOT NULL,
  number INTEGER NOT NULL CHECK(number>0),
  signed_on TEXT NOT NULL,
  subject TEXT NOT NULL CHECK(length(trim(subject))>=5),
  value_delta_minor INTEGER NOT NULL DEFAULT 0,
  new_end_date TEXT,
  original_location TEXT NOT NULL CHECK(length(trim(original_location))>=5),
  approved_by TEXT NOT NULL,
  recorded_by TEXT NOT NULL,
  recorded_at TEXT NOT NULL,
  confirmed_by TEXT,
  confirmed_at TEXT,
  confirmation_note TEXT NOT NULL DEFAULT '',
  UNIQUE(contract_id,number),
  FOREIGN KEY(contract_id,tenant_id) REFERENCES contract_records(id,tenant_id),
  FOREIGN KEY(approved_by,tenant_id) REFERENCES users(id,tenant_id),
  FOREIGN KEY(recorded_by,tenant_id) REFERENCES users(id,tenant_id),
  CHECK(approved_by<>recorded_by),
  CHECK(confirmed_by IS NULL OR confirmed_by=approved_by),
  CHECK((confirmed_by IS NULL)=(confirmed_at IS NULL))
) STRICT;
CREATE TRIGGER contract_amendments_confirmed_fixed BEFORE UPDATE ON contract_amendments
WHEN OLD.confirmed_by IS NOT NULL OR NEW.number<>OLD.number OR NEW.signed_on<>OLD.signed_on OR NEW.subject<>OLD.subject
  OR NEW.value_delta_minor<>OLD.value_delta_minor OR NEW.new_end_date IS NOT OLD.new_end_date
  OR NEW.approved_by<>OLD.approved_by OR NEW.recorded_by<>OLD.recorded_by OR NEW.contract_id<>OLD.contract_id
BEGIN SELECT RAISE(ABORT,'an annex is confirmed once and never rewritten'); END;
CREATE TRIGGER contract_amendments_no_delete BEFORE DELETE ON contract_amendments BEGIN SELECT RAISE(ABORT,'annexes are retained'); END;

-- قرار التجديد لدورة بعينها. «عدم التجديد» بلا مرجع إشعار مُرسَل لا يساوي شيئًا:
-- الإشعار يُرسَل خارج المنصة، وما يُسجَّل هنا مرجعه لا إرساله.
CREATE TABLE contract_renewal_decisions (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  contract_id TEXT NOT NULL,
  term_end_date TEXT NOT NULL,
  notice_deadline TEXT,
  decision TEXT NOT NULL CHECK(decision IN ('renew','do_not_renew','renegotiate')),
  notice_reference TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL CHECK(length(trim(note))>=10),
  decided_by TEXT NOT NULL,
  decided_at TEXT NOT NULL,
  UNIQUE(contract_id,term_end_date),
  FOREIGN KEY(contract_id,tenant_id) REFERENCES contract_records(id,tenant_id),
  FOREIGN KEY(decided_by,tenant_id) REFERENCES users(id,tenant_id),
  CHECK(decision<>'do_not_renew' OR length(trim(notice_reference))>=5)
) STRICT;
CREATE TRIGGER contract_renewal_decisions_fixed BEFORE UPDATE ON contract_renewal_decisions
BEGIN SELECT RAISE(ABORT,'a renewal decision is recorded once'); END;
CREATE TRIGGER contract_renewal_decisions_no_delete BEFORE DELETE ON contract_renewal_decisions
BEGIN SELECT RAISE(ABORT,'renewal decisions are retained'); END;

-- الالتزامات المستخرجة من العقد. الاستخراج يدوي بإدخال إنسان قرأ البند:
-- عمود extraction مقفل على 'manual' حتى لا يتسلل بند مستخرج آليًا ويُقرأ كأن إنسانًا أقرّه.
CREATE TABLE contract_obligations (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  contract_id TEXT NOT NULL,
  category TEXT NOT NULL CHECK(category IN ('deliverable','report','insurance','confidentiality','liability_cap','payment','data_protection','other')),
  title TEXT NOT NULL CHECK(length(trim(title))>=5),
  clause_reference TEXT NOT NULL CHECK(length(trim(clause_reference))>=1),
  detail TEXT NOT NULL DEFAULT '',
  owner_id TEXT NOT NULL,
  cadence TEXT NOT NULL CHECK(cadence IN ('once','monthly','quarterly','yearly')),
  first_due_date TEXT NOT NULL,
  evidence_expected TEXT NOT NULL CHECK(length(trim(evidence_expected))>=5),
  extraction TEXT NOT NULL DEFAULT 'manual' CHECK(extraction='manual'),
  entered_by TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
  version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(id,tenant_id),
  UNIQUE(contract_id,title),
  FOREIGN KEY(contract_id,tenant_id) REFERENCES contract_records(id,tenant_id),
  FOREIGN KEY(owner_id,tenant_id) REFERENCES users(id,tenant_id),
  FOREIGN KEY(entered_by,tenant_id) REFERENCES users(id,tenant_id)
) STRICT;
CREATE TRIGGER contract_obligations_versioned BEFORE UPDATE ON contract_obligations
WHEN NEW.version<>OLD.version+1 OR NEW.contract_id<>OLD.contract_id OR NEW.title<>OLD.title OR NEW.clause_reference<>OLD.clause_reference
  OR NEW.cadence<>OLD.cadence OR NEW.first_due_date<>OLD.first_due_date OR NEW.extraction<>OLD.extraction
BEGIN SELECT RAISE(ABORT,'an obligation keeps its clause, cadence and first due date: it is deactivated and re-entered, not rewritten'); END;
CREATE TRIGGER contract_obligations_no_delete BEFORE DELETE ON contract_obligations
BEGIN SELECT RAISE(ABORT,'obligations are deactivated, not deleted'); END;
CREATE INDEX contract_obligations_owner ON contract_obligations(tenant_id,owner_id,active);

-- دليل التنفيذ لكل استحقاق، يتحقق منه شخص غير من نفّذ.
CREATE TABLE contract_obligation_fulfilments (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  obligation_id TEXT NOT NULL,
  period TEXT NOT NULL,
  due_date TEXT NOT NULL,
  completed_by TEXT NOT NULL,
  completed_at TEXT NOT NULL,
  evidence_reference TEXT NOT NULL CHECK(length(trim(evidence_reference))>=5),
  verified_by TEXT,
  verified_at TEXT,
  verification_note TEXT NOT NULL DEFAULT '',
  UNIQUE(obligation_id,period),
  FOREIGN KEY(obligation_id,tenant_id) REFERENCES contract_obligations(id,tenant_id),
  FOREIGN KEY(completed_by,tenant_id) REFERENCES users(id,tenant_id),
  FOREIGN KEY(verified_by,tenant_id) REFERENCES users(id,tenant_id),
  CHECK(verified_by IS NULL OR verified_by<>completed_by),
  CHECK((verified_by IS NULL)=(verified_at IS NULL))
) STRICT;
CREATE TRIGGER contract_fulfilments_fixed BEFORE UPDATE ON contract_obligation_fulfilments
WHEN OLD.verified_by IS NOT NULL OR NEW.period<>OLD.period OR NEW.evidence_reference<>OLD.evidence_reference
  OR NEW.completed_by<>OLD.completed_by OR NEW.obligation_id<>OLD.obligation_id
BEGIN SELECT RAISE(ABORT,'a fulfilment is verified once and never rewritten'); END;
CREATE TRIGGER contract_fulfilments_no_delete BEFORE DELETE ON contract_obligation_fulfilments
BEGIN SELECT RAISE(ABORT,'fulfilments are retained'); END;

-- مهل التنبيه إعداد يدخله المالك بسنده، لا قيمة في الكود. قبل ضبطها لا تصدر المنصة تنبيهًا واحدًا،
-- ولا تدّعي أنها تراقب مواعيد لم يقل لها أحد متى تنبّه لها.
CREATE TABLE contract_alert_settings (
  tenant_id TEXT PRIMARY KEY REFERENCES tenants(id),
  expiry_lead_days INTEGER NOT NULL CHECK(expiry_lead_days BETWEEN 1 AND 365),
  notice_lead_days INTEGER NOT NULL CHECK(notice_lead_days BETWEEN 1 AND 365),
  obligation_lead_days INTEGER NOT NULL CHECK(obligation_lead_days BETWEEN 1 AND 365),
  basis TEXT NOT NULL CHECK(length(trim(basis))>=10),
  set_by TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),
  updated_at TEXT NOT NULL,
  FOREIGN KEY(set_by,tenant_id) REFERENCES users(id,tenant_id)
) STRICT;
CREATE TRIGGER contract_alert_settings_versioned BEFORE UPDATE ON contract_alert_settings
WHEN NEW.version<>OLD.version+1 BEGIN SELECT RAISE(ABORT,'stale alert settings'); END;
CREATE TRIGGER contract_alert_settings_no_delete BEFORE DELETE ON contract_alert_settings
BEGIN SELECT RAISE(ABORT,'alert settings are retained'); END;
