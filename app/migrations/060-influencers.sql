-- المؤثرون وصناع المحتوى: سجل المؤثر ورخصته المعلنة، ارتباط بحملة بمخرجات وحقوق استخدام وإفصاح إعلاني،
-- اعتماد داخلي للمحتوى ثم موافقة عميل موثقة، إثبات نشر يتحقق منه إنسان، وربط الدفعة بأمر الدفع القائم في payables.
-- لا تجلب المنصة أي بيانات من منصات التواصل: كل رقم هنا مُدخل يدويًا بمصدره وتاريخه.

CREATE TABLE influencers (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  code TEXT NOT NULL,
  stage_name TEXT NOT NULL CHECK(length(trim(stage_name))>=2),
  category TEXT NOT NULL,
  contact_mode TEXT NOT NULL CHECK(contact_mode IN ('agency','direct')),
  agency_name TEXT NOT NULL DEFAULT '',
  contact_name TEXT NOT NULL CHECK(length(trim(contact_name))>=2),
  contact_channel TEXT NOT NULL CHECK(length(trim(contact_channel))>=3),
  -- رخصة الترويج الإعلاني: رقمها ومنتهاها ومصدر المعلومة. فارغة تعني «لم تُسجل»، لا «غير مطلوبة».
  licence_number TEXT NOT NULL DEFAULT '',
  licence_expires_on TEXT,
  licence_source TEXT NOT NULL DEFAULT '',
  vendor_id TEXT REFERENCES vendors(id),
  notes TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL CHECK(status IN ('draft','active','paused','blocked')),
  created_by TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(tenant_id,code),
  UNIQUE(tenant_id,stage_name),
  FOREIGN KEY(created_by,tenant_id) REFERENCES users(id,tenant_id),
  CHECK((contact_mode='agency')=(length(trim(agency_name))>0)),
  CHECK((licence_number='')=(licence_expires_on IS NULL)),
  CHECK(licence_number='' OR length(trim(licence_source))>=5)
) STRICT;
CREATE TRIGGER influencers_versioned BEFORE UPDATE ON influencers
WHEN NEW.version<>OLD.version+1 OR NEW.tenant_id<>OLD.tenant_id OR NEW.created_by<>OLD.created_by OR NEW.code<>OLD.code
BEGIN SELECT RAISE(ABORT,'an influencer record keeps its identity and bumps its version once per change'); END;
CREATE TRIGGER influencers_no_delete BEFORE DELETE ON influencers BEGIN SELECT RAISE(ABORT,'influencer records are retained'); END;

CREATE TABLE influencer_accounts (
  id TEXT PRIMARY KEY,
  influencer_id TEXT NOT NULL REFERENCES influencers(id),
  platform TEXT NOT NULL,
  handle TEXT NOT NULL CHECK(length(trim(handle))>=2),
  profile_url TEXT NOT NULL DEFAULT '',
  active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
  added_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL,
  UNIQUE(influencer_id,platform,handle)
) STRICT;
-- الحساب يُعطَّل ولا يُعاد كتابته: المنشور القديم يبقى منسوبًا للحساب الذي نُشر فيه.
CREATE TRIGGER influencer_accounts_retire_only BEFORE UPDATE ON influencer_accounts
WHEN NEW.influencer_id<>OLD.influencer_id OR NEW.platform<>OLD.platform OR NEW.handle<>OLD.handle OR NEW.added_by<>OLD.added_by
BEGIN SELECT RAISE(ABORT,'an account is retired, not rewritten'); END;
CREATE TRIGGER influencer_accounts_no_delete BEFORE DELETE ON influencer_accounts BEGIN SELECT RAISE(ABORT,'accounts are retained'); END;

-- أرقام الجمهور: لا تقرأها المنصة من أي منصة. كل صف لقطة أدخلها موظف بمصدرها وتاريخها، ولا تُحتسب منها أي نسبة.
CREATE TABLE influencer_metrics (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES influencer_accounts(id),
  metric TEXT NOT NULL CHECK(length(trim(metric))>=2),
  value INTEGER NOT NULL CHECK(value>=0),
  unit TEXT NOT NULL DEFAULT '',
  captured_on TEXT NOT NULL,
  entry_method TEXT NOT NULL CHECK(entry_method='manual_snapshot'),
  source TEXT NOT NULL CHECK(length(trim(source))>=5),
  corrects_id TEXT REFERENCES influencer_metrics(id),
  recorded_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL
) STRICT;
CREATE INDEX influencer_metrics_account ON influencer_metrics(account_id,captured_on);
CREATE UNIQUE INDEX influencer_metrics_one_correction ON influencer_metrics(corrects_id) WHERE corrects_id IS NOT NULL;
CREATE TRIGGER influencer_metrics_no_update BEFORE UPDATE ON influencer_metrics BEGIN SELECT RAISE(ABORT,'a snapshot is corrected by a new snapshot'); END;
CREATE TRIGGER influencer_metrics_no_delete BEFORE DELETE ON influencer_metrics BEGIN SELECT RAISE(ABORT,'a snapshot is corrected by a new snapshot'); END;

CREATE TABLE influencer_engagements (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  influencer_id TEXT NOT NULL REFERENCES influencers(id),
  client_id TEXT NOT NULL REFERENCES clients(id),
  campaign_id TEXT NOT NULL REFERENCES campaigns(id),
  title TEXT NOT NULL CHECK(length(trim(title))>=3),
  brief TEXT NOT NULL DEFAULT '',
  posts_count INTEGER NOT NULL CHECK(posts_count BETWEEN 0 AND 500),
  stories_count INTEGER NOT NULL CHECK(stories_count BETWEEN 0 AND 500),
  videos_count INTEGER NOT NULL CHECK(videos_count BETWEEN 0 AND 500),
  fee_minor INTEGER NOT NULL CHECK(fee_minor>0),
  currency TEXT NOT NULL CHECK(currency='SAR'),
  starts_on TEXT NOT NULL,
  ends_on TEXT NOT NULL,
  cancellation_terms TEXT NOT NULL CHECK(length(trim(cancellation_terms))>=10),
  -- الإفصاح الإعلاني: نص ما يجب أن يظهر على المنشور، ودليله يُسجل مع إثبات النشر.
  disclosure_requirement TEXT NOT NULL CHECK(length(trim(disclosure_requirement))>=5),
  usage_scope TEXT NOT NULL CHECK(usage_scope IN ('organic_only','paid_ads')),
  usage_from TEXT NOT NULL,
  usage_until TEXT NOT NULL,
  usage_terms TEXT NOT NULL CHECK(length(trim(usage_terms))>=10),
  status TEXT NOT NULL CHECK(status IN ('draft','internal_review','active','completed','cancelled')),
  owner_id TEXT NOT NULL,
  approved_by TEXT REFERENCES users(id),
  approved_at TEXT,
  approval_note TEXT NOT NULL DEFAULT '',
  -- حالة الرخصة كما كانت لحظة الاعتماد، وإقرار المعتمد المكتوب إن كانت ناقصة أو منتهية.
  licence_state_at_approval TEXT NOT NULL DEFAULT '' CHECK(licence_state_at_approval IN ('','recorded','missing','expired','lapses')),
  licence_ack_note TEXT NOT NULL DEFAULT '',
  return_note TEXT NOT NULL DEFAULT '',
  closing_note TEXT NOT NULL DEFAULT '',
  closed_at TEXT,
  version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(owner_id,tenant_id) REFERENCES users(id,tenant_id),
  CHECK(posts_count+stories_count+videos_count>0),
  CHECK(ends_on>=starts_on),
  CHECK(usage_until>=usage_from),
  -- من أعدّ الارتباط لا يعتمده.
  CHECK(approved_by IS NULL OR approved_by<>owner_id),
  CHECK(status NOT IN ('active','completed') OR approved_by IS NOT NULL),
  CHECK(licence_state_at_approval NOT IN ('missing','expired','lapses') OR length(trim(licence_ack_note))>=20),
  CHECK(status<>'completed' OR length(trim(closing_note))>=10)
) STRICT;
CREATE INDEX influencer_engagements_client ON influencer_engagements(client_id,status);
CREATE INDEX influencer_engagements_influencer ON influencer_engagements(influencer_id);
CREATE TRIGGER influencer_engagements_versioned BEFORE UPDATE ON influencer_engagements
WHEN NEW.version<>OLD.version+1 OR OLD.status IN ('completed','cancelled')
  OR NEW.influencer_id<>OLD.influencer_id OR NEW.client_id<>OLD.client_id OR NEW.campaign_id<>OLD.campaign_id OR NEW.owner_id<>OLD.owner_id OR NEW.tenant_id<>OLD.tenant_id
  OR (OLD.approved_by IS NOT NULL AND (NEW.approved_by<>OLD.approved_by OR NEW.posts_count<>OLD.posts_count OR NEW.stories_count<>OLD.stories_count OR NEW.videos_count<>OLD.videos_count
    OR NEW.fee_minor<>OLD.fee_minor OR NEW.usage_scope<>OLD.usage_scope OR NEW.usage_from<>OLD.usage_from OR NEW.usage_until<>OLD.usage_until OR NEW.usage_terms<>OLD.usage_terms
    OR NEW.cancellation_terms<>OLD.cancellation_terms OR NEW.disclosure_requirement<>OLD.disclosure_requirement OR NEW.licence_ack_note<>OLD.licence_ack_note))
BEGIN SELECT RAISE(ABORT,'an approved engagement keeps its deliverables, fee and usage rights; a closed engagement is final'); END;
CREATE TRIGGER influencer_engagements_no_delete BEFORE DELETE ON influencer_engagements BEGIN SELECT RAISE(ABORT,'engagements are cancelled, not deleted'); END;

CREATE TABLE influencer_content (
  id TEXT PRIMARY KEY,
  engagement_id TEXT NOT NULL REFERENCES influencer_engagements(id),
  kind TEXT NOT NULL CHECK(kind IN ('post','story','video')),
  title TEXT NOT NULL CHECK(length(trim(title))>=3),
  description TEXT NOT NULL DEFAULT '',
  draft_reference TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL CHECK(status IN ('proposed','internal_review','client_review','client_approved','published','cancelled')),
  proposed_by TEXT NOT NULL REFERENCES users(id),
  internal_approved_by TEXT REFERENCES users(id),
  internal_approved_at TEXT,
  internal_note TEXT NOT NULL DEFAULT '',
  -- موافقة العميل يسجلها موظف بمرجع دليلها؛ ليست توقيعًا من العميل داخل المنصة.
  client_approver_name TEXT NOT NULL DEFAULT '',
  client_approval_channel TEXT NOT NULL DEFAULT '',
  client_approval_received_on TEXT,
  client_approval_reference TEXT NOT NULL DEFAULT '',
  client_approval_recorded_by TEXT REFERENCES users(id),
  cancel_note TEXT NOT NULL DEFAULT '',
  version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK(internal_approved_by IS NULL OR internal_approved_by<>proposed_by),
  CHECK(status NOT IN ('client_review','client_approved','published') OR internal_approved_by IS NOT NULL),
  CHECK(status NOT IN ('client_approved','published') OR (length(trim(client_approval_reference))>=10 AND client_approval_recorded_by IS NOT NULL AND length(trim(client_approver_name))>=2 AND client_approval_received_on IS NOT NULL))
) STRICT;
CREATE INDEX influencer_content_engagement ON influencer_content(engagement_id,status);
CREATE TRIGGER influencer_content_versioned BEFORE UPDATE ON influencer_content
WHEN NEW.version<>OLD.version+1 OR OLD.status IN ('published','cancelled') OR NEW.engagement_id<>OLD.engagement_id OR NEW.proposed_by<>OLD.proposed_by
BEGIN SELECT RAISE(ABORT,'published or cancelled content is final'); END;
CREATE TRIGGER influencer_content_no_delete BEFORE DELETE ON influencer_content BEGIN SELECT RAISE(ABORT,'content items are cancelled, not deleted'); END;

-- إثبات النشر. المنصة لا تزور أي منصة ولا تتحقق آليًا: التحقق فعل إنسان يوقّعه باسمه ووقته.
CREATE TABLE influencer_proofs (
  id TEXT PRIMARY KEY,
  content_id TEXT NOT NULL REFERENCES influencer_content(id),
  post_url TEXT NOT NULL CHECK(length(trim(post_url))>=8),
  published_on TEXT NOT NULL,
  screenshot_reference TEXT NOT NULL CHECK(length(trim(screenshot_reference))>=5),
  disclosure_confirmed INTEGER NOT NULL CHECK(disclosure_confirmed=1),
  disclosure_evidence TEXT NOT NULL CHECK(length(trim(disclosure_evidence))>=5),
  recorded_by TEXT NOT NULL REFERENCES users(id),
  recorded_at TEXT NOT NULL,
  verified_by TEXT REFERENCES users(id),
  verified_at TEXT,
  verification_method TEXT NOT NULL DEFAULT '' CHECK(verification_method IN ('','human_open_link','human_screenshot_review')),
  verification_note TEXT NOT NULL DEFAULT '',
  CHECK(verified_by IS NULL OR verified_by<>recorded_by),
  CHECK((verified_by IS NULL)=(verified_at IS NULL)),
  CHECK(verified_by IS NULL OR (verification_method<>'' AND length(trim(verification_note))>=10))
) STRICT;
CREATE UNIQUE INDEX influencer_proofs_content ON influencer_proofs(content_id);
CREATE TRIGGER influencer_proofs_verified_once BEFORE UPDATE ON influencer_proofs
WHEN OLD.verified_by IS NOT NULL OR NEW.content_id<>OLD.content_id OR NEW.post_url<>OLD.post_url OR NEW.published_on<>OLD.published_on
  OR NEW.recorded_by<>OLD.recorded_by OR NEW.disclosure_confirmed<>OLD.disclosure_confirmed OR NEW.screenshot_reference<>OLD.screenshot_reference
BEGIN SELECT RAISE(ABORT,'a proof is verified once by a person and never rewritten'); END;
CREATE TRIGGER influencer_proofs_no_delete BEFORE DELETE ON influencer_proofs BEGIN SELECT RAISE(ABORT,'proofs are retained'); END;

-- ربط الدفعة بالمسار المالي القائم: الدفعة أمر دفع في payables، وهذا الجدول يقيّد لماذا استحقت.
CREATE TABLE influencer_payments (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  engagement_id TEXT NOT NULL REFERENCES influencer_engagements(id),
  payment_order_id TEXT NOT NULL UNIQUE REFERENCES payment_orders(id),
  basis TEXT NOT NULL CHECK(length(trim(basis))>=10),
  proof_state TEXT NOT NULL CHECK(proof_state IN ('verified_proof','written_exception')),
  exception_note TEXT NOT NULL DEFAULT '',
  linked_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL,
  CHECK((proof_state='written_exception')=(length(trim(exception_note))>=20))
) STRICT;
CREATE INDEX influencer_payments_engagement ON influencer_payments(engagement_id);
-- الربط يسبق اعتماد المالية، حتى يرى المعتمد على أي إثبات يدفع.
CREATE TRIGGER influencer_payments_before_approval BEFORE INSERT ON influencer_payments
WHEN (SELECT status FROM payment_orders WHERE id=NEW.payment_order_id)<>'pending'
BEGIN SELECT RAISE(ABORT,'a payment order is linked to its engagement while it still awaits approval'); END;
-- أمر الدفع يخص ملف المورد نفسه المرتبط بالمؤثر.
CREATE TRIGGER influencer_payments_matching_vendor BEFORE INSERT ON influencer_payments
WHEN (SELECT vendor_id FROM payment_orders WHERE id=NEW.payment_order_id)
  IS NOT (SELECT x.vendor_id FROM influencer_engagements e JOIN influencers x ON x.id=e.influencer_id WHERE e.id=NEW.engagement_id)
BEGIN SELECT RAISE(ABORT,'a payment order belongs to the vendor file of the influencer it pays'); END;
-- الدفع بلا إثبات نشر استثناء مكتوب، ولا يكتبه صاحب الارتباط نفسه.
CREATE TRIGGER influencer_payments_exception_not_by_owner BEFORE INSERT ON influencer_payments
WHEN NEW.proof_state='written_exception' AND NEW.linked_by=(SELECT owner_id FROM influencer_engagements WHERE id=NEW.engagement_id)
BEGIN SELECT RAISE(ABORT,'the written exception that pays without proof is not written by the engagement owner'); END;
CREATE TRIGGER influencer_payments_no_update BEFORE UPDATE ON influencer_payments BEGIN SELECT RAISE(ABORT,'a payment link is recorded once'); END;
CREATE TRIGGER influencer_payments_no_delete BEFORE DELETE ON influencer_payments BEGIN SELECT RAISE(ABORT,'payment links are retained'); END;
