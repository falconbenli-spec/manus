import { feedbackPanel } from '../app/static/service-quality-ui.mjs';
import { countNoun, countEn } from '../app/static/arabic-count.mjs';
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

test('SEC-01: reversed request responses cannot change the visible action or attachment target',async()=>{
  const service={id:'service',name_ar:'خدمة',name_en:'Service',fields:[],approval_policy:{steps:['manager']}};
  const record=id=>({id,title:'TITLE-'+id,service,payload:{},requester_name:'Synthetic',revision:1,version:3,status:'pending',created_at:'2026-09-10',actions:['approve','attach'],attachments:[],audit:[],versions:[],approvals:[]});
  const nodes=new Map(),listeners={},pending=new Map(),calls=[];
  const node=id=>{if(!nodes.has(id))nodes.set(id,{innerHTML:'',textContent:'',open:false,classList:{add(){},remove(){}},querySelectorAll(){return [];},showModal(){this.open=true;},close(){this.open=false;}});return nodes.get(id);};
  const sandbox={console,URL,Intl,Date,Uint8Array,location:{hash:'#home'},localStorage:{getItem(){return 'ar';},setItem(){}},crypto:{randomUUID},setTimeout(){},btoa:s=>Buffer.from(s,'binary').toString('base64'),
    document:{querySelector:node,documentElement:{dataset:{}},addEventListener:(event,fn)=>{listeners[event]=fn;}},window:{addEventListener(){}},
    FormData:class{constructor(form){this.values=form.values;}get(k){return this.values[k];}*[Symbol.iterator](){yield* Object.entries(this.values);}},
    fetch:async(path,options)=>{
      if(options.method!=='GET'){calls.push({path,input:JSON.parse(options.body)});return {ok:true,json:async()=>record('B'),text:async()=>JSON.stringify(record('B'))};}
      if(path==='/api/me')return {ok:true,json:async()=>({user:{id:'manager',name:'Synthetic',role:'manager'},csrf:'test'}),text:async()=>JSON.stringify(({user:{id:'manager',name:'Synthetic',role:'manager'},csrf:'test'}))};
      if(path==='/api/catalog')return {ok:true,json:async()=>[service],text:async()=>JSON.stringify([service])};
      if(path==='/api/overview')return {ok:true,json:async()=>({decisions:[],totals:{}}),text:async()=>JSON.stringify(({decisions:[],totals:{}}))};
      if(path==='/api/projects')return {ok:true,json:async()=>[],text:async()=>JSON.stringify([])};
      if(path==='/api/requests')return {ok:true,json:async()=>[],text:async()=>JSON.stringify([])};
      if(path==='/api/requests/A'||path==='/api/requests/B')return new Promise(resolve=>pending.set(path,()=>resolve({ok:true,json:async()=>record(path.at(-1)),text:async()=>JSON.stringify(record(path.at(-1)))})));
      throw Error(path);
    }};
  const source=readFileSync(new URL('../app/static/app.mjs',import.meta.url),'utf8').replace(/^import .+;$/gm,'');Object.assign(sandbox,{feedbackPanel,workFrames,groupedNavigation,dashboardHero,departmentDirectory,countNoun,countEn,REQUEST_STATUS,ROLE_NAMES,kit});sandbox.brandLogo='';sandbox.mountScenes=()=>()=>{};sandbox.operationModules={};sandbox.operationFields=()=>'';sandbox.money=String;
  await runInNewContext('(async()=>{'+source+';globalThis.ui={render,getDetail:()=>requestDetail,setDetail:r=>requestDetail=r};})()',sandbox);
  sandbox.location.hash='#request/A';const first=sandbox.ui.render();await setImmediate();
  sandbox.location.hash='#request/B';const second=sandbox.ui.render();await setImmediate();
  pending.get('/api/requests/B')();await second;
  pending.get('/api/requests/A')();await first;
  assert.match(node('#main').innerHTML,/TITLE-B/);assert.equal(sandbox.ui.getDetail().id,'B');
  await listeners.click({target:{closest:()=>({dataset:{action:'transition',transition:'approve'}})}});
  assert.match(node('#dialog').innerHTML,/data-id="B" data-version="3"/);
  const form={id:'transition-form',dataset:{id:'B',version:'3',transition:'approve'},values:{note:'tested'},querySelector(){return null;}};
  sandbox.ui.setDetail(record('A'));sandbox.location.hash='#requests';
  await listeners.submit({target:form,preventDefault(){}});
  assert.equal(calls[0].path,'/api/requests/B/approve');assert.equal(calls[0].input.version,3);
  sandbox.ui.setDetail(record('B'));
  await listeners.click({target:{closest:()=>({dataset:{action:'attach'}})}});
  assert.match(node('#dialog').innerHTML,/data-id="B" data-version="3"/);
  sandbox.ui.setDetail(record('A'));
  const file={size:4,name:'test.txt',arrayBuffer:async()=>new Uint8Array([116,101,115,116]).buffer};
  await listeners.submit({target:{...form,id:'attachment-form',values:{file}},preventDefault(){}});
  assert.equal(calls[1].path,'/api/requests/B/attachments');assert.equal(calls[1].input.version,3);
});
