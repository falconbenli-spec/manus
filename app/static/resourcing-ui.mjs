// اعتماد كشوف الوقت وتخطيط الموارد والسعة.
// التمييز بين المبدئي والمؤكد بأصناف CSS قائمة (badge · badge subtle) لا بلون مضمّن: سياسة CSP تمنع style="".
// البلاطة والجدول من العدّة المشتركة (ctx.ui)؛ ومن يرسم الشاشة بلا صفحة (اختبار) يأخذ العدّة نفسها.
import { kit } from './kit.mjs';
const field=(name,label,type='text',extra={})=>({name,label,type,...extra});
const optional={required:false};
const guard=ok=>{if(!ok)throw Error('هالإجراء غير متاح لك الحين. حدّث الصفحة.');};
const clock=minutes=>`${Math.floor(minutes/60)}:${String(minutes%60).padStart(2,'0')}`;
const hours=value=>value===null||value===undefined?'—':`${value} س`;

export const timesheetsUI={
  title:'اعتماد كشوف الوقت',
  description:'الأسبوع وحدة القرار: يرسله الموظف ويعتمده مديره أو يرجّعه بسبب مكتوب، والمعتمِد هو اللي يقرر قابلية الفوترة. الأسبوع المعتمد ما تتعدل إدخالاته؛ التصحيح إدخال في أسبوع بعده يشير للأصل. والتذكير داخل المنصة بس: لا بريد.',
  load:api=>api('/timesheets'),
  render(data,{e,button,ui=kit(e)}){
    const entryRow=t=>`<li><strong>${e(t.work_date)} · ${e(t.project_name)} · ${e(clock(t.minutes))}</strong>
      <span>${t.approved_billable===null?`<span class="badge subtle">${e(t.billable?'يطلبها قابلة للفوترة':'غير قابلة للفوترة')}</span>`:`<span class="badge">${e(t.approved_billable?'انعتمدت قابلة للفوترة':'انعتمدت غير قابلة')}</span>`}${t.is_correction?' <span class="badge subtle">تصحيح</span>':''}</span>
      <small>${e(t.note)}${t.claimed_billable!==null&&t.claimed_billable!==t.approved_billable?' — المعتمِد غيّر قابلية الفوترة عن اللي انسجل':''}</small></li>`;
    const periodHead=p=>`<strong>${e(p.employee_name)} · ${e(p.week_start)} لين ${e(p.week_end)}</strong>
      <span><span class="badge ${e(p.status==='approved'?'is-ok':p.status==='returned'?'is-late':'subtle')}">${e(p.status_name)}</span> ${e(clock(p.minutes))} في ${e(p.entry_count)} إدخال${p.locked_without_approval?' <span class="badge is-late">مقفل بدون اعتماد</span>':''}</span>`;
    const pending=data.pending.map(p=>`<li class="${p.actions.length?'is-decision':''}">${periodHead(p)}<small>${e(p.submit_note||'بدون ملاحظة إرسال')}</small>
      ${p.actions.length?`<div class="operation-actions">${p.actions.map(a=>button(a,p.id,{approve_timesheet:'اعتماد الأسبوع',return_timesheet:'إعادة مع السبب'}[a])).join('')}</div>`:''}</li>`).join('');
    const missing=data.missing.map(m=>`<li class="is-late"><strong>${e(m.name)}</strong><span>${e(m.week_start)} · ${e(m.status==='returned'?'انعاد وما انرسل ثاني':'ما انرسل')} · ${e(m.entry_count)} إدخال</span><small>${e(m.reminded_at?'انذكّر':'ما انذكّر للحين')}</small></li>`).join('');
    const reminders=data.reminders.map(r=>`<li class="${r.read_at?'':'is-due'}"><strong>أسبوع ${e(r.week_start)}</strong><span>${e(r.read_at?'مقروء':'تذكير: الأسبوع ينتظر إرسالك')}</span>${r.read_at?'':`<div class="operation-actions">${button('read_reminder',r.id,'تمت القراءة')}</div>`}</li>`).join('');
    const teamRows=data.team_weeks.map(p=>`<tr><td>${e(p.employee_name)}</td><td>${e(p.status_name)}</td><td>${e(clock(p.minutes))}</td><td>${e(clock(p.billable_minutes))}</td><td>${e(p.approved_by_name??'—')}</td></tr>`);
    // الترتيب بالأهمية: تذكيراتي (خطوتي الجاية) ثم ما ينتظر قراري، ثم سجلاتي، ثم من ما أرسل، ثم أسابيع الفريق.
    return `<section class="panel panel-body vn-head"><p>${e(data.note)}</p>
      <p class="subtle">الأسبوع المعروض: ${e(data.week.from)} – ${e(data.week.to)}${data.week.closed?' (خلص)':' (جاري)'}.</p>
      <div class="operation-actions">${data.my_period.actions.includes('submit_timesheet')?button('submit_timesheet',data.week.from,'إرسال أسبوعي'):''}${data.correctable.length?button('log_correction','','تصحيح إدخال معتمد'):''}${data.can_approve?button('set_lock_window','','مدة القفل المجدول'):''}${data.can_approve&&data.lock?button('run_lock','','تنفيذ القفل الحين'):''}${data.can_approve&&data.missing.length?button('remind_missing',data.week.from,'تذكير اللي ما أرسلوا'):''}</div></section>
      <section class="vn-board"><div class="vn-tiles">
        ${ui.tile(clock(data.my_period.minutes),'ساعاتي في الأسبوع')}
        ${ui.tile(data.my_period.status_name,'حالة أسبوعي',data.my_period.status==='returned'?'is-late':data.my_period.status==='approved'?'is-ok':'')}
        ${data.can_approve?ui.tile(data.pending.length,'أسبوع ينتظر قراري',data.pending.length?'is-due':''):''}
        ${data.can_approve?ui.tile(data.missing.length,'لم يرسلوا أسبوعًا منتهيًا',data.missing.length?'is-late':''):''}
        ${ui.tile(data.lock?`${data.lock.lock_after_days} يوم`:'ما تحددت','مدة القفل المجدول',data.lock?'':'is-old')}</div>
      ${reminders?`<div class="vn-block"><h3>تذكيراتي</h3><ul class="vn-list">${reminders}</ul></div>`:''}
      ${data.can_approve?`<div class="vn-block"><h3>بانتظار قراري</h3>${pending?`<ul class="vn-list">${pending}</ul>`:'<p class="subtle">ما فيه أسبوع ينتظر قرارك.</p>'}</div>`:''}
      <div class="vn-block"><h3>سجلاتي في الأسبوع</h3>${data.my_period.decision_note?`<p class="vn-alert">${e(data.my_period.status==='returned'?'سبب الإعادة':'ملاحظة الاعتماد')}: ${e(data.my_period.decision_note)}</p>`:''}${data.my_period.entries.length?`<ul class="vn-list">${data.my_period.entries.map(entryRow).join('')}</ul>`:'<p class="subtle">ما فيه ساعات مسجلة في هالأسبوع. الساعات تنسجل من شاشة «ساعاتي وسعة الفريق».</p>'}</div>
      ${data.can_approve?`<div class="vn-block"><h3>لم يرسلوا أسبوعًا منتهيًا</h3>${missing?`<ul class="vn-list">${missing}</ul>`:'<p class="subtle">ولا أحد، أو الأسبوع المعروض ما خلص للحين.</p>'}</div>`:''}
      ${data.can_approve?`<div class="vn-block"><h3>أسابيع الفريق في المدة المعروضة</h3>${ui.table({head:['الموظف','الحالة','الساعات','المعتمد قابل للفوترة','المعتمِد'],rows:teamRows,empty:'ما عندك فريق مباشر'})}</div>`:''}</section>`;
  },
  form(action,id,data){
    if(action==='submit_timesheet'){
      guard(data.my_period.actions.includes('submit_timesheet'));
      return {title:`إرسال أسبوع ${data.week.from}`,endpoint:'/timesheets/submit',idempotent:true,
        fields:[field('note','ملاحظة للمعتمِد (اختيارية)','textarea',optional)],
        toPayload:v=>({week_start:data.week.from,note:v.note??''})};
    }
    if(action==='read_reminder')return {title:'تمت قراءة التنبيه',endpoint:`/timesheets/reminders/${id}/read`,fields:[],toPayload:()=>({})};
    if(action==='remind_missing'){
      guard(data.can_approve&&data.missing.length);
      return {title:'تذكير اللي ما أرسلوا أسبوعهم',endpoint:'/timesheets/remind',idempotent:true,fields:[],
        toPayload:()=>({week_start:data.week.from})};
    }
    if(action==='set_lock_window'){
      guard(data.can_approve);
      return {title:'مدة القفل المجدول',endpoint:'/timesheets/lock-window',
        fields:[field('lock_after_days','تنقفل الفترات الأقدم من (يوم)','number',{min:1,max:365,value:data.lock?.lock_after_days??''}),
          field('basis','سند المدة: مين أقرّها ومتى ووين توثّقت','textarea',{value:data.lock?.basis??'',hint:'ما فيه مدة افتراضية. هذا قرار المالك، وينحفظ بسنده وتاريخه.'})],
        toPayload:v=>({lock_after_days:Number(v.lock_after_days),basis:v.basis,version:data.lock?.version??0})};
    }
    if(action==='run_lock'){
      guard(data.can_approve&&data.lock);
      return {title:`تنفيذ القفل حتى ${data.lock.cutoff}`,endpoint:'/timesheets/lock',idempotent:true,
        fields:[field('basis','سند تنفيذ القفل الحين','textarea',{hint:'القفل يمنع الإدخال بأثر رجعي، وما يعتمد أسبوع ما انعتمد.'})],
        toPayload:v=>({basis:v.basis})};
    }
    if(action==='log_correction'){
      guard(data.correctable.length);
      return {title:'تصحيح إدخال في أسبوع معتمد',endpoint:'/timesheets/correction',idempotent:true,
        fields:[field('original_entry_id','الإدخال المُصحَّح','select',{options:data.correctable.map(t=>({value:t.id,label:`${t.work_date} · ${t.project_name} · ${clock(t.minutes)}`}))}),
          field('work_date','يوم التصحيح (في أسبوع بعده)','date',{value:data.today}),
          field('minutes','الدقائق (مضاعفات 15)','number',{min:15,max:960,step:15,value:60}),
          field('billable','قابل للفوترة؟','select',{options:[{value:'yes',label:'نعم'},{value:'no',label:'لا'}]}),
          field('note','وش انجز في الإدخال المصحِّح','textarea'),
          field('reason','سبب التصحيح ووش الغلط في الأصل','textarea')],
        toPayload:v=>({original_entry_id:v.original_entry_id,work_date:v.work_date,minutes:Number(v.minutes),billable:v.billable==='yes',note:v.note,reason:v.reason})};
    }
    const p=data.pending.find(x=>x.id===id);guard(p&&p.actions.includes(action));
    if(action==='return_timesheet')return {title:`إعادة أسبوع ${p.employee_name}`,endpoint:`/timesheets/${id}/return`,
      fields:[field('note','سبب الإعادة بالتفصيل','textarea')],toPayload:v=>({version:p.version,note:v.note})};
    return {title:`اعتماد أسبوع ${p.employee_name}`,endpoint:`/timesheets/${id}/approve`,
      fields:[field('billable_entries','الإدخالات القابلة للفوترة','checks',{...optional,
          value:p.entries.filter(t=>t.billable).map(t=>t.id),
          options:p.entries.map(t=>({value:t.id,label:`${t.work_date} · ${t.project_name} · ${clock(t.minutes)} · ${t.note}`})),
          hint:'اللي تتركه بدون تحديد ينعتمد غير قابل للفوترة. القرار قرارك مو اللي سجّله الموظف.'}),
        field('note','ملاحظة الاعتماد (اختيارية)','textarea',optional)],
      toPayload:v=>({version:p.version,note:v.note??'',entries:p.entries.map(t=>({entry_id:t.id,billable:(v.billable_entries??[]).includes(t.id)}))})};
  }
};

export const resourcingUI={
  title:'خطة الموارد والسعة',
  description:'مين محجوز على وش ومتى. المبدئي ينعرض لحاله وما يدخل المجدول ولا مؤشر فرط التحميل. لا جدولة آلية ولا اقتراح أشخاص: المنصة تعرض التوفر والتعارض، والقرار للمدير.',
  load:api=>api('/resourcing'),
  render(data,{e,button,ui=kit(e)}){
    const weekTable=week=>{
      const rows=data.people.map(person=>{
        const cell=person.weeks.find(w=>w.week_start===week);
        if(!cell.capacity_known)return `<tr><td>${e(person.name)}</td><td class="subtle" colspan="5">ما انكتبت سعته الأسبوعية</td><td><span class="badge subtle">مبدئي ${e(cell.tentative_hours)} س</span></td><td>—</td></tr>`;
        return `<tr><td>${e(person.name)}</td><td>${e(hours(cell.capacity_hours))}</td><td>${e(hours(cell.leave_hours))}</td><td>${e(hours(cell.mission_hours))}</td>
          <td><span class="badge">مؤكد ${e(cell.confirmed_hours)} س</span></td><td>${e(hours(cell.net_capacity_hours))}</td>
          <td><span class="badge subtle">مبدئي ${e(cell.tentative_hours)} س</span></td>
          <td class="${e(cell.overload_hours>0?'is-late':cell.available_hours<=0?'is-due':'is-ok')}">${e(cell.overload_hours>0?`فرط ${cell.overload_hours} س`:`متاح ${cell.available_hours} س`)}</td></tr>`;
      }).join('');
      const holders=data.placeholders.map(h=>{
        const cell=h.weeks.find(w=>w.week_start===week);
        return `<tr><td>${e(h.role_name)} <span class="badge subtle">عنصر نائب</span></td><td class="subtle" colspan="4">${e(h.project_name)}</td><td><span class="badge">مؤكد ${e(Math.round(cell.confirmed_minutes/6)/10)} س</span></td><td><span class="badge subtle">مبدئي ${e(Math.round(cell.tentative_minutes/6)/10)} س</span></td><td>—</td></tr>`;
      }).join('');
      return `<section class="vn-block"><h3>أسبوع ${e(week)}</h3><div class="table-wrap"><table>
        <thead><tr><th>الشخص</th><th>السعة</th><th>إجازات</th><th>مهمات</th><th>المجدول المؤكد</th><th>السعة بعد الخصم</th><th>مبدئي (خارج الحساب)</th><th>المتاح</th></tr></thead>
        <tbody>${rows||'<tr><td colspan="8">ما فيه أشخاص في نطاقك.</td></tr>'}${holders}</tbody></table></div></section>`;
    };
    const bookingRow=b=>`<li><strong>${e(b.person_name??b.role_name)} · ${e(b.project_name)} · ${e(b.hours_per_week)} س/أسبوع</strong>
      <span><span class="badge ${e(b.status==='confirmed'?'':b.status==='released'?'is-old':'subtle')}">${e(b.status_name)}</span> ${e(b.from_date)} لين ${e(b.to_date)}</span>
      <small>${e(b.note)}</small>${b.actions.length?`<div class="operation-actions">${b.actions.map(a=>button(a,b.id,{confirm_booking:'تأكيد الحجز',release_booking:'إطلاق الحجز'}[a])).join('')}</div>`:''}</li>`;
    const holderRow=h=>`<li><strong>${e(h.role_name)} · ${e(h.project_name)}</strong><span><span class="badge ${e(h.status==='open'?'subtle':'is-ok')}">${e(h.status_name)}</span> ${e(h.booking_count)} حجز${h.filled_user_name?` · صار ${e(h.filled_user_name)}`:''}</span>
      ${h.actions.length?`<div class="operation-actions">${h.actions.map(a=>button(a,h.id,'استبدال بشخص')).join('')}</div>`:''}</li>`;
    const overloaded=data.people.filter(p=>p.overloaded_weeks>0);
    return `<section class="panel panel-body vn-head"><p>${e(data.note)}</p>
      <p class="subtle">المدة: ${e(data.window.from)} – ${e(data.window.to)}.</p>
      <div class="operation-actions">${data.can_plan?(data.projects.length?button('create_booking','','حجز جديد')+button('create_placeholder','','عنصر نائب لدور'):'')+button('set_capacity','','سعة أسبوعية لشخص'):''}</div></section>
      <section class="vn-board"><div class="vn-tiles">
        ${ui.tile(data.people.length,'أشخاص في نطاقي')}
        ${ui.tile(overloaded.length,'تعدّى سعته في أسبوع',overloaded.length?'is-late':'')}
        ${ui.tile(data.bookings.filter(b=>b.status==='tentative').length,'حجز مبدئي')}
        ${ui.tile(data.bookings.filter(b=>b.status==='confirmed').length,'حجز مؤكد')}
        ${ui.tile(data.missing_capacity.length,'بدون سعة مكتوبة',data.missing_capacity.length?'is-old':'')}</div>
      ${overloaded.length?`<p class="vn-alert is-late">فرط تحميل بالساعات: ${e(overloaded.map(p=>`${p.name} (${p.overloaded_weeks} أسبوع)`).join('، '))}.</p>`:''}
      ${data.missing_capacity.length?`<p class="vn-alert">ما انكتبت السعة الأسبوعية لـ: ${e(data.missing_capacity.map(p=>p.name).join('، '))}.</p>`:''}
      ${data.weeks.map(weekTable).join('')}
      <div class="vn-block"><h3>الحجوزات</h3>${data.bookings.length?`<ul class="vn-list">${data.bookings.map(bookingRow).join('')}</ul>`:'<p class="subtle">ما فيه حجوزات.</p>'}</div>
      <div class="vn-block"><h3>العناصر النائبة</h3>${data.placeholder_records.length?`<ul class="vn-list">${data.placeholder_records.map(holderRow).join('')}</ul>`:'<p class="subtle">ما فيه عناصر نائبة.</p>'}</div></section>`;
  },
  form(action,id,data){
    if(action==='set_capacity'){
      guard(data.can_plan);
      return {title:'السعة الأسبوعية لشخص',endpoint:'/resourcing/capacity',idempotent:true,
        fields:[field('user_id','الشخص','select',{options:data.people_options.map(p=>({value:p.id,label:p.name}))}),
          field('effective_from','تسري من','date',{value:data.today}),
          field('hours_per_week','ساعات الأسبوع','number',{min:1,max:80}),
          field('basis','سند الرقم ومصدره','textarea',{hint:'ما فيه سعة افتراضية. الرقم يكتبه صاحبه بمصدره، ويتصحح بنسخة بتاريخ سريان جديد.'})],
        toPayload:v=>({user_id:v.user_id,effective_from:v.effective_from,hours_per_week:Number(v.hours_per_week),basis:v.basis})};
    }
    if(action==='create_placeholder'){
      guard(data.can_plan&&data.projects.length);
      return {title:'عنصر نائب لدور',endpoint:'/resourcing/placeholders',idempotent:true,
        fields:[field('project_id','المشروع','select',{options:data.projects.map(p=>({value:p.id,label:p.name}))}),
          field('role_name','اسم الدور','text',{hint:'مثل: مصمم جاي. ينحجز عليه قبل التعيين، وبعدين ينستبدل بشخص وتنتقل حجوزاته كلها مرة وحدة.'}),
          field('note','ملاحظة (اختيارية)','textarea',optional)],
        toPayload:v=>({project_id:v.project_id,role_name:v.role_name,note:v.note??''})};
    }
    if(action==='create_booking'){
      guard(data.can_plan&&data.projects.length);
      const subjects=[...data.people_options.map(p=>({value:`user:${p.id}`,label:p.name})),
        ...data.placeholder_records.filter(h=>h.status==='open').map(h=>({value:`placeholder:${h.id}`,label:`${h.role_name} (عنصر نائب)`}))];
      return {title:'حجز جديد (يبدأ مبدئيًا)',endpoint:'/resourcing/bookings',idempotent:true,
        fields:[field('project_id','المشروع','select',{options:data.projects.map(p=>({value:p.id,label:p.name}))}),
          field('subject','المحجوز','select',{options:subjects}),
          field('from_date','من','date',{value:data.window.from}),field('to_date','إلى','date'),
          field('hours_per_week','ساعات الأسبوع','number',{min:1,max:80}),
          field('note','سبب الحجز والشغل المتوقع','textarea',{hint:'كل حجز جديد يبدأ مبدئي، والتأكيد خطوة لحالها.'})],
        toPayload:v=>{const [kind,value]=v.subject.split(':');
          return {project_id:v.project_id,user_id:kind==='user'?value:null,placeholder_id:kind==='placeholder'?value:null,
            from_date:v.from_date,to_date:v.to_date,hours_per_week:Number(v.hours_per_week),note:v.note};}};
    }
    if(action==='fill_placeholder'){
      const h=data.placeholder_records.find(x=>x.id===id);guard(h&&h.actions.includes(action));
      return {title:`استبدال «${h.role_name}» بشخص`,endpoint:`/resourcing/placeholders/${id}/fill`,
        fields:[field('user_id','الشخص','select',{options:data.people_options.map(p=>({value:p.id,label:p.name}))}),
          field('note','أساس التعيين','textarea',{hint:`بتنتقل ${h.booking_count} حجز للشخص مرة وحدة بحالاتها زي ما هي.`})],
        toPayload:v=>({version:h.version,user_id:v.user_id,note:v.note})};
    }
    const b=data.bookings.find(x=>x.id===id);guard(b&&b.actions.includes(action));
    if(action==='confirm_booking')return {title:`تأكيد حجز ${b.person_name??b.role_name}`,endpoint:`/resourcing/bookings/${id}/confirm`,
      fields:[field('note','أساس التأكيد','textarea',{hint:'المؤكد يدخل المجدول ومؤشر فرط التحميل، وما فيه رجعة عن التأكيد إلا بإطلاق الحجز.'})],
      toPayload:v=>({version:b.version,note:v.note})};
    return {title:`إطلاق حجز ${b.person_name??b.role_name}`,endpoint:`/resourcing/bookings/${id}/release`,
      fields:[field('note','سبب الإطلاق','textarea')],toPayload:v=>({version:b.version,note:v.note})};
  }
};
