-- الترحيل 167: اكتمال الأستاذ العام (الحزمة 3 — من المستند إلى القيد، وتتبّع كل مبلغ).
--
-- (1) حدث السحب من الدفعة المقدمة. السحب الواحد يُسحب جزئيًا ثم كاملًا (advance_draws.applied_minor يتقدّم ولا يرجع،
--     الترحيل 051)، والجدول يحفظ المجموع وحده. الدفتر يحتاج كل تطبيق بمبلغه وتاريخه ليبني قيده مرة واحدة، فيلتقطه
--     محفّزٌ من التحديث نفسه: لا يمرّ سحبٌ بلا حدث، ولا تُعدَّل وحدة الفوترة الدورية. المعرّف «السحب.المجموع» حتمي،
--     والمجموع يتقدّم فقط، فلا يتكرر حدث. وما سُحب قبل هذا الترحيل حدثٌ افتتاحي واحد لكل سحب بتاريخ آخر تحديث له.
CREATE TABLE advance_draw_applications (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  draw_id TEXT NOT NULL REFERENCES advance_draws(id),
  advance_id TEXT NOT NULL REFERENCES advance_invoices(id),
  amount_minor INTEGER NOT NULL CHECK(amount_minor>0),
  cumulative_minor INTEGER NOT NULL CHECK(cumulative_minor>=amount_minor),
  applied_at TEXT NOT NULL,
  origin TEXT NOT NULL CHECK(origin IN ('applied','opening_balance')),
  created_at TEXT NOT NULL,
  UNIQUE(draw_id,cumulative_minor)
) STRICT;
CREATE INDEX advance_draw_applications_scope ON advance_draw_applications(tenant_id,applied_at);
CREATE INDEX advance_draw_applications_advance ON advance_draw_applications(advance_id);
-- الحدث مرآة سحبه: الكيان والدفعة نفسهما، ومجموعه هو المسحوب من السحب لحظة الكتابة. لا حدث يُكتب باليد خارج ذلك.
CREATE TRIGGER advance_draw_applications_mirror BEFORE INSERT ON advance_draw_applications
WHEN NOT EXISTS(SELECT 1 FROM advance_draws d WHERE d.id=NEW.draw_id AND d.tenant_id=NEW.tenant_id AND d.advance_id=NEW.advance_id AND d.applied_minor=NEW.cumulative_minor)
BEGIN SELECT RAISE(ABORT,'a draw application mirrors its draw'); END;
CREATE TRIGGER advance_draw_applications_capture AFTER UPDATE OF applied_minor ON advance_draws
WHEN NEW.applied_minor>OLD.applied_minor
BEGIN
  INSERT INTO advance_draw_applications(id,tenant_id,draw_id,advance_id,amount_minor,cumulative_minor,applied_at,origin,created_at)
  VALUES(NEW.id||'.'||NEW.applied_minor,NEW.tenant_id,NEW.id,NEW.advance_id,NEW.applied_minor-OLD.applied_minor,NEW.applied_minor,NEW.updated_at,'applied',NEW.updated_at);
END;
INSERT INTO advance_draw_applications(id,tenant_id,draw_id,advance_id,amount_minor,cumulative_minor,applied_at,origin,created_at)
SELECT id||'.'||applied_minor,tenant_id,id,advance_id,applied_minor,applied_minor,updated_at,'opening_balance',updated_at FROM advance_draws WHERE applied_minor>0;
CREATE TRIGGER advance_draw_applications_no_update BEFORE UPDATE ON advance_draw_applications BEGIN SELECT RAISE(ABORT,'a draw application is a fact; it is never edited'); END;
CREATE TRIGGER advance_draw_applications_no_delete BEFORE DELETE ON advance_draw_applications BEGIN SELECT RAISE(ABORT,'a draw application is a fact; it is never deleted'); END;

-- (2) فاتورة المورد مصدرًا للدفتر، والمستحق الواحد قيد واحد. قيدها هو قيد المستحق نفسه: هويته procurement_payable ورابطه
--     في finance_payable_links كما كان يكتبهما المسار اليدوي، فالقيد الفريد (tenant_id,source_kind,source_id) والمفتاح
--     payable_id يمنعان قيدًا ثانيًا بأي من المسارين. وهذا المحفّز يمنع ما يبقى: رابطُ مصدرٍ لفاتورة مورد على قيدٍ ليس قيد
--     مستحقها — أيًّا كان كاتبه، الكود أو إدخال مباشر.
CREATE TRIGGER finance_source_links_supplier_invoice BEFORE INSERT ON finance_source_links
WHEN NEW.source_kind='supplier_invoice' AND NOT EXISTS(
  SELECT 1 FROM finance_payable_links l JOIN finance_journals j ON j.id=l.journal_id
  WHERE l.payable_id=NEW.source_id AND l.journal_id=NEW.journal_id AND j.tenant_id=NEW.tenant_id AND j.source_kind='procurement_payable' AND j.source_id=NEW.source_id)
BEGIN SELECT RAISE(ABORT,'a supplier invoice posts through its own payable link only: the payable already has a journal on another path, or this journal is not its payable journal'); END;

-- (3) رابط المصدر لقيد كيانه: كان الكود وحده يضمن أن كيان الرابط كيان القيد.
CREATE TRIGGER finance_source_links_tenant BEFORE INSERT ON finance_source_links
WHEN NOT EXISTS(SELECT 1 FROM finance_journals WHERE id=NEW.journal_id AND tenant_id=NEW.tenant_id)
BEGIN SELECT RAISE(ABORT,'a source link belongs to a journal of its own tenant'); END;

-- (4) قراءة التتبّع والمطابقة: من المستند إلى مطابقته البنكية، ومن القيد إلى عكسه.
CREATE INDEX bank_matches_source ON bank_matches(tenant_id,source_kind,source_id);
CREATE INDEX finance_source_links_tenant_kind ON finance_source_links(tenant_id,source_kind);
