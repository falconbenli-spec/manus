import { icon } from './icons.mjs';
// «الفراغ 360» — طبقة سلوك الغلاف. تراقب ما يرسمه app.mjs وتضيف إليه، ولا تغيّر منطق المنصة ولا نصوص وحداتها.
// تملك: سمات <html> (العقد 2)، والعناصر المحقونة (العقد 3)، ودورة حياة الحلقة ضد واجهة المحرك (العقد 4)،
// ومشهد الفهرس حوارًا في كل المقاسات، ولوحة الأوامر (⌘K)، وشريط التبويب، وسحب الصفائح على الجوال.
// لا سمات style في الترميز؛ ما يتحرك يُضبط عبر CSSOM، وهو مسموح تحت سياسة أمن المحتوى. لا فرع هنا يذكر اسم تصميم:
// التصاميم الثلاثة رموز CSS، وهذه الوحدة تراقب data-design وdata-theme ولا تكتبهما.
import { mountBackdrop } from './motion-cards.mjs';
import { mountDepth } from './depth-scene.mjs';

const root=document.documentElement;
const media=query=>{try{return matchMedia(query).matches;}catch{return false;}};
// رمز CSS محسوب على <html>. السلوك الذي يختلف بين التصاميم يُقرأ من رموزها (--scene-3d، --ring-live، --sidebar-docked)، لا من اسمها.
const token=name=>{try{return getComputedStyle(root).getPropertyValue(name).trim();}catch{return '';}};
const scene3d=()=>token('--scene-3d')==='1';
const reduced=()=>media('(prefers-reduced-motion: reduce)');
const compact=()=>{try{return matchMedia('(max-width: 1023.98px)').matches;}catch{return true;}};
const sheet=()=>media('(max-width: 759.98px)');
const shortLandscape=()=>media('(max-height: 600px)');
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fold=text=>String(text??'').normalize('NFKD').replace(/[ً-ٰٟـ]/g,'').replace(/[أإآ]/g,'ا').replace(/ى/g,'ي').replace(/ة/g,'ه').toLowerCase();
const isAr=()=>(root.lang||'ar')==='ar';
const t=(ar,en)=>isAr()?ar:en;
const store={
  get(key){try{return localStorage.getItem(key);}catch{return null;}},
  set(key,value){try{localStorage.setItem(key,value);}catch{}},
  remove(key){try{localStorage.removeItem(key);}catch{}}
};
const warn=(where,error)=>{try{console.warn('[signature]',where,error);}catch{}};
const safe=(where,fn)=>{try{return fn();}catch(error){warn(where,error);}};
const enhanceOff=()=>store.get('36t-enhance-off')==='1';
const setAttr=(el,name,value)=>{if(el.getAttribute(name)!==value)el.setAttribute(name,value);};
const setText=(el,value)=>{if(el.textContent!==value)el.textContent=value;};
const make=(tag,className,text)=>{const el=document.createElement(tag);if(className)el.className=className;if(text!==undefined)el.textContent=text;return el;};
const icons={search:'search',index:'checklist',service:'sparkles',mode:'theme',design:'design',motion:'pause',density:'density'};
const iconNode=(name,tint='gray')=>{const span=make('span',`nav-icon tint-${tint}`);span.setAttribute('aria-hidden','true');span.innerHTML=icon(icons[name]);return span;};
const navLabel=a=>(a.querySelector('.nav-label')?.textContent||a.textContent||'').trim();

// ===== العقد 2: سمات <html> — متزامنة عند الإقلاع وعند hashchange ومع كل رسم، من خرائط مسارات ثابتة =====
const STAGE=new Set(['home','portal','departments','catalog','executive']);
const LEDGER=new Set(['payroll','finance','accounts','reports','statements','requests','notifications','bank-reconciliation','vat-worksheet','withholding','wps','payroll-parallel','timesheets','resourcing','requirements']);
const SENSITIVE=new Set(['payroll','hr-cases','compensation','security','payroll-extras','payroll-anomaly','wps','contracts','wage-reconciliation','payroll-parallel','benefits','performance']);
const HERO=new Set(['home','portal']);
const DENSITIES=['cozy','compact'];
const routeKey=()=>{const key=(location.hash.slice(1)||'home').split('?')[0].split('/')[0];return /^[a-z0-9-]{1,64}$/i.test(key)?key:'unknown';};
const data=(name,value)=>{if(value===null||value===undefined){if(name in root.dataset)delete root.dataset[name];}else if(root.dataset[name]!==value)root.dataset[name]=value;};
const motionPaused=()=>store.get('36t-motion-paused')==='true';
const still=()=>reduced()||motionPaused();
let wasLogin=false,thresholdTimer=0;
function syncAttrs(){
  const login=!!document.querySelector('#app > .login'),shell=!!document.querySelector('#app > .shell');
  const route=login?'login':routeKey();
  let scene='off';
  if(login)scene=shortLandscape()?'off':'login';
  else if(shell&&root.classList.contains('is-menu-open')&&!compact())scene='index';
  else if(shell&&HERO.has(route))scene='home';
  data('tier',login||STAGE.has(route)?'stage':LEDGER.has(route)?'ledger':'desk');
  data('route',route);
  data('scene',scene);
  if(login){
    // العدّ يخص جلسة انتهت: لا يبقى على صفحة الدخول ولا يرثه الحساب التالي على الجهاز نفسه.
    data('inbox',null);searchAllowed=null;wasLogin=true;
    root.classList.remove('is-menu-open');
  }else if(shell&&wasLogin){
    // لحظة العبور: 400ms مرة عند نجاح الدخول. الصنف يُضاف ويُزال بمؤقت بلا transition، فتُعرض ساكنةً مع إيقاف الحركة.
    wasLogin=false;loginSubmitted=false;
    root.classList.add('is-threshold');clearTimeout(thresholdTimer);
    thresholdTimer=setTimeout(()=>root.classList.remove('is-threshold'),400);
  }
}
function syncPreferences(){
  data('motion',motionPaused()?'off':null);
  // الكثافة تُكتب عند اختيار صريح فقط؛ غياب السمة = افتراضي الطبقة (الدفتر 44px).
  const density=store.get('36t-density');
  data('density',DENSITIES.includes(density)?density:null);
}
// لون شريط المتصفح من --canvas المحسوبة: لا لون حرفي في JS، فيتبع التصميم والوضع والمشهد تلقائيًا.
function syncThemeColor(){
  const meta=document.querySelector('meta[name="theme-color"]');if(!meta)return;
  const value=getComputedStyle(root).getPropertyValue('--canvas').trim();
  if(/^(#[0-9a-f]{3,8}|rgba?\([\d\s.,%/]+\))$/i.test(value))setAttr(meta,'content',value);
}

// ===== العدّ التصاعدي: ≤ 400ms، مرة لكل مسار في الجلسة؛ ملغى في الدفتر والمسارات الحساسة ومع إيقاف الحركة =====
const COUNT='.vn-tile strong,.stat-number,.pt-tile strong,.ex-figure strong,.ex-step strong,.acc-stats strong,.hr-focus strong,.figure b';
const NUM='.vn-tile strong,.stat-number,.pt-tile strong,.ex-figure strong,.ex-step strong,.acc-stats strong,.figure b,.sig-eye b';
const NUMERIC=/^[\d\s.,:%+\-–SAR]+$/;
const counted=new Set((()=>{try{const list=JSON.parse(sessionStorage.getItem('36t-counted')||'[]');return Array.isArray(list)?list:[];}catch{return [];}})());
function countUp(el,animate){
  if(el.dataset.sigCounted)return;
  el.dataset.sigCounted='1';
  const raw=el.textContent.trim(),n=Number(raw);
  if(!animate||!/^\d{1,6}$/.test(raw)||!Number.isFinite(n)||n===0)return;
  const start=performance.now(),dur=Math.min(400,220+Math.min(n,60)*3);
  el.setAttribute('data-sig-counting','');
  const step=now=>{
    if(!el.isConnected)return;
    const k=Math.min(1,(now-start)/dur),eased=1-Math.pow(1-k,3);
    el.textContent=k<1?String(Math.round(n*eased)):raw;
    if(k<1)requestAnimationFrame(step);else el.removeAttribute('data-sig-counting');
  };
  requestAnimationFrame(step);
}
function mountCounts(scope){
  const route=root.dataset.route||'',first=!counted.has(route);
  const animate=first&&!still()&&root.dataset.motion!=='off'&&root.dataset.tier!=='ledger'&&!SENSITIVE.has(route);
  const targets=scope.querySelectorAll(COUNT);
  for(const el of targets)countUp(el,animate);
  if(targets.length&&first){counted.add(route);try{sessionStorage.setItem('36t-counted',JSON.stringify([...counted]));}catch{}}
}
// التتبّع السالب قاعدة واحدة في CSS على [data-num]؛ السمة تقع على عناصر قائمة العدّ حين يكون نصها رقميًا فقط، وتُزال إن تغيّر.
function markNumbers(scope){
  for(const el of scope.querySelectorAll(NUM)){
    const text=el.textContent.trim(),numeric=NUMERIC.test(text)&&/\d/.test(text);
    if(numeric){if(!el.hasAttribute('data-num'))el.setAttribute('data-num','');}
    else if(el.hasAttribute('data-num'))el.removeAttribute('data-num');
  }
}

// ===== لوحة الأوامر: الشاشات والخدمات، ⌘K أو Ctrl+K فقط (لا اختصار بحرف واحد) =====
let palette=null,paletteItems=[],paletteIndex=0,paletteTurn=0,servicesCache=null,servicesAt=0,paletteReturn=null,searchAllowed=null;
async function loadServices(){
  if(servicesCache&&performance.now()-servicesAt<60000)return servicesCache;
  try{const r=await fetch('/api/catalog',{credentials:'same-origin'});if(!r.ok)return servicesCache=[];servicesCache=await r.json();servicesAt=performance.now();return servicesCache;}catch{return servicesCache=[];}
}
// «بحث شامل عن …» يظهر لمن يملك search.use فقط: التصريح للجميع عدا حساب الأدمن غير الأول ما لم يُمنح له،
// والخادم يرفض /api/search بدونه. يُقرأ مرة من /api/me (قراءة خالصة) ويُنسى عند ظهور صفحة الدخول.
async function canSearch(){
  if(searchAllowed!==null)return searchAllowed;
  try{
    const r=await fetch('/api/me',{credentials:'same-origin'});if(!r.ok)return false;
    const body=await r.json();
    return searchAllowed=Array.isArray(body?.user?.can)&&body.user.can.includes('search.use');
  }catch{return false;}
}
// رمز الشاشة يُنسخ من عنصر القائمة الذي رسمته المنصة نفسها، فهو ترميز موثوق.
function navItems(){return [...document.querySelectorAll('.nav a[href^="#"]')].map(a=>({kind:'page',label:navLabel(a),icon:a.querySelector('.nav-icon')?.outerHTML||'',href:a.getAttribute('href')}));}
function ensurePalette(){
  if(palette)return palette;
  palette=make('div','sig-cmd');palette.hidden=true;palette.setAttribute('role','dialog');palette.setAttribute('aria-modal','true');palette.setAttribute('aria-label',t('بحث','Search'));
  palette.innerHTML=`<div class="sig-cmd-box"><label class="sig-cmd-input">${icon(icons.search)}<input type="search" autocomplete="off" enterkeyhint="go" aria-label="${t('بحث في الشاشات والخدمات','Search screens and services')}"><button type="button" class="sig-cmd-cancel">${t('إلغاء','Cancel')}</button></label><div class="sig-cmd-list" role="listbox"></div><div class="sig-cmd-foot"><span><kbd>↑</kbd><kbd>↓</kbd> ${t('تنقّل','Move')}</span><span><kbd>↩</kbd> ${t('فتح','Open')}</span><span><kbd>Esc</kbd> ${t('إغلاق','Close')}</span></div></div>`;
  document.body.append(palette);
  const input=palette.querySelector('input'),list=palette.querySelector('.sig-cmd-list');
  palette.addEventListener('click',e=>{if(e.target===palette||e.target.closest('.sig-cmd-cancel'))closePalette();});
  input.addEventListener('input',()=>renderPalette(input.value));
  input.addEventListener('keydown',e=>{
    if(e.key==='ArrowDown'){e.preventDefault();paletteIndex=Math.min(paletteItems.length-1,paletteIndex+1);highlight();}
    else if(e.key==='ArrowUp'){e.preventDefault();paletteIndex=Math.max(0,paletteIndex-1);highlight();}
    else if(e.key==='Enter'){e.preventDefault();choose(paletteItems[paletteIndex]);}
    // Esc يُعالَج على مستوى المستند (أسفل الملف) حتى يعمل من أي عنصر داخل اللوحة، لا من الحقل وحده.
  });
  list.addEventListener('click',e=>{const b=e.target.closest('[data-index]');if(b)choose(paletteItems[Number(b.dataset.index)]);});
  return palette;
}
function highlight(){palette.querySelectorAll('.sig-cmd-item').forEach((el,i)=>{el.classList.toggle('is-active',i===paletteIndex);el.setAttribute('aria-selected',String(i===paletteIndex));if(i===paletteIndex)el.scrollIntoView({block:'nearest'});});}
async function renderPalette(query){
  const turn=++paletteTurn,list=palette.querySelector('.sig-cmd-list');
  const text=String(query??'').trim(),terms=fold(text).split(/\s+/).filter(Boolean);
  const pages=navItems();
  const [catalog,searchable]=await Promise.all([loadServices(),terms.length?canSearch():false]);
  if(turn!==paletteTurn||!palette||palette.hidden)return;
  const services=catalog.map(s=>({kind:'service',id:s.id,label:s.name_ar,icon:`<span class="nav-icon tint-green" aria-hidden="true">${icon(icons.service)}</span>`,hint:[s.section,s.description].filter(Boolean).join(' · '),search:fold([s.name_ar,s.name_en,s.section,s.code,s.description].join(' '))}));
  const match=item=>!terms.length||terms.every(x=>fold(item.label).includes(x)||(item.search||'').includes(x));
  const foundPages=pages.filter(match).slice(0,terms.length?20:8),foundServices=services.filter(match).slice(0,terms.length?12:6);
  paletteItems=[...foundPages,...foundServices];paletteIndex=0;
  let i=0;
  const kind=item=>item.kind==='service'?t('طلب','Request'):t('شاشة','Screen');
  const section=(title,items)=>items.length?`<p class="sig-cmd-group">${title}</p><div class="sig-cmd-rows">${items.map(it=>`<button type="button" class="sig-cmd-item" role="option" aria-selected="false" data-index="${i++}">${it.icon}<span><strong>${esc(it.label)}</strong>${it.hint?`<small>${esc(it.hint)}</small>`:''}</span><b>${kind(it)}</b></button>`).join('')}</div>`:'';
  list.innerHTML=section(t('الشاشات','Screens'),foundPages)+section(t('الخدمات','Services'),foundServices);
  if(searchable){
    // السطر الأخير: ينقل إلى #search/<الكلمة> (الصيغة التي تقرؤها search-ui.mjs). يُبنى بـDOM وtextContent لأن فيه نص المستخدم.
    const item={kind:'search',query:text},rows=make('div','sig-cmd-rows'),row=make('button','sig-cmd-item');
    row.type='button';row.setAttribute('role','option');row.setAttribute('aria-selected','false');row.dataset.index=String(paletteItems.length);
    const copy=make('span');copy.append(make('strong','',t(`بحث شامل عن «${text}»`,`Search everything for “${text}”`)),make('small','',t('في كل ما تملك فتحه: العملاء والطلبات والمشاريع والسياسات','Across everything you can open')));
    row.append(iconNode('search'),copy,make('b','',t('بحث','Search')));
    rows.append(row);list.append(make('p','sig-cmd-group',t('البحث الشامل','Global search')),rows);
    paletteItems.push(item);
  }
  if(!paletteItems.length){list.replaceChildren(make('p','sig-cmd-empty',t('لا نتيجة. جرّب كلمة أقصر أو اسم الإدارة.','No results. Try a shorter word or a department name.')));return;}
  highlight();
}
function choose(item){
  if(!item)return;
  closePalette(false);
  if(item.kind==='page'){location.hash=item.href.slice(1);return;}
  if(item.kind==='search'){location.hash='search/'+encodeURIComponent(item.query);return;}
  // فتح نموذج الخدمة عبر مسار التطبيق نفسه
  const app=document.querySelector('#app');if(!app)return;
  const trigger=make('button');trigger.type='button';trigger.hidden=true;trigger.dataset.action='new-request';trigger.dataset.id=item.id;
  app.append(trigger);trigger.click();setTimeout(()=>trigger.remove(),0);
}
// اللوحة aria-modal فعلًا: ما خلفها inert ما دامت مفتوحة. هي ابنة <body> خارج #app فتبقى تفاعلية.
// #app لا .stage: syncDrawer() تملك inert على .stage و.sig-tabs وتعيد كتابته مع كل رسم. كتابة محروسة كما هناك.
function sealPage(on){for(const el of document.querySelectorAll('#app,body > .skip'))if(el.inert!==on)el.inert=on;}
function openPalette(){
  // نافذة showModal() في الطبقة العليا تجعل اللوحة (ابنة <body>) خاملة وتحتها: لا تُفتح فوق نافذة مفتوحة.
  if(!document.querySelector('.nav')||document.querySelector('dialog[open]'))return;
  closeDrawer(false);paletteReturn=document.activeElement;
  ensurePalette();palette.hidden=false;root.classList.add('is-searching');sealPage(true);
  const input=palette.querySelector('input');input.placeholder=t('ابحث في الشاشات والخدمات','Search screens and services');input.value='';renderPalette('');input.focus();
}
function closePalette(restore=true){if(!palette||palette.hidden)return;paletteTurn++;palette.hidden=true;root.classList.remove('is-searching');sealPage(false);if(restore&&paletteReturn?.isConnected)paletteReturn.focus();}

// ===== مشهد الفهرس: حوار في كل المقاسات (لا شريط جانبي دائم). compact() للتبويب السفلي والسحب فقط =====
let drawerReturn=null,drawerEntry=false,drawerHref=null;
// شريط جانبي مثبَّت: التصميم يعلنه برمز --sidebar-docked:1 (من 1024). عندها الفهرس معلم aside عادي ظاهر دائمًا:
// لا حوار ولا inert ولا is-menu-open، وزر «الفهرس» يركّز سطر البحث فقط. يُعاد تقييمه عند عبور 1024 وعند تغيّر التصميم.
const docked=()=>!compact()&&token('--sidebar-docked')==='1';
function syncDrawer(){
  const dock=docked();
  if(dock&&root.classList.contains('is-menu-open')){root.classList.remove('is-menu-open');safe('attrs',syncAttrs);}
  const open=root.classList.contains('is-menu-open');
  // كتابات محروسة: enhance() تستدعي هذه مع كل رسم، فلا تُكتب سمة بقيمتها نفسها.
  for(const el of document.querySelectorAll('.stage,.sig-tabs,body > .skip'))if(el.inert!==open)el.inert=open;
  for(const b of document.querySelectorAll('[data-shell="drawer"]'))setAttr(b,'aria-expanded',String(open));
  const side=document.querySelector('.sidebar');
  if(!side)return;
  if(dock){for(const name of ['role','aria-modal'])if(side.hasAttribute(name))side.removeAttribute(name);if(side.inert)side.inert=false;}
  else{setAttr(side,'role','dialog');setAttr(side,'aria-modal',String(open));if(side.inert===open)side.inert=!open;}
}
function openDrawer(){
  const side=document.querySelector('.sidebar');if(!side)return;
  if(docked()){side.querySelector('#nav-search')?.focus({preventScroll:true});return;}
  drawerReturn=document.activeElement;
  // ت1: «رجوع» يغلق الصفيحة ولا يغادر الصفحة. فتحها يضيف قيدًا بالعنوان نفسه (لا hashchange)، ورجوع المتصفح يسحبه فيُغلقها (popstate أدناه).
  if(!drawerEntry){try{history.pushState({sigDrawer:1},'');drawerEntry=true;}catch{}}
  root.classList.add('is-menu-open');syncAttrs();syncDrawer();
  // كل فتح للفهرس يبدأ المدار من مجموعة الشاشة الحالية (بلا حركة)، لا من آخر موضع أُدير إليه.
  orbitNav=null;safe('orbit',()=>syncOrbit());
  if(compact()){side.scrollTop=0;side.querySelector('.side-done')?.focus({preventScroll:true});}
  // المكتب: سطر البحث مركَّز فورًا. الجوال: زر الإغلاق، حتى لا تقفز لوحة المفاتيح فوق الفهرس.
  else (side.querySelector('#nav-search')??side.querySelector('.side-done'))?.focus({preventScroll:true});
  afterDrawer();
}
// pop: الإغلاق باليد (Esc، زر الإغلاق، الخلفية، السحب) يسحب قيد الفتح من السجل، فلا يبقى «رجوع» ميت. الإغلاق بسبب تنقل أو بسبب
// رجوع المتصفح نفسه لا يسحب شيئًا.
function closeDrawer(restore=true,pop=restore){
  if(!root.classList.contains('is-menu-open'))return;
  if(pop&&drawerEntry){drawerEntry=false;try{history.back();}catch{}}
  root.classList.remove('is-menu-open');syncAttrs();syncDrawer();
  document.querySelector('.sidebar')?.style.removeProperty('--drag');
  if(restore&&drawerReturn?.isConnected)drawerReturn.focus({preventScroll:true});
  afterDrawer();
}
// الأرض قد تتبدل مع المشهد (الرموز تقرر)، والفهرس المعتم على الجوال يحجب الحلقة فلا ترسم تحته.
function afterDrawer(){
  safe('theme-color',syncThemeColor);safe('scene',()=>applyScene());
  if(compact()&&liveScene())root.classList.contains('is-menu-open')?engine('pause'):wake();
}

// ===== شريط التبويب: أربع وجهات يومية بترتيب ثابت ثم زر «الفهرس» =====
// أربع وجهات يومية لكل الجماهير بترتيب واحد — الرئيسية، عملي (بشارته)، الخدمات، طلباتي — ثم زر الفهرس،
// والفهرس هو القائمة الجانبية نفسها في صفيحة. وجهة لا مدخل لها في قائمة الحساب لا تأخذ خانة.
const tabOrders={employee:['home','work','services','my-requests'],staff:['home','work','services','my-requests']};
const tabNames={home:['الرئيسية','Home'],work:['عملي','My work'],services:['الخدمات','Services'],'my-requests':['طلباتي','My requests']};
function mountTabs(shell,nav){
  if(shell.querySelector('.sig-tabs'))return;
  const employee=root.dataset.audience==='employee';
  // الوجهات الأربع تُطلب من القائمة كلها: المدخل الظاهر أولًا، ثم كتلة «كل شاشاتك» المخفية لما لا مدخل ظاهرًا له.
  // منذ القائمة الجديدة (أقسامٌ ثمانية) صارت #work و#services و#my-requests في تلك الكتلة وحدها لبعض الحسابات،
  // فكان الشريط لا يجد إلا «الرئيسية» — والمدير يقرر من جواله (قياس 30 سبتمبر). يحرسه tests/phone-dock.test.mjs.
  const all=[...nav.querySelectorAll('a[href^="#"]')],inReach=a=>!!a.closest('[data-nav-reach]'),links=new Map();
  for(const a of [...all.filter(a=>!inReach(a)),...all.filter(inReach)]){const k=a.getAttribute('href').slice(1);if(!links.has(k))links.set(k,a);}
  const keys=tabOrders[employee?'employee':'staff'].filter(k=>links.has(k)).slice(0,4);
  const view=routeKey(),inTabs=keys.includes(view);
  const tabs=make('nav','sig-tabs');tabs.setAttribute('aria-label',t('التنقل السريع','Quick navigation'));
  const name=(k,a)=>t(...(tabNames[k]||[navLabel(a),navLabel(a)]));
  tabs.innerHTML=keys.map(k=>{const a=links.get(k);return `<a href="#${esc(k)}" class="${k===view?'active':''}" ${k===view?'aria-current="page"':''}>${a.querySelector('.nav-icon svg')?.outerHTML||''}${a.querySelector('.nav-count')?.outerHTML||''}<span>${esc(name(k,a))}</span></a>`;}).join('')
    +`<button type="button" data-shell="drawer" class="${inTabs?'':'active'}" aria-controls="app-sidebar" aria-haspopup="dialog" aria-expanded="false">${icon(icons.index)}<span>${employee?t('المزيد','More'):t('الفهرس','Index')}</span></button>`;
  shell.append(tabs);
}

// ===== العنوان الكبير يصغر إلى الشريط العلوي عند التمرير (الجوال؛ على المكتب يخفيه CSS) =====
let titleObserver=null,observedTitle=null;
function mountTitle(scope){
  const bar=scope.querySelector('.topbar'),heading=scope.querySelector('#main h1');
  if(!bar)return;
  if(!heading){bar.classList.toggle('is-condensed',!scope.querySelector('#main .loading'));return;}
  if(heading===observedTitle)return;
  titleObserver?.disconnect();observedTitle=heading;
  const text=heading.textContent.replace(/\s+/g,' ').trim(),label=bar.querySelector('.topbar-title');
  if(label&&text)label.textContent=text;
  bar.classList.remove('is-condensed');
  if(!('IntersectionObserver' in window)){bar.classList.add('is-condensed');return;}
  const top=Math.round(bar.getBoundingClientRect().height)||56;
  titleObserver=new IntersectionObserver(([entry])=>{const bar2=document.querySelector('.topbar');if(bar2)bar2.classList.toggle('is-condensed',!entry.isIntersecting&&entry.boundingClientRect.top<top);},{rootMargin:`-${top}px 0px 0px 0px`,threshold:0});
  titleObserver.observe(heading);
}

// ===== مجموعات الفهرس: أكورديون على الجوال يتذكر ما فُتح باليد؛ على المكتب كلها مفتوحة والطي معطَّل =====
const opened=new Set((()=>{try{const list=JSON.parse(sessionStorage.getItem('36t-nav-open')||'[]');return Array.isArray(list)?list:[];}catch{return [];}})());
let sideScroll=0;
function syncGroups(side){
  const desk=!compact();
  for(const group of side.querySelectorAll('details.hr-nav-group')){
    const summary=group.querySelector(':scope > summary');
    if(desk){
      if(!group.open){group.dataset.sigFolded='1';group.open=true;}
      if(summary&&summary.getAttribute('tabindex')!=='-1')summary.tabIndex=-1;
    }else{
      if(group.dataset.sigFolded){delete group.dataset.sigFolded;if(!document.querySelector('#nav-search')?.value)group.open=opened.has(group.dataset.group)||!!group.querySelector('a.active');}
      if(summary?.hasAttribute('tabindex'))summary.removeAttribute('tabindex');
    }
  }
}
function mountNav(scope){
  const side=scope.querySelector('.sidebar');if(!side)return;
  if(!side.dataset.sigNav){
    side.dataset.sigNav='1';
    for(const group of side.querySelectorAll('.hr-nav-group')){
      if(opened.has(group.dataset.group))group.open=true;
      group.addEventListener('toggle',()=>{
        if(!compact()||document.querySelector('#nav-search')?.value)return;
        group.open?opened.add(group.dataset.group):opened.delete(group.dataset.group);
        try{sessionStorage.setItem('36t-nav-open',JSON.stringify([...opened]));}catch{}
      });
    }
    // الفهرس يُعاد رسمه مع كل رسم (تبديل الوضع أو اللغة وهو مفتوح)؛ نعيد موضع تمريره حتى لا يقفز إلى الأعلى.
    // الموضع يُلتقط عند النقر داخل الفهرس (معالج الالتقاط أدناه): لا مستمع scroll في هذه الوحدة.
    if(root.classList.contains('is-menu-open'))side.scrollTop=sideScroll;
  }
  syncGroups(side);
}

// ===== سحب الصفيحة إلى الأسفل لإغلاقها: الفهرس تحت 1024، والحوار تحت 760 (من 760 نافذة وسطية بلا سحب) =====
function dragToDismiss(panel,handle,dismiss,canDismiss=()=>true,active=compact){
  if(!panel||!handle||handle.dataset.sigDrag)return;
  handle.dataset.sigDrag='1';
  let y0=null,dy=0,t0=0;
  handle.addEventListener('pointerdown',e=>{if(e.button>0||!active()||e.target.closest('button,a,input,select,textarea'))return;y0=e.clientY;dy=0;t0=performance.now();panel.classList.add('is-dragging');handle.setPointerCapture?.(e.pointerId);});
  handle.addEventListener('pointermove',e=>{if(y0===null)return;dy=Math.max(0,e.clientY-y0);panel.style.setProperty('--drag',`${dy}px`);});
  const end=()=>{if(y0===null)return;const fast=dy/(performance.now()-t0)>.6;y0=null;panel.classList.remove('is-dragging');
    if((dy>120||(fast&&dy>40))&&canDismiss())dismiss();
    panel.style.removeProperty('--drag');};
  handle.addEventListener('pointerup',end);handle.addEventListener('pointercancel',end);
}
const dirty=dialog=>[...dialog.querySelectorAll('input:not([type=hidden]):not([type=search]),textarea')].some(el=>el.type==='checkbox'||el.type==='radio'?el.checked!==el.defaultChecked:el.value!==el.defaultValue);
function closeDialog(dialog){if(!dialog)return;if(dialog.open&&!dialog.dispatchEvent(new Event('cancel',{cancelable:true})))return;try{if(dialog.open)dialog.close();}catch{}dialog.removeAttribute('open');}

// ===== بحث داخل شاشات البطاقات عند تجاوز ست بطاقات، دون طلب للخادم =====
function mountCardFilter(scope){
  const main=scope.querySelector?.('#main')??(scope.id==='main'?scope:null);if(!main||main.querySelector('.sig-filter'))return;
  const cards=[...main.querySelectorAll('.vn-card')];if(cards.length<=6)return;
  const first=main.querySelector('.vn-group');if(!first)return;
  const box=make('label','sig-filter');box.innerHTML=`${icon(icons.search)}<input type="search" enterkeyhint="search" placeholder="${t('ابحث في القائمة بالاسم أو الرقم أو الحالة','Filter by name, number or status')}" aria-label="${t('بحث في القائمة','Filter the list')}"><output aria-live="polite"></output>`;
  first.before(box);
  const input=box.querySelector('input'),count=box.querySelector('output');
  input.addEventListener('input',()=>{
    const terms=fold(input.value).split(/\s+/).filter(Boolean);let shown=0;
    for(const card of main.querySelectorAll('.vn-card')){const hit=!terms.length||terms.every(x=>fold(card.textContent).includes(x));card.hidden=!hit;if(hit)shown++;}
    for(const group of main.querySelectorAll('.vn-group'))group.hidden=!group.querySelector('.vn-card:not([hidden])')&&!!group.querySelector('.vn-card');
    count.textContent=terms.length?t(`${shown} نتيجة`,`${shown} results`):'';
  });
}

// ===== العقد 3: المحقونات. كل واحدة متكررة الأمان، داخل safe()، وخلف علم التعطيل 36t-enhance-off =====
const themeNames={auto:['يتبع الجهاز','Follows device'],dark:['داكن','Dark'],light:['فاتح','Light']};
// أسماء عرض فقط لتسمية زر التصميم (كما في DESIGN_LIST في app/preferences.mjs)؛ لا فرع سلوك على اسم تصميم.
const designNames={classicplus:['الكلاسيكي المطوّر','الكلاسيكي المطوّر'],studio:['مدار 360','مدار 360'],depth:['كوكبة 360','Constellation 360'],classic:['الكلاسيكي','Classic'],void:['الفراغ','VOID'],field:['الحقل 77','FIELD 77'],slate:['الفحمي','SLATE']};
const activeLink=()=>document.querySelector('.nav a.active[href^="#"]');
const activeGroup=()=>activeLink()?.closest('details.hr-nav-group')?.dataset.group||'';

// عنقود المظهر في الشريط العلوي: التصميم (يفتح قائمة app.mjs)، ثم الوضع بتفاعل واحد، ثم اللغة. الأزرار الثلاثة تحمل data-action،
// وتفويض app.mjs القائم على المستند هو الذي يبدّل ويحفظ ويحترم القفل. هذه الوحدة لا تكتب data-design أبدًا.
// app.mjs يعيد رسم الهيكل كله بعد التبديل فيُتلف الزر المركَّز؛ نتذكر نوعه وموضعه ونعيد التركيز إلى بديله (WCAG 2.4.3).
// اختيار تصميم من القائمة (pick-design) يُنسب إلى زر التصميم الذي فتحها: هو وحده aria-expanded="true" ساعة النقر.
let themeRefocus=null;
const themeTargets={
  theme:{side:'.sidebar [data-action="theme"]',bar:'.topbar > .sig-appearance > .sig-theme',login:'.login [data-action="theme"]'},
  design:{side:'.sidebar [data-action="design"]',bar:'.topbar > .sig-appearance > .sig-design',login:'.login [data-action="design"]'},
  language:{side:'.sidebar [data-action="language"]',bar:'.topbar > .sig-appearance > .sig-language',login:'.login [data-action="language"]'}
};
function restoreThemeFocus(){
  const memo=themeRefocus;if(!memo)return;
  if(performance.now()-memo.at>5000){themeRefocus=null;return;}
  // الزر الأصلي ما زال في الصفحة: لم يُعَد الرسم بعد (أو المظهر مقفل فلن يُعاد)، فلا شيء يُستعاد الآن.
  if(memo.el.isConnected)return;
  themeRefocus=null;
  const active=document.activeElement;
  if(active&&active!==document.body&&active.isConnected)return;
  if(document.querySelector('dialog[open]')||(palette&&!palette.hidden))return;
  document.querySelector(themeTargets[memo.kind]?.[memo.where])?.focus({preventScroll:true});
}
// ما يُذكر عند النقر (مرحلة الالتقاط، قبل أن يعيد app.mjs الرسم): الزر ونوعه وموضعه، بشرط أن يكون التركيز فيه أو في قائمة التصميم.
function rememberAppearanceFocus(target){
  const pick=target?.closest?.('#design-menu [data-action="pick-design"]');
  const button=pick?document.querySelector('[data-action="design"][aria-expanded="true"]'):target?.closest?.('[data-action="theme"],[data-action="design"],[data-action="language"]');
  const focused=pick?!!document.activeElement?.closest?.('#design-menu'):!!button?.contains(document.activeElement);
  themeRefocus=button&&focused?{el:button,kind:button.dataset.action,where:button.closest('.sidebar')?'side':button.closest('.login')?'login':'bar',at:performance.now()}:null;
}
function mountAppearanceCluster(scope){
  const bar=scope.querySelector('.topbar');if(!bar)return;
  let box=bar.querySelector(':scope > .sig-appearance');
  if(!box){
    box=make('div','sig-appearance');
    const design=make('button','sig-design');design.type='button';design.dataset.action='design';design.setAttribute('aria-haspopup','menu');design.setAttribute('aria-expanded','false');design.innerHTML=icon(icons.design);
    const theme=make('button','sig-theme');theme.type='button';theme.dataset.action='theme';theme.innerHTML=icon(icons.mode);
    const language=make('button','sig-language');language.type='button';language.dataset.action='language';
    box.append(design,theme,language);bar.append(box);
  }
  const design=box.querySelector(':scope > .sig-design'),theme=box.querySelector(':scope > .sig-theme'),language=box.querySelector(':scope > .sig-language');
  const designLabel=`${t('التصميم','Design')}: ${t(...(designNames[root.dataset.design]||designNames.depth))}`;
  if(design){setAttr(design,'aria-label',designLabel);setAttr(design,'title',designLabel);}
  const label=`${t('الوضع','Mode')}: ${t(...(themeNames[root.dataset.theme]||themeNames.dark))}`;
  if(theme){setAttr(theme,'aria-label',label);setAttr(theme,'title',label);}
  // زر اللغة يعرض اللغة التي ينقل إليها: EN في العربية، و«ع» في الإنجليزية.
  if(language){const ar=isAr(),name=ar?'English':'العربية';setText(language,ar?'EN':'ع');setAttr(language,'lang',ar?'en':'ar');setAttr(language,'aria-label',name);setAttr(language,'title',name);}
}

// صف الشاشات الشقيقة (المكتب فقط): اسم المجموعة ← روابط القسم الذي فيه الشاشة الحالية ← «المزيد».
// بلا a.active (#search، #request/<id>) يبقى الصف فارغًا وارتفاعه المحجوز في CSS قائمًا. الطي بقياس العرض الفعلي.
// الطي بسمة hidden لا بحذف العقد: مراقب #app يرى childList فقط، فلا يعيد الطيُّ جدولةَ enhance() (لا حلقة).
// reset=true (بناء جديد أو تغيّر العرض) يعيد الكل ثم يطوي من الآخر؛ وبدونها يطوي فقط إن ظهر فيضان (وصول الخط مثلًا).
let siblingsObserver=null;
function foldSiblings(nav,reset=false){
  const links=nav.sigLinks||[];if(!links.length)return;
  if(reset)for(const a of links)if(a.hidden)a.hidden=false;
  const over=()=>nav.scrollWidth>nav.clientWidth+1;
  for(let i=links.length-1;i>=0&&over();i--)if(!links[i].hidden&&!links[i].hasAttribute('aria-current'))links[i].hidden=true;
}
function mountSiblings(scope){
  const stage=scope.querySelector('.stage'),bar=stage?.querySelector(':scope > .topbar');if(!stage||!bar)return;
  let nav=stage.querySelector(':scope > .sig-siblings');
  if(compact()){nav?.remove();return;}
  const active=activeLink(),section=active?.closest('.hr-nav-section'),group=activeGroup();
  const rows=section?[...section.querySelectorAll('a[href^="#"]')].slice(0,7):[];
  const key=group+'|'+rows.map(a=>a.getAttribute('href')+(a===active?'*':'')).join(',')+'|'+root.lang;
  if(nav&&nav.dataset.sigKey===key)return;
  if(!nav){
    nav=make('nav','sig-siblings');bar.after(nav);
    if('ResizeObserver' in window){siblingsObserver?.disconnect();siblingsObserver=new ResizeObserver(()=>safe('siblings-fold',()=>{const live=document.querySelector('.stage > .sig-siblings');if(live)foldSiblings(live,true);}));siblingsObserver.observe(nav);}
  }
  nav.dataset.sigKey=key;nav.setAttribute('aria-label',t('شاشات القسم','Screens in this section'));
  const drawerButton=(className,text)=>{const b=make('button',className,text);b.type='button';b.dataset.shell='drawer';b.setAttribute('aria-controls','app-sidebar');b.setAttribute('aria-haspopup','dialog');b.setAttribute('aria-expanded','false');return b;};
  const links=rows.map(a=>{const link=make('a','',navLabel(a));link.setAttribute('href',a.getAttribute('href'));if(a===active)link.setAttribute('aria-current','page');return link;});
  nav.sigLinks=links;
  if(active){nav.removeAttribute('data-sig-empty');nav.replaceChildren(drawerButton('sig-siblings-group',group||t('الفهرس','Index')),...links,drawerButton('sig-siblings-more',t('المزيد','More')));}
  else{nav.setAttribute('data-sig-empty','');nav.replaceChildren();}
}

// «الأخيرة»: آخر خمس شاشات. اللقطة تُثبَّت عند بدء الجلسة فلا يتبدل ترتيبها أثناء العمل؛ الزيارات تُسجَّل للجلسة التالية.
const readRecent=()=>{try{const list=JSON.parse(store.get('36t-recent')||'[]');return Array.isArray(list)?list.filter(k=>typeof k==='string'&&/^[a-z0-9-]{1,64}$/i.test(k)).slice(0,8):[];}catch{return [];}};
const recentSnapshot=readRecent();
function recordVisit(){
  const key=activeLink()?.getAttribute('href')?.slice(1);if(!key)return;
  const list=readRecent();if(list[0]===key)return;
  store.set('36t-recent',JSON.stringify([key,...list.filter(k=>k!==key)].slice(0,8)));
}
function mountRecent(scope){
  const side=scope.querySelector('.sidebar'),anchor=side?.querySelector('.nav-search-label');if(!side||!anchor||side.querySelector('.sig-recent'))return;
  const links=new Map([...side.querySelectorAll('.nav a[href^="#"]')].map(a=>[a.getAttribute('href').slice(1),a]));
  const keys=recentSnapshot.filter(k=>links.has(k)&&k!==routeKey()).slice(0,5);if(!keys.length)return;
  const list=make('ul','sig-recent'),title=t('الأخيرة','Recent');
  list.setAttribute('aria-label',title);list.dataset.sigTitle=title;
  for(const k of keys){const item=make('li'),link=make('a','',navLabel(links.get(k)));link.setAttribute('href','#'+k);item.append(link);list.append(item);}
  anchor.after(list);
}

// زرّا «إيقاف الحركة» و«الكثافة» في حساب الفهرس. الحركة تكتب html[data-motion=off] لأن المحرك ليس الحركة الوحيدة.
const densityNames={auto:['بحسب الشاشة','By screen'],cozy:['مريحة','Comfortable'],compact:['مدمجة','Compact']};
function paintAccountRow(button){
  const kind=button.dataset.sig,label=button.querySelector('.nav-label'),value=button.querySelector('.nav-value');
  if(kind==='motion'){
    const paused=motionPaused();
    // زر تبديل: التسمية ثابتة والحالة في aria-pressed وفي القيمة المرئية، فلا يقرأ القارئ الآلي «تشغيل، مضغوط».
    setText(label,t('إيقاف الحركة','Pause motion'));
    setText(value,paused?t('متوقفة','Paused'):t('تعمل','On'));
    setAttr(button,'aria-pressed',String(paused));
  }else{
    const density=root.dataset.density;
    setText(label,t('الكثافة','Density'));
    setText(value,t(...(densityNames[DENSITIES.includes(density)?density:'auto'])));
  }
}
function mountAccountRows(scope){
  const rows=scope.querySelector('.side-account .hr-nav-rows');if(!rows)return;
  for(const [kind,icon] of [['motion','motion'],['density','density']]){
    let button=rows.querySelector(`:scope > [data-sig="${kind}"]`);
    if(!button){
      button=make('button','nav-row');button.type='button';button.dataset.sig=kind;
      button.append(iconNode(icon),make('span','nav-label'),make('span','nav-value'));
      const last=rows.querySelector(':scope > .is-destructive');last?last.before(button):rows.append(button);
    }
    paintAccountRow(button);
  }
}
function toggleAccountRow(button){
  if(button.dataset.sig==='motion'){
    store.set('36t-motion-paused',String(!motionPaused()));syncPreferences();
    motionPaused()?engine('pause'):wake();
  }else{
    const current=DENSITIES.includes(root.dataset.density)?root.dataset.density:'auto',next={auto:'cozy',cozy:'compact',compact:'auto'}[current];
    next==='auto'?store.remove('36t-density'):store.set('36t-density',next);syncPreferences();
  }
  paintAccountRow(button);
}

// app.mjs تضيف span.nav-count إلى كل a[href="#work"] في المستند عند وصول العدّ، ومنها روابط محقونة هنا. العدّ مكانه
// الفهرس وشريط التبويب؛ في العين الرقم في <b> وحده، وفي الصف الشقيق و«الأخيرة» يظهر أو يغيب بحسب سباق الوصول، فيُزال.
function stripCounts(scope){
  for(const extra of scope.querySelectorAll('.sig-eye > .nav-count,.sig-siblings a > .nav-count,.sig-recent a > .nav-count'))extra.remove();
}

// رأس الصفحة: اسم المجموعة في data-sig-group (الاسم data-group محجوز)، وطول العنوان في is-long / is-xlong.
function mountPageHead(scope){
  const main=scope.querySelector('#main');if(!main)return;
  const lead=main.querySelector('.page-head > div:first-child'),group=activeGroup();
  if(lead){if(group)setAttr(lead,'data-sig-group',group);else lead.removeAttribute('data-sig-group');}
  const heading=main.querySelector('h1');
  if(heading&&!main.classList.contains('login')){
    const length=heading.textContent.replace(/\s+/g,' ').trim().length;
    heading.classList.toggle('is-xlong',length>48);heading.classList.toggle('is-long',length>24&&length<=48);
  }
}

// بطل الرئيسية/البوابة: التاريخان والتحية بالاسم الأول والجملة وعين الحلقة. كل النص من إشارتين فقط:
// html[data-inbox] (تكتبها app.mjs عند وصول العدّ) و.nav-count.is-late. غياب السمة = لم يصل العدّ أو فشل: «—» وجملة فارغة.
const zone='Asia/Riyadh',formats=new Map();
function format(locale,options){
  const key=locale+JSON.stringify(options);
  if(!formats.has(key))formats.set(key,new Intl.DateTimeFormat(locale,{...options,timeZone:zone}));
  return formats.get(key);
}
function riyadhClock(now=new Date()){
  const parts=Object.fromEntries(format('en-US',{weekday:'short',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(now).map(p=>[p.type,p.value]));
  return {day:parts.weekday,minutes:(Number(parts.hour)%24)*60+Number(parts.minute)};
}
function heroDate(now=new Date()){
  const long={weekday:'long',day:'numeric',month:'long',year:'numeric'},short={day:'numeric',month:'long',year:'numeric'};
  const hijri=safe('hijri',()=>format(isAr()?'ar-SA-u-ca-islamic-umalqura-nu-latn':'en-GB-u-ca-islamic-umalqura-nu-latn',long).format(now));
  const gregorian=format(isAr()?'ar-SA-u-ca-gregory-nu-latn':'en-GB-u-ca-gregory-nu-latn',hijri?short:long).format(now);
  return hijri?`${hijri} · ${gregorian}`:gregorian;
}
function inboxSignal(){
  const raw=root.dataset.inbox,pending=typeof raw==='string'&&/^\d{1,6}$/.test(raw)?Number(raw):null;
  return {pending,late:pending!==null&&pending>0&&!!document.querySelector('.nav a[href="#work"] .nav-count.is-late')};
}
function census({pending,late}){
  if(pending===null)return '';
  if(pending===0)return t('لا شيء ينتظر قرارك الآن.','Nothing is waiting for your decision.');
  if(!late)return t(`${pending} بانتظار قرارك.`,`${pending} waiting for your decision.`);
  const one=safe('plural',()=>new Intl.PluralRules(isAr()?'ar':'en').select(pending))==='one';
  return one?t(`${pending} بانتظار قرارك، وهو متأخر.`,`${pending} waiting for your decision, and it is late.`):t(`${pending} بانتظار قرارك، ومنها متأخر.`,`${pending} waiting for your decision, some of them late.`);
}
// الرقم في أول الجملة عنصر مستقل بأرقام لاتينية مجدولة ([data-num]): بخط الجسم الرفيع يشبه «1» اللاتيني الرقمَ الهندي «٦»
// (بلاغ المالك)، والأرقام المجدولة ترسمه بقاعدته كبقية أرقام المنصة. متكررة الأمان: لا تعيد البناء إن لم يتغير النص.
function paintCensus(el,text){
  const m=/^(\d+)(\D[\s\S]*)$/.exec(text),first=el.firstChild;
  if(el.textContent===text&&(!m||(first?.nodeType===1&&first.hasAttribute('data-num'))))return;
  if(!m){el.textContent=text;return;}
  const n=make('span','sig-census-n',m[1]);n.setAttribute('data-num','');n.setAttribute('dir','ltr');
  el.replaceChildren(n,m[2]);
}
let eyeObserver=null,observedEye=null;
function mountHero(scope){
  if(!HERO.has(routeKey()))return;
  // «ملخصي» تصدر section.journey-hero لا .page-head، ولها تحيتها وعنوانها: تُحقن فيها العين وحدها (المواصفة §4.2: مشهد home يغطي المسارين).
  const head=scope.querySelector('#main > .page-head'),journey=head?null:scope.querySelector('#main > .journey-hero'),host=head||journey;if(!host)return;
  const signal=inboxSignal();
  let anchor=host.lastElementChild;
  if(head){
    const lead=head.querySelector(':scope > div:first-child');if(!lead)return;
    const ensure=(tag,className,after)=>{let el=head.querySelector(`:scope > .${className}`);if(!el){el=make(tag,className);after.after(el);}return el;};
    const date=ensure('p','sig-date',lead),greeting=ensure('p','sig-greeting',date),sentence=ensure('p','sig-census',greeting);
    const first=(document.querySelector('.side-profile strong')?.textContent||'').trim().split(/\s+/)[0]||'';
    const morning=riyadhClock().minutes<720,hello=morning?t('صباح الخير','Good morning'):t('مساء الخير','Good evening');
    setText(date,heroDate());
    setText(greeting,first?t(`${hello}، ${first}.`,`${hello}, ${first}.`):`${hello}.`);
    paintCensus(sentence,census(signal));
    anchor=sentence;
  }
  let eye=host.querySelector(':scope > .sig-eye');
  if(!eye){eye=make('a','sig-eye');eye.setAttribute('href','#work');eye.append(make('b'),make('span'));anchor?anchor.after(eye):host.append(eye);}
  setText(eye.querySelector('b'),signal.pending===null?'—':String(signal.pending));
  setText(eye.querySelector('span'),signal.pending===0?t('لا شيء ينتظرك','Nothing waiting'):t('بانتظار قرارك','waiting for your decision'));
  if(signal.pending===null)setAttr(eye,'aria-label',t('عملي','My work'));else eye.removeAttribute('aria-label');
  // تغيّر تخطيط البطل (وصول الخط، سطر يلتف، العدّ) يعيد قياس المشهد ومحظوراته: العين والبطل كلاهما مراقَبان.
  if(eye!==observedEye&&'ResizeObserver' in window){eyeObserver?.disconnect();observedEye=eye;eyeObserver=new ResizeObserver(()=>schedule());eyeObserver.observe(eye);eyeObserver.observe(host);}
}

// أفعال رأس الشاشة: ما بعد الثالث يُنقل إلى details.sig-more «المزيد». نقل عقد لا إعادة كتابة: سمات data- تبقى فيعمل التفويض.
// لا يُطوى فعل وحيد: أربعة أفعال تبقى كما هي، ومن الخمسة فصاعدًا يبقى ثلاثة والباقي في «المزيد».
function mountMore(scope){
  for(const actions of scope.querySelectorAll('.vn-head .operation-actions')){
    if(actions.querySelector(':scope > .sig-more'))continue;
    const items=[...actions.children];if(items.length<=4)continue;
    const more=make('details','sig-more');more.append(make('summary','',t('المزيد','More')),...items.slice(3));
    actions.append(more);
  }
}
// سجل المعاملة: الخادم يرتبه تصاعديًا (ORDER BY seq)، فالأقدم هو أوله. يُنقل ما سبق الخمسة الأخيرة إلى «الأقدم (n)» أعلى السجل.
// يقتصر على شاشة تفاصيل الطلب: ترتيب بقية القوائم الزمنية لا يُعرف من الترميز، ولا يُخفى حدث بالتخمين.
function mountOlder(scope){
  if(routeKey()!=='request')return;
  for(const timeline of scope.querySelectorAll('#main .timeline')){
    if(timeline.querySelector(':scope > .sig-older'))continue;
    const items=[...timeline.querySelectorAll(':scope > .timeline-item')];if(items.length<=5)continue;
    const old=items.slice(0,items.length-5),older=make('details','sig-older');
    older.append(make('summary','',t(`الأقدم (${old.length})`,`Older (${old.length})`)));
    items[0].before(older);older.append(...old);
  }
}

// الجداول: تسمية كل خلية من رأس عمودها (صيغة السجل تحت 760)، وعدد الأعمدة حين لا يتجاوز ستة، وتسمية حقول الصفوف،
// وداخل template.content أيضًا فترثها الصفوف الجديدة بلا مراقب إضافي.
const tableSeen=new WeakMap();
function labelRow(row,labels){
  let column=0;
  for(const cell of row.children){
    const span=cell.colSpan||1,label=labels[column];
    if(cell.tagName==='TD'&&span===1&&label){
      setAttr(cell,'data-label',label);
      for(const field of cell.querySelectorAll('[data-col]'))if(!field.hasAttribute('aria-label'))field.setAttribute('aria-label',label);
    }
    column+=span;
  }
}
function mountTables(scope){
  for(const table of scope.querySelectorAll('table')){
    const head=table.tHead?.rows[table.tHead.rows.length-1];if(!head)continue;
    const labels=[];
    for(const th of head.cells){const text=th.textContent.replace(/\s+/g,' ').trim();for(let i=0;i<(th.colSpan||1);i++)labels.push(text);}
    const template=table.closest('.rows-field')?.querySelector(':scope > template');
    const key=labels.join('|')+'#'+table.rows.length;
    if(tableSeen.get(table)===key)continue;
    tableSeen.set(table,key);
    if(labels.length<=6)setAttr(table,'data-cols',String(labels.length));else table.removeAttribute('data-cols');
    for(const body of table.tBodies)for(const row of body.rows)labelRow(row,labels);
    if(template)for(const row of template.content.querySelectorAll('tr'))labelRow(row,labels);
  }
}
// صمام الرأس اللاصق: الجدول الأعرض من حاويته يستعيد التمرير الأفقي. قراءة تخطيط، فتأتي بعد كل كتابة.
function measureTables(scope){
  for(const wrap of scope.querySelectorAll('.table-wrap'))wrap.classList.toggle('is-wide',wrap.scrollWidth>wrap.clientWidth+1);
}

// قوس الطلب: 24 فاصلة على دائرة، في ثلاثة مسارات على الأكثر (منجز، حالي، قادم). سمات عرض فقط، والعلامات بلا دوران.
const SVG_NS='http://www.w3.org/2000/svg',ARC_FILL={done:'var(--ink-2)',current:'var(--turn)',next:'var(--ink-5)'};
function commaPath(cx,cy,scale,mirror){
  const points=mirror?[[0,0],[8.62,0],[13.73,10],[5.11,10]]:[[5.11,0],[13.73,0],[8.62,10],[0,10]];
  return 'M'+points.map(([x,y])=>`${(cx+(x-6.865)*scale).toFixed(2)} ${(cy+(y-5)*scale).toFixed(2)}`).join('L')+'z';
}
function mountArc(scope){
  for(const journey of scope.querySelectorAll('#main section.panel .journey')){
    const steps=[...journey.querySelectorAll(':scope > .journey-step')];if(!steps.length)continue;
    let current=false;
    const states=steps.map(step=>{
      const badge=step.querySelector('.badge');
      if(badge&&['approved','completed','skipped','done'].some(name=>badge.classList.contains(name)))return 'done';
      if(!current){current=true;return 'current';}
      return 'next';
    });
    const ltr=root.dir==='ltr',key=states.join(',')+(ltr?'|ltr':'');
    let arc=journey.parentElement.querySelector(':scope > .sig-arc');
    if(arc?.dataset.sigKey===key)continue;
    if(!arc){arc=document.createElementNS(SVG_NS,'svg');arc.setAttribute('class','sig-arc');journey.before(arc);}
    for(const [name,value] of [['viewBox','0 0 112 112'],['width','112'],['height','112'],['fill','currentColor'],['aria-hidden','true'],['focusable','false']])arc.setAttribute(name,value);
    arc.dataset.sigKey=key;
    const marks=Math.max(24,steps.length),shapes={done:'',current:'',next:''};
    for(let i=0;i<marks;i++){
      // من الساعة 12 عكس عقارب الساعة (الأمام في RTL)؛ وفي LTR مع العقارب. العلامة يسار المركز تُرسم معكوسة (الصيغة C).
      const angle=-Math.PI/2+(ltr?1:-1)*(i+.5)*(2*Math.PI/marks),x=56+46*Math.cos(angle),y=56+46*Math.sin(angle);
      shapes[states[Math.min(steps.length-1,Math.floor(i*steps.length/marks))]]+=commaPath(x,y,.62,x<56);
    }
    arc.replaceChildren(...Object.entries(shapes).filter(([,d])=>d).map(([state,d])=>{const path=document.createElementNS(SVG_NS,'path');path.setAttribute('d',d);path.setAttribute('data-state',state);path.setAttribute('fill',ARC_FILL[state]);return path;}));
  }
}

// ===== العقد 4: دورة حياة الحلقة. الهندسة تُمرَّر من هنا دائمًا؛ المحرك لا يقرأ DOM =====
let backdrop=null,sceneKey='',dataKey='',idleTimer=0,idleArmed=false,clockTimer=0,loginSubmitted=false,loginFlash=0,passwordFocused=false,fieldFocused=false;
// engineKind: '3d' (depth-scene.mjs على canvas.sig-depth) أو '2d' (mountBackdrop على canvas.sig-aurora). sceneName: آخر مشهد سُلِّم للمحرك فعلًا.
let engineKind='',engineCanvas=null,depthFailed=false,sceneName='off',pulseWanted=0;
const engine=(method,...args)=>{try{return backdrop?.[method]?.(...args);}catch(error){warn('engine.'+method,error);}};
const liveScene=()=>sceneName==='login'||sceneName==='home';
// اختيار المحرك من الرمز --scene-3d المحسوب (لا اسم تصميم هنا). متكرر الأمان: لا يفعل شيئًا إن كان المحرك المطلوب قائمًا،
// ويُستدعى عند الإقلاع ومع كل enhance() وعند تغيّر data-design. التبديل يهدم المحرك الحي ثم يركّب الآخر؛ وفشل WebGL يثبّت الثنائي.
// canvas.sig-depth ابنة مباشرة لـ<body> خارج #app: حجاب depth.css (#app::before) يقع بينها وبين كل نص.
function mountEngine(){
  const want=scene3d()&&!depthFailed?'3d':'2d';
  if(backdrop&&engineKind===want)return;
  if(backdrop){
    const was=engineKind,old=engineCanvas;engine('destroy');backdrop=null;
    // يُفرج عن سياق WebGL فورًا بدل انتظار جامع المهملات (للمتصفح حد أعلى لعدد السياقات الحية).
    if(was==='3d'&&old)safe('lose-context',()=>{for(const type of ['webgl2','webgl']){const gl=old.getContext(type);if(gl){gl.getExtension('WEBGL_lose_context')?.loseContext();break;}}});
  }
  for(const stale of document.querySelectorAll('body > canvas.sig-depth'))stale.remove();
  engineKind='';engineCanvas=null;sceneKey='';dataKey='';sceneName='off';clearTimeout(clockTimer);clearTimeout(idleTimer);
  if(want==='3d'){
    const canvas=make('canvas','sig-depth');canvas.setAttribute('aria-hidden','true');
    const aurora=document.querySelector('body > canvas.sig-aurora');aurora?aurora.after(canvas):document.body.prepend(canvas);
    const scene=safe('mountDepth',()=>mountDepth(canvas));
    if(scene?.ok){backdrop=scene;engineKind='3d';engineCanvas=canvas;armTilt();}
    else{depthFailed=true;safe('depth-destroy',()=>scene?.destroy?.());canvas.remove();}
  }
  if(!backdrop){
    let canvas=document.querySelector('canvas.sig-aurora');
    if(!canvas){canvas=make('canvas','sig-aurora');canvas.setAttribute('aria-hidden','true');document.body.prepend(canvas);}
    backdrop=safe('mountBackdrop',()=>mountBackdrop(canvas))||null;
    if(backdrop){engineKind='2d';engineCanvas=canvas;}
  }
}
// الإمالة بالجهاز (iOS يطلب الإذن داخل لمسة): أول pointerdown/touchstart، ثم click احتياطًا لأن WebKit لا يعدّ touchstart لمسة مفعِّلة.
// يُفكّ بعد النجاح أو بعد محاولة click، ويُسلَّح من جديد مع كل محرك ثلاثي الأبعاد جديد. لا شيء بلا المحرك الثلاثي.
const tiltEvents=['pointerdown','touchstart','click'];
let tiltArmed=false;
function tiltTap(event){
  if(engineKind!=='3d')return;
  const scene=backdrop,type=event.type;
  Promise.resolve(safe('enable-tilt',()=>scene?.enableTilt?.())).then(ok=>{if(ok||type==='click')disarmTilt();},()=>{if(type==='click')disarmTilt();});
}
function armTilt(){if(tiltArmed)return;tiltArmed=true;for(const type of tiltEvents)document.addEventListener(type,tiltTap,{capture:true,passive:true});}
function disarmTilt(){if(!tiltArmed)return;tiltArmed=false;for(const type of tiltEvents)document.removeEventListener(type,tiltTap,{capture:true});}
// --ring-x / --ring-y / --ring-r أطوال CSS (vw، vh، min()…): تُحل إلى بكسل بمسبار ثابت مخفي يُضبط عبر CSSOM.
let probe=null;
function cssLength(name,axis='width'){
  if(!probe){probe=make('div');probe.setAttribute('aria-hidden','true');probe.setAttribute('data-sig-probe','');
    for(const [k,v] of [['position','fixed'],['inset-block-start','0'],['inset-inline-start','0'],['visibility','hidden'],['pointer-events','none'],['padding','0'],['border','0'],['box-sizing','content-box']])probe.style.setProperty(k,v);
    document.body.append(probe);}
  probe.style.setProperty('width',axis==='width'?`var(${name})`:'0');probe.style.setProperty('height',axis==='height'?`var(${name})`:'0');
  const px=parseFloat(getComputedStyle(probe)[axis]);
  return Number.isFinite(px)?px:0;
}
const box=(el,origin,grow=0)=>{
  const r=el?.getBoundingClientRect();if(!r||(!r.width&&!r.height))return null;
  return {x:Math.round(r.left-origin.left-grow),y:Math.round(r.top-origin.top-grow),w:Math.round(r.width+grow*2),h:Math.round(r.height+grow*2)};
};
// مسرح الدماغ (بكسل اللوحة): الشريط الحر حول المركز، يحدّه أقرب نص فوقه وتحته يشاركه عموده (±half)، و`top` من فوق (أعلى البطل).
// المحرك يصغّر الدماغ حتى يسعه الشريط بهامش، ولا يكبّره أبدًا. كل الإحداثيات من صندوق اللوحة نفسها، فلا يغيّرها التمرير.
const STAGE_PAD=16,STAGE_GAP=20;
function stageAround(cx,cy,half,boxes,top,origin){
  let t=top,b=origin.height;
  for(const r of boxes){if(!r||r.x>cx+half||r.x+r.w<cx-half)continue;if(r.y+r.h<=cy)t=Math.max(t,r.y+r.h);else if(r.y>=cy)b=Math.min(b,r.y);}
  return {top:Math.round(t+STAGE_PAD),bottom:Math.round(b-STAGE_GAP),left:STAGE_PAD,right:Math.round(origin.width-STAGE_PAD)};
}
function sceneGeometry(name,canvas){
  // الأصل صندوق اللوحة: في مشاهد الدماغ هي مطلقة أعلى المستند (depth.css §1)، فالقياس نفسه عند أي موضع تمرير،
  // حتى لو جرى أثناء التمرير (وصول العدّ، استعادة المتصفح لموضع الصفحة، انطواء شريط iOS).
  const origin=canvas.getBoundingClientRect(),all=list=>list.filter(Boolean);
  if(name==='login'){
    const R=cssLength('--ring-r');if(!R)return null;
    const logo=document.querySelector('.login .brand .brand-svg'),safeArea=logo?logo.getBoundingClientRect().height*.675:0;
    // الدخول بلا مسرح محسوب: --ring-y و--ring-r و.story-copy (depth.css §5) تحجز له مكانه فوق النص، ومقاسه المعتمد يبقى كما هو.
    return {cx:Math.round(cssLength('--ring-x')),cy:Math.round(cssLength('--ring-y','height')),R:Math.round(R),
      exclude:all([...document.querySelectorAll('.login-card,.login-footer,.story-copy > *,.hr-values')].map(el=>box(el,origin)).concat(box(logo,origin,safeArea)))};
  }
  if(name==='home'){
    const eye=document.querySelector('#main > :is(.page-head,.journey-hero) > .sig-eye'),r=eye?.getBoundingClientRect();if(!r||!r.width)return null;
    // المحظور إخوة العين في البطل نفسه؛ وفي بطل «ملخصي» أبناء .journey-copy (صناديق النص لا الغلاف).
    const hero=eye.parentElement,texts=hero.matches('.journey-hero')?hero.querySelectorAll(':scope > .journey-copy > *,:scope > :not(.sig-eye,.journey-copy)'):hero.querySelectorAll(':scope > :not(.sig-eye)');
    const cx=Math.round(r.left+r.width/2-origin.left),cy=Math.round(r.top+r.height/2-origin.top),exclude=all([...texts].map(el=>box(el,origin)));
    // الجوال: المسرح من أعلى البطل (تحت الشريط العلوي) إلى سطر التاريخ؛ المكتب: النص في العمود الآخر فلا يحدّه.
    return {cx,cy,R:Math.round(r.width/2.24*100)/100,fit:stageAround(cx,cy,r.width/2,exclude,box(hero,origin)?.y??0,origin),exclude};
  }
  if(name==='index'){
    // الفاصلة العملاقة: صندوق بنسبة 760×554 عند حافة النهاية، متوسط رأسيًا؛ R نصف ارتفاعه. عمودا النص محظوران بارتفاع النافذة.
    // العرض يُلائم الشريط الحر بين الحافة وعمود .nav (الأعمدة الثلاثة في §5.3) فتقف الفاصلة كاملة، لا يقصّها الحظر إلى إسفين. دون 200px لا مشهد.
    const vw=root.clientWidth,vh=window.innerHeight,gutter=cssLength('--gutter')||64,ltr=root.dir==='ltr',navRect=document.querySelector('.sidebar .nav')?.getBoundingClientRect();
    const free=navRect&&navRect.width?(ltr?vw-navRect.right:navRect.left)-gutter:Infinity,w=Math.min(760,vw*.5,free);if(!(w>=200))return null;
    const h=w*554/760;
    const column=el=>{const r=el?.getBoundingClientRect();return r&&r.width?{x:Math.round(r.left-origin.left),y:0,w:Math.round(r.width),h:Math.round(vh)}:null;};
    return {cx:Math.round(ltr?vw-gutter-w/2:gutter+w/2),cy:Math.round(vh/2),R:Math.round(h/2),
      exclude:all([column(document.querySelector('.sidebar .nav')),column(document.querySelector('.sidebar .side-head')),column(document.querySelector('.sidebar .side-account'))])};
  }
  return null;
}
function applyScene(force=false){
  const canvas=engineCanvas;if(!backdrop||!canvas?.isConnected)return;
  // --ring-live:0 ⇒ الرموز تقول إن الحلقة الثنائية لا تُرى هنا (أرضية معتمة أو canvas مخفية): off في كل مشهد، والدخول منها.
  // المحرك الثلاثي تحكمه --scene-3d وحدها.
  const ringOff=engineKind!=='3d'&&token('--ring-live')==='0';
  const wanted=ringOff?'off':root.dataset.scene||'off',mirror=root.dir==='ltr';
  const geometry=wanted==='off'?null:sceneGeometry(wanted,canvas),name=geometry?wanted:'off';
  const key=JSON.stringify([engineKind,name,geometry,mirror]);
  if(!force&&key===sceneKey)return;
  sceneKey=key;sceneName=name;
  engine('setScene',name,geometry?{cx:geometry.cx,cy:geometry.cy,R:geometry.R,fit:geometry.fit,mirror}:{cx:0,cy:0,R:0,mirror});
  // دفعة الكاميرا عند التنقل (المحرك الثلاثي): تُطلب عند hashchange وتُنفَّذ مع أول مشهد حي للمسار الجديد خلال ثانيتين.
  if(pulseWanted&&name!=='off'){if(performance.now()-pulseWanted<2000&&engineKind==='3d'&&!still())engine('pulse');pulseWanted=0;}
  clearTimeout(clockTimer);
  if(name==='off'){clearTimeout(idleTimer);return;}
  // مشهد الفهرس في المحرك الثلاثي يدور ببطء: يُرفع عنه أي إيقاف سابق (حقل على الجوال، إيقاف الحركة ثم عودتها).
  if(name==='index'&&engineKind==='3d')still()||document.hidden?engine('pause'):engine('resume');
  engine('setExclusions',geometry.exclude);
  dataKey='';pushData();syncDim();
  if(name!=='index'){
    // wake() لا armIdle(): إيقاف سابق (تبويب مخفي أو حقل على الجوال) أثناء مسار غير مسرحي يبقى لاصقًا في المحرك، فيُرفع هنا بـresume.
    // fieldFocused يُعاد قياسه من العنصر المركَّز فعلًا: حقل أُزيل من DOM (نجاح الدخول) قد لا يطلق focusout.
    fieldFocused=editable(document.activeElement);
    still()||document.hidden||(fieldFocused&&compact())?engine('pause'):wake();
    // التقدم من الساعة: يُحدَّث كل دقيقة بمؤقت (لا rAF)، وفي مشاهد المسرح فقط.
    const tick=()=>{clockTimer=setTimeout(()=>{if(liveScene()){pushData();tick();}},60000);};tick();
  }
}
// ما مضى من 09:00–17:00 بتوقيت الرياض، الأحد–الخميس؛ خارج الدوام صفر.
function workdayProgress(){
  const {day,minutes}=riyadhClock();
  if(day==='Fri'||day==='Sat')return 0;
  return Math.round(Math.max(0,Math.min(1,(minutes-540)/480))*1000)/1000;
}
function pushData(){
  const scene=sceneName;if(!backdrop||(scene!=='login'&&scene!=='home'))return;
  const signal=scene==='home'?inboxSignal():{pending:null,late:false},flashing=scene==='login'&&loginFlash>0;
  // closed لا تُدّعى إلا بصفر صريح من الخادم، أو عند إرسال نموذج الدخول؛ وخطأ الدخول يفتح الفجوة ويحمّر شريحة الـ3% لـ900ms.
  const next={pending:signal.pending,late:signal.late||flashing,progress:workdayProgress(),closed:scene==='home'?signal.pending===0:loginSubmitted&&!flashing};
  const key=JSON.stringify(next);if(key===dataKey)return;
  const first=!dataKey;dataKey=key;
  engine('setData',next);
  if(!first)wake();
}
function wake(){
  if(!liveScene()||still()||document.hidden||(fieldFocused&&compact())||(compact()&&root.classList.contains('is-menu-open')))return;
  engine('resume');armIdle();
}
// سلّم الخمول في المحرك (توقف المكتب بعد 60s، وتجميد الجوال بعد 12s). بعد انقضائه يُسجَّل pointerdown واحد سلبي لمرة واحدة
// يستأنف الحركة، ويُعاد تسجيله عند كل تجميد، وفي مشاهد المسرح فقط. لا مستمع دائمًا.
function armIdle(){
  clearTimeout(idleTimer);
  if(!liveScene()||still())return;
  idleTimer=setTimeout(()=>{
    if(idleArmed||!liveScene())return;
    idleArmed=true;
    document.addEventListener('pointerdown',()=>{idleArmed=false;wake();},{passive:true,once:true});
  },compact()?12000:60000);
}
// الحلقة تخفت إلى 35% عند حقل كلمة المرور، وتغيب ما دامت لوحة المفاتيح مفتوحة في الدخول. صفر تفاعل مع أي ضغطة مفتاح.
function syncDim(){
  if(root.dataset.scene!=='login'){engine('dim',1);return;}
  engine('dim',root.classList.contains('is-kbd')?0:passwordFocused||document.querySelector('#app > .login.password-gate')?.35:1);
}
// حارس عنوان الدخول: إن تجاوز قطر صندوقه (قطر العين − 48px) ينزل درجة. يُقاس بعد fonts.ready ومع ResizeObserver.
let loginObserver=null,observedLoginTitle=null;
function guardLoginTitle(){
  const heading=document.querySelector('#app > .login .story-copy h1');if(!heading){observedLoginTitle=null;return;}
  const measure=()=>safe('login-title',()=>{
    if(!heading.isConnected||root.dataset.scene!=='login')return;
    const R=cssLength('--ring-r'),r=heading.getBoundingClientRect();
    if(R&&r.width&&Math.hypot(r.width,r.height)>R*1.44-48)heading.classList.add('is-long');
    applyScene();
  });
  if(heading!==observedLoginTitle){
    observedLoginTitle=heading;loginObserver?.disconnect();
    if('ResizeObserver' in window){loginObserver=new ResizeObserver(measure);loginObserver.observe(heading);}
    (document.fonts?.ready??Promise.resolve()).then(measure);
  }
}
let lastLoginError='';
function watchLoginError(){
  const text=(document.querySelector('#login-error')?.textContent||'').trim();
  if(text===lastLoginError)return;
  lastLoginError=text;if(!text)return;
  loginSubmitted=false;clearTimeout(loginFlash);
  loginFlash=setTimeout(()=>{loginFlash=0;pushData();},900);
  pushData();
}

// ===== مدار الفهرس (depth.css §11): --i لكل مجموعة ظاهرة، و--n و--orbit على .nav، عبر CSSOM فقط =====
// يعمل حين يعلن التصميم --scene-3d:1 ومن 1024؛ وإلا تُزال الخصائص الثلاث فيعود الفهرس عمودًا. ترتيب DOM لا يتغير (قارئ الشاشة يقرأ كما هو).
// السكون دائمًا عند -(i·360deg/n) بالضبط: البطاقة الأمامية بشفافية 1، وهو شرط نموذج التباين. التركيز يدير المدار إلى مجموعته.
// السحب (عتبة 6px تفصله عن النقر) والعجلة الأفقية والسهمان يديرونه. تقليل الحركة: قفز بلا حركة.
let orbitNav=null,orbitAt=0,orbitAngle=0,orbitTween=0,orbitTurn=0,orbitDrag=null,orbitWheel=0,orbitWheelAt=0,orbitBlockClick=false;
const wheelBound=new WeakSet();
const orbitGroups=nav=>[...nav.querySelectorAll(':scope > .hr-nav-group')];
const orbitCount=()=>Number(orbitNav?.style.getPropertyValue('--n'))||0;
const orbitLive=()=>!!orbitNav?.isConnected&&orbitCount()>0;
const orbitRest=(i,n)=>i===0?0:-(i*360/n);
function orbitSet(angle){orbitAngle=angle;orbitNav?.style.setProperty('--orbit',`${Math.round(angle*1000)/1000}deg`);}
function orbitStop(){if(orbitTween)cancelAnimationFrame(orbitTween);orbitTween=0;}
function orbitClear(nav){
  for(const name of ['--n','--orbit'])if(nav.style.getPropertyValue(name))nav.style.removeProperty(name);
  for(const group of orbitGroups(nav))if(group.style.getPropertyValue('--i'))group.style.removeProperty('--i');
}
function syncOrbit(reset=false){
  const nav=document.querySelector('.sidebar > .nav');
  if(nav!==orbitNav){orbitStop();orbitDrag=null;}
  if(!nav){orbitNav=null;return;}
  const all=orbitGroups(nav),groups=all.filter(g=>!g.hidden),n=groups.length;
  if(!scene3d()||compact()||!n){orbitClear(nav);if(orbitNav===nav)orbitStop();orbitNav=null;return;}
  for(const group of all){
    const i=groups.indexOf(group);
    if(i<0){if(group.style.getPropertyValue('--i'))group.style.removeProperty('--i');}
    else if(group.style.getPropertyValue('--i')!==String(i))group.style.setProperty('--i',String(i));
  }
  if(nav.style.getPropertyValue('--n')!==String(n))nav.style.setProperty('--n',String(n));
  const fresh=nav!==orbitNav;orbitNav=nav;
  // العجلة على .nav وحدها (لا مستمع غير سلبي على المستند يبطئ تمرير الصفحة). .nav جديدة مع كل رسم للهيكل.
  if(fresh&&!wheelBound.has(nav)){wheelBound.add(nav);nav.addEventListener('wheel',e=>safe('orbit-wheel',()=>orbitWheelTurn(e)),{passive:false});}
  if(fresh||reset){orbitStop();orbitAt=reset?0:Math.max(0,groups.findIndex(g=>g.querySelector('a.active')));orbitSet(orbitRest(orbitAt,n));}
  else if(orbitAt>=n){orbitStop();orbitAt=n-1;orbitSet(orbitRest(orbitAt,n));}
  else if(!orbitTween&&!orbitDrag&&!nav.style.getPropertyValue('--orbit'))orbitSet(orbitRest(orbitAt,n));
}
function orbitTo(index,animate=true){
  if(!orbitLive())return;
  const n=orbitCount(),i=((index%n)+n)%n,goal=orbitRest(i,n);orbitAt=i;orbitStop();
  const delta=((goal-orbitAngle)%360+540)%360-180;   // أقصر طريق حول الدائرة
  if(!animate||still()||root.dataset.motion==='off'||Math.abs(delta)<.01){orbitSet(goal);return;}
  const from=orbitAngle,t0=performance.now(),dur=Math.min(520,240+Math.abs(delta)*2);
  const step=now=>{const k=Math.min(1,(now-t0)/dur),eased=1-Math.pow(1-k,3);if(k<1){orbitSet(from+delta*eased);orbitTween=requestAnimationFrame(step);}else{orbitTween=0;orbitSet(goal);}};
  orbitTween=requestAnimationFrame(step);
  // صمام: إطارات مخنوقة (تبويب في الخلفية) لا تترك المدار بين موضعين؛ السكون عند الهدف مضمون بعد المدة.
  const token=++orbitTurn;setTimeout(()=>{if(token===orbitTurn&&orbitTween&&!orbitDrag){orbitStop();orbitSet(goal);}},dur+150);
}
// التركيز داخل بطاقة أدارها السحب أو العجلة بعيدًا يبقيها معتمة كاملة (:focus-within) فوق البطاقة الأمامية: ينتقل إلى أول رابط في الأمامية.
function orbitFollowFocus(){
  const active=document.activeElement;if(!inOrbit(active))return;
  const groups=orbitGroups(orbitNav).filter(g=>!g.hidden),front=groups[orbitAt];
  if(front&&!front.contains(active))front.querySelector('a[href]')?.focus({preventScroll:true});
}
const orbitNearest=()=>{const n=orbitCount();return n?((Math.round(-orbitAngle/(360/n))%n)+n)%n:0;};
const inOrbit=target=>orbitLive()&&!!target?.closest?.('.sidebar > .nav')&&target.closest('.sidebar > .nav')===orbitNav;
// كل مجموعة ظاهرة: السهم الأيمن يجلب البطاقة التي على اليمين (i+1)، والأيسر التي على اليسار؛ التركيز ينتقل إلى أول رابط فيها.
function orbitKey(e){
  if(!inOrbit(e.target)||e.altKey||e.ctrlKey||e.metaKey||(e.key!=='ArrowLeft'&&e.key!=='ArrowRight'))return;
  if(e.target.closest('input,textarea,select'))return;
  const groups=orbitGroups(orbitNav).filter(g=>!g.hidden),n=groups.length;if(n<2)return;
  const here=groups.indexOf(e.target.closest('.hr-nav-group')),from=here<0?orbitAt:here;
  const next=((from+(e.key==='ArrowRight'?1:-1))%n+n)%n;
  e.preventDefault();orbitTo(next);
  groups[next].querySelector('a[href],summary:not([tabindex="-1"])')?.focus({preventScroll:true});
}
function orbitPointerDown(e){
  if(e.button>0||!e.isPrimary||!inOrbit(e.target)||e.target.closest('input,textarea,select'))return;
  const group=orbitGroups(orbitNav).find(g=>!g.hidden);
  orbitDrag={id:e.pointerId,x:e.clientX,y:e.clientY,angle:orbitAngle,moved:false,w:group?.offsetWidth||420};   // عرض التخطيط لا المسقَط: البطاقة المائلة أضيق على الشاشة
}
function orbitPointerMove(e){
  const drag=orbitDrag;if(!drag||e.pointerId!==drag.id||!orbitLive())return;
  const dx=e.clientX-drag.x;
  if(!drag.moved){
    if(Math.hypot(dx,e.clientY-drag.y)<6)return;
    // سحب أفقي فقط؛ الحركة الرأسية تبقى للتمرير داخل البطاقة.
    if(Math.abs(dx)<Math.abs(e.clientY-drag.y)){orbitDrag=null;return;}
    drag.moved=true;orbitStop();try{orbitNav.setPointerCapture?.(drag.id);}catch{}
    try{window.getSelection?.()?.removeAllRanges();}catch{}
  }
  orbitSet(drag.angle+dx*(360/orbitCount())/drag.w);
}
function orbitPointerEnd(e){
  const drag=orbitDrag;if(!drag||e.pointerId!==drag.id)return;
  orbitDrag=null;
  if(!drag.moved)return;
  // النقر الذي يلي سحبًا لا يفتح رابطًا (يُلغى في مرحلة الالتقاط على window). مؤقت يمحو العلم إن لم يصل click.
  orbitBlockClick=true;setTimeout(()=>{orbitBlockClick=false;},0);
  try{orbitNav?.releasePointerCapture?.(drag.id);}catch{}
  orbitTo(orbitNearest());orbitFollowFocus();
}
function orbitWheelTurn(e){
  if(!inOrbit(e.target))return;
  const horizontal=Math.abs(e.deltaX)>Math.abs(e.deltaY),amount=horizontal?e.deltaX:e.shiftKey?e.deltaY:0;
  if(!amount)return;   // العجلة الرأسية تمرّر محتوى البطاقة كالمعتاد
  e.preventDefault();
  const now=performance.now();if(now-orbitWheelAt>400)orbitWheel=0;orbitWheelAt=now;
  orbitWheel+=amount;
  if(Math.abs(orbitWheel)>=48){const dir=Math.sign(orbitWheel);orbitWheel=0;orbitTo(orbitAt+dir);orbitFollowFocus();}
}
document.addEventListener('keydown',e=>safe('orbit-key',()=>orbitKey(e)));
document.addEventListener('pointerdown',e=>safe('orbit-down',()=>orbitPointerDown(e)),{passive:true});
document.addEventListener('pointermove',e=>{if(orbitDrag)safe('orbit-move',()=>orbitPointerMove(e));},{passive:true});
document.addEventListener('pointerup',e=>safe('orbit-up',()=>orbitPointerEnd(e)),{passive:true});
document.addEventListener('pointercancel',e=>{if(orbitDrag?.id===e.pointerId){const moved=orbitDrag.moved;orbitDrag=null;if(moved)orbitTo(orbitNearest());}},{passive:true});
document.addEventListener('dragstart',e=>{if(inOrbit(e.target))e.preventDefault();});   // سحب الرابط الأصلي يقطع السحب بـpointercancel
window.addEventListener('click',e=>{if(orbitBlockClick&&inOrbit(e.target)){orbitBlockClick=false;e.preventDefault();e.stopImmediatePropagation();}},true);
document.addEventListener('focusin',e=>{
  if(orbitDrag||!inOrbit(e.target))return;
  const groups=orbitGroups(orbitNav).filter(g=>!g.hidden),i=groups.indexOf(e.target.closest('.hr-nav-group'));
  if(i>=0&&(i!==orbitAt||orbitTween||Math.abs(orbitAngle-orbitRest(i,groups.length))>.01))orbitTo(i);
});
// app.mjs يطوي المجموعات غير المطابقة بسمة hidden عند الكتابة في «ابحث عن شاشة»: يُعاد الترقيم على الظاهرة ويسكن المدار عند أولها.
document.addEventListener('input',e=>{if(e.target?.id==='nav-search')safe('orbit',()=>syncOrbit(true));});

// ===== enhance(): متكررة الأمان. الكتابة أولًا، ثم قراءات التخطيط مرة واحدة في آخرها =====
function enhance(scope){
  safe('attrs',syncAttrs);
  const shell=scope.querySelector('.shell'),nav=scope.querySelector('.nav'),off=enhanceOff();
  if(shell&&nav){
    safe('nav',()=>mountNav(scope));safe('tabs',()=>mountTabs(shell,nav));safe('title',()=>mountTitle(scope));safe('drawer',syncDrawer);safe('orbit',()=>syncOrbit());
    safe('drag',()=>dragToDismiss(scope.querySelector('.sidebar'),scope.querySelector('.side-head'),()=>closeDrawer()));
    safe('visit',recordVisit);
  }else{root.classList.remove('is-menu-open');closePalette(false);titleObserver?.disconnect();observedTitle=null;}
  if(!off){
    if(shell&&nav){
      safe('appearance-cluster',()=>mountAppearanceCluster(scope));safe('siblings',()=>mountSiblings(scope));safe('recent',()=>mountRecent(scope));
      safe('account-rows',()=>mountAccountRows(scope));safe('page-head',()=>mountPageHead(scope));safe('hero',()=>mountHero(scope));
      safe('strip-counts',()=>stripCounts(scope));safe('more',()=>mountMore(scope));safe('older',()=>mountOlder(scope));safe('arc',()=>mountArc(scope));
    }
    safe('card-filter',()=>mountCardFilter(scope));safe('tables',()=>mountTables(scope));
    safe('numbers',()=>markNumbers(scope));safe('counts',()=>mountCounts(scope));
    safe('wide',()=>measureTables(scope));
    const live=scope.querySelector('.stage > .sig-siblings');if(live)safe('siblings-fold',()=>foldSiblings(live));
  }
  safe('login-title',guardLoginTitle);safe('login-error',watchLoginError);
  // المحرك يطابق --scene-3d الحالية (لا شيء إن كان قائمًا): يلتقط ورقة أنماط وصلت بعد الإقلاع أو تصميمًا تغيّر.
  safe('engine',mountEngine);
  safe('theme-color',syncThemeColor);safe('scene',()=>applyScene());safe('data',pushData);
  safe('theme-focus',restoreThemeFocus);
}
function enhanceDialog(dialog){
  safe('dialog-drag',()=>dragToDismiss(dialog,dialog.querySelector('.dialog-head,header'),()=>closeDialog(dialog),()=>!dirty(dialog),sheet));
  if(!enhanceOff()){safe('dialog-tables',()=>mountTables(dialog));}
}

document.addEventListener('click',event=>{
  const target=event.target instanceof Element?event.target:event.target?.parentElement;
  const shellButton=target?.closest?.('[data-shell]');
  if(shellButton){
    const action=shellButton.dataset.shell;
    if(action==='drawer')root.classList.contains('is-menu-open')?closeDrawer():openDrawer();
    else if(action==='drawer-close')closeDrawer();
    else if(action==='search')openPalette();
    return;
  }
  const accountRow=target?.closest?.('.side-account [data-sig]');
  if(accountRow){safe('account-row',()=>toggleAccountRow(accountRow));return;}
  // اختيار شاشة من الفهرس يغلقه فورًا، حتى لو كانت الشاشة الحالية نفسها. وإن كان للفتح قيد في السجل يُسحب أولًا ثم يُنتقل
  // (popstate أدناه)، فيحل المسار الجديد محل القيد ولا يبقى بينه وبين الصفحة السابقة «رجوع» لا يفعل شيئًا.
  const picked=target?.closest?.('.sidebar a[href^="#"]');
  if(picked){if(drawerEntry&&root.classList.contains('is-menu-open')){event.preventDefault();drawerHref=picked.getAttribute('href');closeDrawer(false,true);}else closeDrawer(false);}
  // «المزيد» يُغلق بالنقر خارجه وبعد اختيار فعل منه.
  for(const more of document.querySelectorAll('details.sig-more[open]'))if(!target?.closest?.('summary')||!more.contains(target))more.open=false;
});
// إغلاق النوافذ لا يعتمد على معالج واحد: زر ✕ و«إلغاء» يغلقان فورًا في مرحلة الالتقاط،
// والنقر على الخلفية يغلق النافذة ما لم يكن فيها نموذج بدأ الموظف تعبئته.
document.addEventListener('click',event=>{
  const target=event.target instanceof Element?event.target:event.target?.parentElement;
  const inSide=target?.closest?.('.sidebar');if(inSide)sideScroll=inSide.scrollTop;
  rememberAppearanceFocus(target);
  // على المكتب مجموعات الفهرس مفتوحة كلها والطي معطَّل.
  if(!compact()&&target?.closest?.('.sidebar summary.hr-nav-label')){event.preventDefault();return;}
  const closer=target?.closest?.('dialog [data-action="close"]');
  if(closer){const modal=closer.closest('dialog');if(modal?.querySelector('#request-form'))return;closeDialog(modal);return;}
  if(target?.tagName==='DIALOG'&&target.open){
    const rect=target.getBoundingClientRect(),outside=event.clientX<rect.left||event.clientX>rect.right||event.clientY<rect.top||event.clientY>rect.bottom;
    if(outside&&!dirty(target))closeDialog(target);
  }
},true);
// ⌘K / Ctrl+K يفتح لوحة الأوامر وحده: يُلتقط هنا قبل أي مستمع آخر على المستند. لا اختصار بحرف واحد (WCAG 2.1.4).
document.addEventListener('keydown',e=>{
  // الالتقاط والإيقاف يبقيان حتى مع نافذة مفتوحة (حيث ترفض openPalette() الفتح): لولاهما لوصل المفتاح إلى مستمع journey.mjs ففتح نافذته فوق النافذة القائمة.
  if((e.metaKey||e.ctrlKey)&&!e.altKey&&String(e.key).toLowerCase()==='k'&&document.querySelector('.nav')){e.preventDefault();e.stopImmediatePropagation();palette&&!palette.hidden?closePalette():openPalette();}
  else if(e.key==='Escape'){
    // Esc داخل قائمة التصميم يغلقها هي وحدها (app.mjs) ويعيد التركيز إلى زرها؛ لا يُغلق الفهرس الذي فُتحت منه.
    if(e.target?.closest?.('#design-menu'))return;
    // اللوحة أولًا: Esc يغلقها من أي مكان فيها (صف نتيجة، زر الإلغاء)، كما يعد تذييلها.
    if(palette&&!palette.hidden){e.preventDefault();closePalette();return;}
    const more=e.target?.closest?.('details.sig-more[open]');
    if(more){more.open=false;more.querySelector('summary')?.focus();}
    else if(root.classList.contains('is-menu-open')&&!document.querySelector('dialog[open]')&&(!palette||palette.hidden))closeDrawer();
  }
},true);

// إشارات الدخول والتركيز للحلقة. لا مستمع scroll ولا pointermove هنا، ولا أي استجابة لضغطات المفاتيح.
const editable=el=>!!el&&(['INPUT','TEXTAREA','SELECT'].includes(el.tagName)||el.isContentEditable)&&!['checkbox','radio','button','submit','range','file'].includes(el.type);
document.addEventListener('focusin',e=>{
  fieldFocused=editable(e.target);
  passwordFocused=!!e.target?.matches?.('.login input[name="password"]');
  if(liveScene()){syncDim();if(fieldFocused&&compact())engine('pause');}
});
document.addEventListener('focusout',()=>{
  fieldFocused=false;passwordFocused=false;
  if(liveScene())setTimeout(()=>{if(!fieldFocused){syncDim();wake();}syncKeyboard();},0);
});
document.addEventListener('submit',e=>{if(e.target?.id==='login-form'){loginSubmitted=true;clearTimeout(loginFlash);loginFlash=0;pushData();}},true);
document.addEventListener('visibilitychange',()=>{if(document.hidden)engine('pause');else{pushData();wake();}});

// html.is-kbd من visualViewport: لوحة المفاتيح مفتوحة (الجوال واللوحي، وحقل كتابة مركَّز).
function syncKeyboard(){
  const view=window.visualViewport;if(!view)return;
  const open=compact()&&editable(document.activeElement)&&window.innerHeight-view.height>140;
  if(root.classList.contains('is-kbd')===open)return;
  root.classList.toggle('is-kbd',open);
  if(root.dataset.scene==='login')syncDim();
}
try{window.visualViewport?.addEventListener('resize',syncKeyboard);}catch{}

// كل نافذة حوار تُفتح صفيحةً تحت 760 يمكن سحبها لإغلاقها، وجداولها تأخذ تسمياتها.
for(const dialog of document.querySelectorAll('dialog')){
  new MutationObserver(()=>enhanceDialog(dialog)).observe(dialog,{childList:true,subtree:true});
}
// #toast.show في مشهد حي ⇒ «الأثر».
const toast=document.querySelector('#toast');
if(toast){let shown=false;new MutationObserver(()=>{const now=toast.classList.contains('show');if(now&&!shown&&liveScene()&&!still())engine('pulse');shown=now;}).observe(toast,{attributes:true,attributeFilter:['class']});}

let pending=null;
function schedule(){
  if(pending)return;
  // التبويب المخفي لا يرسم إطارات؛ نستخدم مؤقتًا حتى لا يبقى الشريط بلا تبويبه. أيهما يسبق ينفذ مرة واحدة.
  let done=false;const run=()=>{if(done)return;done=true;pending=null;const app=document.querySelector('#app');if(app)enhance(app);};
  pending=true;requestAnimationFrame(run);setTimeout(run,120);
}

// ===== الإقلاع =====
safe('boot-attrs',syncAttrs);safe('boot-preferences',syncPreferences);safe('boot-engine',mountEngine);safe('boot-theme-color',syncThemeColor);
// وصول الخط يغيّر صناديق النص دون أن يغيّر حجم البطل أحيانًا: قياس المشهد ومحظوراته يُعاد مرة بعده.
try{document.fonts?.ready?.then(()=>schedule());}catch{}
// مراقب واحد على <html>: تغيّر التصميم أو الوضع يعيد قراءة ألوان الحلقة (بإعادة المشهد قسرًا) ويكتب theme-color؛
// وتغيّر المشهد أو الاتجاه يعيد الهندسة؛ ووصول العدّ (data-inbox) يحدّث البطل والحلقة.
new MutationObserver(records=>{
  const names=new Set(records.map(r=>r.attributeName));
  safe('theme-color',syncThemeColor);
  // تغيّر التصميم قد يبدّل المحرك (--scene-3d) والشريط المثبَّت (--sidebar-docked) والمدار: كلها من الرموز المحسوبة الجديدة.
  if(names.has('data-design')){safe('engine',mountEngine);safe('drawer',syncDrawer);safe('orbit',()=>syncOrbit());}
  if(names.has('data-theme')||names.has('data-design')){safe('scene',()=>applyScene(true));const app=document.querySelector('#app');if(app&&!enhanceOff())safe('appearance-cluster',()=>mountAppearanceCluster(app));}
  else if(names.has('data-scene')||names.has('dir'))safe('scene',()=>applyScene());
  if(names.has('data-inbox')||names.has('lang'))schedule();
}).observe(root,{attributes:true,attributeFilter:['data-theme','data-design','data-scene','data-inbox','dir','lang']});
const onMedia=(query,fn)=>{try{matchMedia(query).addEventListener('change',fn);}catch{}};
onMedia('(max-width: 1023.98px)',()=>{closeDrawer(false);syncDrawer();schedule();});
onMedia('(max-height: 600px)',()=>{syncAttrs();schedule();});
onMedia('(prefers-color-scheme: light)',()=>{safe('theme-color',syncThemeColor);safe('scene',()=>applyScene(true));});
onMedia('(prefers-reduced-motion: reduce)',()=>{still()?engine('pause'):wake();});
window.addEventListener('resize',()=>{const title=document.querySelector('#app > .login .story-copy h1.is-long');if(title){title.classList.remove('is-long');observedLoginTitle=null;}schedule();},{passive:true});

const app=document.querySelector('#app');
if(app){
  // السمات تُكتب داخل رد المراقب نفسه (مهمة دقيقة قبل الرسم) فلا قفز تخطيط؛ والحقن في الإطار التالي.
  // نبضات العدّ التصاعدي تكتب نصًّا في عنصرها فقط، فلا تعيد جدولة enhance().
  new MutationObserver(records=>{
    safe('attrs',syncAttrs);
    if(records.every(r=>r.target.nodeType===1&&r.target.hasAttribute('data-sig-counting')))return;
    schedule();
  }).observe(app,{childList:true,subtree:true});
  schedule();
  // كل شاشة جديدة تبدأ من أعلاها، ويُغلق الفهرس ولوحة الأوامر. السمات متزامنة هنا: الطبقة مضبوطة قبل أول رسم للمسار.
  // ت1: رجوع المتصفح والصفيحة مفتوحة يسحب قيد فتحها فيغلقها وتبقى الصفحة. وإن سُحب القيد لأن شاشة اختيرت من الفهرس، يُنتقل إليها الآن.
  // قيد فتحٍ دفنه تنقّل (والصفيحة مغلقة) قيدٌ ميت: من يصله يُمرَّر عنه في اتجاه سيره — رجوعًا إن جاء من مسار آخر، وتقدّمًا إن جاء من الصفحة نفسها.
  let navHash=location.hash;
  window.addEventListener('popstate',()=>{if(history.state?.sigDrawer&&!root.classList.contains('is-menu-open')&&!drawerHref){try{location.hash!==navHash?history.back():history.forward();}catch{}return;}
    if(root.classList.contains('is-menu-open')){drawerEntry=false;closeDrawer(true,false);}if(drawerHref){const href=drawerHref;drawerHref=null;location.hash=href.slice(1);}});
  // تنقّل (رابط، لوحة البحث) يدفن قيد الفتح تحت المسار الجديد: لا يُسحب بعدها، وإلا أعاد «رجوع» الموظف صفحتين؛ ويُمرَّر عنه عند الوصول إليه (popstate أعلاه).
  window.addEventListener('hashchange',()=>{navHash=location.hash;themeRefocus=null;pulseWanted=performance.now();drawerEntry=false;safe('attrs',syncAttrs);closeDrawer(false);closePalette(false);window.scrollTo({top:0,behavior:'instant'});});
}
export { enhance };
