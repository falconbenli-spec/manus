-- ترحيل 166 — تحرير الدفع (الحزمة 3، بندا العقد 3 و6).
--
-- ما كان قبل هذا الترحيل، مقيسًا بمسبار على d9a310d لا مستنتجًا:
--   • تغيير حساب المورد يُتحقق منه بشخص مستقل (الترحيل 022)، ثم يسري في اليوم نفسه: لا مهلة تهدئة، ولا خطوة إطلاق
--     لأول دفعة، والحساب القديم يبقى «verified» إلى الأبد (لم يُكتب superseded مرة واحدة)، وجامع البيانات ومن تحقق
--     منها يعدّان ويعتمدان أوامر الدفع لذلك المورد، ولا إشعار ولا رسالة. تغييرٌ اقتُرح وتُحقق منه اليوم يُدفع له اليوم.
--   • الآيبان الموجود على مورد آخر إشارة «مراجعة» فقط، والتحقق منه يمرّ.
--   • الفهرس الفريد payment_orders_live يسمح بأمر واحد بكامل المستحق: لا دفع جزئي ولا دفعي.
--   • «executed» نهائي، فالتحويل الراجع من البنك لا يُسجَّل أصلًا.
--
-- ما يضيفه:
--   (1) payment_order_lines — سطور أمر الدفع: الأمر تحويلٌ واحد، وسطوره ما يُخصم من كل مستحق. أمرٌ بسطر جزئي دفعٌ
--       جزئي، وأمرٌ بسطور عدة دفعٌ دفعي لمورد واحد. الأوامر القائمة تُنقل بسطر واحد بمبلغها كما هو.
--   (2) payment_returns — المرتجع سجلٌّ مستقل مرة واحدة لكل أمر منفّذ؛ الأمر المنفّذ لا يُعدَّل، والرصيد يُفتح من جديد.
--   (3) vendor_bank_changes — تغيير الحساب: الحساب الجديد وما حلّ محله ومن جمعه ومن تحقق منه ويوم التحقق.
--   (4) payment_order_releases — إطلاق أول دفعة لحساب متغيّر بيد شخص ثالث.
--   (5) payable_adjustments — إشعار دائن أو مدين من المورد على مستحق: يُسجَّل ويعتمده شخص ثانٍ، ولا يُعدَّل بعد القرار.
--   (6) vendor_bank_shared_decisions — القرار المسبَّب الذي يسمح بآيبان موجود على مورد نشط آخر.
--   (7) vendor_outbox — رسالة لجهة اتصال المورد الموثقة سابقًا، مسجَّلة «محاكاة»: لا مرسِل يقرأ هذا الجدول.
--   (8) الرؤيتان payable_balances وvendor_bank_change_windows — مصدر واحد للرصيد وللنافذة يقرؤه الكود والقوادح
--       وكل وحدة أخرى، بدل أن تحسب كل وحدة «المدفوع» بطريقتها.
--
-- «النافذة»: من التحقق من الحساب الجديد حتى يُنفَّذ أول تحويل إليه ولا يرجع. أثناءها: لا يعدّ جامع البيانات ولا من تحقق
-- منها أمر دفع لذلك المورد ولا يعتمدانه ولا يوثّقان تنفيذ أول دفعة؛ وأول دفعة واحدة في الطريق؛ ولا تُوثَّق منفّذةً
-- قبل إطلاق شخص ثالث. عدد أيام التهدئة وسقف أول دفعة قيمتان للمالك (app/options.mjs)، ويفرضهما الكود؛ القوادح هنا
-- تفرض ما لا يحتاج رقمًا من المالك: فصل المهام والإطلاق والرصيد.
--
-- الحسابات القديمة: لا يُمسّ صفّ قائم. مورد يحمل اليوم أكثر من حساب «verified» يبقى كما هو، ويُحَلّ عند أول تحقق
-- جديد له (الكود يُحِلّ كل حساب ساري قبل أن يتحقق من الجديد). والتغييرات التي وقعت قبل هذا الترحيل بلا سجل تغيير
-- لا تُعامل تغييرًا: القاعدة تسري على ما يُتحقق منه بعدها.

/* (1) سطور أمر الدفع */
CREATE TABLE payment_order_lines (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  order_id TEXT NOT NULL REFERENCES payment_orders(id),
  payable_id TEXT NOT NULL REFERENCES procurement_payables(id),
  line_no INTEGER NOT NULL CHECK(line_no BETWEEN 1 AND 50),
  amount_minor INTEGER NOT NULL CHECK(amount_minor>0),
  created_at TEXT NOT NULL,
  UNIQUE(order_id,payable_id),
  UNIQUE(order_id,line_no)
) STRICT;
CREATE INDEX payment_order_lines_payable ON payment_order_lines(payable_id);
-- كل أمر قائم سطرٌ واحد بمبلغه ومستحقه كما هما (الأمر كان بكامل المستحق، فالسطر يساويه).
INSERT INTO payment_order_lines(id,tenant_id,order_id,payable_id,line_no,amount_minor,created_at)
  SELECT 'line-'||id,tenant_id,id,payable_id,1,amount_minor,created_at FROM payment_orders;

/* (2) المرتجع */
CREATE TABLE payment_returns (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  order_id TEXT NOT NULL UNIQUE REFERENCES payment_orders(id),
  returned_on TEXT NOT NULL CHECK(returned_on GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]'),
  bank_reference TEXT NOT NULL CHECK(length(trim(bank_reference))>=4),
  -- ما دخل حساب الشركة فعلًا. قد يقلّ عن مبلغ الأمر برسوم البنك؛ والمستحق يُفتح بمبلغ الأمر كاملًا لأن المورد لم يستلم شيئًا.
  credited_minor INTEGER NOT NULL CHECK(credited_minor>0),
  reason TEXT NOT NULL CHECK(length(trim(reason))>=10),
  evidence TEXT NOT NULL CHECK(length(trim(evidence))>=10),
  recorded_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL,
  UNIQUE(tenant_id,bank_reference)
) STRICT;

/* (3) تغيير الحساب البنكي */
CREATE TABLE vendor_bank_changes (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  vendor_id TEXT NOT NULL REFERENCES vendors(id),
  bank_account_id TEXT NOT NULL UNIQUE REFERENCES vendor_bank_accounts(id),
  replaces_id TEXT NOT NULL UNIQUE REFERENCES vendor_bank_accounts(id),
  collected_by TEXT NOT NULL REFERENCES users(id),
  verified_by TEXT NOT NULL REFERENCES users(id),
  verified_on TEXT NOT NULL CHECK(verified_on GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]'),
  created_at TEXT NOT NULL,
  CHECK(bank_account_id<>replaces_id),
  CHECK(collected_by<>verified_by)
) STRICT;
CREATE INDEX vendor_bank_changes_vendor ON vendor_bank_changes(vendor_id);

/* (4) إطلاق أول دفعة */
CREATE TABLE payment_order_releases (
  order_id TEXT PRIMARY KEY REFERENCES payment_orders(id),
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  change_id TEXT NOT NULL REFERENCES vendor_bank_changes(id),
  released_by TEXT NOT NULL REFERENCES users(id),
  note TEXT NOT NULL CHECK(length(trim(note))>=10),
  created_at TEXT NOT NULL
) STRICT;

/* (5) التسويات على المستحق */
CREATE TABLE payable_adjustments (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  payable_id TEXT NOT NULL REFERENCES procurement_payables(id),
  vendor_id TEXT REFERENCES vendors(id),
  -- credit: إشعار دائن من المورد يُنقص ما علينا. debit: إشعار مدين يزيده.
  kind TEXT NOT NULL CHECK(kind IN ('credit','debit')),
  amount_minor INTEGER NOT NULL CHECK(amount_minor>0),
  vat_minor INTEGER NOT NULL DEFAULT 0 CHECK(vat_minor>=0 AND vat_minor<=amount_minor),
  reference TEXT NOT NULL CHECK(length(trim(reference)) BETWEEN 1 AND 120),
  reason TEXT NOT NULL CHECK(length(trim(reason))>=10),
  evidence TEXT NOT NULL CHECK(length(trim(evidence))>=10),
  -- المستند الذي ولّد التسوية في حزمة لاحقة (مرتجع مشتريات، مطالبة، …). 'manual' لما يُسجَّل من شاشة المدفوعات.
  source_kind TEXT NOT NULL DEFAULT 'manual' CHECK(length(source_kind) BETWEEN 3 AND 40 AND source_kind NOT GLOB '*[^a-z_]*'),
  source_id TEXT CHECK(source_id IS NULL OR length(source_id) BETWEEN 1 AND 120),
  status TEXT NOT NULL CHECK(status IN ('pending','approved','rejected')),
  recorded_by TEXT NOT NULL REFERENCES users(id),
  decided_by TEXT REFERENCES users(id),
  decided_at TEXT,
  decision_note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  CHECK(decided_by IS NULL OR decided_by<>recorded_by),
  CHECK((status='pending')=(decided_by IS NULL)),
  CHECK((decided_by IS NULL)=(decided_at IS NULL))
) STRICT;
CREATE INDEX payable_adjustments_payable ON payable_adjustments(payable_id,status);
CREATE UNIQUE INDEX payable_adjustments_reference ON payable_adjustments(tenant_id,payable_id,kind,reference) WHERE status<>'rejected';

/* (6) قرار الآيبان المشترك */
CREATE TABLE vendor_bank_shared_decisions (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  bank_account_id TEXT NOT NULL REFERENCES vendor_bank_accounts(id),
  other_vendor_id TEXT NOT NULL REFERENCES vendors(id),
  reason TEXT NOT NULL CHECK(length(trim(reason))>=20),
  decided_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL,
  UNIQUE(bank_account_id,other_vendor_id)
) STRICT;

/* (7) صادر الموردين — محاكاة */
CREATE TABLE vendor_outbox (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  vendor_id TEXT NOT NULL REFERENCES vendors(id),
  event_key TEXT NOT NULL UNIQUE,
  event_type TEXT NOT NULL CHECK(event_type IN ('bank_change_notice')),
  subject_id TEXT NOT NULL,
  -- العنوان لا يُنسخ هنا: يُقرأ من جهة الاتصال نفسها، كما يفعل صندوق الصادر العام (الترحيل 100).
  contact_id TEXT REFERENCES vendor_contacts(id),
  channel TEXT NOT NULL CHECK(channel IN ('email','phone','none')),
  status TEXT NOT NULL CHECK(status IN ('simulated','no_recipient')),
  simulated INTEGER NOT NULL DEFAULT 1 CHECK(simulated=1),
  subject TEXT NOT NULL CHECK(length(trim(subject)) BETWEEN 3 AND 300),
  body TEXT NOT NULL CHECK(length(trim(body)) BETWEEN 10 AND 1200),
  created_at TEXT NOT NULL,
  CHECK((status='no_recipient')=(contact_id IS NULL)),
  CHECK((channel='none')=(contact_id IS NULL))
) STRICT;
CREATE INDEX vendor_outbox_subject ON vendor_outbox(subject_id);

/* (8) الرؤيتان */
-- الرصيد لكل مستحق: المعدَّل = المبلغ + المدين − الدائن (المعتمد وحده)، والمدفوع = سطور الأوامر المنفّذة التي لم ترجع،
-- وفي الطريق = سطور الأوامر المعلّقة والمعتمدة، والمتاح لأمر جديد = المعدَّل − المدفوع − ما في الطريق.
CREATE VIEW payable_balances AS
SELECT s.payable_id,s.tenant_id,s.amount_minor,s.debit_minor,s.credit_minor,
  s.amount_minor+s.debit_minor-s.credit_minor AS adjusted_minor,
  s.paid_minor,s.returned_minor,s.pending_minor,s.approved_minor,
  s.pending_minor+s.approved_minor AS in_flight_minor,
  s.amount_minor+s.debit_minor-s.credit_minor-s.paid_minor AS outstanding_minor,
  s.amount_minor+s.debit_minor-s.credit_minor-s.paid_minor-s.pending_minor-s.approved_minor AS available_minor
FROM (
  SELECT p.id AS payable_id,i.tenant_id,p.amount_minor,
    COALESCE((SELECT SUM(a.amount_minor) FROM payable_adjustments a WHERE a.payable_id=p.id AND a.status='approved' AND a.kind='debit'),0) AS debit_minor,
    COALESCE((SELECT SUM(a.amount_minor) FROM payable_adjustments a WHERE a.payable_id=p.id AND a.status='approved' AND a.kind='credit'),0) AS credit_minor,
    COALESCE((SELECT SUM(l.amount_minor) FROM payment_order_lines l JOIN payment_orders o ON o.id=l.order_id
      WHERE l.payable_id=p.id AND o.status='executed' AND NOT EXISTS(SELECT 1 FROM payment_returns r WHERE r.order_id=o.id)),0) AS paid_minor,
    COALESCE((SELECT SUM(l.amount_minor) FROM payment_order_lines l JOIN payment_orders o ON o.id=l.order_id
      WHERE l.payable_id=p.id AND o.status='executed' AND EXISTS(SELECT 1 FROM payment_returns r WHERE r.order_id=o.id)),0) AS returned_minor,
    COALESCE((SELECT SUM(l.amount_minor) FROM payment_order_lines l JOIN payment_orders o ON o.id=l.order_id WHERE l.payable_id=p.id AND o.status='pending'),0) AS pending_minor,
    COALESCE((SELECT SUM(l.amount_minor) FROM payment_order_lines l JOIN payment_orders o ON o.id=l.order_id WHERE l.payable_id=p.id AND o.status='approved'),0) AS approved_minor
  FROM procurement_payables p JOIN procurement_invoices i ON i.id=p.invoice_id
) s;
-- التغيير المفتوح: حسابه ما زال الساري، ولم يُنفَّذ إليه تحويلٌ لم يرجع.
CREATE VIEW vendor_bank_change_windows AS
SELECT c.id,c.tenant_id,c.vendor_id,c.bank_account_id,c.replaces_id,c.collected_by,c.verified_by,c.verified_on
FROM vendor_bank_changes c JOIN vendor_bank_accounts b ON b.id=c.bank_account_id
WHERE b.status='verified'
  AND NOT EXISTS(SELECT 1 FROM payment_orders o WHERE o.bank_account_id=c.bank_account_id AND o.status='executed'
    AND NOT EXISTS(SELECT 1 FROM payment_returns r WHERE r.order_id=o.id));

/* (9) الفهارس: أوامر عدة للمستحق الواحد */
-- الفهرس الفريد كان هو ما يمنع دفع المستحق مرتين. صار ذلك على السطور: قادح الرصيد أدناه لا يقبل سطرًا يتجاوز
-- المتاح، وهو يجري داخل معاملة الكاتب الواحد (BEGIN IMMEDIATE) فلا يسبقه كاتبٌ آخر.
DROP INDEX payment_orders_live;
CREATE INDEX payment_orders_payable ON payment_orders(payable_id,status);
CREATE INDEX payment_orders_bank_account ON payment_orders(bank_account_id,status);

/* (10) القوادح */
-- سطور الأمر: تُضاف والأمر معلّق، وفي كيانه وكيان المستحق، ولا تتجاوز المتاح. ولا تُعدَّل ولا تُحذف بعده.
CREATE TRIGGER payment_order_lines_guard BEFORE INSERT ON payment_order_lines
WHEN NOT EXISTS(SELECT 1 FROM payment_orders o JOIN procurement_payables p ON p.id=NEW.payable_id JOIN procurement_invoices i ON i.id=p.invoice_id
  WHERE o.id=NEW.order_id AND o.status='pending' AND o.tenant_id=NEW.tenant_id AND i.tenant_id=NEW.tenant_id)
BEGIN SELECT RAISE(ABORT,'a payment line joins a pending order and a payable of the same tenant'); END;
CREATE TRIGGER payment_order_lines_within_balance BEFORE INSERT ON payment_order_lines
WHEN NEW.amount_minor>COALESCE((SELECT available_minor FROM payable_balances WHERE payable_id=NEW.payable_id),0)
BEGIN SELECT RAISE(ABORT,'a payment line cannot exceed what is still open on the payable'); END;
CREATE TRIGGER payment_order_lines_no_update BEFORE UPDATE ON payment_order_lines BEGIN SELECT RAISE(ABORT,'payment lines are fixed with their order'); END;
CREATE TRIGGER payment_order_lines_no_delete BEFORE DELETE ON payment_order_lines BEGIN SELECT RAISE(ABORT,'payment lines are fixed with their order'); END;

-- الأمر لا يُعتمد إلا وسطوره تساوي مبلغه.
CREATE TRIGGER payment_orders_lines_add_up BEFORE UPDATE OF status ON payment_orders
WHEN NEW.status='approved' AND NEW.amount_minor<>COALESCE((SELECT SUM(amount_minor) FROM payment_order_lines WHERE order_id=NEW.id),0)
BEGIN SELECT RAISE(ABORT,'a payment order is approved only when its lines add up to its amount'); END;

-- النافذة: جامع البيانات ومن تحقق منها لا يعدّان أمرًا لذلك المورد ولا يعتمدانه — ولا يُعتمد أمرٌ أعدّه أحدهما.
CREATE TRIGGER payment_orders_window_preparer BEFORE INSERT ON payment_orders
WHEN EXISTS(SELECT 1 FROM vendor_bank_change_windows w WHERE w.vendor_id=NEW.vendor_id AND NEW.prepared_by IN (w.collected_by,w.verified_by))
BEGIN SELECT RAISE(ABORT,'during a bank change window the collector and the verifier do not prepare or approve payments to that vendor'); END;
CREATE TRIGGER payment_orders_window_approver BEFORE UPDATE OF approved_by ON payment_orders
WHEN NEW.approved_by IS NOT NULL AND EXISTS(SELECT 1 FROM vendor_bank_change_windows w WHERE w.vendor_id=NEW.vendor_id
  AND (NEW.approved_by IN (w.collected_by,w.verified_by) OR NEW.prepared_by IN (w.collected_by,w.verified_by)))
BEGIN SELECT RAISE(ABORT,'during a bank change window the collector and the verifier do not prepare or approve payments to that vendor'); END;
-- ولا يوثّقان تنفيذ أول دفعة إلى الحساب المتغيّر.
CREATE TRIGGER payment_orders_window_recorder BEFORE UPDATE OF execution_recorded_by ON payment_orders
WHEN NEW.execution_recorded_by IS NOT NULL AND EXISTS(SELECT 1 FROM vendor_bank_change_windows w WHERE w.bank_account_id=NEW.bank_account_id
  AND NEW.execution_recorded_by IN (w.collected_by,w.verified_by))
BEGIN SELECT RAISE(ABORT,'the collector and the verifier of a changed bank account do not record its first payment'); END;
-- أول دفعة واحدة في الطريق إلى الحساب المتغيّر.
CREATE TRIGGER payment_orders_one_first_payment BEFORE INSERT ON payment_orders
WHEN EXISTS(SELECT 1 FROM vendor_bank_change_windows w WHERE w.bank_account_id=NEW.bank_account_id)
  AND EXISTS(SELECT 1 FROM payment_orders o WHERE o.bank_account_id=NEW.bank_account_id AND o.status IN ('pending','approved'))
BEGIN SELECT RAISE(ABORT,'a changed bank account carries one first payment at a time until it is executed'); END;
-- ولا تُوثَّق منفّذةً قبل إطلاق شخص ثالث.
CREATE TRIGGER payment_orders_first_payment_released BEFORE UPDATE OF status ON payment_orders
WHEN NEW.status='executed' AND EXISTS(SELECT 1 FROM vendor_bank_change_windows w WHERE w.bank_account_id=NEW.bank_account_id)
  AND NOT EXISTS(SELECT 1 FROM payment_order_releases r WHERE r.order_id=NEW.id)
BEGIN SELECT RAISE(ABORT,'the first payment to a changed bank account is released by a third person before it is recorded as executed'); END;

-- الإطلاق: على أمر معتمد إلى حساب متغيّر في نافذته، بيد من ليس جامع البيانات ولا متحققها ولا المعدّ ولا المعتمد.
CREATE TRIGGER payment_order_releases_guard BEFORE INSERT ON payment_order_releases
WHEN NOT EXISTS(SELECT 1 FROM payment_orders o JOIN vendor_bank_change_windows w ON w.bank_account_id=o.bank_account_id
  WHERE o.id=NEW.order_id AND o.tenant_id=NEW.tenant_id AND w.id=NEW.change_id AND o.status='approved'
    AND NEW.released_by NOT IN (w.collected_by,w.verified_by,o.prepared_by,o.approved_by))
BEGIN SELECT RAISE(ABORT,'a first payment is released on an approved order to a changed account in its window, by someone who is neither the collector, the verifier, the preparer nor the approver'); END;
CREATE TRIGGER payment_order_releases_no_update BEFORE UPDATE ON payment_order_releases BEGIN SELECT RAISE(ABORT,'releases are kept as recorded'); END;
CREATE TRIGGER payment_order_releases_no_delete BEFORE DELETE ON payment_order_releases BEGIN SELECT RAISE(ABORT,'releases are kept as recorded'); END;

-- المرتجع: مرة واحدة على أمر منفّذ، لا يتجاوز مبلغه، بتاريخ لا يسبق التنفيذ، بيد من لم يعدّه ولم يعتمده.
CREATE TRIGGER payment_returns_guard BEFORE INSERT ON payment_returns
WHEN NOT EXISTS(SELECT 1 FROM payment_orders o WHERE o.id=NEW.order_id AND o.tenant_id=NEW.tenant_id AND o.status='executed'
  AND NEW.credited_minor<=o.amount_minor AND NEW.returned_on>=o.executed_on AND NEW.recorded_by NOT IN (o.prepared_by,o.approved_by))
BEGIN SELECT RAISE(ABORT,'a return is recorded once on an executed order, for no more than it carried, by someone who neither prepared nor approved it'); END;
CREATE TRIGGER payment_returns_no_update BEFORE UPDATE ON payment_returns BEGIN SELECT RAISE(ABORT,'returns are kept as recorded'); END;
CREATE TRIGGER payment_returns_no_delete BEFORE DELETE ON payment_returns BEGIN SELECT RAISE(ABORT,'returns are kept as recorded'); END;

-- التغيير: يربط حسابًا جديدًا معلّقًا بالحساب الذي حلّ محله، ومتحققه غير جامعه. ولا يُعدَّل ولا يُحذف.
CREATE TRIGGER vendor_bank_changes_guard BEFORE INSERT ON vendor_bank_changes
WHEN NOT EXISTS(SELECT 1 FROM vendor_bank_accounts n JOIN vendor_bank_accounts o ON o.vendor_id=n.vendor_id JOIN vendors x ON x.id=n.vendor_id
  WHERE n.id=NEW.bank_account_id AND o.id=NEW.replaces_id AND n.vendor_id=NEW.vendor_id AND x.tenant_id=NEW.tenant_id
    AND n.status='pending' AND o.status='superseded' AND n.collected_by=NEW.collected_by AND NEW.verified_by<>n.collected_by)
BEGIN SELECT RAISE(ABORT,'a bank change links a pending replacement to the account it supersedes, and its verifier is not its collector'); END;
CREATE TRIGGER vendor_bank_changes_no_update BEFORE UPDATE ON vendor_bank_changes BEGIN SELECT RAISE(ABORT,'bank changes are kept as recorded'); END;
CREATE TRIGGER vendor_bank_changes_no_delete BEFORE DELETE ON vendor_bank_changes BEGIN SELECT RAISE(ABORT,'bank changes are kept as recorded'); END;

-- التحقق من حساب لمورد سبق له حساب: حساب ساري واحد، وسجل تغيير بالمتحقق نفسه، ولا آيبان لمورد نشط آخر بلا قرار.
CREATE TRIGGER vendor_bank_one_current BEFORE UPDATE OF status ON vendor_bank_accounts
WHEN OLD.status='pending' AND NEW.status='verified'
  AND EXISTS(SELECT 1 FROM vendor_bank_accounts b WHERE b.vendor_id=NEW.vendor_id AND b.id<>NEW.id AND b.status='verified')
BEGIN SELECT RAISE(ABORT,'a vendor has one current bank account: the one it replaces is marked superseded first'); END;
CREATE TRIGGER vendor_bank_change_recorded BEFORE UPDATE OF status ON vendor_bank_accounts
WHEN OLD.status='pending' AND NEW.status='verified'
  AND EXISTS(SELECT 1 FROM vendor_bank_accounts b WHERE b.vendor_id=NEW.vendor_id AND b.id<>NEW.id AND b.status IN ('verified','superseded'))
  AND NOT EXISTS(SELECT 1 FROM vendor_bank_changes c WHERE c.bank_account_id=NEW.id AND c.verified_by=NEW.verified_by)
BEGIN SELECT RAISE(ABORT,'verifying a replacement bank account records the change and its verifier first'); END;
CREATE TRIGGER vendor_bank_shared_iban_decided BEFORE UPDATE OF status ON vendor_bank_accounts
WHEN OLD.status='pending' AND NEW.status='verified' AND EXISTS(
  SELECT 1 FROM vendor_bank_accounts b JOIN vendors x ON x.id=b.vendor_id
  WHERE b.iban_digest=NEW.iban_digest AND b.vendor_id<>NEW.vendor_id AND b.status IN ('pending','verified')
    AND x.status NOT IN ('merged','rejected') AND x.tenant_id=(SELECT tenant_id FROM vendors WHERE id=NEW.vendor_id)
    AND NOT EXISTS(SELECT 1 FROM vendor_bank_shared_decisions d WHERE d.bank_account_id=NEW.id AND d.other_vendor_id=b.vendor_id AND d.decided_by<>NEW.verified_by))
BEGIN SELECT RAISE(ABORT,'an IBAN already on another active vendor is verified only after a separate reasoned decision by someone other than the verifier'); END;

-- القرار المسبَّب: على حساب معلّق، بيد غير جامعه، ولمورد آخر يحمل الآيبان نفسه في الكيان نفسه. ولا يُعدَّل ولا يُحذف.
CREATE TRIGGER vendor_bank_shared_decisions_guard BEFORE INSERT ON vendor_bank_shared_decisions
WHEN NOT EXISTS(SELECT 1 FROM vendor_bank_accounts n JOIN vendors x ON x.id=n.vendor_id JOIN vendor_bank_accounts b ON b.iban_digest=n.iban_digest JOIN vendors y ON y.id=b.vendor_id
  WHERE n.id=NEW.bank_account_id AND n.status='pending' AND n.collected_by<>NEW.decided_by AND x.tenant_id=NEW.tenant_id
    AND b.vendor_id=NEW.other_vendor_id AND b.vendor_id<>n.vendor_id AND y.tenant_id=NEW.tenant_id)
BEGIN SELECT RAISE(ABORT,'a shared IBAN decision is recorded on a pending account, by someone other than its collector, for another vendor of the same tenant that carries it'); END;
CREATE TRIGGER vendor_bank_shared_decisions_no_update BEFORE UPDATE ON vendor_bank_shared_decisions BEGIN SELECT RAISE(ABORT,'shared IBAN decisions are kept as recorded'); END;
CREATE TRIGGER vendor_bank_shared_decisions_no_delete BEFORE DELETE ON vendor_bank_shared_decisions BEGIN SELECT RAISE(ABORT,'shared IBAN decisions are kept as recorded'); END;

-- الرسالة المحاكاة: لا تُعدَّل ولا تُحذف (لا «sent» يُكتب عليها يومًا من غير مرسِل حقيقي).
CREATE TRIGGER vendor_outbox_no_update BEFORE UPDATE ON vendor_outbox BEGIN SELECT RAISE(ABORT,'simulated messages are kept as recorded'); END;
CREATE TRIGGER vendor_outbox_no_delete BEFORE DELETE ON vendor_outbox BEGIN SELECT RAISE(ABORT,'simulated messages are kept as recorded'); END;

-- التسوية: تُسجَّل معلّقة في كيان مستحقها، ويُقرَّر فيها مرة واحدة، ولا ينزل الدائن المعتمد بالرصيد تحت المدفوع وما في الطريق.
CREATE TRIGGER payable_adjustments_guard BEFORE INSERT ON payable_adjustments
WHEN NEW.status<>'pending' OR NOT EXISTS(SELECT 1 FROM procurement_payables p JOIN procurement_invoices i ON i.id=p.invoice_id WHERE p.id=NEW.payable_id AND i.tenant_id=NEW.tenant_id)
BEGIN SELECT RAISE(ABORT,'an adjustment is recorded pending, on a payable of its own tenant'); END;
CREATE TRIGGER payable_adjustments_fixed BEFORE UPDATE ON payable_adjustments
WHEN OLD.status<>'pending' OR NEW.status NOT IN ('approved','rejected') OR NEW.id<>OLD.id OR NEW.tenant_id<>OLD.tenant_id OR NEW.payable_id<>OLD.payable_id
  OR NEW.vendor_id IS NOT OLD.vendor_id OR NEW.kind<>OLD.kind OR NEW.amount_minor<>OLD.amount_minor OR NEW.vat_minor<>OLD.vat_minor
  OR NEW.reference<>OLD.reference OR NEW.reason<>OLD.reason OR NEW.evidence<>OLD.evidence OR NEW.source_kind<>OLD.source_kind
  OR NEW.source_id IS NOT OLD.source_id OR NEW.recorded_by<>OLD.recorded_by OR NEW.created_at<>OLD.created_at
BEGIN SELECT RAISE(ABORT,'an adjustment is decided once and never edited'); END;
CREATE TRIGGER payable_adjustments_within_balance BEFORE UPDATE OF status ON payable_adjustments
WHEN NEW.status='approved' AND NEW.kind='credit'
  AND NEW.amount_minor>COALESCE((SELECT available_minor FROM payable_balances WHERE payable_id=NEW.payable_id),0)
BEGIN SELECT RAISE(ABORT,'a credit note cannot take the payable below what is already paid or on its way'); END;
CREATE TRIGGER payable_adjustments_no_delete BEFORE DELETE ON payable_adjustments BEGIN SELECT RAISE(ABORT,'adjustments are kept as recorded'); END;
