import { audit, now } from './db.mjs';
import { fail } from './auth.mjs';
import * as v from './validation.mjs';
import { actorOrRefuse } from './refusal.mjs';
import { can, holds, require as needsCapability } from './access.mjs';
import { getRequest } from './workflow.mjs';
import { REPORTS, visibleSnapshotIds } from './reports.mjs';
import { normalize, tokens, snippet } from './arabic-text.mjs';
import { MODULE_SERVICES } from './static/module-services.mjs';
import { searchText } from './custom-fields.mjs';
import { visibleSql, audiencesFor, gatesFor } from './service-availability.mjs';
// علامة المرادف المقترَح بانتظار تأكيدٍ ثانٍ: ثابتٌ نصّي لا استيراد دورة (catalog-tree لا يستورد هذه الوحدة).
import { PROPOSAL_MARK } from './catalog-tree.mjs';

// البحث الشامل: حقل واحد يغطي كل الكيانات، نصي لا دلالي — يطابق الحروف بعد تطبيعها، ولا يفهم المعنى ولا المرادفات.
// القاعدة الحاكمة: الترشيح بالصلاحيات يقع قبل الاسترجاع. لكل نوع كيان بوابةٌ تُفحص قبل أي استعلام (فإن لم يكن
// للمستخدم حق النوع لم يُستعلم عنه أصلًا)، وشرطُ نطاقٍ يُحقن في جملة SQL نفسها ويُوصل الفهرس بجدوله المصدر،
// فلا يخرج من القاعدة سطر لا يحق للمستخدم فتحه. الفهرس مشتق: لا يُقرأ منه عنوان أو مقتطف قبل اجتياز الشرطين.
const RIYADH=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Riyadh',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const actor=actorOrRefuse;
function writing(db){if(!db.isTransaction)fail(500,'transaction_required','كتابة فهرس البحث تبي معاملة قاعدة بيانات');}
const OPERATIONS=new Set(['employee','manager','pm']);
const HR_POLICY_CAPS=['hr.policy.prepare','hr.policy.accept','hr.contracts.manage','hr.contracts.approve'];
const text=(...parts)=>parts.map(p=>String(p??'').trim()).filter(Boolean).join(' · ');
const COLLAB_SCOPE=`EXISTS(SELECT 1 FROM collaboration_memberships cm WHERE cm.space_id=s.space_id AND cm.tenant_id=s.tenant_id
  AND cm.user_id=? AND cm.removed_at IS NULL AND cm.starts_at<=? AND (cm.ends_at IS NULL OR cm.ends_at>?))`;
const workspaceHref=tool=>(id,row)=>`#workspace/${row.parent_id}/${tool}`;

/* ───── أنواع الكيانات: البوابة وشرط النطاق ومكان الشاشة ───── */
// gate: تُفحص قبل الاستعلام. scope: شرط SQL يربط الفهرس بجدوله المصدر ويطبق العزل. binds: معاملاته بالترتيب.
// الرابط يفتح شاشة النوع؛ لا رابط مباشر لكل سجل إلا الطلبات، فهي وحدها لها مسار خاص في الواجهة.
export const ENTITY_TYPES=[
  {key:'client',name:'العملاء',href:()=>'#clients',
    gate:(db,u)=>OPERATIONS.has(u.role),
    join:'JOIN clients s ON s.id=i.entity_id AND s.tenant_id=i.tenant_id',
    scope:'(s.owner_id=? OR EXISTS(SELECT 1 FROM client_members m WHERE m.client_id=s.id AND m.user_id=? AND m.removed_at IS NULL))',
    binds:u=>[u.id,u.id]},
  {key:'vendor',name:'الموردون',href:()=>'#vendors',
    gate:(db,u)=>['vendors.view','vendors.assess','vendors.manage','vendors.legal'].some(key=>can(db,u,key)),
    join:'JOIN vendors s ON s.id=i.entity_id AND s.tenant_id=i.tenant_id',
    scope:"s.status<>'merged'",binds:()=>[]},
  {key:'employee',name:'الموظفون',href:()=>'#employees',
    gate:(db,u)=>can(db,u,'employees.view'),
    join:'JOIN users s ON s.id=i.entity_id AND s.tenant_id=i.tenant_id',
    scope:'s.active=1',binds:()=>[]},
  {key:'service',name:'الخدمات',href:()=>'#departments',
    gate:()=>true,
    join:'JOIN services s ON s.id=i.entity_id AND s.tenant_id=i.tenant_id',
    // مفتاح التفعيل (ترحيل 129) يقع في شرط النطاق لا في بناء الفهرس: الفهرس يُعاد بناؤه كسولًا كل خمس عشرة
    // ثانية، فمرشّحٌ فيه كان يترك الخدمة الموقوفة تُبحث وتُفتح في تلك النافذة — مفتاحٌ يكذب. هنا يسري لحظة الإخفاء.
    // والجمهور (131) يدخل المُسنَد نفسه: خدمةٌ لا يراها هذا الحساب في التصفّح لا يجدها في البحث.
    scope:(db,u)=>`s.active=1 AND ${visibleSql('s','code','service',audiencesFor(u),gatesFor(db,u))}`,binds:()=>[]},
  {key:'request',name:'الطلبات',href:id=>`#request/${id}`,
    gate:()=>true,
    join:'JOIN requests s ON s.id=i.entity_id AND s.tenant_id=i.tenant_id JOIN services sv ON sv.id=s.service_id',
    // الشرط نفسه المستعمل في قائمة الطلبات: صاحب الطلب، أو من في مساره أصالةً أو تفويضًا، أو المكلف بمهمة فيه،
    // أو منفذ الإدارة المالكة بعد الاعتماد. ثم يُعاد التحقق من كل سطر بقرار الصلاحية الأصلي في workflow.
    scope:`(s.requester_id=?
      OR EXISTS(SELECT 1 FROM approval_steps a WHERE a.request_id=s.id AND a.revision=s.revision AND (a.approver_id=? OR a.approver_id IN (SELECT grantor_id FROM approval_delegations WHERE delegate_id=? AND revoked_at IS NULL)))
      OR EXISTS(SELECT 1 FROM approval_step_escalations e JOIN approval_steps a ON a.id=e.step_id WHERE e.request_id=s.id AND a.revision=s.revision AND (e.to_user_id=? OR e.from_user_id=? OR e.to_user_id IN (SELECT grantor_id FROM approval_delegations WHERE delegate_id=? AND revoked_at IS NULL)))
      OR EXISTS(SELECT 1 FROM request_tasks t WHERE t.request_id=s.id AND t.assignee_id=?)
      OR (s.status IN ('approved','in_progress','completed') AND COALESCE(s.handling_department_id,sv.department_id)=? AND (json_extract(sv.approval_policy,'$.handler_role') IN (?,'member') OR ?='manager')))`,
    // سطر التصعيد (ترحيل 126) يوسّع المرشَّحين بمن نُقل إليه القرار أو عنه؛ بلا صفوف تصعيد لا يضيف أحدًا، والحكم يبقى لـconfirm.
    binds:u=>[u.id,u.id,u.id,u.id,u.id,u.id,u.id,u.department_id,u.role,u.role],
    confirm:(db,u,id)=>{try{getRequest(db,u,id);return true;}catch{return false;}}},
  {key:'project',name:'المشاريع',href:()=>'#work',
    gate:()=>true,
    join:'JOIN projects s ON s.id=i.entity_id AND s.tenant_id=i.tenant_id',
    scope:'EXISTS(SELECT 1 FROM project_members m WHERE m.project_id=s.id AND m.user_id=?)',
    binds:u=>[u.id]},
  {key:'space_task',name:'مهام مساحة العمل',href:workspaceHref('tasks'),parent:'s.space_id',gate:()=>true,
    join:'JOIN space_tasks s ON s.id=i.entity_id AND s.tenant_id=i.tenant_id',scope:COLLAB_SCOPE,binds:u=>[u.id,now(),now()]},
  {key:'workspace_document',name:'مستندات مساحة العمل',href:workspaceHref('files'),parent:'s.space_id',gate:()=>true,
    join:'JOIN workspace_documents s ON s.id=i.entity_id AND s.tenant_id=i.tenant_id',scope:COLLAB_SCOPE,binds:u=>[u.id,now(),now()]},
  {key:'workspace_topic',name:'منشورات مساحة العمل',href:workspaceHref('messages'),parent:'s.space_id',gate:()=>true,
    join:'JOIN workspace_topics s ON s.id=i.entity_id AND s.tenant_id=i.tenant_id',scope:`s.status='published' AND ${COLLAB_SCOPE}`,binds:u=>[u.id,now(),now()]},
  {key:'workspace_event',name:'مواعيد مساحة العمل',href:workspaceHref('schedule'),parent:'s.space_id',gate:()=>true,
    join:'JOIN workspace_events s ON s.id=i.entity_id AND s.tenant_id=i.tenant_id',scope:COLLAB_SCOPE,binds:u=>[u.id,now(),now()]},
  {key:'workspace_checkin',name:'الأسئلة الدورية',href:workspaceHref('checkins'),parent:'s.space_id',gate:()=>true,
    join:'JOIN workspace_checkins s ON s.id=i.entity_id AND s.tenant_id=i.tenant_id',scope:COLLAB_SCOPE,binds:u=>[u.id,now(),now()]},
  {key:'campaign',name:'الحملات',href:()=>'#campaigns',
    gate:(db,u)=>OPERATIONS.has(u.role),
    join:'JOIN campaigns s ON s.id=i.entity_id AND s.tenant_id=i.tenant_id JOIN clients c ON c.id=s.client_id',
    scope:'(c.owner_id=? OR EXISTS(SELECT 1 FROM client_members m WHERE m.client_id=c.id AND m.user_id=? AND m.removed_at IS NULL))',
    binds:u=>[u.id,u.id]},
  {key:'service_card',name:'بطاقات الخدمة المنشورة',href:()=>'#service-cards',
    gate:()=>true,
    join:'JOIN service_cards s ON s.id=i.entity_id AND s.tenant_id=i.tenant_id',
    // بطاقة الخدمة تحمل اسم خدمتها ووصفها، فهي طريق ثانٍ إليها في البحث: تُقفل بالمفتاح نفسه وبالرمز نفسه.
    scope:(db,u)=>`s.status='published' AND ${visibleSql('s','service_code','service',audiencesFor(u),gatesFor(db,u))}`,binds:()=>[]},
  {key:'policy',name:'سياسات الموارد البشرية المعتمدة',href:()=>'#contracts',
    gate:(db,u)=>HR_POLICY_CAPS.some(key=>holds(db,u,key)),
    join:'JOIN hr_policies s ON s.id=i.entity_id AND s.tenant_id=i.tenant_id',
    scope:"s.status='accepted'",binds:()=>[]},
  {key:'report',name:'لقطات التقارير',href:()=>'#reports',
    // لا تقرير يُستعلم عنه قبل حصر مفاتيح التقارير المسموحة لهذا الحساب؛ فإن لم يسمح له أي تقرير لم يُستعلم النوع.
    gate:(db,u)=>allowedReports(db,u).length>0,
    join:'JOIN report_snapshots s ON s.id=i.entity_id AND s.tenant_id=i.tenant_id',
    // حق التقرير لا يكفي لرؤية لقطة غيرك (B1): اللقطات المرئية تُحسب بالقاعدة نفسها التي تحكم فتحها.
    scope:"s.id IN (SELECT value FROM json_each(?))",
    binds:(u,db)=>[JSON.stringify(visibleSnapshotIds(db,u))]}
];
const BY_KEY=new Map(ENTITY_TYPES.map(t=>[t.key,t]));
const allowedReports=(db,u)=>REPORTS.filter(r=>r.allowed(db,u)).map(r=>r.key);

/* ───── بناء الفهرس: مشتق بالكامل من الجداول المصدر ───── */
// ما يدخل الفهرس: ما يُعرض على الشاشة أصلًا. ما لا يدخله إطلاقًا: الرواتب وبنودها، وأرقام الهوية والإقامة
// والجوازات، وبيانات الموردين البنكية، ومرفقات الطلبات ومحتوى الملفات. غيابها عن الفهرس ليس ترشيحًا بل امتناعًا.
function rows(db,tenantId){
  const collected=[],add=(entity_type,entity_id,title,body,{department_id=null,client_id=null,updated_at=''}={})=>{
    const clean=String(title??'').trim();
    if(clean)collected.push({entity_type,entity_id,title:clean,body:String(body??'').trim(),department_id,client_id,updated_at:updated_at??''});
  };
  // الحقول المخصّصة (ترحيل 123) تدخل الفهرس بشرطين معًا: searchable، وقائمة «من يرى» فارغة. الفهرس مشترك بين كل من يرى
  // السجل، فحقل محجوب عن بعضهم لا يدخله أصلًا (custom-fields.mjs searchText) — امتناع لا ترشيح، كالرواتب وأرقام الهوية أدناه.
  for(const c of db.prepare('SELECT * FROM clients WHERE tenant_id=?').all(tenantId))
    add('client',c.id,c.legal_name,text(c.code,c.trade_name,c.sector,c.notes,searchText(db,tenantId,'client',c)),{client_id:c.id,updated_at:c.updated_at});
  for(const x of db.prepare("SELECT * FROM vendors WHERE tenant_id=? AND status<>'merged'").all(tenantId))
    add('vendor',x.id,x.legal_name,text(x.code,x.supplier_key,x.legal_name_en,x.trade_name,x.regions,x.capacity_note,JSON.parse(x.categories).join(' ')),{updated_at:x.updated_at});
  for(const e of db.prepare("SELECT u.*,d.name AS department,p.job_title FROM users u LEFT JOIN departments d ON d.id=u.department_id AND d.tenant_id=u.tenant_id LEFT JOIN employee_profiles p ON p.user_id=u.id WHERE u.tenant_id=? AND u.active=1 AND u.role<>'admin'").all(tenantId))
    add('employee',e.id,e.name,text(e.username,e.job_title,e.department),{department_id:e.department_id});
  // أحدث نسخة لكل رمز وحدها (مركز الخدمات، الدفعة الثالثة): إعادة التسمية نسخةٌ جديدة، وكانت الفهرسة تُدخل كل نسخة
  // نشطة فيعود البحث بالاسم القديم والجديد صفّين للخدمة الواحدة. الاسم القديم يبقى مكتشَفًا من service_synonyms في
  // مركز الخدمات لا من صفٍّ ثانٍ هنا. والطلبات القديمة تشير إلى نسختها ولا تتأثر.
  // ومرادفات الخدمة (service_synonyms، ترحيل 131: الاسم القديم بعد إعادة التسمية، وكلمات الناس من الكود، وما كتبه إنسان) تدخل
  // نصّها المفهرس: حصرُ الفهرس بأحدث نسخة أسقط الاسم القديم من البحث الشامل (مراجعة 23 سبتمبر) بينما بقي في مركز الخدمات.
  // والمقترَح غير المؤكَّد على خدمة سرّية (note يبدأ بعلامة الاقتراح) لا يدخل، كما لا يقرؤه بحث المركز.
  const synonyms=new Map();
  for(const row of db.prepare("SELECT item_key,term FROM service_synonyms WHERE tenant_id=? AND item_kind='service' AND note NOT LIKE ? ORDER BY item_key,normalized").all(tenantId,PROPOSAL_MARK+'|%'))
    synonyms.set(row.item_key,(synonyms.get(row.item_key)??'')+' '+row.term);
  for(const s of db.prepare('SELECT * FROM services s WHERE s.tenant_id=? AND s.active=1 AND s.version=(SELECT MAX(x.version) FROM services x WHERE x.tenant_id=s.tenant_id AND x.code=s.code AND x.active=1)').all(tenantId))
    add('service',s.id,s.name_ar,text(s.code,s.name_en,s.description,synonyms.get(s.code)??''),{department_id:s.department_id});
  for(const r of db.prepare('SELECT * FROM requests WHERE tenant_id=?').all(tenantId)){
    // محتوى الطلب يراه أصلًا من يراه في شاشته؛ لا مرفقات ولا ملفات في الفهرس.
    let payload='';try{payload=Object.values(JSON.parse(r.payload)).filter(x=>typeof x==='string').join(' ');}catch{payload='';}
    add('request',r.id,r.title,text(r.id,payload),{updated_at:r.updated_at});
  }
  for(const p of db.prepare('SELECT * FROM projects WHERE tenant_id=?').all(tenantId))
    add('project',p.id,p.name,p.brief,{updated_at:p.created_at});
  for(const task of db.prepare('SELECT * FROM space_tasks WHERE tenant_id=?').all(tenantId))
    add('space_task',task.id,task.title,text(task.acceptance,task.priority),{updated_at:task.updated_at});
  for(const document of db.prepare('SELECT d.*,r.body FROM workspace_documents d LEFT JOIN workspace_document_revisions r ON r.document_id=d.id AND r.revision=d.current_revision WHERE d.tenant_id=?').all(tenantId))
    add('workspace_document',document.id,document.title,document.body,{updated_at:document.updated_at});
  for(const topic of db.prepare("SELECT * FROM workspace_topics WHERE tenant_id=? AND status='published'").all(tenantId))
    add('workspace_topic',topic.id,topic.title,topic.body,{updated_at:topic.updated_at});
  for(const event of db.prepare('SELECT * FROM workspace_events WHERE tenant_id=?').all(tenantId))
    add('workspace_event',event.id,event.title,text(event.description,event.location),{updated_at:event.updated_at});
  for(const checkin of db.prepare('SELECT * FROM workspace_checkins WHERE tenant_id=? AND active=1').all(tenantId))
    add('workspace_checkin',checkin.id,checkin.question,text(checkin.cadence,checkin.local_time),{updated_at:checkin.updated_at});
  for(const c of db.prepare('SELECT * FROM campaigns WHERE tenant_id=?').all(tenantId))
    add('campaign',c.id,c.name,text(c.objective,c.budget_reference,c.learning),{client_id:c.client_id,updated_at:c.updated_at});
  for(const c of db.prepare("SELECT c.*,s.name_ar FROM service_cards c LEFT JOIN services s ON s.tenant_id=c.tenant_id AND s.code=c.service_code AND s.active=1 WHERE c.tenant_id=? AND c.status='published'").all(tenantId))
    add('service_card',c.id,text(c.service_code,c.name_ar)||c.service_code,text(c.requesters,c.trigger_note,c.outputs,c.acceptance_evidence,c.kpis,c.policy_reference),{updated_at:c.updated_at});
  for(const p of db.prepare("SELECT * FROM hr_policies WHERE tenant_id=? AND status='accepted'").all(tenantId))
    add('policy',p.id,p.title,text(p.body,p.basis,p.effective_from),{updated_at:p.created_at});
  for(const s of db.prepare('SELECT * FROM report_snapshots WHERE tenant_id=?').all(tenantId))
    add('report',s.id,s.title,text(s.report_key,s.params),{updated_at:s.created_at});
  return collected;
}
const upsert=db=>db.prepare(`INSERT INTO search_index(tenant_id,entity_type,entity_id,title,body,normalized,department_id,client_id,updated_at) VALUES(?,?,?,?,?,?,?,?,?)
  ON CONFLICT(tenant_id,entity_type,entity_id) DO UPDATE SET title=excluded.title,body=excluded.body,normalized=excluded.normalized,department_id=excluded.department_id,client_id=excluded.client_id,updated_at=excluded.updated_at`);

// إعادة بناء فهرس كيان كامل من جداوله المصدر. الفهرس ليس مصدر حقيقة: حذفه وبناؤه لا يفقد المنصة شيئًا.
export function reindex(db,tenantId){
  writing(db);
  if(typeof tenantId!=='string'||!tenantId)fail(400,'tenant','نوع الكيان هذا مو صحيح');
  db.prepare('DELETE FROM search_index WHERE tenant_id=?').run(tenantId);
  const statement=upsert(db);let entries=0;
  for(const r of rows(db,tenantId)){
    statement.run(tenantId,r.entity_type,r.entity_id,r.title,r.body,normalize(`${r.title} ${r.body}`),r.department_id,r.client_id,r.updated_at);
    entries++;
  }
  db.prepare('INSERT INTO search_index_state(tenant_id,rebuilt_at,entries) VALUES(?,?,?) ON CONFLICT(tenant_id) DO UPDATE SET rebuilt_at=excluded.rebuilt_at,entries=excluded.entries').run(tenantId,now(),entries);
  return {entries};
}

// تحديث سجل واحد في الفهرس. للوحدات التي تعرف متى تغيّر سجلها، فلا تُعاد فهرسة الكيان كله.
export function indexEntity(db,input){
  writing(db);
  v.object(input,['tenant_id','entity_type','entity_id','title','body','department_id','client_id','updated_at']);
  if(!BY_KEY.has(input.entity_type))fail(400,'entity_type','نوع كيان ما يعرفه الفهرس');
  const title=v.text(input.title,'العنوان',500),body=input.body?v.text(input.body,'النص',20000):'';
  if(typeof input.tenant_id!=='string'||typeof input.entity_id!=='string')fail(400,'entity_id','معرّف السجل هذا مو صحيح');
  upsert(db).run(input.tenant_id,input.entity_type,input.entity_id,title,body,normalize(`${title} ${body}`),input.department_id??null,input.client_id??null,input.updated_at??'');
  return {indexed:true};
}
export function removeFromIndex(db,tenantId,entityType,entityId){
  writing(db);
  db.prepare('DELETE FROM search_index WHERE tenant_id=? AND entity_type=? AND entity_id=?').run(tenantId,entityType,entityId);
  return {removed:true};
}

// إعادة البناء عند الطلب من الخادم قبل كل بحث. لا تُدوَّن في سجل التدقيق إلا حين يطلبها المستخدم صراحةً:
// بناء فهرس مشتق ليس فعلًا على بيانات، وتدوينه مع كل بحث يغرق سلسلة التدقيق بما لا يفيد مراجعًا.
// maxAgeMs يمنع إعادة بناء الكيان كله مع كل ضغطة بحث؛ صفرٌ يعني ابنِ الآن مهما كان عمر الفهرس.
export function refreshIndex(db,supplied,{explicit=false,maxAgeMs=15000}={}){
  writing(db);
  const u=actor(db,supplied);
  needsCapability(db,u,'search.use');
  const state=db.prepare('SELECT rebuilt_at,entries FROM search_index_state WHERE tenant_id=?').get(u.tenant_id);
  if(!explicit&&state&&maxAgeMs>0&&Date.now()-Date.parse(state.rebuilt_at)<maxAgeMs)return {entries:state.entries,rebuilt:false};
  const result=reindex(db,u.tenant_id);
  if(explicit)audit(db,u,'search_index',u.tenant_id,'search.reindexed',{}, result);
  return {...result,rebuilt:true};
}

/* ───── الاستعلام ───── */
// FTS5 لا يقبل رموز صيغته داخل الكلمة، والتطبيع ترك حروفًا وأرقامًا فقط؛ التنصيص يجعل كل كلمة حرفية.
const ftsQuery=list=>list.map(t=>`"${t}"*`).join(' ');
const trigramQuery=list=>list.filter(t=>t.length>=3).map(t=>`"${t}"`).join(' ');
const PER_TYPE=200;

function search(db,u,type,list,limit){
  const scope=typeof type.scope==='function'?type.scope(db,u):type.scope;
  const partial=trigramQuery(list);
  const match=`i.rowid IN (SELECT rowid FROM search_fts WHERE search_fts MATCH ?)${partial?' OR i.rowid IN (SELECT rowid FROM search_trigram WHERE search_trigram MATCH ?)':''}`;
  const sql=`SELECT i.entity_id,i.title,i.body,i.updated_at,${type.parent??'NULL'} AS parent_id FROM search_index i ${type.join}
    WHERE i.tenant_id=? AND i.entity_type=? AND ${scope} AND (${match}) ORDER BY i.updated_at DESC,i.entity_id LIMIT ${PER_TYPE}`;
  const binds=[u.tenant_id,type.key,...type.binds(u,db),ftsQuery(list),...(partial?[partial]:[])];
  const found=db.prepare(sql).all(...binds);
  // تحقق ثانٍ بقرار الصلاحية الأصلي حيث كان القرار في الكود لا في SQL. الشرط في SQL يضيّق، وهذا يحسم.
  const confirmed=type.confirm?found.filter(r=>type.confirm(db,u,r.entity_id)):found;
  return confirmed.map(r=>({...r,score:rank(r,list)})).sort((a,b)=>b.score-a.score||(a.updated_at<b.updated_at?1:-1)).slice(0,limit);
}
// ترتيب بسيط ومعلن: مطابقة العنوان كاملًا ثم بدايته ثم وروده فيه ثم ورود الكلمة في النص. لا ترجيح دلالي.
function rank(row,list){
  const title=normalize(row.title),body=normalize(row.body);
  let score=0;
  for(const token of list){
    if(title===token)score+=100;
    else if(title.startsWith(token))score+=40;
    else if(title.includes(token))score+=20;
    else if(body.includes(token))score+=5;
  }
  return score;
}

export function searchAll(db,supplied,query,{limit=10}={}){
  const u=actor(db,supplied);
  needsCapability(db,u,'search.use');
  const raw=typeof query==='string'?query:'';
  if(raw.length>200)fail(400,'query','نص البحث ما يتعدّى مئتين حرف');
  const list=tokens(raw),size=Number.isInteger(limit)&&limit>0&&limit<=50?limit:10;
  const state=db.prepare('SELECT rebuilt_at,entries FROM search_index_state WHERE tenant_id=?').get(u.tenant_id)??null;
  const groups=[];
  // خدمات لها شاشة مخصصة (مثل «طلب إجازة»): ليست سجلات في الفهرس، فتُطابق هنا بالكلمات نفسها بعد التطبيع.
  const direct=list.length&&u.role!=='admin'?MODULE_SERVICES.filter(m=>can(db,u,m.capability)&&list.every(t=>normalize([m.name_ar,m.name_en,m.description,m.section,m.keywords].join(' ')).includes(t))):[];
  if(direct.length)groups.push({key:'module_service',name:'خدمات مباشرة',count:direct.length,results:direct.map(m=>({id:m.code,title:m.name_ar,snippet:m.description,href:m.href,updated_at:null}))});
  if(list.length)for(const type of ENTITY_TYPES){
    // البوابة قبل الاستعلام: نوع لا يحق للمستخدم فتحه لا يُسأل عنه الفهرس أصلًا.
    if(!type.gate(db,u))continue;
    const results=search(db,u,type,list,size).map(r=>({id:r.entity_id,title:r.title,snippet:snippet(r.body||r.title,raw),href:type.href(r.entity_id,r),updated_at:r.updated_at||null}));
    if(results.length)groups.push({key:type.key,name:type.name,count:results.length,results});
  }
  return {today:RIYADH(),query:raw,normalized:normalize(raw),
    groups,total:groups.reduce((n,g)=>n+g.results.length,0),
    searchable:ENTITY_TYPES.filter(t=>t.gate(db,u)).map(t=>({key:t.key,name:t.name})),
    index:{built_at:state?.rebuilt_at??null,entries:state?.entries??0,ready:!!state},
    note:'بحث نصي لا دلالي: يطابق الحروف بعد توحيد التشكيل والهمزات والتاء المربوطة والأرقام الهندية، ولا يفهم المعنى ولا المرادفات ولا يرتب بالأهمية. لا تظهر لك إلا السطور التي تملك فتح شاشتها، والرواتب وأرقام الهوية والبيانات البنكية خارج الفهرس أصلًا. الرابط يفتح شاشة النوع؛ الطلب وحده له رابط مباشر.'};
}

export function searchBoard(db,supplied,query=''){return searchAll(db,supplied,query);}
