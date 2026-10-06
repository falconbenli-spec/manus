// ملفات السجلات: قائمة وتنزيل ورفع. تُحمَّل مع الصفحة بفهرس واحد لكل نوع سجل، ولا تكسر الصفحة إن تعذر الفهرس.
export async function attachFiles(api,data,type,ids){
  const list=[...new Set(ids)].slice(0,80);
  if(!list.length)return {...data,files:{}};
  try{return {...data,files:(await api(`/files?entity_type=${encodeURIComponent(type)}&ids=${list.join(',')}`)).index};}
  catch{return {...data,files:{},files_unavailable:true};}
}
const size=n=>n<1024?`${n} B`:n<1048576?`${Math.ceil(n/1024)} KB`:`${(n/1048576).toFixed(1)} MB`;
export function filesBlock(data,id,{e,button},operationId=id){
  const entry=data.files?.[id];
  // حالة الخطأ تقول ما حدث وما الخطوة التالية بلهجة المنصة. ما عداها من ترميز هذه الكتلة يُرسم داخل شاشات المالية والمشتريات
  // والعقود (vendors وcontracts وwps)، فلا يتغيّر هنا إلا مع مالكي تلك الشاشات.
  if(!entry)return data.files_unavailable?'<p class="subtle">ما قدرنا نحمّل قائمة الملفات الحين — حدّث الصفحة بعد شوي.</p>':'';
  const rows=entry.files.map(f=>`<li><strong>${e(f.label)}${f.restricted?' <span class="vn-flag is-warn">مقيد</span>':''}</strong><span><bdi dir="ltr">${e(f.filename)}</bdi> · ${e(size(f.size))} · ${e(f.uploaded_by_name)} · ${e(f.created_at.slice(0,10))}</span>${f.downloadable?`<a class="btn outline small" href="/api/files/${e(f.id)}">تنزيل</a>`:'<small class="subtle">التنزيل لحامل تصريح التحقق المالي.</small>'}</li>`).join('');
  if(!rows&&!entry.can_upload)return '';
  return `<div class="vn-block"><h3>الملفات <span class="subtle">${entry.files.length}</span></h3>${rows?`<ul class="vn-list">${rows}</ul>`:'<p class="subtle">لا ملفات مرفوعة.</p>'}${entry.can_upload?`<div class="operation-actions">${button('upload_file',operationId,'رفع ملف')}</div>`:''}</div>`;
}
export function fileForm(type,id,title,{restrictable=false}={}){
  return {title:`رفع ملف — ${title}`,endpoint:'/files',idempotent:true,fields:[
    {name:'label',label:'وصف الملف',type:'text',maxLength:180,hint:'مثال: السجل التجاري، خطاب الاعتماد الموقع، صورة الإيصال.'},
    {name:'file',label:'الملف',type:'file',hint:'PDF أو PNG أو JPEG حتى 2 ميغابايت. الملف ما ينعدّل ولا ينحذف بعد رفعه.'},
    ...(restrictable?[{name:'restricted',label:'تقييد الاطلاع',type:'select',options:[{value:'no',label:'لكل من يرى السجل'},{value:'yes',label:'مقيد — إثبات حساب بنكي'}]}]:[])],
    toPayload:v=>({entity_type:type,entity_id:id,label:v.label,filename:v.file.filename,content:v.file.content,...(restrictable?{restricted:v.restricted==='yes'}:{})})};
}
