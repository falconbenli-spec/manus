import test from 'node:test';
import assert from 'node:assert/strict';
import { openDb, transaction } from '../app/db.mjs';
import { seed } from '../scripts/seed.mjs';
import { seal, unseal, isSealed, SEALED_FIELDS, unsealedCounts, sealingNotice } from '../app/crypto-fields.mjs';
import { sealLegacyFields } from '../scripts/seal-legacy-fields.mjs';
import { runWorkflowSweep } from '../app/workflow-sweep.mjs';

// مسار الكتابة يختم الآيبان، لكن الصفوف المكتوبة قبل التشفير بقيت نصًّا صريحًا و`unseal` تمرّرها كما هي عمدًا،
// فلا شيء يقول إنها هناك. هنا: العدّ يقولها، والسكربت يختمها بعلم صريح ولا يكتب شيئًا في التشغيل الجاف.
// كل آيبان هنا مصطنع بأصفار، ولا يخص جهة حقيقية.
const PLAIN_A='SA0380000000608010000000';
const PLAIN_B='SA0380000000608010000001';

function fixture(t){
  const db=openDb(':memory:');seed(db,'synthetic-iban-sealing');t.after(()=>db.close());
  const vendor=(id,code)=>db.prepare(`INSERT INTO vendors(id,tenant_id,code,supplier_key,legal_name,entity_type,country,categories,data_source,status,registered_by,created_at,updated_at)
    VALUES(?,'36t',?,?,'مورد مصطنع للاختبار','company','SA','[]','إدخال اختباري مصطنع','approved','admin','2026-09-01T00:00:00.000Z','2026-09-01T00:00:00.000Z')`).run(id,code,code);
  const bank=(id,vendorId,iban)=>db.prepare(`INSERT INTO vendor_bank_accounts(id,vendor_id,bank_name,account_holder,iban,iban_digest,reason,status,collected_by,collected_at)
    VALUES(?,?,'بنك مصطنع','مورد مصطنع',?,?,'صفّ كُتب قبل تشفير الحقول','pending','admin','2026-09-01T00:00:00.000Z')`).run(id,vendorId,iban,`digest-${id}`);
  const ibanOf=id=>db.prepare('SELECT iban FROM vendor_bank_accounts WHERE id=?').get(id).iban;
  return {db,vendor,bank,ibanOf};
}

test('sealing: the list of sealed columns is declared, and a clean database says nothing',t=>{
  const {db}=fixture(t);
  assert.ok(SEALED_FIELDS.length>=1);
  assert.ok(SEALED_FIELDS.some(f=>f.table==='vendor_bank_accounts'&&f.column==='iban'));
  assert.deepEqual(unsealedCounts(db).filter(r=>r.rows>0),[],'nothing unsealed in a fresh database');
  assert.equal(sealingNotice(db),null,'and no notice to make');
});

test('sealing: rows left in the clear are counted and named instead of passing silently',t=>{
  const {db,vendor,bank}=fixture(t);
  vendor('v-a','V-SYN-A');vendor('v-b','V-SYN-B');
  bank('vb-a','v-a',PLAIN_A);bank('vb-b','v-b',PLAIN_B);
  const counted=unsealedCounts(db).find(r=>r.table==='vendor_bank_accounts'&&r.column==='iban');
  assert.equal(counted.rows,2);
  const notice=sealingNotice(db);
  assert.match(notice,/vendor_bank_accounts\.iban/);
  assert.match(notice,/2/);
  assert.equal(notice.includes(PLAIN_A),false,'the notice counts rows; it never prints one');
  // ويخرج مع الكنس اليومي، فلا ينتظر أحدٌ أن يقرأ قاعدة بيده ليعرف.
  const result=transaction(db,()=>runWorkflowSweep(db,'36t','2026-09-29',db.prepare("SELECT * FROM users WHERE id='admin'").get(),Date.parse('2026-09-29T09:00:00.000Z')));
  assert.match(result.field_sealing.notice,/vendor_bank_accounts\.iban/);
  assert.equal(result.field_sealing.unsealed,2);
});

test('sealing: the migration runs dry by default — it counts and writes nothing',t=>{
  const {db,vendor,bank,ibanOf}=fixture(t);
  vendor('v-a','V-SYN-A');bank('vb-a','v-a',PLAIN_A);
  const dry=sealLegacyFields(db);
  assert.equal(dry.dry,true,'--dry is the default; writing needs an explicit flag');
  assert.equal(dry.total,1);
  assert.equal(ibanOf('vb-a'),PLAIN_A,'still in the clear — the dry run wrote nothing');
  assert.equal(isSealed(ibanOf('vb-a')),false);
});

test('sealing: with the explicit flag the old rows are sealed, read back identical, and the history trigger is put back',t=>{
  const {db,vendor,bank,ibanOf}=fixture(t);
  vendor('v-a','V-SYN-A');vendor('v-b','V-SYN-B');
  bank('vb-a','v-a',PLAIN_A);bank('vb-b','v-b',PLAIN_B);
  const digestBefore=db.prepare("SELECT iban_digest FROM vendor_bank_accounts WHERE id='vb-a'").get().iban_digest;

  const done=sealLegacyFields(db,{dry:false});
  assert.equal(done.dry,false);
  assert.equal(done.total,2);
  for(const [id,plain] of [['vb-a',PLAIN_A],['vb-b',PLAIN_B]]){
    assert.ok(isSealed(ibanOf(id)),`${id} is sealed`);
    assert.equal(unseal(ibanOf(id)),plain,'and reads back byte for byte');
  }
  assert.equal(db.prepare("SELECT iban_digest FROM vendor_bank_accounts WHERE id='vb-a'").get().iban_digest,digestBefore,'the digest that matches accounts is untouched');
  assert.deepEqual(unsealedCounts(db).filter(r=>r.rows>0),[]);
  assert.equal(sealingNotice(db),null);

  // المُطلِق الذي يحرس تاريخ الحسابات البنكية يعود كما كان: لا يُترك الباب مفتوحًا بعد الترحيل.
  assert.throws(()=>db.prepare("UPDATE vendor_bank_accounts SET iban='SA00' WHERE id='vb-a'").run(),/bank records keep their history/);
  assert.throws(()=>db.prepare("DELETE FROM vendor_bank_accounts WHERE id='vb-a'").run(),/bank records keep their history/);
  // وثانيةً = مرة: لا صفّ يُختم مرتين.
  assert.equal(sealLegacyFields(db,{dry:false}).total,0);
  assert.equal(unseal(ibanOf('vb-a')),PLAIN_A);
});

test('sealing: a value already sealed is never touched, and seal/unseal round-trips',t=>{
  const {db,vendor,bank,ibanOf}=fixture(t);
  vendor('v-a','V-SYN-A');bank('vb-a','v-a',seal(PLAIN_A));
  const before=ibanOf('vb-a');
  assert.equal(sealLegacyFields(db,{dry:false}).total,0);
  assert.equal(ibanOf('vb-a'),before,'left byte for byte as it was');
  assert.equal(unseal(before),PLAIN_A);
});
