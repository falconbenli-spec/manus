import test from 'node:test';
import assert from 'node:assert/strict';
import { openDb, transaction, verifyAudit } from '../app/db.mjs';
import { seed } from '../scripts/seed.mjs';
import { grantAccess } from '../app/access.mjs';
import { lifecycleBoard, clearanceBoard, saveStepTemplate, openBundle, clearItem, clearanceBlockers } from '../app/lifecycle.mjs';

// إثبات إغلاق ثغرات إخلاء الطرف (مراجعة الأمن 2026-09-18). كل البيانات مصطنعة.
const code=value=>error=>error.code===value;
const stamp='2026-01-01T00:00:00.000Z';
function fixture(t){
  const db=openDb(':memory:');seed(db,'synthetic-security-lifecycle');t.after(()=>db.close());
  const users=Object.fromEntries(db.prepare('SELECT * FROM users').all().map(u=>[u.id,u])),tx=f=>transaction(db,f);
  db.prepare("INSERT INTO custodies(id,tenant_id,holder_id,amount_minor,purpose,status,approved_by,approved_at,issued_on,issue_reference,issued_by,created_at,updated_at) VALUES('cust-1','36t','employee',50000,'عهدة تجريبية لمصروفات تصوير','issued','manager',?,'2026-01-02','سند','hr',?,?)").run(stamp,stamp,stamp);
  db.prepare("INSERT INTO fixed_assets(id,tenant_id,code,name,category,acquired_on,cost_minor,useful_months,custodian_id,evidence,status,recorded_by,approved_by,approved_at,created_at,updated_at) VALUES('fa-1','36t','FA-0001','حاسب محمول تجريبي','devices','2026-01-01',400000,36,'employee','فاتورة شراء تجريبية مصطنعة','active','hr','manager',?,?,?)").run(stamp,stamp,stamp);
  tx(()=>saveStepTemplate(db,users.hr,{kind:'offboarding',code:'IT-1',title:'استلام الجهاز',department_id:'it',owner_role:'it',target_days:2,acceptance:'دليل استلام الجهاز موثق',depends_on:null,basis:'قرار مدير الموارد البشرية التجريبي'}));
  const bundleId=tx(()=>openBundle(db,users.hr,{kind:'offboarding',employee_id:'employee',owner_id:'outsider',effective_date:'2026-12-01',date_basis:'خطاب تجريبي مؤرخ ومؤكد'})).id;
  const items=()=>db.prepare('SELECT * FROM lifecycle_clearance_items WHERE bundle_id=?').all(bundleId);
  return {db,users,tx,bundleId,items};
}

test('clearance blockers: readable only by the bundle owner, a people.manage holder or a payroll holder — anyone else, and any other tenant, gets «not found»',t=>{
  const {db,users,tx}=fixture(t);
  assert.throws(()=>clearanceBlockers(db,users.manager,'employee'),code('not_found'),'the leaver’s own manager holds none of the three');
  assert.throws(()=>clearanceBlockers(db,users.it,'employee'),code('not_found'),'a step owner reads no blockers');
  assert.throws(()=>clearanceBlockers(db,users.external,'employee'),code('not_found'),'another tenant reads nothing, not even a placeholder');
  assert.throws(()=>clearanceBlockers(db,users.hr,'external'),code('not_found'),'nor does this tenant reach another tenant’s employee');
  assert.deepEqual(clearanceBlockers(db,users.outsider,'employee').blockers.map(b=>b.source).sort(),['custody','fixed_asset'],'the bundle owner reads them');
  assert.equal(clearanceBlockers(db,users.hr,'employee').blocked,true,'so does the people.manage holder');
  tx(()=>grantAccess(db,users.admin,{user_id:'manager',capability:'payroll.review',department_id:null,note:'مراجعة الرواتب التجريبية'}));
  assert.equal(clearanceBlockers(db,users.manager,'employee').blocked,true,'and a payroll holder');
});

test('financial clearance: an item closes only when its source is closed in finance, or by a payroll/finance holder — never on free text from the bundle owner',t=>{
  const {db,users,tx,items}=fixture(t);
  const custody=items().find(i=>i.source==='custody'),asset=items().find(i=>i.source==='fixed_asset');
  assert.throws(()=>tx(()=>clearItem(db,users.outsider,custody.id,{version:custody.version,evidence:'تمت التسوية كما قال لي الزميل'})),code('source_open'));
  assert.equal(clearanceBlockers(db,users.hr,'employee').blocked,true);
  // العهدة تُقفل فعلًا في المالية، فيقرّ مالك الحزمة إغلاق البند بدليله.
  db.prepare("UPDATE custodies SET status='closed',version=version+1 WHERE id='cust-1'").run();
  tx(()=>clearItem(db,users.outsider,custody.id,{version:custody.version,evidence:'سند إقفال العهدة في شاشة المصروفات'}));
  // الأصل ما زال باسمه: يقرّه حامل تصريح الرواتب بمسؤوليته.
  assert.throws(()=>tx(()=>clearItem(db,users.outsider,asset.id,{version:asset.version,evidence:'قال إنه سلّم الجهاز'})),code('source_open'));
  tx(()=>clearItem(db,users.hr,asset.id,{version:asset.version,evidence:'إقرار الرواتب بخصم قيمة الأصل من التسوية'}));
  assert.equal(clearanceBlockers(db,users.hr,'employee').blocked,false);
  assert.ok(verifyAudit(db));
});

test('step owners and the leaver see no amounts and no financial items; the owner and people.manage holders do',t=>{
  const {db,users,bundleId}=fixture(t);
  const view=u=>lifecycleBoard(db,u).bundles.find(b=>b.id===bundleId);
  for(const u of [users.it,users.employee]){
    const b=view(u);
    assert.ok(b,'the bundle stays visible to them');
    assert.deepEqual(b.clearance.filter(i=>i.financial),[],'no financial item reaches a step owner or the leaver');
    assert.ok(b.clearance.every(i=>i.amount_minor===null));
    assert.equal(b.progress.open_financial,null);
    assert.ok(!JSON.stringify(b).includes('50000')&&!JSON.stringify(b).includes('400000'));
  }
  for(const u of [users.outsider,users.hr])
    assert.deepEqual(view(u).clearance.filter(i=>i.financial).map(i=>[i.source,i.amount_minor]).sort(),[['custody',50000],['fixed_asset',400000]]);
  assert.deepEqual(clearanceBoard(db,users.it).bundles[0].clearance.filter(i=>i.financial),[]);
});
