// قاعدة تجريبية عند الترحيل 170 — قبل إعادة بناء commercial_cases في الترحيل 180 — وفيها صفوف في **كل** جدول يحيل
// إلى commercial_cases (التسعة عشر جدولًا)، وصفوف في عدد من أحفادها. كل الأسماء والأرقام مصطنعة وموسومة «تجريبي».
//
// لماذا SQL مباشر لا مسارات المنصة: القاعدة تُبنى عند 170، والكود في هذه الشجرة يكتب أعمدة 180 وما بعده. والترحيلات
// تُطبَّق هنا بالمشغّل نفسه (معاملة لكل ملف، وبصمته في schema_migrations)، فيكمل openDb من 180 كما يكمله على قاعدة حية.
// الصفوف تحترم كل قيد ومُطلِق في المخطط عند 170 (المفاتيح الأجنبية تعمل طوال البناء)، فما يقيسه الاختبار هو أثر الترحيل وحده.
//
// المستعمل: tests/migration-180.test.mjs وscripts/crm-rebuild-parity.mjs --synthetic.
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { hash, migrationPlan } from '../app/db.mjs';
import { seed } from '../scripts/seed.mjs';

export const PRE_REBUILD_VERSION = 170;
const STAMP = '2026-09-20T09:00:00.000Z', DAY = '2026-09-20';
const MIGRATIONS = new URL('../app/migrations/', import.meta.url);

// المشغّل كما في app/db.mjs: المخطط بصمته 1، ثم كل ترحيل حتى الحد في معاملة، وبصمته في schema_migrations.
export function migrateTo(db, maxVersion) {
  db.exec('PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON;');
  db.exec('CREATE TABLE IF NOT EXISTS schema_migrations(version INTEGER PRIMARY KEY, checksum TEXT NOT NULL)');
  if (!db.prepare('SELECT 1 FROM schema_migrations WHERE version=1').get()) {
    const schema = readFileSync(new URL('../app/schema.sql', import.meta.url), 'utf8');
    db.exec('BEGIN IMMEDIATE'); db.exec(schema); db.prepare('INSERT INTO schema_migrations VALUES(1,?)').run(hash(schema)); db.exec('COMMIT');
  }
  for (const { version, file } of migrationPlan(readdirSync(MIGRATIONS))) {
    if (version > maxVersion) break;
    if (db.prepare('SELECT 1 FROM schema_migrations WHERE version=?').get(version)) continue;
    const sql = readFileSync(new URL(file, MIGRATIONS), 'utf8');
    db.exec('BEGIN IMMEDIATE');
    try { db.exec(sql); db.prepare('INSERT INTO schema_migrations VALUES(?,?)').run(version, hash(sql)); db.exec('COMMIT'); }
    catch (error) { db.exec('ROLLBACK'); throw error; }
  }
}

const json = value => JSON.stringify(value);
const quoteSnapshot = (scope, lines) => ({ scope, currency: 'SAR', valid_until: '2099-12-01', lines, net_minor: '100000', tax_minor: '15000', total_minor: '115000', cost_minor: '40000', margin_minor: '60000', rounding: 'per-line-half-up' });
const LINE = { description: 'مخرج تجريبي أول', quantity: '1', unit_price_minor: '100000', unit_cost_minor: '40000', discount_minor: '0', tax_basis_points: '1500', net_minor: '100000', tax_minor: '15000', total_minor: '115000', cost_minor: '40000', acceptance: 'قبول تجريبي بدليل مكتوب', revisions: 2 };

// يبني القاعدة في المسار المعطى ويعيد معرّفات ما زرعه. الجداول التسعة عشر الأبناء كلها فيها صف واحد على الأقل.
export function buildPre180(path) {
  const db = new DatabaseSync(path);
  migrateTo(db, PRE_REBUILD_VERSION);
  seed(db, 'synthetic-crm-rebuild-180');
  const run = (sql, ...values) => db.prepare(sql).run(...values);
  db.exec('BEGIN IMMEDIATE');
  try {
    // عميلان في الكيان 36t: الأول له صفقة واحدة مربوطة (فينتقل رقم سجلها إليه)، والثاني له صفقتان برقمين مختلفين (فيبقى بلا رقم).
    for (const [id, code, name] of [['syn-client-1', 'C-7181', 'عميل تجريبي أول للترحيل 180'], ['syn-client-2', 'C-7182', 'عميل تجريبي ثانٍ للترحيل 180']])
      run("INSERT INTO clients(id,tenant_id,code,legal_name,trade_name,sector,status,owner_id,notes,created_at,updated_at) VALUES(?,'36t',?,?,'','قطاع تجريبي','active','employee','',?,?)", id, code, name, STAMP, STAMP);
    run("INSERT INTO projects(id,tenant_id,name,brief,created_by,created_at) VALUES('syn-project-a','36t','مشروع تجريبي للصفقة أ','موجز تجريبي للصفقة أ','manager',?)", STAMP);
    run("INSERT INTO project_members VALUES('syn-project-a','manager'),('syn-project-a','employee')");
    // خمس صفقات: أ قائمة بمشروع، ب وج لعميل واحد برقمين، د قديمة بلا ربط، هـ في الكيان المعزول بالرقم نفسه للصفقة أ.
    const kase = (id, tenant, dept, owner, name, reg, status, project = null) =>
      run('INSERT INTO commercial_cases(id,tenant_id,department_id,owner_id,name,registration_number,contact,source,sector,status,project_id,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)',
        id, tenant, dept, owner, name, reg, 'جهة اتصال تجريبية', 'مصدر تجريبي', 'قطاع تجريبي', status, project, STAMP, STAMP);
    kase('syn-case-a', '36t', 'creative', 'employee', 'عميل تجريبي أول للترحيل 180', 'SYN-7180-A', 'project_active', 'syn-project-a');
    kase('syn-case-b', '36t', 'creative', 'employee', 'عميل تجريبي ثانٍ للترحيل 180', 'SYN-7180-B', 'quote_approved');
    kase('syn-case-c', '36t', 'creative', 'employee', 'عميل تجريبي ثانٍ — نطاق ثانٍ', 'SYN-7180-C', 'lead');
    kase('syn-case-d', '36t', 'creative', 'employee', 'صفقة تجريبية قديمة بلا ملف عميل', 'SYN-7180-D', 'lead');
    kase('syn-case-e', 'isolated', 'other', 'external', 'صفقة تجريبية في الكيان المعزول', 'SYN-7180-A', 'lead');
    run("INSERT INTO client_links VALUES('syn-client-1','syn-case-a','employee',?),('syn-client-2','syn-case-b','employee',?),('syn-client-2','syn-case-c','employee',?)", STAMP, STAMP, STAMP);

    // التأهيل والعرض والمراجعات: تُدرج المراجعة معلّقة ثم تُقرَّر، كما يفرض مُطلِقا 004.
    for (const c of ['syn-case-a', 'syn-case-b']) {
      run('INSERT INTO commercial_qualifications VALUES(?,?,1,?,?,?)', `${c}-q`, c, json({ need: 'احتياج تجريبي', budget_minor: '100000', currency: 'SAR', timing: '2099-12-01', decision_maker: 'صاحب قرار تجريبي', service_fit: 'ملاءمة تجريبية' }), 'employee', STAMP);
      const snapshot = json(quoteSnapshot('نطاق تجريبي للعرض', [LINE]));
      run('INSERT INTO commercial_quotes VALUES(?,?,?,1,?,?,?,?)', `${c}-quote`, c, `${c}-q`, snapshot, hash(snapshot), 'employee', STAMP);
      for (const [kind, subject] of [['qualification', `${c}-q`], ['quote', `${c}-quote`]]) {
        run('INSERT INTO commercial_reviews(id,case_id,kind,subject_id,requested_by,approver_id,requested_at) VALUES(?,?,?,?,?,?,?)', `${subject}-review`, c, kind, subject, 'employee', 'manager', STAMP);
        run("UPDATE commercial_reviews SET status='approved',note='اعتماد تجريبي',decided_at=? WHERE id=?", STAMP, `${subject}-review`);
      }
    }
    const contract = json({ ...quoteSnapshot('نطاق تجريبي للعرض', [LINE]), quote_id: 'syn-case-a-quote', quote_revision: 1, client_name: 'عميل تجريبي أول للترحيل 180', registration_number: 'SYN-7180-A', internal_only: true });
    run('INSERT INTO commercial_contracts VALUES(?,?,?,?,?,?,?,?)', 'syn-contract-a', 'syn-case-a', 'syn-case-a-quote', contract, 'محضر اتفاق تجريبي محفوظ', 'ممثل عميل تجريبي', 'employee', STAMP);
    run('INSERT INTO commercial_project_baselines VALUES(?,?,?,?,?,?)', 'syn-project-a', 'syn-case-a', 'syn-contract-a', 'syn-case-a-quote', contract, STAMP);
    run("UPDATE commercial_cases SET current_qualification_id='syn-case-a-q',current_quote_id='syn-case-a-quote',version=version+1 WHERE id='syn-case-a'");
    run("UPDATE commercial_cases SET current_qualification_id='syn-case-b-q',current_quote_id='syn-case-b-quote',version=version+1 WHERE id='syn-case-b'");
    run('INSERT INTO commercial_deliveries VALUES(?,?,?,0,1,?,?,?)', 'syn-delivery-a', 'syn-case-a', 'syn-contract-a', 'دليل مخرج تجريبي مكتوب', 'employee', STAMP);
    run('INSERT INTO commercial_reviews(id,case_id,kind,subject_id,requested_by,approver_id,requested_at) VALUES(?,?,?,?,?,?,?)', 'syn-delivery-a-review', 'syn-case-a', 'delivery', 'syn-delivery-a', 'employee', 'manager', STAMP);
    run("UPDATE commercial_reviews SET status='approved',note='قبول تجريبي',evidence_json=?,decided_at=? WHERE id='syn-delivery-a-review'", json({ acceptance_evidence: 'محضر قبول تجريبي', customer_representative: 'ممثل عميل تجريبي', internal_only: true }), STAMP);
    run('INSERT INTO commercial_changes VALUES(?,?,?,?,?,?)', 'syn-change-a', 'syn-case-a', 'syn-contract-a', json({ scope: 'تغيير تجريبي', currency: 'SAR', additional_price_minor: '1000', additional_cost_minor: '300', margin_delta_minor: '700', extra_days: 1, due_date: '2099-12-02', acceptance: 'قبول تجريبي', baseline_quote_id: 'syn-case-a-quote' }), 'employee', STAMP);
    run('INSERT INTO commercial_reviews(id,case_id,kind,subject_id,requested_by,approver_id,requested_at) VALUES(?,?,?,?,?,?,?)', 'syn-change-a-review', 'syn-case-a', 'change', 'syn-change-a', 'employee', 'manager', STAMP);
    run("UPDATE commercial_reviews SET status='approved',note='اعتماد تغيير تجريبي',decided_at=? WHERE id='syn-change-a-review'", STAMP);
    run("INSERT INTO tasks(id,project_id,title,assignee_id,due_date,acceptance,created_at) VALUES('syn-task-a','syn-project-a','مهمة تغيير تجريبية','employee','2099-12-02','قبول تجريبي',?)", STAMP);
    run("INSERT INTO commercial_change_tasks VALUES('syn-change-a','syn-task-a',?)", STAMP);

    // محاور المشروع والذمم والفوترة على الصفقة أ.
    run("INSERT INTO case_payment_terms(id,tenant_id,case_id,position,label,amount_minor,currency,due_on,condition,is_advance,recorded_by,recorded_at,requires_client_po) VALUES('syn-term-a1','36t','syn-case-a',0,'دفعة تجريبية كاملة',115000,'SAR','2099-12-01','',0,'employee',?,1)", STAMP);
    run("INSERT INTO client_purchase_orders(id,tenant_id,case_id,contract_id,project_id,client_id,revision,po_number,issued_on,valid_until,scope,currency,amount_minor,customer_representative,evidence,status,recorded_by,recorded_at) VALUES('syn-po-a','36t','syn-case-a','syn-contract-a','syn-project-a','syn-client-1',1,'PO-SYN-7180',?,'2099-12-31','نطاق أمر شراء تجريبي مكتوب','SAR',115000,'ممثل عميل تجريبي','نسخة أمر شراء تجريبية محفوظة','recorded','employee',?)", DAY, STAMP);
    run("INSERT INTO ar_claims(id,tenant_id,contract_id,project_id,case_id,prepared_by,basis,delivery_id,advance_clause,source_snapshot,currency,amount_minor,due_date,entitlement_evidence,status,version,revision,created_at,updated_at) VALUES('syn-claim-a','36t','syn-contract-a','syn-project-a','syn-case-a','employee','delivery','syn-delivery-a','',?,'SAR','115000','2099-12-15','محضر قبول تجريبي وبند العقد','draft',1,0,?,?)", json({ delivery_id: 'syn-delivery-a', line_index: 0 }), STAMP, STAMP);
    run("INSERT INTO customer_tax_profiles VALUES('syn-tax-a','36t','syn-case-a','عميل تجريبي أول للترحيل 180',NULL,?,'عقد تجريبي','employee',?)", json({ city: 'الرياض', country: 'SA' }), STAMP);
    run("INSERT INTO einvoice_buyer_overrides VALUES('syn-override-a','36t','syn-case-a',?,'استثناء تجريبي موثق لبيانات المشتري الناقصة','employee',?)", json(['vat_number']), STAMP);
    run("INSERT INTO estimates(id,tenant_id,client_id,kind,code,name,scope_note,rates_on,status,prepared_by,decided_by,decided_at,created_at,updated_at) VALUES('syn-estimate-a','36t','syn-client-1','base','EST-SYN-7180','تقدير تجريبي','نطاق تقدير تجريبي مكتوب',?,'approved','employee','manager',?,?,?)", DAY, STAMP, STAMP, STAMP);
    run("INSERT INTO estimate_handoffs VALUES('syn-estimate-a','syn-case-a','تسليم تجريبي','employee',?)", STAMP);
    run("INSERT INTO client_approvers(id,tenant_id,project_id,name,title,authority_basis,authority_scope,valid_from,recorded_by,created_at) VALUES('syn-approver-a','36t','syn-project-a','ممثل عميل تجريبي','مدير تجريبي','تفويض كتابي تجريبي من العميل','المخرجات كلها',?,'employee',?)", DAY, STAMP);
    const certificateSequence = (db.prepare("SELECT MAX(sequence) AS n FROM completion_certificates WHERE tenant_id='36t'").get().n ?? 0) + 1;
    run("INSERT INTO completion_certificates(id,tenant_id,case_id,project_id,sequence,number,scope_summary,delivery_ids,our_representative,customer_representative,evidence,status,issued_by,issued_at,approver_id,approver_snapshot) VALUES('syn-cert-a','36t','syn-case-a','syn-project-a',?,?,'نطاق تجريبي أُنجز كاملًا للاختبار',?,'مدير الفريق التجريبي','ممثل عميل تجريبي','محضر إنجاز تجريبي محفوظ','issued','manager',?,'syn-approver-a',?)",
      certificateSequence, 'CERT-' + String(certificateSequence).padStart(5, '0'), json(['syn-delivery-a']), STAMP, json({ name: 'ممثل عميل تجريبي', authority_basis: 'تفويض كتابي تجريبي من العميل' }));
    run("INSERT INTO project_closures(id,tenant_id,project_id,case_id,created_at,updated_at) VALUES('syn-closure-a','36t','syn-project-a','syn-case-a',?,?)", STAMP, STAMP);
    run("INSERT INTO billing_schedules(id,tenant_id,client_id,case_id,title,cadence,issue_day,lines,currency,total_minor,contract_reference,start_date,status,owner_id,created_by,created_at,updated_at) VALUES('syn-schedule-a','36t','syn-client-1','syn-case-a','جدول فوترة تجريبي','monthly',5,?,'SAR',115000,'عقد تجريبي رقم 7180',?,'active','employee','employee',?,?)", json([{ description: 'بند تجريبي', amount_minor: 115000 }]), DAY, STAMP, STAMP);
    run("INSERT INTO advance_invoices(id,tenant_id,client_id,description,agreement_reference,currency,amount_minor,status,recorded_by,created_at,updated_at,case_id,project_id) VALUES('syn-advance-a','36t','syn-client-1','دفعة مقدمة تجريبية','عقد تجريبي رقم 7180','SAR',10000,'recorded','employee',?,?,'syn-case-a','syn-project-a')", STAMP, STAMP);
    run("INSERT INTO ar_account_receipts(id,tenant_id,case_id,reference,currency,amount_minor,received_on,payer,evidence,recorded_by,status,created_at) VALUES('syn-account-a','36t','syn-case-a','ACC-SYN-7180','SAR','5000',?,'دافع تجريبي','إشعار تحويل تجريبي محفوظ','employee','pending',?)", DAY, STAMP);
    db.exec('COMMIT');
  } catch (error) { db.exec('ROLLBACK'); db.close(); throw error; }
  db.close();
  return { cases: ['syn-case-a', 'syn-case-b', 'syn-case-c', 'syn-case-d', 'syn-case-e'], clients: ['syn-client-1', 'syn-client-2'] };
}
