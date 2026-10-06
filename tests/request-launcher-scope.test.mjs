import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
const source=readFileSync(new URL('../app/static/app.mjs',import.meta.url),'utf8');
function fixture(open){
 const background={innerHTML:'خلفية',closest:()=>true},foreground={innerHTML:'حوار',closest:()=>null},events={};
 const bgSearch={focus(){this.focused=true;}},fgSearch={focus(){this.focused=true;}};
 const document={querySelector:selector=>selector==='#launcher-dynamic'?background:bgSearch,addEventListener:(name,fn)=>events[name]=fn};
 const dialog={open,querySelector:selector=>selector==='#launcher-dynamic'?foreground:selector==='#launcher-search'?fgSearch:null};
 const sandbox={document,dialog,launcherDepartments:[],services:[],me:{role:'employee'},launcherState:{selected:'',query:''},e:String,variantGroups:[],launcherResults:({query})=>'نتائج:'+query,paintMotion(){}};
 const paint=source.slice(source.indexOf('function paintLauncher'),source.indexOf('function paintBars'));
 const helper=source.includes('function launcherRoot')?source.slice(source.indexOf('function launcherRoot'),source.indexOf('function paintLauncher')):'';
 const input=source.slice(source.indexOf("document.addEventListener('input',ev=>"),source.indexOf("document.addEventListener('submit',async ev=>"));
 const key=source.slice(source.indexOf("document.addEventListener('keydown',ev=>"),source.indexOf("document.addEventListener('input',ev=>"));
 runInNewContext(helper+paint+input+key,sandbox);
 return {events,foreground,background,fgSearch,bgSearch};
}
test('البحث داخل درج الطلب يغير نتائجه وحدها ولو بقي الدليل خلفه',()=>{const f=fixture(true);f.events.input({target:{id:'launcher-search',value:'المؤهل',dataset:{}}});assert.equal(f.foreground.innerHTML,'نتائج:المؤهل');assert.equal(f.background.innerHTML,'خلفية');});
test('البحث في الصفحة يعمل عند إغلاق الدرج',()=>{const f=fixture(false);f.events.input({target:{id:'launcher-search',value:'إجازة',dataset:{}}});assert.equal(f.background.innerHTML,'نتائج:إجازة');assert.equal(f.foreground.innerHTML,'حوار');});
test('اختصار البحث يركز الدرج المفتوح دون حقل الخلفية',()=>{const f=fixture(true);f.events.keydown({key:'/',target:{tagName:'DIV'},preventDefault(){}});assert.equal(f.fgSearch.focused,true);assert.equal(f.bgSearch.focused,undefined);});
