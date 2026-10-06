// الترحيل 175 (الحزمة 4، P4-HR-4): إعادة بناء payroll_runs بحالة «منعكس» دون أن يسقط صفٌّ أو يتغيّر في أي جدول يحيل إليه،
// ومستند العكس، وتحويل المسير، ورفع ملف الأجور مرة واحدة.
// القاعدة التجريبية تُبنى بـSQL مباشر قبل 175 (الكود في هذه الشجرة يكتب أعمدة 175 فلا يُستعمل لبنائها)، وفيها صفوف في الجداول الستة
// التي تحيل إلى payroll_runs وفي أحفادها: سطور وقسيمة اطُّلع عليها، وحركات وسندها، ودفعات منفذة وملغاة، وأثر رجعي، وردّ خصم إجازة
// انلغت بإجازتها وتقويمها ورصيدها، وتصديرات ملف أجور مرفوع وغير مرفوع. كل اسم ومبلغ ومرجع مصطنع.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import { openDb, verifyAudit, hash, migrationPlan } from '../app/db.mjs';
import { seed } from '../scripts/seed.mjs';
import { migrateTo } from './crm-rebuild-fixture.mjs';
import { chainOf, snapshot } from '../scripts/crm-rebuild-parity.mjs';

const S='2026-09-20T09:00:00.000Z';
const MIGRATIONS=new URL('../app/migrations/',import.meta.url);
// late: كل الترحيلات إلا 174 و175 — حال قاعدة تشغيل وصلها ترحيل أعلى قبلهما، فيُطبَّقان آخرًا («الرقم الناقص يُطبَّق ولو تحت الأعلى»).
function migrateAllBut(db,skip){
  db.exec('PRAGMA foreign_keys=ON;');
  migrateTo(db,1);
  for(const {version,file} of migrationPlan(readdirSync(MIGRATIONS))){
    if(skip.includes(version)||db.prepare('SELECT 1 FROM schema_migrations WHERE version=?').get(version))continue;
    const sql=readFileSync(new URL(file,MIGRATIONS),'utf8');
    db.exec('BEGIN IMMEDIATE');
    try{db.exec(sql);db.prepare('INSERT INTO schema_migrations VALUES(?,?)').run(version,hash(sql));db.exec('COMMIT');}catch(error){db.exec('ROLLBACK');throw error;}
  }
}
function build(t,{late=false,twoUploads=false}={}){
  const dir=mkdtempSync(join(tmpdir(),'36t-migration-175-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
  const path=join(dir,'pre175.sqlite'),db=new DatabaseSync(path);
  if(late)migrateAllBut(db,[174,175]);else migrateTo(db,174);
  seed(db,'synthetic-migration-175');
  const run=(sql,...values)=>db.prepare(sql).run(...values);
  db.exec('BEGIN IMMEDIATE');
  try{
    run("INSERT INTO hr_policies(id,tenant_id,kind,title,body,parameters,basis,effective_from,status,prepared_by,decided_by,decided_at,created_at) VALUES('syn-pol','36t','payroll_cycle','دورة تجريبية','نص سياسة دورة رواتب تجريبي كافٍ الطول','{}','قرار تجريبي','2026-01-01','accepted','hr','manager',?,?)",S,S);
    for(const who of ['employee','outsider'])
      run("INSERT INTO employment_contracts(id,tenant_id,user_id,policy_id,contract_type,job_title,work_location,start_date,weekly_hours,probation_days,notice_days,pay_lines,monthly_total_minor,currency,document_reference,status,prepared_by,created_at,updated_at) VALUES(?,'36t',?,'syn-pol','indefinite','وظيفة تجريبية','الرياض','2026-01-01',40,90,60,'[]',1000000,'SAR','عقد تجريبي','draft','hr',?,?)",`syn-con-${who}`,who,S,S);
    const runRow=(id,month,status)=>{
      run("INSERT INTO payroll_runs(id,tenant_id,month,cycle_policy_id,status,headcount,gross_minor,deductions_minor,net_minor,prepared_by,created_at,updated_at) VALUES(?,'36t',?,'syn-pol','draft',2,2030000,50000,1980000,'hr',?,?)",id,month,S,S);
      for(const who of ['employee','outsider']){
        const additions=who==='outsider'?30000:0,other=who==='employee'?50000:0;
        run("INSERT INTO payroll_lines(id,run_id,user_id,contract_id,paid_fraction_bp,earnings,gross_minor,unpaid_absence_minor,social_insurance_minor,net_minor,variance_flag,basis,additions_minor,other_deductions_minor) VALUES(?,?,?,?,10000,'[]',1000000,0,0,?,0,'{}',?,?)",
          `${id}-${who}`,id,who,`syn-con-${who}`,1000000+additions-other,additions,other);
      }
      if(status==='draft')return;
      if(status==='cancelled'){run("UPDATE payroll_runs SET status='cancelled',version=version+1 WHERE id=?",id);return;}
      run("UPDATE payroll_runs SET status='in_review',version=version+1 WHERE id=?",id);
      run("UPDATE payroll_runs SET status='reviewed',reviewed_by='it',reviewed_at=?,review_note='مراجعة تجريبية',version=version+1 WHERE id=?",S,id);
      run("UPDATE payroll_runs SET status='approved',approved_by='manager',approved_at=?,decision_note='اعتماد تجريبي',version=version+1 WHERE id=?",S,id);
    };
    runRow('syn-run-jun','2026-06','approved');runRow('syn-run-jul','2026-07','approved');runRow('syn-run-aug','2026-08','cancelled');runRow('syn-run-sep','2026-09','draft');
    run("INSERT INTO payslip_views VALUES('syn-view','syn-run-jun-employee','employee',?)",S);
    const adjustment=(id,kind,month,amount,status,runId=null,user='outsider')=>run(`INSERT INTO payroll_adjustments(id,tenant_id,user_id,kind,month,amount_minor,reason,status,proposed_by,decided_by,decided_at,run_id,created_at) VALUES(?,'36t',?,?,?,?,'حركة تجريبية للترحيل 175',?,'hr',${status==='proposed'?'NULL':"'manager'"},${status==='proposed'?'NULL':'?'},?,?)`,
      ...(status==='proposed'?[id,user,kind,month,amount,status,runId,S]:[id,user,kind,month,amount,status,S,runId,S]));
    adjustment('syn-adj-bonus','bonus','2026-06',30000,'approved','syn-run-jun');
    adjustment('syn-adj-leave','deduction','2026-06',50000,'approved','syn-run-jun','employee');
    run("INSERT INTO payroll_deduction_basis(adjustment_id,tenant_id,basis,reference,recorded_by,created_at) VALUES('syn-adj-leave','36t','not_a_deduction','أثر إجازة تجريبية بلا أجر','hr',?)",S);
    adjustment('syn-adj-refund','allowance','2026-07',50000,'proposed',null,'employee');
    adjustment('syn-adj-retro','allowance','2026-08',12000,'proposed',null,'employee');
    // ردّ خصم إجازة انلغت بعد صرف خصمها في مسير يونيو: التقويم والرصيد والطلب الملغى والأثر المسحوب ثم الرد.
    run("INSERT INTO leave_calendars(id,tenant_id,employee_department_id,hr_department_id,name,effective_from,effective_to,weekdays_json,holidays_json,timezone,synthetic,created_at) VALUES('syn-cal','36t','creative','hr','تقويم تجريبي','2026-01-01','2026-12-31','[0,1,2,3,4]','[]','Asia/Riyadh',1,?)",S);
    run("INSERT INTO leave_balances(id,tenant_id,employee_id,leave_type,balance_year,calendar_id,effective_date,created_at) VALUES('syn-bal','36t','employee','unpaid',2026,'syn-cal','2026-01-01',?)",S);
    run("INSERT INTO leave_requests(id,tenant_id,employee_id,balance_id,start_date,end_date,days,work_dates_json,reason,status,created_at,updated_at) VALUES('syn-leave','36t','employee','syn-bal','2026-06-07','2026-06-08',2,'[\"2026-06-07\",\"2026-06-08\"]','إجازة تجريبية','cancelled',?,?)",S,S);
    run("INSERT INTO leave_pay_effects(id,tenant_id,request_id,revision,employee_id,month,dates_json,lost_bp_days,amount_minor,adjustment_id,status,note,created_at) VALUES('syn-effect','36t','syn-leave',1,'employee','2026-06','[\"2026-06-07\",\"2026-06-08\"]',20000,50000,'syn-adj-leave','withdrawn','أثر تجريبي سُحب',?)",S);
    run("INSERT INTO leave_pay_effect_refunds VALUES('syn-effect','36t','syn-adj-leave','syn-run-jun','syn-adj-refund','hr',?)",S);
    run("INSERT INTO payroll_retro VALUES('syn-retro','36t','employee','2026-06','syn-run-jun',12000,'syn-adj-retro','{}','hr',?)",S);
    run("INSERT INTO payroll_payments(id,tenant_id,run_id,amount_minor,headcount,file_digest,status,prepared_by,approved_by,approved_at,executed_on,bank_reference,execution_evidence,execution_recorded_by,version,created_at,updated_at) VALUES('syn-pay-jun','36t','syn-run-jun',1980000,2,'digest','executed','hr','manager',?,'2026-09-21','SYN-BANK-1','إشعار تحويل تجريبي محفوظ','it',3,?,?)",S,S,S);
    run("INSERT INTO payroll_payments(id,tenant_id,run_id,amount_minor,headcount,file_digest,status,prepared_by,decision_note,version,created_at,updated_at) VALUES('syn-pay-jul','36t','syn-run-jul',1980000,2,'digest','cancelled','hr','إلغاء تجريبي',2,?,?)",S,S);
    run("INSERT INTO wps_file_formats(id,tenant_id,bank_name,format_label,revision,layout,delimiter,encoding,line_ending,include_header,columns,spec_source,spec_confirmed_on,status,recorded_by,confirmed_by,confirmed_at,created_at,updated_at) VALUES('syn-fmt','36t','بنك تجريبي','صيغة تجريبية',1,'delimited',',','utf-8','crlf',1,'[{\"name\":\"A\"}]','مصدر مواصفة تجريبي مكتوب','2026-06-01','active','hr','manager',?,?,?)",S,S,S);
    const exported=(id,runId,uploaded,by='it')=>run(`INSERT INTO wps_exports(id,tenant_id,run_id,format_id,month,headcount,total_minor,run_total_minor,file_digest,checks,warning_count,exported_by,created_at,uploaded_on,upload_reference,upload_note,upload_recorded_by,upload_recorded_at) VALUES(?,'36t',?,'syn-fmt','2026-06',2,1980000,1980000,'digest','[]',0,'hr',?,${uploaded?"'2026-09-21','REF-SYN',?,?,?":"NULL,NULL,'',NULL,NULL"})`,
      ...(uploaded?[id,runId,S,'رفع تجريبي موثّق مكتوب',by,S]:[id,runId,S]));
    exported('syn-wps-1','syn-run-jun',true);exported('syn-wps-2','syn-run-jun',twoUploads,'manager');exported('syn-wps-3','syn-run-jul',false);
    db.exec('COMMIT');
  }catch(error){db.exec('ROLLBACK');throw error;}
  const chain=chainOf(db,'payroll_runs');
  const shape=Object.fromEntries(chain.tables.map(table=>[table,db.prepare(`PRAGMA table_info("${table}")`).all().map(c=>c.name)]));
  const before=snapshot(db,chain.tables,shape),objects=db.prepare("SELECT name FROM sqlite_master WHERE type IN ('trigger','index') AND sql IS NOT NULL").all().map(r=>r.name);
  db.close();
  return {path,chain,shape,before,objects};
}

for(const late of [false,true])
  test(`migration 175${late?' applied last, after 193':''}: payroll_runs is rebuilt with every row of every table that references it unchanged — counts and content hashes by rowid identical, integrity ok, no foreign-key violation, audit chain intact`,t=>{
    const {path,chain,shape,before}=build(t,{late});
    const direct=[...new Set(chain.direct.map(e=>e.child))].sort();
    // الترحيل 176 (المسير الموازي، فرعٌ شقيق) أضاف سابعًا: مقارنات الموازي تشير إلى المسير بلا CASCADE، فإعادة البناء آمنة معها.
    const six=['leave_pay_effect_refunds','payroll_adjustments','payroll_lines','payroll_payments','payroll_retro','wps_exports'];
    assert.deepEqual(direct.filter(t=>six.includes(t)),six,'the six rebuilt child tables reference payroll_runs');
    assert.deepEqual(direct.filter(t=>!six.includes(t)),direct.includes('payroll_parallel_comparisons')?['payroll_parallel_comparisons']:[],'no unexpected child beyond the parallel comparisons (176)');
    assert.deepEqual(chain.unsafe,[],'no table in the chain cascades or nulls on delete — the rebuild is safe');
    for(const table of six)assert.ok(before[table].count>0,`${table}: the synthetic database has a row in every child table`);
    const db=openDb(path);t.after(()=>db.close());
    assert.ok(db.prepare('SELECT 1 FROM schema_migrations WHERE version=175').get()&&db.prepare('SELECT 1 FROM schema_migrations WHERE version=174').get());
    assert.deepEqual(snapshot(db,chain.tables,shape),before,'every row of every table in the chain keeps every value');
    assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check,'ok');
    assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);
    assert.equal(verifyAudit(db),true);
    assert.match(db.prepare("SELECT sql FROM sqlite_master WHERE name='payroll_runs'").get().sql,/'reversed'/);
    assert.match(db.prepare("SELECT sql FROM sqlite_master WHERE name='payroll_runs_one_live'").get().sql,/NOT IN \('cancelled','reversed'\)/);
    for(const name of ['payroll_runs_locked','payroll_runs_no_delete','payroll_adjustments_fixed','payroll_run_reversals_shape','payroll_run_reversals_before_payment','payroll_run_reversals_decided','payroll_payments_executor','payroll_payments_live_run','wps_exports_fixed','wps_exports_one_upload','wps_exports_from_payment','wps_exports_upload_live'])
      assert.ok(db.prepare('SELECT 1 FROM sqlite_master WHERE name=?').get(name),`${name} exists`);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM wps_exports WHERE payment_id IS NOT NULL').get().n,0,'exports made before 175 keep no transfer link they never had');
  });

test('migration 175: an approved run is reversed only through an approved reversal made before any executed transfer or recorded upload; its adjustments free up and the month opens for a corrected run',t=>{
  const {path}=build(t);
  const db=openDb(path);t.after(()=>db.close());
  const reversal=(id,runId,month='2026-07')=>db.prepare("INSERT INTO payroll_run_reversals(id,tenant_id,run_id,month,net_minor,reason,status,requested_by,requested_at) VALUES(?,'36t',?,?,1980000,'خطأ تجريبي قبل الصرف في المسير','requested','hr',?)").run(id,runId,month,S);
  assert.throws(()=>reversal('syn-rev-jun','syn-run-jun','2026-06'),/before any transfer/,'June was paid and uploaded');
  assert.throws(()=>reversal('syn-rev-bad','syn-run-jul','2026-08'),/its month and net/,'the reversal copies the run as it is');
  assert.throws(()=>db.prepare("UPDATE payroll_runs SET status='reversed',version=version+1 WHERE id='syn-run-jul'").run(),/locked/,'no reversed status without an approved reversal');
  reversal('syn-rev-jul','syn-run-jul');
  assert.throws(()=>db.prepare("UPDATE payroll_run_reversals SET status='approved',decided_by='hr',decided_at=?,decision_note='اعتماد ذاتي تجريبي',reversed_on='2026-09-21',version=version+1 WHERE id='syn-rev-jul'").run(S),/CHECK/);
  db.prepare("UPDATE payroll_run_reversals SET status='approved',decided_by='manager',decided_at=?,decision_note='اعتماد تجريبي للعكس',reversed_on='2026-09-21',version=version+1 WHERE id='syn-rev-jul'").run(S);
  assert.throws(()=>db.prepare("UPDATE payroll_runs SET status='reversed',net_minor=1,gross_minor=1,version=version+1 WHERE id='syn-run-jul'").run(),/locked/,'nothing else moves with it');
  db.prepare("UPDATE payroll_runs SET status='reversed',version=version+1 WHERE id='syn-run-jul'").run();
  assert.throws(()=>db.prepare("UPDATE payroll_runs SET status='approved',version=version+1 WHERE id='syn-run-jul'").run(),/locked/,'reversed is final');
  db.prepare("INSERT INTO payroll_runs(id,tenant_id,month,cycle_policy_id,status,headcount,gross_minor,deductions_minor,net_minor,prepared_by,created_at,updated_at) VALUES('syn-run-jul-2','36t','2026-07','syn-pol','draft',0,0,0,0,'hr',?,?)").run(S,S);
  assert.throws(()=>db.prepare("INSERT INTO payroll_runs(id,tenant_id,month,cycle_policy_id,status,headcount,gross_minor,deductions_minor,net_minor,prepared_by,created_at,updated_at) VALUES('syn-run-jul-3','36t','2026-07','syn-pol','draft',0,0,0,0,'hr',?,?)").run(S,S),/UNIQUE/,'one live run per month still');
  assert.throws(()=>db.prepare("INSERT INTO payroll_payments(id,tenant_id,run_id,amount_minor,headcount,file_digest,status,prepared_by,created_at,updated_at) VALUES('syn-pay-rev','36t','syn-run-jul',1980000,2,'x','pending','hr',?,?)").run(S,S),/not reversed/);
  // حركات يونيو تبقى مع مسيره المعتمد؛ وحركة المسير المنعكس تتحرر.
  assert.throws(()=>db.prepare("UPDATE payroll_adjustments SET run_id=NULL WHERE id='syn-adj-bonus'").run(),/locked run/);
  db.prepare("INSERT INTO payroll_adjustments(id,tenant_id,user_id,kind,month,amount_minor,reason,status,proposed_by,decided_by,decided_at,run_id,created_at) VALUES('syn-adj-jul','36t','outsider','bonus','2026-07',1000,'حركة تجريبية لشهر منعكس','approved','hr','manager',?,'syn-run-jul',?)").run(S,S);
  db.prepare("UPDATE payroll_adjustments SET run_id=NULL WHERE id='syn-adj-jul'").run();
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);
});

test('migration 175: a wage file is exported from the approved transfer of its run and uploaded once per run; the approver of a transfer never records its execution',t=>{
  const {path}=build(t);
  const db=openDb(path);t.after(()=>db.close());
  assert.throws(()=>db.prepare("UPDATE wps_exports SET uploaded_on='2026-09-22',upload_reference='REF-2',upload_note='رفع ثانٍ تجريبي مكتوب',upload_recorded_by='manager',upload_recorded_at=?,version=version+1 WHERE id='syn-wps-2'").run(S),/UNIQUE/,'June already has its upload');
  const insert=(id,payment)=>db.prepare("INSERT INTO wps_exports(id,tenant_id,run_id,format_id,month,headcount,total_minor,run_total_minor,file_digest,checks,warning_count,exported_by,created_at,payment_id) VALUES(?,'36t','syn-run-jun','syn-fmt','2026-06',2,1980000,1980000,'d','[]',0,'hr',?,?)").run(id,S,payment);
  assert.throws(()=>insert('syn-wps-x',null),/approved transfer/);
  insert('syn-wps-y','syn-pay-jun');
  assert.throws(()=>db.prepare("UPDATE wps_exports SET payment_id=NULL,version=version+1 WHERE id='syn-wps-y'").run(),/recorded once/);
  db.prepare("INSERT INTO payroll_runs(id,tenant_id,month,cycle_policy_id,status,headcount,gross_minor,deductions_minor,net_minor,prepared_by,reviewed_by,reviewed_at,approved_by,approved_at,created_at,updated_at) VALUES('syn-run-oct','36t','2026-10','syn-pol','draft',1,1000,0,1000,'hr',NULL,NULL,NULL,NULL,?,?)").run(S,S);
  for(const [status,extra] of [['in_review',''],['reviewed',",reviewed_by='it',reviewed_at='2026-10-01T00:00:00.000Z'"],['approved',",approved_by='manager',approved_at='2026-10-01T00:00:00.000Z'"]])
    db.prepare(`UPDATE payroll_runs SET status='${status}'${extra},version=version+1 WHERE id='syn-run-oct'`).run();
  db.prepare("INSERT INTO payroll_payments(id,tenant_id,run_id,amount_minor,headcount,file_digest,status,prepared_by,approved_by,approved_at,created_at,updated_at) VALUES('syn-pay-oct','36t','syn-run-oct',1000,1,'x','approved','hr','manager',?,?,?)").run(S,S,S);
  assert.throws(()=>db.prepare("UPDATE payroll_payments SET status='executed',executed_on='2026-10-01',bank_reference='SYN-SELF',execution_evidence='تنفيذ تجريبي مكتوب مباشرة',execution_recorded_by='manager',version=version+1 WHERE id='syn-pay-oct'").run(),/does not record its execution/);
  db.prepare("UPDATE payroll_payments SET status='executed',executed_on='2026-10-01',bank_reference='SYN-OK',execution_evidence='تنفيذ تجريبي مكتوب مباشرة',execution_recorded_by='it',version=version+1 WHERE id='syn-pay-oct'").run();
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);
});

test('migration 175: a database where one run already has two recorded uploads is not migrated half-way — the unique index refuses, 175 rolls back and stays unapplied',t=>{
  const {path}=build(t,{twoUploads:true});
  assert.throws(()=>openDb(path),/UNIQUE constraint failed: wps_exports\.run_id/);
  const raw=new DatabaseSync(path,{readOnly:true});t.after(()=>raw.close());
  assert.equal(raw.prepare('SELECT 1 FROM schema_migrations WHERE version=175').get(),undefined);
  assert.ok(raw.prepare('SELECT 1 FROM schema_migrations WHERE version=174').get(),'what came before it stays applied');
  assert.match(raw.prepare("SELECT sql FROM sqlite_master WHERE name='payroll_runs'").get().sql,/'cancelled'\)\)/,'payroll_runs is as it was');
});
