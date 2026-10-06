import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { catalogServices, baseServiceSections, defaultTargetDays, companyDepartments } from '../app/service-catalog.mjs';

// مراجعة منطق سير العمل لكل خدمة: هل المسار صحيح لطبيعتها، لا هل يعمل فقط.
const base=[
  {code:'HR-LETTER',name_ar:'طلب خطاب وظيفي',section:'الشهادات والخطابات',department_id:'hr',description:'خطاب وظيفي داخلي',fields:[{label:'الغرض',type:'textarea',required:true},{label:'الجهة',type:'text',required:true}],approval_policy:{steps:['manager','hr'],handler_role:'hr'},req:['HR-05']},
  {code:'IT-SUPPORT',name_ar:'طلب دعم تقني',section:'الدعم الفني',department_id:'it',description:'دعم تقني',fields:[{label:'وصف المشكلة',type:'textarea',required:true},{label:'أثر المشكلة',type:'select',required:true,options:['يمنع العمل']}],approval_policy:{steps:['manager'],handler_role:'it'},req:['IT-03']},
  {code:'CREATIVE-BRIEF',name_ar:'تكليف إبداعي داخلي',section:'التكليفات الإبداعية',department_id:'creative',description:'تكليف إبداعي',fields:[{label:'الهدف',type:'textarea',required:true},{label:'المخرج',type:'text',required:true},{label:'الموعد',type:'date',required:true}],approval_policy:{steps:['manager'],handler_role:'manager'},req:['CRT-01']}
];
const all=()=>[...catalogServices,...base];

const text=s=>[s.name_ar,s.description,...s.fields.map(f=>f.label)].join(' ');
const subject=s=>`${s.name_ar} ${s.description}`;
const hasMoney=s=>s.fields.some(f=>f.type==='number'&&/ريال/.test(f.label));
// التزام إنفاق، لا رقم تقريري مثل «الإنفاق النهائي» أو «القيمة المتوقعة».
const reporting=/الإنفاق النهائي|القيمة المتوقعة|التكلفة الفعلية|المبلغ المتأخر|الفرق المتوقع|الميزانية الحالية/;
const moneyRequired=s=>s.fields.some(f=>f.type==='number'&&/ريال/.test(f.label)&&f.required&&!reporting.test(f.label));
const confidential=s=>/تظلم|شكوى سري|بلاغ|مخالفة|احتيال|تضارب|أمني|سلامة|توقف خدمة/.test(text(s));
// دوام الموظف وغيابه، لا «عدد الحضور» في حجز قاعة.
const timeOff=s=>/تصحيح حضور|استئذان|دوام|عمل إضافي|انتداب|سفر وانتداب|تدريب|إجازة|عمل عن بعد/.test(subject(s));
const external=s=>/بيان صحفي|ظهور إعلامي|نشر|تعميم|عقد|اتفاقية|فاتورة|تسعير|عرض|مؤثر|إعلان/.test(text(s));
const selfService=s=>/تعريف بالراتب|شهادة خبرة|تحديث البيانات|استفسار|فك قفل|قرطاسية/.test(subject(s));
const urgent=s=>s.fields.some(f=>f.label==='الأولوية')||/عاجل|طارئ|بلاغ أمني|توقف خدمة|بلاغ سلامة/.test(subject(s));
// يكفي أن تحمل الخدمة حقلًا نصيًا مفتوحًا أو حقلًا يشرح السبب.
const reasoned=s=>s.fields.some(f=>f.type==='textarea')||s.fields.some(f=>/مبرر|سبب|خلفية|تفاصيل|وصف|غرض|موجز|تكليف|ملاحظ|أدلة|دليل|خطة|مطلوب|نطاق/.test(f.label));
const steps=s=>s.approval_policy.steps;
const hasManager=s=>steps(s).includes('manager');
const hasDepartment=s=>steps(s).includes('department_manager')||steps(s).includes('hr')||steps(s).includes('it');

export function reviewWorkflows(services=all()){
  const findings=[];
  const flag=(service,rule,severity,message)=>findings.push({code:service.code,department:service.department_id,rule,severity,message});
  for(const s of services){
    const target=defaultTargetDays(s);
    if(confidential(s)&&hasManager(s))
      flag(s,'سرية',' عالية','بلاغ أو تظلم يمر بالمدير المباشر، وقد يكون المدير طرفًا في الموضوع');
    if(!confidential(s)&&timeOff(s)&&!hasManager(s))
      flag(s,'وقت الموظف','عالية','يمس دوام الموظف أو غيابه دون اعتماد مديره المباشر');
    if(moneyRequired(s)&&!hasDepartment(s))
      flag(s,'التزام مالي','عالية','طلب بمبلغ إلزامي دون اعتماد إدارة مالكة');
    if(moneyRequired(s)&&!hasManager(s)&&!/^(FIN|PRC|CRM|INF|PRO|DIG)-/.test(s.code))
      flag(s,'التزام مالي','متوسطة','مبلغ إلزامي دون مرور بالمدير المباشر لصاحب الطلب');
    if(external(s)&&steps(s).length===0)
      flag(s,'أثر خارجي','عالية','مخرج يصل جهة خارجية دون أي اعتماد');
    const reviewedByOwner=s.approval_policy.handler_role==='manager'&&hasManager(s);
    if(external(s)&&!hasDepartment(s)&&!reviewedByOwner)
      flag(s,'أثر خارجي','متوسطة','مخرج يصل جهة خارجية دون اعتماد الإدارة المالكة');
    if(!reasoned(s))
      flag(s,'كفاية القرار','متوسطة','لا يوجد حقل يشرح السبب أو السياق ليُبنى عليه القرار');
    if(urgent(s)&&target>2)
      flag(s,'زمن الخدمة','متوسطة',`خدمة عاجلة بزمن ${target} أيام`);
    if(selfService(s)&&hasManager(s)&&!timeOff(s)&&!hasMoney(s))
      flag(s,'إجراء زائد','منخفضة','خدمة ذاتية بسيطة تمر بالمدير دون حاجة');
    if(steps(s).length>=3&&s.fields.length<=3)
      flag(s,'إجراء زائد','منخفضة','ثلاث درجات اعتماد لخدمة ببيانات قليلة');
    if(steps(s).length===0)
      flag(s,'بلا اعتماد','عالية','خدمة بلا أي درجة اعتماد');
  }
  return findings;
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const services=all();
  const findings=reviewWorkflows(services);
  const flagged=new Set(findings.map(f=>f.code));
  console.log(`مراجعة سير العمل: ${services.length} خدمة، ${services.length-flagged.size} سليمة، ${flagged.size} تحتاج مراجعة، بمجموع ${findings.length} ملاحظة\n`);
  const bySeverity={};
  for(const f of findings)(bySeverity[f.severity.trim()]??=[]).push(f);
  for(const [severity,list] of Object.entries(bySeverity)){
    console.log(`— ملاحظات ${severity} (${list.length}):`);
    for(const f of list)console.log(`  ${f.code} [${f.rule}] ${f.message}`);
    console.log('');
  }
  const departments=Object.fromEntries(companyDepartments.map(d=>[d.id,d.name]));
  const byDept={};
  for(const f of findings)byDept[departments[f.department]??f.department]=(byDept[departments[f.department]??f.department]??0)+1;
  console.log('الملاحظات حسب الإدارة:');
  for(const [dept,n] of Object.entries(byDept).sort((a,b)=>b[1]-a[1]))console.log(`  ${dept}: ${n}`);
  if(findings.some(f=>f.severity.trim()==='عالية'))process.exitCode=1;
}
