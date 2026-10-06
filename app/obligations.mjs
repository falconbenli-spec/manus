import { fail } from './auth.mjs';
import { currentUser } from './delegations.mjs';
import { listRequests, actions as requestActions, pendingStepsFor, deciderOf } from './workflow.mjs';
import { serviceClock, myTasks, handlingDepartment } from './routing.mjs';
import { holidaySet, workingDaysBetween, addWorkingDays, riyadhDate } from './work-calendar.mjs';
import { listProjects } from './projects.mjs';
import { listLeave } from './leave.mjs';
import { myDiscipline } from './discipline.mjs';
import { myRequests } from './my-requests.mjs';
import { reminderSettings } from './reminders.mjs';
import { walkBoards, labelFor } from './inbox.mjs';
import { actorOrRefuse } from './refusal.mjs';
import { returnedByMe } from './returned-requests.mjs';

// «ما عليّ» (الموجة 1): دالة واحدة تجيب عن «ما المطلوب مني اليوم؟»، ورقم واحد لكل سؤال.
// الرئيسية و«بانتظار قراري» و«العمل اليومي» وشارة القائمة وملخص المدير والتذكير اليومي كلها تقرأ من هنا، فلا تستطيع
// شاشتان أن تعطيا رقمين لسؤال واحد. ثلاث سلال:
//   أقرّر  decide  — ما ينتظر قراري: ماشي الصندوق (inbox.mjs، يقرأ كل لوحة بهوية المستخدم) + الطلبات التي خطوتها المعلقة عندي.
//   أجيب   respond — ما أُعيد إليّ أو طُلب فيه ردّي. استبيان الرضا وإعادة الفتح ومسوداتي اختيارية: لا تتأخر ولا تُعدّ.
//   أنفّذ  do      — مهام الطلبات والمشاريع (بلا سقف)، ومهامي الخاصة، وما أباشره أو ينتظر في طابور إدارتي، وحزم العمل،
//                    والتزامات القرارات، وخطوات رحلات الموظفين.
// ومعها قائمتان للمتابعة لا تُعدّان: «ما أتابعه» (طلباتي المفتوحة عند غيري)، و«أعدتُها وتنتظر» (ما أعدتُه إلى صاحبه ولم يرد).
// لا منطق صلاحيات هنا: ما يأتي من لوحة جاء بقواعد رؤيتها، وما يُقرأ مباشرة مقيّد بأنه يخص هذا الشخص نفسه (مكلَّفه، مالكه، صاحبه).
// كل بند رابطه إلى سجله لا إلى شاشته، وموعده من مصدره الحقيقي لا من «ثلاثة أيام» مسطّحة.

const text=value=>typeof value==='string'&&value?value:null;
const dayOf=value=>value?(/^\d{4}-\d{2}-\d{2}$/.test(value)?value:riyadhDate(value)):null;
const focus=(screen,id)=>`#${screen}?focus=${encodeURIComponent(id)}`;
// أفعال الرد: طُلب من الشخص شيء يخصه هو (إفادة، إقرار، رد، تقييم ذاتي، تأكيد مبلغ) لا قرار على سجل غيره.
const REPLY_ACTIONS=new Set(['answer_request','state_absence','acknowledge','submit_self','submit_360','consent_deduction','answer','reopen']);
// الاختياري: حق لا واجب. موظف اليوم الأول لا يصير «متأخرًا» لأن استبيانًا ينتظره.
const OPTIONAL_ACTIONS=new Set(['answer','reopen']);
const WAITING_NOTE={service_target:'الزمن المستهدف لخدمته',record_due_date:'موعد السجل نفسه',task_due_date:'موعد المهمة',working_days_waiting:'أيام عمل منذ وصوله إليك',optional:'اختياري: لا موعد له',none:'بلا موعد'};

// ── الزمن الصادق ──────────────────────────────────────────────────────────────
// ما له موعد حقيقي يُقاس به. وما لا موعد له يُقاس عمره بأيام العمل (الأحد–الخميس دون العطل المعتمدة) منذ وصل إلى الشخص،
// مقابل مدة الانتظار التي قررها المالك في إعداد التذكيرات. إن لم يحدد المالك مدة فلا يوصف بالتأخر ما لا موعد له.
function timing(ctx,{since,due_on=null,due_basis=null,overdue=null,optional=false,ages=true}){
  const start=dayOf(since),age=start?workingDaysBetween(start,ctx.day,ctx.holidays):null;
  if(optional)return {since:since??null,age_days:age,due_on:null,due_basis:'optional',overdue:false};
  if(due_on)return {since:since??null,age_days:age,due_on,due_basis,overdue:overdue??due_on<ctx.day};
  if(overdue!==null)return {since:since??null,age_days:age,due_on:null,due_basis,overdue};
  if(!ages||!start||!ctx.limit)return {since:since??null,age_days:age,due_on:null,due_basis:'none',overdue:false};
  return {since,age_days:age,due_on:addWorkingDays(start,ctx.limit,ctx.holidays),due_basis:'working_days_waiting',overdue:age>=ctx.limit};
}
// موعد الطلب من ساعة خدمته (routing.serviceClock): الهدف بالأيام أو بالساعات، وفترات الانتظار على صاحبه لا تُحتسب.
// خدمة بلا زمن مستهدف معتمد تعود إلى عمر الانتظار بأيام العمل.
function requestTiming(ctx,db,raw,since){
  let clock=null;try{clock=serviceClock(db,raw);}catch{clock=null;}
  if(clock&&(clock.target_days||clock.target_hours)&&!clock.paused){
    const unadopted=clock.target&&!clock.target.adopted&&clock.target.kind!=='unset';
    return {...timing(ctx,{since,due_on:clock.target_on??clock.due_on??null,due_basis:'service_target',overdue:!!clock.overdue}),clock,
      // due_adopted: هل تبنّى إنسانٌ هذا الزمن. العربية تقرأ السبب المكتوب، والإنجليزية تحتاج العلم نفسه
      // لتقول العبارة عندها — فالسبب نصٌّ عربيٌّ لا يُترجَم، والعَلَم يُقرأ في اللغتين.
      due_adopted:!unadopted,
      due_basis_name:unadopted?`${WAITING_NOTE.service_target} (${clock.target.note})`:WAITING_NOTE.service_target};
  }
  return {...timing(ctx,{since}),clock};
}
const nameOf=(db,ctx,id)=>{if(!id)return null;if(!ctx.names.has(id))ctx.names.set(id,db.prepare('SELECT name FROM users WHERE id=? AND tenant_id=?').get(id,ctx.tenant)?.name??null);return ctx.names.get(id);};
const departmentName=(db,ctx,id)=>id?db.prepare('SELECT name FROM departments WHERE id=? AND tenant_id=?').get(id,ctx.tenant)?.name??null:null;

function item(bucket,source,sourceName,fields,time){
  const optional=!!fields.optional;
  return {bucket,source,source_name:sourceName,kind:fields.kind??'',id:fields.id??'',title:fields.title,context:fields.context??'',link:fields.link,
    // سبب الموعد يُسمّى كما هو: «الزمن المستهدف لخدمته» صحيحة، لكنها تسكت عن أن الزمن مشتق لم يتبنّه أحد.
    // requestTiming يمرر الاسم كاملًا حين يكون كذلك، فلا يقرأ من في الصندوق موعدًا يظنه التزامًا.
    actions:fields.actions??[],action_keys:fields.action_keys??[],since:time.since,age_days:time.age_days,due_on:time.due_on,due_basis:time.due_basis,due_basis_name:time.due_basis_name??WAITING_NOTE[time.due_basis]??'',
    due_adopted:time.due_adopted!==false,
    overdue:optional?false:!!time.overdue,owner_of_record:fields.owner_of_record??null,unblocks:fields.unblocks??null,optional,...(fields.shared?{shared:true}:{})};
}

// ── أقرّر: الطلبات ─────────────────────────────────────────────────────────────
// عمر الانتظار من لحظة وصول الخطوة إلى هذا الشخص (workflow.stepArrivedAt) لا من updated_at: زر المتابعة يغيّر updated_at،
// فكانت مطاردة الاعتماد تصفّر العمر الذي يقيسه التذكير الآلي.
function requestDecisions(db,u,ctx,rows,raws){
  const out=[];
  for(const r of rows.filter(x=>x.needs_me)){
    const raw=raws(r.id);if(!raw)continue;
    const steps=pendingStepsFor(db,u,raw),since=steps.map(s=>s.arrived_at).sort()[0]??raw.created_at;
    // اسم الخطوة التالية اسم من يملك قرارها الآن (deciderOf): معتمدها، أو من نُقل إليه قرارها.
    const last=steps.at(-1),following=last?db.prepare("SELECT id,approver_id FROM approval_steps WHERE request_id=? AND revision=? AND status='pending' AND position>? ORDER BY position LIMIT 1").get(raw.id,raw.revision,last.position):null;
    const after=following?{name:nameOf(db,ctx,deciderOf(db,following))}:null;
    out.push(item('decide','requests','الطلبات',{kind:'طلب خدمة',id:r.id,title:r.title,context:r.service_name??'',link:`#request/${r.id}`,actions:['قرار على طلب'],action_keys:['approve','return','reject'],
      owner_of_record:nameOf(db,ctx,raw.requester_id),
      unblocks:after?`الخطوة التالية: ${after.name}`:`بدء التنفيذ لدى ${departmentName(db,ctx,handlingDepartment(db,raw))??'الإدارة المنفذة'}`},requestTiming(ctx,db,raw,since)));
  }
  return out;
}

// ── أقرّر وأجيب: ما يعرضه الماشي ──────────────────────────────────────────────
function walked(db,u,ctx,unavailable){
  const {groups,failed}=walkBoards(db,u);unavailable.push(...failed);
  const out=[];
  for(const g of groups)for(const i of g.items){
    const keys=i.action_keys??[],reply=keys.length>0&&keys.every(k=>REPLY_ACTIONS.has(k)),optional=keys.length>0&&keys.every(k=>OPTIONAL_ACTIONS.has(k));
    out.push(item(reply?'respond':'decide',g.key,g.name,{kind:i.kind,id:i.id,title:i.title,context:i.context,link:i.link,actions:i.actions,action_keys:keys,owner_of_record:i.person,optional},
      timing(ctx,{since:i.since,due_on:i.due_on,due_basis:i.due_on?'record_due_date':null,optional})));
  }
  return out;
}

// ── أجيب: ما أُعيد إليّ ومسوداتي ودفاعي المطلوب ─────────────────────────────────
function returnedToMe(db,u,ctx,rows,raws,unavailable){
  const out=[];
  for(const r of rows.filter(x=>x.requester_id===u.id&&['returned','draft'].includes(x.status))){
    const raw=raws(r.id);if(!raw)continue;
    if(r.status==='draft'){
      out.push(item('respond','requests','الطلبات',{kind:'مسودة طلب',id:r.id,title:r.title,context:r.service_name??'',link:`#request/${r.id}`,actions:['مسودة لم تُقدَّم'],action_keys:['submit'],owner_of_record:u.name,optional:true},
        timing(ctx,{since:raw.created_at,optional:true})));
      continue;
    }
    const returned=db.prepare("SELECT MAX(decided_at) AS at FROM approval_steps WHERE request_id=? AND revision=? AND status='returned'").get(raw.id,raw.revision)?.at;
    out.push(item('respond','requests','الطلبات',{kind:'طلب معاد للتعديل',id:r.id,title:r.title,context:r.service_name??'',link:`#request/${r.id}`,actions:['استكمال وإعادة تقديم'],action_keys:['edit','submit'],
      owner_of_record:u.name,unblocks:'يعود الطلب إلى مسار اعتماده؛ ساعته متوقفة ما دام عندك'},timing(ctx,{since:returned??raw.updated_at})));
  }
  let leave=null;try{leave=listLeave(db,u);}catch(error){if(!error.status)unavailable.push('الإجازات');}
  for(const r of leave?.requests?.filter(x=>x.employee_id===u.id&&x.status==='returned')??[]){
    const returned=db.prepare("SELECT MAX(created_at) AS at FROM leave_decisions WHERE request_id=? AND decision='return'").get(r.id)?.at;
    out.push(item('respond','leave','الإجازات',{kind:'إجازة معادة إليك',id:r.id,title:`${r.leave_type_name} · ${r.start_date} — ${r.end_date}`,link:focus('leave',r.id),actions:['تعديل وإعادة تقديم'],action_keys:['resubmit'],
      owner_of_record:u.name,unblocks:'تعود الإجازة إلى اعتمادها'},timing(ctx,{since:returned??r.updated_at})));
  }
  if(u.role!=='admin')for(const p of db.prepare("SELECT * FROM timesheet_periods WHERE tenant_id=? AND user_id=? AND status='returned' ORDER BY week_start").all(u.tenant_id,u.id))
    out.push(item('respond','timesheets','كشوف الوقت',{kind:'كشف وقت معاد للتعديل',id:p.id,title:`أسبوع ${p.week_start} — ${p.week_end}`,context:p.decision_note??'',link:focus('timesheets',p.id),actions:['تصحيح وإعادة إرسال'],action_keys:['submit_timesheet'],
      owner_of_record:u.name,unblocks:'اعتماد ساعات الأسبوع وما يُفوتر منها'},timing(ctx,{since:p.updated_at})));
  // دفاع مكتوب مطلوب في قضية عليّ: العنوان رقم القضية وحده، والموعد موعدها النظامي من الوحدة نفسها.
  if(u.role!=='admin'){
    let mine=null;try{mine=myDiscipline(db,u);}catch(error){if(!error.status)unavailable.push('مخالفاتي وجزاءاتي');}
    for(const c of mine?.cases?.filter(x=>(x.actions??[]).includes('submit_defence'))??[]){
      const due=(c.deadlines??[]).map(d=>d.due_on).sort()[0]??null;
      out.push(item('respond','my-discipline','مخالفاتي وجزاءاتي',{kind:'قضية عليك',id:c.id,title:`القضية ${c.reference}`,link:focus('my-discipline',c.id),actions:[labelFor('submit_defence')],action_keys:['submit_defence'],owner_of_record:u.name},
        timing(ctx,{since:c.discovered_on,due_on:due,due_basis:'record_due_date'})));
    }
  }
  return out;
}

// ── أنفّذ ─────────────────────────────────────────────────────────────────────
function work(db,u,ctx,rows,raws,projects){
  const out=[];
  for(const t of myTasks(db,u))
    out.push(item('do','request_tasks','مهام الطلبات',{kind:'مهمة في طلب',id:t.id,title:t.title,context:t.request_title,link:`#request/${t.request_id}?focus=${encodeURIComponent(t.id)}`,actions:['إنجاز المهمة بدليلها'],action_keys:['complete_task'],
      owner_of_record:nameOf(db,ctx,t.created_by),unblocks:`إغلاق الطلب «${t.request_title}»: لا يُغلق وفيه مهمة مفتوحة`},timing(ctx,{since:t.created_at,due_on:t.due_date,due_basis:'task_due_date'})));
  // ما أباشره أنا، وما ينتظر في طابور إدارتي ويستطيع أي منفذ فيها استلامه (shared). لحظة الوصول: الاستلام، أو آخر تحويل، أو آخر اعتماد.
  for(const r of rows.filter(x=>x.requester_id!==u.id&&['approved','in_progress'].includes(x.status))){
    const raw=raws(r.id);if(!raw)continue;
    const mine=raw.status==='in_progress'&&raw.assigned_to===u.id,claimable=raw.status==='approved'&&requestActions(db,u,raw).includes('claim');
    if(!mine&&!claimable)continue;
    const claimed=mine?db.prepare("SELECT MAX(created_at) AS at FROM audit_events WHERE tenant_id=? AND entity_type='request' AND entity_id=? AND action='claim'").get(raw.tenant_id,raw.id)?.at:null;
    const arrived=claimed??db.prepare('SELECT MAX(created_at) AS at FROM request_transfers WHERE request_id=?').get(raw.id)?.at
      ??db.prepare("SELECT MAX(decided_at) AS at FROM approval_steps WHERE request_id=? AND revision=? AND status='approved'").get(raw.id,raw.revision)?.at
      ??db.prepare('SELECT created_at AS at FROM request_versions WHERE request_id=? AND revision=?').get(raw.id,raw.revision)?.at??raw.created_at;
    out.push(item('do','requests','الطلبات',{kind:mine?'طلب تباشر تنفيذه':'طلب في طابور إدارتك',id:r.id,title:r.title,context:r.service_name??'',link:`#request/${r.id}`,
      actions:[mine?'إنجاز وإغلاق بوصف ما سُلِّم':'استلام التنفيذ'],action_keys:[mine?'complete':'claim'],owner_of_record:nameOf(db,ctx,raw.requester_id),unblocks:`تسليم الخدمة لصاحبها${nameOf(db,ctx,raw.requester_id)?`: ${nameOf(db,ctx,raw.requester_id)}`:''}`,shared:claimable},
      requestTiming(ctx,db,raw,arrived)));
  }
  for(const p of projects)for(const t of p.tasks.filter(x=>x.assignee_id===u.id&&x.status==='open'))
    out.push(item('do','projects','المشاريع والمهام',{kind:'مهمة مشروع',id:t.id,title:t.title,context:p.name,link:focus('projects',t.id),actions:['إنجاز المهمة بدليلها'],action_keys:['complete_task'],owner_of_record:nameOf(db,ctx,p.created_by)},
      timing(ctx,{since:t.created_at,due_on:t.due_date,due_basis:'task_due_date'})));
  // المهام الخاصة يضعها صاحبها لنفسه: ما له تاريخ يُقاس به، وما لا تاريخ له لا يتأخر — لا أحد ينتظره غيره.
  for(const t of db.prepare("SELECT * FROM personal_tasks WHERE tenant_id=? AND user_id=? AND status='open' ORDER BY list,sort_order,created_at").all(u.tenant_id,u.id))
    out.push(item('do','work','مهامي الخاصة',{kind:'مهمة خاصة',id:t.id,title:t.title,context:text(t.notes)??'',link:focus('work',t.id),actions:['إنجاز'],action_keys:['finish_task'],owner_of_record:u.name},
      timing(ctx,{since:t.created_at,due_on:t.due_date,due_basis:'task_due_date',ages:false})));
  for(const w of db.prepare("SELECT w.*,p.name AS project_name FROM work_packages w JOIN projects p ON p.id=w.project_id WHERE w.tenant_id=? AND w.lead_id=? AND w.status IN ('planned','active','blocked') ORDER BY w.planned_end").all(u.tenant_id,u.id))
    out.push(item('do','projects','المشاريع والمهام',{kind:'حزمة عمل تقودها',id:w.id,title:`${w.code} · ${w.title}`,context:[w.project_name,w.status==='blocked'?`متوقفة: ${w.status_note}`:''].filter(Boolean).join(' · '),
      link:focus('projects',w.project_id),actions:['تسليم الحزمة'],action_keys:['deliver_package'],owner_of_record:nameOf(db,ctx,w.created_by),unblocks:`مرحلة «${w.phase}» في ${w.project_name}`},
      timing(ctx,{since:w.created_at,due_on:w.planned_end,due_basis:'record_due_date'})));
  for(const c of db.prepare("SELECT * FROM governance_commitments WHERE tenant_id=? AND owner_id=? AND status='open' ORDER BY due_date").all(u.tenant_id,u.id))
    out.push(item('do','decisions','القرارات والالتزامات',{kind:'التزام ناشئ عن قرار',id:c.id,title:c.title,context:text(c.detail)??'',link:focus('decisions',c.id),actions:['توثيق التنفيذ'],action_keys:['record_execution'],owner_of_record:nameOf(db,ctx,c.created_by)},
      timing(ctx,{since:c.created_at,due_on:c.due_date,due_basis:'record_due_date'})));
  for(const s of db.prepare(`SELECT s.*,b.kind AS bundle_kind,x.name AS employee_name,(SELECT title FROM lifecycle_steps d WHERE d.id=s.depends_on AND d.status='open') AS blocked_by
      FROM lifecycle_steps s JOIN lifecycle_bundles b ON b.id=s.bundle_id JOIN users x ON x.id=s.employee_id
      WHERE s.tenant_id=? AND s.owner_id=? AND s.status='open' AND b.status='open' ORDER BY s.due_date`).all(u.tenant_id,u.id)){
    const waiting=db.prepare("SELECT title FROM lifecycle_steps WHERE depends_on=? AND status='open'").all(s.id).map(x=>x.title);
    out.push(item('do','lifecycle','حزم التعيين والمغادرة',{kind:s.bundle_kind==='offboarding'?'خطوة مغادرة':'خطوة تعيين',id:s.id,title:s.title,
      context:[s.employee_name,s.blocked_by?`تنتظر قبلها: ${s.blocked_by}`:''].filter(Boolean).join(' · '),link:focus('lifecycle',s.id),actions:['إغلاق الخطوة بدليلها'],action_keys:['close_step'],
      owner_of_record:s.employee_name,unblocks:waiting.length?`تنتظرها: ${waiting.join('، ')}`:null},timing(ctx,{since:s.created_at,due_on:s.due_date,due_basis:'record_due_date'})));
  }
  return out;
}

// ── ما أتابعه: طلباتي المفتوحة عند غيري ────────────────────────────────────────
// ليست التزامًا عليّ؛ تُعاد مع الدالة حتى تقرأ بطاقة «طلباتي المفتوحة» وقائمتها المصدر نفسه (كانت البطاقة 5 والقائمة 2).
function watchingList(db,u,rows,unavailable){
  let mine=null;try{mine=myRequests(db,u);}catch(error){if(!error.status)unavailable.push('طلباتي');}
  if(mine)return mine.items.filter(i=>i.open).map(i=>({source:i.source,kind:i.source_name,id:i.id,title:i.title,status:i.status,status_name:i.status_name,module_status:i.module_status,
    link:/[/?]/.test(i.link)?i.link:`${i.link}?focus=${encodeURIComponent(i.id)}`,since:i.created_at,updated_at:i.updated_at,due_on:i.due_on,overdue:i.overdue,needs_you:i.needs_you}));
  return rows.filter(r=>r.requester_id===u.id&&!['completed','rejected','cancelled'].includes(r.status)).map(r=>({source:'catalog',kind:'طلب خدمة',id:r.id,title:r.title,status:r.status,status_name:r.status,
    module_status:r.service_name,link:`#request/${r.id}`,since:r.created_at,updated_at:r.updated_at,due_on:null,overdue:false,needs_you:['draft','returned'].includes(r.status)}));
}

const ORDER={decide:0,respond:1,do:2};
const byUrgency=(a,b)=>ORDER[a.bucket]-ORDER[b.bucket]||Number(a.optional)-Number(b.optional)||Number(b.overdue)-Number(a.overdue)
  ||String(a.due_on??'9999').localeCompare(String(b.due_on??'9999'))||String(a.since??'9999').localeCompare(String(b.since??'9999'));

// options: requests/projects قوائم قرأها المستدعي بهوية المستخدم نفسه فلا تُقرأ مرتين؛ at لحظة القياس (التذكير اليومي يقيس بوقت مهمته)؛
// watching:false يتخطى «ما أتابعه» حين لا يحتاجه المستدعي (شارة القائمة والصندوق).
export function obligations(db,supplied,options={}){
  const u=actorOrRefuse(db,supplied);
  const at=options.at??Date.now(),unavailable=[];
  const ctx={day:riyadhDate(at),holidays:holidaySet(db,u.tenant_id),limit:reminderSettings(db,u.tenant_id).pending_approval_days??null,tenant:u.tenant_id,names:new Map()};
  // حساب إدارة المنصة لا يقرر طلبات الأعمال ولا ينفذها؛ يبقى له ما تعرضه عليه لوحات الإعداد.
  const staff=u.role!=='admin';
  const rows=staff?(options.requests??listRequests(db,u,'','')):[];
  const cache=new Map(),raws=id=>{if(!cache.has(id))cache.set(id,db.prepare('SELECT * FROM requests WHERE id=? AND tenant_id=?').get(id,u.tenant_id)??null);return cache.get(id);};
  let projects=options.projects??null;
  if(!projects&&staff)try{projects=listProjects(db,u);}catch(error){if(!error.status)unavailable.push('المشاريع');}
  const doing=staff?work(db,u,ctx,rows,raws,projects??[]):[];
  // التزام القرار المتأخر تعرضه لوحته «قرارًا» ويملكه صاحبه «تنفيذًا»: هو بند واحد، ومكانه «أنفّذ».
  const owned=new Set(doing.filter(i=>i.source==='decisions').map(i=>i.id));
  const items=[...(staff?requestDecisions(db,u,ctx,rows,raws):[]),...walked(db,u,ctx,unavailable).filter(i=>!(i.source==='decisions'&&owned.has(i.id))),
    ...(staff?returnedToMe(db,u,ctx,rows,raws,unavailable):[]),...doing].sort(byUrgency);
  const counted=items.filter(i=>!i.optional),count=bucket=>counted.filter(i=>i.bucket===bucket).length;
  return {user_id:u.id,generated_at:new Date(at).toISOString(),today:ctx.day,waiting_limit_days:ctx.limit,items,
    counts:{decide:count('decide'),respond:count('respond'),do:count('do'),late:counted.filter(i=>i.overdue).length},
    watching:options.watching===false?[]:watchingList(db,u,rows,unavailable),
    // ما أعدتُه وينتظر صاحبه (الموجة 2، العطب 4): يُتابَع ولا يُعدّ — الكرة عند صاحب الطلب، وهي معدودة عنده في «أجيب».
    returned_by_me:staff&&options.watching!==false?returnedByMe(db,u,at):[],unavailable:[...new Set(unavailable)],
    note:'كل بند يفتح سجله. ما له زمن خدمة أو موعد يُقاس به، وما عداه بأيام العمل منذ وصل إليك. الاختياري لا يتأخر ولا يُعدّ.'};
}
