CREATE TABLE procurement_project_grants (
  project_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  granted_by TEXT NOT NULL REFERENCES users(id),
  evidence TEXT NOT NULL CHECK(length(trim(evidence))>=3),
  created_at TEXT NOT NULL,
  PRIMARY KEY(project_id,user_id),
  FOREIGN KEY(project_id,user_id) REFERENCES project_members(project_id,user_id) ON DELETE CASCADE
) STRICT;

CREATE TABLE procurement_purchases (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  project_id TEXT NOT NULL,
  requester_id TEXT NOT NULL,
  title TEXT NOT NULL,
  specification TEXT NOT NULL,
  cost_center TEXT NOT NULL,
  due_date TEXT NOT NULL,
  quantity INTEGER NOT NULL CHECK(quantity BETWEEN 1 AND 1000000),
  unit TEXT NOT NULL,
  currency TEXT NOT NULL CHECK(currency='SAR'),
  budget_minor INTEGER NOT NULL CHECK(budget_minor BETWEEN 1 AND 1000000000000),
  budget_evidence TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('draft','sourcing','awarded','ordered','part_received','received','rejected','cancelled')),
  version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(id,tenant_id),
  FOREIGN KEY(project_id,tenant_id) REFERENCES projects(id,tenant_id),
  FOREIGN KEY(requester_id,tenant_id) REFERENCES users(id,tenant_id)
) STRICT;

CREATE TABLE procurement_quotes (
  id TEXT PRIMARY KEY,
  purchase_id TEXT NOT NULL REFERENCES procurement_purchases(id),
  supplier_key TEXT NOT NULL,
  supplier_name TEXT NOT NULL,
  unit_price_minor INTEGER NOT NULL CHECK(unit_price_minor BETWEEN 1 AND 1000000000000),
  total_minor INTEGER NOT NULL CHECK(total_minor BETWEEN 1 AND 1000000000000),
  technical_assessment TEXT NOT NULL,
  financial_terms TEXT NOT NULL,
  delivery_date TEXT NOT NULL,
  evidence TEXT NOT NULL,
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL,
  UNIQUE(purchase_id,supplier_key),
  UNIQUE(id,purchase_id)
) STRICT;

CREATE TABLE procurement_awards (
  purchase_id TEXT PRIMARY KEY REFERENCES procurement_purchases(id),
  quote_id TEXT NOT NULL,
  approved_by TEXT NOT NULL REFERENCES users(id),
  note TEXT NOT NULL,
  purchase_version INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY(quote_id,purchase_id) REFERENCES procurement_quotes(id,purchase_id)
) STRICT;

CREATE TABLE procurement_orders (
  id TEXT PRIMARY KEY,
  purchase_id TEXT NOT NULL UNIQUE REFERENCES procurement_awards(purchase_id),
  supplier_key TEXT NOT NULL,
  supplier_name TEXT NOT NULL,
  quantity INTEGER NOT NULL CHECK(quantity BETWEEN 1 AND 1000000),
  unit_price_minor INTEGER NOT NULL CHECK(unit_price_minor BETWEEN 1 AND 1000000000000),
  total_minor INTEGER NOT NULL CHECK(total_minor BETWEEN 1 AND 1000000000000 AND total_minor=quantity*unit_price_minor),
  currency TEXT NOT NULL CHECK(currency='SAR'),
  terms TEXT NOT NULL,
  delivery_date TEXT NOT NULL,
  approved_by TEXT NOT NULL REFERENCES users(id),
  note TEXT NOT NULL,
  purchase_version INTEGER NOT NULL,
  execution_status TEXT NOT NULL DEFAULT 'internal_only' CHECK(execution_status='internal_only'),
  created_at TEXT NOT NULL
) STRICT;

CREATE TABLE procurement_receipts (
  id TEXT PRIMARY KEY,
  purchase_id TEXT NOT NULL REFERENCES procurement_orders(purchase_id),
  quantity INTEGER NOT NULL CHECK(quantity BETWEEN 1 AND 1000000),
  reference TEXT NOT NULL,
  evidence TEXT NOT NULL,
  received_by TEXT NOT NULL REFERENCES users(id),
  purchase_version INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(purchase_id,reference)
) STRICT;

CREATE TABLE procurement_invoices (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  purchase_id TEXT NOT NULL,
  supplier_key TEXT NOT NULL,
  supplier_reference TEXT NOT NULL,
  quantity INTEGER NOT NULL CHECK(quantity BETWEEN 1 AND 1000000),
  amount_minor INTEGER NOT NULL CHECK(amount_minor BETWEEN 1 AND 1000000000000),
  currency TEXT NOT NULL CHECK(currency='SAR'),
  evidence TEXT NOT NULL,
  recorded_by TEXT NOT NULL REFERENCES users(id),
  purchase_version INTEGER NOT NULL,
  document_kind TEXT NOT NULL DEFAULT 'supplier_reference' CHECK(document_kind='supplier_reference'),
  created_at TEXT NOT NULL,
  UNIQUE(tenant_id,supplier_key,supplier_reference),
  UNIQUE(id,purchase_id),
  FOREIGN KEY(purchase_id,tenant_id) REFERENCES procurement_purchases(id,tenant_id),
  FOREIGN KEY(purchase_id) REFERENCES procurement_orders(purchase_id)
) STRICT;

CREATE TABLE procurement_payables (
  id TEXT PRIMARY KEY,
  purchase_id TEXT NOT NULL REFERENCES procurement_orders(purchase_id),
  invoice_id TEXT NOT NULL UNIQUE,
  amount_minor INTEGER NOT NULL CHECK(amount_minor BETWEEN 1 AND 1000000000000),
  currency TEXT NOT NULL CHECK(currency='SAR'),
  matched_by TEXT NOT NULL REFERENCES users(id),
  note TEXT NOT NULL,
  purchase_version INTEGER NOT NULL,
  payment_status TEXT NOT NULL DEFAULT 'not_paid' CHECK(payment_status='not_paid'),
  posting_status TEXT NOT NULL DEFAULT 'not_posted' CHECK(posting_status='not_posted'),
  created_at TEXT NOT NULL,
  FOREIGN KEY(invoice_id,purchase_id) REFERENCES procurement_invoices(id,purchase_id)
) STRICT;

CREATE TABLE procurement_versions (
  purchase_id TEXT NOT NULL REFERENCES procurement_purchases(id),
  version INTEGER NOT NULL,
  action TEXT NOT NULL,
  actor_id TEXT NOT NULL REFERENCES users(id),
  snapshot TEXT NOT NULL CHECK(json_valid(snapshot)),
  created_at TEXT NOT NULL,
  PRIMARY KEY(purchase_id,version)
) STRICT;
CREATE INDEX procurement_scope ON procurement_purchases(tenant_id,project_id,requester_id);

CREATE TRIGGER procurement_grant_scope BEFORE INSERT ON procurement_project_grants
WHEN NOT EXISTS(SELECT 1 FROM projects p JOIN users g ON g.id=NEW.granted_by AND g.tenant_id=p.tenant_id JOIN users u ON u.id=NEW.user_id AND u.tenant_id=p.tenant_id JOIN project_members m ON m.project_id=p.id AND m.user_id=g.id WHERE p.id=NEW.project_id AND p.created_by=g.id AND g.role='manager' AND g.active=1 AND u.role='pm' AND u.active=1 AND g.id<>u.id)
BEGIN SELECT RAISE(ABORT,'cost grant requires a separate project manager approval'); END;
CREATE TRIGGER procurement_grant_no_update BEFORE UPDATE ON procurement_project_grants
BEGIN SELECT RAISE(ABORT,'replace a cost grant with a dated authorization'); END;
CREATE TRIGGER procurement_initial BEFORE INSERT ON procurement_purchases
WHEN NEW.status<>'draft' OR NEW.version<>1
BEGIN SELECT RAISE(ABORT,'new purchase must start as draft version one'); END;
CREATE TRIGGER procurement_identity BEFORE UPDATE ON procurement_purchases
WHEN NEW.id<>OLD.id OR NEW.tenant_id<>OLD.tenant_id OR NEW.project_id<>OLD.project_id OR NEW.requester_id<>OLD.requester_id OR NEW.created_at<>OLD.created_at OR NEW.version<>OLD.version+1
BEGIN SELECT RAISE(ABORT,'purchase identity and version are protected'); END;
CREATE TRIGGER procurement_state BEFORE UPDATE ON procurement_purchases
WHEN NOT ((OLD.status='draft' AND NEW.status IN ('draft','sourcing','cancelled'))
 OR (OLD.status='sourcing' AND NEW.status IN ('sourcing','awarded','rejected','cancelled'))
 OR (OLD.status='awarded' AND NEW.status IN ('ordered','rejected'))
 OR (OLD.status='ordered' AND NEW.status IN ('ordered','part_received','received'))
 OR (OLD.status='part_received' AND NEW.status IN ('part_received','received'))
 OR (OLD.status='received' AND NEW.status='received'))
BEGIN SELECT RAISE(ABORT,'purchase state cannot skip or reopen a settled version'); END;
CREATE TRIGGER procurement_frozen BEFORE UPDATE ON procurement_purchases
WHEN OLD.status<>'draft' AND (NEW.title<>OLD.title OR NEW.specification<>OLD.specification OR NEW.cost_center<>OLD.cost_center OR NEW.due_date<>OLD.due_date OR NEW.quantity<>OLD.quantity OR NEW.unit<>OLD.unit OR NEW.currency<>OLD.currency OR NEW.budget_minor<>OLD.budget_minor OR NEW.budget_evidence<>OLD.budget_evidence)
BEGIN SELECT RAISE(ABORT,'submitted purchase is immutable'); END;
CREATE TRIGGER procurement_no_delete BEFORE DELETE ON procurement_purchases
BEGIN SELECT RAISE(ABORT,'purchase history is immutable'); END;
CREATE TRIGGER procurement_quote_state BEFORE INSERT ON procurement_quotes
WHEN NOT EXISTS(SELECT 1 FROM procurement_purchases p WHERE p.id=NEW.purchase_id AND p.status='sourcing' AND p.requester_id=NEW.created_by AND NEW.total_minor=p.quantity*NEW.unit_price_minor)
BEGIN SELECT RAISE(ABORT,'quote requires sourcing state and matching total'); END;
CREATE TRIGGER procurement_award_guard BEFORE INSERT ON procurement_awards
WHEN NOT EXISTS(SELECT 1 FROM procurement_purchases p JOIN procurement_quotes q ON q.purchase_id=p.id WHERE p.id=NEW.purchase_id AND p.status='sourcing' AND p.requester_id<>NEW.approved_by AND q.id=NEW.quote_id AND q.total_minor<=p.budget_minor AND (SELECT COUNT(*) FROM procurement_quotes WHERE purchase_id=p.id)>=2)
BEGIN SELECT RAISE(ABORT,'award requires comparison, funds and independent approval'); END;
CREATE TRIGGER procurement_order_guard BEFORE INSERT ON procurement_orders
WHEN NOT EXISTS(SELECT 1 FROM procurement_purchases p JOIN procurement_awards a ON a.purchase_id=p.id JOIN procurement_quotes q ON q.id=a.quote_id WHERE p.id=NEW.purchase_id AND p.status='awarded' AND p.requester_id<>NEW.approved_by AND NEW.quantity=p.quantity AND NEW.supplier_key=q.supplier_key AND NEW.supplier_name=q.supplier_name AND NEW.unit_price_minor=q.unit_price_minor AND NEW.total_minor=q.total_minor)
BEGIN SELECT RAISE(ABORT,'order requires an independently approved award'); END;
CREATE TRIGGER procurement_receipt_limit BEFORE INSERT ON procurement_receipts
WHEN NOT EXISTS(SELECT 1 FROM procurement_orders o JOIN procurement_purchases p ON p.id=o.purchase_id WHERE p.id=NEW.purchase_id AND p.status IN ('ordered','part_received') AND NEW.quantity+COALESCE((SELECT SUM(quantity) FROM procurement_receipts WHERE purchase_id=p.id),0)<=o.quantity)
BEGIN SELECT RAISE(ABORT,'receipt exceeds approved order'); END;
CREATE TRIGGER procurement_invoice_limit BEFORE INSERT ON procurement_invoices
WHEN NOT EXISTS(SELECT 1 FROM procurement_orders o JOIN procurement_purchases p ON p.id=o.purchase_id WHERE p.id=NEW.purchase_id AND p.status IN ('ordered','part_received','received') AND NEW.tenant_id=p.tenant_id AND NEW.supplier_key=o.supplier_key AND NEW.currency=o.currency AND NEW.amount_minor=NEW.quantity*o.unit_price_minor AND NEW.quantity+COALESCE((SELECT SUM(quantity) FROM procurement_invoices WHERE purchase_id=p.id),0)<=o.quantity AND NEW.amount_minor+COALESCE((SELECT SUM(amount_minor) FROM procurement_invoices WHERE purchase_id=p.id),0)<=o.total_minor)
BEGIN SELECT RAISE(ABORT,'invoice does not match approved order'); END;
CREATE TRIGGER procurement_match_guard BEFORE INSERT ON procurement_payables
WHEN NOT EXISTS(SELECT 1 FROM procurement_invoices i JOIN procurement_orders o ON o.purchase_id=i.purchase_id JOIN procurement_purchases p ON p.id=o.purchase_id WHERE i.id=NEW.invoice_id AND i.purchase_id=NEW.purchase_id AND p.status IN ('part_received','received') AND NEW.matched_by<>p.requester_id AND NEW.matched_by<>i.recorded_by AND NEW.amount_minor=i.amount_minor AND NEW.currency=i.currency AND i.amount_minor=i.quantity*o.unit_price_minor AND i.quantity+COALESCE((SELECT SUM(ii.quantity) FROM procurement_payables x JOIN procurement_invoices ii ON ii.id=x.invoice_id WHERE x.purchase_id=p.id),0)<=COALESCE((SELECT SUM(quantity) FROM procurement_receipts WHERE purchase_id=p.id),0))
BEGIN SELECT RAISE(ABORT,'three way match requires receipt and independent approval'); END;

CREATE TRIGGER procurement_quotes_no_update BEFORE UPDATE ON procurement_quotes BEGIN SELECT RAISE(ABORT,'quote is immutable'); END;
CREATE TRIGGER procurement_quotes_no_delete BEFORE DELETE ON procurement_quotes BEGIN SELECT RAISE(ABORT,'quote is immutable'); END;
CREATE TRIGGER procurement_awards_no_update BEFORE UPDATE ON procurement_awards BEGIN SELECT RAISE(ABORT,'award is immutable'); END;
CREATE TRIGGER procurement_awards_no_delete BEFORE DELETE ON procurement_awards BEGIN SELECT RAISE(ABORT,'award is immutable'); END;
CREATE TRIGGER procurement_orders_no_update BEFORE UPDATE ON procurement_orders BEGIN SELECT RAISE(ABORT,'order is immutable'); END;
CREATE TRIGGER procurement_orders_no_delete BEFORE DELETE ON procurement_orders BEGIN SELECT RAISE(ABORT,'order is immutable'); END;
CREATE TRIGGER procurement_receipts_no_update BEFORE UPDATE ON procurement_receipts BEGIN SELECT RAISE(ABORT,'receipt is immutable'); END;
CREATE TRIGGER procurement_receipts_no_delete BEFORE DELETE ON procurement_receipts BEGIN SELECT RAISE(ABORT,'receipt is immutable'); END;
CREATE TRIGGER procurement_invoices_no_update BEFORE UPDATE ON procurement_invoices BEGIN SELECT RAISE(ABORT,'invoice reference is immutable'); END;
CREATE TRIGGER procurement_invoices_no_delete BEFORE DELETE ON procurement_invoices BEGIN SELECT RAISE(ABORT,'invoice reference is immutable'); END;
CREATE TRIGGER procurement_payables_no_update BEFORE UPDATE ON procurement_payables BEGIN SELECT RAISE(ABORT,'payable is immutable'); END;
CREATE TRIGGER procurement_payables_no_delete BEFORE DELETE ON procurement_payables BEGIN SELECT RAISE(ABORT,'payable is immutable'); END;
CREATE TRIGGER procurement_versions_no_update BEFORE UPDATE ON procurement_versions BEGIN SELECT RAISE(ABORT,'purchase version is immutable'); END;
CREATE TRIGGER procurement_versions_no_delete BEFORE DELETE ON procurement_versions BEGIN SELECT RAISE(ABORT,'purchase version is immutable'); END;
