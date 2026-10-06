-- الأثر الرجعي (PAY-04): المسير المعتمد لا يُعاد فتحه. الفرق بين ما صُرف وما تستحقه العقود والغياب كما هي اليوم
-- يدخل شهرًا لاحقًا بحركة مقترحة يعتمدها شخص آخر، ويحفظ هذا السجل مصدر الفرق فلا يُقترح مرتين.
CREATE TABLE payroll_retro (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  user_id TEXT NOT NULL,
  source_month TEXT NOT NULL CHECK(source_month GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]'),
  source_run_id TEXT NOT NULL REFERENCES payroll_runs(id),
  difference_minor INTEGER NOT NULL CHECK(difference_minor<>0),
  adjustment_id TEXT NOT NULL UNIQUE REFERENCES payroll_adjustments(id),
  basis TEXT NOT NULL CHECK(json_valid(basis)),
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL,
  FOREIGN KEY(user_id,tenant_id) REFERENCES users(id,tenant_id),
  CHECK(created_by<>user_id)
) STRICT;
CREATE INDEX payroll_retro_source ON payroll_retro(user_id,source_month);
CREATE TRIGGER payroll_retro_no_update BEFORE UPDATE ON payroll_retro BEGIN SELECT RAISE(ABORT,'retro records are immutable'); END;
CREATE TRIGGER payroll_retro_no_delete BEFORE DELETE ON payroll_retro BEGIN SELECT RAISE(ABORT,'retro records are retained'); END;
