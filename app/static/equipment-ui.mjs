// حجز المعدات والعهد: القطع وأطقمها وحجوزاتها ومناولتها وصيانتها وجردها بالمسح.
// الشاشة تصرّح: العهدة إقرار داخلي باسم المستلم ووقته، لا توقيع ذو حجية نظامية.
// البلاطة من العدّة المشتركة (ctx.ui)؛ ومن يرسم الشاشة بلا صفحة (اختبار) يأخذ العدّة نفسها.
import { kit } from './kit.mjs';
const field=(name,label,type='text',extra={})=>({name,label,type,...extra});
const guard=ok=>{if(!ok)throw Error('هالإجراء غير متاح لك الحين. حدّث الصفحة.');};
const pct=bp=>`${(bp/100).toFixed(0)}%`;
const optional=(list,empty)=>[{value:'',label:empty},...list.map(x=>({value:x.id,label:x.name}))];

const labels={edit_item:'تعديل القطعة',report_lost:'بلاغ فقد',confirm_lost:'إقرار الفقد',reject_lost:'رد البلاغ',retire_item:'استبعاد',return_to_service:'إعادة للخدمة',
  book_item:'حجز القطعة',open_work_order:'أمر عمل صيانة',add_kit_item:'إضافة قطعة للطقم',remove_kit_item:'إزالة قطعة',archive_kit:'أرشفة الطقم',book_kit:'حجز الطقم',
  hand_out:'إقرار استلام العهدة',hand_in:'استلام الإعادة',cancel_booking:'إلغاء الحجز',start_work:'بدء التنفيذ',complete_work:'إنجاز',cancel_work:'إلغاء أمر العمل',
  scan_item:'تأكيد وجود قطعة',close_check:'إقفال الجرد'};
const itemRoutes={edit_item:'edit',report_lost:'report_lost',confirm_lost:'confirm_lost',reject_lost:'reject_lost',retire_item:'retire',return_to_service:'return_to_service'};
const bookingRoutes={hand_out:'hand_out',hand_in:'hand_in',cancel_booking:'cancel'};
const orderRoutes={start_work:'start',complete_work:'complete',cancel_work:'cancel'};

function itemFields(data,i){
  return [field('name','اسم القطعة','text',{value:i?.name}),field('category','الفئة','select',{value:i?.category,options:data.categories.map(c=>({value:c.key,label:c.name}))}),
    field('serial_no','الرقم التسلسلي','text',{required:false,value:i?.serial_no}),
    field('condition_state','حالتها','select',{value:i?.condition_state,options:data.conditions.map(c=>({value:c.key,label:c.name}))}),
    field('condition_note','ملاحظة الحالة','textarea',{required:false,value:i?.condition_note}),
    field('home_location','مكانها المعتاد','text',{required:false,value:i?.home_location}),
    field('asset_id','سجل الأصل المحاسبي','select',{required:false,value:i?.asset_id??'',
      options:[{value:'',label:'غير مرسملة'},...(i?.asset?[{value:i.asset.id,label:`${i.asset.code} — ${i.asset.name}`}]:[]),...data.assets.map(a=>({value:a.id,label:`${a.code} — ${a.name}`}))],
      hint:'ربط بالسجل المحاسبي مو نسخة منه: التكلفة والإهلاك يبقون في سجل الأصول.'})];
}
const itemPayload=v=>({name:v.name,category:v.category,serial_no:v.serial_no||'',condition_state:v.condition_state,condition_note:v.condition_note||'',home_location:v.home_location||'',asset_id:v.asset_id||''});
const movementFields=(data,label)=>[field('counterpart_id','الطرف الآخر','select',{options:data.custodians.map(c=>({value:c.id,label:c.name})),hint:'اللي يسلّم مو هو اللي يستلم.'}),
  field('condition_state','حالة القطعة الآن','select',{options:data.conditions.map(c=>({value:c.key,label:c.name}))}),
  field('condition_note','وصف الحالة','textarea'),
  field('acknowledgement','نص الإقرار','textarea',{value:label,hint:'إقرار داخلي باسمك ووقتك، مو توقيع له حجية نظامية.'}),
  field('photo','صورة الحالة','file',{required:false,hint:'PNG أو JPEG لين 2 ميغابايت. الصورة دليل ما يتعدل ولا ينحذف.'})];
const movementPayload=v=>({counterpart_id:v.counterpart_id,condition_state:v.condition_state,condition_note:v.condition_note,acknowledgement:v.acknowledgement,
  photo:v.photo&&v.photo.content?{label:'حالة القطعة عند المناولة',filename:v.photo.filename,content:v.photo.content}:''});

export const equipmentUI={
  title:'المعدات والعهد',
  description:'القطع وأطقمها وحجوزاتها بدون حجز مزدوج، ومناولة بعهدة يقرّها المستلم باسمه ووقته (مو توقيع له حجية)، وصيانة وجرد بالمسح وتقرير استغلال.',
  load:api=>api('/equipment'),
  render(data,{e,button,money,ui=kit(e)}){
    // قائمة بلا صفوف ما تُرسم قائمةً: جملة واحدة تقول إن ما فيه شي، فالقارئ الآلي ما يعلن «قائمة من عنصر واحد».
    const list=(rows,none)=>rows.length?`<ul class="vn-list">${rows.join('')}</ul>`:`<p class="subtle">${e(none)}</p>`;
    const bar=(list,id)=>list.length?`<div class="operation-actions">${list.map(a=>button(a,id,labels[a])).join('')}</div>`:'';
    // الإنتاج المربوط بالحجز (الترحيل 193) برمزه واسمه، والمرجع الحر ملاحظة بجانبه كما كُتب — إلا إذا كان هو رمز الإنتاج أو اسمه.
    const production=b=>{
      const note=String(b.production_ref??'').trim(),same=!!b.production_code&&(note.toUpperCase()===b.production_code.toUpperCase()||note===String(b.production_title??'').trim());
      return (b.production_code?` · إنتاج: <bdi>${e(b.production_code)}</bdi> «${e(b.production_title)}»`:'')+(note&&!same?` · ${b.production_code?'ملاحظة':'إنتاج'}: <bdi>${e(note)}</bdi>`:'');
    };
    const booking=b=>`<li class="${b.late?'is-late':b.status==='out'?'is-due':['returned','cancelled'].includes(b.status)?'is-old':''}">
      <strong><bdi>${e(b.item_code)}</bdi> · ${e(b.item_name)} — ${e(b.custodian_name)}</strong>
      <span>${e(b.status_name)} · ${e(b.start_date)} لين ${e(b.end_date)}${b.late?` · تأخر الإرجاع ${e(b.days_late)} يوم`:''}</span>
      <small>${e(b.purpose)}${b.project_name?` · مشروع: ${e(b.project_name)}`:''}${production(b)}${b.cancel_note?` · انلغى: ${e(b.cancel_note)}`:''}</small>
      ${b.movements.map(m=>`<small class="subtle">${e(m.kind==='out'?'تسليم':'استلام')} ${e(m.moved_on)}: سلّمها ${e(m.released_by_name)} واستلمها ${e(m.received_by_name)} · ${e(m.condition_name)} — ${e(m.condition_note)} · إقرار: ${e(m.acknowledgement)}${m.photos.length?` · ${m.photos.map((p,i)=>`<a class="btn outline small" href="/api/equipment/photos/${e(p.id)}">صورة الحالة${m.photos.length>1?` ${i+1}`:''}</a>`).join(' ')}`:' · بدون صورة حالة'}</small>`).join('')}
      ${bar(b.actions,b.id)}</li>`;
    if(!data.can_manage)return `<section class="panel panel-body vn-head"><p>${e(data.note)}</p></section>
      <section class="panel panel-body vn-block"><h3>عهدي</h3>${list(data.bookings.map(booking),'ما عليك عهدة الحين.')}</section>`;
    const item=i=>`<li class="${['lost','retired'].includes(i.status)?'is-old':i.status==='lost_review'?'is-late':''}">
      <strong><bdi>${e(i.code)}</bdi> · ${e(i.name)}</strong>
      <span>${e(i.category_name)} · ${e(i.status_name)} · ${e(i.condition_name)}${i.serial_no?` · تسلسلي <bdi>${e(i.serial_no)}</bdi>`:''}${i.kit?` · ضمن ${e(i.kit.name)}`:''}</span>
      <small>${i.asset?`أصل محاسبي: <bdi>${e(i.asset.code)}</bdi> — ${e(i.asset.name)}`:'غير مرسملة'}${i.home_location?` · ${e(i.home_location)}`:''}${i.condition_note?` · ${e(i.condition_note)}`:''}</small>
      ${i.lost_reported_by_name?`<small class="subtle">بلاغ فقد من ${e(i.lost_reported_by_name)}: ${e(i.lost_note)}${i.lost_confirmed_by_name?` — أقرّه ${e(i.lost_confirmed_by_name)}: ${e(i.lost_decision_note)}`:''}</small>`:''}
      <div class="operation-actions">${i.actions.map(a=>button(a,i.id,labels[a])).join('')}<a class="btn outline small" href="/api/equipment/items/${e(i.id)}/qr?format=svg">رمز QR للقطعة</a></div></li>`;
    const kit_=k=>`<li class="${k.status==='archived'?'is-old':''}"><strong><bdi>${e(k.code)}</bdi> · ${e(k.name)}</strong>
      <span>${e(k.items.length)} قطعة · ${k.bookable?'جاهز ينحجز كطقم كامل':'فيه قطعة أو أكثر مو متاحة'}</span>
      <small>${e(k.items.map(i=>`${i.code} ${i.name} (${i.status_name})`).join('، '))||'ما فيه قطع للحين.'}</small>
      ${bar(k.actions,k.id)}</li>`;
    const order=o=>`<li class="${['done','cancelled'].includes(o.status)?'is-old':''}"><strong><bdi>${e(o.item_code)}</bdi> · ${e(o.kind_name)}</strong>
      <span>${e(o.status_name)} · انفتح ${e(o.opened_on)}${o.closed_on?` · انقفل ${e(o.closed_on)}`:''}</span>
      <small>${e(o.description)}${o.vendor_note?` · ينفذها ${e(o.vendor_note)}`:''}${o.resolution?` — ${e(o.resolution)}`:''}${o.cost_minor?` · التكلفة ${e(money(o.cost_minor))} (<bdi>${e(o.cost_reference)}</bdi>)`:''}</small>
      ${bar(o.actions,o.id)}</li>`;
    const check=c=>`<li class="${c.status==='closed'?'is-old':c.missing.length?'is-due':''}"><strong>${e(c.name)}</strong>
      <span>${e(c.status_name)} · تأكدت ${e(c.confirmed)} من ${e(c.expected)}</span>
      <small>ما انمسحت للحين: ${e(c.missing.map(m=>`${m.code} ${m.name}`).join('، '))||'ولا شي'}</small>${c.closing_note?`<small class="subtle">${e(c.closing_note)}</small>`:''}
      ${bar(c.actions,c.id)}</li>`;
    const usage=data.utilization;
    return `<section class="panel panel-body vn-head"><p>${e(data.note)}</p>
      <div class="operation-actions">${button('create_item','','تسجيل قطعة')}${button('create_kit','','طقم جديد')}${data.custodians.length&&(data.items.some(i=>i.status==='available')||data.kits.some(k=>k.status==='active'&&k.bookable))?button('create_booking','','حجز جديد'):''}${button('open_order','','أمر عمل صيانة')}${button('start_check','','بدء جولة جرد')}</div></section>
      <section class="panel panel-body vn-board"><div class="vn-tiles">${ui.tile(data.items.filter(i=>i.status==='available').length,'قطعة متاحة')}${ui.tile(data.items.filter(i=>i.status==='in_use').length,'بعهدة')}${ui.tile(data.items.filter(i=>i.status==='maintenance').length,'في الصيانة')}${ui.tile(data.overdue,'تأخر إرجاعها',data.overdue?'is-late':'')}</div></section>
      <section class="panel panel-body vn-block"><h3>الحجوزات</h3>${list(data.bookings.map(booking),'ما فيه حجوزات.')}</section>
      <section class="panel panel-body vn-block"><h3>القطع</h3><p class="subtle">الرمز يفتح صفحة القطعة داخل المنصة لما ينمسح من الجوال؛ وتأكيد الوجود من جولة الجرد المفتوحة.</p>${list(data.items.map(item),'ما فيه قطع مسجلة.')}</section>
      <section class="panel panel-body vn-block"><h3>الأطقم</h3>${list(data.kits.map(kit_),'ما فيه أطقم.')}</section>
      <section class="panel panel-body vn-block"><h3>الصيانة</h3>${list(data.work_orders.map(order),'ما فيه أوامر عمل.')}</section>
      <section class="panel panel-body vn-block"><h3>الجرد</h3>${list(data.checks.map(check),'ما فيه جولات جرد.')}</section>
      <section class="panel panel-body vn-block"><h3>الاستغلال (${e(usage.from)} لين ${e(usage.to)})</h3><p class="subtle">${e(usage.note)}</p>
      ${list(usage.items.map(i=>`<li><strong><bdi>${e(i.code)}</bdi> · ${e(i.name)}</strong><span>${e(pct(i.utilisation_bp))} من الأيام · ${e(i.used_days)} يوم تسليم · ${e(i.bookings)} حجز</span></li>`),'ما فيه قطع.')}</section>`;
  },
  form(action,id,data){
    guard(data.can_manage||action==='hand_out');
    if(action==='create_item')return {title:'تسجيل قطعة',endpoint:'/equipment/items',idempotent:true,fields:itemFields(data,null),toPayload:itemPayload};
    if(action==='create_kit')return {title:'طقم جديد',endpoint:'/equipment/kits',idempotent:true,fields:[field('name','اسم الطقم'),field('notes','ملاحظات','textarea',{required:false})],toPayload:v=>({name:v.name,notes:v.notes||''})};
    if(action==='open_order'||action==='open_work_order'){
      const i=data.items.find(x=>x.id===id);
      return {title:'أمر عمل صيانة',endpoint:'/equipment/work-orders',idempotent:true,fields:[
        field('item_id','القطعة','select',{value:i?.id,options:data.items.filter(x=>!['lost','retired'].includes(x.status)).map(x=>({value:x.id,label:`${x.code} — ${x.name}`}))}),
        field('kind','النوع','select',{options:data.maintenance_kinds.map(k=>({value:k.key,label:k.name}))}),field('description','وش المطلوب','textarea')],
        toPayload:v=>({item_id:v.item_id,kind:v.kind,description:v.description})};
    }
    if(action==='start_check')return {title:'بدء جولة جرد',endpoint:'/equipment/inventory',idempotent:true,fields:[field('name','اسم الجولة')],toPayload:v=>({name:v.name})};
    if(action==='create_booking'||action==='book_item'||action==='book_kit'){
      guard(data.custodians.length);
      const kit=action==='book_kit'?data.kits.find(k=>k.id===id):null,item=action==='book_item'?data.items.find(i=>i.id===id):null;
      const targets=[...data.items.filter(i=>i.status==='available').map(i=>({value:`item:${i.id}`,label:`قطعة: ${i.code} — ${i.name}`})),...data.kits.filter(k=>k.status==='active'&&k.bookable).map(k=>({value:`kit:${k.id}`,label:`طقم: ${k.code} — ${k.name}`}))];
      guard(targets.length);
      return {title:'حجز معدات',endpoint:'/equipment/bookings',idempotent:true,fields:[
        field('target','المحجوز','select',{value:kit?`kit:${kit.id}`:item?`item:${item.id}`:'',options:targets}),
        field('custodian_id','من يستلم العهدة','select',{options:data.custodians.map(c=>({value:c.id,label:c.name})),hint:'اللي يحجز ويسلّم مو هو اللي يستلم.'}),
        field('start_date','من','date',{value:data.today}),field('end_date','إلى','date',{value:data.today}),
        field('purpose','سبب الحجز','textarea'),
        // الإنتاج قبل المشروع (الترحيل 193): الحجز على إنتاج ياخذ مشروع الإنتاج، ومشروعٌ مسمّى غيره يرفضه الخادم برفض مكتوب.
        field('production_id','الإنتاج','select',{required:false,options:[{value:'',label:'بدون ربط بإنتاج'},...(data.productions??[]).map(p=>({value:p.id,label:`${p.code} — ${p.title}`}))],
          hint:'الإنتاجات اللي للحين في التحضير ولا قيد التصوير.'}),
        field('project_id','المشروع','select',{required:false,options:optional(data.projects,'دون مشروع'),hint:'إذا اخترت إنتاج خلّه فاضي: الحجز ياخذ مشروع الإنتاج. ومشروع غير مشروع الإنتاج ينرفض.'}),
        field('production_ref','ملاحظة الإنتاج أو التصوير','text',{required:false,hint:'مثل يوم التصوير الثاني. وإذا ما اخترت إنتاج وكتبت رمز إنتاج قائم بالضبط، ينربط فيه.'})],
        toPayload:v=>{const [kind,value]=String(v.target).split(':');return {item_id:kind==='item'?value:'',kit_id:kind==='kit'?value:'',custodian_id:v.custodian_id,
          start_date:v.start_date,end_date:v.end_date,purpose:v.purpose,production_id:v.production_id||'',project_id:v.project_id||'',production_ref:v.production_ref||''};}};
    }
    const b=data.bookings.find(x=>x.id===id);
    if(b&&Object.hasOwn(bookingRoutes,action)){
      guard(b.actions.includes(action));
      const spec=(fields,toPayload=v=>v)=>({title:`${labels[action]} — ${b.item_code} ${b.item_name}`,endpoint:`/equipment/bookings/${id}/${bookingRoutes[action]}`,fields,toPayload:v=>({version:b.version,...toPayload(v)})});
      if(action==='cancel_booking')return spec([field('note','سبب الإلغاء','textarea')],v=>({note:v.note}));
      return spec(movementFields(data,action==='hand_out'?'أقر باستلام العهدة ومسؤوليتي عنها حتى إعادتها':'أقر باستلام القطعة في المخزن بحالتها الموصوفة'),movementPayload);
    }
    const i=data.items.find(x=>x.id===id);
    if(i&&Object.hasOwn(itemRoutes,action)){
      guard(i.actions.includes(action));
      const spec=(fields,toPayload=v=>v)=>({title:`${labels[action]} — ${i.code} ${i.name}`,endpoint:`/equipment/items/${id}/${itemRoutes[action]}`,fields,toPayload:v=>({version:i.version,...toPayload(v)})});
      if(action==='edit_item')return spec(itemFields(data,i),itemPayload);
      const hints={report_lost:'وش صار ومتى انفقدت',confirm_lost:'أساس إقرار الفقد',reject_lost:'ليش ما تنحسب مفقودة',retire_item:'سبب الاستبعاد',return_to_service:'وش انصلح'};
      return spec([field('note',hints[action],'textarea',{hint:action==='confirm_lost'?'إقرار الفقد لمسؤول أعلى غير اللي بلّغ.':undefined})],v=>({note:v.note}));
    }
    const k=data.kits.find(x=>x.id===id);
    if(k&&['add_kit_item','remove_kit_item','archive_kit'].includes(action)){
      guard(k.actions.includes(action));
      const route={add_kit_item:'add_item',remove_kit_item:'remove_item',archive_kit:'archive'}[action];
      const spec=(fields,toPayload=v=>v)=>({title:`${labels[action]} — ${k.name}`,endpoint:`/equipment/kits/${id}/${route}`,fields,toPayload:v=>({version:k.version,...toPayload(v)})});
      if(action==='add_kit_item')return spec([field('item_id','القطعة','select',{options:data.items.filter(x=>!x.kit&&!['lost','retired'].includes(x.status)).map(x=>({value:x.id,label:`${x.code} — ${x.name}`}))})],v=>({item_id:v.item_id}));
      if(action==='remove_kit_item')return spec([field('item_id','القطعة','select',{options:k.items.map(x=>({value:x.id,label:`${x.code} — ${x.name}`}))})],v=>({item_id:v.item_id}));
      return spec([field('note','سبب الأرشفة','textarea')],v=>({note:v.note}));
    }
    const o=data.work_orders.find(x=>x.id===id);
    if(o&&Object.hasOwn(orderRoutes,action)){
      guard(o.actions.includes(action));
      const spec=(fields,toPayload=v=>v)=>({title:`${labels[action]} — ${o.item_code}`,endpoint:`/equipment/work-orders/${id}/${orderRoutes[action]}`,fields,toPayload:v=>({version:o.version,...toPayload(v)})});
      if(action==='start_work')return spec([field('vendor_note','مين ينفذها','text',{required:false})],v=>({vendor_note:v.vendor_note||''}));
      return spec([field('resolution',action==='complete_work'?'وش انجز':'سبب الإلغاء','textarea'),field('cost','تكلفة الصيانة بالريال','text',{required:false}),field('cost_reference','مرجع الفاتورة','text',{required:false})],
        v=>({resolution:v.resolution,cost:v.cost?String(v.cost).trim():'',cost_reference:v.cost_reference||''}));
    }
    const c=data.checks.find(x=>x.id===id);guard(c&&c.actions.includes(action));
    if(action==='scan_item')return {title:`تأكيد وجود قطعة — ${c.name}`,endpoint:`/equipment/inventory/${id}/scan`,fields:[
      field('item_id','القطعة','select',{options:c.missing.map(m=>({value:m.id,label:`${m.code} — ${m.name}`}))}),
      field('condition_state','حالتها زي ما شفتها','select',{options:data.conditions.map(x=>({value:x.key,label:x.name}))}),
      field('note','ملاحظة','text',{required:false})],toPayload:v=>({version:c.version,item_id:v.item_id,condition_state:v.condition_state,note:v.note||''})};
    return {title:`إقفال الجرد — ${c.name}`,endpoint:`/equipment/inventory/${id}/close`,fields:[field('note','خلاصة الجولة ووش اللي ما لقيتوه','textarea',{hint:'اللي بدأ الجرد ما يقفله.'})],toPayload:v=>({version:c.version,note:v.note})};
  }
};
