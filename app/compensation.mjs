import { randomUUID } from 'node:crypto';
import { audit, now } from './db.mjs';
import { fail } from './auth.mjs';
import * as v from './validation.mjs';
import { currentUser } from './delegations.mjs';
import { holds } from './access.mjs';
import { riyadhDate } from './work-calendar.mjs';

// مراجعة التعويضات: نطاقات رواتب بمصدرها، ودورة سنوية بميزانية، ومقترحات زيادة يعتمدها غير مقترِحها.
// الزيادة المعتمدة لا تلمس العقد: تُنتج توصية ينشئ بها صاحب hr.contracts.manage نسخة عقد جديدة عبر مسار العقود القائم.
// لا نطاقات مخترعة ولا بيانات سوق: كل نطاق يدخله صاحب الإجراء بمصدره ويعتمده غيره.
const REVIEW='hr.compensation.review',CONTRACTS_MANAGE='hr.contracts.manage',CONTRACTS_APPROVE='hr.contracts.approve';
const CAPS=[REVIEW,CONTRACTS_MANAGE,CONTRACTS_APPROVE];
export const PROPOSAL_STATES={proposed:'بانتظار تقييم النطاق',assessed:'بانتظار الاعتماد',approved:'معتمدة — توصية للعقود',rejected:'مرفوضة',withdrawn:'مسحوبة'};
export const BAND_POSITIONS={below:'دون النطاق',within:'داخل النطاق',above:'فوق النطاق',no_band:'لا نطاق معتمد ينطبق'};
const CYCLE_STATES={draft:'مسودة — بانتظار فتحها من شخص آخر',open:'مفتوحة للمقترحات',closed:'مغلقة'};
const REC_STATES={open:'بانتظار نسخة عقد جديدة',fulfilled:'أُنشئت نسخة العقد',dropped:'أُسقطت بسبب مكتوب'};
const id=()=>randomUUID();
const today=()=>riyadhDate(Date.now());
const userName=(db,userId)=>userId?db.prepare('SELECT name FROM users WHERE id=?').get(userId)?.name??null:null;

function actor(db,supplied){const u=currentUser(db,supplied);if(!u||u.role==='admin')fail(403,'forbidden','هذه الشاشة لحسابات الموظفين');u.caps=CAPS.filter(k=>holds(db,u,k));u.reviewer=u.caps.includes(REVIEW);return u;}
function writing(db){if(!db.isTransaction)fail(500,'transaction_required','تتطلب الكتابة معاملة قاعدة بيانات');}
const need=(ok,message)=>{if(!ok)fail(403,'not_permitted',message);};
function money(value,label,digits=10){
  if(typeof value!=='string'||!new RegExp(`^(?:0|[1-9]\\d{0,${digits-1}})(?:\\.\\d{1,2})?$`).test(value))fail(400,'invalid_money',`${label}: مبلغ بالريال بخانتين عشريتين كحد أقصى`);
  const [whole,fraction='']=value.split('.');const minor=Number(BigInt(whole)*100n+BigInt(fraction.padEnd(2,'0')));
  if(minor<=0)fail(400,'invalid_money',`${label}: مبلغ موجب`);return minor;
}
const activeContract=(db,tenantId,userId)=>db.prepare("SELECT id,monthly_total_minor FROM employment_contracts WHERE tenant_id=? AND user_id=? AND status='active' ORDER BY start_date DESC LIMIT 1").get(tenantId,userId)??null;
const categoryOf=(db,tenantId,userId,date)=>db.prepare('SELECT e.category_id,c.name FROM employee_job_categories e JOIN job_categories c ON c.id=e.category_id WHERE e.tenant_id=? AND e.user_id=? AND e.effective_from<=? ORDER BY e.effective_from DESC LIMIT 1').get(tenantId,userId,date)??null;
const isManagerOf=(db,u,userId)=>!!db.prepare('SELECT 1 FROM users WHERE id=? AND tenant_id=? AND manager_id=? AND active=1').get(userId,u.tenant_id,u.id);

// نتيجة المعايرة تُعرض بجانب المقترح للقراءة فقط. عمدًا لا توجد هنا ولا في أي مكان معادلة تحوّل الدرجة إلى نسبة زيادة:
// الدرجة مدخل لحكم بشري يكتب المقترِح مبرره، لا مدخل لحساب.
function lastCalibration(db,tenantId,userId){
  const r=db.prepare("SELECT r.final_score_bp,r.status,c.name,c.scale_max,c.released_at FROM performance_reviews r JOIN review_cycles c ON c.id=r.cycle_id WHERE r.tenant_id=? AND r.user_id=? AND r.status IN ('released','acknowledged','appealed','appeal_decided') AND r.final_score_bp IS NOT NULL ORDER BY c.released_at DESC LIMIT 1").get(tenantId,userId);
  return r?{cycle_name:r.name,final_score:(r.final_score_bp/100).toFixed(2),scale_max:r.scale_max,appeal_pending:r.status==='appealed'}:null;
}

// ---------- نطاقات الرواتب ----------
function bandView(db,u,b){
  return {id:b.id,category_id:b.category_id,category_name:db.prepare('SELECT name FROM job_categories WHERE id=?').get(b.category_id)?.name,level:b.level,min_minor:b.min_minor,mid_minor:b.mid_minor,max_minor:b.max_minor,
    effective_from:b.effective_from,source:b.source,status:b.status,prepared_by_name:userName(db,b.prepared_by),decided_by_name:userName(db,b.decided_by),decision_note:b.decision_note,version:b.version,
    actions:b.status==='draft'&&b.prepared_by!==u.id&&u.reviewer?['approve_band','reject_band']:[]};
}
export function prepareBand(db,supplied,input){
  writing(db);const u=actor(db,supplied);need(u.reviewer,'نطاقات الرواتب لحامل تصريح مراجعة التعويضات');
  v.object(input,['category_id','level','min','mid','max','effective_from','source']);
  const category=typeof input.category_id==='string'&&db.prepare('SELECT id FROM job_categories WHERE id=? AND tenant_id=? AND active=1').get(input.category_id,u.tenant_id);
  if(!category)fail(404,'not_found','الفئة الوظيفية غير متاحة');
  const min=money(input.min,'أدنى النطاق'),mid=money(input.mid,'أوسط النطاق'),max=money(input.max,'أعلى النطاق');
  if(!(min<=mid&&mid<=max))fail(400,'band_order','الأدنى ≤ الأوسط ≤ الأعلى');
  const level=v.text(input.level,'المستوى',40,1),effective=v.date(input.effective_from),source=v.text(input.source,'مصدر النطاق (وثيقة أو قرار ومرجعه)',1000,10);
  if(db.prepare("SELECT 1 FROM salary_bands WHERE tenant_id=? AND category_id=? AND level=? AND effective_from=? AND status<>'rejected'").get(u.tenant_id,category.id,level,effective))fail(409,'duplicate_band','لهذه الفئة والمستوى نطاق بتاريخ السريان نفسه');
  const bandId=id(),time=now();
  db.prepare("INSERT INTO salary_bands(id,tenant_id,category_id,level,min_minor,mid_minor,max_minor,currency,effective_from,source,status,prepared_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,'SAR',?,?,'draft',?,?,?)").run(bandId,u.tenant_id,category.id,level,min,mid,max,effective,source,u.id,time,time);
  // المبالغ لا تدخل سجل التدقيق العام.
  audit(db,u,'salary_band',bandId,'band.prepared',{},{category_id:category.id,level,effective_from:effective},source);
  return {id:bandId};
}
export function decideBand(db,supplied,bandId,decision,input){
  writing(db);const u=actor(db,supplied);need(u.reviewer,'اعتماد النطاقات لحامل تصريح مراجعة التعويضات');
  if(!['approve','reject'].includes(decision))fail(404,'not_found','الإجراء غير متاح');
  v.object(input,['version','note']);
  const b=typeof bandId==='string'&&db.prepare('SELECT * FROM salary_bands WHERE id=? AND tenant_id=?').get(bandId,u.tenant_id);if(!b)fail(404,'not_found','النطاق غير متاح');
  v.version(input.version,b.version);
  if(b.status!=='draft')fail(409,'invalid_state','النطاق مقرر سابقًا؛ التصحيح بنطاق جديد مؤرخ');
  if(b.prepared_by===u.id)fail(409,'separation_of_duties','من أعد النطاق لا يعتمده');
  const note=v.text(input.note,'أساس القرار',1000,10),status=decision==='approve'?'approved':'rejected',time=now();
  db.prepare('UPDATE salary_bands SET status=?,decided_by=?,decided_at=?,decision_note=?,version=version+1,updated_at=? WHERE id=?').run(status,u.id,time,note,time,b.id);
  audit(db,u,'salary_band',b.id,'band.'+status,{status:'draft'},{status},note);
  return {id:b.id};
}
// النطاق الساري: أحدث نسخة معتمدة لكل فئة ومستوى في التاريخ المطلوب.
function liveBands(db,tenantId,categoryId,date){
  return db.prepare("SELECT b.* FROM salary_bands b WHERE b.tenant_id=? AND b.category_id=? AND b.status='approved' AND b.effective_from<=? AND b.effective_from=(SELECT MAX(x.effective_from) FROM salary_bands x WHERE x.tenant_id=b.tenant_id AND x.category_id=b.category_id AND x.level=b.level AND x.status='approved' AND x.effective_from<=?) ORDER BY b.level").all(tenantId,categoryId,date,date);
}

// ---------- الدورات ----------
function cycleRow(db,u,cycleId){const c=typeof cycleId==='string'&&db.prepare('SELECT * FROM compensation_cycles WHERE id=? AND tenant_id=?').get(cycleId,u.tenant_id);if(!c)fail(404,'not_found','الدورة غير متاحة');return c;}
const committed=(db,cycleId)=>db.prepare("SELECT COALESCE(SUM(increase_minor),0) AS n FROM compensation_proposals WHERE cycle_id=? AND status IN ('proposed','assessed','approved')").get(cycleId).n;
export function createCompCycle(db,supplied,input){
  writing(db);const u=actor(db,supplied);need(u.reviewer,'دورات المراجعة لحامل تصريح مراجعة التعويضات');
  v.object(input,['name','year','budget','budget_source','increases_effective_from']);
  if(!Number.isInteger(input.year)||input.year<2020||input.year>2100)fail(400,'year','السنة غير صالحة');
  const name=v.text(input.name,'اسم الدورة',160,3);
  if(db.prepare('SELECT 1 FROM compensation_cycles WHERE tenant_id=? AND name=?').get(u.tenant_id,name))fail(409,'duplicate_cycle','توجد دورة بهذا الاسم');
  const budget=money(input.budget,'الميزانية الشهرية الإجمالية للزيادات',10),source=v.text(input.budget_source,'مصدر الميزانية وقرار إقرارها',1000,10),effective=v.date(input.increases_effective_from);
  const cycleId=id(),time=now();
  db.prepare("INSERT INTO compensation_cycles(id,tenant_id,name,year,budget_minor,currency,budget_source,increases_effective_from,status,created_by,created_at,updated_at) VALUES(?,?,?,?,?,'SAR',?,?,'draft',?,?,?)").run(cycleId,u.tenant_id,name,input.year,budget,source,effective,u.id,time,time);
  audit(db,u,'compensation_cycle',cycleId,'comp_cycle.created',{},{name,year:input.year},source);
  return {id:cycleId};
}
export function compCycleAction(db,supplied,cycleId,action,input){
  writing(db);const u=actor(db,supplied);need(u.reviewer,'إدارة الدورة لحامل تصريح مراجعة التعويضات');
  const c=cycleRow(db,u,cycleId);v.object(input,['version','note']);v.version(input.version,c.version);
  const note=v.text(input.note,'أساس القرار',1000,5),time=now();
  if(action==='open'){
    if(c.status!=='draft')fail(409,'invalid_state','الدورة ليست مسودة');
    if(c.created_by===u.id)fail(409,'separation_of_duties','من وضع ميزانية الدورة لا يفتحها');
    db.prepare("UPDATE compensation_cycles SET status='open',opened_by=?,opened_at=?,version=version+1,updated_at=? WHERE id=?").run(u.id,time,time,c.id);
  }else if(action==='close'){
    if(c.status!=='open')fail(409,'invalid_state','الدورة ليست مفتوحة');
    const waiting=db.prepare("SELECT COUNT(*) AS n FROM compensation_proposals WHERE cycle_id=? AND status IN ('proposed','assessed')").get(c.id).n;
    if(waiting)fail(409,'proposals_pending',`${waiting} مقترح لم يُبت فيه. اعتمده أو ارفضه أو يسحبه مقترحه قبل الإغلاق`);
    db.prepare("UPDATE compensation_cycles SET status='closed',closed_by=?,closed_at=?,version=version+1,updated_at=? WHERE id=?").run(u.id,time,time,c.id);
  }else fail(404,'not_found','الإجراء غير متاح');
  audit(db,u,'compensation_cycle',c.id,'comp_cycle.'+action,{status:c.status},{version:c.version+1},note);
  return {id:c.id};
}

// ---------- المقترحات ----------
// الرؤية: المراجع يرى كل المقترحات إلا ما يخصه هو؛ المدير يرى مقترحات فريقه المباشر ومقترحاته فقط، بلا راتب حالي ولا نطاق.
function canSeeProposal(db,u,p){
  if(p.user_id===u.id)return false;
  return u.reviewer||p.proposed_by===u.id||isManagerOf(db,u,p.user_id);
}
function proposalView(db,u,p,cycle){
  const full=u.reviewer,actions=[];
  if(full&&p.status==='proposed'&&p.proposed_by!==u.id)actions.push('assess_proposal');
  if(full&&p.status==='assessed'&&p.proposed_by!==u.id&&(p.band_position==='within'||(p.assessed_by!==u.id&&u.caps.includes(CONTRACTS_APPROVE))))actions.push('approve_proposal');
  if(full&&p.status==='assessed'&&p.proposed_by!==u.id)actions.push('reject_proposal');
  if(p.proposed_by===u.id&&['proposed','assessed'].includes(p.status)&&cycle.status==='open')actions.push('withdraw_proposal');
  const base={id:p.id,cycle_id:p.cycle_id,user_id:p.user_id,employee_name:userName(db,p.user_id),proposed_by_name:userName(db,p.proposed_by),increase_minor:p.increase_minor,rationale:p.rationale,
    status:p.status,status_name:PROPOSAL_STATES[p.status],decision_note:p.decision_note,decided_by_name:userName(db,p.decided_by),version:p.version,calibration:lastCalibration(db,u.tenant_id,p.user_id),actions};
  if(!full)return {...base,salary_hidden:true};
  const category=categoryOf(db,u.tenant_id,p.user_id,cycle.increases_effective_from),band=p.band_id?db.prepare('SELECT * FROM salary_bands WHERE id=?').get(p.band_id):null;
  return {...base,salary_hidden:false,current_monthly_minor:p.current_monthly_minor,proposed_monthly_minor:p.current_monthly_minor+p.increase_minor,
    category_name:category?.name??null,band:band?{level:band.level,min_minor:band.min_minor,mid_minor:band.mid_minor,max_minor:band.max_minor,source:band.source}:null,
    band_position:p.band_position,band_position_name:p.band_position?BAND_POSITIONS[p.band_position]:null,exception_note:p.exception_note,assessed_by_name:userName(db,p.assessed_by),
    candidate_bands:p.status==='proposed'&&category?liveBands(db,u.tenant_id,category.category_id,cycle.increases_effective_from).map(b=>({id:b.id,level:b.level,min_minor:b.min_minor,mid_minor:b.mid_minor,max_minor:b.max_minor})):[],
    needs_higher_approval:!!p.band_position&&p.band_position!=='within'};
}
function proposalRow(db,u,proposalId){
  const p=typeof proposalId==='string'&&db.prepare('SELECT * FROM compensation_proposals WHERE id=? AND tenant_id=?').get(proposalId,u.tenant_id);
  if(!p||!canSeeProposal(db,u,p))fail(404,'not_found','المقترح غير متاح');return p;
}
export function proposeIncrease(db,supplied,input){
  writing(db);const u=actor(db,supplied);
  v.object(input,['cycle_id','user_id','increase','rationale']);
  const c=cycleRow(db,u,input.cycle_id);if(c.status!=='open')fail(409,'invalid_state','الدورة ليست مفتوحة للمقترحات');
  if(input.user_id===u.id)fail(409,'separation_of_duties','لا يقترح أحد زيادة لنفسه');
  const target=typeof input.user_id==='string'&&db.prepare("SELECT id,manager_id FROM users WHERE id=? AND tenant_id=? AND active=1 AND role<>'admin'").get(input.user_id,u.tenant_id);
  if(!target)fail(404,'not_found','الموظف غير متاح');
  // المدير المباشر يقترح لفريقه. من لا مدير نشطًا له يقترح له مراجع التعويضات.
  const managerActive=target.manager_id&&db.prepare('SELECT 1 FROM users WHERE id=? AND active=1').get(target.manager_id);
  if(target.manager_id!==u.id&&!(u.reviewer&&!managerActive))fail(403,'not_permitted','يقترح المدير المباشر لفريقه فقط');
  const contract=activeContract(db,u.tenant_id,target.id);
  if(!contract)fail(409,'no_active_contract','لا عقد ساريًا للموظف في المنصة؛ الراتب الحالي مصدره العقد الساري');
  if(db.prepare("SELECT 1 FROM compensation_proposals WHERE cycle_id=? AND user_id=? AND status IN ('proposed','assessed','approved')").get(c.id,target.id))fail(409,'duplicate_proposal','للموظف مقترح قائم في هذه الدورة');
  const increase=money(input.increase,'الزيادة الشهرية المقترحة',8),rationale=v.text(input.rationale,'مبرر الزيادة',3000,20);
  // الرسالة لا تذكر المتبقي: المتبقي يكشف مجموع زيادات الآخرين.
  if(committed(db,c.id)+increase>c.budget_minor)fail(409,'over_budget','المقترح يتجاوز المتبقي من ميزانية الدورة. راجع مسؤول التعويضات');
  const proposalId=id(),time=now();
  db.prepare("INSERT INTO compensation_proposals(id,tenant_id,cycle_id,user_id,proposed_by,increase_minor,currency,rationale,contract_id,current_monthly_minor,status,created_at,updated_at) VALUES(?,?,?,?,?,?,'SAR',?,?,?,'proposed',?,?)")
    .run(proposalId,u.tenant_id,c.id,target.id,u.id,increase,rationale,contract.id,contract.monthly_total_minor,time,time);
  audit(db,u,'compensation_proposal',proposalId,'comp_proposal.proposed',{},{cycle_id:c.id,user_id:target.id});
  return {id:proposalId};
}
const PROPOSAL_FIELDS={assess:['band_id','exception_note'],approve:['note'],reject:['note'],withdraw:['note']};
export function proposalAction(db,supplied,proposalId,action,input){
  writing(db);const u=actor(db,supplied),p=proposalRow(db,u,proposalId);
  if(!PROPOSAL_FIELDS[action])fail(404,'not_found','الإجراء غير متاح');
  v.object(input,['version',...PROPOSAL_FIELDS[action]]);v.version(input.version,p.version);
  const cycle=db.prepare('SELECT * FROM compensation_cycles WHERE id=?').get(p.cycle_id),view=proposalView(db,u,p,cycle);
  if(!view.actions.includes(action+'_proposal')){
    if(action==='approve'&&p.status==='assessed'&&p.band_position!=='within')fail(409,'higher_approval_required','المقترح خارج النطاق: يعتمده غير من قيّمه، ممن يحمل أيضًا تصريح اعتماد العقود');
    fail(409,'invalid_state','الإجراء غير متاح في حالة المقترح أو لحسابك');
  }
  const time=now();let reason='';
  if(action==='assess'){
    let band=null,position='no_band';
    if(input.band_id){
      band=view.candidate_bands.find(b=>b.id===input.band_id);
      if(!band)fail(409,'band_not_applicable','النطاق ليس نطاقًا معتمدًا ساريًا لفئة الموظف الوظيفية');
      const next=p.current_monthly_minor+p.increase_minor;position=next<band.min_minor?'below':next>band.max_minor?'above':'within';
    }
    const note=position==='within'?(input.exception_note?v.text(input.exception_note,'ملاحظة',2000,3):''):v.text(input.exception_note??'','مبرر الاقتراح خارج النطاق أو بلا نطاق',2000,20);
    reason=note;
    db.prepare("UPDATE compensation_proposals SET band_id=?,band_position=?,exception_note=?,assessed_by=?,assessed_at=?,status='assessed',version=version+1,updated_at=? WHERE id=?").run(band?.id??null,position,note,u.id,time,time,p.id);
  }else if(action==='withdraw'){
    reason=v.text(input.note,'سبب السحب',1000,5);
    db.prepare("UPDATE compensation_proposals SET status='withdrawn',decision_note=?,version=version+1,updated_at=? WHERE id=?").run(reason,time,p.id);
  }else{
    reason=v.text(input.note,'أساس القرار',2000,10);
    const status=action==='approve'?'approved':'rejected';
    db.prepare('UPDATE compensation_proposals SET status=?,decided_by=?,decided_at=?,decision_note=?,version=version+1,updated_at=? WHERE id=?').run(status,u.id,time,reason,time,p.id);
    if(status==='approved')db.prepare("INSERT INTO compensation_recommendations(id,tenant_id,proposal_id,user_id,contract_id,increase_minor,recommended_monthly_minor,currency,effective_from,status,created_at) VALUES(?,?,?,?,?,?,?,'SAR',?,'open',?)")
      .run(id(),u.tenant_id,p.id,p.user_id,p.contract_id,p.increase_minor,p.current_monthly_minor+p.increase_minor,cycle.increases_effective_from,time);
  }
  audit(db,u,'compensation_proposal',p.id,'comp_proposal.'+action,{status:p.status,version:p.version},{version:p.version+1},reason);
  return {id:p.id};
}

// ---------- التوصيات: نقطة الوصل مع العقود ----------
function recommendationView(db,u,r){
  const linked=r.new_contract_id?db.prepare('SELECT monthly_total_minor,status,start_date FROM employment_contracts WHERE id=?').get(r.new_contract_id):null;
  return {id:r.id,user_id:r.user_id,employee_name:userName(db,r.user_id),increase_minor:r.increase_minor,recommended_monthly_minor:r.recommended_monthly_minor,effective_from:r.effective_from,
    status:r.status,status_name:REC_STATES[r.status],closing_note:r.closing_note,closed_by_name:userName(db,r.closed_by),version:r.version,contract_id:r.contract_id,
    new_contract:linked?{id:r.new_contract_id,status:linked.status,start_date:linked.start_date,matches_recommendation:linked.monthly_total_minor===r.recommended_monthly_minor}:null,
    candidate_contracts:r.status==='open'&&u.caps.includes(CONTRACTS_MANAGE)&&r.user_id!==u.id?db.prepare("SELECT id,start_date,status FROM employment_contracts WHERE tenant_id=? AND user_id=? AND status IN ('draft','pending','active') AND created_at>=? AND id<>? ORDER BY created_at DESC").all(u.tenant_id,r.user_id,r.created_at,r.contract_id):[],
    actions:r.status==='open'&&u.caps.includes(CONTRACTS_MANAGE)&&r.user_id!==u.id?['link_contract','drop_recommendation']:[]};
}
export function recommendationAction(db,supplied,recId,action,input){
  writing(db);const u=actor(db,supplied);
  const r=typeof recId==='string'&&db.prepare('SELECT * FROM compensation_recommendations WHERE id=? AND tenant_id=?').get(recId,u.tenant_id);
  if(!r||r.user_id===u.id||!u.caps.includes(CONTRACTS_MANAGE))fail(404,'not_found','التوصية غير متاحة');
  const fields={link:['contract_id'],drop:['note']}[action];if(!fields)fail(404,'not_found','الإجراء غير متاح');
  v.object(input,['version',...fields]);v.version(input.version,r.version);
  if(r.status!=='open')fail(409,'invalid_state','التوصية مقفلة');
  const view=recommendationView(db,u,r),time=now();let reason='';
  if(action==='link'){
    // العقد الجديد يُنشأ ويُعتمد في مسار العقود نفسه؛ هنا يُربط فقط لإقفال التوصية.
    if(!view.candidate_contracts.some(c=>c.id===input.contract_id))fail(409,'contract_not_eligible','اربط نسخة عقد للموظف نفسه أُنشئت بعد التوصية عبر «تعديل العقد»');
    db.prepare("UPDATE compensation_recommendations SET status='fulfilled',new_contract_id=?,closed_by=?,closed_at=?,version=version+1 WHERE id=?").run(input.contract_id,u.id,time,r.id);
  }else{
    reason=v.text(input.note,'سبب الإسقاط',1000,10);
    db.prepare("UPDATE compensation_recommendations SET status='dropped',closing_note=?,closed_by=?,closed_at=?,version=version+1 WHERE id=?").run(reason,u.id,time,r.id);
  }
  audit(db,u,'compensation_recommendation',r.id,'comp_recommendation.'+action,{status:'open'},{version:r.version+1},reason);
  return {id:r.id};
}

// ---------- تحليل فجوة الأجر: مجمّع فقط ----------
const privacySetting=(db,tenantId,date)=>db.prepare('SELECT * FROM compensation_privacy_settings WHERE tenant_id=? AND effective_from<=? ORDER BY effective_from DESC LIMIT 1').get(tenantId,date)??null;
export function setGapPrivacy(db,supplied,input){
  writing(db);const u=actor(db,supplied);need(u.reviewer,'إعداد الحد الأدنى للمجموعة لحامل تصريح مراجعة التعويضات');
  v.object(input,['min_group_size','effective_from','basis']);
  if(!Number.isInteger(input.min_group_size)||input.min_group_size<3||input.min_group_size>500)fail(400,'min_group_size','الحد الأدنى للمجموعة عدد صحيح من 3 إلى 500');
  const effective=v.date(input.effective_from),basis=v.text(input.basis,'أساس الحد ومن أقره',1000,10);
  if(db.prepare('SELECT 1 FROM compensation_privacy_settings WHERE tenant_id=? AND effective_from=?').get(u.tenant_id,effective))fail(409,'duplicate_setting','يوجد إعداد بتاريخ السريان نفسه');
  const settingId=id();
  db.prepare('INSERT INTO compensation_privacy_settings(id,tenant_id,min_group_size,effective_from,basis,set_by,created_at) VALUES(?,?,?,?,?,?,?)').run(settingId,u.tenant_id,input.min_group_size,effective,basis,u.id,now());
  audit(db,u,'compensation_privacy',settingId,'comp_privacy.set',{},{min_group_size:input.min_group_size,effective_from:effective},basis);
  return {id:settingId};
}
const median=list=>{const s=[...list].sort((a,b)=>a-b),m=s.length>>1;return s.length%2?s[m]:Math.round((s[m-1]+s[m])/2);};
export function payGap(db,tenantId,date=today()){
  const setting=privacySetting(db,tenantId,date);
  if(!setting)return {available:false,reason:'لم يُحدَّد الحد الأدنى لحجم المجموعة بعد؛ لا تحليل قبل تحديده.',groups:[]};
  const rows=db.prepare("SELECT d.gender,c.monthly_total_minor AS pay,(SELECT e.category_id FROM employee_job_categories e WHERE e.user_id=c.user_id AND e.effective_from<=? ORDER BY e.effective_from DESC LIMIT 1) AS category_id FROM employment_contracts c JOIN users u ON u.id=c.user_id AND u.active=1 JOIN employee_demographics d ON d.user_id=c.user_id WHERE c.tenant_id=? AND c.status='active' AND d.gender IS NOT NULL").all(date,tenantId);
  const analyse=(label,subset)=>{
    const f=subset.filter(r=>r.gender==='female').map(r=>r.pay),m=subset.filter(r=>r.gender==='male').map(r=>r.pay);
    // مجموعة أصغر من الحد تُحجب كاملة، بعددها أيضًا: العدد مع المتوسط في شركة صغيرة يكشف الأفراد.
    if(f.length<setting.min_group_size||m.length<setting.min_group_size)return {label,suppressed:true};
    const mf=median(f),mm=median(m);
    return {label,suppressed:false,female_count:f.length,male_count:m.length,female_median_minor:mf,male_median_minor:mm,gap_bp:Math.round((mm-mf)*10000/mm)};
  };
  const categories=db.prepare('SELECT id,name FROM job_categories WHERE tenant_id=? ORDER BY name').all(tenantId);
  return {available:true,min_group_size:setting.min_group_size,basis:setting.basis,
    groups:[analyse('المنشأة كلها',rows),...categories.map(c=>analyse(c.name,rows.filter(r=>r.category_id===c.id)))],
    note:'الوسيط الشهري من العقود السارية لمن سُجل جنسه. الفجوة = (وسيط الرجال − وسيط النساء) ÷ وسيط الرجال. لا يفسر الرقم سببه: الفئة والخبرة والمستوى تؤثر فيه.'};
}

// ---------- اللوحة ----------
export function compensationBoard(db,supplied){
  const u=actor(db,supplied),date=today();
  const team=db.prepare("SELECT id,name FROM users WHERE tenant_id=? AND manager_id=? AND active=1 AND role<>'admin' ORDER BY name").all(u.tenant_id,u.id);
  const orphans=u.reviewer?db.prepare("SELECT x.id,x.name FROM users x WHERE x.tenant_id=? AND x.active=1 AND x.role<>'admin' AND x.id<>? AND (x.manager_id IS NULL OR NOT EXISTS(SELECT 1 FROM users m WHERE m.id=x.manager_id AND m.active=1)) ORDER BY x.name").all(u.tenant_id,u.id):[];
  const proposable=[...team,...orphans.filter(o=>!team.some(t=>t.id===o.id))];
  const cycles=db.prepare("SELECT * FROM compensation_cycles WHERE tenant_id=? ORDER BY year DESC,created_at DESC LIMIT 10").all(u.tenant_id).map(c=>{
    const proposals=db.prepare('SELECT * FROM compensation_proposals WHERE cycle_id=? ORDER BY created_at').all(c.id).filter(p=>canSeeProposal(db,u,p)).map(p=>proposalView(db,u,p,c));
    if(!u.reviewer&&!proposals.length&&c.status!=='open')return null;
    const used=u.reviewer?committed(db,c.id):null,actions=[];
    if(u.reviewer&&c.status==='draft'&&c.created_by!==u.id)actions.push('open_cycle');
    if(u.reviewer&&c.status==='open')actions.push('close_cycle');
    if(c.status==='open'&&proposable.length)actions.push('propose_increase');
    return {id:c.id,name:c.name,year:c.year,status:c.status,status_name:CYCLE_STATES[c.status],increases_effective_from:c.increases_effective_from,version:c.version,
      ...(u.reviewer?{budget_minor:c.budget_minor,budget_source:c.budget_source,used_minor:used,remaining_minor:c.budget_minor-used,created_by_name:userName(db,c.created_by)}:{}),
      proposable:c.status==='open'?proposable.filter(t=>!proposals.some(p=>p.user_id===t.id&&['proposed','assessed','approved'].includes(p.status))):[],proposals,actions};
  }).filter(Boolean);
  const recs=u.caps.includes(CONTRACTS_MANAGE)?db.prepare('SELECT * FROM compensation_recommendations WHERE tenant_id=? AND user_id<>? ORDER BY status=\'open\' DESC,created_at DESC LIMIT 200').all(u.tenant_id,u.id).map(r=>recommendationView(db,u,r)):[];
  const mine=db.prepare("SELECT r.increase_minor,r.recommended_monthly_minor,r.effective_from,r.status FROM compensation_recommendations r WHERE r.tenant_id=? AND r.user_id=? ORDER BY r.created_at DESC").all(u.tenant_id,u.id).map(r=>({...r,status_name:REC_STATES[r.status]}));
  return {today:date,user_id:u.id,permissions:u.caps,reviewer:u.reviewer,...(u.reviewer?{band_positions:BAND_POSITIONS}:{}),
    categories:u.reviewer?db.prepare('SELECT id,name FROM job_categories WHERE tenant_id=? AND active=1 ORDER BY name').all(u.tenant_id):[],
    bands:u.reviewer?db.prepare("SELECT * FROM salary_bands WHERE tenant_id=? ORDER BY status='draft' DESC,effective_from DESC,level").all(u.tenant_id).map(b=>bandView(db,u,b)):[],
    cycles,recommendations:recs,my_increases:mine,
    privacy:u.reviewer?privacySetting(db,u.tenant_id,date):null,pay_gap:u.reviewer?payGap(db,u.tenant_id,date):null,
    actions:u.reviewer?['prepare_band','create_cycle','set_gap_privacy']:[],
    note:'النطاقات يدخلها صاحب الإجراء بمصدرها المكتوب؛ المنصة لا تملك بيانات سوق ولا تقترح نطاقًا. الزيادة المعتمدة توصية لا تغيّر العقد: تنفَّذ بنسخة عقد جديدة يعدها ويعتمدها أصحاب تصاريح العقود. نتيجة التقييم معروضة للاطلاع ولا تحتسب الزيادة.',
    privacy_note:'المدير يرى مقترحات فريقه المباشر فقط ولا يرى رواتبهم الحالية ولا النطاقات. لا يرى أحد مقترحًا يخصه.'};
}
