// ثلاث شاشات حوكمة: الأهداف والمبادرات، سجل المخاطر، سجل القرارات والالتزامات.
// كل شاشة تصرّح بحدودها: لا نسبة إنجاز محسوبة، ولا مقياس مخاطر تفرضه المنصة، ولا قياس لأثر القرار.
import { dual } from './dates.mjs';

const field=(name,label,type='text',extra={})=>({name,label,type,...extra});
const guard=ok=>{if(!ok)throw Error('الإجراء غير متاح. أعد تحميل الصفحة.');};
const options=(map,keys)=>(keys??Object.keys(map)).map(value=>({value,label:map[value]}));
const peopleOptions=data=>data.people.map(p=>({value:p.id,label:p.name}));
const decimal=minor=>minor===null||minor===undefined?'':`${Math.floor(minor/100)}.${String(minor%100).padStart(2,'0')}`;
const tile=(e,value,label,tone='')=>`<div class="vn-tile ${tone}"><strong>${e(value)}</strong><span>${e(label)}</span></div>`;

// ================= أ. الأهداف والمبادرات =================
const objectiveLabels={edit_objective:'تعديل الهدف',close_objective:'إقفال الهدف',add_initiative:'مبادرة جديدة',
  edit_initiative:'تعديل المبادرة',approve_initiative:'اعتماد المبادرة',start_initiative:'بدء التنفيذ',complete_initiative:'إنجاز',
  stop_initiative:'إيقاف',cancel_initiative:'إلغاء',add_indicator:'مؤشر جديد',record_measurement:'تسجيل قياس'};
const findInitiative=(data,initiativeId)=>data.objectives.flatMap(o=>o.initiatives).find(i=>i.id===initiativeId);
const findIndicator=(data,indicatorId)=>data.objectives.flatMap(o=>o.initiatives).flatMap(i=>i.indicators).find(x=>x.id===indicatorId);

function indicatorRow(indicator,{e,button}){
  const latest=indicator.latest;
  return `<li class="${latest?'':'is-old'}"><strong>${e(indicator.title)} · ${e(indicator.unit)}</strong>
    <span>خط الأساس ${e(indicator.baseline_value)} · المستهدف ${e(indicator.target_value)} · ${e(indicator.direction_name)} · ${latest?`آخر قياس ${e(latest.value)} في ${e(dual(latest.measured_on))}`:'ما فيه قياس للحين (فراغ، مو صفر)'}</span>
    <small>${latest?`مصدر القياس: ${e(latest.source)}. القياسات الحية: ${e(indicator.measurements.length)}. الفجوة حتى المستهدف ${e(indicator.gap)} ${e(indicator.unit)}.`:`المصدر المعلن: ${e(indicator.measurement_source)}`}</small>
    ${indicator.actions.length?`<div class="operation-actions">${indicator.actions.map(a=>button(a,indicator.id,objectiveLabels[a])).join('')}</div>`:''}</li>`;
}
function initiativeBlock(initiative,{e,button,money}){
  const indicators=initiative.indicators.map(x=>indicatorRow(x,{e,button})).join('');
  const budget=initiative.budget_minor===null?'بلا ميزانية مسجّلة':`ميزانية مخططة ${money(initiative.budget_minor)}${initiative.budget_id?' مرتبطة بمخصص مشروع':' غير مرتبطة بمخصص'}`;
  return `<section class="${initiative.late?'is-late':['done','stopped','cancelled'].includes(initiative.status)?'is-old':''}">
    <h3>${e(initiative.title)}</h3>
    <p>${e(initiative.status_name)} · المالك ${e(initiative.owner_name)} · الموعد ${e(dual(initiative.due_date))}${initiative.late?' · فات موعدها':''}</p>
    <p class="subtle">${initiative.approved_by_name?'':`اقترحها ${e(initiative.proposed_by_name)}، ويعتمدها غيره · `}${e(budget)}${initiative.decision_note?` — ${e(initiative.decision_note)}`:''}${initiative.outcome_note?` — الخلاصة: ${e(initiative.outcome_note)}`:''}</p>
    ${indicators?`<ul class="vn-list">${indicators}</ul>`:'<p class="subtle">ما لها مؤشر، والمبادرة بلا مؤشر ما ينعرف تحققها.</p>'}
    ${initiative.actions.length?`<div class="operation-actions">${initiative.actions.map(a=>button(a,initiative.id,objectiveLabels[a])).join('')}</div>`:''}</section>`;
}

export const objectivesUI={
  title:'الأهداف والمبادرات',
  description:'هدف سنوي لكل إدارة بمالك وفترة، وتحته مبادرات بمالك وموعد وميزانية، ومؤشرات بخط أساس ومستهدف ومصدر قياس مكتوب. ما فيه نسبة إنجاز محسوبة: القياس المسجّل مقابل المستهدف بس.',
  load:api=>api('/governance/objectives'),
  render(data,{e,button,money}){
    const c=data.counters;
    const head=`<section class="panel panel-body vn-head"><p>${e(data.note)}</p>
      ${data.can_manage?`<div class="operation-actions">${button('create_objective','','هدف جديد')}</div>`:'<p class="subtle">تصريح إدارة السجل مو ممنوح لحسابك؛ يظهر لك اللي يخصّك من أهداف ومبادرات بس.</p>'}</section>`;
    const tiles=`<div class="vn-tiles">${tile(e,c.objectives,'أهداف')}${tile(e,c.initiatives,'مبادرات')}${tile(e,c.proposed,'مقترحة بانتظار اعتماد',c.proposed?'is-due':'')}${tile(e,c.late,'فات موعدها',c.late?'is-late':'')}${tile(e,c.indicators,'مؤشرات')}${tile(e,c.unmeasured,'مؤشرات بلا قياس',c.unmeasured?'is-old':'')}</div>`;
    const body=data.objectives.map(o=>`<section class="panel"><div class="panel-head"><div><h2>${e(o.title)}</h2><p>${e(o.department_name)} · المالك ${e(o.owner_name)} · ${e(dual(o.period_from))} — ${e(dual(o.period_to))}</p></div><span class="badge">${e(o.status_name)}</span></div>
      <div class="panel-body"><p>${e(o.statement)}</p>${o.closure_note?`<p class="subtle">خلاصة الإقفال: ${e(o.closure_note)}</p>`:''}
      ${o.initiatives.length?`<div class="vn-board">${o.initiatives.map(i=>initiativeBlock(i,{e,button,money})).join('')}</div>`:'<p class="subtle">ما فيه مبادرات تحت هذا الهدف للحين.</p>'}
      ${o.actions.length?`<div class="operation-actions">${o.actions.map(a=>button(a,o.id,objectiveLabels[a])).join('')}</div>`:''}</div></section>`).join('');
    return head+`<section class="vn-board">${tiles}</section>`+(body||`<section class="panel panel-body"><p class="subtle">${data.can_manage?'ما فيه أهداف مسجّلة. ابدأ بهدف واحد لإدارة وحدة بمالك وفترة.':'ما فيه أهداف ولا مبادرات مسندة لك.'}</p></section>`);
  },
  form(action,recordId,data){
    if(action==='create_objective'){
      guard(data.can_manage);
      return {title:'هدف جديد',endpoint:'/governance/objectives',idempotent:true,fields:[
        field('department_id','الإدارة','select',{options:data.departments.map(d=>({value:d.id,label:d.name}))}),
        field('title','الهدف'),field('statement','ما الذي يدل على تحقق الهدف','textarea',{hint:'اكتبه بما يُقاس، لا بعبارة عامة.'}),
        field('owner_id','مالك الهدف','select',{options:peopleOptions(data)}),
        field('period_from','بداية الفترة','date'),field('period_to','نهاية الفترة','date')],
        toPayload:v=>v};
    }
    const objective=data.objectives.find(o=>o.id===recordId);
    if(objective&&objective.actions.includes(action)){
      if(action==='edit_objective')return {title:`تعديل — ${objective.title}`,endpoint:`/governance/objectives/${recordId}/edit_objective`,fields:[
        field('title','الهدف','text',{value:objective.title}),field('statement','ما الذي يدل على تحقق الهدف','textarea',{value:objective.statement}),
        field('owner_id','مالك الهدف','select',{value:objective.owner_id,options:peopleOptions(data)}),
        field('period_from','بداية الفترة','date',{value:objective.period_from}),field('period_to','نهاية الفترة','date',{value:objective.period_to})],
        toPayload:v=>({version:objective.version,...v})};
      if(action==='close_objective')return {title:`إقفال — ${objective.title}`,endpoint:`/governance/objectives/${recordId}/close_objective`,fields:[
        field('closure_note','خلاصة الإقفال','textarea',{hint:'ما الذي تحقق وما الذي لم يتحقق، بالقياس لا بالانطباع. صاحب الهدف لا يقفل هدفه بنفسه.'})],
        toPayload:v=>({version:objective.version,closure_note:v.closure_note})};
      if(action==='add_initiative')return {title:`مبادرة جديدة تحت — ${objective.title}`,endpoint:'/governance/initiatives',idempotent:true,fields:[
        field('title','المبادرة'),field('owner_id','مالك المبادرة','select',{options:peopleOptions(data)}),
        field('due_date','الموعد','date',{hint:`داخل فترة الهدف: ${objective.period_from} — ${objective.period_to}.`}),
        ...budgetFields(data,null)],
        toPayload:v=>({objective_id:objective.id,title:v.title,owner_id:v.owner_id,due_date:v.due_date,budget_amount:v.budget_amount||null,budget_id:v.budget_id||null,budget_note:v.budget_note||''})};
    }
    const initiative=findInitiative(data,recordId);
    if(initiative&&initiative.actions.includes(action)){
      if(action==='edit_initiative')return {title:`تعديل — ${initiative.title}`,endpoint:`/governance/initiatives/${recordId}/edit_initiative`,fields:[
        field('title','المبادرة','text',{value:initiative.title}),field('owner_id','مالك المبادرة','select',{value:initiative.owner_id,options:peopleOptions(data)}),
        field('due_date','الموعد','date',{value:initiative.due_date}),...budgetFields(data,initiative)],
        toPayload:v=>({version:initiative.version,title:v.title,owner_id:v.owner_id,due_date:v.due_date,budget_amount:v.budget_amount||null,budget_id:v.budget_id||null,budget_note:v.budget_note||''})};
      if(action==='approve_initiative')return {title:`اعتماد — ${initiative.title}`,endpoint:`/governance/initiatives/${recordId}/approve_initiative`,fields:[
        field('note','ما الذي اعتمدته ولماذا','textarea',{hint:'من اقترح المبادرة لا يعتمدها؛ هذا الاعتماد يُسجل باسمك.'})],
        toPayload:v=>({version:initiative.version,note:v.note})};
      if(action==='start_initiative')return {title:`بدء التنفيذ — ${initiative.title}`,endpoint:`/governance/initiatives/${recordId}/start_initiative`,fields:[],toPayload:()=>({version:initiative.version})};
      if(action==='add_indicator')return {title:`مؤشر جديد على — ${initiative.title}`,endpoint:'/governance/indicators',idempotent:true,fields:[
        field('title','المؤشر'),field('unit','وحدة القياس','text',{hint:'مثل: طلب، يوم، ريال، نسبة مئوية.'}),
        field('baseline_value','خط الأساس','number',{step:'any'}),field('target_value','المستهدف','number',{step:'any'}),
        field('direction','الاتجاه المطلوب','select',{options:options(data.directions)}),
        field('measurement_source','مصدر القياس','textarea',{hint:'من أين يُقرأ الرقم ومن يقرؤه ومتى. مؤشر بلا مصدر مكتوب لا يُقاس.'})],
        toPayload:v=>({initiative_id:initiative.id,title:v.title,unit:v.unit,baseline_value:Number(v.baseline_value),target_value:Number(v.target_value),direction:v.direction,measurement_source:v.measurement_source})};
      const closing={complete_initiative:'إنجاز',stop_initiative:'إيقاف',cancel_initiative:'إلغاء'}[action];
      if(closing)return {title:`${closing} — ${initiative.title}`,endpoint:`/governance/initiatives/${recordId}/${action}`,fields:[
        field('outcome_note','ما الذي انتهت إليه المبادرة','textarea',{hint:'الحالة نهائية ولا تُفتح مرة أخرى؛ ما يليها مبادرة جديدة.'})],
        toPayload:v=>({version:initiative.version,outcome_note:v.outcome_note})};
    }
    const indicator=findIndicator(data,recordId);
    guard(indicator&&indicator.actions.includes(action)&&action==='record_measurement');
    // اللوحة تعيد القياسات الحية وحدها، فما يصلح للتصحيح هو ما تعرضه.
    const live=indicator.measurements;
    return {title:`تسجيل قياس — ${indicator.title}`,endpoint:`/governance/indicators/${recordId}/record_measurement`,fields:[
      field('value',`القيمة المقاسة (${indicator.unit})`,'number',{step:'any'}),
      field('measured_on','تاريخ القياس','date',{hint:'تاريخ القياس نفسه لا تاريخ إدخاله.'}),
      field('source','مصدر هذا القياس بعينه','textarea',{hint:'التقرير أو الملف أو الشاشة التي قُرئ منها الرقم.'}),
      field('corrects_id','يصحح قياسًا سابقًا','select',{required:false,options:[{value:'',label:'— قياس جديد لا تصحيح —'},...live.map(m=>({value:m.id,label:`${m.measured_on}: ${m.value}`}))],
        hint:'القياس المسجَّل لا يُعدَّل. التصحيح قياس جديد يشير إليه ويبقى الأول ظاهرًا في السجل.'}),
      field('correction_reason','سبب التصحيح','textarea',{required:false})],
      toPayload:v=>({value:Number(v.value),measured_on:v.measured_on,source:v.source,corrects_id:v.corrects_id||null,correction_reason:v.correction_reason||''})};
  }
};
function budgetFields(data,initiative){
  return [field('budget_amount','ميزانية المبادرة بالريال','text',{required:false,value:initiative?decimal(initiative.budget_minor):'',hint:'رقم مخطط اختياري. وجوده هنا ليس ارتباطًا بالدفتر المالي ولا إنفاقًا فعليًا.'}),
    field('budget_id','مخصص مشروع مرتبط','select',{required:false,value:initiative?.budget_id??'',options:[{value:'',label:'— بلا مخصص —'},...data.budgets.map(b=>({value:b.id,label:`${b.project_name} · ${b.cost_center}`}))]}),
    field('budget_note','بيان الميزانية','textarea',{required:false,value:initiative?.budget_note??''})];
}

// ================= ب. سجل المخاطر =================
const riskLabels={create_risk:'خطر جديد',define_scale:'تعريف المقياس',edit_risk:'تعديل الخطر',review_risk:'تسجيل مراجعة',accept_risk:'اعتماد القبول',close_risk:'إقفال الخطر'};
function riskRow(risk,{e,button}){
  const tone=risk.status==='closed'?'is-old':risk.review_overdue?'is-late':risk.awaiting_acceptance||risk.treatment_late?'is-due':'';
  // الوصف والضوابط والخطة والقبول والإقفال كلٌّ في سطره: سطرٌ واحد بشُرَط كان يُقرأ فقرةً بلا معالم.
  return `<li class="${tone}"><strong>${e(risk.title)} · ${e(risk.category)}</strong>
    <span>الاحتمال ${e(risk.likelihood_label)} × الأثر ${e(risk.impact_label)} = ${e(risk.score)}${risk.band?` · ${e(risk.band)}`:' · بلا نطاق معرَّف'} · ${e(risk.response_name)} · المالك ${e(risk.owner_name)}${risk.link_title?` · مرتبط بـ${e(risk.link_type_name)}: ${e(risk.link_title)}`:''}</span>
    <span>المراجعة التالية ${e(dual(risk.next_review_on))}${risk.review_overdue?' · تجاوزت موعدها':''}${risk.treatment_owner_name?` · المعالجة: ${e(risk.treatment_owner_name)} حتى ${e(dual(risk.treatment_due))}${risk.treatment_late?' · فات موعدها':''}`:''}</span>
    <small>${e(risk.description)}</small>${risk.existing_controls?`<small>الضوابط القائمة: ${e(risk.existing_controls)}</small>`:''}${risk.treatment_plan?`<small>الخطة: ${e(risk.treatment_plan)}</small>`:''}${risk.acceptance?`<small>قبله ${e(risk.acceptance.accepted_by_name)}: ${e(risk.acceptance.reason)}</small>`:''}${risk.acceptance_blocked?'<small>لا يوجد في الهيكل من هو أعلى من مالك هذا الخطر، فما ينعتمد قبوله. سجّل مديره المباشر أول.</small>':''}${risk.status==='closed'?`<small>أُقفل: ${e(risk.closure_note)}</small>`:''}
    ${risk.reviews.length?`<small>آخر مراجعة <time datetime="${e(risk.reviews[0].reviewed_at)}">${e(risk.reviews[0].reviewed_at.slice(0,10))}</time>: ${e(risk.reviews[0].note)}</small>`:'<small class="subtle">ما انسجلت مراجعة للحين.</small>'}
    ${risk.actions.length?`<div class="operation-actions">${risk.actions.map(a=>button(a,risk.id,riskLabels[a])).join('')}</div>`:''}</li>`;
}
export const risksUI={
  title:'سجل المخاطر',
  description:'خطر بمالك وفئة واحتمال وأثر على مقياس يعرّفه صاحب الإجراء بنفسه، مع استجابة وضوابط وخطة معالجة بمالك وموعد ومراجعة دورية إلزامية. القبول ما يمشي إلا باعتماد اللي أعلى من المالك.',
  load:api=>api('/governance/risks'),
  render(data,{e,button}){
    const c=data.counters,scale=data.scale;
    const scaleView=scale.defined
      ?`<p>الاحتمال: ${e(scale.likelihood.map(l=>`${l.value}=${l.label}`).join('، '))}. الأثر: ${e(scale.impact.map(l=>`${l.value}=${l.label}`).join('، '))}. ${scale.bands.length?`النطاقات: ${e(scale.bands.map(b=>`${b.label} (${b.min_score}–${b.max_score})`).join('، '))}.`:'ما تعرّفت نطاقات للدرجة، فالدرجة عدد مجرّد.'}</p>`
      :'<p class="vn-alert is-due">ما فيه مقياس معرّف. ما ينسجل خطر قبل ما يعرّف صاحب الإجراء درجات الاحتمال والأثر بنفسه.</p>';
    const head=`<section class="panel panel-body vn-head"><p>${e(data.note)}</p>${scaleView}
      ${data.can_manage?`<div class="operation-actions">${button('define_scale','',riskLabels.define_scale)}${scale.defined?button('create_risk','',riskLabels.create_risk):''}</div>`:'<p class="subtle">تصريح إدارة السجل مو ممنوح لحسابك؛ تظهر لك المخاطر اللي تملكها أو تعالجها أو تنعرض عليك لقبولها.</p>'}</section>`;
    const tiles=`<div class="vn-tiles">${tile(e,c.open,'مخاطر مفتوحة')}${tile(e,c.review_overdue,'تجاوزت موعد مراجعتها',c.review_overdue?'is-late':'')}${tile(e,c.awaiting_acceptance,'قبول بانتظار اعتماد أعلى',c.awaiting_acceptance?'is-due':'')}${tile(e,c.treatment_late,'معالجة فات موعدها',c.treatment_late?'is-late':'')}${tile(e,c.closed,'مقفلة','is-old')}</div>`;
    const list=data.risks.map(r=>riskRow(r,{e,button})).join('');
    return head+`<section class="vn-board">${tiles}<section class="vn-block">${list?`<ul class="vn-list">${list}</ul>`:`<p class="subtle">${scale.defined?'ما فيه مخاطر مسجّلة.':'عرّف المقياس أول، وبعدها سجّل أول خطر.'}</p>`}</section></section>`;
  },
  form(action,recordId,data){
    if(action==='define_scale'){
      guard(data.can_manage);
      const levelColumns=[{name:'value',label:'القيمة',type:'number',min:1,max:99},{name:'label',label:'اسم الدرجة'},{name:'description',label:'شرحها',required:false}];
      return {title:'تعريف مقياس المخاطر',endpoint:'/governance/risk-scale',fields:[
        field('likelihood','درجات الاحتمال','rows',{columns:levelColumns,value:data.scale.likelihood,minRows:1,maxRows:20,hint:'أنت من يعرّف المقياس. المنصة لا تفترض 1–5 ولا أي مصفوفة جاهزة.'}),
        field('impact','درجات الأثر','rows',{columns:levelColumns,value:data.scale.impact,minRows:1,maxRows:20}),
        field('bands','نطاقات الدرجة','rows',{required:false,columns:[{name:'label',label:'اسم النطاق',required:false},{name:'min_score',label:'من درجة',type:'number',min:1,required:false},{name:'max_score',label:'إلى درجة',type:'number',min:1,required:false}],value:data.scale.bands,minRows:0,maxRows:10,
          hint:'الدرجة = الاحتمال × الأثر. النطاق اسم تعطيه أنت لمدى من الدرجات، اختياري. درجة مستعملة في خطر مسجل لا تُسحب ولا يتغير معناها.'})],
        toPayload:v=>({likelihood:v.likelihood.map(r=>({value:r.value,label:r.label,description:r.description||''})),
          impact:v.impact.map(r=>({value:r.value,label:r.label,description:r.description||''})),
          bands:(v.bands||[]).map(r=>({label:r.label,min_score:r.min_score,max_score:r.max_score}))})};
    }
    if(action==='create_risk'){
      guard(data.can_manage&&data.scale.defined);
      return {title:'خطر جديد',endpoint:'/governance/risks',idempotent:true,fields:riskFields(data,null),toPayload:riskPayload};
    }
    const risk=data.risks.find(r=>r.id===recordId);
    guard(risk&&risk.actions.includes(action));
    if(action==='edit_risk')return {title:`تعديل — ${risk.title}`,endpoint:`/governance/risks/${recordId}/edit_risk`,fields:riskFields(data,risk),
      toPayload:v=>({version:risk.version,...riskPayload(v)})};
    if(action==='review_risk')return {title:`مراجعة دورية — ${risk.title}`,endpoint:`/governance/risks/${recordId}/review_risk`,fields:[
      field('note','خلاصة المراجعة','textarea',{hint:'ما الذي تغير منذ آخر مراجعة، وهل ما زالت الضوابط والخطة صالحة.'}),
      field('likelihood_value','الاحتمال بعد المراجعة','select',{value:String(risk.likelihood_value),options:data.scale.likelihood.map(l=>({value:String(l.value),label:`${l.value} — ${l.label}`}))}),
      field('impact_value','الأثر بعد المراجعة','select',{value:String(risk.impact_value),options:data.scale.impact.map(l=>({value:String(l.value),label:`${l.value} — ${l.label}`}))}),
      field('next_review_on','المراجعة التالية','date',{hint:'إلزامية: الخطر الذي يتجاوز تاريخ مراجعته يظهر متأخرًا ويدخل «عملي».'})],
      toPayload:v=>({version:risk.version,note:v.note,likelihood_value:Number(v.likelihood_value),impact_value:Number(v.impact_value),next_review_on:v.next_review_on})};
    if(action==='accept_risk')return {title:`اعتماد قبول الخطر — ${risk.title}`,endpoint:`/governance/risks/${recordId}/accept_risk`,fields:[
      field('reason','سبب قبول الخطر','textarea',{hint:'يُسجل باسمك. مالك الخطر لا يقبل خطره بنفسه، والقبول لا ينفذ إلا باعتماد من هو أعلى منه في الهيكل.'})],
      toPayload:v=>({version:risk.version,reason:v.reason})};
    return {title:`إقفال — ${risk.title}`,endpoint:`/governance/risks/${recordId}/close_risk`,fields:[
      field('closure_note','سبب الإقفال','textarea',{hint:'الخطر المقفل لا يُفتح مرة أخرى؛ ما يعود منه يُسجل خطرًا جديدًا. مالك الخطر لا يقفل خطره بنفسه.'})],
      toPayload:v=>({version:risk.version,closure_note:v.closure_note})};
  }
};
function riskFields(data,risk){
  const links=[{value:'',label:'— بلا ارتباط —'},...Object.entries(data.link_types).flatMap(([type,label])=>(data.links[type]??[]).map(x=>({value:`${type}:${x.id}`,label:`${label}: ${x.title}`})))];
  return [field('title','الخطر','text',{value:risk?.title??''}),
    field('description','وصف الخطر','textarea',{value:risk?.description??''}),
    field('category','الفئة','text',{value:risk?.category??'',hint:'تصنيف تختاره أنت: تشغيلي، مالي، سمعة، امتثال، تقني…'}),
    field('owner_id','مالك الخطر','select',{value:risk?.owner_id??'',options:peopleOptions(data)}),
    field('likelihood_value','الاحتمال','select',{value:risk?String(risk.likelihood_value):'',options:data.scale.likelihood.map(l=>({value:String(l.value),label:`${l.value} — ${l.label}`}))}),
    field('impact_value','الأثر','select',{value:risk?String(risk.impact_value):'',options:data.scale.impact.map(l=>({value:String(l.value),label:`${l.value} — ${l.label}`}))}),
    field('response','الاستجابة','select',{value:risk?.response==='accept'?'accept_proposed':risk?.response??'',options:options(data.responses,['avoid','reduce','transfer','accept_proposed']),
      hint:'القبول يُقترح هنا ولا ينفذ إلا باعتماد من هو أعلى من المالك. غير القبول يلزمه خطة معالجة بمالك وموعد.'}),
    field('existing_controls','الضوابط القائمة','textarea',{required:false,value:risk?.existing_controls??''}),
    field('treatment_plan','خطة المعالجة','textarea',{required:false,value:risk?.treatment_plan??'',hint:'مطلوبة لكل استجابة عدا القبول.'}),
    field('treatment_owner_id','مالك المعالجة','select',{required:false,value:risk?.treatment_owner_id??'',options:[{value:'',label:'— للقبول فقط —'},...peopleOptions(data)]}),
    field('treatment_due','موعد المعالجة','date',{required:false,value:risk?.treatment_due??''}),
    field('next_review_on','المراجعة التالية','date',{value:risk?.next_review_on??'',hint:'إلزامية لكل خطر.'}),
    field('link','ارتباط الخطر','select',{required:false,value:risk?.link_type?`${risk.link_type}:${risk.link_id}`:'',options:links})];
}
function riskPayload(v){
  const [linkType='',linkId='']=(v.link||'').split(':');
  return {title:v.title,description:v.description,category:v.category,owner_id:v.owner_id,
    likelihood_value:Number(v.likelihood_value),impact_value:Number(v.impact_value),response:v.response,
    existing_controls:v.existing_controls||'',treatment_plan:v.treatment_plan||'',
    treatment_owner_id:v.treatment_owner_id||null,treatment_due:v.treatment_due||null,
    next_review_on:v.next_review_on,link_type:linkType||null,link_id:linkType?linkId:null};
}

// ================= ج. سجل القرارات والالتزامات =================
const decisionLabels={record_decision:'تسجيل قرار',create_minute:'محضر جديد',reverse_decision:'العدول عنه بقرار جديد',
  add_commitment:'التزام ناشئ',edit_minute:'تعديل المسودة',approve_minute:'اعتماد المحضر',record_execution:'توثيق الإنجاز',cancel_commitment:'إلغاء الالتزام'};
export const decisionsUI={
  title:'القرارات والالتزامات',
  description:'قرار بسياقه وبدائله ومن اتخذه وأثره مثل ما كتبه، ما يتعدّل أبدًا والعدول عنه قرار جديد يشير له؛ ومحاضر اجتماعات بحاضرين وبنود؛ والتزامات تنشأ منها بمالك وموعد ودليل إغلاق.',
  load:api=>api('/governance/decisions'),
  render(data,{e,button}){
    const c=data.counters;
    const head=`<section class="panel panel-body vn-head"><p>${e(data.note)}</p>
      ${data.can_record?`<div class="operation-actions">${button('record_decision','',decisionLabels.record_decision)}${button('create_minute','',decisionLabels.create_minute)}</div>`:'<p class="subtle">تصريح السجل مو ممنوح لحسابك؛ تظهر لك التزاماتك والمحاضر اللي حضرتها بس.</p>'}</section>`;
    const tiles=`<div class="vn-tiles">${tile(e,c.decisions,'قرارات مسجلة')}${tile(e,c.reversed,'عُدل عنها بقرار لاحق')}${tile(e,c.minutes,'محاضر')}${tile(e,c.draft_minutes,'محاضر مسودة',c.draft_minutes?'is-due':'')}${tile(e,c.open,'التزامات مفتوحة')}${tile(e,c.late,'فات موعدها',c.late?'is-late':'')}${tile(e,c.done,'منجزة بدليل','is-ok')}</div>`;
    const decisions=data.decisions.map(d=>`<li class="${d.reversed_by?'is-old':''}"><strong>${e(d.title)}</strong>
      <span>${e(dual(d.decided_on))} · اتخذه ${e(d.decided_by_name)}${d.reference?` · <bdi>${e(d.reference)}</bdi>`:''}${d.minute_title?` · محضر: ${e(d.minute_title)}`:''}</span>
      <small>السياق: ${e(d.context)}</small><small>البدائل: ${e(d.alternatives)}</small><small>القرار: ${e(d.decision)}</small><small>الأثر كما كتبه متخذه: ${e(d.impact)}</small>
      ${d.reverses_title?`<small>عدول عن: ${e(d.reverses_title)} — ${e(d.reversal_reason)}</small>`:''}
      ${d.reversed_by?`<small class="badge superseded">عُدل عنه بقرار «${e(d.reversed_by.title)}» في ${e(dual(d.reversed_by.decided_on))}</small>`:''}
      ${d.actions.length?`<div class="operation-actions">${d.actions.map(a=>button(a,d.id,decisionLabels[a])).join('')}</div>`:''}</li>`).join('');
    const minutes=data.minutes.map(m=>`<li class="${m.status==='draft'?'is-due':''}"><strong>${e(m.title)}</strong>
      <span>${e(dual(m.meeting_date))}${m.location?` · ${e(m.location)}`:''} · ${e(m.status_name)}${m.approved_by_name?'':` · أعدّه ${e(m.prepared_by_name)}، ويعتمده غيره`}</span>
      <small>الحاضرون: ${e(m.attendees.map(a=>`${a.name} (${a.attendance_name})`).join('، '))}</small>
      <small>البنود: ${e(m.items.map(i=>`${i.position}. ${i.title}`).join(' · '))}</small>
      ${m.actions.length?`<div class="operation-actions">${m.actions.map(a=>button(a,m.id,decisionLabels[a])).join('')}</div>`:''}</li>`).join('');
    const commitments=data.commitments.map(x=>`<li class="${x.status!=='open'?'is-old':x.late?'is-late':''}"><strong>${e(x.title)}</strong>
      <span>المالك ${e(x.owner_name)} · الموعد ${e(dual(x.due_date))} · ${e(x.status_name)}${x.late?' · فات موعده':''} · من: ${e(x.source_title)}</span>
      ${x.detail?`<small>${e(x.detail)}</small>`:''}${x.closure_evidence?`<small>${x.status==='done'?'دليل الإغلاق':'سبب الإلغاء'}: ${e(x.closure_evidence)}</small>`:''}
      ${x.actions.length?`<div class="operation-actions">${x.actions.map(a=>button(a,x.id,decisionLabels[a])).join('')}</div>`:''}</li>`).join('');
    const block=(heading,list,empty)=>`<section class="vn-block"><h2>${e(heading)}</h2>${list?`<ul class="vn-list">${list}</ul>`:`<p class="subtle">${e(empty)}</p>`}</section>`;
    return head+`<section class="vn-board">${tiles}
      ${block('الالتزامات',commitments,'ما فيه التزامات.')}
      ${block('القرارات',decisions,data.can_view?'ما فيه قرارات مسجّلة.':'سجل القرارات مو متاح لحسابك.')}
      ${block('محاضر الاجتماعات',minutes,'ما فيه محاضر.')}</section>`;
  },
  form(action,recordId,data){
    if(action==='record_decision'||action==='reverse_decision'){
      const reversed=action==='reverse_decision'?data.decisions.find(d=>d.id===recordId):null;
      guard(data.can_record&&(action==='record_decision'||reversed?.actions.includes('reverse_decision')));
      return {title:reversed?`العدول عن — ${reversed.title}`:'تسجيل قرار',endpoint:'/governance/decisions',idempotent:true,fields:[
        field('title','عنوان القرار'),field('context','السياق','textarea',{hint:'ما الذي استدعى القرار.'}),
        field('alternatives','البدائل التي نُظر فيها','textarea',{hint:'اكتب ما نُظر فيه فعلًا ولم يُختر، لا ما اختير فقط.'}),
        field('decision','نص القرار','textarea'),
        field('decided_by','من اتخذه','select',{options:peopleOptions(data)}),
        field('decided_on','متى','date'),
        field('impact','الأثر كما تراه وقت القرار','textarea',{hint:'المنصة لا تقيس الأثر المتحقق؛ هذا نصك أنت ويبقى كما كتبته.'}),
        field('reference','مرجع القرار','text',{required:false}),
        field('minute_id','محضر الاجتماع','select',{required:false,options:[{value:'',label:'— بلا محضر —'},...data.minutes.map(m=>({value:m.id,label:`${m.meeting_date} — ${m.title}`}))]}),
        ...(reversed?[field('reversal_reason','سبب العدول','textarea',{hint:'القرار الأول يبقى في السجل كما هو ويشير إليه هذا القرار.'})]:[])],
        toPayload:v=>({title:v.title,context:v.context,alternatives:v.alternatives,decision:v.decision,decided_by:v.decided_by,decided_on:v.decided_on,
          impact:v.impact,reference:v.reference||'',minute_id:v.minute_id||null,reverses_id:reversed?.id??null,reversal_reason:v.reversal_reason||''})};
    }
    if(action==='create_minute'||action==='edit_minute'){
      const minute=action==='edit_minute'?data.minutes.find(m=>m.id===recordId):null;
      guard(data.can_record&&(action==='create_minute'||minute?.actions.includes('edit_minute')));
      const fields=[field('title','عنوان المحضر','text',{value:minute?.title??''}),
        field('meeting_date','تاريخ الاجتماع','date',{value:minute?.meeting_date??''}),
        field('location','مكان الاجتماع','text',{required:false,value:minute?.location??''}),
        field('attendees','الحاضرون','rows',{minRows:1,maxRows:60,value:minute?.attendees??[],columns:[
          {name:'user_id',label:'الشخص',type:'select',options:peopleOptions(data)},
          {name:'attendance',label:'الحضور',type:'select',options:options(data.attendance)},
          {name:'note',label:'ملاحظة',required:false}]}),
        field('items','بنود المحضر','rows',{minRows:1,maxRows:60,value:minute?.items??[],columns:[{name:'title',label:'البند'},{name:'note',label:'التفصيل',required:false}],
          hint:'المحضر المعتمد لا يُعدَّل: راجع الحاضرين والبنود قبل طلب الاعتماد.'})];
      return {title:minute?`تعديل مسودة — ${minute.title}`:'محضر جديد',endpoint:minute?`/governance/minutes/${recordId}/edit_minute`:'/governance/minutes',idempotent:!minute,fields,
        toPayload:v=>({...(minute?{version:minute.version}:{}),title:v.title,meeting_date:v.meeting_date,location:v.location||'',
          attendees:v.attendees.map(a=>({user_id:a.user_id,attendance:a.attendance,note:a.note||''})),
          items:v.items.map(i=>({title:i.title,note:i.note||''}))})};
    }
    if(action==='approve_minute'){
      const minute=data.minutes.find(m=>m.id===recordId);guard(minute?.actions.includes('approve_minute'));
      return {title:`اعتماد — ${minute.title}`,endpoint:`/governance/minutes/${recordId}/approve_minute`,fields:[
        field('note','ما الذي راجعته في المحضر','textarea',{hint:'من أعدّ المحضر لا يعتمده. بعد الاعتماد لا يُعدَّل المحضر ولا حاضروه ولا بنوده.'})],
        toPayload:v=>({version:minute.version,note:v.note})};
    }
    if(action==='add_commitment'){
      const source=data.decisions.find(d=>d.id===recordId)??data.minutes.find(m=>m.id===recordId);
      guard(source?.actions.includes('add_commitment'));
      const fromDecision=data.decisions.some(d=>d.id===recordId);
      return {title:`التزام ناشئ عن — ${source.title}`,endpoint:'/governance/commitments',idempotent:true,fields:[
        field('title','الالتزام'),field('detail','تفصيل الالتزام','textarea',{required:false}),
        field('owner_id','مالك الالتزام','select',{options:peopleOptions(data)}),
        field('due_date','الموعد','date')],
        toPayload:v=>({decision_id:fromDecision?recordId:null,minute_id:fromDecision?null:recordId,title:v.title,detail:v.detail||'',owner_id:v.owner_id,due_date:v.due_date})};
    }
    const commitment=data.commitments.find(x=>x.id===recordId);
    guard(commitment&&commitment.actions.includes(action));
    return {title:`${decisionLabels[action]} — ${commitment.title}`,endpoint:`/governance/commitments/${recordId}/${action}`,fields:[
      field('closure_evidence',action==='record_execution'?'دليل الإغلاق':'سبب الإلغاء','textarea',
        {hint:action==='record_execution'?'ما الذي أُنجز وأين دليله. لا إغلاق بلا دليل.':'الالتزام الملغى يبقى في السجل بسبب إلغائه.'})],
      toPayload:v=>({version:commitment.version,closure_evidence:v.closure_evidence})};
  }
};
