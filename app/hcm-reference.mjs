import { holds } from './access.mjs';

const feature=(source_path,source_component,label,category,status,current_routes,required_capabilities,note)=>Object.freeze({source_path,source_component,label,category,status,current_routes,required_capabilities,note});

// هذه القائمة خريطة تغطية للنسخة المرجعية التي يملكها المستخدم. لا تقرأ قاعدة HCM ولا تنقل سجلاتها.
export const HCM_FEATURES=Object.freeze([
  feature('/','Dashboard','لوحة الموارد البشرية','القيادة','merged',['hr-operations','workforce'],['hr.operations.use'],'جمعت المنصة المؤشرات والخدمات في مركز العمليات ولوحة القوى العاملة.'),
  feature('/core-hrm','CoreHRM','السجل الأساسي للموظفين','الملف الوظيفي','native',['employees','employee-profile'],['employees.view'],'السجل الوظيفي وملف الموظف هما المصدر التشغيلي داخل المنصة.'),
  feature('/recruitment','Recruitment','الاستقطاب والتوظيف','الاستقطاب','native',['people'],['people.manage'],'دورة المرشح والطلب الوظيفي تعمل في وحدة التوظيف.'),
  feature('/onboarding','Onboarding','تهيئة الموظف الجديد','دورة الموظف','native',['lifecycle'],['people.manage'],'التهيئة جزء من دورة التعيين والمغادرة.'),
  feature('/attendance','Attendance','الحضور والانصراف','الوقت','native',['attendance'],['hr.attendance.manage'],'تدار سجلات الحضور والتصحيحات والمهمات والعمل الإضافي في وحدة واحدة.'),
  feature('/leave','Leave','الإجازات والأرصدة','الوقت','native',['leave','leave-accrual'],['leave.use'],'أنواع الإجازات وأرصدة الاستحقاق ومسار الطلب قائمة في المنصة.'),
  feature('/manager-leave-calendar','ManagerLeaveCalendar','تقويم إجازات الفريق','الوقت','merged',['leave'],['hr.attendance.manage'],'التقويم ضمن مساحة الإجازات بحسب نطاق المدير.'),
  feature('/payroll','Payroll','الرواتب والقسائم والحركات','التعويضات','merged',['payroll','payroll-extras','payroll-anomaly','wps'],['payroll.prepare'],'المسير والحركات والفحص وحماية الأجور موزعة على وحدات مترابطة.'),
  feature('/performance','Performance','إدارة الأداء','الأداء والتطوير','native',['performance'],['hr.performance.manage'],'دورات التقييم والمراجعات موجودة في وحدة الأداء.'),
  feature('/learning','Learning','التعلم والتدريب','الأداء والتطوير','native',['growth'],['hr.performance.manage'],'طلبات التدريب وخطط التطوير في مساحة النمو.'),
  feature('/career','CareerPlanning','المسار والتعاقب الوظيفي','الأداء والتطوير','merged',['growth'],['hr.succession.manage'],'الملف المهني وخطط التعاقب في مساحة النمو.'),
  feature('/engagement','Engagement','الارتباط الوظيفي','التجربة','merged',['pulse','recognition'],['hr.survey.manage'],'النبض والتقدير يغطيان قياس الارتباط ومتابعته.'),
  feature('/analytics','Analytics','تحليلات الموارد البشرية','التقارير','merged',['workforce','reports'],['hr.workforce.view'],'مؤشرات القوى العاملة والتقارير تقرأ السجلات الفعلية.'),
  feature('/compliance','Compliance','الامتثال والالتزامات','الحوكمة','merged',['compliance','expiry'],['compliance.manage','employees.view'],'تقويم الالتزام وانتهاء الوثائق منفصلان حسب المسؤولية.'),
  feature('/settings','AdminSettings','إعدادات الموارد البشرية','الإدارة','merged',['hr-operations'],['hr.permissions.delegate'],'تفويض فريق الموارد البشرية داخل مركزه؛ إعدادات المنصة العامة تبقى للأدمن.'),
  feature('/activity-log','ActivityLog','سجل النشاط التقني','الإدارة','restricted',['access-reviews'],['access.review'],'السجل الكامل ومراجعات الصلاحيات مقيدان بأدمن المنصة ولا ينقلان إلى موظف الموارد البشرية.'),
  feature('/zoho-integration','ZohoIntegration','تكامل Zoho','التكاملات','external',['integrations'],['integrations.view'],'تظهر حالة الجاهزية فقط؛ لا يدّعي النظام اتصالًا أو ترحيلًا دون مفاتيح وخطة انتقال معتمدة.'),
  feature('/weekly-report','WeeklyReport','التقرير الأسبوعي','التقارير','merged',['reports','workforce'],['hr.workforce.view'],'يغطيه مركز التقارير وبيانات القوى العاملة.'),
  feature('/employee-portal','EmployeePortal','بوابة الموظف','الخدمة الذاتية','native',['portal'],['portal.use'],'بوابة الموظف الحالية هي نقطة الدخول الموحدة.'),
  feature('/employee-passwords','EmployeePasswords','إدارة كلمات المرور','الإدارة','restricted',['accounts'],['accounts.manage'],'لا يرى مدير الموارد البشرية كلمات المرور؛ إدارة الحسابات لأدمن المنصة وبلا كشف أسرار.'),
  feature('/hr-approvals','HRApprovals','اعتمادات الموارد البشرية','الموافقات','merged',['inbox','approval-settings'],['hr.operations.use'],'تصل القرارات إلى صندوق المعتمد، بينما إعداد مسارات الاعتماد مقيد.'),
  feature('/org-chart','OrgChart','الهيكل التنظيمي','الملف الوظيفي','native',['org'],['org.view'],'الهيكل التنظيمي متاح بحسب نطاق الحساب.'),
  feature('/work-requests','WorkRequests','طلبات الموظفين','الخدمة الذاتية','native',['my-requests'],['requests.use'],'الطلبات وحالاتها وخطها الزمني في طلباتي.'),
  feature('/projects','ProjectsClients','المشاريع والعملاء','التشغيل','merged',['projects'],['projects.use'],'مهام المشاريع مرتبطة بالفرق والعضوية.'),
  feature('/performance-eval','PerformanceEval','نماذج تقييم الأداء','الأداء والتطوير','merged',['performance','review-360'],['hr.performance.manage'],'التقييم الدوري و360 يعملان فوق سجل الأداء نفسه.'),
  feature('/self-service','SelfService','الخدمة الذاتية','الخدمة الذاتية','merged',['portal','forms'],['portal.use','forms.fill'],'الخدمات والنماذج تُفتح من بوابة الموظف.'),
  feature('/expenses','Expenses','المصروفات والعهد','الخدمة الذاتية','native',['expenses'],['requests.use'],'طلبات المصروفات والعهدة لها دورة مستقلة.'),
  feature('/surveys','Surveys','الاستبانات','التجربة','merged',['hr-operations','pulse'],['hr.survey.manage'],'الاستبانات العامة والنبض موجودة مع حماية الإجابات المجهولة.'),
  feature('/documents','Documents','وثائق الموارد البشرية','الوثائق','merged',['policy-library','expiry'],['employees.view'],'السياسات والوثائق المنتهية تحفظ في وحداتها الأصلية.'),
  feature('/skills-matrix','SkillsMatrix','مصفوفة المهارات','الأداء والتطوير','native',['hr-operations'],['hr.competency.manage'],'قاموس الكفاءات ومستويات المهارة ودليل الفجوة يعمل في مركز العمليات.'),
  feature('/ai-assistant','AIAssistant','مساعد سياسات الموظف','الخدمة الذاتية','merged',['policy-assistant'],['portal.use'],'اسأل تركي يجيب عن سياسات الشركة وبيانات السائل المسموح بها فقط.'),
  feature('/recognition','Recognition','التقدير','التجربة','native',['recognition'],['hr.survey.manage'],'التقدير ضمن خدمات تجربة الموظف.'),
  feature('/notifications','Notifications','إعدادات الإشعارات','الخدمة الذاتية','native',['notification-settings'],['portal.use'],'كل موظف يدير تفضيلات إشعاراته.'),
  feature('/wellness','WellnessProgram','العافية والمزايا','المزايا','merged',['my-benefits','benefits-admin'],['hr.benefits.manage'],'المطالبات والمزايا الصحية في بوابة المزايا وإدارتها.'),
  feature('/knowledge-base','KnowledgeBase','قاعدة المعرفة','المعرفة','native',['knowledge'],['knowledge.manage'],'المقالات تمر بدورة تحقق قبل النشر.'),
  feature('/okrs','OKRsDashboard','الأهداف والمبادرات','الأداء والتطوير','native',['objectives'],['governance.objectives.manage'],'الأهداف والمبادرات محفوظة في سجل الحوكمة.'),
  feature('/gamification','Gamification','التحفيز والتقدير','التجربة','merged',['recognition'],['hr.survey.manage'],'استوعبت داخل التقدير دون إنشاء نقاط شكلية غير مرتبطة بنتيجة عمل.'),
  feature('/workflow','WorkflowEngine','مسارات الاعتماد','الموافقات','merged',['inbox','approval-settings'],['hr.operations.use'],'تنفيذ الاعتماد في صندوق القرارات؛ إعداد القواعد يبقى لمسؤول النظام.'),
  feature('/recruitment-pipeline','RecruitmentPipeline','خط المرشحين','الاستقطاب','native',['people','pipeline'],['people.manage'],'دورة المرشحين في التوظيف مع ربط الاحتياج بالطلب.'),
  feature('/onboarding-journey','OnboardingJourney','رحلة الموظف الجديد','دورة الموظف','merged',['lifecycle','portal'],['people.manage'],'رحلة التهيئة والمهام تفتح من دورة الموظف وبوابته.'),
  feature('/advanced-analytics','AdvancedAnalytics','التحليلات المتقدمة','التقارير','merged',['reports','workforce'],['hr.workforce.view'],'التقارير لا تعرض مؤشرات بلا مصدر خادمي.'),
  feature('/engagement-hub','EngagementHub','مركز اندماج الموظف','التجربة','merged',['pulse','recognition','announcements'],['hr.survey.manage'],'النبض والتقدير والإعلانات تجتمع كخدمات اندماج مترابطة.'),
  feature('/learning-hub','LearningHub','مركز التعلم','الأداء والتطوير','merged',['growth','knowledge'],['hr.performance.manage'],'التدريب والمواد الموثقة في النمو وقاعدة المعرفة.'),
  feature('/privacy','PrivacyConsent','الخصوصية والموافقات','الحوكمة','native',['privacy','subject-requests'],['privacy.manage'],'سجل المعالجة وطلبات أصحاب البيانات موجودان بصلاحية حساسة.'),
  feature('/my-tasks','MyTasks','مهامي','التشغيل','native',['work'],['portal.use'],'مهام الموظف وقراراته تجمع في مساحة عملي.'),
  feature('/task-reports','TaskReports','تقارير المهام','التقارير','merged',['reports','projects'],['projects.use'],'تقارير التنفيذ تقرأ مهام المشاريع الفعلية.'),
  feature('/reports-center','ReportsCenter','مركز التقارير','التقارير','native',['reports'],['hr.workforce.view'],'المركز الموحد للتقارير بحسب نطاق الحساب.'),
  feature('/department-reports','DepartmentReports','تقارير الإدارة','التقارير','merged',['reports','workforce'],['hr.workforce.view'],'تقارير الإدارة والقوى العاملة ضمن نطاق مديرها.'),
  feature('/government','GovernmentIntegration','التكاملات الحكومية','التكاملات','external',['integrations','compliance'],['integrations.view'],'تظهر العقود وحالة الجاهزية فقط؛ لا استدعاء إنتاجي ولا نجاح مصطنع.'),
  feature('/email-management','EmailManagement','البريد والإشعارات','الإدارة','restricted',['mail','notification-settings'],['accounts.manage'],'تفضيلات الموظف شخصية؛ الإرسال والقوالب العامة مقيدان بإدارة المنصة.'),
  feature('/announcements','AnnouncementsManagement','الإعلانات الداخلية','التجربة','native',['announcements'],['hr.survey.manage'],'الإعلانات والفعاليات الداخلية ضمن التواصل والاندماج.'),
]);

export function hcmCoverage(db,user){
  const features=HCM_FEATURES.map(row=>({...row,available:!['restricted','external'].includes(row.status)&&row.required_capabilities.some(capability=>holds(db,user,capability))}));
  return {total:features.length,available:features.filter(row=>row.available).length,features};
}
