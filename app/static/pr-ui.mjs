// العلاقات العامة: دليل جهات الإعلام (بيانات شخصية لأطراف خارجية)، القوائم، المراسلات، والتغطية.
// الشاشة تصرّح بحدودها: لا إرسال من المنصة، ولا رصد آلي، ولا قيمة إعلانية مكتسبة.
// البلاطة من العدّة المشتركة (ctx.ui)؛ ومن يرسم الشاشة بلا صفحة (اختبار) يأخذ العدّة نفسها.
import { kit } from './kit.mjs';
const field=(name,label,type='text',extra={})=>({name,label,type,...extra});
const guard=ok=>{if(!ok)throw Error('هالإجراء غير متاح لك الحين. حدّث الصفحة.');};
const yesNo=[{value:'no',label:'لا'},{value:'yes',label:'نعم'}];

const contactLabels={edit_contact:'تعديل البيانات',archive_contact:'أرشفة',restore_contact:'إعادة للنشاط'};
const contactRoutes={edit_contact:'edit',archive_contact:'archive',restore_contact:'restore'};
function contactFields(data,c){
  return [field('name','اسم الصحفي أو المحرر','text',{value:c?.name}),field('role_title','صفته','text',{required:false,value:c?.role_title}),
    field('outlet','الوسيلة','text',{value:c?.outlet}),field('outlet_type','نوع الوسيلة','select',{value:c?.outlet_type,options:data.outlet_types.map(x=>({value:x.key,label:x.name}))}),
    field('beats','مجالات تغطيته','rows',{value:c?.beats?.map(b=>({beat:b})),columns:[{name:'beat',label:'المجال'}],maxRows:8}),
    field('language','لغة التواصل','select',{value:c?.language,options:data.languages.map(x=>({value:x.key,label:x.name}))}),
    field('email','البريد','text',{required:false,value:c?.email,hint:'بيانات تواصل شخصية: ما تدخل أي تصدير عام ولا تنشارك برّا فريق العلاقات العامة.'}),
    field('phone','الهاتف','text',{required:false,value:c?.phone}),
    field('preferences','تفضيلاته في التواصل','textarea',{required:false,value:c?.preferences}),
    field('lawful_basis','أساس جمع البيانات','select',{value:c?.lawful_basis,options:data.lawful_bases.map(x=>({value:x.key,label:x.name}))}),
    field('basis_note','شرح الأساس','textarea',{value:c?.basis_note,hint:'يدخل سجل معالجة البيانات الشخصية؛ اكتبه بشكل يصح قدام صاحب البيانات.'}),
    field('collected_on','تاريخ الجمع','date',{value:c?.collected_on??data.today}),field('source','مصدر البيانات','text',{value:c?.source})];
}
const contactPayload=v=>({name:v.name,role_title:v.role_title||'',outlet:v.outlet,outlet_type:v.outlet_type,beats:(v.beats||[]).map(r=>r.beat).filter(Boolean),
  language:v.language,preferences:v.preferences||'',email:v.email||'',phone:v.phone||'',lawful_basis:v.lawful_basis,basis_note:v.basis_note,collected_on:v.collected_on,source:v.source});

export const mediaContactsUI={
  title:'جهات الإعلام',
  description:'دليل الصحفيين والمحررين ووسائلهم ومجالات تغطيتهم. بيانات شخصية لأطراف خارجية: لكل سجل أساس جمعه ومصدره وتاريخه، وما يطلع لغير صاحب صلاحية العلاقات العامة، ولا يدخل أي تصدير عام.',
  load:api=>api('/media-contacts'),
  render(data,{e,button,ui=kit(e)}){
    const active=data.contacts.filter(c=>c.status==='active');
    const row=c=>`<li class="${c.status==='archived'?'is-old':''}"><strong>${e(c.name)} — ${e(c.outlet)}</strong>
      <span>${e(c.outlet_type_name)} · ${e(c.language_name)} · ${e(c.beats.join('، '))}${c.role_title?` · ${e(c.role_title)}`:''}</span>
      <small>أساس الجمع: ${e(c.lawful_basis_name)} — ${e(c.basis_note)} · المصدر: ${e(c.source)} · بتاريخ ${e(c.collected_on)}</small>
      <small>${e(c.pitch_count)} مراسلة · ${e(c.coverage_count)} تغطية${c.last_pitch_on?` · آخر مراسلة ${e(c.last_pitch_on)}`:''}${c.preferences?` · تفضيلاته: ${e(c.preferences)}`:''}</small>
      ${c.email||c.phone?`<small class="subtle">${[c.email?`<bdi>${e(c.email)}</bdi>`:'',c.phone?`<bdi>${e(c.phone)}</bdi>`:''].filter(Boolean).join(' · ')}</small>`:''}
      ${c.actions.length?`<div class="operation-actions">${c.actions.map(a=>button(a,c.id,contactLabels[a])).join('')}</div>`:''}</li>`;
    return `<section class="panel panel-body vn-head"><p>${e(data.note)}</p>
      <div class="operation-actions">${button('create_contact','','تسجيل جهة إعلام')}</div></section>
      <section class="panel panel-body vn-board"><div class="vn-tiles">${ui.tile(active.length,'جهة نشطة')}${ui.tile(data.contacts.length-active.length,'مؤرشفة')}${ui.tile(new Set(active.map(c=>c.outlet)).size,'وسيلة')}</div>
      ${data.contacts.length?`<ul class="vn-list">${data.contacts.map(row).join('')}</ul>`:'<p class="subtle">ما فيه جهات مسجلة للحين.</p>'}</section>`;
  },
  form(action,id,data){
    if(action==='create_contact')return {title:'تسجيل جهة إعلام',endpoint:'/media-contacts',idempotent:true,fields:contactFields(data,null),toPayload:contactPayload};
    const c=data.contacts.find(x=>x.id===id);guard(c&&c.actions.includes(action));
    const spec=(fields,toPayload=v=>v)=>({title:`${contactLabels[action]} — ${c.name}`,endpoint:`/media-contacts/${id}/${contactRoutes[action]}`,fields,toPayload:v=>({version:c.version,...toPayload(v)})});
    if(action==='edit_contact')return spec(contactFields(data,c),contactPayload);
    return spec([field('note',action==='archive_contact'?'سبب الأرشفة':'سبب الإعادة','textarea')],v=>({note:v.note}));
  }
};

const pitchLabels={record_reply:'تسجيل رد',record_decline:'تسجيل اعتذار',record_published:'تسجيل نشر'};
const pitchRoutes={record_reply:'reply',record_decline:'decline',record_published:'published'};
const listLabels={add_member:'إضافة جهة',remove_member:'إزالة جهة',lock_list:'اعتماد القائمة وقفلها'};
const listRoutes={add_member:'add',remove_member:'remove',lock_list:'lock'};
const optional=(list,empty)=>[{value:'',label:empty},...list.map(x=>({value:x.id,label:x.name}))];
function coverageFields(data,c){
  return [field('outlet','الوسيلة','text',{value:c?.outlet}),field('outlet_type','نوعها','select',{value:c?.outlet_type,options:data.outlet_types.map(x=>({value:x.key,label:x.name}))}),
    field('title','عنوان التغطية','text',{value:c?.title}),field('url','الرابط','text',{value:c?.url,maxLength:600,hint:'الرابط فريد: التغطية الوحدة ما تنحسب مرتين.'}),
    field('published_on','تاريخ النشر','date',{value:c?.published_on??data.today}),
    field('tone','النبرة','select',{value:c?.tone,options:Object.entries(data.tones).map(([value,label])=>({value,label}))}),
    field('tone_reason','ليش قدّرتها كذا','textarea',{value:c?.tone_reason,hint:'تقدير بشري ينكتب باسمك.'}),
    field('highlight','من أبرز التغطيات','select',{value:c?.highlight?'yes':'no',options:yesNo}),
    field('highlight_reason','ليش هي من الأبرز','textarea',{required:false,value:c?.highlight_reason}),
    field('summary','خلاصة ما ورد','textarea',{required:false,value:c?.summary}),
    field('client_id','العميل','select',{required:false,value:c?.client_id??'',options:optional(data.clients,'بدون عميل')}),
    field('campaign_id','الحملة','select',{required:false,value:c?.campaign_id??'',options:optional(data.campaigns,'خارج الحملات')})];
}
const coveragePayload=v=>({outlet:v.outlet,outlet_type:v.outlet_type,title:v.title,url:v.url,published_on:v.published_on,tone:v.tone,tone_reason:v.tone_reason,
  highlight:v.highlight==='yes',highlight_reason:v.highlight==='yes'?v.highlight_reason||'':'',summary:v.summary||'',client_id:v.client_id||'',campaign_id:v.campaign_id||''});

export const prUI={
  title:'العلاقات العامة',
  description:'مراسلات تنرسل يدويًا برّا المنصة وتنسجل هنا بحالتها، وتغطية يدخلها إنسان بنبرة يقدرها هو، وتقرير عدّ وتوزيع بدون قيمة إعلانية مكتسبة ولا حصة صوت.',
  load:api=>api('/pr'),
  render(data,{e,button,ui=kit(e)}){
    const r=data.report;
    const bar=(actions,id,labels)=>actions.length?`<div class="operation-actions">${actions.map(a=>button(a,id,labels[a])).join('')}</div>`:'';
    const list=l=>`<li class="${l.status==='locked'?'is-old':l.actions.includes('lock_list')?'is-decision':''}"><strong>${e(l.name)}</strong><span>${e(l.status_name)} · ${e(l.members.length)} جهة</span>
      <small>${e(l.purpose)}${l.lock_note?` — ${e(l.lock_note)}`:''}</small>
      <small class="subtle">${e(l.members.map(m=>`${m.name} (${m.outlet})`).join('، '))||'ما فيه جهات للحين.'}</small>
      ${bar(l.actions,l.id,listLabels)}</li>`;
    const pitch=p=>`<li><strong>${e(p.subject)} — ${e(p.contact_name)} (${e(p.outlet)})</strong>
      <span>${e(p.status_name)} · انرسلت ${e(p.sent_on)} عن طريق ${e(p.sent_via)}${p.outcome_on?` · النتيجة ${e(p.outcome_on)}`:''}</span>
      <small>${e(p.angle)}${p.outcome_note?` — ${e(p.outcome_note)}`:''}</small>
      ${bar(p.actions,p.id,pitchLabels)}</li>`;
    const cover=c=>`<li class="${c.highlight?'is-ok':''}"><strong>${e(c.title)} — ${e(c.outlet)}</strong>
      <span>${e(c.outlet_type_name)} · ${e(c.published_on)} · نبرة ${e(c.tone_name)} بتقدير ${e(c.recorded_by_name)}${c.client_name?` · ${e(c.client_name)}`:''}${c.campaign_name?` · ${e(c.campaign_name)}`:''}</span>
      <small>${e(c.tone_reason)}${c.highlight?` — من الأبرز: ${e(c.highlight_reason)}`:''}</small>
      <small class="subtle"><bdi dir="ltr">${e(c.url)}</bdi></small>
      <div class="operation-actions">${button('edit_coverage',c.id,'تصحيح التغطية')}</div></li>`;
    return `<section class="panel panel-body vn-head"><p>${e(data.note)}</p>
      <div class="operation-actions">${button('create_list','','قائمة إعلامية')}${data.contacts.length?button('create_pitch','','تسجيل مراسلة انرسلت'):''}${button('create_coverage','','تسجيل تغطية')}</div></section>
      <section class="panel panel-body vn-board"><div class="vn-tiles">${ui.tile(r.total,'تغطية مسجلة')}${ui.tile(r.pitches.sent,'مراسلة')}${ui.tile(r.pitches.published,'مراسلة جابت نشر')}${ui.tile(r.highlights.length,'أبرز التغطيات')}</div>
      <div class="vn-block"><h3>توزيع التغطية</h3><dl class="detail-data">
        <div><dt>حسب الوسيلة</dt><dd>${e(r.by_outlet.map(x=>`${x.name}: ${x.count}`).join(' · '))||'—'}</dd></div>
        <div><dt>حسب نوع الوسيلة</dt><dd>${e(r.by_type.map(x=>`${x.name}: ${x.count}`).join(' · '))||'—'}</dd></div>
        <div><dt>حسب النبرة</dt><dd>${e(r.by_tone.map(x=>`${x.name}: ${x.count}`).join(' · '))||'—'}</dd></div>
        <div><dt>حسب الشهر</dt><dd>${e(r.by_month.map(x=>`${x.key}: ${x.count}`).join(' · '))||'—'}</dd></div></dl>
      <p class="subtle">${e(r.note)}</p></div></section>
      <section class="panel panel-body vn-block"><h3>القوائم الإعلامية</h3>${data.lists.length?`<ul class="vn-list">${data.lists.map(list).join('')}</ul>`:'<p class="subtle">ما فيه قوائم للحين.</p>'}</section>
      <section class="panel panel-body vn-block"><h3>المراسلات</h3><p class="subtle">الإرسال يدوي برّا المنصة؛ هنا سجل اللي صار مو صندوق بريد.</p>${data.pitches.length?`<ul class="vn-list">${data.pitches.map(pitch).join('')}</ul>`:'<p class="subtle">ما فيه مراسلات مسجلة.</p>'}</section>
      <section class="panel panel-body vn-block"><h3>التغطية</h3>${data.coverage.length?`<ul class="vn-list">${data.coverage.map(cover).join('')}</ul>`:'<p class="subtle">ما فيه تغطية مسجلة.</p>'}</section>`;
  },
  form(action,id,data){
    if(action==='create_list')return {title:'قائمة إعلامية',endpoint:'/pr/lists',idempotent:true,fields:[field('name','اسم القائمة'),field('purpose','الغرض منها','textarea'),
      field('client_id','العميل','select',{required:false,options:optional(data.clients,'بدون عميل')}),field('campaign_id','الحملة','select',{required:false,options:optional(data.campaigns,'خارج الحملات')})],
      toPayload:v=>({name:v.name,purpose:v.purpose,client_id:v.client_id||'',campaign_id:v.campaign_id||''})};
    if(action==='create_pitch'){guard(data.contacts.length);return {title:'تسجيل مراسلة انرسلت',endpoint:'/pr/pitches',idempotent:true,fields:[
      field('contact_id','الجهة','select',{options:data.contacts.map(c=>({value:c.id,label:`${c.name} — ${c.outlet}`}))}),
      field('subject','الموضوع'),field('angle','الزاوية المطروحة','textarea'),field('sent_on','تاريخ الإرسال','date',{value:data.today}),
      field('sent_via','كيف انرسلت','text',{hint:'بريد الموظف أو رسالة أو لقاء.'}),
      field('list_id','من قائمة','select',{required:false,options:optional(data.lists.map(l=>({id:l.id,name:l.name})),'بدون قائمة')}),
      field('client_id','العميل','select',{required:false,options:optional(data.clients,'بدون عميل')}),field('campaign_id','الحملة','select',{required:false,options:optional(data.campaigns,'خارج الحملات')})],
      toPayload:v=>({contact_id:v.contact_id,list_id:v.list_id||'',client_id:v.client_id||'',campaign_id:v.campaign_id||'',subject:v.subject,angle:v.angle,sent_on:v.sent_on,sent_via:v.sent_via})};}
    if(action==='create_coverage')return {title:'تسجيل تغطية',endpoint:'/pr/coverage',idempotent:true,
      fields:[field('pitch_id','من مراسلة','select',{required:false,options:optional(data.pitches.map(p=>({id:p.id,name:`${p.subject} — ${p.contact_name}`})),'تغطية بدون مراسلة سابقة')}),...coverageFields(data,null)],
      toPayload:v=>({pitch_id:v.pitch_id||'',contact_id:'',...coveragePayload(v)})};
    if(action==='edit_coverage'){const c=data.coverage.find(x=>x.id===id);guard(c);
      return {title:`تصحيح — ${c.title}`,endpoint:`/pr/coverage/${id}/edit`,fields:coverageFields(data,c),toPayload:v=>({version:c.version,...coveragePayload(v)})};}
    const l=data.lists.find(x=>x.id===id);
    if(l&&Object.hasOwn(listLabels,action)){
      guard(l.actions.includes(action));
      const spec=(fields,toPayload=v=>v)=>({title:`${listLabels[action]} — ${l.name}`,endpoint:`/pr/lists/${id}/${listRoutes[action]}`,fields,toPayload:v=>({version:l.version,...toPayload(v)})});
      if(action==='add_member'){
        const available=data.contacts.filter(c=>!l.members.some(m=>m.contact_id===c.id));guard(available.length);
        return spec([field('contact_id','الجهة','select',{options:available.map(c=>({value:c.id,label:`${c.name} — ${c.outlet}`}))}),field('note','سبب اختياره','text',{required:false})],v=>({contact_id:v.contact_id,note:v.note||''}));
      }
      if(action==='remove_member')return spec([field('contact_id','الجهة','select',{options:l.members.map(m=>({value:m.contact_id,label:`${m.name} — ${m.outlet}`}))})],v=>({contact_id:v.contact_id}));
      return spec([field('note','أساس اعتماد القائمة','textarea',{hint:'اللي أعدّ القائمة ما يقفلها. والقائمة المقفلة تنستبدل بقائمة جديدة وما تتعدل.'})],v=>({note:v.note}));
    }
    const p=data.pitches.find(x=>x.id===id);guard(p&&p.actions.includes(action));
    return {title:`${pitchLabels[action]} — ${p.subject}`,endpoint:`/pr/pitches/${id}/${pitchRoutes[action]}`,
      fields:[field('outcome_on','تاريخ اللي صار','date',{value:data.today}),field('note','وش صار بالضبط','textarea')],
      toPayload:v=>({version:p.version,outcome_on:v.outcome_on,note:v.note})};
  }
};
