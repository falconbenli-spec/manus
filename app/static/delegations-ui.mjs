// حالة التفويض بكلمة وشكل (لا لون وحده): الساري، وما لم يبدأ، وما انتهت مدته، وما توقف أثره داخل مدته (تغيّر دور أو إدارة).
// والملغى عبارته من القاموس الواحد (ui.statusBadge('cancelled')).
const STATE={active:['active','ساري'],upcoming:['scheduled','ما بدأ للحين'],ended:['ended','انتهت مدته'],inactive:['inactive','مو ساري الحين']};
const stateOf=(r,now=Date.now())=>r.revoked_at?'revoked':r.effective?'active':Date.parse(r.starts_at)>now?'upcoming':Date.parse(r.ends_at)<=now?'ended':'inactive';
export const delegationsUI={
  title:'التفويض المؤقت',description:'فوّض اعتماد خدمة معيّنة لبديل من دورك وإدارتك لمدة محددة، والقرار يبيّن الأصل والبديل.',
  load:api=>api('/delegations'),
  render(data,{e,button,ui}){
    const canCreate=data.candidates.length&&data.services.length,serviceName=code=>data.services.find(s=>s.code===code)?.name??'';
    const intro=`<section class="panel panel-body"><p class="measure">التفويض يمشي على خطوات اعتماد الطلبات الداخلية بس، والمسارات التخصصية لها معتمدينها المحددين.</p>${canCreate?`<div class="operation-actions">${button('create','','تفويض جديد')}</div>`:'<p class="subtle">ما عندك بديل نشط من دورك وإدارتك تقدر تفوّضه الحين.</p>'}</section>`;
    // القائمة: ما فوّضته أنا وما فُوِّض إليّ. فارغةً تقول متى تمتلئ.
    if(!data.records.length)return intro+ui.empty('ما فيه تفويضات منك أو لك للحين',canCreate?'إذا بتغيب، فوّض اعتماد خدمة لبديل من «تفويض جديد»، ويطلع هنا بمدته وحالته.':'إذا فوّضك زميل من دورك وإدارتك، يطلع التفويض هنا بمدته وحالته.');
    return intro+data.records.map(r=>{
      const state=stateOf(r),name=serviceName(r.service_code);
      const badge=state==='revoked'?ui.statusBadge('cancelled'):`<span class="badge ${STATE[state][0]}">${STATE[state][1]}</span>`;
      // السهم يحمل معنى «إلى» بين الاسمين: يُخفى عن القارئ الآلي وتُقال الكلمة بدله.
      return `<article class="panel"><div class="panel-head"><h2><bdi>${e(r.service_code)}</bdi>${name?` · ${e(name)}`:''}</h2>${badge}</div><div class="panel-body"><p>${e(r.grantor_name)} <span aria-hidden="true">←</span><span class="sr-only">إلى</span> ${e(r.delegate_name)}</p><p class="measure">${e(r.reason)}</p><dl class="detail-data"><div><dt>البداية بتوقيت الرياض</dt><dd><time datetime="${e(r.starts_at)}">${e(formatDate(r.starts_at))}</time></dd></div><div><dt>النهاية بتوقيت الرياض</dt><dd><time datetime="${e(r.ends_at)}">${e(formatDate(r.ends_at))}</time></dd></div></dl>${r.revocation_reason?`<p>سبب الإلغاء: ${e(r.revocation_reason)}</p>`:''}${r.can_revoke?`<div class="operation-actions">${button('revoke',r.id,'إلغاء التفويض')}</div>`:''}</div></article>`;
    }).join('');
  },
  form(action,id,data){
    if(action==='create')return {title:'تفويض اعتماد مؤقت',endpoint:'/delegations',idempotent:true,fields:[
      {name:'delegate_id',label:'المعتمد البديل',type:'select',options:data.candidates.map(c=>({value:c.id,label:c.name}))},
      {name:'service_code',label:'الخدمة',type:'select',options:data.services.map(c=>({value:c.code,label:c.name}))},
      {name:'starts_at',label:'البداية بتوقيت الرياض',type:'datetime-local'},
      {name:'ends_at',label:'النهاية بتوقيت الرياض',type:'datetime-local'},
      {name:'reason',label:'سبب التفويض',type:'textarea'}
    ],toPayload:values=>({...values,starts_at:new Date(values.starts_at+':00+03:00').toISOString(),ends_at:new Date(values.ends_at+':00+03:00').toISOString()})};
    const record=data.records.find(r=>r.id===id);if(!record||!record.can_revoke)throw Error('إلغاء التفويض مو متاح لك الحين. حدّث الصفحة وشوف حالته.');
    return {title:'إلغاء التفويض',endpoint:`/delegations/${id}/revoke`,fields:[{name:'note',label:'سبب الإلغاء',type:'textarea'}],toPayload:values=>({...values,version:record.version})};
  }
};
// أرقام 0–9 كبقية المنصة (app.mjs: dateTime بـnu-latn)، والقيمة الآلية الكاملة في datetime.
function formatDate(value){return new Intl.DateTimeFormat('ar-SA-u-ca-gregory-nu-latn',{dateStyle:'medium',timeStyle:'short',timeZone:'Asia/Riyadh'}).format(new Date(value));}
