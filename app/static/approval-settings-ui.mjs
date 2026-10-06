// إعداد محرك الاعتماد: حدود المبالغ، المعتمد البديل، السياسات المقترحة، وفحص الكتالوج.
// لا يُدخل رقمًا من عنده: الحد يكتبه مسؤول الكتالوج بسنده ويعتمده غيره من الرئاسة.
// وشروط أهلية الخدمات (ترحيل 138) قسمٌ في هذه الشاشة نفسها بجوار لوح المفاتيح: السؤالان بابٌ واحد
// على الموظف، «هل هي مفتوحة» و«ومن ينطبق عليه شرطها»، ومالكهما واحد يقرؤهما في جلسة واحدة.
import { serviceGatesSection, serviceGatesForm } from './service-gates-ui.mjs';
const field=(name,label,type='text',extra={})=>({name,label,type,...extra});
const guard=ok=>{if(!ok)throw Error('الإجراء غير متاح. أعد تحميل الصفحة.');};
const ROLES={department_manager:'مدير الإدارة',hr:'الموارد البشرية',it:'تقنية المعلومات',pm:'مدير المشروع'};
const STATUS={proposed:'بانتظار الاعتماد',approved:'معتمد',rejected:'مرفوض'};
const SEVERITY={'عالية':'rejected','متوسطة':'pending','منخفضة':''};
const DEPUTY_STATUS={proposed:'مقترح بانتظار قبول ثانٍ',accepted:'مقبول وينفّذ',withdrawn:'مسحوب'};
const DEPUTY_BADGE={proposed:'pending',accepted:'approved',withdrawn:'rejected'};
// حال الزمن المستهدف بلون يُقرأ قبل النص: المتبنّى وحده أخضر. «مشتق» و«مسجَّل» ليسا التزامًا قطعه أحد،
// فلا يُلوَّنان لون الاطمئنان. الألفاظ نفسها من app/service-target.mjs — لا قاموس ثانٍ هنا.
const TARGET_BADGE={adopted:'approved',derived:'rejected',recorded:'pending',unset:''};
// الحد يُكتب بالريال في الشاشة ويُرسل بالهللات عددًا صحيحًا دون حساب عشري عائم.
export function riyalsToMinor(value){
  const text=String(value??'').trim();
  if(!/^\d{1,12}(?:\.\d{1,2})?$/.test(text))throw Error('اكتب المبلغ بالريال بخانتين عشريتين كحد أقصى');
  const [whole,fraction='']=text.split('.');
  return Number(whole)*100+Number(fraction.padEnd(2,'0'));
}
const riyals=minor=>minor===null||minor===undefined?'—':`${(minor/100).toLocaleString('ar-SA',{minimumFractionDigits:2,maximumFractionDigits:2})} ريال`;

// ── مهل محرك العمل وما يتوقف عليها (الموجة 2 «لا طلب يضيع») ────────────────────────
// يقول بوضوح: لا مهلة معتمدة = لا شيء آلي، وما الذي يبقى يدويًا لكل مهلة. الرقم يقترحه حساب ويتبناه حساب آخر بسنده.
// وما يخص من يدير الهيكل وحده: خطوات تنتظر من يسمّي صاحب قرارها، وعمل «قيد التنفيذ» عند حساب موقوف، وإشعارات لم تجد مستلمًا.
const TIMER_STATE={adopted:['approved','معتمدة'],proposed:['pending','مقترحة بانتظار تبنٍّ'],none:['rejected','غير معتمدة']};
function workflowSection(w,{e,button}){
  if(!w)return '';
  const timer=t=>{const [tone,label]=t.wired?TIMER_STATE[t.state]:['','لا قارئ لها بعد'];
    return `<li><strong>${e(t.name)}</strong><span><span class="badge ${tone}">${e(label)}</span>${t.adopted&&t.wired?` ${e(t.adopted.value)} ${e(t.adopted.unit_name)}`:''}</span><small>${e(t.meaning)}</small><small>${e(t.effect)}</small>${t.manual?`<small>يبقى يدويًا: ${e(t.manual)}</small>`:''}${t.adopted?`<small>السند: ${e(t.adopted.basis)}</small>`:''}${t.proposed?`<small>المقترح: ${e(t.proposed.value)} ${e(t.proposed.unit_name)} — اقترحه ${e(t.proposed.proposed_by_name??'')}، ويتبنّاه غيره — السند: ${e(t.proposed.basis)}</small>`:''}${t.actions.length?`<div class="operation-actions">${t.actions.map(a=>button(a,a==='propose_timer'?t.key:a==='retire_timer'?t.adopted.id:t.proposed.id,{propose_timer:'اقتراح رقم',adopt_timer:'تبنّي المقترح',withdraw_timer:'سحب المقترح',retire_timer:'إيقاف المهلة'}[a])).join('')}</div>`:''}</li>`;};
  const stuck=w.stuck_approvals?.visible?`<section class="vn-block"><h2>خطوات تنتظر من يسمّي صاحب قرارها</h2><p class="subtle">${e(w.stuck_approvals.note)}</p>${w.stuck_approvals.rows.length?`<ul class="vn-list">${w.stuck_approvals.rows.map(r=>`<li><strong><bdi>${e(r.service_code)}</bdi> — ${e(r.service_name)}${r.guarded?' (سرية)':''}</strong><span><bdi>${e(r.reference)}</bdi> · ${e(r.department_name)} · الخطوة ${e(r.position)} عند ${e(r.decider_name)}${r.decider_active?'':' — حسابه موقوف'} · ${e(r.waited_working_days)} يوم عمل</span><small>${e(r.why)}${r.blocked?` — ${e(r.blocked)}`:''}</small>${r.actions.length?`<div class="operation-actions">${button('override_escalation',r.step_id,'نقل القرار بسبب مكتوب')}</div>`:'<small>ما فيه درجة صالحة في السُلَّم المسجّل: سمّ مرجع تصعيد للإدارة أول.</small>'}</li>`).join('')}</ul>`:'<p class="subtle">ما فيه خطوة واقفة.</p>'}</section>`:'';
  const held=w.held_work?.visible?`<section class="vn-block"><h2>عمل «قيد التنفيذ» عند حساب موقوف</h2><p class="subtle">${e(w.held_work.note)}</p>${w.held_work.rows.length?`<ul class="vn-list">${w.held_work.rows.map(r=>`<li><strong><bdi>${e(r.service_code)}</bdi> — ${e(r.service_name)}${r.confidential?' (سرية)':''}</strong><span><bdi>${e(r.reference)}</bdi> · ${e(r.department_name)} · عند ${e(r.assignee_name)} · ${e(r.held_working_days)} يوم عمل</span><div class="operation-actions">${button('override_assignment',r.id,'تجاوز مسجَّل بسببه')}</div></li>`).join('')}</ul>`:'<p class="subtle">ما فيه عمل عالق عند حساب موقوف.</p>'}</section>`:'';
  const lost=w.undeliverable?.visible?`<section class="vn-block"><h2>إشعارات لم تجد مستلمًا</h2><p class="subtle">${e(w.undeliverable.note)}</p>${w.undeliverable.open.length?`<ul class="vn-list">${w.undeliverable.open.map(n=>`<li><strong>${e(n.kind)}</strong><span>${e([n.department_name,n.intended_name].filter(Boolean).join(' · ')||'بلا إدارة معروفة')} · ${e(String(n.created_at).slice(0,10))}</span><small>${e(n.reason)}</small><small>${e(n.tried.map(x=>x.outcome).join('؛ '))}</small><div class="operation-actions">${button('resolve_undeliverable',n.id,'عولج')}</div></li>`).join('')}</ul>`:`<p class="subtle">ما فيه إشعار بلا مستلم${w.undeliverable.resolved_count?` (انعالج ${e(w.undeliverable.resolved_count)})`:''}.</p>`}</section>`:'';
  // الساعة تبدأ من التبني: تُقال في الشاشة قبل أن يتبنى أحد رقمًا، لا بعد أن يفاجأ بتذكير عن طلب عمره شهران.
  return `<section class="vn-block"><h2>مهل محرك العمل</h2><p class="vn-alert${w.none_adopted?' is-warn':''}">${e(w.headline)}</p><p class="subtle">${e(w.note)}</p>${w.clock_rule?`<p class="subtle"><strong>${e(w.clock_rule)}</strong></p>`:''}<p class="subtle">${e(w.sweep_note)}</p><ul class="vn-list">${w.timers.map(timer).join('')}</ul></section>${stuck}${held}${lost}`;
}
function workflowForm(action,id,w){
  if(action==='propose_timer'){const t=w.timers.find(x=>x.key===id);guard(t&&t.actions.includes(action));
    return {title:`اقتراح «${t.name}»`,endpoint:'/workflow-timers',fields:[
      field('value',`القيمة (${t.unit_name}، من ${t.min} إلى ${t.max})`,'number',{min:t.min,max:t.max,step:1,hint:'المنصة لا تقترح رقمًا: اكتب ما قرره المالك. لا يسري حتى يتبناه حساب آخر.'}),
      field('basis','السند','textarea',{hint:'من قرر هذا الرقم ومتى ولماذا. رقم بلا سند رأي لا مهلة.'})
    ],toPayload:v=>({timer_key:t.key,value:Number(v.value),basis:v.basis})};}
  if(action==='adopt_timer'){const t=w.timers.find(x=>x.proposed?.id===id);guard(t&&t.actions.includes(action));
    return {title:`تبنّي «${t.name}»: ${t.proposed.value} ${t.proposed.unit_name}`,endpoint:`/workflow-timers/${id}/adopt`,fields:[
      field('note','ملاحظة التبني','textarea',{required:false,hint:'بعد التبني يتصرف التشغيل اليومي بناءً على هذا الرقم، ويُسجَّل صفّه في كل أثر.'})
    ],toPayload:v=>({note:v.note||''})};}
  if(action==='withdraw_timer'||action==='retire_timer'){const t=w.timers.find(x=>(action==='retire_timer'?x.adopted?.id:x.proposed?.id)===id);guard(t&&t.actions.includes(action));
    return {title:`${action==='retire_timer'?'إيقاف':'سحب مقترح'} «${t.name}»`,endpoint:`/workflow-timers/${id}/retire`,fields:[
      field('reason','السبب','textarea',{hint:action==='retire_timer'?'تعود الأتمتة المعتمدة عليها إلى السكون، ويبقى الصف في السجل.':'يبقى المقترح في السجل مسحوبًا.'})
    ],toPayload:v=>({reason:v.reason})};}
  if(action==='override_escalation'){const r=w.stuck_approvals.rows.find(x=>x.step_id===id);guard(r&&r.actions.includes(action));
    return {title:`نقل قرار خطوة — ${r.service_code}`,endpoint:`/workflow-control/steps/${id}/override`,fields:[
      field('to_user_id','إلى','select',{options:r.candidates.map(c=>({value:c.id,label:`${c.name} — ${c.title}`})),hint:'درجات سُلَّم تصعيد الإدارة المسجل التي ليست طرفًا في الطلب. لا يُسمّى غيرها.'}),
      field('reason','السبب','textarea',{hint:'يُسجَّل في الطلب وفي سجل التدقيق، ويصل من نُقل إليه ومن نُقل عنه.'})
    ],toPayload:v=>({to_user_id:v.to_user_id,reason:v.reason})};}
  if(action==='override_assignment'){const r=w.held_work.rows.find(x=>x.id===id);guard(r&&r.actions.includes(action));
    return {title:`تجاوز إسناد — ${r.service_code}`,endpoint:`/workflow-control/work/${id}/override`,fields:[
      field('to_user_id','إلى','select',{options:[{value:'',label:'— طابور الإدارة المنفذة —'},...r.candidates.map(c=>({value:c.id,label:c.name}))],required:false,hint:'من سلسلة تنفيذ الطلب وحدها، أو إلى الطابور ليستلمه أحد منفذيه.'}),
      field('reason','السبب','textarea',{hint:'تجاوز مسجَّل: يُكتب في أحداث الإسناد وسجل التدقيق باسمك.'})
    ],toPayload:v=>({to_user_id:v.to_user_id||null,reason:v.reason})};}
  if(action==='resolve_undeliverable'){const n=w.undeliverable.open.find(x=>x.id===id);guard(n);
    return {title:'إشعار بلا مستلم — عولج',endpoint:`/workflow-control/undeliverable/${id}/resolve`,fields:[
      field('note','ما الذي فُعل','textarea',{hint:'مثل: عُيّن مدير للإدارة، أو سُجّل مرجع تصعيد لها. الصف الأصلي يبقى في السجل.'})
    ],toPayload:v=>({note:v.note})};}
  return null;
}
// ── مفتاح تفعيل الخدمة وإخفائها (ترحيل 129) ─────────────────────────────────────
// طلب المالك 22 سبتمبر 2026: «خل عندي خيار اني افعلها او اخفيها … لكل خدمه». المفتاح يمسك سجلّين لا سجلًا
// واحدًا، لأن المثال الذي ضربه («تذكرة السفر السنوية») ميزةٌ في «مزاياي» لا خدمة في الدليل: فخدمات الدليل
// بالرمز، والمزايا بمفتاحها، وكلاهما في هذا القسم تحت التصريح نفسه («إعداد الخدمات»).
// الصفوف مجموعة بإداراتها لأنها 142 صفًّا، ومعها بحثٌ واحد يمشي على جداول الأقسام كلها ومعها جدول المزايا:
// applyTableFilters في app.mjs تطابق «المحدِّد + tbody tr»، فمحدِّد الحاوية وحده يغطي ما بداخلها من جداول.
// الجداول من ui.table لا من ترميز محلي، فيأخذها محسّن جداول الجوال (data-label) وتُقرأ على 390 بكسل بلا عرض جانبي.
const AVAILABILITY_BADGE={available:'approved',hidden:'rejected'};
// ما يُقرأ قبل الزر لا بعده: من أوقفها ومتى وبأي سبب. وما لم يُتخذ فيه قرار يقول ذلك بدل أن يترك الخانة فارغة.
const decisionText=row=>row.decided_at
  ?`${row.decided_by_name??row.decided_by} · ${String(row.decided_at).slice(0,10)}: ${row.reason}`
  :'لم يُتخذ فيها قرار بعد — متاحة بالافتراض';
function availabilitySection(a,{e,button,ui}){
  // اللوح لا يُرسم لغير حامل التصريح: الخادم يردّ can_manage=false بقوائم فارغة، فلا تُرسم شاشة أفعالٍ لا يملكها.
  // وشرطُ ui صريح لا احتياطي: هذا القسم يُبنى من العدّة وحدها (ui.card وui.table)، فلا نسخة محلية ثانية منهما
  // هنا تنحرف عنهما مع الوقت. app.mjs تمرّر العدّة في موضعها الواحد، والشاشة الذهبية ترسمها بالعدّة الحقيقية؛
  // وسياقٌ بلا عدّة (اختبارات أقدم من العدّة تبني سياقها بيدها) يقرأ بقية الشاشة كما كان ولا ينكسر عند هذا القسم.
  if(!a?.can_manage||typeof ui?.card!=='function'||typeof ui?.table!=='function')return '';
  // الزرّ يتكرر في 155 صفًّا، فاسمه المسموع يحمل صفّه ويبدأ بنصّه الظاهر (WCAG 2.5.3)؛ نصّه الظاهر يبقى فعلَ زرّ الحوار.
  const named=(html,label)=>html.replace(/^<button\b/,`<button aria-label="${e(label)}"`);
  const switchButton=row=>{const verb=row.state==='hidden'?'إعادة التفعيل':'إيقاف';return named(button('switch_availability',`${row.kind}|${row.key}`,verb),`${verb}: ${row.name}`);};
  const stateCell=row=>`<span class="badge ${e(AVAILABILITY_BADGE[row.state]??'')}">${e(row.state_name)}</span>`;
  // الطلبات المفتوحة تُقال عند الزر لا في صفحة أخرى: الإيقاف لا يقطعها، ومن يوقف خدمةً عليها أحد عشر طلبًا
  // يستحق أن يعرف ذلك قبل أن يضغط — لا ليمتنع، بل لئلا يظن أنه أوقفها فتوقفت.
  const openCell=row=>row.open_requests?`${row.open_requests} طلبًا مفتوحًا يكمل مساره`:'لا طلب مفتوح';
  const serviceRow=row=>`<tr data-filter-text="${e([row.key,row.name,row.department_name,row.section,row.state_name].join(' '))}">`
    +`<td><strong><bdi>${e(row.key)}</bdi></strong> — ${e(row.name)}${row.warning?`<small class="proposal-warning">${e(row.warning)}</small>`:''}</td>`
    +`<td>${stateCell(row)}</td><td>${e(decisionText(row))}</td><td>${e(openCell(row))}</td><td>${switchButton(row)}</td></tr>`;
  const head=['الخدمة','الحالة','آخر قرار','الطلبات المفتوحة',''];
  const byDepartment=new Map();
  for(const row of a.services){const list=byDepartment.get(row.department_name)??[];list.push(row);byDepartment.set(row.department_name,list);}
  // «المعروض» يُحسب لا يُفترض (مراجعة 22 سبتمبر): البطاقة المطوية تخفي صفوفها، فمجموع الصفوف الـ155 لم يكن
  // يومًا عدد ما يُرى. يُجمع هنا ما يقع داخل بطاقة مفتوحة، فيبدأ العدّاد صادقًا قبل أن يُكتب حرف في البحث،
  // ويبقى الإجمالي بجواره فلا يُقرأ العدد الأصغر كتالوجًا أصغر.
  let shownAtLoad=a.benefits.length;
  const departments=[...byDepartment.entries()].sort((x,y)=>String(x[0]).localeCompare(String(y[0]),'ar'))
    .map(([name,rows])=>{const off=rows.filter(r=>r.state==='hidden').length;
      if(off>0)shownAtLoad+=rows.length;
      // عدد الموقوفة يُقال في رأس القسم لا يُطرح صامتًا من العدد: «١٢ خدمة» و«١٢ خدمة منها ٢ موقوفة» جملتان مختلفتان.
      return ui.card({code:String(rows.length),title:name||'بلا إدارة',
        meta:off?`${rows.length} خدمة، منها ${off} موقوفة`:`${rows.length} خدمة، لا موقوفة`,open:off>0,
        body:ui.table({head,rows:rows.map(serviceRow)})});}).join('');
  const benefitRow=row=>`<tr data-filter-text="${e([row.key,row.name,row.state_name,'ميزة'].join(' '))}">`
    +`<td><strong><bdi>${e(row.key)}</bdi></strong> — ${e(row.name)}${row.request_option?'':'<small>ما يُطلب من «مزاياي»: ما له خيار طلب</small>'}</td>`
    +`<td>${stateCell(row)}</td><td>${e(decisionText(row))}</td><td>${e(row.catalog_status==='accepted'?'معتمدة في كتالوج المزايا':'لم تُعتمد في كتالوج المزايا بعد')}</td>`
    +`<td>${switchButton(row)}</td></tr>`;
  const benefits=ui.card({code:String(a.benefits.length),title:'مزايا «مزاياي»',
    meta:`${a.benefits.length} ميزة، منها ${a.totals.benefits_hidden} موقوفة — «تذكرة السفر السنوية» منها`,open:true,
    body:ui.table({head:['الميزة','الحالة','آخر قرار','حالها في كتالوج المزايا',''],rows:a.benefits.map(benefitRow)})});
  // السجل إلحاقي: الإخفاء قرار وإعادة التفعيل قرار ثانٍ، ويبقى الاثنان بسببيهما. لا يُختصر إلى «الحالة الآن».
  const history=a.history.length
    ?`<details><summary>سجل القرارات (${e(a.history.length)})</summary>${ui.table({head:['متى','ماذا','القرار','السبب','من'],
      rows:a.history.map(h=>`<tr><td><time datetime="${e(h.decided_at)}">${e(String(h.decided_at).slice(0,16).replace('T',' '))}</time></td><td><bdi>${e(h.target_key)}</bdi> · ${e(h.kind_name)}</td><td>${e(h.state_name)}</td><td>${e(h.reason)}</td><td>${e(h.decided_by_name)}</td></tr>`)})}</details>`
    :'<p class="subtle">ما فيه قرار تفعيل أو إيقاف للحين: كل خدمة وكل ميزة متاحة بالافتراض.</p>';
  const total=a.totals;
  // ما لا يبلغه المفتاح يُقال هنا لا في وثيقة تسليم (مراجعة 22 سبتمبر): «142 خدمة» يقرؤها المالك وعدًا بأن
  // «لكل خدمه» تحققت، وفي نافذة الطلب الجديد مدخلٌ لا صفّ له في الدليل — «طلب إجازة» — لا يمسّه هذا اللوح
  // ولا يستطيع. يُسمّى بالاسم ومعه من يوقفه فعلًا. القائمة من الخادم (availabilityBoard.out_of_reach) تُحسب
  // من الجدول نفسه، فما دخل الدليل يومًا سقط منها ولم يبقَ تحذيرًا كاذبًا.
  const reach=a.out_of_reach?.length
    ?`<p class="proposal-warning"><span class="badge pending">خارج مدى المفتاح</span> ${e(a.out_of_reach.length)} مدخل طلب لا يبلغه هذا اللوح: ${a.out_of_reach.map(x=>`<strong>${e(x.name)}</strong> (<bdi>${e(x.code)}</bdi>) — ${e(x.stop_how)}؛ ${e(x.owner)}`).join('، ')}. ${e(a.out_of_reach[0].why)}.</p>`
    :'';
  return `<section class="vn-block"><h2>تفعيل الخدمات وإخفاؤها</h2>
    <p class="subtle">${e(a.note)}</p>
    <p><span class="badge ${total.services_hidden?'rejected':'approved'}">${e(total.services_hidden)} خدمة موقوفة من ${e(total.services_total)}</span> <span class="badge ${total.benefits_hidden?'rejected':'approved'}">${e(total.benefits_hidden)} ميزة موقوفة من ${e(total.benefits_total)}</span></p>
    ${reach}
    <div class="cf-filters"><label><span>بحث في الخدمات والمزايا</span><input type="search" data-filter="#service-switch-list" autocomplete="off"></label><small class="subtle" role="status">المعروض: <span data-num data-filter-count="#service-switch-list">${e(shownAtLoad)}</span> من ${e(total.services_total+total.benefits_total)}</small></div>
    <div id="service-switch-list">${benefits}${departments}</div>
    ${history}</section>`;
}
// ── مركز الخدمات — الشجرة (الدفعة الرابعة): تسعة تبويبات في قسم واحد، والمرادفات سطح كتابته الوحيد ─────
// كل تبويب <details> من العدّة (ui.card)، ومادّته من GET /api/catalog/admin كما هي: الأعداد من placementFor، والأوزان
// بنصّها وصفراها بسببه، وخريطة الحالات من القاموس، وما لم يُبنَ (النشر، الاستيراد) مكتوبٌ سببه لا مرسومًا فارغًا.
// ولا يُرسم القسم لغير حامل «إعداد الخدمات»: الخادم يردّ can_manage=false بلا مادّة.
const SYNONYM_NOUN=n=>n===1?'مرادف واحد':n===2?'مرادفان':n>=3&&n<=10?`${n} مرادفات`:`${n} مرادفًا`;
// مصدَّرة ليُرسمها الاختبار على حمولة /api/catalog/admin وحدها، بلا حمولة إعداد الاعتماد كلها.
export function catalogTreeSection(c,{e,button,ui}){
  if(!c?.can_manage||typeof ui?.card!=='function'||typeof ui?.table!=='function')return '';
  // زرّا «تأكيد» و«حذف» يتكرران في كل صف مرادف، فاسم كلٍّ المسموع يحمل مرادفه وبنده ويبدأ بنصّه الظاهر (WCAG 2.5.3).
  const named=(html,label)=>html.replace(/^<button\b/,`<button aria-label="${e(label)}"`);
  const tab=(n,title,meta,body,open=false)=>ui.card({code:String(n),title,meta,open,body:`<div class="vn-body">${body}</div>`});
  // 1 الفئات والإسناد — أربعة جماهير، والصفران (عميل، مورّد) بسببهما.
  // فرق المدير فوق الموظف رقمٌ من الحمولة (صفوف الجمهورين) لا عبارة مكتوبة (مراجعة 23 سبتمبر).
  const employeeRows=c.categories.audiences.find(a=>a.key==='employee')?.rows??0;
  const delta=a=>{if(a.key!=='manager')return '';const d=a.rows-employeeRows;return d>0?` (فرقٌ فوق الموظف: ${d===1?'صفٌّ واحد':d===2?'صفّان':`${d} صفوف`})`:' (لا فرق فوق الموظف اليوم)';};
  const audiences=c.categories.audiences.map(a=>a.rows
    ?`<h3>${e(a.name)}</h3>${ui.table({head:['الفئة','بطاقات','بنود'],rows:a.categories.map(x=>`<tr><td>${e(x.name)}</td><td>${e(x.cards)}</td><td>${e(x.items)}</td></tr>`)})}`
      +`<p class="subtle">${e(`${a.totals.categories} فئات · ${a.totals.cards} بطاقة · ${a.totals.items} بندًا · ${a.rows} صفًّا في الإسقاط${delta(a)}`)}</p>`
    :`<h3>${e(a.name)}</h3><p class="subtle">${e(`0 صف. ${a.why_empty}`)}</p>`).join('');
  const categories=tab(1,'الفئات والإسناد',`${c.categories.entries} صفًّا · النسخة ${c.categories.release_version} · بلا فئة: ${c.categories.items_unplaced}`,
    `<p class="subtle">${e(c.categories.note)}</p>${audiences}<p class="subtle">${e(`أُسقط في ${String(c.categories.rebuilt_at??'').slice(0,10)}${c.categories.hidden_services?` · و${c.categories.hidden_services} خدمة موقوفة من الإعدادات لا تدخل العدّ`:''}`)}</p>`);
  // 2 الرحلات — الواحدة المبنيّة بخطواتها وشرطها، والسبع مادّةً.
  const built=c.journeys.built.map(j=>`<h3>${e(j.name)}</h3><p class="subtle">${e(j.description)}</p>`
    +ui.table({head:['الخطوة','الخدمة','الشرط','قيم التعريف'],rows:[`<tr><td>الأب</td><td>${e(j.parent.key)} — ${e(j.parent.name)}</td><td>${e(`يبدأ عند الاعتماد · الجمهور: ${j.audience}`)}</td><td></td></tr>`,
      ...j.steps.map(s=>`<tr><td>${e(s.key)}</td><td>${e(s.item.key)} — ${e(s.name)}</td><td>${e(s.condition)}</td><td>${e(Object.entries(s.preset).map(([k,v])=>`${k}=${v}`).join('، ')||'—')}</td></tr>`)]})
    +`<p class="subtle">${e(j.runs.length?`تشغيلات: ${j.runs.map(r=>`${r.status} ${r.n}`).join('، ')}`:'لا تشغيل بعد: لم يُعتمد طلب أب من هذا النوع.')}</p>`).join('');
  const later=ui.table({head:['الرحلة','المادّة القائمة','ما ينقص','الحالة'],rows:c.journeys.later.map(j=>`<tr><td>${e(j.name_ar)}</td><td>${e(j.material)}</td><td>${e(j.missing)}</td><td>${e(j.status)}</td></tr>`)});
  const journeys=tab(2,'الرحلات',`${c.journeys.built.length} مبنيّة · ${c.journeys.later.length} معرّفة لاحقًا · النسخة ${c.journeys.version}`,`<p class="subtle">${e(c.journeys.note)}</p>${built}<h3>معرّفة لاحقًا</h3>${later}`);
  // 3 المرادفات والبحث — سطح الكتابة الوحيد: بطاقة لكل بند، مطوية إلا ما فيه اقتراح ينتظر.
  const s=c.synonyms;
  let shownAtLoad=0;
  const item=x=>{
    const open=x.rows.some(r=>r.pending);
    if(open)shownAtLoad+=x.rows.length;
    const rows=x.rows.map(r=>`<tr data-filter-text="${e([x.key,x.name,r.term,r.source_name].join(' '))}"><td>${e(r.term)}${r.pending?' <span class="badge pending">مقترح بانتظار تأكيد ثانٍ</span>':''}</td>`
      +`<td>${e(r.source_name)}</td><td>${e(r.note||'')}</td><td>${e(r.added_by_name)} · ${e(String(r.added_at).slice(0,10))}</td>`
      +`<td>${r.pending&&r.proposed_by!==c.me?named(button('confirm_synonym',`${x.kind}|${x.key}|${r.normalized}`,'تأكيد'),`تأكيد «${r.term}» لـ${x.key}`):''}${r.removable?named(button('remove_synonym',`${x.kind}|${x.key}|${r.normalized}`,'حذف'),`حذف «${r.term}» من ${x.key}`):''}</td></tr>`);
    return ui.card({code:String(x.rows.length),title:`${x.key} — ${x.name}`,open,
      meta:[x.kind,x.confidential?'سرّية: المرادف فعل شخصين':'',x.rows.filter(r=>!r.pending).length<3?'أقل من ثلاثة مرادفات':''].filter(Boolean).join(' · '),
      body:ui.table({head:['المرادف','المصدر','ملاحظة','أضافه',''],rows,empty:{title:'لا مرادف بعد',body:'أضف كلمة الناس كما يكتبونها.'}})
        +`<div class="operation-actions">${button('add_synonym',`${x.kind}|${x.key}`,'أضف مرادفًا')}</div>`});
  };
  const items=s.items.map(item).join('');
  const misses=s.misses.length
    ?ui.table({head:['السؤال (مطبَّعًا)','مرات','آخرها',''],rows:s.misses.map(m=>`<tr><td>${e(m.query)}</td><td>${e(m.n)}</td><td>${e(String(m.last_at).slice(0,10))}</td><td>${button('add_synonym_for_miss',m.query,'أضف مرادفًا')}</td></tr>`)})
    :`<p class="subtle">${e(`لا بحثٌ بلا نتيجة تكرر ${s.min_count} مرات في ${s.window_days} يومًا${s.misses_below_minimum?` (${s.misses_below_minimum} سؤالًا دون الحدّ لا يُعرض)`:''}.`)}</p>`;
  const synonyms=tab(3,'المرادفات والبحث',`${s.totals.items} بندًا · ${s.totals.rows} صفًّا (${s.totals.curated} بيد إنسان) · ${SYNONYM_NOUN(s.totals.pending)} ينتظر تأكيدًا · ${s.totals.thin} بندًا بأقل من ثلاثة`,
    `<p class="subtle">${e(s.note)}</p><h3>بحثٌ بلا نتيجة تكرر ${e(s.min_count)} مرات في ${e(s.window_days)} يومًا</h3>${misses}`
    // ما لا يدخل التقرير أبدًا، بأسمائه: قرار المالك (§8-7) أن بحث السرّي لا يُسجَّل، فيُقال هنا لا يُكتشف بالمصادفة.
    +(s.excluded_from_log?.length?`<p class="subtle">${e(`لا يدخل هذا التقرير بحثٌ أصاب واحدةً من ${s.excluded_from_log.length} خدمة سرّية أو مغلقة الدائرة (قرار المالك: لا يُسجَّل بحثها أصلًا): ${s.excluded_from_log.map(x=>x.name).join('، ')}.`)}</p>`:'')
    // العدّاد عند الفتح هو كل الصفوف (لا مرشّح بعد)، ويتحرك مع المرشّح وحده؛ والبطاقات مطوية إلا ما فيه اقتراح ينتظر.
    +`<div class="cf-filters"><label><span>بحث في البنود والمرادفات</span><input type="search" data-filter="#catalog-synonyms" autocomplete="off"></label><small class="subtle" role="status">المعروض: <span data-num data-filter-count="#catalog-synonyms">${e(s.totals.rows)}</span> من ${e(s.totals.rows)}${shownAtLoad?` (${e(shownAtLoad)} مفتوحة لاقتراحٍ ينتظر)`:' — البطاقات مطويّة'}</small></div>`
    +`<div id="catalog-synonyms">${items}</div>`,s.totals.pending>0);
  // 4 التثبيت والمواسم — فارغان بمسارهما.
  const pins=tab(4,'التثبيت والمواسم',`${c.pins.rows.length} مثبّتة · ${c.seasons.rows.length} مواسم · الجاري اليوم: ${c.seasons.live.length}`,
    `<h3>التثبيت</h3>${c.pins.rows.length?ui.table({head:['الرمز'],rows:c.pins.rows.map(p=>`<tr><td>${e(p)}</td></tr>`)}):`<p class="subtle">${e(c.pins.note)}</p>`}`
    +`<h3>المواسم</h3>${c.seasons.rows.length?ui.table({head:['المفتاح','الاسم','التقويم','من','إلى','البنود'],rows:c.seasons.rows.map(x=>`<tr><td>${e(x.key)}</td><td>${e(x.name_ar)}</td><td>${e(x.calendar)}</td><td>${e(x.from)}</td><td>${e(x.to)}</td><td>${e((x.items??[]).join('، '))}</td></tr>`)}):`<p class="subtle">${e(c.seasons.note)}</p>`}`);
  // 5 حقول بطاقة الخدمة — رابط لشاشتها.
  const cardFields=tab(5,'حقول بطاقة الخدمة',c.card_fields.columns.join(' · '),`<p class="subtle">${e(c.card_fields.note)}</p><p><a class="btn outline small" href="${e(c.card_fields.link)}">افتح بطاقات التعريف ←</a></p>`);
  // 6 خريطة الحالات — من القاموس، للقراءة.
  // عدد المراحل التي **تُبلَغ من حالة** يُعدّ من الخريطة نفسها (ستٌّ اليوم؛ السابعة «قُدّم» محطّة في الخطّ لا مرحلة تُبلَغ من حالة).
  const stagesReached=new Set(c.status_map.map(m=>m.stage)).size;
  const statusMap=tab(6,'خريطة الحالات',`${c.status_map.length} حالات ← ${stagesReached} مراحل تُبلَغ من حالة (والقاموس سبع، السابعة محطّة «قُدّم» في الخطّ)`,
    ui.table({head:['حالة الطلب','كلمتها','مرحلة الطالب','كلمتها'],rows:c.status_map.map(m=>`<tr><td><bdi dir="ltr" translate="no">${e(m.status)}</bdi></td><td>${e(m.status_name)}</td><td><bdi dir="ltr">${e(m.stage)}</bdi></td><td>${e(m.stage_name)}</td></tr>`)})
    +'<p class="subtle">الخريطة للقراءة: كل شاشة تقرا عبارات الحالات من مصدر واحد، فما تتعدّل من هنا.</p>');
  // 7 أوزان الترتيب — بنصّها وصفراها.
  const ranking=tab(7,'أوزان الترتيب',`${c.ranking.weights.length} إشارات · ${c.ranking.weights.filter(w=>w.weight===0).length} بوزن صفر`,
    `<p class="subtle">${e(c.ranking.note)}</p>`+ui.table({head:['الإشارة','الوزن','لماذا'],rows:c.ranking.weights.map(w=>`<tr><td>${e(w.name)} <bdi dir="ltr" class="subtle">${e(w.key)}</bdi></td><td>${e(w.weight)}</td><td>${e(w.zero_reason??'')}</td></tr>`)}));
  // 8 و9 مؤجَّلان بسببهما.
  const publish=tab(8,'المعاينة والنشر','مؤجَّل',`<p class="vn-alert">${e(c.publish.why)}</p><p>${e(c.publish.preview.how)} <a class="btn outline small" href="${e(c.publish.preview.link)}">افتح مركز الخدمات ←</a></p>`);
  const io=tab(9,'الاستيراد/التصدير','مؤجَّل',`<p class="vn-alert">${e(c.import_export.why)}</p>`);
  const naming=`<h3>التسمية</h3><p class="subtle">${e(c.naming.decision)}</p><p class="subtle">${e(`أُعيدت تسمية ${c.naming.renames} رمزًا (اسمها القديم مرادفٌ يُبحث به)، و${c.naming.fixed} أسماء مثبَّتة لا تُمسّ: ${c.naming.fixed_codes.join('، ')}.`)}</p>`;
  return `<section class="vn-block"><h2>مركز الخدمات — الشجرة</h2><p class="subtle">${e(c.note)}</p>${categories}${journeys}${synonyms}${pins}${cardFields}${statusMap}${ranking}${publish}${io}${naming}</section>`;
}
function catalogTreeForm(action,id,data){
  const c=data.catalog;
  if(action==='add_synonym'||action==='add_synonym_for_miss'){
    guard(c?.can_manage);
    const items=c.synonyms.items.map(x=>({value:`${x.kind}|${x.key}`,label:`${x.key} — ${x.name}${x.confidential?' (سرّية: فعل شخصين)':''}`}));
    const chosen=action==='add_synonym'?items.find(o=>o.value===String(id)):null;guard(action==='add_synonym_for_miss'||chosen);
    return {title:chosen?`مرادف لـ«${chosen.label}»`:`مرادف للسؤال «${id}»`,endpoint:'/catalog/synonyms',fields:[
      field('item','البند','select',{options:chosen?[chosen]:items,value:chosen?.value??'',hint:'المرادف يُربط ببندٍ واحد؛ ولخدمة سرّية يُقترح ثم يؤكّده حامل تصريح آخر.'}),
      field('term','المرادف','text',{value:action==='add_synonym_for_miss'?String(id):'',hint:'الكلمة كما يكتبها الناس، من حرفين إلى ستين. الصورة المطبَّعة هي ما يُطابَق عليه، وحرفٌ واحد يطابق كل شيء فيُرفض.'}),
      field('note','ملاحظة','text',{required:false,hint:'اختيارية: من أين جاءت الكلمة. تُكتب في حدث التدقيق.'})
    ],toPayload:v=>{const [item_kind,item_key]=String(v.item).split('|');return {item_kind,item_key,term:v.term,note:v.note||''};}};
  }
  if(action==='remove_synonym'||action==='confirm_synonym'){
    guard(c?.can_manage);
    const [kind,key,normalized]=String(id).split('|');
    const item=c.synonyms.items.find(x=>x.kind===kind&&x.key===key),row=item?.rows.find(r=>r.normalized===normalized);guard(item&&row);
    if(action==='confirm_synonym')return {title:`تأكيد «${row.term}» لـ${item.key}`,endpoint:'/catalog/synonyms/confirm',fields:[
      field('note','سند التأكيد','text',{required:false,hint:'لا يؤكّد المقترِح مرادفه: يدخل البحث بعد تأكيد شخصٍ ثانٍ، ويُكتب الحدث باسمه.'})
    ],toPayload:v=>({item_kind:kind,item_key:key,normalized,note:v.note||''})};
    return {title:`حذف «${row.term}» من ${item.key}`,endpoint:'/catalog/synonyms',method:'DELETE',fields:[
      field('note','سبب الحذف','text',{required:false,hint:'الصف يُمحى وحدث التدقيق يبقى بسببه؛ صفوف الكود لا تُحذف من هنا.'})
    ],toPayload:v=>({item_kind:kind,item_key:key,normalized,note:v.note||''})};
  }
  return null;
}
export const approvalSettingsUI={
  title:'إعداد الاعتماد',
  description:'حدود الاعتماد بالمبالغ، والمعتمد البديل لكل دور، والمسارات المقترحة من تدقيق سير العمل، وفحص يكشف ما لا يعمل في الكتالوج.',
  // لوحتان في شاشة واحدة: إعداد الاعتماد، ومعه «مهل محرك العمل وما يتوقف عليها» (الموجة 2) — قسم هنا لا بند جديد في القائمة.
  // ومعهما لوح شجرة مركز الخدمات (الدفعة الرابعة) لحامل «إعداد الخدمات»؛ لغيره يصل can_manage=false فلا يُرسم شيء.
  load:async api=>({...await api('/approval-settings'),workflow:await api('/workflow-control'),catalog:await api('/catalog/admin')}),
  render(data,{e,button,ui}){
    // مدير الإدارة يقرأ إدارته وحدها: الخادم لا يرسل إليه الحدود ولا البدلاء ولا مقترحات المسارات،
    // فالشاشة لا ترسم كتلًا فارغة تُقرأ «لا شيء هنا» وهي في الحقيقة «ليست لك» (إعادة القياس، العطب 5).
    const wide=data.scope!=='department';
    const keys=data.keys.length?`<ul class="vn-list">${data.keys.map(k=>`<li><strong><bdi>${e(k.key)}</bdi></strong><span>${k.effective_minor===null?'<span class="badge rejected">غير معرّف: الخطوة تُطلب احتياطًا</span>':`${e(riyals(k.effective_minor))} · ساري من ${e(k.effective_from)}`}</span><small>الخدمات: ${e(k.services.join('، '))}</small></li>`).join('')}</ul>`:'<p class="subtle">ما فيه خدمة تشترط حدًّا للحين.</p>';
    const rows=data.thresholds.length?`<ul class="vn-list">${data.thresholds.map(t=>`<li><strong><bdi>${e(t.setting_key)}</bdi> — ${e(riyals(t.amount_minor))}</strong><span><span class="badge ${t.status==='approved'?'approved':t.status==='rejected'?'rejected':'pending'}">${e(STATUS[t.status])}</span>${t.effective?' · الساري الآن':''} · من ${e(t.effective_from)}</span><small>${t.status==='proposed'?`أدخله ${e(t.proposed_by_name)}، ويعتمده غيره — `:''}السند: ${e(t.basis)}</small>${t.actions.includes('decide_threshold')?`<div class="operation-actions">${button('decide_threshold',t.id,'اعتماد أو رفض')}</div>`:''}</li>`).join('')}</ul>`:'<p class="subtle">ما فيه حدود مسجّلة.</p>';
    const fallbacks=data.fallbacks.length?`<ul class="vn-list">${data.fallbacks.map(x=>`<li><strong>${e(x.department_name)} · ${e(ROLES[x.step_role]??x.step_role)}</strong><span>البديل: ${e(x.fallback_name)}</span>${x.note?`<small>السند: ${e(x.note)}</small>`:''}</li>`).join('')}</ul>`:'<p class="subtle">ما فيه بديل معيّن؛ لما يكون المعتمد هو صاحب الطلب ينحال لمرجع تصعيد الإدارة.</p>';
    // المسار قبل المقترح وبعده، وسببه، وما سيكسره إن تُبنّي — كله قبل الزر لا بعده.
    const chain=p=>p.chain_before&&p.chain_after?`<small class="proposal-chain"><span>الآن: ${e([...p.chain_before,'تنفيذ'].join(' ← '))}</span><span>بعد التبني: ${e([...p.chain_after,'تنفيذ'].join(' ← '))}</span></small>`:'';
    const warn=p=>(p.warnings??[]).map(w=>`<small class="proposal-warning"><span class="badge ${w.resolved?'pending':'rejected'}">${w.resolved?'أثر مغطّى':'تحذير قبل التبني'}</span> ${e(w.message)}</small>`).join('');
    const proposals=`<ul class="vn-list">${data.proposals.map(p=>`<li><strong>${e(p.item)} · <bdi>${e(p.code)}</bdi> — ${e(p.service)}</strong><span>${p.adopted?'<span class="badge approved">متبنى</span>':'<span class="badge">مقترح غير مطبق</span>'}</span><small>${e(p.reason)}${p.basis?` — السند: ${e(p.basis)}`:''}</small>${chain(p)}${warn(p)}${p.actions.length?`<div class="operation-actions">${button(p.actions[0],p.key,p.adopted?'رجوع عن المقترح':'تبنّي المقترح')}</div>`:''}</li>`).join('')}</ul>`;
    const blocked=data.proposals.filter(p=>(p.warnings??[]).some(w=>w.kind==='sod_no_executor'&&!w.resolved));
    // اللافتة جملةٌ تحذّر، فتُرسم تنبيهًا بدرجته (.vn-alert) لا شارةً مدّت إلى سطرين.
    const sodBanner=blocked.length?`<p class="vn-alert is-block">تبنّي فصل المهام اليوم يترك ${e(blocked.length)} خدمة بلا منفذ: ${e(blocked.map(p=>p.code).join('، '))}. سمِّ نائبًا منفّذًا لكل منها قبل التبني.</p>`:'';
    const sla=data.target_proposals.length?`<ul class="vn-list">${data.target_proposals.map(t=>`<li><strong><bdi>${e(t.code)}</bdi> — ${e(t.service)}</strong><span>${t.decision==='adopted'?`<span class="badge approved">متبنى: ${e(t.proposed_hours)} ساعة عمل</span>`:t.decision==='rejected'?'<span class="badge rejected">مرفوض</span>':'<span class="badge">مقترح غير مطبق</span>'}</span><small>الآن: ${t.current_hours?`${e(t.current_hours)} ساعة عمل`:`${e(t.current_days??'—')} يوم عمل`} · المقترح: ${e(t.proposed_hours)} ساعة عمل داخل نافذة الدوام</small><small>${e(t.reason)}${t.basis?` — السند: ${e(t.basis)}`:''}</small>${t.actions.length?`<div class="operation-actions">${button(t.actions[0],t.key,t.decision==='adopted'?'رجوع عن الزمن':'تبنّي أو رفض الزمن')}</div>`:''}</li>`).join('')}</ul>`:'<p class="subtle">ما فيه مقترح زمن.</p>';
    // الصف الموقوف يبقى ويُعلَّم بسببه، ولا يُطرح صامتًا: هذه أبواب حوكمةٍ لعملٍ ما زال يتحرك، لا عروضُ خدمة.
    const stopped=x=>x?.hidden?`<small class="proposal-warning"><span class="badge rejected">موقوفة من الإعدادات</span> ${e(x.hidden_reason??'')} — طلباتها المفتوحة تكمل مسارها، فقرارها هنا ما زال يلزم.</small>`:'';
    const review=data.targets_for_review.length?`<details><summary>${e(data.targets_for_review.length)} خدمة زمنها مشتق من عائلة رمزها، لم يعتمده مالكها بعد</summary><ul class="vn-list">${data.targets_for_review.map(t=>`<li><strong><bdi>${e(t.code)}</bdi> — ${e(t.service)}</strong><span>${e(t.target.label)}</span>${stopped(t)}</li>`).join('')}</ul></details>`:'';
    // ── شاشة مدير الإدارة الواحدة: أزمنة خدماتي ─────────────────────────────────
    // كل خدمة في إدارتي بزمنها وحاله وفعلِه. الرقم يظهر بمصدره لا عاريًا، فما لم يتبنَّه إنسان يُقرأ «مشتق» لا «سبعة أيام».
    // التبني قرار: سندٌ مكتوب، ومن سجّل الرقم في الدليل لا يتبنّاه — والصف الذي لا فعل فيه يقول لماذا بدل أن يبدو معطلًا.
    const declined=t=>t.target.declined?`<small>قال مدير الإدارة إن هذا الزمن ليس التزامها${t.target.declined.by?` — ${e(t.target.declined.by)}`:''}${t.target.declined.on?` · ${e(t.target.declined.on)}`:''}${t.target.declined.basis?`: ${e(t.target.declined.basis)}`:''}</small>`:'';
    const mine=data.my_department?`<section class="vn-block"><h2>أزمنة خدمات ${e(data.my_department.name)}</h2>
      <p class="subtle">الزمن المشتق من عائلة رمز الخدمة ما تبنّاه أحد، فما يظهر للموظف وعدًا. تبنّيه قرار ينكتب سنده وينسب لك، ويظهر اسمك بجنب الزمن في بطاقة الخدمة وشاشة الطلب.</p>
      ${data.my_service_targets.length?`<ul class="vn-list">${data.my_service_targets.map(t=>`<li><strong><bdi>${e(t.code)}</bdi> — ${e(t.service)}</strong><span><span class="badge ${e(TARGET_BADGE[t.target.kind]??'')}">${e(t.target.kind_name)}</span> ${e(t.target.label)}</span>${declined(t)}${stopped(t)}${t.blocked_why?`<small>${e(t.blocked_why)}</small>`:''}${t.actions.length?`<div class="operation-actions">${button(t.actions[0],t.code,t.target.adopted?'رجوع عن التبني':'تبنّي الزمن')}</div>`:''}</li>`).join('')}</ul>`:'<p class="subtle">ما فيه خدمة من إدارتك في دليل الخدمات للحين.</p>'}</section>`:'';
    // التسمية فعل شخصين: «مقترح» لا ينفّذ حتى يقبله ثانٍ، و«مسحوب» يبقى معروضًا فلا يُظن أنه لم يكن.
    const deputies=data.deputies.length?`<ul class="vn-list">${data.deputies.map(d=>`<li><strong><bdi>${e(d.service_code)}</bdi> — ${e(d.service)}</strong><span>الرتبة ${e(d.rank)} · ${e(d.deputy_name)} <span class="badge ${DEPUTY_BADGE[d.status]??''}">${e(DEPUTY_STATUS[d.status]??d.status)}</span></span><small>${d.status==='proposed'?`سمّاه ${e(d.proposed_by_name)}، ويقبلها غيره — `:''}السند: ${e(d.basis)}</small>${d.actions.length?`<div class="operation-actions">${d.actions.map(a=>button(a,`${d.service_code}|${d.rank}`,a==='accept_deputy'?'قبول التسمية':'سحب التسمية')).join('')}</div>`:''}</li>`).join('')}</ul>`:'<p class="subtle">ما فيه نائب مسمّى للحين. الخدمة اللي ما يبقى فيها منفّذ غير اللي قرّر توصل مرجع تصعيد إدارتها، والنائب المسمّى يسبقه.</p>';
    const h=data.health,issues=h.issues.length?`<ul class="vn-list">${h.issues.map(i=>`<li><strong><bdi>${e(i.code)}</bdi> — ${e(i.service)}</strong><span><span class="badge ${SEVERITY[i.severity]??''}">${e(i.severity)}</span></span><small>${e(i.message)}</small></li>`).join('')}</ul>`:'<p class="subtle">ما فيه ملاحظات: لكل خدمة منفّذ، وكل خطوة تنحل، وكل حد معرّف، وما فيه خدمة يقرّرها اللي ينفّذها.</p>';
    // ضابطٌ مُطفأ يُقرأ مُطفأً: ما دام العدّ فوق الصفر لا يُقرأ الفحص طمأنينةً، وتُسمّى الحسّاسة منها بأسمائها.
    const decider=h.decider_is_executor,sensitiveCodes=decider.services.filter(c=>h.issues.some(i=>i.code===c&&i.kind==='decider_is_executor'&&i.sensitive));
    const deciderBanner=decider.count?`<p class="vn-alert is-warn">${e(decider.count)} خدمة يعتمدها من يملك تنفيذها: فصل المهام مُطفأ فيها، والجمع مُسجَّل ومعروض لا ممنوع. الحسّاسة منها: ${e(sensitiveCodes.join('، ')||'لا شيء')}.</p>`:'';
    // كل جداول هذه الشاشة من العدّة: رأس كل عمود يُقرن بعموده صراحةً (scope)، وعمود الأفعال بلا عنوان مرئي يُسمّى للقارئ الآلي
    // وحده (محسّن الجوال لا يكتب له تسمية). يسقط هذا السطر حين ترسم العدّة السمتين بنفسها.
    const scoped=html=>html.replace(/<th>/g,'<th scope="col">').replaceAll('<th scope="col"></th>','<th scope="col" aria-label="الإجراء"></th>');
    return scoped(`<section class="panel panel-body vn-head"><p>${e(data.note)}</p>
      <p><span class="badge">${e(h.services_checked)} ${wide?'خدمة مفحوصة':'خدمة في إدارتك مفحوصة'}${h.hidden_checked?`، منها ${e(h.hidden_checked)} موقوفة من الإعدادات`:''}</span> <span class="badge ${h.summary.no_executor?'rejected':''}">بلا منفذ: ${e(h.summary.no_executor)}</span> <span class="badge ${h.summary.step_unresolvable?'rejected':''}">خطوات لا تُحل: ${e(h.summary.step_unresolvable)}</span> <span class="badge ${h.summary.threshold_undefined?'pending':''}">حدود غير معرّفة: ${e(h.summary.threshold_undefined)}</span> <span class="badge ${h.summary.sod_no_executor?'rejected':''}">فصل مهام بلا منفذ ثانٍ: ${e(h.summary.sod_no_executor)}</span> <span class="badge ${decider.count?'rejected':'approved'}">من يقرر ينفّذ: ${e(decider.count)}${decider.sensitive?` (منها ${e(decider.sensitive)} حسّاسة)`:''}</span></p>
      ${deciderBanner}
      ${sodBanner}
      <div class="operation-actions">${data.can_propose?button('propose_threshold','','حد اعتماد جديد'):''}${data.can_assign_fallback?button('set_fallback','','تعيين معتمد بديل'):''}${data.can_assign_fallback?button('set_deputy','','تسمية نائب منفّذ'):''}</div></section>
      <section class="vn-board">${availabilitySection(data.availability,{e,button,ui})}${serviceGatesSection(data.service_gates,{e,button,ui})}
        ${mine}
        ${wide?`<section class="vn-block"><h2>مفاتيح الحدود المستعملة</h2>${keys}</section>
        <section class="vn-block"><h2>سجل الحدود</h2>${rows}</section>
        <section class="vn-block"><h2>المعتمد البديل</h2>${fallbacks}</section>`:''}
        <section class="vn-block"><h2>النائب المنفّذ</h2>${deputies}</section>
        ${workflowSection(data.workflow,{e,button})}
        <section class="vn-block"><h2>${wide?'فحص الكتالوج':'فحص خدمات إدارتك'}</h2>${issues}</section>
        ${wide?`<section class="vn-block"><h2>مسارات مقترحة</h2>${proposals}</section>
        <section class="vn-block"><h2>زمن الخدمة المقترح</h2>${sla}${review}</section>`:''}${catalogTreeSection(data.catalog,{e,button,ui})}
      </section>`);
  },
  form(action,id,data){
    const wave=data.workflow?workflowForm(action,id,data.workflow):null;if(wave)return wave;
    const tree=catalogTreeForm(action,id,data);if(tree)return tree;
    const gate=serviceGatesForm(action,id,data);if(gate)return gate;
    // مفتاح التفعيل: الحالة المطلوبة هي نقيض الحالة السارية، فلا يختار المالك «مفعّلة/موقوفة» من قائمة ثم
    // يُردّ بأنها كذلك أصلًا (القادح no_repeat يرفض صفًّا لا يغيّر شيئًا). السبب سطر واحد إلزامي: قرارٌ بلا
    // سبب مكتوب يصير بعد شهر إيقافًا لا يعرف أحد سببه ولا يجرؤ أحد على الرجوع عنه.
    if(action==='switch_availability'){
      const a=data.availability;guard(a?.can_manage);
      const separator=String(id).indexOf('|'),kind=String(id).slice(0,separator),key=String(id).slice(separator+1);
      const row=(kind==='service'?a.services:a.benefits).find(x=>x.key===key);guard(row);
      const hiding=row.state!=='hidden';
      return {title:`${hiding?'إيقاف':'إعادة تفعيل'} ${kind==='service'?'خدمة':'ميزة'} «${row.name}»`,
        endpoint:'/approval-settings/availability',fields:[
          field('reason','سبب القرار',hiding?'text':'text',{hint:hiding
            ?`تختفي من الدليل ومن نافذة الطلب الجديد ومن بطاقات الخدمة ومن البحث ومن أزرار الرئيسية، ويُرفض فتح طلب جديد منها برفضٍ يحمل هذا السبب ويسمّي من يعيد تفعيلها.${row.open_requests?` و${row.open_requests} طلبًا مفتوحًا عليها تكمل مسارها واعتمادها وتنفيذها كما هي — الإيقاف ليس حذفًا.`:''}${row.warning?` ${row.warning}`:''}`
            :'تعود إلى الدليل وإلى نافذة الطلب والبحث كما كانت. قرار الإيقاف وسببه يبقيان في السجل بعد الرجوع عنه.'})
        ],toPayload:v=>({kind,target_key:key,state:hiding?'hidden':'available',reason:v.reason})};
    }
    if(action==='propose_threshold'){
      guard(data.can_propose);
      return {title:'حد اعتماد جديد',endpoint:'/approval-settings/thresholds',idempotent:true,fields:[
        field('setting_key','مفتاح الحد','text',{hint:'المفتاح الذي تشير إليه خطوة الخدمة، مثل fin.payment.finance_review.',value:data.keys.find(k=>k.effective_minor===null)?.key??''}),
        field('amount','الحد بالريال','text',{hint:'تُضاف الخطوة إذا بلغ مبلغ الطلب هذا الحد أو تجاوزه. يُخزن بالهللات.'}),
        field('effective_from','يسري من','date'),
        field('basis','السند','textarea',{hint:'القرار أو مصفوفة الصلاحيات المعتمدة ورقمها وتاريخها. المنصة لا تقترح رقمًا.'})
      ],toPayload:v=>({setting_key:v.setting_key,amount_minor:riyalsToMinor(v.amount),effective_from:v.effective_from,basis:v.basis})};
    }
    if(action==='decide_threshold'){
      const t=data.thresholds.find(x=>x.id===id);guard(t&&t.actions.includes(action));
      return {title:`قرار الحد — ${t.setting_key}`,endpoint:`/approval-settings/thresholds/${id}/decide`,fields:[
        field('decision','القرار','select',{options:[{value:'approve',label:'اعتماد'},{value:'reject',label:'رفض'}]}),
        field('note','ملاحظة القرار','textarea',{required:false,hint:'إلزامية عند الرفض.'})
      ],toPayload:v=>({version:t.version,decision:v.decision,note:v.note||''})};
    }
    if(action==='set_fallback'){
      guard(data.can_assign_fallback);
      return {title:'تعيين معتمد بديل',endpoint:'/approval-settings/fallbacks',fields:[
        field('department_id','الإدارة','select',{options:data.departments.map(d=>({value:d.id,label:d.name}))}),
        field('step_role','الدور','select',{options:Object.entries(ROLES).map(([value,label])=>({value,label}))}),
        field('fallback_user_id','البديل','select',{options:[{value:'',label:'— إزالة البديل —'},...data.people.map(p=>({value:p.id,label:p.name}))],required:false}),
        field('note','سبب التعيين','textarea')
      ],toPayload:v=>({department_id:v.department_id,step_role:v.step_role,fallback_user_id:v.fallback_user_id||null,note:v.note})};
    }
    if(action==='set_deputy'){
      guard(data.can_assign_fallback);
      // الخدمات المعروضة هي ما فصلُ المهام مفعّل عليها، فمعتمِدها لا ينفّذها ويصح أن يُسمّى لها نائب.
      // الموقوفة تبقى في القائمة معلَّمة: لها طلبات مفتوحة تنتظر منفّذًا، فتسمية نائبها ما زالت قرارًا يلزم.
      const options=data.deputy_services.map(x=>({value:x.code,label:`${x.code} — ${x.service}${x.hidden?' (موقوفة من الإعدادات)':''}`}));
      return {title:'تسمية نائب منفّذ',endpoint:'/approval-settings/deputies',fields:[
        field('service_code','الخدمة','select',{options:[...new Map(options.map(o=>[o.value,o])).values()],hint:'الخدمات التي يمنع فصلُ المهام معتمِدَها من تنفيذها.'}),
        field('rank','الرتبة','select',{options:[1,2,3].map(n=>({value:String(n),label:`الرتبة ${n}`})),hint:'ترتيب اللجوء: يُسأل الأول، فإن منعه فصل المهام في طلب بعينه فالذي يليه.'}),
        field('user_id','النائب','select',{options:data.people.map(x=>({value:x.id,label:x.name})),hint:'من إدارة أخرى في قطاع الإدارة المنفذة نفسه، وبدور ينفّذ هذه الخدمة. ولا يقبل التسمية بنفسه: يقبلها مدير إدارته أو مدير الإدارة المنفذة أو من يدير الهيكل.'}),
        field('basis','السند','textarea',{hint:'من قرر التسمية ومتى ولماذا. يُقرأ في شاشة الطلب حين يصل النائب، ولا ينفّذ حتى يقبل التسمية شخص ثانٍ.'})
      ],toPayload:v=>({service_code:v.service_code,rank:Number(v.rank),user_id:v.user_id,basis:v.basis})};
    }
    if(action==='accept_deputy'||action==='withdraw_deputy'){
      const [code,rank]=String(id).split('|');
      const d=data.deputies.find(x=>x.service_code===code&&String(x.rank)===rank);guard(d&&d.actions.includes(action));
      if(action==='accept_deputy')return {title:`قبول تسمية ${d.deputy_name}`,endpoint:'/approval-settings/deputies/accept',fields:[
        field('note','سند القبول','textarea',{hint:'من قبِل التسمية ومتى. لا يقبلها من سمّى النائب، ولا النائب نفسه: القبول هو ما يمنح حق التنفيذ.'})
      ],toPayload:v=>({service_code:code,rank:Number(rank),note:v.note})};
      return {title:`سحب تسمية ${d.deputy_name}`,endpoint:'/approval-settings/deputies/withdraw',fields:[
        field('basis','سبب السحب','textarea',{hint:'يبقى الصف في السجل مسحوبًا؛ لا يُمحى نائب سُمّي يومًا.'})
      ],toPayload:v=>({service_code:code,rank:Number(rank),basis:v.basis})};
    }
    // تبنّي مدير الإدارة زمنَ خدمته: لا يغيّر الرقم، بل ينقله من «مشتق لم يتبنَّه أحد» إلى التزام له صاحب واسم وتاريخ.
    // و«ليس التزام إدارتي» قرارٌ مسجَّل أيضًا، يبقى ظاهرًا فلا يُعاد عرض الزمن كأن أحدًا لم يحسمه.
    if(action==='adopt_service_target'||action==='withdraw_service_target'){
      const t=data.my_service_targets.find(x=>x.code===id);guard(t&&t.actions.includes(action));
      if(action==='withdraw_service_target')return {title:`رجوع عن تبنّي زمن ${t.code}`,endpoint:`/approval-settings/targets/${t.code}/decide`,fields:[
        field('basis','سبب الرجوع','textarea',{hint:'القرار الأول يبقى في السجل؛ الرجوع قرار ثانٍ مسجَّل لا محوٌ للأول.'})
      ],toPayload:v=>({decision:'withdraw',basis:v.basis})};
      return {title:`زمن ${t.code} — ${t.service}`,endpoint:`/approval-settings/targets/${t.code}/decide`,fields:[
        field('decision','القرار','select',{options:[{value:'adopt',label:`تبنّي ${t.target.amount} التزامًا على إدارتي`},{value:'reject',label:'هذا الزمن ليس التزام إدارتي'}]}),
        field('basis','السند','textarea',{hint:'من قرره ومتى وعلى أي أساس. يُقرأ بجوار الزمن في بطاقة الخدمة وشاشة الطلب، فيعرف الموظف من قطع الوعد.'})
      ],toPayload:v=>({decision:v.decision,basis:v.basis})};
    }
    if(action==='decide_target'||action==='withdraw_target'){
      const t=data.target_proposals.find(x=>x.key===id);guard(t&&t.actions.includes(action));
      if(action==='withdraw_target')return {title:`رجوع عن زمن ${t.code}`,endpoint:`/approval-settings/targets/${id}/decide`,fields:[
        field('basis','السند','textarea',{hint:'الرجوع يعيد الخدمة إلى زمنها بالأيام.'})
      ],toPayload:v=>({decision:'withdraw',basis:v.basis})};
      return {title:`زمن ${t.code} — ${t.service}`,endpoint:`/approval-settings/targets/${id}/decide`,fields:[
        field('decision','القرار','select',{options:[{value:'adopt',label:`تبنّي ${t.proposed_hours} ساعة عمل`},{value:'reject',label:'رفض وإبقاء الزمن بالأيام'}]}),
        field('basis','السند','textarea',{hint:'من قرره ومتى. الساعات تُقاس داخل نافذة الدوام وأيام العمل نفسها.'})
      ],toPayload:v=>({decision:v.decision,basis:v.basis})};
    }
    const p=data.proposals.find(x=>x.key===id);guard(p&&p.actions.includes(action));
    return {title:`${action==='withdraw_proposal'?'رجوع عن':'تبنّي'} ${p.code}`,endpoint:`/approval-settings/proposals/${id}/adopt`,fields:[
      field('basis','السند','textarea',{hint:'من قرره ومتى. التبني ينشئ نسخة جديدة من الخدمة ولا يمس الطلبات المقدمة.'})
    ],toPayload:v=>({basis:v.basis,...(action==='withdraw_proposal'?{withdraw:true}:{})})};
  }
};
