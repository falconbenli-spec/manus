import { randomUUID } from 'node:crypto';
import { audit, now } from './db.mjs';
import { fail } from './auth.mjs';
import * as v from './validation.mjs';
import { currentUser } from './delegations.mjs';
import { can } from './access.mjs';

// تقويم الالتزامات: المنصة تذكّر وتحفظ دليل التنفيذ، ولا تعرف موعدًا نظاميًا من عندها ولا تنفذ معاملة لدى جهة.
export const CADENCES={monthly:'شهري',quarterly:'ربع سنوي',yearly:'سنوي'};
// أسماء شائعة تُقترح عند الإنشاء بلا مواعيد؛ الموعد وسنده يدخلهما من يعرفهما.
export const SUGGESTED=['رفع ملف حماية الأجور','سداد اشتراكات التأمينات الاجتماعية','إقرار ضريبة القيمة المضافة','إقرار الزكاة السنوي','تجديد السجل التجاري','تجديد رخصة البلدية','تجديد شهادة الفوترة الإلكترونية','توثيق العقود في منصة قوى','تجديد التأمين الطبي'];
const REMIND_DAYS=10;
const today=()=>new Date(Date.now()+3*3600000).toISOString().slice(0,10);
const pad=n=>String(n).padStart(2,'0');
const name=(db,userId)=>userId?db.prepare('SELECT name FROM users WHERE id=?').get(userId)?.name??null:null;
function actor(db,supplied){const u=currentUser(db,supplied);if(!u)fail(403,'forbidden','الحساب غير متاح');return u;}
function writing(db){if(!db.isTransaction)fail(500,'transaction_required','تتطلب الكتابة معاملة قاعدة بيانات');}
// الفترة الجارية وموعد استحقاقها. الربع السنوي: due_month هو شهر الاستحقاق الأول في السنة ويتكرر كل ثلاثة أشهر.
export function currentPeriod(o,date){
  const [y,m]=date.split('-').map(Number);
  if(o.cadence==='monthly')return {period:date.slice(0,7),due_date:`${date.slice(0,7)}-${pad(o.due_day)}`};
  if(o.cadence==='yearly')return {period:String(y),due_date:`${y}-${pad(o.due_month)}-${pad(o.due_day)}`};
  const months=[0,3,6,9].map(k=>((o.due_month-1+k)%12)+1).sort((a,b)=>a-b),next=months.find(x=>x>=m)??months[0],year=next>=m?y:y+1;
  return {period:`${year}-Q${months.indexOf(next)+1}`,due_date:`${year}-${pad(next)}-${pad(o.due_day)}`};
}
function view(db,u,o,manage){
  const date=today(),current=currentPeriod(o,date),done=db.prepare('SELECT * FROM compliance_completions WHERE obligation_id=? AND period=?').get(o.id,current.period)??null;
  const daysLeft=Math.round((Date.parse(current.due_date)-Date.parse(date))/86400000),state=done?(done.verified_by?'verified':'completed'):daysLeft<0?'overdue':daysLeft<=REMIND_DAYS?'due_soon':'scheduled',actions=[];
  if(!done&&o.owner_id===u.id&&o.active)actions.push('complete_obligation');
  if(done&&!done.verified_by&&manage&&done.completed_by!==u.id)actions.push('verify_obligation');
  if(manage)actions.push(o.active?'deactivate_obligation':'activate_obligation');
  return {...o,active:!!o.active,cadence_name:CADENCES[o.cadence],owner_name:name(db,o.owner_id),period:current.period,due_date:current.due_date,days_left:daysLeft,state,
    state_name:{verified:'نُفذ وتُحقق منه',completed:'نُفذ — بانتظار التحقق',overdue:'متأخر',due_soon:'مستحق قريبًا',scheduled:'مجدول'}[state],
    completion:done?{...done,completed_by_name:name(db,done.completed_by),verified_by_name:name(db,done.verified_by)}:null,
    history:db.prepare('SELECT period,due_date,completed_at,verified_at FROM compliance_completions WHERE obligation_id=? ORDER BY period DESC LIMIT 6').all(o.id),
    // الصندوق الموحد يعرض المستحق قريبًا والمتأخر فقط.
    actions:actions.filter(a=>a!=='complete_obligation'||state!=='scheduled'||true),needs_owner:!done&&o.owner_id===u.id&&o.active&&['overdue','due_soon'].includes(state)};
}
export function complianceBoard(db,supplied){
  const u=actor(db,supplied),manage=can(db,u,'compliance.manage');
  const rows=db.prepare(`SELECT * FROM compliance_obligations WHERE tenant_id=? ${manage?'':'AND owner_id=? AND active=1'} ORDER BY active DESC,title`).all(...(manage?[u.tenant_id]:[u.tenant_id,u.id])).map(o=>view(db,u,o,manage));
  return {today:today(),can_manage:manage,cadences:CADENCES,suggested:manage?SUGGESTED.filter(t=>!rows.some(r=>r.title===t)):[],remind_days:REMIND_DAYS,
    people:manage?db.prepare("SELECT id,name FROM users WHERE tenant_id=? AND active=1 AND role<>'admin' ORDER BY name").all(u.tenant_id):[],obligations:rows,
    inbox:rows.filter(r=>r.needs_owner||r.actions.includes('verify_obligation')).map(r=>({id:r.id,title:r.title,due_date:r.due_date,created_at:null,actions:[r.needs_owner?'complete_obligation':'verify_obligation']})),
    note:'المواعيد يدخلها من يعرفها مع سندها؛ المنصة لا تفترض موعدًا نظاميًا ولا تنفذ المعاملة لدى الجهة. تذكّر المالك قبل الموعد وتحفظ دليل التنفيذ، ويتحقق منه شخص آخر.'};
}
export function createObligation(db,supplied,input){
  writing(db);const u=actor(db,supplied);if(!can(db,u,'compliance.manage'))fail(403,'not_permitted','إدارة تقويم الالتزامات لحامل تصريحها');
  v.object(input,['title','authority','cadence','due_day','due_month','owner_id','basis']);
  if(!Object.hasOwn(CADENCES,input.cadence))fail(400,'cadence','اختر التكرار');
  if(!Number.isInteger(input.due_day)||input.due_day<1||input.due_day>28)fail(400,'due_day','يوم الاستحقاق من 1 إلى 28');
  const month=input.cadence==='monthly'?null:input.due_month;
  if(month!==null&&(!Number.isInteger(month)||month<1||month>12))fail(400,'due_month','شهر الاستحقاق من 1 إلى 12');
  const owner=db.prepare("SELECT id FROM users WHERE id=? AND tenant_id=? AND active=1 AND role<>'admin'").get(input.owner_id,u.tenant_id);if(!owner)fail(400,'owner_id','المالك غير متاح');
  const title=v.text(input.title,'الالتزام',200,5);
  if(db.prepare('SELECT 1 FROM compliance_obligations WHERE tenant_id=? AND title=?').get(u.tenant_id,title))fail(409,'duplicate_obligation','الالتزام مسجل');
  const obligationId=randomUUID(),time=now();
  db.prepare('INSERT INTO compliance_obligations(id,tenant_id,title,authority,cadence,due_day,due_month,owner_id,basis,created_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)').run(obligationId,u.tenant_id,title,v.text(input.authority,'الجهة',160,2),input.cadence,input.due_day,month,owner.id,v.text(input.basis,'سند الموعد ومن أكده',1500,10),u.id,time,time);
  audit(db,u,'compliance',obligationId,'obligation.created',{}, {title});
  return {id:obligationId};
}
export function obligationAction(db,supplied,obligationId,action,input){
  writing(db);const u=actor(db,supplied),manage=can(db,u,'compliance.manage');
  const o=typeof obligationId==='string'&&db.prepare('SELECT * FROM compliance_obligations WHERE id=? AND tenant_id=?').get(obligationId,u.tenant_id);
  if(!o||!(manage||o.owner_id===u.id))fail(404,'not_found','الالتزام غير متاح');
  const current=view(db,u,o,manage);if(!current.actions.includes(action))fail(409,'invalid_state','الإجراء غير متاح في حالة الالتزام أو لحسابك');
  const time=now();
  if(action==='complete_obligation'){
    v.object(input,['evidence_reference']);
    db.prepare('INSERT INTO compliance_completions(id,obligation_id,period,due_date,completed_by,completed_at,evidence_reference) VALUES(?,?,?,?,?,?,?)').run(randomUUID(),o.id,current.period,current.due_date,u.id,time,v.text(input.evidence_reference,'دليل التنفيذ: رقم المعاملة أو الإيصال ومكان حفظه',1000,5));
  }else if(action==='verify_obligation'){
    v.object(input,['note']);
    db.prepare('UPDATE compliance_completions SET verified_by=?,verified_at=?,verification_note=? WHERE obligation_id=? AND period=?').run(u.id,time,v.text(input.note,'ما الذي اطلعت عليه',1000,5),o.id,current.period);
  }else{
    v.object(input,['version','note']);if(input.version!==o.version)fail(409,'stale_version','تغير السجل منذ فتحه. أعد التحميل');v.text(input.note,'السبب',1000,5);
    db.prepare('UPDATE compliance_obligations SET active=?,version=version+1,updated_at=? WHERE id=?').run(action==='activate_obligation'?1:0,time,o.id);
  }
  audit(db,u,'compliance',o.id,'obligation.'+action,{}, {period:current.period});
  return {id:o.id};
}
