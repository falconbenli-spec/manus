-- ثلاثة ضوابط داخلية لا صلة لها بجهة خارجية: دورة التحقق من مصادر المعرفة، وإقرار الاطلاع على نسخة سياسة بعينها،
-- وحملات مراجعة الصلاحيات. القاسم المشترك: الفعل البشري المسجل هو الدليل، والدليل لا يُعدَّل بعد تسجيله.

-- ───── أ) مصادر المعرفة ─────
-- المصدر المنتهي لا يُحذف ولا يُحجب؛ يبقى ويُوسَم. تاريخ الانتهاء لا يتحرك إلا بتأكيد مسجل من المالك المسمى (انظر المحفز أدناه).
CREATE TABLE knowledge_sources (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  kind TEXT NOT NULL CHECK(kind IN ('policy','service_card','procedure')),
  -- policy: نوع السياسة في hr_policies (المصدر يتبع النوع عبر نسخه) · service_card: رمز الخدمة · procedure: فارغ.
  reference TEXT NOT NULL DEFAULT '',
  title TEXT NOT NULL CHECK(length(trim(title))>=3),
  location_note TEXT NOT NULL DEFAULT '',
  owner_id TEXT NOT NULL,
  review_interval_days INTEGER NOT NULL CHECK(review_interval_days BETWEEN 7 AND 1095),
  last_verified_on TEXT,
  last_verified_by TEXT REFERENCES users(id),
  expires_on TEXT NOT NULL,
  update_requested INTEGER NOT NULL DEFAULT 0 CHECK(update_requested IN (0,1)),
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','retired')),
  retire_reason TEXT NOT NULL DEFAULT '',
  created_by TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(id,tenant_id),
  FOREIGN KEY(owner_id,tenant_id) REFERENCES users(id,tenant_id),
  FOREIGN KEY(created_by,tenant_id) REFERENCES users(id,tenant_id),
  -- من يسجل المصدر ويسمي مالكه لا يكون هو من يؤكد صحته.
  CHECK(owner_id<>created_by),
  CHECK((last_verified_on IS NULL)=(last_verified_by IS NULL)),
  CHECK(kind='procedure' OR length(trim(reference))>0),
  CHECK(status='active' OR length(trim(retire_reason))>=10)
) STRICT;
CREATE UNIQUE INDEX knowledge_sources_one_live ON knowledge_sources(tenant_id,kind,reference) WHERE status='active' AND reference<>'';
CREATE INDEX knowledge_sources_owner ON knowledge_sources(tenant_id,owner_id,status);

CREATE TABLE knowledge_verifications (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  source_id TEXT NOT NULL,
  decision TEXT NOT NULL CHECK(decision IN ('confirmed','update_requested')),
  note TEXT NOT NULL CHECK(length(trim(note))>=10),
  verified_by TEXT NOT NULL,
  verified_on TEXT NOT NULL,
  previous_expires_on TEXT NOT NULL,
  next_expires_on TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY(source_id,tenant_id) REFERENCES knowledge_sources(id,tenant_id),
  FOREIGN KEY(verified_by,tenant_id) REFERENCES users(id,tenant_id),
  CHECK((decision='confirmed')=(next_expires_on IS NOT NULL))
) STRICT;
CREATE INDEX knowledge_verifications_source ON knowledge_verifications(source_id,created_at);
CREATE TRIGGER knowledge_verifications_owner_only BEFORE INSERT ON knowledge_verifications
WHEN NOT EXISTS(SELECT 1 FROM knowledge_sources s WHERE s.id=NEW.source_id AND s.tenant_id=NEW.tenant_id AND s.owner_id=NEW.verified_by AND s.status='active')
BEGIN SELECT RAISE(ABORT,'only the named owner verifies an active knowledge source'); END;
CREATE TRIGGER knowledge_verifications_no_update BEFORE UPDATE ON knowledge_verifications BEGIN SELECT RAISE(ABORT,'a verification is a recorded human act and is never rewritten'); END;
CREATE TRIGGER knowledge_verifications_no_delete BEFORE DELETE ON knowledge_verifications BEGIN SELECT RAISE(ABORT,'verifications are retained'); END;

CREATE TRIGGER knowledge_sources_versioned BEFORE UPDATE ON knowledge_sources
WHEN NEW.version<>OLD.version+1 OR NEW.tenant_id<>OLD.tenant_id OR NEW.kind<>OLD.kind OR NEW.reference<>OLD.reference OR NEW.created_by<>OLD.created_by OR OLD.status='retired'
BEGIN SELECT RAISE(ABORT,'a knowledge source changes one version at a time and a retired source is final'); END;
-- لا يمتد تاريخ الصلاحية ولا يتغير «آخر تحقق» إلا وفي السجل تأكيد مطابق من المالك.
CREATE TRIGGER knowledge_sources_verified_by_record BEFORE UPDATE ON knowledge_sources
WHEN (NEW.last_verified_on IS NOT OLD.last_verified_on OR NEW.last_verified_by IS NOT OLD.last_verified_by OR NEW.expires_on<>OLD.expires_on)
  AND NOT EXISTS(SELECT 1 FROM knowledge_verifications k WHERE k.source_id=NEW.id AND k.decision='confirmed' AND k.verified_by=NEW.last_verified_by AND k.verified_on=NEW.last_verified_on AND k.next_expires_on=NEW.expires_on)
BEGIN SELECT RAISE(ABORT,'expiry moves only with a recorded owner confirmation'); END;
CREATE TRIGGER knowledge_sources_no_delete BEFORE DELETE ON knowledge_sources BEGIN SELECT RAISE(ABORT,'knowledge sources are flagged or retired, never deleted'); END;

-- ───── ب) إقرار الاطلاع على السياسات ─────
-- الجولة مربوطة بصف السياسة نفسه (وهو لا يتغير بعد اعتماده) وبرقم نسخته وبصمة نصه. نسخة جديدة = صف جديد = جولة جديدة.
CREATE TABLE policy_ack_rounds (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  policy_id TEXT NOT NULL,
  policy_kind TEXT NOT NULL,
  policy_title TEXT NOT NULL,
  policy_revision INTEGER NOT NULL CHECK(policy_revision>0),
  content_digest TEXT NOT NULL CHECK(length(content_digest)=64),
  audience TEXT NOT NULL CHECK(audience IN ('all','department','role')),
  audience_value TEXT NOT NULL DEFAULT '',
  due_on TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  opened_by TEXT NOT NULL,
  opened_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','closed')),
  closed_by TEXT REFERENCES users(id),
  closed_at TEXT,
  close_note TEXT NOT NULL DEFAULT '',
  reminder_count INTEGER NOT NULL DEFAULT 0 CHECK(reminder_count>=0),
  last_reminded_at TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  UNIQUE(id,tenant_id),
  UNIQUE(tenant_id,policy_id),
  FOREIGN KEY(policy_id,tenant_id) REFERENCES hr_policies(id,tenant_id),
  FOREIGN KEY(owner_id,tenant_id) REFERENCES users(id,tenant_id),
  FOREIGN KEY(opened_by,tenant_id) REFERENCES users(id,tenant_id),
  CHECK((audience='all')=(audience_value='')),
  CHECK((status='open')=(closed_by IS NULL)),
  CHECK(status='open' OR (closed_at IS NOT NULL AND length(trim(close_note))>=10))
) STRICT;
CREATE TRIGGER policy_ack_rounds_accepted_only BEFORE INSERT ON policy_ack_rounds
WHEN NOT EXISTS(SELECT 1 FROM hr_policies p WHERE p.id=NEW.policy_id AND p.tenant_id=NEW.tenant_id AND p.status='accepted' AND p.kind=NEW.policy_kind)
BEGIN SELECT RAISE(ABORT,'acknowledgement is requested for an accepted policy only'); END;
CREATE TRIGGER policy_ack_rounds_fixed BEFORE UPDATE ON policy_ack_rounds
WHEN NEW.version<>OLD.version+1 OR OLD.status='closed' OR NEW.tenant_id<>OLD.tenant_id OR NEW.policy_id<>OLD.policy_id OR NEW.policy_revision<>OLD.policy_revision OR NEW.content_digest<>OLD.content_digest
  OR NEW.policy_kind<>OLD.policy_kind OR NEW.policy_title<>OLD.policy_title OR NEW.audience<>OLD.audience OR NEW.audience_value<>OLD.audience_value OR NEW.opened_by<>OLD.opened_by OR NEW.opened_at<>OLD.opened_at
BEGIN SELECT RAISE(ABORT,'a round keeps the exact policy version it was opened for, and a closed round is final'); END;
CREATE TRIGGER policy_ack_rounds_no_delete BEFORE DELETE ON policy_ack_rounds BEGIN SELECT RAISE(ABORT,'acknowledgement rounds are retained'); END;

-- من طُلب منه الإقرار، مثبتًا وقت الطلب: بدونه لا يُعرف من «لم يُقر» ممن «لم يُطلب منه».
CREATE TABLE policy_ack_recipients (
  round_id TEXT NOT NULL,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  user_id TEXT NOT NULL,
  added_at TEXT NOT NULL,
  PRIMARY KEY(round_id,user_id),
  FOREIGN KEY(round_id,tenant_id) REFERENCES policy_ack_rounds(id,tenant_id),
  FOREIGN KEY(user_id,tenant_id) REFERENCES users(id,tenant_id)
) STRICT;
CREATE TRIGGER policy_ack_recipients_open_only BEFORE INSERT ON policy_ack_recipients
WHEN NOT EXISTS(SELECT 1 FROM policy_ack_rounds r WHERE r.id=NEW.round_id AND r.status='open')
BEGIN SELECT RAISE(ABORT,'recipients are added to an open round only'); END;
CREATE TRIGGER policy_ack_recipients_no_update BEFORE UPDATE ON policy_ack_recipients BEGIN SELECT RAISE(ABORT,'the recipient list is evidence'); END;
CREATE TRIGGER policy_ack_recipients_no_delete BEFORE DELETE ON policy_ack_recipients BEGIN SELECT RAISE(ABORT,'the recipient list is evidence'); END;

CREATE TABLE policy_acknowledgements (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  round_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  policy_id TEXT NOT NULL,
  policy_revision INTEGER NOT NULL,
  content_digest TEXT NOT NULL,
  acknowledged_at TEXT NOT NULL,
  UNIQUE(round_id,user_id),
  FOREIGN KEY(round_id,user_id) REFERENCES policy_ack_recipients(round_id,user_id),
  FOREIGN KEY(round_id,tenant_id) REFERENCES policy_ack_rounds(id,tenant_id)
) STRICT;
CREATE INDEX policy_acknowledgements_user ON policy_acknowledgements(tenant_id,user_id);
-- الإقرار يحمل نسخة الجولة نفسها حرفيًا؛ لا إقرار على جولة مغلقة ولا بنسخة غير نسختها.
CREATE TRIGGER policy_acknowledgements_exact_version BEFORE INSERT ON policy_acknowledgements
WHEN NOT EXISTS(SELECT 1 FROM policy_ack_rounds r WHERE r.id=NEW.round_id AND r.tenant_id=NEW.tenant_id AND r.status='open' AND r.policy_id=NEW.policy_id AND r.policy_revision=NEW.policy_revision AND r.content_digest=NEW.content_digest)
BEGIN SELECT RAISE(ABORT,'an acknowledgement names the exact open policy version'); END;
CREATE TRIGGER policy_acknowledgements_no_update BEFORE UPDATE ON policy_acknowledgements BEGIN SELECT RAISE(ABORT,'an acknowledgement is never rewritten'); END;
CREATE TRIGGER policy_acknowledgements_no_delete BEFORE DELETE ON policy_acknowledgements BEGIN SELECT RAISE(ABORT,'acknowledgements are retained'); END;

-- ───── ج) حملات مراجعة الصلاحيات ─────
CREATE TABLE access_review_campaigns (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  title TEXT NOT NULL CHECK(length(trim(title))>=5),
  -- بداية نافذة قياس الاستعمال من سجل التدقيق؛ يحددها من يفتح الحملة.
  usage_since TEXT NOT NULL,
  due_on TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','closed')),
  opened_by TEXT NOT NULL,
  opened_at TEXT NOT NULL,
  closed_by TEXT REFERENCES users(id),
  closed_at TEXT,
  close_note TEXT NOT NULL DEFAULT '',
  version INTEGER NOT NULL DEFAULT 1,
  UNIQUE(id,tenant_id),
  FOREIGN KEY(opened_by,tenant_id) REFERENCES users(id,tenant_id),
  CHECK((status='open')=(closed_by IS NULL)),
  CHECK(status='open' OR (closed_at IS NOT NULL AND length(trim(close_note))>=10))
) STRICT;
CREATE UNIQUE INDEX access_review_one_open ON access_review_campaigns(tenant_id) WHERE status='open';
CREATE TRIGGER access_review_campaigns_fixed BEFORE UPDATE ON access_review_campaigns
WHEN NEW.version<>OLD.version+1 OR OLD.status='closed' OR NEW.tenant_id<>OLD.tenant_id OR NEW.usage_since<>OLD.usage_since OR NEW.opened_by<>OLD.opened_by OR NEW.opened_at<>OLD.opened_at OR NEW.title<>OLD.title
BEGIN SELECT RAISE(ABORT,'a closed access review is dated evidence and is never edited'); END;
CREATE TRIGGER access_review_campaigns_no_delete BEFORE DELETE ON access_review_campaigns BEGIN SELECT RAISE(ABORT,'access reviews are retained'); END;

CREATE TABLE access_review_items (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  campaign_id TEXT NOT NULL,
  subject_id TEXT NOT NULL,
  reviewer_id TEXT NOT NULL,
  capability TEXT NOT NULL,
  capability_name TEXT NOT NULL,
  -- grant: منح صريح في access_grants · role: تصريح حساس يأتي من الدور · admin_level: الصلاحية الكاملة للأدمن الأول.
  source TEXT NOT NULL CHECK(source IN ('grant','role','admin_level')),
  grant_id TEXT REFERENCES access_grants(id),
  department_id TEXT,
  sensitive INTEGER NOT NULL CHECK(sensitive IN (0,1)),
  decision TEXT CHECK(decision IS NULL OR decision IN ('keep','revoke')),
  reason TEXT NOT NULL DEFAULT '',
  -- لقطة الاستعمال تُثبَّت عند القرار أو عند الإغلاق. unmeasured: لا أثر يمكن ربطه بهذا التصريح في سجل التدقيق.
  usage_state TEXT CHECK(usage_state IS NULL OR usage_state IN ('used','unused','unmeasured')),
  usage_events INTEGER,
  last_used_at TEXT,
  decided_by TEXT,
  decided_at TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  FOREIGN KEY(campaign_id,tenant_id) REFERENCES access_review_campaigns(id,tenant_id),
  FOREIGN KEY(subject_id,tenant_id) REFERENCES users(id,tenant_id),
  FOREIGN KEY(reviewer_id,tenant_id) REFERENCES users(id,tenant_id),
  -- لا أحد يراجع تصاريح نفسه، ولا يقرر فيها غير المراجع المسمى.
  CHECK(reviewer_id<>subject_id),
  CHECK(decided_by IS NULL OR decided_by=reviewer_id),
  CHECK((decision IS NULL)=(decided_by IS NULL)),
  CHECK((decision IS NULL)=(decided_at IS NULL)),
  CHECK((source='grant')=(grant_id IS NOT NULL)),
  -- الإبقاء على تصريح حساس قرار يُكتب سببه؛ والسحب يُكتب سببه دائمًا لأن غيره سينفذه.
  CHECK(decision IS NULL OR length(trim(reason))>=10 OR (decision='keep' AND sensitive=0)),
  CHECK(decision IS NULL OR usage_state IS NOT NULL)
) STRICT;
CREATE UNIQUE INDEX access_review_items_once ON access_review_items(campaign_id,subject_id,capability,source,coalesce(department_id,'*'));
CREATE INDEX access_review_items_reviewer ON access_review_items(tenant_id,reviewer_id,campaign_id);
CREATE TRIGGER access_review_items_open_only BEFORE INSERT ON access_review_items
WHEN NOT EXISTS(SELECT 1 FROM access_review_campaigns c WHERE c.id=NEW.campaign_id AND c.status='open')
BEGIN SELECT RAISE(ABORT,'items are added while the campaign is open'); END;
CREATE TRIGGER access_review_items_fixed BEFORE UPDATE ON access_review_items
WHEN NEW.version<>OLD.version+1 OR OLD.decision IS NOT NULL OR NEW.subject_id<>OLD.subject_id OR NEW.reviewer_id<>OLD.reviewer_id OR NEW.capability<>OLD.capability OR NEW.source<>OLD.source
  OR NEW.grant_id IS NOT OLD.grant_id OR NEW.sensitive<>OLD.sensitive OR NEW.campaign_id<>OLD.campaign_id
  OR NOT EXISTS(SELECT 1 FROM access_review_campaigns c WHERE c.id=OLD.campaign_id AND c.status='open')
BEGIN SELECT RAISE(ABORT,'a review decision is recorded once, and nothing changes after the campaign closes'); END;
CREATE TRIGGER access_review_items_no_delete BEFORE DELETE ON access_review_items BEGIN SELECT RAISE(ABORT,'review items are retained'); END;

-- السحب طلبٌ ينفذه إنسان يملك access.manage؛ النظام لا يسحب شيئًا من تلقاء نفسه.
CREATE TABLE access_revocation_requests (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  campaign_id TEXT NOT NULL,
  item_id TEXT NOT NULL UNIQUE REFERENCES access_review_items(id),
  subject_id TEXT NOT NULL,
  capability TEXT NOT NULL,
  source TEXT NOT NULL CHECK(source IN ('grant','role','admin_level')),
  grant_id TEXT REFERENCES access_grants(id),
  reason TEXT NOT NULL CHECK(length(trim(reason))>=10),
  requested_by TEXT NOT NULL,
  requested_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','executed','declined')),
  executed_by TEXT,
  executed_at TEXT,
  execution_note TEXT NOT NULL DEFAULT '',
  version INTEGER NOT NULL DEFAULT 1,
  FOREIGN KEY(campaign_id,tenant_id) REFERENCES access_review_campaigns(id,tenant_id),
  FOREIGN KEY(subject_id,tenant_id) REFERENCES users(id,tenant_id),
  FOREIGN KEY(requested_by,tenant_id) REFERENCES users(id,tenant_id),
  CHECK(requested_by<>subject_id),
  -- من طلب السحب لا ينفذه، وصاحب التصريح لا يقرر في تصريحه.
  CHECK(executed_by IS NULL OR (executed_by<>requested_by AND executed_by<>subject_id)),
  CHECK((status='open')=(executed_by IS NULL)),
  CHECK(status='open' OR (executed_at IS NOT NULL AND length(trim(execution_note))>=10))
) STRICT;
CREATE INDEX access_revocation_open ON access_revocation_requests(tenant_id,status);
CREATE TRIGGER access_revocation_requests_fixed BEFORE UPDATE ON access_revocation_requests
WHEN NEW.version<>OLD.version+1 OR OLD.status<>'open' OR NEW.item_id<>OLD.item_id OR NEW.subject_id<>OLD.subject_id OR NEW.capability<>OLD.capability OR NEW.requested_by<>OLD.requested_by OR NEW.reason<>OLD.reason OR NEW.grant_id IS NOT OLD.grant_id
BEGIN SELECT RAISE(ABORT,'a revocation request is decided once'); END;
CREATE TRIGGER access_revocation_requests_no_delete BEFORE DELETE ON access_revocation_requests BEGIN SELECT RAISE(ABORT,'revocation requests are retained'); END;
