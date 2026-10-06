import test from 'node:test';
import assert from 'node:assert/strict';
import { openDb, transaction, verifyAudit } from '../app/db.mjs';
import { seed } from '../scripts/seed.mjs';
import { grantAccess } from '../app/access.mjs';
import { createClient, clientAction } from '../app/agency.mjs';
// منذ الترحيل 182: الصفقة من ملف عميل، والعرض على عرض سعر العميل المقبول، والقبول يسمّي ممثل العميل المفوّض.
import { proposalFor } from './proposal-fixture.mjs';
import { createLead, commercialAction } from '../app/commercial.mjs';
import { createBaseline, recordScope } from '../app/campaigns.mjs';
import { estimatesBoard, preparePriceCard, priceCardAction, saveEstimate, estimateAction, commercialPayload, computeMatrix } from '../app/estimates.mjs';

// بيانات تجريبية مصطنعة بالكامل. معدل التكلفة يُمرَّر من خارج الوحدة كما يصله المنسّق بوحدة الربحية.
const code=value=>error=>error.code===value;
const riyadh=(offset=0)=>new Date(Date.now()+3*3600000+offset*86400000).toISOString().slice(0,10);
const costRate=({category_code})=>({DES:{rate_minor:10000,source:'معدل فئة المصممين المعتمد (تجريبي)'},PM:{rate_minor:15000,source:'معدل فئة إدارة المشاريع المعتمد (تجريبي)'}})[category_code]??null;
function fixture(t){
  const db=openDb(':memory:');seed(db,'synthetic-pipeline-estimates');t.after(()=>db.close());
  const users=Object.fromEntries(db.prepare('SELECT * FROM users').all().map(u=>[u.id,u])),tx=f=>transaction(db,f);
  tx(()=>{for(const [user,capability] of [['employee','commercial.use'],['employee','clients.manage'],['manager','commercial.use'],['outsider','commercial.use']])grantAccess(db,users.admin,{user_id:user,capability,department_id:capability==='commercial.use'?'creative':'',note:'منح تجريبي'});});
  const client=tx(()=>createClient(db,users.employee,{legal_name:'شركة تجريبية للتجزئة',sector:'التجزئة',status:'prospect'})).id;
  tx(()=>clientAction(db,users.employee,client,'add_member',{user_id:'manager',role:'مدير الفريق التجريبي'}));
  const version=id=>db.prepare('SELECT version FROM estimates WHERE id=?').get(id).version;
  const act=(by,id,action,input={},options)=>tx(()=>estimateAction(db,by,id,action,{version:version(id),...input},options));
  const card=(by,input)=>tx(()=>preparePriceCard(db,by,{client_id:'',name:'قائمة أسعار تجريبية',effective_from:riyadh(),source:'قرار تسعير تجريبي للاختبار',...input})).id;
  const decideCard=(id,by=users.manager,action='approve_card')=>tx(()=>priceCardAction(db,by,id,action,{version:db.prepare('SELECT version FROM price_cards WHERE id=?').get(id).version,note:'اعتماد تجريبي'}));
  const estimate=(input,options)=>tx(()=>saveEstimate(db,users.employee,{client_id:client,name:'تقدير تجريبي',scope_note:'نطاق تجريبي لهوية وحملة إطلاق',...input},options)).id;
  return {db,users,tx,client,act,card,decideCard,estimate,version};
}
const lines=[{role_name:'مصمم',deliverable:'هوية الحملة',hours:'10'},{role_name:'مدير مشروع',deliverable:'هوية الحملة',hours:'4'},{role_name:'مصمم',deliverable:'منشورات الإطلاق',hours:'6.5'}];
const roles=[{kind:'role',name:'مصمم',category_code:'DES',price:'300.00'},{kind:'role',name:'مدير مشروع',category_code:'PM',price:'400.00'}];

test('price cards: no default price exists, cards are dated and approved by someone else, and a client card replaces the general list',t=>{
  const {db,users,client,card,decideCard,estimate}=fixture(t);
  const empty=estimatesBoard(db,users.employee);
  assert.equal(empty.price_cards.length,0,'cards start empty');assert.equal(empty.clients[0].live_card,null);
  assert.throws(()=>estimate({lines}),code('no_price'),'no price card and no typed price means no price');
  const general=card(users.employee,{lines:roles});
  assert.throws(()=>decideCard(general,users.employee),code('self_approval'));
  assert.throws(()=>estimate({lines}),code('no_price'),'an unapproved card prices nothing');
  decideCard(general);
  assert.throws(()=>db.prepare("UPDATE price_cards SET lines='[]',version=version+1 WHERE id=?").run(general),/decided once/);
  assert.throws(()=>card(users.employee,{lines:roles}),code('duplicate_card'),'a new price is a card with a new effective date');
  const own=card(users.employee,{client_id:client,name:'بطاقة عميل تجريبية',lines:[{kind:'role',name:'مصمم',category_code:'DES',price:'250.00'}]});decideCard(own);
  assert.equal(estimatesBoard(db,users.employee).clients[0].live_card.own,true);
  // بطاقة العميل تحل محل العامة كاملة: دور ليس فيها لا يرث سعر القائمة العامة.
  assert.throws(()=>estimate({lines}),error=>error.code==='no_price'&&/مدير مشروع/.test(error.message));
  const id=estimate({lines:[lines[0],{...lines[1],sell_rate:'380.00'}]});
  const view=estimatesBoard(db,users.employee).estimates.find(x=>x.id===id);
  assert.deepEqual(view.lines.map(l=>[l.sell_rate_minor,l.sell_rate_origin]),[[25000,'price_card'],[38000,'manual']]);
  assert.ok(verifyAudit(db));
});

test('estimate matrix: without a cost source the margin is declared unavailable, never computed on zero cost',t=>{
  const {db,users,act,estimate}=fixture(t);
  const id=estimate({lines:lines.map(l=>({...l,sell_rate:'300.00'}))});
  const board=estimatesBoard(db,users.employee),view=board.estimates.find(x=>x.id===id);
  assert.equal(board.cost_source_connected,false);assert.match(board.cost_notice,/الهامش غير محسوب لأن التكلفة غير متاحة/);
  assert.equal(view.total.sell_minor,615000,'20.5 hours × 300.00');
  assert.equal(view.total.cost_minor,null);assert.equal(view.total.margin_minor,null);assert.equal(view.total.margin_bp,null);
  assert.ok(view.lines.every(l=>l.cost_minor===null&&l.margin_bp===null),'no line shows a 100% margin');
  assert.equal(view.margin_available,false);assert.match(view.margin_notice,/3 من 3/);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM estimate_lines WHERE cost_rate_minor IS NOT NULL').get().n,0);
  act(users.employee,id,'submit');
  assert.throws(()=>act(users.manager,id,'approve',{note:'اعتماد'}),code('margin_unknown'),'approving an estimate with unknown margin needs an explicit acknowledgement');
  act(users.manager,id,'approve',{note:'اعتماد مع العلم بغياب التكلفة',accept_unknown_margin:true});
  assert.throws(()=>commercialPayload(db,users.employee,id,{valid_until:riyadh(5),tax_rate:'15',acceptance:'موافقة العميل',revisions:2}),code('cost_unavailable'),'an uncosted estimate is not handed to a margin-approved quote');
  assert.equal(computeMatrix([{role_name:'دور',deliverable:'مخرج',hours_centi:100,sell_rate_minor:100,cost_rate_minor:undefined}]).total.margin_bp,null,'a missing rate is not read as zero');
  assert.ok(verifyAudit(db));
});

test('estimate matrix: with an external cost rate the margin shows line by line and in total, and a partly costed matrix has no total margin',t=>{
  const {db,users,card,decideCard,estimate}=fixture(t);
  decideCard(card(users.employee,{lines:roles}));
  const partial=estimate({lines:[...lines,{role_name:'كاتب محتوى',deliverable:'منشورات الإطلاق',hours:'3',sell_rate:'200.00'}]},{costRate});
  const view=estimatesBoard(db,users.employee,{costRate}).estimates.find(x=>x.id===partial);
  const designer=view.lines.find(l=>l.role_name==='مصمم'&&l.deliverable==='هوية الحملة');
  assert.deepEqual([designer.sell_minor,designer.cost_minor,designer.margin_minor,designer.margin_bp],[300000,100000,200000,6667]);
  assert.equal(view.lines.find(l=>l.role_name==='كاتب محتوى').cost_minor,null);
  assert.equal(view.total.margin_minor,null,'one uncosted line removes the total margin');
  const full=estimate({lines},{costRate}),costed=estimatesBoard(db,users.employee,{costRate}).estimates.find(x=>x.id===full);
  // 10×300 + 4×400 + 6.5×300 = 6550.00 ؛ التكلفة 10×100 + 4×150 + 6.5×100 = 2250.00
  assert.deepEqual([costed.total.sell_minor,costed.total.cost_minor,costed.total.margin_minor,costed.total.margin_bp],[655000,225000,430000,6565]);
  assert.deepEqual(costed.deliverables.map(d=>[d.name,d.margin_minor]),[['هوية الحملة',300000],['منشورات الإطلاق',130000]]);
  assert.equal(costed.lines[0].cost_rate_source,'معدل فئة المصممين المعتمد (تجريبي)','each cost carries its source');
  assert.throws(()=>estimate({lines},{costRate:()=>({rate_minor:0,source:'صفر'})}),code('cost_rate_resolver'),'a resolver returning zero is a wiring fault, not a cost');
  assert.ok(verifyAudit(db));
});

test('estimates: the preparer cannot approve, a decided estimate is final, versions are checked, and isolation holds',t=>{
  const {db,users,tx,client,act,card,decideCard,estimate,version}=fixture(t);
  decideCard(card(users.employee,{lines:roles}));
  const id=estimate({lines},{costRate});
  assert.throws(()=>tx(()=>estimateAction(db,users.employee,id,'submit',{version:version(id)+1})),code('stale_version'));
  act(users.employee,id,'submit');
  assert.throws(()=>act(users.employee,id,'approve',{note:'أعتمد عملي'}),code('self_approval'));
  assert.throws(()=>db.prepare("UPDATE estimates SET status='approved',decided_by=prepared_by,decided_at='x',version=version+1 WHERE id=?").run(id),/CHECK constraint/);
  assert.throws(()=>act(users.outsider,id,'approve',{note:'خارج فريق الحساب'}),code('not_found'));
  assert.ok(estimatesBoard(db,users.manager).awaiting_me.some(a=>a.id===id));
  act(users.manager,id,'approve',{note:'الهامش مقبول'});
  assert.throws(()=>act(users.employee,id,'edit',{name:'تعديل',scope_note:'تعديل بعد الاعتماد',change_reason:'',lines}),code('action_unavailable'));
  assert.throws(()=>db.prepare("UPDATE estimates SET name='تعديل صامت',version=version+1 WHERE id=?").run(id),/decided estimate is final/);
  assert.throws(()=>db.prepare("INSERT INTO estimate_lines(id,estimate_id,line_no,role_name,deliverable,hours_centi,sell_rate_minor,sell_rate_origin,created_at) VALUES('z',?,9,'دور','مخرج',100,100,'manual','t')").run(id),/only while the estimate is a draft/);
  assert.throws(()=>estimatesBoard(db,users.hr),error=>['forbidden','not_permitted'].includes(error.code));
  assert.equal(estimatesBoard(db,users.outsider).estimates.length,0);
  assert.throws(()=>tx(()=>saveEstimate(db,users.external,{client_id:client,name:'تسرب',scope_note:'محاولة من كيان آخر',lines})),error=>['forbidden','not_permitted','not_found'].includes(error.code));
  assert.ok(verifyAudit(db));
});

test('change orders: a separate estimate on an approved one shows what changed and by how much, and a scope-guard alert becomes a change order',t=>{
  const {db,users,client,act,card,decideCard,estimate}=fixture(t);
  decideCard(card(users.employee,{lines:roles}));
  const parent=estimate({lines},{costRate});
  assert.throws(()=>estimate({parent_estimate_id:parent,change_reason:'إضافة منشورات بطلب العميل',lines},{costRate}),code('parent_not_approved'));
  act(users.employee,parent,'submit');act(users.manager,parent,'approve',{note:'اعتماد'});
  const baseline=transaction(db,()=>createBaseline(db,users.employee,{client_id:client,name:'خط أساس تجريبي',contract_reference:'عرض تجريبي معتمد',lines:[{name:'منشورات الإطلاق',quantity:6,revisions:2}],exclusions:''})).id;
  const alert=transaction(db,()=>recordScope(db,users.manager,baseline,{line_key:'',kind:'new_ask',quantity:1,item_reference:'طلب-تجريبي-1',description:'العميل طلب فيديو قصيرًا غير مذكور في العقد'})).id;
  assert.deepEqual(estimatesBoard(db,users.employee).scope_candidates.map(c=>[c.id,c.parents.map(p=>p.id)]),[[alert,[parent]]]);
  const change=estimate({parent_estimate_id:parent,scope_event_id:alert,change_reason:'فيديو قصير إضافي خارج النطاق المتفق عليه',lines:[...lines.slice(0,2),{...lines[2],hours:'8'},{role_name:'مصمم',deliverable:'فيديو قصير',hours:'5'}]},{costRate});
  const view=estimatesBoard(db,users.employee).estimates.find(x=>x.id===change);
  assert.equal(view.kind,'change_order');assert.equal(view.parent.id,parent);
  assert.deepEqual(view.change.changes.map(c=>[c.type,c.deliverable,c.hours_delta_centi,c.sell_delta_minor]),[['changed','منشورات الإطلاق',150,45000],['added','فيديو قصير',500,150000]]);
  assert.deepEqual([view.change.sell_delta_minor,view.change.cost_delta_minor,view.change.margin_delta_minor],[195000,65000,130000]);
  assert.equal(estimatesBoard(db,users.employee).scope_candidates.length,0,'the alert now has its change order');
  assert.throws(()=>estimate({parent_estimate_id:parent,scope_event_id:alert,change_reason:'تكرار لنفس التنبيه',lines},{costRate}),code('change_exists'));
  assert.ok(verifyAudit(db));
});

test('handoff: an approved costed estimate becomes the payload of the existing commercial quote path, which then carries the same margin',t=>{
  const {db,users,tx,client,act,card,decideCard,estimate}=fixture(t);
  decideCard(card(users.employee,{lines:roles}));
  const id=estimate({lines},{costRate});act(users.employee,id,'submit');act(users.manager,id,'approve',{note:'اعتماد'});
  const caseId=tx(()=>createLead(db,users.employee,{name:'شركة تجريبية للتجزئة',registration_number:'TEST-7401',contact:'جهة اتصال تجريبية',source:'إحالة تجريبية',sector:'التجزئة'})).id;
  tx(()=>clientAction(db,users.employee,client,'link_case',{case_id:caseId}));
  const caseVersion=()=>db.prepare('SELECT version FROM commercial_cases WHERE id=?').get(caseId).version;
  tx(()=>commercialAction(db,users.employee,caseId,'qualify',{version:caseVersion(),need:'حملة إطلاق تجريبية',budget:'8000.00',currency:'SAR',timing:riyadh(30),decision_maker:'مدير تسويق تجريبي',service_fit:'ضمن خدمات الحملات'}));
  tx(()=>commercialAction(db,users.manager,caseId,'approve_qualification',{version:caseVersion(),note:'تأهيل تجريبي'}));
  assert.throws(()=>commercialPayload(db,users.employee,id,{valid_until:riyadh(5),tax_rate:'',acceptance:'موافقة العميل',revisions:2}),code('tax_rate'),'no tax rate is assumed');
  act(users.employee,id,'handoff',{case_id:caseId,note:'حُمل إلى الملف التجاري'});
  const handoff=commercialPayload(db,users.employee,id,{valid_until:riyadh(5),tax_rate:'15',acceptance:'موافقة العميل الكتابية على المخرج',revisions:2});
  assert.equal(handoff.action,'save_quote');assert.equal(handoff.case_id,caseId);
  // النسخة تُحفظ على عرض سعر العميل الذي يساويها (الترحيل 182)، ويمرّ معرّفه من التقدير إلى المسار التجاري كما هو.
  const bound=commercialPayload(db,users.employee,id,{valid_until:riyadh(5),tax_rate:'15',acceptance:'موافقة العميل الكتابية على المخرج',revisions:2,quotation_id:proposalFor(db,caseId,handoff.payload)});
  assert.ok(bound.payload.quotation_id);
  const saved=tx(()=>commercialAction(db,users.employee,caseId,bound.action,{version:caseVersion(),...bound.payload}));
  assert.equal(saved.current_quote.snapshot.net_minor,'655000');assert.equal(saved.current_quote.snapshot.margin_minor,'430000','the quote carries the estimate margin, not a zero-cost one');
  assert.equal(estimatesBoard(db,users.employee).estimates.find(x=>x.id===id).handoff.case_id,caseId);
  assert.throws(()=>act(users.employee,id,'handoff',{case_id:caseId,note:''}),code('action_unavailable'));
  assert.ok(verifyAudit(db));
});
