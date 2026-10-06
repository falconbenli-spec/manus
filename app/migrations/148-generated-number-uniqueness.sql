-- ترحيل 148 — الفهرس الفريد على الأرقام المولَّدة: الشطر الناقص من البند 7 في م1.
--
-- البند 7 حوّل أربع وحدات من `COUNT(*)+1` إلى `MAX+1`، واشترط معه **فهرسًا فريدًا**. التحويل تمّ
-- ولم يُضَف الفهرس على أيٍّ منها. وقياسٌ بحزام التزامن (tests/concurrency.test.mjs) أثبت أن `MAX+1`
-- آمنٌ فعلًا **ما دام داخل معاملة**: ست عمليات ترقّم معًا فتخرج بستة أرقام متتابعة بلا فجوة، لأن
-- `BEGIN IMMEDIATE` يسلسلها على قفل الكاتب. وبلا معاملة يقع التكرار في التشغيل نفسه.
--
-- فالحماية اليوم من القفل لا من الرقم. والفهرس خط دفاع ثانٍ لا أول: مسارٌ يُكتب غدًا وينسى المعاملة
-- يصير عطبًا **مسموعًا** — إدراجٌ يُرفض — بدل رقمين متطابقين على عقدين مختلفين لا يُكتشفان إلا
-- حين يُسأل عن العقد رقم كذا فيعود اثنان.
--
-- النطاق (tenant_id, الرقم) لأن الترقيم نفسه مرشَّح بالكيان في كل وحدة من الخمس.
-- والبيانات الحية فُحصت قبل هذا: صفر تكرار في الخمسة، فلا صفّ يُرفض عند التطبيق.
CREATE UNIQUE INDEX clients_code_unique           ON clients(tenant_id,code);
CREATE UNIQUE INDEX contract_records_number_unique ON contract_records(tenant_id,number);
CREATE UNIQUE INDEX fixed_assets_code_unique      ON fixed_assets(tenant_id,code);
CREATE UNIQUE INDEX equipment_items_code_unique   ON equipment_items(tenant_id,code);
CREATE UNIQUE INDEX equipment_kits_code_unique    ON equipment_kits(tenant_id,code);
