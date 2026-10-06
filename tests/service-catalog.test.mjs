import test from 'node:test';
import assert from 'node:assert/strict';
import { openDb, transaction } from '../app/db.mjs';
import { seed } from '../scripts/seed.mjs';
import { installServiceCatalog, catalogServices, companyDepartments, retiredDepartments, baseServiceSections, executiveLayer } from '../app/service-catalog.mjs';
import * as wf from '../app/workflow.mjs';
import { listDelegations } from '../app/delegations.mjs';
import { departmentDirectory } from '../app/static/hr-design.mjs';
import { operationModules } from '../app/static/operations.mjs';
import { CRM_FRONT_DOOR } from '../app/crm-front-door.mjs';

const user=(db,id)=>db.prepare('SELECT * FROM users WHERE id=?').get(id);
const e=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function setup(){const db=openDb(':memory:');seed(db,'synthetic-catalog-only');return db;}
// مسح الكتالوج 20 سبتمبر (العطبان 2 و3): صيغة الحقل وحدّا طوله صارا مفروضين على الخادم من نسخة الخدمة،
// فالقيمة المولَّدة تلتزم بما يعلنه الحقل عن نفسه — وهذا هو الفحص: خدمة تعلن صيغة لا قيمة تطابقها تسقط هنا.
const PATTERN_SAMPLES=['10:00','2026-03','0937','2026-10-01','1'];
function sample(field){
  if(field.type==='date')return '2026-10-01';
  if(field.type==='select')return field.options[0];
  if(field.type==='number')return '12.5';
  if(field.pattern){
    const regex=new RegExp(field.pattern);
    const match=PATTERN_SAMPLES.find(x=>regex.test(x)&&x.length>=(field.min_length??1)&&x.length<=(field.max_length??3000));
    assert.ok(match,`${field.key}: no sample satisfies the declared format ${field.pattern}`);
    return match;
  }
  const base='قيمة تجريبية للحقل';
  const min=field.min_length??1,max=field.max_length??3000;
  return (base.length>=min?base:base.padEnd(min,'ـ')).slice(0,max);
}

test('CATALOG: installs every proposed department, one head each, and all services once',()=>{
  const db=setup();
  try{
    const first=installServiceCatalog(db);
    const seeded=['creative','hr','it','ops'],heads=companyDepartments.filter(d=>d.head);
    const sections=catalogServices.length+Object.keys(baseServiceSections).length;
    assert.deepEqual(first,{departments:companyDepartments.length-seeded.length,renamed:seeded.length,heads:heads.length+executiveLayer.length,routing:1,escalation:companyDepartments.length,services:catalogServices.length,moved:0,revised:0,sections,targets:sections,retired:0});
    assert.equal(new Set(catalogServices.map(s=>s.code)).size,catalogServices.length);
    assert.ok(catalogServices.every(s=>s.req.length&&s.req.every(id=>/^[A-Z]{2,3}-\d{2}$/.test(id))));
    for(const code of ['EXP-RECOGNITION','EXP-INTERNAL-EVENT','EXP-WELCOME','EXP-FAREWELL']){
      const engagement=catalogServices.find(service=>service.code===code);
      assert.equal(engagement.department_id,'comms',`${code}: اندماج الموظف يتبع التواصل الداخلي`);
      assert.equal(engagement.section,'اندماج الموظف',`${code}: يظهر في قسم واحد واضح`);
    }
    const again=installServiceCatalog(db);
    assert.deepEqual(again,{departments:0,renamed:0,heads:0,routing:0,escalation:0,services:0,moved:0,revised:0,sections:0,targets:0,retired:0});
    assert.ok(db.prepare("SELECT COUNT(*) AS n FROM service_directory WHERE target_days=0").get().n===0,'every service carries a service level');
    assert.equal(db.prepare("SELECT name FROM departments WHERE id='hr'").get().name,'رأس المال البشري','seeded departments take their approved names');
    assert.ok(companyDepartments.every(d=>db.prepare('SELECT sector FROM departments WHERE id=?').get(d.id).sector===d.sector));
    assert.ok(retiredDepartments.every(d=>!db.prepare('SELECT 1 FROM departments WHERE id=? AND active=1').get(d.id)));
    const catalog=wf.catalog(db,user(db,'employee'));
    assert.equal(catalog.length,catalogServices.length+3);
    assert.ok(catalog.every(s=>typeof s.section==='string'&&s.section.length>1),'every service has a section');
    for(const d of heads){
      const managers=db.prepare("SELECT COUNT(*) AS n FROM users WHERE department_id=? AND role='manager' AND active=1").get(d.id).n;
      const assigned=db.prepare("SELECT user_id FROM department_routing WHERE department_id=? AND step_role='department_manager'").get(d.id);
      assert.ok(managers===1||assigned,`${d.id}: several managers need a named approver`);
    }
    assert.equal(db.prepare("SELECT user_id FROM department_routing WHERE department_id='ceo-office' AND step_role='department_manager'").get().user_id,'head-ceo-office','the executive layer shares the CEO office, so its approver is named explicitly');
    for(const d of companyDepartments)assert.ok(d.head==='ceo'||db.prepare('SELECT 1 FROM department_escalation WHERE department_id=?').get(d.id),`${d.id}: needs an escalation approver above its head`);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM audit_events WHERE action='department.created'").get().n,companyDepartments.length-seeded.length);
  }finally{db.close();}
});

test('CATALOG: refuses a non-synthetic tenant and an existing account with a different role',()=>{
  const db=setup();
  try{
    db.prepare("INSERT INTO users(id,tenant_id,department_id,username,name,password_hash,role) VALUES('head-grc','36t','creative','head-grc','حساب قائم',?,'employee')").run(user(db,'manager').password_hash);
    assert.throws(()=>installServiceCatalog(db),/Existing account differs/);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM departments WHERE id='ceo-office'").get().n,0,'a refused install leaves no partial departments');
    // الحارس كان يطابق اسم الكيان «3,6T — بيئة تجريبية» بحرفه، فكان اسم الشركة على الشاشة اعتماديةً صلبة:
    // تسميتها باسمها تُعطِّل المثبِّت. وبقرار المالك في 23 سبتمبر 2026 أن تُجهَّز المنصة لكل الموظفين، صار
    // الاسم اسمًا للعرض وحده و«هل البيانات تجريبية؟» حقيقةً مسجَّلة (الترحيل 137). فالحالتان تُختبران معًا،
    // وهما أقوى مما كان: كيان غير موجود، وكيان أقرّ المالك أن بياناته صارت بيانات الشركة.
    const empty=openDb(':memory:');
    try{assert.throws(()=>installServiceCatalog(empty),/Tenant 36t not found/);}finally{empty.close();}
    db.prepare("UPDATE tenants SET demo_data=0 WHERE id='36t'").run();
    assert.throws(()=>installServiceCatalog(db),/marked as holding real company data/);
    db.prepare("UPDATE tenants SET name='3,6T' WHERE id='36t'").run();
    assert.throws(()=>installServiceCatalog(db),/marked as holding real company data/,'الاسم لم يعد هو الحارس');
    db.prepare("UPDATE tenants SET demo_data=1 WHERE id='36t'").run();
    assert.throws(()=>installServiceCatalog(db),/Existing account differs/,'وباسم الشركة الحقيقي يعمل المثبِّت ويقف عند سببه الحقيقي');
  }finally{db.close();}
});

test('CATALOG: every service accepts a complete request and routes to its approvers',()=>{
  const db=setup();
  try{
    installServiceCatalog(db);
    const employee=user(db,'employee');
    for(const service of wf.catalog(db,employee).filter(s=>catalogServices.some(c=>c.code===s.code))){
      const payload=Object.fromEntries(service.fields.filter(f=>f.required).map(f=>[f.key,sample(f)]));
      // الباب الأمامي الواحد (P4-CRM-3): الفرصة والخسارة والتسليم سجلاتها المهيكلة، والطلب النصي يُرفض بإشارة إليها.
      if(CRM_FRONT_DOOR[service.code]){assert.throws(()=>wf.createRequest(db,employee,{service_id:service.id,title:'طلب اختبار '+service.code,payload,project_id:null}),e=>e.code==='use_structured_record'&&e.details.refusal.link===CRM_FRONT_DOOR[service.code].link,service.code);continue;}
      const request=wf.createRequest(db,employee,{service_id:service.id,title:'طلب اختبار '+service.code,payload,project_id:null});
      const submitted=transaction(db,()=>wf.transition(db,employee,request.id,'submit',{version:request.version}));
      assert.equal(submitted.status,'pending',service.code);
      const steps=db.prepare('SELECT * FROM approval_steps WHERE request_id=? ORDER BY position').all(request.id);
      assert.equal(steps.length,service.approval_policy.steps.length,service.code);
      service.approval_policy.steps.forEach((role,i)=>{
        const approver=user(db,steps[i].approver_id);
        if(role==='manager')assert.equal(approver.id,employee.manager_id,service.code);
        else assert.equal(approver.department_id,service.department_id,service.code);
        assert.equal(approver.role,role==='department_manager'?'manager':role,service.code);
      });
    }
  }finally{db.close();}
});

test('CATALOG: department head approves and executes travel, then reaches the independent output-acceptance gate',()=>{
  const db=setup();
  try{
    installServiceCatalog(db);
    const employee=user(db,'employee'),manager=user(db,'manager'),head=user(db,'head-ceo-office'),outsider=user(db,'outsider'),legal=user(db,'head-grc');
    const service=wf.catalog(db,employee).find(s=>s.code==='ADM-TRAVEL');
    let r=wf.createRequest(db,employee,{service_id:service.id,title:'انتداب تجريبي',payload:{travel_type:'داخلية',city:'جدة',start_date:'2026-10-01',end_date:'2026-10-03',flight:'بدون حجز',housing:'حجز',transport:'بدون حجز',purpose:'اجتماع عميل مصطنع'},project_id:null});
    r=transaction(db,()=>wf.transition(db,employee,r.id,'submit',{version:r.version}));
    assert.throws(()=>transaction(db,()=>wf.transition(db,head,r.id,'approve',{version:r.version})),e=>e.status===404||e.status===403,'head cannot skip the direct manager');
    r=transaction(db,()=>wf.transition(db,manager,r.id,'approve',{version:r.version}));
    assert.throws(()=>transaction(db,()=>wf.transition(db,legal,r.id,'approve',{version:r.version})),e=>e.status===404||e.status===403,'another department head is out of scope');
    r=transaction(db,()=>wf.transition(db,head,r.id,'approve',{version:r.version}));
    assert.equal(r.status,'approved');
    assert.throws(()=>wf.getRequest(db,outsider,r.id),e=>e.status===404);
    r=transaction(db,()=>wf.transition(db,head,r.id,'claim',{version:r.version}));
    assert.throws(()=>transaction(db,()=>wf.transition(db,head,r.id,'complete',{version:r.version,note:'حجز مصطنع موثق دون شراء فعلي'})),e=>e.code==='service_output_required');
    assert.equal(wf.getRequest(db,head,r.id).status,'in_progress');
    assert.ok(listDelegations(db,head).services.some(s=>s.code==='ADM-TRAVEL'));
  }finally{db.close();}
});

test('CATALOG: number fields reject non-numeric values and a head cannot approve their own request',()=>{
  const db=setup();
  try{
    installServiceCatalog(db);
    const employee=user(db,'employee'),head=user(db,'head-ceo-office');
    const claim=wf.catalog(db,employee).find(s=>s.code==='ADM-EXPENSE-CLAIM');
    const payload={expense_date:'2026-09-01',category:'مواصلات',amount:'مئة ريال',description:'مصروف مصطنع'};
    assert.throws(()=>wf.createRequest(db,employee,{service_id:claim.id,title:'مطالبة',payload,project_id:null}),e=>e.code==='invalid_number');
    for(const amount of ['-5','1e3','12.345'])assert.throws(()=>wf.createRequest(db,employee,{service_id:claim.id,title:'مطالبة',payload:{...payload,amount},project_id:null}),e=>e.code==='invalid_number');
    const supplies=wf.catalog(db,head).find(s=>s.code==='ADM-SUPPLIES');
    const own=wf.createRequest(db,head,{service_id:supplies.id,title:'مستلزمات',payload:{items:'أقلام',location:'المكتب'},project_id:null});
    const raised=transaction(db,()=>wf.transition(db,head,own.id,'submit',{version:own.version}));
    const step=db.prepare('SELECT approver_id FROM approval_steps WHERE request_id=? ORDER BY position LIMIT 1').get(raised.id);
    assert.equal(step.approver_id,'ceo','a department head’s own request rises to the escalation approver instead of self-approval');
    db.prepare("DELETE FROM department_escalation WHERE department_id='ceo-office'").run();
    const orphan=wf.createRequest(db,head,{service_id:supplies.id,title:'مستلزمات بلا تصعيد',payload:{items:'أقلام',location:'المكتب'},project_id:null});
    assert.throws(()=>transaction(db,()=>wf.transition(db,head,orphan.id,'submit',{version:orphan.version})),e=>e.code==='escalation_missing','without an escalation approver the request stops instead of self-approving');
  }finally{db.close();}
});

test('CATALOG UI: the department directory lists new departments, their services and bound workspaces',()=>{
  const db=setup();
  try{
    installServiceCatalog(db);
    const me={...user(db,'employee'),capabilities:{finance:false}};
    const departments=db.prepare("SELECT id,name FROM departments WHERE tenant_id='36t' AND active=1").all();
    const services=wf.catalog(db,me);
    const home=departmentDirectory({departments,services,me,modules:operationModules,e});
    assert.equal((home.match(/class="department-card"/g)||[]).length,companyDepartments.length);
    const legal=departmentDirectory({departments,services,me,modules:operationModules,selected:'grc',e});
    assert.match(legal,/مراجعة عقد/);assert.doesNotMatch(legal,/طلب صيانة|ADM-MAINTENANCE/);
    assert.match(departmentDirectory({departments,services,me,modules:operationModules,selected:'procurement',e}),/href="#procurement"/);
  }finally{db.close();}
});

// ثلاث خدمات تجمع «تنتهي في» (access_until) ولا شيء في المنصة يقرؤه: صلاحيات المنصة بلا تاريخ انتهاء (access_grants)، ولا سجل
// لوصول الأنظمة الخارجية وحسابات العملاء. فإرشاد الحقل يقول إن السحب يدوي، ولا يعد بسحبٍ تلقائي لا يحدث.
test('CATALOG: the access_until guidance never promises an automatic revocation the platform does not perform',()=>{
  for(const code of ['IT-ACCESS','DAT-DATA-ACCESS','DIG-AD-ACCOUNT']){
    const field=catalogServices.find(s=>s.code===code)?.fields.find(f=>f.key==='access_until');
    assert.ok(field,`${code}: access_until`);
    assert.doesNotMatch(field.why,/تلقائي|يُسحب في موعد/,`${code}: الإرشاد يعد بسحبٍ تلقائي`);
    assert.match(field.why,/يدوي/,`${code}: الإرشاد يقول إن السحب يدوي`);
  }
});
