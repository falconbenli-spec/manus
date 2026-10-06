// الدفتر المالي: القيود المزدوجة بإعداد ومراجعة مستقلين، وميزان المراجعة والأستاذ العام من القيود المرحّلة وحدها.
// الجدول والبلاطة والحالة من العدّة المشتركة (ctx.ui)؛ ومن يرسم الشاشة بلا صفحة (اختبار) يأخذ العدّة نفسها.
import { kit } from './kit.mjs';
import { riyadhDay } from './dates.mjs';
const labels={draft:'مسودة',pending:'بانتظار المراجعة',approved:'معتمد داخليًا',posted:'مرحّل محليًا',rejected:'مرفوض',edit:'تعديل',submit:'تقديم للمراجعة',return:'إعادة',approve:'اعتماد',reject:'رفض',post:'ترحيل داخلي',reverse:'إنشاء مسودة عكس'};
const accountTypes={asset:'أصل',liability:'التزام',equity:'حقوق ملكية',income:'إيراد',expense:'مصروف'};
const field=(name,label,type='text',extra={})=>({name,label,type,...extra});
const decimal=value=>`${Math.floor(value/100)}.${String(value%100).padStart(2,'0')}`;
const options=rows=>[{value:'',label:'اختر…'},...rows.map(r=>({value:r.id,label:r.code?`${r.code} · ${r.name}`:r.name}))];
const refs=(data,kind)=>data[kind].filter(r=>r.status?r.status==='open':r.active);
// ما ينتظر القارئ في القيد: قرار المراجع، أو ترحيل المعتمد، أو مسودته هو. العكس متاح على كل مرحّل، فليس انتظارًا.
const WAITS=new Set(['edit','submit','return','approve','reject','post']);
// سجل القيد يُقرأ أحداثًا بأفعالها، وملاحظة كل قرار تحت حدثه. المعرّفات الداخلية ونسخ السجل لا تظهر.
const EVENTS={created:'انعدّ القيد',reversal_created:'انعدّت مسودة العكس',edit:'انعدّلت المسودة',submit:'انقدّم للمراجعة',return:'رجع للتعديل',approve:'انعتمد',reject:'انرفض',post:'انرحّل'};
const eventName=action=>EVENTS[action]??(String(action).startsWith('created_from_')?'انعدّ من مستنده':action);
export const financeUI={
  title:'الدفتر المالي المحلي',description:'قيود مزدوجة بإعداد ومراجعة مستقلين، وتقارير من القيود المرحّلة بس. ما فيه دفع ولا ترحيل لنظام خارجي.',
  load:api=>api('/finance'),
  render(data,{e,button,money,ui=kit(e)}){
    const can=a=>data.permissions.includes(a),total=data.trial_balance;
    // المبلغ رقمٌ معزول الاتجاه بأرقام جدولية، والعملة في رأس العمود؛ والرصيد بقيمته وجهته (مدين/دائن) لا بإشارة وحدها.
    const num=v=>money(v,'').trim(),fig=v=>`<span class="ltr">${e(num(v))}</span>`;
    const side=v=>Number(v)===0?fig(0):`${fig(Math.abs(Number(v)))} ${Number(v)>0?'مدين':'دائن'}`;
    // خانة المدين أو الدائن الفارغة تبقى فارغة كما في الدفتر الورقي: الصفر في الجهة الثانية ضجيج يخفي المبلغ.
    const dc=v=>Number(v)?fig(v):'';
    const day=iso=>iso?`<time datetime="${e(iso)}">${e(riyadhDay(iso))}</time>`:'—';
    const account=id=>data.accounts.find(a=>a.id===id),centre=id=>data.cost_centers.find(c=>c.id===id);
    const accountName=a=>a?`<bdi>${e(a.code)}</bdi> · ${e(a.name)}`:'—';
    // القيد: المدين قبل الدائن، والبيان بجوار الحساب، وصف الإجمالي يثبت التوازن.
    const journalCard=j=>{
      const waits=j.allowed_actions.some(a=>WAITS.has(a)),debit=j.lines.reduce((n,l)=>n+Number(l.debit_minor),0),credit=j.lines.reduce((n,l)=>n+Number(l.credit_minor),0);
      const rows=[...j.lines.map(l=>`<tr><td>${accountName(account(l.account_id))}</td><td>${e(l.memo)}</td><td>${e(centre(l.cost_center_id)?.name??'—')}</td><td>${dc(l.debit_minor)}</td><td>${dc(l.credit_minor)}</td></tr>`),
        `<tr><th scope="row" colspan="3">الإجمالي${debit===credit?'':' — غير متوازن'}</th><td><strong>${fig(debit)}</strong></td><td><strong>${fig(credit)}</strong></td></tr>`];
      const decisions=[...j.decisions];
      const log=j.history.map(h=>{const d=['approve','return','reject'].includes(h.action)?decisions.shift():null;
        return `<li><strong>${e(eventName(h.action))}</strong><span><time datetime="${e(h.created_at)}">${e(riyadhDay(h.created_at))}</time></span>${d?.note?`<small class="measure">${e(d.note)}</small>`:''}</li>`;});
      return `<details class="vn-card ${waits?'is-decision':j.status==='draft'?'is-old':j.status==='pending'?'is-pending':''}"${waits?' open':''}><summary><span class="vn-code"><bdi>${e(j.source_reference)}</bdi></span><span class="vn-name"><strong>${e(j.description)}</strong><small>${day(j.entry_date)}</small></span><span class="vn-flags"><strong>${fig(debit)} ريال</strong>${waits?'<span class="badge is-decision">ينتظرك</span>':''}${ui.statusBadge(j.status,{module:'journal'})}</span></summary><div class="vn-body">
        ${j.allowed_actions.length?`<div class="operation-actions">${j.allowed_actions.map(a=>button(a,j.id,labels[a])).join('')}</div>`:''}
        ${ui.table({head:['الحساب','البيان','مركز التكلفة','مدين (ريال)','دائن (ريال)'],rows})}
        <p class="subtle measure">${e(j.evidence)}</p>
        ${log.length?`<details><summary>سجل القيد (<span data-num>${log.length}</span>)</summary><ul class="vn-list">${log.join('')}</ul></details>`:''}</div></details>`;
    };
    const group=(title,list)=>list.length?`<section class="vn-group"><h2>${e(title)} <span>${list.length}</span></h2>${list.map(journalCard).join('')}</section>`:'';
    const waiting=data.journals.filter(j=>j.allowed_actions.some(a=>WAITS.has(a))),rest=data.journals.filter(j=>!waiting.includes(j));
    // المستحقات بحالتي الترحيل والدفع الحقيقيتين. قيد المستحق يتجهز من «القوائم المالية والترحيل» بنوع «فاتورة مورد مطابقة»
    // (صافٍ لكل مركز وضريبة مدخلات والتزام بالإجمالي)؛ المسار اليدوي القديم من هنا مغلق لقيد جديد وقيوده القديمة تبقى معروضة.
    const source=can('source_procurement')?`<section class="vn-block"><div class="panel-head"><h2>المستحقات المطابقة</h2><p>قيد المستحق يتجهز من «<a href="#statements">القوائم المالية والترحيل</a>» من فاتورة المورد نفسها.</p></div>${data.eligible_payables.length?`<ul class="vn-list">${data.eligible_payables.map(p=>`<li><strong><bdi>${e(p.supplier_reference)}</bdi> · ${fig(p.amount_minor)} ريال</strong><span>${e({posted_locally:'مرحّل محليًا',reversed_locally:'انعكس محليًا',not_posted:'ما انرحّل'}[p.posting_status])} · ${e(p.payment_status_name)}</span></li>`).join('')}</ul>`:'<p class="subtle">ما فيه مستحقات مطابقة الحين — تطلع هنا أول ما تتطابق فاتورة مورد في «المشتريات».</p>'}</section>`:'';
    // ميزان المراجعة: الحركة ثم الرصيد، المدين قبل الدائن، وصف الإجمالي رأس صف.
    const trial=ui.table({head:['الحساب','حركة مدين (ريال)','حركة دائن (ريال)','رصيد مدين (ريال)','رصيد دائن (ريال)'],
      rows:[...total.rows.map(r=>`<tr><td>${accountName(r)}</td><td>${dc(r.debit_minor)}</td><td>${dc(r.credit_minor)}</td><td>${dc(r.balance_debit_minor)}</td><td>${dc(r.balance_credit_minor)}</td></tr>`),
        `<tr><th scope="row">الإجمالي</th><td><strong>${fig(total.total_debit_minor)}</strong></td><td><strong>${fig(total.total_credit_minor)}</strong></td><td><strong>${fig(total.balance_debit_minor)}</strong></td><td><strong>${fig(total.balance_credit_minor)}</strong></td></tr>`],
      empty:{title:'ما فيه حسابات للحين',body:'يبدأ الميزان أول ما ينضاف حساب في «دليل الحسابات» ويترحّل عليه قيد.'}});
    const balanced=total.total_debit_minor===total.total_credit_minor;
    // الأستاذ العام: حساب حساب، بحركته بترتيب التاريخ ورصيده الجاري، والرصيد الأخير على رأس بطاقته.
    const ledger=data.accounts.filter(a=>data.ledger.some(l=>l.account_id===a.id)).map(a=>{
      const lines=data.ledger.filter(l=>l.account_id===a.id),closing=lines.at(-1).running_balance_minor;
      return `<details class="vn-card"><summary><span class="vn-code"><bdi>${e(a.code)}</bdi></span><span class="vn-name"><strong>${e(a.name)}</strong><small>${e(accountTypes[a.account_type]??a.account_type)} · <span data-num>${lines.length}</span> حركة</small></span><span class="vn-flags"><strong>${side(closing)}</strong></span></summary><div class="vn-body">
        ${ui.table({head:['التاريخ','المرجع','البيان','مدين (ريال)','دائن (ريال)','الرصيد (ريال)'],rows:lines.map(l=>`<tr><td>${day(l.entry_date)}</td><td><bdi>${e(l.source_reference)}</bdi></td><td>${e(l.memo||l.description)}</td><td>${dc(l.debit_minor)}</td><td>${dc(l.credit_minor)}</td><td>${side(l.running_balance_minor)}</td></tr>`)})}</div></details>`;}).join('');
    const reference=kind=>{const title={accounts:'دليل الحسابات',cost_centers:'مراكز التكلفة',periods:'الفترات المحاسبية'}[kind];
      const rows=data[kind].map(r=>{const closed=r.status?r.status!=='open':!r.active;
        return `<li class="${closed?'is-old':''}"><strong>${e(r.name)}</strong><span>${r.code?`<bdi>${e(r.code)}</bdi>`:`من ${day(r.starts_on)} لين ${day(r.ends_on)}`} · ${r.status?(r.status==='open'?'مفتوحة':'مقفلة'):(r.active?'نشط':'موقوف')}</span>${can('configure')&&(r.status==='open'||r.active!==undefined)?`<div class="operation-actions">${button(r.status?'close':r.active?'deactivate':'activate',kind+':'+r.id,r.status?'إقفال الفترة':r.active?'تعطيل':'تفعيل')}</div>`:''}</li>`;}).join('');
      return `<details class="vn-block"><summary>${e(title)} (<span data-num>${data[kind].length}</span>)</summary>${can('configure')?`<div class="operation-actions">${button('create_'+kind,'','إضافة سجل')}</div>`:''}${rows?`<ul class="vn-list">${rows}</ul>`:'<p class="subtle">ما فيه سجلات للحين.</p>'}</details>`;};
    return `<section class="panel panel-body vn-head">${can('prepare')?`<div class="operation-actions">${button('create_journal','','قيد جديد')}</div>`:''}<p>مصدر التقارير: القيود المرحّلة في هالقاعدة، بالريال، لكل الفترات المرحّلة. الأرقام زي ما هي في ${day(data.generated_at)}.</p></section>
      <section class="vn-board"><div class="vn-tiles">${ui.tile(waiting.length,'قيد ينتظرك',waiting.length?'is-decision':'')}${ui.tile(data.journals.filter(j=>['draft','pending'].includes(j.status)).length,'مسودة أو بانتظار المراجعة')}${ui.tile(data.journals.filter(j=>j.status==='posted').length,'قيد مرحّل')}${ui.tile(balanced?'متوازن':'غير متوازن','ميزان المراجعة',balanced?'':'is-late')}</div></section>
      ${group('تنتظرك',waiting)}${source}
      ${group('مسودات وبانتظار المراجعة',rest.filter(j=>['draft','pending'].includes(j.status)))}${group('معتمدة ومرحّلة',rest.filter(j=>['approved','posted'].includes(j.status)))}${group('مرفوضة',rest.filter(j=>j.status==='rejected'))}
      ${data.journals.length?'':ui.empty('ما انحفظت قيود للحين',can('prepare')?'ابدأ من «قيد جديد» بسطرين أو أكثر يتوازن مدينها ودائنها، ويراجعه غيرك.':'تطلع القيود هنا أول ما يعدّها المكلّف بالإعداد.')}
      <section class="vn-block"><div class="panel-head"><h2>ميزان المراجعة</h2><p>${balanced?'متوازن: مجموع المدين يساوي مجموع الدائن.':'غير متوازن: مجموع المدين ما يساوي مجموع الدائن — راجع القيود المرحّلة.'}</p></div>${trial}</section>
      <section class="vn-group"><h2>الأستاذ العام <span>${data.accounts.filter(a=>data.ledger.some(l=>l.account_id===a.id)).length}</span></h2>${ledger||'<p class="subtle">ما فيه حركة مرحّلة للحين — يبدأ الأستاذ أول ما يترحّل قيد.</p>'}</section>
      <section class="vn-block"><div class="panel-head"><h2>المراجع المالية</h2></div>${['accounts','cost_centers','periods'].map(reference).join('')}</section>`;
  },
  form(action,id,data){
    if(action.startsWith('create_')&&action!=='create_journal'){
      const kind=action.slice(7);let fields;
      if(kind==='accounts')fields=[field('code','رمز الحساب'),field('name','اسم الحساب'),field('account_type','تصنيف الحساب','select',{options:Object.entries(accountTypes).map(([value,label])=>({value,label}))})];
      if(kind==='cost_centers')fields=[field('code','رمز المركز'),field('name','اسم المركز')];
      if(kind==='periods')fields=[field('name','اسم الفترة'),field('starts_on','تبدأ في','date'),field('ends_on','تنتهي في','date')];
      if(!fields)throw Error('نوع السجل غير متاح لك الحين. حدّث الصفحة.');
      return {title:'إضافة سجل مالي محلي',endpoint:'/finance/'+kind,idempotent:true,fields,toPayload:values=>({...values,...(kind==='accounts'?{currency:'SAR'}:{})})};
    }
    if(['activate','deactivate','close'].includes(action)){
      const [kind,recordId]=id.split(':'),r=data[kind]?.find(x=>x.id===recordId);if(!r)throw Error('السجل غير متاح لك الحين. حدّث الصفحة.');const version=r.version;
      return {title:'تغيير حالة السجل المالي',endpoint:`/finance/${kind}/${recordId}/${action}`,fields:[field('note','سبب التغيير ودليله','textarea')],toPayload:values=>({...values,version})};
    }
    const periodField=field('period_id','الفترة المفتوحة','select',{options:options(refs(data,'periods'))});
    const j=data.journals.find(j=>j.id===id),version=j?.version;
    if(action==='create_journal'||action==='edit'){
      if(action==='edit'&&!j?.allowed_actions.includes('edit'))throw Error('القيد ما ينعدّل');
      const count=Math.max(3,j?.lines.length||0),fields=[{...periodField,value:j?.period_id},field('entry_date','تاريخ القيد','date',{value:j?.entry_date}),field('description','وصف القيد','text',{value:j?.description}),field('evidence','دليل القيد','textarea',{value:j?.evidence}),...(!j?[field('source_reference','مرجع المصدر الفريد')]:[])];
      for(let i=0;i<count;i++){const l=j?.lines[i],required=i<2||!!l;fields.push(field(`account_${i}`,`الحساب في السطر ${i+1}`,'select',{options:options(refs(data,'accounts')),required,value:l?.account_id}),field(`center_${i}`,`المركز في السطر ${i+1}`,'select',{options:options(refs(data,'cost_centers')),required,value:l?.cost_center_id}),field(`debit_${i}`,`مدين ${i+1} بالريال`,'text',{required,value:l?decimal(l.debit_minor):'0'}),field(`credit_${i}`,`دائن ${i+1} بالريال`,'text',{required,value:l?decimal(l.credit_minor):'0'}),field(`memo_${i}`,`بيان السطر ${i+1}`,'text',{required,value:l?.memo}));}
      return {title:j?'تعديل مسودة القيد':'قيد مزدوج جديد',endpoint:j?`/finance/journals/${j.id}/edit`:'/finance/journals',idempotent:!j,fields,toPayload:values=>({...(j?{version}:{}),period_id:values.period_id,entry_date:values.entry_date,description:values.description,evidence:values.evidence,currency:'SAR',source_reference:j?.source_reference||values.source_reference,lines:Array.from({length:count},(_,i)=>i).filter(i=>i<2||values[`account_${i}`]||values[`center_${i}`]||values[`memo_${i}`]||Number(values[`debit_${i}`])||Number(values[`credit_${i}`])).map(i=>({account_id:values[`account_${i}`],cost_center_id:values[`center_${i}`],debit:values[`debit_${i}`],credit:values[`credit_${i}`],memo:values[`memo_${i}`]}))})};
    }
    if(!j||!j.allowed_actions.includes(action))throw Error('الفعل غير متاح على هالقيد');
    if(action==='reverse')return {title:'إنشاء مسودة عكس',endpoint:`/finance/journals/${id}/reverse`,fields:[periodField,field('entry_date','تاريخ العكس','date'),field('reason','سبب العكس','textarea'),field('evidence','دليل العكس','textarea')],toPayload:values=>({...values,version})};
    return {title:labels[action],endpoint:`/finance/journals/${id}/${action}`,fields:[field('note','دليل الإجراء المالي','textarea')],toPayload:values=>({...values,version})};
  }
};
