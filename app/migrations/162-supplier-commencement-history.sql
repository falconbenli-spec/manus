-- ترحيل 162 — أمر المباشرة للمورد: إذنٌ مربوط بنسخة أمر الشراء، له مدة سريان ودليل، ويُسحب ويُستبدل ولا يُمحى.
--
-- الموجود قبل هذا الترحيل (116): جدول commencement_authorisations بسجل واحد لكل طلب (purchase_id UNIQUE)،
-- يحفظ من أصدره ومتى وتاريخ البدء والموقع ونص النطاق، ولا يُعدَّل ولا يُحذف. والاستلام في الكود يشترط وجوده.
-- قِيس قبل الكتابة على الكود نفسه (لا استُنتج)، فظهرت خمس فجوات تجعل «أمر المباشرة» ورقةً تُصدر مرة ثم تُنسى:
--   ١. لا نسخة أمر: عُدّل موعد تسليم الأمر واعتُمد التعديل، فبقي الإذن القديم يفتح الاستلام كأن الأمر لم يتغيّر.
--   ٢. لا مدة سريان: إذنٌ تاريخ بدئه 2099-01-01 فُتح به الاستلام اليوم، ولا تاريخ ينتهي عنده الإذن أصلًا.
--   ٣. لا دليل: لا يُحفظ كيف أُبلغ المورد بالإذن، وهو الشيء الوحيد الذي يثبت أن «ابدأ» قيلت له فعلًا.
--   ٤. لا سحب ولا استبدال: الإذن الثاني يُرفض (UNIQUE)، فالمورد الذي يجب إيقافه لا يُوقف إلا بإلغاء الطلب كله.
--   ٥. القاعدة لا تحرس شيئًا: إدراج مباشر لاستلام بلا أي إذن مرّ، وإدراج مباشر لإذنٍ أصدره طالب الشراء نفسه مرّ.
--
-- ما يفعله الترحيل: يعيد بناء الجدول نفسه باسمه (لا جدول موازٍ)، فيصير كل إذن صفًّا لا يُمسّ، والاستبدال صفًّا جديدًا
-- يشير إلى الذي حلّ محله (replaces_id)، والسحب صفًّا في جدول مستقل (commencement_withdrawals) لأن كتابة السحب على
-- صف الإذن تعديلٌ له. «القائم» مشتق لا مخزَّن: إذنٌ لم يُسحب ولم يُستبدل. ولا يقوم لطلب واحد إلا إذنٌ واحد.
--
-- نسخة الأمر: الأمر نفسه لا يُعدَّل (procurement_orders_no_update، الترحيل 005)، وتعديله يُسجَّل في
-- procurement_order_changes (الترحيل 039). فنسخة الأمر = 1 + عدد تعديلاته المعتمدة، بالعدّ نفسه في الكود
-- (app/procurement-guards.mjs: orderVersion) وفي المُطلِقات أدناه، فلا يختلف الطرفان على رقم.
--
-- اليوم في القاعدة يوم الرياض: created_at يُكتب بتوقيت UTC (app/db.mjs: now)، والرياض UTC+3 بلا توقيت صيفي،
-- فـdate(x,'+3 hours') هو اليوم نفسه الذي يحسبه الكود بـIntl وAsia/Riyadh.
--
-- فُحص قبل الكتابة: نسخة القاعدة الحية الاحتياطية (30 سبتمبر، عند الترحيل 158) فيها صفر إذن مباشرة وصفر أمر شراء
-- وصفر استلام، فلا صفّ يتغيّر معناه. ومع ذلك يُنقل كل صفّ قائم كما هو: الإذن الذي صدر قبل هذا الترحيل لا تُخترع له
-- مدة سريان ولا دليل — يبقى الحقلان فارغين، ولا يفتح استلامًا حتى يُستبدل بإذن يحملهما، والفراغ يقول ذلك بنفسه.
-- ولا جدول يحيل إلى commencement_authorisations قبل هذا الترحيل، فالإسقاط ثم الإنشاء بالاسم نفسه لا يترك إحالة معلقة.

CREATE TEMP TABLE commencement_carry AS SELECT * FROM commencement_authorisations;
DROP TABLE commencement_authorisations;

CREATE TABLE commencement_authorisations (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  purchase_id TEXT NOT NULL REFERENCES procurement_purchases(id),
  -- رقم الإذن داخل الطلب: الأول 1، وكل إصدار أو استبدال بعده يزيد واحدًا. به يُقرأ التاريخ مرتبًا.
  sequence INTEGER NOT NULL CHECK(sequence BETWEEN 1 AND 1000),
  order_id TEXT NOT NULL,
  -- نسخة أمر الشراء التي صدر عليها الإذن. إن تعدّل الأمر بعده لم يعد الإذن يكفي للاستلام.
  order_version INTEGER NOT NULL CHECK(order_version BETWEEN 1 AND 10000),
  start_on TEXT NOT NULL CHECK(date(start_on) IS start_on),
  -- آخر يوم يسري فيه الإذن. فارغ فقط في إذنٍ صدر قبل هذا الترحيل (والمُطلِق أدناه يمنع أي فراغ جديد).
  valid_until TEXT CHECK(valid_until IS NULL OR (date(valid_until) IS valid_until AND valid_until>=start_on)),
  site_or_channel TEXT NOT NULL CHECK(length(trim(site_or_channel))>=3),
  scope_confirmation TEXT NOT NULL CHECK(length(trim(scope_confirmation))>=10),
  -- كيف أُبلغ المورد بالإذن: الخطاب أو البريد أو المحضر ومكان حفظه.
  evidence TEXT CHECK(evidence IS NULL OR length(trim(evidence))>=10),
  replaces_id TEXT,
  replacement_reason TEXT CHECK(replacement_reason IS NULL OR length(trim(replacement_reason))>=10),
  issued_by TEXT NOT NULL,
  issued_at TEXT NOT NULL,
  UNIQUE(purchase_id,sequence),
  UNIQUE(id,purchase_id),
  -- الإذن يُستبدل مرة واحدة: سلسلة لا شجرة، فلا يقوم إذنان معًا بالاستبدال.
  UNIQUE(replaces_id),
  FOREIGN KEY(issued_by,tenant_id) REFERENCES users(id,tenant_id),
  FOREIGN KEY(purchase_id,tenant_id) REFERENCES procurement_purchases(id,tenant_id),
  FOREIGN KEY(order_id,purchase_id) REFERENCES procurement_orders(id,purchase_id),
  FOREIGN KEY(replaces_id,purchase_id) REFERENCES commencement_authorisations(id,purchase_id),
  CHECK((replaces_id IS NULL)=(replacement_reason IS NULL)),
  CHECK(replaces_id IS NULL OR replaces_id<>id),
  CHECK((valid_until IS NULL)=(evidence IS NULL))
) STRICT;

-- الإذن القائم قبل الترحيل: رقمه 1 (كان واحدًا لكل طلب)، ونسخة الأمر التي صدر عليها = تعديلات الأمر المعتمدة قبل
-- لحظة إصداره. مدة السريان والدليل لا تُخترعان.
INSERT INTO commencement_authorisations(id,tenant_id,purchase_id,sequence,order_id,order_version,start_on,valid_until,site_or_channel,scope_confirmation,evidence,replaces_id,replacement_reason,issued_by,issued_at)
SELECT c.id,c.tenant_id,c.purchase_id,1,c.order_id,
  1+(SELECT COUNT(*) FROM procurement_order_changes x WHERE x.order_id=c.order_id AND x.status='approved' AND x.decided_at<=c.issued_at),
  c.start_on,NULL,c.site_or_channel,c.scope_confirmation,NULL,NULL,NULL,c.issued_by,c.issued_at
FROM commencement_carry c;
DROP TABLE commencement_carry;

-- السحب سجلٌّ مستقل: كتابته على صف الإذن تعديلٌ له، والإذن لا يُعدَّل. صفٌّ واحد على الأكثر لكل إذن.
CREATE TABLE commencement_withdrawals (
  authorisation_id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  purchase_id TEXT NOT NULL,
  reason TEXT NOT NULL CHECK(length(trim(reason))>=10),
  -- كيف أُبلغ المورد بالتوقف.
  evidence TEXT NOT NULL CHECK(length(trim(evidence))>=10),
  withdrawn_by TEXT NOT NULL,
  withdrawn_at TEXT NOT NULL,
  FOREIGN KEY(authorisation_id,purchase_id) REFERENCES commencement_authorisations(id,purchase_id),
  FOREIGN KEY(purchase_id,tenant_id) REFERENCES procurement_purchases(id,tenant_id),
  FOREIGN KEY(withdrawn_by,tenant_id) REFERENCES users(id,tenant_id)
) STRICT;

/* ───── لا تعديل ولا حذف: التاريخ يُقرأ كما وقع ───── */
CREATE TRIGGER commencement_no_update BEFORE UPDATE ON commencement_authorisations
BEGIN SELECT RAISE(ABORT,'a commencement authorisation is issued once; replace it with a new one'); END;
CREATE TRIGGER commencement_no_delete BEFORE DELETE ON commencement_authorisations
BEGIN SELECT RAISE(ABORT,'a commencement authorisation is retained'); END;
CREATE TRIGGER commencement_withdrawals_no_update BEFORE UPDATE ON commencement_withdrawals
BEGIN SELECT RAISE(ABORT,'a commencement withdrawal is retained as recorded'); END;
CREATE TRIGGER commencement_withdrawals_no_delete BEFORE DELETE ON commencement_withdrawals
BEGIN SELECT RAISE(ABORT,'a commencement withdrawal is retained as recorded'); END;

/* ───── الإصدار والاستبدال: القاعدة تحرس ما يحرسه الكود ───── */
-- الحارس في الطبقتين كما في الترحيلات 144 و145 و152: حارس الكود يحرس مساره وحده، وأي إدراج مباشر — سكربت، إصلاح
-- يدوي، مسار يُكتب غدًا — يمرّ من تحته. والإذن صفٌّ لا يُعدَّل ولا يُحذف، فمنعه عند الإدراج هو الفرصة الوحيدة.
-- وتُنشأ المُطلِقات بعد نقل الصفوف القديمة، فلا تُحاكَم تلك الصفوف بقواعد لم تكن قائمة يوم صدرت.

-- فصل المهام بمعيار اعتماد الأمر نفسه (procurement_order_guard، الترحيل 005): من طلب الشراء لا يأذن للمورد بالبدء عليه.
CREATE TRIGGER commencement_issuer_independent BEFORE INSERT ON commencement_authorisations
WHEN EXISTS(SELECT 1 FROM procurement_purchases p WHERE p.id=NEW.purchase_id AND p.requester_id=NEW.issued_by)
BEGIN SELECT RAISE(ABORT,'the requester does not authorise the supplier to start on their own purchase'); END;

-- بعد أمر شراء معتمد وقبل اكتمال الاستلام، على نسخة الأمر القائمة لا نسخة سابقة، وتاريخ بدءٍ لا يسبق الأمر.
CREATE TRIGGER commencement_binds_current_order BEFORE INSERT ON commencement_authorisations
WHEN NOT EXISTS(
  SELECT 1 FROM procurement_purchases p JOIN procurement_orders o ON o.purchase_id=p.id
  WHERE p.id=NEW.purchase_id AND o.id=NEW.order_id AND p.tenant_id=NEW.tenant_id
    AND p.status IN ('ordered','part_received')
    AND NEW.start_on>=date(o.created_at,'+3 hours')
    AND NEW.order_version=1+(SELECT COUNT(*) FROM procurement_order_changes c WHERE c.order_id=o.id AND c.status='approved')
)
BEGIN SELECT RAISE(ABORT,'a commencement authorisation binds the current version of an approved purchase order'); END;

-- كل إذن جديد يحمل مدة سريانٍ لم تنتهِ يوم صدوره، ودليل إبلاغ المورد.
CREATE TRIGGER commencement_complete BEFORE INSERT ON commencement_authorisations
WHEN NEW.valid_until IS NULL OR NEW.evidence IS NULL OR NEW.valid_until<date(NEW.issued_at,'+3 hours')
BEGIN SELECT RAISE(ABORT,'a commencement authorisation records a current validity and its evidence'); END;

-- إذنٌ واحد قائم لكل طلب. الإصدار الجديد لطلب لا إذن قائم له، والاستبدال للقائم وحده؛ والرقم يلي آخر رقم.
CREATE TRIGGER commencement_one_live BEFORE INSERT ON commencement_authorisations
WHEN NEW.sequence<>1+(SELECT COUNT(*) FROM commencement_authorisations x WHERE x.purchase_id=NEW.purchase_id)
  OR (NEW.replaces_id IS NULL AND EXISTS(
    SELECT 1 FROM commencement_authorisations a WHERE a.purchase_id=NEW.purchase_id
      AND NOT EXISTS(SELECT 1 FROM commencement_withdrawals w WHERE w.authorisation_id=a.id)
      AND NOT EXISTS(SELECT 1 FROM commencement_authorisations r WHERE r.replaces_id=a.id)))
  OR (NEW.replaces_id IS NOT NULL AND (
    NOT EXISTS(SELECT 1 FROM commencement_authorisations a WHERE a.id=NEW.replaces_id AND a.purchase_id=NEW.purchase_id)
    OR EXISTS(SELECT 1 FROM commencement_withdrawals w WHERE w.authorisation_id=NEW.replaces_id)))
BEGIN SELECT RAISE(ABORT,'one live commencement authorisation per purchase; a replacement supersedes the live one'); END;

-- السحب للإذن القائم وحده (لا لإذنٍ استُبدل)، ولا يسحبه طالب الشراء: السلطة التي تأذن هي التي توقف.
CREATE TRIGGER commencement_withdrawal_guard BEFORE INSERT ON commencement_withdrawals
WHEN NOT EXISTS(
  SELECT 1 FROM commencement_authorisations a JOIN procurement_purchases p ON p.id=a.purchase_id
  WHERE a.id=NEW.authorisation_id AND a.purchase_id=NEW.purchase_id AND p.tenant_id=NEW.tenant_id
    AND p.requester_id<>NEW.withdrawn_by
    AND NOT EXISTS(SELECT 1 FROM commencement_authorisations r WHERE r.replaces_id=a.id)
)
BEGIN SELECT RAISE(ABORT,'only the live commencement authorisation is withdrawn, and not by the requester'); END;

/* ───── الاستلام: إذنٌ سارٍ على نسخة الأمر القائمة يوم التسجيل ───── */
-- الشرط يُعاد فحصه لحظة الإدراج بتاريخ الاستلام نفسه. والمُطلِق يسكت حيث يتكلم غيره: طلبٌ ليس في حالة استلام
-- يرفضه procurement_receipt_limit (141)، وأمرٌ أُقفل على المستلم يرفضه procurement_receipt_closed_short (039)،
-- فلا يسبقهما هذا المُطلِق برسالة تسمّي سببًا غير السبب.
CREATE TRIGGER procurement_receipt_commencement BEFORE INSERT ON procurement_receipts
WHEN EXISTS(SELECT 1 FROM procurement_orders o JOIN procurement_purchases p ON p.id=o.purchase_id WHERE p.id=NEW.purchase_id AND p.status IN ('ordered','part_received'))
  AND NOT EXISTS(SELECT 1 FROM procurement_order_changes c WHERE c.purchase_id=NEW.purchase_id AND c.kind='close_short' AND c.status='approved')
  AND NOT EXISTS(
    SELECT 1 FROM commencement_authorisations a JOIN procurement_orders o ON o.id=a.order_id
    WHERE a.purchase_id=NEW.purchase_id AND a.valid_until IS NOT NULL
      AND NOT EXISTS(SELECT 1 FROM commencement_withdrawals w WHERE w.authorisation_id=a.id)
      AND NOT EXISTS(SELECT 1 FROM commencement_authorisations r WHERE r.replaces_id=a.id)
      AND a.order_version=1+(SELECT COUNT(*) FROM procurement_order_changes c WHERE c.order_id=o.id AND c.status='approved')
      AND date(NEW.created_at,'+3 hours') BETWEEN a.start_on AND a.valid_until
  )
BEGIN SELECT RAISE(ABORT,'receipt requires a valid commencement authorisation for the current order version'); END;
