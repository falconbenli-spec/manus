// الإنتاج والتصوير وأوراق الاستدعاء. الشاشة تصرّح بحدودها: لا خرائط ولا طقس آليان، ولا رابط مشاركة لمن لا حساب له،
// ولا توقيع إلكتروني على تصريح استخدام الصورة، ولا أجر موظف داخلي ولا تكلفته في أي موضع من هذه الشاشة.
// البلاطة والجدول والحالة الفارغة من العدّة المشتركة (ctx.ui)؛ ومن يرسم الشاشة بلا صفحة (اختبار) يأخذ العدّة نفسها.
import { kit } from './kit.mjs';
const field=(name,label,type='text',extra={})=>({name,label,type,...extra});
const guard=ok=>{if(!ok)throw Error('هالإجراء غير متاح لك الحين. حدّث الصفحة.');};
const options=(list,key='key',name='name')=>list.map(x=>({value:x[key],label:x[name]}));
const blank=(list,empty)=>[{value:'',label:empty},...list];

const productionLabels={edit_production:'تعديل الإنتاج',start_production:'بدء التصوير',wrap_production:'إنهاء التصوير',accept_close:'اعتماد الإقفال',cancel_production:'إلغاء الإنتاج',
  add_crew:'إضافة طاقم',edit_crew:'تعديل',remove_crew:'استبعاد',add_talent:'إضافة موهبة',edit_talent:'تعديل',record_release:'تسجيل تصريح الصورة',remove_talent:'استبعاد',
  add_location:'إضافة موقع',edit_location:'تعديل',record_permit:'تسجيل تصريح التصوير',remove_location:'استبعاد',
  save_schedule:'حفظ جدول يوم',add_shot:'إضافة لقطة',edit_shot:'تعديل',mark_shot:'تحديث حالة اللقطة'};
const productionRoutes={edit_production:'edit',start_production:'start',wrap_production:'wrap',accept_close:'close',cancel_production:'cancel'};

function productionFields(data,p){
  return [field('title','اسم الإنتاج','text',{value:p?.title}),field('kind','نوع الإنتاج','select',{value:p?.kind,options:options(data.kinds)}),
    field('brief','موجز الإنتاج','textarea',{required:false,value:p?.brief}),
    field('client_id','العميل','select',{required:false,value:p?.client_id??'',options:blank(options(data.clients,'id','name'),'دون عميل')}),
    field('campaign_id','الحملة','select',{required:false,value:p?.campaign_id??'',options:blank(options(data.campaigns,'id','name'),'خارج الحملات')}),
    field('project_id','المشروع','select',{required:false,value:p?.project_id??'',options:blank(options(data.projects,'id','name'),'دون مشروع'),hint:'ميزانية الإنتاج هي مخصص هذا المشروع في شاشة «مخصصات المشاريع»؛ ما تتكرر هنا.'}),
    // المعالجة تُختار في التحضير وحده؛ بعد بدء التصوير ثابتة فلا يُعرض حقلها، وغيابه من الطلب يبقيها كما هي.
    ...(!p||p.status==='planning'?[field('review_route_id','المعالجة اللي يصوّرها الإنتاج','select',{required:false,value:p?.review_route_id??'',
      options:blank([...(p?.treatment&&!(data.treatments??[]).some(t=>t.id===p.review_route_id)?[{value:p.review_route_id,label:p.treatment.route_name}]:[]),...options(data.treatments??[],'id','name')],'بلا معالجة للحين'),
      hint:'مسار مراجعة على نسخة المخرج. والمشروع والعميل والحملة الفاضية تنقرأ من عمل الاستوديو، والتصوير ما يبدأ قبل موافقة المسار واعتماد مخصص المشروع للمدة.'})]:[]),
    field('shoot_from','بداية التصوير','date',{value:p?.shoot_from}),field('shoot_to','نهاية التصوير','date',{value:p?.shoot_to})];
}
const productionPayload=v=>({title:v.title,kind:v.kind,brief:v.brief||'',client_id:v.client_id||'',campaign_id:v.campaign_id||'',project_id:v.project_id||'',
  ...(v.review_route_id!==undefined?{review_route_id:v.review_route_id||''}:{}),shoot_from:v.shoot_from,shoot_to:v.shoot_to});
const crewFields=(data,c)=>[field('source','نوع التكليف','select',{value:c?.source,options:[{value:'internal',label:'موظف داخلي'},{value:'external',label:'مستقل خارجي (مورد)'}],hint:'الموظف الداخلي بدون أي رقم هنا. المستقل الخارجي مورد، ومستحقه يمشي بدورة المشتريات والمدفوعات.'}),
  field('role_key','الدور','select',{value:c?.role_key,options:options(data.crew_roles)}),
  field('user_id','الموظف (للتكليف الداخلي)','select',{required:false,value:c?.user_id??'',options:blank(options(data.people,'id','name'),'—')}),
  field('vendor_id','المورد (للمستقل الخارجي)','select',{required:false,value:c?.vendor_id??'',options:blank(data.vendors.map(x=>({value:x.id,label:`${x.code} · ${x.legal_name}`})),'—')}),
  field('day_rate','معدل اليوم للمستقل الخارجي (ريال)','text',{required:false,value:c?.day_rate_minor?(c.day_rate_minor/100).toFixed(2):''}),
  field('days','عدد الأيام','number',{required:false,min:1,max:365,value:c?.days??''}),
  field('role_note','وصف الدور','text',{required:false,value:c?.role_note}),field('engagement_note','ملاحظة التكليف','textarea',{required:false,value:c?.engagement_note})];
const crewPayload=v=>({source:v.source,role_key:v.role_key,user_id:v.source==='internal'?v.user_id||'':'',vendor_id:v.source==='external'?v.vendor_id||'':'',
  day_rate:v.source==='external'?String(v.day_rate??'').trim():'',days:v.source==='external'&&v.days!==''?Number(v.days):'',role_note:v.role_note||'',engagement_note:v.engagement_note||''});
const releaseFields=(t)=>[field('release_status','حالة تصريح استخدام الصورة','select',{value:t?.release_status??'not_signed',options:[{value:'not_signed',label:'ما انوقّع'},{value:'signed',label:'موقّع'},{value:'expired',label:'انتهت مدته'},{value:'refused',label:'رفض التوقيع'}],hint:'تسجيل واقعة، مو توقيع إلكتروني.'}),
  field('release_signed_on','تاريخ التوقيع','date',{required:false,value:t?.release_signed_on??''}),field('release_valid_until','نهاية مدة التصريح','date',{required:false,value:t?.release_valid_until??''}),
  field('release_scope','نطاق الاستخدام: القنوات والأسواق والمدة','textarea',{required:false,value:t?.release_scope}),field('release_media','الوسائط المشمولة','text',{required:false,value:t?.release_media}),
  field('release_storage','مكان حفظ الأصل الموقّع','text',{required:false,value:t?.release_storage,hint:'الأصل برّا المنصة؛ اكتب وينه بالضبط.'}),field('release_note','ملاحظة','textarea',{required:false,value:t?.release_note})];
const releasePayload=v=>({release_status:v.release_status,release_signed_on:v.release_signed_on||'',release_valid_until:v.release_valid_until||'',
  release_scope:v.release_scope||'',release_media:v.release_media||'',release_storage:v.release_storage||'',release_note:v.release_note||''});
const permitFields=l=>[field('permit_required','يحتاج هالموقع تصريح من جهة؟','select',{value:l?l.permit_required?'1':'0':'0',options:[{value:'0',label:'لا — بقرار المنتج'},{value:'1',label:'نعم'}],hint:'قرار المنتج وحده.'}),
  field('permit_basis','ليش يحتاج تصريح، ومن أي جهة','textarea',{required:false,value:l?.permit_basis}),
  field('permit_status','حالة التصريح','select',{value:l?.permit_status??'not_required',options:[{value:'not_required',label:'ما يحتاج تصريح'},{value:'pending',label:'قيد الطلب'},{value:'obtained',label:'صدر'},{value:'refused',label:'انرفض'}]}),
  field('permit_number','رقم التصريح','text',{required:false,value:l?.permit_number}),field('permit_issuer','مصدر التصريح','text',{required:false,value:l?.permit_issuer}),
  field('permit_expires_on','انتهاء التصريح','date',{required:false,value:l?.permit_expires_on??''}),field('permit_storage','مكان حفظ أصل التصريح','text',{required:false,value:l?.permit_storage})];
const permitPayload=v=>({permit_required:v.permit_required==='1',permit_basis:v.permit_basis||'',permit_status:v.permit_status,
  permit_number:v.permit_number||'',permit_issuer:v.permit_issuer||'',permit_expires_on:v.permit_expires_on||'',permit_storage:v.permit_storage||''});
const shotFields=(data,p,h)=>[field('description','وصف اللقطة','textarea',{value:h?.description}),
  field('scene_id','المشهد','select',{required:false,value:h?.scene_id??'',options:blank(p.schedule_days.flatMap(d=>d.rows.map(r=>({value:r.id,label:`${d.shoot_date} · ${r.title}`}))),'خارج المشاهد')}),
  field('code','رمز اللقطة','text',{required:false,value:h?.code}),
  field('shot_size','حجم اللقطة','select',{value:h?.shot_size,options:options(data.shot_sizes)}),field('camera_angle','زاوية الكاميرا','select',{value:h?.camera_angle,options:options(data.camera_angles)}),
  field('reference_note','المرجع البصري ومكان حفظه','textarea',{required:false,value:h?.reference_note,hint:'اكتب وين محفوظ المرجع: رابطه أو مكان ملفه.'})];
const shotPayload=v=>({description:v.description,scene_id:v.scene_id||'',code:v.code||'',shot_size:v.shot_size,camera_angle:v.camera_angle,reference_note:v.reference_note||''});

export const productionsUI={
  title:'الإنتاج والتصوير',
  description:'المشروع الإنتاجي وطاقمه ومواهبه ومواقعه وجدوله ولقطاته. المستقل الخارجي مورد ينصرف له عن طريق المدفوعات، والموظف الداخلي بدون أي رقم هنا، والميزانية مخصص المشروع مو نسخة منه.',
  load:api=>api('/productions'),
  render(data,{e,button,money,ui=kit(e)}){
    const rowsOf=(list,none,body)=>list.length?`<ul class="vn-list">${list.map(body).join('')}</ul>`:`<p class="subtle">${e(none)}</p>`;
    const bar=(p,list)=>list.length?`<div class="operation-actions">${list.map(a=>button(a,p.id,productionLabels[a])).join('')}</div>`:'';
    const crew=p=>rowsOf(p.crew,'ما انضاف أحد للطاقم للحين.',c=>`<li class="${c.active?'':'is-old'}"><strong>${e(c.person_name??'—')} · ${e(c.role_name)}</strong><span>${c.source==='internal'?'موظف داخلي':`مستقل خارجي · <bdi>${e(c.vendor_code??'')}</bdi>`}${c.source==='external'&&c.day_rate_minor!==null?` · معدل اليوم ${e(money(c.day_rate_minor))}${c.days?` × ${e(c.days)} يوم`:''}`:''}${c.source==='internal'?' · لا يُعرض أجره ولا تكلفته هنا':''}${c.active?'':` · مستبعد: ${e(c.removal_note)}`}</span>${c.role_note||c.engagement_note?`<small>${e(c.role_note)}${c.engagement_note?` — ${e(c.engagement_note)}`:''}</small>`:''}${c.actions.length?`<div class="operation-actions">${c.actions.map(a=>button(a,`${p.id}:${c.id}`,productionLabels[a])).join('')}</div>`:''}</li>`);
    const talent=p=>rowsOf(p.talent,'ما انضافت مواهب للحين.',x=>`<li class="${!x.active?'is-old':x.release_status!=='signed'||x.release_expired?'is-late':''}"><strong>${e(x.full_name)} · ${e(x.kind_name)}</strong><span>تصريح الصورة: ${e(x.release_status_name)}${x.release_signed_on?` · انوقّع ${e(x.release_signed_on)}`:''}${x.release_valid_until?` · لين ${e(x.release_valid_until)}`:''}${x.release_expired?' · انتهت مدته':''}</span>${x.release_scope||x.release_storage?`<small>النطاق: ${e(x.release_scope)}${x.release_storage?` — الأصل محفوظ في: ${e(x.release_storage)}`:''}</small>`:''}${x.actions.length?`<div class="operation-actions">${x.actions.map(a=>button(a,`${p.id}:${x.id}`,productionLabels[a])).join('')}</div>`:''}</li>`);
    const places=p=>rowsOf(p.locations,'ما انضافت مواقع للحين.',l=>`<li class="${!l.active?'is-old':l.permit_required&&l.permit_status!=='obtained'?'is-late':l.permit_expired?'is-late':''}"><strong>${e(l.name)}</strong><span>${e(l.permit_required?`تصريح التصوير: ${l.permit_status_name}`:'ما يحتاج تصريح بقرار المنتج')}${l.permit_number?` · رقم <bdi>${e(l.permit_number)}</bdi> من ${e(l.permit_issuer)} لين ${e(l.permit_expires_on)}`:''}${l.permit_expired?' · منتهي':''}</span><small>${e(l.address_note)}${l.contact_name?` · ${e(l.contact_name)} <bdi>${e(l.contact_phone)}</bdi>`:''}${l.map_link?` · الخريطة: <bdi>${e(l.map_link)}</bdi>`:''}${l.permit_basis?` — سند القرار: ${e(l.permit_basis)}`:''}</small>${l.actions.length?`<div class="operation-actions">${l.actions.map(a=>button(a,`${p.id}:${l.id}`,productionLabels[a])).join('')}</div>`:''}</li>`);
    const days=p=>p.schedule_days.length?p.schedule_days.map(d=>`<section class="vn-block"><h4>${e(d.shoot_date)}</h4>${ui.table({head:['الترتيب','المشهد','الموقع','البداية','المدة (دقيقة)'],rows:d.rows.map(r=>`<tr><td>${e(r.sort_order+1)}</td><td>${e(r.scene_ref?`${r.scene_ref} · `:'')}${e(r.title)}${r.note?`<br><small>${e(r.note)}</small>`:''}</td><td>${e(r.location_name??'—')}</td><td><bdi dir="ltr">${e(r.start_time||'—')}</bdi></td><td>${e(r.estimated_minutes??'—')}</td></tr>`)})}</section>`).join(''):'<p class="subtle">ما فيه جدول تصوير محفوظ للحين.</p>';
    // عمود الترتيب «#» والأفعال بلا عنوان ظاهر: للقارئ الآلي اسمهما كاملًا.
    const shots=p=>p.shots.length?`<div class="table-wrap"><table><thead><tr><th><span aria-hidden="true">#</span><span class="sr-only">الترتيب</span></th><th>اللقطة</th><th>المشهد</th><th>الحجم والزاوية</th><th>الحالة</th><th><span class="sr-only">الإجراءات</span></th></tr></thead><tbody>${p.shots.map(h=>`<tr class="${h.status==='reshoot'?'is-late':h.status==='shot'?'is-ok':''}"><td>${e(h.sort_order+1)}</td><td>${h.code?`<bdi>${e(h.code)}</bdi> · `:''}${e(h.description)}${h.reference_note?`<br><small>مرجع: ${e(h.reference_note)}</small>`:''}</td><td>${e(h.scene_title??'—')}</td><td>${e(h.size_name)} · ${e(h.angle_name)}</td><td>${e(h.status_name)}${h.status_note?`<br><small>${e(h.status_note)}</small>`:''}</td><td>${h.actions.length?`<div class="operation-actions">${h.actions.map(a=>button(a,`${p.id}:${h.id}`,productionLabels[a])).join('')}</div>`:''}</td></tr>`).join('')}</tbody></table></div>`:'<p class="subtle">ما انسجلت لقطات للحين.</p>';
    // المعدات على الإنتاج (الترحيل 193): المحجوزة له والطالعة عليه، كل قطعة برمزها وحالتها وحاملها. الحجز والتسليم من «المعدات والعهد».
    const gear=p=>p.equipment?.length?`<section class="vn-block"><h3>المعدات على هالإنتاج</h3><ul class="vn-list">${p.equipment.map(b=>`<li class="${b.status==='out'?'is-due':''}"><strong><bdi>${e(b.item_code)}</bdi> · ${e(b.item_name)}</strong><span>${e(b.status_name)} · بعهدة ${e(b.custodian_name)} · <time datetime="${e(b.start_date)}">${e(b.start_date)}</time> لين <time datetime="${e(b.end_date)}">${e(b.end_date)}</time></span></li>`).join('')}</ul><p class="subtle">الحجز والتسليم والاستلام من شاشة «المعدات والعهد».</p></section>`:'';
    // الإقفال ومعداته برّا يرفضه الخادم (equipment_still_out): مكان الزر رفضه المكتوب — كل قطعة وعند من، والخطوة الجاية.
    const held=p=>p.actions.includes('accept_close')&&p.equipment?.length?ui.refusal({what:`ما ينقفل الإنتاج ${p.code} والمعدات حقّته للحين ما رجعت المخزن`,
      missing:p.equipment.map(b=>({document:`${b.item_code} ${b.item_name}`,why:b.status==='out'?`طالعة بعهدة ${b.custodian_name} من ${b.start_date}`:`محجوزة باسم ${b.custodian_name} من ${b.start_date} وما انسلّمت`,owner:b.custodian_name})),
      next:'رجّعوا القطع الطالعة للمخزن وأمين المخزن يسجّل استلامها، وألغوا الحجوزات اللي ما لها داعي، وبعدها اعتمد الإقفال'}):'';
    // أفعال الإنتاج في أعلى البطاقة (الخطوة الجاية)، وكل «إضافة» في قسمها جنب اللي تضيف له.
    const SECTION={add_crew:'crew',add_talent:'talent',add_location:'places',save_schedule:'days',add_shot:'shots'};
    // المعالجة التي يصوّرها الإنتاج، وما ينقص قبل بدء التصوير باسمه وعند من — أول البطاقة لأنه ما ينتظر القرار.
    const treatment=p=>p.treatment?`<p class="subtle">المعالجة: «${e(p.treatment.route_name)}» · ${e(p.treatment.output_title)} · النسخة ${e(p.treatment.revision)} · ${e(p.treatment.status_name)} · بصمة <bdi>${e(String(p.treatment.digest).slice(0,12))}</bdi></p>`:'';
    const before=p=>p.readiness&&!p.readiness.ready?`<section class="vn-block"><h3>قبل بدء التصوير</h3><ul class="vn-list">${p.readiness.missing.map(m=>ui.row({title:m.document,meta:`${m.why} · عند: ${m.owner}`,tone:'is-due'})).join('')}</ul></section>`:'';
    const card=p=>{
      const top=p.actions.filter(a=>!SECTION[a]&&!(a==='accept_close'&&p.equipment?.length)),here=key=>bar(p,p.actions.filter(a=>SECTION[a]===key));
      return `<details class="vn-card"${p.status==='in_production'?' open':''}><summary><span class="vn-code"><bdi>${e(p.code)}</bdi></span><span class="vn-name"><strong>${e(p.title)}</strong><small>${e(p.kind_name)} · ${e(p.shoot_from)} لين ${e(p.shoot_to)} · المنتج ${e(p.producer_name)}</small></span><span class="vn-flags">${p.counts.talent_without_release?`<span class="vn-flag is-block">${e(p.counts.talent_without_release)} بلا تصريح صورة</span>`:''}${p.counts.permits_open?`<span class="vn-flag is-warn">${e(p.counts.permits_open)} تصريح موقع ينتظر</span>`:''}<span class="badge">${e(p.status_name)}</span></span></summary>
      <div class="vn-body">${p.brief?`<p class="measure">${e(p.brief)}</p>`:''}
      <p class="subtle">${e([p.client_name&&`العميل: ${p.client_name}`,p.campaign_name&&`الحملة: ${p.campaign_name}`,p.project_name&&`المشروع: ${p.project_name}`].filter(Boolean).join(' · ')||'بلا ربط')} — ${e(p.budget_note)}</p>
      ${treatment(p)}${before(p)}
      ${bar(p,top)}${held(p)}
      <div class="vn-tiles">${ui.tile(p.counts.crew,'طاقم نشط')}${ui.tile(p.counts.external_crew,'مستقل خارجي (مورد)')}${ui.tile(p.counts.talent,'موهبة')}${ui.tile(p.counts.talent_without_release,'بلا تصريح صورة',p.counts.talent_without_release?'is-late':'')}${ui.tile(p.counts.locations,'موقع')}${ui.tile(`${p.counts.shots_done}/${p.counts.shots}`,'لقطات تصوّرت')}${ui.tile(p.counts.call_sheets,'ورقة استدعاء صادرة')}</div>
      <section class="vn-block"><h3>الطاقم</h3>${crew(p)}${here('crew')}</section>
      <section class="vn-block"><h3>المواهب وتصاريح استخدام الصورة</h3>${talent(p)}${here('talent')}</section>
      <section class="vn-block"><h3>المواقع وتصاريح التصوير</h3>${places(p)}${here('places')}</section>
      <section class="vn-block"><h3>جدول أيام التصوير</h3>${days(p)}${here('days')}</section>
      <section class="vn-block"><h3>قائمة اللقطات</h3>${shots(p)}${here('shots')}</section>
      ${gear(p)}
      ${p.call_sheets.length?`<section class="vn-block"><h3>أوراق الاستدعاء</h3><ul class="vn-list">${p.call_sheets.map(s=>`<li><strong>${e(s.shoot_date)} · النسخة ${e(s.revision)}</strong><span>${e(s.status_name)}</span></li>`).join('')}</ul><p class="subtle">إعدادها وإصدارها من شاشة «أوراق الاستدعاء».</p></section>`:''}
      ${p.wrap_note?`<section class="vn-block"><h3>إنهاء التصوير</h3><p class="measure">${e(p.wrap_note)}</p></section>`:''}</div></details>`;
    };
    const groups=[['in_production','قيد التصوير'],['planning','تحضير'],['wrapped','انتهى التصوير'],['closed','مقفلة'],['cancelled','ملغاة']]
      .map(([s,t])=>{const rows=data.productions.filter(p=>p.status===s);return rows.length?`<section class="vn-group"><h2>${e(t)} <span>${rows.length}</span></h2>${rows.map(card).join('')}</section>`:'';}).join('');
    return `<section class="panel panel-body vn-head"><p>${e(data.note)}</p><div class="operation-actions">${button('create_production','','إنتاج جديد')}</div></section>
      ${groups||ui.empty('ما فيه إنتاج للحين','ابدأ بـ«إنتاج جديد»، وعليه ينضاف الطاقم والمواهب والمواقع والجدول واللقطات.')}`;
  },
  form(action,id,data){
    if(action==='create_production')return {title:'إنتاج جديد',endpoint:'/productions',idempotent:true,
      fields:[field('code','رمز الإنتاج','text',{hint:'حروف لاتينية كبيرة وأرقام وشرطات، مثل PRD-2026-01.'}),...productionFields(data,null)],
      toPayload:v=>({code:v.code,...productionPayload(v)})};
    const [productionId,childId]=String(id).split(':'),p=data.productions.find(x=>x.id===productionId);guard(p);
    const spec=(title,endpoint,fields,toPayload=v=>v,version)=>({title:`${title} — ${p.title}`,endpoint,fields,toPayload:v=>({version,...toPayload(v)})});
    if(productionRoutes[action]){
      guard(p.actions.includes(action)&&!(action==='accept_close'&&p.equipment?.length));
      const target=`/productions/${productionId}/${productionRoutes[action]}`;
      if(action==='edit_production')return spec('تعديل الإنتاج',target,productionFields(data,p),productionPayload,p.version);
      if(action==='start_production')return spec('بدء التصوير',target,[],()=>({}),p.version);
      if(action==='wrap_production')return spec('إنهاء التصوير',target,[field('wrap_note','وش انتهى ووش باقي من المخرجات','textarea')],v=>({wrap_note:v.wrap_note}),p.version);
      if(action==='accept_close')return spec('اعتماد إقفال الإنتاج',target,[field('note','أساس الإقفال: المخرجات انسلّمت والتصاريح موثقة','textarea',{hint:'يعتمده شخص غير منتج العمل.'})],v=>({note:v.note}),p.version);
      return spec('إلغاء الإنتاج',target,[field('note','سبب الإلغاء','textarea')],v=>({note:v.note}),p.version);
    }
    if(action==='add_crew'){guard(p.actions.includes(action));return {title:`إضافة طاقم — ${p.title}`,endpoint:`/productions/${productionId}/crew`,idempotent:true,fields:crewFields(data,null),toPayload:crewPayload};}
    if(action==='add_talent'){guard(p.actions.includes(action));return {title:`إضافة موهبة — ${p.title}`,endpoint:`/productions/${productionId}/talent`,idempotent:true,
      fields:[field('full_name','الاسم'),field('talent_kind','النوع','select',{options:options(data.talent_kinds)}),field('agency_vendor_id','وكالة المواهب (مورد)','select',{required:false,options:blank(data.vendors.map(x=>({value:x.id,label:x.legal_name})),'دون وكالة')}),field('contact_note','بيانات التواصل','text',{required:false}),...releaseFields(null)],
      toPayload:v=>({full_name:v.full_name,talent_kind:v.talent_kind,agency_vendor_id:v.agency_vendor_id||'',contact_note:v.contact_note||'',...releasePayload(v)})};}
    if(action==='add_location'){guard(p.actions.includes(action));return {title:`إضافة موقع — ${p.title}`,endpoint:`/productions/${productionId}/locations`,idempotent:true,
      fields:[field('name','اسم الموقع'),field('address_note','العنوان الوصفي','textarea',{required:false}),field('map_link','رابط الخريطة','text',{required:false,hint:'يكتبه المنتج بنفسه.'}),field('contact_name','جهة الاتصال','text',{required:false}),field('contact_phone','هاتف جهة الاتصال','text',{required:false}),...permitFields(null)],
      toPayload:v=>({name:v.name,address_note:v.address_note||'',map_link:v.map_link||'',contact_name:v.contact_name||'',contact_phone:v.contact_phone||'',...permitPayload(v)})};}
    if(action==='add_shot'){guard(p.actions.includes(action));return {title:`إضافة لقطة — ${p.title}`,endpoint:`/productions/${productionId}/shots`,idempotent:true,fields:shotFields(data,p,null),toPayload:shotPayload};}
    if(action==='save_schedule'){guard(p.actions.includes(action));
      const day=p.schedule_days[0]??null;
      return {title:`جدول يوم تصوير — ${p.title}`,endpoint:`/productions/${productionId}/schedule`,
        fields:[field('shoot_date','يوم التصوير','date',{value:day?.shoot_date??p.shoot_from}),
          field('rows','المشاهد بترتيبها','rows',{value:day?.rows.map(r=>({id:r.id,scene_ref:r.scene_ref,title:r.title,note:r.note,location_id:r.location_id??'',start_time:r.start_time,estimated_minutes:r.estimated_minutes??''})),
            columns:[{name:'id',label:'المعرف',required:false,maxLength:40},{name:'scene_ref',label:'رقم المشهد',required:false},{name:'title',label:'المشهد'},{name:'location_id',label:'الموقع',type:'select',required:false,options:blank(p.locations.filter(l=>l.active).map(l=>({value:l.id,label:l.name})),'—')},{name:'start_time',label:'البداية',type:'time',required:false},{name:'estimated_minutes',label:'دقائق',type:'number',required:false,min:5,max:1440},{name:'note',label:'ملاحظة',required:false}],
            maxRows:60,hint:'الترتيب هو ترتيب الصفوف. حذف الصف يحذف المشهد إذا ما له لقطات. لا تغيّر عمود المعرف.'})],
        toPayload:v=>({shoot_date:v.shoot_date,rows:v.rows.map(r=>({id:r.id||'',scene_ref:r.scene_ref||'',title:r.title,note:r.note||'',location_id:r.location_id||'',start_time:r.start_time||'',estimated_minutes:r.estimated_minutes??''}))})};}
    const crewRow=p.crew.find(c=>c.id===childId),talentRow=p.talent.find(x=>x.id===childId),place=p.locations.find(l=>l.id===childId),shot=p.shots.find(h=>h.id===childId);
    if(action==='edit_crew'){guard(crewRow?.actions.includes(action));return spec('تعديل طاقم',`/production-crew/${childId}/edit`,crewFields(data,crewRow).filter(f=>['day_rate','days','role_note','engagement_note'].includes(f.name)),
      v=>({day_rate:crewRow.source==='external'?String(v.day_rate??'').trim():'',days:crewRow.source==='external'&&v.days!==''?Number(v.days):'',role_note:v.role_note||'',engagement_note:v.engagement_note||''}),crewRow.version);}
    if(action==='remove_crew'){guard(crewRow?.actions.includes(action));return spec('استبعاد من الطاقم',`/production-crew/${childId}/remove`,[field('note','سبب الاستبعاد','textarea')],v=>({note:v.note}),crewRow.version);}
    if(action==='edit_talent'){guard(talentRow?.actions.includes(action));return spec('تعديل موهبة',`/production-talent/${childId}/edit`,
      [field('full_name','الاسم','text',{value:talentRow.full_name}),field('talent_kind','النوع','select',{value:talentRow.talent_kind,options:options(data.talent_kinds)}),field('agency_vendor_id','وكالة المواهب','select',{required:false,value:talentRow.agency_vendor_id??'',options:blank(data.vendors.map(x=>({value:x.id,label:x.legal_name})),'دون وكالة')}),field('contact_note','بيانات التواصل','text',{required:false,value:talentRow.contact_note})],
      v=>({full_name:v.full_name,talent_kind:v.talent_kind,agency_vendor_id:v.agency_vendor_id||'',contact_note:v.contact_note||''}),talentRow.version);}
    if(action==='record_release'){guard(talentRow?.actions.includes(action));return spec('تصريح استخدام الصورة',`/production-talent/${childId}/release`,releaseFields(talentRow),releasePayload,talentRow.version);}
    if(action==='remove_talent'){guard(talentRow?.actions.includes(action));return spec('استبعاد موهبة',`/production-talent/${childId}/remove`,[field('note','سبب الاستبعاد','textarea')],v=>({note:v.note}),talentRow.version);}
    if(action==='edit_location'){guard(place?.actions.includes(action));return spec('تعديل موقع',`/production-locations/${childId}/edit`,
      [field('name','اسم الموقع','text',{value:place.name}),field('address_note','العنوان الوصفي','textarea',{required:false,value:place.address_note}),field('map_link','رابط الخريطة','text',{required:false,value:place.map_link}),field('contact_name','جهة الاتصال','text',{required:false,value:place.contact_name}),field('contact_phone','هاتف جهة الاتصال','text',{required:false,value:place.contact_phone})],
      v=>({name:v.name,address_note:v.address_note||'',map_link:v.map_link||'',contact_name:v.contact_name||'',contact_phone:v.contact_phone||''}),place.version);}
    if(action==='record_permit'){guard(place?.actions.includes(action));return spec('تصريح التصوير للموقع',`/production-locations/${childId}/permit`,permitFields(place),permitPayload,place.version);}
    if(action==='remove_location'){guard(place?.actions.includes(action));return spec('استبعاد موقع',`/production-locations/${childId}/remove`,[field('note','سبب الاستبعاد','textarea')],v=>({note:v.note}),place.version);}
    if(action==='edit_shot'){guard(shot?.actions.includes(action));return spec('تعديل لقطة',`/shots/${childId}/edit`,shotFields(data,p,shot),shotPayload,shot.version);}
    guard(shot?.actions.includes('mark_shot'));
    return spec('حالة اللقطة',`/shots/${childId}/status`,[field('status','الحالة','select',{value:shot.status,options:[{value:'planned',label:'مخططة'},{value:'shot',label:'تصوّرت'},{value:'reshoot',label:'تنعاد'}]}),field('note','ملاحظة أو سبب الإعادة','textarea',{required:false})],
      v=>({status:v.status,note:v.note||''}),shot.version);
  }
};

/* ───── أوراق الاستدعاء ───── */
const sheetLabels={edit_sheet:'تعديل المسودة',add_invitee:'إضافة مستدعى',remove_invitee:'حذف مستدعى',issue_sheet:'إصدار الورقة',revise_sheet:'إصدار نسخة جديدة',cancel_sheet:'إلغاء الورقة',
  mark_viewed:'اطّلعت',confirm:'تأكيد الحضور',decline:'اعتذار عن الحضور',record_response:'تسجيل رد وصل برّا المنصة'};
const sheetRoutes={edit_sheet:'edit',add_invitee:'add_invitee',remove_invitee:'remove_invitee',issue_sheet:'issue',revise_sheet:'revise',cancel_sheet:'cancel'};
const scheduleColumns=[{name:'time',label:'الوقت',type:'time'},{name:'activity',label:'البند'},{name:'note',label:'ملاحظة',required:false}];
const inviteeColumns=parties=>[{name:'party',label:'المستدعى',type:'select',options:parties},{name:'call_time',label:'وقت الحضور',type:'time'}];
function sheetFields(p,s){
  const places=(p?.locations??[]).map(l=>({value:l.id,label:l.name}));
  return [field('location_id','الموقع','select',{value:s?.location_id??'',options:places.length?places:[{value:'',label:'أضف موقع للإنتاج أول'}]}),
    field('map_link','رابط الخريطة','text',{required:false,value:s?.map_link,hint:'يكتبه المنتج.'}),
    field('call_time','وقت التجمع','time',{value:s?.call_time??'06:00'}),field('wrap_time','الانتهاء المتوقع','time',{required:false,value:s?.wrap_time}),
    field('day_schedule','جدول اليوم بالساعات','rows',{value:s?.day_schedule,columns:scheduleColumns,maxRows:40}),
    field('safety_notes','ملاحظات السلامة','textarea',{required:false,value:s?.safety_notes}),
    field('weather_note','ملاحظة الطقس','text',{required:false,value:s?.weather_note,hint:'يكتبها المنتج من مصدره.'}),
    field('nearest_hospital','أقرب مستشفى','text',{required:false,value:s?.nearest_hospital,hint:'يكتبه المنتج، والورقة ما تصدر بدونه.'}),
    field('hospital_address','عنوان المستشفى','text',{required:false,value:s?.hospital_address}),
    field('emergency_contact_name','جهة اتصال الطوارئ','text',{required:false,value:s?.emergency_contact_name}),
    field('emergency_contact_phone','هاتف الطوارئ','text',{required:false,value:s?.emergency_contact_phone})];
}
const sheetPayload=v=>({location_id:v.location_id||'',map_link:v.map_link||'',call_time:v.call_time,wrap_time:v.wrap_time||'',
  day_schedule:(v.day_schedule??[]).map(r=>({time:r.time,activity:r.activity,note:r.note||''})),
  safety_notes:v.safety_notes||'',weather_note:v.weather_note||'',nearest_hospital:v.nearest_hospital||'',hospital_address:v.hospital_address||'',
  emergency_contact_name:v.emergency_contact_name||'',emergency_contact_phone:v.emergency_contact_phone||''});

export const callSheetsUI={
  title:'أوراق الاستدعاء',
  description:'ورقة يوم التصوير: التجمع والموقع وجدول الساعات والسلامة والطوارئ. الصادرة ما تتعدل — التغيير نسخة جديدة تقول وش تغيّر، وتوصل كل من انستدعى.',
  load:api=>api('/call-sheets'),
  render(data,{e,button,ui=kit(e)}){
    // المستند للعرض الإلكتروني ينفتح في تبويب جديد، والقارئ الآلي يُقال له ذلك.
    const docLink=id=>`<a class="btn outline small" href="/api/call-sheets/${e(id)}/print" target="_blank" rel="noopener">الورقة كمستند<span class="sr-only"> (تنفتح في تبويب جديد)</span></a>`;
    const invitees=s=>s.invitees.length?`<div class="table-wrap"><table><thead><tr><th>المستدعى</th><th>الفئة</th><th>وقت الحضور</th><th>الحالة</th><th>التبليغ</th><th><span class="sr-only">الإجراءات</span></th></tr></thead><tbody>${s.invitees.map(i=>`<tr class="${i.state==='declined'?'is-late':i.state==='confirmed'?'is-ok':''}"><td>${e(i.display_name)}</td><td>${e(i.party_kind==='crew'?'طاقم':'موهبة')}</td><td><bdi dir="ltr">${e(i.call_time)}</bdi></td><td>${e(i.state_name)}${i.response_note?`<br><small>${e(i.response_note)}</small>`:''}</td><td><small>${e(i.delivery_note)}</small></td><td>${i.actions.length?`<div class="operation-actions">${i.actions.map(a=>button(a,`${s.id}:${i.id}`,sheetLabels[a])).join('')}</div>`:''}</td></tr>`).join('')}</tbody></table></div>`:'<p class="subtle">ما فيه مستدعين على هالورقة.</p>';
    const card=s=>`<details class="vn-card"${s.status==='draft'?' open':''}><summary><span class="vn-code"><bdi>${e(s.production_code)}</bdi></span><span class="vn-name"><strong>${e(s.shoot_date)} · النسخة ${e(s.revision)}</strong><small>${e(s.production_title)} · التجمع <bdi dir="ltr">${e(s.call_time)}</bdi> · ${e(s.location_name??'بلا موقع')}</small></span><span class="vn-flags">${s.counts.outside?`<span class="vn-flag is-warn">${e(s.counts.outside)} خارج المنصة</span>`:''}<span class="badge">${e(s.status_name)}</span></span></summary>
      <div class="vn-body">${s.revision>1?`<p class="vn-alert">النسخة ${e(s.revision)} تلغي اللي قبلها. وش تغيّر: ${e(s.change_summary)}</p>`:''}
      ${s.readiness&&!s.readiness.ready?`<section class="vn-block"><h3>قبل إصدار الورقة</h3><ul class="vn-list">${s.readiness.missing.map(m=>ui.row({title:m.document,meta:`${m.why} · عند: ${m.owner}`,tone:'is-due'})).join('')}</ul></section>`:''}
      <div class="operation-actions">${s.actions.map(a=>button(a,s.id,sheetLabels[a])).join('')}${s.status!=='draft'?docLink(s.id):''}</div>
      <div class="vn-tiles">${ui.tile(s.counts.invited,'مستدعى')}${ui.tile(s.counts.confirmed,'أكّد')}${ui.tile(s.counts.declined,'اعتذر',s.counts.declined?'is-late':'')}${ui.tile(s.counts.silent,'بلا رد',s.counts.silent?'is-due':'')}</div>
      <dl class="detail-data"><dt>الموقع</dt><dd>${e(s.location_name??'—')} — ${e(s.location_address)}${s.location_contact?` · ${e(s.location_contact)} <bdi>${e(s.location_contact_phone)}</bdi>`:''}</dd>
      <dt>الخريطة</dt><dd>${s.map_link?`<bdi>${e(s.map_link)}</bdi>`:'ما انكتبت'}</dd>
      <dt>تصريح تصوير الموقع</dt><dd>${e(s.location_permit?s.location_permit.required?`${s.location_permit.status_name}${s.location_permit.number?` · ${s.location_permit.number} من ${s.location_permit.issuer}`:''}`:'ما يحتاج تصريح بقرار المنتج':'—')}</dd>
      <dt>أقرب مستشفى</dt><dd>${e(s.nearest_hospital||'ما انكتب')} ${e(s.hospital_address)}</dd>
      <dt>اتصال الطوارئ</dt><dd>${e(s.emergency_contact_name||'ما انكتب')} <bdi dir="ltr">${e(s.emergency_contact_phone)}</bdi></dd>
      <dt>الطقس</dt><dd>${e(s.weather_note||'ما انكتب')}</dd></dl>
      <section class="vn-block"><h3>جدول اليوم</h3>${ui.table({head:['الوقت','البند','ملاحظة'],rows:s.day_schedule.map(l=>`<tr><td><bdi dir="ltr">${e(l.time)}</bdi></td><td>${e(l.activity)}</td><td>${e(l.note)}</td></tr>`),empty:'ما فيه بنود في جدول اليوم'})}</section>
      ${s.safety_notes?`<section class="vn-block"><h3>السلامة</h3><p class="measure">${e(s.safety_notes)}</p></section>`:''}
      <section class="vn-block"><h3>المستدعون</h3>${invitees(s)}</section>
      ${s.cancel_note?`<p class="vn-alert">انلغت: ${e(s.cancel_note)}</p>`:''}</div></details>`;
    // استدعاءاتي أولًا لمن استُدعي: اللي ينتظر ردك علامته «دورك».
    const mine=data.my_invitations.map(i=>`<li class="${i.state==='confirmed'?'is-ok':i.state==='declined'?'is-old':'is-due'}"><strong>${e(i.shoot_date)} · ${e(i.production_title)}</strong><span>التجمع <bdi dir="ltr">${e(i.call_time)}</bdi>${i.location_name?` · ${e(i.location_name)}`:''} · النسخة ${e(i.revision)} · ${e(i.state_name)}</span>${i.revision>1&&i.change_summary?`<small>وش تغيّر: ${e(i.change_summary)}</small>`:''}<div class="operation-actions">${i.actions.map(a=>button(a,`${i.id}:${i.invitee_id}`,sheetLabels[a])).join('')}${docLink(i.id)}</div></li>`).join('');
    return `<section class="panel panel-body vn-head"><p>${e(data.note)}</p>${data.can_manage?(data.productions.length?`<div class="operation-actions">${data.productions.map(p=>button('create_sheet',p.id,`ورقة استدعاء — ${p.code}`)).join('')}</div>`:'<p class="subtle">ما عندك إنتاج قائم تنتجه. ورقة الاستدعاء يعدّها منتج العمل.</p>'):''}</section>
      <section class="panel panel-body"><h2>استدعاءاتي</h2>${mine?`<ul class="vn-list">${mine}</ul>`:'<p class="subtle">ما فيه ورقة استدعاء صادرة باسمك.</p>'}</section>
      ${data.can_manage?(data.sheets.map(card).join('')||ui.empty('ما فيه أوراق استدعاء للحين','ورقة يوم التصوير تنعدّ من إنتاج قائم: الموقع والتجمع والجدول والسلامة والمستدعين.')):''}`;
  },
  form(action,id,data){
    // المواقع والطاقم والمواهب تأتي من لوحة الإنتاج؛ هذه الشاشة تستدعي ولا تنشئ.
    if(action==='create_sheet'){
      const p=data.productions.find(x=>x.id===id);guard(p&&p.locations.length&&p.invitees.length);
      return {title:`ورقة استدعاء — ${p.code}`,endpoint:'/call-sheets',idempotent:true,
        fields:[field('shoot_date','يوم التصوير','date',{value:p.shoot_from,hint:`بين ${p.shoot_from} و${p.shoot_to}`}),
          ...sheetFields(p,null),
          field('invitees','المستدعون','rows',{columns:inviteeColumns(p.invitees),maxRows:120,hint:'استدعِ شخص واحد على الأقل.'})],
        toPayload:v=>({production_id:p.id,shoot_date:v.shoot_date,...sheetPayload(v),invitees:(v.invitees??[]).map(r=>({party:r.party,call_time:r.call_time}))})};
    }
    const [sheetId,childId]=String(id).split(':'),s=(data.sheets??[]).find(x=>x.id===sheetId),mine=data.my_invitations.find(x=>x.id===sheetId);
    if(['mark_viewed','confirm','decline'].includes(action)){
      const line=s?.invitees.find(i=>i.id===childId)??(mine&&mine.invitee_id===childId?mine:null);
      guard(line&&(line.actions??[]).includes(action));
      const state={mark_viewed:'viewed',confirm:'confirmed',decline:'declined'}[action];
      return {title:sheetLabels[action],endpoint:`/call-sheets/invitees/${childId}/respond`,
        fields:[field('note','ملاحظة','textarea',{required:false})],toPayload:v=>({version:line.version,state,note:v.note||''})};
    }
    if(action==='record_response'){
      const line=s?.invitees.find(i=>i.id===childId);guard(line&&line.actions.includes(action));
      return {title:`تسجيل رد — ${line.display_name}`,endpoint:`/call-sheets/invitees/${childId}/respond`,
        fields:[field('state','الرد','select',{options:[{value:'confirmed',label:'أكّد'},{value:'declined',label:'اعتذر'}]}),field('note','كيف وصل الرد ومتى','textarea',{hint:'مطلوب: الرد وصل برّا المنصة والمنتج يسجّله.'})],
        toPayload:v=>({version:line.version,state:v.state,note:v.note})};
    }
    guard(s&&s.actions.includes(action));
    const endpoint=`/call-sheets/${sheetId}/${sheetRoutes[action]}`,base=(fields,toPayload=v=>v)=>({title:`${sheetLabels[action]} — ${s.shoot_date}`,endpoint,fields,toPayload:v=>({version:s.version,...toPayload(v)})});
    const p=data.productions.find(x=>x.id===s.production_id)??{locations:s.location_id?[{id:s.location_id,name:s.location_name}]:[],invitees:[]};
    if(action==='edit_sheet')return base([...sheetFields(p,s),...(s.revision>1?[field('change_summary','وش تغيّر عن النسخة اللي قبلها','textarea',{value:s.change_summary})]:[])],
      v=>({...sheetPayload(v),...(s.revision>1?{change_summary:v.change_summary}:{})}));
    if(action==='add_invitee'){
      const remaining=p.invitees.filter(x=>!s.invitees.some(i=>x.value===`${i.party_kind}:${i.party_kind==='crew'?i.crew_id:i.talent_id}`));
      guard(remaining.length);
      return base([field('invitees','المستدعون','rows',{columns:inviteeColumns(remaining),maxRows:120})],v=>({invitees:(v.invitees??[]).map(r=>({party:r.party,call_time:r.call_time}))}));
    }
    if(action==='remove_invitee')return base([field('invitee_id','المستدعى','select',{options:s.invitees.map(i=>({value:i.id,label:i.display_name}))})],v=>({invitee_id:v.invitee_id}));
    if(action==='issue_sheet')return base([field('note','أساس الإصدار: راجعت الجدول والسلامة وبيانات الطوارئ','textarea',{hint:'يصدرها شخص غير اللي أعدّها، وبعد الإصدار ما تتعدل بحرف.'})],v=>({note:v.note}));
    if(action==='revise_sheet')return base([field('change_summary','وش تغيّر عن النسخة الصادرة','textarea',{hint:'تنشأ نسخة جديدة مسودة، ويُعاد استدعاء الكل وقت إصدارها.'})],v=>({change_summary:v.change_summary}));
    return base([field('note','سبب الإلغاء وكيف انبلغ اللي انستدعوا','textarea')],v=>({note:v.note}));
  }
};
