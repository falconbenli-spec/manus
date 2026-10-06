// إنهاء العلاقة مع العميل وإعادة فتحها (الحزمة 4، P4-CRM-7) داخل «العملاء»: ما بقي مفتوحًا وعند من، والسجل وقراره.
// ملف مستقل يستورده agency-ui.mjs في مواضع قليلة، فيبقى تحرير بطاقة العميل نفسها أقل ما يمكن.
import { kit } from './kit.mjs';
const field=(name,label,type='text',extra={})=>({name,label,type,...extra});
const guard=ok=>{if(!ok)throw Error('هالإجراء مو متاح لك الحين. حدّث الصفحة.');};
const LABELS={request_offboarding:'طلب إقفال الملف',request_reopening:'طلب إعادة فتح الملف',approve_offboarding:'اعتماد',reject_offboarding:'رفض',withdraw_offboarding:'سحب الطلب'};
const when=(e,iso)=>iso?`<time datetime="${e(iso)}">${e(String(new Date(Date.parse(iso)+3*3600000).toISOString()).slice(0,10))}</time>`:'—';
const retentionText=r=>r.source==='unset'?r.text:`الاحتفاظ: ${r.period} — ${r.reference}${r.basis?` (${r.basis})`:''}${r.disposal?` · بعدها: ${r.disposal}`:''}`;

// بطاقة السجل: رقمه ونوعه وحالته وسببه وقراره. أفعال الاعتماد في «بانتظار قراري» أعلى الشاشة، وهنا السحب لطالبه.
function recordItem(r,{e,button,ui}){
  const own=r.actions.filter(a=>a==='withdraw_offboarding');
  return `<li class="${r.status==='requested'?'is-due':'is-old'}" data-id="${e(r.id)}"><strong><bdi>${e(r.number)}</bdi> · ${e(r.kind_name)} · ${ui.statusBadge(r.canonical)} <small class="subtle">${e(r.status_name)}</small></strong>
    <span>طلبه ${e(r.requested_by_name)} ${when(e,r.requested_at)} · المعتمد ${e(r.approver_name)}${r.decided_at?` · انحسم ${when(e,r.decided_at)}`:''}</span>
    <small class="measure">${e(r.reason)}${r.assets_note?` — العلامات: ${e(r.assets_note)}`:''}${r.decision_note?` — القرار: ${e(r.decision_note)}`:''}</small>
    ${own.length?`<div class="operation-actions">${own.map(a=>button(a,r.id,LABELS[a])).join('')}</div>`:''}</li>`;
}
// لوحة الإقفال داخل بطاقة العميل.
export function offboardingSection(c,{e,button,ui=kit(e)}){
  const o=c.offboarding;
  if(!o)return '';
  const open=o.checklist.filter(i=>i.blocking),kept=o.checklist.filter(i=>!i.blocking&&i.count);
  const checklist=o.closed?'':`${open.length?`<p><strong>ما ينقفل الملف لين ينحسم:</strong></p><ul class="vn-list">${open.map(i=>`<li class="is-late"><strong>${e(i.title)} <span data-num>${e(i.count)}</span></strong><span>${e(i.why)} · عند: ${e(i.owner)}</span><small>${e(i.next)}</small></li>`).join('')}</ul>`
      :'<p class="subtle">ما بقي شي مفتوح يوقف الإقفال.</p>'}
    ${kept.length?`<ul class="vn-list">${kept.map(i=>`<li class="is-old"><strong>${e(i.title)} <span data-num>${e(i.count)}</span></strong><span>${e(i.why)}</span></li>`).join('')}</ul>`:''}`;
  return `<section class="vn-block"><h3>${o.closed?'الملف مقفل':'إنهاء العلاقة'}</h3>
    ${o.closed&&o.current?`<p>انقفل بالسجل <bdi>${e(o.current.number)}</bdi> ${when(e,o.current.decided_at)}.</p>`:''}
    ${o.actions.length?`<div class="operation-actions">${o.actions.map(a=>button(a,c.id,LABELS[a])).join('')}</div>`:''}
    ${checklist}
    <p class="subtle measure">${e(retentionText(o.retention))}</p>
    ${o.records.length?`<ul class="vn-list">${o.records.map(r=>recordItem(r,{e,button,ui})).join('')}</ul>`:''}</section>`;
}
// «بانتظار قراري» أعلى الشاشة: كل سجل سمّاني طالبه معتمدًا، ولو كان الملف مقفلًا وأنا خارج فريقه.
export function offboardingAwaitingSection(data,{e,button,ui=kit(e)}){
  const list=data.offboarding_awaiting??[];
  if(!list.length)return '';
  return `<section class="panel panel-body"><h2>بانتظار قراري <span data-num>${e(list.length)}</span></h2><ul class="vn-list">${list.map(r=>`<li class="is-decision" data-id="${e(r.id)}">
    <strong><bdi>${e(r.number)}</bdi> · ${e(r.kind_name)} · <bdi>${e(r.client.code)}</bdi> ${e(r.client.name)}</strong>
    <span>طلبه ${e(r.requested_by_name)} ${when(e,r.requested_at)}</span><small class="measure">${e(r.reason)}${r.assets_note?` — العلامات: ${e(r.assets_note)}`:''}</small>
    <div class="operation-actions">${r.actions.map(a=>button(a,r.id,LABELS[a])).join('')}</div></li>`).join('')}</ul></section>`;
}
const findRecord=(data,id)=>(data.offboarding_awaiting??[]).find(r=>r.id===id)??data.clients.flatMap(c=>c.offboarding?.records??[]).find(r=>r.id===id);
export const OFFBOARDING_ACTIONS=Object.keys(LABELS);
export function offboardingForm(action,id,data){
  if(action==='request_offboarding'||action==='request_reopening'){
    const c=data.clients.find(x=>x.id===id);guard(c&&c.offboarding?.actions.includes(action));
    const close=action==='request_offboarding',brands=c.offboarding.checklist.find(i=>i.key==='brand_assets')?.count??0;
    return {title:`${LABELS[action]} — ${c.code}`,endpoint:`/clients/${id}/offboarding`,idempotent:true,fields:[
      field('reason',close?'سبب إنهاء العلاقة':'سبب إعادة الفتح','textarea'),
      ...(close?[field('assets_note','وش صار بملفات علامات العميل وأدلة هويته','textarea',{required:brands>0,hint:brands?`للعميل ${brands} علامة عندنا: سُلّمت أو أُرشفت، وأين.`:'إذا ما عندنا ملفات له اتركها فاضية.'})]:[]),
      field('approver_id','المعتمد','select',{options:c.offboarding.approvers.map(p=>({value:p.id,label:p.name})),hint:close?'من فريق الحساب ويحمل تصريح ملفات العملاء، وغيرك.':'يحمل تصريح ملفات العملاء، وغيرك.'})],
      toPayload:v=>({kind:close?'close':'reopen',reason:v.reason,approver_id:v.approver_id,...(close&&v.assets_note?{assets_note:v.assets_note}:{})})};
  }
  const r=findRecord(data,id);guard(r&&r.actions.includes(action));
  return {title:`${LABELS[action]} — ${r.number}`,endpoint:`/client-offboardings/${id}/${action}`,fields:[
    field('note',action==='approve_offboarding'?'أساس الاعتماد: وش اطلعت عليه':action==='reject_offboarding'?'سبب الرفض':'سبب السحب','textarea',{required:action!=='withdraw_offboarding'})],
    toPayload:v=>({version:r.version,...(v.note?{note:v.note}:{})})};
}
