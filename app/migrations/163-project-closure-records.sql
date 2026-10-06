-- ترحيل 163 — سجلات الإقفال الثابتة، وقبول نتيجة الهامش، وحارس «لا مستند مالي جديد على مشروع مقفل ماليًا».
--
-- ما يعالجه (معايير العقد بنصها، مقيسة على ما بناه الترحيلان 116 و124):
--
-- (1) «الإقفال الفني والمالي سجلان ثابتان منفصلان». الترحيل 116 خزّن الإقفال صفًا واحدًا متغيرًا في
--     project_closures: كل قفل عمودان فيه يُكتبان بتحديث ويُمحيان بتحديث. فإعادة الفتح كانت تمسح من الصف
--     من أقفل ومتى وبأي شهادة، ولا يبقى إلا سطر في سجل التدقيق. هنا يصير كل إقفال صفًا لا يُعدَّل ولا
--     يُحذف في project_closure_records، ومعه قائمة التحقق كما قُيِّمت لحظتها (ما فُحص، وعدده، وما بقي،
--     وقرار كل باقٍ)، فيقرأ من يأتي بعدُ ما كان صحيحًا يوم الإقفال لا ما صار صحيحًا اليوم.
--
-- (2) «لا إعادة فتح إلا بسجل جديد مخوَّل بسبب، ويبقى كل إقفال سابق». قيد إعادة الفتح نفسه قائم منذ 116
--     (project_closure_reopenings)؛ الناقص كان ربطه بالإقفال الذي أنهاه. project_closure_record_ends يربط
--     كل إعادة فتح بالسجل الذي أنهته — والسجلات التي سقطت معه لأنها بُنيت عليه — ولا يمس السجل نفسه.
--     لم يُضف عمود إلى project_closure_reopenings ولا إلى project_closures: اختبار الترحيل 124 يقارن
--     صفوفهما حرفًا بحرف، والإضافة جدولًا مستقلًا لا تغيّر شكل صف قائم.
--
-- (3) «لا إقفال مالي قبل الفني». الشيفرة في 116 كانت تسمح بالمالي أولًا («قد يسبق الفني»). المنع الآن في
--     الشيفرة وفي قاعدة البيانات: سجل مالي لا يُكتب وليس للمشروع إقفال فني ساري.
--
-- (4) «نتيجة هامش مقبولة». الهامش يُحسب من وحدة الربحية نفسها (app/profitability.mjs)، ويقبله حامل تصريح
--     «ربحية المشاريع والعملاء» بالرقم الذي رآه، ولا يكون هو من يقفل ماليًا — قاعدة الشخصين في المالية.
--
-- (5) الحارس بعد الإقفال: إقفال مالي ساري لا يعني شيئًا إن قُبل بعده استحقاق أو شراء أو مصروف جديد على
--     المشروع نفسه بصمت. المنع في قاعدة البيانات يحسم السباق بترتيب الكتابة: ما كُتب قبل الإقفال رآه
--     الإقفال، وما جاء بعده يُرفض حتى يُعاد فتح الإقفال بسجل وسبب.
--
-- الصف project_closures يبقى كما هو إسقاطًا للحالة الحالية (قيوده في 116 و124 تحرس قاعدة القفلين بيد
-- واحدة)، لكنه لا يبلغ حالة «مقفل» إلا بسجل ثابت يطابقه، ولا يعود «مفتوحًا» إلا بإعادة فتح أنهت ذلك السجل.

/* ───── 1. قبول نتيجة الهامش ───── */
-- الرقم كما رآه القابل (figures) وبصمته: الإقفال المالي يعيد حساب الهامش ويقارن البصمة، فقبولٌ على رقمٍ
-- تغيّر بعده (فاتورة أو تكلفة جديدة) لا يُحتسب. القبول الأحدث يحل محل الأقدم، والأقدم يبقى.
CREATE TABLE project_margin_acceptances (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  project_id TEXT NOT NULL,
  figures TEXT NOT NULL CHECK(json_valid(figures)),
  figures_digest TEXT NOT NULL CHECK(length(figures_digest)=64),
  margin_minor INTEGER NOT NULL,
  note TEXT NOT NULL CHECK(length(trim(note))>=20),
  accepted_by TEXT NOT NULL,
  accepted_at TEXT NOT NULL,
  FOREIGN KEY(accepted_by,tenant_id) REFERENCES users(id,tenant_id),
  FOREIGN KEY(project_id,tenant_id) REFERENCES projects(id,tenant_id)
) STRICT;
CREATE INDEX project_margin_acceptances_project ON project_margin_acceptances(project_id,accepted_at);
CREATE TRIGGER project_margin_acceptances_no_update BEFORE UPDATE ON project_margin_acceptances
BEGIN SELECT RAISE(ABORT,'a margin acceptance is recorded once; a newer one supersedes it'); END;
CREATE TRIGGER project_margin_acceptances_no_delete BEFORE DELETE ON project_margin_acceptances
BEGIN SELECT RAISE(ABORT,'margin acceptances are retained'); END;

/* ───── 2. سجلات الإقفال ───── */
-- origin='carried' لإقفال سابق لهذا الترحيل نُقل من صف project_closures: لم تكن قائمته تُحفظ، فلا
-- يُدَّعى له ما فُحص، ولا تُفرض عليه قيود لم يُكتب تحتها (خلاصة العشرين حرفًا، قبول الهامش، ترتيب الأقفال).
CREATE TABLE project_closure_records (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  project_id TEXT NOT NULL,
  closure_id TEXT NOT NULL REFERENCES project_closures(id),
  lock TEXT NOT NULL CHECK(lock IN ('technical','financial','final')),
  checklist TEXT NOT NULL CHECK(json_valid(checklist)),
  checklist_digest TEXT NOT NULL,
  note TEXT NOT NULL,
  certificate_id TEXT REFERENCES completion_certificates(id),
  margin_acceptance_id TEXT REFERENCES project_margin_acceptances(id),
  same_person_reason TEXT NOT NULL DEFAULT '',
  closed_by TEXT NOT NULL,
  closed_at TEXT NOT NULL,
  origin TEXT NOT NULL DEFAULT 'platform' CHECK(origin IN ('platform','carried')),
  FOREIGN KEY(closed_by,tenant_id) REFERENCES users(id,tenant_id),
  FOREIGN KEY(project_id,tenant_id) REFERENCES projects(id,tenant_id),
  CHECK(origin='carried' OR (length(trim(note))>=20 AND length(checklist_digest)=64)),
  -- الشهادة الموثقة دليل الإقفال الفني وحده، والهامش المقبول شرط المالي وحده.
  CHECK((lock='technical')=(certificate_id IS NOT NULL)),
  CHECK(origin='carried' OR (lock='financial')=(margin_acceptance_id IS NOT NULL)),
  CHECK(origin='platform' OR margin_acceptance_id IS NULL)
) STRICT;
CREATE INDEX project_closure_records_project ON project_closure_records(project_id,lock,closed_at);
CREATE INDEX project_closure_records_closure ON project_closure_records(closure_id);
CREATE TRIGGER project_closure_records_no_update BEFORE UPDATE ON project_closure_records
BEGIN SELECT RAISE(ABORT,'a closure record is written once; a reopening ends it without editing it'); END;
CREATE TRIGGER project_closure_records_no_delete BEFORE DELETE ON project_closure_records
BEGIN SELECT RAISE(ABORT,'closure records are retained'); END;

/* ───── 3. ما أنهته إعادة الفتح ───── */
-- السجل «ساري» ما دام لا صف له هنا. cascaded=1 لسجل سقط لأن ما بُني عليه أُعيد فتحه: المالي يسقط مع
-- الفني (لا إقفال مالي بلا فني)، والنهائي يسقط مع أيهما. record_id مفتاح أساسي: السجل يُنهى مرة واحدة.
CREATE TABLE project_closure_record_ends (
  record_id TEXT PRIMARY KEY REFERENCES project_closure_records(id),
  reopening_id TEXT NOT NULL REFERENCES project_closure_reopenings(id),
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  cascaded INTEGER NOT NULL CHECK(cascaded IN (0,1)),
  ended_at TEXT NOT NULL
) STRICT;
CREATE INDEX project_closure_record_ends_reopening ON project_closure_record_ends(reopening_id);
CREATE TRIGGER project_closure_record_ends_no_update BEFORE UPDATE ON project_closure_record_ends
BEGIN SELECT RAISE(ABORT,'an ended closure stays ended; a new closure is a new record'); END;
CREATE TRIGGER project_closure_record_ends_no_delete BEFORE DELETE ON project_closure_record_ends
BEGIN SELECT RAISE(ABORT,'reopening history is append only'); END;
-- إعادة الفتح تنهي سجلًا من إقفال مشروعها، والسجل الأصلي (غير المتسلسل) من نطاقها بالضبط.
CREATE TRIGGER project_closure_record_ends_match BEFORE INSERT ON project_closure_record_ends
WHEN NOT EXISTS(SELECT 1 FROM project_closure_records r JOIN project_closure_reopenings o ON o.closure_id=r.closure_id
    WHERE r.id=NEW.record_id AND o.id=NEW.reopening_id AND o.tenant_id=NEW.tenant_id AND r.tenant_id=NEW.tenant_id
      AND (NEW.cascaded=1 OR o.scope=r.lock))
BEGIN SELECT RAISE(ABORT,'a reopening ends a closure record of its own project and scope'); END;

/* ───── 4. ترتيب الأقفال وقاعدة الشخصين على الهامش ───── */
-- قفل واحد ساري من كل نوع؛ والمالي على فني ساري؛ والنهائي على الاثنين. المنقول من قبل 163 مستثنى:
-- إقفال مالي سبق الفني كان مسموحًا يومها، ولا يُعاد كتابة ماضٍ بقاعدة لاحقة.
CREATE TRIGGER project_closure_records_sequence BEFORE INSERT ON project_closure_records
WHEN NEW.origin='platform' AND (
  EXISTS(SELECT 1 FROM project_closure_records r WHERE r.project_id=NEW.project_id AND r.lock=NEW.lock
    AND NOT EXISTS(SELECT 1 FROM project_closure_record_ends e WHERE e.record_id=r.id))
  OR (NEW.lock IN ('financial','final') AND NOT EXISTS(SELECT 1 FROM project_closure_records r WHERE r.project_id=NEW.project_id AND r.lock='technical'
    AND NOT EXISTS(SELECT 1 FROM project_closure_record_ends e WHERE e.record_id=r.id)))
  OR (NEW.lock='final' AND NOT EXISTS(SELECT 1 FROM project_closure_records r WHERE r.project_id=NEW.project_id AND r.lock='financial'
    AND NOT EXISTS(SELECT 1 FROM project_closure_record_ends e WHERE e.record_id=r.id))))
BEGIN SELECT RAISE(ABORT,'closure order is technical, then financial, then final, one of each in force'); END;
CREATE TRIGGER project_closure_records_margin BEFORE INSERT ON project_closure_records
WHEN NEW.origin='platform' AND NEW.lock='financial' AND NOT EXISTS(SELECT 1 FROM project_margin_acceptances m
    WHERE m.id=NEW.margin_acceptance_id AND m.project_id=NEW.project_id AND m.tenant_id=NEW.tenant_id AND m.accepted_by<>NEW.closed_by)
BEGIN SELECT RAISE(ABORT,'a financial closure needs a margin result accepted by another person'); END;

/* ───── 5. الصف يتبع السجلات ───── */
-- AFTER لا BEFORE: قيود CHECK في الصف (قاعدة القفلين بيد واحدة) تُفحص أولًا وتبقى رسالتها هي ما يُرد
-- على كتابة مباشرة تخالفها، ثم يُفحص هنا أن لكل قفل أُغلق سجلًا ساريًا يطابقه، ولكل قفل فُتح إنهاءً لسجله.
CREATE TRIGGER project_closures_follow_records AFTER UPDATE ON project_closures
WHEN (NEW.technical_state='closed' AND OLD.technical_state<>'closed' AND NOT EXISTS(SELECT 1 FROM project_closure_records r
      WHERE r.closure_id=NEW.id AND r.lock='technical' AND r.closed_by=NEW.technical_closed_by AND r.closed_at=NEW.technical_closed_at
        AND NOT EXISTS(SELECT 1 FROM project_closure_record_ends e WHERE e.record_id=r.id)))
  OR (NEW.financial_state='closed' AND OLD.financial_state<>'closed' AND NOT EXISTS(SELECT 1 FROM project_closure_records r
      WHERE r.closure_id=NEW.id AND r.lock='financial' AND r.closed_by=NEW.financial_closed_by AND r.closed_at=NEW.financial_closed_at
        AND NOT EXISTS(SELECT 1 FROM project_closure_record_ends e WHERE e.record_id=r.id)))
  OR (NEW.final_state='closed' AND OLD.final_state<>'closed' AND NOT EXISTS(SELECT 1 FROM project_closure_records r
      WHERE r.closure_id=NEW.id AND r.lock='final' AND r.closed_by=NEW.final_closed_by AND r.closed_at=NEW.final_closed_at
        AND NOT EXISTS(SELECT 1 FROM project_closure_record_ends e WHERE e.record_id=r.id)))
  OR (OLD.technical_state='closed' AND NEW.technical_state<>'closed' AND NOT EXISTS(SELECT 1 FROM project_closure_records r
      JOIN project_closure_record_ends e ON e.record_id=r.id WHERE r.closure_id=NEW.id AND r.lock='technical'
        AND r.closed_by=OLD.technical_closed_by AND r.closed_at=OLD.technical_closed_at))
  OR (OLD.financial_state='closed' AND NEW.financial_state<>'closed' AND NOT EXISTS(SELECT 1 FROM project_closure_records r
      JOIN project_closure_record_ends e ON e.record_id=r.id WHERE r.closure_id=NEW.id AND r.lock='financial'
        AND r.closed_by=OLD.financial_closed_by AND r.closed_at=OLD.financial_closed_at))
  OR (OLD.final_state='closed' AND NEW.final_state<>'closed' AND NOT EXISTS(SELECT 1 FROM project_closure_records r
      JOIN project_closure_record_ends e ON e.record_id=r.id WHERE r.closure_id=NEW.id AND r.lock='final'
        AND r.closed_by=OLD.final_closed_by AND r.closed_at=OLD.final_closed_at))
BEGIN SELECT RAISE(ABORT,'the closure row follows its records: a lock closes with a record and opens with a reopening that ends it'); END;

/* ───── 6. نقل الإقفال القائم قبل هذا الترحيل ───── */
-- كل قفل مغلق اليوم في project_closures يصير سجلًا منقولًا بمعرّف ثابت يُقرأ منه أصله، فلا يبقى قفل
-- مغلق بلا سجل (وإلا تعذّرت إعادة فتحه بعد هذا الترحيل). قائمة تحققه تقول صراحةً إنها لم تُحفظ يومها.
-- سبب اجتماع القفلين في يد واحدة يُنقل إلى القفل الذي أُغلق ثانيًا، وهو الذي احتاجه.
INSERT INTO project_closure_records(id,tenant_id,project_id,closure_id,lock,checklist,checklist_digest,note,certificate_id,margin_acceptance_id,same_person_reason,closed_by,closed_at,origin)
SELECT 'carried-technical-'||id,tenant_id,project_id,id,'technical',
  json_object('lock','technical','carried',json('true'),'source','project_closures',
    'note','أُقفل قبل الترحيل 163، ولم تكن قائمة التحقق تُحفظ مع الإقفال يومها، فلا يُدَّعى هنا ما فُحص'),
  '',technical_note,certificate_id,NULL,
  CASE WHEN same_person_reason<>'' AND financial_closed_at IS NOT NULL AND technical_closed_at>=financial_closed_at THEN same_person_reason ELSE '' END,
  technical_closed_by,technical_closed_at,'carried'
FROM project_closures WHERE technical_state='closed';
INSERT INTO project_closure_records(id,tenant_id,project_id,closure_id,lock,checklist,checklist_digest,note,certificate_id,margin_acceptance_id,same_person_reason,closed_by,closed_at,origin)
SELECT 'carried-financial-'||id,tenant_id,project_id,id,'financial',
  json_object('lock','financial','carried',json('true'),'source','project_closures',
    'note','أُقفل قبل الترحيل 163، ولم تكن قائمة التحقق تُحفظ مع الإقفال يومها، فلا يُدَّعى هنا ما فُحص'),
  '',financial_note,NULL,NULL,
  CASE WHEN same_person_reason<>'' AND (technical_closed_at IS NULL OR financial_closed_at>technical_closed_at) THEN same_person_reason ELSE '' END,
  financial_closed_by,financial_closed_at,'carried'
FROM project_closures WHERE financial_state='closed';
INSERT INTO project_closure_records(id,tenant_id,project_id,closure_id,lock,checklist,checklist_digest,note,certificate_id,margin_acceptance_id,same_person_reason,closed_by,closed_at,origin)
SELECT 'carried-final-'||id,tenant_id,project_id,id,'final',
  json_object('lock','final','carried',json('true'),'source','project_closures','profitability_note',profitability_note,
    'note','أُقفل قبل الترحيل 163، ولم تكن قائمة التحقق تُحفظ مع الإقفال يومها، فلا يُدَّعى هنا ما فُحص'),
  '',lessons,NULL,NULL,'',final_closed_by,final_closed_at,'carried'
FROM project_closures WHERE final_state='closed';

/* ───── 7. لا مستند مالي جديد على مشروع مقفل ماليًا ───── */
-- الشيفرة ترفض قبل هذه القيود برسالة تسمّي الطريق (إعادة الفتح)، وهذه هي الضمانة لكل مسار كتابة آخر.
CREATE TRIGGER ar_claims_financial_closure BEFORE INSERT ON ar_claims
WHEN EXISTS(SELECT 1 FROM project_closure_records r WHERE r.project_id=NEW.project_id AND r.lock='financial'
  AND NOT EXISTS(SELECT 1 FROM project_closure_record_ends e WHERE e.record_id=r.id))
BEGIN SELECT RAISE(ABORT,'the project is financially closed; reopen its financial closure before adding a receivable'); END;
CREATE TRIGGER procurement_purchases_financial_closure BEFORE INSERT ON procurement_purchases
WHEN EXISTS(SELECT 1 FROM project_closure_records r WHERE r.project_id=NEW.project_id AND r.lock='financial'
  AND NOT EXISTS(SELECT 1 FROM project_closure_record_ends e WHERE e.record_id=r.id))
BEGIN SELECT RAISE(ABORT,'the project is financially closed; reopen its financial closure before adding a purchase'); END;
CREATE TRIGGER expense_claims_financial_closure BEFORE INSERT ON expense_claims
WHEN NEW.project_id IS NOT NULL AND EXISTS(SELECT 1 FROM project_closure_records r WHERE r.project_id=NEW.project_id AND r.lock='financial'
  AND NOT EXISTS(SELECT 1 FROM project_closure_record_ends e WHERE e.record_id=r.id))
BEGIN SELECT RAISE(ABORT,'the project is financially closed; reopen its financial closure before adding an expense'); END;
