import { randomUUID } from 'node:crypto';
import { audit, now } from './db.mjs';
import { fail } from './auth.mjs';
import * as v from './validation.mjs';
import { currentUser } from './delegations.mjs';
import { can } from './access.mjs';
import { sensitiveGrantAlert } from './security-alerts.mjs';
import { riyadhDate } from './work-calendar.mjs';
import { riyadhDateOf, riyadhDayRange } from './riyadh-time.mjs';
import { MAX_FINANCE_AUTHORITY_DAYS, authorityCapDays } from './authority-limits.mjs';

// أفق الصلاحية المالية. رقمه **مقيس لا مستعار**: كل تفويض مالي سارٍ على قاعدة التشغيل اليوم مدته 365 يومًا
// بالضبط (13 صفًّا، من 2026-01-01 إلى 2027-01-01، ومنح رئيس المالية من 2026-09-23 إلى 2027-09-22).
// فسقفٌ أقصر يرفض أول تجديد لتفويض قائم، وهو تضييق لم يطلبه أحد. والغرض هنا منع «حتى 2099» لا تقصير السنة.
// وهو أطول من أفق التفويض الإداري (MAX_DELEGATION_DAYS=180) عن قصد: ذاك تغطية غياب، وهذا دورة مالية سنوية.
// الرقم يخص المالك كقيمة معتمدة مؤرَّخة (الترحيل 134: «النسخة 0 = افتراضات الكود»)، وهذا هو الافتراض.
export { MAX_FINANCE_AUTHORITY_DAYS } from './authority-limits.mjs';

// منح التفويض المالي وسحبه (تدقيق دورة التسليم 20260920، B4).
// `finance_grants` هو ما يفتح كل المالية: الاستحقاقات والفواتير والمدفوعات والدفتر والمخصصات.
// كان يُقرأ في finance.currentActor ولا يكتبه أي مسار: على قاعدة حقيقية المالية مقفلة على الجميع
// إلى الأبد، ولا سبيل لفتحها من المنصة إلا بإدراج SQL مباشر. هذا الملف هو المسار الناقص.
//
// أربع قواعد:
//   (1) المنح لحامل تصريح `finance.grants.manage` وحده، وهو تصريح حساس لا يفتحه امتياز الأدمن الأول وحده.
//   (2) قاعدة الشخصين: لا أحد يفوّض نفسه (قيد CHECK(user_id<>granted_by) في ترحيل 007 كذلك).
//   (3) لكل تفويض نهاية: `valid_until` إلزامي ولا يكون في الماضي. التفويض ينتهي بنفسه.
//   (4) السحب لا يمحو: `revoked_at` وحده يتغير (مُحكَم بمُشغِّل في ترحيل 007)، والسجل يبقى.

const id=()=>randomUUID();
const today=()=>riyadhDate(Date.now());

// أفعال التفويض المالي كما يقرؤها finance.currentActor وكما يحصرها CHECK في ترحيل 007.
export const FINANCE_ACTIONS=[
  {key:'read',name:'قراءة الدفتر والتقارير المالية',note:'بلا هذا الفعل لا تُفتح أي شاشة مالية.'},
  {key:'configure',name:'إعداد المراجع المالية: الحسابات ومراكز التكلفة والفترات'},
  {key:'prepare',name:'إعداد القيود والمستندات المالية'},
  {key:'approve',name:'اعتماد القيود',note:'من أعدّ القيد لا يعتمده؛ الفصل مفروض على كل مستند على حدة.'},
  {key:'post',name:'ترحيل القيود إلى الدفتر'},
  {key:'reverse',name:'عكس قيد مرحّل'},
  {key:'source_procurement',name:'إنشاء قيد من مستحق مشتريات مطابَق'}
];
const ACTION_BY_KEY=new Map(FINANCE_ACTIONS.map(a=>[a.key,a]));

// قيد ترحيل 007: granted_role IN ('employee','manager','pm')، وfinance.currentActor يطابق
// granted_role بدور الحساب نفسه. فدورا `hr` و`it` لا يمكن أن يحملا تفويضًا ماليًا اليوم.
// هذا قرار قائم لا اجتهاد من هذا الملف: يُعرض على الشاشة ويبقى قرارًا للمالك (انظر الوثيقة).
export const GRANTABLE_ROLES=['employee','manager','pm'];
export const ROLE_CONSTRAINT={
  key:'finance_grant_roles',
  title:'الأدوار التي يجوز تفويضها ماليًا',
  detail:'قيد قاعدة البيانات في ترحيل 007 يحصر التفويض المالي في أدوار موظف ومدير ومدير مشروع، '
    +'وfinance.currentActor يطابق دور الحساب بدور التفويض. فحساب بدور «الموارد البشرية» أو «تقنية المعلومات» '
    +'لا يمكن تفويضه ماليًا، ولو منحه الأدمن التصريح. لم تُوسَّع القائمة هنا: توسيعها قرار مالك، وهي '
    +'تحتاج ترحيلًا يغيّر القيد ويغيّر قائمة الأدوار في finance.currentActor معًا.'
};

function actor(db,supplied){const u=currentUser(db,supplied);if(!u)fail(403,'forbidden','الحساب غير متاح');return u;}
function writing(db){if(!db.isTransaction)fail(500,'transaction_required','يلزم تنفيذ منح التفويض المالي داخل معاملة');}
const requireManager=(db,u)=>{
  if(!can(db,u,'finance.grants.manage'))
    fail(403,'not_permitted','منح التفويض المالي وسحبه لحامل تصريح «منح التفويض المالي» وحده. وهو تصريح حساس يُمنح صراحةً');
};
// الحقلان في الجدول طابعان زمنيان (UTC) يقارنهما finance.currentActor بـnow()، والتاريخان المُدخلان يوما رياض.
// فالبداية منتصف ليل الرياض في يومها (21:00 UTC من اليوم السابق)، والنهاية آخر جزء من الثانية في يوم الرياض الأخير.
// كانا منتصف ليل UTC وآخر لحظة في يوم UTC: يبدأ التفويض الساعة 03:00 بتوقيت الرياض، ويبقى ساريًا ثلاث ساعات بعد يومه الأخير.
// الصفوف المكتوبة قبل هذا التصحيح تبقى على ترميزها (الجدول لا يُعدَّل إلا بالسحب)، ولذلك يُعرض اليومان بطريقة تصح للترميزين:
// البداية بيوم الرياض للحظتها، والنهاية بأول عشرة أحرف منها (آخر لحظة في يوم الرياض 31 أكتوبر هي 20:59:59.999 UTC منه، وكانت في الترميز القديم 23:59:59.999 UTC منه — والتاريخ في أول عشرة أحرف من الاثنين هو اليوم نفسه).
const startOf=date=>riyadhDayRange(date)[0];
const endOf=date=>new Date(Date.parse(riyadhDayRange(date)[1])-1).toISOString();
const liveAt=(row,time)=>row.revoked_at===null&&row.valid_from<=time&&row.valid_until>time;

export function financeGrantView(db,row,time){
  const person=userId=>db.prepare('SELECT name,username FROM users WHERE id=?').get(userId)??null;
  const holder=person(row.user_id),by=person(row.granted_by);
  const state=row.revoked_at?'revoked':row.valid_until<=time?'expired':row.valid_from>time?'scheduled':'live';
  return {id:row.id,user_id:row.user_id,user_name:holder?.name??row.user_id,username:holder?.username??'',
    granted_role:row.granted_role,action:row.action,action_name:ACTION_BY_KEY.get(row.action)?.name??row.action,
    valid_from:riyadhDateOf(row.valid_from),valid_until:row.valid_until.slice(0,10),
    granted_by:row.granted_by,granted_by_name:by?.name??row.granted_by,evidence:row.evidence,
    revoked_at:row.revoked_at,state,
    state_name:{live:'ساري',scheduled:'يبدأ لاحقًا',expired:'منتهٍ',revoked:'مسحوب'}[state],
    // الأيام المتبقية تُعرض حتى لا ينتهي تفويض المالية فجأة في يوم إقفال.
    days_left:state==='live'?Math.max(0,Math.ceil((Date.parse(row.valid_until)-Date.parse(time))/86400000)):null};
}

export function financeGrantsBoard(db,supplied){
  const u=actor(db,supplied);
  requireManager(db,u);
  const time=now();
  const rows=db.prepare('SELECT * FROM finance_grants WHERE tenant_id=? ORDER BY created_at DESC').all(u.tenant_id)
    .map(row=>financeGrantView(db,row,time));
  const people=db.prepare(`SELECT id,name,username,role,department_id FROM users WHERE tenant_id=? AND active=1 AND role IN (${GRANTABLE_ROLES.map(()=>'?').join(',')}) ORDER BY name`)
    .all(u.tenant_id,...GRANTABLE_ROLES);
  const blocked=db.prepare("SELECT id,name,username,role FROM users WHERE tenant_id=? AND active=1 AND role NOT IN ('employee','manager','pm') AND role<>'admin' ORDER BY name").all(u.tenant_id);
  const live=rows.filter(r=>r.state==='live');
  // من يحمل الإعداد والاعتماد معًا: لا يُمنع هنا — فصل المهام مفروض على كل مستند — لكنه يُعرض للمراجع.
  const both=[...new Set(live.filter(r=>r.action==='prepare').map(r=>r.user_id))]
    .filter(userId=>live.some(r=>r.user_id===userId&&r.action==='approve'))
    .map(userId=>live.find(r=>r.user_id===userId).user_name);
  return {today:today(),user_id:u.id,
    actions:FINANCE_ACTIONS,roles:GRANTABLE_ROLES,people,
    // الحسابات التي يمنعها القيد: تُسمّى بدل أن تختفي، فلا يبحث المسؤول عن سبب غيابها.
    blocked_accounts:blocked,role_constraint:ROLE_CONSTRAINT,
    grants:rows,live_count:live.length,
    expiring:live.filter(r=>r.days_left!==null&&r.days_left<=30),
    prepare_and_approve:both,
    can_manage:true,
    note:'التفويض المالي غير التصريح: التصريح يفتح الشاشة، والتفويض يفتح الفعل في الدفتر. لكل تفويض تاريخ انتهاء، '
      +'ولا أحد يفوّض نفسه، والسحب لا يمحو السجل. تغيير التفويض لا يغيّر قرارًا مضى: القيود المرحّلة تبقى بمن رحّلها.'};
}

export function grantFinanceAction(db,supplied,input){
  writing(db);
  const u=actor(db,supplied);
  requireManager(db,u);
  v.object(input,['user_id','action','valid_from','valid_until','evidence']);
  const target=db.prepare('SELECT id,name,role,active FROM users WHERE id=? AND tenant_id=? AND active=1').get(input.user_id,u.tenant_id);
  if(!target)fail(404,'not_found','الحساب غير متاح');
  // قاعدة الشخصين: من يمنح لا يُمنح. القيد نفسه مكتوب في ترحيل 007، وهنا رسالته بالعربية.
  if(target.id===u.id)fail(403,'two_person','التفويض المالي يمنحه غيرك: من يمنح لا يمنح نفسه');
  if(!GRANTABLE_ROLES.includes(target.role))
    fail(400,'granted_role',`${ROLE_CONSTRAINT.detail} الحساب «${target.name}» بدور لا يقبله القيد اليوم`);
  if(!ACTION_BY_KEY.has(input.action))fail(400,'action','فعل التفويض المالي غير معروف');
  const from=v.date(input.valid_from),until=v.date(input.valid_until);
  if(until<=from)fail(400,'valid_until','نهاية التفويض بعد بدايته');
  // تفويض ينتهي قبل اليوم يولد ميتًا: يُرفض بدل أن يُحفظ ويُظن ساريًا.
  if(until<=today())fail(400,'valid_until','نهاية التفويض في الماضي؛ التفويض المنتهي لا يُنشأ');
  // وسقف أعلى أيضًا: التفويض المالي بُني ليكون مؤقتًا — «يُمنح بتاريخ انتهاء» كما يقول الخادم عند مساره — ولم يكن شيء
  // يمنع «حتى 2099»، فيصير صلاحية مالية دائمة عبر بابٍ مصمَّم للمؤقت، ينبّه مرة عند منحه ثم لا يراجعه أحد.
  // الأفق مقيس من التفويضات السارية نفسها (انظر تعريف الثابت أعلاه)، وهو تقني لا نظامي: يمنع التاريخ المنسيّ لا أكثر.
  const capDays=authorityCapDays(db,u.tenant_id,'finance_authority_max_days',MAX_FINANCE_AUTHORITY_DAYS);
  if(Date.parse(until)-Date.parse(from)>capDays*86400000)fail(400,'valid_until',`أقصى مدة للتفويض المالي ${capDays} يومًا. التفويض الدائم صلاحية لا تفويض`);
  const evidence=v.text(input.evidence,'سند التفويض: من قرره وأين وثّقه',500,10);
  const time=now(),validFrom=startOf(from),validUntil=endOf(until);
  const clash=db.prepare('SELECT * FROM finance_grants WHERE tenant_id=? AND user_id=? AND action=? AND revoked_at IS NULL')
    .all(u.tenant_id,target.id,input.action).find(row=>row.valid_until>validFrom&&row.valid_from<validUntil);
  if(clash)fail(409,'already_granted',`لهذا الحساب تفويض «${ACTION_BY_KEY.get(input.action).name}» يغطي هذه المدة (حتى ${clash.valid_until.slice(0,10)}). اسحبه أولًا إن أردت استبداله`);
  const grantId=id();
  db.prepare('INSERT INTO finance_grants VALUES(?,?,?,?,?,?,?,?,?,?,?)')
    .run(grantId,u.tenant_id,target.id,target.role,input.action,validFrom,validUntil,u.id,evidence,null,time);
  audit(db,u,'finance_grant',grantId,'finance.grant_issued',{},
    {user_id:target.id,granted_role:target.role,action:input.action,valid_from:validFrom,valid_until:validUntil},evidence);
  sensitiveGrantAlert(db,u,target.id,`تفويض مالي: ${ACTION_BY_KEY.get(input.action).name} حتى ${until}`);
  return {id:grantId};
}

export function revokeFinanceGrant(db,supplied,grantId,input){
  writing(db);
  const u=actor(db,supplied);
  requireManager(db,u);
  v.object(input,['reason']);
  const row=typeof grantId==='string'&&db.prepare('SELECT * FROM finance_grants WHERE id=? AND tenant_id=?').get(grantId,u.tenant_id);
  if(!row)fail(404,'not_found','التفويض غير متاح');
  if(row.revoked_at)fail(409,'already_revoked','التفويض مسحوب أصلًا');
  const reason=v.text(input.reason,'سبب السحب',500,10),time=now();
  db.prepare('UPDATE finance_grants SET revoked_at=? WHERE id=?').run(time,row.id);
  audit(db,u,'finance_grant',row.id,'finance.grant_revoked',{action:row.action,valid_until:row.valid_until},{revoked_at:time},reason);
  return {revoked:true};
}

// يقرؤها اختبار الانحدار وشاشة الجاهزية: هل في الكيان تفويض قراءة مالية ساري أصلًا؟
export const financeOpen=(db,tenantId)=>{
  const time=now();
  return db.prepare("SELECT * FROM finance_grants WHERE tenant_id=? AND action='read'").all(tenantId).some(row=>liveAt(row,time));
};
