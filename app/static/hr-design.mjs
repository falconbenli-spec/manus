export function workFrames(brand) {
 return `<div class="hr-frames" aria-hidden="true"><div class="hr-frame hr-frame-one"><div class="hr-orbit"></div><span>الإبداع</span></div><div class="hr-frame hr-frame-two">${brand}<div class="hr-city"></div><span>3,6T · الرياض</span></div><div class="hr-frame hr-frame-three"><div class="hr-beams"></div><span>الأثر</span></div></div>`;
}
// المكتبة انتقلت إلى app/static/icons.mjs — الملف الواحد لكل أيقونات المنصة بلغة SF البصرية
// (قرار المالك 1 أكتوبر 2026). يُعاد تصديرها هنا لبقاء كل مستورد قديم كما هو.
import { icon } from './icons.mjs';
export { icon };
// لكل مساحة رمز ولون نظام؛ المساحات التي تُضاف لاحقًا بلا مدخل هنا تأخذ رمز مجموعتها ولونها.
const navGlyphs={
 // 1. مساحتي
 home:['house','blue'],portal:['sun','orange'],inbox:['tray','blue'],'my-request-timeline':['route','teal'],'my-requests':['route','teal'],profile:['person','indigo'],work:['checklist','indigo'],notifications:['bell','red'],announcements:['megaphone','orange'],
 attendance:['clock','teal'],leave:['calendar','mint'],time:['hourglass','indigo'],expenses:['receipt','orange'],letters:['envelope','cyan'],contracts:['doc','brown'],payroll:['banknote','green'],
 'hr-cases':['bubble','purple'],'policy-acknowledgements':['signed','indigo'],pulse:['pulse','pink'],recognition:['medal','yellow'],'one-to-ones':['bubbles','teal'],feedback:['note','green'],security:['shield','blue'],assistants:['sparkles','purple'],appearance:['sliders','indigo'],'notification-settings':['bell','orange'],
 // 2. الطلبات والخدمات
 catalog:['grid','blue'],requests:['doc','teal'],departments:['building','indigo'],'service-cards':['cards','cyan'],delegations:['arrows','teal'],
 'intake-settings':['flag','red'],'catalog-quality':['warning','orange'],'service-insight':['gauge','green'],knowledge:['bulb','yellow'],'service-benchmark':['target','purple'],'approval-settings':['gear','gray'],
 // 3. الموارد البشرية
 employees:['person','blue'],people:['people','green'],lifecycle:['badge','teal'],clearance:['exit','orange'],expiry:['hourglass','red'],'letter-templates':['envelope','brown'],workforce:['pie','indigo'],
 'leave-accrual':['calendar','mint'],benefits:['heart','pink'],'my-benefits':['heart','pink'],'benefits-admin':['layers','pink'],'payroll-extras':['banknote','green'],'payroll-anomaly':['search','orange'],'wage-reconciliation':['scale','indigo'],wps:['shield','teal'],compensation:['trend','purple'],
 performance:['star','yellow'],'review-360':['around','cyan'],growth:['book','orange'],
 // 4. العملاء والحملات
 clients:['people','pink'],pipeline:['funnel','indigo'],estimates:['calculator','teal'],commercial:['trend','green'],offerings:['box','brown'],approvals:['check','mint'],'client-reports':['chart','blue'],
 campaigns:['megaphone','orange'],content:['calendar','red'],'media-spend':['coins','yellow'],influencers:['star','purple'],'influencer-campaigns':['link','cyan'],pr:['mic','indigo'],'media-contacts':['news','gray'],
 // 5. المشاريع والإنتاج
 projects:['briefcase','blue'],'project-templates':['grid','gray'],scope:['shield','indigo'],resourcing:['people','teal'],timesheets:['clock','orange'],
 // سلسلة استلام المشروع (ترحيل 109)
 'project-handover':['signed','brown'],'project-receipt':['clipboard','mint'],'project-kickoff':['calendar','cyan'],'change-requests':['cycle','red'],
 studio:['sparkles','pink'],'review-rounds':['cycle','purple'],productions:['film','red'],'call-sheets':['clipboard','brown'],equipment:['camera','green'],
 // 6. المالية
 procurement:['cart','orange'],'procurement-extras':['arrows','brown'],vendors:['box','teal'],'contracts-register':['signed','indigo'],
 receivables:['banknote','green'],invoices:['receipt','blue'],'billing-schedules':['cycle','purple'],retainers:['calendar','mint'],einvoice:['qr','cyan'],
 payables:['card','orange'],'bank-reconciliation':['bank','blue'],'cash-forecast':['trend','teal'],
 finance:['book','mint'],statements:['doc','indigo'],accruals:['layers','purple'],'close-checklist':['lock','red'],assets:['building','gray'],budgets:['pie','green'],
 'vat-worksheet':['percent','orange'],withholding:['coins','yellow'],profitability:['chart','green'],'cost-rates':['clock','indigo'],
 // 7. القيادة والحوكمة
 executive:['trend','indigo'],reports:['chart','purple'],epmo:['clipboard','purple'],objectives:['target','orange'],decisions:['signed','brown'],org:['org','teal'],centres:['building','cyan'],
 risks:['warning','red'],compliance:['calendar','mint'],privacy:['lockshield','blue'],'subject-requests':['person','green'],
 // 8. إدارة المنصة
 accounts:['key','gray'],'access-reviews':['eye','indigo'],integrations:['arrows','teal'],'ai-governance':['cpu','purple'],jobs:['stack','orange'],'feature-flags':['toggle','green'],mail:['tray','teal'],requirements:['target','gray']};
// سجل المخالفات والجزاءات (ترحيل 097)
navGlyphs.discipline=['scale','red'];navGlyphs['my-discipline']=['scale','orange'];
// سجل التعريفات ومحرّر الصفحة (ترحيل 123)
navGlyphs.definitions=['layers','teal'];
// ت2: صفوف القائمة صارت الأقسام الثمانية (nav-map.SECTIONS)، ومفاتيحها ليست مفاتيح شاشات —
// فبلا هذه الأسطر تأخذ الثمانية كلها الرمز الاحتياطي الرمادي نفسه، وتُقرأ القائمة صفًّا واحدًا مكرّرًا.
navGlyphs['section/home']=['house','blue'];navGlyphs['section/work']=['checklist','indigo'];
navGlyphs['section/departments']=['building','teal'];navGlyphs['section/projects']=['route','purple'];
navGlyphs['section/clients']=['person','cyan'];navGlyphs['section/finance']=['banknote','green'];
navGlyphs['section/services']=['grid','blue'];navGlyphs['section/reports']=['gauge','orange'];
// ت1: مداخل القائمة الجديدة (فريقي، الخدمات، المنظمة، إدارة المنصة) ورمز الإدارة لمدخل «#departments/<id>».
Object.assign(navGlyphs,{team:['people','teal'],services:['grid','blue'],organization:['org','indigo'],platform:['gear','gray']});
// الرمز الاحتياطي لمفتاح بلا مدخل في navGlyphs.
const groupGlyphs=[['house','blue'],['doc','indigo'],['person','green'],['megaphone','orange'],['briefcase','blue'],['card','mint'],['chart','purple'],['gear','gray'],['grid','gray']];
// المفتاح كاملًا أولًا ثم رأسه: «‎#departments/<id>‎» تأخذ رمز الإدارات برأسها، أما مفاتيح الأقسام الثمانية فتشترك
// في الرأس «section» وحده — فلو قُرئ الرأس أولًا لأخذت الثمانية رمزًا واحدًا، وقُرئت القائمة صفًّا مكرّرًا سبع مرات.
export function navGlyph(key,groupIndex=8){const k=String(key),[name,tint]=navGlyphs[k]||navGlyphs[k.split('/')[0]]||groupGlyphs[groupIndex]||groupGlyphs[8];return {svg:icon(name),tint};}
// ت1 (nav-map.mjs، «بعد-ب»، البرومبت §2.1): القائمة مداخل بترتيب ثابت ولا مجموعة «أخرى»: «مساحتي» (الرئيسية، بانتظار إجرائي، طلباتي، ملفي،
// الإشعارات)، ثم فريقي والخدمات، ثم «الإدارات» (إدارة الحساب وحدها)، ثم المنظمة، ثم فاصل و«إدارة المنصة». الترتيب ترتيب items كما يبنيه shell().
// items: [key,glyph,label,block] وblock ∈ mine|depts|platform|'' (مدخل منفرد). parent: مدخل القائمة الذي تسكن تحته الشاشة الحالية (aria-current="true").
// reach: كل شاشة يصلها الحساب اليوم [key,glyph,label]، في كتلة مخفية لا تظهر إلا عند الكتابة في «ابحث عن شاشة» (app.mjs) وتقرؤها لوحة البحث
// (signature.mjs navItems)، فلا تضيع شاشة ليس لها مدخل. names: عناوين الكتل بلغة الواجهة.
export function groupedNavigation(items,view,e,{reach=[],parent='',names={}}={}) {
 const link=active=>([key,glyph,label])=>{const g=navGlyph(key),here=active&&view===key,under=active&&!here&&parent===key;
  return `<a href="#${e(key)}"${here||under?' class="active"':''}${here?' aria-current="page"':under?' aria-current="true"':''}><span class="nav-icon tint-${g.tint}" aria-hidden="true">${g.svg||e(glyph)}</span><span class="nav-label">${e(label)}</span></a>`;};
 const rows=(list,active=true)=>`<div class="hr-nav-rows"><div class="hr-nav-section">${list.map(link(active)).join('')}</div></div>`;
 const blocks=[];
 for(const item of items){const block=item[3]||'',last=blocks.at(-1);if(last&&last[0]===block)last[1].push(item);else blocks.push([block,[item]]);}
 const titled=(name,list)=>`<details class="hr-nav-group" data-group="${e(name)}" open><summary class="hr-nav-label"><span>${e(name)}</span></summary>${rows(list)}</details>`;
 const seen=new Set(items.map(i=>i[0])),rest=reach.filter(r=>!seen.has(r[0]));
 return blocks.map(([block,list])=>block==='mine'?titled(names.mine||'مساحتي',list):block==='depts'?titled(names.depts||'الإدارات',list)
   :block==='platform'?`<hr class="nav-sep">${rows(list)}`:rows(list)).join('')
  +(rest.length?`<div class="nav-reach" data-nav-reach hidden><p class="hr-nav-sublabel">${e(names.reach||'كل شاشاتك')}</p>${rows(rest,false)}</div>`:'');
}
export function dashboardHero({name,stats,projects,decisions,date,e}) {
 const tasks=projects.flatMap(p=>p.tasks),complete=tasks.filter(t=>t.status==='completed').length;
 const focus=(href,value,label,glyph,tint)=>`<a href="${href}"><span class="nav-icon tint-${tint}" aria-hidden="true">${icon(glyph)}</span><span>${e(label)}</span><strong>${value}</strong></a>`;
 return `<section class="hr-hero"><div class="hr-hero-copy"><time>${e(date)}</time><h2>مرحبًا ${e(name)}</h2><p>هنا يبدأ الأثر. طلباتك وقراراتك ومشاريعك، في مساحة واحدة.</p></div><div class="operation-actions"><a class="btn primary" href="#catalog">استعرض الخدمات</a><a class="btn outline" href="#projects">مساحة المشاريع</a></div></section><div class="stats">${stats.map(([n,label,,hint])=>`<article class="stat"><div class="stat-label">${e(label)}</div><strong class="stat-number">${n}</strong><small>${e(hint)}</small></article>`).join('')}</div><div class="hr-focus">${focus('#requests',decisions,'قرار ينتظر مشاركتك','check','orange')}${focus('#projects',projects.length,'مشروع ضمن صلاحياتك','briefcase','blue')}${focus('#projects',`${complete} / ${tasks.length}`,'مهام مكتملة في مشاريعك','checklist','green')}</div>`;
}

// العدد والمعدود: واحد ومثنى وجمع (3–10) ومفرد منصوب لما فوق العشرة.
const count=(n,one,two,few)=>n===0?`لا ${few}`:n===1?(one.includes(' ')?one:`${one} واحدة`):n===2?two:n<11?`${n} ${few}`:`${n} ${one}`;
const stages=n=>n===1?'مرحلة اعتماد واحدة':n===2?'مرحلتا اعتماد':n>2&&n<11?`${n} مراحل اعتماد`:`${n} مرحلة اعتماد`;
export function departmentDirectory({departments,services,me,modules,selected='',e}) {
 const own=departments.find(d=>d.id===me.department_id);
 const sorted=[...departments].sort((a,b)=>Number(b.id===own?.id)-Number(a.id===own?.id)||a.name.localeCompare(b.name,'ar'));
 const bindings=me.tenant_id==='36t'?{hr:['leave','people'],creative:['studio'],'business-dev':['commercial'],procurement:['procurement','vendors'],finance:['finance','budgets'],epmo:['budgets']}:{};
 const allowed=key=>['security','compliance','assistants','appearance','centres','inbox','service-cards','procurement-extras','campaigns','content','scope','payroll-extras','employees','performance','growth','expenses','clients','offerings','project-templates','time','reports',
  'bank-reconciliation','billing-schedules','retainers','cash-forecast','close-checklist','accruals','contracts-register','project-handover','project-receipt','project-kickoff','change-requests','pulse','recognition','announcements','one-to-ones','feedback','review-360','objectives','risks','decisions','home','expiry','influencers','influencer-campaigns','leave-accrual','benefits','my-benefits','benefits-admin','letters','letter-templates','pr','media-contacts','equipment','privacy','subject-requests','productions','call-sheets','cost-rates','profitability','timesheets','resourcing','review-rounds','annotations','search','vat-worksheet','withholding','wps','wage-reconciliation','payroll-anomaly','lifecycle','clearance','einvoice','einvoice-selfcheck','intake-settings',
  'my-request-timeline','my-requests','profile','employee-profile','service-insight','knowledge','policy-acknowledgements','access-reviews','pipeline','estimates','jobs','feature-flags','ai-governance','catalog-quality','hr-cases','compensation','workforce','media-spend','client-reports','approval-settings','notification-settings','mail','epmo','definitions'].includes(key)?false:['contracts','attendance','payroll'].includes(key)?me.role!=='admin':['invoices','statements','payables','assets'].includes(key)?!!me.capabilities?.finance:['vendors','approvals'].includes(key)?(me.can||[]).some(c=>c.startsWith(key+'.')):key==='finance'?!!me.capabilities?.finance:key==='budgets'?!!me.capabilities?.finance||me.role==='manager':key==='integrations'?['admin','manager','pm'].includes(me.role):me.role!=='admin';
 const workspaces=department=>((bindings[department.id]||[]).filter(key=>modules[key]&&allowed(key)));
 const requestServices=department=>services.filter(s=>s.department_id===department.id);
 const workspaceCard=key=>`<article class="service"><span class="badge">قيد التجهيز</span><h3>${e(modules[key].title)}</h3><p>${e(modules[key].description)}</p><a class="btn outline" href="#${e(key)}">فتح الشاشة</a></article>`;
 const heading=(title,copy)=>`<div class="page-head"><div><h1>${e(title)}</h1><p>${e(copy)}</p></div></div>`;
 if(selected){
   const department=departments.find(d=>d.id===selected);
   if(!department)return '<a class="department-back" href="#departments">العودة إلى الإدارات</a>'+heading('الإدارة غير متاحة','لم نجد هذه الإدارة ضمن شركتك.');
   const list=requestServices(department),keys=workspaces(department);
   return `<a class="department-back" href="#departments">← جميع الإدارات</a>`+heading(department.name,'خدمات الإدارة وشاشاتها، بحسب صلاحيات حسابك.')+`<div class="department-summary"><span>${count(list.length,'خدمة','خدمتان','خدمات')}</span><span>${count(keys.length,'شاشة','شاشتان','شاشات')}</span>${department.id===own?.id?'<span class="badge">إدارتك</span>':''}</div><h2>خدمات يمكنك طلبها</h2>${[...new Set(list.map(s=>s.section||'خدمات عامة'))].map(section=>`<section class="department-section"><h3 class="department-section-title">${e(section)} <small>${list.filter(s=>(s.section||'خدمات عامة')===section).length}</small></h3><div class="service-grid">${list.filter(s=>(s.section||'خدمات عامة')===section).map(s=>`<article class="service"><h3>${e(s.name_ar)}</h3><p>${e(s.description)}</p><small>${stages(s.approval_policy.steps.length)}${s.target&&s.target.kind!=='unset'?` · المدة ${e(s.target.label)}`:''}</small><footer>${me.role!=='admin'?`<button class="btn primary" data-action="new-request" data-id="${e(s.id)}">طلب الخدمة</button>`:'<span class="subtle">حساب مسؤول دليل الخدمات</span>'}</footer></article>`).join('')}</div></section>`).join('')}${list.length?'':'<div class="empty"><strong>لم تُهيأ خدمات طلب لهذه الإدارة بعد</strong><p>للطلب من هذه الإدارة الآن استعمل «طلب عام» أو تواصل مع مديرها.</p></div>'}${me.role==='admin'?`<button class="btn outline" data-action="new-service" data-department="${e(department.id)}">إعداد خدمة</button>`:''}${keys.length?`<h2 class="mt">شاشات الإدارة</h2><div class="service-grid">${keys.map(workspaceCard).join('')}</div>`:''}<p class="subtle mt">بعض خدمات هذه الإدارة لم تكتمل بعد.</p>`;
 }
 const mapped=new Set(departments.flatMap(d=>bindings[d.id]||[]));
 const shared=me.tenant_id==='36t'?Object.keys(modules).filter(key=>!mapped.has(key)&&key!=='delegations'&&key!=='accounts'&&allowed(key)):[];
 return heading('الإدارات وخدماتها','اختر الإدارة للوصول إلى خدماتها، أو ابحث باسم الإدارة أو الخدمة.')+`<div class="department-summary"><span>${count(departments.length,'إدارة','إدارتان','إدارات')}</span><span>${count(services.filter(s=>departments.some(d=>d.id===s.department_id)).length,'خدمة','خدمتان','خدمات')}</span>${own?`<a href="#departments/${e(encodeURIComponent(own.id))}">انتقل إلى إدارتي ←</a>`:''}</div><label class="department-search"><span>ابحث عن إدارة أو خدمة</span><input id="department-search" type="search" placeholder="مثال: خطاب، إجازات، دعم تقني" autocomplete="off"></label><p id="department-search-status" class="subtle" role="status" aria-live="polite"></p><div class="department-grid">${sorted.map((d,i)=>{
 const list=requestServices(d),keys=workspaces(d),search=[d.name,...list.map(s=>s.name_ar),...keys.map(k=>modules[k].title)].join(' ').toLocaleLowerCase();
 return `<article class="department-card" data-department-search="${e(search)}"><div class="department-card-top"><span class="department-number" aria-hidden="true">${String(i+1).padStart(2,'0')}</span>${d.id===own?.id?'<span class="badge">إدارتك</span>':''}</div><h2><a href="#departments/${e(encodeURIComponent(d.id))}">${e(d.name)}</a></h2><p>${count(list.length,'خدمة','خدمتان','خدمات')} · ${count(keys.length,'شاشة','شاشتان','شاشات')}</p><ul>${(()=>{const titles=[...keys.map(k=>modules[k].title),...list.map(s=>s.name_ar)];return titles.slice(0,5).map(title=>`<li>${e(title)}</li>`).join('')+(titles.length>5?`<li class="more">و${count(titles.length-5,'خدمة أخرى','خدمتان أخريان','خدمات أخرى')}</li>`:'');})()||'<li>لم تُهيأ خدمات بعد</li>'}</ul><a class="btn outline" href="#departments/${e(encodeURIComponent(d.id))}">خدمات الإدارة ←</a></article>`;
 }).join('')}</div>${departments.length?'':'<p class="empty">لا توجد إدارات مسجلة للشركة بعد.</p>'}${shared.length?`<h2 class="mt">شاشات مشتركة</h2><p class="subtle">شاشات متاحة لك لم تُربط بإدارة مالكة بعد.</p><div class="service-grid">${shared.map(workspaceCard).join('')}</div>`:''}`;
}
