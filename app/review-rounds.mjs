import { randomUUID } from 'node:crypto';
import { audit, hash, now } from './db.mjs';
import { fail } from './auth.mjs';
import * as v from './validation.mjs';
import { currentUser } from './delegations.mjs';
import { can } from './access.mjs';
import { holidaySet, addWorkingDays, riyadhDate } from './work-calendar.mjs';

// جولات المراجعة: مسار مراحل على نسخة محددة من مخرج الاستوديو، وتعليق مثبَّت على موضع في المادة.
// ما لا تفعله هذه الوحدة: لا تنشئ رابط مراجعة خارجيًا للعميل ولا حسابًا له، ولا ترسل بريدًا، ولا تقارن بكسلات.
export const DECISIONS={approved:'موافق',approved_with_changes:'موافق مع تعديلات',changes_required:'تعديلات مطلوبة'};
export const DECISION_MEANING={approved:'امضِ في التنفيذ كما هو.',approved_with_changes:'امضِ في التنفيذ مع الالتزام بالملاحظات المسجلة.',changes_required:'أوقف التنفيذ؛ النسخة تحتاج تعديلًا ثم نسخة جديدة.'};
export const ANNOTATION_STATUS={open:'مفتوح',addressed:'عولج',wont_fix:'لن يُعالج'};
export const AUDIENCES={internal:'مراجعة داخلية',client:'قرار العميل (يُوثَّق داخليًا)'};
export const MEDIA_KINDS={image:'صورة',pdf:'ملف PDF',video:'فيديو',audio:'صوت',text:'نص'};
export const ROUTE_STATUS={running:'جارٍ',approved:'موافق',approved_with_changes:'موافق مع تعديلات',changes_required:'تعديلات مطلوبة',cancelled:'ملغى'};
export const STAGE_STATUS={waiting:'بانتظار المرحلة السابقة',open:'مفتوحة',decided:'صدر قرارها',cancelled:'ملغاة'};
// قرار العميل كما وثّقه سجل الموافقات الخارجية ⇦ ما يقابله في مسار المراجعة. لا اجتهاد في الترجمة.
const CLIENT_DECISION_MAP={approved:'approved',approved_with_conditions:'approved_with_changes',changes_requested:'changes_required',rejected:'changes_required'};
// ترويسة إطار MPEG صالحة، لا مجرد بايتين يبدآن بـ 0xFFE: مزامنة 11 بت، وإصدار وطبقة غير محجوزين،
// ومعدل بت غير «1111» الممنوع، ومعدل عينة غير محجوز. أي ملف يبدأ بـ 0xFF 0xFF كان يمر صوتًا قبل هذا.
export function mpegFrameHeader(data){
  if(data.length<4||data[0]!==0xFF||(data[1]&0xE0)!==0xE0)return false;
  const version=(data[1]>>3)&3,layer=(data[1]>>1)&3,bitrate=(data[2]>>4)&15,sampleRate=(data[2]>>2)&3;
  return version!==1&&layer!==0&&bitrate!==15&&sampleRate!==3;
}
// النوع من توقيع المحتوى لا من الامتداد، كما في files.mjs.
const SIGNATURES=[
  ['image/png',data=>data.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))],
  ['image/jpeg',data=>data.subarray(0,3).equals(Buffer.from([0xFF,0xD8,0xFF]))],
  ['application/pdf',data=>data.subarray(0,5).equals(Buffer.from('%PDF-'))],
  ['video/mp4',data=>data.length>12&&data.subarray(4,8).toString('latin1')==='ftyp'],
  ['audio/mpeg',data=>data.subarray(0,3).toString('latin1')==='ID3'||mpegFrameHeader(data)]
];
const KIND_TYPES={image:['image/png','image/jpeg'],pdf:['application/pdf'],video:['video/mp4'],audio:['audio/mpeg'],text:['text/plain']};
const ANCHOR_FOR={image:'point',pdf:'point',video:'timestamp',audio:'timestamp',text:'text_range'};
const ROUTE_ACTIONS={add_media:['kind','label','filename','content','body','pages','duration_seconds'],
  annotate:['media_id','stage_id','anchor','page','x','y','at_seconds','char_start','char_end','visibility','body'],
  decide:['stage_id','decision','note','external_approval_id'],save_template:['name','description'],cancel:['reason'],notify:[]};
const id=()=>randomUUID();
const today=()=>riyadhDate(Date.now());

function actor(db,supplied){const u=currentUser(db,supplied);if(!u)fail(403,'forbidden','الحساب غير متاح');return u;}
function writing(db){if(!db.isTransaction)fail(500,'transaction_required','تتطلب كتابة المراجعة معاملة قاعدة بيانات');}
function permitted(db,u){if(!can(db,u,'review.manage'))fail(403,'not_permitted','لا يوجد تصريح لمسارات المراجعة. اطلبه من مسؤول الصلاحيات');return true;}
// العزل: التصريح وحده لا يكفي؛ لا يرى أحد إلا مشاريع هو عضو فيها.
const member=(db,u,projectId)=>!!db.prepare('SELECT 1 FROM project_members WHERE project_id=? AND user_id=?').get(projectId,u.id);
const person=(db,userId)=>userId?db.prepare('SELECT name FROM users WHERE id=?').get(userId)?.name??'':'';
const parse=value=>{try{return JSON.parse(value);}catch{return {};}};

function versionRow(db,u,versionId){
  const row=typeof versionId==='string'&&db.prepare(`SELECT ver.*,o.studio_id,w.project_id,w.tenant_id,w.title AS studio_title,p.name AS project_name
    FROM studio_output_versions ver JOIN studio_outputs o ON o.id=ver.output_id JOIN studio_workspaces w ON w.id=o.studio_id
    JOIN projects p ON p.id=w.project_id WHERE ver.id=? AND w.tenant_id=?`).get(versionId,u.tenant_id);
  if(!row||!member(db,u,row.project_id))fail(404,'not_found','نسخة المخرج غير متاحة');
  return {...row,snapshot:parse(row.snapshot)};
}
function routeRow(db,u,routeId){
  const row=typeof routeId==='string'&&db.prepare(`SELECT r.*,w.project_id,w.title AS studio_title,p.name AS project_name
    FROM review_routes r JOIN studio_workspaces w ON w.id=r.studio_id JOIN projects p ON p.id=w.project_id
    WHERE r.id=? AND r.tenant_id=?`).get(routeId,u.tenant_id);
  if(!row||!member(db,u,row.project_id))fail(404,'not_found','مسار المراجعة غير متاح');
  return row;
}
function mediaRow(db,u,mediaId){
  const row=typeof mediaId==='string'&&db.prepare('SELECT * FROM review_media WHERE id=? AND tenant_id=?').get(mediaId,u.tenant_id);
  if(!row)fail(404,'not_found','المادة غير متاحة');
  routeRow(db,u,row.route_id);
  return row;
}
function integer(value,label,min,max){
  if(!Number.isInteger(value)||value<min||value>max)fail(400,'invalid_number',`${label}: أدخل عددًا صحيحًا بين ${min} و${max}`);
  return value;
}
function optionalDays(value,label){
  if(value===undefined||value===null||value==='')return null;
  return integer(Number(value),label,1,365);
}
function ratio(value,label){
  const n=Number(value);
  if(!Number.isFinite(n)||n<0||n>1)fail(400,'invalid_position','الإحداثيات نسبية بين 0 و1 لا بالبكسل — '+label);
  return n;
}

// الموعد بأيام العمل (الأحد–الخميس دون العطل المعتمدة) من يوم فتح المرحلة.
function openStage(db,route,stage,time,holidays){
  const day=today(),due=stage.due_days?addWorkingDays(day,stage.due_days,holidays):null;
  db.prepare("UPDATE review_stages SET status='open',opened_on=?,due_on=?,version=version+1 WHERE id=? AND version=?").run(day,due,stage.id,stage.version);
  for(const r of db.prepare('SELECT reviewer_id FROM review_stage_reviewers WHERE stage_id=?').all(stage.id))
    db.prepare('INSERT OR IGNORE INTO review_notices(id,tenant_id,route_id,stage_id,user_id,kind,due_on,created_at) VALUES(?,?,?,?,?,?,?,?)')
      .run(id(),route.tenant_id,route.id,stage.id,r.reviewer_id,'review_stage_opened',due,time);
}
function openNextPosition(db,route,afterPosition,time,holidays){
  const next=db.prepare("SELECT MIN(position) AS p FROM review_stages WHERE route_id=? AND status='waiting' AND position>?").get(route.id,afterPosition).p;
  if(next===null||next===undefined)return null;
  for(const stage of db.prepare("SELECT * FROM review_stages WHERE route_id=? AND position=? AND status='waiting'").all(route.id,next))openStage(db,route,stage,time,holidays);
  return next;
}
function closeRoute(db,route,status,time){
  for(const stage of db.prepare("SELECT * FROM review_stages WHERE route_id=? AND status IN ('waiting','open')").all(route.id))
    db.prepare("UPDATE review_stages SET status='cancelled',version=version+1 WHERE id=? AND version=?").run(stage.id,stage.version);
  db.prepare('UPDATE review_routes SET status=?,closed_at=?,version=version+1,updated_at=? WHERE id=? AND version=?').run(status,time,time,route.id,route.version);
}

function stageView(db,u,route,stage,day){
  const reviewers=db.prepare('SELECT x.reviewer_id AS id,us.name FROM review_stage_reviewers x JOIN users us ON us.id=x.reviewer_id WHERE x.stage_id=? ORDER BY us.name').all(stage.id);
  const decision=db.prepare('SELECT * FROM review_decisions WHERE stage_id=?').get(stage.id)??null;
  const mine=reviewers.some(r=>r.id===u.id);
  const overdue=stage.status==='open'&&!!stage.due_on&&stage.due_on<day;
  return {...stage,audience_name:AUDIENCES[stage.audience],status_name:STAGE_STATUS[stage.status],reviewers,
    decision:decision?{...decision,decision_name:DECISIONS[decision.decision],meaning:DECISION_MEANING[decision.decision],decided_by_name:person(db,decision.decided_by)}:null,
    overdue,due_note:stage.due_on?null:'بلا موعد: لم تُدخل مدة لهذه المرحلة، فلا تذكير ولا تصعيد.',
    actions:stage.status==='open'&&mine&&route.status==='running'?['decide']:[]};
}
function annotationView(db,u,route,row){
  const canClose=row.status==='open'&&route.status==='running'&&(row.created_by===u.id||route.created_by===u.id||route.owner_id===u.id);
  return {...row,status_name:ANNOTATION_STATUS[row.status],visibility_name:row.visibility==='internal'?'داخلي — لا يخرج للعميل':'مشترك — يجوز عرضه على العميل',
    created_by_name:person(db,row.created_by),resolved_by_name:row.resolved_by?person(db,row.resolved_by):null,
    place:placeOf(row),actions:canClose?['address','wont_fix']:[]};
}
// وصف الموضع مكتوبًا: تعتمد عليه الواجهة حين تعرض التعليقات قائمةً بجانب المادة بلا CSS مضمّن.
function placeOf(a){
  if(a.anchor==='point')return `${a.page?`صفحة ${a.page} · `:''}أفقيًا ${(a.x*100).toFixed(1)}٪ · رأسيًا ${(a.y*100).toFixed(1)}٪`;
  if(a.anchor==='timestamp'){const s=Math.floor(a.at_seconds);return `الدقيقة ${String(Math.floor(s/60)).padStart(2,'0')}:${String(s%60).padStart(2,'0')}`;}
  return `الأحرف ${a.char_start}–${a.char_end}`;
}
function mediaView(db,u,route,row,shared){
  const annotations=db.prepare(`SELECT * FROM review_annotations WHERE media_id=? AND tenant_id=?${shared?" AND visibility='shared'":''} ORDER BY created_at,id`).all(row.id,u.tenant_id);
  return {id:row.id,kind:row.kind,kind_name:MEDIA_KINDS[row.kind],label:row.label,filename:row.filename,media_type:row.media_type,size:row.size,
    pages:row.pages,duration_seconds:row.duration_seconds,digest:row.digest,uploaded_by_name:person(db,row.uploaded_by),created_at:row.created_at,
    body:row.kind==='text'?row.body:null,preview_path:row.kind==='text'?null:`/api/review-rounds/media/${row.id}`,
    anchor_kind:ANCHOR_FOR[row.kind],annotations:annotations.map(a=>annotationView(db,u,route,a))};
}
// مقارنة نسختين: البيانات الوصفية والمواد فقط. لا مقارنة بكسلات ولا كشف فروق بصرية.
function compareFor(db,u,route){
  const current=db.prepare('SELECT * FROM studio_output_versions WHERE id=?').get(route.output_version_id);
  const previous=db.prepare('SELECT * FROM studio_output_versions WHERE output_id=? AND revision<? ORDER BY revision DESC LIMIT 1').get(route.output_id,route.output_revision)??null;
  const summarize=(row)=>{
    if(!row)return null;
    const snapshot=parse(row.snapshot),previousRoute=db.prepare('SELECT id FROM review_routes WHERE output_version_id=?').get(row.id);
    const media=previousRoute?db.prepare('SELECT kind,label,size,digest FROM review_media WHERE route_id=? ORDER BY created_at,id').all(previousRoute.id):[];
    return {version_id:row.id,revision:row.revision,digest:row.digest,created_at:row.created_at,created_by_name:person(db,row.created_by),
      title:snapshot.title??'',channel:snapshot.channel??'',format:snapshot.format??'',dimensions:snapshot.dimensions??'',language:snapshot.language??'',
      brand_reference:snapshot.brand_reference??'',acceptance:snapshot.acceptance??'',asset_count:Array.isArray(snapshot.asset_ids)?snapshot.asset_ids.length:0,
      content_length:String(snapshot.content??'').length,media};
  };
  const a=summarize(previous),b=summarize(current),fields=[['title','اسم المخرج'],['channel','القناة'],['format','الصيغة'],['dimensions','المقاس'],['language','اللغة'],['brand_reference','مرجع الهوية'],['acceptance','معيار القبول'],['asset_count','عدد الأصول'],['content_length','طول النص']];
  const differences=a?fields.filter(([key])=>String(a[key])!==String(b[key])).map(([key,label])=>({field:label,previous:String(a[key]),current:String(b[key])})):[];
  if(a&&a.media.length!==b.media.length)differences.push({field:'عدد المواد المعروضة',previous:String(a.media.length),current:String(b.media.length)});
  return {previous:a,current:b,differences,
    note:a?'المقارنة على البيانات الوصفية والمواد المرفقة فقط. لا تقارن المنصة البكسلات ولا تكشف فروقًا بصرية.':'لا نسخة سابقة لهذا المخرج.'};
}

export function getRoute(db,supplied,routeId){
  const u=actor(db,supplied);permitted(db,u);
  const route=routeRow(db,u,routeId),day=today();
  const stages=db.prepare('SELECT * FROM review_stages WHERE route_id=? ORDER BY position,name').all(route.id).map(s=>stageView(db,u,route,s,day));
  const media=db.prepare('SELECT * FROM review_media WHERE route_id=? ORDER BY created_at,id').all(route.id).map(m=>mediaView(db,u,route,m,false));
  const annotations=media.flatMap(m=>m.annotations.map(a=>({...a,media_label:m.label,media_kind:m.kind})));
  const running=route.status==='running',owner=[route.created_by,route.owner_id].includes(u.id);
  const actions=[];
  if(running&&owner)actions.push('add_media');
  if(running&&media.length)actions.push('annotate');
  if(running&&stages.some(s=>s.status==='open'))actions.push('notify');
  if(owner)actions.push('save_template');
  if(running&&route.created_by===u.id)actions.push('cancel');
  // أدلة مرحلة العميل: ما وثّقه سجل الموافقات الخارجية على هذه النسخة بالذات. لا شيء غيره يُغلق مرحلة عميل.
  const clientEvidence=db.prepare("SELECT id,decision,status,received_on,scope_note FROM external_approvals WHERE tenant_id=? AND output_version_id=? AND status IN ('documented','verified') ORDER BY received_on DESC").all(route.tenant_id,route.output_version_id)
    .map(row=>({...row,maps_to:CLIENT_DECISION_MAP[row.decision],maps_to_name:DECISIONS[CLIENT_DECISION_MAP[row.decision]]}));
  return {...route,status_name:ROUTE_STATUS[route.status],owner_name:person(db,route.owner_id),created_by_name:person(db,route.created_by),
    stages,media,annotations,client_evidence:clientEvidence,compare:compareFor(db,u,route),
    // التعليقات المفتوحة = قائمة عمل النسخة التالية.
    worklist:annotations.filter(a=>a.status==='open').map(a=>({id:a.id,media_label:a.media_label,place:a.place,body:a.body,visibility:a.visibility,visibility_name:a.visibility_name,created_by_name:a.created_by_name})),
    counts:{internal:annotations.filter(a=>a.visibility==='internal').length,shared:annotations.filter(a=>a.visibility==='shared').length,open:annotations.filter(a=>a.status==='open').length},
    actions};
}

export function reviewBoard(db,supplied){
  const u=actor(db,supplied);permitted(db,u);
  const projects=db.prepare('SELECT p.id,p.name FROM projects p JOIN project_members m ON m.project_id=p.id WHERE p.tenant_id=? AND m.user_id=? ORDER BY p.name').all(u.tenant_id,u.id);
  const ids=projects.map(p=>p.id),marks=ids.map(()=>'?').join(',');
  const routes=ids.length?db.prepare(`SELECT r.id FROM review_routes r JOIN studio_workspaces w ON w.id=r.studio_id WHERE r.tenant_id=? AND w.project_id IN (${marks}) ORDER BY r.opened_at DESC,r.id`).all(u.tenant_id,...ids).map(r=>getRoute(db,u,r.id)):[];
  // نسخ مخرجات مشاريعي التي لم يُفتح لها مسار بعد.
  const candidates=ids.length?db.prepare(`SELECT ver.id,ver.revision,ver.digest,ver.created_by,o.id AS output_id,w.id AS studio_id,w.title AS studio_title,p.name AS project_name,ver.snapshot
    FROM studio_output_versions ver JOIN studio_outputs o ON o.id=ver.output_id JOIN studio_workspaces w ON w.id=o.studio_id JOIN projects p ON p.id=w.project_id
    WHERE w.tenant_id=? AND w.project_id IN (${marks}) AND NOT EXISTS(SELECT 1 FROM review_routes r WHERE r.output_version_id=ver.id) ORDER BY ver.created_at DESC`).all(u.tenant_id,...ids)
    .map(row=>({version_id:row.id,revision:row.revision,digest:row.digest,output_id:row.output_id,studio_id:row.studio_id,studio_title:row.studio_title,project_name:row.project_name,
      title:parse(row.snapshot).title??'مخرج',author_id:row.created_by,author_name:person(db,row.created_by)})):[];
  const people=ids.length?db.prepare(`SELECT DISTINCT us.id,us.name FROM users us JOIN project_members m ON m.user_id=us.id WHERE us.tenant_id=? AND us.active=1 AND m.project_id IN (${marks}) ORDER BY us.name`).all(u.tenant_id,...ids):[];
  const templates=db.prepare('SELECT * FROM review_route_templates WHERE tenant_id=? AND retired_at IS NULL ORDER BY name').all(u.tenant_id)
    .map(t=>({...t,created_by_name:person(db,t.created_by),stages:db.prepare('SELECT * FROM review_template_stages WHERE template_id=? ORDER BY position,name').all(t.id).map(s=>({...s,reviewer_ids:parse(s.reviewer_ids),audience_name:AUDIENCES[s.audience]}))}));
  const notices=db.prepare('SELECT n.*,s.name AS stage_name,r.name AS route_name FROM review_notices n JOIN review_stages s ON s.id=n.stage_id JOIN review_routes r ON r.id=n.route_id WHERE n.tenant_id=? AND n.user_id=? AND n.read_at IS NULL ORDER BY n.created_at DESC').all(u.tenant_id,u.id);
  return {today:today(),user_id:u.id,projects,people,candidates,templates,routes,notices,
    decisions:DECISIONS,decision_meaning:DECISION_MEANING,annotation_status:ANNOTATION_STATUS,audiences:AUDIENCES,media_kinds:MEDIA_KINDS,route_status:ROUTE_STATUS,
    note:'ثلاثة قرارات لا اثنان؛ و«موافق مع تعديلات» يعني: امضِ في التنفيذ والتزم بالملاحظات. القرار يخص نسخة محددة ولا يُعدَّل بعد صدوره، والتراجع قرار جديد على نسخة جديدة. لا رابط مراجعة للعميل ولا حساب له: مرحلة العميل تُغلق بموافقة خارجية وثّقها موظف مخوّل. لا بريد يخرج من المنصة؛ التذكير والتصعيد داخل الشاشة.'};
}

export function createRoute(db,supplied,input){
  writing(db);const u=actor(db,supplied);permitted(db,u);
  v.object(input,['output_version_id','name','owner_id','template_id','stages']);
  const version=versionRow(db,u,input.output_version_id);
  if(db.prepare('SELECT 1 FROM review_routes WHERE output_version_id=?').get(version.id))fail(409,'route_exists','لهذه النسخة مسار مراجعة قائم. النسخة الجديدة تبدأ مسارها الخاص');
  const owner=typeof input.owner_id==='string'&&db.prepare('SELECT id FROM users WHERE id=? AND tenant_id=? AND active=1').get(input.owner_id,u.tenant_id);
  if(!owner||!member(db,{id:owner.id},version.project_id))fail(400,'owner_id','مالك الملف يجب أن يكون عضوًا نشطًا في المشروع');
  if(owner.id===u.id)fail(403,'separation_of_duties','من يفتح المسار لا يكون مالك الملف الذي يُصعَّد إليه توقفه');
  const stages=plannedStages(db,u,input,version);
  const routeId=id(),time=now(),holidays=holidaySet(db,u.tenant_id);
  db.prepare('INSERT INTO review_routes(id,tenant_id,studio_id,output_id,output_version_id,output_revision,output_digest,template_id,name,owner_id,status,opened_at,created_by,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
    .run(routeId,u.tenant_id,version.studio_id,version.output_id,version.id,version.revision,version.digest,stages.templateId,v.text(input.name,'اسم المسار',180,3),owner.id,'running',time,u.id,time);
  for(const stage of stages.list){
    const stageId=id();
    db.prepare("INSERT INTO review_stages(id,route_id,position,name,audience,due_days,reminder_days,escalation_days,status) VALUES(?,?,?,?,?,?,?,?,'waiting')")
      .run(stageId,routeId,stage.position,stage.name,stage.audience,stage.due_days,stage.reminder_days,stage.escalation_days);
    for(const reviewerId of stage.reviewer_ids)db.prepare('INSERT INTO review_stage_reviewers VALUES(?,?,?,?)').run(stageId,reviewerId,u.id,time);
  }
  const route=db.prepare('SELECT * FROM review_routes WHERE id=?').get(routeId);
  const first=db.prepare('SELECT MIN(position) AS p FROM review_stages WHERE route_id=?').get(routeId).p;
  for(const stage of db.prepare('SELECT * FROM review_stages WHERE route_id=? AND position=?').all(routeId,first))openStage(db,route,stage,time,holidays);
  audit(db,u,'review_route',routeId,'review.route_opened',{}, {output_version_id:version.id,revision:version.revision,stages:stages.list.length,owner_id:owner.id,template_id:stages.templateId});
  return {id:routeId};
}
// مراحل المسار: إما من قالب محفوظ، وإما مُدخلة يدويًا. المراحل المتساوية في position تعمل متوازية وتبدأ معًا.
function plannedStages(db,u,input,version){
  let list=[],templateId=null;
  if(input.template_id!==undefined&&input.template_id!==''){
    const template=db.prepare('SELECT * FROM review_route_templates WHERE id=? AND tenant_id=? AND retired_at IS NULL').get(input.template_id,u.tenant_id);
    if(!template)fail(404,'not_found','القالب غير متاح');
    templateId=template.id;
    list=db.prepare('SELECT * FROM review_template_stages WHERE template_id=? ORDER BY position,name').all(template.id).map(s=>({...s,reviewer_ids:parse(s.reviewer_ids)}));
  } else {
    if(!Array.isArray(input.stages)||!input.stages.length||input.stages.length>20)fail(400,'stages','يلزم من مرحلة واحدة إلى عشرين');
    list=input.stages.map(s=>{
      v.object(s,['position','name','audience','reviewer_ids','due_days','reminder_days','escalation_days']);
      if(!Object.hasOwn(AUDIENCES,s.audience))fail(400,'audience','حدد جمهور المرحلة: داخلية أو قرار عميل');
      return {position:integer(Number(s.position),'ترتيب المرحلة',1,20),name:v.text(s.name,'اسم المرحلة',120,2),audience:s.audience,
        reviewer_ids:Array.isArray(s.reviewer_ids)?[...new Set(s.reviewer_ids)]:[],
        due_days:optionalDays(s.due_days,'مهلة المرحلة بأيام العمل'),reminder_days:optionalDays(s.reminder_days,'التذكير قبل الموعد بأيام'),escalation_days:optionalDays(s.escalation_days,'التصعيد بعد أيام')};
    });
  }
  const seen=new Set();
  for(const stage of list){
    const key=`${stage.position}·${stage.name}`;
    if(seen.has(key))fail(400,'stages','اسم المرحلة مكرر في الترتيب نفسه');
    seen.add(key);
    if(stage.reminder_days!==null&&(stage.due_days===null||stage.reminder_days>=stage.due_days))fail(400,'reminder_days','التذكير يسبق الموعد، ولا تذكير بلا موعد');
    if(!stage.reviewer_ids.length||stage.reviewer_ids.length>10)fail(400,'reviewer_ids','لكل مرحلة مراجع واحد على الأقل وعشرة على الأكثر');
    for(const reviewerId of stage.reviewer_ids){
      if(typeof reviewerId!=='string'||!db.prepare('SELECT 1 FROM project_members m JOIN users us ON us.id=m.user_id WHERE m.project_id=? AND m.user_id=? AND us.active=1 AND us.tenant_id=?').get(version.project_id,reviewerId,u.tenant_id))fail(400,'reviewer_ids','المراجع يجب أن يكون عضوًا نشطًا في المشروع');
      if(reviewerId===version.created_by||reviewerId===u.id)fail(403,'separation_of_duties','معدّ النسخة وفاتح المسار لا يراجعان العمل نفسه');
    }
  }
  return {list,templateId};
}

export function reviewAction(db,supplied,routeId,action,input){
  writing(db);const u=actor(db,supplied);permitted(db,u);
  if(!Object.hasOwn(ROUTE_ACTIONS,action))fail(400,'unknown_action','إجراء المراجعة غير معروف');
  v.object(input,['version',...ROUTE_ACTIONS[action]]);
  const route=routeRow(db,u,routeId);v.version(input.version,route.version);
  const view=getRoute(db,u,route.id);
  const stageAction=action==='decide'&&view.stages.some(s=>s.id===input.stage_id&&s.actions.includes('decide'));
  if(!stageAction&&!view.actions.includes(action))fail(403,'action_unavailable','الإجراء غير متاح لحالة المسار أو لدورك فيه');
  const time=now();let detail={};
  if(action==='add_media')detail=addMedia(db,u,route,input,time);
  else if(action==='annotate')detail=addAnnotation(db,u,route,input,time);
  else if(action==='decide')detail=decideStage(db,u,route,input,time);
  else if(action==='save_template')detail=saveTemplate(db,u,route,input,time);
  else if(action==='cancel'){closeRoute(db,route,'cancelled',time);detail={status:'cancelled',reason:v.text(input.reason,'سبب الإلغاء',2000,3)};}
  else if(action==='notify')detail=sweep(db,u,route,time);
  if(!['decide','cancel'].includes(action))db.prepare('UPDATE review_routes SET version=version+1,updated_at=? WHERE id=? AND version=?').run(time,route.id,route.version);
  audit(db,u,'review_route',route.id,'review.'+action,{version:route.version,status:route.status},{version:route.version+1,...detail},input.note??input.reason??'');
  return getRoute(db,u,route.id);
}

function addMedia(db,u,route,input,time){
  if(!Object.hasOwn(MEDIA_KINDS,input.kind))fail(400,'kind','حدد نوع المادة');
  const label=v.text(input.label,'وصف المادة',180,3);
  if(input.kind==='text'){
    const body=v.text(input.body,'النص الخاضع للمراجعة',20000,3),digest=hash(body),mediaId=id();
    if(db.prepare('SELECT 1 FROM review_media WHERE route_id=? AND digest=?').get(route.id,digest))fail(409,'duplicate_media','هذه المادة مضافة في المسار نفسه');
    db.prepare("INSERT INTO review_media(id,tenant_id,route_id,kind,label,filename,media_type,size,digest,body,uploaded_by,created_at) VALUES(?,?,?,'text',?,'','text/plain',?,?,?,?,?)")
      .run(mediaId,route.tenant_id,route.id,label,Buffer.byteLength(body),digest,body,u.id,time);
    return {media_id:mediaId,kind:'text',digest};
  }
  const file=input.content;
  if(!file||typeof file!=='object'||typeof file.content!=='string')fail(400,'content','أرفق ملف المادة');
  if(file.content.length>2800000||!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(file.content))fail(400,'content','ترميز الملف غير صالح');
  const data=Buffer.from(file.content,'base64');
  if(data.length<1||data.length>2097152)fail(413,'file_size','الحد الأقصى للمادة 2 ميغابايت');
  const mediaType=SIGNATURES.find(([,matches])=>matches(data))?.[0];
  if(!mediaType||!KIND_TYPES[input.kind].includes(mediaType))fail(400,'file_type','نوع الملف لا يطابق نوع المادة المعلن. المسموح: PNG وJPEG وPDF وMP4 وMP3 بتوقيع محتوى مطابق');
  const filename=v.text(file.filename??input.filename??'material','اسم الملف',120);
  if([...filename].some(ch=>ch.charCodeAt(0)<32||ch.charCodeAt(0)===127||ch==='/'||ch==='\\')||filename.includes('..'))fail(400,'filename','اسم الملف غير صالح');
  // عدد الصفحات والمدة من يد الرافع: المنصة لا تستخرجهما من الملف ولا تفترض قيمة.
  const pages=input.kind==='pdf'?integer(Number(input.pages),'عدد صفحات الملف',1,2000):null;
  const duration=['video','audio'].includes(input.kind)&&input.duration_seconds!==undefined&&input.duration_seconds!==''&&input.duration_seconds!==null
    ?integer(Number(input.duration_seconds),'مدة المادة بالثواني',1,86400):null;
  const digest=hash(data),mediaId=id();
  if(db.prepare('SELECT 1 FROM review_media WHERE route_id=? AND digest=?').get(route.id,digest))fail(409,'duplicate_media','هذه المادة مضافة في المسار نفسه');
  db.prepare('INSERT INTO review_media(id,tenant_id,route_id,kind,label,filename,media_type,size,digest,content,pages,duration_seconds,uploaded_by,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
    .run(mediaId,route.tenant_id,route.id,input.kind,label,filename,mediaType,data.length,digest,data,pages,duration,u.id,time);
  return {media_id:mediaId,kind:input.kind,media_type:mediaType,size:data.length,digest};
}

function addAnnotation(db,u,route,input,time){
  const media=mediaRow(db,u,input.media_id);
  if(media.route_id!==route.id)fail(404,'not_found','المادة ليست في هذا المسار');
  if(!['internal','shared'].includes(input.visibility))fail(400,'visibility','حدد: تعليق داخلي أم مشترك يجوز عرضه على العميل');
  const anchor=ANCHOR_FOR[media.kind];
  if(input.anchor!==undefined&&input.anchor!==anchor)fail(400,'anchor','نوع الموضع لا يناسب نوع المادة');
  const body=v.text(input.body,'نص التعليق',3000,3);
  const values={page:null,x:null,y:null,at_seconds:null,char_start:null,char_end:null};
  if(media.kind!=='pdf'&&input.page!==undefined&&input.page!==''&&input.page!==null)fail(400,'invalid_number','رقم الصفحة لا ينطبق إلا على ملفات PDF');
  if(anchor==='point'){
    values.x=ratio(input.x,'الموضع الأفقي');values.y=ratio(input.y,'الموضع الرأسي');
    if(media.kind==='pdf')values.page=integer(Number(input.page),'رقم الصفحة',1,media.pages);
  } else if(anchor==='timestamp'){
    const seconds=Number(input.at_seconds);
    if(!Number.isFinite(seconds)||seconds<0||(media.duration_seconds!==null&&seconds>media.duration_seconds))fail(400,'at_seconds','الطابع الزمني خارج مدة المادة');
    values.at_seconds=seconds;
  } else {
    values.char_start=integer(Number(input.char_start),'بداية المدى',0,media.body.length);
    values.char_end=integer(Number(input.char_end),'نهاية المدى',1,media.body.length);
    if(values.char_end<=values.char_start)fail(400,'char_range','نهاية المدى تسبق بدايته');
  }
  let stageId=null;
  if(input.stage_id){
    stageId=db.prepare('SELECT id FROM review_stages WHERE id=? AND route_id=?').get(input.stage_id,route.id)?.id;
    if(!stageId)fail(404,'not_found','المرحلة غير متاحة');
  }
  const annotationId=id();
  db.prepare("INSERT INTO review_annotations(id,tenant_id,media_id,stage_id,anchor,page,x,y,at_seconds,char_start,char_end,visibility,body,status,created_by,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,'open',?,?)")
    .run(annotationId,route.tenant_id,media.id,stageId,anchor,values.page,values.x,values.y,values.at_seconds,values.char_start,values.char_end,input.visibility,body,u.id,time);
  return {annotation_id:annotationId,media_id:media.id,anchor,visibility:input.visibility};
}

function decideStage(db,u,route,input,time){
  const stage=db.prepare('SELECT * FROM review_stages WHERE id=? AND route_id=?').get(input.stage_id,route.id);
  if(!stage||stage.status!=='open')fail(409,'stage_closed','لا توجد مرحلة مفتوحة بهذا المعرف');
  if(!Object.hasOwn(DECISIONS,input.decision))fail(400,'decision','اختر أحد القرارات الثلاثة');
  const note=v.text(input.note,'سبب القرار وملاحظاته',3000,3);
  let externalId=null;
  if(stage.audience==='client'){
    // لا رابط ولا حساب للعميل: قرار مرحلة العميل يُنسخ من سجل موافقة خارجية موثقة على النسخة نفسها.
    const record=typeof input.external_approval_id==='string'&&db.prepare('SELECT * FROM external_approvals WHERE id=? AND tenant_id=? AND output_version_id=?').get(input.external_approval_id,route.tenant_id,route.output_version_id);
    if(!record)fail(409,'client_evidence_required','مرحلة العميل تحتاج سجل موافقة خارجية موثقًا على النسخة نفسها في شاشة موافقات العملاء');
    if(!['documented','verified'].includes(record.status))fail(409,'client_evidence_required','سجل موافقة العميل لم يكتمل دليله بعد');
    if(CLIENT_DECISION_MAP[record.decision]!==input.decision)fail(409,'client_decision_mismatch',`قرار المرحلة يجب أن يطابق ما وثّقه السجل: ${DECISIONS[CLIENT_DECISION_MAP[record.decision]]}`);
    externalId=record.id;
  } else if(input.external_approval_id)fail(400,'external_approval_id','المرحلة الداخلية لا تحمل مرجع موافقة عميل');
  const decisionId=id();
  db.prepare('INSERT INTO review_decisions(id,stage_id,route_id,output_version_id,decision,note,external_approval_id,decided_by,decided_at) VALUES(?,?,?,?,?,?,?,?,?)')
    .run(decisionId,stage.id,route.id,route.output_version_id,input.decision,note,externalId,u.id,time);
  db.prepare("UPDATE review_stages SET status='decided',version=version+1 WHERE id=? AND version=?").run(stage.id,stage.version);
  const holidays=holidaySet(db,route.tenant_id);
  let outcome={stage_id:stage.id,decision_id:decisionId,decision:input.decision};
  if(input.decision==='changes_required'){closeRoute(db,route,'changes_required',time);outcome.route_status='changes_required';}
  else if(db.prepare("SELECT COUNT(*) AS n FROM review_stages WHERE route_id=? AND position=? AND status NOT IN ('decided','cancelled')").get(route.id,stage.position).n===0){
    const next=openNextPosition(db,route,stage.position,time,holidays);
    if(next===null){
      const all=db.prepare('SELECT decision FROM review_decisions WHERE route_id=?').all(route.id).map(r=>r.decision);
      const status=all.every(d=>d==='approved')?'approved':'approved_with_changes';
      closeRoute(db,route,status,time);outcome.route_status=status;
    } else outcome.opened_position=next;
  }
  if(!outcome.route_status)db.prepare('UPDATE review_routes SET version=version+1,updated_at=? WHERE id=? AND version=?').run(time,route.id,route.version);
  return outcome;
}

function saveTemplate(db,u,route,input,time){
  const name=v.text(input.name,'اسم القالب',180,3);
  if(db.prepare('SELECT 1 FROM review_route_templates WHERE tenant_id=? AND name=?').get(u.tenant_id,name))fail(409,'duplicate_template','يوجد قالب بهذا الاسم');
  const templateId=id();
  db.prepare('INSERT INTO review_route_templates(id,tenant_id,name,description,created_by,created_at) VALUES(?,?,?,?,?,?)')
    .run(templateId,u.tenant_id,name,input.description?v.text(input.description,'وصف القالب',2000,3):'',u.id,time);
  for(const stage of db.prepare('SELECT * FROM review_stages WHERE route_id=? ORDER BY position,name').all(route.id)){
    const reviewers=db.prepare('SELECT reviewer_id FROM review_stage_reviewers WHERE stage_id=? ORDER BY reviewer_id').all(stage.id).map(r=>r.reviewer_id);
    db.prepare('INSERT INTO review_template_stages(id,template_id,position,name,audience,reviewer_ids,due_days,reminder_days,escalation_days) VALUES(?,?,?,?,?,?,?,?,?)')
      .run(id(),templateId,stage.position,stage.name,stage.audience,JSON.stringify(reviewers),stage.due_days,stage.reminder_days,stage.escalation_days);
  }
  return {template_id:templateId,name};
}

// التذكير والتصعيد: تُستخرج من الحالة الحالية عند الطلب، بلا مجدول وبلا بريد. مكررة الاستدعاء بلا أثر مضاعف.
function sweep(db,u,route,time){
  const day=today(),holidays=holidaySet(db,route.tenant_id);let reminders=0,escalations=0;
  for(const stage of db.prepare("SELECT * FROM review_stages WHERE route_id=? AND status='open'").all(route.id)){
    if(stage.due_on&&stage.reminder_days!==null&&day>=addWorkingDays(stage.opened_on,stage.due_days-stage.reminder_days,holidays))
      for(const r of db.prepare('SELECT reviewer_id FROM review_stage_reviewers WHERE stage_id=?').all(stage.id))
        reminders+=db.prepare('INSERT OR IGNORE INTO review_notices(id,tenant_id,route_id,stage_id,user_id,kind,due_on,created_at) VALUES(?,?,?,?,?,?,?,?)').run(id(),route.tenant_id,route.id,stage.id,r.reviewer_id,'review_due_reminder',stage.due_on,time).changes;
    if(stage.escalation_days!==null&&day>=addWorkingDays(stage.opened_on,stage.escalation_days,holidays))
      escalations+=db.prepare('INSERT OR IGNORE INTO review_notices(id,tenant_id,route_id,stage_id,user_id,kind,due_on,created_at) VALUES(?,?,?,?,?,?,?,?)').run(id(),route.tenant_id,route.id,stage.id,route.owner_id,'review_stage_escalated',stage.due_on,time).changes;
  }
  return {reminders,escalations,delivery:'in_platform_only'};
}

export function annotationAction(db,supplied,annotationId,action,input){
  writing(db);const u=actor(db,supplied);permitted(db,u);
  const fields={address:['note'],wont_fix:['reason']}[action];
  if(!fields)fail(404,'not_found','الإجراء غير متاح');
  v.object(input,['version',...fields]);
  const row=typeof annotationId==='string'&&db.prepare('SELECT * FROM review_annotations WHERE id=? AND tenant_id=?').get(annotationId,u.tenant_id);
  if(!row)fail(404,'not_found','التعليق غير متاح');
  const media=mediaRow(db,u,row.media_id),route=routeRow(db,u,media.route_id);
  v.version(input.version,row.version);
  if(!annotationView(db,u,route,row).actions.includes(action))fail(409,'action_unavailable','الإجراء غير متاح لحالة التعليق أو لدورك فيه');
  const note=action==='address'?v.text(input.note,'ما الذي عولج وكيف',2000,3):v.text(input.reason,'سبب عدم المعالجة',2000,3);
  const status=action==='address'?'addressed':'wont_fix',time=now();
  db.prepare('UPDATE review_annotations SET status=?,resolution_note=?,resolved_by=?,resolved_at=?,version=version+1 WHERE id=? AND version=?').run(status,note,u.id,time,row.id,row.version);
  audit(db,u,'review_annotation',row.id,'review.annotation_'+action,{status:row.status,version:row.version},{status,version:row.version+1},note);
  return getRoute(db,u,route.id);
}

// حزمة العميل: ما يجوز أن يخرج من المنصة. الفصل مفروض في الاستعلام نفسه لا في الواجهة.
// وهي ما يصل العميل فعلًا من يد الموظف (لا بوابة للعميل)، فكل تحضير لها حدثُ تدقيق واحد يحمل بصمة sha256 للحمولة
// بنصّها المرسَل بالضبط (JSON.stringify نفسه الذي يرسل به الخادم)، فيُثبت لاحقًا ما خرج ومتى وبيد من.
// يُستدعى داخل معاملة الكتابة في الخادم، فتدقيقٌ يتعذر يُسقط الطلب كله ولا تخرج الحزمة.
export function clientPack(db,supplied,routeId){
  const u=actor(db,supplied);permitted(db,u);
  const route=routeRow(db,u,routeId);
  const media=db.prepare('SELECT * FROM review_media WHERE route_id=? ORDER BY created_at,id').all(route.id).map(m=>mediaView(db,u,route,m,true));
  const clientStages=db.prepare("SELECT s.*,d.decision,d.note,d.external_approval_id FROM review_stages s LEFT JOIN review_decisions d ON d.stage_id=s.id WHERE s.route_id=? AND s.audience='client' ORDER BY s.position,s.name").all(route.id);
  const pack={route_id:route.id,route_name:route.name,output_revision:route.output_revision,output_digest:route.output_digest,
    media:media.map(m=>({...m,body:m.kind==='text'?m.body:null})),
    shared_annotations:media.flatMap(m=>m.annotations.map(a=>({id:a.id,media_label:m.label,place:a.place,body:a.body,status:a.status,status_name:a.status_name}))),
    client_stages:clientStages.map(s=>({name:s.name,status_name:STAGE_STATUS[s.status],decision_name:s.decision?DECISIONS[s.decision]:null,documented_approval_id:s.external_approval_id})),
    disclaimer:'هذه الحزمة تحتوي التعليقات المشتركة فقط؛ التعليقات الداخلية لا تخرج منها إطلاقًا. لا يدخل العميل المنصة ولا يوجد رابط مراجعة خارجي؛ قراره يُوثّق داخليًا كما في سجل موافقات العملاء.'};
  audit(db,u,'review_route',route.id,'review.client_pack_prepared',{},{digest:hash(JSON.stringify(pack)),output_revision:route.output_revision,
    media:pack.media.length,shared_annotations:pack.shared_annotations.length,client_stages:pack.client_stages.length});
  return pack;
}

// المعاينة الداخلية: بايتات المادة لمن يرى مسارها فقط. لا رابط عام ولا مورد خارجي.
// وهي المادة التي تُعرض على العميل، فكل قراءة حدثُ تدقيق باسم القارئ وبصمة ما قُرئ. الخادم يلفّ القراءة والتدقيق في معاملة
// واحدة، والتدقيق قبل أن تعود البايتات: تدقيقٌ يتعذر لا يخرج بعده بايت، والقراءة المرفوضة ترمي قبله فلا تكتب شيئًا.
export function previewMedia(db,supplied,mediaId){
  const u=actor(db,supplied);permitted(db,u);
  const media=mediaRow(db,u,mediaId);
  if(media.kind==='text')fail(409,'text_media','المادة النصية تُعرض في الصفحة نفسها لا كملف');
  if(hash(Buffer.from(media.content))!==media.digest)fail(409,'media_corrupted','بصمة المادة لا تطابق محتواها');
  audit(db,u,'review_media',media.id,'review.media_viewed',{},{route_id:media.route_id,digest:media.digest,media_type:media.media_type,size:media.size});
  return {filename:media.filename,media_type:media.media_type,content:Buffer.from(media.content)};
}

export function markReviewNotice(db,supplied,noticeId){
  writing(db);const u=actor(db,supplied);
  const row=typeof noticeId==='string'&&db.prepare('SELECT * FROM review_notices WHERE id=? AND tenant_id=? AND user_id=?').get(noticeId,u.tenant_id,u.id);
  if(!row)fail(404,'not_found','الإشعار غير متاح');
  db.prepare('UPDATE review_notices SET read_at=? WHERE id=?').run(now(),row.id);
  return {read:true};
}
