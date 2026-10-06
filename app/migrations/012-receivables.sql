CREATE TABLE ar_claims (
 id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id), contract_id TEXT NOT NULL REFERENCES commercial_contracts(id),
 project_id TEXT NOT NULL, case_id TEXT NOT NULL REFERENCES commercial_cases(id), prepared_by TEXT NOT NULL,
 basis TEXT NOT NULL CHECK(basis IN ('delivery','advance')), delivery_id TEXT REFERENCES commercial_deliveries(id), advance_clause TEXT NOT NULL DEFAULT '',
 source_snapshot TEXT NOT NULL CHECK(json_valid(source_snapshot)), currency TEXT NOT NULL CHECK(currency IN ('SAR','USD','EUR')),
 amount_minor TEXT NOT NULL CHECK(length(amount_minor) BETWEEN 1 AND 12 AND amount_minor NOT GLOB '*[^0-9]*' AND CAST(amount_minor AS INTEGER)>0),
 due_date TEXT NOT NULL, entitlement_evidence TEXT NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('draft','pending','approved','rejected','cancelled')), version INTEGER NOT NULL CHECK(version>0), revision INTEGER NOT NULL DEFAULT 0,
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
 FOREIGN KEY(project_id,tenant_id) REFERENCES projects(id,tenant_id), FOREIGN KEY(prepared_by,tenant_id) REFERENCES users(id,tenant_id),
 CHECK((basis='delivery' AND delivery_id IS NOT NULL AND advance_clause='') OR (basis='advance' AND delivery_id IS NULL AND length(advance_clause)>0))
) STRICT;
CREATE TABLE ar_claim_versions (claim_id TEXT NOT NULL REFERENCES ar_claims(id), revision INTEGER NOT NULL, snapshot TEXT NOT NULL CHECK(json_valid(snapshot)), submitted_by TEXT NOT NULL REFERENCES users(id), submitted_at TEXT NOT NULL, PRIMARY KEY(claim_id,revision)) STRICT;
CREATE TABLE ar_claim_decisions (id TEXT PRIMARY KEY, claim_id TEXT NOT NULL REFERENCES ar_claims(id), revision INTEGER NOT NULL, decision TEXT NOT NULL CHECK(decision IN ('approved','returned','rejected')), actor_id TEXT NOT NULL REFERENCES users(id), note TEXT NOT NULL, created_at TEXT NOT NULL, UNIQUE(claim_id,revision)) STRICT;
CREATE TABLE ar_receipts (
 id TEXT PRIMARY KEY, claim_id TEXT NOT NULL REFERENCES ar_claims(id), tenant_id TEXT NOT NULL REFERENCES tenants(id),
 reference TEXT NOT NULL, amount_minor TEXT NOT NULL CHECK(length(amount_minor) BETWEEN 1 AND 12 AND amount_minor NOT GLOB '*[^0-9]*' AND CAST(amount_minor AS INTEGER)>0),
 received_on TEXT NOT NULL, payer TEXT NOT NULL, evidence TEXT NOT NULL, recorded_by TEXT NOT NULL REFERENCES users(id),
 status TEXT NOT NULL CHECK(status IN ('pending','confirmed','rejected','reversed')), created_at TEXT NOT NULL, UNIQUE(tenant_id,reference)
) STRICT;
CREATE TABLE ar_receipt_decisions (id TEXT PRIMARY KEY, receipt_id TEXT NOT NULL UNIQUE REFERENCES ar_receipts(id), decision TEXT NOT NULL CHECK(decision IN ('confirmed','rejected')), actor_id TEXT NOT NULL REFERENCES users(id), note TEXT NOT NULL, matching_evidence TEXT NOT NULL, created_at TEXT NOT NULL) STRICT;
CREATE TABLE ar_adjustments (
 id TEXT PRIMARY KEY, claim_id TEXT NOT NULL REFERENCES ar_claims(id), kind TEXT NOT NULL CHECK(kind IN ('receipt_reversal','claim_cancel')),
 receipt_id TEXT REFERENCES ar_receipts(id), amount_minor TEXT NOT NULL, requested_by TEXT NOT NULL REFERENCES users(id),
 reason TEXT NOT NULL, evidence TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('pending','approved','rejected')), created_at TEXT NOT NULL,
 decided_by TEXT REFERENCES users(id), decision_note TEXT, decided_at TEXT,
 CHECK((kind='receipt_reversal' AND receipt_id IS NOT NULL) OR (kind='claim_cancel' AND receipt_id IS NULL))
) STRICT;
CREATE UNIQUE INDEX ar_pending_cancel ON ar_adjustments(claim_id) WHERE kind='claim_cancel' AND status='pending';
CREATE UNIQUE INDEX ar_pending_reversal ON ar_adjustments(receipt_id) WHERE kind='receipt_reversal' AND status='pending';
CREATE UNIQUE INDEX ar_confirmed_reversal ON ar_adjustments(receipt_id) WHERE kind='receipt_reversal' AND status='approved';
CREATE TABLE ar_disputes (id TEXT PRIMARY KEY, claim_id TEXT NOT NULL REFERENCES ar_claims(id), amount_minor TEXT NOT NULL, reason TEXT NOT NULL, evidence TEXT NOT NULL, opened_by TEXT NOT NULL REFERENCES users(id), opened_at TEXT NOT NULL, resolved_by TEXT REFERENCES users(id), resolution_note TEXT, resolution_evidence TEXT, resolved_at TEXT) STRICT;
CREATE UNIQUE INDEX ar_open_dispute ON ar_disputes(claim_id) WHERE resolved_at IS NULL;
CREATE TABLE ar_promises (id TEXT PRIMARY KEY, claim_id TEXT NOT NULL REFERENCES ar_claims(id), amount_minor TEXT NOT NULL, promised_on TEXT NOT NULL, contact TEXT NOT NULL, evidence TEXT NOT NULL, recorded_by TEXT NOT NULL REFERENCES users(id), created_at TEXT NOT NULL) STRICT;
CREATE TABLE ar_history (claim_id TEXT NOT NULL REFERENCES ar_claims(id), version INTEGER NOT NULL, action TEXT NOT NULL, actor_id TEXT NOT NULL REFERENCES users(id), snapshot TEXT NOT NULL CHECK(json_valid(snapshot)), created_at TEXT NOT NULL, PRIMARY KEY(claim_id,version)) STRICT;
CREATE INDEX ar_contract_status ON ar_claims(contract_id,status);
CREATE INDEX ar_project_scope ON ar_claims(tenant_id,project_id);
CREATE TRIGGER ar_claim_source BEFORE INSERT ON ar_claims WHEN NOT EXISTS(SELECT 1 FROM commercial_contracts k JOIN commercial_cases c ON c.id=k.case_id WHERE k.id=NEW.contract_id AND c.id=NEW.case_id AND c.tenant_id=NEW.tenant_id AND c.project_id=NEW.project_id) BEGIN SELECT RAISE(ABORT,'receivable source must match its client and project'); END;
CREATE TRIGGER ar_claim_identity BEFORE UPDATE ON ar_claims WHEN NEW.id<>OLD.id OR NEW.tenant_id<>OLD.tenant_id OR NEW.contract_id<>OLD.contract_id OR NEW.project_id<>OLD.project_id OR NEW.case_id<>OLD.case_id OR NEW.prepared_by<>OLD.prepared_by OR NEW.basis<>OLD.basis OR NEW.delivery_id IS NOT OLD.delivery_id OR NEW.advance_clause<>OLD.advance_clause OR NEW.source_snapshot<>OLD.source_snapshot OR NEW.currency<>OLD.currency OR NEW.created_at<>OLD.created_at OR NEW.version<>OLD.version+1 OR (OLD.status<>'draft' AND (NEW.amount_minor<>OLD.amount_minor OR NEW.due_date<>OLD.due_date OR NEW.entitlement_evidence<>OLD.entitlement_evidence)) BEGIN SELECT RAISE(ABORT,'receivable identity and submitted amounts are immutable'); END;
CREATE TRIGGER ar_claim_state BEFORE UPDATE ON ar_claims WHEN NOT ((OLD.status='draft' AND NEW.status IN ('draft','pending','cancelled')) OR (OLD.status='pending' AND NEW.status IN ('draft','approved','rejected')) OR (OLD.status='approved' AND NEW.status IN ('approved','cancelled'))) BEGIN SELECT RAISE(ABORT,'invalid receivable transition'); END;
CREATE TRIGGER ar_claim_decision_independent BEFORE INSERT ON ar_claim_decisions WHEN NOT EXISTS(SELECT 1 FROM ar_claims c JOIN ar_claim_versions v ON v.claim_id=c.id AND v.revision=c.revision WHERE c.id=NEW.claim_id AND c.status='pending' AND c.revision=NEW.revision AND c.prepared_by<>NEW.actor_id) BEGIN SELECT RAISE(ABORT,'claim decisions require the original submission and another actor'); END;
CREATE TRIGGER ar_receipt_source BEFORE INSERT ON ar_receipts WHEN NOT EXISTS(SELECT 1 FROM ar_claims c WHERE c.id=NEW.claim_id AND c.tenant_id=NEW.tenant_id AND c.status='approved') BEGIN SELECT RAISE(ABORT,'receipt needs an approved claim in its tenant'); END;
CREATE TRIGGER ar_receipt_identity BEFORE UPDATE ON ar_receipts WHEN NEW.id<>OLD.id OR NEW.claim_id<>OLD.claim_id OR NEW.tenant_id<>OLD.tenant_id OR NEW.reference<>OLD.reference OR NEW.amount_minor<>OLD.amount_minor OR NEW.received_on<>OLD.received_on OR NEW.payer<>OLD.payer OR NEW.evidence<>OLD.evidence OR NEW.recorded_by<>OLD.recorded_by OR NEW.created_at<>OLD.created_at OR NOT ((OLD.status='pending' AND NEW.status IN ('confirmed','rejected')) OR (OLD.status='confirmed' AND NEW.status='reversed')) BEGIN SELECT RAISE(ABORT,'receipt evidence is immutable and decisions are final'); END;
CREATE TRIGGER ar_receipt_decision_independent BEFORE INSERT ON ar_receipt_decisions WHEN NOT EXISTS(SELECT 1 FROM ar_receipts r WHERE r.id=NEW.receipt_id AND r.status='pending' AND r.recorded_by<>NEW.actor_id) BEGIN SELECT RAISE(ABORT,'receipt matching requires another actor'); END;
CREATE TRIGGER ar_adjustment_identity BEFORE UPDATE ON ar_adjustments WHEN NEW.id<>OLD.id OR NEW.claim_id<>OLD.claim_id OR NEW.kind<>OLD.kind OR NEW.receipt_id IS NOT OLD.receipt_id OR NEW.amount_minor<>OLD.amount_minor OR NEW.requested_by<>OLD.requested_by OR NEW.reason<>OLD.reason OR NEW.evidence<>OLD.evidence OR NEW.created_at<>OLD.created_at OR OLD.status<>'pending' OR NEW.status NOT IN ('approved','rejected') OR NEW.decided_by IS NULL OR NEW.decided_by=OLD.requested_by OR NEW.decided_at IS NULL OR length(trim(NEW.decision_note))<3 BEGIN SELECT RAISE(ABORT,'adjustments require a final independent decision'); END;
CREATE TRIGGER ar_dispute_identity BEFORE UPDATE ON ar_disputes WHEN NEW.id<>OLD.id OR NEW.claim_id<>OLD.claim_id OR NEW.amount_minor<>OLD.amount_minor OR NEW.reason<>OLD.reason OR NEW.evidence<>OLD.evidence OR NEW.opened_by<>OLD.opened_by OR NEW.opened_at<>OLD.opened_at OR OLD.resolved_at IS NOT NULL OR NEW.resolved_at IS NULL OR NEW.resolved_by IS NULL OR NEW.resolved_by=OLD.opened_by OR length(trim(NEW.resolution_note))<3 OR length(trim(NEW.resolution_evidence))<3 BEGIN SELECT RAISE(ABORT,'a dispute needs an independent documented resolution'); END;
CREATE TRIGGER ar_claims_no_delete BEFORE DELETE ON ar_claims BEGIN SELECT RAISE(ABORT,'receivable history is immutable'); END;
CREATE TRIGGER ar_receipts_no_delete BEFORE DELETE ON ar_receipts BEGIN SELECT RAISE(ABORT,'receipt history is immutable'); END;
CREATE TRIGGER ar_adjustments_no_delete BEFORE DELETE ON ar_adjustments BEGIN SELECT RAISE(ABORT,'adjustment history is immutable'); END;
CREATE TRIGGER ar_disputes_no_delete BEFORE DELETE ON ar_disputes BEGIN SELECT RAISE(ABORT,'dispute history is immutable'); END;
CREATE TRIGGER ar_versions_no_update BEFORE UPDATE ON ar_claim_versions BEGIN SELECT RAISE(ABORT,'claim snapshots are immutable'); END;
CREATE TRIGGER ar_versions_no_delete BEFORE DELETE ON ar_claim_versions BEGIN SELECT RAISE(ABORT,'claim snapshots are immutable'); END;
CREATE TRIGGER ar_decisions_no_update BEFORE UPDATE ON ar_claim_decisions BEGIN SELECT RAISE(ABORT,'claim decisions are immutable'); END;
CREATE TRIGGER ar_decisions_no_delete BEFORE DELETE ON ar_claim_decisions BEGIN SELECT RAISE(ABORT,'claim decisions are immutable'); END;
CREATE TRIGGER ar_receipt_decisions_no_update BEFORE UPDATE ON ar_receipt_decisions BEGIN SELECT RAISE(ABORT,'receipt decisions are immutable'); END;
CREATE TRIGGER ar_receipt_decisions_no_delete BEFORE DELETE ON ar_receipt_decisions BEGIN SELECT RAISE(ABORT,'receipt decisions are immutable'); END;
CREATE TRIGGER ar_promises_no_update BEFORE UPDATE ON ar_promises BEGIN SELECT RAISE(ABORT,'payment promises are immutable'); END;
CREATE TRIGGER ar_promises_no_delete BEFORE DELETE ON ar_promises BEGIN SELECT RAISE(ABORT,'payment promises are immutable'); END;
CREATE TRIGGER ar_history_no_update BEFORE UPDATE ON ar_history BEGIN SELECT RAISE(ABORT,'receivable history is immutable'); END;
CREATE TRIGGER ar_history_no_delete BEFORE DELETE ON ar_history BEGIN SELECT RAISE(ABORT,'receivable history is immutable'); END;
