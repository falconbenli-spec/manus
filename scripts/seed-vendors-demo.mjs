import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb, transaction } from '../app/db.mjs';
import { grantAccess } from '../app/access.mjs';
import { createVendor, getVendor, vendorAction } from '../app/vendors.mjs';

// موردون مصطنعون لعرض مركز الموردين. كل اسم موسوم «تجريبي» ولا يمثل منشأة حقيقية.
const synthetic={'36t':'3,6T — بيئة تجريبية',isolated:'كيان اختبار معزول'};
function iban(bban){
  const numeric=(bban+'SA00').replace(/[A-Z]/g,c=>String(c.charCodeAt(0)-55));
  let remainder=0;for(const digit of numeric)remainder=(remainder*10+Number(digit))%97;
  return 'SA'+String(98-remainder).padStart(2,'0')+bban;
}
const day=offset=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Riyadh',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(Date.now()+offset*86400000));

export function seedVendorsDemo(db){
  const tenants=db.prepare('SELECT id,name FROM tenants').all();
  if(!tenants.length||tenants.some(t=>synthetic[t.id]!==t.name))throw new Error('Synthetic tenants only. Refusing to add demo vendors to this database.');
  if(db.prepare("SELECT COUNT(*) AS n FROM vendors WHERE tenant_id='36t'").get().n)return 0;
  const user=(...ids)=>{for(const id of ids){const u=db.prepare("SELECT * FROM users WHERE id=? AND tenant_id='36t' AND active=1").get(id);if(u)return u;}throw new Error('Missing synthetic account: '+ids.join('/'));};
  const admin=user('admin'),registrar=user('employee'),reviewer=user('head-procurement','outsider'),finance=user('head-finance','hr'),legal=user('head-legal','it'),assessor=user('manager');
  const grant=(u,capability)=>{try{transaction(db,()=>grantAccess(db,admin,{user_id:u.id,capability,note:'تصريح عرض تجريبي لمركز الموردين'}));}catch(error){if(!['already_granted','already_default'].includes(error.code))throw error;}};
  grant(registrar,'vendors.manage');grant(reviewer,'vendors.manage');grant(finance,'vendors.bank');grant(legal,'vendors.legal');
  const act=(who,vendorId,action,values={})=>transaction(db,()=>vendorAction(db,who,vendorId,action,{version:getVendor(db,who,vendorId).version,...values}));
  const register=input=>transaction(db,()=>createVendor(db,registrar,{country:'SA',vat_number:'',regions:'الرياض',payment_terms:'ثلاثون يومًا بعد المطابقة',data_source:'نموذج تسجيل تجريبي أُدخل لعرض المنصة',...input})).id;
  const documents=(vendorId,kinds,expires='2028-12-31')=>{for(const kind of kinds)act(registrar,vendorId,'add_document',{kind,reference:`وثيقة تجريبية محفوظة في مجلد الموردين — ${kind}`,issued_on:'2026-01-05',expires_on:expires});};
  const verify=(vendorId,except=[])=>{for(const d of getVendor(db,reviewer,vendorId).documents.filter(d=>d.verification==='pending'&&!except.includes(d.kind)))act(d.kind==='bank_proof'?finance:reviewer,vendorId,'verify_document',{document_id:d.id,verification:'verified',note:'طوبقت الوثيقة التجريبية مع مصدرها'});};
  const contact=vendorId=>act(registrar,vendorId,'add_contact',{name:'ممثل المورد (تجريبي)',role:'مدير الحساب',email:'contact@vendor.invalid',phone:''});
  const reviews=(vendorId,kinds)=>{for(const kind of kinds)act(kind==='technical'?assessor:kind==='finance'?finance:kind==='legal'?legal:reviewer,vendorId,'review_'+kind,{decision:'passed',note:'اجتاز المراجعة في بيانات العرض التجريبية'});};
  const qualify=(input,kinds)=>{const vendorId=register(input);contact(vendorId);documents(vendorId,kinds);act(registrar,vendorId,'submit');verify(vendorId);reviews(vendorId,['duplicate','technical','procurement']);act(reviewer,vendorId,'approve',{outcome:'approved',reason:'اجتاز فحص التكرار والتقييم الفني ومراجعة المشتريات (بيانات عرض)'});return vendorId;};

  const print=qualify({legal_name:'مطبعة الأفق (تجريبي)',trade_name:'الأفق للطباعة',entity_type:'company',entity_ref:'1010999001',vat_number:'399999999900003',categories:['print_gifts'],supplier_key:'DEMO-PRINT'},['commercial_registration','vat_certificate']);
  act(registrar,print,'propose_bank',{bank_name:'بنك تجريبي',account_holder:'مطبعة الأفق (تجريبي)',iban:iban('80000000000099900001'),reason:'تسجيل حساب الدفع الأول للمورد التجريبي'});
  documents(print,['bank_proof']);verify(print);
  act(finance,print,'verify_bank',{bank_id:getVendor(db,finance,print).bank[0].id,decision:'verified',verification_method:'bank_letter',verification_evidence:'خطاب بنكي تجريبي يطابق اسم صاحب الحساب',effective_from:day(0)});
  act(assessor,print,'evaluate',{category:'print_gifts',scores:{quality:5,commitment:4,total_cost:4,invoice_accuracy:5,responsiveness:4,remediation:4,usage_rights:5},evidence:'أمر طباعة تجريبي: جودة مطابقة وتسليم متأخر يومًا واحدًا'});

  const web=qualify({legal_name:'شركة منصات الويب (تجريبي)',entity_type:'company',entity_ref:'1010999002',categories:['web_tech'],supplier_key:'DEMO-WEB'},['commercial_registration']);
  db.prepare("UPDATE vendor_documents SET expires_on=? WHERE vendor_id=? AND kind='commercial_registration'").run(day(20),web);
  act(registrar,web,'propose_bank',{bank_name:'بنك تجريبي',account_holder:'شركة منصات الويب (تجريبي)',iban:iban('80000000000099900002'),reason:'المورد طلب تسجيل حسابه؛ بانتظار تحقق مالي مستقل'});

  const logistics=qualify({legal_name:'مؤسسة النقل السريع (تجريبي)',entity_type:'establishment',entity_ref:'1010999003',categories:['logistics'],supplier_key:'DEMO-LOGISTICS'},['commercial_registration']);
  act(reviewer,logistics,'suspend',{reason:'تأخر متكرر في التسليم قيد المراجعة (بيانات عرض)'});

  const studio=register({legal_name:'استوديو عدسة (تجريبي)',entity_type:'establishment',entity_ref:'1010999004',vat_number:'399999999900043',categories:['photo_video','motion_design'],supplier_key:'DEMO-STUDIO'});
  contact(studio);documents(studio,['commercial_registration','vat_certificate']);act(registrar,studio,'submit');verify(studio,['vat_certificate']);reviews(studio,['duplicate','technical','procurement']);
  act(reviewer,studio,'approve',{outcome:'conditional',reason:'اعتماد مشروط لحين التحقق من الشهادة الضريبية (بيانات عرض)',valid_until:day(45),condition_note:'تقديم شهادة ضريبية مقروءة قبل نهاية المدة'});

  const creator=register({legal_name:'صانعة محتوى (تجريبي)',entity_type:'individual',entity_ref:'',categories:['influencers'],supplier_key:'DEMO-CREATOR'});
  act(registrar,creator,'add_contact',{name:'صانعة المحتوى (تجريبي)',role:'المتعاقدة',email:'',phone:'+966500000000'});
  act(registrar,creator,'submit');reviews(creator,['technical']);

  const copy=register({legal_name:'مطبعة الافق للطباعة (تجريبي)',entity_type:'company',entity_ref:'1010999001',categories:['print_gifts'],supplier_key:'DEMO-PRINT-COPY'});
  contact(copy);documents(copy,['commercial_registration']);act(registrar,copy,'submit');

  register({legal_name:'Synthetic Events FZ (تجريبي)',entity_type:'foreign',country:'AE',entity_ref:'AE-DEMO-7788',categories:['events'],legal_review_required:true,supplier_key:'DEMO-EVENTS'});
  return db.prepare("SELECT COUNT(*) AS n FROM vendors WHERE tenant_id='36t'").get().n;
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  if(process.env.NODE_ENV==='production')throw new Error('Demo vendors are disabled in production.');
  const db=openDb(resolve(process.env.LOCAL_DB_PATH||'work/local.sqlite'));
  try{console.log(`Demo vendors available: ${seedVendorsDemo(db)||'already present'}.`);}
  finally{db.close();}
}
