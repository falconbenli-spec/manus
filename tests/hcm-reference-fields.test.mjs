import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { openDb, transaction } from '../app/db.mjs';
import { seed } from '../scripts/seed.mjs';
import { installServiceCatalog, fieldModel } from '../app/service-catalog.mjs';
import { REGULATION_LEAVE_TYPES } from '../app/leave-types.mjs';
import * as wf from '../app/workflow.mjs';
import { adoptStarter, approveTemplate, lettersBoard } from '../app/letters.mjs';
import { grantAccess } from '../app/access.mjs';

const HCM_LEAVE_EQUIVALENTS={
  annual:['annual'],sick:['sick'],maternity:['maternity'],paternity:['birth'],hajj:['hajj'],marriage:['marriage'],
  bereavement:['death_close','death_sibling'],study:['exam'],iddah:['iddah']
};
const HCM_BANK_CODES=['snb','rajhi','saib','bsf','sab','riyad','anb','albilad','aljazira','alinma','gib','citisa','deutsa','bnpa','hsbcsa','stcbank','d360','sdb','ezbk'];
const HCM_EMBASSY_CODES=['eg','jo','lb','sy','iq','ye','sd','ma','tn','dz','ly','mr','so','dj','km','pk','in','bd','lk','np','ph','id','my','th','vn','cn','jp','kr','tr','ir','et','er','ke','tz','ug','ng','gh','sn','cm','us','gb','fr','de','it','es','nl','be','ch','se','no','dk','fi','at','pt','gr','ru','ca','au','nz','br','ar','mx','za'];
const riyadhToday=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Riyadh',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());

const fixture=t=>{
  const db=openDb(':memory:');seed(db,'synthetic-hcm-reference-fields');installServiceCatalog(db);t.after(()=>db.close());
  const users=Object.fromEntries(db.prepare('SELECT * FROM users').all().map(user=>[user.id,user]));
  return {db,users,tx:fn=>transaction(db,fn)};
};

test('the governed leave policy covers every leave family shown in the HCM reference without losing the richer statutory model',()=>{
  const codes=new Set(REGULATION_LEAVE_TYPES.map(type=>type.code));
  for(const [hcm,equivalents] of Object.entries(HCM_LEAVE_EQUIVALENTS))
    for(const code of equivalents)assert.ok(codes.has(code),`${hcm} is represented by ${code}`);
  assert.ok(REGULATION_LEAVE_TYPES.length>Object.keys(HCM_LEAVE_EQUIVALENTS).length,'the statutory platform model remains richer than the old HCM list');
});

test('salary certificate offers the HCM bank and embassy directories as structured conditional fields',t=>{
  const {db}=fixture(t);
  const active=kind=>new Set(db.prepare('SELECT code FROM letter_addressees WHERE kind=? AND active=1').all(kind).map(row=>row.code));
  for(const code of HCM_BANK_CODES)assert.ok(active('bank').has(code),`bank ${code}`);
  for(const code of HCM_EMBASSY_CODES)assert.ok(active('embassy').has(code),`embassy ${code}`);

  const fields=fieldModel('HR-SALARY-CERT'),byKey=Object.fromEntries(fields.map(field=>[field.key,field]));
  assert.deepEqual(byKey.recipient_kind.options,['بنك','سفارة','جهة حكومية','لمن يهمه الأمر','جهة أخرى']);
  assert.equal(byKey.recipient_bank.show_when.field,'recipient_kind');
  assert.equal(byKey.recipient_embassy.show_when.field,'recipient_kind');
  assert.ok(byKey.recipient_bank.options.includes('البنك السعودي الرقمي'));
  assert.ok(byKey.recipient_embassy.options.includes('سفارة جنوب أفريقيا'));
});

test('migration 204 publishes the structured salary certificate form over a persisted legacy version',t=>{
  const {db,users,tx}=fixture(t),legacy=[
    {key:'recipient',label:'الجهة الموجه إليها',type:'text',required:true},
    {key:'language',label:'لغة التعريف',type:'select',required:true,options:['العربية','الإنجليزية']},
    {key:'show_salary',label:'إظهار تفاصيل الراتب',type:'select',required:true,options:['نعم','الإجمالي فقط','بدون راتب']},
    {key:'notes',label:'ملاحظات',type:'textarea',required:false}
  ];
  const original=db.prepare("SELECT * FROM services WHERE code='HR-SALARY-CERT' ORDER BY version DESC LIMIT 1").get();
  tx(()=>wf.createService(db,users.admin,{code:original.code,name_ar:original.name_ar,name_en:original.name_en,department_id:original.department_id,description:original.description,fields:legacy,approval_policy:JSON.parse(original.approval_policy)}));
  const current=db.prepare("SELECT * FROM services WHERE code='HR-SALARY-CERT' ORDER BY version DESC LIMIT 1").get();
  db.exec(readFileSync(new URL('../app/migrations/204-salary-certificate-structured-addressee.sql',import.meta.url),'utf8'));
  const upgraded=db.prepare("SELECT version,fields FROM services WHERE code='HR-SALARY-CERT' ORDER BY version DESC LIMIT 1").get(),fields=JSON.parse(upgraded.fields),byKey=Object.fromEntries(fields.map(field=>[field.key,field]));
  assert.equal(upgraded.version,current.version+1);
  assert.deepEqual(fields.map(field=>field.key),['recipient_kind','recipient_bank','recipient_embassy','recipient_government','recipient_other','language','show_salary','notes']);
  assert.equal(byKey.recipient_bank.options.length,19);
  assert.equal(byKey.recipient_embassy.options.length,74);
  assert.equal(byKey.recipient_government.options.length,8);
  assert.deepEqual(byKey.recipient_embassy.show_when,{field:'recipient_kind',equals:['سفارة']});
});

test('an approved catalog request carries the selected bank into the employee letter record by code',t=>{
  const {db,users,tx}=fixture(t);
  db.exec("INSERT INTO users(id,tenant_id,department_id,username,name,password_hash,role,manager_id) VALUES('head-hr-hcm','36t','hr','head-hr-hcm','مدير موارد بشرية مصطنع','unused','manager',NULL)");
  users['head-hr-hcm']=db.prepare("SELECT * FROM users WHERE id='head-hr-hcm'").get();
  tx(()=>grantAccess(db,users.admin,{user_id:'head-hr-hcm',capability:'hr.letters.issue',note:'تصريح مصطنع لاختبار تعريف الراتب'}));
  tx(()=>adoptStarter(db,users.hr,'salary',{}));
  const draft=db.prepare("SELECT version FROM letter_templates WHERE tenant_id='36t' AND type_code='salary' AND status='draft'").get();
  tx(()=>approveTemplate(db,users['head-hr-hcm'],'salary',{effective_from:riyadhToday(),note:'اعتماد مصطنع لاختبار الربط المنظم',version:draft.version}));

  const service=wf.catalog(db,users.employee).find(row=>row.code==='HR-SALARY-CERT');
  let request=tx(()=>wf.createRequest(db,users.employee,{service_id:service.id,title:'تعريف راتب للبنك السعودي الرقمي',payload:{recipient_kind:'بنك',recipient_bank:'البنك السعودي الرقمي',language:'العربية',show_salary:'الإجمالي فقط'},project_id:null}));
  request=tx(()=>wf.transition(db,users.employee,request.id,'submit',{version:request.version}));
  for(let step=db.prepare("SELECT approver_id FROM approval_steps WHERE request_id=? AND status='pending' ORDER BY position LIMIT 1").get(request.id);step;step=db.prepare("SELECT approver_id FROM approval_steps WHERE request_id=? AND status='pending' ORDER BY position LIMIT 1").get(request.id)){
    request=tx(()=>wf.transition(db,db.prepare('SELECT * FROM users WHERE id=?').get(step.approver_id),request.id,'approve',{version:request.version,note:'اعتماد مصطنع'}));
  }
  const link=db.prepare('SELECT record_id FROM service_request_links WHERE request_id=?').get(request.id);
  assert.ok(link?.record_id,`approved request should have a letter link; status=${request.status}`);
  const visible=lettersBoard(db,users.employee).requests;
  const letter=visible.find(row=>row.id===link.record_id);
  assert.ok(letter,`linked letter ${link.record_id} should be visible; visible=${visible.map(row=>row.id).join(',')}`);
  assert.equal(letter.options.addressee_kind,'bank');
  assert.equal(letter.options.addressee_code,'sdb');
  assert.equal(letter.addressee,'البنك السعودي الرقمي');
});
