import { randomUUID } from 'node:crypto';
import { audit, now } from './db.mjs';
import { fail } from './auth.mjs';
import * as v from './validation.mjs';
import { currentUser } from './delegations.mjs';
import { can } from './access.mjs';
import { ASSISTANTS } from './ai.mjs';

// جرد مساعدي الذكاء الاصطناعي: لكل مساعد غرض ومالك بشري وفئات بيانات وجواب صريح عن خروج البيانات من المملكة وتقييم مخاطر.
// الجرد الأولي اقتراح مشتق من ASSISTANTS في ai.mjs، يدخل «مقترحًا» ولا يُفعَّل إلا بتقييم معتمد من غير مُعِدّه وغير مالكه.
// لا «درجة ثقة» رقمية ولا نسبة أمان: مستوى المخاطر حكم بشري مكتوب بأسبابه، لا رقم يوحي بقياس لم يحدث.
export const STATUSES={proposed:'مقترح',assessed:'مُقيَّم',active:'مُفعَّل',suspended:'موقوف'};
export const RISK_LEVELS={low:'منخفض',medium:'متوسط',high:'مرتفع'};
export const DATA_CATEGORIES={own_employee_data:'بيانات السائل نفسه (رصيد إجازاته، ملفه المهني)',hr_policies:'سياسات الموارد البشرية المعتمدة',service_catalog:'دليل الخدمات ومسارات اعتمادها',client_confidential:'بيانات عميل (بريف، خط أساس عقد)',operational_reports:'تقارير مالية أو تشغيلية',pasted_text:'نص يلصقه المستخدم وقد يحوي أي شيء'};
// اقتراح من قراءة prepare() في ai.mjs؛ يراجعه المُعِدّ ولا يُعد تقييمًا.
const SUGGESTED={employee_assistant:['own_employee_data','hr_policies','service_catalog'],development_plan:['own_employee_data'],policy_answer:['hr_policies'],brief_gaps:['pasted_text','client_confidential'],report_explain:['operational_reports'],scope_impact:['client_confidential','pasted_text']};
const TRANSFER_HINT='المزوّد المهيأ في app/ai.mjs خدمة خارجية (api.anthropic.com). ما لم يثبت كتابيًا مقر المعالجة والتخزين فالأسلم الإجابة «نعم» ووصف أساس النقل.';
const riyadhToday=(time=Date.now())=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Riyadh'}).format(new Date(time));
function actor(db,supplied){const u=currentUser(db,supplied);if(!u)fail(403,'forbidden','الحساب غير متاح');return u;}
function writing(db){if(!db.isTransaction)fail(500,'transaction_required','تتطلب الكتابة معاملة قاعدة بيانات');}
const governs=(db,u)=>can(db,u,'ai.govern');
function governor(db,supplied){const u=actor(db,supplied);if(!governs(db,u))fail(403,'not_permitted','جرد المساعدين لمن يحمل تصريح حوكمة الذكاء الاصطناعي');return u;}
const assetRow=(db,u,assetId)=>typeof assetId==='string'&&db.prepare('SELECT * FROM ai_assets WHERE id=? AND tenant_id=?').get(assetId,u.tenant_id)||null;
const userName=(db,id)=>id?db.prepare('SELECT name FROM users WHERE id=?').get(id)?.name??null:null;

// بوابة الجرد: تُغلق افتراضيًا، فغياب الأصل رفضٌ لا سماح. وهي الحَكَم الوحيد على قرار الجرد —
// التشغيل في app/ai.mjs يمرّ بها قبل الإرسال وبعد عودة المزود، ولا يعيد بناء القرار بقراءة محلية.
// (كان يعيد بناءه، بنسخة تُرجع «مسموح» عند غياب الأصل، فبقيت هذه البوابة مُختبَرة بلا مستدعٍ.)
export function assetGate(db,tenantId,assistantKey,today=riyadhToday()){
  const a=db.prepare('SELECT status,next_review_on FROM ai_assets WHERE tenant_id=? AND assistant_key=?').get(tenantId,assistantKey);
  if(!a)return {allowed:false,status:null,overdue:false,reason:'المساعد غير مجرود: لا مالك له ولا تقييم مخاطر معتمد'};
  const overdue=!!a.next_review_on&&a.next_review_on<today;
  if(a.status!=='active')return {allowed:false,status:a.status,overdue,reason:`المساعد ${STATUSES[a.status]} في الجرد، وليس مُفعَّلًا`};
  return {allowed:true,status:a.status,overdue,reason:overdue?'مُفعَّل، ومراجعته الدورية متأخرة':'مُفعَّل بتقييم معتمد'};
}

function presentAssessment(db,a){return a?{...a,data_categories:JSON.parse(a.data_categories),data_category_names:JSON.parse(a.data_categories).map(k=>DATA_CATEGORIES[k]??k),data_leaves_kingdom:!!a.data_leaves_kingdom,risk_name:RISK_LEVELS[a.risk_level],owner_name:userName(db,a.owner_id),prepared_by_name:userName(db,a.prepared_by),decided_by_name:userName(db,a.decided_by)}:null;}
export function aiGovernanceBoard(db,supplied,today=riyadhToday()){
  const u=actor(db,supplied),govern=governs(db,u);
  const rows=db.prepare(`SELECT * FROM ai_assets WHERE tenant_id=?${govern?'':' AND owner_id=?'} ORDER BY name`).all(...(govern?[u.tenant_id]:[u.tenant_id,u.id]));
  if(!govern&&!rows.length)fail(403,'not_permitted','جرد المساعدين لمن يحمل تصريح حوكمة الذكاء الاصطناعي أو لمالك مساعد');
  const assets=rows.map(a=>{
    const approved=presentAssessment(db,a.approved_assessment_id?db.prepare('SELECT * FROM ai_asset_assessments WHERE id=?').get(a.approved_assessment_id):null);
    const open=presentAssessment(db,db.prepare("SELECT * FROM ai_asset_assessments WHERE asset_id=? AND status='submitted'").get(a.id));
    const history=db.prepare('SELECT id,revision,status,risk_level,prepared_by,decided_by,decided_at,decision_note,created_at FROM ai_asset_assessments WHERE asset_id=? ORDER BY revision DESC').all(a.id).map(h=>({...h,risk_name:RISK_LEVELS[h.risk_level],prepared_by_name:userName(db,h.prepared_by),decided_by_name:userName(db,h.decided_by)}));
    const overdue=a.status!=='suspended'&&!!a.next_review_on&&a.next_review_on<today,actions=[];
    if(!open&&(govern||a.owner_id===u.id))actions.push('submit_assessment');
    if(open&&govern&&open.prepared_by!==u.id&&open.owner_id!==u.id)actions.push('decide_assessment');
    if(govern&&['assessed','suspended'].includes(a.status)&&a.approved_assessment_id&&!overdue)actions.push('activate_asset');
    if(['assessed','active'].includes(a.status)&&(govern||a.owner_id===u.id))actions.push('suspend_asset');
    return {...a,status_name:STATUSES[a.status],owner_name:userName(db,a.owner_id),approved,open,history,overdue,
      suggested_categories:SUGGESTED[a.assistant_key]??[],data_leaves_kingdom:approved?approved.data_leaves_kingdom:null,actions};
  });
  const missing=govern?ASSISTANTS.filter(a=>!db.prepare('SELECT 1 FROM ai_assets WHERE tenant_id=? AND assistant_key=?').get(u.tenant_id,a.key)).map(a=>({key:a.key,name:a.name})):[];
  const alerts=[...assets.filter(a=>a.overdue).map(a=>`مراجعة «${a.name}» متأخرة منذ ${a.next_review_on}. لا يُعاد تفعيله بعد إيقاف قبل تقييم جديد.`),
    ...assets.filter(a=>a.status==='active'&&a.approved?.data_leaves_kingdom).map(a=>`«${a.name}» مُفعَّل وبياناته تخرج من المملكة وفق تقييمه المعتمد.`),
    ...(missing.length?[`${missing.length} مساعد في الكود غير مجرود بعد.`]:[])];
  return {today,user_id:u.id,can_govern:govern,statuses:STATUSES,risk_levels:RISK_LEVELS,data_categories:DATA_CATEGORIES,transfer_hint:TRANSFER_HINT,assets,missing,alerts,
    reviewers:govern?db.prepare("SELECT id,name FROM users WHERE tenant_id=? AND active=1 AND role<>'admin' ORDER BY name").all(u.tenant_id):[],
    awaiting_me:assets.filter(a=>a.actions.includes('decide_assessment')).map(a=>({id:a.open.id,title:`تقييم مخاطر · ${a.name}`,actions:['decide_assessment']})),
    note:'الجرد يصف كل مساعد: غرضه ومالكه وبياناته وهل تخرج من المملكة وتقييم مخاطره. المقترحات مشتقة من الكود ولم يعتمدها أحد. لا يُفعَّل مساعد قبل تقييم يعتمده غير مُعِدّه وغير مالكه. الأصل غير النشط يمنع التشغيل ويمنع حفظ الناتج إذا أوقف أثناء انتظار المزود، والمساعد غير المجرود لا يعمل أصلًا حتى يدخل الجرد. ولا يعطي «درجة ثقة»: المخاطر حكم مكتوب بأسبابه.'};
}
// يُدخل كل مساعد معرّف في الكود ولم يُجرد بعد «مقترحًا». يتكرر بلا أثر مضاعف.
export function seedInventory(db,supplied){
  writing(db);const u=governor(db,supplied);let created=0;const time=now();
  for(const a of ASSISTANTS){
    if(db.prepare('SELECT 1 FROM ai_assets WHERE tenant_id=? AND assistant_key=?').get(u.tenant_id,a.key))continue;
    const assetId=randomUUID();
    db.prepare("INSERT INTO ai_assets(id,tenant_id,assistant_key,name,purpose,origin,created_by,created_at,updated_at) VALUES(?,?,?,?,?,'platform',?,?,?)").run(assetId,u.tenant_id,a.key,a.name,a.purpose,u.id,time,time);
    audit(db,u,'ai_asset',assetId,'ai_asset.proposed',{}, {assistant:a.key});created++;
  }
  return {created};
}
export function submitAssessment(db,supplied,assetId,input){
  writing(db);const u=actor(db,supplied),a=assetRow(db,u,assetId);
  if(!a)fail(404,'not_found','المساعد غير متاح');
  if(!governs(db,u)&&a.owner_id!==u.id)fail(403,'not_permitted','يُعد التقييم حامل تصريح الحوكمة أو مالك المساعد');
  v.object(input,['version','owner_id','data_categories','data_leaves_kingdom','transfer_note','risk_level','risk_notes','mitigations']);
  v.version(input.version,a.version);
  if(db.prepare("SELECT 1 FROM ai_asset_assessments WHERE asset_id=? AND status='submitted'").get(a.id))fail(409,'assessment_open','يوجد تقييم بانتظار القرار');
  const owner=typeof input.owner_id==='string'&&db.prepare("SELECT id FROM users WHERE id=? AND tenant_id=? AND active=1 AND role<>'admin'").get(input.owner_id,u.tenant_id);
  if(!owner)fail(400,'owner_id','المالك البشري موظف نشط يسأل عن المساعد ويقرر إيقافه');
  if(!Array.isArray(input.data_categories)||!input.data_categories.length||input.data_categories.some(k=>!Object.hasOwn(DATA_CATEGORIES,k)))fail(400,'data_categories','اختر فئات البيانات التي يعالجها المساعد');
  if(typeof input.data_leaves_kingdom!=='boolean')fail(400,'data_leaves_kingdom','أجب صراحة: هل تخرج البيانات من المملكة؟');
  if(!Object.hasOwn(RISK_LEVELS,input.risk_level))fail(400,'risk_level','اختر مستوى المخاطر');
  const transfer=input.data_leaves_kingdom?v.text(input.transfer_note,'إلى أين تخرج البيانات وعلى أي أساس',1500,10):(input.transfer_note?v.text(input.transfer_note,'ملاحظة النقل',1500):'');
  const notes=v.text(input.risk_notes,'أسباب تقدير المخاطر',3000,20),mitigations=input.mitigations?v.text(input.mitigations,'الضوابط',3000):'';
  const revision=db.prepare('SELECT COALESCE(MAX(revision),0)+1 AS n FROM ai_asset_assessments WHERE asset_id=?').get(a.id).n,assessmentId=randomUUID();
  db.prepare('INSERT INTO ai_asset_assessments(id,tenant_id,asset_id,revision,owner_id,data_categories,data_leaves_kingdom,transfer_note,risk_level,risk_notes,mitigations,prepared_by,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)')
    .run(assessmentId,u.tenant_id,a.id,revision,owner.id,JSON.stringify([...new Set(input.data_categories)]),input.data_leaves_kingdom?1:0,transfer,input.risk_level,notes,mitigations,u.id,now());
  audit(db,u,'ai_asset',a.id,'ai_asset.assessment_submitted',{}, {assessment:assessmentId,revision,risk_level:input.risk_level,data_leaves_kingdom:input.data_leaves_kingdom,owner:owner.id});
  return {id:assessmentId};
}
export function decideAssessment(db,supplied,assessmentId,input,today=riyadhToday()){
  writing(db);const u=governor(db,supplied);v.object(input,['decision','note','next_review_on']);
  const x=typeof assessmentId==='string'&&db.prepare("SELECT * FROM ai_asset_assessments WHERE id=? AND tenant_id=? AND status='submitted'").get(assessmentId,u.tenant_id);
  if(!x)fail(404,'not_found','لا تقييم بانتظار القرار');
  if(x.prepared_by===u.id)fail(409,'separation_of_duties','من أعد التقييم لا يعتمده');
  if(x.owner_id===u.id)fail(409,'separation_of_duties','مالك المساعد لا يعتمد تقييم مساعده');
  if(!['approve','return'].includes(input.decision))fail(400,'decision','اختر القرار');
  const note=v.text(input.note,'سبب القرار',2000,10),time=now(),a=db.prepare('SELECT * FROM ai_assets WHERE id=?').get(x.asset_id);
  if(input.decision==='return'){
    db.prepare("UPDATE ai_asset_assessments SET status='returned',decided_by=?,decided_at=?,decision_note=? WHERE id=?").run(u.id,time,note,x.id);
    audit(db,u,'ai_asset',a.id,'ai_asset.assessment_returned',{}, {assessment:x.id},note);
    return {id:x.id};
  }
  const next=v.date(input.next_review_on);if(next<=today)fail(400,'next_review_on','موعد المراجعة التالية بعد اليوم');
  db.prepare("UPDATE ai_asset_assessments SET status='approved',decided_by=?,decided_at=?,decision_note=? WHERE id=?").run(u.id,time,note,x.id);
  // إعادة تقييم مساعد مُفعَّل تبقيه مُفعَّلًا على التقييم الجديد؛ غير ذلك يصير «مُقيَّمًا» وينتظر قرار التفعيل.
  const status=a.status==='active'?'active':a.status==='suspended'?'suspended':'assessed';
  db.prepare('UPDATE ai_assets SET status=?,owner_id=?,approved_assessment_id=?,next_review_on=?,last_reviewed_on=?,version=version+1,updated_at=? WHERE id=?').run(status,x.owner_id,x.id,next,today,time,a.id);
  audit(db,u,'ai_asset',a.id,'ai_asset.assessment_approved',{status:a.status,owner:a.owner_id},{status,owner:x.owner_id,assessment:x.id,next_review_on:next},note);
  return {id:x.id};
}
export function activateAsset(db,supplied,assetId,input,today=riyadhToday()){
  writing(db);const u=governor(db,supplied);v.object(input,['version','reason']);
  const a=assetRow(db,u,assetId);if(!a)fail(404,'not_found','المساعد غير متاح');
  v.version(input.version,a.version);
  if(!['assessed','suspended'].includes(a.status)||!a.approved_assessment_id)fail(409,'not_assessed','لا يُفعَّل مساعد قبل مالك وتقييم مخاطر معتمد');
  if(a.next_review_on<today)fail(409,'review_overdue','مراجعته متأخرة. يلزم تقييم جديد معتمد قبل التفعيل');
  const reason=v.text(input.reason,'سبب التفعيل',1000,10);
  db.prepare("UPDATE ai_assets SET status='active',suspended_reason='',version=version+1,updated_at=? WHERE id=?").run(now(),a.id);
  audit(db,u,'ai_asset',a.id,'ai_asset.activated',{status:a.status},{status:'active',assessment:a.approved_assessment_id},reason);
  return {id:a.id};
}
// الإيقاف متاح للمالك أيضًا: من يُسأل عن المساعد يملك إيقافه دون انتظار أحد.
export function suspendAsset(db,supplied,assetId,input){
  writing(db);const u=actor(db,supplied);v.object(input,['version','reason']);
  const a=assetRow(db,u,assetId);if(!a)fail(404,'not_found','المساعد غير متاح');
  if(!governs(db,u)&&a.owner_id!==u.id)fail(403,'not_permitted','يوقف المساعد مالكه أو حامل تصريح الحوكمة');
  v.version(input.version,a.version);
  if(!['assessed','active'].includes(a.status))fail(409,'invalid_state','المساعد ليس مُقيَّمًا ولا مُفعَّلًا');
  const reason=v.text(input.reason,'سبب الإيقاف',1000,10);
  db.prepare("UPDATE ai_assets SET status='suspended',suspended_reason=?,version=version+1,updated_at=? WHERE id=?").run(reason,now(),a.id);
  audit(db,u,'ai_asset',a.id,'ai_asset.suspended',{status:a.status},{status:'suspended'},reason);
  return {id:a.id};
}
