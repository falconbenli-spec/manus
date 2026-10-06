// حارس دليل الخدمات: كل بطاقة في الدليل تُنشأ وتُقدَّم بقيم مولَّدة من تعريف حقولها نفسه.
// الغرض أن ينكسر البناء فورًا حين تصير خدمة غير قابلة للتقديم — لا أن يحل محل المسح الكامل
// (scripts/qa-catalog-sweep.mjs) الذي يمشي مسار الاعتماد والتنفيذ والإغلاق عبر HTTP.
import test from 'node:test';
import assert from 'node:assert/strict';
import { openDb, transaction } from '../app/db.mjs';
import { seed } from '../scripts/seed.mjs';
import * as wf from '../app/workflow.mjs';
import { installServiceCatalog, catalogServices } from '../app/service-catalog.mjs';
import { payloadForStored, generatePayload } from '../scripts/qa-catalog-sweep.mjs';
import { CRM_FRONT_DOOR } from '../app/crm-front-door.mjs';

// خيارات تحوّل الطلب إلى وحدة أخرى بدل الطلب العام؛ المولّد يتجنبها، وهذا الاختبار يثبت أنها لا تزال تحوّل.
const REDIRECTING = { 'HR-ATTENDANCE-FIX': ['استئذان', 'تأخير بعذر'] };

function fixture(t) {
  const db = openDb(':memory:');
  seed(db, 'synthetic-catalog-sweep');
  t.after(() => db.close());
  installServiceCatalog(db);
  const users = Object.fromEntries(db.prepare('SELECT * FROM users').all().map(u => [u.id, u]));
  const model = code => catalogServices.find(s => s.code === code)?.fields ?? null;
  return { db, users, model, tx: f => transaction(db, f) };
}

test('every catalogue card can be created and submitted with generated valid input', t => {
  const { db, users, model, tx } = fixture(t);
  const services = wf.catalog(db, users.employee);
  assert.ok(services.length >= 140, `the catalogue should hold every card, found ${services.length}`);

  const failures = [];
  let submitted = 0, structured = 0;
  for (const service of services) {
    const payload = payloadForStored(service.fields, model(service.code));
    // الباب الأمامي الواحد (P4-CRM-3): الطلب النصي بهذه الرموز لا يُكتب، ويُرفض بإشارة إلى السجل المهيكل وشاشته.
    if (CRM_FRONT_DOOR[service.code]) {
      try { tx(() => wf.createRequest(db, users.employee, { service_id: service.id, title: `تجريبي — ${service.name_ar}`.slice(0, 180), payload })); failures.push(`${service.code}: انكتب طلب نصي`); }
      catch (error) { if (error.code === 'use_structured_record' && error.details?.refusal?.link === CRM_FRONT_DOOR[service.code].link) structured++; else failures.push(`${service.code}: ${error.code} — ${error.message}`); }
      continue;
    }
    try {
      let r = tx(() => wf.createRequest(db, users.employee, { service_id: service.id, title: `تجريبي — ${service.name_ar}`.slice(0, 180), payload }));
      r = tx(() => wf.transition(db, users.employee, r.id, 'submit', { version: r.version }));
      // الخدمة غير المباشرة تدخل «قيد الاعتماد»، والمباشرة تدخل «معتمد» عند التقديم نفسه.
      if (!['pending', 'approved'].includes(r.status)) failures.push(`${service.code}: انتهى التقديم بحالة ${r.status}`);
      else submitted++;
    } catch (error) {
      failures.push(`${service.code} (${service.department_id}): ${error.status ?? ''} ${error.code ?? error.name} — ${error.message}`);
    }
  }
  assert.deepEqual(failures, [], 'every catalogue card must accept a generated request or point at its structured record');
  assert.equal(structured, Object.keys(CRM_FRONT_DOOR).length);
  assert.equal(submitted + structured, services.length);
});

test('the generator honours the catalogue field model: conditional fields, patterns and lengths', () => {
  for (const service of catalogServices) {
    const payload = generatePayload(service.fields);
    for (const field of service.fields) {
      const value = payload[field.key];
      if (value === undefined) continue;
      assert.equal(typeof value, 'string', `${service.code}.${field.key}`);
      if (field.min_length) assert.ok(value.length >= field.min_length, `${service.code}.${field.key} shorter than min_length`);
      if (field.max_length) assert.ok(value.length <= field.max_length, `${service.code}.${field.key} longer than max_length`);
      if (field.pattern) assert.match(value, new RegExp(field.pattern), `${service.code}.${field.key} must match its own pattern`);
      if (field.type === 'select') assert.ok(field.options.includes(value), `${service.code}.${field.key} must be one of its options`);
      if (field.type === 'number') assert.match(value, /^\d{1,12}(?:\.\d{1,2})?$/, `${service.code}.${field.key}`);
      if (field.type === 'date') assert.match(value, /^\d{4}-\d{2}-\d{2}$/, `${service.code}.${field.key}`);
    }
    // كل حقل مطلوب ظاهر بشرطه له قيمة، فلا يفشل التقديم لنقص من المولّد نفسه.
    for (const field of service.fields) {
      if (!field.required || field.show_when) continue;
      assert.ok(payload[field.key], `${service.code}.${field.key} required field left empty by the generator`);
    }
  }
});

test('a request whose option belongs to another module is still redirected, not silently accepted', t => {
  const { db, users, model, tx } = fixture(t);
  for (const [code, options] of Object.entries(REDIRECTING)) {
    const service = wf.catalog(db, users.employee).find(s => s.code === code);
    assert.ok(service, code);
    for (const option of options) {
      const payload = { ...payloadForStored(service.fields, model(code)), kind: option };
      assert.throws(
        () => tx(() => wf.createRequest(db, users.employee, { service_id: service.id, title: 'تجريبي — تحويل', payload })),
        error => error.code === 'use_attendance_screen',
        `${code} with «${option}» must send the employee to the attendance screen`
      );
    }
  }
});

test('every catalogue card has a resolvable chain and a named executor in the installed structure', t => {
  const { db, users } = fixture(t);
  const services = wf.catalog(db, users.employee);
  const orphans = services.filter(s => !wf.executorsFor(db, s, s.department_id, '36t').length);
  assert.deepEqual(orphans.map(s => s.code), [], 'a service with no executor cannot be delivered');
  const targets = services.filter(s => !s.target_days);
  assert.deepEqual(targets.map(s => s.code), [], 'every card needs a service level before it is offered');
});
