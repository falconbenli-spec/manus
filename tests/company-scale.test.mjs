import test from 'node:test';
import assert from 'node:assert/strict';
import { openDb, transaction } from '../app/db.mjs';
import { seed } from '../scripts/seed.mjs';
import { login, authenticate, changePassword } from '../app/auth.mjs';
import { createApp } from '../app/server.mjs';
import * as wf from '../app/workflow.mjs';
import * as admin from '../app/admin.mjs';
import * as access from '../app/access.mjs';
import { installServiceCatalog } from '../app/service-catalog.mjs';
import { requestLauncher, requestComposer, launcherResults, catalogBrowser, searchCatalog, groupCatalog, normalizeArabic } from '../app/static/request-picker.mjs';
import { accountsUI } from '../app/static/accounts-ui.mjs';

const password='synthetic-scale-only';
const e=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const user=(db,id)=>db.prepare('SELECT * FROM users WHERE id=?').get(id);
const code=c=>error=>error.code===c;
function setup(t){const db=openDb(':memory:');seed(db,password);installServiceCatalog(db);t.after(()=>db.close());return db;}
const asAdmin=db=>user(db,'admin');

test('SCALE: several managers in a department stop routing until the admin assigns one approver',t=>{
  const db=setup(t),a=asAdmin(db);
  transaction(db,()=>admin.createAccount(db,a,{username:'proc.lead2',name:'مدير مشتريات ثانٍ',role:'manager',department_id:'procurement',manager_id:null,temporary_password:'Temp-pass-2026'}));
  const employee=user(db,'employee'),service=wf.catalog(db,employee).find(s=>s.code==='PRC-VENDOR-REGISTRATION');
  const draft=()=>wf.createRequest(db,employee,{service_id:service.id,title:'مورد جديد',payload:{vendor_name:'مورد مصطنع',commercial_registration:'CR-0000',vat_number:'VAT-0000',category:'إنتاج',evaluation:'ترشيح مصطنع للفحص'},project_id:null});
  let r=draft();
  assert.throws(()=>transaction(db,()=>wf.transition(db,employee,r.id,'submit',{version:r.version})),code('routing_unavailable'),'two candidates and no assignment stops the request');
  assert.ok(admin.adminDirectory(db,a).gaps.some(g=>g.department_id==='procurement'&&g.step_role==='department_manager'&&g.candidates===2));
  assert.throws(()=>admin.assignRouting(db,a,{department_id:'procurement',step_role:'department_manager',user_id:'employee'}),code('routing_user'));
  transaction(db,()=>admin.assignRouting(db,a,{department_id:'procurement',step_role:'department_manager',user_id:'proc.lead2'}));
  assert.ok(!admin.adminDirectory(db,a).gaps.some(g=>g.department_id==='procurement'));
  r=transaction(db,()=>wf.transition(db,employee,r.id,'submit',{version:r.version}));
  assert.throws(()=>transaction(db,()=>wf.transition(db,user(db,'head-procurement'),r.id,'approve',{version:r.version})),error=>[403,404].includes(error.status),'the unassigned manager cannot decide');
  r=transaction(db,()=>wf.transition(db,user(db,'proc.lead2'),r.id,'approve',{version:r.version}));
  assert.equal(r.status,'approved');
  assert.throws(()=>admin.updateAccount(db,a,'proc.lead2',{active:false}),code('routing_assigned'));
  assert.throws(()=>admin.adminDirectory(db,employee),code('forbidden'));
  assert.throws(()=>admin.assignRouting(db,user(db,'manager'),{department_id:'procurement',step_role:'hr',user_id:null}),code('forbidden'));
});

test('SCALE: admin creates and imports employees with a manager hierarchy, all or nothing',t=>{
  const db=setup(t),a=asAdmin(db);
  const csv='username,name,department_id,role,manager_username\nr.alqahtani,ريم مصطنعة,marketing,employee,lead-marketing\nlead-marketing,قائد تسويق مصطنع,marketing,manager,\nf.alharbi,فهد مصطنع,marketing,employee,lead-marketing';
  const result=transaction(db,()=>admin.importAccounts(db,a,{csv,temporary_password:'Welcome-2026'}));
  assert.equal(result.created,3);
  assert.equal(user(db,'r.alqahtani').manager_id,'lead-marketing');
  assert.equal(user(db,'r.alqahtani').must_change_password,1);
  const bad='username,name,department_id,role,manager_username\nok.person,شخص سليم,marketing,employee,\nbad.person,شخص خاطئ,no-such-department,employee,';
  assert.throws(()=>transaction(db,()=>admin.importAccounts(db,a,{csv:bad,temporary_password:'Welcome-2026'})),code('department'));
  assert.equal(user(db,'ok.person'),undefined,'a failed import writes nothing');
  assert.throws(()=>transaction(db,()=>admin.importAccounts(db,a,{csv:'x.one,اسم أول,marketing,employee,\nx.one,اسم ثان,marketing,employee,',temporary_password:'Welcome-2026'})),code('csv'));
  assert.throws(()=>transaction(db,()=>admin.importAccounts(db,a,{csv:'y.one,اسم مصطنع,marketing,employee,manager',temporary_password:'Welcome-2026'})),code('manager'),'a manager from another department breaks routing');
  assert.throws(()=>admin.createAccount(db,a,{username:'weak.one',name:'ضعيف',role:'employee',department_id:'hr',manager_id:null,temporary_password:'12345678'}),code('weak_password'));
  assert.throws(()=>admin.createAccount(db,a,{username:'r.alqahtani',name:'مكرر',role:'employee',department_id:'hr',manager_id:null,temporary_password:'Welcome-2026'}),code('username_taken'));
  assert.throws(()=>admin.createAccount(db,a,{username:'new.admin',name:'مسؤول',role:'admin',department_id:'ops',manager_id:null,temporary_password:'Welcome-2026'}),code('role'));
  assert.throws(()=>admin.updateAccount(db,a,'lead-marketing',{role:'employee'}),code('has_reports'));
  // كل حساب مستورَد له كلمته المؤقتة وحده منذ 29 سبتمبر 2026: كانت كلمة واحدة لكل الصفوف، فكان
  // كل مستورَد يملك مفتاح حساب زميله (tests/import-password-per-account.test.mjs).
  const secret=result.credentials.find(c=>c.username==='f.alharbi').temporary_password;
  const auth=login(db,'f.alharbi',secret,'scale-test');
  transaction(db,()=>admin.updateAccount(db,a,'f.alharbi',{active:false}));
  assert.throws(()=>authenticate(db,`session=${auth.token}`),code('session_expired'));
  assert.throws(()=>admin.updateAccount(db,a,'admin',{name:'تغيير'}),code('forbidden'));
  assert.equal(wf.listRequests(db,a).length,0,'account administration does not expose requests');
});

test('SCALE: a temporary password blocks the API until the employee sets a strong one',async t=>{
  const db=setup(t),a=asAdmin(db);
  transaction(db,()=>admin.createAccount(db,a,{username:'s.new',name:'موظفة جديدة مصطنعة',role:'employee',department_id:'creative',manager_id:'manager',temporary_password:'First-login-2026'}));
  const server=createApp(db),handler=server.listeners('request')[0];
  async function call(path,{method='GET',token,csrf,input}={}){
    const body=input===undefined?[]:[Buffer.from(JSON.stringify(input))];
    const req={url:path,method,socket:{remoteAddress:'127.0.0.1'},headers:{host:'127.0.0.1:3600',...(token?{cookie:`session=${token}`}:{}),...(csrf?{'x-csrf-token':csrf}:{}),...(input!==undefined?{'content-type':'application/json'}:{})},async *[Symbol.asyncIterator](){yield* body;}};
    const res={writeHead(status,headers){this.status=status;this.headers=headers;},end(value){this.body=value?JSON.parse(value):null;}};
    await handler(req,res);return res;
  }
  const signedIn=login(db,'s.new','First-login-2026','scale-http');
  const me=await call('/api/me',{token:signedIn.token});
  assert.equal(me.status,200);assert.equal(me.body.user.must_change_password,true);
  assert.equal((await call('/api/catalog',{token:signedIn.token})).status,403);
  assert.equal((await call('/api/account/password',{method:'POST',token:signedIn.token,csrf:signedIn.csrf,input:{current_password:'First-login-2026',new_password:'98765432'}})).body.error.code,'weak_password');
  assert.equal((await call('/api/account/password',{method:'POST',token:signedIn.token,csrf:signedIn.csrf,input:{current_password:'wrong-password',new_password:'My-own-secret-9'}})).status,403);
  const second=login(db,'s.new','First-login-2026','scale-http-2');
  const changed=await call('/api/account/password',{method:'POST',token:signedIn.token,csrf:signedIn.csrf,input:{current_password:'First-login-2026',new_password:'My-own-secret-9'}});
  assert.ok(changed.status<300,String(changed.status));
  assert.equal((await call('/api/catalog',{token:signedIn.token})).status,200);
  assert.throws(()=>authenticate(db,`session=${second.token}`),code('session_expired'),'other sessions are signed out');
  assert.throws(()=>changePassword(db,user(db,'s.new'),{token_hash:'x'},{current_password:'My-own-secret-9',new_password:'My-own-secret-9'}),code('weak_password'));
});

test('SCALE: failed logins lock one account from an office address without locking colleagues',t=>{
  const db=setup(t);
  for(let i=0;i<10;i++)assert.throws(()=>login(db,'employee','wrong-guess','office-nat'),code('invalid_credentials'));
  assert.throws(()=>login(db,'employee',password,'office-nat'),code('rate_limited'));
  assert.ok(login(db,'manager',password,'office-nat').token,'a colleague behind the same address can still sign in');
});

test('SCALE: the narrowed request list returns exactly the authorized requests for 250 accounts',t=>{
  const db=setup(t),a=asAdmin(db);
  const rows=['username,name,department_id,role,manager_username'];
  for(let team=0;team<10;team++){rows.push(`lead${team},قائد ${team},creative,manager,`);for(let i=0;i<24;i++)rows.push(`staff${team}-${i},موظف ${team}-${i},creative,employee,lead${team}`);}
  transaction(db,()=>admin.importAccounts(db,a,{csv:rows.join('\n'),temporary_password:'Welcome-2026'}));
  db.prepare("UPDATE users SET must_change_password=0").run();
  const services=wf.catalog(db,a),letter=services.find(s=>s.code==='HR-LETTER'),travel=services.find(s=>s.code==='ADM-TRAVEL');
  let n=0;
  for(let team=0;team<10;team++)for(let i=0;i<24;i+=3){
    const staff=user(db,`staff${team}-${i}`),service=n%2?letter:travel;
    const payload=service===letter?{purpose:'غرض مصطنع',recipient:'جهة مصطنعة'}:{travel_type:'داخلية',city:'الدمام',start_date:'2026-11-01',end_date:'2026-11-02',flight:'حجز',housing:'بدون حجز',transport:'بدون حجز',purpose:'زيارة مصطنعة'};
    let r=wf.createRequest(db,staff,{service_id:service.id,title:'طلب '+n++,payload,project_id:null});
    r=transaction(db,()=>wf.transition(db,staff,r.id,'submit',{version:r.version}));
    if(n%3===0)transaction(db,()=>wf.transition(db,user(db,`lead${team}`),r.id,'approve',{version:r.version}));
  }
  const everyone=db.prepare("SELECT * FROM users WHERE tenant_id='36t' AND active=1").all();
  assert.ok(everyone.length>=250);
  let listing=0;
  for(const u of everyone){
    const started=performance.now();
    const narrowed=wf.listRequests(db,u).map(r=>r.id).sort();
    listing+=performance.now()-started;
    const all=db.prepare('SELECT id FROM requests WHERE tenant_id=?').all(u.tenant_id).map(r=>r.id).filter(id=>{try{wf.getRequest(db,u,id);return true;}catch{return false;}}).sort();
    assert.deepEqual(narrowed,all,u.id);
  }
  t.diagnostic(`listRequests for ${everyone.length} accounts over ${n} requests: ${Math.round(listing)}ms total, ${(listing/everyone.length).toFixed(1)}ms per account`);
});

test('LAUNCHER: services are grouped by department and section, searchable in Arabic, and escaped',t=>{
  const db=setup(t),employee=user(db,'employee');
  const departments=db.prepare("SELECT id,name FROM departments WHERE tenant_id='36t'").all(),services=wf.catalog(db,employee);
  const groups=groupCatalog(departments,services);
  const hr=groups.find(g=>g.department.id==='hr');
  assert.ok(hr.sections.length>=6);assert.ok(hr.sections.some(s=>s.name==='الرواتب والمزايا'&&s.items.some(x=>x.code==='HR-BANK-CHANGE')));
  assert.equal(groups.reduce((n,g)=>n+g.count,0),services.length);
  assert.equal(normalizeArabic('إجازةٌ'),'اجازه');
  assert.equal(searchCatalog(departments,services,'تعريف بالراتب')[0].code,'HR-SALARY-CERT');
  assert.ok(searchCatalog(departments,services,'انتداب').some(s=>s.code==='ADM-TRAVEL'));
  assert.ok(searchCatalog(departments,services,'الحوكمة عقد').some(s=>s.code==='LEG-CONTRACT-REVIEW'),'department names are searchable');
  assert.ok(searchCatalog(departments,services,'قانوني').some(s=>s.code==='LEG-NDA'),'familiar words still find the renamed department');
  assert.ok(searchCatalog(departments,services,'اداري صيانة').some(s=>s.code==='ADM-MAINTENANCE'),'keywords cover the previous department vocabulary');
  const launcher=requestLauncher({departments,services,me:employee,e});
  assert.match(launcher,/id="launcher-search"/);assert.match(launcher,/data-action="pick-department" data-id="grc"/);assert.match(launcher,/rq-rail-group/,'departments are grouped by sector in the rail');assert.match(launcher,/خدمات مختارة/,'T1: a fixed hand-picked list, not labelled «most requested» until real data exists (M4)');
  const legal=launcherResults({departments,services,me:employee,selected:'grc',e});
  assert.match(legal,/class="rq-row"/,'services render as compact rows');
  assert.match(legal,/العقود والاتفاقيات/);assert.doesNotMatch(legal,/ADM-MAINTENANCE|صيانة وإصلاح/);
  assert.match(launcherResults({departments,services,me:employee,query:'zzqq',e}),/لم نجد ما تبحث عنه/);
  const hostile=launcherResults({departments:[{id:'x',name:'<img src=x onerror=1>'}],services:[{...services[0],department_id:'x',name_ar:'<script>1</script>',section:'<b>'}],me:employee,selected:'x',e});
  assert.doesNotMatch(hostile,/<img|<script|<b>/);
  const travel=services.find(s=>s.code==='ADM-TRAVEL');
  const form=requestComposer({service:travel,departments,projects:[{id:'p1',name:'مشروع'}],edit:false,e,fieldInput:f=>`<input name="field:${f.key}">`});
  assert.match(form,/id="request-form"/);assert.match(form,new RegExp(`name="service_id" value="${travel.id}"`));
  assert.match(form,/مديرك المباشر/);assert.match(form,/مدير مكتب الرئيس التنفيذي/);assert.match(form,/data-action="launcher-back"/);
  assert.equal((form.match(/name="field:/g)||[]).length,travel.fields.length);
  const adminPage=catalogBrowser({departments,services,me:asAdmin(db),e,admin:true});
  assert.doesNotMatch(adminPage,/data-action="pick-service"/);assert.match(adminPage,/<code>HR-LETTER<\/code>|خدمات مختارة/);
});

test('ACCOUNTS UI: admin forms send only the fields the server accepts',t=>{
  const db=setup(t),actor=asAdmin(db),data={...admin.adminDirectory(db,actor),access:access.accessDirectory(db,actor)};
  const html=accountsUI.render(data,{e,button:(action,id,label)=>`<button data-operation="${action}" data-id="${id}">${label}</button>`});
  assert.match(html,/data-filter="#accounts-table"/);assert.match(html,/data-operation="import"/);assert.doesNotMatch(html,/data-operation="edit" data-id="admin"/);
  assert.match(html,/data-operation="matrix" data-id="employee"/,'every active account is available in the permission matrix');
  const matrix=accountsUI.form('matrix','employee',data);
  assert.equal(matrix.endpoint,'/access/matrix');
  assert.ok(matrix.fields.some(f=>f.name==='mode'&&f.options.some(o=>o.value==='comprehensive')&&f.options.some(o=>o.value==='custom')));
  assert.ok(matrix.fields.some(f=>f.name==='capability_keys'&&f.type==='checks'&&f.options.length>10&&f.showWhen?.name==='mode'&&f.showWhen.equals.includes('custom')));
  assert.ok(matrix.fields.some(f=>f.name==='department_id'&&f.showWhen?.name==='mode'&&f.showWhen.equals.includes('custom')));
  assert.deepEqual(matrix.toPayload({mode:'custom',capability_keys:['executive.view'],department_id:'',note:'اختيار تجريبي'}),{
    user_id:'employee',mode:'custom',capability_keys:['executive.view'],department_id:null,note:'اختيار تجريبي'
  });
  const create=accountsUI.form('create','',data);
  assert.deepEqual(create.toPayload({name:'اسم',username:' New.User ',department_id:'hr',role:'employee',manager_id:'',temporary_password:'Welcome-2026'}),{name:'اسم',username:'new.user',department_id:'hr',role:'employee',manager_id:null,temporary_password:'Welcome-2026'});
  const edit=accountsUI.form('edit','employee',data);
  assert.equal(edit.method,'PATCH');assert.deepEqual(edit.toPayload({name:'س',department_id:'creative',role:'employee',manager_id:'manager',active:'false'}),{name:'س',department_id:'creative',role:'employee',manager_id:'manager',active:false});
  const routing=accountsUI.form('routing','hr',data);
  assert.deepEqual(routing.toPayload({step_role:'hr',user_id:''}),{department_id:'hr',step_role:'hr',user_id:null});
  assert.throws(()=>accountsUI.form('edit','admin',data),/غير متاح/);
});
