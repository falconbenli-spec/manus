import { attachFiles, filesBlock, fileForm } from './files-ui.mjs';
// سجل موافقات العملاء: توثيق داخلي لموافقة وصلت خارج المنصة. العميل لا يدخل ولا يوقع هنا.
const field=(name,label,type='text',extra={})=>({name,label,type,...extra});
const actionLabels={add_evidence:'إرفاق مرجع الدليل',verify:'تحقق مستقل من الدليل',withdraw:'سحب السجل'};

export const approvalsUI={
  title:'سجل موافقات العملاء',description:'توثيق داخلي لقرار العميل مثل ما وصل: مين المفوّض، وعلى أي نسخة، وبأي دليل. مو توقيع إلكتروني، والعميل ما يدخل المنصة.',
  load:async api=>{const data=await api('/approvals');return attachFiles(api,data,'external_approval',data.records.map(r=>r.id));},
  // البلاطة من العدّة (ui.tile) لا نسخة محلية؛ HTML مطابقة لما كانت تكتبه النسخة بالحرف.
  render(data,{e,button,ui}){
    const canRecord=data.permissions.includes('approvals.record');
    const name=(list,key)=>list.find(x=>x.key===key)?.name??key;
    const project=id=>data.projects.find(p=>p.id===id)?.name??'—';
    const count=status=>data.records.filter(r=>r.status===status).length;
    const records=data.records.map(r=>`<details class="vn-card"><summary><span class="vn-code">v${e(r.output_revision)}</span><span class="vn-name"><strong>${e(r.output_title)}</strong><small>${e(project(r.project_id))} · ${e(name(data.decisions,r.decision))} · ${e(r.received_on)}</small></span><span class="vn-flags">${r.applies_to_current?'':'<span class="vn-flag is-block">لا يسري على النسخة الحالية</span>'}<span class="badge ${e(r.status)}">${e(r.status_name)}</span></span></summary>
      <div class="vn-body"><div class="vn-alert"><strong>${e(r.disclaimer)}</strong></div>
      <dl class="vn-facts"><div><dt>المفوض لدى العميل</dt><dd>${e(r.approver.name)} · ${e(r.approver.title)}</dd></div><div><dt>سند التفويض</dt><dd>${e(r.approver.authority_basis)}</dd></div><div><dt>وسيلة الورود</dt><dd>${e(name(data.channels,r.channel))}</dd></div><div><dt>النسخة</dt><dd>الإصدار ${e(r.output_revision)} <bdi dir="ltr">${e(r.output_digest.slice(0,12))}</bdi></dd></div><div><dt>وثّقه</dt><dd>${e(r.recorded_by_name)} · ${e(r.recorded_at.slice(0,10))}</dd></div><div><dt>تحقق منه</dt><dd>${e(r.verified_by_name?`${r.verified_by_name} · ${r.verified_at.slice(0,10)}`:'ما تحقّق منه أحد للحين')}</dd></div></dl>
      <div class="vn-grid"><section class="vn-block"><h3>نطاق القرار وشروطه</h3><p>${e(r.scope_note)}</p></section><section class="vn-block"><h3>مرجع الدليل</h3><p>${e(r.evidence_reference||'ما انرفق مرجع للحين، والسجل ينتظر الدليل.')}</p>${r.verification_note?`<p class="subtle">ملاحظة التحقق: ${e(r.verification_note)}</p>`:''}${r.withdrawn_reason?`<p class="subtle">سبب السحب: ${e(r.withdrawn_reason)} — ${e(r.withdrawn_by_name)}</p>`:''}</section></div>
      ${filesBlock(data,r.id,{e,button})}
      <div class="operation-actions">${r.actions.map(a=>button(a,r.id,actionLabels[a])).join('')}</div></div></details>`).join('');
    const approvers=data.approvers.map(a=>`<li class="${a.active?'':'is-old'}"><strong>${e(a.name)} · ${e(a.title)}</strong><span>${e(project(a.project_id))} · من ${e(a.valid_from)}${a.revoked_on?` · سُحب ${e(a.revoked_on)}`:''}</span><small>${e(a.authority_scope)} — ${e(a.authority_basis)}</small>${a.active&&canRecord?`<div class="operation-actions">${button('revoke_approver',a.id,'سحب التفويض')}</div>`:''}</li>`).join('');
    return `<section class="panel panel-body vn-head"><p>القرار ينوثّق على نسخة اعتُمدت داخليًا بس، واللي وثّق ما يتحقق من توثيقه.</p><div class="operation-actions">${canRecord&&data.projects.length?button('register_approver','','تسجيل مفوض للعميل'):''}${canRecord&&data.outputs.length&&data.approvers.some(a=>a.active)?button('record_approval','','توثيق قرار عميل'):''}</div></section>
      <section class="vn-board"><div class="vn-tiles">${ui.tile(count('pending_evidence'),'بانتظار الدليل',count('pending_evidence')?'is-late':'')}${ui.tile(count('documented'),'موثق بانتظار التحقق',count('documented')?'is-due':'')}${ui.tile(count('verified'),'متحقق منه')}${ui.tile(data.outputs.filter(o=>o.current&&!data.records.some(r=>r.output_version_id===o.version_id&&r.status!=='withdrawn')).length,'نسخة معتمدة داخليًا بلا قرار عميل موثق')}</div></section>
      <section class="vn-group"><h2>القرارات الموثقة <span>${data.records.length}</span></h2>${records||'<section class="panel panel-body"><p class="subtle">ما فيه قرارات موثّقة في مشاريعك للحين.</p></section>'}</section>
      <section class="vn-group"><h2>المفوضون لدى العملاء <span>${data.approvers.length}</span></h2><section class="vn-block">${approvers?`<ul class="vn-list">${approvers}</ul>`:'<p class="subtle">ما فيه مفوّض مسجّل. سجّل المفوّض وسند تفويضه قبل توثيق أي قرار.</p>'}</section></section>`;
  },
  form(action,id,data){
    const canRecord=data.permissions.includes('approvals.record');
    if(action==='register_approver'){
      if(!canRecord)throw Error('الإجراء غير متاح. أعد تحميل الصفحة.');
      return {title:'تسجيل مفوض للعميل',endpoint:'/approvals/approvers',idempotent:true,fields:[field('project_id','المشروع أو الحساب','select',{options:data.projects.map(p=>({value:p.id,label:p.name}))}),field('name','اسم المفوض'),field('title','صفته لدى العميل'),field('authority_basis','سند التفويض','textarea',{hint:'مثال: بند في العقد، أو خطاب تفويض، مع مكان حفظه.'}),field('authority_scope','نطاق ما يحق له اعتماده','textarea'),field('valid_from','بداية التفويض','date')],toPayload:v=>v};
    }
    if(action==='revoke_approver'){
      const a=data.approvers.find(x=>x.id===id);if(!a||!a.active||!canRecord)throw Error('الإجراء غير متاح. أعد تحميل الصفحة.');
      return {title:`سحب تفويض — ${a.name}`,endpoint:`/approvals/approvers/${id}/revoke`,fields:[field('revoked_on','تاريخ السحب','date',{value:data.today}),field('reason','سبب السحب ومصدره','textarea')],toPayload:v=>v};
    }
    if(action==='record_approval'){
      if(!canRecord)throw Error('الإجراء غير متاح. أعد تحميل الصفحة.');
      return {title:'توثيق قرار عميل',endpoint:'/approvals',idempotent:true,fields:[
        field('output_version_id','المخرج والنسخة','select',{options:data.outputs.map(o=>({value:o.version_id,label:`${o.title} — الإصدار ${o.revision}${o.current?' (الحالي)':''} · ${o.studio_title}`}))}),
        field('approver_id','المفوض لدى العميل','select',{options:data.approvers.filter(a=>a.active).map(a=>({value:a.id,label:`${a.name} · ${a.title}`}))}),
        field('decision','القرار كما ورد','select',{options:data.decisions.map(d=>({value:d.key,label:d.name}))}),field('channel','وسيلة الورود','select',{options:data.channels.map(c=>({value:c.key,label:c.name}))}),
        field('received_on','تاريخ الورود','date',{value:data.today}),field('scope_note','نطاق القرار وشروطه بنص العميل','textarea'),
        field('evidence_reference','مرجع الدليل ومكان حفظه','textarea',{required:false,hint:'إن تُرك فارغًا يبقى السجل «بانتظار الدليل». القرار الهاتفي يحتاج تأكيدًا مكتوبًا.'})],toPayload:v=>v};
    }
    const r=data.records.find(x=>x.id===id);
    if(action==='upload_file'&&r&&data.files?.[id]?.can_upload)return fileForm('external_approval',id,r.output_title);
    if(!r||!r.actions.includes(action))throw Error('الإجراء غير متاح. أعد تحميل الصفحة.');
    const fields={add_evidence:[field('evidence_reference','مرجع الدليل ومكان حفظه','textarea')],verify:[field('note','ما الذي طابقته في الدليل؟','textarea',{hint:'المرسل، التاريخ، نص القرار، والنسخة المقصودة.'})],withdraw:[field('reason','سبب السحب','textarea')]}[action];
    return {title:`${actionLabels[action]} — ${r.output_title}`,endpoint:`/approvals/${id}/${action}`,fields,toPayload:v=>({...v,version:r.version})};
  }
};
