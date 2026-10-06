import { randomUUID } from 'node:crypto';
import { now } from './db.mjs';
// م0 «السور»: كلمة الحالة في نص الإشعار هي كلمتها في الشارة، من القاموس الواحد.
import { REQUEST_STATUS_AR as S } from './static/vocabulary.mjs';

// نص الإشعارات داخل المنصة (B6 وB7 في تدقيق بوابة الموظف، 19 سبتمبر). البريد (delivery.mjs) لا ينقل هذا النص: رسالته تنبيه عام ورابط.
// القاعدة: العنوان يقول ما حدث ولمن، والمتن يقول الحالة التالية أو أين يُقرأ السبب. النص يُبنى من قوالب هنا فقط،
// ولا يحمل مبالغ رواتب ولا أرقام هوية ولا ملاحظة المعتمد الحرة (قد تحوي ما لا يصلح لإشعار)؛ السبب يُقرأ في شاشته.
const MONTHS=['يناير','فبراير','مارس','أبريل','مايو','يونيو','يوليو','أغسطس','سبتمبر','أكتوبر','نوفمبر','ديسمبر'];
const parts=date=>{const [y,m,d]=String(date).slice(0,10).split('-').map(Number);return {y,m,d};};
// «3 أكتوبر»؛ السنة تُذكر فقط حين لا تكون سنة اليوم.
export function dayName(date,today=new Date(Date.now()+3*3600000).toISOString().slice(0,10)){
  const {y,m,d}=parts(date);if(!y||!m||!d)return String(date??'');
  return `${d} ${MONTHS[m-1]}${y!==parts(today).y?` ${y}`:''}`;
}
// «من 3 إلى 5 أكتوبر»، «من 28 سبتمبر إلى 2 أكتوبر»، «يوم 3 أكتوبر».
export function dateRange(start,end,today){
  if(!end||start===end)return `يوم ${dayName(start,today)}`;
  const a=parts(start),b=parts(end),sameYear=a.y===b.y,thisYear=a.y===parts(today??new Date(Date.now()+3*3600000).toISOString().slice(0,10)).y;
  if(sameYear&&a.m===b.m)return `من ${a.d} إلى ${b.d} ${MONTHS[b.m-1]}${thisYear?'':` ${b.y}`}`;
  if(sameYear)return `من ${a.d} ${MONTHS[a.m-1]} إلى ${b.d} ${MONTHS[b.m-1]}${thisYear?'':` ${b.y}`}`;
  return `من ${dayName(start,'0000-01-01')} إلى ${dayName(end,'0000-01-01')}`;
}
const clip=(text,max)=>{const s=String(text??'').replace(/\s+/g,' ').trim();return s.length>max?s.slice(0,max-1)+'…':s;};

// الشاشة التي يفتحها الإشعار. المعرّف لا يُمرَّر في الرابط لغير الطلبات: الشاشة تعرض سجلات صاحبها بصلاحيته.
// هذه القائمة هي القائمة المسموحة لموضوعات الإشعار (ترحيل 100 جعل قيد الجدول قيد شكل فقط).
export const SUBJECT_LINKS={leave_request:'#leave',expense_claim:'#expenses',custody:'#expenses',letter_request:'#letters',attendance_correction:'#attendance',
  hr_case:'#hr-cases',training:'#growth',performance_review:'#performance',timesheet:'#timesheets',work_mission:'#attendance',attendance_absence:'#attendance',
  expiry:'#expiry',probation:'#employees',approvals_digest:'#work',manager_digest:'#work',security:'#accounts',account_security:'#security'};
// قواعد الحضور (ترحيل 099): كل قرار على سجل حضور يصل صاحبه ويفتح شاشة الحضور.
Object.assign(SUBJECT_LINKS,Object.fromEntries(['overtime_assignment','overtime_request','attendance_permission','attendance_notice','attendance_site','attendance_exemption','attendance_location','work_mission','shift_assignment'].map(kind=>[kind,'#attendance'])));
// قضية الانضباط (ترحيل 097) تُفتح في صفحة صاحبها؛ لا معرّف في الرابط.
SUBJECT_LINKS.discipline_case='#my-discipline';

// فئات البريد: الموظف يختار منها ما يصله بالبريد. الإشعار داخل المنصة يصل دائمًا.
export const NOTICE_CATEGORIES=[
  {key:'approvals',name:'ما ينتظر قراري أو تنفيذي'},
  // استقالتي وانتدابي يدخلان هذه المجموعة نفسها (لا فئة جديدة: قائمة الفئات في الترحيل 100 قيد CHECK مغلق).
  {key:'my_requests',name:'تحديثات طلباتي وإجازاتي ومصروفاتي وخطاباتي وحضوري واستقالتي وانتدابي'},
  {key:'hr_cases',name:'تحديثات حالاتي السرية لدى الموارد البشرية'},
  {key:'development',name:'التدريب وتقييم الأداء وكشوف الوقت'},
  {key:'reminders',name:'التذكيرات اليومية وملخص المدير'},
  {key:'security',name:'تنبيهات الأمان'}
];
const CATEGORY_KEYS=new Set(NOTICE_CATEGORIES.map(c=>c.key));
const ACTION_KINDS=/(^approval_needed$|^approval_escalated$|^approval_moved_(to_you|away)$|^ready_for_execution(_fallback)?$|^execution_(released|reassigned)$|^task_assigned$|_needed$|_awaiting$|_intake$)/;
const SUBJECT_CATEGORY={hr_case:'hr_cases',training:'development',performance_review:'development',timesheet:'development',expiry:'reminders',probation:'reminders',approvals_digest:'reminders',manager_digest:'reminders',security:'security',account_security:'security',discipline_case:'hr_cases'};
// فئة الإشعار من نوعه وموضوعه. الصفوف القديمة بلا فئة تُقرأ بهذه الدالة نفسها.
export function categoryOf({kind='',subject_kind:subjectKind=null,category=null}={}){
  if(category&&CATEGORY_KEYS.has(category))return category;
  if(SUBJECT_CATEGORY[subjectKind])return SUBJECT_CATEGORY[subjectKind];
  if(ACTION_KINDS.test(kind))return 'approvals';
  return 'my_requests';
}
// «مزاياي» (ترحيل 103): الموظف يفتح طلبه في «مزاياي»، وفريق المزايا والمالية والرواتب يفتحون «إدارة المزايا».
Object.assign(SUBJECT_LINKS,{benefit_request:'#my-benefits',benefit_review:'#benefits-admin',benefit_catalog:'#benefits-admin'});
// الاستقالة والانتداب (ترحيل 102): كانا بلا إشعارات (فجوة تسليم الدمج §5). الموضوعان يمران بقاعدة شكل الترحيل 099.
Object.assign(SUBJECT_LINKS,{resignation:'#resignations',travel_decision:'#travel'});
// D-15 (تدقيق مسارات الوحدات، 20 سبتمبر): تسوية نهاية الخدمة كانت بلا إشعار وبلا مسار قراءة لصاحبها.
// تُفتح في «الرواتب والقسائم» حيث يقرأ الموظف قسائمه: الأرقام هناك، والإشعار يقول إنها صدرت وإلى متى مهلتها.
SUBJECT_LINKS.service_settlement='#payroll';
// عكس المسير المعتمد (الحزمة 4، الترحيل 175): صاحب القسيمة يُبلَّغ أن قسيمة الشهر انسحبت، وطالب العكس بقراره؛ الشاشة «الرواتب والقسائم».
SUBJECT_LINKS.payroll_run='#payroll';
// D-05: تذكير تشغيل الاستحقاق المستحق يفتح شاشته. تذكير لا تنفيذ: التشغيل يبقى قرار مدير الموارد البشرية.
SUBJECT_LINKS.accrual_run='#leave-accrual';
// الموجة 2: ما يخص من يدير الهيكل والتصعيد (خطوة متأخرة لا درجة أعلى لها، إشعار بلا مستلم، عمل بلا منفّذ) يفتح «إعداد الاعتماد»،
// وما يخص مدير إدارة عن عمل إدارته المفتوح (منفّذ غادر، طلب معاد طال انتظاره) يفتح الرئيسية حيث لوحته.
Object.assign(SUBJECT_LINKS,{workflow_gap:'#approval-settings',department_work:'#home'});
SUBJECT_CATEGORY.accrual_run='reminders';
// الإجازة التعويضية (ترحيل 125): صاحب الرصيد يفتح «الإجازات» حيث رصيده وقيوده بمهلها، ومُعد الرواتب يفتح «الحضور» حيث طابور الإحالة.
// بلا هذين السطرين يُسقط الحارس أدناه الإشعارين بصمت.
Object.assign(SUBJECT_LINKS,{compensatory_credit:'#leave',compensatory_payout:'#attendance'});
Object.assign(SUBJECT_CATEGORY,{compensatory_credit:'reminders',compensatory_payout:'reminders'});
Object.assign(SUBJECT_CATEGORY,{workflow_gap:'approvals',department_work:'approvals'});
// تدقيق مسارات الوحدات (20 سبتمبر):
// D-03 — التغطية الطبية كانت بلا أي إشعار، ولا حتى عند الحذف من الوثيقة. موضوعها صفحة الموظف «مزاياي».
// D-21 — التغذية الراجعة واللقاءات الفردية والتقدير وإقرار السياسات: ثلاث وحدات لا تصل أحدًا. الموضوع هنا وإلا أسقطه الحارس بصمت.
Object.assign(SUBJECT_LINKS,{medical_enrolment:'#my-benefits',one_to_one:'#one-to-ones',follow_up_item:'#one-to-ones',
  feedback_note:'#feedback',feedback_request:'#feedback',review_nomination:'#feedback',
  recognition_card:'#recognition',policy_ack_round:'#policy-acknowledgements'});
// التغذية الراجعة واللقاءات وإقرار السياسات تطوير لا طلب: تصل بريد «التدريب وتقييم الأداء وكشوف الوقت» لا «تحديثات طلباتي».
Object.assign(SUBJECT_CATEGORY,{one_to_one:'development',follow_up_item:'development',feedback_note:'development',feedback_request:'development',
  review_nomination:'development',policy_ack_round:'development',recognition_card:'my_requests',medical_enrolment:'my_requests'});

// الحزمة 4 (العملاء، الترحيلان 180 و181): الصفقة تُفتح في «العملاء والعروض» والفرصة في «خط الفرص». كانت وحدتا المبيعات بلا إشعار
// واحد؛ وبلا هذا السطر يُسقط الحارس أدناه إشعاريهما بصمت. «تأهيل ينتظر قرارك» يقع في فئة الاعتمادات بنوعه (_needed).
Object.assign(SUBJECT_LINKS,{commercial_case:'#commercial',opportunity:'#pipeline'});

// إشعار لسجل ليس طلب خدمة. يُكتب داخل معاملة الإجراء نفسه، فإن فشل الإجراء لم يبق إشعار.
// بلا مستلم لا يُكتب صف (العمود NOT NULL). من عنده مستلم غائب لا يستدعي هذه مباشرة: يمر بـdeliverSubject في
// app/notice-recipients.mjs، فيصل الإشعار مدير الإدارة ثم سُلَّم تصعيدها، أو يُسجَّل «بلا مستلم» حيث يراه من يدير الهيكل.
export function notifySubject(db,{userId,kind,subjectKind,subjectId,title,body='',category=null}){
  if(!userId||!SUBJECT_LINKS[subjectKind])return null;
  const noticeId=randomUUID();
  db.prepare('INSERT INTO notifications(id,user_id,request_id,kind,created_at,subject_kind,subject_id,title,body,category) VALUES(?,?,NULL,?,?,?,?,?,?,?)')
    .run(noticeId,userId,kind,now(),subjectKind,subjectId,clip(title,300),clip(body,600),categoryOf({kind,subject_kind:subjectKind,category}));
  return noticeId;
}
// الشيء نفسه لعدة مستلمين، بلا تكرار، ودون من قام بالفعل.
export function notifyMany(db,userIds,actorId,notice){
  const seen=new Set();
  for(const userId of userIds){if(!userId||userId===actorId||seen.has(userId))continue;seen.add(userId);notifySubject(db,{...notice,userId});}
  return seen.size;
}

// ── حالات الموارد البشرية: نص عام سري ─────────────────────────────────────────
// لا فئة ولا عنوان ولا اسم طرف ولا نص رد: الإشعار يقول إن شيئًا تغيّر ورقم الحالة فقط، والتفاصيل في شاشتها.
export const caseRef=caseId=>String(caseId??'').replace(/-/g,'').slice(0,8).toUpperCase();
export function hrCaseNotice(event,caseId){
  const ref=caseRef(caseId);
  switch(event){
    case 'intake':return {kind:'hr_case_intake',title:`حالة سرية جديدة بانتظار الاستلام رقم ${ref}`,body:'افتح «الحالات السرية» لاستلامها. لا تُعرض تفاصيلها هنا.'};
    case 'assigned':return {kind:'hr_case_assigned',title:`أُسندت إليك الحالة رقم ${ref}`,body:'افتح «الحالات السرية» لمتابعتها. لا تُعرض تفاصيلها هنا.'};
    case 'closed':return {kind:'hr_case_closed',title:`أُغلقت حالتك رقم ${ref}`,body:'نتيجة الإغلاق وسببه في صفحة الحالة.'};
    case 'handler_update':return {kind:'hr_case_handler_update',title:`تحديث على الحالة المسندة إليك رقم ${ref}`,body:'افتح «الحالات السرية» لقراءته. لا تُعرض تفاصيله هنا.'};
    default:return {kind:'hr_case_updated',title:`تحديث على حالتك رقم ${ref}`,body:'افتح «الشكاوى والاستفسارات» لقراءة التحديث. لا تُعرض تفاصيله هنا.'};
  }
}

// نص إشعارات طلبات الخدمة. detail يصف ما حدث لحظة الحدث: {decision:'approved'|'returned'|'rejected', final:true|false, status}.
// الصفوف القديمة بلا detail تُقرأ بالقالب العام لنوعها مع عنوان الطلب.
export function requestNotice(kind,requestTitle,detail={}){
  const t=`«${clip(requestTitle,120)}»`;
  switch(kind){
    case 'request_submitted':return detail.status==='approved'
      ?{title:`استلمنا طلبك ${t}`,body:`الحالة: ${S.approved} مباشرة — الخدمة لا تحتاج اعتمادًا، ووصل الطلب إلى فريق التنفيذ.`}
      :{title:`استلمنا طلبك ${t}`,body:`الحالة: ${S.pending}. ستصلك رسالة عند كل قرار.`};
    case 'approval_needed':return {title:`طلب ينتظر قرارك: ${t}`,body:'افتح الطلب لاعتماده أو إعادته أو رفضه.'};
    // النوع 'approval_escalated' اسم قديم لإشعار هو تذكير: يصل صاحب القرار نفسه ولا ينقل شيئًا. كان نصه «صُعِّد إليك… تأخر
    // القرار عند المعتمد السابق» ويصل المتأخر نفسه. الصفوف القديمة تحتفظ بنصها المخزَّن؛ الجديدة تقول ما حدث.
    case 'approval_escalated':return {title:`تذكير: طلب ينتظر قرارك: ${t}`,body:'أحد أطراف الطلب يذكّرك به. القرار ما زال عندك ولم يُنقل إلى غيرك؛ افتح الطلب لاعتماده أو إعادته أو رفضه.'};
    // نقل القرار فعلًا (app/step-escalation.mjs): إشعاران صادقان — لمن وصله القرار لماذا وصله، ولمن نُقل عنه أنه انتقل.
    case 'approval_moved_to_you':return {title:`نُقل إليك قرار طلب: ${t}`,
      body:`${clip(detail.why??'نُقل قرار خطوة اعتماد إليك',200)}. كان القرار عند ${clip(detail.from_name??'المعتمد السابق',80)}${detail.waited?`، وانتظر عنده ${detail.waited} يوم عمل`:''}. القرار الآن لك بصفتك ${clip(detail.rung??'الدرجة التالية في سُلَّم تصعيد الإدارة',120)}؛ افتح الطلب لاعتماده أو إعادته أو رفضه.`};
    case 'approval_moved_away':return {title:`انتقل قرار الطلب ${t} إلى غيرك`,
      body:`${clip(detail.why??'نُقل قرار خطوة اعتماد كانت عندك',200)}. القرار الآن عند ${clip(detail.to_name??'الدرجة التالية في سُلَّم التصعيد',80)}، ولم يعد لك فيه اعتماد ولا إعادة ولا رفض. يبقى الطلب مقروءًا لك.`};
    // الطلب المعاد (الموجة 2، العطب 4): تذكير صاحبه، وإخبار من أعاده، والانقضاء حين تُعتمد مهلته.
    case 'returned_reminder':return {title:`طلبك ${t} ما زال ينتظر ردّك`,
      body:`أُعيد إليك قبل ${detail.waited??'عدة'} يوم عمل وساعته متوقفة ما دام عندك. عدّله وأعد تقديمه، أو ألغه إن لم تعد تحتاجه.${detail.expires_after?` إن بقي بلا رد انقضى عند بلوغه ${detail.expires_after} يوم عمل منذ إعادته.`:''}`};
    case 'returned_still_waiting':return {title:`الطلب ${t} الذي أعدته ما زال عند صاحبه`,body:`مضى على إعادته ${detail.waited??'عدة'} يوم عمل وذُكِّر صاحبه مرتين ولم يردّ. يظهر عندك في «أعدتُها وتنتظر».`};
    case 'request_lapsed':return {title:`انقضى طلبك ${t} لعدم الرد`,
      body:`أُعيد إليك قبل ${detail.waited??'عدة'} يوم عمل وذُكِّرت به ولم يُعد تقديمه، فأُغلق بمهلة الانقضاء المعتمدة (${detail.timer_value??'—'} يوم عمل). تقديم طلب جديد متاح متى احتجت.${detail.record_note?` ${clip(detail.record_note,200)}`:''}`};
    case 'request_lapsed_returner':return {title:`انقضى الطلب ${t} الذي أعدته`,body:`لم يردّ صاحبه خلال مهلة الانقضاء المعتمدة (${detail.timer_value??'—'} يوم عمل) بعد تذكيره، فأُغلق. لا إجراء مطلوب منك.`};
    // إسناد التنفيذ (الموجة 2، العطب 8).
    case 'execution_released':return {title:`عاد طلب إلى طابور التنفيذ: ${t}`,body:`${clip(detail.why??'أعاده منفّذه إلى الطابور',200)}. استلمه أحد منفذيه ليكمل التنفيذ.`};
    case 'execution_reassigned':return {title:`أُسند إليك تنفيذ الطلب ${t}`,body:`${clip(detail.why??'أسنده إليك مدير الإدارة المنفذة',200)}. الطلب الآن قيد التنفيذ عندك؛ افتحه لمتابعته وإغلاقه بوصف ما سُلِّم.`};
    case 'execution_moved_away':return {title:`نُقل عنك تنفيذ الطلب ${t}`,body:`${clip(detail.why??'نُقل تنفيذه إلى غيرك',200)}. لم يعد مسندًا إليك.`};
    case 'task_holder_departed':return {title:`مهمة أسندتها في الطلب ${t} عند حساب أُوقف`,body:`المهمة «${clip(detail.task??'',120)}» مسندة إلى «${clip(detail.name??'',80)}» وحسابه موقوف، ولا يكملها غيره. ألغها من الطلب وأسندها إلى غيره.`};
    case 'execution_holder_changed':return {title:`تغيّر من ينفّذ طلبك ${t}`,body:`${clip(detail.why??'عاد الطلب إلى طابور إدارته المنفذة',200)}. لا إجراء مطلوب منك؛ التنفيذ مستمر.`};
    case 'ready_for_execution':return {title:`طلب جاهز للتنفيذ: ${t}`,body:'اكتمل اعتماده؛ استلمه لبدء التنفيذ.'};
    // وصل بالحلقة الاحتياطية: لا منفذ في الإدارة المنفذة غير من قرر الطلب. السبب يُكتب في الإشعار نفسه.
    case 'ready_for_execution_fallback':return {title:`طلب وصلك للتنفيذ: ${t}`,
      body:`لم يبقَ في الإدارة المنفذة من ينفّذه: من قرره لا ينفّذه. وصلك بصفتك ${detail.basis??'منفّذًا احتياطيًا'}${detail.why?` — ${clip(detail.why,160)}`:''}. استلمه لبدء التنفيذ.`};
    case 'decision_updated':
      if(detail.decision==='approved'&&detail.final)return {title:`اعتُمد طلبك ${t}`,body:`الحالة: ${S.approved} — بانتظار استلام فريق التنفيذ.`};
      if(detail.decision==='approved')return {title:`اجتاز طلبك ${t} خطوة اعتماد`,body:`الحالة: ${S.pending} لدى الخطوة التالية.`};
      if(detail.decision==='returned')return {title:`أُعيد إليك طلبك ${t} للتعديل`,body:`الحالة: ${S.returned}. اقرأ ملاحظة المعتمد في الطلب ثم عدّله وأعد تقديمه.`};
      if(detail.decision==='rejected')return {title:`رُفض طلبك ${t}`,body:`الحالة: ${S.rejected}. سبب الرفض مكتوب في صفحة الطلب.`};
      return {title:`صدر قرار على طلبك ${t}`,body:'افتح الطلب لمعرفة القرار وحالته الآن.'};
    case 'request_updated':return {title:`أُلغي الطلب ${t}`,body:`الحالة: ${S.cancelled}.`};
    case 'execution_started':return {title:`بدأ تنفيذ طلبك ${t}`,body:`الحالة: ${S.in_progress}.`};
    case 'execution_completed':return {title:`اكتمل طلبك ${t}`,body:`الحالة: ${S.completed}. يمكنك تقييم الخدمة من صفحة الطلب.`};
    case 'task_assigned':return {title:`أُسندت إليك مهمة في الطلب ${t}`,body:'افتح الطلب لقراءة المهمة وموعدها.'};
    case 'task_completed':return {title:`أُنجزت مهمة في الطلب ${t}`,body:'افتح الطلب لمراجعة الدليل.'};
    case 'task_cancelled':return {title:`أُلغيت مهمة في الطلب ${t}`,body:'افتح الطلب لمعرفة السبب.'};
    case 'request_transferred':return {title:`حُوِّل الطلب ${t} إلى جهة أخرى`,body:'افتح الطلب لمعرفة الجهة المسؤولة الآن.'};
    case 'request_reopened':return {title:`أُعيد فتح الطلب ${t}`,body:'افتح الطلب لقراءة سبب إعادة الفتح.'};
    default:return {title:`تحديث على الطلب ${t}`,body:'افتح الطلب لمعرفة ما تغير.'};
  }
}
