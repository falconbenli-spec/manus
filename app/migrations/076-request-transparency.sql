-- شفافية الطلب بعد التقديم: إغلاق بدليل تسليم، وإعادة فتح لا تمحو الجولة الأولى، وحدّ أدنى يحمي صاحب الرأي.
-- القاعدة الحاكمة هنا: لا يُمحى شيء. إعادة الفتح جولة ثانية مرتبطة بإغلاق الجولة الأولى،
-- فيبقى في السجل أن الخدمة لم تُنجز من أول مرة، وهذه بالضبط المعلومة التي يخفيها أي نظام يسمح بـ«إلغاء الإغلاق».

-- ---------- إغلاق الطلب بدليل ----------
-- `transition(...,'complete')` في workflow.mjs يطلب ملاحظة قصيرة. هذا الجدول يبني فوقها:
-- سطر مستقل لكل جولة إغلاق يحمل وصف ما سُلِّم فعلًا، ومن أغلق، وعند أي إدارة كان الطلب حينها.
CREATE TABLE request_closures (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  request_id TEXT NOT NULL,
  round INTEGER NOT NULL CHECK(round BETWEEN 1 AND 20),
  -- عشرون حرفًا ليست حاجزًا شكليًا: «تم» و«أُنجز» لا تصف ما استلمه صاحب الطلب ولا تصلح دليلًا بعد شهر.
  delivered TEXT NOT NULL CHECK(length(trim(delivered))>=20),
  closed_by TEXT NOT NULL REFERENCES users(id),
  handling_department_id TEXT NOT NULL,
  closed_at TEXT NOT NULL,
  UNIQUE(request_id,round),
  FOREIGN KEY(request_id,tenant_id) REFERENCES requests(id,tenant_id),
  FOREIGN KEY(handling_department_id,tenant_id) REFERENCES departments(id,tenant_id)
) STRICT;
CREATE INDEX request_closures_request ON request_closures(tenant_id,request_id);

-- فصل المهام بالهوية: صاحب الطلب لا يشهد لنفسه بالتسليم.
CREATE TRIGGER request_closures_not_requester BEFORE INSERT ON request_closures
WHEN NEW.closed_by=(SELECT requester_id FROM requests WHERE id=NEW.request_id)
BEGIN SELECT RAISE(ABORT,'the requester does not certify delivery of their own request'); END;

-- الجولة تُغلق مرة واحدة: التصحيح جولة جديدة، لا إعادة كتابة دليل التسليم.
CREATE TRIGGER request_closures_append_only BEFORE UPDATE ON request_closures
BEGIN SELECT RAISE(ABORT,'a closure is written once; a second delivery is a new round'); END;
CREATE TRIGGER request_closures_no_delete BEFORE DELETE ON request_closures
BEGIN SELECT RAISE(ABORT,'closure history is retained'); END;

-- ---------- إعادة الفتح ----------
-- إعادة الفتح لا تُلغي الإغلاق السابق ولا تُعدّله: سطر جديد يشير إلى الإغلاق الذي لم يُقنع صاحب الطلب.
CREATE TABLE request_reopenings (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  request_id TEXT NOT NULL,
  closure_id TEXT NOT NULL REFERENCES request_closures(id),
  round INTEGER NOT NULL CHECK(round BETWEEN 2 AND 20),
  reason TEXT NOT NULL CHECK(length(trim(reason))>=10),
  requested_by TEXT NOT NULL REFERENCES users(id),
  -- المهلة المطبّقة وتاريخ انتهائها يُثبتان وقت إعادة الفتح، فلا يغيّر تعديلٌ لاحق للإعداد حكمَ ما مضى.
  window_days INTEGER NOT NULL CHECK(window_days BETWEEN 1 AND 120),
  deadline_on TEXT NOT NULL CHECK(deadline_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  created_at TEXT NOT NULL,
  UNIQUE(request_id,round),
  UNIQUE(closure_id),
  FOREIGN KEY(request_id,tenant_id) REFERENCES requests(id,tenant_id)
) STRICT;
CREATE INDEX request_reopenings_request ON request_reopenings(tenant_id,request_id);

-- إعادة الفتح لصاحب الطلب وحده: من نفّذ لا يقرر أن تنفيذه لم يكفِ.
CREATE TRIGGER request_reopenings_requester_only BEFORE INSERT ON request_reopenings
WHEN NEW.requested_by<>(SELECT requester_id FROM requests WHERE id=NEW.request_id)
BEGIN SELECT RAISE(ABORT,'a completed request is reopened by its requester alone'); END;

-- الجولة الجديدة تتبع إغلاق الجولة التي قبلها مباشرة، فلا تنفصل سلسلة الجولات.
CREATE TRIGGER request_reopenings_follow_closure BEFORE INSERT ON request_reopenings
WHEN NOT EXISTS(SELECT 1 FROM request_closures c WHERE c.id=NEW.closure_id AND c.request_id=NEW.request_id AND c.round=NEW.round-1)
BEGIN SELECT RAISE(ABORT,'a reopening follows the closure of the round before it'); END;

CREATE TRIGGER request_reopenings_append_only BEFORE UPDATE ON request_reopenings
BEGIN SELECT RAISE(ABORT,'a reopening is written once'); END;
CREATE TRIGGER request_reopenings_no_delete BEFORE DELETE ON request_reopenings
BEGIN SELECT RAISE(ABORT,'reopening history is retained'); END;

-- ---------- مهلة إعادة الفتح: إعداد لا ثابت في الكود ----------
-- المنصة لا تعرف كم يوم عمل يحق فيه لصاحب الطلب أن يقول «لم تُنجز حاجتي» في هذه الشركة.
-- لا قيمة افتراضية ولا صف ابتدائي: ما لم يضع مالك الإجراء المهلة بسندها وتاريخ تأكيدها، إعادة الفتح غير متاحة أصلًا.
-- `scope_code` رمز خدمة بعينها، أو '*' لإعداد يسري على كل خدمة لم تُفرد بإعداد خاص.
CREATE TABLE reopen_settings (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  scope_code TEXT NOT NULL CHECK(length(trim(scope_code)) BETWEEN 1 AND 40),
  window_days INTEGER NOT NULL CHECK(window_days BETWEEN 1 AND 120),
  basis TEXT NOT NULL CHECK(length(trim(basis))>=10),
  confirmed_on TEXT NOT NULL CHECK(confirmed_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  set_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL,
  superseded_at TEXT
) STRICT;
CREATE UNIQUE INDEX reopen_settings_one_live ON reopen_settings(tenant_id,scope_code) WHERE superseded_at IS NULL;

-- المهلة تُستبدل بصف جديد مؤرَّخ ولا تُعدَّل، فيبقى معروفًا أي مهلة كانت سارية يوم أُغلق أي طلب.
CREATE TRIGGER reopen_settings_superseded_only BEFORE UPDATE ON reopen_settings
WHEN OLD.superseded_at IS NOT NULL OR NEW.tenant_id<>OLD.tenant_id OR NEW.scope_code<>OLD.scope_code
  OR NEW.window_days<>OLD.window_days OR NEW.basis<>OLD.basis OR NEW.confirmed_on<>OLD.confirmed_on
BEGIN SELECT RAISE(ABORT,'a reopen window is replaced by a new dated row, not edited'); END;
CREATE TRIGGER reopen_settings_no_delete BEFORE DELETE ON reopen_settings
BEGIN SELECT RAISE(ABORT,'reopen window history is retained'); END;

-- ---------- الحد الأدنى قبل عرض أي نتيجة مجمّعة ----------
-- في إدارة من ثلاثة أشخاص، متوسطٌ على إجابتين يكشف صاحب الرأي باسمه عمليًا.
-- ثلاثة حد أدنى مطلق في القيد، والقيمة الفعلية قرار مالك الإجراء بسنده. بلا إعداد: لا تُعرض نتيجة مجمّعة إطلاقًا.
CREATE TABLE experience_settings (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  min_responses INTEGER NOT NULL CHECK(min_responses BETWEEN 3 AND 50),
  basis TEXT NOT NULL CHECK(length(trim(basis))>=10),
  confirmed_on TEXT NOT NULL CHECK(confirmed_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  set_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL,
  superseded_at TEXT
) STRICT;
CREATE UNIQUE INDEX experience_settings_one_live ON experience_settings(tenant_id) WHERE superseded_at IS NULL;

CREATE TRIGGER experience_settings_superseded_only BEFORE UPDATE ON experience_settings
WHEN OLD.superseded_at IS NOT NULL OR NEW.tenant_id<>OLD.tenant_id
  OR NEW.min_responses<>OLD.min_responses OR NEW.basis<>OLD.basis OR NEW.confirmed_on<>OLD.confirmed_on
BEGIN SELECT RAISE(ABORT,'a threshold is replaced by a new dated row, not edited'); END;
CREATE TRIGGER experience_settings_no_delete BEFORE DELETE ON experience_settings
BEGIN SELECT RAISE(ABORT,'threshold history is retained'); END;
