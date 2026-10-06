// الخيارات والقيم المعتمدة (app/options.mjs): القوائم اللي تختار منها النماذج، والقيم اللي تحكم سلوك المنصة.
// كل تغيير بسبب مصنّف وتاريخ، والقيمة ما تسري إلا إذا اعتمدها شخص ثاني. الأزرار تظهر لمن يحمل التصريح، والخادم هو اللي يقرر.
// الترتيب مقصود: ما ينتظر اعتمادك أولًا، ثم ما ما انقرر بعد (والمنصة واقفة عنده)، ثم المعتمد، ثم المثبّت نظامًا.
// البلاطة والجدول والبطاقة من العدّة المشتركة (ctx.ui)؛ ومن يرسم الشاشة بلا صفحة (اختبار) يأخذ العدّة نفسها.
import { kit } from './kit.mjs';
const FIELDS={days:['عدد الأيام','number','عدد صحيح من 0 لين 365'],amount:['المبلغ بالريال','text','مثل 1000.00'],percent:['النسبة المئوية','text','مثل 2.00'],
  // المسير الموازي (الترحيل 176): عدد الشهور قبل الانتقال، وأقصى فروق ما تتفسّر.
  months:['عدد الشهور','number','عدد صحيح من 1 لين 12'],unexplained_max:['أقصى فروق ما تتفسّر في الشهر','number','عدد صحيح، والصفر يعني ما نقبل فرقًا بلا تفسير']};
const SEP='::';
// اسم الوحدة المالكة بدل مفتاح القائمة البرمجي في رمز البطاقة: القارئ يعرف «الموردون» لا «vendors.category».
const MODULES={vendors:'الموردون',procurement:'المشتريات',payables:'المدفوعات',ledger:'الدفتر',finance:'المالية',close:'الإقفال',payroll:'الرواتب'};
const valueText=value=>value===true?'نعم':value===false?'لا':value===null||value===undefined?'ما تحددت':Array.isArray(value)?value.map(valueText).join('، ')
  :typeof value==='object'?Object.entries(value).map(([k,x])=>`${FIELDS[k]?.[0]??k}: ${valueText(x)}`).join(' · '):String(value);
// القيمة «ما تحددت» حين يكون كل حقل فيها null: المنصة واقفة عندها حتى يقرّرها صاحبها.
const undecided=a=>a.source==='code_default'&&a.value!==null&&typeof a.value==='object'&&!Array.isArray(a.value)&&Object.values(a.value).every(x=>x===null);
const reasonField=codes=>({name:'reason_code',label:'تصنيف السبب',type:'select',options:codes.map(r=>({value:r.code,label:r.name}))});
const today=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Riyadh',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());

export const optionsUI={
  title:'الخيارات والقيم المعتمدة',
  description:'القوائم اللي تختار منها النماذج، والقيم اللي تحكم سلوك المنصة مثل المهل والسقوف. كل تغيير بسبب وتاريخ، والقيمة ما تسري إلا إذا اعتمدها شخص ثاني يحمل تصريحها.',
  load:api=>api('/options'),
  render(data,{e,button,ui=kit(e)}){
    const adoptions=data.adopted;
    const waiting=adoptions.filter(a=>a.pending.some(p=>!p.mine)&&a.can_decide);
    const open=adoptions.filter(a=>undecided(a)&&!waiting.includes(a));
    const fixed=adoptions.filter(a=>!a.editable);
    const settled=adoptions.filter(a=>a.editable&&!waiting.includes(a)&&!open.includes(a));
    const day=iso=>iso?`<time datetime="${e(iso)}">${e(iso)}</time>`:'—';
    // القرار المعلّق: قيمته ثم سريانه ثم أساسه. الذي ينتظر اعتماد القارئ بعلامة «دورك» وكلمتها، والذي سجّله القارئ ينتظر زميلًا.
    const pendingLine=(a,p)=>{const yours=!p.mine&&a.can_decide;
      return `<li data-id="${e(p.id)}" class="${yours?'is-decision':'is-pending'}"><strong>${e(valueText(p.value))}</strong>${yours?'<span class="badge is-decision">ينتظر اعتمادك</span>':''}<span>يسري من ${day(p.effective_from)} · ${p.mine?'سجّلته أنت، وينتظر اعتماد زميل يحمل التصريح':a.can_decide?'اعتمادك يخليه يسري':'ينتظر اعتماد زميل يحمل التصريح'}</span>
      <small class="subtle measure">${e(p.basis)}</small>${yours?`<div class="operation-actions">${button('approve_adoption',p.id,'اعتماد القرار')}</div>`:''}</li>`;};
    const adoption=a=>`<li data-id="${e(a.key)}" class="${waiting.includes(a)?'is-decision':undecided(a)?'is-late':''}"><strong>${e(a.label)}</strong>
      <span>${undecided(a)?'ما تقرّرت للحين':`القيمة: ${e(valueText(a.value))}`} · ${a.source==='adopted'?`معتمدة من ${day(a.effective_from)}`:a.source==='legal_schedule'?`مثبّتة نظامًا من ${day(a.effective_from)}`:a.editable?'ما اعتمدها أحد، فتسري قيمة الكود':'مثبّتة نظامًا'}</span>
      <small class="subtle measure">${e(a.basis)}${a.article?` · المرجع: ${e(a.article)}`:''}</small>
      <small class="subtle">يقرّرها: ${e(a.owner)}</small>
      ${a.pending.length?`<ul class="vn-list">${a.pending.map(p=>pendingLine(a,p)).join('')}</ul>`:''}
      ${a.can_decide&&a.editable?`<div class="operation-actions">${button('record_adoption',a.key,a.source==='adopted'?'تسجيل قرار جديد':'تسجيل القرار')}</div>`:''}</li>`;
    const block=(title,hint,items)=>items.length?`<section class="vn-block"><div class="panel-head"><h2>${e(title)} <span data-num>(${items.length})</span></h2>${hint?`<p>${e(hint)}</p>`:''}</div><ul class="vn-list">${items.map(adoption).join('')}</ul></section>`:'';
    const stateHtml=o=>o.awaiting_second_person?'ينتظر اعتماد شخص ثاني':o.state==='active'?'مستعمل':`موقوف${o.disabled_from?` من ${day(o.disabled_from)}`:''}`;
    const stateTone=o=>o.awaiting_second_person?'is-pending':o.state==='active'?'':'is-old';
    const list=l=>{
      const rows=l.options.map(o=>{
        const id=`${l.key}${SEP}${o.value}`,actions=l.can_manage?[
          o.awaiting_second_person?button('approve_option',id,'اعتماد'):'',
          o.state==='active'?button('disable_option',id,'إيقاف'):button('enable_option',id,'إعادة تشغيل'),
          button('relabel_option',id,'تعديل الاسم')].filter(Boolean).join(''):'';
        return `<tr data-id="${e(id)}" class="${stateTone(o)}"><td>${e(o.label)}</td><td><bdi>${e(o.value)}</bdi></td><td>${stateHtml(o)}</td><td>${actions?`<div class="operation-actions">${actions}</div>`:'<span class="subtle">للقراءة</span>'}</td></tr>`;
      });
      const body=`<div class="panel-body"><p class="subtle measure">${e(l.governance_name)} · يديرها: ${e(l.owner)}${l.article?` · المرجع: ${e(l.article.ref??'')}`:''}</p>
        ${ui.table({head:['الخيار','القيمة المخزّنة','الحالة','الإجراء'],rows,empty:{title:'ما فيها خيارات',body:'أضف أول خيار بسببه وتاريخه.'}})}
        ${l.can_manage&&l.editable?`<div class="operation-actions">${button('add_option',l.key,'إضافة خيار')}</div>`:''}</div>`;
      return ui.card({code:MODULES[l.module]??l.module,title:l.label,meta:`${l.active_count} مستعمل${l.disabled_count?` · ${l.disabled_count} موقوف`:''}`,body});
    };
    const lists=data.lists.filter(l=>l.editable),locked=data.lists.filter(l=>!l.editable);
    return `<section class="vn-board"><div class="vn-tiles">${ui.tile(waiting.length,'قرار ينتظر اعتمادك',waiting.length?'is-decision':'')}${ui.tile(open.length,'قيمة ما تقرّرت للحين',open.length?'is-late':'')}${ui.tile(settled.length,'قيمة معتمدة أو افتراضية')}${ui.tile(lists.length,'قائمة تديرها الشركة')}</div></section>
      ${block('تنتظر اعتمادك','سجّلها زميل، وما تسري إلا إذا اعتمدها شخص ثاني يحمل تصريحها.',waiting)}
      ${block('ما تقرّرت للحين','المنصة واقفة عند هذي القيم: ما تخترع رقمًا، فاللي يعتمد عليها موقوف لين يقرّرها صاحبها ويعتمدها شخص ثاني.',open)}
      ${block('القيم المعتمدة','',settled)}
      ${block('مثبّتة نظامًا','تنقرأ ومعها مادتها، وما تتغير من المنصة.',fixed)}
      ${lists.length?`<section class="vn-group"><h2>القوائم اللي تديرها الشركة <span>${lists.length}</span></h2>${lists.map(list).join('')}</section>`:''}
      ${locked.length?`<section class="vn-group"><h2>قوائم مقفلة <span>${locked.length}</span></h2><p class="measure">مقفلة بقيد في قاعدة البيانات أو مثبّتة نظامًا: تنقرا هنا وما تتحرر.</p>${locked.map(list).join('')}</section>`:''}
      ${!adoptions.length&&!data.lists.length?ui.empty('ما فيه قوائم ولا قيم مسجّلة','تطلع هنا أول ما تسجّلها وحداتها.'):''}`;
  },
  form(action,id,data){
    const codes=data.reason_codes;
    if(action==='record_adoption'){
      const a=data.adopted.find(x=>x.key===id);
      if(!a)throw Error('القيمة ما عادت موجودة. حدّث الصفحة.');
      const shape=a.code_default,keys=shape&&typeof shape==='object'&&!Array.isArray(shape)?Object.keys(shape):null;
      const valueFields=a.shape==='boolean'?[{name:'value',label:'القرار',type:'select',options:[{value:'true',label:'نعم'},{value:'false',label:'لا'}]}]
        :a.shape==='number'?[{name:'value',label:'القيمة',type:'number'}]
        :keys?keys.map(k=>({name:`v_${k}`,label:FIELDS[k]?.[0]??k,type:FIELDS[k]?.[1]??'text',hint:FIELDS[k]?.[2]??'',
          ...(FIELDS[k]?.[1]==='number'?{min:0,max:365,step:1}:FIELDS[k]?{inputmode:'decimal'}:{})}))
        :[{name:'value',label:'القيمة',type:'text'}];
      return {title:`قرار: ${a.label}`,endpoint:`/options/adoptions/${a.key}/record`,
        fields:[...valueFields,{name:'basis',label:'أساس القرار ومصدره',type:'textarea',hint:'من وين جا الرقم: محضر أو سياسة أو قرار. ينحفظ مع القرار ويشوفه اللي يعتمده.'},{name:'effective_from',label:'يسري من',type:'date',value:today()}],
        toPayload:v=>{
          let value;
          if(a.shape==='boolean')value=v.value==='true';
          else if(a.shape==='number')value=Number(v.value);
          else if(keys)value=Object.fromEntries(keys.map(k=>[k,v[`v_${k}`]===''||v[`v_${k}`]===undefined?null:FIELDS[k]?.[1]==='number'?Number(v[`v_${k}`]):String(v[`v_${k}`]).trim()]));
          else value=v.value;
          return {value,basis:v.basis,effective_from:v.effective_from};
        }};
    }
    if(action==='approve_adoption'){
      const a=data.adopted.find(x=>x.pending.some(p=>p.id===id)),p=a?.pending.find(x=>x.id===id);
      if(!p)throw Error('القرار ما عاد معلّقًا. حدّث الصفحة.');
      return {title:`اعتماد: ${a.label}`,endpoint:`/options/adoptions/${a.key}/approve`,
        fields:[{name:'note',label:'أساس الاعتماد',type:'textarea',hint:`القيمة المسجّلة: ${valueText(p.value)} · تسري من ${p.effective_from}. أساسها: ${p.basis}. اعتمادك يخليها تسري.`}],
        toPayload:v=>({adoption_id:id,note:v.note})};
    }
    if(action==='add_option'){
      const l=data.lists.find(x=>x.key===id);
      if(!l)throw Error('القائمة ما عادت موجودة. حدّث الصفحة.');
      const extras=Object.entries(l.extra_shape??{}).map(([k,label])=>l.extra_values?.[k]
        ?{name:`x_${k}`,label,type:'select',options:l.extra_values[k].map(x=>({value:x,label:x}))}:{name:`x_${k}`,label,type:'text'});
      return {title:`خيار جديد في «${l.label}»`,endpoint:`/options/${l.key}`,
        fields:[{name:'label',label:'اسم الخيار زي ما يقرأه الناس',type:'text'},{name:'value',label:'القيمة المخزّنة',type:'text',hint:l.value_hint??'تبقى ثابتة بعد الإضافة: السجلات تحفظها'},
          ...extras,reasonField(codes),{name:'reason',label:'السبب كاملًا',type:'textarea'},{name:'effective_on',label:'يسري من',type:'date',value:today()}],
        toPayload:v=>({label:v.label,value:v.value,reason_code:v.reason_code,reason:v.reason,effective_on:v.effective_on,
          ...(extras.length?{extra:Object.fromEntries(Object.keys(l.extra_shape).map(k=>[k,v[`x_${k}`]]))}:{})})};
    }
    const step={approve_option:'approve',disable_option:'disable',enable_option:'enable',relabel_option:'relabel'}[action];
    if(!step)throw Error('الإجراء غير متاح. حدّث الصفحة.');
    const at=id.indexOf(SEP),key=id.slice(0,at),value=id.slice(at+SEP.length),l=data.lists.find(x=>x.key===key),o=l?.options.find(x=>x.value===value);
    if(!o)throw Error('الخيار ما عاد موجودًا. حدّث الصفحة.');
    const endpoint=`/options/${key}/${encodeURIComponent(value)}/${step}`;
    if(step==='approve')return {title:`اعتماد «${o.label}»`,endpoint,fields:[{name:'reason',label:'أساس الاعتماد',type:'textarea'}],toPayload:v=>({reason:v.reason})};
    const title={disable:`إيقاف «${o.label}»`,enable:`إعادة تشغيل «${o.label}»`,relabel:`تعديل اسم «${o.label}»`}[step];
    const hint={disable:'الإيقاف يمنع الاستعمال الجديد من تاريخه، والسجلات القديمة تبقى تقرأ اسمه.',enable:l.second_person?'التشغيل توسيع: ما ينستعمل لين يعتمده شخص ثاني.':'',relabel:'القيمة المخزّنة ما تتغير، الاسم بس.'}[step];
    return {title,endpoint,
      fields:[...(step==='relabel'?[{name:'label',label:'الاسم الجديد',type:'text',value:o.label}]:[]),reasonField(codes),{name:'reason',label:'السبب كاملًا',type:'textarea',hint},{name:'effective_on',label:'يسري من',type:'date',value:today()}],
      toPayload:v=>({...(step==='relabel'?{label:v.label}:{}),reason_code:v.reason_code,reason:v.reason,effective_on:v.effective_on})};
  }
};
