// الرحلات — طلبٌ أب يولّد طلبات أبناء (مركز الخدمات، الدفعة الرابعة، فوق ترحيل 131).
//
// الرحلة ليست كائنًا جديدًا في سير العمل: الأب طلبٌ عادي في requests له خدمته ومساره واعتماده، وحين يبلغ «معتمد»
// تُولَّد أبناؤه بـcreateRequest نفسها **باسم صاحب الأب** لا باسم من اعتمد، فتعمل فيهم الصلاحيات والتدقيق والإشعارات
// وصندوق الوارد بلا سطر جديد. والتعريف كودٌ في app/catalog-tree.mjs (JOURNEYS، النسخة صفر)، والتنفيذ صفوفٌ في
// journey_runs/journey_run_steps.
//
// أربع قواعد صدقٍ مفروضة هنا:
//   (1) **حالة الابن لا تُخزَّن هنا**: تُقرأ من requests عند كل رسم. نسخةٌ ثانية تفترق عن الأولى في أول تحديث يفشل نصفه.
//   (2) **ما لا يعرفه التعريف لا يُخترع**: الحقل اللازم الذي لم يأتِ من الأب ولا من preset يترك الابن مسودةً «ينتظر
//       ردك» عند صاحب الرحلة، ويُكتب ذلك في سبب الخطوة. لا قيمة تُملأ نيابةً عن إنسان.
//   (3) **الخطوة التي لم تُنفَّذ تقول لماذا**: skipped (الشرط لم يتحقق) غير blocked (موقوفة بـ129، أو خارج جمهور صاحب
//       الرحلة، أو بلا منفّذ، أو رفضٌ من createRequest بنصّه). والشرط بشكل show_when نفسه ويُقيَّم بـfieldVisible — لا
//       لغة شرطٍ ثانية ولا مُقيِّم ثانٍ.
//   (4) **رحلة واحدة لكل أب**: UNIQUE(tenant_id,parent_request_id) في الجدول، والفحص هنا قبله، فاعتمادٌ مكرر لا يولّد أبناء مرتين.
import { randomUUID } from 'node:crypto';
import { audit, now } from './db.mjs';
import { AppError } from './auth.mjs';
import { currentUser } from './delegations.mjs';
import { refuse, actorOrRefuse } from './refusal.mjs';
import { fieldVisible, validatePayload } from './validation.mjs';
import { JOURNEYS, JOURNEY_VERSION, JOURNEYS_LATER } from './catalog-tree.mjs';
import { isHidden, stopNote } from './service-availability.mjs';
// دورة استيراد مقصودة ومطابقة للقائم (workflow ← service-routes ← journeys ← workflow): لا يُقرأ شيء منها وقتَ
// تحميل الوحدة، بل داخل الدوال وحدها.
import { createRequest, transition, catalog, getRequest, serviceOf, nativeExecutors, deputiesFor, escalationApprover } from './workflow.mjs';

export const OUTCOME_NAMES=Object.freeze({created:'وُلد طلب',skipped:'لم تُطلب: الشرط لم يتحقق',blocked:'تعذّرت'});
export const RUN_STATUS_NAMES=Object.freeze({open:'مفتوحة',completed:'مكتملة',cancelled:'ملغاة'});
const OPEN_CHILD=new Set(['draft','returned','pending','approved','in_progress']);

export const definitionFor=code=>JOURNEYS.find(j=>j.parent.kind==='service'&&j.parent.key===code)??null;
export const runFor=(db,tenantId,parentId)=>db.prepare('SELECT * FROM journey_runs WHERE tenant_id=? AND parent_request_id=?').get(tenantId,parentId)??null;

// حمولة الابن من حمولة الأب: preset التعريف أولًا، ثم copy (مفتاح الابن ← مفتاح الأب)، ثم المفتاح المتطابق. القيمة الفارغة
// لا تُنسخ، والمفتاح خارج حقول الابن لا يُكتب (createRequest يرفض المفتاح الغريب).
export function childPayload(step,childFields,parentPayload){
  const out={};
  for(const field of childFields){
    const key=field.key;
    let value;
    if(Object.hasOwn(step.preset??{},key))value=step.preset[key];
    else if(Object.hasOwn(step.copy??{},key))value=parentPayload?.[step.copy[key]];
    else value=parentPayload?.[key];
    if(value===undefined||value===null||String(value).trim()==='')continue;
    out[key]=String(value);
  }
  return out;
}
// شرط الخطوة يُقيَّم بالمُقيِّم الواحد في المنصة، على حمولة الأب وحقوله، بالسلوك نفسه حرفًا بحرف (ومنه: الشرط على حقلٍ
// لا يملكه الأب يُعدّ متحققًا كما تفعل الحقول المشروطة).
export const stepDue=(step,parentPayload,parentFields)=>fieldVisible({show_when:step.when??null},parentPayload,parentFields);
export const conditionText=step=>step.when?`حين يكون «${step.when.field}»: ${[].concat(step.when.equals??[]).join('، ')}`:'بلا شرط';
const requiredMissing=(fields,payload)=>{
  try{validatePayload(fields,payload,true);return [];}
  catch(error){if(error instanceof AppError&&Array.isArray(error.details?.fields))return error.details.fields;throw error;}
};
// هل للخدمة من ينفّذها: منفذو إدارتها، أو نائبٌ مقبول، أو مرجع تصعيد — الحلقات الثلاث نفسها في executionChain.
const hasExecutor=(db,s,tenantId)=>nativeExecutors(db,s,s.department_id,tenantId).length>0||deputiesFor(db,tenantId,s.code).length>0||!!escalationApprover(db,tenantId,s.department_id);

// ما يُكتب في سجل الابن حين يُولَّد (مراجعة 23 سبتمبر): كان الابن يُقدَّم باسم صاحب الأب بملاحظةٍ فارغة، فقرأ من يقرّر فيه
// «قدّمه المدير» ولا أثر للرحلة ولا لمن اعتمد الأب إلا في حدث journey_run المنفصل. الآن: ملاحظة التقديم تسمّي الرحلة والأب
// ومن اعتمده، وحدثٌ على الابن نفسه باسم المعتمِد (journey.child_created) يقرؤه خطّ الطلب وصندوق المعتمِد سواء.
export const childOriginNote=(definition,parent,actor,submitted)=>`${submitted?'قُدّم آليًا':'أُنشئ مسودةً'} ضمن رحلة «${definition.name_ar}» بعد اعتماد الطلب الأب ${parent.id} بواسطة ${actor?.name??actor?.id??'المعتمِد'}`;
function runStep(db,requester,definition,step,position,parent,parentService,runId,stamp,actor){
  const insert=db.prepare('INSERT INTO journey_run_steps(run_id,position,tenant_id,step_key,item_kind,item_key,outcome,condition_json,reason,child_request_id,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)');
  const record=(outcome,reason,childId=null)=>{
    insert.run(runId,position,parent.tenant_id,step.key,step.item.kind,step.item.key,outcome,JSON.stringify(step.when??null),reason,childId,stamp);
    return {step_key:step.key,item_key:step.item.key,outcome,reason,child_request_id:childId};
  };
  const payload=JSON.parse(parent.payload);
  if(!stepDue(step,payload,parentService.fields))return record('skipped',`الشرط لم يتحقق: ${conditionText(step)}`);
  if(step.item.kind!=='service')return record('blocked','الخطوة ليست خدمة في الدليل، والمحرّك لا يولّد غير طلبات الخدمات');
  if(!requester)return record('blocked','حساب صاحب الرحلة موقوف أو غير مسجل، فلا يُنشأ طلب باسمه');
  if(isHidden(db,parent.tenant_id,'service',step.item.key))return record('blocked',stopNote(db,parent.tenant_id,'service',step.item.key));
  const s=catalog(db,requester).find(x=>x.code===step.item.key)??null;
  if(!s)return record('blocked','الخدمة ليست في دليل جمهور صاحب الرحلة، فلا يُفتح منها طلب باسمه');
  if(!hasExecutor(db,s,parent.tenant_id))return record('blocked','لا منفّذ للخدمة في إدارتها ولا نائب مسمّى ولا مرجع تصعيد');
  const body=childPayload(step,s.fields,payload);
  const title=`${s.name_ar} — ضمن رحلة «${definition.name_ar}»`;
  // الرفض المكتوب من createRequest (نسخة قديمة، تصريح، قيمة خارج القائمة) يصير سبب الخطوة لا عطلًا يوقف الاعتماد.
  db.exec('SAVEPOINT journey_child');
  let child;
  try{child=createRequest(db,requester,{service_id:s.id,title,payload:body,project_id:null});db.exec('RELEASE journey_child');}
  catch(error){
    db.exec('ROLLBACK TO journey_child');db.exec('RELEASE journey_child');
    if(!(error instanceof AppError))throw error;
    return record('blocked',`تعذّر إنشاء الطلب: ${error.message}`);
  }
  const origin=submitted=>audit(db,actor,'request',child.id,'journey.child_created',{},{run_id:runId,journey_key:definition.key,step:step.key,parent_request_id:parent.id,
    approved_by:actor?.id??null,requester_id:requester.id,auto_submitted:submitted},childOriginNote(definition,parent,actor,submitted));
  const missing=requiredMissing(s.fields,body);
  if(missing.length){origin(false);return record('created',`أُنشئ مسودةً تنتظر صاحب الرحلة: حقول لازمة لا يعرفها التعريف (${missing.map(k=>s.fields.find(f=>f.key===k)?.label??k).join('، ')})`,child.id);}
  // اكتملت الحقول اللازمة من الأب والتعريف: يُقدَّم باسم صاحبه **بملاحظةٍ تسمّي الرحلة ومن اعتمد الأب**. وإن ردّه المسار
  // (لا معتمد يُحلّ، مثلًا) بقي مسودةً بسببه.
  db.exec('SAVEPOINT journey_submit');
  try{transition(db,requester,child.id,'submit',{version:child.version,note:childOriginNote(definition,parent,actor,true)});db.exec('RELEASE journey_submit');origin(true);return record('created','قُدّم باسم صاحب الرحلة بحقولٍ اكتملت من الأب والتعريف',child.id);}
  catch(error){
    db.exec('ROLLBACK TO journey_submit');db.exec('RELEASE journey_submit');
    if(!(error instanceof AppError))throw error;
    origin(false);
    return record('created',`أُنشئ مسودةً ولم يُقدَّم: ${error.message}`,child.id);
  }
}

// تبدأ الرحلة لطلبٍ أب بلغ «معتمد». actor هو من اعتمد (يُنسب إليه حدث بدء الرحلة)، والأبناء باسم صاحب الأب.
// definition وسيطٌ اختياري ليُختبر المحرّك على تعريفٍ اصطناعي بشرطٍ حقيقي دون تزييف تعريفٍ في الكود.
export function startRun(db,actor,parent,definition=definitionFor(serviceOf(db,parent).code)){
  if(!definition)return null;
  if(!db.isTransaction)refuse(409,'transaction_required',{what:'لا تبدأ رحلة خارج معاملة قاعدة بيانات',
    missing:[{document:'معاملة قاعدة بيانات',why:'الرحلة تكتب صفوفها وأبناءها دفعةً واحدة أو لا تكتب شيئًا',owner:'مسؤول المنصة',owner_role:'admin'}],
    next:'تبدأ الرحلة من اعتماد الطلب الأب في شاشة الطلب'});
  if(runFor(db,parent.tenant_id,parent.id))return null;
  const requester=currentUser(db,{id:parent.requester_id,tenant_id:parent.tenant_id});
  const parentService=serviceOf(db,parent);
  const stamp=now(),runId=randomUUID();
  db.prepare("INSERT INTO journey_runs(id,tenant_id,journey_key,definition_version,parent_request_id,requester_id,subject_user_id,status,started_at,closed_at) VALUES(?,?,?,?,?,?,NULL,'open',?,NULL)")
    .run(runId,parent.tenant_id,definition.key,JOURNEY_VERSION,parent.id,parent.requester_id,stamp);
  const steps=definition.steps.map((step,index)=>runStep(db,requester,definition,step,index+1,parent,parentService,runId,stamp,actor));
  audit(db,actor,'journey_run',runId,'journey.started',{},{journey_key:definition.key,parent_request_id:parent.id,
    steps:steps.map(s=>({step:s.step_key,outcome:s.outcome,child:s.child_request_id}))});
  return {id:runId,steps};
}

// تكتمل الرحلة حين يكتمل الأب **وكل ابنٍ وُلد**. الابن المرفوض أو الملغى يُبقيها مفتوحة بشارته الظاهرة في صفحة التتبع:
// إغلاقها عندئذٍ قرارُ إنسان لا استنتاجُ محرّك.
export function closeIfDone(db,actor,requestId,tenantId){
  const run=db.prepare(`SELECT r.* FROM journey_runs r WHERE r.tenant_id=? AND r.status='open'
    AND (r.parent_request_id=? OR EXISTS(SELECT 1 FROM journey_run_steps s WHERE s.run_id=r.id AND s.child_request_id=?))`).get(tenantId,requestId,requestId)??null;
  if(!run)return null;
  const parentStatus=db.prepare('SELECT status FROM requests WHERE id=?').get(run.parent_request_id)?.status;
  const children=db.prepare('SELECT q.status FROM journey_run_steps s JOIN requests q ON q.id=s.child_request_id WHERE s.run_id=? AND s.child_request_id IS NOT NULL').all(run.id);
  if(parentStatus!=='completed'||children.some(c=>c.status!=='completed'))return null;
  db.prepare("UPDATE journey_runs SET status='completed',closed_at=? WHERE id=?").run(now(),run.id);
  audit(db,actor,'journey_run',run.id,'journey.completed',{status:'open'},{status:'completed',children:children.length});
  return run.id;
}

// النداء الواحد من service-routes.mjs afterTransition: r هو صفّ الطلب قبل التحديث، وstatus حالته الجديدة.
export function onRequestTransition(db,u,r,status){
  if(status==='approved'&&r.status!=='approved')startRun(db,u,r);
  if(status==='completed')closeIfDone(db,u,r.id,r.tenant_id);
}

/* ───── القراءة: صفحة التتبع، ورحلاتي، وعدسة «حسب الرحلة» ─────────────────── */

const latestName=(db,tenantId,code)=>db.prepare('SELECT name_ar FROM services WHERE tenant_id=? AND code=? ORDER BY version DESC LIMIT 1').get(tenantId,code)?.name_ar??code;

export function journeyRun(db,supplied,runId){
  const u=actorOrRefuse(db,supplied);
  const run=db.prepare('SELECT * FROM journey_runs WHERE id=? AND tenant_id=?').get(String(runId??''),u.tenant_id)??null;
  if(!run)refuse(404,'journey_not_found',{what:'لا رحلة بهذا المعرّف في كيانك',
    missing:[{document:'معرّف رحلة من «رحلاتي المفتوحة» أو من شاشة الطلب الأب',why:'الرابط قديم أو لرحلةٍ في كيان آخر',owner:'مركز الخدمات',owner_role:'requests.use'}],
    next:'افتح مركز الخدمات ← عدسة «حسب الرحلة» واختر رحلتك من القائمة',link:'#services'});
  // الرؤية رؤية الطلب الأب نفسها (صاحبه ومعتمدوه ومنفذوه): من لا يرى الأب لا يرى رحلته.
  const parent=getRequest(db,u,run.parent_request_id);
  const definition=JOURNEYS.find(j=>j.key===run.journey_key)??null;
  const parentService=serviceOf(db,parent);
  const steps=db.prepare('SELECT * FROM journey_run_steps WHERE run_id=? ORDER BY position').all(run.id).map(step=>{
    const child=step.child_request_id?db.prepare('SELECT id,title,status,updated_at FROM requests WHERE id=?').get(step.child_request_id):null;
    return {position:step.position,key:step.step_key,item:{kind:step.item_kind,key:step.item_key,name:latestName(db,u.tenant_id,step.item_key)},
      outcome:step.outcome,outcome_name:OUTCOME_NAMES[step.outcome],reason:step.reason,condition:JSON.parse(step.condition_json),
      // حالة الابن من requests لحظة القراءة، لا من الرحلة.
      child:child?{id:child.id,title:child.title,status:child.status,updated_at:child.updated_at,href:`#request/${child.id}`}:null};
  });
  const created=steps.filter(s=>s.child);
  return {id:run.id,
    journey:{key:run.journey_key,name:definition?.name_ar??run.journey_key,description:definition?.description??'',version:run.definition_version},
    status:run.status,status_name:RUN_STATUS_NAMES[run.status]??run.status,started_at:run.started_at,closed_at:run.closed_at,
    parent:{id:parent.id,title:parent.title,status:parent.status,service_code:parentService.code,service_name:parentService.name_ar,href:`#request/${parent.id}`},
    requester_is_me:run.requester_id===u.id,steps,
    counts:{steps:steps.length,created:created.length,skipped:steps.filter(s=>s.outcome==='skipped').length,blocked:steps.filter(s=>s.outcome==='blocked').length,
      open_children:created.filter(s=>OPEN_CHILD.has(s.child.status)).length,waiting_me:created.filter(s=>['draft','returned'].includes(s.child.status)).length},
    note:'حالة كل طلب تُقرأ من سجل الطلبات لا من الرحلة، فلا نسخة ثانية منها. وتكتمل الرحلة حين يكتمل الأب وكل ابنٍ وُلد؛ والخطوة التي لم تُنفَّذ تقول لماذا.'};
}

// «رحلاتي»: ما بدأه هذا الحساب أبًا، بحالته وعدد أبنائه وما ينتظره منها (journey_runs_mine).
export function myJourneyRuns(db,u,limit=20){
  return db.prepare(`SELECT r.*,q.title AS parent_title,q.status AS parent_status FROM journey_runs r JOIN requests q ON q.id=r.parent_request_id
    WHERE r.tenant_id=? AND r.requester_id=? ORDER BY r.status='open' DESC,r.started_at DESC LIMIT ?`).all(u.tenant_id,u.id,limit).map(run=>{
    const children=db.prepare('SELECT q.status FROM journey_run_steps s JOIN requests q ON q.id=s.child_request_id WHERE s.run_id=?').all(run.id);
    const blocked=db.prepare("SELECT COUNT(*) AS n FROM journey_run_steps WHERE run_id=? AND outcome='blocked'").get(run.id).n;
    const definition=JOURNEYS.find(j=>j.key===run.journey_key)??null;
    return {id:run.id,journey_key:run.journey_key,name:definition?.name_ar??run.journey_key,status:run.status,status_name:RUN_STATUS_NAMES[run.status]??run.status,
      started_at:run.started_at,parent:{id:run.parent_request_id,title:run.parent_title,status:run.parent_status},
      children:children.length,waiting_me:children.filter(c=>['draft','returned'].includes(c.status)).length,blocked,href:`#services/journey/${run.id}`};
  });
}

// عدسة «حسب الرحلة» في مركز الخدمات: التعريف المبنيّ (ببابه إن كان في دليل هذا الحساب)، ورحلاتي، والسبع الباقيات مادّةً.
export function journeyLens(db,u){
  const visible=new Map(catalog(db,u).map(s=>[s.code,s]));
  const definitions=JOURNEYS.map(definition=>{
    const parent=visible.get(definition.parent.key)??null;
    return {key:definition.key,name:definition.name_ar,description:definition.description,version:JOURNEY_VERSION,
      parent:{kind:definition.parent.kind,key:definition.parent.key,name:parent?.name_ar??latestName(db,u.tenant_id,definition.parent.key),
        href:parent?`#services/${definition.parent.key}`:'',can_start:!!parent,
        why_not:parent?null:'الطلب الأب ليس في دليل حسابك: هذه الرحلة يبدؤها من يطلب نيابةً عن غيره'},
      steps:definition.steps.map(step=>({key:step.key,item:step.item,name:latestName(db,u.tenant_id,step.item.key),condition:conditionText(step)}))};
  });
  return {definitions,mine:myJourneyRuns(db,u),later:JOURNEYS_LATER.map(j=>({...j,status:'معرّفة لاحقًا'})),
    note:'رحلة واحدة مبنيّة من ثمانٍ، بالمادّة المشحونة فعلًا. البقية مسمّاة بمادّتها وما ينقصها، ولا تعريف مزيَّف لأيٍّ منها.'};
}
