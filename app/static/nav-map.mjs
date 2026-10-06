// خريطة التنقل المعتمدة في ت0 (docs/org/nav-mapping.md، ودفعة «بعد-ب» وبنود ب-تنقل-1..6).
// مصدر واحد تقرؤه القائمة الجانبية وصفحات «ملفي» و«فريقي» و«المنظمة» و«إدارة المنصة» و«أدوات الإدارة».
// لا تمنح وصولًا ولا تمنعه: تضع كل شاشة يصلها الحساب اليوم (بالشروط القائمة في shell) في مكان واحد ظاهر.
// مولَّد من docs/org/scripts/build_nav_mapping.py ثم حُرِّر عقده يدويًا؛ البيانات أدناه لا تُعدَّل إلا بقرار مسجَّل.

// kind: entry | pending | requests | profile | team | org | services | tool | report | admin | context
export const NAV_DEST={"home":{"kind":"entry","label":"الرئيسية"},"portal":{"kind":"entry","label":"بوابة الموظف"},"inbox":{"kind":"entry","label":"بانتظار إجرائي"},"work":{"kind":"pending","label":"عملي"},"my-requests":{"kind":"entry","label":"طلباتي"},"notifications":{"kind":"entry","label":"الإشعارات"},"announcements":{"kind":"org","label":"الإعلانات"},"attendance":{"kind":"profile","label":"حضوري"},"leave":{"kind":"profile","label":"إجازاتي"},"time":{"kind":"profile","label":"ساعاتي"},"expenses":{"kind":"requests","label":"مصروفاتي وعهدي"},"letters":{"kind":"profile","label":"خطاباتي"},"resignations":{"kind":"services","label":"الاستقالة"},"travel":{"kind":"profile","label":"الانتداب"},"contracts":{"kind":"profile","label":"عقدي وراتبي"},"payroll":{"kind":"profile","label":"قسائمي"},"profile":{"kind":"profile","label":"ملفي"},"my-benefits":{"kind":"profile","label":"مزاياي"},"hr-cases":{"kind":"services","label":"الشكاوى والاستفسارات"},"my-discipline":{"kind":"profile","label":"مخالفاتي"},"policy-library":{"kind":"org","label":"مكتبة السياسات"},"policy-assistant":{"kind":"org","label":"اسأل تركي"},"policy-acknowledgements":{"kind":"org","label":"السياسات المطلوب إقرارها"},"pulse":{"kind":"profile","label":"النبض"},"recognition":{"kind":"profile","label":"التقدير"},"one-to-ones":{"kind":"profile","label":"اللقاءات الفردية"},"feedback":{"kind":"profile","label":"ملاحظات الزملاء"},"security":{"kind":"profile","label":"أمان حسابي"},"assistants":{"kind":"profile","label":"المساعدون الذكيون"},"appearance":{"kind":"profile","label":"المظهر"},"notification-settings":{"kind":"profile","label":"إعدادات الإشعارات"},"services":{"kind":"entry","label":"الخدمات"},"catalog":{"kind":"services","label":"الخدمات"},"requests":{"kind":"pending","label":"طلباتي / الطلبات الواردة / طلبات الفريق"},"departments":{"kind":"services","label":"الخدمات"},"service-cards":{"kind":"tool","label":"خدمات الإدارة","dept":"*own","shared":true},"delegations":{"kind":"team","label":"التفويض المؤقت"},"knowledge":{"kind":"admin","label":"مراجعة المصادر"},"forms":{"kind":"context","label":"النماذج الإلكترونية"},"centres":{"kind":"admin","label":"المراكز التخصصية"},"access-reviews":{"kind":"admin","label":"مراجعة الصلاحيات"},"integrations":{"kind":"admin","label":"حالة التكاملات"},"requirements":{"kind":"admin","label":"نطاق المنصة"},"accounts":{"kind":"admin","label":"الموظفون والصلاحيات"},"platform-health":{"kind":"admin","label":"مركز تشغيل المنصة"},"permissions-matrix":{"kind":"admin","label":"مصفوفة الصلاحيات"},"ai-governance":{"kind":"admin","label":"حوكمة المساعدين"},"jobs":{"kind":"admin","label":"المهام الخلفية"},"feature-flags":{"kind":"admin","label":"مفاتيح الميزات"},"mail":{"kind":"admin","label":"البريد والإشعارات"},"definitions":{"kind":"admin","label":"تعريفات الصفحات"},"catalog-quality":{"kind":"admin","label":"نواقص دليل الخدمات"},"service-insight":{"kind":"admin","label":"قياس الخدمات"},"service-benchmark":{"kind":"admin","label":"تطوير الخدمات"},"intake-settings":{"kind":"admin","label":"أولويات الطلبات"},"approval-settings":{"kind":"admin","label":"مسارات الاعتماد"},"org":{"kind":"org","label":"الهيكل التنظيمي"},"reports":{"kind":"report","label":"مركز التقارير","dept":"*own"},"executive":{"kind":"tool","label":"اللوحة التنفيذية","dept":"ceo-office"},"decisions":{"kind":"tool","label":"القرارات والمحاضر","dept":"ceo-office"},"objectives":{"kind":"tool","label":"الأهداف والمبادرات","dept":"epmo"},"epmo":{"kind":"report","label":"تقرير الإدارة التنفيذية للمشاريع","dept":"epmo"},"compliance":{"kind":"tool","label":"تقويم الالتزامات","dept":"grc"},"risks":{"kind":"tool","label":"سجل المخاطر","dept":"grc"},"privacy":{"kind":"tool","label":"حماية البيانات","dept":"grc"},"subject-requests":{"kind":"tool","label":"طلبات أصحاب البيانات","dept":"grc"},"hr-operations":{"kind":"tool","label":"مركز عمليات الموارد البشرية","dept":"hr"},"employees":{"kind":"tool","label":"السجل الوظيفي","dept":"hr"},"employee-profile":{"kind":"tool","label":"ملف الموظف","dept":"hr"},"expiry":{"kind":"tool","label":"انتهاء الوثائق","dept":"hr"},"discipline":{"kind":"tool","label":"المخالفات والجزاءات","dept":"hr"},"payroll-rules":{"kind":"tool","label":"قواعد اللائحة في الرواتب","dept":"hr"},"benefits-admin":{"kind":"tool","label":"إدارة المزايا","dept":"hr"},"payroll-extras":{"kind":"tool","label":"حركات الرواتب","dept":"hr"},"payroll-anomaly":{"kind":"tool","label":"فحص المسير","dept":"hr"},"wage-reconciliation":{"kind":"tool","label":"مطابقة الأجور","dept":"hr"},"wps":{"kind":"tool","label":"ملف حماية الأجور","dept":"hr"},"payroll-insurance":{"kind":"tool","label":"حالات التأمينات","dept":"hr"},"people":{"kind":"tool","label":"التوظيف","dept":"hr"},"lifecycle":{"kind":"tool","label":"التعيين والمغادرة","dept":"hr"},"clearance":{"kind":"tool","label":"إخلاء الطرف","dept":"hr"},"hr-policies":{"kind":"tool","label":"سياسات الموارد البشرية","dept":"hr"},"letter-templates":{"kind":"tool","label":"قوالب الخطابات","dept":"hr"},"workforce":{"kind":"tool","label":"تركيبة الموظفين","dept":"hr"},"leave-accrual":{"kind":"tool","label":"استحقاق الإجازات","dept":"hr"},"benefits":{"kind":"tool","label":"التأمين والمزايا","dept":"hr"},"secondment":{"kind":"tool","label":"الانتداب وبدلاته","dept":"hr"},"budgets":{"kind":"tool","label":"مخصصات المشاريع","dept":"finance"},"receivables":{"kind":"tool","label":"مستحقات العملاء","dept":"finance"},"invoices":{"kind":"tool","label":"الفواتير الضريبية","dept":"finance"},"billing-schedules":{"kind":"tool","label":"الفوترة الدورية","dept":"finance"},"retainers":{"kind":"tool","label":"اتفاقات الاشتراك","dept":"finance"},"einvoice":{"kind":"tool","label":"الفوترة الإلكترونية","dept":"finance"},"payables":{"kind":"tool","label":"مدفوعات الموردين","dept":"finance"},"bank-reconciliation":{"kind":"tool","label":"المطابقة البنكية","dept":"finance"},"cash-forecast":{"kind":"tool","label":"التنبؤ النقدي","dept":"finance"},"finance":{"kind":"tool","label":"الدفتر المالي","dept":"finance"},"statements":{"kind":"tool","label":"القوائم المالية","dept":"finance"},"accruals":{"kind":"tool","label":"الإطفاء والاستحقاقات","dept":"finance"},"close-checklist":{"kind":"tool","label":"الإقفال الشهري","dept":"finance"},"assets":{"kind":"tool","label":"الأصول الثابتة","dept":"finance"},"vat-worksheet":{"kind":"tool","label":"القيمة المضافة والزكاة","dept":"finance"},"withholding":{"kind":"tool","label":"ضريبة الاستقطاع","dept":"finance"},"profitability":{"kind":"tool","label":"الربحية","dept":"finance"},"cost-rates":{"kind":"tool","label":"معدلات التكلفة","dept":"finance"},"finance-grants":{"kind":"tool","label":"التفويض المالي","dept":"finance"},"finance-exceptions":{"kind":"tool","label":"الاستثناءات المالية","dept":"finance"},"options":{"kind":"tool","label":"الخيارات والقيم المعتمدة","dept":"finance"},"pricing":{"kind":"tool","label":"تسعير المشاريع","dept":"finance"},"margin-exceptions":{"kind":"tool","label":"استثناءات التسعير","dept":"finance"},"vendors":{"kind":"tool","label":"الموردون والتأهيل","dept":"procurement"},"contracts-register":{"kind":"tool","label":"سجل العقود والالتزامات","dept":"procurement"},"procurement":{"kind":"tool","label":"المشتريات والموردون","dept":"procurement"},"procurement-extras":{"kind":"tool","label":"الطارئ وتعديل الأوامر والتعارض","dept":"procurement"},"offerings":{"kind":"tool","label":"الباقات التجارية","dept":"business-dev"},"pipeline":{"kind":"tool","label":"خط الفرص","dept":"business-dev"},"estimates":{"kind":"tool","label":"التقديرات وبطاقات الأسعار","dept":"business-dev"},"commercial":{"kind":"tool","label":"العملاء والعروض","dept":"business-dev"},"quotations":{"kind":"tool","label":"عروض أسعار العملاء","dept":"business-dev"},"clients":{"kind":"tool","label":"العملاء","dept":"accounts","shared":true},"approvals":{"kind":"tool","label":"سجل موافقات العملاء","dept":"accounts","shared":true},"client-reports":{"kind":"tool","label":"تقارير العملاء","dept":"accounts","shared":true},"campaigns":{"kind":"tool","label":"الحملات","dept":"marketing","shared":true},"content":{"kind":"tool","label":"تقويم المحتوى","dept":"marketing","shared":true},"media-spend":{"kind":"tool","label":"الصرف الإعلامي","dept":"marketing"},"influencers":{"kind":"tool","label":"المؤثرون","dept":"pr"},"influencer-campaigns":{"kind":"tool","label":"ارتباطات المؤثرين","dept":"pr"},"pr":{"kind":"tool","label":"العلاقات العامة","dept":"pr"},"media-contacts":{"kind":"tool","label":"جهات الإعلام","dept":"pr"},"projects":{"kind":"tool","label":"المشاريع والمهام","dept":"epmo","shared":true},"project-spine":{"kind":"tool","label":"مسار المشاريع","dept":"epmo","shared":true},"project-participation":{"kind":"context","label":"مشاركة الإدارات"},"project-templates":{"kind":"tool","label":"قوالب المشاريع","dept":"epmo"},"change-requests":{"kind":"tool","label":"طلبات التغيير","dept":"epmo","shared":true},"resourcing":{"kind":"tool","label":"خطة الموارد والسعة","dept":"epmo"},"call-sheets":{"kind":"tool","label":"أوراق الاستدعاء","dept":"production"},"equipment":{"kind":"tool","label":"المعدات والعهد","dept":"production","shared":true},"studio":{"kind":"tool","label":"الاستوديو والتسليم","dept":"production","shared":true},"review-rounds":{"kind":"tool","label":"جولات المراجعة","dept":"production","shared":true},"productions":{"kind":"tool","label":"الإنتاج والتصوير","dept":"production"},"scope":{"kind":"context","label":"حارس النطاق"},"project-handover":{"kind":"context","label":"محضر تسليم المشروع"},"project-receipt":{"kind":"context","label":"استلام المشروع وبوابته"},"project-kickoff":{"kind":"context","label":"محضر الانطلاق"},"compensation":{"kind":"tool","label":"مراجعة الرواتب","dept":"hr"},"performance":{"kind":"profile","label":"تقييم أدائي"},"review-360":{"kind":"profile","label":"تقييم 360"},"growth":{"kind":"profile","label":"تدريبي وتطوري"},"timesheets":{"kind":"profile","label":"كشفي الأسبوعي"},"client-support":{"kind":"tool","label":"دعم العملاء","dept":"accounts","shared":true},"payroll-parallel":{"kind":"tool","label":"المسير الموازي","dept":"hr"}};
// شاشات يفتحها الخادم لكل من له مرؤوسون (app.mjs): عدسة الفريق للمدير خارج رأس المال البشري.
export const TEAM_VIEW={"employees": "أعضاء الفريق", "employee-profile": "ملف الموظف", "discipline": "مخالفات فريقي", "expiry": "وثائق فريقي"};
// [تسمية اليوم لعدسة الإدارة، عدسة المدير، الإدارة، تسمية عدسة الإدارة]
export const LENS={"attendance": ["الحضور والانصراف", "فريقي › حضور فريقي", "hr", "حضور الموظفين"], "leave": ["الإجازات", "فريقي › إجازات فريقي", "hr", "إجازات الموظفين"], "expenses": ["المصروفات والعهد النقدية", "عملي (قرارات المطالبات)", "finance", "المصروفات والعهد"], "letters": ["خطابات الموظفين", null, "hr", "خطابات الموظفين"], "contracts": ["العقود وبنود الراتب", null, "hr", "العقود وبنود الراتب"], "payroll": ["مسير الرواتب", null, "hr", "مسير الرواتب"], "hr-cases": ["الحالات السرية", null, "hr", "الحالات السرية"], "catalog": ["دليل الخدمات", null, "admin", "الكتالوج › دليل الخدمات"], "compensation": ["مراجعة الرواتب", null, "hr", "مراجعة الرواتب"], "timesheets": ["اعتماد الساعات", "فريقي › اعتماد الساعات", "epmo", "اعتماد الساعات"], "performance": [null, "فريقي › تقييم أداء فريقي", "hr", "تقييم الأداء"], "review-360": [null, null, "hr", "تقييم 360"], "growth": [null, null, "hr", "التدريب والتطوير"], "resignations": [null, null, "hr", "الاستقالات"]};
// شاشات «إدارة المنصة» لغير الأدمن: [التسمية، النوع، الإدارة]
export const ADMIN_ALT={"access-reviews": ["مراجعة صلاحيات فريقي", "team", null], "integrations": ["حالة التكاملات", "tool", "it"], "permissions-matrix": ["مستويات الإدارة", "tool", "*own"], "requirements": ["نطاق المنصة", "report", "ceo-office"], "knowledge": ["مراجعة المصادر", "tool", "*own"], "centres": ["المراكز التخصصية", "internal", null], "catalog-quality": ["نواقص خدمات الإدارة", "tool", "*own"], "service-insight": ["قياس خدمات الإدارة", "report", "*own"], "service-benchmark": ["تطوير خدمات الإدارة", "tool", "*own"]};
// حسابات إدارة بلا صفحة (ops): [التسمية، النوع، الإدارة]
export const NO_PAGE_ALT={"service-cards": ["البطاقات", "admin", null], "reports": ["مركز التقارير", "report", "ceo-office"], "knowledge": ["مراجعة المصادر", "admin", null], "catalog-quality": ["نواقص دليل الخدمات", "admin", null], "service-insight": ["قياس الخدمات", "admin", null], "service-benchmark": ["تطوير الخدمات", "admin", null]};
export const DELIVERY_DEPARTMENTS=["accounts", "brand", "business-dev", "campaigns-audit", "creative", "epmo", "marketing", "pr", "production"];
export const NO_PAGE_DEPARTMENTS=['ops'];

// ── القائمة الجديدة: ترتيب ثابت وحد لكل دور (البرومبت §2.1، و«بعد-ب») ──
export const NAV_BUDGET={employee:8,hr:8,it:8,pm:8,manager:9,admin:9};
export const NAV_CAP=12;
export const HUBS={
  profile:{route:'profile',label:'ملفي'},
  team:{route:'team',label:'فريقي'},
  org:{route:'organization',label:'المنظمة'},
  admin:{route:'platform',label:'إدارة المنصة'},
  pending:{route:'work',label:'عملي'},
  requests:{route:'my-requests',label:'طلباتي'},
  services:{route:'services',label:'الخدمات'},
};

// أين تقع الشاشة key لهذا الحساب. label = تسمية مدخلها في القائمة القديمة، وبها تُعرف العدسة.
// يعيد {hub, dept?, label}؛ hub ∈ entry|pending|requests|profile|team|org|services|dept|admin|internal
export function placeFor(key,label,me){
  const d=NAV_DEST[key];if(!d)return{hub:'internal',label};
  const own=me?.department_id||null,role=me?.role;
  const noPage=!own||NO_PAGE_DEPARTMENTS.includes(own);
  const inHr=own==='hr'||role==='hr';
  const dept=(id,lbl)=>({hub:'dept',dept:id,label:lbl});
  if(TEAM_VIEW[key]&&!inHr){
    if(role==='manager')return{hub:'team',label:TEAM_VIEW[key]};
    if(key==='expiry')return{hub:'profile',label:'وثائقي'};
  }
  if(key==='delegations')return role==='manager'?{hub:'team',label:'التفويض المؤقت'}:{hub:'profile',label:'تفويضاتي'};
  if(key==='requests'){
    if(role==='manager')return{hub:'team',label:'طلبات الفريق'};
    return noPage?{hub:'admin',label:'الطلبات'}:dept(own,'الطلبات الواردة');
  }
  const lens=LENS[key];
  if(lens&&lens[0]&&label===lens[0]){
    const [,team,lensDept,lensLabel]=lens;
    if(lensDept==='admin')return{hub:'admin',label:lensLabel};
    if(own===lensDept||(lensDept==='hr'&&inHr))return dept(lensDept,lensLabel);
    if(key==='timesheets'&&role==='pm')return dept('epmo',lensLabel);
    if(team&&role==='manager')return{hub:'team',label:team.split(' › ').pop()};
    return dept(lensDept,lensLabel);
  }
  if(d.kind==='admin'){
    if(role==='admin')return{hub:'admin',label:d.label};
    const alt=ADMIN_ALT[key];if(!alt)return{hub:'internal',label:d.label};
    const [lbl,kind,dep]=alt;
    if(kind==='team')return role==='manager'?{hub:'team',label:lbl}:{hub:'profile',label:lbl};
    if(kind==='services')return{hub:'services',label:lbl};
    if(kind==='internal')return{hub:'internal',label:lbl};
    const target=dep==='*own'?own:dep;
    return target&&!NO_PAGE_DEPARTMENTS.includes(target)?dept(target,lbl):{hub:'admin',label:lbl};
  }
  if(d.kind==='context')return dept(DELIVERY_DEPARTMENTS.includes(own)?own:'epmo',d.label);
  if(d.kind==='tool'||d.kind==='report'){
    let target=d.dept;
    if(target==='*own'||(d.shared&&DELIVERY_DEPARTMENTS.includes(own)))target=own;
    if(!target||NO_PAGE_DEPARTMENTS.includes(target)){
      const alt=NO_PAGE_ALT[key];
      if(alt){const [lbl,kind,dep]=alt;return kind==='admin'?{hub:'admin',label:lbl}:dept(dep,lbl);}
      return role==='admin'?{hub:'admin',label:d.label}:dept(d.dept&&d.dept!=='*own'?d.dept:'ceo-office',d.label);
    }
    return dept(target,d.label);
  }
  if(d.kind==='team')return role==='manager'?{hub:'team',label:d.label}:{hub:'profile',label:d.label};
  return{hub:d.kind,label:d.label};
}

// ── أقسام التنقل الثمانية (موجز المالك 30 سبتمبر 2026، البند 6) ─────────────────
// طبقةٌ فوق placeFor لا بديلٌ عنها: القسم يُشتق من الموضع الذي قرّره placeFor بتصاريح الحساب، فما لا يبلغه الحساب
// لا يجد قسمًا ولا يُعرض. الأسماء الثمانية أسماء المالك حرفًا بحرف والترتيب ترتيبه، فلا تُشتق من بيانات ولا تُبدَّل.
export const SECTIONS=Object.freeze([
  {id:'home',route:'home',glyph:'⌂',label:'الرئيسية',label_en:'Home'},
  {id:'work',route:'section/work',glyph:'☰',label:'أعمالي',label_en:'My work'},
  {id:'departments',route:'section/departments',glyph:'▦',label:'الإدارات',label_en:'Departments'},
  {id:'projects',route:'section/projects',glyph:'◳',label:'المشاريع',label_en:'Projects'},
  {id:'clients',route:'section/clients',glyph:'♗',label:'العملاء',label_en:'Clients'},
  {id:'finance',route:'section/finance',glyph:'◒',label:'المالية',label_en:'Finance'},
  {id:'services',route:'section/services',glyph:'◎',label:'الخدمات',label_en:'Services'},
  {id:'reports',route:'section/reports',glyph:'▤',label:'التقارير',label_en:'Reports'}
]);
export const SECTION_IDS=Object.freeze(SECTIONS.map(s=>s.id));
// حدّ صفوف القائمة (قرار خطة التغيير): عشرة على الأكثر. الأقسام ثمانية فالحدّ محروس بالبناء، والرقم مكتوب ليُختبر.
export const SECTION_CAP=10;

// إدارة الأداة ← قسمها. المشاريع والعملاء والمالية أقسامٌ سمّاها المالك فإداراتها تسكنها؛ وما بقي من إدارات
// (الموارد البشرية، الالتزام، التقنية) يسكن «الإدارات». إدارة الرئيس التنفيذي أدواتها لوحات وقرارات فتسكن «التقارير».
export const DEPT_SECTION=Object.freeze({accounts:'clients','business-dev':'clients',brand:'clients','campaigns-audit':'clients',comms:'clients',marketing:'clients',pr:'clients',
  creative:'projects',epmo:'projects',production:'projects',finance:'finance',procurement:'finance','ceo-office':'reports',grc:'departments',hr:'departments',it:'departments',ops:'departments'});
// موضع placeFor ← قسمه. «فريقي» و«المنظمة» و«إدارة المنصة» ثلاثتها إدارةُ الشركة وهيكلها فتسكن «الإدارات»؛
// و«ملفي» و«بانتظار إجرائي» و«طلباتي» شغل الحساب نفسه فتسكن «أعمالي».
export const HUB_SECTION=Object.freeze({entry:'work',pending:'work',requests:'work',profile:'work',team:'departments',org:'departments',admin:'departments',services:'services'});
// استثناءات مفتاحٍ بعينه، ولكل واحدة سببها:
// (١) سجلُّه dept:'*own' فيضعه placeFor على إدارة الحساب أيًّا كانت، والقسم صفة الشاشة لا صفة قارئها (مركز التقارير).
// (٢) شاشة إعداد خدمات يضعها placeFor في «إدارة المنصة» أو على إدارة الحساب، وموضعها عند قارئها قسم «الخدمات».
// (٣) شاشة مشروع تتبع إدارة التسليم التي يعمل بها الحساب، وهي شاشة مشروع عند كل حساب لا شاشة إدارته.
// (٤) «المراكز التخصصية» موضعها internal لغير الأدمن (ADMIN_ALT)، أي لا مدخل لها في القائمة؛ والقسم اسمُ موضعٍ
//     لا منحُ وصول، فتُسمَّى «الإدارات» ولا تبقى شاشةً بلا قسم. الشرط الذي يفتحها في app.mjs لم يُمسّ.
export const SECTION_OF=Object.freeze({
  home:'home',inbox:'work',work:'work','my-requests':'work',notifications:'work',announcements:'work','policy-acknowledgements':'work',
  reports:'reports',executive:'reports',decisions:'reports',epmo:'reports',requirements:'reports',
  services:'services',catalog:'services',departments:'services',forms:'services',requests:'services','service-cards':'services',
  'catalog-quality':'services','service-insight':'services','service-benchmark':'services',knowledge:'services','intake-settings':'services','approval-settings':'services',
  'permissions-matrix':'departments',centres:'departments',
  objectives:'projects',scope:'projects','project-kickoff':'projects','project-receipt':'projects','project-handover':'projects','project-spine':'projects'
});

// مجموعات كل قسم بترتيب ثابت: [عنوان، عنوان إنجليزي، مفاتيح]. المفتاح 'departments/' سابقةٌ تطابق صفحة أي إدارة.
// ويرد المفتاح الواحد في قسمين (حضوري في «أعمالي» وحضور الموظفين في «الإدارات») لأن placeFor يعطي الحساب الواحد
// موضعًا واحدًا؛ ولا يرد مرتين في القسم نفسه.
export const SECTION_GROUPS=Object.freeze({
  work:[['طلباتي وما ينتظرني','My requests and what awaits me',['inbox','work','my-requests','expenses']],
    ['يوصلني','My feed',['notifications','announcements','policy-acknowledgements']],
    ['وقتي','My time',['attendance','leave','time','timesheets','travel']],
    ['ملفي وراتبي','My file and pay',['profile','contracts','payroll','my-benefits','letters','my-discipline','expiry','delegations']],
    ['مشاركتي','Participation',['pulse','recognition','one-to-ones','feedback','performance','review-360','growth','hr-cases']],
    ['إعدادات حسابي','Account settings',['security','assistants','appearance','notification-settings','access-reviews']]],
  departments:[['إدارتي وفريقي','My department and team',['hr-operations','employees','employee-profile','discipline','delegations','access-reviews','permissions-matrix','requests','expenses','hr-cases']],
    ['الحضور والإجازات','Attendance and leave',['attendance','leave','leave-accrual','secondment','timesheets']],
    ['الرواتب والعقود','Payroll and contracts',['payroll','compensation','contracts','payroll-rules','payroll-extras','payroll-anomaly','wage-reconciliation','wps','payroll-insurance','payroll-parallel','benefits','benefits-admin']],
    ['الخطابات والوثائق','Letters and documents',['letters','letter-templates','expiry']],
    ['التوظيف والمغادرة','Hiring and leaving',['people','lifecycle','clearance','workforce']],
    ['سياسات الشركة','Company policies',['policy-library','policy-assistant','hr-policies','compliance']],
    ['المخاطر وحماية البيانات','Risk and data protection',['risks','privacy','subject-requests']],
    ['الهيكل','Structure',['org','centres']],
    ['إدارة المنصة','Platform administration',['accounts','platform-health','integrations','ai-governance','jobs','feature-flags','mail','definitions']]],
  projects:[['المشاريع والمهام','Projects and tasks',['projects','project-spine','project-templates','change-requests','resourcing','objectives','timesheets']],
    ['الإنتاج','Production',['productions','call-sheets','equipment','studio','review-rounds']],
    ['مستندات المشروع','Project documents',['scope','project-kickoff','project-receipt','project-handover']]],
  clients:[['العملاء','Clients',['clients','client-support','approvals','client-reports']],
    ['الفرص والعروض','Pipeline and quotes',['pipeline','estimates','quotations','commercial','offerings']],
    ['التسويق','Marketing',['campaigns','content','media-spend']],
    ['العلاقات العامة','Public relations',['pr','influencers','influencer-campaigns','media-contacts']]],
  finance:[['الفواتير والمستحقات','Invoicing and receivables',['invoices','receivables','billing-schedules','retainers','einvoice']],
    ['المدفوعات والموردون','Payments and vendors',['payables','expenses','vendors','procurement','procurement-extras','contracts-register','bank-reconciliation']],
    ['الدفتر والإقفال','Ledger and close',['finance','statements','accruals','close-checklist','finance-exceptions','assets','vat-worksheet','withholding']],
    ['التخطيط والتسعير','Planning and pricing',['budgets','cash-forecast','profitability','cost-rates','pricing','margin-exceptions','finance-grants','options']]],
  services:[['الخدمات والطلبات','Services and requests',['services','catalog','departments','forms','resignations','hr-cases','requests']],
    ['إعداد الخدمات','Service setup',['service-cards','catalog-quality','service-insight','service-benchmark','knowledge','intake-settings','approval-settings']]],
  reports:[['تقاريري','My reports',['reports','epmo']],
    ['لوحة القيادة','Leadership',['executive','decisions','requirements']]]
});

// قسم الشاشة لهذا الحساب: يُشتق من placeFor فلا يمنح وصولًا ولا يمنعه. section=null تعني «لا قسم» لا «أخرى».
function sectionIdFor(key,place){
  if(Object.hasOwn(SECTION_OF,key))return SECTION_OF[key];
  // القسم صفة الشاشة: تُقرأ إدارتها من السجل، وانتقالها إلى إدارة الحساب (dept:'*own' أو الشاشة المشتركة) لا ينقل قسمها.
  if(place.hub==='dept'){const registered=NAV_DEST[key]?.dept,id=registered&&registered!=='*own'?registered:place.dept;return DEPT_SECTION[id]??'departments';}
  return HUB_SECTION[place.hub]??null;
}
// التسمية الثابتة للشاشة في قسمها: آخر مقطع من تسمية placeFor، وهو عقد app.mjs القائم (stableLabel) منقولًا إلى مصدره.
// وإن طابقت التسمية اسمَ الصفحة الجامعة أو اسمَ القسم الذي تسكنه — و«الخدمات» و«الإدارات» و«دليل الخدمات» ثلاثتها
// مسجَّلة باسم «الخدمات» — فالتسمية تسمية مدخلها في القائمة: رابطان في صفحة واحدة باسم واحد يخفيان وجهتين،
// ورابطٌ باسم القسم الذي يسكنه يقول للقارئ إنه القسمُ نفسه وهو شاشة فيه («مركز الخدمات» داخل «الخدمات»).
export function stableLabel(key,label,me,place=placeFor(key,label,me),section=sectionIdFor(key,place)){
  const own=String(place.label??label).split(' › ').pop(),hub=HUBS[place.hub],here=SECTIONS.find(s=>s.id===section);
  if(hub&&hub.label===own&&hub.route!==key)return label;
  if(here&&here.label===own)return label;
  return own;
}
export function sectionOf(key,label,me){
  const place=placeFor(key,label,me),section=sectionIdFor(key,place);
  return{section,label:stableLabel(key,label,me,place,section),place};
}

// دون هذا العدد من البنود لا تُقسَّم الصفحة: قسمٌ بثلاث شاشات لا يحتاج عناوين تفصل بينها.
export const SECTION_GROUP_MIN=4;
// مجموعات القسم من بنوده، بقاعدتين من خطة التغيير: لا مجموعة بأقل من بندين، ولا شاشة تسقط في «أخرى».
// المجموعة المسمّاة تبقى مسمّاة إن بلغت بندين، وما دون ذلك ينزل إلى قائمةٍ بلا عنوان في آخر الصفحة. وحدّ البندين
// حدُّ المسمّى وحده: القائمة بلا عنوان روابطُ مسرودة لا مجموعة، فرابطٌ واحد فيها رابطٌ ظاهر لا عنوانٌ يَعِد بأكثر منه
// — وهذا أصدق من إلحاقه بعنوانٍ لا يصفه، ومن فتح «أخرى» له.
export function sectionGroups(section,entries){
  const spec=SECTION_GROUPS[section]??[];
  if(!spec.length||entries.length<SECTION_GROUP_MIN)return entries.length?[['','',[...entries]]]:[];
  // صفحة الإدارة بابُ الإدارة نفسها لا أداةً فيها، فتتقدّم صفًّا بلا عنوان أيًّا كان عددها ولا تنزل في المتبقّي.
  const door=x=>String(x.key).startsWith('departments/'),doors=entries.filter(door),tools=entries.filter(x=>!door(x));
  const head=doors.length?[['','',doors]]:[];
  const match=key=>spec.findIndex(s=>s[2].includes(key));
  const bins=spec.map(()=>[]),loose=[];
  for(const x of tools){const i=match(x.key);if(i<0)loose.push(x);else bins[i].push(x);}
  const groups=[];
  for(const [i,bin] of bins.entries()){if(bin.length>=2)groups.push([spec[i][0],spec[i][1],bin]);else loose.push(...bin);}
  if(!groups.length)return[['','',[...entries]]];
  if(loose.length)groups.push(['','',loose]);
  return [...head,...groups];
}

// صفوف القائمة لهذا الحساب. reach = ما يبلغه الحساب اليوم ([key,glyph,ar,en] كما يبنيه app.mjs)، وdepartments =
// صفحات الإدارات التي يفتحها ([id,name]). القسم الذي لا يجد إلا شاشةً واحدة لا يُعرض قسمًا: يبقى صفًّا باسم القسم
// (الأسماء ثابتة) لكنه يقود إلى الشاشة نفسها، فلا نقرة تفتح صفحةً برابطٍ واحد. والقسم الفارغ لا صفّ له.
export function navSections(reach,me,{departments=[]}={}){
  const bySection=Object.fromEntries(SECTION_IDS.map(id=>[id,[]]));
  for(const [key,,ar,en] of reach??[]){
    const {section,label}=sectionOf(key,ar,me);
    if(!section||!Object.hasOwn(bySection,section))continue;
    bySection[section].push({key,label,label_en:en||label});
  }
  // صفحة الإدارة ليست شاشة في السجل وهي باب الإدارة نفسها، فتتقدّم بنود «الإدارات».
  bySection.departments=[...departments.map(([id,name])=>({key:'departments/'+id,label:name,label_en:name})),...bySection.departments];
  const rows=[];
  for(const section of SECTIONS){
    const entries=bySection[section.id];
    if(section.id==='home'){rows.push({...section,entries:[],groups:[],single:true});continue;}
    if(!entries.length)continue;
    if(entries.length===1){rows.push({...section,route:entries[0].key,entries,groups:[],single:true});continue;}
    rows.push({...section,entries,groups:sectionGroups(section.id,entries),single:false});
  }
  return rows;
}
// الشاشات التي يبلغها الحساب ولا قسم لها. فارغة = لا شاشة بلا موضع. غير الفارغة تُقرأ قائمةً في الاختبار لا تُخفى.
export const screensWithoutSection=(reach,me)=>(reach??[]).filter(([key,,ar])=>!sectionOf(key,ar,me).section).map(([key])=>key);
