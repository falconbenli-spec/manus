// إعدادات الإشعارات لكل موظف، وشاشة البريد لمسؤول المنصة. الإشعار داخل المنصة يوصل دائمًا؛ البريد تنبيه ورابط بس.
// العدّة من ctx.ui، وبلاها تُبنى من kit نفسها فلا نسخة محلية من البلاطة.
import { kit } from './kit.mjs';
const field=(name,label,type='text',extra={})=>({name,label,type,...extra});
const guard=ok=>{if(!ok)throw Error('الإجراء غير متاح لك الحين. حدّث الصفحة.');};
const toolkit=(e,ui)=>typeof ui?.tile==='function'?ui:kit(e);
// الختم يُعرض بتوقيت الرياض (كان يُطبع ختم UTC كما هو فيُقرأ وقتًا محليًا خاطئًا)، وقيمته الآلية في datetime.
const RIYADH=new Intl.DateTimeFormat('ar-SA-u-ca-gregory-nu-latn',{dateStyle:'medium',timeStyle:'short',timeZone:'Asia/Riyadh'});
const when=(e,value)=>{
  const text=String(value??''),time=Date.parse(text);
  if(/^\d{4}-\d{2}-\d{2}$/.test(text))return `<time datetime="${e(text)}">${e(text)}</time>`;
  return Number.isNaN(time)?e(value??'—'):`<time datetime="${e(new Date(time).toISOString())}">${e(RIYADH.format(new Date(time)))}</time>`;
};
// الأيام بلهجة المنصة: «يوم» و«يومين» و«3 أيام» و«15 يوم».
const days=n=>Number(n)===1?'يوم':Number(n)===2?'يومين':`${n} ${Number(n)>=3&&Number(n)<=10?'أيام':'يوم'}`;
// اسمٌ مسموع للزر المتكرر في كل صف يحمل صاحبه، ويبدأ بنصه الظاهر (WCAG 2.5.3). النص الظاهر نفسه لا يتغيّر.
const named=(e,html,label)=>html.replace(/^<button\b/,`<button aria-label="${e(label)}"`);

export const notificationSettingsUI={
  title:'إعدادات الإشعارات',description:'تختار هنا اللي يوصلك بالبريد بعد. الإشعار داخل المنصة يوصلك دائمًا وما ينطفي.',
  load:api=>api('/notification-settings'),
  render(data,{e,button}){
    // البريد المطفأ انتباهٌ لا منع: الإشعار داخل المنصة يوصل في الحالتين.
    const mail=`<div class="vn-alert ${data.mail.enabled?'is-ok':'is-due'}"><p><strong>${e(data.mail.message)}</strong></p></div>`;
    const categories=`<ul class="vn-list">${data.categories.map(c=>`<li><strong>${e(c.name)}</strong><span>${c.email?'توصلك بالبريد وداخل المنصة':'داخل المنصة بس'}</span></li>`).join('')}</ul>`;
    const address=data.work_email?`بريدك الوظيفي المسجّل: <bdi dir="ltr">${e(data.work_email)}</bdi>`:data.has_profile?'ما فيه بريد وظيفي مسجّل لك للحين — تسجّله الموارد البشرية.':'ما لك ملف وظيفي للحين، فما يوصلك بريد.';
    const people=data.can_manage_addresses?`<section class="panel panel-body"><h2>البريد الوظيفي للموظفين <span>${e(data.people.length)}</span></h2><p class="subtle">يُعرض مقنّعًا، والبريد ما ينرسل لمن ما له عنوان.</p><ul class="vn-list">${data.people.map(p=>`<li class="${p.has_email?'':'is-old'}"><strong>${e(p.name)}</strong><span>${p.has_email?`<bdi dir="ltr">${e(p.work_email)}</bdi>`:p.has_profile?'ما له بريد':'ما له ملف وظيفي'}</span>${p.has_profile?`<div class="operation-actions">${named(e,button('set_work_email',p.id,p.has_email?'تغيير البريد':'تسجيل البريد'),`${p.has_email?'تغيير البريد':'تسجيل البريد'}: ${p.name}`)}</div>`:''}</li>`).join('')}</ul></section>`:'';
    return `<section class="panel panel-body vn-head"><p>${e(data.in_app)}</p>${mail}<p>${address}</p><div class="operation-actions">${button('save_categories','','اختيار اللي يوصلني بالبريد')}</div></section><section class="panel panel-body"><h2>الفئات</h2>${categories}</section>${people}`;
  },
  form(action,id,data){
    if(action==='save_categories')return {title:'اللي يوصلني بالبريد',endpoint:'/notification-settings',
      fields:[field('categories','الفئات اللي توصلك بالبريد بعد','checks',{required:false,options:data.categories.map(c=>({value:c.key,label:c.name})),value:data.categories.filter(c=>c.email).map(c=>c.key),hint:'اللي ما تختاره يوصلك داخل المنصة بس.'})],
      toPayload:v=>({categories:v.categories??[],version:data.version})};
    if(action==='set_work_email'){const p=data.people.find(x=>x.id===id);guard(p&&data.can_manage_addresses);
      return {title:`البريد الوظيفي — ${p.name}`,endpoint:`/employees/${encodeURIComponent(id)}/work-email`,fields:[field('work_email','البريد الوظيفي','email',{required:false,hint:'اتركه فاضي إذا تبي تحذف العنوان. ينكتب في سجل التدقيق مقنّعًا.'})],toPayload:v=>({work_email:v.work_email??''})};}
    throw Error('الإجراء غير متاح لك الحين. حدّث الصفحة.');
  }
};

export const mailUI={
  title:'البريد والإشعارات',description:'حالة بريد الإشعارات: المزوّد، والصادر، والتذكيرات اليومية. الرسالة تنبيه ورابط بس.',
  load:api=>api('/mail'),
  render(data,{e,button,ui:given}){
    const ui=toolkit(e,given),c=data.counts,cfg=data.config;
    // البريد غير المفعّل قرارٌ ينتظر المالك لا عطل: انتباه بدرجته، والناقص بأسمائه.
    const status=data.configured
      ?`<p>المزوّد: <bdi dir="ltr">${e(cfg.provider_host)}</bdi> · المرسل: <bdi dir="ltr">${e(cfg.from)}</bdi> · الحد: ${e(cfg.rate_per_minute)} رسالة في الدقيقة${cfg.app_url?` · الرابط: <bdi dir="ltr">${e(cfg.app_url)}</bdi>`:` · بلا رابط للمنصة (<bdi dir="ltr">MAIL_APP_URL</bdi>)`}</p>`
      :`<div class="vn-alert is-due"><p><strong>${e(data.status_message)}</strong></p>${cfg.missing?.length?`<p>ناقص: <bdi dir="ltr">${cfg.missing.map(e).join('، ')}</bdi></p>`:''}${cfg.invalid?.length?`<p>مو صالح: <bdi dir="ltr">${cfg.invalid.map(e).join('، ')}</bdi></p>`:''}${cfg.reason&&cfg.reason!==data.status_message?`<p>${e(cfg.reason)}</p>`:''}</div>`;
    // الصف: الحالة شكلٌ (نبرة الصف) وكلمة (اسمها)، ثم الفئة ومتى انكتب ومتى انرسل، ثم السبب.
    const tone={failed:'is-late',blocked:'is-due',queued:'is-pending',suppressed:'is-old'};
    const outboxRow=r=>ui.row({title:`${r.recipient_name} · ${r.status_name}`,tone:tone[r.status]??'',
      html:`<span>${e(r.category_name)} · ${when(e,r.created_at)}${r.sent_at?` · انرسل ${when(e,r.sent_at)}`:''} · المحاولات ${e(r.attempts)}</span><small>${e(r.reason)}${r.last_error?` — <bdi dir="ltr">${e(r.last_error)}</bdi>`:''}</small>`});
    const s=data.reminders.settings,last=data.reminders.last_run;
    const needs=last?.result?.expiry?.needs_owner_decision??[];
    const actions=[data.actions.includes('requeue_blocked')?button('requeue_blocked','','إعادة المحجوب للإرسال'):'',data.actions.includes('requeue_failed')?button('requeue_failed','','إعادة الفاشل للإرسال'):''].join('');
    // التذكيرات قيمة يقررها المالك: القيمة وسندها وحالتها، بلا سيرة. ومسودة الإعداد شكل المسودة وكلمتها.
    const reminders=`<section class="panel panel-body"><h2>التذكيرات اليومية — ${e(s.daily_at)}</h2><p><span class="badge ${s.status==='approved'?'approved':'draft'}">${e(s.status_name)}</span></p>`
      +`<p>تذكير القرارات المتأخرة: ${s.pending_approval_days?`بعد ${e(days(s.pending_approval_days))} من الانتظار`:'موقوف'} · ملخص المديرين: ${s.manager_digest?'يشتغل':'موقوف'}</p><p class="subtle">${e(s.probation_basis)}.</p>
      ${last?`<p>آخر تشغيل: ${when(e,last.date)} · ${e(last.status)}${last.result?` · انرسل: انتهاء الوثائق ${e(last.result.expiry?.sent??0)}، والتجربة ${e(last.result.probation?.sent??0)}، والقرارات ${e(last.result.approvals?.sent??0)}، والملخصات ${e(last.result.digests?.sent??0)}`:''}</p>`:'<p class="subtle">ما اشتغل للحين — أول تشغيل في موعده اليومي.</p>'}
      ${needs.length?`<div class="vn-alert is-due"><p><strong>تحتاج قرار مالك الإجراء: هالأنواع ما لها مدة تذكير، فما انرسل عنها شي.</strong></p><ul>${needs.map(n=>`<li>${e(n.name)}</li>`).join('')}</ul></div>`:''}
      ${s.can_set?`<div class="operation-actions">${button('reminder_settings','','تحديد إعداد التذكيرات')}</div>`:''}</section>`;
    // البلاطات لا تُلوَّن على صفر: «أُرسل» ما يصير سليمًا وهو صفر.
    return `<section class="panel panel-body vn-head">${status}<p class="subtle measure">${e(data.note)}</p>${actions?`<div class="operation-actions">${actions}</div>`:''}</section>
      <section class="vn-board"><div class="vn-tiles">${ui.tile(c.sent,'انرسل',c.sent?'is-ok':'')}${ui.tile(c.queued,'في الانتظار',c.queued?'is-due':'')}${ui.tile(c.failed,'فشل',c.failed?'is-late':'')}${ui.tile(c.blocked,'محجوب',c.blocked?'is-due':'')}${ui.tile(c.suppressed,'ما انرسل بقرار')}</div></section>
      ${data.failed.length?`<section class="panel panel-body"><h2>الفاشل (الرسائل الميتة) <span>${e(data.failed.length)}</span></h2><ul class="vn-list">${data.failed.map(outboxRow).join('')}</ul></section>`:''}
      <section class="panel panel-body"><h2>آخر الصادر</h2>${data.recent.length?`<ul class="vn-list">${data.recent.map(outboxRow).join('')}</ul>`:ui.empty('ما طلعت رسالة بالبريد للحين','أول ما ينرسل تنبيه بالبريد يطلع هنا بحالته.')}</section>
      ${reminders}
      <section class="panel panel-body"><h2>متغيرات البيئة</h2><p class="subtle">يحطّها المالك عند تشغيل الخادم. ما تنحفظ في القاعدة، والمفتاح ما يطلع هنا أبدًا.</p><ul class="vn-list">${data.env_vars.map(v=>`<li><strong><bdi dir="ltr">${e(v.name)}</bdi>${v.required?' (إلزامي)':''}</strong><span>${e(v.purpose)}</span></li>`).join('')}</ul></section>`;
  },
  form(action,id,data){
    if(action==='requeue_blocked'||action==='requeue_failed'){guard(data.actions.includes(action));const status=action==='requeue_blocked'?'blocked':'failed';
      return {title:action==='requeue_blocked'?'إعادة المحجوب للإرسال':'إعادة الفاشل للإرسال',endpoint:'/mail/requeue',fields:[field('reason','السبب','textarea',{hint:'آخر سبعة أيام بس، وبحد 500 رسالة. ينحفظ في سجل التدقيق.'})],toPayload:v=>({status,reason:v.reason})};}
    if(action==='reminder_settings'){const s=data.reminders.settings;guard(s.can_set);
      return {title:'إعداد التذكيرات اليومية',endpoint:'/mail/reminder-settings',fields:[
        field('pending_approval_days','تذكير المعتمد بعد كم يوم من الانتظار','number',{required:false,value:s.pending_approval_days??'',min:1,max:60,hint:'فاضي = التذكير موقوف.'}),
        field('manager_digest','ملخص يومي للمديرين','select',{value:s.manager_digest?'on':'off',options:[{value:'on',label:'يشتغل'},{value:'off',label:'موقوف'}]}),
        field('basis','سند القرار ومن اتخذه','textarea')],
        toPayload:v=>({pending_approval_days:v.pending_approval_days===''||v.pending_approval_days===undefined?null:Number(v.pending_approval_days),manager_digest:v.manager_digest==='on',basis:v.basis,version:s.version})};}
    throw Error('الإجراء غير متاح لك الحين. حدّث الصفحة.');
  }
};
