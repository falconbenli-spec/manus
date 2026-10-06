// المسير الموازي والانتقال (الحزمة 4، P4-HR-5، الترحيل 176). الدورة كاملة في الخطوة 12 من tests/hr-payroll-cycle.test.mjs؛
// هنا ما حولها: الترحيل على قاعدة فارغة وعلى قاعدة سبقته، وقراءة ملفات النظام السابق، والفصل في القاعدة، والحارس على مسارات المال
// (لوحة حماية الأجور، والقابل للدفع، ومستندات الدفتر، والأثر الرجعي)، والمقارنة بحالاتها، والجاهزية، والمسارات، والصندوق، والشاشة.
// كل اسم ومبلغ وملف هنا تجريبي.
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { openDb, hash, verifyAudit } from '../app/db.mjs';
import { seed } from '../scripts/seed.mjs';
import * as parallel from '../app/payroll-parallel.mjs';
import { adoptionAction } from '../app/options.mjs';
import { wpsBoard } from '../app/wage-protection.mjs';
import { extrasBoard } from '../app/payroll-extras.mjs';
import { retroCandidates } from '../app/payroll-retro.mjs';
import { pendingSources } from '../app/ledger.mjs';
import { inbox } from '../app/inbox.mjs';
import { createApp } from '../app/server.mjs';
import { payrollParallelUI } from '../app/static/payroll-parallel-ui.mjs';
import { kit } from '../app/static/kit.mjs';
import { money } from '../app/static/operations.mjs';
import { dispatch } from './definitions-fixture.mjs';
import { hrCycle, caught, PASSWORD } from './hr-cycle-fixture.mjs';

const HEAD='employee,basic,housing,transport,other_allowance,overtime,other_additions,absence_deduction,gosi_employee,advance,other_deductions,net';
const STANDARD={breakdown:['employee,8000.00,2000.00,0,0,0,0,0,0,0,0,10000.00','outsider,6000.00,1500.00,500.00,0,0,0,0,0,0,0,8000.00'],bank:['employee,10000.00','outsider,8000.00']};
const files=({breakdown,bank,head=HEAD})=>({breakdown_csv:[head,...breakdown].join('\r\n'),bank_csv:['employee,amount',...bank].join('\r\n'),source_note:'كشف رواتب تجريبي وملف بنك تجريبي — بيانات مصطنعة'});

function world(t){
  const w=hrCycle(t),{db}=w,act=(who,fn,...args)=>w.tx(()=>fn(db,w.U[who],...args));
  const declare=month=>act('hr-manager',parallel.declareParallelMonth,{month,basis:'قرار تجريبي: النظام السابق يدفع الشهر'});
  const load=(month,legacy=STANDARD)=>{const b=act('hr',parallel.importLegacyBatch,{month,...files(legacy)});act('hr-manager',parallel.decideLegacyBatch,b.id,'confirm',{version:1,note:'طابقت مجموع ملف البنك التجريبي'});return b;};
  const compare=month=>act('hr',parallel.compareParallelMonth,{month});
  const view=(month,who='reviewer')=>parallel.parallelBoard(db,w.U[who]).months.find(m=>m.month===month);
  const explainAll=(month,cause='legacy_error')=>{const m=view(month);return act('reviewer',parallel.explainDifferences,m.comparison.id,{difference_ids:m.comparison.differences.filter(d=>!d.explanation).map(d=>d.id),cause,note:'تفسير تجريبي مكتوب لكل فرق'});};
  const adopt=(key,value)=>{
    w.tx(()=>adoptionAction(db,w.U['hr-manager'],key,'record',{value,basis:'قرار تجريبي في بيئة الاختبار',effective_from:'2026-09-01'}));
    const pending=db.prepare('SELECT id FROM option_adoptions WHERE key=? AND approved_by IS NULL').get(key).id;
    w.tx(()=>adoptionAction(db,w.U['approver-2'],key,'approve',{adoption_id:pending,note:'اعتماد تجريبي من شخص ثانٍ'}));
  };
  return Object.assign(w,{act,declare,load,compare,view,explainAll,adopt});
}

/* ───── الترحيل ───── */
function pre176(t){
  const directory=mkdtempSync(join(tmpdir(),'pre176-')),path=join(directory,'pre176.sqlite');
  t.after(()=>rmSync(directory,{recursive:true,force:true}));
  const raw=new DatabaseSync(path);raw.exec('PRAGMA foreign_keys=ON;');
  const schema=readFileSync(new URL('../app/schema.sql',import.meta.url),'utf8');
  raw.exec('CREATE TABLE IF NOT EXISTS schema_migrations(version INTEGER PRIMARY KEY, checksum TEXT NOT NULL)');
  raw.exec(schema);raw.prepare('INSERT INTO schema_migrations VALUES(1,?)').run(hash(schema));
  for(const file of readdirSync(new URL('../app/migrations/',import.meta.url)).filter(name=>/^\d{3}-.+\.sql$/.test(name)).sort()){
    const version=Number(file.slice(0,3));if(version===176)continue;
    const sql=readFileSync(new URL('../app/migrations/'+file,import.meta.url),'utf8');
    raw.exec('BEGIN');raw.exec(sql);raw.prepare('INSERT INTO schema_migrations VALUES(?,?)').run(version,hash(sql));raw.exec('COMMIT');
  }
  seed(raw,'synthetic-pre-176');
  const stamp='2026-07-01T09:00:00.000Z';
  raw.prepare("INSERT INTO hr_policies(id,tenant_id,kind,title,body,parameters,basis,effective_from,status,prepared_by,decided_by,decided_at,decision_note,created_at) VALUES('syn-cycle','36t','payroll_cycle','دورة رواتب تجريبية','نص تجريبي لسياسة دورة رواتب قبل الترحيل 176','{\"pay_day\":27,\"day_basis\":\"thirty\",\"review_threshold_bp\":500}','قرار تجريبي','2026-01-01','accepted','hr','manager',?,'اعتماد تجريبي',?)").run(stamp,stamp);
  raw.prepare("INSERT INTO payroll_runs(id,tenant_id,month,cycle_policy_id,status,headcount,gross_minor,deductions_minor,net_minor,prepared_by,reviewed_by,reviewed_at,approved_by,approved_at,created_at,updated_at) VALUES('syn-run-06','36t','2026-06','syn-cycle','approved',1,100000,0,100000,'hr','manager',?,'admin',?,?,?)").run(stamp,stamp,stamp,stamp);
  raw.prepare("INSERT INTO payroll_payments(id,tenant_id,run_id,amount_minor,headcount,file_digest,status,prepared_by,created_at,updated_at) VALUES('syn-pay-06','36t','syn-run-06',100000,1,'syn-digest','pending','hr',?,?)").run(stamp,stamp);
  const snapshot=db=>Object.fromEntries(['payroll_runs','payroll_payments','hr_policies','users','audit_events'].map(table=>[table,
    createHash('sha256').update(JSON.stringify(db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all())).digest('hex')]));
  const before=snapshot(raw);raw.close();
  return {path,before,snapshot};
}

test('migration 176: applies on an empty database and on one stopped before it — history kept, keys clean, audit chain intact, and the guard reads the history it finds',t=>{
  const fresh=openDb(':memory:');t.after(()=>fresh.close());
  assert.ok(fresh.prepare('SELECT 1 FROM schema_migrations WHERE version=176').get());
  assert.deepEqual(fresh.prepare('PRAGMA foreign_key_check').all(),[]);
  const {path,before,snapshot}=pre176(t),db=openDb(path);t.after(()=>{try{db.close();}catch{}});
  assert.ok(db.prepare('SELECT 1 FROM schema_migrations WHERE version=176').get(),'the missing version is applied below the highest one');
  assert.deepEqual(snapshot(db),before,'every row of the payroll history is as it was');
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);
  assert.equal(db.prepare("PRAGMA integrity_check").get().integrity_check,'ok');
  assert.equal(verifyAudit(db),true);
  for(const table of ['payroll_parallel_months','payroll_legacy_batches','payroll_legacy_lines','payroll_parallel_comparisons','payroll_parallel_differences','payroll_parallel_explanations','payroll_cutovers'])
    assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n,0,`${table} starts empty: nothing is invented by the migration`);
  // الشهر الذي أعدّت له المنصة دفعًا قبل الترحيل لا يصير موازيًا — القادح يقرأ التاريخ الذي وجده.
  const declare=month=>db.prepare("INSERT INTO payroll_parallel_months(id,tenant_id,month,basis,declared_by,declared_at) VALUES(?,?,?,?,?,?)").run(`syn-${month}`,'36t',month,'إعلان تجريبي مباشر','manager','2026-07-02T09:00:00.000Z');
  assert.throws(()=>declare('2026-06'),/paid, exported or booked/);
  declare('2026-07');
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM payroll_parallel_months WHERE status='declared'").get().n,1);
});

/* ───── ملفات النظام السابق ───── */
test('legacy files: tabs, semicolons or commas, Arabic digits, thousands and quotes are read; a bad file is refused whole, naming every row',t=>{
  const w=world(t),{db}=w;
  w.declare('2026-06');
  // ملصوق من برنامج جداول بالجدولة وأرقام عربية، وملف بنك بفاصلة منقوطة وأعمدة زائدة (آيبان) لا تُحفظ، ومبلغ بفاصل آلاف مقتبس.
  const tabbed=[HEAD.split(',').join('\t'),'employee\t٨٠٠٠٫٠٠\t2000\t\t\t\t\t\t\t\t\t١٠٠٠٠٫٠٠','outsider\t6000.00\t1500.00\t500.00\t0\t0\t0\t0\t0\t0\t0\t8000.00'].join('\n');
  const bank=['\uFEFFIBAN;employee;amount','SA0000000000000000000001;employee;"10,000.00"','SA0000000000000000000002;outsider;8000'].join('\r\n');
  const batch=w.act('hr',parallel.importLegacyBatch,{month:'2026-06',breakdown_csv:tabbed,bank_csv:bank,source_note:'ملصوق تجريبي من الجدول وملف بنك تجريبي'});
  const row=db.prepare('SELECT * FROM payroll_legacy_batches WHERE id=?').get(batch.id);
  assert.deepEqual([row.headcount,row.gross_minor,row.net_minor,row.paid_minor,row.employer_share_included],[2,1800000,1800000,1800000,0]);
  assert.match(row.bank_digest,/^[0-9a-f]{64}$/);
  assert.ok(!JSON.stringify(db.prepare('SELECT * FROM payroll_legacy_lines').all()).includes('SA00'),'no IBAN column is kept');
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM audit_events WHERE action='payroll_parallel.batch_imported'").get().n,1);
  // دفعة ثانية للشهر نفسه وهذه قائمة: مرفوضة باسمها.
  assert.equal(caught(()=>w.act('hr',parallel.importLegacyBatch,{month:'2026-06',...files(STANDARD)})).code,'batch_exists');
  w.act('hr-manager',parallel.decideLegacyBatch,batch.id,'reject',{version:1,note:'رفض تجريبي لإعادة الاستيراد'});
  // ملف فيه كل عيب: اسم دخول مجهول، وتكرار، ومعادلة لا تقوم، ومبلغ غير مقروء، وفرق بين الكشف والبنك، وسطر بنك بلا كشف.
  const before=db.prepare("SELECT (SELECT COUNT(*) FROM payroll_legacy_batches)||'/'||(SELECT COUNT(*) FROM payroll_legacy_lines) AS n").get().n;
  const bad=caught(()=>w.act('hr',parallel.importLegacyBatch,{month:'2026-06',...files({breakdown:['ghost,1,0,0,0,0,0,0,0,0,0,1.00','employee,8000,2000,0,0,0,0,0,0,0,0,9000.00','outsider,6000,1500,500,0,0,0,0,0,0,0,8000.00','outsider,6000,1500,500,0,0,0,0,0,0,0,8000.00','hr,abc,0,0,0,0,0,0,0,0,0,0'],
    bank:['employee,9000.00','outsider,7999.00','manager,10.00']})}));
  assert.equal(bad.code,'legacy_batch_invalid');
  const listed=bad.details.refusal.missing.map(m=>`${m.document} — ${m.why}`).join(' | ');
  for(const expected of ['الكشف — السطر 2','الكشف — السطر 3','الكشف — السطر 5','الكشف — السطر 6','ملف البنك — السطر 3','ملف البنك — السطر 4'])assert.ok(listed.includes(expected),`${expected} is named: ${listed}`);
  assert.equal(bad.details.refusal.missing.length,6,'a row refused for its own reason is not refused again from the other file');
  assert.match(listed,/ghost/);assert.match(listed,/مكرر/);assert.match(listed,/9000\.00/);
  assert.equal(db.prepare("SELECT (SELECT COUNT(*) FROM payroll_legacy_batches)||'/'||(SELECT COUNT(*) FROM payroll_legacy_lines) AS n").get().n,before,'nothing of a refused batch is written');
  assert.equal(caught(()=>w.act('hr',parallel.importLegacyBatch,{month:'2026-06',...files({...STANDARD,head:'employee,basic,net'})})).details.refusal.missing[0].document.includes('أعمدة ناقصة'),true);
  // شهر ما أُعلن موازيًا لا دفعة له.
  assert.equal(caught(()=>w.act('hr',parallel.importLegacyBatch,{month:'2026-07',...files(STANDARD)})).code,'not_parallel_month');
  assert.equal(parallel.amountMinor('1,234,567.8'),123456780);assert.equal(parallel.amountMinor('-5'),null);assert.equal(parallel.amountMinor('1.234'),null);
});

/* ───── الفصل وثبات التاريخ في القاعدة ───── */
test('separation of duties is in the database too, and the parallel history is append-only',t=>{
  const w=world(t),{db}=w;
  w.declare('2026-06');
  w.absence('employee','2026-06-10');
  const batch=w.load('2026-06'),cmp=w.compare('2026-06');
  const difference=db.prepare('SELECT * FROM payroll_parallel_differences WHERE comparison_id=?').get(cmp.id);
  const explain=(by,id='syn-x')=>db.prepare("INSERT INTO payroll_parallel_explanations(id,tenant_id,difference_id,batch_id,user_id,component,legacy_minor,platform_minor,cause,note,explained_by,explained_at) VALUES(?,'36t',?,?,?,?,?,?,'legacy_error','تفسير مباشر تجريبي',?,'t')")
    .run(id,difference.id,batch.id,difference.user_id,difference.component,difference.legacy_minor,difference.platform_minor,by);
  for(const by of ['hr','employee'])assert.throws(()=>explain(by),/second person/,`${by} is not a second person here`);
  assert.throws(()=>db.prepare("INSERT INTO payroll_parallel_explanations(id,tenant_id,difference_id,batch_id,user_id,component,legacy_minor,platform_minor,cause,note,explained_by,explained_at) VALUES('syn-y','36t',?,?,?,?,1,2,'legacy_error','أرقام غير أرقام الفرق','reviewer','t')")
    .run(difference.id,batch.id,difference.user_id,difference.component),/second person/,'an explanation is for the numbers of its difference');
  explain('reviewer');
  assert.throws(()=>explain('approver-2','syn-z'),/UNIQUE/,'one explanation per difference and its numbers');
  // الموظف لا يفسّر فرقًا في أجره ولو حمل التصريح.
  w.grant('employee','payroll.review');w.refresh();
  w.absence('outsider','2026-06-11');
  const again=w.compare('2026-06'),own=w.view('2026-06','employee').comparison;
  assert.equal(own.differences.find(d=>d.user_id==='employee').actions.length,0,'no explain button on one’s own pay');
  const outsiderDiff=own.differences.find(d=>d.user_id==='outsider');
  assert.deepEqual(outsiderDiff.actions,['explain_parallel_difference']);
  const ownDiff=db.prepare("SELECT id FROM payroll_parallel_differences WHERE comparison_id=? AND user_id='employee'").get(again.id);
  assert.equal(caught(()=>w.act('employee',parallel.explainDifferences,again.id,{difference_ids:[ownDiff.id],cause:'legacy_error',note:'محاولة تفسير فرق في أجري'})).code,'separation_of_duties');
  // التاريخ لا يُعدَّل ولا يُحذف.
  for(const [sql,pattern] of [
    ["UPDATE payroll_legacy_lines SET net_minor=1 WHERE batch_id=?",/written once/],["DELETE FROM payroll_legacy_lines WHERE batch_id=?",/retained/],
    ["UPDATE payroll_legacy_batches SET net_minor=1,paid_minor=1,gross_minor=1,version=version+1 WHERE id=?",/keeps its numbers/],["DELETE FROM payroll_legacy_batches WHERE id=?",/retained/]])
    assert.throws(()=>db.prepare(sql).run(batch.id),pattern,sql);
  assert.throws(()=>db.prepare('UPDATE payroll_parallel_comparisons SET difference_count=0 WHERE id=?').run(cmp.id),/record/);
  assert.throws(()=>db.prepare('DELETE FROM payroll_parallel_differences WHERE id=?').run(difference.id),/retained/);
  assert.throws(()=>db.prepare("UPDATE payroll_parallel_explanations SET note='تعديل لاحق للتفسير' WHERE id='syn-x'").run(),/written once/);
  // الشهر لا يسحبه من أعلنه، والانتقال لا يؤكده من اقترحه — قيدان في الجدول نفسه.
  const withdraw=(month,by)=>db.prepare(`UPDATE payroll_parallel_months SET status='withdrawn',withdrawn_by=${by},withdrawn_at='t',withdrawal_note='سحب مباشر تجريبي',version=version+1 WHERE month=?`).run(month);
  assert.throws(()=>withdraw('2026-06',"'approver-2'"),/legacy batch stands/,'a month with a legacy batch was paid by the legacy system');
  w.declare('2026-07');
  assert.throws(()=>withdraw('2026-07','declared_by'),/CHECK constraint/,'nobody withdraws their own declaration');
  db.prepare("INSERT INTO payroll_cutovers(id,tenant_id,first_platform_month,last_parallel_month,readiness,note,proposed_by,proposed_at) VALUES('syn-cut','36t','2026-08','2026-07','{}','اقتراح تجريبي مباشر','hr-manager','t')").run();
  assert.throws(()=>db.prepare("UPDATE payroll_cutovers SET status='confirmed',decided_by=proposed_by,decided_at='t',decision_note='تأكيد ذاتي مباشر',version=version+1 WHERE id='syn-cut'").run(),/CHECK constraint/);
  assert.throws(()=>db.prepare("INSERT INTO payroll_cutovers(id,tenant_id,first_platform_month,last_parallel_month,readiness,note,proposed_by,proposed_at) VALUES('syn-cut-2','36t','2026-06','2026-05','{}','اقتراح قبل آخر شهر موازٍ','hr-manager','t')").run(),/right after the last declared parallel month|UNIQUE/);
  assert.ok(verifyAudit(db));
});

/* ───── الحارس على مسارات المال ───── */
test('the money paths name the parallel month: the WPS board shows the blocker without an export action, the payable list and the pending ledger sources leave it out, retro ignores it, and a month the platform paid is not declared parallel',t=>{
  const w=world(t),{db}=w;
  w.declare('2026-06');
  const june=w.approveMonth('2026-06'),july=w.approveMonth('2026-07');
  const runs=wpsBoard(db,w.U.hr).runs,juneRun=runs.find(r=>r.month==='2026-06'),julyRun=runs.find(r=>r.month==='2026-07');
  assert.ok(juneRun.blocking.some(b=>b.key==='parallel_month'),'the board says why June is not exported');
  assert.deepEqual(juneRun.actions,[]);
  assert.equal(julyRun.blocking.some(b=>b.key==='parallel_month'),false,'a month that is not parallel is untouched');
  assert.deepEqual(extrasBoard(db,w.U.hr).payable_runs.map(r=>r.month),['2026-07'],'only the month the platform pays is payable');
  const pending=pendingSources(db,w.U.hr).filter(s=>s.source_kind==='payroll_run').map(s=>s.source_id);
  assert.ok(pending.includes(july.id)&&!pending.includes(june.id),'the June run does not wait for a journal that is never made, so it holds no close');
  // غياب اعتُمد بعد اعتماد المسيرين: يونيو دفعه النظام السابق فلا أثر رجعي عليه من المنصة، ويوليو له.
  w.absence('employee','2026-06-15');w.absence('employee','2026-07-15');
  assert.deepEqual(retroCandidates(db,w.U.hr).candidates.map(c=>c.source_month),['2026-07']);
  // شهر أعدّت المنصة دفعه: ما يصير موازيًا، والقاعدة ترفضه أيضًا.
  const august=w.approveMonth('2026-08');
  db.prepare("INSERT INTO payroll_payments(id,tenant_id,run_id,amount_minor,headcount,file_digest,status,prepared_by,created_at,updated_at) VALUES('syn-pay-08','36t',?,1,1,'syn','pending','hr','t','t')").run(august.id);
  const refused=caught(()=>w.declare('2026-08'));
  assert.equal(refused.code,'platform_paid');assert.match(refused.details.refusal.what,/أعدّت دفع رواتبه/);
  assert.throws(()=>db.prepare("INSERT INTO payroll_parallel_months(id,tenant_id,month,basis,declared_by,declared_at) VALUES('syn-08','36t','2026-08','إعلان مباشر تجريبي','hr-manager','t')").run(),/paid, exported or booked/);
  assert.throws(()=>db.prepare("INSERT INTO wps_exports(id,tenant_id,run_id,format_id,month,headcount,total_minor,run_total_minor,file_digest,checks,exported_by,created_at) VALUES('syn-x','36t',?,'none','2026-06',1,1,1,'d','[]','hr','t')").run(june.id),/wage protection/);
});

/* ───── المقارنة ───── */
test('the comparison: one side only is a presence difference, the employer GOSI share is compared when the legacy file has it, explanations follow their numbers into a re-comparison, and a tolerance of one counts a month clean',t=>{
  const w=world(t),{db}=w;
  w.declare('2026-06');
  const head=`${HEAD},gosi_employer`;
  w.load('2026-06',{head,breakdown:['employee,8000.00,2000.00,0,0,0,0,0,0,0,0,10000.00,1200.00','hr,5000.00,0,0,0,0,0,0,0,0,0,5000.00,0'],bank:['employee,10000.00','hr,5000.00']});
  w.compare('2026-06');
  let m=w.view('2026-06');
  assert.deepEqual(m.comparison.differences.map(d=>[d.user_id,d.component,d.legacy_minor,d.platform_minor,d.delta_minor]).sort(),
    [['employee','gosi_employer',120000,0,-120000],['hr','presence',500000,null,-500000],['outsider','presence',null,800000,800000]].sort());
  assert.equal(caught(()=>w.compare('2026-06')).code,'comparison_current','the same inputs against the same batch are not compared twice');
  w.explainAll('2026-06');
  // مكافأة معتمدة للخارج من الدفعة: صافيه في المنصة تغيّر، فتعاد المقارنة ويبقى ما فُسّر بأرقامه نفسها مفسّرًا.
  w.decide(w.propose({user_id:'outsider',kind:'bonus',month:'2026-06',amount:'250.00'}));
  assert.equal(w.view('2026-06').state,'stale');
  w.compare('2026-06');
  m=w.view('2026-06');
  assert.deepEqual(m.comparison.differences.filter(d=>!d.explanation).map(d=>[d.user_id,d.component,d.platform_minor]),[['outsider','presence',825000]]);
  assert.equal(m.comparison.differences.filter(d=>d.explanation).length,2);
  assert.equal(m.state,'tolerance_unset');
  w.adopt(parallel.TOLERANCE,{unexplained_max:1});
  assert.equal(w.view('2026-06').state,'clean','one unexplained difference is within an adopted tolerance of one');
  w.adopt(parallel.REQUIRED_MONTHS,{months:'1'});
  const ready=parallel.cutoverReadiness(db,w.U['hr-manager']);
  assert.equal(ready.required_months,1,'a value recorded as a digit string is read as its number');
  assert.equal(ready.ready,true);
  assert.equal(caught(()=>w.act('reviewer',parallel.explainDifferences,m.comparison.id,{difference_ids:[m.comparison.differences.find(d=>d.explanation).id],cause:'legacy_error',note:'تفسير ثانٍ لفرق مفسّر'})).code,'already_explained');
  assert.equal(caught(()=>w.act('reviewer',parallel.explainDifferences,m.comparison.id,{difference_ids:[m.comparison.differences.find(d=>!d.explanation).id],cause:'platform_wrong',note:'سبب ليس في القائمة'})).code,'option_not_offered');
});

/* ───── الجاهزية ───── */
test('readiness counts consecutive months ending at the last one, and a withdrawn batch leaves its comparison superseded',t=>{
  const w=world(t),{db}=w;
  for(const month of ['2026-05','2026-06','2026-08'])w.declare(month);
  w.adopt(parallel.TOLERANCE,{unexplained_max:0});w.adopt(parallel.REQUIRED_MONTHS,{months:2});
  for(const month of ['2026-05','2026-06','2026-08']){w.load(month);w.compare(month);}
  let ready=parallel.cutoverReadiness(db,w.U['hr-manager']);
  assert.deepEqual(ready.months.map(m=>m.state),['clean','clean','clean']);
  assert.deepEqual(ready.streak,['2026-08']);
  assert.deepEqual(ready.blockers.map(b=>b.doc_key),['months:short'],'a gap in July breaks the streak: the platform paid July or nobody declared it');
  // يوليو موازٍ أيضًا: الشهور المتتالية أربعة، والانتقال من سبتمبر.
  w.declare('2026-07');w.load('2026-07');w.compare('2026-07');
  ready=parallel.cutoverReadiness(db,w.U['hr-manager']);
  assert.equal(ready.ready,true);assert.deepEqual(ready.streak,['2026-05','2026-06','2026-07','2026-08']);assert.equal(ready.first_platform_month,'2026-09');
  // دفعة مؤكدة يسحبها معتمد غير من استوردها: مقارنتها ما عادت تقيس شيئًا، والشهر بلا دفعة.
  const batch=w.view('2026-08','hr-manager').batch;
  assert.deepEqual(batch.actions,['withdraw_legacy_batch']);
  w.act('hr-manager',parallel.decideLegacyBatch,batch.id,'withdraw',{version:batch.version,note:'سحب تجريبي: الملف لشهر آخر'});
  const august=w.view('2026-08');
  assert.equal(august.comparison.state,'superseded');assert.equal(august.state,'no_batch');
  assert.deepEqual(parallel.cutoverReadiness(db,w.U['hr-manager']).blockers.map(b=>b.doc_key),['month:2026-08']);
  // شهر بلا دفعة يسحب إعلانه معتمد غير من أعلنه، ويُرفض السحب ممن أعلنه.
  w.declare('2026-10');
  const october=w.view('2026-10','approver-2');
  assert.deepEqual(october.actions.filter(a=>a==='withdraw_parallel_month'),['withdraw_parallel_month']);
  assert.equal(caught(()=>w.act('hr-manager',parallel.withdrawParallelMonth,october.id,{version:october.version,note:'سحب من المعلن نفسه'})).code,'separation_of_duties');
  w.act('approver-2',parallel.withdrawParallelMonth,october.id,{version:october.version,note:'سحب تجريبي: الشهر تدفعه المنصة'});
  assert.equal(parallel.isParallelMonth(db,'36t','2026-10'),false);
  assert.ok(verifyAudit(db));
});

/* ───── المسارات والصندوق ───── */
async function sessions(app,names){
  const out={};
  for(const username of names){
    const r=await dispatch(app,{method:'POST',path:'/api/login',body:{username,password:PASSWORD}});
    assert.equal(r.status,200,`${username}: ${r.text.slice(0,200)}`);
    out[username]={cookie:r.headers['Set-Cookie'].split(';')[0],csrf:r.json().csrf};
  }
  return (who,method,path,body,{csrf=true,key=null}={})=>dispatch(app,{method,path:'/api'+path,body,
    headers:{cookie:out[who].cookie,origin:'http://127.0.0.1:3600',...(csrf?{'x-csrf-token':out[who].csrf}:{}),...(key?{'idempotency-key':key}:{})}});
}
test('HTTP: the board and every step through the real router — payroll staff only, idempotent creates, CSRF, a named 404 for an unknown step — and the inbox tells each second person what awaits them',async t=>{
  const w=world(t),{db}=w,call=await sessions(createApp(db),['hr','hr-manager','reviewer','employee']);
  assert.equal((await call('employee','GET','/payroll-parallel')).status,403);
  assert.ok((await call('employee','GET','/payroll-parallel')).json().error.details.refusal.what.includes('المسير الموازي'));
  const key='syn-parallel-declare-0001';
  const declared=await call('hr-manager','POST','/payroll-parallel/months',{month:'2026-06',basis:'إعلان تجريبي عبر الخادم'},{key});
  assert.equal(declared.status,201,declared.text);
  const replay=await call('hr-manager','POST','/payroll-parallel/months',{month:'2026-06',basis:'إعلان تجريبي عبر الخادم'},{key});
  assert.equal(replay.json().id,declared.json().id,'the same key does not declare twice');
  assert.equal((await call('hr-manager','POST','/payroll-parallel/months',{month:'2026-07',basis:'إعلان بلا رمز تحقق'},{csrf:false,key:'syn-parallel-declare-0002'})).status,403);
  const batch=await call('hr','POST','/payroll-parallel/batches',{month:'2026-06',...files(STANDARD)},{key:'syn-parallel-batch-0001'});
  assert.equal(batch.status,201,batch.text);
  const batchId=batch.json().id;
  // المؤكِّد يصله البند في صندوقه، والمستورِد لا.
  const item=(who,source)=>inbox(db,w.U[who]).groups.find(g=>g.key==='payroll-parallel')?.items.find(i=>i.id===source);
  assert.deepEqual(item('hr-manager',batchId)?.actions,['تأكيد دفعة النظام السابق']);
  assert.equal(item('hr-manager',batchId)?.link,`#payroll-parallel?focus=${batchId}`);
  assert.equal(item('hr',batchId),undefined);
  assert.equal((await call('hr-manager','POST',`/payroll-parallel/batches/${batchId}/archive`,{version:1,note:'خطوة مجهولة'})).status,404);
  assert.equal((await call('hr-manager','POST',`/payroll-parallel/batches/${batchId}/confirm`,{version:1,note:'طابقت مجموع ملف البنك عبر الخادم'})).status,201);
  w.absence('employee','2026-06-10');
  const compared=await call('hr','POST','/payroll-parallel/comparisons',{month:'2026-06'},{key:'syn-parallel-compare-0001'});
  assert.equal(compared.status,201,compared.text);
  const comparisonId=compared.json().id;
  assert.deepEqual(item('reviewer',comparisonId)?.actions,['تفسير فرق في المسير الموازي']);
  assert.equal(item('hr',comparisonId),undefined,'the comparer is not asked to explain');
  const board=(await call('reviewer','GET','/payroll-parallel')).json(),difference=board.months[0].comparison.differences[0];
  const explained=await call('reviewer','POST',`/payroll-parallel/comparisons/${comparisonId}/explain`,{difference_ids:[difference.id],cause:'legacy_error',note:'النظام السابق ما خصم الغياب المعتمد'});
  assert.equal(explained.status,201,explained.text);
  assert.equal(item('reviewer',comparisonId),undefined,'nothing left to explain');
  assert.ok(verifyAudit(db));
});

/* ───── الشاشة ───── */
const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const context=()=>({e:escape,money,ui:kit(escape),date:value=>String(value).slice(0,10),
  button:(action,id,label)=>`<button class="btn outline small" data-action="operation" data-module="payroll-parallel" data-operation="${escape(action)}" data-id="${escape(id)}">${escape(label)}</button>`});
const offered=data=>new Set([...data.actions,...data.months.flatMap(m=>[...m.actions,...(m.batch?.actions??[]),...(m.comparison?.actions??[])]),
  ...data.cutovers.flatMap(c=>c.actions),...[data.values.tolerance,data.values.required_months].flatMap(v=>[...v.actions,...v.pending.flatMap(p=>p.actions)])]);
function checkScreen(data,label){
  const html=payrollParallelUI.render(data,context());
  const drawn=new Set([...html.matchAll(/data-operation="([a-z_]+)"/g)].map(m=>m[1]));
  assert.deepEqual([...drawn].sort(),[...offered(data)].sort(),`${label}: a named control for every action the server offers, and none it does not`);
  for(const action of drawn)assert.ok(payrollParallelUI.form(action,(html.match(new RegExp(`data-operation="${action}" data-id="([^"]*)"`))??[])[1],data),`${label}: ${action} opens a form`);
  assert.doesNotMatch(html,/style=/);assert.doesNotMatch(html,/<th>/,`${label}: header cells are scoped`);
  const levels=[...html.matchAll(/<h([1-6])/g)].map(m=>Number(m[1]));
  levels.forEach((level,i)=>assert.ok(i===0?level===2:level<=levels[i-1]+1,`${label}: heading h${level} after h${levels[i-1]}`));
  return html;
}
test('screen: a named control for every action the server offers and none it does not, headings in order, dates in <time>, scoped headers, and the empty state says what fills it',t=>{
  const w=world(t),{db}=w;
  const empty=checkScreen(parallel.parallelBoard(db,w.U.hr),'empty');
  assert.match(empty,/ما فيه شهر موازٍ للحين/);
  w.declare('2026-06');w.absence('employee','2026-06-10');
  const batch=w.act('hr',parallel.importLegacyBatch,{month:'2026-06',...files(STANDARD)});
  checkScreen(parallel.parallelBoard(db,w.U['hr-manager']),'batch awaiting the approver');
  w.act('hr-manager',parallel.decideLegacyBatch,batch.id,'confirm',{version:1,note:'طابقت مجموع ملف البنك التجريبي'});
  w.compare('2026-06');
  const reviewer=checkScreen(parallel.parallelBoard(db,w.U.reviewer),'differences awaiting the reviewer');
  assert.match(reviewer,/<time datetime="2026-06">2026-06<\/time>/);
  assert.match(reviewer,/خصم الغياب/);assert.match(reviewer,/ينتظر قرارك/);
  const preparer=checkScreen(parallel.parallelBoard(db,w.U.hr),'the preparer');
  assert.doesNotMatch(preparer,/data-operation="explain_parallel_difference"/,'the comparer gets no explain button');
  w.adopt(parallel.TOLERANCE,{unexplained_max:1});w.adopt(parallel.REQUIRED_MONTHS,{months:1});
  const approver=checkScreen(parallel.parallelBoard(db,w.U['hr-manager']),'ready');
  assert.match(approver,/جاهز للانتقال/);assert.match(approver,/data-operation="propose_cutover"/);
});
