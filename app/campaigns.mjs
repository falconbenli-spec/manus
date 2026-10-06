import { randomUUID } from 'node:crypto';
import { audit, now } from './db.mjs';
import { fail } from './auth.mjs';
import * as v from './validation.mjs';
import { clientFor, memberClients, recordRetainerUsage } from './agency.mjs';
import { refuse } from './refusal.mjs';
import { liveSpend, planInForce } from './media-spend-ledger.mjs';
import { bindableVersion, bindableVersions, assertPublishable, versionLabel } from './approved-version.mjs';

// الحملات وتقويم المحتوى وحارس النطاق. كل ما هنا يراه فريق الحساب فقط.
// النتائج والصرف تُدخل يدويًا مع مصدرها: لا ربط بمنصات الإعلان بعد، فلا يُعرض رقم على أنه مقروء آليًا.
export const CHANNELS=[['instagram','إنستغرام'],['x','إكس'],['tiktok','تيك توك'],['snapchat','سناب شات'],['linkedin','لينكدإن'],['youtube','يوتيوب'],['google_ads','إعلانات قوقل'],['website','الموقع'],['email','البريد'],['outdoor','إعلانات خارجية'],['other','قناة أخرى']].map(([key,name])=>({key,name}));
export const FORMATS=[['post','منشور'],['carousel','منشور متعدد'],['reel','فيديو قصير'],['story','قصة'],['video','فيديو'],['article','مقال'],['ad','إعلان'],['newsletter','نشرة']].map(([key,name])=>({key,name}));
export const CONTENT_STATES={idea:'فكرة',drafting:'قيد الإعداد',internal_review:'مراجعة داخلية',client_review:'لدى العميل',approved:'معتمد من العميل',scheduled:'مجدول',published:'نُشر',cancelled:'ملغى'};
export const CAMPAIGN_STATES={planning:'تخطيط',launch_review:'بانتظار اعتماد الإطلاق',live:'نشطة',paused:'متوقفة مؤقتًا',completed:'مقفلة',cancelled:'ملغاة'};
const LAUNCH_CHECKLIST=['الأهداف والمؤشرات معتمدة من العميل','المواد الإبداعية معتمدة بنسختها النهائية','التتبع والقياس مُختبران','الميزانية وحدود الصرف اليومية مضبوطة','الحسابات الإعلانية والصلاحيات موثقة','خطة الرد والتصعيد جاهزة'];
const id=()=>randomUUID();
const today=()=>new Date(Date.now()+3*3600000).toISOString().slice(0,10);
const name=(db,userId)=>userId?db.prepare('SELECT name FROM users WHERE id=?').get(userId)?.name??null:null;
function writing(db){if(!db.isTransaction)fail(500,'transaction_required','تتطلب الكتابة معاملة قاعدة بيانات');}
function versioned(row,input){if(!Number.isInteger(input?.version)||input.version!==row.version)fail(409,'stale_version','تغير السجل منذ فتحه. أعد التحميل');}
function money(value,label,{zero=false}={}){
  if(typeof value!=='string'||!/^(?:0|[1-9]\d{0,9})(?:\.\d{1,2})?$/.test(value))fail(400,'invalid_money',`${label}: مبلغ بخانتين عشريتين كحد أقصى`);
  const [whole,fraction='']=value.split('.'),minor=Number(BigInt(whole)*100n+BigInt(fraction.padEnd(2,'0')));
  if(minor<=0&&!zero)fail(400,'invalid_money',`${label}: مبلغ موجب`);return minor;
}
const pick=(list,key,label)=>{if(!list.some(x=>x.key===key))fail(400,'invalid_choice',`${label}: اختيار غير متاح`);return key;};

/* ───── الحملات ───── */
function campaignRow(db,supplied,campaignId){
  const row=typeof campaignId==='string'&&db.prepare('SELECT * FROM campaigns WHERE id=?').get(campaignId);
  if(!row)fail(404,'not_found','الحملة غير متاحة');
  const {u,c}=clientFor(db,supplied,row.client_id);if(row.tenant_id!==u.tenant_id)fail(404,'not_found','الحملة غير متاحة');
  return {u,c,row};
}
function campaignView(db,u,row,clientRow){
  const entries=db.prepare('SELECT e.*,x.name AS recorded_by_name FROM campaign_entries e JOIN users x ON x.id=e.recorded_by WHERE e.campaign_id=? ORDER BY e.entry_date,e.created_at').all(row.id);
  const corrected=new Set(entries.filter(e=>e.corrects_id).map(e=>e.corrects_id)),live=entries.filter(e=>!corrected.has(e.id));
  const targets=JSON.parse(row.targets).map(t=>{const actual=live.filter(e=>e.kind==='result'&&e.metric===t.metric).reduce((n,e)=>n+e.value,0);return {...t,actual,attainment_bp:t.target?Math.round(actual*10000/t.target):null};});
  // الصرف مصدره واحد (الترحيل 192): متى اعتُمدت للحملة خطة صرف صار سجل الصرف الإعلامي هو الصرف، والبلاطة تقرأ منه ما تقرؤه
  // لوحة الصرف وR22 وتقرير العميل. قيود «صرف» المكتوبة هنا قبل الخطة تبقى ظاهرة تاريخًا في القيود، ومجموعها يُسمّى ولا يُجمع.
  const plan=planInForce(db,row.id),typed=live.filter(e=>e.kind==='spend').reduce((n,e)=>n+e.value,0);
  const spent=plan?liveSpend(db,row.id).reduce((n,e)=>n+e.amount_minor,0):typed;
  const correctable=e=>!corrected.has(e.id)&&!(plan&&e.kind==='spend');
  const total=Math.max(1,Math.round((Date.parse(row.end_date)-Date.parse(row.start_date))/86400000)+1),elapsed=Math.min(total,Math.max(0,Math.round((Date.parse(today())-Date.parse(row.start_date))/86400000)+1));
  const timeBp=Math.round(elapsed*10000/total),spendBp=row.media_budget_minor?Math.round(spent*10000/row.media_budget_minor):null;
  const own=row.owner_id===u.id,checklist=JSON.parse(row.checklist),actions=[];
  if(row.status==='planning'&&own)actions.push('edit_campaign','check_item','request_launch','cancel_campaign');
  if(row.status==='launch_review'&&!own)actions.push('approve_launch','return_launch');
  if(['live','paused'].includes(row.status)){
    actions.push('record_result');
    if(!plan)actions.push('record_spend');
    if(entries.some(correctable))actions.push('correct_entry');
  }
  if(row.status==='live'&&own)actions.push('pause_campaign','complete_campaign');
  if(row.status==='paused'&&own)actions.push('resume_campaign','complete_campaign');
  return {...row,client_name:clientRow.trade_name||clientRow.legal_name,status_name:CAMPAIGN_STATES[row.status],owner_name:name(db,row.owner_id),launch_approved_by_name:name(db,row.launch_approved_by),own,
    channels:JSON.parse(row.channels),targets,checklist,checklist_done:checklist.filter(i=>i.done).length,entries:entries.map(e=>({...e,superseded:corrected.has(e.id),correctable:correctable(e)})),
    spent_minor:spent,spend_ledger:plan?{plan_revision:plan.revision,legacy_spend_minor:typed}:null,time_elapsed_bp:timeBp,spend_bp:spendBp,
    // الصرف يسبق الزمن بأكثر من 15 نقطة أو يتجاوز الميزانية: تنبيه لا منع.
    pacing:spendBp===null?'no_budget':spent>row.media_budget_minor?'over_budget':spendBp-timeBp>1500?'ahead':timeBp-spendBp>2500&&row.status==='live'?'behind':'on_track',
    content_count:db.prepare("SELECT COUNT(*) AS n FROM content_items WHERE campaign_id=? AND status<>'cancelled'").get(row.id).n,actions};
}
function cleanCampaign(input){
  const from=v.date(input.start_date),to=v.date(input.end_date);if(to<from)fail(400,'date_order','نهاية الحملة بعد بدايتها');
  if(!Array.isArray(input.channels)||!input.channels.length||input.channels.length>CHANNELS.length||new Set(input.channels).size!==input.channels.length)fail(400,'channels','اختر قناة واحدة على الأقل دون تكرار');
  input.channels.forEach(c=>pick(CHANNELS,c,'القناة'));
  if(!Array.isArray(input.targets)||!input.targets.length||input.targets.length>12)fail(400,'targets','من مؤشر إلى اثني عشر مؤشرًا');
  const seen=new Set(),targets=input.targets.map(t=>{v.object(t,['metric','target','unit']);const metric=v.text(t.metric,'اسم المؤشر',80,2);if(seen.has(metric))fail(400,'targets','المؤشر مكرر');seen.add(metric);if(!Number.isInteger(t.target)||t.target<1||t.target>1e12)fail(400,'targets','المستهدف عدد صحيح موجب');return {metric,target:t.target,unit:v.text(t.unit,'وحدة القياس',40,1)};});
  const budget=money(input.media_budget,'الميزانية الإعلامية',{zero:true});
  if(budget>0&&!(typeof input.budget_reference==='string'&&input.budget_reference.trim().length>=5))fail(400,'budget_reference','اكتب مرجع اعتماد الميزانية من العميل');
  return {name:v.text(input.name,'اسم الحملة',180,3),objective:v.text(input.objective,'هدف الحملة',2000,10),channels:JSON.stringify(input.channels),targets:JSON.stringify(targets),budget,reference:(input.budget_reference??'').trim(),from,to};
}
const CAMPAIGN_FIELDS=['client_id','name','objective','channels','targets','media_budget','budget_reference','start_date','end_date'];
export function createCampaign(db,supplied,input){
  writing(db);v.object(input,CAMPAIGN_FIELDS);
  const {u,c}=clientFor(db,supplied,input.client_id),f=cleanCampaign(input);
  if(db.prepare('SELECT 1 FROM campaigns WHERE client_id=? AND name=?').get(c.id,f.name))fail(409,'duplicate_campaign','لهذا العميل حملة بالاسم نفسه');
  const campaignId=id(),time=now();
  db.prepare("INSERT INTO campaigns(id,tenant_id,client_id,name,objective,channels,targets,media_budget_minor,budget_reference,start_date,end_date,status,owner_id,checklist,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,'planning',?,?,?,?)")
    .run(campaignId,u.tenant_id,c.id,f.name,f.objective,f.channels,f.targets,f.budget,f.reference,f.from,f.to,u.id,JSON.stringify(LAUNCH_CHECKLIST.map((label,i)=>({key:`k${i+1}`,label,done:false,evidence:'',by:null}))),time,time);
  audit(db,u,'campaign',campaignId,'campaign.created',{}, {client:c.code});
  return {id:campaignId};
}
// صرف الحملة بعد اعتماد خطتها يُسجَّل ويُصحَّح في سجل الصرف الإعلامي وحده؛ والقاعدة ترفضه هنا أيضًا (الترحيل 192).
function spendBelongsToLedger(view,action){
  refuse(409,'spend_in_media_ledger',{what:action==='spend'?`ما ينسجل صرف في شاشة الحملة «${view.name}»: لها خطة صرف معتمدة (النسخة ${view.spend_ledger.plan_revision})`
      :`قيود «صرف» القديمة في شاشة الحملة «${view.name}» ما تتصحح بعد اعتماد خطة الصرف`,
    missing:[{document:'قيد الصرف في سجل الصرف الإعلامي بمصدره (لقطة أو كشف حساب أو فاتورة)',
      why:'سجل الصرف الإعلامي هو مصدر الصرف الوحيد اللي تقرأ منه بلاطة الحملة وتقرير R22 وتقرير العميل، فالريال الواحد ما يطلع برقمين',
      owner:'فريق حساب العميل — شاشة الصرف الإعلامي'}],
    next:action==='spend'?'سجّل الصرف من شاشة الصرف الإعلامي على الخطة المعتمدة':'إذا كان القيد القديم صرفًا فعليًا ما انسجل، سجّله في شاشة الصرف الإعلامي بمصدره؛ القيد القديم يبقى تاريخًا وما يدخل الصرف',
    link:'#media-spend'});
}
export function campaignAction(db,supplied,campaignId,action,input){
  writing(db);const {u,c,row}=campaignRow(db,supplied,campaignId),view=campaignView(db,u,row,c);
  const key={edit:'edit_campaign',check:'check_item',request_launch:'request_launch',approve_launch:'approve_launch',return_launch:'return_launch',result:'record_result',spend:'record_spend',correct:'correct_entry',pause:'pause_campaign',resume:'resume_campaign',complete:'complete_campaign',cancel:'cancel_campaign'}[action];
  // الرفض المسمّى قبل العام: صرفٌ على حملة لها خطة صرف معتمدة مكانه سجل الصرف الإعلامي، لا «الإجراء غير متاح».
  if(view.spend_ledger&&(action==='spend'||(action==='correct'&&view.entries.find(e=>e.id===input?.entry_id)?.kind==='spend')))spendBelongsToLedger(view,action);
  if(!key||!view.actions.includes(key))fail(409,'invalid_state','الإجراء غير متاح في حالة الحملة أو لحسابك');
  versioned(row,input);
  const time=now(),bump=(fields,values)=>db.prepare(`UPDATE campaigns SET ${fields},version=version+1,updated_at=? WHERE id=?`).run(...values,time,row.id);
  if(action==='edit'){v.object(input,['version',...CAMPAIGN_FIELDS.slice(1)]);const f=cleanCampaign(input);bump('name=?,objective=?,channels=?,targets=?,media_budget_minor=?,budget_reference=?,start_date=?,end_date=?',[f.name,f.objective,f.channels,f.targets,f.budget,f.reference,f.from,f.to]);}
  else if(action==='check'){
    v.object(input,['version','key','evidence']);const list=JSON.parse(row.checklist),item=list.find(i=>i.key===input.key);if(!item)fail(400,'key','بند غير معروف');
    item.done=true;item.evidence=v.text(input.evidence,'دليل اكتمال البند',600,5);item.by=u.name;bump('checklist=?',[JSON.stringify(list)]);
  }else if(action==='request_launch'){
    v.object(input,['version']);const open=JSON.parse(row.checklist).filter(i=>!i.done);
    if(open.length)fail(409,'checklist_incomplete',`بنود لم تكتمل: ${open.map(i=>i.label).join('؛ ')}`);
    bump("status='launch_review'",[]);
  }else if(action==='approve_launch'){v.object(input,['version','note']);bump("status='live',launch_approved_by=?,launch_approved_at=?,launch_note=?",[u.id,time,v.text(input.note,'أساس اعتماد الإطلاق',1500,10)]);}
  else if(action==='return_launch'){v.object(input,['version','note']);bump("status='planning',launch_note=?",[v.text(input.note,'ما يلزم قبل الإطلاق',1500,10)]);}
  else if(action==='result'||action==='spend'){
    v.object(input,action==='result'?['version','entry_date','metric','value','source']:['version','entry_date','channel','amount','source']);
    const date=v.date(input.entry_date);if(date>today()||date<row.start_date)fail(400,'entry_date','تاريخ القيد بين بداية الحملة واليوم');
    const source=v.text(input.source,'مصدر الرقم (لوحة المنصة، تقرير، فاتورة)',600,5);
    if(action==='result'){
      if(!view.targets.some(t=>t.metric===input.metric))fail(400,'metric','المؤشر ليس من مؤشرات الحملة المعتمدة');
      if(!Number.isInteger(input.value)||input.value<0||input.value>1e12)fail(400,'value','القيمة عدد صحيح غير سالب');
      db.prepare("INSERT INTO campaign_entries(id,campaign_id,kind,entry_date,metric,value,source,recorded_by,created_at) VALUES(?,?,'result',?,?,?,?,?,?)").run(id(),row.id,date,input.metric,input.value,source,u.id,time);
    }else{
      if(!view.channels.includes(input.channel))fail(400,'channel','القناة ليست من قنوات الحملة');
      db.prepare("INSERT INTO campaign_entries(id,campaign_id,kind,entry_date,channel,value,source,recorded_by,created_at) VALUES(?,?,'spend',?,?,?,?,?,?)").run(id(),row.id,date,input.channel,money(input.amount,'المبلغ'),source,u.id,time);
    }
    bump('status=status',[]);
  }else if(action==='correct'){
    v.object(input,['version','entry_id','value','source']);
    const e=view.entries.find(x=>x.id===input.entry_id);if(!e||!e.correctable)fail(404,'not_found','القيد غير متاح للتصحيح');
    const value=e.kind==='spend'?money(String(input.value),'المبلغ الصحيح',{zero:true}):input.value;
    if(!Number.isInteger(value)||value<0)fail(400,'value','القيمة الصحيحة عدد غير سالب');
    db.prepare('INSERT INTO campaign_entries(id,campaign_id,kind,entry_date,metric,channel,value,source,corrects_id,recorded_by,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(id(),row.id,e.kind,e.entry_date,e.metric,e.channel,value,v.text(input.source,'سبب التصحيح ومصدر الرقم الصحيح',600,10),e.id,u.id,time);
    bump('status=status',[]);
  }else if(action==='pause'||action==='resume'){v.object(input,['version','note']);v.text(input.note,'السبب',1000,5);bump('status=?',[action==='pause'?'paused':'live']);}
  else if(action==='complete'){v.object(input,['version','learning']);bump("status='completed',learning=?,closed_at=?",[v.text(input.learning,'ما تعلمناه: ما نجح وما لم ينجح وما نغيره',4000,30),time]);}
  else if(action==='cancel'){v.object(input,['version','note']);v.text(input.note,'سبب الإلغاء',1000,10);bump("status='cancelled',closed_at=?",[time]);}
  audit(db,u,'campaign',row.id,'campaign.'+action,{status:row.status},{},typeof input.note==='string'?input.note.trim():'');
  return {id:row.id};
}

/* ───── تقويم المحتوى ───── */
function contentRow(db,supplied,itemId){
  const row=typeof itemId==='string'&&db.prepare('SELECT * FROM content_items WHERE id=?').get(itemId);
  if(!row)fail(404,'not_found','بند المحتوى غير متاح');
  const {u,c}=clientFor(db,supplied,row.client_id);if(row.tenant_id!==u.tenant_id)fail(404,'not_found','بند المحتوى غير متاح');
  return {u,c,row};
}
function contentView(db,u,row,holidays){
  const own=row.owner_id===u.id,actions=[];
  if(['idea','drafting'].includes(row.status)&&own)actions.push('edit_item','submit_internal','cancel_item');
  if(row.status==='idea'&&own)actions.push('start_drafting');
  if(row.status==='internal_review'&&!own)actions.push('pass_internal','return_item');
  if(row.status==='client_review')actions.push('record_client_approval','client_changes');
  if(row.status==='approved'&&own)actions.push('schedule_item','publish_item');
  if(row.status==='scheduled'&&own)actions.push('publish_item','cancel_item');
  // النسخة المعتمدة التي قُدّم عليها البند (الترحيل 189) بعنوانها ورقمها وبصمتها؛ والبند القديم يبقى بمرجعه النصي.
  return {...row,status_name:CONTENT_STATES[row.status],channel_name:CHANNELS.find(c=>c.key===row.channel)?.name??row.channel,format_name:FORMATS.find(f=>f.key===row.format)?.name??row.format,owner_name:name(db,row.owner_id),internal_reviewer_name:name(db,row.internal_reviewer),own,
    output:versionLabel(db,row.tenant_id,row.output_version_id),
    // موافقات العميل الموثّقة على نسخة البند نفسها، تُختار عند التوثيق بدل كتابة مرجعها.
    client_approvals:row.status==='client_review'&&row.output_version_id?db.prepare("SELECT id,approver_snapshot,received_on FROM external_approvals WHERE tenant_id=? AND output_version_id=? AND status IN ('documented','verified') AND decision IN ('approved','approved_with_conditions') ORDER BY received_on DESC,id")
      .all(row.tenant_id,row.output_version_id).map(a=>({id:a.id,label:`${JSON.parse(a.approver_snapshot).name} · ${a.received_on}`})):[],
    holiday:holidays.get(row.planned_date)??null,late:!['published','cancelled'].includes(row.status)&&row.planned_date<today(),actions};
}
const CONTENT_FIELDS=['client_id','campaign_id','brand_id','channel','format','title','brief','planned_date','planned_time','retainer_id','deliverable_type'];
function cleanContent(db,u,c,input){
  if(input.campaign_id&&!db.prepare("SELECT 1 FROM campaigns WHERE id=? AND client_id=? AND status NOT IN ('completed','cancelled')").get(input.campaign_id,c.id))fail(400,'campaign_id','الحملة ليست حملة قائمة لهذا العميل');
  if(input.brand_id&&!db.prepare('SELECT 1 FROM client_brands WHERE id=? AND client_id=? AND active=1').get(input.brand_id,c.id))fail(400,'brand_id','العلامة ليست من علامات هذا العميل');
  let type='';
  if(input.retainer_id){
    const r=db.prepare('SELECT * FROM retainers WHERE id=? AND client_id=?').get(input.retainer_id,c.id);if(!r)fail(400,'retainer_id','الاشتراك ليس لهذا العميل');
    type=v.text(input.deliverable_type,'نوع المخرج في الاشتراك',120,2);if(!JSON.parse(r.allowances).some(a=>a.type===type))fail(400,'deliverable_type','النوع ليس من بنود الاشتراك');
  }
  if(input.planned_time&&!/^([01]\d|2[0-3]):[0-5]\d$/.test(input.planned_time))fail(400,'planned_time','الوقت بصيغة 18:30');
  return {campaign:input.campaign_id||null,brand:input.brand_id||null,channel:pick(CHANNELS,input.channel,'القناة'),format:pick(FORMATS,input.format,'الشكل'),title:v.text(input.title,'عنوان البند',200,3),brief:input.brief?v.text(input.brief,'الفكرة والرسالة',3000,3):'',date:v.date(input.planned_date),time:input.planned_time||'',retainer:input.retainer_id||null,type};
}
export function createContent(db,supplied,input){
  writing(db);v.object(input,CONTENT_FIELDS);
  const {u,c}=clientFor(db,supplied,input.client_id),f=cleanContent(db,u,c,input),itemId=id(),time=now();
  db.prepare("INSERT INTO content_items(id,tenant_id,client_id,campaign_id,brand_id,channel,format,title,brief,planned_date,planned_time,status,owner_id,retainer_id,deliverable_type,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,'idea',?,?,?,?,?)").run(itemId,u.tenant_id,c.id,f.campaign,f.brand,f.channel,f.format,f.title,f.brief,f.date,f.time,u.id,f.retainer,f.type,time,time);
  audit(db,u,'content_item',itemId,'content.created',{}, {client:c.code});
  return {id:itemId};
}
export function contentAction(db,supplied,itemId,action,input){
  writing(db);const {u,c,row}=contentRow(db,supplied,itemId),view=contentView(db,u,row,new Map());
  const key={edit:'edit_item',start:'start_drafting',submit:'submit_internal',pass:'pass_internal',return:'return_item',client_approve:'record_client_approval',client_changes:'client_changes',schedule:'schedule_item',publish:'publish_item',cancel:'cancel_item'}[action];
  if(!key||!view.actions.includes(key))fail(409,'invalid_state','الإجراء غير متاح في حالة البند أو لحسابك');
  versioned(row,input);
  const time=now(),bump=(fields,values)=>db.prepare(`UPDATE content_items SET ${fields},version=version+1,updated_at=? WHERE id=?`).run(...values,time,row.id);
  let detail={};
  if(action==='edit'){v.object(input,['version',...CONTENT_FIELDS.slice(1)]);const f=cleanContent(db,u,c,input);bump('campaign_id=?,brand_id=?,channel=?,format=?,title=?,brief=?,planned_date=?,planned_time=?,retainer_id=?,deliverable_type=?',[f.campaign,f.brand,f.channel,f.format,f.title,f.brief,f.date,f.time,f.retainer,f.type]);}
  else if(action==='start'){v.object(input,['version']);bump("status='drafting'",[]);}
  else if(action==='submit'){
    // P4-SPEC-3: البند يُقدَّم على نسخة مخرج اعتمدها الاستوديو، فيحمل معرّفها وبصمتها مقروءين — لا مرجعًا يكتبه الموظف.
    v.object(input,['version','draft_reference','output_version_id']);
    if(!input.output_version_id)refuse(400,'version_required',{what:'بند المحتوى ينقدّم على نسخة مخرج اعتمدها الاستوديو، ما على مرجع مكتوب',
      missing:[{document:'نسخة مخرج معتمدة في «الاستوديو والتسليم»',why:'المنشور لازم يكون النسخة اللي اعتُمدت بعينها',owner:'معدّ العمل في الاستوديو ومراجعه',owner_role:'studio'}],
      next:row.campaign_id?'افتح العمل في الاستوديو على حملة البند، وبعد اعتماد النسخة اخترها هنا':'افتح العمل في الاستوديو، وبعد اعتماد النسخة اخترها هنا'});
    const bound=bindableVersion(db,u,input.output_version_id,{client:row.client_id,campaign:row.campaign_id,channel:row.channel,what:'بند المحتوى'});
    bump("status='internal_review',draft_reference='',output_version_id=?,output_digest=?,client_approval_id=NULL",[bound.version_id,bound.digest]);
    detail={output_version_id:bound.version_id,output_digest:bound.digest};
  }
  else if(action==='pass'){v.object(input,['version','note']);bump("status='client_review',internal_reviewer=?,internal_note=?",[u.id,v.text(input.note,'ملاحظة المراجعة الداخلية',1500,3)]);}
  else if(action==='return'){v.object(input,['version','note']);bump("status='drafting',internal_note=?,revision_count=revision_count+1",[v.text(input.note,'المطلوب تعديله',1500,10)]);}
  else if(action==='client_approve'){
    v.object(input,['version','reference','external_approval_id']);
    // البند المربوط بنسخة يقرأ موافقة العميل من سجل الموافقات الموثّقة على النسخة نفسها، فلا يُكتب مرجعها مرة ثانية.
    if(input.external_approval_id){
      const a=row.output_version_id&&typeof input.external_approval_id==='string'&&db.prepare('SELECT * FROM external_approvals WHERE id=? AND tenant_id=?').get(input.external_approval_id,u.tenant_id);
      if(!a||a.output_version_id!==row.output_version_id||!['documented','verified'].includes(a.status)||!['approved','approved_with_conditions'].includes(a.decision))
        refuse(409,'approval_mismatch',{what:'سجل الموافقة هذا ما يوثّق موافقة العميل على نسخة البند نفسها',
          next:'وثّق موافقة العميل على النسخة المربوطة في «موافقات العملاء» ثم اخترها هنا، أو اكتب مرجع الموافقة'});
      const who=JSON.parse(a.approver_snapshot);
      bump("status='approved',client_approval_reference=?,client_approval_recorded_by=?,client_approval_id=?",[`موافقة موثقة في سجل موافقات العملاء: ${who.name} (${who.title}) · ${a.received_on} · ${a.evidence_reference}`,u.id,a.id]);
      detail={client_approval_id:a.id};
    }else bump("status='approved',client_approval_reference=?,client_approval_recorded_by=?",[v.text(input.reference,'من وافق من جهة العميل وأين حُفظ الدليل',600,5),u.id]);
  }
  else if(action==='client_changes'){v.object(input,['version','note']);bump("status='drafting',internal_note=?,revision_count=revision_count+1",[v.text(input.note,'تعديلات العميل',1500,10)]);}
  else if(action==='schedule'){v.object(input,['version','planned_date','planned_time']);const date=v.date(input.planned_date);if(date<today())fail(400,'planned_date','موعد الجدولة اليوم أو بعده');if(!/^([01]\d|2[0-3]):[0-5]\d$/.test(input.planned_time??''))fail(400,'planned_time','الوقت بصيغة 18:30');bump("status='scheduled',planned_date=?,planned_time=?",[date,input.planned_time]);}
  else if(action==='publish'){
    v.object(input,['version','published_reference','overage_note']);
    const reference=v.text(input.published_reference,'رابط المنشور أو معرّفه',600,5);
    // ما يُنشر قبل قرار مسار مراجعة نسخته ولا بعد ردّه لها.
    if(row.output_version_id)assertPublishable(db,row.tenant_id,row.output_version_id);
    // النشر يخصم من رصيد الاشتراك مرة واحدة؛ والتجاوز يحتاج سنده كما في العقد.
    if(row.retainer_id)recordRetainerUsage(db,u,row.retainer_id,{deliverable_type:row.deliverable_type,quantity:1,reference:`${row.title} — ${reference}`.slice(0,500),overage_note:input.overage_note??''});
    bump("status='published',published_reference=?,published_at=?",[reference,time]);
  }else if(action==='cancel'){v.object(input,['version','note']);v.text(input.note,'سبب الإلغاء',1000,5);bump("status='cancelled'",[]);}
  audit(db,u,'content_item',row.id,'content.'+action,{status:row.status},detail);
  return {id:row.id};
}

/* ───── حارس النطاق ───── */
function baselineRow(db,supplied,baselineId,options){
  const row=typeof baselineId==='string'&&db.prepare('SELECT * FROM scope_baselines WHERE id=?').get(baselineId);
  if(!row)fail(404,'not_found','خط الأساس غير متاح');
  const {u,c}=clientFor(db,supplied,row.client_id,options);if(row.tenant_id!==u.tenant_id)fail(404,'not_found','خط الأساس غير متاح');
  return {u,c,row};
}
function baselineView(db,u,row,clientRow){
  const events=db.prepare('SELECT e.*,x.name AS recorded_by_name FROM scope_events e JOIN users x ON x.id=e.recorded_by WHERE e.baseline_id=? ORDER BY e.created_at').all(row.id),owner=clientRow.owner_id===u.id;
  const lines=JSON.parse(row.lines).map(l=>{const mine=events.filter(e=>e.line_key===l.key),delivered=mine.filter(e=>e.kind==='delivery').reduce((n,e)=>n+e.quantity,0);
    const rounds={};for(const e of mine.filter(x=>x.kind==='revision'))rounds[e.item_reference]=(rounds[e.item_reference]??0)+e.quantity;
    return {...l,delivered,remaining:l.quantity-delivered,items_over_revisions:Object.values(rounds).filter(n=>n>l.revisions).length,over:delivered>l.quantity};});
  const open=events.filter(e=>e.over_scope&&!e.disposition);
  return {...row,client_name:clientRow.trade_name||clientRow.legal_name,is_owner:owner,lines,
    events:events.map(e=>({...e,disposition_by_name:name(db,e.disposition_by),line_name:lines.find(l=>l.key===e.line_key)?.name??'طلب خارج البنود',actions:e.over_scope&&!e.disposition&&owner?['decide_scope']:[]})),
    open_decisions:open.length,absorbed:events.filter(e=>e.disposition==='absorbed').length,change_requests:events.filter(e=>e.disposition==='change_request').length,
    actions:row.status==='active'?['record_scope',...(owner?['close_baseline']:[])]:[]};
}
export function createBaseline(db,supplied,input){
  writing(db);v.object(input,['client_id','name','contract_reference','lines','exclusions']);
  const {u,c}=clientFor(db,supplied,input.client_id,{owner:true});
  if(!Array.isArray(input.lines)||!input.lines.length||input.lines.length>40)fail(400,'lines','من بند إلى أربعين بندًا');
  const seen=new Set(),lines=input.lines.map((l,i)=>{v.object(l,['name','quantity','revisions']);const label=v.text(l.name,'اسم المخرج',160,2);if(seen.has(label))fail(400,'lines','البند مكرر');seen.add(label);
    if(!Number.isInteger(l.quantity)||l.quantity<1||l.quantity>10000)fail(400,'lines','الكمية من 1 إلى 10000');if(!Number.isInteger(l.revisions)||l.revisions<0||l.revisions>20)fail(400,'lines','جولات المراجعة من 0 إلى 20');return {key:`l${i+1}`,name:label,quantity:l.quantity,revisions:l.revisions};});
  const title=v.text(input.name,'اسم خط الأساس',180,3);
  if(db.prepare('SELECT 1 FROM scope_baselines WHERE client_id=? AND name=?').get(c.id,title))fail(409,'duplicate_baseline','لهذا العميل خط أساس بالاسم نفسه');
  const baselineId=id(),time=now();
  db.prepare("INSERT INTO scope_baselines(id,tenant_id,client_id,name,contract_reference,lines,exclusions,status,created_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,'active',?,?,?)").run(baselineId,u.tenant_id,c.id,title,v.text(input.contract_reference,'مرجع العقد أو العرض المعتمد',500,5),JSON.stringify(lines),input.exclusions?v.text(input.exclusions,'المستثنى من النطاق',2000,3):'',u.id,time,time);
  audit(db,u,'scope_baseline',baselineId,'scope.baseline_created',{}, {client:c.code});
  return {id:baselineId};
}
export function recordScope(db,supplied,baselineId,input){
  writing(db);const {u,c,row}=baselineRow(db,supplied,baselineId);
  v.object(input,['line_key','kind','quantity','item_reference','description']);
  if(row.status!=='active')fail(409,'invalid_state','خط الأساس مقفل');
  if(!['delivery','revision','new_ask'].includes(input.kind))fail(400,'kind','اختر نوع الحدث');
  if(!Number.isInteger(input.quantity)||input.quantity<1||input.quantity>1000)fail(400,'quantity','الكمية من 1 إلى 1000');
  const view=baselineView(db,u,row,c),reference=v.text(input.item_reference,'مرجع المخرج أو الطلب',300,3);
  let over=false,lineKey='';
  if(input.kind==='new_ask'){over=true;if(!(typeof input.description==='string'&&input.description.trim().length>=10))fail(400,'description','صف الطلب الجديد كما ورد من العميل');}
  else{
    const line=view.lines.find(l=>l.key===input.line_key);if(!line)fail(400,'line_key','البند ليس من خط الأساس. ما خارج البنود يُسجل «طلبًا جديدًا»');
    lineKey=line.key;
    if(input.kind==='delivery')over=line.delivered+input.quantity>line.quantity;
    else{const used=db.prepare("SELECT COALESCE(SUM(quantity),0) AS n FROM scope_events WHERE baseline_id=? AND line_key=? AND kind='revision' AND item_reference=?").get(row.id,line.key,reference).n;over=used+input.quantity>line.revisions;}
  }
  const eventId=id();
  db.prepare('INSERT INTO scope_events(id,baseline_id,line_key,kind,quantity,item_reference,description,over_scope,recorded_by,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)').run(eventId,row.id,lineKey,input.kind,input.quantity,reference,input.description?v.text(input.description,'الوصف',2000,3):'',over?1:0,u.id,now());
  audit(db,u,'scope_baseline',row.id,'scope.'+input.kind,{}, {over_scope:over});
  return {id:eventId,over_scope:over};
}
export function decideScope(db,supplied,eventId,input){
  writing(db);
  const e=typeof eventId==='string'&&db.prepare('SELECT * FROM scope_events WHERE id=?').get(eventId);if(!e)fail(404,'not_found','الحدث غير متاح');
  const {u,row}=baselineRow(db,supplied,e.baseline_id,{owner:true});
  v.object(input,['disposition','note']);
  if(!e.over_scope||e.disposition)fail(409,'invalid_state','لا قرار مطلوب على هذا الحدث');
  if(!['absorbed','change_request','declined'].includes(input.disposition))fail(400,'disposition','اختر القرار');
  db.prepare('UPDATE scope_events SET disposition=?,disposition_note=?,disposition_by=?,disposition_at=? WHERE id=?').run(input.disposition,v.text(input.note,input.disposition==='change_request'?'مرجع طلب التغيير المسعّر':input.disposition==='absorbed'?'لماذا نتحمله دون مقابل':'كيف أُبلغ العميل',1500,10),u.id,now(),e.id);
  audit(db,u,'scope_baseline',row.id,'scope.decided',{}, {disposition:input.disposition});
  return {id:e.id};
}
export function closeBaseline(db,supplied,baselineId,input){
  writing(db);const {u,c,row}=baselineRow(db,supplied,baselineId,{owner:true});
  v.object(input,['version','note']);versioned(row,input);
  if(row.status!=='active')fail(409,'invalid_state','خط الأساس مقفل');
  if(baselineView(db,u,row,c).open_decisions)fail(409,'open_decisions','أحداث خارج النطاق بلا قرار. يُبت فيها قبل الإقفال');
  v.text(input.note,'سبب الإقفال',1000,5);
  db.prepare("UPDATE scope_baselines SET status='closed',version=version+1,updated_at=? WHERE id=?").run(now(),row.id);
  audit(db,u,'scope_baseline',row.id,'scope.baseline_closed',{}, {},input.note.trim());
  return {id:row.id};
}

/* ───── اللوحات ───── */
function clientsOf(db,supplied){return memberClients(db,supplied);}
export function campaignsBoard(db,supplied){
  const clients=clientsOf(db,supplied),{u}=clients.length?clientFor(db,supplied,clients[0].id):{u:null},byId=new Map(clients.map(c=>[c.id,c]));
  const rows=clients.length?db.prepare(`SELECT * FROM campaigns WHERE client_id IN (${clients.map(()=>'?').join(',')}) ORDER BY status IN ('completed','cancelled'),start_date DESC LIMIT 200`).all(...clients.map(c=>c.id)):[];
  return {today:today(),channels:CHANNELS,clients:clients.map(c=>({id:c.id,name:c.trade_name||c.legal_name})),campaigns:rows.map(r=>campaignView(db,u,r,byId.get(r.client_id))),
    note:'النتائج والصرف تُدخل يدويًا مع مصدر كل رقم. لا ربط آلي بمنصات الإعلان في هذه النسخة.'};
}
export function contentBoard(db,supplied,month){
  const clients=clientsOf(db,supplied),{u}=clients.length?clientFor(db,supplied,clients[0].id):{u:null},m=typeof month==='string'&&/^\d{4}-(0[1-9]|1[0-2])$/.test(month)?month:today().slice(0,7);
  const from=`${m}-01`,to=`${m}-31`,ids=clients.map(c=>c.id),marks=ids.map(()=>'?').join(',');
  const rows=ids.length?db.prepare(`SELECT * FROM content_items WHERE client_id IN (${marks}) AND ((planned_date BETWEEN ? AND ?) OR (status NOT IN ('published','cancelled') AND planned_date<?)) ORDER BY planned_date,planned_time LIMIT 500`).all(...ids,from,to,from):[];
  const holidays=u?new Map(db.prepare("SELECT holiday_date,name FROM public_holidays WHERE tenant_id=? AND status='approved' AND holiday_date BETWEEN ? AND ?").all(u.tenant_id,from,to).map(h=>[h.holiday_date,h.name])):new Map();
  const byId=new Map(clients.map(c=>[c.id,c]));
  return {today:today(),month:m,channels:CHANNELS,formats:FORMATS,states:CONTENT_STATES,
    clients:clients.map(c=>({id:c.id,name:c.trade_name||c.legal_name,brands:db.prepare('SELECT id,name FROM client_brands WHERE client_id=? AND active=1 ORDER BY name').all(c.id),
      campaigns:db.prepare("SELECT id,name FROM campaigns WHERE client_id=? AND status NOT IN ('completed','cancelled') ORDER BY name").all(c.id),
      retainers:db.prepare('SELECT id,name,period_month,allowances FROM retainers WHERE client_id=? ORDER BY period_month DESC LIMIT 6').all(c.id).map(r=>({id:r.id,name:`${r.name} · ${r.period_month}`,types:JSON.parse(r.allowances).map(a=>a.type)}))})),
    items:rows.map(r=>({...contentView(db,u,r,holidays),client_name:byId.get(r.client_id).trade_name||byId.get(r.client_id).legal_name})),
    versions:u?bindableVersions(db,u):[],
    holidays:[...holidays].map(([date,label])=>({date,name:label})),
    note:'موافقة العميل هنا يسجلها الموظف مع مرجع دليلها؛ ليست توقيعًا من العميل داخل المنصة.'};
}
export function scopeBoard(db,supplied){
  const clients=clientsOf(db,supplied),{u}=clients.length?clientFor(db,supplied,clients[0].id):{u:null},byId=new Map(clients.map(c=>[c.id,c]));
  const rows=clients.length?db.prepare(`SELECT * FROM scope_baselines WHERE client_id IN (${clients.map(()=>'?').join(',')}) ORDER BY status,created_at DESC LIMIT 200`).all(...clients.map(c=>c.id)):[];
  return {clients:clients.filter(c=>u&&c.owner_id===u.id).map(c=>({id:c.id,name:c.trade_name||c.legal_name})),baselines:rows.map(r=>baselineView(db,u,r,byId.get(r.client_id))),
    note:'خط الأساس هو ما في العقد. ما زاد عنه لا يُمنع تسجيله، لكنه يحتاج قرار مسؤول الحساب: نتحمله، أو طلب تغيير مسعّر، أو اعتذار للعميل.'};
}
