import test from 'node:test';
import assert from 'node:assert/strict';
import { openDb, transaction, verifyAudit } from '../app/db.mjs';
import { seed } from '../scripts/seed.mjs';
import * as wf from '../app/workflow.mjs';
import { installServiceCatalog } from '../app/service-catalog.mjs';
import { saveStepTemplate, openBundle } from '../app/lifecycle.mjs';

// فجوة سلاسل نماذج درايف (30 سبتمبر): النماذج توقّع «نائب الرئيس للخدمات المؤسسية» ثم «الرئيس التنفيذي»
// في خانتين متتاليتين، والدور `executive` وحده لا يفرّق بينهما — فكانت القاعدة التي تمنع تكرار الدور
// تمنع معها تمثيل السلسلة. هذا الملف يثبّت الأربعة معًا: أن الخانتين صارتا خطوتين بشخصين، وأن القاعدة
// لم تُرفَع، وأن الشكل القديم لم يتغيّر، وأن كل خدمة سارية بقيت صالحة. وكل ما فيه مصطنع «تجريبي».
const code=value=>error=>error.code===value;

function fixture(t){
  const db=openDb(':memory:');seed(db,'synthetic-approval-roles');installServiceCatalog(db);t.after(()=>db.close());
  const user=id=>db.prepare('SELECT * FROM users WHERE id=?').get(id);
  const tx=f=>transaction(db,f);
  const service=c=>wf.catalog(db,user('employee')).find(s=>s.code===c);
  const make=policy=>tx(()=>wf.createService(db,user('admin'),{code:'TEST-CHAIN',name_ar:'سلسلة نموذج تجريبية',name_en:'Form chain',department_id:'hr',
    description:'خدمة اختبار لسلسلة اعتماد مشتقة من خانات توقيع نموذج ورقي',
    fields:[{key:'purpose',label:'الغرض',type:'text',required:true}],approval_policy:policy}));
  const steps=r=>db.prepare('SELECT a.position,a.approver_id,b.step_role,b.basis,b.note FROM approval_steps a LEFT JOIN approval_step_basis b ON b.step_id=a.id WHERE a.request_id=? AND a.revision=? ORDER BY a.position').all(r.id,r.revision);
  return {db,user,tx,service,make,steps};
}
// السلسلة كما تقرؤها خانات التوقيع: مدير الإدارة المُعِدّة، ثم رأس المال البشري، ثم نائب القطاع، ثم الرئيس التنفيذي.
const FORM_CHAIN={steps:[{role:'department_manager'},{role:'hr'},{role:'executive',scope:'sector'},{role:'executive',scope:'ceo'}],handler_role:'hr'};

test('أدوار الخطوات: نطاق الرئاسة معروف، وخانتا النموذج تُقبلان خطوتين، والنطاق لا يُكتب على غير الرئاسة',t=>{
  const {make}=fixture(t);
  assert.deepEqual(wf.EXECUTIVE_SCOPES,['sector','ceo'],'النطاقان هما خانتا النموذج: نائب القطاع والرئيس التنفيذي');
  assert.deepEqual(wf.STEP_ROLES,['manager','department_manager','hr','it','pm','executive'],'الأدوار كما كانت: النطاق يميّز ولا يضيف دورًا');
  assert.equal(make(FORM_CHAIN).approval_policy.steps.length,4,'سلسلة النموذج بخانتي الرئاسة تُقبل كما هي');
  assert.throws(()=>make({...FORM_CHAIN,steps:[{role:'hr',scope:'ceo'},{role:'manager'}]}),code('policy'),'النطاق لخطوة الرئاسة وحدها');
  assert.throws(()=>make({...FORM_CHAIN,steps:[{role:'executive',scope:'vp'},{role:'manager'}]}),code('policy'),'نطاق غير معروف يُرفض ولا يُخمَّن');
  assert.throws(()=>make({...FORM_CHAIN,steps:[{role:'executive',scope:''},{role:'manager'}]}),code('policy'));
});

test('أدوار الخطوات: القاعدة قائمة — خطوتان بالدور نفسه وبالنطاق نفسه ما زالتا مرفوضتين',t=>{
  const {make}=fixture(t);
  assert.throws(()=>make({...FORM_CHAIN,steps:[{role:'executive'},{role:'executive'}]}),code('policy'),'خطوتا رئاسة بلا نطاق: كما كان الرفض قبل التعديل');
  assert.throws(()=>make({...FORM_CHAIN,steps:[{role:'executive',scope:'ceo'},{role:'executive',scope:'ceo'}]}),code('policy'),'النطاق نفسه مرتين = شخص واحد يعتمد خطوتين');
  assert.throws(()=>make({...FORM_CHAIN,steps:[{role:'executive',scope:'sector'},{role:'executive',scope:'sector'}]}),code('policy'));
  assert.throws(()=>make({...FORM_CHAIN,steps:['hr','hr']}),code('policy'),'الشكل النصي القديم يُرفض كما كان');
  assert.throws(()=>make({...FORM_CHAIN,steps:[{role:'hr'},{role:'hr'}]}),code('policy'));
  assert.throws(()=>make({...FORM_CHAIN,steps:[...FORM_CHAIN.steps,'it','pm']}),code('policy'),'حدّ الخطوات خمس ولم يُرفع: سلاسل النماذج تقف عند أربع');
});

test('أدوار الخطوات: سلسلة النموذج تُقدَّم فعلًا، فتُحَل خانتاها إلى شخصين مختلفين ويُكتب سندهما',t=>{
  const {db,user,tx,service,make,steps}=fixture(t);
  make(FORM_CHAIN);
  const employee=user('employee');
  const request=tx(()=>wf.createRequest(db,employee,{service_id:service('TEST-CHAIN').id,title:'طلب تجريبي على سلسلة النموذج',payload:{purpose:'غرض تجريبي مصطنع'},project_id:null}));
  tx(()=>wf.transition(db,employee,request.id,'submit',{version:wf.getRequest(db,employee,request.id).version,note:''}));
  const plan=steps(wf.getRequest(db,employee,request.id));
  assert.equal(plan.length,4,'الخطوات الأربع كلها كُتبت');
  // نائب الرئيس للخدمات المؤسسية للقطاع المؤسسي، والرئيس التنفيذي بعده: شخصان لا شخص واحد.
  assert.deepEqual(plan.map(s=>s.approver_id),['head-hr','hr','vp-corporate','ceo'],'كل خانة في النموذج حُلّت إلى صاحبها');
  assert.equal(new Set(plan.map(s=>s.approver_id)).size,4,'أربع خانات = أربعة أشخاص، فلا قرار واحد يُحسب اعتمادين');
  // سند الخطوة يُكتب في جدول مقيَّد بستة أدوار، فنجاحه هنا هو الدليل على أن النطاق لا يلزمه عمود جديد.
  assert.deepEqual(plan.map(s=>s.step_role),['department_manager','hr','executive','executive']);
  assert.deepEqual(plan.slice(2).map(s=>s.basis),['executive','executive']);
  assert.deepEqual(plan.slice(2).map(s=>s.note),['اعتماد نائب القطاع','اعتماد الرئاسة'],'الشاشة تقول أي خانة رئاسة هذه');
  // ومن يعتمد كل خانة هو صاحبها وحده: الرئيس التنفيذي لا يوقّع خانة النائب ولا العكس.
  const rows=db.prepare('SELECT * FROM approval_steps WHERE request_id=? ORDER BY position').all(request.id),r=wf.getRequest(db,employee,request.id);
  assert.equal(wf.mayDecideStep(db,user('vp-corporate'),r,rows[2]),true);
  assert.equal(wf.mayDecideStep(db,user('ceo'),r,rows[2]),false,'خانة النائب ليست للرئيس التنفيذي');
  assert.equal(wf.mayDecideStep(db,user('vp-corporate'),r,rows[3]),false,'وخانة الرئيس التنفيذي ليست للنائب');
  assert.equal(wf.mayDecideStep(db,user('ceo'),r,rows[3]),true);
  assert.ok(verifyAudit(db));
});

test('أدوار الخطوات: كل خدمة سارية في الكتالوج تبقى صالحة بعد التمييز',t=>{
  const {db,user}=fixture(t);
  const admin=user('admin');
  const rows=db.prepare(`SELECT code,version,approval_policy,fields FROM services s WHERE tenant_id=? AND active=1
    AND version=(SELECT MAX(version) FROM services n WHERE n.tenant_id=s.tenant_id AND n.code=s.code)`).all(admin.tenant_id);
  const rejected=[];
  for(const s of rows){
    try{wf.validatePolicy(db,admin,JSON.parse(s.approval_policy),JSON.parse(s.fields));}
    catch(error){rejected.push(`${s.code} v${s.version}: ${error.message}`);}
  }
  assert.deepEqual(rejected,[],'التمييز إضافةٌ اختيارية: ما لا يحمل نطاقًا يُقرأ كما كان');
  assert.ok(rows.length>=142,`الكتالوج كامل: ${rows.length} خدمة سارية`);
});

// محطات القالب: يُبنى عليها الاختباران التاليان.
function stations(t){
  const f=fixture(t),hr=f.user('hr');
  const station=(code,title,department,role)=>f.tx(()=>saveStepTemplate(f.db,hr,{kind:'offboarding',code,title,department_id:department,owner_role:role,
    target_days:2,acceptance:'دليل تجريبي موثق يطابق معيار المحطة',basis:'قرار تجريبي من مالك الإجراء بتاريخ مصطنع'}));
  const open=()=>f.tx(()=>openBundle(f.db,hr,{kind:'offboarding',employee_id:'employee',owner_id:'manager',effective_date:'2026-12-01',
    date_basis:'خطاب تجريبي مؤرخ أكدته الموارد البشرية التجريبية'}));
  return {...f,station,open};
}

test('رحلة الموظف: ست محطات تُحفَظ وتُفتَح — عدد المحطات لم يكن القيد قط',t=>{
  const {db,station,open}=stations(t);
  // OWNER_ROLES قائمة أدوارِ حسابات لا حدٌّ لعدد المحطات: ست محطات بست مالكين تُفتَح كما هي.
  for(const [code,title,department,role] of [['CLR-MGR','محطة المدير المباشر (تجريبي)','creative','manager'],
    ['CLR-FIN','محطة الإدارة المالية (تجريبي)','finance','manager'],['CLR-IT','محطة تقنية المعلومات (تجريبي)','it','it'],
    ['CLR-HR','محطة الموارد البشرية (تجريبي)','hr','hr'],['CLR-GRC','محطة الالتزام (تجريبي)','grc','manager'],
    ['CLR-PRC','محطة المشتريات (تجريبي)','procurement','manager']])assert.ok(station(code,title,department,role).id);
  assert.equal(open().steps,6,'ست محطات بست مالكين تُفتَح كما هي');
  assert.ok(verifyAudit(db));
});

test('رحلة الموظف: محطة الرئاسة هي التي لا تُمثَّل، وأسماء خانات النموذج ليست أدوار حسابات',t=>{
  const {db,station,open}=stations(t);
  // «مالية» و«رئيس تنفيذي» و«شؤون إدارية» أسماء خانات لا أدوار حسابات: تُرفض قبل أن تلمس القاعدة.
  for(const role of ['finance','ceo','admin_affairs'])
    assert.throws(()=>station('CLR-'+role.toUpperCase(),`محطة ${role} (تجريبي)`,'finance',role),code('owner_role'),'اسم الخانة لا يصير دور حساب');
  // والمحطة التي لا تُمثَّل هي الرئاسة: مكتب الرئيس التنفيذي فيه أربعة حسابات بدور مدير، والقالب لا يميّز أيّها.
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM users WHERE department_id='ceo-office' AND role='manager' AND active=1").get().n,4);
  station('CLR-CEO','محطة الرئيس التنفيذي (تجريبي)','ceo-office','manager');
  assert.throws(open,error=>error.code==='step_owner_unavailable'
    &&error.message.includes('مكتب الرئيس التنفيذي')&&error.message.includes('مدير فريق')&&error.message.includes('4'),
    'الرفض يسمّي الإدارة والدور بالعربية والعدد ويقول المخرج، لا «ووُجد 4» بمفتاح إنجليزي');
  assert.ok(verifyAudit(db));
});
