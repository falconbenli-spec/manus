import test from 'node:test';
import assert from 'node:assert/strict';
import { openDb, transaction, verifyAudit } from '../app/db.mjs';
import { seed } from '../scripts/seed.mjs';
import * as wf from '../app/workflow.mjs';
import { installServiceCatalog, catalogServices, fieldModel, policyProposals, adoptPolicyProposal, catalogHealth, approvalSettings, SOD_SERVICES, CONFIDENTIAL_SERVICES } from '../app/service-catalog.mjs';
import { SERVICE_MODULES, PENDING_SERVICE_MODULES, serviceModulesFor, serviceCard } from '../app/service-cards.mjs';
import { operationModules } from '../app/static/operations.mjs';
import { saveIntake, freezeIntake } from '../app/request-intake.mjs';

// تدقيق سير العمل B1–B9: خطوات عابرة للإدارات، حدود بالمبالغ، مسار مباشر، فصل الاعتماد عن التنفيذ،
// دمج الاعتماد المكرر، المعتمد البديل، الخدمات السرية، منع المستفيد، ربط الوحدات وفحص الإعداد.
const code=value=>error=>error.code===value;
const today=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Riyadh',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
function fixture(t){
  const db=openDb(':memory:');seed(db,'synthetic-approval-engine');installServiceCatalog(db);t.after(()=>db.close());
  const clone=(id,dept,role,manager=null)=>db.prepare("INSERT INTO users(id,tenant_id,department_id,username,name,password_hash,role,manager_id) SELECT ?,tenant_id,?,?,?,password_hash,?,? FROM users WHERE id='manager'").run(id,dept,id,'حساب مصطنع '+id,role,manager);
  const user=id=>db.prepare('SELECT * FROM users WHERE id=?').get(id);
  const tx=f=>transaction(db,f);
  const service=c=>wf.catalog(db,user('employee')).find(s=>s.code===c);
  const draft=(who,c,payload,title='طلب اختبار المحرك')=>tx(()=>wf.createRequest(db,user(who),{service_id:service(c).id,title,payload,project_id:null}));
  const act=(who,r,action,note='سبب القرار التجريبي')=>tx(()=>wf.transition(db,user(who),r.id,action,{version:wf.getRequest(db,user(who),r.id).version,note}));
  const submit=(who,r)=>act(who,r,'submit','');
  const steps=r=>db.prepare('SELECT a.*,b.basis,b.replaced_user_id,b.step_role,b.department_id FROM approval_steps a LEFT JOIN approval_step_basis b ON b.step_id=a.id WHERE a.request_id=? AND a.revision=? ORDER BY a.position').all(r.id,r.revision);
  return {db,clone,user,tx,service,draft,act,submit,steps};
}
const spendService=(extra={})=>({code:'TEST-SPEND',name_ar:'صرف تجريبي متدرج',name_en:'Tiered spend',department_id:'creative',description:'خدمة اختبار لتدرج الاعتماد بالمبلغ',
  fields:[{key:'amount',label:'المبلغ بالريال',type:'number',required:true},{key:'purpose',label:'الغرض',type:'text',required:true}],
  approval_policy:{steps:['manager',{role:'department_manager',department:'finance',when:{field:'amount',gte_setting:'test.finance_review'}},{role:'executive',when:{field:'amount',gte_setting:'test.executive_review'}}],handler_role:'manager'},...extra});
function threshold(f,key,riyals,effective=today()){
  const {db,user,tx}=f;
  const row=tx(()=>wf.proposeThreshold(db,user('admin'),{setting_key:key,amount_minor:riyals*100,basis:'قرار الرئاسة التجريبي رقم 1 لمصفوفة الصلاحيات',effective_from:effective}));
  return tx(()=>wf.decideThreshold(db,user('vp-corporate'),row.id,{version:row.version,decision:'approve',note:''}));
}

test('B1: policy validation — up to five steps, cross-department and executive steps, and a threshold that lives in settings, never in the service',t=>{
  const {db,user,tx}=fixture(t),admin=user('admin'),make=policy=>tx(()=>wf.createService(db,admin,spendService({approval_policy:policy})));
  const base=spendService().approval_policy;
  assert.equal(make(base).approval_policy.steps.length,3);
  assert.throws(()=>make({...base,steps:[...base.steps,'hr','it','pm']}),code('policy'),'six steps exceed the maximum of five');
  assert.ok(make({...base,steps:[...base.steps,'hr','it']}),'five steps are accepted');
  assert.throws(()=>make({...base,steps:['manager',{role:'department_manager',department:'finance',when:{field:'amount',gte:500000}}]}),code('invalid_fields'),'an amount written into the service is refused');
  assert.throws(()=>make({...base,steps:['manager',{role:'department_manager',department:'finance',when:{field:'purpose',gte_setting:'test.finance_review'}}]}),code('policy'),'a threshold needs a number field');
  assert.throws(()=>make({...base,steps:['manager',{role:'department_manager',department:'no-such-unit'}]}),code('policy'));
  assert.throws(()=>make({...base,steps:[{role:'manager',department:'finance'}]}),code('policy'),'the direct manager follows the requester');
  assert.throws(()=>make({...base,steps:['department_manager',{role:'department_manager'}]}),code('policy'),'the same role and department twice');
  assert.throws(()=>make({...base,steps:[{role:'executive',when:{field:'amount',gte_setting:'test.executive_review'}}]}),code('policy'),'a non-direct service needs an unconditional step');
  assert.throws(()=>make({...base,steps:[]}),code('policy'),'no steps without the direct mode');
  assert.throws(()=>make({...base,sod:'yes'}),code('policy'));
  // الشكل القديم يُخزن كما هو حرفيًا.
  const legacy=tx(()=>wf.createService(db,admin,{...spendService(),code:'TEST-LEGACY',approval_policy:{steps:['manager','department_manager'],handler_role:'manager'}}));
  assert.equal(db.prepare('SELECT approval_policy FROM services WHERE id=?').get(legacy.id).approval_policy,JSON.stringify({steps:['manager','department_manager'],handler_role:'manager'}));
});

test('B1: an undefined threshold never skips its step; a defined, approved and effective one adds the step only at or above it',t=>{
  const f=fixture(t),{db,user,tx,draft,submit,act,steps}=f;
  tx(()=>wf.createService(db,user('admin'),spendService()));
  const run=amount=>submit('employee',draft('employee','TEST-SPEND',{amount,purpose:'شراء تجريبي'}));
  // لا حد معرّف: الخطوتان المشروطتان تُطلبان احتياطًا مع ملاحظة.
  let r=run('100');
  assert.deepEqual(steps(r).map(s=>s.approver_id),['manager','head-finance','vp-growth']);
  assert.ok(r.approval_notes.some(n=>n.includes('حد الاعتماد غير معرّف')));
  assert.equal(r.versions.at(-1).snapshot.approval_plan[1].condition.outcome,'threshold_unset');
  assert.throws(()=>act('head-grc',r,'approve'),error=>[403,404].includes(error.status),'another department head is out of scope');
  r=act('manager',r,'approve');r=act('head-finance',r,'approve');
  assert.equal(r.status,'pending');r=act('vp-growth',r,'approve');assert.equal(r.status,'approved');
  // حد مقترح غير معتمد لا يسري، والمُدخل لا يعتمد، ومن ليس من الرئاسة لا يعتمد.
  const proposed=tx(()=>wf.proposeThreshold(db,user('admin'),{setting_key:'test.finance_review',amount_minor:500000,basis:'قرار الرئاسة التجريبي رقم 1 لمصفوفة الصلاحيات',effective_from:today()}));
  assert.equal(steps(run('100')).length,3,'a proposed threshold is not in force');
  assert.throws(()=>tx(()=>wf.decideThreshold(db,user('head-finance'),proposed.id,{version:1,decision:'approve',note:''})),code('not_permitted'));
  assert.throws(()=>db.prepare("UPDATE approval_thresholds SET status='approved',decided_by=proposed_by,decided_at='2026-09-18',version=version+1").run(),/CHECK/,'the database refuses the proposer as approver');
  tx(()=>wf.decideThreshold(db,user('vp-corporate'),proposed.id,{version:1,decision:'approve',note:'معتمد'}));
  threshold(f,'test.executive_review',50000);
  const small=run('1000'),medium=run('5000'),large=run('50000.50');
  assert.deepEqual(steps(small).map(s=>s.approver_id),['manager'],'below both thresholds: the direct manager only');
  assert.deepEqual(steps(medium).map(s=>[s.position,s.approver_id]),[[0,'manager'],[1,'head-finance']],'at the finance threshold');
  assert.deepEqual(steps(large).map(s=>s.approver_id),['manager','head-finance','vp-growth']);
  assert.equal(steps(large)[2].basis,'executive');
  assert.deepEqual(small.approval_notes,[]);
  // حد لاحق السريان لا يسري قبل تاريخه، والحد الأحدث الساري يحل محل الأقدم.
  threshold(f,'test.finance_review',1,'2099-01-01');
  assert.equal(steps(run('1000')).length,1,'a future threshold waits for its effective date');
  assert.throws(()=>db.prepare('DELETE FROM approval_thresholds').run(),/retained/);
  assert.ok(verifyAudit(db));
});

test('B2: a direct service is approved on submission, its handlers are told at once, and catalog proposals apply only after a recorded adoption',t=>{
  const f=fixture(t),{db,user,tx,draft,submit,act,steps}=f,admin=user('admin');
  tx(()=>wf.createService(db,admin,{code:'TEST-DIRECT',name_ar:'بلاغ مباشر',name_en:'Direct report',department_id:'ceo-office',description:'بلاغ اختبار بلا اعتماد',fields:[{key:'detail',label:'الوصف',type:'text',required:true}],approval_policy:{steps:[],mode:'direct',handler_role:'manager'}}));
  let r=submit('employee',draft('employee','TEST-DIRECT',{detail:'خطر مصطنع'}));
  assert.equal(r.status,'approved');assert.equal(steps(r).length,0);
  assert.ok(db.prepare("SELECT 1 FROM notifications WHERE user_id='head-ceo-office' AND request_id=? AND kind='ready_for_execution'").get(r.id));
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM outbox WHERE request_id=?').get(r.id).n,1);
  r=act('head-ceo-office',r,'claim');assert.equal(r.status,'in_progress');
  // مقترح الكتالوج لا يسري بلا تبنٍّ، ويتبناه مسؤول الكتالوج بسند، ولا يلغيه إعادة التثبيت.
  assert.equal(f.service('ADM-SAFETY').approval_policy.mode,undefined);
  assert.throws(()=>tx(()=>adoptPolicyProposal(db,user('head-ceo-office'),'b2-safety-direct',{basis:'قرار مدير المكتب التجريبي'})),code('not_permitted'));
  assert.throws(()=>tx(()=>adoptPolicyProposal(db,admin,'b2-safety-direct',{basis:'قصير'})),code('basis'));
  tx(()=>adoptPolicyProposal(db,admin,'b2-safety-direct',{basis:'تدقيق سير العمل B2 — اعتماد تجريبي'}));
  assert.equal(f.service('ADM-SAFETY').approval_policy.mode,'direct');
  const again=installServiceCatalog(db);assert.equal(again.revised,0,'an adopted policy survives a reinstall');
  const safety=submit('employee',draft('employee','ADM-SAFETY',{hazard:'خطر حريق',location:'الدور الثاني',description:'تمديد كهربائي مكشوف',urgency:'عاجل'}));
  assert.equal(safety.status,'approved');
  tx(()=>adoptPolicyProposal(db,admin,'b2-safety-direct',{basis:'رجوع تجريبي عن المسار المباشر',withdraw:true}));
  assert.equal(f.service('ADM-SAFETY').approval_policy.mode,undefined);
  assert.equal(installServiceCatalog(db).revised,0);
  // بطاقة الدخول: بدل الفاقد مباشر، والإصدار الجديد يبقى باعتمادين.
  tx(()=>adoptPolicyProposal(db,admin,'b2-lost-card-direct',{basis:'تدقيق سير العمل B2 — بدل الفاقد'}));
  const lost=submit('employee',draft('employee','ADM-ACCESS-CARD',{action:'بدل فاقد',access_area:'المكتب'}));
  assert.equal(lost.status,'approved');
  const fresh=submit('employee',draft('employee','ADM-ACCESS-CARD',{action:'إصدار جديد',access_area:'المكتب'}));
  assert.equal(fresh.status,'pending');assert.deepEqual(steps(fresh).map(s=>s.approver_id),['manager','head-ceo-office']);
  assert.ok(policyProposals.every(p=>catalogServices.some(s=>s.code===p.code)));
  assert.ok(verifyAudit(db));
});

test('B3: in a sod service whoever approved any step of the current revision can neither claim nor complete; another member of the executing department can',t=>{
  const f=fixture(t),{db,clone,user,tx,draft,submit,act}=f;
  clone('fin-clerk','finance','employee');
  // فصل المهام في تعريف الخدمة الحسّاسة نفسه، فيصل مُشغَّلًا مع الكتالوج بلا تبنٍّ ولا قرار كيان.
  assert.equal(f.service('FIN-REFUND').approval_policy.sod,true);
  assert.ok(SOD_SERVICES.every(c=>f.service(c)?.approval_policy.sod),'the twenty-two ship with the control on');
  assert.equal(installServiceCatalog(db).revised,0,'and a reinstall does not churn the version');
  assert.deepEqual(f.service('FIN-REFUND').approval_policy.steps,['manager','department_manager'],'the flag does not change who approves');
  let r=submit('employee',draft('employee','FIN-REFUND',Object.fromEntries(f.service('FIN-REFUND').fields.filter(x=>x.required).map(x=>[x.key,x.type==='number'?'150':x.type==='select'?x.options[0]:x.type==='date'?'2026-10-01':'قيمة تجريبية']))));
  r=act('manager',r,'approve');r=act('head-finance',r,'approve');assert.equal(r.status,'approved');
  assert.ok(!wf.detail(db,user('head-finance'),r.id).actions.includes('claim'),'the approving head does not execute');
  assert.throws(()=>act('head-finance',r,'claim'),code('transition_denied'));
  assert.ok(wf.detail(db,user('fin-clerk'),r.id).actions.includes('claim'),'any active member of the executing department executes');
  r=act('fin-clerk',r,'claim');
  assert.throws(()=>act('fin-clerk',r,'complete','أُصدر الإشعار الدائن التجريبي'),code('service_output_required'),'the permitted executor reaches the independent delivery gate');
  assert.equal(wf.getRequest(db,user('fin-clerk'),r.id).status,'in_progress');
  assert.ok(!f.service('ADM-TRAVEL').approval_policy.sod,'a service not flagged keeps approver-executes');
  // والخدمة الحسّاسة ينفّذها أي عضو نشط في إدارتها، وإلا توقّفت عند مدير يعتمد ولا ينفذ.
  assert.equal(f.service('FIN-REFUND').approval_policy.handler_role,'member');
});

test('B4: when two steps resolve to one person the second rises to the escalation approver and the snapshot records it',t=>{
  const f=fixture(t),{db,clone,user,draft,submit,act,steps}=f;
  clone('fin-analyst','finance','employee','head-finance');
  let r=submit('fin-analyst',draft('fin-analyst','FIN-CUSTODY',Object.fromEntries(f.service('FIN-CUSTODY').fields.filter(x=>x.required).map(x=>[x.key,x.type==='number'?'900':x.type==='select'?x.options[0]:x.type==='date'?'2026-10-01':'قيمة تجريبية']))));
  const route=steps(r);
  assert.deepEqual(route.map(s=>s.approver_id),['head-finance','vp-corporate']);
  assert.equal(route[1].basis,'duplicate_escalation');assert.equal(route[1].replaced_user_id,'head-finance');
  const plan=r.versions.at(-1).snapshot.approval_plan;assert.equal(plan[1].basis,'duplicate_escalation');
  r=act('head-finance',r,'approve');
  assert.throws(()=>act('head-finance',r,'approve'),code('transition_denied'),'one person does not count as two approvals');
  r=act('vp-corporate',r,'approve');assert.equal(r.status,'approved');
  // مسار عادي بلا تكرار لا يتغير.
  const normal=submit('employee',draft('employee','FIN-CUSTODY',Object.fromEntries(f.service('FIN-CUSTODY').fields.filter(x=>x.required).map(x=>[x.key,x.type==='number'?'900':x.type==='select'?x.options[0]:x.type==='date'?'2026-10-01':'قيمة تجريبية']))));
  assert.deepEqual(steps(normal).map(s=>[s.approver_id,s.basis]),[['manager','standard'],['head-finance','standard']]);
  assert.equal(normal.versions.at(-1).snapshot.approval_plan,undefined,'the legacy snapshot shape stays when nothing changed');
});

test('B4: a department head request uses two distinct executives instead of counting one decision twice',t=>{
  const f=fixture(t),{draft,submit,steps}=f;
  const service=f.service('FIN-PAYMENT-REQUEST');
  const payload=Object.fromEntries(service.fields.filter(field=>field.required).map(field=>[
    field.key,field.type==='number'?'5000':field.type==='select'?field.options[0]:field.type==='date'?'2026-10-03':'قيمة تجريبية كافية لمسار الاعتماد'
  ]));
  const request=draft('head-finance','FIN-PAYMENT-REQUEST',payload);
  const submitted=submit('head-finance',request),route=steps(submitted);
  assert.deepEqual(route.map(step=>step.approver_id),['vp-corporate','ceo']);
  assert.equal(route[1].basis,'duplicate_escalation');
  assert.equal(new Set(route.map(step=>step.approver_id)).size,route.length);
});

test('B4: submission fails safely only when no distinct escalation or executive exists',t=>{
  const f=fixture(t),{db,tx,draft,submit}=f;
  tx(()=>{
    db.prepare("UPDATE users SET active=0 WHERE id IN ('ceo','vp-growth')").run();
    db.prepare("DELETE FROM department_escalation WHERE department_id='ceo-office'").run();
  });
  const service=f.service('FIN-PAYMENT-REQUEST');
  const payload=Object.fromEntries(service.fields.filter(field=>field.required).map(field=>[
    field.key,field.type==='number'?'5000':field.type==='select'?field.options[0]:field.type==='date'?'2026-10-03':'قيمة تجريبية كافية لمسار الاعتماد'
  ]));
  const request=draft('head-finance','FIN-PAYMENT-REQUEST',payload);
  assert.throws(()=>submit('head-finance',request),code('approval_route_not_distinct'));
});

test('B5: the assigned HR approver can request a salary certificate for themselves through the fallback or the escalation approver',t=>{
  const f=fixture(t),{db,user,tx,draft,submit,act,steps}=f;
  const payload={recipient_kind:'بنك',recipient_bank:'مصرف الراجحي',language:'العربية',show_salary:'الإجمالي فقط'};
  // بلا بديل مسجل: مرجع تصعيد الإدارة.
  let r=submit('hr',draft('hr','HR-SALARY-CERT',payload));
  assert.deepEqual(steps(r).map(s=>[s.approver_id,s.basis]),[['vp-corporate','escalation']]);
  assert.ok(r.approval_notes.some(n=>n.includes('مرجع تصعيد')));
  assert.throws(()=>tx(()=>wf.setApprovalFallback(db,user('hr'),{department_id:'hr',step_role:'hr',fallback_user_id:'head-hr',note:'تغطية تجريبية'})),code('not_permitted'));
  tx(()=>wf.setApprovalFallback(db,user('admin'),{department_id:'hr',step_role:'hr',fallback_user_id:'head-hr',note:'بديل معتمد HR التجريبي'}));
  r=submit('hr',draft('hr','HR-SALARY-CERT',payload));
  assert.deepEqual(steps(r).map(s=>[s.approver_id,s.basis,s.replaced_user_id]),[['head-hr','fallback','hr']]);
  r=act('head-hr',r,'approve');assert.equal(r.status,'approved');
  // الخدمة سرية ومنفذها الوحيد بدور hr هو الطالب؛ مدير الإدارة المنفذة يستلمها.
  assert.ok(!wf.detail(db,user('hr'),r.id).actions.includes('claim'));
  r=act('head-hr',r,'claim');assert.equal(r.status,'in_progress');
  // سحب البديل يسحب صلاحيته على خطوة لم تُحسم بعد.
  const pending=submit('hr',draft('hr','HR-SALARY-CERT',payload));
  tx(()=>wf.setApprovalFallback(db,user('admin'),{department_id:'hr',step_role:'hr',fallback_user_id:null,note:'إنهاء التغطية'}));
  assert.throws(()=>act('head-hr',pending,'approve'),error=>[403,404].includes(error.status));
  // الشكل القديم للاعتماد الذاتي لم يتغير: مدير مباشر هو صاحب الطلب يتوقف.
  db.prepare("UPDATE users SET role='manager',manager_id='employee' WHERE id='employee'").run();
  assert.throws(()=>submit('employee',draft('employee','HR-LETTER',{purpose:'غرض تجريبي',recipient:'جهة'})),code('self_approval'));
});

test('B6: a confidential service is visible to the requester, its approvers, the assignee and the executing department head — not to the whole team',t=>{
  const f=fixture(t),{db,clone,user,draft,submit,act}=f;
  let g=submit('employee',draft('employee','HR-GRIEVANCE',{category:'بيئة العمل',description:'وصف تجريبي سري للشكوى',expected:'معالجة عادلة'}));
  g=act('hr',g,'approve');assert.equal(g.status,'approved');
  let p=submit('employee',draft('employee','HR-PROFILE-UPDATE',{change_type:'بيانات التواصل',details:'رقم الجوال الجديد التجريبي'}));
  p=act('hr',p,'approve');
  clone('hr2','hr','hr');
  assert.throws(()=>wf.getRequest(db,user('hr2'),g.id),code('not_found'),'another HR team member cannot open the grievance');
  assert.ok(!wf.listRequests(db,user('hr2')).some(r=>r.id===g.id));
  assert.ok(wf.getRequest(db,user('hr2'),p.id),'a non-confidential request stays open to the handling team');
  assert.ok(wf.listRequests(db,user('head-hr')).some(r=>r.id===g.id),'the executing department head sees it');
  assert.ok(wf.getRequest(db,user('hr'),g.id),'the approver keeps it');
  g=act('hr',g,'claim');
  assert.throws(()=>wf.getRequest(db,user('manager'),g.id),code('not_found'));
  assert.ok(CONFIDENTIAL_SERVICES.every(c=>f.service(c).approval_policy.confidential));
  // خطوة المدير المباشر لم تُحذف من خدمات السرية: قرار مالك الإجراء.
  for(const c of ['HR-SALARY-ADVANCE','HR-BENEFIT-CLAIM','HR-EXIT-INTERVIEW'])assert.equal(f.service(c).approval_policy.steps[0],'manager',c);
});

test('B7: the registered beneficiary neither approves nor executes, and the job change no longer offers a pay change',t=>{
  const f=fixture(t),{db,user,tx,draft,submit,act,steps}=f;
  db.prepare("UPDATE users SET manager_id='manager' WHERE id='hr'").run();
  // المستفيد هو المنفذ الوحيد بدور hr؛ وفصل المهام يصل مُشغَّلًا على هذه الخدمة، فينفذها عضو آخر في الإدارة.
  assert.equal(f.service('HR-JOB-CHANGE').approval_policy.sod,true);
  let r=draft('manager','HR-JOB-CHANGE',{employee_name:'معتمدة خدمات الموظف',change_type:'ترقية',new_value:'أخصائية أولى',effective_date:'2026-11-01',justification:'أداء متميز تجريبي'});
  tx(()=>saveIntake(db,user('manager'),r.id,{beneficiary_id:'hr',justification:'ترقية تجريبية لموظفة في الفريق'}));
  r=submit('manager',r);tx(()=>freezeIntake(db,user('manager'),r.id));
  assert.deepEqual(steps(r).map(s=>[s.approver_id,s.basis,s.replaced_user_id]),[['vp-corporate','escalation','hr']],'the beneficiary is not their own approver');
  assert.throws(()=>act('hr',r,'approve'),error=>[403,404].includes(error.status));
  r=act('vp-corporate',r,'approve');assert.equal(r.status,'approved');
  assert.ok(!wf.detail(db,user('hr'),r.id).actions.includes('claim'),'the beneficiary does not execute');
  assert.ok(wf.detail(db,user('head-hr'),r.id).actions.includes('claim'));
  const options=fieldModel('HR-JOB-CHANGE').find(x=>x.key==='change_type').options;
  assert.ok(!options.includes('تعديل الأجر'));assert.match(f.service('HR-JOB-CHANGE').description,/عقد/);
});

test('B8: every mapped screen exists, pending links wait for their screen, and the budget change points to media spend',t=>{
  for(const [service,module] of Object.entries(SERVICE_MODULES))assert.ok(operationModules[module],`${service} → ${module}`);
  assert.equal(SERVICE_MODULES['DIG-BUDGET-CHANGE'],undefined);assert.equal(PENDING_SERVICE_MODULES['DIG-BUDGET-CHANGE'],'media-spend');
  for(const c of ['INF-CAMPAIGN','PRO-SHOOT','HR-SALARY-CERT','LEG-PRIVACY-REQUEST','HR-RESIGNATION','DAT-AI-USE'])assert.ok(PENDING_SERVICE_MODULES[c],c);
  for(const c of ['FIN-PAYMENT-REQUEST','FIN-CLIENT-INVOICE','FIN-REFUND','GOV-CONFLICT-DISCLOSURE','PMO-NEW-PROJECT','HR-BANK-CHANGE'])assert.ok(SERVICE_MODULES[c],c);
  const merged=serviceModulesFor({...operationModules,'media-spend':{}});
  assert.equal(merged['DIG-BUDGET-CHANGE'],'media-spend');assert.equal(merged['INF-CAMPAIGN'],operationModules.influencers?'influencers':undefined);
  const codes=new Set(catalogServices.map(s=>s.code).concat(['HR-LETTER','IT-SUPPORT','CREATIVE-BRIEF']));
  for(const c of [...Object.keys(SERVICE_MODULES),...Object.keys(PENDING_SERVICE_MODULES)])assert.ok(codes.has(c),c);
});

test('B9: the catalog health check names services without an executor, unresolvable steps, undefined thresholds and sod without a second executor',t=>{
  const f=fixture(t),{db,user,tx}=f;
  tx(()=>wf.createService(db,user('admin'),spendService()));
  let health=catalogHealth(db,'36t');
  assert.ok(health.issues.some(i=>i.code==='TEST-SPEND'&&i.kind==='threshold_undefined'&&i.setting_key==='test.finance_review'));
  // التسويق فيه مديره وحده، وهو من يعتمد. قبل سلسلة التنفيذ كانت الخدمة تُعدّ «بلا منفذ»؛ الآن يغطيها
  // سُلَّم تصعيد الإدارة المسجل، فلا تُرفع الملاحظة — والتغطية نفسها تُقرأ في أثر المقترح.
  assert.ok(!health.issues.some(i=>i.code==='DIG-AD-ACCOUNT'&&i.kind==='sod_no_executor'),'the department escalation holder executes it');
  // الضابط المُطفأ يُقرأ مُطفأً: خدمة بلا فصل مهام يعتمدها من ينفّذها تُرفع باسمها.
  assert.ok(health.decider_is_executor.count>0,'the health check names services whose decider executes');
  // ولا خدمة حسّاسة في العدّ: ضابطها يصل مُشغَّلًا، فلا تُقرأ في هذه القائمة أصلًا.
  assert.equal(health.decider_is_executor.sensitive,0);
  assert.ok(!health.decider_is_executor.services.includes('DIG-AD-ACCOUNT'),'a service that ships with sod is not on the list');
  db.prepare("UPDATE users SET active=0 WHERE id='head-pr'").run();
  health=catalogHealth(db,'36t');
  assert.ok(health.issues.some(i=>i.code==='PR-ISSUE-ALERT'&&i.kind==='no_executor'));
  assert.ok(health.issues.some(i=>i.code==='PR-ISSUE-ALERT'&&i.kind==='step_unresolvable'));
  threshold(f,'test.finance_review',5000);threshold(f,'test.executive_review',50000);
  assert.ok(!catalogHealth(db,'36t').issues.some(i=>i.code==='TEST-SPEND'&&i.kind==='threshold_undefined'));
  const view=approvalSettings(db,user('admin'));
  assert.ok(view.keys.some(k=>k.key==='test.finance_review'&&k.effective_minor===500000));
  assert.equal(view.proposals.length,policyProposals.length);
  assert.throws(()=>approvalSettings(db,user('employee')),code('not_permitted'));
  assert.ok(approvalSettings(db,user('vp-corporate')).can_decide);
});

test('service card labels describe cross-department, executive, conditional and direct steps',t=>{
  const {db,user,tx}=fixture(t);
  tx(()=>wf.createService(db,user('admin'),spendService()));
  const card=serviceCard(db,user('employee'),'TEST-SPEND');
  assert.equal(card.service.steps[0],'المدير المباشر لصاحب الطلب');
  assert.match(card.service.steps[1],/مدير المالية/);assert.match(card.service.steps[1],/test\.finance_review/);
  assert.match(card.service.steps[2],/الرئاسة/);
  assert.equal(serviceCard(db,user('employee'),'FIN-REFUND').service.separation_of_duties,true);
  assert.equal(serviceCard(db,user('employee'),'HR-GRIEVANCE').service.confidential,true);
});

test('approval settings screen renders the view and sends thresholds in halalas without float arithmetic',async t=>{
  const {approvalSettingsUI,riyalsToMinor}=await import('../app/static/approval-settings-ui.mjs');
  const f=fixture(t),{db,user,tx}=f;
  tx(()=>wf.createService(db,user('admin'),spendService()));
  const e=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const button=(action,id,label)=>`<button data-action="${action}" data-id="${id}">${label}</button>`;
  const data=approvalSettings(db,user('admin')),html=approvalSettingsUI.render(data,{e,button});
  assert.match(html,/test\.finance_review/);assert.match(html,/غير معرّف/);assert.match(html,/data-action="adopt_proposal"/);
  assert.equal(riyalsToMinor('5000'),500000);assert.equal(riyalsToMinor('0.1'),10);assert.equal(riyalsToMinor('19.99'),1999);
  assert.throws(()=>riyalsToMinor('1e3'));assert.throws(()=>riyalsToMinor('-5'));
  const form=approvalSettingsUI.form('propose_threshold','',data);
  assert.deepEqual(form.toPayload({setting_key:'test.finance_review',amount:'5000.5',effective_from:'2026-10-01',basis:'سند تجريبي كافٍ'}).amount_minor,500050);
  assert.throws(()=>approvalSettingsUI.form('decide_threshold','missing',data));
});
