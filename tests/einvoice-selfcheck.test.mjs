import test from 'node:test';
import assert from 'node:assert/strict';
import { verifyAudit } from '../app/db.mjs';
import { einvoiceSelfcheck,STATUS_NAMES } from '../app/einvoice-selfcheck.mjs';
import { EInvoiceGateway,setGateway,NOT_CONNECTED } from '../app/einvoice-gateway.mjs';
import { code,fixture } from './einvoice-fixture.mjs';

const byKey=report=>Object.fromEntries(report.items.map(i=>[i.key,i]));

test('every control carries one of four verdicts and evidence from the code, and the report never claims compliance',t=>{
  const {db,users,claimFor,issue}=fixture(t);issue(claimFor(0,'115.00'));
  const report=einvoiceSelfcheck(db,users.manager);
  assert.match(report.disclaimer,/ليس شهادة توافق/);assert.equal(report.connection_state,NOT_CONNECTED);
  assert.deepEqual(Object.values(STATUS_NAMES),['مستوفى','غير مستوفى','لا ينطبق','لم يُتحقق منه']);
  for(const key of ['invoice_delete','counter_reset_or_gap','anonymous_or_default_password','session_lifecycle','backdated_issue','system_clock','audit_coverage'])assert.ok(report.items.some(i=>i.key===key),key);
  for(const i of report.items){
    assert.ok(Object.keys(STATUS_NAMES).includes(i.status),i.key);assert.equal(i.status_name,STATUS_NAMES[i.status]);
    assert.ok(i.evidence.length>=1&&i.evidence.every(line=>typeof line==='string'&&line.length>10),`${i.key} names its evidence`);
    assert.ok(i.note.length>5);
  }
  assert.equal(Object.values(report.summary).reduce((a,b)=>a+b,0),report.items.length);
  assert.ok(verifyAudit(db));
});

test('the verdicts match what the platform really does: deletion and counter reset fail, and what was not checked is not guessed',t=>{
  const {db,users,claimFor,issue}=fixture(t);const invoice=issue(claimFor(0,'115.00'));
  const items=byKey(einvoiceSelfcheck(db,users.manager));
  assert.equal(items.invoice_delete.status,'met');
  assert.throws(()=>db.prepare('DELETE FROM tax_invoices WHERE id=?').run(invoice.id),/retained/,'the claim is true in the database');
  assert.equal(items.issued_invoice_update.status,'met');
  assert.equal(items.counter_reset_or_gap.status,'met');
  assert.throws(()=>db.prepare("UPDATE einvoice_counters SET last_sequence=last_sequence-1 WHERE tenant_id='36t'").run(),/never resets|CHECK/);
  assert.equal(items.hash_chain.status,'met');
  assert.equal(items.anonymous_or_default_password.status,'met');
  assert.equal(items.session_lifecycle.status,'met');assert.match(items.session_lifecycle.note,/الخمول/,'the known limit is stated, not hidden');
  assert.equal(items.backdated_issue.status,'met');
  assert.equal(items.system_clock.status,'not_verified','the host clock is outside the platform and is not guessed');
  assert.equal(items.audit_coverage.status,'not_met','reads, prints and exports leave no audit trace, and the report says so');
  assert.match(items.audit_coverage.evidence.join('\n'),/getInvoice/);
  assert.equal(items.no_stored_secrets.status,'met');assert.equal(items.archive_and_queue.status,'met');
});

test('the report is computed from the live schema: a removed guard or a tampered document turns its control to not met',t=>{
  const {db,users,claimFor,issue}=fixture(t);const invoice=issue(claimFor(0,'115.00'));
  db.exec('DROP TRIGGER tax_invoices_no_delete; DROP TRIGGER einvoice_counter_never_resets; DROP TRIGGER tax_invoices_fixed;');
  db.prepare('UPDATE tax_invoices SET total_minor=total_minor+100,net_minor=net_minor+100 WHERE id=?').run(invoice.id);
  const items=byKey(einvoiceSelfcheck(db,users.manager));
  assert.equal(items.invoice_delete.status,'not_met');assert.equal(items.counter_reset_or_gap.status,'not_met');
  assert.equal(items.issued_invoice_update.status,'not_met');
  assert.equal(items.hash_chain.status,'not_met','an edit made outside the platform breaks the chain and shows');
  assert.equal(items.archive_and_queue.status,'met','the archived copy is untouched by the tampering');
});

test('an injected gateway is reported as such, and the report needs the einvoice capability inside its own tenant',t=>{
  const {db,users}=fixture(t);
  setGateway(new EInvoiceGateway('scripted-test'));
  const injected=byKey(einvoiceSelfcheck(db,users.manager)).no_stored_secrets;
  assert.equal(injected.status,'not_met');assert.match(injected.evidence.join('\n'),/scripted-test/);
  setGateway(null);
  for(const who of ['outsider','hr','it'])assert.throws(()=>einvoiceSelfcheck(db,users[who]),code('not_permitted'),who);
  assert.throws(()=>einvoiceSelfcheck(db,{id:'manager',tenant_id:'isolated'}),code('forbidden'));
  const foreign=byKey(einvoiceSelfcheck(db,users.external));
  assert.match(foreign.audit_coverage.evidence.join('\n'),/لا شيء بعد/,'another tenant sees none of this tenant audit actions');
});
