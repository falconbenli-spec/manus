import { audit, now } from './db.mjs';
import { fail } from './auth.mjs';
import * as v from './validation.mjs';
import { currentUser } from './delegations.mjs';
import { can } from './access.mjs';
import { DOCUMENT_KINDS as VENDOR_DOCUMENT_KINDS } from './vendors.mjs';

// مراقبة انتهاء الوثائق: تقرأ تواريخ الانتهاء من مصادرها القائمة لحظيًا، ولا تخزّن نسخة منها.
// المنصة لا تعرف متى ينبغي التذكير: مدة التذكير إعداد يدخله مالك الإجراء بمصدره، ويبدأ الجدول بلا صفوف.
const DAY=86400000;
const today=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Riyadh',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const isDate=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value+'T00:00:00Z'));
const daysUntil=(date,from)=>Math.round((Date.parse(date+'T00:00:00Z')-Date.parse(from+'T00:00:00Z'))/DAY);
function actor(db,supplied){const u=currentUser(db,supplied);if(!u)fail(403,'forbidden','الحساب غير متاح');return u;}
function writing(db){if(!db.isTransaction)fail(500,'transaction_required','تتطلب كتابة إعداد التذكير معاملة قاعدة بيانات');}

// أنواع الوثائق المراقَبة، ولكل نوع مصدره القائم والتصريح الذي يتيح رؤية وثائق الآخرين فيه.
// الموظف يرى وثائقه هو بتصريح `portal.use` مهما كان النوع؛ التصريح هنا لتوسيع النطاق إلى غيره.
const EMPLOYEE_DOC_NAMES={national_id:'هوية وطنية',iqama:'إقامة',work_permit:'رخصة عمل',passport:'جواز سفر',contract:'وثيقة عقد محفوظة',qualification:'مؤهل',medical_insurance:'تأمين طبي',other:'وثيقة أخرى'};
export const WATCHED_KINDS=[
  ...Object.entries(EMPLOYEE_DOC_NAMES).map(([type,name])=>({key:`employee.${type}`,name:`وثيقة موظف — ${name}`,source:'employee_documents',capability:'employees.view',personal:true})),
  {key:'employment_contract',name:'عقد عمل محدد المدة',source:'employment_contracts',capability:'hr.contracts.manage',personal:true},
  ...VENDOR_DOCUMENT_KINDS.map(k=>({key:`vendor.${k.key}`,name:`وثيقة مورد — ${k.name}`,source:'vendor_documents',capability:'vendors.view',personal:false})),
  {key:'vendor.qualification',name:'صلاحية تأهيل مورد',source:'vendors',capability:'vendors.view',personal:false}
];
const kindByKey=new Map(WATCHED_KINDS.map(k=>[k.key,k]));
// رقم وثيقة الموظف (هوية، إقامة، جواز…) بيان شخصي: لا يغادر الخادم كاملًا في لوحات التنبيه. آخر أربعة أرقام تكفي للتمييز.
export function maskReference(value){
  const text=String(value??'');
  if(text.startsWith('••••'))return text;
  const digits=text.replace(/\D/g,'');
  return digits.length?`••••${digits.slice(-4)}`:'••••';
}
export const kindName=key=>kindByKey.get(key)?.name??key;

export function watchSettings(db,tenantId){
  return new Map(db.prepare('SELECT * FROM expiry_watch_settings WHERE tenant_id=?').all(tenantId).map(r=>[r.doc_kind,r]));
}

// الحالة من التاريخ والإعداد معًا: المنتهي معروف بلا إعداد، أما «يقترب» فلا يُقال إلا بمدة أدخلها صاحبها.
function classify(expiresOn,day,setting){
  const left=daysUntil(expiresOn,day);
  if(left<0)return {days_left:left,status:'expired',stage:'expired'};
  if(!setting)return {days_left:left,status:'ok',stage:null};
  if(left<=setting.second_reminder_days)return {days_left:left,status:'due_soon',stage:'second'};
  if(left<=setting.first_reminder_days)return {days_left:left,status:'due_soon',stage:'first'};
  return {days_left:left,status:'ok',stage:null};
}

function gather(db,u,{day,settings}){
  const tenant=u.tenant_id,items=[],malformed=[],sources=[];
  const officer=can(db,u,'employees.view'),contracts=can(db,u,'hr.contracts.manage'),vendors=can(db,u,'vendors.view');
  const push=(row,{docKind,scope,subjectId,subjectName,reference,expiresOn,link,recordedAt})=>{
    if(!isDate(expiresOn)){malformed.push({doc_kind:docKind,id:row.id,expires_on:expiresOn??null});return;}
    const setting=settings.get(docKind)??null;
    items.push({
      id:row.id,doc_kind:docKind,doc_kind_name:kindName(docKind),scope,
      subject_id:subjectId,subject_name:subjectName,reference:docKind.startsWith('employee.')?maskReference(reference):reference,expires_on:expiresOn,link,
      recorded_at:recordedAt??null,configured:!!setting,
      first_reminder_days:setting?.first_reminder_days??null,second_reminder_days:setting?.second_reminder_days??null,
      basis:setting?.basis??'',...classify(expiresOn,day,setting)
    });
  };

  // وثائق الموظفين: جواز وإقامة ورخصة عمل وغيرها. السارية فقط (غير المستبدلة) لموظف نشط.
  // B14: وثيقتك أنت تفتح «ملفي»؛ «السجل الوظيفي» لموظف الموارد البشرية ويرد على غيره بـ403.
  sources.push({key:'employee_documents',name:'وثائق الموظفين',scope:officer?'كل الموظفين':'وثائقك أنت'});
  const employeeRows=officer
    ?db.prepare("SELECT d.id,d.user_id,d.doc_type,d.reference,d.expires_on,d.created_at,x.name AS subject_name FROM employee_documents d JOIN users x ON x.id=d.user_id AND x.tenant_id=d.tenant_id WHERE d.tenant_id=? AND d.replaced_by IS NULL AND x.active=1").all(tenant)
    :db.prepare("SELECT d.id,d.user_id,d.doc_type,d.reference,d.expires_on,d.created_at,x.name AS subject_name FROM employee_documents d JOIN users x ON x.id=d.user_id AND x.tenant_id=d.tenant_id WHERE d.tenant_id=? AND d.user_id=? AND d.replaced_by IS NULL").all(tenant,u.id);
  for(const row of employeeRows)push(row,{docKind:`employee.${row.doc_type}`,scope:row.user_id===u.id?'own':'all',subjectId:row.user_id,subjectName:row.subject_name,reference:row.reference,expiresOn:row.expires_on,link:row.user_id===u.id?'#profile':'#employees',recordedAt:row.created_at});

  // عقود العمل محددة المدة السارية: نهايتها موعد يلزم قرارًا قبل بلوغه.
  sources.push({key:'employment_contracts',name:'عقود العمل محددة المدة',scope:contracts?'كل العقود':'عقدك أنت'});
  const contractRows=contracts
    ?db.prepare("SELECT c.id,c.user_id,c.end_date,c.job_title,c.document_reference,c.created_at,x.name AS subject_name FROM employment_contracts c JOIN users x ON x.id=c.user_id AND x.tenant_id=c.tenant_id WHERE c.tenant_id=? AND c.status='active' AND c.end_date IS NOT NULL").all(tenant)
    :db.prepare("SELECT c.id,c.user_id,c.end_date,c.job_title,c.document_reference,c.created_at,x.name AS subject_name FROM employment_contracts c JOIN users x ON x.id=c.user_id AND x.tenant_id=c.tenant_id WHERE c.tenant_id=? AND c.user_id=? AND c.status='active' AND c.end_date IS NOT NULL").all(tenant,u.id);
  for(const row of contractRows)push(row,{docKind:'employment_contract',scope:row.user_id===u.id?'own':'all',subjectId:row.user_id,subjectName:row.subject_name,reference:row.document_reference,expiresOn:row.end_date,link:'#contracts',recordedAt:row.created_at});

  // وثائق الموردين: تشمل الشهادة الضريبية ووثيقة التأمين والتراخيص، وكلها في مصدر واحد.
  if(vendors){
    sources.push({key:'vendor_documents',name:'وثائق الموردين (منها الشهادة الضريبية ووثيقة التأمين)',scope:'كل الموردين القائمين'});
    for(const row of db.prepare("SELECT d.id,d.vendor_id,d.kind,d.reference,d.expires_on,d.created_at,x.code,x.legal_name FROM vendor_documents d JOIN vendors x ON x.id=d.vendor_id WHERE x.tenant_id=? AND d.superseded_by IS NULL AND d.expires_on IS NOT NULL AND x.status IN ('approved','conditional','suspended','requalification')").all(tenant))
      push(row,{docKind:`vendor.${row.kind}`,scope:'all',subjectId:row.vendor_id,subjectName:`${row.code} · ${row.legal_name}`,reference:row.reference,expiresOn:row.expires_on,link:'#vendors',recordedAt:row.created_at});
    sources.push({key:'vendors',name:'صلاحية تأهيل الموردين',scope:'كل الموردين القائمين'});
    for(const row of db.prepare("SELECT id,code,legal_name,valid_until,updated_at FROM vendors WHERE tenant_id=? AND valid_until IS NOT NULL AND status IN ('approved','conditional')").all(tenant))
      push(row,{docKind:'vendor.qualification',scope:'all',subjectId:row.id,subjectName:`${row.code} · ${row.legal_name}`,reference:'صلاحية التأهيل',expiresOn:row.valid_until,link:'#vendors',recordedAt:row.updated_at});
  }
  items.sort((a,b)=>a.expires_on.localeCompare(b.expires_on)||a.doc_kind.localeCompare(b.doc_kind));
  return {items,malformed,sources};
}

// ما يحق لهذا المستخدم رؤيته فقط: وثائقه هو دائمًا، وغيرها بقدر تصاريحه القائمة.
export function expiringSoon(db,supplied){
  const u=actor(db,supplied);
  return gather(db,u,{day:today(),settings:watchSettings(db,u.tenant_id)}).items;
}

// شكل يصلح لأن يضمه صندوق «بانتظار قراري»: مصفوفة تحت مفتاح، لكل عنصر id وtitle وcreated_at وactions.
// الفعل `review_expiry` يترجمه app/inbox.mjs إلى «مراجعة» عبر قاعدة رأس الفعل، دون تعديل الصندوق.
export function expirySources(db,supplied){
  const items=expiringSoon(db,supplied).filter(i=>i.status!=='ok');
  return {expiring:items.map(i=>({
    id:i.id,
    title:`${i.doc_kind_name} — ${i.subject_name}`,
    // التاريخ المعروض هو تاريخ الانتهاء نفسه: «منذ» في الصندوق = كم مضى على الانتهاء، وصفر لما لم ينتهِ بعد.
    created_at:i.expires_on,
    expires_on:i.expires_on,status:i.status,
    actions:['review_expiry']
  }))};
}

export function expiryBoard(db,supplied){
  const u=actor(db,supplied),day=today(),settings=watchSettings(db,u.tenant_id);
  const {items,malformed,sources}=gather(db,u,{day,settings});
  const used=new Set(items.map(i=>i.doc_kind));
  const kinds=WATCHED_KINDS.map(k=>{
    const setting=settings.get(k.key)??null,manage=can(db,u,k.capability);
    return {key:k.key,name:k.name,source:k.source,capability:k.capability,in_use:used.has(k.key),
      can_set:manage,setting:setting?{first_reminder_days:setting.first_reminder_days,second_reminder_days:setting.second_reminder_days,basis:setting.basis,updated_at:setting.updated_at,version:setting.version}:null,
      actions:manage?[setting?'update_watch':'set_watch']:[]};
  });
  const count=status=>items.filter(i=>i.status===status).length;
  return {
    generated_at:now(),today:day,user_id:u.id,
    items,sources,malformed,kinds,
    totals:{expired:count('expired'),due_soon:count('due_soon'),ok:count('ok'),unconfigured:items.filter(i=>!i.configured&&i.status!=='expired').length},
    missing_settings:[...new Set(items.filter(i=>!i.configured).map(i=>i.doc_kind))].map(key=>({key,name:kindName(key),can_set:can(db,u,kindByKey.get(key).capability)})),
    can_set_any:kinds.some(k=>k.can_set),
    // العقود التجارية: المصدر القائم `commercial_contracts` لا يحمل تاريخ انتهاء، فلا تُراقَب هنا اليوم.
    not_watched:[{source:'commercial_contracts',reason:'سجل الاتفاق التجاري لا يحمل تاريخ انتهاء في المخطط الحالي؛ لا نستنتج مدة من عندنا'}],
    note:'يقرأ هذا الرصد تواريخ الانتهاء من مصادرها لحظيًا ولا يخزّن نسخة منها. المنتهي يظهر بلا إعداد؛ أما «يقترب من الانتهاء» فلا يُقال إلا بمدة أدخلها مالك الإجراء بمصدره. لا تنبيه خارجي ولا اتصال بجهة: الرصد داخل المنصة فقط.'
  };
}

// المدة إعداد: من يملك الإجراء يدخلها بمصدرها وتاريخ تأكيدها، وتُخزَّن مؤرخة بنسخة.
export function saveExpiryWatch(db,supplied,docKind,input){
  writing(db);
  const u=actor(db,supplied);
  const kind=typeof docKind==='string'?kindByKey.get(docKind):null;
  if(!kind)fail(404,'not_found','نوع الوثيقة غير مراقَب');
  if(!can(db,u,kind.capability))fail(403,'not_permitted','إدخال مدة التذكير لمالك إجراء هذا النوع');
  v.object(input,['version','first_reminder_days','second_reminder_days','basis']);
  const first=input.first_reminder_days,second=input.second_reminder_days;
  if(!Number.isInteger(first)||first<1||first>730)fail(400,'first_reminder_days','التذكير الأول من يوم إلى 730 يومًا');
  if(!Number.isInteger(second)||second<1||second>730)fail(400,'second_reminder_days','التذكير الثاني من يوم إلى 730 يومًا');
  if(second>=first)fail(400,'reminder_order','التذكير الأول يسبق الثاني: اجعل أيام الأول أكثر');
  const basis=v.text(input.basis,'مصدر المدة ومن أكدها وتاريخ التأكيد',1500,10);
  const existing=db.prepare('SELECT * FROM expiry_watch_settings WHERE tenant_id=? AND doc_kind=?').get(u.tenant_id,kind.key)??null;
  const time=now();
  if(existing){
    v.version(input.version,existing.version);
    db.prepare('UPDATE expiry_watch_settings SET first_reminder_days=?,second_reminder_days=?,basis=?,updated_by=?,updated_at=?,version=version+1 WHERE tenant_id=? AND doc_kind=?')
      .run(first,second,basis,u.id,time,u.tenant_id,kind.key);
  }else{
    if(input.version!==undefined&&input.version!==null)fail(409,'stale_version','لا يوجد إعداد سابق لهذا النوع. أعد تحميل الشاشة');
    db.prepare('INSERT INTO expiry_watch_settings(tenant_id,doc_kind,first_reminder_days,second_reminder_days,basis,updated_by,updated_at) VALUES(?,?,?,?,?,?,?)')
      .run(u.tenant_id,kind.key,first,second,basis,u.id,time);
  }
  audit(db,u,'expiry_watch',kind.key,existing?'expiry_watch.updated':'expiry_watch.set',
    existing?{first_reminder_days:existing.first_reminder_days,second_reminder_days:existing.second_reminder_days}:{},
    {first_reminder_days:first,second_reminder_days:second},basis);
  return {doc_kind:kind.key};
}
