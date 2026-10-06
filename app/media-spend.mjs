import { randomUUID } from 'node:crypto';
import { audit, now, hash } from './db.mjs';
import { fail } from './auth.mjs';
import * as v from './validation.mjs';
import { can } from './access.mjs';
import { currentUser } from './delegations.mjs';
import { clientFor, memberClients } from './agency.mjs';
import { CHANNELS } from './campaigns.mjs';
import { parseCsv } from './bank-reconciliation.mjs';
import { purchaseFor } from './procurement.mjs';
import { financeCapabilities } from './finance.mjs';
import { liveSpend } from './media-spend-ledger.mjs';

// الصرف الإعلامي: المخطط مقابل الفعلي. لا اتصال بأي منصة إعلانية: الفعلي يدخله موظف أو يستورده من ملف صدّره بنفسه.
// كل رقم بمصدره ومن أدخله ومتى. العتبات يضبطها مالك الحملة، والتجاوز ينبّه ويطلب إقرارًا مكتوبًا ولا يوقف حملة.
// صرف الوكالة نيابة عن العميل يُربط بأمر الشراء وفاتورة المورد في المشتريات؛ لا التزام ولا دفعة تُنشأ هنا.
export const EVIDENCE_KINDS={platform_screenshot:'لقطة من لوحة المنصة الإعلانية',account_statement:'كشف حساب',invoice:'فاتورة'};
export const FUNDING={client_direct:'العميل يدفع للمنصة مباشرة',agency_on_behalf:'الوكالة تدفع نيابة عن العميل ثم تفوتر'};
export const ACK_DECISIONS={continue:'نستمر كما هو',reduce:'نخفض الصرف اليومي',pause_requested:'نطلب إيقاف الحملة مؤقتًا (يُنفَّذ من شاشة الحملات)'};
export const PLAN_STATES={draft:'مسودة بانتظار الاعتماد',approved:'معتمدة',superseded:'حلّت محلها نسخة أحدث',discarded:'مهملة'};
export const DATE_FORMATS={'YYYY-MM-DD':'2026-09-30','DD/MM/YYYY':'30/09/2026','DD-MM-YYYY':'30-09-2026','MM/DD/YYYY':'09/30/2026'};
export const DELIMITERS={comma:{name:'فاصلة ,',char:','},semicolon:{name:'فاصلة منقوطة ;',char:';'},tab:{name:'مسافة جدولة (Tab)',char:'\t'},pipe:{name:'شرطة رأسية |',char:'|'}};
export const COLUMN_KEYS=[{key:'date',label:'تاريخ اليوم',required:true},{key:'amount',label:'المبلغ المصروف',required:true},{key:'campaign',label:'اسم الحملة في المنصة (للتصفية)',required:false},{key:'currency',label:'العملة',required:false}];
export const NOT_CONNECTED='لا اتصال بأي منصة إعلانية. الأرقام تُدخل يدويًا أو تُستورد من ملف CSV يصدّره المستخدم بنفسه من المنصة، وكل رقم يحمل مصدره ومن أدخله ومتى.';
const MAX_ROWS=5000,MAX_FILE_CHARS=2000000,MAX_MINOR=1000000000000;
const id=()=>randomUUID();
const today=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Riyadh',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const dayCount=(from,to)=>Math.round((Date.parse(to)-Date.parse(from))/86400000)+1;
const decimal=minor=>`${minor<0?'-':''}${Math.floor(Math.abs(minor)/100)}.${String(Math.abs(minor)%100).padStart(2,'0')}`;
const name=(db,userId)=>userId?db.prepare('SELECT name FROM users WHERE id=?').get(userId)?.name??null:null;
const channelName=key=>CHANNELS.find(c=>c.key===key)?.name??key;
function writing(db){if(!db.isTransaction)fail(500,'transaction_required','تتطلب كتابة الصرف الإعلامي معاملة قاعدة بيانات');}
function permitted(db,u){if(!can(db,u,'commercial.use',u.department_id))fail(403,'not_permitted','الصرف الإعلامي يحتاج تصريح «المبيعات والتسليم». اطلبه من مسؤول الصلاحيات');return u;}
// العزل بعضوية فريق الحساب أولًا (من agency)، ثم التصريح. من ليس في الفريق يرى «غير متاح» لا «ممنوع».
function team(db,supplied,clientId,options){const {u,c}=clientFor(db,supplied,clientId,options);permitted(db,u);return {u,c};}
function digits(value){return String(value??'').normalize('NFKC').replace(/[٠-٩۰-۹]/gu,c=>{const code=c.codePointAt(0);return String(code>=0x06F0?code-0x06F0:code-0x0660);});}
function money(value,label,{zero=false}={}){
  if(typeof value!=='string'||!/^(?:0|[1-9]\d{0,9})(?:\.\d{1,2})?$/.test(value))fail(400,'invalid_money',`${label}: مبلغ بخانتين عشريتين كحد أقصى`);
  const [whole,fraction='']=value.split('.'),minor=Number(BigInt(whole)*100n+BigInt(fraction.padEnd(2,'0')));
  if(minor<=0&&!zero)fail(400,'invalid_money',`${label}: مبلغ موجب`);return minor;
}
// مبلغ من ملف منصة: فواصل آلاف ورمز عملة وأرقام عربية تأتي كما هي.
function fileMoney(raw,label){
  const text=digits(raw).trim().replace(/[\s,٬]/gu,'').replace(/(?:SAR|SR|ر\.س|ريال)/giu,'');
  if(!/^\d{1,12}(?:\.\d+)?$/u.test(text))fail(400,'invalid_money',`${label}: مبلغ غير صالح «${String(raw).slice(0,40)}»`);
  // منصات الإعلان تصدّر كسورًا أطول من هللة؛ تُقرَّب إلى أقرب هللة ويُذكر ذلك في الشاشة.
  const minor=Math.round(Number(text)*100);if(minor>MAX_MINOR)fail(400,'invalid_money',`${label}: المبلغ يتجاوز الحد المحلي`);return minor;
}
function fileDate(raw,format,label){
  const text=digits(raw).trim().replace(/\s+/gu,'');
  const patterns={'YYYY-MM-DD':/^(\d{4})-(\d{1,2})-(\d{1,2})$/u,'DD/MM/YYYY':/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/u,'DD-MM-YYYY':/^(\d{1,2})-(\d{1,2})-(\d{4})$/u,'MM/DD/YYYY':/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/u};
  const m=patterns[format]?.exec(text);if(!m)fail(400,'invalid_date',`${label}: التاريخ «${String(raw).slice(0,40)}» لا يطابق الصيغة ${format}`);
  const [year,month,day]=format==='YYYY-MM-DD'?[m[1],m[2],m[3]]:format==='MM/DD/YYYY'?[m[3],m[1],m[2]]:[m[3],m[2],m[1]];
  return v.date(`${year}-${month.padStart(2,'0')}-${day.padStart(2,'0')}`);
}
const evidence=input=>{if(!Object.hasOwn(EVIDENCE_KINDS,input.evidence_kind))fail(400,'evidence_kind','اختر نوع المصدر: لقطة من لوحة المنصة، أو كشف حساب، أو فاتورة. رقم بلا مصدر لا يُقبل');return {kind:input.evidence_kind,reference:v.text(input.evidence_reference,'مرجع المصدر وأين حُفظ',600,5)};};
const funding=value=>{if(!Object.hasOwn(FUNDING,value))fail(400,'funding','حدد من يدفع للمنصة: العميل مباشرة أم الوكالة نيابة عنه');return value;};

/* ───── القراءة ───── */
function campaignOf(db,supplied,campaignId,options){
  const row=typeof campaignId==='string'&&db.prepare('SELECT * FROM campaigns WHERE id=?').get(campaignId);
  if(!row)fail(404,'not_found','الحملة غير متاحة');
  const {u,c}=team(db,supplied,row.client_id,options);if(row.tenant_id!==u.tenant_id)fail(404,'not_found','الحملة غير متاحة');
  return {u,c,campaign:row};
}
function planOf(db,supplied,planId){
  const plan=typeof planId==='string'&&db.prepare('SELECT * FROM media_plans WHERE id=?').get(planId);
  if(!plan)fail(404,'not_found','خطة الصرف غير متاحة');
  const {u,c,campaign}=campaignOf(db,supplied,plan.campaign_id);if(plan.tenant_id!==u.tenant_id)fail(404,'not_found','خطة الصرف غير متاحة');
  return {u,c,campaign,plan};
}
// السطور السارية للحملة عبر كل نسخ خطتها: ما لم يُصحَّح وما لم تُلغَ دفعته. تعديل الخطة لا يمحو ما صُرف قبلها.
function liveEntries(db,campaignId){
  return db.prepare(`SELECT e.*,l.channel,x.name AS recorded_by_name,i.status AS import_status,i.file_name FROM media_spend_entries e JOIN media_plans p ON p.id=e.plan_id JOIN media_plan_lines l ON l.id=e.line_id JOIN users x ON x.id=e.recorded_by LEFT JOIN media_spend_imports i ON i.id=e.import_id WHERE p.campaign_id=? ORDER BY e.spend_date,e.recorded_at`).all(campaignId)
    .map((e,_,all)=>({...e,superseded:all.some(o=>o.corrects_id===e.id),cancelled:e.import_status==='cancelled'}));
}
function thresholdsOf(db,campaignId){return db.prepare('SELECT * FROM media_spend_thresholds WHERE campaign_id=? ORDER BY threshold_bp').all(campaignId);}
export function pacingFor(lines,entries,date){
  const rows=lines.map(l=>{
    const total=dayCount(l.start_date,l.end_date),elapsed=Math.min(total,Math.max(0,dayCount(l.start_date,date)));
    const actual=entries.filter(e=>e.channel===l.channel).reduce((n,e)=>n+e.amount_minor,0),expected=Math.round(l.planned_minor*elapsed/total);
    return {...l,channel_name:channelName(l.channel),days_total:total,days_elapsed:elapsed,actual_minor:actual,expected_minor:expected,variance_minor:actual-expected,remaining_minor:l.planned_minor-actual,over_line:actual>l.planned_minor};
  });
  const sum=key=>rows.reduce((n,r)=>n+r[key],0),planned=new Set(lines.map(l=>l.channel));
  const unplanned=entries.filter(e=>!planned.has(e.channel)).reduce((n,e)=>n+e.amount_minor,0);
  return {lines:rows,planned_minor:sum('planned_minor'),expected_minor:sum('expected_minor'),actual_minor:sum('actual_minor')+unplanned,unplanned_minor:unplanned,variance_minor:sum('actual_minor')+unplanned-sum('expected_minor')};
}
function campaignView(db,u,campaign,client){
  const plans=db.prepare('SELECT * FROM media_plans WHERE campaign_id=? ORDER BY revision DESC').all(campaign.id),approved=plans.find(p=>p.status==='approved')??null,draft=plans.find(p=>p.status==='draft')??null;
  const linesOf=p=>db.prepare('SELECT * FROM media_plan_lines WHERE plan_id=? ORDER BY start_date,channel').all(p.id);
  // الساري من السجل الواحد (app/media-spend-ledger.mjs): هو نفسه ما يقرؤه R22 وقسم الصرف في تقرير العميل. القائمة الكاملة للعرض وحده.
  const all=liveEntries(db,campaign.id),live=liveSpend(db,campaign.id),own=campaign.owner_id===u.id,accountOwner=client.owner_id===u.id;
  const commitments=new Map(db.prepare('SELECT m.*,o.supplier_name,o.total_minor AS order_minor,i.supplier_reference FROM media_spend_commitments m JOIN media_spend_entries e ON e.id=m.entry_id JOIN media_plans p ON p.id=e.plan_id JOIN procurement_orders o ON o.purchase_id=m.purchase_id LEFT JOIN procurement_invoices i ON i.id=m.invoice_id WHERE p.campaign_id=?').all(campaign.id).map(m=>[m.entry_id,m]));
  const pacing=approved?pacingFor(linesOf(approved),live,today()):null;
  const thresholds=thresholdsOf(db,campaign.id).map(t=>({...t,percent:t.threshold_bp/100,set_by_name:name(db,t.set_by),live:!t.retired_at,actions:own&&!t.retired_at?['retire_threshold']:[]}));
  const acks=approved?db.prepare('SELECT * FROM media_spend_acknowledgements WHERE plan_id=? ORDER BY acknowledged_at').all(approved.id).map(a=>({...a,decision_name:ACK_DECISIONS[a.decision],acknowledged_by_name:name(db,a.acknowledged_by)})):[];
  const alerts=[];
  if(pacing){
    for(const t of thresholds.filter(x=>x.live)){
      const level=Math.round(pacing.planned_minor*t.threshold_bp/10000);
      if(pacing.actual_minor>=level)alerts.push({kind:'threshold',threshold_id:t.id,percent:t.percent,level_minor:level,acknowledgement:acks.find(a=>a.threshold_id===t.id)??null});
    }
    if(pacing.actual_minor>pacing.planned_minor)alerts.push({kind:'over_budget',threshold_id:null,percent:null,level_minor:pacing.planned_minor,acknowledgement:acks.find(a=>a.kind==='over_budget')??null});
  }
  const pending=alerts.filter(a=>!a.acknowledgement),onBehalf=live.filter(e=>e.funding==='agency_on_behalf');
  const billings=db.prepare('SELECT b.*,x.name AS recorded_by_name FROM media_spend_billings b JOIN media_plans p ON p.id=b.plan_id JOIN users x ON x.id=b.recorded_by WHERE p.campaign_id=? ORDER BY b.recorded_at').all(campaign.id);
  const total=rows=>rows.reduce((n,r)=>n+r.amount_minor,0),committed=total(onBehalf),billed=total(billings);
  const recordable=approved&&['live','paused','completed'].includes(campaign.status);
  const actions=[];
  if(!draft&&!['completed','cancelled'].includes(campaign.status)&&campaign.media_budget_minor>0)actions.push('prepare_plan');
  if(recordable)actions.push('record_spend','import_spend');
  if(own)actions.push('set_threshold');
  if(pending.length&&(own||accountOwner))actions.push('acknowledge_spend');
  if(approved&&onBehalf.length&&(own||accountOwner))actions.push('record_billing');
  const entryActions=e=>e.superseded||e.cancelled||!recordable?[]:['correct_spend',...(e.funding==='agency_on_behalf'&&!commitments.has(e.id)?['link_commitment']:[])];
  return {id:campaign.id,name:campaign.name,client_id:client.id,client_name:client.trade_name||client.legal_name,status:campaign.status,start_date:campaign.start_date,end_date:campaign.end_date,owner_name:name(db,campaign.owner_id),own,channels:JSON.parse(campaign.channels),
    client_budget_minor:campaign.media_budget_minor,budget_reference:campaign.budget_reference,
    plan:approved?{...approved,status_name:PLAN_STATES.approved,prepared_by_name:name(db,approved.prepared_by),approved_by_name:name(db,approved.approved_by)}:null,
    draft:draft?{...draft,status_name:PLAN_STATES.draft,prepared_by_name:name(db,draft.prepared_by),lines:linesOf(draft).map(l=>({...l,channel_name:channelName(l.channel)})),planned_minor:linesOf(draft).reduce((n,l)=>n+l.planned_minor,0),
      actions:draft.prepared_by===u.id?['edit_plan','discard_plan']:['approve_plan']}:null,
    revisions:plans.length,pacing,thresholds,alerts,pending_acknowledgements:pending.length,acknowledgements:acks,
    entries:all.map(e=>({...e,channel_name:channelName(e.channel),evidence_kind_name:EVIDENCE_KINDS[e.evidence_kind],funding_name:FUNDING[e.funding],commitment:commitments.get(e.id)??null,actions:entryActions(e)})),
    imports:db.prepare('SELECT i.*,x.name AS imported_by_name FROM media_spend_imports i JOIN media_plans p ON p.id=i.plan_id JOIN users x ON x.id=i.imported_by WHERE p.campaign_id=? ORDER BY i.imported_at DESC').all(campaign.id).map(i=>({...i,channel_name:channelName(i.channel),actions:i.status==='active'&&i.imported_by===u.id?['cancel_import']:[]})),
    // ما دفعته الوكالة بمالها مقابل ما فوترته للعميل: الفرق خسارة صامتة ما لم يُغلق.
    on_behalf:{committed_minor:committed,linked_minor:total(onBehalf.filter(e=>commitments.has(e.id))),unlinked_minor:total(onBehalf.filter(e=>!commitments.has(e.id))),billed_minor:billed,unbilled_minor:committed-billed,billings},
    actions};
}
export function mediaSpendBoard(db,supplied){
  const clients=memberClients(db,supplied);
  const u=permitted(db,currentUser(db,supplied));
  const byId=new Map(clients.map(c=>[c.id,c])),ids=clients.map(c=>c.id);
  const campaigns=ids.length?db.prepare(`SELECT * FROM campaigns WHERE tenant_id=? AND client_id IN (${ids.map(()=>'?').join(',')}) AND status<>'cancelled' ORDER BY status IN ('completed'),start_date DESC LIMIT 200`).all(u.tenant_id,...ids):[];
  const finance=financeCapabilities(db,u).includes('read');
  const claims=ids.length?db.prepare(`SELECT a.id,a.amount_minor,a.due_date,k.name AS case_name,l.client_id FROM ar_claims a JOIN client_links l ON l.case_id=a.case_id JOIN commercial_cases k ON k.id=a.case_id WHERE a.tenant_id=? AND a.status='approved' AND a.currency='SAR' AND l.client_id IN (${ids.map(()=>'?').join(',')}) ORDER BY a.due_date DESC LIMIT 200`).all(u.tenant_id,...ids):[];
  return {today:today(),currency:'SAR',user_id:u.id,channels:CHANNELS,evidence_kinds:EVIDENCE_KINDS,funding:FUNDING,ack_decisions:ACK_DECISIONS,date_formats:DATE_FORMATS,delimiters:DELIMITERS,column_keys:COLUMN_KEYS,
    campaigns:campaigns.map(c=>campaignView(db,u,c,byId.get(c.client_id))),
    profiles:db.prepare('SELECT * FROM media_import_profiles WHERE tenant_id=? ORDER BY channel,name').all(u.tenant_id).map(p=>({...p,active:!!p.active,columns:JSON.parse(p.columns),channel_name:channelName(p.channel),delimiter_name:DELIMITERS[p.delimiter].name,created_by_name:name(db,p.created_by),actions:p.active?['deactivate_profile']:[]})),
    // مبلغ الاستحقاق لمن يحمل تفويضًا ماليًا فقط؛ فريق الحساب يرى المرجع لا المبلغ.
    claims:claims.map(a=>({id:a.id,client_id:a.client_id,label:`${a.case_name} · استحقاق ${a.due_date}`,amount_minor:finance?Number(a.amount_minor):null})),
    purchases:db.prepare("SELECT o.purchase_id,o.supplier_name,o.total_minor,p.title FROM procurement_orders o JOIN procurement_purchases p ON p.id=o.purchase_id JOIN project_members m ON m.project_id=p.project_id AND m.user_id=? WHERE p.tenant_id=? AND p.status NOT IN ('rejected','cancelled') ORDER BY o.created_at DESC LIMIT 200").all(u.id,u.tenant_id)
      .map(o=>({...o,invoices:db.prepare('SELECT id,supplier_reference,amount_minor FROM procurement_invoices WHERE purchase_id=? ORDER BY created_at').all(o.purchase_id)})),
    can_create_profile:clients.length>0,
    note:`${NOT_CONNECTED} وتيرة الصرف تقارن الفعلي بما كان سيُصرف لو توزعت ميزانية كل قناة بالتساوي على أيامها؛ هي مرجع للمقارنة لا توقع. التنبيه لا يوقف حملة: بلوغ عتبة أو تجاوز الميزانية يطلب إقرارًا مكتوبًا من مالك الحملة، وقرار الإيقاف يبقى تجاريًا. مبالغ ملفات المنصات تُقرَّب إلى أقرب هللة.`};
}

/* ───── الخطة ───── */
function cleanLines(campaign,lines){
  if(!Array.isArray(lines)||!lines.length||lines.length>CHANNELS.length)fail(400,'lines','أدخل سطرًا واحدًا على الأقل، وسطرًا واحدًا لكل قناة');
  const allowed=JSON.parse(campaign.channels),seen=new Set();
  const clean=lines.map(l=>{
    v.object(l,['channel','start_date','end_date','planned','target_metric','target_value','target_unit']);
    if(!allowed.includes(l.channel))fail(400,'channel','القناة ليست من قنوات الحملة المعتمدة');
    if(seen.has(l.channel))fail(400,'lines','للقناة الواحدة سطر واحد في الخطة');seen.add(l.channel);
    const from=v.date(l.start_date),to=v.date(l.end_date);
    if(to<from||from<campaign.start_date||to>campaign.end_date)fail(400,'line_period','مدة كل سطر داخل مدة الحملة، ونهايتها بعد بدايتها');
    if(!Number.isInteger(l.target_value)||l.target_value<1||l.target_value>1e12)fail(400,'target_value','المستهدف عدد صحيح موجب');
    return {channel:l.channel,from,to,planned:money(l.planned,'الميزانية المخططة للقناة'),metric:v.text(l.target_metric,'المؤشر المستهدف',80,2),value:l.target_value,unit:v.text(l.target_unit,'وحدة القياس',40,1)};
  });
  const sum=clean.reduce((n,l)=>n+l.planned,0);
  // ميزانية الحملة هي ما اعتمده العميل بمرجعه؛ الخطة توزعها ولا تتجاوزها.
  if(sum>campaign.media_budget_minor)fail(409,'plan_exceeds_budget',`مجموع الخطة ${decimal(sum)} يتجاوز الميزانية الإعلامية المعتمدة من العميل ${decimal(campaign.media_budget_minor)}. عدّل ميزانية الحملة بمرجع اعتمادها أولًا`);
  return clean;
}
function writeLines(db,planId,lines,time){
  const insert=db.prepare('INSERT INTO media_plan_lines(id,plan_id,channel,start_date,end_date,planned_minor,target_metric,target_value,target_unit,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)');
  for(const l of lines)insert.run(id(),planId,l.channel,l.from,l.to,l.planned,l.metric,l.value,l.unit,time);
}
export function prepareMediaPlan(db,supplied,input){
  writing(db);v.object(input,['campaign_id','budget_reference','lines']);
  const {u,c,campaign}=campaignOf(db,supplied,input.campaign_id);
  if(['completed','cancelled'].includes(campaign.status))fail(409,'invalid_state','الحملة مقفلة أو ملغاة');
  if(!campaign.media_budget_minor)fail(409,'no_budget','الحملة بلا ميزانية إعلامية معتمدة من العميل');
  if(db.prepare("SELECT 1 FROM media_plans WHERE campaign_id=? AND status='draft'").get(campaign.id))fail(409,'draft_exists','للحملة مسودة خطة قائمة. عدّلها أو أهملها');
  const lines=cleanLines(campaign,input.lines),planId=id(),time=now(),revision=(db.prepare('SELECT MAX(revision) AS n FROM media_plans WHERE campaign_id=?').get(campaign.id).n??0)+1;
  db.prepare("INSERT INTO media_plans(id,tenant_id,campaign_id,client_id,revision,budget_reference,status,prepared_by,created_at,updated_at) VALUES(?,?,?,?,?,?,'draft',?,?,?)").run(planId,u.tenant_id,campaign.id,c.id,revision,v.text(input.budget_reference,'مرجع اعتماد توزيع الميزانية',500,5),u.id,time,time);
  writeLines(db,planId,lines,time);
  audit(db,u,'media_plan',planId,'media_plan.prepared',{}, {campaign_id:campaign.id,revision,planned_minor:lines.reduce((n,l)=>n+l.planned,0)});
  return {id:planId};
}
export function mediaPlanAction(db,supplied,planId,action,input){
  writing(db);const {u,campaign,plan}=planOf(db,supplied,planId);
  const fields={edit_plan:['budget_reference','lines'],approve_plan:['note'],discard_plan:['note']}[action];
  if(!fields)fail(404,'not_found','الإجراء غير متاح');
  v.object(input,['version',...fields]);v.version(input.version,plan.version);
  if(plan.status!=='draft')fail(409,'invalid_state','الخطة المعتمدة لا تُعدَّل؛ أعدّ نسخة جديدة تحل محلها');
  const time=now(),mine=plan.prepared_by===u.id;
  if(action==='approve_plan'){
    if(mine)fail(403,'self_approval','من أعدّ خطة الصرف لا يعتمدها');
    const note=v.text(input.note,'ما الذي راجعته قبل الاعتماد',1500,10);
    db.prepare("UPDATE media_plans SET status='superseded',version=version+1,updated_at=? WHERE campaign_id=? AND status='approved'").run(time,campaign.id);
    db.prepare("UPDATE media_plans SET status='approved',approved_by=?,approved_at=?,approval_note=?,version=version+1,updated_at=? WHERE id=?").run(u.id,time,note,time,plan.id);
    audit(db,u,'media_plan',plan.id,'media_plan.approved',{status:'draft'},{status:'approved',revision:plan.revision},note);
  }else{
    if(!mine)fail(403,'forbidden','يعدّل المسودة أو يهملها من أعدّها');
    if(action==='edit_plan'){
      const lines=cleanLines(campaign,input.lines);
      db.prepare('DELETE FROM media_plan_lines WHERE plan_id=?').run(plan.id);writeLines(db,plan.id,lines,time);
      db.prepare('UPDATE media_plans SET budget_reference=?,version=version+1,updated_at=? WHERE id=?').run(v.text(input.budget_reference,'مرجع اعتماد توزيع الميزانية',500,5),time,plan.id);
      audit(db,u,'media_plan',plan.id,'media_plan.edited',{version:plan.version},{planned_minor:lines.reduce((n,l)=>n+l.planned,0)});
    }else{
      const note=v.text(input.note,'سبب الإهمال',1000,5);
      db.prepare("UPDATE media_plans SET status='discarded',version=version+1,updated_at=? WHERE id=?").run(time,plan.id);
      audit(db,u,'media_plan',plan.id,'media_plan.discarded',{status:'draft'},{status:'discarded'},note);
    }
  }
  return {id:plan.id};
}

/* ───── الصرف الفعلي ───── */
function spendable(db,supplied,campaignId){
  const {u,c,campaign}=campaignOf(db,supplied,campaignId);
  if(!['live','paused','completed'].includes(campaign.status))fail(409,'invalid_state','يُسجَّل الصرف بعد إطلاق الحملة');
  const plan=db.prepare("SELECT * FROM media_plans WHERE campaign_id=? AND status='approved'").get(campaign.id);
  if(!plan)fail(409,'plan_required','لا خطة صرف معتمدة لهذه الحملة. الفعلي يُقاس على خطة معتمدة');
  return {u,c,campaign,plan};
}
function spendDate(campaign,value,label='تاريخ الصرف'){const date=v.date(value);if(date<campaign.start_date||date>today())fail(400,'spend_date',`${label}: بين بداية الحملة واليوم`);return date;}
export function recordMediaSpend(db,supplied,campaignId,input){
  writing(db);v.object(input,['channel','spend_date','amount','evidence_kind','evidence_reference','funding']);
  const {u,campaign,plan}=spendable(db,supplied,campaignId);
  const line=db.prepare('SELECT * FROM media_plan_lines WHERE plan_id=? AND channel=?').get(plan.id,input.channel);
  if(!line)fail(400,'channel','القناة ليست في الخطة المعتمدة. أضفها بنسخة جديدة من الخطة');
  const source=evidence(input),entryId=id(),amount=money(input.amount,'المبلغ المصروف');
  db.prepare("INSERT INTO media_spend_entries(id,tenant_id,plan_id,line_id,spend_date,amount_minor,evidence_kind,evidence_reference,entry_method,funding,recorded_by,recorded_at) VALUES(?,?,?,?,?,?,?,?,'manual',?,?,?)").run(entryId,u.tenant_id,plan.id,line.id,spendDate(campaign,input.spend_date),amount,source.kind,source.reference,funding(input.funding),u.id,now());
  audit(db,u,'media_spend',entryId,'media_spend.recorded',{}, {campaign_id:campaign.id,channel:line.channel,amount_minor:amount,evidence_kind:source.kind,funding:input.funding});
  return {id:entryId};
}
export function correctMediaSpend(db,supplied,entryId,input){
  writing(db);v.object(input,['amount','evidence_kind','evidence_reference','reason']);
  const old=typeof entryId==='string'&&db.prepare('SELECT e.*,p.campaign_id FROM media_spend_entries e JOIN media_plans p ON p.id=e.plan_id WHERE e.id=?').get(entryId);
  if(!old)fail(404,'not_found','سطر الصرف غير متاح');
  const {u,campaign}=spendable(db,supplied,old.campaign_id);
  if(old.tenant_id!==u.tenant_id)fail(404,'not_found','سطر الصرف غير متاح');
  if(db.prepare('SELECT 1 FROM media_spend_entries WHERE corrects_id=?').get(old.id))fail(409,'already_corrected','صُحح هذا السطر؛ صحّح السطر الأحدث');
  if(old.import_id&&db.prepare("SELECT 1 FROM media_spend_imports WHERE id=? AND status='cancelled'").get(old.import_id))fail(409,'batch_cancelled','دفعة هذا السطر ملغاة');
  if(db.prepare('SELECT 1 FROM media_spend_commitments WHERE entry_id=?').get(old.id))fail(409,'commitment_linked','السطر مربوط بأمر شراء. التصحيح المالي يجري في المشتريات أولًا');
  const source=evidence(input),amount=money(input.amount,'المبلغ الصحيح',{zero:true}),newId=id();
  // السطر المصحِّح يبقى على خطة السطر الأصلي وقناته وتاريخه؛ لا يتغير إلا المبلغ ومصدره.
  db.prepare("INSERT INTO media_spend_entries(id,tenant_id,plan_id,line_id,spend_date,amount_minor,evidence_kind,evidence_reference,entry_method,funding,corrects_id,correction_reason,recorded_by,recorded_at) VALUES(?,?,?,?,?,?,?,?,'manual',?,?,?,?,?)").run(newId,u.tenant_id,old.plan_id,old.line_id,old.spend_date,amount,source.kind,source.reference,old.funding,old.id,v.text(input.reason,'سبب التصحيح',1000,10),u.id,now());
  audit(db,u,'media_spend',newId,'media_spend.corrected',{entry_id:old.id,amount_minor:old.amount_minor},{amount_minor:amount,campaign_id:campaign.id},input.reason.trim());
  return {id:newId};
}

/* ───── تعيين الأعمدة والاستيراد ───── */
function cleanColumns(columns,headerRows){
  v.object(columns,COLUMN_KEYS.map(c=>c.key));const clean={};
  for(const {key,label} of COLUMN_KEYS){
    const value=columns[key];if(value===undefined||value===null||value==='')continue;
    if(typeof value==='number'){if(!Number.isInteger(value)||value<0||value>200)fail(400,'invalid_column',`${label}: رقم العمود من صفر إلى مئتين`);clean[key]=value;continue;}
    clean[key]=v.text(value,`عمود ${label}`,120,1);
    if(!headerRows)fail(400,'header_required',`${label}: تعيين العمود باسمه يحتاج ملفًا بترويسة. اختر رقم العمود بدل اسمه`);
  }
  if(clean.date===undefined||clean.amount===undefined)fail(400,'columns_required','يلزم تعيين عمودَي التاريخ والمبلغ');
  return clean;
}
export function saveMediaProfile(db,supplied,input){
  writing(db);v.object(input,['channel','name','delimiter','date_format','header_rows','columns']);
  const clients=memberClients(db,supplied),u=permitted(db,currentUser(db,supplied));
  if(!clients.length)fail(403,'forbidden','تعيين الأعمدة لمن هو في فريق حساب عميل');
  if(!CHANNELS.some(c=>c.key===input.channel))fail(400,'channel','اختر القناة');
  if(!Object.hasOwn(DELIMITERS,input.delimiter))fail(400,'delimiter','اختر الفاصل بين الأعمدة');
  if(!Object.hasOwn(DATE_FORMATS,input.date_format))fail(400,'date_format','اختر صيغة التاريخ كما تظهر في ملف المنصة');
  if(!Number.isInteger(input.header_rows)||input.header_rows<0||input.header_rows>20)fail(400,'header_rows','عدد أسطر الترويسة من صفر إلى عشرين');
  const columns=cleanColumns(input.columns,input.header_rows),label=v.text(input.name,'اسم التعيين',160,3);
  if(db.prepare('SELECT 1 FROM media_import_profiles WHERE tenant_id=? AND channel=? AND name=?').get(u.tenant_id,input.channel,label))fail(409,'duplicate_profile','لهذه القناة تعيين بالاسم نفسه');
  const profileId=id(),time=now();
  db.prepare('INSERT INTO media_import_profiles(id,tenant_id,channel,name,delimiter,date_format,header_rows,columns,created_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(profileId,u.tenant_id,input.channel,label,input.delimiter,input.date_format,input.header_rows,JSON.stringify(columns),u.id,time,time);
  audit(db,u,'media_import_profile',profileId,'media_profile.created',{}, {channel:input.channel,name:label,columns});
  return {id:profileId};
}
export function deactivateMediaProfile(db,supplied,profileId,input){
  writing(db);v.object(input,['version','note']);
  const clients=memberClients(db,supplied),u=permitted(db,currentUser(db,supplied));
  const profile=typeof profileId==='string'&&db.prepare('SELECT * FROM media_import_profiles WHERE id=? AND tenant_id=?').get(profileId,u.tenant_id);
  if(!profile||!clients.length)fail(404,'not_found','تعيين الأعمدة غير متاح');
  v.version(input.version,profile.version);if(!profile.active)fail(409,'already_inactive','التعيين موقوف');
  db.prepare('UPDATE media_import_profiles SET active=0,version=version+1,updated_at=? WHERE id=?').run(now(),profile.id);
  audit(db,u,'media_import_profile',profile.id,'media_profile.deactivated',{active:1},{active:0},v.text(input.note,'سبب الإيقاف',1000,5));
  return {id:profile.id};
}
function readRows(content,profile,campaign,filter){
  const columns=JSON.parse(profile.columns),table=parseCsv(content.replace(/^﻿/u,''),DELIMITERS[profile.delimiter].char);
  const header=profile.header_rows?table[profile.header_rows-1]?.map(c=>digits(c).trim().toLowerCase()):null;
  const at=(row,key)=>{const spec=columns[key];if(spec===undefined)return undefined;if(typeof spec==='number')return row[spec];
    const index=header?.indexOf(digits(spec).trim().toLowerCase())??-1;if(index<0)fail(400,'column_missing',`عمود «${spec}» غير موجود في ترويسة الملف`);return row[index];};
  const body=table.slice(profile.header_rows);
  if(!body.length)fail(400,'empty_file','لا سطور بعد الترويسة');
  if(body.length>MAX_ROWS)fail(400,'too_many_rows',`عدد السطور يتجاوز ${MAX_ROWS}. صدّر فترة أقصر`);
  const rows=[];let skippedOther=0,skippedZero=0;
  body.forEach((row,index)=>{
    const lineNo=index+1,label=`السطر ${lineNo}`;
    // ملف المنصة يحمل عادة كل حملات الحساب الإعلاني: ما ليس لهذه الحملة يُتجاوز ويُعدّ، ولا يُنسب إليها.
    if(columns.campaign!==undefined&&String(at(row,'campaign')??'').trim()!==filter){skippedOther++;return;}
    if(columns.currency!==undefined&&digits(at(row,'currency')).trim().toUpperCase()!=='SAR')fail(400,'currency',`${label}: العملة «${String(at(row,'currency')).slice(0,12)}» ليست SAR. لا تحويل عملات في المنصة؛ صدّر الملف بالريال`);
    const amount=fileMoney(at(row,'amount'),`${label}: المبلغ`);if(!amount){skippedZero++;return;}
    rows.push({line_no:lineNo,spend_date:spendDate(campaign,fileDate(at(row,'date'),profile.date_format,label),label),amount_minor:amount});
  });
  if(!rows.length)fail(400,'no_rows',columns.campaign!==undefined?`لا سطر في الملف يطابق اسم الحملة «${filter}»`:'لا سطر بمبلغ في الملف');
  return {rows,skippedOther,skippedZero};
}
export function importMediaSpend(db,supplied,campaignId,input){
  writing(db);v.object(input,['profile_id','file_name','content','campaign_match','evidence_kind','evidence_reference','funding']);
  const {u,campaign,plan}=spendable(db,supplied,campaignId);
  const profile=typeof input.profile_id==='string'&&db.prepare('SELECT * FROM media_import_profiles WHERE id=? AND tenant_id=?').get(input.profile_id,u.tenant_id);
  if(!profile)fail(404,'not_found','تعيين الأعمدة غير متاح');
  if(!profile.active)fail(409,'profile_inactive','التعيين موقوف. اختر تعيينًا ساريًا');
  const line=db.prepare('SELECT * FROM media_plan_lines WHERE plan_id=? AND channel=?').get(plan.id,profile.channel);
  if(!line)fail(400,'channel',`قناة التعيين (${channelName(profile.channel)}) ليست في الخطة المعتمدة لهذه الحملة`);
  if(typeof input.content!=='string'||!input.content.trim())fail(400,'empty_file','الملف فارغ');
  if(input.content.length>MAX_FILE_CHARS)fail(400,'file_too_large','حجم الملف يتجاوز الحد المحلي. صدّر فترة أقصر');
  const source=evidence(input),paidBy=funding(input.funding),digest=hash(input.content);
  const twin=db.prepare('SELECT file_name,imported_at FROM media_spend_imports WHERE tenant_id=? AND file_digest=?').get(u.tenant_id,digest);
  if(twin)fail(409,'duplicate_file',`محتوى الملف نفسه مستورد سابقًا باسم «${twin.file_name}» بتاريخ ${twin.imported_at.slice(0,10)}`);
  const needsFilter=JSON.parse(profile.columns).campaign!==undefined,filter=needsFilter?v.text(input.campaign_match,'اسم الحملة كما يظهر في ملف المنصة',300,1):'';
  const {rows,skippedOther,skippedZero}=readRows(input.content,profile,campaign,filter);
  // ملفان مختلفان بفترتين متداخلتين يضاعفان الصرف دون أن تتطابق البصمة.
  const taken=new Set(liveEntries(db,campaign.id).filter(e=>!e.superseded&&!e.cancelled&&e.channel===profile.channel&&e.entry_method==='file_import').map(e=>e.spend_date));
  const overlap=[...new Set(rows.map(r=>r.spend_date).filter(d=>taken.has(d)))].sort();
  if(overlap.length)fail(409,'overlapping_import',`أيام مستوردة سابقًا لهذه القناة: ${overlap.slice(0,8).join('، ')}${overlap.length>8?' …':''}. ألغِ الدفعة السابقة أو صدّر فترة لا تتداخل`);
  const manual=new Set(liveEntries(db,campaign.id).filter(e=>!e.superseded&&e.channel===profile.channel&&e.entry_method==='manual').map(e=>e.spend_date));
  const importId=id(),time=now(),total=rows.reduce((n,r)=>n+r.amount_minor,0);
  db.prepare('INSERT INTO media_spend_imports(id,tenant_id,plan_id,profile_id,channel,file_name,file_digest,evidence_kind,evidence_reference,row_count,total_minor,imported_by,imported_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)').run(importId,u.tenant_id,plan.id,profile.id,profile.channel,v.text(input.file_name,'اسم الملف',260,3),digest,source.kind,source.reference,rows.length,total,u.id,time);
  const insert=db.prepare("INSERT INTO media_spend_entries(id,tenant_id,plan_id,line_id,spend_date,amount_minor,evidence_kind,evidence_reference,entry_method,import_id,import_line_no,funding,recorded_by,recorded_at) VALUES(?,?,?,?,?,?,?,?,'file_import',?,?,?,?,?)");
  for(const r of rows)insert.run(id(),u.tenant_id,plan.id,line.id,r.spend_date,r.amount_minor,source.kind,source.reference,importId,r.line_no,paidBy,u.id,time);
  audit(db,u,'media_spend_import',importId,'media_spend.imported',{}, {campaign_id:campaign.id,channel:profile.channel,file_digest:digest,row_count:rows.length,total_minor:total,skipped_other_campaigns:skippedOther,skipped_zero:skippedZero});
  return {id:importId,row_count:rows.length,total_minor:total,skipped_other_campaigns:skippedOther,skipped_zero:skippedZero,manual_overlap_dates:[...new Set(rows.map(r=>r.spend_date).filter(d=>manual.has(d)))].sort()};
}
export function cancelMediaImport(db,supplied,importId,input){
  writing(db);v.object(input,['version','reason']);
  const batch=typeof importId==='string'&&db.prepare('SELECT i.*,p.campaign_id FROM media_spend_imports i JOIN media_plans p ON p.id=i.plan_id WHERE i.id=?').get(importId);
  if(!batch)fail(404,'not_found','الدفعة غير متاحة');
  const {u}=campaignOf(db,supplied,batch.campaign_id);if(batch.tenant_id!==u.tenant_id)fail(404,'not_found','الدفعة غير متاحة');
  v.version(input.version,batch.version);
  if(batch.status!=='active')fail(409,'already_cancelled','الدفعة ملغاة');
  if(batch.imported_by!==u.id)fail(403,'forbidden','يلغي الدفعة من استوردها');
  if(db.prepare('SELECT 1 FROM media_spend_commitments m JOIN media_spend_entries e ON e.id=m.entry_id WHERE e.import_id=?').get(batch.id))fail(409,'commitment_linked','سطر من هذه الدفعة مربوط بأمر شراء. لا تُسحب دفعة بُني عليها ربط مالي');
  const reason=v.text(input.reason,'سبب الإلغاء',2000,10),time=now();
  db.prepare("UPDATE media_spend_imports SET status='cancelled',cancelled_by=?,cancelled_at=?,cancel_reason=?,version=version+1 WHERE id=?").run(u.id,time,reason,batch.id);
  audit(db,u,'media_spend_import',batch.id,'media_spend.import_cancelled',{status:'active'},{status:'cancelled'},reason);
  return {id:batch.id,status:'cancelled'};
}

/* ───── العتبات والإقرار ───── */
export function setThreshold(db,supplied,campaignId,input){
  writing(db);v.object(input,['percent','basis']);
  const {u,campaign}=campaignOf(db,supplied,campaignId);
  if(campaign.owner_id!==u.id)fail(403,'forbidden','عتبات التنبيه يضبطها مالك الحملة');
  if(typeof input.percent!=='string'||!/^(?:[1-9]\d{0,2})(?:\.\d{1,2})?$/.test(input.percent))fail(400,'percent','النسبة من الميزانية المخططة رقم موجب بخانتين عشريتين كحد أقصى، مثل 80 أو 92.5');
  const bp=Math.round(Number(input.percent)*100);
  if(db.prepare('SELECT 1 FROM media_spend_thresholds WHERE campaign_id=? AND threshold_bp=? AND retired_at IS NULL').get(campaign.id,bp))fail(409,'duplicate_threshold','هذه العتبة مضبوطة للحملة');
  const thresholdId=id();
  db.prepare('INSERT INTO media_spend_thresholds(id,tenant_id,campaign_id,threshold_bp,basis,set_by,set_at) VALUES(?,?,?,?,?,?,?)').run(thresholdId,u.tenant_id,campaign.id,bp,v.text(input.basis,'لماذا هذه العتبة ومن اتفق عليها',1000,10),u.id,now());
  audit(db,u,'media_threshold',thresholdId,'media_threshold.set',{}, {campaign_id:campaign.id,threshold_bp:bp});
  return {id:thresholdId};
}
export function retireThreshold(db,supplied,thresholdId,input){
  writing(db);v.object(input,['version','reason']);
  const t=typeof thresholdId==='string'&&db.prepare('SELECT * FROM media_spend_thresholds WHERE id=?').get(thresholdId);
  if(!t)fail(404,'not_found','العتبة غير متاحة');
  const {u,campaign}=campaignOf(db,supplied,t.campaign_id);if(t.tenant_id!==u.tenant_id)fail(404,'not_found','العتبة غير متاحة');
  if(campaign.owner_id!==u.id)fail(403,'forbidden','عتبات التنبيه يضبطها مالك الحملة');
  v.version(input.version,t.version);if(t.retired_at)fail(409,'already_retired','العتبة موقوفة');
  const reason=v.text(input.reason,'سبب إيقاف العتبة',1000,5);
  db.prepare('UPDATE media_spend_thresholds SET retired_by=?,retired_at=?,retire_reason=?,version=version+1 WHERE id=?').run(u.id,now(),reason,t.id);
  audit(db,u,'media_threshold',t.id,'media_threshold.retired',{threshold_bp:t.threshold_bp},{retired:true},reason);
  return {id:t.id};
}
export function acknowledgeSpend(db,supplied,campaignId,input){
  writing(db);v.object(input,['kind','threshold_id','decision','note']);
  const {u,c,campaign}=campaignOf(db,supplied,campaignId);
  if(campaign.owner_id!==u.id&&c.owner_id!==u.id)fail(403,'forbidden','الإقرار لمالك الحملة أو مسؤول الحساب: القرار تجاري');
  const view=campaignView(db,u,campaign,c),alert=view.alerts.find(a=>a.kind===input.kind&&(a.threshold_id??'')===(input.threshold_id??''));
  if(!alert)fail(409,'not_crossed','لا عتبة بُلغت ولا ميزانية تُجووزت بهذا الوصف');
  if(alert.acknowledgement)fail(409,'already_acknowledged','سُجّل الإقرار على هذا التنبيه');
  if(!Object.hasOwn(ACK_DECISIONS,input.decision))fail(400,'decision','اختر ما تقرر');
  const ackId=id(),note=v.text(input.note,'الإقرار المكتوب: ما الذي علمتَه وما الذي قررتَه ومع من',2000,20);
  db.prepare('INSERT INTO media_spend_acknowledgements(id,tenant_id,plan_id,kind,threshold_id,observed_minor,planned_minor,decision,note,acknowledged_by,acknowledged_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(ackId,u.tenant_id,view.plan.id,alert.kind,alert.threshold_id,view.pacing.actual_minor,view.pacing.planned_minor,input.decision,note,u.id,now());
  // الإقرار يسجل القرار ولا ينفذه: الإيقاف المؤقت فعل مستقل في شاشة الحملات.
  audit(db,u,'media_plan',view.plan.id,'media_spend.acknowledged',{}, {kind:alert.kind,threshold_id:alert.threshold_id,observed_minor:view.pacing.actual_minor,decision:input.decision},note);
  return {id:ackId};
}

/* ───── الصرف نيابة عن العميل: الربط بالمسار المالي القائم ───── */
export function linkCommitment(db,supplied,entryId,input){
  writing(db);v.object(input,['purchase_id','invoice_id','note']);
  const entry=typeof entryId==='string'&&db.prepare('SELECT e.*,p.campaign_id FROM media_spend_entries e JOIN media_plans p ON p.id=e.plan_id WHERE e.id=?').get(entryId);
  if(!entry)fail(404,'not_found','سطر الصرف غير متاح');
  const {u}=campaignOf(db,supplied,entry.campaign_id);if(entry.tenant_id!==u.tenant_id)fail(404,'not_found','سطر الصرف غير متاح');
  if(entry.funding!=='agency_on_behalf')fail(409,'not_on_behalf','العميل دفع هذا الصرف مباشرة؛ ليس التزامًا على الوكالة');
  if(db.prepare('SELECT 1 FROM media_spend_entries WHERE corrects_id=?').get(entry.id))fail(409,'already_corrected','صُحح هذا السطر؛ اربط السطر الأحدث');
  if(db.prepare('SELECT 1 FROM media_spend_commitments WHERE entry_id=?').get(entry.id))fail(409,'already_linked','السطر مربوط بأمر شراء');
  // نطاق الرؤية نطاق المشتريات نفسه: لا يُربط بأمر لا يراه صاحبه هناك.
  const {p}=purchaseFor(db,u,input.purchase_id),order=db.prepare('SELECT * FROM procurement_orders WHERE purchase_id=?').get(p.id);
  if(!order||['rejected','cancelled'].includes(p.status))fail(409,'order_required','الربط بأمر شراء داخلي معتمد وقائم');
  let invoiceId=null;
  if(input.invoice_id){const invoice=db.prepare('SELECT id FROM procurement_invoices WHERE id=? AND purchase_id=?').get(input.invoice_id,p.id);if(!invoice)fail(400,'invoice_id','الفاتورة ليست من فواتير هذا الأمر');invoiceId=invoice.id;}
  const linked=db.prepare('SELECT COALESCE(SUM(e.amount_minor),0) AS n FROM media_spend_commitments m JOIN media_spend_entries e ON e.id=m.entry_id WHERE m.purchase_id=?').get(p.id).n;
  if(linked+entry.amount_minor>order.total_minor)fail(409,'commitment_exceeds_order',`الصرف المربوط بهذا الأمر (${decimal(linked+entry.amount_minor)}) يتجاوز قيمته المعتمدة (${decimal(order.total_minor)}). الزيادة تحتاج تعديل الأمر في المشتريات`);
  const linkId=id();
  db.prepare('INSERT INTO media_spend_commitments(id,tenant_id,entry_id,purchase_id,invoice_id,note,linked_by,linked_at) VALUES(?,?,?,?,?,?,?,?)').run(linkId,u.tenant_id,entry.id,p.id,invoiceId,v.text(input.note,'ما الذي يغطيه الأمر من هذا الصرف',1000,5),u.id,now());
  audit(db,u,'media_spend',entry.id,'media_spend.commitment_linked',{}, {purchase_id:p.id,invoice_id:invoiceId,amount_minor:entry.amount_minor});
  return {id:linkId};
}
export function recordBilling(db,supplied,campaignId,input){
  writing(db);v.object(input,['claim_id','amount','note']);
  const {u,c,campaign}=campaignOf(db,supplied,campaignId);
  if(campaign.owner_id!==u.id&&c.owner_id!==u.id)fail(403,'forbidden','يسجل ما فُوتر للعميل مالك الحملة أو مسؤول الحساب');
  const plan=db.prepare("SELECT * FROM media_plans WHERE campaign_id=? AND status='approved'").get(campaign.id);
  if(!plan)fail(409,'plan_required','لا خطة صرف معتمدة لهذه الحملة');
  // الاستحقاق يجب أن يكون لهذا العميل نفسه: سجل تجاري مرتبط بملفه، ومعتمد في مسار الذمم.
  const claim=typeof input.claim_id==='string'&&db.prepare("SELECT a.* FROM ar_claims a JOIN client_links l ON l.case_id=a.case_id WHERE a.id=? AND a.tenant_id=? AND l.client_id=? AND a.status='approved' AND a.currency='SAR'").get(input.claim_id,u.tenant_id,c.id);
  if(!claim)fail(404,'not_found','الاستحقاق غير متاح: يلزم استحقاق معتمد بالريال على سجل تجاري مرتبط بهذا العميل');
  if(db.prepare('SELECT 1 FROM media_spend_billings b JOIN media_plans p ON p.id=b.plan_id WHERE p.campaign_id=? AND b.claim_id=?').get(campaign.id,claim.id))fail(409,'already_recorded','هذا الاستحقاق مسجل على الحملة');
  const amount=money(input.amount,'ما يخص الصرف الإعلامي من الاستحقاق'),used=db.prepare('SELECT COALESCE(SUM(amount_minor),0) AS n FROM media_spend_billings WHERE claim_id=?').get(claim.id).n;
  if(used+amount>Number(claim.amount_minor))fail(409,'billing_exceeds_claim','المنسوب إلى الصرف الإعلامي يتجاوز قيمة الاستحقاق');
  const billingId=id();
  db.prepare('INSERT INTO media_spend_billings(id,tenant_id,plan_id,claim_id,amount_minor,note,recorded_by,recorded_at) VALUES(?,?,?,?,?,?,?,?)').run(billingId,u.tenant_id,plan.id,claim.id,amount,v.text(input.note,'أي بند في الاستحقاق يغطي الصرف الإعلامي',1000,10),u.id,now());
  audit(db,u,'media_plan',plan.id,'media_spend.billing_recorded',{}, {claim_id:claim.id,amount_minor:amount});
  return {id:billingId};
}
