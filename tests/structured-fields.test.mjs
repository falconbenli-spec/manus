import test from 'node:test';
import assert from 'node:assert/strict';
import { openDb, transaction } from '../app/db.mjs';
import { seed } from '../scripts/seed.mjs';
import { operationFields, collectStructured } from '../app/static/operations.mjs';
import { campaignsUI, scopeUI } from '../app/static/campaigns-ui.mjs';
import { performanceUI } from '../app/static/talent-ui.mjs';
import { createClient } from '../app/agency.mjs';
import { campaignsBoard, createCampaign, scopeBoard, createBaseline } from '../app/campaigns.mjs';
import { performanceBoard, createCycle } from '../app/talent.mjs';

const e=value=>String(value??'').replace(/[&<>"']/g,c=>`&#${c.charCodeAt(0)};`);
// نموذج وهمي يكفي لما يقرؤه collectStructured: صفوف بخلايا data-col، وخانات اختيار محددة.
const fakeForm=({rows={},checks={}})=>({querySelector(selector){
  const row=selector.match(/^\[data-rows="(.+)"\]$/),check=selector.match(/^\[data-checks="(.+)"\]$/);
  if(row)return {querySelectorAll:()=>(rows[row[1]]??[]).map(cells=>({querySelector:s=>{const col=s.match(/data-col="(.+)"/)[1];return col in cells?{value:cells[col]}:null;}}))};
  if(check)return {querySelectorAll:()=>(checks[check[1]]??[]).map(value=>({value}))};
  return null;
}});

test('structured fields: rows render as a table with an add button and a template, cells carry no name, and values are collected as typed arrays',()=>{
  const fields=[{name:'targets',label:'المؤشرات',type:'rows',columns:[{name:'metric',label:'المؤشر'},{name:'target',label:'المستهدف',type:'number',min:1}],value:[{metric:'طلبات',target:400}]},{name:'channels',label:'القنوات',type:'checks',options:[{value:'instagram',label:'إنستغرام'},{value:'x',label:'إكس'}],value:['x']}];
  const html=operationFields(fields,e);
  assert.match(html,/data-rows="targets"/);assert.match(html,/data-action="row-add"/);assert.match(html,/<template><tr data-row>/);assert.match(html,/value="400"/);
  assert.doesNotMatch(html,/name="metric"|name="target"/,'cells stay out of FormData');
  assert.match(html,/value="x" checked/);assert.doesNotMatch(html,/value="instagram" checked/);assert.doesNotMatch(html,/style=/);
  const values=collectStructured(fakeForm({rows:{targets:[{metric:' طلبات ',target:'400'},{metric:'',target:''},{metric:'نقرات',target:'20000'}]},checks:{channels:['instagram','x']}}),fields,{});
  assert.deepEqual(values,{targets:[{metric:'طلبات',target:400},{metric:'نقرات',target:20000}],channels:['instagram','x']},'blank rows are dropped and numbers are numbers');
  assert.throws(()=>collectStructured(fakeForm({rows:{targets:[]},checks:{channels:['x']}}),fields,{}),/أضف 1 صفًا/);
  assert.throws(()=>collectStructured(fakeForm({rows:{targets:[{metric:'a',target:'1'}]},checks:{channels:[]}}),fields,{}),/اختر واحدًا/);
});

test('structured fields: what the campaign, scope and review-cycle forms produce is accepted by the backend as is',t=>{
  const db=openDb(':memory:');seed(db,'synthetic-structured');t.after(()=>db.close());
  const users=Object.fromEntries(db.prepare('SELECT * FROM users').all().map(u=>[u.id,u])),tx=f=>transaction(db,f);
  const clientId=tx(()=>createClient(db,users.manager,{legal_name:'شركة العميل أ المصطنعة',trade_name:'العميل أ',sector:'تجزئة',status:'active'})).id;
  const campaign=campaignsUI.form('create_campaign','',campaignsBoard(db,users.manager));
  assert.equal(campaign.fields.find(f=>f.name==='channels').type,'checks');assert.equal(campaign.fields.find(f=>f.name==='targets').type,'rows');
  tx(()=>createCampaign(db,users.manager,campaign.toPayload({client_id:clientId,name:'حملة نموذج مصطنعة',objective:'زيادة طلبات المتجر خلال الموسم',channels:['instagram','google_ads'],targets:[{metric:'طلبات',target:400,unit:'طلب'}],media_budget:'0',budget_reference:'',start_date:'2026-10-01',end_date:'2026-10-31'})));
  assert.deepEqual(campaignsBoard(db,users.manager).campaigns[0].targets.map(x=>[x.metric,x.target,x.unit]),[['طلبات',400,'طلب']]);
  const baseline=scopeUI.form('create_baseline','',scopeBoard(db,users.manager));
  tx(()=>createBaseline(db,users.manager,baseline.toPayload({client_id:clientId,name:'هوية مصطنعة',contract_reference:'عرض سعر مصطنع 12',lines:[{name:'شعار',quantity:1,revisions:2}],exclusions:''})));
  assert.equal(scopeBoard(db,users.manager).baselines[0].lines[0].revisions,2);
  const cycle=performanceUI.form('create_cycle','',performanceBoard(db,users.hr));
  assert.equal(cycle.fields.find(f=>f.name==='criteria').value.reduce((n,c)=>n+c.weight,0),100,'the suggested criteria already total 100');
  tx(()=>createCycle(db,users.hr,cycle.toPayload({name:'دورة نموذج مصطنعة',period_from:'2026-01-01',period_to:'2026-12-31',scale_max:'5',criteria:[{name:'جودة التسليم',weight:60},{name:'التعاون',weight:40}]})));
  assert.equal(performanceBoard(db,users.hr).cycles[0].criteria.length,2);
});
