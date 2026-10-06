-- محتوى مساحة العمل: ملفات بإصدارات ثابتة، تواصل، جدول، وأسئلة دورية معلنة الهوية.
CREATE TABLE workspace_folders (
  id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id), space_id TEXT NOT NULL,
  parent_id TEXT REFERENCES workspace_folders(id), name TEXT NOT NULL CHECK(length(trim(name))>=1),
  created_by TEXT NOT NULL, created_at TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),
  UNIQUE(space_id,parent_id,name), UNIQUE(id,tenant_id),
  FOREIGN KEY(space_id,tenant_id) REFERENCES collaboration_spaces(id,tenant_id),
  FOREIGN KEY(created_by,tenant_id) REFERENCES users(id,tenant_id)
) STRICT;

CREATE TABLE workspace_documents (
  id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id), space_id TEXT NOT NULL,
  folder_id TEXT REFERENCES workspace_folders(id), title TEXT NOT NULL CHECK(length(trim(title))>=2),
  current_revision INTEGER NOT NULL DEFAULT 0 CHECK(current_revision>=0), status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','published','archived')),
  created_by TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),
  UNIQUE(id,tenant_id), FOREIGN KEY(space_id,tenant_id) REFERENCES collaboration_spaces(id,tenant_id),
  FOREIGN KEY(created_by,tenant_id) REFERENCES users(id,tenant_id)
) STRICT;
CREATE TABLE workspace_document_revisions (
  id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id), document_id TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK(revision>0), body TEXT NOT NULL, digest TEXT NOT NULL CHECK(length(digest)=64),
  note TEXT NOT NULL DEFAULT '', authored_by TEXT NOT NULL, created_at TEXT NOT NULL,
  UNIQUE(document_id,revision), UNIQUE(document_id,digest),
  FOREIGN KEY(document_id,tenant_id) REFERENCES workspace_documents(id,tenant_id),
  FOREIGN KEY(authored_by,tenant_id) REFERENCES users(id,tenant_id)
) STRICT;
CREATE TRIGGER workspace_document_revisions_immutable BEFORE UPDATE ON workspace_document_revisions
BEGIN SELECT RAISE(ABORT,'document revisions are immutable'); END;
CREATE TRIGGER workspace_document_revisions_retained BEFORE DELETE ON workspace_document_revisions
BEGIN SELECT RAISE(ABORT,'document revisions are retained'); END;

CREATE TABLE workspace_files (
  id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id), space_id TEXT NOT NULL,
  folder_id TEXT REFERENCES workspace_folders(id), label TEXT NOT NULL CHECK(length(trim(label))>=2),
  current_version INTEGER NOT NULL DEFAULT 0 CHECK(current_version>=0), created_by TEXT NOT NULL,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),
  UNIQUE(id,tenant_id), FOREIGN KEY(space_id,tenant_id) REFERENCES collaboration_spaces(id,tenant_id),
  FOREIGN KEY(created_by,tenant_id) REFERENCES users(id,tenant_id)
) STRICT;
CREATE TABLE workspace_file_versions (
  id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id), file_id TEXT NOT NULL,
  version INTEGER NOT NULL CHECK(version>0), filename TEXT NOT NULL, media_type TEXT NOT NULL,
  size INTEGER NOT NULL CHECK(size BETWEEN 1 AND 2097152), digest TEXT NOT NULL CHECK(length(digest)=64),
  content BLOB NOT NULL, scan_state TEXT NOT NULL CHECK(scan_state IN ('pending','clean','blocked','unavailable')),
  uploaded_by TEXT NOT NULL, created_at TEXT NOT NULL,
  UNIQUE(file_id,version), UNIQUE(file_id,digest), UNIQUE(id,tenant_id),
  FOREIGN KEY(file_id,tenant_id) REFERENCES workspace_files(id,tenant_id),
  FOREIGN KEY(uploaded_by,tenant_id) REFERENCES users(id,tenant_id)
) STRICT;
CREATE TRIGGER workspace_file_versions_immutable BEFORE UPDATE ON workspace_file_versions
BEGIN SELECT RAISE(ABORT,'file versions are immutable'); END;
CREATE TRIGGER workspace_file_versions_retained BEFORE DELETE ON workspace_file_versions
BEGIN SELECT RAISE(ABORT,'file versions are retained'); END;

CREATE TABLE workspace_evidence_links (
  id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id), space_id TEXT NOT NULL,
  entity_type TEXT NOT NULL CHECK(entity_type IN ('space_task','project_task','topic','event')),
  entity_id TEXT NOT NULL, source_type TEXT NOT NULL CHECK(source_type IN ('file','document')),
  source_id TEXT NOT NULL, source_version INTEGER NOT NULL CHECK(source_version>0), digest TEXT NOT NULL CHECK(length(digest)=64),
  label TEXT NOT NULL CHECK(length(trim(label))>=2), published_by TEXT NOT NULL, published_at TEXT NOT NULL,
  FOREIGN KEY(space_id,tenant_id) REFERENCES collaboration_spaces(id,tenant_id),
  FOREIGN KEY(published_by,tenant_id) REFERENCES users(id,tenant_id)
) STRICT;
CREATE INDEX workspace_evidence_entity ON workspace_evidence_links(space_id,entity_type,entity_id);
CREATE TRIGGER workspace_evidence_immutable BEFORE UPDATE ON workspace_evidence_links BEGIN SELECT RAISE(ABORT,'evidence links are immutable'); END;
CREATE TRIGGER workspace_evidence_retained BEFORE DELETE ON workspace_evidence_links BEGIN SELECT RAISE(ABORT,'evidence links are retained'); END;

CREATE TABLE workspace_topics (
  id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id), space_id TEXT NOT NULL,
  title TEXT NOT NULL CHECK(length(trim(title))>=2), body TEXT NOT NULL CHECK(length(trim(body))>=2),
  status TEXT NOT NULL DEFAULT 'published' CHECK(status IN ('published','withdrawn')),
  author_id TEXT NOT NULL, withdrawn_by TEXT, withdrawn_at TEXT, withdrawal_reason TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),
  UNIQUE(id,tenant_id), FOREIGN KEY(space_id,tenant_id) REFERENCES collaboration_spaces(id,tenant_id),
  FOREIGN KEY(author_id,tenant_id) REFERENCES users(id,tenant_id), FOREIGN KEY(withdrawn_by,tenant_id) REFERENCES users(id,tenant_id),
  CHECK((withdrawn_at IS NULL)=(withdrawn_by IS NULL)), CHECK(status='published' OR length(trim(withdrawal_reason))>=5)
) STRICT;
CREATE TABLE workspace_topic_revisions (
  id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id), topic_id TEXT NOT NULL,
  version INTEGER NOT NULL CHECK(version>0), title TEXT NOT NULL, body TEXT NOT NULL, reason TEXT NOT NULL,
  revised_by TEXT NOT NULL, created_at TEXT NOT NULL, UNIQUE(topic_id,version),
  FOREIGN KEY(topic_id,tenant_id) REFERENCES workspace_topics(id,tenant_id), FOREIGN KEY(revised_by,tenant_id) REFERENCES users(id,tenant_id)
) STRICT;
CREATE TABLE workspace_topic_comments (
  id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id), topic_id TEXT NOT NULL,
  author_id TEXT NOT NULL, body TEXT NOT NULL CHECK(length(trim(body))>=1), created_at TEXT NOT NULL,
  FOREIGN KEY(topic_id,tenant_id) REFERENCES workspace_topics(id,tenant_id), FOREIGN KEY(author_id,tenant_id) REFERENCES users(id,tenant_id)
) STRICT;

CREATE TABLE workspace_chat_lines (
  id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id), space_id TEXT NOT NULL,
  author_id TEXT NOT NULL, body TEXT, status TEXT NOT NULL DEFAULT 'visible' CHECK(status IN ('visible','redacted')),
  redacted_by TEXT, redacted_at TEXT, redaction_reason TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),
  UNIQUE(id,tenant_id), FOREIGN KEY(space_id,tenant_id) REFERENCES collaboration_spaces(id,tenant_id),
  FOREIGN KEY(author_id,tenant_id) REFERENCES users(id,tenant_id), FOREIGN KEY(redacted_by,tenant_id) REFERENCES users(id,tenant_id),
  CHECK(status='visible' OR (body IS NULL AND redacted_by IS NOT NULL AND redacted_at IS NOT NULL AND length(trim(redaction_reason))>=5))
) STRICT;
CREATE TABLE chat_line_revisions (
  id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id), line_id TEXT NOT NULL,
  version INTEGER NOT NULL CHECK(version>0), body TEXT NOT NULL, reason TEXT NOT NULL,
  revised_by TEXT NOT NULL, created_at TEXT NOT NULL, UNIQUE(line_id,version),
  FOREIGN KEY(line_id,tenant_id) REFERENCES workspace_chat_lines(id,tenant_id), FOREIGN KEY(revised_by,tenant_id) REFERENCES users(id,tenant_id)
) STRICT;

CREATE TABLE workspace_events (
  id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id), space_id TEXT NOT NULL,
  title TEXT NOT NULL CHECK(length(trim(title))>=2), description TEXT NOT NULL DEFAULT '',
  starts_at TEXT NOT NULL, ends_at TEXT NOT NULL CHECK(ends_at>starts_at), timezone TEXT NOT NULL DEFAULT 'Asia/Riyadh',
  location TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'scheduled' CHECK(status IN ('scheduled','cancelled','completed')),
  created_by TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),
  UNIQUE(id,tenant_id), FOREIGN KEY(space_id,tenant_id) REFERENCES collaboration_spaces(id,tenant_id),
  FOREIGN KEY(created_by,tenant_id) REFERENCES users(id,tenant_id)
) STRICT;
CREATE TABLE workspace_event_attendees (
  tenant_id TEXT NOT NULL REFERENCES tenants(id), event_id TEXT NOT NULL, user_id TEXT NOT NULL,
  response TEXT NOT NULL DEFAULT 'pending' CHECK(response IN ('pending','accepted','declined')),
  PRIMARY KEY(event_id,user_id), FOREIGN KEY(event_id,tenant_id) REFERENCES workspace_events(id,tenant_id),
  FOREIGN KEY(user_id,tenant_id) REFERENCES users(id,tenant_id)
) STRICT;

CREATE TABLE workspace_checkins (
  id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id), space_id TEXT NOT NULL,
  question TEXT NOT NULL CHECK(length(trim(question))>=3), cadence TEXT NOT NULL CHECK(cadence IN ('daily','weekly','monthly')),
  weekday INTEGER CHECK(weekday IS NULL OR weekday BETWEEN 0 AND 6), local_time TEXT NOT NULL CHECK(local_time GLOB '[0-2][0-9]:[0-5][0-9]'),
  timezone TEXT NOT NULL DEFAULT 'Asia/Riyadh', next_due_at TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
  created_by TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),
  UNIQUE(id,tenant_id), FOREIGN KEY(space_id,tenant_id) REFERENCES collaboration_spaces(id,tenant_id),
  FOREIGN KEY(created_by,tenant_id) REFERENCES users(id,tenant_id)
) STRICT;
CREATE TABLE workspace_checkin_cycles (
  id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id), checkin_id TEXT NOT NULL,
  due_at TEXT NOT NULL, closes_at TEXT NOT NULL CHECK(closes_at>due_at), generated_at TEXT NOT NULL,
  UNIQUE(checkin_id,due_at), UNIQUE(id,tenant_id),
  FOREIGN KEY(checkin_id,tenant_id) REFERENCES workspace_checkins(id,tenant_id)
) STRICT;
CREATE TABLE workspace_checkin_responses (
  id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id), cycle_id TEXT NOT NULL,
  user_id TEXT NOT NULL, body TEXT NOT NULL CHECK(length(trim(body))>=1), created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1 CHECK(version>0), UNIQUE(cycle_id,user_id),
  FOREIGN KEY(cycle_id,tenant_id) REFERENCES workspace_checkin_cycles(id,tenant_id),
  FOREIGN KEY(user_id,tenant_id) REFERENCES users(id,tenant_id)
) STRICT;

