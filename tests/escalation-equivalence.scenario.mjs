// مشهد التكافؤ (الموجة 2، العطب 6): يبني طلبات في كل حالة ومسار، ثم يسأل السطح العام عن كل (مستخدم، طلب):
// هل يراه؟ ما أفعاله؟ أي خطواته المعلقة عنده؟ هل في قائمته؟ هل ينتظره؟ الناتج هيكل قانوني بلا معرّفات ولا أوقات،
// فبصمته واحدة في كل تشغيل. شُغِّل هذا الملف نفسه على 434b411 (قبل التصعيد الحقيقي) وثُبّتت بصمته في الاختبار:
// من يغيّر «من يملك القرار» حين لا صف تصعيد تتغير البصمة عنده. لا يستعمل إلا دوالّ موجودة في الإصدارين. كل ما فيه مصطنع.
import { openDb, transaction, hash } from '../app/db.mjs';
import { seed } from '../scripts/seed.mjs';
import * as wf from '../app/workflow.mjs';
import { installServiceCatalog, fieldModel } from '../app/service-catalog.mjs';
import { createDelegation } from '../app/delegations.mjs';
import { payloadForStored } from '../scripts/qa-catalog-sweep.mjs';

// لحظة التقديم لا تُعدَّل (مشغّل version_no_update)؛ يُرفع المشغّل للتأريخ ثم يُعاد كما هو، كما تفعل اختبارات «ما عليّ».
export function backdate(db,requestId,iso){
  const trigger=db.prepare("SELECT sql FROM sqlite_master WHERE type='trigger' AND name='version_no_update'").get().sql;
  db.exec('DROP TRIGGER version_no_update');
  db.prepare('UPDATE request_versions SET created_at=? WHERE request_id=?').run(iso,requestId);
  db.prepare('UPDATE requests SET created_at=?,updated_at=? WHERE id=?').run(iso,iso,requestId);
  db.exec(trigger);
}
export function buildScenario(){
  const db=openDb(':memory:');seed(db,'synthetic-equivalence');installServiceCatalog(db);
  const tx=f=>transaction(db,f),user=id=>db.prepare('SELECT * FROM users WHERE id=?').get(id);
  const service=code=>wf.catalog(db,user('admin')).find(s=>s.code===code);
  const insider=(id,department,boss)=>db.prepare("INSERT INTO users(id,tenant_id,department_id,username,name,password_hash,role,manager_id,active) VALUES(?,'36t',?,?,?,'x','employee',?,1)").run(id,department,id,`موظف تجريبي ${id}`,boss);
  insider('fin-staff','finance','head-finance');insider('hr-staff','hr','head-hr');
  const requests=[],errors=[];
  const row=id=>db.prepare('SELECT * FROM requests WHERE id=?').get(id);
  const create=(code,who,submit=true)=>{
    const definition=service(code);
    let r=tx(()=>wf.createRequest(db,user(who),{service_id:definition.id,title:`طلب تجريبي — ${code}`,payload:payloadForStored(definition.fields,fieldModel(code))}));
    if(submit)r=tx(()=>wf.transition(db,user(who),r.id,'submit',{version:r.version,note:''}));
    requests.push(r.id);return r.id;
  };
  const move=(rid,action,note='ملاحظة تجريبية لاختبار التكافؤ')=>{
    const r=row(rid),step=db.prepare("SELECT * FROM approval_steps WHERE request_id=? AND revision=? AND status='pending' ORDER BY position LIMIT 1").get(rid,r.revision);
    const who=['approve','return','reject'].includes(action)?step.approver_id:action==='claim'||action==='complete'?null:r.requester_id;
    return tx(()=>wf.transition(db,user(who),rid,action,{version:r.version,note}));
  };
  const as=(who,rid,action,note='ملاحظة تجريبية لاختبار التكافؤ')=>tx(()=>wf.transition(db,user(who),rid,action,{version:row(rid).version,note}));
  const attempt=(label,f)=>{try{f();}catch(error){errors.push(`${label}:${error.code??error.message}`);}};
  attempt('pending-first',()=>create('HR-LETTER','employee'));
  attempt('pending-second',()=>{const id=create('HR-LETTER','employee');move(id,'approve');});
  attempt('returned',()=>{const id=create('HR-LETTER','outsider');move(id,'approve');move(id,'return');});
  attempt('rejected',()=>{const id=create('HR-LETTER','employee');move(id,'reject');});
  attempt('approved',()=>{const id=create('IT-SUPPORT','employee');move(id,'approve');});
  attempt('in-progress',()=>{const id=create('IT-SUPPORT','outsider');move(id,'approve');as('it',id,'claim');});
  attempt('draft',()=>create('HR-LETTER','employee',false));
  attempt('cancelled',()=>{const id=create('IT-SUPPORT','employee');as('employee',id,'cancel');});
  attempt('sod-two-steps',()=>create('FIN-PAYMENT-REQUEST','employee'));
  attempt('sod-insider',()=>{const id=create('FIN-PAYMENT-REQUEST','fin-staff');move(id,'approve');});
  attempt('confidential-approved',()=>{const id=create('HR-SALARY-CERT','employee');move(id,'approve');});
  attempt('closed-circle',()=>create('HR-GRIEVANCE','employee'));
  attempt('manager-requests',()=>create('HR-LETTER','manager'));
  attempt('head-inside',()=>create('HR-LETTER','head-hr'));
  attempt('inside-staff',()=>create('HR-LETTER','hr-staff'));
  attempt('it-access',()=>create('IT-ACCESS','it'));
  // نسخة ثانية بعد إعادة من الخطوة الأولى: خطوة النسخة الأولى التالية تبقى «pending» يتيمة إلى الأبد.
  attempt('resubmitted',()=>{const id=create('HR-LETTER','employee');move(id,'return');as('employee',id,'submit','');});
  // طلب مضى على وصوله يومان: «escalate» (تذكير المعتمد) متاح لصاحبه.
  attempt('two-days-old',()=>{const id=create('HR-LETTER','outsider');backdate(db,id,new Date(Date.now()-2*86400000).toISOString());});
  // تفويض سارٍ بين مديرَين في الإدارة نفسها: المفوَّض يقرر ما عند المفوِّض.
  attempt('delegation',()=>tx(()=>createDelegation(db,user('vp-growth'),{delegate_id:'vp-corporate',service_code:'HR-LETTER',
    starts_at:new Date(Date.now()-3600000).toISOString(),ends_at:new Date(Date.now()+7*86400000).toISOString(),reason:'تفويض تجريبي لاختبار التكافؤ'})));
  db.prepare("UPDATE users SET active=0 WHERE id='head-pr'").run();
  return {db,requests,errors,user};
}

// أفعال 434b411. فعل أُضيف بعدها (release) له اختباره، ولا يدخل بصمة التكافؤ: السؤال هنا «هل تغيّر ما كان؟» لا «هل زاد شيء؟».
const BASE_ACTIONS=new Set(['edit','attach','submit','cancel','approve','return','reject','escalate','claim','transfer','assign_task','complete']);
// السطح العام كما يراه كل حساب، بلا معرّف ولا وقت: الطلب برقمه في المشهد.
export function publicSurface({db,requests,errors,user}){
  const people=db.prepare('SELECT id FROM users ORDER BY id').all().map(u=>user(u.id));
  const out={errors,statuses:requests.map(id=>db.prepare('SELECT status,revision FROM requests WHERE id=?').get(id)),people:{}};
  for(const person of people){
    const listed=new Map();
    try{for(const r of wf.listRequests(db,person,'',''))listed.set(r.id,r.needs_me);}catch(error){out.people[person.id]={error:error.code??'error'};continue;}
    out.people[person.id]=requests.map(id=>{
      let raw=null;try{raw=wf.getRequest(db,person,id);}catch{raw=null;}
      const direct=db.prepare('SELECT * FROM requests WHERE id=?').get(id);
      return {visible:!!raw,actions:raw?wf.actions(db,person,raw).filter(a=>BASE_ACTIONS.has(a)):[],pending:wf.pendingStepsFor(db,person,direct).map(s=>s.position),
        listed:listed.has(id),needs_me:listed.get(id)??false};
    });
  }
  return out;
}
export const surfaceDigest=surface=>hash(JSON.stringify(surface));
