import { randomUUID } from 'node:crypto';
import { audit, now } from './db.mjs';
import { fail } from './auth.mjs';
import * as v from './validation.mjs';
import { can, isSuperAdmin } from './access.mjs';
import { canApproveThresholds } from './workflow.mjs';
import { refuse, actorOrRefuse } from './refusal.mjs';
import { MAX_DELEGATION_DAYS, MAX_FINANCE_AUTHORITY_DAYS } from './authority-limits.mjs';

// مهل محرك العمل (الموجة 2 «لا طلب يضيع»، ترحيل 126). القاعدة الحاكمة: المهلة رقم تنظيمي، والرقم التنظيمي مسودة لا تفعل شيئًا
// حتى يتبناها شخص ثانٍ. لا قيمة افتراضية في الكود ولا صف ابتدائي في القاعدة: ما لم يقرره المالك لا تتصرف المنصة بناءً عليه،
// وإصلاحات الرؤية (الطلب المعاد في مواضعه الثلاثة) تعمل بلا أي مهلة. من يقرأ مهلة يقرؤها من adoptedTimers وحدها.
//
// كل مفتاح: وحدته، وحدّاه، ومعناه بالضبط، وما يبقى يدويًا ما لم يُتبنَّ (manual)، وهل له قارئ اليوم (wired).
// مفتاح بلا قارئ لا يُقبل اقتراحه: تبنّي مهلة لا يقرؤها شيء ادعاءٌ بأتمتة غير موجودة. القارئ الوحيد هو التشغيل اليومي
// (app/workflow-sweep.mjs)، ومن يضيف قارئًا لمفتاح يقلب wired إلى true في السطر نفسه — لا قبل ذلك.
export const TIMER_KEYS=Object.freeze({
  returned_reminder_first:{unit:'working_days',min:1,max:60,wired:true,name:'التذكير الأول بالطلب المعاد',
    meaning:'عدد أيام العمل منذ أُعيد الطلب إلى صاحبه، يُذكَّر بعدها أول مرة بأن طلبه ينتظر ردّه وأن ساعته متوقفة.',
    manual:'لا يُذكَّر صاحب الطلب المعاد آليًا. الطلب ظاهر في «ما ينتظر ردّي» عنده وفي «أعدتُها وتنتظر» عند من أعاده، ومن أعاده يتابعه بنفسه.'},
  returned_reminder_second:{unit:'working_days',min:2,max:90,wired:true,name:'التذكير الثاني بالطلب المعاد',
    meaning:'عدد أيام العمل منذ الإعادة، يُذكَّر بعدها صاحب الطلب مرة ثانية ويُخبَر من أعاده. أكبر من التذكير الأول.',
    manual:'لا تذكير ثانٍ آليًا.'},
  returned_expiry:{unit:'working_days',min:3,max:120,wired:true,name:'انقضاء الطلب المعاد',
    meaning:'عدد أيام العمل منذ الإعادة، ينقضي بعدها الطلب لعدم الرد: يُغلق ويُبلَّغ صاحبه ومن أعاده. أكبر من كل تذكير معتمد، ولا يُتبنى بلا تذكير أول معتمد: لا ينقضي طلب لم يُذكَّر صاحبه.',
    manual:'الطلب المعاد لا ينقضي أبدًا من تلقاء نفسه: يبقى مفتوحًا بعمره الظاهر حتى يرد صاحبه أو يلغيه.'},
  approval_escalation:{unit:'working_days',min:1,max:30,wired:true,name:'تصعيد خطوة الاعتماد',
    meaning:'عدد أيام العمل التي تنتظرها خطوة اعتماد عند صاحب قرارها قبل أن يُنقل قرارها إلى الدرجة التالية في سُلَّم تصعيد إدارتها. يُقاس من وصول الخطوة إليه، لا من آخر تعديل على الطلب.',
    manual:'لا يُنقل قرار خطوة متأخرة آليًا. «تذكير المعتمد» متاح لصاحب الطلب بعد 24 ساعة، ونقل القرار يدويًا لمن يدير الهيكل والتصعيد بسبب مكتوب.'},
  unclaimed_alert:{unit:'working_days',min:1,max:30,wired:false,name:'تنبيه الطلب بلا مستلم',
    meaning:'عدد أيام العمل التي يبقاها طلب معتمد في طابور إدارته المنفذة بلا مستلم، يُنبَّه بعدها منفذوها ومديرها.',
    manual:'لا تنبيه آليًا بطلب معتمد لم يستلمه أحد؛ يظهر في طابور الإدارة وفي «العمل اليومي» بعمره.'},
  due_soon_alert:{unit:'working_days',min:1,max:10,wired:false,name:'تنبيه اقتراب الاستحقاق',
    meaning:'عدد أيام العمل قبل يوم استحقاق الطلب (من زمن خدمته وتقويم العمل)، يُنبَّه عندها من يحمل الطلب. لا يعمل لخدمة زمنها بالساعات: التشغيل يومي.',
    manual:'لا تنبيه آليًا قبل الاستحقاق.'},
  overdue_alert:{unit:'working_days',min:1,max:30,wired:false,name:'تنبيه التأخر',
    meaning:'عدد أيام العمل بعد فوات زمن الخدمة، يُنبَّه عندها من يحمل الطلب ومدير الإدارة المنفذة. 1 = أول يوم عمل بعد يوم الاستحقاق.',
    manual:'لا تنبيه آليًا بفوات زمن الخدمة؛ التأخر ظاهر في الرئيسية و«العمل اليومي» والتقارير.'},
  overdue_escalation_alert:{unit:'working_days',min:2,max:60,wired:false,name:'تنبيه مرجع التصعيد بالتأخر',
    meaning:'عدد أيام العمل بعد فوات زمن الخدمة، يُنبَّه عندها مرجع تصعيد الإدارة المنفذة. أكبر من تنبيه التأخر.',
    manual:'لا يُنبَّه مرجع التصعيد آليًا بتأخر التنفيذ.'},
  // سقفا مدة الصلاحية المؤقتة (ترحيل 147). يخالفان قاعدة هذه الوحدة «لا قيمة افتراضية في الكود» عمدًا،
  // ويُقال صراحةً: لهما سقف يعمل بلا تبنٍّ في app/authority-limits.mjs، لأنهما يمنعان صلاحيةً دائمة بثوب
  // مؤقت («حتى 2099»)، وتركُ ذلك مفتوحًا حتى يُعتمد رقمٌ تراجعٌ أمني لا حياد فيه. فالمُتبنّى لا يفتح شيئًا
  // بل **يشدّ وحده**: حدّ المفتاح الأعلى هو سقف الكود نفسه، فلا يُقترح رقم يتجاوزه.
  // والوحدة أيام تقويم: التفويض يغطي غيبةً تمرّ بالعطل والإجازات، فعدُّها بأيام العمل يجعل المدة الفعلية
  // أطول مما قرّره المالك. وقيد القاعدة وسّعه الترحيل 147 ليعرف الوحدة وسقفها السنوي.
  delegation_max_days:{unit:'calendar_days',min:1,max:MAX_DELEGATION_DAYS,wired:true,name:'أقصى مدة لتفويض الاعتماد',
    meaning:'أكبر عدد أيام بين بداية تفويض الاعتماد ونهايته. التفويض تغطية غياب؛ وما طال عنه نقلُ صلاحية بابه إدارة الصلاحيات لا هذا الباب.',
    manual:`يعمل سقف الكود: ${MAX_DELEGATION_DAYS} يومًا. التبني يشدّه ولا يوسّعه.`},
  finance_authority_max_days:{unit:'calendar_days',min:1,max:MAX_FINANCE_AUTHORITY_DAYS,wired:true,name:'أقصى مدة للتفويض المالي والنطاق المالي',
    meaning:'أكبر عدد أيام لتفويض مالي أو لنطاق مالي على مشروع. رقم الكود مقيس من التفويضات السارية على قاعدة التشغيل: كلها سنة كاملة.',
    manual:`يعمل سقف الكود: ${MAX_FINANCE_AUTHORITY_DAYS} يومًا. التبني يشدّه ولا يوسّعه.`},
});
// ترتيب لا يصح كسره: التذكير الأول قبل الثاني قبل الانقضاء، وتنبيه التأخر قبل تنبيه مرجع التصعيد.
const ORDERED=[['returned_reminder_first','returned_reminder_second','returned_expiry'],['overdue_alert','overdue_escalation_alert']];
const UNIT_NAMES={working_days:'يوم عمل',working_hours:'ساعة عمل',calendar_days:'يوم'};
export const NOT_ADOPTED='غير متاح: لم تُعتمد مهلة';
const id=()=>randomUUID();
const known=key=>typeof key==='string'&&Object.hasOwn(TIMER_KEYS,key);
function writing(db){if(!db.isTransaction)fail(500,'transaction_required','تتطلب الكتابة معاملة قاعدة بيانات');}

// المهل السارية: المتبناة وحدها، ولمفتاح معروف له قارئ. هذا هو المصدر الوحيد الذي تقرأ منه الأتمتة.
// الصف كاملًا لا قيمته وحدها: من يتصرف بناءً على مهلة يسجّل معرّف صفها (timer_row_id) في أثره وفي سجل التدقيق.
export function adoptedTimerRows(db,tenantId){
  const out={};
  for(const row of db.prepare("SELECT * FROM workflow_timer_settings WHERE tenant_id=? AND status='adopted'").all(tenantId))
    if(known(row.timer_key)&&TIMER_KEYS[row.timer_key].wired&&row.unit===TIMER_KEYS[row.timer_key].unit)out[row.timer_key]={id:row.id,value:row.value,unit:row.unit,adopted_at:row.adopted_at,clock_from:clockFrom(db,tenantId,row)};
  return out;
}
export const adoptedTimers=(db,tenantId)=>Object.fromEntries(Object.entries(adoptedTimerRows(db,tenantId)).map(([key,row])=>[key,row.value]));
// من أي لحظة تُعدّ مهلة المفتاح: أول تبنٍّ في سلسلة التبني المتصلة الحالية، لا آخر صف. استبدال الرقم برقم (adoptTimer) يجعل الصف السابق «حلّ محله»
// في اللحظة نفسها التي يُتبنى فيها الجديد، فالمهلة لم تنقطع والساعة لا تعود إلى الصفر لما كان يُعدّ أصلًا (مراجعة 22 سبتمبر: كانت إعادة التبني
// تؤجل انقضاء طلب معاد ذُكِّر صاحبه، وتُخفي خطوة متأخرة من لوحة المتعثر). إيقاف المهلة بلا بديل (retireTimer) يقطع السلسلة: ما يُتبنى بعده يبدأ من تبنيه.
function clockFrom(db,tenantId,row){
  let current=row;
  for(const previous of db.prepare("SELECT adopted_at,superseded_at FROM workflow_timer_settings WHERE tenant_id=? AND timer_key=? AND status='superseded' AND adopted_at IS NOT NULL AND adopted_at<? ORDER BY adopted_at DESC").all(tenantId,row.timer_key,row.adopted_at)){
    if(previous.superseded_at<current.adopted_at)break;
    current=previous;
  }
  return current.adopted_at;
}
// الساعة تبدأ من التبني (وعدٌ للمالك، 22 سبتمبر 2026، قبل أن تُتبنى أي مهلة): انتظارٌ يُقاس بمهلة يبدأ عدّه من لحظة الحدث (الإعادة، وصول الخطوة)
// أو لحظة تبني المهلة، أيهما لاحق. فتبني رقم اليوم لا يُذكِّر غدًا ولا يُصعِّد ولا يُسقط ما كان مفتوحًا منذ شهرين: يبدأ عدّه من التبني، ويُقال
// ذلك في شاشة المهل وفي أثر كل تصرف (clock_started_at). بلا صف مهلة يعود الحدث نفسه. اللحظتان بصيغة ISO فتُقارنان نصًا.
// لحظة التبني هنا clock_from (أول تبنٍّ متصل)، وصفٌّ بلا clock_from يُقرأ من adopted_at كما كان.
export const clockStart=(eventAt,timer)=>{const from=timer?.clock_from??timer?.adopted_at??null;return from&&eventAt&&from>eventAt?from:eventAt;};
export const CLOCK_RULE='تُقاس كل مهلة من لحظة الحدث أو لحظة تبني المهلة أيهما لاحق: ما كان مفتوحًا قبل التبني يبدأ عدّه يوم التبني، فلا يُذكَّر ولا يُصعَّد ولا يُسقط بأثر رجعي. واستبدال الرقم برقم لا يعيد العدّ: تبقى الساعة من أول تبنٍّ لم ينقطع.';
// عزل البند الواحد في التشغيل اليومي: نقطة حفظ لكل طلب، فعطل في طلب واحد (مشغّل رفض، بيانات قديمة شاذة) يتراجع وحده ويُذكر في
// نتيجة المهمة باسمه، ولا يُسقط أثر اليوم كله ولا يميت المهمة. المعاملة الخارجية تبقى واحدة (jobs.execute).
export function isolated(db,failures,label,run){
  db.exec('SAVEPOINT wave2_item');
  try{const value=run();db.exec('RELEASE wave2_item');return value;}
  catch(error){db.exec('ROLLBACK TO wave2_item');db.exec('RELEASE wave2_item');failures.push({item:label,error:String(error?.message??error).slice(0,300)});return null;}
}
export const canProposeTimer=(db,u)=>can(db,u,'catalog.manage');
// من يتبنى: الرئاسة (من يعتمد حدود الاعتماد)، أو المالك بحسابه — وهو غير من اقترح في كل حال.
export const canAdoptTimer=(db,u)=>canApproveThresholds(db,u)||isSuperAdmin(u);

const nameOf=(db,userId)=>userId?db.prepare('SELECT name FROM users WHERE id=?').get(userId)?.name??null:null;
const liveRow=(db,tenantId,key,status)=>db.prepare('SELECT * FROM workflow_timer_settings WHERE tenant_id=? AND timer_key=? AND status=?').get(tenantId,key,status)??null;

// يفحص أن القيمة المقترحة لا تكسر ترتيب مجموعتها مقابل المهل المتبناة الآن. يعيد نص المخالفة أو null.
function orderConflict(db,tenantId,key,value){
  const adopted=adoptedTimers(db,tenantId);
  for(const chain of ORDERED){
    const at=chain.indexOf(key);if(at<0)continue;
    for(const [index,other] of chain.entries()){
      if(other===key||adopted[other]===undefined)continue;
      if(index<at&&adopted[other]>=value)return `«${TIMER_KEYS[key].name}» (${value}) يجب أن تكون أكبر من «${TIMER_KEYS[other].name}» المعتمدة (${adopted[other]})`;
      if(index>at&&adopted[other]<=value)return `«${TIMER_KEYS[key].name}» (${value}) يجب أن تكون أصغر من «${TIMER_KEYS[other].name}» المعتمدة (${adopted[other]})`;
    }
  }
  return null;
}

export function proposeTimer(db,supplied,input){
  writing(db);const u=actorOrRefuse(db,supplied);
  v.object(input,['timer_key','value','basis']);
  if(!canProposeTimer(db,u))refuse(403,'not_permitted',{what:'لا يُقترح رقم لمهل محرك العمل بحسابك',
    missing:[{document:'تصريح إدارة دليل الخدمات',why:'المهلة جزء من إعداد الخدمات',owner:'مسؤول الصلاحيات',owner_role:'admin'}],next:'اطلب التصريح، أو اطلب ممن يدير دليل الخدمات اقتراح المهلة'});
  if(!known(input.timer_key))refuse(400,'timer_key',{what:'مفتاح المهلة غير معروف',next:`المفاتيح المعتمدة: ${Object.keys(TIMER_KEYS).join('، ')}`});
  const spec=TIMER_KEYS[input.timer_key];
  if(!spec.wired)refuse(409,'timer_not_wired',{what:`لا تُقترح مهلة «${spec.name}» بعد`,
    missing:[{document:'قارئ لهذه المهلة في المنصة',why:'تبنّي مهلة لا يقرؤها شيء ادعاء بأتمتة غير موجودة',owner:'فريق المنصة',owner_role:'admin'}],next:'تُفتح للاقتراح حين يُبنى ما يتصرف بناءً عليها'});
  if(!Number.isInteger(input.value)||input.value<spec.min||input.value>spec.max)
    refuse(400,'timer_value',{what:`قيمة «${spec.name}» غير مقبولة`,next:`اكتب عددًا صحيحًا من ${spec.min} إلى ${spec.max} (${UNIT_NAMES[spec.unit]})`});
  const basis=v.text(input.basis,'سند المهلة: من قررها ومتى ولماذا',1000,10);
  const open=liveRow(db,u.tenant_id,input.timer_key,'proposed');
  if(open)refuse(409,'proposal_open',{what:`لـ«${spec.name}» مقترح مفتوح (${open.value}) لم يُحسم`,
    missing:[{document:'قرار على المقترح المفتوح',why:'لا يتزاحم رقمان على قرار واحد',owner:nameOf(db,open.proposed_by)??'من اقترحه'}],next:'يتبناه شخص ثانٍ أو يُسحب، ثم يُقترح رقم جديد'});
  const conflict=orderConflict(db,u.tenant_id,input.timer_key,input.value);
  if(conflict)refuse(409,'timer_order',{what:'المهلة المقترحة تكسر ترتيب المهل المعتمدة',next:conflict});
  const row=id(),time=now();
  db.prepare("INSERT INTO workflow_timer_settings(id,tenant_id,timer_key,unit,value,basis,status,proposed_by,proposed_at) VALUES(?,?,?,?,?,?,'proposed',?,?)")
    .run(row,u.tenant_id,input.timer_key,spec.unit,input.value,basis,u.id,time);
  audit(db,u,'workflow_timer',row,'timer.proposed',{},{timer_key:input.timer_key,value:input.value,unit:spec.unit},basis);
  return timersBoard(db,u);
}

function openProposal(db,u,rowId){
  const row=typeof rowId==='string'?db.prepare('SELECT * FROM workflow_timer_settings WHERE id=? AND tenant_id=?').get(rowId,u.tenant_id):null;
  if(!row)refuse(404,'not_found',{what:'المهلة المقترحة غير موجودة',next:'حدّث صفحة المهل واختر المقترح من قائمتها'});
  return row;
}
export function adoptTimer(db,supplied,rowId,input){
  writing(db);const u=actorOrRefuse(db,supplied);
  v.object(input,['note']);
  const row=openProposal(db,u,rowId),spec=TIMER_KEYS[row.timer_key];
  if(row.status!=='proposed')refuse(409,'decided',{what:'حُسم هذا المقترح من قبل',next:'اقترح رقمًا جديدًا لتغيير المهلة'});
  if(!spec?.wired)refuse(409,'timer_not_wired',{what:'لا تُتبنى مهلة لا قارئ لها في المنصة',next:'تُفتح للتبني حين يُبنى ما يتصرف بناءً عليها'});
  // الهوية الثانية: من كتب الرقم لا يجعله ساريًا، ولو كان المالك نفسه.
  if(row.proposed_by===u.id)refuse(409,'separation_of_duties',{what:`لا تتبنى مهلة اقترحتها أنت («${spec.name}»)`,
    missing:[{document:'تبنٍّ من شخص ثانٍ',why:'المهلة لا تسري بهوية واحدة',owner:'الرئاسة أو المالك',owner_role:'manager'}],next:'اطلب ممن يملك التبني مراجعتها وتبنيها'});
  if(!canAdoptTimer(db,u))refuse(403,'not_permitted',{what:'تبنّي مهل محرك العمل ليس لحسابك',
    missing:[{document:'صفة اعتماد الرئاسة',why:'المهلة تُلزم كل الإدارات',owner:'الرئاسة أو المالك',owner_role:'manager'}],next:'اعرض المقترح على من يملك التبني'});
  const conflict=orderConflict(db,u.tenant_id,row.timer_key,row.value);
  if(conflict)refuse(409,'timer_order',{what:'تبنّي هذه المهلة يكسر ترتيب المهل المعتمدة',next:conflict});
  if(row.timer_key==='returned_expiry'&&adoptedTimers(db,u.tenant_id).returned_reminder_first===undefined)
    refuse(409,'reminder_required',{what:'لا يُتبنى انقضاء الطلب المعاد قبل تذكير صاحبه',
      missing:[{document:`مهلة «${TIMER_KEYS.returned_reminder_first.name}» معتمدة`,why:'لا ينقضي طلب لم يُذكَّر صاحبه',owner:'من يدير دليل الخدمات ثم الرئاسة'}],next:'اقترحوا التذكير الأول وتبنّوه، ثم تبنّوا الانقضاء'});
  const note=v.text(input.note??'','ملاحظة التبني',1000,0),time=now(),previous=liveRow(db,u.tenant_id,row.timer_key,'adopted');
  if(previous)db.prepare("UPDATE workflow_timer_settings SET status='superseded',superseded_at=? WHERE id=? AND status='adopted'").run(time,previous.id);
  const changed=db.prepare("UPDATE workflow_timer_settings SET status='adopted',adopted_by=?,adopted_at=? WHERE id=? AND status='proposed'").run(u.id,time,row.id).changes;
  if(Number(changed)!==1)refuse(409,'stale_version',{what:'تغيّر المقترح أثناء التبني',next:'حدّث الصفحة وأعد المحاولة'});
  audit(db,u,'workflow_timer',row.id,'timer.adopted',previous?{value:previous.value,replaced_id:previous.id}:{},{timer_key:row.timer_key,value:row.value,unit:row.unit,proposed_by:row.proposed_by},note||row.basis);
  return timersBoard(db,u);
}
// سحب مقترح لم يُحسم (من اقترحه أو من يملك التبني)، أو إيقاف مهلة سارية بلا بديل (من يملك التبني): تعود الأتمتة إلى السكون.
export function retireTimer(db,supplied,rowId,input){
  writing(db);const u=actorOrRefuse(db,supplied);
  v.object(input,['reason']);
  const row=openProposal(db,u,rowId);
  if(row.status==='superseded')refuse(409,'decided',{what:'هذه المهلة لم تعد سارية ولا مقترحة',next:'لا شيء يُسحب؛ اقترح رقمًا جديدًا إن أردت مهلة'});
  const allowed=row.status==='proposed'?(row.proposed_by===u.id||canAdoptTimer(db,u)):canAdoptTimer(db,u);
  if(!allowed)refuse(403,'not_permitted',{what:row.status==='proposed'?'سحب هذا المقترح ليس لحسابك':'إيقاف مهلة سارية ليس لحسابك',
    missing:[{document:row.status==='proposed'?'صفة مقترِحه أو صفة التبني':'صفة اعتماد الرئاسة',owner:'الرئاسة أو المالك',owner_role:'manager'}],next:'اطلب ممن يملك القرار سحبها أو إيقافها'});
  const reason=v.text(input.reason,'سبب السحب أو الإيقاف',1000,10),time=now();
  // إيقاف التذكير الأول والانقضاء سارٍ يترك طلبات تنقضي بلا تذكير: يُوقف الانقضاء أولًا.
  if(row.status==='adopted'&&row.timer_key==='returned_reminder_first'&&adoptedTimers(db,u.tenant_id).returned_expiry!==undefined)
    refuse(409,'reminder_required',{what:'لا يُوقف التذكير الأول ومهلة الانقضاء سارية',next:`أوقف «${TIMER_KEYS.returned_expiry.name}» أولًا، أو اقترح تذكيرًا أول بديلًا ليحل محله`});
  const changed=db.prepare("UPDATE workflow_timer_settings SET status='superseded',superseded_at=? WHERE id=? AND status=?").run(time,row.id,row.status).changes;
  if(Number(changed)!==1)refuse(409,'stale_version',{what:'تغيّرت المهلة أثناء الإجراء',next:'حدّث الصفحة وأعد المحاولة'});
  audit(db,u,'workflow_timer',row.id,row.status==='proposed'?'timer.withdrawn':'timer.retired',{status:row.status,value:row.value},{timer_key:row.timer_key,status:'superseded'},reason);
  return timersBoard(db,u);
}

// لوحة المهل: لكل مفتاح معناه، وما يسري منه، وما يُقترح، وأثره اليوم بكلمات صادقة، وما يبقى يدويًا حتى يُتبنى.
export function timersBoard(db,supplied){
  const u=actorOrRefuse(db,supplied),propose=canProposeTimer(db,u),adopt=canAdoptTimer(db,u);
  const rows=db.prepare('SELECT * FROM workflow_timer_settings WHERE tenant_id=? ORDER BY proposed_at,id').all(u.tenant_id);
  const view=row=>row?{id:row.id,value:row.value,unit:row.unit,unit_name:UNIT_NAMES[row.unit]??row.unit,basis:row.basis,status:row.status,proposed_by:row.proposed_by,proposed_by_name:nameOf(db,row.proposed_by),
    proposed_at:row.proposed_at,adopted_by_name:nameOf(db,row.adopted_by),adopted_at:row.adopted_at,superseded_at:row.superseded_at,
    // من أي لحظة تُعدّ: أول تبنٍّ متصل (clockFrom) لكل ما كان مفتوحًا قبله؛ استبدال الرقم لا يحرّكها.
    clock_from:row.status==='adopted'?clockFrom(db,u.tenant_id,row):null}:null;
  const timers=Object.entries(TIMER_KEYS).map(([key,spec])=>{
    const mine=rows.filter(r=>r.timer_key===key),adopted=view(mine.find(r=>r.status==='adopted')??null),proposed=mine.find(r=>r.status==='proposed')??null;
    const actions=[];
    if(spec.wired&&propose&&!proposed)actions.push('propose_timer');
    if(spec.wired&&proposed&&adopt&&proposed.proposed_by!==u.id)actions.push('adopt_timer');
    if(proposed&&(proposed.proposed_by===u.id||adopt))actions.push('withdraw_timer');
    if(adopted&&adopt)actions.push('retire_timer');
    const live=spec.wired&&adopted;
    return {key,name:spec.name,meaning:spec.meaning,unit:spec.unit,unit_name:UNIT_NAMES[spec.unit],min:spec.min,max:spec.max,wired:spec.wired,
      adopted,proposed:view(proposed),history:mine.filter(r=>r.status==='superseded').map(view),actions,
      state:live?'adopted':proposed?'proposed':'none',manual:live?'':spec.manual,
      effect:!spec.wired?'لا قارئ لها في المنصة بعد، فلا تُقترح: تبنّي مهلة لا يقرؤها شيء ادعاء بأتمتة غير موجودة.'
        :adopted?`سارية: ${adopted.value} ${UNIT_NAMES[adopted.unit]}، وتُقرأ في التشغيل اليومي. الساعة تُعدّ من ${String(adopted.clock_from).slice(0,10)} (${adopted.clock_from===adopted.adopted_at?'يوم التبني':'يوم أول تبنٍّ لم ينقطع؛ استبدال الرقم لا يعيد العدّ'}) لكل ما كان مفتوحًا قبله، ومن لحظة الحدث لما بعده.`
        :proposed?`${NOT_ADOPTED}. مقترحة (${proposed.value} ${UNIT_NAMES[proposed.unit]}) بانتظار تبنٍّ من شخص ثانٍ، ولا أثر لها حتى تُتبنى.`
        :`${NOT_ADOPTED}. لم يقررها المالك بعد، فلا شيء آلي يحدث بناءً عليها.`};
  });
  const adopted=adoptedTimers(db,u.tenant_id),none=!Object.keys(adopted).length;
  return {timers,adopted,none_adopted:none,can_propose:propose,can_adopt:adopt,
    headline:none?'لا مهلة معتمدة: التشغيل اليومي لا يذكّر ولا يصعّد ولا يُسقط طلبًا. كل ما في القائمة أدناه يبقى يدويًا.'
      :`مهل معتمدة: ${Object.keys(adopted).length} من ${Object.values(TIMER_KEYS).filter(s=>s.wired).length} لها قارئ. ما لم يُعتمد يبقى يدويًا.`,
    clock_rule:CLOCK_RULE,
    note:`المهلة رقم يقرره المالك بسنده. تُقترح من حساب وتُتبنى من حساب آخر، ولا تفعل شيئًا قبل التبني. ومهل محرك العمل بأيام العمل (الأحد–الخميس دون العطل المعتمدة)، وسقفا مدة التفويض بأيام التقويم لأنهما يغطيان غيبةً تمرّ بالعطل. ووحدةُ كل مهلة مكتوبة بجوارها. والتشغيل مرة يوميًا عند الثامنة صباحًا بتوقيت الرياض. ${CLOCK_RULE}`};
}
