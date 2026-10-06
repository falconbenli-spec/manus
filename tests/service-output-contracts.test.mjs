import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { openDb, transaction, verifyAudit } from '../app/db.mjs';
import { seed } from '../scripts/seed.mjs';
import { createApp } from '../app/server.mjs';
import { createService, createRequest, transition, catalog, addAttachment } from '../app/workflow.mjs';
import { closeWithEvidence } from '../app/request-closure.mjs';
import { obligations } from '../app/obligations.mjs';
import {
  DEEPEN_OUTPUT_SERVICES,
  CONNECTED_SERVICE_MODULES,
  outputContract,
  recordServiceOutput,
  decideServiceOutput,
  serviceOutputView
} from '../app/service-outputs.mjs';

const code = wanted => error => error?.code === wanted;
const payload = { detail: 'تجريبي: وصف تشغيلي كامل لاختبار مخرج الخدمة' };

function fixture(t) {
  const db = openDb(':memory:');
  seed(db, 'synthetic-service-output-contracts');
  t.after(() => db.close());
  const users = Object.fromEntries(db.prepare('SELECT * FROM users').all().map(user => [user.id, user]));
  const tx = work => transaction(db, work);
  const version = requestId => db.prepare('SELECT version FROM requests WHERE id=?').get(requestId).version;
  const add = (code, department_id='it', handler_role='it') => tx(() => createService(db, users.admin, {
    code,
    name_ar: `خدمة ${code}`,
    name_en: code,
    department_id,
    description: 'خدمة مصطنعة لاختبار عقد المخرج الفعلي قبل الإغلاق.',
    fields: [{ key: 'detail', label: 'التفصيل', type: 'textarea', required: true }],
    approval_policy: { steps: ['manager'], handler_role }
  }));
  const inProgress = serviceCode => {
    const service = catalog(db, users.employee).find(item => item.code === serviceCode);
    const request = tx(() => createRequest(db, users.employee, { service_id: service.id, title: `تجريبي: ${serviceCode}`, payload }));
    tx(() => transition(db, users.employee, request.id, 'submit', { version: version(request.id), note: '' }));
    tx(() => transition(db, users.manager, request.id, 'approve', { version: version(request.id), note: 'تجريبي: موافق' }));
    tx(() => transition(db, users[serviceCode==='HR-JOB-CHANGE'?'hr':'it'], request.id, 'claim', { version: version(request.id), note: '' }));
    return request.id;
  };
  return { db, users, tx, version, add, inProgress };
}

test('the governed scope is exactly the audited 42 deepen services and 12 existing-module connections', () => {
  assert.equal(DEEPEN_OUTPUT_SERVICES.length, 42);
  assert.equal(new Set(DEEPEN_OUTPUT_SERVICES).size, 42);
  assert.equal(Object.keys(CONNECTED_SERVICE_MODULES).length, 12);
  assert.equal(new Set(Object.keys(CONNECTED_SERVICE_MODULES)).size, 12);
  assert.equal(DEEPEN_OUTPUT_SERVICES.some(code => CONNECTED_SERVICE_MODULES[code]), false);
  for (const code of [...DEEPEN_OUTPUT_SERVICES, ...Object.keys(CONNECTED_SERVICE_MODULES)]) {
    const contract = outputContract(code);
    assert.equal(contract.code, code);
    assert.ok(contract.module);
    assert.ok(contract.output_label);
    assert.ok(contract.route || contract.requires_attachment);
    assert.equal(Object.hasOwn(contract, 'source'), false);
  }
});

test('a deepen service cannot close until its tangible output is recorded and accepted by the requester', t => {
  const f = fixture(t);
  f.add('IT-OUTAGE');
  const requestId = f.inProgress('IT-OUTAGE');
  assert.throws(() => f.tx(() => closeWithEvidence(f.db, f.users.it, requestId, {
    version: f.version(requestId), delivered: 'تجريبي: عولج الانقطاع ووثقت النتيجة كاملة'
  })), code('service_output_required'));

  const attached = f.tx(() => addAttachment(f.db, f.users.it, requestId, {
    version: f.version(requestId), filename: 'outage-close.txt', content: Buffer.from('synthetic outage close report').toString('base64')
  }));
  const attachment = attached.attachments.find(item => item.filename === 'outage-close.txt');
  assert.ok(attachment?.id);
  const output = f.tx(() => recordServiceOutput(f.db, f.users.it, requestId, {
    version: f.version(requestId), attachment_id: attachment.id,
    title: 'تقرير معالجة الانقطاع التجريبي',
    evidence: 'تجريبي: يثبت الملف سبب الانقطاع والإجراء التصحيحي ونتيجة التحقق'
  }));
  assert.equal(output.status, 'submitted');
  const decision = obligations(f.db, f.users.employee).items.find(item => item.source === 'requests' && item.id === requestId && item.action_keys.includes('accept_output'));
  assert.ok(decision, 'the requester sees the submitted output among decisions awaiting them');
  assert.equal(decision.link, `#request/${requestId}`);
  assert.deepEqual(decision.action_keys, ['accept_output', 'reject_output']);
  assert.equal(serviceOutputView(f.db, f.users.employee, requestId).closure_ready, false);
  assert.throws(() => f.tx(() => decideServiceOutput(f.db, f.users.it, output.id, {
    version: output.version, decision: 'accept', note: 'أقبل ما سجلته بنفسي'
  })), code('requester_only'));
  const accepted = f.tx(() => decideServiceOutput(f.db, f.users.employee, output.id, {
    version: output.version, decision: 'accept', note: 'تجريبي: تحقق الدخول واستقرار الخدمة بعد المعالجة'
  }));
  assert.equal(accepted.status, 'accepted');
  assert.equal(obligations(f.db, f.users.employee).items.some(item => item.source === 'requests' && item.id === requestId && item.action_keys.includes('accept_output')), false);
  assert.equal(serviceOutputView(f.db, f.users.employee, requestId).closure_ready, true);

  const closed = f.tx(() => closeWithEvidence(f.db, f.users.it, requestId, {
    version: f.version(requestId), delivered: 'تجريبي: عولج الانقطاع وسُلّم تقريره وقبله صاحب الطلب'
  }));
  assert.equal(closed.request.status, 'completed');
  assert.equal(serviceOutputView(f.db, f.users.employee, requestId).round, 1);
  assert.equal(serviceOutputView(f.db, f.users.employee, requestId).closure_ready, true);
  assert.throws(() => f.db.prepare("UPDATE service_outputs SET title='تعديل صامت' WHERE id=?").run(output.id), /immutable|final/i);
  assert.ok(verifyAudit(f.db));
});

test('the HTTP workflow records and decides an output, then exposes the closure gate in request detail', async t => {
  const f = fixture(t);
  f.add('IT-OUTAGE');
  const requestId = f.inProgress('IT-OUTAGE');
  const attached = f.tx(() => addAttachment(f.db, f.users.it, requestId, {
    version: f.version(requestId), filename: 'http-close.txt', content: Buffer.from('synthetic HTTP close report').toString('base64')
  }));
  const attachment = attached.attachments.find(item => item.filename === 'http-close.txt');

  const server = createApp(f.db);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const login = async username => {
    const response = await fetch(base + '/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password: 'synthetic-service-output-contracts' }) });
    assert.equal(response.status, 200, username);
    const body = await response.json();
    return { cookie: response.headers.get('set-cookie').split(';')[0], csrf: body.csrf };
  };
  const sessions = { it: await login('it'), employee: await login('employee') };
  const call = async (who, path, method = 'GET', body) => {
    const response = await fetch(base + '/api' + path, { method, headers: { cookie: sessions[who].cookie, 'x-csrf-token': sessions[who].csrf, 'Content-Type': 'application/json', 'Idempotency-Key': randomUUID() }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { status: response.status, body: await response.json() };
  };

  const recorded = await call('it', `/requests/${requestId}/outputs`, 'POST', {
    version: f.version(requestId), attachment_id: attachment.id, title: 'تقرير إغلاق الانقطاع عبر الواجهة',
    evidence: 'تجريبي: مرجع فعلي محفوظ أُرسل من مسار واجهة البرمجة إلى صاحب الطلب'
  });
  assert.equal(recorded.status, 201);
  assert.equal(recorded.body.status, 'submitted');
  const accepted = await call('employee', `/service-outputs/${recorded.body.id}/accept`, 'POST', {
    version: recorded.body.version, note: 'تجريبي: راجعت المرفق وتحققت من عودة الخدمة واستقرارها'
  });
  assert.equal(accepted.status, 201);
  const detail = await call('employee', `/requests/${requestId}`);
  assert.equal(detail.status, 200);
  assert.equal(detail.body.delivery_outputs.closure_ready, true);
  assert.equal(detail.body.delivery_outputs.accepted.id, recorded.body.id);
});

test('a connected service accepts only a real record from its existing module and tenant', t => {
  const f = fixture(t);
  f.add('HR-JOB-CHANGE', 'hr', 'hr');
  const requestId = f.inProgress('HR-JOB-CHANGE');
  assert.equal(outputContract('HR-JOB-CHANGE').module, 'employees');
  assert.throws(() => f.tx(() => recordServiceOutput(f.db, f.users.hr, requestId, {
    version: f.version(requestId), record_id: 'missing-record', title: 'تغيير وظيفي وهمي',
    evidence: 'تجريبي: هذا المرجع غير موجود ويجب ألا يمر بوابة الإغلاق'
  })), code('output_record_not_found'));

  f.db.prepare(`INSERT INTO employee_changes(id,tenant_id,user_id,change_type,from_value,to_value,effective_from,reason,request_id,created_by,created_at)
    VALUES('job-change-output','36t','employee','job_title','مصمم','مصمم أول','2026-11-01','تجريبي: تغيير وظيفي معتمد',?,'hr','2026-10-02T06:00:00.000Z')`).run(requestId);
  const output = f.tx(() => recordServiceOutput(f.db, f.users.hr, requestId, {
    version: f.version(requestId), record_id: 'job-change-output', title: 'تغيير وظيفي مسجل',
    evidence: 'تجريبي: رُبط الطلب بحركة الموظف المحفوظة في وحدة بيانات الموظفين'
  }));
  assert.equal(output.module, 'employees');
  assert.equal(output.record_id, 'job-change-output');
  assert.throws(() => f.db.prepare("UPDATE service_outputs SET record_id='other' WHERE id=?").run(output.id), /immutable|final/i);
  assert.ok(verifyAudit(f.db));
});
