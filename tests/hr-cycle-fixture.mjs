// عالم تجريبي واحد لدورة الموارد البشرية والرواتب (الحزمة 4، P4-HR-0): كيان مصطنع، وشهور يونيو ويوليو وأغسطس 2026.
// كل اسم وكل مبلغ وكل مستند هنا تجريبي — لا موظف حقيقي ولا راتب حقيقي ولا سياسة شركة.
//
// العالم يُبنى بالمسارات الحقيقية لا بإدخال الصفوف: السياسات يعدّها hr ويعتمدها hr-manager، والعقود بيدين، والغياب يُقترح
// ويُفاد عنه ويُعتمد، والإجازة تمر بالمدير ثم خدمات الموظف. الاستثناء الوحيد طلب المزايا المكتمل: سلسلته (التأمين الطبي،
// كتالوج المزايا، التأكيد المالي) خارج هذه الحزمة ويغطيها tests/benefits-portal.test.mjs، فيُكتب طلبٌ مكتمل ومقترح صرفه
// كما تتركهما تلك السلسلة، ثم يُسلَّم إلى المسير بـhandToPayroll الحقيقية.
//
// الأشخاص (كلهم تجريبيون):
//   employee   موظفة بعقد من 2025-01-01، إجمالي 10,000.00 (أساسي 8,000 + سكن 2,000)
//   outsider   موظف بعقد من 2025-06-01، إجمالي 8,000.00 (أساسي 6,000 + سكن 1,500 + نقل 500)
//   hr         مُعد الرواتب وموظف خدمات الموظف (دوره hr)
//   hr-manager مديرة رأس المال البشري: تعتمد السياسات والعقود والمسير والغياب، وتحمل «السجل الوظيفي» بمنح صريح
//   reviewer   مراجع الرواتب · approver-2 معتمد رواتب ثانٍ (لسباق الاعتماد)
import { randomUUID } from 'node:crypto';
import { openDb, transaction, now } from '../app/db.mjs';
import { seed } from '../scripts/seed.mjs';
import { grantAccess } from '../app/access.mjs';
import { preparePolicy, decidePolicy, prepareContract, contractAction, getContract } from '../app/hr-contracts.mjs';
import { prepareLeaveTypesDraft, decideLeaveTypes, createLeaveCalendar } from '../app/leave-types.mjs';
import { createLeaveRequest, leaveAction, getLeaveRequest } from '../app/leave.mjs';
import { proposeAbsence, stateAbsence, decideAbsence } from '../app/attendance.mjs';
import { createRequisition, addCandidate, peopleAction, completeOnboardingTask, peopleToday, getPeopleRecord } from '../app/people.mjs';
import { createAccount } from '../app/admin.mjs';
import { saveProfile } from '../app/employees.mjs';
import { getRun, prepareRun, runAction } from '../app/payroll.mjs';
import { proposeAdjustment, decideAdjustment } from '../app/payroll-extras.mjs';
import { handToPayroll } from '../app/benefits-portal.mjs';
import { createApp } from '../app/server.mjs';
import { dispatch } from './definitions-fixture.mjs';

export const PASSWORD='synthetic-hr-cycle-only';
export const MONTHS=['2026-06','2026-07','2026-08'];
export const code=value=>error=>error.code===value;
export const caught=run=>{try{run();}catch(error){return error;}throw new Error('لم يُرفض ما كان يجب رفضه');};
// سياسة دورة رواتب تجريبية: شهر من ثلاثين يومًا، ولا نسبة تأمينات قديمة — فالأرقام تُراجع باليد.
export const CYCLE={pay_day:27,day_basis:'thirty',review_threshold_bp:500};
const shift=days=>new Date(Date.parse(`${peopleToday()}T12:00:00Z`)+days*86400000).toISOString().slice(0,10);
const MATRIX=[{key:'craft',label:'مهارة الوظيفة التجريبية',weight:60,acceptance:'دليل تجريبي على جودة التنفيذ'},{key:'planning',label:'تخطيط العمل التجريبي',weight:40,acceptance:'يوضح المراحل وتسليمها'}];

// secondOfficer: تحمل hr-manager «السجل الوظيفي» (employees.view) فيكون في الكيان حاملان له. بدونه يبقى hr وحده.
export function hrCycle(t,{secondOfficer=true}={}){
  const db=openDb(':memory:');seed(db,PASSWORD);t.after(()=>db.close());
  const add=db.prepare("INSERT INTO users(id,tenant_id,department_id,username,name,password_hash,role,manager_id) SELECT ?,'36t','hr',?,?,password_hash,?,? FROM users WHERE id='hr'");
  add.run('hr-manager','hr-manager','مديرة رأس المال البشري التجريبية','manager',null);
  add.run('reviewer','reviewer','مراجع الرواتب التجريبي','employee','hr-manager');
  add.run('approver-2','approver-2','معتمد رواتب ثانٍ تجريبي','employee','hr-manager');
  db.prepare("INSERT INTO departments(id,tenant_id,name) VALUES('production','36t','الإنتاج التجريبي')").run();
  const w={db,U:{}};
  const refresh=()=>{w.U=Object.fromEntries(db.prepare('SELECT * FROM users').all().map(u=>[u.id,u]));return w.U;};
  refresh();
  const tx=run=>transaction(db,run);
  const grant=(user_id,capability)=>tx(()=>grantAccess(db,w.U.admin,{user_id,capability,note:'تصريح تجريبي لدورة الرواتب'}));
  for(const capability of ['hr.policy.accept','hr.contracts.approve','payroll.approve','hr.attendance.approve'])grant('hr-manager',capability);
  if(secondOfficer)grant('hr-manager','employees.view');
  grant('reviewer','payroll.review');grant('approver-2','payroll.approve');

  const policy=(kind,parameters,effective_from)=>{
    const {id}=tx(()=>preparePolicy(db,w.U.hr,{kind,title:`سياسة تجريبية — ${kind}`,body:'نص سياسة تجريبي كافٍ الطول لاختبار دورة الرواتب الآلي فقط.',basis:'قرار تجريبي لبيئة الاختبار',effective_from,parameters}));
    tx(()=>decidePolicy(db,w.U['hr-manager'],id,'accept',{note:'اعتماد تجريبي لدورة الرواتب'}));return id;
  };
  policy('pay_components',{components:['basic','housing','transport']},'2025-01-01');
  policy('payroll_cycle',CYCLE,'2026-01-01');
  policy('working_time',{workdays:[0,1,2,3,4],start:'08:00',end:'16:00',grace_minutes:15},'2026-01-01');
  const leavePolicy=tx(()=>prepareLeaveTypesDraft(db,w.U.hr,{effective_from:'2025-01-01'})).id;
  tx(()=>decideLeaveTypes(db,w.U['hr-manager'],leavePolicy,'accept',{note:'راجعت الأنواع ومواد اللائحة قبل الاعتماد التجريبي'}));
  tx(()=>createLeaveCalendar(db,w.U.hr,{employee_department_id:'creative',name:'تقويم إجازات تجريبي 2026',effective_from:'2026-01-01',effective_to:'2026-12-31',weekdays:[0,1,2,3,4]}));

  // العقد بيدين: hr يعدّه ويقدّمه، وhr-manager تعتمده.
  const contract=(user_id,start,lines,{amends=null,reason=null}={})=>{
    const {id}=tx(()=>prepareContract(db,w.U.hr,{...(amends?{change_reason:reason}:{user_id}),contract_type:'indefinite',job_title:'وظيفة تجريبية',work_location:'الرياض',start_date:start,weekly_hours:40,probation_days:90,notice_days:60,pay_lines:lines,document_reference:'عقد تجريبي لا وجود له'},amends));
    const step=(who,action)=>tx(()=>contractAction(db,w.U[who],id,action,{version:getContract(db,w.U[who],id).version}));
    step('hr','submit_contract');step('hr-manager','approve_contract');return id;
  };
  const contracts={
    employee:contract('employee','2025-01-01',[{component:'basic',amount:'8000.00'},{component:'housing',amount:'2000.00'}]),
    outsider:contract('outsider','2025-06-01',[{component:'basic',amount:'6000.00'},{component:'housing',amount:'1500.00'},{component:'transport',amount:'500.00'}])};
  tx(()=>saveProfile(db,w.U.hr,'employee',{job_title:'مصممة تجريبية',employment_type:'full_time',join_date:'2025-01-01',status:'active'}));

  // التوظيف: الاحتياج ثم المرشح ثم المقابلة والتقييمان ثم العرض وقبوله ثم التهيئة — ثم حساب يفتحه مسؤول المنصة وعقد بيدين.
  const hire=({username='new.hire'}={})=>{
    if(!db.prepare("SELECT 1 FROM people_policies WHERE id='cycle-hiring'").get())
      db.prepare('INSERT INTO people_policies VALUES(?,?,?,?,?,?,?,?,?,?)').run('cycle-hiring','36t','creative','hr','نطاق توظيف تجريبي، ليس سياسة الشركة',shift(-30),shift(365),'مرجع خصوصية تجريبي مؤرخ',1,now());
    const act=(who,row,action,input={})=>tx(()=>peopleAction(db,w.U[who],row.id,action,{version:row.version,...input}));
    let r=tx(()=>createRequisition(db,w.U.manager,{policy_id:'cycle-hiring',title:'مصمم تجريبي',need:'احتياج تجريبي واحد لدورة الرواتب',plan_reference:'خطة تجريبية راجعها HR',budget_evidence:'مخصص تجريبي موثق',target_date:shift(10),criteria:MATRIX}));
    r=act('hr',r,'approve_need',{note:'راجع HR الخطة والمخصص التجريبيين'});
    let c=tx(()=>addCandidate(db,w.U.hr,r.id,{version:r.version,name:'مرشح تجريبي',contact:`cycle-${randomUUID()}@example.invalid`,source:'ترشيح تجريبي',consent_evidence:'موافقة خصوصية تجريبية',retention_until:shift(90)}));
    c=act('hr',c,'screen',{evidence:'فرز تجريبي موثق'});
    c=act('hr',c,'schedule_interview',{interview_date:peopleToday(),evidence:'مقابلة تجريبية محلية'});
    const scores=MATRIX.map(x=>({key:x.key,score:4,evidence:'دليل تجريبي لكل معيار'}));
    c=act('manager',c,'evaluate',{scores,recommendation:'proceed',evidence:'تقييم تجريبي مستقل'});
    c=act('hr',c,'evaluate',{scores,recommendation:'proceed',evidence:'تقييم تجريبي مستقل'});
    c=act('hr',c,'propose_offer',{monthly_base:'9000.00',currency:'SAR',start_date:shift(20),valid_until:shift(10),benefits:'مزايا تجريبية لا تنشئ التزامًا',conditions:'مقترح داخلي تجريبي',evidence:'مبرر عرض تجريبي'});
    c=act('manager',c,'approve_offer',{evidence:'قرار تجريبي مستقل'});
    c=act('hr',c,'accept_offer',{accepted_on:peopleToday(),evidence:'قبول تجريبي سُجل يدويًا'});
    c=act('hr',c,'start_onboarding',{evidence:'قائمة تهيئة تجريبية',items:[{title:'إعداد مساحة عمل تجريبية',owner_id:'it',due_date:shift(3),acceptance:'فتح مساحة تجريبية بلا حساب فعلي'}]});
    for(const task of c.tasks)tx(()=>completeOnboardingTask(db,w.U[task.owner_id],task.id,{version:task.version,evidence:'دليل إكمال تجريبي'}));
    c=act('hr',getPeopleRecord(db,w.U.hr,c.id),'complete_onboarding',{evidence:'راجعت HR أدلة التهيئة التجريبية'});
    const account=tx(()=>createAccount(db,w.U.admin,{username,name:`موظف جديد تجريبي ${username}`,role:'employee',department_id:'creative',manager_id:'manager',temporary_password:'Synthetic-Hire-2026'}));
    db.prepare('UPDATE users SET must_change_password=0 WHERE id=?').run(account.id);refresh();
    const contractId=contract(account.id,'2026-06-01',[{component:'basic',amount:'7200.00'},{component:'housing',amount:'1800.00'}]);
    return {candidate:getPeopleRecord(db,w.U.hr,c.id),requisition:r,userId:account.id,contractId};
  };

  // الغياب بلا أجر: يقترحه hr، ويفيد عنه صاحبه، وتعتمده hr-manager.
  const absence=(userId,date)=>{
    const {id}=tx(()=>proposeAbsence(db,w.U.hr,{user_id:userId,work_date:date,reason:'غياب تجريبي بلا سجل حضور ولا إجازة'}));
    tx(()=>stateAbsence(db,w.U[userId],id,{statement:'إفادة تجريبية من صاحب اليوم'}));
    tx(()=>decideAbsence(db,w.U['hr-manager'],id,'confirm',{note:'اعتماد تجريبي للغياب بلا أجر'}));return id;
  };
  // الإجازة: المدير ثم خدمات الموظف. الاستثنائية بلا أجر لا تُطلب ورصيد الاضطرارية قائم، فيُستهلك أولًا.
  const leaveAsk=(input,who='employee')=>tx(()=>createLeaveRequest(db,w.U[who],{balance_year:Number(input.start_date.slice(0,4)),reason:'طلب إجازة تجريبي',...input}));
  const leaveAct=(who,r,action,input={})=>tx(()=>leaveAction(db,w.U[who],r.id,action,{version:r.version,note:'قرار تجريبي على الإجازة',...input}));
  const unpaidLeave=(start,end,who='employee')=>{
    if(!db.prepare("SELECT 1 FROM leave_requests r JOIN leave_balances b ON b.id=r.balance_id WHERE r.employee_id=? AND b.leave_type='emergency' AND r.status='approved'").get(who))
      leaveAct('hr',leaveAct('manager',leaveAsk({leave_type:'emergency',start_date:'2026-02-01',end_date:'2026-02-03'},who),'approve'),'approve');
    return leaveAct('hr',leaveAct('manager',leaveAsk({leave_type:'unpaid',start_date:start,end_date:end},who),'approve'),'approve');
  };
  const leave=(who,id)=>getLeaveRequest(db,w.U[who],id);
  const effectsOf=requestId=>db.prepare('SELECT * FROM leave_pay_effects WHERE request_id=? ORDER BY created_at').all(requestId);

  // حركات الرواتب: hr يقترح وhr-manager تقرر.
  const propose=(input,options)=>tx(()=>proposeAdjustment(db,w.U.hr,{reason:'حركة تجريبية موثقة بقرار تجريبي',...input},options)).id;
  const decide=(id,decision='approve',who='hr-manager')=>tx(()=>decideAdjustment(db,w.U[who],id,decision,{note:'قرار تجريبي على الحركة'}));
  // المزايا: طلب مكتمل ومقترح صرفه كما تتركهما سلسلة المزايا، ثم تسليم حقيقي إلى حركات المسير.
  let benefitSeq=0;
  const benefit=(userId,amountMinor,month)=>{
    const requestId=randomUUID(),proposalId=randomUUID(),time=now();benefitSeq++;
    db.prepare("INSERT INTO benefit_requests(id,tenant_id,reference,employee_id,option,details,needs_finance,status,hr_by,hr_at,finance_by,finance_at,amount_minor,created_at,updated_at) VALUES(?,'36t',?,?,'ticket_claim','{}',1,'completed','hr',?,'it',?,?,?,?)")
      .run(requestId,`BEN-2026-${900+benefitSeq}`,userId,time,time,amountMinor,time,time);
    db.prepare("INSERT INTO benefit_payout_proposals(id,tenant_id,request_id,employee_id,target,amount_minor,status,proposed_by,created_at) VALUES(?,'36t',?,?,'payroll_addition',?,'proposed','it',?)").run(proposalId,requestId,userId,amountMinor,time);
    return tx(()=>handToPayroll(db,w.U.hr,proposalId,{version:1,month})).payroll_adjustment_id;
  };

  // المسير: hr يعدّ ويقدّم، reviewer يراجع، hr-manager تعتمد.
  const prepare=month=>getRun(db,w.U.hr,tx(()=>prepareRun(db,w.U.hr,{month})).id);
  const view=(who,r)=>getRun(db,w.U[who],r.id);
  const run=(who,r,action,values={})=>tx(()=>runAction(db,w.U[who],r.id,action,{version:r.version,...values}));
  const review=r=>{
    r=view('reviewer',r);
    for(const line of r.lines.filter(l=>l.variance_flag&&!l.variance_note))r=run('reviewer',r,'justify',{line_id:line.id,note:'فرق مفسر بحركات الشهر التجريبية'});
    return run('reviewer',r,'pass_review',{note:'طابقت السطور مع مصادرها التجريبية'});
  };
  const approve=(r,who='hr-manager')=>run(who,view(who,r),'approve_run',{note:'اعتماد تجريبي'});
  const approveMonth=month=>approve(review(run('hr',prepare(month),'submit_run')));
  const lineOf=(r,userId)=>r.lines.find(l=>l.user_id===userId);

  // HTTP بلا منفذ: الطلب يُمرَّر إلى الخادم الحقيقي (createApp) مباشرة، فيمر بالمصادقة وCSRF والمصدر ومعاملة الكتابة كما في التشغيل.
  const http=async names=>{
    const app=createApp(db),sessions={};
    for(const username of names){
      const response=await dispatch(app,{method:'POST',path:'/api/login',body:{username,password:PASSWORD}});
      if(response.status!==200)throw new Error(`login failed for ${username}: ${response.text}`);
      sessions[username]={cookie:response.headers['Set-Cookie'].split(';')[0],csrf:response.json().csrf};
    }
    // csrf:false يرسل الطلب بلا رمز CSRF، وorigin يبدّل مصدر الطلب — ليُرى أن المسار يمر بحراسة بقية مسارات الكتابة.
    return (who,method,path,body,{csrf=true,origin='http://127.0.0.1:3600'}={})=>dispatch(app,{method,path:'/api'+path,
      headers:{cookie:sessions[who].cookie,...(csrf?{'x-csrf-token':sessions[who].csrf}:{}),origin},body});
  };
  return Object.assign(w,{tx,grant,refresh,contract,contracts,hire,absence,leaveAsk,leaveAct,unpaidLeave,leave,effectsOf,propose,decide,benefit,prepare,view,run,review,approve,approveMonth,lineOf,http});
}
