-- بطاقة الخدمة (القسم 5 من البرومبت الشامل): ما لا يُشتق من تعريف الخدمة يكتبه معدّ الدليل، ويعتمده مالك الإجراء المسمى فيها.
-- البطاقة منشورة بنسخ مؤرخة؛ النسخة المنشورة لا تُعدل، وتعديلها نسخة جديدة تحفظ تفسير القرارات السابقة.
CREATE TABLE service_cards (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  service_code TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK(revision>0),
  owner_id TEXT,
  requesters TEXT NOT NULL DEFAULT '',
  service_kind TEXT NOT NULL CHECK(service_kind IN ('institutional','client_work')),
  confidentiality TEXT NOT NULL CHECK(confidentiality IN ('internal','restricted','confidential')),
  trigger_note TEXT NOT NULL DEFAULT '',
  outputs TEXT NOT NULL DEFAULT '',
  acceptance_evidence TEXT NOT NULL DEFAULT '',
  financial_limit_note TEXT NOT NULL DEFAULT '',
  exceptions_note TEXT NOT NULL DEFAULT '',
  kpis TEXT NOT NULL DEFAULT '',
  integrations TEXT NOT NULL DEFAULT '',
  policy_reference TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL CHECK(status IN ('draft','published','superseded')),
  effective_from TEXT,
  prepared_by TEXT NOT NULL REFERENCES users(id),
  published_by TEXT REFERENCES users(id),
  published_at TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(tenant_id,service_code,revision),
  FOREIGN KEY(owner_id,tenant_id) REFERENCES users(id,tenant_id),
  CHECK((status='draft')=(published_by IS NULL)),
  CHECK(status='draft' OR (owner_id IS NOT NULL AND effective_from IS NOT NULL)),
  CHECK(published_by IS NULL OR published_by<>prepared_by)
) STRICT;
CREATE UNIQUE INDEX service_cards_one_draft ON service_cards(tenant_id,service_code) WHERE status='draft';
CREATE UNIQUE INDEX service_cards_one_published ON service_cards(tenant_id,service_code) WHERE status='published';
CREATE TRIGGER service_cards_versioned BEFORE UPDATE ON service_cards
WHEN NEW.version<>OLD.version+1 OR NEW.service_code<>OLD.service_code OR NEW.revision<>OLD.revision OR OLD.status='superseded'
  OR (OLD.status='published' AND NOT (NEW.status='superseded' AND NEW.outputs=OLD.outputs AND NEW.owner_id IS OLD.owner_id AND NEW.kpis=OLD.kpis AND NEW.acceptance_evidence=OLD.acceptance_evidence))
BEGIN SELECT RAISE(ABORT,'a published card is replaced by a new revision, not edited'); END;
CREATE TRIGGER service_cards_no_delete BEFORE DELETE ON service_cards WHEN OLD.status<>'draft' BEGIN SELECT RAISE(ABORT,'published cards are retained'); END;
