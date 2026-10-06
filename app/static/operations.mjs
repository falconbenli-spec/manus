import { budgetsUI } from './budgets-ui.mjs';
import { commercialUI } from './commercial-ui.mjs';
import { procurementUI } from './procurement-ui.mjs';
import { leaveUI } from './leave-ui.mjs';
import { delegationsUI } from './delegations-ui.mjs';
import { peopleUI } from './people-ui.mjs';
import { studioUI } from './studio-ui.mjs';
import { financeUI } from './finance-ui.mjs';
import { accountsUI } from './accounts-ui.mjs';
import { receivablesUI } from './receivables-ui.mjs';
import { vendorsUI } from './vendors-ui.mjs';
import { approvalsUI } from './approvals-ui.mjs';
import { invoicesUI } from './invoices-ui.mjs';
import { contractsUI } from './contracts-ui.mjs';
import { attendanceUI } from './attendance-ui.mjs';
import { payrollUI } from './payroll-ui.mjs';
import { statementsUI } from './statements-ui.mjs';
import { securityUI } from './security-ui.mjs';
import { payablesUI } from './payables-ui.mjs';
import { payrollExtrasUI } from './payroll-extras-ui.mjs';
import { employeesUI } from './employees-ui.mjs';
import { employeeProfileUI } from './employee-profile-ui.mjs';
import { performanceUI, growthUI } from './talent-ui.mjs';
import { procurementExtrasUI } from './procurement-extras-ui.mjs';
import { campaignsUI, contentUI, scopeUI } from './campaigns-ui.mjs';
import { aiUI } from './ai-ui.mjs';
import { centresUI } from './centres-ui.mjs';
import { inboxUI } from './inbox-ui.mjs';
import { serviceCardsUI } from './service-cards-ui.mjs';
import { complianceUI } from './compliance-ui.mjs';
import { expensesUI } from './expenses-ui.mjs';
import { assetsUI } from './assets-ui.mjs';
import { clientsUI,offeringsUI,templatesUI,timeUI } from './agency-ui.mjs';
import { reportsUI } from './reports-ui.mjs';
import { bankReconciliationUI } from './bank-reconciliation-ui.mjs';
import { billingSchedulesUI, retainersUI } from './billing-recurring-ui.mjs';
import { cashForecastUI, closeChecklistUI, accrualsUI } from './cash-close-ui.mjs';
import { contractsRegisterUI } from './contracts-register-ui.mjs';
import { pulseUI, recognitionUI, announcementsUI } from './engagement-ui.mjs';
import { oneToOnesUI, feedbackUI, review360UI } from './feedback-ui.mjs';
import { objectivesUI, risksUI, decisionsUI } from './governance-ui.mjs';
import { homeUI } from './home-ui.mjs';
import { expiryUI } from './expiry-ui.mjs';
import { influencersUI, influencerCampaignsUI } from './influencers-ui.mjs';
import { leaveAccrualUI, benefitsUI } from './leave-benefits-ui.mjs';
import { myBenefitsUI, benefitsAdminUI } from './benefits-portal-ui.mjs';
import { lettersUI, letterTemplatesUI } from './letters-ui.mjs';
import { prUI, mediaContactsUI } from './pr-ui.mjs';
import { equipmentUI } from './equipment-ui.mjs';
import { privacyUI, subjectRequestsUI } from './privacy-ui.mjs';
import { productionsUI, callSheetsUI } from './production-ui.mjs';
import { costRatesUI, profitabilityUI } from './profitability-ui.mjs';
import { timesheetsUI, resourcingUI } from './resourcing-ui.mjs';
import { reviewRoundsUI, annotationsUI } from './review-rounds-ui.mjs';
import { searchUI } from './search-ui.mjs';
import { vatWorksheetUI, withholdingUI } from './tax-returns-ui.mjs';
import { wpsUI, wageReconciliationUI, payrollAnomalyUI } from './wage-protection-ui.mjs';
import { lifecycleUI, clearanceUI } from './lifecycle-ui.mjs';
import { einvoiceUI, einvoiceSelfcheckUI } from './einvoice-ui.mjs';
import { intakeSettingsUI } from './intake-settings-ui.mjs';
import { handoverUI, projectReceiptUI, kickoffUI, changeRequestUI } from './project-intake-ui.mjs';
import { myRequestTimelineUI, serviceInsightUI } from './request-transparency-ui.mjs';
import { knowledgeUI, policyAcknowledgementsUI, accessReviewsUI } from './knowledge-access-ui.mjs';
import { pipelineUI, estimatesUI } from './pipeline-estimates-ui.mjs';
// تسعير المشاريع واستثناء التسعير وعروض الأسعار (ترحيل 108، MOD-BD-02/03)
import { pricingUI, marginExceptionsUI, quotationsUI } from './pricing-ui.mjs';
import { jobsUI, featureFlagsUI, aiGovernanceUI } from './platform-ops-ui.mjs';
import { catalogQualityUI } from './catalog-quality-ui.mjs';
import { hrCasesUI, compensationUI, workforceUI } from './hr-cases-comp-ui.mjs';
import { hrOperationsUI } from './hr-operations-ui.mjs';
import { mediaSpendUI, clientReportsUI } from './media-spend-ui.mjs';
import { approvalSettingsUI } from './approval-settings-ui.mjs';
import { appearanceUI } from './appearance-ui.mjs';
// سجل المخالفات والجزاءات (ترحيل 097)
import { disciplineUI, myDisciplineUI } from './discipline-ui.mjs';
import { notificationSettingsUI, mailUI } from './notifications-ui.mjs';
import { myRequestsUI } from './my-requests-ui.mjs';
import { profileUI } from './profile-ui.mjs';
import { resignationsUI, travelUI, payrollRulesUI } from './payroll-rules-ui.mjs';
// حالات التأمينات الاجتماعية (ترحيل 127)
import { payrollInsuranceUI } from './payroll-insurance-ui.mjs';
import { payrollParallelUI } from './payroll-parallel-ui.mjs';
import { hrPoliciesUI } from './hr-policies-ui.mjs';
// النماذج الإلكترونية وكتالوج نماذج الشركة (ترحيل 107)
import { formsUI } from './forms-ui.mjs';
// التفويض المالي (تدقيق دورة التسليم 20260920، B4)
import { financeGrantsUI } from './finance-grants-ui.mjs';
// الانتداب وبدلاته، والمزايا الثلاث الجديدة (ترحيل 112)
import { secondmentUI, benefitExtrasUI } from './secondment-benefits-ui.mjs';
// مكتبة السياسات (ترحيل 110)
import { policyLibraryUI } from './policy-library-ui.mjs';
// «اسأل عن السياسة» ودليل الموظف (ترحيل 111)
import { policyAssistantUI } from './policy-assistant-ui.mjs';
// تقرير الإدارة التنفيذية للمشاريع (ترحيل 118)
import { epmoUI } from './epmo-ui.mjs';
// «تعريفات الصفحات»: نسخ تعريف كل صفحة واسترجاعها، وما ينتظر ناشرًا ثانيًا، والنقل بين بيئتين، وسجل «جرّب كمستخدم» (ترحيل 123)
import { definitionsUI } from './definitions-ui.mjs';
// مصفوفة الصلاحيات: ثلاثة مستويات على كل إدارة، وصنف نطاق صادق لكل تصريح (ترحيل 130)
import { permissionsMatrixUI } from './permissions-matrix-ui.mjs';
import { projectParticipationUI } from './project-participation-ui.mjs';
import { projectSpineUI } from './project-spine-ui.mjs';
// طابور الاستثناءات المالية (الحزمة 3، الترحيل 171): يُفتح من «أقرّر» ومن رابط الإقفال الشهري.
import { financeExceptionsUI } from './finance-exceptions-ui.mjs';
import { optionsUI } from './options-ui.mjs';
// دعم العملاء بعد البيع (الحزمة 4، P4-CRM-5)
import { clientSupportUI } from './client-support-ui.mjs';

export const operationModules={budgets:budgetsUI,commercial:commercialUI,procurement:procurementUI,'procurement-extras':procurementExtrasUI,leave:leaveUI,delegations:delegationsUI,people:peopleUI,studio:studioUI,finance:financeUI,receivables:receivablesUI,vendors:vendorsUI,approvals:approvalsUI,invoices:invoicesUI,contracts:contractsUI,attendance:attendanceUI,payroll:payrollUI,statements:statementsUI,security:securityUI,payables:payablesUI,'payroll-extras':payrollExtrasUI,employees:employeesUI,'employee-profile':employeeProfileUI,performance:performanceUI,growth:growthUI,expenses:expensesUI,assets:assetsUI,clients:clientsUI,campaigns:campaignsUI,content:contentUI,scope:scopeUI,offerings:offeringsUI,'project-templates':templatesUI,time:timeUI,reports:reportsUI,assistants:aiUI,centres:centresUI,inbox:inboxUI,'service-cards':serviceCardsUI,compliance:complianceUI,accounts:accountsUI,'project-participation':projectParticipationUI,'project-spine':projectSpineUI,
  // الوحدات الجديدة (WIRING-SPEC §1.4 و§9.8): 64 مفتاحًا (48 + 16؛ المواصفة كتبت 49 و65 سهوًا في العد) + approval-settings
  'bank-reconciliation':bankReconciliationUI,'billing-schedules':billingSchedulesUI,retainers:retainersUI,'cash-forecast':cashForecastUI,'close-checklist':closeChecklistUI,accruals:accrualsUI,'contracts-register':contractsRegisterUI,pulse:pulseUI,recognition:recognitionUI,announcements:announcementsUI,'one-to-ones':oneToOnesUI,feedback:feedbackUI,'review-360':review360UI,objectives:objectivesUI,risks:risksUI,decisions:decisionsUI,home:homeUI,expiry:expiryUI,influencers:influencersUI,'influencer-campaigns':influencerCampaignsUI,'leave-accrual':leaveAccrualUI,benefits:benefitsUI,letters:lettersUI,'letter-templates':letterTemplatesUI,pr:prUI,'media-contacts':mediaContactsUI,equipment:equipmentUI,privacy:privacyUI,'subject-requests':subjectRequestsUI,productions:productionsUI,'call-sheets':callSheetsUI,'cost-rates':costRatesUI,profitability:profitabilityUI,timesheets:timesheetsUI,resourcing:resourcingUI,'review-rounds':reviewRoundsUI,annotations:annotationsUI,search:searchUI,'vat-worksheet':vatWorksheetUI,withholding:withholdingUI,wps:wpsUI,'wage-reconciliation':wageReconciliationUI,'payroll-anomaly':payrollAnomalyUI,lifecycle:lifecycleUI,clearance:clearanceUI,einvoice:einvoiceUI,'einvoice-selfcheck':einvoiceSelfcheckUI,'intake-settings':intakeSettingsUI,
  'my-request-timeline':myRequestTimelineUI,'service-insight':serviceInsightUI,knowledge:knowledgeUI,'policy-acknowledgements':policyAcknowledgementsUI,'access-reviews':accessReviewsUI,pipeline:pipelineUI,estimates:estimatesUI,jobs:jobsUI,'feature-flags':featureFlagsUI,'ai-governance':aiGovernanceUI,'catalog-quality':catalogQualityUI,'hr-cases':hrCasesUI,compensation:compensationUI,workforce:workforceUI,'media-spend':mediaSpendUI,'client-reports':clientReportsUI,
  // إعدادات محرك الاعتماد (docs/implementation/handoff/approval-engine.md §6.2)
  'approval-settings':approvalSettingsUI,
  // المظهر: اختيار التصميم والوضع لكل مستخدم، وافتراضي الشركة للأدمن الأول (DESIGNS-ADDENDUM §هـ)
  appearance:appearanceUI,
  // الإشعارات والبريد (docs/implementation/handoff/notifications-email.md)
  'notification-settings':notificationSettingsUI,mail:mailUI,
  // الموظف أولًا (docs/implementation/handoff/employee-ux.md): «طلباتي» الموحدة و«ملفي»
  'my-requests':myRequestsUI,profile:profileUI,
  // قواعد اللائحة في الرواتب والاستقالة والانتداب (docs/implementation/handoff/payroll-rules.md)
  resignations:resignationsUI,travel:travelUI,'payroll-rules':payrollRulesUI,
  // «مزاياي» وإدارة المزايا (ترحيل 103، docs/implementation/handoff/benefits-portal.md)
  'my-benefits':myBenefitsUI,'benefits-admin':benefitsAdminUI};
// سجل المخالفات والجزاءات (ترحيل 097): شاشة الموارد البشرية وصفحة الموظف.
Object.assign(operationModules,{discipline:disciplineUI,'my-discipline':myDisciplineUI});
// شاشة سياسات الموارد البشرية الموحدة (docs/implementation/handoff/hr-policy-unify.md)
Object.assign(operationModules,{'hr-policies':hrPoliciesUI});
// حالات التأمينات الاجتماعية (ترحيل 127، docs/implementation/handoff/payroll-gosi.md)
Object.assign(operationModules,{'payroll-insurance':payrollInsuranceUI});
// المسير الموازي والانتقال إلى المنصة (الحزمة 4، P4-HR-5، الترحيل 176)
Object.assign(operationModules,{'payroll-parallel':payrollParallelUI});
// النماذج الإلكترونية (docs/implementation/handoff/forms-engine.md)
Object.assign(operationModules,{forms:formsUI});
// تسعير المشاريع: ورقة التسعير، واستثناء التسعير وقراره، وعرض السعر بنسخه.
Object.assign(operationModules,{pricing:pricingUI,'margin-exceptions':marginExceptionsUI,quotations:quotationsUI});
// سلسلة استلام المشروع (ترحيل 109، docs/implementation/handoff/project-intake.md)
Object.assign(operationModules,{'project-handover':handoverUI,'project-receipt':projectReceiptUI,'project-kickoff':kickoffUI,'change-requests':changeRequestUI});
// التفويض المالي: منحه وسحبه من المنصة (تدقيق دورة التسليم 20260920، B4).
Object.assign(operationModules,{'finance-grants':financeGrantsUI});
// الاستثناءات المالية: كل استثناء من مصدره بمالكه وإقراره (app/finance-exceptions.mjs).
Object.assign(operationModules,{'finance-exceptions':financeExceptionsUI});
// الخيارات والقيم المعتمدة: القوائم والقيم التي تحكم المنصة، بسبب وتاريخ وشخص ثانٍ (app/options.mjs).
Object.assign(operationModules,{options:optionsUI});
// تعميم بدل الانتداب والمزايا الثلاث (ترحيل 112، docs/implementation/handoff/secondment-benefits.md)
Object.assign(operationModules,{secondment:secondmentUI,'benefit-extras':benefitExtrasUI});
// مكتبة السياسات (ترحيل 110، docs/implementation/handoff/policy-library.md): يقرؤها كل موظف.
Object.assign(operationModules,{'policy-library':policyLibraryUI});
// مساعد السياسات: صفحته الخاصة، ومدخله من الرئيسية زرًّا سريعًا (docs/implementation/handoff/policy-assistant.md)
Object.assign(operationModules,{'policy-assistant':policyAssistantUI});
// تقرير الإدارة التنفيذية للمشاريع (ترحيل 118، docs/implementation/handoff/epmo-register.md)
Object.assign(operationModules,{epmo:epmoUI});
// سجل التعريفات (docs/implementation/handoff/os-admin-studio.md). محرّر الصفحة نفسه ليس شاشة: درج فوق الصفحة، يُحمَّل كسولًا من app.mjs.
Object.assign(operationModules,{definitions:definitionsUI});
// مصفوفة الصلاحيات (ترحيل 130، docs/implementation/handoff/wave3-department-permissions.md): مستويات الإدارة وقالب الشركة.
Object.assign(operationModules,{'permissions-matrix':permissionsMatrixUI});
// بلاغات العملاء وتصعيداتهم بعد البيع: على العميل والصفقة وبمهلتها (الحزمة 4، P4-CRM-5، الترحيل 184).
Object.assign(operationModules,{'client-support':clientSupportUI});
Object.assign(operationModules,{'hr-operations':hrOperationsUI});
export function money(value,currency='SAR'){
  if(value===null||value===undefined)return '—';
  const amount=BigInt(value),absolute=amount<0n?-amount:amount;
  return `${amount<0n?'-':''}${(absolute/100n).toLocaleString('en-US')}.${String(absolute%100n).padStart(2,'0')} ${currency}`;
}
// حقل صفوف: جدول يُضاف إليه ويُحذف منه. خلاياه بلا name فلا تدخل FormData؛ يجمعها collectStructured من الصفحة.
function rowCells(f,row,e){
  return f.columns.map(c=>{const value=row?.[c.name]??c.value??'',attrs=`data-col="${e(c.name)}" aria-label="${e(c.label)}" ${c.required===false?'':'required'} ${c.min!==undefined?`min="${e(c.min)}"`:''} ${c.max!==undefined?`max="${e(c.max)}"`:''}`;
    return `<td>${c.type==='select'?`<select ${attrs}>${(c.options||[]).map(o=>`<option value="${e(o.value)}" ${String(value)===String(o.value)?'selected':''}>${e(o.label)}</option>`).join('')}</select>`:`<input ${attrs} type="${e(c.type||'text')}" value="${e(value)}" ${c.type==='number'?'step="1"':`maxlength="${e(c.maxLength??300)}"`}>`}</td>`;}).join('')+`<td class="rows-remove"><button type="button" class="btn outline small" data-action="row-remove" aria-label="حذف الصف">✕</button></td>`;
}
function rowsField(f,e){
  const rows=Array.isArray(f.value)&&f.value.length?f.value:[null];
  return `<div class="full rows-field" data-rows="${e(f.name)}" data-min="${e(f.minRows??1)}" data-max="${e(f.maxRows??40)}"><span>${e(f.label)} ${f.required===false?'':'<span class="required">*</span>'}</span><div class="table-wrap"><table><thead><tr>${f.columns.map(c=>`<th>${e(c.label)}</th>`).join('')}<th></th></tr></thead><tbody>${rows.map(r=>`<tr data-row>${rowCells(f,r,e)}</tr>`).join('')}</tbody></table></div><button type="button" class="btn outline small" data-action="row-add">إضافة صف</button><template><tr data-row>${rowCells(f,null,e)}</tr></template>${f.hint?`<small class="subtle">${e(f.hint)}</small>`:''}</div>`;
}
// شرط ظهور حقل مخصّص (سجل التعريفات): السمتان يقرؤهما applyConditions في definitions-client.mjs. حقل بلا شرط لا يحمل شيئًا، فلا يتغير بايت.
const showWhen=(f,e)=>f.showWhen?` data-cf-when="${e(f.showWhen.name)}" data-cf-equals="${e(JSON.stringify(f.showWhen.equals))}"`:'';
function checksField(f,e,relabel){
  const chosen=new Set((Array.isArray(f.value)?f.value:[]).map(String));
  return `<fieldset class="full checks-field" data-checks="${e(f.name)}"${showWhen(f,e)}><legend>${e(relabel(f.label))} ${f.required===false?'':'<span class="required">*</span>'}</legend><div class="checks">${(f.options||[]).map(o=>`<label><input type="checkbox" data-check value="${e(o.value)}" ${chosen.has(String(o.value))?'checked':''}><span>${e(o.label)}</span></label>`).join('')}</div>${f.hint?`<small class="subtle">${e(f.hint)}</small>`:''}</fieldset>`;
}
// يقرأ حقول الصفوف وخانات الاختيار من النموذج المعروض ويضعها في values مصفوفات. الأعمدة الرقمية تُحوّل أرقامًا.
export function collectStructured(form,fields,values){
  for(const f of fields){
    if(f.type==='rows'){
      const box=form.querySelector(`[data-rows="${f.name}"]`);
      values[f.name]=[...(box?.querySelectorAll('tr[data-row]')??[])].map(tr=>Object.fromEntries(f.columns.map(c=>{const raw=tr.querySelector(`[data-col="${c.name}"]`)?.value??'';return [c.name,c.type==='number'?(raw===''?null:Number(raw)):raw.trim()];}))).filter(row=>Object.values(row).some(x=>x!==''&&x!==null));
      if(f.required!==false&&values[f.name].length<(f.minRows??1))throw new Error(`${f.label}: أضف ${f.minRows??1} صفًا على الأقل`);
    }else if(f.type==='checks'){
      const box=form.querySelector(`[data-checks="${f.name}"]`);
      values[f.name]=[...(box?.querySelectorAll('[data-check]:checked')??[])].map(x=>x.value);
      if(f.required!==false&&!values[f.name].length)throw new Error(`${f.label}: اختر واحدًا على الأقل`);
    }
  }
  return values;
}
// B5 (تدقيق 19 سبتمبر): خانة الاختيار كانت تُرسم value="" فيرسل FormData نصًا فارغًا عند تأشيرها، فتقرأ النماذج
// v.confirm==='on' خطأً دائمًا ويرفض الخادم الإقرار. الخانة الآن value="on" كسلوك المتصفح الافتراضي، وتُؤشَّر إن كانت قيمتها true.
// relabel: مرور التسميات وحده (سجل التعريفات): تسمية حقل تطابق اسم كيان متجاوَزًا بنصها الكامل تأخذ الاسم المنشور — «العميل» ← «الجهة»
// في كل حوار بلا تعديل شاشة. الافتراض دالة الهوية، فكل نداء قائم operationFields(fields,e) يرسم البايتات نفسها.
export function operationFields(fields,e,relabel=label=>label){
  return fields.map(f=>{
    if(f.type==='rows')return rowsField({...f,label:relabel(f.label)},e);
    if(f.type==='checks')return checksField(f,e,relabel);
    const type=f.type||'text',required=f.required!==false?'required':'',value=f.value??'';
    // B27 (تدقيق 19 سبتمبر): حقل المبلغ نصي (ليقبل «1234.50» بفاصلته بلا تقريب المتصفح)، فكان الجوال يفتح له لوحة حروف.
    // inputmode يفتح لوحة الأرقام دون تغيير نوع الحقل ولا قواعد تحققه على الخادم.
    const attrs=`name="${e(f.name)}" ${required} ${f.min!==undefined?`min="${e(f.min)}"`:''} ${f.max!==undefined?`max="${e(f.max)}"`:''} ${f.step!==undefined?`step="${e(f.step)}"`:''} ${f.inputmode?`inputmode="${e(f.inputmode)}" dir="ltr"`:''}`;
    const control=type==='select'?`<select ${attrs}>${(f.options||[]).map(o=>`<option value="${e(o.value)}" ${String(value)===String(o.value)?'selected':''}>${e(o.label)}</option>`).join('')}</select>`:type==='textarea'?`<textarea ${attrs} maxlength="${e(f.maxLength??3000)}">${e(value)}</textarea>`:`<input ${attrs} type="${e(type)}" ${type==='checkbox'?`value="on" ${value===true||value==='on'?'checked':''}`:`value="${e(value)}"`} ${['text','email'].includes(type)?`maxlength="${e(f.maxLength??500)}"`:''} ${f.placeholder?`placeholder="${e(f.placeholder)}"`:''} ${type==='file'?'accept=".pdf,.png,.jpg,.jpeg,application/pdf,image/png,image/jpeg"':''}>`;
    return `<label class="${type==='textarea'?'full':''}"${showWhen(f,e)}><span>${e(relabel(f.label))} ${required?'<span class="required">*</span>':''}</span>${control}${f.hint?`<small class="subtle">${e(f.hint)}</small>`:''}</label>`;
  }).join('');
}
