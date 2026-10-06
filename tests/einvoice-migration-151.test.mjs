import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { openDb, transaction } from '../app/db.mjs';
import { getInvoice, prepareInvoice } from '../app/invoices.mjs';
import { fixture } from './einvoice-fixture.mjs';

// الترحيل 151 يعيد بناء جدول المستندات الضريبية ليوسّع قيد النسبة ويضيف رموز المستند. وإعادة البناء
// تُسقط كل فهرس ومحفّز على الجدول، وغياب واحد منها يفتح ما كان مغلقًا ولا يُخبر أحدًا. فهذا الملف
// يقيس المخطط الحيّ بعد الترحيل لا الملف الذي كُتب: ما الذي بقي، وما الذي صار القيد يقبله ويرفضه.
const TABLE_TRIGGERS=['tax_invoices_fixed','tax_invoices_no_delete','tax_invoices_gapless',
  'einvoice_sequence_monotonic','einvoice_sequence_advance','einvoice_chain_link','einvoice_issue_archives',
  'tax_invoices_line_unit_code'];
const TABLE_INDEXES=['tax_invoices_sequence','tax_invoices_chain','tax_invoices_number','tax_invoices_one_per_claim'];
// محفّزات على جداول أخرى تقرأ tax_invoices بالاسم: تُسقط قبل إعادة البناء وتعود بنصّها بعده.
const DEPENDENT_TRIGGERS=['billing_drafts_human_issue','billing_drafts_invoice_same_client',
  'einvoice_archive_issued_only','einvoice_submission_issued_only','einvoice_submission_buyer_guard'];

test('migration 151: the database checks clean, and every index and trigger on the rebuilt table is back',t=>{
  const db=openDb(':memory:');t.after(()=>db.close());
  assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check,'ok');
  assert.equal(db.prepare('PRAGMA foreign_key_check').all().length,0);
  assert.ok(db.prepare('SELECT 1 FROM schema_migrations WHERE version=151').get(),'الترحيل مسجَّل');
  const named=(type,name)=>!!db.prepare('SELECT 1 FROM sqlite_master WHERE type=? AND name=?').get(type,name);
  for(const name of TABLE_TRIGGERS)assert.ok(named('trigger',name),`المحفّز ${name} أُعيد إنشاؤه`);
  for(const name of TABLE_INDEXES)assert.ok(named('index',name),`الفهرس ${name} أُعيد إنشاؤه`);
  for(const name of DEPENDENT_TRIGGERS)assert.ok(named('trigger',name),`المحفّز التابع ${name} عاد بنصّه`);
  // الاسم المؤقت لا يبقى له أثر في المخطط، والمفتاح الذاتي يشير إلى الجدول باسمه.
  assert.equal(db.prepare("SELECT name FROM sqlite_master WHERE sql LIKE '%tax_invoices_new%'").all().length,0);
  assert.match(db.prepare("SELECT sql FROM sqlite_master WHERE name='tax_invoices'").get().sql,/original_invoice_id TEXT REFERENCES "?tax_invoices"?\(id\)/);
  // والقيد الموسَّع هو المطبَّق فعلًا، لا الذي في ملف الترحيل وحده.
  const sql=db.prepare("SELECT sql FROM sqlite_master WHERE name='tax_invoices'").get().sql;
  assert.match(sql,/vat_basis_points IN \(0,500,1500\)/);
  assert.ok(!/vat_basis_points IN \(0,1500\)/.test(sql),'القيد القديم لم يبقَ');
});

test('migration 151: the constraint accepts only the dated approved rates, and the document codes cannot drift from the document',t=>{
  const {db,users,claimFor}=fixture(t);
  const claim=claimFor(0,'115.00');
  const draft=getInvoice(db,users.employee,transaction(db,()=>prepareInvoice(db,users.employee,{claim_id:claim.id,supply_date:'2026-09-01',vat_category:'standard'})).id);
  assert.deepEqual([draft.vat_basis_points,draft.document_type_code,draft.tax_category_code,draft.payment_means_code],[1500,'388','S','1']);
  const set=(column,value)=>db.prepare(`UPDATE tax_invoices SET ${column}=?,version=version+1 WHERE id=?`).run(value,draft.id);
  // نسبة ليست من الجدول المؤرَّخ: مرفوضة في SQL لا في الكود وحده.
  assert.throws(()=>set('vat_basis_points',1000),/CHECK constraint failed/);
  assert.throws(()=>set('vat_basis_points',2000),/CHECK constraint failed/);
  // والمؤرَّختان مقبولتان: 5% و15%.
  assert.doesNotThrow(()=>set('vat_basis_points',500));
  assert.doesNotThrow(()=>set('vat_basis_points',1500));
  // الرموز مشتقّة من المستند، فلا تُكتب قيمة تخالف نوعه أو تصنيفه.
  assert.throws(()=>set('document_type_code','381'),/CHECK constraint failed/);
  assert.throws(()=>set('tax_category_code','Z'),/CHECK constraint failed/);
  assert.throws(()=>set('payment_means_code','30'),/CHECK constraint failed/);
});

test('migration 151: a document line without a unit code is refused by the database itself',t=>{
  const {db,users,claimFor}=fixture(t);
  const claim=claimFor(0,'115.00');
  const draft=getInvoice(db,users.employee,transaction(db,()=>prepareInvoice(db,users.employee,{claim_id:claim.id,supply_date:'2026-09-01',vat_category:'standard'})).id);
  assert.ok(JSON.parse(db.prepare('SELECT lines FROM tax_invoices WHERE id=?').get(draft.id).lines).every(l=>l.unit_code==='C62'));
  const copy=lines=>db.prepare(`INSERT INTO tax_invoices(id,tenant_id,kind,claim_id,project_id,supply_date,seller,buyer,lines,vat_category,vat_basis_points,vat_reason,currency,net_minor,vat_minor,total_minor,document_type_code,tax_category_code,payment_means_code,status,prepared_by,created_at,updated_at)
    SELECT ?,tenant_id,kind,claim_id,project_id,supply_date,seller,buyer,${lines},vat_category,vat_basis_points,vat_reason,currency,net_minor,vat_minor,total_minor,document_type_code,tax_category_code,payment_means_code,'rejected',prepared_by,created_at,updated_at FROM tax_invoices WHERE id=?`)
    .run(randomUUID(),draft.id);
  assert.throws(()=>copy("json_remove(lines,'$[0].unit_code')"),/every tax document line carries a unit code/);
  assert.doesNotThrow(()=>copy('lines'));
});
