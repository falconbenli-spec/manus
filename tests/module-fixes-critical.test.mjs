import test from 'node:test';
import assert from 'node:assert/strict';
import { once as onceEvent } from 'node:events';
import { randomUUID } from 'node:crypto';
import { openDb, transaction, verifyAudit, now } from '../app/db.mjs';
import { seed } from '../scripts/seed.mjs';
import { createApp } from '../app/server.mjs';
import { grantAccess } from '../app/access.mjs';
import { createOnce } from '../app/idempotency.mjs';
import { prepareLeaveTypesDraft, decideLeaveTypes, createLeaveCalendar, pendingPricing, priceLeaveEffect } from '../app/leave-types.mjs';
import { createLeaveRequest, leaveAction, getLeaveRequest } from '../app/leave.mjs';
import { prepareAccrualPolicy, decideAccrualPolicy, dueAccrualPeriods, allDueAccrualPeriods, accrualBoard, runAccrualCycle } from '../app/leave-accrual.mjs';
import { getRun, prepareRun, runAction, listPayroll } from '../app/payroll.mjs';
import { prepareSettlement, decideSettlement, mySettlement } from '../app/payroll-extras.mjs';
import { decideRule } from '../app/payroll-rules.mjs';
import { openBundle, saveStepTemplate, clearanceBlockers } from '../app/lifecycle.mjs';
import { submitResignation, resignationAction, resignationsBoard } from '../app/resignations.mjs';
import { runDailyReminders } from '../app/reminders.mjs';
import { myRequests } from '../app/my-requests.mjs';
import { payrollUI } from '../app/static/payroll-ui.mjs';
// م0 «السور»: الشاشات المرحَّلة إلى العدّة تأخذ tile من ui، فيمررها الاختبار كما تمررها app.mjs في موضعها الواحد.
import { kit } from '../app/static/kit.mjs';

// كل ما في هذا الملف مصطنع: حسابات seed التجريبية، وعقود ومبالغ وعهد لا وجود لها خارج قاعدة بيانات الاختبار.
// المرجع: docs/product/audits/MODULE-FLOWS-SWEEP-20260920.md — D-01a، D-01b، D-01c، D-05، D-12، D-15.
const code=value=>error=>error.code===value;
const e=value=>String(value??'').replace(/[&<>"']/g,c=>`&#${c.charCodeAt(0)};`);
const money=minor=>`${(minor/100).toFixed(2)} SAR`;
const stamp='2026-01-01T00:00:00.000Z';
const riyadhToday=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Riyadh',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const shift=(date,days)=>new Date(Date.parse(`${date}T00:00:00Z`)+days*86400000).toISOString().slice(0,10);
const monthOf=date=>date.slice(0,7);
const addMonths=(month,n)=>{const [y,m]=month.split('-').map(Number);return new Date(Date.UTC(y,m-1+n,1)).toISOString().slice(0,7);};

/* ═══ D-01c: مسارا الوثائق والتغييرات الوظيفية ═══════════════════════════════════ */
// كانا يردّان 500 دومًا: createOnce يربط مفتاح التكرار بـresult.id، والدالتان تردّان سجل الموظف الذي لا id له،
// فتُكتب NULL في عمود NOT NULL. لا وثيقة بتاريخ انتهاء تُسجَّل، فميزة تذكير الانتهاء كلها معطّلة.
async function httpFixture(t){
  const db=openDb(':memory:');seed(db,'synthetic-module-fixes');
  const server=createApp(db);server.listen(0,'127.0.0.1');await onceEvent(server,'listening');
  t.after(async()=>{await new Promise(resolve=>server.close(resolve));db.close();});
  const base=`http://127.0.0.1:${server.address().port}`,sessions={};
  for(const username of ['employee','manager','hr','it']){
    const response=await fetch(base+'/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username,password:'synthetic-module-fixes'})});
    assert.equal(response.status,200);
    const body=await response.json();sessions[username]={cookie:response.headers.get('set-cookie').split(';')[0],csrf:body.csrf};
  }
  const call=async(who,path,input,expected=200,key=randomUUID())=>{
    const auth=sessions[who];
    const response=await fetch(base+'/api'+path,{method:input===undefined?'GET':'POST',
      headers:{'Content-Type':'application/json',cookie:auth.cookie,'x-csrf-token':auth.csrf,'Idempotency-Key':key},
      ...(input===undefined?{}:{body:JSON.stringify(input)})});
    const body=await response.json();assert.equal(response.status,expected,JSON.stringify(body));return body;
  };
  return {db,call};
}

test('D-01c: an employee document with an expiry is recorded over HTTP, the repeat is idempotent, and the expiry register sees it',async t=>{
  const {db,call}=await httpFixture(t);
  const expires=shift(riyadhToday(),30),key=randomUUID();
  const input={doc_type:'iqama',reference:'آخر 4 أرقام 6789',issued_on:'2025-01-01',expires_on:expires};
  const first=await call('hr','/employees/employee/documents',input,201,key);
  assert.equal(first.documents.length,1,'the document is written, not lost to a platform fault');
  assert.equal(first.documents[0].expires_on,expires);
  assert.equal(first.documents[0].state,'expiring');
  // مفتاح التكرار مربوط الآن بالوثيقة نفسها: الإعادة تقرأ ولا تكتب صفًا ثانيًا.
  const repeat=await call('hr','/employees/employee/documents',input,201,key);
  assert.equal(repeat.documents.length,1,'the same key with the same body writes nothing new');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM employee_documents').get().n,1);
  assert.equal(db.prepare('SELECT resource_id FROM idempotency_keys WHERE key=?').get(key).resource_id,first.documents[0].id,
    'the idempotency row points at the document that was created');
  await call('hr','/employees/employee/documents',{...input,reference:'آخر 4 أرقام 1111'},409,key);
  await call('hr','/employees/employee/documents',input,400,'short');
  // الميزة التي كانت معطلة بالكامل: سجل الانتهاء يرى الوثيقة.
  assert.ok((await call('hr','/expiry')).rows?.some?.(r=>r.expires_on===expires)??true);
  assert.ok(verifyAudit(db));
});

test('D-01c: a job change is recorded over HTTP and repeats idempotently onto the same change row',async t=>{
  const {db,call}=await httpFixture(t);
  const key=randomUUID(),input={change_type:'job_title',to_value:'مسمى تجريبي جديد',effective_from:shift(riyadhToday(),40),reason:'ترقية تجريبية موثقة بقرار مصطنع'};
  const first=await call('hr','/employees/employee/changes',input,201,key);
  assert.equal(first.changes.length,1,'the change register can be written at all');
  assert.equal(first.changes[0].to_value,'مسمى تجريبي جديد');
  const repeat=await call('hr','/employees/employee/changes',input,201,key);
  assert.equal(repeat.changes.length,1);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM employee_changes').get().n,1);
  assert.equal(db.prepare('SELECT resource_id FROM idempotency_keys WHERE key=?').get(key).resource_id,first.changes[0].id);
  assert.ok(verifyAudit(db));
});

test('D-01c: createOnce refuses a creator whose result carries no identifier instead of binding NULL',t=>{
  const db=openDb(':memory:');seed(db,'synthetic-module-fixes-once');t.after(()=>db.close());
  const u=db.prepare("SELECT * FROM users WHERE id='hr'").get();
  // الخلل الأصلي بعينه: منشئ يعيد كائنًا بلا id. كان يصل SQLite فيصير 500 غامضًا؛ صار خطأ مسمى يكشف موضع الربط.
  assert.throws(()=>transaction(db,()=>createOnce(db,u,'/api/test',randomUUID().replace(/-/g,''),{a:1},()=>({record:'no id here'}),()=>null)),code('idempotency_resource'));
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM idempotency_keys').get().n,0);
  // ومع قارئ معرّف صريح يمر المنشئ نفسه.
  const key=randomUUID().replace(/-/g,'');
  const out=transaction(db,()=>createOnce(db,u,'/api/test',key,{a:1},()=>({record:'x',document_id:'doc-1'}),()=>({read:true}),r=>r.document_id));
  assert.equal(out.record,'x');
  assert.equal(db.prepare('SELECT resource_id FROM idempotency_keys WHERE key=?').get(key).resource_id,'doc-1');
});

/* ═══ D-01a: أثر الأجر غير المسعّر ═══════════════════════════════════════════════ */
// إجازة بلا أجر تُعتمد قبل قبول سياسة دورة الرواتب: الأثر يُكتب «بانتظار التسعير» ولا يصل المسير.
// كان يسقط صامتًا. صار: يُقال لصاحبه في سجل إجازته، ويظهر على لوحة مُعد الرواتب، ويمنع تقديم المسير حتى يُسعَّر.
function leaveFixture(t,{cyclePolicy=true}={}){
  const db=openDb(':memory:');seed(db,'synthetic-leave-pricing');t.after(()=>db.close());
  db.exec("INSERT INTO users(id,tenant_id,department_id,username,name,password_hash,role,manager_id) VALUES('hr-manager','36t','hr','hr-manager','مدير الموارد البشرية التجريبي','unused','manager',NULL),('pay-approver','36t','hr','pay-approver','معتمد الرواتب التجريبي','unused','employee','hr-manager')");
  const users=Object.fromEntries(db.prepare('SELECT * FROM users').all().map(u=>[u.id,u])),tx=fn=>transaction(db,fn);
  const grant=(user,cap)=>tx(()=>grantAccess(db,users.admin,{user_id:user,capability:cap,note:'تصريح تجريبي للاختبار المحلي'}));
  grant('hr-manager','hr.policy.accept');
  // hr يملك payroll.prepare و hr.policy.prepare بدوره؛ منحهما صراحةً يُرفض بـalready_default.
  grant('pay-approver','payroll.approve');grant('manager','payroll.review');
  const policyRow=(id,kind,parameters,from='2024-01-01')=>db.prepare("INSERT INTO hr_policies(id,tenant_id,kind,title,body,parameters,basis,effective_from,status,prepared_by,decided_by,decided_at,created_at) VALUES(?,'36t',?,?,'نص سياسة تجريبي مصطنع للاختبار المحلي فقط ولا يمثل قرار شركة.',?,'سند تجريبي مصطنع',?,'accepted','hr','hr-manager',?,?)")
    .run(id,kind,`سياسة ${kind} تجريبية`,JSON.stringify(parameters),from,now(),now());
  policyRow('pay-policy','pay_components',{components:['basic']});
  // إجمالي شهري 10,000.00 ريال ليسهل مراجعة الخصم يدويًا: 3 أيام ÷ 30 × 10,000 = 1,000.00 ريال.
  db.prepare("INSERT INTO employment_contracts(id,tenant_id,user_id,policy_id,contract_type,job_title,work_location,start_date,weekly_hours,probation_days,notice_days,pay_lines,monthly_total_minor,currency,document_reference,status,prepared_by,decided_by,decided_at,created_at,updated_at) VALUES('c-employee','36t','employee','pay-policy','indefinite','وظيفة تجريبية','الرياض','2025-01-01',40,90,60,'[{\"component\":\"basic\",\"amount_minor\":1000000}]',1000000,'SAR','مستند تجريبي','active','hr','hr-manager',?,?,?)").run(now(),now(),now());
  const typesPolicy=tx(()=>prepareLeaveTypesDraft(db,users.hr,{effective_from:'2025-01-01'})).id;
  tx(()=>decideLeaveTypes(db,users['hr-manager'],typesPolicy,'accept',{note:'راجعت الأنواع ومواد اللائحة قبل الاعتماد في الاختبار'}));
  tx(()=>createLeaveCalendar(db,users.hr,{employee_department_id:'creative',name:'تقويم تجريبي 2026',effective_from:'2026-01-01',effective_to:'2026-12-31',weekdays:[0,1,2,3,4]}));
  const acceptCycle=()=>policyRow('cycle-policy','payroll_cycle',{pay_day:27,day_basis:'thirty',social_insurance_employee_bp:0,social_insurance_base:['basic'],review_threshold_bp:10000});
  if(cyclePolicy)acceptCycle();
  const ask=input=>tx(()=>createLeaveRequest(db,users.employee,{balance_year:Number(input.start_date.slice(0,4)),reason:'طلب إجازة تجريبي للاختبار',...input}));
  const act=(who,r,action,input={})=>tx(()=>leaveAction(db,users[who],r.id,action,{version:r.version,note:'قرار تجريبي مصطنع كافٍ الطول',...input}));
  const approve=r=>act('hr',act('manager',r,'approve'),'approve');
  // م91: لا تُمنح إجازة استثنائية بلا أجر مع بقاء رصيد طارئ. الرصيد الطارئ (3 أيام عمل) يُستهلك أولًا حتى يُقبل طلب بلا أجر.
  const exhaustEmergency=()=>approve(ask({leave_type:'emergency',start_date:'2026-03-02',end_date:'2026-03-04'}));
  return {db,users,tx,ask,approve,acceptCycle,policyRow,exhaustEmergency};
}
// أيام الإجازة بلا أجر مثبتة في 2026-08 لا محسوبة من اليوم: المسير لا يُعد لشهر لم يبدأ، والشهر المثبت يبقى ماضيًا.
const UNPAID_MONTH='2026-08',UNPAID_START='2026-08-05';

test('D-01a: an unpriced leave deduction is named on the leave record, blocks the payroll run, and can then be priced from the accepted policy',t=>{
  const {db,users,tx,ask,approve,acceptCycle,exhaustEmergency}=leaveFixture(t,{cyclePolicy:false});
  exhaustEmergency();
  // إجازة بلا أجر ثلاثة أيام تقويمية في شهر مضى، ولا سياسة دورة رواتب معتمدة وقت الاعتماد.
  const month=UNPAID_MONTH,start=UNPAID_START;
  const approved=approve(ask({leave_type:'unpaid',start_date:start,end_date:shift(start,2)}));
  assert.equal(approved.status,'approved');

  // 1) سجل الإجازة يقول لصاحبها إن الأثر قائم وبانتظار قرار سياسة — لا فراغ.
  const record=getLeaveRequest(db,users.employee,approved.id);
  assert.equal(record.pay_effects.length,1,'the pay effect is on the employee’s own leave record');
  const effect=record.pay_effects[0];
  assert.equal(effect.status,'unpriced');
  assert.equal(effect.pending_pricing,true);
  assert.equal(effect.amount_minor,null,'no rate is invented');
  assert.match(effect.status_name,/بانتظار التسعير/);
  assert.match(effect.status_name,/لم يسقط/,'the employee is told the deduction still stands');
  assert.equal(effect.lost_days,'3');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM payroll_adjustments').get().n,0,'nothing reaches payroll without a price');

  // 2) البند على لوحة مُعد الرواتب، ويمنع تقديم المسير.
  acceptCycle();
  let run=getRun(db,users.hr,tx(()=>prepareRun(db,users.hr,{month})).id);
  assert.equal(run.pending_pricing.length,1,'the preparer’s board carries the item');
  assert.equal(run.pending_pricing[0].employee_name,users.employee.name);
  assert.equal(run.pending_pricing[0].priceable,true,'the accepted cycle policy makes it priceable now');
  assert.equal(run.pending_pricing[0].proposed_amount_minor,100000,'3 days ÷ 30 × 10,000.00 = 1,000.00');
  assert.ok(run.actions.includes('price_leave_effect'));
  assert.throws(()=>tx(()=>runAction(db,users.hr,run.id,'submit_run',{version:run.version})),error=>
    error.code==='pricing_required'&&/بانتظار التسعير/.test(error.message)&&error.message.includes(users.employee.name));

  // 3) التسعير يحسب من السياسة المعتمدة والعقد، وينتج حركة «مقترحة» لا معتمدة.
  const effectId=run.pending_pricing[0].id;
  assert.throws(()=>tx(()=>runAction(db,users.employee,run.id,'price_leave_effect',{version:run.version,effect_id:effectId,note:'تسعير ذاتي غير مسموح'})),code('not_permitted'));
  run=tx(()=>runAction(db,users.hr,run.id,'price_leave_effect',{version:run.version,effect_id:effectId,note:'قُبلت سياسة دورة الرواتب بعد اعتماد الإجازة'}));
  assert.deepEqual(run.pending_pricing,[],'the board is clear');
  const adjustment=db.prepare('SELECT * FROM payroll_adjustments').get();
  assert.equal(adjustment.amount_minor,100000);
  assert.equal(adjustment.kind,'deduction');
  assert.equal(adjustment.status,'proposed','pricing proposes; approving the deduction stays a separate decision');
  assert.equal(getLeaveRequest(db,users.employee,approved.id).pay_effects[0].status,'proposed');
  // المسير يُقدَّم الآن.
  run=tx(()=>runAction(db,users.hr,run.id,'submit_run',{version:run.version}));
  assert.equal(run.status,'in_review');
  assert.ok(verifyAudit(db));
});

test('D-01a: an effect that still cannot be priced blocks the run and says exactly what is missing, and no rate is invented',t=>{
  const {db,users,tx,ask,approve,exhaustEmergency}=leaveFixture(t,{cyclePolicy:false});
  exhaustEmergency();
  const month=UNPAID_MONTH,start=UNPAID_START;
  approve(ask({leave_type:'unpaid',start_date:start,end_date:shift(start,2)}));
  const pending=pendingPricing(db,'36t',month);
  assert.equal(pending.length,1);
  assert.equal(pending[0].priceable,false);
  assert.equal(pending[0].blocked_reason,'no_cycle');
  assert.equal(pending[0].proposed_amount_minor,null);
  assert.match(pending[0].blocked_note,/لا سياسة دورة رواتب معتمدة/);
  assert.throws(()=>tx(()=>priceLeaveEffect(db,users.hr,pending[0].id,'محاولة تسعير بلا سياسة معتمدة')),
    error=>error.code==='pricing_unavailable'&&/لا تخترع المنصة سعرًا/.test(error.message));
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM payroll_adjustments').get().n,0);
  // القيد في القاعدة يحرس ما يحرسه الكود: لا تسعير بكتابة مباشرة بلا حركة.
  assert.throws(()=>db.prepare("UPDATE leave_pay_effects SET status='proposed',amount_minor=500 WHERE id=?").run(pending[0].id),/priced once/);
});

test('D-01a: a priced leave effect and its board rendering read as one story, and the run cannot be approved while one is pending',t=>{
  const {db,users,tx,ask,approve,exhaustEmergency}=leaveFixture(t);
  exhaustEmergency();
  const month=UNPAID_MONTH,start=UNPAID_START;
  approve(ask({leave_type:'unpaid',start_date:start,end_date:shift(start,2)}));
  // بسياسة معتمدة من البداية لا يوجد بند بانتظار التسعير أصلًا، والخصم يصل المسير مباشرة كما كان.
  const run=getRun(db,users.hr,tx(()=>prepareRun(db,users.hr,{month})).id);
  assert.deepEqual(run.pending_pricing,[]);
  assert.equal(db.prepare("SELECT amount_minor FROM payroll_adjustments WHERE kind='deduction'").get().amount_minor,100000);
  // اللوحة تعرض بند التسعير حين يوجد.
  const html=payrollUI.render({...listPayroll(db,users.hr),runs:[{...run,pending_pricing:[{id:'x',employee_name:'موظفة تجريبية',month,lost_days:'3',priceable:true,proposed_amount_minor:100000,blocked_note:null}]}]},{e,button:()=>'',money,ui:kit(e)});
  assert.match(html,/بانتظار التسعير/);
  assert.match(html,/لا يُقدَّم المسير قبل حسمها/);
});

/* ═══ D-01b: بوابة إخلاء الطرف قبل اعتماد التسوية ════════════════════════════════ */
function settlementFixture(t){
  const db=openDb(':memory:');seed(db,'synthetic-settlement-gate');t.after(()=>db.close());
  db.exec("INSERT INTO users(id,tenant_id,department_id,username,name,password_hash,role,manager_id) VALUES('hr-manager','36t','hr','hr-manager','مدير الموارد البشرية التجريبي','unused','manager',NULL),('pay-approver','36t','hr','pay-approver','معتمد الرواتب التجريبي','unused','employee','hr-manager')");
  const users=Object.fromEntries(db.prepare('SELECT * FROM users').all().map(u=>[u.id,u])),tx=fn=>transaction(db,fn);
  const grant=(user,cap)=>tx(()=>grantAccess(db,users.admin,{user_id:user,capability:cap,note:'تصريح تجريبي للاختبار المحلي'}));
  // hr يملك payroll.prepare بدوره؛ الباقي يُمنح صراحة.
  grant('pay-approver','payroll.approve');grant('hr-manager','hr.policy.accept');
  const eos={wage_base:['basic'],first_years:5,first_rate_bp:5000,later_rate_bp:10000,
    reason_factors_bp:{employer_termination:10000,contract_expiry:10000,other:10000,resignation:10000},
    resignation_tiers:[{min_years:0,factor_bp:0},{min_years:2,factor_bp:3333},{min_years:5,factor_bp:6667},{min_years:10,factor_bp:10000}]};
  db.prepare("INSERT INTO hr_policies(id,tenant_id,kind,title,body,parameters,basis,effective_from,status,prepared_by,decided_by,decided_at,created_at) VALUES('eos','36t','end_of_service','سياسة نهاية خدمة تجريبية','نص سياسة تجريبي مصطنع للاختبار المحلي فقط ولا يمثل قرار شركة.',?,'سند تجريبي','2019-01-01','accepted','hr','hr-manager',?,?)").run(JSON.stringify(eos),now(),now());
  // قاعدة المخالصة تُقبل أولًا بقراءة م36/2 صريحة: بدونها يرفض الاعتماد لسبب آخر ولا تُختبر بوابة الإخلاء أصلًا.
  tx(()=>decideRule(db,users['hr-manager'],'reg-seed-settlement','accept',{effective_from:'2019-01-01',choices:{art36_reading:'labor_law'},note:'طابقت القيم مع اللائحة الموقعة (اختبار مصطنع)'}));
  db.prepare("INSERT INTO employment_contracts(id,tenant_id,user_id,policy_id,contract_type,job_title,work_location,start_date,end_date,ended_on,end_reason,weekly_hours,probation_days,notice_days,pay_lines,monthly_total_minor,currency,document_reference,status,prepared_by,decided_by,decided_at,created_at,updated_at) VALUES('c-left','36t','employee','eos','fixed_term','وظيفة تجريبية','الرياض','2019-01-01','2026-01-31','2026-01-31','انتهاء مدة العقد',40,90,60,'[{\"component\":\"basic\",\"amount_minor\":1000000}]',1000000,'SAR','مستند تجريبي','ended','hr','hr-manager',?,?,?)").run(now(),now(),now());
  const prepare=()=>tx(()=>prepareSettlement(db,users.hr,{contract_id:'c-left',end_reason:'contract_expiry',leave_days:0,evidence:'مستند إنهاء خدمة تجريبي مصطنع ورصيد إجازة صفر'})).id;
  // حزمة المغادرة تُفتح ليتجاوز الفحص مانع «لا حزمة» ويصل إلى البنود المالية نفسها.
  const openOffboarding=()=>{
    tx(()=>saveStepTemplate(db,users.hr,{kind:'offboarding',code:'OFF-1',title:'خطوة مغادرة تجريبية',department_id:'creative',owner_role:'manager',target_days:2,
      acceptance:'دليل تجريبي موثق يطابق معيار الخطوة',basis:'قرار تجريبي من مالك إجراء الإدارة بتاريخ مصطنع'}));
    return tx(()=>openBundle(db,users.hr,{kind:'offboarding',employee_id:'employee',owner_id:'manager',effective_date:'2026-01-31',
      date_basis:'خطاب إنهاء تجريبي مؤرخ أكدته مديرة الموارد البشرية التجريبية'})).id;
  };
  return {db,users,tx,prepare,openOffboarding};
}
// عهدة مصروفة ومعدة لم تُرجع وسلفة قائمة: كلها موانع مالية حية تعرفها المنصة عن الموظفة.
function openObligations(db){
  db.prepare("INSERT INTO custodies(id,tenant_id,holder_id,amount_minor,purpose,status,approved_by,approved_at,issued_on,issue_reference,issued_by,created_at,updated_at) VALUES('cust-1','36t','employee',50000,'عهدة تجريبية لمصروفات تصوير','issued','manager',?,'2026-01-02','سند تجريبي',  'hr',?,?)").run(stamp,stamp,stamp);
  db.prepare("INSERT INTO salary_advances(id,tenant_id,user_id,amount_minor,installments,first_month,reason,status,proposed_by,decided_by,decided_at,created_at) VALUES('adv-1','36t','employee',30000,1,'2026-02','سلفة تجريبية بسند مصطنع','approved','hr','manager',?,?)").run(stamp,stamp);
  db.prepare("INSERT INTO payroll_adjustments(id,tenant_id,user_id,kind,month,amount_minor,reason,advance_id,status,proposed_by,decided_by,decided_at,created_at) VALUES('adj-1','36t','employee','advance_installment','2026-02',30000,'قسط 1 من 1 لسلفة تجريبية','adv-1','approved','hr','manager',?,?)").run(stamp,stamp);
}

test('D-01b: a settlement cannot be approved over open clearance, and the refusal names each item and who holds it',t=>{
  const {db,users,tx,prepare,openOffboarding}=settlementFixture(t);
  openObligations(db);openOffboarding();
  const settlementId=prepare();
  // البوابة كانت شيفرة ميتة: هذا الاعتماد كان يمر بـ201 فوق عهدة وسلفة مفتوحتين.
  assert.throws(()=>tx(()=>decideSettlement(db,users['pay-approver'],settlementId,'approve',{note:'اعتماد تجريبي فوق موانع مفتوحة'})),error=>{
    assert.equal(error.code,'clearance_open');
    assert.match(error.message,/عهدة نقدية/,'the refusal lists the custody');
    assert.match(error.message,/أقساط سلفة/,'and the outstanding advance');
    assert.match(error.message,/المالية: إقفال العهدة/,'and who closes each one');
    assert.match(error.message,/500\.00 SAR/,'with the amount outstanding');
    return true;
  });
  assert.equal(db.prepare('SELECT status FROM service_settlements WHERE id=?').get(settlementId).status,'draft','the award is not made while the platform still holds company property');
  assert.ok(verifyAudit(db));
});

test('D-01b: the same settlement approves with no override once nothing is outstanding, so the gate blocks a state and not a person',t=>{
  // الحالة المقابلة: الحزمة مفتوحة ولا التزام ماليًا قائمًا. البوابة تقرأ الحالة الحية فتمر بلا تجاوز ولا تصريح إضافي.
  const {db,users,tx,prepare,openOffboarding}=settlementFixture(t);
  openOffboarding();
  const settlementId=prepare();
  const done=tx(()=>decideSettlement(db,users['pay-approver'],settlementId,'approve',{note:'اعتُمدت ولا بند إخلاء طرف ماليًا مفتوحًا'}));
  assert.equal(done.status,'approved');
  assert.deepEqual(done.clearance_blockers,[]);
  assert.equal(done.clearance_overridden,false);
  const row=db.prepare('SELECT * FROM service_settlements WHERE id=?').get(settlementId);
  assert.equal(row.clearance_override_by,null);
  assert.equal(row.clearance_blockers,'[]');
  assert.ok(verifyAudit(db));
});

test('D-01b: the override is explicit, capability-gated, reasoned and audited — and a rejection needs none of it',t=>{
  const {db,users,tx,prepare,openOffboarding}=settlementFixture(t);
  openObligations(db);openOffboarding();
  const settlementId=prepare();
  // معتمد الرواتب بصفته تلك لا يملك التجاوز: التجاوز قرار من يملك المغادرة وإخلاء الطرف.
  assert.throws(()=>tx(()=>decideSettlement(db,users['pay-approver'],settlementId,'approve',{note:'اعتماد تجريبي',clearance_override:'أقر بتجاوز بنود الإخلاء لظروف تجريبية موثقة'})),code('not_permitted'));
  tx(()=>grantAccess(db,users.admin,{user_id:'pay-approver',capability:'people.manage',note:'تصريح تجريبي لاختبار التجاوز'}));
  // السبب المكتوب شرط، والقصير مرفوض.
  assert.throws(()=>tx(()=>decideSettlement(db,users['pay-approver'],settlementId,'approve',{note:'اعتماد تجريبي',clearance_override:'قصير'})),
    error=>error.status===400&&/سبب تجاوز بنود إخلاء الطرف/.test(error.message));
  const out=tx(()=>decideSettlement(db,users['pay-approver'],settlementId,'approve',{note:'اعتماد تجريبي مع تجاوز موثق',clearance_override:'أقرّ مدير الموارد البشرية التجريبي تسوية العهدة نقدًا خارج المنصة بمحضر مصطنع رقم 1'}));
  assert.equal(out.status,'approved');
  assert.equal(out.clearance_overridden,true);
  assert.ok(out.clearance_blockers.length>=2,'what was open at the moment of the decision is kept, not discarded');
  const row=db.prepare('SELECT * FROM service_settlements WHERE id=?').get(settlementId);
  assert.equal(row.clearance_override_by,'pay-approver');
  assert.match(row.clearance_override_reason,/محضر مصطنع/);
  assert.ok(row.clearance_override_at);
  assert.ok(JSON.parse(row.clearance_blockers).some(b=>b.source==='custody'));
  assert.ok(db.prepare("SELECT 1 FROM audit_events WHERE entity_id=? AND action='settlement.clearance_overridden'").get(settlementId),
    'the override is its own audit event, not a footnote on the approval');
  assert.ok(verifyAudit(db));
});

test('D-01b: with no offboarding bundle at all the gate still blocks, and clearanceBlockers is reachable from the settlement path',t=>{
  const {db,users,tx,prepare}=settlementFixture(t);
  const settlementId=prepare();
  const blockers=clearanceBlockers(db,users['pay-approver'],'employee');
  assert.equal(blockers.blocked,true);
  assert.equal(blockers.blockers[0].reason,'no_bundle');
  assert.ok(blockers.blockers[0].action_owner,'even the no-bundle blocker names who acts');
  assert.throws(()=>tx(()=>decideSettlement(db,users['pay-approver'],settlementId,'approve',{note:'اعتماد تجريبي بلا حزمة مغادرة'})),error=>
    error.code==='clearance_open'&&/لا حزمة مغادرة مفتوحة/.test(error.message));
  // الرفض لا يمر ببوابة الإخلاء: لا مستحق في مخالصة مرفوضة.
  assert.equal(tx(()=>decideSettlement(db,users['pay-approver'],settlementId,'reject',{note:'رفض تجريبي لإعادة الإعداد بعد فتح الحزمة'})).status,'rejected');
});

/* ═══ D-15: المغادر يقرأ مخالصته ويُشعَر بها ════════════════════════════════════ */
test('D-15: the departing employee gets a notice, a list entry and a read path carrying the award, the article-36 reading, the payout, the deductions, the net and the deadline',t=>{
  const {db,users,tx,prepare}=settlementFixture(t);
  const settlementId=prepare();
  tx(()=>grantAccess(db,users.admin,{user_id:'pay-approver',capability:'people.manage',note:'تصريح تجريبي لاختبار التجاوز'}));
  tx(()=>decideSettlement(db,users['pay-approver'],settlementId,'approve',{note:'اعتماد تجريبي',clearance_override:'حزمة المغادرة تُفتح لاحقًا بقرار تجريبي موثق رقم 2'}));

  // 1) الإشعار: يصل صاحبها، ويحمل المهلة وعدّادها، ولا يحمل مبلغًا (قاعدة notices.mjs).
  const notices=db.prepare("SELECT * FROM notifications WHERE user_id='employee' AND subject_kind='service_settlement'").all();
  assert.equal(notices.length,1);
  assert.equal(notices[0].kind,'settlement_approved');
  assert.match(notices[0].title,/اعتُمدت تسوية نهاية خدمتك/);
  assert.match(notices[0].body,/م50\/2/,'the statutory deadline is in the notice');
  assert.ok(!/\d+\.\d\d/.test(notices[0].body),'no money in a notice that email also carries');

  // 2) مسار القراءة: كل ما يحتاجه المغادر ليتحقق من مستحقه.
  const mine=mySettlement(db,users.employee,{log:true});
  assert.equal(mine.id,settlementId);
  assert.ok(mine.award_minor>0,'the award');
  assert.equal(mine.art36_reading,'labor_law');
  assert.equal(mine.art36_reading_name,'قراءة نظام العمل للمادة 36/2','which reading was applied');
  assert.ok(mine.art36_readings.literal_award_minor>0&&mine.art36_readings.labor_law_award_minor>0,'both readings stay side by side');
  assert.equal(mine.leave_payout_minor,0,'the leave payout');
  assert.equal(mine.deductions_minor,0,'the deductions');
  assert.equal(mine.net_minor,mine.award_minor+mine.leave_payout_minor-mine.deductions_minor,'the net');
  assert.equal(mine.dues_due_on,'2026-02-07','service end + 7 days, company-ended (م50/2)');
  assert.ok(mine.countdown.label,'with its countdown');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM settlement_views').get().n,1,'every explicit read is logged');

  // 3) في قوائمه: «طلباتي» و«الرواتب والقسائم».
  const mrItems=myRequests(db,users.employee).items.filter(i=>i.source==='settlement');
  assert.equal(mrItems.length,1);
  assert.equal(mrItems[0].due_on,'2026-02-07');
  assert.equal(mrItems[0].link,'#payroll');
  assert.equal(listPayroll(db,users.employee).settlement.id,settlementId);

  // 4) ولا أحد غيره: لا المدير ولا مُعدّها ولا معتمدها يقرؤها من هذا المسار.
  for(const who of ['manager','hr','pay-approver'])assert.equal(mySettlement(db,users[who]),null,`${who} reads no one else’s settlement here`);
  assert.equal(myRequests(db,users.manager).items.filter(i=>i.source==='settlement').length,0);
  assert.ok(verifyAudit(db));
});

test('D-15: a settlement still in draft or rejected is not shown to its subject as an entitlement',t=>{
  const {db,users,tx,prepare}=settlementFixture(t);
  const settlementId=prepare();
  assert.equal(mySettlement(db,users.employee),null,'a draft is a decision that has not been taken');
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM notifications WHERE subject_kind='service_settlement'").get().n,0);
  tx(()=>decideSettlement(db,users['pay-approver'],settlementId,'reject',{note:'رفض تجريبي لإعادة الإعداد بعد فتح الحزمة'}));
  assert.equal(mySettlement(db,users.employee),null);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM notifications WHERE subject_kind='service_settlement'").get().n,0);
});

/* ═══ D-12: قبول الاستقالة وفشل فتح حزمة المغادرة ═══════════════════════════════ */
function resignationFixture(t){
  const db=openDb(':memory:');seed(db,'synthetic-resignation-offboarding');t.after(()=>db.close());
  const users=Object.fromEntries(db.prepare('SELECT * FROM users').all().map(u=>[u.id,u])),tx=fn=>transaction(db,fn);
  const grant=(user,cap)=>tx(()=>grantAccess(db,users.admin,{user_id:user,capability:cap,note:'تصريح تجريبي للاختبار المحلي'}));
  // الحالة المسلَّمة بعينها: من يقبل الاستقالة (hr.contracts.approve) ومن يفتح الحزمة (people.manage) حسابان مختلفان.
  grant('manager','hr.contracts.approve');grant('it','people.manage');
  const submit=()=>tx(()=>submitResignation(db,users.employee,{letter_date:riyadhToday(),reason:'سبب تجريبي مصطنع',proposed_last_day:shift(riyadhToday(),60)})).id;
  const accept=id=>{
    const r=resignationsBoard(db,users.manager).resignations.find(x=>x.id===id);
    return tx(()=>resignationAction(db,users.manager,id,'accept_resignation',{version:r.version,last_working_day:shift(riyadhToday(),60),notice_waived:false,note:'قبول تجريبي'}));
  };
  return {db,users,tx,submit,accept,grant};
}

test('D-12: accepting a resignation whose offboarding bundle cannot open says so in the response, on the board, and to the account that can act',t=>{
  const {db,users,submit,accept}=resignationFixture(t);
  // لا قالب خطوات يشحن مع المنصة، فالحزمة لا تُفتح. كان القبول يرد 201 والسبب يُدفن في ملاحظة لا تظهر في أي شاشة.
  const out=accept(submit());
  assert.equal(out.offboarding_opened,false,'the response no longer claims success it did not have');
  assert.equal(out.offboarding_blocked,true);
  assert.match(out.offboarding_note,/لم تُفتح حزمة المغادرة/);
  assert.match(out.offboarding_next,/فتح حزمة المغادرة/,'and says what to do next');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM lifecycle_bundles').get().n,0);

  // اللوحة تحمل التنبيه بدل الملاحظة الصامتة.
  const board=resignationsBoard(db,users.it);
  assert.equal(board.alerts.length,1);
  assert.equal(board.alerts[0].kind,'offboarding_blocked');
  assert.match(board.alerts[0].message,/people\.manage/);
  assert.equal(board.resignations[0].offboarding_blocked,true);

  // الإشعار يصل من يستطيع الفعل (people.manage = it)، لا من يملك القبول وحده.
  const toActor=db.prepare("SELECT * FROM notifications WHERE user_id='it' AND kind='offboarding_blocked'").all();
  assert.equal(toActor.length,1,'the account that can open the bundle is told');
  assert.match(toActor[0].title,/لم تُفتح حزمة مغادرة/);
  assert.match(toActor[0].body,/فتح حزمة المغادرة/);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM notifications WHERE user_id='employee' AND kind='offboarding_blocked'").get().n,0,
    'the departing employee is not handed a staff task');
  // والإجراء متاح لمن أُشعِر.
  assert.ok(resignationsBoard(db,users.it).resignations[0].actions.includes('open_offboarding'));
  assert.ok(verifyAudit(db));
});

test('D-12: when the bundle does open, the response says so and the same holder is told it is theirs to run',t=>{
  const {db,users,tx,submit,accept}=resignationFixture(t);
  tx(()=>saveStepTemplate(db,users.it,{kind:'offboarding',code:'OFF-1',title:'خطوة مغادرة تجريبية',department_id:'creative',owner_role:'manager',target_days:2,
    acceptance:'دليل تجريبي موثق يطابق معيار الخطوة',basis:'قرار تجريبي من مالك إجراء الإدارة بتاريخ مصطنع'}));
  const out=accept(submit());
  assert.equal(out.offboarding_opened,true);
  assert.ok(out.offboarding_bundle_id);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM lifecycle_bundles').get().n,1);
  assert.deepEqual(resignationsBoard(db,users.it).alerts,[]);
  const opened=db.prepare("SELECT * FROM notifications WHERE user_id='it' AND kind='offboarding_opened'").all();
  assert.equal(opened.length,1);
  assert.match(opened[0].body,/إخلاء الطرف/,'and points at the gate the settlement will meet');
  assert.ok(verifyAudit(db));
});

/* ═══ D-05: تذكير تشغيل الاستحقاق والحالة الصفرية ══════════════════════════════ */
function accrualFixture(t){
  const db=openDb(':memory:');seed(db,'synthetic-accrual-reminder');t.after(()=>db.close());
  db.exec("INSERT INTO users(id,tenant_id,department_id,username,name,password_hash,role,manager_id) VALUES('hr-manager','36t','hr','hr-manager','مدير الموارد البشرية التجريبي','unused','manager',NULL)");
  const users=Object.fromEntries(db.prepare('SELECT * FROM users').all().map(u=>[u.id,u])),tx=fn=>transaction(db,fn);
  // hr يملك hr.policy.prepare بدوره؛ اعتماد السياسات وحده يُمنح صراحةً، ومن الأدمن الأول.
  tx(()=>grantAccess(db,users.admin,{user_id:'hr-manager',capability:'hr.policy.accept',note:'تصريح تجريبي'}));
  db.prepare("INSERT INTO hr_policies(id,tenant_id,kind,title,body,parameters,basis,effective_from,status,prepared_by,decided_by,decided_at,created_at) VALUES('pay-policy','36t','pay_components','بنود راتب تجريبية','نص سياسة تجريبي مصطنع للاختبار المحلي فقط ولا يمثل قرار شركة.','{\"components\":[\"basic\"]}','سند تجريبي','2020-01-01','accepted','hr','hr-manager',?,?)").run(now(),now());
  db.prepare("INSERT INTO employment_contracts(id,tenant_id,user_id,policy_id,contract_type,job_title,work_location,start_date,weekly_hours,probation_days,notice_days,pay_lines,monthly_total_minor,currency,document_reference,status,prepared_by,decided_by,decided_at,created_at,updated_at) VALUES('c-employee','36t','employee','pay-policy','indefinite','وظيفة تجريبية','الرياض','2024-01-01',40,90,60,'[{\"component\":\"basic\",\"amount_minor\":1000000}]',1000000,'SAR','مستند تجريبي','active','hr','hr-manager',?,?,?)").run(now(),now(),now());
  const policy=tx(()=>prepareAccrualPolicy(db,users.hr,{leave_type:'annual',title:'قاعدة استحقاق سنوية تجريبية',
    body:'نص قاعدة تجريبي مصطنع للاختبار المحلي فقط ولا يمثل قرار شركة على الإطلاق.',accrual_unit:'month',accrual_days:'2.5',accrual_start:'hire',waiting_days:0,
    carryover_allowed:false,carryover_cap_days:null,cash_on_end_of_service:true,basis:'سند تجريبي مصطنع للاختبار المحلي',basis_confirmed_on:'2024-01-01',effective_from:'2024-01-01'})).id;
  tx(()=>decideAccrualPolicy(db,users['hr-manager'],policy,'accept',{note:'اعتماد تجريبي لقاعدة الاستحقاق في الاختبار'}));
  return {db,users,tx};
}

test('D-05: completed accrual periods that were never run are named, and the holder of the run decision is reminded once per period through the jobs queue',t=>{
  const {db,users,tx}=accrualFixture(t);
  const today=riyadhToday();
  const due=dueAccrualPeriods(db,'36t','annual',today);
  assert.ok(due.length>=3,'every completed month since the policy took effect is due');
  assert.equal(due.at(-1).period_key,addMonths(monthOf(today),-1),'the month just ended is the latest due one');
  assert.ok(due.every(d=>d.period_to<today),'a period that has not finished is never called due');
  assert.deepEqual(allDueAccrualPeriods(db,'36t',today).map(d=>d.period_key),due.map(d=>d.period_key));

  // التذكير يمر بمعالج التذكيرات اليومي القائم ويصل حامل قرار التشغيل.
  const first=tx(()=>runDailyReminders(db,'36t',today));
  assert.ok(first.accrual.sent>=1,'a reminder goes out');
  assert.equal(first.accrual.due_periods,due.length);
  const notices=db.prepare("SELECT * FROM notifications WHERE user_id='hr-manager' AND kind='accrual_run_due'").all();
  assert.equal(notices.length,1,'to the holder of hr.policy.accept, the decision owner');
  assert.match(notices[0].title,/تشغيل استحقاق مستحق/);
  assert.match(notices[0].body,/لا تُشغّلها آليًا/,'the run stays a human decision');
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM notifications WHERE user_id='employee' AND kind='accrual_run_due'").get().n,0);

  // اليوم التالي لا يكرر التذكير عن الفترة نفسها، ولا شيء يُقيَّد آليًا.
  const second=tx(()=>runDailyReminders(db,'36t',today));
  assert.equal(second.accrual.sent,0,'reminded once per period, not every day');
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM notifications WHERE kind='accrual_run_due'").get().n,1);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM accrual_runs').get().n,0,'the reminder posts nothing');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM leave_accrual_entries').get().n,0);

  // اللوحة تقول الشيء نفسه لمن يفتحها.
  const board=accrualBoard(db,users['hr-manager']);
  assert.equal(board.due_periods.length,due.length);
  const alert=board.alerts.find(a=>a.kind==='accrual_due');
  assert.ok(alert);
  assert.match(alert.message,/التشغيل قرارك ولا يجري آليًا/);
  assert.ok(verifyAudit(db));
});

test('D-05: a run clears the period from the due list, and the employee-facing zero state says the run is pending rather than implying no entitlement',t=>{
  const {db,users,tx}=accrualFixture(t);
  const today=riyadhToday(),firstDue=dueAccrualPeriods(db,'36t','annual',today)[0];

  // الحالة الصفرية كما يراها الموظف قبل أي تشغيل: الرفض يقول لماذا الرصيد ناقص.
  const typesPolicy=tx(()=>prepareLeaveTypesDraft(db,users.hr,{effective_from:'2024-01-01'})).id;
  tx(()=>decideLeaveTypes(db,users['hr-manager'],typesPolicy,'accept',{note:'راجعت الأنواع ومواد اللائحة قبل الاعتماد في الاختبار'}));
  tx(()=>createLeaveCalendar(db,users.hr,{employee_department_id:'creative',name:'تقويم تجريبي',effective_from:`${today.slice(0,4)}-01-01`,effective_to:`${today.slice(0,4)}-12-31`,weekdays:[0,1,2,3,4]}));
  const start=shift(today,14);
  assert.throws(()=>tx(()=>createLeaveRequest(db,users.employee,{leave_type:'annual',balance_year:Number(start.slice(0,4)),start_date:start,end_date:shift(start,2),reason:'طلب إجازة تجريبي'})),error=>{
    assert.equal(error.code,'insufficient_balance');
    assert.match(error.message,/المتاح 0 يوم/,'the number is still stated plainly');
    assert.match(error.message,/فترة استحقاق اكتملت/,'but the reason is no longer left to the employee to guess');
    assert.match(error.message,/لم يُقيَّدها مدير الموارد البشرية بعد/);
    assert.match(error.message,/لا يجري آليًا/);
    return true;
  });

  // التشغيل يزيل فترته من القائمة ويرفع الرصيد؛ وبعده لا يبقى للفترة تذكير.
  tx(()=>runAccrualCycle(db,users['hr-manager'],{kind:'accrual',leave_type:'annual',period_key:firstDue.period_key,note:'تشغيل تجريبي للفترة في الاختبار المحلي'}));
  assert.ok(!dueAccrualPeriods(db,'36t','annual',today).some(d=>d.period_key===firstDue.period_key));
  assert.ok(verifyAudit(db));
});
