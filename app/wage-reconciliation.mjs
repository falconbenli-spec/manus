import { randomUUID } from 'node:crypto';
import { audit, now } from './db.mjs';
import { fail } from './auth.mjs';
import * as v from './validation.mjs';
import { staff, need, writing, riyadhToday, monthValue, monthRange, contractInForce, onDutyEmployees, runLines, monthlyWage } from './wage-basis.mjs';

// المطابقة الثلاثية للأجر: أجر العقد، والأجر المسجّل لدى الجهة، وأجر المسير.
// الرقم المسجّل لدى الجهة يدخله مدير الموارد البشرية بيده بتاريخه ومصدره؛ المنصة لا تتصل بأي جهة ولا تجلبه ولا تصححه.
export const BOARD_NOTE='الأجر المسجّل لدى التأمينات رقم يُدخل يدويًا من حساب المنشأة بتاريخ تسجيله. المنصة لا تتصل بأي جهة ولا تصحح أي فرق آليًا؛ الفرق قرار بشري يُوثق.';
export const RESOLUTIONS=[
  ['registration_update_requested','طُلب تعديل التسجيل لدى الجهة'],
  ['contract_correction_requested','طُلب تصحيح العقد في المنصة'],
  ['explained','فرق مفسَّر يُحفظ تفسيره']
].map(([key,name])=>({key,name}));
const id=()=>randomUUID();
function money(value,label){
  if(typeof value!=='string'||!/^(?:0|[1-9]\d{0,7})(?:\.\d{1,2})?$/.test(value))fail(400,'invalid_money',`${label}: مبلغ بخانتين عشريتين كحد أقصى`);
  const [whole,fraction='']=value.split('.'),minor=Number(BigInt(whole)*100n+BigInt(fraction.padEnd(2,'0')));
  if(minor<=0)fail(400,'invalid_money',`${label}: مبلغ موجب`);
  return minor;
}
const currentRegistration=(db,userId)=>db.prepare('SELECT * FROM wage_registrations WHERE user_id=? AND superseded_by IS NULL').get(userId)??null;
const gap=(a,b)=>a===null||b===null?null:a-b;
const biggest=values=>values.reduce((n,x)=>x===null?n:Math.max(n,Math.abs(x)),0);

export function wageReconciliation(db,supplied,month=null){
  const u=staff(db,supplied),today=riyadhToday();
  const name=userId=>userId?db.prepare('SELECT name FROM users WHERE id=?').get(userId)?.name??null:null;
  // المنعكس (الترحيل 175) مثل الملغى: ليس مسير الشهر، فمسيره المصحَّح هو الذي يُطابَق.
  const months=db.prepare("SELECT DISTINCT month FROM payroll_runs WHERE tenant_id=? AND status NOT IN ('cancelled','reversed') ORDER BY month DESC LIMIT 24").all(u.tenant_id).map(r=>r.month);
  const target=month===null||month===undefined||month===''?months[0]??today.slice(0,7):monthValue(month);
  const range=monthRange(target);
  const run=db.prepare("SELECT * FROM payroll_runs WHERE tenant_id=? AND month=? AND status NOT IN ('cancelled','reversed')").get(u.tenant_id,target)??null;
  const lines=run?runLines(db,run.id):[],lineBy=new Map(lines.map(l=>[l.user_id,l]));
  const people=new Map(onDutyEmployees(db,u.tenant_id,range).map(p=>[p.id,p.name]));
  for(const line of lines)if(!people.has(line.user_id))people.set(line.user_id,line.employee_name);
  const decides=u.caps.includes('payroll.review')||u.caps.includes('payroll.approve');
  const notes=db.prepare('SELECT * FROM wage_difference_notes WHERE tenant_id=? AND month=? ORDER BY created_at DESC').all(u.tenant_id,target)
    .map(n=>({...n,resolution_name:RESOLUTIONS.find(r=>r.key===n.resolution).name,recorded_by_name:name(n.recorded_by),employee_name:people.get(n.user_id)??name(n.user_id)}));
  const rows=[...people].map(([userId,employeeName])=>{
    const contract=contractInForce(db,userId,range),line=lineBy.get(userId)??null,registration=currentRegistration(db,userId);
    const contractWage=contract?contract.monthly_total_minor:null,registeredWage=registration?registration.registered_wage_minor:null,payrollWage=line?monthlyWage(line):null;
    const differences={contract_vs_registered:gap(contractWage,registeredWage),registered_vs_payroll:gap(registeredWage,payrollWage),contract_vs_payroll:gap(contractWage,payrollWage)};
    const values=Object.values(differences),largest=biggest(values);
    const state=!registration?'missing_registration':values.every(x=>x===0)?'matched':values.some(x=>x!==null&&x!==0)?'different':'incomplete';
    const mine=notes.filter(n=>n.user_id===userId),actions=[];
    if(u.caps.includes('payroll.prepare')&&userId!==u.id)actions.push('record_registration');
    if(decides&&userId!==u.id&&state==='different')actions.push('record_difference');
    return {user_id:userId,employee_name:employeeName,contract_wage_minor:contractWage,registered_wage_minor:registeredWage,payroll_wage_minor:payrollWage,
      payroll_paid_minor:line?line.gross_minor:null,paid_fraction_bp:line?line.paid_fraction_bp:null,in_run:!!line,
      registration:registration?{registered_on:registration.registered_on,source_note:registration.source_note,recorded_by_name:name(registration.recorded_by),recorded_at:registration.recorded_at}:null,
      differences,largest_difference_minor:largest,state,notes:mine,actions};
  }).sort((a,b)=>b.largest_difference_minor-a.largest_difference_minor||a.employee_name.localeCompare(b.employee_name,'ar'));
  const history=db.prepare('SELECT w.*,x.name AS employee_name FROM wage_registrations w JOIN users x ON x.id=w.user_id WHERE w.tenant_id=? ORDER BY w.recorded_at DESC LIMIT 60').all(u.tenant_id)
    .map(r=>({id:r.id,employee_name:r.employee_name,registered_wage_minor:r.registered_wage_minor,registered_on:r.registered_on,source_note:r.source_note,recorded_by_name:name(r.recorded_by),recorded_at:r.recorded_at,superseded:!!r.superseded_by}));
  const employees=db.prepare("SELECT id,name FROM users WHERE tenant_id=? AND active=1 AND role<>'admin' AND id<>? ORDER BY name").all(u.tenant_id,u.id);
  return {today,user_id:u.id,permissions:u.caps,note:BOARD_NOTE,resolutions:RESOLUTIONS,
    month:target,months,run:run?{id:run.id,status:run.status,month:run.month}:null,employees,rows,notes,registration_history:history,
    totals:{people:rows.length,matched:rows.filter(r=>r.state==='matched').length,different:rows.filter(r=>r.state==='different').length,missing_registration:rows.filter(r=>r.state==='missing_registration').length},
    rule:'الأرقام الثلاثة يجب أن تتطابق. الفرق يُعرض بمقداره ولا يُصحَّح آليًا: إما تعديل التسجيل لدى الجهة، أو تصحيح العقد، أو تفسير مكتوب يُحفظ.'};
}

export function recordWageRegistration(db,supplied,input){
  writing(db);
  const u=staff(db,supplied);need(u,'payroll.prepare','تسجيل الأجر المسجّل لدى الجهة لمن يعد الرواتب');
  v.object(input,['user_id','amount','registered_on','source_note']);
  const person=typeof input.user_id==='string'&&db.prepare("SELECT id,name FROM users WHERE id=? AND tenant_id=? AND active=1 AND role<>'admin'").get(input.user_id,u.tenant_id);
  if(!person)fail(404,'not_found','الموظف غير متاح');
  if(person.id===u.id)fail(409,'separation_of_duties','لا يسجل الموظف أجره المسجّل لدى الجهة بنفسه');
  const registeredOn=v.date(input.registered_on);
  if(registeredOn>riyadhToday())fail(400,'registered_on','تاريخ التسجيل لدى الجهة لا يكون في المستقبل');
  const amount=money(input.amount,'الأجر المسجّل لدى الجهة'),current=currentRegistration(db,person.id),entryId=id();
  // الإدخال الجديد يحل محل السابق ويبقى السابق في السجل: لا تصحيح صامت لرقم قرأه إنسان من جهة خارجية.
  // يُوسم السابق قبل إدخال الجديد حتى لا يكون للموظف إدخالان ساريان في أي لحظة (فهرس فريد على الساري).
  if(current)db.prepare('UPDATE wage_registrations SET superseded_by=? WHERE id=?').run(entryId,current.id);
  db.prepare('INSERT INTO wage_registrations(id,tenant_id,user_id,registered_wage_minor,registered_on,source_note,recorded_by,recorded_at) VALUES(?,?,?,?,?,?,?,?)')
    .run(entryId,u.tenant_id,person.id,amount,registeredOn,v.text(input.source_note,'من أين قرأت الرقم في حساب المنشأة',2000,10),u.id,now());
  audit(db,u,'wage_registration',entryId,'wage_registration.recorded',current?{previous_id:current.id}:{},{user_id:person.id,registered_on:registeredOn});
  return {id:entryId};
}

export function recordWageDifferenceNote(db,supplied,input){
  writing(db);
  const u=staff(db,supplied);
  if(!u.caps.includes('payroll.review')&&!u.caps.includes('payroll.approve'))fail(403,'not_permitted','قرار الفرق لمن يراجع المسير أو يعتمده');
  v.object(input,['user_id','month','resolution','note']);
  if(!RESOLUTIONS.some(r=>r.key===input.resolution))fail(400,'resolution','اختر ما تقرره في هذا الفرق');
  const month=monthValue(input.month),row=wageReconciliation(db,u,month).rows.find(r=>r.user_id===input.user_id);
  if(!row)fail(404,'not_found','الموظف ليس في مطابقة هذا الشهر');
  if(row.user_id===u.id)fail(409,'separation_of_duties','لا يقرر الموظف في فرق أجره');
  if(row.state!=='different')fail(409,'no_difference','لا فرق مسجل لهذا الموظف في هذا الشهر');
  const noteId=id();
  // الأرقام الثلاثة تُلتقط من الخادم لا من الطلب: التفسير يُحفظ مع الفرق الذي كان قائمًا وقت كتابته.
  db.prepare('INSERT INTO wage_difference_notes(id,tenant_id,user_id,month,contract_wage_minor,registered_wage_minor,payroll_wage_minor,resolution,note,recorded_by,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)')
    .run(noteId,u.tenant_id,row.user_id,month,row.contract_wage_minor,row.registered_wage_minor,row.payroll_wage_minor,input.resolution,v.text(input.note,'ما القرار وما سنده',2000,10),u.id,now());
  audit(db,u,'wage_difference',noteId,'wage_difference.'+input.resolution,{},{user_id:row.user_id,month,largest_difference_minor:row.largest_difference_minor});
  return {id:noteId};
}
