import { randomUUID } from 'node:crypto';
import { audit, hash, now } from './db.mjs';
import { fail } from './auth.mjs';
import { can, CAPABILITIES, capabilityGap } from './access.mjs';
import { refuse, actorOrRefuse } from './refusal.mjs';
import { PLATFORM, SPEC_FORMAT, CHANGE_CLASSES, canonical, specDigest, entityFor, registeredEntities, liveDefinition, validateSpec, diffSpecs, classifyChange,
  capabilitiesIn, publishVersion, entityLabel, assertEvolution } from './definitions.mjs';
import { optionUsage } from './custom-fields.mjs';

// نقل التعريفات بين بيئتين بتقرير فرق يسبق أي تطبيق (اختبار القبول 18).
//
//   التصدير   التعريفات **المنشورة** وحدها: لا سجلات ولا حسابات ولا منح. أسماء المُعدّ والناشر نصًّا، لا معرّفات حسابات.
//   الفحص     يتحقق من الصيغة والبصمات، ويمرّر كل وثيقة على validateSpec مقابل واصفات **هذه** البيئة وتصاريحها (كيان أو تصريح
//             مجهول يُسمّى ويمنع)، ويعدّ سجلات هذه البيئة التي تحمل خيارًا تسحبه الحزمة، ويحفظ الحزمة وتقرير الفرق وبصمات الساري
//             هنا لحظة الفحص. **لا يُطبَّق شيء.** وتقرير الفرق هو فرق النشر نفسه: حقول أُضيفت أو غُيّرت أو سُحبت، وتسميات قديم←جديد،
//             وإلزام أُضيف أو رُفع، وحجب ضُيّق أو وُسّع، وكلٌّ مصنَّف.
//   التطبيق   يعيد التحقق من بصمات الساري؛ إن تغيّر شيء بين الفحص والتطبيق رُفض (409) وأُعيد الفحص: لا يُطبَّق فرق لم يُعرض. ثم
//             تُنشر الكيانات كلها في معاملة واحدة origin='import'. وحزمة تخفّف ضابطًا لا يطبّقها من فحصها.
export const BUNDLE_FORMAT='36t-definitions/1';
const CAP_KEYS=new Set(CAPABILITIES.map(c=>c.key));
const RANK={additive:0,tightening:1,loosening:2};
const plain=value=>!!value&&typeof value==='object'&&!Array.isArray(value);
const nameOf=(db,userId)=>userId?db.prepare('SELECT name FROM users WHERE id=?').get(userId)?.name??'':'';
function writing(db){if(!db.isTransaction)fail(500,'transaction_required','يتطلب فحص استيراد التعريفات وتطبيقه معاملة قاعدة بيانات');}
function holder(db,supplied,capability,what,next){
  const u=actorOrRefuse(db,supplied);
  if(!can(db,u,capability)){
    const gap=capabilityGap(db,u.tenant_id,capability);
    refuse(403,'not_permitted',{what,missing:[{document:`تصريح «${gap.capability_name}» (${capability})`,why:gap.text,owner:'الأدمن الأول في «الموظفون والصلاحيات»',owner_role:'admin'}],next});
  }
  return u;
}
const bundleDigest=entities=>hash(canonical(entities.map(e=>({entity_key:e.entity_key,version:e.version,spec_digest:e.spec_digest}))));

export function exportBundle(db,supplied,{source_label=''}={}){
  const u=holder(db,supplied,'definitions.configure','لا تُصدَّر تعريفات الصفحات بحسابك','الحزمة تحمل تعريف كل حقل بما فيه المحجوب، فيصدّرها حامل تصريح تعديل التعريفات');
  const entities=[...registeredEntities().map(d=>d.key),PLATFORM].map(key=>liveDefinition(db,u.tenant_id,key)).filter(Boolean).map(live=>{
    const row=db.prepare('SELECT * FROM definition_versions WHERE id=?').get(live.id);
    return {entity_key:live.entity_key,version:live.version,digest:live.digest,spec_digest:live.spec_digest,spec:JSON.parse(row.spec),
      published_at:row.created_at,prepared_by_name:nameOf(db,row.prepared_by),published_by_name:nameOf(db,row.published_by),note:row.note};
  });
  const tenant=db.prepare('SELECT name FROM tenants WHERE id=?').get(u.tenant_id)?.name??u.tenant_id;
  // التصدير قراءة، لكنه إخراجٌ لتعريفات محجوبة خارج المنصة، فيُسجَّل حدثًا كما يُسجَّل تصدير التقارير.
  audit(db,u,'definition','bundle','definitions.exported',{}, {entities:entities.map(e=>`${e.entity_key}@${e.version}`),bundle_digest:bundleDigest(entities)});
  return {format:BUNDLE_FORMAT,spec_format:SPEC_FORMAT,source:{tenant:tenant,label:String(source_label??'').slice(0,120)},exported_at:now(),entities,bundle_digest:bundleDigest(entities),
    contains:'التعريفات المنشورة وحدها. لا سجلات ولا حسابات ولا منح تصاريح في هذه الحزمة.'};
}

// التحقق من شكل الحزمة وبصماتها. حزمة بُدّل فيها حرف بعد تصديرها تُرفض هنا قبل أي مقارنة.
function readBundle(bundle){
  const bad=(what,next='صدّر الحزمة من جديد من شاشة «تعريفات الصفحات» في البيئة المصدر ولا تحرّرها باليد')=>refuse(400,'bundle_invalid',{what,next});
  if(!plain(bundle)||bundle.format!==BUNDLE_FORMAT)bad(`ليست حزمة تعريفات بالصيغة ${BUNDLE_FORMAT}`);
  if(bundle.spec_format!==SPEC_FORMAT)bad(`صيغة الوثائق في الحزمة ${bundle.spec_format??'؟'} وهذه البيئة تقرأ الصيغة ${SPEC_FORMAT}`,'حدّث البيئة الأقدم أولًا، ثم أعد التصدير');
  if(!Array.isArray(bundle.entities)||bundle.entities.length>60)bad('الحزمة لا تحمل قائمة كيانات صالحة');
  const seen=new Set();
  for(const e of bundle.entities){
    if(!plain(e)||typeof e.entity_key!=='string'||!plain(e.spec)||seen.has(e.entity_key))bad('كيان في الحزمة بلا مفتاح أو بلا وثيقة، أو مكرر');
    seen.add(e.entity_key);
    if(specDigest(e.spec)!==e.spec_digest)bad(`وثيقة «${e.entity_key}» لا تطابق بصمتها: تغيّرت بعد التصدير`);
  }
  if(bundleDigest(bundle.entities)!==bundle.bundle_digest)bad('بصمة الحزمة لا تطابق محتواها: تغيّرت بعد التصدير');
  return bundle;
}
// تقرير الفرق لكيان واحد، أو سبب منعه. لا يكتب شيئًا.
function compareEntity(db,u,item){
  const d=entityFor(item.entity_key),blocking=[];
  if(!d)return {entity_key:item.entity_key,label:item.entity_key,state:'blocked',blocking:[{code:'unknown_entity',text:`الكيان «${item.entity_key}» غير مشارك في هذه البيئة: لا واصف له في الكود`}],diff:[],change_class:null};
  const label=entityLabel(db,u.tenant_id,d.key),unknown=capabilitiesIn(item.spec).filter(key=>!CAP_KEYS.has(key));
  for(const key of unknown)blocking.push({code:'unknown_capability',text:`التصريح «${key}» غير معروف في هذه البيئة`});
  let spec=null;
  if(!unknown.length)try{spec=validateSpec(item.spec,d);}catch(error){if(!error.status)throw error;blocking.push({code:error.code,text:error.message});}
  const live=liveDefinition(db,u.tenant_id,d.key),before=live?.spec??{};
  if(spec){
    // الحقل المنشور هنا لا تحذفه حزمة، ونوعه لا يتبدل، **وخياره لا يُحذف**: قيمه في سجلات هذه البيئة تبقى مقروءة بتعريفها.
    // قاعدة الخيار كانت في طريق المحرّر وحده (assertEvolution)، فكان الاستيراد بابًا ثانيًا يسقط خيارًا اختارته سجلات هنا
    // ويُقرأ في التقرير «إضافة». والسجل بعدها يعرض مفتاح الخيار الخام لا اسمه، في الشاشة والقائمة والتصدير معًا —
    // أي أن الوعد المكتوب في التقرير («السحب لا يمحو القيمة: تبقى مقروءة») كان يكذب على من يقرؤه.
    const incoming=new Map((spec.fields??[]).map(f=>[f.key,f]));
    for(const f of before.fields??[]){
      const kept=incoming.get(f.key);
      if(!kept){blocking.push({code:'field_removed',text:`الحزمة لا تحمل الحقل المنشور هنا «${f.label.ar}». الحقل يُسحب في البيئة المصدر ولا يُحذف`});continue;}
      if(kept.type!==f.type){blocking.push({code:'field_type',text:`«${f.label.ar}»: نوعه هنا ${f.type} وفي الحزمة ${kept.type}`});continue;}
      for(const o of f.options??[])if(!(kept.options??[]).some(x=>x.value===o.value)){
        const used=d.table?optionUsage(db,u.tenant_id,d.key,f.key,o.value):0;
        blocking.push({code:'option_removed',text:`«${o.label.ar}» خيار منشور في «${f.label.ar}» لا تحمله الحزمة${used?`، ويحمله هنا ${used} سجلًا`:''}. الخيار يُسحب في البيئة المصدر ولا يُحذف، وإلا فقدت السجلات اسمه`});
      }
    }
  }
  if(blocking.length)return {entity_key:d.key,label,state:'blocked',blocking,diff:[],change_class:null,source_version:item.version,target_version:live?.version??0};
  const diff=diffSpecs(before,spec),change=classifyChange(diff);
  // كم سجلًا هنا يحمل خيارًا تسحبه الحزمة: السحب لا يمحو القيمة، لكن صاحب القرار يرى أثره قبل أن يطبّق.
  const retiring=diff.filter(i=>i.kind==='option_retired'||i.kind==='option_removed').map(i=>{const [field,value]=i.key.split('.');return {field_key:field,option:value,label:i.label,records:d.table?optionUsage(db,u.tenant_id,d.key,field,value):0};});
  return {entity_key:d.key,label,state:diff.length?'changed':'unchanged',blocking:[],diff,change_class:diff.length?change:null,change_class_name:diff.length?CHANGE_CLASSES[change]:'',
    counts:{additive:diff.filter(i=>i.class==='additive').length,tightening:diff.filter(i=>i.class==='tightening').length,loosening:diff.filter(i=>i.class==='loosening').length},
    options_in_use:retiring,source_version:item.version,target_version:live?.version??0,target_digest:live?.digest??'',spec};
}
export function checkImport(db,supplied,input){
  writing(db);
  const u=holder(db,supplied,'definitions.configure','لا تُفحص حزمة تعريفات بحسابك','يفحصها حامل تصريح تعديل التعريفات، ويطبّقها حامل تصريح نشرها');
  if(!plain(input)||Object.keys(input).some(key=>!['bundle','source_label'].includes(key)))fail(400,'invalid_fields','حقول الطلب غير صالحة: الحزمة ووصف مصدرها');
  const bundle=readBundle(input.bundle),label=String(input.source_label??bundle.source?.label??'').trim().slice(0,120);
  const entities=bundle.entities.map(item=>compareEntity(db,u,item)),blocking=entities.flatMap(e=>e.blocking.map(b=>({entity_key:e.entity_key,...b})));
  const changed=entities.filter(e=>e.state==='changed'),worst=changed.reduce((w,e)=>RANK[e.change_class]>RANK[w]?e.change_class:w,'additive');
  const report={format:BUNDLE_FORMAT,source:bundle.source??null,exported_at:bundle.exported_at??null,bundle_digest:bundle.bundle_digest,
    entities:entities.map(({spec,...rest})=>rest),blocking,worst_class:changed.length?worst:null,worst_class_name:changed.length?CHANGE_CLASSES[worst]:'',
    applicable:!blocking.length&&changed.length>0,
    second_person_required:worst==='loosening',
    note:blocking.length?'في الحزمة ما يمنع تطبيقها على هذه البيئة. لم يُحفظ فحص ولم يتغير شيء.'
      :changed.length?'لم يُطبَّق شيء بعد. هذا ما سيتغير على هذه البيئة عند التطبيق.':'الحزمة تطابق التعريفات المنشورة هنا. لا شيء يُطبَّق.'};
  audit(db,u,'definition','bundle','definitions.import_checked',{}, {bundle_digest:bundle.bundle_digest,applicable:report.applicable,blocking:blocking.length,worst_class:report.worst_class});
  if(!report.applicable)return {id:null,...report};
  const importId=randomUUID(),targets=Object.fromEntries(changed.map(e=>[e.entity_key,e.target_digest]));
  db.prepare("INSERT INTO definition_imports(id,tenant_id,source_label,bundle,bundle_digest,diff,target_digests,worst_class,status,checked_by,checked_at) VALUES(?,?,?,?,?,?,?,?,'checked',?,?)")
    .run(importId,u.tenant_id,label,canonical(bundle),bundle.bundle_digest,JSON.stringify(report),JSON.stringify(targets),worst,u.id,now());
  return {id:importId,...report};
}
export function applyImport(db,supplied,importId,input){
  writing(db);
  const u=holder(db,supplied,'definitions.publish','لا تُطبَّق حزمة تعريفات بحسابك','التطبيق نشرٌ لكل كيان في الحزمة، فيلزمه تصريح نشر التعريفات الحساس');
  if(!plain(input)||Object.keys(input).some(key=>key!=='note'))fail(400,'invalid_fields','حقول الطلب غير صالحة: سبب التطبيق وحده');
  const note=String(input.note??'').trim();
  if([...note].length<5||[...note].length>1000)refuse(400,'note_required',{what:'تطبيق الحزمة يلزمه سببٌ مكتوب',next:'اكتب من أين جاءت الحزمة ولماذا تُطبَّق، في خمسة أحرف إلى ألف'});
  const row=typeof importId==='string'?db.prepare('SELECT * FROM definition_imports WHERE id=? AND tenant_id=?').get(importId,u.tenant_id):null;
  if(!row)refuse(404,'not_found',{what:'لا فحص استيراد بهذا المعرّف',next:'افحص الحزمة أولًا من شاشة «تعريفات الصفحات»'});
  if(row.status!=='checked')refuse(409,'import_closed',{what:row.status==='applied'?'هذه الحزمة طُبِّقت من قبل':'هذا الفحص تُرك',next:'افحص الحزمة من جديد إن أردت تطبيقها'});
  if(row.worst_class==='loosening'&&row.checked_by===u.id){
    const gap=capabilityGap(db,u.tenant_id,'definitions.publish',{exclude:[u.id]});
    refuse(409,'second_publisher_required',{what:'هذه الحزمة تخفّف ضابطًا، ولا يطبّقها من فحصها',
      missing:[{document:'ناشر غير من فحص الحزمة',why:'ضابطٌ يُشدَّد بشخص واحد ولا يُخفَّف بشخص واحد',owner:gap.eligible.join('، ')||'حامل تصريح نشر التعريفات غيرك',owner_role:null}],next:gap.text});
  }
  const bundle=readBundle(JSON.parse(row.bundle)),targets=JSON.parse(row.target_digests),published=[];
  // ما عُرض في تقرير الفرق هو ما يُطبَّق: إن تغيّر الساري هنا منذ الفحص فالتقرير لم يعد صادقًا.
  const moved=Object.entries(targets).filter(([key,digest])=>(liveDefinition(db,u.tenant_id,key)?.digest??'')!==digest).map(([key])=>key);
  if(moved.length)refuse(409,'stale_import',{what:`تغيّر التعريف المنشور هنا منذ فحص الحزمة: ${moved.map(key=>`«${entityLabel(db,u.tenant_id,key)}»`).join('، ')}`,
    next:'أعد فحص الحزمة لترى الفرق على ما هو منشور الآن، ثم طبّق'});
  for(const item of bundle.entities.filter(e=>Object.hasOwn(targets,e.entity_key))){
    const result=compareEntity(db,u,item);
    if(result.state==='blocked')refuse(409,'import_blocked',{what:`«${result.label}» لم يعد قابلًا للتطبيق: ${result.blocking.map(b=>b.text).join('؛ ')}`,next:'أعد فحص الحزمة'});
    if(result.state==='unchanged')continue;
    // الحارس نفسه الذي يحرس طريق المحرّر، على طريق الاستيراد: لا حذف حقل منشور، ولا حذف خيار منشور، ولا تبديل نوعٍ نُشر
    // يومًا. يسبق النشر لا يتبعه، فلا يدخل الجدولَ صفٌّ يُتلف قراءة سجل قائم.
    assertEvolution(db,u.tenant_id,item.entity_key,result.spec);
    published.push(publishVersion(db,u,entityFor(item.entity_key),result.spec,{preparedBy:row.checked_by,origin:'import',originRef:row.id,note,diff:result.diff}));
  }
  db.prepare("UPDATE definition_imports SET status='applied',applied_by=?,applied_at=? WHERE id=?").run(u.id,now(),row.id);
  audit(db,u,'definition','bundle','definitions.import_applied',{import_id:row.id,bundle_digest:row.bundle_digest},{published:published.map(p=>`${p.entity_key}@${p.version}`),checked_by:row.checked_by},note);
  return {id:row.id,status:'applied',published};
}
export function abandonImport(db,supplied,importId){
  writing(db);
  const u=holder(db,supplied,'definitions.configure','لا يُترك فحص استيراد بحسابك','يتركه حامل تصريح تعديل التعريفات');
  const row=typeof importId==='string'?db.prepare("SELECT * FROM definition_imports WHERE id=? AND tenant_id=? AND status='checked'").get(importId,u.tenant_id):null;
  if(!row)refuse(404,'not_found',{what:'لا فحص استيراد مفتوح بهذا المعرّف',next:'الفحص المطبَّق أو المتروك لا يُترك مرة ثانية'});
  db.prepare("UPDATE definition_imports SET status='abandoned' WHERE id=?").run(row.id);
  audit(db,u,'definition','bundle','definitions.import_abandoned',{import_id:row.id},{});
  return {id:row.id,status:'abandoned'};
}
export function listImports(db,supplied){
  const u=actorOrRefuse(db,supplied);
  if(!can(db,u,'definitions.configure')&&!can(db,u,'definitions.publish'))return [];
  return db.prepare('SELECT id,source_label,bundle_digest,diff,worst_class,status,checked_by,checked_at,applied_by,applied_at FROM definition_imports WHERE tenant_id=? ORDER BY checked_at DESC LIMIT 50').all(u.tenant_id)
    .map(r=>({id:r.id,source_label:r.source_label,bundle_digest:r.bundle_digest,report:JSON.parse(r.diff),worst_class:r.worst_class,worst_class_name:CHANGE_CLASSES[r.worst_class],status:r.status,
      status_name:{checked:'فُحصت ولم تُطبَّق',applied:'طُبِّقت',abandoned:'تُركت'}[r.status],checked_by_name:nameOf(db,r.checked_by),checked_at:r.checked_at,applied_by_name:nameOf(db,r.applied_by),applied_at:r.applied_at,
      can_apply:r.status==='checked'&&can(db,u,'definitions.publish')&&!(r.worst_class==='loosening'&&r.checked_by===u.id)}));
}
