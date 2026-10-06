-- ترحيل 169 — استثناءات المشتريات (الحزمة 3: «استلام جزئي، مرتجع، فاتورة جزئية، مطابقة ثلاثية، قرار الفرق، الالتزام، والعكس»).
--
-- ما كان قبل هذا الترحيل، مقيسًا بمسبار على 3d1d84c لا مستنتجًا:
--   • لا جدول للمرتجع ولا إجراء: record_return يعيد invalid_action، فالبضاعة الراجعة للمورد تبقى «مستلمة» وتُطابَق وتُدفع.
--   • فاتورة المورد بمبلغ غير الكمية × سعر الأمر تُرفض عند الإدخال (invoice_mismatch)، فالفاتورة الحقيقية لا تُسجَّل أصلًا،
--     ولا قرار في فرقها: المطابقة ترفض (three_way_mismatch) وبس. والقادحان procurement_invoice_limit وprocurement_lines_consistency
--     يفرضان المبلغ = الكمية × السعر في القاعدة نفسها.
--   • لا إشعار مورد مربوط بالمشتريات، ولا إلغاء لفاتورة أو مستحق قبل الدفع (الجداول لا تُعدَّل ولا تُحذف).
--   • الالتزام لا يُستهلك ولا يتحرر: بعد المطابقة والإقفال على المستلم بقي «الالتزام» 100000 والمتاح كما هو.
--
-- ما يضيفه:
--   (1) procurement_returns وسطوره — المرتجع على بنود الاستلام، نهائي (لا يُعاد استلامه على الأمر نفسه)، يسجّله غير صاحب الطلب.
--   (2) procurement_invoice_decisions وسطوره — قرار الفاتورة الموقوفة: قبول (ضمن حد معتمد أو بمبرر معتمد مالي)، أو طلب إشعار
--       دائن، أو رفض. القرار يحفظ الفرق الذي رآه لكل بند، ولا يغطي فرقًا أكبر منه يظهر بعده.
--   (3) procurement_credit_requests وسطوره والتنازل عنه — ما ننتظره من المورد إشعارًا دائنًا على مستحق قائم (من قرار فرق أو
--       مرتجع بعد المطابقة). الجزء المنتظر محجوز عن الدفع حتى يُعتمد إشعاره أو يتنازل عنه معتمد مالي بمبرر.
--   (4) procurement_voids وقرارها — إلغاء فاتورة أو مستحق غير مدفوع: طلب بسببه ودليله، وقرار مستقل مرة واحدة. إلغاء المستحق
--       تسويةٌ دائنة بكامل رصيده في payable_adjustments (الجدول العام من الترحيل 166) تُسجَّل باسم طالبه ويعتمدها معتمد القرار.
--   (5) إعادة كتابة ثلاثة قوادح بحرفها مع ما تغيّر فقط: حد الفواتير يعدّ الحي منها ولا يفرض المبلغ، واتساق البنود يقبل
--       فرق السعر ويحرس المرتجع، وحارس المطابقة يقرأ المستلم صافيًا من المرتجع والقرار الذي يغطي الفرق — وتبقى فيه شروط
--       الاستقلال التي جاء بها 141 و152 بحرفها.
--
-- الحي: فاتورة ما رُفضت بقرار وما أُلغيت بقرار معتمد. والمستلم الصافي: الاستلام − المرتجع. والمطابَق الصافي: كميات المستحقات
-- غير الملغاة − كميات طلبات الإشعار الدائن عليها. هذه التعاريف نفسها في app/procurement-guards.mjs، فلا تفترق الشاشة والقاعدة.
-- لا يُمسّ صفّ قائم: الجداول جديدة، والقوادح المعاد كتابتها تحرس ما يُكتب بعدها، وكل فاتورة قائمة حية بلا قرار كما كانت.

/* ───── الجداول ───── */

/* (1) المرتجع */
CREATE TABLE procurement_returns (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  purchase_id TEXT NOT NULL REFERENCES procurement_orders(purchase_id),
  -- رقم إشعار الإرجاع أو محضره عند المورد.
  reference TEXT NOT NULL CHECK(length(trim(reference)) BETWEEN 1 AND 120),
  quantity INTEGER NOT NULL CHECK(quantity BETWEEN 1 AND 1000000),
  reason TEXT NOT NULL CHECK(length(trim(reason))>=10),
  evidence TEXT NOT NULL CHECK(length(trim(evidence))>=10),
  recorded_by TEXT NOT NULL REFERENCES users(id),
  purchase_version INTEGER NOT NULL CHECK(purchase_version>0),
  created_at TEXT NOT NULL,
  UNIQUE(purchase_id,reference),
  UNIQUE(id,purchase_id),
  FOREIGN KEY(purchase_id,tenant_id) REFERENCES procurement_purchases(id,tenant_id)
) STRICT;
CREATE TABLE procurement_return_lines (
  id TEXT PRIMARY KEY,
  return_id TEXT NOT NULL,
  purchase_id TEXT NOT NULL REFERENCES procurement_purchases(id),
  order_line_id TEXT NOT NULL,
  quantity INTEGER NOT NULL CHECK(quantity BETWEEN 1 AND 1000000),
  created_at TEXT NOT NULL,
  UNIQUE(return_id,order_line_id),
  FOREIGN KEY(return_id,purchase_id) REFERENCES procurement_returns(id,purchase_id),
  FOREIGN KEY(order_line_id,purchase_id) REFERENCES procurement_order_lines(id,purchase_id)
) STRICT;

/* (2) قرار الفاتورة الموقوفة */
CREATE TABLE procurement_invoice_decisions (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  purchase_id TEXT NOT NULL,
  invoice_id TEXT NOT NULL,
  -- القرار الثاني على الفاتورة نفسها يأتي حين يظهر فرق لم يره الأول (مرتجع أو إقفال بعده).
  sequence INTEGER NOT NULL CHECK(sequence BETWEEN 1 AND 1000),
  decision TEXT NOT NULL CHECK(decision IN ('accept','credit_note','reject')),
  basis TEXT NOT NULL CHECK(basis IN ('within_tolerance','finance_override','credit_note','reject')),
  -- لقطة الفرق الذي رآه القرار: مجموعه هنا، ولكل بند في procurement_invoice_decision_lines.
  price_variance_minor INTEGER NOT NULL,
  quantity_variance INTEGER NOT NULL CHECK(quantity_variance>=0),
  expected_credit_minor INTEGER NOT NULL CHECK(expected_credit_minor>=0),
  -- الحد المعتمد كما قُرئ لحظة القرار (أو قيمة الكود بلا رقم)، فيُعرف على أي حد قُبل الفرق.
  tolerance_json TEXT NOT NULL CHECK(json_valid(tolerance_json)),
  note TEXT NOT NULL CHECK(length(trim(note))>=10),
  override_reason TEXT CHECK(override_reason IS NULL OR length(trim(override_reason))>=20),
  decided_by TEXT NOT NULL REFERENCES users(id),
  purchase_version INTEGER NOT NULL CHECK(purchase_version>0),
  created_at TEXT NOT NULL,
  UNIQUE(invoice_id,sequence),
  FOREIGN KEY(invoice_id,purchase_id) REFERENCES procurement_invoices(id,purchase_id),
  CHECK((basis='finance_override')=(override_reason IS NOT NULL)),
  CHECK((decision='accept')=(basis IN ('within_tolerance','finance_override'))),
  CHECK((decision='credit_note')=(basis='credit_note')),
  CHECK(decision<>'credit_note' OR expected_credit_minor>0)
) STRICT;
CREATE TABLE procurement_invoice_decision_lines (
  decision_id TEXT NOT NULL REFERENCES procurement_invoice_decisions(id),
  invoice_line_id TEXT NOT NULL REFERENCES procurement_invoice_lines(id),
  order_line_id TEXT NOT NULL REFERENCES procurement_order_lines(id),
  price_variance_minor INTEGER NOT NULL,
  quantity_variance INTEGER NOT NULL CHECK(quantity_variance>=0),
  expected_credit_minor INTEGER NOT NULL CHECK(expected_credit_minor>=0),
  PRIMARY KEY(decision_id,invoice_line_id)
) STRICT;

/* (3) طلب الإشعار الدائن والتنازل عنه */
CREATE TABLE procurement_credit_requests (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  purchase_id TEXT NOT NULL,
  payable_id TEXT NOT NULL,
  -- variance: قرار «طلب إشعار دائن» على فاتورة موقوفة (source_id = القرار). return: مرتجع بعد المطابقة (source_id = المرتجع).
  source TEXT NOT NULL CHECK(source IN ('variance','return')),
  source_id TEXT NOT NULL,
  amount_minor INTEGER NOT NULL CHECK(amount_minor BETWEEN 1 AND 1000000000000),
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL,
  UNIQUE(payable_id,source,source_id),
  FOREIGN KEY(payable_id,purchase_id) REFERENCES procurement_payables(id,purchase_id)
) STRICT;
CREATE TABLE procurement_credit_request_lines (
  request_id TEXT NOT NULL REFERENCES procurement_credit_requests(id),
  order_line_id TEXT NOT NULL REFERENCES procurement_order_lines(id),
  -- الوحدات التي يغطيها الإشعار (صفر لفرق سعر خالص): تخرج من «المطابَق الصافي» للبند.
  quantity INTEGER NOT NULL CHECK(quantity BETWEEN 0 AND 1000000),
  amount_minor INTEGER NOT NULL CHECK(amount_minor BETWEEN 0 AND 1000000000000),
  PRIMARY KEY(request_id,order_line_id)
) STRICT;
CREATE TABLE procurement_credit_waivers (
  request_id TEXT PRIMARY KEY REFERENCES procurement_credit_requests(id),
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  reason TEXT NOT NULL CHECK(length(trim(reason))>=20),
  waived_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL
) STRICT;

/* (4) الإلغاء */
CREATE TABLE procurement_voids (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  purchase_id TEXT NOT NULL,
  invoice_id TEXT NOT NULL,
  -- مستحق الفاتورة إن كانت مطابقة لحظة الطلب؛ NULL لفاتورة لم تُطابق.
  payable_id TEXT,
  reason TEXT NOT NULL CHECK(length(trim(reason))>=20),
  evidence TEXT NOT NULL CHECK(length(trim(evidence))>=10),
  requested_by TEXT NOT NULL REFERENCES users(id),
  purchase_version INTEGER NOT NULL CHECK(purchase_version>0),
  created_at TEXT NOT NULL,
  FOREIGN KEY(invoice_id,purchase_id) REFERENCES procurement_invoices(id,purchase_id),
  FOREIGN KEY(payable_id,purchase_id) REFERENCES procurement_payables(id,purchase_id)
) STRICT;
CREATE TABLE procurement_void_decisions (
  void_id TEXT PRIMARY KEY REFERENCES procurement_voids(id),
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  decision TEXT NOT NULL CHECK(decision IN ('approved','rejected')),
  note TEXT NOT NULL CHECK(length(trim(note))>=10),
  -- التسوية الدائنة التي أنزلت المستحق إلى صفر، لإلغاء مستحق معتمد.
  adjustment_id TEXT REFERENCES payable_adjustments(id),
  decided_by TEXT NOT NULL REFERENCES users(id),
  purchase_version INTEGER NOT NULL CHECK(purchase_version>0),
  created_at TEXT NOT NULL,
  CHECK(decision='approved' OR adjustment_id IS NULL)
) STRICT;

CREATE INDEX procurement_returns_purchase ON procurement_returns(purchase_id,created_at);
CREATE INDEX procurement_return_lines_line ON procurement_return_lines(order_line_id);
CREATE INDEX procurement_invoice_decisions_invoice ON procurement_invoice_decisions(invoice_id,sequence);
CREATE INDEX procurement_credit_requests_payable ON procurement_credit_requests(payable_id);
CREATE INDEX procurement_credit_request_lines_line ON procurement_credit_request_lines(order_line_id);
CREATE INDEX procurement_voids_invoice ON procurement_voids(invoice_id);
CREATE INDEX procurement_voids_payable ON procurement_voids(payable_id);
CREATE INDEX payable_adjustments_source ON payable_adjustments(source_kind,source_id);

/* ───── القوادح: السجلات الجديدة ───── */

-- المرتجع: على طلب في كيانه وصل منه شيء، يسجّله غير صاحب الطلب. ولا يرجع من بند أكثر مما استُلم منه.
CREATE TRIGGER procurement_returns_guard BEFORE INSERT ON procurement_returns
WHEN NOT EXISTS(SELECT 1 FROM procurement_purchases p WHERE p.id=NEW.purchase_id AND p.tenant_id=NEW.tenant_id
  AND p.status IN ('part_received','received') AND p.requester_id<>NEW.recorded_by)
BEGIN SELECT RAISE(ABORT,'a return is recorded on a received purchase of its tenant by someone other than the requester'); END;
CREATE TRIGGER procurement_return_lines_within_received BEFORE INSERT ON procurement_return_lines
WHEN NEW.quantity+COALESCE((SELECT SUM(quantity) FROM procurement_return_lines WHERE order_line_id=NEW.order_line_id),0)
  >COALESCE((SELECT SUM(quantity) FROM procurement_receipt_lines WHERE order_line_id=NEW.order_line_id),0)
BEGIN SELECT RAISE(ABORT,'a return cannot send back more than was received on the line'); END;

-- القرار على الفاتورة الموقوفة: معتمد مستقل — لا مسجّل الفاتورة ولا صاحب الطلب ولا من سجّل استلامًا عليه —
-- على فاتورة حية لم تُطابق، بتسلسله. والرفض نهائي: لا قرار بعده.
CREATE TRIGGER procurement_invoice_decisions_guard BEFORE INSERT ON procurement_invoice_decisions
WHEN NOT EXISTS(SELECT 1 FROM procurement_invoices i JOIN procurement_purchases p ON p.id=i.purchase_id
  WHERE i.id=NEW.invoice_id AND i.purchase_id=NEW.purchase_id AND i.tenant_id=NEW.tenant_id
    AND NEW.decided_by<>i.recorded_by AND NEW.decided_by<>p.requester_id
    AND NOT EXISTS(SELECT 1 FROM procurement_receipts r WHERE r.purchase_id=p.id AND r.received_by=NEW.decided_by)
    AND NOT EXISTS(SELECT 1 FROM procurement_payables x WHERE x.invoice_id=i.id)
    AND NOT EXISTS(SELECT 1 FROM procurement_invoice_decisions d WHERE d.invoice_id=i.id AND d.decision='reject')
    AND NOT EXISTS(SELECT 1 FROM procurement_voids v JOIN procurement_void_decisions vd ON vd.void_id=v.id WHERE v.invoice_id=i.id AND vd.decision='approved')
    AND NEW.sequence=1+COALESCE((SELECT MAX(d.sequence) FROM procurement_invoice_decisions d WHERE d.invoice_id=i.id),0))
BEGIN SELECT RAISE(ABORT,'a held invoice is decided by an independent approver — not its recorder, the requester or a receipt recorder — before it is matched'); END;
CREATE TRIGGER procurement_invoice_decision_lines_guard BEFORE INSERT ON procurement_invoice_decision_lines
WHEN NOT EXISTS(SELECT 1 FROM procurement_invoice_decisions d JOIN procurement_invoice_lines l ON l.invoice_id=d.invoice_id
  WHERE d.id=NEW.decision_id AND l.id=NEW.invoice_line_id AND l.order_line_id=NEW.order_line_id)
BEGIN SELECT RAISE(ABORT,'a decision line belongs to a line of the decided invoice'); END;

-- طلب الإشعار الدائن: على مستحق في كيانه، ومصدره قرار «طلب إشعار» على فاتورته أو مرتجع على طلبه. والتنازل من غير منشئه.
CREATE TRIGGER procurement_credit_requests_guard BEFORE INSERT ON procurement_credit_requests
WHEN NOT EXISTS(SELECT 1 FROM procurement_payables x JOIN procurement_invoices i ON i.id=x.invoice_id WHERE x.id=NEW.payable_id AND x.purchase_id=NEW.purchase_id AND i.tenant_id=NEW.tenant_id)
  OR (NEW.source='variance' AND NOT EXISTS(SELECT 1 FROM procurement_invoice_decisions d JOIN procurement_payables x ON x.invoice_id=d.invoice_id WHERE d.id=NEW.source_id AND x.id=NEW.payable_id AND d.decision='credit_note'))
  OR (NEW.source='return' AND NOT EXISTS(SELECT 1 FROM procurement_returns r WHERE r.id=NEW.source_id AND r.purchase_id=NEW.purchase_id))
BEGIN SELECT RAISE(ABORT,'a credit request names a payable of its tenant and the decision or return that raised it'); END;
CREATE TRIGGER procurement_credit_waivers_guard BEFORE INSERT ON procurement_credit_waivers
WHEN NOT EXISTS(SELECT 1 FROM procurement_credit_requests r WHERE r.id=NEW.request_id AND r.tenant_id=NEW.tenant_id AND r.created_by<>NEW.waived_by)
BEGIN SELECT RAISE(ABORT,'a credit request is waived by someone other than who raised it'); END;

-- طلب الإلغاء: مرة واحدة على فاتورة حية في كيانه، ويسمّي مستحقها إن كانت مطابقة.
CREATE TRIGGER procurement_voids_guard BEFORE INSERT ON procurement_voids
WHEN NOT EXISTS(SELECT 1 FROM procurement_invoices i WHERE i.id=NEW.invoice_id AND i.purchase_id=NEW.purchase_id AND i.tenant_id=NEW.tenant_id
    AND NOT EXISTS(SELECT 1 FROM procurement_invoice_decisions d WHERE d.invoice_id=i.id AND d.decision='reject')
    AND NEW.payable_id IS (SELECT x.id FROM procurement_payables x WHERE x.invoice_id=i.id))
  OR EXISTS(SELECT 1 FROM procurement_voids v WHERE v.invoice_id=NEW.invoice_id
    AND (NOT EXISTS(SELECT 1 FROM procurement_void_decisions d WHERE d.void_id=v.id) OR EXISTS(SELECT 1 FROM procurement_void_decisions d WHERE d.void_id=v.id AND d.decision='approved')))
BEGIN SELECT RAISE(ABORT,'a void is requested once on a live invoice of its tenant, naming its payable when it is matched'); END;
-- قرار الإلغاء: معتمد مستقل — لا طالبه ولا مسجّل الفاتورة ولا من طابقها. واعتماد إلغاء مستحق يحمل تسويته الدائنة المعتمدة
-- التي أنزلته إلى صفر، ولا دفع حي عليه (معلّق أو معتمد أو منفّذ لم يرجع).
CREATE TRIGGER procurement_void_decisions_guard BEFORE INSERT ON procurement_void_decisions
WHEN NOT EXISTS(SELECT 1 FROM procurement_voids v JOIN procurement_invoices i ON i.id=v.invoice_id LEFT JOIN procurement_payables x ON x.id=v.payable_id
  WHERE v.id=NEW.void_id AND v.tenant_id=NEW.tenant_id AND NEW.decided_by<>v.requested_by AND NEW.decided_by<>i.recorded_by
    AND (x.id IS NULL OR NEW.decided_by<>x.matched_by)
    AND (NEW.decision='rejected'
      OR (v.payable_id IS NULL AND NEW.adjustment_id IS NULL AND NOT EXISTS(SELECT 1 FROM procurement_payables y WHERE y.invoice_id=v.invoice_id))
      OR (v.payable_id IS NOT NULL
        AND EXISTS(SELECT 1 FROM payable_adjustments a WHERE a.id=NEW.adjustment_id AND a.payable_id=v.payable_id AND a.kind='credit' AND a.status='approved'
          AND a.source_kind='procurement_void' AND a.source_id=v.id)
        AND COALESCE((SELECT outstanding_minor FROM payable_balances WHERE payable_id=v.payable_id),0)=0
        AND NOT EXISTS(SELECT 1 FROM payment_order_lines l JOIN payment_orders o ON o.id=l.order_id WHERE l.payable_id=v.payable_id
          AND (o.status IN ('pending','approved') OR (o.status='executed' AND NOT EXISTS(SELECT 1 FROM payment_returns r WHERE r.order_id=o.id)))))))
BEGIN SELECT RAISE(ABORT,'a void is decided once by an independent approver, and an approved void of a payable carries its full approved credit with no payment alive'); END;

-- لا يُعدَّل ولا يُحذف شيء من هذه السجلات: التصحيح سجلٌّ لاحق يسمّي ما قبله.
CREATE TRIGGER procurement_returns_no_update BEFORE UPDATE ON procurement_returns BEGIN SELECT RAISE(ABORT,'returns are kept as recorded'); END;
CREATE TRIGGER procurement_returns_no_delete BEFORE DELETE ON procurement_returns BEGIN SELECT RAISE(ABORT,'returns are kept as recorded'); END;
CREATE TRIGGER procurement_return_lines_no_update BEFORE UPDATE ON procurement_return_lines BEGIN SELECT RAISE(ABORT,'returns are kept as recorded'); END;
CREATE TRIGGER procurement_return_lines_no_delete BEFORE DELETE ON procurement_return_lines BEGIN SELECT RAISE(ABORT,'returns are kept as recorded'); END;
CREATE TRIGGER procurement_invoice_decisions_no_update BEFORE UPDATE ON procurement_invoice_decisions BEGIN SELECT RAISE(ABORT,'invoice decisions are kept as recorded'); END;
CREATE TRIGGER procurement_invoice_decisions_no_delete BEFORE DELETE ON procurement_invoice_decisions BEGIN SELECT RAISE(ABORT,'invoice decisions are kept as recorded'); END;
CREATE TRIGGER procurement_invoice_decision_lines_no_update BEFORE UPDATE ON procurement_invoice_decision_lines BEGIN SELECT RAISE(ABORT,'invoice decisions are kept as recorded'); END;
CREATE TRIGGER procurement_invoice_decision_lines_no_delete BEFORE DELETE ON procurement_invoice_decision_lines BEGIN SELECT RAISE(ABORT,'invoice decisions are kept as recorded'); END;
CREATE TRIGGER procurement_credit_requests_no_update BEFORE UPDATE ON procurement_credit_requests BEGIN SELECT RAISE(ABORT,'credit requests are kept as recorded'); END;
CREATE TRIGGER procurement_credit_requests_no_delete BEFORE DELETE ON procurement_credit_requests BEGIN SELECT RAISE(ABORT,'credit requests are kept as recorded'); END;
CREATE TRIGGER procurement_credit_request_lines_no_update BEFORE UPDATE ON procurement_credit_request_lines BEGIN SELECT RAISE(ABORT,'credit requests are kept as recorded'); END;
CREATE TRIGGER procurement_credit_request_lines_no_delete BEFORE DELETE ON procurement_credit_request_lines BEGIN SELECT RAISE(ABORT,'credit requests are kept as recorded'); END;
CREATE TRIGGER procurement_credit_waivers_no_update BEFORE UPDATE ON procurement_credit_waivers BEGIN SELECT RAISE(ABORT,'waivers are kept as recorded'); END;
CREATE TRIGGER procurement_credit_waivers_no_delete BEFORE DELETE ON procurement_credit_waivers BEGIN SELECT RAISE(ABORT,'waivers are kept as recorded'); END;
CREATE TRIGGER procurement_voids_no_update BEFORE UPDATE ON procurement_voids BEGIN SELECT RAISE(ABORT,'voids are kept as recorded'); END;
CREATE TRIGGER procurement_voids_no_delete BEFORE DELETE ON procurement_voids BEGIN SELECT RAISE(ABORT,'voids are kept as recorded'); END;
CREATE TRIGGER procurement_void_decisions_no_update BEFORE UPDATE ON procurement_void_decisions BEGIN SELECT RAISE(ABORT,'voids are kept as recorded'); END;
CREATE TRIGGER procurement_void_decisions_no_delete BEFORE DELETE ON procurement_void_decisions BEGIN SELECT RAISE(ABORT,'voids are kept as recorded'); END;

/* ───── القوادح: التسويات والدفع (جداول الترحيل 166) ───── */
-- التسوية التي مصدرها الإلغاء: طلب إلغاء معلّق على المستحق نفسه، دائنة، باسم طالبه. وقرارها قرار الإلغاء: لا يعتمدها طالبه
-- ولا مسجّل الفاتورة ولا من طابقها — فشاشة المدفوعات لا تعتمد إلغاءً من خلف قراره.
CREATE TRIGGER payable_adjustments_procurement_void BEFORE INSERT ON payable_adjustments
WHEN NEW.source_kind='procurement_void' AND NOT EXISTS(SELECT 1 FROM procurement_voids v WHERE v.id=NEW.source_id AND v.payable_id=NEW.payable_id
  AND v.tenant_id=NEW.tenant_id AND v.requested_by=NEW.recorded_by AND NEW.kind='credit'
  AND NOT EXISTS(SELECT 1 FROM procurement_void_decisions d WHERE d.void_id=v.id))
BEGIN SELECT RAISE(ABORT,'a void credit belongs to a pending void request of the same payable, recorded in its requester''s name'); END;
CREATE TRIGGER payable_adjustments_procurement_void_decided BEFORE UPDATE OF status ON payable_adjustments
WHEN NEW.source_kind='procurement_void' AND NEW.status='approved' AND EXISTS(SELECT 1 FROM procurement_voids v JOIN procurement_invoices i ON i.id=v.invoice_id JOIN procurement_payables x ON x.id=v.payable_id
  WHERE v.id=NEW.source_id AND NEW.decided_by IN (v.requested_by,i.recorded_by,x.matched_by))
BEGIN SELECT RAISE(ABORT,'a void credit is approved by the independent approver of the void'); END;
-- الإشعار الذي يجيب طلب إشعار دائن: دائن، على مستحق الطلب نفسه.
CREATE TRIGGER payable_adjustments_procurement_credit BEFORE INSERT ON payable_adjustments
WHEN NEW.source_kind='procurement_credit' AND NOT EXISTS(SELECT 1 FROM procurement_credit_requests r WHERE r.id=NEW.source_id AND r.payable_id=NEW.payable_id AND r.tenant_id=NEW.tenant_id AND NEW.kind='credit')
BEGIN SELECT RAISE(ABORT,'a procurement credit note answers a credit request on the same payable'); END;

-- الدفع: مستحق عليه طلب إلغاء معلّق لا يُدفع منه شيء حتى يُقرَّر، ومستحق ينتظر إشعارًا دائنًا لا يُدفع منه إلا غير المتنازع
-- عليه: المتاح (payable_balances) ناقص ما لم يُجِبه إشعار معتمد من كل طلب لم يُتنازل عنه. وما تجاوز المتاح نفسه يرفضه قادح
-- الترحيل 166 برسالته (payment_order_lines_within_balance)، فهذا القادح يتكلم في ما بين المتاح والمحجوز وحده.
CREATE TRIGGER payment_order_lines_procurement_hold BEFORE INSERT ON payment_order_lines
WHEN EXISTS(SELECT 1 FROM procurement_voids v WHERE v.payable_id=NEW.payable_id AND NOT EXISTS(SELECT 1 FROM procurement_void_decisions d WHERE d.void_id=v.id))
  OR (NEW.amount_minor<=COALESCE((SELECT available_minor FROM payable_balances WHERE payable_id=NEW.payable_id),0)
  AND NEW.amount_minor>COALESCE((SELECT available_minor FROM payable_balances WHERE payable_id=NEW.payable_id),0)
    -COALESCE((SELECT SUM(MAX(0,r.amount_minor-COALESCE((SELECT SUM(a.amount_minor) FROM payable_adjustments a
        WHERE a.source_kind='procurement_credit' AND a.source_id=r.id AND a.status='approved'),0)))
      FROM procurement_credit_requests r WHERE r.payable_id=NEW.payable_id AND NOT EXISTS(SELECT 1 FROM procurement_credit_waivers w WHERE w.request_id=r.id)),0))
BEGIN SELECT RAISE(ABORT,'a payable under a void request, or awaiting a supplier credit note, is paid only up to what is not in dispute'); END;

/* ───── القوادح المعاد كتابتها (141 و152) ───── */
-- حد الفواتير: يعدّ الحي منها فقط، ولا يفرض المبلغ = الكمية × السعر — الفرق يُسجَّل موقوفًا ويُقرَّر. يبقى: الكيان والمورد والعملة
-- وحالة الطلب، ومجموع كميات الفواتير الحية لا يتجاوز كميات الأمر.
DROP TRIGGER procurement_invoice_limit;
CREATE TRIGGER procurement_invoice_limit BEFORE INSERT ON procurement_invoices
WHEN NOT EXISTS(
  SELECT 1 FROM procurement_orders o JOIN procurement_purchases p ON p.id=o.purchase_id
  WHERE p.id=NEW.purchase_id AND p.status IN ('ordered','part_received','received')
    AND NEW.tenant_id=p.tenant_id AND NEW.supplier_key=o.supplier_key AND NEW.currency=o.currency
    AND NEW.quantity+COALESCE((SELECT SUM(i.quantity) FROM procurement_invoices i WHERE i.purchase_id=p.id
        AND NOT EXISTS(SELECT 1 FROM procurement_invoice_decisions d WHERE d.invoice_id=i.id AND d.decision='reject')
        AND NOT EXISTS(SELECT 1 FROM procurement_voids v JOIN procurement_void_decisions vd ON vd.void_id=v.id WHERE v.invoice_id=i.id AND vd.decision='approved')),0)
      <=COALESCE((SELECT SUM(quantity) FROM procurement_order_lines WHERE purchase_id=p.id),0)
)
BEGIN SELECT RAISE(ABORT,'invoice does not match approved order'); END;

-- اتساق البنود: كما في 141 بحرفه، إلا أن فواتير البند تُعدّ الحية منها ولا يُفرض مبلغها (فرق السعر يُقرَّر)، ويُضاف المرتجع:
-- رأسه يساوي سطوره، ولا يتجاوز مرتجع البند مستلمه.
DROP TRIGGER procurement_lines_consistency;
CREATE TRIGGER procurement_lines_consistency BEFORE UPDATE ON procurement_purchases
WHEN NOT (OLD.status<>'draft' AND (NEW.title<>OLD.title OR NEW.specification<>OLD.specification OR NEW.cost_center<>OLD.cost_center
       OR NEW.due_date<>OLD.due_date OR NEW.quantity<>OLD.quantity OR NEW.unit<>OLD.unit OR NEW.currency<>OLD.currency
       OR NEW.budget_minor<>OLD.budget_minor OR NEW.budget_evidence<>OLD.budget_evidence))
  AND (
    NOT EXISTS(SELECT 1 FROM procurement_purchase_lines WHERE purchase_id=OLD.id)
    OR (SELECT COUNT(*) FROM procurement_purchase_lines WHERE purchase_id=OLD.id)=1 AND (
      COALESCE((SELECT SUM(quantity) FROM procurement_purchase_lines WHERE purchase_id=OLD.id),0)<>NEW.quantity
      OR COALESCE((SELECT MIN(unit) FROM procurement_purchase_lines WHERE purchase_id=OLD.id),'')<>NEW.unit)
    OR (SELECT COUNT(*) FROM procurement_purchase_lines WHERE purchase_id=OLD.id)>1 AND (NEW.quantity<>1 OR NEW.unit<>'طلب متعدد البنود')
    OR COALESCE((SELECT SUM(amount_minor) FROM procurement_line_allocations WHERE purchase_id=OLD.id),0)<>NEW.budget_minor
    OR EXISTS(
      SELECT 1 FROM procurement_quotes q WHERE q.purchase_id=OLD.id AND (
        (SELECT COUNT(*) FROM procurement_quote_lines ql WHERE ql.quote_id=q.id)<>(SELECT COUNT(*) FROM procurement_purchase_lines pl WHERE pl.purchase_id=OLD.id)
        OR COALESCE((SELECT SUM(total_minor) FROM procurement_quote_lines ql WHERE ql.quote_id=q.id),0)<>q.total_minor
      )
    )
    OR EXISTS(SELECT 1 FROM procurement_orders o WHERE o.purchase_id=OLD.id AND (
         (SELECT COUNT(*) FROM procurement_order_lines l WHERE l.order_id=o.id)<>(SELECT COUNT(*) FROM procurement_purchase_lines l WHERE l.purchase_id=OLD.id)
         OR COALESCE((SELECT SUM(total_minor) FROM procurement_order_lines l WHERE l.order_id=o.id),0)<>o.total_minor
         OR COALESCE((SELECT SUM(allocated_minor) FROM procurement_order_lines l WHERE l.order_id=o.id),0)<>o.total_minor))
    OR EXISTS(SELECT 1 FROM procurement_receipts r WHERE r.purchase_id=OLD.id AND COALESCE((SELECT SUM(quantity) FROM procurement_receipt_lines l WHERE l.receipt_id=r.id),0)<>r.quantity)
    OR EXISTS(
      SELECT 1 FROM procurement_order_lines ol WHERE ol.purchase_id=OLD.id
        AND COALESCE((SELECT SUM(quantity) FROM procurement_receipt_lines rl WHERE rl.order_line_id=ol.id),0)>ol.quantity
    )
    OR EXISTS(SELECT 1 FROM procurement_invoices i WHERE i.purchase_id=OLD.id AND (
         COALESCE((SELECT SUM(quantity) FROM procurement_invoice_lines l WHERE l.invoice_id=i.id),0)<>i.quantity
         OR COALESCE((SELECT SUM(amount_minor) FROM procurement_invoice_lines l WHERE l.invoice_id=i.id),0)<>i.amount_minor))
    OR EXISTS(
      SELECT 1 FROM procurement_order_lines ol WHERE ol.purchase_id=OLD.id
        AND COALESCE((SELECT SUM(il.quantity) FROM procurement_invoice_lines il JOIN procurement_invoices i ON i.id=il.invoice_id WHERE il.order_line_id=ol.id
          AND NOT EXISTS(SELECT 1 FROM procurement_invoice_decisions d WHERE d.invoice_id=i.id AND d.decision='reject')
          AND NOT EXISTS(SELECT 1 FROM procurement_voids v JOIN procurement_void_decisions vd ON vd.void_id=v.id WHERE v.invoice_id=i.id AND vd.decision='approved')),0)>ol.quantity
    )
    OR EXISTS(SELECT 1 FROM procurement_returns r WHERE r.purchase_id=OLD.id AND COALESCE((SELECT SUM(quantity) FROM procurement_return_lines l WHERE l.return_id=r.id),0)<>r.quantity)
    OR EXISTS(
      SELECT 1 FROM procurement_order_lines ol WHERE ol.purchase_id=OLD.id
        AND COALESCE((SELECT SUM(quantity) FROM procurement_return_lines tl WHERE tl.order_line_id=ol.id),0)
          >COALESCE((SELECT SUM(quantity) FROM procurement_receipt_lines rl WHERE rl.order_line_id=ol.id),0)
    )
    OR EXISTS(SELECT 1 FROM procurement_payables x WHERE x.purchase_id=OLD.id AND (
         COALESCE((SELECT SUM(amount_minor) FROM procurement_payable_lines l WHERE l.payable_id=x.id),0)<>x.amount_minor
         OR (SELECT COUNT(*) FROM procurement_payable_lines l WHERE l.payable_id=x.id)<>(SELECT COUNT(*) FROM procurement_invoice_lines l WHERE l.invoice_id=x.invoice_id)))
  )
BEGIN SELECT RAISE(ABORT,'procurement document lines do not reconcile'); END;

-- حارس المطابقة: شروط الاستقلال من 141 و152 بحرفها (لا صاحب الطلب ولا مسجّل الفاتورة ولا مسجّل أي استلام)، والمستحق بمبلغ
-- الفاتورة. وما تغيّر ثلاثة: الفاتورة المرفوضة أو الملغاة أو التي عليها طلب إلغاء معلّق لا تُطابَق؛ وفرق السعر لا يمرّ إلا بقرار (قبول أو طلب إشعار) آخرُ
-- ما قُرّر عليها ويساوي فرق البند نفسه؛ والكمية تُقاس بالمستلم الصافي من المرتجع والمطابَق الصافي من طلبات الإشعار، ويخصم منها
-- فرق الكمية الذي غطاه القرار.
DROP TRIGGER procurement_match_guard;
CREATE TRIGGER procurement_match_guard BEFORE INSERT ON procurement_payables
WHEN NOT EXISTS(
  SELECT 1 FROM procurement_invoices i JOIN procurement_orders o ON o.purchase_id=i.purchase_id JOIN procurement_purchases p ON p.id=o.purchase_id
  WHERE i.id=NEW.invoice_id AND i.purchase_id=NEW.purchase_id AND p.status IN ('part_received','received')
    AND NEW.matched_by<>p.requester_id AND NEW.matched_by<>i.recorded_by
    AND NOT EXISTS(SELECT 1 FROM procurement_receipts r WHERE r.purchase_id=p.id AND r.received_by=NEW.matched_by)
    AND NEW.amount_minor=i.amount_minor AND NEW.currency=i.currency
    AND EXISTS(SELECT 1 FROM procurement_invoice_lines il WHERE il.invoice_id=i.id)
    AND NOT EXISTS(SELECT 1 FROM procurement_invoice_decisions d WHERE d.invoice_id=i.id AND d.decision='reject')
    AND NOT EXISTS(SELECT 1 FROM procurement_voids v JOIN procurement_void_decisions vd ON vd.void_id=v.id WHERE v.invoice_id=i.id AND vd.decision='approved')
    AND NOT EXISTS(SELECT 1 FROM procurement_voids v WHERE v.invoice_id=i.id AND NOT EXISTS(SELECT 1 FROM procurement_void_decisions vd WHERE vd.void_id=v.id))
    AND NOT EXISTS(
      SELECT 1 FROM procurement_invoice_lines il JOIN procurement_order_lines ol ON ol.id=il.order_line_id
      LEFT JOIN procurement_invoice_decision_lines dl ON dl.invoice_line_id=il.id AND dl.decision_id=(
        SELECT d.id FROM procurement_invoice_decisions d WHERE d.invoice_id=i.id AND d.decision IN ('accept','credit_note')
          AND d.sequence=(SELECT MAX(d2.sequence) FROM procurement_invoice_decisions d2 WHERE d2.invoice_id=i.id))
      WHERE il.invoice_id=i.id AND (
        (il.amount_minor<>il.quantity*ol.unit_price_minor
          AND (dl.decision_id IS NULL OR dl.price_variance_minor<>il.amount_minor-il.quantity*ol.unit_price_minor))
        OR il.quantity-COALESCE(dl.quantity_variance,0)+COALESCE((
          SELECT SUM(pl.quantity) FROM procurement_payable_lines pl
          JOIN procurement_payables px ON px.id=pl.payable_id
          WHERE pl.order_line_id=il.order_line_id AND px.purchase_id=p.id
            AND NOT EXISTS(SELECT 1 FROM procurement_voids v JOIN procurement_void_decisions vd ON vd.void_id=v.id WHERE v.payable_id=px.id AND vd.decision='approved')
        ),0)-COALESCE((
          SELECT SUM(cl.quantity) FROM procurement_credit_request_lines cl
          JOIN procurement_credit_requests cr ON cr.id=cl.request_id
          WHERE cl.order_line_id=il.order_line_id AND cr.purchase_id=p.id
            AND NOT EXISTS(SELECT 1 FROM procurement_voids v JOIN procurement_void_decisions vd ON vd.void_id=v.id WHERE v.payable_id=cr.payable_id AND vd.decision='approved')
        ),0)>COALESCE((
          SELECT SUM(rl.quantity) FROM procurement_receipt_lines rl
          WHERE rl.order_line_id=il.order_line_id AND rl.purchase_id=p.id
        ),0)-COALESCE((
          SELECT SUM(tl.quantity) FROM procurement_return_lines tl
          WHERE tl.order_line_id=il.order_line_id AND tl.purchase_id=p.id
        ),0)
      )
    )
)
BEGIN SELECT RAISE(ABORT,'three way match requires receipt and independent approval'); END;
