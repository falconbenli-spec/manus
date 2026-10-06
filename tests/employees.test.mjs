import test from 'node:test';
import assert from 'node:assert/strict';
import { openDb, transaction } from '../app/db.mjs';
import { seed } from '../scripts/seed.mjs';
import { installServiceCatalog } from '../app/service-catalog.mjs';
import * as employees from '../app/employees.mjs';
import * as admin from '../app/admin.mjs';
import { authenticate, login } from '../app/auth.mjs';

const password='synthetic-employees-only';
const code=c=>error=>error.code===c;
const user=(db,id)=>db.prepare('SELECT * FROM users WHERE id=?').get(id);
// التواريخ بتقويم الرياض كما تحسبها الوحدة، حتى لا يختلف اليوم بحسب منطقة الجهاز.
const riyadh=d=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Riyadh',year:'numeric',month:'2-digit',day:'2-digit'}).format(d);
const day=offset=>riyadh(new Date(Date.now()+offset*86400000));
function setup(t){const db=openDb(':memory:');seed(db,password);installServiceCatalog(db);t.after(()=>db.close());return db;}

test('RECORD: people officers keep the profile, and everyone else only sees their own or their team',t=>{
  const db=setup(t),hr=user(db,'hr'),employee=user(db,'employee'),manager=user(db,'manager'),outsider=user(db,'outsider');
  let record=transaction(db,()=>employees.saveProfile(db,hr,'employee',{job_title:'مصممة أولى',employment_type:'full_time',join_date:'2025-03-01',contract_end:null,status:'active'}));
  assert.equal(record.profile.job_title,'مصممة أولى');
  assert.equal(record.profile.version,1);
  assert.throws(()=>transaction(db,()=>employees.saveProfile(db,hr,'employee',{job_title:'مصممة رئيسية',employment_type:'full_time',join_date:'2025-03-01',contract_end:null,status:'active',version:9})),code('stale_version'));
  // الحزمة 4 (P4-HR-1، 1 أكتوبر 2026): المسمى حقل مؤرخ؛ لا يعدّله الملف مباشرة بعد إنشائه بل تغييرٌ مؤرخ يعتمده زميل.
  // كان هذا السطر يعدّل المسمى من الملف فيمر بلا تاريخ ولا اعتماد — وهو بالضبط ما أُغلق. ما ليس مؤرخًا (المباشرة) يبقى يُحفظ.
  assert.throws(()=>transaction(db,()=>employees.saveProfile(db,hr,'employee',{job_title:'مصممة رئيسية',employment_type:'full_time',join_date:'2025-03-01',contract_end:null,status:'active',version:1})),code('dated_field'));
  record=transaction(db,()=>employees.saveProfile(db,hr,'employee',{job_title:'مصممة أولى',employment_type:'full_time',join_date:'2025-03-02',contract_end:null,status:'active',version:1}));
  assert.equal(record.profile.version,2);
  assert.throws(()=>transaction(db,()=>employees.saveProfile(db,manager,'employee',{job_title:'مسمى من المدير',employment_type:'full_time',join_date:'2025-03-01',contract_end:null,status:'active',version:2})),code('forbidden'));
  assert.equal(employees.employeeRecord(db,manager,'employee').profile.job_title,'مصممة أولى','a direct manager reads their team member’s file');
  assert.equal(employees.employeeRecord(db,employee,'employee').can.edit_profile,false,'an employee reads their own file without editing it');
  assert.throws(()=>employees.employeeRecord(db,outsider,'employee'),code('forbidden'));
  const officerView=employees.listEmployees(db,hr),teamView=employees.listEmployees(db,manager);
  assert.equal(officerView.scope,'people');
  assert.ok(officerView.rows.length>teamView.rows.length);
  assert.ok(teamView.rows.every(r=>r.user.id===manager.id||r.user.id==='employee'||r.user.id==='outsider'));
});

test('RECORD: documents track expiry and replacement, and full identity numbers are refused',t=>{
  const db=setup(t),hr=user(db,'hr'),employee=user(db,'employee');
  assert.throws(()=>transaction(db,()=>employees.addDocument(db,hr,'employee',{doc_type:'iqama',reference:'2123456789',expires_on:day(30)})),code('reference_number'),'a full residency number must not be stored');
  let record=transaction(db,()=>employees.addDocument(db,hr,'employee',{doc_type:'iqama',reference:'آخر 4 أرقام 6789',expires_on:day(20),issued_on:'2025-01-01'}));
  assert.equal(record.documents[0].state,'expiring');
  assert.equal(record.documents[0].days_left,20);
  const old=record.documents[0];
  record=transaction(db,()=>employees.addDocument(db,hr,'employee',{doc_type:'iqama',reference:'آخر 4 أرقام 6789',expires_on:day(400),replaces:old.id}));
  const states=Object.fromEntries(record.documents.map(d=>[d.id,d.state]));
  assert.equal(states[old.id],'replaced');
  assert.ok(Object.values(states).includes('valid'));
  transaction(db,()=>employees.addDocument(db,hr,'it',{doc_type:'contract',reference:'عقد 2024',expires_on:day(-5)}));
  const expiring=employees.expiringDocuments(db,hr);
  assert.ok(expiring.some(d=>d.state==='expired'&&d.employee_name));
  assert.deepEqual(employees.expiringDocuments(db,employee),[],'an employee does not read the company-wide expiry list');
  assert.throws(()=>transaction(db,()=>employees.addDocument(db,user(db,'manager'),'employee',{doc_type:'passport',reference:'جواز',expires_on:day(100)})),code('forbidden'));
  assert.throws(()=>db.prepare('DELETE FROM employee_documents WHERE user_id=?').run('employee'),/archived, not deleted/);
});

test('RECORD: a dated change applies on its date and moves the account with it',t=>{
  const db=setup(t),hr=user(db,'hr'),a=user(db,'admin');
  transaction(db,()=>admin.createAccount(db,a,{username:'m.transfer',name:'موظف نقل مصطنع',role:'employee',department_id:'creative',manager_id:'manager',temporary_password:'Welcome-2026'}));
  db.prepare("UPDATE users SET must_change_password=0 WHERE id='m.transfer'").run();
  transaction(db,()=>employees.saveProfile(db,hr,'m.transfer',{job_title:'منفذ إنتاج',employment_type:'full_time',join_date:'2025-06-01',contract_end:null,status:'active'}));
  const future=transaction(db,()=>employees.recordChange(db,hr,'m.transfer',{change_type:'job_title',to_value:'منفذ إنتاج أول',effective_from:day(10),reason:'ترقية معتمدة من المدير'}));
  assert.equal(future.changes[0].applied_at,null,'a future change waits for its date');
  assert.equal(future.profile.job_title,'منفذ إنتاج','the profile does not move early');
  const session=login(db,'m.transfer','Welcome-2026','record-test');
  // الحزمة 4 (P4-HR-1، 1 أكتوبر 2026): التغيير لا يسري قبل اعتماده، ولو حلّ تاريخه. hr وحده يحمل «السجل الوظيفي» في هذه البذرة،
  // فيعتمده بنفسه بسبب مكتوب يُحفظ في سجل التدقيق (two_person:false) — كان يسري لحظة تسجيله بيد واحدة.
  const due=transaction(db,()=>employees.recordChange(db,hr,'m.transfer',{change_type:'department',to_value:'production',effective_from:day(0),reason:'نقل معتمد إلى الإنتاج'}));
  assert.equal(user(db,'m.transfer').department_id,'creative','a recorded change waits for its approval');
  transaction(db,()=>employees.approveChange(db,hr,due.change_id,{self_approval_reason:'لا يحمل السجل الوظيفي في هذه البذرة غيري، والنقل مستحق اليوم'}));
  assert.equal(user(db,'m.transfer').department_id,'production','a due change applies at its approval');
  assert.equal(user(db,'m.transfer').manager_id,null,'the old manager does not follow the move');
  assert.throws(()=>authenticate(db,`session=${session.token}`),code('session_expired'),'moving a person ends their sessions');
  assert.throws(()=>transaction(db,()=>employees.recordChange(db,hr,'m.transfer',{change_type:'department',to_value:'legal',effective_from:day(1),reason:'إدارة مؤرشفة'})),code('department'));
  assert.throws(()=>transaction(db,()=>employees.recordChange(db,hr,'m.transfer',{change_type:'department',to_value:'production',effective_from:day(2),reason:'نفس القيمة'})),code('no_change'));
  assert.throws(()=>transaction(db,()=>employees.recordChange(db,user(db,'manager'),'m.transfer',{change_type:'job_title',to_value:'مسمى من المدير',effective_from:day(1),reason:'محاولة'})),code('forbidden'));
  const pending=employees.employeeRecord(db,hr,'m.transfer').changes.find(c=>!c.applied_at&&!c.cancelled_at);
  const cancelled=transaction(db,()=>employees.cancelChange(db,hr,pending.id,{reason:'أُلغيت الترقية بقرار لاحق'}));
  assert.ok(cancelled.changes.find(c=>c.id===pending.id).cancelled_at);
  assert.throws(()=>db.prepare('UPDATE employee_changes SET to_value=? WHERE id=?').run('تعديل',pending.id),/settled employee change is immutable/);
});

test('RECORD: leaving on a date closes the account and its access',t=>{
  const db=setup(t),hr=user(db,'hr'),a=user(db,'admin');
  transaction(db,()=>admin.createAccount(db,a,{username:'m.leaver',name:'موظف مغادر مصطنع',role:'employee',department_id:'creative',manager_id:'manager',temporary_password:'Welcome-2026'}));
  transaction(db,()=>employees.saveProfile(db,hr,'m.leaver',{job_title:'منسق',employment_type:'contract',join_date:'2025-01-05',contract_end:day(200),status:'active'}));
  const leaving=transaction(db,()=>employees.recordChange(db,hr,'m.leaver',{change_type:'status',to_value:'left',effective_from:day(0),reason:'انتهاء العقد وإخلاء الطرف'}));
  // الحزمة 4 (P4-HR-1): المغادرة تسري عند اعتمادها، بيد ثانية أو — هنا، ولا حامل آخر للسجل الوظيفي — بسبب مكتوب.
  assert.equal(user(db,'m.leaver').active,1,'nothing closes before the change is approved');
  transaction(db,()=>employees.approveChange(db,hr,leaving.change_id,{self_approval_reason:'لا يحمل السجل الوظيفي في هذه البذرة غيري، والمغادرة مستحقة اليوم'}));
  assert.equal(user(db,'m.leaver').active,0,'a person who left loses the account');
  assert.equal(employees.employeeRecord(db,hr,'m.leaver').profile.status,'left');
  const applied=employees.employeeRecord(db,hr,'m.leaver').changes[0];
  assert.ok(applied.applied_at,'the change is stamped with the moment it took effect');
});
