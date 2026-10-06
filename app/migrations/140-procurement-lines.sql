-- الترحيل 140: أساس البنود في دورة المشتريات. الطلبات السابقة تتحول إلى سطر واحد صريح دون تخمين سعر
-- قبل عرض المورد، وتبقى لقطات الأمر والاستلام والفاتورة والمطابقة مرتبطة بالمعرّف نفسه.

CREATE TABLE procurement_purchase_lines (
  id TEXT PRIMARY KEY,
  purchase_id TEXT NOT NULL REFERENCES procurement_purchases(id),
  line_no INTEGER NOT NULL CHECK(line_no BETWEEN 1 AND 10000),
  description TEXT NOT NULL CHECK(length(trim(description))>=3),
  quantity INTEGER NOT NULL CHECK(quantity BETWEEN 1 AND 1000000),
  unit TEXT NOT NULL CHECK(length(trim(unit))>=1),
  currency TEXT NOT NULL CHECK(currency='SAR'),
  unit_price_minor INTEGER CHECK(unit_price_minor BETWEEN 1 AND 1000000000000),
  price_source TEXT NOT NULL CHECK(price_source IN ('not_priced','awarded_order')),
  purchase_version INTEGER NOT NULL CHECK(purchase_version>0),
  created_at TEXT NOT NULL,
  UNIQUE(purchase_id,line_no),
  UNIQUE(id,purchase_id),
  CHECK((unit_price_minor IS NULL)=(price_source='not_priced')),
  CHECK(unit_price_minor IS NULL OR quantity*unit_price_minor<=1000000000000)
) STRICT;

CREATE TABLE procurement_line_allocations (
  id TEXT PRIMARY KEY,
  purchase_id TEXT NOT NULL,
  purchase_line_id TEXT NOT NULL,
  position INTEGER NOT NULL CHECK(position BETWEEN 1 AND 1000),
  cost_center_id TEXT REFERENCES finance_cost_centers(id),
  cost_center TEXT NOT NULL CHECK(length(trim(cost_center))>=1),
  amount_minor INTEGER NOT NULL CHECK(amount_minor BETWEEN 1 AND 1000000000000),
  currency TEXT NOT NULL CHECK(currency='SAR'),
  basis TEXT NOT NULL CHECK(basis='purchase_budget'),
  purchase_version INTEGER NOT NULL CHECK(purchase_version>0),
  created_at TEXT NOT NULL,
  UNIQUE(purchase_line_id,position),
  FOREIGN KEY(purchase_line_id,purchase_id) REFERENCES procurement_purchase_lines(id,purchase_id)
) STRICT;

CREATE TABLE procurement_order_lines (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL,
  purchase_id TEXT NOT NULL REFERENCES procurement_purchases(id),
  purchase_line_id TEXT NOT NULL,
  line_no INTEGER NOT NULL CHECK(line_no BETWEEN 1 AND 10000),
  description TEXT NOT NULL CHECK(length(trim(description))>=3),
  quantity INTEGER NOT NULL CHECK(quantity BETWEEN 1 AND 1000000),
  unit TEXT NOT NULL CHECK(length(trim(unit))>=1),
  unit_price_minor INTEGER NOT NULL CHECK(unit_price_minor BETWEEN 1 AND 1000000000000),
  total_minor INTEGER NOT NULL CHECK(total_minor BETWEEN 1 AND 1000000000000 AND total_minor=quantity*unit_price_minor),
  allocated_minor INTEGER NOT NULL CHECK(allocated_minor=total_minor),
  currency TEXT NOT NULL CHECK(currency='SAR'),
  cost_center_id TEXT REFERENCES finance_cost_centers(id),
  cost_center TEXT NOT NULL CHECK(length(trim(cost_center))>=1),
  purchase_version INTEGER NOT NULL CHECK(purchase_version>0),
  created_at TEXT NOT NULL,
  UNIQUE(order_id,line_no),
  UNIQUE(id,purchase_id),
  FOREIGN KEY(order_id,purchase_id) REFERENCES procurement_orders(id,purchase_id),
  FOREIGN KEY(purchase_line_id,purchase_id) REFERENCES procurement_purchase_lines(id,purchase_id)
) STRICT;

CREATE TABLE procurement_receipt_lines (
  id TEXT PRIMARY KEY,
  receipt_id TEXT NOT NULL,
  purchase_id TEXT NOT NULL REFERENCES procurement_purchases(id),
  order_line_id TEXT NOT NULL,
  quantity INTEGER NOT NULL CHECK(quantity BETWEEN 1 AND 1000000),
  created_at TEXT NOT NULL,
  UNIQUE(receipt_id,order_line_id),
  FOREIGN KEY(receipt_id,purchase_id) REFERENCES procurement_receipts(id,purchase_id),
  FOREIGN KEY(order_line_id,purchase_id) REFERENCES procurement_order_lines(id,purchase_id)
) STRICT;

CREATE TABLE procurement_invoice_lines (
  id TEXT PRIMARY KEY,
  invoice_id TEXT NOT NULL,
  purchase_id TEXT NOT NULL REFERENCES procurement_purchases(id),
  order_line_id TEXT NOT NULL,
  quantity INTEGER NOT NULL CHECK(quantity BETWEEN 1 AND 1000000),
  amount_minor INTEGER NOT NULL CHECK(amount_minor BETWEEN 1 AND 1000000000000),
  currency TEXT NOT NULL CHECK(currency='SAR'),
  created_at TEXT NOT NULL,
  UNIQUE(invoice_id,order_line_id),
  UNIQUE(id,order_line_id,purchase_id),
  FOREIGN KEY(invoice_id,purchase_id) REFERENCES procurement_invoices(id,purchase_id),
  FOREIGN KEY(order_line_id,purchase_id) REFERENCES procurement_order_lines(id,purchase_id)
) STRICT;

CREATE TABLE procurement_payable_lines (
  id TEXT PRIMARY KEY,
  payable_id TEXT NOT NULL,
  purchase_id TEXT NOT NULL REFERENCES procurement_purchases(id),
  invoice_line_id TEXT NOT NULL,
  order_line_id TEXT NOT NULL,
  quantity INTEGER NOT NULL CHECK(quantity BETWEEN 1 AND 1000000),
  amount_minor INTEGER NOT NULL CHECK(amount_minor BETWEEN 1 AND 1000000000000),
  currency TEXT NOT NULL CHECK(currency='SAR'),
  created_at TEXT NOT NULL,
  UNIQUE(payable_id,invoice_line_id),
  FOREIGN KEY(payable_id,purchase_id) REFERENCES procurement_payables(id,purchase_id),
  FOREIGN KEY(invoice_line_id,order_line_id,purchase_id) REFERENCES procurement_invoice_lines(id,order_line_id,purchase_id)
) STRICT;

-- المفاتيح المركبة تمنع خلط رؤوس المستندات وبنود طلبات مختلفة عند الكتابة المباشرة.
CREATE UNIQUE INDEX procurement_orders_identity ON procurement_orders(id,purchase_id);
CREATE UNIQUE INDEX procurement_receipts_identity ON procurement_receipts(id,purchase_id);
CREATE UNIQUE INDEX procurement_payables_identity ON procurement_payables(id,purchase_id);

INSERT INTO procurement_purchase_lines(id,purchase_id,line_no,description,quantity,unit,currency,unit_price_minor,price_source,purchase_version,created_at)
SELECT 'legacy-line:'||p.id,p.id,1,p.specification,p.quantity,p.unit,p.currency,NULL,
       'not_priced',p.version,p.created_at
FROM procurement_purchases p;

INSERT INTO procurement_line_allocations(id,purchase_id,purchase_line_id,position,cost_center_id,cost_center,amount_minor,currency,basis,purchase_version,created_at)
SELECT 'legacy-allocation:'||p.id,p.id,'legacy-line:'||p.id,1,p.cost_center_id,p.cost_center,p.budget_minor,p.currency,'purchase_budget',p.version,p.created_at
FROM procurement_purchases p;

INSERT INTO procurement_order_lines(id,order_id,purchase_id,purchase_line_id,line_no,description,quantity,unit,unit_price_minor,total_minor,allocated_minor,currency,cost_center_id,cost_center,purchase_version,created_at)
SELECT 'legacy-order-line:'||o.id,o.id,o.purchase_id,l.id,1,l.description,o.quantity,l.unit,o.unit_price_minor,o.total_minor,o.total_minor,o.currency,a.cost_center_id,a.cost_center,o.purchase_version,o.created_at
FROM procurement_orders o
JOIN procurement_purchase_lines l ON l.purchase_id=o.purchase_id AND l.line_no=1
JOIN procurement_line_allocations a ON a.purchase_line_id=l.id AND a.position=1;

INSERT INTO procurement_receipt_lines(id,receipt_id,purchase_id,order_line_id,quantity,created_at)
SELECT 'legacy-receipt-line:'||r.id,r.id,r.purchase_id,ol.id,r.quantity,r.created_at
FROM procurement_receipts r JOIN procurement_order_lines ol ON ol.purchase_id=r.purchase_id AND ol.line_no=1;

INSERT INTO procurement_invoice_lines(id,invoice_id,purchase_id,order_line_id,quantity,amount_minor,currency,created_at)
SELECT 'legacy-invoice-line:'||i.id,i.id,i.purchase_id,ol.id,i.quantity,i.amount_minor,i.currency,i.created_at
FROM procurement_invoices i JOIN procurement_order_lines ol ON ol.purchase_id=i.purchase_id AND ol.line_no=1;

INSERT INTO procurement_payable_lines(id,payable_id,purchase_id,invoice_line_id,order_line_id,quantity,amount_minor,currency,created_at)
SELECT 'legacy-payable-line:'||x.id,x.id,x.purchase_id,il.id,il.order_line_id,il.quantity,x.amount_minor,x.currency,x.created_at
FROM procurement_payables x JOIN procurement_invoice_lines il ON il.invoice_id=x.invoice_id;

CREATE INDEX procurement_purchase_lines_purchase ON procurement_purchase_lines(purchase_id,line_no);
CREATE INDEX procurement_allocations_purchase ON procurement_line_allocations(purchase_id,purchase_line_id);
CREATE INDEX procurement_order_lines_purchase ON procurement_order_lines(purchase_id,line_no);
CREATE INDEX procurement_receipt_lines_purchase ON procurement_receipt_lines(purchase_id,order_line_id);
CREATE INDEX procurement_invoice_lines_purchase ON procurement_invoice_lines(purchase_id,order_line_id);
CREATE INDEX procurement_payable_lines_purchase ON procurement_payable_lines(purchase_id,order_line_id);

CREATE TRIGGER procurement_purchase_lines_update BEFORE UPDATE ON procurement_purchase_lines
WHEN EXISTS(SELECT 1 FROM procurement_purchases p WHERE p.id=OLD.purchase_id AND p.status<>'draft')
  OR NEW.id<>OLD.id OR NEW.purchase_id<>OLD.purchase_id OR NEW.line_no<>OLD.line_no OR NEW.created_at<>OLD.created_at
  OR NEW.purchase_version<>OLD.purchase_version+1
BEGIN SELECT RAISE(ABORT,'submitted purchase lines are immutable'); END;
CREATE TRIGGER procurement_purchase_lines_no_delete BEFORE DELETE ON procurement_purchase_lines
BEGIN SELECT RAISE(ABORT,'purchase lines are retained'); END;

CREATE TRIGGER procurement_line_allocations_update BEFORE UPDATE ON procurement_line_allocations
WHEN EXISTS(SELECT 1 FROM procurement_purchases p WHERE p.id=OLD.purchase_id AND p.status<>'draft')
  OR NEW.id<>OLD.id OR NEW.purchase_id<>OLD.purchase_id OR NEW.purchase_line_id<>OLD.purchase_line_id OR NEW.position<>OLD.position OR NEW.created_at<>OLD.created_at
  OR NEW.purchase_version<>OLD.purchase_version+1
BEGIN SELECT RAISE(ABORT,'submitted purchase allocations are immutable'); END;
CREATE TRIGGER procurement_line_allocations_no_delete BEFORE DELETE ON procurement_line_allocations
BEGIN SELECT RAISE(ABORT,'purchase allocations are retained'); END;

CREATE TRIGGER procurement_order_lines_no_update BEFORE UPDATE ON procurement_order_lines BEGIN SELECT RAISE(ABORT,'order lines are immutable'); END;
CREATE TRIGGER procurement_order_lines_no_delete BEFORE DELETE ON procurement_order_lines BEGIN SELECT RAISE(ABORT,'order lines are immutable'); END;
CREATE TRIGGER procurement_receipt_lines_no_update BEFORE UPDATE ON procurement_receipt_lines BEGIN SELECT RAISE(ABORT,'receipt lines are immutable'); END;
CREATE TRIGGER procurement_receipt_lines_no_delete BEFORE DELETE ON procurement_receipt_lines BEGIN SELECT RAISE(ABORT,'receipt lines are immutable'); END;
CREATE TRIGGER procurement_invoice_lines_no_update BEFORE UPDATE ON procurement_invoice_lines BEGIN SELECT RAISE(ABORT,'invoice lines are immutable'); END;
CREATE TRIGGER procurement_invoice_lines_no_delete BEFORE DELETE ON procurement_invoice_lines BEGIN SELECT RAISE(ABORT,'invoice lines are immutable'); END;
CREATE TRIGGER procurement_payable_lines_no_update BEFORE UPDATE ON procurement_payable_lines BEGIN SELECT RAISE(ABORT,'payable lines are immutable'); END;
CREATE TRIGGER procurement_payable_lines_no_delete BEFORE DELETE ON procurement_payable_lines BEGIN SELECT RAISE(ABORT,'payable lines are immutable'); END;

-- كل انتقال للطلب هو نقطة تحقق ذرية: لا يصبح الأمر أو الاستلام أو الفاتورة أو المطابقة مرئيًا
-- في نسخة جديدة إن كان رأس المستند لا يساوي مجموع بنوده.
CREATE TRIGGER procurement_lines_consistency BEFORE UPDATE ON procurement_purchases
WHEN NOT (OLD.status<>'draft' AND (NEW.title<>OLD.title OR NEW.specification<>OLD.specification OR NEW.cost_center<>OLD.cost_center
       OR NEW.due_date<>OLD.due_date OR NEW.quantity<>OLD.quantity OR NEW.unit<>OLD.unit OR NEW.currency<>OLD.currency
       OR NEW.budget_minor<>OLD.budget_minor OR NEW.budget_evidence<>OLD.budget_evidence))
  AND (COALESCE((SELECT SUM(quantity) FROM procurement_purchase_lines WHERE purchase_id=OLD.id),0)<>NEW.quantity
  OR COALESCE((SELECT SUM(amount_minor) FROM procurement_line_allocations WHERE purchase_id=OLD.id),0)<>NEW.budget_minor
  OR EXISTS(SELECT 1 FROM procurement_orders o WHERE o.purchase_id=OLD.id AND (
       COALESCE((SELECT SUM(quantity) FROM procurement_order_lines l WHERE l.order_id=o.id),0)<>o.quantity
       OR COALESCE((SELECT SUM(total_minor) FROM procurement_order_lines l WHERE l.order_id=o.id),0)<>o.total_minor
       OR COALESCE((SELECT SUM(allocated_minor) FROM procurement_order_lines l WHERE l.order_id=o.id),0)<>o.total_minor))
  OR EXISTS(SELECT 1 FROM procurement_receipts r WHERE r.purchase_id=OLD.id AND COALESCE((SELECT SUM(quantity) FROM procurement_receipt_lines l WHERE l.receipt_id=r.id),0)<>r.quantity)
  OR EXISTS(SELECT 1 FROM procurement_invoices i WHERE i.purchase_id=OLD.id AND (
       COALESCE((SELECT SUM(quantity) FROM procurement_invoice_lines l WHERE l.invoice_id=i.id),0)<>i.quantity
       OR COALESCE((SELECT SUM(amount_minor) FROM procurement_invoice_lines l WHERE l.invoice_id=i.id),0)<>i.amount_minor))
  OR EXISTS(SELECT 1 FROM procurement_payables x WHERE x.purchase_id=OLD.id AND COALESCE((SELECT SUM(amount_minor) FROM procurement_payable_lines l WHERE l.payable_id=x.id),0)<>x.amount_minor))
BEGIN SELECT RAISE(ABORT,'procurement document lines do not reconcile'); END;
