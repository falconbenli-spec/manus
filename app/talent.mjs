import { randomUUID } from 'node:crypto';
import { audit, now } from './db.mjs';
import { fail } from './auth.mjs';
import * as v from './validation.mjs';
import { currentUser } from './delegations.mjs';
import { holds, capabilityGap } from './access.mjs';
import { trainingNotice, performanceNotice, cycleNotice } from './module-notices.mjs';
import { riyadhToday, riyadhDateOf } from './riyadh-time.mjs';

// الأداء والتطوير والتعاقب. الدرجة مدخل لقرار بشري موثق؛ لا تغيّر راتبًا ولا مسمى بنفسها (TAL-10).
const CAPS=['hr.performance.manage','hr.performance.calibrate','hr.succession.manage'];
const APPEAL_DAYS=14;
export const REVIEW_STATES={self:'بانتظار التقييم الذاتي',manager:'بانتظار تقييم المدير',submitted:'بانتظار المعايرة',calibrated:'معايَر — لم يصدر',released:'صدر — بانتظار إقرار الموظف',acknowledged:'أقرّ به الموظف',appealed:'تظلم قيد النظر',appeal_decided:'بُت في التظلم',excluded:'مستبعد من الدورة'};
export const TRAINING_KINDS=[['course','دورة'],['certification','شهادة مهنية'],['workshop','ورشة'],['conference','مؤتمر'],['on_the_job','تدريب على رأس العمل']].map(([key,name])=>({key,name}));
export const READINESS=[['ready_now','جاهز الآن'],['one_two_years','خلال سنة إلى سنتين'],['three_plus_years','بعد ثلاث سنوات أو أكثر']].map(([key,name])=>({key,name}));
const id=()=>randomUUID();
const today=()=>riyadhToday();
const addDays=(date,n)=>new Date(Date.parse(date+'T00:00:00Z')+n*86400000).toISOString().slice(0,10);
const name=(db,userId)=>userId?db.prepare('SELECT name FROM users WHERE id=?').get(userId)?.name??null:null;

function actor(db,supplied){const u=currentUser(db,supplied);if(!u||u.role==='admin')fail(403,'forbidden','هذه الشاشة لحسابات الموظفين');u.caps=CAPS.filter(key=>holds(db,u,key));return u;}
function writing(db){if(!db.isTransaction)fail(500,'transaction_required','تتطلب الكتابة معاملة قاعدة بيانات');}
const need=(u,cap,message)=>{if(!u.caps.includes(cap))fail(403,'not_permitted',message);};
const isManagerOf=(db,u,userId)=>!!db.prepare('SELECT 1 FROM users WHERE id=? AND tenant_id=? AND manager_id=? AND active=1').get(userId,u.tenant_id,u.id);
function employee(db,u,userId){const p=typeof userId==='string'&&db.prepare("SELECT id,name,manager_id FROM users WHERE id=? AND tenant_id=? AND active=1 AND role<>'admin'").get(userId,u.tenant_id);if(!p)fail(404,'not_found','الموظف غير متاح');return p;}
function versioned(row,input){if(!Number.isInteger(input?.version)||input.version!==row.version)fail(409,'stale_version','تغير السجل منذ فتحه. أعد التحميل');}
function scoreBp(value,scale,label){if(typeof value!=='string'||!/^\d{1,2}(\.\d{1,2})?$/.test(value))fail(400,'score',`${label}: درجة بخانتين عشريتين كحد أقصى`);const bp=Math.round(Number(value)*100);if(bp<100||bp>scale*100)fail(400,'score',`${label}: من 1 إلى ${scale}`);return bp;}

// ---------- دورات التقييم ----------
function cleanCriteria(list){
  if(!Array.isArray(list)||list.length<2||list.length>12)fail(400,'criteria','من معيارين إلى اثني عشر معيارًا');
  const out=list.map((c,i)=>{v.object(c,['name','weight']);if(!Number.isInteger(c.weight)||c.weight<5||c.weight>90)fail(400,'criteria','وزن كل معيار عدد صحيح بين 5 و90');return {key:`c${i+1}`,name:v.text(c.name,'اسم المعيار',160,3),weight:c.weight};});
  if(out.reduce((n,c)=>n+c.weight,0)!==100)fail(400,'criteria','مجموع الأوزان 100');
  if(new Set(out.map(c=>c.name)).size!==out.length)fail(400,'criteria','أسماء المعايير لا تتكرر');
  return out;
}
export function createCycle(db,supplied,input){
  writing(db);const u=actor(db,supplied);need(u,'hr.performance.manage','إنشاء دورات التقييم لموظفي الموارد البشرية المخولين');
  v.object(input,['name','period_from','period_to','scale_max','criteria']);
  const from=v.date(input.period_from),to=v.date(input.period_to);if(to<from)fail(400,'date_order','نهاية الفترة بعد بدايتها');
  if(!Number.isInteger(input.scale_max)||input.scale_max<3||input.scale_max>10)fail(400,'scale_max','سلم الدرجات من 3 إلى 10');
  const title=v.text(input.name,'اسم الدورة',160,3);
  if(db.prepare('SELECT 1 FROM review_cycles WHERE tenant_id=? AND name=?').get(u.tenant_id,title))fail(409,'duplicate_cycle','توجد دورة بهذا الاسم');
  const cycleId=id(),time=now();
  db.prepare("INSERT INTO review_cycles(id,tenant_id,name,period_from,period_to,scale_max,criteria,status,created_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,'draft',?,?,?)").run(cycleId,u.tenant_id,title,from,to,input.scale_max,JSON.stringify(cleanCriteria(input.criteria)),u.id,time,time);
  audit(db,u,'review_cycle',cycleId,'cycle.created',{}, {name:title});
  return {id:cycleId};
}
function cycleRow(db,u,cycleId){const c=typeof cycleId==='string'&&db.prepare('SELECT * FROM review_cycles WHERE id=? AND tenant_id=?').get(cycleId,u.tenant_id);if(!c)fail(404,'not_found','الدورة غير متاحة');return c;}
function bumpCycle(db,c,fields,values){db.prepare(`UPDATE review_cycles SET ${fields},version=version+1,updated_at=? WHERE id=?`).run(...values,now(),c.id);}
export function cycleAction(db,supplied,cycleId,action,input){
  writing(db);const u=actor(db,supplied),c=cycleRow(db,u,cycleId);versioned(c,input);
  if(action==='open'){
    need(u,'hr.performance.manage','فتح الدورة لموظفي الموارد البشرية المخولين');v.object(input,['version']);
    if(c.status!=='draft')fail(409,'invalid_state','الدورة ليست مسودة');
    const people=db.prepare("SELECT id,name,manager_id FROM users WHERE tenant_id=? AND active=1 AND role<>'admin' ORDER BY name").all(u.tenant_id),time=now(),skipped=[];
    for(const p of people){
      const manager=p.manager_id&&db.prepare('SELECT id FROM users WHERE id=? AND active=1').get(p.manager_id);
      if(!manager){skipped.push(p.name);continue;}
      db.prepare("INSERT INTO performance_reviews(id,tenant_id,cycle_id,user_id,reviewer_id,status,created_at,updated_at) VALUES(?,?,?,?,?,'self',?,?)").run(id(),u.tenant_id,c.id,p.id,manager.id,time,time);
    }
    if(!db.prepare('SELECT 1 FROM performance_reviews WHERE cycle_id=?').get(c.id))fail(409,'no_reviewees','لا يوجد موظف له مدير مباشر نشط');
    bumpCycle(db,c,"status='open',opened_at=?",[time]);
    audit(db,u,'review_cycle',c.id,'cycle.opened',{}, {skipped_without_manager:skipped.length});
    cycleNotice(db,u,'open',c.id);
    return {id:c.id,status:'open',skipped_without_manager:skipped};
  }
  if(action==='to_calibration'){
    need(u,'hr.performance.manage','نقل الدورة للمعايرة لموظفي الموارد البشرية المخولين');v.object(input,['version']);
    if(c.status!=='open')fail(409,'invalid_state','الدورة ليست مفتوحة');
    const waiting=db.prepare("SELECT x.name FROM performance_reviews r JOIN users x ON x.id=r.user_id WHERE r.cycle_id=? AND r.status IN ('self','manager')").all(c.id).map(r=>r.name);
    if(waiting.length)fail(409,'reviews_incomplete',`تقييمات لم تكتمل: ${waiting.slice(0,8).join('، ')}${waiting.length>8?'…':''}. أكملها أو استبعدها بسبب مكتوب`);
    bumpCycle(db,c,"status='calibration'",[]);audit(db,u,'review_cycle',c.id,'cycle.calibration',{}, {});
    return {id:c.id,status:'calibration'};
  }
  if(action==='release'){
    need(u,'hr.performance.calibrate','إصدار النتائج لحامل تصريح المعايرة');v.object(input,['version']);
    if(c.status!=='calibration')fail(409,'invalid_state','الدورة ليست في المعايرة');
    if(c.created_by===u.id)fail(409,'separation_of_duties','من أنشأ الدورة لا يصدر نتائجها');
    if(db.prepare("SELECT 1 FROM performance_reviews WHERE cycle_id=? AND status='submitted'").get(c.id))fail(409,'calibration_incomplete','تقييمات لم تُعايَر بعد');
    const time=now();
    db.prepare("UPDATE performance_reviews SET status='released',version=version+1,updated_at=? WHERE cycle_id=? AND status='calibrated'").run(time,c.id);
    bumpCycle(db,c,"status='released',released_by=?,released_at=?",[u.id,time]);audit(db,u,'review_cycle',c.id,'cycle.released',{}, {});
    cycleNotice(db,u,'release',c.id);
    return {id:c.id,status:'released'};
  }
  fail(404,'not_found','الإجراء غير متاح');
}

// ---------- التقييمات ----------
function reviewRow(db,u,reviewId){const r=typeof reviewId==='string'&&db.prepare('SELECT * FROM performance_reviews WHERE id=? AND tenant_id=?').get(reviewId,u.tenant_id);if(!r)fail(404,'not_found','التقييم غير متاح');return r;}
function canSee(u,r){return r.user_id===u.id||r.reviewer_id===u.id||u.caps.includes('hr.performance.manage')||u.caps.includes('hr.performance.calibrate');}
function bumpReview(db,r,fields,values){db.prepare(`UPDATE performance_reviews SET ${fields},version=version+1,updated_at=? WHERE id=?`).run(...values,now(),r.id);}
function reviewView(db,u,r,cycle){
  const own=r.user_id===u.id,resultVisible=!own||['released','acknowledged','appealed','appeal_decided'].includes(r.status);
  const hrManage=u.caps.includes('hr.performance.manage'),calibrator=u.caps.includes('hr.performance.calibrate'),actions=[];
  if(own&&r.status==='self')actions.push('submit_self');
  if(r.reviewer_id===u.id&&r.status==='manager')actions.push('submit_manager');
  if(!own&&hrManage&&r.status==='self')actions.push('skip_self');
  if(!own&&hrManage&&['self','manager'].includes(r.status))actions.push('exclude_review');
  if(calibrator&&!own&&r.reviewer_id!==u.id&&r.status==='submitted'&&cycle.status==='calibration')actions.push('calibrate');
  if(own&&r.status==='released'){actions.push('acknowledge');if(today()<=addDays(riyadhDateOf(cycle.released_at),APPEAL_DAYS))actions.push('appeal');}
  if(calibrator&&!own&&r.reviewer_id!==u.id&&r.calibrated_by!==u.id&&r.status==='appealed')actions.push('decide_appeal');
  return {id:r.id,cycle_id:r.cycle_id,user_id:r.user_id,employee_name:name(db,r.user_id),reviewer_name:name(db,r.reviewer_id),status:r.status,status_name:REVIEW_STATES[r.status],own,version:r.version,
    self_text:r.self_text,self_submitted_at:r.self_submitted_at,self_skipped_note:r.self_skipped_note,
    ...(resultVisible?{scores:JSON.parse(r.scores),manager_score_bp:r.manager_score_bp,manager_summary:r.manager_summary,final_score_bp:r.final_score_bp,calibration_note:r.calibration_note,calibrated_by_name:name(db,r.calibrated_by)}:{scores:[],manager_score_bp:null,manager_summary:'',final_score_bp:null,calibration_note:'',calibrated_by_name:null,result_hidden:true}),
    appeal_text:r.appeal_text,appeal_outcome:r.appeal_outcome,appeal_note:r.appeal_note,appeal_decided_by_name:name(db,r.appeal_decided_by),excluded_note:r.excluded_note,actions};
}
export function performanceBoard(db,supplied){
  const u=actor(db,supplied),wide=u.caps.includes('hr.performance.manage')||u.caps.includes('hr.performance.calibrate');
  const cycles=db.prepare('SELECT * FROM review_cycles WHERE tenant_id=? ORDER BY period_to DESC,created_at DESC LIMIT 12').all(u.tenant_id).map(c=>{
    const rows=db.prepare(`SELECT * FROM performance_reviews WHERE cycle_id=? ${wide?'':'AND (user_id=? OR reviewer_id=?)'} ORDER BY created_at`).all(...(wide?[c.id]:[c.id,u.id,u.id]));
    if(!wide&&!rows.length&&c.status==='draft')return null;
    const counts=wide?Object.fromEntries(Object.keys(REVIEW_STATES).map(k=>[k,rows.filter(r=>r.status===k).length])):null,actions=[];
    if(u.caps.includes('hr.performance.manage')&&c.status==='draft')actions.push('open_cycle');
    if(u.caps.includes('hr.performance.manage')&&c.status==='open')actions.push('to_calibration');
    if(u.caps.includes('hr.performance.calibrate')&&c.status==='calibration'&&c.created_by!==u.id)actions.push('release_cycle');
    return {id:c.id,name:c.name,period_from:c.period_from,period_to:c.period_to,scale_max:c.scale_max,criteria:JSON.parse(c.criteria),status:c.status,status_name:{draft:'مسودة',open:'مفتوحة للتقييم',calibration:'في المعايرة',released:'صدرت النتائج'}[c.status],released_at:c.released_at,version:c.version,counts,actions,
      reviews:rows.filter(r=>canSee(u,r)).map(r=>reviewView(db,u,r,c)).sort((a,b)=>Number(b.own)-Number(a.own)||a.employee_name.localeCompare(b.employee_name,'ar'))};
  }).filter(Boolean);
  return {today:today(),user_id:u.id,permissions:u.caps,cycles,appeal_days:APPEAL_DAYS,
    rule:'الدرجة لا تغيّر راتبًا ولا مسمى بنفسها. أي أثر مالي أو وظيفي قرار مستقل موثق في العقود أو حركات الرواتب.'};
}
export function reviewAction(db,supplied,reviewId,action,input){
  writing(db);const u=actor(db,supplied),r=reviewRow(db,u,reviewId);
  if(!canSee(u,r))fail(404,'not_found','التقييم غير متاح');
  versioned(r,input);
  const cycle=db.prepare('SELECT * FROM review_cycles WHERE id=?').get(r.cycle_id),view=reviewView(db,u,r,cycle);
  // D-14: المعايرة والبت في التظلم يقفان على تصريح حساس بلا دور افتراضي، وكان الرفض يقول «الإجراء غير متاح» فقط.
  if(!view.actions.includes(action)){
    const needsCalibrate=['calibrate','decide_appeal'].includes(action);
    const gap=needsCalibrate?capabilityGap(db,u.tenant_id,'hr.performance.calibrate',{exclude:[r.user_id,r.reviewer_id,...(action==='decide_appeal'&&r.calibrated_by?[r.calibrated_by]:[])]}):null;
    v.actionUnavailable(action,{subject:`تقييم ${view.employee_name}`,state_name:REVIEW_STATES[r.status],available:view.actions,
      names:{submit_self:'التقييم الذاتي',submit_manager:'تقييم المدير',skip_self:'تجاوز التقييم الذاتي',exclude_review:'الاستبعاد من الدورة',calibrate:'المعايرة',acknowledge:'الإقرار بالنتيجة',appeal:'التظلم',decide_appeal:'البت في التظلم'},
      reason:needsCalibrate&&!gap.satisfied?`هذه الخطوة تحتاج تصريح «${gap.capability_name}» (${gap.capability})، ولا يقوم بها المقيَّم ولا مديره${action==='decide_appeal'?' ولا من عاير التقييم':''}`
        :action==='calibrate'&&cycle.status!=='calibration'?`المعايرة بعد انتقال الدورة إلى «في المعايرة»؛ حالة الدورة الآن «${{draft:'مسودة',open:'مفتوحة للتقييم',calibration:'في المعايرة',released:'صدرت النتائج'}[cycle.status]}»`
        :'حالة التقييم لا تقبل هذا الإجراء أو لا يحمله حسابك',
      who:gap?gap.text:null,code:'invalid_state'});
  }
  const time=now();
  if(action==='submit_self'){v.object(input,['version','self_text']);bumpReview(db,r,"self_text=?,self_submitted_at=?,status='manager'",[v.text(input.self_text,'تقييمك الذاتي',6000,30),time]);}
  else if(action==='skip_self'){v.object(input,['version','note']);bumpReview(db,r,"self_skipped_note=?,status='manager'",[v.text(input.note,'سبب تجاوز التقييم الذاتي',1000,10)]);}
  else if(action==='exclude_review'){v.object(input,['version','note']);bumpReview(db,r,"excluded_note=?,status='excluded'",[v.text(input.note,'سبب الاستبعاد',1000,10)]);}
  else if(action==='submit_manager'){
    v.object(input,['version','scores','summary']);
    const criteria=JSON.parse(cycle.criteria);
    if(!Array.isArray(input.scores)||input.scores.length!==criteria.length)fail(400,'scores','قيّم كل معيار');
    const scores=criteria.map(c=>{const s=input.scores.find(x=>x?.key===c.key);if(!s)fail(400,'scores',`معيار بلا درجة: ${c.name}`);v.object(s,['key','score','evidence']);if(!Number.isInteger(s.score)||s.score<1||s.score>cycle.scale_max)fail(400,'scores',`${c.name}: درجة صحيحة من 1 إلى ${cycle.scale_max}`);return {key:c.key,name:c.name,weight:c.weight,score:s.score,evidence:v.text(s.evidence,`دليل «${c.name}»`,2000,10)};});
    const bp=Math.round(scores.reduce((n,s)=>n+s.score*s.weight,0));
    bumpReview(db,r,"scores=?,manager_score_bp=?,manager_summary=?,manager_submitted_at=?,status='submitted'",[JSON.stringify(scores),bp,v.text(input.summary,'ملخص المدير',4000,20),time]);
  }else if(action==='calibrate'){
    v.object(input,['version','final_score','note']);
    const final=scoreBp(input.final_score,cycle.scale_max,'الدرجة النهائية'),changed=final!==r.manager_score_bp;
    bumpReview(db,r,"final_score_bp=?,calibration_note=?,calibrated_by=?,calibrated_at=?,status='calibrated'",[final,v.text(input.note,changed?'سبب تعديل درجة المدير':'ملاحظة المعايرة',2000,changed?20:3),u.id,time]);
  }else if(action==='acknowledge'){v.object(input,['version']);bumpReview(db,r,"acknowledged_at=?,status='acknowledged'",[time]);}
  else if(action==='appeal'){v.object(input,['version','appeal_text']);bumpReview(db,r,"appeal_text=?,appealed_at=?,status='appealed'",[v.text(input.appeal_text,'نص التظلم',4000,30),time]);}
  else if(action==='decide_appeal'){
    v.object(input,['version','outcome','final_score','note']);
    if(!['upheld','changed'].includes(input.outcome))fail(400,'outcome','اختر تأييد الدرجة أو تعديلها');
    const final=input.outcome==='changed'?scoreBp(input.final_score,cycle.scale_max,'الدرجة بعد التظلم'):r.final_score_bp;
    if(input.outcome==='changed'&&final===r.final_score_bp)fail(400,'outcome','التعديل يتطلب درجة مختلفة');
    bumpReview(db,r,"appeal_outcome=?,final_score_bp=?,appeal_note=?,appeal_decided_by=?,appeal_decided_at=?,status='appeal_decided'",[input.outcome,final,v.text(input.note,'أساس القرار في التظلم',3000,20),u.id,time]);
  }
  audit(db,u,'performance_review',r.id,'review.'+action,{status:r.status},{user_id:r.user_id});
  performanceNotice(db,u,action,r);
  return {id:r.id};
}

// ---------- التدريب وأهداف التطوير ----------
export function growthBoard(db,supplied){
  const u=actor(db,supplied),wide=u.caps.includes('hr.performance.manage');
  const team=db.prepare('SELECT id,name FROM users WHERE tenant_id=? AND manager_id=? AND active=1 ORDER BY name').all(u.tenant_id,u.id),ids=[u.id,...team.map(t=>t.id)],marks=ids.map(()=>'?').join(',');
  const training=db.prepare(`SELECT * FROM training_records WHERE tenant_id=? ${wide?'':`AND user_id IN (${marks})`} ORDER BY created_at DESC LIMIT 200`).all(u.tenant_id,...(wide?[]:ids)).map(t=>{
    const own=t.user_id===u.id,decider=!own&&(isManagerOf(db,u,t.user_id)||wide),actions=[];
    if(t.status==='requested'&&decider)actions.push('approve_training','reject_training');
    if(t.status==='requested'&&own)actions.push('cancel_training');
    if(t.status==='approved'&&own)actions.push('complete_training');
    return {...t,kind_name:TRAINING_KINDS.find(k=>k.key===t.kind).name,status_name:{requested:'بانتظار القرار',approved:'معتمد',rejected:'مرفوض',completed:'مكتمل',cancelled:'ملغى'}[t.status],employee_name:name(db,t.user_id),decided_by_name:name(db,t.decided_by),own,actions};});
  const goals=db.prepare(`SELECT * FROM development_goals WHERE tenant_id=? ${wide?'':`AND user_id IN (${marks})`} ORDER BY status='open' DESC,due_date LIMIT 200`).all(u.tenant_id,...(wide?[]:ids)).map(g=>{
    const own=g.user_id===u.id,manager=isManagerOf(db,u,g.user_id),actions=[];
    if(g.status==='open'&&(own||manager))actions.push('note_goal');
    if(g.status==='open'&&manager)actions.push('achieve_goal','drop_goal');
    return {...g,progress:JSON.parse(g.progress),status_name:{open:'قائم',achieved:'تحقق',dropped:'أُسقط'}[g.status],employee_name:name(db,g.user_id),set_by_name:name(db,g.set_by),closed_by_name:name(db,g.closed_by),own,overdue:g.status==='open'&&g.due_date<today(),actions};});
  const hours=db.prepare("SELECT COALESCE(SUM(hours),0) AS n FROM training_records WHERE user_id=? AND status='completed' AND end_date LIKE ?").get(u.id,today().slice(0,4)+'%').n;
  return {today:today(),user_id:u.id,permissions:u.caps,training_kinds:TRAINING_KINDS,team,training,goals,my_completed_hours_this_year:hours,
    succession:u.caps.includes('hr.succession.manage')?successionView(db,u):null,note:'تكلفة التدريب لا تُسجل هنا: إن احتاج التدريب صرفًا فمساره طلب شراء أو مطالبة مصروف.'};
}
export function requestTraining(db,supplied,input){
  writing(db);const u=actor(db,supplied);
  v.object(input,['user_id','title','provider','kind','hours','start_date','end_date','purpose']);
  const target=input.user_id&&input.user_id!==u.id?employee(db,u,input.user_id):null;
  if(target&&!isManagerOf(db,u,target.id)&&!u.caps.includes('hr.performance.manage'))fail(403,'not_permitted','تطلب التدريب لنفسك أو لفريقك');
  if(!TRAINING_KINDS.some(k=>k.key===input.kind))fail(400,'kind','اختر نوع التدريب');
  if(!Number.isInteger(input.hours)||input.hours<1||input.hours>2000)fail(400,'hours','الساعات عدد صحيح من 1 إلى 2000');
  const from=v.date(input.start_date),to=v.date(input.end_date);if(to<from)fail(400,'date_order','النهاية بعد البداية');
  const trainingId=id();
  db.prepare("INSERT INTO training_records(id,tenant_id,user_id,title,provider,kind,hours,start_date,end_date,purpose,status,requested_by,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,'requested',?,?)").run(trainingId,u.tenant_id,target?.id??u.id,v.text(input.title,'عنوان التدريب',200,3),input.provider?v.text(input.provider,'الجهة المقدمة',200,2):'',input.kind,input.hours,from,to,v.text(input.purpose,'الغرض والصلة بالعمل',2000,10),u.id,now());
  audit(db,u,'training',trainingId,'training.requested',{}, {user_id:target?.id??u.id});
  trainingNotice(db,u,'requested',db.prepare('SELECT * FROM training_records WHERE id=?').get(trainingId));
  return {id:trainingId};
}
export function trainingAction(db,supplied,trainingId,action,input){
  writing(db);const u=actor(db,supplied);
  const t=typeof trainingId==='string'&&db.prepare('SELECT * FROM training_records WHERE id=? AND tenant_id=?').get(trainingId,u.tenant_id);
  const row=t&&growthBoard(db,u).training.find(x=>x.id===t.id);
  if(!row)fail(404,'not_found','سجل التدريب غير متاح');
  versioned(t,input);
  const key={approve:'approve_training',reject:'reject_training',cancel:'cancel_training',complete:'complete_training'}[action];
  if(!key||!row.actions.includes(key))fail(409,'invalid_state','الإجراء غير متاح في حالة السجل أو لحسابك');
  const time=now();
  if(action==='complete'){v.object(input,['version','completion_reference']);db.prepare("UPDATE training_records SET status='completed',completion_reference=?,completed_at=?,version=version+1 WHERE id=?").run(v.text(input.completion_reference,'مرجع الشهادة أو إثبات الحضور',500,5),time,t.id);}
  else if(action==='cancel'){v.object(input,['version']);db.prepare("UPDATE training_records SET status='cancelled',version=version+1 WHERE id=?").run(t.id);}
  else{v.object(input,['version','note']);db.prepare('UPDATE training_records SET status=?,decided_by=?,decided_at=?,decision_note=?,version=version+1 WHERE id=?').run(action==='approve'?'approved':'rejected',u.id,time,v.text(input.note,'أساس القرار',1000,action==='approve'?3:10),t.id);}
  audit(db,u,'training',t.id,'training.'+action,{status:t.status},{user_id:t.user_id});
  trainingNotice(db,u,action,t);
  return {id:t.id};
}
export function setGoal(db,supplied,input){
  writing(db);const u=actor(db,supplied);
  v.object(input,['user_id','goal','measure','due_date','review_id']);
  const target=input.user_id&&input.user_id!==u.id?employee(db,u,input.user_id):null;
  if(target&&!isManagerOf(db,u,target.id))fail(403,'not_permitted','تضع الهدف لنفسك أو لفريقك المباشر');
  const owner=target?.id??u.id,due=v.date(input.due_date);if(due<=today())fail(400,'due_date','موعد الهدف في المستقبل');
  if(input.review_id&&!db.prepare('SELECT 1 FROM performance_reviews WHERE id=? AND user_id=? AND tenant_id=?').get(input.review_id,owner,u.tenant_id))fail(404,'not_found','التقييم المرتبط غير متاح');
  const goalId=id();
  db.prepare("INSERT INTO development_goals(id,tenant_id,user_id,review_id,goal,measure,due_date,status,set_by,created_at) VALUES(?,?,?,?,?,?,?,'open',?,?)").run(goalId,u.tenant_id,owner,input.review_id||null,v.text(input.goal,'الهدف',1000,10),v.text(input.measure,'كيف يُقاس تحققه',600,5),due,u.id,now());
  audit(db,u,'development_goal',goalId,'goal.set',{}, {user_id:owner});
  return {id:goalId};
}
export function goalAction(db,supplied,goalId,action,input){
  writing(db);const u=actor(db,supplied);
  const g=typeof goalId==='string'&&db.prepare('SELECT * FROM development_goals WHERE id=? AND tenant_id=?').get(goalId,u.tenant_id);
  const row=g&&growthBoard(db,u).goals.find(x=>x.id===g.id);
  if(!row)fail(404,'not_found','الهدف غير متاح');
  versioned(g,input);
  const key={note:'note_goal',achieve:'achieve_goal',drop:'drop_goal'}[action];
  if(!key||!row.actions.includes(key))fail(409,'invalid_state','الإجراء غير متاح في حالة الهدف أو لحسابك');
  v.object(input,['version','note']);
  const note=v.text(input.note,action==='note'?'ملاحظة التقدم':'أساس الإقفال',1500,10),time=now();
  if(action==='note')db.prepare('UPDATE development_goals SET progress=?,version=version+1 WHERE id=?').run(JSON.stringify([...JSON.parse(g.progress),{at:time,by:u.id,by_name:u.name,note}].slice(-50)),g.id);
  else db.prepare('UPDATE development_goals SET status=?,closed_by=?,closed_at=?,closing_note=?,version=version+1 WHERE id=?').run(action==='achieve'?'achieved':'dropped',u.id,time,note,g.id);
  audit(db,u,'development_goal',g.id,'goal.'+action,{}, {user_id:g.user_id});
  return {id:g.id};
}

// ---------- التعاقب ----------
function successionView(db,u){
  // من هو شاغل المنصب أو مرشح فيه لا يرى خطته حتى لو حمل التصريح.
  const plans=db.prepare("SELECT * FROM succession_plans WHERE tenant_id=? ORDER BY status,criticality='high' DESC,position_title").all(u.tenant_id)
    .filter(p=>p.holder_id!==u.id&&!db.prepare('SELECT 1 FROM succession_candidates WHERE plan_id=? AND user_id=? AND removed_at IS NULL').get(p.id,u.id))
    .map(p=>{const candidates=db.prepare('SELECT * FROM succession_candidates WHERE plan_id=? ORDER BY removed_at IS NOT NULL,added_at').all(p.id).map(c=>({...c,employee_name:name(db,c.user_id),readiness_name:READINESS.find(r=>r.key===c.readiness).name,added_by_name:name(db,c.added_by),active:!c.removed_at}));
      const live=candidates.filter(c=>c.active);
      return {...p,holder_name:name(db,p.holder_id),criticality_name:{high:'حرج',medium:'متوسط',low:'منخفض'}[p.criticality],candidates,gap:p.status==='active'&&!live.some(c=>c.readiness==='ready_now'),actions:p.status==='active'?['add_candidate','archive_plan']:[]};});
  return {plans,readiness:READINESS,employees:db.prepare("SELECT id,name FROM users WHERE tenant_id=? AND active=1 AND role<>'admin' AND id<>? ORDER BY name").all(u.tenant_id,u.id),
    note:'خطط التعاقب سرية: لا يراها شاغل المنصب ولا المرشح، والترشيح ليس وعدًا بترقية.'};
}
export function createPlan(db,supplied,input){
  writing(db);const u=actor(db,supplied);need(u,'hr.succession.manage','خطط التعاقب لحامل تصريحها');
  v.object(input,['position_title','holder_id','criticality','risk_note']);
  if(!['high','medium','low'].includes(input.criticality))fail(400,'criticality','اختر درجة الأهمية');
  const holder=input.holder_id?employee(db,u,input.holder_id):null;
  if(holder?.id===u.id)fail(409,'separation_of_duties','لا يضع الموظف خطة تعاقب لمنصبه');
  const title=v.text(input.position_title,'المنصب',200,3);
  if(db.prepare("SELECT 1 FROM succession_plans WHERE tenant_id=? AND position_title=? AND status='active'").get(u.tenant_id,title))fail(409,'duplicate_plan','لهذا المنصب خطة قائمة');
  const planId=id(),time=now();
  db.prepare("INSERT INTO succession_plans(id,tenant_id,position_title,holder_id,criticality,risk_note,status,created_by,created_at,updated_at) VALUES(?,?,?,?,?,?,'active',?,?,?)").run(planId,u.tenant_id,title,holder?.id??null,input.criticality,v.text(input.risk_note,'أثر شغور المنصب',2000,10),u.id,time,time);
  audit(db,u,'succession_plan',planId,'succession.plan_created',{}, {});
  return {id:planId};
}
export function planAction(db,supplied,planId,action,input){
  writing(db);const u=actor(db,supplied);need(u,'hr.succession.manage','خطط التعاقب لحامل تصريحها');
  const plan=successionView(db,u).plans.find(p=>p.id===planId);
  if(!plan)fail(404,'not_found','الخطة غير متاحة');
  const time=now();
  if(action==='add_candidate'){
    v.object(input,['version','user_id','readiness','strengths','gaps','development_action']);versioned(plan,input);
    if(plan.status!=='active')fail(409,'invalid_state','الخطة مؤرشفة');
    const person=employee(db,u,input.user_id);
    if(person.id===u.id||person.id===plan.holder_id)fail(409,'separation_of_duties','لا يُرشح واضع الخطة نفسه ولا شاغل المنصب');
    if(!READINESS.some(r=>r.key===input.readiness))fail(400,'readiness','اختر درجة الجاهزية');
    if(db.prepare('SELECT 1 FROM succession_candidates WHERE plan_id=? AND user_id=? AND removed_at IS NULL').get(plan.id,person.id))fail(409,'duplicate_candidate','المرشح موجود في الخطة. أزله ثم أضف تقييمًا جديدًا');
    db.prepare('INSERT INTO succession_candidates(id,plan_id,user_id,readiness,strengths,gaps,development_action,added_by,added_at) VALUES(?,?,?,?,?,?,?,?,?)').run(id(),plan.id,person.id,input.readiness,v.text(input.strengths,'نقاط القوة',1500,10),v.text(input.gaps,'الفجوات',1500,10),v.text(input.development_action,'إجراء التطوير',1500,10),u.id,time);
  }else if(action==='remove_candidate'){
    v.object(input,['version','candidate_id','note']);versioned(plan,input);
    const c=plan.candidates.find(x=>x.id===input.candidate_id&&x.active);if(!c)fail(404,'not_found','المرشح غير متاح');
    db.prepare('UPDATE succession_candidates SET removed_by=?,removed_at=?,removal_note=? WHERE id=?').run(u.id,time,v.text(input.note,'سبب الإزالة',1000,10),c.id);
  }else if(action==='archive_plan'){
    v.object(input,['version','note']);versioned(plan,input);
    if(plan.status!=='active')fail(409,'invalid_state','الخطة مؤرشفة');
    v.text(input.note,'سبب الأرشفة',1000,10);
    db.prepare("UPDATE succession_plans SET status='archived',version=version+1,updated_at=? WHERE id=?").run(time,plan.id);
    audit(db,u,'succession_plan',plan.id,'succession.archive_plan',{}, {},input.note.trim());return {id:plan.id};
  }else fail(404,'not_found','الإجراء غير متاح');
  db.prepare('UPDATE succession_plans SET version=version+1,updated_at=? WHERE id=?').run(time,plan.id);
  audit(db,u,'succession_plan',plan.id,'succession.'+action,{}, {});
  return {id:plan.id};
}
