// الحزمة 4 (P4-HR-2): سلامة مدخلات المسير. ما يثبته هذا الملف:
//   • الاحتساب قراءة نقية (computeRunLines) يكتب calculate ناتجها، ويحفظ المسير بصمة المدخلات التي استعملها فعلًا.
//   • ما تغيّر بعد الاحتساب يمنع التقديم والمراجعة والاعتماد باسمه — الغياب، والحركات، وآثار الإجازات، والمزايا، والعقود —
//     حتى يُعاد الاحتساب. قرار مطبَّق: المنع وإعادة الاحتساب، لا الاعتماد ثم الأثر الرجعي. ومسير احتُسب قبل البصمة يُعاد احتسابه مرة.
//   • حركة أو سلفة لشهر تجاوز مسيره المسودة لا تُعتمد (كانت تُعتمد ولا تُدفع أبدًا)، والرفض يبقى متاحًا.
//   • أثر إجازة سُحب: خصمه المقترح لا يُعتمد، والمعتمد غير المدفوع يخرج من الاحتساب التالي، والمدفوع يُرد بحركة واحدة —
//     ولا يلغي الموظف بنفسه إجازةً دُفع خصمها.
//   • موافقة العامل الخطية (م51) عبر POST /api/payroll/adjustments/:id/consent بهويته وحده، بحراسة CSRF والمصدر.
//   • إجراءات المسير ترفض النسخة القديمة، وكتابةٌ تقع بين القراءة والكتابة تُرفض ولا تُكتب فوقها؛ وسباق عمليتين يعتمد مرة واحدة.
// البيانات تجريبية كلها (tests/hr-cycle-fixture.mjs).
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { openDb, transaction, verifyAudit, now } from '../app/db.mjs';
import * as payroll from '../app/payroll.mjs';
import { proposeAdvance, decideAdvance } from '../app/payroll-extras.mjs';
import { hrCycle, code, caught } from './hr-cycle-fixture.mjs';

const ROOT=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const WORKER=join(ROOT,'tests/payroll-approval-worker.mjs');
const HEX=/^[0-9a-f]{64}$/;
const thisMonth=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Riyadh',year:'numeric',month:'2-digit'}).format(new Date());
const changedKeys=error=>error.details?.refusal?.missing?.map(m=>m.doc_key);

test('computeRunLines: a pure read of the month — no row written, the lines calculate then writes, and only this tenant’s people',t=>{
  const w=hrCycle(t),{db}=w;
  w.absence('employee','2026-07-14');
  w.decide(w.propose({user_id:'outsider',kind:'bonus',month:'2026-07',amount:'400.00'}));
  const fingerprint=()=>JSON.stringify(['payroll_lines','payroll_runs','audit_events'].map(table=>db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n).concat(db.prepare('SELECT COUNT(*) AS n FROM payroll_adjustments WHERE run_id IS NOT NULL').get().n));
  const before=fingerprint(),computed=payroll.computeRunLines(db,'36t','2026-07');
  assert.equal(fingerprint(),before);
  assert.match(computed.digest,HEX);
  assert.deepEqual(Object.keys(computed.parts).sort(),Object.keys(payroll.INPUT_PARTS).sort());
  assert.ok(Object.values(computed.parts).every(value=>HEX.test(value)));
  const july=w.prepare('2026-07');
  assert.equal(july.inputs_digest,computed.digest);
  for(const line of computed.lines){
    const written=w.lineOf(july,line.user_id);
    assert.deepEqual([written.gross_minor,written.additions_minor,written.unpaid_absence_minor,written.other_deductions_minor,written.net_minor],[line.gross_minor,line.additions_minor,line.unpaid_absence_minor,line.other_deductions_minor,line.net_minor],line.user_id);
  }
  // بعد الاحتساب صارت المكافأة مربوطة بالمسير، فتُقرأ معه: المدخلات نفسها تعطي البصمة نفسها.
  assert.equal(payroll.computeRunLines(db,'36t','2026-07',{runId:july.id}).digest,computed.digest,'the same inputs give the same digest');
  // كيان آخر بسياسته وعقده: يحسب ناسه وحدهم، ولا يرى من هذا الكيان أحدًا.
  const isolated=db.prepare("INSERT INTO users(id,tenant_id,department_id,username,name,password_hash,role) SELECT ?,'isolated','other',?,?,password_hash,? FROM users WHERE id='hr'");
  isolated.run('isolated-hr','isolated-hr','موظف خدمات معزول تجريبي','hr');isolated.run('isolated-head','isolated-head','معتمد معزول تجريبي','manager');
  const time=now();
  db.prepare("INSERT INTO hr_policies(id,tenant_id,kind,title,body,parameters,basis,effective_from,status,prepared_by,decided_by,decided_at,created_at) VALUES('iso-pay','isolated','pay_components','بنود راتب معزولة','نص سياسة معزولة تجريبي كافٍ الطول للاختبار.','{\"components\":[\"basic\"]}','سند تجريبي معزول','2025-01-01','accepted','isolated-hr','isolated-head',?,?),('iso-cycle','isolated','payroll_cycle','دورة رواتب معزولة','نص سياسة معزولة تجريبي كافٍ الطول للاختبار.',?,'سند تجريبي معزول','2025-01-01','accepted','isolated-hr','isolated-head',?,?)")
    .run(time,time,JSON.stringify({pay_day:27,day_basis:'thirty',review_threshold_bp:500}),time,time);
  db.prepare("INSERT INTO employment_contracts(id,tenant_id,user_id,policy_id,contract_type,job_title,work_location,start_date,weekly_hours,probation_days,notice_days,pay_lines,monthly_total_minor,currency,document_reference,status,prepared_by,decided_by,decided_at,created_at,updated_at) VALUES('iso-contract','isolated','external','iso-pay','indefinite','وظيفة معزولة تجريبية','الرياض','2025-01-01',40,90,30,'[{\"component\":\"basic\",\"amount_minor\":500000}]',500000,'SAR','عقد معزول تجريبي','active','isolated-hr','isolated-head',?,?,?)").run(time,time,time);
  assert.deepEqual(payroll.computeRunLines(db,'isolated','2026-07').lines.map(l=>l.user_id),['external']);
  assert.equal(payroll.computeRunLines(db,'36t','2026-07').lines.some(l=>l.user_id==='external'),false);
});

test('inputs digest: each input changed after calculation is named — adjustments, benefits, leave effects, absences, contracts — and blocks submission, review and approval until recalculated',t=>{
  const w=hrCycle(t),{db}=w;
  let july=w.prepare('2026-07');
  const blocked=r=>{const error=caught(()=>w.run('hr',w.view('hr',r),'submit_run'));assert.equal(error.code,'inputs_changed',error.message);return changedKeys(error);};
  const recalc=()=>{july=w.run('hr',w.view('hr',july),'recalculate');};
  w.decide(w.propose({user_id:'outsider',kind:'bonus',month:'2026-07',amount:'300.00'}));
  assert.deepEqual(blocked(july),['adjustments']);recalc();
  w.decide(w.benefit('employee',150000,'2026-07'));
  assert.deepEqual(blocked(july),['benefits']);recalc();
  const leave=w.unpaidLeave('2026-07-05','2026-07-09');w.decide(w.effectsOf(leave.id)[0].adjustment_id);
  assert.deepEqual(blocked(july),['leave_effects']);recalc();
  w.absence('employee','2026-07-14');
  assert.deepEqual(blocked(july),['absences']);recalc();
  w.contract('outsider','2026-07-16',[{component:'basic',amount:'6600.00'},{component:'housing',amount:'1500.00'},{component:'transport',amount:'500.00'}],{amends:w.contracts.outsider,reason:'زيادة تجريبية معتمدة من منتصف يوليو'});
  assert.deepEqual(blocked(july),['contracts']);recalc();
  const line=w.lineOf(july,'employee');
  assert.deepEqual([line.additions_minor,line.other_deductions_minor,line.unpaid_absence_minor],[150000,166667,33333]);
  july=w.review(w.run('hr',july,'submit_run'));
  assert.equal(july.status,'reviewed');
  // بعد المراجعة: غياب يُعتمد يمنع الاعتماد باسمه، والمسار إعادة للمسودة ثم احتساب ثم مراجعة.
  w.absence('employee','2026-07-21');
  const refused=caught(()=>w.approve(july));
  assert.equal(refused.code,'inputs_changed');assert.deepEqual(changedKeys(refused),['absences']);
  assert.match(refused.details.refusal.next,/المسودة/);
  july=w.run('hr-manager',w.view('hr-manager',july),'return_run',{note:'غياب اعتُمد بعد المراجعة'});
  recalc();
  assert.equal(w.lineOf(july,'employee').unpaid_absence_minor,66667);
  july=w.approve(w.review(w.run('hr',july,'submit_run')));
  assert.equal(july.status,'approved');
  assert.ok(verifyAudit(db));
});

test('inputs digest: review is checked too, and a run calculated before the digest existed is unverified until recalculated once',t=>{
  const w=hrCycle(t),{db}=w;
  let june=w.run('hr',w.prepare('2026-06'),'submit_run');
  w.absence('employee','2026-06-10');
  const atReview=caught(()=>w.run('reviewer',w.view('reviewer',june),'pass_review',{note:'مراجعة بعد تغيّر الغياب'}));
  assert.equal(atReview.code,'inputs_changed');assert.deepEqual(changedKeys(atReview),['absences']);
  june=w.run('reviewer',w.view('reviewer',june),'return_run',{note:'غياب اعتُمد بعد التقديم'});
  // مسير احتُسب قبل الترحيل 173: لا بصمة له، فلا يُعرف على أي مدخلات احتُسب.
  db.prepare('UPDATE payroll_runs SET inputs_digest=NULL,inputs_parts=NULL,version=version+1 WHERE id=?').run(june.id);
  const legacy=caught(()=>w.run('hr',w.view('hr',june),'submit_run'));
  assert.equal(legacy.code,'inputs_changed');assert.deepEqual(changedKeys(legacy),['calculation']);
  june=w.run('hr',w.view('hr',june),'recalculate');
  assert.match(june.inputs_digest,HEX);
  assert.equal(w.approve(w.review(w.run('hr',june,'submit_run'))).status,'approved');
  assert.throws(()=>db.prepare('UPDATE payroll_runs SET inputs_digest=?,version=version+1 WHERE id=?').run('0'.repeat(64),june.id),/locked/,'an approved run keeps its digest');
});

test('locked months: an adjustment or an advance for a month whose run is past draft is refused by name, and rejecting stays open',t=>{
  const w=hrCycle(t),{db}=w;
  const inReview=w.propose({user_id:'outsider',kind:'bonus',month:'2026-07',amount:'250.00'});
  let july=w.run('hr',w.prepare('2026-07'),'submit_run');
  let refused=caught(()=>w.decide(inReview));
  assert.equal(refused.code,'month_locked');
  assert.equal(refused.details.refusal.missing[0].owner_role,'payroll.review','someone who can return the run to draft is named');
  july=w.review(july);
  assert.equal(caught(()=>w.decide(inReview)).code,'month_locked','reviewed is past draft too');
  w.decide(inReview,'reject');
  assert.equal(db.prepare('SELECT status FROM payroll_adjustments WHERE id=?').get(inReview).status,'rejected');
  const august=w.propose({user_id:'outsider',kind:'bonus',month:'2026-08',amount:'250.00'});
  w.approveMonth('2026-08');
  refused=caught(()=>w.decide(august));
  assert.equal(refused.code,'month_locked');assert.equal(refused.details.refusal.missing[0].owner_role,'payroll.prepare');
  // السلفة: أقساطها تبدأ من شهرها الأول، فإن تجاوز مسيره المسودة لم يُخصم قسطه أبدًا.
  const month=thisMonth();
  const advance=w.tx(()=>proposeAdvance(db,w.U.hr,{user_id:'employee',amount:'900.00',installments:3,first_month:month,reason:'سلفة تجريبية بطلب الموظفة'})).id;
  w.run('hr',w.prepare(month),'submit_run');
  assert.equal(caught(()=>w.tx(()=>decideAdvance(db,w.U['hr-manager'],advance,'approve',{note:'اعتماد سلفة تجريبية'}))).code,'month_locked');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM payroll_adjustments WHERE advance_id=?').get(advance).n,0,'no instalment is written');
  assert.ok(verifyAudit(db));
});

test('withdrawn leave effects: the proposed deduction is not approvable, an approved but unpaid one leaves the next calculation, and a paid one is refunded once — never by its own employee',t=>{
  const w=hrCycle(t),{db}=w;
  // معتمد لم يُدفع: يخرج من الاحتساب، ولا ردّ له لأنه لم يُخصم.
  const unpaid=w.unpaidLeave('2026-08-02','2026-08-03');
  const [unpaidEffect]=w.effectsOf(unpaid.id);w.decide(unpaidEffect.adjustment_id);
  let august=w.prepare('2026-08');
  assert.equal(w.lineOf(august,'employee').other_deductions_minor,unpaidEffect.amount_minor);
  w.leaveAct('hr',w.leave('hr',unpaid.id),'cancel',{note:'إلغاء تجريبي قبل صرف المسير'});
  assert.deepEqual(changedKeys(caught(()=>w.run('hr',w.view('hr',august),'submit_run'))),['leave_effects']);
  august=w.run('hr',w.view('hr',august),'recalculate');
  assert.equal(w.lineOf(august,'employee').other_deductions_minor,0,'the withdrawn deduction is not paid');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM leave_pay_effect_refunds').get().n,0,'nothing was deducted, so nothing is refunded');
  // مدفوع: دخل مسير يوليو المعتمد.
  const paid=w.unpaidLeave('2026-07-05','2026-07-09');
  const [paidEffect]=w.effectsOf(paid.id);w.decide(paidEffect.adjustment_id);
  assert.equal(w.approveMonth('2026-07').status,'approved');
  // الموظفة تلغي إجازتها قبل بدايتها (الساعة تُعاد إلى أول يوليو): الخصم دُفع، فالإلغاء من خدمات الموظف لا منها.
  t.mock.timers.enable({apis:['Date'],now:Date.parse('2026-07-01T06:00:00.000Z')});
  const own=caught(()=>w.leaveAct('employee',w.leave('employee',paid.id),'cancel',{note:'ألغي إجازتي التجريبية'}));
  assert.equal(own.code,'paid_leave_effect');
  assert.equal(w.leave('hr',paid.id).status,'approved','nothing moved');
  t.mock.timers.reset();
  w.leaveAct('hr',w.leave('hr',paid.id),'cancel',{note:'إلغاء تجريبي بعد صرف المسير'});
  const [refund]=db.prepare('SELECT * FROM leave_pay_effect_refunds WHERE effect_id=?').all(paidEffect.id);
  const row=db.prepare('SELECT * FROM payroll_adjustments WHERE id=?').get(refund.refund_id);
  assert.deepEqual([row.kind,row.status,row.amount_minor,row.user_id,row.proposed_by,row.month],['allowance','proposed',paidEffect.amount_minor,'employee','hr','2026-08']);
  assert.equal(refund.deduction_id,paidEffect.adjustment_id);
  assert.throws(()=>db.prepare('INSERT INTO leave_pay_effect_refunds(effect_id,tenant_id,deduction_id,paid_run_id,refund_id,created_by,created_at) SELECT effect_id,tenant_id,deduction_id,paid_run_id,refund_id,created_by,created_at FROM leave_pay_effect_refunds').run(),/UNIQUE|PRIMARY/);
  assert.throws(()=>db.prepare('DELETE FROM leave_pay_effect_refunds').run(),/refund/);
  assert.ok(verifyAudit(db));
});

test('consent over HTTP: the wage owner consents under their own session, nobody else can, and the route keeps CSRF and origin checks',async t=>{
  const w=hrCycle(t),{db}=w;
  const id=w.propose({user_id:'employee',kind:'deduction',month:'2026-08',amount:'120.00',deduction_basis:'consent',deduction_reference:'إقرار تجريبي'});
  assert.equal(caught(()=>w.decide(id)).code,'consent_required');
  const call=await w.http(['employee','outsider','hr-manager']);
  const path=`/payroll/adjustments/${id}/consent`;
  for(const who of ['outsider','hr-manager'])assert.equal((await call(who,'POST',path,{consent:true})).status,404,who);
  assert.equal((await call('employee','POST',path,{consent:true},{csrf:false})).status,403,'no CSRF token, no consent');
  assert.equal((await call('employee','POST',path,{consent:true},{origin:'https://elsewhere.example'})).status,403,'another origin, no consent');
  assert.equal((await call('employee','POST',path,{consent:false})).status,400);
  const given=await call('employee','POST',path,{consent:true});
  assert.equal(given.status,201,given.text);
  const basis=db.prepare('SELECT * FROM payroll_deduction_basis WHERE adjustment_id=?').get(id);
  assert.equal(basis.consent_by,'employee');assert.ok(basis.consent_at);
  assert.equal((await call('employee','POST',path,{consent:true})).status,409,'consent is recorded once');
  w.decide(id);
  assert.equal(db.prepare('SELECT status FROM payroll_adjustments WHERE id=?').get(id).status,'approved');
  assert.equal(payroll.listPayroll(db,w.U.employee).deduction_consents.length,0);
  assert.ok(verifyAudit(db));
});

test('versions: a stale run version is refused, and a write that lands between reading the run and writing it is refused rather than overwritten',t=>{
  const w=hrCycle(t),{db}=w;
  const july=w.prepare('2026-07');
  assert.equal(caught(()=>w.run('hr',{...july,version:july.version-1},'recalculate')).code,'stale_version');
  // كاتبٌ آخر يمس المسير أثناء إعادة الاحتساب (محاكًى بمُطلِق مؤقت على حذف السطور): كان التحديث الأخير يُكتب فوقه بلا شرط.
  db.exec(`CREATE TEMP TRIGGER concurrent_writer AFTER DELETE ON payroll_lines BEGIN UPDATE payroll_runs SET version=version+1 WHERE id=OLD.run_id; END;`);
  assert.equal(caught(()=>w.run('hr',w.view('hr',july),'recalculate')).code,'stale_version');
  assert.equal(w.view('hr',july).version,july.version,'the whole action rolled back');
});

function race(path,jobs){
  const startAt=Date.now()+2500;
  return Promise.all(jobs.map((job,index)=>new Promise(done=>{
    const child=spawn(process.execPath,[WORKER,path,String(startAt),JSON.stringify({...job,index})],{cwd:ROOT});
    let out='',err='';child.stdout.on('data',c=>{out+=c;});child.stderr.on('data',c=>{err+=c;});
    child.on('close',()=>{try{done(JSON.parse(out.trim().split('\n').pop()));}catch{done({index,ok:false,error:'no output: '+err.slice(0,300)});}});
  })));
}
test('race: two processes approve the same run at the same instant — one approval, the other refused as stale, one audit event',{timeout:240000},async t=>{
  const dir=mkdtempSync(join(tmpdir(),'36t-payroll-race-'));
  t.after(()=>rmSync(dir,{recursive:true,force:true}));
  const path=join(dir,'race.sqlite');
  const w=hrCycle(t);
  const run=w.review(w.run('hr',w.prepare('2026-06'),'submit_run'));
  w.db.exec(`VACUUM INTO '${path.replaceAll("'","''")}'`);
  // اتصال حارس يبقى مفتوحًا طوال السباق كما يبقى اتصال الخادم (السبب في tests/payment-release.test.mjs).
  const keeper=openDb(path);t.after(()=>keeper.close());
  const results=await race(path,[{user:'hr-manager',run_id:run.id,version:run.version},{user:'approver-2',run_id:run.id,version:run.version}]);
  assert.equal(results.filter(r=>r.ok).length,1,JSON.stringify(results));
  assert.deepEqual(results.filter(r=>!r.ok).map(r=>r.error),['stale_version'],JSON.stringify(results));
  const row=keeper.prepare('SELECT status,approved_by,version FROM payroll_runs WHERE id=?').get(run.id);
  assert.equal(row.status,'approved');assert.equal(row.approved_by,results.find(r=>r.ok).user);assert.equal(row.version,run.version+1);
  assert.equal(keeper.prepare("SELECT COUNT(*) AS n FROM audit_events WHERE entity_id=? AND action='payroll.approve_run'").get(run.id).n,1);
  assert.equal(verifyAudit(keeper),true,'the audit chain did not fork under concurrent writers');
});
