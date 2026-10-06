import { randomUUID } from 'node:crypto';
import { audit, now } from './db.mjs';
import { fail } from './auth.mjs';
import * as v from './validation.mjs';
import { currentUser } from './delegations.mjs';
import { can } from './access.mjs';

// دورة التحقق من المعرفة. إجابة المساعد لا تكون أصدق من مصدرها، فلكل مصدر مالك مسمى ودورية مراجعة وتاريخ انتهاء.
// المصدر المنتهي لا يُحجب: يبقى ويُوسَم بتحذير صريح، لأن الحجب يدفع الموظف إلى مكان أسوأ. التحقق فعل بشري مسجل باسم المالك وتاريخه.
// لا تستورد هذه الوحدة app/ai.mjs (تجنبًا للدوران): تقرأ ai_runs مباشرة، وتصدّر knowledgeWarnings ليستدعيها المساعد.
export const KINDS={policy:'سياسة',service_card:'بطاقة خدمة',procedure:'إجراء'};
export const STATES={verified:'متحقق منه',due_soon:'تقترب مراجعته',expired:'تجاوز تاريخ مراجعته',unverified:'لم يؤكده مالكه بعد',retired:'مسحوب'};
export const WARNINGS={
  expired:'هذا المصدر تجاوز تاريخ مراجعته ولم يؤكده مالكه',
  unverified:'هذا المصدر سُجّل له مالك ولم يؤكد صحته بعد',
  update_requested:'مالك هذا المصدر طلب تحديثه ولم يُحدَّث بعد',
  unregistered:'هذا المصدر بلا مالك مسمى في قاعدة المعرفة، فلا أحد يراجع صحته دوريًا'
};
// نافذتا عرض لا أكثر: متى يبدأ تنبيه المالك، وعلى أي مدة يُحسب «يُستشهد به كثيرًا». دورية المراجعة نفسها يدخلها من يسجل المصدر.
const REMIND_DAYS=14,CITATION_WINDOW_DAYS=90;
const POLICY_KIND_NAMES={pay_components:'بنود الراتب المسموحة',working_time:'ساعات العمل والحضور',payroll_cycle:'دورة الرواتب',end_of_service:'نهاية الخدمة'};
const today=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Riyadh',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const addDays=(date,days)=>new Date(Date.parse(date+'T00:00:00Z')+days*86400000).toISOString().slice(0,10);
const daysBetween=(from,to)=>Math.round((Date.parse(to)-Date.parse(from))/86400000);
const name=(db,userId)=>userId?db.prepare('SELECT name FROM users WHERE id=?').get(userId)?.name??null:null;
function actor(db,supplied){const u=currentUser(db,supplied);if(!u)fail(403,'forbidden','الحساب غير متاح');return u;}
function writing(db){if(!db.isTransaction)fail(500,'transaction_required','تتطلب الكتابة معاملة قاعدة بيانات');}

export function sourceState(s,date=today()){
  if(s.status==='retired')return 'retired';
  if(!s.last_verified_on)return 'unverified';
  if(s.expires_on<date)return 'expired';
  return daysBetween(date,s.expires_on)<=REMIND_DAYS?'due_soon':'verified';
}
const warningFor=(s,state)=>state==='expired'?WARNINGS.expired:state==='unverified'?WARNINGS.unverified:s.update_requested?WARNINGS.update_requested:null;

/* ───── الاستشهادات: من ai_runs، مجمّعة، دون نص أي تشغيل ولا اسم صاحبه ───── */
// المساعد يقتبس اليوم نوعين فقط: فقرة سياسة (hr_policy) وتعريف خدمة (service). «الإجراء» لا يقتبسه المساعد بعد، فعدّاده صفر دائمًا.
function citations(db,tenantId,date){
  const since=new Date(Date.parse(addDays(date,-CITATION_WINDOW_DAYS)+'T00:00:00+03:00')).toISOString(),counts=new Map(),policyKind=new Map();
  const kindOf=policyId=>{if(!policyKind.has(policyId))policyKind.set(policyId,db.prepare('SELECT kind FROM hr_policies WHERE id=? AND tenant_id=?').get(policyId,tenantId)?.kind??null);return policyKind.get(policyId);};
  for(const run of db.prepare("SELECT sources,created_at FROM ai_runs WHERE tenant_id=? AND status='completed' AND created_at>=?").all(tenantId,since)){
    const seen=new Set();
    for(const source of JSON.parse(run.sources)){
      const key=source?.type==='hr_policy'?(kindOf(source.id)?`policy:${kindOf(source.id)}`:null):source?.type==='service'&&typeof source.id==='string'?`service_card:${source.id}`:null;
      // ثلاث فقرات من السياسة نفسها في إجابة واحدة استشهاد واحد.
      if(!key||seen.has(key))continue;seen.add(key);
      const entry=counts.get(key)??{count:0,last_cited_at:null,title:source.title??''};entry.count++;if(!entry.last_cited_at||run.created_at>entry.last_cited_at)entry.last_cited_at=run.created_at;counts.set(key,entry);
    }
  }
  return counts;
}
function view(db,u,s,manage,cited,date){
  const state=sourceState(s,date),actions=[],live=s.status==='active';
  if(live&&s.owner_id===u.id)actions.push('verify_source','request_update');
  if(live&&manage)actions.push('edit_source','retire_source');
  const c=cited.get(`${s.kind}:${s.reference}`);
  return {...s,update_requested:!!s.update_requested,kind_name:KINDS[s.kind],state,state_name:STATES[state],warning:warningFor(s,state),owner_name:name(db,s.owner_id),last_verified_by_name:name(db,s.last_verified_by),created_by_name:name(db,s.created_by),
    days_left:live?daysBetween(date,s.expires_on):null,days_since_verified:s.last_verified_on?daysBetween(s.last_verified_on,date):null,citations:c?.count??0,last_cited_at:c?.last_cited_at??null,
    history:db.prepare('SELECT k.decision,k.note,k.verified_on,k.next_expires_on,x.name AS verified_by_name FROM knowledge_verifications k JOIN users x ON x.id=k.verified_by WHERE k.source_id=? AND k.tenant_id=? ORDER BY k.created_at DESC LIMIT 6').all(s.id,u.tenant_id),
    // المالك يُنبَّه حين يقترب الموعد أو يفوت، لا طوال السنة.
    needs_owner:live&&s.owner_id===u.id&&state!=='verified',actions};
}
// ما يمكن تسجيله مصدرًا من سجلات المنصة نفسها: أنواع السياسات التي لها نسخة معتمدة، والخدمات التي لها بطاقة منشورة.
function candidates(db,tenantId){
  const taken=new Set(db.prepare("SELECT kind||':'||reference AS k FROM knowledge_sources WHERE tenant_id=? AND status='active'").all(tenantId).map(r=>r.k));
  const policies=db.prepare("SELECT DISTINCT kind FROM hr_policies WHERE tenant_id=? AND status='accepted'").all(tenantId).map(r=>({kind:'policy',reference:r.kind,title:POLICY_KIND_NAMES[r.kind]??r.kind}));
  const cards=db.prepare("SELECT service_code FROM service_cards WHERE tenant_id=? AND status='published'").all(tenantId).map(r=>({kind:'service_card',reference:r.service_code,title:r.service_code}));
  return [...policies,...cards].filter(c=>!taken.has(`${c.kind}:${c.reference}`));
}

export function knowledgeBoard(db,supplied){
  const u=actor(db,supplied),manage=can(db,u,'knowledge.manage'),date=today(),cited=citations(db,u.tenant_id,date);
  const all=db.prepare('SELECT * FROM knowledge_sources WHERE tenant_id=? ORDER BY status,expires_on,title').all(u.tenant_id).map(s=>view(db,u,s,manage,cited,date));
  const live=all.filter(s=>s.status==='active'),fresh=live.filter(s=>['verified','due_soon'].includes(s.state)&&!s.update_requested),registered=new Set(live.map(s=>`${s.kind}:${s.reference}`));
  // أخطر ما في قاعدة المعرفة: الأكثر استشهادًا والأقدم تحققًا. يُرتَّب بعدد الاستشهادات ثم بقِدم آخر تحقق.
  const risky=live.filter(s=>s.citations>0&&(s.warning||s.state==='due_soon')).sort((a,b)=>b.citations-a.citations||(b.days_since_verified??1e6)-(a.days_since_verified??1e6)).slice(0,10)
    .map(s=>({id:s.id,title:s.title,kind_name:s.kind_name,owner_name:s.owner_name,citations:s.citations,state_name:s.state_name,last_verified_on:s.last_verified_on,expires_on:s.expires_on,warning:s.warning}));
  const unregistered=[...cited].filter(([key])=>!registered.has(key)).map(([key,c])=>({key,kind_name:KINDS[key.split(':')[0]],reference:key.slice(key.indexOf(':')+1),title:c.title,citations:c.count,last_cited_at:c.last_cited_at})).sort((a,b)=>b.citations-a.citations);
  const mine=all.filter(s=>s.owner_id===u.id);
  return {today:date,can_manage:manage,user_id:u.id,kinds:KINDS,states:STATES,remind_days:REMIND_DAYS,citation_window_days:CITATION_WINDOW_DAYS,
    sources:manage?all:mine,
    honesty:manage?{live:live.length,verified:fresh.length,verified_percent:live.length?Math.round(fresh.length*100/live.length):null,expired:live.filter(s=>s.state==='expired').length,unverified:live.filter(s=>s.state==='unverified').length,
      update_requested:live.filter(s=>s.update_requested).length,due_soon:live.filter(s=>s.state==='due_soon').length,cited_and_stale:risky,cited_unregistered:unregistered}:null,
    candidates:manage?candidates(db,u.tenant_id):[],
    people:manage?db.prepare("SELECT id,name FROM users WHERE tenant_id=? AND active=1 AND role<>'admin' AND id<>? ORDER BY name").all(u.tenant_id,u.id):[],
    awaiting_me:mine.filter(s=>s.needs_owner).map(s=>({id:s.id,title:`${s.kind_name}: ${s.title}`,context:s.state_name,due_date:s.expires_on,created_at:s.state==='unverified'?s.created_at:null,actions:['verify_source']})),
    note:`المنصة لا تعرف هل المصدر صحيح؛ تعرف فقط من مالكه ومتى أكد صحته آخر مرة. «متحقق منه» = أكده مالكه ضمن دوريته ولم يطلب تحديثه. الاستشهادات محسوبة من تشغيلات المساعد خلال ${CITATION_WINDOW_DAYS} يومًا، مجمّعة دون نص أي تشغيل. المساعد يقتبس السياسات وتعريفات الخدمات فقط؛ «الإجراء» يُراجع هنا ولا يُقتبس بعد.`};
}

function cleanOwner(db,u,ownerId,registrarId){
  const owner=db.prepare("SELECT id FROM users WHERE id=? AND tenant_id=? AND active=1 AND role<>'admin'").get(ownerId,u.tenant_id);
  if(!owner)fail(400,'owner_id','مالك المصدر غير متاح');
  if(owner.id===registrarId)fail(409,'separation_of_duties','من يسجل المصدر لا يكون مالكه الذي يؤكد صحته');
  return owner.id;
}
const interval=value=>{if(!Number.isInteger(value)||value<7||value>1095)fail(400,'review_interval_days','دورية المراجعة بالأيام من 7 إلى 1095');return value;};
export function registerSource(db,supplied,input){
  writing(db);const u=actor(db,supplied);if(!can(db,u,'knowledge.manage'))fail(403,'not_permitted','تسجيل مصادر المعرفة لحامل تصريح قاعدة المعرفة');
  v.object(input,['kind','reference','title','location_note','owner_id','review_interval_days']);
  if(!Object.hasOwn(KINDS,input.kind))fail(400,'kind','اختر نوع المصدر');
  let reference='';
  if(input.kind!=='procedure'){
    reference=v.text(input.reference,'المرجع',60,2);
    // المصدر المرتبط بسجل في المنصة يجب أن يكون سجله موجودًا ومعتمدًا؛ لا يُسجَّل مالك لمصدر لا وجود له.
    const exists=input.kind==='policy'?db.prepare("SELECT 1 FROM hr_policies WHERE tenant_id=? AND kind=? AND status='accepted'").get(u.tenant_id,reference):db.prepare("SELECT 1 FROM service_cards WHERE tenant_id=? AND service_code=? AND status='published'").get(u.tenant_id,reference);
    if(!exists)fail(409,'source_missing',input.kind==='policy'?'لا سياسة معتمدة من هذا النوع':'لا بطاقة منشورة لهذه الخدمة');
    if(db.prepare("SELECT 1 FROM knowledge_sources WHERE tenant_id=? AND kind=? AND reference=? AND status='active'").get(u.tenant_id,input.kind,reference))fail(409,'duplicate_source','المصدر مسجل وله مالك');
  }else if(input.reference)fail(400,'reference','الإجراء لا يرتبط بسجل في المنصة؛ اكتب مكان حفظه في الملاحظة');
  const ownerId=cleanOwner(db,u,input.owner_id,u.id),sourceId=randomUUID(),time=now(),date=today();
  // يبدأ المصدر «لم يؤكده مالكه بعد»: التسجيل ليس تحققًا، وتاريخ الانتهاء لا يُمنح مقدمًا.
  db.prepare('INSERT INTO knowledge_sources(id,tenant_id,kind,reference,title,location_note,owner_id,review_interval_days,expires_on,created_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)')
    .run(sourceId,u.tenant_id,input.kind,reference,v.text(input.title,'عنوان المصدر',200,3),input.location_note?v.text(input.location_note,'مكان المصدر',600,3):'',ownerId,interval(input.review_interval_days),date,u.id,time,time);
  audit(db,u,'knowledge_source',sourceId,'knowledge.registered',{}, {kind:input.kind,reference,owner_id:ownerId});
  return {id:sourceId};
}

const ACTION_FIELDS={verify_source:['note'],request_update:['note'],edit_source:['title','location_note','owner_id','review_interval_days','reason'],retire_source:['reason']};
export function sourceAction(db,supplied,sourceId,action,input){
  writing(db);const u=actor(db,supplied),fields=ACTION_FIELDS[action];if(!fields)fail(404,'not_found','الإجراء غير متاح');
  v.object(input,['version',...fields]);
  const s=typeof sourceId==='string'&&db.prepare('SELECT * FROM knowledge_sources WHERE id=? AND tenant_id=?').get(sourceId,u.tenant_id);
  const manage=can(db,u,'knowledge.manage');
  if(!s||(!manage&&s.owner_id!==u.id))fail(404,'not_found','المصدر غير متاح');
  v.version(input.version,s.version);
  if(s.status!=='active')fail(409,'action_unavailable','المصدر مسحوب');
  const time=now(),date=today();
  if(action==='verify_source'||action==='request_update'){
    // التحقق للمالك المسمى وحده: حامل تصريح الإدارة لا يؤكد عنه، ولو كان أعلى منه.
    if(s.owner_id!==u.id)fail(403,'not_owner','التحقق لمالك المصدر المسمى وحده');
    const confirmed=action==='verify_source',note=v.text(input.note,confirmed?'ما الذي راجعته':'ما الذي يحتاج تحديثًا',1500,10),next=confirmed?addDays(date,s.review_interval_days):null;
    db.prepare('INSERT INTO knowledge_verifications(id,tenant_id,source_id,decision,note,verified_by,verified_on,previous_expires_on,next_expires_on,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)').run(randomUUID(),u.tenant_id,s.id,confirmed?'confirmed':'update_requested',note,u.id,date,s.expires_on,next,time);
    if(confirmed)db.prepare('UPDATE knowledge_sources SET last_verified_on=?,last_verified_by=?,expires_on=?,update_requested=0,version=version+1,updated_at=? WHERE id=?').run(date,u.id,next,time,s.id);
    // طلب التحديث لا يمدد الصلاحية: المصدر يبقى موسومًا حتى يؤكده مالكه بعد تحديثه.
    else db.prepare('UPDATE knowledge_sources SET update_requested=1,version=version+1,updated_at=? WHERE id=?').run(time,s.id);
    audit(db,u,'knowledge_source',s.id,confirmed?'knowledge.verified':'knowledge.update_requested',{expires_on:s.expires_on},{expires_on:next??s.expires_on},note);
    return {id:s.id};
  }
  if(!manage)fail(403,'not_permitted','إدارة مصادر المعرفة لحامل تصريحها');
  if(action==='retire_source'){
    const reason=v.text(input.reason,'سبب السحب',1000,10);
    db.prepare("UPDATE knowledge_sources SET status='retired',retire_reason=?,version=version+1,updated_at=? WHERE id=?").run(reason,time,s.id);
    audit(db,u,'knowledge_source',s.id,'knowledge.retired',{status:'active'},{status:'retired'},reason);
    return {id:s.id};
  }
  // تغيير المالك أو الدورية لا يمنح تحققًا: تاريخ الانتهاء يبقى كما هو حتى يؤكد المالك.
  const ownerId=cleanOwner(db,u,input.owner_id,s.created_by);
  if(ownerId===u.id)fail(409,'separation_of_duties','من يدير المصدر لا يسمي نفسه مالكًا يؤكد صحته');
  const reason=v.text(input.reason,'سبب التعديل',1000,10);
  db.prepare('UPDATE knowledge_sources SET title=?,location_note=?,owner_id=?,review_interval_days=?,version=version+1,updated_at=? WHERE id=?').run(v.text(input.title,'عنوان المصدر',200,3),input.location_note?v.text(input.location_note,'مكان المصدر',600,3):'',ownerId,interval(input.review_interval_days),time,s.id);
  audit(db,u,'knowledge_source',s.id,'knowledge.edited',{owner_id:s.owner_id,review_interval_days:s.review_interval_days},{owner_id:ownerId,review_interval_days:input.review_interval_days},reason);
  return {id:s.id};
}

/* ───── ما يستدعيه المساعد: وسم المصادر المقتبسة ───── */
// تأخذ مصفوفة sources كما يبنيها app/ai.mjs وتعيدها موسومة. لا ترمي خطأ ولا تحجب مصدرًا: أسوأ حال أن تعود بلا وسم.
export function annotateSources(db,supplied,sources){
  const u=currentUser(db,supplied)??supplied,date=today();
  return (Array.isArray(sources)?sources:[]).map(source=>{
    const kind=source?.type==='hr_policy'?'policy':source?.type==='service'?'service_card':null;if(!kind)return source;
    const reference=kind==='policy'?db.prepare('SELECT kind FROM hr_policies WHERE id=? AND tenant_id=?').get(source.id,u.tenant_id)?.kind:source.id;
    const s=reference?db.prepare("SELECT * FROM knowledge_sources WHERE tenant_id=? AND kind=? AND reference=? AND status='active'").get(u.tenant_id,kind,reference):null;
    if(!s)return {...source,knowledge:{state:'unregistered',warning:WARNINGS.unregistered}};
    const state=sourceState(s,date);
    return {...source,knowledge:{state,state_name:STATES[state],warning:warningFor(s,state),owner_name:name(db,s.owner_id),last_verified_on:s.last_verified_on,expires_on:s.expires_on}};
  });
}
// أسطر تحذير جاهزة للإلحاق بنص الإجابة، سطر لكل مصدر موسوم. مصفوفة فارغة = كل المصادر المقتبسة متحقق منها.
export function knowledgeWarnings(db,supplied,sources){
  const lines=new Set();
  for(const s of annotateSources(db,supplied,sources))if(s?.knowledge?.warning)lines.add(`تنبيه — ${s.title??s.id}: ${s.knowledge.warning}${s.knowledge.last_verified_on?` (آخر تحقق ${s.knowledge.last_verified_on}${s.knowledge.owner_name?`، المالك ${s.knowledge.owner_name}`:''})`:s.knowledge.owner_name?` (المالك ${s.knowledge.owner_name})`:''}.`);
  return [...lines];
}
