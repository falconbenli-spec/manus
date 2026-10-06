// «التفويض المالي»: منحه وسحبه من المنصة بدل إدراج SQL مباشر (تدقيق دورة التسليم 20260920، B4).
// التصريح يفتح الشاشة، والتفويض يفتح الفعل في الدفتر. لكل تفويض نهاية، ولا أحد يفوّض نفسه، والسحب لا يمحو.
// لا أنماط مضمنة ولا سكربت (سياسة CSP صارمة).
import { dual } from './dates.mjs';
import { roleName } from './vocabulary.mjs';
// البلاطة والحالة الفارغة من العدّة المشتركة (ctx.ui)؛ ومن يرسم الشاشة بلا صفحة (اختبار) يأخذ العدّة نفسها.
import { kit } from './kit.mjs';

const field=(name,label,type='text',extra={})=>({name,label,type,required:true,...extra});
const optional=(name,label,type='text',extra={})=>field(name,label,type,{required:false,...extra});
const guard=ok=>{if(!ok)throw Error('الإجراء غير متاح لك الحين. حدّث الصفحة وشوف حالته.');};
// الحالة شكلٌ وكلمة: الساري صامت، والذي يبدأ لاحقًا بشكل الانتظار، والمنتهي والمسحوب ساكنان.
const TONE={live:'',scheduled:'is-pending',expired:'is-old',revoked:'is-old'};
const day=(e,iso)=>`<time datetime="${e(iso)}">${e(dual(iso))}</time>`;

// سطر التفويض: الفعل، ثم سريانه ومدته الباقية، ثم دور صاحبه وسنده. الذي يبدأ لاحقًا بشكل الانتظار، والمنتهي والمسحوب ساكنان.
const grantRow=(e,button,{who=false}={})=>g=>`<li class="${TONE[g.state]??''}">
  <strong>${who?`${e(g.user_name)} — `:''}${e(g.action_name)}</strong>
  <span>${e(g.state_name)} · من ${day(e,g.valid_from)} لين ${day(e,g.valid_until)}${g.days_left!==null?` · باقي <span data-num>${e(g.days_left)}</span> يوم`:''}${g.revoked_at?` · انسحب في ${day(e,g.revoked_at.slice(0,10))}`:''}</span>
  <small class="measure">السند: ${e(g.evidence)}</small>
  ${g.state==='live'||g.state==='scheduled'?`<div class="operation-actions">${button('revoke_grant',g.id,'سحب التفويض')}</div>`:''}</li>`;

export const financeGrantsUI={
  title:'التفويض المالي',
  description:'مين يملك أي فعل في الدفتر المالي، ولين متى. التفويض غير التصريح: التصريح يفتح الشاشة، والتفويض يفتح الفعل. '
    +'لكل تفويض تاريخ نهاية، واللي يمنح ما يمنح نفسه، والسحب ينسجّل وما يمحي اللي مضى.',
  load:api=>api('/finance-grants'),
  render(data,{e,button,ui=kit(e)}){
    const live=data.grants.filter(g=>g.state==='live');
    const ended=data.grants.filter(g=>g.state==='expired'||g.state==='revoked');
    const scheduled=data.grants.filter(g=>g.state==='scheduled');
    const rows=(list,opts)=>list.map(grantRow(e,button,opts)).join('');
    // السارية تُقرأ شخصًا شخصًا: من يحمل أي فعل في الدفتر، وتحته كل تفويض بمدته وسنده وزر سحبه.
    const people=[...new Map(live.map(g=>[g.user_id,g])).values()].map(first=>({first,grants:live.filter(g=>g.user_id===first.user_id)}));
    const person=({first,grants})=>`<details class="vn-card"><summary><span class="vn-code"></span><span class="vn-name"><strong>${e(first.user_name)}</strong><small>${e(roleName(first.granted_role))} · <span data-num>${grants.length}</span> ${grants.length===1?'فعل':'أفعال'}: ${e(grants.map(g=>g.action_name).join('، '))}</small></span></summary><div class="vn-body"><ul class="vn-list">${rows(grants)}</ul></div></details>`;
    return `<section class="panel panel-body vn-head"><div class="operation-actions">${button('grant_finance','new','منح تفويض مالي')}</div><p>${e(data.note)}</p></section>
      <section class="vn-board"><div class="vn-tiles">
        ${ui.tile(live.length,'تفويض ساري',live.length?'':'is-late')}
        ${ui.tile(data.expiring.length,'ينتهي خلال 30 يوم',data.expiring.length?'is-due':'')}
        ${ui.tile(scheduled.length,'يبدأ لاحقًا')}
        ${ui.tile(ended.length,'منتهي أو مسحوب')}
      </div></section>
      ${live.length?'':'<div class="vn-alert is-block"><strong>ما فيه تفويض مالي ساري في هالكيان.</strong><p>ما أحد يقدر يصدر فاتورة ولا يعتمد دفعة ولا يرحّل قيد. ابدأ بتفويض «قراءة الدفتر»، فبدونه ما تنفتح أي شاشة مالية.</p></div>'}
      ${data.expiring.length?`<section class="vn-block"><div class="panel-head"><h2>تنتهي قريبًا <span data-num>(${data.expiring.length})</span></h2><p>التفويض ينتهي بنفسه في تاريخه. جدّده قبل يوم الإقفال، مو بعده.</p></div><ul class="vn-list">${rows(data.expiring,{who:true})}</ul></section>`:''}
      ${people.length?`<section class="vn-group"><h2>من يحمل تفويضًا ساريًا <span>${people.length}</span></h2>${people.map(person).join('')}</section>`:''}
      ${scheduled.length?`<section class="vn-block"><div class="panel-head"><h2>تبدأ لاحقًا <span data-num>(${scheduled.length})</span></h2></div><ul class="vn-list">${rows(scheduled,{who:true})}</ul></section>`:''}
      ${data.prepare_and_approve.length?`<div class="vn-alert"><strong>إعداد واعتماد في يد وحدة</strong><p class="measure">${e([...new Set(data.prepare_and_approve)].join('، '))}: معه الفعلين. فصل المهام مفروض على كل مستند بحاله — اللي يعدّ القيد ما يعتمده — فهذي ملاحظة للمراجع مو منع.</p></div>`:''}
      ${ended.length?`<details class="vn-block"><summary>المنتهية والمسحوبة (<span data-num>${ended.length}</span>)</summary><ul class="vn-list">${rows(ended,{who:true})}</ul></details>`:''}
      ${data.grants.length?'':ui.empty('ما فيه تفويض مالي مسجّل للحين','ابدأ من «منح تفويض مالي»: تفويض قراءة الدفتر أول، وبعده الإعداد والاعتماد والترحيل لأشخاص مختلفين.')}
      <section class="vn-block"><div class="panel-head"><h2>أفعال التفويض المالي</h2></div>
        <ul class="vn-list">${data.actions.map(a=>`<li><strong>${e(a.name)}</strong>${a.note?`<small>${e(a.note)}</small>`:''}</li>`).join('')}</ul></section>
      <section class="vn-block"><div class="panel-head"><h2>${e(data.role_constraint.title)}</h2></div>
        <p class="subtle measure">التفويض المالي لأدوار ${e(data.roles.map(role=>roleName(role)).join(' و'))} بس؛ فحساب بدور الموارد البشرية أو تقنية المعلومات ما ينفوّض ماليًا حتى لو عنده صلاحية، وتوسيع الأدوار قرار المالك.</p>
        ${data.blocked_accounts.length?`<p class="subtle">الحسابات اللي يمنعها القيد الحين: ${e(data.blocked_accounts.map(x=>`${x.name} (${roleName(x.role)})`).join('، '))}</p>`:''}</section>`;
  },
  form(action,id,data){
    if(action==='grant_finance')return {title:'منح تفويض مالي',endpoint:'/finance-grants',idempotent:true,submit:'امنح التفويض',
      fields:[field('user_id','الحساب','select',{options:data.people.filter(x=>x.id!==data.user_id).map(x=>({value:x.id,label:`${x.name} (${x.role})`})),
          hint:'التفويض المالي لأدوار موظف ومدير ومدير مشروع بس، وما تمنحه لنفسك.'}),
        field('action','الفعل','select',{options:data.actions.map(a=>({value:a.key,label:a.name}))}),
        field('valid_from','يبدأ في','date'),
        field('valid_until','ينتهي في','date',{hint:'لكل تفويض نهاية، وما ينقبل تاريخ فات.'}),
        field('evidence','سند التفويض','textarea',{minLength:10,maxLength:500,
          hint:'مين قرر هالتفويض ووين توثّق قراره. ينقرا في المراجعة الدورية للصلاحيات.'})],
      toPayload:v=>({user_id:v.user_id,action:v.action,valid_from:v.valid_from,valid_until:v.valid_until,evidence:v.evidence})};
    const g=data.grants.find(x=>x.id===id);
    guard(g&&(g.state==='live'||g.state==='scheduled'));
    return {title:`سحب تفويض — ${g.user_name} · ${g.action_name}`,endpoint:`/finance-grants/${id}/revoke`,submit:'اسحب التفويض',
      fields:[field('reason','سبب السحب','textarea',{minLength:10,maxLength:500,
        hint:'السحب يوقف الفعل من لحظته وما يمحي اللي مضى: القيود اللي انرحّلت تبقى باسم اللي رحّلها.'})],
      toPayload:v=>({reason:v.reason})};
  }
};
