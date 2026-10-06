import test from 'node:test';
import assert from 'node:assert/strict';
import { openDb, transaction, verifyAudit } from '../app/db.mjs';
import { seed } from '../scripts/seed.mjs';
import { lifecycleBoard, clearanceBoard, saveStepTemplate, updateStepTemplate, openBundle, bundleAction, stepAction, clearItem, clearanceBlockers, deriveClearance } from '../app/lifecycle.mjs';
import { lifecycleUI, clearanceUI } from '../app/static/lifecycle-ui.mjs';

// كل البيانات هنا مصطنعة «تجريبي»: حسابات seed التجريبية، ومبالغ وعهد لا وجود لها.
const code=value=>error=>error.code===value;
const stamp='2026-01-01T00:00:00.000Z';
function fixture(t){
  const db=openDb(':memory:');seed(db,'synthetic-lifecycle-bundles');t.after(()=>db.close());
  const users=Object.fromEntries(db.prepare('SELECT * FROM users').all().map(u=>[u.id,u])),tx=f=>transaction(db,f);
  const step=(kind,codeValue,department,role,extra={})=>tx(()=>saveStepTemplate(db,users.hr,{kind,code:codeValue,title:`خطوة تجريبية ${codeValue}`,department_id:department,owner_role:role,target_days:2,acceptance:'دليل تجريبي موثق يطابق معيار الخطوة',basis:'قرار تجريبي من مالك إجراء الإدارة بتاريخ مصطنع',...extra})).id;
  const open=(kind,employee='employee',owner='manager')=>tx(()=>openBundle(db,users.hr,{kind,employee_id:employee,owner_id:owner,effective_date:'2026-12-01',date_basis:'خطاب تجريبي مؤرخ أكدته مديرة الموارد البشرية التجريبية'})).id;
  const bundle=(u,bundleId)=>lifecycleBoard(db,u).bundles.find(b=>b.id===bundleId);
  return {db,users,tx,step,open,bundle};
}
// ما تعرفه المنصة عن الموظفة التجريبية: عهدة مصروفة، أصل باسمها، سلفة بقسط غير مسدد، صلاحية نشطة، عضوية مشروع ومهمة مفتوحة.
function exposures(db){
  db.prepare("INSERT INTO custodies(id,tenant_id,holder_id,amount_minor,purpose,status,approved_by,approved_at,issued_on,issue_reference,issued_by,created_at,updated_at) VALUES('cust-1','36t','employee',50000,'عهدة تجريبية لمصروفات تصوير','issued','manager',?,'2026-01-02','سند تجريبي 1','hr',?,?)").run(stamp,stamp,stamp);
  db.prepare("INSERT INTO fixed_assets(id,tenant_id,code,name,category,acquired_on,cost_minor,useful_months,custodian_id,evidence,status,recorded_by,approved_by,approved_at,created_at,updated_at) VALUES('fa-1','36t','FA-0001','حاسب محمول تجريبي','devices','2026-01-01',400000,36,'employee','فاتورة شراء تجريبية مصطنعة','active','hr','manager',?,?,?)").run(stamp,stamp,stamp);
  db.prepare("INSERT INTO salary_advances(id,tenant_id,user_id,amount_minor,installments,first_month,reason,status,proposed_by,decided_by,decided_at,created_at) VALUES('adv-1','36t','employee',30000,1,'2026-02','سلفة تجريبية بسند مصطنع','approved','hr','manager',?,?)").run(stamp,stamp);
  db.prepare("INSERT INTO payroll_adjustments(id,tenant_id,user_id,kind,month,amount_minor,reason,advance_id,status,proposed_by,decided_by,decided_at,created_at) VALUES('adj-1','36t','employee','advance_installment','2026-02',30000,'قسط 1 من 1 لسلفة تجريبية','adv-1','approved','hr','manager',?,?)").run(stamp,stamp);
  db.prepare("INSERT INTO access_grants(id,tenant_id,user_id,capability,note,granted_by,granted_at) VALUES('grant-1','36t','employee','people.manage','منح تجريبي','admin',?)").run(stamp);
  db.prepare("INSERT INTO projects(id,tenant_id,name,brief,created_by,created_at) VALUES('proj-1','36t','مشروع تجريبي','موجز تجريبي','manager',?)").run(stamp);
  db.prepare("INSERT INTO project_members VALUES('proj-1','employee')").run();
  db.prepare("INSERT INTO tasks(id,project_id,title,assignee_id,due_date,acceptance,created_at) VALUES('task-1','proj-1','مهمة تجريبية مفتوحة','employee','2026-12-31','معيار تجريبي',?)").run(stamp);
}

test('lifecycle: the step template starts empty, no bundle opens without owner-defined steps, and each department owner defines only their own department’s steps',t=>{
  const {db,users,tx,step}=fixture(t);
  const board=lifecycleBoard(db,users.hr);
  assert.deepEqual(board.templates,[],'the platform invents no steps');assert.deepEqual(board.bundles,[]);
  assert.throws(()=>tx(()=>openBundle(db,users.hr,{kind:'onboarding',employee_id:'employee',owner_id:'manager',effective_date:'2026-12-01',date_basis:'خطاب تجريبي مؤرخ ومؤكد'})),code('no_template'));
  const input={kind:'onboarding',code:'CR-DESK',title:'تجهيز مكتب تجريبي',department_id:'creative',owner_role:'manager',target_days:1,acceptance:'صورة المكتب المجهز مرفقة بالطلب',basis:'قرار تجريبي لمدير الفريق الإبداعي'};
  assert.ok(tx(()=>saveStepTemplate(db,users.manager,input)).id,'a department manager defines their own department’s steps');
  assert.throws(()=>tx(()=>saveStepTemplate(db,users.manager,{...input,code:'IT-X',department_id:'it',owner_role:'it'})),code('not_permitted'));
  assert.throws(()=>tx(()=>saveStepTemplate(db,users.employee,{...input,code:'CR-2'})),code('not_permitted'));
  assert.throws(()=>tx(()=>saveStepTemplate(db,users.hr,input)),code('code_exists'));
  assert.throws(()=>tx(()=>saveStepTemplate(db,users.hr,{...input,code:'NO-DAYS',target_days:undefined})),code('target_days'),'no default target duration exists');
  assert.throws(()=>saveStepTemplate(db,users.hr,{...input,code:'NO-TX'}),code('transaction_required'));
  step('onboarding','IT-LAPTOP','it','it');
  assert.equal(lifecycleBoard(db,users.it).templates.find(x=>x.code==='IT-LAPTOP').actions.length,0,'an IT executor who is not a manager does not edit the template');
  assert.ok(verifyAudit(db));
});

test('lifecycle: a dependency chain that loops back on itself is rejected on save, in code and in SQL',t=>{
  const {db,users,tx,step}=fixture(t);
  const a=step('onboarding','ST-A','hr','hr'),b=step('onboarding','ST-B','it','it',{depends_on:a}),c=step('onboarding','ST-C','creative','manager',{depends_on:b});
  const current=id=>db.prepare('SELECT * FROM lifecycle_step_templates WHERE id=?').get(id);
  const edit=(id,dependsOn)=>{const row=current(id);return tx(()=>updateStepTemplate(db,users.hr,id,{version:row.version,title:row.title,department_id:row.department_id,owner_role:row.owner_role,target_days:row.target_days,acceptance:row.acceptance,basis:row.basis,active:true,depends_on:dependsOn}));};
  assert.throws(()=>edit(a,c),code('dependency_cycle'),'A→C→B→A is a cycle through a chain');
  assert.throws(()=>edit(a,a),code('dependency_cycle'));
  assert.throws(()=>edit(b,c),code('dependency_cycle'));
  assert.equal(current(a).depends_on,null,'a rejected save leaves nothing behind');
  assert.throws(()=>db.prepare('UPDATE lifecycle_step_templates SET depends_on=id,version=version+1 WHERE id=?').run(a),/CHECK constraint failed/);
  const off=step('offboarding','OFF-A','hr','hr');
  assert.throws(()=>edit(a,off),code('depends_on'),'a dependency never crosses bundle kinds');
  edit(c,a);assert.equal(current(c).depends_on,a,'re-pointing without a loop is allowed');
  assert.throws(()=>tx(()=>updateStepTemplate(db,users.hr,c,{version:1,title:'تجريبي',department_id:'creative',owner_role:'manager',target_days:1,acceptance:'معيار تجريبي موثق',basis:'سند تجريبي موثق',active:true,depends_on:null})),code('stale_version'));
  assert.ok(verifyAudit(db));
});

test('lifecycle: one request fans out into parallel steps; a dependent step stays visible with its reason; progress counts only steps closed with evidence; the person never closes their own journey',t=>{
  const {db,users,tx,step,open,bundle}=fixture(t);
  const contract=step('onboarding','HR-CONTRACT','hr','hr');step('onboarding','IT-LAPTOP','it','it');step('onboarding','IT-BADGE','it','it',{depends_on:contract});
  assert.throws(()=>tx(()=>openBundle(db,users.manager,{kind:'onboarding',employee_id:'employee',owner_id:'manager',effective_date:'2026-12-01',date_basis:'خطاب تجريبي مؤرخ ومؤكد'})),code('not_permitted'));
  assert.throws(()=>tx(()=>openBundle(db,users.hr,{kind:'onboarding',employee_id:'hr',owner_id:'manager',effective_date:'2026-12-01',date_basis:'خطاب تجريبي مؤرخ ومؤكد'})),code('separation_of_duties'));
  assert.throws(()=>tx(()=>openBundle(db,users.hr,{kind:'onboarding',employee_id:'employee',owner_id:'employee',effective_date:'2026-12-01',date_basis:'خطاب تجريبي مؤرخ ومؤكد'})),code('separation_of_duties'));
  assert.throws(()=>tx(()=>openBundle(db,users.hr,{kind:'onboarding',employee_id:'employee',owner_id:'manager',effective_date:'2026-12-01'})),code('invalid_text'),'the date carries its basis; no notice period is assumed');
  const id=open('onboarding');
  assert.throws(()=>open('onboarding'),code('bundle_open'));
  const view=bundle(users.hr,id),byCode=c=>bundle(users.hr,id).steps.find(s=>s.title.endsWith(c));
  assert.equal(view.steps.length,3);assert.deepEqual(view.progress,{total:3,done:0,late:0,blocked:1,percent:0,open_financial:0});
  assert.deepEqual(view.clearance,[],'clearance belongs to offboarding only');
  const badge=byCode('IT-BADGE');
  assert.equal(badge.blocked,true);assert.match(badge.blocked_reason,/HR-CONTRACT/);assert.equal(badge.owner_id,'it');
  assert.ok(!bundle(users.it,id).steps.find(s=>s.id===badge.id).actions.includes('close_step'),'a blocked step is shown, not offered');
  assert.throws(()=>tx(()=>stepAction(db,users.it,badge.id,'close_step',{version:badge.version,evidence:'تسليم بطاقة تجريبية قبل العقد'})),code('dependency_open'));
  const laptop=byCode('IT-LAPTOP');
  assert.throws(()=>tx(()=>stepAction(db,users.hr,laptop.id,'close_step',{version:laptop.version,evidence:'ليست خطوتي لكني أغلقها تجريبيًا'})),code('not_permitted'),'only the named owner closes a step');
  assert.throws(()=>tx(()=>stepAction(db,users.it,laptop.id,'close_step',{version:laptop.version,evidence:'قصير'})),code('invalid_text'),'no evidence, no closure');
  assert.throws(()=>tx(()=>stepAction(db,users.it,laptop.id,'close_step',{version:laptop.version+5,evidence:'تسليم حاسب تجريبي بمحضر موقع'})),code('stale_version'));
  tx(()=>stepAction(db,users.it,laptop.id,'close_step',{version:laptop.version,evidence:'تسليم حاسب تجريبي بمحضر استلام موقع'}));
  assert.equal(bundle(users.hr,id).progress.percent,33);
  assert.throws(()=>tx(()=>stepAction(db,users.it,laptop.id,'close_step',{version:laptop.version+1,evidence:'إغلاق ثانٍ تجريبي لخطوة مغلقة'})),code('step_settled'));
  assert.throws(()=>db.prepare("UPDATE lifecycle_steps SET evidence='تعديل صامت بعد الإغلاق',version=version+1 WHERE id=?").run(laptop.id),/settled step is final/);
  assert.throws(()=>db.prepare("UPDATE lifecycle_steps SET status='done',evidence='إغلاق ذاتي مباشر في القاعدة',closed_by='employee',closed_at=?,version=version+1 WHERE id=?").run(stamp,badge.id),/CHECK constraint failed/,'SQL forbids the person closing a step of their own journey');
  assert.throws(()=>tx(()=>bundleAction(db,users.hr,id,'close_bundle',{version:bundle(users.hr,id).version,note:'إغلاق تجريبي قبل اكتمال الخطوات'})),code('steps_open'));
  const c=byCode('HR-CONTRACT');tx(()=>stepAction(db,users.hr,c.id,'close_step',{version:c.version,evidence:'عقد تجريبي موقع محفوظ في الملف'}));
  const freed=byCode('IT-BADGE');assert.equal(freed.blocked,false);
  tx(()=>stepAction(db,users.it,freed.id,'close_step',{version:freed.version,evidence:'بطاقة دخول تجريبية سُلمت بعد توقيع العقد'}));
  const done=bundle(users.hr,id);assert.equal(done.progress.percent,100);assert.ok(done.actions.includes('close_bundle'));
  assert.deepEqual(bundle(users.employee,id).steps.flatMap(s=>s.actions),[],'the person sees their journey and decides nothing in it');
  assert.equal(bundle(users.outsider,id),undefined,'an unrelated colleague does not see the bundle');
  tx(()=>bundleAction(db,users.hr,id,'close_bundle',{version:done.version,note:'اكتملت خطوات التعيين التجريبية بأدلتها'}));
  assert.throws(()=>db.prepare("UPDATE lifecycle_bundles SET close_note='تعديل صامت بعد الإغلاق',version=version+1 WHERE id=?").run(id),/settled bundle is final/);
  assert.ok(verifyAudit(db));
});

test('lifecycle: a step past its target escalates to the bundle owner as a recorded decision',t=>{
  const {db,users,tx,step,open,bundle}=fixture(t);
  step('onboarding','IT-LAPTOP','it','it');const id=open('onboarding'),s=bundle(users.hr,id).steps[0];
  assert.throws(()=>tx(()=>stepAction(db,users.manager,s.id,'decide_late_step',{version:s.version,note:'قرار تجريبي قبل حلول التأخر'})),code('not_late'));
  db.prepare("UPDATE lifecycle_steps SET due_date='2026-01-05',version=version+1 WHERE id=?").run(s.id);
  const late=bundle(users.manager,id).steps[0];
  assert.equal(late.late,true);assert.ok(late.actions.includes('decide_late_step'),'the bundle owner is offered the decision — this is what «بانتظار قراري» collects');
  assert.ok(!bundle(users.it,id).steps[0].actions.includes('decide_late_step'),'the late step’s own owner does not decide on the delay');
  assert.equal(lifecycleBoard(db,users.hr).totals.late,1);
  assert.throws(()=>tx(()=>stepAction(db,users.manager,s.id,'decide_late_step',{version:late.version,note:'تمديد تجريبي بموعد ماضٍ',new_due_date:'2026-01-06'})),code('new_due_date'));
  assert.throws(()=>tx(()=>stepAction(db,users.manager,s.id,'decide_late_step',{version:late.version,note:'نقل تجريبي لصاحب الرحلة نفسه',new_owner_id:'employee'})),code('new_owner_id'));
  tx(()=>stepAction(db,users.manager,s.id,'decide_late_step',{version:late.version,note:'تمديد تجريبي لتأخر توريد الجهاز',new_due_date:'2099-01-01'}));
  const after=bundle(users.manager,id).steps[0];
  assert.equal(after.late,false);assert.equal(after.escalations.length,1);assert.equal(after.escalations[0].decided_by,'manager');
  assert.throws(()=>db.prepare("UPDATE lifecycle_escalations SET note='إعادة كتابة قرار التصعيد'").run(),/never rewritten/);
  assert.ok(verifyAudit(db));
});

test('clearance: the list is derived from what the platform actually knows about the person, nobody clears themselves — in code and by CHECK — and nothing is revoked or disabled automatically',t=>{
  const {db,users,tx,step,open}=fixture(t);
  step('offboarding','IT-ACCOUNTS','it','it');exposures(db);
  const id=open('offboarding'),view=()=>clearanceBoard(db,users.hr).bundles.find(b=>b.id===id),item=source=>view().clearance.find(i=>i.source===source);
  assert.deepEqual(view().clearance.map(i=>i.source).sort(),['access_grant','account','advance','custody','fixed_asset','project','project_task']);
  assert.deepEqual(view().clearance.filter(i=>i.financial).map(i=>[i.source,i.amount_minor]).sort(),[['advance',30000],['custody',50000],['fixed_asset',400000]]);
  assert.deepEqual(deriveClearance(db,'36t','outsider').map(i=>i.source),['account'],'a person with nothing registered gets no invented items');
  // القاعدة الجوهرية: الموظفة التجريبية تملك تصريح people.manage بمنحة، ومع ذلك لا تخلي طرف نفسها.
  const custody=item('custody');
  assert.deepEqual(clearanceBoard(db,users.employee).bundles.find(b=>b.id===id).clearance.flatMap(i=>i.actions),[]);
  assert.throws(()=>tx(()=>clearItem(db,users.employee,custody.id,{version:custody.version,evidence:'أقر بنفسي أنني أرجعت العهدة التجريبية'})),code('self_clearance'));
  assert.throws(()=>db.prepare("UPDATE lifecycle_clearance_items SET status='cleared',evidence='إخلاء ذاتي مباشر في قاعدة البيانات',cleared_by='employee',cleared_at=?,version=version+1 WHERE id=?").run(stamp,custody.id),/CHECK constraint failed/);
  assert.throws(()=>db.prepare("UPDATE lifecycle_clearance_items SET status='cleared',cleared_by='hr',cleared_at=?,version=version+1 WHERE id=?").run(stamp,custody.id),/CHECK constraint failed/,'cleared without evidence is refused by SQL');
  assert.throws(()=>tx(()=>clearItem(db,users.outsider,custody.id,{version:custody.version,evidence:'زميل تجريبي بلا صفة يغلق البند'})),code('not_permitted'));
  assert.throws(()=>tx(()=>clearItem(db,users.hr,custody.id,{version:custody.version+1,evidence:'إغلاق تجريبي بنسخة قديمة'})),code('stale_version'));
  // الترحيل 091: البند المالي لا يُغلق بنص حر ما دامت العهدة قائمة في المالية؛ يقرّه حامل تصريح رواتب أو مالية.
  assert.throws(()=>tx(()=>clearItem(db,users.manager,custody.id,{version:custody.version,evidence:'سند إرجاع عهدة تجريبي رقم 7 استلمته المالية'})),code('source_open'));
  const project=item('project');
  tx(()=>clearItem(db,users.manager,project.id,{version:project.version,evidence:'محضر تسليم أعمال المشروع التجريبي موقّع'}));
  assert.equal(item('project').cleared_by,'manager','the bundle owner, who is not the leaver, may clear');
  tx(()=>clearItem(db,users.hr,custody.id,{version:custody.version,evidence:'سند إرجاع عهدة تجريبي رقم 7 استلمته المالية'}));
  assert.throws(()=>tx(()=>clearItem(db,users.hr,custody.id,{version:custody.version+1,evidence:'إغلاق ثانٍ تجريبي لبند مغلق'})),code('item_cleared'));
  assert.throws(()=>db.prepare("UPDATE lifecycle_clearance_items SET evidence='تعديل صامت بعد الإغلاق',version=version+1 WHERE id=?").run(custody.id),/cleared item is final/);
  for(const i of view().clearance.filter(x=>x.status==='open'))tx(()=>clearItem(db,users.hr,i.id,{version:i.version,evidence:'دليل تجريبي موثق لإغلاق البند يدويًا'}));
  assert.equal(db.prepare("SELECT revoked_at FROM access_grants WHERE id='grant-1'").get().revoked_at,null,'clearing the item records a human act; the platform revokes nothing');
  assert.equal(db.prepare("SELECT active FROM users WHERE id='employee'").get().active,1,'and disables no account');
  assert.equal(db.prepare("SELECT status FROM custodies WHERE id='cust-1'").get().status,'issued','and closes no custody on anyone’s behalf');
  assert.ok(verifyAudit(db));
});

test('clearance: the final settlement stays blocked until the financial items are closed, and a stale list cannot be used to slip past it',t=>{
  const {db,users,tx,step,open,bundle}=fixture(t);
  step('offboarding','IT-ACCOUNTS','it','it');exposures(db);
  const none=clearanceBlockers(db,users.hr,'employee');
  assert.equal(none.blocked,true);assert.equal(none.blockers[0].reason,'no_bundle','no verified clearance means no settlement');
  const id=open('offboarding'),financial=()=>clearanceBoard(db,users.hr).bundles[0].clearance.filter(i=>i.financial&&i.status==='open');
  assert.deepEqual(clearanceBlockers(db,users.hr,'employee').blockers.map(b=>b.source).sort(),['advance','custody','fixed_asset']);
  for(const i of financial())tx(()=>clearItem(db,users.hr,i.id,{version:i.version,evidence:'دليل تجريبي موثق لإغلاق البند المالي'}));
  const clear=clearanceBlockers(db,users.hr,'employee');
  assert.equal(clear.blocked,false,'non-financial items do not block the settlement');assert.deepEqual(clear.blockers,[]);
  // التزام مالي ظهر بعد فتح الحزمة: الدالة تقارن بالحي الآن لا بالقائمة القديمة.
  db.prepare("INSERT INTO custodies(id,tenant_id,holder_id,amount_minor,purpose,status,approved_by,approved_at,issued_on,issue_reference,issued_by,created_at,updated_at) VALUES('cust-2','36t','employee',9000,'عهدة تجريبية ثانية بعد فتح الحزمة','issued','manager',?,'2026-01-03','سند تجريبي 2','hr',?,?)").run(stamp,stamp,stamp);
  const stale=clearanceBlockers(db,users.hr,'employee');
  assert.equal(stale.blocked,true);assert.deepEqual(stale.blockers.map(b=>[b.source_id,b.reason]),[['cust-2','not_recorded']]);
  const s=bundle(users.hr,id).steps[0];tx(()=>stepAction(db,users.it,s.id,'close_step',{version:s.version,evidence:'قائمة حسابات تجريبية سُلمت لمسؤول الصلاحيات'}));
  for(const i of clearanceBoard(db,users.hr).bundles[0].clearance.filter(x=>x.status==='open'))tx(()=>clearItem(db,users.hr,i.id,{version:i.version,evidence:'دليل تجريبي موثق لإغلاق البند يدويًا'}));
  assert.throws(()=>tx(()=>bundleAction(db,users.hr,id,'close_bundle',{version:bundle(users.hr,id).version,note:'إغلاق تجريبي رغم التزام مالي جديد'})),code('clearance_stale'));
  assert.equal(tx(()=>bundleAction(db,users.hr,id,'refresh_clearance',{version:bundle(users.hr,id).version})).added,1);
  assert.equal(tx(()=>bundleAction(db,users.hr,id,'refresh_clearance',{version:bundle(users.hr,id).version})).added,0,'repeatable');
  assert.throws(()=>tx(()=>bundleAction(db,users.hr,id,'close_bundle',{version:bundle(users.hr,id).version,note:'إغلاق تجريبي وبند مفتوح'})),code('clearance_open'));
  assert.ok(verifyAudit(db));
});

test('lifecycle: another tenant sees nothing and reaches nothing, and the screens render every value escaped under a strict CSP',t=>{
  const {db,users,tx,step,open,bundle}=fixture(t);
  step('offboarding','IT-ACCOUNTS','it','it',{title:'خطوة <img src=x onerror=alert(1)>'});exposures(db);
  const id=open('offboarding'),s=bundle(users.hr,id).steps[0],item=clearanceBoard(db,users.hr).bundles[0].clearance[0];
  assert.deepEqual(lifecycleBoard(db,users.external).bundles,[]);assert.deepEqual(lifecycleBoard(db,users.external).templates,[]);assert.deepEqual(clearanceBoard(db,users.external).bundles,[]);
  assert.throws(()=>tx(()=>stepAction(db,users.external,s.id,'close_step',{version:s.version,evidence:'محاولة تجريبية من كيان آخر'})),code('not_found'));
  assert.throws(()=>tx(()=>clearItem(db,users.external,item.id,{version:item.version,evidence:'محاولة تجريبية من كيان آخر'})),code('not_found'));
  assert.throws(()=>tx(()=>bundleAction(db,users.external,id,'cancel_bundle',{version:1,note:'محاولة تجريبية من كيان آخر'})),code('not_found'));
  assert.throws(()=>tx(()=>openBundle(db,users.hr,{kind:'offboarding',employee_id:'external',owner_id:'manager',effective_date:'2026-12-01',date_basis:'خطاب تجريبي مؤرخ ومؤكد'})),code('employee'));
  assert.throws(()=>clearanceBlockers(db,users.external,'employee'),code('not_found'),'the blocker check is tenant-scoped too');
  assert.throws(()=>lifecycleBoard(db,{id:'ghost',tenant_id:'36t'}),code('forbidden'));
  const e=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const helpers={e,button:(a,i,l)=>`<button data-operation="${e(a)}" data-id="${e(i)}">${e(l)}</button>`,money:n=>String(n)};
  for(const [ui,data] of [[lifecycleUI,lifecycleBoard(db,users.hr)],[clearanceUI,clearanceBoard(db,users.hr)]]){
    const html=ui.render(data,helpers);
    assert.ok(!/<img|style=|<script/i.test(html),'no raw user markup, inline style or script');assert.ok(html.length>200);
  }
  assert.match(lifecycleUI.render(lifecycleBoard(db,users.hr),helpers),/&lt;img/);
  assert.equal(lifecycleUI.form('close_step',s.id,lifecycleBoard(db,users.it)).endpoint,`/lifecycle/steps/${s.id}/close_step`);
  assert.throws(()=>lifecycleUI.form('close_step',s.id,lifecycleBoard(db,users.hr)),/غير متاح/,'a form is never built for an action the board did not offer');
  assert.throws(()=>clearanceUI.form('verify_clearance',item.id,clearanceBoard(db,users.employee)),/غير متاح/);
  assert.deepEqual(lifecycleUI.form('add_template','onboarding',lifecycleBoard(db,users.hr)).toPayload({code:'X1',title:'ت',department_id:'it',owner_role:'it',target_days:'3',acceptance:'م',depends_on:'',basis:'س'}).depends_on,null);
  assert.ok(verifyAudit(db));
});
