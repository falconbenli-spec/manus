-- الاستوديو على حملة (الحزمة 4، P4-SPEC-1). كانت مساحة الاستوديو تحمل مشروعًا ولا عميل ولا حملة، فيُكتب هدف الحملة وقنواتها
-- ومؤشرها في الموجز من جديد، ولا شيء يربط المخرج بالحملة التي يخدمها. المساحة المفتوحة لحملة تحمل الآن الحملة وعميلها
-- من سجل الحملة نفسه، والموجز يقرأ منها الهدف والقنوات والمستهدفات (app/studio.mjs). والمساحة الحرة القديمة تبقى كما هي.
--
-- عمودان يُضافان لا جدول يُعاد بناؤه: لمساحات الاستوديو أبناء كثيرون (الموجز والمخرجات والأصول والحزم ومسارات المراجعة
-- والموافقات الخارجية)، وADD COLUMN بمرجع قيمته الافتراضية NULL لا يمسّ صفًّا ولا ابنًا ولا محفّز الهوية القائم (009).
-- ولأن ADD COLUMN لا يحمل مفتاحًا مركّبًا مع الكيان، فالكيان واتساق العميل مع الحملة يُفرضان بمحفّز عند الإدراج.
ALTER TABLE studio_workspaces ADD COLUMN client_id TEXT REFERENCES clients(id);
ALTER TABLE studio_workspaces ADD COLUMN campaign_id TEXT REFERENCES campaigns(id);

-- العميل والحملة معًا أو لا أحدهما، والعميل عميل الحملة نفسها، وفي كيان المساحة.
CREATE TRIGGER studio_workspace_campaign_link BEFORE INSERT ON studio_workspaces
WHEN (NEW.client_id IS NULL)<>(NEW.campaign_id IS NULL)
  OR (NEW.campaign_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM campaigns c WHERE c.id=NEW.campaign_id AND c.tenant_id=NEW.tenant_id AND c.client_id=NEW.client_id))
BEGIN SELECT RAISE(ABORT,'a studio job opened for a campaign carries that campaign and its own client, in its own tenant'); END;
-- والربط يُكتب مرة عند الفتح: لا يُضاف لمساحة حرة لاحقًا ولا ينتقل لحملة أخرى، فلا يتغير ما بُني عليه موجزها ومخرجاتها.
CREATE TRIGGER studio_workspace_campaign_fixed BEFORE UPDATE OF client_id,campaign_id ON studio_workspaces
WHEN NEW.client_id IS NOT OLD.client_id OR NEW.campaign_id IS NOT OLD.campaign_id
BEGIN SELECT RAISE(ABORT,'the client and campaign of a studio job are fixed when it is opened'); END;
CREATE INDEX studio_campaign_scope ON studio_workspaces(campaign_id) WHERE campaign_id IS NOT NULL;
