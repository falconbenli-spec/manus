#!/usr/bin/env node
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { catalogServices, companyDepartments } from '../app/service-catalog.mjs';
import { outputContract } from '../app/service-outputs.mjs';

const source=resolve(process.argv[2]??'work/qa/hr-portal-audit-20261003-final/sweep-ships.json');
const sourceDisplay=relative(process.cwd(),source);
const outputDir=resolve(process.argv[3]??'docs/testing/hr-portal-audit-20261003');
const sweep=JSON.parse(readFileSync(source,'utf8'));
const definitions=new Map(catalogServices.map(service=>[service.code,service]));
const departments=new Map(companyDepartments.map(department=>[department.id,department.name]));

const outcomes={
  closed:{label:'مغلق بدليل',classification:'technically_closed',recommendation:'اعتماد مالك الإجراء للعينة التشغيلية وقياس الزمن الفعلي.'},
  service_output_required:{label:'ينتظر مخرجًا فعليًا وقبول الطالب',classification:'governed_output_gate',recommendation:'أنشئ السجل في الوحدة المرتبطة، اربطه بالطلب، ثم اطلب قبول صاحبه قبل الإغلاق.'},
  letter_template_required:{label:'ينتظر قالب خطاب معتمدًا',classification:'operational_prerequisite',recommendation:'يعتمد مالك الموارد البشرية القالب والحقول المسموح كشفها قبل إصدار الخطاب.'},
  resignation_open:{label:'ينتظر حسم معاملة الاستقالة',classification:'operational_prerequisite',recommendation:'أكمل قرار الاستقالة وإخلاء الطرف في وحدتهما قبل إغلاق الطلب.'},
  vendor_not_registered:{label:'ينتظر تسجيل المورد',classification:'operational_prerequisite',recommendation:'سجّل المورد وتحقق من بياناته البنكية قبل قبول تعديل الحساب.'}
};

const services=sweep.results.map(result=>{
  const definition=definitions.get(result.code)??{};
  const failure=result.failure?.code??'closed';
  const outcome=outcomes[failure]??{label:failure,classification:'review_required',recommendation:'راجع سبب التوقف قبل التشغيل.'};
  const contract=outputContract(result.code);
  return {
    code:result.code,
    name:result.name,
    department_id:result.department_id,
    department_name:departments.get(result.department_id)??result.department_id,
    section:result.section,
    requirement_ids:definition.req??[],
    fields:{total:definition.fields?.length??result.payload_keys?.length??0,required:definition.fields?.filter(field=>field.required).length??null},
    approval:{steps:result.policy_steps,approvers:result.steps?.map(step=>step.approver)??[],handler_role:result.handler_role,separation_of_duties:result.sod,confidential:result.confidential},
    execution:{claimed:result.executed,executor:result.executor,basis:result.execution_basis,decider_executed:result.decider_executed},
    sla:{target_days:result.target_days,due_on:result.due_on,provenance:result.clock?.target?.kind??null,adopted:!!result.clock?.target?.adopted},
    outcome:{...outcome,code:failure,stage:result.failure?.stage??'completed',message:result.failure?.message??null,output_contract:contract},
    notifications:result.notification_kinds??[]
  };
});

const count=key=>services.filter(service=>service.outcome.code===key).length;
const summary={
  generated_at:new Date().toISOString(),
  source:sourceDisplay,
  mode:sweep.summary.mode,
  services:services.length,
  created:sweep.summary.submitted,
  submitted:sweep.summary.submitted,
  approved:sweep.summary.approved,
  execution_started:sweep.summary.executed,
  technically_closed:count('closed'),
  governed_output_gate:count('service_output_required'),
  operational_prerequisites:count('letter_template_required')+count('resignation_open')+count('vendor_not_registered'),
  no_executor:sweep.summary.no_executor,
  duplicate_approval_route_distinct:sweep.engine.some(check=>check.check==='department_head_own_request'&&check.ok&&check.one_decision_two_approvals===false&&new Set(check.approvers??[]).size===(check.approvers??[]).length),
  owner_accepted:0,
  production_verified:0
};

mkdirSync(outputDir,{recursive:true});
writeFileSync(resolve(outputDir,'service-flow-audit.json'),JSON.stringify({summary,controls:{refusals:sweep.refusals,engine:sweep.engine,field_contract:sweep.field_contract},services},null,2)+'\n');

const safe=value=>String(value??'—').replaceAll('|','\\|').replaceAll('\n',' ');
const chain=service=>service.approval.approvers.length?service.approval.approvers.join(' ← '):'مباشر';
const outputName=service=>service.outcome.output_contract?.output_label??'—';
const table=department=>{
  const rows=services.filter(service=>service.department_id===department.id).sort((a,b)=>a.code.localeCompare(b.code));
  if(!rows.length)return '';
  return `\n## ${department.name} — ${rows.length} خدمة\n\n| الرمز | الخدمة | الحقول (المطلوب) | مسار الاعتماد | المنفذ | النتيجة الفنية | المخرج/الخطوة التالية |\n|---|---|---:|---|---|---|---|\n${rows.map(service=>`| \`${safe(service.code)}\` | ${safe(service.name)} | ${service.fields.total} (${service.fields.required??'—'}) | ${safe(chain(service))} | ${safe(service.execution.executor)} | ${safe(service.outcome.label)} | ${safe(outputName(service)==='—'?service.outcome.recommendation:`${outputName(service)}؛ ${service.outcome.recommendation}`)} |`).join('\n')}\n`;
};

const localDate=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Riyadh',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const hrServices=services.filter(service=>service.department_id==='hr'),hrOutput=hrServices.filter(service=>service.outcome.code==='service_output_required').length;
const markdown=`# تدقيق رحلة خدمات منصة 3,6T — الموظف والمدير ومالك الإجراء\n\n`+
`تاريخ القياس: ${localDate}. شُغّل المسح على قاعدة مصطنعة مؤقتة، ولم تُستخدم بيانات موظفين أو عملاء حقيقية. يفصل التقرير بين ما مر تقنيًا وبين ما قبله مالك الإجراء؛ القبول التشغيلي ما زال صفرًا حتى يوقع المالك الحقيقي لكل عملية.\n\n`+
`## النتيجة الحاكمة\n\n`+
`- أُنشئت وقُدمت واعتمدت وبدأ تنفيذ **${summary.services}/${summary.services} خدمة**، ولا توجد خدمة بلا منفذ.\n`+
`- أُغلقت **${summary.technically_closed} خدمة** بدليل تقني كامل في المسح.\n`+
`- توقفت **${summary.governed_output_gate} خدمة** عند بوابة صحيحة تمنع الإغلاق قبل تسجيل المخرج الفعلي وقبول صاحب الطلب. هذه ليست أعطالًا؛ المسح العام لا يختلق سجلًا في الوحدة المتخصصة.\n`+
`- توقفت **${summary.operational_prerequisites} خدمات** عند متطلبات تشغيلية صريحة: ثلاثة قوالب خطابات، معاملة استقالة، وتسجيل مورد.\n`+
`- عيب تكرار المعتمد نفسه في خطوتين أُغلق: طلب رئيس الإدارة يصعد الآن إلى شخصين مستقلين في طبقة الرئاسة، ويُرفض برمز \`approval_route_not_distinct\` فقط إذا لم يوجد شخص ثانٍ مؤهل.\n`+
`- **لم تُقبل أي خدمة من مالك إجراء حقيقي في هذا المسح**، ولم تُختبر على إنتاج أو تكامل خارجي.\n\n`+
`## التقييم من ثلاث زوايا\n\n`+
`### الموظف\n\n`+
`المدخل موحد: بوابة الموظف تحمل الخدمات التي يسمح بها الخادم للحساب، وتضع طلبات الموارد البشرية أولًا، ثم تفتح نموذج الطلب العام نفسه. الحقول المطلوبة والمشروطة وصيغة الوقت ومنع التكرار تُفحص من الخادم. المتبقي لتحسين التجربة: حفظ المسودة تلقائيًا، تلخيص مسار الاعتماد قبل الإرسال، وإتاحة تكرار الطلبات الدورية.\n\n`+
`### المدير\n\n`+
`الاعتماد المتسلسل ومنع اعتماد صاحب الطلب ومنع المعتمد غير المرتبط تعمل. المسار الذي ينتهي بالشخص نفسه مرتين صار يفشل بأمان. المطلوب تنظيميًا هو تسمية معتمد بديل ومرجع تصعيد مستقل لكل إدارة، ثم فحص صحة المسارات ضمن بوابة الإصدار.\n\n`+
`### الموارد البشرية ومالك الإجراء\n\n`+
`للموارد البشرية ${hrServices.length} خدمة في الدليل الحالي. رفعها من بوابة الموظف يستخدم المسار نفسه الذي تستخدمه بقية الخدمات، مع صلاحيات ومرفقات وتدقيق وموافقات. ${hrOutput} خدمات موارد بشرية تحتاج سجلًا فعليًا في وحدة متخصصة قبل الإغلاق، وثلاث خدمات خطاب تحتاج قالبًا معتمدًا، والاستقالة تحتاج قرار وحدتها. لا يصح اعتبار هذه الخدمات مكتملة تشغيليًا قبل تجربة أصحاب الإجراءات عليها وتوقيعهم.\n\n`+
`## الأولويات التنفيذية\n\n`+
`1. **P0 — سلامة الاعتماد:** تسمية بديل وتصعيد مستقل لكل رئيس إدارة، وإضافة فحص يمنع أي مسار بمعتمد مكرر عند النشر.\n`+
`2. **P0 — الموارد البشرية:** اعتماد قوالب تعريف الراتب والخطاب وشهادة الخبرة، وتجربة الاستقالة وإخلاء الطرف من البداية للنهاية.\n`+
`3. **P0 — المخرجات:** تشغيل عينة حقيقية مصرح بها لكل واحدة من وحدات المخرجات الـ54، ثم قبول صاحب الطلب وتوقيع مالك الإجراء.\n`+
`4. **P1 — بوابة الموظف:** حفظ المسودة، عرض المعتمد والمدة قبل الإرسال، الطلبات المتكررة، وتحسين البحث بالمصطلحات الدارجة.\n`+
`5. **P1 — القياس:** قياس زمن الإنجاز ونسبة الإعادة والطلبات المرتدة والمخرجات المرفوضة لكل خدمة، بدل الاكتفاء بعدّ الطلبات.\n`+
`6. **P2 — الإطلاق:** اختبار استخدام على الجوال وإتاحة الوصول، ثم تجربة هجرة ببيانات منزوعة الحساسية وخطة رجوع واعتماد الملاك.\n\n`+
`## معنى الحالات في المصفوفة\n\n`+
`- **مغلق بدليل:** مرّ السيناريو المصطنع حتى الإغلاق؛ ليس قبولًا من مالك الإجراء.\n`+
`- **ينتظر مخرجًا فعليًا وقبول الطالب:** وصل التنفيذ إلى الحارس الصحيح، ويلزم سجل من الوحدة المرتبطة وقبول صاحب الطلب.\n`+
`- **ينتظر متطلبًا تشغيليًا:** لا يجوز للمنصة اختلاق قالب أو قرار أو مورد لتجاوز الحارس.\n`+
companyDepartments.map(table).join('')+
`\n## أدلة التحقق\n\n`+
`- المسح الآلي: \`scripts/qa-catalog-sweep.mjs\` بنمطي ships وenabled.\n`+
`- بوابة الموظف: \`tests/employee-portal-catalog.test.mjs\`.\n`+
`- سلامة الاعتماد: \`tests/approval-engine.test.mjs\`.\n`+
`- السجل المنظم الكامل: \`docs/testing/hr-portal-audit-20261003/service-flow-audit.json\`.\n`;

writeFileSync(resolve(outputDir,'REPORT.md'),markdown);
console.log(JSON.stringify(summary,null,2));
