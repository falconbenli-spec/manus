import {workFrames,groupedNavigation,dashboardHero,departmentDirectory} from '../app/static/hr-design.mjs';
// م0 «السور»: app.mjs يقرأ القاموس والعدّة عند تحميله، والصندوق يحذف الاستيراد فيمررهما كما يمرر operationModules.
import { REQUEST_STATUS,ROLE_NAMES } from '../app/static/vocabulary.mjs';
import { kit } from '../app/static/kit.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { randomUUID } from 'node:crypto';
import { setImmediate } from 'node:timers/promises';

test('SEC-06: delayed form loads and completed operations preserve the newer open form',async()=>{
const nodes=new Map(),listeners={},calls=[];
let currentForm,releaseTeam,releaseOperation;
function node(id) {
  if(!nodes.has(id)) {
    const value={textContent:'',open:false,classList:{add(){},remove(){}},querySelectorAll(){return id==='#dialog'&&currentForm?[currentForm]:[];},
      querySelector(){return currentForm;},showModal(){this.open=true;},close(){this.open=false;},html:''};
    Object.defineProperty(value,'innerHTML',{get(){return this.html;},set(html){this.html=html;if(id==='#dialog')currentForm={id:html.match(/<form id="([^"]+)/)?.[1],dataset:{},values:{note:'ملاحظة مصطنعة'},querySelector(){return null;}};}});
    nodes.set(id,value);
  }
  return nodes.get(id);
}
const records=[{id:'A',version:1},{id:'B',version:2}];
const module={title:'اختبار',description:'اختبار',load:api=>api('/commercial'),render:()=>'<p>A / B</p>',form:(action,id)=>({title:`FORM-${id}`,endpoint:`/commercial/${id}/approve`,fields:[],toPayload:values=>({...values,version:records.find(r=>r.id===id).version})})};
const sandbox={console,URL,Intl,Date,Uint8Array,location:{hash:'#projects'},localStorage:{getItem(){return 'ar';},setItem(){}},crypto:{randomUUID},setTimeout(){},
  document:{querySelector:node,documentElement:{dataset:{}},addEventListener:(event,fn)=>listeners[event]=fn},window:{addEventListener(){}},
  FormData:class{constructor(form){this.values=form.values;}get(k){return this.values[k];}*[Symbol.iterator](){yield* Object.entries(this.values);}},
  workFrames,groupedNavigation,dashboardHero,departmentDirectory,REQUEST_STATUS,ROLE_NAMES,kit,brandLogo:'',mountScenes:()=>()=>{},operationModules:{commercial:module},operationFields:()=>'',money:String,
  fetch:async(path,options)=>{
    if(path==='/api/me')return {ok:true,json:async()=>({user:{id:'manager',name:'مدير مصطنع',role:'manager'},csrf:'synthetic-csrf'}),text:async()=>JSON.stringify(({user:{id:'manager',name:'مدير مصطنع',role:'manager'},csrf:'synthetic-csrf'}))};
    if(path==='/api/catalog'||path==='/api/projects')return {ok:true,json:async()=>[],text:async()=>JSON.stringify([])};
    if(path==='/api/commercial')return {ok:true,json:async()=>records,text:async()=>JSON.stringify(records)};
    if(path==='/api/team')return new Promise(resolve=>releaseTeam=()=>resolve({ok:true,json:async()=>[],text:async()=>JSON.stringify([])}));
    if(path==='/api/commercial/A/approve')return new Promise(resolve=>{calls.push({path,input:JSON.parse(options.body)});releaseOperation=()=>resolve({ok:true,json:async()=>({id:'A'}),text:async()=>JSON.stringify(({id:'A'}))});});
    throw Error(path);
  }};
const source=readFileSync(new URL('../app/static/app.mjs',import.meta.url),'utf8').replace(/^import .+;$/gm,'');
await runInNewContext('(async()=>{'+source+';globalThis.ui={render};})()',sandbox);
const click=dataset=>listeners.click({target:{closest:()=>({dataset})}});

const projectOpening=click({action:'new-project'});await setImmediate();
sandbox.location.hash='#commercial';await sandbox.ui.render();
await click({action:'operation',module:'commercial',operation:'approve',id:'B'});
assert.match(node('#dialog').innerHTML,/FORM-B/);
releaseTeam();await projectOpening;
assert.match(node('#dialog').innerHTML,/FORM-B/);

node('#dialog').close();
await click({action:'operation',module:'commercial',operation:'approve',id:'A'});
const submittedForm=currentForm;
const submitted=listeners.submit({target:submittedForm,preventDefault(){}});await setImmediate();
await click({action:'close'});
await click({action:'operation',module:'commercial',operation:'approve',id:'B'});
assert.match(node('#dialog').innerHTML,/FORM-B/);assert.equal(node('#dialog').open,true);
releaseOperation();await submitted;
assert.equal(calls[0].path,'/api/commercial/A/approve');
assert.equal(node('#dialog').open,true);assert.match(node('#dialog').innerHTML,/FORM-B/);
});
