import test from 'node:test';
import assert from 'node:assert/strict';
import { openDb, transaction, verifyAudit } from '../app/db.mjs';
import { seed } from '../scripts/seed.mjs';
import { createClient, clientAction, createRetainer, clientsBoard } from '../app/agency.mjs';
import { campaignsBoard, createCampaign, campaignAction, contentBoard, createContent, contentAction, scopeBoard, createBaseline, recordScope, decideScope, closeBaseline } from '../app/campaigns.mjs';
import { createProject } from '../app/projects.mjs';
import { approvedVersion } from './studio-fixture.mjs';

const code=value=>error=>error.code===value;
const today=()=>new Date(Date.now()+3*3600000).toISOString().slice(0,10);
const addDays=(date,n)=>new Date(Date.parse(date+'T00:00:00Z')+n*86400000).toISOString().slice(0,10);
function fixture(t){
  const db=openDb(':memory:');seed(db,'synthetic-campaigns');t.after(()=>db.close());
  db.exec("INSERT INTO users(id,tenant_id,department_id,username,name,password_hash,role,manager_id) VALUES('lead-b','36t','creative','lead-b','مديرة حساب أخرى','unused','manager',NULL)");
  const users=Object.fromEntries(db.prepare('SELECT * FROM users').all().map(u=>[u.id,u])),tx=f=>transaction(db,f);
  const clientId=tx(()=>createClient(db,users.manager,{legal_name:'شركة العميل أ المصطنعة',trade_name:'العميل أ',sector:'تجزئة',status:'active'})).id;
  tx(()=>clientAction(db,users.manager,clientId,'add_member',{user_id:'employee',role:'مصممة الحساب'}));
  return {db,users,tx,clientId};
}

test('campaign: launch needs a complete checklist and someone other than the owner; results and spend carry their source and are corrected, not edited; closing needs a learning note',t=>{
  const {db,users,tx,clientId}=fixture(t);
  const input={client_id:clientId,name:'حملة العودة للمدارس المصطنعة',objective:'زيادة مبيعات المتجر الإلكتروني خلال موسم العودة',channels:['instagram','google_ads'],targets:[{metric:'مشتريات',target:400,unit:'طلب'},{metric:'نقرات',target:20000,unit:'نقرة'}],media_budget:'10000.00',budget_reference:'بريد اعتماد العميل المصطنع',start_date:addDays(today(),-9),end_date:addDays(today(),10)};
  assert.throws(()=>tx(()=>createCampaign(db,users['lead-b'],input)),code('not_found'),'another account team cannot create on this client');
  assert.throws(()=>tx(()=>createCampaign(db,users.employee,{...input,budget_reference:''})),code('budget_reference'));
  const id=tx(()=>createCampaign(db,users.employee,input)).id,view=who=>campaignsBoard(db,users[who]).campaigns.find(c=>c.id===id);
  const act=(who,action,values={})=>tx(()=>campaignAction(db,users[who],id,action,{version:view(who).version,...values}));
  assert.equal(campaignsBoard(db,users['lead-b']).campaigns.length,0);
  assert.throws(()=>act('employee','request_launch'),code('checklist_incomplete'));
  assert.throws(()=>act('employee','result',{entry_date:today(),metric:'مشتريات',value:5,source:'لوحة المتجر المصطنعة'}),code('invalid_state'),'nothing is recorded before launch');
  for(const item of view('employee').checklist)act('employee','check',{key:item.key,evidence:'مرجع مصطنع لاكتمال البند'});
  act('employee','request_launch');
  assert.throws(()=>act('employee','approve_launch',{note:'صاحب الحملة يعتمد إطلاقها بنفسه'}),code('invalid_state'));
  act('manager','approve_launch',{note:'راجعت القياس والمواد وحدود الصرف'});
  assert.equal(view('employee').status,'live');
  assert.throws(()=>db.prepare("UPDATE campaigns SET media_budget_minor=1,version=version+1 WHERE id=?").run(id),/keeps its objective/);
  assert.throws(()=>act('employee','result',{entry_date:today(),metric:'مشاهدات',value:5,source:'لوحة المنصة المصطنعة'}),code('metric'));
  assert.throws(()=>act('employee','spend',{entry_date:today(),channel:'tiktok',amount:'100.00',source:'فاتورة مصطنعة'}),code('channel'));
  act('employee','result',{entry_date:today(),metric:'مشتريات',value:120,source:'لوحة المتجر المصطنعة'});
  act('employee','spend',{entry_date:today(),channel:'instagram',amount:'9000.00',source:'لوحة مدير الإعلانات المصطنعة'});
  let v1=view('employee');
  assert.equal(v1.targets[0].actual,120);assert.equal(v1.targets[0].attainment_bp,3000);assert.equal(v1.spent_minor,900000);assert.equal(v1.pacing,'ahead','90% of budget at half the time');
  const wrong=v1.entries.find(e=>e.kind==='spend');
  act('manager','correct',{entry_id:wrong.id,value:'4500.00',source:'الرقم السابق شمل ضريبة حملة أخرى'});
  v1=view('employee');assert.equal(v1.spent_minor,450000);assert.equal(v1.entries.filter(e=>e.superseded).length,1);assert.equal(v1.pacing,'on_track');
  assert.throws(()=>act('manager','correct',{entry_id:wrong.id,value:'1.00',source:'تصحيح ثانٍ للقيد نفسه المصحح سابقًا'}),code('not_found'));
  assert.throws(()=>db.prepare('UPDATE campaign_entries SET value=1').run(),/corrected by a new entry/);
  assert.throws(()=>act('employee','complete',{learning:'قصير'}),code('invalid_text'));
  act('employee','complete',{learning:'الفيديو القصير تفوق على الصور الثابتة في تكلفة الشراء؛ نبدأ الحملة القادمة به ونقلل ميزانية البحث.'});
  assert.deepEqual(view('employee').actions,[]);
  assert.ok(verifyAudit(db));
});

test('content calendar: internal review by someone else, client approval is an employee-recorded reference, and publishing draws the retainer once with overage needing its basis',t=>{
  const {db,users,tx,clientId}=fixture(t),month=today().slice(0,7);
  const retainerId=tx(()=>createRetainer(db,users.manager,{client_id:clientId,name:'محتوى شهري',period_month:month,allowances:[{type:'منشور',quantity:1}],contract_reference:'البند 4 من العقد المصطنع',carry_over_rule:'لا ترحيل؛ التجاوز بطلب تغيير مسعّر'})).id;
  const input={client_id:clientId,campaign_id:'',brand_id:'',channel:'instagram',format:'post',title:'منشور إطلاق المجموعة المصطنعة',brief:'إعلان المجموعة الجديدة برسالة العودة للمدارس',planned_date:today(),planned_time:'18:30',retainer_id:retainerId,deliverable_type:'منشور'};
  assert.throws(()=>tx(()=>createContent(db,users.employee,{...input,deliverable_type:'فيديو'})),code('deliverable_type'));
  const make=()=>tx(()=>createContent(db,users.employee,input)).id,item=(who,id)=>contentBoard(db,users[who],month).items.find(i=>i.id===id);
  const act=(who,id,action,values={})=>tx(()=>contentAction(db,users[who],id,action,{version:item(who,id).version,...values}));
  // البند يُقدَّم على نسخة مخرج اعتمدها الاستوديو (P4-SPEC-3، الترحيل 189): الأولى، ثم المعدّلة بعد إعادة المراجِع.
  const project=tx(()=>createProject(db,users.manager,{name:'مشروع تصاميم العميل أ المصطنع',brief:'نسخ معتمدة لتقويم المحتوى',member_ids:['employee','outsider']})).id;
  const [v1,v2]=['تصميم المجموعة المصطنع v1','تصميم المجموعة المصطنع v2'].map(title=>approvedVersion(db,users,{project,channel:'instagram',title}).version);
  const flow=id=>{act('employee',id,'start');act('employee',id,'submit',{output_version_id:v1});
    assert.throws(()=>act('employee',id,'pass',{note:'أراجع عملي بنفسي'}),code('invalid_state'));
    act('manager',id,'return',{note:'الشعار أصغر من الحد في دليل الهوية'});act('employee',id,'submit',{output_version_id:v2});act('manager',id,'pass',{note:'مطابق للدليل'});
    assert.throws(()=>act('employee',id,'publish',{published_reference:'https://example.invalid/p/1',overage_note:''}),code('invalid_state'),'not before the client approval');
    act('employee',id,'client_approve',{reference:'موافقة مديرة التسويق بالبريد، محفوظة في ملف العميل'});};
  const first=make();flow(first);
  assert.equal(item('employee',first).revision_count,1);
  act('employee',first,'publish',{published_reference:'https://example.invalid/p/1',overage_note:''});
  assert.equal(clientsBoard(db,users.manager).clients[0].retainers[0].allowances[0].used,1);
  assert.throws(()=>db.prepare("UPDATE content_items SET title='تعديل بعد النشر',version=version+1 WHERE id=?").run(first),/final/);
  const second=make();flow(second);
  assert.throws(()=>act('employee',second,'publish',{published_reference:'https://example.invalid/p/2',overage_note:''}),code('overage_requires_note'));
  assert.equal(item('employee',second).status,'approved','a refused overage publishes nothing');
  act('employee',second,'publish',{published_reference:'https://example.invalid/p/2',overage_note:'وافق العميل على منشور إضافي يُسعّر في فاتورة الشهر'});
  assert.equal(clientsBoard(db,users.manager).clients[0].retainers[0].allowances[0].over,true);
  assert.equal(contentBoard(db,users['lead-b'],month).items.length,0);
  assert.match(contentBoard(db,users.employee,month).note,/ليست توقيعًا/);
});

test('scope guard: deliveries and revision rounds are counted against the contract baseline, and anything beyond it waits for the account owner to absorb, price or decline',t=>{
  const {db,users,tx,clientId}=fixture(t);
  const input={client_id:clientId,name:'هوية بصرية مصطنعة',contract_reference:'عرض السعر المعتمد رقم 12',lines:[{name:'شعار',quantity:1,revisions:2},{name:'تصميم مطبوع',quantity:3,revisions:1}],exclusions:'التصوير والطباعة'};
  assert.throws(()=>tx(()=>createBaseline(db,users.employee,input)),code('forbidden'),'the baseline is set by the account owner');
  const id=tx(()=>createBaseline(db,users.manager,input)).id,view=who=>scopeBoard(db,users[who]).baselines.find(b=>b.id===id);
  const record=(values,who='employee')=>tx(()=>recordScope(db,users[who],id,{line_key:'l1',kind:'delivery',quantity:1,item_reference:'شعار v1',description:'',...values}));
  assert.equal(record({}).over_scope,false);
  assert.equal(record({kind:'revision'}).over_scope,false);assert.equal(record({kind:'revision'}).over_scope,false);
  const third=record({kind:'revision'});assert.equal(third.over_scope,true,'the third round on the same item is beyond the two in the contract');
  assert.equal(record({kind:'revision',item_reference:'شعار بديل'}).over_scope,false,'rounds are counted per item');
  const ask=record({kind:'new_ask',line_key:'',item_reference:'طلب العميل بالبريد',description:'يطلب العميل تصميم واجهة متجر لم ترد في العرض'});
  assert.equal(ask.over_scope,true);
  assert.throws(()=>record({line_key:'l9'}),code('line_key'));
  assert.equal(view('employee').open_decisions,2);assert.deepEqual(view('employee').events.find(e=>e.id===third.id).actions,[],'a team member records; the owner decides');
  assert.throws(()=>tx(()=>decideScope(db,users.employee,third.id,{disposition:'absorbed',note:'أقرر تحمله بنفسي دون مسؤول الحساب'})),code('forbidden'));
  assert.throws(()=>tx(()=>closeBaseline(db,users.manager,id,{version:view('manager').version,note:'إقفال قبل البت'})),code('open_decisions'));
  tx(()=>decideScope(db,users.manager,third.id,{disposition:'absorbed',note:'جولة إضافية واحدة حفاظًا على العلاقة؛ أُبلغ العميل أنها الأخيرة'}));
  tx(()=>decideScope(db,users.manager,ask.id,{disposition:'change_request',note:'طلب تغيير مسعّر أُرسل للعميل بمرجع CR-7'}));
  assert.throws(()=>tx(()=>decideScope(db,users.manager,ask.id,{disposition:'declined',note:'تغيير القرار بعد تسجيله غير مسموح'})),code('invalid_state'));
  const done=view('manager');assert.equal(done.absorbed,1);assert.equal(done.change_requests,1);assert.equal(done.lines[0].items_over_revisions,1);
  assert.throws(()=>db.prepare("UPDATE scope_baselines SET lines='[]',version=version+1 WHERE id=?").run(id),/replaced by a new baseline/);
  tx(()=>closeBaseline(db,users.manager,id,{version:done.version,note:'سُلّم المشروع'}));
  assert.throws(()=>record({}),code('invalid_state'));
  assert.equal(scopeBoard(db,users['lead-b']).baselines.length,0);
});
