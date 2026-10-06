import { actorOrRefuse } from './refusal.mjs';
import { REQUEST_STATUS,MODULE_STATUS_MAP,canonicalStatus,stageOf,LAPSED_PHRASE } from './static/vocabulary.mjs';
import { listRequests } from './workflow.mjs';
import { serviceClock } from './routing.mjs';
import { listLeave } from './leave.mjs';
import { expensesBoard } from './expenses.mjs';
import { lettersBoard } from './letters.mjs';
import { hrCasesBoard } from './hr-cases.mjs';
import { attendanceExtras } from './attendance-extras.mjs';
import { growthBoard } from './talent.mjs';
import { resignationsBoard } from './resignations.mjs';
import { travelBoard } from './travel.mjs';
import { myBenefits } from './benefits-portal.mjs';
import { mySettlement } from './payroll-extras.mjs';
import { lapseOf } from './returned-requests.mjs';

// «طلباتي» (G5): كل ما قدّمه الموظف بنفسه في مكان واحد — طلبات الدليل والإجازات والمصروفات والعهد والخطابات
// وحالات الموارد البشرية وتصحيحات الحضور والعمل الإضافي والمهمات والتدريب.
// القاعدة: كل مصدر يُقرأ بدالة وحدته وبهوية المستخدم نفسه، فتبقى قواعد الرؤية قواعد الوحدة، ثم يُبقى منه ما صاحبه هذا المستخدم فقط.
// المدير يرى في لوحات وحداته طلبات فريقه؛ هنا لا يرى إلا طلباته هو. لا وسيط user_id: الصفحة لصاحبها وحده.
const today=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Riyadh',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const riyadhDay=iso=>iso?new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Riyadh',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(iso)):null;
// الحالة الموحدة: كلمات الحالة نفسها في كل الوحدات، مع اسم الوحدة الأصلي بجوارها. الكلمات من القاموس الواحد (app/static/vocabulary.mjs)
// لا من نسخة هنا، ومطابقة حالة كل وحدة على الحالات الثماني من MODULE_STATUS_MAP فيه. الاسم STATUS_WORDS باقٍ لأن الحمولة تحمله (status_words).
export const STATUS_WORDS=REQUEST_STATUS;
const unified=(module,status)=>canonicalStatus(module,status).status;
const CLOSED=new Set(['completed','rejected','cancelled']);
export const SOURCES={
  catalog:['طلب خدمة','Service request'],leave:['إجازة','Leave'],expense:['مطالبة مصروف','Expense claim'],custody:['عهدة نقدية','Cash custody'],
  letter:['خطاب','Letter'],hr_case:['حالة موارد بشرية','HR case'],attendance_correction:['تصحيح حضور','Attendance correction'],
  overtime:['عمل إضافي','Overtime'],mission:['مهمة عمل','Work mission'],training:['تدريب','Training'],
  // ترحيل 102 و103 (فجوة تسليم الدمج §5): الاستقالة والانتداب وطلبات المزايا كانت خارج القائمة.
  resignation:['استقالة','Resignation'],travel:['انتداب','Business travel'],benefit:['طلب مزايا','Benefit request'],
  // D-15 (تدقيق مسارات الوحدات، 20 سبتمبر): تسوية نهاية الخدمة لم تكن تظهر لصاحبها في أي قائمة.
  settlement:['تسوية نهاية الخدمة','End-of-service settlement']
};
const actor=actorOrRefuse;

function item(source,{id,title,status,module_status,created_at,updated_at,due_on=null,overdue=false,link,needs_you=false,due_note='',lapsed=false}){
  // مرحلة الطالب (القاموس، stageOf): طبقةٌ ثالثة فوق حالة الوحدة والحالة الموحدة، تُجمَّع بها القائمة ولا تستبدل الشارة.
  const stage=stageOf(status,{lapsed});
  return {key:`${source}:${id}`,source,source_name:SOURCES[source][0],source_name_en:SOURCES[source][1],id,title,status,status_name:STATUS_WORDS[status]?.[0]??status,status_name_en:STATUS_WORDS[status]?.[1]??status,
    stage:stage.stage,stage_name:stage.name_ar,stage_name_en:stage.name_en,
    module_status:module_status??null,open:!CLOSED.has(status),needs_you:!!needs_you,created_at:created_at??null,updated_at:updated_at??created_at??null,
    // «يستحق في…» تاريخٌ يقرؤه صاحب الطلب وعدًا. due_note يقول من قطع الوعد، أو أن أحدًا لم يقطعه (app/service-target.mjs).
    submitted_on:riyadhDay(created_at),due_on,due_note,overdue:!!overdue,link};
}

export function myRequests(db,supplied){
  const u=actor(db,supplied),day=today(),items=[],unavailable=[];
  // مصدر لا تفتحه صلاحية الحساب (مثل الأدمن في شاشات الموظفين) يُذكر اسمه ولا يُحتسب.
  const read=(source,load)=>{try{return load();}catch(error){if(error.status===403||error.status===404){unavailable.push(source);return null;}throw error;}};

  // 1. طلبات الدليل: ما صاحبه هذا المستخدم من قائمة الطلبات التي يراها. زمن الخدمة من ساعة الطلب نفسها.
  for(const r of listRequests(db,u,'','').filter(r=>r.requester_id===u.id)){
    const raw=db.prepare('SELECT * FROM requests WHERE id=? AND tenant_id=?').get(r.id,u.tenant_id);
    let clock=null;try{clock=raw?serviceClock(db,raw):null;}catch{clock=null;}
    // المنقضي لعدم الرد حالته «ملغى» (القائمة مغلقة)؛ يُقال بجانب اسم خدمته إنه انقضى، فلا يظنه صاحبه إلغاءً بيد أحد.
    // العبارة من القاموس (LAPSED_PHRASE) لا نصًّا هنا: هي عبارة الوحدة لمرحلة «ملغى» في stageOf، والبايتات كما كانت.
    const lapsed=r.status==='cancelled'&&!!lapseOf(db,r.id);
    items.push(item('catalog',{id:r.id,title:r.title,status:r.status,module_status:lapsed?`${r.service_name} · ${LAPSED_PHRASE}`:r.service_name,created_at:r.created_at,updated_at:r.updated_at,
      due_on:!CLOSED.has(r.status)&&clock?.due_on?clock.due_on:null,overdue:!CLOSED.has(r.status)&&!!clock?.overdue,
      due_note:clock?.target&&clock.target.kind!=='unset'?clock.target.label:'',
      link:`#request/${r.id}`,needs_you:stageOf(r.status).stage==='needs_you',lapsed}));
  }
  // 2. الإجازات: من listLeave بصلاحية المستخدم، ثم ما هو موظفه.
  const leave=read('leave',()=>listLeave(db,u));
  for(const r of leave?.requests?.filter(r=>r.employee_id===u.id)??[]){
    // الإجازة المعتمدة التي لم تنتهِ بعد تبقى «مفتوحة» في نظر الموظف؛ بعد آخر يوم منها تُعد مكتملة.
    const status=r.status==='approved'&&r.end_date<day?'completed':unified('leave',r.status);
    items.push(item('leave',{id:r.id,title:`${r.leave_type_name} · ${r.start_date} — ${r.end_date} (${r.days})`,status,module_status:MODULE_STATUS_MAP.leave[r.status]?.phrase??r.status,
      created_at:r.created_at,updated_at:r.updated_at,link:'#leave',needs_you:r.status==='returned'}));
  }
  // 3. المصروفات والعهد
  const expenses=read('expenses',()=>expensesBoard(db,u));
  for(const c of expenses?.claims?.filter(c=>c.own)??[])
    items.push(item('expense',{id:c.id,title:`${c.category_name} · ${c.expense_date??''}`.trim(),status:c.status==='finance_approved'&&c.custody_id?'completed':unified('expense',c.status),module_status:c.status_name,created_at:c.created_at,updated_at:c.updated_at,link:'#expenses'}));
  for(const c of expenses?.custodies?.filter(c=>c.own)??[])
    items.push(item('custody',{id:c.id,title:c.purpose?`عهدة: ${c.purpose}`:'عهدة نقدية',status:unified('custody',c.status),module_status:c.status_name,created_at:c.created_at,updated_at:c.updated_at,link:'#expenses'}));
  // 4. الخطابات
  const letters=read('letters',()=>lettersBoard(db,u));
  for(const r of letters?.requests?.filter(r=>r.own)??[])
    items.push(item('letter',{id:r.id,title:r.type_name,status:unified('letter',r.status),module_status:r.status_name,created_at:r.created_at,updated_at:r.created_at,link:'#letters'}));
  // 5. حالات الموارد البشرية: ما رفعه هو فقط (my_cases). البلاغ المجهول لا يُربط بحسابه فلا يظهر هنا أبدًا.
  const cases=read('hr_cases',()=>hrCasesBoard(db,u));
  for(const c of cases?.my_cases??[])
    items.push(item('hr_case',{id:c.id,title:c.subject?`${c.category_name}: ${c.subject}`:c.category_name,status:unified('hr_case',c.status),module_status:c.status_name,created_at:c.filed_on,updated_at:c.closed_on??c.filed_on,
      due_on:c.status!=='closed'?c.target_due_on??null:null,overdue:!!c.overdue,link:'#hr-cases'}));
  // 6. تصحيحات الحضور: الشرط الأول في رؤية وحدة الحضور هو «صاحب التصحيح» (attendance.mjs attendanceBoard)، فيُقرأ صفه هو مباشرة
  //    بدل بناء لوحة الحضور كاملة (التي تحسب لموظف الموارد البشرية أيام الشركة كلها).
  if(u.role!=='admin'){
    for(const c of db.prepare('SELECT * FROM attendance_corrections WHERE tenant_id=? AND user_id=? ORDER BY created_at DESC LIMIT 100').all(u.tenant_id,u.id))
      items.push(item('attendance_correction',{id:c.id,title:`تصحيح يوم ${c.work_date}`,status:unified('attendance_correction',c.status),module_status:null,created_at:c.created_at,updated_at:c.decided_at??c.created_at,link:'#attendance'}));
  }else unavailable.push('attendance');
  // 7. العمل الإضافي والمهمات من لوحة ملحقات الحضور.
  const extras=read('attendance_extras',()=>attendanceExtras(db,u));
  for(const o of extras?.overtime?.filter(o=>o.user_id===u.id)??[])
    items.push(item('overtime',{id:o.id,title:`${o.minutes} دقيقة يوم ${o.work_date}`,status:o.status,module_status:o.status_name,created_at:o.created_at,updated_at:o.decided_at??o.created_at,link:'#attendance'}));
  for(const m of extras?.missions?.filter(m=>m.user_id===u.id)??[])
    items.push(item('mission',{id:m.id,title:`${m.destination??'مهمة عمل'} · ${m.from_date} — ${m.to_date}`,status:m.status,module_status:m.status_name,created_at:m.created_at,updated_at:m.decided_at??m.created_at,link:'#attendance'}));
  // 8. التدريب
  const growth=read('training',()=>growthBoard(db,u));
  for(const t of growth?.training?.filter(t=>t.own)??[])
    items.push(item('training',{id:t.id,title:t.title,status:unified('training',t.status),module_status:t.status_name,created_at:t.created_at,updated_at:t.decided_at??t.created_at,link:'#growth'}));

  // 9. الاستقالة (ترحيل 102): resignationsBoard يقرأ بصلاحية المستخدم — الموظف يرى استقالته والمخاطَب بها؛ هنا ما هو صاحبه فقط (own).
  const resignations=read('resignations',()=>resignationsBoard(db,u));
  for(const r of resignations?.resignations?.filter(r=>r.own)??[])
    items.push(item('resignation',{id:r.id,title:r.last_working_day?`استقالة — آخر يوم عمل ${r.last_working_day}`:`استقالة — آخر يوم مقترح ${r.proposed_last_day}`,
      status:unified('resignation',r.status),module_status:r.status_name,created_at:r.submitted_on,updated_at:r.accepted_on??r.submitted_on,
      // يوم القبول الحكمي موعد نظامي معلن (م34/1)، لا زمن خدمة، فيظهر موعدًا ولا يوصف بالتأخر.
      due_on:r.clock?.active?r.clock.deemed_on:null,link:'#resignations'}));
  // 10. الانتداب (ترحيل 102): قرار انتداب انتهت مدته يُعد مكتملًا كما تُعد الإجازة المنتهية مكتملة.
  const travel=read('travel',()=>travelBoard(db,u));
  for(const t of travel?.decisions?.filter(t=>t.own)??[])
    items.push(item('travel',{id:t.id,title:`${t.destination} · ${t.start_date} — ${t.end_date}`,
      status:t.status==='approved'&&t.end_date<day?'completed':unified('travel',t.status),module_status:t.status_name,
      created_at:t.created_at,updated_at:t.updated_at,link:'#travel'}));
  // 11. طلبات المزايا (ترحيل 103): myBenefits بلا معرّف موظف يقرأ طلبات صاحب الحساب وحده.
  //     العنوان اسم الخيار ومرجعه فقط: تفاصيل التابع (صلة القرابة وتاريخ الميلاد) لا تدخل قائمة عامة.
  const benefits=read('benefits',()=>myBenefits(db,u));
  for(const r of benefits?.requests??[])
    items.push(item('benefit',{id:r.id,title:`${r.option_name} — ${r.reference}`,status:unified('benefit',r.status),module_status:r.status_name,
      created_at:r.created_at,updated_at:r.updated_at,link:'#my-benefits'}));

  // 12. تسوية نهاية الخدمة (D-15): المعتمدة باسم صاحب الحساب وحده. تبقى «مفتوحة» حتى يُسجَّل صرف مستحقاتها،
  //     وموعدها هو المهلة النظامية (م50/2) — موعد نظامي معلن، فيوصف بالتأخر حين تمضي دون صرف.
  const settlement=read('settlement',()=>mySettlement(db,u));
  if(settlement)items.push(item('settlement',{id:settlement.id,title:`تسوية نهاية الخدمة — آخر يوم ${settlement.service_end}`,
    status:settlement.dues_paid_on?'completed':'approved',module_status:settlement.dues_paid_on?`صُرفت في ${settlement.dues_paid_on}`:'معتمدة — بانتظار صرف المستحقات',
    created_at:settlement.decided_at,updated_at:settlement.decided_at,
    due_on:settlement.dues_paid_on?null:settlement.dues_due_on,overdue:settlement.countdown?.state==='overdue',link:'#payroll'}));

  // الترتيب: ما ينتظرك أولًا، ثم المفتوح بأقرب موعد، ثم الأحدث تحديثًا.
  items.sort((a,b)=>Number(b.needs_you)-Number(a.needs_you)||Number(b.open)-Number(a.open)||Number(b.overdue)-Number(a.overdue)
    ||String(a.due_on??'9999').localeCompare(String(b.due_on??'9999'))||String(b.updated_at??'').localeCompare(String(a.updated_at??'')));
  const open=items.filter(i=>i.open);
  return {generated_at:new Date().toISOString(),today:day,user_id:u.id,items,unavailable,status_words:STATUS_WORDS,sources:SOURCES,
    counts:{all:items.length,open:open.length,needs_you:items.filter(i=>i.needs_you).length,overdue:open.filter(i=>i.overdue).length,closed:items.length-open.length},
    next_due:open.filter(i=>i.due_on).sort((a,b)=>a.due_on.localeCompare(b.due_on))[0]??null,
    note:'كل طلب يُفتح في شاشته. الموعد يظهر حيث حدد مالك الخدمة زمنًا مستهدفًا؛ الإجازات والمصروفات والخطابات بلا زمن مستهدف معتمد بعد.'};
}
