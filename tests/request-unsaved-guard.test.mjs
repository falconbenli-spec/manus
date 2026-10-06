import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
const source=readFileSync(new URL('../app/static/app.mjs',import.meta.url),'utf8');
function setup(){
 const form={id:'request-form',elements:[{name:'title',type:'text',value:'طلب',disabled:false},{name:'field:note',type:'textarea',value:'',disabled:false}]};
 const dialog={open:true,querySelector:()=>form};let prompts=0,answer=false;
 const sandbox={dialog,window:{confirm(){prompts++;return answer;}},tr:a=>a};
 const start=source.indexOf('let requestFormBaseline='),end=source.indexOf('function showDialog',start);
 assert.ok(start>=0,'حماية النموذج موجودة');
 runInNewContext(source.slice(start,end)+';globalThis.guard={captureRequestBaseline,requestHasChanges,allowRequestDiscard};',sandbox);
 sandbox.guard.captureRequestBaseline();
 return {form,dialog,guard:sandbox.guard,prompts:()=>prompts,accept:()=>answer=true};
}
test('النموذج الجديد والتعديل المعاد إلى أصله يغلقان بلا تحذير',()=>{const x=setup();assert.equal(x.guard.allowRequestDiscard(),true);x.form.elements[1].value='كتابة';x.form.elements[1].value='';assert.equal(x.guard.allowRequestDiscard(),true);assert.equal(x.prompts(),0);});
test('رفض فقد المدخلات يحتفظ بالقيم ويمنع الاستبدال',()=>{const x=setup();x.form.elements[1].value='بياناتي';assert.equal(x.guard.allowRequestDiscard(),false);assert.equal(x.form.elements[1].value,'بياناتي');assert.equal(x.guard.requestHasChanges(),true);x.accept();assert.equal(x.guard.allowRequestDiscard(),true);assert.equal(x.prompts(),2);});
test('القيم المخفية تبقى محمية والحفظ الناجح يعيد خط الأساس',()=>{const x=setup();x.form.elements[1].value='تفصيل';x.form.elements[1].disabled=true;assert.equal(x.guard.requestHasChanges(),true);x.guard.captureRequestBaseline();assert.equal(x.guard.allowRequestDiscard(),true);assert.equal(x.prompts(),0);});
test('Escape وتغيير المسار يتركان النموذج مفتوحًا عند رفض الفقد',()=>{
 const x=setup();x.form.elements[1].value='مسودة';const events={},replaced=[];let renders=0;
 const sandbox={dialog:{...x.dialog,addEventListener:(name,fn)=>events[name]=fn,close(){this.open=false;}},window:{addEventListener:(name,fn)=>events[name]=fn},allowRequestDiscard:x.guard.allowRequestDiscard,requestHasChanges:x.guard.requestHasChanges,history:{replaceState:(_a,_b,url)=>replaced.push(url)},closeDesignMenu(){},pageEditor:null,routeRender(){renders++;},paintAppearance(){},dialogEpoch:0};
 const lines=source.split('\n').filter(line=>line.startsWith("dialog.addEventListener?.('cancel'")||line.startsWith("window.addEventListener('beforeunload'")||line.startsWith("window.addEventListener('hashchange'"));
 runInNewContext(lines.join('\n'),sandbox);let prevented=0;
 events.cancel({preventDefault(){prevented++;}});assert.equal(prevented,1);
 events.hashchange({oldURL:'http://localhost/#services'});assert.deepEqual(replaced,['http://localhost/#services']);assert.equal(renders,0);assert.equal(sandbox.dialog.open,true);
 const unload={preventDefault(){prevented++;}};events.beforeunload(unload);assert.equal(prevented,2);assert.equal(unload.returnValue,'');
 x.accept();events.hashchange({oldURL:'http://localhost/#services'});assert.equal(renders,1);assert.equal(sandbox.dialog.open,false);
});
test('فشل الحفظ يبقي البيانات والتحذير ونجاحه يغلق دون سؤال',async()=>{
 const x=setup();x.form.elements[1].value='تفصيل مهم';x.form.dataset={};x.form.querySelector=()=>null;
 const errorNode={innerHTML:''};let submit,fail=true;
 x.dialog.close=()=>{x.dialog.open=false;};
 const sandbox={dialog:x.dialog,renderId:1,dialogEpoch:1,location:{hash:'#services'},searchSession:{id:null},document:{addEventListener:(_name,fn)=>submit=fn,querySelector:()=>errorNode},FormData:class{constructor(form){this.entries=form.elements.map(c=>[c.name,c.value]);}get(key){return this.entries.find(([k])=>k===key)?.[1];}*[Symbol.iterator](){yield* this.entries;}},api:async()=>{if(fail)throw Error('تعذر الحفظ');return {id:'saved'};},captureRequestBaseline:x.guard.captureRequestBaseline,tr:a=>a,e:String,toast(){},markFieldErrors(){},render(){}};
 const start=source.indexOf("document.addEventListener('submit',async ev=>{"),end=source.indexOf('// الخطأ تحت حقله',start);
 runInNewContext(source.slice(start,end),sandbox);
 await submit({target:x.form,preventDefault(){}});
 assert.equal(x.dialog.open,true);assert.equal(x.form.elements[1].value,'تفصيل مهم');assert.equal(x.guard.requestHasChanges(),true);assert.match(errorNode.innerHTML,/تعذر الحفظ/);
 fail=false;await submit({target:x.form,preventDefault(){}});assert.equal(x.dialog.open,false);assert.equal(x.prompts(),0);assert.equal(sandbox.location.hash,'request/saved');
});
test('أثناء الحفظ تقفل الحقول ثم ترجع لحالتها الأصلية عند الفشل',async()=>{
 const x=setup();x.form.elements[1].value='A';x.form.elements.push({name:'field:hidden',type:'text',value:'قديم',disabled:true});x.form.dataset={};x.form.querySelector=()=>null;
 let submit,rejectSave,focused=false;const errorNode={innerHTML:''};
 const field=x.form.elements[1];field.setAttribute=()=>{};field.focus=()=>{assert.equal(field.disabled,false,'الحقل متاح لحظة محاولة تركيز الخطأ');assert.equal(x.form.elements[2].disabled,true,'الحقل المعطل أصلًا لا يُفعّل');focused=true;};
 const label={querySelector:()=>field,insertAdjacentHTML(){}};x.form.querySelector=selector=>selector.startsWith('[data-field=')?label:null;x.form.querySelectorAll=()=>[];
 const sandbox={dialog:x.dialog,renderId:1,dialogEpoch:1,location:{hash:'#services'},searchSession:{id:null},document:{addEventListener:(_name,fn)=>submit=fn,querySelector:()=>errorNode},FormData:class{constructor(form){this.entries=form.elements.filter(c=>!c.disabled).map(c=>[c.name,c.value]);}get(key){return this.entries.find(([k])=>k===key)?.[1];}*[Symbol.iterator](){yield* this.entries;}},api:()=>new Promise((_resolve,reject)=>rejectSave=reject),captureRequestBaseline:x.guard.captureRequestBaseline,tr:a=>a,e:String,toast(){},markFieldErrors(){},render(){}};
 const start=source.indexOf("document.addEventListener('submit',async ev=>{"),end=source.indexOf('// الخطأ تحت حقله',start);sandbox.CSS={escape:String};
 runInNewContext(source.slice(source.indexOf('function markFieldErrors('),source.indexOf('function reviewTable('))+source.slice(start,end),sandbox);
 const pending=submit({target:x.form,preventDefault(){}});
 assert.equal(x.form.elements[1].disabled,true,'الحقل غير قابل للكتابة B أثناء إرسال A');rejectSave(Object.assign(Error('تعذر الحفظ'),{details:{field:'note'}}));await pending;assert.equal(focused,true);
 assert.equal(x.form.elements[1].disabled,false);assert.equal(x.form.elements[2].disabled,true);assert.equal(x.form.elements[1].value,'A');assert.equal(x.dialog.open,true);
});
test('تغيير الخدمة لا يستبدل حقول الطلب عند رفض فقدها',()=>{
 const x=setup(),service={name:'service_id',type:'select-one',value:'old',dataset:{},matches:()=>true};x.form.elements.push(service);x.form.querySelector=()=>service;x.guard.captureRequestBaseline();x.form.elements[1].value='تفصيل لا يضيع';service.value='new';
 let change;const fields={innerHTML:'الحقول القديمة'};
 const sandbox={document:{addEventListener:(_name,fn)=>change=fn,querySelector:()=>fields},allowRequestDiscard:x.guard.allowRequestDiscard,services:[{id:'new',fields:[]}],applyFieldConditions(){},operationView:'none',fieldInput(){}};
 const start=source.indexOf("document.addEventListener('change',ev=>{if(ev.target.matches('#request-form select[name=service_id]'))"),end=source.indexOf("document.addEventListener('click'",start);runInNewContext(source.slice(start,end),sandbox);
 change({target:service});assert.equal(service.value,'old');assert.equal(fields.innerHTML,'الحقول القديمة');assert.equal(x.form.elements[1].value,'تفصيل لا يضيع');
 service.value='new';x.accept();change({target:service});assert.equal(service.value,'new');assert.equal(fields.innerHTML,'');
});
test('زر إغلاق الطلب يمر من مستمع التصميم الملتقط إلى حماية التطبيق مرة واحدة',()=>{
 const x=setup();x.dialog.close=()=>x.dialog.open=false;x.form.elements[1].value='لا تضيع';let capture,bubble;
 const signature=readFileSync(new URL('../app/static/signature.mjs',import.meta.url),'utf8');
 const start=signature.indexOf("document.addEventListener('click',event=>{",signature.indexOf('// إغلاق النوافذ'));
 const end=signature.indexOf('},true);',start)+9;
 class Element{};const target=new Element();target.closest=selector=>selector==='dialog [data-action="close"]'?{closest:()=>x.dialog}:null;
 const sandbox={Element,document:{addEventListener:(_name,fn)=>capture=fn},rememberAppearanceFocus(){},compact:()=>true,closeDialog(dialog){dialog.open=false;}};
 runInNewContext(signature.slice(start,end),sandbox);
 const closeAction=source.match(/else if\(action==='close'\)\{([^\n]+)\}/)[1];
 bubble=()=>runInNewContext('(function(){'+closeAction+'})()',{allowRequestDiscard:x.guard.allowRequestDiscard,dialog:x.dialog,dialogEpoch:0});
 capture({target});bubble();assert.equal(x.dialog.open,true);assert.equal(x.prompts(),1);
});
test('إغلاق التصميم بالسحب أو الخلفية يحترم رفض cancel',()=>{
 const signature=readFileSync(new URL('../app/static/signature.mjs',import.meta.url),'utf8');const fn=signature.split('\n').find(line=>line.startsWith('function closeDialog('));let cancelled=0,closed=0,removed=0;
 const sandbox={Event,dialog:{open:true,dispatchEvent(event){cancelled++;assert.equal(event.type,'cancel');assert.equal(event.cancelable,true);return false;},close(){closed++;},removeAttribute(){removed++;}}};
 runInNewContext(fn+';closeDialog(dialog);',sandbox);assert.equal(cancelled,1);assert.equal(closed,0);assert.equal(removed,0);
 sandbox.dialog.dispatchEvent=()=>true;runInNewContext('closeDialog(dialog);',sandbox);assert.equal(closed,1);assert.equal(removed,1);
});
