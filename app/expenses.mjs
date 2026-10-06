import { randomUUID } from 'node:crypto';
import { audit, now } from './db.mjs';
import { fail } from './auth.mjs';
import * as v from './validation.mjs';
import { currentUser } from './delegations.mjs';
import { financeCapabilities } from './finance.mjs';
import { notifySubject, dayName } from './notices.mjs';
import { assertFinanciallyOpen } from './project-closure-guard.mjs';
import { riyadhToday, riyadhDateOf } from './riyadh-time.mjs';

// المصروفات والعهد. أي موظف يطالب بمصروفه ويطلب عهدة؛ مديره المباشر يقر الغرض، والمالية تعتمد وتوثق الصرف.
// الإيصال الواحد لا يُطالب به مرتين، وصاحب المطالبة لا يقرر فيها في أي خطوة.
export const CATEGORIES=[['travel','سفر وانتداب'],['hospitality','ضيافة'],['supplies','مستلزمات'],['transport','نقل ومواصلات'],['subscriptions','اشتراكات'],['production','مصروف إنتاج ميداني'],['other','أخرى']].map(([key,name])=>({key,name}));
export const CLAIM_STATUS={submitted:'بانتظار المدير المباشر',manager_approved:'بانتظار المالية',finance_approved:'معتمدة — بانتظار التعويض',reimbursed:'عُوضت',rejected:'مرفوضة'};
export const CUSTODY_STATUS={requested:'بانتظار اعتماد المالية',approved:'معتمدة — لم تُصرف بعد',issued:'مصروفة وقيد التسوية',closed:'مقفلة',rejected:'مرفوضة'};
// D-09 (تدقيق مسارات الوحدات، 20 سبتمبر): لم يكن لصاحب المطالبة أو العهدة مخرج من طلبه إلا أن يسأل مديره أن يرفضه،
// فيحمل سجله رفضًا عن خطأ كتابي منه. السحب هنا لصاحب الطلب وحده وقبل أول قرار، ويُدوَّن في سجل التدقيق كغيره.
// الصف يبقى بحالته ويُنهيه وسم السحب (ترحيل 114)، لأن حالة جديدة تعني إعادة بناء جدول عليه مراجع أجنبية حية.
export const WITHDRAWN_CLAIM='مسحوبة بطلب مقدّمها';
export const WITHDRAWN_CUSTODY='مسحوب بطلب صاحبه';
const ACTION_NAMES={manager_approve:'إقرار المدير',finance_approve:'اعتماد المالية',reject_claim:'رفض المطالبة',record_reimbursement:'توثيق التعويض',withdraw_claim:'سحب المطالبة',
  approve_custody:'اعتماد العهدة',reject_custody:'رفض العهدة',issue_custody:'تسجيل الصرف',close_custody:'إقفال العهدة',withdraw_custody:'سحب طلب العهدة'};
const id=()=>randomUUID();

function actor(db,supplied){const u=currentUser(db,supplied);if(!u||u.role==='admin')fail(403,'forbidden','المصروفات لحسابات الموظفين وبس');u.finance=financeCapabilities(db,u);return u;}
function writing(db){if(!db.isTransaction)fail(500,'transaction_required','الكتابة تبي معاملة قاعدة بيانات');}
// D-24: الرسالة الواحدة لكل مبلغ في المنصة تقول ما المطلوب ومثاله وما أُدخل، وتفرّق بين الناقص والمكتوب خطأ.
const money=(value,label)=>v.moneyMinor(value,label);
const name=(db,userId)=>userId?db.prepare('SELECT name FROM users WHERE id=?').get(userId)?.name??null:null;
const managerOf=(db,userId)=>db.prepare('SELECT manager_id FROM users WHERE id=?').get(userId)?.manager_id??null;

export function custodyBalance(db,custody){
  const settled=db.prepare("SELECT COALESCE(SUM(amount_minor),0) AS n FROM expense_claims WHERE custody_id=? AND status='finance_approved'").get(custody.id).n;
  const pending=db.prepare("SELECT COALESCE(SUM(amount_minor),0) AS n FROM expense_claims WHERE custody_id=? AND status IN ('submitted','manager_approved') AND withdrawn_at IS NULL").get(custody.id).n;
  return {settled_minor:settled,pending_minor:pending,returned_minor:custody.returned_minor,open_minor:custody.amount_minor-settled-custody.returned_minor};
}
function claimView(db,u,c){
  const actions=[],manager=managerOf(db,c.claimant_id),withdrawn=!!c.withdrawn_at;
  // السحب قبل أول قرار: لصاحبها وحده، وما دامت لم يقرّر فيها مدير ولا مالية.
  if(!withdrawn&&c.status==='submitted'&&c.claimant_id===u.id&&!c.manager_id&&!c.finance_id)actions.push('withdraw_claim');
  if(withdrawn)return {...c,claimant_name:name(db,c.claimant_id),manager_name:name(db,c.manager_id),finance_name:name(db,c.finance_id),category_name:CATEGORIES.find(k=>k.key===c.category).name,
    status_name:WITHDRAWN_CLAIM,withdrawn:true,own:c.claimant_id===u.id,actions:[]};
  if(c.status==='submitted'&&c.claimant_id!==u.id&&(manager===u.id||(!manager&&u.finance.includes('approve'))))actions.push('manager_approve','reject_claim');
  // B19 (تدقيق 19 سبتمبر): من أخذ خطوة المدير لا يأخذ خطوة المالية على المطالبة نفسها. الحالة التي كشفها التدقيق:
  // مطالب بلا مدير مباشر، فتفتح خطوة المدير لحامل الاعتماد المالي نفسه، ثم يعتمدها ماليًا فيصير القراران قرارًا واحدًا.
  // الرفض يبقى متاحًا له حتى لا تعلق المطالبة بلا قرار؛ الممنوع أن يعتمدها ماليًا من أقرّها بصفة المدير.
  if(c.status==='manager_approved'&&c.claimant_id!==u.id&&u.finance.includes('approve')){
    if(c.manager_id!==u.id)actions.push('finance_approve');
    actions.push('reject_claim');
  }
  if(c.status==='finance_approved'&&!c.custody_id&&c.claimant_id!==u.id&&u.finance.includes('post'))actions.push('record_reimbursement');
  return {...c,claimant_name:name(db,c.claimant_id),manager_name:name(db,c.manager_id),finance_name:name(db,c.finance_id),category_name:CATEGORIES.find(k=>k.key===c.category).name,status_name:CLAIM_STATUS[c.status],withdrawn:false,own:c.claimant_id===u.id,actions};
}
function custodyView(db,u,c){
  const actions=[],balance=custodyBalance(db,c),withdrawn=!!c.withdrawn_at;
  if(!withdrawn&&c.status==='requested'&&c.holder_id===u.id&&!c.approved_by)actions.push('withdraw_custody');
  if(withdrawn)return {...c,...balance,holder_name:name(db,c.holder_id),approved_by_name:name(db,c.approved_by),status_name:WITHDRAWN_CUSTODY,withdrawn:true,own:c.holder_id===u.id,actions:[]};
  if(c.status==='requested'&&c.holder_id!==u.id&&u.finance.includes('approve'))actions.push('approve_custody','reject_custody');
  if(c.status==='approved'&&c.holder_id!==u.id&&u.finance.includes('post'))actions.push('issue_custody');
  if(c.status==='issued'&&c.holder_id!==u.id&&u.finance.includes('post')&&balance.pending_minor===0)actions.push('close_custody');
  return {...c,...balance,holder_name:name(db,c.holder_id),approved_by_name:name(db,c.approved_by),status_name:CUSTODY_STATUS[c.status],withdrawn:false,own:c.holder_id===u.id,actions};
}
export function expensesBoard(db,supplied){
  const u=actor(db,supplied),finance=u.finance.includes('read');
  // الموظف يرى مطالباته، والمدير مطالبات فريقه، والمالية الجميع.
  const scope=finance?'1=1':'(c.claimant_id=? OR c.claimant_id IN (SELECT id FROM users WHERE manager_id=?))',args=finance?[u.tenant_id]:[u.tenant_id,u.id,u.id];
  const claims=db.prepare(`SELECT c.* FROM expense_claims c WHERE c.tenant_id=? AND ${scope} ORDER BY c.created_at DESC LIMIT 300`).all(...args).map(c=>claimView(db,u,c));
  const custodies=db.prepare(`SELECT c.* FROM custodies c WHERE c.tenant_id=? AND ${finance?'1=1':'c.holder_id=?'} ORDER BY c.created_at DESC LIMIT 200`).all(...(finance?[u.tenant_id]:[u.tenant_id,u.id])).map(c=>custodyView(db,u,c));
  const projects=db.prepare('SELECT p.id,p.name FROM projects p JOIN project_members m ON m.project_id=p.id WHERE p.tenant_id=? AND m.user_id=? ORDER BY p.name').all(u.tenant_id,u.id);
  return {today:riyadhToday(),user_id:u.id,finance:u.finance,categories:CATEGORIES,claim_status:CLAIM_STATUS,custody_status:CUSTODY_STATUS,claims,custodies,projects,
    my_open_custodies:custodies.filter(c=>c.own&&c.status==='issued'),
    // «بانتظار قراري» قرارات الآخرين لا إجراءات صاحب الطلب على طلبه (زر السحب، D-09).
    totals:{awaiting_me:claims.filter(c=>!c.own&&c.actions.length).length+custodies.filter(c=>!c.own&&c.actions.length).length,my_unreimbursed_minor:claims.filter(c=>c.own&&c.status==='finance_approved'&&!c.custody_id).reduce((n,c)=>n+c.amount_minor,0),open_custody_minor:custodies.filter(c=>c.status==='issued').reduce((n,c)=>n+c.open_minor,0)}};
}

// المطالبة يراها صاحبها ومديره المباشر وحامل التفويض المالي.
export function getClaim(db,supplied,claimId){
  const u=actor(db,supplied),row=typeof claimId==='string'&&db.prepare('SELECT * FROM expense_claims WHERE id=? AND tenant_id=?').get(claimId,u.tenant_id);
  if(!row||!(row.claimant_id===u.id||managerOf(db,row.claimant_id)===u.id||u.finance.includes('read')))fail(404,'not_found','ما لقينا المطالبة هذي');
  return claimView(db,u,row);
}
export function submitClaim(db,supplied,input){
  writing(db);const u=actor(db,supplied);
  v.object(input,['expense_date','category','description','amount','receipt_reference','custody_id','project_id']);
  if(!CATEGORIES.some(k=>k.key===input.category))fail(400,'category','اختر تصنيف المصروف من القائمة');
  const date=v.date(input.expense_date),today=riyadhToday();
  if(date>today)fail(400,'expense_date','تاريخ المصروف ما يكون في المستقبل');
  const amount=money(input.amount,'المبلغ'),receipt=v.text(input.receipt_reference,'مرجع الإيصال',120,3).normalize('NFKC').toUpperCase();
  if(db.prepare("SELECT 1 FROM expense_claims WHERE tenant_id=? AND claimant_id=? AND expense_date=? AND amount_minor=? AND receipt_reference=? AND status<>'rejected' AND withdrawn_at IS NULL").get(u.tenant_id,u.id,date,amount,receipt))fail(409,'duplicate_receipt','الإيصال هذا مقدّم من قبل بنفس التاريخ والمبلغ. إذا الأول مرفوض ولا مسحوب أعد تقديمه، وإلا تابعه في «مصروفاتي وعهدي»');
  let custodyId=null;
  if(input.custody_id){
    const custody=db.prepare("SELECT * FROM custodies WHERE id=? AND tenant_id=? AND holder_id=? AND status='issued'").get(input.custody_id,u.tenant_id,u.id);
    if(!custody)fail(400,'custody','ما لقينا عهدة تنفع للتسوية');
    const balance=custodyBalance(db,custody);
    if(amount>balance.open_minor-balance.pending_minor)fail(409,'custody_exceeded','المبلغ يتعدّى الباقي من العهدة — قدّم الزيادة مطالبة لحالها');
    custodyId=custody.id;
  }
  let projectId=null;
  if(input.project_id){if(!db.prepare('SELECT 1 FROM project_members WHERE project_id=? AND user_id=?').get(input.project_id,u.id))fail(400,'project','المشروع هذا مو من صلاحيتك');projectId=input.project_id;}
  // مصروف جديد على مشروع مقفل ماليًا يغيّر هامشًا قُبل وأُقفل عليه؛ يُقدَّم بلا مشروع أو بعد إعادة فتح الإقفال (ترحيل 163).
  assertFinanciallyOpen(db,projectId,'ما ينقدم مصروف جديد على مشروع مقفل ماليًا');
  const claimId=id(),time=now();
  db.prepare("INSERT INTO expense_claims(id,tenant_id,claimant_id,custody_id,project_id,expense_date,category,description,amount_minor,receipt_reference,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,'submitted',?,?)").run(claimId,u.tenant_id,u.id,custodyId,projectId,date,input.category,v.text(input.description,'الغرض',2000,10),amount,receipt,time,time);
  audit(db,u,'expense_claim',claimId,'expense.submitted',{}, {amount_minor:amount,category:input.category,custody:!!custodyId});
  return {id:claimId};
}
export function claimAction(db,supplied,claimId,action,input){
  writing(db);const u=actor(db,supplied);
  const fields={manager_approve:['note'],finance_approve:['note'],reject_claim:['note'],record_reimbursement:['reimbursed_on','reference'],withdraw_claim:['note']}[action];
  if(!fields)fail(404,'not_found','ما فيه إجراء بهذا الاسم على المطالبة');
  v.object(input,['version',...fields]);
  const row=typeof claimId==='string'&&db.prepare('SELECT * FROM expense_claims WHERE id=? AND tenant_id=?').get(claimId,u.tenant_id);
  if(!row)fail(404,'not_found','ما لقينا المطالبة هذي');
  const c=claimView(db,u,row);v.version(input.version,c.version);
  // D-14: الرفض يقول حالة المطالبة والسبب والمتاح لك الآن ومن يملك الخطوة التالية.
  if(!c.actions.includes(action))v.actionUnavailable(action,{subject:`مطالبة المصروف (${c.category_name}، ${dayName(c.expense_date)})`,state_name:c.status_name,
    names:ACTION_NAMES,available:c.actions,
    reason:c.withdrawn?'سحب مقدّمها المطالبة، والمسحوب نهائي'
      :action==='withdraw_claim'?(c.claimant_id!==u.id?'السحب لمن قدّم المطالبة وحده':'السحب قبل أول قرار فقط؛ صدر في هذه المطالبة قرار')
      :c.claimant_id===u.id?'لا يقرر صاحب المطالبة في مطالبته في أي خطوة':'الإجراء لا تسمح به حالة المطالبة أو لا يحمله تفويضك المالي',
    who:c.status==='submitted'?`الخطوة التالية عند المدير المباشر${c.manager_name?` (${c.manager_name})`:''}`
      :c.status==='manager_approved'?'الخطوة التالية عند حامل التفويض المالي للاعتماد (finance approve)'
      :c.status==='finance_approved'?'الخطوة التالية توثيق التعويض لحامل التفويض المالي للقيد (finance post)':null});
  const time=now(),set=(sql,...args)=>db.prepare(`UPDATE expense_claims SET ${sql},version=version+1,updated_at=? WHERE id=?`).run(...args,time,c.id);
  if(action==='manager_approve')set("status='manager_approved',manager_id=?,manager_decided_at=?,decision_note=?",u.id,time,v.text(input.note,'أساس الإقرار',2000,3));
  if(action==='finance_approve')set("status='finance_approved',finance_id=?,finance_decided_at=?,decision_note=?",u.id,time,v.text(input.note,'ما الذي طابقته في الإيصال',2000,3));
  if(action==='reject_claim')set("status='rejected',decision_note=?",v.text(input.note,'سبب الرفض',2000,10));
  if(action==='withdraw_claim'){
    const reason=v.text(input.note,'سبب سحب المطالبة',2000,3);
    set('withdrawn_at=?,withdrawal_reason=?',time,reason);
    audit(db,u,'expense_claim',c.id,'expense.withdrawn',{status:c.status},{withdrawn:true,version:c.version+1},reason);
    return claimView(db,u,db.prepare('SELECT * FROM expense_claims WHERE id=?').get(c.id));
  }
  if(action==='record_reimbursement'){
    const paid=v.date(input.reimbursed_on);
    // يوم الاعتماد بتوقيت الرياض: finance_decided_at طابع UTC، وأول عشرة أحرف منه تسبق يوم الرياض بيوم بين 00:00 و03:00.
    if(paid>riyadhToday()||paid<riyadhDateOf(c.finance_decided_at))fail(400,'reimbursed_on','خلّ تاريخ التعويض بين الاعتماد واليوم');
    set("status='reimbursed',reimbursed_on=?,reimbursement_reference=?,reimbursed_by=?",paid,v.text(input.reference,'مرجع التحويل',120,4).toUpperCase(),u.id);
  }
  audit(db,u,'expense_claim',c.id,'expense.'+action,{status:c.status},{version:c.version+1});
  // إشعار صاحب المطالبة بكل قرار (B6). بلا مبلغ: التصنيف وتاريخ المصروف يكفيان لتعرّفها، والمبلغ في شاشتها.
  const label=`مطالبة المصروف (${c.category_name}، ${dayName(c.expense_date)})`,notice={
    manager_approve:[`أقرّ مديرك ${label}`,'الحالة: بانتظار اعتماد المالية.'],
    finance_approve:[`اعتمدت المالية ${label}`,'الحالة: معتمدة — بانتظار توثيق التعويض.'],
    reject_claim:[`رُفضت ${label}`,'سبب الرفض مكتوب في «مصروفاتي وعهدي».'],
    record_reimbursement:[`عُوِّضت ${label}`,`وُثِّق التعويض بتاريخ ${dayName(input.reimbursed_on)}.`]}[action];
  if(c.claimant_id!==u.id)notifySubject(db,{userId:c.claimant_id,kind:'expense_'+action,subjectKind:'expense_claim',subjectId:c.id,title:notice[0],body:notice[1]});
  return claimView(db,u,db.prepare('SELECT * FROM expense_claims WHERE id=?').get(c.id));
}

export function requestCustody(db,supplied,input){
  writing(db);const u=actor(db,supplied);
  v.object(input,['amount','purpose']);
  if(db.prepare("SELECT 1 FROM custodies WHERE holder_id=? AND status IN ('requested','approved','issued') AND withdrawn_at IS NULL").get(u.id))fail(409,'open_custody','عندك عهدة مفتوحة — سوّها قبل ما تطلب وحدة ثانية، ولا اسحب طلبها إذا ما اعتُمد');
  const custodyId=id(),time=now();
  db.prepare("INSERT INTO custodies(id,tenant_id,holder_id,amount_minor,purpose,status,created_at,updated_at) VALUES(?,?,?,?,?,'requested',?,?)").run(custodyId,u.tenant_id,u.id,money(input.amount,'مبلغ العهدة'),v.text(input.purpose,'الغرض',2000,10),time,time);
  audit(db,u,'custody',custodyId,'custody.requested',{}, {});
  return {id:custodyId};
}
export function custodyAction(db,supplied,custodyId,action,input){
  writing(db);const u=actor(db,supplied);
  const fields={approve_custody:['note'],reject_custody:['note'],issue_custody:['issued_on','reference'],close_custody:['returned','return_reference','note'],withdraw_custody:['note']}[action];
  if(!fields)fail(404,'not_found','ما فيه إجراء بهذا الاسم على العهدة');
  v.object(input,['version',...fields]);
  const row=typeof custodyId==='string'&&db.prepare('SELECT * FROM custodies WHERE id=? AND tenant_id=?').get(custodyId,u.tenant_id);
  if(!row)fail(404,'not_found','ما لقينا العهدة هذي');
  const c=custodyView(db,u,row);v.version(input.version,c.version);
  if(!c.actions.includes(action))v.actionUnavailable(action,{subject:'طلب العهدة',state_name:c.status_name,names:ACTION_NAMES,available:c.actions,
    reason:c.withdrawn?'سحب صاحبها طلب العهدة، والمسحوب نهائي'
      :action==='withdraw_custody'?(c.holder_id!==u.id?'السحب لمن طلب العهدة وحده':'السحب قبل اعتماد المالية فقط؛ اعتُمد هذا الطلب')
      :c.holder_id===u.id?'لا يقرر صاحب العهدة في عهدته في أي خطوة':'الإجراء لا تسمح به حالة العهدة أو لا يحمله تفويضك المالي',
    who:c.status==='requested'?'الخطوة التالية اعتماد حامل التفويض المالي (finance approve)'
      :c.status==='approved'?'الخطوة التالية تسجيل الصرف لحامل التفويض المالي للقيد (finance post)'
      :c.status==='issued'&&c.pending_minor?`لا تُقفل العهدة وعليها مطالبات لم يُقرَّر فيها (${(c.pending_minor/100).toFixed(2)} ريال)`:null});
  const time=now(),set=(sql,...args)=>db.prepare(`UPDATE custodies SET ${sql},version=version+1,updated_at=? WHERE id=?`).run(...args,time,c.id);
  if(action==='approve_custody')set("status='approved',approved_by=?,approved_at=?,decision_note=?",u.id,time,v.text(input.note,'أساس الاعتماد',2000,3));
  if(action==='reject_custody')set("status='rejected',decision_note=?",v.text(input.note,'سبب الرفض',2000,10));
  if(action==='withdraw_custody'){
    const reason=v.text(input.note,'سبب سحب طلب العهدة',2000,3);
    set('withdrawn_at=?,withdrawal_reason=?',time,reason);
    audit(db,u,'custody',c.id,'custody.withdrawn',{status:c.status},{withdrawn:true,version:c.version+1},reason);
    return custodyView(db,u,db.prepare('SELECT * FROM custodies WHERE id=?').get(c.id));
  }
  if(action==='issue_custody'){const on=v.date(input.issued_on);if(on>riyadhToday())fail(400,'issued_on','تاريخ الصرف ما يكون في المستقبل');set("status='issued',issued_on=?,issue_reference=?,issued_by=?",on,v.text(input.reference,'مرجع الصرف',120,4).toUpperCase(),u.id);}
  if(action==='close_custody'){
    // الإقفال لا يترك فرقًا غير مفسر: ما لم يُسوَّ بمطالبات معتمدة يُعاد نقدًا بمرجع.
    const returned=input.returned&&input.returned!=='0'?money(input.returned,'المبلغ المعاد'):0;
    if(returned!==c.open_minor)fail(409,'unexplained_balance',`المتبقي من العهدة ${(c.open_minor/100).toFixed(2)} ريال — والمبلغ اللي ترجّعه لازم يساوي الباقي بالضبط`);
    if(returned&&!input.return_reference)fail(400,'return_reference','اكتب مرجع إعادة المبلغ');
    set("status='closed',returned_minor=?,return_reference=?,closed_by=?,closed_at=?,decision_note=?",returned,returned?v.text(input.return_reference,'مرجع الإعادة',120,4).toUpperCase():null,u.id,time,v.text(input.note,'ملاحظة الإقفال',2000,3));
  }
  audit(db,u,'custody',c.id,'custody.'+action,{status:c.status},{version:c.version+1});
  const notice={approve_custody:['اعتُمد طلب عهدتك','الحالة: معتمدة — لم تُصرف بعد.'],reject_custody:['رُفض طلب عهدتك','سبب الرفض مكتوب في «مصروفاتي وعهدي».'],
    issue_custody:['صُرفت عهدتك','الحالة: مصروفة وقيد التسوية. سوِّها بمطالبات مصروف أو بإعادة المتبقي.'],close_custody:['أُقفلت عهدتك','الحالة: مقفلة.']}[action];
  if(c.holder_id!==u.id)notifySubject(db,{userId:c.holder_id,kind:'custody_'+action,subjectKind:'custody',subjectId:c.id,title:notice[0],body:notice[1]});
  return custodyView(db,u,db.prepare('SELECT * FROM custodies WHERE id=?').get(c.id));
}
