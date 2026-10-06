import { randomUUID } from 'node:crypto';
import { audit, now } from './db.mjs';
import { fail } from './auth.mjs';
import * as v from './validation.mjs';
import { currentUser } from './delegations.mjs';
import { holds } from './access.mjs';
import { notifySubject, dayName } from './notices.mjs';
import { holidaySet, riyadhDate } from './work-calendar.mjs';
import { proposeAdjustment } from './payroll-extras.mjs';
import { issueInitiatedLetter, templateGap } from './letters.mjs';
import { dayStates } from './attendance.mjs';
import { PAY_COMPONENTS } from './hr-contracts.mjs';
import { capBasis, halfUp, PAY_COMPONENT_NAMES } from './hr-rule-basis.mjs';
import { roundMoney, roundingMode } from './payroll-rules.mjs';

// سجل المخالفات والجزاءات (P1-01؛ اللائحة م111–م126 وجداولها الملحقة؛ ترحيل 097).
// المنصة تقترح ولا توقع: تحسب رقم التكرار خلال 180 يومًا وتقترح الجزاء من جدول قبله مدير الموارد البشرية،
// ثم يلزم الإبلاغ بالاتهام والتحقيق ومحضره، ويقرر صاحب الصلاحية (غير المسجِّل وغير صاحب الشأن)، ويُبلَّغ الموظف كتابة،
// وله أن يتظلم. الغرامة تصل المسير حركة «مقترحة» يعتمدها معتمد الرواتب، وتُقيد في سجل الغرامات لصندوق منفعة العمال (م123).
// لا شيء هنا يتحول إلى جزاء من الحضور أو من غيره تلقائيًا.

export const BASE_SCHEDULE_ID='discipline-regulation-v1';
export const PENALTY_KINDS=['warning','fine','deprivation','dismissal_award','dismissal_no_award'];
// خانة «العقوبة المشتركة» المطبوعة تحت أعمدة العقوبات الأربع في بعض بنود الجداول وحدها (ص 43–46 من اللائحة الموقعة).
// قيمها الثلاث هي ما تطبعه الصفحات: دقائق/ساعات التأخر، ومدة ترك العمل، ومدة الغياب. البند بلا خانة مشتركة قيمته null.
export const EXTRA_DEDUCTIONS={
  late_time:['بالإضافة إلى حسم أجر مدة التأخر','Plus deduction of the late time'],
  left_time:['بالإضافة إلى حسم أجر مدة ترك العمل','Plus deduction of the time the worker was away'],
  absence_time:['بالإضافة إلى حسم أجر مدة الغياب','Plus deduction of the absence period']};
export const STATUS_NAMES={recorded:['مسجلة — بانتظار بدء التحقيق','Recorded — investigation not started'],investigating:['قيد التحقيق','Under investigation'],proven:['ثبتت — بانتظار قرار صاحب الصلاحية','Proven — awaiting the authority’s decision'],
  decided:['صدر القرار — بانتظار الإبلاغ الكتابي','Decided — awaiting written notice'],notified:['أُبلغ الموظف بالجزاء','Employee notified of the penalty'],not_proven:['لم تثبت — أُغلقت','Not proven — closed'],withdrawn:['سُحبت','Withdrawn'],lapsed:['سقطت بمضي المدة','Time-barred']};
export const SOURCE_KINDS={manager_report:['بلاغ من المدير المباشر','Direct manager’s report'],hr_observation:['رصد الموارد البشرية','HR observation'],attendance_day:['يوم حضور مسجل','An attendance day'],other:['مصدر آخر موثق','Other documented source']};
export const DELIVERY_METHODS={hand:['تسليم باليد','By hand'],registered_mail:['بريد مسجل على العنوان في ملف الخدمة','Registered mail to the address on file'],contract_email:['البريد الإلكتروني الثابت في العقد','Personal email stated in the contract']};
const OPEN=['recorded','investigating','proven'],COUNTED=['decided','notified'],FINAL=['not_proven','withdrawn','lapsed'];
// أيام الحضور التي لا تكون مخالفة أصلًا: إجازة أو عطلة أو راحة أو مهمة معتمدة.
const AWAY_STATES=['leave','holiday','off','mission'];
const LATE_CODES=['A01','A02','A03','A04','A05','A06','A07'],ABSENCE_CODES=['A11','A12','A13','A14','A15','A16'];
const CAPS=['hr.discipline.propose','hr.discipline.decide','hr.policy.prepare','hr.policy.accept','payroll.prepare','payroll.approve','hr.letters.issue'];
const id=()=>randomUUID();
const today=()=>riyadhDate(Date.now());
export const addDays=(date,n)=>new Date(Date.parse(date+'T00:00:00Z')+n*86400000).toISOString().slice(0,10);
export const daysBetween=(from,to)=>Math.round((Date.parse(to+'T00:00:00Z')-Date.parse(from+'T00:00:00Z'))/86400000);
const userName=(db,userId)=>userId?db.prepare('SELECT name FROM users WHERE id=?').get(userId)?.name??null:null;

function actor(db,supplied){const u=currentUser(db,supplied);if(!u||u.role==='admin')fail(403,'forbidden','هذه الشاشة لحسابات الموظفين');u.caps=CAPS.filter(k=>holds(db,u,k));return u;}
function writing(db){if(!db.isTransaction)fail(500,'transaction_required','تتطلب كتابة سجل المخالفات معاملة قاعدة بيانات');}
const has=(u,key)=>u.caps.includes(key);
const isManagerOf=(db,u,userId)=>!!db.prepare('SELECT 1 FROM users WHERE id=? AND tenant_id=? AND manager_id=? AND active=1').get(userId,u.tenant_id,u.id);
const seesMoney=u=>has(u,'hr.discipline.decide')||has(u,'payroll.prepare')||has(u,'payroll.approve');

// م126/2: المدد «عدا أيام العطل الرسمية» — أيام تقويمية تُستبعد منها العطل الرسمية المعتمدة فقط، لا الجمعة والسبت.
export function addDaysExcludingHolidays(from,days,holidays){
  let day=from;
  for(let left=days,guard=0;left>0&&guard<5000;guard++){day=addDays(day,1);if(!holidays.has(day))left--;}
  return day;
}

// ---------- الجزاءات ----------
// الصيغة المخزنة: 'warning' | 'fine:<bp>' (10000 = أجر يوم) | 'deprivation' | 'dismissal_award' | 'dismissal_no_award'.
export function parsePenalty(token){
  if(token===null||token===undefined)return null;
  if(typeof token!=='string')fail(400,'penalty','الجزاء غير صالح');
  const fine=/^fine:(\d{1,6})$/.exec(token);
  if(fine){const bp=Number(fine[1]);if(bp<1||bp>50000)fail(400,'penalty','الغرامة من 0.01% إلى أجر خمسة أيام (م116)');return {kind:'fine',day_bp:bp};}
  if(!PENALTY_KINDS.includes(token)||token==='fine')fail(400,'penalty','الجزاء غير صالح');
  return {kind:token,day_bp:0};
}
export const tokenOf=p=>p.kind==='fine'?`fine:${p.day_bp}`:p.kind;
export const severity=p=>PENALTY_KINDS.indexOf(p.kind)*100000+(p.kind==='fine'?p.day_bp:0);
export const isMinor=(p,params)=>p.kind==='warning'||(p.kind==='fine'&&p.day_bp<=params.minor_max_day_bp);
// D-10: الوحدة المخزنة جزء من عشرة آلاف من الأجر اليومي (10000 = أجر يوم)، فالنسبة المئوية = bp/100.
// الصيغة السابقة كانت تبتر أصفار العدد الصحيح مع كسوره: 5000 (50%) تُطبع «5%» كغرامة 500 (5%)، و1000 (10%) تُطبع «1%».
// هنا يُفصل الجزء الصحيح عن كسره، ولا يُحذف إلا صفر الكسر الأخير: 5000→«50»، 1000→«10»، 250→«2.5»، 205→«2.05»، 1→«0.01».
const pct=bp=>{const whole=Math.floor(bp/100),frac=bp%100;return frac?`${whole}.${String(frac).padStart(2,'0').replace(/0$/,'')}`:String(whole);};
export function penaltyLabel(p,lang='ar'){
  if(!p)return lang==='ar'?'لا جزاء':'No penalty';
  const ar=lang==='ar';
  if(p.kind==='warning')return ar?'إنذار كتابي':'Written warning';
  if(p.kind==='fine'){
    if(p.day_bp%10000===0){const d=p.day_bp/10000;return ar?(d===1?'غرامة أجر يوم واحد':d===2?'غرامة أجر يومين':`غرامة أجر ${d} أيام`):`Fine of ${d} day${d===1?'':'s'}’ wage`;}
    return ar?`غرامة ${pct(p.day_bp)}% من الأجر اليومي`:`Fine of ${pct(p.day_bp)}% of the daily wage`;
  }
  if(p.kind==='deprivation')return ar?'الحرمان من الترقية أو العلاوة الدورية لمرة واحدة (مدة أقصاها سنة، م111/4)':'Loss of the next promotion or periodic increment, once (up to one year, Art. 111(4))';
  if(p.kind==='dismissal_award')return ar?'الفصل من الخدمة مع المكافأة (م111/5)':'Dismissal with end-of-service award (Art. 111(5))';
  return ar?'الفصل دون مكافأة أو إشعار أو تعويض وفق المادة 80 من نظام العمل (م111/6)':'Dismissal without award, notice or compensation under Labour Law Art. 80 (Art. 111(6))';
}
// الجزاء المقرر لرقم التكرار: بعد آخر خانة في الجدول تبقى آخر عقوبة مقررة؛ الخانة الفارغة لا تُملأ.
export function penaltyFor(row,occurrence){
  let index=Math.min(occurrence,row.penalties.length)-1;
  while(index>0&&row.penalties[index]===null)index--;
  return parsePenalty(row.penalties[index]);
}

// ---------- جدول الجزاءات ----------
function checkParameters(p){
  const int=(value,label,min,max)=>{if(!Number.isInteger(value)||value<min||value>max)fail(400,'schedule_parameters',`${label}: عدد صحيح بين ${min} و${max}`);};
  if(!p||typeof p!=='object'||!Array.isArray(p.rows)||!p.rows.length)fail(400,'schedule_parameters','الجدول بلا بنود');
  int(p.repeat_window_days,'نافذة التكرار (م114)',1,3650);int(p.fine_cap_days_per_violation,'سقف الغرامة للمخالفة (م116)',1,5);int(p.monthly_fine_cap_days,'سقف الغرامات في الشهر (م116)',1,5);
  int(p.minor_max_day_bp,'حد المخالفة البسيطة (م117)',0,10000);int(p.investigation_limit_days,'مهلة بدء التحقيق (م119)',1,30);int(p.decision_limit_days,'مهلة توقيع الجزاء (م120)',1,30);
  int(p.grievance_filing_days,'مهلة التظلم (م126)',30,365);int(p.grievance_answer_days,'مهلة الرد على التظلم (م126)',1,15);int(p.defence_wait_days,'مهلة تقديم الدفاع',1,30);int(p.day_basis_days,'أساس اليوم',28,31);
  if(!Array.isArray(p.wage_components)||!p.wage_components.length||p.wage_components.some(c=>!PAY_COMPONENTS.some(x=>x.key===c)))fail(400,'schedule_parameters','بنود الأجر اليومي من قائمة بنود الراتب');
  const seen=new Set();
  for(const row of p.rows){
    if(!/^[ABC]\d\d$/.test(row?.code??'')||seen.has(row.code))fail(400,'schedule_parameters',`رمز بند غير صالح أو مكرر: ${row?.code}`);seen.add(row.code);
    if(typeof row.ar!=='string'||row.ar.length<5||typeof row.en!=='string'||typeof row.article_ar!=='string')fail(400,'schedule_parameters',`${row.code}: الوصف والسند مطلوبان`);
    if(!Array.isArray(row.penalties)||!row.penalties.length||row.penalties.length>4||row.penalties[0]===null)fail(400,'schedule_parameters',`${row.code}: من عقوبة إلى أربع`);
    // خانة الحسم الإضافي: إما خالية (البند بلا «عقوبة مشتركة» في الصفحة الموقعة) وإما إحدى القيم الثلاث المعروفة.
    if((row.extra_deduction??null)!==null&&!Object.hasOwn(EXTRA_DEDUCTIONS,row.extra_deduction))fail(400,'schedule_parameters',`${row.code}: خانة الحسم الإضافي إما فارغة وإما من قيم الجدول المعروفة`);
    for(const token of row.penalties){if(token===null)continue;const pen=parsePenalty(token);if(pen.kind==='fine'&&pen.day_bp>p.fine_cap_days_per_violation*10000)fail(400,'fine_cap',`${row.code}: الغرامة لا تتجاوز أجر ${p.fine_cap_days_per_violation} أيام للمخالفة الواحدة (م116)`);}
  }
  return p;
}
const scheduleRowById=(db,tenantId,scheduleId)=>typeof scheduleId==='string'?db.prepare('SELECT * FROM discipline_schedules WHERE id=? AND (tenant_id=? OR tenant_id IS NULL)').get(scheduleId,tenantId)??null:null;
// الجدول الساري في تاريخ المخالفة: نسخة الكيان المقبولة الأحدث سريانًا. مستخرج المنصة وحده لا يسري أبدًا.
export function acceptedSchedule(db,tenantId,date){
  return db.prepare("SELECT * FROM discipline_schedules WHERE tenant_id=? AND status='accepted' AND effective_from<=? ORDER BY effective_from DESC,decided_at DESC LIMIT 1").get(tenantId,date)??null;
}
const paramsOf=row=>JSON.parse(row.parameters);
const rowOf=(params,code)=>params.rows.find(r=>r.code===code)??null;
function scheduleView(db,u,s){
  const p=paramsOf(s),confirmations=JSON.parse(s.confirmations),actions=[];
  if(has(u,'hr.policy.prepare'))actions.push('prepare_schedule');
  if(has(u,'hr.policy.accept')&&s.status==='draft'&&s.prepared_by!==u.id)actions.push('accept_schedule');
  if(has(u,'hr.policy.accept')&&s.status==='draft'&&s.tenant_id)actions.push('reject_schedule');
  return {id:s.id,platform_extract:!s.tenant_id,title:s.title,basis:s.basis,status:s.status,effective_from:s.effective_from,version:s.version,
    prepared_by_name:s.tenant_id?userName(db,s.prepared_by)??'مستخرج المنصة':'مستخرج المنصة',decided_by_name:userName(db,s.decided_by),decided_at:s.decided_at,decision_note:s.decision_note,
    settings:{repeat_window_days:p.repeat_window_days,fine_cap_days_per_violation:p.fine_cap_days_per_violation,monthly_fine_cap_days:p.monthly_fine_cap_days,minor_max_day_bp:p.minor_max_day_bp,
      investigation_limit_days:p.investigation_limit_days,decision_limit_days:p.decision_limit_days,grievance_filing_days:p.grievance_filing_days,grievance_answer_days:p.grievance_answer_days,
      defence_wait_days:p.defence_wait_days,day_basis_days:p.day_basis_days,wage_components:p.wage_components},
    articles:p.articles??{},open_values:p.open_values??[],
    uncertain:(p.uncertain??[]).map(x=>({...x,confirmation:confirmations[x.id]??null})),
    rows:p.rows.map(r=>({code:r.code,table:r.table,item:r.item,page:r.page,ar:r.ar,en:r.en,article_ar:r.article_ar,article_en:r.article_en,note_ar:r.note_ar,note_en:r.note_en,
      penalties:r.penalties.map(t=>t===null?null:{token:t,ar:penaltyLabel(parsePenalty(t),'ar'),en:penaltyLabel(parsePenalty(t),'en')}),
      extra_deduction:r.extra_deduction??null,
      extra_deduction_ar:EXTRA_DEDUCTIONS[r.extra_deduction]?.[0]??'',extra_deduction_en:EXTRA_DEDUCTIONS[r.extra_deduction]?.[1]??'',
      uncertain:r.uncertain})),
    actions};
}
export function prepareSchedule(db,supplied,input){
  writing(db);const u=actor(db,supplied);if(!has(u,'hr.policy.prepare'))fail(403,'not_permitted','إعداد جدول الجزاءات لمن يملك إعداد سياسات الموارد البشرية');
  v.object(input,['source_id','title','basis','effective_from','changes','settings','confirmations']);
  const source=scheduleRowById(db,u.tenant_id,input.source_id);
  if(!source)fail(404,'not_found','الجدول المصدر غير متاح');
  const params=structuredClone(paramsOf(source));
  const changes=input.changes===undefined?[]:input.changes;
  if(!Array.isArray(changes)||changes.length>200)fail(400,'changes','التعديلات قائمة بنود');
  const extraChanges=[];
  for(const change of changes){
    v.object(change,['code','occurrence','penalty','extra_deduction']);
    const row=rowOf(params,change.code);if(!row)fail(400,'changes',`بند غير موجود: ${change.code}`);
    // تصحيح خانة «العقوبة المشتركة» بعد مطابقة الصفحة الموقعة. الإزالة (null) متاحة كالإضافة تمامًا،
    // لأن خطأ الاستخراج الذي يكلف الموظف مالًا هو خانة أُضيفت إلى بند لا تطبعها الصفحة تحته.
    if(Object.hasOwn(change,'extra_deduction')){
      if(change.occurrence!==undefined||change.penalty!==undefined)fail(400,'changes',`${change.code}: خانة الحسم الإضافي تُصحح في بند مستقل عن خانات التكرار`);
      const value=change.extra_deduction;
      if(value!==null&&!Object.hasOwn(EXTRA_DEDUCTIONS,value))fail(400,'changes',`${change.code}: خانة الحسم الإضافي إما فارغة وإما من قيم الجدول المعروفة`);
      if((row.extra_deduction??null)!==value)extraChanges.push({code:row.code,from:row.extra_deduction??null,to:value});
      row.extra_deduction=value;
      continue;
    }
    if(!Number.isInteger(change.occurrence)||change.occurrence<1||change.occurrence>4)fail(400,'changes','رقم التكرار من 1 إلى 4');
    while(row.penalties.length<change.occurrence)row.penalties.push(null);
    row.penalties[change.occurrence-1]=change.penalty===null?null:tokenOf(parsePenalty(change.penalty));
    while(row.penalties.length>1&&row.penalties.at(-1)===null)row.penalties.pop();
  }
  // القيم التي لم تحددها اللائحة (مهلة الدفاع وبنود الأجر اليومي) يحددها معد النسخة؛ ما حددته اللائحة لا يُضعف هنا.
  if(input.settings!==undefined){
    const s=v.object(input.settings,['defence_wait_days','wage_components']);
    if(s.defence_wait_days!==undefined)params.defence_wait_days=s.defence_wait_days;
    if(s.wage_components!==undefined)params.wage_components=Array.isArray(s.wage_components)?[...new Set(s.wage_components)]:s.wage_components;
  }
  checkParameters(params);
  const confirmations=input.confirmations===undefined?{}:v.object(input.confirmations,(params.uncertain??[]).map(x=>x.id));
  for(const [key,value] of Object.entries(confirmations))confirmations[key]=v.text(value,`تأكيد الخانة ${key} من ملف PDF الموقع`,1000,10);
  const scheduleId=id();
  db.prepare("INSERT INTO discipline_schedules(id,tenant_id,source_id,title,basis,parameters,confirmations,effective_from,status,prepared_by,created_at) VALUES(?,?,?,?,?,?,?,?,'draft',?,?)")
    .run(scheduleId,u.tenant_id,source.id,v.text(input.title,'عنوان الجدول',180,3),v.text(input.basis,'السند (اللائحة ورقم اعتمادها)',2000,10),JSON.stringify(params),JSON.stringify(confirmations),input.effective_from?v.date(input.effective_from):null,u.id,now());
  // التدقيق يحمل خانات الحسم الإضافي بعينها (البند وما كان وما صار)، لأنها الخانة التي تمس أجر الموظف مباشرة.
  audit(db,u,'discipline_schedule',scheduleId,'discipline_schedule.prepared',{}, {source_id:source.id,changes:changes.length,extra_deduction_changes:extraChanges});
  return {id:scheduleId};
}
export function decideSchedule(db,supplied,scheduleId,decision,input){
  writing(db);const u=actor(db,supplied);if(!has(u,'hr.policy.accept'))fail(403,'not_permitted','قبول جدول الجزاءات لمدير الموارد البشرية (hr.policy.accept)');
  v.object(input,['effective_from','note','version']);
  if(!['accept','reject'].includes(decision))fail(404,'not_found','الإجراء غير متاح');
  const s=scheduleRowById(db,u.tenant_id,scheduleId);
  if(!s||s.status!=='draft')fail(404,'not_found','الجدول غير متاح للقرار');
  if(s.prepared_by===u.id)fail(409,'separation_of_duties','من أعد نسخة الجدول لا يقبلها');
  const note=v.text(input.note,'أساس القرار',2000,10),time=now();
  checkParameters(paramsOf(s));
  if(!s.tenant_id){
    // قبول مستخرج المنصة نسخة للكيان؛ المستخرج نفسه يبقى مسودة كما هو.
    if(decision!=='accept')fail(409,'platform_extract','مستخرج المنصة لا يُرفض؛ يكفي ألا يُقبل، أو أعد نسخة معدلة منه');
    if(db.prepare("SELECT 1 FROM discipline_schedules WHERE tenant_id=? AND source_id=? AND status='accepted'").get(u.tenant_id,s.id))
      fail(409,'already_adopted','اعتمد كيانك نسخته من مستخرج المنصة من قبل. لتغيير الجدول أعدّ نسخة معدلة منه ليعتمدها شخص آخر');
    const acceptedId=id();
    db.prepare("INSERT INTO discipline_schedules(id,tenant_id,source_id,title,basis,parameters,confirmations,effective_from,status,prepared_by,decided_by,decided_at,decision_note,created_at) VALUES(?,?,?,?,?,?,?,?,'accepted',NULL,?,?,?,?)")
      .run(acceptedId,u.tenant_id,s.id,s.title,s.basis,s.parameters,s.confirmations,v.date(input.effective_from),u.id,time,note,time);
    audit(db,u,'discipline_schedule',acceptedId,'discipline_schedule.accepted',{}, {source_id:s.id,effective_from:input.effective_from});
    return {id:acceptedId,status:'accepted'};
  }
  v.version(input.version,s.version);
  const status=decision==='accept'?'accepted':'rejected',effective=decision==='accept'?v.date(input.effective_from??s.effective_from):s.effective_from;
  db.prepare('UPDATE discipline_schedules SET status=?,effective_from=?,decided_by=?,decided_at=?,decision_note=?,version=version+1 WHERE id=?').run(status,effective,u.id,time,note,s.id);
  audit(db,u,'discipline_schedule',s.id,'discipline_schedule.'+status,{status:'draft'},{status,effective_from:effective});
  return {id:s.id,status};
}

// ---------- التكرار (م114) ----------
// التكرار سلسلة: المخالفة تكرار إن لم تمض 180 يومًا على سابقتها من البند نفسه، وترتيبها ترتيب سابقتها زائدًا واحدًا.
// إن مضت 180 يومًا على السابقة عُدت أولى. يُعد ما حُسم بجزاء قائم (لا ما أُلغي بالتظلم)، ويُضاف عند التسجيل المفتوح قبلها احتياطًا.
export function occurrenceOf(db,tenantId,userId,code,actDate,window,{excludeCase=null,createdBefore=null,includeOpen=false}={}){
  const statuses=includeOpen?[...COUNTED,...OPEN]:COUNTED;
  const rows=db.prepare(`SELECT v.act_date FROM discipline_violations v JOIN discipline_cases c ON c.id=v.case_id
    WHERE v.tenant_id=? AND v.user_id=? AND v.code=? AND c.id<>? AND c.status IN (${statuses.map(()=>'?').join(',')})
      AND (v.act_date<? OR (v.act_date=? AND c.created_at<?))
      AND NOT EXISTS(SELECT 1 FROM discipline_grievances g WHERE g.case_id=c.id AND g.outcome='upheld')
    ORDER BY v.act_date DESC`).all(tenantId,userId,code,excludeCase??'',...statuses,actDate,actDate,createdBefore??'9999');
  let occurrence=1,previous=actDate;
  for(const r of rows){if(daysBetween(r.act_date,previous)<=window){occurrence++;previous=r.act_date;}else break;}
  return occurrence;
}
// م115: فعل واحد خالف أكثر من بند — يُكتفى بالأشد.
function harshest(list){return list.reduce((best,x)=>!best||severity(x.penalty)>severity(best.penalty)?x:best,null);}

// ---------- القضية ----------
const caseRow=(db,u,caseId)=>typeof caseId==='string'?db.prepare('SELECT * FROM discipline_cases WHERE id=? AND tenant_id=?').get(caseId,u.tenant_id)??null:null;
const grievanceOf=(db,caseId)=>db.prepare('SELECT * FROM discipline_grievances WHERE case_id=?').get(caseId)??null;
const fineOf=(db,caseId)=>db.prepare('SELECT * FROM discipline_fines WHERE case_id=?').get(caseId)??null;
// الجزاء النافذ بعد التظلم: القبول يلغيه، والتخفيف يحل محله.
function effectivePenalty(c,g){
  if(!c.decided_penalty)return null;
  if(g?.outcome==='upheld')return null;
  if(g?.outcome==='reduced')return JSON.parse(g.new_penalty);
  return JSON.parse(c.decided_penalty);
}
function event(db,u,c,kind,body=''){db.prepare('INSERT INTO discipline_events(id,tenant_id,case_id,actor_id,kind,body,created_at) VALUES(?,?,?,?,?,?,?)').run(id(),c.tenant_id,c.id,u.id,kind,body,now());}
// إشعار صاحب الشأن داخل معاملة الخطوة نفسها. لا مبالغ ولا نص اتهام في الإشعار؛ التفاصيل في صفحته.
function tell(db,c,kind,title,body){notifySubject(db,{userId:c.user_id,kind:'discipline_'+kind,subjectKind:'discipline_case',subjectId:c.id,title,body});}

// السند المعروض مع كل مهلة: رقم المادة حين تنص اللائحة على المدة نفسها، و«مهلة تحددها الشركة» حين لا تنص.
// م117 توجب الإبلاغ الكتابي وسماع الأقوال وتحقيق الدفاع في محضر، ولا تحدد لتقديم الدفاع مدة؛ فمدتها قرار شركة
// (وهي في open_values من أول يوم)، ونسبتها إلى م117 كانت تنسب إلى اللائحة ما ليس فيها.
const COMPANY_PERIOD=['مهلة تحددها الشركة','A company-set period'];
function deadlinesOf(c,params,g,holidays,asOf){
  const out=[],add=(key,article,due,ar,en,basis=null)=>{const left=daysBetween(asOf,due);
    out.push({key,article,company_value:!article,basis_ar:basis?.[0]??article,basis_en:basis?.[1]??article,due_on:due,days_left:left,overdue:left<0,ar,en});};
  if(c.status==='recorded')add('investigation','م119',addDays(c.discovered_on,params.investigation_limit_days),'آخر يوم لبدء التحقيق، وإلا سقطت المساءلة','Last day to start the investigation, or accountability lapses');
  if(c.status==='investigating'&&c.process==='written'&&!c.defence_text)add('defence','',addDays(c.charge_delivered_on,params.defence_wait_days),
    'مهلة الدفاع المكتوب — مدة تحددها الشركة لا اللائحة؛ بعدها يجوز إنهاء التحقيق دون دفاع. م117 توجب الإبلاغ الكتابي وسماع الأقوال وتحقيق الدفاع في محضر ولا تحدد لذلك مدة',
    'Written-defence window — a period set by the company, not by the regulations; after it the investigation may close without a defence. Art. 117 requires the written notice, the hearing, the examination of the defence and a minute, but sets no period',COMPANY_PERIOD);
  if(c.status==='proven')add('decision','م120',addDays(c.proven_on,params.decision_limit_days),'آخر يوم لتوقيع الجزاء بعد ثبوت المخالفة','Last day to impose a penalty after the violation was proven');
  if(c.status==='notified'&&!g)add('grievance_filing','م126/2',addDaysExcludingHolidays(c.notified_on,params.grievance_filing_days,holidays),'آخر يوم لتقديم التظلم (عدا العطل الرسمية)','Last day to file a grievance (official holidays excluded)');
  if(g?.status==='filed')add('grievance_answer','م126/2',g.answer_due_on,'آخر يوم للرد على التظلم (عدا العطل الرسمية)','Last day to answer the grievance (official holidays excluded)');
  return out;
}

function violationsOf(db,c,params){
  return db.prepare('SELECT * FROM discipline_violations WHERE case_id=? ORDER BY code').all(c.id).map(x=>{const row=rowOf(params,x.code),pen=JSON.parse(x.penalty);
    return {code:x.code,occurrence:x.occurrence,ar:row?.ar??x.code,en:row?.en??x.code,article_ar:row?.article_ar??'',article_en:row?.article_en??'',
      extra_deduction:row?.extra_deduction??null,uncertain:row?.uncertain??null,note_ar:row?.note_ar??'',penalty:pen,penalty_ar:penaltyLabel(pen,'ar'),penalty_en:penaltyLabel(pen,'en')};});
}
// من يرى القضية وبأي عمق: صاحب الشأن كاملة؛ الموارد البشرية وصاحب الصلاحية كاملة (نص التظلم لصاحب الصلاحية وحده)؛
// مُصدِر الخطابات ما حُسم منها ليصدر الإشعار، ومُعد الرواتب ما عليه غرامة ليقترح خصمها، والمدير المباشر فريقه — ثلاثتهم ملخصًا بلا نصوص.
// غيرهم لا يعرف أنها موجودة (404).
function access(db,u,c){
  if(c.user_id===u.id)return 'subject';
  if(has(u,'hr.discipline.propose')||has(u,'hr.discipline.decide'))return 'hr';
  if(has(u,'hr.letters.issue')&&COUNTED.includes(c.status))return 'letters';
  if((has(u,'payroll.prepare')||has(u,'payroll.approve'))&&fineOf(db,c.id))return 'payroll';
  if(c.recorded_by===u.id||isManagerOf(db,u,c.user_id))return 'manager';
  return null;
}
const LEVEL_ACTIONS={letters:['issue_notice','record_delivery'],payroll:['propose_deduction'],manager:['withdraw']};
function actionsFor(db,u,c,level,params,g,fine,asOf){
  const out=[],hr=has(u,'hr.discipline.propose'),decider=has(u,'hr.discipline.decide'),own=c.user_id===u.id;
  if(own){
    if(c.status==='investigating'&&!c.defence_text)out.push('submit_defence');
    if(c.status==='notified'&&!g&&asOf<=addDaysExcludingHolidays(c.notified_on,params.grievance_filing_days,holidaySet(db,c.tenant_id))&&effectivePenalty(c,g))out.push('file_grievance');
    return out;
  }
  const investigationDue=addDays(c.discovered_on,params.investigation_limit_days),decisionDue=c.proven_on?addDays(c.proven_on,params.decision_limit_days):null;
  if(hr&&c.status==='recorded'&&asOf<=investigationDue)out.push('open_investigation');
  if(hr&&c.status==='investigating'&&c.process==='written'&&!c.hearing_minutes)out.push('record_hearing');
  if(hr&&c.status==='investigating')out.push('conclude');
  if(decider&&c.status==='proven'&&c.recorded_by!==u.id&&asOf<=decisionDue)out.push('decide');
  if(has(u,'hr.letters.issue')&&c.status==='decided'&&!c.notice_request_id&&c.decided_by!==u.id)out.push('issue_notice');
  if((hr||has(u,'hr.letters.issue'))&&c.status==='decided'&&c.notice_request_id)out.push('record_delivery');
  if(decider&&g?.status==='filed'&&c.recorded_by!==u.id)out.push('answer_grievance');
  if(has(u,'payroll.prepare')&&c.status==='notified'&&fine?.status==='open'&&g?.status!=='filed'&&fineOutstanding(db,fine)>0)out.push('propose_deduction');
  // المسجِّل من خارج الموارد البشرية يسحب ما سجله قبل بدء التحقيق فقط.
  if((hr&&OPEN.includes(c.status))||(!hr&&c.recorded_by===u.id&&c.status==='recorded'))out.push('withdraw');
  if(hr&&((c.status==='recorded'&&asOf>investigationDue)||(c.status==='proven'&&asOf>decisionDue)))out.push('close_lapsed');
  return level==='hr'?out:out.filter(a=>LEVEL_ACTIONS[level]?.includes(a));
}
function fineOutstanding(db,fine){
  if(!fine||fine.status!=='open')return 0;
  const used=db.prepare("SELECT COALESCE(SUM(d.day_bp),0) AS n FROM discipline_fine_deductions d JOIN payroll_adjustments a ON a.id=d.adjustment_id WHERE d.fine_id=? AND a.status<>'rejected'").get(fine.id).n;
  return fine.day_bp-used;
}

// D-11: القضية كانت تتجمد عند «صدر القرار» بلا إشعار م121 ولا أي بيان بما ينقص، فلا تبدأ مهلة التظلم.
// الحالة نفسها تقول الآن ما الناقص ومن يوفّره، ويقرؤه صاحب الشأن كما تقرؤه الموارد البشرية.
const ACTION_NAMES={open_investigation:'بدء التحقيق',record_hearing:'تسجيل محضر الجلسة',submit_defence:'تقديم الدفاع',conclude:'إنهاء التحقيق',decide:'توقيع الجزاء',
  issue_notice:'إصدار الإشعار الكتابي (م121)',record_delivery:'تسجيل الإبلاغ',file_grievance:'تقديم تظلم',answer_grievance:'الرد على التظلم',
  propose_deduction:'اقتراح خصم الغرامة',withdraw:'سحب القضية',close_lapsed:'إغلاق بمضي المدة'};
function noticeGate(db,c){
  if(c.status!=='decided'||c.notice_request_id)return null;
  const gap=templateGap(db,c.tenant_id,'discipline_notice');
  if(gap.ready)return {ready:true,blocked:false,text:'قالب إشعار الجزاء معتمد؛ يصدر الإشعار من يملك إصدار الخطابات وليس من قرر الجزاء.'};
  return {ready:false,blocked:true,step:gap.step,capability:gap.capability,who:gap.who,holders:gap.holders,
    placeholders:gap.placeholders,text:gap.message,
    consequence:'لا يبدأ سريان مهلة التظلم (م126) ولا يُقترح خصم الغرامة قبل الإبلاغ الكتابي بالجزاء (م121).'};
}
function caseView(db,u,c,level,asOf=today()){
  const schedule=db.prepare('SELECT * FROM discipline_schedules WHERE id=?').get(c.schedule_id),params=paramsOf(schedule);
  const g=grievanceOf(db,c.id),fine=fineOf(db,c.id),holidays=holidaySet(db,c.tenant_id);
  const proposed=JSON.parse(c.proposed_penalty),decided=c.decided_penalty?JSON.parse(c.decided_penalty):null,effective=effectivePenalty(c,g);
  const base={id:c.id,reference:c.reference,user_id:c.user_id,employee_name:userName(db,c.user_id),act_date:c.act_date,discovered_on:c.discovered_on,
    status:c.status,status_ar:STATUS_NAMES[c.status][0],status_en:STATUS_NAMES[c.status][1],version:c.version,own:c.user_id===u.id,level,
    violations:violationsOf(db,c,params),
    proposed:{...proposed,ar:penaltyLabel(proposed,'ar'),en:penaltyLabel(proposed,'en'),minor:isMinor(proposed,params)},
    decided:decided?{...decided,ar:penaltyLabel(decided,'ar'),en:penaltyLabel(decided,'en')}:null,
    effective:effective?{...effective,ar:penaltyLabel(effective,'ar'),en:penaltyLabel(effective,'en')}:null,
    grievance_status:g?g.status:null,grievance_outcome:g?.outcome??null,
    deadlines:FINAL.includes(c.status)?[]:deadlinesOf(c,params,g,holidays,asOf),
    notice_gate:noticeGate(db,c),
    actions:actionsFor(db,u,c,level,params,g,fine,asOf)};
  if(level!=='hr'&&level!=='subject')return base;
  const letter=c.notice_request_id?db.prepare('SELECT id,reference,issued_on FROM letters WHERE request_id=?').get(c.notice_request_id):null;
  const full={...base,full:true,description:c.description,source_kind:c.source_kind,source_ar:SOURCE_KINDS[c.source_kind][0],source_en:SOURCE_KINDS[c.source_kind][1],source_ref:c.source_ref,source_snapshot:JSON.parse(c.source_snapshot),
    recorded_by_name:userName(db,c.recorded_by),process:c.process,charge_text:c.charge_text,charge_delivered_on:c.charge_delivered_on,investigated_by_name:userName(db,c.investigated_by),
    hearing_on:c.hearing_on,hearing_minutes:c.hearing_minutes,hearing_by_name:userName(db,c.hearing_by),defence_text:c.defence_text,defence_at:c.defence_at,
    finding:c.finding,finding_note:c.finding_note,proven_on:c.proven_on,found_by_name:userName(db,c.found_by),
    decided_by_name:userName(db,c.decided_by),decided_at:c.decided_at,decision_note:c.decision_note,lighter_reason:c.lighter_reason,
    notice:letter?{letter_id:letter.id,reference:letter.reference,issued_on:letter.issued_on,print_path:`/api/letters/${letter.id}/print`}:null,
    delivery:c.delivery_method||c.refused_to_sign?{method:c.delivery_method,method_ar:DELIVERY_METHODS[c.delivery_method]?.[0]??'',method_en:DELIVERY_METHODS[c.delivery_method]?.[1]??'',reference:c.delivery_reference,delivered_on:c.delivered_on,refused_to_sign:!!c.refused_to_sign}:null,
    notified_on:c.notified_on,closing_note:c.closing_note,
    fine:fine?{day_bp:fine.day_bp,status:fine.status,outstanding_bp:fineOutstanding(db,fine)}:null,
    events:db.prepare('SELECT kind,body,actor_id,created_at FROM discipline_events WHERE case_id=? ORDER BY created_at').all(c.id).map(ev=>({kind:ev.kind,body:ev.body,actor_name:userName(db,ev.actor_id),created_at:ev.created_at})),
    can_upload_evidence:!FINAL.includes(c.status)&&c.user_id!==u.id&&(has(u,'hr.discipline.propose')||c.recorded_by===u.id)};
  // نص التظلم لصاحبه ولصاحب الصلاحية فقط؛ تقديم التظلم لا يصل إلى المدير ولا إلى غير المختص (م126: لا يُضار العامل).
  if(g&&(c.user_id===u.id||has(u,'hr.discipline.decide')))full.grievance={body:g.body,filed_on:g.filed_on,answer_due_on:g.answer_due_on,status:g.status,outcome:g.outcome,answer:g.answer,answered_on:g.answered_on,answered_by_name:userName(db,g.answered_by),
    new_penalty:g.new_penalty?{...JSON.parse(g.new_penalty),ar:penaltyLabel(JSON.parse(g.new_penalty),'ar'),en:penaltyLabel(JSON.parse(g.new_penalty),'en')}:null,
    court_note:g.outcome==='rejected'||(g.status==='filed'&&asOf>g.answer_due_on)?'للعامل الاعتراض أمام المحكمة العمالية خلال 30 يومًا (عدا العطل الرسمية) من رفض تظلمه أو انقضاء مدة البت فيه، أيهما أقرب (م126/2).':''};
  if(level==='hr'&&c.status==='proven'&&has(u,'hr.discipline.decide'))full.decision_options=decisionOptions(db,c,params);
  return full;
}
function visibleCase(db,u,caseId){
  const c=caseRow(db,u,caseId),level=c&&access(db,u,c);
  if(!c||!level)fail(404,'not_found','القضية غير متاحة');
  return {c,level};
}
export function getCase(db,supplied,caseId){const u=actor(db,supplied),{c,level}=visibleCase(db,u,caseId);return caseView(db,u,c,level);}
// للملفات: الأدلة يراها من يرى القضية كاملة، ويرفعها المسجِّل أو الموارد البشرية ما دامت القضية مفتوحة.
export function caseFileAccess(db,supplied,caseId){
  const u=actor(db,supplied),{c,level}=visibleCase(db,u,caseId);
  if(level!=='hr'&&level!=='subject'&&c.recorded_by!==u.id)fail(404,'not_found','القضية غير متاحة');
  return {canUpload:!FINAL.includes(c.status)&&c.user_id!==u.id&&(has(u,'hr.discipline.propose')||c.recorded_by===u.id),canRestricted:false};
}

// الجزاء الأقصى المسموح عند القرار: الأشد بين البنود بتكرارها المحسوم الآن، ولا يتجاوز ما وُجه به الموظف في التحقيق.
function maximumPenalty(db,c,params){
  const proposed=JSON.parse(c.proposed_penalty);
  const now_=db.prepare('SELECT code,act_date FROM discipline_violations WHERE case_id=?').all(c.id).map(x=>{
    const occurrence=occurrenceOf(db,c.tenant_id,c.user_id,x.code,x.act_date,params.repeat_window_days,{excludeCase:c.id,createdBefore:c.created_at});
    return {code:x.code,occurrence,penalty:penaltyFor(rowOf(params,x.code),occurrence)};
  });
  const top=harshest(now_);
  return {max:severity(top.penalty)<=severity(proposed)?{...top.penalty,code:top.code,occurrence:top.occurrence}:proposed,violations:now_};
}
const STANDARD_FINES=[500,1000,1500,2000,2500,3000,5000,7500,10000,20000,30000,40000,50000];
function decisionOptions(db,c,params){
  const {max}=maximumPenalty(db,c,params),cap=params.fine_cap_days_per_violation*10000;
  const all=[{kind:'warning',day_bp:0},...STANDARD_FINES.filter(bp=>bp<=cap).map(bp=>({kind:'fine',day_bp:bp})),{kind:'deprivation',day_bp:0},{kind:'dismissal_award',day_bp:0},{kind:'dismissal_no_award',day_bp:0}];
  if(max.kind==='fine'&&!STANDARD_FINES.includes(max.day_bp))all.push({kind:'fine',day_bp:max.day_bp});
  return {max:{...max,ar:penaltyLabel(max,'ar'),en:penaltyLabel(max,'en')},
    choices:all.filter(p=>severity(p)<=severity(max)).sort((a,b)=>severity(b)-severity(a)).map(p=>({token:tokenOf(p),ar:penaltyLabel(p,'ar'),en:penaltyLabel(p,'en'),lighter:severity(p)<severity(max)}))};
}

// ---------- تسجيل المخالفة ----------
export function recordViolation(db,supplied,input){
  writing(db);const u=actor(db,supplied);
  v.object(input,['user_id','codes','act_date','discovered_on','description','source_kind','source_ref']);
  const subject=typeof input.user_id==='string'&&db.prepare("SELECT id,tenant_id,name FROM users WHERE id=? AND tenant_id=? AND active=1 AND role<>'admin'").get(input.user_id,u.tenant_id);
  if(!subject)fail(404,'not_found','الموظف غير متاح');
  if(subject.id===u.id)fail(409,'separation_of_duties','لا يسجل أحد مخالفة على نفسه');
  // م124: المدير يرصد مخالفات من تحت إشرافه، والموارد البشرية تتحقق وتطبق.
  if(!has(u,'hr.discipline.propose')&&!isManagerOf(db,u,subject.id))fail(403,'not_permitted','تسجيل المخالفة للموارد البشرية المخولة وللمدير المباشر على فريقه');
  const date=today(),act=v.date(input.act_date),discovered=v.date(input.discovered_on);
  if(act>date||discovered>date)fail(400,'future_date','تاريخ المخالفة وتاريخ العلم بها لا يسبقان اليوم');
  if(discovered<act)fail(400,'date_order','العلم بالمخالفة بعد وقوعها أو في يومها');
  const schedule=acceptedSchedule(db,u.tenant_id,act);
  if(!schedule)fail(409,'schedule_required','لا جدول مخالفات وجزاءات قبله مدير الموارد البشرية ساريًا في تاريخ المخالفة؛ المنصة لا تقترح جزاءً دونه');
  const params=paramsOf(schedule);
  if(daysBetween(discovered,date)>params.investigation_limit_days)fail(409,'time_barred',`مضى أكثر من ${params.investigation_limit_days} يومًا على العلم بالمخالفة دون تحقيق؛ لا تجوز المساءلة عنها (م119)`);
  const codes=Array.isArray(input.codes)?[...new Set(input.codes)]:[];
  if(!codes.length||codes.length>5)fail(400,'codes','اختر بند المخالفة من الجدول (وحتى خمسة بنود إن خالف الفعل الواحد أكثر من بند)');
  for(const code of codes)if(!rowOf(params,code))fail(400,'codes',`البند ${code} ليس في الجدول الساري`);
  if(!Object.hasOwn(SOURCE_KINDS,input.source_kind))fail(400,'source_kind','اختر مصدر الرصد');
  let snapshot={},ref=input.source_ref===undefined||input.source_ref===''?'':v.text(input.source_ref,'مرجع المصدر',200,2);
  if(input.source_kind==='attendance_day'){
    // يوم الحضور دليل يُقرأ ولا يُحكم به: يُثبت ما سجله الحضور لذلك اليوم ويُمنع ما لا يكون مخالفة أصلًا.
    ref=v.date(input.source_ref);if(ref!==act)fail(400,'source_ref','يوم الحضور هو يوم المخالفة');
    const day=dayStates(db,subject,act,act,date)[0];
    if(!day)fail(409,'attendance_day','لا حالة حضور لهذا اليوم');
    if(AWAY_STATES.includes(day.state))fail(409,'attendance_day',`حالة اليوم «${day.state_name}»؛ لا مخالفة في يوم إجازة أو عطلة أو راحة أو مهمة معتمدة`);
    if(codes.some(c=>LATE_CODES.includes(c))&&day.state!=='late')fail(409,'attendance_day',`بنود التأخر تحتاج يومًا مسجلًا «حاضر متأخر»؛ حالة اليوم «${day.state_name}»`);
    // اليوم بلا سجل «يحتاج توضيحًا» فقط (HR-03)؛ الغياب يثبت أولًا بمسار الغياب غير المدفوع بقرار شخصين.
    if(codes.some(c=>ABSENCE_CODES.includes(c))&&day.state!=='unpaid_absence')fail(409,'attendance_day',`بنود الغياب تحتاج غيابًا غير مدفوع معتمدًا؛ حالة اليوم «${day.state_name}»`);
    snapshot={state:day.state,state_name:day.state_name,check_in:day.check_in,check_out:day.check_out,policy_id:day.policy_id};
  }
  const time=now(),caseId=id();
  const violations=codes.map(code=>{const occurrence=occurrenceOf(db,u.tenant_id,subject.id,code,act,params.repeat_window_days,{includeOpen:true,createdBefore:time});return {code,occurrence,penalty:penaltyFor(rowOf(params,code),occurrence)};});
  const top=harshest(violations),proposed={...top.penalty,code:top.code,occurrence:top.occurrence};
  // الرقم يُشتق من أعلى رقم مستعمل، لا من عدد القضايا: العدّ يفترض تتابعًا بلا فجوة ولا شيء في المنصة يفرض هذا الافتراض.
  // اليوم لا فجوة — حارس discipline_cases_no_delete قائم — فالنتيجتان واحدة. لكن أول مسار استيراد أو ترحيل بيانات يُدخل رقمًا خارج التتابع
  // يجعل العدّ يعيد رقمًا مستعملًا، فيسقط الإدراج على UNIQUE(tenant_id,reference) أمام المستخدم. ومرجع القضية سند تُحسب عليه مهلة التظلم (م126).
  const year=date.slice(0,4),serial=db.prepare("SELECT COALESCE(MAX(CAST(substr(reference,8) AS INTEGER)),0)+1 AS n FROM discipline_cases WHERE tenant_id=? AND reference LIKE ?").get(u.tenant_id,`D-${year}-%`).n,reference=`D-${year}-${String(serial).padStart(4,'0')}`;
  db.prepare(`INSERT INTO discipline_cases(id,tenant_id,reference,user_id,schedule_id,act_date,discovered_on,description,source_kind,source_ref,source_snapshot,recorded_by,proposed_penalty,status,created_at,updated_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,'recorded',?,?)`).run(caseId,u.tenant_id,reference,subject.id,schedule.id,act,discovered,v.text(input.description,'وصف الواقعة',3000,10),input.source_kind,ref,JSON.stringify(snapshot),u.id,JSON.stringify(proposed),time,time);
  for(const x of violations)db.prepare('INSERT INTO discipline_violations(id,tenant_id,case_id,user_id,code,act_date,occurrence,penalty) VALUES(?,?,?,?,?,?,?,?)').run(id(),u.tenant_id,caseId,subject.id,x.code,act,x.occurrence,JSON.stringify(x.penalty));
  const c=db.prepare('SELECT * FROM discipline_cases WHERE id=?').get(caseId);
  event(db,u,c,'recorded',`${codes.join('، ')} — الجزاء المقترح: ${penaltyLabel(proposed)}`);
  // التدقيق يحمل البنود والتكرار ولا يحمل وصف الواقعة.
  audit(db,u,'discipline_case',caseId,'discipline.recorded',{}, {user_id:subject.id,codes,reference});
  tell(db,c,'recorded',`سُجلت مخالفة باسمك برقم ${reference}`,'لا جزاء قبل إبلاغك بالاتهام وسماع دفاعك. التفاصيل في «مخالفاتي وجزاءاتي».');
  return {id:caseId,reference,proposed:{...proposed,ar:penaltyLabel(proposed,'ar')},violations:violations.map(x=>({code:x.code,occurrence:x.occurrence,penalty:tokenOf(x.penalty)}))};
}

// ---------- خطوات القضية ----------
const FIELDS={open_investigation:['process','charge_text','charge_delivered_on','minutes','questioned_on'],record_hearing:['hearing_on','minutes'],submit_defence:['defence'],conclude:['finding','note'],
  decide:['penalty','note','lighter_reason'],issue_notice:['note'],record_delivery:['method','delivered_on','reference','refused_to_sign'],file_grievance:['body'],answer_grievance:['outcome','answer','penalty'],
  propose_deduction:['month'],withdraw:['reason'],close_lapsed:['reason']};
export function caseAction(db,supplied,caseId,action,input){
  writing(db);const u=actor(db,supplied);
  const fields=FIELDS[action];if(!fields)fail(404,'not_found','الإجراء غير متاح');
  v.object(input,['version',...fields]);
  const {c,level}=visibleCase(db,u,caseId),date=today();
  v.version(input.version,c.version);
  const view=caseView(db,u,c,level,date);
  // D-14: الرفض يُبنى من الحالة المحسوبة نفسها التي تبني بها الشاشة أزرارها، لا من نص عام.
  if(!view.actions.includes(action))v.actionUnavailable(action,{subject:`القضية ${c.reference}`,state_name:view.status_ar,names:ACTION_NAMES,
    available:view.actions,who:view.notice_gate?.blocked?view.notice_gate.text:null,
    reason:action==='issue_notice'&&c.notice_request_id?'صدر الإشعار الكتابي لهذه القضية مسبقًا'
      :action==='decide'&&c.recorded_by===u.id?'من سجّل المخالفة لا يوقّع جزاءها (فصل المهام)'
      :view.deadlines.some(d=>d.overdue)?`مضت مهلة ${view.deadlines.find(d=>d.overdue).basis_ar}: ${view.deadlines.find(d=>d.overdue).ar}`
      :'الإجراء إما لا تسمح به الحالة، أو لا يحمله تصريحك، أو مضت مدته'});
  const params=paramsOf(db.prepare('SELECT parameters FROM discipline_schedules WHERE id=?').get(c.schedule_id)),time=now();
  const set=(sql,...args)=>db.prepare(`UPDATE discipline_cases SET ${sql},version=version+1,updated_at=? WHERE id=?`).run(...args,time,c.id);
  // خطوة تُكتب في جدول مجاور (التظلم، الخصم) ترفع نسخة القضية أيضًا، فلا يُبنى قرار على صفحة قديمة.
  const bump=()=>db.prepare('UPDATE discipline_cases SET version=version+1,updated_at=? WHERE id=?').run(time,c.id);
  const inRange=(value,label,from)=>{const d=v.date(value);if(d<from||d>date)fail(400,'date_range',`${label} بين ${from} واليوم`);return d;};
  let result={id:c.id};
  if(action==='open_investigation'){
    if(!['written','oral'].includes(input.process))fail(400,'process','اختر إبلاغًا كتابيًا بالاتهام أو استجوابًا شفهيًا');
    const proposed=JSON.parse(c.proposed_penalty);
    // م117 وم126/1: ما فوق غرامة أجر يوم يلزمه اتهام كتابي وتحقيق ومحضر؛ الشفهي للإنذار وغرامة لا تزيد على يوم، ويُثبت في محضر.
    if(input.process==='oral'&&!isMinor(proposed,params))fail(409,'written_required','الجزاء المقترح يتجاوز غرامة أجر يوم؛ يلزم إبلاغ الموظف كتابة بالاتهام وسماع دفاعه في محضر (م117)');
    if(input.process==='written'){
      const delivered=inRange(input.charge_delivered_on,'تاريخ تسليم الاتهام',c.discovered_on);
      set("status='investigating',process='written',charge_text=?,charge_delivered_on=?,investigation_opened_on=?,investigated_by=?",v.text(input.charge_text,'نص الاتهام المكتوب',4000,10),delivered,date,u.id);
      event(db,u,c,'charge',`اتهام كتابي سُلم في ${delivered}`);
      tell(db,c,'charge',`وصلك إشعار كتابي بالاتهام في القضية ${c.reference}`,`اقرأ الاتهام وقدّم دفاعك المكتوب من «مخالفاتي وجزاءاتي» خلال ${params.defence_wait_days} أيام (مهلة تحددها الشركة؛ اللائحة لا تحددها)، وستُدعى لجلسة سماع أقوالك.`);
    }else{
      const questioned=inRange(input.questioned_on,'تاريخ الاستجواب',c.discovered_on);
      set("status='investigating',process='oral',hearing_on=?,hearing_minutes=?,hearing_by=?,investigation_opened_on=?,investigated_by=?",questioned,v.text(input.minutes,'محضر الاستجواب الشفهي وأقوال الموظف',6000,10),u.id,date,u.id);
      event(db,u,c,'questioning',`استجواب شفهي في ${questioned} أُثبت في محضر`);
      tell(db,c,'questioning',`سُجل محضر استجوابك الشفهي في القضية ${c.reference}`,'اقرأ المحضر، ولك أن تضيف دفاعًا مكتوبًا من «مخالفاتي وجزاءاتي».');
    }
  }else if(action==='record_hearing'){
    const hearing=inRange(input.hearing_on,'تاريخ جلسة التحقيق',c.charge_delivered_on);
    set('hearing_on=?,hearing_minutes=?,hearing_by=?',hearing,v.text(input.minutes,'محضر جلسة التحقيق وأقوال الموظف',6000,10),u.id);
    event(db,u,c,'hearing',`جلسة تحقيق في ${hearing} أُثبتت في محضر`);
    tell(db,c,'hearing',`سُجل محضر جلسة التحقيق في القضية ${c.reference}`,'اقرأ المحضر في «مخالفاتي وجزاءاتي».');
  }else if(action==='submit_defence'){
    set('defence_text=?,defence_at=?',v.text(input.defence,'دفاعك',6000,10),time);
    event(db,u,c,'defence','قدّم الموظف دفاعه المكتوب');
  }else if(action==='conclude'){
    if(!['proven','not_proven'].includes(input.finding))fail(400,'finding','اختر: ثبتت المخالفة أو لم تثبت');
    if(c.process==='written'){
      if(!c.hearing_minutes)fail(409,'hearing_required','سجّل محضر جلسة التحقيق وسماع أقوال الموظف قبل إنهاء التحقيق (م117)');
      if(!c.defence_text&&date<addDays(c.charge_delivered_on,params.defence_wait_days))fail(409,'defence_pending',`لم يقدم الموظف دفاعه المكتوب بعد؛ يُنهى التحقيق دونه بعد ${params.defence_wait_days} أيام من تسليم الاتهام (مهلة تحددها الشركة، لا تنص عليها م117)`);
    }
    const note=v.text(input.note,'أساس النتيجة',3000,10);
    if(input.finding==='proven'){set("status='proven',finding='proven',finding_note=?,proven_on=?,found_by=?",note,date,u.id);
      tell(db,c,'proven',`انتهى التحقيق في القضية ${c.reference} بثبوت المخالفة`,`يُعرض على صاحب الصلاحية ليقرر خلال ${params.decision_limit_days} يومًا، وله أن يختار جزاءً أخف.`);}
    else{set("status='not_proven',finding='not_proven',finding_note=?,found_by=?,closing_note=?",note,u.id,note);
      tell(db,c,'not_proven',`أُغلقت القضية ${c.reference}: لم تثبت المخالفة`,'لا جزاء، ولا تُحسب في التكرار.');}
    event(db,u,c,'finding',input.finding==='proven'?'ثبتت المخالفة':'لم تثبت المخالفة');
  }else if(action==='decide'){
    const chosen=parsePenalty(input.penalty),{max,violations}=maximumPenalty(db,c,params);
    // م113: لصاحب الصلاحية جزاء أخف، لا أشد. م116: الغرامة لا تتجاوز أجر خمسة أيام للمخالفة الواحدة.
    if(severity(chosen)>severity(max))fail(409,'harsher_than_schedule',`الجزاء المختار أشد من المقرر (${penaltyLabel(max)}). يجوز اختيار جزاء أخف فقط (م113)`);
    if(chosen.kind==='fine'&&chosen.day_bp>params.fine_cap_days_per_violation*10000)fail(409,'fine_cap',`الغرامة لا تتجاوز أجر ${params.fine_cap_days_per_violation} أيام للمخالفة الواحدة (م116)`);
    const lighter=severity(chosen)<severity(max),reason=lighter?v.text(input.lighter_reason,'سبب اختيار الجزاء الأخف (م113)',2000,10):'';
    const decided={...chosen,code:max.code,occurrence:max.occurrence,max:tokenOf(max),violations:violations.map(x=>({code:x.code,occurrence:x.occurrence,penalty:tokenOf(x.penalty)}))};
    set("status='decided',decided_penalty=?,decided_by=?,decided_at=?,decision_note=?,lighter_reason=?",JSON.stringify(decided),u.id,time,v.text(input.note,'أساس القرار',3000,10),reason);
    if(chosen.kind==='fine')db.prepare("INSERT INTO discipline_fines(id,tenant_id,case_id,user_id,day_bp,status,created_at) VALUES(?,?,?,?,?,'open',?)").run(id(),c.tenant_id,c.id,c.user_id,chosen.day_bp,time);
    event(db,u,c,'decision',`${penaltyLabel(chosen)}${lighter?' (أخف من المقرر)':''}`);
    audit(db,u,'discipline_case',c.id,'discipline.decided',{status:c.status},{penalty:tokenOf(chosen),lighter});
    tell(db,c,'decided',`صدر قرار في القضية ${c.reference}`,'سيصلك إشعار كتابي بالجزاء، ومنه تبدأ مهلة التظلم.');
    return {id:c.id,penalty:tokenOf(chosen),lighter};
  }else if(action==='issue_notice'){
    const decided=JSON.parse(c.decided_penalty),vs=violationsOf(db,c,params),top=rowOf(params,decided.code);
    const next=penaltyFor(top,decided.occurrence+1);
    const issued=issueInitiatedLetter(db,u,{typeCode:'discipline_notice',userId:c.user_id,preparedBy:c.decided_by,purpose:`إشعار بالجزاء في القضية ${c.reference} (م121)`,values:{
      case_reference:c.reference,violation_ar:vs.map(x=>x.ar).join('؛ '),violation_en:vs.map(x=>x.en).join('; '),violation_date:c.act_date,
      article:vs.map(x=>x.article_ar).join('؛ ')+' — اللائحة م111–م121',penalty_ar:penaltyLabel(decided,'ar'),penalty_en:penaltyLabel(decided,'en'),
      repeat_penalty_ar:penaltyLabel(next,'ar'),repeat_penalty_en:penaltyLabel(next,'en'),grievance_days:String(params.grievance_filing_days)}});
    set('notice_request_id=?',issued.request_id);
    event(db,u,c,'notice_issued',`إشعار الجزاء برقم ${issued.reference}`);
    tell(db,c,'notice_issued',`صدر إشعار الجزاء في القضية ${c.reference}`,`الخطاب برقم ${issued.reference} في «خطاباتي» و«مخالفاتي وجزاءاتي».`);
    result={id:c.id,reference:issued.reference,letter_id:issued.letter_id};
  }else if(action==='record_delivery'){
    if(!Object.hasOwn(DELIVERY_METHODS,input.method))fail(400,'method','اختر طريقة الإبلاغ');
    const issuedOn=db.prepare('SELECT issued_on FROM letters WHERE request_id=?').get(c.notice_request_id).issued_on,delivered=inRange(input.delivered_on,'تاريخ الإبلاغ',issuedOn);
    const refused=input.refused_to_sign===true;
    if(refused&&input.method!=='hand')fail(400,'refused_to_sign','الامتناع عن التوقيع يُسجل عند التسليم باليد؛ بعده يُرسل بالبريد المسجل أو البريد الإلكتروني الثابت في العقد (م121)');
    const reference=input.method==='hand'?(input.reference?v.text(input.reference,'مرجع التسليم',300,2):''):v.text(input.reference,'مرجع الإرسال (رقم البريد المسجل أو معرّف الرسالة)',300,3);
    if(refused){
      set("delivery_method='hand',delivered_on=?,refused_to_sign=1,delivery_reference=?,delivery_recorded_by=?",delivered,reference,u.id);
      event(db,u,c,'delivery_refused','امتنع الموظف عن الاستلام أو التوقيع؛ يلزم الإرسال بالبريد المسجل أو البريد الإلكتروني الثابت في العقد');
    }else{
      set("status='notified',delivery_method=?,delivered_on=?,delivery_reference=?,delivery_recorded_by=?,notified_on=?",input.method,delivered,reference,u.id,delivered);
      const due=addDaysExcludingHolidays(delivered,params.grievance_filing_days,holidaySet(db,c.tenant_id));
      event(db,u,c,'delivered',`${DELIVERY_METHODS[input.method][0]} في ${delivered}`);
      tell(db,c,'notified',`أُبلغت بالجزاء في القضية ${c.reference}`,`لك التظلم كتابة حتى ${dayName(due)} (30 يومًا عدا العطل الرسمية). تقديم التظلم لا يضرك (م126).`);
    }
  }else if(action==='file_grievance'){
    const answerDue=addDaysExcludingHolidays(date,params.grievance_answer_days,holidaySet(db,c.tenant_id));
    db.prepare("INSERT INTO discipline_grievances(id,tenant_id,case_id,user_id,body,filed_on,answer_due_on,status,created_at) VALUES(?,?,?,?,?,?,?,'filed',?)").run(id(),c.tenant_id,c.id,c.user_id,v.text(input.body,'نص التظلم',6000,10),date,answerDue,time);
    bump();
    event(db,u,c,'grievance_filed','قدّم الموظف تظلمًا');
    tell(db,c,'grievance_filed',`استلمنا تظلمك في القضية ${c.reference}`,`يُرد عليه حتى ${dayName(answerDue)} (15 يومًا عدا العطل الرسمية). لا يُقتطع شيء من راتبك في هذه القضية حتى الرد.`);
  }else if(action==='answer_grievance'){
    const g=grievanceOf(db,c.id),current=effectivePenalty(c,g);
    if(!['upheld','reduced','rejected'].includes(input.outcome))fail(400,'outcome','اختر: قبول التظلم وإلغاء الجزاء، أو تخفيفه، أو رفض التظلم');
    let replacement=null;
    if(input.outcome==='reduced'){
      replacement=parsePenalty(input.penalty);
      // التظلم لا يضر صاحبه: التخفيف أخف من الجزاء القائم حتمًا، ولا نتيجة أشد.
      if(severity(replacement)>=severity(current))fail(409,'not_lighter','التخفيف يلزم أن يكون أخف من الجزاء القائم؛ نتيجة التظلم لا تكون أشد (م126)');
    }else if(input.penalty!==undefined&&input.penalty!=='')fail(400,'penalty','الجزاء البديل للتخفيف فقط');
    db.prepare("UPDATE discipline_grievances SET status='answered',outcome=?,answer=?,new_penalty=?,answered_by=?,answered_on=?,version=version+1 WHERE id=?").run(input.outcome,v.text(input.answer,'نص الرد وأسبابه',6000,10),replacement?JSON.stringify(replacement):null,u.id,date,g.id);
    const fine=fineOf(db,c.id);
    if(fine?.status==='open'){
      if(input.outcome==='upheld'||(replacement&&replacement.kind!=='fine'))db.prepare("UPDATE discipline_fines SET status='cancelled',note=?,version=version+1 WHERE id=?").run('أُلغيت بنتيجة التظلم',fine.id);
      else if(replacement?.kind==='fine')db.prepare('UPDATE discipline_fines SET day_bp=?,note=?,version=version+1 WHERE id=?').run(replacement.day_bp,'خُفضت بنتيجة التظلم',fine.id);
    }
    bump();
    event(db,u,c,'grievance_answered',{upheld:'قُبل التظلم وأُلغي الجزاء',reduced:`خُفف الجزاء إلى: ${replacement?penaltyLabel(replacement):''}`,rejected:'رُفض التظلم'}[input.outcome]);
    tell(db,c,'grievance_answered',{upheld:`قُبل تظلمك في القضية ${c.reference} وأُلغي الجزاء`,reduced:`خُفف الجزاء في القضية ${c.reference} بنتيجة تظلمك`,rejected:`رُفض تظلمك في القضية ${c.reference}`}[input.outcome],
      input.outcome==='rejected'?'الرد وأسبابه في «مخالفاتي وجزاءاتي». لك الاعتراض أمام المحكمة العمالية خلال 30 يومًا (عدا العطل الرسمية).':'الرد وأسبابه في «مخالفاتي وجزاءاتي».');
  }else if(action==='propose_deduction'){
    const fine=fineOf(db,c.id),m=typeof input.month==='string'&&/^\d{4}-(0[1-9]|1[0-2])$/.test(input.month)?input.month:fail(400,'invalid_month','الشهر بصيغة 2026-09');
    if(m<c.notified_on.slice(0,7))fail(400,'month','الخصم في شهر الإبلاغ بالجزاء أو بعده');
    // م116: سقف الغرامات الشهري وأساس الأجر الذي يُقاس عليه قرار واحد في سياسة سقوف الاستقطاع (م51، م116)؛
    // جدول الجزاءات يبقى مصدرها ما لم تُقبل تلك السياسة بعد. فحص هذه الوحدة وفحص ما قبل المسير يقرآن الرقم نفسه.
    const basis=capBasis(db,c.tenant_id,`${m}-01`);
    const outstanding=fineOutstanding(db,fine),cap=basis.monthly_fine_cap_days*10000;
    const used=db.prepare("SELECT COALESCE(SUM(d.day_bp),0) AS n FROM discipline_fine_deductions d JOIN payroll_adjustments a ON a.id=d.adjustment_id WHERE d.tenant_id=? AND d.user_id=? AND d.month=? AND a.status<>'rejected'").get(c.tenant_id,c.user_id,m).n;
    if(used>=cap)fail(409,'monthly_fine_cap',`بلغت الغرامات المقترحة على ${m} سقف أجر ${basis.monthly_fine_cap_days} أيام في الشهر (م116). اقترح الباقي في شهر لاحق`);
    const bp=Math.min(outstanding,cap-used);
    const contract=db.prepare("SELECT pay_lines FROM employment_contracts WHERE user_id=? AND tenant_id=? AND status='active' ORDER BY start_date DESC LIMIT 1").get(c.user_id,c.tenant_id);
    if(!contract)fail(409,'contract_required','لا عقد ساري للموظف في المنصة؛ لا يُحسب أجر يومي دونه');
    const monthly=JSON.parse(contract.pay_lines).filter(l=>basis.wage_components.includes(l.component)).reduce((n,l)=>n+l.amount_minor,0);
    if(monthly<=0)fail(409,'wage_required',`بنود الأجر في أساس السقوف (${basis.wage_components.map(x=>PAY_COMPONENT_NAMES[x]).join('، ')}) لا تقابل بنودًا في العقد الساري`);
    const mode=roundingMode(db,c.tenant_id,`${m}-01`);
    const daily=halfUp(monthly,basis.day_basis_days),amount=roundMoney(halfUp(monthly*bp,basis.day_basis_days*10000),mode);
    if(amount<=0)fail(409,'amount','المبلغ المحسوب أقل من هللة');
    // م51/5 (ص 19): الغرامات التي توقع على العامل بسبب المخالفات حالة مستثناة من شرط الموافقة الخطية؛ الصنف يُسجَّل أدناه بمصدره (class_recorded).
    const adjustment=proposeAdjustment(db,u,{user_id:c.user_id,kind:'deduction',month:m,amount:`${Math.floor(amount/100)}.${String(amount%100).padStart(2,'0')}`,
      reason:`غرامة جزاء تأديبي في القضية ${c.reference} — تُقيد في سجل الغرامات لصندوق منفعة العمال (م123) ولا تُعد إيرادًا للشركة`},
      {basis:{kind:'exception',case:'fine',reference:`قضية انضباط ${c.reference}`,class_recorded:true}});
    db.prepare('INSERT INTO discipline_fine_deductions(id,tenant_id,fine_id,adjustment_id,user_id,month,day_bp,amount_minor,daily_wage_minor,proposed_by,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(id(),c.tenant_id,fine.id,adjustment.id,c.user_id,m,bp,amount,daily,u.id,time);
    // دمج 20260919: تُصنَّف الحركة «fine» في payroll_adjustment_classes (ترحيل 102)، فتدخل سقف الغرامات في فحوص ما قبل المسير (م116)
    // مع أي غرامة أخرى على الشهر نفسه، لا سقف هذه الوحدة وحده.
    db.prepare('INSERT INTO payroll_adjustment_classes(adjustment_id,tenant_id,class,reference,source_kind,source_id,created_by,created_at) VALUES(?,?,?,?,?,?,?,?)').run(adjustment.id,c.tenant_id,'fine',`قضية انضباط ${c.reference}`,'discipline_case',c.id,u.id,time);
    bump();
    event(db,u,c,'deduction_proposed',`اقتُرح خصم على مسير ${m} بانتظار اعتماد الرواتب`);
    tell(db,c,'deduction_proposed',`اقتُرح خصم الغرامة في القضية ${c.reference} على مسير ${m}`,`الخصم مقترح وليس نهائيًا؛ يعتمده معتمد الرواتب، ولا يتجاوز للغرامات أجر ${basis.monthly_fine_cap_days} أيام في الشهر.`);
    result={id:c.id,adjustment_id:adjustment.id,day_bp:bp,remaining_bp:outstanding-bp};
  }else if(action==='withdraw'){
    const reason=v.text(input.reason,'سبب السحب',2000,10);
    set("status='withdrawn',closing_note=?",reason);
    event(db,u,c,'withdrawn','سُحبت القضية');
    tell(db,c,'withdrawn',`سُحبت القضية ${c.reference}`,'لا جزاء، ولا تُحسب في التكرار.');
  }else if(action==='close_lapsed'){
    const reason=v.text(input.reason,'ملاحظة الإغلاق',2000,10);
    set("status='lapsed',closing_note=?",reason);
    event(db,u,c,'lapsed',c.status==='recorded'?'سقطت المساءلة: لم يبدأ التحقيق خلال المهلة (م119)':'سقط الجزاء: لم يصدر خلال المهلة بعد الثبوت (م120)');
    tell(db,c,'lapsed',`أُغلقت القضية ${c.reference} بمضي المدة`,'لا جزاء، ولا تُحسب في التكرار.');
  }
  if(!['decide'].includes(action))audit(db,u,'discipline_case',c.id,'discipline.'+action,{status:c.status},{version:c.version+1});
  return result;
}

// ---------- صحيفة الجزاءات (م122) وسجل الغرامات (م123) ----------
function sheetRows(db,u,userId){
  return db.prepare(`SELECT * FROM discipline_cases WHERE tenant_id=? AND user_id=? AND status IN ('decided','notified') ORDER BY act_date DESC`).all(u.tenant_id,userId).map(c=>{
    const params=paramsOf(db.prepare('SELECT parameters FROM discipline_schedules WHERE id=?').get(c.schedule_id)),g=grievanceOf(db,c.id),eff=effectivePenalty(c,g);
    return {case_id:c.id,reference:c.reference,act_date:c.act_date,violations:violationsOf(db,c,params).map(x=>({code:x.code,ar:x.ar,en:x.en,occurrence:x.occurrence})),
      penalty:eff?{...eff,ar:penaltyLabel(eff,'ar'),en:penaltyLabel(eff,'en')}:null,decided_at:c.decided_at,notified_on:c.notified_on,grievance_outcome:g?.outcome??null,cancelled:!eff};
  });
}
export function penaltySheet(db,supplied,userId){
  const u=actor(db,supplied);
  const person=typeof userId==='string'&&db.prepare("SELECT id,name FROM users WHERE id=? AND tenant_id=? AND role<>'admin'").get(userId,u.tenant_id);
  if(!person||(person.id!==u.id&&!has(u,'hr.discipline.propose')&&!has(u,'hr.discipline.decide')))fail(404,'not_found','الصحيفة غير متاحة');
  return {user_id:person.id,employee_name:person.name,rows:sheetRows(db,u,person.id),note:'صحيفة الجزاءات تُحفظ في ملف خدمة العامل (م122): نوع المخالفة وتاريخها والجزاء الموقع. الجزاء الملغى بالتظلم يبقى ظاهرًا ملغًى.'};
}
function finesRegister(db,u){
  const money=seesMoney(u);
  const rows=db.prepare('SELECT f.*,c.reference,c.decided_at,c.decided_penalty,c.notified_on FROM discipline_fines f JOIN discipline_cases c ON c.id=f.case_id WHERE f.tenant_id=? ORDER BY c.decided_at DESC').all(u.tenant_id).map(f=>{
    const deductions=db.prepare('SELECT d.*,a.status AS adjustment_status,r.status AS run_status FROM discipline_fine_deductions d JOIN payroll_adjustments a ON a.id=d.adjustment_id LEFT JOIN payroll_runs r ON r.id=a.run_id WHERE d.fine_id=? ORDER BY d.month').all(f.id)
      .map(d=>({month:d.month,day_bp:d.day_bp,amount_minor:money?d.amount_minor:null,adjustment_status:d.adjustment_status,collected:d.adjustment_status==='approved'&&d.run_status==='approved'}));
    const live=deductions.filter(d=>d.adjustment_status!=='rejected').reduce((n,d)=>n+d.day_bp,0);
    return {fine_id:f.id,case_id:f.case_id,reference:f.reference,employee_name:userName(db,f.user_id),decided_at:f.decided_at,notified_on:f.notified_on,original_day_bp:JSON.parse(f.decided_penalty).day_bp,day_bp:f.day_bp,status:f.status,note:f.note,fund:f.fund,
      outstanding_bp:f.status==='open'?f.day_bp-live:0,over_proposed_bp:Math.max(0,live-(f.status==='open'?f.day_bp:0)),deductions,
      collected_minor:money?deductions.filter(d=>d.collected).reduce((n,d)=>n+d.amount_minor,0):null};
  });
  return {fund:'workers_benefit_fund',fund_ar:'صندوق منفعة العمال — التزام لا إيراد (م123)',fund_en:'Workers’ benefit fund — a liability, not revenue (Art. 123)',
    liability_minor:money?rows.reduce((n,r)=>n+r.collected_minor,0):null,rows,
    note:'الغرامة المحصلة التزام على الشركة لصالح العمال، يُصرف بما يعود بالنفع عليهم عن طريق اللجنة العمالية، أو بموافقة وزارة الموارد البشرية إن لم توجد لجنة (م123). المعالجة المحاسبية وحساب الالتزام يحددهما فريق المالية؛ المنصة لا تقيد قيدًا في الدفتر هنا.'};
}

// ---------- اللوحات ----------
export function disciplineBoard(db,supplied){
  const u=actor(db,supplied),date=today(),hr=has(u,'hr.discipline.propose')||has(u,'hr.discipline.decide'),payroll=has(u,'payroll.prepare')||has(u,'payroll.approve');
  const policy=has(u,'hr.policy.prepare')||has(u,'hr.policy.accept');
  const team=db.prepare("SELECT id,name FROM users WHERE tenant_id=? AND manager_id=? AND active=1 AND role<>'admin' ORDER BY name").all(u.tenant_id,u.id);
  if(!hr&&!payroll&&!policy&&!has(u,'hr.letters.issue')&&!team.length)fail(403,'not_permitted','هذه الشاشة للموارد البشرية وصاحب الصلاحية والمدير المباشر. صحيفتك في «مخالفاتي وجزاءاتي»');
  const active=acceptedSchedule(db,u.tenant_id,date);
  const schedules=hr||policy?db.prepare('SELECT * FROM discipline_schedules WHERE tenant_id=? OR tenant_id IS NULL ORDER BY tenant_id IS NOT NULL,created_at DESC').all(u.tenant_id).map(s=>scheduleView(db,u,s)):[];
  // كل صف يمر بقاعدة الاطلاع نفسها التي تحكم فتح القضية؛ ما لا يحق للمستخدم لا يدخل اللوحة.
  const cases=db.prepare('SELECT * FROM discipline_cases WHERE tenant_id=? AND user_id<>? ORDER BY created_at DESC LIMIT 500').all(u.tenant_id,u.id)
    .map(c=>[c,access(db,u,c)]).filter(([,level])=>level).map(([c,level])=>caseView(db,u,c,level,date));
  const deadlines=cases.flatMap(c=>c.deadlines.map(d=>({...d,case_id:c.id,reference:c.reference,employee_name:c.employee_name}))).sort((a,b)=>a.due_on.localeCompare(b.due_on));
  const employees=has(u,'hr.discipline.propose')?db.prepare("SELECT id,name FROM users WHERE tenant_id=? AND active=1 AND role<>'admin' AND id<>? ORDER BY name").all(u.tenant_id,u.id):team;
  const sheets=hr?db.prepare("SELECT DISTINCT user_id FROM discipline_cases WHERE tenant_id=? AND status IN ('decided','notified') AND user_id<>?").all(u.tenant_id,u.id).map(r=>({user_id:r.user_id,employee_name:userName(db,r.user_id),rows:sheetRows(db,u,r.user_id)})):[];
  const params=active?paramsOf(active):null,basis=capBasis(db,u.tenant_id,date);
  return {today:date,user_id:u.id,permissions:u.caps,can_record:!!active&&(has(u,'hr.discipline.propose')||team.length>0),
    // الأساس المشترك مع الرواتب معروض هنا بمصدره، فيرى من يقترح الغرامة الرقم الذي سيُفحص به المسير لا رقمًا آخر.
    cap_basis:{...basis,wage_component_names:basis.wage_components.map(x=>PAY_COMPONENT_NAMES[x]),
      source_note:basis.monthly_fine_cap_source==='deductions_policy'?'سقف الغرامات الشهري وأساس الأجر من سياسة سقوف الاستقطاع المقبولة (م51، م116).':'لم تُقبل سياسة سقوف الاستقطاع بعد؛ القيم من جدول الجزاءات المقبول.'},
    active_schedule:active?{id:active.id,title:active.title,effective_from:active.effective_from,codes:params.rows.map(r=>({code:r.code,table:r.table,ar:r.ar,en:r.en,penalties:r.penalties})),settings:scheduleView(db,u,active).settings,uncertain:scheduleView(db,u,active).uncertain}:null,
    schedules,employees,source_kinds:Object.entries(SOURCE_KINDS).map(([key,[ar,en]])=>({key,ar,en})),delivery_methods:Object.entries(DELIVERY_METHODS).map(([key,[ar,en]])=>({key,ar,en})),
    // قيم خانة «العقوبة المشتركة» كما تطبعها الجداول، ليختار منها المعد عند تصحيح بند بعد مطابقة الصفحة الموقعة.
    extra_deductions:Object.entries(EXTRA_DEDUCTIONS).map(([key,[ar,en]])=>({key,ar,en})),
    cases,deadlines,grievances:cases.filter(c=>c.grievance_status==='filed'),sheets,
    fines:(has(u,'hr.discipline.decide')||payroll)?finesRegister(db,u):null,
    rule:'المنصة تقترح الجزاء من الجدول المقبول ولا توقعه. لا جزاء قبل الإبلاغ بالاتهام والتحقيق ومحضره، ويقرر صاحب الصلاحية لا من سجل المخالفة، وللعامل التظلم. الخصم يصل المسير مقترحًا فقط.'};
}
export function myDiscipline(db,supplied){
  const u=actor(db,supplied),date=today(),basis=capBasis(db,u.tenant_id,date);
  const cases=db.prepare('SELECT * FROM discipline_cases WHERE tenant_id=? AND user_id=? ORDER BY created_at DESC').all(u.tenant_id,u.id).map(c=>caseView(db,u,c,'subject',date));
  return {today:date,user_id:u.id,cases,sheet:sheetRows(db,u,u.id),
    rights:['لا يوقع عليك جزاء قبل إبلاغك بالاتهام وسماع أقوالك وتحقيق دفاعك في محضر؛ ويجوز الاستجواب الشفهي في المخالفات البسيطة على أن يُثبت في محضر (م117، م126/1).',
      'لا تُساءل عن مخالفة مضى على العلم بها 30 يومًا دون تحقيق، ولا يوقع جزاء بعد 30 يومًا من ثبوتها (م119، م120).',
      `لا يُقتطع من أجرك للغرامات أكثر من أجر ${basis.monthly_fine_cap_days} أيام في الشهر، وتُصرف الغرامات لمنفعة العمال لا للشركة (م116، م123).`,
      'لك التظلم كتابة خلال 30 يومًا من إبلاغك عدا العطل الرسمية، ويُرد عليك خلال 15 يومًا، ولا يضرك تقديمه (م126).']};
}
