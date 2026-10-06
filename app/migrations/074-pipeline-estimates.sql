-- خط الفرص بالاحتمالات، وبطاقات الأسعار، ومصفوفة التقدير (دور × مخرج)، وأوامر التغيير.
-- تبني فوق ملفات العملاء (033-agency.sql) والمسار التجاري القائم ولا تعدلهما.
-- ثلاث قواعد مفروضة هنا لا في الواجهة:
--   (1) كل رقم يحمله إعداد — احتمال فوز مرحلة، عتبة خمول، سعر في بطاقة — يدخله شخص بسنده ويعتمده شخص آخر، والمعتمد لا يُعدَّل:
--       التغيير نسخة جديدة. لا صف افتراضي في أي جدول: الجداول تبدأ فارغة.
--   (2) الفرصة لا تُغلق خاسرة بلا سبب من القائمة وتعليق مكتوب، والمغلقة نهائية.
--   (3) سطر التقدير بلا معدل تكلفة يحمل NULL لا صفرًا، ولا تكلفة بلا مصدرها.

-- ---------- مراحل خط الفرص ----------
CREATE TABLE pipeline_stages (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  code TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK(revision>0),
  name TEXT NOT NULL CHECK(length(trim(name))>=2),
  sort_order INTEGER NOT NULL CHECK(sort_order BETWEEN 1 AND 99),
  -- احتمال الفوز بنقاط أساس (10000 = 100%). رقم يدخله مالك الإجراء من تجربة الشركة، وسنده وتاريخ تأكيده إلزاميان.
  win_probability_bp INTEGER NOT NULL CHECK(win_probability_bp BETWEEN 0 AND 10000),
  probability_basis TEXT NOT NULL CHECK(length(trim(probability_basis))>=10),
  confirmed_on TEXT NOT NULL CHECK(confirmed_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  required_fields TEXT NOT NULL DEFAULT '[]',
  idle_days INTEGER NOT NULL CHECK(idle_days BETWEEN 1 AND 365),
  status TEXT NOT NULL CHECK(status IN ('draft','approved','rejected','retired')),
  prepared_by TEXT NOT NULL REFERENCES users(id),
  decided_by TEXT REFERENCES users(id),
  decided_at TEXT,
  decision_note TEXT NOT NULL DEFAULT '',
  version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(tenant_id,code,revision),
  CHECK(decided_by IS NULL OR decided_by<>prepared_by),
  CHECK((status='draft')=(decided_by IS NULL)),
  CHECK((status='draft')=(decided_at IS NULL))
) STRICT;
-- نسخة معتمدة واحدة ومسودة واحدة لكل مرحلة.
CREATE UNIQUE INDEX pipeline_stages_one_live ON pipeline_stages(tenant_id,code) WHERE status='approved';
CREATE UNIQUE INDEX pipeline_stages_one_draft ON pipeline_stages(tenant_id,code) WHERE status='draft';
-- محتوى النسخة لا يتغير أبدًا؛ الحالة وحدها تنتقل: مسودة ← قرار، ومعتمدة ← مسحوبة.
CREATE TRIGGER pipeline_stages_fixed BEFORE UPDATE ON pipeline_stages
WHEN NEW.version<>OLD.version+1 OR NEW.tenant_id<>OLD.tenant_id OR NEW.code<>OLD.code OR NEW.revision<>OLD.revision OR NEW.name<>OLD.name
  OR NEW.sort_order<>OLD.sort_order OR NEW.win_probability_bp<>OLD.win_probability_bp OR NEW.probability_basis<>OLD.probability_basis
  OR NEW.confirmed_on<>OLD.confirmed_on OR NEW.required_fields<>OLD.required_fields OR NEW.idle_days<>OLD.idle_days OR NEW.prepared_by<>OLD.prepared_by
  OR OLD.status IN ('rejected','retired')
  OR (OLD.status='draft' AND NEW.status NOT IN ('approved','rejected'))
  OR (OLD.status='approved' AND (NEW.status<>'retired' OR NEW.decided_by<>OLD.decided_by OR NEW.decided_at<>OLD.decided_at))
BEGIN SELECT RAISE(ABORT,'a decided pipeline stage is replaced by a new revision, not edited'); END;
CREATE TRIGGER pipeline_stages_no_delete BEFORE DELETE ON pipeline_stages
BEGIN SELECT RAISE(ABORT,'pipeline stages are retained'); END;

-- ---------- أسباب الخسارة ----------
CREATE TABLE pipeline_loss_reasons (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  code TEXT NOT NULL,
  name TEXT NOT NULL CHECK(length(trim(name))>=3),
  active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
  created_by TEXT NOT NULL REFERENCES users(id),
  version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(tenant_id,code),
  UNIQUE(id,tenant_id)
) STRICT;
-- الاسم ثابت بعد الإنشاء حتى لا يتغير معنى تقارير الفترات السابقة؛ يُعطَّل السبب ويُضاف غيره.
CREATE TRIGGER pipeline_loss_reasons_versioned BEFORE UPDATE ON pipeline_loss_reasons
WHEN NEW.version<>OLD.version+1 OR NEW.tenant_id<>OLD.tenant_id OR NEW.code<>OLD.code OR NEW.name<>OLD.name
BEGIN SELECT RAISE(ABORT,'a loss reason keeps its meaning; deactivate it and add another'); END;
CREATE TRIGGER pipeline_loss_reasons_no_delete BEFORE DELETE ON pipeline_loss_reasons
BEGIN SELECT RAISE(ABORT,'loss reasons are deactivated, not deleted'); END;

-- ---------- الفرص ----------
CREATE TABLE opportunities (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  client_id TEXT NOT NULL REFERENCES clients(id),
  name TEXT NOT NULL CHECK(length(trim(name))>=3),
  service_family TEXT NOT NULL,
  value_minor INTEGER NOT NULL CHECK(value_minor BETWEEN 0 AND 999999999999),
  currency TEXT NOT NULL DEFAULT 'SAR' CHECK(currency='SAR'),
  stage_code TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('open','won','lost')),
  expected_close_on TEXT CHECK(expected_close_on IS NULL OR expected_close_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  decision_maker TEXT NOT NULL DEFAULT '',
  budget_note TEXT NOT NULL DEFAULT '',
  next_step TEXT NOT NULL DEFAULT '',
  next_step_on TEXT,
  -- عداد الخمول يُحسب من هذا التاريخ: يحدّثه النشاط المسجل ودخول مرحلة جديدة.
  last_activity_on TEXT NOT NULL CHECK(last_activity_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  loss_reason_id TEXT,
  loss_comment TEXT NOT NULL DEFAULT '',
  close_note TEXT NOT NULL DEFAULT '',
  closed_on TEXT,
  closed_by TEXT REFERENCES users(id),
  version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(id,tenant_id),
  FOREIGN KEY(owner_id,tenant_id) REFERENCES users(id,tenant_id),
  FOREIGN KEY(loss_reason_id,tenant_id) REFERENCES pipeline_loss_reasons(id,tenant_id),
  -- سبب الخسارة وتعليقها إلزاميان عند الخسارة، ولا يُكتبان على غيرها.
  CHECK((status='lost')=(loss_reason_id IS NOT NULL)),
  CHECK(status<>'lost' OR length(trim(loss_comment))>=10),
  CHECK((status='open')=(closed_on IS NULL)),
  CHECK((status='open')=(closed_by IS NULL))
) STRICT;
CREATE INDEX opportunities_board ON opportunities(tenant_id,status,stage_code);
CREATE INDEX opportunities_client ON opportunities(client_id);
CREATE TRIGGER opportunities_same_tenant BEFORE INSERT ON opportunities
WHEN NOT EXISTS(SELECT 1 FROM clients c WHERE c.id=NEW.client_id AND c.tenant_id=NEW.tenant_id)
BEGIN SELECT RAISE(ABORT,'the opportunity and its client belong to one tenant'); END;
-- الفرصة المغلقة نهائية: فرصة أُعيد فتحها تُسجل فرصة جديدة، فيبقى تقرير الخسارة كما كُتب.
CREATE TRIGGER opportunities_versioned BEFORE UPDATE ON opportunities
WHEN NEW.version<>OLD.version+1 OR NEW.tenant_id<>OLD.tenant_id OR NEW.client_id<>OLD.client_id OR NEW.owner_id<>OLD.owner_id OR OLD.status<>'open'
BEGIN SELECT RAISE(ABORT,'a closed opportunity is final; stale or closed record'); END;
CREATE TRIGGER opportunities_no_delete BEFORE DELETE ON opportunities
BEGIN SELECT RAISE(ABORT,'opportunities are retained'); END;

CREATE TABLE opportunity_stage_events (
  id TEXT PRIMARY KEY,
  opportunity_id TEXT NOT NULL REFERENCES opportunities(id),
  from_stage TEXT NOT NULL DEFAULT '',
  to_stage TEXT NOT NULL,
  stage_revision INTEGER NOT NULL,
  requirements_met TEXT NOT NULL DEFAULT '[]',
  note TEXT NOT NULL DEFAULT '',
  moved_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL
) STRICT;
CREATE INDEX opportunity_stage_events_lookup ON opportunity_stage_events(opportunity_id,created_at);
CREATE TRIGGER opportunity_stage_events_fixed BEFORE UPDATE ON opportunity_stage_events
BEGIN SELECT RAISE(ABORT,'stage history is not rewritten'); END;
CREATE TRIGGER opportunity_stage_events_no_delete BEFORE DELETE ON opportunity_stage_events
BEGIN SELECT RAISE(ABORT,'stage history is retained'); END;

CREATE TABLE opportunity_activities (
  id TEXT PRIMARY KEY,
  opportunity_id TEXT NOT NULL REFERENCES opportunities(id),
  activity_date TEXT NOT NULL CHECK(activity_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  kind TEXT NOT NULL CHECK(kind IN ('meeting','call','message','proposal','other')),
  note TEXT NOT NULL CHECK(length(trim(note))>=5),
  recorded_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL
) STRICT;
CREATE INDEX opportunity_activities_lookup ON opportunity_activities(opportunity_id,activity_date);
CREATE TRIGGER opportunity_activities_open_only BEFORE INSERT ON opportunity_activities
WHEN NOT EXISTS(SELECT 1 FROM opportunities o WHERE o.id=NEW.opportunity_id AND o.status='open')
BEGIN SELECT RAISE(ABORT,'activity is logged on an open opportunity'); END;
CREATE TRIGGER opportunity_activities_fixed BEFORE UPDATE ON opportunity_activities
BEGIN SELECT RAISE(ABORT,'a logged activity is not rewritten'); END;
CREATE TRIGGER opportunity_activities_no_delete BEFORE DELETE ON opportunity_activities
BEGIN SELECT RAISE(ABORT,'logged activities are retained'); END;

-- ---------- بطاقات الأسعار ----------
-- نسخ مؤرخة: الساري في تاريخٍ هو آخر نسخة معتمدة بدأ سريانها فيه أو قبله. client_id الفارغ = القائمة العامة،
-- وبطاقة العميل إن وُجدت تتقدم عليها. البنود JSON داخل الصف لأن النسخة وحدة واحدة لا تتجزأ ولا تُعدَّل.
CREATE TABLE price_cards (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  client_id TEXT REFERENCES clients(id),
  name TEXT NOT NULL CHECK(length(trim(name))>=3),
  effective_from TEXT NOT NULL CHECK(effective_from GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  currency TEXT NOT NULL DEFAULT 'SAR' CHECK(currency='SAR'),
  lines TEXT NOT NULL CHECK(json_valid(lines) AND json_array_length(lines)>=1),
  source TEXT NOT NULL CHECK(length(trim(source))>=10),
  status TEXT NOT NULL CHECK(status IN ('draft','approved','rejected')),
  prepared_by TEXT NOT NULL REFERENCES users(id),
  decided_by TEXT REFERENCES users(id),
  decided_at TEXT,
  decision_note TEXT NOT NULL DEFAULT '',
  version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK(decided_by IS NULL OR decided_by<>prepared_by),
  CHECK((status='draft')=(decided_by IS NULL)),
  CHECK((status='draft')=(decided_at IS NULL))
) STRICT;
CREATE UNIQUE INDEX price_cards_one_live ON price_cards(tenant_id,coalesce(client_id,''),effective_from) WHERE status<>'rejected';
CREATE TRIGGER price_cards_same_tenant BEFORE INSERT ON price_cards
WHEN NEW.client_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM clients c WHERE c.id=NEW.client_id AND c.tenant_id=NEW.tenant_id)
BEGIN SELECT RAISE(ABORT,'the price card and its client belong to one tenant'); END;
CREATE TRIGGER price_cards_fixed BEFORE UPDATE ON price_cards
WHEN NEW.version<>OLD.version+1 OR OLD.status<>'draft' OR NEW.status NOT IN ('approved','rejected') OR NEW.tenant_id<>OLD.tenant_id
  OR coalesce(NEW.client_id,'')<>coalesce(OLD.client_id,'') OR NEW.name<>OLD.name OR NEW.effective_from<>OLD.effective_from
  OR NEW.lines<>OLD.lines OR NEW.source<>OLD.source OR NEW.prepared_by<>OLD.prepared_by
BEGIN SELECT RAISE(ABORT,'a price card is decided once; a new price is a new dated card'); END;
CREATE TRIGGER price_cards_no_delete BEFORE DELETE ON price_cards
BEGIN SELECT RAISE(ABORT,'price cards are retained'); END;

-- ---------- التقديرات ----------
CREATE TABLE estimates (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  client_id TEXT NOT NULL REFERENCES clients(id),
  opportunity_id TEXT REFERENCES opportunities(id),
  kind TEXT NOT NULL CHECK(kind IN ('base','change_order')),
  parent_estimate_id TEXT REFERENCES estimates(id),
  change_reason TEXT NOT NULL DEFAULT '',
  scope_event_id TEXT REFERENCES scope_events(id),
  code TEXT NOT NULL,
  name TEXT NOT NULL CHECK(length(trim(name))>=3),
  scope_note TEXT NOT NULL CHECK(length(trim(scope_note))>=10),
  currency TEXT NOT NULL DEFAULT 'SAR' CHECK(currency='SAR'),
  price_card_id TEXT REFERENCES price_cards(id),
  rates_on TEXT NOT NULL CHECK(rates_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  status TEXT NOT NULL CHECK(status IN ('draft','submitted','approved','rejected')),
  prepared_by TEXT NOT NULL REFERENCES users(id),
  submitted_at TEXT,
  decided_by TEXT REFERENCES users(id),
  decided_at TEXT,
  decision_note TEXT NOT NULL DEFAULT '',
  version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(tenant_id,code),
  CHECK(decided_by IS NULL OR decided_by<>prepared_by),
  CHECK((status IN ('approved','rejected'))=(decided_by IS NOT NULL)),
  CHECK((status IN ('approved','rejected'))=(decided_at IS NOT NULL)),
  CHECK((kind='change_order')=(parent_estimate_id IS NOT NULL)),
  CHECK(kind='change_order' OR scope_event_id IS NULL),
  CHECK(kind<>'change_order' OR length(trim(change_reason))>=10)
) STRICT;
CREATE INDEX estimates_client ON estimates(tenant_id,client_id,status);
CREATE INDEX estimates_opportunity ON estimates(opportunity_id);
-- أمر التغيير يُبنى على تقدير معتمد للعميل نفسه؛ لا يُقاس التغيير على رقم لم يُعتمد.
CREATE TRIGGER estimates_consistent BEFORE INSERT ON estimates
WHEN NOT EXISTS(SELECT 1 FROM clients c WHERE c.id=NEW.client_id AND c.tenant_id=NEW.tenant_id)
  OR (NEW.opportunity_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM opportunities o WHERE o.id=NEW.opportunity_id AND o.client_id=NEW.client_id))
  OR (NEW.parent_estimate_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM estimates p WHERE p.id=NEW.parent_estimate_id AND p.client_id=NEW.client_id AND p.tenant_id=NEW.tenant_id AND p.status='approved'))
BEGIN SELECT RAISE(ABORT,'an estimate stays within one client; a change order needs an approved parent'); END;
CREATE TRIGGER estimates_versioned BEFORE UPDATE ON estimates
WHEN NEW.version<>OLD.version+1 OR OLD.status IN ('approved','rejected') OR NEW.tenant_id<>OLD.tenant_id OR NEW.client_id<>OLD.client_id
  OR NEW.kind<>OLD.kind OR coalesce(NEW.parent_estimate_id,'')<>coalesce(OLD.parent_estimate_id,'') OR NEW.code<>OLD.code OR NEW.prepared_by<>OLD.prepared_by
  OR (OLD.status='draft' AND NEW.status NOT IN ('draft','submitted'))
  OR (OLD.status='submitted' AND (NEW.name<>OLD.name OR NEW.scope_note<>OLD.scope_note OR NEW.change_reason<>OLD.change_reason
      OR coalesce(NEW.price_card_id,'')<>coalesce(OLD.price_card_id,'') OR NEW.rates_on<>OLD.rates_on OR NEW.status NOT IN ('approved','rejected','draft')))
BEGIN SELECT RAISE(ABORT,'a decided estimate is final; a correction is a new estimate or a change order'); END;
CREATE TRIGGER estimates_no_delete BEFORE DELETE ON estimates
BEGIN SELECT RAISE(ABORT,'estimates are retained'); END;

-- سطر المصفوفة: دور × مخرج. الساعات بأجزاء المئة (1250 = 12.5 ساعة) والأسعار بالهللات للساعة.
CREATE TABLE estimate_lines (
  id TEXT PRIMARY KEY,
  estimate_id TEXT NOT NULL REFERENCES estimates(id),
  line_no INTEGER NOT NULL CHECK(line_no>0),
  role_name TEXT NOT NULL CHECK(length(trim(role_name))>=2),
  -- رمز الفئة الوظيفية في وحدة معدلات التكلفة؛ نص حر هنا لأن هذه الوحدة لا تستورد تلك، والربط يمر عبر المنسّق.
  category_code TEXT NOT NULL DEFAULT '',
  deliverable TEXT NOT NULL CHECK(length(trim(deliverable))>=2),
  hours_centi INTEGER NOT NULL CHECK(hours_centi BETWEEN 1 AND 10000000),
  sell_rate_minor INTEGER NOT NULL CHECK(sell_rate_minor BETWEEN 1 AND 100000000),
  sell_rate_origin TEXT NOT NULL CHECK(sell_rate_origin IN ('price_card','manual')),
  -- NULL = التكلفة غير متاحة. لا صفر أبدًا: الصفر يصنع هامشًا كاذبًا بنسبة 100%.
  cost_rate_minor INTEGER CHECK(cost_rate_minor IS NULL OR cost_rate_minor BETWEEN 1 AND 100000000),
  cost_rate_source TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  UNIQUE(estimate_id,line_no),
  UNIQUE(estimate_id,role_name,deliverable),
  CHECK((cost_rate_minor IS NULL)=(length(trim(cost_rate_source))=0))
) STRICT;
-- السطور تُكتب وتُستبدل والتقدير مسودة فقط؛ بعد الإرسال تثبت الأرقام التي سيقرر عليها المعتمد.
CREATE TRIGGER estimate_lines_draft_insert BEFORE INSERT ON estimate_lines
WHEN NOT EXISTS(SELECT 1 FROM estimates x WHERE x.id=NEW.estimate_id AND x.status='draft')
BEGIN SELECT RAISE(ABORT,'estimate lines change only while the estimate is a draft'); END;
CREATE TRIGGER estimate_lines_draft_delete BEFORE DELETE ON estimate_lines
WHEN NOT EXISTS(SELECT 1 FROM estimates x WHERE x.id=OLD.estimate_id AND x.status='draft')
BEGIN SELECT RAISE(ABORT,'estimate lines change only while the estimate is a draft'); END;
CREATE TRIGGER estimate_lines_fixed BEFORE UPDATE ON estimate_lines
BEGIN SELECT RAISE(ABORT,'an estimate line is replaced, not rewritten'); END;
-- لا يُرسل للاعتماد تقدير بلا سطور.
CREATE TRIGGER estimates_submit_needs_lines BEFORE UPDATE OF status ON estimates
WHEN NEW.status='submitted' AND NOT EXISTS(SELECT 1 FROM estimate_lines l WHERE l.estimate_id=NEW.id)
BEGIN SELECT RAISE(ABORT,'an estimate without lines is not submitted'); END;

-- نقطة الوصل بالمسار التجاري القائم: يُسجَّل أي ملف تجاري حُمِل إليه التقدير المعتمد عرضًا. المشروع وخط أساسه ينشئهما ذلك المسار لا هذا.
CREATE TABLE estimate_handoffs (
  estimate_id TEXT PRIMARY KEY REFERENCES estimates(id),
  case_id TEXT NOT NULL REFERENCES commercial_cases(id),
  note TEXT NOT NULL DEFAULT '',
  linked_by TEXT NOT NULL REFERENCES users(id),
  linked_at TEXT NOT NULL
) STRICT;
CREATE TRIGGER estimate_handoffs_approved_only BEFORE INSERT ON estimate_handoffs
WHEN NOT EXISTS(SELECT 1 FROM estimates x JOIN commercial_cases k ON k.tenant_id=x.tenant_id WHERE x.id=NEW.estimate_id AND k.id=NEW.case_id AND x.status='approved')
BEGIN SELECT RAISE(ABORT,'only an approved estimate is handed to a commercial case of the same tenant'); END;
CREATE TRIGGER estimate_handoffs_fixed BEFORE UPDATE ON estimate_handoffs
BEGIN SELECT RAISE(ABORT,'a handoff link is not rewritten'); END;
CREATE TRIGGER estimate_handoffs_no_delete BEFORE DELETE ON estimate_handoffs
BEGIN SELECT RAISE(ABORT,'handoff links are retained'); END;
