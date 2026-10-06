import test from 'node:test';
import assert from 'node:assert/strict';
import { projectParticipationUI } from '../app/static/project-participation-ui.mjs';

const e=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const button=(action,id,label)=>`<button data-operation="${e(action)}" data-id="${e(id)}">${e(label)}</button>`;
const data={
  user_id:'manager',departments:[{id:'ops',name:'التشغيل'},{id:'hr',name:'الموارد البشرية'}],
  projects:[{id:'p1',name:'مشروع <اختبار>',manager:{id:'manager',name:'مدير المشروع',source:'created_by',available:true},actions:['request_participation'],available_departments:[{id:'ops',name:'التشغيل'}],requests:[{id:'old',department_id:'ops',department_name:'التشغيل',status:'returned',status_name:'معاد للتوضيح',basis:'نطاق سابق',requested_by_name:'مدير المشروع',requested_at:'2026-09-24T08:00:00.000Z',decided_by_name:'مدير التشغيل',decided_at:'2026-09-24T09:00:00.000Z',decision_note:'يلزم موعد واضح',actions:[]}],links:[{department_id:'hr',department_name:'الموارد البشرية',approved_by_name:'سجل سابق',approved_at:'2026-09-20T08:00:00.000Z',approval_source:'legacy_declared',source_note:'سجل سابق لا يثبت قرارًا إلكترونيًا'}]}],
  incoming:[{id:'pending',project_id:'p2',project_name:'مشروع العميل',department_id:'ops',department_name:'التشغيل',status:'pending',status_name:'بانتظار قرار الإدارة',basis:'مخرج تشغيل محدد',requested_by_name:'مديرة الحساب',requested_at:'2026-09-24T10:00:00.000Z',version:1,actions:['accept_participation','return_participation']}],
  note:'المشاركة لا تبدأ قبل قرار مدير الإدارة المستقبلة بحسابه.'
};

test('project participation UI shows the receiving decision, returned history and honest legacy provenance',()=>{
  const html=projectParticipationUI.render(data,{e,button});
  assert.match(html,/بانتظار قرار الإدارة/);
  assert.match(html,/data-operation="accept_participation"/);
  assert.match(html,/data-operation="return_participation"/);
  assert.match(html,/يلزم موعد واضح/);
  assert.match(html,/سجل سابق لا يثبت قرارًا إلكترونيًا/);
  assert.doesNotMatch(html,/<اختبار>/);
  assert.match(html,/مشروع &lt;اختبار&gt;/);
});

test('project participation UI builds guarded request and decision payloads',()=>{
  const request=projectParticipationUI.form('request_participation','p1',data);
  assert.equal(request.endpoint,'/projects/p1/departments');
  assert.equal(request.idempotent,true);
  assert.deepEqual(request.toPayload({department_id:'ops',basis:'نطاق واضح'}),{department_id:'ops',basis:'نطاق واضح'});
  assert.equal(request.fields.find(f=>f.name==='department_id').options.length,1);
  const accept=projectParticipationUI.form('accept_participation','pending',data);
  assert.equal(accept.endpoint,'/project-department-requests/pending/accept_participation');
  assert.deepEqual(accept.toPayload({note:'قبول واضح'}),{version:1,note:'قبول واضح'});
  const returned=projectParticipationUI.form('return_participation','pending',data);
  assert.equal(returned.endpoint,'/project-department-requests/pending/return_participation');
  assert.throws(()=>projectParticipationUI.form('accept_participation','old',data),/غير متاح/);
});
