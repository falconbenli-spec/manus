import { randomUUID } from 'node:crypto';
import { audit, hash, now, transaction } from './db.mjs';
import { can, capabilitiesFor, defaultCapabilities, capabilityGap } from './access.mjs';
import { refuse, actorOrRefuse } from './refusal.mjs';
import { ROLE_NAMES_AR } from './static/vocabulary.mjs';

// «جرّب كمستخدم» (ترحيل 123، الجدول view_as_events): خفضُ تصاريح بهوية صاحبها، لا انتحال زميل.
//
// لماذا لا يُنتحل زميل حقيقي: الدخول في حساب غيرك يفتح قسائم راتبه وحالاته السرية وملفات عملاء ليسوا عملاءك — وهذه المنصة
// تقول إن امتياز الأدمن الأول نفسه لا يفتح البيانات الشخصية — ويزوّر اسم الفاعل في صفوف التدقيق التي تكتبها طلبات القراءة
// (تنزيل مرفق، تصدير). فالمجرِّب يبقى **هو**: فريقه ومشاريعه وقسيمته تبقى، وتُحسب تصاريحه «افتراضات الدور المختار ∩ ما يحمله
// هو»، وتسقط منحه كلها، ويصير دوره دور الشخصية ومستواه الإداري فارغًا. فالناتج دائمًا جزء مما يراه أصلًا، لا أكثر.
//
// ولا اعتماد ولا دفع ولا تنفيذ ولا تغيير تصريح **بالبناء**: كل طلب غير GET/HEAD يُرفض عند نقطة المصادقة قبل أن يبلغ أي معالج،
// إلا إنهاء التجربة والخروج. ليست قائمة أفعال ممنوعة تُنسى منها واحدة.
//
// الحدّ الصادق: وحدات كثيرة تقرأ صف الحساب بـSQL خاص وتفحص u.role مباشرة؛ هناك يبقى المعروض أوسع مما يراه موظف حقيقي.
// اتجاه الخطأ آمن (لا أكثر مما يراه صاحب الحساب، ولا كتابة أبدًا)، والشريط الأحمر يقول ذلك.
export const PERSONAS=Object.freeze(['employee','manager','pm','hr']);
export const TTL_MINUTES=30;
const MAX_RUNS=24;
const personaName=persona=>persona==='employee'?'موظف عادي':ROLE_NAMES_AR[persona]??persona;
// بصمة التشغيل لا بصمة الجلسة: الفهرس الفريد (session_ref,detail) يحفظ صفًّا واحدًا لكل عائلة مسارات، فلو اشتُقّت البصمة من
// الجلسة وحدها لابتلع التشغيلُ الأول شاشاتِ الثاني. الرتبة (1، 2، …) داخل جلسة الدخول تُبقي البحث مفهرسًا بلا عمود جديد.
const refOf=(tokenHash,ordinal)=>hash(`view-as:${tokenHash}:${ordinal}`);
const fresh=startedAt=>Date.now()-Date.parse(startedAt)<TTL_MINUTES*60000;
const expiresAt=startedAt=>new Date(Date.parse(startedAt)+TTL_MINUTES*60000).toISOString();

// آخر تشغيل في جلسة الدخول هذه، والرتبة التالية. كل خطوة بحث مفهرس واحد؛ من لم يجرّب قط يكلفه ذلك استعلامًا واحدًا.
function locate(db,session){
  for(let ordinal=1;ordinal<=MAX_RUNS;ordinal++){
    const ref=refOf(session.token_hash,ordinal);
    const last=db.prepare("SELECT event,persona,reason,at FROM view_as_events WHERE session_ref=? AND event<>'screen' ORDER BY seq DESC LIMIT 1").get(ref);
    if(!last)return {open:null,next:ordinal};
    if(last.event==='started')return {open:{ref,persona:last.persona,reason:last.reason,started_at:last.at},next:ordinal+1};
  }
  return {open:null,next:null};
}
function record(db,run,actor,event,{detail='',reason=''}={}){
  db.prepare(`INSERT ${event==='screen'?'OR IGNORE ':''}INTO view_as_events(id,tenant_id,actor_id,session_ref,event,persona,detail,reason,at) VALUES(?,?,?,?,?,?,?,?,?)`)
    .run(randomUUID(),actor.tenant_id,actor.id,run.ref,event,run.persona,detail,reason,now());
}
// التصاريح السارية أثناء التجربة: ما يحمله الدور المختار افتراضيًا **و**يحمله صاحب الحساب نفسه. تُحسب قبل أن يُملأ سياق الطلب،
// فتقرأ capabilitiesFor الحساب الحقيقي.
export function effective(db,user,persona){
  const own=new Set(capabilitiesFor(db,user).list);
  return [...defaultCapabilities({role:persona})].filter(key=>own.has(key)).sort();
}
// التشغيل الجاري لهذه الجلسة، أو null. تشغيلٌ مضت مدته يُختم «expired» هنا عند أول طلب بعده، ويدخل سلسلة التدقيق.
export function active(db,session,user){
  const {open}=locate(db,session);
  if(!open)return null;
  if(!fresh(open.started_at)){
    const close=()=>{record(db,open,user,'expired');audit(db,user,'view_as',open.ref.slice(0,16),'view_as.expired',{persona:open.persona},{minutes:TTL_MINUTES});};
    if(db.isTransaction)close();else transaction(db,close);
    return null;
  }
  return {actor_id:user.id,tenant_id:user.tenant_id,ref:open.ref,persona:open.persona,persona_name:personaName(open.persona),reason:open.reason,
    started_at:open.started_at,expires_at:expiresAt(open.started_at),capabilities:effective(db,user,open.persona)};
}
// صف الحساب كما تراه الوحدات أثناء التجربة: الهوية هي هي، والدور دور الشخصية، ولا مستوى إداري.
export const personaRow=(user,run)=>run&&user&&user.id===run.actor_id?{...user,role:run.persona,admin_level:null}:user;

export function refuseWrite(run,method,path){
  refuse(403,'view_as_read_only',{what:`لا يُنفَّذ إجراء أثناء «جرّب كمستخدم» (${run.persona_name}): رُفض ${method} ${path}`,
    missing:[{document:'إنهاء التجربة',why:'التجربة قراءة فقط: لا اعتماد ولا دفع ولا تنفيذ ولا إكمال ولا تغيير تصريح، يرفضها الخادم لا الواجهة',owner:'أنت — من الشريط الأحمر أعلى الصفحة',owner_role:null}],
    next:'اضغط «إنهاء التجربة» في الشريط الأحمر، ثم نفّذ الإجراء بحسابك وتصاريحك'});
}
// صف واحد لكل عائلة مسارات في التشغيل («/api/pricing»)، لا صف لكل طلب.
export function noteScreen(db,run,actor,path){
  const family=String(path).split('/').slice(0,3).join('/');
  if(!/^\/api\/[a-z0-9-]{1,60}$/.test(family))return;
  record(db,run,actor,'screen',{detail:family});
}

export function start(db,supplied,session,input){
  if(!db.isTransaction)throw new TypeError('view-as.start: تتطلب معاملة قاعدة بيانات');
  const u=actorOrRefuse(db,supplied);
  if(!can(db,u,'access.view_as')){
    const gap=capabilityGap(db,u.tenant_id,'access.view_as');
    refuse(403,'not_permitted',{what:'«جرّب كمستخدم» لا يُفتح بحسابك',
      missing:[{document:`تصريح «${gap.capability_name}» (access.view_as)`,why:gap.text,owner:'الأدمن الأول في «الموظفون والصلاحيات»',owner_role:'admin'}],
      next:'اطلب التصريح الحساس بمنح صريح مسجَّل، ثم أعد المحاولة'});
  }
  const keys=input&&typeof input==='object'&&!Array.isArray(input)?Object.keys(input):null;
  if(!keys||keys.some(key=>!['persona','reason'].includes(key)))refuse(400,'invalid_fields',{what:'حقول بدء التجربة غير صالحة',next:'أرسل الدور المختار (persona) وسبب التجربة (reason) وحدهما'});
  if(!PERSONAS.includes(input.persona))refuse(400,'persona',{what:'الدور المختار للتجربة غير معروف',next:`اختر أحد الأدوار: ${PERSONAS.map(personaName).join('، ')}`});
  const reason=typeof input.reason==='string'?input.reason.trim():'';
  if([...reason].length<10||[...reason].length>500)refuse(400,'reason_required',{what:'التجربة يلزمها سبب مكتوب يُحفظ في سجلها',next:'اكتب لماذا تجرّب المنصة بهذا الدور، في عشرة أحرف إلى خمسمئة'});
  const {open,next}=locate(db,session);
  if(open&&fresh(open.started_at))refuse(409,'view_as_running',{what:`تجربة جارية بدور «${personaName(open.persona)}» في هذه الجلسة`,next:'أنهِ التجربة الجارية من الشريط الأحمر قبل بدء أخرى'});
  if(open)record(db,open,u,'expired');
  if(next===null||next>MAX_RUNS)refuse(409,'view_as_limit',{what:`بلغت هذه الجلسة حد ${MAX_RUNS} تجربة`,next:'سجّل الخروج ثم الدخول من جديد لتبدأ تجربة أخرى'});
  const run={ref:refOf(session.token_hash,next),persona:input.persona};
  record(db,run,u,'started',{reason});
  audit(db,u,'view_as',run.ref.slice(0,16),'view_as.started',{},{persona:run.persona,capabilities:effective(db,u,run.persona),minutes:TTL_MINUTES},reason);
  return {persona:run.persona,persona_name:personaName(run.persona),started:true,expires_in_minutes:TTL_MINUTES};
}
export function stop(db,supplied,session){
  if(!db.isTransaction)throw new TypeError('view-as.stop: تتطلب معاملة قاعدة بيانات');
  const u=actorOrRefuse(db,supplied),{open}=locate(db,session);
  if(!open)refuse(409,'view_as_not_running',{what:'لا تجربة جارية في هذه الجلسة',next:'لا شيء يُنهى. أعد تحميل الصفحة لتعود إلى حسابك'});
  const screens=db.prepare("SELECT detail FROM view_as_events WHERE session_ref=? AND event='screen' ORDER BY seq").all(open.ref).map(r=>r.detail);
  record(db,open,u,fresh(open.started_at)?'ended':'expired');
  audit(db,u,'view_as',open.ref.slice(0,16),'view_as.ended',{persona:open.persona},{screens,started_at:open.started_at});
  return {stopped:true,persona:open.persona,screens};
}
// سجل التجارب: صاحب التصريح يقرأ تجاربه، ومن يدير الحسابات يقرأ تجارب الجميع. يُجمع كل تشغيل من صفوفه: بدؤه وسببه وما فُتح فيه ونهايته.
const LOG_RUNS=60;
export function log(db,supplied){
  const u=actorOrRefuse(db,supplied),all=can(db,u,'accounts.manage');
  if(!all&&!can(db,u,'access.view_as'))return null;
  // التشغيلات تُختار أولًا ثم تُقرأ صفوفها. نافذةٌ على الأحداث («آخر 600 حدث») كانت تُسقط التشغيل كله حين تخرج منه صفّ
  // بدئه، فيختفي من الشاشة تشغيلٌ قائم في الجدول وفي سلسلة التدقيق — والشاشة تقول «تعرض هذه القائمة تجارب الجميع».
  // تشغيلٌ واحد يفتح مئة شاشة كان يكفي لابتلاع ما قبله. الآن العدد عدد تشغيلات لا عدد أحداث، فالحدّ يُقرأ كما هو مكتوب.
  const refs=db.prepare(`SELECT session_ref FROM view_as_events WHERE tenant_id=? AND (?=1 OR actor_id=?) AND event='started' ORDER BY seq DESC LIMIT ?`).all(u.tenant_id,all?1:0,u.id,LOG_RUNS).map(r=>r.session_ref);
  if(!refs.length)return {scope:all?'all':'mine',ttl_minutes:TTL_MINUTES,personas:PERSONAS.map(key=>({key,name:personaName(key)})),can_start:can(db,u,'access.view_as'),runs:[]};
  const rows=db.prepare(`SELECT e.*,x.name AS actor_name FROM view_as_events e JOIN users x ON x.id=e.actor_id WHERE e.tenant_id=? AND e.session_ref IN (${refs.map(()=>'?').join(',')}) ORDER BY e.seq DESC`).all(u.tenant_id,...refs);
  const runs=new Map();
  for(const r of rows.reverse()){
    const run=runs.get(r.session_ref)??{id:r.session_ref.slice(0,16),actor_name:r.actor_name,persona:r.persona,persona_name:personaName(r.persona),reason:'',started_at:null,ended_at:null,end_name:'جارية',screens:[]};
    if(r.event==='started'){run.started_at=r.at;run.reason=r.reason;}
    else if(r.event==='screen')run.screens.push(r.detail);
    else{run.ended_at=r.at;run.end_name=r.event==='ended'?'أنهاها صاحبها':`انتهت مدتها (${TTL_MINUTES} دقيقة)`;}
    runs.set(r.session_ref,run);
  }
  return {scope:all?'all':'mine',ttl_minutes:TTL_MINUTES,personas:PERSONAS.map(key=>({key,name:personaName(key)})),can_start:can(db,u,'access.view_as'),
    limit:LOG_RUNS,runs:[...runs.values()].filter(run=>run.started_at).reverse()};
}
