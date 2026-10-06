import { attendanceBoard } from './attendance.mjs';
import { attendanceExtras } from './attendance-extras.mjs';
import { expensesBoard } from './expenses.mjs';
import { listContracts } from './hr-contracts.mjs';
import { listPayroll } from './payroll.mjs';
import { extrasBoard } from './payroll-extras.mjs';
import { listVendors } from './vendors.mjs';
import { listApprovals } from './client-approvals.mjs';
import { listInvoices } from './invoices.mjs';
import { listPayables } from './payables.mjs';
import { assetsBoard } from './assets.mjs';
import { offeringsBoard, timeBoard } from './agency.mjs';
import { campaignsBoard, contentBoard, scopeBoard } from './campaigns.mjs';
import { listProcurement } from './procurement.mjs';
import { listFinanceRfqs } from './procurement-rfq.mjs';
import { procurementExtras } from './procurement-extras.mjs';
import { performanceBoard, growthBoard } from './talent.mjs';
import { pendingQualifications } from './career-profile.mjs';
import { cardsBoard } from './service-cards.mjs';
import { complianceBoard } from './compliance.mjs';
import { reportsIndex } from './reports.mjs';
import { statements } from './ledger.mjs';
import { listLeave } from './leave.mjs';
import { listPeople } from './people.mjs';
import { listCommercial } from './commercial.mjs';
import { listProposalReviewQueue } from './technical-proposal-review.mjs';
import { listStudio } from './studio.mjs';
import { listBudgets } from './budgets.mjs';
import { listReceivables } from './receivables.mjs';
import { listFinance } from './finance.mjs';
import { bankBoard } from './bank-reconciliation.mjs';
import { schedulesBoard, retainersBoard } from './billing-recurring.mjs';
import { closeBoard } from './close-checklist.mjs';
import { exceptionsBoard } from './finance-exceptions.mjs';
import { awaitingSecondPerson } from './options.mjs';
import { changesAwaitingApproval } from './employees.mjs';
import { accrualsBoard } from './accruals.mjs';
import { contractAlerts } from './contracts-register.mjs';
import { announcementsBoard } from './engagement.mjs';
import { oneToOnesBoard, feedbackBoard, review360Board } from './feedback.mjs';
import { objectivesBoard, risksBoard, decisionsBoard } from './governance.mjs';
import { expirySources } from './expiry.mjs';
import { influencerCampaignsBoard } from './influencers.mjs';
import { accrualBoard } from './leave-accrual.mjs';
import { lettersBoard, templatesBoard as letterTemplatesBoard } from './letters.mjs';
import { prBoard } from './pr.mjs';
import { equipmentBoard } from './equipment.mjs';
import { privacyBoard, subjectRequestsBoard } from './privacy.mjs';
import { productionsBoard, callSheetsBoard } from './production.mjs';
import { costRatesBoard } from './profitability.mjs';
import { timesheetsBoard } from './timesheets.mjs';
import { resourcingBoard } from './resourcing.mjs';
import { reviewBoard } from './review-rounds.mjs';
import { vatBoard, withholdingBoard } from './tax-returns.mjs';
import { wpsBoard } from './wage-protection.mjs';
import { wageReconciliation } from './wage-reconciliation.mjs';
// المسير الموازي (الترحيل 176): دفعة تنتظر تأكيد شخص ثانٍ، وفروق تنتظر تفسيره، واقتراح انتقال ينتظر معتمدًا ثانيًا.
import { parallelAwaiting } from './payroll-parallel.mjs';
import { lifecycleBoard } from './lifecycle.mjs';
import { myTimelineBoard } from './request-timeline.mjs';
import { knowledgeBoard } from './knowledge.mjs';
import { acknowledgementsBoard } from './policy-acknowledgements.mjs';
import { accessReviewBoard } from './access-reviews.mjs';
import { pipelineBoard } from './pipeline-estimates.mjs';
import { estimatesBoard } from './estimates.mjs';
import { aiGovernanceBoard } from './ai-governance.mjs';
import { compensationBoard } from './compensation.mjs';
import { mediaSpendBoard } from './media-spend.mjs';
import { clientReportsBoard } from './client-reports.mjs';
// الطوابير التي كانت تعرض أفعال اعتماد ولا يعلم بها أحد (الموجة 1 «ما عليّ»).
import { formsBoard } from './forms.mjs';
import { intakeBoard } from './project-intake.mjs';
import { disciplineBoard } from './discipline.mjs';
import { resignationsBoard } from './resignations.mjs';
import { travelBoard } from './travel.mjs';
import { hrCasesBoard } from './hr-cases.mjs';
import { benefitsAdmin } from './benefits-portal.mjs';
import { benefitExtrasBoard } from './secondment-benefits.mjs';
import { rulesBoard as attendanceRulesBoard } from './attendance-rules.mjs';
import { hrPolicyBoard } from './hr-policies.mjs';
import { approvalSettings } from './service-catalog.mjs';
import { pricingBoard } from './pricing.mjs';
import { obligations } from './obligations.mjs';
// الموجة 2 «لا طلب يضيع»: مهلة مقترحة تنتظر تبنّي شخص ثانٍ، وما ينتظر من يدير الهيكل (خطوة متوقفة، عمل عند حساب موقوف، إشعار بلا مستلم).
import { timersBoard } from './workflow-timers.mjs';
import { stuckApprovals } from './step-escalation.mjs';
import { heldWorkBoard } from './request-assignment.mjs';
import { undeliverableBoard } from './notice-recipients.mjs';
// سجل التعريفات (ترحيل 123): مسودة تعريف سُلّمت للنشر تنتظر ناشرًا غير من أعدّها.
import { awaitingPublisher } from './definitions.mjs';
import { participationBoard } from './project-axes.mjs';
// الحزمة 4 (P4-CRM-5): بلاغ عميل ينتظر أول رد أو حلًا أو إقرار حل.
import { supportAwaiting } from './client-support.mjs';
// الحزمة 4 (P4-CRM-7): سجل إقفال ملف عميل أو إعادة فتحه سمّاني طالبه معتمدًا.
import { offboardingAwaiting } from './client-offboarding.mjs';
import { serviceOutputsBoard } from './service-outputs.mjs';

// صندوق «بانتظار قراري»: يقرأ لوحات كل الوحدات بصلاحية المستخدم نفسه، ويجمع كل سجل تعرض عليه اللوحة إجراء قرار.
// لا منطق صلاحيات هنا: ما لا تعرضه اللوحة للمستخدم لا يظهر في الصندوق. الصندوق يدل على الشاشة ولا ينفذ القرار.
const DECISIONS={
  approve:'اعتماد',publish_card:'اعتماد بطاقة',complete_obligation:'تنفيذ وتوثيق',verify_obligation:'تحقق من الدليل',accept:'اعتماد',reject:'قرار',return:'قرار',confirm:'تأكيد',dismiss:'قرار',verify:'تحقق',review:'مراجعة',decide:'قرار',calibrate:'معايرة',release:'إصدار',issue:'إصدار',post:'ترحيل',match:'مطابقة',award:'ترسية',pass:'مراجعة',
  manager_approve:'اعتماد المدير',finance_approve:'اعتماد المالية',record_execution:'توثيق التنفيذ',record_reimbursement:'توثيق التعويض',issue_custody:'صرف العهدة',state_absence:'إفادتك مطلوبة',acknowledge:'إقرارك مطلوب',submit_self:'تقييمك الذاتي',submit_manager:'تقييم موظفك',
  overtime_to_payroll:'تحويل للمسير',record_client_approval:'توثيق موافقة العميل',evaluate:'تقييم',screen:'فرز',justify:'تبرير فرق',approve_change:'اعتماد تغيير وظيفي',approve_adoption:'اعتماد قيمة تحكم المنصة',approve_option:'اعتماد خيار في قائمة',
  // أفعال الوحدات الجديدة التي كانت تسقط بـNOT_DECISIONS أو لا رأس لها (WIRING-SPEC §6.1 و§9.8)
  mark_issued:'إصدار فاتورة الفترة',close_period:'إقفال فترة الاشتراك',complete_task:'مهمة إقفال عليك',complete_item:'بند متابعة عليك',answer_request:'رد مطلوب',submit_360:'تقييمك مطلوب',prepare_letter:'إعداد الخطاب',lock_list:'قفل القائمة',close_check:'إقفال الجرد',record_check:'مراجعة احتفاظ مستحقة',update_incident:'حادثة مفتوحة عليك',record_filing:'توثيق التقديم',record_remittance:'توثيق التوريد',record_upload:'توثيق الرفع',record_difference:'قرار في فرق الأجر',
  answer:'سؤال التجربة',reopen:'إعادة الفتح متاحة',close_with_evidence:'إغلاق بدليل',sign_report:'توقيع تقرير عميل',assess_proposal:'تقييم مقترح زيادة',open_cycle:'فتح دورة التعويضات',link_contract:'ربط نسخة العقد',
  // الموجة 1 «ما عليّ»: أفعال الطوابير التي أُضيفت مصادرها. answer_grievance كان سيقع على رأس «answer» فيُسمّى «سؤال التجربة».
  accept_resignation:'قبول استقالة',set_last_day:'تحديد آخر يوم عمل',open_offboarding:'فتح حزمة المغادرة',answer_grievance:'الرد على تظلم',
  take_case:'حالة تنتظر من يستلمها',decide_case:'قرار في حالة',hr_approve:'اعتماد الموارد البشرية',hr_quote:'تسعير الموارد البشرية',authority_approve:'اعتماد صاحب الصلاحية',
  consent_deduction:'تأكيدك للمبلغ مطلوب',receive_handover:'استلام المشروع',authorise_assignment:'موافقة على تكليف إضافي',submit_defence:'دفاعك المكتوب مطلوب',
  // الإجازة التعويضية (ترحيل 125): إحالة رصيد انقضت مهلته أو انتهت خدمة صاحبه إلى المسير، وقيد رصيد عن ساعات اعتُمدت قبل الدفتر.
  // الاسمان يبدآن بـ«compensatory» و«credit»: الأول بلا رأس في هذا القاموس والثاني يسقطه NOT_DECISIONS، فيُسمَّيان هنا صراحة.
  compensatory_to_payroll:'إحالة رصيد تعويضي إلى المسير',credit_compensatory:'قيد رصيد تعويضي',
  // قرار تاريخ الصرف المبكر (الترحيل 127): بلا اسمه كان يقع على رأس «confirm» فيُقرأ «تأكيد» على صف عنوانه «مسير رواتب»،
  // كأن المسير نفسه ينتظر تأكيدًا. والسحب ليس قرارًا منتظرًا فيسقط بـNOT_DECISIONS كما يسقط أي withdraw.
  confirm_early_pay:'تأكيد صرف مبكر',reject_early_pay:'رفض صرف مبكر',
  // الموجة 2: تبنّي مهلة قرارُ شخص ثانٍ؛ والثلاثة الأخرى قرارات من يدير الهيكل والتصعيد على ما توقف بلا صاحب.
  adopt_timer:'تبنّي مهلة',override_escalation:'تسمية صاحب قرار لخطوة متوقفة',override_assignment:'نقل عمل عند حساب موقوف',resolve_undeliverable:'إشعار بلا مستلم',
  // سجل التعريفات: publish_definition كان سيسقط بـNOT_DECISIONS (رأسه publish)، وهو قرار ينتظر ناشرًا بعينه.
  publish_definition:'نشر تعريف صفحة',accept_participation:'قبول مشاركة إدارة',return_participation:'إعادة طلب المشاركة للتوضيح',
  // التحصيل والتسوية (الترحيل 170): قرارات شخصٍ ثانٍ أو ثالث على مال العميل. الاعتماد والرفض بعبارة واحدة لكل قرار، فلا يُسمّى البند مرتين.
  // «allocate» و«resolve» بلا رأس في هذا القاموس، و«reject_account» كان يقع على «قرار» العامة؛ فتُسمّى هنا صراحة.
  approve_reversal:'قرار على عكس قبض',reject_reversal:'قرار على عكس قبض',approve_cancel:'قرار على إلغاء استحقاق',reject_cancel:'قرار على إلغاء استحقاق',
  resolve_dispute:'حسم نزاع عميل',confirm_account:'مطابقة قبض على حساب عميل',reject_account:'مطابقة قبض على حساب عميل',allocate:'تخصيص مال على حساب عميل',
  approve_account_reversal:'قرار على عكس قبض على الحساب',reject_account_reversal:'قرار على عكس قبض على الحساب',
  // الاستثناءات المالية (الحزمة 3): إقرار مالك الاستثناء. بلا اسمه كان يقع على رأس «acknowledge» فيُسمّى «إقرارك مطلوب» كأنه إقرار سياسة.
  acknowledge_exception:'استثناء مالي عليك',
  // المسير الموازي (الترحيل 176): ثلاثة قرارات شخص ثانٍ. بلا أسمائها كان «confirm_*» يقع على «تأكيد» العامة، و«explain» بلا رأس.
  confirm_legacy_batch:'تأكيد دفعة النظام السابق',explain_parallel_difference:'تفسير فرق في المسير الموازي',confirm_cutover:'تأكيد الانتقال إلى المنصة',
  // الحزمة 4 (الرواتب في الدفتر): مركز تكلفة إدارة ينتظر قرار حامل الاعتماد المالي — قرارٌ واحد بعبارة واحدة للاعتماد والرفض.
  approve_department_centre:'قرار على مركز تكلفة إدارة',reject_department_centre:'قرار على مركز تكلفة إدارة',
  // عكس المسير المعتمد (الترحيل 175): بلا اسمه كان «approve_run_reversal» يقع على رأس «approve» فيُقرأ «اعتماد» كأنه اعتماد مسير.
  approve_run_reversal:'قرار على عكس مسير رواتب',reject_run_reversal:'قرار على عكس مسير رواتب',
  // بلاغ العميل (P4-CRM-5): «respond» و«resolve» بلا رأس في هذا القاموس، و«confirm» كان يقع على «تأكيد» العامة.
  respond_case:'أول رد على بلاغ عميل',resolve_case:'حل بلاغ عميل',confirm_resolution:'إقرار حل بلاغ عميل',
  // إقفال ملف العميل وإعادة فتحه (P4-CRM-7): الاعتماد والرفض بعبارة واحدة، فلا يُسمّى البند مرتين.
  approve_offboarding:'قرار في إقفال ملف عميل أو إعادة فتحه',reject_offboarding:'قرار في إقفال ملف عميل أو إعادة فتحه',
  acknowledge_exception:'استثناء مالي عليك',accept_output:'قبول مخرج الخدمة',reject_output:'رفض مخرج الخدمة',
  finance_review_rfq:'مراجعة طلب عرض سعر',review_proposal_checklist:'مراجعة عرض فني'
};
// إجراءات متاحة دائمًا لا تعني أن شيئًا ينتظر: تقييم مورد، استثناء، إقفال هدف.
const ALWAYS_AVAILABLE=new Set(['evaluate','grant_exception','trust_contact','verify_document','achieve_goal']);
const KINDS={employee_change_items:'تغيير وظيفي مؤرخ',obligations:'التزام دوري',cards:'بطاقة خدمة',qualifications:'مؤهل',holidays:'عطلة',missions:'مهمة عمل',overtime:'عمل إضافي',corrections:'تصحيح حضور',absences:'غياب مقترح',claims:'مطالبة مصروف',custodies:'عهدة',policies:'سياسة',contracts:'عقد',adjustments:'حركة راتب',advances:'سلفة',banks:'حساب راتب',payments:'دفعة مسير',settlements:'تسوية نهاية خدمة',runs:'مسير رواتب',vendors:'مورد',records:'موافقة عميل',training:'تدريب',reviews:'تقييم أداء',cycles:'دورة تقييم',events:'خارج النطاق',campaigns:'حملة',items:'محتوى',snapshots:'لقطة تقرير',purchases:'طلب شراء',emergencies:'شراء طارئ',disclosures:'إفصاح تعارض',entries:'ساعات عمل',offerings:'باقة تجارية',assets:'أصل ثابت',orders:'أمر دفع',mappings:'ربط محاسبي',order_changes:'تعديل أمر شراء',documents:'مستند ضريبي',journals:'قيد',budgets:'مخصص',claims_ar:'استحقاق',
  // مفاتيح الوحدات الجديدة: أسماء خاصة لا عامة، لأن KINDS يُطابَق في كل لوحة تُمشى (WIRING-SPEC §6.2)
  bank_items:'مطابقة بنكية',drafts:'مسودة فاتورة',installments:'قسط إطفاء',follow_ups:'بند متابعة',feedback_requests:'طلب تغذية راجعة',reviews_360:'تقييم 360',initiatives:'مبادرة',risks:'خطر',governance_items:'محضر أو التزام',letters:'خطاب موظف',letter_templates:'قالب خطاب',privacy_items:'حماية البيانات',subject_requests:'طلب صاحب بيانات',worksheets:'ورقة عمل ضريبية',withholding_items:'استقطاع',wps_formats:'مواصفة ملف أجور',wps_exports:'ملف أجور',wage_gaps:'فرق أجر',bundles:'حزمة موظف',steps:'خطوة رحلة',clearance:'بند إخلاء طرف',
  timeline_rows:'طلبي',closable:'طلب جاهز للإغلاق',knowledge_items:'مصدر معرفة',policy_acks:'إقرار سياسة',access_items:'مراجعة صلاحية',stage_revisions:'مرحلة بيع',estimate_items:'تقدير أو بطاقة أسعار',assessments:'تقييم مخاطر مساعد',
  // مفاتيح الموجة 1: خاصة بمصادرها حتى لا تطابق مفتاحًا عامًا في لوحة أخرى (receipts وpermissions وchanges موجودة في لوحات غيرها).
  form_instances:'نموذج إلكتروني',intake_handovers:'محضر تسليم مشروع',intake_receipts:'محضر استلام مشروع',intake_changes:'طلب تغيير على مشروع',
  discipline_cases:'قضية تأديبية',resignation_items:'استقالة',travel_items:'انتداب',hr_case_items:'حالة موارد بشرية',benefit_request_items:'طلب مزايا',benefit_catalog_items:'ميزة في الكتالوج',
  benefit_extra_items:'مطالبة مزايا إضافية',attendance_permissions:'استئذان',attendance_notices:'توضيح حضور',attendance_exemptions:'إعفاء من الحضور',overtime_assignments:'تكليف عمل إضافي',
  attendance_sites:'موقع حضور',punch_reviews:'بصمة خارج النطاق',hr_policy_rows:'سياسة موارد بشرية',approval_thresholds:'حد اعتماد مالي',
  pricing_items:'تسعير مشروع',margin_exception_items:'استثناء هامش',
  compensatory_payouts:'رصيد تعويضي مستحق الصرف',compensatory_uncredited:'ساعات تعويضية لم تُقيَّد',
  workflow_timer_rows:'مهلة محرك العمل',stuck_step_rows:'خطوة اعتماد متوقفة',held_work_rows:'عمل عند حساب موقوف',undeliverable_rows:'إشعار بلا مستلم',
  definition_drafts:'تعريف صفحة',department_participation_items:'طلب مشاركة إدارة',
  // القبض على حساب العميل (الترحيل 170) يصل من لوحة المستحقات نفسها بمفتاح خاص لا يطابق مفتاحًا عامًا في لوحة أخرى.
  account_receipts:'قبض على حساب عميل',
  // الاستثناءات المالية (الحزمة 3): مفتاح خاص بمصدره لا يطابق مفتاحًا عامًا في لوحة أخرى.
  finance_exception_items:'استثناء مالي',
  // المسير الموازي: مفاتيح خاصة بمصدرها.
  parallel_batch_items:'دفعة النظام السابق',parallel_difference_items:'فروق المسير الموازي',parallel_cutover_items:'قرار الانتقال إلى المنصة',
  // مركز تكلفة الإدارة (الترحيل 174): مفتاح خاص بمصدره.
  department_centre_items:'مركز تكلفة إدارة',
  // بلاغ العميل (P4-CRM-5): مفتاح خاص بمصدره.
  client_support_items:'بلاغ عميل',
  // إقفال ملف العميل وإعادة فتحه (P4-CRM-7).
  client_offboarding_items:'إقفال ملف عميل أو إعادة فتحه',
  finance_exception_items:'استثناء مالي',service_output_items:'مخرج خدمة',procurement_rfq_items:'طلب عرض سعر',proposal_checklist_items:'قائمة تدقيق عرض فني'};
// إجراءات يملكها صاحب السجل نفسه أو هي عمل جارٍ لا قرار منتظر.
const NOT_DECISIONS=/^(edit|view_|draft_|submit(?!_self|_manager)|resubmit|cancel|add_|create_|save_|record_(?!execution|reimbursement|client)|propose|note_|drop_|start|pause|resume|complete|close|open_|to_|end_|amend|merge|suspend|requalify|retire|revise|link_|check_|schedule|publish|client_changes|discard|stop_|credit|recalculate|withdraw|exclude|skip|correct|remove)/;
const labelFor=action=>{if(ALWAYS_AVAILABLE.has(action))return null;if(DECISIONS[action])return DECISIONS[action];if(NOT_DECISIONS.test(action))return null;const head=action.split('_')[0];return DECISIONS[head]??null;};
const SOURCES=[
  ['requests','الطلبات',(db,u)=>({service_output_items:serviceOutputsBoard(db,u).awaiting_me}),
    {link:item=>`#request/${encodeURIComponent(item.id)}`}],
  ['project-participation','مشاركة الإدارات',(db,u)=>({department_participation_items:participationBoard(db,u).incoming}),{link:item=>`#project-participation?focus=${encodeURIComponent(item.id)}`}],
  // قواعد الحضور (099) تُقدَّم مع لوحة الحضور في ‎/api/attendance‎ نفسها، وكانت خارج الصندوق: مدير عليه استئذان أو توضيح
  // أو إعفاء أو تكليف إضافي أو موقع حضور لم يكن يُقال له شيء. المفاتيح تُعاد تسميتها حتى لا تطابق مفتاحًا عامًا في لوحة أخرى.
  ['attendance','الحضور والانصراف',(db,u)=>{const board={...attendanceBoard(db,u),extras:attendanceExtras(db,u)};
    // رفض قواعد الحضور لحساب ما (403) لا يُسقط لوحة الحضور نفسها من الصندوق.
    let rules=null;try{rules=attendanceRulesBoard(db,u);}catch(error){if(!error.status)throw error;}
    return rules?{...board,attendance_permissions:rules.permissions,attendance_notices:rules.notices,attendance_exemptions:rules.exemptions,
      overtime_assignments:rules.overtime_assignments,attendance_sites:rules.location?.all_sites??[],punch_reviews:rules.location?.review??[]}:board;}],
  ['expenses','المصروفات والعهد',expensesBoard],['contracts','العقود والسياسات',listContracts],['payroll','مسير الرواتب',listPayroll],['payroll-extras','حركات الرواتب والتسويات',extrasBoard],
  ['vendors','الموردون والتأهيل',listVendors],['approvals','موافقات العملاء',listApprovals],['invoices','الفواتير الضريبية',listInvoices],['payables','مدفوعات الموردين',listPayables],['assets','الأصول الثابتة',assetsBoard],
  ['offerings','الباقات التجارية',offeringsBoard],['time','ساعات الفريق',timeBoard],['campaigns','الحملات',campaignsBoard],['content','تقويم المحتوى',contentBoard],['scope','حارس النطاق',scopeBoard],
  ['procurement','المشتريات',(db,u)=>({purchases:listProcurement(db,u),procurement_rfq_items:listFinanceRfqs(db,u)})],['procurement-extras','الطارئ وتعديل الأوامر والتعارض',procurementExtras],
  ['performance','تقييم الأداء',performanceBoard],['growth','التدريب والتطوير',(db,u)=>({...growthBoard(db,u),qualifications:pendingQualifications(db,u).map(q=>({...q,actions:['verify_qualification']}))})],['reports','لقطات التقارير',reportsIndex],
  // مركز تكلفة الإدارة (الحزمة 4، الترحيل 174): ربطٌ سجّله زميل وينتظر قرار حامل الاعتماد المالي غيره، من حمولة الشاشة نفسها.
  ['statements','الربط المحاسبي',(db,u)=>{const s=statements(db,u);return {mappings:s.permissions?.includes('approve')?s.pending_mappings.filter(m=>m.recorded_by!==u.id).map(m=>({id:m.id,title:`ربط ${m.purpose} ← ${m.code} ${m.account_name}`,created_at:m.created_at,actions:['approve_mapping']})):[],
    department_centre_items:(s.department_centres?.pending??[]).filter(p=>p.actions.length).map(p=>({id:p.id,title:`مركز تكلفة إدارة «${p.department_name}» ← ${p.code}`,created_at:p.created_at,actions:p.actions}))};}],
  ['compliance','تقويم الالتزامات',(db,u)=>({obligations:complianceBoard(db,u).inbox})],
  ['service-cards','بطاقات الخدمات',(db,u)=>({cards:cardsBoard(db,u).awaiting_me})],
  ['leave','الإجازات',listLeave],['people','التوظيف والتهيئة',listPeople],['commercial','المبيعات والعروض',(db,u)=>({cases:listCommercial(db,u),proposal_checklist_items:listProposalReviewQueue(db,u)})],['studio','الاستوديو',listStudio],['budgets','مخصصات المشاريع',listBudgets],['receivables','مستحقات العملاء',listReceivables],['finance','الدفتر المالي',listFinance],
  // الوحدات الجديدة (WIRING-SPEC §6.5 و§9.8). المفتاح = مفتاح الشاشة، فرابط البند يفتحها. بعضها يمرّر جزءًا من اللوحة عمدًا (§6.3).
  ['bank-reconciliation','المطابقة البنكية',(db,u)=>({bank_items:bankBoard(db,u).inbox})],
  ['billing-schedules','الفوترة الدورية',schedulesBoard],['retainers','اتفاقات الاشتراك',retainersBoard],
  ['close-checklist','الإقفال الشهري',(db,u)=>({periods:closeBoard(db,u).inbox})],
  // الاستثناءات المالية: غير المُقرّ منها لمالكه، إلا ما قراره في الصندوق أصلًا بمصدر آخر (inbox:false في app/finance-exceptions.mjs)، فلا يُعدّ قرارٌ مرتين.
  // قرار قيمة أو توسيع قائمة ينتظر شخصًا ثانيًا يحمل تصريحها (app/options.mjs). المعرّف هو ما تحمله أزرار الشاشة data-id فيقف الرابط عنده.
  ['options','الخيارات والقيم المعتمدة',(db,u)=>awaitingSecondPerson(db,u)],
  // التغيير الوظيفي المؤرخ (الترحيل 172) لا يسري حتى يعتمده حامل «السجل الوظيفي» غير مسجّله وغير صاحبه؛ الرابط يقف عند الموظف.
  ['employees','التغييرات الوظيفية المؤرخة',(db,u)=>({employee_change_items:changesAwaitingApproval(db,u)}),{link:item=>`#employees?focus=${encodeURIComponent(item.user_id)}`}],
  ['finance-exceptions','الاستثناءات المالية',(db,u)=>({finance_exception_items:exceptionsBoard(db,u).exceptions.filter(x=>x.inbox&&x.actions.includes('acknowledge_exception'))}),{link:i=>`#finance-exceptions?focus=${encodeURIComponent(i.id)}`}],
  ['accruals','الإطفاء والاستحقاقات',(db,u)=>({installments:accrualsBoard(db,u).inbox})],
  ['contracts-register','سجل العقود والتجديدات',contractAlerts],
  // بلاغ العميل (P4-CRM-5): العنوان رقم البلاغ ونوعه ورمز العميل، لا نص العميل (PLT-10).
  ['client-support','دعم العملاء',(db,u)=>({client_support_items:supportAwaiting(db,u)}),{link:i=>`#client-support?focus=${encodeURIComponent(i.id)}`}],
  // الرابط يقف عند السجل نفسه في «العملاء»: أزراره تحمل معرّفه، سواء في بطاقة الملف أو في «بانتظار قراري» لمعتمد خارج الفريق.
  ['clients','ملفات العملاء',(db,u)=>({client_offboarding_items:offboardingAwaiting(db,u).map(r=>({id:r.id,title:r.title,created_at:r.created_at,actions:r.actions}))}),{link:i=>`#clients?focus=${encodeURIComponent(i.id)}`}],
  ['announcements','الإعلانات الداخلية',(db,u)=>({announcements:announcementsBoard(db,u).awaiting_me})],
  ['one-to-ones','اللقاءات الفردية',(db,u)=>({follow_ups:oneToOnesBoard(db,u).my_open_items.map(i=>({...i,actions:['complete_item']}))})],
  ['feedback','التغذية الراجعة',(db,u)=>({feedback_requests:feedbackBoard(db,u).requests_to_me.filter(r=>r.status==='open')})],
  ['review-360','تقييم 360',(db,u)=>({reviews_360:review360Board(db,u).cycles.flatMap(c=>[...c.my_tasks,...c.panels.flatMap(p=>p.nominations.filter(n=>n.actions.length))])})],
  ['objectives','الأهداف والمبادرات',(db,u)=>({initiatives:objectivesBoard(db,u).inbox})],
  ['risks','سجل المخاطر',(db,u)=>({risks:risksBoard(db,u).inbox})],
  ['decisions','القرارات والالتزامات',(db,u)=>({governance_items:decisionsBoard(db,u).inbox})],
  ['expiry','انتهاء الوثائق',expirySources],
  ['influencer-campaigns','ارتباطات المؤثرين',influencerCampaignsBoard],
  ['leave-accrual','استحقاق الإجازات',accrualBoard],
  ['letters','خطابات الموظفين',(db,u)=>({letters:lettersBoard(db,u).awaiting_me})],
  ['letter-templates','قوالب الخطابات',(db,u)=>({letter_templates:letterTemplatesBoard(db,u).awaiting_me})],
  ['pr','العلاقات العامة',prBoard],['equipment','المعدات والعهد',equipmentBoard],
  ['privacy','حماية البيانات',(db,u)=>({privacy_items:privacyBoard(db,u).inbox})],
  ['subject-requests','طلبات أصحاب البيانات',(db,u)=>({subject_requests:subjectRequestsBoard(db,u).inbox})],
  ['productions','الإنتاج والتصوير',productionsBoard],['call-sheets','أوراق الاستدعاء',callSheetsBoard],
  ['cost-rates','معدلات التكلفة',(db,u)=>({rates:costRatesBoard(db,u).awaiting_me})],
  ['timesheets','كشوف الوقت',timesheetsBoard],
  ['resourcing','تخطيط الموارد',(db,u)=>({bookings:resourcingBoard(db,u).bookings.filter(b=>b.status==='tentative'&&b.user_id!==u.id).map(b=>({...b,actions:['confirm_booking']}))})],
  ['review-rounds','جولات المراجعة',reviewBoard],
  // الورقتان الضريبيتان مصدران منفصلان: رفض إحداهما (403) لا يُسقط الأخرى، والرابط يفتح شاشة كل منهما.
  ['vat-worksheet','أوراق القيمة المضافة والزكاة',(db,u)=>({worksheets:vatBoard(db,u).inbox})],
  ['withholding','ضريبة الاستقطاع',(db,u)=>({withholding_items:withholdingBoard(db,u).inbox})],
  ['wps','ملف حماية الأجور',(db,u)=>{const board=wpsBoard(db,u);return {wps_formats:board.formats.filter(f=>f.actions.includes('confirm_format')),wps_exports:board.exports.filter(x=>x.actions.includes('record_upload'))};}],
  ['wage-reconciliation','مطابقة الأجور',(db,u)=>({wage_gaps:wageReconciliation(db,u).rows.filter(r=>r.state==='different'&&r.notes.length===0&&r.actions.includes('record_difference'))})],
  ['payroll-parallel','المسير الموازي',parallelAwaiting],
  ['lifecycle','حزم التعيين والمغادرة',lifecycleBoard],
  // سؤال التجربة وإعادة الفتح اختياريان (obligations.mjs يضعهما في «أجيب» بلا تأخر ولا عدّ). «جاهز للإغلاق» لم يعد هنا:
  // هو طلب قيد التنفيذ مسند إلى الشخص، ومكانه سلة «أنفّذ» التي تقرؤه من الطلبات مباشرة، فلا يُعدّ مرتين.
  ['my-request-timeline','طلباتي',(db,u)=>({timeline_rows:myTimelineBoard(db,u).rows.filter(r=>r.actions.some(a=>['answer','reopen'].includes(a)))}),{link:i=>`#request/${i.id}`}],
  ['knowledge','قاعدة المعرفة',(db,u)=>({knowledge_items:knowledgeBoard(db,u).awaiting_me})],
  ['policy-acknowledgements','إقرار السياسات',(db,u)=>({policy_acks:acknowledgementsBoard(db,u).awaiting_me})],
  ['access-reviews','مراجعة الصلاحيات',(db,u)=>({access_items:accessReviewBoard(db,u).awaiting_me})],
  ['pipeline','الفرص البيعية',(db,u)=>({stage_revisions:pipelineBoard(db,u).awaiting_me})],
  ['estimates','التقديرات',(db,u)=>({estimate_items:estimatesBoard(db,u).awaiting_me})],
  ['ai-governance','حوكمة المساعدين',(db,u)=>({assessments:aiGovernanceBoard(db,u).awaiting_me})],
  ['compensation','مراجعة التعويضات',compensationBoard],
  ['media-spend','الصرف الإعلامي',mediaSpendBoard],['client-reports','تقارير العملاء',clientReportsBoard],
  // ── الموجة 1 «ما عليّ»: طوابير اعتماد حقيقية لم يكن لها مصدر. كل مصدر يمرّر الصفوف التي فيها فعل قرار فقط، بعنوان لا يكشف
  //    ما تحجبه شاشته (القضية برقمها، والحالة بفئتها). اللوحة تُقرأ بهوية المستخدم فتبقى قواعد الرؤية قواعد وحدتها.
  ['forms','النماذج الإلكترونية',(db,u)=>({form_instances:formsBoard(db,u).awaiting_me}),{link:i=>`#forms/${i.id}`}],
  ['project-handover','محضر تسليم المشروع',(db,u,scope)=>({intake_handovers:intakeOnce(db,u,scope).handovers.filter(h=>h.actions.length).map(h=>({id:h.id,title:h.project_name,client_name:h.client_name,created_at:h.created_at,actions:h.actions}))}),{scoped:true}],
  ['project-receipt','استلام المشروع وبوابته',(db,u,scope)=>({intake_receipts:intakeOnce(db,u,scope).receipts.filter(r=>r.actions.includes('approve_receipt')).map(r=>({id:r.id,title:r.gate?.project_name??'',created_at:r.created_at,actions:['approve_receipt']}))}),{scoped:true}],
  // زر طلب التغيير في شاشته يحمل «معرّف المحضر:معرّف الطلب»، فالمعرّف هنا بالصيغة نفسها ليقف الرابط عنده.
  // توثيق موافقة العميل يُعرض في اللوحة لكل من يراها؛ في الصندوق يخص مستلم المشروع وحده لأنه صاحب الطلب أمام العميل.
  ['change-requests','طلبات التغيير على المشاريع',(db,u,scope)=>({intake_changes:intakeOnce(db,u,scope).receipts.flatMap(r=>r.changes.map(c=>({id:`${r.id}:${c.id}`,title:`طلب تغيير ${c.number} — ${r.gate?.project_name??''}`,created_at:c.created_at,
    actions:c.actions.filter(a=>a==='decide_finance'||(a==='record_client_approval'&&r.received_by===u.id))})))}),{scoped:true}],
  // جدول الجزاءات يصل من مصدر السياسات الموحد أدناه؛ هنا القضايا وحدها، برقمها واسم صاحبها دون نص الاتهام.
  ['discipline','المخالفات والجزاءات',(db,u)=>({discipline_cases:disciplineBoard(db,u).cases.map(c=>({id:c.id,title:`القضية ${c.reference}`,employee_name:c.employee_name,created_at:c.discovered_on,
    due_date:(c.deadlines??[]).map(d=>d.due_on).sort()[0]??null,actions:c.actions}))})],
  ['resignations','الاستقالات',(db,u)=>({resignation_items:resignationsBoard(db,u).awaiting_me})],
  ['travel','الانتداب',(db,u)=>({travel_items:travelBoard(db,u).awaiting_me})],
  // الحالة السرية تدخل الصندوق بفئتها وتاريخها فقط، كما تظهر في قائمة الاستلام: لا موضوع ولا صاحب ولا مشكو منه.
  ['hr-cases','حالات الموارد البشرية',(db,u)=>{const b=hrCasesBoard(db,u);return {hr_case_items:[...b.intake,...b.handling.filter(c=>c.status!=='closed')].map(c=>({id:c.id,title:c.category_name,created_at:c.filed_on,due_date:c.target_due_on,actions:c.actions.filter(a=>['take_case','decide_case'].includes(a))}))};}],
  ['benefits-admin','إدارة المزايا',(db,u)=>{const b=benefitsAdmin(db,u);return {benefit_request_items:[...b.queue.hr,...b.queue.finance].map(r=>({id:r.id,title:`${r.option_name} — ${r.reference}`,employee_name:r.employee_name,created_at:r.created_at,actions:r.actions})),
    benefit_catalog_items:b.catalog.map(c=>c.draft).filter(Boolean).map(d=>({id:d.id,title:`${d.name} — مراجعة ${d.revision}`,actions:d.actions}))};}],
  ['benefit-extras','مزايا إضافية',(db,u)=>{const b=benefitExtrasBoard(db,u);return {benefit_extra_items:[...b.queue,...b.requests.filter(r=>r.actions.includes('consent_deduction'))].map(r=>({id:r.id,title:`${r.kind_name} — ${r.reference}`,employee_name:r.employee_name,created_at:r.created_at,actions:r.actions}))};}],
  // سياسات الموارد البشرية الموحدة: أنواع الإجازات وجدول الجزاءات وقواعد اللائحة. ما له مصدر أقدم (سياسات العقود، واستحقاق
  // الإجازات، وكتالوج المزايا) يُستثنى هنا حتى لا يُعدّ القرار الواحد مرتين.
  ['hr-policies','سياسات الموارد البشرية',(db,u)=>({hr_policy_rows:hrPolicyBoard(db,u).awaiting_me.filter(r=>!['hr_policy','leave_accrual','benefit'].includes(r.store)).map(r=>({id:r.id,title:`${r.kind_name}: ${r.title}`,created_at:r.prepared_at,actions:r.actions}))})],
  // تسعير المشاريع: لوحته تبني awaiting_me (مقعدي في اعتمادات الورقة الأربعة، وسياسة، وقرار جهة الإصدار) ولم يكن يقرؤها أحد.
  // اختبار التغطية هو من كشفها. استثناء الهامش له شاشته، فله مصدره حتى يقف رابطه عند سجله فيها.
  ['pricing','تسعير المشاريع',(db,u,scope)=>({pricing_items:pricingOnce(db,u,scope).awaiting_me.filter(i=>i.kind!=='exception').map(({kind,...i})=>i)}),{scoped:true}],
  ['margin-exceptions','استثناءات الهامش',(db,u,scope)=>({margin_exception_items:pricingOnce(db,u,scope).awaiting_me.filter(i=>i.kind==='exception').map(({kind,...i})=>i)}),{scoped:true}],
  // مسودات تعريف الصفحات المسلَّمة للنشر: تخفيف ضابط لا ينشره من أعدّه، ومُعدٌّ بلا تصريح نشر يسلّم لمن يحمله. المعرّف مفتاح الكيان،
  // وشاشة «تعريفات الصفحات» تحمله data-id فيقف الرابط عنده.
  ['definitions','تعريفات الصفحات',(db,u)=>({definition_drafts:awaitingPublisher(db,u)})],
  // حدود الاعتماد المالية المقترحة تنتظر قرار غير مقترحها. اعتماد مهل الخدمات (decide_target) ليس هنا عمدًا: انظر INBOX_COVERAGE.
  ['approval-settings','إعداد مسارات الاعتماد',(db,u)=>({approval_thresholds:approvalSettings(db,u).thresholds.filter(t=>t.actions.length).map(t=>({id:t.id,title:`حد الاعتماد ${t.setting_key}`,amount_minor:t.amount_minor,created_at:t.proposed_at,actions:t.actions})),
    // الموجة 2: كل طابور جديد يصل «أقرّر» من هنا. العناوين بيانات وصفية (رمز الخدمة والإدارة)، لا عنوان طلب ولا اسم صاحبه.
    workflow_timer_rows:timersBoard(db,u).timers.filter(t=>t.actions.includes('adopt_timer')).map(t=>({id:t.proposed.id,title:`مهلة «${t.name}»: ${t.proposed.value} ${t.proposed.unit_name}`,created_at:t.proposed.proposed_at,actions:['adopt_timer']})),
    stuck_step_rows:stuckApprovals(db,u).rows.filter(r=>r.actions.length).map(r=>({id:r.step_id,title:`${r.service_code} — الخطوة ${r.position} عند ${r.decider_name}`,created_at:r.arrived_at,actions:r.actions})),
    held_work_rows:heldWorkBoard(db,u).rows.map(r=>({id:r.id,title:`${r.service_code} — عند ${r.assignee_name}`,created_at:r.held_since,actions:r.actions})),
    undeliverable_rows:undeliverableBoard(db,u).open.map(n=>({id:n.id,title:`${n.kind}${n.department_name?` — ${n.department_name}`:''}`,created_at:n.created_at,actions:n.actions}))})]
];
// محاضر المشروع الثلاثة تقرأ لوحة واحدة؛ تُقرأ مرة في الجولة الواحدة لا ثلاثًا. النطاق يُنشأ لكل جولة مشي فلا يعيش بعدها.
const pricingOnce=(db,u,scope)=>{if(!scope)return pricingBoard(db,u);if(!scope.has('pricing'))scope.set('pricing',pricingBoard(db,u));return scope.get('pricing');};
const intakeOnce=(db,u,scope)=>{if(!scope)return intakeBoard(db,u);if(!scope.has('intake'))scope.set('intake',intakeBoard(db,u));return scope.get('intake');};
// ── تغطية الصندوق ─────────────────────────────────────────────────────────────
// كل وحدة في app/ فيها فعل من نوع الاعتماد (approve_* / accept_* / decide_* …) إما أن يستوردها هذا الملف مصدرًا، أو أن
// تُسجَّل هنا بسبب مكتوب. tests/obligations.test.mjs يمسح الوحدات ويفشل بصوت عالٍ عند أول طابور جديد بلا مصدر ولا سبب.
//   inbox:false  → لا مصدر عمدًا، والسبب يقول لماذا.      via:'<مفتاح مصدر>' → قراراتها تصل من مصدر آخر يقرأ جداولها.
//   partial:true → الوحدة مصدر فعلًا، لكن فعلًا من أفعالها تُرك خارج الصندوق عمدًا، والسبب يقول أيها ولماذا.
export const INBOX_COVERAGE={
  'master-data.mjs':{inbox:false,reason:'مراجعة تغيّر مصدر البيانات المرجعية ليست طابورًا ينتظر أحدًا اليوم: الدليل فارغ بالكامل (صفر بنك وصفر بعثة) لأن مصدر السلطة لم يُوصَل بعد، فلا تغيّر يُراجَع أصلًا. وحين تُورَّد البيانات يلزم مصدر في الماشي قبل أوّل تغيّر، وإلا صار طابورًا صامتًا — وهذا ما يحرسه هذا الاختبار.'},
  'attendance-location.mjs':{via:'attendance',reason:'مواقع الحضور ومراجعات البصمة تصل عبر قواعد الحضور (rulesBoard.location) داخل مصدر «الحضور والانصراف».'},
  'overtime-rules.mjs':{via:'attendance',reason:'تكليفات العمل الإضافي تصل عبر قواعد الحضور (overtime_assignments) داخل مصدر «الحضور والانصراف».'},
  'leave-types.mjs':{via:'hr-policies',reason:'مسودة سياسة أنواع الإجازات تصل عبر مصدر «سياسات الموارد البشرية» الموحد الذي يقرأ جدولها بقاعدة القرار نفسها.'},
  'payroll-rules.mjs':{via:'hr-policies',reason:'قواعد اللائحة (regulation_policies) تصل عبر مصدر «سياسات الموارد البشرية» الموحد.'},
  'service-catalog.mjs':{via:'approval-settings',partial:true,reason:'حدود الاعتماد المقترحة تصل عبر مصدر «إعداد مسارات الاعتماد». اعتماد مهل الخدمات (decide_target) متاح دائمًا للـ142 خدمة كلها وليس طابورًا ينتظر، فإدخاله يغرق الصندوق؛ مكانه شاشة جاهزية التشغيل في الموجة 3.'},
  'workflow.mjs':{via:'requests',reason:'محرك طلبات الدليل: خطواته المعلقة تصل «أقرّر» من obligations.mjs مباشرة (مجموعة «الطلبات») بقاعدة isApprover نفسها، لا من الماشي.'},
  'policy-library.mjs':{inbox:false,reason:'اعتماد عناوين المواد المقترحة عمل تنسيق دائم لأمين المكتبة على مئات المواد المستخرجة، لا قرار ينتظر على سجل أحد؛ عدّها ظاهر في لوحة المكتبة.'},
  'project-axes.mjs':{via:'project-participation',partial:true,reason:'قرارات مشاركة الإدارات (accept_participation) تصل من مصدر «مشاركة الإدارات». وخارج الصندوق عمدًا في الحزمة 2: «accept_margin» (قبول نتيجة الهامش قبل الإقفال المالي، الترحيل 163) زرٌّ في لوحة الإقفال بشاشة العملاء والعروض لحامل تصريح الربحية على المشاريع المقفلة فنيًا؛ واعتماد طلب إعفاء شرط البدء أو ردّه (الترحيل 160) يظهر لحامل تصريحه في كتلة «جاهزية البدء» بالشاشة نفسها. وبقية الكلمات اسم تفويض مالي يُفحص عند الإقفال المالي لا فعل لوحة.'},
  'completion-certificates.mjs':{inbox:false,reason:'«accept_certificate» يسجّل قبولًا ورد من العميل خارج المنصة (بريد أو مستند موقّع أو محضر أو رسالة أو مكالمة) بدليله وحدّه، لا قرارًا داخليًا ينتظر أحدًا: زره لحامل «توثيق موافقات العملاء الخارجية» في كتلة شهادة الإنجاز بشاشة العملاء والعروض. ومتابعة شهادةٍ صدرت ولم يرد قبولها بندًا في «ما عليّ» عملٌ لاحق مسمّى.'},
  'finance-grants.mjs':{inbox:false,reason:'«approve» فيها اسم نوع التفويض المالي الممنوح، لا فعل اعتماد على سجل ينتظر.'},
  'epmo-report.mjs':{via:'risks',reason:'الكلمة فيها قيمة حالة داخل استعلام عدّ (مخاطر ردّها «قبول مقترح») لا فعل تعرضه لوحة التقرير. القرار نفسه — قبول الخطر ممن هو أعلى — يصل «أقرّر» من مصدر «سجل المخاطر»، واعتماد لقطة التقرير E01 يصل من مصدر «مركز التقارير».'},
  'reports-governance.mjs':{inbox:false,reason:'تقارير قراءة تذكر حالات المخاطر المقبولة؛ لا تعرض فعلًا ولا تقبل قرارًا.'},
  'overview.mjs':{inbox:false,reason:'ملخص إداري يعدّ ما تعرضه لوحات أخرى لها مصادرها هنا (توظيف، مشتريات، استوديو)؛ لا طابور خاص به.'},
  'module-notices.mjs':{inbox:false,reason:'نصوص إشعارات تسمّي الأفعال؛ ليست لوحة ولا تعرض فعلًا.'},
  'server.mjs':{inbox:false,reason:'موجّه المسارات يذكر أسماء الأفعال في تعابيره النمطية؛ اللوحات التي وراءها لها مصادرها.'},
  // الخيارات المُدارة (الترحيل 134): «approve» فيها اعتماد شخص ثانٍ على **تغيير إعداد** — خيار جديد في قائمة
  // تفتح بوابة، أو قيمة باعتماد مؤرَّخ — لا قرار على سجلّ عملٍ ينتظر صاحبه. ولا شاشة لها بعد: مسارات
  // /api/options لم تُوصل في app/server.mjs، فلا موضع يذهب إليه من يُدعى للاعتماد. تصير مصدرًا في الصندوق
  // يوم تصل تلك المسارات، وهذا السطر هو ما يجب أن يُحذف حينها.
  // استثناءات المشتريات (الترحيل 169): قرار الفاتورة الموقوفة وقرار الإلغاء يُعرضان فعلًا على بطاقة الطلب (مصدر «المشتريات») لمن في نطاقه،
  // وعلى لوحة «الطارئ وتعديل الأوامر» لحامل التفويض المالي خارجه. الوحدتان تنفّذان القرار وتحسبان أهليته ولا لوحة لهما.
  'procurement-exceptions.mjs':{via:'procurement',reason:'تنفّذ قرارات الفاتورة الموقوفة والإلغاء؛ تصل «أقرّر» من بطاقة الطلب في مصدر «المشتريات» ومن لوحة «الطارئ وتعديل الأوامر» لحامل التفويض المالي خارج النطاق.'},
  // محاسبة الرواتب (الحزمة 4، P4-HR-3): الوحدة تحسب أفعال القرار على مركز تكلفة الإدارة، وتعرضها «القوائم المالية والترحيل» في حمولتها.
  'payroll-ledger.mjs':{via:'statements',reason:'قرار مركز تكلفة الإدارة (approve_department_centre) يصل «أقرّر» من مصدر «الربط المحاسبي» الذي يقرأ department_centres من حمولة القوائم المالية بقاعدة القرار نفسها.'},
  'procurement-guards.mjs':{via:'procurement',reason:'تحسب أهلية أفعال الاستثناءات (decide_invoice وdecide_void) وتكتبها في حالة الطلب التي يمشيها مصدر «المشتريات»؛ ليست لوحة.'},
};
// شاشات سُمّيت في خطة الموجة 1 طوابير ناقصة وليس في لوحتها فعل اعتماد: تُسجَّل هنا بسببها حتى لا يُظن أنها نُسيت.
export const SCREENS_WITHOUT_QUEUE={
  'project-kickoff':'محضر الانطلاق يُسجَّل ولا يُعتمد: لوحته لا تعرض إلا record_kickoff لمستلم المشروع، ولا قرار فيه لأحد. نموذجه الإلكتروني المربوط، إن احتاج اعتمادًا، يصل عبر مصدر «النماذج الإلكترونية».'
};
const TITLE_KEYS=['title','name','output_title','legal_name','position_title','number','code','report_key'],DATE_KEYS=['created_at','submitted_at','updated_at','requested_at'];
// موعد السجل نفسه إن حمل واحدًا (التزام، مراجعة خطر، حالة لها زمن مستهدف): يُقاس به التأخر بدل عمر الانتظار.
const DUE_KEYS=['due_date','due_on','target_due_on'],ISO_DAY=/^\d{4}-\d{2}-\d{2}/;
const text=value=>typeof value==='string'||typeof value==='number'?String(value):'';
function describe(node,parents,kind){
  const pick=(obj,keys)=>{for(const k of keys){const t=text(obj?.[k]);if(t)return t;}return '';};
  const own=pick(node,TITLE_KEYS)||(text(node.month)?`شهر ${node.month}`:''),person=text(node.employee_name||node.claimant_name||node.holder_name||node.requester_name||''),parent=parents.map(p=>pick(p,TITLE_KEYS)).filter(Boolean).at(-1)??'';
  const detail=[text(node.work_date||node.holiday_date||node.expense_date||node.from_date||node.planned_date||''),node.amount_minor!==undefined&&Number.isFinite(Number(node.amount_minor))?`${(Number(node.amount_minor)/100).toLocaleString('en-US',{minimumFractionDigits:2})} ريال`:''].filter(Boolean).join(' · ');
  const due=pick(node,DUE_KEYS);
  return {kind:kind??'',title:[own&&own!==person?own:'',person].filter(Boolean).join(' — ')||parent||'سجل بانتظار قرار',context:[own||person?parent:'',detail].filter(Boolean).join(' · '),since:pick(node,DATE_KEYS)||parents.map(p=>pick(p,DATE_KEYS)).filter(Boolean).at(-1)||null,
    person:person||null,due_on:ISO_DAY.test(due)?due.slice(0,10):null};
}
function collect(node,parents,out,seen,kind=null){
  if(Array.isArray(node)){for(const x of node)collect(x,parents,out,seen,kind);return;}
  if(!node||typeof node!=='object'||seen.has(node))return;seen.add(node);
  const actions=[...(Array.isArray(node.actions)?node.actions:[]),...(Array.isArray(node.allowed_actions)?node.allowed_actions:[])].filter(a=>typeof a==='string');
  const labelled=actions.map(a=>[a,labelFor(a)]).filter(([,label])=>label);
  let labels=[...new Set(labelled.map(([,label])=>label))];
  if(labels.length>1)labels=labels.filter(l=>l!=='قرار');
  // action_keys: أسماء الأفعال كما سمّتها اللوحة. «ما عليّ» يصنّف بها (قرار أم رد أم اختياري) لأن العنوان العربي لا يكفي للتصنيف.
  if(labels.length)out.push({...describe(node,parents,kind),id:text(node.id||node.purchase_id||node.key||''),actions:labels,action_keys:[...new Set(labelled.map(([key])=>key))]});
  for(const [key,value] of Object.entries(node))if(value&&typeof value==='object')collect(value,[...parents,node],out,seen,KINDS[key]??(Array.isArray(value)?null:kind));
}
// رابط البند رابط سجله لا شاشته: كل بند له معرّف يفتح شاشته ويقف عنده (‎#screen?focus=<id>‎، يعالجه app.mjs بمعالج واحد عام).
// مصدر له صفحة سجل خاصة (نموذج، طلب) يعطي رابطها في خيارات المصدر. بند بلا معرّف لا يملك إلا شاشته.
export const recordLink=(key,item,options={})=>!item.id?`#${key}`:options.link?options.link(item):`#${key}?focus=${encodeURIComponent(item.id)}`;
// الماشي: يقرأ كل لوحة بهوية المستخدم نفسه ويعيد كل بنودها بلا قطع. العدّ والقطع للعرض فقط، ويجريان بعده لا قبله.
export function walkBoards(db,u){
  const groups=[],failed=[],scope=new Map();
  for(const [key,name,load,options] of SOURCES){
    // الوسيط الثالث لكثير من اللوحات أسبوع أو شهر أو مرشّح: لا يُمرَّر النطاق إلا لمصدر طلبه صراحة (scoped).
    let data;try{data=options?.scoped?load(db,u,scope):load(db,u);}catch(error){if(!error.status)failed.push(name);continue;}
    const items=[];collect(data,[],items,new Set());
    if(items.length)groups.push({key,name,link:`#${key}`,items:items.map(i=>({...i,link:recordLink(key,i,options)}))});
  }
  return {groups,failed};
}
export { labelFor, SOURCES, collect };

// ما يعرضه الصندوق من كل شاشة في المرة الواحدة. العدد يُحسب قبل القطع، والقطع يُقال: «يُعرض 50 من N».
export const INBOX_PAGE=50;
// «بانتظار قراري» = سلة «أقرّر» من obligations.mjs مجمّعةً بحسب شاشتها، ومعها سلة «أجيب» في قسم منفصل.
// لا عدّ هنا ولا قاعدة تأخر: الرقم رقم obligations، وهو نفسه في بطاقة الرئيسية وشارة القائمة و«العمل اليومي».
export function inbox(db,supplied,options={}){
  const ob=obligations(db,supplied,{...options,watching:false});
  const decide=ob.items.filter(i=>i.bucket==='decide'),groups=[];
  for(const item of decide){
    let group=groups.find(g=>g.key===item.source);
    if(!group)groups.push(group={key:item.source,name:item.source_name,link:`#${item.source}`,total:0,shown:0,truncated:false,items:[]});
    group.total++;
    if(group.items.length<INBOX_PAGE)group.items.push({...item,late:item.overdue});
  }
  for(const g of groups){g.shown=g.items.length;g.truncated=g.total>g.shown;g.shown_note=g.truncated?`يُعرض ${g.shown} من ${g.total}`:'';}
  const threshold=ob.waiting_limit_days;
  return {user_id:ob.user_id,total:ob.counts.decide,late:decide.filter(i=>i.overdue).length,groups,
    respond:ob.items.filter(i=>i.bucket==='respond').map(i=>({...i,late:i.overdue})),counts:ob.counts,waiting_limit_days:threshold,unavailable:ob.unavailable,
    note:'يجمع هذا الصندوق ما تعرضه عليك شاشات المنصة من قرارات، وكل بند يفتح سجله. القرار نفسه يُتخذ في شاشته بقواعدها.',
    late_note:threshold?`«متأخر» = فات الزمن المستهدف لخدمته أو موعد سجله، وما لا موعد له: مضى على وصوله إليك ${threshold} أيام عمل أو أكثر (الأحد–الخميس دون العطل المعتمدة).`
      :'«متأخر» = فات الزمن المستهدف لخدمته أو موعد سجله. لم يحدد المالك مدة انتظار لما لا موعد له، فلا يوصف بالتأخر.'};
}
// عداد خفيف لشارة شريط التنقل؛ يُحفظ لكل مستخدم عشرين ثانية حتى لا تُعاد قراءة اللوحات مع كل تنقل.
// الرقم رقم obligations().counts.decide نفسه، لا عدّ ثانٍ.
const cache=new Map();
export function inboxCount(db,supplied){
  const hit=cache.get(supplied?.id);if(hit&&Date.now()-hit.at<20000)return hit.value;
  const ob=obligations(db,supplied,{watching:false});
  const value={total:ob.counts.decide,late:ob.items.filter(i=>i.bucket==='decide'&&i.overdue).length,respond:ob.counts.respond,do:ob.counts.do};
  cache.set(ob.user_id,{at:Date.now(),value});return value;
}
export function clearInboxCache(userId){if(userId)cache.delete(userId);else cache.clear();}
