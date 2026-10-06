import { fail } from './auth.mjs';
import { actorOrRefuse } from './refusal.mjs';
import { isPeopleOfficer } from './access.mjs';
import { catalog } from './workflow.mjs';
import { maskReference } from './expiry.mjs';
import { dependantsOfEmployee } from './benefits.mjs';

// «ملفي» (G1): الموظف يطّلع على ملفه ولا يعدّله. كل تغيير طلب في دليل الخدمات يعتمده الموارد البشرية.
// الخصوصية: الملف لصاحبه ولموظف الموارد البشرية (دور hr أو تصريح employees.view الممنوح صراحة). المدير المباشر لا يراه هنا،
// ولا يكفي امتياز الأدمن وحده (holds لا can). أرقام الوثائق والآيبان تغادر الخادم مقنّعة دائمًا: آخر أربعة أرقام فقط.
// التابعون بيانات طرف ثالث (066-leave-accrual-benefits.sql): يراها صاحبها، ومن غيره حامل hr.benefits.manage وحده.
const today=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Riyadh',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const EXPIRY_WINDOW=60;
export const DOC_NAMES={national_id:['الهوية الوطنية','National ID'],iqama:['الإقامة','Iqama'],work_permit:['رخصة العمل','Work permit'],passport:['جواز السفر','Passport'],contract:['وثيقة عقد محفوظة','Contract document'],qualification:['مؤهل','Qualification'],medical_insurance:['تأمين طبي','Medical insurance'],other:['وثيقة أخرى','Other document']};
const IDENTITY=['national_id','iqama','passport','work_permit'];
const EMPLOYMENT={full_time:['دوام كامل','Full time'],part_time:['دوام جزئي','Part time'],contract:['متعاقد','Contractor'],intern:['متدرب','Intern']};
const CONTRACT={indefinite:['غير محدد المدة','Indefinite'],fixed_term:['محدد المدة','Fixed term']};
const BANK_STATUS={pending:['بانتظار التحقق','Awaiting verification'],verified:['متحقق منه','Verified'],rejected:['مرفوض','Rejected']};
// الآيبان: لا يُقرأ العمود المختوم أصلًا؛ آخر أربعة أرقام محفوظة وحدها في iban_last4.
export const maskIban=last4=>`••••${String(last4??'').replace(/\W/g,'').slice(-4)}`;
// خدمات التغيير: رموز الدليل التي يمر بها أي تعديل على الملف. لا تعديل مباشر من هذه الشاشة.
export const CHANGE_SERVICES=[
  {code:'HR-PROFILE-UPDATE',for:'profile',label:['تحديث البيانات أو الوثائق','Update details or documents']},
  {code:'HR-DOC-RENEWAL',for:'documents',label:['تجديد إقامة أو رخصة عمل','Renew iqama or work permit']},
  {code:'HR-BANK-CHANGE',for:'bank',label:['تغيير حساب الراتب','Change salary account']},
  {code:'HR-BENEFIT-CLAIM',for:'dependants',label:['إضافة تابع أو مطالبة تأمين','Add a dependant or insurance claim']}
];
const pair=(map,key)=>map[key]??[key??'—',key??'—'];

const actor=actorOrRefuse;
// التعريف الواحد في app/access.mjs؛ يُعاد تصديره هنا لأن وحدات أخرى تقرؤه من هذا الباب.
export { isPeopleOfficer } from './access.mjs';

function documentView(row,day){
  const days=Math.round((Date.parse(row.expires_on+'T00:00:00Z')-Date.parse(day+'T00:00:00Z'))/86400000);
  const [name,name_en]=pair(DOC_NAMES,row.doc_type);
  return {id:row.id,doc_type:row.doc_type,name,name_en,number_masked:maskReference(row.reference),issued_on:row.issued_on??null,expires_on:row.expires_on,days_left:days,
    state:row.replaced_by?'replaced':days<0?'expired':days<=EXPIRY_WINDOW?'expiring':'valid',current:!row.replaced_by};
}

export function profileView(db,supplied,userId){
  const u=actor(db,supplied),targetId=userId??u.id;
  const person=typeof targetId==='string'&&db.prepare('SELECT id,name,tenant_id,department_id,manager_id,role,active FROM users WHERE id=? AND tenant_id=?').get(targetId,u.tenant_id);
  const own=person?.id===u.id,officer=isPeopleOfficer(db,u);
  // لا يُفرَّق بين «غير موجود» و«غير مسموح» لغير موظف الموارد البشرية حتى لا تكشف الصفحة من يعمل في الشركة.
  if(!person||(!own&&!officer))fail(404,'not_found','الملف لصاحبه ولموظف الموارد البشرية وبس');
  const day=today();
  const profile=db.prepare('SELECT job_title,employment_type,join_date,contract_end,status FROM employee_profiles WHERE user_id=? AND tenant_id=?').get(person.id,u.tenant_id)??null;
  const contract=db.prepare("SELECT contract_type,job_title,start_date,end_date,work_location,weekly_hours FROM employment_contracts WHERE user_id=? AND tenant_id=? AND status='active' ORDER BY start_date DESC LIMIT 1").get(person.id,u.tenant_id)??null;
  const department=db.prepare('SELECT name FROM departments WHERE id=? AND tenant_id=?').get(person.department_id,u.tenant_id)?.name??null;
  const manager=person.manager_id?db.prepare('SELECT name FROM users WHERE id=? AND tenant_id=?').get(person.manager_id,u.tenant_id)?.name??null:null;
  const documents=db.prepare('SELECT id,doc_type,reference,issued_on,expires_on,replaced_by FROM employee_documents WHERE user_id=? AND tenant_id=? ORDER BY replaced_by IS NOT NULL,expires_on').all(person.id,u.tenant_id).map(r=>documentView(r,day));
  const bankRows=db.prepare('SELECT id,bank_name,iban_last4,status,effective_month,created_at FROM employee_bank_accounts WHERE user_id=? AND tenant_id=? ORDER BY created_at DESC LIMIT 5').all(person.id,u.tenant_id);
  const verified=bankRows.find(b=>b.status==='verified')??null,pending=bankRows.find(b=>b.status==='pending')??null;
  const bankView=b=>b?{bank_name:b.bank_name,iban_masked:maskIban(b.iban_last4),status:b.status,status_name:pair(BANK_STATUS,b.status)[0],status_name_en:pair(BANK_STATUS,b.status)[1],effective_month:b.effective_month}:null;
  // التابعون من وحدة المزايا نفسها، القارئ الوحيد لجدولهم: لصاحبها ولحامل hr.benefits.manage، وnull لغيرهما.
  const dependants=dependantsOfEmployee(db,u,person.id),seesDependants=dependants!==null;
  const services=catalog(db,u);
  const [employment_type_name,employment_type_name_en]=profile?pair(EMPLOYMENT,profile.employment_type):[null,null];
  const [contract_type_name,contract_type_name_en]=contract?pair(CONTRACT,contract.contract_type):[null,null];
  return {
    today:day,own,viewer_is_officer:officer&&!own,
    person:{id:person.id,name:person.name,active:!!person.active},
    job:{job_title:contract?.job_title??profile?.job_title??null,department,manager,hire_date:profile?.join_date??contract?.start_date??null,
      employment_type:profile?.employment_type??null,employment_type_name,employment_type_name_en,
      contract_type:contract?.contract_type??null,contract_type_name,contract_type_name_en,contract_end:contract?.end_date??profile?.contract_end??null,
      work_location:contract?.work_location??null,status:profile?.status??null,recorded:!!(profile||contract)},
    identity:documents.filter(d=>d.current&&IDENTITY.includes(d.doc_type)),
    documents,
    bank:{current:bankView(verified),pending:bankView(pending)},
    dependants,dependants_hidden:!seesDependants,
    change_services:CHANGE_SERVICES.map(c=>{const s=services.find(x=>x.code===c.code);return {code:c.code,for:c.for,label:c.label[0],label_en:c.label[1],service_id:s?.id??null,available:!!s};}),
    privacy:'يرى هذا الملف صاحبه وموظف الموارد البشرية فقط. أرقام الهوية والجواز والآيبان تظهر بآخر أربعة أرقام، ولا يُعدَّل شيء هنا مباشرة: كل تغيير طلب تعتمده الموارد البشرية.'
  };
}
