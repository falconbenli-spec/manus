import { fail } from './auth.mjs';
import { currentUser } from './delegations.mjs';
import { holds } from './access.mjs';

// أساس مشترك لوحدات حماية الأجور الثلاث: من يرى الشاشة، ومدى الشهر، وحقائق الموظف التي تُقاس عليها الفحوص.
// يقرأ ولا يكتب، ولا يحتسب راتبًا: الاحتساب كله في app/payroll.mjs ولا يُمس.
export const PAYROLL_CAPS=['payroll.prepare','payroll.review','payroll.approve'];
export const riyadhToday=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Riyadh',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());

export function actor(db,supplied){
  const u=currentUser(db,supplied);
  if(!u)fail(403,'forbidden','الحساب غير متاح');
  u.caps=PAYROLL_CAPS.filter(key=>holds(db,u,key));
  return u;
}
export function staff(db,supplied){
  const u=actor(db,supplied);
  if(!u.caps.length)fail(403,'not_permitted','شاشات حماية الأجور لحاملي تصريح الرواتب الصريح');
  return u;
}
export function need(u,key,message){if(!u.caps.includes(key))fail(403,'not_permitted',message);}
export function writing(db){if(!db.isTransaction)fail(500,'transaction_required','تتطلب الكتابة معاملة قاعدة بيانات');}

export function monthValue(value){
  if(typeof value!=='string'||!/^\d{4}-(0[1-9]|1[0-2])$/.test(value))fail(400,'invalid_month','الشهر بصيغة 2026-09');
  return value;
}
export function monthRange(month){
  monthValue(month);
  const [year,m]=month.split('-').map(Number),days=new Date(Date.UTC(year,m,0)).getUTCDate();
  return {month,from:`${month}-01`,to:`${month}-${String(days).padStart(2,'0')}`,days};
}
export const shiftMonth=(month,offset)=>{const [y,m]=month.split('-').map(Number);return new Date(Date.UTC(y,m-1+offset,1)).toISOString().slice(0,7);};

// حساب الراتب المتحقق منه الساري على شهر المسير، وما ينتظر التحقق، فالفحص يميز «بلا حساب» عن «حساب غير متحقق منه».
export function bankState(db,userId,month){
  const verified=db.prepare("SELECT * FROM employee_bank_accounts WHERE user_id=? AND status='verified' AND effective_month<=? ORDER BY effective_month DESC,decided_at DESC LIMIT 1").get(userId,month)??null;
  const pending=db.prepare("SELECT * FROM employee_bank_accounts WHERE user_id=? AND status='pending' ORDER BY created_at DESC LIMIT 1").get(userId)??null;
  return {verified,pending};
}
// الهوية أو الإقامة المسجلة في السجل الوظيفي. المنصة تحفظ مرجعًا مختصرًا لا رقمًا كاملًا (app/employees.mjs).
export function identityDocument(db,userId){
  return db.prepare("SELECT * FROM employee_documents WHERE user_id=? AND doc_type IN ('national_id','iqama') AND replaced_by IS NULL ORDER BY expires_on DESC LIMIT 1").get(userId)??null;
}
// من هو على رأس العمل في الشهر: حساب نشط بعقد يتقاطع مع الشهر، بالمعيار نفسه الذي يبني به المسير سطوره.
export function onDutyEmployees(db,tenantId,range){
  return db.prepare("SELECT u.id,u.name FROM users u WHERE u.tenant_id=? AND u.active=1 AND u.role<>'admin' AND EXISTS(SELECT 1 FROM employment_contracts c WHERE c.user_id=u.id AND c.tenant_id=u.tenant_id AND c.status IN ('active','ended') AND c.start_date<=? AND COALESCE(c.ended_on,c.end_date,'9999-12-31')>=?) ORDER BY u.name")
    .all(tenantId,range.to,range.from);
}
export function contractInForce(db,userId,range){
  return db.prepare("SELECT * FROM employment_contracts WHERE user_id=? AND status IN ('active','ended') AND start_date<=? AND COALESCE(ended_on,end_date,'9999-12-31')>=? ORDER BY start_date DESC LIMIT 1").get(userId,range.to,range.from)??null;
}
export function runLines(db,runId){
  return db.prepare('SELECT l.*,x.name AS employee_name,x.active AS employee_active FROM payroll_lines l JOIN users x ON x.id=l.user_id WHERE l.run_id=? ORDER BY x.name').all(runId)
    .map(l=>({...l,earnings:JSON.parse(l.earnings),basis:JSON.parse(l.basis),adjustments:JSON.parse(l.adjustments),employee_active:!!l.employee_active}));
}
// أجر الشهر الكامل كما طبقه المسير: مجموع بنود العقد الشهرية، لا المصروف المجزأ لمن باشر أو انتهى خلال الشهر.
export const monthlyWage=line=>line.earnings.reduce((n,l)=>n+(l.monthly_minor??l.amount_minor),0);
export const runFor=(db,tenantId,runId)=>typeof runId==='string'?db.prepare('SELECT * FROM payroll_runs WHERE id=? AND tenant_id=?').get(runId,tenantId)??null:null;
