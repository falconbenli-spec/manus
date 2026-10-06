-- العلاقات العامة: دليل جهات الإعلام وقوائم منتقاة ومراسلات تُرسل يدويًا خارج المنصة، ثم تغطية يسجلها إنسان.
-- جهات الإعلام بيانات شخصية لأطراف خارجية: لكل سجل أساس جمعه ومصدره وتاريخه، ورؤيته محصورة بحامل تصريح العلاقات العامة.
-- لا رصد آلي ولا حصة صوت ولا تحليل مشاعر ولا قيمة إعلانية مكتسبة: كل رقم هنا أدخله إنسان ووقّع عليه باسمه.
CREATE TABLE media_contacts (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  name TEXT NOT NULL CHECK(length(trim(name))>=3),
  role_title TEXT NOT NULL DEFAULT '',
  outlet TEXT NOT NULL CHECK(length(trim(outlet))>=2),
  outlet_type TEXT NOT NULL CHECK(outlet_type IN ('digital','print','broadcast','podcast')),
  beats TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(beats)),
  language TEXT NOT NULL CHECK(language IN ('ar','en','both')),
  preferences TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  -- أساس معالجة البيانات الشخصية: لا يُسجل شخص خارجي بلا أساس مشروح ومصدر وتاريخ جمع.
  lawful_basis TEXT NOT NULL CHECK(lawful_basis IN ('consent','public_professional_source','contract','other')),
  basis_note TEXT NOT NULL CHECK(length(trim(basis_note))>=10),
  collected_on TEXT NOT NULL,
  source TEXT NOT NULL CHECK(length(trim(source))>=3),
  status TEXT NOT NULL CHECK(status IN ('active','archived')),
  archive_note TEXT NOT NULL DEFAULT '',
  created_by TEXT NOT NULL REFERENCES users(id),
  version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(tenant_id,name,outlet),
  UNIQUE(id,tenant_id),
  CHECK(email='' OR (email LIKE '%_@_%._%' AND length(email)<=180)),
  CHECK(status<>'archived' OR length(trim(archive_note))>=5)
) STRICT;
CREATE INDEX media_contacts_tenant ON media_contacts(tenant_id,status,outlet);
CREATE TRIGGER media_contacts_versioned BEFORE UPDATE ON media_contacts
WHEN NEW.version<>OLD.version+1 OR NEW.tenant_id<>OLD.tenant_id OR NEW.created_by<>OLD.created_by OR (OLD.status='archived' AND NEW.status='archived')
BEGIN SELECT RAISE(ABORT,'a contact keeps its tenant and author; an archived contact is restored before it is edited'); END;
CREATE TRIGGER media_contacts_no_delete BEFORE DELETE ON media_contacts
BEGIN SELECT RAISE(ABORT,'contacts are archived here; erasure of a person is a data subject request, not a row delete'); END;

CREATE TABLE media_lists (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  name TEXT NOT NULL CHECK(length(trim(name))>=3),
  purpose TEXT NOT NULL CHECK(length(trim(purpose))>=10),
  client_id TEXT REFERENCES clients(id),
  campaign_id TEXT REFERENCES campaigns(id),
  status TEXT NOT NULL CHECK(status IN ('draft','locked')),
  created_by TEXT NOT NULL REFERENCES users(id),
  locked_by TEXT REFERENCES users(id),
  locked_at TEXT,
  lock_note TEXT NOT NULL DEFAULT '',
  version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(tenant_id,name),
  UNIQUE(id,tenant_id),
  -- من انتقى القائمة لا يعتمد قفلها.
  CHECK(locked_by IS NULL OR locked_by<>created_by),
  CHECK((status='locked')=(locked_by IS NOT NULL)),
  CHECK(status<>'locked' OR (locked_at IS NOT NULL AND length(trim(lock_note))>=10))
) STRICT;
CREATE TRIGGER media_lists_versioned BEFORE UPDATE ON media_lists
WHEN NEW.version<>OLD.version+1 OR OLD.status='locked' OR NEW.tenant_id<>OLD.tenant_id OR NEW.created_by<>OLD.created_by
BEGIN SELECT RAISE(ABORT,'a locked list is replaced by a new list, not edited'); END;
CREATE TRIGGER media_lists_no_delete BEFORE DELETE ON media_lists BEGIN SELECT RAISE(ABORT,'lists are retained'); END;

CREATE TABLE media_list_members (
  list_id TEXT NOT NULL REFERENCES media_lists(id),
  contact_id TEXT NOT NULL REFERENCES media_contacts(id),
  note TEXT NOT NULL DEFAULT '',
  added_by TEXT NOT NULL REFERENCES users(id),
  added_at TEXT NOT NULL,
  PRIMARY KEY(list_id,contact_id)
) STRICT;
CREATE TRIGGER media_list_members_locked_insert BEFORE INSERT ON media_list_members
WHEN (SELECT status FROM media_lists WHERE id=NEW.list_id)='locked'
BEGIN SELECT RAISE(ABORT,'a locked list does not change'); END;
CREATE TRIGGER media_list_members_locked_delete BEFORE DELETE ON media_list_members
WHEN (SELECT status FROM media_lists WHERE id=OLD.list_id)='locked'
BEGIN SELECT RAISE(ABORT,'a locked list does not change'); END;
CREATE TRIGGER media_list_members_no_update BEFORE UPDATE ON media_list_members
BEGIN SELECT RAISE(ABORT,'membership is added or removed, not rewritten'); END;

-- المراسلة تُرسل يدويًا من بريد الموظف أو هاتفه؛ المنصة تسجل ما جرى ولا ترسل شيئًا.
CREATE TABLE pr_pitches (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  contact_id TEXT NOT NULL,
  list_id TEXT REFERENCES media_lists(id),
  client_id TEXT REFERENCES clients(id),
  campaign_id TEXT REFERENCES campaigns(id),
  subject TEXT NOT NULL CHECK(length(trim(subject))>=3),
  angle TEXT NOT NULL CHECK(length(trim(angle))>=10),
  sent_on TEXT NOT NULL,
  sent_via TEXT NOT NULL CHECK(length(trim(sent_via))>=3),
  status TEXT NOT NULL CHECK(status IN ('sent','replied','declined','published')),
  outcome_on TEXT,
  outcome_note TEXT NOT NULL DEFAULT '',
  recorded_by TEXT NOT NULL REFERENCES users(id),
  version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(contact_id,tenant_id) REFERENCES media_contacts(id,tenant_id),
  UNIQUE(id,tenant_id),
  CHECK((status='sent')=(outcome_on IS NULL)),
  CHECK(status='sent' OR length(trim(outcome_note))>=5),
  CHECK(outcome_on IS NULL OR outcome_on>=sent_on)
) STRICT;
CREATE INDEX pr_pitches_contact ON pr_pitches(tenant_id,contact_id,sent_on);
CREATE TRIGGER pr_pitches_versioned BEFORE UPDATE ON pr_pitches
WHEN NEW.version<>OLD.version+1 OR NEW.tenant_id<>OLD.tenant_id OR NEW.contact_id<>OLD.contact_id OR NEW.recorded_by<>OLD.recorded_by
  OR NEW.sent_on<>OLD.sent_on OR NEW.angle<>OLD.angle OR OLD.status IN ('declined','published')
BEGIN SELECT RAISE(ABORT,'a pitch keeps who it went to, when and with which angle; a declined or published pitch is final'); END;
CREATE TRIGGER pr_pitches_no_delete BEFORE DELETE ON pr_pitches BEGIN SELECT RAISE(ABORT,'pitches are retained'); END;

-- التغطية: ما نُشر فعلًا. النبرة تقدير من يسجل لا تحليل آلي، والرابط فريد فلا تُحتسب التغطية مرتين.
CREATE TABLE pr_coverage (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  pitch_id TEXT REFERENCES pr_pitches(id),
  contact_id TEXT,
  client_id TEXT REFERENCES clients(id),
  campaign_id TEXT REFERENCES campaigns(id),
  outlet TEXT NOT NULL CHECK(length(trim(outlet))>=2),
  outlet_type TEXT NOT NULL CHECK(outlet_type IN ('digital','print','broadcast','podcast')),
  title TEXT NOT NULL CHECK(length(trim(title))>=3),
  url TEXT NOT NULL CHECK(url LIKE 'http%://%' AND length(url)>=12),
  published_on TEXT NOT NULL,
  tone TEXT NOT NULL CHECK(tone IN ('positive','neutral','negative')),
  tone_reason TEXT NOT NULL CHECK(length(trim(tone_reason))>=10),
  highlight INTEGER NOT NULL DEFAULT 0 CHECK(highlight IN (0,1)),
  highlight_reason TEXT NOT NULL DEFAULT '',
  summary TEXT NOT NULL DEFAULT '',
  recorded_by TEXT NOT NULL REFERENCES users(id),
  version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(contact_id,tenant_id) REFERENCES media_contacts(id,tenant_id),
  UNIQUE(tenant_id,url),
  CHECK((highlight=1)=(length(trim(highlight_reason))>=10))
) STRICT;
CREATE INDEX pr_coverage_client ON pr_coverage(tenant_id,client_id,published_on);
CREATE TRIGGER pr_coverage_versioned BEFORE UPDATE ON pr_coverage
WHEN NEW.version<>OLD.version+1 OR NEW.tenant_id<>OLD.tenant_id OR NEW.recorded_by<>OLD.recorded_by OR NEW.pitch_id IS NOT OLD.pitch_id
BEGIN SELECT RAISE(ABORT,'coverage keeps its recorder and the pitch it came from'); END;
CREATE TRIGGER pr_coverage_no_delete BEFORE DELETE ON pr_coverage BEGIN SELECT RAISE(ABORT,'coverage is retained'); END;
