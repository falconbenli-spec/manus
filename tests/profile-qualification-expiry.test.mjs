import test from 'node:test';
import assert from 'node:assert/strict';
import { openDb, transaction } from '../app/db.mjs';
import { seed } from '../scripts/seed.mjs';
import { installServiceCatalog } from '../app/service-catalog.mjs';
import * as wf from '../app/workflow.mjs';

test('المؤهل العلمي يرسل دون تاريخ انتهاء مصطنع، والهوية والجواز يظلان محميين', t => {
  const db = openDb(':memory:');
  t.after(() => db.close());
  seed(db, 'synthetic-qualification-review');
  installServiceCatalog(db);
  const employee = db.prepare("SELECT * FROM users WHERE id='employee'").get();
  const service = wf.catalog(db, employee).find(s => s.code === 'HR-PROFILE-UPDATE');
  const create = change_type => transaction(db, () => wf.createRequest(db, employee, {
    service_id: service.id, title: 'تحديث سجل تعليمي تجريبي',
    payload: { change_type, details: 'مؤهل تجريبي محدث كما يظهر في الوثيقة' }
  }));
  const submit = request => transaction(db, () => wf.transition(db, employee, request.id, 'submit', { version: request.version }));
  assert.equal(submit(create('المؤهل العلمي')).status, 'pending');
  for (const type of ['الهوية أو الإقامة', 'جواز السفر']) {
    assert.throws(() => submit(create(type)), error => error.code === 'missing_field' && error.message.includes('تاريخ انتهاء الوثيقة'));
  }
});
