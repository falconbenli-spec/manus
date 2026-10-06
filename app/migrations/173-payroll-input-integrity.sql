-- الحزمة 4 (P4-HR-2): سلامة مدخلات المسير.
--
-- (1) بصمة المدخلات. كان الاحتساب يكتب السطور ولا يحفظ على أي مدخلات قام؛ فغيابٌ يُعتمد بعد الاحتساب، أو حركةٌ تُعتمد، أو إجازةٌ
--     تُلغى، تترك مسيرًا قيد المراجعة يُعتمد على سطور قديمة. صار الاحتساب يحفظ بصمة ما استعمله فعلًا (inputs_digest) وبصمة كل صنف
--     منه (inputs_parts: الغياب، والحركات، وآثار الإجازات، والمزايا، والعقود، وقواعد التأمينات والتقريب)، ويُعاد حسابها عند التقديم
--     والمراجعة والاعتماد: إن اختلفت امتنع الإجراء باسم ما تغيّر حتى يُعاد الاحتساب. والبصمة تتغير في المسودة وحدها، كالمجاميع.
--     المسيرات التي سبقت هذا الترحيل بلا بصمة: لا يُعرف على أي مدخلات احتُسبت، فيُعاد احتسابها مرة قبل تقديمها أو اعتمادها.
ALTER TABLE payroll_runs ADD COLUMN inputs_digest TEXT;
ALTER TABLE payroll_runs ADD COLUMN inputs_parts TEXT;
DROP TRIGGER payroll_runs_locked;
CREATE TRIGGER payroll_runs_locked BEFORE UPDATE ON payroll_runs
WHEN OLD.status IN ('approved','cancelled') OR NEW.version<>OLD.version+1 OR NEW.month<>OLD.month OR NEW.prepared_by<>OLD.prepared_by OR NEW.tenant_id<>OLD.tenant_id
  OR (OLD.status<>'draft' AND (NEW.gross_minor<>OLD.gross_minor OR NEW.deductions_minor<>OLD.deductions_minor OR NEW.headcount<>OLD.headcount
    OR NEW.inputs_digest IS NOT OLD.inputs_digest OR NEW.inputs_parts IS NOT OLD.inputs_parts))
  OR (NEW.inputs_parts IS NOT NULL AND NOT json_valid(NEW.inputs_parts))
BEGIN SELECT RAISE(ABORT,'an approved payroll run is locked; totals and the digest of its inputs change only in draft'); END;

-- (2) ردّ خصم إجازة دُفع ثم أُلغيت الإجازة. كان السحب يكتب ملاحظة وحدها، فيبقى الأجر مخصومًا عن إجازة لم تُؤخذ.
--     صار السحب يقترح حركة إضافة واحدة بالمبلغ نفسه في أول شهر مسيره مفتوح، يعتمدها معتمد الرواتب. ردٌّ واحد لكل أثر (المفتاح)،
--     ولكل خصم، ولكل حركة ردّ؛ والرد لأثرٍ سُحب، عن خصمه هو، وحركته إضافة لصاحب الخصم بمبلغه. لا يُعدَّل ولا يُحذف.
CREATE TABLE leave_pay_effect_refunds (
  effect_id TEXT PRIMARY KEY REFERENCES leave_pay_effects(id),
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  deduction_id TEXT NOT NULL UNIQUE REFERENCES payroll_adjustments(id),
  paid_run_id TEXT NOT NULL REFERENCES payroll_runs(id),
  refund_id TEXT NOT NULL UNIQUE REFERENCES payroll_adjustments(id),
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL,
  CHECK(refund_id<>deduction_id)
) STRICT;
CREATE TRIGGER leave_pay_effect_refunds_shape BEFORE INSERT ON leave_pay_effect_refunds
WHEN NOT EXISTS(SELECT 1 FROM leave_pay_effects e WHERE e.id=NEW.effect_id AND e.tenant_id=NEW.tenant_id AND e.status='withdrawn' AND e.adjustment_id=NEW.deduction_id)
  OR NOT EXISTS(SELECT 1 FROM payroll_adjustments d JOIN payroll_runs x ON x.id=d.run_id WHERE d.id=NEW.deduction_id AND d.status='approved' AND d.kind='deduction' AND x.id=NEW.paid_run_id AND x.status='approved')
  OR NOT EXISTS(SELECT 1 FROM payroll_adjustments r JOIN payroll_adjustments d ON d.id=NEW.deduction_id WHERE r.id=NEW.refund_id AND r.kind='allowance' AND r.user_id=d.user_id AND r.amount_minor=d.amount_minor AND r.tenant_id=NEW.tenant_id)
BEGIN SELECT RAISE(ABORT,'a leave refund returns the paid deduction of a withdrawn effect to its owner, once and in full'); END;
CREATE TRIGGER leave_pay_effect_refunds_fixed BEFORE UPDATE ON leave_pay_effect_refunds BEGIN SELECT RAISE(ABORT,'a leave refund is written once'); END;
CREATE TRIGGER leave_pay_effect_refunds_no_delete BEFORE DELETE ON leave_pay_effect_refunds BEGIN SELECT RAISE(ABORT,'leave refunds are retained'); END;
