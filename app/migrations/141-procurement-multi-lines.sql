-- الترحيل 141: تسعير ودورة تنفيذ متعددة البنود. تبقى رؤوس المستندات للتوافق، وتصبح البنود
-- المصدر المحاسبي للكميات والأسعار والاستلام والفاتورة والمطابقة.

CREATE TABLE procurement_quote_lines (
  id TEXT PRIMARY KEY,
  quote_id TEXT NOT NULL,
  purchase_id TEXT NOT NULL REFERENCES procurement_purchases(id),
  purchase_line_id TEXT NOT NULL,
  line_no INTEGER NOT NULL CHECK(line_no BETWEEN 1 AND 10000),
  description TEXT NOT NULL CHECK(length(trim(description))>=3),
  quantity INTEGER NOT NULL CHECK(quantity BETWEEN 1 AND 1000000),
  unit TEXT NOT NULL CHECK(length(trim(unit))>=1),
  unit_price_minor INTEGER NOT NULL CHECK(unit_price_minor BETWEEN 1 AND 1000000000000),
  total_minor INTEGER NOT NULL CHECK(total_minor BETWEEN 1 AND 1000000000000 AND total_minor=quantity*unit_price_minor),
  currency TEXT NOT NULL CHECK(currency='SAR'),
  created_at TEXT NOT NULL,
  UNIQUE(quote_id,line_no),
  UNIQUE(quote_id,purchase_line_id),
  FOREIGN KEY(quote_id,purchase_id) REFERENCES procurement_quotes(id,purchase_id),
  FOREIGN KEY(purchase_line_id,purchase_id) REFERENCES procurement_purchase_lines(id,purchase_id)
) STRICT;

CREATE INDEX procurement_quote_lines_purchase ON procurement_quote_lines(purchase_id,quote_id,line_no);

INSERT INTO procurement_quote_lines(id,quote_id,purchase_id,purchase_line_id,line_no,description,quantity,unit,unit_price_minor,total_minor,currency,created_at)
SELECT 'legacy-quote-line:'||q.id,q.id,q.purchase_id,l.id,l.line_no,l.description,l.quantity,l.unit,q.unit_price_minor,q.total_minor,p.currency,q.created_at
FROM procurement_quotes q JOIN procurement_purchases p ON p.id=q.purchase_id
JOIN procurement_purchase_lines l ON l.purchase_id=q.purchase_id AND l.line_no=1;

CREATE TRIGGER procurement_quote_lines_no_update BEFORE UPDATE ON procurement_quote_lines
BEGIN SELECT RAISE(ABORT,'quote lines are immutable'); END;
CREATE TRIGGER procurement_quote_lines_no_delete BEFORE DELETE ON procurement_quote_lines
BEGIN SELECT RAISE(ABORT,'quote lines are immutable'); END;

-- الرؤوس القديمة تضرب الكمية في سعر واحد. بعد تعدد البنود يتحقق الحد من مجموع
-- البنود وتتحقق المطابقة الدقيقة عند نقطة الانتقال الذرية أدناه.
DROP TRIGGER procurement_receipt_limit;
CREATE TRIGGER procurement_receipt_limit BEFORE INSERT ON procurement_receipts
WHEN NOT EXISTS(
  SELECT 1 FROM procurement_orders o JOIN procurement_purchases p ON p.id=o.purchase_id
  WHERE p.id=NEW.purchase_id AND p.status IN ('ordered','part_received')
    AND NEW.quantity+COALESCE((SELECT SUM(quantity) FROM procurement_receipts WHERE purchase_id=p.id),0)
      <=COALESCE((SELECT SUM(quantity) FROM procurement_order_lines WHERE purchase_id=p.id),0)
)
BEGIN SELECT RAISE(ABORT,'receipt exceeds approved order'); END;

DROP TRIGGER procurement_invoice_limit;
CREATE TRIGGER procurement_invoice_limit BEFORE INSERT ON procurement_invoices
WHEN NOT EXISTS(
  SELECT 1 FROM procurement_orders o JOIN procurement_purchases p ON p.id=o.purchase_id
  WHERE p.id=NEW.purchase_id AND p.status IN ('ordered','part_received','received')
    AND NEW.tenant_id=p.tenant_id AND NEW.supplier_key=o.supplier_key AND NEW.currency=o.currency
    AND NEW.quantity+COALESCE((SELECT SUM(quantity) FROM procurement_invoices WHERE purchase_id=p.id),0)
      <=COALESCE((SELECT SUM(quantity) FROM procurement_order_lines WHERE purchase_id=p.id),0)
    AND NEW.amount_minor+COALESCE((SELECT SUM(amount_minor) FROM procurement_invoices WHERE purchase_id=p.id),0)<=o.total_minor
)
BEGIN SELECT RAISE(ABORT,'invoice does not match approved order'); END;

DROP TRIGGER procurement_match_guard;
CREATE TRIGGER procurement_match_guard BEFORE INSERT ON procurement_payables
WHEN NOT EXISTS(
  SELECT 1 FROM procurement_invoices i JOIN procurement_orders o ON o.purchase_id=i.purchase_id JOIN procurement_purchases p ON p.id=o.purchase_id
  WHERE i.id=NEW.invoice_id AND i.purchase_id=NEW.purchase_id AND p.status IN ('part_received','received')
    AND NEW.matched_by<>p.requester_id AND NEW.matched_by<>i.recorded_by
    AND NEW.amount_minor=i.amount_minor AND NEW.currency=i.currency
    AND EXISTS(SELECT 1 FROM procurement_invoice_lines il WHERE il.invoice_id=i.id)
    AND NOT EXISTS(
      SELECT 1 FROM procurement_invoice_lines il JOIN procurement_order_lines ol ON ol.id=il.order_line_id
      WHERE il.invoice_id=i.id AND (
        il.amount_minor<>il.quantity*ol.unit_price_minor
        OR il.quantity+COALESCE((
          SELECT SUM(pl.quantity) FROM procurement_payable_lines pl
          JOIN procurement_payables px ON px.id=pl.payable_id
          WHERE pl.order_line_id=il.order_line_id AND px.purchase_id=p.id
        ),0)>COALESCE((
          SELECT SUM(rl.quantity) FROM procurement_receipt_lines rl
          WHERE rl.order_line_id=il.order_line_id AND rl.purchase_id=p.id
        ),0)
      )
    )
)
BEGIN SELECT RAISE(ABORT,'three way match requires receipt and independent approval'); END;

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
      SELECT 1 FROM procurement_order_lines ol WHERE ol.purchase_id=OLD.id AND (
        COALESCE((SELECT SUM(quantity) FROM procurement_invoice_lines il WHERE il.order_line_id=ol.id),0)>ol.quantity
        OR COALESCE((SELECT SUM(amount_minor) FROM procurement_invoice_lines il WHERE il.order_line_id=ol.id),0)>ol.total_minor
        OR EXISTS(SELECT 1 FROM procurement_invoice_lines il WHERE il.order_line_id=ol.id AND il.amount_minor<>il.quantity*ol.unit_price_minor)
      )
    )
    OR EXISTS(SELECT 1 FROM procurement_payables x WHERE x.purchase_id=OLD.id AND (
         COALESCE((SELECT SUM(amount_minor) FROM procurement_payable_lines l WHERE l.payable_id=x.id),0)<>x.amount_minor
         OR (SELECT COUNT(*) FROM procurement_payable_lines l WHERE l.payable_id=x.id)<>(SELECT COUNT(*) FROM procurement_invoice_lines l WHERE l.invoice_id=x.invoice_id)))
  )
BEGIN SELECT RAISE(ABORT,'procurement document lines do not reconcile'); END;
