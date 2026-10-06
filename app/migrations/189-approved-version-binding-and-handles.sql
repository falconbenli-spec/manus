-- النشر على النسخة المعتمدة (الحزمة 4، P4-SPEC-3)، وتفرّد حساب المؤثر في الكيان (INF-01)، وإثبات النشر نوعُ سجل في الملفات.
--
-- (1) كان بند المحتوى المنشور وبند محتوى المؤثر يحملان مرجعًا نصيًا يكتبه الموظف (draft_reference)، فلا شيء يثبت أن المنشور هو
-- النسخة التي اعتُمدت. البند يحمل الآن نسخة المخرج وبصمتها مقروءتين من الاستوديو (app/approved-version.mjs)، وبند المحتوى يحمل سجل
-- موافقة العميل الموثّقة على النسخة نفسها حين تُقرأ منه. أعمدة تُضاف لا جداول يُعاد بناؤها: للبندين أبناء ومحفّزات قائمة، والعمود
-- بقيمة NULL لا يمسّ صفًّا. والبنود القديمة تبقى بمرجعها النصي كما كُتب.
ALTER TABLE content_items ADD COLUMN output_version_id TEXT REFERENCES studio_output_versions(id);
ALTER TABLE content_items ADD COLUMN output_digest TEXT;
ALTER TABLE content_items ADD COLUMN client_approval_id TEXT REFERENCES external_approvals(id);
ALTER TABLE influencer_content ADD COLUMN output_version_id TEXT REFERENCES studio_output_versions(id);
ALTER TABLE influencer_content ADD COLUMN output_digest TEXT;

-- النسخة وبصمتها معًا، والبصمة بصمة تلك النسخة بعينها، ومن كيان البند.
CREATE TRIGGER content_items_version_digest_insert BEFORE INSERT ON content_items
WHEN (NEW.output_version_id IS NULL)<>(NEW.output_digest IS NULL) OR (NEW.output_version_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM studio_output_versions ver
  JOIN studio_outputs o ON o.id=ver.output_id JOIN studio_workspaces w ON w.id=o.studio_id WHERE ver.id=NEW.output_version_id AND ver.digest=NEW.output_digest AND w.tenant_id=NEW.tenant_id))
BEGIN SELECT RAISE(ABORT,'a content item carries an output version of its own tenant together with the digest of that very version'); END;
CREATE TRIGGER content_items_version_digest_update BEFORE UPDATE OF output_version_id,output_digest ON content_items
WHEN (NEW.output_version_id IS NULL)<>(NEW.output_digest IS NULL) OR (NEW.output_version_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM studio_output_versions ver
  JOIN studio_outputs o ON o.id=ver.output_id JOIN studio_workspaces w ON w.id=o.studio_id WHERE ver.id=NEW.output_version_id AND ver.digest=NEW.output_digest AND w.tenant_id=NEW.tenant_id))
BEGIN SELECT RAISE(ABORT,'a content item carries an output version of its own tenant together with the digest of that very version'); END;
-- موافقة العميل المقروءة من السجل موثّقة، على النسخة نفسها التي يحملها البند، وبقرار موافقة.
CREATE TRIGGER content_items_client_approval_insert BEFORE INSERT ON content_items
WHEN NEW.client_approval_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM external_approvals a WHERE a.id=NEW.client_approval_id AND a.tenant_id=NEW.tenant_id
  AND a.output_version_id=NEW.output_version_id AND a.status IN ('documented','verified') AND a.decision IN ('approved','approved_with_conditions'))
BEGIN SELECT RAISE(ABORT,'a client approval read from the register is documented, approving, and on the very version the item carries'); END;
CREATE TRIGGER content_items_client_approval_update BEFORE UPDATE OF client_approval_id,output_version_id ON content_items
WHEN NEW.client_approval_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM external_approvals a WHERE a.id=NEW.client_approval_id AND a.tenant_id=NEW.tenant_id
  AND a.output_version_id=NEW.output_version_id AND a.status IN ('documented','verified') AND a.decision IN ('approved','approved_with_conditions'))
BEGIN SELECT RAISE(ABORT,'a client approval read from the register is documented, approving, and on the very version the item carries'); END;
CREATE TRIGGER influencer_content_version_digest_insert BEFORE INSERT ON influencer_content
WHEN (NEW.output_version_id IS NULL)<>(NEW.output_digest IS NULL) OR (NEW.output_version_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM studio_output_versions ver
  JOIN studio_outputs o ON o.id=ver.output_id JOIN studio_workspaces w ON w.id=o.studio_id JOIN influencer_engagements e ON e.id=NEW.engagement_id
  WHERE ver.id=NEW.output_version_id AND ver.digest=NEW.output_digest AND w.tenant_id=e.tenant_id))
BEGIN SELECT RAISE(ABORT,'influencer content carries an output version of its own tenant together with the digest of that very version'); END;
CREATE TRIGGER influencer_content_version_digest_update BEFORE UPDATE OF output_version_id,output_digest ON influencer_content
WHEN (NEW.output_version_id IS NULL)<>(NEW.output_digest IS NULL) OR (NEW.output_version_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM studio_output_versions ver
  JOIN studio_outputs o ON o.id=ver.output_id JOIN studio_workspaces w ON w.id=o.studio_id JOIN influencer_engagements e ON e.id=NEW.engagement_id
  WHERE ver.id=NEW.output_version_id AND ver.digest=NEW.output_digest AND w.tenant_id=e.tenant_id))
BEGIN SELECT RAISE(ABORT,'influencer content carries an output version of its own tenant together with the digest of that very version'); END;
CREATE INDEX content_items_version ON content_items(output_version_id) WHERE output_version_id IS NOT NULL;
CREATE INDEX influencer_content_version ON influencer_content(output_version_id) WHERE output_version_id IS NOT NULL;

-- (2) INF-01: الحساب نفسه (المنصة والمعرّف، بلا اعتبار لحالة الأحرف ولا لـ@ في أوله) على ملف مؤثر واحد في الكيان، بين الحسابات
-- النشطة. كان التفرّد داخل الملف وحده (UNIQUE(influencer_id,platform,handle) في 060). لا يُحذف شيء: الزوج المسجّل قبل هذا
-- الترحيل يبقى كما هو، وتسرده لوحة المؤثرين لقرار (app/influencers.mjs)، وهذا المحفّز يرفض الجديد وحده.
CREATE TRIGGER influencer_accounts_one_file_per_handle BEFORE INSERT ON influencer_accounts
WHEN NEW.active=1 AND EXISTS(SELECT 1 FROM influencer_accounts a JOIN influencers x ON x.id=a.influencer_id JOIN influencers n ON n.id=NEW.influencer_id
  WHERE x.tenant_id=n.tenant_id AND a.platform=NEW.platform AND a.active=1 AND lower(ltrim(trim(a.handle),'@'))=lower(ltrim(trim(NEW.handle),'@')))
BEGIN SELECT RAISE(ABORT,'a platform handle sits on one influencer file in its tenant; an existing pair waits for a decision, nothing new joins it'); END;
CREATE TRIGGER influencer_accounts_one_file_on_return BEFORE UPDATE OF active ON influencer_accounts
WHEN NEW.active=1 AND OLD.active=0 AND EXISTS(SELECT 1 FROM influencer_accounts a JOIN influencers x ON x.id=a.influencer_id JOIN influencers n ON n.id=NEW.influencer_id
  WHERE a.id<>NEW.id AND x.tenant_id=n.tenant_id AND a.platform=NEW.platform AND a.active=1 AND lower(ltrim(trim(a.handle),'@'))=lower(ltrim(trim(NEW.handle),'@')))
BEGIN SELECT RAISE(ABORT,'a platform handle sits on one influencer file in its tenant; an existing pair waits for a decision, nothing new joins it'); END;

-- (3) لقطة إثبات النشر ملفٌّ يُرفع على الإثبات نفسه (app/files.mjs، صلاحيته proofFileAccess). كان عدّ مرفقاته يقرأ نوعًا غير مسجّل،
-- فكان صفرًا دائمًا مهما رُفع. سطرٌ في سجل الأنواع كسابقة الترحيل 104، ولا جدول يُعاد بناؤه.
INSERT INTO stored_file_entity_types(entity_type,added_in) VALUES('influencer_proof',189);
