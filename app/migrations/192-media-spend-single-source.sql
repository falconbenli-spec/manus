-- مصدر واحد للصرف الإعلامي (الحزمة 4، DOMAIN-2). كان للصرف سجلّان: قيود «صرف» داخل الحملة (campaign_entries، 040) يقرؤها R22
-- وبلاطة الحملة، وسجل الصرف الإعلامي (media_spend_entries، 073) بمصدر كل رقم ودليله يقرؤه تقرير العميل ولوحة الصرف. فيخرج للعميل
-- رقمٌ ويقرأ المدير رقمًا ثانيًا للحملة نفسها والفترة نفسها.
--
-- متى اعتُمدت للحملة خطة صرف صار سجل الصرف الإعلامي هو الصرف: لا يُكتب بعدها في campaign_entries صفُّ «صرف» — لا قيد جديد ولا
-- تصحيح لقيد قديم (التصحيح صفُّ «صرف» أيضًا). الحملات التي بلا خطة معتمدة لا يمسّها شيء. الوحدة ترفض أولًا برفض يسمّي السبب ويدل
-- على شاشة الصرف الإعلامي (app/campaigns.mjs)؛ هذا حارس الكتابة المباشرة.
--
-- قادح لا جدول يُعاد بناؤه، ولا يُمسّ صفٌّ قائم: قيود «صرف» كُتبت قبل الخطة (أو قبل هذا الترحيل) تبقى كما سُجّلت تاريخًا ظاهرًا في
-- الحملة، ولا تُنقل آليًا إلى سجل الصرف — ذاك يطلب نوع المصدر ومرجعه وسطر الخطة ومن دفع، وكلها لا تُخترع. والخطة «المستبدلة» داخلة
-- مع «المعتمدة»: لا تُستبدل خطة إلا بنسخة معتمدة أحدث.
CREATE TRIGGER campaign_entries_spend_after_media_plan BEFORE INSERT ON campaign_entries
WHEN NEW.kind='spend' AND EXISTS(SELECT 1 FROM media_plans p WHERE p.campaign_id=NEW.campaign_id AND p.status IN ('approved','superseded'))
BEGIN SELECT RAISE(ABORT,'campaign spend is recorded in media_spend_entries once the campaign has an approved media plan'); END;
