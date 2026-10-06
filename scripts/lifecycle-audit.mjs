import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb, transaction } from '../app/db.mjs';
import { seed } from '../scripts/seed.mjs';
import { installServiceCatalog, companyDepartments } from '../app/service-catalog.mjs';
import * as wf from '../app/workflow.mjs';
import * as routing from '../app/routing.mjs';
import * as admin from '../app/admin.mjs';
import { grantAccess } from '../app/access.mjs';
import { adoptStarter, approveTemplate, templatesBoard, lettersBoard, letterAction } from '../app/letters.mjs';
import { resignationAction, resignationsBoard } from '../app/resignations.mjs';
import { ROUTED_SERVICES, requestLink, ensureRoutedRecord, letterType } from '../app/service-routes.mjs';
import { createVendor, vendorAction, getVendor } from '../app/vendors.mjs';
// الإغلاق بابٌ واحد منذ 21 سبتمبر 2026: ما يمشيه هذا الفحص هو ما يمشيه الموظف من الشاشة، لا طريقًا
// أقصر منه. فكل «إغلاق» هنا يمر بـcloseWithEvidence: يشترط وصف ما سُلِّم، ويكتب سجل الإغلاق، ويتحقق
// أن صاحب الطلب أُعلم. فحصٌ يغلق من باب لا يملكه أحد لا يقيس المنصة، بل يقيس نفسه.
import { closeWithEvidence } from '../app/request-closure.mjs';
import { requiresServiceOutput } from '../app/service-outputs.mjs';

// آيبان مصطنع بخانتي تحقق صحيحتين؛ لا يمثل حسابًا حقيقيًا.
const AUDIT_IBAN=(()=>{
  const bban='80000000000000000099';
  const numeric=(bban+'SA00').replace(/[A-Z]/g,c=>String(c.charCodeAt(0)-55));
  let remainder=0;for(const digit of numeric)remainder=(remainder*10+Number(digit))%97;
  return 'SA'+String(98-remainder).padStart(2,'0')+bban;
})();

// Walks every service from draft to closure and reports where a path breaks.
// مسح الكتالوج 20 سبتمبر (العطبان 2 و3): صيغة الحقل وحدّا طوله صارا مفروضين على الخادم، فالقيمة المولَّدة
// تلتزم بما يعلنه الحقل عن نفسه. خدمة تعلن صيغة لا قيمة تطابقها تظهر هنا بدل أن تمضي بقيمة لا تصلح.
const PATTERN_SAMPLES=['10:00','2026-03','0937','2026-10-01','1'];
const sample=field=>{
  if(field.type==='date')return new Date(Date.now()+5*86400000).toISOString().slice(0,10);
  if(field.type==='select')return field.options[0];
  if(field.type==='number')return '25.50';
  if(field.pattern){
    const regex=new RegExp(field.pattern);
    const match=PATTERN_SAMPLES.find(x=>regex.test(x)&&x.length>=(field.min_length??1)&&x.length<=(field.max_length??3000));
    if(!match)throw new Error(`${field.key}: لا قيمة فحص تطابق الصيغة المعلنة ${field.pattern}`);
    return match;
  }
  const base='قيمة فحص مصطنعة',min=field.min_length??1,max=field.max_length??3000;
  return (base.length>=min?base:base.padEnd(min,'ـ')).slice(0,max);
};
const user=(db,id)=>db.prepare('SELECT * FROM users WHERE id=?').get(id);
const riyadhToday=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Riyadh',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
// الخدمات المحوّلة لوحدة (service-routes.mjs) لا تُغلق بلا مخرج وحدتها، فالفحص ينجز عمل الوحدة كما يفعله أصحابه:
// الخطاب: قالب من النص المبدئي يعتمده شخص آخر، ثم ترفضه الموارد البشرية بسبب مكتوب (بيئة الفحص بلا عقود). الاستقالة: يقبلها صاحب الصلاحية.
function moduleWork(db,requestId,code){
  const r=db.prepare('SELECT * FROM requests WHERE id=?').get(requestId),module=ROUTED_SERVICES[code];
  if(module==='letters'){
    const type=letterType(code,JSON.parse(r.payload));
    const hr=user(db,'hr'),issuer=user(db,'head-hr'),t=templatesBoard(db,hr).types.find(x=>x.code===type);
    if(!t.published){
      if(!t.draft||!t.draft.body.trim())adoptStarter(db,hr,type,t.draft?{version:t.draft.version}:{});
      approveTemplate(db,issuer,type,{effective_from:riyadhToday(),note:'اعتماد فحص دورة الخدمة للقالب المبدئي',version:templatesBoard(db,issuer).types.find(x=>x.code===type).draft.version});
    }
    const letterId=ensureRoutedRecord(db,r),row=lettersBoard(db,hr).requests.find(x=>x.id===letterId);
    if(['requested','prepared'].includes(row.status))letterAction(db,hr,row.id,'reject_letter',{version:row.version,note:'بيئة الفحص بلا عقد ساري لصاحب الطلب'});
  }
  if(module==='resignations'){
    const link=requestLink(db,r.id),authority=user(db,'head-hr'),row=resignationsBoard(db,authority).resignations.find(x=>x.id===link.record_id);
    if(['submitted','deferred'].includes(row.status))resignationAction(db,authority,row.id,'accept_resignation',{version:row.version,last_working_day:row.proposed_last_day,notice_waived:true,note:'قبول فحص دورة الخدمة'});
  }
  // مسح الكتالوج 20 سبتمبر (القسم 4-أ): «تحديث بيانات دفع مورد» كانت تُغلق بملاحظة نصية بلا أن تمسّ تصريح
  // «التحقق المالي من بيانات دفع الموردين». صارت لا تُغلق قبل تحقق مسجل في ملف المورد، فالفحص ينجزه كما ينجزه أصحابه:
  // يُسجَّل المورد باسمه المكتوب في الطلب، ويُقترح الحساب بيد، ويُحقَّق منه بيد أخرى تحمل التصريح.
  if(code==='PRC-VENDOR-BANK'){
    const collector=user(db,'employee'),verifier=user(db,'hr'),name=JSON.parse(r.payload).vendor;
    for(const [id,capability] of [['employee','vendors.manage'],['hr','vendors.bank']])
      try{grantAccess(db,user(db,'admin'),{user_id:id,capability,note:'تصريح فحص دورة الخدمة'});}catch(error){if(!['already_granted','already_default'].includes(error.code))throw error;}
    const existing=db.prepare("SELECT id FROM vendors WHERE tenant_id='36t' AND legal_name=?").get(name);
    const vendorId=existing?.id??createVendor(db,collector,{legal_name:name,trade_name:name,entity_type:'company',country:'SA',
      entity_ref:'1010000099',vat_number:'300000000000003',categories:['print_gifts'],regions:'الرياض',payment_terms:'ثلاثون يومًا',
      data_source:'تسجيل فحص دورة الخدمة'}).id;
    vendorAction(db,collector,vendorId,'propose_bank',{version:getVendor(db,collector,vendorId).version,bank_name:'بنك فحص',
      account_holder:name,iban:AUDIT_IBAN,reason:'تغيير حساب المورد في فحص دورة الخدمة'});
    const pending=getVendor(db,verifier,vendorId).bank.find(b=>b.status==='pending');
    vendorAction(db,verifier,vendorId,'verify_bank',{version:getVendor(db,verifier,vendorId).version,bank_id:pending.id,
      decision:'verified',verification_method:'bank_letter',verification_evidence:'خطاب بنكي مطابق في فحص دورة الخدمة',
      effective_from:riyadhToday()});
  }
}

export function auditLifecycles(db){
  const staff={};
  // A requester and a doer inside every department, so no service is tested by its own approver.
  transaction(db,()=>{
    const a=user(db,'admin');
    for(const d of companyDepartments){
      if(d.id==='ops')continue;
      // صاحب صلاحية الخطابات والاستقالات في بيئة الفحص: مدير الموارد البشرية المصطنع.
      if(d.id==='hr')for(const capability of ['hr.letters.issue','hr.contracts.approve'])try{grantAccess(db,a,{user_id:'head-hr',capability,note:'تصريح فحص دورة الخدمة'});}catch(error){if(!['already_granted','already_default'].includes(error.code))throw error;}
      const lead=db.prepare("SELECT id FROM users WHERE tenant_id='36t' AND department_id=? AND role='manager' AND active=1").get(d.id);
      const username=`${d.id}.staff`.replace(/[^a-z0-9._-]/g,'');
      if(!user(db,username))admin.createAccount(db,a,{username,name:`موظف فحص ${d.name}`,role:'employee',department_id:d.id,manager_id:lead?.id??null,temporary_password:'Audit-pass-2026'});
      staff[d.id]=username;
    }
    db.prepare('UPDATE users SET must_change_password=0').run();
  });
  const results=[];
  for(const service of wf.catalog(db,user(db,'admin'))){
    const plain=service.department_id==='creative'?'employee':(staff[service.department_id]??'employee');
    // شجرة الفئات (131) تُسنِد بعض الخدمات إلى جمهور المدير وحده — اليوم واحدة: IT-NEW-ACCOUNT، تجهيز
    // حسابات موظف جديد، لا يطلبها موظفٌ لنفسه أبدًا. فلا يستطيع حسابُ موظفٍ فتح طلب عليها، وهذا **نصّ
    // القاعدة لا عطبٌ فيها**. والفحص يقيس أن الخدمة تمشي دورتها كاملة لا أن كل حساب يطلبها، فيتولّاها
    // مديرُ إدارتها — والمسار نفسه الذي يقيسه auditSelfService: طلبُ المدير يصعد فوقه لا يعتمده بنفسه.
    const lead=db.prepare("SELECT id FROM users WHERE tenant_id='36t' AND department_id=? AND role='manager' AND active=1").get(service.department_id)?.id;
    const requesterId=wf.catalog(db,user(db,plain)).some(s=>s.id===service.id)?plain:(lead??plain);
    const row={code:service.code,department:service.department_id,requester:requesterId,stage:'draft',ok:false,error:null,steps:service.approval_policy.steps.join(' ← ')};
    try{
      transaction(db,()=>{
        const requester=user(db,requesterId);
        const payload=Object.fromEntries(service.fields.filter(f=>f.required).map(f=>[f.key,sample(f)]));
        let r=wf.createRequest(db,requester,{service_id:service.id,title:'فحص دورة '+service.code,payload,project_id:null});
        row.stage='submit';
        r=wf.transition(db,requester,r.id,'submit',{version:r.version});
        row.stage='approve';
        let guard=0;
        while(r.status==='pending'&&guard++<5){
          const step=db.prepare("SELECT * FROM approval_steps WHERE request_id=? AND revision=? AND status='pending' ORDER BY position LIMIT 1").get(r.id,r.revision);
          if(!step)throw new Error('لا توجد خطوة اعتماد معلقة رغم أن الطلب قيد الاعتماد');
          r=wf.transition(db,user(db,step.approver_id),r.id,'approve',{version:r.version,note:'اعتماد فحص'});
        }
        if(r.status!=='approved')throw new Error('انتهى الاعتماد بحالة '+r.status);
        row.stage='claim';
        // من ينفّذ يُسأل عنه المحرك نفسه لا يُفترض بالدور: منذ 21 سبتمبر صار التنفيذ سلسلة — منفّذو
        // الإدارة، فالنواب المقبولون، فسُلَّم التصعيد — و«الدور» وحده لم يعد يسمّي من يملك الاستلام.
        const chain=wf.executionChain(db,service,db.prepare('SELECT * FROM requests WHERE id=?').get(r.id));
        if(chain.basis==='none')throw new Error(chain.refusal.what);
        row.execution_basis=chain.basis;
        const handler=user(db,chain.people[0].id);
        if(!handler)throw new Error('سلسلة التنفيذ أعادت حسابًا غير موجود');
        r=wf.transition(db,handler,r.id,'claim',{version:r.version});
        if(ROUTED_SERVICES[service.code]||service.code==='PRC-VENDOR-BANK'){row.stage='module';moduleWork(db,r.id,service.code);}
        row.stage='complete';
        try{
          r=closeWithEvidence(db,handler,r.id,{version:r.version,delivered:'أُنجزت الخدمة ووُثق دليل تسليمها في سجل الإغلاق'}).request;
        }catch(error){
          if(error.code!=='service_output_required'||!requiresServiceOutput(service.code))throw error;
          row.clock=routing.serviceClock(db,wf.getRequest(db,handler,r.id)).target_days;
          row.stage='output_acceptance';row.gated=true;row.ok=true;
          return;
        }
        if(r.status!=='completed')throw new Error('انتهى التنفيذ بحالة '+r.status);
        row.clock=routing.serviceClock(db,wf.getRequest(db,handler,r.id)).target_days;
        row.stage='closed';row.ok=true;
      });
    }catch(error){row.error=error.message;}
    results.push(row);
  }
  return results;
}


// النهايات الأخرى: الرفض والإعادة والإلغاء والتحويل والإغلاق بمهمة.
export function auditEndings(db){
  const results=[];
  const requester=()=>user(db,'employee');
  const service=code=>wf.catalog(db,user(db,'admin')).find(s=>s.code===code);
  const draft=(code,extra={})=>{
    const s=service(code),u=requester();
    const payload=Object.fromEntries(s.fields.filter(f=>f.required).map(f=>[f.key,sample(f)]));
    return wf.createRequest(db,u,{service_id:s.id,title:'فحص نهاية '+code,payload:{...payload,...extra},project_id:null});
  };
  const approver=r=>user(db,db.prepare("SELECT approver_id FROM approval_steps WHERE request_id=? AND revision=? AND status='pending' ORDER BY position LIMIT 1").get(r.id,r.revision).approver_id);
  const record=(name,expected,run)=>{
    try{const value=transaction(db,run);results.push({name,expected,actual:value,ok:value===expected});}
    catch(error){results.push({name,expected,actual:'خطأ: '+error.message,ok:false});}
  };
  record('الرفض يغلق الطلب','rejected',()=>{
    let r=draft('ADM-ROOM-BOOKING');r=wf.transition(db,requester(),r.id,'submit',{version:r.version});
    r=wf.transition(db,approver(r),r.id,'reject',{version:r.version,note:'القاعة محجوزة لفعالية معتمدة'});
    return r.status;
  });
  record('الإعادة ثم التعديل وإعادة التقديم ثم الاعتماد','completed',()=>{
    let r=draft('ADM-MAINTENANCE');const u=requester();
    r=wf.transition(db,u,r.id,'submit',{version:r.version});
    r=wf.transition(db,approver(r),r.id,'return',{version:r.version,note:'حدد الدور والموقع بدقة'});
    if(r.status!=='returned')throw new Error('لم يعد الطلب للتعديل');
    r=wf.editRequest(db,u,r.id,{version:r.version,title:'فحص نهاية معدل',payload:{category:'كهرباء',location:'الدور الثالث - غرفة الاجتماعات',description:'قاطع كهربائي يفصل',urgency:'عادي'}});
    r=wf.transition(db,u,r.id,'submit',{version:r.version});
    r=wf.transition(db,approver(r),r.id,'approve',{version:r.version,note:'واضح الآن'});
    const handler=user(db,'head-ceo-office');
    r=wf.transition(db,handler,r.id,'claim',{version:r.version});
    r=closeWithEvidence(db,handler,r.id,{version:r.version,delivered:'استُبدل القاطع الكهربائي ووُثقت صورته في سجل الإغلاق'}).request;
    return r.status;
  });
  record('إلغاء صاحب الطلب','cancelled',()=>{
    let r=draft('ADM-SUPPLIES');r=wf.transition(db,requester(),r.id,'submit',{version:r.version});
    r=wf.transition(db,requester(),r.id,'cancel',{version:r.version,note:'لم تعد هناك حاجة'});
    return r.status;
  });
  record('التحويل لإدارة أخرى ثم الإغلاق فيها','procurement',()=>{
    let r=draft('ADM-MAINTENANCE');r=wf.transition(db,requester(),r.id,'submit',{version:r.version});
    r=wf.transition(db,approver(r),r.id,'approve',{version:r.version,note:'معتمد'});
    r=routing.transferRequest(db,user(db,'head-ceo-office'),r.id,{version:r.version,department_id:'procurement',reason:'الصيانة ضمن عقد المورد'});
    const receiver=user(db,'head-procurement');
    r=wf.transition(db,receiver,r.id,'claim',{version:r.version});
    r=closeWithEvidence(db,receiver,r.id,{version:r.version,delivered:'نفذها المورد ووُثق محضر الاستلام في سجل الإغلاق'}).request;
    if(r.status!=='completed')throw new Error('لم يُغلق بعد التحويل');
    return routing.handlingDepartment(db,wf.getRequest(db,receiver,r.id));
  });
  record('مهمة مفتوحة تمنع الإغلاق حتى تُنجز','completed',()=>{
    let r=draft('ADM-VISITOR');r=wf.transition(db,requester(),r.id,'submit',{version:r.version});
    while(r.status==='pending')r=wf.transition(db,approver(r),r.id,'approve',{version:r.version,note:'معتمد'});
    const head=user(db,'head-ceo-office'),staff=db.prepare("SELECT * FROM users WHERE department_id='ceo-office' AND role='employee' AND active=1 LIMIT 1").get();
    r=routing.assignRequestTask(db,head,r.id,{version:r.version,title:'تجهيز بطاقة الزائر',assignee_id:staff.id,due_date:new Date(Date.now()+86400000).toISOString().slice(0,10),acceptance:'بطاقة جاهزة عند الاستقبال'});
    let blocked=false;
    try{closeWithEvidence(db,head,r.id,{version:r.version,delivered:'محاولة إغلاق مبكرة قبل إقفال المهمة المسندة'});}catch{blocked=true;}
    if(!blocked)throw new Error('أُغلق الطلب رغم وجود مهمة مفتوحة');
    const task=routing.listRequestTasks(db,r)[0];
    r=routing.settleRequestTask(db,staff,r.id,task.id,{version:r.version,action:'complete',evidence:'سُلمت البطاقة للاستقبال'});
    r=closeWithEvidence(db,head,r.id,{version:r.version,delivered:'استُقبل الزائر وسُلّمت بطاقته ووُثق دخوله'}).request;
    return r.status;
  });
  return results;
}

// من لا يستطيع طلب خدمة إدارته لأنه هو معتمدها.
export function auditSelfService(db){
  const blocked=[];
  for(const d of companyDepartments){
    if(!d.head)continue;
    const head=user(db,d.head);if(!head)continue;
    for(const service of wf.catalog(db,head).filter(s=>s.department_id===d.id)){
      try{
        transaction(db,()=>{
          const payload=Object.fromEntries(service.fields.filter(f=>f.required).map(f=>[f.key,sample(f)]));
          const r=wf.createRequest(db,head,{service_id:service.id,title:'فحص طلب المدير',payload,project_id:null});
          wf.transition(db,head,r.id,'submit',{version:r.version});
          throw {rollback:true};
        });
      }catch(error){if(error?.code)blocked.push({department:d.id,code:service.code,reason:error.code});}
    }
  }
  return blocked;
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const db=openDb(':memory:');
  seed(db,'synthetic-lifecycle-audit');
  installServiceCatalog(db);
  const results=auditLifecycles(db);
  const failed=results.filter(r=>!r.ok);
  const byDepartment={};
  for(const r of results)(byDepartment[r.department]??={ok:0,failed:0})[r.ok?'ok':'failed']++;
  console.log(`فحص دورة حياة الطلب لكل خدمة: ${results.length} خدمة\n`);
  console.log('الإدارة'.padEnd(18)+'مكتملة'.padEnd(10)+'متعثرة');
  for(const [dept,counts] of Object.entries(byDepartment))console.log(dept.padEnd(18)+String(counts.ok).padEnd(12)+counts.failed);
  const gated=results.filter(r=>r.ok&&r.gated),closed=results.filter(r=>r.ok&&!r.gated);
  console.log(`\nالمغلقة مباشرة: ${closed.length}/${results.length}`);
  console.log(`المتوقفة صحيحًا عند قبول المخرج: ${gated.length}/${results.length}`);
  if(failed.length){
    console.log('\nالمتعثرة:');
    for(const r of failed)console.log(`  ${r.code} (${r.department}) توقف عند ${r.stage}: ${r.error}`);
  }
  const endings=auditEndings(db);
  console.log('\nالنهايات الأخرى:');
  for(const e of endings)console.log(`  ${e.ok?'✓':'✗'} ${e.name}: ${e.actual}`);
  const selfBlocked=auditSelfService(db);
  console.log(`\nخدمات لا يستطيع مدير الإدارة طلبها من إدارته نفسها: ${selfBlocked.length}`);
  const bySelf={};for(const b of selfBlocked)bySelf[b.department]=(bySelf[b.department]??0)+1;
  for(const [dept,n] of Object.entries(bySelf))console.log(`  ${dept}: ${n}`);
  const targets=results.filter(r=>r.ok).map(r=>r.clock);
  console.log(`\nزمن الخدمة: من ${Math.min(...targets)} إلى ${Math.max(...targets)} أيام، ومتوسط ${(targets.reduce((a,b)=>a+b,0)/targets.length).toFixed(1)}`);
  db.close();
  if(failed.length||endings.some(e=>!e.ok))process.exitCode=1;
}
