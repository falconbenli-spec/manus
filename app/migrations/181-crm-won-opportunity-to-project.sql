-- ترحيل 181 — الفرصة الرابحة إلى مشروع بلا إعادة كتابة (الحزمة 4، P4-CRM-2).
--
-- قبله: الفرصة (opportunities، الترحيل 074) والصفقة (commercial_cases، 004) قمعان لا يلتقيان. «إغلاق رابحة» كان يكفيه سطر
-- ملاحظة ولا يرتبط بأي صفقة، فالفوز رقمٌ في تقرير لا اتفاق خلفه، والصفقة تُكتب بعده من الصفر (CRM-09 يسقط).
--
-- هذا الترحيل يربط الاثنين في القاعدة، بعد أن صار للصفقة عمود opportunity_id في الترحيل 180:
--   (1) opportunities.case_id: الصفقة التي فُتحت من الفرصة. فريد جزئيًا، فلا تشير فرصتان إلى صفقة واحدة.
--   (2) الربط يُكتب مرة: إلى صفقة فُتحت من هذه الفرصة نفسها، لعميلها نفسه، في كيانها. لا يُمحى ولا يُبدَّل.
--   (3) «رابحة» لا تُكتب إلا على صفقة متعاقد عليها: الطبقة الأخيرة بعد الكود (pipeline-estimates: win)، فلا تتجاوزها كتابة مباشرة.
-- لا ملء لصفوف قائمة: لا صلة بين القمعين قبل اليوم، والفرص الرابحة القديمة تبقى كما أُغلقت (المُطلِق يحكم الانتقال الجديد وحده).
ALTER TABLE opportunities ADD COLUMN case_id TEXT REFERENCES commercial_cases(id);
CREATE UNIQUE INDEX opportunities_case ON opportunities(case_id) WHERE case_id IS NOT NULL;

CREATE TRIGGER opportunities_case_link BEFORE UPDATE OF case_id ON opportunities
WHEN (OLD.case_id IS NOT NULL AND NEW.case_id IS NOT OLD.case_id)
  OR (NEW.case_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM commercial_cases k
        WHERE k.id=NEW.case_id AND k.tenant_id=NEW.tenant_id AND k.opportunity_id=NEW.id AND k.client_id=NEW.client_id))
BEGIN SELECT RAISE(ABORT,'an opportunity links once, to the deal opened from it for the same customer'); END;

CREATE TRIGGER opportunities_won_needs_contract BEFORE UPDATE OF status ON opportunities
WHEN NEW.status='won' AND OLD.status<>'won' AND NOT EXISTS(SELECT 1 FROM commercial_cases k
  WHERE k.id=NEW.case_id AND k.tenant_id=NEW.tenant_id AND k.opportunity_id=NEW.id AND k.status IN ('contracted','project_active'))
BEGIN SELECT RAISE(ABORT,'an opportunity is won on a contracted deal opened from it'); END;
