-- استكمال المشتريات: شراء طارئ بمراجعة لاحقة إلزامية (PRC-07)، تعديل أمر الشراء بسجل مستقل لأن الأمر نفسه لا يُعدل (PRC-08)،
-- وإفصاح تعارض المصالح مع مورد يمنع صاحبه من الترسية والاعتماد والمطابقة حتى يُبت فيه.
CREATE TABLE procurement_emergencies (
  purchase_id TEXT PRIMARY KEY REFERENCES procurement_purchases(id),
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  justification TEXT NOT NULL CHECK(length(trim(justification))>=30),
  risk_if_delayed TEXT NOT NULL CHECK(length(trim(risk_if_delayed))>=20),
  declared_by TEXT NOT NULL REFERENCES users(id),
  status TEXT NOT NULL CHECK(status IN ('pending','approved','rejected')),
  decided_by TEXT REFERENCES users(id),
  decided_at TEXT,
  decision_note TEXT NOT NULL DEFAULT '',
  review_due TEXT,
  review_outcome TEXT CHECK(review_outcome IS NULL OR review_outcome IN ('justified','not_justified')),
  reviewed_by TEXT REFERENCES users(id),
  reviewed_at TEXT,
  review_note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  CHECK(decided_by IS NULL OR decided_by<>declared_by),
  CHECK((status='pending')=(decided_by IS NULL)),
  CHECK(reviewed_by IS NULL OR (status='approved' AND reviewed_by<>declared_by AND reviewed_by<>decided_by)),
  CHECK((reviewed_by IS NULL)=(review_outcome IS NULL))
) STRICT;
CREATE TRIGGER procurement_emergencies_fixed BEFORE UPDATE ON procurement_emergencies
WHEN NEW.justification<>OLD.justification OR NEW.risk_if_delayed<>OLD.risk_if_delayed OR NEW.declared_by<>OLD.declared_by OR (OLD.status<>'pending' AND NEW.status<>OLD.status) OR OLD.reviewed_by IS NOT NULL
BEGIN SELECT RAISE(ABORT,'an emergency declaration is decided once and reviewed once'); END;
CREATE TRIGGER procurement_emergencies_no_delete BEFORE DELETE ON procurement_emergencies BEGIN SELECT RAISE(ABORT,'emergency declarations are retained'); END;

-- الترسية: عرضان على الأقل، أو عرض واحد مع إعلان طارئ معتمد من غير صاحب الطلب.
DROP TRIGGER procurement_award_guard;
CREATE TRIGGER procurement_award_guard BEFORE INSERT ON procurement_awards
WHEN NOT EXISTS(SELECT 1 FROM procurement_purchases p JOIN procurement_quotes q ON q.purchase_id=p.id WHERE p.id=NEW.purchase_id AND p.status='sourcing' AND p.requester_id<>NEW.approved_by AND q.id=NEW.quote_id AND q.total_minor<=p.budget_minor
  AND ((SELECT COUNT(*) FROM procurement_quotes WHERE purchase_id=p.id)>=2 OR EXISTS(SELECT 1 FROM procurement_emergencies e WHERE e.purchase_id=p.id AND e.status='approved')))
BEGIN SELECT RAISE(ABORT,'award requires comparison or an approved emergency, funds and independent approval'); END;

CREATE TABLE procurement_order_changes (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  purchase_id TEXT NOT NULL REFERENCES procurement_purchases(id),
  order_id TEXT NOT NULL REFERENCES procurement_orders(id),
  kind TEXT NOT NULL CHECK(kind IN ('delivery_date','terms','close_short')),
  new_delivery_date TEXT,
  new_terms TEXT,
  reason TEXT NOT NULL CHECK(length(trim(reason))>=20),
  supplier_confirmation TEXT NOT NULL CHECK(length(trim(supplier_confirmation))>=5),
  requested_by TEXT NOT NULL REFERENCES users(id),
  status TEXT NOT NULL CHECK(status IN ('pending','approved','rejected')),
  decided_by TEXT REFERENCES users(id),
  decided_at TEXT,
  decision_note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  CHECK(decided_by IS NULL OR decided_by<>requested_by),
  CHECK((status='pending')=(decided_by IS NULL)),
  CHECK((kind='delivery_date')=(new_delivery_date IS NOT NULL)),
  CHECK((kind='terms')=(new_terms IS NOT NULL))
) STRICT;
CREATE UNIQUE INDEX procurement_order_changes_one_pending ON procurement_order_changes(order_id) WHERE status='pending';
CREATE TRIGGER procurement_order_changes_fixed BEFORE UPDATE ON procurement_order_changes
WHEN OLD.status<>'pending' OR NEW.kind<>OLD.kind OR NEW.reason<>OLD.reason OR NEW.requested_by<>OLD.requested_by OR COALESCE(NEW.new_delivery_date,'')<>COALESCE(OLD.new_delivery_date,'') OR COALESCE(NEW.new_terms,'')<>COALESCE(OLD.new_terms,'')
BEGIN SELECT RAISE(ABORT,'a decided order change is final'); END;
CREATE TRIGGER procurement_order_changes_no_delete BEFORE DELETE ON procurement_order_changes BEGIN SELECT RAISE(ABORT,'order changes are retained'); END;
-- أمر أُقفل على ما استُلم لا يقبل استلامًا جديدًا.
CREATE TRIGGER procurement_receipt_closed_short BEFORE INSERT ON procurement_receipts
WHEN EXISTS(SELECT 1 FROM procurement_order_changes c WHERE c.purchase_id=NEW.purchase_id AND c.kind='close_short' AND c.status='approved')
BEGIN SELECT RAISE(ABORT,'order was closed short'); END;

CREATE TABLE vendor_conflict_disclosures (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  vendor_id TEXT NOT NULL REFERENCES vendors(id),
  user_id TEXT NOT NULL,
  relationship TEXT NOT NULL CHECK(relationship IN ('ownership','family','prior_employment','gift_or_benefit','other')),
  description TEXT NOT NULL CHECK(length(trim(description))>=20),
  status TEXT NOT NULL CHECK(status IN ('disclosed','no_conflict','managed','recused','withdrawn')),
  conditions TEXT NOT NULL DEFAULT '',
  decided_by TEXT REFERENCES users(id),
  decided_at TEXT,
  decision_note TEXT NOT NULL DEFAULT '',
  withdrawn_by TEXT REFERENCES users(id),
  withdrawn_at TEXT,
  withdrawal_note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  FOREIGN KEY(user_id,tenant_id) REFERENCES users(id,tenant_id),
  CHECK(decided_by IS NULL OR decided_by<>user_id),
  CHECK(status<>'disclosed' OR decided_by IS NULL),
  CHECK(status NOT IN ('no_conflict','managed','recused') OR decided_by IS NOT NULL),
  CHECK((status='withdrawn')=(withdrawn_by IS NOT NULL)),
  -- صاحب الإفصاح يسحب ما لم يُبت فيه فقط؛ القيد القائم يرفعه غيره.
  CHECK(withdrawn_by IS NULL OR (decided_by IS NULL AND withdrawn_by=user_id) OR (decided_by IS NOT NULL AND withdrawn_by<>user_id)),
  CHECK(status<>'managed' OR length(trim(conditions))>=10)
) STRICT;
CREATE UNIQUE INDEX vendor_conflict_one_live ON vendor_conflict_disclosures(vendor_id,user_id) WHERE status IN ('disclosed','managed','recused');
CREATE TRIGGER vendor_conflict_fixed BEFORE UPDATE ON vendor_conflict_disclosures
WHEN OLD.status NOT IN ('disclosed','managed','recused') OR NEW.vendor_id<>OLD.vendor_id OR NEW.user_id<>OLD.user_id OR NEW.relationship<>OLD.relationship OR NEW.description<>OLD.description
  OR (OLD.status IN ('managed','recused') AND NEW.status<>'withdrawn')
BEGIN SELECT RAISE(ABORT,'a disclosure is decided once; a standing restriction ends only by a recorded withdrawal'); END;
CREATE TRIGGER vendor_conflict_no_delete BEFORE DELETE ON vendor_conflict_disclosures BEGIN SELECT RAISE(ABORT,'disclosures are retained'); END;
