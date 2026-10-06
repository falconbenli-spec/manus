-- ترحيل 182 — عرض الصفقة المعتمد وسلطة الهامش (الحزمة 4، P4-CRM-3، القرار D2 في docs/readiness/DECISIONS-NEEDED.md §ز).
--
-- العطب، مقيسًا على 54288b6: قمعا التسعير والصفقة لا يلتقيان. ورقة التسعير (MOD-BD-02) واستثناء الهامش (MOD-BD-03) وعرض سعر
-- العميل (FRM-024) في app/pricing.mjs، ونسخة العرض على الصفقة واعتمادها والاتفاق في app/commercial.mjs. فكان:
--   (أ) approve_quote وregister_contract لا يقرآن الهامش المستهدف ولا استثناءه: عرضٌ بهامش دون المستهدف يُعتمد ويُتعاقد عليه
--       بقرار المدير المباشر وحده، ولا يمر بالرئيس التنفيذي الذي يملك MOD-BD-03.
--   (ب) الاتفاق يُسجَّل على نسخة عرض يكتبها صاحب الصفقة، لا على عرض السعر الذي صدر للعميل وقبله؛ فقد يختلف مبلغ الاتفاق عمّا
--       وافق عليه العميل بلا أن يلاحظ أحد.
--   (ج) «ملف تسعير المشروع المعتمد ماليًا» في استلام المشروع يقبل أي ورقة معتمدة للعميل، ولو كانت ورقة صفقة أخرى له.
--   (د) سجل العقود (الترحيل 057) لا يعرف اتفاق الصفقة، فإنهاء العقد فيه لا يوقف شيئًا: يُسلَّم ويُستحق ويُفوتر على عقد منتهٍ.
--
-- القرار D2: عرض سعر العميل (FRM-024) هو المستند المُلزِم. فهذا الترحيل:
--   (1) commercial_quote_proposals: كل نسخة عرض على الصفقة تُربط بنسخة عرض سعر العميل التي تساويها: لعميل الصفقة نفسه، على
--       ورقة تسعير معتمدة لهذه الصفقة (ورقة بلا فرصة أو بفرصة الصفقة نفسها)، بالريال، وبالإجمالي نفسه شاملًا الضريبة وبنسبتها.
--       وعرض السعر الواحد لصفقة واحدة.
--   (2) commercial_contract_proposals: الاتفاق يُسجَّل على عرض السعر المقبول من العميل، بنسخته الحالية نفسها المربوطة بالعرض،
--       وبقراءة الهامش ساعتها: هامش دون المستهدف لا يمر إلا باستثناء معتمد لورقته يغطي الهامش، وكان ساريًا يوم صدر العرض للعميل.
--       والصفقة لا تصير «متعاقدًا عليها» إلا على هذا الربط (الطبقة الأخيرة بعد الكود).
--   (3) contract_records.commercial_contract_id: سجل العقد يشير إلى اتفاق الصفقة مرة واحدة (فريد)، لعميلها، ولا يتبدل بعد السريان.
--   (4) إنهاء العقد في السجل يوقف ما بعده: لا استحقاق جديد، ولا مخرج يُقدَّم، ولا طلب تغيير، ولا جدولة فوترة تُنشأ أو تُستأنف.
--   (5) قبول المخرج يسمّي ممثل العميل من سجل مفوّضي المشروع (client_approvers، الترحيل 023) ساريًا يوم القبول — السجل نفسه الذي
--       تسمّي منه شهادة الإنجاز ممثلها (الترحيل 164) — لا اسمًا يُكتب.
--
-- لا ملء لصفوف قائمة: العروض والاتفاقات المسجّلة قبل اليوم تبقى بلا ربط كما هي، ولا يُنسب لها عرض سعر لم يربطه أحد. ما كان منها
-- معلقًا (عرض بانتظار الاعتماد أو معتمد بلا اتفاق) يُحفظ بنسخة مربوطة قبل أن يُعتمد أو يُتعاقد عليه.
-- جداول جديدة وأعمدة تُضاف (ADD COLUMN)، فلا إعادة بناء ولا نسخ صفوف؛ والمُطلِقات على الإدراج والتحديث لا تعيد قراءة صف قائم.

/* ───── (1) نسخة عرض الصفقة ونسخة عرض سعر العميل التي تساويها ───── */
CREATE TABLE commercial_quote_proposals (
  quote_id TEXT PRIMARY KEY REFERENCES commercial_quotes(id),
  case_id TEXT NOT NULL REFERENCES commercial_cases(id),
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  quotation_id TEXT NOT NULL REFERENCES client_quotations(id),
  quotation_version_id TEXT NOT NULL REFERENCES quotation_versions(id),
  sheet_id TEXT NOT NULL REFERENCES pricing_sheets(id),
  quote_total_minor INTEGER NOT NULL CHECK(quote_total_minor>0),
  quotation_total_minor INTEGER NOT NULL CHECK(quotation_total_minor>0),
  vat_rate_bp INTEGER NOT NULL CHECK(vat_rate_bp BETWEEN 0 AND 10000),
  bound_by TEXT NOT NULL,
  bound_at TEXT NOT NULL,
  FOREIGN KEY(bound_by,tenant_id) REFERENCES users(id,tenant_id),
  CHECK(quote_total_minor=quotation_total_minor)
) STRICT;
CREATE INDEX commercial_quote_proposals_case ON commercial_quote_proposals(case_id);
CREATE INDEX commercial_quote_proposals_quotation ON commercial_quote_proposals(quotation_id,case_id);

-- الربط صحيح عند كتابته: النسخة من عرض السعر نفسه، والعرض لعميل الصفقة وفي كيانها وغير مرفوض، وورقته معتمدة ولهذه الصفقة،
-- وإجمالي نسخة عرض الصفقة يساوي إجمالي نسخة عرض السعر، وكل بند فيها بنسبة ضريبة العرض. وعرض السعر لصفقة واحدة.
CREATE TRIGGER commercial_quote_proposals_bound BEFORE INSERT ON commercial_quote_proposals
WHEN NOT EXISTS(
    SELECT 1 FROM commercial_quotes q
    JOIN commercial_cases c ON c.id=q.case_id
    JOIN client_quotations x ON x.id=NEW.quotation_id
    JOIN quotation_versions v ON v.id=NEW.quotation_version_id AND v.quotation_id=x.id
    JOIN pricing_sheets s ON s.id=x.sheet_id
    WHERE q.id=NEW.quote_id AND c.id=NEW.case_id AND c.tenant_id=NEW.tenant_id
      AND x.tenant_id=c.tenant_id AND x.client_id=c.client_id AND x.status<>'rejected'
      AND s.id=NEW.sheet_id AND s.status='approved' AND (s.opportunity_id IS NULL OR s.opportunity_id IS c.opportunity_id)
      AND json_extract(q.snapshot,'$.currency')='SAR'
      AND CAST(json_extract(q.snapshot,'$.total_minor') AS INTEGER)=NEW.quote_total_minor
      AND CAST(json_extract(v.snapshot,'$.grand_total_minor') AS INTEGER)=NEW.quotation_total_minor
      AND CAST(json_extract(v.snapshot,'$.vat_rate_bp') AS INTEGER)=NEW.vat_rate_bp
      AND NOT EXISTS(SELECT 1 FROM json_each(q.snapshot,'$.lines') l WHERE CAST(json_extract(l.value,'$.tax_basis_points') AS INTEGER)<>NEW.vat_rate_bp))
  OR EXISTS(SELECT 1 FROM commercial_quote_proposals p WHERE p.quotation_id=NEW.quotation_id AND p.case_id<>NEW.case_id)
BEGIN SELECT RAISE(ABORT,'a deal quote is bound to a FRM-024 client quotation version of its own customer and deal, equal to its total and tax rate; a client quotation binds one deal'); END;
CREATE TRIGGER commercial_quote_proposals_fixed BEFORE UPDATE ON commercial_quote_proposals
BEGIN SELECT RAISE(ABORT,'a quote binding is fixed; a new quote revision is bound anew'); END;
CREATE TRIGGER commercial_quote_proposals_no_delete BEFORE DELETE ON commercial_quote_proposals
BEGIN SELECT RAISE(ABORT,'quote bindings are retained'); END;

/* ───── (2) الاتفاق على عرض السعر المقبول، وقراءة الهامش ساعتها ───── */
CREATE TABLE commercial_contract_proposals (
  contract_id TEXT PRIMARY KEY REFERENCES commercial_contracts(id),
  case_id TEXT NOT NULL UNIQUE REFERENCES commercial_cases(id),
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  quote_id TEXT NOT NULL REFERENCES commercial_quotes(id),
  quotation_id TEXT NOT NULL UNIQUE REFERENCES client_quotations(id),
  quotation_version_id TEXT NOT NULL REFERENCES quotation_versions(id),
  sheet_id TEXT NOT NULL REFERENCES pricing_sheets(id),
  target_margin_bp INTEGER NOT NULL CHECK(target_margin_bp BETWEEN 0 AND 9999),
  net_margin_bp INTEGER NOT NULL CHECK(net_margin_bp BETWEEN -10000 AND 10000),
  margin_exception_id TEXT REFERENCES margin_exceptions(id),
  bound_by TEXT NOT NULL,
  bound_at TEXT NOT NULL,
  FOREIGN KEY(bound_by,tenant_id) REFERENCES users(id,tenant_id),
  -- هامش دون المستهدف لا يُتعاقد عليه بلا استثناء يسمّيه.
  CHECK(net_margin_bp>=target_margin_bp OR margin_exception_id IS NOT NULL)
) STRICT;

-- الاتفاق على العرض الذي ربطته نسخة الصفقة، والعرض مقبول من العميل ونسخته الحالية هي المربوطة، والأرقام من النسخة نفسها؛
-- والاستثناء — إن لزم — لورقة العرض، معتمد، يغطي الهامش، وكان ساريًا يوم صدر العرض للعميل (يوم الرياض).
CREATE TRIGGER commercial_contract_proposals_bound BEFORE INSERT ON commercial_contract_proposals
WHEN NOT EXISTS(
    SELECT 1 FROM commercial_contracts k
    JOIN commercial_cases c ON c.id=k.case_id
    JOIN commercial_quote_proposals p ON p.quote_id=k.quote_id
    JOIN client_quotations x ON x.id=p.quotation_id
    JOIN quotation_versions v ON v.id=p.quotation_version_id
    WHERE k.id=NEW.contract_id AND c.id=NEW.case_id AND c.tenant_id=NEW.tenant_id AND k.quote_id=NEW.quote_id
      AND p.quotation_id=NEW.quotation_id AND p.quotation_version_id=NEW.quotation_version_id AND p.sheet_id=NEW.sheet_id
      AND x.status='accepted' AND x.outcome='won' AND x.current_version_id=NEW.quotation_version_id
      AND CAST(json_extract(v.snapshot,'$.target_margin_bp') AS INTEGER)=NEW.target_margin_bp
      AND CAST(json_extract(v.snapshot,'$.net_margin_bp') AS INTEGER)=NEW.net_margin_bp
      AND (NEW.net_margin_bp>=NEW.target_margin_bp OR EXISTS(SELECT 1 FROM margin_exceptions e
        WHERE e.id=NEW.margin_exception_id AND e.sheet_id=NEW.sheet_id AND e.tenant_id=NEW.tenant_id AND e.status='approved'
          AND e.requested_margin_bp<=NEW.net_margin_bp AND e.expires_on>=date(x.issued_at,'+3 hours'))))
BEGIN SELECT RAISE(ABORT,'a contract is registered on the accepted FRM-024 client quotation bound to its quote, within margin authority'); END;
CREATE TRIGGER commercial_contract_proposals_fixed BEFORE UPDATE ON commercial_contract_proposals
BEGIN SELECT RAISE(ABORT,'a contract binding is fixed'); END;
CREATE TRIGGER commercial_contract_proposals_no_delete BEFORE DELETE ON commercial_contract_proposals
BEGIN SELECT RAISE(ABORT,'contract bindings are retained'); END;

-- الطبقة الأخيرة: الصفقة لا تصير «متعاقدًا عليها» بلا اتفاق مربوط بعرض سعر مقبول، مهما كان الكاتب.
CREATE TRIGGER commercial_cases_contract_bound BEFORE UPDATE OF status ON commercial_cases
WHEN NEW.status='contracted' AND OLD.status<>'contracted'
  AND NOT EXISTS(SELECT 1 FROM commercial_contracts k JOIN commercial_contract_proposals p ON p.contract_id=k.id WHERE k.case_id=NEW.id)
BEGIN SELECT RAISE(ABORT,'a deal is contracted on the accepted FRM-024 client quotation bound to its quote'); END;

/* ───── (3) سجل العقد يشير إلى اتفاق الصفقة مرة ───── */
ALTER TABLE contract_records ADD COLUMN commercial_contract_id TEXT REFERENCES commercial_contracts(id);
CREATE UNIQUE INDEX contract_records_commercial_contract ON contract_records(commercial_contract_id) WHERE commercial_contract_id IS NOT NULL;
-- الإشارة لعقد عميل، إلى اتفاق صفقةٍ لهذا العميل في كيانه.
CREATE TRIGGER contract_records_commercial_link BEFORE INSERT ON contract_records
WHEN NEW.commercial_contract_id IS NOT NULL AND NOT EXISTS(
  SELECT 1 FROM commercial_contracts k JOIN commercial_cases c ON c.id=k.case_id
  WHERE k.id=NEW.commercial_contract_id AND c.tenant_id=NEW.tenant_id AND NEW.party_kind='client' AND c.client_id=NEW.client_id)
BEGIN SELECT RAISE(ABORT,'a contract record points at the deal agreement of its own client, inside its tenant'); END;
-- وتبقى صحيحة مع كل تصحيح للمسودة، وتثبت بعد السريان.
CREATE TRIGGER contract_records_commercial_link_update BEFORE UPDATE ON contract_records
WHEN (OLD.status<>'draft' AND NEW.commercial_contract_id IS NOT OLD.commercial_contract_id)
  OR (NEW.commercial_contract_id IS NOT NULL AND NOT EXISTS(
    SELECT 1 FROM commercial_contracts k JOIN commercial_cases c ON c.id=k.case_id
    WHERE k.id=NEW.commercial_contract_id AND c.tenant_id=NEW.tenant_id AND NEW.party_kind='client' AND c.client_id=NEW.client_id))
BEGIN SELECT RAISE(ABORT,'a contract record keeps its deal agreement once in force, and only of its own client'); END;

/* ───── (4) العقد المنهى يوقف ما بعده ───── */
CREATE TRIGGER ar_claims_contract_terminated BEFORE INSERT ON ar_claims
WHEN EXISTS(SELECT 1 FROM contract_records r WHERE r.commercial_contract_id=NEW.contract_id AND r.status='terminated')
BEGIN SELECT RAISE(ABORT,'no new entitlement on a terminated contract'); END;
CREATE TRIGGER commercial_deliveries_contract_terminated BEFORE INSERT ON commercial_deliveries
WHEN EXISTS(SELECT 1 FROM contract_records r WHERE r.commercial_contract_id=NEW.contract_id AND r.status='terminated')
BEGIN SELECT RAISE(ABORT,'no new deliverable on a terminated contract'); END;
CREATE TRIGGER commercial_changes_contract_terminated BEFORE INSERT ON commercial_changes
WHEN EXISTS(SELECT 1 FROM contract_records r WHERE r.commercial_contract_id=NEW.contract_id AND r.status='terminated')
BEGIN SELECT RAISE(ABORT,'no new change request on a terminated contract'); END;
CREATE TRIGGER billing_schedules_contract_terminated BEFORE INSERT ON billing_schedules
WHEN NEW.case_id IS NOT NULL AND EXISTS(SELECT 1 FROM commercial_contracts k JOIN contract_records r ON r.commercial_contract_id=k.id
  WHERE k.case_id=NEW.case_id AND r.status='terminated')
BEGIN SELECT RAISE(ABORT,'no billing schedule on a terminated contract'); END;
CREATE TRIGGER billing_schedules_contract_terminated_resume BEFORE UPDATE OF status ON billing_schedules
WHEN NEW.status='active' AND OLD.status<>'active' AND NEW.case_id IS NOT NULL AND EXISTS(SELECT 1 FROM commercial_contracts k JOIN contract_records r ON r.commercial_contract_id=k.id
  WHERE k.case_id=NEW.case_id AND r.status='terminated')
BEGIN SELECT RAISE(ABORT,'a billing schedule of a terminated contract is not resumed'); END;

/* ───── (5) قبول المخرج يسمّي ممثل العميل من سجل مفوّضي المشروع ───── */
-- «ساريًا يوم القبول» بيوم الرياض من لحظة القرار التي يكتبها الكود (decided_at)، لا من ساعة القاعدة: لا ساعة في SQL.
CREATE TRIGGER commercial_reviews_delivery_approver BEFORE UPDATE ON commercial_reviews
WHEN OLD.status='pending' AND NEW.status='approved' AND NEW.kind='delivery' AND NOT EXISTS(
  SELECT 1 FROM commercial_cases c JOIN client_approvers a ON a.project_id=c.project_id AND a.tenant_id=c.tenant_id
  WHERE c.id=NEW.case_id AND a.id=json_extract(NEW.evidence_json,'$.approver_id')
    AND a.valid_from<=date(NEW.decided_at,'+3 hours') AND (a.revoked_on IS NULL OR a.revoked_on>date(NEW.decided_at,'+3 hours')))
BEGIN SELECT RAISE(ABORT,'a deliverable is accepted naming a registered client approver of its project, active that day'); END;
