import { serviceOf } from './workflow.mjs';
import { targetDays } from './routing.mjs';
import { holidaySet, workingDaysBetween, pausedIntervals, riyadhDate, clockFor } from './work-calendar.mjs';
import { dwellStages } from './request-timeline.mjs';
import { insightScope, NO_BLAME } from './insight-scope.mjs';
import { can } from './access.mjs';
import { closureBoard } from './request-closure.mjs';
import { experienceSummary, liveThreshold } from './service-experience.mjs';

// تنقيب العمليات: سجل التدقيق المتسلسل سجلُّ أحداث جاهز — لكل طلب حالة، ولكل فعل وقت وترتيب مختوم.
// منه يُقرأ المسار الفعلي مقابل المرسوم، وأين يمكث الطلب، وكم يرتد ولماذا، وهل التُزم بالمدة.
//
// لا يُنسب بطء لموظف باسمه في أي مخرج من هذا الملف. الاختناق عند خطوة أو إدارة، لا عند شخص.
// القياس الذي يوجّه اللوم يُفسد البيانات لأن الناس يتجنبون النظام: يغلقون مبكرًا، أو يؤخرون التسجيل، أو يتفقون خارجه.
// ولذلك لا يقرأ هذا الملف اسم أي مستخدم، ولا يجمّع على `actor_id` ولا `approver_id` ولا `assigned_to`.

const ROLE_NAMES={manager:'اعتماد المدير المباشر',department_manager:'اعتماد مدير الإدارة المالكة',hr:'اعتماد الموارد البشرية',it:'اعتماد تقنية المعلومات',pm:'اعتماد مدير المشاريع'};
const FLOW={submit:'تقديم',approve:'اعتماد',return:'إرجاع',reject:'رفض',cancel:'إلغاء',claim:'مباشرة',
  'request.task_assigned':'مباشرة','request.transferred':'تحويل',complete:'إغلاق','request.reopened':'إعادة فتح'};
const DEVIATIONS={'إرجاع':'returned','رفض':'rejected','إلغاء':'cancelled','تحويل':'transferred','إعادة فتح':'reopened'};
const median=list=>{const s=[...list].sort((a,b)=>a-b);return s.length?s.length%2?s[(s.length-1)/2]:(s[s.length/2-1]+s[s.length/2])/2:0;};
const round1=x=>Math.round(x*10)/10;

// المسار الفعلي للطلب من سجل التدقيق. إسناد مهمة قبل المباشرة يبدأ التنفيذ فعلًا، فيُقرأ «مباشرة» وتُطوى المكررات المتتالية.
function actualPath(db,r){
  const steps=db.prepare(`SELECT action FROM audit_events WHERE tenant_id=? AND entity_type='request' AND entity_id=? ORDER BY seq`).all(r.tenant_id,r.id)
    .map(row=>FLOW[row.action]).filter(Boolean);
  return steps.filter((step,i)=>!(step==='مباشرة'&&steps[i-1]==='مباشرة'));
}
const designedPath=service=>['تقديم',...service.approval_policy.steps.map(()=>'اعتماد'),'مباشرة','إغلاق'];

// الحقل الذي سبّب الارتداد هو الحقل الذي تغيّر بين النسخة المُعادة والنسخة التي تلتها:
// ما عدّله صاحب الطلب بعد الإرجاع هو ما كان ناقصًا أو خاطئًا، وهذا أدق من قراءة نص سبب الإرجاع.
function returnCauses(db,r,service){
  const versions=db.prepare('SELECT revision,snapshot FROM request_versions WHERE request_id=? ORDER BY revision').all(r.id).map(x=>({revision:x.revision,snapshot:JSON.parse(x.snapshot)}));
  const returned=new Set(db.prepare("SELECT DISTINCT revision FROM approval_steps WHERE request_id=? AND status='returned'").all(r.id).map(x=>x.revision));
  const labels=Object.fromEntries(service.fields.map(f=>[f.key,f.label])),causes=[];
  for(const version of versions.filter(x=>returned.has(x.revision))){
    const next=versions.find(x=>x.revision>version.revision);
    if(!next)continue;
    const a=version.snapshot.payload??{},b=next.snapshot.payload??{};
    for(const key of new Set([...Object.keys(a),...Object.keys(b)]))if(a[key]!==b[key])causes.push(labels[key]??key);
    if(version.snapshot.title!==next.snapshot.title)causes.push('عنوان الطلب');
    const files=x=>(x.snapshot.attachments??[]).map(f=>f.digest).sort().join();
    if(files(version)!==files(next))causes.push('المرفقات');
  }
  return {returns:returned.size,causes};
}

// الالتزام بالمدة بأيام العمل، مع استبعاد انتظار صاحب الطلب — القاعدة نفسها في `clockFor`، ممدودة إلى الطلب المكتمل
// الذي يتوقف `clockFor` عن قياسه عند إغلاقه.
function punctuality(db,r,target,holidays){
  if(!target)return null;
  if(r.status!=='completed'){const clock=clockFor(db,r,target,holidays);return clock.elapsed_days===undefined?null:{done:false,elapsed:clock.elapsed_days,late:clock.overdue};}
  const submitted=db.prepare('SELECT created_at FROM request_versions WHERE request_id=? ORDER BY revision LIMIT 1').get(r.id)?.created_at;
  const closed=db.prepare("SELECT created_at FROM audit_events WHERE tenant_id=? AND entity_type='request' AND entity_id=? AND action='complete' ORDER BY seq DESC LIMIT 1").get(r.tenant_id,r.id)?.created_at;
  if(!submitted||!closed)return null;
  const end=riyadhDate(closed),elapsed=workingDaysBetween(riyadhDate(submitted),end,holidays,pausedIntervals(db,r.id).map(p=>({from:p.from,to:p.to??end})));
  return {done:true,elapsed,late:elapsed>target};
}

export function insightBoard(db,supplied,query={}){
  const {u,departments}=insightScope(db,supplied),holidays=holidaySet(db,u.tenant_id);
  const names=Object.fromEntries(db.prepare('SELECT id,name FROM departments WHERE tenant_id=?').all(u.tenant_id).map(d=>[d.id,d.name]));
  const wanted=typeof query.service_code==='string'&&query.service_code?query.service_code.toUpperCase():null;
  const requests=db.prepare(`SELECT r.*,s.code AS service_code,COALESCE(r.handling_department_id,s.department_id) AS department_id
      FROM requests r JOIN services s ON s.id=r.service_id WHERE r.tenant_id=? AND r.status<>'draft' ORDER BY r.created_at`).all(u.tenant_id)
    .filter(r=>(!departments||departments.includes(r.department_id))&&(!wanted||r.service_code===wanted));

  const services=new Map(),stageTotals=new Map(),waiting={segments:0,working_days:0,hours:0};
  for(const r of requests){
    const service=serviceOf(db,r),designed=designedPath(service),actual=actualPath(db,r);
    if(!actual.length)continue;
    const entry=services.get(service.code)??{code:service.code,name:service.name_ar,department:names[r.department_id]??r.department_id,designed:designed.join(' ← '),
      requests:0,conforming:0,deviated:0,deviation_causes:{returned:0,rejected:0,cancelled:0,transferred:0,reopened:0,other:0},variants:new Map(),
      returns:[],field_causes:new Map(),reached_approval:0,target_days:targetDays(db,r),measured:0,on_time:0,late:0,late_open:0,first_time_right:0,completed:0};
    services.set(service.code,entry);entry.requests++;

    // مطابق = المسار الفعلي هو المرسوم، أو بادئة منه لطلب لم ينتهِ بعد. كل ما عداه انحراف يُسمّى سببه.
    const conforming=actual.every((step,i)=>step===designed[i])&&actual.length<=designed.length;
    if(conforming)entry.conforming++;else{
      entry.deviated++;
      const found=[...new Set(actual.map(step=>DEVIATIONS[step]).filter(Boolean))];
      if(found.length)for(const cause of found)entry.deviation_causes[cause]++;else entry.deviation_causes.other++;
    }
    const variant=actual.join(' ← ');entry.variants.set(variant,(entry.variants.get(variant)??0)+1);

    const rework=returnCauses(db,r,service);
    if(['approved','in_progress','completed'].includes(r.status)){entry.reached_approval++;entry.returns.push(rework.returns);}
    for(const cause of rework.causes)entry.field_causes.set(cause,(entry.field_causes.get(cause)??0)+1);

    const timing=punctuality(db,r,entry.target_days,holidays);
    if(timing){entry.measured++;if(timing.late){entry.late++;if(!timing.done)entry.late_open++;}else if(timing.done)entry.on_time++;}
    if(r.status==='completed'){entry.completed++;if(!db.prepare('SELECT 1 FROM request_reopenings WHERE request_id=?').get(r.id))entry.first_time_right++;}

    for(const stage of dwellStages(db,r,holidays)){
      if(stage.kind==='requester'){waiting.segments++;waiting.working_days+=stage.working_days;waiting.hours+=stage.hours;continue;}
      // المفتاح خطوة أو إدارة. `stage.party` في مراحل الاعتماد اسم الدور لا اسم صاحبه.
      const where=stage.kind==='approval'?ROLE_NAMES[service.approval_policy.steps[stage.position]]??stage.party:stage.party;
      const key=`${service.code}|${where}`,total=stageTotals.get(key)??{service_code:service.code,where,kind:stage.kind,days:[],hours:[],open:0};
      total.days.push(stage.working_days);total.hours.push(stage.hours);if(stage.open)total.open++;stageTotals.set(key,total);
    }
  }

  const bottlenecks=[...stageTotals.values()].map(t=>({service_code:t.service_code,where:t.where,kind:t.kind,passes:t.days.length,open_now:t.open,
    average_working_days:round1(t.days.reduce((a,b)=>a+b,0)/t.days.length),median_working_days:median(t.days),longest_working_days:Math.max(...t.days),
    average_hours:round1(t.hours.reduce((a,b)=>a+b,0)/t.hours.length),total_hours:round1(t.hours.reduce((a,b)=>a+b,0))}))
    .sort((a,b)=>b.average_hours-a.average_hours);

  const rows=[...services.values()].map(s=>({code:s.code,name:s.name,department:s.department,designed:s.designed,requests:s.requests,
    conforming:s.conforming,deviated:s.deviated,deviated_percent:Math.round(s.deviated*100/s.requests),deviation_causes:s.deviation_causes,
    variants:[...s.variants].map(([path,count])=>({path,count,designed:path===s.designed||s.designed.startsWith(path)})).sort((a,b)=>b.count-a.count).slice(0,5),
    rework:{reached_approval:s.reached_approval,average_returns:s.returns.length?round1(s.returns.reduce((a,b)=>a+b,0)/s.returns.length):null,
      fields:[...s.field_causes].map(([field,count])=>({field,count})).sort((a,b)=>b.count-a.count)},
    timing:s.target_days?{target_days:s.target_days,measured:s.measured,on_time:s.on_time,late:s.late,late_open:s.late_open,
        on_time_percent:s.on_time+s.late-s.late_open?Math.round(s.on_time*100/(s.on_time+s.late-s.late_open)):null}
      :{target_days:0,measured:0,note:'لا زمن مستهدف لهذه الخدمة في الدليل، فلا يُقاس التزام.'},
    first_time_right:{completed:s.completed,without_reopening:s.first_time_right},
    slowest:bottlenecks.find(b=>b.service_code===s.code)?.where??null})).sort((a,b)=>b.requests-a.requests);

  return {services:rows,bottlenecks:bottlenecks.slice(0,20),
    requester_wait:{segments:waiting.segments,working_days:waiting.working_days,hours:round1(waiting.hours),note:'انتظار صاحب الطلب بعد الإرجاع: الساعة متوقفة فيه ولا يُحتسب على أي إدارة، ويُعرض منفصلًا حتى لا يُخلط بالاختناق.'},
    totals:{requests:requests.length,services:rows.length,deviated:rows.reduce((n,s)=>n+s.deviated,0)},
    scope:departments?departments.map(d=>names[d]??d):null,
    blame_notice:NO_BLAME,
    note:'المصدر سجل التدقيق المتسلسل ونسخ الطلبات وخطوات الاعتماد؛ لا بيانات مُدخلة يدويًا في هذه اللوحة. المدد بأيام العمل (الأحد–الخميس دون العطل المعتمدة) مع استبعاد انتظار صاحب الطلب. الالتزام يُقاس على زمن الخدمة في الدليل وحده لا على زمن الأولوية. والأعداد الصغيرة لا تصلح حكمًا: خدمة مرّ بها ثلاثة طلبات لا «نمط» فيها بعد.'};
}

// شاشة واحدة تجمع القياس وإعداداته. من لا يملك تصريح القياس يرى الإعدادات التي تخصه (مهلة إعادة الفتح لخدمة يملك إجراءها)
// ويُقال له صراحة إن لوحات القياس محجوبة عنه، بدل شاشة فارغة توهم بأنه لا بيانات.
export function serviceInsightScreen(db,supplied,query={}){
  const closure=closureBoard(db,supplied);
  let insight=null,experience=null,denied='';
  try{
    insight=insightBoard(db,supplied,query);
    experience={by_service:experienceSummary(db,supplied,{group_by:'service'}),by_department:experienceSummary(db,supplied,{group_by:'department'})};
  }catch(error){if(error.code!=='not_permitted')throw error;denied=error.message;}
  const threshold=liveThreshold(db,supplied.tenant_id);
  return {insight,experience,denied,closure,
    threshold:{min_responses:threshold?.min_responses??null,basis:threshold?.basis??'',confirmed_on:threshold?.confirmed_on??null,can_set:can(db,supplied,'catalog.manage')},
    blame_notice:NO_BLAME};
}
