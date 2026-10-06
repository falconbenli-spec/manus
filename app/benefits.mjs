import { randomUUID } from 'node:crypto';
import { audit, now } from './db.mjs';
import { fail } from './auth.mjs';
import * as v from './validation.mjs';
import { currentUser } from './delegations.mjs';
import { holds } from './access.mjs';
import { notifySubject, dayName } from './notices.mjs';

// التأمين الطبي والمزايا: سجل ما لدى شركة التأمين وتذكير بما يجب فعله لديها.
// لا اتصال بأي شركة تأمين: الإضافة والحذف يجريان خارج المنصة، وهذه الشاشة تسجلهما وتذكّر بهما.
// لا تُخزَّن هنا أي معلومة طبية: لا تشخيص ولا مطالبة علاجية ولا حالة صحية ولا تقرير طبي.
// هذه بيانات حساسة لا مبرر لوجودها في منصة تشغيلية، ولا يوجد في المخطط حقل يقبلها.
// بيانات التابعين بيانات شخصية لأطراف ثالثة: صلة القرابة وتاريخ الميلاد فقط،
// لا يراها إلا حامل hr.benefits.manage والموظف صاحبها في «مزاياي»، ولا تدخل تقريرًا ولا تصديرًا.
export const RELATIONS=[['spouse','زوج/زوجة'],['child','ابن/ابنة'],['parent','والد/والدة'],['other','تابع آخر موثق']].map(([key,name])=>({key,name}));
export const ENROLMENT_STATUS={requested:'أُرسل للإضافة لدى شركة التأمين',active:'مسجَّل ومؤكَّد',removed:'محذوف من الوثيقة'};
export const CAPABILITY='hr.benefits.manage';
export const PRIVACY_NOTE='لا تُسجَّل هنا أي معلومة طبية: لا تشخيص ولا مطالبة ولا حالة صحية. بيانات التابعين (صلة القرابة وتاريخ الميلاد) بيانات شخصية لأطراف ثالثة، تقتصر على حامل تصريح المزايا والموظف نفسه في «مزاياي»، ولا تظهر في أي تقرير أو تصدير.';
export const CONNECTION_NOTE='المنصة غير متصلة بشركة التأمين. الإضافة والحذف يجريان لدى الشركة خارج المنصة، وهذه الشاشة سجل وتذكير فقط: ما تراه هنا ما أدخله مسؤول المزايا، لا ما تؤكده الشركة.';
const id=()=>randomUUID();
const today=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Riyadh',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const addDays=(date,n)=>new Date(Date.parse(date+'T00:00:00Z')+n*86400000).toISOString().slice(0,10);

// بيانات التابعين بيانات أطراف ثالثة: يلزمها تصريح صريح محفوظ، لا امتياز إداري عام.
function actor(db,supplied){const u=currentUser(db,supplied);if(!u)fail(403,'forbidden','الحساب غير متاح');u.manage=holds(db,u,CAPABILITY);return u;}
function writing(db){if(!db.isTransaction)fail(500,'transaction_required','تتطلب كتابة سجل المزايا معاملة قاعدة بيانات');}
function need(u){if(!u.manage)fail(403,'not_permitted','هذه الشاشة لحامل تصريح التأمين الطبي والمزايا');}
const personName=(db,userId)=>userId?db.prepare('SELECT name FROM users WHERE id=?').get(userId)?.name??null:null;
// D-03 (تدقيق مسارات الوحدات، 20 سبتمبر): الموظف لم يكن يُبلَّغ بشيء عن تغطيته الطبية — لا عند التسجيل ولا عند التأكيد
// ولا حتى عند حذفه من الوثيقة، وهو فقدان تغطية صحية يمر بلا إشعار ولا أثر يراه صاحبه.
// الإشعار من قالب هنا: لا معلومة طبية فيه ولا رقم وثيقة ولا رقم عضوية ولا بيان تابع (صلة أو ميلاد)، والتفصيل في شاشته.
// نقطة حفظ حول الكتابة كما في «مزاياي»: فرع بلا شرط شكل الموضوع (الترحيل 099) يسقط الإشعار وحده ولا يُسقط الإجراء.
function tell(db,userId,enrolmentId,kind,title,body){
  if(!userId||!enrolmentId)return;
  db.exec('SAVEPOINT medical_cover_notice');
  try{notifySubject(db,{userId,kind,subjectKind:'medical_enrolment',subjectId:enrolmentId,title,body});db.exec('RELEASE medical_cover_notice');}
  catch(error){db.exec('ROLLBACK TO medical_cover_notice');db.exec('RELEASE medical_cover_notice');if(!/CHECK constraint failed/.test(String(error?.message)))throw error;}
}
function pastDate(value,label,date=today()){
  const parsed=v.date(value);
  if(parsed>date)fail(400,'future_date',`${label}: لا يُسجَّل تاريخ لم يأتِ بعد`);
  return parsed;
}
function policyRecord(db,u,policyId){
  const p=typeof policyId==='string'&&db.prepare('SELECT * FROM medical_policies WHERE id=? AND tenant_id=?').get(policyId,u.tenant_id);
  if(!p)fail(404,'not_found','وثيقة التأمين غير متاحة');
  return p;
}
function enrolmentRecord(db,u,enrolmentId){
  const e=typeof enrolmentId==='string'&&db.prepare('SELECT * FROM medical_enrolments WHERE id=? AND tenant_id=?').get(enrolmentId,u.tenant_id);
  if(!e)fail(404,'not_found','التسجيل غير متاح');
  return e;
}
const dependantsOf=(db,enrolmentId)=>db.prepare('SELECT id,relation,birth_date,added_on,removed_on,recorded_by,version,created_at FROM medical_dependants WHERE enrolment_id=? ORDER BY added_on,created_at').all(enrolmentId);

function enrolmentView(db,u,e){
  const actions=[],decides=u.manage&&e.employee_id!==u.id;
  if(decides&&e.status==='requested')actions.push('confirm_enrolment');
  if(decides&&e.status!=='removed')actions.push('remove_enrolment','add_dependant');
  return {...e,status_name:ENROLMENT_STATUS[e.status],employee_name:personName(db,e.employee_id),recorded_by_name:personName(db,e.recorded_by),
    // التابعون لحامل التصريح وحده. بقية الحسابات لا ترى العدد ولا التفاصيل.
    dependants:u.manage?dependantsOf(db,e.id).map(d=>({...d,relation_name:RELATIONS.find(r=>r.key===d.relation).name,actions:d.removed_on||!decides?[]:['remove_dependant']})):undefined,
    actions};
}
export function benefitsBoard(db,supplied){
  const u=actor(db,supplied),date=today();
  const policies=db.prepare('SELECT * FROM medical_policies WHERE tenant_id=? ORDER BY effective_to DESC,created_at DESC').all(u.tenant_id)
    .map(p=>({...p,tiers:JSON.parse(p.tiers),recorded_by_name:personName(db,p.recorded_by),
      expired:p.effective_to<date,expiring:p.effective_to>=date&&p.effective_to<=addDays(date,p.renewal_notice_days),
      actions:u.manage?['update_medical_policy','record_enrolment']:[]}));
  const rows=u.manage
    ?db.prepare('SELECT * FROM medical_enrolments WHERE tenant_id=? ORDER BY updated_at DESC').all(u.tenant_id)
    :db.prepare('SELECT * FROM medical_enrolments WHERE tenant_id=? AND employee_id=? ORDER BY updated_at DESC').all(u.tenant_id,u.id);
  const enrolments=rows.map(e=>enrolmentView(db,u,e));
  const current=policies.filter(p=>p.effective_from<=date&&p.effective_to>=date);
  const alerts=[];
  if(u.manage){
    for(const p of policies){
      if(p.expired)alerts.push({kind:'policy_expired',policy_id:p.id,date:p.effective_to,message:`انتهت وثيقة ${p.insurer_name} رقم ${p.policy_number} في ${p.effective_to}. جدّدها لدى الشركة وسجّل الوثيقة الجديدة.`});
      else if(p.expiring)alerts.push({kind:'policy_expiring',policy_id:p.id,date:p.effective_to,message:`تنتهي وثيقة ${p.insurer_name} رقم ${p.policy_number} في ${p.effective_to} خلال مهلة التنبيه المسجلة (${p.renewal_notice_days} يومًا).`});
    }
    const covered=new Set(rows.filter(e=>e.status!=='removed'&&current.some(p=>p.id===e.policy_id)).map(e=>e.employee_id));
    for(const person of db.prepare("SELECT id,name FROM users WHERE tenant_id=? AND active=1 AND role<>'admin' ORDER BY name").all(u.tenant_id))
      if(!covered.has(person.id))alerts.push({kind:'not_enrolled',employee_id:person.id,message:`${person.name} غير مسجَّل في وثيقة سارية. أضفه لدى شركة التأمين ثم سجّل الإضافة هنا.`+(current.length?'':' ولا توجد وثيقة سارية مسجلة أصلًا.')});
    for(const e of rows.filter(x=>x.status!=='removed')){
      const person=db.prepare('SELECT id,name,active FROM users WHERE id=? AND tenant_id=?').get(e.employee_id,u.tenant_id);
      const ended=db.prepare("SELECT 1 FROM employment_contracts WHERE user_id=? AND status='ended' AND NOT EXISTS(SELECT 1 FROM employment_contracts a WHERE a.user_id=? AND a.status='active')").get(e.employee_id,e.employee_id);
      if(person&&(!person.active||ended))alerts.push({kind:'leaver_enrolled',enrolment_id:e.id,employee_id:person.id,message:`${person.name} غادر ولم يُحذف من الوثيقة. احذفه لدى شركة التأمين ثم سجّل الحذف هنا.`});
    }
  }
  return {today:date,user_id:u.id,can_manage:u.manage,relations:RELATIONS,status_names:ENROLMENT_STATUS,
    policies,enrolments,alerts,
    employees:u.manage?db.prepare("SELECT id,name FROM users WHERE tenant_id=? AND active=1 AND role<>'admin' AND id<>? ORDER BY name").all(u.tenant_id,u.id):[],
    privacy_note:PRIVACY_NOTE,connection_note:CONNECTION_NOTE,
    note:`${CONNECTION_NOTE} ${PRIVACY_NOTE}`};
}

function policyInput(input){
  const tiers=Array.isArray(input.tiers)?input.tiers.map(t=>v.text(t,'فئة التغطية',80,1)):fail(400,'tiers','أدخل فئات التغطية المتاحة في الوثيقة');
  if(!tiers.length||tiers.length>20||new Set(tiers).size!==tiers.length)fail(400,'tiers','فئات التغطية من 1 إلى 20 فئة بلا تكرار');
  const from=v.date(input.effective_from),to=v.date(input.effective_to);
  if(to<=from)fail(400,'date_order','تاريخ انتهاء الوثيقة بعد تاريخ سريانها');
  if(!Number.isInteger(input.renewal_notice_days)||input.renewal_notice_days<1||input.renewal_notice_days>365)fail(400,'renewal_notice_days','مهلة التنبيه قبل الانتهاء بالأيام من 1 إلى 365');
  return {insurer_name:v.text(input.insurer_name,'شركة التأمين',180,2),policy_number:v.text(input.policy_number,'رقم الوثيقة',120,2),
    effective_from:from,effective_to:to,tiers:JSON.stringify(tiers),renewal_notice_days:input.renewal_notice_days,
    note:input.note===undefined||input.note===''?'':v.text(input.note,'ملاحظة الوثيقة',2000,0)};
}
const POLICY_FIELDS=['insurer_name','policy_number','effective_from','effective_to','tiers','renewal_notice_days','note'];

export function recordMedicalPolicy(db,supplied,input){
  writing(db);const u=actor(db,supplied);need(u);
  v.object(input,POLICY_FIELDS);
  const c=policyInput(input),policyId=id(),time=now();
  if(db.prepare('SELECT 1 FROM medical_policies WHERE tenant_id=? AND policy_number=?').get(u.tenant_id,c.policy_number))fail(409,'policy_exists','رقم الوثيقة مسجل مسبقًا');
  db.prepare('INSERT INTO medical_policies(id,tenant_id,insurer_name,policy_number,effective_from,effective_to,tiers,renewal_notice_days,note,recorded_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)')
    .run(policyId,u.tenant_id,c.insurer_name,c.policy_number,c.effective_from,c.effective_to,c.tiers,c.renewal_notice_days,c.note,u.id,time,time);
  audit(db,u,'medical_policy',policyId,'benefits.policy_recorded',{}, {insurer:c.insurer_name,policy_number:c.policy_number,effective_to:c.effective_to});
  return {id:policyId};
}
export function updateMedicalPolicy(db,supplied,policyId,input){
  writing(db);const u=actor(db,supplied);need(u);
  v.object(input,['version',...POLICY_FIELDS]);
  const p=policyRecord(db,u,policyId);
  v.version(input.version,p.version);
  const c=policyInput(input);
  if(c.policy_number!==p.policy_number&&db.prepare('SELECT 1 FROM medical_policies WHERE tenant_id=? AND policy_number=?').get(u.tenant_id,c.policy_number))fail(409,'policy_exists','رقم الوثيقة مسجل مسبقًا');
  const open=db.prepare("SELECT COUNT(*) AS n FROM medical_enrolments WHERE policy_id=? AND status<>'removed'").get(p.id).n;
  if(open&&JSON.parse(c.tiers).length<JSON.parse(p.tiers).length)fail(409,'tiers_in_use','لا تُحذف فئات من وثيقة عليها تسجيلات قائمة');
  db.prepare('UPDATE medical_policies SET insurer_name=?,policy_number=?,effective_from=?,effective_to=?,tiers=?,renewal_notice_days=?,note=?,version=version+1,updated_at=? WHERE id=?')
    .run(c.insurer_name,c.policy_number,c.effective_from,c.effective_to,c.tiers,c.renewal_notice_days,c.note,now(),p.id);
  audit(db,u,'medical_policy',p.id,'benefits.policy_updated',{version:p.version,effective_to:p.effective_to},{version:p.version+1,effective_to:c.effective_to});
  return {id:p.id,version:p.version+1};
}
export function recordEnrolment(db,supplied,input){
  writing(db);const u=actor(db,supplied);need(u);
  v.object(input,['policy_id','employee_id','tier','requested_on']);
  const p=policyRecord(db,u,input.policy_id),date=today();
  const person=db.prepare("SELECT id,name,active FROM users WHERE id=? AND tenant_id=? AND role<>'admin'").get(input.employee_id,u.tenant_id);
  if(!person)fail(404,'not_found','الموظف غير متاح');
  if(!person.active)fail(409,'inactive_employee','لا يُسجَّل حساب غير نشط في وثيقة تأمين');
  // صاحب السجل لا يسجل نفسه؛ القيد نفسه مفروض بـCHECK في المخطط.
  if(person.id===u.id)fail(409,'separation_of_duties','لا يسجل مسؤول المزايا نفسه في الوثيقة');
  if(!JSON.parse(p.tiers).includes(input.tier))fail(400,'tier','الفئة غير موجودة في فئات الوثيقة');
  if(p.effective_to<date)fail(409,'policy_expired','الوثيقة منتهية. سجّل الوثيقة الجديدة أولًا');
  if(db.prepare("SELECT 1 FROM medical_enrolments WHERE policy_id=? AND employee_id=? AND status<>'removed'").get(p.id,person.id))fail(409,'enrolment_exists','للموظف تسجيل قائم في هذه الوثيقة');
  const requested=pastDate(input.requested_on,'تاريخ إرسال الإضافة',date);
  if(requested<p.effective_from)fail(400,'date_order','تاريخ الإضافة قبل سريان الوثيقة');
  const enrolmentId=id(),time=now();
  db.prepare("INSERT INTO medical_enrolments(id,tenant_id,policy_id,employee_id,tier,requested_on,status,recorded_by,created_at,updated_at) VALUES(?,?,?,?,?,?,'requested',?,?,?)")
    .run(enrolmentId,u.tenant_id,p.id,person.id,input.tier,requested,u.id,time,time);
  audit(db,u,'medical_enrolment',enrolmentId,'benefits.enrolment_recorded',{}, {employee_id:person.id,policy_id:p.id,tier:input.tier});
  tell(db,person.id,enrolmentId,'medical_enrolment_recorded','أُرسل تسجيلك في التأمين الطبي إلى شركة التأمين',
    `أُرسل في ${dayName(requested)}. يصلك إشعار عند تأكيد الشركة التسجيل. تفاصيل تغطيتك في «مزاياي».`);
  return {id:enrolmentId};
}
export function enrolmentAction(db,supplied,enrolmentId,action,input){
  writing(db);const u=actor(db,supplied);need(u);
  const fields={confirm_enrolment:['confirmed_on','member_reference'],remove_enrolment:['removed_on','reason']}[action];
  if(!fields)fail(404,'not_found','الإجراء غير متاح');
  v.object(input,['version',...fields]);
  const e=enrolmentRecord(db,u,enrolmentId),date=today();
  v.version(input.version,e.version);
  // صاحب التسجيل لا يؤكد تسجيله ولا يحذفه ولو حمل تصريح المزايا؛ القيد نفسه محفّز في الترحيل 091.
  if(e.employee_id===u.id)fail(409,'separation_of_duties','لا يؤكد مسؤول المزايا تسجيله هو ولا يحذفه؛ يقرره مسؤول آخر');
  if(e.status==='removed')fail(409,'enrolment_removed','التسجيل محذوف. سجّل إضافة جديدة إن عاد الموظف للوثيقة');
  const time=now();
  if(action==='confirm_enrolment'){
    if(e.status!=='requested')fail(409,'action_unavailable','التسجيل مؤكَّد مسبقًا');
    const confirmed=pastDate(input.confirmed_on,'تاريخ تأكيد الشركة',date);
    if(confirmed<e.requested_on)fail(400,'date_order','تاريخ التأكيد قبل تاريخ الإرسال');
    db.prepare("UPDATE medical_enrolments SET status='active',confirmed_on=?,member_reference=?,decided_by=?,version=version+1,updated_at=? WHERE id=?")
      .run(confirmed,v.text(input.member_reference,'رقم العضوية لدى الشركة',120,2),u.id,time,e.id);
    tell(db,e.employee_id,e.id,'medical_enrolment_confirmed','أكدت شركة التأمين تسجيلك في الوثيقة',
      `التأكيد بتاريخ ${dayName(confirmed)}. رقم عضويتك وتفاصيل تغطيتك في «مزاياي».`);
  } else {
    const removed=pastDate(input.removed_on,'تاريخ الحذف لدى الشركة',date);
    if(removed<e.requested_on)fail(400,'date_order','تاريخ الحذف قبل تاريخ الإضافة');
    db.prepare("UPDATE medical_enrolments SET status='removed',removed_on=?,removal_reason=?,decided_by=?,version=version+1,updated_at=? WHERE id=?")
      .run(removed,v.text(input.reason,'سبب الحذف من الوثيقة',1000,3),u.id,time,e.id);
    // فقدان التغطية أهم ما يجب أن يصل صاحبه: يُذكر التاريخ ومن يُراجَع، ولا يُنقل سبب الحذف الحر إلى الإشعار.
    tell(db,e.employee_id,e.id,'medical_enrolment_removed','حُذف تسجيلك من وثيقة التأمين الطبي',
      `انتهت تغطيتك في هذه الوثيقة اعتبارًا من ${dayName(removed)}. إن كان لديك استفسار فراجع فريق المزايا في الموارد البشرية.`);
  }
  audit(db,u,'medical_enrolment',e.id,'benefits.'+action,{status:e.status,version:e.version},{version:e.version+1});
  return {id:e.id,version:e.version+1};
}
// التابع: صلة القرابة وتاريخ الميلاد فقط. لا اسم ولا هوية ولا أي حقل نصي حر يقبل بيانًا طبيًا.
// المسار /benefits/enrolments/:id/dependants يمرر معرّف التسجيل من المسار (WIRING-SPEC §8.3): إن حمل الجسم معرّفًا
// غير معرّف المسار رُفض الطلب، فلا يُضاف تابع إلى تسجيل غير الذي فُتح في الشاشة.
export function addDependant(db,supplied,input,pathEnrolmentId){
  writing(db);const u=actor(db,supplied);need(u);
  if(pathEnrolmentId!==undefined){
    if(input&&typeof input==='object'&&input.enrolment_id!==undefined&&input.enrolment_id!==pathEnrolmentId)fail(400,'id_mismatch','معرّف التسجيل في الطلب لا يطابق التسجيل المفتوح');
    input={...(input&&typeof input==='object'&&!Array.isArray(input)?input:{}),enrolment_id:pathEnrolmentId};
  }
  v.object(input,['enrolment_id','relation','birth_date','added_on']);
  const e=enrolmentRecord(db,u,input.enrolment_id),date=today();
  if(e.employee_id===u.id)fail(409,'separation_of_duties','لا يضيف مسؤول المزايا تابعًا إلى تسجيله هو؛ يضيفه مسؤول آخر');
  if(e.status==='removed')fail(409,'enrolment_removed','لا يُضاف تابع لتسجيل محذوف');
  if(!RELATIONS.some(r=>r.key===input.relation))fail(400,'relation','اختر صلة القرابة');
  const birth=pastDate(input.birth_date,'تاريخ الميلاد',date),added=pastDate(input.added_on,'تاريخ الإضافة لدى الشركة',date);
  if(birth>added)fail(400,'date_order','تاريخ الميلاد بعد تاريخ الإضافة');
  const dependantId=id();
  db.prepare('INSERT INTO medical_dependants(id,tenant_id,enrolment_id,relation,birth_date,added_on,recorded_by,created_at) VALUES(?,?,?,?,?,?,?,?)')
    .run(dependantId,u.tenant_id,e.id,input.relation,birth,added,u.id,now());
  // لا يدخل تاريخ ميلاد التابع ولا صلته سجل التدقيق المشترك؛ يكفي أن التسجيل تغير ومن غيّره.
  audit(db,u,'medical_enrolment',e.id,'benefits.dependant_added',{}, {dependant_id:dependantId});
  // بلا صلة القرابة ولا تاريخ الميلاد: بيانات طرف ثالث لا تُنقل في إشعار.
  tell(db,e.employee_id,e.id,'medical_dependant_added','أُضيف تابع إلى تأمينك الطبي',
    `الإضافة لدى شركة التأمين بتاريخ ${dayName(added)}. قائمة تابعيك في «مزاياي».`);
  return {id:dependantId};
}
export function removeDependant(db,supplied,dependantId,input){
  writing(db);const u=actor(db,supplied);need(u);
  v.object(input,['version','removed_on']);
  const d=typeof dependantId==='string'&&db.prepare('SELECT * FROM medical_dependants WHERE id=? AND tenant_id=?').get(dependantId,u.tenant_id);
  if(!d)fail(404,'not_found','سجل التابع غير متاح');
  v.version(input.version,d.version);
  if(db.prepare('SELECT employee_id FROM medical_enrolments WHERE id=? AND tenant_id=?').get(d.enrolment_id,u.tenant_id)?.employee_id===u.id)
    fail(409,'separation_of_duties','لا يحذف مسؤول المزايا تابعًا من تسجيله هو؛ يحذفه مسؤول آخر');
  if(d.removed_on)fail(409,'already_removed','التابع محذوف من الوثيقة مسبقًا');
  const removed=pastDate(input.removed_on,'تاريخ الحذف لدى الشركة',today());
  if(removed<d.added_on)fail(400,'date_order','تاريخ الحذف قبل تاريخ الإضافة');
  db.prepare('UPDATE medical_dependants SET removed_on=?,version=version+1 WHERE id=?').run(removed,d.id);
  audit(db,u,'medical_enrolment',d.enrolment_id,'benefits.dependant_removed',{}, {dependant_id:d.id});
  tell(db,db.prepare('SELECT employee_id FROM medical_enrolments WHERE id=?').get(d.enrolment_id)?.employee_id,d.enrolment_id,'medical_dependant_removed',
    'حُذف تابع من تأمينك الطبي',`انتهت تغطية هذا التابع اعتبارًا من ${dayName(removed)}. قائمة تابعيك في «مزاياي».`);
  return {id:d.id,version:d.version+1};
}

// «ملفي» (docs/implementation/handoff/employee-ux.md): الموظف يطّلع على تابعيه المسجلين في وثيقته، بصلة القرابة وتاريخ الميلاد فقط.
// توسيع بقرار المالك (19 سبتمبر) لقاعدة «لا يراها إلا حامل التصريح»: يُضاف صاحب التسجيل وحده، ولا يراها مديره ولا زملاؤه.
// الاستعلام يبقى في هذه الوحدة وحدها. غير المسموح يُرد بـnull لا بقائمة فارغة، حتى لا يُفهم منه «لا تابعين».
export function dependantsOfEmployee(db,supplied,employeeId){
  const u=actor(db,supplied);
  if(employeeId!==u.id&&!u.manage)return null;
  return db.prepare(`SELECT d.relation,d.birth_date,d.added_on FROM medical_dependants d JOIN medical_enrolments e ON e.id=d.enrolment_id AND e.tenant_id=d.tenant_id
    WHERE e.employee_id=? AND e.tenant_id=? AND e.status<>'removed' AND d.removed_on IS NULL ORDER BY d.birth_date`).all(employeeId,u.tenant_id)
    .map(d=>({relation:d.relation,relation_name:RELATIONS.find(r=>r.key===d.relation)?.name??d.relation,birth_date:d.birth_date,added_on:d.added_on}));
}
// ── «مزاياي» (app/benefits-portal.mjs) ────────────────────────────────────────────
// هذا الملف يبقى القارئ الوحيد لجدول التابعين: شاشة «مزاياي» تقرأ تأمين صاحبها وتطبّق طلبات التابعين من هنا فقط.
// الموظف يرى تسجيله وتابعيه هو (بياناته التي قدّمها)، وحامل التصريح يرى أي موظف؛ لا أحد غيرهما.
const masked=value=>{const s=String(value??'').trim();return !s?'':s.length<=4?'••••':`••••${s.slice(-4)}`;};
function openEnrolment(db,tenantId,employeeId,date=today()){
  const rows=db.prepare("SELECT e.*,p.insurer_name,p.policy_number,p.effective_from AS policy_from,p.effective_to AS policy_to,p.tiers FROM medical_enrolments e JOIN medical_policies p ON p.id=e.policy_id WHERE e.tenant_id=? AND e.employee_id=? AND e.status<>'removed' ORDER BY (p.effective_from<=? AND p.effective_to>=?) DESC,p.effective_to DESC,e.created_at DESC").all(tenantId,employeeId,date,date);
  return rows[0]??null;
}
export function coverageOf(db,supplied,employeeId){
  const u=actor(db,supplied);
  if(employeeId!==u.id&&!u.manage)fail(404,'not_found','بيانات التأمين غير متاحة');
  const e=openEnrolment(db,u.tenant_id,employeeId);
  if(!e)return null;
  const date=today();
  return {enrolment_id:e.id,status:e.status,status_name:ENROLMENT_STATUS[e.status],tier:e.tier,policy_tiers:JSON.parse(e.tiers),
    insurer_name:e.insurer_name,policy_number_masked:masked(e.policy_number),member_reference_masked:masked(e.member_reference),
    requested_on:e.requested_on,confirmed_on:e.confirmed_on,policy_to:e.policy_to,policy_current:e.policy_from<=date&&e.policy_to>=date,
    dependants:dependantsOf(db,e.id).map(d=>({id:d.id,relation:d.relation,relation_name:RELATIONS.find(r=>r.key===d.relation).name,birth_date:d.birth_date,added_on:d.added_on,removed_on:d.removed_on,version:d.version}))};
}
export const enrolmentOwner=(db,tenantId,enrolmentId)=>typeof enrolmentId==='string'?db.prepare('SELECT employee_id FROM medical_enrolments WHERE id=? AND tenant_id=?').get(enrolmentId,tenantId)?.employee_id??null:null;
export const hasOpenEnrolment=(db,tenantId,employeeId)=>!!openEnrolment(db,tenantId,employeeId);
export function activeDependant(db,tenantId,employeeId,dependantId){
  const e=openEnrolment(db,tenantId,employeeId);
  const d=e&&typeof dependantId==='string'&&db.prepare('SELECT id,relation,version FROM medical_dependants WHERE id=? AND tenant_id=? AND enrolment_id=? AND removed_on IS NULL').get(dependantId,tenantId,e.id);
  return d?{id:d.id,relation:d.relation,relation_name:RELATIONS.find(r=>r.key===d.relation).name,version:d.version}:null;
}
// يطبّق طلب إضافة تابع اعتمده مسؤول المزايا: التسجيل يُستخرج من صاحب الطلب لا من مدخل حر.
export function applyDependantAddition(db,supplied,employeeId,{relation,birth_date,added_on}){
  const u=actor(db,supplied),e=openEnrolment(db,u.tenant_id,employeeId);
  if(!e)fail(409,'no_enrolment','لا تسجيل تأمين قائمًا لصاحب الطلب. سجّله في الوثيقة أولًا');
  return addDependant(db,u,{relation,birth_date,added_on},e.id);
}
// ترقية فئة التأمين على حساب الموظف (فجوة تسليم الدمج §5): الترقية المعتمدة كانت تنتهي بخصم مقترح ولا تغيّر فئة التسجيل،
// فيبقى السجل يقول الفئة القديمة. تستدعيها «مزاياي» وحدها بعد اكتمال مسار الطلب: الموارد البشرية تحدد فرق القسط ثم تؤكده المالية،
// وكلا القرارين مفروض في الكود وفي مخطط الترحيل 103 (صاحب الطلب لا يقرر، ومن قرر في الموارد البشرية لا يؤكد ماليًا).
// لا تصريح مستقل هنا لأن الإذن جاء من ذلك المسار؛ ويبقى فصل المهام: لا يرقّي أحد فئة تأمينه هو.
// المنصة لا تبلّغ شركة التأمين: التبليغ يجري لديها خارج المنصة، وهذا السجل تذكير بما يجب فعله.
export function applyClassUpgrade(db,supplied,employeeId,tier,{reason='',reference=null}={}){
  writing(db);const u=actor(db,supplied);
  const e=openEnrolment(db,u.tenant_id,employeeId);
  if(!e)fail(409,'no_enrolment','لا تسجيل تأمين قائمًا لصاحب الطلب؛ لا فئة تُرقّى');
  if(e.employee_id===u.id)fail(409,'separation_of_duties','لا يغيّر أحد فئة تأمينه هو');
  if(!JSON.parse(e.tiers).includes(tier))fail(400,'tier','الفئة غير موجودة في فئات الوثيقة');
  if(e.tier===tier)fail(409,'no_change','التسجيل على هذه الفئة أصلًا');
  db.prepare('UPDATE medical_enrolments SET tier=?,version=version+1,updated_at=? WHERE id=?').run(tier,now(),e.id);
  audit(db,u,'medical_enrolment',e.id,'benefits.class_upgraded',{tier:e.tier},{tier,reference},reason);
  return {enrolment_id:e.id,from_tier:e.tier,tier,version:e.version+1};
}
export function applyDependantRemoval(db,supplied,employeeId,dependantId,removedOn){
  const u=actor(db,supplied),d=activeDependant(db,u.tenant_id,employeeId,dependantId);
  if(!d)fail(409,'dependant_unavailable','التابع غير مسجل حاليًا على تأمين صاحب الطلب');
  return removeDependant(db,u,d.id,{version:d.version,removed_on:removedOn});
}
