import { audit, now } from './db.mjs';
import { fail } from './auth.mjs';
import * as v from './validation.mjs';
import { currentUser } from './delegations.mjs';
import { holds } from './access.mjs';
import { riyadhDate } from './work-calendar.mjs';
import { recordOverride } from './payroll-insurance.mjs';

// تركيبة القوى العاملة ونسبة التوطين، محسوبة من سجلات المنصة وحدها.
// لا تصنيف نطاق ولا لون ولا مستوى امتثال: معادلة التصنيف نظامية متغيرة ولا نملك نصها، وأي حكم هنا ادعاء.
// لا تحليلات تنبؤية للاستقالات عمدًا: على 30–60 موظفًا لا يستقر أي نموذج، ودرجة «خطر مغادرة» على شخص بعينه
// قد تظلمه في ترقية أو مهمة دون أن يعلم. اللوحة تصف ما حدث ولا تتنبأ بمن سيغادر.
const CAP='hr.workforce.view';
export const SAUDIZATION_TEXT='النسبة محسوبة من سجلات المنصة. تصنيف النطاق وأثره يحدده مدير الموارد البشرية من حساب المنشأة لدى الجهة — غير متحقق منه هنا.';
const today=()=>riyadhDate(Date.now());
const shift=(date,days)=>new Date(Date.parse(date+'T00:00:00Z')+days*86400000).toISOString().slice(0,10);
const ratio=(part,whole)=>whole?Math.round(part*10000/whole):null;

function actor(db,supplied){const u=currentUser(db,supplied);if(!u||u.role==='admin')fail(403,'forbidden','هذه الشاشة لحسابات الموظفين');if(!holds(db,u,CAP))fail(403,'not_permitted','لوحة القوى العاملة لحامل تصريحها');return u;}
function writing(db){if(!db.isTransaction)fail(500,'transaction_required','تتطلب الكتابة معاملة قاعدة بيانات');}
// الجنسية تُسجَّل من وثيقة يطلع عليها موظف الموارد البشرية، كما في السجل الوظيفي.
const recorder=u=>u.role==='hr';

// تاريخ المغادرة من تغيير الحالة المطبَّق في السجل الوظيفي؛ تاريخ الالتحاق من ملف الموظف.
function people(db,tenantId){
  const left=new Map(db.prepare("SELECT user_id,MAX(effective_from) AS on_ FROM employee_changes WHERE tenant_id=? AND change_type='status' AND to_value='left' AND applied_at IS NOT NULL GROUP BY user_id").all(tenantId).map(r=>[r.user_id,r.on_]));
  return db.prepare("SELECT u.id,u.name,u.active,u.department_id,d.name AS department,p.join_date,g.nationality_group,g.gender,g.version AS demographics_version,g.source AS demographics_source FROM users u LEFT JOIN departments d ON d.id=u.department_id AND d.tenant_id=u.tenant_id LEFT JOIN employee_profiles p ON p.user_id=u.id LEFT JOIN employee_demographics g ON g.user_id=u.id WHERE u.tenant_id=? AND u.role<>'admin' ORDER BY u.name")
    .all(tenantId).map(p=>({...p,active:!!p.active,left_on:left.get(p.id)??null}));
}
const onRoll=(p,date)=>!!p.join_date&&p.join_date<=date&&!(p.left_on&&p.left_on<=date);

export function saudization(list){
  const active=list.filter(p=>p.active),recorded=active.filter(p=>p.nationality_group),saudi=recorded.filter(p=>p.nationality_group==='saudi').length;
  return {active:active.length,recorded:recorded.length,unrecorded:active.length-recorded.length,saudi,non_saudi:recorded.length-saudi,
    ratio_bp:ratio(saudi,recorded.length),complete:recorded.length===active.length&&active.length>0,text:SAUDIZATION_TEXT};
}

export function workforceBoard(db,supplied,query={}){
  const u=actor(db,supplied),date=today();
  v.object(query,['from','to']);
  const to=query.to?v.date(query.to):date,from=query.from?v.date(query.from):to.slice(0,4)+'-01-01';
  if(from>to)fail(400,'date_order','بداية الفترة قبل نهايتها');
  const list=people(db,u.tenant_id),active=list.filter(p=>p.active);
  const departments=[...new Set(active.map(p=>p.department))].map(name=>({department:name,count:active.filter(p=>p.department===name).length})).sort((a,b)=>b.count-a.count);
  // من لا ملف له لا يُعرف تاريخ التحاقه، فيُستبعد من حساب الفترة ويُذكر عدده صراحة.
  const dated=list.filter(p=>p.join_date);
  const joiners=dated.filter(p=>p.join_date>=from&&p.join_date<=to),leavers=list.filter(p=>p.left_on&&p.left_on>=from&&p.left_on<=to);
  const start=dated.filter(p=>onRoll(p,shift(from,-1))).length,end=dated.filter(p=>onRoll(p,to)).length,average=(start+end)/2;
  const s=saudization(list);
  return {today:date,period:{from,to},can_record:recorder(u),
    headcount:active.length,departments,
    movement:{joiners:joiners.length,leavers:leavers.length,headcount_start:start,headcount_end:end,turnover_bp:average?Math.round(leavers.length*10000/average):null,
      without_profile:active.filter(p=>!p.join_date).length,
      joiner_names:joiners.map(p=>p.name),leaver_names:leavers.map(p=>p.name)},
    saudization:s,
    people:active.map(p=>({id:p.id,name:p.name,department:p.department,nationality_group:p.nationality_group,gender:p.gender,source:p.demographics_source,version:p.demographics_version??0})),
    note:'أرقام وصفية من سجلات المنصة فقط: الالتحاق من ملف الموظف، والمغادرة من تغيير الحالة المطبَّق في السجل الوظيفي. معدل الدوران = المغادرون ÷ متوسط العدد في أول الفترة وآخرها. لا تنبؤ بالاستقالات ولا درجة خطر لأي موظف.'};
}

// المحاكاة لا تكتب شيئًا ولا تصدر حكم امتثال: تعيد النسبة قبل وبعد فقط.
export function simulateSaudization(db,supplied,input){
  const u=actor(db,supplied);
  v.object(input,['hire_saudi','hire_non_saudi','leave_saudi','leave_non_saudi']);
  const n=key=>{const x=input[key]??0;if(!Number.isInteger(x)||x<0||x>500)fail(400,'invalid_number','الأعداد صحيحة من 0 إلى 500');return x;};
  const s=saudization(people(db,u.tenant_id));
  const hs=n('hire_saudi'),hn=n('hire_non_saudi'),ls=n('leave_saudi'),ln=n('leave_non_saudi');
  if(ls>s.saudi||ln>s.non_saudi)fail(400,'invalid_number','عدد المغادرين يتجاوز المسجلين في الفئة');
  const saudi=s.saudi+hs-ls,total=s.recorded+hs+hn-ls-ln;
  return {before:{saudi:s.saudi,recorded:s.recorded,ratio_bp:s.ratio_bp},after:{saudi,recorded:total,ratio_bp:ratio(saudi,total)},unrecorded:s.unrecorded,
    text:SAUDIZATION_TEXT,note:'محاكاة حسابية على السجلات المسجلة جنسيتها فقط؛ لا تُحفظ ولا تعني حكمًا على النطاق.'};
}

export function recordDemographics(db,supplied,userId,input){
  writing(db);const u=actor(db,supplied);
  if(!recorder(u))fail(403,'not_permitted','تسجيل الجنسية لموظفي الموارد البشرية');
  v.object(input,['version','nationality_group','gender','source','gcc_national']);
  const person=typeof userId==='string'&&db.prepare("SELECT id FROM users WHERE id=? AND tenant_id=? AND role<>'admin'").get(userId,u.tenant_id);
  if(!person)fail(404,'not_found','الموظف غير متاح');
  if(person.id===u.id)fail(409,'separation_of_duties','لا يسجل الموظف بياناته بنفسه');
  if(!['saudi','non_saudi'].includes(input.nationality_group))fail(400,'nationality_group','اختر سعودي أو غير سعودي');
  const gender=input.gender||null;if(gender&&!['female','male'].includes(gender))fail(400,'gender','الجنس غير صالح');
  const source=v.text(input.source,'الوثيقة التي اطُّلع عليها',200,5);
  if(/\d{6,}/.test(source.replace(/\s/g,'')))fail(400,'reference_number','لا تُدخل رقم الهوية أو الإقامة؛ اكتب نوع الوثيقة فقط');
  const existing=db.prepare('SELECT * FROM employee_demographics WHERE user_id=?').get(person.id),time=now();
  v.version(input.version,existing?.version??0);
  if(existing)db.prepare('UPDATE employee_demographics SET nationality_group=?,gender=?,source=?,recorded_by=?,version=version+1,updated_at=? WHERE user_id=?').run(input.nationality_group,gender,source,u.id,time,person.id);
  else db.prepare('INSERT INTO employee_demographics(user_id,tenant_id,nationality_group,gender,source,recorded_by,updated_at) VALUES(?,?,?,?,?,?,?)').run(person.id,u.tenant_id,input.nationality_group,gender,source,u.id,time);
  // القيم نفسها لا تدخل سجل التدقيق العام؛ يكفي أن سجلًا تغيّر ومن غيّره وعلى أي وثيقة.
  audit(db,u,'employee_demographics',person.id,existing?'demographics.updated':'demographics.recorded',{version:existing?.version??0},{version:(existing?.version??0)+1},source);
  // سؤال الخليج يُسأل حيث تُسجَّل الجنسية، لا في شاشة يقرؤها من يحسب المسير وحده: حقل الجنسية قيمتان لا غير،
  // فمواطن دولة خليجية — وهو خارج جدول الخصم بقرار المالك — لا يتميز عن أي غير سعودي إلا بجواب مسجَّل.
  // وقبل الجواب يمتنع اعتماد مسيره، فسكوتُ الملف لا يصير «ليس خليجيًا» لأن أحدًا لم يسأل.
  if(input.nationality_group==='non_saudi'&&input.gcc_national)recordGccAnswer(db,supplied,u,person.id,input.gcc_national,source);
  return {id:person.id};
}
function recordGccAnswer(db,supplied,u,userId,answer,source){
  if(!['yes','no'].includes(answer))fail(400,'gcc_national','جواب سؤال «هل هو مواطن خليجي؟»: نعم أو لا، ولا يُترك فارغًا لغير السعودي');
  const kind=answer==='yes'?'gcc_national':'not_gcc_national';
  const live=db.prepare("SELECT kind FROM employee_insurance_overrides WHERE tenant_id=? AND user_id=? AND kind IN ('gcc_national','not_gcc_national') AND withdrawn_by IS NULL").get(u.tenant_id,userId);
  if(live&&live.kind!==kind)fail(409,'gcc_recorded',`لهذا الموظف جواب مسجَّل في شأن مواطني دول مجلس التعاون يخالف ما أدخلته الآن. اسحب الجواب القائم بسبب مكتوب من شاشة «حالات التأمينات» ثم سجّل غيره`);
  if(live)return;
  recordOverride(db,supplied,userId,kind,{effective_from:today(),
    basis:`جواب مسجَّل عند تسجيل الجنسية: ${answer==='yes'?'مواطن خليجي، خارج جدول الخصم بقرار المالك':'ليس مواطنًا خليجيًا'}. الوثيقة: ${source}`});
}
