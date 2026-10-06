-- 111: مساعد السياسات «اسأل عن السياسة» ودليل الموظف الشخصي.
-- المساعد لا يكتب في أي سجل تشغيلي: ما هنا سجل أسئلة وتقييم إجابات ومعجم بحث وجدول «أيهما النافذ» عند التعارض.
-- نص السؤال يُحجب بأنماط app/pii.mjs قبل الحفظ (هوية، IBAN، جوال، بريد)، ويبقى كما كتبه صاحبه فيما عدا ذلك،
-- لأن الموارد البشرية تحتاج صيغته لتعرف أي نص ينقص الدليل. لا تُحفظ الإجابة ولا بيانات السائل الشخصية هنا:
-- الناتج محفوظ مرة واحدة في ai_runs لصاحبه، وهذا السجل يشير إليه بمعرّفه.

CREATE TABLE policy_questions (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  ai_run_id TEXT,
  kind TEXT NOT NULL CHECK(kind IN ('policy','personal','calculation','how_to','eligibility','skills','other_person')),
  language TEXT NOT NULL CHECK(language IN ('ar','en')),
  question TEXT NOT NULL CHECK(length(trim(question))>=3),
  retrieval_path TEXT NOT NULL CHECK(length(trim(retrieval_path))>=3),
  answered INTEGER NOT NULL CHECK(answered IN (0,1)),
  citations INTEGER NOT NULL DEFAULT 0 CHECK(citations>=0),
  helpful INTEGER CHECK(helpful IN (0,1)),
  feedback_note TEXT NOT NULL DEFAULT '',
  feedback_at TEXT,
  status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','handled')),
  handled_by TEXT REFERENCES users(id),
  handled_at TEXT,
  handled_note TEXT NOT NULL DEFAULT '',
  asked_at TEXT NOT NULL,
  CHECK(status='open' OR (handled_by IS NOT NULL AND handled_at IS NOT NULL AND length(trim(handled_note))>=5)),
  CHECK((helpful IS NULL)=(feedback_at IS NULL))
) STRICT;
CREATE INDEX policy_questions_gap ON policy_questions(tenant_id,answered,status,asked_at);
CREATE INDEX policy_questions_mine ON policy_questions(user_id,asked_at);
-- السؤال وصاحبه ووقته ونتيجته لا تُعدَّل: السجل دليل على ما سُئل وما أجاب المساعد، لا مسودة تُنقّح.
CREATE TRIGGER policy_questions_fixed BEFORE UPDATE ON policy_questions
WHEN NEW.id<>OLD.id OR NEW.tenant_id<>OLD.tenant_id OR NEW.user_id<>OLD.user_id OR NEW.question<>OLD.question
  OR NEW.kind<>OLD.kind OR NEW.answered<>OLD.answered OR NEW.citations<>OLD.citations OR NEW.asked_at<>OLD.asked_at
  OR NEW.retrieval_path<>OLD.retrieval_path OR (OLD.helpful IS NOT NULL AND NEW.helpful IS NOT OLD.helpful)
BEGIN SELECT RAISE(ABORT,'a logged question and its answer verdict are never rewritten'); END;
CREATE TRIGGER policy_questions_no_delete BEFORE DELETE ON policy_questions
BEGIN SELECT RAISE(ABORT,'questions are retained so HR can see what the text does not answer'); END;

-- معجم البحث: صور الكلمة الواحدة كما يكتبها الموظفون. أداة بحث لا نص سياسة: لا تضيف حكمًا ولا تغيّر معنى فقرة.
-- الكلمات مخزّنة بصورتها المطبّعة (app/arabic-text.mjs normalize) حتى تطابق الفهرس والاستعلام معًا.
CREATE TABLE policy_search_terms (
  term TEXT NOT NULL CHECK(length(trim(term))>=2),
  variant TEXT NOT NULL CHECK(length(trim(variant))>=2),
  note TEXT NOT NULL DEFAULT '',
  PRIMARY KEY(term,variant)
) STRICT;
INSERT INTO policy_search_terms(term,variant,note) VALUES
('اجازه','عطله','صور شائعة'),('اجازه','اجازات',''),('اجازه','الاجازه',''),
('زواج','الزواج',''),('زواج','عرس','صيغة دارجة'),
('انتداب','ايفاد',''),('انتداب','مهمه عمل',''),('انتداب','سفر',''),
('بدل','مقابل',''),('بدل','علاوه',''),
('راتب','اجر',''),('راتب','مرتب',''),('راتب','الراتب',''),
('عقوبه','جزاء',''),('عقوبه','مخالفه',''),('جزاء','عقوبه',''),
('تاخر','تاخير',''),('تاخر','التاخر',''),
('استقاله','ترك العمل',''),('استقاله','انهاء العقد',''),
('تامين','التامين الطبي',''),('تامين','وثيقه',''),
('والدين','الوالد',''),('والدين','الوالده',''),('والدين','الاب',''),('والدين','الام',''),
('تدريب','تاهيل',''),('تدريب','دوره',''),
('رصيد','المتبقي',''),('رصيد','باقي',''),
('مكافاه','حافز',''),
('انترنت','الانترنت',''),
('نادي','النادي الرياضي',''),
('تذكره','تذاكر',''),
('مولود','الوضع',''),('مولود','ولاده',''),
('مقبول','قبول','صيغة السؤال غير صيغة النص'),('مقبوله','قبول',''),
('مؤهل','اهليه',''),('استحق','استحقاق',''),('اطلب','طلب',''),('اقدم','تقديم',''),
('عقوبه','جزاءات',''),('غرامه','جزاء','');

-- «أيهما النافذ» عند تعارض مادتين: المادة اللاحقة تنسخ السابقة، والتعميم ينسخ ما خالفه.
-- الصفوف هنا ما ذكره المالك صراحة، لا استنباط من نص: أي زوج آخر يُضاف بقرار مكتوب.
CREATE TABLE policy_article_supersedes (
  later TEXT NOT NULL CHECK(length(trim(later))>=2),
  earlier TEXT NOT NULL CHECK(length(trim(earlier))>=2),
  note TEXT NOT NULL CHECK(length(trim(note))>=10),
  source TEXT NOT NULL CHECK(length(trim(source))>=5),
  PRIMARY KEY(later,earlier)
) STRICT;
INSERT INTO policy_article_supersedes(later,earlier,note,source) VALUES
('م105','م101','المادة 105 تعديل لاحق يسري مكان المادة 101 عند التعارض.','قرار المالك المدوّن في نطاق مساعد السياسات'),
('م126','م125','المادة 126 تعديل لاحق يسري مكان المادة 125 عند التعارض.','قرار المالك المدوّن في نطاق مساعد السياسات'),
('تعميم','م41','التعميم الصادر بعد اللائحة يسري على ما خالفه في المادة 41.','قرار المالك المدوّن في نطاق مساعد السياسات'),
('تعميم','م65','التعميم الصادر بعد اللائحة يسري على ما خالفه في المادة 65.','قرار المالك المدوّن في نطاق مساعد السياسات');
CREATE TRIGGER policy_article_supersedes_fixed BEFORE UPDATE ON policy_article_supersedes
BEGIN SELECT RAISE(ABORT,'a supersession is replaced by a new row, never edited'); END;
