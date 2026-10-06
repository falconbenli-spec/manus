-- حالات الموارد البشرية السرية، والبلاغ المجهول، ومراجعة التعويضات، وبيانات تركيبة القوى العاملة.
--
-- ثلاث قواعد حاكمة:
-- 1) الحالة يراها صاحبها والمسؤول المسند إليه فقط؛ المدير المباشر ليس طرفًا بحكم موقعه، والمشكو منه لا يُسند إليه.
-- 2) البلاغ المجهول لا يحمل أي مفتاح يربطه بحساب: لا عمود مستخدم، ولا طابع زمني بالثانية يُقارَن بسجل الجلسات،
--    ورمز المتابعة تُخزَّن بصمته لا نصه.
-- 3) الزيادة المعتمدة توصية لا أكثر: لا يُعدَّل عقد آليًا، ولا معادلة تحوّل درجة أداء إلى نسبة زيادة.

-- ---------- المدة المستهدفة لكل فئة: إعداد مؤرّخ يدخله صاحب الإجراء بأساسه، لا ثابت في الكود ----------
CREATE TABLE hr_case_settings (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  category TEXT NOT NULL CHECK(category IN ('inquiry','complaint','grievance','violation_report','personal_matter')),
  target_working_days INTEGER NOT NULL CHECK(target_working_days BETWEEN 1 AND 365),
  effective_from TEXT NOT NULL CHECK(effective_from GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  basis TEXT NOT NULL CHECK(length(trim(basis))>=10),
  set_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(tenant_id,category,effective_from),
  FOREIGN KEY(set_by,tenant_id) REFERENCES users(id,tenant_id)
) STRICT;
CREATE TRIGGER hr_case_settings_no_update BEFORE UPDATE ON hr_case_settings BEGIN SELECT RAISE(ABORT,'a dated setting is superseded by a new row, not edited'); END;
CREATE TRIGGER hr_case_settings_no_delete BEFORE DELETE ON hr_case_settings BEGIN SELECT RAISE(ABORT,'dated settings are retained'); END;

CREATE TABLE hr_cases (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  reporter_id TEXT NOT NULL,
  category TEXT NOT NULL CHECK(category IN ('inquiry','complaint','grievance','violation_report','personal_matter')),
  subject TEXT NOT NULL CHECK(length(trim(subject))>=3),
  description TEXT NOT NULL CHECK(length(trim(description))>=20),
  respondent_id TEXT,
  assignee_id TEXT,
  status TEXT NOT NULL CHECK(status IN ('open','assigned','closed')),
  target_setting_id TEXT REFERENCES hr_case_settings(id),
  target_due_on TEXT CHECK(target_due_on IS NULL OR target_due_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  outcome TEXT CHECK(outcome IS NULL OR outcome IN ('resolved','unfounded','referred','withdrawn')),
  closing_reason TEXT NOT NULL DEFAULT '',
  closed_by TEXT REFERENCES users(id),
  closed_at TEXT,
  version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(reporter_id,tenant_id) REFERENCES users(id,tenant_id),
  FOREIGN KEY(respondent_id,tenant_id) REFERENCES users(id,tenant_id),
  FOREIGN KEY(assignee_id,tenant_id) REFERENCES users(id,tenant_id),
  -- تعارض المصالح: المشكو منه لا يُسند إليه، وصاحب الحالة لا يقرر فيها، ولا يشكو أحد نفسه.
  CHECK(assignee_id IS NULL OR respondent_id IS NULL OR assignee_id<>respondent_id),
  CHECK(assignee_id IS NULL OR assignee_id<>reporter_id),
  CHECK(respondent_id IS NULL OR respondent_id<>reporter_id),
  CHECK((status='open')=(assignee_id IS NULL) OR status='closed'),
  CHECK((status='closed')=(outcome IS NOT NULL)),
  CHECK((status='closed')=(closed_by IS NOT NULL)),
  CHECK((status='closed')=(closed_at IS NOT NULL)),
  CHECK(status<>'closed' OR length(trim(closing_reason))>=10),
  -- صاحب الحالة يسحبها فقط؛ أي نتيجة أخرى يقررها غيره.
  CHECK(closed_by IS NULL OR (outcome='withdrawn')=(closed_by=reporter_id))
) STRICT;
CREATE INDEX hr_cases_reporter ON hr_cases(tenant_id,reporter_id,status);
CREATE INDEX hr_cases_assignee ON hr_cases(tenant_id,assignee_id,status);
CREATE TRIGGER hr_cases_closed_final BEFORE UPDATE ON hr_cases WHEN OLD.status='closed'
BEGIN SELECT RAISE(ABORT,'a closed case is final; open a new case that refers to it'); END;
CREATE TRIGGER hr_cases_versioned BEFORE UPDATE ON hr_cases
WHEN NEW.version<>OLD.version+1 OR NEW.tenant_id<>OLD.tenant_id OR NEW.reporter_id<>OLD.reporter_id OR NEW.category<>OLD.category
  OR NEW.subject<>OLD.subject OR NEW.description<>OLD.description OR NEW.respondent_id IS NOT OLD.respondent_id OR NEW.created_at<>OLD.created_at
BEGIN SELECT RAISE(ABORT,'what was filed is never rewritten'); END;
CREATE TRIGGER hr_cases_no_delete BEFORE DELETE ON hr_cases BEGIN SELECT RAISE(ABORT,'cases are retained'); END;

-- كل ملاحظة ورد وقرار سطر مستقل بسببه. لا يُضاف شيء إلى حالة مغلقة.
CREATE TABLE hr_case_events (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  case_id TEXT NOT NULL REFERENCES hr_cases(id),
  actor_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('filed','taken','reassigned','note','reply','decision','closed')),
  body TEXT NOT NULL CHECK(length(trim(body))>=3),
  visible_to_reporter INTEGER NOT NULL CHECK(visible_to_reporter IN (0,1)),
  created_at TEXT NOT NULL,
  FOREIGN KEY(actor_id,tenant_id) REFERENCES users(id,tenant_id)
) STRICT;
CREATE INDEX hr_case_events_case ON hr_case_events(case_id,created_at);
CREATE TRIGGER hr_case_events_closed BEFORE INSERT ON hr_case_events
WHEN (SELECT status FROM hr_cases WHERE id=NEW.case_id)='closed'
BEGIN SELECT RAISE(ABORT,'a closed case takes no further entries'); END;
CREATE TRIGGER hr_case_events_no_update BEFORE UPDATE ON hr_case_events BEGIN SELECT RAISE(ABORT,'case entries are append only'); END;
CREATE TRIGGER hr_case_events_no_delete BEFORE DELETE ON hr_case_events BEGIN SELECT RAISE(ABORT,'case entries are append only'); END;

-- ---------- البلاغ المجهول ----------
-- لا عمود يشير إلى المُبلِّغ إطلاقًا. handler_id وrespondent_id وauthor_id أطراف أخرى: من يعالج، ومن ذُكر في البلاغ، ومن ردّ من جهة المعالجة.
-- التاريخ باليوم فقط: طابع زمني بالثانية يكفي لمطابقته مع سجل الجلسات في شركة من ثلاثين موظفًا.
CREATE TABLE anonymous_reports (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  token_hash TEXT NOT NULL UNIQUE CHECK(length(token_hash)=64),
  body TEXT NOT NULL CHECK(length(trim(body))>=30),
  respondent_id TEXT,
  handler_id TEXT,
  status TEXT NOT NULL CHECK(status IN ('received','under_review','closed')),
  outcome TEXT CHECK(outcome IS NULL OR outcome IN ('substantiated','unsubstantiated','insufficient_information','referred')),
  closing_reason TEXT NOT NULL DEFAULT '',
  received_on TEXT NOT NULL CHECK(received_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  closed_on TEXT,
  version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),
  FOREIGN KEY(respondent_id,tenant_id) REFERENCES users(id,tenant_id),
  FOREIGN KEY(handler_id,tenant_id) REFERENCES users(id,tenant_id),
  CHECK(handler_id IS NULL OR respondent_id IS NULL OR handler_id<>respondent_id),
  CHECK((status='received')=(handler_id IS NULL)),
  CHECK((status='closed')=(outcome IS NOT NULL)),
  CHECK((status='closed')=(closed_on IS NOT NULL)),
  CHECK(status<>'closed' OR length(trim(closing_reason))>=10)
) STRICT;
CREATE TRIGGER anonymous_reports_closed_final BEFORE UPDATE ON anonymous_reports WHEN OLD.status='closed'
BEGIN SELECT RAISE(ABORT,'a closed report is final'); END;
CREATE TRIGGER anonymous_reports_versioned BEFORE UPDATE ON anonymous_reports
WHEN NEW.version<>OLD.version+1 OR NEW.tenant_id<>OLD.tenant_id OR NEW.token_hash<>OLD.token_hash OR NEW.body<>OLD.body
  OR NEW.respondent_id IS NOT OLD.respondent_id OR NEW.received_on<>OLD.received_on
BEGIN SELECT RAISE(ABORT,'what was reported is never rewritten'); END;
CREATE TRIGGER anonymous_reports_no_delete BEFORE DELETE ON anonymous_reports BEGIN SELECT RAISE(ABORT,'reports are retained'); END;

CREATE TABLE anonymous_report_messages (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  report_id TEXT NOT NULL REFERENCES anonymous_reports(id),
  side TEXT NOT NULL CHECK(side IN ('reporter','handler')),
  author_id TEXT,
  body TEXT NOT NULL CHECK(length(trim(body))>=3),
  posted_on TEXT NOT NULL CHECK(posted_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  FOREIGN KEY(author_id,tenant_id) REFERENCES users(id,tenant_id),
  -- رسالة المُبلِّغ بلا كاتب دائمًا؛ رسالة المعالج بكاتبها دائمًا.
  CHECK((side='reporter')=(author_id IS NULL))
) STRICT;
CREATE INDEX anonymous_report_messages_report ON anonymous_report_messages(report_id);
CREATE TRIGGER anonymous_report_messages_closed BEFORE INSERT ON anonymous_report_messages
WHEN (SELECT status FROM anonymous_reports WHERE id=NEW.report_id)='closed'
BEGIN SELECT RAISE(ABORT,'a closed report takes no further messages'); END;
CREATE TRIGGER anonymous_report_messages_no_update BEFORE UPDATE ON anonymous_report_messages BEGIN SELECT RAISE(ABORT,'messages are append only'); END;
CREATE TRIGGER anonymous_report_messages_no_delete BEFORE DELETE ON anonymous_report_messages BEGIN SELECT RAISE(ABORT,'messages are append only'); END;

-- ---------- نطاقات الرواتب ----------
-- نطاق لكل فئة وظيفية ومستوى بنسخ مؤرّخة. لا نطاق بلا مصدر مكتوب، ولا بيانات سوق تأتي من المنصة.
CREATE TABLE salary_bands (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  category_id TEXT NOT NULL,
  level TEXT NOT NULL CHECK(length(trim(level)) BETWEEN 1 AND 40),
  min_minor INTEGER NOT NULL CHECK(min_minor>0),
  mid_minor INTEGER NOT NULL,
  max_minor INTEGER NOT NULL CHECK(max_minor<=100000000000),
  currency TEXT NOT NULL CHECK(currency='SAR'),
  effective_from TEXT NOT NULL CHECK(effective_from GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  source TEXT NOT NULL CHECK(length(trim(source))>=10),
  status TEXT NOT NULL CHECK(status IN ('draft','approved','rejected')),
  prepared_by TEXT NOT NULL REFERENCES users(id),
  decided_by TEXT REFERENCES users(id),
  decided_at TEXT,
  decision_note TEXT NOT NULL DEFAULT '',
  version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(id,tenant_id),
  FOREIGN KEY(category_id,tenant_id) REFERENCES job_categories(id,tenant_id),
  CHECK(min_minor<=mid_minor AND mid_minor<=max_minor),
  CHECK(decided_by IS NULL OR decided_by<>prepared_by),
  CHECK((status='draft')=(decided_by IS NULL)),
  CHECK((status='draft')=(decided_at IS NULL))
) STRICT;
CREATE UNIQUE INDEX salary_bands_one_live ON salary_bands(tenant_id,category_id,level,effective_from) WHERE status<>'rejected';
CREATE TRIGGER salary_bands_fixed BEFORE UPDATE ON salary_bands
WHEN OLD.status<>'draft' OR NEW.version<>OLD.version+1 OR NEW.status NOT IN ('approved','rejected')
  OR NEW.min_minor<>OLD.min_minor OR NEW.mid_minor<>OLD.mid_minor OR NEW.max_minor<>OLD.max_minor OR NEW.level<>OLD.level
  OR NEW.effective_from<>OLD.effective_from OR NEW.category_id<>OLD.category_id OR NEW.source<>OLD.source
  OR NEW.prepared_by<>OLD.prepared_by OR NEW.tenant_id<>OLD.tenant_id
BEGIN SELECT RAISE(ABORT,'an approved band is never revised; approve a new dated band instead'); END;
CREATE TRIGGER salary_bands_no_delete BEFORE DELETE ON salary_bands BEGIN SELECT RAISE(ABORT,'bands are retained'); END;

-- ---------- دورة المراجعة السنوية ----------
CREATE TABLE compensation_cycles (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  name TEXT NOT NULL CHECK(length(trim(name))>=3),
  year INTEGER NOT NULL CHECK(year BETWEEN 2020 AND 2100),
  -- الميزانية مجموع الزيادات الشهرية المسموح اعتمادها في الدورة كلها، بالهللات.
  budget_minor INTEGER NOT NULL CHECK(budget_minor>0 AND budget_minor<=100000000000),
  currency TEXT NOT NULL CHECK(currency='SAR'),
  budget_source TEXT NOT NULL CHECK(length(trim(budget_source))>=10),
  increases_effective_from TEXT NOT NULL CHECK(increases_effective_from GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  status TEXT NOT NULL CHECK(status IN ('draft','open','closed')),
  created_by TEXT NOT NULL REFERENCES users(id),
  opened_by TEXT REFERENCES users(id),
  opened_at TEXT,
  closed_by TEXT REFERENCES users(id),
  closed_at TEXT,
  version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(tenant_id,name),
  UNIQUE(id,tenant_id),
  -- من وضع الميزانية لا يفتح الدورة بها.
  CHECK(opened_by IS NULL OR opened_by<>created_by),
  CHECK((status='draft')=(opened_by IS NULL)),
  CHECK((status='closed')=(closed_by IS NOT NULL))
) STRICT;
CREATE TRIGGER compensation_cycles_versioned BEFORE UPDATE ON compensation_cycles
WHEN NEW.version<>OLD.version+1 OR OLD.status='closed' OR NEW.tenant_id<>OLD.tenant_id OR NEW.created_by<>OLD.created_by
  OR NEW.budget_minor<>OLD.budget_minor OR NEW.budget_source<>OLD.budget_source OR NEW.year<>OLD.year OR NEW.name<>OLD.name
  OR NEW.increases_effective_from<>OLD.increases_effective_from
BEGIN SELECT RAISE(ABORT,'a cycle keeps its budget; a closed cycle is final'); END;
CREATE TRIGGER compensation_cycles_no_delete BEFORE DELETE ON compensation_cycles BEGIN SELECT RAISE(ABORT,'cycles are retained'); END;

CREATE TABLE compensation_proposals (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  cycle_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  proposed_by TEXT NOT NULL,
  -- المقترِح يكتب مبلغ الزيادة الشهرية لا نسبة: النسبة مع رسالة الميزانية تكشف الراتب لمن لا يراه.
  increase_minor INTEGER NOT NULL CHECK(increase_minor>0 AND increase_minor<=100000000),
  currency TEXT NOT NULL CHECK(currency='SAR'),
  rationale TEXT NOT NULL CHECK(length(trim(rationale))>=20),
  -- لقطة من العقد الساري وقت الاقتراح؛ تبقى صحيحة ولو عُدّل العقد بعدها.
  contract_id TEXT NOT NULL REFERENCES employment_contracts(id),
  current_monthly_minor INTEGER NOT NULL CHECK(current_monthly_minor>0),
  band_id TEXT REFERENCES salary_bands(id),
  band_position TEXT CHECK(band_position IS NULL OR band_position IN ('below','within','above','no_band')),
  exception_note TEXT NOT NULL DEFAULT '',
  assessed_by TEXT REFERENCES users(id),
  assessed_at TEXT,
  status TEXT NOT NULL CHECK(status IN ('proposed','assessed','approved','rejected','withdrawn')),
  decided_by TEXT REFERENCES users(id),
  decided_at TEXT,
  decision_note TEXT NOT NULL DEFAULT '',
  version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(id,tenant_id),
  FOREIGN KEY(cycle_id,tenant_id) REFERENCES compensation_cycles(id,tenant_id),
  FOREIGN KEY(user_id,tenant_id) REFERENCES users(id,tenant_id),
  FOREIGN KEY(proposed_by,tenant_id) REFERENCES users(id,tenant_id),
  -- لا يقترح أحد لنفسه، ولا يقيّم أو يقرر أحد في زيادته، والمقترِح ليس المعتمِد.
  CHECK(proposed_by<>user_id),
  CHECK(assessed_by IS NULL OR assessed_by<>user_id),
  CHECK(decided_by IS NULL OR (decided_by<>user_id AND decided_by<>proposed_by)),
  CHECK(status<>'proposed' OR band_position IS NULL),
  CHECK(status NOT IN ('assessed','approved','rejected') OR band_position IS NOT NULL),
  CHECK((band_position IS NULL)=(assessed_by IS NULL)),
  CHECK(band_position IS NULL OR (band_position='no_band')=(band_id IS NULL)),
  -- خارج النطاق أو بلا نطاق: مبرر مكتوب من المقيّم، واعتماد من غيره.
  CHECK(band_position IS NULL OR band_position='within' OR length(trim(exception_note))>=20),
  CHECK(band_position IS NULL OR band_position='within' OR decided_by IS NULL OR status<>'approved' OR decided_by<>assessed_by),
  CHECK((status IN ('approved','rejected'))=(decided_by IS NOT NULL)),
  CHECK(status NOT IN ('approved','rejected') OR length(trim(decision_note))>=10)
) STRICT;
CREATE UNIQUE INDEX compensation_proposals_one_live ON compensation_proposals(cycle_id,user_id) WHERE status IN ('proposed','assessed','approved');
CREATE INDEX compensation_proposals_cycle ON compensation_proposals(tenant_id,cycle_id,status);
-- حاجز الميزانية في القاعدة نفسها: المبلغ ثابت بعد الإدخال والحالة لا تعود حية بعد خروجها، فيكفي الفحص عند الإدخال.
CREATE TRIGGER compensation_proposals_budget BEFORE INSERT ON compensation_proposals
WHEN (SELECT COALESCE(SUM(increase_minor),0) FROM compensation_proposals WHERE cycle_id=NEW.cycle_id AND status IN ('proposed','assessed','approved'))+NEW.increase_minor
  >(SELECT budget_minor FROM compensation_cycles WHERE id=NEW.cycle_id)
BEGIN SELECT RAISE(ABORT,'proposed increases exceed the cycle budget'); END;
CREATE TRIGGER compensation_proposals_open_cycle BEFORE INSERT ON compensation_proposals
WHEN (SELECT status FROM compensation_cycles WHERE id=NEW.cycle_id)<>'open'
BEGIN SELECT RAISE(ABORT,'proposals are taken by an open cycle only'); END;
CREATE TRIGGER compensation_proposals_fixed BEFORE UPDATE ON compensation_proposals
WHEN OLD.status IN ('approved','rejected','withdrawn') OR NEW.version<>OLD.version+1 OR NEW.tenant_id<>OLD.tenant_id OR NEW.cycle_id<>OLD.cycle_id
  OR NEW.user_id<>OLD.user_id OR NEW.proposed_by<>OLD.proposed_by OR NEW.increase_minor<>OLD.increase_minor OR NEW.rationale<>OLD.rationale
  OR NEW.contract_id<>OLD.contract_id OR NEW.current_monthly_minor<>OLD.current_monthly_minor
  OR (OLD.status='assessed' AND (NEW.band_id IS NOT OLD.band_id OR NEW.band_position<>OLD.band_position OR NEW.exception_note<>OLD.exception_note OR NEW.assessed_by<>OLD.assessed_by))
  OR (OLD.status='proposed' AND NEW.status NOT IN ('assessed','withdrawn'))
  OR (OLD.status='assessed' AND NEW.status NOT IN ('approved','rejected','withdrawn'))
BEGIN SELECT RAISE(ABORT,'a decided proposal is final; correct it with a new proposal'); END;
CREATE TRIGGER compensation_proposals_no_delete BEFORE DELETE ON compensation_proposals BEGIN SELECT RAISE(ABORT,'proposals are retained'); END;

-- الزيادة المعتمدة توصية لصاحب تصريح إعداد العقود. لا شيء هنا يكتب في جدول العقود.
CREATE TABLE compensation_recommendations (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  proposal_id TEXT NOT NULL UNIQUE,
  user_id TEXT NOT NULL,
  contract_id TEXT NOT NULL REFERENCES employment_contracts(id),
  increase_minor INTEGER NOT NULL CHECK(increase_minor>0),
  recommended_monthly_minor INTEGER NOT NULL CHECK(recommended_monthly_minor>0),
  currency TEXT NOT NULL CHECK(currency='SAR'),
  effective_from TEXT NOT NULL CHECK(effective_from GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  status TEXT NOT NULL CHECK(status IN ('open','fulfilled','dropped')),
  new_contract_id TEXT REFERENCES employment_contracts(id),
  closed_by TEXT REFERENCES users(id),
  closed_at TEXT,
  closing_note TEXT NOT NULL DEFAULT '',
  version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),
  created_at TEXT NOT NULL,
  FOREIGN KEY(proposal_id,tenant_id) REFERENCES compensation_proposals(id,tenant_id),
  FOREIGN KEY(user_id,tenant_id) REFERENCES users(id,tenant_id),
  CHECK((status='open')=(closed_by IS NULL)),
  CHECK((status='fulfilled')=(new_contract_id IS NOT NULL)),
  CHECK(closed_by IS NULL OR closed_by<>user_id),
  CHECK(status<>'dropped' OR length(trim(closing_note))>=10)
) STRICT;
CREATE TRIGGER compensation_recommendations_fixed BEFORE UPDATE ON compensation_recommendations
WHEN OLD.status<>'open' OR NEW.version<>OLD.version+1 OR NEW.proposal_id<>OLD.proposal_id OR NEW.user_id<>OLD.user_id OR NEW.contract_id<>OLD.contract_id
  OR NEW.increase_minor<>OLD.increase_minor OR NEW.recommended_monthly_minor<>OLD.recommended_monthly_minor OR NEW.effective_from<>OLD.effective_from OR NEW.tenant_id<>OLD.tenant_id
BEGIN SELECT RAISE(ABORT,'a settled recommendation is final'); END;
CREATE TRIGGER compensation_recommendations_no_delete BEFORE DELETE ON compensation_recommendations BEGIN SELECT RAISE(ABORT,'recommendations are retained'); END;

-- الحد الأدنى لحجم المجموعة في تحليل فجوة الأجر: إعداد مؤرّخ بأساسه، ولا قيمة افتراضية له في الكود ولا هنا.
CREATE TABLE compensation_privacy_settings (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  min_group_size INTEGER NOT NULL CHECK(min_group_size BETWEEN 3 AND 500),
  effective_from TEXT NOT NULL CHECK(effective_from GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  basis TEXT NOT NULL CHECK(length(trim(basis))>=10),
  set_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(tenant_id,effective_from),
  FOREIGN KEY(set_by,tenant_id) REFERENCES users(id,tenant_id)
) STRICT;
CREATE TRIGGER compensation_privacy_no_update BEFORE UPDATE ON compensation_privacy_settings BEGIN SELECT RAISE(ABORT,'a dated setting is superseded by a new row, not edited'); END;
CREATE TRIGGER compensation_privacy_no_delete BEFORE DELETE ON compensation_privacy_settings BEGIN SELECT RAISE(ABORT,'dated settings are retained'); END;

-- ---------- بيانات تركيبة القوى العاملة ----------
-- جدول ملحق لا تعديل على users ولا employee_profiles. الجنسية فئتان فقط لأن هذا كل ما تحتاجه النسبة؛
-- لا رقم هوية ولا بلد. الجنس اختياري ويُستخدم في تحليل فجوة الأجر المجمّع فقط.
CREATE TABLE employee_demographics (
  user_id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  nationality_group TEXT NOT NULL CHECK(nationality_group IN ('saudi','non_saudi')),
  gender TEXT CHECK(gender IS NULL OR gender IN ('female','male')),
  source TEXT NOT NULL CHECK(length(trim(source))>=5),
  recorded_by TEXT NOT NULL REFERENCES users(id),
  version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),
  updated_at TEXT NOT NULL,
  FOREIGN KEY(user_id,tenant_id) REFERENCES users(id,tenant_id),
  CHECK(recorded_by<>user_id)
) STRICT;
CREATE TRIGGER employee_demographics_versioned BEFORE UPDATE ON employee_demographics
WHEN NEW.version<>OLD.version+1 OR NEW.user_id<>OLD.user_id OR NEW.tenant_id<>OLD.tenant_id
BEGIN SELECT RAISE(ABORT,'stale demographics record'); END;
CREATE TRIGGER employee_demographics_no_delete BEFORE DELETE ON employee_demographics BEGIN SELECT RAISE(ABORT,'demographic records are retained'); END;
