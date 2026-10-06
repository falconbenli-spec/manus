import test from 'node:test';
import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
import { transaction,now,verifyAudit } from '../app/db.mjs';
import { getInvoice,prepareCreditNote,invoiceAction,verifyInvoiceChain } from '../app/invoices.mjs';
import { EInvoiceGateway,DisconnectedGateway,gateway,setGateway,einvoiceBoard,assignChannel,attemptSubmission,refreshSubmissionStatus,recordBuyerOverride,buyerReadiness,assertBuyerReady,buyerGaps,backoffMinutes,BACKOFF_CAP_MINUTES,REJECTION_POLICY,NOT_CONNECTED } from '../app/einvoice-gateway.mjs';
import { code,address,fixture,ScriptedGateway } from './einvoice-fixture.mjs';

test('the only built-in gateway is disconnected: it refuses all three calls, sends nothing, and says so',async()=>{
  assert.ok(gateway() instanceof DisconnectedGateway);assert.equal(gateway().name,'disconnected');
  for(const call of [gateway().submitForClearance({}),gateway().reportSimplified({}),gateway().statusOf('ref')]){
    const result=await call;
    assert.equal(result.outcome,'refused');assert.equal(result.reference,'');assert.ok(result.message.includes(NOT_CONNECTED));
  }
  const fake=new EInvoiceGateway('fake');setGateway(fake);assert.equal(gateway(),fake);
  setGateway(null);assert.ok(gateway() instanceof DisconnectedGateway,'clearing the injection returns to disconnected');
  assert.equal(REJECTION_POLICY.status,'proposed','the rejection behaviour is a proposal, never a settled rule');
  assert.match(REJECTION_POLICY.needs,/المختص الضريبي/);
});

test('issuing a document archives it and queues it in the same statement, and the archive can never be edited or deleted',t=>{
  const {db,users,claimFor,issue}=fixture(t);
  const invoice=issue(claimFor(0,'115.00')),board=einvoiceBoard(db,users.manager);
  assert.equal(board.connected,false);assert.equal(board.state,'disconnected');assert.equal(board.disclaimer,NOT_CONNECTED);
  assert.equal(board.archive_count,1);assert.equal(board.chain_valid,true);
  const archived=db.prepare('SELECT * FROM einvoice_archive WHERE document_id=?').get(invoice.id),payload=JSON.parse(archived.payload);
  assert.equal(archived.format,'platform-json-v1');assert.equal(archived.document_hash,invoice.hash);assert.equal(archived.number,invoice.number);
  assert.deepEqual([payload.total_minor,payload.buyer.vat_number,payload.qr_tlv],[11500,'310000000000003',invoice.qr_tlv]);
  assert.throws(()=>db.prepare("UPDATE einvoice_archive SET payload='{}' WHERE document_id=?").run(invoice.id),/never modified/);
  assert.throws(()=>db.prepare('DELETE FROM einvoice_archive WHERE document_id=?').run(invoice.id),/never deleted/);
  assert.throws(()=>db.prepare("INSERT INTO einvoice_archive SELECT 'forged',tenant_id,kind,original_document_id,'INV-X',9,9,issued_at,format,payload,previous_hash,document_hash,qr_tlv,archived_at FROM einvoice_archive").run(),/exactly as issued|FOREIGN KEY/);
  const [queued]=board.submissions;
  assert.equal(queued.status,'queued');assert.equal(queued.attempts,0);assert.equal(queued.channel,null);assert.match(queued.id,/^[a-f0-9-]{36}$/);
  assert.match(queued.reason,/غير مربوط/);assert.deepEqual(queued.actions,['assign_channel']);
  assert.throws(()=>db.prepare('DELETE FROM einvoice_submissions WHERE id=?').run(queued.id),/retained/);
});

test('the counter never resets, never skips and never goes back, and the hash chain link is enforced by the database itself',t=>{
  const {db,users,claimFor,issue,pending}=fixture(t);
  const first=issue(claimFor(0,'115.00'));
  const counter=()=>db.prepare("SELECT last_sequence,last_document_id FROM einvoice_counters WHERE tenant_id='36t' AND kind='invoice'").get();
  assert.deepEqual({...counter()},{last_sequence:1,last_document_id:first.id});
  assert.throws(()=>db.prepare("UPDATE einvoice_counters SET last_sequence=1 WHERE tenant_id='36t'").run(),/never resets/);
  assert.throws(()=>db.prepare("UPDATE einvoice_counters SET last_sequence=7 WHERE tenant_id='36t'").run(),/never resets/);
  assert.throws(()=>db.prepare("DELETE FROM einvoice_counters WHERE tenant_id='36t'").run(),/never resets/);
  const waiting=pending(claimFor(1,'230.00')),time=now();
  const forge=(sequence,chainIndex,previous)=>db.prepare("UPDATE tax_invoices SET status='issued',chain_index=?,sequence=?,number=?,issued_at=?,issued_by='manager',previous_hash=?,hash='forged-hash',qr_tlv='forged',version=version+1,updated_at=? WHERE id=?").run(chainIndex,sequence,'INV-FORGED-'+sequence,time,previous,time,waiting.id);
  assert.throws(()=>forge(5,2,first.hash),/sequential/,'a skipped number is refused');
  assert.throws(()=>forge(1,2,first.hash),/sequential|UNIQUE/,'a reused number is refused');
  assert.throws(()=>forge(2,2,'not-the-previous-hash'),/hash chain/,'a document that does not link to its predecessor is refused');
  assert.throws(()=>forge(2,9,first.hash),/hash chain/,'a chain position cannot be chosen');
  const second=transaction(db,()=>invoiceAction(db,users.manager,waiting.id,'issue',{version:waiting.version}));
  assert.equal(second.sequence,2);assert.equal(second.previous_hash,first.hash);assert.equal(counter().last_sequence,2);
  assert.equal(verifyInvoiceChain(db,'36t'),true);assert.notEqual(first.id,second.id);assert.match(second.id,/^[a-f0-9-]{36}$/);
});

test('whoever classifies the channel never performs the attempt, the channel is fixed once set, and a stale version is refused',async t=>{
  const {db,users,claimFor,issue,submissionOf,channel,attempt}=fixture(t);
  const invoice=issue(claimFor(0,'115.00')),fresh=submissionOf(invoice);
  await assert.rejects(attempt(fresh,'manager'),code('attempt_denied'),'no attempt before a person names the channel');
  assert.throws(()=>transaction(db,()=>assignChannel(db,users.employee,fresh.id,{version:fresh.version,channel:'guess',reason:'قناة لا تعرفها المنصة إطلاقًا'})),code('channel'));
  assert.throws(()=>transaction(db,()=>assignChannel(db,users.employee,fresh.id,{version:fresh.version,channel:'clearance',reason:'قصير'})),code('invalid_text'));
  const classified=channel(invoice,'employee');
  assert.equal(classified.channel,'clearance');assert.equal(classified.channel_by,'employee');assert.deepEqual(classified.actions,[],'the classifier sees no attempt action');
  assert.deepEqual(submissionOf(invoice).actions,['attempt_submission']);
  await assert.rejects(attempt(classified,'employee'),code('attempt_denied'));
  assert.throws(()=>transaction(db,()=>assignChannel(db,users.manager,classified.id,{version:classified.version,channel:'reporting',reason:'محاولة تغيير القناة بعد تحديدها'})),code('channel_set'));
  // القاعدتان مفروضتان في SQL أيضًا، لا في الكود وحده.
  assert.throws(()=>db.prepare("UPDATE einvoice_submissions SET attempts=1,last_attempt_at=?,last_attempt_by='employee',version=version+1 WHERE id=?").run(now(),classified.id),/append-only/);
  assert.throws(()=>db.prepare("UPDATE einvoice_submissions SET channel='reporting',version=version+1 WHERE id=?").run(classified.id),/append-only/);
  await assert.rejects(attempt({...classified,version:classified.version-1},'manager'),code('stale_version'));
  assert.throws(()=>assignChannel(db,users.employee,fresh.id,{version:1,channel:'clearance',reason:'كتابة خارج معاملة قاعدة البيانات'}),code('transaction_required'));
});

test('today an attempt sends nothing: the refusal is logged with its reason and the next attempt backs off exponentially',async t=>{
  const {db,users,claimFor,issue,channel,attempt}=fixture(t);
  const invoice=issue(claimFor(0,'115.00'));
  let s=channel(invoice,'employee');
  const delays=[];
  for(let n=1;n<=3;n++){
    const before=Date.now();s=await attempt(s,'manager');
    assert.equal(s.status,'queued');assert.equal(s.attempts,n);assert.equal(s.provider,'disconnected');assert.equal(s.provider_reference,'');
    assert.match(s.reason,/غير مربوط/);assert.equal(s.last_attempt_by,'manager');
    delays.push(Math.round((Date.parse(s.next_attempt_at)-before)/60000));
  }
  assert.deepEqual(delays,[5,10,20]);
  assert.deepEqual([1,2,3,4,9,40].map(backoffMinutes),[5,10,20,40,1280,BACKOFF_CAP_MINUTES]);
  const log=db.prepare('SELECT attempt_no,operation,provider,outcome FROM einvoice_attempts WHERE submission_id=? ORDER BY attempt_no').all(s.id).map(r=>({...r}));
  assert.deepEqual(log,[1,2,3].map(attempt_no=>({attempt_no,operation:'submitForClearance',provider:'disconnected',outcome:'refused'})));
  assert.throws(()=>db.prepare("UPDATE einvoice_attempts SET outcome='accepted' WHERE submission_id=?").run(s.id),/immutable/);
  assert.throws(()=>db.prepare('DELETE FROM einvoice_attempts WHERE submission_id=?').run(s.id),/retained/);
  assert.equal(getInvoice(db,users.employee,invoice.id).reporting_status,'not_reported','the invoice itself never claims to be reported');
  assert.ok(verifyAudit(db));
});

test('an injected gateway drives every queue state, a decision is final, and a rejected document keeps its number and its place in the counter',async t=>{
  const {db,users,claimFor,issue,channel,attempt,submissionOf}=fixture(t);
  const first=issue(claimFor(0,'115.00'));
  const scripted=new ScriptedGateway([new Error('network down (synthetic)'),{outcome:'pending',reference:'REF-TEST-1',message:'استلم المزوّد التجريبي المستند'},{outcome:'pending',message:'ما زال قيد المعالجة تجريبيًا'},{outcome:'rejected',message:'رفض تجريبي: حقل ناقص في المستند'}]);
  setGateway(scripted);
  let s=channel(first,'employee');
  s=await attempt(s,'manager');
  assert.equal(s.status,'failed');assert.match(s.reason,/network down/);assert.ok(s.next_attempt_at,'a failure schedules a retry');
  s=await attempt(s,'manager');
  assert.equal(s.status,'sent');assert.equal(s.provider_reference,'REF-TEST-1');assert.equal(s.next_attempt_at,null);assert.deepEqual(s.actions,['refresh_status']);
  assert.equal(scripted.calls[1].argument.document_hash,first.hash,'the gateway receives the archived copy, not a rebuilt one');
  const refresh=row=>refreshSubmissionStatus(db,users.manager,row.id,{version:row.version,note:'استعلام تجريبي عن حالة المستند'},transaction);
  s=await refresh(s);assert.equal(s.status,'sent');
  s=await refresh(s);
  assert.equal(s.status,'rejected');assert.match(s.reason,/رفض تجريبي/);assert.deepEqual(s.actions,[]);
  assert.deepEqual(scripted.calls.map(c=>c.operation),['submitForClearance','submitForClearance','statusOf','statusOf']);
  await assert.rejects(attempt(s,'manager'),code('attempt_denied'));
  assert.throws(()=>db.prepare("UPDATE einvoice_submissions SET status='queued',reason='إعادة فتح قرار نهائي تجريبيًا',version=version+1 WHERE id=?").run(s.id),/final/);
  // سلوك الرفض المقترح: الرقم يبقى مستهلكًا، والمستند يبقى صادرًا ومؤرشفًا، والتالي يأخذ الرقم التالي بلا فجوة.
  const kept=getInvoice(db,users.employee,first.id);
  assert.equal(kept.status,'issued');assert.equal(kept.sequence,1);
  setGateway(new ScriptedGateway([{outcome:'accepted_with_warnings',reference:'REF-TEST-2',message:'قبول تجريبي مع تحذير شكلي'}]));
  const second=issue(claimFor(1,'230.00'));
  assert.equal(second.sequence,2);
  const accepted=await attempt(channel(second,'employee','reporting'),'manager');
  assert.equal(accepted.status,'accepted_with_warnings');assert.equal(accepted.channel,'reporting');
  assert.deepEqual(einvoiceBoard(db,users.manager).counts,{queued:0,sent:0,accepted:0,accepted_with_warnings:1,rejected:1,failed:0});
  assert.equal(submissionOf(first).attempts_log.length,4);
  assert.ok(verifyAudit(db));
});

test('a buyer with missing tax data blocks the attempt until a documented override is recorded, and the override is permanent',async t=>{
  const {db,users,claimFor,issue,channel,attempt,caseId}=fixture(t,{buyerVat:''});
  assert.deepEqual(buyerGaps({vat_number:null,address:{...address,city:' '}}),['vat_number','city']);
  assert.deepEqual(buyerGaps({vat_number:'310000000000003',address}),[]);
  const state=buyerReadiness(db,users.employee,caseId());
  assert.equal(state.ready,false);assert.deepEqual(state.gaps,['vat_number']);assert.equal(state.override,null);
  assert.throws(()=>assertBuyerReady(db,users.employee,caseId()),code('buyer_incomplete'));
  const invoice=issue(claimFor(0,'115.00')),s=channel(invoice,'employee');
  assert.deepEqual(s.buyer_gaps,['الرقم الضريبي للمشتري']);
  await assert.rejects(attempt(s,'manager'),code('buyer_incomplete'));
  assert.throws(()=>db.prepare("UPDATE einvoice_submissions SET attempts=1,last_attempt_at=?,last_attempt_by='manager',version=version+1 WHERE id=?").run(now(),s.id),/documented override/);
  assert.throws(()=>transaction(db,()=>recordBuyerOverride(db,users.manager,{case_id:caseId(),reason:'قصير'})),code('invalid_text'));
  const override=transaction(db,()=>recordBuyerOverride(db,users.manager,{case_id:caseId(),reason:'العميل فرد غير مسجل في الضريبة بحسب إفادة المختص الضريبي التجريبي'}));
  assert.deepEqual(override.missing,['vat_number']);
  assert.equal(assertBuyerReady(db,users.employee,caseId()).override.recorded_by_name,'مدير الفريق التجريبي');
  assert.throws(()=>db.prepare("UPDATE einvoice_buyer_overrides SET reason='سبب آخر مكتوب لاحقًا بعد التسجيل' WHERE id=?").run(override.id),/replaced/);
  assert.throws(()=>db.prepare('DELETE FROM einvoice_buyer_overrides WHERE id=?').run(override.id),/retained/);
  const tried=await attempt(s,'manager');
  assert.equal(tried.attempts,1);assert.equal(tried.override_reason.includes('غير مسجل'),true);
  assert.ok(verifyAudit(db));
});

test('a complete buyer needs no override, and a credit note is archived with the reference of its original invoice',t=>{
  const {db,users,claimFor,issue,step,caseId}=fixture(t);
  assert.equal(assertBuyerReady(db,users.employee,caseId()).ready,true);
  assert.throws(()=>transaction(db,()=>recordBuyerOverride(db,users.manager,{case_id:caseId(),reason:'تجاوز لا حاجة له لأن البيانات مكتملة أصلًا'})),code('buyer_complete'));
  const invoice=issue(claimFor(0,'115.00'));
  const draft=getInvoice(db,users.employee,transaction(db,()=>prepareCreditNote(db,users.employee,invoice.id,{amount:'15.00',reason:'خصم تجريبي متفق عليه بعد المراجعة'})).id);
  const note=step('manager',step('employee',draft,'submit'),'issue');
  const archived=db.prepare('SELECT kind,original_document_id,previous_hash FROM einvoice_archive WHERE document_id=?').get(note.id);
  assert.deepEqual({...archived},{kind:'credit_note',original_document_id:invoice.id,previous_hash:invoice.hash});
  assert.equal(db.prepare("SELECT last_sequence FROM einvoice_counters WHERE tenant_id='36t' AND kind='credit_note'").get().last_sequence,1,'each kind has its own counter');
  assert.throws(()=>db.prepare("INSERT INTO einvoice_archive SELECT 'x',tenant_id,'credit_note',NULL,'CN-X',2,9,issued_at,format,payload,previous_hash,document_hash,qr_tlv,archived_at FROM einvoice_archive WHERE document_id=?").run(note.id),/CHECK|FOREIGN KEY|exactly as issued/);
  assert.equal(einvoiceBoard(db,users.manager).submissions.length,2,'the credit note is queued like the invoice');
});

test('the screen needs the einvoice capability, and another tenant sees and touches nothing',async t=>{
  const {db,users,claimFor,issue,submissionOf,caseId}=fixture(t);
  const invoice=issue(claimFor(0,'115.00')),s=submissionOf(invoice);
  for(const who of ['outsider','hr','it'])assert.throws(()=>einvoiceBoard(db,users[who]),code('not_permitted'),who);
  assert.throws(()=>transaction(db,()=>assignChannel(db,users.outsider,s.id,{version:s.version,channel:'clearance',reason:'محاولة بلا تصريح للفوترة الإلكترونية'})),code('not_permitted'));
  await assert.rejects(attemptSubmission(db,users.hr,s.id,{version:s.version,note:'محاولة بلا تصريح للفوترة الإلكترونية'},transaction),code('not_permitted'));
  assert.throws(()=>einvoiceBoard(db,users.admin),code('not_permitted'),'a sensitive screen needs an explicit grant, even for the first admin');
  // المانح غير الممنوح — قيد الترحيل 144؛ التهيئة كانت تكتب الاثنين واحدًا وهي حالة لا تقع.
  // الممنوح هنا هو admin نفسه، فالمانح حساب مبذور آخر (hr) لا admin.
  db.prepare('INSERT INTO access_grants(id,tenant_id,user_id,capability,note,granted_by,granted_at) VALUES(?,?,?,?,?,?,?)').run(randomUUID(),'36t','admin','einvoice.manage','منح صريح تجريبي','hr',new Date().toISOString());
  assert.equal(einvoiceBoard(db,users.admin).submissions.length,1,'with the explicit grant the first admin reads the board');
  const foreign=einvoiceBoard(db,users.external);
  assert.deepEqual([foreign.submissions.length,foreign.archive.length,foreign.counters.length,foreign.customers.length],[0,0,0,0]);
  assert.throws(()=>transaction(db,()=>assignChannel(db,users.external,s.id,{version:s.version,channel:'clearance',reason:'كيان آخر يحاول تصنيف مستند ليس له'})),code('not_found'));
  assert.throws(()=>transaction(db,()=>recordBuyerOverride(db,users.external,{case_id:caseId(),reason:'كيان آخر يحاول تسجيل تجاوز لعميل ليس له'})),code('not_found'));
  assert.throws(()=>einvoiceBoard(db,{id:'manager',tenant_id:'isolated'}),code('forbidden'));
  assert.ok(verifyAudit(db));
});
