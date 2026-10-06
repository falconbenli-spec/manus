import {fundProject} from './budget-fixture.mjs';
import * as budgets from '../app/budgets.mjs';
import { MAX_FINANCE_AUTHORITY_DAYS } from '../app/finance-grants.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { openDb,transaction,verifyAudit } from '../app/db.mjs';
import { approveVendors } from './vendor-fixture.mjs';
import { seed } from '../scripts/seed.mjs';
import { createProject } from '../app/projects.mjs';
import { createPurchase,procurementAction } from '../app/procurement.mjs';

function fixture(t){
 const db=openDb(':memory:');seed(db,'synthetic-budget-test-only');t.after(()=>db.close());
 const users=Object.fromEntries(db.prepare('SELECT * FROM users').all().map(u=>[u.id,u]));
 const project=transaction(db,()=>createProject(db,users.manager,{name:'ميزانية اختبار',brief:'مخصص مشترك للمشتريات',member_ids:['employee']}));
 const act=(who,p,a,values={})=>transaction(db,()=>procurementAction(db,users[who],p.id,a,{version:p.version,...values}));
 const make=(amount='60.00')=>{
 let p=transaction(db,()=>createPurchase(db,users.employee,{project_id:project.id,title:'اختبار حجز',specification:'كمية اختبار واحدة',cost_center:'TEST-CC',due_date:'2026-12-10',quantity:1,unit:'وحدة',budget_amount:'100.00',budget_evidence:'مخصص الطلب لا يكفي كميزانية مشروع',currency:'SAR'}));
 p=act('employee',p,'submit');for(const key of ['BUD-A','BUD-B','BUD-C'])p=act('employee',p,'add_quote',{supplier_key:key,supplier_name:key,unit_price:amount,technical_assessment:'مطابق للمواصفات',financial_terms:'شروط مصطنعة',delivery_date:'2026-12-10',evidence:'دليل عرض مصطنع'});return p;
 };

 // بوابة المورد: الكيان بلا ملف ما عاد يُقبل عرضه. ومفاتيح هذا الملف كانت حرفًا واحدًا (A/B/C)
 // وهي أقصر مما يقبله دليل الموردين (ثلاثة محارف فأكثر)، فأُطيلت لتُسجَّل.
 approveVendors(db,['BUD-A','BUD-B','BUD-C']);
 return {db,users,project,act,make};
}
test('PRC-01/FIN-02: لا تسمح ترسية بشراء دون مخصص مشروع معتمد',t=>{
 const {make,act}=fixture(t),p=make();assert.throws(()=>act('manager',p,'award',{quote_id:p.quotes[0].id,note:'اعتماد مصطنع'}),{code:'project_budget_required'});
});

test('FIN-02/PRC-01: المخصص المشترك يمنع تجاوز طلبين للسقف ويحرر الحجز بالرفض',t=>{
 const {db,users,project,make,act}=fixture(t);const b=fundProject(db,project.id,'TEST-CC','100.00');
 let p=make(),q=make();p=act('manager',p,'award',{quote_id:p.quotes[0].id,note:'الترسية الأولى'});
 assert.equal(p.budget_reservation.status,'reserved');
 assert.throws(()=>act('manager',q,'award',{quote_id:q.quotes[0].id,note:'تجاوز جماعي'}),{code:'project_budget_exceeded'});
 assert.equal(db.prepare('SELECT COUNT(*) AS n FROM procurement_awards').get().n,1);
 p=act('manager',p,'reject',{note:'تحرير احتياج ملغى'});assert.equal(p.budget_reservation.status,'released');
 q=act('manager',q,'award',{quote_id:q.quotes[0].id,note:'الترسية بعد التحرير'});
 q=act('manager',q,'approve_order',{terms:'شروط اختبار محلية',delivery_date:'2026-12-10',note:'التزام معتمد'});
 const reviewer=db.prepare("SELECT * FROM users WHERE id='budget-reviewer'").get();
 const state=budgets.getBudget(db,reviewer,b.id);assert.equal(state.committed_minor,6000);assert.equal(state.reserved_minor,0);assert.equal(state.available_minor,4000);assert.ok(verifyAudit(db));
});
test('FIN-02/PLT-05: سحب النطاق المالي يمنع القراءة واعتماد أمر مبني عليه',t=>{
 const {db,users,project,make,act}=fixture(t);const b=fundProject(db,project.id,'TEST-CC');
 const reviewer=db.prepare("SELECT * FROM users WHERE id='budget-reviewer'").get();
 let p=make();p=act('manager',p,'award',{quote_id:p.quotes[0].id,note:'ترسية قبل السحب'});
 const g=budgets.listBudgets(db,users.manager).grants.find(g=>g.user_id===reviewer.id);
 transaction(db,()=>budgets.revokeProjectFinanceAccess(db,users.manager,g.id,{version:g.version,reason:'انتهاء التكليف المالي'}));
 assert.throws(()=>budgets.getBudget(db,reviewer,b.id),{code:'not_found'});
 assert.throws(()=>act('manager',p,'approve_order',{terms:'شروط اختبار',delivery_date:'2026-12-10',note:'بعد سحب النطاق'}),{code:'budget_authority_changed'});
 assert.equal(db.prepare('SELECT COUNT(*) AS n FROM procurement_orders').get().n,0);
});
test('FIN-02: المراجعة لا تخفض السقف دون الالتزامات ولا تسمح بالاعتماد الذاتي',t=>{
 const {db,project,make,act}=fixture(t);let b=fundProject(db,project.id,'TEST-CC','100');
 const preparer=db.prepare("SELECT * FROM users WHERE id='budget-preparer'").get(),reviewer=db.prepare("SELECT * FROM users WHERE id='budget-reviewer'").get();
 let p=make();p=act('manager',p,'award',{quote_id:p.quotes[0].id,note:'حجز للاختبار'});
 const update=(u,a,v)=>transaction(db,()=>budgets.budgetAction(db,u,b.id,a,{version:b.version,...v}));
 b=update(preparer,'revise',{cap_amount:'50',valid_from:'2026-01-01',valid_until:'2099-12-31',evidence:'خفض السقف للاختبار'});
 b=update(preparer,'submit',{note:'تقديم النسخة'});
 assert.throws(()=>update(preparer,'approve',{note:'اعتماد ذاتي'}),{code:'transition_denied'});
 assert.throws(()=>update(reviewer,'approve',{note:'سقف أقل من الحجز'}),{code:'budget_below_commitments'});
 assert.equal(budgets.getBudget(db,reviewer,b.id).status,'pending');
});
test('PRC-03: عرضان لا يكفيان للترسية وفق دليل الدورة الموحدة',t=>{
 const {db,users,project,act}=fixture(t);fundProject(db,project.id,'TEST-CC');
 let p=transaction(db,()=>createPurchase(db,users.employee,{project_id:project.id,title:'مقارنة ناقصة',specification:'وحدة اختبار',cost_center:'TEST-CC',due_date:'2026-12-10',quantity:1,unit:'وحدة',budget_amount:'100',budget_evidence:'مخصص اختبار',currency:'SAR'}));
 p=act('employee',p,'submit');for(const key of ['BUD-A','BUD-B'])p=act('employee',p,'add_quote',{supplier_key:key,supplier_name:key,unit_price:'10',technical_assessment:'مطابق',financial_terms:'اختبار',delivery_date:'2026-12-10',evidence:'عرض مصطنع'});
 assert.throws(()=>act('manager',p,'award',{quote_id:p.quotes[0].id,note:'عرضان فقط'}),{code:'comparison_required'});
});

// النطاق المالي للمشروع كان يقبل أي نهاية في المستقبل، فيصير دائمًا: صلاحية على مال مشروع بلا مراجعة ولا انتهاء.
test('النطاق المالي للمشروع له سقف مدة، وهو أفق الصلاحية المالية نفسه',t=>{
 const {db,users,project}=fixture(t);
 // النطاق يُمنح لحامل تصريح مالي حالي فقط؛ صفٌّ مباشر كما يفعل ملحق المخصصات، فالمقصود هنا سقف المدة لا مسار المنح.
 db.prepare('INSERT INTO finance_grants VALUES(?,?,?,?,?,?,?,?,?,?,?)').run('fg-cap-test','36t','employee','employee','read',new Date(Date.now()-30*86400000).toISOString(),new Date(Date.now()+300*86400000).toISOString(),'admin','تفويض مصطنع لاختبار السقف',null,new Date().toISOString());
 const give=ends=>transaction(db,()=>budgets.grantProjectFinanceAccess(db,users.manager,project.id,{user_id:'employee',ends_at:ends,reason:'نطاق لاختبار السقف'}));
 const plus=ms=>new Date(Date.now()+ms).toISOString();
 assert.throws(()=>give('2099-12-31T00:00:00.000Z'),e=>e.code==='invalid_interval'&&/النطاق الدائم صلاحية لا نطاق/.test(e.message));
 assert.throws(()=>give(plus((MAX_FINANCE_AUTHORITY_DAYS+2)*86400000)),e=>e.code==='invalid_interval');
});
