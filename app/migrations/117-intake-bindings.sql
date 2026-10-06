-- ربط سلسلة الاستلام (109) بمحرك النماذج (107) وبمحرك التسعير (108).
-- الوكلاء الثلاثة عملوا متوازين، فبنى كلٌّ ما نقصه من غيره: الاستلام سجّل «ملف التسعير المعتمد ماليًا»
-- مرجعًا نصيًا يكتبه حامل تصريح مالي، وبنى سجلاته الأربعة (BD-04، PM-01، PM-02، PM-03) بينما
-- يعرّف الكتالوج النماذج نفسها. هذا الترحيل يصل الطرفين ولا يكرر حقلًا.
--
-- قاعدتان تحكمانه:
--   (1) الاعتماد يُقرأ من مصدره: «ملف التسعير المعتمد ماليًا» صار مفتاحًا أجنبيًا إلى ورقة تسعير
--       معتمدة بمقاعدها الأربعة، لا جملة يكتبها إنسان. القيد في قاعدة البيانات لا في الشيفرة وحدها.
--   (2) النموذج هو الهوية والسجل الإلكتروني، والسجل المكتوب هو موضع الحقول والبوابة.
--       فلا يُفتح لهذه النماذج الأربعة نموذج فارغ موازٍ يُعبَّأ مرتين: التعبئة في شاشة الاستلام،
--       والنسخة المرتبطة تحمل رقم النموذج ورمزه وسجله. منطق البوابة يبقى في project-intake.mjs.

-- 1) «ملف تسعير المشروع المعتمد ماليًا» مرجعًا مباشرًا إلى ورقة التسعير.
-- العمود يقبل NULL: الصفوف التي سُجِّلت قبل هذا الترحيل تبقى كما سُجِّلت بمرجعها النصي ولا تُعاد كتابتها،
-- ويظهر عليها أنها بلا ربط. أما ما يُسجَّل بعده فالشيفرة تشترط الورقة.
ALTER TABLE receipt_documents ADD COLUMN pricing_sheet_id TEXT REFERENCES pricing_sheets(id);
-- الورقة المرتبطة لا تكون إلا معتمدة، ولا تكون لعميل آخر. المُشغِّل يفحص الأمرين عند الربط.
CREATE TRIGGER receipt_documents_pricing_source BEFORE UPDATE ON receipt_documents
WHEN NEW.pricing_sheet_id IS NOT NULL AND NEW.pricing_sheet_id IS NOT OLD.pricing_sheet_id
  AND NOT EXISTS(
    SELECT 1 FROM pricing_sheets s
    JOIN project_receipts r ON r.id=NEW.receipt_id
    JOIN project_handovers h ON h.id=r.handover_id
    WHERE s.id=NEW.pricing_sheet_id AND s.status='approved' AND s.decided_at IS NOT NULL
      AND s.tenant_id=h.tenant_id AND s.client_id=h.client_id)
BEGIN SELECT RAISE(ABORT,'the approved pricing document points at an approved pricing sheet for the same client'); END;
CREATE INDEX receipt_documents_pricing ON receipt_documents(pricing_sheet_id) WHERE pricing_sheet_id IS NOT NULL;

-- 2) ربط سجلات الاستلام بتعريفات النماذج.
-- الجدول مرجع ثابت: أي سجل في السلسلة يقابل أي نموذج في الكتالوج، ومن يملك حقولَه.
CREATE TABLE intake_form_bindings(
  record_kind TEXT PRIMARY KEY CHECK(record_kind IN ('handover','receipt','kickoff','change_request')),
  form_key TEXT NOT NULL,
  record_table TEXT NOT NULL,
  screen TEXT NOT NULL,
  -- أين تُدخل الحقول اليوم. 'intake_record' = شاشة الاستلام هي موضع الإدخال، والنموذج سجلّها الإلكتروني.
  data_entry TEXT NOT NULL CHECK(data_entry IN ('intake_record','form_instance')),
  -- ما لم يُربط بعد حقلًا بحقل، مكتوبًا لا مطويًا.
  unbound_note TEXT NOT NULL CHECK(length(trim(unbound_note))>=10)
) STRICT;
INSERT INTO intake_form_bindings(record_kind,form_key,record_table,screen,data_entry,unbound_note) VALUES
 ('handover','FORM-BD-HANDOVER','project_handovers','project-handover','intake_record',
  'أقسام النموذج الأربعة نصية في الكتالوج (النطاق والمخرجات وجدول الدفعات نصوص حرة)، وسجل BD-04 مُهيكل: مخرجات بجولاتها وسندها، ودفعات يجب أن يساوي مجموعها قيمة العقد، وجهة تواصل رئيسية واحدة. الإدخال يبقى في شاشة الاستلام حتى لا يُفقد التحقق، والنموذج يحمل الهوية والاعتمادات.'),
 ('receipt','FORM-PM-RECEIPT','project_receipts','project-receipt','intake_record',
  'قائمة الوثائق الثماني في النموذج خانات تأشير، وفي السجل صفوف لكل وثيقة بصاحبها ومرجعها ومبلغ الدفعة المؤكد وتاريخه، وعليها تقوم البوابة. البوابة منطق لا نموذج، فتبقى في project-intake.mjs، والنموذج يقرأ حالتها.'),
 ('kickoff','FORM-PM-KICKOFF','project_kickoffs','project-kickoff','intake_record',
  'حضور الاجتماع في السجل يُختار من دليل المنصة فيأتي الاسم والدور من مصدرهما، وفي النموذج نص حر. الإدخال يبقى في السجل، والنموذج سجلّه الإلكتروني.'),
 ('change_request','FORM-PM-CHANGE','project_change_requests','change-requests','intake_record',
  'تصنيف التغيير وأثره على الجولات والميزانية محسوبان ومقيَّدان في السجل (خطؤنا لا يُسعَّر، والجولات تُحسب لا تُدَّعى)، وفي النموذج حقلا نص واختيار. الإدخال يبقى في السجل.');

-- 3) النسخة المرتبطة: سجل استلام واحد ← نسخة نموذج واحدة، ولا نسخة ثانية للسجل نفسه.
CREATE TABLE intake_form_links(
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  record_kind TEXT NOT NULL REFERENCES intake_form_bindings(record_kind),
  record_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  form_key TEXT NOT NULL,
  form_instance_id TEXT REFERENCES form_instances(id),
  linked_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL,
  UNIQUE(record_kind,record_id),
  UNIQUE(form_instance_id)
) STRICT;
CREATE INDEX intake_form_links_project ON intake_form_links(tenant_id,project_id);
CREATE TRIGGER intake_form_links_no_delete BEFORE DELETE ON intake_form_links
BEGIN SELECT RAISE(ABORT,'a form link is retained with its record'); END;
