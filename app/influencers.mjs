import { randomUUID } from 'node:crypto';
import { audit, now } from './db.mjs';
import { fail } from './auth.mjs';
import * as v from './validation.mjs';
import { currentUser } from './delegations.mjs';
import { can } from './access.mjs';
import { clientFor, memberClients } from './agency.mjs';
import { vendorGate } from './vendors.mjs';
import { refuse } from './refusal.mjs';
import { bindableVersion, bindableVersions, assertPublishable, versionLabel } from './approved-version.mjs';

// المؤثرون وصناع المحتوى. المنصة لا تتصل بأي منصة تواصل: لا تجلب متابعين ولا تقيس تفاعلًا ولا تتحقق من نشر.
// كل رقم هنا لقطة أدخلها موظف بمصدرها وتاريخها، وكل إثبات نشر يتحقق منه إنسان باسمه ووقته.
export const PLATFORMS=[['instagram','إنستغرام'],['tiktok','تيك توك'],['snapchat','سناب شات'],['x','إكس'],['youtube','يوتيوب'],['podcast','بودكاست'],['other','منصة أخرى']].map(([key,name])=>({key,name}));
export const CATEGORIES=[['lifestyle','نمط حياة'],['food','طعام ومطاعم'],['beauty','جمال وعناية'],['tech','تقنية'],['family','أسرة وطفل'],['sports','رياضة'],['travel','سفر'],['business','أعمال وريادة'],['other','فئة أخرى']].map(([key,name])=>({key,name}));
export const CONTACT_MODES=[['agency','عبر وكيل'],['direct','تواصل مباشر']].map(([key,name])=>({key,name}));
export const USAGE_SCOPES=[['organic_only','عضوي فقط على حسابات المؤثر'],['paid_ads','يشمل إعادة النشر في إعلان مدفوع']].map(([key,name])=>({key,name}));
export const CONTENT_KINDS=[['post','منشور'],['story','قصة'],['video','فيديو']].map(([key,name])=>({key,name}));
export const APPROVAL_CHANNELS=[['email','بريد إلكتروني'],['signed_document','مستند موقع'],['meeting_minutes','محضر اجتماع معتمد'],['message','رسالة أو تطبيق تواصل']].map(([key,name])=>({key,name}));
export const VERIFICATION_METHODS=[['human_open_link','فتح الرابط والاطلاع عليه'],['human_screenshot_review','مطابقة اللقطة المرفقة']].map(([key,name])=>({key,name}));
export const INFLUENCER_STATES={draft:'مسودة',active:'متاح للتعاقد',paused:'موقوف مؤقتًا',blocked:'غير مرغوب'};
export const ENGAGEMENT_STATES={draft:'مسودة',internal_review:'بانتظار الاعتماد الداخلي',active:'سارٍ',completed:'مقفل',cancelled:'ملغى'};
export const CONTENT_STATES={proposed:'مقترح',internal_review:'مراجعة داخلية',client_review:'لدى العميل',client_approved:'معتمد من العميل',published:'نُشر',cancelled:'ملغى'};
// نص يُعرض كما هو في الشاشة. مصدره ثانوي ولم يُتحقق منه رسميًا، فلا يُذكر اسم جهة ولا نظام بعينه.
export const LICENCE_NOTICE='الترويج الإعلاني المدفوع لجمهور داخل المملكة يتطلب رخصة من الجهة المنظّمة. هذا المتطلب مصدره ثانوي ولم يُتحقق منه رسميًا — يحتاج تأكيد المختص القانوني.';
export const MANUAL_METRIC_NOTE='مُدخل يدويًا من لقطة، غير متحقق منه';

const KIND_FIELD={post:'posts_count',story:'stories_count',video:'videos_count'};
const platformKeys=new Set(PLATFORMS.map(p=>p.key)),categoryKeys=new Set(CATEGORIES.map(c=>c.key));
const id=()=>randomUUID();
const today=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Riyadh',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const days=(from,to)=>Math.round((Date.parse(to)-Date.parse(from))/86400000);
const name=(db,userId)=>userId?db.prepare('SELECT name FROM users WHERE id=?').get(userId)?.name??null:null;
// معرّف الحساب كما تقرؤه المنصات: بلا اعتبار لحالة الأحرف ولا لـ@ في أوله (الترحيل 189). التعبير نفسه في محفّز القاعدة.
const handleKey=handle=>String(handle??'').trim().replace(/^@+/,'').toLowerCase();
const HANDLE_KEY_SQL="lower(ltrim(trim(a.handle),'@'))";
function writing(db){if(!db.isTransaction)fail(500,'transaction_required','تتطلب كتابة سجل المؤثرين معاملة قاعدة بيانات');}
function actor(db,supplied){const c=currentUser(db,supplied);if(!c)fail(403,'forbidden','الحساب غير متاح');return c;}
function permitted(db,supplied){
  const u=actor(db,supplied);
  if(!can(db,u,'influencers.manage'))fail(403,'not_permitted','وحدة المؤثرين تحتاج تصريح إدارة المؤثرين. اطلبه من مسؤول الصلاحيات');
  return u;
}
function versioned(row,input){if(!Number.isInteger(input?.version)||input.version!==row.version)fail(409,'stale_version','تغير السجل منذ فتحه. أعد التحميل');}
function money(value,label){
  if(typeof value!=='string'||!/^(?:0|[1-9]\d{0,9})(?:\.\d{1,2})?$/.test(value))fail(400,'invalid_money',`${label}: مبلغ بخانتين عشريتين كحد أقصى`);
  const [whole,fraction='']=value.split('.'),minor=Number(BigInt(whole)*100n+BigInt(fraction.padEnd(2,'0')));
  if(minor<=0)fail(400,'invalid_money',`${label}: مبلغ موجب`);
  return minor;
}
const count=(value,label)=>{if(!Number.isInteger(value)||value<0||value>500)fail(400,'deliverables',`${label}: عدد صحيح من 0 إلى 500`);return value;};
const optional=(value,label,max)=>value===undefined||value===null||value===''?'':v.text(value,label,max);

/* ───── سجل المؤثر ───── */
// حالة الرخصة تنبيه لا منع: «لم تُسجل» و«منتهية» و«تنتهي قبل نهاية الارتباط» كلها تحتاج إقرارًا مكتوبًا عند الاعتماد.
export function licenceState(row,date,until=null){
  if(!row.licence_number)return {state:'missing',name:'لم تُسجل رخصة ترويج إعلاني',expires_on:null,days_left:null,needs_ack:true};
  const left=days(date,row.licence_expires_on);
  if(left<0)return {state:'expired',name:`انتهت الرخصة في ${row.licence_expires_on}`,expires_on:row.licence_expires_on,days_left:left,needs_ack:true};
  if(until&&row.licence_expires_on<until)return {state:'lapses',name:`الرخصة تنتهي في ${row.licence_expires_on} قبل نهاية الارتباط`,expires_on:row.licence_expires_on,days_left:left,needs_ack:true};
  return {state:'recorded',name:`رخصة مسجلة سارية حتى ${row.licence_expires_on}`,expires_on:row.licence_expires_on,days_left:left,needs_ack:false,expiring:left<=60};
}
function accountsOf(db,influencerId){
  const rows=db.prepare('SELECT a.*,x.name AS added_by_name FROM influencer_accounts a JOIN users x ON x.id=a.added_by WHERE a.influencer_id=? ORDER BY a.platform,a.handle').all(influencerId);
  return rows.map(a=>{
    const snapshots=db.prepare('SELECT m.*,x.name AS recorded_by_name FROM influencer_metrics m JOIN users x ON x.id=m.recorded_by WHERE m.account_id=? ORDER BY m.captured_on DESC,m.created_at DESC').all(a.id);
    const corrected=new Set(snapshots.filter(m=>m.corrects_id).map(m=>m.corrects_id));
    return {...a,active:!!a.active,platform_name:PLATFORMS.find(p=>p.key===a.platform)?.name??a.platform,
      // لا مجموع ولا متوسط ولا نسبة: اللقطة تُعرض كما أُدخلت، بمصدرها وتاريخها ومن أدخلها.
      snapshots:snapshots.map(m=>({...m,superseded:corrected.has(m.id),entry_note:MANUAL_METRIC_NOTE}))};
  });
}
function influencerView(db,u,row,date){
  const licence=licenceState(row,date),vendor=row.vendor_id?db.prepare('SELECT id,code,legal_name,status,supplier_key FROM vendors WHERE id=?').get(row.vendor_id):null;
  const engagements=db.prepare("SELECT COUNT(*) AS n FROM influencer_engagements WHERE influencer_id=? AND status NOT IN ('cancelled')").get(row.id).n;
  const accounts=accountsOf(db,row.id),actions=[];
  if(row.status!=='blocked'){
    actions.push('edit_influencer','add_account','set_licence','set_status');
    if(accounts.some(a=>a.active))actions.push('record_snapshot','retire_account');
    if(!row.vendor_id)actions.push('link_vendor');
  }else actions.push('set_status');
  return {...row,category_name:CATEGORIES.find(c=>c.key===row.category)?.name??row.category,contact_mode_name:CONTACT_MODES.find(c=>c.key===row.contact_mode)?.name??row.contact_mode,
    status_name:INFLUENCER_STATES[row.status],created_by_name:name(db,row.created_by),accounts,licence,
    vendor:vendor?{id:vendor.id,code:vendor.code,legal_name:vendor.legal_name,status:vendor.status}:null,
    engagements_count:engagements,actions};
}
const INFLUENCER_FIELDS=['stage_name','category','contact_mode','agency_name','contact_name','contact_channel','notes'];
function cleanInfluencer(input){
  if(!categoryKeys.has(input.category))fail(400,'category','اختر فئة المحتوى');
  if(!['agency','direct'].includes(input.contact_mode))fail(400,'contact_mode','اختر جهة التواصل: وكيل أو مباشر');
  const agency=optional(input.agency_name,'اسم الوكيل',180);
  if(input.contact_mode==='agency'&&agency.length<2)fail(400,'agency_name','اكتب اسم الوكيل الذي يمثل المؤثر');
  if(input.contact_mode==='direct'&&agency)fail(400,'agency_name','التواصل المباشر بلا وكيل');
  return {stage_name:v.text(input.stage_name,'الاسم المهني',180,2),category:input.category,contact_mode:input.contact_mode,agency_name:agency,
    contact_name:v.text(input.contact_name,'اسم جهة التواصل',180,2),contact_channel:v.text(input.contact_channel,'بريد أو هاتف جهة التواصل',180,3),notes:optional(input.notes,'ملاحظات',3000)};
}
export function createInfluencer(db,supplied,input){
  writing(db);const u=permitted(db,supplied);
  v.object(input,INFLUENCER_FIELDS);
  const f=cleanInfluencer(input);
  if(db.prepare('SELECT 1 FROM influencers WHERE tenant_id=? AND stage_name=?').get(u.tenant_id,f.stage_name))fail(409,'duplicate_influencer','يوجد ملف بالاسم المهني نفسه');
  const influencerId=id(),time=now(),code='INF-'+String(db.prepare('SELECT COUNT(*) AS n FROM influencers WHERE tenant_id=?').get(u.tenant_id).n+1).padStart(4,'0');
  db.prepare("INSERT INTO influencers(id,tenant_id,code,stage_name,category,contact_mode,agency_name,contact_name,contact_channel,notes,status,created_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,'draft',?,?,?)")
    .run(influencerId,u.tenant_id,code,f.stage_name,f.category,f.contact_mode,f.agency_name,f.contact_name,f.contact_channel,f.notes,u.id,time,time);
  audit(db,u,'influencer',influencerId,'influencer.created',{}, {code,category:f.category});
  return {id:influencerId};
}
function influencerRow(db,supplied,influencerId){
  const u=permitted(db,supplied);
  const row=typeof influencerId==='string'&&db.prepare('SELECT * FROM influencers WHERE id=? AND tenant_id=?').get(influencerId,u.tenant_id);
  if(!row)fail(404,'not_found','ملف المؤثر غير متاح');
  return {u,row};
}
export function influencerAction(db,supplied,influencerId,action,input){
  writing(db);
  const fields={edit_influencer:INFLUENCER_FIELDS,add_account:['platform','handle','profile_url'],retire_account:['account_id','note'],
    record_snapshot:['account_id','metric','value','unit','captured_on','source','corrects_id'],
    set_licence:['licence_number','licence_expires_on','licence_source'],link_vendor:['vendor_id','note'],set_status:['status','note']}[action];
  if(!fields)fail(404,'not_found','الإجراء غير متاح');
  v.object(input,['version',...fields]);
  const {u,row}=influencerRow(db,supplied,influencerId),date=today(),view=influencerView(db,u,row,date);
  if(!view.actions.includes(action))fail(409,'action_unavailable','الإجراء غير متاح في حالة الملف أو لصلاحيتك');
  versioned(row,input);
  const time=now(),bump=(sql,values=[])=>db.prepare(`UPDATE influencers SET ${sql},version=version+1,updated_at=? WHERE id=? AND version=?`).run(...values,time,row.id,row.version);
  let after={};
  if(action==='edit_influencer'){
    const f=cleanInfluencer(input);
    if(f.stage_name!==row.stage_name&&db.prepare('SELECT 1 FROM influencers WHERE tenant_id=? AND stage_name=? AND id<>?').get(u.tenant_id,f.stage_name,row.id))fail(409,'duplicate_influencer','يوجد ملف بالاسم المهني نفسه');
    bump('stage_name=?,category=?,contact_mode=?,agency_name=?,contact_name=?,contact_channel=?,notes=?',[f.stage_name,f.category,f.contact_mode,f.agency_name,f.contact_name,f.contact_channel,f.notes]);
  }else if(action==='add_account'){
    if(!platformKeys.has(input.platform))fail(400,'platform','اختر المنصة');
    const handle=v.text(input.handle,'اسم الحساب',120,2),url=optional(input.profile_url,'رابط الحساب',500);
    // الرابط يُعرض قابلًا للنقر؛ javascript: أو data: أو نص بمسافات لا يُحفظ رابطًا.
    if(url&&!/^https?:\/\/\S+$/.test(url))fail(400,'profile_url','رابط الحساب يبدأ بـ http أو https وبلا مسافات');
    // INF-01: الحساب النشط نفسه على ملف واحد في الكيان كله، لا في الملف وحده. الرفض يسمّي الملف الذي يحمله.
    const holder=db.prepare(`SELECT x.id,x.code,x.stage_name FROM influencer_accounts a JOIN influencers x ON x.id=a.influencer_id
      WHERE x.tenant_id=? AND a.platform=? AND a.active=1 AND ${HANDLE_KEY_SQL}=?`).get(u.tenant_id,input.platform,handleKey(handle));
    const platform=PLATFORMS.find(p=>p.key===input.platform).name;
    if(holder)refuse(409,'duplicate_account',holder.id===row.id
      ?{what:`الحساب ${handle} على ${platform} مسجل في هالملف أصلًا`,next:'ما يحتاج تسجيله مرة ثانية'}
      :{what:`الحساب ${handle} على ${platform} مسجل على ملف ${holder.code} «${holder.stage_name}»`,
        missing:[{document:'قرار: أي الملفين صاحب الحساب',why:'الحساب الواحد على ملف مؤثر واحد، والملف الثاني يكرر الشخص',owner:'مسؤول المؤثرين',owner_role:'influencers'}],
        next:'إذا كان نفس الشخص فاشتغل على ملفه القائم ولا تفتح ملفًا ثانيًا؛ وإذا انسجل الحساب غلط على الملف الآخر فعطّله منه أولًا ثم أضفه هنا'});
    if(db.prepare('SELECT 1 FROM influencer_accounts WHERE influencer_id=? AND platform=? AND handle=?').get(row.id,input.platform,handle))fail(409,'duplicate_account','الحساب مسجل على المنصة نفسها');
    db.prepare('INSERT INTO influencer_accounts(id,influencer_id,platform,handle,profile_url,added_by,created_at) VALUES(?,?,?,?,?,?,?)').run(id(),row.id,input.platform,handle,url,u.id,time);
    bump('status=status');after={platform:input.platform};
  }else if(action==='retire_account'){
    const account=view.accounts.find(a=>a.id===input.account_id&&a.active);
    if(!account)fail(404,'not_found','الحساب غير متاح');
    v.text(input.note,'سبب تعطيل الحساب',1000,5);
    db.prepare('UPDATE influencer_accounts SET active=0 WHERE id=?').run(account.id);
    bump('status=status');after={retired_account:account.handle};
  }else if(action==='record_snapshot'){
    const account=view.accounts.find(a=>a.id===input.account_id&&a.active);
    if(!account)fail(404,'not_found','الحساب غير متاح');
    if(!Number.isInteger(input.value)||input.value<0||input.value>1e12)fail(400,'value','القيمة عدد صحيح غير سالب');
    const captured=v.date(input.captured_on);
    if(captured>date)fail(400,'captured_on','تاريخ اللقطة لا يكون مستقبليًا');
    let corrects=null;
    if(input.corrects_id){
      const previous=db.prepare('SELECT m.id FROM influencer_metrics m WHERE m.id=? AND m.account_id=?').get(input.corrects_id,account.id);
      if(!previous||db.prepare('SELECT 1 FROM influencer_metrics WHERE corrects_id=?').get(input.corrects_id))fail(400,'corrects_id','اللقطة المصححة غير متاحة أو سبق تصحيحها');
      corrects=previous.id;
    }
    db.prepare("INSERT INTO influencer_metrics(id,account_id,metric,value,unit,captured_on,entry_method,source,corrects_id,recorded_by,created_at) VALUES(?,?,?,?,?,?,'manual_snapshot',?,?,?,?)")
      .run(id(),account.id,v.text(input.metric,'اسم الرقم كما ظهر في اللقطة',120,2),input.value,optional(input.unit,'الوحدة',40),captured,v.text(input.source,'مصدر اللقطة ومكان حفظها',600,5),corrects,u.id,time);
    bump('status=status');after={metric:input.metric,manual:true};
  }else if(action==='set_licence'){
    const number=optional(input.licence_number,'رقم الرخصة',80);
    if(!number){
      if(input.licence_expires_on||input.licence_source)fail(400,'licence_number','لا تُسجل مدة أو مصدر لرخصة بلا رقم');
      bump("licence_number='',licence_expires_on=NULL,licence_source=''");
    }else{
      const expires=v.date(input.licence_expires_on);
      bump('licence_number=?,licence_expires_on=?,licence_source=?',[number,expires,v.text(input.licence_source,'مصدر معلومة الرخصة ومكان حفظ نسختها',600,5)]);
    }
    after={licence_recorded:!!number};
  }else if(action==='link_vendor'){
    const vendor=db.prepare('SELECT * FROM vendors WHERE id=? AND tenant_id=?').get(input.vendor_id,u.tenant_id);
    if(!vendor)fail(404,'not_found','ملف المورد غير متاح');
    if(db.prepare('SELECT 1 FROM influencers WHERE tenant_id=? AND vendor_id=? AND id<>?').get(u.tenant_id,vendor.id,row.id))fail(409,'vendor_linked','ملف المورد مرتبط بمؤثر آخر');
    v.text(input.note,'أساس الربط بملف المورد',1000,5);
    bump('vendor_id=?',[vendor.id]);after={vendor:vendor.code};
  }else if(action==='set_status'){
    if(!INFLUENCER_STATES[input.status])fail(400,'status','حالة غير صالحة');
    if(input.status===row.status)fail(409,'invalid_state','الحالة كما هي');
    bump('status=?,notes=notes||?',[input.status,`\n${date}: ${v.text(input.note,'سبب تغيير الحالة',1000,5)}`]);
    after={status:input.status};
  }
  audit(db,u,'influencer',row.id,'influencer.'+action,{version:row.version,status:row.status},{version:row.version+1,...after});
  return {id:row.id};
}

/* ───── التعاقد والمخرجات ───── */
function engagementRow(db,supplied,engagementId){
  const u=permitted(db,supplied);
  const row=typeof engagementId==='string'&&db.prepare('SELECT * FROM influencer_engagements WHERE id=? AND tenant_id=?').get(engagementId,u.tenant_id);
  if(!row)fail(404,'not_found','الارتباط غير متاح');
  const {c}=clientFor(db,supplied,row.client_id);
  return {u,c,row};
}
function proofOf(db,u,contentRow){
  const proof=db.prepare('SELECT * FROM influencer_proofs WHERE content_id=?').get(contentRow.id);
  if(!proof)return null;
  return {...proof,disclosure_confirmed:!!proof.disclosure_confirmed,recorded_by_name:name(db,proof.recorded_by),verified_by_name:name(db,proof.verified_by),
    method_name:VERIFICATION_METHODS.find(m=>m.key===proof.verification_method)?.name??'',
    // ملفات اللقطة تُربط بنظام الملفات حين يُسجَّل نوع السجل هناك؛ حتى ذلك الحين المرجع النصي هو الدليل.
    // لقطة الإثبات ملفٌّ يُرفع على الإثبات نفسه (نوع influencer_proof مسجّل منذ الترحيل 189، وصلاحيته proofFileAccess أدناه).
    attachments:db.prepare("SELECT COUNT(*) AS n FROM stored_files WHERE tenant_id=? AND entity_type='influencer_proof' AND entity_id=?").get(u.tenant_id,proof.id).n,
    actions:!proof.verified_by&&proof.recorded_by!==u.id?['verify_proof']:[]};
}
function contentView(db,u,row,engagement){
  const proof=proofOf(db,u,row),own=row.proposed_by===u.id,actions=[];
  if(engagement.status==='active'){
    if(['proposed','internal_review'].includes(row.status)&&own)actions.push('edit_content','cancel_content');
    if(row.status==='proposed'&&own)actions.push('submit_content');
    if(row.status==='internal_review'&&!own)actions.push('approve_content','return_content');
    if(row.status==='client_review')actions.push('record_client_approval','return_content');
    if(row.status==='client_approved')actions.push('record_proof');
  }
  return {...row,kind_name:CONTENT_KINDS.find(k=>k.key===row.kind)?.name??row.kind,status_name:CONTENT_STATES[row.status],
    output:versionLabel(db,engagement.tenant_id,row.output_version_id),
    proposed_by_name:name(db,row.proposed_by),internal_approved_by_name:name(db,row.internal_approved_by),client_approval_recorded_by_name:name(db,row.client_approval_recorded_by),
    channel_name:APPROVAL_CHANNELS.find(c=>c.key===row.client_approval_channel)?.name??'',proof,actions};
}
// بوابة الدفع: ما الذي يمنع اعتبار الدفعة مستحقة الآن. لا تنفذ الوحدة دفعًا ولا تعتمده؛ المسار المالي في payables.
export function paymentGate(db,row,influencer,content,date){
  const blockers=[];
  if(!['active','completed'].includes(row.status))blockers.push({code:'status',message:`حالة الارتباط: ${ENGAGEMENT_STATES[row.status]}`});
  if(!influencer.vendor_id)blockers.push({code:'vendor',message:'المؤثر غير مرتبط بملف مورد في دليل الموردين، ولا دفع خارج دليل الموردين'});
  else{
    const vendor=db.prepare('SELECT * FROM vendors WHERE id=?').get(influencer.vendor_id);
    const gate=vendorGate(db,row.tenant_id,vendor.supplier_key,null);
    if(gate.state!=='qualified')blockers.push({code:'vendor_gate',message:`ملف المورد ${vendor.code} غير مؤهل: ${gate.blockers.map(b=>b.message).join('؛ ')||'غير مسجل'}`});
    if(!db.prepare("SELECT 1 FROM vendor_bank_accounts WHERE vendor_id=? AND status='verified' AND effective_from<=?").get(vendor.id,date))blockers.push({code:'bank',message:`المورد ${vendor.code} بلا حساب بنكي متحقق منه وسارٍ`});
  }
  const missing=CONTENT_KINDS.map(k=>{
    const promised=row[KIND_FIELD[k.key]],proved=content.filter(x=>x.kind===k.key&&x.proof?.verified_by).length;
    return {...k,promised,proved};
  }).filter(k=>k.proved<k.promised);
  if(missing.length)blockers.push({code:'proof',message:`إثبات نشر متحقق منه ناقص: ${missing.map(k=>`${k.name} ${k.proved}/${k.promised}`).join('، ')}`});
  return {allowed:!blockers.length,blockers,proof_complete:!missing.length};
}
function engagementView(db,u,row,clientRow,date){
  const influencer=db.prepare('SELECT * FROM influencers WHERE id=?').get(row.influencer_id);
  const content=db.prepare('SELECT * FROM influencer_content WHERE engagement_id=? ORDER BY created_at').all(row.id).map(x=>contentView(db,u,x,row));
  const gate=paymentGate(db,row,influencer,content,date),own=row.owner_id===u.id;
  const payments=db.prepare('SELECT p.*,o.status AS order_status,o.amount_minor,o.bank_reference,x.name AS linked_by_name FROM influencer_payments p JOIN payment_orders o ON o.id=p.payment_order_id JOIN users x ON x.id=p.linked_by WHERE p.engagement_id=? ORDER BY p.created_at').all(row.id);
  const licence=licenceState(influencer,date,row.ends_on),usageLeft=days(date,row.usage_until),actions=[];
  if(row.status==='draft'&&own)actions.push('edit_engagement','request_review','cancel_engagement');
  if(row.status==='internal_review'&&!own)actions.push('approve_engagement','return_engagement');
  if(row.status==='internal_review'&&own)actions.push('cancel_engagement');
  if(row.status==='active'){
    actions.push('add_content');
    if(own)actions.push('complete_engagement','cancel_engagement');
  }
  if(['active','completed'].includes(row.status))actions.push('link_payment');
  return {...row,client_name:clientRow.trade_name||clientRow.legal_name,campaign_name:db.prepare('SELECT name FROM campaigns WHERE id=?').get(row.campaign_id)?.name??'',
    influencer_name:influencer.stage_name,influencer_code:influencer.code,influencer_id:influencer.id,status_name:ENGAGEMENT_STATES[row.status],
    owner_name:name(db,row.owner_id),approved_by_name:name(db,row.approved_by),own,
    usage_scope_name:USAGE_SCOPES.find(s=>s.key===row.usage_scope)?.name??row.usage_scope,
    usage_state:usageLeft<0?'expired':usageLeft<=30?'expiring':'valid',usage_days_left:usageLeft,
    licence,licence_notice:LICENCE_NOTICE,
    deliverables:CONTENT_KINDS.map(k=>({...k,promised:row[KIND_FIELD[k.key]],
      approved:content.filter(x=>x.kind===k.key&&['client_approved','published'].includes(x.status)).length,
      published:content.filter(x=>x.kind===k.key&&x.status==='published').length,
      verified:content.filter(x=>x.kind===k.key&&x.proof?.verified_by).length})),
    content,payments,payment_gate:gate,actions};
}
const ENGAGEMENT_FIELDS=['title','brief','posts_count','stories_count','videos_count','fee','starts_on','ends_on','cancellation_terms','disclosure_requirement','usage_scope','usage_from','usage_until','usage_terms'];
function cleanEngagement(input){
  const from=v.date(input.starts_on),to=v.date(input.ends_on);
  if(to<from)fail(400,'date_order','نهاية الارتباط بعد بدايته');
  const usageFrom=v.date(input.usage_from),usageUntil=v.date(input.usage_until);
  if(usageUntil<usageFrom)fail(400,'usage_until','نهاية مدة حقوق الاستخدام بعد بدايتها');
  if(!USAGE_SCOPES.some(s=>s.key===input.usage_scope))fail(400,'usage_scope','اختر نطاق حقوق الاستخدام');
  const posts=count(input.posts_count,'المنشورات'),stories=count(input.stories_count,'القصص'),videos=count(input.videos_count,'الفيديوهات');
  if(posts+stories+videos===0)fail(400,'deliverables','حدد مخرجًا واحدًا على الأقل');
  return {title:v.text(input.title,'عنوان الارتباط',180,3),brief:optional(input.brief,'الوصف والرسالة',3000),posts,stories,videos,
    fee:money(input.fee,'أتعاب المؤثر'),from,to,
    cancellation:v.text(input.cancellation_terms,'شروط الإلغاء كما في الاتفاق',2000,10),
    disclosure:v.text(input.disclosure_requirement,'نص الإفصاح الإعلاني المطلوب على المنشور',500,5),
    usage_scope:input.usage_scope,usage_from:usageFrom,usage_until:usageUntil,
    usage_terms:v.text(input.usage_terms,'شروط حقوق الاستخدام',2000,10)};
}
export function createEngagement(db,supplied,input){
  writing(db);const u=permitted(db,supplied);
  v.object(input,['influencer_id','client_id','campaign_id',...ENGAGEMENT_FIELDS]);
  const {c}=clientFor(db,supplied,input.client_id),f=cleanEngagement(input);
  const influencer=typeof input.influencer_id==='string'&&db.prepare('SELECT * FROM influencers WHERE id=? AND tenant_id=?').get(input.influencer_id,u.tenant_id);
  if(!influencer)fail(404,'not_found','ملف المؤثر غير متاح');
  if(['draft','blocked'].includes(influencer.status))fail(409,'influencer_unavailable','لا يُتعاقد مع ملف مسودة أو غير مرغوب');
  if(!db.prepare("SELECT 1 FROM campaigns WHERE id=? AND client_id=? AND tenant_id=? AND status NOT IN ('completed','cancelled')").get(input.campaign_id,c.id,u.tenant_id))fail(400,'campaign_id','الحملة ليست حملة قائمة لهذا العميل');
  const engagementId=id(),time=now();
  db.prepare("INSERT INTO influencer_engagements(id,tenant_id,influencer_id,client_id,campaign_id,title,brief,posts_count,stories_count,videos_count,fee_minor,currency,starts_on,ends_on,cancellation_terms,disclosure_requirement,usage_scope,usage_from,usage_until,usage_terms,status,owner_id,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,'SAR',?,?,?,?,?,?,?,?,'draft',?,?,?)")
    .run(engagementId,u.tenant_id,influencer.id,c.id,input.campaign_id,f.title,f.brief,f.posts,f.stories,f.videos,f.fee,f.from,f.to,f.cancellation,f.disclosure,f.usage_scope,f.usage_from,f.usage_until,f.usage_terms,u.id,time,time);
  audit(db,u,'influencer_engagement',engagementId,'engagement.created',{}, {client:c.code,influencer:influencer.code,fee_minor:f.fee});
  return {id:engagementId};
}
export function engagementAction(db,supplied,engagementId,action,input){
  writing(db);
  const fields={edit_engagement:ENGAGEMENT_FIELDS,request_review:[],approve_engagement:['note','licence_ack'],return_engagement:['note'],
    complete_engagement:['note'],cancel_engagement:['note'],link_payment:['payment_order_id','basis','exception_note']}[action];
  if(!fields)fail(404,'not_found','الإجراء غير متاح');
  v.object(input,['version',...fields]);
  const {u,c,row}=engagementRow(db,supplied,engagementId),date=today(),view=engagementView(db,u,row,c,date);
  if(!view.actions.includes(action))fail(409,'action_unavailable','الإجراء غير متاح في حالة الارتباط أو لحسابك');
  versioned(row,input);
  const time=now(),bump=(sql,values=[])=>db.prepare(`UPDATE influencer_engagements SET ${sql},version=version+1,updated_at=? WHERE id=? AND version=?`).run(...values,time,row.id,row.version);
  let after={};
  if(action==='edit_engagement'){
    const f=cleanEngagement(input);
    bump('title=?,brief=?,posts_count=?,stories_count=?,videos_count=?,fee_minor=?,starts_on=?,ends_on=?,cancellation_terms=?,disclosure_requirement=?,usage_scope=?,usage_from=?,usage_until=?,usage_terms=?',
      [f.title,f.brief,f.posts,f.stories,f.videos,f.fee,f.from,f.to,f.cancellation,f.disclosure,f.usage_scope,f.usage_from,f.usage_until,f.usage_terms]);
  }else if(action==='request_review')bump("status='internal_review'");
  else if(action==='approve_engagement'){
    // الرخصة الناقصة أو المنتهية لا تمنع التعاقد؛ تُلزم المعتمد بإقرار مكتوب يبقى في السجل.
    const licence=view.licence,ack=optional(input.licence_ack,'إقرار المسؤول بشأن الرخصة',2000);
    if(licence.needs_ack&&ack.trim().length<20)fail(409,'licence_ack_required',`${licence.name}. ${LICENCE_NOTICE} اكتب إقرارك المسؤول عن المضي في التعاقد`);
    if(!licence.needs_ack&&ack)fail(400,'licence_ack','الرخصة مسجلة وسارية؛ لا إقرار مطلوب');
    bump("status='active',approved_by=?,approved_at=?,approval_note=?,licence_state_at_approval=?,licence_ack_note=?",
      [u.id,time,v.text(input.note,'أساس الاعتماد',2000,10),licence.state,licence.needs_ack?ack:'']);
    after={licence_state:licence.state,licence_ack:licence.needs_ack};
  }else if(action==='return_engagement')bump("status='draft',return_note=?",[v.text(input.note,'ما يلزم قبل الاعتماد',2000,10)]);
  else if(action==='complete_engagement'){
    const open=view.content.filter(x=>!['published','cancelled'].includes(x.status)).length;
    if(open)fail(409,'content_open',`بنود محتوى لم تُنشر ولم تُلغَ: ${open}`);
    bump("status='completed',closing_note=?,closed_at=?",[v.text(input.note,'خلاصة الإقفال وما سُلّم فعلًا',2000,10),time]);
  }else if(action==='cancel_engagement'){
    bump("status='cancelled',closing_note=?,closed_at=?",[v.text(input.note,'سبب الإلغاء وأثره على شروط الإلغاء المتفق عليها',2000,10),time]);
  }else if(action==='link_payment'){
    const order=typeof input.payment_order_id==='string'&&db.prepare('SELECT * FROM payment_orders WHERE id=? AND tenant_id=?').get(input.payment_order_id,u.tenant_id);
    if(!order)fail(404,'not_found','أمر الدفع غير متاح');
    if(order.status!=='pending')fail(409,'order_decided','يُربط أمر الدفع بارتباطه قبل اعتماد المالية له');
    if(db.prepare('SELECT 1 FROM influencer_payments WHERE payment_order_id=?').get(order.id))fail(409,'already_linked','أمر الدفع مرتبط بارتباط آخر');
    const gate=view.payment_gate,exception=optional(input.exception_note,'قرار الاستثناء المكتوب',2000);
    if(!gate.proof_complete&&exception.trim().length<20)fail(409,'proof_required',`${gate.blockers.map(b=>b.message).join('؛ ')}. الدفع قبل إثبات النشر يحتاج قرارًا مكتوبًا بالاستثناء`);
    if(gate.proof_complete&&exception)fail(400,'exception_note','إثبات النشر مكتمل؛ لا استثناء مطلوب');
    if(!gate.proof_complete&&row.owner_id===u.id)fail(409,'separation_of_duties','صاحب الارتباط لا يكتب استثناء الدفع بلا إثبات');
    db.prepare("INSERT INTO influencer_payments(id,tenant_id,engagement_id,payment_order_id,basis,proof_state,exception_note,linked_by,created_at) VALUES(?,?,?,?,?,?,?,?,?)")
      .run(id(),u.tenant_id,row.id,order.id,v.text(input.basis,'سبب استحقاق الدفعة ومرجعها',2000,10),gate.proof_complete?'verified_proof':'written_exception',gate.proof_complete?'':exception,u.id,time);
    bump('status=status');after={payment_order_id:order.id,proof_complete:gate.proof_complete};
  }
  audit(db,u,'influencer_engagement',row.id,'engagement.'+action,{status:row.status,version:row.version},{version:row.version+1,...after});
  return {id:row.id};
}

/* ───── اعتماد المحتوى وإثبات النشر ───── */
export function addContent(db,supplied,engagementId,input){
  writing(db);
  v.object(input,['version','kind','title','description']);
  const {u,c,row}=engagementRow(db,supplied,engagementId),date=today(),view=engagementView(db,u,row,c,date);
  if(!view.actions.includes('add_content'))fail(409,'action_unavailable','إضافة المحتوى بعد اعتماد الارتباط فقط');
  versioned(row,input);
  if(!CONTENT_KINDS.some(k=>k.key===input.kind))fail(400,'kind','اختر نوع المخرج');
  const contentId=id(),time=now();
  db.prepare("INSERT INTO influencer_content(id,engagement_id,kind,title,description,status,proposed_by,created_at,updated_at) VALUES(?,?,?,?,?,'proposed',?,?,?)")
    .run(contentId,row.id,input.kind,v.text(input.title,'عنوان المخرج',180,3),optional(input.description,'وصف المحتوى المقترح',3000),u.id,time,time);
  db.prepare('UPDATE influencer_engagements SET version=version+1,updated_at=? WHERE id=? AND version=?').run(time,row.id,row.version);
  audit(db,u,'influencer_content',contentId,'content.proposed',{}, {engagement_id:row.id,kind:input.kind});
  return {id:contentId};
}
function contentRow(db,supplied,contentId){
  const u=permitted(db,supplied);
  const row=typeof contentId==='string'&&db.prepare('SELECT * FROM influencer_content WHERE id=?').get(contentId);
  const engagement=row&&db.prepare('SELECT * FROM influencer_engagements WHERE id=? AND tenant_id=?').get(row.engagement_id,u.tenant_id);
  if(!row||!engagement)fail(404,'not_found','بند المحتوى غير متاح');
  clientFor(db,supplied,engagement.client_id);
  return {u,row,engagement};
}
export function contentAction(db,supplied,contentId,action,input){
  writing(db);
  const fields={edit_content:['kind','title','description'],submit_content:['draft_reference','output_version_id'],approve_content:['note'],return_content:['note'],
    record_client_approval:['approver_name','channel','received_on','reference'],
    record_proof:['post_url','published_on','screenshot_reference','disclosure_confirmed','disclosure_evidence'],cancel_content:['note']}[action];
  if(!fields)fail(404,'not_found','الإجراء غير متاح');
  v.object(input,['version',...fields]);
  const {u,row,engagement}=contentRow(db,supplied,contentId),date=today(),view=contentView(db,u,row,engagement);
  if(!view.actions.includes(action))fail(409,'action_unavailable','الإجراء غير متاح في حالة البند أو لحسابك');
  versioned(row,input);
  const time=now(),bump=(sql,values=[])=>db.prepare(`UPDATE influencer_content SET ${sql},version=version+1,updated_at=? WHERE id=? AND version=?`).run(...values,time,row.id,row.version);
  let after={};
  if(action==='edit_content'){
    if(!CONTENT_KINDS.some(k=>k.key===input.kind))fail(400,'kind','اختر نوع المخرج');
    bump('kind=?,title=?,description=?',[input.kind,v.text(input.title,'عنوان المخرج',180,3),optional(input.description,'وصف المحتوى المقترح',3000)]);
  }else if(action==='submit_content'){
    // P4-SPEC-3: مسودة المؤثر نسخة مخرج اعتمدها الاستوديو في عمل مفتوح لحملة الارتباط، فيحمل البند معرّفها وبصمتها مقروءين.
    if(!input.output_version_id)refuse(400,'version_required',{what:'محتوى المؤثر ينقدّم على نسخة مخرج اعتمدها الاستوديو، ما على مرجع مكتوب',
      missing:[{document:'نسخة معتمدة لمسودة المؤثر في «الاستوديو والتسليم»',why:'المنشور لازم يكون النسخة اللي اعتُمدت بعينها',owner:'معدّ العمل في الاستوديو ومراجعه',owner_role:'studio'}],
      next:'سجّل مسودة المؤثر مخرجًا في عمل استوديو مفتوح لحملة الارتباط، وبعد اعتماد النسخة اخترها هنا'});
    const bound=bindableVersion(db,u,input.output_version_id,{client:engagement.client_id,campaign:engagement.campaign_id,what:'محتوى المؤثر'});
    bump("status='internal_review',draft_reference='',output_version_id=?,output_digest=?",[bound.version_id,bound.digest]);
    after={output_version_id:bound.version_id,output_digest:bound.digest};
  }
  else if(action==='approve_content')bump("status='client_review',internal_approved_by=?,internal_approved_at=?,internal_note=?",[u.id,time,v.text(input.note,'أساس الاعتماد الداخلي',2000,3)]);
  else if(action==='return_content')bump("status='proposed',internal_note=?",[v.text(input.note,'المطلوب تعديله',2000,10)]);
  else if(action==='record_client_approval'){
    if(!APPROVAL_CHANNELS.some(c=>c.key===input.channel))fail(400,'channel','اختر وسيلة ورود موافقة العميل');
    const received=v.date(input.received_on);
    if(received>date)fail(400,'received_on','تاريخ ورود الموافقة لا يكون مستقبليًا');
    bump("status='client_approved',client_approver_name=?,client_approval_channel=?,client_approval_received_on=?,client_approval_reference=?,client_approval_recorded_by=?",
      [v.text(input.approver_name,'من وافق من جهة العميل',180,2),input.channel,received,v.text(input.reference,'أين حُفظ دليل الموافقة',2000,10),u.id]);
    after={client_approval:'recorded'};
  }else if(action==='record_proof'){
    const published=v.date(input.published_on);
    if(published>date)fail(400,'published_on','تاريخ النشر لا يكون مستقبليًا');
    if(published<engagement.starts_on)fail(400,'published_on','تاريخ النشر لا يسبق بداية الارتباط');
    // الإفصاح الإعلاني إلزامي: لا يُسجل نشر دون تأكيد ظهوره ودليله.
    if(input.disclosure_confirmed!==true)fail(400,'disclosure_confirmed',`أكد ظهور الإفصاح الإعلاني على المنشور: ${engagement.disclosure_requirement}`);
    const url=v.text(input.post_url,'رابط المنشور',600,8);
    if(row.output_version_id)assertPublishable(db,engagement.tenant_id,row.output_version_id);
    if(!/^https?:\/\/\S+$/.test(url))fail(400,'post_url','الرابط يبدأ بـ http أو https');
    db.prepare("INSERT INTO influencer_proofs(id,content_id,post_url,published_on,screenshot_reference,disclosure_confirmed,disclosure_evidence,recorded_by,recorded_at) VALUES(?,?,?,?,?,1,?,?,?)")
      .run(id(),row.id,url,published,v.text(input.screenshot_reference,'مرجع اللقطة المرفقة ومكان حفظها',600,5),v.text(input.disclosure_evidence,'كيف ظهر الإفصاح ودليله',2000,5),u.id,time);
    bump("status='published'");
    after={published_on:published,verified:false};
  }else if(action==='cancel_content')bump("status='cancelled',cancel_note=?",[v.text(input.note,'سبب الإلغاء',1000,5)]);
  audit(db,u,'influencer_content',row.id,'content.'+action,{status:row.status,version:row.version},{version:row.version+1,...after});
  return {id:row.id};
}
// التحقق من إثبات النشر فعل إنسان: يفتح الرابط أو يطابق اللقطة ويوقّع باسمه. المنصة لا تزور المنصات.
export function verifyProof(db,supplied,proofId,input){
  writing(db);
  const u=permitted(db,supplied);
  v.object(input,['method','note']);
  const proof=typeof proofId==='string'&&db.prepare('SELECT * FROM influencer_proofs WHERE id=?').get(proofId);
  if(!proof)fail(404,'not_found','إثبات النشر غير متاح');
  const content=db.prepare('SELECT * FROM influencer_content WHERE id=?').get(proof.content_id);
  const engagement=db.prepare('SELECT * FROM influencer_engagements WHERE id=? AND tenant_id=?').get(content.engagement_id,u.tenant_id);
  if(!engagement)fail(404,'not_found','إثبات النشر غير متاح');
  clientFor(db,supplied,engagement.client_id);
  if(proof.verified_by)fail(409,'already_verified','سبق التحقق من هذا الإثبات');
  if(proof.recorded_by===u.id)fail(409,'separation_of_duties','من سجّل إثبات النشر لا يتحقق منه بنفسه');
  if(!VERIFICATION_METHODS.some(m=>m.key===input.method))fail(400,'method','اختر كيف تحققت بنفسك');
  db.prepare('UPDATE influencer_proofs SET verified_by=?,verified_at=?,verification_method=?,verification_note=? WHERE id=?')
    .run(u.id,now(),input.method,v.text(input.note,'ما الذي طابقته في الرابط أو اللقطة',2000,10),proof.id);
  audit(db,u,'influencer_proof',proof.id,'proof.verified',{}, {content_id:content.id,method:input.method});
  return {id:proof.id};
}

/* ───── اللوحات ───── */
export function influencersBoard(db,supplied){
  const u=permitted(db,supplied),date=today();
  const rows=db.prepare('SELECT * FROM influencers WHERE tenant_id=? ORDER BY status,stage_name').all(u.tenant_id).map(r=>influencerView(db,u,r,date));
  const vendors=db.prepare("SELECT id,code,legal_name FROM vendors WHERE tenant_id=? AND status IN ('approved','conditional') AND id NOT IN (SELECT vendor_id FROM influencers WHERE tenant_id=? AND vendor_id IS NOT NULL) ORDER BY legal_name").all(u.tenant_id,u.tenant_id);
  // INF-01: الحساب الواحد على أكثر من ملف — أزواج سُجّلت قبل الترحيل 189. لا يُحذف شيء: تُسرد لقرار، وتعطيل الحساب من الملف الخطأ يحسمها.
  const duplicates=db.prepare(`SELECT a.platform,${HANDLE_KEY_SQL} AS handle_key,MIN(a.handle) AS handle FROM influencer_accounts a JOIN influencers x ON x.id=a.influencer_id
    WHERE x.tenant_id=? AND a.active=1 GROUP BY a.platform,handle_key HAVING COUNT(DISTINCT a.influencer_id)>1 ORDER BY a.platform,handle_key`).all(u.tenant_id)
    .map(d=>({platform:d.platform,platform_name:PLATFORMS.find(p=>p.key===d.platform)?.name??d.platform,handle:d.handle,
      files:db.prepare(`SELECT DISTINCT x.id,x.code,x.stage_name FROM influencer_accounts a JOIN influencers x ON x.id=a.influencer_id WHERE x.tenant_id=? AND a.platform=? AND a.active=1 AND ${HANDLE_KEY_SQL}=? ORDER BY x.code`)
        .all(u.tenant_id,d.platform,d.handle_key).map(f=>({...f}))}));
  return {today:date,user_id:u.id,platforms:PLATFORMS,categories:CATEGORIES,contact_modes:CONTACT_MODES,status_names:INFLUENCER_STATES,
    influencers:rows,vendors,duplicate_accounts:duplicates,
    licence_notice:LICENCE_NOTICE,manual_metric_note:MANUAL_METRIC_NOTE,
    alerts:{
      licence_missing:rows.filter(r=>r.status!=='blocked'&&r.licence.state==='missing').length,
      licence_expired:rows.filter(r=>r.licence.state==='expired').length,
      licence_expiring:rows.filter(r=>r.licence.state==='recorded'&&r.licence.expiring).length,
      unlinked_vendor:rows.filter(r=>r.status==='active'&&!r.vendor_id).length,
      duplicate_accounts:duplicates.length
    },
    note:'لا تتصل المنصة بأي منصة تواصل: لا متابعين ولا مشاهدات ولا معدل تفاعل. كل رقم هنا لقطة أدخلها موظف بمصدرها وتاريخها، وتُعرض كما أُدخلت دون أي احتساب.'};
}
export function influencerCampaignsBoard(db,supplied){
  const u=permitted(db,supplied),date=today(),clients=memberClients(db,supplied),byId=new Map(clients.map(c=>[c.id,c]));
  const rows=clients.length?db.prepare(`SELECT * FROM influencer_engagements WHERE tenant_id=? AND client_id IN (${clients.map(()=>'?').join(',')}) ORDER BY status IN ('completed','cancelled'),starts_on DESC LIMIT 200`).all(u.tenant_id,...clients.map(c=>c.id)):[];
  const engagements=rows.map(r=>engagementView(db,u,r,byId.get(r.client_id),date));
  return {today:date,user_id:u.id,content_kinds:CONTENT_KINDS,usage_scopes:USAGE_SCOPES,approval_channels:APPROVAL_CHANNELS,
    verification_methods:VERIFICATION_METHODS,status_names:ENGAGEMENT_STATES,content_states:CONTENT_STATES,
    licence_notice:LICENCE_NOTICE,
    clients:clients.map(c=>({id:c.id,name:c.trade_name||c.legal_name,
      campaigns:db.prepare("SELECT id,name FROM campaigns WHERE client_id=? AND status NOT IN ('completed','cancelled') ORDER BY name").all(c.id)})),
    influencers:db.prepare("SELECT id,code,stage_name FROM influencers WHERE tenant_id=? AND status IN ('active','paused') ORDER BY stage_name").all(u.tenant_id),
    engagements,versions:bindableVersions(db,u),
    alerts:{
      usage_expired:engagements.filter(e=>e.status!=='cancelled'&&e.usage_state==='expired').length,
      usage_expiring:engagements.filter(e=>e.status!=='cancelled'&&e.usage_state==='expiring').length,
      proofs_awaiting:engagements.flatMap(e=>e.content).filter(x=>x.proof&&!x.proof.verified_by).length,
      paid_without_proof:engagements.flatMap(e=>e.payments).filter(p=>p.proof_state==='written_exception').length
    },
    note:'موافقة العميل هنا يسجلها موظف بمرجع دليلها، والتحقق من النشر يفتحه إنسان ويوقّعه باسمه. المنصة لا تزور المنصات ولا تتحقق آليًا، والدفع يمر بأمر دفع في مسار المدفوعات لا بمسار موازٍ.'};
}
// يستخدمه نظام الملفات عند تسجيل نوع «إثبات نشر» لديه: من يرى الإثبات ولم يُتحقق منه بعد يرفق لقطته.
export function proofFileAccess(db,supplied,proofId){
  const u=permitted(db,supplied);
  const proof=typeof proofId==='string'&&db.prepare('SELECT * FROM influencer_proofs WHERE id=?').get(proofId);
  if(!proof)fail(404,'not_found','إثبات النشر غير متاح');
  const content=db.prepare('SELECT * FROM influencer_content WHERE id=?').get(proof.content_id);
  const engagement=db.prepare('SELECT * FROM influencer_engagements WHERE id=? AND tenant_id=?').get(content.engagement_id,u.tenant_id);
  if(!engagement)fail(404,'not_found','إثبات النشر غير متاح');
  clientFor(db,supplied,engagement.client_id);
  return {canUpload:proof.recorded_by===u.id&&!proof.verified_by,canRestricted:false};
}
