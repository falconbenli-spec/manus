import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { openDb, transaction, verifyAudit, now } from '../app/db.mjs';
import { seed } from '../scripts/seed.mjs';
import { addDocument } from '../app/employees.mjs';
import { expiringSoon, expirySources, expiryBoard, saveExpiryWatch, WATCHED_KINDS } from '../app/expiry.mjs';
import { expiryUI } from '../app/static/expiry-ui.mjs';

const code=value=>error=>error.code===value;
const e=value=>String(value??'').replace(/[&<>"']/g,c=>`&#${c.charCodeAt(0)};`);
const day=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Riyadh',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const shift=days=>new Date(Date.parse(day()+'T00:00:00Z')+days*86400000).toISOString().slice(0,10);
const basis='قرار داخلي رقم 12 أكدته مديرة الموارد البشرية بتاريخ '+day();

function fixture(t){
  const db=openDb(':memory:');seed(db,'synthetic-expiry');t.after(()=>db.close());
  const users=Object.fromEntries(db.prepare('SELECT * FROM users').all().map(u=>[u.id,u])),tx=f=>transaction(db,f);
  const vendor=(id,validUntil=null)=>{
    const time=now();
    db.prepare("INSERT INTO vendors(id,tenant_id,code,supplier_key,legal_name,entity_type,country,categories,data_source,status,valid_until,registered_by,created_at,updated_at) VALUES(?,?,?,?,?,'company','SA','[\"print_gifts\"]','تسجيل تجريبي','approved',?,?,?,?)")
      .run(id,'36t','V-'+id,'KEY-'+id.toUpperCase(),'مورد تجريبي '+id,validUntil,'manager',time,time);
    return id;
  };
  const vendorDocument=(vendorId,kind,expiresOn)=>{
    const docId=randomUUID();
    db.prepare("INSERT INTO vendor_documents(id,vendor_id,kind,reference,expires_on,verification,added_by,created_at) VALUES(?,?,?,'مرجع محفوظ في الملف',?,'verified',?,?)")
      .run(docId,vendorId,kind,expiresOn,'manager',now());
    return docId;
  };
  const fixedTermContract=(userId,endDate)=>{
    const policyId=randomUUID(),contractId=randomUUID(),time=now();
    db.prepare("INSERT INTO hr_policies(id,tenant_id,kind,title,body,parameters,basis,effective_from,status,prepared_by,decided_by,decided_at,created_at) VALUES(?,?,'pay_components','بنود الراتب التجريبية','نص السياسة التجريبية لبيئة الاختبار فقط','{}','سند تجريبي مؤرخ للاختبار',?, 'accepted','hr','manager',?,?)")
      .run(policyId,'36t',day(),time,time);
    db.prepare("INSERT INTO employment_contracts(id,tenant_id,user_id,policy_id,contract_type,job_title,work_location,start_date,end_date,weekly_hours,probation_days,notice_days,pay_lines,monthly_total_minor,currency,document_reference,status,prepared_by,decided_by,decided_at,created_at,updated_at) VALUES(?,?,?,?,'fixed_term','مسمى تجريبي','الرياض','2026-01-01',?,40,0,30,'[]',100000,'SAR','ملف العقد التجريبي','active','hr','manager',?,?,?)")
      .run(contractId,'36t',userId,policyId,endDate,time,time,time);
    return contractId;
  };
  return {db,users,tx,vendor,vendorDocument,fixedTermContract};
}

test('expiry watch: the platform never assumes a reminder window — an expiry is only called “due soon” after its owner records the window with its source',t=>{
  const {db,users,tx}=fixture(t);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM expiry_watch_settings').get().n,0,'the table ships empty: no system-assumed duration');
  tx(()=>addDocument(db,users.hr,'employee',{doc_type:'passport',reference:'آخر 4 أرقام 4412',expires_on:shift(30)}));
  tx(()=>addDocument(db,users.hr,'employee',{doc_type:'iqama',reference:'آخر 4 أرقام 9901',expires_on:shift(-2)}));

  const before=expiringSoon(db,users.hr);
  const passport=before.find(i=>i.doc_kind==='employee.passport'),iqama=before.find(i=>i.doc_kind==='employee.iqama');
  assert.equal(passport.status,'ok','without a recorded window nothing is declared close to expiry');
  assert.equal(passport.configured,false);
  assert.equal(iqama.status,'expired','an expiry already past is a fact, not a judgement: it shows with no setting');
  assert.equal(expirySources(db,users.hr).expiring.length,1,'only the expired one is waiting on a decision so far');

  tx(()=>saveExpiryWatch(db,users.hr,'employee.passport',{first_reminder_days:60,second_reminder_days:15,basis}));
  const after=expiringSoon(db,users.hr).find(i=>i.doc_kind==='employee.passport');
  assert.equal(after.status,'due_soon');assert.equal(after.stage,'first');assert.equal(after.first_reminder_days,60);
  assert.equal(after.basis,basis,'the window carries the source that justified it');

  tx(()=>saveExpiryWatch(db,users.hr,'employee.passport',{version:1,first_reminder_days:20,second_reminder_days:5,basis}));
  assert.equal(expiringSoon(db,users.hr).find(i=>i.doc_kind==='employee.passport').status,'ok','a shorter window narrows what is called close, and nothing is cached');
  assert.ok(verifyAudit(db));
});

test('expiry watch: only the owner of the procedure records a window, the second write carries the version it read, and an unordered pair is refused',t=>{
  const {db,users,tx,vendor,vendorDocument}=fixture(t);
  vendorDocument(vendor('alpha'),'insurance',shift(10));
  assert.throws(()=>tx(()=>saveExpiryWatch(db,users.employee,'employee.passport',{first_reminder_days:30,second_reminder_days:7,basis})),code('not_permitted'));
  assert.throws(()=>tx(()=>saveExpiryWatch(db,users.manager,'employee.passport',{first_reminder_days:30,second_reminder_days:7,basis})),code('not_permitted'),'holding one screen does not grant another');
  assert.throws(()=>tx(()=>saveExpiryWatch(db,users.hr,'vendor.insurance',{first_reminder_days:30,second_reminder_days:7,basis})),code('not_permitted'));
  assert.throws(()=>tx(()=>saveExpiryWatch(db,users.hr,'employee.unknown_kind',{first_reminder_days:30,second_reminder_days:7,basis})),code('not_found'));

  assert.throws(()=>tx(()=>saveExpiryWatch(db,users.hr,'employee.passport',{first_reminder_days:7,second_reminder_days:30,basis})),code('reminder_order'));
  assert.throws(()=>tx(()=>saveExpiryWatch(db,users.hr,'employee.passport',{first_reminder_days:30,second_reminder_days:30,basis})),code('reminder_order'));
  assert.throws(()=>tx(()=>saveExpiryWatch(db,users.hr,'employee.passport',{first_reminder_days:0,second_reminder_days:0,basis})),code('first_reminder_days'));
  assert.throws(()=>tx(()=>saveExpiryWatch(db,users.hr,'employee.passport',{first_reminder_days:30,second_reminder_days:7,basis:'قرار'})),code('invalid_text'),'a window with no stated source is not accepted');

  tx(()=>saveExpiryWatch(db,users.manager,'vendor.insurance',{first_reminder_days:45,second_reminder_days:10,basis}));
  tx(()=>saveExpiryWatch(db,users.hr,'employee.passport',{first_reminder_days:30,second_reminder_days:7,basis}));
  assert.throws(()=>tx(()=>saveExpiryWatch(db,users.hr,'employee.passport',{first_reminder_days:40,second_reminder_days:9,basis})),code('stale_version'),'overwriting a recorded window without reading it first is refused');
  assert.throws(()=>tx(()=>saveExpiryWatch(db,users.hr,'employee.passport',{version:7,first_reminder_days:40,second_reminder_days:9,basis})),code('stale_version'));
  tx(()=>saveExpiryWatch(db,users.hr,'employee.passport',{version:1,first_reminder_days:40,second_reminder_days:9,basis}));
  assert.equal(db.prepare("SELECT version FROM expiry_watch_settings WHERE doc_kind='employee.passport'").get().version,2);
  assert.throws(()=>db.prepare("UPDATE expiry_watch_settings SET first_reminder_days=1 WHERE doc_kind='employee.passport'").run(),/stale expiry watch setting/,'the version rule is enforced in SQL too');
  assert.throws(()=>db.prepare("DELETE FROM expiry_watch_settings WHERE doc_kind='employee.passport'").run(),/not deleted/);
  assert.ok(verifyAudit(db));
});

test('expiry watch: an account is shown only the expiries it may open in detail, its own always, and never another tenant’s',t=>{
  const {db,users,tx,vendor,vendorDocument}=fixture(t);
  tx(()=>addDocument(db,users.hr,'employee',{doc_type:'passport',reference:'آخر 4 أرقام 4412',expires_on:shift(20)}));
  tx(()=>addDocument(db,users.hr,'outsider',{doc_type:'passport',reference:'آخر 4 أرقام 7788',expires_on:shift(25)}));
  tx(()=>addDocument(db,users.external,'external',{doc_type:'passport',reference:'آخر 4 أرقام 3030',expires_on:shift(15)}));
  vendorDocument(vendor('beta'),'vat_certificate',shift(40));

  const own=expiringSoon(db,users.employee);
  assert.deepEqual([...new Set(own.map(i=>i.subject_id))],['employee'],'an employee reads their own documents and no colleague’s');
  assert.deepEqual([...new Set(own.map(i=>i.scope))],['own']);

  const officer=expiringSoon(db,users.hr).filter(i=>i.doc_kind.startsWith('employee.'));
  assert.deepEqual(officer.map(i=>i.subject_id).sort(),['employee','outsider'],'the people officer reads the whole tenant');
  assert.ok(!officer.some(i=>i.subject_id==='external'),'another tenant never appears');

  const buyer=expiringSoon(db,users.manager);
  assert.ok(buyer.some(i=>i.doc_kind==='vendor.vat_certificate'),'a vendor-directory holder reads vendor documents');
  assert.ok(!buyer.some(i=>i.subject_id==='outsider'),'and gains nothing about another person’s documents');
  assert.ok(!expiringSoon(db,users.employee).some(i=>i.doc_kind.startsWith('vendor.')));
  assert.deepEqual(expiringSoon(db,users.external).map(i=>i.subject_id),['external']);

  const board=expiryBoard(db,users.employee);
  assert.equal(board.totals.expired+board.totals.due_soon+board.totals.ok,board.items.length,'every total is the length of a list this account can open');
  assert.equal(board.can_set_any,false,'an account with no procedure to own is not offered the window form');
  assert.ok(expiryBoard(db,users.hr).kinds.some(k=>k.key==='employee.passport'&&k.can_set));
  assert.ok(expiryBoard(db,users.hr).kinds.every(k=>!k.can_set||!k.key.startsWith('vendor.')));
  assert.ok(verifyAudit(db));
});

test('expiry sources: hands the shared decision box rows it can absorb unchanged, and keeps valid documents out of it',t=>{
  const {db,users,tx,vendor,vendorDocument}=fixture(t);
  tx(()=>addDocument(db,users.hr,'employee',{doc_type:'work_permit',reference:'آخر 4 أرقام 1212',expires_on:shift(-5)}));
  tx(()=>addDocument(db,users.hr,'outsider',{doc_type:'work_permit',reference:'آخر 4 أرقام 6565',expires_on:shift(200)}));
  vendorDocument(vendor('gamma'),'insurance',shift(3));

  const forOfficer=expirySources(db,users.hr).expiring;
  assert.equal(forOfficer.length,1,'only what expired or reached a recorded window waits on a decision');
  const row=forOfficer[0];
  assert.equal(typeof row.id,'string');assert.ok(row.id.length);
  assert.ok(row.title.includes('رخصة عمل'),'the row names itself, since the box builds its own text');
  assert.match(row.created_at,/^\d{4}-\d{2}-\d{2}$/);
  assert.deepEqual(row.actions,['review_expiry']);
  assert.ok(row.actions.every(a=>typeof a==='string'));

  assert.deepEqual(expirySources(db,users.employee).expiring.map(r=>r.id),forOfficer.map(r=>r.id),'the owner of an expired document is told too');
  assert.deepEqual(expirySources(db,users.it).expiring,[],'someone with neither the document nor the permission is told nothing');
  tx(()=>saveExpiryWatch(db,users.manager,'vendor.insurance',{first_reminder_days:30,second_reminder_days:7,basis}));
  assert.equal(expirySources(db,users.manager).expiring.length,1,'a recorded window is what turns a future date into a pending decision');
  assert.ok(verifyAudit(db));
});

test('expiry watch: a fixed-term contract end is watched like any other expiry, and only its holder and the contracts owner see it',t=>{
  const {db,users,tx,fixedTermContract}=fixture(t);
  fixedTermContract('employee',shift(25));
  assert.equal(expiringSoon(db,users.employee).find(i=>i.doc_kind==='employment_contract').scope,'own');
  assert.equal(expiringSoon(db,users.hr).find(i=>i.doc_kind==='employment_contract').subject_id,'employee');
  assert.ok(!expiringSoon(db,users.manager).some(i=>i.doc_kind==='employment_contract'),'a line manager does not read contracts by role');
  assert.ok(!expiringSoon(db,users.it).some(i=>i.doc_kind==='employment_contract'));
  assert.equal(expiringSoon(db,users.hr).find(i=>i.doc_kind==='employment_contract').status,'ok','a contract end is not “close” before someone records how close is close');
  tx(()=>saveExpiryWatch(db,users.hr,'employment_contract',{first_reminder_days:60,second_reminder_days:14,basis}));
  assert.equal(expiringSoon(db,users.hr).find(i=>i.doc_kind==='employment_contract').status,'due_soon');
  assert.ok(verifyAudit(db));
});

test('expiry watch: the watched kinds are exactly the expiry dates the existing tables really carry',t=>{
  const {db,users}=fixture(t);
  const sources=new Set(WATCHED_KINDS.map(k=>k.source));
  assert.deepEqual([...sources].sort(),['employee_documents','employment_contracts','vendor_documents','vendors']);
  for(const kind of WATCHED_KINDS)assert.ok(['employees.view','hr.contracts.manage','vendors.view'].includes(kind.capability),`${kind.key} leans on a capability outside this module`);
  for(const table of sources){
    const columns=db.prepare(`SELECT name FROM pragma_table_info('${table}')`).all().map(c=>c.name);
    assert.ok(columns.some(c=>['expires_on','end_date','valid_until'].includes(c)),`${table} carries no expiry column`);
  }
  // العقود التجارية بلا تاريخ انتهاء في المخطط: الوحدة تصرّح بذلك ولا تستنتج مدة.
  assert.ok(!db.prepare("SELECT name FROM pragma_table_info('commercial_contracts')").all().some(c=>/expire|valid_until|end_date/.test(c.name)));
  assert.deepEqual(expiryBoard(db,users.hr).not_watched.map(n=>n.source),['commercial_contracts']);
});

test('expiry screen: renders for every seeded role, offers the window form only to the owner of that kind, and never asks for a duration it invented',t=>{
  const {db,users,tx,vendor,vendorDocument}=fixture(t);
  tx(()=>addDocument(db,users.hr,'employee',{doc_type:'passport',reference:'<b>وسم</b> 4412',expires_on:shift(12)}));
  vendorDocument(vendor('delta'),'vat_certificate',shift(-1));
  for(const id of ['employee','manager','hr','it','admin','outsider']){
    const data=expiryBoard(db,users[id]);
    const buttons=[],button=(action,rowId,label)=>{buttons.push([action,rowId]);return `<button>${e(label)}</button>`;};
    const html=expiryUI.render(data,{e,button});
    const text=html.replace(/<[^>]+>/g,' ');
    assert.ok(!/\bundefined\b|\bNaN\b|\[object /.test(text),`${id}: ${text.match(/\bundefined\b|\bNaN\b|\[object /)?.[0]}`);
    assert.ok(!/<b>وسم/.test(html),`${id}: a stored reference reached the page unescaped`);
    assert.ok(!/ style="/.test(html)&&!/<script/i.test(html));
    for(const [action,rowId] of buttons){
      const spec=expiryUI.form(action,rowId,data);
      assert.equal(typeof spec.title,'string');assert.ok(Array.isArray(spec.fields)&&spec.fields.length===3);
      assert.ok(spec.fields.every(f=>f.name!=='basis'||f.type==='textarea'),'the source of the duration is asked for in full');
      assert.ok(spec.fields.filter(f=>f.type==='number').every(f=>!f.value||Number(f.value)>0));
      assert.equal(spec.endpoint,`/expiry/settings/${rowId}`);
    }
    if(id==='employee'||id==='it'||id==='outsider')assert.equal(buttons.length,0,`${id}: offered a window form for a procedure they do not own`);
  }
  const officer=expiryBoard(db,users.hr);
  assert.throws(()=>expiryUI.form('set_watch','vendor.insurance',officer),/الإجراء غير متاح/,'a form for a kind outside the account is refused before it opens');
  const blank=officer.kinds.find(k=>k.key==='employee.passport');
  assert.deepEqual(blank.actions,['set_watch']);
  assert.equal(expiryUI.form('set_watch','employee.passport',officer).fields.find(f=>f.name==='first_reminder_days').value,'','no duration is pre-filled: the platform has none to offer');
});
