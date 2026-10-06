-- Drive source: قائمة تحقق لمراجعة العروض الفنية.xlsx.
-- The checklist is tied to an immutable commercial quote revision and reviewed by EPMO.

CREATE TABLE technical_proposal_policies (
  tenant_id TEXT PRIMARY KEY REFERENCES tenants(id),
  required INTEGER NOT NULL CHECK(required IN (0,1)),
  source_reference TEXT NOT NULL,
  activated_at TEXT NOT NULL
) STRICT;
INSERT INTO technical_proposal_policies(tenant_id,required,source_reference,activated_at)
SELECT id,1,'قائمة تحقق لمراجعة العروض الفنية.xlsx',strftime('%Y-%m-%dT%H:%M:%fZ','now') FROM tenants;

CREATE TABLE technical_proposal_checklists (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  case_id TEXT NOT NULL,
  quote_id TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK(revision BETWEEN 1 AND 10000),
  proposal_type TEXT NOT NULL CHECK(proposal_type IN ('private','government')),
  status TEXT NOT NULL CHECK(status IN ('pending_epmo','approved','changes_required')),
  source_reference TEXT NOT NULL CHECK(source_reference='قائمة تحقق لمراجعة العروض الفنية.xlsx'),
  submitted_by TEXT NOT NULL,
  submitted_at TEXT NOT NULL,
  UNIQUE(id,quote_id),
  UNIQUE(quote_id,revision),
  FOREIGN KEY(case_id,tenant_id) REFERENCES commercial_cases(id,tenant_id),
  FOREIGN KEY(quote_id) REFERENCES commercial_quotes(id),
  FOREIGN KEY(submitted_by,tenant_id) REFERENCES users(id,tenant_id)
) STRICT;
CREATE UNIQUE INDEX technical_proposal_one_live ON technical_proposal_checklists(quote_id) WHERE status IN ('pending_epmo','approved');
CREATE INDEX technical_proposal_queue ON technical_proposal_checklists(tenant_id,status,submitted_at);

CREATE TRIGGER technical_proposal_submission_guard BEFORE INSERT ON technical_proposal_checklists
WHEN NOT EXISTS(
  SELECT 1 FROM commercial_cases c
  JOIN commercial_quotes q ON q.id=NEW.quote_id AND q.case_id=c.id
  JOIN users u ON u.id=NEW.submitted_by AND u.tenant_id=c.tenant_id AND u.active=1
  WHERE c.id=NEW.case_id AND c.tenant_id=NEW.tenant_id AND c.status='quote_draft'
    AND c.current_quote_id=NEW.quote_id AND c.owner_id=NEW.submitted_by AND q.created_by=NEW.submitted_by
)
BEGIN SELECT RAISE(ABORT,'technical proposal checklist must match the current quote and its active owner'); END;

CREATE TABLE technical_proposal_items (
  id TEXT PRIMARY KEY,
  checklist_id TEXT NOT NULL,
  quote_id TEXT NOT NULL,
  item_no INTEGER NOT NULL CHECK(item_no BETWEEN 1 AND 100),
  category TEXT NOT NULL,
  axis TEXT NOT NULL,
  question TEXT NOT NULL,
  review_indicator TEXT NOT NULL,
  priority TEXT NOT NULL CHECK(priority IN ('حرج','عالية','متوسطة')),
  evidence TEXT NOT NULL,
  author_note TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(checklist_id,item_no),
  UNIQUE(id,checklist_id),
  FOREIGN KEY(checklist_id,quote_id) REFERENCES technical_proposal_checklists(id,quote_id)
) STRICT;

CREATE TABLE technical_proposal_reviews (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  checklist_id TEXT NOT NULL UNIQUE,
  quote_id TEXT NOT NULL,
  decision TEXT NOT NULL CHECK(decision IN ('approved','changes_required')),
  note TEXT NOT NULL,
  reviewed_by TEXT NOT NULL,
  reviewed_at TEXT NOT NULL,
  UNIQUE(id,checklist_id),
  FOREIGN KEY(checklist_id,quote_id) REFERENCES technical_proposal_checklists(id,quote_id),
  FOREIGN KEY(reviewed_by,tenant_id) REFERENCES users(id,tenant_id)
) STRICT;

CREATE TABLE technical_proposal_review_items (
  id TEXT PRIMARY KEY,
  review_id TEXT NOT NULL,
  checklist_id TEXT NOT NULL,
  item_id TEXT NOT NULL,
  result TEXT NOT NULL CHECK(result IN ('passed','gap','not_applicable')),
  epmo_note TEXT NOT NULL,
  responsible_user_id TEXT,
  due_on TEXT CHECK(due_on IS NULL OR due_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  created_at TEXT NOT NULL,
  UNIQUE(review_id,item_id),
  FOREIGN KEY(review_id,checklist_id) REFERENCES technical_proposal_reviews(id,checklist_id) DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY(item_id,checklist_id) REFERENCES technical_proposal_items(id,checklist_id),
  FOREIGN KEY(responsible_user_id) REFERENCES users(id),
  CHECK((result='gap' AND responsible_user_id IS NOT NULL AND due_on IS NOT NULL) OR result<>'gap')
) STRICT;

CREATE TRIGGER technical_proposal_gap_owner_guard BEFORE INSERT ON technical_proposal_review_items
WHEN NEW.result='gap' AND NOT EXISTS(
  SELECT 1 FROM technical_proposal_checklists c
  JOIN users u ON u.id=NEW.responsible_user_id AND u.tenant_id=c.tenant_id AND u.active=1
  WHERE c.id=NEW.checklist_id
)
BEGIN SELECT RAISE(ABORT,'proposal gap owner must be active in the checklist tenant'); END;

CREATE TRIGGER technical_proposal_review_complete BEFORE INSERT ON technical_proposal_reviews
WHEN (SELECT COUNT(*) FROM technical_proposal_items WHERE checklist_id=NEW.checklist_id)
       <>COALESCE((SELECT CASE proposal_type WHEN 'private' THEN 30 WHEN 'government' THEN 38 END FROM technical_proposal_checklists WHERE id=NEW.checklist_id),-1)
  OR (SELECT COUNT(*) FROM technical_proposal_review_items WHERE review_id=NEW.id AND checklist_id=NEW.checklist_id)
       <>(SELECT COUNT(*) FROM technical_proposal_items WHERE checklist_id=NEW.checklist_id)
  OR EXISTS(
    SELECT 1 FROM technical_proposal_items i
    WHERE i.checklist_id=NEW.checklist_id AND NOT EXISTS(
      SELECT 1 FROM technical_proposal_review_items r
      WHERE r.review_id=NEW.id AND r.checklist_id=NEW.checklist_id AND r.item_id=i.id
    )
  )
BEGIN SELECT RAISE(ABORT,'EPMO review requires every source checklist item'); END;

CREATE TRIGGER technical_proposal_review_guard BEFORE INSERT ON technical_proposal_reviews
WHEN NOT EXISTS(
  SELECT 1 FROM technical_proposal_checklists c
  JOIN users u ON u.id=NEW.reviewed_by AND u.tenant_id=c.tenant_id AND u.active=1 AND u.department_id='epmo' AND u.role IN ('employee','manager','pm')
  JOIN commercial_cases x ON x.id=c.case_id
  WHERE c.id=NEW.checklist_id AND c.quote_id=NEW.quote_id AND c.tenant_id=NEW.tenant_id
    AND c.status='pending_epmo' AND NEW.reviewed_by<>c.submitted_by AND NEW.reviewed_by<>x.owner_id
)
BEGIN SELECT RAISE(ABORT,'technical proposal review requires an independent EPMO reviewer'); END;

CREATE TRIGGER technical_proposal_review_applies AFTER INSERT ON technical_proposal_reviews
BEGIN UPDATE technical_proposal_checklists SET status=NEW.decision WHERE id=NEW.checklist_id; END;

CREATE TRIGGER technical_proposal_checklists_frozen BEFORE UPDATE ON technical_proposal_checklists
WHEN NEW.id<>OLD.id OR NEW.tenant_id<>OLD.tenant_id OR NEW.case_id<>OLD.case_id OR NEW.quote_id<>OLD.quote_id OR NEW.revision<>OLD.revision
  OR NEW.proposal_type<>OLD.proposal_type OR NEW.source_reference<>OLD.source_reference OR NEW.submitted_by<>OLD.submitted_by OR NEW.submitted_at<>OLD.submitted_at
  OR OLD.status<>'pending_epmo' OR NEW.status NOT IN ('approved','changes_required')
BEGIN SELECT RAISE(ABORT,'technical proposal submission is immutable outside its EPMO decision'); END;
CREATE TRIGGER technical_proposal_checklists_no_delete BEFORE DELETE ON technical_proposal_checklists BEGIN SELECT RAISE(ABORT,'technical proposal history is immutable'); END;
CREATE TRIGGER technical_proposal_items_no_update BEFORE UPDATE ON technical_proposal_items BEGIN SELECT RAISE(ABORT,'technical proposal items are immutable'); END;
CREATE TRIGGER technical_proposal_items_no_delete BEFORE DELETE ON technical_proposal_items BEGIN SELECT RAISE(ABORT,'technical proposal items are immutable'); END;
CREATE TRIGGER technical_proposal_reviews_no_update BEFORE UPDATE ON technical_proposal_reviews BEGIN SELECT RAISE(ABORT,'technical proposal review is immutable'); END;
CREATE TRIGGER technical_proposal_reviews_no_delete BEFORE DELETE ON technical_proposal_reviews BEGIN SELECT RAISE(ABORT,'technical proposal review is immutable'); END;
CREATE TRIGGER technical_proposal_review_items_no_update BEFORE UPDATE ON technical_proposal_review_items BEGIN SELECT RAISE(ABORT,'technical proposal review items are immutable'); END;
CREATE TRIGGER technical_proposal_review_items_no_delete BEFORE DELETE ON technical_proposal_review_items BEGIN SELECT RAISE(ABORT,'technical proposal review items are immutable'); END;

CREATE TRIGGER commercial_quote_technical_review_gate BEFORE INSERT ON commercial_reviews
WHEN NEW.kind='quote'
  AND EXISTS(SELECT 1 FROM commercial_cases c JOIN technical_proposal_policies p ON p.tenant_id=c.tenant_id AND p.required=1 WHERE c.id=NEW.case_id)
  AND NOT EXISTS(SELECT 1 FROM technical_proposal_checklists c WHERE c.quote_id=NEW.subject_id AND c.status='approved')
BEGIN SELECT RAISE(ABORT,'quote submission requires an approved technical proposal checklist'); END;
