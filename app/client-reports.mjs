import { randomUUID } from 'node:crypto';
import { audit, now, hash } from './db.mjs';
import { fail } from './auth.mjs';
import * as v from './validation.mjs';
import { can } from './access.mjs';
import { currentUser } from './delegations.mjs';
import { clientFor, memberClients } from './agency.mjs';
import { CHANNELS } from './campaigns.mjs';
import { EVIDENCE_KINDS } from './media-spend.mjs';
import { liveSpend, planInForce } from './media-spend-ledger.mjs';
import { influencerDelivery, prCoverage, toneCounts } from './reports-specialist.mjs';
import { dual } from './dates.mjs';
import { documentFooter, SYNTHETIC } from './tenant-identity.mjs';
import { versionLabel } from './approved-version.mjs';

// تقرير العميل الدوري. يُولَّد من بيانات المنصة وحدها، ولكل رقم مصدره وتاريخه؛ رقم بلا مصدر يوقف التوليد.
// لا تعليق آلي على الأداء ولا نص يولده نموذج لغوي: التعليق والخطوة التالية يكتبهما مسؤول الحساب ويوقّع باسمه.
// لا بوابة عميل ولا إرسال: التقرير يُطبع أو يُحفظ PDF ويرسله مسؤول الحساب بنفسه من خارج المنصة.
// تسليم المؤثرين والتغطية الإعلامية (الحزمة 4، DOMAIN-4) يُقرآن بقراءتي R43 وR44 نفسيهما، فرقم العميل هو رقم التقرير الداخلي.
export const SECTIONS=[['campaign_results','نتائج الحملات'],['content_published','المحتوى المنشور'],['media_spend','الصرف الإعلامي'],['influencer_delivery','تسليم المؤثرين'],['pr_coverage','التغطية الإعلامية'],['contract_progress','ما أُنجز من العقد'],['next_step','الخطوة التالية']].map(([key,name])=>({key,name}));
export const CADENCES={weekly:'أسبوعي',monthly:'شهري',quarterly:'ربع سنوي',campaign_end:'عند نهاية حملة'};
export const REPORT_STATES={draft:'مسودة — لم يوقّعها مسؤول الحساب',signed:'موقّع',superseded:'حلّ محله تقرير مصحَّح',discarded:'مهمل'};
export const NO_SENDING='لا بوابة عميل ولا إرسال من المنصة: لا مزوّد بريد ولا رابط للعميل. اطبع التقرير أو احفظه PDF وأرسله بنفسك.';
const id=()=>randomUUID();
const today=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Riyadh',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const riyadhDate=iso=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Riyadh',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(iso));
const name=(db,userId)=>userId?db.prepare('SELECT name FROM users WHERE id=?').get(userId)?.name??null:null;
const channelName=key=>CHANNELS.find(c=>c.key===key)?.name??key;
function writing(db){if(!db.isTransaction)fail(500,'transaction_required','تتطلب كتابة تقارير العملاء معاملة قاعدة بيانات');}
function team(db,supplied,clientId,options){
  const {u,c}=clientFor(db,supplied,clientId,options);
  if(!can(db,u,'commercial.use',u.department_id))fail(403,'not_permitted','تقارير العملاء تحتاج تصريح «المبيعات والتسليم». اطلبه من مسؤول الصلاحيات');
  return {u,c};
}
function reportRow(db,supplied,reportId,options){
  const r=typeof reportId==='string'&&db.prepare('SELECT * FROM client_reports WHERE id=?').get(reportId);
  if(!r)fail(404,'not_found','التقرير غير متاح');
  // العزل: التقرير يُقرأ عبر عضوية فريق حساب عميله فقط. من ليس في الفريق يرى «غير متاح» ولو حمل التصريح.
  const {u,c}=team(db,supplied,r.client_id,options);if(r.tenant_id!==u.tenant_id)fail(404,'not_found','التقرير غير متاح');
  return {u,c,r};
}

/* ───── القوالب ───── */
function cleanSections(sections){
  if(!Array.isArray(sections)||!sections.length||sections.length>SECTIONS.length||new Set(sections).size!==sections.length)fail(400,'sections','اختر قسمًا واحدًا على الأقل دون تكرار');
  for(const s of sections)if(!SECTIONS.some(x=>x.key===s))fail(400,'sections','قسم غير معروف');
  return sections;
}
export function createTemplate(db,supplied,input){
  writing(db);v.object(input,['client_id','name','cadence','sections']);
  const {u,c}=team(db,supplied,input.client_id,{owner:true});
  if(!Object.hasOwn(CADENCES,input.cadence))fail(400,'cadence','اختر دورية التقرير');
  const label=v.text(input.name,'اسم القالب',160,3);
  if(db.prepare('SELECT 1 FROM client_report_templates WHERE client_id=? AND name=?').get(c.id,label))fail(409,'duplicate_template','لهذا العميل قالب بالاسم نفسه');
  const templateId=id(),time=now();
  db.prepare('INSERT INTO client_report_templates(id,tenant_id,client_id,name,cadence,sections,created_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)').run(templateId,u.tenant_id,c.id,label,input.cadence,JSON.stringify(cleanSections(input.sections)),u.id,time,time);
  audit(db,u,'client_report_template',templateId,'client_template.created',{}, {client:c.code,sections:input.sections});
  return {id:templateId};
}
export function templateAction(db,supplied,templateId,action,input){
  writing(db);
  const t=typeof templateId==='string'&&db.prepare('SELECT * FROM client_report_templates WHERE id=?').get(templateId);
  if(!t)fail(404,'not_found','القالب غير متاح');
  const {u}=team(db,supplied,t.client_id,{owner:true});if(t.tenant_id!==u.tenant_id)fail(404,'not_found','القالب غير متاح');
  if(action==='edit_template'){
    v.object(input,['version','name','cadence','sections']);v.version(input.version,t.version);
    if(!t.active)fail(409,'inactive','القالب موقوف');
    if(!Object.hasOwn(CADENCES,input.cadence))fail(400,'cadence','اختر دورية التقرير');
    db.prepare('UPDATE client_report_templates SET name=?,cadence=?,sections=?,version=version+1,updated_at=? WHERE id=?').run(v.text(input.name,'اسم القالب',160,3),input.cadence,JSON.stringify(cleanSections(input.sections)),now(),t.id);
  }else if(action==='deactivate_template'){
    v.object(input,['version','note']);v.version(input.version,t.version);
    if(!t.active)fail(409,'inactive','القالب موقوف');
    db.prepare('UPDATE client_report_templates SET active=0,version=version+1,updated_at=? WHERE id=?').run(now(),t.id);v.text(input.note,'سبب الإيقاف',1000,5);
  }else fail(404,'not_found','الإجراء غير متاح');
  audit(db,u,'client_report_template',t.id,'client_template.'+action,{version:t.version},{version:t.version+1});
  return {id:t.id};
}

/* ───── التوليد: من بيانات المنصة وحدها ───── */
// كل رقم في التقرير {label,value,type,source,as_of}. source يصف السجل ومرجعه كما أُدخل، وas_of تاريخ الرقم نفسه.
const figure=(label,value,type,source,as_of)=>({label,value,type,source,as_of});
function campaignResults(db,c,from,to){
  const campaigns=db.prepare("SELECT * FROM campaigns WHERE client_id=? AND status IN ('live','paused','completed') AND start_date<=? AND end_date>=? ORDER BY start_date").all(c.id,to,from);
  return campaigns.map(k=>{
    const entries=db.prepare("SELECT e.* FROM campaign_entries e WHERE e.campaign_id=? AND e.kind='result' AND e.entry_date BETWEEN ? AND ? AND NOT EXISTS(SELECT 1 FROM campaign_entries x WHERE x.corrects_id=e.id) ORDER BY e.entry_date").all(k.id,from,to);
    const figures=JSON.parse(k.targets).map(t=>{
      const mine=entries.filter(e=>e.metric===t.metric);
      if(!mine.length)return figure(`${t.metric} (المستهدف ${t.target.toLocaleString('en-US')} ${t.unit})`,null,'none','لا قيد مسجل في الفترة — غياب الرقم ليس صفرًا',to);
      return figure(`${t.metric} (المستهدف ${t.target.toLocaleString('en-US')} ${t.unit})`,mine.reduce((n,e)=>n+e.value,0),'number',`قيود نتائج الحملة (${mine.length}): ${[...new Set(mine.map(e=>e.source))].join('؛ ')}`,mine.at(-1).entry_date);
    });
    return {title:k.name,subtitle:`${k.start_date} إلى ${k.end_date}`,figures};
  });
}
function contentPublished(db,c,from,to){
  const rows=db.prepare("SELECT * FROM content_items WHERE client_id=? AND status='published' AND published_at IS NOT NULL ORDER BY published_at").all(c.id).filter(i=>{const d=riyadhDate(i.published_at);return d>=from&&d<=to;});
  const byChannel=new Map();for(const i of rows)byChannel.set(i.channel,[...(byChannel.get(i.channel)??[]),i]);
  // البند المنشور على نسخة معتمدة (الترحيل 189) يسمّي النسخة وبصمتها، فيرى العميل بالضبط ما اعتُمد؛ والبند القديم بمرجعه النصي كما كان.
  const named=i=>{const o=i.output_version_id?versionLabel(db,c.tenant_id,i.output_version_id):null;return `«${i.title}»${o?` — النسخة ${o.revision} من «${o.title}» ببصمة ${o.digest.slice(0,12)}`:''} ${i.published_reference}`;};
  return [{title:'المنشور في الفترة',subtitle:`${rows.length} بند`,figures:[...byChannel].map(([ch,items])=>figure(`${channelName(ch)} — عدد المنشور`,items.length,'number',`تقويم المحتوى: ${items.map(named).join('؛ ')}`,riyadhDate(items.at(-1).published_at)))}];
}
function mediaSpend(db,c,from,to){
  const campaigns=db.prepare("SELECT * FROM campaigns WHERE client_id=? AND status IN ('live','paused','completed') AND start_date<=? AND end_date>=? ORDER BY start_date").all(c.id,to,from);
  return campaigns.map(k=>{
    // السجل الواحد (app/media-spend-ledger.mjs): الشرط نفسه الذي يقرأ به R22 ولوحة الصرف الإعلامي، فلا يخرج للعميل رقمٌ غير رقم المدير.
    const entries=liveSpend(db,k.id,{from,to}),plan=planInForce(db,k.id);
    const figures=[];
    if(plan)figures.push(figure('الميزانية المخططة للحملة كلها',plan.planned_minor,'money',`خطة الصرف المعتمدة (النسخة ${plan.revision}) — مرجع العميل: ${plan.budget_reference}`,riyadhDate(plan.approved_at)));
    const byChannel=new Map();for(const e of entries)byChannel.set(e.channel,[...(byChannel.get(e.channel)??[]),e]);
    for(const [ch,rows] of byChannel)figures.push(figure(`${channelName(ch)} — المصروف في الفترة`,rows.reduce((n,e)=>n+e.amount_minor,0),'money',`${rows.length} قيد صرف: ${[...new Set(rows.map(e=>`${EVIDENCE_KINDS[e.evidence_kind]} ${e.evidence_reference}`))].join('؛ ')}`,rows.at(-1).spend_date));
    if(!figures.length)return null;
    return {title:k.name,subtitle:plan?'':'لا خطة صرف معتمدة',figures};
  }).filter(Boolean);
}
function contractProgress(db,c,from,to){
  const out=[];
  for(const r of db.prepare('SELECT * FROM retainers WHERE client_id=? AND period_month BETWEEN ? AND ? ORDER BY period_month').all(c.id,from.slice(0,7),to.slice(0,7))){
    const usage=db.prepare('SELECT * FROM retainer_usage WHERE retainer_id=? ORDER BY created_at').all(r.id);
    out.push({title:`${r.name} · ${r.period_month}`,subtitle:`مرجع العقد: ${r.contract_reference}`,figures:JSON.parse(r.allowances).map(a=>{
      const used=usage.filter(x=>x.deliverable_type===a.type);
      return figure(`${a.type} — المُسلَّم من ${a.quantity}`,used.reduce((n,x)=>n+x.quantity,0),'number',used.length?`رصيد الاشتراك: ${used.map(x=>x.reference).join('؛ ')}`:`رصيد الاشتراك: لا تسليم مسجل — ${r.contract_reference}`,used.length?riyadhDate(used.at(-1).created_at):to);
    })});
  }
  for(const b of db.prepare("SELECT * FROM scope_baselines WHERE client_id=? AND status='active' ORDER BY created_at").all(c.id)){
    const events=db.prepare("SELECT * FROM scope_events WHERE baseline_id=? AND kind='delivery' ORDER BY created_at").all(b.id);
    out.push({title:b.name,subtitle:`مرجع العقد: ${b.contract_reference}`,figures:JSON.parse(b.lines).map(l=>{
      const mine=events.filter(e=>e.line_key===l.key);
      return figure(`${l.name} — المُسلَّم من ${l.quantity}`,mine.reduce((n,e)=>n+e.quantity,0),'number',mine.length?`حارس النطاق: ${mine.map(e=>e.item_reference).join('؛ ')}`:`حارس النطاق: لا تسليم مسجل — ${b.contract_reference}`,mine.length?riyadhDate(mine.at(-1).created_at):to);
    })});
  }
  return out;
}
// تسليم المؤثرين من قراءة R43 (influencerDelivery): لكل نوع مخرج ما نُشر وتحقق منه إنسان لين نهاية الفترة مقابل المتعاقد عليه،
// ومصدر الرقم روابط المنشورات نفسها. لا أتعاب ولا أوامر دفع: ما ندفعه للمؤثر تكلفة الوكالة لا يخرج في تقرير العميل.
function influencerDeliveryFor(db,c,from,to){
  return influencerDelivery(db,c.tenant_id,[c.id],{from,to}).map(g=>({title:`${g.influencer_name} — ${g.title}`,subtitle:`${g.campaign_name?`${g.campaign_name} · `:''}${g.starts_on} إلى ${g.ends_on}`,
    figures:g.kinds.map(k=>{
      const verified=k.proofs.filter(p=>p.verified),name=`${k.name} — المنشور المتحقق منه (من ${k.promised})`;
      if(!verified.length)return figure(name,null,'none','لا إثبات نشر متحقق منه لين نهاية الفترة — غياب الرقم ليس صفرًا',to);
      return figure(name,verified.length,'number',`إثبات النشر: ${verified.map(p=>`«${p.title}» ${p.post_url}`).join('؛ ')}`,verified.at(-1).published_on);
    })}));
}
// التغطية الإعلامية من قراءة R44 (prCoverage): عددها بنوع الوسيلة، والنبرة كما قدّرها من سجّلها. بلا «قيمة إعلانية» ولا وصول،
// ولا بيانات جهات الإعلام الشخصية: العنوان والوسيلة والرابط المنشور وحدها.
function prCoverageFor(db,c,from,to){
  const rows=prCoverage(db,c.tenant_id,{from,to,clientId:c.id});
  if(!rows.length)return [];
  const list=items=>items.map(r=>`«${r.title}» — ${r.outlet} ${r.url}`).join('؛ ');
  const byType=new Map();for(const r of rows)byType.set(r.outlet_type,[...(byType.get(r.outlet_type)??[]),r]);
  const tones=Object.entries(toneCounts(rows)).filter(([,n])=>n).map(([tone])=>rows.filter(r=>r.tone===tone));
  return [{title:'التغطية المنشورة في الفترة',subtitle:`${rows.length} تغطية`,figures:[...byType.values()].map(items=>figure(`${items[0].outlet_type_name} — عدد التغطيات`,items.length,'number',`سجل التغطية: ${list(items)}`,items.at(-1).published_on))},
    {title:'النبرة كما قدّرها فريقنا',subtitle:'تقدير بشري لكل تغطية، لا تحليل آلي',figures:tones.map(items=>figure(`تغطية ${items[0].tone_name}`,items.length,'number',`سجل التغطية: ${list(items)}`,items.at(-1).published_on))}];
}
const BUILDERS={campaign_results:campaignResults,content_published:contentPublished,media_spend:mediaSpend,influencer_delivery:influencerDeliveryFor,pr_coverage:prCoverageFor,contract_progress:contractProgress};
export function buildReportBody(db,c,sections,from,to){
  const body={sections:sections.map(key=>({key,name:SECTIONS.find(s=>s.key===key).name,human:key==='next_step',groups:key==='next_step'?[]:BUILDERS[key](db,c,from,to)}))};
  // الحارس الأخير: لا رقم يخرج إلى عميل بلا مصدر وتاريخ.
  for(const s of body.sections)for(const g of s.groups)for(const f of g.figures)
    if(typeof f.source!=='string'||f.source.trim().length<5||!/^\d{4}-\d{2}-\d{2}$/.test(f.as_of??''))fail(500,'figure_without_source',`رقم بلا مصدر أو تاريخ في قسم «${s.name}»: ${f.label}`);
  return body;
}
export function generateReport(db,supplied,input){
  writing(db);v.object(input,['template_id','period_start','period_end','title','supersedes_id']);
  const t=typeof input.template_id==='string'&&db.prepare('SELECT * FROM client_report_templates WHERE id=?').get(input.template_id);
  if(!t||!t.active)fail(404,'not_found','القالب غير متاح');
  const {u,c}=team(db,supplied,t.client_id);if(t.tenant_id!==u.tenant_id)fail(404,'not_found','القالب غير متاح');
  const from=v.date(input.period_start),to=v.date(input.period_end);
  if(to<from)fail(400,'date_order','نهاية الفترة بعد بدايتها');
  if(to>today())fail(400,'future_period','لا تقرير عن فترة لم تنته بعد');
  if(Math.round((Date.parse(to)-Date.parse(from))/86400000)>366)fail(400,'period_too_long','الفترة لا تتجاوز سنة');
  let supersedes=null;
  if(input.supersedes_id){
    supersedes=db.prepare("SELECT * FROM client_reports WHERE id=? AND client_id=? AND status='signed'").get(input.supersedes_id,c.id);
    if(!supersedes)fail(400,'supersedes_id','التصحيح يحل محل تقرير موقّع لهذا العميل');
    if(db.prepare("SELECT 1 FROM client_reports WHERE supersedes_id=? AND status<>'discarded'").get(supersedes.id))fail(409,'correction_exists','لهذا التقرير تصحيح قائم');
  }
  const body=buildReportBody(db,c,JSON.parse(t.sections),from,to),text=JSON.stringify(body),reportId=id(),time=now();
  db.prepare("INSERT INTO client_reports(id,tenant_id,client_id,template_id,title,period_start,period_end,body,digest,status,supersedes_id,prepared_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,'draft',?,?,?,?)").run(reportId,u.tenant_id,c.id,t.id,v.text(input.title,'عنوان التقرير',200,3),from,to,text,hash(text),supersedes?.id??null,u.id,time,time);
  audit(db,u,'client_report',reportId,'client_report.generated',{}, {client:c.code,period_start:from,period_end:to,digest:hash(text),supersedes_id:supersedes?.id??null});
  return {id:reportId};
}

/* ───── التعليق والتوقيع ───── */
function reportView(db,u,r,c){
  const owner=c.owner_id===u.id,body=JSON.parse(r.body),actions=[];
  if(r.status==='draft'&&owner)actions.push('write_commentary');
  if(r.status==='draft'&&owner&&r.prepared_by!==u.id)actions.push('sign_report');
  if(r.status==='draft'&&r.prepared_by===u.id)actions.push('discard_report');
  if(r.status==='signed'&&!db.prepare("SELECT 1 FROM client_reports WHERE supersedes_id=? AND status<>'discarded'").get(r.id))actions.push('correct_report');
  return {...r,body,client_name:c.trade_name||c.legal_name,status_name:REPORT_STATES[r.status],prepared_by_name:name(db,r.prepared_by),template_name:db.prepare('SELECT name FROM client_report_templates WHERE id=?').get(r.template_id)?.name??'',
    integrity:hash(r.body)===r.digest,figure_count:body.sections.reduce((n,s)=>n+s.groups.reduce((m,g)=>m+g.figures.length,0),0),
    signer_blocked:r.status==='draft'&&owner&&r.prepared_by===u.id?'ولّدتَ هذا التقرير بنفسك؛ يولّده عضو آخر في الفريق لتوقّعه أنت، لأن من يُعِدّ لا يوقّع.':null,
    print_path:`/api/client-reports/${r.id}/print`,actions};
}
export function reportAction(db,supplied,reportId,action,input){
  writing(db);const {u,c,r}=reportRow(db,supplied,reportId);
  const fields={write_commentary:['commentary','next_step'],sign_report:['confirm'],discard_report:['note']}[action];
  if(!fields)fail(404,'not_found','الإجراء غير متاح');
  v.object(input,['version',...fields]);v.version(input.version,r.version);
  if(!reportView(db,u,r,c).actions.includes(action))fail(409,'action_unavailable',action==='sign_report'&&r.prepared_by===u.id?'من ولّد التقرير لا يوقّعه':'الإجراء غير متاح في حالة التقرير أو لحسابك');
  const time=now();
  if(action==='write_commentary'){
    db.prepare('UPDATE client_reports SET commentary=?,next_step=?,version=version+1,updated_at=? WHERE id=?').run(v.text(input.commentary,'تعليق مسؤول الحساب على الأداء',6000,20),input.next_step?v.text(input.next_step,'الخطوة التالية',3000,3):'',time,r.id);
  }else if(action==='sign_report'){
    if(input.confirm!==true)fail(400,'confirm','أقرّ بأنك راجعت الأرقام ومصادرها وكتبت التعليق بنفسك');
    if(r.commentary.trim().length<20)fail(409,'commentary_required','اكتب تعليقك على الأداء قبل التوقيع');
    if(JSON.parse(r.body).sections.some(s=>s.key==='next_step')&&r.next_step.trim().length<3)fail(409,'next_step_required','القالب يتضمن «الخطوة التالية»: اكتبها قبل التوقيع');
    if(hash(r.body)!==r.digest)fail(409,'report_corrupted','بصمة التقرير لا تطابق محتواه');
    if(r.supersedes_id)db.prepare("UPDATE client_reports SET status='superseded',version=version+1,updated_at=? WHERE id=? AND status='signed'").run(time,r.supersedes_id);
    db.prepare("UPDATE client_reports SET status='signed',signed_by=?,signed_name=?,signed_at=?,version=version+1,updated_at=? WHERE id=?").run(u.id,u.name,time,time,r.id);
  }else{
    v.text(input.note,'سبب الإهمال',1000,5);
    db.prepare("UPDATE client_reports SET status='discarded',version=version+1,updated_at=? WHERE id=?").run(time,r.id);
  }
  audit(db,u,'client_report',r.id,'client_report.'+action,{status:r.status,version:r.version},{version:r.version+1},typeof input.note==='string'?input.note.trim():'');
  return {id:r.id};
}
export function readClientReport(db,supplied,reportId){
  const {u,c,r}=reportRow(db,supplied,reportId);
  if(hash(r.body)!==r.digest)fail(409,'report_corrupted','بصمة التقرير لا تطابق محتواه');
  return {...reportView(db,u,r,c),signed_by_name:name(db,r.signed_by),supersedes:r.supersedes_id?db.prepare('SELECT id,title,signed_at FROM client_reports WHERE id=?').get(r.supersedes_id):null};
}
export function clientReportsBoard(db,supplied){
  const clients=memberClients(db,supplied),u=currentUser(db,supplied);
  if(!can(db,u,'commercial.use',u.department_id))fail(403,'not_permitted','تقارير العملاء تحتاج تصريح «المبيعات والتسليم». اطلبه من مسؤول الصلاحيات');
  const byId=new Map(clients.map(c=>[c.id,c])),ids=clients.map(c=>c.id),marks=ids.map(()=>'?').join(',');
  const templates=ids.length?db.prepare(`SELECT * FROM client_report_templates WHERE tenant_id=? AND client_id IN (${marks}) ORDER BY active DESC,name`).all(u.tenant_id,...ids):[];
  const reports=ids.length?db.prepare(`SELECT * FROM client_reports WHERE tenant_id=? AND client_id IN (${marks}) ORDER BY period_end DESC,created_at DESC LIMIT 200`).all(u.tenant_id,...ids):[];
  return {today:today(),user_id:u.id,sections:SECTIONS,cadences:CADENCES,states:REPORT_STATES,
    clients:clients.map(c=>({id:c.id,name:c.trade_name||c.legal_name,is_owner:c.owner_id===u.id})),
    templates:templates.map(t=>{const c=byId.get(t.client_id);return {...t,active:!!t.active,sections:JSON.parse(t.sections),client_name:c.trade_name||c.legal_name,cadence_name:CADENCES[t.cadence],created_by_name:name(db,t.created_by),actions:c.owner_id===u.id&&t.active?['edit_template','deactivate_template']:[],can_generate:!!t.active};}),
    reports:reports.map(r=>{const view=reportView(db,u,r,byId.get(r.client_id));const {body,...rest}=view;return {...rest,sections:body.sections,signed_by_name:name(db,r.signed_by)};}),
    note:`كل رقم في التقرير مأخوذ من سجلات المنصة ومعه مصدره وتاريخه، وغياب القيد يُكتب «لا قيد» لا صفرًا. لا تعليق آلي ولا نص يولده نموذج لغوي: التعليق يكتبه مسؤول الحساب ويوقّعه باسمه، ولا يوقّع من ولّد التقرير. ${NO_SENDING}`};
}

/* ───── نسخة الطباعة ───── */
const esc=value=>String(value??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
const sar=minor=>{const n=Number(minor),abs=Math.abs(n);return `${n<0?'-':''}${Math.floor(abs/100).toLocaleString('en-US')}.${String(abs%100).padStart(2,'0')}`;};
const cell=f=>f.type==='money'?`${sar(f.value)} ريال`:f.type==='none'?'لا قيد':Number(f.value).toLocaleString('en-US');
// الذيل يقرأ tenants.demo_data (الترحيل 137) بدل أن يكتب بحرفه أن البيانات مصطنعة. الوسيط الأخير اختياري وافتراضه
// الحالة المصطنعة: موضع نداء لم يُحدَّث يبقى يطبع التحذير، ولا يسقطه صامتًا عن تقرير صار حقيقيًا.
// و«أُنتج» بصيغة المذكر كما كانت هنا، لأن الموصوف تقرير لا فاتورة.
export function clientReportPrintable(report,demoData=SYNTHETIC){
  const signed=report.status==='signed';
  const sections=report.body.sections.map(s=>s.human?`<section><h2>${esc(s.name)}</h2><p>${esc(report.next_step||'لم تُكتب بعد.')}</p></section>`:
    `<section><h2>${esc(s.name)}</h2>${s.groups.length?s.groups.map(g=>`<h3>${esc(g.title)}${g.subtitle?` <span class="meta">${esc(g.subtitle)}</span>`:''}</h3><table><thead><tr><th>البند</th><th>القيمة</th><th>المصدر</th><th>بتاريخ</th></tr></thead><tbody>${g.figures.map(f=>`<tr><td>${esc(f.label)}</td><td class="num">${esc(cell(f))}</td><td>${esc(f.source)}</td><td class="num">${esc(f.as_of)}</td></tr>`).join('')||'<tr><td colspan="4">لا أرقام مسجلة.</td></tr>'}</tbody></table>`).join(''):'<p class="meta">لا سجلات في هذه الفترة. غياب البيانات ليس صفرًا.</p>'}</section>`).join('');
  return `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(report.title)}</title><link rel="stylesheet" href="/report-print.css"></head><body class="doc"><header><p class="brand">3,6T</p><h1>${esc(report.title)}</h1><p class="meta">${esc(report.client_name)} · الفترة ${esc(dual(report.period_start))} إلى ${esc(dual(report.period_end))}</p><p class="meta">بصمة المحتوى <bdi dir="ltr">${esc(report.digest.slice(0,16))}</bdi></p></header>
    <p class="notice">${signed?`موقّع من ${esc(report.signed_name)} بتاريخ ${esc(dual(report.signed_at))}.`:`${esc(report.status_name)}. لا يُرسل للعميل قبل توقيع مسؤول الحساب.`} الأرقام من سجلات المنصة، ولكل رقم مصدره وتاريخه كما أُدخل؛ الصرف والنتائج مُدخلة يدويًا أو مستوردة من ملفات صدّرها الفريق من المنصات الإعلانية، ولا اتصال مباشر بأي منصة.</p>
    ${sections}
    <section><h2>تعليق مسؤول الحساب</h2><p>${esc(report.commentary||'لم يُكتب بعد.')}</p>${signed?`<p class="meta">${esc(report.signed_name)} — ${esc(riyadhDate(report.signed_at))}</p>`:''}</section>
    <footer>${esc(NO_SENDING)} ${esc(documentFooter(demoData,{feminine:false}))}</footer></body></html>`;
}
