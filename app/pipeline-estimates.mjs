import { audit, now } from './db.mjs';
import { fail } from './auth.mjs';
import * as v from './validation.mjs';
import { FAMILIES } from './agency.mjs';
import { id, today, daysBetween, nameOf, writing, seller, sellerClient, money, code } from './pipeline-shared.mjs';
import { can } from './access.mjs';
import { refuse } from './refusal.mjs';
import { registerEntity, projector, prepare, forTransition, columnsFor } from './custom-fields.mjs';
import { statusLabel } from './definitions.mjs';
import { riyadhDateOf } from './riyadh-time.mjs';
// الحزمة 4 (الترحيلان 180 و181): الفرصة تفتح صفقتها، وتفوز على اتفاق موثّق عليها، وتُخسر مع صفقتها التي لم يُتعاقد عليها.
import { PRE_CONTRACT, CONTRACTED, CLOSED_DEAL, closeDealRow, dealRef } from './crm-deals.mjs';
import { notifyMany } from './notices.mjs';
import { personName } from './people-read.mjs';
// الملف المقفل لا تنفتح له فرصة (P4-CRM-7، الترحيل 186).
import { assertClientOpen } from './client-offboarding.mjs';

// خط الفرص بالاحتمالات. يبني فوق ملفات العملاء وعزل فريق الحساب، ولا يمس المسار التجاري القائم (تأهيل ← عرض ← عقد ← مشروع).
//
// قرار مقصود: لا مرحلة ولا احتمال ولا عتبة خمول ولا سبب خسارة في الكود. كلها سجلات يدخلها مالك الإجراء بسندها،
// والمرحلة يعتمدها شخص غير من أعدّها. بلا مراحل معتمدة لا تُنشأ فرصة، وتقول الشاشة ذلك بدل أن تخترع قمعًا.
//
// وقرار ثانٍ: التوقع الموزون يُحسب باحتمال النسخة المعتمدة **الآن**. تعديل الاحتمال يغيّر التوقع كله فورًا،
// وهذا مقبول لأنه تقدير لا قيد؛ ولذلك لا يُخزَّن ولا يدخل أي تقرير مالي.

// ما يستطيع الخادم التحقق منه فعلًا. مالك الإجراء يختار منها لكل مرحلة؛ شرط لا يُتحقق منه آليًا ليس شرطًا.
export const STAGE_REQUIREMENTS={
  value_entered:'قيمة الفرصة مدخلة',
  expected_close:'تاريخ الإغلاق المتوقع محدد',
  decision_maker:'صاحب القرار لدى العميل مسجّل',
  budget_note:'سند ميزانية العميل مكتوب',
  next_step:'الخطوة التالية وموعدها',
  estimate_linked:'تقدير مرفوع للاعتماد أو معتمد مرتبط بالفرصة',
  estimate_approved:'تقدير معتمد مرتبط بالفرصة'
};
export const ACTIVITY_KINDS={meeting:'اجتماع',call:'اتصال',message:'مراسلة',proposal:'عرض أو مستند',other:'نشاط آخر'};
export const STAGE_STATUS={draft:'بانتظار الاعتماد',approved:'معتمدة',rejected:'مرفوضة',retired:'مسحوبة'};
// حالات الفرصة الثلاث بعبارات شاشتها («إغلاق رابحة»، «إغلاق خاسرة»). هي الافتراض الذي يعلوه تعريف الصفحة المنشور إن بدّل عبارة.
export const OPPORTUNITY_STATUS={open:'مفتوحة',won:'رابحة',lost:'خاسرة'};
const FORECAST_WARNING='هذا تقدير لا إيراد: مجموع (قيمة الفرصة × احتمال مرحلتها)، والاحتمالات أرقام يدوية أدخلها مالك الإجراء من تجربة الشركة. لا يدخل أي تقرير مالي ولا يُبنى عليه التزام.';

const hasEstimate=(db,o,statuses)=>!!db.prepare(`SELECT 1 FROM estimates WHERE opportunity_id=? AND status IN (${statuses.map(()=>'?').join(',')})`).get(o.id,...statuses);
const CHECKS={
  value_entered:o=>o.value_minor>0,
  expected_close:o=>!!o.expected_close_on,
  decision_maker:o=>o.decision_maker.trim().length>=3,
  budget_note:o=>o.budget_note.trim().length>=5,
  next_step:o=>o.next_step.trim().length>=3&&!!o.next_step_on,
  estimate_linked:(o,db)=>hasEstimate(db,o,['submitted','approved']),
  estimate_approved:(o,db)=>hasEstimate(db,o,['approved'])
};
const missing=(db,o,stage)=>stage.required.filter(key=>!CHECKS[key](o,db));

function percent(value,label){
  if(typeof value!=='string'||!/^(0|[1-9]\d?|100)(\.\d{1,2})?$/.test(value))fail(400,'invalid_percent',`${label}: نسبة مئوية من 0 إلى 100 بمنزلتين كحد أقصى`);
  const [whole,fraction='']=value.split('.'),points=Number(whole)*100+Number(fraction.padEnd(2,'0'));
  if(points>10000)fail(400,'invalid_percent',`${label}: لا تتجاوز 100`);
  return points;
}
const weighted=(valueMinor,bp)=>Number((BigInt(valueMinor)*BigInt(bp)+5000n)/10000n);
const stageRow=r=>({...r,required:JSON.parse(r.required_fields)});
const liveStages=(db,tenantId)=>db.prepare("SELECT * FROM pipeline_stages WHERE tenant_id=? AND status='approved' ORDER BY sort_order,code").all(tenantId).map(stageRow);

/* ───── إعداد المراحل وأسباب الخسارة ───── */
function stageView(db,u,r,openCount){
  const actions=[];
  if(r.status==='draft'&&r.prepared_by!==u.id)actions.push('approve_stage','reject_stage');
  if(r.status==='approved')actions.push('revise_stage',...(openCount?[]:['retire_stage']));
  return {...stageRow(r),required_names:JSON.parse(r.required_fields).map(k=>STAGE_REQUIREMENTS[k]),status_name:STAGE_STATUS[r.status],win_probability:(r.win_probability_bp/100).toFixed(2),
    prepared_by_name:nameOf(db,r.prepared_by),decided_by_name:nameOf(db,r.decided_by),open_count:openCount,actions};
}
export function prepareStage(db,supplied,input){
  writing(db);const {u}=seller(db,supplied);
  v.object(input,['code','name','sort_order','win_probability','probability_basis','confirmed_on','required_fields','idle_days']);
  const stageCode=code(input.code,'رمز المرحلة');
  if(!Number.isInteger(input.sort_order)||input.sort_order<1||input.sort_order>99)fail(400,'sort_order','ترتيب المرحلة عدد من 1 إلى 99');
  if(!Number.isInteger(input.idle_days)||input.idle_days<1||input.idle_days>365)fail(400,'idle_days','عتبة الخمول بالأيام من 1 إلى 365. لا عتبة افتراضية: يحددها مالك الإجراء');
  if(!Array.isArray(input.required_fields)||new Set(input.required_fields).size!==input.required_fields.length||input.required_fields.some(k=>!Object.hasOwn(STAGE_REQUIREMENTS,k)))fail(400,'required_fields','اختر الشروط من القائمة دون تكرار');
  const confirmed=v.date(input.confirmed_on);if(confirmed>today())fail(400,'confirmed_on','تاريخ تأكيد الاحتمال اليوم أو قبله');
  if(db.prepare("SELECT 1 FROM pipeline_stages WHERE tenant_id=? AND code=? AND status='draft'").get(u.tenant_id,stageCode))fail(409,'draft_exists','لهذه المرحلة نسخة بانتظار الاعتماد');
  const revision=db.prepare('SELECT COALESCE(MAX(revision),0)+1 AS n FROM pipeline_stages WHERE tenant_id=? AND code=?').get(u.tenant_id,stageCode).n,stageId=id(),time=now();
  db.prepare("INSERT INTO pipeline_stages(id,tenant_id,code,revision,name,sort_order,win_probability_bp,probability_basis,confirmed_on,required_fields,idle_days,status,prepared_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,'draft',?,?,?)")
    .run(stageId,u.tenant_id,stageCode,revision,v.text(input.name,'اسم المرحلة',120,2),input.sort_order,percent(input.win_probability,'احتمال الفوز'),v.text(input.probability_basis,'سند الاحتمال من تجربة الشركة',1500,10),confirmed,JSON.stringify(input.required_fields),input.idle_days,u.id,time,time);
  audit(db,u,'pipeline_stage',stageId,'stage.prepared',{}, {code:stageCode,revision});
  return {id:stageId};
}
export function stageAction(db,supplied,stageId,action,input){
  writing(db);const {u}=seller(db,supplied);
  v.object(input,['version','note']);
  const r=typeof stageId==='string'&&db.prepare('SELECT * FROM pipeline_stages WHERE id=? AND tenant_id=?').get(stageId,u.tenant_id);
  if(!r)fail(404,'not_found','المرحلة غير متاحة');
  v.version(input.version,r.version);
  if(r.status==='draft'&&r.prepared_by===u.id&&action!=='retire_stage')fail(403,'self_approval','من أعدّ المرحلة واحتمالها لا يعتمدها');
  const open=db.prepare("SELECT COUNT(*) AS n FROM opportunities WHERE tenant_id=? AND stage_code=? AND status='open'").get(u.tenant_id,r.code).n;
  if(!['approve_stage','reject_stage','retire_stage'].includes(action)||!stageView(db,u,r,open).actions.includes(action))fail(409,'action_unavailable',action==='retire_stage'&&open?'في المرحلة فرص مفتوحة. انقلها قبل سحب المرحلة':'الإجراء غير متاح في حالة المرحلة');
  const status={approve_stage:'approved',reject_stage:'rejected',retire_stage:'retired'}[action],time=now(),note=v.text(input.note,'أساس القرار',1500,status==='approved'?3:10);
  // سبب السحب في سجل التدقيق؛ أساس الاعتماد الأصلي لا يُكتب فوقه.
  if(status==='retired')db.prepare("UPDATE pipeline_stages SET status='retired',version=version+1,updated_at=? WHERE id=?").run(time,r.id);
  else{
    // اعتماد نسخة جديدة يسحب السارية أولًا: لا احتمالان لمرحلة واحدة في التوقع.
    if(status==='approved')db.prepare("UPDATE pipeline_stages SET status='retired',version=version+1,updated_at=? WHERE tenant_id=? AND code=? AND status='approved'").run(time,u.tenant_id,r.code);
    db.prepare('UPDATE pipeline_stages SET status=?,decided_by=?,decided_at=?,decision_note=?,version=version+1,updated_at=? WHERE id=?').run(status,u.id,time,note,time,r.id);
  }
  audit(db,u,'pipeline_stage',r.id,'stage.'+status,{status:r.status,version:r.version},{status,version:r.version+1},note);
  return {id:r.id,status};
}
export function addLossReason(db,supplied,input){
  writing(db);const {u}=seller(db,supplied);
  v.object(input,['code','name']);
  const reasonCode=code(input.code,'رمز السبب');
  if(db.prepare('SELECT 1 FROM pipeline_loss_reasons WHERE tenant_id=? AND code=?').get(u.tenant_id,reasonCode))fail(409,'duplicate_reason','يوجد سبب بهذا الرمز');
  const reasonId=id(),time=now();
  db.prepare('INSERT INTO pipeline_loss_reasons(id,tenant_id,code,name,created_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?)').run(reasonId,u.tenant_id,reasonCode,v.text(input.name,'سبب الخسارة',160,3),u.id,time,time);
  audit(db,u,'loss_reason',reasonId,'loss_reason.added',{}, {code:reasonCode});
  return {id:reasonId};
}
export function lossReasonAction(db,supplied,reasonId,action,input){
  writing(db);const {u}=seller(db,supplied);
  v.object(input,['version']);
  const r=typeof reasonId==='string'&&db.prepare('SELECT * FROM pipeline_loss_reasons WHERE id=? AND tenant_id=?').get(reasonId,u.tenant_id);
  if(!r||action!==(r.active?'deactivate_reason':'activate_reason'))fail(404,'not_found','السبب أو الإجراء غير متاح');
  v.version(input.version,r.version);
  db.prepare('UPDATE pipeline_loss_reasons SET active=?,version=version+1,updated_at=? WHERE id=?').run(r.active?0:1,now(),r.id);
  audit(db,u,'loss_reason',r.id,'loss_reason.'+(r.active?'deactivated':'activated'),{active:!!r.active},{active:!r.active});
  return {id:r.id,active:!r.active};
}

/* ───── الفرص ───── */
function opportunityRow(db,supplied,opportunityId){
  const row=typeof opportunityId==='string'&&db.prepare('SELECT * FROM opportunities WHERE id=?').get(opportunityId);
  if(!row)fail(404,'not_found','الفرصة غير متاحة');
  const {u,c}=sellerClient(db,supplied,row.client_id);
  if(row.tenant_id!==u.tenant_id)fail(404,'not_found','الفرصة غير متاحة');
  return {u,c,row};
}
// projectRow: مُسقِط الحقول المخصّصة (ترحيل 123)، يُبنى مرة في اللوحة. يُنشر بعد {...o} فيكتب فوق العمود الخام بالكائن المحجوب لهذا القارئ.
function opportunityView(db,u,o,clientRow,stages,date,projectRow=projector(db,u,'opportunity')){
  const stage=stages.find(s=>s.code===o.stage_code)??null,mine=o.owner_id===u.id,open=o.status==='open';
  const idle=open?Math.max(0,daysBetween(o.last_activity_on,date)):null,actions=[];
  if(open)actions.push('log_activity');
  if(open&&mine)actions.push('edit_opportunity','move_stage','close_won','close_lost');
  // فتح الصفقة من الفرصة لصاحبها أو لمسؤول حساب العميل، مرة واحدة (commercial.createCaseFromOpportunity).
  if(open&&!o.case_id&&(mine||clientRow.owner_id===u.id))actions.push('open_case');
  const deal=o.case_id?db.prepare('SELECT id,status FROM commercial_cases WHERE id=? AND tenant_id=?').get(o.case_id,o.tenant_id):null;
  return {...o,...projectRow(o),status_name:statusLabel(db,u.tenant_id,'opportunity',o.status,OPPORTUNITY_STATUS[o.status]),client_name:clientRow.trade_name||clientRow.legal_name,sector:clientRow.sector,family_name:FAMILIES.find(f=>f.key===o.service_family)?.name??o.service_family,owner_name:nameOf(db,o.owner_id),is_mine:mine,
    stage_name:stage?.name??null,stage_missing:open&&!stage,win_probability_bp:open&&stage?stage.win_probability_bp:null,weighted_minor:open&&stage?weighted(o.value_minor,stage.win_probability_bp):null,
    days_idle:idle,idle_threshold:stage?.idle_days??null,stale:open&&!!stage&&idle>=stage.idle_days,
    // ما يمنع الانتقال إلى كل مرحلة، ليرى صاحب الفرصة المطلوب قبل أن يحاول.
    moves:open&&mine?stages.filter(s=>s.code!==o.stage_code).map(s=>({code:s.code,name:s.name,missing:missing(db,o,s).map(k=>STAGE_REQUIREMENTS[k])})):[],
    activities:db.prepare('SELECT a.*,x.name AS recorded_by_name FROM opportunity_activities a JOIN users x ON x.id=a.recorded_by WHERE a.opportunity_id=? ORDER BY a.activity_date DESC,a.created_at DESC LIMIT 20').all(o.id).map(a=>({...a,kind_name:ACTIVITY_KINDS[a.kind]})),
    history:db.prepare('SELECT e.*,x.name AS moved_by_name FROM opportunity_stage_events e JOIN users x ON x.id=e.moved_by WHERE e.opportunity_id=? ORDER BY e.created_at').all(o.id),
    loss_reason_name:o.loss_reason_id?db.prepare('SELECT name FROM pipeline_loss_reasons WHERE id=?').get(o.loss_reason_id)?.name??null:null,
    deal:deal?{id:deal.id,ref:dealRef(deal.id),status:deal.status,contracted:CONTRACTED.includes(deal.status)}:null,
    // فرصة التجديد (الترحيل 185): العقد الذي تجدّده ونطاقه وبنوده وأسعاره كما نُسخت لحظة فتحها.
    renewal:o.kind==='renewal'?JSON.parse(o.renewal_basis):null,actions};
}
const DETAIL=['name','service_family','value','expected_close_on','decision_maker','budget_note','next_step','next_step_on'];
function cleanDetail(input){
  if(!FAMILIES.some(f=>f.key===input.service_family))fail(400,'service_family','اختر نوع الخدمة');
  const optional=(value,label,max)=>value?v.text(value,label,max):'';
  const step=optional(input.next_step,'الخطوة التالية',500),stepOn=input.next_step_on?v.date(input.next_step_on):null;
  if(!!step!==!!stepOn)fail(400,'next_step','الخطوة التالية تُكتب مع موعدها');
  return {name:v.text(input.name,'اسم الفرصة',180,3),service_family:input.service_family,value_minor:money(input.value,'قيمة الفرصة',{zero:true}),expected_close_on:input.expected_close_on?v.date(input.expected_close_on):null,
    decision_maker:optional(input.decision_maker,'صاحب القرار',300),budget_note:optional(input.budget_note,'سند الميزانية',1000),next_step:step,next_step_on:stepOn};
}
// شروط المرحلة بيانات يعتمدها شخص غير من أعدّها (pipeline_stages.required_fields)، وإليها تنضم هنا الحقول المخصّصة التي يُلزمها
// تعريف الصفحة المنشور عند «نقل الفرصة»: آلية واحدة ورفض واحد يسمّي الناقص من الجهتين، لا بوابتان متجاورتان.
// custom: نتيجة forTransition حين يكون هذا نقلًا لفرصة قائمة؛ الإنشاء ليس نقلًا، وإلزامه العام يحكمه prepare(creating).
const OPPORTUNITY_OWNER='صاحب الفرصة في فريق حساب العميل';
function requireStage(db,u,o,stageCode,{gate=null}={}){
  const stage=liveStages(db,u.tenant_id).find(s=>s.code===stageCode);
  if(!stage)refuse(400,'stage',{what:'المرحلة المطلوبة ليست مرحلة معتمدة سارية',next:'اختر مرحلة من القائمة. مرحلة جديدة يعرّفها مالك الإجراء ويعتمدها شخص آخر من شاشة الفرص'});
  const open=missing(db,o,stage);
  let custom=null;
  try{custom=gate?gate():null;}catch(error){
    // الحقول المخصّصة الناقصة تُضم إلى شروط المرحلة الناقصة في رفض واحد؛ أي رفض آخر من البوابة يمر كما هو.
    if(error.code!=='required_on_transition')throw error;
    refuse(409,'stage_requirements',{what:`لا تنتقل الفرصة إلى «${stage.name}» قبل استيفاء شروطها`,
      missing:[...open.map(k=>({document:STAGE_REQUIREMENTS[k],why:`شرط المرحلة «${stage.name}» بنسختها المعتمدة ${stage.revision}`,owner:OPPORTUNITY_OWNER,owner_role:'pm',doc_key:k})),...error.details.refusal.missing],
      next:error.details.refusal.next,link:error.details.refusal.link});
  }
  if(open.length)refuse(409,'stage_requirements',{what:`لا تنتقل الفرصة إلى «${stage.name}» قبل استيفاء شروطها`,
    missing:open.map(k=>({document:STAGE_REQUIREMENTS[k],why:`شرط المرحلة «${stage.name}» بنسختها المعتمدة ${stage.revision}`,owner:OPPORTUNITY_OWNER,owner_role:'pm',doc_key:k})),
    next:'أكمل الناقص في بيانات الفرصة ثم أعد النقل'});
  return {stage,custom};
}
// renewal (P4-CRM-6، الترحيل 185): خيار داخلي لا يصل من الطلب — app/client-renewals.mjs وحده يفتح فرصة التجديد من عقدها،
// بنطاق العقد السابق وأسعاره لقطةً ثابتة. الطلب العادي يبقى «فرصة جديدة» كما كان.
export function createOpportunity(db,supplied,input,{renewal=null}={}){
  writing(db);v.object(input,['client_id','stage_code','custom_fields',...DETAIL]);
  const {custom_fields:customInput,...detail}=input;
  const {u,c}=sellerClient(db,supplied,input.client_id),f=cleanDetail(detail),opportunityId=id(),time=now(),date=today();
  assertClientOpen(db,u.tenant_id,c.id,'ما تنفتح فرصة');
  // فرصة جديدة لا تقدير لها بعد، فشروط التقدير تمنع بدءها من مرحلة متأخرة؛ هذا هو المقصود.
  const {stage}=requireStage(db,u,{id:opportunityId,...f},input.stage_code);
  const custom=prepare(db,u,'opportunity',null,customInput,{creating:true});
  db.prepare(`INSERT INTO opportunities(id,tenant_id,client_id,name,service_family,value_minor,stage_code,owner_id,status,expected_close_on,decision_maker,budget_note,next_step,next_step_on,last_activity_on,created_at,updated_at,custom_fields${renewal?',kind,renews_contract_id,renewal_basis':''}) VALUES(?,?,?,?,?,?,?,?,'open',?,?,?,?,?,?,?,?,?${renewal?",'renewal',?,?":''})`)
    .run(opportunityId,u.tenant_id,c.id,f.name,f.service_family,f.value_minor,stage.code,u.id,f.expected_close_on,f.decision_maker,f.budget_note,f.next_step,f.next_step_on,date,time,time,custom.json,...(renewal?[renewal.contract_id,JSON.stringify(renewal.basis)]:[]));
  db.prepare('INSERT INTO opportunity_stage_events(id,opportunity_id,to_stage,stage_revision,requirements_met,moved_by,created_at) VALUES(?,?,?,?,?,?,?)').run(id(),opportunityId,stage.code,stage.revision,JSON.stringify(stage.required),u.id,time);
  audit(db,u,'opportunity',opportunityId,'opportunity.created',{}, {client:c.code,stage:stage.code,value_minor:f.value_minor,definition_version:custom.version,...(renewal?{kind:'renewal',renews_contract_id:renewal.contract_id}:{})});
  custom.audit(opportunityId);
  return {id:opportunityId};
}
export function opportunityAction(db,supplied,opportunityId,action,input){
  writing(db);const {u,c,row}=opportunityRow(db,supplied,opportunityId),stages=liveStages(db,u.tenant_id),date=today();
  const key={edit:'edit_opportunity',activity:'log_activity',move:'move_stage',win:'close_won',lose:'close_lost'}[action];
  if(!key||!opportunityView(db,u,row,c,stages,date).actions.includes(key))fail(409,'action_unavailable','الإجراء غير متاح في حالة الفرصة أو لحسابك. تحريك الفرصة وإغلاقها لصاحبها');
  v.version(input?.version,row.version);
  // الحقول المخصّصة تُكتب في UPDATE الإجراء نفسه (جملة واحدة)، فزناد النسخة ونهائية الفرصة المغلقة يحكمانها مع بقية الصف.
  let customResult=null;
  const time=now(),bump=(fields,values)=>db.prepare(`UPDATE opportunities SET ${fields}${customResult?',custom_fields=?':''},version=version+1,updated_at=? WHERE id=? AND version=?`).run(...values,...(customResult?[customResult.json]:[]),time,row.id,row.version);
  let after={};
  if(action==='edit'){
    v.object(input,['version','custom_fields',...DETAIL]);const {custom_fields:customInput,...detail}=input;
    const f=cleanDetail(detail),current=stages.find(s=>s.code===row.stage_code);
    customResult=prepare(db,u,'opportunity',row,customInput);
    // لا يُفرَّغ حقل تشترطه المرحلة الحالية: الشرط يبقى مستوفى ما بقيت الفرصة فيها.
    const open=current?missing(db,{...row,...f},current):[];
    if(open.length)fail(409,'stage_requirements',`المرحلة الحالية تشترط: ${open.map(k=>STAGE_REQUIREMENTS[k]).join('؛ ')}`);
    bump('name=?,service_family=?,value_minor=?,expected_close_on=?,decision_maker=?,budget_note=?,next_step=?,next_step_on=?',[f.name,f.service_family,f.value_minor,f.expected_close_on,f.decision_maker,f.budget_note,f.next_step,f.next_step_on]);
    after={value_minor:f.value_minor};
  }else if(action==='activity'){
    v.object(input,['version','activity_date','kind','note']);
    if(!Object.hasOwn(ACTIVITY_KINDS,input.kind))fail(400,'kind','اختر نوع النشاط');
    const on=v.date(input.activity_date);if(on>date||on<riyadhDateOf(row.created_at))fail(400,'activity_date','تاريخ النشاط بين إنشاء الفرصة واليوم');
    db.prepare('INSERT INTO opportunity_activities(id,opportunity_id,activity_date,kind,note,recorded_by,created_at) VALUES(?,?,?,?,?,?,?)').run(id(),row.id,on,input.kind,v.text(input.note,'ما الذي جرى',1500,5),u.id,time);
    // نشاط بتاريخ أقدم من آخر نشاط لا يعيد العداد إلى الوراء.
    bump('last_activity_on=?',[on>row.last_activity_on?on:row.last_activity_on]);after={activity_date:on,kind:input.kind};
  }else if(action==='move'){
    v.object(input,['version','stage_code','note','custom_fields']);
    if(input.stage_code===row.stage_code)fail(400,'stage','الفرصة في هذه المرحلة بالفعل');
    const {stage,custom}=requireStage(db,u,row,input.stage_code,{gate:()=>forTransition(db,u,'opportunity',row,'move',input.custom_fields)}),note=input.note?v.text(input.note,'ملاحظة الانتقال',1000):'';
    customResult=custom;
    db.prepare('INSERT INTO opportunity_stage_events(id,opportunity_id,from_stage,to_stage,stage_revision,requirements_met,note,moved_by,created_at) VALUES(?,?,?,?,?,?,?,?,?)').run(id(),row.id,row.stage_code,stage.code,stage.revision,JSON.stringify(stage.required),note,u.id,time);
    // عتبة الخمول لكل مرحلة، فالعداد يبدأ من دخولها.
    bump('stage_code=?,last_activity_on=?',[stage.code,date]);after={stage:stage.code};
  }else if(action==='win'){
    v.object(input,['version','note','custom_fields']);
    // الفوز على اتفاق موثّق على صفقة الفرصة نفسها (CRM-09): قبله كان سطر ملاحظة يكفي، فيصير رقمًا في تقرير لا اتفاق خلفه.
    const deal=contractedDeal(db,u,row);
    customResult=forTransition(db,u,'opportunity',row,'win',input.custom_fields);
    const note=input.note?v.text(input.note,'سند الفوز (موافقة العميل أو مرجع العقد)',1500,5):`اتفاق موثّق على الصفقة ${dealRef(deal.id)}`;
    bump("status='won',close_note=?,closed_on=?,closed_by=?",[note,date,u.id]);after={status:'won',case_id:deal.id};
    // تسليمٌ إلى فريق الحساب: مسؤوله وأعضاؤه وصاحب الصفقة، إلا من أغلق.
    const team=[c.owner_id,deal.owner_id,...db.prepare('SELECT user_id FROM client_members WHERE client_id=? AND removed_at IS NULL').all(c.id).map(r=>r.user_id)];
    notifyMany(db,team,u.id,{kind:'opportunity_won',subjectKind:'opportunity',subjectId:row.id,title:`انقفلت الفرصة «${row.name}» رابحة`,
      body:'اتفاقها موثّق على الصفقة. الخطوة الجاية: فتح المشروع وتسليمه للتشغيل من «العملاء والعروض».'});
  }else{
    v.object(input,['version','loss_reason_id','comment','custom_fields']);
    const reason=typeof input.loss_reason_id==='string'&&db.prepare('SELECT * FROM pipeline_loss_reasons WHERE id=? AND tenant_id=? AND active=1').get(input.loss_reason_id,u.tenant_id);
    if(!reason)fail(400,'loss_reason_required','سبب الخسارة إلزامي ومن القائمة السارية');
    const comment=v.text(input.comment,'تعليق الخسارة: ماذا حدث وماذا نتعلم',2000,10);
    // صفقة الفرصة: المتعاقد عليها تمنع الخسارة، وما قبل التعاقد تُغلق خاسرة معها بالسبب نفسه.
    const deal=row.case_id?db.prepare('SELECT * FROM commercial_cases WHERE id=? AND tenant_id=?').get(row.case_id,u.tenant_id):null;
    if(deal&&CONTRACTED.includes(deal.status))refuse(409,'deal_contracted',{what:`الفرصة «${row.name}» عليها اتفاق موثّق، فما تنقفل خاسرة`,
      missing:[{document:`الصفقة ${dealRef(deal.id)} المتعاقد عليها`,why:'الاتفاق قائم، فالفرصة تنقفل رابحة. إنهاء الاتفاق مسار آخر لا خسارة فرصة',owner:personName(db,deal.owner_id)??OPPORTUNITY_OWNER,owner_role:'account_manager',doc_key:'deal'}],
      next:'أغلق الفرصة رابحة. وإذا انتهى الاتفاق، يُعالج من الصفقة نفسها'});
    customResult=forTransition(db,u,'opportunity',row,'lose',input.custom_fields);
    bump("status='lost',loss_reason_id=?,loss_comment=?,closed_on=?,closed_by=?",[reason.id,comment,date,u.id]);after={status:'lost',loss_reason:reason.code,...(deal?{case_id:deal.id}:{})};
    if(deal&&PRE_CONTRACT.includes(deal.status))closeDealRow(db,u,deal,{status:'lost',reason,comment,via:{opportunity_id:row.id,action:'lose'}});
  }
  audit(db,u,'opportunity',row.id,'opportunity.'+action,{status:row.status,stage:row.stage_code,version:row.version},{...after,version:row.version+1,...(customResult?{definition_version:customResult.version}:{})});
  customResult?.audit(row.id);
  return {id:row.id};
}

// ما ينقص الفوز، بترتيب الطريق إليه: صفقة مفتوحة من الفرصة، ثم تأهيلها المعتمد، ثم عرضها المعتمد، ثم الاتفاق الموثّق.
// كل بند يسمّي من يملكه الآن: القرار المعلّق يسمّي معتمده بعينه، وما لم يُرفع بعد يسمّي صاحب الصفقة.
function contractedDeal(db,u,row){
  const deal=row.case_id?db.prepare('SELECT * FROM commercial_cases WHERE id=? AND tenant_id=?').get(row.case_id,u.tenant_id):null;
  if(deal&&CONTRACTED.includes(deal.status))return deal;
  const ownerName=personName(db,deal?.owner_id??row.owner_id)??OPPORTUNITY_OWNER;
  const pending=kind=>{const r=deal&&db.prepare("SELECT approver_id FROM commercial_reviews WHERE case_id=? AND kind=? AND status='pending' ORDER BY requested_at DESC LIMIT 1").get(deal.id,kind);return r?personName(db,r.approver_id):null;};
  const step=(doc_key,document,why,owner)=>({document,why,owner,owner_role:'account_manager',doc_key});
  const missing=[];
  if(!deal)missing.push(step('deal','صفقة مفتوحة من الفرصة','الفوز يُسجَّل على اتفاق، والاتفاق يُسجَّل على صفقة',ownerName));
  else if(CLOSED_DEAL.includes(deal.status))refuse(409,'deal_closed',{what:`صفقة الفرصة «${row.name}» مقفلة`,next:'افتح فرصة جديدة إذا رجع العميل'});
  else{
    if(['lead','qualification_pending','qualification_rejected'].includes(deal.status))
      missing.push(step('qualification_approval','اعتماد التأهيل',deal.status==='qualification_pending'?'التأهيل مرفوع وينتظر القرار':'التأهيل ما رُفع أو رُفض',deal.status==='qualification_pending'?pending('qualification')??ownerName:ownerName));
    if(deal.status!=='quote_approved')
      missing.push(step('approved_quote','العرض المعتمد',deal.status==='quote_pending'?'العرض مرفوع وينتظر القرار':'العرض ما اعتُمد بعد',deal.status==='quote_pending'?pending('quote')??ownerName:ownerName));
    missing.push(step('registered_agreement','الاتفاق الموثّق على العرض المعتمد','الفوز يعني اتفاقًا قائمًا بدليله وممثل العميل',ownerName));
  }
  refuse(409,'contract_required',{what:`ما تنقفل الفرصة «${row.name}» رابحة قبل ما يتوثّق اتفاقها`,missing,
    next:deal?'كمّل الناقص على الصفقة من «العملاء والعروض»، ثم ارجع أغلق الفرصة رابحة':'افتح صفقة من الفرصة («فتح صفقة»)، وكمّل التأهيل والعرض والاتفاق عليها'});
}
// تغلق الفرصة خاسرةً لأن صفقتها انقفلت (commercial: close_lost أو withdraw). المنادي فحص صلاحيته على الصفقة؛
// بوابة الحقول المخصّصة عند «إغلاق الفرصة خاسرة» تحكم هنا كما تحكم في الإغلاق المباشر.
export function loseOpportunityRow(db,u,row,{reason,comment,via}){
  const custom=forTransition(db,u,'opportunity',row,'lose',undefined),time=now();
  const changed=db.prepare("UPDATE opportunities SET status='lost',loss_reason_id=?,loss_comment=?,closed_on=?,closed_by=?,custom_fields=?,version=version+1,updated_at=? WHERE id=? AND version=?")
    .run(reason.id,comment,today(),u.id,custom.json,time,row.id,row.version).changes;
  if(changed!==1)refuse(409,'stale_version',{what:'الفرصة تغيّرت قبل ما تنقفل مع صفقتها',next:'حدّث الصفحة وأعد المحاولة'});
  audit(db,u,'opportunity',row.id,'opportunity.lose',{status:row.status,stage:row.stage_code,version:row.version},{status:'lost',loss_reason:reason.code,version:row.version+1,via,definition_version:custom.version});
  custom.audit(row.id);
}

/* ───── تقرير الفوز والخسارة ───── */
function tally(rows,keyOf,nameOfKey){
  const groups=new Map();
  for(const r of rows){const key=keyOf(r),g=groups.get(key)??{key,name:nameOfKey(r),won_count:0,won_value_minor:0,lost_count:0,lost_value_minor:0};g[`${r.status}_count`]++;g[`${r.status}_value_minor`]+=r.value_minor;groups.set(key,g);}
  // نسبة الفوز محسوبة من السجلات المغلقة نفسها، لا رقمًا مدخلًا. مجموعة بلا إغلاقات لا نسبة لها.
  return [...groups.values()].map(g=>({...g,win_rate_count_bp:Math.round(g.won_count*10000/(g.won_count+g.lost_count)),win_rate_value_bp:g.won_value_minor+g.lost_value_minor?Math.round(g.won_value_minor*10000/(g.won_value_minor+g.lost_value_minor)):null})).sort((a,b)=>b.lost_value_minor+b.won_value_minor-a.lost_value_minor-a.won_value_minor);
}
function winLoss(views,from,to){
  const closed=views.filter(o=>o.status!=='open'&&o.closed_on>=from&&o.closed_on<=to),lost=closed.filter(o=>o.status==='lost'),total=tally(closed,()=>'all',()=>'الإجمالي')[0]??null;
  const months=new Map();
  for(const o of lost){const key=`${o.closed_on.slice(0,7)}|${o.loss_reason_id}`,m=months.get(key)??{month:o.closed_on.slice(0,7),reason:o.loss_reason_name,count:0,value_minor:0};m.count++;m.value_minor+=o.value_minor;months.set(key,m);}
  return {from,to,total,
    by_reason:tally(lost,o=>o.loss_reason_id,o=>o.loss_reason_name).map(({key,name,lost_count,lost_value_minor})=>({key,name,count:lost_count,value_minor:lost_value_minor})),
    by_sector:tally(closed,o=>o.sector,o=>o.sector),by_family:tally(closed,o=>o.service_family,o=>o.family_name),
    loss_by_month:[...months.values()].sort((a,b)=>a.month.localeCompare(b.month)||b.value_minor-a.value_minor),
    comments:lost.map(o=>({id:o.id,name:o.name,client_name:o.client_name,closed_on:o.closed_on,reason:o.loss_reason_name,comment:o.loss_comment,value_minor:o.value_minor})).sort((a,b)=>b.closed_on.localeCompare(a.closed_on)).slice(0,50)};
}

/* ───── توقع محفظة الكيان: شكل القمع للرئيس التنفيذي، لا قائمة صفقات ───── */
// العلة: `pipelineBoard` يمر بـ `seller()` ثم `memberClients()`، فالرئيس التنفيذي الذي ليس
// في فريق حساب واحد يرى قمعًا فارغًا. هذه دالة ثانية ببوابتها الخاصة، ولم يُمسّ `seller()`
// لأنه يحرس مسارات الكتابة أيضًا: توسيعه توسيعٌ للكتابة لا للقراءة.
//
// وما يعود منها مجاميع فقط، وفق مذهب اللوحة التنفيذية «أرقام مجمّعة للكيان، دون عناوين
// الطلبات أو أسماء أصحابها»: لا اسم فرصة، ولا اسم عميل، ولا اسم مالك، ولا خطوة تالية،
// ولا تعليق خسارة. الضمان بنيوي لا وعد في تعليق: الأعمدة الخمسة المقروءة أدناه هي كل ما
// يغادر قاعدة البيانات، فالنص الحر لا طريق له إلى المخرج أصلًا. قائمة الصفقات تبقى لفريق
// الحساب في `pipelineBoard`.
export function portfolioForecast(db,supplied,{from,to}={}){
  const u=supplied&&db.prepare('SELECT * FROM users WHERE id=? AND tenant_id=? AND active=1').get(supplied.id,supplied.tenant_id);
  if(!u)fail(403,'forbidden','الحساب غير متاح أو موقوف. سجّل الدخول من جديد، أو راجع مسؤول المنصة');
  if(!can(db,u,'executive.view'))fail(403,'not_permitted','توقع محفظة الكيان لحامل تصريح «اللوحة التنفيذية». اطلبه من مسؤول الصلاحيات');
  const date=today();
  const start=from?v.date(from):new Date(Date.parse(date)-365*86400000).toISOString().slice(0,10),end=to?v.date(to):date;
  if(end<start)fail(400,'date_order','نهاية الفترة يجب أن تأتي بعد بدايتها. صحّح التاريخين وأعد المحاولة');
  const rows=db.prepare('SELECT stage_code,status,value_minor,loss_reason_id,closed_on FROM opportunities WHERE tenant_id=?').all(u.tenant_id);
  const stages=liveStages(db,u.tenant_id),byCode=new Map(stages.map(s=>[s.code,s]));
  const open=rows.filter(o=>o.status==='open'),counted=open.filter(o=>byCode.has(o.stage_code));
  const closed=rows.filter(o=>o.status!=='open'&&o.closed_on&&o.closed_on>=start&&o.closed_on<=end);
  const won=closed.filter(o=>o.status==='won'),lost=closed.filter(o=>o.status==='lost');
  const sum=list=>list.reduce((n,o)=>n+o.value_minor,0);
  // النسبة محسوبة من المغلقات نفسها لا رقمًا مدخلًا، وبلا إغلاقات لا نسبة: لا صفر يوهم بالخسارة.
  const rate=(a,b)=>a+b?Math.round(a*10000/(a+b)):null;
  const reasons=new Map(db.prepare('SELECT id,code,name FROM pipeline_loss_reasons WHERE tenant_id=?').all(u.tenant_id).map(r=>[r.id,r]));
  const byReason=new Map();
  for(const o of lost){
    const reason=reasons.get(o.loss_reason_id),key=o.loss_reason_id??'',row=byReason.get(key)??{code:reason?.code??'',name:reason?.name??'سبب غير مسجل',count:0,value_minor:0};
    row.count++;row.value_minor+=o.value_minor;byReason.set(key,row);
  }
  return {today:date,from:start,to:end,user_id:u.id,scope:'tenant',capability:'executive.view',
    warning:FORECAST_WARNING,
    open_count:open.length,open_value_minor:sum(open),
    weighted_minor:counted.reduce((n,o)=>n+weighted(o.value_minor,byCode.get(o.stage_code).win_probability_bp),0),
    // فرص مفتوحة في مرحلة لم تعد معتمدة: خارج الوزن ومعدودة صراحةً، فلا تختفي من المجموع صامتة.
    unweighted_count:open.length-counted.length,
    by_stage:stages.map(s=>{const list=open.filter(o=>o.stage_code===s.code);
      return {code:s.code,name:s.name,sort_order:s.sort_order,win_probability_bp:s.win_probability_bp,probability_basis:s.probability_basis,confirmed_on:s.confirmed_on,
        count:list.length,value_minor:sum(list),weighted_minor:list.reduce((n,o)=>n+weighted(o.value_minor,s.win_probability_bp),0)};}),
    closed:{won_count:won.length,lost_count:lost.length,won_value_minor:sum(won),lost_value_minor:sum(lost),
      win_rate_count_bp:rate(won.length,lost.length),win_rate_value_bp:rate(sum(won),sum(lost))},
    loss_reasons:[...byReason.values()].sort((a,b)=>b.value_minor-a.value_minor||b.count-a.count),
    note:'محفظة الكيان بأعدادها وقيمها: المراحل والاحتمالات وأسباب الخسارة كلها من إدخال مالك الإجراء لا من الكود. '
      +'لا فرصة بعينها هنا ولا عميلها ولا صاحبها: تفصيل الصفقة في شاشة «الفرص البيعية» لفريق الحساب.'};
}

/* ───── اللوحة ───── */
export function pipelineBoard(db,supplied,query={}){
  const {u,clients}=seller(db,supplied),date=today(),byId=new Map(clients.map(c=>[c.id,c]));
  const from=query.from?v.date(query.from):new Date(Date.parse(date)-365*86400000).toISOString().slice(0,10),to=query.to?v.date(query.to):date;
  if(to<from)fail(400,'date_order','نهاية الفترة يجب أن تأتي بعد بدايتها. صحّح التاريخين وأعد المحاولة');
  const stages=liveStages(db,u.tenant_id),marks=clients.map(()=>'?').join(',');
  const sectors=new Map(clients.length?db.prepare(`SELECT id,sector FROM clients WHERE id IN (${marks})`).all(...clients.map(c=>c.id)).map(c=>[c.id,c.sector]):[]);
  const rows=clients.length?db.prepare(`SELECT * FROM opportunities WHERE tenant_id=? AND client_id IN (${marks}) ORDER BY status='open' DESC,updated_at DESC LIMIT 1000`).all(u.tenant_id,...clients.map(c=>c.id)):[];
  const projectRow=projector(db,u,'opportunity');
  const views=rows.map(o=>opportunityView(db,u,o,{...byId.get(o.client_id),sector:sectors.get(o.client_id)},stages,date,projectRow)),open=views.filter(o=>o.status==='open'),counted=open.filter(o=>!o.stage_missing);
  const openByStage=code_=>open.filter(o=>o.stage_code===code_);
  const allStages=db.prepare('SELECT * FROM pipeline_stages WHERE tenant_id=? ORDER BY sort_order,code,revision DESC').all(u.tenant_id).map(r=>stageView(db,u,r,r.status==='approved'?db.prepare("SELECT COUNT(*) AS n FROM opportunities WHERE tenant_id=? AND stage_code=? AND status='open'").get(u.tenant_id,r.code).n:0));
  const reasons=db.prepare('SELECT * FROM pipeline_loss_reasons WHERE tenant_id=? ORDER BY active DESC,name').all(u.tenant_id).map(r=>({...r,active:!!r.active,actions:[r.active?'deactivate_reason':'activate_reason']}));
  return {today:date,user_id:u.id,requirements:STAGE_REQUIREMENTS,activity_kinds:ACTIVITY_KINDS,families:FAMILIES,
    clients:clients.map(c=>({id:c.id,name:c.trade_name||c.legal_name})),stages,stage_revisions:allStages,loss_reasons:reasons,opportunities:views,custom_columns:columnsFor(db,u,'opportunity'),
    forecast:{warning:FORECAST_WARNING,open_count:open.length,open_value_minor:open.reduce((n,o)=>n+o.value_minor,0),weighted_minor:counted.reduce((n,o)=>n+o.weighted_minor,0),
      unweighted_count:open.length-counted.length,
      by_stage:stages.map(s=>{const list=openByStage(s.code);return {code:s.code,name:s.name,win_probability_bp:s.win_probability_bp,probability_basis:s.probability_basis,confirmed_on:s.confirmed_on,count:list.length,value_minor:list.reduce((n,o)=>n+o.value_minor,0),weighted_minor:list.reduce((n,o)=>n+o.weighted_minor,0),stale:list.filter(o=>o.stale).length};})},
    stale_mine:open.filter(o=>o.stale&&o.is_mine).map(o=>({id:o.id,name:o.name,client_name:o.client_name,stage_name:o.stage_name,days_idle:o.days_idle,idle_threshold:o.idle_threshold})),
    report:winLoss(views,from,to),
    awaiting_me:allStages.filter(s=>s.actions.includes('approve_stage')).map(s=>({id:s.id,title:`مرحلة «${s.name}» — احتمال فوز ${s.win_probability}% وعتبة خمول ${s.idle_days} يومًا`,created_at:s.created_at,actions:['approve_stage']})),
    setup_needed:[...(stages.length?[]:['لا مراحل معتمدة بعد. يعرّف مالك الإجراء المراحل باحتمال كل منها وسنده، ويعتمدها شخص آخر.']),...(reasons.some(r=>r.active)?[]:['لا أسباب خسارة سارية. لا تُغلق فرصة خاسرة قبل أن يضع مالك الإجراء القائمة.'])],
    note:'الفرص هنا متابعة داخلية لفريق الحساب: لا ربط ببريد ولا بنظام علاقات عملاء خارجي، والنشاط يُسجل يدويًا. المراحل والاحتمالات وعتبات الخمول وأسباب الخسارة كلها من إدخال مالك الإجراء؛ لا قيمة منها في الكود. '
      +'التقرير يغطي حسابات العملاء التي أنت في فريقها فقط. العقد والمشروع وميزانيته تُنشأ في شاشة «المبيعات والتسليم» القائمة لا هنا.'};
}

/* ───── واصف الكيان في سجل التعريفات (ترحيل 123) ───── */
// «مصدر الفرصة» بطبعه خاصية للفرصة، قبل العرض. والوحدة تحمل أصلًا الإلزام عند الانتقال بياناتٍ يعتمدها شخص غير معدّها
// (pipeline_stages.required_fields)، فالحقول المخصّصة الملزَمة تنضم إلى requireStage لا إلى بوابة ثانية بجوارها.
// النقل والإغلاق لصاحب الفرصة من حملة commercial.use (seller)، فذلك تصريح من ينفّذ كل انتقال.
registerEntity({key:'opportunity',table:'opportunities',label:{ar:'الفرصة',en:'Opportunity'},views:['pipeline'],
  working_capability:'commercial.use',owner:OPPORTUNITY_OWNER,owner_role:'pm',
  statuses:OPPORTUNITY_STATUS,final_statuses:['won','lost'],
  transitions:{move:{label:'نقل الفرصة إلى مرحلة',capability:'commercial.use'},win:{label:'إغلاق الفرصة رابحة',capability:'commercial.use'},lose:{label:'إغلاق الفرصة خاسرة',capability:'commercial.use'}},
  system_fields:[{key:'name',label:'اسم الفرصة',label_en:'Opportunity'},{key:'client_id',label:'العميل',label_en:'Client',ref:'client'},
    {key:'service_family',label:'نوع الخدمة',label_en:'Service family'},{key:'value',label:'القيمة المتوقعة',label_en:'Expected value',type:'number'},
    {key:'stage_code',label:'المرحلة',label_en:'Stage'},{key:'status',label:'الحالة',label_en:'Status',type:'status'},
    {key:'expected_close_on',label:'تاريخ الإغلاق المتوقع',label_en:'Expected close',type:'date'},{key:'decision_maker',label:'صاحب القرار لدى العميل',label_en:'Decision maker'},
    {key:'budget_note',label:'سند ميزانية العميل',label_en:'Budget basis'},{key:'next_step',label:'الخطوة التالية',label_en:'Next step'},{key:'owner_id',label:'صاحب الفرصة',label_en:'Owner'}],
  slots:['header','body'],slot_names:{header:'ترويسة بطاقة الفرصة',body:'متن بطاقة الفرصة'},
  code:o=>`«${o.name}»`,link:o=>`#pipeline?focus=${o.id}`,
  is_final:o=>o.status!=='open',finalised_at:o=>o.closed_on,
  readable:(db,u)=>can(db,u,'commercial.use',u.department_id),
  // التفويض على مستوى السجل هو تفويض الوحدة: تصريح المبيعات ثم عزل فريق حساب العميل؛ والكتابة لصاحب الفرصة كما في «تعديل البيانات».
  load(db,supplied,opportunityId,{write=false}={}){
    const {u,row}=opportunityRow(db,supplied,opportunityId);
    if(write&&row.owner_id!==u.id)refuse(403,'forbidden',{what:`حقول الفرصة «${row.name}» يعدّلها صاحبها`,
      missing:[{document:'صاحب الفرصة',why:'تعديل الفرصة وتحريكها وإغلاقها لصاحبها في فريق الحساب',owner:nameOf(db,row.owner_id)??OPPORTUNITY_OWNER,owner_role:'pm'}],next:'اطلب من صاحب الفرصة إدخال القيمة'});
    return row;
  },
  list(db,supplied){const {u,clients}=seller(db,supplied),ids=clients.map(c=>c.id);
    return ids.length?db.prepare(`SELECT * FROM opportunities WHERE tenant_id=? AND client_id IN (${ids.map(()=>'?').join(',')}) ORDER BY status='open' DESC,updated_at DESC LIMIT 1000`).all(u.tenant_id,...ids):[];},
  columns:[{key:'name',label:'اسم الفرصة',value:o=>o.name},
    {key:'client_id',label:'العميل',value:(o,db)=>(c=>c?c.trade_name||c.legal_name:'')(db.prepare('SELECT legal_name,trade_name FROM clients WHERE id=?').get(o.client_id))},
    {key:'service_family',label:'نوع الخدمة',value:o=>FAMILIES.find(f=>f.key===o.service_family)?.name??o.service_family},
    {key:'stage_code',label:'المرحلة',value:(o,db)=>db.prepare("SELECT name FROM pipeline_stages WHERE tenant_id=? AND code=? ORDER BY status='approved' DESC,revision DESC LIMIT 1").get(o.tenant_id,o.stage_code)?.name??o.stage_code},
    {key:'status',label:'الحالة',value:(o,db,u)=>statusLabel(db,u.tenant_id,'opportunity',o.status,OPPORTUNITY_STATUS[o.status])},
    {key:'value',label:'القيمة المتوقعة',value:o=>o.value_minor/100},
    {key:'expected_close_on',label:'تاريخ الإغلاق المتوقع',value:o=>o.expected_close_on??''},
    {key:'owner_id',label:'صاحب الفرصة',value:(o,db)=>nameOf(db,o.owner_id)??''}]});
