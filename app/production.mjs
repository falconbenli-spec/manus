import { randomUUID } from 'node:crypto';
import { audit, now } from './db.mjs';
import { fail } from './auth.mjs';
import * as v from './validation.mjs';
import { currentUser } from './delegations.mjs';
import { can } from './access.mjs';
import { hijri } from './dates.mjs';
import { documentFooter, SYNTHETIC } from './tenant-identity.mjs';
import { refuse } from './refusal.mjs';
import { personName } from './people-read.mjs';
import { BOOKING_STATES } from './equipment.mjs';
import { ROUTE_STATUS } from './review-rounds.mjs';

// الإنتاج والتصوير. ما هنا سجل عمل لا واجهة لأي جهة خارجية:
// لا طقس آلي ولا خرائط آلية ولا رابط مشاركة عام، ولا توقيع إلكتروني على تصاريح استخدام الصورة.
// المستقل الخارجي مورد في «الموردون»، ومستحقه يمر بدورة المشتريات والمدفوعات؛ لا دفع من هذه الشاشة.
// أجر الموظف الداخلي وتكلفته لا يظهران هنا إطلاقًا ولا يُخزنان في جداول هذه الوحدة.

export const KINDS=[['ad','إعلان'],['social','محتوى اجتماعي'],['corporate','فيديو مؤسسي'],['stills','تصوير ثابت']].map(([key,name])=>({key,name}));
export const STATES={planning:'تحضير',in_production:'قيد التصوير',wrapped:'انتهى التصوير',closed:'مقفل',cancelled:'ملغى'};
export const CREW_ROLES=[['director','مخرج'],['photographer','مصور'],['camera_assistant','مساعد كاميرا'],['lighting_assistant','مساعد إضاءة'],['sound','صوت'],['editor','مونتير'],['colorist','مصحح ألوان'],['stylist','ستايلست'],['makeup','مكياج'],['drone_operator','مشغل درون'],['production_assistant','مساعد إنتاج'],['other','دور آخر']].map(([key,name])=>({key,name}));
export const TALENT_KINDS=[['actor','ممثل'],['model','عارض'],['voice','صوت'],['presenter','مقدم'],['extra','كومبارس'],['child','قاصر']].map(([key,name])=>({key,name}));
export const RELEASE_STATES={not_signed:'لم يُوقَّع',signed:'موقّع',expired:'انتهت مدته',refused:'رفض التوقيع'};
export const PERMIT_STATES={not_required:'لا يتطلب تصريحًا (قرار المنتج)',pending:'قيد الطلب',obtained:'صدر',refused:'رُفض'};
export const SHOT_SIZES=[['extreme_wide','لقطة بعيدة جدًا'],['wide','بعيدة'],['medium','متوسطة'],['close','قريبة'],['extreme_close','قريبة جدًا'],['over_shoulder','من فوق الكتف'],['two_shot','لشخصين'],['insert','تفصيلية']].map(([key,name])=>({key,name}));
export const CAMERA_ANGLES=[['eye_level','مستوى النظر'],['high','مرتفعة'],['low','منخفضة'],['overhead','علوية'],['dutch','مائلة'],['pov','وجهة نظر'],['tracking','متتبعة']].map(([key,name])=>({key,name}));
export const SHOT_STATES={planned:'مخططة',shot:'صُوِّرت',reshoot:'أُعيدت'};
export const CALL_SHEET_STATES={draft:'مسودة',issued:'صادرة',superseded:'استُبدلت بنسخة أحدث',cancelled:'ملغاة'};
export const INVITEE_STATES={sent:'أُرسل',viewed:'اطّلع',confirmed:'أكّد',declined:'اعتذر'};

const id=()=>randomUUID();
const today=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Riyadh',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const label=(list,key)=>list.find(x=>x.key===key)?.name??key;
const userName=(db,userId)=>userId?db.prepare('SELECT name FROM users WHERE id=?').get(userId)?.name??null:null;
const TIME=/^([01]\d|2[0-3]):[0-5]\d$/;
// المعدات الطالعة على الإنتاج أو المحجوزة له (الترحيل 193): المسلَّمة أولًا، ثم المحجوزة. من كيان الإنتاج نفسه.
const liveEquipment=(db,row)=>db.prepare(`SELECT b.id,b.status,b.custodian_id,b.start_date,b.end_date,i.code,i.name FROM equipment_bookings b
  JOIN equipment_items i ON i.id=b.item_id WHERE b.production_id=? AND b.tenant_id=? AND b.status IN ('reserved','out') ORDER BY b.status='out' DESC,i.code,b.start_date`).all(row.id,row.tenant_id);

// المعالجة التي يصوّرها الإنتاج (الترحيل 188): مسار مراجعة على نسخة مخرج من الاستوديو، ومنها تُقرأ النسخة وبصمتها وعمل الاستوديو.
const treatmentOf=(db,routeId)=>routeId?db.prepare(`SELECT r.id,r.name,r.status,r.owner_id,r.tenant_id,r.output_version_id,r.output_revision,r.output_digest,ver.snapshot,
  w.title AS studio_title,w.project_id AS studio_project_id,w.client_id AS studio_client_id,w.campaign_id AS studio_campaign_id
  FROM review_routes r JOIN studio_output_versions ver ON ver.id=r.output_version_id JOIN studio_workspaces w ON w.id=r.studio_id WHERE r.id=?`).get(routeId)??null:null;
const APPROVED_ROUTE=['approved','approved_with_changes'];
// جاهزية التصوير (PRO-01 وPRO-03): المعالجة موافَق عليها، ولمشروع الإنتاج مخصص معتمد ساري يغطي مدة التصوير (أو يوم الورقة)،
// وتصريح موقع الورقة اللازم صادر وساري يوم التصوير. كل ناقص يُسمّى بما هو ولماذا ومن يملكه، ولا رقم ميزانية يُعرض.
function shootReadiness(db,row,{date=null,location=null}={}){
  const missing=[],producer=personName(db,row.producer_id)??'منتج العمل',treatment=treatmentOf(db,row.review_route_id);
  if(!treatment)missing.push({doc_key:'treatment',document:'معالجة معتمدة: مسار مراجعة موافق على نسخة المخرج اللي يصوّره الإنتاج',why:'ما فيه معالجة مربوطة بالإنتاج',owner:producer,owner_role:'producer'});
  else if(!APPROVED_ROUTE.includes(treatment.status))missing.push({doc_key:'treatment',document:`موافقة مسار «${treatment.name}» على النسخة ${treatment.output_revision}`,
    why:treatment.status==='running'?'مسار المراجعة للحين جارٍ، وما صدر قراره':`المسار ${ROUTE_STATUS[treatment.status]}`,owner:personName(db,treatment.owner_id)??'مالك ملف المراجعة',owner_role:'review_owner'});
  const from=date??row.shoot_from,to=date??row.shoot_to,period=from===to?`يوم ${from}`:`التصوير من ${from} لين ${to}`;
  if(!row.project_id)missing.push({doc_key:'budget',document:`مخصص مشروع معتمد يغطي ${period}`,why:'الإنتاج بلا مشروع، وميزانيته مخصص مشروعه',owner:producer,owner_role:'producer'});
  else if(!db.prepare("SELECT 1 FROM project_budgets WHERE project_id=? AND tenant_id=? AND status='active' AND valid_from<=? AND valid_until>=?").get(row.project_id,row.tenant_id,from,to))
    missing.push({doc_key:'budget',document:`مخصص معتمد لمشروع «${db.prepare('SELECT name FROM projects WHERE id=?').get(row.project_id)?.name??''}» يغطي ${period}`,
      why:'ما فيه مخصص ساري بالاعتماد يغطي المدة',owner:'المالية: معدّ مخصص المشروع ومراجعه',owner_role:'finance'});
  if(location?.permit_required){
    const permit=`تصريح التصوير لموقع «${location.name}»`;
    if(location.permit_status!=='obtained')missing.push({doc_key:'permit',document:permit,why:`حالته: ${PERMIT_STATES[location.permit_status]}`,owner:producer,owner_role:'producer'});
    else if(location.permit_expires_on&&location.permit_expires_on<date)missing.push({doc_key:'permit',document:permit,why:`انتهى في ${location.permit_expires_on} قبل يوم التصوير ${date}`,owner:producer,owner_role:'producer'});
  }
  return {ready:!missing.length,missing};
}
function actor(db,supplied){const c=currentUser(db,supplied);if(!c)fail(403,'forbidden','الحساب غير متاح');return c;}
function writing(db){if(!db.isTransaction)fail(500,'transaction_required','تتطلب كتابة سجلات الإنتاج معاملة قاعدة بيانات');}
function manages(db,u){if(!can(db,u,'production.manage'))fail(403,'not_permitted','لا يوجد تصريح لوحدة الإنتاج. اطلبه من مسؤول الصلاحيات');}
function versioned(row,input){if(!Number.isInteger(input?.version)||input.version!==row.version)fail(409,'stale_version','تغير السجل منذ فتحه. أعد التحميل');}
const optional=(value,labelText,max)=>value===undefined||value===null||value===''?'':v.text(value,labelText,max);
const choose=(list,key,labelText)=>{if(!list.some(x=>x.key===key))fail(400,'invalid_choice',`${labelText}: اختيار غير متاح`);return key;};
function clock(value,labelText,{required=true}={}){
  if(!required&&(value===undefined||value===null||value===''))return '';
  if(typeof value!=='string'||!TIME.test(value))fail(400,'invalid_time',`${labelText}: الوقت بصيغة 07:30`);
  return value;
}
function dayRate(value){
  if(typeof value!=='string'||!/^(?:[1-9]\d{0,6})(?:\.\d{1,2})?$/.test(value))fail(400,'invalid_money','معدل اليوم: مبلغ موجب بخانتين عشريتين كحد أقصى');
  const [whole,fraction='']=value.split('.');return Number(BigInt(whole)*100n+BigInt(fraction.padEnd(2,'0')));
}

/* ───── المشروع الإنتاجي ───── */
function productionRow(db,supplied,productionId){
  const u=actor(db,supplied);manages(db,u);
  const row=typeof productionId==='string'&&db.prepare('SELECT * FROM productions WHERE id=? AND tenant_id=?').get(productionId,u.tenant_id);
  if(!row)fail(404,'not_found','المشروع الإنتاجي غير متاح');
  return {u,row};
}
function productionActions(u,row,open,ready=false){
  const own=row.producer_id===u.id,actions=[];
  if(own&&['planning','in_production'].includes(row.status))actions.push('edit_production','add_crew','add_talent','add_location','save_schedule','add_shot','cancel_production');
  // بدء التصوير لا يُعرض قبل الجاهزية؛ وما ينقصها يُعرض في البطاقة باسمه ومالكه (readiness).
  if(own&&row.status==='planning'&&ready)actions.push('start_production');
  if(own&&row.status==='in_production')actions.push('wrap_production');
  // من أنتج لا يقفل إنتاجه: الإقفال شهادة طرف ثانٍ على أن المخرجات سُلّمت.
  if(!own&&row.status==='wrapped'&&!open.drafts)actions.push('accept_close');
  return actions;
}
function productionView(db,u,row){
  const crew=db.prepare(`SELECT c.*,x.name AS user_name,ve.code AS vendor_code,ve.legal_name AS vendor_name,ve.status AS vendor_status
    FROM production_crew c LEFT JOIN users x ON x.id=c.user_id LEFT JOIN vendors ve ON ve.id=c.vendor_id WHERE c.production_id=? ORDER BY c.active DESC,c.role_key,c.created_at`).all(row.id);
  const talent=db.prepare('SELECT t.*,ve.legal_name AS agency_name FROM production_talent t LEFT JOIN vendors ve ON ve.id=t.agency_vendor_id WHERE t.production_id=? ORDER BY t.active DESC,t.full_name').all(row.id);
  const locations=db.prepare('SELECT * FROM production_locations WHERE production_id=? ORDER BY active DESC,name').all(row.id);
  const schedule=db.prepare('SELECT s.*,l.name AS location_name FROM shoot_schedule s LEFT JOIN production_locations l ON l.id=s.location_id WHERE s.production_id=? ORDER BY s.shoot_date,s.sort_order').all(row.id);
  const shots=db.prepare('SELECT h.*,s.title AS scene_title,s.shoot_date FROM shot_list h LEFT JOIN shoot_schedule s ON s.id=h.scene_id WHERE h.production_id=? ORDER BY h.sort_order,h.created_at').all(row.id);
  const sheets=db.prepare('SELECT * FROM call_sheets WHERE production_id=? ORDER BY shoot_date,revision').all(row.id);
  const editable=row.producer_id===u.id&&['planning','in_production'].includes(row.status);
  const open={drafts:sheets.filter(s=>s.status==='draft').length,issued:sheets.filter(s=>s.status==='issued').length};
  const day=new Map();for(const s of schedule)day.set(s.shoot_date,[...(day.get(s.shoot_date)??[]),s]);
  const client=row.client_id?db.prepare('SELECT legal_name,trade_name FROM clients WHERE id=?').get(row.client_id):null;
  const equipment=liveEquipment(db,row).map(b=>({booking_id:b.id,item_code:b.code,item_name:b.name,status:b.status,status_name:BOOKING_STATES[b.status],
    custodian_name:personName(db,b.custodian_id),start_date:b.start_date,end_date:b.end_date}));
  const t=treatmentOf(db,row.review_route_id),readiness=row.status==='planning'?shootReadiness(db,row):null;
  return {...row,status_name:STATES[row.status],kind_name:label(KINDS,row.kind),producer_name:userName(db,row.producer_id),closed_by_name:userName(db,row.closed_by),own:row.producer_id===u.id,
    client_name:client?client.trade_name||client.legal_name:null,
    campaign_name:row.campaign_id?db.prepare('SELECT name FROM campaigns WHERE id=?').get(row.campaign_id)?.name??null:null,
    project_name:row.project_id?db.prepare('SELECT name FROM projects WHERE id=?').get(row.project_id)?.name??null:null,
    crew:crew.map(c=>({id:c.id,role_key:c.role_key,role_name:label(CREW_ROLES,c.role_key),role_note:c.role_note,source:c.source,active:!!c.active,version:c.version,
      person_name:c.source==='internal'?c.user_name:c.vendor_name,user_id:c.user_id,vendor_id:c.vendor_id,vendor_code:c.vendor_code,vendor_status:c.vendor_status,
      // المعدل اليومي للمستقل الخارجي فقط؛ الموظف الداخلي بلا أي رقم هنا.
      day_rate_minor:c.source==='external'?c.day_rate_minor:null,days:c.days,engagement_note:c.engagement_note,removal_note:c.removal_note,
      actions:editable&&c.active?['edit_crew','remove_crew']:[]})),
    talent:talent.map(t=>({...t,active:!!t.active,kind_name:label(TALENT_KINDS,t.talent_kind),release_status_name:RELEASE_STATES[t.release_status],
      release_expired:t.release_status==='signed'&&!!t.release_valid_until&&t.release_valid_until<today(),
      actions:editable&&t.active?['edit_talent','record_release','remove_talent']:[]})),
    locations:locations.map(l=>({...l,active:!!l.active,permit_required:!!l.permit_required,permit_status_name:PERMIT_STATES[l.permit_status],
      permit_expired:l.permit_status==='obtained'&&!!l.permit_expires_on&&l.permit_expires_on<today(),
      actions:editable&&l.active?['edit_location','record_permit','remove_location']:[]})),
    schedule_days:[...day].map(([date,rows])=>({shoot_date:date,rows:rows.map(s=>({...s,estimated_minutes:s.estimated_minutes??null}))})),
    shots:shots.map(h=>({...h,size_name:label(SHOT_SIZES,h.shot_size),angle_name:label(CAMERA_ANGLES,h.camera_angle),status_name:SHOT_STATES[h.status],
      actions:editable?['edit_shot','mark_shot']:[]})),
    call_sheets:sheets.map(s=>({id:s.id,shoot_date:s.shoot_date,revision:s.revision,status:s.status,status_name:CALL_SHEET_STATES[s.status]})),
    counts:{crew:crew.filter(c=>c.active).length,external_crew:crew.filter(c=>c.active&&c.source==='external').length,
      talent:talent.filter(t=>t.active).length,talent_without_release:talent.filter(t=>t.active&&t.release_status!=='signed').length,
      locations:locations.filter(l=>l.active).length,permits_open:locations.filter(l=>l.active&&l.permit_status==='pending').length,
      shots:shots.length,shots_done:shots.filter(h=>h.status==='shot').length,call_sheets:sheets.filter(s=>s.status==='issued').length,equipment_out:equipment.length},
    equipment,
    budget_note:row.project_id?'ميزانية هذا الإنتاج هي مخصص مشروعه في شاشة «مخصصات المشاريع». لا تُكرر هنا ولا تُعرض أرقامها لمن لا تفويض مالي له.':'لا مشروع مرتبط: لا مخصص ميزانية لهذا الإنتاج في المنصة.',
    treatment:t?{route_id:t.id,route_name:t.name,status:t.status,status_name:ROUTE_STATUS[t.status],output_version_id:t.output_version_id,revision:t.output_revision,
      digest:t.output_digest,output_title:JSON.parse(t.snapshot).title??'',studio_title:t.studio_title}:null,
    readiness,actions:productionActions(u,row,open,readiness?.ready)};
}
const LINK_FIELDS=['client_id','campaign_id','project_id','review_route_id'];
// المعالجة (P4-SPEC-2): مسار المراجعة يُختار، ونسخته وعمل الاستوديو يُقرآن منه. المشروع والعميل والحملة الفارغة تُقرأ من عمل
// الاستوديو، والمكتوبة تطابقه وإلا رُفضت باسمها. والمسار الذي لا يراه المنتج لا يُسمّى، والمسار الذي طلب تعديلات أو أُلغي لا يُصوَّر.
// في التعديل: غياب review_route_id من الطلب يُبقي المعالجة كما هي، ولا يفكّها صامتًا.
function cleanLinks(db,u,input,current=null){
  let client=input.client_id||null,campaign=input.campaign_id||null,project=input.project_id||null;
  const routeId=input.review_route_id===undefined&&current?current.review_route_id:input.review_route_id||null;
  const route=routeId?treatmentOf(db,routeId):null;
  if(routeId){
    if(!route||route.tenant_id!==u.tenant_id||!db.prepare('SELECT 1 FROM project_members WHERE project_id=? AND user_id=?').get(route.studio_project_id,u.id))
      refuse(404,'not_found',{what:'ما تقدر تربط الإنتاج بهالمعالجة من حسابك',missing:[{document:'عضوية في مشروع المعالجة',why:'مسار المراجعة ينقرأ لأعضاء مشروعه وحدهم',owner:'منشئ مشروع المعالجة',owner_role:'project_owner'}],
        next:'اطلب العضوية في مشروع المعالجة، أو اربط معالجة من مشاريعك'});
    if(['changes_required','cancelled'].includes(route.status))refuse(409,'treatment_rejected',{what:`مسار «${route.name}» ${route.status==='cancelled'?'انلغى':'طلب تعديلات'} على النسخة ${route.output_revision}، فما ينصوّر عليه`,
      next:'النسخة الجديدة من المخرج تفتح مسارها؛ اربط الإنتاج بمسارها'});
    const studio=[['project','المشروع',route.studio_project_id],['client','العميل',route.studio_client_id],['campaign','الحملة',route.studio_campaign_id]];
    const given={project,client,campaign},differs=studio.filter(([key,,value])=>value&&given[key]&&given[key]!==value);
    if(differs.length)refuse(409,'treatment_mismatch',{what:`${differs.map(([,label])=>label).join(' و')}: غير اللي في عمل الاستوديو «${route.studio_title}» اللي يصوّره الإنتاج`,
      next:'اترك الحقل فاضي فينقرأ من عمل الاستوديو، أو اربط معالجة من العمل الصحيح'});
    for(const [key,,value] of studio)if(value&&!given[key])given[key]=value;
    ({project,client,campaign}=given);
  }
  if(!client&&!campaign&&!project)fail(400,'link_required','اربط الإنتاج بعميل أو حملة أو مشروع قائم');
  if(client&&!db.prepare('SELECT 1 FROM clients WHERE id=? AND tenant_id=?').get(client,u.tenant_id))fail(400,'client_id','العميل غير متاح');
  if(campaign&&!db.prepare('SELECT 1 FROM campaigns WHERE id=? AND tenant_id=?').get(campaign,u.tenant_id))fail(400,'campaign_id','الحملة غير متاحة');
  if(project&&!db.prepare('SELECT 1 FROM projects WHERE id=? AND tenant_id=?').get(project,u.tenant_id))fail(400,'project_id','المشروع غير متاح');
  return {client,campaign,project,route:route?.id??null,version:route?.output_version_id??null,route_name:route?.name??''};
}
function cleanProduction(db,u,input,current=null){
  const from=v.date(input.shoot_from),to=v.date(input.shoot_to);
  if(to<from)fail(400,'date_order','نهاية التصوير بعد بدايته');
  return {title:v.text(input.title,'اسم الإنتاج',180,3),kind:choose(KINDS,input.kind,'نوع الإنتاج'),brief:optional(input.brief,'موجز الإنتاج',4000),from,to,...cleanLinks(db,u,input,current)};
}
const PRODUCTION_FIELDS=['title','kind','brief',...LINK_FIELDS,'shoot_from','shoot_to'];
export function createProduction(db,supplied,input){
  writing(db);const u=actor(db,supplied);manages(db,u);
  v.object(input,['code',...PRODUCTION_FIELDS]);
  const code=v.text(input.code,'رمز الإنتاج',40,3).normalize('NFKC').toUpperCase();
  if(!/^[A-Z0-9][A-Z0-9-]{2,39}$/.test(code))fail(400,'code','رمز الإنتاج حروف لاتينية كبيرة وأرقام وشرطات');
  if(db.prepare('SELECT 1 FROM productions WHERE tenant_id=? AND code=?').get(u.tenant_id,code))fail(409,'duplicate_code','الرمز مستخدم في إنتاج آخر');
  const f=cleanProduction(db,u,input),productionId=id(),time=now();
  db.prepare("INSERT INTO productions(id,tenant_id,code,title,kind,status,producer_id,brief,client_id,campaign_id,project_id,review_route_id,output_version_id,shoot_from,shoot_to,created_at,updated_at) VALUES(?,?,?,?,?,'planning',?,?,?,?,?,?,?,?,?,?,?)")
    .run(productionId,u.tenant_id,code,f.title,f.kind,u.id,f.brief,f.client,f.campaign,f.project,f.route,f.version,f.from,f.to,time,time);
  audit(db,u,'production',productionId,'production.created',{}, {code,kind:f.kind,review_route_id:f.route,output_version_id:f.version});
  return {id:productionId};
}
export function productionAction(db,supplied,productionId,action,input){
  writing(db);const {u,row}=productionRow(db,supplied,productionId);
  const key={edit:'edit_production',start:'start_production',wrap:'wrap_production',close:'accept_close',cancel:'cancel_production'}[action];
  const open={drafts:db.prepare("SELECT COUNT(*) AS n FROM call_sheets WHERE production_id=? AND status='draft'").get(row.id).n};
  const readiness=row.status==='planning'?shootReadiness(db,row):{ready:false,missing:[]};
  // PRO-01: منتج العمل يطلب البدء والإنتاج غير جاهز — رفضٌ يسمّي كل اعتماد ناقص ومن يملكه، لا «الإجراء غير متاح».
  if(action==='start'&&row.producer_id===u.id&&row.status==='planning'&&!readiness.ready)refuse(409,'shoot_not_ready',{what:`ما يبدأ تصوير ${row.code} قبل اعتماد المعالجة والميزانية`,
    missing:readiness.missing,next:'اربط الإنتاج بمسار مراجعة معالجته من «تعديل الإنتاج» وخلّ المراجعين يوافقون، واطلب من المالية اعتماد مخصص المشروع للمدة، وبعدها ابدأ التصوير'});
  if(!key||!productionActions(u,row,open,readiness.ready).includes(key))fail(409,'invalid_state','الإجراء غير متاح في حالة الإنتاج أو لحسابك');
  versioned(row,input);
  const time=now(),bump=(fields,values)=>db.prepare(`UPDATE productions SET ${fields},version=version+1,updated_at=? WHERE id=?`).run(...values,time,row.id);
  let reason='',detail={};
  if(action==='edit'){
    v.object(input,['version',...PRODUCTION_FIELDS]);const f=cleanProduction(db,u,input,row);
    if(row.status!=='planning'&&f.route!==row.review_route_id)refuse(409,'treatment_locked',{what:`التصوير بدأ على معالجة «${treatmentOf(db,row.review_route_id)?.name??'بلا معالجة'}»، فما تتغير المعالجة بعده`,
      next:'إذا تغيّرت المعالجة جوهريًا: ألغِ هالإنتاج وافتح إنتاجًا على المعالجة الجديدة'});
    const outside=db.prepare('SELECT COUNT(*) AS n FROM call_sheets WHERE production_id=? AND (shoot_date<? OR shoot_date>?)').get(row.id,f.from,f.to).n;
    if(outside)fail(409,'dates_in_use','أوراق استدعاء خارج المدة الجديدة. عالجها قبل تضييق المدة');
    bump('title=?,kind=?,brief=?,client_id=?,campaign_id=?,project_id=?,review_route_id=?,output_version_id=?,shoot_from=?,shoot_to=?',[f.title,f.kind,f.brief,f.client,f.campaign,f.project,f.route,f.version,f.from,f.to]);
    detail={review_route_id:f.route};
  }else if(action==='start'){v.object(input,['version']);bump("status='in_production'",[]);detail={review_route_id:row.review_route_id,output_version_id:row.output_version_id,project_id:row.project_id};}
  else if(action==='wrap'){v.object(input,['version','wrap_note']);reason=v.text(input.wrap_note,'ما أُنجز وما تبقى من مخرجات',4000,10);bump("status='wrapped',wrap_note=?",[reason]);}
  else if(action==='close'){
    v.object(input,['version','note']);
    // لا يُقفل إنتاجٌ ومعداته طالعة عليه أو محجوزة له: الرفض يسمّي كل قطعة ومن هي بعهدته. (حارسه في SQL: الترحيل 193.)
    const held=liveEquipment(db,row);
    if(held.length)refuse(409,'equipment_still_out',{what:`ما ينقفل الإنتاج ${row.code} والمعدات حقّته للحين ما رجعت المخزن`,
      missing:held.map(b=>{const holder=personName(db,b.custodian_id)??'حامل العهدة';
        return {document:`${b.code} ${b.name}`,why:b.status==='out'?`طالعة بعهدة ${holder} من ${b.start_date}`:`محجوزة باسم ${holder} من ${b.start_date} وما انسلّمت`,owner:holder,owner_role:'employee'};}),
      next:'رجّعوا القطع الطالعة للمخزن وأمين المخزن يسجّل استلامها، وألغوا الحجوزات اللي ما لها داعي، وبعدها اقفل الإنتاج'});
    reason=v.text(input.note,'أساس الإقفال: المخرجات سُلّمت والتصاريح والتصاريح الشخصية موثقة',2000,10);
    bump("status='closed',closed_by=?,closed_at=?",[u.id,time]);
  }else if(action==='cancel'){
    v.object(input,['version','note']);reason=v.text(input.note,'سبب الإلغاء',2000,10);
    if(db.prepare("SELECT 1 FROM call_sheets WHERE production_id=? AND status='issued'").get(row.id))fail(409,'issued_call_sheets','ألغِ أوراق الاستدعاء الصادرة أولًا؛ من استُدعي يجب أن يُخطر');
    bump("status='cancelled',closed_at=?",[time]);
  }
  audit(db,u,'production',row.id,'production.'+action,{status:row.status},{version:row.version+1,...detail},reason);
  return {id:row.id};
}

/* ───── الطاقم ───── */
function editableProduction(db,supplied,productionId){
  const {u,row}=productionRow(db,supplied,productionId);
  if(row.producer_id!==u.id)fail(403,'not_producer','منتج هذا العمل وحده يحرر طاقمه ومواهبه ومواقعه');
  if(!['planning','in_production'].includes(row.status))fail(409,'invalid_state','الإنتاج مقفل أو ملغى');
  return {u,row};
}
function child(db,supplied,table,recordId){
  const u=actor(db,supplied);manages(db,u);
  const row=typeof recordId==='string'&&db.prepare(`SELECT * FROM ${table} WHERE id=? AND tenant_id=?`).get(recordId,u.tenant_id);
  if(!row)fail(404,'not_found','السجل غير متاح');
  const production=db.prepare('SELECT * FROM productions WHERE id=? AND tenant_id=?').get(row.production_id,u.tenant_id);
  if(production.producer_id!==u.id)fail(403,'not_producer','منتج هذا العمل وحده يحرر سجلاته');
  if(!['planning','in_production'].includes(production.status))fail(409,'invalid_state','الإنتاج مقفل أو ملغى');
  return {u,row,production};
}
const CREW_FIELDS=['role_key','role_note','source','user_id','vendor_id','day_rate','days','engagement_note'];
function cleanCrew(db,u,input){
  const source=input.source;if(!['internal','external'].includes(source))fail(400,'source','حدد: موظف داخلي أم مستقل خارجي');
  const role=choose(CREW_ROLES,input.role_key,'الدور');
  if(source==='internal'){
    if(input.day_rate||input.days)fail(400,'internal_rate','أجر الموظف الداخلي وتكلفته لا يُسجلان هنا. هما في ملفه الوظيفي ومسير الرواتب');
    const target=db.prepare('SELECT id FROM users WHERE id=? AND tenant_id=? AND active=1').get(input.user_id??'',u.tenant_id);
    if(!target)fail(400,'user_id','اختر موظفًا نشطًا');
    return {role,source,user:target.id,vendor:null,rate:null,days:null,note:optional(input.role_note,'وصف الدور',400),engagement:optional(input.engagement_note,'ملاحظة التكليف',1000)};
  }
  const vendor=db.prepare('SELECT id,status FROM vendors WHERE id=? AND tenant_id=?').get(input.vendor_id??'',u.tenant_id);
  if(!vendor)fail(400,'vendor_id','المستقل الخارجي يُسجَّل موردًا في «الموردون» أولًا، ومستحقه يمر بدورة المدفوعات');
  const days=input.days===undefined||input.days===null||input.days===''?null:input.days;
  if(days!==null&&(!Number.isInteger(days)||days<1||days>365))fail(400,'days','عدد الأيام من 1 إلى 365');
  return {role,source,user:null,vendor:vendor.id,rate:dayRate(String(input.day_rate??'').trim()),days,note:optional(input.role_note,'وصف الدور',400),engagement:optional(input.engagement_note,'ملاحظة التكليف',1000)};
}
export function addCrew(db,supplied,productionId,input){
  writing(db);const {u,row}=editableProduction(db,supplied,productionId);
  v.object(input,CREW_FIELDS);const f=cleanCrew(db,u,input);
  if(db.prepare('SELECT 1 FROM production_crew WHERE production_id=? AND role_key=? AND COALESCE(user_id,vendor_id)=?').get(row.id,f.role,f.user??f.vendor))fail(409,'duplicate_crew','هذا الشخص مسجل بهذا الدور في الإنتاج');
  const crewId=id(),time=now();
  db.prepare('INSERT INTO production_crew(id,tenant_id,production_id,role_key,role_note,source,user_id,vendor_id,day_rate_minor,days,engagement_note,added_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
    .run(crewId,u.tenant_id,row.id,f.role,f.note,f.source,f.user,f.vendor,f.rate,f.days,f.engagement,u.id,time,time);
  audit(db,u,'production_crew',crewId,'crew.added',{}, {production:row.code,role:f.role,source:f.source});
  return {id:crewId};
}
export function crewAction(db,supplied,crewId,action,input){
  writing(db);const {u,row,production}=child(db,supplied,'production_crew',crewId);
  if(!row.active)fail(409,'invalid_state','السجل موقوف');
  versioned(row,input);const time=now();
  if(action==='edit'){
    v.object(input,['version','role_note','day_rate','days','engagement_note']);
    const days=input.days===undefined||input.days===null||input.days===''?null:input.days;
    if(row.source==='internal'&&(input.day_rate||days!==null))fail(400,'internal_rate','أجر الموظف الداخلي لا يُسجل هنا');
    if(days!==null&&(!Number.isInteger(days)||days<1||days>365))fail(400,'days','عدد الأيام من 1 إلى 365');
    const rate=row.source==='external'?dayRate(String(input.day_rate??'').trim()):null;
    db.prepare('UPDATE production_crew SET role_note=?,day_rate_minor=?,days=?,engagement_note=?,version=version+1,updated_at=? WHERE id=?')
      .run(optional(input.role_note,'وصف الدور',400),rate,row.source==='external'?days:null,optional(input.engagement_note,'ملاحظة التكليف',1000),time,row.id);
  }else if(action==='remove'){
    v.object(input,['version','note']);
    if(db.prepare("SELECT 1 FROM call_sheet_invitees i JOIN call_sheets s ON s.id=i.call_sheet_id WHERE i.crew_id=? AND s.status='issued'").get(row.id))fail(409,'invited','هذا الشخص مستدعى في ورقة صادرة. أصدر نسخة جديدة من الورقة أولًا');
    db.prepare('UPDATE production_crew SET active=0,removal_note=?,version=version+1,updated_at=? WHERE id=?').run(v.text(input.note,'سبب الاستبعاد',1000,5),time,row.id);
  }else fail(404,'not_found','الإجراء غير متاح');
  audit(db,u,'production_crew',row.id,'crew.'+action,{}, {production:production.code});
  return {id:row.id};
}

/* ───── المواهب وتصاريح استخدام الصورة ───── */
const TALENT_FIELDS=['full_name','talent_kind','agency_vendor_id','contact_note'];
const RELEASE_FIELDS=['release_status','release_signed_on','release_valid_until','release_scope','release_media','release_storage','release_note'];
function cleanRelease(input){
  const status=input.release_status;
  if(!Object.hasOwn(RELEASE_STATES,status))fail(400,'release_status','اختر حالة تصريح استخدام الصورة');
  if(!['signed','expired'].includes(status))return {status,signed:null,until:null,scope:'',media:'',storage:'',note:optional(input.release_note,'ملاحظة التصريح',1000)};
  const signed=v.date(input.release_signed_on),until=input.release_valid_until?v.date(input.release_valid_until):null;
  if(signed>today())fail(400,'release_signed_on','تاريخ التوقيع لا يكون مستقبليًا');
  if(until&&until<signed)fail(400,'release_valid_until','نهاية مدة التصريح بعد تاريخ توقيعه');
  return {status,signed,until,scope:v.text(input.release_scope,'نطاق الاستخدام: القنوات والأسواق والمدة',1000,3),
    media:optional(input.release_media,'الوسائط المشمولة',600),storage:v.text(input.release_storage,'مكان حفظ الأصل الموقّع',600,3),note:optional(input.release_note,'ملاحظة التصريح',1000)};
}
export function addTalent(db,supplied,productionId,input){
  writing(db);const {u,row}=editableProduction(db,supplied,productionId);
  v.object(input,[...TALENT_FIELDS,...RELEASE_FIELDS]);
  const name=v.text(input.full_name,'اسم الموهبة',180,3),kind=choose(TALENT_KINDS,input.talent_kind,'نوع الموهبة');
  const agency=input.agency_vendor_id||null;
  if(agency&&!db.prepare('SELECT 1 FROM vendors WHERE id=? AND tenant_id=?').get(agency,u.tenant_id))fail(400,'agency_vendor_id','وكالة المواهب تُسجَّل موردًا أولًا');
  if(db.prepare('SELECT 1 FROM production_talent WHERE production_id=? AND full_name=?').get(row.id,name))fail(409,'duplicate_talent','الاسم مسجل في هذا الإنتاج');
  const r=cleanRelease(input),talentId=id(),time=now();
  db.prepare('INSERT INTO production_talent(id,tenant_id,production_id,full_name,talent_kind,agency_vendor_id,contact_note,release_status,release_signed_on,release_valid_until,release_scope,release_media,release_storage,release_note,recorded_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
    .run(talentId,u.tenant_id,row.id,name,kind,agency,optional(input.contact_note,'بيانات التواصل',600),r.status,r.signed,r.until,r.scope,r.media,r.storage,r.note,u.id,time,time);
  audit(db,u,'production_talent',talentId,'talent.added',{}, {production:row.code,release_status:r.status});
  return {id:talentId};
}
export function talentAction(db,supplied,talentId,action,input){
  writing(db);const {u,row,production}=child(db,supplied,'production_talent',talentId);
  if(!row.active)fail(409,'invalid_state','السجل موقوف');
  versioned(row,input);const time=now();
  if(action==='edit'){
    v.object(input,['version',...TALENT_FIELDS]);
    const name=v.text(input.full_name,'اسم الموهبة',180,3),agency=input.agency_vendor_id||null;
    if(agency&&!db.prepare('SELECT 1 FROM vendors WHERE id=? AND tenant_id=?').get(agency,u.tenant_id))fail(400,'agency_vendor_id','وكالة المواهب تُسجَّل موردًا أولًا');
    if(name!==row.full_name&&db.prepare('SELECT 1 FROM production_talent WHERE production_id=? AND full_name=?').get(row.production_id,name))fail(409,'duplicate_talent','الاسم مسجل في هذا الإنتاج');
    db.prepare('UPDATE production_talent SET full_name=?,talent_kind=?,agency_vendor_id=?,contact_note=?,version=version+1,updated_at=? WHERE id=?')
      .run(name,choose(TALENT_KINDS,input.talent_kind,'نوع الموهبة'),agency,optional(input.contact_note,'بيانات التواصل',600),time,row.id);
  }else if(action==='release'){
    v.object(input,['version',...RELEASE_FIELDS]);const r=cleanRelease(input);
    db.prepare('UPDATE production_talent SET release_status=?,release_signed_on=?,release_valid_until=?,release_scope=?,release_media=?,release_storage=?,release_note=?,version=version+1,updated_at=? WHERE id=?')
      .run(r.status,r.signed,r.until,r.scope,r.media,r.storage,r.note,time,row.id);
  }else if(action==='remove'){
    v.object(input,['version','note']);
    if(db.prepare("SELECT 1 FROM call_sheet_invitees i JOIN call_sheets s ON s.id=i.call_sheet_id WHERE i.talent_id=? AND s.status='issued'").get(row.id))fail(409,'invited','هذه الموهبة مستدعاة في ورقة صادرة. أصدر نسخة جديدة من الورقة أولًا');
    db.prepare('UPDATE production_talent SET active=0,removal_note=?,version=version+1,updated_at=? WHERE id=?').run(v.text(input.note,'سبب الاستبعاد',1000,5),time,row.id);
  }else fail(404,'not_found','الإجراء غير متاح');
  audit(db,u,'production_talent',row.id,'talent.'+action,{}, {production:production.code});
  return {id:row.id};
}

/* ───── المواقع وتصاريح التصوير ───── */
const LOCATION_FIELDS=['name','address_note','map_link','contact_name','contact_phone'];
const PERMIT_FIELDS=['permit_required','permit_basis','permit_status','permit_number','permit_issuer','permit_expires_on','permit_storage'];
function cleanPermit(input){
  // «هل يتطلب هذا الموقع تصريحًا من جهة؟» قرار المنتج وحده مع سنده. المنصة لا تفترض متطلبًا نظاميًا ولا تعرف الجهات.
  const required=input.permit_required===true||input.permit_required==='true'||input.permit_required===1;
  const status=input.permit_status;
  if(!Object.hasOwn(PERMIT_STATES,status))fail(400,'permit_status','اختر حالة التصريح');
  if(required===(status==='not_required'))fail(400,'permit_status',required?'الموقع يتطلب تصريحًا: اختر حالته':'الموقع لا يتطلب تصريحًا: لا حالة تصريح له');
  if(!required)return {required:0,basis:optional(input.permit_basis,'سند القرار',1000),status,number:'',issuer:'',expires:null,storage:''};
  const basis=v.text(input.permit_basis,'لماذا يتطلب هذا الموقع تصريحًا، ومن أي جهة',1000,5);
  if(status!=='obtained')return {required:1,basis,status,number:'',issuer:'',expires:null,storage:''};
  const number=v.text(input.permit_number,'رقم التصريح',120,2),issuer=v.text(input.permit_issuer,'مصدر التصريح',180,2),storage=v.text(input.permit_storage,'مكان حفظ أصل التصريح',600,3);
  return {required:1,basis,status,number,issuer,expires:v.date(input.permit_expires_on),storage};
}
export function addLocation(db,supplied,productionId,input){
  writing(db);const {u,row}=editableProduction(db,supplied,productionId);
  v.object(input,[...LOCATION_FIELDS,...PERMIT_FIELDS]);
  const name=v.text(input.name,'اسم الموقع',180,3);
  if(db.prepare('SELECT 1 FROM production_locations WHERE production_id=? AND name=?').get(row.id,name))fail(409,'duplicate_location','الموقع مسجل في هذا الإنتاج');
  const p=cleanPermit(input),locationId=id(),time=now();
  db.prepare('INSERT INTO production_locations(id,tenant_id,production_id,name,address_note,map_link,contact_name,contact_phone,permit_required,permit_basis,permit_status,permit_number,permit_issuer,permit_expires_on,permit_storage,recorded_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
    .run(locationId,u.tenant_id,row.id,name,optional(input.address_note,'العنوان الوصفي',1000),optional(input.map_link,'رابط الخريطة',600),optional(input.contact_name,'جهة الاتصال',180),optional(input.contact_phone,'هاتف جهة الاتصال',40),p.required,p.basis,p.status,p.number,p.issuer,p.expires,p.storage,u.id,time,time);
  audit(db,u,'production_location',locationId,'location.added',{}, {production:row.code,permit_required:!!p.required});
  return {id:locationId};
}
export function locationAction(db,supplied,locationId,action,input){
  writing(db);const {u,row,production}=child(db,supplied,'production_locations',locationId);
  if(!row.active)fail(409,'invalid_state','السجل موقوف');
  versioned(row,input);const time=now();
  if(action==='edit'){
    v.object(input,['version',...LOCATION_FIELDS]);const name=v.text(input.name,'اسم الموقع',180,3);
    if(name!==row.name&&db.prepare('SELECT 1 FROM production_locations WHERE production_id=? AND name=?').get(row.production_id,name))fail(409,'duplicate_location','الموقع مسجل في هذا الإنتاج');
    db.prepare('UPDATE production_locations SET name=?,address_note=?,map_link=?,contact_name=?,contact_phone=?,version=version+1,updated_at=? WHERE id=?')
      .run(name,optional(input.address_note,'العنوان الوصفي',1000),optional(input.map_link,'رابط الخريطة',600),optional(input.contact_name,'جهة الاتصال',180),optional(input.contact_phone,'هاتف جهة الاتصال',40),time,row.id);
  }else if(action==='permit'){
    v.object(input,['version',...PERMIT_FIELDS]);const p=cleanPermit(input);
    db.prepare('UPDATE production_locations SET permit_required=?,permit_basis=?,permit_status=?,permit_number=?,permit_issuer=?,permit_expires_on=?,permit_storage=?,version=version+1,updated_at=? WHERE id=?')
      .run(p.required,p.basis,p.status,p.number,p.issuer,p.expires,p.storage,time,row.id);
  }else if(action==='remove'){
    v.object(input,['version','note']);
    if(db.prepare("SELECT 1 FROM call_sheets WHERE location_id=? AND status IN ('draft','issued')").get(row.id))fail(409,'in_use','الموقع مستخدم في ورقة استدعاء قائمة');
    db.prepare('UPDATE production_locations SET active=0,removal_note=?,version=version+1,updated_at=? WHERE id=?').run(v.text(input.note,'سبب الاستبعاد',1000,5),time,row.id);
  }else fail(404,'not_found','الإجراء غير متاح');
  audit(db,u,'production_location',row.id,'location.'+action,{}, {production:production.code});
  return {id:row.id};
}

/* ───── جدول اليوم وقائمة اللقطات ───── */
// الترتيب هو ترتيب الصفوف المرسلة: يُحفظ في sort_order ويُعاد ترتيبه بحفظ الجدول من جديد.
export function saveSchedule(db,supplied,productionId,input){
  writing(db);const {u,row}=editableProduction(db,supplied,productionId);
  v.object(input,['shoot_date','rows']);
  const date=v.date(input.shoot_date);
  if(date<row.shoot_from||date>row.shoot_to)fail(400,'shoot_date','اليوم خارج مدة التصوير المسجلة');
  if(!Array.isArray(input.rows)||input.rows.length>60)fail(400,'rows','حتى ستين مشهدًا في اليوم');
  const existing=db.prepare('SELECT * FROM shoot_schedule WHERE production_id=? AND shoot_date=? ORDER BY sort_order').all(row.id,date);
  const kept=new Set(),time=now();
  input.rows.forEach((line,index)=>{
    v.object(line,['id','scene_ref','title','note','location_id','start_time','estimated_minutes']);
    const title=v.text(line.title,'عنوان المشهد',180,2),ref=optional(line.scene_ref,'رقم المشهد',60),note=optional(line.note,'ملاحظة المشهد',1000);
    const start=clock(line.start_time,'وقت البدء',{required:false});
    const minutes=line.estimated_minutes===undefined||line.estimated_minutes===null||line.estimated_minutes===''?null:Number(line.estimated_minutes);
    if(minutes!==null&&(!Number.isInteger(minutes)||minutes<5||minutes>1440))fail(400,'estimated_minutes','المدة المقدرة من 5 إلى 1440 دقيقة');
    const location=line.location_id||null;
    if(location&&!db.prepare('SELECT 1 FROM production_locations WHERE id=? AND production_id=? AND active=1').get(location,row.id))fail(400,'location_id','الموقع ليس من مواقع هذا الإنتاج');
    const current=line.id?existing.find(x=>x.id===line.id):null;
    if(line.id&&!current)fail(404,'not_found','المشهد غير متاح');
    if(current){kept.add(current.id);db.prepare('UPDATE shoot_schedule SET sort_order=?,scene_ref=?,title=?,note=?,location_id=?,start_time=?,estimated_minutes=?,version=version+1,updated_at=? WHERE id=?').run(index,ref,title,note,location,start,minutes,time,current.id);}
    else db.prepare('INSERT INTO shoot_schedule(id,tenant_id,production_id,shoot_date,sort_order,scene_ref,title,note,location_id,start_time,estimated_minutes,recorded_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(id(),u.tenant_id,row.id,date,index,ref,title,note,location,start,minutes,u.id,time,time);
  });
  for(const old of existing){
    if(kept.has(old.id))continue;
    if(db.prepare('SELECT 1 FROM shot_list WHERE scene_id=?').get(old.id))fail(409,'scene_in_use','للمشهد لقطات مسجلة؛ انقلها قبل حذفه');
    db.prepare('DELETE FROM shoot_schedule WHERE id=?').run(old.id);
  }
  audit(db,u,'production',row.id,'schedule.saved',{}, {shoot_date:date,rows:input.rows.length});
  return {id:row.id,shoot_date:date};
}
const SHOT_FIELDS=['scene_id','code','description','shot_size','camera_angle','reference_note'];
function cleanShot(db,production,input){
  const scene=input.scene_id||null;
  if(scene&&!db.prepare('SELECT 1 FROM shoot_schedule WHERE id=? AND production_id=?').get(scene,production.id))fail(400,'scene_id','المشهد ليس من مشاهد هذا الإنتاج');
  return {scene,code:optional(input.code,'رمز اللقطة',60),description:v.text(input.description,'وصف اللقطة',1500,3),
    size:choose(SHOT_SIZES,input.shot_size,'حجم اللقطة'),angle:choose(CAMERA_ANGLES,input.camera_angle,'زاوية الكاميرا'),
    reference:optional(input.reference_note,'المرجع البصري ومكان حفظه',1000)};
}
export function addShot(db,supplied,productionId,input){
  writing(db);const {u,row}=editableProduction(db,supplied,productionId);
  v.object(input,SHOT_FIELDS);const f=cleanShot(db,row,input);
  const order=db.prepare('SELECT COALESCE(MAX(sort_order),-1)+1 AS n FROM shot_list WHERE production_id=?').get(row.id).n,shotId=id(),time=now();
  db.prepare("INSERT INTO shot_list(id,tenant_id,production_id,scene_id,sort_order,code,description,shot_size,camera_angle,reference_note,status,recorded_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,'planned',?,?,?)")
    .run(shotId,u.tenant_id,row.id,f.scene,order,f.code,f.description,f.size,f.angle,f.reference,u.id,time,time);
  audit(db,u,'shot',shotId,'shot.added',{}, {production:row.code});
  return {id:shotId};
}
export function shotAction(db,supplied,shotId,action,input){
  writing(db);const {u,row,production}=child(db,supplied,'shot_list',shotId);
  versioned(row,input);const time=now();
  if(action==='edit'){
    v.object(input,['version',...SHOT_FIELDS]);const f=cleanShot(db,production,input);
    db.prepare('UPDATE shot_list SET scene_id=?,code=?,description=?,shot_size=?,camera_angle=?,reference_note=?,version=version+1,updated_at=? WHERE id=?').run(f.scene,f.code,f.description,f.size,f.angle,f.reference,time,row.id);
  }else if(action==='status'){
    v.object(input,['version','status','note']);
    if(!Object.hasOwn(SHOT_STATES,input.status))fail(400,'status','اختر حالة اللقطة');
    const note=input.status==='planned'?'':v.text(input.note,input.status==='reshoot'?'سبب الإعادة':'ملاحظة التصوير',1000,3);
    db.prepare('UPDATE shot_list SET status=?,status_note=?,version=version+1,updated_at=? WHERE id=?').run(input.status,note,time,row.id);
  }else fail(404,'not_found','الإجراء غير متاح');
  audit(db,u,'shot',row.id,'shot.'+action,{status:row.status},{});
  return {id:row.id};
}

/* ───── ورقة الاستدعاء ───── */
const SHEET_FIELDS=['location_id','map_link','call_time','wrap_time','day_schedule','safety_notes','weather_note','nearest_hospital','hospital_address','emergency_contact_name','emergency_contact_phone'];
function cleanSheet(db,production,input){
  const location=input.location_id||null;
  if(location&&!db.prepare('SELECT 1 FROM production_locations WHERE id=? AND production_id=? AND active=1').get(location,production.id))fail(400,'location_id','الموقع ليس من مواقع هذا الإنتاج');
  if(!Array.isArray(input.day_schedule)||input.day_schedule.length>40)fail(400,'day_schedule','جدول اليوم حتى أربعين بندًا');
  const schedule=input.day_schedule.map(line=>{v.object(line,['time','activity','note']);return {time:clock(line.time,'وقت البند'),activity:v.text(line.activity,'بند الجدول',200,2),note:optional(line.note,'ملاحظة البند',400)};});
  return {location,map:optional(input.map_link,'رابط الخريطة (يدخله المنتج)',600),call:clock(input.call_time,'وقت التجمع'),wrap:clock(input.wrap_time,'وقت الانتهاء المتوقع',{required:false}),
    schedule:JSON.stringify(schedule),safety:optional(input.safety_notes,'ملاحظات السلامة',3000),weather:optional(input.weather_note,'ملاحظة الطقس (إدخال يدوي من مصدر المنتج)',600),
    hospital:optional(input.nearest_hospital,'أقرب مستشفى',300),hospital_address:optional(input.hospital_address,'عنوان المستشفى',600),
    emergency:optional(input.emergency_contact_name,'جهة اتصال الطوارئ',180),emergency_phone:optional(input.emergency_contact_phone,'هاتف الطوارئ',40)};
}
function sheetRow(db,supplied,sheetId){
  const u=actor(db,supplied);
  const row=typeof sheetId==='string'&&db.prepare('SELECT * FROM call_sheets WHERE id=? AND tenant_id=?').get(sheetId,u.tenant_id);
  if(!row)fail(404,'not_found','ورقة الاستدعاء غير متاحة');
  const production=db.prepare('SELECT * FROM productions WHERE id=? AND tenant_id=?').get(row.production_id,u.tenant_id);
  const invited=!!db.prepare('SELECT 1 FROM call_sheet_invitees WHERE call_sheet_id=? AND user_id=?').get(row.id,u.id);
  const manage=can(db,u,'production.manage');
  if(!invited&&!manage)fail(404,'not_found','ورقة الاستدعاء غير متاحة');
  // المدعو يقرأ ما صدر فقط: المسودة فيها أرقام طوارئ وأماكن لم تُعتمد بعد، والملغاة لم تصدر له.
  if(!manage&&!['issued','superseded'].includes(row.status))fail(404,'not_found','ورقة الاستدعاء غير متاحة');
  return {u,row,production,invited};
}
// ما تحتاجه الورقة لتصدر (PRO-01 وPRO-03): جاهزية التصوير ليومها، وتصريح موقعها.
const sheetReadiness=(db,row,production)=>row.status==='draft'?shootReadiness(db,production,{date:row.shoot_date,location:row.location_id?db.prepare('SELECT * FROM production_locations WHERE id=?').get(row.location_id):null}):null;
function sheetActions(db,u,row,production,invitees,readiness=sheetReadiness(db,row,production)){
  const manage=can(db,u,'production.manage'),producer=production.producer_id===u.id,actions=[];
  if(manage&&producer&&row.status==='draft')actions.push('edit_sheet','add_invitee','remove_invitee','cancel_sheet');
  // من أعدّ الورقة لا يصدرها: الإصدار لحامل تصريح الإنتاج غير معدّها، وحين تكتمل جاهزيتها.
  if(manage&&!producer&&row.status==='draft'&&row.prepared_by!==u.id&&invitees.length&&JSON.parse(row.day_schedule).length&&readiness?.ready)actions.push('issue_sheet');
  if(manage&&producer&&row.status==='issued')actions.push('revise_sheet','cancel_sheet');
  return actions;
}
function inviteeView(db,u,row,sheet,production){
  const mine=row.user_id===u.id,producer=production.producer_id===u.id&&sheet.status==='issued'&&can(db,u,'production.manage'),actions=[];
  if(sheet.status==='issued'&&mine&&row.state==='sent')actions.push('mark_viewed');
  if(sheet.status==='issued'&&mine&&row.state!=='confirmed')actions.push('confirm');
  if(sheet.status==='issued'&&mine&&row.state!=='declined')actions.push('decline');
  if(producer&&!row.user_id)actions.push('record_response');
  return {...row,state_name:INVITEE_STATES[row.state],mine,responded_by_name:userName(db,row.responded_by),
    delivery_note:row.delivery==='in_platform'?'إشعار داخلي في المنصة':'لا حساب في المنصة: يبلغه المنتج خارجها ويسجل رده. لا رابط مشاركة عام في هذه النسخة',actions};
}
function sheetView(db,u,row,production){
  const invitees=db.prepare('SELECT * FROM call_sheet_invitees WHERE call_sheet_id=? ORDER BY party_kind,call_time,display_name').all(row.id);
  const location=row.location_id?db.prepare('SELECT * FROM production_locations WHERE id=?').get(row.location_id):null;
  const readiness=can(db,u,'production.manage')?sheetReadiness(db,row,production):null;
  // عنوان مقروء يلتقطه صندوق «بانتظار قراري» كما يلتقط عناوين بقية الوحدات.
  return {...row,title:`ورقة استدعاء ${production.code} · ${row.shoot_date} · النسخة ${row.revision}`,
    status_name:CALL_SHEET_STATES[row.status],production_code:production.code,production_title:production.title,
    prepared_by_name:userName(db,row.prepared_by),issued_by_name:userName(db,row.issued_by),
    location_name:location?.name??null,location_address:location?.address_note??'',location_contact:location?.contact_name??'',location_contact_phone:location?.contact_phone??'',
    location_permit:location?{required:!!location.permit_required,status:location.permit_status,status_name:PERMIT_STATES[location.permit_status],number:location.permit_number,issuer:location.permit_issuer,expires_on:location.permit_expires_on}:null,
    day_schedule:JSON.parse(row.day_schedule),
    invitees:invitees.map(i=>inviteeView(db,u,i,row,production)),
    counts:{invited:invitees.length,confirmed:invitees.filter(i=>i.state==='confirmed').length,declined:invitees.filter(i=>i.state==='declined').length,
      silent:invitees.filter(i=>i.state!=='confirmed'&&i.state!=='declined').length,outside:invitees.filter(i=>i.delivery==='outside_platform').length},
    readiness,actions:sheetActions(db,u,row,production,invitees,readiness)};
}
export function getCallSheet(db,supplied,sheetId){const {u,row,production}=sheetRow(db,supplied,sheetId);return sheetView(db,u,row,production);}

function inviteeLines(db,u,production,sheetId,lines,time){
  if(!Array.isArray(lines)||!lines.length||lines.length>120)fail(400,'invitees','استدعِ شخصًا واحدًا على الأقل');
  for(const line of lines){
    v.object(line,['party','call_time']);
    const [kind,partyId]=String(line.party??'').split(':');
    const at=clock(line.call_time,'وقت حضور المستدعى');
    if(kind==='crew'){
      const c=db.prepare('SELECT * FROM production_crew WHERE id=? AND production_id=? AND active=1').get(partyId,production.id);
      if(!c)fail(400,'party','المستدعى ليس من طاقم هذا الإنتاج');
      const name=c.source==='internal'?userName(db,c.user_id):db.prepare('SELECT legal_name FROM vendors WHERE id=?').get(c.vendor_id).legal_name;
      db.prepare("INSERT INTO call_sheet_invitees(id,tenant_id,call_sheet_id,party_kind,crew_id,user_id,display_name,call_time,delivery,state,created_at,updated_at) VALUES(?,?,?,'crew',?,?,?,?,?,'sent',?,?)")
        .run(id(),u.tenant_id,sheetId,c.id,c.user_id,`${name} — ${label(CREW_ROLES,c.role_key)}`,at,c.user_id?'in_platform':'outside_platform',time,time);
    }else if(kind==='talent'){
      const t=db.prepare('SELECT * FROM production_talent WHERE id=? AND production_id=? AND active=1').get(partyId,production.id);
      if(!t)fail(400,'party','المستدعى ليس من مواهب هذا الإنتاج');
      db.prepare("INSERT INTO call_sheet_invitees(id,tenant_id,call_sheet_id,party_kind,talent_id,display_name,call_time,delivery,state,created_at,updated_at) VALUES(?,?,?,'talent',?,?,?,'outside_platform','sent',?,?)")
        .run(id(),u.tenant_id,sheetId,t.id,`${t.full_name} — ${label(TALENT_KINDS,t.talent_kind)}`,at,time,time);
    }else fail(400,'party','المستدعى غير معروف');
  }
}
export function createCallSheet(db,supplied,input){
  writing(db);v.object(input,['production_id','shoot_date',...SHEET_FIELDS,'invitees']);
  const {u,row}=editableProduction(db,supplied,input.production_id);
  const date=v.date(input.shoot_date);
  if(date<row.shoot_from||date>row.shoot_to)fail(400,'shoot_date','يوم التصوير خارج مدة الإنتاج المسجلة');
  if(db.prepare("SELECT 1 FROM call_sheets WHERE production_id=? AND shoot_date=? AND status='draft'").get(row.id,date))fail(409,'draft_exists','لهذا اليوم مسودة ورقة استدعاء قائمة');
  if(db.prepare("SELECT 1 FROM call_sheets WHERE production_id=? AND shoot_date=? AND status='issued'").get(row.id,date))fail(409,'issued_exists','لهذا اليوم ورقة صادرة. التغيير يكون بإصدار نسخة جديدة منها');
  const f=cleanSheet(db,row,input),sheetId=id(),time=now();
  db.prepare("INSERT INTO call_sheets(id,tenant_id,production_id,shoot_date,revision,location_id,map_link,call_time,wrap_time,day_schedule,safety_notes,weather_note,nearest_hospital,hospital_address,emergency_contact_name,emergency_contact_phone,status,prepared_by,created_at,updated_at) VALUES(?,?,?,?,1,?,?,?,?,?,?,?,?,?,?,?,'draft',?,?,?)")
    .run(sheetId,u.tenant_id,row.id,date,f.location,f.map,f.call,f.wrap,f.schedule,f.safety,f.weather,f.hospital,f.hospital_address,f.emergency,f.emergency_phone,u.id,time,time);
  inviteeLines(db,u,row,sheetId,input.invitees,time);
  audit(db,u,'call_sheet',sheetId,'call_sheet.drafted',{}, {production:row.code,shoot_date:date,revision:1});
  return {id:sheetId};
}
export function callSheetAction(db,supplied,sheetId,action,input){
  writing(db);const {u,row,production}=sheetRow(db,supplied,sheetId);
  const invitees=db.prepare('SELECT * FROM call_sheet_invitees WHERE call_sheet_id=?').all(row.id);
  const key={edit:'edit_sheet',add_invitee:'add_invitee',remove_invitee:'remove_invitee',issue:'issue_sheet',revise:'revise_sheet',cancel:'cancel_sheet'}[action];
  const readiness=sheetReadiness(db,row,production);
  // PRO-03 وPRO-01: المُصدِر يطلب الإصدار والورقة غير جاهزة — رفضٌ يسمّي الموقع وتصريحه وكل اعتماد ناقص ومن يملكه.
  if(action==='issue'&&can(db,u,'production.manage')&&production.producer_id!==u.id&&row.status==='draft'&&row.prepared_by!==u.id&&readiness&&!readiness.ready){
    const place=row.location_id?db.prepare('SELECT name FROM production_locations WHERE id=?').get(row.location_id)?.name:null;
    refuse(409,'call_sheet_not_ready',{what:`ما تصدر ورقة استدعاء ${production.code} ليوم ${row.shoot_date}${place?` في «${place}»`:''} والناقص هذا`,missing:readiness.missing,
      next:'المنتج يسجّل التصريح الصادر من «تسجيل تصريح التصوير» أو يغيّر موقع الورقة، ويكمل اعتماد المعالجة ومخصص المشروع إن كانت ناقصة، وبعدها تصدر الورقة'});
  }
  if(!key||!sheetActions(db,u,row,production,invitees,readiness).includes(key))fail(409,'invalid_state','الإجراء غير متاح في حالة الورقة أو لحسابك');
  versioned(row,input);
  const time=now(),bump=(fields,values)=>db.prepare(`UPDATE call_sheets SET ${fields},version=version+1,updated_at=? WHERE id=?`).run(...values,time,row.id);
  let reason='',created=row.id;
  if(action==='edit'){
    v.object(input,['version',...SHEET_FIELDS,'change_summary']);const f=cleanSheet(db,production,input);
    const summary=row.revision===1?'':v.text(input.change_summary,'بيان ما تغير عن النسخة السابقة',2000,10);
    bump('location_id=?,map_link=?,call_time=?,wrap_time=?,day_schedule=?,safety_notes=?,weather_note=?,nearest_hospital=?,hospital_address=?,emergency_contact_name=?,emergency_contact_phone=?,change_summary=?',
      [f.location,f.map,f.call,f.wrap,f.schedule,f.safety,f.weather,f.hospital,f.hospital_address,f.emergency,f.emergency_phone,summary]);
  }else if(action==='add_invitee'){
    v.object(input,['version','invitees']);inviteeLines(db,u,production,row.id,input.invitees,time);bump('status=status',[]);
  }else if(action==='remove_invitee'){
    v.object(input,['version','invitee_id']);
    const line=invitees.find(i=>i.id===input.invitee_id);if(!line)fail(404,'not_found','المستدعى غير متاح');
    db.prepare('DELETE FROM call_sheet_invitees WHERE id=?').run(line.id);bump('status=status',[]);
  }else if(action==='issue'){
    v.object(input,['version','note']);reason=v.text(input.note,'أساس الإصدار: راجعت الجدول والسلامة وبيانات الطوارئ',2000,10);
    if(row.supersedes_id){
      const previous=db.prepare('SELECT * FROM call_sheets WHERE id=?').get(row.supersedes_id);
      if(previous.status!=='issued')fail(409,'invalid_state','النسخة السابقة لم تعد صادرة');
      db.prepare("UPDATE call_sheets SET status='superseded',version=version+1,updated_at=? WHERE id=?").run(time,previous.id);
    }
    bump("status='issued',issued_by=?,issued_at=?",[u.id,time]);
    db.prepare("UPDATE call_sheet_invitees SET notified_at=?,version=version+1,updated_at=? WHERE call_sheet_id=?").run(time,time,row.id);
  }else if(action==='revise'){
    v.object(input,['version','change_summary']);reason=v.text(input.change_summary,'ما الذي تغير عن النسخة الصادرة',2000,10);
    if(db.prepare("SELECT 1 FROM call_sheets WHERE production_id=? AND shoot_date=? AND status='draft'").get(row.production_id,row.shoot_date))fail(409,'draft_exists','توجد مسودة نسخة جديدة لهذا اليوم');
    created=id();
    db.prepare("INSERT INTO call_sheets(id,tenant_id,production_id,shoot_date,revision,supersedes_id,change_summary,location_id,map_link,call_time,wrap_time,day_schedule,safety_notes,weather_note,nearest_hospital,hospital_address,emergency_contact_name,emergency_contact_phone,status,prepared_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'draft',?,?,?)")
      .run(created,u.tenant_id,row.production_id,row.shoot_date,row.revision+1,row.id,reason,row.location_id,row.map_link,row.call_time,row.wrap_time,row.day_schedule,row.safety_notes,row.weather_note,row.nearest_hospital,row.hospital_address,row.emergency_contact_name,row.emergency_contact_phone,u.id,time,time);
    // كل من استُدعي في النسخة الصادرة يُستدعى في النسخة الجديدة ويُخطر بها من جديد.
    for(const line of invitees)db.prepare("INSERT INTO call_sheet_invitees(id,tenant_id,call_sheet_id,party_kind,crew_id,talent_id,user_id,display_name,call_time,delivery,state,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,'sent',?,?)")
      .run(id(),u.tenant_id,created,line.party_kind,line.crew_id,line.talent_id,line.user_id,line.display_name,line.call_time,line.delivery,time,time);
  }else if(action==='cancel'){
    v.object(input,['version','note']);reason=v.text(input.note,'سبب الإلغاء وكيف أُبلغ من استُدعي',2000,5);
    bump("status='cancelled',cancel_note=?",[reason]);
  }
  audit(db,u,'call_sheet',row.id,'call_sheet.'+action,{status:row.status},{id:created},reason);
  return {id:created};
}
export function respondToCallSheet(db,supplied,inviteeId,input){
  writing(db);const u=actor(db,supplied);
  v.object(input,['version','state','note']);
  const line=typeof inviteeId==='string'&&db.prepare('SELECT * FROM call_sheet_invitees WHERE id=? AND tenant_id=?').get(inviteeId,u.tenant_id);
  if(!line)fail(404,'not_found','الاستدعاء غير متاح');
  const sheet=db.prepare('SELECT * FROM call_sheets WHERE id=?').get(line.call_sheet_id),production=db.prepare('SELECT * FROM productions WHERE id=?').get(sheet.production_id);
  if(sheet.status!=='issued')fail(409,'invalid_state','الرد على ورقة استدعاء صادرة فقط');
  versioned(line,input);
  if(!Object.hasOwn(INVITEE_STATES,input.state)||input.state==='sent')fail(400,'state','اختر: اطّلعت أو أؤكد أو أعتذر');
  const mine=line.user_id===u.id,time=now();
  let source='self',note=optional(input.note,'ملاحظة الرد',1000);
  if(!mine){
    // نيابة عمن لا حساب له: يسجلها منتج العمل ويذكر كيف وصل الرد. لا تُسجل نيابة عن صاحب حساب.
    if(line.user_id)fail(403,'not_your_invitation','صاحب الحساب يرد بنفسه');
    if(production.producer_id!==u.id||!can(db,u,'production.manage'))fail(403,'not_permitted','تسجيل رد من خارج المنصة لمنتج العمل');
    if(input.state==='viewed')fail(400,'state','«اطّلع» حالة يسجلها صاحب الحساب وحده');
    source='recorded_outside';note=v.text(input.note,'كيف وصل الرد ومتى (اتصال، رسالة، حضور)',1000,5);
  }
  db.prepare('UPDATE call_sheet_invitees SET state=?,response_source=?,response_note=?,responded_at=?,responded_by=?,version=version+1,updated_at=? WHERE id=?')
    .run(input.state,source,note,time,u.id,time,line.id);
  audit(db,u,'call_sheet_invitee',line.id,'call_sheet.'+input.state,{state:line.state},{state:input.state,source},note);
  return {id:line.id,state:input.state};
}

/* ───── اللوحات ───── */
export function productionsBoard(db,supplied){
  const u=actor(db,supplied);manages(db,u);
  const rows=db.prepare("SELECT * FROM productions WHERE tenant_id=? ORDER BY status IN ('closed','cancelled'),shoot_from DESC LIMIT 200").all(u.tenant_id);
  return {today:today(),user_id:u.id,kinds:KINDS,states:STATES,crew_roles:CREW_ROLES,talent_kinds:TALENT_KINDS,release_states:RELEASE_STATES,permit_states:PERMIT_STATES,shot_sizes:SHOT_SIZES,camera_angles:CAMERA_ANGLES,shot_states:SHOT_STATES,
    clients:db.prepare("SELECT id,legal_name,trade_name FROM clients WHERE tenant_id=? AND status<>'closed' ORDER BY legal_name").all(u.tenant_id).map(c=>({id:c.id,name:c.trade_name||c.legal_name})),
    campaigns:db.prepare("SELECT id,name FROM campaigns WHERE tenant_id=? AND status NOT IN ('completed','cancelled') ORDER BY name").all(u.tenant_id),
    projects:db.prepare('SELECT id,name FROM projects WHERE tenant_id=? ORDER BY name').all(u.tenant_id),
    people:db.prepare('SELECT id,name FROM users WHERE tenant_id=? AND active=1 ORDER BY name').all(u.tenant_id),
    vendors:db.prepare("SELECT id,code,legal_name,status FROM vendors WHERE tenant_id=? AND status<>'merged' ORDER BY legal_name").all(u.tenant_id),
    // المعالجات التي يربطها المنتج: مسارات مراجعة جارية أو موافَق عليها في مشاريع هو عضو فيها.
    treatments:db.prepare(`SELECT r.id,r.name,r.status,r.output_revision,ver.snapshot FROM review_routes r JOIN studio_output_versions ver ON ver.id=r.output_version_id
      JOIN studio_workspaces w ON w.id=r.studio_id JOIN project_members m ON m.project_id=w.project_id AND m.user_id=? WHERE r.tenant_id=? AND r.status IN ('running','approved','approved_with_changes') ORDER BY r.opened_at DESC LIMIT 200`)
      .all(u.id,u.tenant_id).map(r=>({id:r.id,name:`${r.name} · ${JSON.parse(r.snapshot).title??''} · النسخة ${r.output_revision}`,status:r.status,status_name:ROUTE_STATUS[r.status]})),
    productions:rows.map(r=>productionView(db,u,r)),
    note:'لا اتصال خارجي في هذه الوحدة: رابط الخريطة والطقس وأقرب مستشفى إدخال يدوي. المستقل الخارجي مورد ومستحقه يمر بدورة المدفوعات، ولا يظهر هنا أجر موظف داخلي ولا تكلفته. الميزانية مخصص المشروع في شاشة المخصصات ولا تُكرر هنا.'};
}
export function callSheetsBoard(db,supplied){
  const u=actor(db,supplied),manage=can(db,u,'production.manage');
  const mineRows=db.prepare(`SELECT s.* FROM call_sheets s JOIN call_sheet_invitees i ON i.call_sheet_id=s.id
    WHERE s.tenant_id=? AND i.user_id=? AND s.status='issued' ORDER BY s.shoot_date`).all(u.tenant_id,u.id);
  const sheetRows=manage?db.prepare("SELECT * FROM call_sheets WHERE tenant_id=? ORDER BY shoot_date DESC,revision DESC LIMIT 200").all(u.tenant_id):[];
  const production=sheetId=>db.prepare('SELECT * FROM productions WHERE id=(SELECT production_id FROM call_sheets WHERE id=?)').get(sheetId);
  const view=r=>sheetView(db,u,r,production(r.id));
  const mine=mineRows.map(view).map(s=>({...s,my_line:s.invitees.find(i=>i.mine)??null}));
  return {today:today(),user_id:u.id,can_manage:manage,states:CALL_SHEET_STATES,invitee_states:INVITEE_STATES,
    my_invitations:mine.map(s=>({id:s.id,title:`استدعاؤك · ${s.production_title} · ${s.shoot_date}`,production_code:s.production_code,production_title:s.production_title,shoot_date:s.shoot_date,revision:s.revision,
      call_time:s.my_line?.call_time??s.call_time,location_name:s.location_name,change_summary:s.change_summary,state:s.my_line?.state??'sent',state_name:INVITEE_STATES[s.my_line?.state??'sent'],
      invitee_id:s.my_line?.id??null,version:s.my_line?.version??null,actions:s.my_line?.actions??[]})),
    // ما تحتاجه شاشة الورقة لبناء قوائمها: مواقع الإنتاج ومن يمكن استدعاؤه. بلا أي رقم مالي.
    productions:manage?db.prepare("SELECT id,code,title,status,shoot_from,shoot_to,producer_id FROM productions WHERE tenant_id=? AND status IN ('planning','in_production') ORDER BY shoot_from").all(u.tenant_id)
      .filter(p=>p.producer_id===u.id).map(p=>({...p,
        locations:db.prepare('SELECT id,name FROM production_locations WHERE production_id=? AND active=1 ORDER BY name').all(p.id),
        invitees:[...db.prepare('SELECT c.id,c.role_key,c.source,c.user_id,c.vendor_id,x.name AS user_name,ve.legal_name AS vendor_name FROM production_crew c LEFT JOIN users x ON x.id=c.user_id LEFT JOIN vendors ve ON ve.id=c.vendor_id WHERE c.production_id=? AND c.active=1').all(p.id)
          .map(c=>({value:`crew:${c.id}`,label:`${c.source==='internal'?c.user_name:c.vendor_name} — ${label(CREW_ROLES,c.role_key)}`})),
        ...db.prepare('SELECT id,full_name,talent_kind FROM production_talent WHERE production_id=? AND active=1').all(p.id)
          .map(t=>({value:`talent:${t.id}`,label:`${t.full_name} — ${label(TALENT_KINDS,t.talent_kind)}`}))]})):[],
    sheets:sheetRows.map(view),
    note:'ورقة الاستدعاء الصادرة لا تُعدَّل: التغيير نسخة جديدة تقول ما تغير ويُخطر بها كل من استُدعي. من له حساب يصله إشعار داخلي ويرد بنفسه؛ ومن لا حساب له يبلغه المنتج خارج المنصة ويسجل رده — لا رابط مشاركة عام في هذه النسخة. الطقس والخرائط وأقرب مستشفى حقول يدوية لا تُجلب آليًا.'};
}

/* ───── نسخة الطباعة ───── */
// نسخة للطباعة يحفظها المستخدم PDF من المتصفح، على نمط app/print-documents.mjs. لا مولّد PDF داخل المنصة.
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
// الذيل يقرأ tenants.demo_data (الترحيل 137) بدل أن يكتب بحرفه أن البيانات مصطنعة. الوسيط الأخير اختياري وافتراضه
// الحالة المصطنعة: موضع نداء لم يُحدَّث يبقى يطبع التحذير، ولا يسقطه صامتًا عن ورقة استدعاء صارت حقيقية.
export function callSheetPrintable(s,demoData=SYNTHETIC){
  const rows=(list,cells)=>list.map(cells).join(''),issued=s.status==='issued';
  const state=s.status==='superseded'?'استُبدلت بنسخة أحدث — لا يُعمل بها':s.status==='cancelled'?'ملغاة':issued?'صادرة':'مسودة لم تُصدر بعد — ليست ورقة استدعاء';
  return `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(`ورقة استدعاء ${s.production_code} ${s.shoot_date}`)}</title><link rel="stylesheet" href="/report-print.css"></head><body class="doc">
    <header><p class="brand">3,6T</p><h1>ورقة استدعاء — ${esc(s.production_title)}</h1>
    <p class="meta">${esc(s.production_code)} · يوم التصوير ${esc(s.shoot_date)} (${esc(hijri(s.shoot_date))}) · النسخة ${esc(s.revision)} · وقت التجمع <bdi dir="ltr">${esc(s.call_time)}</bdi>${s.wrap_time?` · الانتهاء المتوقع <bdi dir="ltr">${esc(s.wrap_time)}</bdi>`:''}</p></header>
    <p class="notice">${esc(state)}.${s.revision>1?` هذه النسخة ${esc(s.revision)} وتحل محل ما قبلها. ما تغير: ${esc(s.change_summary)}`:''} الطقس ورابط الخريطة وأقرب مستشفى وجهة اتصال الطوارئ أدخلها المنتج يدويًا؛ لا تجلبها المنصة من أي مصدر خارجي.</p>
    <div class="parties">
      <section class="party"><h2>الموقع</h2><p><strong>${esc(s.location_name??'لم يُحدد')}</strong></p><p>${esc(s.location_address)}</p>${s.location_contact?`<p>جهة الاتصال: ${esc(s.location_contact)}${s.location_contact_phone?` · <bdi dir="ltr">${esc(s.location_contact_phone)}</bdi>`:''}</p>`:''}${s.map_link?`<p>الخريطة: <bdi dir="ltr">${esc(s.map_link)}</bdi></p>`:''}${s.location_permit?.required?`<p>تصريح التصوير: ${esc(s.location_permit.status_name)}${s.location_permit.number?` · رقم <bdi dir="ltr">${esc(s.location_permit.number)}</bdi> من ${esc(s.location_permit.issuer)} حتى ${esc(s.location_permit.expires_on)}`:''}</p>`:'<p>الموقع لا يتطلب تصريحًا بحسب قرار المنتج.</p>'}</section>
      <section class="party"><h2>الطوارئ والسلامة</h2><p><strong>أقرب مستشفى:</strong> ${esc(s.nearest_hospital||'لم يُدخل')}</p><p>${esc(s.hospital_address)}</p><p><strong>جهة اتصال الطوارئ:</strong> ${esc(s.emergency_contact_name||'لم تُدخل')}${s.emergency_contact_phone?` · <bdi dir="ltr">${esc(s.emergency_contact_phone)}</bdi>`:''}</p>${s.weather_note?`<p>الطقس (إدخال يدوي): ${esc(s.weather_note)}</p>`:''}</section>
    </div>
    <h2>جدول اليوم</h2><table><thead><tr><th>الوقت</th><th>البند</th><th>ملاحظة</th></tr></thead><tbody>${rows(s.day_schedule,l=>`<tr><td><bdi dir="ltr">${esc(l.time)}</bdi></td><td>${esc(l.activity)}</td><td>${esc(l.note)}</td></tr>`)||'<tr><td colspan="3">لا بنود</td></tr>'}</tbody></table>
    <h2>المستدعون</h2><table><thead><tr><th>الاسم والدور</th><th>الفئة</th><th>وقت الحضور</th><th>الحالة</th><th>التبليغ</th></tr></thead><tbody>${rows(s.invitees,i=>`<tr><td>${esc(i.display_name)}</td><td>${esc(i.party_kind==='crew'?'طاقم':'موهبة')}</td><td><bdi dir="ltr">${esc(i.call_time)}</bdi></td><td>${esc(i.state_name)}${i.response_source==='recorded_outside'?' (سجله المنتج)':''}</td><td>${esc(i.delivery==='in_platform'?'إشعار داخلي':'خارج المنصة')}</td></tr>`)||'<tr><td colspan="5">لا مستدعين</td></tr>'}</tbody></table>
    ${s.safety_notes?`<h2>ملاحظات السلامة</h2><p>${esc(s.safety_notes)}</p>`:''}
    <p class="meta">أعدّها ${esc(s.prepared_by_name)}${s.issued_by_name?` · أصدرها ${esc(s.issued_by_name)} في ${esc(String(s.issued_at).slice(0,10))}`:''}</p>
    <footer>${esc(documentFooter(demoData))}</footer></body></html>`;
}
