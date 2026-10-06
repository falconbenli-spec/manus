import { randomUUID } from 'node:crypto';
import { audit, now } from './db.mjs';
import { fail, AppError } from './auth.mjs';
import * as v from './validation.mjs';
import { currentUser } from './delegations.mjs';
import { holds, holdsIn } from './access.mjs';
import { personName, personDepartment } from './people-read.mjs';
import { termApplier } from './definitions.mjs';
import { derivedKpis } from './form-kpis.mjs';
import { FORM_CATALOGUE, FORM_DEPARTMENTS, BANT, BANT_UNDEFINED, bantFieldKeys, INFERRED_NOTE, UNDEFINED_NOTE, TEMPLATE_NOTE,
  TEMPLATE_DEFAULT_NOTE, UNVERIFIED_NOTE, UNVERIFIED_SOURCES, APPENDIX, VERIFIED, COMPARISON } from './forms-catalogue.mjs';
import { driveFormsSummary } from './forms-source-audit.mjs';

// محرك النماذج الإلكترونية (ترحيل 107).
//
// قرار المالك (20 سبتمبر): «لا ما ابي شي يطبع وكل شي يكون الكتروني وطريقة الموافقات تكون إلكترونية».
// فلا نسخة للطباعة ولا محاكاة لتخطيط ملف Word، ولا سطر توقيع ولا صورة توقيع. النموذج شاشة أولًا،
// وسجله الإلكتروني رابط يُفتح ويُشارك، وكل سطر توقيع في الأصل صار خطوة اعتماد إلكترونية تحمل هوية من اعتمد.
//
// التعريف بيانات مؤرخة بنسخة، لا شيفرة: أقسام وحقول وسلسلة اعتماد. يبدأ مسودة، ويقبله مالك بشري غير معدّه،
// والمقبول لا يُعدَّل — تعديله نسخة جديدة.
// النموذج المملوء سلسلة نسخ: النسخة المعتمدة لا تُعدَّل، وتعديلها نسخة جديدة تُعاد فيها الاعتمادات التي مسّها
// التعديل وحدها، وتُحمل البقية بقرار صاحبها ووقته ونسختها. القديمة تبقى بكل اعتماداتها قابلة للقراءة.
// التقديم نفسه إقرار إلكتروني من معدّ النموذج: هويته ووقته ونسخته في صف النسخة وفي سلسلة التدقيق.

const id=()=>randomUUID();
const EDITABLE=['draft'];
const OPEN=['draft','submitted','incomplete','under_review','returned'];
export const STATUS_NAMES={draft:'مسودة',submitted:'مقدَّم',incomplete:'ناقص',under_review:'قيد المراجعة',returned:'معاد للتعديل',
  approved:'معتمد',rejected:'مرفوض',cancelled:'ملغى',superseded:'محل نسخة أحدث'};
export const APPROVAL_STATUS_NAMES={pending:'بانتظار القرار',approved:'معتمد',returned:'معاد',rejected:'مرفوض'};
export const SUBJECT_NAMES={project:'مشروع',request:'طلب خدمة',opportunity:'فرصة',supplier:'مورد'};
export const DEFINITION_STATUS_NAMES={draft:'مسودة',accepted:'معتمد',superseded:'محل نسخة أحدث',retired:'موقوف'};
export const FIELD_TYPES=['text','textarea','date','select','number','checks'];
export const GATE_RULES=['equals','not_equals','includes','all'];

const name=(db,userId)=>personName(db,userId);
function actor(db,supplied){const u=currentUser(db,supplied);if(!u)fail(403,'forbidden','الحساب غير متاح');return u;}
function writing(db){if(!db.isTransaction)fail(500,'transaction_required','تتطلب كتابة النماذج معاملة قاعدة بيانات');}
const parse=row=>({...row,spec:JSON.parse(row.spec)});
export const fieldsOf=spec=>spec.sections.flatMap(s=>s.fields.map(field=>({...field,section:s.key,owner:s.owner})));
const chainCapabilities=spec=>new Set([spec.author.capability,...spec.chain.map(s=>s.capability)]);
// سطر «اعتمد» كما يُقرأ على الشاشة: الاسم والدور والوقت ومرجع السجل. لا صورة ولا سطر فارغ.
export const approvalLine=entry=>entry.decided_by_name
  ? `اعتمد: ${entry.decided_by_name} · ${entry.title} · ${entry.decided_at} · تعريف نسخة ${entry.definition_version} · نموذج نسخة ${entry.instance_version}`
  : `بانتظار: ${entry.title}`;

// ───────────────────────── زرع الكتالوج ─────────────────────────
// كل نموذج يُزرع مسودة بنسخة 1 بلا معِدّ بشري، فلا يُحسب قبوله اعتمادًا ذاتيًا. الزرع لا يمس نموذجًا موجودًا.
// سند التعريف المزروع من الكتالوج نفسه: لكل نموذج ملفُّه (سجل قراءة دورة المشروع، أو جرد مجلد
// الموارد البشرية). ولا يُحفظ في spec لأن spec ما يصممه صاحب النموذج، والسند ليس مما يُصمَّم.
// وتعريفٌ صمّمه إنسان في المنصة لا سند كتالوج له: سنده ما كتبه هو في source_note، فيُعاد null
// لا VERIFIED — نسبةُ تعريفٍ لم يُقرأ من ملف إلى ملفٍ لم يُقرأ منه كذبةٌ في الحمولة.
const CATALOGUE_SOURCE=new Map(FORM_CATALOGUE.map(form=>[form.key,form.source_doc??VERIFIED]));

export function installCatalogue(db,tenantId){
  writing(db);
  const time=now(),installed=[];
  for(const form of FORM_CATALOGUE){
    if(db.prepare('SELECT 1 FROM form_definitions WHERE tenant_id=? AND form_key=?').get(tenantId,form.key))continue;
    const spec={sections:form.sections,author:form.author,chain:form.chain,attachments:form.attachments,
      subject_kinds:form.subject_kinds,warnings:form.warnings??[],gates:form.gates??[],mandate:form.mandate,cycle:form.cycle,
      // تبعيات النموذج من عمود «المرفقات / الارتباطات» في فهرس المصدر، وتصنيفه من عمود «التصنيف».
      depends_on:form.depends_on??[],classification:form.classification??''};
    db.prepare(`INSERT INTO form_definitions(id,tenant_id,form_key,version,title_ar,title_en,department_code,department_name,
      step_no,spec,source_note,sla_days,status,created_at) VALUES(?,?,?,1,?,?,?,?,?,?,?,?,'draft',?)`)
      .run(`seed:${tenantId}:${form.key}:1`,tenantId,form.key,form.title,form.title_en,form.department,form.department_name,
        form.step_no??null,JSON.stringify(spec),form.source_note,form.sla_days??null,time);
    const aliases=[...form.aliases.code.map(a=>['code',a]),...(form.aliases.file??[]).map(a=>['file',a]),
      ...(form.aliases.name_ar??[]).map(a=>['name_ar',a]),...(form.aliases.name_en??[]).map(a=>['name_en',a])];
    // الرمز المختصر (MOD-01، MOD-02) تعيده المصادر على نماذج مختلفة، والأسماء الإنجليزية تتوزع على BD-04 وPM-01 وPM-02
    // بتعارض بين الفهرس والملفات: كلها تُحفظ أسماء بديلة موسومة ambiguous ولا يُعرض بديل قط على أنه المعرّف.
    const flagged=form.aliases.ambiguous??{};
    for(const [kind,alias] of aliases){
      const declared=Object.hasOwn(flagged,alias);
      const duplicate=kind==='code'&&/^MOD-\d{2}$/.test(alias),mislabelled=alias==='VD-03';
      const ambiguous=declared||duplicate||mislabelled?1:0;
      const note=declared?flagged[alias]
        :duplicate?'تعارض المصدر 3: هذا الرمز مستعمل لأكثر من نموذج؛ ليس معرّفًا'
        :mislabelled?'تعارض المصدر 3: اسم الملف VD-03 ومحتواه CW-02؛ ليس معرّفًا':'';
      db.prepare('INSERT OR IGNORE INTO form_definition_aliases(tenant_id,form_key,alias_kind,alias,ambiguous,note) VALUES(?,?,?,?,?,?)')
        .run(tenantId,form.key,kind,alias,ambiguous,note);
    }
    installed.push(form.key);
  }
  return {installed};
}

// البحث بالاسم البديل: يعيد كل ما يطابقه. رمز مكرر يعيد أكثر من نموذج، ولا يُقدَّم أحدها على أنه المقصود.
export function aliasLookup(db,tenantId,alias){
  const needle=String(alias??'').trim();
  if(needle.length<2)return {alias:needle,matches:[],ambiguous:false,note:''};
  const rows=db.prepare(`SELECT form_key,alias,alias_kind,ambiguous,note FROM form_definition_aliases
    WHERE tenant_id=? AND alias=? COLLATE NOCASE ORDER BY form_key`).all(tenantId,needle);
  const matches=rows.map(row=>{
    const latest=db.prepare('SELECT title_ar,department_code,step_no,status,version FROM form_definitions WHERE tenant_id=? AND form_key=? ORDER BY version DESC LIMIT 1').get(tenantId,row.form_key);
    return {form_key:row.form_key,alias:row.alias,alias_kind:row.alias_kind,ambiguous:!!row.ambiguous,note:row.note,
      title:latest?.title_ar??row.form_key,department_code:latest?.department_code??'',step_no:latest?.step_no??null,
      status:latest?.status??null,version:latest?.version??null};
  });
  return {alias:needle,matches,ambiguous:matches.length>1||matches.some(m=>m.ambiguous),
    note:matches.length>1?'هذا الرمز مستعمل لأكثر من نموذج في المصادر. المعرّف الداخلي وحده يحسم المقصود.':''};
}

// ───────────────────────── التعريفات ─────────────────────────
// أحدث صف للتعريف (ما يراه الكتالوج، ولو كان مسودة تنتظر القبول)، والصف المقبول الساري (ما تُعبَّأ به النسخ).
const latestRow=(db,tenantId,formKey)=>db.prepare('SELECT * FROM form_definitions WHERE tenant_id=? AND form_key=? ORDER BY version DESC LIMIT 1').get(tenantId,formKey);
const acceptedRow=(db,tenantId,formKey)=>db.prepare("SELECT * FROM form_definitions WHERE tenant_id=? AND form_key=? AND status='accepted' ORDER BY version DESC LIMIT 1").get(tenantId,formKey);
export const currentDefinition=(db,tenantId,formKey)=>{const row=acceptedRow(db,tenantId,formKey)??latestRow(db,tenantId,formKey);return row?parse(row):null;};

function aliasesOf(db,tenantId,formKey){
  return db.prepare('SELECT alias_kind,alias,ambiguous,note FROM form_definition_aliases WHERE tenant_id=? AND form_key=? ORDER BY alias_kind,alias')
    .all(tenantId,formKey).map(a=>({...a,ambiguous:!!a.ambiguous}));
}
// نموذج مربوط بسجل مكتوب في وحدة أخرى (ترحيل 117): لا يُعبَّأ من الكتالوج نسخةً فارغة موازية،
// لأن حقوله تُدخل هناك بتحققها وبوابتها. الكتالوج يعرّف به ويدل على شاشته، فلا يُملأ الحقل مرتين.
export const boundRecord=(db,formKey)=>db.prepare('SELECT * FROM intake_form_bindings WHERE form_key=?').get(formKey)??null;

// «يتطلب: …» — تبعيات النموذج كما في عمود «المرفقات / الارتباطات» بالفهرس، مع اسم كل نموذج مطلوب وسطر مصدر التبعية.
export function prerequisitesOf(db,tenantId,spec){
  return (spec.depends_on??[]).map(item=>{
    const latest=db.prepare('SELECT title_ar,status FROM form_definitions WHERE tenant_id=? AND form_key=? ORDER BY version DESC LIMIT 1')
      .get(tenantId,item.form_key);
    return {form_key:item.form_key,title:latest?.title_ar??item.form_key,source:item.source,in_catalogue:!!latest};
  });
}
// النماذج المطلوبة التي لا نسخة منها على الجهة نفسها. تنبيه لا مانع: النموذج يسجّل الواقع، والتبعية تُقال ولا تُفرض.
function missingPrerequisites(db,row,definition){
  return prerequisitesOf(db,row.tenant_id,definition.spec).filter(item=>
    !db.prepare(`SELECT 1 FROM form_instances WHERE tenant_id=? AND form_key=? AND subject_kind=? AND subject_id=?
      AND status NOT IN ('cancelled','rejected') LIMIT 1`).get(row.tenant_id,item.form_key,row.subject_kind,row.subject_id));
}

function definitionView(db,u,row){
  const spec=JSON.parse(row.spec),live=acceptedRow(db,u.tenant_id,row.form_key);
  const bound=boundRecord(db,row.form_key);
  if(bound)return {...definitionBody(db,u,row,spec,live),fillable:false,accepted_version:live?.version??null,
    bound_to:{record_kind:bound.record_kind,screen:bound.screen,data_entry:bound.data_entry,unbound_note:bound.unbound_note,
      note:`حقول هذا النموذج تُدخل في شاشة «${bound.screen}» حيث تحقّقها وبوابتها، ولا يُفتح له نموذج فارغ هنا. النسخة المرتبطة بكل سجل تُقرأ من هناك.`}};
  return {...definitionBody(db,u,row,spec,live),fillable:!!live,accepted_version:live?.version??null,bound_to:null};
}
function definitionBody(db,u,row,spec,live){
  return {id:row.id,form_key:row.form_key,version:row.version,title:row.title_ar,title_en:row.title_en,
    department_code:row.department_code,department_name:row.department_name,step_no:row.step_no,
    status:row.status,status_name:DEFINITION_STATUS_NAMES[row.status]??row.status,source_note:row.source_note,sla_days:row.sla_days,
    prepared_by_name:name(db,row.prepared_by),accepted_by_name:name(db,row.accepted_by),accepted_at:row.accepted_at,
    effective_from:row.effective_from,decision_note:row.decision_note,row_version:row.row_version,created_at:row.created_at,
    // تبديل اسم كيان في سجل التعريفات (ترحيل 123) يصل تسميات حقول النموذج عند القراءة؛ التعريف المقبول نفسه لا يُمسّ، وبلا تجاوز منشور تمر الأقسام كما هي.
    sections:(terms=>spec.sections.map(section=>{const fields=terms(section.fields);return fields===section.fields?section:{...section,fields};}))(termApplier(db,u.tenant_id)),author:spec.author,chain:spec.chain,attachments:spec.attachments,
    subject_kinds:spec.subject_kinds,warnings:spec.warnings??[],gates:spec.gates??[],mandate:spec.mandate??'',cycle:spec.cycle??'',
    classification:spec.classification??'',
    // شبكة التبعيات: «يتطلب: …» بأسماء النماذج وسطر مصدر كل تبعية.
    requires:prerequisitesOf(db,u.tenant_id,spec),
    // سند التعريف ملفُّه هو: سجل القراءة لنماذج دورة المشروع، وجرد درايف لنماذج الموارد البشرية.
    // كان يُعاد VERIFIED لكل تعريف بلا استثناء، فصارت حمولةُ الشاشة تنسب النماذج الثمانية إلى
    // وثيقةٍ لا تذكرها (§0 فيها يحصر القراءة في مجلدَي دورة العمل). الشاشة تطبع source_note الصحيح،
    // فالكذب كان في الحمولة وحدها — وهو كذبٌ على من يقرؤها بواجهة أخرى أو باختبار.
    source_file:CATALOGUE_SOURCE.get(row.form_key)??null,comparison:COMPARISON,appendix:APPENDIX,
    inferred_fields:fieldsOf(spec).filter(field=>field.inferred).map(field=>({key:field.key,label:field.label,section:field.section,note:INFERRED_NOTE})),
    inferred_steps:spec.chain.filter(s=>s.inferred).map(s=>({key:s.key,title:s.title,note:INFERRED_NOTE})),
    // قيم وصلت معبأة في القالب الأصلي: تُعرض افتراضيات قالب يغيّرها من يعبّئ النموذج، لا أسئلة مفتوحة.
    template_defaults:fieldsOf(spec).filter(field=>field.template_default!==undefined)
      .map(field=>({key:field.key,label:field.label,section:field.section,value:field.template_default,note:TEMPLATE_DEFAULT_NOTE})),
    // ما لا سند له في ملف مقروء: حقل أو خطوة اعتماد مستندها ذيل مبتور أو ملف تعذّرت قراءته.
    unverified_items:[...fieldsOf(spec).filter(field=>field.unverified)
      .map(field=>({kind:'field',key:field.key,label:field.label,reason:field.unverified,note:UNVERIFIED_NOTE})),
      ...spec.chain.filter(s=>s.unverified).map(s=>({kind:'step',key:s.key,label:s.title,reason:s.unverified,note:UNVERIFIED_NOTE}))],
    aliases:aliasesOf(db,u.tenant_id,row.form_key),
    // على الكتالوج لا نسخة بعد، فالإدارة التي يُسأل عنها إدارة القارئ نفسه: هو من سيعبّئ، وإدارته
    // هي إدارة النسخة حين تُفتح. فلا تَعِد الشاشة بدورٍ يرفضه المحرك عند التقديم.
    can_author:holdsIn(db,u,spec.author.capability,u.department_id),
    my_roles:[...chainCapabilities(spec)].filter(capability=>holdsIn(db,u,capability,u.department_id))};
}

// إعداد نسخة جديدة من تعريف: مسودة باسم معدّها، لا تسري حتى يقبلها غيره من المالكين.
export function draftDefinition(db,supplied,input){
  writing(db);const u=actor(db,supplied);
  if(!holds(db,u,'forms.design'))fail(403,'not_permitted','إعداد تعريفات النماذج لمن يملك تصريح إعدادها');
  v.object(input,['form_key','title_ar','title_en','department_code','department_name','step_no','sla_days','source_note','spec']);
  const formKey=v.text(input.form_key,'المعرّف الداخلي للنموذج',60,6).toUpperCase();
  if(!/^FORM-[A-Z0-9][A-Z0-9-]{2,54}$/.test(formKey))fail(400,'form_key','المعرّف الداخلي يبدأ بـFORM- ثم حروف إنجليزية كبيرة وأرقام وشرطات');
  const spec=validateSpec(input.spec);
  if((spec.depends_on??[]).some(item=>item.form_key===formKey))fail(400,'form_spec','النموذج لا يتطلب نفسه');
  const stepNo=input.step_no===null||input.step_no===undefined||input.step_no===''?null:Number(input.step_no);
  if(stepNo!==null&&(!Number.isInteger(stepNo)||stepNo<1||stepNo>24))fail(400,'step_no','رقم الخطوة من 1 إلى 24');
  const slaDays=input.sla_days===null||input.sla_days===undefined||input.sla_days===''?null:Number(input.sla_days);
  if(slaDays!==null&&(!Number.isInteger(slaDays)||slaDays<0||slaDays>120))fail(400,'sla_days','زمن الخدمة بالأيام من 0 إلى 120');
  const existing=db.prepare('SELECT * FROM form_definitions WHERE tenant_id=? AND form_key=? ORDER BY version DESC LIMIT 1').get(u.tenant_id,formKey);
  if(existing?.status==='draft')fail(409,'draft_exists','لهذا النموذج مسودة تنتظر القبول. اقبلها قبل إعداد نسخة جديدة');
  const version=(existing?.version??0)+1,definitionId=id();
  db.prepare(`INSERT INTO form_definitions(id,tenant_id,form_key,version,title_ar,title_en,department_code,department_name,
    step_no,spec,source_note,sla_days,status,prepared_by,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,'draft',?,?)`)
    .run(definitionId,u.tenant_id,formKey,version,v.text(input.title_ar,'اسم النموذج',180,3),input.title_en?v.text(input.title_en,'الاسم الإنجليزي',180):'',
      v.text(input.department_code,'رمز الإدارة',20,2).toUpperCase(),v.text(input.department_name,'اسم الإدارة',120,2),
      stepNo,JSON.stringify(spec),v.text(input.source_note,'مصدر التعريف',1000,3),slaDays,u.id,now());
  audit(db,u,'form_definition',definitionId,'form_definition.drafted',{}, {form_key:formKey,version});
  return {id:definitionId,form_key:formKey,version};
}

export function acceptDefinition(db,supplied,formKey,input){
  writing(db);const u=actor(db,supplied);
  if(!holds(db,u,'forms.accept'))fail(403,'not_permitted','قبول تعريفات النماذج لمالك النموذج الحامل لتصريح القبول');
  v.object(input,['version','effective_from','note']);
  const draft=db.prepare("SELECT * FROM form_definitions WHERE tenant_id=? AND form_key=? AND status='draft' ORDER BY version DESC LIMIT 1").get(u.tenant_id,String(formKey));
  if(!draft)fail(404,'not_found','لا مسودة تعريف لهذا النموذج تنتظر قبولك');
  v.version(input.version,draft.row_version);
  if(draft.prepared_by===u.id)fail(409,'separation_of_duties','من أعدّ التعريف لا يقبله');
  const effective=v.date(input.effective_from),time=now();
  const note=v.text(input.note,'إقرارك بقبول التعريف',1000,10);
  const previous=db.prepare("SELECT * FROM form_definitions WHERE tenant_id=? AND form_key=? AND status='accepted' ORDER BY version DESC LIMIT 1").get(u.tenant_id,draft.form_key);
  if(previous)db.prepare("UPDATE form_definitions SET status='superseded',row_version=row_version+1 WHERE id=?").run(previous.id);
  db.prepare("UPDATE form_definitions SET status='accepted',accepted_by=?,accepted_at=?,effective_from=?,decision_note=?,row_version=row_version+1 WHERE id=?")
    .run(u.id,time,effective,note,draft.id);
  audit(db,u,'form_definition',draft.id,'form_definition.accepted',{status:'draft'},{status:'accepted',form_key:draft.form_key,version:draft.version},note);
  return {id:draft.id,form_key:draft.form_key,version:draft.version};
}

// تحقق من شكل التعريف. الكتالوج المزروع يمر بالفحص نفسه في الاختبارات.
export function validateSpec(input){
  const spec=v.object(input??{},['sections','author','chain','attachments','subject_kinds','warnings','gates','mandate','cycle',
    'depends_on','classification']);
  const bad=message=>fail(400,'form_spec',message);
  if(!Array.isArray(spec.sections)||!spec.sections.length||spec.sections.length>12)bad('يلزم قسم واحد إلى 12 قسمًا');
  if(!spec.author||typeof spec.author.title!=='string'||spec.author.title.trim().length<2||typeof spec.author.capability!=='string'||!spec.author.capability)
    bad('يلزم تعريف دور معدّ النموذج وتصريحه: التقديم إقرار إلكتروني منه');
  if(!Array.isArray(spec.chain)||!spec.chain.length||spec.chain.length>6)bad('تلزم خطوة اعتماد إلكترونية واحدة إلى ست خطوات');
  const sectionKeys=new Set(),fieldKeys=new Set(),allKeys=new Set(spec.sections.flatMap(s=>(s?.fields??[]).map(x=>x?.key)));
  for(const section of spec.sections){
    if(!section||typeof section.key!=='string'||!/^[a-z][a-z0-9_]{1,39}$/.test(section.key)||sectionKeys.has(section.key))bad('معرّف القسم مكرر أو غير صالح');
    sectionKeys.add(section.key);
    if(typeof section.title!=='string'||section.title.trim().length<2)bad('لكل قسم عنوان');
    if(typeof section.owner!=='string'||section.owner.trim().length<2)bad('لكل قسم جهة تستكمله، تُذكر في رسالة النقص');
    if(!Array.isArray(section.fields)||!section.fields.length||section.fields.length>30)bad('يلزم حقل واحد إلى 30 حقلًا في كل قسم');
    for(const field of section.fields){
      if(!field||typeof field.key!=='string'||!/^[a-z][a-z0-9_]{1,39}$/.test(field.key)||fieldKeys.has(field.key)
        ||['__proto__','prototype','constructor'].includes(field.key))bad('معرّف الحقل مكرر أو غير صالح');
      fieldKeys.add(field.key);
      if(typeof field.label!=='string'||field.label.trim().length<2)bad('لكل حقل اسم عربي');
      if(!FIELD_TYPES.includes(field.type))bad(`نوع الحقل غير مدعوم: ${field.type}`);
      if(typeof field.required!=='boolean')bad('مطلوبية الحقل قيمة منطقية');
      if(['select','checks'].includes(field.type)&&(!Array.isArray(field.options)||!field.options.length||field.options.length>40))bad('قائمة الخيارات غير صالحة');
      if(field.show_when&&(typeof field.show_when!=='object'||!allKeys.has(field.show_when.field)))bad('شرط ظهور الحقل يشير إلى حقل غير موجود');
    }
  }
  const stepKeys=new Set();
  for(const step of spec.chain){
    if(!step||typeof step.key!=='string'||stepKeys.has(step.key))bad('معرّف خطوة الاعتماد مكرر أو غير صالح');
    stepKeys.add(step.key);
    if(typeof step.capability!=='string'||!step.capability)bad('لكل خطوة اعتماد تصريح يحدد من يعتمدها');
    if(typeof step.title!=='string'||step.title.trim().length<2)bad('لكل خطوة اعتماد عنوان يذكر من يعتمد');
    if(!Array.isArray(step.covers)||!step.covers.length||step.covers.some(key=>!sectionKeys.has(key)))bad('خطوة الاعتماد تغطي أقسامًا موجودة في النموذج');
  }
  if(spec.attachments!==undefined&&(typeof spec.attachments!=='object'||typeof spec.attachments.allowed!=='boolean'))bad('إعداد المرفقات غير صالح');
  if(spec.subject_kinds!==undefined&&(!Array.isArray(spec.subject_kinds)||!spec.subject_kinds.length
    ||spec.subject_kinds.some(k=>!Object.hasOwn(SUBJECT_NAMES,k))))bad('جهة ارتباط النموذج غير صالحة');
  if(spec.warnings!==undefined&&(!Array.isArray(spec.warnings)||spec.warnings.some(x=>typeof x!=='string')))bad('تنبيهات المصدر نصوص');
  if(spec.gates!==undefined){
    if(!Array.isArray(spec.gates)||spec.gates.length>8)bad('بوابات المصدر ثماني بوابات كحد أقصى');
    const allFields=new Set(spec.sections.flatMap(s=>s.fields.map(x=>x.key)));
    for(const item of spec.gates){
      if(!item||!allFields.has(item.field))bad('بوابة المصدر تشير إلى حقل غير موجود');
      if(!GATE_RULES.includes(item.rule))bad('قاعدة البوابة غير معروفة');
      if(typeof item.message!=='string'||item.message.trim().length<10)bad('لكل بوابة نص التنبيه الذي فرضها من المصدر');
    }
  }
  // التبعيات: نموذج لا يتطلب نفسه، ولكل تبعية سطر مصدرها من عمود «المرفقات / الارتباطات» في الفهرس.
  if(spec.depends_on!==undefined){
    if(!Array.isArray(spec.depends_on)||spec.depends_on.length>6)bad('تبعيات النموذج ست تبعيات كحد أقصى');
    const seen=new Set();
    for(const item of spec.depends_on){
      if(!item||typeof item.form_key!=='string'||!/^FORM-[A-Z0-9][A-Z0-9-]{2,54}$/.test(item.form_key))bad('تبعية النموذج تشير إلى معرّف نموذج غير صالح');
      if(seen.has(item.form_key))bad('تبعية النموذج مكررة');
      seen.add(item.form_key);
      if(typeof item.source!=='string'||item.source.trim().length<5)bad('لكل تبعية سطر مصدرها من عمود «المرفقات / الارتباطات»');
    }
  }
  if(spec.classification!==undefined&&(typeof spec.classification!=='string'||spec.classification.length>60))bad('تصنيف النموذج نص قصير من عمود «التصنيف»');
  return spec;
}

// ───────────────────────── التحقق من التعبئة ─────────────────────────
// رسالة الرفض تذكر الحقل الناقص والجهة التي تستكمله. الحقل المخفي بشرطه لا يُطلب ولا تدخل قيمته السجل.
export function validateForm(spec,payload,{full=false}={}){
  const fields=fieldsOf(spec);
  v.object(payload??{},fields.map(field=>field.key));
  const clean={},missing=[],visible=fields.filter(field=>v.fieldVisible(field,payload,fields));
  for(const field of visible){
    const value=payload?.[field.key];
    const blank=value===undefined||value===''||(Array.isArray(value)&&!value.length);
    if(blank){if(full&&field.required)missing.push({key:field.key,label:field.label,owner:field.owner,section:field.section});continue;}
    if(field.type==='checks'){
      if(!Array.isArray(value)||value.some(x=>typeof x!=='string')||new Set(value).size!==value.length)
        fail(400,'invalid_option',`${field.label}: اختيار غير صالح`);
      const stray=value.filter(x=>!field.options.includes(x));
      if(stray.length)fail(400,'invalid_option',`${field.label}: بند خارج القائمة — ${stray.join('، ')}`);
      clean[field.key]=value;continue;
    }
    const text=v.text(value,field.label,field.max_length??3000,field.min_length??1);
    if(field.type==='date')v.date(text);
    if(field.type==='select'&&!field.options.includes(text))fail(400,'invalid_option',`${field.label}: اختر قيمة من القائمة`);
    if(field.type==='number'){
      if(!/^\d{1,12}(?:\.\d{1,2})?$/.test(text))fail(400,'invalid_number',`${field.label}: أدخل رقمًا موجبًا بخانتين عشريتين كحد أقصى`);
      const numeric=Number(text);
      if(field.min!==undefined&&numeric<field.min)fail(400,'out_of_range',`${field.label}: أقل قيمة مقبولة ${field.min}`);
      if(field.max!==undefined&&numeric>field.max)fail(400,'out_of_range',`${field.label}: أعلى قيمة مقبولة ${field.max}`);
    }
    clean[field.key]=text;
  }
  if(clean.start_date&&clean.end_date&&clean.end_date<clean.start_date)fail(400,'date_order','تاريخ النهاية يسبق البداية');
  // بنود القائمة غير المؤشَّرة ليست مانعًا بذاتها، لكنها تُذكر باسمها وباسم من يورّدها.
  const pendingDocuments=visible.filter(field=>field.type==='checks').flatMap(field=>{
    const chosen=new Set(Array.isArray(clean[field.key])?clean[field.key]:[]);
    return field.options.filter(option=>!chosen.has(option)).map(option=>({field:field.key,label:field.label,item:option,owner:field.owner}));
  });
  if(full&&missing.length)throw Object.assign(new AppError(400,'missing_field',missing.length===1
    ?`الحقل مطلوب: ${missing[0].label} — يستكمله ${missing[0].owner}`
    :`لا يمكن تقديم النموذج قبل استكمال ${missing.length} حقلًا: ${missing.map(m=>`${m.label} (${m.owner})`).join('، ')}`),
    {details:{fields:missing}});
  return {clean,missing,pending_documents:pendingDocuments};
}

// BANT في تأهيل العميل المحتمل: جدول المصدر سبعة أعمدة — المعيار والسؤال وإجابة العميل والتقييم والوزن والدرجة والملاحظات.
// الأوزان ثابتة في المصدر، أما درجة كل خيار وحد النجاح فغير محددين فيه. فالمنصة **تسجّل** ما يكتبه المقيّم في التقييم
// والدرجة والملاحظات، و**لا تجمعه ولا تحسب** درجة ولا تصدر حكم تأهيل من تلقائها؛ تعرضه وتقول ما الذي ينقص القرار.
export function bantSummary(spec,payload){
  const fields=fieldsOf(spec),weighted=fields.filter(field=>field.weight!==undefined);
  if(!weighted.length)return null;
  const value=key=>{const raw=payload?.[key];return raw===undefined||raw===''?null:raw;};
  const parts=weighted.map(field=>{
    const keys=bantFieldKeys(field.key);
    return {key:field.key,label:field.label,weight:field.weight,choice:value(keys.answer),options:field.options??[],
      // الأعمدة الثلاثة التي أسقطها الملحق وأُعيدت: تُقرأ كما كُتبت ولا تُحوَّل إلى حساب.
      assessment:fields.some(x=>x.key===keys.assessment)?value(keys.assessment):null,
      score:fields.some(x=>x.key===keys.score)?value(keys.score):null,
      notes:fields.some(x=>x.key===keys.notes)?value(keys.notes):null};
  });
  return {parts,score:null,computed:false,answered:parts.filter(p=>p.choice).length,total:parts.length,
    scored:parts.filter(p=>p.score!==null).length,
    columns:['المعيار','السؤال','إجابة العميل','التقييم','الوزن','الدرجة','ملاحظات'],
    weights:BANT.map(b=>`${b.label.split(' — ')[0]} ${b.weight}%`).join(' · '),
    rule:BANT_UNDEFINED};
}

// ───────────────────────── النسخ المملوءة ─────────────────────────
function instanceRow(db,u,instanceId){
  const row=typeof instanceId==='string'&&db.prepare('SELECT * FROM form_instances WHERE id=? AND tenant_id=?').get(instanceId,u.tenant_id);
  if(!row)fail(404,'not_found','النموذج غير متاح');
  return row;
}
const definitionOf=(db,row)=>parse(db.prepare('SELECT * FROM form_definitions WHERE id=?').get(row.definition_id));
const approvalsOf=(db,instanceId)=>db.prepare('SELECT * FROM form_approvals WHERE instance_id=? ORDER BY position').all(instanceId);
const chainRows=(db,chainId)=>db.prepare('SELECT * FROM form_instances WHERE chain_id=? ORDER BY instance_version').all(chainId);

// إدارة النسخة المملوءة: إدارة من عبّأها.
// صف form_instances لا يحمل إدارة، وجدول projects لا يحمل إدارة، والموضوع قد يكون فرصةً أو موردًا
// لا إدارة له أصلًا — وusers.department_id غير قابل للعدم (وصفر فراغ في قاعدة التشغيل). فإدارة
// المعبّئ هي الإدارة الوحيدة التي تُشتق لكل نسخة بلا استثناء، وأيّ اشتقاق ناقص يُبقي الحصر مفلتًا
// حيث ينقص. ولو قرّر المالك لاحقًا أن العبرة بإدارة الموضوع لا بإدارة المعبّئ، فالتغيير هنا وحده.
const instanceDepartment=(db,row)=>personDepartment(db,row.created_by);

// من يقرأ النموذج المملوء: من عبّأه، وأعضاء مشروعه، ومن يحمل تصريح دور فيه (معدّه أو خطوة اعتماد)
// **ويصل ما يحمله إلى إدارة النسخة**. لا أحد غيرهم.
// كانت holds() وحدها، فكان المنح المحصور بإدارة يقرأ نماذج كل الإدارات: الشاشة تمنح إدارةً واحدة
// والمحرك يفتح الكيان كله. holdsIn تسأل السؤال نفسه مضافًا إليه الحصر الذي مُنح فعلًا.
export function canReadInstance(db,u,row,definition){
  if(row.created_by===u.id)return true;
  if(row.project_id&&db.prepare('SELECT 1 FROM project_members WHERE project_id=? AND user_id=?').get(row.project_id,u.id))return true;
  const department=instanceDepartment(db,row);
  return [...chainCapabilities(definition.spec)].some(capability=>holdsIn(db,u,capability,department));
}
function readable(db,u,instanceId){
  const row=instanceRow(db,u,instanceId),definition=definitionOf(db,row);
  if(!canReadInstance(db,u,row,definition))fail(404,'not_found','النموذج غير متاح');
  return {row,definition};
}
const pendingApproval=(db,row)=>approvalsOf(db,row.id).find(a=>a.status==='pending')??null;

// بوابات المصدر: شروط يفرضها نص تنبيه النموذج نفسه. تُفحص عند الاعتماد الإلكتروني لا عند الحفظ،
// لأن النموذج يسجّل الواقع كما هو، والاعتماد هو الإذن بالمضي. الرسالة نص التنبيه كما ورد في المصدر.
export function openGates(spec,payload){
  const fields=fieldsOf(spec),open=[];
  for(const item of spec.gates??[]){
    const field=fields.find(x=>x.key===item.field);
    if(!field||!v.fieldVisible(field,payload,fields))continue;
    const value=payload?.[item.field];
    const passed=item.rule==='equals'?value===item.value
      :item.rule==='not_equals'?value!==undefined&&value!==''&&value!==item.value
      :item.rule==='includes'?Array.isArray(value)&&value.includes(item.value)
      :Array.isArray(value)&&(field.options??[]).every(option=>value.includes(option));
    if(!passed)open.push({field:item.field,label:field.label,rule:item.rule,value:item.value,message:item.message});
  }
  return open;
}

export function instanceActions(db,u,row,definition){
  const own=row.created_by===u.id,result=[];
  const step=pendingApproval(db,row);
  const department=instanceDepartment(db,row);
  const reviewer=definition.spec.chain.some(s=>holdsIn(db,u,s.capability,department));
  if(own&&EDITABLE.includes(row.status))result.push('edit','submit');
  if(own&&OPEN.includes(row.status))result.push('cancel');
  // القرار الإلكتروني: صاحب تصريح الخطوة المعلقة، وليس من عبّأ النموذج، وداخل إدارة النسخة:
  // المنح المحصور بإدارة لا يقرّر في غيرها، وإلا فالحصر كلام على الشاشة بلا أثر في القرار.
  if(step&&!own&&holdsIn(db,u,step.capability,department)){
    if(row.status==='submitted')result.push('claim_review','mark_incomplete');
    if(['submitted','under_review'].includes(row.status))result.push('approve','return','reject');
  }
  if(['approved','returned','incomplete','rejected'].includes(row.status)&&!row.superseded_by&&(own||reviewer))result.push('revise');
  return result;
}

function approvalView(db,a){
  const entry={position:a.position,step_key:a.step_key,capability:a.capability,title:a.title,from_signature:!!a.from_signature,
    status:a.status,status_name:APPROVAL_STATUS_NAMES[a.status],decided_by_name:name(db,a.decided_by),decided_by:a.decided_by,
    decided_at:a.decided_at,definition_version:a.definition_version,instance_version:a.instance_version,note:a.note,
    carried:!!a.carried_from,carried_note:a.carried_from?'اعتماد محمول من نسخة سابقة: لم يمسّه التعديل، فلم يُعد سؤاله':'',
    record_reference:a.id};
  return {...entry,line:approvalLine(entry)};
}

export function instanceView(db,u,row,definition,{full=false}={}){
  const approvals=approvalsOf(db,row.id).map(a=>approvalView(db,a));
  const payload=JSON.parse(row.payload);
  const versions=chainRows(db,row.chain_id).map(x=>({id:x.id,instance_version:x.instance_version,status:x.status,
    status_name:STATUS_NAMES[x.status],created_at:x.created_at,updated_at:x.updated_at,current:x.id===row.id}));
  const check=(()=>{try{return validateForm(definition.spec,payload,{full:true});}catch(error){
    return {missing:error.details?.fields??[],pending_documents:[],reason:error.message};}})();
  // إقرار التقديم: هوية من قدّم النموذج ودوره ووقته ونسخته. هذا بديل سطر توقيع المُعِدّ في الورق.
  const submission=row.submitted_at?{role:definition.spec.author.title,by_name:name(db,row.created_by),at:row.submitted_at,
    definition_version:definition.version,instance_version:row.instance_version,
    line:`قدّمه وأقرّه: ${name(db,row.created_by)} · ${definition.spec.author.title} · ${row.submitted_at} · نموذج نسخة ${row.instance_version}`}:null;
  return {id:row.id,form_key:row.form_key,definition_id:row.definition_id,definition_version:definition.version,
    title:row.title,status:row.status,status_name:STATUS_NAMES[row.status],subject_kind:row.subject_kind,
    subject_kind_name:SUBJECT_NAMES[row.subject_kind],subject_id:row.subject_id,project_id:row.project_id,
    instance_version:row.instance_version,chain_id:row.chain_id,row_version:row.row_version,
    created_by_name:name(db,row.created_by),own:row.created_by===u.id,created_at:row.created_at,updated_at:row.updated_at,
    submitted_at:row.submitted_at,decided_at:row.decided_at,decision_note:row.decision_note,superseded_by:row.superseded_by,
    definition_title:definition.title_ar,department_name:definition.department_name,department_code:definition.department_code,
    step_no:definition.step_no,sla_days:definition.sla_days,definition_status:definition.status,
    author_role:definition.spec.author.title,submission,approvals,versions,payload,
    missing:check.missing,pending_documents:check.pending_documents,blocking_reason:check.reason??'',
    // «يتطلب: …» وما ينقص منه على هذه الجهة. تنبيه يُقال، لا بوابة تمنع: النموذج يسجّل الواقع كما هو.
    requires:prerequisitesOf(db,row.tenant_id,definition.spec),
    missing_prerequisites:missingPrerequisites(db,row,definition),
    bant:bantSummary(definition.spec,payload),
    // مؤشرات تحسبها المنصة من قيم النموذج (معدل التفاعل في MOD-PR-06). غير محسوب يُقال صراحةً ولا يُعرض صفرًا.
    kpis:derivedKpis(row.form_key,payload),
    open_gates:openGates(definition.spec,payload),warnings:definition.spec.warnings??[],
    // رابط السجل الإلكتروني: يُفتح ويُشارك بدل أن يُطبع.
    record_link:`#forms/${row.id}`,
    actions:instanceActions(db,u,row,definition),
    ...(full?{sections:definition.spec.sections,chain_steps:definition.spec.chain,attachments:definition.spec.attachments,
      inferred_fields:fieldsOf(definition.spec).filter(x=>x.inferred).map(x=>x.key)}:{})};
}

export function getInstance(db,supplied,instanceId){
  const u=actor(db,supplied),{row,definition}=readable(db,u,instanceId);
  return instanceView(db,u,row,definition,{full:true});
}

// جهة ارتباط النموذج. المشروع يُفحص بالعضوية: لا يُعلَّق نموذج على مشروع لست فيه.
function resolveSubject(db,u,definition,input){
  const kind=input.subject_kind,allowed=definition.spec.subject_kinds??['project'];
  if(!allowed.includes(kind))fail(400,'subject_kind',`هذا النموذج يُعلَّق على: ${allowed.map(k=>SUBJECT_NAMES[k]).join('، ')}`);
  const subjectId=v.text(input.subject_id,'السجل المرتبط',80,1);
  if(kind==='project'){
    if(!db.prepare('SELECT 1 FROM projects p JOIN project_members m ON m.project_id=p.id WHERE p.id=? AND p.tenant_id=? AND m.user_id=?').get(subjectId,u.tenant_id,u.id))
      fail(403,'project_scope','المشروع غير متاح لك، فلا تُعلَّق عليه نماذج');
    return {kind,subjectId,projectId:subjectId};
  }
  if(kind==='request'&&!db.prepare('SELECT 1 FROM requests WHERE id=? AND tenant_id=?').get(subjectId,u.tenant_id))fail(404,'not_found','الطلب غير موجود');
  return {kind,subjectId,projectId:null};
}

export function createInstance(db,supplied,input){
  writing(db);const u=actor(db,supplied);
  if(u.role==='admin')fail(403,'forbidden','حساب إدارة المنصة لا يعبئ نماذج أعمال');
  if(!holds(db,u,'forms.fill'))fail(403,'not_permitted','تعبئة النماذج لمن يملك تصريحها');
  v.object(input,['form_key','title','subject_kind','subject_id','payload']);
  const definition=currentDefinition(db,u.tenant_id,String(input.form_key));
  if(!definition)fail(404,'not_found','النموذج غير موجود في الكتالوج');
  // نموذج مربوط بسجل مكتوب: حقوله تُدخل في شاشته بتحققها وبوابتها، ولا تُفتح نسخة فارغة موازية تُعبَّأ مرتين.
  const bound=boundRecord(db,definition.form_key);
  if(bound)fail(409,'bound_record',`هذا النموذج يُعبَّأ في شاشة «${bound.screen}»، لأن حقوله محفوظة هناك بتحققها وبوابتها. لا تُفتح له نسخة ثانية من الكتالوج`);
  if(definition.status!=='accepted')fail(409,'definition_draft','تعريف هذا النموذج ما زال مسودة لم يقبلها مالكه، فلا يُعبَّأ بعد');
  const subject=resolveSubject(db,u,definition,input);
  const {clean}=validateForm(definition.spec,input.payload??{},{full:false});
  const instanceId=id(),time=now();
  db.prepare(`INSERT INTO form_instances(id,tenant_id,form_key,definition_id,chain_id,instance_version,subject_kind,subject_id,
    project_id,title,payload,status,created_by,created_at,updated_at) VALUES(?,?,?,?,?,1,?,?,?,?,?,'draft',?,?,?)`)
    .run(instanceId,u.tenant_id,definition.form_key,definition.id,instanceId,subject.kind,subject.subjectId,subject.projectId,
      v.text(input.title,'عنوان النموذج',180,3),JSON.stringify(clean),u.id,time,time);
  audit(db,u,'form_instance',instanceId,'form.created',{}, {form_key:definition.form_key,definition_version:definition.version,subject_kind:subject.kind});
  return {id:instanceId};
}

export function saveInstance(db,supplied,instanceId,input){
  writing(db);const u=actor(db,supplied);
  v.object(input,['version','title','payload']);
  const {row,definition}=readable(db,u,instanceId);
  v.version(input.version,row.row_version);
  if(!instanceActions(db,u,row,definition).includes('edit'))fail(409,'immutable','هذه النسخة لا تُعدَّل. افتح نسخة جديدة من النموذج');
  const {clean}=validateForm(definition.spec,input.payload??{},{full:false});
  db.prepare('UPDATE form_instances SET title=?,payload=?,row_version=row_version+1,updated_at=? WHERE id=?')
    .run(v.text(input.title,'عنوان النموذج',180,3),JSON.stringify(clean),now(),row.id);
  audit(db,u,'form_instance',row.id,'form.saved',{}, {form_key:row.form_key,instance_version:row.instance_version});
  return getInstance(db,u,row.id);
}

// الأقسام التي تغيّرت بين نسختين: مقارنة قيم حقول كل قسم. تحدد الاعتمادات التي تُفتح من جديد.
export function changedSections(spec,before,after){
  const changed=new Set();
  for(const section of spec.sections)
    for(const field of section.fields)
      if(JSON.stringify(before?.[field.key]??null)!==JSON.stringify(after?.[field.key]??null))changed.add(section.key);
  return changed;
}

function buildApprovals(db,u,row,definition){
  const time=now(),previous=row.instance_version>1
    ?db.prepare('SELECT * FROM form_instances WHERE chain_id=? AND instance_version=?').get(row.chain_id,row.instance_version-1):null;
  const changed=previous?changedSections(definition.spec,JSON.parse(previous.payload),JSON.parse(row.payload)):null;
  const carried=[],opened=[];
  definition.spec.chain.forEach((step,position)=>{
    const touched=!changed||step.covers.some(key=>changed.has(key));
    const earlier=previous?db.prepare("SELECT * FROM form_approvals WHERE instance_id=? AND step_key=? AND status='approved'").get(previous.id,step.key):null;
    const approvalId=id(),fromSignature=step.from_signature===false?0:1;
    if(!touched&&earlier){
      // الاعتماد المحمول يبقى بهويته ووقته ونسختيه كما قُرر أول مرة؛ لا يُنسب لأحد غير من قرره.
      db.prepare(`INSERT INTO form_approvals(id,tenant_id,instance_id,position,step_key,capability,title,from_signature,status,
        decided_by,decided_at,definition_version,instance_version,note,carried_from,created_at) VALUES(?,?,?,?,?,?,?,?,'approved',?,?,?,?,?,?,?)`)
        .run(approvalId,u.tenant_id,row.id,position,step.key,step.capability,step.title,fromSignature,
          earlier.decided_by,earlier.decided_at,earlier.definition_version,earlier.instance_version,earlier.note,earlier.id,time);
      carried.push(step.key);
    }else{
      db.prepare(`INSERT INTO form_approvals(id,tenant_id,instance_id,position,step_key,capability,title,from_signature,status,
        definition_version,instance_version,created_at) VALUES(?,?,?,?,?,?,?,?,'pending',?,?,?)`)
        .run(approvalId,u.tenant_id,row.id,position,step.key,step.capability,step.title,fromSignature,definition.version,row.instance_version,time);
      opened.push(step.key);
    }
  });
  return {carried,opened};
}

export function instanceAction(db,supplied,instanceId,action,input){
  writing(db);const u=actor(db,supplied);
  const fields={submit:[],cancel:['note'],claim_review:[],mark_incomplete:['note'],approve:['note'],return:['note'],reject:['note'],revise:['note']}[action];
  if(!fields)fail(404,'not_found','الإجراء غير متاح');
  v.object(input,['version',...fields]);
  const {row,definition}=readable(db,u,instanceId);
  v.version(input.version,row.row_version);
  if(!instanceActions(db,u,row,definition).includes(action))fail(409,'action_unavailable','الإجراء غير متاح في حالة النموذج الحالية أو لصلاحيتك');
  const time=now();
  if(action==='submit'){
    // التقديم إقرار إلكتروني من معدّ النموذج، فيلزم أن يحمل تصريح دوره المكتوب في التعريف.
    if(!holdsIn(db,u,definition.spec.author.capability,instanceDepartment(db,row)))
      fail(403,'author_capability',`تقديم هذا النموذج إقرار من «${definition.spec.author.title}»، ويلزمه تصريح ${definition.spec.author.capability}`);
    validateForm(definition.spec,JSON.parse(row.payload),{full:true});
    const built=buildApprovals(db,u,row,definition);
    const status=built.opened.length?'submitted':'approved';
    db.prepare('UPDATE form_instances SET status=?,submitted_at=?,row_version=row_version+1,updated_at=?,decided_at=? WHERE id=?')
      .run(status,time,time,status==='approved'?time:null,row.id);
    audit(db,u,'form_instance',row.id,'form.submitted',{status:row.status},
      {status,definition_version:definition.version,instance_version:row.instance_version,carried:built.carried,opened:built.opened});
    return getInstance(db,u,row.id);
  }
  if(action==='revise'){
    const note=v.text(input.note,'سبب فتح نسخة جديدة',1000,5);
    const next=id(),version=row.instance_version+1;
    db.prepare(`INSERT INTO form_instances(id,tenant_id,form_key,definition_id,chain_id,instance_version,subject_kind,subject_id,
      project_id,title,payload,status,created_by,decision_note,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,'draft',?,?,?,?)`)
      .run(next,u.tenant_id,row.form_key,row.definition_id,row.chain_id,version,row.subject_kind,row.subject_id,row.project_id,
        row.title,row.payload,u.id,note,time,time);
    db.prepare("UPDATE form_instances SET status='superseded',superseded_by=?,row_version=row_version+1,updated_at=? WHERE id=?").run(next,time,row.id);
    audit(db,u,'form_instance',row.id,'form.revised',{status:row.status},{superseded_by:next,instance_version:version},note);
    return getInstance(db,u,next);
  }
  if(action==='claim_review'){
    db.prepare("UPDATE form_instances SET status='under_review',row_version=row_version+1,updated_at=? WHERE id=?").run(time,row.id);
    audit(db,u,'form_instance',row.id,'form.review_started',{status:row.status},{status:'under_review'});
    return getInstance(db,u,row.id);
  }
  if(action==='mark_incomplete'){
    const note=v.text(input.note,'ما الناقص ومن يورّده',1000,5);
    db.prepare("UPDATE form_instances SET status='incomplete',decision_note=?,row_version=row_version+1,updated_at=? WHERE id=?").run(note,time,row.id);
    audit(db,u,'form_instance',row.id,'form.marked_incomplete',{status:row.status},{status:'incomplete'},note);
    return getInstance(db,u,row.id);
  }
  if(action==='cancel'){
    const note=v.text(input.note,'سبب الإلغاء',1000,5);
    db.prepare("UPDATE form_instances SET status='cancelled',decision_note=?,decided_at=?,row_version=row_version+1,updated_at=? WHERE id=?").run(note,time,time,row.id);
    audit(db,u,'form_instance',row.id,'form.cancelled',{status:row.status},{status:'cancelled'},note);
    return getInstance(db,u,row.id);
  }
  // قرار خطوة اعتماد إلكتروني: الهوية والتصريح والنسختان والوقت تُثبَّت في الصف وفي سلسلة التدقيق.
  const step=pendingApproval(db,row);
  if(action==='approve'){
    const open=openGates(definition.spec,JSON.parse(row.payload));
    if(open.length)throw Object.assign(new AppError(409,'source_gate',open[0].message),{details:{gates:open}});
  }
  const note=v.text(input.note,'ملاحظة القرار',1000,action==='approve'?0:5);
  const decision={approve:'approved',return:'returned',reject:'rejected'}[action];
  db.prepare('UPDATE form_approvals SET status=?,decided_by=?,decided_at=?,note=? WHERE id=?').run(decision,u.id,time,note,step.id);
  const status=action==='approve'?(pendingApproval(db,row)?'under_review':'approved'):decision;
  db.prepare('UPDATE form_instances SET status=?,decision_note=?,decided_at=?,row_version=row_version+1,updated_at=? WHERE id=?')
    .run(status,note,['approved','rejected','returned'].includes(status)?time:null,time,row.id);
  audit(db,u,'form_instance',row.id,'form.'+action,{status:row.status},
    {status,step_key:step.step_key,capability:step.capability,definition_version:step.definition_version,instance_version:step.instance_version},note);
  return getInstance(db,u,row.id);
}

// ───────────────────────── اللوحة ─────────────────────────
export function formsBoard(db,supplied,query={}){
  const u=actor(db,supplied);
  const text=String(query.q??'').trim().toLocaleLowerCase();
  const department=String(query.department??'').trim().toUpperCase();
  const step=query.step===undefined||query.step===null||query.step===''?null:Number(query.step);
  const projectId=query.project_id?String(query.project_id):null;
  const keys=db.prepare('SELECT DISTINCT form_key FROM form_definitions WHERE tenant_id=? ORDER BY form_key').all(u.tenant_id).map(r=>r.form_key);
  let definitions=keys.map(key=>definitionView(db,u,latestRow(db,u.tenant_id,key)));
  if(department)definitions=definitions.filter(d=>d.department_code===department);
  if(step!==null&&Number.isInteger(step))definitions=definitions.filter(d=>d.step_no===step);
  if(text)definitions=definitions.filter(d=>[d.form_key,d.title,d.title_en,d.department_name,d.department_code,
    ...d.aliases.map(a=>a.alias)].some(value=>String(value??'').toLocaleLowerCase().includes(text)));
  definitions.sort((a,b)=>(a.step_no??99)-(b.step_no??99)||a.form_key.localeCompare(b.form_key));
  const rows=db.prepare(`SELECT * FROM form_instances WHERE tenant_id=?${projectId?' AND project_id=?':''} ORDER BY updated_at DESC,id`)
    .all(...(projectId?[u.tenant_id,projectId]:[u.tenant_id]));
  const instances=[];
  for(const row of rows){
    const definition=definitionOf(db,row);
    if(!canReadInstance(db,u,row,definition))continue;
    instances.push(instanceView(db,u,row,definition,{full:true}));
  }
  const awaiting=instances.filter(x=>x.actions.some(a=>['approve','claim_review'].includes(a)));
  const canDesign=holds(db,u,'forms.design'),canAccept=holds(db,u,'forms.accept');
  return {user_id:u.id,
    today:new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Riyadh',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date()),
    can_design:canDesign,can_accept:canAccept,can_fill:holds(db,u,'forms.fill')&&u.role!=='admin',
    departments:FORM_DEPARTMENTS,status_names:STATUS_NAMES,subject_names:SUBJECT_NAMES,inferred_note:INFERRED_NOTE,
    unverified_note:UNVERIFIED_NOTE,template_default_note:TEMPLATE_DEFAULT_NOTE,
    source_file:VERIFIED,comparison:COMPARISON,appendix:APPENDIX,
    // ملفان في المصدر تعذّرت قراءتهما نهائيًا. يُعرضان للمالك باسميهما وسببهما وما يستند إليهما، ولا يُبنى عليهما شيء.
    unverified_sources:UNVERIFIED_SOURCES,
    // جرد Drive تشغيلي بلا بيانات أشخاص. يظهر لمالك تعريفات النماذج ومصممها فقط، لا لكل موظف يعبئ نموذجًا.
    source_audit:canDesign||canAccept?driveFormsSummary():null,
    filters:{q:query.q??'',department,step:step!==null&&Number.isInteger(step)?step:'',project_id:projectId??''},
    definitions,instances,
    awaiting_me:awaiting.map(x=>({id:x.id,title:x.title,actions:x.actions.filter(a=>['approve','claim_review'].includes(a))})),
    counts:{definitions:definitions.length,accepted:definitions.filter(d=>d.status==='accepted').length,
      drafts:definitions.filter(d=>d.status==='draft').length,instances:instances.length,
      open:instances.filter(x=>OPEN.includes(x.status)).length},
    note:'كل شيء هنا إلكتروني: لا طباعة ولا سطر توقيع. تقديم النموذج إقرار من معدّه بهويته ووقته، وكل سطر توقيع في '
      +'النموذج الأصلي صار خطوة اعتماد تحمل اسم من اعتمد ودوره ووقته ونسخة النموذج التي اعتمدها. '
      +'الكتالوج مسودات مزروعة من مصادر الشركة المقروءة مباشرة ('+VERIFIED+'): كل نموذج يحمل اقتباس مصدره، وكل حقل لم '
      +'ينص عليه المصدر موسوم «'+INFERRED_NOTE+'»، وكل ما مستنده ملف تعذّرت قراءته أو ذيل نص مبتور موسوم «'+UNVERIFIED_NOTE+'». '
      +'وكل نموذج يقول ما يتطلبه من نماذج أخرى كما في عمود «المرفقات / الارتباطات» بفهرس الشركة. '
      +'النموذج لا يُعبَّأ قبل أن يقبل تعريفه مالكه، ومن أعدّ التعريف لا يقبله. '
      +'النسخة المعتمدة لا تُعدَّل؛ تعديلها نسخة جديدة تُعاد فيها الاعتمادات التي مسّها التعديل وحدها.'};
}

// بحث الكتالوج: بالاسم أو الرمز أو الإدارة أو رقم البند. لا يكتب شيئًا، ويعيد معه نتيجة البحث بالاسم البديل
// حتى يظهر الرمز المكرر بكل ما يطابقه بدل أن يُقدَّم أحدها على أنه المقصود.
export function searchForms(db,supplied,input){
  const u=actor(db,supplied);
  v.object(input??{},['q','department','step']);
  const board=formsBoard(db,u,{q:input?.q??'',department:input?.department??'',step:input?.step??''});
  return {query:{q:input?.q??'',department:input?.department??'',step:input?.step??''},
    definitions:board.definitions.map(d=>({form_key:d.form_key,title:d.title,title_en:d.title_en,department_code:d.department_code,
      department_name:d.department_name,step_no:d.step_no,status:d.status,status_name:d.status_name,mandate:d.mandate,
      classification:d.classification,requires:d.requires.map(r=>({form_key:r.form_key,title:r.title})),
      aliases:d.aliases.map(a=>({alias:a.alias,ambiguous:a.ambiguous}))})),
    alias:input?.q?aliasLookup(db,u.tenant_id,input.q):{alias:'',matches:[],ambiguous:false,note:''}};
}

// ───────────────────────── السجل الإلكتروني وتصديره ─────────────────────────
// سجل قابل للقراءة والمشاركة برابط، لا تخطيط ورقة. التصدير ملف بيانات للأرشفة، ليس بديلًا عن الشاشة.
export function instanceRecord(db,supplied,instanceId){
  const u=actor(db,supplied),{row,definition}=readable(db,u,instanceId);
  return {...instanceView(db,u,row,definition,{full:true}),aliases:aliasesOf(db,u.tenant_id,row.form_key),inferred_note:INFERRED_NOTE};
}
export function instanceExport(db,supplied,instanceId){
  const doc=instanceRecord(db,supplied,instanceId);
  return {filename:`${doc.form_key}-v${doc.instance_version}.json`,
    content:JSON.stringify({exported_at:now(),form_key:doc.form_key,definition_version:doc.definition_version,
      definition_status:doc.definition_status,title:doc.title,status:doc.status,subject:{kind:doc.subject_kind,id:doc.subject_id},
      instance_version:doc.instance_version,record_link:doc.record_link,sections:doc.sections,payload:doc.payload,
      submission:doc.submission,approvals:doc.approvals,aliases:doc.aliases,inferred_fields:doc.inferred_fields,
      note:'الاعتماد في هذا الملف سجل إلكتروني (من قرر، بأي تصريح، على أي نسخة، متى). لا توقيع مصور ولا نسخة مطبوعة.'},null,2)};
}
