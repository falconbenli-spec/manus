import { currentUser } from './delegations.mjs';
import { can } from './access.mjs';
import { crmReadiness } from './crm-front-door.mjs';

// مدخل واحد لكل خدمة (G7 في تدقيق بوابة الموظف 19 سبتمبر): خدمات في الدليل تكرر وحدة مخصصة بسلسلة اعتماد مختلفة.
// بطاقة الدليل لهذه الخدمات تفتح نموذج الوحدة نفسها فيبقى للطلب مسار اعتماد واحد. رمز الخدمة يبقى في الدليل ليجدها البحث.
// ready: متى تُحوَّل البطاقة. ما لا تستطيع وحدته أن تستقبله الآن من هذا الموظف يبقى طلبًا عامًا، حتى لا يُحال الموظف إلى طريق مسدود.
//   staff  — أي حساب موظف (الوحدة ترفض حساب الأدمن)
//   letters — نوع خطاب واحد على الأقل له قالب منشور؛ بدونه لا تقبل «خطاباتي» طلبًا (B15)
//   review — للموظف تقييم في دورة فُتحت؛ التظلم يُرفع من التقييم نفسه
//   client_team — الموظف في فريق حساب عميل غير مقفل؛ البلاغ ينفتح على عميل يراه (الحزمة 4، P4-CRM-5)
//   renewal — في فريق حساب عميل ويحمل تصريح المبيعات؛ فرصة التجديد تنفتح من «خط الفرص» (P4-CRM-6)
//   client_team / open_opportunity / handover — جاهزية سجلات العملاء الثلاثة (crmReadiness في app/crm-front-door.mjs)
export const MODULE_ROUTES=[
  {code:'HR-LETTER',module:'letters',link:'#letters/new',name:'خطاباتي',name_en:'My letters',ready:'letters'},
  {code:'HR-SALARY-CERT',module:'letters',link:'#letters/new',name:'خطاباتي',name_en:'My letters',ready:'letters'},
  {code:'HR-EXPERIENCE-CERT',module:'letters',link:'#letters/new',name:'خطاباتي',name_en:'My letters',ready:'letters'},
  {code:'HR-ATTENDANCE-FIX',module:'attendance',link:'#attendance/correction',name:'حضوري',name_en:'My attendance',ready:'staff'},
  {code:'HR-OVERTIME',module:'attendance',link:'#attendance/overtime',name:'حضوري',name_en:'My attendance',ready:'staff'},
  {code:'HR-GRIEVANCE',module:'hr-cases',link:'#hr-cases/new',name:'الشكاوى والاستفسارات',name_en:'Complaints and enquiries',ready:'staff'},
  {code:'TAL-TRAINING',module:'growth',link:'#growth/training',name:'التدريب والتطوير',name_en:'Training and growth',ready:'staff'},
  {code:'TAL-PERFORMANCE-REVIEW',module:'performance',link:'#performance',name:'تقييم الأداء',name_en:'Performance',ready:'review'},
  {code:'ADM-EXPENSE-CLAIM',module:'expenses',link:'#expenses/new',name:'مصروفاتي وعهدي',name_en:'My expenses',ready:'staff'},
  {code:'FIN-CUSTODY',module:'expenses',link:'#expenses/custody',name:'مصروفاتي وعهدي',name_en:'My expenses',ready:'staff'},
  {code:'PMO-TIMESHEET',module:'timesheets',link:'#timesheets',name:'كشفي الأسبوعي',name_en:'My weekly timesheet',ready:'staff'},
  // بلاغ العميل وتصعيده (P4-CRM-5، الترحيل 184): سجلٌّ على العميل والصفقة بمهلته، لا طلبًا نصيًا بحقل «العميل».
  {code:'ACC-CLIENT-COMPLAINT',module:'client-support',link:'#client-support/new?kind=complaint',name:'دعم العملاء',name_en:'Client support',ready:'client_team'},
  {code:'ACC-ESCALATION',module:'client-support',link:'#client-support/new?kind=escalation',name:'دعم العملاء',name_en:'Client support',ready:'client_team'},
  // التجديد (P4-CRM-6، الترحيل 185): فرصة تنفتح من العقد السابق قبل نهايته وتحمل نطاقه وأسعاره، لا طلبًا نصيًا بحقل «القيمة».
  {code:'ACC-RENEWAL',module:'pipeline',link:'#pipeline/renewal',name:'خط الفرص',name_en:'Pipeline',ready:'renewal'},
  // الباب الأمامي الواحد للعملاء (الحزمة 4، P4-CRM-3): البطاقة تفتح السجل المهيكل نفسه، والطلب العام بهذه الرموز يُرفض بإشارة إليه (app/crm-front-door.mjs).
  {code:'CRM-OPPORTUNITY',module:'pipeline',link:'#pipeline',name:'خط الفرص',name_en:'Pipeline',ready:'client_team'},
  {code:'CRM-LOSS',module:'pipeline',link:'#pipeline',name:'خط الفرص',name_en:'Pipeline',ready:'open_opportunity'},
  {code:'CRM-HANDOVER',module:'project-handover',link:'#project-handover',name:'نموذج التسليم',name_en:'Project handover',ready:'handover'}
];
// خدمات يذكرها التدقيق بجوار وحدة، لكنها تبقى طلبًا عامًا: وحدتها لا تعطي الموظف نموذجًا يقدّم منه.
export const KEPT_AS_REQUESTS=[
  {code:'HR-BENEFIT-CLAIM',module:'benefits',reason:'«التأمين والمزايا» شاشة لموظف الموارد البشرية؛ لا نموذج فيها للموظف.'},
  {code:'HR-DOC-RENEWAL',module:'expiry',reason:'«انتهاء الوثائق» ترصد التواريخ ولا تستقبل طلب تجديد.'},
  {code:'HR-RESIGNATION',module:'lifecycle',reason:'«التعيين والمغادرة» لموظف الموارد البشرية وحده.'},
  {code:'HR-BANK-CHANGE',module:'payroll-extras',reason:'«حركات الرواتب» لفريق الرواتب؛ الموظف يطلب التغيير ويسجله فريق الرواتب بدليله.'},
  {code:'HR-SALARY-ADVANCE',module:'payroll-extras',reason:'«حركات الرواتب» لفريق الرواتب؛ لا نموذج سلفة للموظف فيها.'}
];
const byCode=new Map(MODULE_ROUTES.map(r=>[r.code,r]));
export const moduleRouteFor=code=>byCode.get(code)??null;

// الجاهزية تُحسب باستعلامات صغيرة لأن /api/catalog يُطلب مع كل رسم للصفحة.
export function routeReadiness(db,supplied){
  const u=currentUser(db,supplied)??supplied,ready=new Set();
  if(!u||u.role==='admin')return ready;
  ready.add('staff');
  const letters=db.prepare(`SELECT 1 FROM letter_templates p JOIN letter_types t ON t.code=p.type_code AND (t.tenant_id=p.tenant_id OR t.tenant_id IS NULL)
    WHERE p.tenant_id=? AND p.status='published' AND t.active=1 LIMIT 1`).get(u.tenant_id);
  if(letters)ready.add('letters');
  const review=db.prepare("SELECT 1 FROM performance_reviews r JOIN review_cycles c ON c.id=r.cycle_id WHERE r.user_id=? AND c.tenant_id=? AND c.status<>'draft' LIMIT 1").get(u.id,u.tenant_id);
  if(review)ready.add('review');
  const team=db.prepare("SELECT 1 FROM clients c LEFT JOIN client_members m ON m.client_id=c.id AND m.user_id=? AND m.removed_at IS NULL WHERE c.tenant_id=? AND c.status<>'closed' AND (c.owner_id=? OR m.user_id IS NOT NULL) LIMIT 1").get(u.id,u.tenant_id,u.id);
  if(team)ready.add('client_team');
  if(team&&can(db,u,'commercial.use',u.department_id))ready.add('renewal');
  for(const key of crmReadiness(db,u))ready.add(key);
  return ready;
}

// يضيف إلى كل خدمة مكررة رابط وحدتها حين تستطيع الوحدة أن تستقبل الطلب من هذا الحساب. لا يحذف خدمة ولا يغير رمزها.
export function annotateCatalog(db,supplied,services){
  const ready=routeReadiness(db,supplied);
  if(!ready.size)return services;
  return services.map(s=>{
    const route=byCode.get(s.code);
    return route&&ready.has(route.ready)?{...s,module_link:route.link,module_key:route.module,module_name:route.name,module_name_en:route.name_en}:s;
  });
}
