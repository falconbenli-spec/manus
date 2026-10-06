-- تشغيل الوكالة: الحملات بخطة ومؤشرات وصرف فعلي واعتماد إطلاق وتعلّم عند الإقفال، تقويم المحتوى بمراحل اعتماد،
-- وحارس النطاق الذي يقيس ما سُلّم وما رُوجع مقابل خط الأساس في العقد ويطلب قرارًا مكتوبًا فيما زاد.
CREATE TABLE campaigns (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  client_id TEXT NOT NULL REFERENCES clients(id),
  name TEXT NOT NULL CHECK(length(trim(name))>=3),
  objective TEXT NOT NULL CHECK(length(trim(objective))>=10),
  channels TEXT NOT NULL CHECK(json_valid(channels)),
  targets TEXT NOT NULL CHECK(json_valid(targets)),
  media_budget_minor INTEGER NOT NULL CHECK(media_budget_minor>=0),
  budget_reference TEXT NOT NULL DEFAULT '',
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('planning','launch_review','live','paused','completed','cancelled')),
  owner_id TEXT NOT NULL,
  checklist TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(checklist)),
  launch_approved_by TEXT REFERENCES users(id),
  launch_approved_at TEXT,
  launch_note TEXT NOT NULL DEFAULT '',
  learning TEXT NOT NULL DEFAULT '',
  closed_at TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(client_id,name),
  FOREIGN KEY(owner_id,tenant_id) REFERENCES users(id,tenant_id),
  CHECK(end_date>=start_date),
  CHECK(launch_approved_by IS NULL OR launch_approved_by<>owner_id),
  CHECK(status NOT IN ('live','paused','completed') OR launch_approved_by IS NOT NULL),
  CHECK(status<>'completed' OR length(trim(learning))>=30)
) STRICT;
CREATE TRIGGER campaigns_versioned BEFORE UPDATE ON campaigns
WHEN NEW.version<>OLD.version+1 OR OLD.status IN ('completed','cancelled') OR NEW.client_id<>OLD.client_id OR NEW.owner_id<>OLD.owner_id
  OR (OLD.launch_approved_by IS NOT NULL AND (NEW.targets<>OLD.targets OR NEW.media_budget_minor<>OLD.media_budget_minor OR NEW.objective<>OLD.objective))
BEGIN SELECT RAISE(ABORT,'a launched campaign keeps its objective, targets and budget; a closed campaign is final'); END;
CREATE TRIGGER campaigns_no_delete BEFORE DELETE ON campaigns BEGIN SELECT RAISE(ABORT,'campaigns are retained'); END;

CREATE TABLE campaign_entries (
  id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL REFERENCES campaigns(id),
  kind TEXT NOT NULL CHECK(kind IN ('result','spend')),
  entry_date TEXT NOT NULL,
  metric TEXT NOT NULL DEFAULT '',
  channel TEXT NOT NULL DEFAULT '',
  value INTEGER NOT NULL CHECK(value>=0),
  source TEXT NOT NULL CHECK(length(trim(source))>=5),
  corrects_id TEXT REFERENCES campaign_entries(id),
  recorded_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL,
  CHECK((kind='result')=(metric<>'')),
  CHECK((kind='spend')=(channel<>''))
) STRICT;
CREATE INDEX campaign_entries_campaign ON campaign_entries(campaign_id,kind,entry_date);
CREATE UNIQUE INDEX campaign_entries_one_correction ON campaign_entries(corrects_id) WHERE corrects_id IS NOT NULL;
CREATE TRIGGER campaign_entries_no_update BEFORE UPDATE ON campaign_entries BEGIN SELECT RAISE(ABORT,'an entry is corrected by a new entry'); END;
CREATE TRIGGER campaign_entries_no_delete BEFORE DELETE ON campaign_entries BEGIN SELECT RAISE(ABORT,'an entry is corrected by a new entry'); END;

CREATE TABLE content_items (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  client_id TEXT NOT NULL REFERENCES clients(id),
  campaign_id TEXT REFERENCES campaigns(id),
  brand_id TEXT REFERENCES client_brands(id),
  channel TEXT NOT NULL,
  format TEXT NOT NULL,
  title TEXT NOT NULL CHECK(length(trim(title))>=3),
  brief TEXT NOT NULL DEFAULT '',
  planned_date TEXT NOT NULL,
  planned_time TEXT NOT NULL DEFAULT '' CHECK(planned_time='' OR planned_time GLOB '[0-2][0-9]:[0-5][0-9]'),
  status TEXT NOT NULL CHECK(status IN ('idea','drafting','internal_review','client_review','approved','scheduled','published','cancelled')),
  owner_id TEXT NOT NULL,
  draft_reference TEXT NOT NULL DEFAULT '',
  internal_reviewer TEXT REFERENCES users(id),
  internal_note TEXT NOT NULL DEFAULT '',
  client_approval_reference TEXT NOT NULL DEFAULT '',
  client_approval_recorded_by TEXT REFERENCES users(id),
  published_reference TEXT NOT NULL DEFAULT '',
  published_at TEXT,
  retainer_id TEXT REFERENCES retainers(id),
  deliverable_type TEXT NOT NULL DEFAULT '',
  revision_count INTEGER NOT NULL DEFAULT 0,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(owner_id,tenant_id) REFERENCES users(id,tenant_id),
  CHECK(internal_reviewer IS NULL OR internal_reviewer<>owner_id),
  CHECK(status NOT IN ('client_review','approved','scheduled','published') OR internal_reviewer IS NOT NULL),
  CHECK(status NOT IN ('approved','scheduled','published') OR length(trim(client_approval_reference))>=5),
  CHECK(status<>'published' OR length(trim(published_reference))>=5),
  CHECK((retainer_id IS NULL)=(deliverable_type=''))
) STRICT;
CREATE INDEX content_items_calendar ON content_items(client_id,planned_date);
CREATE TRIGGER content_items_versioned BEFORE UPDATE ON content_items
WHEN NEW.version<>OLD.version+1 OR OLD.status IN ('published','cancelled') OR NEW.client_id<>OLD.client_id OR NEW.owner_id<>OLD.owner_id
BEGIN SELECT RAISE(ABORT,'a published or cancelled item is final'); END;
CREATE TRIGGER content_items_no_delete BEFORE DELETE ON content_items BEGIN SELECT RAISE(ABORT,'content items are cancelled, not deleted'); END;

CREATE TABLE scope_baselines (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  client_id TEXT NOT NULL REFERENCES clients(id),
  name TEXT NOT NULL CHECK(length(trim(name))>=3),
  contract_reference TEXT NOT NULL CHECK(length(trim(contract_reference))>=5),
  lines TEXT NOT NULL CHECK(json_valid(lines)),
  exclusions TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL CHECK(status IN ('active','closed')),
  created_by TEXT NOT NULL REFERENCES users(id),
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(client_id,name)
) STRICT;
CREATE TRIGGER scope_baselines_versioned BEFORE UPDATE ON scope_baselines
WHEN NEW.version<>OLD.version+1 OR OLD.status='closed' OR NEW.lines<>OLD.lines OR NEW.contract_reference<>OLD.contract_reference OR NEW.client_id<>OLD.client_id
BEGIN SELECT RAISE(ABORT,'a baseline is the contract: it is replaced by a new baseline, not edited'); END;
CREATE TRIGGER scope_baselines_no_delete BEFORE DELETE ON scope_baselines BEGIN SELECT RAISE(ABORT,'baselines are retained'); END;

CREATE TABLE scope_events (
  id TEXT PRIMARY KEY,
  baseline_id TEXT NOT NULL REFERENCES scope_baselines(id),
  line_key TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('delivery','revision','new_ask')),
  quantity INTEGER NOT NULL CHECK(quantity BETWEEN 1 AND 1000),
  item_reference TEXT NOT NULL CHECK(length(trim(item_reference))>=3),
  description TEXT NOT NULL DEFAULT '',
  over_scope INTEGER NOT NULL CHECK(over_scope IN (0,1)),
  disposition TEXT CHECK(disposition IS NULL OR disposition IN ('absorbed','change_request','declined')),
  disposition_note TEXT NOT NULL DEFAULT '',
  disposition_by TEXT REFERENCES users(id),
  disposition_at TEXT,
  recorded_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL,
  CHECK(over_scope=1 OR disposition IS NULL),
  CHECK((disposition IS NULL)=(disposition_by IS NULL)),
  CHECK(disposition IS NULL OR length(trim(disposition_note))>=10)
) STRICT;
CREATE INDEX scope_events_baseline ON scope_events(baseline_id,line_key,item_reference);
CREATE TRIGGER scope_events_fixed BEFORE UPDATE ON scope_events
WHEN OLD.disposition IS NOT NULL OR NEW.kind<>OLD.kind OR NEW.quantity<>OLD.quantity OR NEW.line_key<>OLD.line_key OR NEW.item_reference<>OLD.item_reference OR NEW.over_scope<>OLD.over_scope OR NEW.recorded_by<>OLD.recorded_by
BEGIN SELECT RAISE(ABORT,'a scope event is decided once and never rewritten'); END;
CREATE TRIGGER scope_events_no_delete BEFORE DELETE ON scope_events BEGIN SELECT RAISE(ABORT,'scope events are retained'); END;
