import { actorOrRefuse } from './refusal.mjs';
import { getRequest, serviceOf, actions as requestActions, listRequests, normalizeStep, deciderOf, ESCALATION_BASIS } from './workflow.mjs';
import { handlingDepartment, serviceClock } from './routing.mjs';
import { holidaySet, workingDaysBetween, riyadhDate } from './work-calendar.mjs';
import { closureView } from './request-closure.mjs';
import { feedbackView } from './service-feedback.mjs';
import { lapseOf } from './returned-requests.mjs';
import { adoptedTimerRows, NOT_ADOPTED } from './workflow-timers.mjs';
import { stageOf, TIMELINE_STATIONS, stationName } from './static/vocabulary.mjs';

// الخط الزمني الصادق: سرد واحد مرتب لما جرى للطلب، ومعه زمن المكوث عند كل طرف.
// زمن المكوث هو ما يكشف الاختناق: طلب مرّ بستة أفعال في يومين ليس كطلب مرّ بفعلين في ثلاثة أسابيع.
// وزمن المكوث عند صاحب الطلب يُعلَّم «الساعة متوقفة» لأنه لا يُحتسب على أحد.

const ROLE_NAMES={manager:'المدير المباشر لصاحب الطلب',department_manager:'مدير الإدارة المالكة',hr:'الموارد البشرية',it:'تقنية المعلومات',pm:'مدير المشاريع',executive:'الرئاسة (نائب القطاع أو الرئيس التنفيذي)'};
const CLOSED=['completed','cancelled','rejected'];

// ما يظهر لكل فعل في السجل. `internal:true` يعني أن الحدث تداولٌ داخلي بين المنفذين
// يرى صاحبُ الطلب أثره لا نصه: لا نُخفي عنه القرار ولا سببه الموجّه إليه، بل نُخفي مداولة لم تُكتب له.
const ACTIONS={
  created:{text:'أنشأ الطلب كمسودة'},
  edited:{text:'عدّل بيانات الطلب قبل التقديم'},
  submit:{text:'قدّم الطلب'},
  approve:{text:'اعتمد الطلب',note_internal:true},
  return:{text:'أعاد الطلب لصاحبه للاستكمال'},
  reject:{text:'رفض الطلب'},
  cancel:{text:'ألغى الطلب'},
  claim:{text:'باشر التنفيذ'},
  complete:{text:'أغلق الطلب بعد التنفيذ'},
  // «escalate» مفتاح قديم لفعل هو تذكير لا تصعيد (workflow.escalateApproval). نقل القرار فعلًا هو approval.escalated.
  escalate:{text:'أرسل تذكيرًا إلى المعتمد',internal:true},
  'approval.escalated':{text:'نُقل قرار خطوة اعتماد إلى مرجع أعلى',note_internal:true},
  'approval.escalation_blocked':{text:'تعذّر نقل قرار خطوة متأخرة: لا درجة أعلى تصلح',internal:true},
  'request.released':{text:'أعاد المنفّذ الطلب إلى طابور إدارته',note_internal:true},
  'request.reassigned':{text:'أسند مدير الإدارة المنفذة الطلب إلى منفّذ آخر',note_internal:true},
  'request.assignment_overridden':{text:'نُقل إسناد الطلب بتجاوز مسجَّل ممن يدير الهيكل',note_internal:true},
  'request.executor_departed':{text:'أُوقف حساب المنفّذ فعاد الطلب إلى طابور إدارته',note_internal:true},
  'request.lapsed':{text:'انقضى الطلب لعدم الرد بعد تذكير صاحبه'},
  'request.resubmitted_from_lapsed':{text:'أعاد صاحب الطلب تقديمه من طلبه المنقضي، في طلب جديد'},
  'request.returned_reminded':{text:'ذُكِّر صاحب الطلب بأن طلبه المعاد ينتظر ردّه'},
  attachment_added:{text:'أضاف مرفقًا'},
  attachment_downloaded:{text:'اطّلع على مرفق',internal:true},
  'request.transferred':{text:'حوّل الطلب إلى إدارة أخرى',note_internal:true},
  // ابن الرحلة (الدفعة الرابعة، مراجعة 23 سبتمبر): وُلد باسم صاحب الأب حين اعتمد المعتمِدُ الأبَ؛ الحدث باسم المعتمِد وملاحظته تسمّي الرحلة والأب.
  'journey.child_created':{text:'وُلد هذا الطلب من رحلةٍ عند اعتماد طلبها الأب'},
  'request.task_assigned':{text:'أسند مهمة تنفيذية داخل الإدارة',internal:true},
  'request.task_complete':{text:'أنجز مهمة تنفيذية',internal:true},
  'request.task_cancel':{text:'ألغى مهمة تنفيذية',internal:true},
  'intake.saved':{text:'حدّث بيانات الاستقبال'},
  'service.feedback_recorded':{text:'سجّل صاحب الطلب رأيه بعد الإغلاق'},
  'request.closed':{text:'وثّق ما سُلِّم وأغلق الطلب'},
  'request.reopened':{text:'أعاد صاحب الطلب فتح الطلب'}
};

const actor=actorOrRefuse;
function returnedLapseNote(db,r,clock){
  const expiry=adoptedTimerRows(db,r.tenant_id).returned_expiry??null,waited=clock.paused_days??0;
  return expiry?`ينقضي الطلب إن بقي بلا رد ${expiry.value} يوم عمل منذ إعادته (مضى ${waited}). يسبقه تذكير.`:`انقضاء الطلب المعاد ${NOT_ADOPTED}: يبقى مفتوحًا حتى تردّ أو تلغيه.`;
}
const departmentName=(db,tenantId,id)=>id?db.prepare('SELECT name FROM departments WHERE id=? AND tenant_id=?').get(id,tenantId)?.name??id:'';
// الخطوة إما نص أو كائن {role, department?, when?} بعد محرك الاعتماد؛ الكائنية تُسمّى بدورها وإدارتها.
const stepLabel=(service,position)=>{
  const step=normalizeStep(service.approval_policy.steps[position]);
  if(!step?.role)return 'معتمد';
  const base=ROLE_NAMES[step.role]??step.role;
  return step.department?`${base} — ${step.department}`:base;
};

function span(from,to,holidays){
  const hours=Math.max(0,Math.round((Date.parse(to)-Date.parse(from))/360000)/10);
  return {working_days:workingDaysBetween(riyadhDate(from),riyadhDate(to),holidays),hours};
}

// مراحل المكوث: من متى إلى متى، وعند من. المرحلة المفتوحة تُحسب حتى اللحظة وتُعلَّم `open`.
export function dwellStages(db,r,holidays=holidaySet(db,r.tenant_id),asOf=new Date().toISOString()){
  const service=serviceOf(db,r),parallel=service.approval_policy.mode==='parallel',rows=[];
  const versions=db.prepare('SELECT revision,created_at FROM request_versions WHERE request_id=? ORDER BY revision').all(r.id);
  const steps=db.prepare('SELECT s.*,u.name AS approver_name FROM approval_steps s JOIN users u ON u.id=s.approver_id WHERE s.request_id=? ORDER BY s.revision,s.position').all(r.id);
  const push=(party,kind,from,to,extra={})=>rows.push({party,kind,from,to:to??null,open:!to,paused:kind==='requester',...span(from,to??asOf,holidays),...extra});

  for(const version of versions){
    const mine=steps.filter(s=>s.revision===version.revision);
    let cursor=version.created_at;
    for(const step of mine){
      // في المسار المتوازي تبدأ كل الخطوات من لحظة التقديم؛ وفي المتسلسل تبدأ الخطوة من قرار ما قبلها.
      const from=parallel?version.created_at:cursor;
      if(step.status==='pending'&&r.status!=='pending')break;
      // خطوة نُقل قرارها تُقسم عند كل نقل: الانتظار يُحسب على من كان القرار عنده، لا على الدور كله.
      const hops=db.prepare('SELECT level,created_at FROM approval_step_escalations WHERE step_id=? ORDER BY level').all(step.id);
      let start=from;
      for(const hop of hops){push(stepLabel(service,step.position)+(hop.level>1?` — بعد نقل القرار (الدرجة ${hop.level-1})`:''),'approval',start,hop.created_at,{revision:version.revision,position:step.position,decision:'escalated'});start=hop.created_at;}
      push(stepLabel(service,step.position)+(hops.length?` — بعد نقل القرار (الدرجة ${hops.length})`:''),'approval',start,step.decided_at,{revision:version.revision,position:step.position,decision:step.status});
      if(step.decided_at)cursor=step.decided_at;
      if(step.status==='returned'){
        const resumed=versions.find(x=>x.revision>version.revision);
        push('صاحب الطلب','requester',step.decided_at,resumed?.created_at,{revision:version.revision});
      }
      if(['returned','rejected'].includes(step.status)||step.status==='pending'&&!parallel)break;
    }
  }

  // ما بعد الاعتماد يُقرأ من سجل التدقيق: هو المصدر الوحيد الذي يحمل لحظة المباشرة والتحويل والإغلاق مرتبة.
  // الطلب لم يصل التنفيذ ما لم تُعتمد كل خطوات نسخته الأخيرة؛ خطوة معتمدة وحدها ليست اعتمادًا.
  const finalSteps=steps.filter(s=>s.revision===r.revision);
  if(!finalSteps.length||!finalSteps.every(s=>s.status==='approved'))return rows;
  const approvedAt=finalSteps.map(s=>s.decided_at).sort().at(-1);
  const marks=db.prepare(`SELECT action,created_at,after_json FROM audit_events WHERE tenant_id=? AND entity_type='request' AND entity_id=?
      AND action IN ('claim','complete','cancel','request.transferred','request.reopened','request.released','request.reassigned','request.assignment_overridden','request.executor_departed') AND created_at>=? ORDER BY seq`).all(r.tenant_id,r.id,approvedAt);
  const transfers=db.prepare('SELECT to_department_id,created_at FROM request_transfers WHERE request_id=? ORDER BY created_at').all(r.id);
  let department=handlingDepartment(db,r),current={kind:'queue',from:approvedAt},transferIndex=0;
  const label=(kind,dept)=>kind==='queue'?`الإدارة المنفذة (${departmentName(db,r.tenant_id,dept)}) — بانتظار من يباشر`
    :kind==='rework'?`الإدارة المنفذة (${departmentName(db,r.tenant_id,dept)}) — إعادة عمل بعد إعادة الفتح`
    :`الإدارة المنفذة (${departmentName(db,r.tenant_id,dept)}) — تنفيذ`;
  // الإدارة المنفذة وقت كل مرحلة هي إدارة آخر تحويل قبلها، لا الإدارة الحالية.
  let deptAt=transfers.length?db.prepare('SELECT from_department_id FROM request_transfers WHERE request_id=? ORDER BY created_at LIMIT 1').get(r.id).from_department_id:department;
  for(const mark of marks){
    if(current)push(label(current.kind,deptAt),'execution',current.from,mark.created_at,{stage:current.kind});
    if(mark.action==='claim'||mark.action==='request.reassigned')current={kind:'work',from:mark.created_at};
    // إلغاء الإسناد ومغادرة المنفّذ يعيدان الطلب إلى الطابور؛ التجاوز يعيده إلى الطابور أو إلى منفّذ مسمّى (after_json.to_user_id).
    else if(mark.action==='request.released'||mark.action==='request.executor_departed')current={kind:'queue',from:mark.created_at};
    else if(mark.action==='request.assignment_overridden')current={kind:JSON.parse(mark.after_json||'{}').to_user_id?'work':'queue',from:mark.created_at};
    else if(mark.action==='request.transferred'){deptAt=transfers[transferIndex++]?.to_department_id??deptAt;current={kind:'queue',from:mark.created_at};}
    else if(mark.action==='request.reopened')current={kind:'rework',from:mark.created_at};
    else current=null;
  }
  if(current&&!CLOSED.includes(r.status))push(label(current.kind,deptAt),'execution',current.from,null,{stage:current.kind});
  return rows;
}

function enrich(db,r,row,service){
  const after=JSON.parse(row.after_json||'{}'),before=JSON.parse(row.before_json||'{}');
  if(row.action==='request.transferred')
    return `من ${departmentName(db,r.tenant_id,before.department_id)} إلى ${departmentName(db,r.tenant_id,after.department_id)}`;
  if(row.action==='request.closed')return after.delivered?`ما سُلِّم: ${after.delivered}`:'';
  if(row.action==='request.reopened')return after.round?`الجولة ${after.round}`:'';
  if(['approve','return','reject'].includes(row.action)){
    const step=db.prepare('SELECT position FROM approval_steps WHERE request_id=? AND decided_at=? LIMIT 1').get(r.id,row.created_at);
    return step?`خطوة: ${stepLabel(service,step.position)}`:'';
  }
  if(row.action==='attachment_added')return after.filename?`الملف: ${after.filename}`:'';
  const name=id=>id?db.prepare('SELECT name FROM users WHERE id=? AND tenant_id=?').get(id,r.tenant_id)?.name??'':'';
  if(row.action==='approval.escalated')return `من ${name(after.from_user_id)} إلى ${name(after.to_user_id)} — ${ESCALATION_BASIS[after.basis]??after.basis}`;
  if(row.action==='request.reassigned'||row.action==='request.assignment_overridden')return after.to_user_id?`إلى ${name(after.to_user_id)}`:'إلى طابور الإدارة';
  if(row.action==='request.lapsed')return after.waited_days?`انتظر ردّ صاحبه ${after.waited_days} يوم عمل، والمهلة المعتمدة ${after.timer_value}`:'';
  return '';
}

// عزل صاحب الطلب: يرى القرار وسببه الموجّه إليه، ولا يرى مداولة داخلية بين المنفذين.
// سبب الإرجاع والرفض مكتوب له فيراه؛ وملاحظة الاعتماد وسبب التحويل الداخلي ومداولات المهام ليست له.
function events(db,u,r,service,requesterView){
  const rows=db.prepare(`SELECT a.seq,a.action,a.reason,a.created_at,a.before_json,a.after_json,a.actor_id,x.name AS actor_name
      FROM audit_events a JOIN users x ON x.id=a.actor_id
      WHERE a.tenant_id=? AND a.entity_type='request' AND a.entity_id=? ORDER BY a.seq`).all(r.tenant_id,r.id);
  return rows.flatMap(row=>{
    const spec=ACTIONS[row.action];
    if(!spec)return [];
    if(requesterView&&spec.internal&&row.actor_id!==u.id)return [];
    const hideNote=requesterView&&spec.note_internal&&row.actor_id!==u.id;
    // ما فعله التشغيل اليومي يُسجَّل باسم صاحب مهمته (سجل التدقيق يشترط فاعلًا)، ويُعرض باسمه الحقيقي: الآلة لا الإنسان.
    const automatic=JSON.parse(row.after_json||'{}').by==='workflow-sweep';
    return [{seq:row.seq,at:row.created_at,on:riyadhDate(row.created_at),action:row.action,
      actor_name:automatic?'التشغيل اليومي (آليًا، بمهلة معتمدة)':row.actor_name,text:spec.text,detail:enrich(db,r,row,service),
      reason:hideNote?'':row.reason,reason_withheld:hideNote&&!!row.reason}];
  });
}

// «الخطوة التالية» بصيغة صريحة: عند من الطلب، وما القرار المنتظر، ومتى يُتوقع، وماذا يفعل صاحبه إن تأخر.
// الموظف الذي يعرف أين طلبه لا يفتح طلبًا ثانيًا ولا يتصل بالإدارة.
export function nextStep(db,u,r,service=serviceOf(db,r),clock=serviceClock(db,r)){
  const mine=r.requester_id===u.id,available=requestActions(db,u,r);
  const department=departmentName(db,r.tenant_id,handlingDepartment(db,r));
  const base={with:'',awaiting:'',expected_on:null,expectation_note:'',paused:false,you_can:[],clock};
  if(r.status==='draft')return {...base,with:'صاحب الطلب',awaiting:'لم يُقدَّم بعد',paused:true,
    expectation_note:'لا موعد متوقع: الطلب مسودة لم تُقدَّم، والساعة لم تبدأ.',you_can:mine?['أكمل الحقول الناقصة ثم قدّم الطلب.']:[]};
  if(r.status==='returned')return {...base,with:'صاحب الطلب',awaiting:'استكمال ما طُلب منك ثم إعادة التقديم',paused:true,
    // العمر يبقى ولو توقفت الساعة، والانقضاء يُقال كما هو: بمهلته المعتمدة، أو «غير متاح» حين لا مهلة.
    waiting_days:clock.paused_days??null,lapse_note:returnedLapseNote(db,r,clock),
    expectation_note:'الساعة متوقفة عندك: لا يُعطى تاريخ متوقع ما دام الطلب ينتظر ردك، ولا تُحتسب هذه المدة على الإدارة.',
    you_can:mine?['اقرأ سبب الإرجاع أعلاه، عدّل الطلب، ثم أعد تقديمه.']:[]};
  if(r.status==='rejected')return {...base,with:'—',awaiting:'انتهى الطلب بالرفض',
    expectation_note:'سبب الرفض مكتوب في آخر قرار على الخط الزمني.',you_can:mine?['تقديم طلب جديد يعالج سبب الرفض.']:[]};
  // المنقضي يُغلق «ملغى» لأن قائمة الحالات مغلقة؛ صفّه في request_lapses هو ما يقول إنه انقضى ولم يلغه صاحبه.
  if(r.status==='cancelled'&&lapseOf(db,r.id))return {...base,with:'—',awaiting:'انقضى لعدم الرد',
    expectation_note:'أُعيد الطلب إلى صاحبه وذُكِّر به ولم يُعد تقديمه خلال مهلة الانقضاء المعتمدة، فأُغلق. لم يلغه أحد بيده.',you_can:mine?['أعد تقديمه من هذا الطلب: تُنسخ بياناته إلى مسودة جديدة باسمك، ويبقى الطلب المنقضي مغلقًا بسجله. المرفقات لا تُنسخ.']:[]};
  if(r.status==='cancelled')return {...base,with:'—',awaiting:'ألغي الطلب'};
  if(r.status==='completed')return {...base,with:'—',awaiting:'أُغلق الطلب بعد التنفيذ',
    you_can:mine?['إن لم يُنجز الطلب حاجتك فاطلب إعادة فتحه خلال المهلة المعلنة، أو أجب عن سؤال التجربة.']:[]};

  if(r.status==='pending'){
    // الاسم اسم من يملك القرار الآن: معتمد الخطوة، أو من نُقل إليه قرارها (deciderOf).
    const pending=db.prepare(`SELECT s.id,s.position,s.approver_id FROM approval_steps s
      WHERE s.request_id=? AND s.revision=? AND s.status='pending' ORDER BY s.position`).all(r.id,r.revision)
      .map(s=>{const holder=deciderOf(db,s);return {...s,moved:holder!==s.approver_id,approver_name:db.prepare('SELECT name FROM users WHERE id=?').get(holder)?.name??''};});
    const parallel=service.approval_policy.mode==='parallel';
    const waiting=parallel?pending:pending.slice(0,1);
    const you=[];
    if(available.includes('escalate'))you.push('مضى أكثر من يوم على وصول الطلب للمعتمد: بإمكانك إرسال متابعة واحدة له بزر «تذكير المعتمد». التذكير لا ينقل القرار إلى غيره.');
    else if(mine)you.push('«تذكير المعتمد» يُتاح بعد مضي يوم كامل على وصول الطلب لصاحب القرار الحالي.');
    if(mine&&clock.overdue)you.push('تجاوز الطلب زمنه المستهدف: المتابعة مسجّلة في سجل التدقيق، وتظهر لمدير الإدارة في لوحة المدد.');
    return {...base,with:waiting.map(s=>`${stepLabel(service,s.position)} — ${s.approver_name}${s.moved?' (نُقل إليه القرار)':''}`).join(' و ')||'معتمد لم يُحدَّد',
      awaiting:'قرار اعتماد: اعتماد أو إعادة للاستكمال أو رفض',
      expected_on:clock.due_on,paused:!!clock.paused,
      expectation_note:expectation(clock),you_can:you};
  }
  const you=mine?['التنفيذ جارٍ لدى الإدارة المنفذة. إن تأخر عن التاريخ المتوقع فتابعه مع الإدارة، ولا تفتح طلبًا ثانيًا لنفس الحاجة.']:[];
  return {...base,with:`الإدارة المنفذة — ${department}`,
    awaiting:r.status==='approved'?'مباشرة التنفيذ من الإدارة المنفذة':'إنجاز العمل وإغلاق الطلب بوصف ما سُلِّم',
    expected_on:clock.due_on,paused:!!clock.paused,expectation_note:expectation(clock),you_can:you};
}

// الصدق في التوقع: لا تاريخ حين لا يوجد ما يُبنى عليه تاريخ، ولا وعدٌ يُنسب إلى من لم يقطعه.
// التاريخ المتوقع كله مبنيٌّ على زمن الخدمة المستهدف؛ فحين يكون ذلك الزمن مشتقًا من بادئة الرمز ولم يتبنَّه أحد،
// يُقال ذلك في الجملة نفسها التي تعطي التاريخ، لا في حاشية تحتها (app/service-target.mjs).
const targetSource=clock=>clock.target&&clock.target.kind!=='unset'&&!clock.target.adopted?` هذا الزمن ${clock.target.note}.`:'';
function expectation(clock){
  if(clock.paused)return 'الساعة متوقفة لانتظار صاحب الطلب: لا يُعطى تاريخ متوقع، ولا تُحتسب هذه المدة على الإدارة.';
  if(!clock.target_days)return 'لا زمن مستهدف معتمد لهذه الخدمة بعد، فلا تاريخ متوقع. الزمن المستهدف يضعه مالك الإجراء في دليل الخدمات.';
  if(clock.overdue)return `تجاوز الطلب زمنه المستهدف (${clock.target_days} أيام عمل) بـ${Math.abs(clock.days_left)} يوم عمل. لا يُعطى تاريخ جديد ما لم تلتزم به الإدارة المنفذة.`+targetSource(clock);
  return `التاريخ المتوقع محسوب بأيام العمل (الأحد–الخميس دون العطل المعتمدة) من زمن الخدمة المستهدف: ${clock.target_days} أيام عمل.`+targetSource(clock);
}

// «أين طلبي» — خطّ المحطّات الخمس (مركز الخدمات، الدفعة الثالثة): محطّاتٌ ثابتة يراها صاحب الطلب قبل أن يبدأ الطلب
// وبعده، وتحت كلِّ محطّةٍ مرّت تاريخُها. اشتقاقٌ من الحالة وخطوات الاعتماد وسجل التدقيق — المصادر نفسها التي يُبنى
// منها المكوث — لا جدولٌ جديد ولا حالة مخزَّنة. والمرحلة (stageOf من القاموس) طبقةٌ فوق الحالة لا بديلٌ عنها:
//   • «قُدّم»: لحظة أول نسخة مقدَّمة (request_versions). المسودة لم تبلغها.
//   • «بانتظار الاعتماد»: تُبلَغ مع التقديم حين للخدمة خطوات؛ والمسار المباشر يعبرها بلا انتظار فتُعلَّم skipped.
//   • «معتمد»: آخر قرار على خطوات النسخة الأخيرة حين اعتُمدت كلها؛ والمباشر يبلغها لحظة التقديم.
//   • «قيد التنفيذ»: أول مباشرة (claim) بعد الاعتماد. • «مكتمل»: إغلاق الطلب.
// الطلب الذي خرج عن الخطّ (معاد، مرفوض، ملغى) لا يُخفى خروجُه: المحطّة التي توقّف عندها تُعلَّم بكلمة مرحلته
// (ended/held)، والمحطّات بعدها تبقى مرسومةً غير مبلوغة — فيرى صاحبه أين كان وأين وقف، لا خطًّا يكذب باكتماله.
export function stations(db,r,stage=stageOf(r.status,{lapsed:r.status==='cancelled'&&!!lapseOf(db,r.id)})){
  const service=serviceOf(db,r);
  const submittedAt=db.prepare('SELECT MIN(created_at) AS at FROM request_versions WHERE request_id=?').get(r.id)?.at??null;
  const finalSteps=db.prepare('SELECT status,decided_at FROM approval_steps WHERE request_id=? AND revision=? ORDER BY position').all(r.id,r.revision);
  const direct=service.approval_policy?.mode==='direct'&&!finalSteps.length;
  const approvedAt=submittedAt&&(direct?submittedAt:finalSteps.length&&finalSteps.every(s=>s.status==='approved')?finalSteps.map(s=>s.decided_at).sort().at(-1):null);
  const mark=action=>approvedAt?db.prepare(`SELECT MIN(created_at) AS at FROM audit_events WHERE tenant_id=? AND entity_type='request' AND entity_id=? AND action=? AND created_at>=?`).get(r.tenant_id,r.id,action,approvedAt)?.at??null:null;
  const executingAt=['in_progress','completed'].includes(r.status)?mark('claim')??approvedAt:null;
  const completedAt=r.status==='completed'?db.prepare('SELECT MAX(closed_at) AS at FROM request_closures WHERE request_id=?').get(r.id)?.at??mark('complete')??r.updated_at:null;
  const reached={submitted:submittedAt,awaiting:direct?null:submittedAt,approved:approvedAt,executing:executingAt,completed:completedAt};
  // المحطّة الحالية بحسب الحالة: المعاد ينتظر عند «بانتظار الاعتماد» موقوفًا عند صاحبه، والمرفوض والملغى يقفان عند آخر محطّة بلغاها.
  const current={pending:'awaiting',returned:'awaiting',approved:'approved',in_progress:'executing'}[r.status]??null;
  const last=[...TIMELINE_STATIONS].reverse().find(key=>reached[key])??null;
  const ended=['rejected','cancelled'].includes(r.status)?(last??'submitted'):null;
  return TIMELINE_STATIONS.map((key,index)=>({key,name:stationName(key),position:index+1,of:TIMELINE_STATIONS.length,
    reached_at:reached[key]?String(reached[key]).slice(0,10):null,
    current:key===current,held:key===current&&stage.stage==='needs_you',ended:key===ended,
    skipped:key==='awaiting'&&direct&&!!submittedAt,
    // كلمة المرحلة تُطبع على المحطّة حين تخالف اسمها: «ينتظر ردك» على «بانتظار الاعتماد»، و«مرفوض» حيث توقّف الطلب.
    stage:key===current&&stage.stage==='needs_you'||key===ended?stage.name_ar:null}));
}

// «عند من الآن وبأي مرحلة»: ما يُقال في رسالة التأكيد بعد الحفظ والتقديم، من الحمولة لا من نصٍّ في الشاشة.
export function whereabouts(db,supplied,requestId){
  const u=actor(db,supplied),r=getRequest(db,u,requestId);
  const stage=stageOf(r.status,{lapsed:r.status==='cancelled'&&!!lapseOf(db,r.id)}),step=nextStep(db,u,r);
  return {stage:stage.stage,stage_name:stage.name_ar,stage_name_en:stage.name_en,with:step.with,awaiting:step.awaiting};
}

export function timeline(db,supplied,requestId){
  const u=actor(db,supplied),r=getRequest(db,u,requestId),service=serviceOf(db,r);
  const requesterView=r.requester_id===u.id;
  const holidays=holidaySet(db,r.tenant_id),clock=serviceClock(db,r);
  const stages=dwellStages(db,r,holidays);
  const closures=db.prepare('SELECT c.round,c.delivered,c.closed_at,x.name AS closed_by_name FROM request_closures c JOIN users x ON x.id=c.closed_by WHERE c.request_id=? ORDER BY c.round').all(r.id);
  const reopenings=db.prepare('SELECT round,reason,created_at,deadline_on FROM request_reopenings WHERE request_id=? ORDER BY round').all(r.id);
  const stage=stageOf(r.status,{lapsed:r.status==='cancelled'&&!!lapseOf(db,r.id)});
  return {
    request:{id:r.id,title:r.title,status:r.status,version:r.version,revision:r.revision,service:service.name_ar,service_code:service.code,
      department:departmentName(db,r.tenant_id,handlingDepartment(db,r)),created_at:r.created_at},
    // مرحلة الطالب وخطّ المحطّات: من القاموس والمصادر نفسها، ولا كلمة حالة تُكتب في الشاشة.
    stage:{key:stage.stage,name:stage.name_ar,name_en:stage.name_en,module_phrase:stage.module_phrase},
    stations:stations(db,r,stage),
    events:events(db,u,r,service,requesterView),
    stages,
    // المجموع عند كل طرف: هنا يظهر الاختناق الحقيقي بدل الانطباع.
    dwell_by_party:Object.values(stages.reduce((sum,s)=>{
      const key=s.party;(sum[key]??={party:key,kind:s.kind,working_days:0,hours:0,segments:0,paused:s.paused});
      sum[key].working_days+=s.working_days;sum[key].hours=Math.round((sum[key].hours+s.hours)*10)/10;sum[key].segments++;return sum;},{})),
    next_step:nextStep(db,u,r,service,clock),
    rounds:{closures,reopenings,delivered_first_time:reopenings.length===0&&r.status==='completed'},
    viewer:{requester:requesterView,sees_internal:!requesterView},
    note:requesterView
      ?'هذا سجل طلبك كاملًا بوقته وأصحابه. المداولات الداخلية بين المنفذين لا تظهر هنا؛ يظهر القرار وسببه المكتوب لك. زمن انتظارك أنت لا يُحتسب على الإدارة.'
      :'سرد واحد من سجل التدقيق وخطوات الاعتماد والنسخ والتحويلات والمهام والمرفقات. زمن المكوث بأيام العمل، ومدة انتظار صاحب الطلب معلَّمة «الساعة متوقفة» لأنها لا تُحتسب على أحد.'
  };
}

// لوحة «أين طلباتي»: الخطوة التالية لكل طلب مفتوح دفعة واحدة، فلا يحتاج الموظف أن يفتح كل طلب ليعرف.
export function myTimelineBoard(db,supplied){
  const u=actor(db,supplied),all=listRequests(db,u);
  const mine=all.filter(row=>row.requester_id===u.id);
  const rows=mine.map(row=>{
    const r=getRequest(db,u,row.id),service=serviceOf(db,r);
    const clock=serviceClock(db,r);
    const step=nextStep(db,u,r,service,clock);
    const closure=r.status==='completed'?closureView(db,u,r.id):null;
    const available=['view_timeline'];
    if(closure?.reopen.available)available.push('reopen');
    if(r.status==='completed'&&feedbackView(db,u,r.id).can_rate)available.push('answer');
    const stage=stageOf(r.status,{lapsed:r.status==='cancelled'&&!!lapseOf(db,r.id)});
    return {id:r.id,title:r.title,status:r.status,version:r.version,service:service.name_ar,updated_at:r.updated_at,
      stage:stage.stage,stage_name:stage.name_ar,stage_phrase:stage.module_phrase,
      with:step.with,awaiting:step.awaiting,expected_on:step.expected_on,paused:step.paused,
      expectation_note:step.expectation_note,you_can:step.you_can,overdue:!!clock.overdue,target_days:clock.target_days,target:clock.target??null,
      reopened_rounds:closure?.reopenings.length??db.prepare('SELECT COUNT(*) AS n FROM request_reopenings WHERE request_id=?').get(r.id).n,
      reopen_deadline:closure?.reopen.available?closure.reopen.deadline_on:null,reopen_why:closure&&!closure.reopen.available?closure.reopen.why:'',actions:available};
  });
  // لمن يباشر التنفيذ: الطلبات الجاهزة للإغلاق، ليُغلقها بوصف ما سُلِّم لا بكلمة.
  const closable=all.filter(row=>row.requester_id!==u.id&&row.status==='in_progress').map(row=>getRequest(db,u,row.id))
    .filter(r=>requestActions(db,u,r).includes('complete')).map(r=>({id:r.id,title:r.title,version:r.version,service:serviceOf(db,r).name_ar,
      round:db.prepare('SELECT COUNT(*) AS n FROM request_closures WHERE request_id=?').get(r.id).n+1,actions:['view_timeline','close_with_evidence']}));
  return {rows,closable,open:rows.filter(x=>!CLOSED.includes(x.status)).length,waiting_on_me:rows.filter(x=>x.paused&&['draft','returned'].includes(x.status)).length,
    note:'لكل طلب سطر واحد يقول عند من هو الآن وما القرار المنتظر ومتى يُتوقع. حين تكون الساعة متوقفة عندك لا يُعرض تاريخ متوقع، لأن إعطاء تاريخ لا يملكه أحد أسوأ من عدم إعطائه.'};
}
