import { randomUUID } from 'node:crypto';
import { audit, now, transaction } from './db.mjs';
import { fail } from './auth.mjs';
import * as v from './validation.mjs';
import { currentUser } from './delegations.mjs';
import { can } from './access.mjs';
import { refuse } from './refusal.mjs';
import { personName } from './people-read.mjs';
// الجدولة على عقد لا تتجاوز مدته السارية (الحزمة 4، P4-CRM-6، الترحيل 185).
import { effectiveTerm } from './contracts-register.mjs';
// العميل المقفل لا تنبني له جدولة ولا دفعة مقدمة، ولا تتجهز له مسودة فاتورة (P4-CRM-7، الترحيل 186).
import { assertClientOpen } from './client-offboarding.mjs';

// الفوترة الدورية والدفعات المقدمة والإيراد المؤجل.
// المبدأ الحاكم: الجدولة تجهّز مسودة للفترة، والإنسان وحده يصدر الفاتورة في شاشة الفواتير الضريبية.
// لا ترقيم ولا تسلسل ولا بصمة هنا: الترقيم بلا فجوات يبقى حيث هو، في tax_invoices عند الإصدار.
export const CADENCES={monthly:'شهريًا',quarterly:'ربعيًا'};
export const SCHEDULE_STATUS={active:'نشطة',paused:'موقوفة',ended:'منتهية'};
export const DRAFT_STATUS={pending_review:'مسودة بانتظار المراجعة والإصدار',issued:'صدرت فاتورتها',dismissed:'أُلغيت المسودة'};
export const DRAW_STATUS={awaiting_payment:'بانتظار الدفع',ready:'جاهز للسحب',partial:'مسحوب جزئيًا',drawn:'مسحوب بالكامل'};
export const BASIS={hours:'بالساعات',money:'بالمال'};
// تحذير ضريبي لا يُحذف من أي شاشة: المنصة لا تعرف متطلب الدفعات المقدمة في الفاتورة الإلكترونية ولا تطبقه.
export const ZATCA_ADVANCE_WARNING='معالجة الدفعات المقدمة في الفاتورة الإلكترونية لها متطلب خاص في مواصفة هيئة الزكاة والضريبة والجمارك. ما هنا سجل داخلي للالتزام والسحب منه، ولا يصلح أساسًا لإصدار فعلي قبل تأكيد المختص الضريبي.';

const riyadhToday=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Riyadh',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const monthStart=iso=>iso.slice(0,7)+'-01';
const addMonths=(iso,n)=>{const [y,m]=iso.split('-').map(Number);return new Date(Date.UTC(y,m-1+n,1)).toISOString().slice(0,10);};
const lastDay=iso=>{const [y,m]=iso.split('-').map(Number);return new Date(Date.UTC(y,m,0)).toISOString().slice(0,10);};
const id=()=>randomUUID();
const name=(db,userId)=>userId?db.prepare('SELECT name FROM users WHERE id=?').get(userId)?.name??null:null;

function actor(db,supplied){const c=currentUser(db,supplied);if(!c)fail(403,'forbidden','الحساب غير متاح');return c;}
function manager(db,supplied){const u=actor(db,supplied);if(!can(db,u,'billing.recurring.manage'))fail(403,'not_permitted','الفوترة الدورية لحامل تصريحها. اطلبه من مسؤول الصلاحيات');return u;}
function writing(db){if(!db.isTransaction)fail(500,'transaction_required','تتطلب كتابة الفوترة الدورية معاملة قاعدة بيانات');}
function minor(value,label){
  if(typeof value!=='string'||!/^(?:0|[1-9]\d{0,9})(?:\.\d{1,2})?$/.test(value))fail(400,'invalid_money',`${label}: مبلغ بخانتين عشريتين كحد أقصى`);
  const [whole,fraction='']=value.split('.'),amount=Number(BigInt(whole)*100n+BigInt(fraction.padEnd(2,'0')));
  if(amount<=0)fail(400,'invalid_money',`${label}: المبلغ موجب`);
  return amount;
}
// الساعات بأرباع الساعة فقط حتى تبقى الوحدة دقيقة صحيحة بلا تقريب خفي، والمال بالهللات.
function units(basis,value,label){
  const pattern=basis==='hours'?/^(?:0|[1-9]\d{0,4})(?:\.(?:0|25|5|50|75))?$/:/^(?:0|[1-9]\d{0,9})(?:\.\d{1,2})?$/;
  if(typeof value!=='string'||!pattern.test(value))fail(400,'invalid_units',basis==='hours'?`${label}: ساعات بأرباع الساعة (0.25 · 0.5 · 0.75)`:`${label}: مبلغ بخانتين عشريتين كحد أقصى`);
  const [whole,fraction='']=value.split('.'),padded=fraction.padEnd(2,'0');
  const amount=basis==='hours'?Number(whole)*60+Number(padded)*60/100:Number(whole)*100+Number(padded);
  if(amount<=0)fail(400,'invalid_units',`${label}: القيمة موجبة`);
  return amount;
}
export const showUnits=(basis,value)=>basis==='hours'?`${(value/60).toFixed(2)} ساعة`:`${Math.trunc(value/100).toLocaleString('en-US')}.${String(Math.abs(value%100)).padStart(2,'0')} SAR`;
function clientOf(db,u,clientId){
  const c=typeof clientId==='string'&&db.prepare('SELECT id,code,legal_name FROM clients WHERE id=? AND tenant_id=?').get(clientId,u.tenant_id);
  if(!c)fail(404,'not_found','ملف العميل غير متاح');
  return c;
}
function scheduleLines(input){
  if(!Array.isArray(input)||!input.length||input.length>20)fail(400,'lines','أدخل بندًا واحدًا إلى عشرين');
  let total=0;
  const lines=input.map(line=>{
    v.object(line,['description','amount']);
    const amount=minor(line.amount,'قيمة البند');
    total+=amount;
    return {description:v.text(line.description,'وصف البند',500,3),amount_minor:amount};
  });
  if(total>999999999999)fail(400,'money_limit','مجموع البنود يتجاوز الحد المحلي');
  return {lines,total};
}

/* ───── جداول الفوترة الدورية ───── */
function scheduleActions(schedule){
  if(schedule.status==='active')return ['pause_schedule','end_schedule'];
  if(schedule.status==='paused')return ['resume_schedule','end_schedule'];
  return [];
}
function scheduleView(db,row,today){
  const upcoming=row.status==='active'?duePeriods({...row},addMonths(monthStart(today),2)).filter(p=>p.issue>today)[0]??null:null;
  return {...row,lines:JSON.parse(row.lines),cadence_name:CADENCES[row.cadence],status_name:SCHEDULE_STATUS[row.status],
    client_name:db.prepare('SELECT legal_name FROM clients WHERE id=?').get(row.client_id)?.legal_name??'',
    contract_number:row.contract_id?db.prepare('SELECT number FROM contract_records WHERE id=?').get(row.contract_id)?.number??null:null,
    owner_name:name(db,row.owner_id),generated:db.prepare('SELECT COUNT(*) AS n FROM billing_drafts WHERE schedule_id=?').get(row.id).n,
    next_issue:upcoming?.issue??null,actions:scheduleActions(row)};
}
// الفترات المستحقة حتى تاريخ التشغيل. سقف الدفعة الواحدة أربع وعشرون فترة حتى لا يولّد تشغيل متأخر دفعة ضخمة بلا مراجعة.
export function duePeriods(schedule,today){
  const step=schedule.cadence==='monthly'?1:3,periods=[],first=monthStart(schedule.start_date);
  for(let i=0;periods.length<24&&i<240;i++){
    const start=addMonths(first,i*step);
    if(start>today)break;
    if(schedule.end_date&&start>schedule.end_date)break;
    const issue=`${start.slice(0,8)}${String(schedule.issue_day).padStart(2,'0')}`;
    if(issue>today)break;
    periods.push({start,end:lastDay(addMonths(start,step-1)),issue});
  }
  return periods;
}

export function schedulesBoard(db,supplied){
  const u=manager(db,supplied),today=riyadhToday();
  const schedules=db.prepare('SELECT * FROM billing_schedules WHERE tenant_id=? ORDER BY status,created_at DESC').all(u.tenant_id).map(row=>scheduleView(db,row,today));
  const drafts=db.prepare('SELECT d.*,c.legal_name AS client_name,s.title FROM billing_drafts d JOIN clients c ON c.id=d.client_id JOIN billing_schedules s ON s.id=d.schedule_id WHERE d.tenant_id=? ORDER BY d.status,d.period_start DESC').all(u.tenant_id)
    .map(row=>({...row,lines:JSON.parse(row.lines),status_name:DRAFT_STATUS[row.status],decided_by_name:name(db,row.decided_by),actions:row.status==='pending_review'?['mark_issued','dismiss_draft']:[]}));
  const advances=db.prepare('SELECT a.*,c.legal_name AS client_name FROM advance_invoices a JOIN clients c ON c.id=a.client_id WHERE a.tenant_id=? ORDER BY a.created_at DESC').all(u.tenant_id).map(row=>{
    const draws=db.prepare('SELECT * FROM advance_draws WHERE advance_id=? ORDER BY created_at').all(row.id)
      .map(d=>({...d,claim_label:claimLabel(db,d.claim_id),status_name:DRAW_STATUS[d.status],requested_by_name:name(db,d.requested_by),actions:['ready','partial'].includes(d.status)?['apply_draw']:[]}));
    const reversals=db.prepare('SELECT * FROM advance_reversals WHERE advance_id=? ORDER BY reversed_at').all(row.id).map(r=>({...r,reversed_by_name:name(db,r.reversed_by)}));
    const drawn=draws.reduce((sum,d)=>sum+d.applied_minor,0),reversed=reversals.reduce((sum,r)=>sum+r.amount_minor,0),balance=row.paid_minor-drawn-reversed;
    return {...row,draws,reversals,drawn_minor:drawn,reversed_minor:reversed,balance_minor:balance,recorded_by_name:name(db,row.recorded_by),confirmed_by_name:name(db,row.confirmed_by),
      claims:balance>0&&row.status==='paid'?drawClaims(db,row):[],
      // من سجّل الدفعة لا يؤكد قبضها؛ القيد نفسه مفروض في SQL. وما ارتدّ من المقبوض لا يُسحب منه ولا يُعكس مرتين.
      actions:row.status==='recorded'?(row.recorded_by===u.id?[]:['confirm_advance']):balance>0?['plan_draw','reverse_advance']:[]};
  });
  return {today,user_id:u.id,can_manage:true,cadences:CADENCES,statuses:SCHEDULE_STATUS,draft_statuses:DRAFT_STATUS,draw_statuses:DRAW_STATUS,
    clients:db.prepare('SELECT id,code,legal_name FROM clients WHERE tenant_id=? ORDER BY legal_name').all(u.tenant_id),
    people:db.prepare('SELECT id,name FROM users WHERE tenant_id=? AND active=1 ORDER BY name').all(u.tenant_id),
    // عقود العملاء السارية بمدتها السارية: الجدولة على عقد تبدأ داخله وتنتهي عند نهايته أو قبلها (الترحيل 185).
    contracts:db.prepare("SELECT * FROM contract_records WHERE tenant_id=? AND party_kind='client' AND status='active' ORDER BY number").all(u.tenant_id)
      .map(c=>({id:c.id,number:c.number,client_id:c.client_id,start_date:c.start_date,end_date:effectiveTerm(db,c).end_date})),
    // المشاريع التي يُربط بها قبضُ دفعتها المقدمة: بلا هذا الربط لا تعرف بوابة البدء (app/project-axes.mjs) أن الدفعة دفعتُها.
    projects:db.prepare('SELECT p.id,p.name,l.client_id FROM projects p JOIN commercial_cases k ON k.project_id=p.id AND k.tenant_id=p.tenant_id JOIN client_links l ON l.case_id=k.id WHERE p.tenant_id=? ORDER BY p.name').all(u.tenant_id),
    schedules,drafts,advances,deferred:deferredRevenue(db,u,today),zatca_advance_warning:ZATCA_ADVANCE_WARNING,
    note:'الجدولة تجهّز مسودة فاتورة للفترة المستحقة، ولا تصدر شيئًا: يراجعها شخص ويصدر الفاتورة في شاشة الفواتير الضريبية، ثم يربط المسودة بها. الدفعة المقدمة تُسجَّل التزامًا (إيراد مؤجل) لا إيرادًا، ولا يتجاوز مجموع السحب الرصيد المدفوع. المبالغ بالريال وشاملة الضريبة، ولا إرسال ولا تحصيل خارج المنصة.'};
}

export function createSchedule(db,supplied,input){
  writing(db);const u=manager(db,supplied);
  v.object(input,['client_id','case_id','title','cadence','issue_day','start_date','end_date','contract_reference','owner_id','lines','contract_id']);
  const client=clientOf(db,u,input.client_id);
  assertClientOpen(db,u.tenant_id,client.id,'ما تنبني جدولة فوترة');
  if(!Object.hasOwn(CADENCES,input.cadence))fail(400,'cadence','اختر الدورية');
  if(!Number.isInteger(input.issue_day)||input.issue_day<1||input.issue_day>28)fail(400,'issue_day','يوم الإصدار من 1 إلى 28 حتى يوجد في كل شهر');
  const start=v.date(input.start_date),end=input.end_date?v.date(input.end_date):null;
  if(end&&end<start)fail(400,'date_order','تاريخ النهاية يسبق البداية');
  const owner=db.prepare('SELECT id FROM users WHERE id=? AND tenant_id=? AND active=1').get(input.owner_id,u.tenant_id);
  if(!owner)fail(400,'owner_id','مالك الجدولة غير متاح');
  if(!can(db,{id:owner.id,tenant_id:u.tenant_id},'billing.recurring.manage'))fail(409,'owner_not_permitted','مالك الجدولة يجب أن يحمل تصريح الفوترة الدورية؛ لا تعمل جدولة بصلاحية لا يملكها صاحبها');
  const caseId=input.case_id?db.prepare('SELECT id FROM commercial_cases WHERE id=? AND tenant_id=?').get(input.case_id,u.tenant_id)?.id:null;
  if(input.case_id&&!caseId)fail(404,'not_found','السجل التجاري غير متاح');
  // الجدولة على عقد مسجّل: تبدأ داخل مدته وتنتهي عند نهايته السارية أو قبلها، فلا تجهّز مسودة فاتورة بعد انتهاء العقد.
  let contractId=null;
  if(input.contract_id){
    const contract=typeof input.contract_id==='string'&&db.prepare('SELECT * FROM contract_records WHERE id=? AND tenant_id=?').get(input.contract_id,u.tenant_id);
    if(!contract||contract.party_kind!=='client'||contract.client_id!==client.id)refuse(409,'contract_other_customer',{what:'عقد الجدولة لازم يكون عقدًا لعميلها نفسه',
      missing:[{document:`عقد ساري لعميل ${client.code} في سجل العقود`,why:'الجدولة تفوتر ما اتفق عليه عقد العميل نفسه',owner:'مسؤول سجل العقود',owner_role:'legal',doc_key:'contract_id'}],
      next:'اختر عقد العميل نفسه، أو اترك العقد فاضي واكتب مرجع البند'});
    if(contract.status!=='active')refuse(409,'contract_not_in_force',{what:`العقد ${contract.number} مو ساري، فما تنبني عليه جدولة`,next:'الجدولة على عقد ساري. سجّل عقد التجديد إن تجدد، ثم ابنِ عليه جدولة جديدة'});
    const term=effectiveTerm(db,contract);
    if(!end||end>term.end_date||start<contract.start_date)refuse(409,'schedule_beyond_contract',{what:`الجدولة على العقد ${contract.number} لازم تبدأ من ${contract.start_date} أو بعده وتنتهي في ${term.end_date} أو قبله`,
      missing:[{document:'نهاية جدولة داخل مدة العقد السارية',why:'بعد نهاية العقد ما فيه اتفاق يُفوتر عليه؛ التجديد عقد جديد بجدولته',owner:personName(db,contract.owner_id)??'مالك العقد',owner_role:'legal',doc_key:'end_date'}],
      next:`اكتب تاريخ النهاية ${term.end_date} أو قبله. وإذا تمدد العقد بملحق مؤكد، تتسع المدة معه`});
    contractId=contract.id;
  }
  const {lines,total}=scheduleLines(input.lines),scheduleId=id(),time=now();
  db.prepare("INSERT INTO billing_schedules(id,tenant_id,client_id,case_id,title,cadence,issue_day,lines,currency,total_minor,contract_reference,start_date,end_date,status,owner_id,created_by,created_at,updated_at,contract_id) VALUES(?,?,?,?,?,?,?,?,'SAR',?,?,?,?,'active',?,?,?,?,?)")
    .run(scheduleId,u.tenant_id,client.id,caseId,v.text(input.title,'اسم الجدولة',180,3),input.cadence,input.issue_day,JSON.stringify(lines),total,v.text(input.contract_reference,'مرجع بند العقد',500,5),start,end,owner.id,u.id,time,time,contractId);
  audit(db,u,'billing_schedule',scheduleId,'billing.schedule_created',{},{client:client.code,cadence:input.cadence,total_minor:total,...(contractId?{contract_id:contractId}:{})});
  return {id:scheduleId};
}

export function scheduleAction(db,supplied,scheduleId,action,input){
  writing(db);const u=manager(db,supplied);
  if(!['pause_schedule','resume_schedule','end_schedule'].includes(action))fail(404,'not_found','الإجراء غير متاح');
  v.object(input,['version','reason']);
  const row=typeof scheduleId==='string'&&db.prepare('SELECT * FROM billing_schedules WHERE id=? AND tenant_id=?').get(scheduleId,u.tenant_id);
  if(!row)fail(404,'not_found','الجدولة غير متاحة');
  v.version(input.version,row.version);
  if(!scheduleActions(row).includes(action))fail(409,'transition_denied','لا تسمح حالة الجدولة بهذا الإجراء');
  const status={pause_schedule:'paused',resume_schedule:'active',end_schedule:'ended'}[action];
  const reason=action==='resume_schedule'?'':v.text(input.reason,'سبب الإيقاف أو الإنهاء',1000,5);
  db.prepare('UPDATE billing_schedules SET status=?,stopped_reason=?,version=version+1,updated_at=? WHERE id=? AND version=?').run(status,reason,now(),row.id,row.version);
  audit(db,u,'billing_schedule',row.id,'billing.'+action,{status:row.status},{status},reason);
  return {id:row.id,status};
}

// يُستدعى من مؤقّت الخادم بلا جلسة مستخدم. كل فترة في معاملتها، والفترة الواحدة لا تُولَّد مرتين مهما أُعيد التشغيل.
export function runDueSchedules(db,today=riyadhToday()){
  const results=[];
  for(const schedule of db.prepare("SELECT * FROM billing_schedules WHERE status='active' AND start_date<=? ORDER BY created_at").all(today)){
    const owner=db.prepare('SELECT * FROM users WHERE id=? AND tenant_id=?').get(schedule.owner_id,schedule.tenant_id);
    let stopped=false;
    for(const period of duePeriods(schedule,today)){
      if(stopped)break;
      transaction(db,()=>{
        if(db.prepare('SELECT 1 FROM billing_schedule_runs WHERE schedule_id=? AND period_start=?').get(schedule.id,period.start))return;
        try{
          // الجدولة تعمل بصلاحية صاحبها وقت التشغيل؛ فقدانها يوقفها بسبب مسجل بدل أن تستمر بصلاحية قديمة.
          if(!owner?.active)fail(403,'forbidden','حساب مالك الجدولة غير نشط');
          if(!can(db,owner,'billing.recurring.manage'))fail(403,'forbidden','مالك الجدولة لم يعد يحمل تصريح الفوترة الدورية');
          // عميل مقفل: لا مسودة فاتورة له، فتقف الجدولة بسبب مكتوب (P4-CRM-7). الإقفال لا يُعتمد وجدولته قائمة، فهذا حارس لما سبق 186.
          assertClientOpen(db,schedule.tenant_id,schedule.client_id,'ما تتجهز مسودة فاتورة');
          // عقد الجدولة انتهى قبل موعده (إنهاء) أو أُلغي: ما بعده لا اتفاق يُفوتر عليه، فتقف الجدولة بسببها (P4-CRM-6).
          const contract=schedule.contract_id?db.prepare('SELECT number,status FROM contract_records WHERE id=?').get(schedule.contract_id):null;
          if(contract&&contract.status!=='active')refuse(409,'contract_not_in_force',{what:`العقد ${contract.number} ${contract.status==='terminated'?'منهى':'مو ساري'}، فما تتجهز عليه مسودة فاتورة`,
            next:'ينهي مالك الجدولة الجدولة، وإذا تجدد العقد تنبني جدولة جديدة على عقد التجديد'});
          const draftId=id(),time=now();
          db.prepare("INSERT INTO billing_drafts(id,tenant_id,schedule_id,client_id,period_start,period_end,lines,currency,total_minor,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,'SAR',?,'pending_review',?,?)")
            .run(draftId,schedule.tenant_id,schedule.id,schedule.client_id,period.start,period.end,schedule.lines,schedule.total_minor,time,time);
          db.prepare("INSERT INTO billing_schedule_runs VALUES(?,?,?,?,'draft','',?)").run(schedule.id,period.start,period.end,draftId,time);
          audit(db,owner,'billing_draft',draftId,'billing.draft_generated',{},{schedule_id:schedule.id,period:period.start,total_minor:schedule.total_minor});
          results.push({schedule_id:schedule.id,period:period.start,outcome:'draft',draft_id:draftId});
        }catch(error){
          if(!error.status)throw error;
          db.prepare("INSERT INTO billing_schedule_runs VALUES(?,?,?,NULL,'stopped',?,?)").run(schedule.id,period.start,period.end,error.message,now());
          db.prepare('UPDATE billing_schedules SET status=?,stopped_reason=?,version=version+1,updated_at=? WHERE id=?').run('paused',`أوقفها النظام: ${error.message}`,now(),schedule.id);
          results.push({schedule_id:schedule.id,period:period.start,outcome:'stopped',detail:error.message});
          stopped=true;
        }
      });
    }
  }
  return results;
}

export function draftAction(db,supplied,draftId,action,input){
  writing(db);const u=manager(db,supplied);
  if(!['mark_issued','dismiss_draft'].includes(action))fail(404,'not_found','الإجراء غير متاح');
  v.object(input,['version','invoice_id','note']);
  const row=typeof draftId==='string'&&db.prepare("SELECT * FROM billing_drafts WHERE id=? AND tenant_id=? AND status='pending_review'").get(draftId,u.tenant_id);
  if(!row)fail(404,'not_found','المسودة غير متاحة أو حُسم أمرها');
  v.version(input.version,row.version);
  const time=now();
  if(action==='mark_issued'){
    // الربط توثيق لإصدار وقع فعلًا بيد شخص في شاشة الفواتير، لا إصدار يجري هنا.
    const invoice=typeof input.invoice_id==='string'&&db.prepare("SELECT id,number FROM tax_invoices WHERE id=? AND tenant_id=? AND kind='invoice' AND status='issued'").get(input.invoice_id,u.tenant_id);
    if(!invoice)fail(409,'invoice_not_issued','اربط المسودة بفاتورة صادرة فعلًا. المنصة لا تصدر فاتورة من جدولة');
    // الفاتورة لعميل المسودة نفسه: عميلها هو العميل المربوط بسجلها التجاري (فاتورة ← مطالبة ← سجل ← ربط العميل).
    // فاتورة لعميل آخر، أو لسجل غير مربوط بعميل، لا تُغلق بها مسودة؛ وإلا بدت فاتورة العميل الأول صادرة وهي لم تصدر.
    const invoiceClient=db.prepare('SELECT l.client_id FROM tax_invoices i JOIN ar_claims c ON c.id=i.claim_id JOIN client_links l ON l.case_id=c.case_id WHERE i.id=?').get(invoice.id)?.client_id??null;
    if(invoiceClient!==row.client_id)fail(409,'invoice_client_mismatch','الفاتورة ليست لعميل هذه المسودة. اربطها بفاتورة صادرة للعميل نفسه');
    if(db.prepare('SELECT 1 FROM billing_drafts WHERE issued_invoice_id=? AND id<>?').get(invoice.id,row.id))fail(409,'invoice_already_linked','هذه الفاتورة مرتبطة بمسودة أخرى');
    db.prepare("UPDATE billing_drafts SET status='issued',issued_invoice_id=?,decided_by=?,decided_at=?,decision_note=?,version=version+1,updated_at=? WHERE id=? AND version=?")
      .run(invoice.id,u.id,time,input.note?v.text(input.note,'ملاحظة الربط',1000):'',time,row.id,row.version);
    audit(db,u,'billing_draft',row.id,'billing.draft_linked',{status:row.status},{invoice_number:invoice.number});
    return {id:row.id,status:'issued',invoice_number:invoice.number};
  }
  const note=v.text(input.note,'سبب إلغاء المسودة',1000,10);
  db.prepare("UPDATE billing_drafts SET status='dismissed',decided_by=?,decided_at=?,decision_note=?,version=version+1,updated_at=? WHERE id=? AND version=?").run(u.id,time,note,time,row.id,row.version);
  audit(db,u,'billing_draft',row.id,'billing.draft_dismissed',{status:row.status},{status:'dismissed'},note);
  return {id:row.id,status:'dismissed'};
}

/* ───── الدفعات المقدمة والسحب منها ───── */
export function recordAdvance(db,supplied,input){
  writing(db);const u=manager(db,supplied);
  v.object(input,['client_id','schedule_id','project_id','description','agreement_reference','amount']);
  const client=clientOf(db,u,input.client_id);
  assertClientOpen(db,u.tenant_id,client.id,'ما تنسجّل دفعة مقدمة');
  const scheduleId=input.schedule_id?db.prepare('SELECT id FROM billing_schedules WHERE id=? AND tenant_id=?').get(input.schedule_id,u.tenant_id)?.id:null;
  if(input.schedule_id&&!scheduleId)fail(404,'not_found','الجدولة غير متاحة');
  // ربط الدفعة المقدمة بمشروعها وملفه التجاري (ترحيل 116): بدونه لا يعرف محور جاهزية البدء
  // أن هذه الدفعة هي دفعته. الملف يُشتق من المشروع لا يُدخَل، فلا يمكن نسبتها إلى ملف آخر.
  let projectId=null,caseId=null;
  if(input.project_id){
    const project=db.prepare('SELECT id FROM projects WHERE id=? AND tenant_id=?').get(input.project_id,u.tenant_id);
    if(!project)fail(404,'not_found','المشروع غير متاح');
    projectId=project.id;
    const linked=db.prepare('SELECT id FROM commercial_cases WHERE project_id=? AND tenant_id=?').get(project.id,u.tenant_id);
    caseId=linked?.id??null;
    // الدفعة لعميل مشروعها: دفعة عميل آخر لا تفتح بوابة بدء هذا المشروع.
    const owner=caseId?db.prepare('SELECT client_id FROM client_links WHERE case_id=?').get(caseId)?.client_id??null:null;
    if(owner&&owner!==client.id)fail(409,'client_mismatch','الدفعة المقدمة ليست لعميل هذا المشروع');
  }
  const amount=minor(input.amount,'قيمة الدفعة المقدمة'),advanceId=id(),time=now();
  db.prepare("INSERT INTO advance_invoices(id,tenant_id,client_id,schedule_id,project_id,case_id,description,agreement_reference,currency,amount_minor,status,recorded_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,'SAR',?,'recorded',?,?,?)")
    .run(advanceId,u.tenant_id,client.id,scheduleId,projectId,caseId,v.text(input.description,'وصف الدفعة المقدمة',500,3),v.text(input.agreement_reference,'مرجع بند الاتفاق',500,5),amount,u.id,time,time);
  audit(db,u,'advance_invoice',advanceId,'advance.recorded',{},{client:client.code,amount_minor:amount,project_id:projectId,liability:true});
  return {id:advanceId};
}

export function confirmAdvance(db,supplied,advanceId,input){
  writing(db);const u=manager(db,supplied);
  v.object(input,['version','amount','received_on','evidence','reference']);
  const row=typeof advanceId==='string'&&db.prepare("SELECT * FROM advance_invoices WHERE id=? AND tenant_id=? AND status='recorded'").get(advanceId,u.tenant_id);
  if(!row)fail(404,'not_found','الدفعة المقدمة غير متاحة للتأكيد');
  v.version(input.version,row.version);
  if(row.recorded_by===u.id)fail(403,'self_approval','من سجّل الدفعة المقدمة لا يؤكد قبضها');
  // مرجع الحوالة يُطبَّع كما تُطبَّع مراجع ar_receipts ويتفرد داخل الكيان: بلا مرجع كانت الحوالة الواحدة تُسجَّل دفعتين
  // وتُؤكَّد مرتين فتفتح بوابة البدء بنصف المال (ترحيل 160). المُطلِق والفهرس الفريد يحرسان ما يُكتب من خارج هذا المسار.
  const reference=v.text(input.reference,'مرجع الحوالة أو إشعار القبض',180,3).normalize('NFKC').replace(/\s+/gu,' ').toUpperCase();
  if(db.prepare('SELECT 1 FROM advance_invoices WHERE tenant_id=? AND receipt_reference=?').get(u.tenant_id,reference))refuse(409,'duplicate_receipt_reference',{
    what:`الحوالة ${reference} مؤكَّدة من قبل على دفعة مقدمة`,
    missing:[{document:'مرجع حوالة لم يُؤكَّد قبضه بعد',why:'الحوالة الواحدة تُحسب مرة وحدة؛ تأكيدها مرتين يفتح بوابة البدء بمال ما وصل',owner:'المالية',owner_role:'finance'}],
    next:'قابل كشف الحساب: إن كانت حوالة ثانية فاكتب مرجعها هي، وإن كانت نفسها فالدفعة مؤكدة ولا تحتاج تأكيد'});
  const received=v.date(input.received_on);
  if(received>riyadhToday())fail(400,'received_on','تاريخ القبض لا يكون في المستقبل');
  const paid=minor(input.amount,'المبلغ المقبوض');
  if(paid>row.amount_minor)fail(409,'over_payment','المقبوض يتجاوز قيمة الدفعة المقدمة المسجلة');
  const evidence=v.text(input.evidence,'دليل القبض',5000,10),time=now();
  db.prepare("UPDATE advance_invoices SET status='paid',paid_minor=?,received_on=?,confirmed_by=?,confirmed_at=?,receipt_reference=?,version=version+1,updated_at=? WHERE id=? AND version=?").run(paid,received,u.id,time,reference,time,row.id,row.version);
  // ما كان ينتظر الدفع صار جاهزًا للسحب؛ الجاهزية حالة محسوبة من الرصيد لا قرار منفصل.
  for(const draw of db.prepare("SELECT * FROM advance_draws WHERE advance_id=? AND status='awaiting_payment' ORDER BY created_at").all(row.id))
    db.prepare("UPDATE advance_draws SET status='ready',version=version+1,updated_at=? WHERE id=?").run(time,draw.id);
  audit(db,u,'advance_invoice',row.id,'advance.payment_confirmed',{status:'recorded'},{status:'paid',paid_minor:paid,receipt_reference:reference},evidence);
  return {id:row.id,status:'paid',paid_minor:paid};
}

// الانعكاس: حوالة ارتدّت أو أُكّدت خطأً. المؤكَّد لا يُعدَّل (مُطلِق 051)، فيُكتب الانعكاس سجلًا بجانبه يُطرح في كل قراءة —
// بوابة البدء والرصيد والإيراد المؤجل والسحب. يكفيه شخص واحد يحمل تصريح الفوترة لأنه يضيّق ولا يوسّع: يغلق البوابة
// ويخفض الرصيد، ولا يفتح شيئًا. ولا يمسّ ما سُحب على فاتورة لاحقة؛ ذاك تصحيح فاتورة لا حوالة.
export function reverseAdvance(db,supplied,advanceId,input){
  writing(db);const u=manager(db,supplied);
  v.object(input,['amount','reason','evidence']);
  const row=typeof advanceId==='string'&&db.prepare('SELECT * FROM advance_invoices WHERE id=? AND tenant_id=?').get(advanceId,u.tenant_id);
  if(!row)fail(404,'not_found','الدفعة المقدمة غير متاحة لك في هذا الكيان');
  if(row.status!=='paid')refuse(409,'advance_not_confirmed',{what:'ما ينعكس قبض دفعة ما تأكّد قبضها أصلًا',
    next:'الدفعة المسجّلة بلا تأكيد ما تُحسب مقبوضة؛ ما تحتاج انعكاس'});
  const amount=minor(input.amount,'المبلغ المرتد');
  const reversed=db.prepare('SELECT COALESCE(SUM(amount_minor),0) AS n FROM advance_reversals WHERE advance_id=?').get(row.id).n;
  const drawn=db.prepare('SELECT COALESCE(SUM(applied_minor),0) AS n FROM advance_draws WHERE advance_id=?').get(row.id).n;
  const open=row.paid_minor-reversed-drawn;
  if(amount>open)refuse(409,'reversal_exceeds_balance',{what:`المبلغ المرتد أكبر من الرصيد القابل للعكس (${(open/100).toFixed(2)})`,
    missing:[{document:'رصيد مؤكَّد لم يُسحب ولم يرتد',why:'ما سُحب على فاتورة لاحقة أو ارتدّ من قبل ما ينعكس مرة ثانية',owner:'المالية',owner_role:'finance'}],
    next:'اكتب المرتد من الرصيد الباقي وحده، وصحّح الفاتورة اللاحقة إن كان المسحوب نفسه خطأ'});
  const reason=v.text(input.reason,'سبب الانعكاس',2000,10),evidence=v.text(input.evidence,'دليل الانعكاس: إشعار الارتداد أو كشف الحساب',5000,10),reversalId=id(),time=now();
  db.prepare('INSERT INTO advance_reversals(id,tenant_id,advance_id,amount_minor,reason,evidence,reversed_by,reversed_at) VALUES(?,?,?,?,?,?,?,?)').run(reversalId,u.tenant_id,row.id,amount,reason,evidence,u.id,time);
  audit(db,u,'advance_invoice',row.id,'advance.reversed',{confirmed_minor:row.paid_minor-reversed},{confirmed_minor:row.paid_minor-reversed-amount,reversed_minor:amount,reversal_id:reversalId,project_id:row.project_id},reason);
  return {id:reversalId,advance_id:row.id,amount_minor:amount,confirmed_minor:row.paid_minor-reversed-amount};
}

// الاستحقاقات التي يُسحب عليها (الترحيل 177): معتمدة، لعميل الدفعة (ملفها التجاري، أو عميلها بربطه)، بعملتها، ولها باقٍ بعد
// المقبوض والمعلق والمطبَّق ومخطَّط السحوبات التي لم تُطبَّق بعد. التسمية رقم الفاتورة الصادرة إن وُجدت، وإلا وصف البند.
function drawClaims(db,advance){
  return db.prepare(`SELECT c.id,c.source_snapshot,s.net_minor-s.received_minor-s.pending_minor-s.allocated_minor
      -(SELECT COALESCE(SUM(d.amount_minor-d.applied_minor),0) FROM advance_draws d WHERE d.claim_id=c.id) AS room,
      (SELECT t.number FROM tax_invoices t WHERE t.claim_id=c.id AND t.kind='invoice' AND t.status='issued' ORDER BY t.issued_at DESC LIMIT 1) AS invoice_number
    FROM ar_claims c JOIN ar_claim_collection s ON s.claim_id=c.id
    WHERE c.tenant_id=? AND c.status='approved' AND c.currency=?
      AND (c.case_id=? OR (? IS NULL AND EXISTS(SELECT 1 FROM client_links l WHERE l.client_id=? AND l.case_id=c.case_id)))
    ORDER BY c.due_date,c.created_at,c.id`).all(advance.tenant_id,advance.currency,advance.case_id,advance.case_id,advance.client_id)
    .filter(c=>c.room>0).map(c=>({id:c.id,room_minor:c.room,invoice_number:c.invoice_number??null,
      label:c.invoice_number??(JSON.parse(c.source_snapshot).line_description||`استحقاق ${c.id.slice(0,8)}`)}));
}
const claimLabel=(db,claimId)=>{
  if(!claimId)return null;
  const t=db.prepare("SELECT number FROM tax_invoices WHERE claim_id=? AND kind='invoice' AND status='issued' ORDER BY issued_at DESC LIMIT 1").get(claimId);
  if(t)return t.number;
  const c=db.prepare('SELECT source_snapshot FROM ar_claims WHERE id=?').get(claimId);
  return c?(JSON.parse(c.source_snapshot).line_description||`استحقاق ${claimId.slice(0,8)}`):null;
};
export function planDraw(db,supplied,advanceId,input){
  writing(db);const u=manager(db,supplied);
  v.object(input,['target_reference','amount','claim_id']);
  const advance=typeof advanceId==='string'&&db.prepare('SELECT * FROM advance_invoices WHERE id=? AND tenant_id=?').get(advanceId,u.tenant_id);
  if(!advance)fail(404,'not_found','الدفعة المقدمة غير متاحة');
  const amount=minor(input.amount,'قيمة السحب');
  // السحب يسدّد استحقاقًا بعينه (الترحيل 177): يُختار من القائمة، أو يُستدل عليه حين يطابق النصّ رقم فاتورة صادرة واحدة حرفيًا.
  // بلا ربط يبقى السحب كما كان قبل 177: يسدّد الذمة في الدفتر ولا يراه منظور التحصيل، ويظهر فرقه في المطابقة الرقابية.
  const eligible=drawClaims(db,advance);
  let claim=null;
  if(input.claim_id!==undefined&&input.claim_id!==''&&input.claim_id!==null){
    claim=eligible.find(c=>c.id===input.claim_id)??null;
    if(!claim)fail(409,'draw_claim_ineligible','الاستحقاق المختار ما يقبل هذا السحب: لازم يكون معتمدًا، لعميل الدفعة نفسه وبعملتها، وباقي عليه مبلغ بعد المقبوض والمعلق والمسحوب');
  }else if(typeof input.target_reference==='string'){
    const matches=eligible.filter(c=>c.invoice_number&&c.invoice_number===input.target_reference.trim());
    if(matches.length===1)claim=matches[0];
  }
  if(claim&&amount>claim.room_minor)fail(409,'draw_exceeds_claim',`السحب أكبر من الباقي على الاستحقاق «${claim.label}»: الباقي ${(claim.room_minor/100).toFixed(2)} بعد المقبوض والمعلق والمسحوب. خفّض السحب أو وزّعه على استحقاق ثاني`);
  const reference=input.target_reference?v.text(input.target_reference,'الفاتورة اللاحقة التي يُسحب عليها',500,3):claim?claim.label:fail(400,'target_reference','اختر الاستحقاق الذي يسدّده السحب، أو اكتب رقم الفاتورة اللاحقة');
  const planned=db.prepare('SELECT COALESCE(SUM(amount_minor),0) AS n FROM advance_draws WHERE advance_id=?').get(advance.id).n;
  if(planned+amount>advance.amount_minor)fail(409,'draw_exceeds_advance','مجموع السحب المخطط يتجاوز قيمة الدفعة المقدمة');
  const drawId=id(),time=now(),status=advance.status==='paid'?'ready':'awaiting_payment';
  db.prepare("INSERT INTO advance_draws(id,tenant_id,advance_id,target_reference,amount_minor,status,requested_by,created_at,updated_at,claim_id) VALUES(?,?,?,?,?,?,?,?,?,?)")
    .run(drawId,u.tenant_id,advance.id,reference,amount,status,u.id,time,time,claim?.id??null);
  audit(db,u,'advance_draw',drawId,'advance.draw_planned',{},{advance_id:advance.id,amount_minor:amount,status,claim_id:claim?.id??null});
  return {id:drawId,status,claim_id:claim?.id??null};
}

export function applyDraw(db,supplied,drawId,input){
  writing(db);const u=manager(db,supplied);
  v.object(input,['version','amount','note']);
  const draw=typeof drawId==='string'&&db.prepare('SELECT * FROM advance_draws WHERE id=? AND tenant_id=?').get(drawId,u.tenant_id);
  if(!draw)fail(404,'not_found','السحب غير متاح');
  v.version(input.version,draw.version);
  if(!['ready','partial'].includes(draw.status))fail(409,'draw_not_ready','لا يُسحب قبل تأكيد قبض الدفعة المقدمة');
  const advance=db.prepare('SELECT * FROM advance_invoices WHERE id=?').get(draw.advance_id);
  const amount=minor(input.amount,'المبلغ المسحوب الآن');
  const applied=draw.applied_minor+amount;
  if(applied>draw.amount_minor)fail(409,'draw_exceeds_plan','المسحوب يتجاوز قيمة هذا السحب');
  const drawnElsewhere=db.prepare('SELECT COALESCE(SUM(applied_minor),0) AS n FROM advance_draws WHERE advance_id=? AND id<>?').get(advance.id,draw.id).n;
  // ما ارتدّ من المقبوض ليس رصيدًا يُسحب منه (ترحيل 160 يطرحه في المحفّز كذلك).
  const reversed=db.prepare('SELECT COALESCE(SUM(amount_minor),0) AS n FROM advance_reversals WHERE advance_id=?').get(advance.id).n;
  // الحارس الأخير في SQL أيضًا: هذا الفحص يعطي رسالة مفهومة قبل أن يرفض المحفّز.
  if(drawnElsewhere+applied>advance.paid_minor-reversed)fail(409,'draw_exceeds_paid','مجموع السحب يتجاوز الرصيد المدفوع من الدفعة المقدمة');
  // الباقي على الاستحقاق المربوط: القادح advance_draws_claim_room يرفض بعد هذا، وهذا الفحص يقول الأرقام قبله.
  if(draw.claim_id){
    const s=db.prepare('SELECT net_minor,received_minor,pending_minor,allocated_minor FROM ar_claim_collection WHERE claim_id=?').get(draw.claim_id);
    const room=s.net_minor-s.received_minor-s.pending_minor-s.allocated_minor;
    if(amount>room)fail(409,'draw_exceeds_claim',`المسحوب الآن أكبر من الباقي على الاستحقاق «${claimLabel(db,draw.claim_id)}»: الباقي ${(Math.max(0,room)/100).toFixed(2)} بعد المقبوض والمعلق والمطبَّق. سجّل الباقي فقط، والزائد يبقى رصيدًا في الدفعة المقدمة`);
  }
  const status=applied===draw.amount_minor?'drawn':'partial',time=now();
  db.prepare('UPDATE advance_draws SET applied_minor=?,status=?,version=version+1,updated_at=? WHERE id=? AND version=?').run(applied,status,time,draw.id,draw.version);
  audit(db,u,'advance_draw',draw.id,'advance.draw_applied',{applied_minor:draw.applied_minor,status:draw.status},{applied_minor:applied,status},input.note?v.text(input.note,'ملاحظة السحب',1000):'');
  return {id:draw.id,status,applied_minor:applied};
}

// ورقة عمل الإيراد المؤجل: المقبوض مقدمًا ناقص ما سُحب فعلًا حتى التاريخ. لا قيود اعتراف آلية إطلاقًا.
export function deferredRevenue(db,supplied,asOf){
  const user=currentUser(db,supplied);
  if(!user)fail(403,'forbidden','الحساب غير متاح');
  if(!can(db,user,'billing.recurring.manage'))fail(403,'not_permitted','ورقة الإيراد المؤجل لحامل تصريح الفوترة الدورية');
  const date=asOf?v.date(asOf):riyadhToday();
  // «حتى التاريخ» يوم رياض كامل: الارتداد والسحب طابعا UTC، فيُقرأ يوم الرياض لكلٍّ منهما بـdate(x,'+3 hours') (كما في
  // app/bank-reconciliation.mjs والترحيلين 162 و163) لا بأول عشرة أحرف منه — وإلا دخل في ورقة اليوم ما جرى بين 00:00 و03:00
  // من اليوم التالي بتوقيت الرياض.
  const rows=db.prepare(`SELECT a.client_id,c.code,c.legal_name,
      SUM(a.paid_minor-(SELECT COALESCE(SUM(r.amount_minor),0) FROM advance_reversals r WHERE r.advance_id=a.id AND date(r.reversed_at,'+3 hours')<=?)) AS received_minor,
      SUM((SELECT COALESCE(SUM(d.applied_minor),0) FROM advance_draws d WHERE d.advance_id=a.id AND date(d.updated_at,'+3 hours')<=?)) AS drawn_minor
    FROM advance_invoices a JOIN clients c ON c.id=a.client_id
    WHERE a.tenant_id=? AND a.status='paid' AND a.received_on<=?
    GROUP BY a.client_id,c.code,c.legal_name ORDER BY c.legal_name`).all(date,date,user.tenant_id,date)
    .map(row=>({...row,balance_minor:row.received_minor-row.drawn_minor}));
  return {as_of:date,currency:'SAR',rows,total_minor:rows.reduce((sum,row)=>sum+row.balance_minor,0),recognition:'manual',
    note:'رصيد الالتزام لكل عميل: المقبوض مقدمًا ناقص ما سُحب فعلًا حتى التاريخ. المقبوض يُحتسب بتاريخ قبضه المؤكد، والسحب بتاريخ تسجيله في المنصة. ورقة عمل يعتمدها المحاسب؛ المنصة لا تنشئ أي قيد اعتراف آلي ولا تعترف بإيراد نيابة عن أحد.'};
}

/* ───── فترات الاشتراك الشهري بالترحيل ───── */
function agreementRow(db,u,agreementId){
  const row=typeof agreementId==='string'&&db.prepare('SELECT * FROM retainer_agreements WHERE id=? AND tenant_id=?').get(agreementId,u.tenant_id);
  if(!row)fail(404,'not_found','اتفاق الاشتراك غير متاح');
  return row;
}
const availableUnits=period=>period.budget_units+period.carried_in_units;
function periodView(db,agreement,period){
  const available=availableUnits(period),remaining=available-period.consumed_units;
  return {...period,available_units:available,remaining_units:remaining,
    available_text:showUnits(agreement.basis,available),consumed_text:showUnits(agreement.basis,period.consumed_units),
    remaining_text:showUnits(agreement.basis,remaining),carried_in_text:showUnits(agreement.basis,period.carried_in_units),carried_out_text:showUnits(agreement.basis,period.carried_out_units),
    usage_bp:available>0?Math.round(period.consumed_units*10000/available):null,over:remaining<0,
    entries:db.prepare('SELECT c.*,x.name AS recorded_by_name FROM retainer_consumption c JOIN users x ON x.id=c.recorded_by WHERE c.period_id=? ORDER BY c.created_at').all(period.id),
    alerts:db.prepare('SELECT * FROM retainer_alerts WHERE period_id=? ORDER BY threshold_bp').all(period.id).map(a=>({...a,recipients:JSON.parse(a.recipients)})),
    closed_by_name:name(db,period.closed_by)};
}
export function retainersBoard(db,supplied){
  const u=manager(db,supplied),today=riyadhToday();
  const agreements=db.prepare('SELECT * FROM retainer_agreements WHERE tenant_id=? ORDER BY status,created_at DESC').all(u.tenant_id).map(agreement=>{
    const isOwner=agreement.owner_id===u.id;
    const periods=db.prepare('SELECT * FROM retainer_periods WHERE agreement_id=? ORDER BY period_month DESC LIMIT 24').all(agreement.id)
      .map(period=>({...periodView(db,agreement,period),actions:period.status==='open'?['record_consumption',...(isOwner?['close_period']:[])]:[]}));
    return {...agreement,carry_unused:!!agreement.carry_unused,deduct_overage:!!agreement.deduct_overage,basis_name:BASIS[agreement.basis],
      client_name:db.prepare('SELECT legal_name FROM clients WHERE id=?').get(agreement.client_id)?.legal_name??'',
      owner_name:name(db,agreement.owner_id),recorded_by_name:name(db,agreement.recorded_by),is_owner:isOwner,
      rules:db.prepare('SELECT * FROM retainer_alert_rules WHERE agreement_id=? ORDER BY threshold_bp').all(agreement.id).map(rule=>({...rule,recipients:JSON.parse(rule.recipients),recipient_names:JSON.parse(rule.recipients).map(x=>name(db,x)).filter(Boolean)})),
      periods,actions:agreement.status==='active'?['open_period',...(isOwner?['set_carry_rules','set_threshold']:[])]:[]};
  });
  return {today,user_id:u.id,can_manage:true,basis:BASIS,agreements,
    clients:db.prepare('SELECT id,code,legal_name FROM clients WHERE tenant_id=? ORDER BY legal_name').all(u.tenant_id),
    people:db.prepare('SELECT id,name FROM users WHERE tenant_id=? AND active=1 ORDER BY name').all(u.tenant_id),
    note:'الترحيل يمس الاستحقاق وحده: مبلغ الفاتورة الدورية ثابت بجدولته ولا يتغير بالترحيل صعودًا ولا هبوطًا. «رحّل غير المستهلك» و«اخصم الزائد من الفترة التالية» خياران مستقلان يضبطهما صاحب العقد وحده. العتبات إعداد بمستلميه، والتنبيه يظهر داخل المنصة فقط ولا يُرسل خارجها.'};
}

export function createAgreement(db,supplied,input){
  writing(db);const u=manager(db,supplied);
  v.object(input,['client_id','name','basis','contract_reference','owner_id']);
  const client=clientOf(db,u,input.client_id);
  if(!Object.hasOwn(BASIS,input.basis))fail(400,'basis','اختر أساس الميزانية: بالساعات أو بالمال');
  const owner=db.prepare('SELECT id FROM users WHERE id=? AND tenant_id=? AND active=1').get(input.owner_id,u.tenant_id);
  if(!owner)fail(400,'owner_id','صاحب العقد غير متاح');
  if(owner.id===u.id)fail(409,'separation_of_duties','من سجّل الاتفاق ليس صاحبه: خيارات الترحيل قرار صاحب العقد لا معدّ السجل');
  const agreementName=v.text(input.name,'اسم الاشتراك',180,3);
  if(db.prepare('SELECT 1 FROM retainer_agreements WHERE tenant_id=? AND client_id=? AND name=?').get(u.tenant_id,client.id,agreementName))fail(409,'duplicate_agreement','للعميل اتفاق بالاسم نفسه');
  const agreementId=id(),time=now();
  db.prepare("INSERT INTO retainer_agreements(id,tenant_id,client_id,name,basis,contract_reference,owner_id,recorded_by,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,'active',?,?)")
    .run(agreementId,u.tenant_id,client.id,agreementName,input.basis,v.text(input.contract_reference,'مرجع بند العقد',500,5),owner.id,u.id,time,time);
  audit(db,u,'retainer_agreement',agreementId,'retainer.agreement_created',{},{client:client.code,basis:input.basis,owner_id:owner.id});
  return {id:agreementId};
}

export function setCarryRules(db,supplied,agreementId,input){
  writing(db);const u=manager(db,supplied);
  v.object(input,['version','carry_unused','deduct_overage','note']);
  const agreement=agreementRow(db,u,agreementId);
  v.version(input.version,agreement.version);
  if(agreement.owner_id!==u.id)fail(403,'not_owner','خيارات الترحيل يضبطها صاحب العقد وحده');
  if(agreement.status!=='active')fail(409,'agreement_ended','الاتفاق منتهٍ');
  if(typeof input.carry_unused!=='boolean'||typeof input.deduct_overage!=='boolean')fail(400,'carry_rules','كل خيار مستقل: نعم أو لا');
  const note=v.text(input.note,'أساس الخيارين في العقد',1000,5),time=now();
  db.prepare('UPDATE retainer_agreements SET carry_unused=?,deduct_overage=?,version=version+1,updated_at=? WHERE id=? AND version=?').run(input.carry_unused?1:0,input.deduct_overage?1:0,time,agreement.id,agreement.version);
  audit(db,u,'retainer_agreement',agreement.id,'retainer.carry_rules_set',{carry_unused:!!agreement.carry_unused,deduct_overage:!!agreement.deduct_overage},{carry_unused:input.carry_unused,deduct_overage:input.deduct_overage},note);
  return {id:agreement.id,carry_unused:input.carry_unused,deduct_overage:input.deduct_overage};
}

// العتبة إعداد: صاحب العقد يحدد نسبتها ومستلميها. قائمة مستلمين فارغة تعني إلغاء العتبة.
export function setThreshold(db,supplied,agreementId,input){
  writing(db);const u=manager(db,supplied);
  v.object(input,['threshold_percent','recipients']);
  const agreement=agreementRow(db,u,agreementId);
  if(agreement.owner_id!==u.id)fail(403,'not_owner','عتبات التنبيه يضبطها صاحب العقد وحده');
  if(typeof input.threshold_percent!=='string'||!/^(?:[1-9]\d{0,2})(?:\.\d{1,2})?$/.test(input.threshold_percent))fail(400,'threshold_percent','النسبة رقم موجب حتى 200');
  const basisPoints=Math.round(Number(input.threshold_percent)*100);
  if(basisPoints<1||basisPoints>20000)fail(400,'threshold_percent','النسبة بين 0.01% و200%');
  const chosen=Array.isArray(input.recipients)?input.recipients:[];
  if(!chosen.length){
    const removed=db.prepare('DELETE FROM retainer_alert_rules WHERE agreement_id=? AND threshold_bp=?').run(agreement.id,basisPoints).changes;
    if(!removed)fail(404,'not_found','لا عتبة بهذه النسبة');
    audit(db,u,'retainer_agreement',agreement.id,'retainer.threshold_removed',{threshold_bp:basisPoints},{});
    return {id:agreement.id,threshold_bp:basisPoints,removed:true};
  }
  if(chosen.length>20)fail(400,'recipients','حتى عشرين مستلمًا');
  const recipients=[...new Set(chosen)].map(userId=>{
    const person=db.prepare('SELECT id FROM users WHERE id=? AND tenant_id=? AND active=1').get(userId,u.tenant_id);
    if(!person)fail(400,'recipients','أحد المستلمين غير متاح');
    return person.id;
  });
  db.prepare('INSERT INTO retainer_alert_rules(id,tenant_id,agreement_id,threshold_bp,recipients,set_by,created_at) VALUES(?,?,?,?,?,?,?) ON CONFLICT(agreement_id,threshold_bp) DO UPDATE SET recipients=excluded.recipients,set_by=excluded.set_by,created_at=excluded.created_at')
    .run(id(),u.tenant_id,agreement.id,basisPoints,JSON.stringify(recipients),u.id,now());
  audit(db,u,'retainer_agreement',agreement.id,'retainer.threshold_set',{},{threshold_bp:basisPoints,recipients});
  return {id:agreement.id,threshold_bp:basisPoints,recipients};
}

export function openPeriod(db,supplied,input){
  writing(db);const u=manager(db,supplied);
  v.object(input,['agreement_id','period_month','budget']);
  const agreement=agreementRow(db,u,input.agreement_id);
  if(agreement.status!=='active')fail(409,'agreement_ended','الاتفاق منتهٍ');
  if(typeof input.period_month!=='string'||!/^\d{4}-(?:0[1-9]|1[0-2])$/.test(input.period_month))fail(400,'period_month','الشهر بصيغة 2026-09');
  if(db.prepare('SELECT 1 FROM retainer_periods WHERE agreement_id=? AND period_month=?').get(agreement.id,input.period_month))fail(409,'duplicate_period','الفترة مفتوحة أصلًا');
  const budget=units(agreement.basis,input.budget,'ميزانية الفترة');
  // المرحَّل داخلًا هو ما حسبته الفترة السابقة عند إقفالها بخيارات العقد وقتها، سالبًا كان أو موجبًا.
  const previous=db.prepare("SELECT * FROM retainer_periods WHERE agreement_id=? AND period_month<? AND status='closed' ORDER BY period_month DESC LIMIT 1").get(agreement.id,input.period_month);
  const carriedIn=previous?previous.carried_out_units:0;
  const periodId=id(),time=now();
  db.prepare("INSERT INTO retainer_periods(id,tenant_id,agreement_id,period_month,budget_units,carried_in_units,status,created_at,updated_at) VALUES(?,?,?,?,?,?,'open',?,?)")
    .run(periodId,u.tenant_id,agreement.id,input.period_month,budget,carriedIn,time,time);
  audit(db,u,'retainer_period',periodId,'retainer.period_opened',{},{agreement_id:agreement.id,period:input.period_month,budget_units:budget,carried_in_units:carriedIn});
  return {id:periodId,carried_in_units:carriedIn};
}

export function recordConsumption(db,supplied,periodId,input){
  writing(db);const u=manager(db,supplied);
  v.object(input,['amount','reference']);
  const period=typeof periodId==='string'&&db.prepare("SELECT * FROM retainer_periods WHERE id=? AND tenant_id=? AND status='open'").get(periodId,u.tenant_id);
  if(!period)fail(404,'not_found','الفترة غير متاحة أو مقفلة');
  const agreement=db.prepare('SELECT * FROM retainer_agreements WHERE id=?').get(period.agreement_id);
  const amount=units(agreement.basis,input.amount,'المستهلك'),time=now();
  db.prepare('INSERT INTO retainer_consumption VALUES(?,?,?,?,?,?)').run(id(),period.id,amount,v.text(input.reference,'مرجع الاستهلاك',500,3),u.id,time);
  const consumed=period.consumed_units+amount;
  db.prepare('UPDATE retainer_periods SET consumed_units=?,version=version+1,updated_at=? WHERE id=?').run(consumed,time,period.id);
  const available=availableUnits(period),fired=[];
  // التنبيه يقع مرة واحدة لكل عتبة في كل فترة؛ مفتاح الجدول يضمنها ولو تكرر التسجيل.
  if(available>0)for(const rule of db.prepare('SELECT * FROM retainer_alert_rules WHERE agreement_id=? ORDER BY threshold_bp').all(agreement.id)){
    if(consumed*10000<available*rule.threshold_bp)continue;
    if(db.prepare('SELECT 1 FROM retainer_alerts WHERE period_id=? AND threshold_bp=?').get(period.id,rule.threshold_bp))continue;
    db.prepare('INSERT INTO retainer_alerts VALUES(?,?,?,?,?,?)').run(period.id,rule.threshold_bp,consumed,available,rule.recipients,time);
    fired.push(rule.threshold_bp);
  }
  audit(db,u,'retainer_period',period.id,'retainer.consumption_recorded',{consumed_units:period.consumed_units},{consumed_units:consumed,alerts:fired});
  return {id:period.id,consumed_units:consumed,alerts:fired};
}

export function closePeriod(db,supplied,periodId,input){
  writing(db);const u=manager(db,supplied);
  v.object(input,['version','note']);
  const period=typeof periodId==='string'&&db.prepare("SELECT * FROM retainer_periods WHERE id=? AND tenant_id=? AND status='open'").get(periodId,u.tenant_id);
  if(!period)fail(404,'not_found','الفترة غير متاحة أو مقفلة');
  v.version(input.version,period.version);
  const agreement=db.prepare('SELECT * FROM retainer_agreements WHERE id=?').get(period.agreement_id);
  if(agreement.owner_id!==u.id)fail(403,'not_owner','إقفال الفترة وحساب الترحيل قرار صاحب العقد');
  const available=availableUnits(period),difference=available-period.consumed_units;
  // خياران مستقلان: غير المستهلك يُرحَّل إن فُعّل ترحيله، والزائد يُخصم من الفترة التالية إن فُعّل خصمه. ولا أثر لأيهما على مبلغ الفاتورة.
  const carriedOut=difference>0?(agreement.carry_unused?difference:0):difference<0?(agreement.deduct_overage?difference:0):0;
  const note=v.text(input.note,'ملخص الفترة وأساس الترحيل',1000,5),time=now();
  db.prepare("UPDATE retainer_periods SET status='closed',carried_out_units=?,closed_by=?,closed_at=?,closing_note=?,version=version+1,updated_at=? WHERE id=? AND version=?")
    .run(carriedOut,u.id,time,note,time,period.id,period.version);
  audit(db,u,'retainer_period',period.id,'retainer.period_closed',{status:'open'},{status:'closed',carried_out_units:carriedOut,billing_unchanged:true},note);
  return {id:period.id,carried_out_units:carriedOut,carried_out_text:showUnits(agreement.basis,carriedOut)};
}
