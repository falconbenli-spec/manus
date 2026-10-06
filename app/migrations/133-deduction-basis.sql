-- ترحيل 133 — م51 من النسخة الموقعة من لائحة تنظيم العمل (شهادة 351743، ص 19)، «الحسومات من أجر العامل»:
-- «لا يجوز حسم أي مبلغ من أجور العامل لقاء حقوقه دون موافقة خطيّة منه الا في الحلالات التالية:» ثم ست حالات مرقمة 1- إلى 6-
-- (استرداد قروض صاحب العمل بحد 10% من الأجر؛ اشتراكات التأمينات الاجتماعية؛ اشتراكات صندوق الادخار وقروضه؛ أقساط مشروع المساكن أو أي مزية
-- أخرى؛ الغرامات وما أتلفه العامل؛ دين بحكم قضائي بحد ربع الأجر المستحق شهريًا ما لم يتضمن الحكم خلاف ذلك). الأخطاء المطبعية في الأصل تُنقل كما هي.
-- كانت حركة «خصم» تُقترح بسبب حر وحده. صار لكل حركة خصم سندٌ واحد مسجَّل مرة واحدة:
--   consent          موافقة العامل الخطية، تُسجَّل إلكترونيًا بهويته ووقتها ونصها كما تُسجَّل في طلبات المزايا (secondment-benefits)؛ فارغة حتى يقر.
--   exception        إحدى الحالات الست بترقيمها المطبوع (fine وdamage كلتاهما البند 5) مع سندها.
--   not_a_deduction  أجر غير مستحق أصلًا (أيام إجازة بلا أجر أو بأجر جزئي بحسب سياسة الإجازات المعتمدة): ليس حسمًا لقاء حقوق فلا تحكمه م51، ويُقال ذلك.
--   legacy           حركة اقتُرحت قبل هذا الترحيل: تبقى تعمل كما كانت، ويُكتب أنها سبقت اشتراط السند.
-- لا يُعدَّل جدول حركات الرواتب ولا جدول التصنيف (102): الصف هنا يُضاف بجوارهما، وما صُنِّف من قبل (حكم قضائي، غرامة، قرض) يُقرأ استثناءً بصنفه.
CREATE TABLE payroll_deduction_basis (
  adjustment_id TEXT PRIMARY KEY REFERENCES payroll_adjustments(id),
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  basis TEXT NOT NULL CHECK(basis IN ('consent','exception','not_a_deduction','legacy')),
  exception_case TEXT CHECK(exception_case IS NULL OR exception_case IN ('employer_loan','social_insurance','savings_fund','housing_instalment','fine','damage','court_order')),
  reference TEXT NOT NULL DEFAULT '',
  consent_text TEXT,
  consent_by TEXT REFERENCES users(id),
  consent_at TEXT,
  recorded_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL,
  CHECK((basis='exception')=(exception_case IS NOT NULL)),
  CHECK(basis<>'exception' OR length(trim(reference))>=3),
  CHECK((consent_at IS NULL)=(consent_by IS NULL) AND (consent_at IS NULL)=(consent_text IS NULL)),
  CHECK(basis='consent' OR consent_at IS NULL)
) STRICT;
-- السند يُكتب مرة واحدة؛ الشيء الوحيد الذي يُضاف بعده هو موافقة العامل، مرة واحدة، على سند «موافقة» لم تُسجل موافقته بعد.
CREATE TRIGGER payroll_deduction_basis_fixed BEFORE UPDATE ON payroll_deduction_basis
WHEN NOT (OLD.basis='consent' AND OLD.consent_at IS NULL AND NEW.consent_at IS NOT NULL AND NEW.consent_by IS NOT NULL AND NEW.consent_text IS NOT NULL
  AND NEW.basis=OLD.basis AND NEW.adjustment_id=OLD.adjustment_id AND NEW.tenant_id=OLD.tenant_id AND NEW.exception_case IS OLD.exception_case
  AND NEW.reference=OLD.reference AND NEW.recorded_by=OLD.recorded_by AND NEW.created_at=OLD.created_at)
BEGIN SELECT RAISE(ABORT,'a deduction basis is recorded once; only the worker consent is added, once'); END;
CREATE TRIGGER payroll_deduction_basis_no_delete BEFORE DELETE ON payroll_deduction_basis BEGIN SELECT RAISE(ABORT,'deduction bases are retained'); END;
-- الموافقة تُسجَّل بهوية صاحب الأجر وحده: لا يوافق أحد عن العامل.
CREATE TRIGGER payroll_deduction_basis_consent_owner BEFORE UPDATE OF consent_by ON payroll_deduction_basis
WHEN NEW.consent_by IS NOT NULL AND NEW.consent_by<>(SELECT user_id FROM payroll_adjustments WHERE id=NEW.adjustment_id)
BEGIN SELECT RAISE(ABORT,'the worker consents to a deduction from his own wage; nobody consents for him'); END;
CREATE INDEX payroll_deduction_basis_pending ON payroll_deduction_basis(tenant_id,basis) WHERE basis='consent' AND consent_at IS NULL;

-- ما سبق هذا الترحيل: المصنَّف (102) يُقرأ استثناءً بصنفه وسنده، وما عداه «سبق اشتراط السند» فيبقى يعمل كما كان.
INSERT INTO payroll_deduction_basis(adjustment_id,tenant_id,basis,exception_case,reference,recorded_by,created_at)
  SELECT a.id,a.tenant_id,'exception',c.class,c.reference,c.created_by,strftime('%Y-%m-%dT%H:%M:%fZ','now')
  FROM payroll_adjustments a JOIN payroll_adjustment_classes c ON c.adjustment_id=a.id
  WHERE a.kind='deduction' AND c.class IN ('court_order','fine','employer_loan');
INSERT INTO payroll_deduction_basis(adjustment_id,tenant_id,basis,reference,recorded_by,created_at)
  SELECT a.id,a.tenant_id,'legacy','اقتُرحت قبل اشتراط سند م51 (الترحيل 133)؛ تبقى كما كانت',a.proposed_by,strftime('%Y-%m-%dT%H:%M:%fZ','now')
  FROM payroll_adjustments a WHERE a.kind='deduction' AND NOT EXISTS(SELECT 1 FROM payroll_deduction_basis b WHERE b.adjustment_id=a.id);
