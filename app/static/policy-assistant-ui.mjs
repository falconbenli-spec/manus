// «اسأل تركي»: صندوق سؤال، إجابة بسطر أو سطرين، ثم المواد باقتباسها ورابطها، ثم «هل كانت الإجابة مفيدة؟».
// لا نمط داخل السطر ولا نص برمجي مضمّن: كل ما هنا صفوف من ملف التصميم، وكل فعل زر بـdata-action كبقية الشاشات.
const field=(name,label,type='text',extra={})=>({name,label,type,...extra});
const guard=ok=>{if(!ok)throw Error('الإجراء غير متاح. أعد تحميل الصفحة.');};
const lines=(text,e)=>e(String(text??'')).replace(/\n/g,'<br>');

export function answerView(saved,e){
  const view=saved.view??{},citations=view.citations??[],conflicts=view.conflicts??[];
  const reply=Array.isArray(view.direct)&&view.direct.length?view.direct.join('\n'):saved.output;
  const head=saved.status==='refused'
    ? 'ما لقيت نصًا يجيب عن سؤالك، لذلك ما راح أخمّن.'
    : 'هذه الإجابة من بياناتك ونصوص المنصة فقط.';
  const calc=view.calculation&&view.calculation.steps?`<section class="vn-block"><h3>الحساب خطوة بخطوة</h3><div class="table-wrap"><table><thead><tr><th scope="col">الخطوة</th><th scope="col">القيمة</th><th scope="col">المادة</th></tr></thead><tbody>${view.calculation.steps.map(s=>`<tr><td>${e(s.label)}</td><td>${e(s.value)}</td><td>${e(s.article)}</td></tr>`).join('')}</tbody></table></div>${(view.calculation.assumptions??[]).length?`<p class="subtle">الافتراضات المعلنة: ${e(view.calculation.assumptions.join(' '))}</p>`:''}<p class="subtle">البدل ينقترح حركة راتب يعتمدها معتمد الرواتب، والمساعد ما يصرف ولا يعتمد.</p></section>`:'';
  const how=view.how_to?`<section class="vn-block"><h3>خطوات تقديم ${e(view.how_to.service.name)} (<bdi>${e(view.how_to.service.code)}</bdi>)</h3><ol class="vn-list">${view.how_to.steps.map(s=>`<li><strong>${e(s.title)}</strong><span>${e(s.detail)}</span></li>`).join('')}</ol>${view.how_to.blockers.length?`<p class="subtle">ما قد يوقف الطلب: ${e(view.how_to.blockers.join(' '))}</p>`:''}</section>`:'';
  const sources=citations.length?`<section class="vn-block"><h3>المواد التي تستند إليها الإجابة</h3><ul class="vn-list">${citations.map(c=>`<li class="${c.in_force?'':'is-old'}"><a href="${e(c.link)}"><strong>${e(c.title)}</strong></a><span>${c.effective_from?`سارية من ${e(c.effective_from)} · `:''}الفقرة ${e(c.paragraph)}${c.in_force?'':' · غير نافذة'}</span><small>«${e(c.text)}»</small></li>`).join('')}</ul></section>`:'';
  const clash=conflicts.length?`<section class="vn-block"><h3>تعارض مواد</h3><ul class="vn-list">${conflicts.map(c=>`<li><strong>النافذ: ${e(c.in_force)} · المنسوخ: ${e(c.superseded)}</strong><span>${e(c.note)}</span><a href="${e(c.link)}">فتح التعديل</a></li>`).join('')}</ul></section>`:'';
  const link=view.deep_link?`<p><a class="btn dark small" href="${e(view.deep_link.href)}">${e(!view.how_to&&!view.calculation&&citations.length?'فتح مصدر الإجابة':view.deep_link.label)}</a></p>`:'';
  const rate=saved.question_id?`<p class="subtle">تقدر تقيّم الإجابة لاحقًا من «محادثاتي السابقة».</p>`:'';
  const evidence=calc||how||sources||clash||rate?`<details class="turki-answer-details"><summary>التفاصيل والمصادر</summary><div>${calc}${how}${sources}${clash}${rate}</div></details>`:'';
  // الإجابة ومادتها وحدهما: طريق الاسترجاع مادة عمل لفريق السياسات، وتظهر له في رأس الشاشة لا في جواب الموظف.
  return `<section class="turki-chat-thread" aria-live="polite">
    ${view.question?`<div class="turki-message is-user"><span class="turki-speaker">أنت</span><p class="turki-bubble is-user">${lines(view.question,e)}</p></div>`:''}
    <div class="turki-message is-assistant"><span class="turki-avatar" aria-hidden="true">ت</span><div><span class="turki-speaker">تركي</span><p class="turki-bubble is-assistant">${lines(reply,e)}</p><small>${head}</small></div></div>
    ${link}${evidence}
  </section><div class="form-actions"><button class="btn dark" type="button" data-action="turki-followup">اسأل سؤالًا ثانيًا</button><button class="btn outline" type="button" data-action="close">إغلاق</button></div>`;
}

export const policyAssistantUI={
  title:'اسأل تركي',title_en:'Ask Turki',
  description:'اسأله عن السياسة، راتبك، رصيد إجازاتك، أو طريقة رفع أي طلب. يجاوب من المنصة وبياناتك أنت بس.',
  description_en:'Ask about policy, your salary, your leave balance, or how to submit a request. Answers use platform sources and your own data only.',
  load:async api=>{
    const data=await api('/policy-assistant');
    if(data.can_curate){try{data.golden=await api('/policy-assistant/golden');}catch{data.golden=null;}}
    return data;
  },
  render(data,{e,button}){
    const quick=data.suggested.slice(0,4).map((q,index)=>button('ask_policy',String(index),q)).join('');
    const more=data.suggested.slice(4).map((q,index)=>button('ask_policy',String(index+4),q)).join('');
    const ask=`<section class="turki-chat-card"><header><span class="turki-avatar" aria-hidden="true">ت</span><div><span class="turki-status">متاح الآن</span><h2>وش ودك تعرف؟</h2><p>اسأل عن السياسات، راتبك، رصيد إجازاتك، أو طريقة رفع أي طلب.</p></div></header>
      <div class="turki-start">${button('ask_policy','','ابدأ المحادثة')}</div>
      <div class="turki-quick" aria-label="أسئلة سريعة">${quick}</div>
      ${more?`<details class="turki-more"><summary>اقتراحات أكثر</summary><div class="turki-quick">${more}</div></details>`:''}
      <p class="turki-privacy">${e(data.rules[0]??'يجيب من نصوص المنصة وبياناتك أنت فقط.')}</p></section>`;
    const mine=data.my_questions.length?`<ul class="vn-list">${data.my_questions.map(q=>`<li class="${q.answered?'':'is-old'}"><strong>${e(q.question)}</strong>
      <span>${e(q.kind_name)} · ${q.answered?`${e(q.citations)} مرجعًا`:'ما فيه نص يجيب عنه'} · <time datetime="${e(q.asked_at)}">${e(q.asked_at.slice(0,16).replace('T',' '))}</time>${q.helpful===null?'':q.helpful?' · قيّمتها مفيدة':' · قيّمتها غير مفيدة'}</span>
      ${q.actions.length?`<div class="operation-actions">${button('rate_answer',q.id,'هل كانت الإجابة مفيدة؟')}</div>`:''}</li>`).join('')}</ul>`
      :'<p class="subtle">ما سألت للحين. اسأل سؤالك الأول من فوق.</p>';
    const gaps=!data.can_curate?'':`<section class="vn-group"><h2>ما لا يجيب عنه النص <span>${data.gaps.length}</span></h2><section class="vn-block">
      <p class="subtle">أسئلة موظفين ما لقى لها المساعد نص، أو قال صاحبها إن الإجابة ما أفادت. القائمة تقول أي نص ناقص في الدليل، ونص السؤال محجوب منه أرقام الهوية والحسابات.</p>
      ${data.gaps.length?`<ul class="vn-list">${data.gaps.map(q=>`<li><strong>${e(q.question)}</strong><span>${e(q.user_name)} · ${e(q.kind_name)} · <time datetime="${e(q.asked_at)}">${e(q.asked_at.slice(0,10))}</time>${q.helpful===0?' · قُيّمت غير مفيدة':''}</span><div class="operation-actions">${button('resolve_question',q.id,'أُضيف النص / إغلاق')}</div></li>`).join('')}</ul>`:'<p class="subtle">ما فيه سؤال مفتوح بلا نص.</p>'}</section></section>`;
    const g=data.golden;
    const golden=!g?'':`<section class="vn-group"><h2>الحزمة الذهبية</h2><section class="vn-block">
      <p>نجح ${e(g.passed)} من ${e(g.counted)} (${e((g.pass_rate_bp/100).toFixed(1))}٪)${g.skipped?` · تُخطّيت ${e(g.skipped)}`:''}.</p>
      <div class="table-wrap"><table><thead><tr><th scope="col">#</th><th scope="col">السؤال</th><th scope="col">المتوقع</th><th scope="col">النتيجة</th><th scope="col">يحتاج</th></tr></thead><tbody>${g.cases.map(c=>`<tr class="${c.outcome==='passed'?'':'is-late'}"><td>${e(c.id)}</td><td>${e(c.question)}</td><td>${e(c.expect)}</td><td>${e(c.outcome==='passed'?'نجح':c.outcome==='skipped'?'تُخطّيت':'رسب')} — ${e(c.detail)}</td><td>${e(c.needs)}</td></tr>`).join('')}</tbody></table></div>
      <p class="subtle">${e(g.note)}</p></section></section>`;
    const curation=!data.can_curate?'':`<details class="turki-curation"><summary>إدارة المحتوى والجودة</summary><div class="turki-curation-body">
      <section class="panel panel-body"><p class="subtle">مسار الاسترجاع: ${e(data.retrieval.name)} · الطبقة الدلالية: ${e(data.retrieval.semantic_layer)}${data.retrieval.note?` — ${e(data.retrieval.note)}`:''}</p><p class="subtle">المصدر: ${e(data.retrieval.library)}</p></section>${gaps}${golden}</div></details>`;
    return `${ask}<details class="turki-history"><summary>محادثاتي السابقة <span>${data.my_questions.length}</span></summary><div>${mine}</div></details>${curation}`;
  },
  form(action,id,data){
    if(action==='ask_policy'){
      const preset=id===''||id===undefined?'':(data.suggested[Number(id)]??'');
      return {title:'محادثة مع تركي',submit:'إرسال',endpoint:'/ai/run/policy_assistant',
        fields:[field('question','وش سؤالك؟','textarea',{maxLength:600,value:preset,hint:'اسأل عن سياسة، راتبك، رصيد إجازاتك، أو طريقة رفع طلب. يجاوب من نصوص المنصة وبياناتك أنت، وما يطلع على بيانات أي موظف ثاني.'})],
        toPayload:v=>({question:v.question}),after:(saved,e)=>({title:'تركي',html:answerView(saved,e)})};
    }
    if(action==='rate_answer'){
      const q=data.my_questions.find(x=>x.id===id);guard(q&&q.actions.includes(action));
      return {title:'هل كانت الإجابة مفيدة؟',endpoint:`/policy-assistant/questions/${id}/rate`,
        fields:[field('helpful','الإجابة','select',{options:[{value:'yes',label:'مفيدة'},{value:'no',label:'غير مفيدة'}]}),
          field('note','ما الذي نقصها؟','textarea',{required:false,maxLength:600})],
        toPayload:v=>({helpful:v.helpful==='yes',note:v.note||''})};
    }
    if(action==='resolve_question'){
      guard(data.can_curate&&data.gaps.some(q=>q.id===id));
      return {title:'إغلاق سؤال بلا نص',endpoint:`/policy-assistant/questions/${id}/resolve`,
        fields:[field('note','ما أُضيف إلى النص، أو سبب الإغلاق','textarea',{maxLength:1000,hint:'مثال: أُضيفت الفقرة إلى سياسة أنواع الإجازات المعتمدة بتاريخ سريان، أو: السؤال خارج نطاق السياسات.'})],
        toPayload:v=>({note:v.note})};
    }
    throw Error('الإجراء غير متاح. أعد تحميل الصفحة.');
  }
};
