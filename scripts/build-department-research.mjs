import { readFileSync, writeFileSync } from 'node:fs';
import { companyDepartments, catalogServices } from '../app/service-catalog.mjs';
import { openDb } from '../app/db.mjs';
import { seed } from './seed.mjs';
import { installServiceCatalog } from '../app/service-catalog.mjs';
import { catalog } from '../app/workflow.mjs';
const sources = {
 apqc:{title:'APQC — تصنيف العمليات',url:'https://www.apqc.org/process-frameworks'},
 cipd:{title:'CIPD — إدارة المواهب',url:'https://www.cipd.org/uk/knowledge/factsheets/talent-factsheet/'},
 comms:{title:'CIPD — التواصل مع الموظفين',url:'https://www.cipd.org/uk/knowledge/factsheets/employee-communication/'},
 itsm:{title:'Atlassian — إدارة خدمات التقنية',url:'https://www.atlassian.com/collections/service/guides/it-service-management'},
 amec:{title:'AMEC — قياس نتائج الاتصال',url:'https://amecorg.com/amecframework/home/supporting-material/planning/'},
 cips:{title:'CIPS — دورة الشراء والتوريد',url:'https://1prd-dxp.cips.org/intelligence-hub/procurement/procurement-supply-cycle'},
 adobe:{title:'Adobe — مراجعة المخرجات والنسخ',url:'https://experienceleague.adobe.com/en/docs/workfront/using/review-and-approve-work/proofing/proofing'},
 pmi:{title:'PMI — أصحاب المصلحة والتغيير والمخاطر',url:'https://www.pmi.org/learning/library/one-solution-for-project-success-11130'},
 coso:{title:'COSO — مراقبة الرقابة الداخلية',url:'https://www.coso.org/monitoring-internal-control-system'},
 google:{title:'Google Analytics — توحيد قياس الحملات',url:'https://support.google.com/analytics/answer/10917952'},
 nist:{title:'NIST — إطار الأمن السيبراني 2.0',url:'https://www.nist.gov/publications/nist-cybersecurity-framework-csf-20'},
 wcag:{title:'W3C — إتاحة الويب 2.2',url:'https://www.w3.org/TR/WCAG22/'},
 hrms:{title:'GitHub — Frappe HR',url:'https://github.com/frappe/hrms'},
 erpnext:{title:'GitHub — ERPNext',url:'https://github.com/frappe/erpnext'}
};
// هذه متطلبات تصميم مقترحة، وليست نقلًا لمعيار أو شهادة امتثال.
const profiles={
 'ceo-office':[['apqc'],['سجل القرارات ومتابعتها','حجز الموارد ومنع التعارض','مواعيد الالتزامات التنفيذية'],['يرتبط القرار بمالك وموعد ودليل إقفال','يرفض حجز المورد نفسه لفترتين متداخلتين','يظهر الالتزام المتأخر دون كشف تفاصيل مقيدة'],'app/routing.mjs'],
 brand:[['adobe'],['أصول الهوية المعتمدة','انتهاء حقوق استخدام الأصل','مراجعة تطبيق الهوية'],['تنزيل النسخة المعتمدة مرتبط بإصدارها','يُمنع استعمال أصل انتهى حقه','يرتبط قرار الهوية بالمخرج المحدد'],'app/studio.mjs'],
 pr:[['amec'],['أهداف الأثر الإعلامي','إثبات تنفيذ المؤثر','إدارة القضايا الإعلامية'],['يُفصل حجم التغطية عن تغير سلوك الجمهور','يرتبط الإثبات بعقد ومخرج وتاريخ','تُحدد مسؤولية الاستجابة وتسجل القرارات'],'app/service-catalog.mjs'],
 marketing:[['google','amec'],['حوكمة روابط الحملات','مطابقة الإنفاق الفعلي','تجارب التحسين'],['ترفض الحملة روابط تتعارض مع قاموس الوسوم','تُربط الأرقام بمصدر وفترة ولا تُختلق النتائج','تسجل الفرضية والمقياس والنتيجة قبل إعلان التحسن'],'app/service-catalog.mjs'],
 accounts:[['apqc'],['خطة الحساب والتزاماته','رضا العميل والإجراءات التصحيحية','تغيير النطاق قبل التنفيذ'],['يرتبط الالتزام بموعد ومسؤول','تُوثق الملاحظة والمتابعة والإغلاق','لا يغير طلب جديد خط أساس معتمدًا'],'app/commercial.mjs'],
 production:[['adobe','pmi'],['حجز معدات وطاقم','حقوق ونسخ المخرجات','قبول التسليم الفني'],['يمنع تضارب المعدات والطاقم','ترتبط المراجعة بالنسخة ولا تنتقل آليًا لنسخة جديدة','يُفحص المخرج مقابل مواصفات التسليم'],'app/studio.mjs'],
 creative:[['adobe','wcag'],['موجز ومعيار قبول','مراجعة النسخ والتعديلات','إتاحة المخرجات الرقمية'],['لا يبدأ العمل دون مخرج وموعد ومعيار قبول','يُثبت قرار المراجعة على نسخة محددة','تفحص لوحة المفاتيح والنص البديل والتباين'],'app/studio.mjs'],
 'business-dev':[['apqc','erpnext'],['تأهيل الفرص','ضبط التسعير والهامش','تسليم الفرصة للتشغيل'],['تُوثق الحاجة والميزانية والقرار المتوقع','يحتاج استثناء الهامش معتمدًا مستقلًا','يشمل التسليم نطاقًا ومخصصًا ومالكًا'],'app/commercial.mjs'],
 comms:[['comms'],['قياس فهم الرسائل','حماية صوت الموظف','متابعة المقترحات'],['يقاس الفهم لا عدد الرسائل وحده','لا تُعرض هوية إجابة سرية لغير المخول','لكل مقترح قرار وسبب ومتابعة'],'app/service-catalog.mjs'],
 it:[['itsm','nist'],['فصل الحادث عن المشكلة','تغيير تقني مع رجوع','دورة حياة الأصول والصلاحيات'],['يربط الحادث المتكرر بسبب جذري وخطة معالجة','يوثق التغيير المخاطر والاختبار والرجوع','يُسحب الوصول وتُراجع العهدة عند المغادرة'],'app/admin.mjs'],
 grc:[['coso','nist'],['سجل الضوابط وأدلتها','معالجة الملاحظات','تصنيف البيانات والاحتفاظ'],['يرتبط الضابط باختبار ومسؤول ودليل مؤرخ','يحتاج إغلاق الملاحظة تحققًا مستقلًا','تُطبّق مدة الاحتفاظ بحسب السياسة المعتمدة'],'app/access.mjs'],
 procurement:[['cips'],['تأهيل المورد ومخاطره','التزامات العقد والأداء','ضبط بيانات الدفع'],['تُراجع صلاحية التأهيل قبل الترسية','تُقارن نتائج المورد بمعايير العقد','تغيير بيانات الدفع يحتاج تحققًا مستقلًا'],'app/procurement.mjs'],
 finance:[['coso','erpnext'],['قائمة إقفال الفترة','التسويات والمطابقة','فصل الإعداد عن الاعتماد'],['لا تُقفل الفترة مع تسويات معلقة دون استثناء موثق','لكل فرق مصدر ومراجع ودليل معالجة','يرفض النظام اعتماد معد المعاملة لها'],'app/finance.mjs'],
 epmo:[['pmi'],['منافع المشاريع','السعة وتعارض الموارد','المخاطر والتغيير'],['تُربط المنفعة بخط أساس وقياس بعد التسليم','يُكشف تجاوز السعة قبل التكليف','يرتبط التغيير بأثره في المدة والتكلفة'],'app/projects.mjs'],
 'campaigns-audit':[['amec','google'],['قاموس المؤشرات ومصادرها','فحص جودة بيانات الحملة','التحقق المستقل من الأثر'],['يحدد كل مؤشر الصيغة والمصدر والفترة','يكشف اختلاف الوسوم والتكرار والبيانات الناقصة','لا يعتمد معد التقرير نتائجه النهائية منفردًا'],'app/service-catalog.mjs'],
 hr:[['cipd','hrms'],['الحضور ومدخلات الرواتب','دورة الأداء والتطوير','التهيئة والمغادرة'],['تُراجع المدخلات قبل احتساب راتب دون صرف آلي','تربط الأهداف والتقييم وخطة التعلم بإصدار دوري','يشمل الإقفال العهد والصلاحيات ونقل المعرفة'],'app/employees.mjs'],
 ops:[['nist','wcag'],['الاستعادة والمراقبة','دخول مؤسسي وصلاحيات','إتاحة واستقرار الاستخدام'],['يُختبر الرجوع من نسخة مستقلة مع نتيجة مؤرخة','يُختبر سحب الجلسات والتحقق الإضافي','تُفحص الرحلات بلوحة المفاتيح وعلى الجوال'],'app/server.mjs']
};
const db=openDb(':memory:');seed(db,'synthetic-research-only');installServiceCatalog(db);
const services=catalog(db,db.prepare("SELECT * FROM users WHERE id='admin'").get());db.close();
const baseReq={'HR-LETTER':['HR-05'],'IT-SUPPORT':['IT-03'],'CREATIVE-BRIEF':['CRT-01']};
const requirementRecords=JSON.parse(readFileSync('docs/implementation/REQUIREMENTS.json','utf8')).requirements;
const departments=companyDepartments.map(d=>{
 const [refs,titles,acceptance,code]=profiles[d.id];
 return {id:d.id,name:d.name,sector:d.sector,source_ids:refs,review_scope:'مقارنة مرجعية أولية؛ تتطلب الفجوات اختبار قبول تخصصي قبل تأكيد الغياب أو الاكتمال',capabilities:titles.map((title,i)=>({id:`BP-${d.id}-${i+1}`,title,acceptance:acceptance[i],status:'بحاجة تحقق وتنفيذ تخصصي',priority:i===0?'P1':'P2',inspect_files:[code],source_ids:refs})),services:services.filter(s=>s.department_id===d.id).map(s=>({code:s.code,title:s.name_ar,requirement_ids:catalogServices.find(c=>c.code===s.code)?.req??baseReq[s.code]??[],fields:s.fields.map(f=>({key:f.key,label:f.label,required:f.required,type:f.type})),approval_steps:s.approval_policy.steps,handler_role:s.approval_policy.handler_role,target_days:s.target_days,request_flow:'مسار طلب داخلي؛ لا يثبت اكتمال التنفيذ التخصصي',specialist_acceptance:'لم يتحقق بالكامل',source_ids:refs}))};
});
for(const department of departments)for(const service of department.services){service.requirements=service.requirement_ids.map(id=>{const r=requirementRecords.find(r=>r.id===id);if(!r)throw Error('متطلب غير معروف: '+id);return {id,title:r.title,acceptance:r.acceptance,status:r.implementation.status,coverage:r.implementation.coverage,blockers:r.implementation.blockers};});}
const document={reviewed_on:'2026-09-16',method:'حصر آلي للكتالوج في قاعدة مصطنعة ومقارنة تصميمية بمصادر أولية عامة. الفجوات استنتاجات تصميمية وليست شهادة امتثال أو قائمة شاملة لكل شركة.',sources,departments,github_reuse:'استُخدم GitHub للبحث عن Frappe HR وERPNext كمرجع وظيفي. لم يُنسخ كود أو تُدمج قواعد؛ يحتاج اعتماد أي إعادة استخدام مراجعة التقنية والرخصة.'};
writeFileSync('docs/research/department-benchmark.json',JSON.stringify(document,null,2)+'\n');
let md='# مقارنة خدمات الإدارات بالممارسات المرجعية\n\n'+document.method+'\n\n'+document.github_reuse+'\n\n';
for(const d of departments){md+=`## ${d.name}\n\nالخدمات الحالية: ${d.services.length}. المصادر: ${d.source_ids.map(k=>`[${sources[k].title}](${sources[k].url})`).join('، ')}.\n\n| القدرة المطلوب التحقق منها واستكمالها | معيار القبول المقترح | الأولوية |\n| --- | --- | --- |\n`+d.capabilities.map(c=>`| ${c.title} | ${c.acceptance} | ${c.priority} |`).join('\n')+'\n\n'+d.services.map(s=>`- ${s.code} — ${s.title}: ${s.request_flow}`).join('\n')+'\n\n';}
md+='## القياس والتحقق\n\nنقيس زمن الخدمة من التقديم للإغلاق ونسبة إعادة العمل والتأخر ورضا صاحب الطلب. لا توجد قياسات قبلية كافية لاستنتاج وقت موفر أو تحسن. يبدأ التنفيذ بالتقييم بعد الإغلاق، ثم خط أساس زمني وتجربة محددة قبل تعميم أي تقدير.\n\n## حدود البحث\n\nالمقارنة على مستوى قدرات الإدارات، وليست تدقيقًا معمقًا لكل شرط قانوني أو كل خدمة. مصدر مانوس غير متاح بعد. التكامل الحكومي يحتاج توثيق الجهة وبيئة اختبار رسمية. الأسماء والحقول الحالية بقيت محفوظة؛ لا يعادل إنشاء صفحة أو نموذج إغلاق متطلب.\n';
writeFileSync('docs/research/department-benchmark.md',md);
console.log(JSON.stringify({departments:departments.length,services:services.length,capabilities:departments.flatMap(d=>d.capabilities).length,sources:Object.keys(sources).length}));
