// حزم التعيين والمغادرة، وإخلاء الطرف المشتق مما تعرفه المنصة فعلًا عن الشخص.
// الشاشتان تقولان مضمونهما بلهجة المنصة: الحزمة وخطواتها وأصحابها ومواعيدها، وما يوقف التسوية. وحدود الوحدة يقولها الخادم في data.note.
// بلاطتا الرقم المحليتان باقيتان بحرفهما (ترحيل منسَّق: tests/kit.test.mjs يعدّ نسخهما)، والحالة الفارغة من العدّة (ui)،
// والاختبار الذي يرسم الشاشة بلا ui يأخذ العدّة نفسها افتراضًا (kit(e)).
import { dual } from './dates.mjs';
import { kit } from './kit.mjs';
import { roleName } from './vocabulary.mjs';
import { countNoun } from './arabic-count.mjs';

const field=(name,label,type='text',extra={})=>({name,label,type,...extra});
// نص الحارس مثبَّت في tests/lifecycle-bundles.test.mjs (/غير متاح/)، فبقي بحرفه.
const guard=ok=>{if(!ok)throw Error('الإجراء غير متاح. أعد تحميل الصفحة.');};
const stepStatus={open:'مفتوحة',done:'مغلقة بدليلها',cancelled:'ملغاة'};
const bundleStatus={open:'مفتوحة',closed:'مغلقة',cancelled:'ملغاة'};
const stepLabels={close_step:'إغلاق بدليل',cancel_step:'إلغاء الخطوة',decide_late_step:'قرار في التأخر'};
const bundleLabels={close_bundle:'إغلاق الحزمة',cancel_bundle:'إلغاء الحزمة',refresh_clearance:'تحديث قائمة الإخلاء'};
const sourceNames={custody:'عهدة نقدية',fixed_asset:'أصل ثابت',equipment:'معدة',access_grant:'صلاحية',account:'حساب',advance:'سلفة',request:'طلب',request_task:'مهمة طلب',project_task:'مهمة مشروع',approval_step:'اعتماد معلّق',delegation:'تفويض',project:'مشروع'};
const STEPS=['خطوة واحدة','خطوتين','خطوات','خطوة'];

// التاريخ بنصه المعتاد (ميلادي · هجري) وقيمته الآلية في datetime؛ والعدد بأرقام مجدولة، ومع اسمه بصيغته الصحيحة.
const when=(e,iso)=>iso?`<time datetime="${e(String(iso).slice(0,10))}">${e(dual(iso))}</time>`:'—';
const num=(e,n)=>`<span data-num>${e(n)}</span>`;
const counted=(e,n,forms)=>e(countNoun(n,forms)).replace(/^-?\d[\d,.]*/,m=>num(e,m));

// اللون يرافقه دائمًا اسم الحالة في السطر نفسه: «مغلقة بدليلها»، «ملغاة»، «متأخرة»، «معلّقة».
const tone=s=>s.status==='done'?'is-ok':s.status==='cancelled'?'is-old':s.late?'is-late':s.blocked?'is-due':'';
const stepRow=(s,e,button)=>`<li class="${tone(s)}"><strong>${e(s.title)}</strong>
  <span>${e(stepStatus[s.status]??s.status)} · المالك ${e(s.owner_name??'—')} · المدة ${counted(e,s.target_days,'working_day')} · الموعد ${when(e,s.due_date)}${s.late?' · متأخرة':''}</span>
  ${s.blocked?`<small>معلّقة على خطوة قبلها: ${e(s.blocked_reason)}</small>`:''}
  <small>معيار القبول: ${e(s.acceptance)}</small>
  ${s.evidence?`<small>الدليل: ${e(s.evidence)} — ${e(s.closed_by_name??'')}</small>`:''}
  ${s.escalations.length?`<div class="timeline">${s.escalations.map(x=>`<div class="timeline-item"><strong>تصعيد لمالك الحزمة</strong><small>${e(x.decided_by_name??'')} · ${when(e,x.created_at)}: ${e(x.note)}</small></div>`).join('')}</div>`:''}
  ${s.actions.length?`<div class="operation-actions">${s.actions.map(a=>button(a,s.id,stepLabels[a])).join('')}</div>`:''}</li>`;

// البند المالي المفتوح يوقف التسوية (أحمر وبكلمته)، وغير المالي المفتوح ينتظر (أصفر)، والمغلق صامت بكلمته.
const itemRow=(i,e,button,money)=>`<li class="${i.status==='cleared'?'is-ok':i.financial?'is-late':'is-due'}">
  <strong>${e(i.title)}</strong>
  <span>${e(sourceNames[i.source]??i.source)} · ${i.financial?`${i.status==='cleared'?'مالي':'مالي يوقف التسوية'} · <span class="ltr">${e(money(i.amount_minor))}</span>`:'غير مالي'} · ${i.status==='cleared'?'مغلق بدليله':'مفتوح'}</span>
  ${i.detail?`<small>${e(i.detail)}</small>`:''}
  ${i.action_owner?`<small>من ينفّذ: ${e(i.action_owner)}</small>`:''}
  ${i.status==='cleared'?`<small>الدليل: ${e(i.evidence)} — قفله ${e(i.cleared_by_name??'')} ${when(e,i.cleared_at)}</small>`:''}
  ${i.actions.length?`<div class="operation-actions">${i.actions.map(a=>button(a,i.id,'إغلاق البند بدليل')).join('')}</div>`:''}</li>`;

// رأس الحزمة: h3 داخل قسم نوعها في «حزم التعيين والمغادرة»، وh2 حين تكون الحزمة نفسها قسم الشاشة في «إخلاء الطرف».
const bundleHead=(b,e,level)=>`<div class="panel-head"><h${level}>${e(b.kind_name)} — ${e(b.employee_name??'')}</h${level}><span class="badge">${e(bundleStatus[b.status]??b.status)}</span></div>`;
const bundleMeta=(b,e)=>`<p class="subtle">مالك الحزمة ${e(b.owner_name??'')} · التاريخ المعتمد ${when(e,b.effective_date)} · سنده: ${e(b.date_basis)}</p>
  <p class="subtle">اكتمل ${num(e,b.progress.done)} من ${counted(e,b.progress.total,STEPS)} بدليلها (${num(e,b.progress.percent)}٪)${b.progress.late?` · متأخرة: ${num(e,b.progress.late)}`:''}${b.progress.blocked?` · معلّقة على خطوة قبلها: ${num(e,b.progress.blocked)}`:''}</p>
  ${b.close_note?`<p class="subtle">${e(b.close_note)}</p>`:''}`;
const actionsOf=(list)=>list.filter(Boolean).length?`<div class="operation-actions">${list.join('')}</div>`:'';

export const lifecycleUI={
  title:'حزم التعيين والمغادرة',
  description:'لكل موظف يبدأ أو يغادر حزمة خطوات على الإدارات، لكل خطوة مالك وموعد ومعيار قبول. الخطوة ما تنقفل إلا بدليل، واللي تتأخر تنرفع لمالك الحزمة.',
  load:api=>api('/lifecycle'),
  render(data,{e,button}){
    const tile=(value,label,t='')=>`<div class="vn-tile ${t}"><strong>${e(value)}</strong><span>${e(label)}</span></div>`;
    const head=`<section class="panel panel-body vn-head"><p>${e(data.note)}</p>
      ${data.can_manage?'':'<p class="subtle">تشوف هنا الحزم اللي تملكها أو لك فيها خطوة. فتح الحزم وقفلها لصاحب تصريح التوظيف والتهيئة.</p>'}
      ${data.totals.templates?'':'<p class="vn-alert">القالب ما فيه خطوات للحين، فما تنفتح حزمة لين يضيف مالك إجراء كل إدارة خطواته تحت.</p>'}</section>`;
    // اللون للحالة القائمة وحدها: صفر متأخرات بلا لون، وعدد خطوات القالب رقم مرجعي بلا لون.
    const tiles=`<div class="vn-tiles">${tile(data.totals.open,'حزم مفتوحة')}${tile(data.totals.late,'خطوات متأخرة',data.totals.late?'is-late':'')}${tile(data.totals.templates,'خطوات في القالب')}</div>`;

    const bundle=b=>`<section class="vn-block">${bundleHead(b,e,3)}${bundleMeta(b,e)}
      ${actionsOf(b.actions.map(a=>button(a,b.id,bundleLabels[a])))}
      ${b.steps.length?`<ul class="vn-list">${b.steps.map(s=>stepRow(s,e,button)).join('')}</ul>`:'<p class="subtle">هالحزمة ما فيها خطوات.</p>'}
      ${b.kind==='offboarding'?`<p class="subtle">المفتوح من بنود إخلاء الطرف: ${num(e,b.clearance.filter(i=>i.status==='open').length)}، منها مالية: ${num(e,b.progress.open_financial)} — تفاصيلها في <a href="#clearance">إخلاء الطرف</a>.</p>`:''}</section>`;

    // خطوة القالب المفعّلة هي الحال العادي فلا لون لها؛ المعطّلة باهتة وبكلمتها. ومن عرّف الخطوة في سجل التدقيق لا على الشاشة.
    const template=t=>`<li class="${t.active?'':'is-old'}"><strong>${e(t.title)}</strong>
      <span>${e(t.department_name)} · مالكها بدور ${e(roleName(t.owner_role))} · ${counted(e,t.target_days,'working_day')}${t.active?'':' · معطّلة'}</span>
      ${t.depends_on_title?`<small>تبدأ بعد: ${e(t.depends_on_title)}</small>`:''}
      <small>معيار القبول: ${e(t.acceptance)}</small><small>سندها: ${e(t.basis)}</small>
      ${t.actions.length?`<div class="operation-actions">${t.actions.map(a=>button(a,t.id,'تعديل الخطوة')).join('')}</div>`:''}</li>`;

    // الحزم الجارية أولًا لأنها الشغل، ثم خطوات القالب لأنها إعدادها.
    const kindBlock=k=>{
      const rows=data.templates.filter(t=>t.kind===k.key),bundles=data.bundles.filter(b=>b.kind===k.key);
      return `<section class="vn-block"><div class="panel-head"><h2>${e(k.name)}</h2></div>
        ${actionsOf([data.can_manage&&rows.some(t=>t.active)?button('open_bundle',k.key,'فتح حزمة'):'',data.can_define?button('add_template',k.key,'إضافة خطوة للقالب'):''])}
        ${bundles.map(bundle).join('')||`<p class="subtle">${data.can_manage?'للحين ما انفتحت حزمة من هذا النوع — تطلع هنا أول ما تنفتح.':'للحين ما فيه حزمة من هذا النوع لك فيها خطوة — تطلع هنا أول ما تنسند لك خطوة.'}</p>`}
        <h3>خطوات القالب${rows.length?` (${num(e,rows.length)})`:''}</h3>
        ${rows.length?`<ul class="vn-list">${rows.map(template).join('')}</ul>`:'<p class="subtle">القالب فاضي للحين — يعبّيه مالك إجراء كل إدارة بخطواته وسندها.</p>'}</section>`;
    };
    return `${head}<section class="vn-board">${tiles}${data.kinds.map(kindBlock).join('')}</section>`;
  },
  form(action,id,data){
    if(action==='add_template'||action==='edit_template'){
      const existing=action==='edit_template'?data.templates.find(t=>t.id===id):null;
      guard(action==='add_template'?data.can_define:existing&&existing.actions.includes('edit_template'));
      const kind=existing?existing.kind:id;
      const parents=data.templates.filter(t=>t.kind===kind&&t.id!==id);
      const fields=[
        ...(existing?[]:[field('code','رمز الخطوة داخل هذا النوع','text',{maxLength:40,hint:'رمز قصير ثابت مثل IT-LAPTOP، وما يتغير بعد الحفظ.'})]),
        field('title','عنوان الخطوة','text',{maxLength:180,value:existing?.title??''}),
        field('department_id','الإدارة المسؤولة','select',{options:data.departments.map(d=>({value:d.id,label:d.name})),value:existing?.department_id??''}),
        field('owner_role','دور مالك الخطوة في تلك الإدارة','select',{options:data.owner_roles.map(r=>({value:r,label:roleName(r)})),value:existing?.owner_role??''}),
        field('target_days','المدة المستهدفة بأيام العمل من فتح الحزمة','number',{min:0,max:120,value:existing?String(existing.target_days):'',hint:'اكتب المدة اللي قررتها إدارتك.'}),
        field('acceptance','معيار قبول الخطوة','textarea',{value:existing?.acceptance??'',hint:'وش اللي يثبت إنها خلصت فعلًا؟ اكتب الدليل المتوقع، مو النية.'}),
        field('depends_on','لا تبدأ قبل هذه الخطوة (اختياري)','select',{required:false,value:existing?.depends_on??'',options:[{value:'',label:'بلا اعتمادية'},...parents.map(t=>({value:t.id,label:t.title}))],hint:'مثال: بطاقة الدخول ما تنسلّم قبل توقيع العقد. والاعتمادية اللي تدور على نفسها تنرفض عند الحفظ.'}),
        field('basis','سند الخطوة: من قررها ومتى','textarea',{value:existing?.basis??''}),
        ...(existing?[field('active','الخطوة مفعّلة في الحزم الجديدة','select',{options:[{value:'yes',label:'مفعّلة'},{value:'no',label:'معطّلة'}],value:existing.active?'yes':'no'})]:[])
      ];
      return {title:existing?`تعديل خطوة — ${existing.title}`:'إضافة خطوة للقالب',
        endpoint:existing?`/lifecycle/templates/${id}`:'/lifecycle/templates',idempotent:!existing,fields,
        toPayload:v=>({...(existing?{version:existing.version,active:v.active==='yes'}:{kind,code:v.code}),
          title:v.title,department_id:v.department_id,owner_role:v.owner_role,target_days:Number(v.target_days),
          acceptance:v.acceptance,depends_on:v.depends_on||null,basis:v.basis})};
    }
    if(action==='open_bundle'){
      guard(data.can_manage&&data.templates.some(t=>t.kind===id&&t.active));
      const kindLabel=data.kinds.find(k=>k.key===id)?.name??id;
      return {title:`فتح حزمة — ${kindLabel}`,endpoint:'/lifecycle/bundles',idempotent:true,
        fields:[
          field('employee_id','الموظف','select',{options:data.employees.map(x=>({value:x.id,label:x.name}))}),
          field('owner_id','مالك الحزمة (تنرفع له الخطوة المتأخرة)','select',{options:data.employees.map(x=>({value:x.id,label:x.name}))}),
          field('effective_date',id==='onboarding'?'تاريخ المباشرة':'آخر يوم عمل','date',{hint:'التاريخ من القرار أو الخطاب، وسنده تكتبه تحت.'}),
          field('date_basis','سند التاريخ: القرار أو الخطاب ومن أكده ومتى','textarea')
        ],
        toPayload:v=>({kind:id,employee_id:v.employee_id,owner_id:v.owner_id,effective_date:v.effective_date,date_basis:v.date_basis})};
    }
    const steps=data.bundles.flatMap(b=>b.steps),step=steps.find(s=>s.id===id);
    if(step&&stepLabels[action]){
      guard(step.actions.includes(action));
      if(action==='decide_late_step'){
        return {title:`قرار في تأخر — ${step.title}`,endpoint:`/lifecycle/steps/${id}/decide_late_step`,idempotent:false,
          fields:[
            field('note','قرارك وسببه','textarea',{hint:'الخطوة عدّت مدتها. اكتب وش قررت: تمديد، أو نقلها لمالك ثاني، أو تبقى على حالها وليش.'}),
            field('new_due_date','موعد جديد (اختياري)','date',{required:false}),
            field('new_owner_id','مالك بديل من الإدارة نفسها بالدور نفسه (اختياري)','text',{required:false,maxLength:100,hint:`معرّف حساب نشط في إدارة الخطوة (${step.department_id}). خلّه فاضي إذا المالك بيبقى نفسه.`})
          ],
          toPayload:v=>({version:step.version,note:v.note,new_due_date:v.new_due_date||null,new_owner_id:v.new_owner_id||null})};
      }
      return {title:`${stepLabels[action]} — ${step.title}`,endpoint:`/lifecycle/steps/${id}/${action}`,idempotent:false,
        fields:[field('evidence',action==='close_step'?'دليل الإنجاز ومطابقته لمعيار القبول':'سبب الإلغاء','textarea',{hint:action==='close_step'?`معيار القبول: ${step.acceptance}`:'الخطوة الملغاة تبقى ظاهرة بسببها وما تنحذف.'})],
        toPayload:v=>({version:step.version,evidence:v.evidence})};
    }
    const bundle=data.bundles.find(b=>b.id===id);
    guard(bundle&&bundle.actions.includes(action));
    if(action==='refresh_clearance')return {title:'تحديث قائمة الإخلاء',endpoint:`/lifecycle/bundles/${id}/refresh_clearance`,idempotent:false,fields:[],
      toPayload:()=>({version:bundle.version})};
    return {title:`${bundleLabels[action]} — ${bundle.employee_name??''}`,endpoint:`/lifecycle/bundles/${id}/${action}`,idempotent:false,
      fields:[field('note',action==='close_bundle'?'دليل إغلاق الحزمة':'سبب الإلغاء','textarea')],
      toPayload:v=>({version:bundle.version,note:v.note})};
  }
};

export const clearanceUI={
  title:'إخلاء الطرف',
  description:'قائمة الإخلاء تنبني من اللي باسم الشخص فعلًا: عهده وأصوله ومعداته وصلاحياته وحسابه وسلفه وطلباته ومهامه واعتماداته وتفويضاته ومشاريعه. كل بند ينقفل بدليل من شخص غير المغادر، والبنود المالية توقف التسوية النهائية لين تنقفل.',
  load:api=>api('/clearance'),
  render(data,{e,button,money,ui=kit(e)}){
    const tile=(value,label,t='')=>`<div class="vn-tile ${t}"><strong>${e(value)}</strong><span>${e(label)}</span></div>`;
    const head=`<section class="panel panel-body vn-head"><p>${e(data.note)}</p>
      ${data.can_manage?'':'<p class="subtle">تشوف هنا حزم المغادرة اللي تملكها أو لك فيها خطوة. قفل البنود لمالك الحزمة أو لصاحب تصريح التوظيف والتهيئة.</p>'}</section>`;
    const tiles=`<div class="vn-tiles">${tile(data.totals.open_bundles,'حزم مغادرة مفتوحة')}${tile(data.totals.open_items,'بنود مفتوحة',data.totals.open_items?'is-due':'')}${tile(data.totals.open_financial,'بنود مالية توقف التسوية',data.totals.open_financial?'is-late':'')}</div>`;
    const bundle=b=>`<section class="vn-block">${bundleHead(b,e,2)}${bundleMeta(b,e)}
      ${b.progress.open_financial?`<p class="vn-alert is-block">البنود المالية المفتوحة: ${num(e,b.progress.open_financial)} — التسوية النهائية ما تنعتمد لين تنقفل كلها بدليلها.</p>`:''}
      ${b.clearance.length?`<ul class="vn-list">${b.clearance.map(i=>itemRow(i,e,button,money)).join('')}</ul>`:'<p class="subtle">هالشخص ما عليه شي مفتوح: لا عهدة ولا أصل ولا صلاحية ولا التزام باسمه.</p>'}</section>`;
    // القائمة هي جواب الشاشة: بلا حزم تُقال الحالة بجملة وخطوتها. ومصادر القائمة مرجعٌ آخر الشاشة لا أولها.
    const none=ui.empty('ما فيه حزم مغادرة للحين',data.can_manage?'تنفتح حزمة المغادرة من «حزم التعيين والمغادرة»، وتنبني قائمة إخلائها هنا.':'تطلع هنا حزم المغادرة اللي تملكها أو لك فيها خطوة.');
    const sources=`<p class="subtle measure">تنبني القائمة لحظيًا من: ${e(data.sources.map(s=>s.name).join('، '))}.</p>`;
    return `${head}<section class="vn-board">${tiles}${data.bundles.map(bundle).join('')||none}${sources}</section>`;
  },
  form(action,id,data){
    const item=data.bundles.flatMap(b=>b.clearance).find(i=>i.id===id);
    guard(item&&item.actions.includes(action));
    return {title:`إغلاق بند — ${item.title}`,endpoint:`/clearance/items/${id}`,idempotent:false,
      fields:[field('evidence','دليل إغلاق البند: المستند ومن نفّذ ومتى','textarea',{hint:`${item.action_owner?`من ينفّذ: ${item.action_owner}. `:''}اكتب وش صار فعلًا.`})],
      toPayload:v=>({version:item.version,evidence:v.evidence})};
  }
};
