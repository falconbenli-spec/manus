// المطابقة البنكية: كشف يُرفع ملفًا، حركات لا تُعدَّل، اقتراح مشروح بسببه، وإقرار بشري ثم اعتماد مستقل.
import { dual } from './dates.mjs';
// الجدول والبلاطة من العدّة المشتركة (ctx.ui)؛ ومن يرسم الشاشة بلا صفحة (اختبار) يأخذ العدّة نفسها.
import { kit } from './kit.mjs';
const field=(name,label,type='text',extra={})=>({name,label,type,...extra});
const guard=ok=>{if(!ok)throw Error('الإجراء غير متاح لك الحين. حدّث الصفحة وشوف حالته.');};
const labels={propose_match:'مطابقة بسجل',group_match:'مطابقة مجمّعة',split_match:'مطابقة مجزّأة',classify_unmatched:'تصنيف بلا سجل',approve_match:'اعتماد المطابقة',reject_match:'رفض المطابقة',
  cancel_import:'إلغاء الدفعة',deactivate_profile:'إيقاف ملف التعريف',deactivate_rule:'إيقاف القاعدة',
  approve_reconciliation:'اعتماد التسوية',cancel_reconciliation:'إلغاء المسودة'};
const states={open:'بلا قرار',proposed:'مقترحة — تنتظر الاعتماد',matched:'مطابقة معتمدة',classified:'مصنّفة بلا سجل'};
const lineJournal={draft:'قيده مسودة',pending:'قيده ينتظر الاعتماد',approved:'قيده معتمد وما انرحّل',posted:'قيده مرحّل',rejected:'قيده مرفوض'};
const riyal=minor=>`${(minor/100).toFixed(2)} ريال`;
const memberLabel=m=>`${m.source_name} — ${m.reference||'بلا مرجع'} — ${m.date} — ${riyal(m.amount_minor)}${m.party?` — ${m.party}`:''}`;
const memberPayload=key=>{const [kind,...rest]=key.split('|'),value=rest.join('|');return kind==='journal'?{journal_id:value}:{source_kind:kind,source_id:value};};

export const bankReconciliationUI={
  title:'المطابقة البنكية',
  description:'مطابقة كشف الحساب البنكي بسجلات المنصة. الاستيراد يدوي بملف يرفعه المحاسب؛ ما فيه اتصال بأي بنك. النظام يقترح ويشرح سببه، والإقرار بشري، واللي يعدّ المطابقة ما يعتمدها، وما ينعدّ قيد محاسبي آليًا.',
  load:api=>api('/bank-reconciliation'),
  render(data,{e,button,money,ui=kit(e)}){
    // المبلغ رقمٌ معزول الاتجاه بأرقام جدولية؛ والعملة تُسمّى مرة: في رأس العمود والتسمية، وبعد أول مبلغ في السطر.
    const num=v=>money(v,'').trim(),fig=v=>`<span class="ltr">${e(num(v))}</span>`;
    const day=iso=>iso?`<time datetime="${e(String(iso).slice(0,10))}">${e(dual(iso))}</time>`:'—';
    // اتجاه الحركة شكلٌ وكلمة: الداخل للحساب بعلامة + وهو دائن في كشف البنك، والخارج بعلامة − وهو مدين فيه.
    const flow=t=>`<span class="ltr">${t.direction==='in'?'+':'−'}${e(num(t.amount_minor))}</span> ريال · ${t.direction==='in'?'داخل (دائن في الكشف)':'خارج (مدين في الكشف)'}`;
    const STATE_TONE={open:'is-due',proposed:'pending',matched:'matched',classified:'matched'};
    const suggestion=s=>`<li><strong>${e(s.summary)}</strong><span>درجة الترجيح <span data-num>${e(s.score)}</span> من 100 · ${fig(s.amount_minor)} ريال</span><small>${e(s.reasons.join(' · '))}</small></li>`;
    // سطر الكشف: تاريخه ومبلغه واتجاهه أولًا، ثم ما هو وحاله، ثم ما قُرّر فيه وسنده. ما ينتظر قرار القارئ بعلامة «دورك».
    const decides=t=>t.actions.some(a=>a==='approve_match'||a==='reject_match');
    const next=t=>t.state==='open'&&t.actions.length>0;
    const txn=t=>`<li class="${decides(t)||next(t)?'is-decision':t.state==='open'?'is-due':t.state==='proposed'?'is-pending':''}">
      <strong>${day(t.txn_date)} · ${flow(t)}</strong>${decides(t)?'<span class="badge is-decision">ينتظر اعتمادك</span>':next(t)?'<span class="badge is-decision">ينتظر قرارك</span>':`<span class="badge ${STATE_TONE[t.state]??''}">${e(states[t.state])}</span>`}
      <span>${e(t.description)}${t.reference?` · مرجع <bdi>${e(t.reference)}</bdi>`:''}</span>
      ${t.match?`<small class="measure">${t.match.kind==='record'?`طُوبقت (${e(t.match.shape_name)}) بـ${t.match.members.map(m=>`${e(m.source_name)} <bdi>${e(m.reference)}</bdi> ${fig(m.amount_minor)}`).join('، ')}${t.match.lines.length>1?` على <span data-num>${e(t.match.lines.length)}</span> سطور`:''}`:e(`مصنّفة: ${t.match.reason_name}`)} — أعدّها ${e(t.match.prepared_by_name)}${t.match.decided_by_name?`، وقرّر فيها ${e(t.match.decided_by_name)}`:'، وتنتظر معتمد ثاني'}. سبب المُعِدّ: ${e(t.match.rationale)}</small>`:''}
      ${t.bank_line?`<small class="${t.bank_line.journal_status==='posted'&&!t.bank_line.reversed?'subtle':''}">${t.bank_line.journal_status?e(t.bank_line.reversed?'قيده انرحّل ثم انعكس، فالسطر فرقٌ بنكي من جديد':lineJournal[t.bank_line.journal_status]):'ما له قيد للحين: يتجهز من «القوائم المالية والترحيل» ويعتمده ويرحّله غير اللي جهّزه'}</small>`:''}
      ${t.rule_hints.length?`<small class="subtle">${t.rule_hints.map(h=>e(h.text)).join(' · ')}</small>`:''}
      ${t.suggestions.length?`<ul class="vn-list">${t.suggestions.map(suggestion).join('')}</ul>`:t.state==='open'?'<small class="subtle">ما فيه مرشح مطابق في سجلات المنصة ضمن النافذة. صنّفها بسبب أو طابقها يدويًا.</small>':''}
      ${t.actions.length?`<div class="operation-actions">${t.actions.map(a=>button(a,t.id,labels[a])).join('')}</div>`:''}</li>`;
    const batch=i=>`<li class="${i.status==='cancelled'?'is-old':''}"><strong>${e(i.file_name)} · <span data-num>${e(i.row_count)}</span> حركة</strong>
      <span>من ${day(i.period_start)} لين ${day(i.period_end)} · افتتاحي ${fig(i.opening_balance_minor)} ريال · ختامي ${fig(i.closing_balance_minor)}${i.status==='cancelled'?` · ملغاة: ${e(i.cancel_reason)}`:''}</span>
      <small>بصمة الملف <bdi dir="ltr">${e(i.file_digest.slice(0,16))}…</bdi> · مطابقات معتمدة <span data-num>${e(i.approved_matches)}</span></small>
      ${i.actions.length?`<div class="operation-actions">${i.actions.map(a=>button(a,i.id,labels[a])).join('')}</div>`:''}</li>`;
    // التسوية تُقرأ بفرقها: هو ما يُقرَّر عليه، ثم أرقامها صفًّا صفًّا كما يقرؤها المحاسب، والفرق رأس صف.
    const rec=r=>{const waits=r.actions.includes('approve_reconciliation'),diff=Number(r.difference_minor);
      return `<details class="vn-card ${waits?'is-decision':r.status==='draft'?'is-pending':diff?'is-late':''}"${waits?' open':''}><summary><span class="vn-code"><time datetime="${e(r.period_end)}">${e(r.period_end)}</time></span><span class="vn-name"><strong>${e(r.bank_account_label)}</strong><small>من ${day(r.period_start)} لين ${day(r.period_end)}</small></span><span class="vn-flags"><strong>الفرق ${fig(r.difference_minor)} ريال${diff?'':' — صفر'}</strong>${waits?'<span class="badge is-decision">ينتظر اعتمادك</span>':`<span class="badge ${r.status==='approved'?'approved':r.status==='draft'?'draft':'cancelled'}">${e({draft:'مسودة',approved:'معتمدة ومقفلة',cancelled:'ملغاة'}[r.status])}</span>`}</span></summary><div class="vn-body">
        ${r.actions.length?`<div class="operation-actions">${r.actions.map(a=>button(a,r.id,labels[a])).join('')}</div>`:''}
        ${ui.table({head:['البند','المبلغ (ريال)'],rows:[`<tr><td>رصيد الكشف الختامي</td><td>${fig(r.statement_closing_minor)}</td></tr>`,`<tr><td>حركات في الكشف ما يقابلها سجل</td><td>${fig(r.unmatched_bank_minor)}</td></tr>`,`<tr><td>سجلات في الدفتر ما يقابلها سطر كشف</td><td>${fig(r.unmatched_book_minor)}</td></tr>`,`<tr><td>رصيد الدفتر المتوقع</td><td>${fig(r.expected_book_minor)}</td></tr>`,`<tr><td>رصيد الدفتر</td><td>${fig(r.book_balance_minor)}</td></tr>`,`<tr><th scope="row">الفرق</th><td><strong>${fig(r.difference_minor)}</strong></td></tr>`]})}
        <p class="subtle measure">${e(r.snapshot.formula)}</p>
        ${diff?`<p class="measure">تفسير الفرق: ${e(r.explanation)}</p>`:''}
        <p class="subtle">أعدّها ${e(r.prepared_by_name)}${r.approved_by_name?`، واعتمدها ${e(r.approved_by_name)}`:''}</p></div></details>`;};
    const columnNames={date:'التاريخ',description:'الوصف',reference:'المرجع',debit:'مدين',credit:'دائن',amount:'المبلغ',balance:'الرصيد'};
    const rule=r=>`<li class="${r.active?'':'is-old'}"><strong>${e(r.pattern)}</strong>
      <span>${r.account_code?`الحساب <bdi>${e(r.account_code)}</bdi> ${e(r.account_name)}`:''}${r.account_code&&r.project_name?' · ':''}${e(r.project_name?`المشروع ${r.project_name}`:'')} · مالكها ${e(r.owner_name)}</span>
      <small class="measure">${e(r.note)} — القاعدة تقترح بس، وما ترحّل ولا تنشئ قيد.</small>
      ${r.actions.length?`<div class="operation-actions">${r.actions.map(a=>button(a,r.id,labels[a])).join('')}</div>`:''}</li>`;
    const profile=p=>`<li class="${p.active?'':'is-old'}"><strong>${e(p.name)}</strong><span>${e(p.delimiter_name)} · <bdi dir="ltr">${e(p.date_format)}</bdi> · ترويسة <span data-num>${e(p.header_rows)}</span> سطر</span>
      <small>${Object.entries(p.columns).map(([k,c])=>`${e(columnNames[k]??k)}: <bdi dir="ltr">${e(c)}</bdi>`).join(' · ')}</small>
      ${p.actions.length?`<div class="operation-actions">${p.actions.map(a=>button(a,p.id,labels[a])).join('')}</div>`:''}</li>`;
    const head=`<section class="panel panel-body vn-head">${data.can_prepare?`<div class="operation-actions">${button('create_bank_account','','حساب بنكي جديد')}${data.accounts.length?button('save_profile','','تعيين أعمدة كشف'):''}${data.profiles.some(p=>p.active)?button('import_statement','','استيراد كشف'):''}${data.accounts.length?button('prepare_reconciliation','','إعداد تسوية فترة'):''}${button('create_rule','','قاعدة مطابقة')}</div>`:''}<p>${e(data.note)}</p>${data.can_prepare?'':'<p>معك تصريح الاعتماد بس: تراجع وتقرر، وما تعدّ.</p>'}</section>`;
    const waiting=data.transactions.filter(t=>decides(t)||next(t)),others=data.transactions.filter(t=>!waiting.includes(t));
    const block=(title,body,hint='')=>`<section class="vn-block"><div class="panel-head"><h2>${title}</h2>${hint?`<p>${e(hint)}</p>`:''}</div>${body}</section>`;
    const list=(items,draw,none)=>items.length?`<ul class="vn-list">${items.map(draw).join('')}</ul>`:`<p class="subtle">${e(none)}</p>`;
    const board=`<section class="vn-board"><div class="vn-tiles">
      ${ui.tile(data.unmatched_count,'حركة بلا قرار',data.unmatched_count?'is-due':'')}
      ${ui.tile(data.pending_count,'مطابقة تنتظر الاعتماد',data.pending_count&&data.can_approve?'is-decision':'')}
      ${ui.tile(data.imports.filter(i=>i.status==='active').length,'دفعة كشف سارية')}
      ${ui.tile(data.reconciliations.filter(r=>r.status==='approved').length,'تسوية معتمدة')}</div>
      <p class="subtle measure">الحسابات البنكية: ${data.accounts.length?data.accounts.map(a=>`${e(a.label)} — ${e(a.bank_name)} <bdi dir="ltr">****${e(a.account_tail)}</bdi> ← <bdi>${e(a.gl_code)}</bdi> ${e(a.gl_name)}`).join(' · '):'ما فيه حساب مسجّل للحين'}. تنحفظ آخر أربعة أرقام بس؛ ما فيه آيبان كامل ولا بيانات دخول في المنصة.</p></section>`;
    return head+board
      +(waiting.length?block(`ينتظرك <span data-num>(${waiting.length})</span>`,`<ul class="vn-list">${waiting.map(txn).join('')}</ul>`):'')
      +(data.reconciliations.length?`<section class="vn-group"><h2>تسويات الفترات <span>${data.reconciliations.length}</span></h2>${data.reconciliations.map(rec).join('')}</section>`:block('تسويات الفترات','<p class="subtle">ما فيه تسويات للحين. التسوية المعتمدة تنقفل، والتصحيح بتسوية بعدها.</p>'))
      +block('حركات الكشف',list(others,txn,data.transactions.length?'ما فيه حركات غير اللي تنتظرك.':'ما فيه حركات مستوردة. ابدأ بتعيين أعمدة كشف بنكك، وبعدها استورد الملف.'))
      +block('دفعات الاستيراد',list(data.imports,batch,'ما فيه دفعات للحين — تطلع هنا أول ما ينستورد كشف.'))
      +block('قواعد المطابقة',list(data.rules,rule,'ما فيه قواعد. القاعدة تقترح حسابًا أو مشروعًا لحركات يتكرر وصفها.'))
      +block('ملفات تعيين الأعمدة',list(data.profiles,profile,'ما فيه ملفات تعريف. كل بنك يصدّر أعمدته بترتيب مختلف، فينحفظ الترتيب مرة وينعاد استعماله.'));
  },
  form(action,id,data){
    const accountOptions=data.accounts.filter(a=>a.active).map(a=>({value:a.id,label:`${a.label} — ${a.bank_name} ****${a.account_tail}`}));
    if(action==='create_bank_account'){
      guard(data.can_prepare);
      return {title:'حساب بنكي جديد',endpoint:'/bank-reconciliation/accounts',idempotent:true,
        fields:[field('label','اسم الحساب زي ما تسميه المحاسبة'),field('bank_name','اسم البنك'),
          field('account_tail','آخر أربعة أرقام بس','text',{hint:'لا تكتب رقم الحساب كامل ولا الآيبان؛ المنصة ما تتصل بالبنك وما تحتاجه.'}),
          field('gl_account_id','حساب البنك في الدفتر','select',{options:data.ledger_accounts.filter(a=>a.account_type==='asset').map(a=>({value:a.id,label:`${a.code} — ${a.name}`}))})],
        toPayload:v=>v};
    }
    if(action==='save_profile'){
      guard(data.can_prepare&&data.accounts.length);
      const column=(key,label,hint)=>field(key,label,'text',{required:false,hint});
      return {title:'تعيين أعمدة كشف بنكي',endpoint:'/bank-reconciliation/profiles',idempotent:true,
        fields:[field('bank_account_id','الحساب البنكي','select',{options:accountOptions}),field('name','اسم ملف التعريف'),
          field('delimiter','الفاصل بين الأعمدة','select',{options:Object.entries(data.delimiters).map(([value,d])=>({value,label:d.name}))}),
          field('date_format','صيغة التاريخ في الملف','select',{options:Object.entries(data.date_formats).map(([value,sample])=>({value,label:`${value} (مثال ${sample})`}))}),
          field('header_rows','عدد أسطر الترويسة','number',{hint:'صفر إذا الملف بلا ترويسة، وعيّن الأعمدة وقتها بأرقامها مو بأسمائها.'}),
          column('date','عمود التاريخ','اسم العمود زي ما هو في الترويسة، أو رقمه والعدّ يبدأ من صفر.'),
          column('description','عمود الوصف'),column('reference','عمود المرجع (اختياري)'),
          column('debit','عمود مدين — مبلغ خارج من الحساب'),column('credit','عمود دائن — مبلغ داخل للحساب'),
          column('amount','أو عمود مبلغ واحد بإشارة','استخدمه بدل المدين والدائن إذا بنكك يصدّر عمود واحد: السالب خارج من الحساب.'),
          column('balance','عمود الرصيد بعد الحركة (اختياري)')],
        toPayload:v=>{
          const columns={};
          for(const key of ['date','description','reference','debit','credit','amount','balance']){
            const raw=v[key];if(raw===undefined||raw==='')continue;
            columns[key]=/^\d+$/.test(String(raw).trim())?Number(raw):String(raw);
          }
          return {bank_account_id:v.bank_account_id,name:v.name,delimiter:v.delimiter,date_format:v.date_format,header_rows:Number(v.header_rows||0),columns};
        }};
    }
    if(action==='import_statement'){
      guard(data.can_prepare&&data.profiles.some(p=>p.active));
      return {title:'استيراد كشف بنكي (ملف CSV)',endpoint:'/bank-reconciliation/imports',idempotent:true,
        fields:[field('profile_id','ملف تعيين الأعمدة','select',{options:data.profiles.filter(p=>p.active).map(p=>({value:p.id,label:p.name}))}),
          field('file_name','اسم الملف زي ما حفظته'),
          field('content','محتوى ملف CSV','textarea',{hint:'الصق محتوى الملف زي ما صدّره البنك، ولا ترفع ملف فيه كلمات مرور أو بيانات دخول. المنصة ما تتصل بالبنك وما تسحب الكشف بنفسها.'}),
          field('period_start','بداية فترة الكشف','date'),field('period_end','نهاية فترة الكشف','date'),
          field('opening_balance','الرصيد الافتتاحي زي ما هو في الكشف','text',{hint:'ينفحص: الافتتاحي + صافي الحركات لازم يساوي الختامي، وإلا ينرفض الملف.'}),
          field('closing_balance','الرصيد الختامي زي ما هو في الكشف')],
        toPayload:v=>v};
    }
    if(action==='create_rule'){
      guard(data.can_prepare);
      return {title:'قاعدة مطابقة (تقترح بس)',endpoint:'/bank-reconciliation/rules',idempotent:true,
        fields:[field('pattern','النمط في وصف الحركة','text',{hint:'نص يطلع في وصف الحركة البنكية، مثل اسم جهة تتكرر.'}),
          field('suggested_account_id','الحساب المقترح','select',{required:false,options:[{value:'',label:'— بلا حساب —'},...data.ledger_accounts.map(a=>({value:a.id,label:`${a.code} — ${a.name}`}))]}),
          field('suggested_project_id','المشروع المقترح','select',{required:false,options:[{value:'',label:'— بلا مشروع —'},...data.projects.map(p=>({value:p.id,label:p.name}))]}),
          field('note','وش تعني القاعدة','textarea',{hint:'القاعدة تقترح بس؛ ما ترحّل وما تسوي قيد محاسبي.'})],
        toPayload:v=>({pattern:v.pattern,suggested_account_id:v.suggested_account_id||null,suggested_project_id:v.suggested_project_id||null,note:v.note})};
    }
    if(action==='prepare_reconciliation'){
      guard(data.can_prepare&&data.accounts.length);
      return {title:'إعداد تسوية فترة',endpoint:'/bank-reconciliation/reconciliations',idempotent:true,
        fields:[field('bank_account_id','الحساب البنكي','select',{options:accountOptions}),
          field('period_start','بداية الفترة','date'),field('period_end','نهاية الفترة','date'),
          field('explanation','تفسير الفرق إذا ما كان صفر','textarea',{required:false,hint:'التسوية اللي فرقها مو صفر ما تنحفظ بلا تفسير مكتوب، ولازم كل حركات الفترة تكون مطابقة أو مصنّفة قبلها.'})],
        toPayload:v=>({bank_account_id:v.bank_account_id,period_start:v.period_start,period_end:v.period_end,explanation:v.explanation||''})};
    }
    if(action==='group_match'||action==='split_match'){
      const t=data.transactions.find(x=>x.id===id);guard(t&&t.actions.includes(action));
      const head=`${t.txn_date} · ${t.description.slice(0,50)}`,same=data.open_members.filter(m=>m.direction===t.direction);
      if(action==='group_match')return {title:`مطابقة مجمّعة — ${head}`,endpoint:'/bank-reconciliation/matches',idempotent:true,
        fields:[field('members','السجلات والقيود اللي يجمعها هالسطر','checks',{options:same.map(m=>({value:`${m.source_kind}|${m.source_id}`,label:memberLabel(m)})),
            hint:`مجموع اللي تختاره لازم يساوي مبلغ السطر ${riyal(t.amount_minor)} بالهللة، وإلا تنرفض المطابقة ويطلع لك الفرق.`}),
          field('rationale','سبب المطابقة زي ما تكتبه للمعتمد','textarea',{hint:'التحويل الواحد يسوّي أكثر من سجل، والمعتمد شخص ثاني.'})],
        toPayload:v=>({transaction_id:id,kind:'record',members:(v.members??[]).map(memberPayload),unmatched_reason:null,rationale:v.rationale})};
      const lines=data.transactions.filter(x=>x.id!==id&&x.state==='open'&&x.direction===t.direction&&x.bank_account_id===t.bank_account_id);
      return {title:`مطابقة مجزّأة — ${head}`,endpoint:'/bank-reconciliation/matches',idempotent:true,
        fields:[field('lines','سطور الكشف الثانية اللي وصل عليها السجل نفسه','checks',{options:lines.map(x=>({value:x.id,label:`${x.txn_date} · ${x.description.slice(0,50)} · ${riyal(x.amount_minor)}`})),
            hint:`هالسطر (${riyal(t.amount_minor)}) داخل في المطابقة، واختر معه باقي السطور.`}),
          field('member','السجل أو القيد الواحد','select',{options:same.map(m=>({value:`${m.source_kind}|${m.source_id}`,label:memberLabel(m)}))}),
          field('rationale','سبب المطابقة زي ما تكتبه للمعتمد','textarea',{hint:'السجل الواحد وصل على أكثر من حركة، ومجموع السطور لازم يساوي مبلغ السجل بالهللة.'})],
        toPayload:v=>({transaction_ids:[id,...(v.lines??[]).filter(x=>x!==id)],kind:'record',members:[memberPayload(v.member)],unmatched_reason:null,rationale:v.rationale})};
    }
    if(action==='propose_match'||action==='classify_unmatched'){
      const t=data.transactions.find(x=>x.id===id);guard(t&&t.actions.includes(action));
      const head=`${t.txn_date} · ${t.description.slice(0,50)}`;
      if(action==='classify_unmatched')return {title:`تصنيف حركة بلا سجل — ${head}`,endpoint:'/bank-reconciliation/matches',idempotent:true,
        fields:[field('unmatched_reason','السبب','select',{options:Object.entries(data.unmatched_reasons).map(([value,label])=>({value,label}))}),
          field('rationale','ليش ما لها سجل مقابل','textarea',{hint:'الرسوم والعائد يصيرون مستند ينتظر قيده من «القوائم المالية والترحيل»، والتحويل بين الحسابات يتطابق بقيده اليدوي بدل التصنيف. المنصة ما تسوي قيد آلي.'})],
        toPayload:v=>({transaction_id:id,kind:'unmatched',source_kind:null,source_id:null,unmatched_reason:v.unmatched_reason,rationale:v.rationale})};
      guard(t.suggestions.length);
      return {title:`مطابقة بسجل — ${head}`,endpoint:'/bank-reconciliation/matches',idempotent:true,
        fields:[field('candidate','السجل المقابل','select',{options:t.suggestions.map(s=>({value:`${s.source_kind}|${s.source_id}`,label:`${s.summary} — ${s.score}/100`}))}),
          field('rationale','سبب المطابقة زي ما تكتبه للمعتمد','textarea',{hint:`اقتراح المنصة وسببه: ${t.suggestions[0].reasons.join(' · ')}. الدرجة ترجيح مو قرار، والاعتماد لشخص ثاني.`})],
        toPayload:v=>({transaction_id:id,kind:'record',members:[memberPayload(v.candidate)],unmatched_reason:null,rationale:v.rationale})};
    }
    if(action==='cancel_import'){
      const i=data.imports.find(x=>x.id===id);guard(i&&i.actions.includes(action));
      return {title:`إلغاء دفعة — ${i.file_name}`,endpoint:`/bank-reconciliation/imports/${id}/cancel`,
        fields:[field('reason','سبب الإلغاء','textarea',{hint:'الحركات المستوردة ما تتعدل؛ التصحيح إنك تلغي الدفعة كاملة وتستورد ملف مصحح، وما تنلغي إذا انعتمدت عليها أي مطابقة.'})],
        toPayload:v=>({version:i.version,reason:v.reason})};
    }
    if(action==='deactivate_profile'){
      const p=data.profiles.find(x=>x.id===id);guard(p&&p.actions.includes(action));
      return {title:`إيقاف ملف تعريف — ${p.name}`,endpoint:`/bank-reconciliation/profiles/${id}/deactivate`,
        fields:[field('note','سبب الإيقاف','textarea')],toPayload:v=>({version:p.version,note:v.note})};
    }
    if(action==='deactivate_rule'){
      const r=data.rules.find(x=>x.id===id);guard(r&&r.actions.includes(action));
      return {title:`إيقاف قاعدة — ${r.pattern}`,endpoint:`/bank-reconciliation/rules/${id}/deactivate`,
        fields:[field('note','سبب الإيقاف','textarea')],toPayload:v=>({version:r.version,note:v.note})};
    }
    if(action==='approve_match'||action==='reject_match'){
      const t=data.transactions.find(x=>x.id===id);guard(t&&t.actions.includes(action));
      return {title:`${labels[action]} — ${t.description.slice(0,50)}`,endpoint:`/bank-reconciliation/matches/${t.match.id}/${action==='approve_match'?'approve':'reject'}`,
        fields:[field('note',action==='approve_match'?'وش راجعت':'سبب الرفض','textarea',{hint:`سبب المُعِدّ: ${t.match.rationale}`})],
        toPayload:v=>({version:t.match.version,note:v.note})};
    }
    const r=data.reconciliations.find(x=>x.id===id);guard(r&&r.actions.includes(action));
    if(action==='approve_reconciliation')return {title:`اعتماد تسوية — ${r.bank_account_label} لين ${r.period_end}`,endpoint:`/bank-reconciliation/reconciliations/${id}/approve`,
      fields:[field('note','وش راجعت قبل ما تعتمد','textarea',{hint:`${r.snapshot.formula} التسوية المعتمدة مقفلة وما تتعدل؛ التصحيح يكون بتسوية بعدها.`})],
      toPayload:v=>({version:r.version,note:v.note})};
    return {title:`إلغاء مسودة تسوية — ${r.period_end}`,endpoint:`/bank-reconciliation/reconciliations/${id}/cancel`,
      fields:[field('note','سبب الإلغاء','textarea')],toPayload:v=>({version:r.version,note:v.note})};
  }
};
