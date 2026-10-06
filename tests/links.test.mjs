import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { randomUUID } from 'node:crypto';
import { setImmediate } from 'node:timers/promises';
import { openDb } from '../app/db.mjs';
import { seed } from '../scripts/seed.mjs';
import { listLeave } from '../app/leave.mjs';
import { homeBoard } from '../app/home.mjs';
import { operationModules } from '../app/static/operations.mjs';
import { leaveUI } from '../app/static/leave-ui.mjs';
import { quickRow } from '../app/static/home-ui.mjs';
import { MODULE_SERVICES } from '../app/static/module-services.mjs';
import { DEEP_LINKS,MODULE_SHORTCUTS,SUBROUTED_VIEWS,BUILTIN_VIEWS,parseDeepLink,resolveLink,unavailableText,unknownIntentText } from '../app/static/deep-links.mjs';
import { REQUEST_STATUS,ROLE_NAMES } from '../app/static/vocabulary.mjs';
import { kit } from '../app/static/kit.mjs';
import { countNoun,countEn } from '../app/static/arabic-count.mjs';
import { workFrames,groupedNavigation,dashboardHero,departmentDirectory } from '../app/static/hr-design.mjs';
import { requestLauncher,requestComposer,launcherResults,catalogBrowser,variantComposer } from '../app/static/request-picker.mjs';
import { measure,scanLinks,knownScreens,domIdentifiers } from '../scripts/quality-ratchet.mjs';
import { HUB_VIEWS } from '../app/static/hubs-ui.mjs';

// لا نقرة ميتة صامتة (م0 «السور»): كل حرفية «#view/intent» في app/static تصل إلى شاشة مسجلة ونية مسجلة، ونية لا تُفتح يقال لصاحبها لماذا.
const appSource=readFileSync(new URL('../app/static/app.mjs',import.meta.url),'utf8');

/* ───── 1. سلامة الروابط ───── */

test('links: every #view/intent literal in app/static resolves to a registered screen and a registered intent',async()=>{
  const {links}=await measure();
  assert.ok(links.checked>=100,`فُحص ${links.checked} رابطًا — الفحص ليس فارغًا`);
  assert.deepEqual(links.unresolved.map(l=>`${l.file}:${l.line} ${l.literal} — ${l.reason}`),[]);
});

test('links: the catalogue card «طلب إجازة» and the search shortcuts are among what is checked, and they resolve',async()=>{
  const screens=await knownScreens();
  const card=MODULE_SERVICES.find(s=>s.code==='HR-LEAVE');
  assert.equal(card.href,'#leave/request');
  assert.deepEqual(resolveLink(card.href,screens),{ok:true,view:'leave',intent:'request'});
  for(const shortcut of MODULE_SHORTCUTS)assert.equal(resolveLink(shortcut.link,screens).ok,true,shortcut.link);
  // العيب الأصلي: النية لم تكن مسجلة، فالنقرة لا تفعل شيئًا. مسجلة الآن وتجرّب زر السياسة المعتمدة ثم زر الرصيد الافتتاحي.
  assert.deepEqual(DEEP_LINKS.leave.request,{operation:'request',alternate:'create'});
  const parsed=parseDeepLink('#leave/request');
  assert.deepEqual([parsed.valid,parsed.operation,parsed.alternate,parsed.base,parsed.subrouted],[true,'request','create','#leave',false]);
});

test('links: the scanner treats every quoted #word as a link unless it is provably something else, so a typo cannot pass as a selector',async()=>{
  const screens=await knownScreens(),domIds=domIdentifiers();
  const scan=source=>scanLinks('synthetic.mjs',source,{screens,domIds});
  // روابط في كل السياقات التي تظهر بها في الواجهة: href، وخاصية link/href، ووسيط دالة، وقالب بمقطع متغير.
  const good=scan("`<a href=\"#inbox\">`;const a={link:'#leave/new',href:'#work'};block(t,'#requests',x);card(r,'#request/'+id);`#request/${e(r.id)}`;`#policy-library/article/${n}`;`#forms?project_id=${p}`;");
  assert.deepEqual(good.map(l=>[l.literal.split('${')[0],l.ok]),[['#inbox',true],['#leave/new',true],['#work',true],['#requests',true],['#request/',true],['#request/',true],['#policy-library/article/',true],['#forms?project_id=',true]]);
  // خطأ إملائي في النية، وفي اسم الشاشة، وفي وسيط دالة لا يحمل كلمة href ولا link.
  const bad=scan("const x={href:'#leave/reqest'};`<a href=\"#leav/new\">`;tile(n,'عنوان','#inboxx');`#leave/${intent}`;");
  assert.deepEqual(bad.map(l=>[l.literal,l.ok]),[['#leave/reqest',false],['#leav/new',false],['#inboxx',false],['#leave/${intent}',false]]);
  assert.match(bad[0].reason,/النية «reqest» غير مسجلة/);assert.match(bad[1].reason,/الشاشة «leav» غير مسجلة/);
  assert.match(bad[3].reason,/مقطع متغير/,'نية تُحسب عند التشغيل على شاشة بلا مسار فرعي لا يُعرف عند الفحص إلى أين تقود');
  // ما ليس رابطًا: محدِّد CSS، ومعرّف DOM، ولون، وتوجيه GLSL.
  const none=scan("document.querySelector('#main');el.closest?.('#design-menu');x.matches('#request-form');const ROWS='#main .operations';form.id==='a'?'#dialog-error':'#login-error';ctx.fillStyle='#dcf6aa';const vs='#version 300 es';`<input data-filter=\"#accounts-table\">`;");
  assert.deepEqual(none,[]);
});

test('links: the screen registries cannot drift from app.mjs',()=>{
  // فروع render() في app.mjs التي ترسم شاشة خارج operationModules.
  const branches=new Set([...appSource.matchAll(/else if\(view==='([a-z-]+)'\)/g)].map(m=>m[1]));
  assert.ok(branches.size>=10,[...branches].join(' '));
  for(const view of branches)assert.ok(BUILTIN_VIEWS.includes(view),`app.mjs يرسم «${view}» وليست في BUILTIN_VIEWS (app/static/deep-links.mjs)، ففحص الروابط لا يعرفها`);
  // ت1: الصفحات الجامعة الثلاث يرسمها فرع واحد من HUB_VIEWS، وبوابة الموظف لها فرع مستقل.
  assert.match(appSource,/if\(typeof hubPage==='function'&&\(HUB_VIEWS\.includes\(view\)/,'فرع الصفحات الجامعة');
  for(const view of BUILTIN_VIEWS)assert.ok(branches.has(view)||operationModules[view]||view==='portal'||HUB_VIEWS.includes(view),`«${view}» في BUILTIN_VIEWS ولا يرسمها أحد`);
  assert.match(appSource,/view==='portal'/,'#portal شاشة مستقلة');
  assert.doesNotMatch(appSource,/portal:\(\)=>\(\{route:'home'\}\)/,'#portal لا يعاد توجيهه للرئيسية');
  // #departments بلا إدارة اسم بديل لـ#services/department (عدسة لرسم واحد)، ولا يكتب التنقل تفضيل العدسة.
  assert.match(appSource,/departments:rest=>[^,]*\{route:'services\/department'\}/,'#departments اسم بديل لـ#services/department');
  assert.doesNotMatch(appSource,/moved\?\.lens/,'التنقل لا يرسل /catalog/lens');
  for(const view of SUBROUTED_VIEWS)assert.ok(BUILTIN_VIEWS.includes(view)||operationModules[view],`«${view}» في SUBROUTED_VIEWS وليست شاشة`);
  // كل نية مسجلة تخص شاشة مسجلة.
  for(const view of Object.keys(DEEP_LINKS))assert.ok(operationModules[view]||BUILTIN_VIEWS.includes(view),`DEEP_LINKS.${view} لشاشة غير مسجلة`);
});

/* ───── 2. الموجّه الحقيقي (app.mjs) في صندوق: لا صمت ───── */

// DOM مصغّر يكفي app.mjs: #main يحفظ HTML، ومحدِّد الأزرار يُجاب من الترميز المرسوم نفسه، فالزر «موجود» إن رسمته الشاشة فقط.
async function open(hash,module,data,{failApi=[]}={}){
  const nodes=new Map(),listeners={},clicked=[],replaced=[];
  const node=id=>{if(!nodes.has(id))nodes.set(id,{innerHTML:'',textContent:'',open:false,dataset:{},classList:{add(){},remove(){}},querySelectorAll(){return [];},querySelector(){return null;},showModal(){this.open=true;},close(){this.open=false;}});return nodes.get(id);};
  const buttons=selector=>{
    const want=[...selector.matchAll(/\[data-([a-z-]+)="([^"]*)"\]/g)].map(m=>[m[1],m[2].replace(/\\(.)/g,'$1')]);
    return [...node('#main').innerHTML.matchAll(/<button\b[^>]*>/g)].map(m=>Object.fromEntries([...m[0].matchAll(/data-([a-z-]+)="([^"]*)"/g)].map(a=>[a[1],a[2]])))
      .filter(attrs=>want.every(([k,v])=>attrs[k]===v)).map(attrs=>({dataset:{id:attrs.id,operation:attrs.operation,module:attrs.module},click(){clicked.push(`${attrs.module}/${attrs.operation}/${attrs.id}`);}}));
  };
  const me={id:'employee',name:'الموظفة التجريبية',role:'employee',can:['leave.use','requests.use','portal.use']};
  const sandbox={console,URL,Intl,Date,Uint8Array,Event:class{},location:{hash},localStorage:{getItem(){return 'ar';},setItem(){}},crypto:{randomUUID},setTimeout(){},
    // كما في المتصفح: replaceState يغيّر العنوان، فرسمٌ ثانٍ (app.mjs يرسم عند الإقلاع ثم يرسم الاختبار) لا يعيد فتح النموذج ولا التنبيه.
    history:{replaceState:(a,b,url)=>{replaced.push(url);sandbox.location.hash=url;}},CSS:{escape:value=>String(value)},
    document:{querySelector:selector=>selector.startsWith('#main [')?buttons(selector)[0]??null:node(selector),querySelectorAll:selector=>selector.startsWith('#main [')?buttons(selector):[],
      documentElement:{dataset:{}},addEventListener:(event,fn)=>{listeners[event]=fn;}},window:{addEventListener(){}},FormData:class{},
    workFrames,groupedNavigation,dashboardHero,departmentDirectory,countNoun,countEn,REQUEST_STATUS,ROLE_NAMES,kit,parseDeepLink,unavailableText,unknownIntentText,BUILTIN_VIEWS,
    // ت1: #catalog اسم بديل لـ«الخدمات»، فالموجّه يرسم فرعها. رسّاماتها بدائل صغيرة هنا: الاختبار عن الموجّه لا عن الشاشة.
    catalogSkeleton:()=>'',servicePageSkeleton:()=>'',catalogHome:()=>'<h1>الخدمات</h1>',categoryView:()=>'',journeyLensView:()=>'',journeyRunView:()=>'',servicePageView:()=>'',
    requestLauncher,requestComposer,launcherResults,catalogBrowser,variantComposer,
    brandLogo:'',mountScenes:()=>()=>{},operationModules:module?{[hash.slice(1).split('/')[0]]:{title:'شاشة',description:'وصف',...module,load:async()=>data}}:{},operationFields:()=>'',money:String,
    fetch:async path=>{
      if(failApi.some(p=>path.startsWith(p)))throw Error('تعذر الاتصال بالخادم');
      // الرد يحمل text() كما في المتصفح: api() تقرأ النص ثم تحلّله دفاعيًا، فلا يسقط الموجّه على ردّ ليس JSON.
      const reply=payload=>({ok:true,status:200,json:async()=>payload,text:async()=>JSON.stringify(payload)});
      if(path==='/api/me')return reply({user:me,csrf:'test'});
      // بقية المسارات (الدليل، الإدارات، العدادات) تعود فارغة: الاختبار عن الموجّه لا عن بياناتها.
      return reply([]);
    }};
  const source=appSource.replace(/^import .+;$/gm,'');
  await runInNewContext('(async()=>{'+source+';globalThis.ui={render};})()',sandbox);
  await sandbox.ui.render();await setImmediate();
  return {toast:node('#toast').textContent,clicked,replaced,main:node('#main').innerHTML,hash:sandbox.location.hash};
}
const drawButton=(e,view)=>(action,id,label)=>`<button class="btn outline small" data-action="operation" data-module="${view}" data-operation="${e(action)}" data-id="${e(id)}">${e(label)}</button>`;

test('no dead click: a new employee reaches the leave form or a stated reason from all four routes',async t=>{
  const db=openDb(':memory:');seed(db,'synthetic-links');t.after(()=>db.close());
  const employee=db.prepare("SELECT * FROM users WHERE id='employee'").get();
  const data={...listLeave(db,employee),user:employee};
  assert.equal(leaveUI.autoOpen('request',data),null,'موظف جديد: لا سياسة أنواع معتمدة ولا رصيد، فلا زر يُفتح');
  const reason=leaveUI.whyUnavailable('request',data);
  assert.ok(reason&&reason.length>40,'الشاشة تعرف السبب');

  // الطريق 1 — مدخل «طلب إجازة» في الرئيسية: غير جاهز، فيُرسم معطّلًا وسببه فيه، ولا رابط يقود إلى لا شيء.
  // موضعه بند في قائمة «+ إنشاء» بعد موجز 30 سبتمبر 2026؛ والقاعدة هي هي، فالفحص على الوسم لا على شكله.
  const e=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const chips=quickRow(homeBoard(db,employee).quick_actions,{e,tr:ar=>ar,lang:'ar'});
  // المدخل كله: من بدايته إلى بداية المدخل الذي يليه — فالوسوم متداخلة ولا يُقتطع بإغلاقٍ أوّل يصادفه.
  const at=chips.indexOf('data-quick="leave"'),head=at<0?-1:chips.lastIndexOf('<',at);
  const after=at<0?-1:chips.indexOf('data-quick="',at+1);
  const leaveChip=head<0?'':chips.slice(head,after<0?undefined:chips.lastIndexOf('<',after));
  assert.match(leaveChip,/aria-disabled="true"/);assert.ok(!/href=/.test(leaveChip),'لا رابط في مدخل معطّل');
  assert.match(leaveChip,/<small>لا رصيد إجازة متاح لك بعد<\/small>/,'السبب الذي حسبه الخادم ظاهر في المدخل');

  // الطريق 2 — #leave مباشرة: الشاشة تُفتح وتقول السبب في موضع الطلب، ولا تنبيه لأن لا نية في الرابط.
  const plain=await open('#leave',leaveUI,data);
  assert.equal(plain.toast,'');assert.ok(plain.main.includes(reason),'السبب مكتوب في الشاشة نفسها');

  // الطريق 3 — البحث: «إجازة» تقود إلى #leave/new. لا زر، فيقال السبب ويعود العنوان إلى الشاشة.
  const shortcut=MODULE_SHORTCUTS.find(s=>s.module==='leave');
  const search=await open(shortcut.link,leaveUI,data);
  assert.equal(search.toast,reason);assert.deepEqual(search.clicked,[]);assert.deepEqual(search.replaced,['#leave']);

  // الطريق 4 — بطاقة «طلب إجازة» في دليل الخدمات: #leave/request. كانت هذه النقرة لا تفعل شيئًا ولا تقول شيئًا.
  const card=await open(MODULE_SERVICES.find(s=>s.code==='HR-LEAVE').href,leaveUI,data);
  assert.equal(card.toast,reason,'ما يقال في التنبيه هو ما يُقرأ في الشاشة');assert.deepEqual(card.clicked,[]);assert.deepEqual(card.replaced,['#leave']);
});

test('no dead click: when the form can open, every route opens it',async()=>{
  const ready={render:(d,{e})=>drawButton(e,'leave')('request','new','طلب إجازة جديد'),autoOpen:segment=>segment==='request'?{action:'request',id:'new'}:null,whyUnavailable:()=>'لا يُستدعى'};
  for(const hash of ['#leave/request','#leave/new']){
    const r=await open(hash,ready,{});
    assert.deepEqual(r.clicked,['leave/request/new'],hash);assert.equal(r.toast,'',hash);assert.deepEqual(r.replaced.at(-1),'#leave');
  }
  // الرصيد الافتتاحي وحده (قبل اعتماد السياسة): #leave/request تجرّب زر create بديلًا.
  const legacy={render:(d,{e})=>drawButton(e,'leave')('create','balance-1','طلب من هذا الرصيد')};
  assert.deepEqual((await open('#leave/request',legacy,{})).clicked,['leave/create/balance-1']);
});

test('no dead click: the class of bug, not the instance — every silent path now states a reason',async()=>{
  const bare={render:()=>'<p>شاشة بلا أزرار</p>'};
  // (أ) نية لا يعرفها autoOpen ولا DEEP_LINKS: كانت followDeepLink تعود صامتة.
  const unknown=await open('#leave/bogus',bare,{});
  assert.equal(unknown.toast,unknownIntentText('ar'));assert.deepEqual(unknown.replaced,['#leave']);
  // (ب) autoOpen تسمّي زرًّا غير مرسوم: كانت ?.click() تبتلع النقرة. يكمل الرابط إلى بديله أو إلى سببه.
  const promised={render:()=>'<p>لا زر</p>',autoOpen:()=>({action:'request',id:'new'})};
  const broken=await open('#leave/request',promised,{});
  assert.equal(broken.toast,unavailableText('leave','ar'),'بلا whyUnavailable يقال النص العام للشاشة');
  // (ج) عطل قبل فتح النموذج كان يُبتلع في catch فارغة.
  const failed=await open('#catalog/new',null,null,{failApi:['/api/projects']});
  assert.equal(failed.toast,'تعذر الاتصال بالخادم');
  // ت1: النية تُنفَّذ على الاسم البديل، والعنوان يعود إلى البيت الجديد «الخدمات» لا إلى #catalog.
  assert.equal(failed.hash,'#services');assert.ok(failed.replaced.every(url=>!url.startsWith('#catalog')),failed.replaced.join(' '));
  // ما ليس نية لا يُنبَّه عليه: سجل في مسار فرعي، وشاشة بلا مقطع ثانٍ.
  assert.equal((await open('#leave',bare,{})).toast,'');
  assert.equal(parseDeepLink('#request/abc').subrouted,true);
  assert.doesNotMatch(appSource,/\}catch\{\}\n\}\nconst scopeCards/,'لا catch فارغة في نهاية followDeepLink');
});

test('home chips: a chip that is not ready is disabled with its reason, a ready chip is a link, and an empty reason is never left blank',()=>{
  const e=value=>String(value??'');
  const html=quickRow([{key:'leave',label:'طلب إجازة',label_en:'Request leave',link:'#leave/new',ready:false,reason:'لا رصيد إجازة متاح لك بعد'},
    {key:'payslip',label:'قسيمة الراتب',label_en:'My payslip',link:'#payroll/latest',ready:true,reason:''},
    {key:'service',label:'خدمة جديدة',label_en:'New service',link:'#catalog/new',ready:false,reason:''}],{e,tr:ar=>ar,lang:'ar'});
  assert.equal((html.match(/aria-disabled="true"/g)??[]).length,2);
  assert.match(html,/<a class="eu-chip" href="#payroll\/latest" data-quick="payslip">/);
  assert.match(html,/data-quick="leave">.*<small>لا رصيد إجازة متاح لك بعد<\/small>/);
  // app/home.mjs:119 يرسل سببًا فارغًا حين ينقص التصريح؛ الواجهة لا تترك الفراغ.
  assert.match(html,new RegExp(`data-quick="service">.*<small>${unavailableText('default','ar')}</small>`));
  assert.ok(!/style=/.test(html),'لا style= داخل الترميز (CSP)');
  assert.equal(quickRow([],{e}),'');
  const english=quickRow([{key:'leave',label:'طلب إجازة',label_en:'Request leave',link:'#leave/new',ready:false,reason:''}],{e,tr:(ar,en)=>en,lang:'en'});
  assert.match(english,/Request leave<small>This form is not available to your account now\.<\/small>/);
});

test('home quick actions use rounded local SVG icons instead of font glyphs',()=>{
  const e=value=>String(value??'');
  const html=quickRow([
    {key:'leave',label:'طلب إجازة',label_en:'Request leave',link:'#leave/new',ready:true,reason:'',create:true},
    {key:'payslip',label:'قسيمة الراتب',label_en:'My payslip',link:'#payroll/latest',ready:true,reason:'',create:false}
  ],{e,tr:ar=>ar,lang:'ar'});
  assert.match(html,/<svg class="glyph is-tinted"[^>]*viewBox="0 0 24 24"/);
  assert.match(html,/stroke="currentColor"[^>]*stroke-linecap="round"[^>]*stroke-linejoin="round"/);
  assert.doesNotMatch(html,/[◴◒＋≡]/,'رموز الإجراءات لا تعتمد على محارف الخط');
});

test('home SVG icons use adaptive system colours in light and dark themes',()=>{
  const css=readFileSync(new URL('../app/static/signature.css',import.meta.url),'utf8');
  const homeCss=readFileSync(new URL('../app/static/style.css',import.meta.url),'utf8');
  for(const token of ['--icon-tint:#0A84FF','--icon-positive:#30D158','--icon-negative:#FF453A','--icon-warning:#FF9F0A',
    '--icon-tint:#007AFF','--icon-positive:#34C759','--icon-negative:#FF3B30','--icon-warning:#FF9500'])
    assert.ok(css.includes(token),token);
  assert.match(css,/\.glyph\.is-tinted\{color:var\(--icon-tint\)\}/);
  assert.match(css,/:is\(\.hm-strip-new,\.btn\.primary\) \.glyph\{color:currentColor\}/);
  assert.match(homeCss,/\.hm-strip \.hm-disc::before\{content:none\}/,'الإجراء السريع لا يكرر إطار الحالة القديم حول الأيقونة');
  assert.match(homeCss,/\.hm-strip \.hm-disc \.glyph\{inline-size:21px;block-size:21px\}/,'الأيقونة لها مقاس واضح وثابت داخل المربع المرن');
});

// نفق أو وسيط منقطع يردّ صفحة HTML بدل JSON. قبل هذا الإصلاح كان الموظف يرى خطأ المحلّل الخام
// الخام على شاشة الدخول — صُوِّر فعلًا أثناء تجربة الوصول عن بُعد.
test('a non-JSON response becomes a readable Arabic message, not a parser error', () => {
  const source=readFileSync(new URL('../app/static/app.mjs',import.meta.url),'utf8');
  const api=source.slice(source.indexOf('async function api('),source.indexOf('async function api(')+2200);
  assert.ok(!/const result=await response\.json\(\);/.test(api),'response.json() is no longer called blind');
  assert.ok(/await response\.text\(\)/.test(api)&&/JSON\.parse\(body\)/.test(api),'the body is read as text and parsed defensively');
  assert.match(api,/تعذّر الوصول إلى المنصة/,'a gateway failure says so in Arabic');
  assert.match(api,/bad_gateway_response/,'the failure carries a named code');
  assert.ok(!/Unexpected token/.test(api),'the raw parser error never reaches the user');
});
