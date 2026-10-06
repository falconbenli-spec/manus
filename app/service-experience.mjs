import { randomUUID } from 'node:crypto';
import { audit, now } from './db.mjs';
import { fail } from './auth.mjs';
import * as v from './validation.mjs';
import { currentUser } from './delegations.mjs';
import { can } from './access.mjs';
import { getRequest, serviceOf } from './workflow.mjs';
import { feedbackView, recordFeedback } from './service-feedback.mjs';
import { insightScope, NO_BLAME } from './insight-scope.mjs';
import { riyadhDate } from './work-calendar.mjs';

// قياس التجربة: سؤال واحد بعد الإغلاق، لا استبيان. الاستبيان الطويل بعد كل طلب لا يجيب عنه أحد،
// ومن يجيب عنه مضطرًا يجيب بلا عناية، فيصير الرقم أسوأ من لا رقم.
//
// التخزين: هذه الوحدة **لا تنشئ سجل رأي ثانيًا**. `app/service-feedback.mjs` موجود مسبقًا ويكتب في
// `request_feedback` بقيوده (لصاحب الطلب وحده، بعد الإنجاز، مرة واحدة، غير قابل للتعديل). هذه الوحدة
// تبني فوقه: تصيغ السؤال بثلاثة خيارات، وتترجمها إلى مقياسه القائم، وتتولى التجميع والحد الأدنى.
// الخيارات الثلاثة تُخزَّن في عمود التقييم القائم (1–5)، وتُقرأ منه بتجميع صريح: 4–5 «نعم»، 3 «جزئيًا»، 1–2 «لا».
// وبذلك تبقى التقييمات القديمة المسجَّلة بالمقياس الخماسي مقروءة ولا تُهدر.

const id=()=>randomUUID();
const today=()=>riyadhDate(Date.now());
export const QUESTION='هل أنجز هذا الطلب حاجتك؟';
export const ANSWERS={
  met:{rating:5,label:'نعم، أنجز حاجتي'},
  partly:{rating:3,label:'جزئيًا؛ بقي شيء'},
  not_met:{rating:1,label:'لا، لم يُنجز حاجتي'}
};
export const bucketOf=rating=>rating>=4?'met':rating===3?'partly':'not_met';

function actor(db,supplied){const u=currentUser(db,supplied);if(!u)fail(403,'forbidden','الحساب غير متاح');return u;}
function writing(db){if(!db.isTransaction)fail(500,'transaction_required','تتطلب الكتابة معاملة قاعدة بيانات');}

export const liveThreshold=(db,tenantId)=>db.prepare('SELECT * FROM experience_settings WHERE tenant_id=? AND superseded_at IS NULL').get(tenantId)??null;

// الحد الأدنى إعداد مؤرَّخ بسنده لا ثابت في الكود: المنصة لا تعرف كم إجابة تكفي لإخفاء صاحب الرأي في هذه الشركة.
export function setExperienceThreshold(db,supplied,input){
  writing(db);const u=actor(db,supplied);
  if(!can(db,u,'catalog.manage'))fail(403,'not_permitted','حد إظهار النتائج المجمّعة يضعه مسؤول إعداد الخدمات');
  v.object(input,['min_responses','basis','confirmed_on']);
  const min=Number(input.min_responses);
  if(!Number.isInteger(min)||min<3||min>50)fail(400,'min_responses','الحد الأدنى من 3 إلى 50 إجابة');
  const basis=v.text(input.basis,'سند الحد ومن أقرّه',2000,10),confirmed=v.date(input.confirmed_on);
  if(confirmed>today())fail(400,'confirmed_on','تاريخ تأكيد الحد لا يكون في المستقبل');
  const previous=liveThreshold(db,u.tenant_id),time=now(),row=id();
  if(previous)db.prepare('UPDATE experience_settings SET superseded_at=? WHERE id=?').run(time,previous.id);
  db.prepare('INSERT INTO experience_settings(id,tenant_id,min_responses,basis,confirmed_on,set_by,created_at) VALUES(?,?,?,?,?,?,?)')
    .run(row,u.tenant_id,min,basis,confirmed,u.id,time);
  audit(db,u,'experience_setting',row,'experience.threshold_set',previous?{min_responses:previous.min_responses}:{},{min_responses:min,confirmed_on:confirmed},basis);
  return {min_responses:min,confirmed_on:confirmed};
}

export function experienceQuestion(db,supplied,requestId){
  const u=actor(db,supplied),r=getRequest(db,u,requestId),view=feedbackView(db,u,requestId);
  const answered=view.feedback?{answer:bucketOf(view.feedback.rating),label:ANSWERS[bucketOf(view.feedback.rating)].label,
    comment:view.feedback.comment,at:view.feedback.created_at}:null;
  return {request:{id:r.id,title:r.title,status:r.status,version:r.version,service:serviceOf(db,r).name_ar},
    question:QUESTION,options:Object.entries(ANSWERS).map(([value,a])=>({value,label:a.label})),
    can_answer:view.can_rate,answered,
    note:'سؤال واحد بعد إغلاق الطلب، والتعليق اختياري إلا حين تكون الإجابة «لا» فيلزم سطر يوضح ما نقص. لا يُنسب رأيك إليك في أي شاشة مجمّعة، ولا يُحسب رضًا لأي منفّذ باسمه.'};
}

export function answerExperience(db,supplied,requestId,input){
  writing(db);const u=actor(db,supplied);
  v.object(input,['version','answer','comment']);
  const choice=ANSWERS[input.answer];
  if(!choice)fail(400,'answer','اختر إجابة من الخيارات الثلاثة');
  // الكتابة كلها عبر الوحدة القائمة: قيودها (صاحب الطلب، بعد الإنجاز، مرة واحدة، غير قابل للتعديل) تبقى مصدرًا واحدًا.
  recordFeedback(db,u,requestId,{version:input.version,rating:choice.rating,comment:input.comment??''});
  return experienceQuestion(db,u,requestId);
}

// النتائج المجمّعة: بالخدمة أو بالإدارة، ولا شيء ثالث.
// لا يُحسب رضا لكل منفّذ باسمه: ذلك يحوّل المقياس إلى أداة ضغط، فيجامل الموظفُ زميله أو ينتقم منه،
// ويصير الرقم انعكاسًا للعلاقات لا للخدمة. ولذلك لا يقرأ هذا الاستعلام عمود `assigned_to` إطلاقًا.
export function experienceSummary(db,supplied,query={}){
  const {u,departments}=insightScope(db,supplied);
  const groupBy=['service','department'].includes(query.group_by)?query.group_by:'service';
  const threshold=liveThreshold(db,u.tenant_id);
  const rows=db.prepare(`SELECT f.rating,f.comment,s.code AS service_code,s.name_ar AS service_name,
      COALESCE(r.handling_department_id,s.department_id) AS department_id,f.created_at
    FROM request_feedback f JOIN requests r ON r.id=f.request_id JOIN services s ON s.id=r.service_id
    WHERE f.tenant_id=?`).all(u.tenant_id)
    .filter(row=>!departments||departments.includes(row.department_id));
  const names=Object.fromEntries(db.prepare('SELECT id,name FROM departments WHERE tenant_id=?').all(u.tenant_id).map(d=>[d.id,d.name]));
  if(!threshold)return {available:false,group_by:groupBy,groups:[],suppressed:rows.length?1:0,answers:rows.length,
    reason:'لم يُحدَّد بعد الحد الأدنى لعدد الإجابات قبل إظهار نتيجة مجمّعة، ولذلك لا تُعرض نتيجة. في إدارة من ثلاثة أشخاص، متوسطٌ على إجابتين يكشف صاحب الرأي.',
    note:NO_BLAME};

  const buckets=new Map();
  for(const row of rows){
    const key=groupBy==='service'?row.service_code:row.department_id;
    const label=groupBy==='service'?`${row.service_code} · ${row.service_name}`:names[row.department_id]??row.department_id;
    const entry=buckets.get(key)??{key,label,met:0,partly:0,not_met:0,answers:0,comments:[]};
    entry[bucketOf(row.rating)]++;entry.answers++;
    if(String(row.comment??'').trim())entry.comments.push(row.comment.trim());
    buckets.set(key,entry);
  }
  const all=[...buckets.values()],min=threshold.min_responses;
  // إخفاء ثانوي: الإدارة مجموع خدماتها، فإن طُويت خدمة لقلة إجاباتها وظهرت الإدارة وظهرت أخواتها،
  // كشف طرحُ الخدمات الظاهرة من الإدارة إجابةَ صاحب الخدمة المطوية وتعليقه. لذلك تُحسب الخلايا (إدارة × خدمة)
  // في العرضين معًا، فلا يختلف ما يُطوى بتغيير طريقة التجميع.
  const cells=new Map(),serviceTotals=new Map();
  for(const row of rows){
    const cell=`${row.department_id}\u0000${row.service_code}`;
    cells.set(cell,(cells.get(cell)??0)+1);
    serviceTotals.set(row.service_code,(serviceTotals.get(row.service_code)??0)+1);
  }
  const underDepartment=department=>[...cells].filter(([cell])=>cell.split('\u0000')[0]===department).map(([cell,n])=>({service:cell.split('\u0000')[1],n}));
  const departmentVisible=department=>{
    const parts=underDepartment(department),total=parts.reduce((n,p)=>n+p.n,0);
    const covered=parts.filter(p=>(serviceTotals.get(p.service)??0)>=min).reduce((n,p)=>n+p.n,0);
    const residual=total-covered;
    return total>=min&&!(residual>0&&residual<min);
  };
  // تعليقات الإدارة لا تُعرض إلا إن بلغت كل خدمة تحتها الحد في هذه الإدارة: تعليق خدمة مطوية يظهر في الإدارة
  // ويغيب عن الخدمات الظاهرة، فيُعرف أنه لصاحبها.
  const departmentComments=department=>underDepartment(department).every(p=>p.n>=min);
  const visible=g=>groupBy==='service'?g.answers>=min:departmentVisible(g.key);
  const shown=all.filter(visible).map(g=>({
    key:g.key,label:g.label,answers:g.answers,met:g.met,partly:g.partly,not_met:g.not_met,
    met_percent:Math.round(g.met*100/g.answers),not_met_percent:Math.round(g.not_met*100/g.answers),
    // التعليقات بلا صاحب وبلا ترتيب زمني: الترتيب الزمني وحده يربط التعليق بطلب بعينه فيكشف كاتبه.
    comments:g.comments.length>=2&&(groupBy==='service'||departmentComments(g.key))?[...g.comments].sort((a,b)=>a.localeCompare(b,'ar')):[]
  })).sort((a,b)=>b.answers-a.answers);
  return {available:true,group_by:groupBy,min_responses:threshold.min_responses,basis:threshold.basis,confirmed_on:threshold.confirmed_on,
    answers:rows.length,groups:shown,suppressed:all.length-shown.length,
    question:QUESTION,
    note:`${NO_BLAME} لا تُعرض نتيجة لمجموعة أقل من ${threshold.min_responses} إجابات، وتُطوى تعليقاتها كذلك. وتُطوى الإدارة أيضًا إن كان ما يبقى منها بعد طرح خدماتها الظاهرة أقل من الحد، ولا تُعرض تعليقات إدارة إلا إن بلغت كل خدمة تحتها الحد. النتائج مبنية على سجل التقييم القائم في المنصة (`+'`request_feedback`'+`)، والمقياس الخماسي القديم مقروء ضمنها: 4–5 «نعم»، 3 «جزئيًا»، 1–2 «لا».`};
}
