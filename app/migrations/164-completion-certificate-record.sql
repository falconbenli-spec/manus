-- ترحيل 164 — شهادة الإنجاز سجلٌّ لا يُعدَّل بعد صدوره: ممثل العميل بسند تفويضه، وقبول العميل بقناته وحدّها،
-- والتصحيح بنسخة جديدة أو بعكس مسبَّب.
--
-- ما كان قائمًا (الترحيل 116): الشهادة مستند مرقّم (CERT-00001) بحالة ومشروع ومخرجات مقبولة ومُصدِر ودليل، والإقفال الفني
-- يشترطها. وقِيس على الشيفرة قبل هذا الترحيل — بمسبار على قاعدة في الذاكرة، لا بالقراءة — أربع فجوات:
--   ١. ممثل العميل نصٌّ حرّ يقبل «أي اسم يُكتب»، ولا عمود لسند تفويضه أصلًا. وسجل مفوّضي العميل (الترحيل 023) قائم بسنده
--      ونطاقه ومدته وسحبه، فلا سبب لخانة ثانية تفترق عنه.
--   ٢. «توثيق الاستلام» كان UPDATE على الصف الصادر نفسه: الحالة والنسخة تتغيران، والدليل نصٌّ بلا قناة ولا حدّ مكتوب.
--   ٣. لا محفّز واحد على الجدول: UPDATE على شهادة صادرة يمر، وDELETE لشهادة موثّقة يمر.
--   ٤. لا مسار تصحيح ولا عكس: الحالة void معرّفة في القيد ولا يكتبها سطر واحد.
--
-- القرار: لا يُعاد بناء الجدول (يشير إليه project_closures.certificate_id، وإعادة البناء داخل معاملة الترحيل لا تُطفئ المفاتيح).
-- تُضاف أعمدة، وسجلان مستقلان يُضافان ولا يُعدَّلان، ومحفّزات تجعل الصف الصادر ثابتًا. فالحالة بعد الصدور لا تُكتب على الصف
-- بل تُشتق من سجلاته: قُبلت (سجل قبول)، استُبدلت (نسخة تشير إليها)، عُكست (سجل عكس). وهذا نمط الفاتورة نفسه: الصادرة
-- لا تُمسّ، والإشعار الدائن مستند مستقل يشير إليها.
--
-- والصفوف القائمة قبل هذا الترحيل تبقى كما كُتبت: «acknowledged» منها مقبولة بقاعدة يومها، و«issued» منها بلا ممثل من السجل
-- لا يُسجَّل عليها قبول حتى تُصحَّح بنسخة تسمّيه (app/completion-certificates.mjs). لا تُردم بأثر رجعي بسندٍ لم يُكتب يومها.

/* ───── ١. ممثل العميل وسند تفويضه، ورقم النسخة وما تصحّحه ───── */
-- approver_id من سجل مفوّضي المشروع نفسه، ولقطته (الاسم والصفة والسند والنطاق) تُحفظ على الشهادة: السجل قد يُسحب بعد اليوم،
-- والشهادة تقول ما كان وقت صدورها. revision رقم النسخة: 1 للأصل، وكل تصحيح يزيده واحدًا ويشير بـsupersedes_id إلى ما صحّحه.
-- و«version» القائم يبقى عدّاد التزامن كما في كل جدول في المنصة؛ الصف لا يُعدَّل بعد اليوم فيبقى 1.
ALTER TABLE completion_certificates ADD COLUMN revision INTEGER NOT NULL DEFAULT 1 CHECK(revision>=1);
ALTER TABLE completion_certificates ADD COLUMN supersedes_id TEXT REFERENCES completion_certificates(id);
ALTER TABLE completion_certificates ADD COLUMN correction_reason TEXT NOT NULL DEFAULT '';
ALTER TABLE completion_certificates ADD COLUMN approver_id TEXT REFERENCES client_approvers(id);
ALTER TABLE completion_certificates ADD COLUMN approver_snapshot TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(approver_snapshot));
-- لكل نسخة خلفٌ واحد على الأكثر: السلسلة خطٌّ لا شجرة، فلا تتنازع نسختان على أنهما تصحيح الأصل نفسه.
CREATE UNIQUE INDEX completion_certificates_successor ON completion_certificates(supersedes_id) WHERE supersedes_id IS NOT NULL;

/* ───── ٢. قبول العميل: سجلٌّ مستقل يُضاف مرة ولا يُعدَّل ───── */
-- لا دخول للعميل ولا آلية توقيع معتمدة في المنصة، فالقبول دائمًا دليلٌ خارجي أدخله موظف. قناته من قائمة مغلقة هي قائمة سجل
-- الموافقات الخارجية نفسها (023)، وليس فيها «توقيع إلكتروني»: قناةٌ كهذه تعني آلية توقيع معتمدة تُبنى معها، لا كلمة تُضاف هنا.
-- والحدّ (limitation) يُكتب على السجل وقت تسجيله، فيقرأ كل من يفتحه ما لا يثبته هذا الدليل، ولا يتغير إن تغيّرت الصياغة لاحقًا.
CREATE TABLE completion_certificate_acceptances (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  certificate_id TEXT NOT NULL UNIQUE REFERENCES completion_certificates(id),
  channel TEXT NOT NULL CHECK(channel IN ('email','signed_document','meeting_minutes','message','call')),
  received_on TEXT NOT NULL CHECK(received_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  evidence_reference TEXT NOT NULL CHECK(length(trim(evidence_reference))>=10),
  limitation TEXT NOT NULL CHECK(length(trim(limitation))>=20),
  recorded_by TEXT NOT NULL,
  recorded_at TEXT NOT NULL,
  FOREIGN KEY(recorded_by,tenant_id) REFERENCES users(id,tenant_id)
) STRICT;

/* ───── ٣. العكس: سجلٌّ مستقل بسببه ───── */
-- العكس لا يمحو الشهادة ولا يغيّر صفّها: يقول إنها لم تعد سارية ولماذا ومن قرر، وتبقى هي كما صدرت للأرشيف.
CREATE TABLE completion_certificate_reversals (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  certificate_id TEXT NOT NULL UNIQUE REFERENCES completion_certificates(id),
  reason TEXT NOT NULL CHECK(length(trim(reason))>=20),
  reversed_by TEXT NOT NULL,
  reversed_at TEXT NOT NULL,
  FOREIGN KEY(reversed_by,tenant_id) REFERENCES users(id,tenant_id)
) STRICT;

/* ───── ٤. الصادر ثابت ───── */
-- لا استثناء لعمود: «توثيق الاستلام» القديم كان UPDATE، وصار سجل قبول مستقلًا، فلا يبقى سبب واحد لتعديل صف صادر.
CREATE TRIGGER completion_certificates_fixed BEFORE UPDATE ON completion_certificates
BEGIN SELECT RAISE(ABORT,'an issued completion certificate is never edited; correct it with a new version or reverse it'); END;
CREATE TRIGGER completion_certificates_retained BEFORE DELETE ON completion_certificates
BEGIN SELECT RAISE(ABORT,'completion certificates are retained'); END;

/* ───── ٥. شروط الإصدار في القاعدة، لا في الكود وحده ───── */
-- الصف يولد «issued» بلا قبول ولا إلغاء: القبول والعكس سجلان مستقلان، والأعمدة القديمة لهما تبقى للصفوف القائمة وحدها.
CREATE TRIGGER completion_certificates_born_issued BEFORE INSERT ON completion_certificates
WHEN NEW.status<>'issued' OR NEW.version<>1 OR NEW.acknowledged_by IS NOT NULL OR NEW.acknowledged_at IS NOT NULL
  OR NEW.acknowledgement_evidence<>'' OR NEW.void_reason<>''
BEGIN SELECT RAISE(ABORT,'a completion certificate is inserted as issued; acceptance and reversal are separate records'); END;

-- الرقم التالي بلا فجوة، وشكله مشتق من التسلسل: لا رقم يُختلق ولا يُعاد استعماله. الأمان تحت التزامن من قفل الكاتب
-- (BEGIN IMMEDIATE في app/db.mjs transaction)، وهذا خط الدفاع الثاني لمسارٍ يُكتب غدًا وينسى المعاملة (انظر الترحيل 148).
CREATE TRIGGER completion_certificates_numbered BEFORE INSERT ON completion_certificates
WHEN NEW.sequence<>COALESCE((SELECT MAX(sequence) FROM completion_certificates WHERE tenant_id=NEW.tenant_id),0)+1
  OR NEW.number<>'CERT-'||printf('%05d',NEW.sequence)
BEGIN SELECT RAISE(ABORT,'completion certificate numbers are sequential per tenant without gaps'); END;

-- ممثل العميل من سجل مفوّضي المشروع نفسه، ولقطته تحمل سند تفويضه بطوله الأدنى في ذلك السجل (عشرة أحرف، الترحيل 023).
CREATE TRIGGER completion_certificates_representative BEFORE INSERT ON completion_certificates
WHEN NEW.approver_id IS NULL
  OR NOT EXISTS(SELECT 1 FROM client_approvers a WHERE a.id=NEW.approver_id AND a.tenant_id=NEW.tenant_id AND a.project_id=NEW.project_id)
  OR length(trim(COALESCE(json_extract(NEW.approver_snapshot,'$.authority_basis'),'')))<10
BEGIN SELECT RAISE(ABORT,'a completion certificate names a client representative registered for its project, with the basis of their authority'); END;

-- النسخة: الأصل 1، والتصحيح يزيد واحدًا على نسخة حيّة من المشروع والملف نفسيهما، بسبب مكتوب، ولا يمس نسخةً يقوم عليها
-- إقفال فني: الإقفال يُعاد فتحه أولًا (تصريح حساس في app/project-axes.mjs)، فلا تتغير تحت إقفالٍ قائم الشهادةُ التي بُني عليها.
CREATE TRIGGER completion_certificates_version_chain BEFORE INSERT ON completion_certificates
WHEN (NEW.supersedes_id IS NULL AND (NEW.revision<>1 OR NEW.correction_reason<>''))
  OR (NEW.supersedes_id IS NOT NULL AND (length(trim(NEW.correction_reason))<20
    OR NOT EXISTS(SELECT 1 FROM completion_certificates o WHERE o.id=NEW.supersedes_id AND o.tenant_id=NEW.tenant_id
      AND o.project_id=NEW.project_id AND o.case_id=NEW.case_id AND o.status<>'void' AND NEW.revision=o.revision+1)
    OR EXISTS(SELECT 1 FROM completion_certificate_reversals r WHERE r.certificate_id=NEW.supersedes_id)
    OR EXISTS(SELECT 1 FROM project_closures pc WHERE pc.certificate_id=NEW.supersedes_id AND pc.technical_state='closed')))
BEGIN SELECT RAISE(ABORT,'a correction is the next version of a live certificate of the same project, with a written reason, and never under a technical closure'); END;

-- شهادة حيّة واحدة لكل مشروع: أصلٌ جديد لا يُصدَر وفوقه شهادة لم تُستبدل ولم تُعكس. الكود يرفض قبل هذا برسالة تسمّي الطريق
-- (صحّحها أو اعكسها)، وهذا الحارس لما لا يمر على الكود: سكربت، أو إصلاح يدوي، أو طلبان متزامنان.
CREATE TRIGGER completion_certificates_one_live BEFORE INSERT ON completion_certificates
WHEN NEW.supersedes_id IS NULL AND EXISTS(SELECT 1 FROM completion_certificates c WHERE c.project_id=NEW.project_id AND c.status<>'void'
  AND NOT EXISTS(SELECT 1 FROM completion_certificates s WHERE s.supersedes_id=c.id)
  AND NOT EXISTS(SELECT 1 FROM completion_certificate_reversals r WHERE r.certificate_id=c.id))
BEGIN SELECT RAISE(ABORT,'a project has one live completion certificate; correct it with a new version or reverse it first'); END;

/* ───── ٦. قبول العميل: مرة واحدة على النسخة الحيّة، بيد مستقلة، وبتفويض ساري يوم وروده ───── */
CREATE TRIGGER completion_certificate_acceptances_live BEFORE INSERT ON completion_certificate_acceptances
WHEN NOT EXISTS(SELECT 1 FROM completion_certificates c WHERE c.id=NEW.certificate_id AND c.tenant_id=NEW.tenant_id AND c.status='issued' AND c.approver_id IS NOT NULL)
  OR EXISTS(SELECT 1 FROM completion_certificates s WHERE s.supersedes_id=NEW.certificate_id)
  OR EXISTS(SELECT 1 FROM completion_certificate_reversals r WHERE r.certificate_id=NEW.certificate_id)
BEGIN SELECT RAISE(ABORT,'client acceptance is recorded once, on the live version that names a registered representative'); END;

-- فصل المهام: من أصدر الشهادة لا يسجّل قبول العميل لها، ولا من قبل مخرجاتها داخليًا — فالقبول الذي تشهد به الشهادة
-- لا يقوم على كلمة الشخص نفسه مرتين (نمط الترحيل 152: من سجّل الاستلام لا يعتمد المطابقة المبنية عليه).
CREATE TRIGGER completion_certificate_acceptances_independent BEFORE INSERT ON completion_certificate_acceptances
WHEN EXISTS(SELECT 1 FROM completion_certificates c WHERE c.id=NEW.certificate_id AND c.issued_by=NEW.recorded_by)
  OR EXISTS(SELECT 1 FROM completion_certificates c, json_each(c.delivery_ids) j
    JOIN commercial_reviews r ON r.kind='delivery' AND r.subject_id=j.value
    WHERE c.id=NEW.certificate_id AND r.approver_id=NEW.recorded_by)
BEGIN SELECT RAISE(ABORT,'the client acceptance is recorded by someone other than the issuer and the internal acceptor of its deliverables'); END;

-- سند التفويض ساري يوم ورود القبول: من سُحب تفويضه قبله لا يُنسب إليه قبول، وقراراته السابقة تبقى (قاعدة 023 نفسها).
CREATE TRIGGER completion_certificate_acceptances_authority BEFORE INSERT ON completion_certificate_acceptances
WHEN NOT EXISTS(SELECT 1 FROM completion_certificates c JOIN client_approvers a ON a.id=c.approver_id
  WHERE c.id=NEW.certificate_id AND a.valid_from<=NEW.received_on AND (a.revoked_on IS NULL OR a.revoked_on>NEW.received_on))
BEGIN SELECT RAISE(ABORT,'the representative named on the certificate was not authorised on the day the acceptance was received'); END;

CREATE TRIGGER completion_certificate_acceptances_fixed BEFORE UPDATE ON completion_certificate_acceptances
BEGIN SELECT RAISE(ABORT,'a recorded client acceptance is never edited; correct the certificate with a new version or reverse it'); END;
CREATE TRIGGER completion_certificate_acceptances_retained BEFORE DELETE ON completion_certificate_acceptances
BEGIN SELECT RAISE(ABORT,'client acceptances are retained'); END;

/* ───── ٧. العكس: على النسخة الحيّة وحدها، ولا يُعكس ما يقوم عليه إقفال فني ───── */
CREATE TRIGGER completion_certificate_reversals_live BEFORE INSERT ON completion_certificate_reversals
WHEN NOT EXISTS(SELECT 1 FROM completion_certificates c WHERE c.id=NEW.certificate_id AND c.tenant_id=NEW.tenant_id AND c.status<>'void')
  OR EXISTS(SELECT 1 FROM completion_certificates s WHERE s.supersedes_id=NEW.certificate_id)
  OR EXISTS(SELECT 1 FROM project_closures pc WHERE pc.certificate_id=NEW.certificate_id AND pc.technical_state='closed')
BEGIN SELECT RAISE(ABORT,'only the live version is reversed, and never while a technical closure rests on it'); END;
CREATE TRIGGER completion_certificate_reversals_fixed BEFORE UPDATE ON completion_certificate_reversals
BEGIN SELECT RAISE(ABORT,'a reversal is recorded once'); END;
CREATE TRIGGER completion_certificate_reversals_retained BEFORE DELETE ON completion_certificate_reversals
BEGIN SELECT RAISE(ABORT,'reversals are retained'); END;
