-- F-03 / F-04: one traceable RFQ package between award and purchase order.
-- Existing tenants adopt the gate on upgrade. A newly created tenant must adopt it explicitly.

CREATE TABLE procurement_rfq_policies (
  tenant_id TEXT PRIMARY KEY REFERENCES tenants(id),
  required INTEGER NOT NULL CHECK(required IN (0,1)),
  source_reference TEXT NOT NULL,
  activated_at TEXT NOT NULL
) STRICT;

INSERT INTO procurement_rfq_policies(tenant_id,required,source_reference,activated_at)
SELECT id,1,'F-03/F-04 verified source',strftime('%Y-%m-%dT%H:%M:%fZ','now') FROM tenants;

CREATE TABLE procurement_rfqs (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  purchase_id TEXT NOT NULL,
  quote_id TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK(revision BETWEEN 1 AND 10000),
  rfq_number TEXT NOT NULL,
  request_on TEXT NOT NULL CHECK(request_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  rfp_reference TEXT,
  requesting_department TEXT NOT NULL,
  quotation_on TEXT NOT NULL CHECK(quotation_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  vendor_quote_reference TEXT NOT NULL,
  proposed_payment_terms TEXT NOT NULL,
  valid_until TEXT NOT NULL CHECK(valid_until GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  subtotal_minor INTEGER NOT NULL CHECK(subtotal_minor BETWEEN 1 AND 1000000000000),
  vat_minor INTEGER NOT NULL CHECK(vat_minor BETWEEN 0 AND 1000000000000),
  total_minor INTEGER NOT NULL CHECK(total_minor=subtotal_minor+vat_minor AND total_minor BETWEEN 1 AND 1000000000000),
  currency TEXT NOT NULL CHECK(currency='SAR'),
  po_required INTEGER NOT NULL CHECK(po_required IN (0,1)),
  status TEXT NOT NULL CHECK(status IN ('pending_finance','approved','changes_required','rejected')),
  finance_due_on TEXT NOT NULL CHECK(finance_due_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  source_reference TEXT NOT NULL CHECK(source_reference='F-03/F-04'),
  created_by TEXT NOT NULL,
  purchase_version INTEGER NOT NULL CHECK(purchase_version>0),
  created_at TEXT NOT NULL,
  UNIQUE(id,purchase_id),
  UNIQUE(tenant_id,rfq_number),
  UNIQUE(purchase_id,revision),
  FOREIGN KEY(purchase_id,tenant_id) REFERENCES procurement_purchases(id,tenant_id),
  FOREIGN KEY(quote_id,purchase_id) REFERENCES procurement_quotes(id,purchase_id),
  FOREIGN KEY(created_by,tenant_id) REFERENCES users(id,tenant_id)
) STRICT;

CREATE UNIQUE INDEX procurement_rfq_one_live
ON procurement_rfqs(purchase_id)
WHERE status IN ('pending_finance','approved');
CREATE INDEX procurement_rfq_finance_queue ON procurement_rfqs(tenant_id,status,finance_due_on,created_at);

CREATE TRIGGER procurement_rfq_submission_guard BEFORE INSERT ON procurement_rfqs
WHEN NOT EXISTS(
  SELECT 1 FROM procurement_purchases p
  JOIN procurement_awards a ON a.purchase_id=p.id AND a.quote_id=NEW.quote_id
  JOIN procurement_quotes q ON q.id=NEW.quote_id AND q.purchase_id=p.id
  JOIN users u ON u.id=NEW.created_by AND u.tenant_id=p.tenant_id AND u.active=1 AND u.role IN ('manager','pm')
  WHERE p.id=NEW.purchase_id AND p.tenant_id=NEW.tenant_id AND p.status='awarded'
    AND NEW.created_by<>p.requester_id
    AND NEW.subtotal_minor=q.total_minor
)
BEGIN SELECT RAISE(ABORT,'RFQ submission requires the awarded quote and an independent procurement reviewer'); END;

CREATE TABLE procurement_rfq_lines (
  id TEXT PRIMARY KEY,
  rfq_id TEXT NOT NULL,
  purchase_id TEXT NOT NULL,
  purchase_line_id TEXT NOT NULL,
  line_no INTEGER NOT NULL CHECK(line_no BETWEEN 1 AND 10000),
  description TEXT NOT NULL,
  specification TEXT NOT NULL,
  quantity INTEGER NOT NULL CHECK(quantity BETWEEN 1 AND 1000000),
  unit TEXT NOT NULL,
  quote_unit_price_minor INTEGER NOT NULL CHECK(quote_unit_price_minor BETWEEN 1 AND 1000000000000),
  quote_total_minor INTEGER NOT NULL CHECK(quote_total_minor=quantity*quote_unit_price_minor AND quote_total_minor BETWEEN 1 AND 1000000000000),
  currency TEXT NOT NULL CHECK(currency='SAR'),
  created_at TEXT NOT NULL,
  UNIQUE(rfq_id,line_no),
  UNIQUE(rfq_id,purchase_line_id),
  UNIQUE(id,rfq_id),
  FOREIGN KEY(rfq_id,purchase_id) REFERENCES procurement_rfqs(id,purchase_id),
  FOREIGN KEY(purchase_line_id,purchase_id) REFERENCES procurement_purchase_lines(id,purchase_id)
) STRICT;

CREATE TABLE procurement_rfq_finance_reviews (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  rfq_id TEXT NOT NULL UNIQUE,
  purchase_id TEXT NOT NULL,
  decision TEXT NOT NULL CHECK(decision IN ('approved','changes_required','rejected')),
  finance_notes TEXT NOT NULL,
  report_number TEXT NOT NULL,
  report_date TEXT NOT NULL CHECK(report_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  reviewed_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(id,rfq_id),
  FOREIGN KEY(rfq_id,purchase_id) REFERENCES procurement_rfqs(id,purchase_id),
  FOREIGN KEY(reviewed_by,tenant_id) REFERENCES users(id,tenant_id)
) STRICT;

CREATE TABLE procurement_rfq_finance_lines (
  id TEXT PRIMARY KEY,
  review_id TEXT NOT NULL,
  rfq_id TEXT NOT NULL,
  rfq_line_id TEXT NOT NULL,
  quote_unit_price_minor INTEGER NOT NULL CHECK(quote_unit_price_minor BETWEEN 1 AND 1000000000000),
  rate_card_unit_price_minor INTEGER CHECK(rate_card_unit_price_minor BETWEEN 1 AND 1000000000000),
  difference_minor INTEGER,
  difference_basis_points INTEGER,
  result TEXT NOT NULL CHECK(result IN ('within_rate','exception','no_reference')),
  note TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(review_id,rfq_line_id),
  FOREIGN KEY(review_id,rfq_id) REFERENCES procurement_rfq_finance_reviews(id,rfq_id) DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY(rfq_line_id,rfq_id) REFERENCES procurement_rfq_lines(id,rfq_id),
  CHECK((result='no_reference' AND rate_card_unit_price_minor IS NULL AND difference_minor IS NULL AND difference_basis_points IS NULL)
     OR (result<>'no_reference' AND rate_card_unit_price_minor IS NOT NULL AND difference_minor IS NOT NULL AND difference_basis_points IS NOT NULL))
) STRICT;

CREATE TRIGGER procurement_rfq_review_complete BEFORE INSERT ON procurement_rfq_finance_reviews
WHEN (SELECT COUNT(*) FROM procurement_rfq_lines WHERE rfq_id=NEW.rfq_id)=0
  OR (SELECT COUNT(*) FROM procurement_rfq_finance_lines WHERE review_id=NEW.id AND rfq_id=NEW.rfq_id)
     <>(SELECT COUNT(*) FROM procurement_rfq_lines WHERE rfq_id=NEW.rfq_id)
  OR EXISTS(
    SELECT 1 FROM procurement_rfq_lines l
    WHERE l.rfq_id=NEW.rfq_id AND NOT EXISTS(
      SELECT 1 FROM procurement_rfq_finance_lines f
      WHERE f.review_id=NEW.id AND f.rfq_id=NEW.rfq_id AND f.rfq_line_id=l.id
        AND f.quote_unit_price_minor=l.quote_unit_price_minor
    )
  )
BEGIN SELECT RAISE(ABORT,'finance verification requires a decision for every RFQ line'); END;

CREATE TRIGGER procurement_rfq_review_guard BEFORE INSERT ON procurement_rfq_finance_reviews
WHEN NOT EXISTS(
  SELECT 1 FROM procurement_rfqs r
  JOIN procurement_purchases p ON p.id=r.purchase_id
  JOIN procurement_awards a ON a.purchase_id=p.id
  JOIN users u ON u.id=NEW.reviewed_by AND u.tenant_id=r.tenant_id AND u.active=1 AND u.role IN ('employee','manager','pm')
  JOIN finance_grants g ON g.tenant_id=r.tenant_id AND g.user_id=u.id AND g.granted_role=u.role
    AND g.action='approve' AND g.revoked_at IS NULL
    AND g.valid_from<=strftime('%Y-%m-%dT%H:%M:%fZ','now') AND g.valid_until>strftime('%Y-%m-%dT%H:%M:%fZ','now')
  WHERE r.id=NEW.rfq_id AND r.purchase_id=NEW.purchase_id AND r.tenant_id=NEW.tenant_id
    AND r.status='pending_finance'
    AND NEW.reviewed_by<>p.requester_id
    AND NEW.reviewed_by<>a.approved_by
    AND NEW.reviewed_by<>r.created_by
)
BEGIN SELECT RAISE(ABORT,'finance verification requires an independent reviewer with an active finance approval grant'); END;

CREATE TRIGGER procurement_rfq_review_applies AFTER INSERT ON procurement_rfq_finance_reviews
BEGIN
  UPDATE procurement_rfqs SET status=NEW.decision WHERE id=NEW.rfq_id;
END;

CREATE TRIGGER procurement_rfqs_frozen BEFORE UPDATE ON procurement_rfqs
WHEN NEW.id<>OLD.id OR NEW.tenant_id<>OLD.tenant_id OR NEW.purchase_id<>OLD.purchase_id OR NEW.quote_id<>OLD.quote_id
  OR NEW.revision<>OLD.revision OR NEW.rfq_number<>OLD.rfq_number OR NEW.request_on<>OLD.request_on
  OR COALESCE(NEW.rfp_reference,'')<>COALESCE(OLD.rfp_reference,'') OR NEW.requesting_department<>OLD.requesting_department
  OR NEW.quotation_on<>OLD.quotation_on OR NEW.vendor_quote_reference<>OLD.vendor_quote_reference
  OR NEW.proposed_payment_terms<>OLD.proposed_payment_terms OR NEW.valid_until<>OLD.valid_until
  OR NEW.subtotal_minor<>OLD.subtotal_minor OR NEW.vat_minor<>OLD.vat_minor OR NEW.total_minor<>OLD.total_minor
  OR NEW.currency<>OLD.currency OR NEW.po_required<>OLD.po_required OR NEW.finance_due_on<>OLD.finance_due_on
  OR NEW.source_reference<>OLD.source_reference OR NEW.created_by<>OLD.created_by
  OR NEW.purchase_version<>OLD.purchase_version OR NEW.created_at<>OLD.created_at
  OR OLD.status<>'pending_finance' OR NEW.status NOT IN ('approved','changes_required','rejected')
BEGIN SELECT RAISE(ABORT,'RFQ submission is immutable outside its finance decision'); END;

CREATE TRIGGER procurement_rfqs_no_delete BEFORE DELETE ON procurement_rfqs
BEGIN SELECT RAISE(ABORT,'RFQ history is immutable'); END;
CREATE TRIGGER procurement_rfq_lines_no_update BEFORE UPDATE ON procurement_rfq_lines
BEGIN SELECT RAISE(ABORT,'RFQ lines are immutable'); END;
CREATE TRIGGER procurement_rfq_lines_no_delete BEFORE DELETE ON procurement_rfq_lines
BEGIN SELECT RAISE(ABORT,'RFQ lines are immutable'); END;
CREATE TRIGGER procurement_rfq_reviews_no_update BEFORE UPDATE ON procurement_rfq_finance_reviews
BEGIN SELECT RAISE(ABORT,'finance review is immutable'); END;
CREATE TRIGGER procurement_rfq_reviews_no_delete BEFORE DELETE ON procurement_rfq_finance_reviews
BEGIN SELECT RAISE(ABORT,'finance review is immutable'); END;
CREATE TRIGGER procurement_rfq_finance_lines_no_update BEFORE UPDATE ON procurement_rfq_finance_lines
BEGIN SELECT RAISE(ABORT,'finance comparison lines are immutable'); END;
CREATE TRIGGER procurement_rfq_finance_lines_no_delete BEFORE DELETE ON procurement_rfq_finance_lines
BEGIN SELECT RAISE(ABORT,'finance comparison lines are immutable'); END;

DROP TRIGGER procurement_order_guard;
CREATE TRIGGER procurement_order_guard BEFORE INSERT ON procurement_orders
WHEN NOT EXISTS(
  SELECT 1 FROM procurement_purchases p
  JOIN procurement_awards a ON a.purchase_id=p.id
  JOIN procurement_quotes q ON q.id=a.quote_id
  WHERE p.id=NEW.purchase_id AND p.status='awarded' AND p.requester_id<>NEW.approved_by
    AND NEW.quantity=p.quantity AND NEW.supplier_key=q.supplier_key AND NEW.supplier_name=q.supplier_name
    AND NEW.unit_price_minor=q.unit_price_minor AND NEW.total_minor=q.total_minor
    AND (
      NOT EXISTS(SELECT 1 FROM procurement_rfq_policies x WHERE x.tenant_id=p.tenant_id AND x.required=1)
      OR EXISTS(
        SELECT 1 FROM procurement_rfqs r
        JOIN procurement_rfq_finance_reviews f ON f.rfq_id=r.id AND f.decision='approved'
        WHERE r.purchase_id=p.id AND r.quote_id=a.quote_id AND r.status='approved' AND r.po_required=1
          AND f.reviewed_by<>NEW.approved_by
          AND r.subtotal_minor=q.total_minor
          AND (SELECT COUNT(*) FROM procurement_rfq_lines rl WHERE rl.rfq_id=r.id)
             =(SELECT COUNT(*) FROM procurement_quote_lines ql WHERE ql.quote_id=q.id)
          AND NOT EXISTS(
            SELECT 1 FROM procurement_quote_lines ql
            WHERE ql.quote_id=q.id AND NOT EXISTS(
              SELECT 1 FROM procurement_rfq_lines rl
              WHERE rl.rfq_id=r.id AND rl.purchase_line_id=ql.purchase_line_id
                AND rl.line_no=ql.line_no AND rl.description=ql.description
                AND rl.quantity=ql.quantity AND rl.unit=ql.unit
                AND rl.quote_unit_price_minor=ql.unit_price_minor AND rl.quote_total_minor=ql.total_minor
            )
          )
      )
    )
)
BEGIN SELECT RAISE(ABORT,'order requires award, finance verification and independent authority'); END;
