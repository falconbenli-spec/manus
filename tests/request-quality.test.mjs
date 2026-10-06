import test from 'node:test';
import assert from 'node:assert/strict';
import { openDb, transaction, verifyAudit } from '../app/db.mjs';
import { seed } from '../scripts/seed.mjs';
import * as wf from '../app/workflow.mjs';
import { validatePayload, fieldVisible } from '../app/validation.mjs';
import { installServiceCatalog, catalogServices, fieldModel, enrichFields, coreField, FIELD_GUIDANCE_KEYS, FIELD_RULE_KEYS } from '../app/service-catalog.mjs';
import { catalogQualityBoard, reportFieldGap } from '../app/catalog-quality.mjs';
import { catalogQualityUI } from '../app/static/catalog-quality-ui.mjs';

const code=value=>error=>error.code===value;
const e=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function fixture(t){
  const db=openDb(':memory:');seed(db,'synthetic-request-quality');t.after(()=>db.close());
  installServiceCatalog(db);
  const users=Object.fromEntries(db.prepare('SELECT * FROM users').all().map(u=>[u.id,u])),tx=f=>transaction(db,f);
  const service=code=>wf.catalog(db,users.employee).find(s=>s.code===code);
  const access={system:'نظام إدارة الحملات — تجريبي',action:'منح',access_level:'قراءة فقط',duration:'دائمة ضمن مهام وظيفتي',justification:'متابعة تقارير حملة عميل تجريبي'};
  const returned=()=>{
    let r=tx(()=>wf.createRequest(db,users.employee,{service_id:service('IT-ACCESS').id,title:'صلاحية تجريبية',payload:access}));
    r=tx(()=>wf.transition(db,users.employee,r.id,'submit',{version:r.version}));
    return tx(()=>wf.transition(db,users.manager,r.id,'return',{version:r.version,note:'المبرر لا يذكر أي عميل'}));
  };
  return {db,users,tx,service,access,returned};
}

test('legacy fields without guidance keys validate exactly as before',()=>{
  const fields=[{key:'a',label:'أ',type:'text',required:true},{key:'d',label:'د',type:'date',required:false},{key:'n',label:'ن',type:'number',required:true},{key:'s',label:'س',type:'select',options:['x','y'],required:true}];
  assert.deepEqual(validatePayload(fields,{a:'  قيمة  ',n:'12.5',s:'x'},true),{a:'قيمة',n:'12.5',s:'x'});
  assert.throws(()=>validatePayload(fields,{n:'1',s:'x'},true),code('missing_field'));
  assert.deepEqual(validatePayload(fields,{},false),{},'a draft may stay incomplete');
  assert.throws(()=>validatePayload(fields,{a:'x',n:'1',s:'z'},true),code('invalid_option'));
  assert.throws(()=>validatePayload(fields,{a:'x',n:'1',s:'x',extra:'1'},true),code('invalid_fields'));
  assert.throws(()=>validatePayload(fields,{a:'x'.repeat(3001),n:'1',s:'x'},true),code('invalid_text'),'the old 3000-character ceiling still applies');
});

// مسح الكتالوج 20 سبتمبر (العطبان 2 و3): كان هذا الاختبار يمضي على «نموذج الملف» (fieldModel) لا على نسخة
// الخدمة المخزَّنة، وهي وحدها ما يقرؤه validatePayload — فكان يثبت أن القاعدة صحيحة حيث لا تُقرأ، بينما
// الطلب الحقيقي يُقبل ناقصًا. صار يمضي على المخزَّن، وهو ما يُفرض فعلًا على الخادم.
test('a conditional field is neither required nor stored while hidden, and is enforced once its condition holds',t=>{
  const {service}=fixture(t);
  const fields=service('HR-ATTENDANCE-FIX').fields;
  assert.deepEqual(fields,fieldModel('HR-ATTENDANCE-FIX').map(coreField),'the stored version carries every rule the catalog declares');
  const base={kind:'عمل عن بعد',date:'2026-10-01',reason:'عمل من المنزل بإذن المدير'};
  assert.deepEqual(validatePayload(fields,base,true),base,'remote work needs no times');
  const stale=validatePayload(fields,{...base,from_time:'09:00'},true);
  assert.equal(stale.from_time,undefined,'a value left over for a hidden field never enters the record');
  const forgot={...base,kind:'نسيان بصمة'};
  assert.throws(()=>validatePayload(fields,forgot,true),code('missing_field'),'shown and required means required');
  assert.deepEqual(validatePayload(fields,forgot,false),forgot,'a draft may still be saved incomplete');
  assert.throws(()=>validatePayload(fields,{...forgot,from_time:'9 صباحًا',to_time:'10:00'},true),error=>error.code==='invalid_format'&&/مثل 09:30/.test(error.message),'the format error says what is right');
  assert.deepEqual(validatePayload(fields,{...forgot,from_time:'09:00',to_time:'10:00'},true),{...forgot,from_time:'09:00',to_time:'10:00'});
  assert.equal(fieldVisible({key:'x',show_when:{field:'missing',equals:['y']}},{},[{key:'x'}]),true,'a condition on an absent field hides nothing');
  const months=[{key:'m',label:'الشهر',type:'text',required:true,pattern:'^\\d{4}-(0[1-9]|1[0-2])$',pattern_message:'اكتب الشهر مثل 2026-03',min_length:7,max_length:7}];
  assert.throws(()=>validatePayload(months,{m:'2026-13'},true),error=>error.code==='invalid_format'&&/2026-03/.test(error.message));
  assert.throws(()=>validatePayload(months,{m:'2026-031'},true),code('invalid_text'),'max_length is enforced');
  const short=[{key:'r',label:'السبب',type:'textarea',required:true,min_length:5}];
  assert.throws(()=>validatePayload(short,{r:'لا'},true),code('invalid_text'),'min_length is enforced');
});

test('the catalog explains every field, and every rule it declares is well formed',()=>{
  assert.equal(catalogServices.length,139,'no service was added or removed; codes are shared with the research register');
  for(const s of catalogServices){
    assert.ok(s.fields.length<=12,s.code);
    for(const f of s.fields){
      assert.ok(typeof f.why==='string'&&f.why.length>=10,`${s.code}.${f.key} says why it is asked`);
      assert.ok(Object.keys(f).every(k=>['key','label','type','required','options',...FIELD_GUIDANCE_KEYS].includes(k)),`${s.code}.${f.key}`);
      if(f.pattern){const re=new RegExp(f.pattern);assert.ok(f.pattern_message,`${s.code}.${f.key} explains its format`);if(f.example)assert.match(f.example,re,`${s.code}.${f.key}: the example obeys its own format`);}
      if(f.show_when){const c=s.fields.find(x=>x.key===f.show_when.field);assert.ok(c?.type==='select'&&f.show_when.equals.every(v=>c.options.includes(v)),`${s.code}.${f.key}: condition names real options`);}
    }
  }
  assert.ok(catalogServices.flatMap(s=>s.fields).filter(f=>f.show_when).length>=5);
  const access=fieldModel('IT-ACCESS');
  assert.ok(access.some(f=>f.key==='system_owner')&&access.some(f=>f.key==='duration'),'system access asks who owns the system and whether access is temporary');
  assert.ok(fieldModel('HR-ATTENDANCE-FIX').some(f=>f.key==='evidence'),'attendance correction asks for evidence');
  assert.ok(!fieldModel('HR-PROFILE-UPDATE').find(f=>f.key==='change_type').options.includes('الحساب البنكي'),'bank details have one path only');
});

test('stored service versions carry every enforced rule, and only presentation is overlaid on read',t=>{
  const {db,users,service}=fixture(t);
  const stored=service('IT-ACCESS');
  // القاعدة المفروضة تُخزَّن؛ الإرشاد (لماذا/تلميح/مثال) وحده يبقى خارج النسخة ويُدمج عند القراءة.
  assert.ok(stored.fields.every(f=>Object.keys(f).every(k=>['key','label','type','required','options',...FIELD_RULE_KEYS].includes(k))));
  assert.ok(stored.fields.every(f=>!f.why&&!f.hint&&!f.example),'presentation stays out of the stored version');
  const until=stored.fields.find(f=>f.key==='access_until');
  assert.equal(until.required,true,'a conditional field is stored required; its condition — not a false flag — is what hides it');
  assert.deepEqual(until.show_when,{field:'duration',equals:['مؤقتة لمشروع أو مهمة']},'and the condition travels with it, so the server enforces it');
  assert.deepEqual(stored.fields,fieldModel('IT-ACCESS').map(coreField));
  const enriched=enrichFields('IT-ACCESS',stored.fields);
  assert.ok(enriched.every(f=>f.why));assert.deepEqual(enriched.find(f=>f.key==='access_until').show_when,{field:'duration',equals:['مؤقتة لمشروع أو مهمة']});
  assert.deepEqual(enrichFields('HR-LETTER',service('HR-LETTER').fields),service('HR-LETTER').fields,'services outside the catalog pass through untouched');
  assert.deepEqual(installServiceCatalog(db),{departments:0,renamed:0,heads:0,routing:0,escalation:0,services:0,moved:0,revised:0,sections:0,targets:0,retired:0},'guidance never forces a new service version');
});

test('only the approver who returned the revision records which field caused it, once, and the record is immutable',t=>{
  const {db,users,tx,returned}=fixture(t);
  const r=returned();
  const report=(u,input)=>tx(()=>reportFieldGap(db,u,r.id,input));
  const input={field_key:'justification',reason:'insufficient_answer',note:'لم يذكر العميل ولا مدة الحاجة'};
  assert.throws(()=>report(users.employee,input),code('separation_of_duties'),'the requester does not grade their own request');
  assert.throws(()=>report(users.hr,input),code('not_found'),'someone outside the route cannot see the request');
  assert.throws(()=>report(users.external,input),code('not_found'),'another tenant cannot see the request');
  assert.throws(()=>report(users.manager,{...input,field_key:'no_such_field'}),code('field_key'));
  assert.throws(()=>report(users.manager,{...input,reason:'missing_field'}),code('field_key'),'a missing field is described, not picked');
  assert.throws(()=>report(users.manager,{...input,reason:'guess'}),code('reason'));
  assert.throws(()=>report(users.manager,{...input,extra:1}),code('invalid_fields'));
  assert.throws(()=>report(users.manager,{...input,note:'لا'}),code('invalid_text'));
  assert.throws(()=>reportFieldGap(db,users.manager,r.id,input),code('transaction_required'));
  report(users.manager,input);
  report(users.manager,{reason:'missing_field',field_key:'',note:'لا يوجد حقل لرقم مشروع العميل'});
  assert.throws(()=>report(users.manager,input),code('already_recorded'));
  const row=db.prepare('SELECT * FROM service_field_feedback WHERE field_key=?').get('justification');
  assert.equal(row.reported_by,'manager');assert.equal(row.service_code,'IT-ACCESS');assert.equal(row.revision,r.revision);
  assert.throws(()=>db.prepare("UPDATE service_field_feedback SET note='تعديل لاحق للسبب'").run(),/retained/);
  assert.throws(()=>db.prepare('DELETE FROM service_field_feedback').run(),/retained/);
  assert.throws(()=>db.prepare("INSERT INTO service_field_feedback(id,tenant_id,request_id,revision,service_code,service_version,field_key,reason,note,reported_by,created_at) VALUES('x','36t',?,?,'IT-ACCESS',1,'system','unclear_field','إدخال مباشر من صاحب الطلب','employee','2026-09-18')").run(r.id,r.revision),/returned this revision/,'the database refuses the requester too');
  assert.throws(()=>db.prepare("INSERT INTO service_field_feedback(id,tenant_id,request_id,revision,service_code,service_version,field_key,reason,note,reported_by,created_at) VALUES('y','36t',?,?,'IT-ACCESS',1,'system','unclear_field','إدخال مباشر ممن لم يعد الطلب','hr','2026-09-18')").run(r.id,r.revision),/returned this revision/);
  // بعد إعادة التقديم تصبح نسخة جديدة؛ سبب الإعادة يخص النسخة التي أُعيدت.
  const again=tx(()=>wf.transition(db,users.employee,r.id,'submit',{version:wf.getRequest(db,users.employee,r.id).version}));
  assert.throws(()=>tx(()=>reportFieldGap(db,users.manager,again.id,{...input,field_key:'system'})),code('not_returner'));
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM audit_events WHERE action='service.field_feedback_recorded'").get().n,2);
  assert.equal(verifyAudit(db),true);
});

test('the quality board ranks services by real use, names each gap, and is limited to the catalog manager and the tenant',t=>{
  const {db,users,tx,returned}=fixture(t);
  const r=returned();
  tx(()=>reportFieldGap(db,users.manager,r.id,{field_key:'justification',reason:'unclear_field',note:'المبرر لا يذكر المشروع'}));
  const board=catalogQualityBoard(db,users.admin);
  assert.equal(board.can_manage,true);
  assert.equal(board.services[0].code,'IT-ACCESS','the only service with requests comes first');
  assert.equal(board.services[0].requests,1);assert.equal(board.services[0].returned,1);assert.equal(board.services[0].field_feedback,1);
  assert.deepEqual(board.fields[0],{service_code:'IT-ACCESS',field_key:'justification',label:'المبرر',total:1,reasons:{unclear_field:1}});
  const letter=board.services.find(s=>s.code==='HR-LETTER');
  assert.ok(letter.gaps.some(g=>/خارج الكتالوج/.test(g))&&letter.gaps.some(g=>/بلا بطاقة/.test(g)),'a base service shows it has no guidance and no card');
  assert.ok(board.services.every(s=>s.gaps.some(g=>/بطاقة/.test(g))),'no card is published in a fresh install, and the board says so');
  assert.ok(!board.services.find(s=>s.code==='IT-ACCESS').gaps.some(g=>/سبب مكتوب/.test(g)));
  assert.equal(board.totals.services,wf.catalog(db,users.admin).length);
  const manager=catalogQualityBoard(db,users.manager);
  assert.equal(manager.can_manage,false);assert.deepEqual(manager.services,[]);
  assert.equal(manager.my_returns.length,1,'the returning approver sees the request waiting for its reason');
  assert.equal(catalogQualityBoard(db,users.employee).my_returns.length,0,'the requester has nothing to record');
  const external=catalogQualityBoard(db,users.external);
  assert.deepEqual(external.services,[]);assert.deepEqual(external.my_returns,[]);
  assert.equal(verifyAudit(db),true);
});

test('the interface escapes every value and only offers the action the board granted',t=>{
  const {db,users,tx,returned}=fixture(t);
  const r=returned();
  db.prepare("UPDATE requests SET title='<img src=x onerror=alert(1)>' WHERE id=?").run(r.id);
  const manager=catalogQualityBoard(db,users.manager);
  const html=catalogQualityUI.render(manager,{e,button:(a,id,label)=>`<button data-action="${e(a)}" data-id="${e(id)}">${e(label)}</button>`});
  assert.doesNotMatch(html,/<img/);assert.match(html,/&lt;img/);assert.doesNotMatch(html,/style=|<script/);
  const spec=catalogQualityUI.form('report_field_gap',r.id,manager);
  assert.equal(spec.endpoint,`/catalog-quality/requests/${r.id}/field-gap`);
  assert.deepEqual(spec.toPayload({reason:'missing_field',field_key:'system',note:'وصف الحقل الناقص'}),{reason:'missing_field',field_key:'',note:'وصف الحقل الناقص'});
  assert.throws(()=>catalogQualityUI.form('report_field_gap','other',manager),/غير متاح/);
  assert.throws(()=>catalogQualityUI.form('delete',r.id,manager),/غير متاح/);
  const admin=catalogQualityUI.render(catalogQualityBoard(db,users.admin),{e,button:()=>''});
  assert.match(admin,/IT-ACCESS/);assert.doesNotMatch(admin,/<img/);
});
