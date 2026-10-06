// رموز الواجهة من مكتبة الأيقونات الواحدة (icons.mjs، لغة SF البصرية بقرار المالك 1 أكتوبر 2026).
import { icon } from './icons.mjs';
const app=document.querySelector('#app');
let lastMain=null,lastFocus=null,tourIndex=0,tourStops=[];
const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const popup=document.createElement('dialog');popup.className='journey-dialog';popup.id='journey-dialog';popup.setAttribute('aria-labelledby','journey-title');document.body.append(popup);
const destinations=()=>[...document.querySelectorAll('.sidebar .nav a')].filter(a=>/^#[a-z-]+$/.test(a.getAttribute('href'))).map(a=>({href:a.getAttribute('href'),title:a.textContent.trim(),key:a.getAttribute('href').slice(1)}));
const close=()=>{popup.close();if(lastFocus?.isConnected)lastFocus.focus();};
function open(){lastFocus=document.activeElement;if(!popup.open)popup.showModal();}
function header(title){return `<header><h2 id="journey-title">${escape(title)}</h2><button type="button" class="journey-tool" data-journey-action="close" aria-label="إغلاق">${icon('close')}</button></header>`;}
function search(){
 const links=destinations();if(!links.length)return;
 popup.innerHTML=header('إلى أين تريد أن تصل؟')+'<label class="sr-only" for="journey-search">ابحث في المساحات المتاحة لك</label><input id="journey-search" type="search" autocomplete="off" placeholder="اكتب اسم مساحة العمل…"><div class="journey-results"></div><p class="journey-help">تنقّل بزر Tab، وافتح بزر Enter. اضغط Escape للعودة.</p>';
 const list=popup.querySelector('.journey-results');
 const paint=q=>{const rows=links.filter(l=>l.title.includes(q));list.innerHTML=rows.map(l=>`<a href="${escape(l.href)}" data-journey-link><span>${escape(l.title)}</span>${icon('chevron','is-directional')}</a>`).join('')||'<p class="journey-empty" role="status">لا توجد مساحة مطابقة ضمن خيارات حسابك.</p>';};
 paint('');popup.querySelector('input').addEventListener('input',event=>paint(event.target.value.trim()));open();popup.querySelector('input').focus();
}
function paintTour(){
 const step=tourStops[tourIndex];
 popup.innerHTML=header(step.title)+`<span class="journey-tour-counter">محطة ${tourIndex+1} من ${tourStops.length}</span><p class="journey-tour-copy">${escape(step.copy)}</p><div class="journey-tour-controls"><button type="button" class="btn outline" data-journey-action="previous" ${tourIndex===0?'disabled':''}>السابقة</button><a class="btn primary" href="${escape(step.href)}" data-journey-link>افتح المحطة ${icon('chevron','is-directional')}</a><button type="button" class="btn outline" data-journey-action="next">${tourIndex===tourStops.length-1?'إنهاء الجولة':'التالي'}</button></div><p class="journey-help">جولة تعريفية فقط؛ لا تنشئ طلبات ولا تغيّر بياناتك.</p>`;
 popup.querySelector('[data-journey-action=next]').focus();
}
function tour(){
 const allowed=new Set(destinations().map(d=>d.href));
 tourStops=[{href:'#work',title:'01 — مساحة ليومك',copy:'ابدأ بالعمل اليومي: رتّب مهامك الخاصة، وافتح المهام المسندة إليك وما ينتظر قرارك من مكان واحد.'},{href:'#catalog',title:'02 — لكل احتياج، طريق',copy:'استكشف القطاع ثم الإدارة والقسم، أو ابحث مباشرة عن الخدمة. ستعرف الحقول المطلوبة ومسار الاعتماد قبل إرسال طلبك.'},{href:'#requests',title:'03 — تابع الأثر',copy:'بعد التقديم، تابع حالة الطلب والموافقات والمهام والمرفقات. وعند الإنجاز، يمكنك تقييم الخدمة من تفاصيل طلبك.'}].filter(s=>allowed.has(s.href));
 if(!tourStops.length){search();return;}tourIndex=0;open();paintTour();
}
function decorate(){
 const shell=app.querySelector('.shell'),top=app.querySelector('.topbar-actions');
 if(!shell){if(popup.open)close();return;}
 if(top&&!top.querySelector('.journey-tools')){
  const controls=document.createElement('div');controls.className='journey-tools';
  controls.innerHTML='<button type="button" class="journey-tool journey-mobile-menu" data-journey-action="menu" aria-label="فتح قائمة التنقل" aria-expanded="false">'+icon('menu')+'</button><button type="button" class="journey-tool" data-journey-action="search" aria-label="الانتقال السريع — Command أو Control مع K">انتقال سريع <kbd>⌘ K</kbd></button><button type="button" class="journey-tool" data-journey-action="tour" aria-label="جولة تعريفية">جولة تعريفية</button>';
  top.prepend(controls);
  const side=app.querySelector('.sidebar');const closeButton=document.createElement('button');closeButton.type='button';closeButton.className='journey-tool journey-mobile-menu journey-sidebar-close';closeButton.dataset.journeyAction='menu';closeButton.textContent='إغلاق القائمة ✕';side?.prepend(closeButton);
 }
 const main=app.querySelector('#main');if(main&&main!==lastMain){lastMain=main;main.classList.add('journey-enter');}
}
document.addEventListener('click',event=>{
 const link=event.target.closest('[data-journey-link]');if(link){close();return;}
 const button=event.target.closest('[data-journey-action]');if(!button)return;
 const action=button.dataset.journeyAction;
 if(action==='search')search();
 if(action==='tour')tour();
 if(action==='close')close();
 if(action==='next'){if(tourIndex===tourStops.length-1)close();else{tourIndex++;paintTour();}}
 if(action==='previous'&&tourIndex>0){tourIndex--;paintTour();}
 if(action==='menu'){const side=app.querySelector('.sidebar');const expanded=side?.classList.toggle('journey-open');app.querySelector('[aria-expanded]')?.setAttribute('aria-expanded',String(!!expanded));if(expanded)side.querySelector('button')?.focus();}
});
document.addEventListener('keydown',event=>{
 if((event.metaKey||event.ctrlKey)&&event.key.toLowerCase()==='k'&&destinations().length){event.preventDefault();search();}
 if(event.key==='Escape'){app.querySelector('.sidebar')?.classList.remove('journey-open');app.querySelector('[aria-expanded]')?.setAttribute('aria-expanded','false');}
});
popup.addEventListener('close',()=>{if(lastFocus?.isConnected)lastFocus.focus();});
window.addEventListener('hashchange',()=>{app.querySelector('.sidebar')?.classList.remove('journey-open');if(popup.open)close();});
new MutationObserver(decorate).observe(app,{childList:true,subtree:true});decorate();
