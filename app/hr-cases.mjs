import { randomUUID, randomBytes } from 'node:crypto';
import { audit, hash, now } from './db.mjs';
import { fail } from './auth.mjs';
import * as v from './validation.mjs';
import { currentUser } from './delegations.mjs';
import { holds } from './access.mjs';
import { holidaySet, addWorkingDays, riyadhDate } from './work-calendar.mjs';
import { notifySubject, hrCaseNotice } from './notices.mjs';

// حالات الموارد البشرية السرية والبلاغ المجهول.
// السرية مفروضة في الاستعلام لا في الواجهة: الحالة يراها صاحبها والمسؤول المسند إليه فقط.
// المدير المباشر ليس طرفًا بحكم موقعه — كثير من الشكاوى عنه — ومن لا يرى الحالة يتلقى 404 فلا يعرف أنها موجودة.
const CAP='hr.cases.handle';
export const CASE_CATEGORIES=[['inquiry','استفسار'],['complaint','شكوى'],['grievance','تظلم'],['violation_report','إبلاغ عن مخالفة'],['personal_matter','مسألة شخصية']].map(([key,name])=>({key,name}));
export const CASE_STATES={open:'لم تُسند بعد',assigned:'قيد المعالجة',closed:'مغلقة'};
export const CASE_OUTCOMES=[['resolved','عولجت'],['unfounded','لم تثبت'],['referred','أُحيلت لجهة أخرى']].map(([key,name])=>({key,name}));
export const REPORT_STATES={received:'استُلم ولم يُسند',under_review:'قيد المراجعة',closed:'مغلق'};
export const REPORT_OUTCOMES=[['substantiated','ثبت'],['unsubstantiated','لم يثبت'],['insufficient_information','معلومات غير كافية'],['referred','أُحيل لجهة أخرى']].map(([key,name])=>({key,name}));
const id=()=>randomUUID();
const today=()=>riyadhDate(Date.now());
const label=(list,key)=>list.find(x=>x.key===key)?.name??key;
const userName=(db,userId)=>userId?db.prepare('SELECT name FROM users WHERE id=?').get(userId)?.name??null:null;

function actor(db,supplied){const u=currentUser(db,supplied);if(!u||u.role==='admin')fail(403,'forbidden','هذي الشاشة لحسابات الموظفين وبس');u.handler=holds(db,u,CAP);return u;}
function writing(db){if(!db.isTransaction)fail(500,'transaction_required','الكتابة تبي معاملة قاعدة بيانات');}
const missing=()=>fail(404,'not_found','ما لقينا الحالة هذي');
function person(db,u,userId,labelText){const p=typeof userId==='string'&&db.prepare("SELECT id,name FROM users WHERE id=? AND tenant_id=? AND active=1 AND role<>'admin'").get(userId,u.tenant_id);if(!p)fail(404,'not_found',`ما لقينا ${labelText}`);return p;}
// من يحمل التصريح وليس طرفًا في الحالة. يُحسب لمن يعرف الأطراف أصلًا (المسؤول الحالي) فقط.
const eligibleHandlers=(db,u,parties)=>db.prepare("SELECT id,tenant_id,name FROM users WHERE tenant_id=? AND active=1 AND role<>'admin' ORDER BY name").all(u.tenant_id).filter(x=>!parties.includes(x.id)&&holds(db,x,CAP)).map(x=>({id:x.id,name:x.name}));

// ---------- المدة المستهدفة ----------
function targetFor(db,tenantId,category,date){return db.prepare('SELECT * FROM hr_case_settings WHERE tenant_id=? AND category=? AND effective_from<=? ORDER BY effective_from DESC LIMIT 1').get(tenantId,category,date)??null;}
export function setCaseTarget(db,supplied,input){
  writing(db);const u=actor(db,supplied);if(!u.handler)fail(403,'not_permitted','المدد المستهدفة يحددها حامل تصريح حالات الموارد البشرية');
  v.object(input,['category','target_working_days','effective_from','basis']);
  if(!CASE_CATEGORIES.some(c=>c.key===input.category))fail(400,'category','اختر فئة الحالة من القائمة');
  if(!Number.isInteger(input.target_working_days)||input.target_working_days<1||input.target_working_days>365)fail(400,'target_working_days','المدة المستهدفة أيام عمل من 1 لين 365');
  const effective=v.date(input.effective_from),basis=v.text(input.basis,'أساس المدة ومن أقرها',1000,10);
  if(db.prepare('SELECT 1 FROM hr_case_settings WHERE tenant_id=? AND category=? AND effective_from=?').get(u.tenant_id,input.category,effective))fail(409,'duplicate_setting','الفئة هذي لها مدة بنفس تاريخ السريان — اختر تاريخ سريان ثاني');
  const settingId=id();
  db.prepare('INSERT INTO hr_case_settings(id,tenant_id,category,target_working_days,effective_from,basis,set_by,created_at) VALUES(?,?,?,?,?,?,?,?)').run(settingId,u.tenant_id,input.category,input.target_working_days,effective,basis,u.id,now());
  audit(db,u,'hr_case_setting',settingId,'hr_case.target_set',{},{category:input.category,target_working_days:input.target_working_days,effective_from:effective},basis);
  return {id:settingId};
}

// ---------- الحالات ----------
// شرط الرؤية جزء من الاستعلام نفسه: لا يُحمَّل سطر ثم يُحجب.
// الحالة غير المسندة تظهر لحامل التصريح في قائمة الاستلام بفئتها وتاريخها فقط، ولا تظهر له إن كان طرفًا فيها.
const VISIBLE=`c.tenant_id=:tenant AND (c.reporter_id=:me OR c.assignee_id=:me OR (:handler=1 AND c.status='open' AND c.reporter_id<>:me AND (c.respondent_id IS NULL OR c.respondent_id<>:me)))`;
const scope=u=>({tenant:u.tenant_id,me:u.id,handler:u.handler?1:0});
function caseRow(db,u,caseId){const c=typeof caseId==='string'&&db.prepare(`SELECT c.* FROM hr_cases c WHERE c.id=:id AND ${VISIBLE}`).get({...scope(u),id:caseId});if(!c)missing();return c;}
function caseView(db,u,c){
  const own=c.reporter_id===u.id,assignee=c.assignee_id===u.id,date=today(),actions=[];
  const base={id:c.id,category:c.category,category_name:label(CASE_CATEGORIES,c.category),status:c.status,status_name:CASE_STATES[c.status],filed_on:riyadhDate(c.created_at),target_due_on:c.target_due_on,
    overdue:c.status!=='closed'&&!!c.target_due_on&&c.target_due_on<date,version:c.version,own,assignee};
  if(!own&&!assignee){
    // عرض الاستلام: لا وصف ولا صاحب ولا مشكو منه حتى يتحمل أحدهم مسؤولية الحالة.
    return {...base,triage:true,actions:['take_case']};
  }
  if(c.status!=='closed'){
    if(own)actions.push('add_info','withdraw_case');
    if(assignee)actions.push('note_case','reply_case','decide_case','reassign_case','close_case');
  }
  const events=db.prepare(`SELECT * FROM hr_case_events WHERE case_id=? ${assignee?'':'AND visible_to_reporter=1'} ORDER BY created_at,rowid`).all(c.id)
    .map(ev=>({id:ev.id,kind:ev.kind,body:ev.body,on:riyadhDate(ev.created_at),by_name:userName(db,ev.actor_id),internal:!ev.visible_to_reporter}));
  return {...base,triage:false,subject:c.subject,description:c.description,assignee_name:userName(db,c.assignee_id),respondent_name:userName(db,c.respondent_id),
    ...(assignee?{reporter_name:userName(db,c.reporter_id),reassign_candidates:c.status==='closed'?[]:eligibleHandlers(db,u,[u.id,c.reporter_id,c.respondent_id])}:{}),
    outcome:c.outcome,outcome_name:c.outcome==='withdrawn'?'سحبها صاحبها':c.outcome?label(CASE_OUTCOMES,c.outcome):null,closing_reason:c.closing_reason,closed_on:c.closed_at?riyadhDate(c.closed_at):null,events,actions};
}
export function getCase(db,supplied,caseId){const u=actor(db,supplied);return caseView(db,u,caseRow(db,u,caseId));}

function visibleReports(db,u){
  if(!u.handler)return [];
  return db.prepare("SELECT * FROM anonymous_reports r WHERE r.tenant_id=? AND (r.respondent_id IS NULL OR r.respondent_id<>?) AND (r.handler_id IS NULL OR r.handler_id=?) ORDER BY r.status='closed',r.received_on DESC").all(u.tenant_id,u.id,u.id);
}
function reportView(db,u,r){
  const mine=r.handler_id===u.id,actions=r.status==='received'?['take_report']:mine&&r.status==='under_review'?['reply_report','handover_report','close_report']:[];
  return {id:r.id,status:r.status,status_name:REPORT_STATES[r.status],received_on:r.received_on,body:r.body,respondent_name:userName(db,r.respondent_id),handler_name:userName(db,r.handler_id),
    outcome:r.outcome,outcome_name:r.outcome?label(REPORT_OUTCOMES,r.outcome):null,closing_reason:r.closing_reason,closed_on:r.closed_on,version:r.version,
    messages:db.prepare('SELECT side,body,posted_on FROM anonymous_report_messages WHERE report_id=? ORDER BY rowid').all(r.id),
    handover_candidates:mine&&r.status==='under_review'?eligibleHandlers(db,u,[u.id,r.respondent_id]):[],actions};
}

export function hrCasesBoard(db,supplied){
  const u=actor(db,supplied),date=today();
  const cases=db.prepare(`SELECT c.* FROM hr_cases c WHERE ${VISIBLE} ORDER BY c.status='closed',c.created_at DESC LIMIT 300`).all(scope(u)).map(c=>caseView(db,u,c));
  return {today:date,user_id:u.id,handler:u.handler,categories:CASE_CATEGORIES,outcomes:CASE_OUTCOMES,report_outcomes:REPORT_OUTCOMES,
    my_cases:cases.filter(c=>c.own),handling:cases.filter(c=>c.assignee),intake:cases.filter(c=>c.triage),
    anonymous_reports:visibleReports(db,u).map(r=>reportView(db,u,r)),
    // قائمة أسماء فقط لاختيار المشكو منه؛ لا تكشف شيئًا غير ما في دليل الموظفين.
    people:db.prepare("SELECT id,name FROM users WHERE tenant_id=? AND active=1 AND role<>'admin' AND id<>? ORDER BY name").all(u.tenant_id,u.id),
    targets:CASE_CATEGORIES.map(c=>{const s=targetFor(db,u.tenant_id,c.key,date);return {category:c.key,category_name:c.name,target_working_days:s?.target_working_days??null,effective_from:s?.effective_from??null,basis:u.handler?s?.basis??null:null};}),
    actions:['file_case','submit_anonymous','follow_anonymous',...(u.handler?['set_case_target']:[])],
    note:'الحالة يراها صاحبها والمسؤول المسند إليه فقط. مديرك المباشر لا يراها، ومن تُذكر شكوى بحقه لا تُسند إليه ولا تظهر له. المنصة لا ترسل إشعارًا خارجيًا ولا تتصل بأي جهة؛ الإحالة لجهة خارج الشركة يوثقها المسؤول يدويًا.',
    anonymous_note:'البلاغ المجهول لا يُربط بحسابك: لا يُخزَّن معه اسم ولا وقت بالساعة، ولا يُكتب في سجل التدقيق من أرسله. رمز المتابعة يظهر مرة واحدة ولا يمكن استرجاعه؛ من فقده فقد متابعة بلاغه. المجهولية تحمي الهوية في قاعدة البيانات، ولا تحميك إن كتبت في النص ما يدل عليك.'};
}

export function fileCase(db,supplied,input){
  writing(db);const u=actor(db,supplied);
  v.object(input,['category','subject','description','respondent_id']);
  if(!CASE_CATEGORIES.some(c=>c.key===input.category))fail(400,'category','اختر فئة الحالة من القائمة');
  const respondent=input.respondent_id?person(db,u,input.respondent_id,'الشخص المذكور'):null;
  if(respondent?.id===u.id)fail(400,'respondent_id','ما ترفع الحالة على نفسك');
  const caseId=id(),time=now(),date=today(),setting=targetFor(db,u.tenant_id,input.category,date);
  const due=setting?addWorkingDays(date,setting.target_working_days,holidaySet(db,u.tenant_id)):null;
  db.prepare("INSERT INTO hr_cases(id,tenant_id,reporter_id,category,subject,description,respondent_id,status,target_setting_id,target_due_on,created_at,updated_at) VALUES(?,?,?,?,?,?,?,'open',?,?,?,?)")
    .run(caseId,u.tenant_id,u.id,input.category,v.text(input.subject,'عنوان الحالة',200,3),v.text(input.description,'وصف الحالة',8000,20),respondent?.id??null,setting?.id??null,due,time,time);
  db.prepare("INSERT INTO hr_case_events(id,tenant_id,case_id,actor_id,kind,body,visible_to_reporter,created_at) VALUES(?,?,?,?,'filed','رُفعت الحالة',1,?)").run(id(),u.tenant_id,caseId,u.id,time);
  // سجل التدقيق العام لا يحمل فئة الحالة ولا المشكو منه: يكفي أثر الحدث.
  audit(db,u,'hr_case',caseId,'hr_case.filed',{},{});
  // حاملو التصريح غير الأطراف يعلمون أن حالة تنتظر الاستلام؛ برقمها فقط.
  for(const handler of eligibleHandlers(db,u,[u.id,respondent?.id].filter(Boolean)))caseNotice(db,handler.id,'intake',caseId);
  return {id:caseId};
}

const CASE_FIELDS={take_case:[],add_info:['body'],withdraw_case:['reason'],note_case:['body'],reply_case:['body'],decide_case:['decision','reason'],reassign_case:['assignee_id','reason'],close_case:['outcome','reason']};
export function caseAction(db,supplied,caseId,action,input){
  writing(db);const u=actor(db,supplied),c=caseRow(db,u,caseId),view=caseView(db,u,c);
  if(!CASE_FIELDS[action])fail(404,'not_found','ما فيه إجراء بهذا الاسم على الحالة');
  v.object(input,['version',...CASE_FIELDS[action]]);v.version(input.version,c.version);
  if(!view.actions.includes(action))fail(409,'invalid_state','ما ينفع هذا الإجراء في حالة السجل، ولا هو من صلاحيتك');
  const time=now(),event=(kind,body,visible)=>db.prepare('INSERT INTO hr_case_events(id,tenant_id,case_id,actor_id,kind,body,visible_to_reporter,created_at) VALUES(?,?,?,?,?,?,?,?)').run(id(),u.tenant_id,c.id,u.id,kind,body,visible?1:0,time);
  const bump=(fields='',values=[])=>db.prepare(`UPDATE hr_cases SET ${fields}${fields?',':''}version=version+1,updated_at=? WHERE id=?`).run(...values,time,c.id);
  let reason='';
  if(action==='take_case'){
    // الاستعلام استبعد الأطراف أصلًا؛ قيد CHECK في الجدول خط الدفاع الثاني.
    event('taken',`تولى ${u.name} الحالة`,true);bump("assignee_id=?,status='assigned'",[u.id]);
  }else if(action==='reassign_case'){
    reason=v.text(input.reason,'سبب نقل الحالة',1000,10);
    const target=view.reassign_candidates.find(x=>x.id===input.assignee_id);
    if(!target)fail(409,'conflict_of_interest','المسؤول الجديد لازم يحمل التصريح، وما يكون صاحب الحالة ولا المذكور فيها');
    event('reassigned',`نُقلت الحالة إلى ${target.name} — السبب: ${reason}`,true);bump('assignee_id=?',[target.id]);
  }else if(action==='add_info'){event('reply',v.text(input.body,'الإضافة',4000,3),true);bump();}
  else if(action==='note_case'){event('note',v.text(input.body,'الملاحظة الداخلية',4000,3),false);bump();}
  else if(action==='reply_case'){event('reply',v.text(input.body,'الرد على صاحب الحالة',4000,3),true);bump();}
  else if(action==='decide_case'){
    reason=v.text(input.reason,'سبب القرار',3000,10);
    event('decision',`${v.text(input.decision,'القرار',2000,5)} — السبب: ${reason}`,true);bump();
  }else{
    const withdrawn=action==='withdraw_case',outcome=withdrawn?'withdrawn':input.outcome;
    if(!withdrawn&&!CASE_OUTCOMES.some(o=>o.key===outcome))fail(400,'outcome','اختر نتيجة الإغلاق من القائمة');
    reason=v.text(input.reason,withdrawn?'سبب السحب':'سبب الإغلاق',3000,10);
    // السطر الأخير يُكتب قبل الإغلاق: الحالة المغلقة لا تقبل إدخالًا بعدها.
    event('closed',`${withdrawn?'سحبها صاحبها':label(CASE_OUTCOMES,outcome)} — السبب: ${reason}`,true);
    bump("status='closed',outcome=?,closing_reason=?,closed_by=?,closed_at=?",[outcome,reason,u.id,time]);
  }
  audit(db,u,'hr_case',c.id,'hr_case.'+action,{status:c.status,version:c.version},{version:c.version+1},reason);
  // إشعار عام سري (hrCaseNotice): رقم الحالة فقط. الملاحظة الداخلية لا تُشعر أحدًا، ولا يُشعر أحد بفعله.
  const after=db.prepare('SELECT assignee_id FROM hr_cases WHERE id=?').get(c.id).assignee_id;
  if(['take_case','reassign_case','reply_case','decide_case'].includes(action))caseNotice(db,c.reporter_id,'updated',c.id,u.id);
  if(action==='close_case')caseNotice(db,c.reporter_id,'closed',c.id,u.id);
  if(action==='reassign_case')caseNotice(db,after,'assigned',c.id,u.id);
  if(['add_info','withdraw_case'].includes(action)&&after)caseNotice(db,after,'handler_update',c.id,u.id);
  return {id:c.id};
}
function caseNotice(db,userId,event,caseId,actorId=null){
  if(!userId||userId===actorId)return;
  notifySubject(db,{userId,subjectKind:'hr_case',subjectId:caseId,...hrCaseNotice(event,caseId)});
}

// ---------- البلاغ المجهول ----------
// لا يُكتب سطر تدقيق عند الإرسال ولا عند المتابعة: سطر التدقيق يحمل actor_id، وهو بالضبط ما وُعد المُبلِّغ ألا يُسجَّل.
// أثر البلاغ هو البلاغ نفسه، وأول سطر تدقيق له يكتبه من يتولاه.
// على المنسّق: مسار الإرسال بلا Idempotency-Key (جدول المفاتيح يربط user_id بمعرّف السجل) وبلا تسجيل لجسم الطلب.
const TOKEN=/^[A-Za-z0-9_-]{32}$/;
function reportByToken(db,u,token){
  const r=typeof token==='string'&&TOKEN.test(token)&&db.prepare('SELECT * FROM anonymous_reports WHERE tenant_id=? AND token_hash=?').get(u.tenant_id,hash(token));
  if(!r)fail(404,'not_found','ما فيه بلاغ بهذا الرمز');return r;
}
const followView=(db,r)=>({status:r.status,status_name:REPORT_STATES[r.status],received_on:r.received_on,outcome_name:r.outcome?label(REPORT_OUTCOMES,r.outcome):null,closing_reason:r.closing_reason,closed_on:r.closed_on,
  can_reply:r.status!=='closed',messages:db.prepare('SELECT side,body,posted_on FROM anonymous_report_messages WHERE report_id=? ORDER BY rowid').all(r.id)});
export function submitAnonymousReport(db,supplied,input){
  writing(db);const u=actor(db,supplied);
  v.object(input,['body','respondent_id']);
  const respondent=input.respondent_id?person(db,u,input.respondent_id,'الشخص المذكور'):null;
  const token=randomBytes(24).toString('base64url');
  db.prepare("INSERT INTO anonymous_reports(id,tenant_id,token_hash,body,respondent_id,status,received_on) VALUES(?,?,?,?,?,'received',?)").run(id(),u.tenant_id,hash(token),v.text(input.body,'نص البلاغ',8000,30),respondent?.id??null,today());
  // لا معرّف في الرد: الرمز وحده هو الصلة بين المُبلِّغ وبلاغه.
  return {token,notice:'احتفظ بهذا الرمز الآن. لن يظهر مرة أخرى ولا يستطيع أحد استرجاعه لك.'};
}
export function followAnonymousReport(db,supplied,input){const u=actor(db,supplied);v.object(input,['token']);return followView(db,reportByToken(db,u,input.token));}
export function replyAnonymousReport(db,supplied,input){
  writing(db);const u=actor(db,supplied);v.object(input,['token','body']);
  const r=reportByToken(db,u,input.token);
  if(r.status==='closed')fail(409,'invalid_state','البلاغ هذا مقفول');
  db.prepare("INSERT INTO anonymous_report_messages(id,tenant_id,report_id,side,author_id,body,posted_on) VALUES(?,?,?,'reporter',NULL,?,?)").run(id(),u.tenant_id,r.id,v.text(input.body,'الإضافة',4000,3),today());
  return followView(db,r);
}
const REPORT_FIELDS={take_report:[],reply_report:['body'],handover_report:['handler_id','reason'],close_report:['outcome','reason']};
export function reportAction(db,supplied,reportId,action,input){
  writing(db);const u=actor(db,supplied),r=visibleReports(db,u).find(x=>x.id===reportId);
  if(!r)fail(404,'not_found','ما لقينا البلاغ هذا');
  if(!REPORT_FIELDS[action])fail(404,'not_found','ما فيه إجراء بهذا الاسم على البلاغ');
  v.object(input,['version',...REPORT_FIELDS[action]]);v.version(input.version,r.version);
  const view=reportView(db,u,r);
  if(!view.actions.includes(action))fail(409,'invalid_state','ما ينفع هذا الإجراء في حالة البلاغ، ولا هو من صلاحيتك');
  const bump=(fields,values)=>db.prepare(`UPDATE anonymous_reports SET ${fields},version=version+1 WHERE id=?`).run(...values,r.id);
  let reason='';
  if(action==='take_report')bump("handler_id=?,status='under_review'",[u.id]);
  else if(action==='reply_report'){
    db.prepare("INSERT INTO anonymous_report_messages(id,tenant_id,report_id,side,author_id,body,posted_on) VALUES(?,?,?,'handler',?,?,?)").run(id(),u.tenant_id,r.id,u.id,v.text(input.body,'الرد على المُبلِّغ',4000,3),today());
    bump('handler_id=handler_id',[]);
  }
  else if(action==='handover_report'){
    reason=v.text(input.reason,'سبب النقل',1000,10);
    if(!view.handover_candidates.some(x=>x.id===input.handler_id))fail(409,'conflict_of_interest','المعالج الجديد لازم يحمل التصريح، وما يكون المذكور في البلاغ');
    bump('handler_id=?',[input.handler_id]);
  }else{
    if(!REPORT_OUTCOMES.some(o=>o.key===input.outcome))fail(400,'outcome','اختر نتيجة الإغلاق من القائمة');
    reason=v.text(input.reason,'سبب الإغلاق',3000,10);
    bump("status='closed',outcome=?,closing_reason=?,closed_on=?",[input.outcome,reason,today()]);
  }
  audit(db,u,'anonymous_report',r.id,'anonymous_report.'+action,{status:r.status,version:r.version},{version:r.version+1},reason);
  return {id:r.id};
}
