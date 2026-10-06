import test from 'node:test';
import assert from 'node:assert/strict';
import { openDb, transaction, verifyAudit } from '../app/db.mjs';
import { seed } from '../scripts/seed.mjs';
import { grantAccess } from '../app/access.mjs';
import { createClient } from '../app/agency.mjs';
import { mediaContactsBoard, createContact, contactAction, createList, listAction, createPitch, pitchAction, createCoverage, coverageAction, coverageReport, prBoard } from '../app/pr.mjs';

const code=value=>error=>error.code===value;
const caught=fn=>{try{fn();}catch(error){return error;}throw new Error('لم يُرفض ما كان يجب رفضه');};
const today=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Riyadh'}).format(new Date());
const contact={name:'صحفية تجريبية أولى',role_title:'محررة اقتصاد',outlet:'صحيفة تجريبية',outlet_type:'print',beats:['الاقتصاد','التسويق'],language:'ar',
  preferences:'تفضل الاتصال صباحًا وبالعربية',email:'press@example.test',phone:'',lawful_basis:'public_professional_source',
  basis_note:'بيانات التواصل منشورة في صفحة غرفة الأخبار لدى الوسيلة',collected_on:today(),source:'صفحة اتصل بنا في موقع الوسيلة (بيانات تجريبية)'};

function fixture(t){
  const db=openDb(':memory:');seed(db,'synthetic-pr');t.after(()=>db.close());
  db.exec("INSERT INTO users(id,tenant_id,department_id,username,name,password_hash,role,manager_id) VALUES('iso-admin','isolated','other','iso-admin','مسؤولة الكيان المعزول التجريبية','unused','admin',NULL)");
  db.exec("UPDATE users SET admin_level='super' WHERE id='iso-admin'");
  const users=Object.fromEntries(db.prepare('SELECT * FROM users').all().map(u=>[u.id,u])),tx=f=>transaction(db,f);
  for(const target of ['manager','employee'])tx(()=>grantAccess(db,users.admin,{user_id:target,capability:'pr.manage',department_id:'',note:'فريق العلاقات العامة التجريبي'}));
  return {db,users,tx};
}

test('media contacts: an outside person is never recorded without a lawful basis, a source and a collection date, and the directory is closed to accounts without the capability and to other tenants',t=>{
  const {db,users,tx}=fixture(t);
  assert.throws(()=>mediaContactsBoard(db,users.outsider),code('not_permitted'),'the directory is personal data: no capability, no access');
  assert.throws(()=>tx(()=>createContact(db,users.outsider,contact)),code('not_permitted'));
  assert.throws(()=>tx(()=>createContact(db,users.manager,{...contact,basis_note:'قصير'})),code('invalid_text'),'a lawful basis without an explanation is not a basis');
  assert.throws(()=>tx(()=>createContact(db,users.manager,{...contact,lawful_basis:'حدس'})),code('lawful_basis'));
  assert.throws(()=>tx(()=>createContact(db,users.manager,{...contact,beats:[]})),code('beats'));
  const id=tx(()=>createContact(db,users.manager,contact)).id;
  assert.throws(()=>tx(()=>createContact(db,users.employee,contact)),code('duplicate_contact'));
  const row=mediaContactsBoard(db,users.manager).contacts.find(c=>c.id===id);
  assert.equal(row.lawful_basis,'public_professional_source');assert.equal(row.collected_on,today());assert.deepEqual(row.beats,['الاقتصاد','التسويق']);
  assert.equal(mediaContactsBoard(db,users['iso-admin']).contacts.length,0,'another tenant sees nothing');
  assert.throws(()=>tx(()=>contactAction(db,users['iso-admin'],id,'archive',{version:row.version,note:'محاولة من كيان آخر'})),code('not_found'));
  assert.throws(()=>tx(()=>contactAction(db,users.manager,id,'archive',{version:row.version+5,note:'نسخة قديمة'})),code('stale_version'));
  tx(()=>contactAction(db,users.manager,id,'archive',{version:row.version,note:'الصحفية تركت الوسيلة'}));
  assert.throws(()=>db.prepare('DELETE FROM media_contacts WHERE id=?').run(id),/data subject request/,'erasure of a person is a request, not a row delete');
  assert.deepEqual(mediaContactsBoard(db,users.manager).contacts.find(c=>c.id===id).actions,['restore_contact']);
  // بيانات التواصل الشخصية لا تدخل سجل التدقيق.
  for(const event of db.prepare("SELECT after_json FROM audit_events WHERE entity_type='media_contact'").all())assert.equal(event.after_json.includes('press@example.test'),false);
  assert.ok(verifyAudit(db));
});

test('media list: the person who picked the list does not lock it, and a locked list is replaced rather than edited',t=>{
  const {db,users,tx}=fixture(t);
  const contactId=tx(()=>createContact(db,users.manager,contact)).id;
  const listId=tx(()=>createList(db,users.manager,{name:'قائمة إطلاق تجريبية',purpose:'إعلان إطلاق المنتج التجريبي لصحافة الاقتصاد',client_id:'',campaign_id:''})).id;
  const view=who=>prBoard(db,users[who]).lists.find(l=>l.id===listId);
  assert.throws(()=>tx(()=>listAction(db,users.manager,listId,'lock',{version:view('manager').version,note:'أقفل قائمتي بنفسي وأعتمدها'})),code('invalid_state'),'no self approval');
  tx(()=>listAction(db,users.manager,listId,'add',{version:view('manager').version,contact_id:contactId,note:'تغطي قطاع العميل'}));
  assert.throws(()=>tx(()=>listAction(db,users.manager,listId,'add',{version:view('manager').version,contact_id:contactId,note:''})),code('already_member'));
  tx(()=>listAction(db,users.employee,listId,'lock',{version:view('employee').version,note:'راجعت الجهات ومطابقتها لغرض الحملة'}));
  const locked=view('manager');
  assert.equal(locked.status,'locked');assert.equal(locked.locked_by_name,users.employee.name);assert.deepEqual(locked.actions,[]);
  assert.throws(()=>tx(()=>listAction(db,users.manager,listId,'add',{version:locked.version,contact_id:contactId,note:''})),code('invalid_state'));
  assert.throws(()=>db.prepare('DELETE FROM media_list_members WHERE list_id=?').run(listId),/locked list does not change/);
  assert.throws(()=>db.prepare("UPDATE media_lists SET name='تعديل صامت',version=version+1 WHERE id=?").run(listId),/replaced by a new list/);
  assert.ok(verifyAudit(db));
});

test('pitches and coverage: the platform records a hand-sent pitch, a published pitch is final, coverage counts once per link with a human tone judgement, and the report invents no advertising value',t=>{
  const {db,users,tx}=fixture(t);
  const clientId=tx(()=>createClient(db,users.manager,{legal_name:'شركة العميل التجريبية للعلاقات العامة',trade_name:'العميل ع',sector:'تقنية',status:'active',notes:''})).id;
  const contactId=tx(()=>createContact(db,users.manager,contact)).id;
  const pitch={contact_id:contactId,list_id:'',client_id:clientId,campaign_id:'',subject:'إطلاق المنتج التجريبي',angle:'زاوية أثر المنتج على السوق المحلي',sent_on:today(),sent_via:'بريد الموظفة الشخصي خارج المنصة'};
  assert.throws(()=>tx(()=>createPitch(db,users.outsider,pitch)),code('not_permitted'));
  assert.throws(()=>tx(()=>createPitch(db,users.manager,{...pitch,sent_on:'2099-01-01'})),code('sent_on'));
  const pitchId=tx(()=>createPitch(db,users.manager,pitch)).id;
  const view=()=>prBoard(db,users.manager).pitches.find(p=>p.id===pitchId);
  assert.deepEqual(view().actions,['record_reply','record_decline','record_published']);
  tx(()=>pitchAction(db,users.employee,pitchId,'reply',{version:view().version,outcome_on:today(),note:'طلبت المحررة مواد إضافية'}));
  tx(()=>pitchAction(db,users.employee,pitchId,'published',{version:view().version,outcome_on:today(),note:'نُشر الخبر في الصفحة الاقتصادية'}));
  assert.deepEqual(view().actions,[],'a published pitch is final');
  assert.throws(()=>db.prepare("UPDATE pr_pitches SET angle='زاوية أخرى',version=version+1 WHERE id=?").run(pitchId),/declined or published pitch is final/);
  const coverage={pitch_id:pitchId,contact_id:'',client_id:clientId,campaign_id:'',outlet:'صحيفة تجريبية',outlet_type:'print',title:'الشركة تطلق منتجها التجريبي',
    url:'https://example.test/news/1',published_on:today(),tone:'positive',tone_reason:'العنوان والمتن نقلا الرسالة كما أردناها',highlight:true,highlight_reason:'أوسع تغطية في القطاع هذا الشهر',summary:'خبر عن الإطلاق'};
  assert.throws(()=>tx(()=>createCoverage(db,users.manager,{...coverage,url:'example.test/news/1'})),code('url'));
  assert.throws(()=>tx(()=>createCoverage(db,users.manager,{...coverage,tone_reason:'جيد'})),code('invalid_text'),'a tone is a human judgement and carries its reason');
  assert.throws(()=>tx(()=>createCoverage(db,users.manager,{...coverage,highlight_reason:''})),code('invalid_text'));
  const coverageId=tx(()=>createCoverage(db,users.manager,coverage)).id;
  assert.throws(()=>tx(()=>createCoverage(db,users.employee,{...coverage,highlight:false,highlight_reason:''})),code('duplicate_coverage'),'one link is one coverage');
  const report=coverageReport(db,users.manager,{client_id:clientId});
  assert.equal(report.total,1);assert.deepEqual(report.by_tone,[{key:'positive',name:'إيجابية',count:1}]);
  assert.deepEqual(report.by_type,[{key:'print',name:'مطبوع',count:1}]);
  assert.equal(report.highlights.length,1);assert.equal(report.pitches.published,1);
  for(const invented of ['ave','advertising_value','share_of_voice','sentiment_score'])assert.equal(Object.hasOwn(report,invented),false,`${invented} needs a published methodology we do not have`);
  assert.match(report.note,/قيمة إعلانية مكتسبة/);
  const row=prBoard(db,users.manager).coverage.find(c=>c.id===coverageId);
  assert.throws(()=>tx(()=>coverageAction(db,users.employee,coverageId,'edit',{version:row.version+3,...coverage,pitch_id:undefined,contact_id:undefined,tone:'neutral',tone_reason:'بعد المراجعة النبرة محايدة',highlight:false,highlight_reason:''})),code('stale_version'));
  tx(()=>coverageAction(db,users.employee,coverageId,'edit',{version:row.version,client_id:clientId,campaign_id:'',outlet:coverage.outlet,outlet_type:'print',title:coverage.title,url:coverage.url,published_on:coverage.published_on,tone:'neutral',tone_reason:'بعد قراءة المتن كاملًا النبرة محايدة',highlight:false,highlight_reason:'',summary:coverage.summary}));
  assert.equal(prBoard(db,users.manager).coverage.find(c=>c.id===coverageId).tone,'neutral');
  assert.throws(()=>db.prepare('DELETE FROM pr_coverage WHERE id=?').run(coverageId),/coverage is retained/);
  assert.equal(prBoard(db,users.manager).note.includes('الإرسال يدوي خارج المنصة'),true);
  assert.ok(verifyAudit(db));
});

test('PR-01 do not contact: once a media contact is archived the platform records no further pitch to them — the pitch form stops offering them, the code refuses by name with the way back, and their earlier pitches stay',t=>{
  const {db,users,tx}=fixture(t);
  const id=tx(()=>createContact(db,users.manager,contact)).id;
  const pitch=(over={})=>tx(()=>createPitch(db,users.employee,{contact_id:id,list_id:'',client_id:'',campaign_id:'',subject:'إطلاق تجريبي',angle:'زاوية تجريبية للخبر الاقتصادي',sent_on:today(),sent_via:'بريد الموظفة خارج المنصة',...over}));
  const first=pitch().id;
  assert.ok(prBoard(db,users.employee).contacts.some(c=>c.id===id),'an active contact is offered to the pitch form');
  const row=mediaContactsBoard(db,users.manager).contacts.find(c=>c.id===id);
  tx(()=>contactAction(db,users.manager,id,'archive',{version:row.version,note:'طلبت الصحفية عدم التواصل معها'}));
  assert.equal(prBoard(db,users.employee).contacts.some(c=>c.id===id),false,'the pitch form no longer offers the archived contact');
  const refused=caught(()=>pitch({subject:'متابعة بعد طلب عدم التواصل'}));
  assert.equal(refused.code,'contact_archived');
  assert.equal(refused.status,409);
  assert.ok(refused.details?.refusal?.next,'the refusal says what would make contact possible again');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM pr_pitches WHERE contact_id=?').get(id).n,1,'nothing new is recorded');
  assert.ok(prBoard(db,users.employee).pitches.some(p=>p.id===first),'the pitch made before the request stays in the record');
  assert.ok(verifyAudit(db));
});

