import { dual } from './dates.mjs';
import { compensatoryConsentSentence } from './leave-count.mjs';
import { kit } from './kit.mjs';
// الحضور والانصراف: بصمة بوقت الخادم، تصحيح يعتمده المدير، وغياب غير مدفوع بقرار شخصين.
// قواعد اللائحة (099): استئذان يرفع علامة التأخر، إشعار اليوم، تكليف مسبق بالعمل الإضافي، إعفاءات، وموقع يُعلَّم ولا يمنع.
// الشاشة للموظف أولًا: زر البصمة الكبير في الأعلى، ثم يومه وشهره، ثم الطلبات والقرارات، ثم أدوات المدير والموارد البشرية، والقواعد في الآخر.
const field=(name,label,type='text',extra={})=>({name,label,type,...extra});
const tone={present:'is-ok',late:'is-needs_info',incomplete:'is-needs_info',unexplained:'is-failed',leave:'is-passed',unpaid_absence:'is-failed',today_open:'',off:'',holiday:'is-passed',mission:'is-ok',present_permission:'is-ok',early_leave:'is-needs_info',excused:'is-passed',exempt:'is-passed'};
const labels={approve_correction:'اعتماد التصحيح',reject_correction:'رفض التصحيح',state_absence:'تقديم إفادتي',confirm_absence:'اعتماد الغياب غير المدفوع',dismiss_absence:'صرف الاقتراح',approve_holiday:'اعتماد العطلة',reject_holiday:'رفض العطلة',approve_mission:'اعتماد المهمة',reject_mission:'رفض المهمة',cancel_mission:'إلغاء طلبي',approve_overtime:'اعتماد الساعات',reject_overtime:'رفض الطلب',overtime_to_payroll:'تحويل إلى المسير',compensatory_to_payroll:'إحالة إلى المسير',credit_compensatory:'قيد الرصيد التعويضي',end_shift:'إنهاء الوردية',
  approve_permission:'اعتماد الاستئذان',reject_permission:'رفض الاستئذان',cancel_permission:'إلغاء طلبي',accept_notice:'قبوله عذرًا',reject_notice:'عدم القبول',
  authorise_assignment:'موافقة صاحب الصلاحية',approve_assignment_budget:'اعتماد الميزانية',reject_assignment:'رفض التكليف',cancel_assignment:'إلغاء التكليف',record_overtime:'تسجيل الساعات الفعلية',
  approve_exemption:'اعتماد الإعفاء',reject_exemption:'رفض الإعفاء',approve_site:'اعتماد الموقع',reject_site:'رفض الموقع',retire_site:'إيقاف الموقع',explain_location:'توضيح البصمة',review_location:'مراجعة البصمة'};
const extraRoutes={approve_holiday:['holidays','approve'],reject_holiday:['holidays','reject'],approve_mission:['missions','approve'],reject_mission:['missions','reject'],cancel_mission:['missions','cancel'],approve_overtime:['overtime','approve'],reject_overtime:['overtime','reject']};
const ruleRoutes={approve_permission:['permissions','approve',false],reject_permission:['permissions','reject',true],cancel_permission:['permissions','cancel',false],accept_notice:['notices','accept',true],reject_notice:['notices','reject',true],
  authorise_assignment:['overtime-assignments','authorise',true],approve_assignment_budget:['overtime-assignments','budget',true],reject_assignment:['overtime-assignments','reject',true],cancel_assignment:['overtime-assignments','cancel',true],
  approve_exemption:['exemptions','approve',true],reject_exemption:['exemptions','reject',true],approve_site:['sites','approve',true],reject_site:['sites','reject',true],retire_site:['sites','retire',true],review_location:['locations','review',true]};
const hoursText=minutes=>`${Number((minutes/60).toFixed(2))} ساعة`;

// ── الموقع قبل البصمة (عرض فقط؛ الحكم من الخادم) ──
// أخذ عينات GPS: أول قراءة بدقة 20 مترًا أو أفضل تُعتمد فورًا، وإلا الأدق بعد 10 ثوانٍ، ويُترك بعد 12 ثانية. لا تتبع بعد البصمة.
export function sampleLocation(geo,{goodAccuracy=20,settleMs=10000,giveUpMs=12000,onFix}={}){
  return new Promise(resolve=>{
    if(!geo||typeof geo.watchPosition!=='function'){resolve({error:'unsupported'});return;}
    let best=null,done=false,watch=null;const timers=[];
    const finish=(fix,error)=>{if(done)return;done=true;timers.forEach(clearTimeout);try{if(watch!==null)geo.clearWatch(watch);}catch{}resolve(fix?{...fix}:{error:error??'timeout'});};
    watch=geo.watchPosition(pos=>{
      const fix={lat:pos.coords.latitude,lng:pos.coords.longitude,accuracy:pos.coords.accuracy};
      if(!best||fix.accuracy<best.accuracy)best=fix;
      onFix?.(best);
      if(fix.accuracy<=goodAccuracy)finish(fix);
    },err=>finish(best,err?.code===1?'denied':err?.code===3?'timeout':'unavailable'),{enableHighAccuracy:true,maximumAge:0,timeout:giveUpMs});
    timers.push(setTimeout(()=>{if(best)finish(best);},settleMs),setTimeout(()=>finish(best,'timeout'),giveUpMs));
  });
}
export function nearestSite(sites,fix){
  const rad=d=>d*Math.PI/180;let best=null;
  for(const s of sites||[]){const a=Math.sin(rad(s.lat-fix.lat)/2)**2+Math.cos(rad(fix.lat))*Math.cos(rad(s.lat))*Math.sin(rad(s.lng-fix.lng)/2)**2,d=2*6371008.8*Math.asin(Math.min(1,Math.sqrt(a)));if(!best||d-s.radius_m<best.distance-best.site.radius_m)best={site:s,distance:d};}
  return best;
}
export function describeFix(sites,fix){
  const near=nearestSite(sites,fix),accuracy=`الدقة ±${Math.round(fix.accuracy)} م`;
  if(!near)return accuracy;
  const inside=near.distance<=near.site.radius_m;
  return `المسافة إلى «${near.site.name}» ${Math.round(near.distance/10)*10} م · ${accuracy} · ${inside?'داخل النطاق':'خارج النطاق — بصمتك تنسجّل ونطلب منك توضيح'} (تقدير المتصفح، والحكم للخادم)`;
}
export const GEO_ERRORS={denied:'ما سمحت بالوصول لموقعك. حضورك ينسجّل بلا موقع ويطلع لمديرك «يحتاج توضيحًا». عشان تسمح: في iPhone من الإعدادات ← Safari ← الموقع، وفي Android من إعدادات الموقع في Chrome.',
  timeout:'ما قدرنا نحدد موقعك خلال 12 ثانية. حضورك ينسجّل بلا موقع ويطلع «يحتاج توضيحًا».',unavailable:'ما قدرنا نحدد موقعك. حضورك ينسجّل بلا موقع ويطلع «يحتاج توضيحًا».',unsupported:'متصفحك ما يدعم تحديد الموقع. حضورك ينسجّل بلا موقع.'};
function hidden(form,name,value){let input=form.querySelector(`input[type="hidden"][name="${name}"]`);if(!input){input=form.ownerDocument.createElement('input');input.type='hidden';input.name=name;form.append(input);}input.value=value;}
function geoPanel(form,sites,{fill}={}){
  const doc=form.ownerDocument,status=doc.createElement('p'),submit=form.querySelector('button[type="submit"]');
  status.className='att-geo';status.setAttribute('role','status');form.querySelector('.form-grid')?.after(status);
  let started=false;
  return ()=>{
    if(started)return;started=true;if(submit)submit.disabled=true;status.textContent='نحدّد موقعك…';
    sampleLocation(doc.defaultView?.navigator?.geolocation,{onFix:fix=>{status.textContent=describeFix(sites,fix);}}).then(result=>{
      if(result.error){hidden(form,'location_error',result.error);status.textContent=GEO_ERRORS[result.error];}
      else{hidden(form,'lat',String(result.lat));hidden(form,'lng',String(result.lng));hidden(form,'accuracy',String(result.accuracy));status.textContent=describeFix(sites,result);fill?.(result);}
      if(submit)submit.disabled=false;
    });
  };
}

export const attendanceUI={
  title:'الحضور والانصراف',description:'سجّل حضورك وانصرافك بوقت الخادم، ومن هنا تطلب استئذان أو تصحيح أو مهمة عمل.',
  load:api=>api('/attendance'),
  render(data,{e,button,ui=kit(e)}){
    const r=data.rules,x=data.extras,loc=r.location;
    const s=data.me.summary,hr=data.permissions.includes('hr.attendance.manage'),approver=data.permissions.includes('hr.attendance.approve');
    const acts=row=>row.actions.length?`<div class="operation-actions">${row.actions.map(a=>button(a,row.id,labels[a])).join('')}</div>`:'';
    const block=(title,items,empty)=>`<section class="vn-block"><h3>${e(title)}</h3>${items?`<ul class="vn-list">${items}</ul>`:`<p class="subtle">${e(empty)}</p>`}</section>`;
    const grid=(...blocks)=>{const html=blocks.join('');return html?`<div class="vn-grid">${html}</div>`:'';};
    const meta=parts=>parts.filter(Boolean).join(' · ');
    // القيم المتغيرة في وسومها: التاريخ والساعة في <time> بقيمتها الآلية والنص المعروض كما كان، والمدى والإحداثيات والمبلغ في .ltr
    // (عزل اتجاه وأرقام مجدولة)، والعدد الواقع وسط جملة في data-num.
    const dateTag=iso=>iso?`<time datetime="${e(iso)}">${e(iso)}</time>`:'';
    const clockTag=hm=>hm?`<time datetime="${e(hm)}">${e(hm)}</time>`:'';
    const rangeTag=(from,to)=>`<bdi dir="ltr" class="ltr">${e(from)}–${e(to)}</bdi>`;
    const count=n=>`<span data-num>${e(n)}</span>`;
    const riyal=v=>`<span class="ltr">${e(v)}</span> ريال`;
    // اسم الطابور كما يكتبه الخادم في توجيهه (attendance-extras.mjs: «الحضور والانصراف» ← «…»)، فيبقى بحرفه هنا وفي عنوان قسمه.
    const UNCREDITED='ساعات اختير لها وقت راحة ولم تُقيَّد رصيدًا';

    // ١) البصمة أولًا: الزر الكبير، ثم طلبات اليوم السريعة، ثم قاعدة الخصم كما يكتبها الخادم.
    // اسم الفعل لا يفترض جنس القارئ («تسجيل الحضور» لا «سجّل حضورك»)، كبقية أزرار الشاشة.
    const zoneLine=Object.entries(data.me.today.zones||{}).map(([k,z])=>`${k==='in'?'موقع الحضور':'موقع الانصراف'}: ${e(z.zone_name)}`).join(' · ');
    const punch=data.me.can_check_in?button('punch_in','','تسجيل الحضور'):data.me.can_check_out?button('punch_out','','تسجيل الانصراف'):'<p class="subtle">سجّلت حضورك وانصرافك اليوم. إذا فيه خطأ اطلب تصحيح.</p>';
    const head=`<section class="panel panel-body vn-head"><div class="att-punch">${punch}${loc.active?`<p class="att-geo subtle">نطلب موقعك لحظة الضغط بس، قرينة مو بوابة: بصمتك تنسجّل دايم.</p>`:''}${zoneLine?`<p class="subtle">${zoneLine}</p>`:''}</div>
      <div class="operation-actions">${button('request_permission','','طلب استئذان')}${r.me.notice_today.length<2?button('give_notice','','إشعار: سأتأخر أو سأغيب اليوم'):''}${button('request_correction','','طلب تصحيح')}${button('request_mission','','طلب مهمة عمل')}${button('request_overtime','','طلب عمل إضافي بأثر رجعي')}</div><p class="subtle">${e(data.rule)}</p></section>`;

    // ٢) يومي وشهري — ما يخصني قبل غيره: بلاطات اليوم والشهر، ثم ما ينتظر توضيحي، ثم أيامي ورصيدي.
    // رصيد الإجازة التعويضية: بلا سياسة معتمدة ولا قيود الحالة «غير متاح» بسببها، لا صفر. وساعاتي المعتمدة التي لم تُقيَّد بعد تُقال لي بعددها ومن يقيّدها.
    const compReady=!!(x.compensation_offer?.available||x.compensatory?.lots.length),uncreditedMine=x.time_off_uncredited_minutes??0;
    const expiringLots=(x.compensatory?.lots??[]).filter(l=>l.state==='expiring'),soonest=expiringLots.map(l=>l.expires_on).filter(Boolean).sort()[0];
    const tiles=`<div class="vn-tiles">${ui.tile(data.me.today.check_in||'—','حضور اليوم')}${ui.tile(data.me.today.check_out||'—','انصراف اليوم')}${ui.tile(s.present+s.late+s.early_leave+s.present_permission,'يوم حضور هذا الشهر')}${ui.tile(s.late,'يوم تأخر',s.late?'is-due':'')}${ui.tile(s.incomplete+s.unexplained+s.early_leave,'يوم يحتاج توضيحًا',s.incomplete+s.unexplained+s.early_leave?'is-due':'')}${ui.tile(compReady?hoursText(x.time_off_minutes):'غير متاح','رصيد الإجازة التعويضية المتاح',expiringLots.length?'is-due':'')}</div>`;
    // أصفر بلاطة الرصيد يُقال بكلمة أيضًا، ومعه أقرب مهلة والخطوة التالية.
    const expiringLine=expiringLots.length?`<p class="is-warn-text">عندك رصيد إجازة تعويضية يقترب أجله${soonest?` (${dateTag(soonest)})`:''} — اطلبه إجازة من شاشة «الإجازات» قبل يفوت.</p>`:'';
    const cap=r.me.permission_cap_minutes===null?'سقف الاستئذان الشهري ما تحدد للحين.':`استأذنت هذا الشهر ${count(r.me.permission_minutes_this_month)} من ${count(r.me.permission_cap_minutes)} دقيقة.`;
    const compNote=`${compReady||!x.compensation_offer?.reason?'':`<p class="subtle measure">${e(x.compensation_offer.reason)}</p>`}${uncreditedMine?`<div class="vn-alert"><strong>${e(hoursText(uncreditedMine))} عمل إضافي معتمدة اخترت لها وقت الراحة ولم تُقيَّد رصيدًا بعد.</strong><p>${compReady?`يقيّدها اللي عنده صلاحية اعتماد الحضور من «${e(UNCREDITED)}»، وبعدها تطلع في رصيدك بمهلتها.`:'تنقيّد بعد ما يعتمد مدير الموارد البشرية سياسة أنواع الإجازات وفيها الإجازة التعويضية، وبعدها يقيّدها اللي عنده صلاحية اعتماد الحضور.'} ساعاتك محفوظة، وما تدخل المسير أجر في هالفترة.</p></div>`:''}`;
    const ram=r.policy?.ramadan;
    const policyLine=data.policy?`<p class="subtle">الدوام المعتمد: ${rangeTag(data.policy.start,data.policy.end)} · مهلة التأخير ${count(data.policy.grace_minutes)} دقيقة · ${e(data.policy.title)}${ram?` · رمضان ${dateTag(ram.from)} إلى ${dateTag(ram.to)}: ${rangeTag(ram.start,ram.end)} (م73(2))`:''}</p>`
      :'<div class="vn-alert"><strong>ما فيه سياسة ساعات عمل معتمدة للحين.</strong><p>أوقاتك تنسجّل، بس ما ينحسب على أي يوم تأخر أو غياب لين يعتمد مدير الموارد البشرية السياسة.</p></div>';
    const flagged=loc.mine.map(l=>`<li><strong>${dateTag(l.work_date)} · ${l.kind==='in'?'حضور':'انصراف'} · ${e(l.zone_name)}</strong><span>${meta([l.distance_m!==null&&`${e(l.distance_m)} م من «${e(l.site_name??'')}»`,l.accuracy_m!==null&&`الدقة ±${e(l.accuracy_m)} م`,l.zone_note_name&&e(l.zone_note_name),l.reviewed_by_name&&`راجعها ${e(l.reviewed_by_name)}`])}</span><small>${l.explanation?`توضيحك: ${e(l.explanation)}`:'ما كتبت توضيحك للحين.'}${l.review_note?` — ${e(l.review_note)}`:''}</small>${acts(l)}</li>`).join('');
    const days=[...data.me.days].reverse().filter(d=>d.state!=='off').map(d=>`<li class="vn-step ${tone[d.state]??''}"><span>${dateTag(d.date)}</span><small>${e(d.state_name)}${d.check_in||d.check_out?` · <bdi dir="ltr" class="ltr">${e(d.check_in??'')}${d.check_out?`–${e(d.check_out)}`:''}</bdi>`:''}${d.late_minutes&&d.state==='late'?` · تأخر ${count(d.late_minutes)} د`:''}${d.early_minutes&&d.state==='early_leave'?` · قبل النهاية بـ${count(d.early_minutes)} د`:''}${d.source==='correction'?' · مصحّح':''}${d.note?` · ${e(d.note)}`:''}${d.shift?` · وردية <bdi dir="ltr" class="ltr">${e(d.shift)}</bdi>`:''}${d.ramadan?' · دوام رمضان':''}${d.zones?.in?` · ${e(d.zones.in.zone_name)}`:''}</small></li>`).join('');
    // الإجازة التعويضية (ترحيل 125): قيودي بمهلها هنا حيث تُكسب، والطلب نفسه من شاشة الإجازات. والطابوران لمن يحمل تصريحهما فقط (في الأدوات تحت).
    const comp=x.compensatory,compLots=(comp?.lots??[]).map(l=>ui.row({title:`عمل ${l.work_date} · ${l.remaining_hours} من ${l.leave_hours} ساعة`,tone:l.state==='expiring'||l.state==='due'||l.state==='service_ended'?'is-due':l.state==='spent'?'is-old':'',
      html:`<span>${meta([e(l.state_name),`المهلة حتى ${dateTag(l.expires_on)}`,l.warning&&e(l.warning)])}</span>`})).join('');
    const compBlock=comp&&(comp.lots.length||x.compensation_offer?.available)?block('رصيدي من الإجازة التعويضية',compLots,'ما عندك رصيد للحين. ينكسب من ساعات عمل إضافي معتمدة تختار لها الإجازة بدل الأجر، وتطلبه إجازة من شاشة «الإجازات».'):'';
    const myMonth=`<h2>يومي وشهري</h2>${tiles}${expiringLine}<p class="subtle">${cap}</p>${compNote}${policyLine}${loc.mine.length?block('بصمات تحتاج توضيحي',flagged,''):''}<section class="vn-block"><h3>أيامي في ${dateTag(data.month)}</h3>${days?`<ol class="vn-pipeline vn-days">${days}</ol>`:'<p class="subtle">ما فيه أيام عمل مسجّلة هذا الشهر للحين.</p>'}</section>${compBlock}`;

    // ٣) الطلبات والقرارات: طلباتي، وطلبات فريقي لمن يقررها، ثم العطل والورديات. الحالة مكتوبة في كل صف بجوار لونه.
    const permissions=r.permissions.map(p=>`<li class="${['rejected','cancelled'].includes(p.status)?'is-old':''}"><strong>${e(p.employee_name)} · ${dateTag(p.work_date)} · ${rangeTag(p.from_time,p.to_time)}</strong><span>${e(p.kind_name)} · ${count(p.minutes)} دقيقة · ${e(p.status_name)}${p.decided_by_name?` · ${e(p.decided_by_name)}`:''}</span><small>${e(p.reason)}${p.decision_note?` — ${e(p.decision_note)}`:''}</small>${acts(p)}</li>`).join('');
    const notices=r.notices.map(n=>`<li><strong>${e(n.employee_name)} · ${dateTag(n.work_date)} · ${e(n.kind_name)}${n.expected_time?` حتى ${clockTag(n.expected_time)}`:''}</strong><span>${e(n.status_name)}${n.decided_by_name?` · ${e(n.decided_by_name)}`:''}</span><small>${e(n.reason)}${n.decision_note?` — ${e(n.decision_note)}`:''}</small>${acts(n)}</li>`).join('');
    // سلسلة التكليف (المكلِّف، وصاحب الصلاحية، ومعتمد الميزانية) فصلُ مهام تفرضه م77، فتبقى أسماؤها.
    const assignments=r.overtime_assignments.map(a=>`<li class="${['rejected','cancelled'].includes(a.status)?'is-old':''}"><strong>${e(a.employee_name)} · ${dateTag(a.from_date)}${a.to_date!==a.from_date?` إلى ${dateTag(a.to_date)}`:''} · ${count(Number((a.minutes_per_day/60).toFixed(2)))} ساعة يوميًا</strong><span>${e(a.status_name)} · كلّفه ${e(a.assigned_by_name)}${a.authorised_by_name?` · وافق ${e(a.authorised_by_name)}`:''}${a.budget_by_name?` · الميزانية ${e(a.budget_by_name)}${a.budget?` (${riyal(a.budget)} تقديرًا)`:''}`:''}</span><small>${e(a.reason)}${a.close_note?` — ${e(a.close_note)}`:''}</small>${acts(a)}</li>`).join('');
    // التصحيح قد يقترح جانبًا واحدًا (والآخر يبقى كما سُجّل): يُسمّى الجانب بدل شرطةٍ معلّقة.
    const proposedSide=c=>c.proposed_in&&c.proposed_out?rangeTag(c.proposed_in,c.proposed_out):c.proposed_in?`الحضور ${clockTag(c.proposed_in)}`:c.proposed_out?`الانصراف ${clockTag(c.proposed_out)}`:'';
    const corrections=data.corrections.map(c=>`<li><strong>${e(c.employee_name)} · ${dateTag(c.work_date)}${proposedSide(c)?` · ${proposedSide(c)}`:''}</strong><span>${e({pending:'بانتظار القرار',approved:'معتمد',rejected:'مرفوض'}[c.status])}${c.decided_by_name?` · ${e(c.decided_by_name)}`:''}</span><small>${e(c.reason)}${c.decision_note?` — ${e(c.decision_note)}`:''}</small>${acts(c)}</li>`).join('');
    // الغياب غير المدفوع قرار بخصم: من اقترحه ومن قرره يبقيان ظاهرين (شخصان مختلفان بعد سماع الموظف).
    const absences=data.absences.map(a=>`<li><strong>${e(a.employee_name)} · ${dateTag(a.work_date)}</strong><span>${e({proposed:'مقترح — ما انخصم شي',confirmed:'غياب غير مدفوع معتمد',dismissed:'صُرف الاقتراح'}[a.status])} · اقترحه ${e(a.proposed_by_name)}${a.decided_by_name?` · قرره ${e(a.decided_by_name)}`:''}</span><small>${e(a.reason)}${a.employee_statement?` — إفادة الموظف: ${e(a.employee_statement)}`:' — الموظف ما قدّم إفادته للحين'}</small>${acts(a)}</li>`).join('');
    const missions=x.missions.map(m=>`<li class="${['rejected','cancelled'].includes(m.status)?'is-old':''}"><strong>${e(m.employee_name)} · ${e(m.destination)}</strong><span>${dateTag(m.from_date)}${m.to_date!==m.from_date?` إلى ${dateTag(m.to_date)}`:''} · ${e(m.status_name)}${m.decided_by_name?` · ${e(m.decided_by_name)}`:''}</span><small>${e(m.purpose)}${m.decision_note?` — ${e(m.decision_note)}`:''}</small>${acts(m)}</li>`).join('');
    const overtime=x.overtime.map(o=>`<li class="${o.status==='rejected'?'is-old':''}"><strong>${e(o.employee_name)} · ${dateTag(o.work_date)} · ${count((o.minutes/60).toFixed(2))} ساعة${o.retroactive?' · بأثر رجعي':''}</strong><span>${e(o.status_name)} · ${e(o.compensation_name)}${o.day_type_name?` · ${e(o.day_type_name)}`:''}${o.decided_by_name?` · ${e(o.decided_by_name)}`:''}${o.adjustment?` · حركة مسير ${dateTag(o.adjustment.month)}: ${e({proposed:'مقترحة',approved:'معتمدة',rejected:'مرفوضة'}[o.adjustment.status]??o.adjustment.status)}`:o.status==='approved'&&o.compensation==='pay'?' · ما انحوّلت للمسير للحين':''}${o.suggested?` · المقترح ${riyal(o.suggested)}`:''}</span><small>${e(o.reason)}${o.decision_note?` — ${e(o.decision_note)}`:''}</small>${o.double_pay_warning?`<small><span class="badge needs_info">تنبيه قبل الاعتماد</span> ${e(o.double_pay_warning)}</small>`:''}${acts(o)}</li>`).join('');
    // العطلة المقررة تُعرض بمضمونها وسندها؛ واسم من اقترحها يبقى ما دامت تنتظر القرار (من يُراجَع، والمعتمد غيره).
    const holidays=x.holidays.map(h=>`<li class="${h.status==='rejected'?'is-old':''}"><strong><time datetime="${e(String(h.holiday_date).slice(0,10))}">${e(dual(h.holiday_date))}</time> · ${e(h.name)}</strong><span>${e(h.status_name)}${h.status==='proposed'?` · اقترحها ${e(h.proposed_by_name)}`:''}</span><small>${e(h.basis)}</small>${acts(h)}</li>`).join('');
    const shifts=x.shifts.map(sh=>`<li><strong>${e(sh.employee_name)} · ${rangeTag(sh.start_time,sh.end_time)}</strong><span>${dateTag(sh.from_date)} إلى ${dateTag(sh.to_date)} · ${sh.workdays.map(d=>e(x.weekdays[d])).join('، ')}${sh.ended_at?' · انتهت قبل موعدها':''}</span><small>${e(sh.reason)} — أسندها ${e(sh.assigned_by_name)}</small>${acts(sh)}</li>`).join('');
    const requests=`<h2>الطلبات والقرارات</h2>${grid(block('الاستئذان',permissions,'ما فيه طلبات استئذان للحين. تطلبه من «طلب استئذان» فوق، ويعتمده مديرك المباشر.'),block('إشعارات اليوم',notices,'ما فيه إشعارات تأخر أو غياب. لو بتتأخر أو بتغيب اليوم، الإشعار يوصل مديرك على طول.'),block('تكليفات العمل الإضافي',assignments,'ما فيه تكليفات. العمل الإضافي يبدأ بتكليف مسبق من المدير المباشر.'))}`
      +`${grid(block('طلبات التصحيح',corrections,'ما فيه طلبات تصحيح. إذا نسيت بصمة أو انسجّلت غلط، اطلب تصحيح من فوق.'),block('الغياب غير المدفوع',absences,'ما فيه اقتراحات غياب. لو اقترحت الموارد البشرية غياب غير مدفوع يطلع هنا، وتقدّم إفادتك قبل أي قرار.'))}`
      +`${grid(block('مهمات العمل',missions,'ما فيه مهمات عمل. أيام المهمة المعتمدة ما تحتاج بصمة، وتطلبها من «طلب مهمة عمل».'),block('العمل الإضافي المسجل',overtime,'ما فيه ساعات عمل إضافي. تنسجّل بتكليف مسبق، أو بطلب بأثر رجعي مع تبرير.'),block('العطل الرسمية',holidays,'ما فيه عطل مسجّلة. بدون عطلة معتمدة، اليوم اللي ما فيه بصمة يطلع «يحتاج توضيحًا».'),block('الورديات',shifts,'ما فيه ورديات، والدوام المعتمد يمشي على الكل.'))}`;

    // ٤) أدوات المدير والموارد البشرية تحت يوم الموظف: التنبيهات والطوابير التي تنتظر قرارًا أولًا، ثم الفريق والمراجع، ثم التقارير.
    const managerTools=[r.can_assign_overtime?button('assign_overtime','','تكليف بعمل إضافي'):'',hr?button('propose_holiday','','اقتراح عطلة رسمية'):'',hr?button('assign_shift','','إسناد وردية'):'',hr?button('propose_absence','','اقتراح غياب غير مدفوع'):'',hr?button('propose_exemption','','اقتراح إعفاء من الحضور'):'',hr?button('propose_site','','اقتراح موقع حضور'):''].join('');
    // نافذة رمضان 1448هـ المبدئية (م73(2) وم74(2)، ص 25): تُقال للمُعد بتاريخيها وتحفظها قبل أن يعدّ المسودة، وتُقال لمن يرى الشاشة أنها لم تُقبل بعد.
    const ramadan=r.ramadan_1448&&(hr||r.can_prepare_policy)&&!r.ramadan_1448.in_accepted_policy?`<p class="subtle">رمضان ${e(r.ramadan_1448.hijri)}: ${dateTag(r.ramadan_1448.from)} إلى ${dateTag(r.ramadan_1448.to)} (${rangeTag(r.ramadan_1448.start,r.ramadan_1448.end)}، ست ساعات) — نافذة مبدئية من تقويم أم القرى، يعدّها موظف الموارد البشرية المخوّل ويقبلها مدير الموارد البشرية بهويته. ${e(r.ramadan_1448.note)}</p>`:'';
    const unset=(hr||r.can_prepare_policy)&&r.unset.length?`<div class="vn-alert is-due"><strong>قيم ما قبلها مدير الموارد البشرية للحين، فما تسري:</strong><ul>${r.unset.map(v=>`<li>${e(v)}</li>`).join('')}</ul>${ramadan}${r.can_prepare_policy&&data.policy?`<div class="operation-actions">${button('prepare_rules_policy','','إعداد مسودة سياسة بقواعد اللائحة')}</div>`:''}</div>`:'';
    const coords=loc.coordinates_past_retention?`<div class="vn-alert is-due"><strong>${count(loc.coordinates_past_retention)} بصمة تعدّت مدة حفظ الإحداثيات وما انمسحت للحين.</strong><p>المسح يمشي بمهمة في طابور المهام — تأكد إن الطابور شغّال.</p></div>`:'';
    // القراءتان معًا أمام مُعد الرواتب: أجر الإجازة المستحقة وأجر الساعات الإضافية الأصلية، والمقترح أكبرهما. والإجازة المعتمدة بعد انتهاء الخدمة صف بلا زر.
    const payouts=(x.compensatory_payouts??[]).map(q=>q.cause==='untaken_leave'?ui.row({title:`${q.employee_name} · ${q.remaining_hours} ساعة مخصومة لإجازة ما راح تنأخذ`,tone:'is-due',meta:q.cause_name})
      :ui.row({title:`${q.employee_name} · ${q.remaining_hours} ساعة إجازة ما انستعملت (تقابل ${q.overtime_hours} ساعة عمل إضافي)`,tone:'is-due',
      html:`<span>${meta([e(q.cause_name),`عمل ${dateTag(q.work_date)}`,`المهلة ${dateTag(q.expires_on)}`,q.suggested?`المقترح ${riyal(q.suggested)}، أكبر القراءتين: أجر الإجازة المستحقة ${riyal(q.leave_wage)}، وأجر الساعات الإضافية الأصلية ${riyal(q.overtime_wage)}`:'ما فيه مقترح: ما فيه سياسة عمل إضافي مقبولة أو عقد ساري'])}</span>${acts(q)}`})).join('');
    const uncredited=(x.compensatory_uncredited??[]).map(q=>ui.row({title:`${q.employee_name} · ${q.work_date} · ${q.hours} ساعة`,meta:q.note,html:acts(q)})).join('');
    const review=loc.review.map(l=>`<li><strong>${e(l.employee_name)} · ${dateTag(l.work_date)} · ${l.kind==='in'?'حضور':'انصراف'} · ${e(l.zone_name)}</strong><span>${meta([l.distance_m!==null?`${e(l.distance_m)} م`:'بلا مسافة',l.accuracy_m!==null&&`الدقة ±${e(l.accuracy_m)} م`,l.zone_note_name&&e(l.zone_note_name)])}</span><small>${l.explanation?`توضيح الموظف: ${e(l.explanation)}`:'الموظف ما وضّح للحين.'}</small>${acts(l)}</li>`).join('');
    const team=data.team.map(m=>`<li><strong>${e(m.name)}</strong><span>${e(m.today?m.today.state_name:'يوم راحة')}${m.today?.check_in?` · ${clockTag(m.today.check_in)}`:''}</span></li>`).join('');
    // الإعفاء والموقع يعتمدهما شخص غير من اقترحهما: الاسمان سجل فصل المهام أمام الموارد البشرية، فيبقيان.
    const exemptions=r.exemptions.map(z=>`<li class="${z.status==='rejected'?'is-old':''}"><strong>${e(z.employee_name)} · ${dateTag(z.from_date)} إلى ${dateTag(z.to_date)}</strong><span>${e(z.status_name)} · اقترحه ${e(z.proposed_by_name)}${z.decided_by_name?` · قرره ${e(z.decided_by_name)}`:''}</span><small>${e(z.reason)}${z.decision_note?` — ${e(z.decision_note)}`:''}</small>${acts(z)}</li>`).join('');
    const sites=(loc.all_sites??[]).map(site=>`<li class="${['rejected','retired'].includes(site.status)?'is-old':''}"><strong>${e(site.name)} · نصف قطر ${count(site.radius_m)} م</strong><span><bdi dir="ltr" class="ltr">${e(site.lat)}, ${e(site.lng)}</bdi> · ${e(site.status_name)} · اقترحه ${e(site.proposed_by_name)}${site.decided_by_name?` · قرره ${e(site.decided_by_name)}`:''}</span>${site.decision_note||site.retire_reason?`<small>${e(site.decision_note||site.retire_reason)}</small>`:''}${acts(site)}</li>`).join('');
    const shortfall=r.shortfall.length?`<section class="vn-block"><h3>النقص الأسبوعي من ${dateTag(r.week_from)} إلى ${dateTag(r.week_to)}</h3>${ui.table({head:['الموظف','المتوقع','المعمول','استئذان','النقص','تأخر','انصراف مبكر','يحتاج توضيحًا'],
      rows:r.shortfall.map(w=>`<tr><td>${e(w.name)}</td><td>${e(hoursText(w.expected_minutes))}</td><td>${e(hoursText(w.worked_minutes))}</td><td>${e(w.permission_minutes)} د</td><td>${e(hoursText(w.shortfall_minutes))}</td><td>${e(w.late_days)}</td><td>${e(w.early_leave_days)}</td><td>${e(w.unexplained_days)}</td></tr>`)})}<p class="subtle">النقص = المتوقع − المعمول − الاستئذان المعتمد. للمتابعة بس، وما يتحول خصم.</p></section>`:'';
    const company=data.company?`<section class="vn-block"><h3>ملخص الشهر ${dateTag(data.month)} لكل موظف</h3>${ui.table({head:['الموظف','حاضر','متأخر','انصراف مبكر','بإذن','يحتاج توضيحًا','إجازة','عطلة ومهمة وإعفاء','غياب غير مدفوع'],
      rows:data.company.map(c=>`<tr><td>${e(c.name)}</td><td>${e(c.summary.present)}</td><td>${e(c.summary.late)}</td><td>${e(c.summary.early_leave)}</td><td>${e(c.summary.present_permission)}</td><td>${e(c.summary.incomplete+c.summary.unexplained)}</td><td>${e(c.summary.leave)}</td><td>${e(c.summary.holiday+c.summary.mission+c.summary.exempt)}</td><td>${e(c.summary.unpaid_absence)}</td></tr>`),
      empty:{title:'ما فيه موظفين نشطين في ملخص هذا الشهر',body:'الملخص يطلع لما يكون في الشركة موظفين نشطين.'}})}</section>`:'';
    const workbook=`<a class="btn outline small" href="/api/attendance/workbook.xlsx?month=${e(data.month)}" download>دفتر الشهر (<span lang="en" dir="ltr">Excel</span>)</a>`;
    const toolsShown=managerTools||data.team.length||hr||approver||payouts||uncredited||unset||data.company;
    const tools=toolsShown?`<h2 class="mt">أدوات المدير والموارد البشرية</h2><div class="operation-actions">${managerTools}${workbook}</div>${unset}${coords}`
      +grid(payouts?block('أرصدة تعويضية مستحقة الصرف',payouts,''):'',uncredited?block(UNCREDITED,uncredited,''):'',review||hr||approver?block('بصمات تنتظر المراجعة',review,'ما فيه بصمات معلّمة تنتظر المراجعة. البصمة تتعلّم إذا كانت خارج النطاق أو بلا موقع.'):'',
        data.team.length?`<section class="vn-block"><h3>فريقي اليوم</h3><ul class="vn-list">${team}</ul></section>`:'',hr||approver?block('إعفاءات الحضور',exemptions,'ما فيه إعفاءات. تقترحها الموارد البشرية ويعتمدها شخص ثاني.'):'',
        loc.all_sites?block('مواقع الحضور',sites,'ما فيه مواقع. بدون موقع معتمد ما ينقاس الموقع ولا تنحفظ إحداثيات.'):'')
      +`${shortfall}${company}`:`<div class="operation-actions">${workbook}</div>`;

    // ٥) القواعد في الآخر: نص الخادم كما هو بمواده، كل قاعدة بعنوانها.
    const rules=[['العمل الإضافي',x.overtime_rule],['الاستئذان والإعفاء',r.rule],['موقع البصمة',loc.rule]].filter(([,text])=>text).map(([title,text])=>`<li><strong>${e(title)}</strong><span>${e(text)}</span></li>`).join('');
    return `${head}<section class="vn-board">${myMonth}${requests}${tools}${rules?`<section class="vn-block"><h2>قواعد الحضور</h2><ul class="vn-list">${rules}</ul></section>`:''}</section>`;
  },
  form(action,id,data){
    const guard=ok=>{if(!ok)throw Error('الإجراء غير متاح لك الحين. حدّث الصفحة وشوف حالته.');};
    const r=data.rules,x=data.extras,loc=r.location,num=value=>value===undefined||value===''?undefined:Number(value);
    if(action==='punch_in'||action==='punch_out'){
      guard(action==='punch_in'?data.me.can_check_in:data.me.can_check_out);
      const ask=loc.active&&!loc.notice_acknowledged;
      return {title:action==='punch_in'?'تسجيل الحضور بوقت الخادم':'تسجيل الانصراف بوقت الخادم',endpoint:'/attendance/punch',submit:action==='punch_in'?'سجّل حضوري':'سجّل انصرافي',
        fields:ask?[field('location_notice_ack','اطلعت على إشعار الخصوصية وأوافق على إرسال موقعي عند التسجيل','checkbox',{required:false,hint:loc.policy.privacy_notice})]:[],
        // العينة تبدأ عند فتح النافذة فقط (بعد الموافقة إن لزمت)، ولا تتبع بعد الإرسال.
        opened(form){
          if(!loc.active)return;
          const start=geoPanel(form,loc.sites);
          if(!ask)start();else form.querySelector('[name="location_notice_ack"]')?.addEventListener('change',ev=>{if(ev.target.checked)start();});
        },
        toPayload:v=>({kind:action==='punch_in'?'in':'out',...(v.lat?{location:{lat:Number(v.lat),lng:Number(v.lng),accuracy:Number(v.accuracy)}}:{}),...(v.location_error?{location_error:v.location_error}:{}),...(v.location_notice_ack==='on'?{location_notice_ack:true}:{})}),
        after:(saved,esc)=>saved?.punch_location?.needs_explanation?{title:'انسجّلت بصمتك — وتحتاج توضيح',html:`<p>${esc(saved.punch_location.zone_name)}${saved.punch_location.distance_m!==null?` · ${esc(saved.punch_location.distance_m)} م`:''}.</p><p>بصمتك محفوظة بوقت الخادم. اكتب توضيحك من «بصمات تحتاج توضيحي» في شاشة الحضور.</p>`}:null};
    }
    if(action==='request_correction')return {title:'طلب تصحيح حضور',endpoint:'/attendance/corrections',idempotent:true,fields:[field('work_date','اليوم','date',{value:data.today}),field('proposed_in','وقت الحضور الصحيح','time'),field('proposed_out','وقت الانصراف الصحيح','time'),field('reason','السبب','textarea',{hint:'يقرره مديرك المباشر أو الموارد البشرية، والأوقات القديمة تبقى محفوظة.'})],toPayload:v=>v};
    if(action==='request_permission'){
      const cap=r.me.permission_cap_minutes===null?'ما فيه سقف شهري محدد للحين.':`باقي لك هذا الشهر ${r.me.permission_remaining_minutes} دقيقة من ${r.me.permission_cap_minutes}.`;
      return {title:'طلب استئذان',endpoint:'/attendance/permissions',idempotent:true,fields:[field('work_date','اليوم','date',{value:data.today}),field('kind','النوع','select',{options:Object.entries(r.permission_kinds).map(([value,label])=>({value,label}))}),field('from_time','من الساعة','time'),field('to_time','إلى الساعة','time'),field('reason','السبب','textarea',{hint:`يعتمده مديرك المباشر (م74(8)). إذا انعتمد تنشال علامة التأخر أو الانصراف المبكر في فترته. ${cap}`})],toPayload:v=>v};
    }
    if(action==='give_notice'){
      guard(r.me.notice_today.length<2);
      return {title:'إشعار في اليوم نفسه (م75)',endpoint:'/attendance/notices',idempotent:true,fields:[field('kind','الإشعار','select',{options:Object.entries(r.notice_kinds).filter(([k])=>!r.me.notice_today.includes(k)).map(([value,label])=>({value,label}))}),field('expected_time','الوقت المتوقع للوصول (للتأخر فقط)','time',{required:false}),field('reason','السبب','textarea',{hint:'يوصل مديرك الحين. إذا قبله عذر، ما ينحسب وصولك لين الوقت المذكور تأخير.'})],
        toPayload:v=>({kind:v.kind,reason:v.reason,...(v.kind==='late'?{expected_time:v.expected_time}:{})})};
    }
    if(action==='propose_absence'){guard(data.permissions.includes('hr.attendance.manage'));return {title:'اقتراح غياب غير مدفوع',endpoint:'/attendance/absences',idempotent:true,fields:[field('user_id','الموظف','select',{options:data.company.filter(c=>c.id!==data.user_id).map(c=>({value:c.id,label:`${c.name} · ${c.summary.unexplained} يوم بلا سجل`}))}),field('work_date','اليوم','date'),field('reason','سبب الاقتراح','textarea',{hint:'ما ينخصم شي قبل إفادة الموظف واعتماد شخص ثاني.'})],toPayload:v=>v};}
    const day=[['0','الأحد'],['1','الاثنين'],['2','الثلاثاء'],['3','الأربعاء'],['4','الخميس'],['5','الجمعة'],['6','السبت']];
    if(action==='request_mission')return {title:'طلب مهمة عمل',endpoint:'/attendance/missions',idempotent:true,fields:[field('from_date','من','date',{value:data.today}),field('to_date','إلى','date',{value:data.today}),field('destination','الوجهة أو الجهة'),field('purpose','الغرض','textarea',{hint:'يعتمدها مديرك المباشر. أيام المهمة المعتمدة ما تحتاج بصمة، وما ينجمع معها عمل إضافي (م77(9)).'})],toPayload:v=>v};
    // التعويض اختيار الموظف وحده (نظام العمل م107/1). الإجازة التعويضية تُعرض حين تُعتمد سياستها، ومعها جملة الموافقة بمقدارها ومهلتها قبل الإرسال؛
    // وإلا يبقى الأجر وحده ويُقال لماذا. الخادم يعيد بناء الجملة نفسها ويحفظها باسم الموظف ووقته.
    const offer=x.compensation_offer??{available:false,reason:''};
    const compensation=field('compensation','التعويض','select',{value:'pay',options:[{value:'pay',label:'أجر العمل الإضافي'},...(offer.available?[{value:'time_off',label:`إجازة تعويضية بدل الأجر (${offer.ratio} ساعة عن كل ساعة)`}]:[])],
      hint:offer.available?`الإجازة بدل الأجر ما تصير إلا باختيارك وموافقتك (${offer.articles}). تاخذها خلال ${offer.use_within_days} يومًا من يوم العمل، واللي ما تستعمله ينرد لك أجر.`:offer.reason});
    const consent=offer.available?[field('consent','أوافق على جملة الموافقة اللي تحت (لازمة إذا اخترت الإجازة التعويضية)','checkbox',{required:false})]:[];
    const consentLive=(v,esc)=>v.compensation!=='time_off'||!offer.available?'':!v.work_date||!Number(v.minutes)?'<p class="subtle">اختر اليوم والمدة عشان تشوف جملة الموافقة.</p>'
      :`<p><strong>جملة الموافقة:</strong> ${esc(compensatoryConsentSentence({work_date:v.work_date,overtime_minutes:Number(v.minutes),ratio_bp:offer.ratio_bp,use_within_days:offer.use_within_days}))}</p>${v.consent==='on'?'':'<p><span class="badge pending">لم تؤكد موافقتك بعد</span> ما ينرسل اختيار الإجازة بدون تأكيدها.</p>'}`;
    const compensationPayload=v=>({compensation:v.compensation,...(v.compensation==='time_off'?{consent:v.consent==='on'}:{})});
    if(action==='request_overtime')return {title:'عمل إضافي بأثر رجعي بلا تكليف مسبق',endpoint:'/attendance/overtime',idempotent:true,fields:[field('work_date','اليوم','date',{value:data.today}),field('minutes','المدة بالدقائق','number',{min:15,max:720,step:15,value:60}),compensation,...consent,field('reason','تبرير العمل دون تكليف مسبق','textarea',{hint:`عشرين حرف على الأقل، والطلب يتعلّم «بأثر رجعي». ${x.overtime_rule}`})],
      live:consentLive,toPayload:v=>({work_date:v.work_date,minutes:Number(v.minutes),reason:v.reason,...compensationPayload(v)})};
    if(action==='assign_overtime'){
      guard(r.can_assign_overtime);const o=r.overtime_policy;
      return {title:'تكليف كتابي مسبق بعمل إضافي (م76(1)، م77(2))',endpoint:'/attendance/overtime-assignments',idempotent:true,fields:[field('user_id','الموظف','select',{options:r.assignable.map(p=>({value:p.id,label:p.name}))}),field('from_date','من','date',{value:data.today}),field('to_date','إلى','date',{value:data.today}),field('minutes_per_day','المدة اليومية بالدقائق','number',{min:15,max:o.holiday_cap_minutes,step:15,value:60}),field('reason','العمل المطلوب وسبب الحاجة','textarea',{hint:`السقوف المقبولة: ${hoursText(o.daily_cap_minutes)} في يوم العمل، ${hoursText(o.holiday_cap_minutes)} في الراحة والعطلة، ${hoursText(o.weekly_cap_minutes)} في الأسبوع (م77(8)). يوافق عليه صاحب الصلاحية (م77(3))، وبعدها تعتمد الموارد البشرية ميزانيته (م77(7)).`})],
        toPayload:v=>({user_id:v.user_id,from_date:v.from_date,to_date:v.to_date,minutes_per_day:Number(v.minutes_per_day),reason:v.reason})};
    }
    if(action==='record_overtime'){
      const a=r.overtime_assignments.find(row=>row.id===id);guard(a&&a.actions.includes(action));
      return {title:`تسجيل العمل الإضافي الفعلي — تكليف ${a.from_date}`,endpoint:'/attendance/overtime',idempotent:true,fields:[field('work_date','اليوم','select',{options:a.days.filter(d=>d.date<=data.today).map(d=>({value:d.date,label:d.date}))}),field('minutes','المدة الفعلية بالدقائق','number',{min:15,max:a.minutes_per_day,step:15,value:a.minutes_per_day}),compensation,...consent,field('reason','العمل المنجز','textarea')],
        live:consentLive,toPayload:v=>({assignment_id:a.id,work_date:v.work_date,minutes:Number(v.minutes),reason:v.reason,...compensationPayload(v)})};
    }
    if(action==='propose_holiday'){guard(data.permissions.includes('hr.attendance.manage'));return {title:'اقتراح عطلة رسمية',endpoint:'/attendance/holidays',idempotent:true,fields:[field('holiday_date','التاريخ','date'),field('name','اسم العطلة'),field('basis','السند','textarea',{hint:'الإعلان الرسمي أو قرار الشركة ومصدره. يعتمدها شخص ثاني، والتواريخ الهجرية تندخل بعد ما تنعلن رسميًا.'})],toPayload:v=>v};}
    if(action==='assign_shift'){guard(data.permissions.includes('hr.attendance.manage'));return {title:'إسناد وردية',endpoint:'/attendance/shifts',idempotent:true,fields:[field('user_id','الموظف','select',{options:x.employees.map(u=>({value:u.id,label:u.name}))}),field('from_date','من','date',{value:data.today}),field('to_date','إلى','date'),field('start_time','بداية الوردية','time'),field('end_time','نهاية الوردية','time'),field('workdays','أيام العمل','checks',{value:['0','1','2','3','4'],options:day.map(([value,label])=>({value,label}))}),field('reason','سبب الوردية','textarea')],toPayload:v=>({...v,workdays:v.workdays.map(Number)})};}
    if(action==='propose_exemption'){guard(data.permissions.includes('hr.attendance.manage'));return {title:'اقتراح إعفاء من الحضور',endpoint:'/attendance/exemptions',idempotent:true,fields:[field('user_id','الموظف','select',{options:r.employees.map(u=>({value:u.id,label:u.name}))}),field('from_date','من','date',{value:data.today}),field('to_date','إلى','date'),field('reason','السبب','textarea',{hint:'يعتمده شخص ثاني. أيام الإعفاء المعتمد ما ينحكم فيها بتأخر ولا غياب، ولا ينطلب فيها موقع.'})],toPayload:v=>v};}
    if(action==='propose_site'){
      guard(data.permissions.includes('hr.attendance.manage'));
      return {title:'اقتراح موقع حضور',endpoint:'/attendance/sites',idempotent:true,fields:[field('name','اسم الموقع'),field('lat','خط العرض','number',{step:'any',min:-90,max:90}),field('lng','خط الطول','number',{step:'any',min:-180,max:180}),field('radius_m','نصف القطر بالمتر','number',{min:50,max:2000,step:25,value:200,hint:'يعتمده شخص ثاني. ما فيه خرائط خارجية: تكتب الإحداثيات أو تنأخذ من موقعك الحالي لما تفتح النافذة.'})],
        opened(form){const inputs=['lat','lng'].map(n=>form.querySelector(`[name="${n}"]`));geoPanel(form,[],{fill:fix=>{if(inputs[0]&&!inputs[0].value)inputs[0].value=String(Math.round(fix.lat*1e6)/1e6);if(inputs[1]&&!inputs[1].value)inputs[1].value=String(Math.round(fix.lng*1e6)/1e6);}})();},
        toPayload:v=>({name:v.name,lat:num(v.lat),lng:num(v.lng),radius_m:num(v.radius_m)})};
    }
    if(action==='explain_location'){const l=loc.mine.find(row=>row.id===id);guard(l&&l.actions.includes(action));return {title:`توضيح بصمة ${l.work_date}`,endpoint:`/attendance/locations/${id}/explain`,fields:[field('explanation','التوضيح','textarea',{hint:'مثل: اجتماع عند عميل، أو إشارة الموقع ضعيفة. يشوفه مديرك.'})],toPayload:v=>v};}
    if(action==='prepare_rules_policy'){
      guard(r.can_prepare_policy&&r.draft_parameters);const p=r.draft_parameters,o=p.overtime,ram=p.ramadan??{},l=p.location??{};
      return {title:'مسودة سياسة ساعات العمل بقواعد اللائحة',endpoint:'/hr/policies',idempotent:true,fields:[field('title','العنوان',undefined,{value:'ساعات العمل والحضور وفق اللائحة'}),field('body','نص السياسة','textarea',{maxLength:8000}),field('basis','السند','textarea',{value:Object.values(r.articles).join('\n')}),field('effective_from','تسري من','date',{value:data.today}),
        field('workdays','أيام العمل','checks',{value:p.workdays.map(String),options:day.map(([value,label])=>({value,label}))}),field('start','بداية الدوام','time',{value:p.start}),field('end','نهاية الدوام','time',{value:p.end}),field('grace_minutes','مهلة التأخير بالدقائق (لم تحددها اللائحة)','number',{min:0,max:120,value:p.grace_minutes}),
        field('ramadan_from','رمضان من (م73(2) وم74(2)، ص 25؛ نافذة 1448هـ مبدئية حتى الرؤية)','date',{required:false,value:ram.from??''}),field('ramadan_to','رمضان إلى (قد تمتد يومًا إن أُكمل الشهر ثلاثين)','date',{required:false,value:ram.to??''}),field('ramadan_start','بداية دوام رمضان (قرار الشركة)','time',{required:false,value:ram.start??''}),field('ramadan_end','نهاية دوام رمضان (6 ساعات يوميًا و36 أسبوعيًا حدًّا)','time',{required:false,value:ram.end??''}),
        field('ot_daily','سقف العمل الإضافي في يوم العمل بالدقائق (م77(8))','number',{value:o.daily_cap_minutes}),field('ot_holiday','سقفه في الراحة والعطلة بالدقائق','number',{value:o.holiday_cap_minutes}),field('ot_weekly','السقف الأسبوعي بالدقائق','number',{value:o.weekly_cap_minutes}),field('ot_annual','السقف السنوي بأشهر الأساسي (م77(5))','number',{value:o.annual_cap_basic_months}),field('ot_share','نسبة الأساسي المضافة بنقاط الأساس (م76(2))','number',{value:o.basic_share_bp}),field('ot_days','أيام الشهر في قسمة الأجر (م50(1): الشهر 30 يومًا)','number',{value:o.hour_divisor_days}),field('ot_hours','ساعات اليوم في قسمة الأجر (م73(2): ثماني ساعات)','number',{value:o.hour_divisor_hours}),
        field('permission_cap','سقف الاستئذان الشهري بالدقائق (لم تحدده اللائحة)','number',{required:false,value:p.permission_monthly_cap_minutes??''}),
        field('retention_days','مدة حفظ الإحداثيات الخام بالأيام','number',{required:false,value:l.retention_days??''}),field('max_accuracy_m','أسوأ دقة تُقبل قرينةً بالأمتار','number',{required:false,value:l.max_accuracy_m??100}),field('privacy_notice','نص إشعار الخصوصية قبل أول استعمال للموقع','textarea',{required:false,value:l.privacy_notice??'',hint:'المسودة ما لها أثر لين يقبلها مدير الموارد البشرية من شاشة العقود والسياسات، واللي ينترك فاضي ما يسري.'})],
        toPayload:v=>{const n=k=>Number(v[k]),parameters={workdays:(v.workdays??[]).map(Number),start:v.start,end:v.end,grace_minutes:n('grace_minutes'),
          overtime:{daily_cap_minutes:n('ot_daily'),holiday_cap_minutes:n('ot_holiday'),weekly_cap_minutes:n('ot_weekly'),annual_cap_basic_months:n('ot_annual'),basic_share_bp:n('ot_share'),hour_divisor_days:n('ot_days'),hour_divisor_hours:n('ot_hours')}};
          if(v.ramadan_from&&v.ramadan_to)parameters.ramadan={from:v.ramadan_from,to:v.ramadan_to,start:v.ramadan_start,end:v.ramadan_end};
          if(v.permission_cap!=='')parameters.permission_monthly_cap_minutes=n('permission_cap');
          if(v.retention_days!==''&&v.privacy_notice)parameters.location={retention_days:n('retention_days'),privacy_notice:v.privacy_notice,max_accuracy_m:n('max_accuracy_m')};
          return {kind:'working_time',title:v.title,body:v.body,basis:v.basis,effective_from:v.effective_from,parameters};}};
    }
    if(ruleRoutes[action]){
      const [kind,step,required]=ruleRoutes[action];
      const list=kind==='permissions'?r.permissions:kind==='notices'?r.notices:kind==='overtime-assignments'?r.overtime_assignments:kind==='exemptions'?r.exemptions:kind==='sites'?loc.all_sites??[]:loc.review;
      const row=list.find(item=>item.id===id);guard(row&&row.actions.includes(action));
      return {title:`${labels[action]} — ${row.employee_name??row.name}`,endpoint:`/attendance/${kind}/${id}/${step}`,fields:[field('note',step==='budget'?'اعتماد الميزانية كتابةً':'أساس القرار','textarea',{required,hint:step==='budget'?'الأجر ينقدّر من العقد الساري والسياسة المقبولة، وينرفض إذا تعدّى السقف السنوي (م77(5)).':undefined})],toPayload:v=>(v.note?{note:v.note}:{})};
    }
    if(action==='compensatory_to_payroll'){
      const q=(x.compensatory_payouts??[]).find(item=>item.id===id);guard(q&&q.actions.includes(action));
      return {title:`${labels[action]} — ${q.employee_name}`,endpoint:`/attendance/compensatory/${id}/payroll`,fields:[field('month','شهر المسير','month',{required:false,hint:q.cause==='service_ended'?'اتركه فاضي ويدخل مسير شهر انتهاء الخدمة: آخر مسير فيه سطر لصاحب الرصيد.':'اتركه فاضي ويدخل أول شهر مسيره مفتوح.'}),field('amount','المبلغ','text',{required:!q.suggested,value:q.suggested??''}),
        field('basis','أساس الاحتساب','textarea',{required:!q.suggested,hint:`${q.remaining_hours} ساعة إجازة ما انستعملت (${q.cause_name}) تقابل ${q.overtime_hours} ساعة عمل إضافي (÷ ${q.ratio}). ${q.suggested?`المقترح ${q.suggested} ريال، أكبر القراءتين: أجر الإجازة المستحقة ${q.leave_wage} ريال (اللائحة التنفيذية م22 مكرر/4)، وأجر الساعات الإضافية الأصلية ${q.overtime_wage} ريال (نظام العمل م107/1). أي القراءتين تعتمدها الشركة سؤال مفتوح عند مدير الموارد البشرية، والمبلغ المختلف لازم له أساس مكتوب.`:'ما فيه مقترح: اكتب المبلغ وسنده.'} الحركة تبقى مقترحة لين يعتمدها معتمد الرواتب.`})],
        toPayload:v=>({...(v.month?{month:v.month}:{}),...(v.amount?{amount:v.amount}:{}),...(v.basis?{basis:v.basis}:{})})};
    }
    if(action==='credit_compensatory'){
      const q=(x.compensatory_uncredited??[]).find(item=>item.id===id);guard(q&&q.actions.includes(action));
      return {title:`${labels[action]} — ${q.employee_name} · ${q.work_date}`,endpoint:`/attendance/compensatory/${id}/credit`,fields:[field('note','سند القيد','textarea',{hint:`${q.hours} ساعة انعتمدت واختار صاحبها وقت الراحة قبل دفتر الأرصدة. تنقيّد بالنسبة والمهلة المعتمدتين اليوم، والمهلة تبدأ من يوم العمل نفسه.`})],toPayload:v=>({note:v.note})};
    }
    if(extraRoutes[action]||action==='overtime_to_payroll'||action==='end_shift'){
      const list=action.includes('holiday')?x.holidays:action.includes('mission')?x.missions:action==='end_shift'?x.shifts:x.overtime,row=list.find(item=>item.id===id);guard(row&&row.actions.includes(action));
      const title=`${labels[action]} — ${row.employee_name??row.name}`;
      if(action==='end_shift')return {title,endpoint:`/attendance/shifts/${id}/end`,fields:[field('end_date','آخر يوم للوردية','date',{value:data.today}),field('reason','سبب الإنهاء','textarea')],toPayload:v=>v};
      if(action==='overtime_to_payroll'){
        const suggested=row.suggested;
        return {title,endpoint:`/attendance/overtime/${id}/payroll`,fields:[field('month','شهر المسير','month',{value:row.work_date.slice(0,7)}),field('amount','المبلغ','text',{required:!suggested,value:suggested??''}),field('basis','أساس الاحتساب','textarea',{required:!suggested,hint:suggested?`${(row.minutes/60).toFixed(2)} ساعة. المقترح ${suggested} ريال من السياسة المقبولة والعقد الساري (م76(2)). المبلغ المختلف لازم له أساس مكتوب، والحركة تحتاج اعتماد شخص ثاني.`:`${(row.minutes/60).toFixed(2)} ساعة معتمدة. ما فيه مقترح: ما فيه سياسة عمل إضافي مقبولة أو عقد ساري. اكتب المعدل وسنده، والحركة تحتاج اعتماد شخص ثاني.`})],
          toPayload:v=>({month:v.month,...(v.amount?{amount:v.amount}:{}),...(v.basis?{basis:v.basis}:{})})};
      }
      const [kind,step]=extraRoutes[action];return {title,endpoint:`/attendance/${kind}/${id}/${step}`,fields:[field('note','أساس القرار','textarea')],toPayload:v=>v};
    }
    if(action==='approve_correction'||action==='reject_correction'){const c=data.corrections.find(item=>item.id===id);guard(c&&c.actions.includes(action));return {title:`${labels[action]} — ${c.employee_name} · ${c.work_date}`,endpoint:`/attendance/corrections/${id}/${action==='approve_correction'?'approve':'reject'}`,fields:[field('note','أساس القرار','textarea')],toPayload:v=>v};}
    const a=data.absences.find(item=>item.id===id);guard(a&&a.actions.includes(action));
    if(action==='state_absence')return {title:`إفادتي عن يوم ${a.work_date}`,endpoint:`/attendance/absences/${id}/statement`,fields:[field('statement','إفادتك','textarea')],toPayload:v=>v};
    return {title:`${labels[action]} — ${a.employee_name} · ${a.work_date}`,endpoint:`/attendance/absences/${id}/${action==='confirm_absence'?'confirm':'dismiss'}`,fields:[field('note','أساس القرار','textarea')],toPayload:v=>v};
  }
};
