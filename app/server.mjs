import { overHttps } from './request-transport.mjs';
import { feedbackView,recordFeedback } from './service-feedback.mjs';
import { integrationReadiness } from './integration-readiness.mjs';
import * as budgets from './budgets.mjs';
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { openDb, transaction, audit, verifyAudit } from './db.mjs';
import { dbPath, bootPort, bindHost, BootError } from './boot.mjs';
import { resolveEnvironment, environmentBadge, keyNotice } from './environment.mjs';
import { requestLine, healthSnapshot } from './observability.mjs';
import { buildInfo } from './build-info.mjs';
import { authenticate, login, logout, checkCsrf, publicUser, fail, AppError, changePassword } from './auth.mjs';
import { refuse } from './refusal.mjs';
import * as wf from './workflow.mjs';
import * as projects from './projects.mjs';
import * as collaborationSpace from './collaboration-space.mjs';
import * as collaborationAccess from './collaboration-access.mjs';
import * as collaborationTasks from './collaboration-tasks.mjs';
import * as collaborationFiles from './collaboration-files.mjs';
import * as collaborationMessages from './collaboration-messages.mjs';
import * as collaborationSchedule from './collaboration-schedule.mjs';
import * as collaborationCheckins from './collaboration-checkins.mjs';
import * as collaborationReports from './collaboration-reports.mjs';
import { createOnce } from './idempotency.mjs';
import * as delegations from './delegations.mjs';
import * as commercial from './commercial.mjs';
import * as technicalProposal from './technical-proposal-review.mjs';
import * as projectAxes from './project-axes.mjs';
import * as certificates from './completion-certificates.mjs';
import * as procurement from './procurement.mjs';
import * as procurementRfq from './procurement-rfq.mjs';
import * as procurementExtras from './procurement-extras.mjs';
import * as procurementExceptions from './procurement-exceptions.mjs';
import * as leave from './leave.mjs';
import * as leaveTypes from './leave-types.mjs';
import * as leaveCompensatory from './leave-compensatory.mjs';
import { overview } from './overview.mjs';
import * as people from './people.mjs';
import * as studio from './studio.mjs';
import * as finance from './finance.mjs';
import * as financeGrants from './finance-grants.mjs';
import * as admin from './admin.mjs';
import * as routing from './routing.mjs';
import * as employees from './employees.mjs';
import * as employeeProfile from './employee-profile.mjs';
import * as workspace from './workspace.mjs';
import { executiveDrilldown } from './executive-cockpit.mjs';
import { platformHealth } from './platform-health.mjs';
import * as access from './access.mjs';
import * as receivables from './receivables.mjs';
import * as vendors from './vendors.mjs';
import * as clientApprovals from './client-approvals.mjs';
import * as invoices from './invoices.mjs';
import { invoicePrintable, payslipPrintable } from './print-documents.mjs';
import * as tenantIdentity from './tenant-identity.mjs';
import * as hrContracts from './hr-contracts.mjs';
import * as attendance from './attendance.mjs';
import * as attendanceExtras from './attendance-extras.mjs';
import * as attendanceRules from './attendance-rules.mjs';
import * as attendanceLocation from './attendance-location.mjs';
import * as overtimeRules from './overtime-rules.mjs';
import * as payroll from './payroll.mjs';
import * as ledger from './ledger.mjs';
import * as payrollLedger from './payroll-ledger.mjs';
import * as totp from './totp.mjs';
import * as payables from './payables.mjs';
import * as payrollExtras from './payroll-extras.mjs';
import * as payrollRetro from './payroll-retro.mjs';
import { preRunChecks } from './payroll-checks.mjs';
import * as expenses from './expenses.mjs';
import * as fixedAssets from './assets.mjs';
import * as agency from './agency.mjs';
import * as campaigns from './campaigns.mjs';
import * as reports from './reports.mjs';
import * as reportSchedules from './report-schedules.mjs';
import * as files from './files.mjs';
import * as talent from './talent.mjs';
import * as career from './career-profile.mjs';
import * as hrOperations from './hr-operations.mjs';
import * as hrTeamAccess from './hr-team-access.mjs';
import * as ai from './ai.mjs';
import * as centres from './centres.mjs';
import * as serviceCards from './service-cards.mjs';
import * as compliance from './compliance.mjs';
import { inbox, inboxCount, clearInboxCache } from './inbox.mjs';
import { verifyPassword } from './auth.mjs';
// الوحدات الجديدة تُستورد بالمساحة: أسماء مثل createSchedule وcreateBooking وrequestAction مكررة بينها.
import * as bank from './bank-reconciliation.mjs';
import * as billingRecurring from './billing-recurring.mjs';
import * as cashForecast from './cash-forecast.mjs';
import * as closeChecklist from './close-checklist.mjs';
import * as financeExceptions from './finance-exceptions.mjs';
import * as auditExport from './audit-export.mjs';
import * as options from './options.mjs';
import * as accruals from './accruals.mjs';
import * as contractsRegister from './contracts-register.mjs';
// الحزمة 4 (P4-CRM-5، الترحيل 184): بلاغ العميل وتصعيده بمهلته.
import * as clientSupport from './client-support.mjs';
// الحزمة 4 (P4-CRM-6، الترحيل 185): فرصة التجديد من العقد السابق، وتذكير التجديد.
import * as clientRenewals from './client-renewals.mjs';
// الحزمة 4 (P4-CRM-7، الترحيل 186): إقفال ملف العميل وإعادة فتحه بسجل يعتمده شخص ثانٍ.
import * as clientOffboarding from './client-offboarding.mjs';
import * as projectIntake from './project-intake.mjs';
import * as engagement from './engagement.mjs';
import * as feedback from './feedback.mjs';
import * as governance from './governance.mjs';
import * as home from './home.mjs';
import * as expiry from './expiry.mjs';
import * as influencers from './influencers.mjs';
import * as leaveAccrual from './leave-accrual.mjs';
import * as benefits from './benefits.mjs';
import * as benefitsPortal from './benefits-portal.mjs';
import * as letters from './letters.mjs';
// محرك النماذج الإلكترونية وكتالوج نماذج الشركة (ترحيل 107)
import * as forms from './forms.mjs';
import * as pr from './pr.mjs';
import * as equipment from './equipment.mjs';
import * as privacy from './privacy.mjs';
import * as production from './production.mjs';
import * as profitability from './profitability.mjs';
import * as timesheets from './timesheets.mjs';
import * as resourcing from './resourcing.mjs';
import * as reviewRounds from './review-rounds.mjs';
import * as search from './search.mjs';
import * as taxReturns from './tax-returns.mjs';
import * as wps from './wage-protection.mjs';
import * as wageRecon from './wage-reconciliation.mjs';
import * as anomaly from './payroll-anomaly.mjs';
import * as lifecycle from './lifecycle.mjs';
import * as payrollRules from './payroll-rules.mjs';
import * as payrollInsurance from './payroll-insurance.mjs';
// المسير الموازي والانتقال (الحزمة 4، P4-HR-5، الترحيل 176).
import * as payrollParallel from './payroll-parallel.mjs';
import * as resignations from './resignations.mjs';
import * as travel from './travel.mjs';
import * as secondmentBenefits from './secondment-benefits.mjs';
import * as einvoice from './einvoice-gateway.mjs';
import { einvoiceSelfcheck } from './einvoice-selfcheck.mjs';
import * as requestIntake from './request-intake.mjs';
import * as requestTimeline from './request-timeline.mjs';
import * as requestClosure from './request-closure.mjs';
import * as serviceOutputs from './service-outputs.mjs';
import * as serviceExperience from './service-experience.mjs';
import * as processInsight from './process-insight.mjs';
import * as knowledge from './knowledge.mjs';
import * as policyAck from './policy-acknowledgements.mjs';
// مكتبة السياسات (ترحيل 110): نص اللائحة كاملًا وبحثه ومواده وشاراته ولوحة الموارد البشرية.
import * as policyLibrary from './policy-library.mjs';
import * as accessReviews from './access-reviews.mjs';
// تقرير الإدارة التنفيذية للمشاريع (ترحيل 118): سجلّاته وأفعالها، ولوحته.
import * as epmo from './epmo-report.mjs';
import { epmoBoard } from './epmo-board.mjs';
import * as pipeline from './pipeline-estimates.mjs';
import * as estimates from './estimates.mjs';
import * as pricing from './pricing.mjs';
// سجل التعريفات والحقول المخصّصة (ترحيل 123، docs/implementation/handoff/os-registry.md). الواصفات تسجّلها وحدات العمل الثلاث أعلاه عند تحميلها.
import * as definitions from './definitions.mjs';
import * as customFields from './custom-fields.mjs';
import * as definitionsTransfer from './definitions-transfer.mjs';
// مستويات الصلاحية على الإدارة (ترحيل 130): قالب الشركة، واستثناء الإدارة، ومستوى الحساب، والمفتاح والمقارنة الظلية.
import * as departmentLevels from './department-levels.mjs';
import { assignDepartmentEscalation } from './department-escalation.mjs';
// «جرّب كمستخدم»: خفض تصاريح بهوية صاحبها وقراءة فقط (app/view-as.mjs)، وسياق الطلب الذي تقرؤه access وdelegations وfinance وdb.
import * as viewAs from './view-as.mjs';
import { runRequest, setViewing, viewingAs, requestMetrics } from './request-context.mjs';
import * as jobs from './jobs.mjs';
import * as flags from './feature-flags.mjs';
import * as gov from './ai-governance.mjs';
import * as evals from './ai-evals.mjs';
import * as policyAssistant from './policy-assistant.mjs';
// وصل المساعد بمكتبة السياسات (110 مع 111): قبل هذا السطر كان يجيب من نص المنصة وحده ولا يرى مواد اللائحة.
import { setPolicyLibrary } from './policy-retrieval.mjs';
setPolicyLibrary(policyLibrary.retrievalSource);
import * as catalogQuality from './catalog-quality.mjs';
import * as hrCases from './hr-cases.mjs';
// سجل المخالفات والجزاءات (ترحيل 097)
import * as discipline from './discipline.mjs';
import * as hrPolicies from './hr-policies.mjs';
import * as compensation from './compensation.mjs';
import * as workforce from './workforce.mjs';
import * as mediaSpend from './media-spend.mjs';
import * as clientReports from './client-reports.mjs';
import * as workflowTimers from './workflow-timers.mjs';
import * as workflowSweep from './workflow-sweep.mjs';
import * as requestAssignment from './request-assignment.mjs';
import { overrideEscalation } from './step-escalation.mjs';
import { resolveUndeliverable } from './notice-recipients.mjs';
import { resubmitLapsed } from './returned-requests.mjs';
import { approvalSettings, adoptPolicyProposal, decideServiceTarget, variantCatalog, applyVariant, enrichCatalog, enrichFields } from './service-catalog.mjs';
import { setAvailability } from './service-availability.mjs';
import { setServiceGate } from './service-gates.mjs';
import * as preferences from './preferences.mjs';
import * as delivery from './delivery.mjs';
import * as reminders from './reminders.mjs';
import * as sessionPolicy from './session-policy.mjs';
import { myRequests } from './my-requests.mjs';
import { profileView } from './my-profile.mjs';
import { annotateCatalog } from './module-routes.mjs';
import * as catalogHome from './catalog-home.mjs';
// الدفعة الرابعة من مركز الخدمات: لوح الإدارة (المرادفات سطحُ كتابته الوحيد) والرحلات.
import * as catalogAdmin from './catalog-admin.mjs';
import * as journeys from './journeys.mjs';
import { annotateTargets } from './service-target.mjs';

const root=fileURLToPath(new URL('../',import.meta.url));
const assets=new Map([
  ['/', ['index.html','text/html; charset=utf-8']],
  ['/app.mjs',['app.mjs','text/javascript; charset=utf-8']],
  ['/executive-cockpit-ui.mjs',['executive-cockpit-ui.mjs','text/javascript; charset=utf-8']],
  ['/admin-cockpit-ui.mjs',['admin-cockpit-ui.mjs','text/javascript; charset=utf-8']],
  ['/cockpit.css',['cockpit.css','text/css; charset=utf-8']],
  ['/workspace-ui.mjs',['workspace-ui.mjs','text/javascript; charset=utf-8']],
  ['/workspace.css',['workspace.css','text/css; charset=utf-8']],
  // مسبار تخطيط الجوال (TP2.5): أداة قياس لا شاشة منصة. الإنتاج معطَّل في هذه النسخة أصلًا،
  // ويُحرس هنا أيضًا فلا يُخدم متى فُتح — أداةٌ تفتح كل شاشة في إطار ليست شيئًا يُترك مخدومًا.
  ...(process.env.NODE_ENV==='production'?[]:[
    ['/mobile-probe',['mobile-probe.html','text/html; charset=utf-8']],
    ['/mobile-probe.mjs',['mobile-probe.mjs','text/javascript; charset=utf-8']],
  ]),
  ['/athar.mjs',['athar.mjs','text/javascript; charset=utf-8']],
  ['/brand-logo.mjs',['brand-logo.mjs','text/javascript; charset=utf-8']],
  // مركز الخدمات (الترحيل 131): ثلاث وحدات تستوردها app.mjs مباشرة أو عبر بعضها، فغيابها من هنا يترك الشاشة بيضاء
  // في المتصفح ولا يظهر في اختبار داخل العملية. كشفه tests/static-modules.test.mjs عند الدمج.
  ['/catalog-home-ui.mjs',['catalog-home-ui.mjs','text/javascript; charset=utf-8']],
  ['/service-page.mjs',['service-page.mjs','text/javascript; charset=utf-8']],
  ['/catalog-search.mjs',['catalog-search.mjs','text/javascript; charset=utf-8']],
  ['/icons.mjs',['icons.mjs','text/javascript; charset=utf-8']],
  ['/hr-design.css',['hr-design.css','text/css; charset=utf-8']],
  ['/athar.css',['athar.css','text/css; charset=utf-8']],
  ['/journey.css',['journey.css','text/css; charset=utf-8']],
  ['/signature.css',['signature.css','text/css; charset=utf-8']],
  ['/signature.mjs',['signature.mjs','text/javascript; charset=utf-8']],
  ['/depth-scene.mjs',['depth-scene.mjs','text/javascript; charset=utf-8']],
  ['/depth.css',['depth.css','text/css; charset=utf-8']],
  ['/interact.mjs',['interact.mjs','text/javascript; charset=utf-8']],
  ['/studio.css',['studio.css','text/css; charset=utf-8']],
  ['/classic.css',['classic.css','text/css; charset=utf-8']],
  ['/classic-plus.css',['classic-plus.css','text/css; charset=utf-8']],
  ['/riwaq.css',['riwaq.css','text/css; charset=utf-8']],
  ['/yawm.css',['yawm.css','text/css; charset=utf-8']],
  ['/markaz.css',['markaz.css','text/css; charset=utf-8']],
  ['/theme-boot.js',['theme-boot.js','text/javascript; charset=utf-8']],
  ['/journey.mjs',['journey.mjs','text/javascript; charset=utf-8']],
  ['/report-print.css',['report-print.css','text/css; charset=utf-8']],
  ['/style.css',['style.css','text/css; charset=utf-8']],
  ['/employee-portal.css',['employee-portal.css','text/css; charset=utf-8']],
  // تطبيق قابل للتثبيت (P2-1، P2-2): البيان والأيقونات وعامل الخدمة. sw.js بلا تخزين مؤقت حتى يصل كل تحديث له فورًا.
  ['/manifest.webmanifest',['manifest.webmanifest','application/manifest+json; charset=utf-8']],
  ['/sw.js',['sw.js','text/javascript; charset=utf-8',{'Cache-Control':'no-cache'}]],
  ['/icons/icon-192.png',['icons/icon-192.png','image/png']],['/icons/icon-512.png',['icons/icon-512.png','image/png']],
  ['/icons/icon-maskable-512.png',['icons/icon-maskable-512.png','image/png']],['/icons/apple-touch-icon.png',['icons/apple-touch-icon.png','image/png']],
  // مسح 20 سبتمبر (S-01): المتصفحات تطلب /favicon.ico من الجذر بلا رابط في الترميز. بدون هذا السطر يسقط الطلب على
  // مُوجّه /api ويعود 401 في كل تحميل صفحة. تُقدَّم أيقونة 192 نفسها؛ لا ملف ICO جديد.
  ['/favicon.ico',['icons/icon-192.png','image/png']]
]);
// محور الإقفال: فني ثم مالي ثم نهائي، وإعادة فتح بتصريح وسبب. كل واحد لصاحبه في الوحدة نفسها.
// وقبول نتيجة الهامش شرط المالي (ترحيل 163): لحامل تصريح الربحية، ولغير من يقفل ماليًا.
const closureAction=(db,u,projectId,action,input)=>({close_technically:projectAxes.closeTechnically,close_financially:projectAxes.closeFinancially,
  close_finally:projectAxes.closeFinally,reopen_closure:projectAxes.reopenClosure,accept_margin:projectAxes.acceptMargin}[action])(db,u,projectId,input);
for(const module of ['service-quality-ui','integrations-ui','operations','delegations-ui','commercial-ui','procurement-ui','leave-ui','people-ui','studio-ui','finance-ui','receivables-ui','vendors-ui','approvals-ui','invoices-ui','contracts-ui','attendance-ui','payroll-ui','statements-ui','security-ui','files-ui','talent-ui','procurement-extras-ui','campaigns-ui','ai-ui','centres-ui','inbox-ui','service-cards-ui','dates','compliance-ui','payables-ui','payroll-extras-ui','expenses-ui','assets-ui','agency-ui','reports-ui','budgets-ui','hr-design','request-picker','accounts-ui','motion-cards','portal-ui','employees-ui','executive-ui','work-ui','org-ui','bank-reconciliation-ui','billing-recurring-ui','cash-close-ui','contracts-register-ui','engagement-ui','feedback-ui','governance-ui','home-ui','expiry-ui','influencers-ui','leave-benefits-ui','benefits-portal-ui','letters-ui','pr-ui','equipment-ui','privacy-ui','production-ui','profitability-ui','resourcing-ui','review-rounds-ui','search-ui','tax-returns-ui','wage-protection-ui','lifecycle-ui','einvoice-ui','intake-settings-ui','project-intake-ui','project-participation-ui','project-spine-ui','request-transparency-ui','knowledge-access-ui','pipeline-estimates-ui','pricing-ui','platform-ops-ui','catalog-quality-ui','hr-cases-comp-ui','media-spend-ui','approval-settings-ui','appearance-ui','leave-count','module-services','notifications-ui','my-requests-ui','profile-ui','deep-links','pwa','payroll-rules-ui','arabic-count','employee-profile-ui','epmo-ui','payroll-insurance-ui','payroll-parallel-ui','hr-operations-ui'])assets.set('/'+module+'.mjs',[module+'.mjs','text/javascript; charset=utf-8']);
// ت1: خريطة التنقل (nav-map.mjs) والصفحات الجامعة (hubs-ui.mjs) تستوردهما app.mjs؛ غيابهما هنا يترك الصفحة بيضاء في المتصفح.
for(const module of ['nav-map','hubs-ui'])assets.set('/'+module+'.mjs',[module+'.mjs','text/javascript; charset=utf-8']);
// م0 «السور»: القاموس الواحد وعدّة المكوّنات (docs/implementation/handoff/wave0-guard-rails.md). app.mjs يستوردهما، فغيابهما هنا يكسر الصفحة كلها.
assets.set('/vocabulary.mjs',['vocabulary.mjs','text/javascript; charset=utf-8']);
assets.set('/kit.mjs',['kit.mjs','text/javascript; charset=utf-8']);
// سجل المخالفات والجزاءات (ترحيل 097)
assets.set('/discipline-ui.mjs',['discipline-ui.mjs','text/javascript; charset=utf-8']);
// شاشة سياسات الموارد البشرية الموحدة (docs/implementation/handoff/hr-policy-unify.md)
assets.set('/hr-policies-ui.mjs',['hr-policies-ui.mjs','text/javascript; charset=utf-8']);
// النماذج الإلكترونية (ترحيل 107)
assets.set('/forms-ui.mjs',['forms-ui.mjs','text/javascript; charset=utf-8']);
// رابط السجل ‎#screen?focus=<id>‎ (الموجة 1 «ما عليّ»)
assets.set('/focus-record.mjs',['focus-record.mjs','text/javascript; charset=utf-8']);
// التفويض المالي (تدقيق دورة التسليم 20260920، B4) وشاشتا الانتداب والمزايا الثلاث (ترحيل 112)
assets.set('/finance-grants-ui.mjs',['finance-grants-ui.mjs','text/javascript; charset=utf-8']);
// طابور الاستثناءات المالية (الحزمة 3): تستورده operations.mjs، فغيابه من هنا يترك الصفحة بيضاء في المتصفح.
assets.set('/finance-exceptions-ui.mjs',['finance-exceptions-ui.mjs','text/javascript; charset=utf-8']);
// الخيارات والقيم المعتمدة: القوائم التي تختار منها النماذج والقيم التي تحكم سلوك المنصة، تُقرَّر بسبب وتاريخ وتُعتمد بشخص ثانٍ.
assets.set('/options-ui.mjs',['options-ui.mjs','text/javascript; charset=utf-8']);
assets.set('/secondment-benefits-ui.mjs',['secondment-benefits-ui.mjs','text/javascript; charset=utf-8']);
// مكتبة السياسات (ترحيل 110)
assets.set('/policy-library-ui.mjs',['policy-library-ui.mjs','text/javascript; charset=utf-8']);
// «اسأل عن السياسة» (ترحيل 111، docs/implementation/handoff/policy-assistant.md)
assets.set('/policy-assistant-ui.mjs',['policy-assistant-ui.mjs','text/javascript; charset=utf-8']);
// محرّر الصفحة وسجل التعريفات (ترحيل 123، docs/implementation/handoff/os-admin-studio.md). page-editor.mjs يُحمَّل كسولًا لحامل
// تصريح تعديل التعريفات وحده؛ وجوده هنا لا يعني أن المتصفح يطلبه لكل موظف.
for(const module of ['definitions-client','page-editor','definitions-ui'])assets.set('/'+module+'.mjs',[module+'.mjs','text/javascript; charset=utf-8']);
assets.set('/page-editor.css',['page-editor.css','text/css; charset=utf-8']);
// مصفوفة الصلاحيات (ترحيل 130)
assets.set('/permissions-matrix-ui.mjs',['permissions-matrix-ui.mjs','text/javascript; charset=utf-8']);
// لوح مرجع تصعيد الإدارة داخلها: تستورده permissions-matrix-ui.mjs، فغيابه من هنا يترك الشاشة بيضاء
// في المتصفح بينما كل اختبار داخل العملية يمرّ. كشفه tests/static-modules.test.mjs.
assets.set('/department-escalation-ui.mjs',['department-escalation-ui.mjs','text/javascript; charset=utf-8']);
// شروط أهلية الخدمات (ترحيل 138): تستورده approval-settings-ui.mjs، فغيابه من هنا يترك شاشة «إعداد
// الاعتماد» بيضاء في المتصفح بينما كل اختبار داخل العملية يمرّ. كشفه tests/static-modules.test.mjs.
assets.set('/service-gates-ui.mjs',['service-gates-ui.mjs','text/javascript; charset=utf-8']);
const requestView=(db,u,id)=>{
  const detail=wf.detail(db,u,id);
  // نموذج تعديل المسودة يقرأ حقول الخدمة من هنا، فيصله الإرشاد كما يصله من الدليل.
  // تبديل اسم كيان في سجل التعريفات («العميل» ← «الجهة») يصل تسميات حقول الخدمة عند القراءة؛ بلا تجاوز منشور تمر القائمة كما هي.
  detail.service={...detail.service,fields:definitions.applyTerms(db,u.tenant_id,enrichFields(detail.service.code,detail.service.fields))};
  const extras={feedback:feedbackView(db,u,id),clock:routing.serviceClock(db,detail),transfers:routing.listTransfers(db,detail),tasks:routing.listRequestTasks(db,detail),handling_department_id:routing.handlingDepartment(db,detail)};
  if(detail.actions.includes('transfer'))extras.transfer_targets=routing.transferTargets(db,u,detail);
  if(detail.actions.includes('assign_task'))extras.team=routing.departmentTeam(db,u,detail);
  return {...detail,...extras};
};
const userView=(db,u)=>{const grants=access.capabilitiesFor(db,u),run=viewingAs(u);return {...publicUser(u),
  // «جرّب كمستخدم»: الواجهة ترسم الشريط الأحمر من هذا الحقل؛ الدور والتصاريح أعلاه هي المخفَّضة أصلًا.
  view_as:run?{persona:run.persona,persona_name:run.persona_name,reason:run.reason,started_at:run.started_at,expires_at:run.expires_at}:null,admin_level:u.admin_level??null,can:grants.list,scopes:grants.scopes,capabilities:{finance:finance.financeCapabilities(db,u).includes('read')},appearance:preferences.effectiveAppearance(db,u),
  // شاشات العملاء والمشاريع لفرق التشغيل: الموظف يراها في قائمته حين يكون عضوًا في فريق عميل أو مشروع.
  delivery_member:!!(db.prepare('SELECT 1 FROM client_members WHERE user_id=? LIMIT 1').get(u.id)||db.prepare('SELECT 1 FROM project_members WHERE user_id=? LIMIT 1').get(u.id))};};
for(const script of ['arabic','latin'])for(const weight of [200,300,400,700]) {
  const path=`fonts/alexandria-${script}-${weight}-normal.woff2`;assets.set('/'+path,[path,'font/woff2']);
}
const headers={
  'X-Content-Type-Options':'nosniff','X-Frame-Options':'DENY','Referrer-Policy':'no-referrer',
  'Cache-Control':'no-store','Cross-Origin-Resource-Policy':'same-origin',
  'Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
  'Permissions-Policy':'camera=(), microphone=(), geolocation=(self)', /* attendance rules (099): GPS at check-in for this origin only */
  // ترويسات P2-2: عزل نافذة المنصة عن النوافذ التي تفتحها أو تفتحها، ومنع سياسات النطاقات المتقاطعة القديمة، وعزل العنقود.
  'Cross-Origin-Opener-Policy':'same-origin','X-Permitted-Cross-Domain-Policies':'none','Origin-Agent-Cluster':'?1'
};
// HSTS لا يُرسل على HTTP المحلي (يعلّق المتصفح على HTTPS لمضيف لا يخدمه). يُرسل إن وصل الطلب مشفرًا، أو عبر رابط المعاينة
// (HTTPS دائمًا)، أو خلف وكيل موثوق يصرّح بـx-forwarded-proto=https ويُعلن ذلك متغير البيئة TRUST_PROXY.
const HSTS='max-age=31536000; includeSubDomains';
export { overHttps };
// ───── عنوان العميل خلف نفق مشفَّر ─────
// النفق برنامج يعمل على هذا الجهاز ويتصل بالخادم من عنوان الاسترجاع، فتصل طلبات الموظفين كلها من العنوان نفسه.
// بلا اشتقاق صحيح يصير الموظفون عنوانًا واحدًا أمام حد المحاولات: عشر محاولات خاطئة من شخص واحد تقفل الشركة كلها،
// وعداد المئتين لكل عنوان يفقد معناه، ويصير كل سطر في سجل التدقيق مكتوبًا باسم الجهاز لا باسم العنوان الذي جاء منه الفعل.
// الترويسة تُقرأ بشرطين معًا لا بأحدهما: TRUST_PROXY معلن، والطرف المتصل عنوان استرجاع فعلًا.
// ترويسة غير موثوقة لا تُقرأ أبدًا: من صنع المرسل، وقبولها يعني أن أي شخص يصفّر عداد محاولاته أو يكتب عنوانًا ليس عنوانه.
const LOOPBACK=/^(?:::1|(?:::ffff:)?127\.\d{1,3}\.\d{1,3}\.\d{1,3})$/i;
export const isLoopbackAddress=address=>LOOPBACK.test(String(address??'').trim());
const ipv4=text=>/^(?:\d{1,3}\.){3}\d{1,3}$/.test(text)&&text.split('.').every(part=>part.length<=3&&Number(part)<=255);
const ipv6=text=>/^[0-9a-f]{0,4}(?::[0-9a-f]{0,4}){2,7}$/i.test(text)&&text.includes(':');


export function clientAddress(req,{trustProxy=false}={}) {
  const peer=String(req.socket?.remoteAddress??'').trim()||'unknown';
  if(!trustProxy||!isLoopbackAddress(peer)) return peer;
  // الحلقة الأخيرة وحدها هي ما كتبته القفزة الموثوقة عن الطرف المتصل بها. ما قبلها وصل من الخارج ويُزوَّر بحرية.
  const chain=String(req.headers['x-forwarded-for']??'').split(',').map(part=>part.trim()).filter(Boolean);
  let candidate=chain[chain.length-1];
  if(!candidate||candidate.length>60) return peer;
  // بعض الوسطاء يلحقون منفذًا أو يحيطون عنوان IPv6 بقوسين. يُنزع الشكل ولا يُوسَّع ما يُقبل.
  candidate=candidate.match(/^\[([0-9a-f:.]{2,45})\](?::\d{1,5})?$/i)?.[1]
    ??candidate.match(/^((?:\d{1,3}\.){3}\d{1,3}):\d{1,5}$/)?.[1]
    ??candidate;
  candidate=candidate.replace(/^::ffff:/i,'');
  // عنوان لا يُقرأ كعنوان لا يدخل عداد المحاولات ولا سجل التدقيق: يُهمل ويُحتسب الطلب على الطرف المتصل.
  return ipv4(candidate)||ipv6(candidate)?candidate:peer;
}
async function body(req) {
  if(!(req.headers['content-type']??'').startsWith('application/json')) fail(415,'json_required','نوع المحتوى المطلوب JSON');
  const chunks=[];let size=0;
  for await (const chunk of req) {size+=chunk.length;if(size>2900000) fail(413,'too_large','حجم الطلب أكبر من الحد');chunks.push(chunk);}
  try {return JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{fail(400,'invalid_json','صيغة الطلب غير صالحة');}
}
const hostPattern=extra=>{
  // قائمة العناوين المسموحة ضيقة عمدًا: دفاع ضد إعادة ربط النطاق (DNS rebinding).
  // توسيعها يكون بعنوان واحد محدد يضعه المالك صراحة، لا بنمط مفتوح.
  if(!extra)return /^(127\.0\.0\.1|localhost)(:\d+)?$/;
  // عنوان النفق اسم مضيف كامل واحد. التحقق على مستوى المقطع: حرف أو رقم في الطرفين، وشرطة في الوسط،
  // فيمر اسم النفق الحقيقي بما فيه أسماء punycode ذات الشرطتين (xn--...)، ويبقى المرفوض مرفوضًا:
  // لا نجمة ولا مقطع فارغ ولا شرطة طرفية ولا نقطة لاحقة. توسيعه يكون بعنوان واحد يضعه المالك، لا بنمط مفتوح.
  const label=String.raw`(?!-)[a-z0-9-]{1,63}(?<!-)`;
  if(extra.length>253||!(new RegExp(`^(?:\\d{1,3}\\.){3}\\d{1,3}$|^${label}(?:\\.${label})*$`,'i').test(extra))) throw new Error('Invalid allowed host');
  return new RegExp(`^(127\\.0\\.0\\.1|localhost|${extra.replace(/\./g,'\\.')})(:\\d+)?$`,'i');
};
export function createApp(db,{previewOrigin=null,allowedHost=process.env.LOCAL_ALLOWED_HOST??null,trustProxy=['1','true','yes'].includes(String(process.env.TRUST_PROXY??'').toLowerCase()),environment=resolveEnvironment(process.env,{root}),auditCheckedAtBoot=null,buildAtBoot=null,platformChecks={}}={}) {
  if(previewOrigin!==null&&!/^https:\/\/[a-z0-9]+(?:-[a-z0-9]+)*\.trycloudflare\.com$/.test(previewOrigin)) throw new Error('Invalid preview origin');
  const previewHost=previewOrigin?new URL(previewOrigin).host:null;
  const localHosts=hostPattern(allowedHost);
  // مسار التحقق من الخطاب هدف رمز QR مفتوح بلا جلسة، فيُحد لكل عنوان: 30 طلبًا في الدقيقة.
  // العداد في الذاكرة لكل نسخة خادم؛ يكفي لإبطاء تخمين الرموز لا لصد هجوم موزع.
  const observe=String(process.env.OBSERVE??'').trim()!=='0';
  const startedAt=Date.now();
  const verifyHits=new Map(),VERIFY_WINDOW_MS=60000,VERIFY_LIMIT=30;
  const verifyAllowed=ip=>{
    const at=Date.now();
    if(verifyHits.size>10000)for(const [key,hit] of verifyHits)if(at-hit.start>=VERIFY_WINDOW_MS)verifyHits.delete(key);
    const hit=verifyHits.get(ip);
    if(!hit||at-hit.start>=VERIFY_WINDOW_MS){verifyHits.set(ip,{start:at,count:1});return 0;}
    hit.count++;
    return hit.count>VERIFY_LIMIT?Math.ceil((hit.start+VERIFY_WINDOW_MS-at)/1000):0;
  };
  // المعالج يُلفّ مرة واحدة بسياق الطلب (node:async_hooks)، فيُقرأ «من يجرّب الآن» في أي وحدة بلا تمريره وسيطًا.
  return createServer((req,res)=>runRequest(async()=>{
    // الرصد (TP2.6): السطر يُكتب عند انتهاء الرد فيحمل رمزه ومدته الحقيقيين، ويُقرأ المقياس من
    // سياق الطلب قبل أن يُغلق. `OBSERVE=0` يُسكته؛ وهو مفتوح افتراضًا لأن سطرًا لكل طلب على منصة
    // بخمسين شخصًا حجمٌ لا يُذكر، وغيابه هو ما يجعل التباطؤ بلا سبب معروف.
    const requestId=randomUUID().slice(0,8),startedRequest=Date.now();
    // الرصد لا يشترط شكلًا بعينه للرد: حزام الاختبار يُرسل ردًّا مبسّطًا بلا `once`، ورصدٌ يشترطه
    // كان يُسقط كل طلب فيه. الأداة تلاحظ ولا تفرض.
    if(observe&&typeof res.once==='function'){
      const metricsAt=()=>requestMetrics();
      res.once('finish',()=>{
        try{console.log(requestLine({id:requestId,method:req.method,path:req.url,status:res.statusCode,
          ms:Date.now()-startedRequest,metrics:metricsAt(),env:environment.key,at:new Date().toISOString()}));}
        catch{/* الرصد لا يُسقط ردًّا */}
      });
    }
    let auth;
    const send=(status,value,extra={})=>{res.writeHead(status,{...headers,'Content-Type':'application/json; charset=utf-8',...extra});res.end(JSON.stringify(value));};
    // النقل والعنوان يُشتقّان مرة واحدة لكل طلب، ويبني عليهما HSTS وراية Secure ومصدر الطلب المتوقع وعدّاد المحاولات.
    const https=overHttps(req,{previewOrigin,trustProxy});
    // راية Secure تتبع النقل الفعلي لا رابط المعاينة وحده: خلف النفق يكون الاتصال مشفرًا عند الحافة،
    // وبلا الراية يسافر ملف الجلسة مع أي طلب HTTP عابر يقع سهوًا.
    const secureCookie=https?'; Secure':'';
    const address=clientAddress(req,{trustProxy});
    if(https){const writeHead=res.writeHead.bind(res);res.writeHead=(status,values={})=>writeHead(status,{...values,'Strict-Transport-Security':HSTS});}
    try {
      const host=req.headers.host??'';
      if(previewOrigin?host!==previewHost:!localHosts.test(host)) fail(403,'host_denied','عنوان الخادم غير مسموح');
      const url=new URL(req.url,`http://${host}`),p=url.pathname;
      const changing=!['GET','HEAD'].includes(req.method);
      // المصدر المتوقع يتبع النقل أيضًا: خلف النفق يرسل المتصفح https://المضيف، ومقارنته بـhttp:// كانت ترد كل كتابة بـ403.
      if(req.headers.origin&&req.headers.origin!==(previewOrigin??`${https?'https':'http'}://${host}`)) fail(403,'origin_denied','مصدر الطلب غير مسموح');
      if(req.headers['sec-fetch-site']==='cross-site') fail(403,'origin_denied','مصدر الطلب غير مسموح');
      if(req.method==='GET'&&assets.has(p)) {
        const [file,type,extra]=assets.get(p);
        let body;try{body=readFileSync(resolve(root,'app/static',file));}catch{fail(404,'not_found','الملف غير موجود');}
        res.writeHead(200,{...headers,'Content-Type':type,...(extra??{})});res.end(body);return;
      }
      // عام بلا مصادقة: لا يعيد إلا ما تعيده verifyLetter (وُجد/لم يوجد وتاريخ الإصدار)، ورمز غير صالح يلقى الرد نفسه.
      const letterVerify=p.match(/^\/verify\/letter\/([^/]{1,64})$/);
      if(letterVerify) {
        if(req.method!=='GET') fail(405,'method_not_allowed','هذا المسار للقراءة فقط');
        const wait=verifyAllowed(address);
        if(wait) {send(429,{error:{code:'rate_limited',message:'محاولات تحقق كثيرة من هذا العنوان. أعد المحاولة بعد دقيقة'}},{'Retry-After':String(wait)});return;}
        send(200,letters.verifyLetter(db,letterVerify[1]));return;
      }
      if(p==='/api/login'&&req.method==='POST') {
        const input=await body(req);const result=login(db,input?.username,input?.password,address,input?.otp);
        send(200,{user:userView(db,result.user),csrf:result.csrf,environment:environmentBadge(environment)},{'Set-Cookie':`session=${result.token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=28800${secureCookie}`});return;
      }
      auth=authenticate(db,req.headers.cookie);let u=auth.user;
      if(changing) checkCsrf(auth.session,req.headers['x-csrf-token']);
      // «جرّب كمستخدم»: لا كتابة بالبناء. كل طلب يغيّر شيئًا يُرفض هنا قبل أن يبلغ أي معالج — لا قائمة أفعال ممنوعة تُنسى منها
      // واحدة — إلا إنهاء التجربة والخروج. وما عداه يجري بتصاريح مخفَّضة وبهوية صاحبها، وتُسجَّل عائلة كل مسار فُتح.
      const trial=viewAs.active(db,auth.session,u);
      if(trial) {
        // السياق يُملأ قبل الرفض: حدث «denied» الذي يكتبه معالج الأخطاء أدناه يحمل بذلك الدور الذي كان يُجرَّب، باسم صاحبه الحقيقي.
        setViewing(trial);u=viewAs.personaRow(u,trial);
        if(changing&&!['/api/view-as/stop','/api/logout'].includes(p)) viewAs.refuseWrite(trial,req.method,p);
        if(!changing) viewAs.noteScreen(db,trial,u,p);
      }
      if(trial&&p==='/api/logout'&&req.method==='POST') transaction(db,()=>viewAs.stop(db,u,auth.session));
      if(p==='/api/logout'&&req.method==='POST') {
        transaction(db,()=>logout(db,u,auth.session,address));
        send(200,{logged_out:true},{'Set-Cookie':`session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${secureCookie}`});return;
      }
      if(u.must_change_password&&!['/api/me','/api/account/password'].includes(p)) fail(403,'password_change_required','غيّر كلمة المرور المؤقتة للمتابعة');
      // محلِّل تكلفة أسطر التقدير من معدلات الفئات المعتمدة. لا يُمرَّر إلا لمن يرى الربحية، وبدونه تبقى الأسطر «غير مكلَّفة».
      const costRate=access.can(db,u,'profitability.view')?({tenant_id,category_code,date})=>{const r=db.prepare("SELECT r.rate_minor,r.effective_from,c.name FROM category_cost_rates r JOIN job_categories c ON c.id=r.category_id AND c.tenant_id=r.tenant_id WHERE r.tenant_id=? AND c.code=? AND r.status='approved' AND r.effective_from<=? ORDER BY r.effective_from DESC LIMIT 1").get(tenant_id,category_code,date);return r?{rate_minor:r.rate_minor,source:`معدل فئة ${r.name} المعتمد من ${r.effective_from}`}:null;}:undefined;
      // محلِّل ازدواج الصرف الإعلامي لورقة التسعير (ترحيل 108): يقول إن كان الصرف المسجَّل يصل أيضًا فاتورةَ مورد.
      // بدونه لا تخترع الشاشة نتيجة: تعلن أن التحقق غير موصول.
      const mediaInvoice=({tenant_id,kind,reference})=>{
        if(kind==='media_entry'){
          const r=db.prepare("SELECT i.supplier_reference,o.supplier_name FROM media_spend_commitments m JOIN media_spend_entries e ON e.id=m.entry_id JOIN procurement_invoices i ON i.id=m.invoice_id JOIN procurement_orders o ON o.purchase_id=m.purchase_id WHERE m.entry_id=? AND e.tenant_id=?").get(reference,tenant_id);
          return r?{conflict:`فاتورة المورد ${r.supplier_reference} من ${r.supplier_name}`}:null;
        }
        if(kind==='supplier_invoice'){
          const r=db.prepare('SELECT e.spend_date FROM media_spend_commitments m JOIN media_spend_entries e ON e.id=m.entry_id WHERE m.invoice_id=? AND e.tenant_id=?').get(reference,tenant_id);
          return r?{conflict:`صرف إعلامي مسجَّل على المشروع بتاريخ ${r.spend_date}`}:null;
        }
        return null;
      };
      // نقطة الصحة (TP2.6): خلف تصريح إدارة المنصة، لا مفتوحة. المنفذ يصله نفقٌ عنوانه عام،
      // فنقطةُ صحةٍ بلا جلسة تكشف مستوى الترحيل وبصمة المخطط وعمر آخر نسخة لمن بلغ العنوان.
      // و«آخر verifyAudit» يُقرأ ولا يُعاد حسابه: التحقق يمشي سجل التدقيق كله، ونقطةُ صحةٍ تُثقل المنصة ليست صحة.
      if(p==='/api/health'&&req.method==='GET') {
        access.require(db,u,'platform.flags');
        send(200,healthSnapshot({migration:db.prepare('SELECT MAX(version) v FROM schema_migrations').get().v,
          schemaDigest:null,auditChecked:auditCheckedAtBoot,environment,startedAt,build:buildAtBoot,
          backupDirs:[resolve(root,'work/backups'),resolve(root,'work/backups/auto')]}));
        return;
      }
      // مركز الأدمن يقرأ الأدلة التي جُمعت خارج الطلب. لا ينفذ نسخًا أو ترحيلًا أو اتصالًا خارجيًا عند فتح الشاشة.
      if(p==='/api/platform-health'&&req.method==='GET') {
        send(200,platformHealth(db,u,{build:buildAtBoot,checks:{...platformChecks,
          audit:platformChecks.audit??(auditCheckedAtBoot?{ok:auditCheckedAtBoot.ok,checked_at:auditCheckedAtBoot.at}:null)}}));
        return;
      }
      if(p==='/api/me'&&req.method==='GET') {send(200,{user:userView(db,u),csrf:auth.session.csrf,environment:environmentBadge(environment),timezone:'Asia/Riyadh'});return;}
      if(p==='/api/service-benchmark'&&req.method==='GET') {access.require(db,u,'requirements.view');if(u.tenant_id!=='36t')fail(404,'not_found','المقارنة غير متاحة لهذا الكيان');send(200,JSON.parse(readFileSync(resolve(root,'docs/research/department-benchmark.json'),'utf8')));return;}
      // العطب 5 في مسح 20 سبتمبر: الإرشاد المكتوب لكل حقل (لماذا يُسأل، وتلميحه، ومثاله) كان يصل لوحة
      // المسؤول وحدها، ويصل الموظفَ الشكلُ المجرد. النموذج يقرأ من هنا، فالإرشاد يُدمج هنا.
      // دليل الخدمات: كل خدمة بزمنها ومصدر ذلك الزمن، وحقولها بمصطلحات التعريفات المنشورة (ترحيل 123).
      if(p==='/api/catalog'&&req.method==='GET') {const terms=definitions.termApplier(db,u.tenant_id);send(200,annotateTargets(db,u.tenant_id,enrichCatalog(annotateCatalog(db,u,wf.catalog(db,u))).map(s=>({...s,fields:terms(s.fields)}))));return;}
      // بطاقات الخيارات: خدمات متقاربة في بطاقة واحدة، والخيار يقرر خدمة الطلب (service-catalog.mjs SERVICE_VARIANTS).
      if(p==='/api/catalog/variants'&&req.method==='GET') {send(200,variantCatalog(db,u));return;}
      // مركز الخدمات (الدفعة الثانية): الشجرة بعدّاداتها المحلولة بجمهور هذا الحساب، من جملة واحدة.
      // الترويسة هي مجموع بطاقات الفئات بالبناء، والموقوف يصل رقمًا ثالثًا مستقلًا لا مطروحًا بالصمت.
      if(p==='/api/catalog/tree'&&req.method==='GET') {send(200,catalogHome.catalogTree(db,u));return;}
      // صفحة الخدمة بلغة الطالب. رمزٌ خارج دليل هذا الحساب يردّ **رفضًا مكتوبًا** يسمّي ما رُفض ومن يملكه والخطوة التالية.
      const servicePagePath=p.match(/^\/api\/catalog\/service\/([A-Za-z0-9-]{3,40})$/);
      if(servicePagePath&&req.method==='GET') {send(200,catalogHome.servicePage(db,u,servicePagePath[1]));return;}
      // لوح شجرة مركز الخدمات (يُقرأ من «إعداد الاعتماد») وصفحة تتبع الرحلة.
      if(p==='/api/catalog/admin'&&req.method==='GET') {send(200,catalogAdmin.catalogAdmin(db,u));return;}
      const journeyPath=p.match(/^\/api\/catalog\/journey\/([a-f0-9-]{36})$/);
      if(journeyPath&&req.method==='GET') {send(200,journeys.journeyRun(db,u,journeyPath[1]));return;}
      if(p==='/api/departments'&&req.method==='GET') {send(200,db.prepare('SELECT id,name,sector FROM departments WHERE tenant_id=? AND active=1 ORDER BY sector,name').all(u.tenant_id));return;}
      if(p==='/api/admin/accounts'&&req.method==='GET') {access.require(db,u,'accounts.manage');send(200,{...admin.adminDirectory(db,u),access:access.accessDirectory(db,u)});return;}
      // المصفوفة تحرس نفسها (الأدمن الأول أو أدمن الإدارة): مسار /api/permissions لا يرث حراسة /api/admin.
      if(p==='/api/permissions-matrix'&&req.method==='GET') {send(200,departmentLevels.matrix(db,u));return;}
      if(p==='/api/employees'&&req.method==='GET') {if(!access.can(db,u,'employees.view')&&!db.prepare('SELECT 1 FROM users WHERE tenant_id=? AND manager_id=? AND active=1').get(u.tenant_id,u.id))access.require(db,u,'employees.view');send(200,{...employees.listEmployees(db,u),expiring_documents:employees.expiringDocuments(db,u)});return;}
      const employeeRecord=p.match(/^\/api\/employees\/([a-z0-9._-]+)$/);
      if(employeeRecord&&req.method==='GET') {send(200,employees.employeeRecord(db,u,employeeRecord[1]));return;}
      // الملف الموحّد: بلا معرّف يفتح ملف صاحب الحساب نفسه، وبمعرّف يفحص employeeProfile الصفةَ (صاحبه أو مديره المباشر
      // أو حامل تصريح السجل الوظيفي) ويرفض ما عداها برفض مكتوب. لا فحص صلاحية هنا يسبق فحص الوحدة فيتناقض معه.
      if(p==='/api/employee-profile'&&req.method==='GET') {send(200,employeeProfile.employeeProfile(db,u,u.id));return;}
      // دليل الموظفين بأعمدة المرجع. الشرط هو شرط /api/employees نفسه: حامل تصريح السجل الوظيفي، أو من يتبعه موظفون.
      if(p==='/api/employee-directory'&&req.method==='GET') {if(!access.can(db,u,'employees.view')&&!db.prepare('SELECT 1 FROM users WHERE tenant_id=? AND manager_id=? AND active=1').get(u.tenant_id,u.id))access.require(db,u,'employees.view');send(200,employeeProfile.employeeDirectory(db,u));return;}
      const employeeProfilePath=p.match(/^\/api\/employee-profile\/([a-z0-9._-]+)$/);
      if(employeeProfilePath&&req.method==='GET') {send(200,employeeProfile.employeeProfile(db,u,employeeProfilePath[1]));return;}
      // بوابة واحدة: executiveOverview يفحص workspace.canReadExecutive (تصريح executive.view)، وهو الشرط نفسه الذي يرسم به زر الرئيسية.
      // تقبل المقصورة فترة واحدة فقط؛ مفاتيح إضافية أو مكررة تُرفض حتى لا تختلف شاشة عن تقرير بسبب معلمة صامتة.
      const executiveOptions=()=>{
        const allowed=new Set(['from','to','cursor']);
        for(const key of url.searchParams.keys())if(!allowed.has(key)||url.searchParams.getAll(key).length!==1)refuse(400,'invalid_query',{
          what:'لا يمكن تشغيل المقصورة بمعلمة غير معروفة أو مكررة',
          next:'استخدم from وto للفترة، وcursor لصفحة التفاصيل فقط'
        });
        const options={};
        if(url.searchParams.has('from'))options.from=url.searchParams.get('from');
        if(url.searchParams.has('to'))options.to=url.searchParams.get('to');
        if(url.searchParams.has('cursor')){
          const cursor=url.searchParams.get('cursor');
          if(!/^\d{1,9}$/.test(cursor))refuse(400,'invalid_cursor',{
            what:'لا يمكن فتح صفحة تفاصيل بمؤشر تنقل غير صالح',
            next:'ارجع إلى أول صفحة من تفاصيل المؤشر ثم تنقل من الأزرار الظاهرة'
          });
          options.cursor=cursor;
        }
        return options;
      };
      if(p==='/api/executive'&&req.method==='GET') {send(200,workspace.executiveOverview(db,u,executiveOptions()));return;}
      const executiveDetail=p.match(/^\/api\/executive\/drilldown\/([a-z0-9._-]{3,80})$/);
      if(executiveDetail&&req.method==='GET') {send(200,executiveDrilldown(db,u,executiveDetail[1],executiveOptions()));return;}
      if(p==='/api/org'&&req.method==='GET') {send(200,workspace.orgChart(db,u));return;}
      if(p==='/api/work'&&req.method==='GET') {const board=workspace.workBoard(db,u,{requests:wf.listRequests(db,u,'',''),projects:projects.listProjects(db,u)}),collaboration=collaborationSpace.spacesForUser(db,u);send(200,{...board,spaces:collaboration.spaces,space_suggestions:collaboration.suggestions});return;}
      if(p==='/api/portal'&&req.method==='GET') {send(200,routing.portal(db,u,{requests:wf.listRequests(db,u,'',''),projects:projects.listProjects(db,u),leave:(()=>{try{return leave.listLeave(db,u);}catch{return null;}})()}));return;}
      if(p==='/api/team'&&req.method==='GET') {send(200,db.prepare('SELECT id,name,role FROM users WHERE tenant_id=? AND active=1 AND (id=? OR manager_id=?)').all(u.tenant_id,u.id,u.id));return;}
      if(p==='/api/requests'&&req.method==='GET') {send(200,wf.listRequests(db,u,url.searchParams.get('q')??'',url.searchParams.get('status')??''));return;}
      if(p==='/api/projects'&&req.method==='GET') {send(200,projects.listProjects(db,u));return;}
      // مساحة العمل الجماعية: كل قراءة تعيد فحص العضوية الفعلية، ولا تُرجع محتوى الملفات الخام ضمن اللوحات.
      if(p==='/api/spaces'&&req.method==='GET') {const kind=url.searchParams.get('kind'),id=url.searchParams.get('id');send(200,kind&&id?collaborationSpace.spaceForTarget(db,u,{kind,id}):collaborationSpace.spacesForUser(db,u));return;}
      const spaceRead=p.match(/^\/api\/spaces\/([a-f0-9-]{36})(?:\/(tasks|files|topics|chat|events|check-ins|people|activity|report))?$/);
      if(spaceRead&&req.method==='GET') {
        const [spaceId,resource]=spaceRead.slice(1);
        if(!resource){send(200,{space:collaborationSpace.spaceById(db,u,spaceId),tasks:collaborationTasks.taskBoard(db,u,spaceId)});return;}
        if(resource==='tasks'){send(200,collaborationTasks.taskBoard(db,u,spaceId));return;}
        if(resource==='files'){send(200,collaborationFiles.filesBoard(db,u,spaceId));return;}
        if(resource==='topics'){send(200,collaborationMessages.messageBoard(db,u,spaceId));return;}
        if(resource==='chat'){send(200,collaborationMessages.chatLines(db,u,spaceId,{limit:url.searchParams.has('limit')?Number(url.searchParams.get('limit')):100,before:url.searchParams.get('before')}));return;}
        if(resource==='events'){send(200,collaborationSchedule.scheduleBoard(db,u,spaceId,{from:url.searchParams.get('from')??undefined,to:url.searchParams.get('to')??undefined}));return;}
        if(resource==='check-ins'){send(200,collaborationCheckins.checkinBoard(db,u,spaceId));return;}
        if(resource==='people'){const actor=collaborationAccess.collaborationActor(db,u,spaceId);send(200,{people:collaborationAccess.spacePeople(db,u,spaceId),can_manage:actor.capabilities.includes('space.people')});return;}
        if(resource==='activity'){send(200,collaborationReports.activityFeed(db,u,spaceId,{cursor:url.searchParams.has('cursor')?Number(url.searchParams.get('cursor')):null,limit:url.searchParams.has('limit')?Number(url.searchParams.get('limit')):50}));return;}
        if(resource==='report'){send(200,collaborationReports.workspaceReport(db,u,spaceId,{from:url.searchParams.get('from')??undefined,to:url.searchParams.get('to')??undefined}));return;}
      }
      const workspaceDownload=p.match(/^\/api\/spaces\/([a-f0-9-]{36})\/files\/([a-f0-9-]{36})\/download$/);
      if(workspaceDownload&&req.method==='GET') {
        const version=url.searchParams.has('version')?Number(url.searchParams.get('version')):null;
        const file=collaborationFiles.downloadWorkspaceFile(db,u,workspaceDownload[1],workspaceDownload[2],{version});
        res.writeHead(200,{...headers,'Cache-Control':'private, no-store','Content-Type':'application/octet-stream','Content-Security-Policy':"sandbox; default-src 'none'",'Content-Disposition':`attachment; filename="file"; filename*=UTF-8''${encodeURIComponent(file.filename)}`,'Content-Length':file.content.length});res.end(file.content);return;
      }
      if(p==='/api/project-axes'&&req.method==='GET') {send(200,projectAxes.axesBoard(db,u));return;}
      if(p==='/api/project-participation'&&req.method==='GET') {send(200,projectAxes.participationBoard(db,u));return;}
      // مسار المشاريع: المحاور الثمانية والخطوة الجاية وصاحبها وحزم العمل بأزرار القارئ (الموجة 5 «سلسلة المشروع»).
      if(p==='/api/project-spine'&&req.method==='GET') {send(200,projectAxes.spineBoard(db,u));return;}
      // لوحة الإقفال: مشاريع القارئ، وما ينتظر الإقفال المالي أو قبول الهامش لمن يحمل سلطتهما (ترحيل 163).
      if(p==='/api/project-closures'&&req.method==='GET') {send(200,projectAxes.closureBoard(db,u));return;}
      const projectAxesRead=p.match(/^\/api\/projects\/([a-f0-9-]+)\/axes$/);
      if(projectAxesRead&&req.method==='GET') {send(200,projectAxes.axesFor(db,u,projectAxesRead[1]));return;}
      // شهادة الإنجاز (ترحيل 164): اللوحة لا ترفض أحدًا — من لا مشروع تجاريًا له تعود لوحته فارغة فلا تنكسر شاشة «العملاء والعروض».
      if(p==='/api/completion-certificates'&&req.method==='GET') {send(200,certificates.certificatesBoard(db,u));return;}
      const certificateRead=p.match(/^\/api\/completion-certificates\/([a-f0-9-]{36})$/);
      if(certificateRead&&req.method==='GET') {send(200,certificates.getCompletionCertificate(db,u,certificateRead[1]));return;}
      // المستند يُولَّد من السجل عند الطلب بشكل مستندات المنصة، ويحفظه المستخدم PDF من المتصفح إن احتاج أن يسلّمه.
      const certificateDocument=p.match(/^\/api\/completion-certificates\/([a-f0-9-]{36})\/document$/);
      if(certificateDocument&&req.method==='GET') {const html=certificates.certificateDocument(certificates.getCompletionCertificate(db,u,certificateDocument[1]),tenantIdentity.tenantDemoFlag(db,u.tenant_id));res.writeHead(200,{...headers,'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'});res.end(html);return;}
      // تقرير الإدارة التنفيذية للمشاريع (ترحيل 118): الفترة اختيارية، وتُمرَّر بمفتاحيها معًا أو لا تُمرَّر.
      if(p==='/api/epmo'&&req.method==='GET') {send(200,epmoBoard(db,u,url.searchParams.has('period_from')||url.searchParams.has('period_to')?{period_from:url.searchParams.get('period_from')??'',period_to:url.searchParams.get('period_to')??''}:{}));return;}
      if(p==='/api/notifications'&&req.method==='GET') {send(200,wf.notifications(db,u,{limit:url.searchParams.has('limit')?Number(url.searchParams.get('limit')):undefined,before:url.searchParams.get('before'),unread:url.searchParams.get('unread')==='1'}));return;}
      if(p==='/api/notifications/unread-count'&&req.method==='GET') {send(200,wf.unreadCount(db,u));return;}
      if(p==='/api/notification-settings'&&req.method==='GET') {send(200,delivery.preferencesView(db,u));return;}
      if(p==='/api/mail'&&req.method==='GET') {send(200,delivery.mailBoard(db,u));return;}
      // شارة غير المقروء (101) تقرأ العدد نفسه الذي يعرضه جدول الإشعارات (100): ما يراه صاحبه فقط.
      if(p==='/api/notifications/count'&&req.method==='GET') {send(200,{unread:wf.unreadCount(db,u).unread});return;}
      // «طلباتي» و«ملفي»: لصاحبها. الملف يفتحه غيره موظف الموارد البشرية وحده (my-profile.mjs).
      if(p==='/api/my-requests'&&req.method==='GET') {send(200,myRequests(db,u));return;}
      if(p==='/api/profile'&&req.method==='GET') {send(200,profileView(db,u));return;}
      const profileOf=p.match(/^\/api\/profile\/([a-z0-9._-]{1,64})$/);
      if(profileOf&&req.method==='GET') {send(200,profileView(db,u,profileOf[1]));return;}
      if(p==='/api/delegations'&&req.method==='GET') {send(200,delegations.listDelegations(db,u));return;}
      if(p==='/api/commercial'&&req.method==='GET') {send(200,commercial.listCommercial(db,u));return;}
      // الحزمة 4 — العملاء (الترحيلان 180 و181): تعارض ملف العميل قبل الحفظ، وملخص الصفقة، ومصدر نموذج التسليم المشتق من الصفقة.
      if(p==='/api/clients/conflicts'&&req.method==='GET') {send(200,agency.clientConflicts(db,u,Object.fromEntries(['legal_name','trade_name','registration_number'].filter(k=>url.searchParams.has(k)).map(k=>[k,url.searchParams.get(k)]))));return;}
      const dealRead=p.match(/^\/api\/commercial\/([a-f0-9-]{36})\/summary$/);
      if(dealRead&&req.method==='GET') {send(200,commercial.dealSummary(db,u,dealRead[1]));return;}
      const handoverSourceRead=p.match(/^\/api\/project-intake\/handover-source\/([a-f0-9-]{36})$/);
      if(handoverSourceRead&&req.method==='GET') {send(200,projectIntake.handoverSource(db,u,handoverSourceRead[1]));return;}
      if(p==='/api/technical-proposal-reviews'&&req.method==='GET') {send(200,technicalProposal.proposalReviewBoard(db,u));return;}
      if(p==='/api/procurement'&&req.method==='GET') {send(200,procurement.listProcurement(db,u));return;}
      if(p==='/api/procurement-rfqs'&&req.method==='GET') {send(200,procurementRfq.listFinanceRfqs(db,u));return;}
      if(p==='/api/procurement-extras'&&req.method==='GET') {send(200,{...procurementExtras.procurementExtras(db,u),purchases:procurement.listProcurement(db,u)});return;}
      if(p==='/api/reports'&&req.method==='GET') {send(200,{...reports.reportsIndex(db,u),...reportSchedules.schedulesFor(db,u)});return;}
      // مفتاح التقرير حرف ورقمان: R للتقارير الجدولية وE للتقرير المركّب. حصرُه في R\d{2} يجعل E01
      // يرد 404 على التشغيل واللقطة والتصدير والطباعة معًا، فيبدو التقرير مبنيًّا وهو غير قابل للفتح.
      const reportFile=p.match(/^\/api\/reports\/(?:([A-Z]\d{2})|snapshots\/([a-f0-9-]+))\/(export\.xlsx|export\.csv|print)$/);
      if(reportFile&&req.method==='GET') {
        // الصلاحية تُفحص هنا أيضًا: رابط التصدير لا يتجاوز ما يراه صاحبه على الشاشة.
        const result=reportFile[1]?reports.runReport(db,u,reportFile[1],{from:url.searchParams.get('from')??undefined,to:url.searchParams.get('to')??undefined}):reports.readSnapshot(db,u,reportFile[2]);
        audit(db,u,'report',result.key,'report.exported',{}, {format:reportFile[3],...result.params,snapshot:reportFile[2]??null});
        if(reportFile[3]==='print'){res.writeHead(200,{...headers,'Content-Type':'text/html; charset=utf-8'});res.end(reports.printable(result));return;}
        const file=reports.exportReport(result,reportFile[3]==='export.xlsx'?'xlsx':'csv');
        res.writeHead(200,{...headers,'Content-Type':file.type,'Content-Disposition':`attachment; filename="${file.filename}"`,'Content-Length':file.content.length});res.end(file.content);return;
      }
      if(p==='/api/campaigns'&&req.method==='GET') {send(200,campaigns.campaignsBoard(db,u));return;}
      if(p==='/api/content'&&req.method==='GET') {send(200,campaigns.contentBoard(db,u,url.searchParams.get('month')??undefined));return;}
      if(p==='/api/scope'&&req.method==='GET') {send(200,campaigns.scopeBoard(db,u));return;}
      if(p==='/api/clients'&&req.method==='GET') {send(200,agency.clientsBoard(db,u));return;}
      if(p==='/api/client-support'&&req.method==='GET') {send(200,clientSupport.supportBoard(db,u));return;}
      if(p==='/api/offerings'&&req.method==='GET') {send(200,agency.offeringsBoard(db,u));return;}
      if(p==='/api/project-templates'&&req.method==='GET') {send(200,agency.templatesBoard(db,u));return;}
      if(p==='/api/time'&&req.method==='GET') {send(200,agency.timeBoard(db,u,url.searchParams.get('week')??undefined));return;}
      if(p==='/api/expenses'&&req.method==='GET') {send(200,expenses.expensesBoard(db,u));return;}
      if(p==='/api/assets'&&req.method==='GET') {send(200,fixedAssets.assetsBoard(db,u));return;}
      if(p==='/api/payroll/extras'&&req.method==='GET') {send(200,{...payrollExtras.extrasBoard(db,u),retro:payrollRetro.retroCandidates(db,u)});return;}
      const transferFile=p.match(/^\/api\/payroll\/payments\/([a-f0-9-]+)\/file$/);
      if(transferFile&&req.method==='GET') {
        const file=payrollExtras.payrollPaymentFile(db,u,transferFile[1]);
        res.writeHead(200,{...headers,'Content-Type':'text/csv; charset=utf-8','Content-Disposition':`attachment; filename="${file.filename}"`,'X-Simulation-Status':file.integration_status??'simulated'});res.end(file.content);return;
      }
      if(p==='/api/payables'&&req.method==='GET') {send(200,payables.listPayables(db,u));return;}
      if(p==='/api/appearance'&&req.method==='GET') {send(200,preferences.appearanceView(db,u));return;}
      if(p==='/api/account/totp'&&req.method==='GET') {send(200,{...totp.totpStatus(db,u),policy:totp.securityPolicy(db,u),idle:sessionPolicy.idlePolicyView(db,u),tenant_data:tenantIdentity.tenantDataView(db,u)});return;}
      if(p==='/api/inbox'&&req.method==='GET') {send(200,inbox(db,u));return;}
      if(p==='/api/inbox/count'&&req.method==='GET') {send(200,inboxCount(db,u));return;}
      if(p==='/api/compliance'&&req.method==='GET') {send(200,compliance.complianceBoard(db,u));return;}
      if(p==='/api/service-cards'&&req.method==='GET') {send(200,serviceCards.cardsBoard(db,u));return;}
      if(p==='/api/centres'&&req.method==='GET') {send(200,centres.centresBoard(db,u));return;}
      if(p==='/api/ai'&&req.method==='GET') {send(200,ai.aiBoard(db,u));return;}
      if(p==='/api/ai/quality'&&req.method==='GET') {send(200,ai.qualityCheck(db,u));return;}
      if(p==='/api/performance'&&req.method==='GET') {send(200,talent.performanceBoard(db,u));return;}
      if(p==='/api/growth'&&req.method==='GET') {const board=talent.growthBoard(db,u);send(200,{...board,profile:career.careerProfile(db,u),pending_qualifications:career.pendingQualifications(db,u),team_profiles:board.team.map(m=>{try{return career.careerProfile(db,u,m.id);}catch{return null;}}).filter(Boolean)});return;}
      if(p==='/api/hr/operations'&&req.method==='GET') {send(200,hrOperations.operationsBoard(db,u));return;}
      const generalSurveyExport=p.match(/^\/api\/hr\/general-surveys\/([a-f0-9-]{36})\/export$/);
      if(generalSurveyExport&&req.method==='GET') {send(200,hrOperations.generalSurveyExport(db,u,generalSurveyExport[1]));return;}
      if(p==='/api/files'&&req.method==='GET') {send(200,files.filesIndex(db,u,url.searchParams.get('entity_type'),(url.searchParams.get('ids')??'').split(',').filter(Boolean)));return;}
      const storedFile=p.match(/^\/api\/files\/([a-f0-9-]{36})$/);
      if(storedFile&&req.method==='GET') {
        const f=transaction(db,()=>files.downloadFile(db,u,storedFile[1]));
        res.writeHead(200,{...headers,'Content-Type':'application/octet-stream','Content-Security-Policy':"sandbox; default-src 'none'",'X-Content-Type-Options':'nosniff','Content-Disposition':`attachment; filename="file"; filename*=UTF-8''${encodeURIComponent(f.filename)}`,'Content-Length':f.content.length});res.end(f.content);return;
      }
      if(p==='/api/ledger/statements'&&req.method==='GET') {send(200,ledger.statements(db,u,{from:url.searchParams.get('from')??undefined,to:url.searchParams.get('to')??undefined}));return;}
      // الحزمة 3 (app/ledger.mjs): مطابقة الأستاذ المساعد بالحساب الرقابي، وتتبّع المبلغ. قراءة فقط، لمن يحمل تفويض القراءة المالية.
      if(p==='/api/ledger/reconciliation'&&req.method==='GET') {send(200,ledger.controlBoard(db,u,Object.fromEntries(['to','period_id'].filter(k=>url.searchParams.has(k)).map(k=>[k,url.searchParams.get(k)]))));return;}
      if(p==='/api/ledger/trace'&&req.method==='GET') {send(200,ledger.traceAmount(db,u,{kind:url.searchParams.get('kind')??undefined,id:url.searchParams.get('id')??undefined}));return;}
      if(p==='/api/payroll'&&req.method==='GET') {const board=payroll.listPayroll(db,u);send(200,{...board,runs:board.runs.map(r=>({...r,checks:preRunChecks(db,u,r)}))});return;}
      const printed=p.match(/^\/api\/(invoices|payroll\/payslips)\/([a-f0-9-]{36})\/print$/);
      if(printed&&req.method==='GET') {
        // فتح القسيمة للطباعة فتحٌ مسجل كغيره.
        const demoData=tenantIdentity.tenantDemoFlag(db,u.tenant_id);
        const html=printed[1]==='invoices'?invoicePrintable(invoices.getInvoice(db,u,printed[2]),demoData):payslipPrintable(transaction(db,()=>payroll.viewPayslip(db,u,printed[2])),{name:u.name,department:db.prepare('SELECT name FROM departments WHERE id=? AND tenant_id=?').get(u.department_id,u.tenant_id)?.name??''},demoData);
        res.writeHead(200,{...headers,'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'});res.end(html);return;
      }
      const payslip=p.match(/^\/api\/payroll\/payslips\/([a-f0-9-]+)$/);
      if(payslip&&req.method==='GET') {send(200,payroll.viewPayslip(db,u,payslip[1]));return;}
      // D-15: المغادر يقرأ تسويته المعتمدة. لا معرّف في المسار: الصفحة لصاحبها، وكل فتح صريح يُسجَّل.
      if(p==='/api/payroll/settlements/mine'&&req.method==='GET') {
        const mine=payrollExtras.mySettlement(db,u,{log:true});
        if(!mine)fail(404,'not_found','لا توجد تسوية نهاية خدمة معتمدة باسمك');
        send(200,mine);return;
      }
      if(p==='/api/attendance'&&req.method==='GET') {send(200,{...attendance.attendanceBoard(db,u,url.searchParams.get('month')??undefined),extras:attendanceExtras.attendanceExtras(db,u),rules:attendanceRules.rulesBoard(db,u)});return;}
      // قواعد الحضور (099): تقرير النقص الأسبوعي، ودفتر الشهر لكل موظف بصيغة Excel.
      if(p==='/api/attendance/shortfall'&&req.method==='GET') {send(200,attendanceRules.shortfallReport(db,u,url.searchParams.get('week')??undefined));return;}
      if(p==='/api/attendance/workbook.xlsx'&&req.method==='GET') {
        const file=transaction(db,()=>attendanceRules.monthlyWorkbook(db,u,url.searchParams.get('month')??''));
        res.writeHead(200,{...headers,'Content-Type':file.type,'Content-Disposition':`attachment; filename="${file.filename}"`,'Content-Length':file.content.length});res.end(file.content);return;
      }
      if(p==='/api/hr/contracts'&&req.method==='GET') {send(200,hrContracts.listContracts(db,u));return;}
      if(p==='/api/invoices'&&req.method==='GET') {send(200,invoices.listInvoices(db,u));return;}
      if(p==='/api/approvals'&&req.method==='GET') {send(200,clientApprovals.listApprovals(db,u));return;}
      if(p==='/api/vendors'&&req.method==='GET') {send(200,vendors.listVendors(db,u));return;}
      if(p==='/api/leave'&&req.method==='GET') {send(200,leave.listLeave(db,u));return;}
      if(p==='/api/overview'&&req.method==='GET') {send(200,overview(db,u));return;}
      if(p==='/api/people'&&req.method==='GET') {send(200,people.listPeople(db,u));return;}
      if(p==='/api/studio'&&req.method==='GET') {send(200,studio.listStudio(db,u));return;}
      if(p==='/api/budgets'&&req.method==='GET'){send(200,budgets.listBudgets(db,u));return;}
      if(p==='/api/finance'&&req.method==='GET') {send(200,finance.listFinance(db,u));return;}
      // منح التفويض المالي (تدقيق 20260920، B4): finance_grants كان يُقرأ ولا يكتبه أي مسار.
      if(p==='/api/finance-grants'&&req.method==='GET') {send(200,financeGrants.financeGrantsBoard(db,u));return;}
      if(p==='/api/receivables'&&req.method==='GET') {send(200,receivables.listReceivables(db,u));return;}
      if(p==='/api/requirements'&&req.method==='GET') {access.require(db,u,'requirements.view');
        const document=JSON.parse(readFileSync(resolve(root,'docs/implementation/REQUIREMENTS.json'),'utf8'));
        if(document.tenant_id!==u.tenant_id)fail(404,'not_found','سجل النطاق غير متاح لهذا الكيان');
        send(200,document.requirements.map(r=>({id:r.id,domain:r.domain,title:r.title,acceptance:r.acceptance,priority:r.priority,implementation_status:r.implementation.status,coverage:r.implementation.coverage})));return;
      }
      if(p==='/api/integrations'&&req.method==='GET') {
        access.require(db,u,'integrations.view');send(200,integrationReadiness(db,u));return;
      }
      // ——— الوحدات الجديدة: القراءة (docs/implementation/WIRING-SPEC.md) ———
      // المطابقة البنكية
      if(p==='/api/bank-reconciliation'&&req.method==='GET') {send(200,bank.bankBoard(db,u,url.searchParams.has('bank_account_id')?{bank_account_id:url.searchParams.get('bank_account_id')}:{}));return;}
      if(p==='/api/bank-reconciliation/statement'&&req.method==='GET') {send(200,bank.reconciliationStatement(db,u,{bank_account_id:url.searchParams.get('bank_account_id')??'',period_start:url.searchParams.get('period_start')??'',period_end:url.searchParams.get('period_end')??''}));return;}
      const bankSuggest=p.match(/^\/api\/bank-reconciliation\/transactions\/([a-f0-9-]{36})\/suggestions$/);
      if(bankSuggest&&req.method==='GET') {send(200,bank.suggestMatches(db,u,bankSuggest[1],url.searchParams.has('window_days')?{window_days:Number(url.searchParams.get('window_days'))}:{}));return;}
      // الفوترة الدورية والاشتراكات
      if(p==='/api/billing-schedules'&&req.method==='GET') {send(200,billingRecurring.schedulesBoard(db,u));return;}
      if(p==='/api/retainers'&&req.method==='GET') {send(200,billingRecurring.retainersBoard(db,u));return;}
      if(p==='/api/deferred-revenue'&&req.method==='GET') {send(200,billingRecurring.deferredRevenue(db,u,url.searchParams.get('as_of')??undefined));return;}
      // التنبؤ النقدي والإقفال والإطفاء
      if(p==='/api/cash-forecast'&&req.method==='GET') {send(200,cashForecast.cashForecastBoard(db,u));return;}
      if(p==='/api/close-checklist'&&req.method==='GET') {send(200,closeChecklist.closeBoard(db,u));return;}
      if(p==='/api/finance-exceptions'&&req.method==='GET') {send(200,financeExceptions.exceptionsBoard(db,u));return;}
      if(p==='/api/options'&&req.method==='GET') {send(200,options.optionsBoard(db,u));return;}
      // حزمة تدقيق الفترة: تنزيل ملف، والتصدير نفسه حدثٌ في سلسلة التدقيق (معاملة قصيرة).
      if(p==='/api/audit-export'&&req.method==='GET') {
        const pkg=transaction(db,()=>auditExport.exportAuditPackage(db,u,Object.fromEntries(['from','to','month'].filter(k=>url.searchParams.has(k)).map(k=>[k,url.searchParams.get(k)]))));
        res.writeHead(200,{...headers,'Content-Type':'application/json; charset=utf-8','Content-Disposition':`attachment; filename="audit-${pkg.scope.tenant_id}-${pkg.scope.from}-${pkg.scope.to}.json"`});res.end(JSON.stringify(pkg));return;
      }
      const closePeriodView=p.match(/^\/api\/close-checklist\/periods\/([a-f0-9-]{36})$/);
      if(closePeriodView&&req.method==='GET') {send(200,closeChecklist.getClosePeriod(db,u,closePeriodView[1]));return;}
      if(p==='/api/accruals'&&req.method==='GET') {send(200,accruals.accrualsBoard(db,u));return;}
      const accrualView=p.match(/^\/api\/accruals\/([a-f0-9-]{36})$/);
      if(accrualView&&req.method==='GET') {send(200,accruals.getSchedule(db,u,accrualView[1]));return;}
      // سجل العقود
      if(p==='/api/contracts-register'&&req.method==='GET') {send(200,contractsRegister.contractsRegisterBoard(db,u));return;}
      // سلسلة استلام المشروع: BD-04 وPM-01 وPM-02 وPM-03 (ترحيل 109)
      if(p==='/api/project-intake'&&req.method==='GET') {send(200,projectIntake.intakeBoard(db,u));return;}
      const intakeGate=p.match(/^\/api\/project-intake\/gate\/([a-f0-9-]{36})\/(scoping|paid_execution)$/);
      if(intakeGate&&req.method==='GET') {send(200,projectIntake.executionGate(db,u,intakeGate[1],intakeGate[2]));return;}
      // النبض والتقدير والإعلانات
      if(p==='/api/engagement/pulse'&&req.method==='GET') {send(200,engagement.pulseBoard(db,u));return;}
      if(p==='/api/engagement/recognition'&&req.method==='GET') {send(200,engagement.recognitionBoard(db,u));return;}
      if(p==='/api/engagement/announcements'&&req.method==='GET') {send(200,engagement.announcementsBoard(db,u));return;}
      const announcementFile=p.match(/^\/api\/engagement\/announcements\/files\/([a-f0-9-]{36})$/);
      if(announcementFile&&req.method==='GET') {
        const f=transaction(db,()=>engagement.downloadAnnouncementFile(db,u,announcementFile[1]));
        res.writeHead(200,{...headers,'Content-Type':'application/octet-stream','Content-Security-Policy':"sandbox; default-src 'none'",'X-Content-Type-Options':'nosniff','Content-Disposition':`attachment; filename="file"; filename*=UTF-8''${encodeURIComponent(f.filename)}`,'Content-Length':f.content.length});res.end(f.content);return;
      }
      // اللقاءات الفردية والتغذية الراجعة و360
      if(p==='/api/one-to-ones'&&req.method==='GET') {send(200,feedback.oneToOnesBoard(db,u));return;}
      if(p==='/api/feedback'&&req.method==='GET') {send(200,feedback.feedbackBoard(db,u));return;}
      if(p==='/api/review-360'&&req.method==='GET') {send(200,feedback.review360Board(db,u));return;}
      const feedbackEvidence=p.match(/^\/api\/feedback\/evidence\/([a-f0-9-]{36})$/);
      if(feedbackEvidence&&req.method==='GET') {send(200,feedback.feedbackEvidence(db,u,feedbackEvidence[1]));return;}
      // الأهداف والمخاطر والقرارات
      if(p==='/api/governance/objectives'&&req.method==='GET') {send(200,governance.objectivesBoard(db,u));return;}
      if(p==='/api/governance/risks'&&req.method==='GET') {send(200,governance.risksBoard(db,u));return;}
      if(p==='/api/governance/decisions'&&req.method==='GET') {send(200,governance.decisionsBoard(db,u));return;}
      // الرئيسية ومراقبة الانتهاء
      if(p==='/api/home'&&req.method==='GET') {send(200,home.homeBoard(db,u));return;}
      if(p==='/api/expiry'&&req.method==='GET') {send(200,expiry.expiryBoard(db,u));return;}
      // المؤثرون
      if(p==='/api/influencers'&&req.method==='GET') {send(200,influencers.influencersBoard(db,u));return;}
      if(p==='/api/influencer-campaigns'&&req.method==='GET') {send(200,influencers.influencerCampaignsBoard(db,u));return;}
      // استحقاق الإجازات والمزايا
      if(p==='/api/leave-accrual'&&req.method==='GET') {send(200,leaveAccrual.accrualBoard(db,u));return;}
      const accrualSettlement=p.match(/^\/api\/leave-accrual\/settlement\/([a-z0-9._-]+)$/);
      if(accrualSettlement&&req.method==='GET') {send(200,leaveAccrual.accrualSettlementView(db,u,accrualSettlement[1]));return;}
      if(p==='/api/benefits'&&req.method==='GET') {send(200,benefits.benefitsBoard(db,u));return;}
      // «مزاياي» وإدارة المزايا (ترحيل 103)
      if(p==='/api/my-benefits'&&req.method==='GET') {send(200,benefitsPortal.myBenefits(db,u,url.searchParams.get('employee')??undefined));return;}
      if(p==='/api/benefits-admin'&&req.method==='GET') {send(200,benefitsPortal.benefitsAdmin(db,u));return;}
      const benefitDocument=p.match(/^\/api\/my-benefits\/documents\/([a-f0-9-]{36})$/);
      if(benefitDocument&&req.method==='GET') {
        const f=transaction(db,()=>benefitsPortal.downloadBenefitDocument(db,u,benefitDocument[1]));
        res.writeHead(200,{...headers,'Content-Type':'application/octet-stream','Content-Security-Policy':"sandbox; default-src 'none'",'X-Content-Type-Options':'nosniff','Content-Disposition':`attachment; filename="file"; filename*=UTF-8''${encodeURIComponent(f.filename)}`,'Content-Length':f.content.length});res.end(f.content);return;
      }
      // الخطابات
      if(p==='/api/letters'&&req.method==='GET') {send(200,letters.lettersBoard(db,u));return;}
      // قواعد اللائحة في الرواتب، والاستقالة، والانتداب (الترحيل 102).
      if(p==='/api/payroll-rules'&&req.method==='GET') {send(200,payrollRules.rulesBoard(db,u));return;}
      // حالات التأمينات لكل موظف: مشتقة من الجنسية وتاريخ المباشرة، واستثناءاتها المسجلة (الترحيل 127).
      if(p==='/api/payroll-insurance'&&req.method==='GET') {send(200,payrollInsurance.insuranceBoard(db,u));return;}
      // المسير الموازي: الشهور الموازية ودفعات النظام السابق والمقارنة وفروقها وجاهزية الانتقال (الترحيل 176).
      if(p==='/api/payroll-parallel'&&req.method==='GET') {send(200,payrollParallel.parallelBoard(db,u));return;}
      // شاشة واحدة لكل سياسات الموارد البشرية وقائمة جاهزيتها. قراءة فقط: القبول والرفض في نقاط النهاية الأصلية.
      if(p==='/api/hr-policies'&&req.method==='GET') {send(200,hrPolicies.hrPolicyBoard(db,u));return;}
      if(p==='/api/resignations'&&req.method==='GET') {send(200,resignations.resignationsBoard(db,u));return;}
      if(p==='/api/travel'&&req.method==='GET') {send(200,travel.travelBoard(db,u));return;}
      // تعميم الانتداب والمزايا الثلاث (الترحيل 112).
      if(p==='/api/secondment'&&req.method==='GET') {send(200,secondmentBenefits.secondmentBoard(db,u));return;}
      if(p==='/api/benefit-extras'&&req.method==='GET') {send(200,secondmentBenefits.benefitExtrasBoard(db,u,url.searchParams.get('employee_id')??undefined));return;}
      if(p==='/api/letters/templates'&&req.method==='GET') {send(200,letters.templatesBoard(db,u));return;}
      const letterPrint=p.match(/^\/api\/letters\/([a-f0-9-]{36})\/print$/);
      if(letterPrint&&req.method==='GET') {const html=letters.letterPrintable(letters.letterDocument(db,u,letterPrint[1]),tenantIdentity.tenantDemoFlag(db,u.tenant_id));res.writeHead(200,{...headers,'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'});res.end(html);return;}
      // العلاقات العامة والمعدات
      if(p==='/api/pr'&&req.method==='GET') {send(200,pr.prBoard(db,u,{client_id:url.searchParams.get('client_id')??undefined,campaign_id:url.searchParams.get('campaign_id')??undefined}));return;}
      if(p==='/api/media-contacts'&&req.method==='GET') {send(200,pr.mediaContactsBoard(db,u));return;}
      if(p==='/api/pr/report'&&req.method==='GET') {send(200,pr.coverageReport(db,u,{client_id:url.searchParams.get('client_id')??undefined,campaign_id:url.searchParams.get('campaign_id')??undefined}));return;}
      if(p==='/api/equipment'&&req.method==='GET') {send(200,equipment.equipmentBoard(db,u,{days:Number(url.searchParams.get('days'))||undefined}));return;}
      const equipmentQr=p.match(/^\/api\/equipment\/items\/([a-f0-9-]{36})\/qr$/);
      if(equipmentQr&&req.method==='GET') {const qr=equipment.itemQr(db,u,equipmentQr[1]);if(url.searchParams.get('format')==='svg'){res.writeHead(200,{...headers,'Content-Type':'image/svg+xml; charset=utf-8'});res.end(qr.svg);return;}send(200,qr);return;}
      const equipmentPhoto=p.match(/^\/api\/equipment\/photos\/([a-f0-9-]{36})$/);
      if(equipmentPhoto&&req.method==='GET') {const f=transaction(db,()=>equipment.movementPhoto(db,u,equipmentPhoto[1]));const bytes=Buffer.from(f.content);res.writeHead(200,{...headers,'Content-Type':f.media_type,'Content-Security-Policy':"sandbox; default-src 'none'",'X-Content-Type-Options':'nosniff','Content-Disposition':`attachment; filename="photo"; filename*=UTF-8''${encodeURIComponent(f.label??'photo')}`,'Content-Length':bytes.length});res.end(bytes);return;}
      // حماية البيانات الشخصية
      if(p==='/api/privacy'&&req.method==='GET') {send(200,privacy.privacyBoard(db,u));return;}
      if(p==='/api/subject-requests'&&req.method==='GET') {send(200,privacy.subjectRequestsBoard(db,u));return;}
      // الإنتاج وأوراق الاستدعاء
      if(p==='/api/productions'&&req.method==='GET') {send(200,production.productionsBoard(db,u));return;}
      if(p==='/api/call-sheets'&&req.method==='GET') {send(200,production.callSheetsBoard(db,u));return;}
      const callSheetPrint=p.match(/^\/api\/call-sheets\/([a-f0-9-]{36})\/print$/);
      if(callSheetPrint&&req.method==='GET') {const html=production.callSheetPrintable(production.getCallSheet(db,u,callSheetPrint[1]),tenantIdentity.tenantDemoFlag(db,u.tenant_id));res.writeHead(200,{...headers,'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'});res.end(html);return;}
      // معدلات التكلفة والربحية (اللوحة ترفض أي مفتاح خارج الأربعة، فلا يُمرَّر إلا الموجود)
      if(p==='/api/cost-rates'&&req.method==='GET') {send(200,profitability.costRatesBoard(db,u));return;}
      if(p==='/api/profitability'&&req.method==='GET') {send(200,profitability.profitabilityBoard(db,u,Object.fromEntries(['project_id','client_id','from','to'].filter(k=>url.searchParams.has(k)).map(k=>[k,url.searchParams.get(k)]))));return;}
      // كشوف الوقت وتخطيط الموارد
      if(p==='/api/timesheets'&&req.method==='GET') {send(200,timesheets.timesheetsBoard(db,u,url.searchParams.get('week')??undefined));return;}
      const timesheetView=p.match(/^\/api\/timesheets\/([a-f0-9-]{36})$/);
      if(timesheetView&&req.method==='GET') {send(200,timesheets.getPeriod(db,u,timesheetView[1]));return;}
      if(p==='/api/resourcing'&&req.method==='GET') {send(200,resourcing.resourcingBoard(db,u,{from:url.searchParams.get('from')||undefined,to:url.searchParams.get('to')||undefined}));return;}
      if(p==='/api/resourcing/capacity'&&req.method==='GET') {send(200,resourcing.capacityBoard(db,u,{from:url.searchParams.get('from')||undefined,to:url.searchParams.get('to')||undefined}));return;}
      const resourcingBookingView=p.match(/^\/api\/resourcing\/bookings\/([a-f0-9-]{36})$/);
      if(resourcingBookingView&&req.method==='GET') {send(200,resourcing.getBooking(db,u,resourcingBookingView[1]));return;}
      // المراجعة الإبداعية: المادة تُعرض داخل الصفحة (صورة، فيديو، PDF في إطار)، فترويساتها تختلف عن /api/files عمدًا
      // ولهذا الرد وحده: النوع الحقيقي المتحقق من توقيعه عند الرفع، inline، والإطار مسموح من المصدر نفسه فقط.
      const reviewMediaFile=p.match(/^\/api\/review-rounds\/media\/([a-f0-9-]{36})$/);
      if(reviewMediaFile&&req.method==='GET') {
        // القراءة وحدث تدقيقها في معاملة واحدة (P4-PORTAL-2): تدقيقٌ يتعذر لا يخرج بعده بايت.
        const f=transaction(db,()=>reviewRounds.previewMedia(db,u,reviewMediaFile[1]));
        const shown=['image/png','image/jpeg','video/mp4','application/pdf'].includes(f.media_type);
        res.writeHead(200,{...headers,'Content-Type':f.media_type,'X-Content-Type-Options':'nosniff',
          'Content-Disposition':`${shown?'inline':'attachment'}; filename="material"; filename*=UTF-8''${encodeURIComponent(f.filename||'material')}`,
          'X-Frame-Options':'SAMEORIGIN','Content-Security-Policy':"default-src 'none'; img-src 'self'; media-src 'self'; object-src 'self'; frame-src 'self'; style-src 'unsafe-inline'; frame-ancestors 'self'; base-uri 'none'; form-action 'none'",
          'Content-Length':f.content.length});
        res.end(f.content);return;
      }
      if(p==='/api/review-rounds'&&req.method==='GET') {send(200,reviewRounds.reviewBoard(db,u));return;}
      // البحث الشامل: إعادة بناء الفهرس (كتابة) في معاملة قصيرة ثم القراءة
      if(p==='/api/search'&&req.method==='GET'){transaction(db,()=>search.refreshIndex(db,u));send(200,search.searchAll(db,u,url.searchParams.get('q')??''));return;}
      // أوراق العمل الضريبية
      if(p==='/api/tax-returns/vat'&&req.method==='GET') {send(200,taxReturns.vatBoard(db,u));return;}
      if(p==='/api/tax-returns/withholding'&&req.method==='GET') {send(200,taxReturns.withholdingBoard(db,u));return;}
      const vatExport=p.match(/^\/api\/tax-returns\/vat\/([a-f0-9-]{36})\/export\.csv$/);
      if(vatExport&&req.method==='GET') {
        const file=taxReturns.exportVatWorksheet(db,u,vatExport[1]);
        audit(db,u,'vat_worksheet',vatExport[1],'vat_worksheet.exported',{}, {format:'csv'});
        res.writeHead(200,{...headers,'Content-Type':file.type,'Content-Disposition':`attachment; filename="${file.filename}"`,'Content-Length':file.content.length});res.end(file.content);return;
      }
      // حماية الأجور والمطابقة والشذوذ
      if(p==='/api/wps'&&req.method==='GET') {send(200,wps.wpsBoard(db,u));return;}
      const wpsChecks=p.match(/^\/api\/wps\/runs\/([a-f0-9-]+)\/checks$/);
      if(wpsChecks&&req.method==='GET') {send(200,wps.preExportChecks(db,u,wpsChecks[1]));return;}
      const wpsFile=p.match(/^\/api\/wps\/exports\/([a-f0-9-]{36})\/file$/);
      if(wpsFile&&req.method==='GET') {const file=transaction(db,()=>wps.wageFileContent(db,u,wpsFile[1]));res.writeHead(200,{...headers,'Content-Type':'text/plain; charset=utf-8','Content-Disposition':`attachment; filename="${file.filename}"`,'X-Simulation-Status':file.integration_status??'simulated'});res.end(file.content);return;}
      if(p==='/api/wage-reconciliation'&&req.method==='GET') {send(200,wageRecon.wageReconciliation(db,u,url.searchParams.get('month')??null));return;}
      if(p==='/api/payroll-anomaly'&&req.method==='GET') {send(200,anomaly.anomalyBoard(db,u));return;}
      const anomalyRun=p.match(/^\/api\/payroll-anomaly\/runs\/([a-f0-9-]+)$/);
      if(anomalyRun&&req.method==='GET') {send(200,anomaly.runAnomalyReport(db,u,anomalyRun[1]));return;}
      // حزم التعيين والمغادرة وإخلاء الطرف
      if(p==='/api/lifecycle'&&req.method==='GET') {send(200,lifecycle.lifecycleBoard(db,u));return;}
      if(p==='/api/clearance'&&req.method==='GET') {send(200,lifecycle.clearanceBoard(db,u));return;}
      // طابور الفوترة الإلكترونية (غير موصول بجهة خارجية)
      if(p==='/api/einvoice'&&req.method==='GET') {send(200,einvoice.einvoiceBoard(db,u));return;}
      if(p==='/api/einvoice/selfcheck'&&req.method==='GET') {send(200,einvoiceSelfcheck(db,u));return;}
      const einvoiceBuyer=p.match(/^\/api\/einvoice\/buyers\/([a-f0-9-]{36})$/);
      if(einvoiceBuyer&&req.method==='GET') {send(200,einvoice.buyerReadiness(db,u,einvoiceBuyer[1]));return;}
      // استقبال الطلب (قبل مسار /api/requests/:id العام، وقبل رفض غير POST/PATCH)
      if(p==='/api/intake/settings'&&req.method==='GET') {send(200,requestIntake.intakeSettings(db,u));return;}
      const requestIntakeRead=p.match(/^\/api\/requests\/([a-f0-9-]+)\/intake$/);
      if(requestIntakeRead&&req.method==='GET') {send(200,requestIntake.requestIntakeView(db,u,requestIntakeRead[1]));return;}
      // الخط الزمني للطلب والإغلاق والتجربة والقياس
      if(p==='/api/my-request-timeline'&&req.method==='GET') {send(200,requestTimeline.myTimelineBoard(db,u));return;}
      if(p==='/api/service-insight'&&req.method==='GET') {send(200,processInsight.serviceInsightScreen(db,u,url.searchParams.has('service_code')?{service_code:url.searchParams.get('service_code')}:{}));return;}
      const timelineRead=p.match(/^\/api\/request-timeline\/([a-f0-9-]+)$/);
      if(timelineRead&&req.method==='GET') {send(200,requestTimeline.timeline(db,u,timelineRead[1]));return;}
      const closureRead=p.match(/^\/api\/request-closure\/([a-f0-9-]+)$/);
      if(closureRead&&req.method==='GET') {send(200,requestClosure.closureView(db,u,closureRead[1]));return;}
      const experienceRead=p.match(/^\/api\/service-experience\/([a-f0-9-]+)$/);
      if(experienceRead&&req.method==='GET') {send(200,serviceExperience.experienceQuestion(db,u,experienceRead[1]));return;}
      // المعرفة وإقرار السياسات ومراجعة الصلاحيات
      if(p==='/api/knowledge'&&req.method==='GET') {send(200,knowledge.knowledgeBoard(db,u));return;}
      if(p==='/api/policy-acknowledgements'&&req.method==='GET') {send(200,policyAck.acknowledgementsBoard(db,u));return;}
      if(p==='/api/access-reviews'&&req.method==='GET') {send(200,accessReviews.accessReviewBoard(db,u));return;}
      // مكتبة السياسات: القراءة لكل موظف. الكتابة وحدها في وحدتها بفحص تصريح الموارد البشرية.
      if(p==='/api/policy-library'&&req.method==='GET') {send(200,policyLibrary.libraryHome(db,u));return;}
      if(p==='/api/policy-library/search'&&req.method==='GET') {send(200,policyLibrary.searchLibrary(db,u,Object.fromEntries(['q','document','chapter','status','content'].filter(k=>url.searchParams.has(k)).map(k=>[k,url.searchParams.get(k)]))));return;}
      if(p==='/api/policy-library/admin'&&req.method==='GET') {send(200,policyLibrary.adminBoard(db,u));return;}
      if(p==='/api/policy-library/synonyms'&&req.method==='GET') {send(200,policyLibrary.synonymBoard(db,u));return;}
      if(p==='/api/policy-library/basis'&&req.method==='GET') {send(200,policyLibrary.basisCatalog(db,u));return;}
      const policyBasisKey=p.match(/^\/api\/policy-library\/basis\/([a-z][a-z0-9_.]{2,59})$/);
      if(policyBasisKey&&req.method==='GET') {send(200,policyLibrary.basisView(db,u,policyBasisKey[1]));return;}
      const policyArticleCompare=p.match(/^\/api\/policy-library\/articles\/([A-Za-z0-9-]{1,40})\/compare$/);
      if(policyArticleCompare&&req.method==='GET') {send(200,policyLibrary.compareVersions(db,u,policyArticleCompare[1],Object.fromEntries(['from','to'].filter(k=>url.searchParams.has(k)).map(k=>[k,url.searchParams.get(k)]))));return;}
      const policyArticleRead=p.match(/^\/api\/policy-library\/articles\/([A-Za-z0-9-]{1,40})$/);
      if(policyArticleRead&&req.method==='GET') {send(200,policyLibrary.articleView(db,u,policyArticleRead[1],url.searchParams.has('q')?{q:url.searchParams.get('q')}:{}));return;}
      // الفرص البيعية والتقديرات
      // «عقود قرب نهايتها» (P4-CRM-6) تُقرأ مع خط الفرص نفسه: فرصة التجديد تنفتح من هناك.
      if(p==='/api/pipeline'&&req.method==='GET') {send(200,{...pipeline.pipelineBoard(db,u,Object.fromEntries(['from','to'].filter(k=>url.searchParams.has(k)).map(k=>[k,url.searchParams.get(k)]))),renewals:clientRenewals.renewalsFor(db,u)});return;}
      if(p==='/api/estimates'&&req.method==='GET') {send(200,estimates.estimatesBoard(db,u,{costRate}));return;}
      // تسعير المشاريع وعروض الأسعار (ترحيل 108): الورقة والاستثناء والعرض، وسجل العرض الإلكتروني للقراءة.
      if(p==='/api/pricing'&&req.method==='GET') {send(200,pricing.pricingBoard(db,u,{mediaInvoice}));return;}
      const quotationRecordRead=p.match(/^\/api\/pricing\/quotations\/([a-f0-9-]{36})\/record$/);
      if(quotationRecordRead&&req.method==='GET') {send(200,pricing.quotationRecord(db,u,quotationRecordRead[1]));return;}
      // سجل التعريفات (ترحيل 123). المسارات الثابتة قبل مسار الكيان العام. اللقطة محجوبة لكل مستخدم: لا يصل المتصفحَ تعريفُ حقل
      // لا يحق لصاحبه أن يراه، والمعاينة (?preview=1) تجيب بالمسودة لمعدّها وحده.
      if(p==='/api/definitions/snapshot'&&req.method==='GET') {send(200,definitions.snapshotFor(db,u,{preview:url.searchParams.get('preview')==='1',have:url.searchParams.get('have')}));return;}
      if(p==='/api/definitions'&&req.method==='GET') {send(200,{...definitions.definitionsIndex(db,u),imports:definitionsTransfer.listImports(db,u),view_as:viewAs.log(db,u)});return;}
      if(p==='/api/view-as/log'&&req.method==='GET') {const record=viewAs.log(db,u);if(!record)access.require(db,u,'access.view_as');send(200,record);return;}
      if(p==='/api/definitions/export'&&req.method==='GET') {
        const bundle=definitionsTransfer.exportBundle(db,u,{source_label:url.searchParams.get('label')??''});
        const content=Buffer.from(JSON.stringify(bundle,null,2),'utf8');
        res.writeHead(200,{...headers,'Content-Type':'application/json; charset=utf-8','Content-Disposition':`attachment; filename="definitions-${bundle.exported_at.slice(0,10)}.json"`,'Content-Length':content.length});res.end(content);return;
      }
      const definitionRead=p.match(/^\/api\/definitions\/([a-z][a-z_]{2,39})$/);
      if(definitionRead&&req.method==='GET') {send(200,definitions.editorPayload(db,u,definitionRead[1]));return;}
      // تصدير عام لكل كيان مشارك: أعمدة الواصف النظامية ثم الحقول المخصّصة التي يراها هذا الحساب؛ العمود المحجوب ساقط من الملف.
      const recordsExport=p.match(/^\/api\/records\/([a-z][a-z_]{2,39})\/export\.xlsx$/);
      if(recordsExport&&req.method==='GET') {
        if(!definitions.entityFor(recordsExport[1])?.table) fail(404,'not_found','لا كيان مشارك في سجل التعريفات بهذا المفتاح. الكيانات المشاركة: client وopportunity وclient_quotation');
        const file=customFields.exportRows(db,u,recordsExport[1]);
        audit(db,u,recordsExport[1],'export','records.exported',{}, {rows:file.rows,columns:file.columns,definition_version:file.definition_version});
        res.writeHead(200,{...headers,'Content-Type':file.type,'Content-Disposition':`attachment; filename="${file.filename}"`,'Content-Length':file.content.length});res.end(file.content);return;
      }
      const recordHistory=p.match(/^\/api\/records\/([a-z][a-z_]{2,39})\/([a-f0-9-]{36})\/custom-fields\/history$/);
      if(recordHistory&&req.method==='GET') {
        if(!definitions.entityFor(recordHistory[1])?.table) fail(404,'not_found','لا كيان مشارك في سجل التعريفات بهذا المفتاح. الكيانات المشاركة: client وopportunity وclient_quotation');
        send(200,{history:customFields.valueHistory(db,u,recordHistory[1],recordHistory[2])});return;
      }
      // طابور المهام والأعلام وحوكمة المساعدين وتقييماتها
      if(p==='/api/jobs'&&req.method==='GET') {send(200,jobs.jobsBoard(db,u));return;}
      if(p==='/api/feature-flags'&&req.method==='GET') {send(200,flags.flagsBoard(db,u));return;}
      if(p==='/api/ai-governance'&&req.method==='GET') {send(200,gov.aiGovernanceBoard(db,u));return;}
      if(p==='/api/ai-evals'&&req.method==='GET') {send(200,evals.evalsBoard(db,u));return;}
      // «اسأل عن السياسة»: اللوحة والحزمة الذهبية قراءتان؛ التشغيل نفسه يمر بـ/api/ai/run/policy_assistant بحدوده وسجله.
      if(p==='/api/policy-assistant'&&req.method==='GET') {send(200,policyAssistant.policyAssistantBoard(db,u));return;}
      if(p==='/api/policy-assistant/golden'&&req.method==='GET') {send(200,await policyAssistant.runGoldenSet(db,u,{subject_user_id:url.searchParams.get('subject')??null}));return;}
      // جودة حقول الخدمة
      if(p==='/api/catalog-quality'&&req.method==='GET') {send(200,catalogQuality.catalogQualityBoard(db,u));return;}
      // حالات الموارد البشرية والتعويضات والقوى العاملة
      if(p==='/api/hr-cases'&&req.method==='GET') {send(200,hrCases.hrCasesBoard(db,u));return;}
      const hrCaseRead=p.match(/^\/api\/hr-cases\/([a-f0-9-]{36})$/);
      if(hrCaseRead&&req.method==='GET') {send(200,hrCases.getCase(db,u,hrCaseRead[1]));return;}
      // سجل المخالفات والجزاءات (ترحيل 097): لوحة الموارد البشرية، وصفحة الموظف، والقضية، وصحيفة الجزاءات
      if(p==='/api/discipline'&&req.method==='GET') {send(200,discipline.disciplineBoard(db,u));return;}
      if(p==='/api/discipline/mine'&&req.method==='GET') {send(200,discipline.myDiscipline(db,u));return;}
      const disciplineCaseRead=p.match(/^\/api\/discipline\/cases\/([a-f0-9-]{36})$/);
      if(disciplineCaseRead&&req.method==='GET') {send(200,discipline.getCase(db,u,disciplineCaseRead[1]));return;}
      const disciplineSheet=p.match(/^\/api\/discipline\/sheets\/([A-Za-z0-9_-]{1,64})$/);
      if(disciplineSheet&&req.method==='GET') {send(200,discipline.penaltySheet(db,u,disciplineSheet[1]));return;}
      if(p==='/api/compensation'&&req.method==='GET') {send(200,compensation.compensationBoard(db,u));return;}
      if(p==='/api/workforce'&&req.method==='GET') {send(200,workforce.workforceBoard(db,u,Object.fromEntries(['from','to'].filter(k=>url.searchParams.has(k)).map(k=>[k,url.searchParams.get(k)]))));return;}
      // إعدادات محرك الاعتماد: الحدود والبدلاء والمقترحات وفحص الكتالوج (docs/implementation/handoff/approval-engine.md §6.1)
      if(p==='/api/approval-settings'&&req.method==='GET') {send(200,approvalSettings(db,u));return;}
      // الموجة 2: مهل محرك العمل وما يتوقف عليها (قسم داخل «إعداد الاعتماد»، لا شاشة جديدة).
      if(p==='/api/workflow-control'&&req.method==='GET') {send(200,workflowSweep.workflowControl(db,u));return;}
      // الصرف الإعلامي وتقارير العملاء
      if(p==='/api/media-spend'&&req.method==='GET') {send(200,mediaSpend.mediaSpendBoard(db,u));return;}
      if(p==='/api/client-reports'&&req.method==='GET') {send(200,clientReports.clientReportsBoard(db,u));return;}
      const clientReportPrint=p.match(/^\/api\/client-reports\/([a-f0-9-]{36})\/print$/);
      if(clientReportPrint&&req.method==='GET') {
        const html=clientReports.clientReportPrintable(clientReports.readClientReport(db,u,clientReportPrint[1]),tenantIdentity.tenantDemoFlag(db,u.tenant_id));
        audit(db,u,'client_report',clientReportPrint[1],'client_report.printed',{}, {});
        res.writeHead(200,{...headers,'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'});res.end(html);return;
      }
      // النماذج الإلكترونية وكتالوجها (ترحيل 107، docs/implementation/handoff/forms-engine.md)
      if(p==='/api/forms'&&req.method==='GET') {
        transaction(db,()=>forms.installCatalogue(db,u.tenant_id));
        send(200,forms.formsBoard(db,u,Object.fromEntries(['q','department','step','project_id'].filter(k=>url.searchParams.has(k)).map(k=>[k,url.searchParams.get(k)]))));return;
      }
      if(p==='/api/forms/alias'&&req.method==='GET') {send(200,forms.aliasLookup(db,u.tenant_id,url.searchParams.get('code')??''));return;}
      // السجل الإلكتروني للنسخة: رابط يُفتح ويُشارك. لا مسار طباعة — قرار المالك: كل شيء إلكتروني.
      const formInstance=p.match(/^\/api\/forms\/instances\/([a-f0-9-]{36})(?:\/(record|export))?$/);
      if(formInstance&&req.method==='GET') {
        if(!formInstance[2]) {send(200,forms.getInstance(db,u,formInstance[1]));return;}
        if(formInstance[2]==='record') {send(200,forms.instanceRecord(db,u,formInstance[1]));return;}
        const file=forms.instanceExport(db,u,formInstance[1]);
        audit(db,u,'form_instance',formInstance[1],'form.exported',{}, {});
        res.writeHead(200,{...headers,'Content-Type':'application/json; charset=utf-8','Content-Disposition':`attachment; filename="${file.filename}"`});res.end(file.content);return;
      }
      const match=p.match(/^\/api\/requests\/([a-f0-9-]+)(?:\/([a-z]+))?$/);
      if(match&&!match[2]&&req.method==='GET') {send(200,requestView(db,u,match[1]));return;}
      const download=p.match(/^\/api\/attachments\/([a-f0-9-]+)$/);
      if(download&&req.method==='GET') {
        const a=transaction(db,()=>wf.downloadAttachment(db,u,download[1]));
        res.writeHead(200,{...headers,'Content-Type':'application/octet-stream','Content-Security-Policy':"sandbox; default-src 'none'",'Content-Disposition':`attachment; filename="attachment"; filename*=UTF-8''${encodeURIComponent(a.filename)}`,'Content-Length':a.size});res.end(Buffer.from(a.content));return;
      }
      if(!['POST','PATCH'].includes(req.method)) fail(404,'not_found','المسار غير متاح');
      const input=await body(req);
      auth=authenticate(db,req.headers.cookie);checkCsrf(auth.session,req.headers['x-csrf-token']);u=auth.user;
      // النقطة الثانية للمصادقة (بعد قراءة الجسم): القاعدة نفسها، فلا تفتح تجربةٌ بدأت بين النقطتين بابًا للكتابة.
      {const again=viewAs.active(db,auth.session,u);if(again){setViewing(again);u=viewAs.personaRow(u,again);if(p!=='/api/view-as/stop')viewAs.refuseWrite(again,req.method,p);}}
      // تشغيل المساعد ينتظر مزودًا خارجيًا، فلا يجري داخل معاملة قاعدة البيانات؛ التسجيل وحده معاملة قصيرة بعد عودة الناتج.
      const assistantRun=p.match(/^\/api\/ai\/run\/([a-z_]+)$/);
      if(assistantRun&&req.method==='POST') {send(201,await ai.runAssistant(db,u,assistantRun[1],input,transaction));return;}
      // الفوترة الإلكترونية وتشغيل حزمة التقييم ينتظران طرفًا آخر، فيفتحان معاملاتهما القصيرة بأنفسهما.
      const einvoiceCall=p.match(/^\/api\/einvoice\/submissions\/([a-f0-9-]{36})\/(attempt|status)$/);
      if(einvoiceCall&&req.method==='POST') {send(201,einvoiceCall[2]==='attempt'?await einvoice.attemptSubmission(db,u,einvoiceCall[1],input,transaction):await einvoice.refreshSubmissionStatus(db,u,einvoiceCall[1],input,transaction));return;}
      const evalRun=p.match(/^\/api\/ai-evals\/suites\/([a-f0-9-]{36})\/run$/);
      if(evalRun&&req.method==='POST') {send(201,await evals.runSuite(db,u,evalRun[1],input));return;}
      const result=transaction(db,()=>{
        // resourceId: for a creator that answers with the created row it is left out; a creator that answers with a whole
        // record or board says which of its fields is the identifier of what it just wrote.
        const once=(create,read,resourceId)=>createOnce(db,u,p,req.headers['idempotency-key'],input,create,id=>{const value=read(id);if(!value)fail(404,'not_found','السجل غير متاح');return value;},resourceId);
        // موارد مساحة العمل. كل إنشاء يمر بمفتاح التكرار؛ أفعال النسخة (نقل، تعديل، إلغاء) تحمل version ولا تُعاد كإنشاء.
        if(p==='/api/spaces/ensure'&&req.method==='POST') return once(()=>collaborationSpace.ensureSpace(db,u,input),id=>collaborationSpace.spaceById(db,u,id));
        const spaceCreate=p.match(/^\/api\/spaces\/([a-f0-9-]{36})\/(lists|tasks|folders|documents|files|topics|chat|events|check-ins)$/);
        if(spaceCreate&&req.method==='POST'){
          const [spaceId,resource]=spaceCreate.slice(1);
          if(resource==='lists')return once(()=>collaborationTasks.createList(db,u,spaceId,input),id=>collaborationTasks.taskBoard(db,u,spaceId).lists.find(row=>row.id===id));
          if(resource==='tasks')return once(()=>collaborationTasks.createSpaceTask(db,u,spaceId,input),id=>collaborationTasks.taskBoard(db,u,spaceId).tasks.find(row=>row.id===id));
          if(resource==='folders')return once(()=>collaborationFiles.createFolder(db,u,spaceId,input),id=>collaborationFiles.filesBoard(db,u,spaceId).folders.find(row=>row.id===id));
          if(resource==='documents')return once(()=>collaborationFiles.createDocument(db,u,spaceId,input),id=>collaborationFiles.filesBoard(db,u,spaceId).documents.find(row=>row.id===id));
          if(resource==='files')return once(()=>collaborationFiles.uploadWorkspaceFile(db,u,spaceId,input),id=>collaborationFiles.filesBoard(db,u,spaceId).files.find(row=>row.id===id));
          if(resource==='topics')return once(()=>collaborationMessages.publishTopic(db,u,spaceId,input),id=>collaborationMessages.messageBoard(db,u,spaceId).topics.find(row=>row.id===id));
          if(resource==='chat')return once(()=>collaborationMessages.postChatLine(db,u,spaceId,input),id=>collaborationMessages.chatLines(db,u,spaceId,{limit:200}).items.find(row=>row.id===id));
          if(resource==='events')return once(()=>collaborationSchedule.createEvent(db,u,spaceId,input),id=>collaborationSchedule.scheduleBoard(db,u,spaceId).events.find(row=>row.id===id));
          if(resource==='check-ins')return once(()=>collaborationCheckins.createCheckin(db,u,spaceId,input),id=>collaborationCheckins.checkinBoard(db,u,spaceId).checkins.find(row=>row.id===id));
        }
        const spaceTaskAction=p.match(/^\/api\/spaces\/([a-f0-9-]{36})\/tasks\/([a-f0-9-]{36})\/(move|complete|reopen|comments)$/);
        if(spaceTaskAction&&req.method==='POST'){
          const [spaceId,taskId,action]=spaceTaskAction.slice(1);
          if(action==='move')return collaborationTasks.moveTask(db,u,spaceId,taskId,input);
          if(action==='complete')return collaborationTasks.completeSpaceTask(db,u,spaceId,taskId,input);
          if(action==='reopen')return collaborationTasks.reopenSpaceTask(db,u,spaceId,taskId,input);
          return once(()=>collaborationTasks.commentOnTask(db,u,spaceId,taskId,input),id=>db.prepare('SELECT * FROM space_task_comments WHERE id=? AND task_id=?').get(id,taskId));
        }
        const listReorder=p.match(/^\/api\/spaces\/([a-f0-9-]{36})\/lists\/([a-f0-9-]{36})\/reorder$/);
        if(listReorder&&req.method==='POST')return collaborationTasks.reorderList(db,u,listReorder[1],listReorder[2],input);
        const taskUpdate=p.match(/^\/api\/spaces\/([a-f0-9-]{36})\/tasks\/([a-f0-9-]{36})$/);
        if(taskUpdate&&req.method==='PATCH')return collaborationTasks.updateSpaceTask(db,u,taskUpdate[1],taskUpdate[2],input);
        const documentRevision=p.match(/^\/api\/spaces\/([a-f0-9-]{36})\/documents\/([a-f0-9-]{36})\/revisions$/);
        if(documentRevision&&req.method==='POST')return collaborationFiles.saveDocumentRevision(db,u,documentRevision[1],documentRevision[2],input);
        const fileEvidence=p.match(/^\/api\/spaces\/([a-f0-9-]{36})\/files\/([a-f0-9-]{36})\/evidence$/);
        if(fileEvidence&&req.method==='POST')return once(()=>collaborationFiles.publishFileAsEvidence(db,u,fileEvidence[1],fileEvidence[2],input),id=>db.prepare('SELECT * FROM workspace_evidence_links WHERE id=?').get(id));
        const topicAction=p.match(/^\/api\/spaces\/([a-f0-9-]{36})\/topics\/([a-f0-9-]{36})\/(revise|withdraw|comments)$/);
        if(topicAction&&req.method==='POST'){
          const [spaceId,topicId,action]=topicAction.slice(1);
          if(action==='revise')return collaborationMessages.reviseTopic(db,u,spaceId,topicId,input);
          if(action==='withdraw')return collaborationMessages.withdrawTopic(db,u,spaceId,topicId,input);
          return once(()=>collaborationMessages.commentOnTopic(db,u,spaceId,topicId,input),id=>db.prepare('SELECT * FROM workspace_topic_comments WHERE id=? AND topic_id=?').get(id,topicId));
        }
        const chatAction=p.match(/^\/api\/spaces\/([a-f0-9-]{36})\/chat\/([a-f0-9-]{36})\/(revise|redact|convert-to-task)$/);
        if(chatAction&&req.method==='POST'){
          const [spaceId,lineId,action]=chatAction.slice(1);
          if(action==='revise')return collaborationMessages.reviseChatLine(db,u,spaceId,lineId,input);
          if(action==='redact')return collaborationMessages.redactChatLine(db,u,spaceId,lineId,input);
          return once(()=>collaborationMessages.convertToTask(db,u,spaceId,lineId,input),id=>collaborationTasks.taskBoard(db,u,spaceId).tasks.find(row=>row.id===id));
        }
        const eventCancel=p.match(/^\/api\/spaces\/([a-f0-9-]{36})\/events\/([a-f0-9-]{36})\/cancel$/);
        if(eventCancel&&req.method==='POST')return collaborationSchedule.cancelEvent(db,u,eventCancel[1],eventCancel[2],input);
        const checkinAnswer=p.match(/^\/api\/spaces\/([a-f0-9-]{36})\/check-ins\/([a-f0-9-]{36})\/answers$/);
        if(checkinAnswer&&req.method==='POST')return once(()=>collaborationCheckins.answerCheckin(db,u,checkinAnswer[2],input),id=>db.prepare('SELECT * FROM workspace_checkin_responses WHERE id=?').get(id));
        const answerConvert=p.match(/^\/api\/spaces\/([a-f0-9-]{36})\/check-in-answers\/([a-f0-9-]{36})\/convert-to-task$/);
        if(answerConvert&&req.method==='POST')return once(()=>collaborationCheckins.convertAnswerToTask(db,u,answerConvert[2],input),id=>collaborationTasks.taskBoard(db,u,answerConvert[1]).tasks.find(row=>row.id===id));
        const spacePeopleAction=p.match(/^\/api\/spaces\/([a-f0-9-]{36})\/people(?:\/([a-z0-9._-]{1,64})\/(role|remove))?$/);
        if(spacePeopleAction&&req.method==='POST'){
          if(!spacePeopleAction[2])return once(()=>collaborationAccess.addSpaceMember(db,u,spacePeopleAction[1],input),id=>collaborationAccess.spacePeople(db,u,spacePeopleAction[1]).find(row=>row.user_id===id),row=>row.user_id);
          if(spacePeopleAction[3]==='role')return collaborationAccess.changeSpaceRole(db,u,spacePeopleAction[1],spacePeopleAction[2],input);
          return collaborationAccess.removeSpaceMember(db,u,spacePeopleAction[1],spacePeopleAction[2],input);
        }
        if(p==='/api/account/password'&&req.method==='POST') return changePassword(db,u,auth.session,input);
        if(p==='/api/compliance'&&req.method==='POST') return once(()=>compliance.createObligation(db,u,input),id=>({id}));
        const obligationStep=p.match(/^\/api\/compliance\/([a-f0-9-]{36})\/(complete_obligation|verify_obligation|deactivate_obligation|activate_obligation)$/);
        if(obligationStep&&req.method==='POST') return compliance.obligationAction(db,u,obligationStep[1],obligationStep[2],input);
        if(p==='/api/service-cards/draft-missing'&&req.method==='POST') return serviceCards.draftMissingCards(db,u);
        const cardStep=p.match(/^\/api\/service-cards\/([A-Za-z0-9-]{3,40})(?:\/(view|publish))?$/);
        if(cardStep&&req.method==='POST') return cardStep[2]==='view'?serviceCards.serviceCard(db,u,cardStep[1]):cardStep[2]==='publish'?serviceCards.publishCard(db,u,cardStep[1],input):serviceCards.saveCard(db,u,cardStep[1],input);
        if(p==='/api/centres'&&req.method==='POST') return once(()=>centres.proposeCentre(db,u,input),id=>({id}));
        const centreStep=p.match(/^\/api\/centres\/([a-f0-9-]{36})\/(edit_centre|link_services|activate_centre|retire_centre)$/);
        if(centreStep&&req.method==='POST') return centres.centreAction(db,u,centreStep[1],centreStep[2],input);
        if(p==='/api/ai/settings'&&req.method==='POST') return ai.setAiSettings(db,u,input);
        const runReview=p.match(/^\/api\/ai\/runs\/([a-f0-9-]{36})\/review$/);
        if(runReview&&req.method==='POST') return ai.reviewRun(db,u,runReview[1],input);
        if(p==='/api/performance/cycles'&&req.method==='POST') return once(()=>talent.createCycle(db,u,input),id=>({id}));
        const cycleStep=p.match(/^\/api\/performance\/cycles\/([a-f0-9-]{36})\/(open|to_calibration|release)$/);
        if(cycleStep&&req.method==='POST') return talent.cycleAction(db,u,cycleStep[1],cycleStep[2],input);
        const reviewStep=p.match(/^\/api\/performance\/reviews\/([a-f0-9-]{36})\/(submit_self|skip_self|exclude_review|submit_manager|calibrate|acknowledge|appeal|decide_appeal)$/);
        if(reviewStep&&req.method==='POST') return talent.reviewAction(db,u,reviewStep[1],reviewStep[2],input);
        if(p==='/api/growth/career'&&req.method==='POST') return career.saveCareer(db,u,input);
        if(p==='/api/growth/qualifications'&&req.method==='POST') return once(()=>career.addQualification(db,u,input),id=>({id}));
        const qualificationStep=p.match(/^\/api\/growth\/qualifications\/([a-f0-9-]{36})\/(verify|withdraw)$/);
        if(qualificationStep&&req.method==='POST') return career.qualificationAction(db,u,qualificationStep[1],qualificationStep[2],input);
        if(p==='/api/growth/training'&&req.method==='POST') return once(()=>talent.requestTraining(db,u,input),id=>({id}));
        const trainingStep=p.match(/^\/api\/growth\/training\/([a-f0-9-]{36})\/(approve|reject|cancel|complete)$/);
        if(trainingStep&&req.method==='POST') return talent.trainingAction(db,u,trainingStep[1],trainingStep[2],input);
        if(p==='/api/growth/goals'&&req.method==='POST') return once(()=>talent.setGoal(db,u,input),id=>({id}));
        const goalStep=p.match(/^\/api\/growth\/goals\/([a-f0-9-]{36})\/(note|achieve|drop)$/);
        if(goalStep&&req.method==='POST') return talent.goalAction(db,u,goalStep[1],goalStep[2],input);
        if(p==='/api/growth/succession'&&req.method==='POST') return once(()=>talent.createPlan(db,u,input),id=>({id}));
        const planStep=p.match(/^\/api\/growth\/succession\/([a-f0-9-]{36})\/(add_candidate|remove_candidate|archive_plan)$/);
        if(planStep&&req.method==='POST') return talent.planAction(db,u,planStep[1],planStep[2],input);
        if(p==='/api/hr/competencies'&&req.method==='POST') return once(()=>hrOperations.createCompetency(db,u,input),id=>({id}));
        const competencyStep=p.match(/^\/api\/hr\/competencies\/([a-f0-9-]{36})\/(activate|retire)$/);
        if(competencyStep&&req.method==='POST') return hrOperations.competencyAction(db,u,competencyStep[1],competencyStep[2],input);
        if(p==='/api/hr/competency-assessments'&&req.method==='POST') return once(()=>hrOperations.recordCompetencyAssessment(db,u,input),id=>({id}));
        if(p==='/api/hr/improvement-plans'&&req.method==='POST') return once(()=>hrOperations.createImprovementPlan(db,u,input),id=>({id}));
        const improvementStep=p.match(/^\/api\/hr\/improvement-plans\/([a-f0-9-]{36})\/(submit|activate|acknowledge|close|cancel)$/);
        if(improvementStep&&req.method==='POST') return hrOperations.improvementPlanAction(db,u,improvementStep[1],improvementStep[2],input);
        const improvementCheckpoint=p.match(/^\/api\/hr\/improvement-plans\/([a-f0-9-]{36})\/checkpoints$/);
        if(improvementCheckpoint&&req.method==='POST') return once(()=>hrOperations.addImprovementCheckpoint(db,u,improvementCheckpoint[1],input),id=>({id}));
        if(p==='/api/hr/general-surveys'&&req.method==='POST') return once(()=>hrOperations.createGeneralSurvey(db,u,input),id=>({id}));
        if(p==='/api/hr/team-access'&&req.method==='POST') return hrTeamAccess.setHrTeamAccess(db,u,input);
        const generalSurveyStep=p.match(/^\/api\/hr\/general-surveys\/([a-f0-9-]{36})\/(open|close)$/);
        if(generalSurveyStep&&req.method==='POST') return hrOperations.generalSurveyAction(db,u,generalSurveyStep[1],generalSurveyStep[2],input);
        const generalSurveyResponse=p.match(/^\/api\/hr\/general-surveys\/([a-f0-9-]{36})\/respond$/);
        if(generalSurveyResponse&&req.method==='POST') return once(()=>hrOperations.submitGeneralSurvey(db,u,generalSurveyResponse[1],input),id=>({id}));
        if(p==='/api/files'&&req.method==='POST') return once(()=>files.uploadFile(db,u,input),id=>({id}));
        if(p==='/api/account/appearance'&&req.method==='POST') return preferences.setPersonalAppearance(db,u,input);
        if(p==='/api/admin/appearance'&&req.method==='POST') return preferences.setCompanyAppearance(db,u,input);
        if(p==='/api/admin/security'&&req.method==='POST') {totp.setSecurityPolicy(db,u,input);return totp.securityPolicy(db,u);}
        if(p==='/api/admin/security/idle'&&req.method==='POST') return sessionPolicy.setIdlePolicy(db,u,input,fail);
        // إقرار طبيعة بيانات المنصة (الترحيل 137): الأدمن الأول وحده، فلا يُترك لحارس البادئة accounts.manage أسفله.
        if(p==='/api/admin/tenant-data'&&req.method==='POST') return tenantIdentity.declareTenantData(db,u,input);
        if(p==='/api/account/totp/start'&&req.method==='POST') return totp.startTotp(db,u);
        if(p==='/api/account/totp/confirm'&&req.method==='POST') return totp.confirmTotp(db,u,input,auth.session.token_hash);
        if(p==='/api/account/totp/disable'&&req.method==='POST') return totp.disableTotp(db,u,input,verifyPassword);
        const totpReset=p.match(/^\/api\/admin\/accounts\/([a-z0-9._-]+)\/totp-reset$/);
        if(totpReset&&req.method==='POST') return totp.resetTotp(db,u,totpReset[1],input);
        if(p.startsWith('/api/admin/')&&req.method!=='GET') access.require(db,u,p.startsWith('/api/admin/departments')||p==='/api/admin/routing'?'structure.manage':'accounts.manage');
        // مستويات الإدارة (ترحيل 130): كل دالة تحرس نفسها بنفسها — الأدمن الأول للقالب والاستثناء والمفتاح،
        // وأدمن الإدارة لمستويات أعضاء إدارته وحدها. لا حارس بادئة هنا، فالمسار جديد ولا يرث شيئًا.
        if(p==='/api/permissions/template'&&req.method==='POST') return departmentLevels.setTemplate(db,u,input);
        if(p==='/api/permissions/exceptions'&&req.method==='POST') return departmentLevels.setException(db,u,input);
        if(p==='/api/permissions/levels'&&req.method==='POST') return departmentLevels.setUserLevel(db,u,input);
        if(p==='/api/permissions/switch'&&req.method==='POST') return departmentLevels.setSwitch(db,u,input);
        // مرجع تصعيد الإدارة: الدالة تحرس نفسها (الأدمن الأول وحده)، كما تفعل أخواتها أعلاه.
        if(p==='/api/permissions/escalation'&&req.method==='POST') return assignDepartmentEscalation(db,u,input);
        // المقارنة الظلية بطلب صريح من الأدمن الأول. لا تُحسب عند فتح الشاشة: تمرّ على كل حساب × كل تصريح
        // × كل إدارة، والخادم بخيط واحد، فحسابها في مسار قراءة يحجب كل طلب آخر — والشاشة تعرض المحفوظ.
        if(p==='/api/permissions/shadow'&&req.method==='POST') return departmentLevels.runShadow(db,u);
        if(p==='/api/access/matrix'&&req.method==='POST') return access.applyAccessMatrix(db,u,input);
        if(p==='/api/access/grants'&&req.method==='POST') return access.grantAccess(db,u,input);
        const revokeGrant=p.match(/^\/api\/access\/grants\/([a-f0-9-]+)\/revoke$/);
        if(revokeGrant&&req.method==='POST') return access.revokeAccess(db,u,revokeGrant[1],input);
        const adminLevel=p.match(/^\/api\/access\/admins\/([a-z0-9._-]+)$/);
        if(adminLevel&&req.method==='PATCH') return access.setAdminLevel(db,u,adminLevel[1],input);
        if(p==='/api/admin/accounts'&&req.method==='POST') return once(()=>admin.createAccount(db,u,input),id=>admin.adminDirectory(db,u).users.find(a=>a.id===id));
        if(p==='/api/admin/accounts/import'&&req.method==='POST') return admin.importAccounts(db,u,input);
        if(p==='/api/admin/departments'&&req.method==='POST') return admin.saveDepartment(db,u,input);
        if(p==='/api/admin/routing'&&req.method==='POST') return admin.assignRouting(db,u,input);
        const accountAction=p.match(/^\/api\/admin\/accounts\/([a-z0-9._-]+)(?:\/(password))?$/);
        if(accountAction&&req.method==='PATCH'&&!accountAction[2]) return admin.updateAccount(db,u,accountAction[1],input);
        if(accountAction&&req.method==='POST'&&accountAction[2]) return admin.resetAccountPassword(db,u,accountAction[1],input);
        const departmentAction=p.match(/^\/api\/admin\/departments\/([a-z][a-z0-9-]{1,39})$/);
        if(departmentAction&&req.method==='PATCH') return admin.saveDepartment(db,u,input,departmentAction[1]);
        // عدسة التصفّح المفضّلة: تفضيل شخصيّ لا قرار منظمة، فبلا سبب ولا مُقرِّر ولا سجل (ترحيل 131).
        if(p==='/api/catalog/lens'&&req.method==='POST') return catalogHome.setLens(db,u,input);
        // سجل البحث (الدفعة الثالثة): بلا هوية، ونتائجه يعدّها الخادم بترتيب الشاشة نفسه، والسرّي لا يُسجَّل بصمت.
        if(p==='/api/catalog/search-log'&&req.method==='POST') return catalogHome.logSearchEvent(db,u,input);
        // «لا تقترح هذه عليّ» وإخفاء صفّ «لك»: تفضيلان شخصيان بلا حدث تدقيق (تعليق الترحيل 131).
        if(p==='/api/catalog/hide-suggestion'&&req.method==='POST') return catalogHome.hideSuggestion(db,u,input);
        if(p==='/api/catalog/suggestions-hidden'&&req.method==='POST') return catalogHome.setSuggestionsHidden(db,u,input);
        // المرادفات: سطح الكتابة الوحيد في لوح الشجرة، ولكل إضافة وحذف وتأكيد حدث تدقيق؛ والسرّي فعل شخصين.
        if(p==='/api/catalog/synonyms'&&req.method==='POST') return catalogAdmin.addSynonym(db,u,input);
        if(p==='/api/catalog/synonyms'&&req.method==='DELETE') return catalogAdmin.removeSynonym(db,u,input);
        if(p==='/api/catalog/synonyms/confirm'&&req.method==='POST') return catalogAdmin.confirmSynonym(db,u,input);
        if(p==='/api/catalog'&&req.method==='POST') {
          access.require(db,u,'catalog.manage');
          return once(()=>wf.createService(db,u,input),id=>wf.catalog(db,u).find(s=>s.id===id));
        }
        // رسالة التأكيد بعد الحفظ تقول المرحلة وعند من (whereabouts من الخط الزمني)، من الحمولة لا من نصٍّ في الشاشة.
        if(p==='/api/requests'&&req.method==='POST') {
          const saved=once(()=>wf.createRequest(db,u,applyVariant(db,u,input)),id=>wf.detail(db,u,id));
          return {...saved,whereabouts:requestTimeline.whereabouts(db,u,saved.id)};
        }
        if(p==='/api/projects'&&req.method==='POST') return once(()=>projects.createProject(db,u,input),id=>projects.listProjects(db,u).find(p=>p.id===id));
        if(p==='/api/delegations'&&req.method==='POST') return once(()=>delegations.createDelegation(db,u,input),id=>delegations.getDelegation(db,u,id));
        if(p==='/api/commercial'&&req.method==='POST') return once(()=>commercial.createLead(db,u,input),id=>commercial.listCommercial(db,u).find(r=>r.id===id));
        // الحزمة 4 — العملاء: فتح صفقة من الفرصة إنشاءٌ، فيمر بمفتاح التكرار؛ ورقم السجل يسجّله مسؤول الحساب على ملف العميل.
        const openCase=p.match(/^\/api\/pipeline\/opportunities\/([a-f0-9-]{36})\/open_case$/);
        if(openCase&&req.method==='POST') return once(()=>commercial.createCaseFromOpportunity(db,u,openCase[1],input),id=>commercial.dealSummary(db,u,id));
        const clientRegistration=p.match(/^\/api\/clients\/([a-f0-9-]+)\/registration$/);
        if(clientRegistration&&req.method==='POST') return agency.clientAction(db,u,clientRegistration[1],'set_registration',input);
        const proposalSubmit=p.match(/^\/api\/technical-proposal-reviews\/([a-f0-9-]{36})\/submit$/);
        if(proposalSubmit&&req.method==='POST') return commercial.submitTechnicalProposalChecklist(db,u,proposalSubmit[1],input);
        const proposalReview=p.match(/^\/api\/technical-proposal-reviews\/([a-f0-9-]{36})\/review$/);
        if(proposalReview&&req.method==='POST') return technicalProposal.reviewProposalChecklist(db,u,proposalReview[1],input);
        const emergencyStep=p.match(/^\/api\/procurement-extras\/emergencies\/([a-f0-9-]{36})\/(declare|approve|reject|review)$/);
        if(emergencyStep&&req.method==='POST') {
          const [,purchaseId,step]=emergencyStep;
          if(step==='declare') return procurementExtras.declareEmergency(db,u,purchaseId,input);
          if(step==='review') return procurementExtras.reviewEmergency(db,u,purchaseId,input);
          return procurementExtras.decideEmergency(db,u,purchaseId,step,input);
        }
        const orderChange=p.match(/^\/api\/procurement-extras\/orders\/([a-f0-9-]{36})\/change$/);
        if(orderChange&&req.method==='POST') return once(()=>procurementExtras.requestOrderChange(db,u,orderChange[1],input),id=>({id}));
        const changeDecision=p.match(/^\/api\/procurement-extras\/changes\/([a-f0-9-]{36})\/(approve|reject)$/);
        if(changeDecision&&req.method==='POST') return procurementExtras.decideOrderChange(db,u,changeDecision[1],changeDecision[2],input);
        if(p==='/api/procurement-extras/conflicts'&&req.method==='POST') return once(()=>procurementExtras.discloseConflict(db,u,input),id=>({id}));
        const conflictDecision=p.match(/^\/api\/procurement-extras\/conflicts\/([a-f0-9-]{36})\/(no_conflict|managed|recused|withdraw)$/);
        if(conflictDecision&&req.method==='POST') return procurementExtras.decideConflict(db,u,conflictDecision[1],conflictDecision[2],input);
        if(p==='/api/procurement'&&req.method==='POST') return once(()=>procurement.createPurchase(db,u,input),id=>procurement.listProcurement(db,u).find(r=>r.id===id));
        const rfqSubmit=p.match(/^\/api\/procurement-rfqs\/([a-f0-9-]{36})\/submit$/);
        if(rfqSubmit&&req.method==='POST') return procurement.submitRfq(db,u,rfqSubmit[1],input);
        const rfqReview=p.match(/^\/api\/procurement-rfqs\/([a-f0-9-]{36})\/review$/);
        if(rfqReview&&req.method==='POST') return procurementRfq.reviewRfq(db,u,rfqReview[1],input);
        if(p==='/api/reports/schedules'&&req.method==='POST') return once(()=>reportSchedules.createSchedule(db,u,input),id=>({id}));
        const scheduleStop=p.match(/^\/api\/reports\/schedules\/([a-f0-9-]{36})\/stop$/);
        if(scheduleStop&&req.method==='POST') return reportSchedules.stopSchedule(db,u,scheduleStop[1],input);
        const reportRun=p.match(/^\/api\/reports\/([A-Z]\d{2})\/(run|snapshots)$/);
        if(reportRun&&req.method==='POST') return reportRun[2]==='run'?reports.runReport(db,u,reportRun[1],input):once(()=>reports.saveSnapshot(db,u,reportRun[1],input),id=>({id}));
        const snapshotStep=p.match(/^\/api\/reports\/snapshots\/([a-f0-9-]+)\/(open|approve_snapshot|discard_snapshot)$/);
        if(snapshotStep&&req.method==='POST') return snapshotStep[2]==='open'?reports.readSnapshot(db,u,snapshotStep[1]):reports.snapshotAction(db,u,snapshotStep[1],snapshotStep[2],input);
        if(p==='/api/campaigns'&&req.method==='POST') return once(()=>campaigns.createCampaign(db,u,input),id=>({id}));
        const campaignStep=p.match(/^\/api\/campaigns\/([a-f0-9-]{36})\/(edit|check|request_launch|approve_launch|return_launch|result|spend|correct|pause|resume|complete|cancel)$/);
        if(campaignStep&&req.method==='POST') return campaigns.campaignAction(db,u,campaignStep[1],campaignStep[2],input);
        if(p==='/api/content'&&req.method==='POST') return once(()=>campaigns.createContent(db,u,input),id=>({id}));
        const contentStep=p.match(/^\/api\/content\/([a-f0-9-]{36})\/(edit|start|submit|pass|return|client_approve|client_changes|schedule|publish|cancel)$/);
        if(contentStep&&req.method==='POST') return campaigns.contentAction(db,u,contentStep[1],contentStep[2],input);
        if(p==='/api/scope'&&req.method==='POST') return once(()=>campaigns.createBaseline(db,u,input),id=>({id}));
        const scopeStep=p.match(/^\/api\/scope\/([a-f0-9-]{36})\/(record|close)$/);
        if(scopeStep&&req.method==='POST') return scopeStep[2]==='record'?campaigns.recordScope(db,u,scopeStep[1],input):campaigns.closeBaseline(db,u,scopeStep[1],input);
        const scopeDecision=p.match(/^\/api\/scope\/events\/([a-f0-9-]{36})\/decide$/);
        if(scopeDecision&&req.method==='POST') return campaigns.decideScope(db,u,scopeDecision[1],input);
        if(p==='/api/clients'&&req.method==='POST') return once(()=>agency.createClient(db,u,input),id=>({id}));
        // بلاغ العميل: فتحه إنشاءٌ يمر بمفتاح التكرار، وخطواته بنسخته.
        if(p==='/api/client-support'&&req.method==='POST') return once(()=>clientSupport.openSupportCase(db,u,input),id=>({id}));
        const supportStep=p.match(/^\/api\/client-support\/([a-f0-9-]{36})\/(respond_case|resolve_case|confirm_resolution|return_resolution|reassign_case)$/);
        if(supportStep&&req.method==='POST') return clientSupport.supportAction(db,u,supportStep[1],supportStep[2],input);
        // طلب إقفال ملف العميل أو إعادة فتحه إنشاءٌ بمفتاح التكرار، وقراره بنسخته.
        const offboardingOpen=p.match(/^\/api\/clients\/([a-f0-9-]{36})\/offboarding$/);
        if(offboardingOpen&&req.method==='POST') return once(()=>clientOffboarding.requestOffboarding(db,u,offboardingOpen[1],input),id=>({id}));
        const offboardingStep=p.match(/^\/api\/client-offboardings\/([a-f0-9-]{36})\/(approve_offboarding|reject_offboarding|withdraw_offboarding)$/);
        if(offboardingStep&&req.method==='POST') return clientOffboarding.offboardingAction(db,u,offboardingStep[1],offboardingStep[2],input);
        if(p==='/api/clients/retainers'&&req.method==='POST') return once(()=>agency.createRetainer(db,u,input),id=>({id}));
        const retainerUse=p.match(/^\/api\/clients\/retainers\/([a-f0-9-]+)\/usage$/);
        if(retainerUse&&req.method==='POST') return agency.recordRetainerUsage(db,u,retainerUse[1],input);
        const clientStep=p.match(/^\/api\/clients\/([a-f0-9-]+)\/(add_member|remove_member|add_brand|add_contact|link_case|set_status)$/);
        if(clientStep&&req.method==='POST') return agency.clientAction(db,u,clientStep[1],clientStep[2],input);
        if(p==='/api/offerings'&&req.method==='POST') return once(()=>agency.prepareOffering(db,u,input),id=>({id}));
        const offeringRevise=p.match(/^\/api\/offerings\/([a-f0-9-]+)\/revise$/);
        if(offeringRevise&&req.method==='POST') return once(()=>agency.prepareOffering(db,u,input,offeringRevise[1]),id=>({id}));
        const offeringStep=p.match(/^\/api\/offerings\/([a-f0-9-]+)\/(approve_offering|reject_offering|retire_offering)$/);
        if(offeringStep&&req.method==='POST') return agency.offeringAction(db,u,offeringStep[1],offeringStep[2],input);
        if(p==='/api/project-templates'&&req.method==='POST') return once(()=>agency.createTemplate(db,u,input),id=>({id}));
        const templateApply=p.match(/^\/api\/project-templates\/([a-f0-9-]+)\/apply$/);
        if(templateApply&&req.method==='POST') return agency.applyTemplate(db,u,templateApply[1],input);
        if(p==='/api/time'&&req.method==='POST') return once(()=>agency.logTime(db,u,input),id=>({id}));
        const timeStep=p.match(/^\/api\/time\/([a-f0-9-]+)\/(approve|reject|remove)$/);
        if(timeStep&&req.method==='POST') return timeStep[2]==='remove'?agency.removeTime(db,u,timeStep[1]):agency.decideTime(db,u,timeStep[1],timeStep[2],input);
        if(p==='/api/expenses/claims'&&req.method==='POST') return once(()=>expenses.submitClaim(db,u,input),id=>({id}));
        if(p==='/api/expenses/custodies'&&req.method==='POST') return once(()=>expenses.requestCustody(db,u,input),id=>({id}));
        // D-09: للموظف مخرج من مطالبته وعهدته قبل أول قرار، فلا يبقى الرفض طريقه الوحيد.
        const claimStep=p.match(/^\/api\/expenses\/claims\/([a-f0-9-]+)\/(manager_approve|finance_approve|reject_claim|record_reimbursement|withdraw_claim)$/);
        if(claimStep&&req.method==='POST') return expenses.claimAction(db,u,claimStep[1],claimStep[2],input);
        const custodyStep=p.match(/^\/api\/expenses\/custodies\/([a-f0-9-]+)\/(approve_custody|reject_custody|issue_custody|close_custody|withdraw_custody)$/);
        if(custodyStep&&req.method==='POST') return expenses.custodyAction(db,u,custodyStep[1],custodyStep[2],input);
        if(p==='/api/assets'&&req.method==='POST') return once(()=>fixedAssets.registerAsset(db,u,input),id=>({id}));
        if(p==='/api/assets/depreciation'&&req.method==='POST') return once(()=>fixedAssets.runDepreciation(db,u,input),id=>({id}));
        const assetStep=p.match(/^\/api\/assets\/([a-f0-9-]+)\/(approve_asset|reject_asset|dispose_asset)$/);
        if(assetStep&&req.method==='POST') return fixedAssets.assetAction(db,u,assetStep[1],assetStep[2],input);
        if(p==='/api/payroll/retro'&&req.method==='POST') return once(()=>payrollRetro.proposeRetro(db,u,input),id=>({id}));
        if(p==='/api/payroll/adjustments'&&req.method==='POST') return once(()=>payrollExtras.proposeAdjustment(db,u,input),id=>({id}));
        if(p==='/api/payroll/advances'&&req.method==='POST') return once(()=>payrollExtras.proposeAdvance(db,u,input),id=>({id}));
        if(p==='/api/payroll/employee-banks'&&req.method==='POST') return once(()=>payrollExtras.recordEmployeeBank(db,u,input),id=>({id}));
        if(p==='/api/payroll/payments'&&req.method==='POST') return once(()=>payrollExtras.preparePayrollPayment(db,u,input),id=>({id}));
        if(p==='/api/payroll/settlements'&&req.method==='POST') return once(()=>payrollExtras.prepareSettlement(db,u,input),id=>({id}));
        if(p==='/api/payroll/deductions'&&req.method==='POST') return once(()=>payrollExtras.proposeClassifiedDeduction(db,u,input),id=>({id}));
        const duesStep=p.match(/^\/api\/payroll\/settlements\/([a-f0-9-]+)\/record_dues_payment$/);
        if(duesStep&&req.method==='POST') return payrollExtras.recordSettlementDues(db,u,duesStep[1],input);
        if(p==='/api/payroll-rules'&&req.method==='POST') return once(()=>payrollRules.prepareRule(db,u,input),id=>({id}));
        const insuranceOverride=p.match(/^\/api\/payroll-insurance\/employees\/([a-z0-9-]{2,64})\/record_(prior_contribution_period|gcc_national|not_gcc_national)$/);
        if(insuranceOverride&&req.method==='POST') return once(()=>payrollInsurance.recordOverride(db,u,insuranceOverride[1],insuranceOverride[2],input),id=>({id}));
        const insuranceWithdraw=p.match(/^\/api\/payroll-insurance\/overrides\/([a-f0-9-]{36})\/withdraw_override$/);
        if(insuranceWithdraw&&req.method==='POST') return payrollInsurance.withdrawOverride(db,u,insuranceWithdraw[1],input);
        // المسير الموازي (الترحيل 176): الإنشاء بمفتاح التكرار، والقرار على السجل بنسخته. كل خطوة ثانية لغير صاحب الأولى.
        if(p==='/api/payroll-parallel/months'&&req.method==='POST') return once(()=>payrollParallel.declareParallelMonth(db,u,input),id=>({id}));
        if(p==='/api/payroll-parallel/batches'&&req.method==='POST') return once(()=>payrollParallel.importLegacyBatch(db,u,input),id=>({id}));
        if(p==='/api/payroll-parallel/comparisons'&&req.method==='POST') return once(()=>payrollParallel.compareParallelMonth(db,u,input),id=>({id}));
        if(p==='/api/payroll-parallel/cutovers'&&req.method==='POST') return once(()=>payrollParallel.recordCutover(db,u,input),id=>({id}));
        const parallelStep=p.match(/^\/api\/payroll-parallel\/(months|batches|comparisons|cutovers)\/([a-f0-9-]{36})\/(withdraw|confirm|reject|explain)$/);
        if(parallelStep&&req.method==='POST'){
          const [,kind,rowId,step]=parallelStep;
          if(kind==='months'&&step==='withdraw') return payrollParallel.withdrawParallelMonth(db,u,rowId,input);
          if(kind==='batches'&&step!=='explain') return payrollParallel.decideLegacyBatch(db,u,rowId,step,input);
          if(kind==='comparisons'&&step==='explain') return payrollParallel.explainDifferences(db,u,rowId,input);
          if(kind==='cutovers'&&['confirm','reject'].includes(step)) return payrollParallel.decideCutover(db,u,rowId,step,input);
          fail(404,'not_found',`ما فيه إجراء «${step}» على ${{months:'الشهر الموازي',batches:'دفعة النظام السابق',comparisons:'المقارنة الموازية',cutovers:'قرار الانتقال'}[kind]}`);
        }
        const ruleStep=p.match(/^\/api\/payroll-rules\/([a-z0-9-]{8,64})\/(accept|reject)$/);
        if(ruleStep&&req.method==='POST') return payrollRules.decideRule(db,u,ruleStep[1],ruleStep[2],input);
        if(p==='/api/resignations'&&req.method==='POST') return once(()=>resignations.submitResignation(db,u,input),id=>({id}));
        const resignationStep=p.match(/^\/api\/resignations\/([a-f0-9-]{36})\/(withdraw_resignation|accept_resignation|defer_resignation|set_last_day|open_offboarding)$/);
        if(resignationStep&&req.method==='POST') return resignations.resignationAction(db,u,resignationStep[1],resignationStep[2],input);
        if(p==='/api/travel'&&req.method==='POST') return once(()=>travel.proposeTravel(db,u,input),id=>({id}));
        const travelStep=p.match(/^\/api\/travel\/([a-f0-9-]{36})\/(approve_travel|reject_travel|cancel_travel|request_extension|submit_receipt)$/);
        if(travelStep&&req.method==='POST') return travel.travelAction(db,u,travelStep[1],travelStep[2],input);
        const extensionStep=p.match(/^\/api\/travel\/extensions\/([a-f0-9-]{36})\/(approve_extension|reject_extension)$/);
        if(extensionStep&&req.method==='POST') return travel.extensionAction(db,u,extensionStep[1],extensionStep[2],input);
        // الترحيل 112: تفعيل نسخة جدول البدل، والدرجة الوظيفية، وإقرار المدير، وتذاكر م41، والمزايا الثلاث.
        const versionStep=p.match(/^\/api\/secondment\/versions\/([a-z0-9-]{8,64})\/activate$/);
        if(versionStep&&req.method==='POST') return secondmentBenefits.activateAllowanceVersion(db,u,versionStep[1],input);
        if(p==='/api/secondment/grades'&&req.method==='POST') return secondmentBenefits.recordEmployeeGrade(db,u,input);
        const attestStep=p.match(/^\/api\/travel\/([a-f0-9-]{36})\/attestation$/);
        if(attestStep&&req.method==='POST') return secondmentBenefits.recordAttestation(db,u,attestStep[1],input);
        const ticketStep=p.match(/^\/api\/travel\/([a-f0-9-]{36})\/ticket$/);
        if(ticketStep&&req.method==='POST') return once(()=>secondmentBenefits.recordTicket(db,u,ticketStep[1],input),id=>({id}));
        if(p==='/api/benefit-extras/settings'&&req.method==='POST') return secondmentBenefits.saveBenefitSettings(db,u,input);
        if(p==='/api/benefit-extras/caps'&&req.method==='POST') return secondmentBenefits.setGradeCap(db,u,input);
        if(p==='/api/benefit-extras/parents'&&req.method==='POST') return once(()=>secondmentBenefits.submitParentsInsurance(db,u,input),id=>({id}));
        if(p==='/api/benefit-extras/education'&&req.method==='POST') return once(()=>secondmentBenefits.submitEducationClaim(db,u,input),id=>({id}));
        if(p==='/api/benefit-extras/sports'&&req.method==='POST') return once(()=>secondmentBenefits.submitSportsClaim(db,u,input),id=>({id}));
        if(p==='/api/benefit-extras/payroll'&&req.method==='POST') return secondmentBenefits.handExtraToPayroll(db,u,input);
        const extraStep=p.match(/^\/api\/benefit-extras\/([a-f0-9-]{36})\/(hr_quote|consent|authority_approve|hr_approve|hr_reject|finance_approve|finance_reject|withdraw)$/);
        if(extraStep&&req.method==='POST'){
          const [,rowId,step]=extraStep;
          if(step==='hr_quote')return secondmentBenefits.hrQuoteParents(db,u,rowId,input);
          if(step==='consent')return secondmentBenefits.consentToDeduction(db,u,rowId,input);
          if(step==='authority_approve')return secondmentBenefits.authorityApproveParents(db,u,rowId,input);
          if(step==='withdraw')return secondmentBenefits.withdrawExtraRequest(db,u,rowId,input);
          if(step.startsWith('hr_'))return secondmentBenefits.hrDecideClaim(db,u,rowId,step.slice(3),input);
          return secondmentBenefits.financeCompleteClaim(db,u,rowId,step.slice(8),input);
        }
        const extrasDecision=p.match(/^\/api\/payroll\/(adjustments|advances|employee-banks|settlements)\/([a-f0-9-]+)\/(approve|reject|verify)$/);
        if(extrasDecision&&req.method==='POST'){
          const [,kind,rowId,decision]=extrasDecision;
          if(kind==='adjustments')return payrollExtras.decideAdjustment(db,u,rowId,decision,input);
          if(kind==='advances')return payrollExtras.decideAdvance(db,u,rowId,decision,input);
          if(kind==='employee-banks')return payrollExtras.decideEmployeeBank(db,u,rowId,decision,input);
          return payrollExtras.decideSettlement(db,u,rowId,decision,input);
        }
        const payrollPaymentStep=p.match(/^\/api\/payroll\/payments\/([a-f0-9-]+)\/(approve_payment|cancel_payment|record_payment_execution)$/);
        if(payrollPaymentStep&&req.method==='POST') return payrollExtras.payrollPaymentAction(db,u,payrollPaymentStep[1],payrollPaymentStep[2],input);
        if(p==='/api/payables/orders'&&req.method==='POST') return once(()=>payables.getOrder(db,u,payables.preparePayment(db,u,input).id),id=>payables.getOrder(db,u,id));
        const paymentStep=p.match(/^\/api\/payables\/orders\/([a-f0-9-]+)\/(approve_order|reject_order|cancel_order|release_first_payment|record_execution|record_return)$/);
        if(paymentStep&&req.method==='POST') return payables.paymentAction(db,u,paymentStep[1],paymentStep[2],input);
        // تسويات المستحق (الترحيل 166): إشعار دائن أو مدين من المورد يُسجَّل بمفتاح تكرار، ويقرّر فيه زميل ثانٍ.
        if(p==='/api/payables/adjustments'&&req.method==='POST') return once(()=>payables.getAdjustment(db,u,payables.recordAdjustment(db,u,input).id),id=>payables.getAdjustment(db,u,id));
        const adjustmentStep=p.match(/^\/api\/payables\/adjustments\/([a-f0-9-]+)\/(approve|reject)$/);
        if(adjustmentStep&&req.method==='POST') return payables.decideAdjustment(db,u,adjustmentStep[1],adjustmentStep[2],input);
        if(p==='/api/payables/input-tax'&&req.method==='POST') return once(()=>payables.recordInputTax(db,u,input),id=>({id}));
        const taxDecision=p.match(/^\/api\/payables\/input-tax\/([a-f0-9-]+)\/(verify|reject)$/);
        if(taxDecision&&req.method==='POST') return payables.decideInputTax(db,u,taxDecision[1],taxDecision[2],input);
        if(p==='/api/ledger/mappings'&&req.method==='POST') return once(()=>ledger.recordMapping(db,u,input),id=>({id}));
        const mappingApprove=p.match(/^\/api\/ledger\/mappings\/([a-f0-9-]+)\/approve$/);
        if(mappingApprove&&req.method==='POST') return ledger.approveMapping(db,u,mappingApprove[1],input);
        // الحزمة 4 (P4-HR-3، الترحيل 174): مركز تكلفة الإدارة يسجّله حامل الإعداد المالي ويقرره غيره، وصرف السلفة يسجّله غير صاحبها ومقترحها ومعتمدها.
        if(p==='/api/ledger/department-centres'&&req.method==='POST') return once(()=>payrollLedger.recordDepartmentCentre(db,u,input),id=>({id}));
        const departmentCentreStep=p.match(/^\/api\/ledger\/department-centres\/([a-f0-9-]{36})\/(approve|reject)$/);
        if(departmentCentreStep&&req.method==='POST') return payrollLedger.decideDepartmentCentre(db,u,departmentCentreStep[1],departmentCentreStep[2],input);
        const advancePayout=p.match(/^\/api\/payroll\/advances\/([a-f0-9-]{36})\/record_disbursement$/);
        if(advancePayout&&req.method==='POST') return payrollLedger.recordAdvanceDisbursement(db,u,advancePayout[1],input);
        if(p==='/api/ledger/journals'&&req.method==='POST') return once(()=>ledger.journalFromSource(db,u,input),id=>finance.listFinance(db,u).journals.find(j=>j.id===id));
        if(p==='/api/payroll/runs'&&req.method==='POST') return once(()=>payroll.getRun(db,u,payroll.prepareRun(db,u,input).id),id=>payroll.getRun(db,u,id));
        const payrollStep=p.match(/^\/api\/payroll\/runs\/([a-f0-9-]+)\/([a-z_]+)$/);
        if(payrollStep&&req.method==='POST') return payroll.runAction(db,u,payrollStep[1],payrollStep[2],input);
        if(p==='/api/attendance/punch'&&req.method==='POST') return attendance.punch(db,u,input);
        if(p==='/api/attendance/corrections'&&req.method==='POST') return once(()=>attendance.requestCorrection(db,u,input),id=>({id}));
        const correctionDecision=p.match(/^\/api\/attendance\/corrections\/([a-f0-9-]+)\/(approve|reject)$/);
        if(correctionDecision&&req.method==='POST') return attendance.decideCorrection(db,u,correctionDecision[1],correctionDecision[2],input);
        if(p==='/api/attendance/holidays'&&req.method==='POST') return once(()=>attendanceExtras.proposeHoliday(db,u,input),id=>({id}));
        if(p==='/api/attendance/missions'&&req.method==='POST') return once(()=>attendanceExtras.requestMission(db,u,input),id=>({id}));
        if(p==='/api/attendance/shifts'&&req.method==='POST') return once(()=>attendanceExtras.assignShift(db,u,input),id=>({id}));
        if(p==='/api/attendance/overtime'&&req.method==='POST') return once(()=>attendanceExtras.requestOvertime(db,u,input),id=>({id}));
        const attendanceExtra=p.match(/^\/api\/attendance\/(holidays|missions|shifts|overtime)\/([a-f0-9-]{36})\/(approve|reject|cancel|end|payroll)$/);
        if(attendanceExtra&&req.method==='POST') {
          const [,kind,rowId,step]=attendanceExtra;
          if(kind==='holidays'&&['approve','reject'].includes(step)) return attendanceExtras.decideHoliday(db,u,rowId,step,input);
          if(kind==='missions'&&['approve','reject','cancel'].includes(step)) return attendanceExtras.decideMission(db,u,rowId,step,input);
          if(kind==='shifts'&&step==='end') return attendanceExtras.endShift(db,u,rowId,input);
          if(kind==='overtime'&&['approve','reject'].includes(step)) return attendanceExtras.decideOvertime(db,u,rowId,step,input);
          if(kind==='overtime'&&step==='payroll') return attendanceExtras.overtimeToPayroll(db,u,rowId,input);
          fail(404,'not_found','المسار غير متاح');
        }
        // الإجازة التعويضية (ترحيل 125): إحالة رصيد انقضت مهلته إلى المسير (مُعد الرواتب)، وقيد رصيد عن ساعات اعتُمدت قبل الدفتر (معتمد الحضور).
        const compensatoryStep=p.match(/^\/api\/attendance\/compensatory\/([a-f0-9-]{36})\/(payroll|credit)$/);
        if(compensatoryStep&&req.method==='POST') return compensatoryStep[2]==='payroll'?leaveCompensatory.compensatoryToPayroll(db,u,compensatoryStep[1],input):leaveCompensatory.creditLegacy(db,u,compensatoryStep[1],input);
        if(p==='/api/attendance/absences'&&req.method==='POST') return once(()=>attendance.proposeAbsence(db,u,input),id=>({id}));
        // قواعد الحضور (099): تكليف العمل الإضافي، والاستئذان، وإشعار اليوم، والإعفاءات، ومواقع الحضور ونتائج البصمة.
        if(p==='/api/attendance/overtime-assignments'&&req.method==='POST') return once(()=>overtimeRules.assignOvertime(db,u,input),id=>({id}));
        if(p==='/api/attendance/permissions'&&req.method==='POST') return once(()=>attendanceRules.requestPermission(db,u,input),id=>({id}));
        if(p==='/api/attendance/notices'&&req.method==='POST') return once(()=>attendanceRules.giveNotice(db,u,input),id=>({id}));
        if(p==='/api/attendance/exemptions'&&req.method==='POST') return once(()=>attendanceRules.proposeExemption(db,u,input),id=>({id}));
        if(p==='/api/attendance/sites'&&req.method==='POST') return once(()=>attendanceLocation.proposeSite(db,u,input),id=>({id}));
        const attendanceRule=p.match(/^\/api\/attendance\/(overtime-assignments|permissions|notices|exemptions|sites|locations)\/([a-f0-9-]{36})\/(authorise|budget|reject|cancel|approve|accept|retire|explain|review)$/);
        if(attendanceRule&&req.method==='POST') {
          const [,kind,rowId,step]=attendanceRule;
          if(kind==='overtime-assignments'&&['authorise','budget','reject','cancel'].includes(step)) return overtimeRules.decideAssignment(db,u,rowId,step,input);
          if(kind==='permissions'&&['approve','reject','cancel'].includes(step)) return attendanceRules.decidePermission(db,u,rowId,step,input);
          if(kind==='notices'&&['accept','reject'].includes(step)) return attendanceRules.decideNotice(db,u,rowId,step,input);
          if(kind==='exemptions'&&['approve','reject'].includes(step)) return attendanceRules.decideExemption(db,u,rowId,step,input);
          if(kind==='sites'&&['approve','reject','retire'].includes(step)) return attendanceLocation.decideSite(db,u,rowId,step,input);
          if(kind==='locations'&&step==='explain') return attendanceLocation.explainLocation(db,u,rowId,input);
          if(kind==='locations'&&step==='review') return attendanceLocation.reviewLocation(db,u,rowId,input);
          fail(404,'not_found','المسار غير متاح');
        }
        const absenceStatement=p.match(/^\/api\/attendance\/absences\/([a-f0-9-]+)\/statement$/);
        if(absenceStatement&&req.method==='POST') return attendance.stateAbsence(db,u,absenceStatement[1],input);
        const absenceDecision=p.match(/^\/api\/attendance\/absences\/([a-f0-9-]+)\/(confirm|dismiss)$/);
        if(absenceDecision&&req.method==='POST') return attendance.decideAbsence(db,u,absenceDecision[1],absenceDecision[2],input);
        if(p==='/api/hr/policies'&&req.method==='POST') return once(()=>hrContracts.preparePolicy(db,u,input),id=>({id}));
        const policyDecision=p.match(/^\/api\/hr\/policies\/([a-f0-9-]+)\/(accept|reject)$/);
        if(policyDecision&&req.method==='POST') return hrContracts.decidePolicy(db,u,policyDecision[1],policyDecision[2],input);
        if(p==='/api/hr/contracts'&&req.method==='POST') return once(()=>hrContracts.getContract(db,u,hrContracts.prepareContract(db,u,input).id),id=>hrContracts.getContract(db,u,id));
        const contractAmend=p.match(/^\/api\/hr\/contracts\/([a-f0-9-]+)\/amend$/);
        if(contractAmend&&req.method==='POST') return once(()=>hrContracts.getContract(db,u,hrContracts.prepareContract(db,u,input,contractAmend[1]).id),id=>hrContracts.getContract(db,u,id));
        const contractStep=p.match(/^\/api\/hr\/contracts\/([a-f0-9-]+)\/(submit_contract|approve_contract|return_contract|reject_contract|end_contract)$/);
        if(contractStep&&req.method==='POST') return hrContracts.contractAction(db,u,contractStep[1],contractStep[2],input);
        if(p==='/api/invoices'&&req.method==='POST') return once(()=>invoices.getInvoice(db,u,invoices.prepareInvoice(db,u,input).id),id=>invoices.getInvoice(db,u,id));
        if(p==='/api/invoices/company-profiles'&&req.method==='POST') return once(()=>invoices.recordCompanyProfile(db,u,input),id=>({id}));
        if(p==='/api/invoices/customer-profiles'&&req.method==='POST') return once(()=>invoices.recordCustomerProfile(db,u,input),id=>({id}));
        const profileApprove=p.match(/^\/api\/invoices\/company-profiles\/([a-f0-9-]+)\/approve$/);
        if(profileApprove&&req.method==='POST') return invoices.approveCompanyProfile(db,u,profileApprove[1],input);
        const creditNote=p.match(/^\/api\/invoices\/([a-f0-9-]+)\/credit$/);
        if(creditNote&&req.method==='POST') return once(()=>invoices.getInvoice(db,u,invoices.prepareCreditNote(db,u,creditNote[1],input).id),id=>invoices.getInvoice(db,u,id));
        const invoiceStep=p.match(/^\/api\/invoices\/([a-f0-9-]+)\/(submit|issue|return|reject)$/);
        if(invoiceStep&&req.method==='POST') return invoices.invoiceAction(db,u,invoiceStep[1],invoiceStep[2],input);
        if(p==='/api/approvals'&&req.method==='POST') return once(()=>clientApprovals.getApproval(db,u,clientApprovals.recordApproval(db,u,input).id),id=>clientApprovals.getApproval(db,u,id));
        if(p==='/api/approvals/approvers'&&req.method==='POST') return once(()=>{const created=clientApprovals.registerApprover(db,u,input);return clientApprovals.listApprovals(db,u).approvers.find(a=>a.id===created.id);},id=>clientApprovals.listApprovals(db,u).approvers.find(a=>a.id===id));
        const approverRevoke=p.match(/^\/api\/approvals\/approvers\/([a-f0-9-]+)\/revoke$/);
        if(approverRevoke&&req.method==='POST') return clientApprovals.revokeApprover(db,u,approverRevoke[1],input);
        const approvalStep=p.match(/^\/api\/approvals\/([a-f0-9-]+)\/(add_evidence|verify|withdraw)$/);
        if(approvalStep&&req.method==='POST') return clientApprovals.approvalAction(db,u,approvalStep[1],approvalStep[2],input);
        if(p==='/api/vendors'&&req.method==='POST') return once(()=>vendors.getVendor(db,u,vendors.createVendor(db,u,input).id),id=>vendors.getVendor(db,u,id));
        const vendorAction=p.match(/^\/api\/vendors\/([a-f0-9-]+)\/([a-z_]+)$/);
        if(vendorAction&&req.method==='POST') return vendors.vendorAction(db,u,vendorAction[1],vendorAction[2],input);
        if(p==='/api/leave/requests'&&req.method==='POST') return once(()=>leave.createLeaveRequest(db,u,input),id=>leave.getLeaveRequest(db,u,id));
        if(p==='/api/leave/openings'&&req.method==='POST') return once(()=>leave.grantLeaveOpening(db,u,input),id=>leave.getLeaveBalance(db,u,id));
        // أنواع الإجازات النظامية وإعدادها (ترحيل 098)
        if(p==='/api/leave/types/draft'&&req.method==='POST') return once(()=>leaveTypes.prepareLeaveTypesDraft(db,u,input),id=>({id}));
        const leaveTypesStep=p.match(/^\/api\/leave\/types\/([a-f0-9-]{36})\/(accept|reject)$/);
        if(leaveTypesStep&&req.method==='POST') return leaveTypes.decideLeaveTypes(db,u,leaveTypesStep[1],leaveTypesStep[2],input);
        if(p==='/api/leave/calendars'&&req.method==='POST') return once(()=>leaveTypes.createLeaveCalendar(db,u,input),id=>({id}));
        if(p==='/api/leave/holidays/statutory'&&req.method==='POST') return leaveTypes.proposeStatutoryHolidays(db,u,input);
        if(p==='/api/people/requisitions'&&req.method==='POST')return once(()=>people.createRequisition(db,u,input),id=>people.getPeopleRecord(db,u,id));
        if(p==='/api/studio'&&req.method==='POST')return once(()=>studio.createStudio(db,u,input),id=>studio.listStudio(db,u).find(r=>r.id===id));
        if(p==='/api/work/tasks'&&req.method==='POST') return once(()=>({id:workspace.addPersonalTask(db,u,input)}),()=>workspace.workBoard(db,u,{requests:wf.listRequests(db,u,'',''),projects:projects.listProjects(db,u)}));
        const personalTask=p.match(/^\/api\/work\/tasks\/([a-f0-9-]+)$/);
        if(personalTask&&req.method==='PATCH') return workspace.updatePersonalTask(db,u,personalTask[1],input);
        if(personalTask&&req.method==='POST'&&input?.action==='delete') return workspace.deletePersonalTask(db,u,personalTask[1]);
        const profile=p.match(/^\/api\/employees\/([a-z0-9._-]+)\/profile$/);
        if(profile&&req.method==='POST') return employees.saveProfile(db,u,profile[1],input);
        const personalPath=p.match(/^\/api\/employee-profile\/([a-z0-9._-]+)\/personal$/);
        if(personalPath&&req.method==='POST') return employeeProfile.saveEmployeePersonal(db,u,personalPath[1],input);
        const document=p.match(/^\/api\/employees\/([a-z0-9._-]+)\/documents$/);
        if(document&&req.method==='POST') return once(()=>employees.addDocument(db,u,document[1],input),()=>employees.employeeRecord(db,u,document[1]),r=>r.document_id);
        const change=p.match(/^\/api\/employees\/([a-z0-9._-]+)\/changes$/);
        if(change&&req.method==='POST') return once(()=>employees.recordChange(db,u,change[1],input),()=>employees.employeeRecord(db,u,change[1]),r=>r.change_id);
        const cancelChange=p.match(/^\/api\/employee-changes\/([a-f0-9-]+)\/cancel$/);
        if(cancelChange&&req.method==='POST') return employees.cancelChange(db,u,cancelChange[1],input);
        // الحزمة 4 (P4-HR-1/2): اعتماد التغيير الوظيفي المؤرخ بيد ثانية، وتطبيق المستحق منه بطلب صريح (لا بفتح الشاشة)،
        // وموافقة العامل الخطية على خصم من أجره (م51) بهويته. ربط التوظيف يمر بمسار /api/people/:id/link_hire القائم.
        const approveChange=p.match(/^\/api\/employee-changes\/([a-f0-9-]+)\/approve$/);
        if(approveChange&&req.method==='POST') return employees.approveChange(db,u,approveChange[1],input);
        if(p==='/api/employee-changes/apply-due'&&req.method==='POST') return employees.applyDueChangesNow(db,u,input);
        const deductionConsent=p.match(/^\/api\/payroll\/adjustments\/([a-f0-9-]+)\/consent$/);
        if(deductionConsent&&req.method==='POST') return payrollExtras.consentToDeduction(db,u,deductionConsent[1],input);
        const feedbackPath=p.match(/^\/api\/requests\/([a-f0-9-]+)\/feedback$/);
        if(feedbackPath&&req.method==='POST'){recordFeedback(db,u,feedbackPath[1],input);return requestView(db,u,feedbackPath[1]);}
        const transfer=p.match(/^\/api\/requests\/([a-f0-9-]+)\/transfer$/);
        if(transfer&&req.method==='POST') return routing.transferRequest(db,u,transfer[1],input)&&requestView(db,u,transfer[1]);
        const taskCreate=p.match(/^\/api\/requests\/([a-f0-9-]+)\/tasks$/);
        if(taskCreate&&req.method==='POST') return once(()=>routing.assignRequestTask(db,u,taskCreate[1],input),()=>requestView(db,u,taskCreate[1]));
        const taskSettle=p.match(/^\/api\/requests\/([a-f0-9-]+)\/tasks\/([a-f0-9-]+)$/);
        if(taskSettle&&req.method==='POST') return routing.settleRequestTask(db,u,taskSettle[1],taskSettle[2],input)&&requestView(db,u,taskSettle[1]);
        const peopleAction=p.match(/^\/api\/people\/([a-f0-9-]+)\/([a-z_]+)$/);
        if(peopleAction&&req.method==='POST'){
          if(peopleAction[2]==='add_candidate')return once(()=>people.addCandidate(db,u,peopleAction[1],input),id=>people.getPeopleRecord(db,u,id));
          return people.peopleAction(db,u,peopleAction[1],peopleAction[2],input);
        }
        const onboarding=p.match(/^\/api\/people\/tasks\/([a-f0-9-]+)\/complete$/);
        if(onboarding&&req.method==='POST')return people.completeOnboardingTask(db,u,onboarding[1],input);
        const studioAction=p.match(/^\/api\/studio\/([a-f0-9-]+)\/([a-z_]+)$/);
        if(studioAction&&req.method==='POST')return studio.studioAction(db,u,studioAction[1],studioAction[2],input);
        const financeReference=p.match(/^\/api\/finance\/(accounts|cost_centers|periods)(?:\/([a-f0-9-]+)\/(activate|deactivate|close))?$/);
        if(financeReference&&req.method==='POST'){
          const [,kind,id,action]=financeReference;
          if(id)return finance.financeReferenceAction(db,u,kind,id,action,input);
          return once(()=>finance.createFinanceReference(db,u,kind,input),id=>finance.listFinance(db,u)[kind].find(r=>r.id===id));
        }
        if(p==='/api/budgets'&&req.method==='POST')return once(()=>budgets.createBudget(db,u,input),id=>budgets.getBudget(db,u,id));
        const budget=p.match(/^\/api\/budgets\/([a-f0-9-]+)\/(edit|revise|submit|approve|return|reject|close)$/);
        if(budget&&req.method==='POST')return budgets.budgetAction(db,u,budget[1],budget[2],input);
        const scope=p.match(/^\/api\/projects\/([a-f0-9-]+)\/finance-scope$/);
        if(scope&&req.method==='POST')return once(()=>budgets.grantProjectFinanceAccess(db,u,scope[1],input),id=>budgets.getProjectFinanceGrant(db,u,id));
        const revokeScope=p.match(/^\/api\/budget-grants\/([a-f0-9-]+)\/revoke$/);
        if(revokeScope&&req.method==='POST')return budgets.revokeProjectFinanceAccess(db,u,revokeScope[1],input);
        // التفويض المالي: يُمنح بتاريخ انتهاء، ولا يمنحه أحد لنفسه، ويُسحب ولا يُمحى.
        if(p==='/api/finance-grants'&&req.method==='POST')return once(()=>financeGrants.grantFinanceAction(db,u,input),id=>({id}));
        const financeGrantRevoke=p.match(/^\/api\/finance-grants\/([a-f0-9-]{36})\/revoke$/);
        if(financeGrantRevoke&&req.method==='POST')return financeGrants.revokeFinanceGrant(db,u,financeGrantRevoke[1],input);
        if(p==='/api/finance/journals'&&req.method==='POST')return once(()=>finance.createJournal(db,u,input),id=>finance.listFinance(db,u).journals.find(j=>j.id===id));
        if(p==='/api/finance/from-payable'&&req.method==='POST')return once(()=>finance.createJournalFromPayable(db,u,input),id=>finance.listFinance(db,u).journals.find(j=>j.id===id));
        if(p==='/api/receivables'&&req.method==='POST')return once(()=>receivables.createClaim(db,u,input),id=>receivables.listReceivables(db,u).claims.find(c=>c.id===id));
        const claimAction=p.match(/^\/api\/receivables\/([a-f0-9-]+)\/(submit|approve|return|reject)$/);
        if(claimAction&&req.method==='POST')return receivables.claimAction(db,u,claimAction[1],claimAction[2],input);
        const receiptCreate=p.match(/^\/api\/receivables\/([a-f0-9-]+)\/receipts$/);
        if(receiptCreate&&req.method==='POST')return once(()=>receivables.recordReceipt(db,u,receiptCreate[1],input),receiptId=>receivables.getReceipt(db,u,receiptId));
        const receiptAction=p.match(/^\/api\/receivables\/([a-f0-9-]+)\/receipts\/([a-f0-9-]+)\/(confirm|reject)$/);
        if(receiptAction&&req.method==='POST')return receivables.receiptAction(db,u,receiptAction[1],receiptAction[2],receiptAction[3],input);
        // التحصيل والتسوية (الحزمة 3، الترحيل 170): القبض على حساب العميل وتخصيصه وعكسه، وعكس القبض، وإلغاء الاستحقاق، والنزاع والوعد.
        // كل إنشاء بمفتاح تكرار (once)، وكل قرار يعيد الفحص في app/receivables.mjs ويرفض بمكتوب.
        if(p==='/api/receivables/on-account'&&req.method==='POST')return once(()=>receivables.recordAccountReceipt(db,u,input),id=>receivables.getReceivableRecord(db,u,'account_receipt',id));
        const arAccountStep=p.match(/^\/api\/receivables\/on-account\/([a-f0-9-]{36})\/(confirm|reject)$/);
        if(arAccountStep&&req.method==='POST')return receivables.accountReceiptAction(db,u,arAccountStep[1],arAccountStep[2],input);
        const arAllocate=p.match(/^\/api\/receivables\/on-account\/([a-f0-9-]{36})\/allocations$/);
        if(arAllocate&&req.method==='POST')return once(()=>receivables.allocateReceipt(db,u,arAllocate[1],input),id=>receivables.getReceivableRecord(db,u,'account_receipt',id));
        const arUnallocate=p.match(/^\/api\/receivables\/on-account\/([a-f0-9-]{36})\/allocations\/([a-f0-9-]{36})\/reverse$/);
        if(arUnallocate&&req.method==='POST')return receivables.reverseAllocation(db,u,arUnallocate[1],arUnallocate[2],input);
        const arAccountReversal=p.match(/^\/api\/receivables\/on-account\/([a-f0-9-]{36})\/reversals$/);
        if(arAccountReversal&&req.method==='POST')return once(()=>receivables.requestAccountReversal(db,u,arAccountReversal[1],input),id=>receivables.getReceivableRecord(db,u,'account_reversal',id));
        const arAccountDecision=p.match(/^\/api\/receivables\/on-account\/([a-f0-9-]{36})\/reversals\/([a-f0-9-]{36})\/(approve|reject)$/);
        if(arAccountDecision&&req.method==='POST')return receivables.decideAccountReversal(db,u,arAccountDecision[1],arAccountDecision[2],arAccountDecision[3],input);
        const arCancel=p.match(/^\/api\/receivables\/([a-f0-9-]{36})\/cancel$/);
        if(arCancel&&req.method==='POST')return once(()=>receivables.requestClaimCancel(db,u,arCancel[1],input),id=>receivables.getReceivableRecord(db,u,'adjustment',id));
        const arReverse=p.match(/^\/api\/receivables\/([a-f0-9-]{36})\/receipts\/([a-f0-9-]{36})\/reverse$/);
        if(arReverse&&req.method==='POST')return once(()=>receivables.requestReceiptReversal(db,u,arReverse[1],arReverse[2],input),id=>receivables.getReceivableRecord(db,u,'adjustment',id));
        const arAdjustment=p.match(/^\/api\/receivables\/([a-f0-9-]{36})\/adjustments\/([a-f0-9-]{36})\/(approve|reject)$/);
        if(arAdjustment&&req.method==='POST')return receivables.decideAdjustment(db,u,arAdjustment[1],arAdjustment[2],arAdjustment[3],input);
        const arDispute=p.match(/^\/api\/receivables\/([a-f0-9-]{36})\/disputes$/);
        if(arDispute&&req.method==='POST')return once(()=>receivables.openDispute(db,u,arDispute[1],input),id=>receivables.getReceivableRecord(db,u,'dispute',id));
        const arResolve=p.match(/^\/api\/receivables\/([a-f0-9-]{36})\/disputes\/([a-f0-9-]{36})\/resolve$/);
        if(arResolve&&req.method==='POST')return receivables.resolveDispute(db,u,arResolve[1],arResolve[2],input);
        const arPromise=p.match(/^\/api\/receivables\/([a-f0-9-]{36})\/promises$/);
        if(arPromise&&req.method==='POST')return once(()=>receivables.recordPromise(db,u,arPromise[1],input),id=>receivables.getReceivableRecord(db,u,'promise',id));
        const journal=p.match(/^\/api\/finance\/journals\/([a-f0-9-]+)\/(edit|submit|return|approve|reject|post|reverse)$/);
        if(journal&&req.method==='POST')return finance.journalAction(db,u,journal[1],journal[2],input);
        // استثناءات المشتريات (الترحيل 169): المرتجع وقرار الفاتورة الموقوفة والإلغاء والتنازل، وإشعار المورد عبر واجهة المدفوعات.
        // قبل المسار العام لإجراءات الطلب لأن أسماءها تطابق نمطه.
        const procurementException=p.match(/^\/api\/procurement\/([a-f0-9-]{36})\/(record_return|decide_invoice|propose_void|decide_void|waive_credit)$/);
        if(procurementException&&req.method==='POST') return procurementExceptions.exceptionAction(db,u,procurementException[1],procurementException[2],input);
        const supplierNote=p.match(/^\/api\/procurement\/([a-f0-9-]{36})\/supplier-notes$/);
        if(supplierNote&&req.method==='POST') return once(()=>payables.getAdjustment(db,u,procurementExceptions.recordSupplierNote(db,u,supplierNote[1],input).id),id=>payables.getAdjustment(db,u,id));
        const operation=p.match(/^\/api\/(commercial|procurement|delegations|leave\/requests)\/([a-f0-9-]+)\/([a-z_]+)$/);
        if(operation&&req.method==='POST'){
          const [,module,id,action]=operation;
          if(module==='commercial')return commercial.commercialAction(db,u,id,action,input);
          if(module==='procurement')return procurement.procurementAction(db,u,id,action,input);
          if(module==='leave/requests')return leave.leaveAction(db,u,id,action,input);
          if(module==='delegations'&&action==='revoke')return delegations.revokeDelegation(db,u,id,input);
        }
        // ——— الوحدات الجديدة: الكتابة (docs/implementation/WIRING-SPEC.md). المسارات الخاصة قبل العامة في كل وحدة. ———
        // المطابقة البنكية
        if(p==='/api/bank-reconciliation/accounts'&&req.method==='POST') return once(()=>bank.createBankAccount(db,u,input),id=>({id}));
        if(p==='/api/bank-reconciliation/profiles'&&req.method==='POST') return once(()=>bank.saveImportProfile(db,u,input),id=>({id}));
        if(p==='/api/bank-reconciliation/imports'&&req.method==='POST') return once(()=>bank.importStatement(db,u,input),id=>({id}));
        if(p==='/api/bank-reconciliation/matches'&&req.method==='POST') return once(()=>bank.proposeMatch(db,u,input),id=>({id}));
        if(p==='/api/bank-reconciliation/rules'&&req.method==='POST') return once(()=>bank.createRule(db,u,input),id=>({id}));
        if(p==='/api/bank-reconciliation/reconciliations'&&req.method==='POST') return once(()=>bank.prepareReconciliation(db,u,input),id=>({id}));
        const bankProfileStep=p.match(/^\/api\/bank-reconciliation\/profiles\/([a-f0-9-]{36})\/deactivate$/);
        if(bankProfileStep&&req.method==='POST') return bank.deactivateProfile(db,u,bankProfileStep[1],input);
        const bankImportStep=p.match(/^\/api\/bank-reconciliation\/imports\/([a-f0-9-]{36})\/cancel$/);
        if(bankImportStep&&req.method==='POST') return bank.cancelImport(db,u,bankImportStep[1],input);
        const bankMatchStep=p.match(/^\/api\/bank-reconciliation\/matches\/([a-f0-9-]{36})\/(approve|reject)$/);
        if(bankMatchStep&&req.method==='POST') return bank.decideMatch(db,u,bankMatchStep[1],bankMatchStep[2],input);
        const bankRuleStep=p.match(/^\/api\/bank-reconciliation\/rules\/([a-f0-9-]{36})\/deactivate$/);
        if(bankRuleStep&&req.method==='POST') return bank.deactivateRule(db,u,bankRuleStep[1],input);
        const bankReconStep=p.match(/^\/api\/bank-reconciliation\/reconciliations\/([a-f0-9-]{36})\/(approve|cancel)$/);
        if(bankReconStep&&req.method==='POST') return bankReconStep[2]==='approve'?bank.approveReconciliation(db,u,bankReconStep[1],input):bank.cancelReconciliation(db,u,bankReconStep[1],input);
        // الفوترة الدورية والاشتراكات
        if(p==='/api/billing-schedules'&&req.method==='POST') return once(()=>billingRecurring.createSchedule(db,u,input),id=>({id}));
        const billingScheduleStep=p.match(/^\/api\/billing-schedules\/([a-f0-9-]{36})\/(pause_schedule|resume_schedule|end_schedule)$/);
        if(billingScheduleStep&&req.method==='POST') return billingRecurring.scheduleAction(db,u,billingScheduleStep[1],billingScheduleStep[2],input);
        const billingDraftStep=p.match(/^\/api\/billing-drafts\/([a-f0-9-]{36})\/(mark_issued|dismiss_draft)$/);
        if(billingDraftStep&&req.method==='POST') return billingRecurring.draftAction(db,u,billingDraftStep[1],billingDraftStep[2],input);
        if(p==='/api/advances'&&req.method==='POST') return once(()=>billingRecurring.recordAdvance(db,u,input),id=>({id}));
        const advanceConfirm=p.match(/^\/api\/advances\/([a-f0-9-]{36})\/confirm$/);
        if(advanceConfirm&&req.method==='POST') return billingRecurring.confirmAdvance(db,u,advanceConfirm[1],input);
        // الانعكاس سجلٌّ يُنشأ، فبمفتاح تكرار: إعادة الإرسال بعد انقطاع لا تعكس الحوالة مرتين.
        const advanceReverse=p.match(/^\/api\/advances\/([a-f0-9-]{36})\/reverse$/);
        if(advanceReverse&&req.method==='POST') return once(()=>billingRecurring.reverseAdvance(db,u,advanceReverse[1],input),id=>({id}));
        const advanceDraw=p.match(/^\/api\/advances\/([a-f0-9-]{36})\/draws$/);
        if(advanceDraw&&req.method==='POST') return once(()=>billingRecurring.planDraw(db,u,advanceDraw[1],input),id=>({id}));
        const drawApply=p.match(/^\/api\/advance-draws\/([a-f0-9-]{36})\/apply$/);
        if(drawApply&&req.method==='POST') return billingRecurring.applyDraw(db,u,drawApply[1],input);
        if(p==='/api/retainer-agreements'&&req.method==='POST') return once(()=>billingRecurring.createAgreement(db,u,input),id=>({id}));
        const agreementStep=p.match(/^\/api\/retainer-agreements\/([a-f0-9-]{36})\/(carry-rules|threshold)$/);
        if(agreementStep&&req.method==='POST') return agreementStep[2]==='carry-rules'?billingRecurring.setCarryRules(db,u,agreementStep[1],input):billingRecurring.setThreshold(db,u,agreementStep[1],input);
        if(p==='/api/retainer-periods'&&req.method==='POST') return once(()=>billingRecurring.openPeriod(db,u,input),id=>({id}));
        const retainerPeriodConsume=p.match(/^\/api\/retainer-periods\/([a-f0-9-]{36})\/consumption$/);
        if(retainerPeriodConsume&&req.method==='POST') return once(()=>billingRecurring.recordConsumption(db,u,retainerPeriodConsume[1],input),id=>({id}));
        const retainerPeriodClose=p.match(/^\/api\/retainer-periods\/([a-f0-9-]{36})\/close$/);
        if(retainerPeriodClose&&req.method==='POST') return billingRecurring.closePeriod(db,u,retainerPeriodClose[1],input);
        // التنبؤ النقدي (قراءة محضة بلا once) والإقفال الشهري والإطفاء
        if(p==='/api/cash-forecast/project'&&req.method==='POST') return cashForecast.cashForecastBoard(db,u,input);
        if(p==='/api/finance-exceptions/acknowledge'&&req.method==='POST') return once(()=>financeExceptions.acknowledgeException(db,u,input),id=>financeExceptions.getAcknowledgement(db,u,id));
        // الخيارات والقيم المعتمدة (app/options.mjs). القيمة المعتمدة أولًا: «adoptions» ليست مفتاح قائمة.
        // تكرار الإرسال لا يكتب مرتين: القرار بتاريخ سريان واحد يُرفض مكررًا، والخيار الموجود يُرفض موجودًا.
        const optionAdoption=p.match(/^\/api\/options\/adoptions\/([a-z][a-z._]{2,59})\/(record|approve)$/);
        if(optionAdoption&&req.method==='POST') return options.adoptionAction(db,u,optionAdoption[1],optionAdoption[2],input);
        // قيمة الخيار قد تكون عربية أو بحروف كبيرة، فتصل مرمّزة في المسار وتُفكّ هنا؛ والترميز المكسور رفضٌ لا خطأ خادم.
        const optionStep=p.match(/^\/api\/options\/([a-z][a-z._]{2,59})\/([^/]{1,240})\/(disable|enable|reorder|relabel|approve)$/);
        if(optionStep&&req.method==='POST'){
          let value;try{value=decodeURIComponent(optionStep[2]);}catch{fail(400,'bad_option_value','قيمة الخيار في الرابط مكسورة الترميز. افتح القائمة من الشاشة واختر الخيار منها');}
          return options.optionAction(db,u,optionStep[1],value,optionStep[3],input);
        }
        const optionAdd=p.match(/^\/api\/options\/([a-z][a-z._]{2,59})$/);
        if(optionAdd&&req.method==='POST') return options.addOption(db,u,optionAdd[1],input);
        if(p==='/api/close-checklist/templates'&&req.method==='POST') return once(()=>closeChecklist.createTemplate(db,u,input),id=>({id}));
        const closeTemplateStep=p.match(/^\/api\/close-checklist\/templates\/([a-f0-9-]{36})\/(activate_template|deactivate_template)$/);
        if(closeTemplateStep&&req.method==='POST') return closeChecklist.templateAction(db,u,closeTemplateStep[1],closeTemplateStep[2],input);
        if(p==='/api/close-checklist/periods'&&req.method==='POST') return once(()=>closeChecklist.openClosePeriod(db,u,input),id=>({id}));
        const closePeriodStep=p.match(/^\/api\/close-checklist\/periods\/([a-f0-9-]{36})\/(add_task|approve_close|request_reopen|approve_reopen|reject_reopen|explain_exception)$/);
        if(closePeriodStep&&req.method==='POST') return closeChecklist.periodAction(db,u,closePeriodStep[1],closePeriodStep[2],input);
        const closeTaskStep=p.match(/^\/api\/close-checklist\/tasks\/([a-f0-9-]{36})\/(complete_task|reassign_task)$/);
        if(closeTaskStep&&req.method==='POST') return closeChecklist.taskAction(db,u,closeTaskStep[1],closeTaskStep[2],input);
        if(p==='/api/accruals'&&req.method==='POST') return once(()=>accruals.createSchedule(db,u,input),id=>({id}));
        const accrualEntryStep=p.match(/^\/api\/accruals\/entries\/([a-f0-9-]{36})\/(approve_entry|cancel_entry)$/);
        if(accrualEntryStep&&req.method==='POST') return accruals.entryAction(db,u,accrualEntryStep[1],accrualEntryStep[2],input);
        const accrualCancel=p.match(/^\/api\/accruals\/([a-f0-9-]{36})\/cancel_schedule$/);
        if(accrualCancel&&req.method==='POST') return accruals.scheduleAction(db,u,accrualCancel[1],'cancel_schedule',input);
        // سجل العقود (amendments/ وobligations/ قبل مسار العقد العام)
        if(p==='/api/contracts-register'&&req.method==='POST') return once(()=>contractsRegister.createContract(db,u,input),id=>({id}));
        if(p==='/api/contracts-register/settings'&&req.method==='POST') return contractsRegister.setAlertSettings(db,u,input);
        const contractAmendmentStep=p.match(/^\/api\/contracts-register\/amendments\/([a-f0-9-]{36})\/confirm_amendment$/);
        if(contractAmendmentStep&&req.method==='POST') return contractsRegister.amendmentAction(db,u,contractAmendmentStep[1],'confirm_amendment',input);
        const contractObligationStep=p.match(/^\/api\/contracts-register\/obligations\/([a-f0-9-]{36})\/(complete_obligation|verify_obligation|deactivate_obligation|activate_obligation)$/);
        if(contractObligationStep&&req.method==='POST') return contractsRegister.obligationAction(db,u,contractObligationStep[1],contractObligationStep[2],input);
        const contractRecordStep=p.match(/^\/api\/contracts-register\/([a-f0-9-]{36})\/(edit_contract|record_amendment|add_obligation|activate_contract|cancel_contract|terminate_contract|decide_renewal)$/);
        if(contractRecordStep&&req.method==='POST'){
          const [,contractId,contractStepName]=contractRecordStep;
          if(contractStepName==='edit_contract')return contractsRegister.updateContract(db,u,contractId,input);
          if(contractStepName==='record_amendment')return once(()=>contractsRegister.recordAmendment(db,u,contractId,input),id=>({id}));
          if(contractStepName==='add_obligation')return once(()=>contractsRegister.addObligation(db,u,contractId,input),id=>({id}));
          return contractsRegister.contractAction(db,u,contractId,contractStepName,input);
        }
        // سلسلة استلام المشروع (ترحيل 109): محضر التسليم، ثم قائمة الاستلام وبوابتها، ثم محضر الانطلاق وطلبات التغيير.
        if(p==='/api/project-intake/handovers'&&req.method==='POST') return once(()=>projectIntake.createHandover(db,u,input),id=>({id}));
        const intakeHandoverStep=p.match(/^\/api\/project-intake\/handovers\/([a-f0-9-]{36})\/(approve_handover|receive_handover)$/);
        if(intakeHandoverStep&&req.method==='POST') return projectIntake.handoverAction(db,u,intakeHandoverStep[1],intakeHandoverStep[2],input);
        const intakeReceiptStep=p.match(/^\/api\/project-intake\/receipts\/([a-f0-9-]{36})\/(approve_receipt|provide_document|start_execution|record_kickoff|raise_change)$/);
        if(intakeReceiptStep&&req.method==='POST'){
          const [,receiptId,step]=intakeReceiptStep;
          if(step==='approve_receipt')return projectIntake.approveReceipt(db,u,receiptId,input);
          if(step==='provide_document')return projectIntake.provideDocument(db,u,receiptId,input);
          if(step==='start_execution')return projectIntake.startExecution(db,u,receiptId,input);
          if(step==='record_kickoff')return once(()=>projectIntake.recordKickoff(db,u,receiptId,input),id=>({id}));
          return once(()=>projectIntake.raiseChange(db,u,receiptId,input),id=>({id}));
        }
        const intakeDeliverableStep=p.match(/^\/api\/project-intake\/deliverables\/([a-f0-9-]{36})\/(confirm_rounds|record_round)$/);
        if(intakeDeliverableStep&&req.method==='POST')
          return intakeDeliverableStep[2]==='confirm_rounds'
            ?projectIntake.confirmRounds(db,u,intakeDeliverableStep[1],input)
            :once(()=>projectIntake.recordRound(db,u,intakeDeliverableStep[1],input),id=>({id}));
        const intakeChangeStep=p.match(/^\/api\/project-intake\/changes\/([a-f0-9-]{36})\/(decide_finance|record_client_approval|apply_change|decline_change)$/);
        if(intakeChangeStep&&req.method==='POST') return projectIntake.changeAction(db,u,intakeChangeStep[1],intakeChangeStep[2],input);
        if(p==='/api/project-intake/settings'&&req.method==='POST') return projectIntake.setGateReading(db,u,input);
        if(p==='/api/project-intake/policy'&&req.method==='POST') return once(()=>projectIntake.prepareClassificationPolicy(db,u,input),id=>({id}));
        const intakePolicyStep=p.match(/^\/api\/project-intake\/policy\/([a-f0-9-]{36})\/(approve_policy|reject_policy)$/);
        if(intakePolicyStep&&req.method==='POST') return projectIntake.decideClassificationPolicy(db,u,intakePolicyStep[1],{decision:intakePolicyStep[2]==='approve_policy'?'approved':'rejected',note:input.note});
        // النبض والتقدير والإعلانات
        if(p==='/api/engagement/pulse/privacy'&&req.method==='POST') return once(()=>engagement.setSurveyPrivacy(db,u,input),id=>({id}));
        if(p==='/api/engagement/pulse/cycles'&&req.method==='POST') return once(()=>engagement.createCycle(db,u,input),id=>({id}));
        const pulseCycleEdit=p.match(/^\/api\/engagement\/pulse\/cycles\/([a-f0-9-]{36})$/);
        if(pulseCycleEdit&&req.method==='POST') return engagement.editCycle(db,u,pulseCycleEdit[1],input);
        const pulseCycleStep=p.match(/^\/api\/engagement\/pulse\/cycles\/([a-f0-9-]{36})\/(approve|close|respond)$/);
        if(pulseCycleStep&&req.method==='POST'){
          if(pulseCycleStep[2]==='respond')return once(()=>engagement.submitPulse(db,u,pulseCycleStep[1],input),id=>({id}));
          return pulseCycleStep[2]==='approve'?engagement.approveCycle(db,u,pulseCycleStep[1],input):engagement.closeCycle(db,u,pulseCycleStep[1],input);
        }
        if(p==='/api/engagement/recognition/values'&&req.method==='POST') return once(()=>engagement.defineValue(db,u,input),id=>({id}));
        const recognitionValueRetire=p.match(/^\/api\/engagement\/recognition\/values\/([a-f0-9-]{36})\/retire$/);
        if(recognitionValueRetire&&req.method==='POST') return engagement.retireValue(db,u,recognitionValueRetire[1],input);
        if(p==='/api/engagement/recognition/cards'&&req.method==='POST') return once(()=>engagement.sendRecognition(db,u,input),id=>({id}));
        if(p==='/api/engagement/announcements/events'&&req.method==='POST') return once(()=>engagement.createEvent(db,u,input),id=>({id}));
        const announcementEventCancel=p.match(/^\/api\/engagement\/announcements\/events\/([a-f0-9-]{36})\/cancel$/);
        if(announcementEventCancel&&req.method==='POST') return engagement.cancelEvent(db,u,announcementEventCancel[1],input);
        if(p==='/api/engagement/announcements'&&req.method==='POST') return once(()=>engagement.draftAnnouncement(db,u,input),id=>({id}));
        const announcementEdit=p.match(/^\/api\/engagement\/announcements\/([a-f0-9-]{36})$/);
        if(announcementEdit&&req.method==='POST') return engagement.editAnnouncement(db,u,announcementEdit[1],input);
        const announcementStep=p.match(/^\/api\/engagement\/announcements\/([a-f0-9-]{36})\/(attachments|approve|withdraw|acknowledge)$/);
        if(announcementStep&&req.method==='POST'){
          const [,announcementId,announcementAction]=announcementStep;
          if(announcementAction==='attachments')return once(()=>engagement.attachToAnnouncement(db,u,announcementId,input),id=>({id}));
          if(announcementAction==='approve')return engagement.approveAnnouncement(db,u,announcementId,input);
          if(announcementAction==='withdraw')return engagement.withdrawAnnouncement(db,u,announcementId,input);
          return engagement.acknowledgeAnnouncement(db,u,announcementId);
        }
        // اللقاءات الفردية والتغذية الراجعة و360
        if(p==='/api/one-to-ones'&&req.method==='POST') return once(()=>feedback.scheduleOneToOne(db,u,input),id=>({id}));
        const followUpStep=p.match(/^\/api\/one-to-ones\/items\/([a-f0-9-]{36})\/(complete_item|drop_item)$/);
        if(followUpStep&&req.method==='POST') return feedback.followUpAction(db,u,followUpStep[1],followUpStep[2],input);
        const meetingStep=p.match(/^\/api\/one-to-ones\/([a-f0-9-]{36})\/(add_agenda|add_follow_up|save_private_note|record_held|cancel_meeting)$/);
        if(meetingStep&&req.method==='POST') return feedback.meetingAction(db,u,meetingStep[1],meetingStep[2],input);
        if(p==='/api/feedback/notes'&&req.method==='POST') return once(()=>feedback.writeFeedback(db,u,input),id=>({id}));
        const noteStep=p.match(/^\/api\/feedback\/notes\/([a-f0-9-]{36})\/withdraw_note$/);
        if(noteStep&&req.method==='POST') return feedback.noteAction(db,u,noteStep[1],'withdraw_note',input);
        if(p==='/api/feedback/requests'&&req.method==='POST') return once(()=>feedback.requestFeedback(db,u,input),id=>({id}));
        const feedbackRequestStep=p.match(/^\/api\/feedback\/requests\/([a-f0-9-]{36})\/(answer_request|decline_request)$/);
        if(feedbackRequestStep&&req.method==='POST') return feedback.requestAction(db,u,feedbackRequestStep[1],feedbackRequestStep[2],input);
        if(p==='/api/review-360/threshold'&&req.method==='POST') return feedback.setUpwardThreshold(db,u,input);
        if(p==='/api/review-360/nominations'&&req.method==='POST') return once(()=>feedback.nominate(db,u,input),id=>({id}));
        const nominationStep=p.match(/^\/api\/review-360\/nominations\/([a-f0-9-]{36})\/(approve_nomination|reject_nomination)$/);
        if(nominationStep&&req.method==='POST') return feedback.nominationAction(db,u,nominationStep[1],nominationStep[2],input);
        const submit360=p.match(/^\/api\/review-360\/nominations\/([a-f0-9-]{36})\/submit$/);
        if(submit360&&req.method==='POST') return feedback.submit360(db,u,submit360[1],input);
        // الأهداف والمخاطر والقرارات
        if(p==='/api/governance/objectives'&&req.method==='POST') return once(()=>governance.createObjective(db,u,input),id=>({id}));
        const objectiveStep=p.match(/^\/api\/governance\/objectives\/([a-f0-9-]{36})\/(edit_objective|close_objective)$/);
        if(objectiveStep&&req.method==='POST') return governance.objectiveAction(db,u,objectiveStep[1],objectiveStep[2],input);
        if(p==='/api/governance/initiatives'&&req.method==='POST') return once(()=>governance.createInitiative(db,u,input),id=>({id}));
        const initiativeStep=p.match(/^\/api\/governance\/initiatives\/([a-f0-9-]{36})\/(edit_initiative|approve_initiative|start_initiative|complete_initiative|stop_initiative|cancel_initiative)$/);
        if(initiativeStep&&req.method==='POST') return governance.initiativeAction(db,u,initiativeStep[1],initiativeStep[2],input);
        if(p==='/api/governance/indicators'&&req.method==='POST') return once(()=>governance.createIndicator(db,u,input),id=>({id}));
        const indicatorMeasure=p.match(/^\/api\/governance\/indicators\/([a-f0-9-]{36})\/record_measurement$/);
        if(indicatorMeasure&&req.method==='POST') return governance.recordMeasurement(db,u,indicatorMeasure[1],input);
        if(p==='/api/governance/risk-scale'&&req.method==='POST') return governance.saveRiskScale(db,u,input);
        if(p==='/api/governance/risks'&&req.method==='POST') return once(()=>governance.createRisk(db,u,input),id=>({id}));
        const riskStep=p.match(/^\/api\/governance\/risks\/([a-f0-9-]{36})\/(edit_risk|review_risk|accept_risk|close_risk)$/);
        if(riskStep&&req.method==='POST') return governance.riskAction(db,u,riskStep[1],riskStep[2],input);
        if(p==='/api/governance/decisions'&&req.method==='POST') return once(()=>governance.recordDecision(db,u,input),id=>({id}));
        if(p==='/api/governance/minutes'&&req.method==='POST') return once(()=>governance.createMinute(db,u,input),id=>({id}));
        const minuteStep=p.match(/^\/api\/governance\/minutes\/([a-f0-9-]{36})\/(edit_minute|approve_minute)$/);
        if(minuteStep&&req.method==='POST') return governance.minuteAction(db,u,minuteStep[1],minuteStep[2],input);
        if(p==='/api/governance/commitments'&&req.method==='POST') return once(()=>governance.createCommitment(db,u,input),id=>({id}));
        const commitmentStep=p.match(/^\/api\/governance\/commitments\/([a-f0-9-]{36})\/(record_execution|cancel_commitment)$/);
        if(commitmentStep&&req.method==='POST') return governance.commitmentAction(db,u,commitmentStep[1],commitmentStep[2],input);
        // مراقبة الانتهاء: الواجهة ترسل المفتاح عند الإدخال الأول فقط، والدالة لا تعيد id، فالـonce مشروط وملفوف
        const expirySetting=p.match(/^\/api\/expiry\/settings\/([a-z][a-z_]*(?:\.[a-z_]+)?)$/);
        if(expirySetting&&req.method==='POST') return req.headers['idempotency-key']?once(()=>({id:expirySetting[1],...expiry.saveExpiryWatch(db,u,expirySetting[1],input)}),key=>({doc_kind:key})):expiry.saveExpiryWatch(db,u,expirySetting[1],input);
        // المؤثرون
        if(p==='/api/influencers'&&req.method==='POST') return once(()=>influencers.createInfluencer(db,u,input),id=>({id}));
        const influencerStep=p.match(/^\/api\/influencers\/([a-f0-9-]{36})\/(edit_influencer|add_account|retire_account|record_snapshot|set_licence|link_vendor|set_status)$/);
        if(influencerStep&&req.method==='POST') return influencers.influencerAction(db,u,influencerStep[1],influencerStep[2],input);
        if(p==='/api/influencer-engagements'&&req.method==='POST') return once(()=>influencers.createEngagement(db,u,input),id=>({id}));
        const influencerContentAdd=p.match(/^\/api\/influencer-engagements\/([a-f0-9-]{36})\/content$/);
        if(influencerContentAdd&&req.method==='POST') return once(()=>influencers.addContent(db,u,influencerContentAdd[1],input),id=>({id}));
        const influencerEngagementStep=p.match(/^\/api\/influencer-engagements\/([a-f0-9-]{36})\/(edit_engagement|request_review|approve_engagement|return_engagement|complete_engagement|cancel_engagement|link_payment)$/);
        if(influencerEngagementStep&&req.method==='POST') return influencers.engagementAction(db,u,influencerEngagementStep[1],influencerEngagementStep[2],input);
        const influencerContentStep=p.match(/^\/api\/influencer-content\/([a-f0-9-]{36})\/(edit_content|submit_content|approve_content|return_content|record_client_approval|record_proof|cancel_content)$/);
        if(influencerContentStep&&req.method==='POST') return influencers.contentAction(db,u,influencerContentStep[1],influencerContentStep[2],input);
        const influencerProofVerify=p.match(/^\/api\/influencer-proofs\/([a-f0-9-]{36})\/verify$/);
        if(influencerProofVerify&&req.method==='POST') return influencers.verifyProof(db,u,influencerProofVerify[1],input);
        // استحقاق الإجازات والمزايا (التسوية ترجع رصيدًا بلا id فتُلف)
        if(p==='/api/leave-accrual/policies'&&req.method==='POST') return once(()=>leaveAccrual.prepareAccrualPolicy(db,u,input),id=>({id}));
        const accrualPolicyStep=p.match(/^\/api\/leave-accrual\/policies\/([0-9a-f-]{36})(?:\/(accept|reject))?$/);
        if(accrualPolicyStep&&req.method==='POST') return accrualPolicyStep[2]?leaveAccrual.decideAccrualPolicy(db,u,accrualPolicyStep[1],accrualPolicyStep[2],input):leaveAccrual.updateAccrualPolicyDraft(db,u,accrualPolicyStep[1],input);
        if(p==='/api/leave-accrual/runs'&&req.method==='POST') return once(()=>leaveAccrual.runAccrualCycle(db,u,input),id=>({id}));
        if(p==='/api/leave-accrual/adjustments'&&req.method==='POST') return once(()=>{const balance=leaveAccrual.recordAccrualAdjustment(db,u,input);return {...balance,id:balance.employee_id};},id=>({id}));
        if(p==='/api/benefits/policies'&&req.method==='POST') return once(()=>benefits.recordMedicalPolicy(db,u,input),id=>({id}));
        const medicalPolicyEdit=p.match(/^\/api\/benefits\/policies\/([a-f0-9-]{36})$/);
        if(medicalPolicyEdit&&req.method==='POST') return benefits.updateMedicalPolicy(db,u,medicalPolicyEdit[1],input);
        if(p==='/api/benefits/enrolments'&&req.method==='POST') return once(()=>benefits.recordEnrolment(db,u,input),id=>({id}));
        const enrolmentStep=p.match(/^\/api\/benefits\/enrolments\/([a-f0-9-]{36})\/(confirm|remove|dependants)$/);
        if(enrolmentStep&&req.method==='POST'){
          if(enrolmentStep[2]==='dependants')return once(()=>benefits.addDependant(db,u,input,enrolmentStep[1]),id=>({id}));
          return benefits.enrolmentAction(db,u,enrolmentStep[1],enrolmentStep[2]==='confirm'?'confirm_enrolment':'remove_enrolment',input);
        }
        const dependantRemove=p.match(/^\/api\/benefits\/dependants\/([a-f0-9-]{36})\/remove$/);
        if(dependantRemove&&req.method==='POST') return benefits.removeDependant(db,u,dependantRemove[1],input);
        if(p==='/api/my-benefits/requests'&&req.method==='POST') return once(()=>benefitsPortal.submitBenefitRequest(db,u,input),id=>({id}));
        const benefitWithdraw=p.match(/^\/api\/my-benefits\/requests\/([a-f0-9-]{36})\/withdraw$/);
        if(benefitWithdraw&&req.method==='POST') return benefitsPortal.withdrawBenefitRequest(db,u,benefitWithdraw[1],input);
        if(p==='/api/my-benefits/documents'&&req.method==='POST') return once(()=>benefitsPortal.uploadBenefitDocument(db,u,input),id=>({id}));
        const benefitPropose=p.match(/^\/api\/benefits-admin\/catalog\/([a-z_]{3,40})\/propose$/);
        if(benefitPropose&&req.method==='POST') return benefitsPortal.proposeBenefit(db,u,benefitPropose[1],input);
        const benefitDecision=p.match(/^\/api\/benefits-admin\/catalog\/([a-f0-9-]{36})\/(accept|reject)$/);
        if(benefitDecision&&req.method==='POST') return benefitsPortal.decideBenefit(db,u,benefitDecision[1],benefitDecision[2],input);
        const benefitStep=p.match(/^\/api\/benefits-admin\/requests\/([a-f0-9-]{36})\/(hr_approve|hr_reject|finance_approve|finance_reject)$/);
        if(benefitStep&&req.method==='POST'){const [side,decision]=benefitStep[2].split('_');return side==='hr'?benefitsPortal.hrDecision(db,u,benefitStep[1],decision,input):benefitsPortal.financeDecision(db,u,benefitStep[1],decision,input);}
        const benefitHandoff=p.match(/^\/api\/benefits-admin\/proposals\/([a-f0-9-]{36})\/hand_to_payroll$/);
        if(benefitHandoff&&req.method==='POST') return benefitsPortal.handToPayroll(db,u,benefitHandoff[1],input);
        // D-08: الخطوة التالية لمقترح حجز التذكرة — تسجيل مرجع حجز جرى لدى وكيل السفر خارج المنصة.
        const benefitBooking=p.match(/^\/api\/benefits-admin\/proposals\/([a-f0-9-]{36})\/record_booking$/);
        if(benefitBooking&&req.method==='POST') return benefitsPortal.recordTicketBooking(db,u,benefitBooking[1],input);
        // الخطابات
        if(p==='/api/letters'&&req.method==='POST') return once(()=>letters.requestLetter(db,u,input),id=>({id}));
        if(p==='/api/letters/preview'&&req.method==='POST') return letters.previewLetter(db,u,input);
        const starterStep=p.match(/^\/api\/letters\/templates\/([a-z][a-z0-9_-]{2,39})\/adopt_starter$/);
        if(starterStep&&req.method==='POST') return letters.adoptStarter(db,u,starterStep[1],input);
        if(p==='/api/letters/types'&&req.method==='POST') return once(()=>letters.addLetterType(db,u,input),id=>({id}));
        const letterTypeStep=p.match(/^\/api\/letters\/types\/([a-z][a-z0-9_-]{2,39})\/(retire_letter_type|activate_letter_type)$/);
        if(letterTypeStep&&req.method==='POST') return letters.letterTypeAction(db,u,letterTypeStep[1],letterTypeStep[2],input);
        const letterTemplateStep=p.match(/^\/api\/letters\/templates\/([a-z][a-z0-9_-]{2,39})(?:\/(approve))?$/);
        if(letterTemplateStep&&req.method==='POST') return letterTemplateStep[2]?letters.approveTemplate(db,u,letterTemplateStep[1],input):letters.saveTemplate(db,u,letterTemplateStep[1],input);
        const letterStep=p.match(/^\/api\/letters\/([a-f0-9-]{36})\/(prepare_letter|reject_letter|cancel_request|issue_letter|cancel_letter|record_handover)$/);
        if(letterStep&&req.method==='POST') return letters.letterAction(db,u,letterStep[1],letterStep[2],input);
        // العلاقات العامة ودليل الإعلام
        if(p==='/api/media-contacts'&&req.method==='POST') return once(()=>pr.createContact(db,u,input),id=>({id}));
        const mediaContactStep=p.match(/^\/api\/media-contacts\/([a-f0-9-]{36})\/(edit|archive|restore)$/);
        if(mediaContactStep&&req.method==='POST') return pr.contactAction(db,u,mediaContactStep[1],mediaContactStep[2],input);
        if(p==='/api/pr/lists'&&req.method==='POST') return once(()=>pr.createList(db,u,input),id=>({id}));
        const prListStep=p.match(/^\/api\/pr\/lists\/([a-f0-9-]{36})\/(add|remove|lock)$/);
        if(prListStep&&req.method==='POST') return pr.listAction(db,u,prListStep[1],prListStep[2],input);
        if(p==='/api/pr/pitches'&&req.method==='POST') return once(()=>pr.createPitch(db,u,input),id=>({id}));
        const prPitchStep=p.match(/^\/api\/pr\/pitches\/([a-f0-9-]{36})\/(reply|decline|published)$/);
        if(prPitchStep&&req.method==='POST') return pr.pitchAction(db,u,prPitchStep[1],prPitchStep[2],input);
        if(p==='/api/pr/coverage'&&req.method==='POST') return once(()=>pr.createCoverage(db,u,input),id=>({id}));
        const prCoverageEdit=p.match(/^\/api\/pr\/coverage\/([a-f0-9-]{36})\/edit$/);
        if(prCoverageEdit&&req.method==='POST') return pr.coverageAction(db,u,prCoverageEdit[1],'edit',input);
        // المعدات والعهد (مسارات الإنشاء الحرفية قبل الأنماط)
        if(p==='/api/equipment/items'&&req.method==='POST') return once(()=>equipment.createItem(db,u,input),id=>({id}));
        if(p==='/api/equipment/kits'&&req.method==='POST') return once(()=>equipment.createKit(db,u,input),id=>({id}));
        if(p==='/api/equipment/bookings'&&req.method==='POST') return once(()=>equipment.createBooking(db,u,input),id=>({id}));
        if(p==='/api/equipment/work-orders'&&req.method==='POST') return once(()=>equipment.openWorkOrder(db,u,input),id=>({id}));
        if(p==='/api/equipment/inventory'&&req.method==='POST') return once(()=>equipment.startCheck(db,u,input),id=>({id}));
        const equipmentItemStep=p.match(/^\/api\/equipment\/items\/([a-f0-9-]{36})\/(edit|report_lost|confirm_lost|reject_lost|retire|return_to_service)$/);
        if(equipmentItemStep&&req.method==='POST') return equipment.itemAction(db,u,equipmentItemStep[1],equipmentItemStep[2],input);
        const equipmentKitStep=p.match(/^\/api\/equipment\/kits\/([a-f0-9-]{36})\/(add_item|remove_item|archive)$/);
        if(equipmentKitStep&&req.method==='POST') return equipment.kitAction(db,u,equipmentKitStep[1],equipmentKitStep[2],input);
        const equipmentBookingStep=p.match(/^\/api\/equipment\/bookings\/([a-f0-9-]{36})\/(hand_out|hand_in|cancel)$/);
        if(equipmentBookingStep&&req.method==='POST') return equipment.bookingAction(db,u,equipmentBookingStep[1],equipmentBookingStep[2],input);
        const equipmentOrderStep=p.match(/^\/api\/equipment\/work-orders\/([a-f0-9-]{36})\/(start|complete|cancel)$/);
        if(equipmentOrderStep&&req.method==='POST') return equipment.workOrderAction(db,u,equipmentOrderStep[1],equipmentOrderStep[2],input);
        const equipmentCheckStep=p.match(/^\/api\/equipment\/inventory\/([a-f0-9-]{36})\/(scan|close)$/);
        if(equipmentCheckStep&&req.method==='POST') return equipment.checkAction(db,u,equipmentCheckStep[1],equipmentCheckStep[2],input);
        // حماية البيانات الشخصية (إنشاء النشاط والقاعدة بمفتاح، وتحريرهما على المسار نفسه بلا مفتاح)
        if(p==='/api/privacy/activities/suggest'&&req.method==='POST') return once(()=>({id:u.tenant_id,...privacy.draftSuggestedActivities(db,u,input)}),id=>({id}));
        if(p==='/api/privacy/activities'&&req.method==='POST') return input?.id?privacy.saveActivity(db,u,input):once(()=>privacy.saveActivity(db,u,input),id=>({id}));
        const privacyActivityStep=p.match(/^\/api\/privacy\/activities\/([a-f0-9-]{36})\/(approve_activity|supersede_activity)$/);
        if(privacyActivityStep&&req.method==='POST') return privacy.activityAction(db,u,privacyActivityStep[1],privacyActivityStep[2],input);
        if(p==='/api/privacy/transfers'&&req.method==='POST') return once(()=>privacy.recordTransfer(db,u,input),id=>({id}));
        const privacyTransferStep=p.match(/^\/api\/privacy\/transfers\/([a-f0-9-]{36})\/(assess_transfer|approve_transfer|stop_transfer)$/);
        if(privacyTransferStep&&req.method==='POST') return privacy.transferAction(db,u,privacyTransferStep[1],privacyTransferStep[2],input);
        if(p==='/api/privacy/retention'&&req.method==='POST') return input?.id?privacy.saveRetentionRule(db,u,input):once(()=>privacy.saveRetentionRule(db,u,input),id=>({id}));
        const privacyRetentionStep=p.match(/^\/api\/privacy\/retention\/([a-f0-9-]{36})\/(record_check|deactivate_rule|activate_rule)$/);
        if(privacyRetentionStep&&req.method==='POST') return privacy.retentionAction(db,u,privacyRetentionStep[1],privacyRetentionStep[2],input);
        if(p==='/api/privacy/incidents'&&req.method==='POST') return once(()=>privacy.recordIncident(db,u,input),id=>({id}));
        const privacyIncidentStep=p.match(/^\/api\/privacy\/incidents\/([a-f0-9-]{36})\/(update_incident|close_incident)$/);
        if(privacyIncidentStep&&req.method==='POST') return privacy.incidentAction(db,u,privacyIncidentStep[1],privacyIncidentStep[2],input);
        if(p==='/api/subject-requests'&&req.method==='POST') return once(()=>privacy.createSubjectRequest(db,u,input),id=>({id}));
        const subjectRequestStep=p.match(/^\/api\/subject-requests\/([a-f0-9-]{36})\/(verify_identity|set_due_date|answer_request|refuse_request|close_request)$/);
        if(subjectRequestStep&&req.method==='POST') return privacy.requestAction(db,u,subjectRequestStep[1],subjectRequestStep[2],input);
        // الإنتاج وأوراق الاستدعاء (الأفعال الفرعية بتناوب صريح لا بنمط عام)
        if(p==='/api/productions'&&req.method==='POST') return once(()=>production.createProduction(db,u,input),id=>({id}));
        const productionStep=p.match(/^\/api\/productions\/([a-f0-9-]{36})\/(edit|start|wrap|close|cancel|crew|talent|locations|schedule|shots)$/);
        if(productionStep&&req.method==='POST'){
          const [,productionId,productionPart]=productionStep;
          if(productionPart==='crew')return once(()=>production.addCrew(db,u,productionId,input),id=>({id}));
          if(productionPart==='talent')return once(()=>production.addTalent(db,u,productionId,input),id=>({id}));
          if(productionPart==='locations')return once(()=>production.addLocation(db,u,productionId,input),id=>({id}));
          if(productionPart==='shots')return once(()=>production.addShot(db,u,productionId,input),id=>({id}));
          if(productionPart==='schedule')return production.saveSchedule(db,u,productionId,input);
          return production.productionAction(db,u,productionId,productionPart,input);
        }
        const productionCrewStep=p.match(/^\/api\/production-crew\/([a-f0-9-]{36})\/(edit|remove)$/);
        if(productionCrewStep&&req.method==='POST') return production.crewAction(db,u,productionCrewStep[1],productionCrewStep[2],input);
        const productionTalentStep=p.match(/^\/api\/production-talent\/([a-f0-9-]{36})\/(edit|release|remove)$/);
        if(productionTalentStep&&req.method==='POST') return production.talentAction(db,u,productionTalentStep[1],productionTalentStep[2],input);
        const productionLocationStep=p.match(/^\/api\/production-locations\/([a-f0-9-]{36})\/(edit|permit|remove)$/);
        if(productionLocationStep&&req.method==='POST') return production.locationAction(db,u,productionLocationStep[1],productionLocationStep[2],input);
        const shotStep=p.match(/^\/api\/shots\/([a-f0-9-]{36})\/(edit|status)$/);
        if(shotStep&&req.method==='POST') return production.shotAction(db,u,shotStep[1],shotStep[2],input);
        if(p==='/api/call-sheets'&&req.method==='POST') return once(()=>production.createCallSheet(db,u,input),id=>({id}));
        const callSheetRespond=p.match(/^\/api\/call-sheets\/invitees\/([a-f0-9-]{36})\/respond$/);
        if(callSheetRespond&&req.method==='POST') return production.respondToCallSheet(db,u,callSheetRespond[1],input);
        const callSheetStep=p.match(/^\/api\/call-sheets\/([a-f0-9-]{36})\/(edit|add_invitee|remove_invitee|issue|revise|cancel)$/);
        if(callSheetStep&&req.method==='POST') return production.callSheetAction(db,u,callSheetStep[1],callSheetStep[2],input);
        // معدلات التكلفة والربحية
        if(p==='/api/cost-rates/categories'&&req.method==='POST') return once(()=>profitability.createCategory(db,u,input),id=>({id}));
        const costCategoryStep=p.match(/^\/api\/cost-rates\/categories\/([a-f0-9-]{36})\/(activate_category|deactivate_category)$/);
        if(costCategoryStep&&req.method==='POST') return profitability.categoryAction(db,u,costCategoryStep[1],costCategoryStep[2],input);
        if(p==='/api/cost-rates/rates'&&req.method==='POST') return once(()=>profitability.prepareCostRate(db,u,input),id=>({id}));
        const costRateStep=p.match(/^\/api\/cost-rates\/rates\/([a-f0-9-]{36})\/(approve_rate|reject_rate)$/);
        if(costRateStep&&req.method==='POST') return profitability.costRateAction(db,u,costRateStep[1],costRateStep[2],input);
        if(p==='/api/cost-rates/assignments'&&req.method==='POST') return once(()=>profitability.assignCategory(db,u,input),id=>({id}));
        if(p==='/api/cost-rates/overhead'&&req.method==='POST') return once(()=>profitability.prepareOverheadRate(db,u,input),id=>({id}));
        const overheadRateStep=p.match(/^\/api\/cost-rates\/overhead\/([a-f0-9-]{36})\/(approve_overhead|reject_overhead)$/);
        if(overheadRateStep&&req.method==='POST') return profitability.overheadRateAction(db,u,overheadRateStep[1],overheadRateStep[2],input);
        if(p==='/api/profitability/tags'&&req.method==='POST') return once(()=>{const tag=profitability.tagProjectService(db,u,input);return {...tag,id:tag.project_id};},id=>({id}));
        // كشوف الوقت (المطابقات الحرفية قبل نمط القرار) وتخطيط الموارد
        if(p==='/api/timesheets/submit'&&req.method==='POST') return once(()=>timesheets.submitTimesheet(db,u,input),id=>timesheets.getPeriod(db,u,id));
        if(p==='/api/timesheets/correction'&&req.method==='POST') return once(()=>timesheets.logCorrection(db,u,input),id=>({id}));
        if(p==='/api/timesheets/lock-window'&&req.method==='POST') return timesheets.setLockWindow(db,u,input);
        if(p==='/api/timesheets/lock'&&req.method==='POST') return once(()=>({id:u.tenant_id,...timesheets.lockDuePeriods(db,u,input)}),id=>({id}));
        if(p==='/api/timesheets/remind'&&req.method==='POST') return once(()=>({id:u.tenant_id,...timesheets.remindMissing(db,u,input)}),id=>({id}));
        const timesheetReminderRead=p.match(/^\/api\/timesheets\/reminders\/([a-f0-9-]{36})\/read$/);
        if(timesheetReminderRead&&req.method==='POST') return timesheets.markReminderRead(db,u,timesheetReminderRead[1]);
        const timesheetDecision=p.match(/^\/api\/timesheets\/([a-f0-9-]{36})\/(approve|return)$/);
        if(timesheetDecision&&req.method==='POST') return timesheets.decideTimesheet(db,u,timesheetDecision[1],timesheetDecision[2],input);
        if(p==='/api/resourcing/capacity'&&req.method==='POST') return once(()=>resourcing.setCapacity(db,u,input),id=>({id}));
        if(p==='/api/resourcing/bookings'&&req.method==='POST') return once(()=>resourcing.createBooking(db,u,input),id=>resourcing.getBooking(db,u,id));
        const resourcingBookingStep=p.match(/^\/api\/resourcing\/bookings\/([a-f0-9-]{36})\/(confirm|release)$/);
        if(resourcingBookingStep&&req.method==='POST') return resourcingBookingStep[2]==='confirm'?resourcing.confirmBooking(db,u,resourcingBookingStep[1],input):resourcing.releaseBooking(db,u,resourcingBookingStep[1],input);
        if(p==='/api/resourcing/placeholders'&&req.method==='POST') return once(()=>resourcing.createPlaceholder(db,u,input),id=>({id}));
        const placeholderStep=p.match(/^\/api\/resourcing\/placeholders\/([a-f0-9-]{36})\/(fill|cancel)$/);
        if(placeholderStep&&req.method==='POST') return placeholderStep[2]==='fill'?resourcing.fillPlaceholder(db,u,placeholderStep[1],input):resourcing.cancelPlaceholder(db,u,placeholderStep[1],input);
        // المراجعة الإبداعية (annotations/ وnotices/ قبل /:id/)
        if(p==='/api/review-rounds'&&req.method==='POST') return once(()=>reviewRounds.createRoute(db,u,input),id=>({id}));
        const reviewAnnotationStep=p.match(/^\/api\/review-rounds\/annotations\/([a-f0-9-]{36})\/(address|wont_fix)$/);
        if(reviewAnnotationStep&&req.method==='POST') return reviewRounds.annotationAction(db,u,reviewAnnotationStep[1],reviewAnnotationStep[2],input);
        const reviewNoticeRead=p.match(/^\/api\/review-rounds\/notices\/([a-f0-9-]{36})\/read$/);
        if(reviewNoticeRead&&req.method==='POST') return reviewRounds.markReviewNotice(db,u,reviewNoticeRead[1]);
        const reviewClientPack=p.match(/^\/api\/review-rounds\/([a-f0-9-]{36})\/client-pack$/);
        if(reviewClientPack&&req.method==='POST') return reviewRounds.clientPack(db,u,reviewClientPack[1]);
        const reviewRouteStep=p.match(/^\/api\/review-rounds\/([a-f0-9-]{36})\/(add_media|annotate|decide|save_template|cancel|notify)$/);
        if(reviewRouteStep&&req.method==='POST'){
          const [,routeId,routeAction]=reviewRouteStep;
          if(['add_media','annotate','save_template'].includes(routeAction))return once(()=>reviewRounds.reviewAction(db,u,routeId,routeAction,input),id=>reviewRounds.getRoute(db,u,id));
          return reviewRounds.reviewAction(db,u,routeId,routeAction,input);
        }
        // البحث الشامل
        if(p==='/api/search/reindex'&&req.method==='POST') return search.refreshIndex(db,u,{explicit:true,maxAgeMs:0});
        // أوراق العمل الضريبية (vat/boxes قبل مسار الورقة؛ revise_* وحدها ترسل المفتاح)
        if(p==='/api/tax-returns/rates'&&req.method==='POST') return once(()=>taxReturns.recordRateSetting(db,u,input),id=>({id}));
        const taxRateConfirm=p.match(/^\/api\/tax-returns\/rates\/([a-f0-9-]{36})\/confirm$/);
        if(taxRateConfirm&&req.method==='POST') return taxReturns.confirmRateSetting(db,u,taxRateConfirm[1],input);
        if(p==='/api/tax-returns/vat/boxes'&&req.method==='POST') return taxReturns.nameExportBoxes(db,u,input);
        if(p==='/api/tax-returns/vat'&&req.method==='POST') return once(()=>taxReturns.createVatWorksheet(db,u,input),id=>({id}));
        const vatWorksheetSave=p.match(/^\/api\/tax-returns\/vat\/([a-f0-9-]{36})$/);
        if(vatWorksheetSave&&req.method==='POST') return taxReturns.saveVatWorksheet(db,u,vatWorksheetSave[1],input);
        const vatWorksheetStep=p.match(/^\/api\/tax-returns\/vat\/([a-f0-9-]{36})\/(open|review_worksheet|record_filing|revise_worksheet)$/);
        if(vatWorksheetStep&&req.method==='POST'){
          const [,worksheetId,worksheetAction]=vatWorksheetStep;
          if(worksheetAction==='open')return taxReturns.getVatWorksheet(db,u,worksheetId);
          if(worksheetAction==='revise_worksheet')return once(()=>taxReturns.vatWorksheetAction(db,u,worksheetId,'revise_worksheet',input),id=>({id}));
          return taxReturns.vatWorksheetAction(db,u,worksheetId,worksheetAction,input);
        }
        if(p==='/api/tax-returns/withholding'&&req.method==='POST') return once(()=>taxReturns.recordWithholding(db,u,input),id=>({id}));
        const withholdingStep=p.match(/^\/api\/tax-returns\/withholding\/([a-f0-9-]{36})\/(record_remittance|cancel_entry)$/);
        if(withholdingStep&&req.method==='POST') return taxReturns.withholdingAction(db,u,withholdingStep[1],withholdingStep[2],input);
        if(p==='/api/tax-returns/zakat'&&req.method==='POST') return once(()=>taxReturns.createZakatWorksheet(db,u,input),id=>({id}));
        const zakatLines=p.match(/^\/api\/tax-returns\/zakat\/([a-f0-9-]{36})\/lines$/);
        if(zakatLines&&req.method==='POST') return taxReturns.saveZakatLines(db,u,zakatLines[1],input);
        const zakatStep=p.match(/^\/api\/tax-returns\/zakat\/([a-f0-9-]{36})\/(review_zakat|revise_zakat)$/);
        if(zakatStep&&req.method==='POST') return zakatStep[2]==='revise_zakat'?once(()=>taxReturns.zakatAction(db,u,zakatStep[1],'revise_zakat',input),id=>({id})):taxReturns.zakatAction(db,u,zakatStep[1],'review_zakat',input);
        // حماية الأجور والمطابقة والشذوذ
        if(p==='/api/wps/formats'&&req.method==='POST') return once(()=>wps.recordFileFormat(db,u,input),id=>({id}));
        const wpsFormatStep=p.match(/^\/api\/wps\/formats\/([a-f0-9-]{36})\/(confirm|reject|retire|withdraw)$/);
        if(wpsFormatStep&&req.method==='POST') return wps.decideFileFormat(db,u,wpsFormatStep[1],wpsFormatStep[2],input);
        if(p==='/api/wps/exports'&&req.method==='POST') return once(()=>wps.prepareWageFile(db,u,input),id=>({id}));
        const wpsUpload=p.match(/^\/api\/wps\/exports\/([a-f0-9-]{36})\/record_upload$/);
        if(wpsUpload&&req.method==='POST') return wps.recordManualUpload(db,u,wpsUpload[1],input);
        if(p==='/api/wage-reconciliation/registrations'&&req.method==='POST') return once(()=>wageRecon.recordWageRegistration(db,u,input),id=>({id}));
        if(p==='/api/wage-reconciliation/notes'&&req.method==='POST') return once(()=>wageRecon.recordWageDifferenceNote(db,u,input),id=>({id}));
        if(p==='/api/payroll-anomaly/thresholds'&&req.method==='POST') return anomaly.saveAnomalySettings(db,u,input);
        // حزم التعيين والمغادرة وإخلاء الطرف
        if(p==='/api/lifecycle/templates'&&req.method==='POST') return once(()=>lifecycle.saveStepTemplate(db,u,input),id=>({id}));
        const lifecycleTemplateEdit=p.match(/^\/api\/lifecycle\/templates\/([a-f0-9-]{36})$/);
        if(lifecycleTemplateEdit&&req.method==='POST') return lifecycle.updateStepTemplate(db,u,lifecycleTemplateEdit[1],input);
        if(p==='/api/lifecycle/bundles'&&req.method==='POST') return once(()=>lifecycle.openBundle(db,u,input),id=>({id}));
        const lifecycleBundleStep=p.match(/^\/api\/lifecycle\/bundles\/([a-f0-9-]{36})\/(close_bundle|cancel_bundle|refresh_clearance)$/);
        if(lifecycleBundleStep&&req.method==='POST') return lifecycle.bundleAction(db,u,lifecycleBundleStep[1],lifecycleBundleStep[2],input);
        const lifecycleStepAction=p.match(/^\/api\/lifecycle\/steps\/([a-f0-9-]{36})\/(close_step|cancel_step|decide_late_step)$/);
        if(lifecycleStepAction&&req.method==='POST') return lifecycle.stepAction(db,u,lifecycleStepAction[1],lifecycleStepAction[2],input);
        const clearanceItem=p.match(/^\/api\/clearance\/items\/([a-f0-9-]{36})$/);
        if(clearanceItem&&req.method==='POST') return lifecycle.clearItem(db,u,clearanceItem[1],input);
        // الفوترة الإلكترونية (المحاولة والاستعلام خارج هذه المعاملة أعلاه)
        const einvoiceChannel=p.match(/^\/api\/einvoice\/submissions\/([a-f0-9-]{36})\/channel$/);
        if(einvoiceChannel&&req.method==='POST') return einvoice.assignChannel(db,u,einvoiceChannel[1],input);
        if(p==='/api/einvoice/buyer-overrides'&&req.method==='POST') return once(()=>einvoice.recordBuyerOverride(db,u,input),id=>({id}));
        // استقبال الطلب: المقاييس والمصفوفة (تعيدان الإعدادات بلا id فتُلفان) وبيانات استقبال الطلب
        if(p==='/api/intake/scales'&&req.method==='POST') return once(()=>({...requestIntake.defineScale(db,u,input),id:u.tenant_id}),()=>requestIntake.intakeSettings(db,u));
        if(p==='/api/intake/matrix'&&req.method==='POST') return once(()=>({...requestIntake.setMatrixCell(db,u,input),id:u.tenant_id}),()=>requestIntake.intakeSettings(db,u));
        const requestIntakeSave=p.match(/^\/api\/requests\/([a-f0-9-]+)\/intake$/);
        if(requestIntakeSave&&req.method==='POST') return requestIntake.saveIntake(db,u,requestIntakeSave[1],input);
        // الخط الزمني والإغلاق بدليل وسؤال التجربة (الدوال لا تعيد id في المستوى الأعلى فتُلف)
        if(p==='/api/request-closure/window'&&req.method==='POST') return once(()=>({id:u.tenant_id,...requestClosure.setReopenWindow(db,u,input)}),()=>requestClosure.closureBoard(db,u));
        if(p==='/api/service-experience/threshold'&&req.method==='POST') return once(()=>({id:u.tenant_id,...serviceExperience.setExperienceThreshold(db,u,input)}),id=>({id}));
        const timelineView=p.match(/^\/api\/request-timeline\/([a-f0-9-]+)\/view$/);
        if(timelineView&&req.method==='POST') return requestTimeline.timeline(db,u,timelineView[1]);
        const closureStep=p.match(/^\/api\/request-closure\/([a-f0-9-]+)\/(close|reopen)$/);
        if(closureStep&&req.method==='POST') return once(()=>({id:closureStep[1],...(closureStep[2]==='close'?requestClosure.closeWithEvidence(db,u,closureStep[1],input):requestClosure.requestReopen(db,u,closureStep[1],input))}),id=>requestClosure.closureView(db,u,id));
        const serviceOutputCreate=p.match(/^\/api\/requests\/([a-f0-9-]+)\/outputs$/);
        if(serviceOutputCreate&&req.method==='POST') return once(()=>serviceOutputs.recordServiceOutput(db,u,serviceOutputCreate[1],input),id=>serviceOutputs.serviceOutputView(db,u,serviceOutputCreate[1]).outputs.find(row=>row.id===id));
        const serviceOutputDecision=p.match(/^\/api\/service-outputs\/([a-f0-9-]{36})\/(accept|reject)$/);
        if(serviceOutputDecision&&req.method==='POST') return serviceOutputs.decideServiceOutput(db,u,serviceOutputDecision[1],{...input,decision:serviceOutputDecision[2]});
        const experienceAnswer=p.match(/^\/api\/service-experience\/([a-f0-9-]+)\/answer$/);
        if(experienceAnswer&&req.method==='POST') return once(()=>({id:experienceAnswer[1],...serviceExperience.answerExperience(db,u,experienceAnswer[1],input)}),id=>serviceExperience.experienceQuestion(db,u,id));
        // المعرفة وإقرار السياسات ومراجعة الصلاحيات
        if(p==='/api/knowledge/sources'&&req.method==='POST') return once(()=>knowledge.registerSource(db,u,input),id=>({id}));
        const knowledgeSourceStep=p.match(/^\/api\/knowledge\/sources\/([a-f0-9-]{36})\/(verify_source|request_update|edit_source|retire_source)$/);
        if(knowledgeSourceStep&&req.method==='POST') return knowledge.sourceAction(db,u,knowledgeSourceStep[1],knowledgeSourceStep[2],input);
        if(p==='/api/policy-acknowledgements/rounds'&&req.method==='POST') return once(()=>policyAck.openRound(db,u,input),id=>({id}));
        const policyRoundStep=p.match(/^\/api\/policy-acknowledgements\/rounds\/([a-f0-9-]{36})\/(remind_round|sync_recipients|close_round|acknowledge)$/);
        if(policyRoundStep&&req.method==='POST') return policyRoundStep[2]==='acknowledge'?policyAck.acknowledgePolicy(db,u,policyRoundStep[1],input):policyAck.roundAction(db,u,policyRoundStep[1],policyRoundStep[2],input);
        // مكتبة السياسات (ترحيل 110)
        if(p==='/api/policy-library/documents'&&req.method==='POST') return once(()=>policyLibrary.createDocument(db,u,input),id=>({id}));
        const policyDocumentPublish=p.match(/^\/api\/policy-library\/documents\/([a-f0-9-]{36})\/publish$/);
        if(policyDocumentPublish&&req.method==='POST') return policyLibrary.publishDocument(db,u,policyDocumentPublish[1],input);
        const policyDocumentAck=p.match(/^\/api\/policy-library\/documents\/([A-Za-z0-9-]{1,60})\/acknowledge$/);
        if(policyDocumentAck&&req.method==='POST') return policyLibrary.acknowledgeReading(db,u,policyDocumentAck[1],input);
        const policyArticleStep=p.match(/^\/api\/policy-library\/articles\/([A-Za-z0-9-]{1,40})\/(favourite_article|unfavourite_article|acknowledge_article|edit_article|verify_article|approve_title)$/);
        if(policyArticleStep&&req.method==='POST') return policyLibrary.articleAction(db,u,policyArticleStep[1],policyArticleStep[2],input);
        const policyArticleView=p.match(/^\/api\/policy-library\/articles\/([A-Za-z0-9-]{1,40})\/view$/);
        if(policyArticleView&&req.method==='POST') return policyLibrary.recordView(db,u,policyArticleView[1]);
        if(p==='/api/policy-library/searches'&&req.method==='POST') return policyLibrary.logSearch(db,u,input);
        if(p==='/api/policy-library/synonyms'&&req.method==='POST') return once(()=>policyLibrary.addSynonym(db,u,input),id=>({id}));
        const policySynonymStep=p.match(/^\/api\/policy-library\/synonyms\/([a-f0-9-]{36}|policy-synonym-\d{3})\/(activate_synonym|deactivate_synonym)$/);
        if(policySynonymStep&&req.method==='POST') return policyLibrary.synonymAction(db,u,policySynonymStep[1],policySynonymStep[2],input);
        if(p==='/api/access-reviews/campaigns'&&req.method==='POST') return once(()=>accessReviews.openCampaign(db,u,input),id=>({id}));
        const accessCampaignClose=p.match(/^\/api\/access-reviews\/campaigns\/([a-f0-9-]{36})\/close$/);
        if(accessCampaignClose&&req.method==='POST') return accessReviews.closeCampaign(db,u,accessCampaignClose[1],input);
        const accessItemDecide=p.match(/^\/api\/access-reviews\/items\/([a-f0-9-]{36})\/decide$/);
        if(accessItemDecide&&req.method==='POST') return accessReviews.decideItem(db,u,accessItemDecide[1],input);
        const accessRevocationStep=p.match(/^\/api\/access-reviews\/revocations\/([a-f0-9-]{36})\/(execute_revocation|decline_revocation)$/);
        if(accessRevocationStep&&req.method==='POST') return accessReviews.revocationAction(db,u,accessRevocationStep[1],accessRevocationStep[2],input);
        // الفرص البيعية والتقديرات (price-cards وto-quote قبل مسار التقدير العام)
        if(p==='/api/pipeline/stages'&&req.method==='POST') return once(()=>pipeline.prepareStage(db,u,input),id=>({id}));
        const pipelineStageStep=p.match(/^\/api\/pipeline\/stages\/([a-f0-9-]{36})\/(approve_stage|reject_stage|retire_stage)$/);
        if(pipelineStageStep&&req.method==='POST') return pipeline.stageAction(db,u,pipelineStageStep[1],pipelineStageStep[2],input);
        if(p==='/api/pipeline/loss-reasons'&&req.method==='POST') return once(()=>pipeline.addLossReason(db,u,input),id=>({id}));
        const lossReasonStep=p.match(/^\/api\/pipeline\/loss-reasons\/([a-f0-9-]{36})\/(deactivate_reason|activate_reason)$/);
        if(lossReasonStep&&req.method==='POST') return pipeline.lossReasonAction(db,u,lossReasonStep[1],lossReasonStep[2],input);
        if(p==='/api/pipeline/opportunities'&&req.method==='POST') return once(()=>pipeline.createOpportunity(db,u,input),id=>({id}));
        // فرصة التجديد تنفتح من العقد السابق: إنشاءٌ بمفتاح التكرار.
        const renewalOpen=p.match(/^\/api\/pipeline\/contracts\/([a-f0-9-]{36})\/open_renewal$/);
        if(renewalOpen&&req.method==='POST') return once(()=>clientRenewals.openRenewal(db,u,renewalOpen[1],input),id=>({id}));
        const opportunityStep=p.match(/^\/api\/pipeline\/opportunities\/([a-f0-9-]{36})\/(edit|activity|move|win|lose)$/);
        if(opportunityStep&&req.method==='POST') return pipeline.opportunityAction(db,u,opportunityStep[1],opportunityStep[2],input);
        if(p==='/api/estimates/price-cards'&&req.method==='POST') return once(()=>estimates.preparePriceCard(db,u,input),id=>({id}));
        const priceCardStep=p.match(/^\/api\/estimates\/price-cards\/([a-f0-9-]{36})\/(approve_card|reject_card)$/);
        if(priceCardStep&&req.method==='POST') return estimates.priceCardAction(db,u,priceCardStep[1],priceCardStep[2],input);
        if(p==='/api/estimates'&&req.method==='POST') return once(()=>estimates.saveEstimate(db,u,input,{costRate}),id=>({id}));
        const estimateToQuote=p.match(/^\/api\/estimates\/([a-f0-9-]{36})\/to-quote$/);
        if(estimateToQuote&&req.method==='POST'){
          const h=estimates.commercialPayload(db,u,estimateToQuote[1],input);
          if(!h.case_id)fail(409,'handoff_required','اربط التقدير بملف تجاري أولًا');
          return commercial.commercialAction(db,u,h.case_id,h.action,{version:h.case_version,...h.payload});
        }
        const estimateStep=p.match(/^\/api\/estimates\/([a-f0-9-]{36})\/(edit|submit|withdraw|approve|reject|handoff)$/);
        if(estimateStep&&req.method==='POST') return estimates.estimateAction(db,u,estimateStep[1],estimateStep[2],input,{costRate});
        // تسعير المشاريع (ترحيل 108): السياسات وقرار جهة الإصدار قبل مسار الورقة العام.
        if(p==='/api/pricing/policies'&&req.method==='POST') return once(()=>pricing.preparePolicy(db,u,input),id=>({id}));
        const pricingPolicyStep=p.match(/^\/api\/pricing\/policies\/([a-f0-9-]{36})\/(approve_policy|reject_policy)$/);
        if(pricingPolicyStep&&req.method==='POST') return pricing.policyAction(db,u,pricingPolicyStep[1],pricingPolicyStep[2],input);
        if(p==='/api/pricing/decisions'&&req.method==='POST') return once(()=>pricing.prepareIssuerDecision(db,u,input),id=>({id}));
        const pricingDecisionStep=p.match(/^\/api\/pricing\/decisions\/([a-f0-9-]{36})\/(approve_decision|reject_decision)$/);
        if(pricingDecisionStep&&req.method==='POST') return pricing.issuerDecisionAction(db,u,pricingDecisionStep[1],pricingDecisionStep[2],input);
        const pricingExceptionStep=p.match(/^\/api\/pricing\/exceptions\/([a-f0-9-]{36})\/(approve_exception|reject_exception)$/);
        if(pricingExceptionStep&&req.method==='POST') return pricing.marginExceptionAction(db,u,pricingExceptionStep[1],pricingExceptionStep[2],input);
        // سجل التعريفات (ترحيل 123): المسودة ورقة عمل، والنشر والاسترجاع والتطبيق أحداث هوية. لا once: لا ينشئ أيٌّ منها سجلًا بمفتاح تكرار.
        if(p==='/api/view-as/start'&&req.method==='POST') return viewAs.start(db,u,auth.session,input);
        if(p==='/api/view-as/stop'&&req.method==='POST') return viewAs.stop(db,u,auth.session);
        if(p==='/api/definitions/import/check'&&req.method==='POST') return definitionsTransfer.checkImport(db,u,input);
        const definitionImportStep=p.match(/^\/api\/definitions\/import\/([a-f0-9-]{36})\/(apply|abandon)$/);
        if(definitionImportStep&&req.method==='POST') return definitionImportStep[2]==='apply'?definitionsTransfer.applyImport(db,u,definitionImportStep[1],input):definitionsTransfer.abandonImport(db,u,definitionImportStep[1]);
        const definitionStep=p.match(/^\/api\/definitions\/([a-z][a-z_]{2,39})\/(draft|draft\/discard|draft\/submit|publish|rollback)$/);
        if(definitionStep&&req.method==='POST') return {draft:definitions.saveDraft,'draft/discard':definitions.discardDraft,'draft/submit':definitions.submitDraft,
          publish:definitions.publishDraft,rollback:definitions.rollbackTo}[definitionStep[2]](db,u,definitionStep[1],input);
        // حفظ قيم الحقول المخصّصة لسجل نموذجُه غير مفتوح. التفويض على السجل من وحدته (descriptor.load)، والقفل المتفائل بنسخة السجل.
        const recordCustomFields=p.match(/^\/api\/records\/([a-z][a-z_]{2,39})\/([a-f0-9-]{36})\/custom-fields$/);
        if(recordCustomFields&&req.method==='POST'){
          if(!definitions.entityFor(recordCustomFields[1])?.table) fail(404,'not_found','لا كيان مشارك في سجل التعريفات بهذا المفتاح. الكيانات المشاركة: client وopportunity وclient_quotation');
          return customFields.saveValues(db,u,recordCustomFields[1],recordCustomFields[2],input);
        }
        const quotationStep=p.match(/^\/api\/pricing\/quotations\/([a-f0-9-]{36})\/(issue|revise|accept|reject)$/);
        if(quotationStep&&req.method==='POST') return pricing.quotationAction(db,u,quotationStep[1],quotationStep[2],input);
        if(p==='/api/pricing/sheets'&&req.method==='POST') return once(()=>pricing.saveSheet(db,u,input,{mediaInvoice}),id=>({id}));
        const sheetExceptionNew=p.match(/^\/api\/pricing\/sheets\/([a-f0-9-]{36})\/exception$/);
        if(sheetExceptionNew&&req.method==='POST') return once(()=>pricing.requestMarginException(db,u,sheetExceptionNew[1],input),id=>({id}));
        const sheetQuotationNew=p.match(/^\/api\/pricing\/sheets\/([a-f0-9-]{36})\/quotation$/);
        if(sheetQuotationNew&&req.method==='POST') return once(()=>pricing.createQuotation(db,u,sheetQuotationNew[1],input),id=>({id}));
        const pricingSheetStep=p.match(/^\/api\/pricing\/sheets\/([a-f0-9-]{36})\/(edit|submit|withdraw|decide)$/);
        if(pricingSheetStep&&req.method==='POST') return pricing.sheetAction(db,u,pricingSheetStep[1],pricingSheetStep[2],input,{mediaInvoice});
        // طابور المهام والأعلام وحوكمة المساعدين (تشغيل الحزمة خارج هذه المعاملة أعلاه)
        const jobStep=p.match(/^\/api\/jobs\/([a-f0-9-]{36})\/(retry|cancel)$/);
        if(jobStep&&req.method==='POST') return jobStep[2]==='retry'?jobs.retryJob(db,u,jobStep[1],input):jobs.cancelJob(db,u,jobStep[1],input);
        if(p==='/api/feature-flags'&&req.method==='POST') return once(()=>flags.createFlag(db,u,input),id=>({id}));
        const flagRetire=p.match(/^\/api\/feature-flags\/([a-f0-9-]{36})\/retire$/);
        if(flagRetire&&req.method==='POST') return flags.retireFlag(db,u,flagRetire[1],input);
        const flagUpdate=p.match(/^\/api\/feature-flags\/([a-f0-9-]{36})$/);
        if(flagUpdate&&req.method==='POST') return flags.updateFlag(db,u,flagUpdate[1],input);
        if(p==='/api/ai-governance/seed'&&req.method==='POST') return gov.seedInventory(db,u);
        const assetAssessment=p.match(/^\/api\/ai-governance\/assets\/([a-f0-9-]{36})\/assessments$/);
        if(assetAssessment&&req.method==='POST') return gov.submitAssessment(db,u,assetAssessment[1],input);
        const assessmentDecide=p.match(/^\/api\/ai-governance\/assessments\/([a-f0-9-]{36})\/decide$/);
        if(assessmentDecide&&req.method==='POST') return gov.decideAssessment(db,u,assessmentDecide[1],input);
        const assetState=p.match(/^\/api\/ai-governance\/assets\/([a-f0-9-]{36})\/(activate|suspend)$/);
        if(assetState&&req.method==='POST') return assetState[2]==='activate'?gov.activateAsset(db,u,assetState[1],input):gov.suspendAsset(db,u,assetState[1],input);
        // تقييم الإجابة من صاحبها، وإغلاق سؤال بلا نص بعد إضافة النص (لفريق السياسات والمصادر)
        const answerRating=p.match(/^\/api\/policy-assistant\/questions\/([a-f0-9-]{36})\/(rate|resolve)$/);
        if(answerRating&&req.method==='POST') return answerRating[2]==='rate'?policyAssistant.rateAnswer(db,u,answerRating[1],input):policyAssistant.resolveQuestion(db,u,answerRating[1],input);
        if(p==='/api/ai-evals/suites'&&req.method==='POST') return once(()=>evals.createSuite(db,u,input),id=>({id}));
        const evalCaseAdd=p.match(/^\/api\/ai-evals\/suites\/([a-f0-9-]{36})\/cases$/);
        if(evalCaseAdd&&req.method==='POST') return evals.addCase(db,u,evalCaseAdd[1],input);
        const evalCaseRetire=p.match(/^\/api\/ai-evals\/cases\/([a-f0-9-]{36})\/retire$/);
        if(evalCaseRetire&&req.method==='POST') return evals.retireCase(db,u,evalCaseRetire[1],input);
        // جودة حقول الخدمة (reportFieldGap تعيد اللوحة بلا id فتُلف)
        const fieldGap=p.match(/^\/api\/catalog-quality\/requests\/([a-f0-9-]+)\/field-gap$/);
        if(fieldGap&&req.method==='POST') return once(()=>({...catalogQuality.reportFieldGap(db,u,fieldGap[1],input),id:fieldGap[1]}),()=>catalogQuality.catalogQualityBoard(db,u));
        // حالات الموارد البشرية: البلاغ المجهول أولًا وبلا once (سجل المفاتيح يحفظ user_id فيربط المبلّغ ببلاغه)
        if(p==='/api/hr-cases/anonymous'&&req.method==='POST') return hrCases.submitAnonymousReport(db,u,input);
        if(p==='/api/hr-cases/anonymous/follow'&&req.method==='POST') return hrCases.followAnonymousReport(db,u,input);
        if(p==='/api/hr-cases/anonymous/reply'&&req.method==='POST') return hrCases.replyAnonymousReport(db,u,input);
        const anonymousReportStep=p.match(/^\/api\/hr-cases\/anonymous\/([a-f0-9-]{36})\/(take_report|reply_report|handover_report|close_report)$/);
        if(anonymousReportStep&&req.method==='POST') return hrCases.reportAction(db,u,anonymousReportStep[1],anonymousReportStep[2],input);
        if(p==='/api/hr-cases/targets'&&req.method==='POST') return once(()=>hrCases.setCaseTarget(db,u,input),id=>({id}));
        if(p==='/api/hr-cases'&&req.method==='POST') return once(()=>hrCases.fileCase(db,u,input),id=>({id}));
        const hrCaseStep=p.match(/^\/api\/hr-cases\/([a-f0-9-]{36})\/(take_case|add_info|withdraw_case|note_case|reply_case|decide_case|reassign_case|close_case)$/);
        if(hrCaseStep&&req.method==='POST') return hrCases.caseAction(db,u,hrCaseStep[1],hrCaseStep[2],input);
        // سجل المخالفات والجزاءات (ترحيل 097)
        if(p==='/api/discipline/schedules'&&req.method==='POST') return once(()=>discipline.prepareSchedule(db,u,input),id=>({id}));
        const disciplineScheduleStep=p.match(/^\/api\/discipline\/schedules\/([a-z0-9-]{3,64})\/(accept|reject)$/);
        if(disciplineScheduleStep&&req.method==='POST') return discipline.decideSchedule(db,u,disciplineScheduleStep[1],disciplineScheduleStep[2],input);
        if(p==='/api/discipline/cases'&&req.method==='POST') return once(()=>discipline.recordViolation(db,u,input),id=>({id}));
        const disciplineStep=p.match(/^\/api\/discipline\/cases\/([a-f0-9-]{36})\/(open_investigation|record_hearing|submit_defence|conclude|decide|issue_notice|record_delivery|file_grievance|answer_grievance|propose_deduction|withdraw|close_lapsed)$/);
        if(disciplineStep&&req.method==='POST') return discipline.caseAction(db,u,disciplineStep[1],disciplineStep[2],input);
        // التعويضات والقوى العاملة
        if(p==='/api/compensation/bands'&&req.method==='POST') return once(()=>compensation.prepareBand(db,u,input),id=>({id}));
        const compBandStep=p.match(/^\/api\/compensation\/bands\/([a-f0-9-]{36})\/(approve|reject)$/);
        if(compBandStep&&req.method==='POST') return compensation.decideBand(db,u,compBandStep[1],compBandStep[2],input);
        if(p==='/api/compensation/cycles'&&req.method==='POST') return once(()=>compensation.createCompCycle(db,u,input),id=>({id}));
        const compCycleStep=p.match(/^\/api\/compensation\/cycles\/([a-f0-9-]{36})\/(open|close)$/);
        if(compCycleStep&&req.method==='POST') return compensation.compCycleAction(db,u,compCycleStep[1],compCycleStep[2],input);
        if(p==='/api/compensation/proposals'&&req.method==='POST') return once(()=>compensation.proposeIncrease(db,u,input),id=>({id}));
        const compProposalStep=p.match(/^\/api\/compensation\/proposals\/([a-f0-9-]{36})\/(assess|approve|reject|withdraw)$/);
        if(compProposalStep&&req.method==='POST') return compensation.proposalAction(db,u,compProposalStep[1],compProposalStep[2],input);
        const compRecommendationStep=p.match(/^\/api\/compensation\/recommendations\/([a-f0-9-]{36})\/(link|drop)$/);
        if(compRecommendationStep&&req.method==='POST') return compensation.recommendationAction(db,u,compRecommendationStep[1],compRecommendationStep[2],input);
        if(p==='/api/compensation/privacy'&&req.method==='POST') return once(()=>compensation.setGapPrivacy(db,u,input),id=>({id}));
        if(p==='/api/workforce/simulate'&&req.method==='POST') return workforce.simulateSaudization(db,u,input);
        const demographicsSave=p.match(/^\/api\/workforce\/demographics\/([a-z0-9._-]+)$/);
        if(demographicsSave&&req.method==='POST') return workforce.recordDemographics(db,u,demographicsSave[1],input);
        // إعدادات محرك الاعتماد (الحد يُرسل بمفتاح؛ القرار والبديل والتبني بلا مفتاح كما ترسلها الواجهة)
        if(p==='/api/approval-settings/thresholds'&&req.method==='POST') return once(()=>wf.proposeThreshold(db,u,input),id=>({id}));
        const thresholdDecide=p.match(/^\/api\/approval-settings\/thresholds\/([a-f0-9-]{36})\/decide$/);
        if(thresholdDecide&&req.method==='POST') return wf.decideThreshold(db,u,thresholdDecide[1],input);
        if(p==='/api/approval-settings/fallbacks'&&req.method==='POST') return wf.setApprovalFallback(db,u,input)??{removed:true};
        const proposalAdopt=p.match(/^\/api\/approval-settings\/proposals\/([a-z0-9-]{3,80})\/adopt$/);
        if(proposalAdopt&&req.method==='POST') return adoptPolicyProposal(db,u,proposalAdopt[1],input);
        // زمن الخدمة: مفتاح مقترح بالساعات بحروف صغيرة (ترحيل 115)، أو رمز خدمة بحروف كبيرة يتبنّى زمنَه مديرُ إدارتها.
        const targetDecide=p.match(/^\/api\/approval-settings\/targets\/([A-Za-z0-9-]{3,80})\/decide$/);
        if(targetDecide&&req.method==='POST') return decideServiceTarget(db,u,targetDecide[1],input);
        // مفتاح تفعيل الخدمة وإخفائها (ترحيل 129): قرار واحد لكل نداء — خدمةً في الدليل أو ميزةً في «مزاياي» —
        // بسببه المكتوب، يُلحق صفًّا في السجل ويُختم في سلسلة التدقيق. بلا once: السجل إلحاقي والقادح
        // service_availability_no_repeat يردّ التكرار، فإعادة إرسال الطلب نفسه لا تضيف قرارًا ثانيًا.
        if(p==='/api/approval-settings/availability'&&req.method==='POST') return setAvailability(db,u,input);
        // شرط أهلية خدمة (ترحيل 138): للأدمن الأول وحده، بسند مكتوب، داخل معاملة. القادح
        // service_gate_no_repeat يردّ التكرار، فإعادة إرسال الطلب نفسه ما تضيف قرارًا ثانيًا.
        if(p==='/api/approval-settings/service-gates'&&req.method==='POST') return setServiceGate(db,u,input);
        // النائب المنفذ: تسمية ثم قبول من شخص ثانٍ ثم سحب (ترحيل 122). المقترح وحده لا ينفّذ.
        // الموجة 2 «لا طلب يضيع»: المهل (اقتراح من حساب وتبنٍّ من آخر)، ونقل قرار خطوة متوقفة، وتجاوز إسناد عمل عند حساب موقوف، وإشعار بلا مستلم.
        if(p==='/api/workflow-timers'&&req.method==='POST') return workflowTimers.proposeTimer(db,u,input);
        const timerStep=p.match(/^\/api\/workflow-timers\/([a-f0-9-]{36})\/(adopt|retire)$/);
        if(timerStep&&req.method==='POST') return timerStep[2]==='adopt'?workflowTimers.adoptTimer(db,u,timerStep[1],input):workflowTimers.retireTimer(db,u,timerStep[1],input);
        const stepOverride=p.match(/^\/api\/workflow-control\/steps\/([a-f0-9-]{36})\/override$/);
        if(stepOverride&&req.method==='POST') return overrideEscalation(db,u,stepOverride[1],input);
        const workOverride=p.match(/^\/api\/workflow-control\/work\/([a-f0-9-]{36})\/override$/);
        if(workOverride&&req.method==='POST') return requestAssignment.overrideAssignment(db,u,workOverride[1],input);
        const noticeResolve=p.match(/^\/api\/workflow-control\/undeliverable\/([a-f0-9-]{36})\/resolve$/);
        if(noticeResolve&&req.method==='POST') return resolveUndeliverable(db,u,noticeResolve[1],input);
        if(p==='/api/approval-settings/deputies'&&req.method==='POST') return wf.proposeExecutionDeputy(db,u,input);
        if(p==='/api/approval-settings/deputies/accept'&&req.method==='POST') return wf.acceptExecutionDeputy(db,u,input);
        if(p==='/api/approval-settings/deputies/withdraw'&&req.method==='POST') return wf.withdrawExecutionDeputy(db,u,input);
        // الصرف الإعلامي وتقارير العملاء (templates قبل مسار التقرير العام)
        if(p==='/api/media-spend/plans'&&req.method==='POST') return once(()=>mediaSpend.prepareMediaPlan(db,u,input),id=>({id}));
        const mediaPlanStep=p.match(/^\/api\/media-spend\/plans\/([a-f0-9-]{36})\/(edit_plan|approve_plan|discard_plan)$/);
        if(mediaPlanStep&&req.method==='POST') return mediaSpend.mediaPlanAction(db,u,mediaPlanStep[1],mediaPlanStep[2],input);
        const mediaCampaignStep=p.match(/^\/api\/media-spend\/campaigns\/([a-f0-9-]{36})\/(spend|imports|thresholds|billings|acknowledge)$/);
        if(mediaCampaignStep&&req.method==='POST'){
          const [,mediaCampaignId,mediaCampaignAction]=mediaCampaignStep;
          if(mediaCampaignAction==='acknowledge')return mediaSpend.acknowledgeSpend(db,u,mediaCampaignId,input);
          const mediaWrite={spend:mediaSpend.recordMediaSpend,imports:mediaSpend.importMediaSpend,thresholds:mediaSpend.setThreshold,billings:mediaSpend.recordBilling}[mediaCampaignAction];
          return once(()=>mediaWrite(db,u,mediaCampaignId,input),id=>({id}));
        }
        const mediaEntryStep=p.match(/^\/api\/media-spend\/entries\/([a-f0-9-]{36})\/(correct|commitment)$/);
        if(mediaEntryStep&&req.method==='POST') return mediaEntryStep[2]==='correct'?mediaSpend.correctMediaSpend(db,u,mediaEntryStep[1],input):mediaSpend.linkCommitment(db,u,mediaEntryStep[1],input);
        const mediaImportCancel=p.match(/^\/api\/media-spend\/imports\/([a-f0-9-]{36})\/cancel$/);
        if(mediaImportCancel&&req.method==='POST') return mediaSpend.cancelMediaImport(db,u,mediaImportCancel[1],input);
        const mediaThresholdRetire=p.match(/^\/api\/media-spend\/thresholds\/([a-f0-9-]{36})\/retire$/);
        if(mediaThresholdRetire&&req.method==='POST') return mediaSpend.retireThreshold(db,u,mediaThresholdRetire[1],input);
        if(p==='/api/media-spend/profiles'&&req.method==='POST') return once(()=>mediaSpend.saveMediaProfile(db,u,input),id=>({id}));
        const mediaProfileDeactivate=p.match(/^\/api\/media-spend\/profiles\/([a-f0-9-]{36})\/deactivate$/);
        if(mediaProfileDeactivate&&req.method==='POST') return mediaSpend.deactivateMediaProfile(db,u,mediaProfileDeactivate[1],input);
        if(p==='/api/client-reports/templates'&&req.method==='POST') return once(()=>clientReports.createTemplate(db,u,input),id=>({id}));
        const clientTemplateStep=p.match(/^\/api\/client-reports\/templates\/([a-f0-9-]{36})\/(edit_template|deactivate_template)$/);
        if(clientTemplateStep&&req.method==='POST') return clientReports.templateAction(db,u,clientTemplateStep[1],clientTemplateStep[2],input);
        if(p==='/api/client-reports'&&req.method==='POST') return once(()=>clientReports.generateReport(db,u,input),id=>({id}));
        const clientReportStep=p.match(/^\/api\/client-reports\/([a-f0-9-]{36})\/(write_commentary|sign_report|discard_report)$/);
        if(clientReportStep&&req.method==='POST') return clientReports.reportAction(db,u,clientReportStep[1],clientReportStep[2],input);
        if(match) {
          if(!match[2]&&req.method==='PATCH') return wf.editRequest(db,u,match[1],input);
          // «escalate» مفتاح قديم لفعل هو «تذكير المعتمد»: لا ينقل قرارًا. نقل القرار في ‎/api/workflow-control/steps/…/override‎ وفي التشغيل اليومي.
          if(match[2]==='escalate'&&req.method==='POST')return wf.remindApprover(db,u,match[1],input);
          // الموجة 2، العطب 8: المنفّذ يعيد الطلب إلى طابور إدارته، ومدير الإدارة المنفذة يعيد إسناده. الحوار العام يرسل السبب في note.
          if(match[2]==='release'&&req.method==='POST')return requestAssignment.releaseRequest(db,u,match[1],{version:input?.version,reason:input?.reason??input?.note});
          if(match[2]==='reassign'&&req.method==='POST')return requestAssignment.reassignRequest(db,u,match[1],input);
          // الطلب المنقضي لعدم الرد: صاحبه وحده يعيد تقديمه، فتُنشأ مسودة جديدة من بياناته ويبقى المنقضي مغلقًا.
          if(match[2]==='resubmit'&&req.method==='POST')return resubmitLapsed(db,u,match[1],input);
          if(match[2]==='attachments'&&req.method==='POST') return wf.addAttachment(db,u,match[1],input);
          if(['submit','approve','return','reject','cancel','claim','complete'].includes(match[2])&&req.method==='POST'){
            // بوابة الاستقبال: تُفحص فقط حين يملك السائل فعل التقديم، وإلا يرد transition برفضه المعتاد.
            // الحقل المطلوب والعنوان يفرضهما transition نفسه (ويحترم الحقل المخفي بشرطه، والبوابة لا تحترمه)،
            // فلا تمنع البوابة هنا إلا بما يخص الاستقبال: أولوية ناقصة بعد تعريف المصفوفة، موعد مضى، أثر مالي بلا مبرر.
            // طلب قديم بلا بيانات استقبال ومصفوفة غير معرّفة لا يلقى مانعًا منها، فيُقدَّم كما كان.
            if(match[2]==='submit'&&wf.actions(db,u,wf.getRequest(db,u,match[1])).includes('submit')){
              const gate=requestIntake.submissionGate(db,u,match[1]);
              const blocking=gate.blocking.filter(b=>!['missing_field','missing_title'].includes(b.code));
              if(blocking.length) throw Object.assign(new AppError(409,'intake_blocked',`لا يمكن تقديم الطلب قبل استكمال: ${blocking.map(b=>b.text).join('؛ ')}`),{details:{blocking,advisory:gate.advisory}});
            }
            // ── بابٌ واحد للإغلاق (قرار 21 سبتمبر) ──────────────────────────────────
            // كان هنا بابان: هذا الباب يُغلق الطلب بملاحظة من ثلاثة أحرف ولا يكتب سطرًا في request_closures،
            // ثم تُرفض على صاحب الطلب إعادةُ الفتح بـno_closure_record — فخٌّ نصبته المنصة على نفسها.
            // صار المسار واحدًا: closeWithEvidence (app/request-closure.mjs) يشترط وصفًا يصلح دليلًا بعد شهر،
            // ويكتب سجل الإغلاق، ويتحقق أن صاحب الطلب أُعلم. الانتقال نفسه ما زال في wf.transition بلا تغيير،
            // والشكل المعاد هو شكل الطلب كما يعيده أي انتقال آخر، فلا تتغير واجهة الشاشة ولا بقية النداءات.
            if(match[2]==='complete'){
              const closed=requestClosure.closeWithEvidence(db,u,match[1],{version:input?.version,delivered:input?.delivered??input?.note});
              return closed.request;
            }
            const moved=wf.transition(db,u,match[1],match[2],input);
            // التقديم يجمّد بيانات الاستقبال مع النسخة، والإعادة لصاحبه تفتحها ليصححها.
            if(match[2]==='submit')requestIntake.freezeIntake(db,u,match[1]);
            if(match[2]==='return')requestIntake.thawIntakeOnReturn(db,u.tenant_id,match[1]);
            // بعد التقديم تقول رسالة التأكيد المرحلة وعند من الطلب الآن (whereabouts)، والشكل المعاد شكل الطلب كما كان.
            return match[2]==='submit'?{...moved,whereabouts:requestTimeline.whereabouts(db,u,match[1])}:moved;
          }
        }
        // النماذج الإلكترونية (ترحيل 107): تعريفاتها ونسخها المملوءة وقراراتها الإلكترونية.
        if(p==='/api/forms/search'&&req.method==='POST') return forms.searchForms(db,u,input);
        if(p==='/api/forms/definitions'&&req.method==='POST') return once(()=>forms.draftDefinition(db,u,input),id=>({id}));
        const formAccept=p.match(/^\/api\/forms\/definitions\/(FORM-[A-Z0-9-]{3,54})\/accept$/);
        if(formAccept&&req.method==='POST') return forms.acceptDefinition(db,u,formAccept[1],input);
        if(p==='/api/forms/instances'&&req.method==='POST') return once(()=>forms.createInstance(db,u,input),id=>forms.getInstance(db,u,id));
        const formSave=p.match(/^\/api\/forms\/instances\/([a-f0-9-]{36})$/);
        if(formSave&&req.method==='PATCH') return forms.saveInstance(db,u,formSave[1],input);
        const formStep=p.match(/^\/api\/forms\/instances\/([a-f0-9-]{36})\/(submit|cancel|claim_review|mark_incomplete|approve|return|reject|revise)$/);
        if(formStep&&req.method==='POST') return forms.instanceAction(db,u,formStep[1],formStep[2],input);
        const task=p.match(/^\/api\/projects\/([a-f0-9-]+)\/tasks$/);
        if(task&&req.method==='POST') return once(()=>projects.createTask(db,u,task[1],input),id=>projects.listProjects(db,u).flatMap(p=>p.tasks).find(t=>t.id===id));
        const done=p.match(/^\/api\/tasks\/([a-f0-9-]+)\/complete$/);
        if(done&&req.method==='POST') return projects.completeTask(db,u,done[1],input);
        /* ───── سجلّات تقرير الإدارة التنفيذية للمشاريع (ترحيل 118) ───── */
        // تعليق القسم يُنشأ ويُصحَّح بالمسار نفسه ومعه نسخته، فلا مفتاح تكرار له: التصحيح مقصود لا سهو.
        if(p==='/api/epmo/notes'&&req.method==='POST') return epmo.epmoNoteAction(db,u,input);
        if(p==='/api/epmo/decision-requests'&&req.method==='POST') return once(()=>epmo.requestDecision(db,u,input),id=>({id}));
        const epmoRequestStep=p.match(/^\/api\/epmo\/decision-requests\/([a-f0-9-]{36})\/(link_decision|withdraw_request)$/);
        if(epmoRequestStep&&req.method==='POST') return epmo.decisionRequestAction(db,u,epmoRequestStep[1],epmoRequestStep[2],input);
        // مفتاح الفجوة نصّ من كتالوج الشيفرة لا UUID؛ الشكل هنا يحرس المسار، والكتالوج يحرس المعنى.
        const epmoGapStep=p.match(/^\/api\/epmo\/gaps\/([a-z][a-z0-9_]{2,59})\/(own_gap|close_gap|refuse_gap|reopen_gap)$/);
        if(epmoGapStep&&req.method==='POST') return epmo.gapAction(db,u,epmoGapStep[1],epmoGapStep[2],input);
        /* ───── محاور حالة المشروع وإقفاله (ترحيل 116) ───── */
        const paymentTerms=p.match(/^\/api\/commercial\/([a-f0-9-]+)\/payment-terms$/);
        if(paymentTerms&&req.method==='POST') return projectAxes.recordPaymentTerms(db,u,paymentTerms[1],input);
        const clientPo=p.match(/^\/api\/commercial\/([a-f0-9-]+)\/purchase-order$/);
        if(clientPo&&req.method==='POST') return once(()=>projectAxes.recordClientPurchaseOrder(db,u,clientPo[1],input),id=>({id}));
        const clientPoConfirm=p.match(/^\/api\/client-purchase-orders\/([a-f0-9-]+)\/confirm$/);
        if(clientPoConfirm&&req.method==='POST') return projectAxes.confirmClientPurchaseOrder(db,u,clientPoConfirm[1],input);
        const execution=p.match(/^\/api\/projects\/([a-f0-9-]+)\/execution$/);
        if(execution&&req.method==='POST') return projectAxes.setExecutionState(db,u,execution[1],input);
        // الإعفاء بيدين (ترحيل 160): طلبٌ بمفتاح تكرار لأنه إنشاء، ثم اعتمادٌ أو رفضٌ من غير الطالب، ثم سحبٌ بسبب.
        const waiverRequest=p.match(/^\/api\/projects\/([a-f0-9-]+)\/readiness-waiver-requests$/);
        if(waiverRequest&&req.method==='POST') return once(()=>projectAxes.requestReadinessWaiver(db,u,waiverRequest[1],input),id=>({id}));
        const waive=p.match(/^\/api\/projects\/([a-f0-9-]+)\/readiness-waivers$/);
        if(waive&&req.method==='POST') return projectAxes.waiveReadiness(db,u,waive[1],input);
        const waiverDecline=p.match(/^\/api\/readiness-waiver-requests\/([a-f0-9-]+)\/decline$/);
        if(waiverDecline&&req.method==='POST') return projectAxes.declineReadinessWaiver(db,u,waiverDecline[1],input);
        const waiverWithdraw=p.match(/^\/api\/readiness-waivers\/([a-f0-9-]+)\/withdraw$/);
        if(waiverWithdraw&&req.method==='POST') return projectAxes.withdrawReadinessWaiver(db,u,waiverWithdraw[1],input);
        const projectDepartment=p.match(/^\/api\/projects\/([a-f0-9-]+)\/departments$/);
        if(projectDepartment&&req.method==='POST') return once(()=>projectAxes.requestDepartmentParticipation(db,u,projectDepartment[1],input),id=>({id}));
        const projectDepartmentDecision=p.match(/^\/api\/project-department-requests\/([a-f0-9-]+)\/(accept_participation|return_participation)$/);
        if(projectDepartmentDecision&&req.method==='POST') return projectAxes.decideDepartmentParticipation(db,u,projectDepartmentDecision[1],projectDepartmentDecision[2],input);
        const projectMember=p.match(/^\/api\/projects\/([a-f0-9-]+)\/members$/);
        if(projectMember&&req.method==='POST') return projectAxes.addProjectMember(db,u,projectMember[1],input);
        const workPackage=p.match(/^\/api\/projects\/([a-f0-9-]+)\/work-packages$/);
        if(workPackage&&req.method==='POST') return once(()=>projectAxes.createWorkPackage(db,u,workPackage[1],input),id=>({id}));
        const workPackageStep=p.match(/^\/api\/work-packages\/([a-f0-9-]+)\/(activate|block|deliver|cancel)$/);
        if(workPackageStep&&req.method==='POST') return projectAxes.workPackageAction(db,u,workPackageStep[1],workPackageStep[2],input);
        // عمق حزمة العمل (ترحيل 165): نطاقها، ومساهموها من الإدارات المشاركة، وتبعياتها بلا حلقة.
        const packageScope=p.match(/^\/api\/work-packages\/([a-f0-9-]+)\/scope$/);
        if(packageScope&&req.method==='POST') return projectAxes.setWorkPackageScope(db,u,packageScope[1],input);
        const packageContributor=p.match(/^\/api\/work-packages\/([a-f0-9-]+)\/contributors$/);
        if(packageContributor&&req.method==='POST') return once(()=>projectAxes.addWorkPackageContributor(db,u,packageContributor[1],input),id=>({id}));
        const contributorRemoval=p.match(/^\/api\/work-package-contributors\/([a-f0-9-]+)\/remove$/);
        if(contributorRemoval&&req.method==='POST') return projectAxes.removeWorkPackageContributor(db,u,contributorRemoval[1],input);
        const packageDependency=p.match(/^\/api\/work-packages\/([a-f0-9-]+)\/dependencies$/);
        if(packageDependency&&req.method==='POST') return once(()=>projectAxes.addWorkPackageDependency(db,u,packageDependency[1],input),id=>({id}));
        const dependencyRemoval=p.match(/^\/api\/work-package-dependencies\/([a-f0-9-]+)\/remove$/);
        if(dependencyRemoval&&req.method==='POST') return projectAxes.removeWorkPackageDependency(db,u,dependencyRemoval[1],input);
        const taskPackage=p.match(/^\/api\/tasks\/([a-f0-9-]+)\/work-package$/);
        if(taskPackage&&req.method==='POST') return projectAxes.assignTaskToPackage(db,u,taskPackage[1],input);
        const certificate=p.match(/^\/api\/projects\/([a-f0-9-]+)\/completion-certificate$/);
        if(certificate&&req.method==='POST') return once(()=>certificates.issueCompletionCertificate(db,u,certificate[1],input),id=>certificates.getCompletionCertificate(db,u,id));
        // /acknowledge باقٍ باسمه منذ ترحيل 116، ومعناه صار قبول العميل بقناته وحدّها. التصحيح ينشئ نسخة جديدة فيحمل مفتاح التكرار؛
        // والقبول والعكس يُسجَّلان مرة على النسخة (قيد فريد)، فتكرارهما يُرفض برسالة تقول إنهما سُجّلا.
        const certificateStep=p.match(/^\/api\/completion-certificates\/([a-f0-9-]+)\/(acknowledge|correct|reverse)$/);
        if(certificateStep&&req.method==='POST'){
          if(certificateStep[2]==='correct') return once(()=>certificates.correctCompletionCertificate(db,u,certificateStep[1],input),id=>certificates.getCompletionCertificate(db,u,id));
          return certificateStep[2]==='acknowledge'?certificates.acknowledgeCompletionCertificate(db,u,certificateStep[1],input):certificates.reverseCompletionCertificate(db,u,certificateStep[1],input);
        }
        const closure=p.match(/^\/api\/projects\/([a-f0-9-]+)\/(close_technically|close_financially|close_finally|reopen_closure|accept_margin)$/);
        if(closure&&req.method==='POST') return closureAction(db,u,closure[1],closure[2],input);
        // نداءا التدقيق 174 و175 حرفيًا: كانا يردّان unknown_action و404. الإقفال محور المشروع،
        // فيُحوَّل النداء إلى مشروع الملف بدل أن يُخترع له حقل في الحالة التجارية.
        const caseClosure=p.match(/^\/api\/commercial\/([a-f0-9-]+)\/(close_project|close_financially|close_finally|reopen_closure)$/);
        if(caseClosure&&req.method==='POST'){
          const linked=db.prepare('SELECT project_id FROM commercial_cases WHERE id=? AND tenant_id=?').get(caseClosure[1],u.tenant_id)?.project_id;
          if(!linked) fail(409,'project_required','لا مشروع مفتوح على هذا الملف التجاري، فلا شيء يُقفل');
          return closureAction(db,u,linked,caseClosure[2]==='close_project'?'close_technically':caseClosure[2],input);
        }
        const notification=p.match(/^\/api\/notifications\/([a-f0-9-]+)\/read$/);
        if(notification&&req.method==='POST') return wf.markNotification(db,u,notification[1]);
        if(p==='/api/notifications/read-all'&&req.method==='POST') return wf.markAllNotifications(db,u);
        if(p==='/api/notification-settings'&&req.method==='POST') return delivery.savePreferences(db,u,input);
        const workEmail=p.match(/^\/api\/employees\/([a-z0-9._-]+)\/work-email$/);
        if(workEmail&&req.method==='POST') return delivery.setWorkEmail(db,u,workEmail[1],input);
        if(p==='/api/mail/requeue'&&req.method==='POST') return delivery.requeueMail(db,u,input);
        if(p==='/api/mail/reminder-settings'&&req.method==='POST') return reminders.setReminderSettings(db,u,input);
        fail(404,'not_found','المسار غير متاح');
      });
      clearInboxCache();
      send(req.method==='PATCH'?200:201,result);
    } catch(error) {
      if(auth&&error instanceof AppError&&error.status===403) audit(db,auth.user,'access',auth.user.id,'denied',{}, {code:error.code});
      if(!(error instanceof AppError)) console.error('Request failed:',error.name);
      // خطأ الخادم (5xx) لا يعني الموظف ولا يستطيع فعل شيء حياله؛ يُسجَّل تفصيله هنا وتصله رسالة واحدة واضحة.
      const status=error instanceof AppError?error.status:500;
      if(status>=500)console.error('Request failed:',req.method,req.url?.split('?')[0],error.code??'',error.message);
      send(status,{error:{code:status>=500?'internal_error':error.code,message:status>=500?'تعذر إكمال العملية ولم يُحفظ أي تغيير. أعد المحاولة، وإن تكرر فأبلغ مسؤول المنصة.':error.message,...(status<500&&error.details?{details:error.details}:{})}});
    }
  }));
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  // أسرار التشغيل (مثل مفتاح مزود النموذج) يضعها المالك في ‎.env بجانب المشروع؛ يقرؤها الخادم وحده عند الإقلاع ولا تُحفظ في القاعدة.
  try{process.loadEnvFile(resolve(root,'.env'));}catch(error){if(error.code!=='ENOENT')console.error('Could not read .env:',error.code??error.message);}
  if(process.env.NODE_ENV==='production') throw new Error('Production is disabled. This build is for local evaluation.');
  // خطأ الإقلاع يُطبع كما هو ويُخرج بالرمز 1: أثرُ المكدّس في سجل launchd يخفي الجملة التي تقول ما يُصلَح.
  let db,port,environment;
  try{
    environment=resolveEnvironment(process.env,{root});
    // مفتاح الحقول يتبع البيئة لا الافتراض: تجهيزٌ يقلع بلا ضبطٍ صريح كان سيفكّ الحقول بمفتاح التشغيل.
    // يُضبط قبل أول استعمال (crypto-fields يقرؤه عند الطلب لا عند الاستيراد).
    process.env.FIELD_KEY_PATH=environment.keyPath;
    db=openDb(dbPath(process.env,{root})); port=bootPort(process.env,{fallback:environment.port});
  }
  catch(error){
    if(!(error instanceof BootError)&&error?.name!=='EnvironmentError') throw error;
    console.error(`\nتعذّر إقلاع منصة 3,6T:\n  ${error.message}\n`);
    process.exit(1);
  }
  // التحقق من سلسلة التدقيق يمشي السجل كله، فيُشغَّل مرة عند الإقلاع وتُعرض نتيجته بتاريخها.
  const auditCheckedAtBoot={ok:verifyAudit(db),at:new Date().toISOString()};
  if(!auditCheckedAtBoot.ok)console.error('[سجل التدقيق] السلسلة لا تتحقق. لا تُبنَ على هذا السجل حتى يُفحص.');
  // بصمة الإصدار عند الإقلاع لا عند الطلب: تقول ما حُمِّل فعلًا. تعديلٌ في المجلد بعد الإقلاع لا يغيّرها،
  // وهو الصواب — العملية الجارية لا تزال تخدم ما حمّلته، وتختلف بصمتها حينها عن بصمة الشجرة على القرص.
  let buildAtBoot=null;try{buildAtBoot=buildInfo(root);}catch(error){console.error('[بصمة الإصدار] تعذّر حسابها:',error.message);}
  const app=createApp(db,{environment,auditCheckedAtBoot,buildAtBoot});app.requestTimeout=15000;app.headersTimeout=10000;
  if(environment.isStaging)console.log(`[البيئة] ${environment.name}: قاعدتها ${environment.dbPath} ومفتاحها ${environment.keyPath}. بيانات اصطناعية، وليست بيانات الشركة.`);
  { const notice=keyNotice(environment); if(notice)console.error(notice); }
  // اللقطات المجدولة: فحص عند الإقلاع ثم كل ربع ساعة. الخطأ هنا لا يُسقط الخادم.
  const schedules=()=>{try{const done=reportSchedules.runDueSchedules(db);if(done.length)console.log(`Scheduled report snapshots: ${done.length}`);}catch(error){console.error('Scheduled reports failed:',error.message);}};
  schedules();setInterval(schedules,15*60*1000).unref();
  // الفوترة الدورية: مسودات الفترات المستحقة، خارج أي معاملة لأن الدالة تفتح معاملتها لكل فترة.
  const billingRuns=()=>{try{billingRecurring.runDueSchedules(db);}catch(error){console.error('Recurring billing failed:',error.message);}};
  billingRuns();setInterval(billingRuns,15*60*1000).unref();
  // تذكير التجديد (P4-CRM-6): مرة لكل دورة عقد، خارج أي معاملة لأن الدالة تفتح معاملتها لكل عقد.
  const renewalRuns=()=>{try{const sent=clientRenewals.runRenewalReminders(db);if(sent.length)console.log(`Renewal reminders: ${sent.length}`);}catch(error){console.error('Renewal reminders failed:',error.message);}};
  renewalRuns();setInterval(renewalRuns,15*60*1000).unref();
  // الأسئلة الدورية لمساحات العمل: توليد الدورة المستحقة محليًا وبشكل idempotent، دون إرسال خارجي.
  const checkinRuns=()=>{try{const result=transaction(db,()=>collaborationCheckins.runDueCheckins(db));if(result.generated.length)console.log(`Workspace check-ins: ${result.generated.length}`);}catch(error){console.error('Workspace check-ins failed:',error.message);}};
  checkinRuns();setInterval(checkinRuns,60*1000).unref();
  // طابور المهام: كل دقيقة، خارج أي معاملة؛ كل مهمة تُسجَّل في معاملتها.
  // المعالجات المسجلة في التشغيل: التذكيرات اليومية (متزامن) وبريد الإشعارات (خارجي، يحجب ما لم يضبط المالك المزود).
  reminders.registerReminderHandlers();delivery.registerDeliveryHandlers();workflowSweep.registerSweepHandlers();
  // التشغيل اليومي لمحرك العمل (workflow.sweep) مهمة مستقلة بجانب التذكيرات: عطل في إحداهما لا يُسقط الأخرى.
  const drain=()=>{try{reminders.scheduleDaily(db);workflowSweep.scheduleSweep(db);const r=jobs.runDue(db,{worker:`server-${process.pid}`});if(r.length)console.log(`Jobs: ${r.length}`);}catch(error){console.error('Jobs failed:',error.message);}};
  drain();setInterval(drain,60*1000).unref();
  // البريد: تخطيط الإشعارات الجديدة ثم الإرسال بحد المعدل. لا يتداخل تشغيلان.
  let mailing=false;
  const mail=async()=>{if(mailing)return;mailing=true;try{delivery.planDeliveries(db);const r=await delivery.drainMail(db,{worker:`mail-${process.pid}`});if(r.length)console.log(`Mail jobs: ${r.length}`);}catch(error){console.error('Mail failed:',error.message);}finally{mailing=false;}};
  mail();setInterval(mail,60*1000).unref();
  // الافتراض أن الخادم لا يُسمع إلا من هذا الجهاز. توسيعه إلى الشبكة قرار صريح يُتخذ بمتغير بيئة،
  // ولا يجوز إلا ببيانات تجريبية: لا HTTPS هنا، فكلمة المرور وملف الجلسة يمران نصًا مكشوفًا على الشبكة.
  // النفق المشفَّر لا يحتاج ربطًا على الشبكة: يعمل على هذا الجهاز ويصل الخادم على عنوان الاسترجاع.
  // فتح الخادم على الشبكة مع النفق يزيد سطح التعرض ولا يضيف شيئًا، والافتراضي يبقى 127.0.0.1.
  const host=bindHost(process.env.LOCAL_BIND_HOST);
  app.listen(port,host,()=>console.log(`3,6T local platform: http://${host}:${port}`));
  for(const signal of ['SIGINT','SIGTERM']) process.on(signal,()=>app.close(()=>{db.close();process.exit(0);}));
}
