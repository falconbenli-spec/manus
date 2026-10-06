import { randomUUID } from 'node:crypto';
import { audit, now } from './db.mjs';
import { fail } from './auth.mjs';
import * as v from './validation.mjs';
import { currentUser } from './delegations.mjs';
import { can } from './access.mjs';
import { getRequest, serviceOf } from './workflow.mjs';
import { holidaySet, addWorkingDays, riyadhDate } from './work-calendar.mjs';
import { riyadhDayRange } from './riyadh-time.mjs';

// استقبال الطلب: ما يجعل الطلب مكتملًا قبل أن يُقدَّم، لا بعد أن يرتد.
// المنصة لا تعرف مقياس الأثر ولا العجلة في هذه الشركة، فتبدأ فارغة ويضعها مالك الإجراء بسنده.
const id=()=>randomUUID();
const today=()=>riyadhDate(Date.now());
// نافذة البحث عن طلب مكرر: تقدير تشغيلي لا قاعدة نظامية، ويراها المستخدم ويحكم بنفسه.
const DUPLICATE_WINDOW_DAYS=14;
const OPEN=['draft','pending','returned','approved','in_progress'];
// المبالغ بالهللات كبقية المنصة، والمدخل نص بريالين عشريين كحد أقصى.
function minor(value,label){
  const text=String(value).trim();
  if(!/^\d{1,10}(?:\.\d{1,2})?$/.test(text))fail(400,'invalid_amount',`${label}: اكتب مبلغ موجب، وبخانتين عشريتين على الأكثر`);
  return Math.round(Number(text)*100);
}

// الربط بسجل آخر يُقبل فقط إن كان السجل موجودًا في كيان السائل نفسه.
function linked(db,u,table,value,label){
  if(!value)return null;
  if(!db.prepare(`SELECT 1 FROM ${table} WHERE id=? AND tenant_id=?`).get(String(value),u.tenant_id))fail(400,'invalid_link',`${label}: ما لقيناه`);
  return String(value);
}
function actor(db,u){const current=currentUser(db,u);if(!current)fail(403,'forbidden','ما لقينا حسابك، ولا هو موقوف — كلّم مسؤول المنصة');return current;}
const scales=(db,tenantId,dimension)=>db.prepare('SELECT * FROM intake_scales WHERE tenant_id=? AND dimension=? AND active=1 ORDER BY rank').all(tenantId,dimension);
export const matrixConfigured=(db,tenantId)=>
  scales(db,tenantId,'impact').length>0&&scales(db,tenantId,'urgency').length>0&&
  db.prepare('SELECT COUNT(*) AS n FROM priority_matrix WHERE tenant_id=?').get(tenantId).n>0;

export function derivePriority(db,tenantId,impactCode,urgencyCode){
  if(!impactCode||!urgencyCode)return null;
  return db.prepare('SELECT priority,priority_rank,target_days FROM priority_matrix WHERE tenant_id=? AND impact_code=? AND urgency_code=?')
    .get(tenantId,impactCode,urgencyCode)??null;
}

// المقياس ومصفوفته إعداد كتالوج، فمن يملك إعداد الخدمات يملكهما.
export function defineScale(db,supplied,input){
  if(!db.isTransaction)fail(500,'transaction_required','التعريف لازم ينفّذ داخل معاملة');
  const u=actor(db,supplied);
  if(!can(db,u,'catalog.manage'))fail(403,'forbidden','تعريف مقاييس الاستقبال لمسؤول إعداد الخدمات وبس');
  v.object(input,['dimension','code','name','guidance','rank','basis']);
  const dimension=['impact','urgency'].includes(input.dimension)?input.dimension:fail(400,'dimension','البعد لازم يكون أثر ولا عجلة');
  const rank=Number(input.rank);
  if(!Number.isInteger(rank)||rank<1||rank>9)fail(400,'rank','ترتيب الدرجة يكون من 1 لين 9');
  const row={id:id(),code:v.text(input.code,'رمز الدرجة',40,1),name:v.text(input.name,'اسم الدرجة',80,2),
    guidance:v.text(input.guidance,'متى تُختار هذه الدرجة',1000,10),basis:v.text(input.basis??'','سند التعريف',2000,10)};
  db.prepare('INSERT INTO intake_scales(id,tenant_id,dimension,code,name,guidance,rank,defined_by,basis,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)')
    .run(row.id,u.tenant_id,dimension,row.code,row.name,row.guidance,rank,u.id,row.basis,now());
  audit(db,u,'intake_scale',row.id,'intake.scale_defined',{},{dimension,code:row.code,rank},row.basis);
  return intakeSettings(db,u);
}

export function setMatrixCell(db,supplied,input){
  if(!db.isTransaction)fail(500,'transaction_required','التعريف لازم ينفّذ داخل معاملة');
  const u=actor(db,supplied);
  if(!can(db,u,'catalog.manage'))fail(403,'forbidden','مصفوفة الأولوية لمسؤول إعداد الخدمات وبس');
  v.object(input,['impact_code','urgency_code','priority','priority_rank','target_days','basis']);
  const impact=db.prepare("SELECT 1 FROM intake_scales WHERE tenant_id=? AND dimension='impact' AND code=?").get(u.tenant_id,input.impact_code);
  const urgency=db.prepare("SELECT 1 FROM intake_scales WHERE tenant_id=? AND dimension='urgency' AND code=?").get(u.tenant_id,input.urgency_code);
  if(!impact||!urgency)fail(400,'unknown_scale','عرّف درجات الأثر والعجلة الأول، بعدين المصفوفة');
  const rank=Number(input.priority_rank);
  if(!Number.isInteger(rank)||rank<1||rank>9)fail(400,'priority_rank','ترتيب الأولوية يكون من 1 لين 9');
  const target=input.target_days===''||input.target_days===null||input.target_days===undefined?null:Number(input.target_days);
  if(target!==null&&(!Number.isInteger(target)||target<0||target>120))fail(400,'target_days','زمن الأولوية بأيام العمل من 0 لين 120');
  const basis=v.text(input.basis,'سند هذه الخلية',2000,10),priority=v.text(input.priority,'اسم الأولوية',60,2),time=now();
  const existing=db.prepare('SELECT id FROM priority_matrix WHERE tenant_id=? AND impact_code=? AND urgency_code=?').get(u.tenant_id,input.impact_code,input.urgency_code);
  if(existing)db.prepare('UPDATE priority_matrix SET priority=?,priority_rank=?,target_days=?,defined_by=?,basis=?,created_at=? WHERE id=?')
    .run(priority,rank,target,u.id,basis,time,existing.id);
  else db.prepare('INSERT INTO priority_matrix(id,tenant_id,impact_code,urgency_code,priority,priority_rank,target_days,defined_by,basis,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)')
    .run(id(),u.tenant_id,input.impact_code,input.urgency_code,priority,rank,target,u.id,basis,time);
  audit(db,u,'priority_matrix',`${input.impact_code}:${input.urgency_code}`,'intake.matrix_set',{},{priority,priority_rank:rank,target_days:target},basis);
  return intakeSettings(db,u);
}

export function intakeSettings(db,supplied){
  const u=actor(db,supplied);
  const impact=scales(db,u.tenant_id,'impact'),urgency=scales(db,u.tenant_id,'urgency');
  const cells=db.prepare('SELECT m.*,d.name AS defined_by_name FROM priority_matrix m JOIN users d ON d.id=m.defined_by WHERE m.tenant_id=?').all(u.tenant_id);
  const missing=[];
  for(const i of impact)for(const g of urgency)if(!cells.some(c=>c.impact_code===i.code&&c.urgency_code===g.code))missing.push({impact:i.name,urgency:g.name});
  return {impact,urgency,cells,missing,configured:matrixConfigured(db,u.tenant_id),can_manage:can(db,u,'catalog.manage'),
    note:'الأثر والعجلة يشتقان الأولوية، والأولوية تشتق زمنًا مستهدفًا. المنصة لا تفترض مقياسًا: يضعه مالك الإجراء بسنده، ويبقى أثر أي تعديل على الطلبات القائمة معدومًا لأن أولوية الطلب تُجمَّد عند تقديمه.'};
}

export const intakeFor=(db,requestId)=>db.prepare('SELECT * FROM request_intake WHERE request_id=?').get(requestId)??null;

// الطلب بالنيابة: المستفيد الحقيقي يبقى ظاهرًا، ولا يقدّمه إلا مديره أو الموارد البشرية،
// لأن مسار الاعتماد يُبنى على مقدّم الطلب، فلا يصح أن يتجاوز الطلبُ مديرَ المستفيد.
function beneficiaryOf(db,u,value){
  if(!value)return null;
  const person=db.prepare('SELECT id,name,manager_id,department_id FROM users WHERE id=? AND tenant_id=? AND active=1').get(value,u.tenant_id);
  if(!person)fail(400,'beneficiary','ما لقينا المستفيد، ولا حسابه موقوف');
  if(person.id===u.id)fail(400,'beneficiary_self','الطلب لنفسك ما يحتاج تحدد مستفيد');
  if(person.manager_id!==u.id&&!can(db,u,'people.manage'))
    fail(403,'not_permitted','الطلب بالنيابة لمدير المستفيد المباشر ولا للموارد البشرية');
  return person;
}

export function saveIntake(db,supplied,requestId,input){
  if(!db.isTransaction)fail(500,'transaction_required','حفظ بيانات الاستقبال لازم داخل معاملة');
  const u=actor(db,supplied);
  const r=getRequest(db,u,requestId);
  if(r.requester_id!==u.id)fail(403,'forbidden','بيانات الاستقبال يعبّيها صاحب الطلب');
  if(!['draft','returned'].includes(r.status))fail(409,'intake_frozen','بيانات الاستقبال تتعدّل قبل التقديم، ولا بعد ما يرجع الطلب لصاحبه');
  v.object(input,['beneficiary_id','impact_code','urgency_code','needed_by','justification','cost_impact','cost_center','client_id','campaign_id','contract_reference']);
  const beneficiary=beneficiaryOf(db,u,input.beneficiary_id||null);
  const impactCode=input.impact_code||null,urgencyCode=input.urgency_code||null;
  if(impactCode&&!db.prepare("SELECT 1 FROM intake_scales WHERE tenant_id=? AND dimension='impact' AND code=? AND active=1").get(u.tenant_id,impactCode))fail(400,'impact_code','درجة الأثر هذي مو معرّفة');
  if(urgencyCode&&!db.prepare("SELECT 1 FROM intake_scales WHERE tenant_id=? AND dimension='urgency' AND code=? AND active=1").get(u.tenant_id,urgencyCode))fail(400,'urgency_code','درجة العجلة هذي مو معرّفة');
  const derived=derivePriority(db,u.tenant_id,impactCode,urgencyCode);
  const neededBy=input.needed_by?v.date(input.needed_by):null;
  const cost=input.cost_impact===''||input.cost_impact===null||input.cost_impact===undefined?null:minor(input.cost_impact,'الأثر المالي المتوقع');
  const row={
    beneficiary_id:beneficiary?.id??null,impact_code:impactCode,urgency_code:urgencyCode,
    priority:derived?.priority??null,priority_rank:derived?.priority_rank??null,needed_by:neededBy,
    justification:input.justification?v.text(input.justification,'المبرر',3000,10):'',
    cost_impact_minor:cost,cost_center:input.cost_center?v.text(input.cost_center,'مركز التكلفة',80,1):'',
    client_id:linked(db,u,'clients',input.client_id,'العميل'),campaign_id:linked(db,u,'campaigns',input.campaign_id,'الحملة'),
    contract_reference:input.contract_reference?v.text(input.contract_reference,'مرجع العقد',180,1):''
  };
  const before=intakeFor(db,requestId),time=now();
  if(before)db.prepare(`UPDATE request_intake SET beneficiary_id=?,impact_code=?,urgency_code=?,priority=?,priority_rank=?,needed_by=?,justification=?,
      cost_impact_minor=?,cost_center=?,client_id=?,campaign_id=?,contract_reference=?,version=version+1,updated_by=?,updated_at=? WHERE request_id=?`)
    .run(row.beneficiary_id,row.impact_code,row.urgency_code,row.priority,row.priority_rank,row.needed_by,row.justification,
      row.cost_impact_minor,row.cost_center,row.client_id,row.campaign_id,row.contract_reference,u.id,time,requestId);
  else db.prepare(`INSERT INTO request_intake(request_id,tenant_id,beneficiary_id,impact_code,urgency_code,priority,priority_rank,needed_by,justification,
      cost_impact_minor,cost_center,client_id,campaign_id,contract_reference,updated_by,updated_at,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(requestId,u.tenant_id,row.beneficiary_id,row.impact_code,row.urgency_code,row.priority,row.priority_rank,row.needed_by,row.justification,
      row.cost_impact_minor,row.cost_center,row.client_id,row.campaign_id,row.contract_reference,u.id,time,time);
  audit(db,u,'request',requestId,'intake.saved',before??{},row);
  return requestIntakeView(db,u,requestId);
}

// عند التقديم تُجمَّد بيانات الاستقبال مع النسخة، فلا تتغير الأولوية تحت قدم المعتمِد.
export function freezeIntake(db,supplied,requestId){
  const u=actor(db,supplied);
  const r=getRequest(db,u,requestId);
  if(r.requester_id!==u.id)fail(403,'forbidden','بيانات الاستقبال تتجمّد لحظة يقدّم صاحب الطلب');
  const row=intakeFor(db,requestId);
  if(!row||row.frozen_at)return row;
  db.prepare('UPDATE request_intake SET frozen_at=?,updated_at=? WHERE request_id=?').run(now(),now(),requestId);
  return intakeFor(db,requestId);
}
// داخلية: تُستدعى من مسار الإعادة وحده، لا من مسار مباشر. إعادة الطلب لصاحبه تفتح بياناته ليصححها.
function thawIntake(db,tenantId,requestId){
  db.prepare("UPDATE request_intake SET frozen_at=NULL WHERE request_id=? AND tenant_id=? AND EXISTS(SELECT 1 FROM requests WHERE id=? AND tenant_id=? AND status='returned')").run(requestId,tenantId,requestId,tenantId);
}
export { thawIntake as thawIntakeOnReturn };

// طلب مفتوح لنفس الخدمة ونفس المستفيد خلال نافذة قصيرة: إشارة للمستخدم لا منع، فقد يكون التكرار مقصودًا.
export function duplicateCandidates(db,u,requestId){
  const r=getRequest(db,u,requestId),intake=intakeFor(db,requestId);
  const subject=intake?.beneficiary_id??r.requester_id;
  // بداية النافذة منتصف ليل الرياض قبل أربعة عشر يومًا، لحظةً بـUTC — لا منتصف ليل UTC الذي يبدأ الساعة 03:00 بتوقيت الرياض.
  const since=new Date(Date.parse(riyadhDayRange(today())[0])-DUPLICATE_WINDOW_DAYS*86400000).toISOString();
  return db.prepare(`SELECT q.id,q.title,q.status,q.created_at,q.payload FROM requests q
      LEFT JOIN request_intake i ON i.request_id=q.id
      WHERE q.tenant_id=? AND q.service_id=? AND q.id<>? AND q.status IN (${OPEN.map(()=>'?').join(',')}) AND q.created_at>=?
        AND COALESCE(i.beneficiary_id,q.requester_id)=?`)
    .all(r.tenant_id,r.service_id,requestId,...OPEN,since,subject)
    // لا يُذكر طلب لا يحق للسائل رؤيته: شكوى سرية عن المدير لا تظهر للمدير عبر كشف التكرار،
    // ولا يُقارن محتواها بمسودته فيُستنتج ما كُتب فيها.
    .filter(row=>{try{getRequest(db,u,row.id);return true;}catch{return false;}})
    .map(row=>({id:row.id,title:row.title,status:row.status,created_at:row.created_at,
      identical_payload:row.payload===r.payload}));
}

// أقرب موعد تسليم ممكن بأيام العمل، ليُقارَن بالموعد الذي طلبه صاحب الطلب.
export function earliestDelivery(db,r,service){
  const intake=intakeFor(db,r.id),derived=intake?derivePriority(db,r.tenant_id,intake.impact_code,intake.urgency_code):null;
  const serviceTarget=db.prepare('SELECT target_days FROM service_directory WHERE tenant_id=? AND service_code=?').get(r.tenant_id,service.code)?.target_days??0;
  // حين تجتمع مدة الخدمة ومدة الأولوية تُؤخذ الأضيق، فالأولوية ترفع الالتزام ولا تخفضه.
  const candidates=[serviceTarget,derived?.target_days].filter(x=>Number.isInteger(x)&&x>0);
  const days=candidates.length?Math.min(...candidates):0;
  return {target_days:days,earliest_on:days?addWorkingDays(today(),days,holidaySet(db,r.tenant_id)):null,
    from_priority:derived?.target_days??null,from_service:serviceTarget||null};
}

// بوابة التقديم: تفصل ما يمنع التقديم عمّا ينبّه عليه فقط. المنع يكون لنقص لا يستطيع المعتمِد تجاوزه.
export function submissionGate(db,supplied,requestId){
  const u=actor(db,supplied),r=getRequest(db,u,requestId),service=serviceOf(db,r);
  const payload=JSON.parse(r.payload),intake=intakeFor(db,requestId);
  const blocking=[],advisory=[];

  for(const field of service.fields.filter(f=>f.required))
    if(payload[field.key]===undefined||payload[field.key]==='')blocking.push({code:'missing_field',text:`حقل مطلوب لم يُستكمل: ${field.label}`});
  if(!String(r.title??'').trim())blocking.push({code:'missing_title',text:'الطلب بلا عنوان يميّزه'});

  if(matrixConfigured(db,r.tenant_id)){
    if(!intake?.impact_code||!intake?.urgency_code)blocking.push({code:'missing_priority',text:'حدّد الأثر والعجلة ليُشتق زمن الطلب وأولويته'});
    else if(!intake.priority)blocking.push({code:'matrix_gap',text:'لا توجد أولوية معرّفة لهذا التقاطع بين الأثر والعجلة؛ أبلغ مسؤول إعداد الخدمات'});
  } else advisory.push({code:'matrix_missing',text:'مصفوفة الأولوية غير معرّفة في المنصة بعد، فالطلب يمضي بزمن الخدمة وحده.'});

  if(intake?.needed_by){
    if(intake.needed_by<today())blocking.push({code:'needed_by_past',text:'الموعد المطلوب قد مضى'});
    else {
      const {earliest_on,target_days}=earliestDelivery(db,r,service);
      if(earliest_on&&intake.needed_by<earliest_on)
        advisory.push({code:'needed_by_tight',text:`الموعد المطلوب ${intake.needed_by} أقرب من أقرب تسليم ممكن ${earliest_on} بزمن ${target_days} أيام عمل. اذكر في المبرر لماذا يلزم قبل ذلك.`});
    }
  }
  if(intake?.cost_impact_minor&&!intake.justification)
    blocking.push({code:'cost_without_justification',text:'الطلب ذو أثر مالي ولا مبرر مكتوب معه'});
  if(intake?.cost_impact_minor&&!intake.cost_center)
    advisory.push({code:'cost_without_center',text:'حدّد مركز التكلفة الذي يتحمل هذا الأثر.'});
  if(intake?.beneficiary_id&&!intake.justification)
    advisory.push({code:'behalf_without_note',text:'الطلب بالنيابة عن غيرك؛ اذكر سبب تقديمك له.'});

  const attachments=db.prepare('SELECT COUNT(*) AS n FROM attachments WHERE request_id=?').get(requestId).n;
  if(!attachments&&/أرفق|مرفق|المستندات|الوثيقة/.test(service.description??''))
    advisory.push({code:'no_attachment',text:'وصف الخدمة يطلب إرفاق مستند ولم يُرفق شيء.'});

  const duplicates=duplicateCandidates(db,u,requestId);
  for(const row of duplicates)
    advisory.push({code:'possible_duplicate',text:`يوجد طلب مفتوح لنفس الخدمة ولنفس المستفيد: «${row.title}»${row.identical_payload?' ببيانات مطابقة تمامًا':''}.`,request_id:row.id});

  return {ready:blocking.length===0,blocking,advisory,duplicates,
    note:'ما يمنع التقديم نقصٌ لا يستطيع المعتمِد تجاوزه. وما ينبّه عليه يمضي الطلب رغمه بقرارك.'};
}

export function requestIntakeView(db,supplied,requestId){
  const u=actor(db,supplied),r=getRequest(db,u,requestId),service=serviceOf(db,r),row=intakeFor(db,requestId);
  const settings=intakeSettings(db,u);
  const editable=r.requester_id===u.id&&['draft','returned'].includes(r.status);
  const team=editable?db.prepare('SELECT id,name FROM users WHERE tenant_id=? AND active=1 AND (manager_id=? OR ?=1) AND id<>? ORDER BY name')
    .all(u.tenant_id,u.id,can(db,u,'people.manage')?1:0,u.id):[];
  return {
    request:{id:r.id,title:r.title,status:r.status,service:service.name_ar},
    intake:row,editable,impact:settings.impact,urgency:settings.urgency,configured:settings.configured,
    beneficiary_options:team,delivery:earliestDelivery(db,r,service),
    gate:submissionGate(db,u,requestId),
    note:'المستفيد يبقى ظاهرًا في الطلب وفي كل إشعاراته. مسار الاعتماد يُبنى على مقدّم الطلب، ولذلك لا يقدّم بالنيابة إلا مدير المستفيد أو الموارد البشرية.'
  };
}
