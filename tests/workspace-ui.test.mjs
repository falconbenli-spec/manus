import test from 'node:test';
import assert from 'node:assert/strict';
import { workspaceUI } from '../app/static/workspace-ui.mjs';
import { kit } from '../app/static/kit.mjs';

const e=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fixture={space:{id:'11111111-1111-4111-8111-111111111111',name:'مشروع الرحلة',target_kind:'project',target_id:'project-trip'},active_tool:'tasks',
  tasks:{can_create:true,lists:[{id:'l1',title:'قيد العمل',kind:'active',tasks:[{id:'t1',title:'تجهيز العرض',accountable_id:'employee',status:'open',priority:'high',due_on:'2099-10-10',version:1,acceptance:'عرض مراجع',actions:['complete']}]},{id:'l2',title:'مكتمل',kind:'complete',tasks:[]}],tasks:[]},
  files:{folders:[],documents:[],files:[]},topics:{topics:[]},chat:{items:[]},events:{events:[]},checkins:{checkins:[]},people:{people:[{user_id:'employee',name:'موظفة',role:'member'}]},activity:{items:[]},report:{counts:{tasks:1,topics:0,events:0,file_versions:0,activities:2},workload:{label:'عدد المهام المفتوحة',by_accountable:[]}}};

const ui=kit(e);
test('workspace navigation contains every contracted tool without rendering all panels together',()=>{
  const html=workspaceUI.render(fixture,{e,date:value=>value,ui});
  for(const label of ['المهام','البطاقات','الرسائل','المحادثة','الجدول','الملفات','الأسئلة الدورية','الأشخاص','البحث والتقارير'])assert.match(html,new RegExp(label));
  assert.equal((html.match(/data-tool-panel/g)||[]).length,1);assert.doesNotMatch(html,/style=|<script|undefined|NaN/);
  assert.match(html,/aria-current="page"/);assert.match(html,/data-workspace-form="project-task-create"/);assert.match(html,/name="to_list_id" value="l2"/);
});

test('workspace form contracts point to governed API routes and require idempotency for creates',()=>{
  const task=workspaceUI.form('task-create','',{spaceId:fixture.space.id});assert.equal(task.endpoint,`/spaces/${fixture.space.id}/tasks`);assert.equal(task.idempotent,true);
  assert.deepEqual(task.toPayload({list_id:'l1',title:'تجهيز العرض',accountable_id:'employee',due_on:'2099-10-10',acceptance:'عرض مراجع'}),{list_id:'l1',title:'تجهيز العرض',accountable_id:'employee',due_on:'2099-10-10',acceptance:'عرض مراجع',priority:'normal',contributors:[]});
  const projectTask=workspaceUI.form('project-task-create','project-trip',{spaceId:fixture.space.id});assert.equal(projectTask.endpoint,'/projects/project-trip/tasks');assert.equal(projectTask.idempotent,true);
  assert.throws(()=>workspaceUI.form('approve-chat','x',{spaceId:fixture.space.id}),/غير متاح/);
});
