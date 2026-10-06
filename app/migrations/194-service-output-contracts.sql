-- A catalog request is not complete merely because its handler wrote a completion note.
-- For the audited deepen/connect services, this ledger binds the request to a tangible
-- attachment or an existing module record, then records the requester's final acceptance.
CREATE TABLE service_outputs (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  request_id TEXT NOT NULL,
  round INTEGER NOT NULL CHECK(round BETWEEN 1 AND 20),
  service_code TEXT NOT NULL CHECK(length(trim(service_code)) BETWEEN 3 AND 40),
  module TEXT NOT NULL CHECK(length(trim(module)) BETWEEN 2 AND 60),
  record_id TEXT,
  attachment_id TEXT REFERENCES attachments(id),
  title TEXT NOT NULL CHECK(length(trim(title)) BETWEEN 5 AND 240),
  evidence TEXT NOT NULL CHECK(length(trim(evidence)) BETWEEN 20 AND 3000),
  status TEXT NOT NULL CHECK(status IN ('submitted','accepted','rejected')),
  recorded_by TEXT NOT NULL REFERENCES users(id),
  decided_by TEXT REFERENCES users(id),
  decision_note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  decided_at TEXT,
  version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),
  FOREIGN KEY(request_id,tenant_id) REFERENCES requests(id,tenant_id),
  CHECK((record_id IS NULL)<>(attachment_id IS NULL)),
  CHECK((status='submitted')=(decided_by IS NULL AND decided_at IS NULL AND decision_note='')),
  UNIQUE(request_id,round,id)
) STRICT;
CREATE INDEX service_outputs_request ON service_outputs(tenant_id,request_id,round,status,created_at);
CREATE UNIQUE INDEX service_outputs_one_accepted ON service_outputs(request_id,round) WHERE status='accepted';

CREATE TRIGGER service_outputs_record_one_request BEFORE INSERT ON service_outputs
WHEN NEW.record_id IS NOT NULL AND EXISTS(
  SELECT 1 FROM service_outputs
  WHERE tenant_id=NEW.tenant_id AND module=NEW.module AND record_id=NEW.record_id AND request_id<>NEW.request_id
)
BEGIN SELECT RAISE(ABORT,'a module record can evidence only one service request'); END;

CREATE TRIGGER service_outputs_not_requester BEFORE INSERT ON service_outputs
WHEN NEW.recorded_by=(SELECT requester_id FROM requests WHERE id=NEW.request_id)
BEGIN SELECT RAISE(ABORT,'the requester does not record their own delivery output'); END;

CREATE TRIGGER service_outputs_requester_decides BEFORE UPDATE ON service_outputs
WHEN NEW.decided_by<>(SELECT requester_id FROM requests WHERE id=NEW.request_id)
  OR NEW.decided_by=OLD.recorded_by
BEGIN SELECT RAISE(ABORT,'the requester independently decides the delivery output'); END;

CREATE TRIGGER service_outputs_final BEFORE UPDATE ON service_outputs
WHEN OLD.status<>'submitted' OR NEW.version<>OLD.version+1
  OR NEW.id<>OLD.id OR NEW.tenant_id<>OLD.tenant_id OR NEW.request_id<>OLD.request_id
  OR NEW.round<>OLD.round OR NEW.service_code<>OLD.service_code OR NEW.module<>OLD.module
  OR NEW.record_id IS NOT OLD.record_id OR NEW.attachment_id IS NOT OLD.attachment_id
  OR NEW.title<>OLD.title OR NEW.evidence<>OLD.evidence OR NEW.recorded_by<>OLD.recorded_by
  OR NEW.created_at<>OLD.created_at OR NEW.status NOT IN ('accepted','rejected')
  OR NEW.decided_by IS NULL OR NEW.decided_at IS NULL OR length(trim(NEW.decision_note))<10
BEGIN SELECT RAISE(ABORT,'service output identity is immutable and its decision is final'); END;

CREATE TRIGGER service_outputs_no_delete BEFORE DELETE ON service_outputs
BEGIN SELECT RAISE(ABORT,'service outputs are retained'); END;
