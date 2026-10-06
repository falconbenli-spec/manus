import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { runInNewContext, constants } from 'node:vm';
import { randomUUID } from 'node:crypto';
import { setImmediate } from 'node:timers/promises';
import { transaction, verifyAudit } from '../app/db.mjs';
import { createApp } from '../app/server.mjs';
import { grantAccess } from '../app/access.mjs';
import * as viewAs from '../app/view-as.mjs';
import { operationModules,operationFields,collectStructured,money } from '../app/static/operations.mjs';
import { REQUEST_STATUS,ROLE_NAMES } from '../app/static/vocabulary.mjs';
import { kit } from '../app/static/kit.mjs';
import { countNoun,countEn } from '../app/static/arabic-count.mjs';
import { workFrames,groupedNavigation,dashboardHero,departmentDirectory } from '../app/static/hr-design.mjs';
import { requestLauncher,requestComposer,launcherResults,catalogBrowser,variantComposer } from '../app/static/request-picker.mjs';
import { parseDeepLink,unavailableText,unknownIntentText,BUILTIN_VIEWS } from '../app/static/deep-links.mjs';
import { parseFocus } from '../app/static/focus-record.mjs';
import * as client from '../app/static/definitions-client.mjs';
import { closePageEditor } from '../app/static/page-editor.mjs';
import { fixture, dispatch, sessionsFor } from './definitions-fixture.mjs';

// محرّر الصفحة وتجاوز التسميات و«جرّب كمستخدم»، من أولها إلى آخرها: الموجّه الحقيقي (app/static/app.mjs) في صندوق على نمط
// tests/links.test.mjs، وfetch فيه يستدعي معالج الخادم الحقيقي (createApp) داخل العملية — الجلسة وCSRF والتفويض والمعاملة كلها تجري،
// بلا منفذ شبكة. والمحرّر نفسه (app/static/page-editor.mjs) يُحمَّل كسولًا من نقرة «تعديل هذه الصفحة» كما في المتصفح، ويُقاد بأحداث
// النقر والإرسال على DOM مصغّر: كل زر «يُضغط» يجب أن يكون مرسومًا في الدرج وغير معطَّل، وكل نموذج «يُملأ» يجب أن تكون حقوله مرسومة.
const STATIC=new URL('../app/static/',import.meta.url);
const appSource=readFileSync(new URL('app.mjs',STATIC),'utf8');

/* ───── DOM مصغّر ───── */
const camel=name=>name.replace(/-([a-z])/g,(_,c)=>c.toUpperCase());
const decode=value=>value.replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&amp;/g,'&');
// كل <button> مرسوم يطابق السمات المطلوبة، بـdataset كما يقرؤه المتصفح.
function buttonsIn(html,want){
  return [...html.matchAll(/<(?:button|a)\b([^>]*)>([^<]*)/g)].map(m=>({attrs:m[1],text:m[2],
    dataset:Object.fromEntries([...m[1].matchAll(/\bdata-([a-z-]+)="([^"]*)"/g)].map(a=>[camel(a[1]),decode(a[2])]))}))
    .filter(b=>Object.entries(want).every(([k,v])=>b.dataset[k]===String(v)));
}
// عناصر التسمية التي يمر عليها relabel: th وdt وlegend وoption وأول span في label وتسمية البلاطة. كتابة نصها تعيد كتابة الموضع نفسه في HTML.
function labelElements(node){
  const pattern=/(<(?:th|dt|legend|option)\b[^>]*>|<label\b[^>]*><span>|<(?:div|a) class="vn-tile[^>]*><strong>[^<]*<\/strong><span>)([^<]+)/g;
  return [...node.innerHTML.matchAll(pattern)].map(m=>{
    const textNode={nodeType:3,get textContent(){return m[2];},set textContent(value){node.innerHTML=node.innerHTML.replace(m[0],m[1]+value);}};
    return {childNodes:[textNode]};
  });
}
class FakeFormData{
  constructor(form){this.entries=Object.entries(form.__values??{});}
  [Symbol.iterator](){return this.entries[Symbol.iterator]();}
  get(name){return this.entries.find(([key])=>key===name)?.[1]??null;}
  getAll(name){return this.entries.filter(([key])=>key===name).map(([,value])=>value);}
  has(name){return this.entries.some(([key])=>key===name);}
}
// نموذج «مملوء»: قيمه، وصفوف حقوله الجدولية، وخاناته المؤشَّرة — كما يقرؤها collectStructured من الصفحة.
function filledForm(dataset,values,{rows={},checks={}}={}){
  return {id:dataset.id??'',dataset,__values:values,elements:{},addEventListener(){},querySelectorAll(){return [];},
    querySelector(selector){
      const row=selector.match(/^\[data-rows="([^"]+)"\]$/),check=selector.match(/^\[data-checks="([^"]+)"\]$/);
      if(row)return {querySelectorAll:()=>(rows[row[1]]??[]).map(r=>({querySelector:cell=>({value:r[cell.match(/data-col="([^"]+)"/)[1]]??''})}))};
      if(check)return {querySelectorAll:()=>(checks[check[1]]??[]).map(value=>({value}))};
      return null;
    }};
}
function fakeDocument(){
  const nodes=new Map(),listeners={},bodyChildren=[];
  const node=id=>{
    if(!nodes.has(id)){
      const n={id,textContent:'',open:false,dataset:{},classList:{add(){},remove(){}},form:null,_html:'',
        get innerHTML(){return this._html;},set innerHTML(value){this._html=value;this.form=null;},
        // نموذج الحوار كائن ثابت ما دام الترميز نفسه: app.mjs يربطه بمواصفته في WeakMap ثم يقرؤه عند الإرسال.
        querySelector(selector){if(selector==='#operation-form'&&this._html.includes('id="operation-form"'))return this.form??=filledForm({id:'operation-form'},{});return null;},
        querySelectorAll(selector){if(selector==='form')return this._html.includes('<form')?[this.querySelector('#operation-form')].filter(Boolean):[];return selector.startsWith('th,dt')?labelElements(this):[];},
        showModal(){this.open=true;},close(){this.open=false;},addEventListener(){},scrollIntoView(){},focus(){}};
      nodes.set(id,n);
    }
    return nodes.get(id);
  };
  const document={documentElement:{dataset:{},dir:'rtl',lang:'ar'},activeElement:null,
    body:{append(element){bodyChildren.push(element);}},
    createElement:()=>{
      const own={},element={id:'',className:'',dir:'',lang:'',dataset:{},attributes:{},_html:'',message:{innerHTML:'',scrollIntoView(){}},note:{value:''},removed:false,listeners:own,
        get innerHTML(){return this._html;},set innerHTML(value){this._html=value;this.message.innerHTML=(value.match(/<div class="pe-message"[^>]*>([\s\S]*?)<\/div>\s*(?:<p class="vn-alert|<h3|<form|<ul|<div class="pe-types|$)/)?.[1]??'');},
        setAttribute(key,value){this.attributes[key]=value;},addEventListener(type,fn){own[type]=fn;},remove(){this.removed=true;},
        querySelector(selector){return selector==='.pe-message'?this.message:selector==='[name="pe-note"]'&&this._html.includes('name="pe-note"')?this.note:null;},querySelectorAll(){return [];}};
      return element;
    },
    querySelector:selector=>selector.startsWith('#main [')?null:node(selector),querySelectorAll:()=>[],
    addEventListener:(event,fn)=>{(listeners[event]??=[]).push(fn);}};
  return {document,node,listeners,bodyChildren};
}

/* ───── متصفح في صندوق، على الخادم الحقيقي ───── */
// متصفح جديد = تحميل صفحة جديد: وصلة التعريفات ودرج المحرّر حالتان على مستوى الوحدة، فتُصفَّران كما يصفّرهما التحميل.
async function browser(app,auth,hash='#home'){
  await closePageEditor({silent:true});client.setSnapshot(null);client.usePreview(false);
  const dom=fakeDocument(),requests=[];
  const fetch=async(path,options={})=>{
    requests.push(`${options.method??'GET'} ${path}`);
    const response=await dispatch(app,{method:options.method??'GET',path,headers:{cookie:auth.cookie,...(options.headers??{})},body:options.body===undefined?undefined:JSON.parse(options.body)});
    return {ok:response.status<400,status:response.status,text:async()=>response.text};
  };
  const sandbox={console,URL,URLSearchParams,Intl,Date,Uint8Array,Event:class{},location:{hash},localStorage:{getItem(){return 'ar';},setItem(){}},crypto:{randomUUID},setTimeout(){},
    history:{replaceState:(a,b,url)=>{sandbox.location.hash=url;}},CSS:{escape:value=>String(value)},document:dom.document,window:{addEventListener(){}},FormData:FakeFormData,fetch,
    workFrames,groupedNavigation,dashboardHero,departmentDirectory,countNoun,countEn,REQUEST_STATUS,ROLE_NAMES,kit,parseDeepLink,unavailableText,unknownIntentText,BUILTIN_VIEWS,parseFocus,focusRecord:()=>true,
    requestLauncher,requestComposer,launcherResults,catalogBrowser,variantComposer,brandLogo:'',mountScenes:()=>()=>{},mountCards:()=>()=>{},operationModules,operationFields,collectStructured,money,
    // ما تستورده app.mjs من definitions-client.mjs، بأسمائه المستعارة هناك.
    loadSnapshot:client.loadSnapshot,definitionsSnapshot:client.snapshot,editableEntities:client.editableEntities,extendForm:client.extendForm,applyConditions:client.applyConditions,
    glossaryText:client.text,relabel:client.relabel,vocabularyTerm:client.term,valuesForm:client.valuesForm,defsFor:client.defsFor,isPreviewing:client.isPreviewing};
  // المحرّر يُحمَّل في السياق الرئيسي (import الكسول)، فيقرأ document وFormData وCSS من globalThis.
  Object.assign(globalThis,{document:dom.document,FormData:FakeFormData,CSS:sandbox.CSS});
  await runInNewContext('(async()=>{'+appSource.replace(/^import .+;$/gm,'')+';globalThis.ui={render};})()',sandbox,
    {filename:fileURLToPath(new URL('app.mjs',STATIC)),importModuleDynamically:constants.USE_MAIN_CONTEXT_DEFAULT_LOADER});
  await setImmediate();
  const fire=async(type,event)=>{for(const listener of dom.listeners[type]??[])await listener(event);await setImmediate();};
  const focusLog=[];
  const page=()=>dom.node('#main').innerHTML,shell=()=>dom.node('#app').innerHTML,dialog=()=>dom.node('#dialog');
  const api={
    requests,page,shell,dialog,toast:()=>dom.node('#toast').textContent,dialogError:()=>dom.node('#dialog-error').innerHTML,
    async go(next){sandbox.location.hash=next;await sandbox.ui.render();await setImmediate();},
    // نقرة على زر مرسوم فعلًا في الصفحة أو الحوار أو الهيكل. زر غير مرسوم يُسقط الاختبار: لا نقرة على ما لا يراه المستخدم.
    // ما أخذ التركيز بعد كل نقرة، بترتيبه: الزر المنقور يبقى في الصفحة (isConnected) كما في المتصفح، فمن يعيد التركيز إليه يُرى.
    focusLog,
    async click(want,{within='any'}={}){
      const html=within==='page'?page():`${page()}${shell()}${dialog().innerHTML}`,found=buttonsIn(html,want)[0];
      assert.ok(found,`لا زر مرسوم يطابق ${JSON.stringify(want)}`);
      const button={dataset:found.dataset,textContent:found.text,disabled:false,isConnected:true,
        focus(){focusLog.push(`action:${found.dataset.action??''}`);}};
      await fire('click',{target:{closest:selector=>selector==='[data-action]'?button:null},detail:0});
    },
    async submitDialog(values){
      const form=dialog().querySelector('#operation-form');assert.ok(form,'لا نموذج مفتوح');
      form.__values=values;form.dataset.key??=randomUUID();
      await fire('submit',{target:form,preventDefault(){}});
    },
    async submitForm(id,values){await fire('submit',{target:filledForm({id},values),preventDefault(){}});},
    /* ── درج المحرّر ── */
    editor(){return dom.bodyChildren.filter(x=>!x.removed).at(-1)??null;},
    async press(want){
      const host=this.editor();assert.ok(host,'الدرج غير مفتوح');
      const found=buttonsIn(host.innerHTML,want)[0];
      assert.ok(found,`لا زر في الدرج يطابق ${JSON.stringify(want)}`);assert.ok(!/\sdisabled(?=[\s>]|$)/.test(found.attrs),`الزر ${JSON.stringify(want)} معطَّل`);
      await host.listeners.click({target:{closest:selector=>selector==='[data-pe]'?{dataset:found.dataset}:null}});await setImmediate();
    },
    async fill(name,values,structured={}){
      const host=this.editor();assert.ok(host.innerHTML.includes(`data-pe-form="${name}"`),`النموذج ${name} غير مرسوم في الدرج`);
      for(const key of Object.keys(values))assert.ok(host.innerHTML.includes(`name="${key}"`),`الحقل ${key} غير مرسوم في النموذج ${name}`);
      for(const key of Object.keys(structured.rows??{}))assert.ok(host.innerHTML.includes(`data-rows="${key}"`),`جدول ${key} غير مرسوم`);
      for(const key of Object.keys(structured.checks??{}))assert.ok(host.innerHTML.includes(`data-checks="${key}"`),`خانات ${key} غير مرسومة`);
      await host.listeners.submit({target:filledForm({peForm:name},values,structured),preventDefault(){},stopPropagation(){}});await setImmediate();
    }
  };
  await api.go(hash);
  return api;
}
async function world(t){
  const base=fixture(t),app=createApp(base.db),{sessions,call}=await sessionsFor(app,['employee','manager','outsider','admin']);
  t.after(async()=>{await closePageEditor({silent:true});for(const key of ['document','FormData','CSS'])delete globalThis[key];});
  return {...base,app,sessions,call};
}
const count=(text,needle)=>text.split(needle).length-1;

/* ───── 1. اختبار القبول الحاكم ───── */

test('admin studio, acceptance #1: a manager adds «مصدر الفرصة» to the Quote as a choice list, puts it in the header, requires it on «إصدار العرض للعميل», adds it as a list column and publishes — from the page itself, with no code and no restart',async t=>{
  const {app,sessions,call,quote}=await world(t);
  const manager=await browser(app,sessions.manager,'#quotations');
  assert.equal(buttonsIn(manager.page(),{action:'page-editor'}).length,1,'زر «تعديل هذه الصفحة» في رأس الصفحة');
  assert.ok(manager.page().includes('>تعديل هذه الصفحة</button>'));
  assert.ok(!manager.requests.some(r=>r.includes('page-editor')),'المحرّر لا يُطلب قبل فتحه');

  await manager.click({action:'page-editor'});
  const drawer=manager.editor();
  assert.ok(drawer&&drawer.id==='page-editor'&&drawer.attributes.role==='dialog','درج فوق الصفحة نفسها، لا صفحة إعدادات');
  for(const tab of ['الحقول','التخطيط','العروض','الحالات','الترجمة','الصلاحيات'])assert.ok(drawer.innerHTML.includes(`>${tab}</button>`),`تبويب ${tab}`);
  assert.ok(!/style=|<script|\son[a-z]+=/i.test(drawer.innerHTML),'لا style= ولا script في الدرج (CSP)');

  // (1) حقل جديد بنوع «قائمة اختيار». المدير لا يكتب معرّفًا: لا خانة له في النموذج.
  await manager.press({pe:'add-field',type:'select'});
  assert.ok(!/name="key"/.test(drawer.innerHTML),'مفتاح الحقل يولّده المحرّر');
  await manager.fill('field',{label_ar:'مصدر الفرصة',label_en:'Lead source',help:'من أين وصلتنا هذه الفرصة'},
    {rows:{options:[{label_ar:'إحالة من عميل',label_en:'Referral',tone:'positive'},{label_ar:'فعالية أو معرض',label_en:'Event'},{label_ar:'تواصل وارد',label_en:'Inbound'}]}});
  assert.equal(drawer.message.innerHTML.includes('vn-alert is-block'),false,drawer.message.innerHTML);
  assert.ok(drawer.innerHTML.includes('<strong>مصدر الفرصة</strong>'),'الحقل في قائمة الحقول المخصّصة');
  // (2) في الترويسة · (3) إلزامي عند «إصدار العرض للعميل» · (4) عمود في القائمة ومرشّح
  await manager.press({pe:'tab',tab:'layout'});await manager.press({pe:'place',key:'lead_source',slot:'header'});
  await manager.press({pe:'tab',tab:'statuses'});
  assert.ok(drawer.innerHTML.includes('إصدار العرض للعميل'),'الانتقالات المعلنة أعمدة في مصفوفة الإلزام');
  await manager.fill('require',{'req:issue:lead_source':'on'});
  await manager.press({pe:'tab',tab:'views'});await manager.press({pe:'toggle-column',key:'lead_source'});await manager.press({pe:'toggle-filter',key:'lead_source'});
  assert.equal(drawer.message.innerHTML.includes('vn-alert is-block'),false,drawer.message.innerHTML);

  // المعاينة: الصفحة الحقيقية تحت الدرج تعرض المسودة لمعدّها وحده، ولا يراها زميله.
  assert.ok(manager.page().includes('معاينة مسودة — لا يراها غيرك'));
  assert.ok(/<dl class="detail-data cf-fields cf-header">.*?<dt>مصدر الفرصة<\/dt>/s.test(manager.page()),'الحقل في ترويسة البطاقة أثناء المعاينة');
  const colleagueBefore=await browser(app,sessions.employee,'#quotations');
  assert.ok(!colleagueBefore.page().includes('مصدر الفرصة'),'المسودة لا يراها غير معدّها');
  assert.equal((await call('employee','/pricing')).json().custom_columns.length,0);

  // النشر بسبب مكتوب: تشديد (إلزام جديد) ينشره حامل النشر وحده حدثَ هوية.
  // المدير يعود إلى صفحته (تحميل جديد): المسودة محفوظة على الخادم، فيفتح الدرج عليها كما تركها.
  const again=await browser(app,sessions.manager,'#quotations');await again.click({action:'page-editor'});
  const live=again.editor();
  assert.ok(live.innerHTML.includes('name="pe-note"')&&buttonsIn(live.innerHTML,{pe:'publish'}).length===1,'زر النشر وسببه في تذييل الدرج');
  live.note.value='إضافة مصدر الفرصة لقياس قنوات البيع';
  await again.press({pe:'publish'});
  assert.ok(live.message.innerHTML.includes('نُشرت النسخة 1'),live.message.innerHTML);
  assert.ok(!again.page().includes('معاينة مسودة'),'بعد النشر تُرسم الصفحة بالمنشور');

  // الزميل، في الرسم التالي، بلا إعادة تشغيل: الحقل في الترويسة «غير متاح» بسببه ومن يسدّه، وعمود ومرشّح في القائمة.
  const colleague=await browser(app,sessions.employee,'#quotations');
  assert.ok(/cf-header">.*?<dt>مصدر الفرصة<\/dt><dd><span class="cf-missing">غير متاح<\/span><small>لم يُدخل بعد — يستكمله معدّ العرض/s.test(colleague.page()),'لا فراغ ولا صفر');
  assert.ok(colleague.page().includes('<th>مصدر الفرصة</th>'),'عمود القائمة');
  assert.ok(colleague.page().includes('data-filter="#quotation-list" data-filter-key="cfLead_source"'),'مرشّح القائمة');

  // الخادم هو الحكم: طلب مباشر يتجاوز الواجهة يلقى الرفض المكتوب نفسه.
  const version=()=>call('employee','/pricing').then(r=>r.json().quotations.find(q=>q.id===quote).version);
  const refused=await call('employee',`/pricing/quotations/${quote}/issue`,{version:await version(),note:''},409);
  const refusal=refused.json().error.details.refusal;
  assert.equal(refused.json().error.code,'required_on_transition');
  assert.equal(refusal.missing[0].document,'مصدر الفرصة');assert.match(refusal.missing[0].why,/النسخة 1/);assert.ok(refusal.missing[0].owner&&refusal.next&&refusal.link);

  // ومن الشاشة: حوار «إصدار العرض للعميل» نفسه يحمل الحقل إلزاميًا، فيُملأ فيه ويصدر العرض.
  await colleague.click({action:'operation',operation:'issue_quotation',id:quote});
  const form=colleague.dialog().innerHTML;
  assert.ok(/<select name="cf:lead_source" required /.test(form)&&form.includes('>تواصل وارد</option>'),'الحقل الملزَم داخل حوار الانتقال');
  await colleague.submitDialog({note:'','cf:lead_source':'inbound'});
  assert.equal(colleague.dialogError(),'');
  const issued=(await call('employee','/pricing')).json().quotations.find(q=>q.id===quote);
  assert.deepEqual([issued.status,issued.custom_fields.lead_source,issued.definition_version],['issued','inbound',1]);
  assert.ok(colleague.page().includes('data-cf-lead_source="inbound"')&&colleague.page().includes('<dd>تواصل وارد</dd>'),'القيمة في الترويسة وفي صف القائمة');
});

/* ───── 2. تبديل التسمية يصل كل شاشة دفعة واحدة، ويُسترجع بنقرة ───── */

test('admin studio, acceptance #2: renaming «العميل» to «الجهة» reaches every pilot screen, their dialogs and their list heads at once — labels, not prose — and rolls back in one click',async t=>{
  const {app,sessions,call}=await world(t);
  const manager=await browser(app,sessions.manager,'#clients');
  await manager.click({action:'page-editor'});await manager.press({pe:'tab',tab:'translation'});
  await manager.fill('translation',{'entity:ar':'الجهة','entity:en':'Party'});
  manager.editor().note.value='تسمية العميل «الجهة» في كل الشاشات';
  await manager.press({pe:'publish'});
  assert.ok(manager.editor().message.innerHTML.includes('نُشرت النسخة 1'),manager.editor().message.innerHTML);

  const staff=await browser(app,sessions.employee,'#quotations');
  assert.ok(staff.page().includes('<th>الجهة</th>')&&!staff.page().includes('<th>العميل</th>'),'رأس عمود العميل في قائمة العروض يرث اسم كيانه');
  await staff.go('#pipeline');
  assert.ok(staff.page().includes('<th>الجهة</th>'),'وفي قائمة الفرص');
  await staff.click({action:'operation',operation:'create_opportunity'});
  assert.ok(staff.dialog().innerHTML.includes('<span>الجهة <span class="required">*</span></span>'),'وتسمية الحقل في حوار «فرصة جديدة» بلا تعديل شاشة');
  // مرور التسميات على DOM: عنصر التسمية يتبدل، وبيانات المستخدم والجمل لا تُمس.
  const fragment={innerHTML:'<table><thead><tr><th>العميل</th></tr></thead><tbody><tr><td>العميل</td></tr></tbody></table><dl><dt>العميل</dt><dd>العميل</dd></dl><p>سبب الفوز كما ذكره العميل</p>',
    querySelectorAll(){return labelElements(this);}};
  assert.equal(client.relabel(fragment,'quotations','ar'),2);
  assert.equal(fragment.innerHTML,'<table><thead><tr><th>الجهة</th></tr></thead><tbody><tr><td>العميل</td></tr></tbody></table><dl><dt>الجهة</dt><dd>العميل</dd></dl><p>سبب الفوز كما ذكره العميل</p>');
  assert.equal(client.text('سبب الفوز كما ذكره العميل','quotations','ar'),'سبب الفوز كما ذكره العميل','الجملة تبقى كما كُتبت: التبديل للتسميات لا للنثر');
  assert.equal(client.text('Client','quotations','en'),'Party','والإنجليزية بتسميتها');

  // تراجع بنقرة: نسخة جديدة وثيقتها افتراضات الكود، فتعود التسمية في كل مكان.
  const back=await browser(app,sessions.manager,'#clients');await back.click({action:'page-editor'});await back.press({pe:'tab',tab:'history'});
  await back.press({pe:'rollback',version:0});
  assert.ok(back.editor().message.innerHTML.includes('صارت النسخة 2'),back.editor().message.innerHTML);
  const after=await browser(app,sessions.employee,'#quotations');
  assert.ok(after.page().includes('<th>العميل</th>')&&!after.page().includes('الجهة'));
  const history=(await call('manager','/definitions/client')).json().history;
  assert.deepEqual(history.map(h=>[h.version,h.origin]),[[2,'rollback'],[1,'editor']]);
});

/* ───── 3. الزر والدرج لحامل التصريح وحده ───── */

test('admin studio: without the configure capability there is no button, no drawer and no editor payload — and a configurer who does not work on the entity gets no button there either',async t=>{
  const {app,sessions,call}=await world(t);
  const outsider=await browser(app,sessions.outsider,'#quotations');
  assert.ok(outsider.page().includes('عروض')||outsider.page().length>0);
  assert.equal(buttonsIn(outsider.page(),{action:'page-editor'}).length,0,'لا زر «تعديل هذه الصفحة»');
  assert.equal(outsider.editor(),null);
  assert.ok(!outsider.shell().includes('#definitions'),'ولا شاشة «تعريفات الصفحات» في قائمته');
  const refused=await call('outsider','/definitions/client_quotation',undefined,403);
  assert.ok(refused.json().error.details.refusal.missing[0].document.includes('definitions.configure'),'الرفض يسمّي التصريح الناقص ومن يمنحه');
  await call('outsider','/definitions/client_quotation/draft',{spec:{}},403);
  // اللقطة نفسها تقول للواجهة أين يُرسم الزر: للمدير على عروض الأسعار نعم، ولمن لا يحمل التصريح لا.
  assert.equal((await call('manager','/definitions/snapshot')).json().entities.client_quotation.configurable,true);
  assert.equal((await call('outsider','/definitions/snapshot')).json().entities.client_quotation.configurable,false);
  // شاشة بلا كيان مشارك لا زر فيها حتى لحامل التصريح.
  const manager=await browser(app,sessions.manager,'#leave');
  assert.equal(buttonsIn(manager.page(),{action:'page-editor'}).length,0);
});

/* ───── 4. تخفيف ضابط: شخص يُعدّ وآخر ينشر، من الدرج نفسه ───── */

test('admin studio: removing a required rule is a loosening — the drawer offers «تسليم للنشر» instead of «نشر», the draft reaches the second publisher’s inbox, and they publish it from their own drawer',async t=>{
  const {app,sessions,call,publish,users}=await world(t);
  publish('client_quotation',{fields:[{key:'lead_source',label:{ar:'مصدر الفرصة'},type:'text',required:false}],transitions:{issue:{require:['lead_source']}}},{by:users.manager});
  const manager=await browser(app,sessions.manager,'#quotations');
  await manager.click({action:'page-editor'});await manager.press({pe:'tab',tab:'statuses'});
  await manager.fill('require',{});
  const drawer=manager.editor();
  assert.ok(drawer.innerHTML.includes('رفع إلزام عند انتقال: مصدر الفرصة'),'الفرق مكتوب في تذييل الدرج بصنفه');
  assert.equal(buttonsIn(drawer.innerHTML,{pe:'publish'}).length,0,'لا زر نشر لمن أعدّ تخفيفًا');
  await manager.press({pe:'submit'});
  assert.ok(drawer.message.innerHTML.includes('سُلّمت المسودة للنشر'),drawer.message.innerHTML);
  // الخادم يرفض النشر المباشر من المُعدّ حتى لو تجاوز الواجهة.
  const draft=(await call('manager','/definitions/client_quotation')).json().draft;
  assert.equal((await call('manager','/definitions/client_quotation/publish',{row_version:draft.row_version,note:'محاولة نشر من المُعدّ'},409)).json().error.code,'second_publisher_required');
  // الناشر الثاني: في «بانتظار قراري»، ثم من درجه هو.
  const inbox=(await call('employee','/inbox')).text;
  assert.ok(inbox.includes('تعريف «عرض السعر»')&&inbox.includes('#definitions?focus=client_quotation'),'المسودة في صندوق الناشر الثاني ورابطها يقف عندها');
  const second=await browser(app,sessions.employee,'#definitions');
  assert.ok(second.page().includes('بانتظار نشري'));
  await second.click({action:'page-editor',entity:'client_quotation'},{within:'page'});
  second.editor().note.value='راجعت رفع الإلزام ووافقت عليه';
  await second.press({pe:'publish'});
  const top=(await call('employee','/definitions/client_quotation')).json().history[0];
  assert.deepEqual([top.version,top.change_class,top.two_person,top.prepared_by,top.published_by],[2,'loosening',true,'manager','employee']);
});

/* ───── 5. «جرّب كمستخدم» ───── */

test('view as: a manager trying the platform as an ordinary employee sees no costs or margins, cannot approve, pay or change a permission — refused by the server, not hidden — and the trial is recorded under their own name',async t=>{
  const {app,db,users,tx,sessions,call,quote}=await world(t);
  assert.equal((await call('manager','/view-as/start',{persona:'employee',reason:'مراجعة ما يراه الموظف في عروض الأسعار'},403)).json().error.code,'not_permitted','تصريح حساس: لا يُفتح بلا منح صريح');
  tx(()=>grantAccess(db,users.admin,{user_id:'manager',capability:'access.view_as',department_id:'',note:'منح تجريبي'}));
  await call('admin','/view-as/start',{persona:'employee',reason:'الأدمن الأول لا يجرّب بامتيازه وحده'},403);
  await call('manager','/view-as/start',{persona:'employee',reason:'قصير'},400);
  assert.equal((await call('manager','/pricing',undefined,200)).json().quotations[0].current.snapshot.net_margin_bp>0,true,'قبل التجربة يرى الهامش');

  await call('manager','/view-as/start',{persona:'employee',reason:'مراجعة ما يراه الموظف في عروض الأسعار'},201);
  const me=(await call('manager','/me')).json().user;
  assert.deepEqual([me.id,me.role,me.admin_level,me.view_as.persona],['manager','employee',null,'employee'],'الهوية هي هي، والدور دور الشخصية');
  for(const gone of ['pricing.sheets.use','definitions.configure','definitions.publish','access.view_as','clients.manage','projects.use'])assert.ok(!me.can.includes(gone),`${gone} سقط أثناء التجربة`);
  assert.ok(me.can.includes('leave.use')&&me.can.includes('requests.use'),'يبقى ما يحمله الموظف العادي ويحمله هو');
  for(const path of ['/pricing','/pipeline','/definitions','/definitions/client_quotation','/admin/accounts'])await call('manager',path,undefined,403);
  assert.equal((await call('manager','/me')).json().user.capabilities.finance,false,'التفويض المالي منحٌ، والمنح تسقط');

  // لا اعتماد ولا دفع ولا تنفيذ ولا إكمال ولا تغيير تصريح: بالبناء، قبل أن يبلغ الطلب أي معالج — حتى مسار لا وجود له.
  const version=db.prepare('SELECT version FROM client_quotations WHERE id=?').get(quote).version;
  for(const [path,body] of [[`/pricing/quotations/${quote}/issue`,{version,note:''}],['/payables/x/pay',{}],['/admin/access/grants',{user_id:'outsider',capability:'definitions.publish'}],
    ['/requests/x/approve',{version:1}],['/tasks/x/complete',{version:1}],['/definitions/client_quotation/publish',{row_version:1,note:'نشر أثناء التجربة'}],['/no/such/path',{}]]){
    const refused=await call('manager',path,body,403);
    assert.equal(refused.json().error.code,'view_as_read_only',path);
  }
  assert.equal(db.prepare('SELECT status FROM client_quotations WHERE id=?').get(quote).status,'draft','لم يتغير شيء');
  const denied=db.prepare("SELECT actor_id,after_json FROM audit_events WHERE action='denied' ORDER BY seq DESC LIMIT 1").get();
  assert.deepEqual([denied.actor_id,JSON.parse(denied.after_json)],['manager',{code:'view_as_read_only',view_as:'employee'}],'صف التدقيق باسم صاحبه الحقيقي «كـ موظف»');

  // الشريط الأحمر في الهيكل، وقائمته قائمة الموظف، وزر «تعديل هذه الصفحة» غائب.
  const trial=await browser(app,sessions.manager,'#quotations');
  assert.ok(/<div class="view-as-banner" role="status"><strong>جرّب كمستخدم: موظف عادي<\/strong>/.test(trial.shell()));
  assert.ok(trial.shell().includes('data-action="view-as-stop"')&&!trial.shell().includes('href="#quotations"'),'لا مدخل لعروض الأسعار في قائمته');
  assert.equal(buttonsIn(trial.page(),{action:'page-editor'}).length,0);

  await trial.click({action:'view-as-stop'});
  assert.equal((await call('manager','/me')).json().user.role,'manager');assert.ok(!trial.shell().includes('view-as-banner'));
  await call('manager','/pricing',undefined,200);
  // تجربة ثانية في جلسة الدخول نفسها تسجّل شاشاتها هي، لا تبتلعها الأولى.
  await call('manager','/view-as/start',{persona:'hr',reason:'تجربة ثانية في الجلسة نفسها للتأكد من السجل'},201);
  await call('manager','/pricing',undefined,403);await call('manager','/view-as/stop',{},201);
  const log=(await call('manager','/view-as/log')).json();
  assert.deepEqual(log.runs.map(r=>[r.persona,r.end_name,r.screens.includes('/api/pricing'),r.actor_name]),[['hr','أنهاها صاحبها',true,users.manager.name],['employee','أنهاها صاحبها',true,users.manager.name]]);
  assert.match(log.runs[1].reason,/مراجعة ما يراه الموظف/);
  const events=db.prepare("SELECT action,actor_id FROM audit_events WHERE entity_type='view_as' ORDER BY seq").all();
  assert.deepEqual(events.map(e=>e.action),['view_as.started','view_as.ended','view_as.started','view_as.ended']);assert.ok(events.every(e=>e.actor_id==='manager'));
  assert.equal(verifyAudit(db),true,'سلسلة التدقيق سليمة');
  assert.throws(()=>db.prepare("UPDATE view_as_events SET reason='x'").run(),/not rewritten/);assert.throws(()=>db.prepare('DELETE FROM view_as_events').run(),/retained/);
  await call('outsider','/view-as/log',undefined,403);
});

test('view as: the trial ends by itself after thirty minutes, and a request after it sees no persona',async t=>{
  const {db,users,tx}=await world(t);
  tx(()=>grantAccess(db,users.admin,{user_id:'manager',capability:'access.view_as',department_id:'',note:'منح تجريبي'}));
  const session={token_hash:'a'.repeat(64)};
  tx(()=>viewAs.start(db,users.manager,session,{persona:'pm',reason:'تجربة تنتهي مدتها من تلقائها'}));
  const run=viewAs.active(db,session,users.manager);
  assert.equal(run.persona,'pm');assert.ok(run.capabilities.includes('projects.use')&&!run.capabilities.includes('pricing.sheets.use'),'افتراضات الدور ∩ ما يحمله هو: المنح تسقط');
  assert.deepEqual(viewAs.personaRow(users.manager,run).role,'pm');assert.equal(viewAs.personaRow(users.employee,run).role,'employee','الخفض على صاحب التجربة وحده');
  t.mock.timers.enable({apis:['Date'],now:Date.now()+(viewAs.TTL_MINUTES+1)*60000});
  assert.equal(viewAs.active(db,session,users.manager),null);
  assert.deepEqual(db.prepare('SELECT event FROM view_as_events ORDER BY seq').all().map(r=>r.event),['started','expired']);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM audit_events WHERE action='view_as.expired'").get().n,1);
});

/* ───── 6. الحقول المخصّصة تصل النماذج: إنشاء، وتعديل، وحفظ عام، وشرط ظهور ───── */

test('custom fields reach the forms of hand-written screens through one seam: a create form, the generic «تعديل الحقول المخصّصة» dialog, and a conditional field',async t=>{
  const {app,sessions,call,publish,users,client:clientId}=await world(t);
  publish('client',{fields:[{key:'tier',label:{ar:'فئة الحساب',en:'Account tier'},type:'select',required:true,options:[{value:'key',label:{ar:'رئيسي'},tone:'positive'},{value:'standard',label:{ar:'اعتيادي'}}]},
    {key:'key_reason',label:{ar:'لماذا هو رئيسي'},type:'text',required:false,show_when:{field:'tier',equals:['key']}}],layout:{slots:{header:['tier']}},views:{list:{columns:['tier'],filters:['tier']}}},{by:users.manager});
  const staff=await browser(app,sessions.employee,'#clients');
  // نموذج الإنشاء يحمل الحقلين، والمشروط يحمل شرطه سمتين يقرؤهما applyConditions.
  await staff.click({action:'operation',operation:'create_client'});
  const create=staff.dialog().innerHTML;
  assert.ok(create.includes('<select name="cf:tier" required ')&&create.includes('data-cf-when="cf:tier" data-cf-equals="[&quot;key&quot;]"'));
  await staff.submitDialog({legal_name:'شركة جديدة تجريبية',trade_name:'',sector:'التقنية',status:'prospect',notes:'','cf:tier':'key','cf:key_reason':'أكبر عقد هذا العام'});
  assert.equal(staff.dialogError(),'');
  const created=(await call('employee','/clients')).json().clients.find(c=>c.legal_name==='شركة جديدة تجريبية');
  assert.deepEqual(created.custom_fields,{tier:'key',key_reason:'أكبر عقد هذا العام'});
  // السجل القائم قبل نشر الحقل: «غير متاح» في ترويسته، وزر «تعديل الحقول المخصّصة» يفتح النموذج العام ويحفظ بنسخة السجل.
  assert.ok(buttonsIn(staff.page(),{action:'custom-fields',entity:'client',id:clientId}).length===1);
  await staff.click({action:'custom-fields',entity:'client',id:clientId});
  assert.ok(staff.dialog().innerHTML.includes('الحقول المخصّصة — العميل'));
  await staff.submitDialog({'cf:tier':'standard','cf:key_reason':'لا يُحفظ: شرطه غير متحقق'});
  assert.equal(staff.dialogError(),'');
  const saved=(await call('employee','/clients')).json().clients.find(c=>c.id===clientId);
  assert.deepEqual(saved.custom_fields,{tier:'standard'},'الحقل الذي أخفاه شرطه لا تدخل قيمته السجل ولو أرسلتها الواجهة');
  assert.ok(staff.page().includes('data-cf-tier="standard"')&&staff.page().includes('<span class="badge approved">رئيسي</span>'),'لون الخيار صنف من لوحة الهوية');
  assert.equal(count(staff.page(),'data-filter-key="cfTier"'),1);
});

/* ───── 7. مصطلحات المنصة: تجاوز مفتاح من القاموس يصل ما يُرسم عبر القاموس، والقاموس يبقى منزل الافتراض ───── */

test('platform terms: an override of a vocabulary key is data — it reaches what app.mjs draws through the vocabulary, and rolling it back returns the vocabulary phrase',async t=>{
  const {app,sessions,call}=await world(t);
  const before=await browser(app,sessions.manager,'#requests');
  assert.ok(before.page().includes('<option value="pending">بانتظار الاعتماد</option>'),'عبارة القاموس قبل أي تجاوز');
  const draft=(await call('manager','/definitions/platform/draft',{spec:{terms:{'status.request.pending':{ar:'ينتظر القرار',en:'Awaiting a decision'},'role.manager':{ar:'قائد فريق'}}}},201)).json();
  await call('manager','/definitions/platform/publish',{row_version:draft.row_version,note:'توحيد عبارة الانتظار واسم الدور'},201);
  const after=await browser(app,sessions.manager,'#requests');
  assert.ok(after.page().includes('<option value="pending">ينتظر القرار</option>')&&!after.page().includes('>بانتظار الاعتماد</option>'),'التجاوز المنشور يُسأل قبل القاموس');
  assert.ok(after.shell().includes('<small>قائد فريق</small>'),'واسم الدور في الفهرس');
  assert.equal(client.term('status.request.pending','en'),'Awaiting a decision');assert.equal(client.term('status.request.approved','ar'),null,'ما لم يُتجاوز يبقى للقاموس');
  await call('manager','/definitions/platform/rollback',{to_version:0,note:'العودة إلى عبارات القاموس'},201);
  const back=await browser(app,sessions.manager,'#requests');
  assert.ok(back.page().includes('<option value="pending">بانتظار الاعتماد</option>')&&back.shell().includes('<small>مدير فريق</small>'));
});

/* ───── نقائص قِيست على هذا الفرع (05e7002) وأُصلحت عند سببها ───── */

// (5) الدرج حوار: من يغلقه يجد التركيز حيث تركه، لا في أول الصفحة. closePageEditor كانت تزيل المضيف ولا تحفظ فاتحه،
// فمن يتنقّل بلوحة المفاتيح وحدها يعيد المسير من أول الصفحة بعد كل إغلاق.
test('page editor: closing the drawer returns focus to the «تعديل هذه الصفحة» button that opened it',async t=>{
  const {app,sessions}=await world(t);
  const manager=await browser(app,sessions.manager,'#quotations');
  await manager.click({action:'page-editor'});
  assert.ok(manager.editor(),'الدرج مفتوح');
  assert.deepEqual(manager.focusLog,[],'لا تركيز يعود قبل الإغلاق');
  await manager.press({pe:'close'});
  assert.equal(manager.editor(),null,'أُغلق الدرج');
  assert.deepEqual(manager.focusLog,['action:page-editor'],'عاد التركيز إلى الزر الذي فتح الدرج');
});

// (2) تبديل اسم الكيان كان يصل التسمية المطابقة بالنص كله وحدها، فتتبدّل ترويسة عمود ويبقى «رمز العميل» بجوارها.
// التسمية المركّبة تسميةٌ لا جملة. والحدود مقصودة ومكتوبة: لا تُمسّ كلمة أطول، ولا جمع، ولا جملة خارج عنصر التسمية.
test('page editor: renaming an entity reaches compound labels that contain its name, and stops at word boundaries, plurals and sentences',t=>{
  t.after(()=>client.setSnapshot(null));
  client.setSnapshot({glossary:{ar:{global:{'العميل':'الجهة'},views:{}},en:{global:{},views:{}}},entities:{},terms:{},digest:'d'});
  const labels=['رمز العميل','صاحب القرار لدى العميل','سند ميزانية العميل','العميل','العميلة','ملفات العملاء','صدر للعميل','اسم المشروع'];
  const nodes=labels.map(value=>({childNodes:[{nodeType:3,textContent:value}]}));
  const changed=client.relabel({querySelectorAll:()=>nodes},'clients','ar');
  assert.deepEqual(nodes.map(n=>n.childNodes[0].textContent),
    ['رمز الجهة','صاحب القرار لدى الجهة','سند ميزانية الجهة','الجهة','العميلة','ملفات العملاء','صدر للعميل','اسم المشروع']);
  assert.equal(changed,4);
  // الجمل وبيانات المستخدم خارج عناصر التسمية أصلًا: relabel لا تراها.
  const sentence={childNodes:[{nodeType:3,textContent:'العميل لا يدخل المنصة، وما يصله يصله من مسؤول حسابه'}]};
  client.relabel({querySelectorAll:()=>[sentence]},'clients','ar');
  assert.equal(sentence.childNodes[0].textContent,'الجهة لا يدخل المنصة، وما يصله يصله من مسؤول حسابه',
    'داخل عنصر تسمية يقع الاستبدال؛ وعناصر التسمية وحدها ما تمر عليه relabel في الصفحة');
});

// (11) الدرج 460px والجدول المشترك يفرض أرضية 560px، وحاوية الانزلاق أُلغيت فوقه: الجدول كان يخرج من المتن فيُقصّ
// عمود اللون وزر الحذف، ويسحب التركيزُ النموذجَ كلَّه جانبًا. وسبعة تبويبات في شريط ينزلق بلا مؤشر انزلاق تُخفي السابع.
test('page editor: the drawer stylesheet keeps the options table and the tab strip inside 460px',()=>{
  const css=readFileSync(new URL('page-editor.css',STATIC),'utf8');
  assert.match(css,/\.pe-options \.rows-field table\{[^}]*min-inline-size:0/,'أرضية الجدول المشتركة (560px) مُصفَّرة داخل الدرج');
  assert.ok(!/\.pe-options \.table-wrap\{overflow-x:visible\}/.test(css),'حاوية الجدول تبقى على انزلاقها المشترك ولا تُلغى');
  assert.match(css,/\.pe-tabs\{[^}]*flex-wrap:wrap/,'التبويبات تلتف فتُرى السبعة');
  assert.ok(!/\.pe-tabs\{[^}]*overflow-x:auto/.test(css),'ولا تنزلق بلا مؤشر انزلاق');
  assert.match(css,/\.pe-body\{[^}]*overflow-x:hidden/,'متن الدرج لا ينزلق عرضًا');
  assert.match(css,/\.cf-records td small\{[^}]*overflow-wrap:anywhere/,'سبب «غير متاح» لا يفرض عرضًا على عمود القائمة');
  // قواعد المنصة على حالها في الملف كله.
  assert.ok(!/(^|[^-])\b(?:width|height|margin-left|margin-right|padding-left|padding-right|left|right):/m.test(css),'خصائص منطقية وحدها');
});

// (9) سجل «جرّب كمستخدم» كان يقرأ آخر 600 حدث ثم يُسقط كل تشغيل خرج صفُّ بدئه من النافذة: تشغيلٌ واحد كثيرُ الشاشات
// يكفي لابتلاع ما قبله، والشاشة تقول «تعرض هذه القائمة تجارب الجميع».
test('view as: a run with many screens does not push earlier runs out of the log',async t=>{
  const {db,users}=await world(t),tx=f=>transaction(db,f);
  tx(()=>grantAccess(db,users.admin,{user_id:'manager',capability:'access.view_as',department_id:'',note:'منح تجريبي'}));
  const session={token_hash:'b'.repeat(64)};
  // ثلاثة تشغيلات، أوسطها يفتح مئتي عائلة مسارات — أكثر من نافذة الأحداث القديمة وحدها (600 حدثًا) حين تُضاف إليه جيرانه.
  for(const [n,screens] of [[1,2],[2,400],[3,2]]){
    tx(()=>viewAs.start(db,users.manager,session,{persona:'employee',reason:`تجربة رقم ${n} لقياس السجل`}));
    const run=viewAs.active(db,session,users.manager);
    tx(()=>{for(let i=0;i<screens;i++)viewAs.noteScreen(db,run,users.manager,`/api/screen-${n}-${i}`);});
    tx(()=>viewAs.stop(db,users.manager,session));
  }
  const log=viewAs.log(db,users.manager);
  assert.equal(log.runs.length,3,`التشغيلات الثلاثة كلها في السجل: ${JSON.stringify(log.runs.map(r=>r.reason))}`);
  // الأحدث أولًا، كما كان.
  assert.deepEqual(log.runs.map(r=>r.reason),['تجربة رقم 3 لقياس السجل','تجربة رقم 2 لقياس السجل','تجربة رقم 1 لقياس السجل']);
  assert.equal(log.runs.find(r=>r.reason.includes('رقم 2')).screens.length,400,'وشاشات التشغيل الكبير كلها معه');
  assert.ok(log.runs.every(r=>r.started_at&&r.ended_at),'لكل تشغيل بدؤه ونهايته');
  assert.equal(log.limit,60,'الحدّ عدد تجارب لا عدد أحداث، ويُقال');
});
