import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { openDb, transaction, now, verifyAudit } from '../app/db.mjs';
import { seed } from '../scripts/seed.mjs';
import { grantAccess } from '../app/access.mjs';
import { operationFields, money } from '../app/static/operations.mjs';
import { vatWorksheetUI, withholdingUI } from '../app/static/tax-returns-ui.mjs';
import { vatBoard, withholdingBoard, getVatWorksheet, recordRateSetting, confirmRateSetting, createVatWorksheet, saveVatWorksheet, vatWorksheetAction,
  nameExportBoxes, exportVatWorksheet, recordWithholding, withholdingAction, createZakatWorksheet, saveZakatLines, zakatAction, rateAt, DISCLAIMER } from '../app/tax-returns.mjs';

const code=value=>error=>error.code===value;
const PERIOD={period_start:'2026-04-01',period_end:'2026-06-30'};
const FIGURES={sales_standard:'0',output_vat:'0',sales_zero_rated:'0',sales_exempt:'0',sales_out_of_scope:'0',purchases:'0',input_vat:'0',adjustments:'0',adjustments_note:'',reconciliation_note:''};

function fixture(t){
  const db=openDb(':memory:');seed(db,'synthetic-tax-returns');t.after(()=>db.close());
  const users=Object.fromEntries(db.prepare('SELECT * FROM users').all().map(u=>[u.id,u])),tx=f=>transaction(db,f);
  // معدّة الورقة ومراجعها شخصان مختلفان: هذا ما تحميه أغلب اختبارات هذا الملف.
  tx(()=>grantAccess(db,users.admin,{user_id:'employee',capability:'tax.returns.prepare',note:'تصريح إعداد مصطنع'}));
  tx(()=>grantAccess(db,users.admin,{user_id:'manager',capability:'tax.returns.review',note:'تصريح مراجعة مصطنع'}));
  // حامل التصريح نفسه في كيان آخر: العزل يُختبر بصلاحية كاملة لا بغياب الصلاحية.
  // المانح غير الممنوح — قيد الترحيل 144؛ التهيئة كانت تكتب الاثنين واحدًا وهي حالة لا تقع.
  for(const capability of ['tax.returns.prepare','tax.returns.review'])
    db.prepare('INSERT INTO access_grants(id,tenant_id,user_id,capability,note,granted_by,granted_at) VALUES(?,?,?,?,?,?,?)').run(randomUUID(),'isolated','external',capability,'تصريح كيان معزول مصطنع','admin',now());
  return {db,users,tx};
}
// نسبة مؤرّخة مؤكدة جاهزة للاستعمال.
function rate(db,users,tx,{kind='vat',category='standard',label='الأساسية',percent='15',effective_from='2026-01-01'}={}){
  const id=tx(()=>recordRateSetting(db,users.employee,{kind,category,label,percent,effective_from,source:'خطاب مصطنع من مختص ضريبي محفوظ في ملف الالتزامات',confirmed_on:'2026-01-05',specialist_name:'مختص ضريبي مصطنع'})).id;
  const setting=db.prepare('SELECT version FROM tax_rate_settings WHERE id=?').get(id);
  tx(()=>confirmRateSetting(db,users.manager,id,{version:setting.version,note:'طابقت الخطاب المصطنع وتاريخ سريانه'}));
  return id;
}
// دفتر مصطنع: فاتورة ضريبية صادرة واحدة بسلسلتها الدنيا. نسبة 1500 هنا من قيد جدول tax_invoices القائم لا من وحدة الضرائب.
function ledgerRow(db,{claim,sequence,chain,kind='invoice',category='standard',net,vat,supply_date,original=null}){
  const time=now(),invoiceId=randomUUID();
    // الترحيل 151 أضاف رموز المستند إلزاميةً على tax_invoices (نوع المستند وفئة الضريبة ووسيلة السداد)،
  // فالإدراج المباشر في هذا الاختبار يحملها كما يحملها مسار prepareInvoice الحقيقي.
db.prepare(`INSERT INTO tax_invoices(id,tenant_id,kind,claim_id,original_invoice_id,project_id,sequence,number,issued_at,supply_date,seller,buyer,lines,vat_category,vat_basis_points,vat_reason,currency,net_minor,vat_minor,total_minor,reason,document_type_code,tax_category_code,payment_means_code,status,prepared_by,issued_by,chain_index,previous_hash,hash,qr_tlv,version,created_at,updated_at)
    VALUES(?,'36t',?,?,?,'p1',?,?,?,?,'{}','{}','[]',?,?,?,'SAR',?,?,?,?,${kind==='credit_note'?381:388},'${{standard:'S',zero_rated:'Z',exempt:'E'}[category]??'O'}','1','issued','employee','manager',?,'','${'h'.repeat(8)}'||?,'tlv',1,?,?)`)
    .run(invoiceId,kind,claim,original,sequence,`SYN-${kind}-${sequence}`,time,supply_date,category,category==='standard'?1500:0,category==='standard'?'':'تصنيف مصطنع للاختبار لا يحمل نسبة',net,vat,net+vat,kind==='credit_note'?'إشعار دائن مصطنع للاختبار':'',chain,String(chain),time,time);
  return invoiceId;
}
// سلسلة المصدر التي تفرضها قيود الدفتر: مشروع ← حالة ← تأهيل ← عرض ← عقد ← استحقاقان.
function ledgerSource(db){
  const time=now();
  db.prepare('INSERT INTO projects(id,tenant_id,name,brief,created_by,created_at) VALUES(?,?,?,?,?,?)').run('p1','36t','مشروع ضريبي مصطنع','اختبار ورقة العمل','employee',time);
  db.prepare("INSERT INTO commercial_cases(id,tenant_id,department_id,owner_id,name,registration_number,contact,source,sector,status,project_id,created_at,updated_at) VALUES('c1','36t','creative','employee','عميل مصطنع','SYN-1','جهة مصطنعة','اختبار','تجريبي','project_active','p1',?,?)").run(time,time);
  db.prepare("INSERT INTO commercial_qualifications(id,case_id,revision,snapshot,created_by,created_at) VALUES('q1','c1',1,'{}','employee',?)").run(time);
  db.prepare("INSERT INTO commercial_quotes(id,case_id,qualification_id,revision,snapshot,digest,created_by,created_at) VALUES('o1','c1','q1',1,'{}','synthetic','employee',?)").run(time);
  db.prepare("INSERT INTO commercial_contracts(id,case_id,quote_id,snapshot,agreement_evidence,customer_representative,created_by,created_at) VALUES('k1','c1','o1','{}','اتفاق مصطنع','ممثل مصطنع','employee',?)").run(time);
  for(const [id,amount] of [['cl1','115000'],['cl2','50000']])
    db.prepare("INSERT INTO ar_claims(id,tenant_id,contract_id,project_id,case_id,prepared_by,basis,advance_clause,source_snapshot,currency,amount_minor,due_date,entitlement_evidence,status,version,created_at,updated_at) VALUES(?,'36t','k1','p1','c1','employee','advance','بند دفعة مقدمة مصطنع','{}','SAR',?,'2026-07-01','سند مصطنع','approved',1,?,?)").run(id,amount,time,time);
}

test('tax rates: the platform ships with none, a rate carries its source and confirmation date, the person who enters it does not confirm it, and a period keeps its own rate',t=>{
  const {db,users,tx}=fixture(t);
  const empty=vatBoard(db,users.employee);
  assert.deepEqual(empty.rate_settings,[],'no rate is built into the platform');
  assert.equal(empty.disclaimer,DISCLAIMER);
  assert.match(empty.note,/ورقة عمل للمراجعة، وليست إقرارًا/);
  const input={kind:'vat',category:'standard',label:'الأساسية',percent:'15',effective_from:'2026-01-01',source:'خطاب مصطنع من مختص ضريبي',confirmed_on:'2026-01-05',specialist_name:'مختص مصطنع'};
  assert.throws(()=>tx(()=>recordRateSetting(db,users.manager,input)),code('not_permitted'),'entering a rate needs the prepare capability');
  assert.throws(()=>tx(()=>recordRateSetting(db,users.employee,{...input,source:'قصير'})),code('invalid_text'),'a rate without a written source is refused');
  const first=tx(()=>recordRateSetting(db,users.employee,input)).id;
  assert.equal(rateAt(db,'36t','vat','standard','2026-06-30'),null,'an unconfirmed rate is not used');
  assert.throws(()=>tx(()=>confirmRateSetting(db,users.employee,first,{version:1,note:'أؤكد ما أدخلته بنفسي'})),code('not_permitted'));
  tx(()=>confirmRateSetting(db,users.manager,first,{version:1,note:'طابقت الخطاب المصطنع وتاريخ سريانه'}));
  assert.equal(rateAt(db,'36t','vat','standard','2025-12-31'),null,'a rate never applies before its effective date');
  assert.equal(rateAt(db,'36t','vat','standard','2026-06-30').basis_points,1500);
  // نسبة أحدث لا تُطبَّق بأثر رجعي: كل فترة بنسبتها.
  const second=tx(()=>recordRateSetting(db,users.employee,{...input,percent:'20',effective_from:'2026-08-01',confirmed_on:'2026-07-20'})).id;
  tx(()=>confirmRateSetting(db,users.manager,second,{version:1,note:'طابقت الخطاب الثاني المصطنع'}));
  assert.equal(rateAt(db,'36t','vat','standard','2026-06-30').id,first,'the period keeps its own rate, not today’s');
  assert.equal(rateAt(db,'36t','vat','standard','2026-09-01').id,second);
  assert.throws(()=>db.prepare("UPDATE tax_rate_settings SET basis_points=500,version=version+1 WHERE id=?").run(first),/replaced by a newer dated setting/);
  assert.ok(verifyAudit(db));
});

test('vat worksheet: the preparer never reviews it, an unexplained gap against the ledger blocks closing, and a reviewed worksheet is corrected by a new revision',t=>{
  const {db,users,tx}=fixture(t);
  assert.throws(()=>tx(()=>createVatWorksheet(db,users.manager,PERIOD)),code('not_permitted'));
  const id=tx(()=>createVatWorksheet(db,users.employee,PERIOD)).id;
  assert.throws(()=>tx(()=>createVatWorksheet(db,users.employee,PERIOD)),code('worksheet_open'));
  assert.throws(()=>getVatWorksheet(db,users.external,id),code('not_found'),'another tenant sees nothing');
  assert.throws(()=>vatBoard(db,users.outsider),code('not_permitted'));
  let w=getVatWorksheet(db,users.employee,id);
  assert.equal(w.variance_minor,0);assert.deepEqual(w.actions,['save_worksheet']);
  assert.equal(w.rate,null);assert.match(w.rate_note,/لم تُدخل نسبة مؤرّخة مؤكدة/);
  assert.throws(()=>tx(()=>saveVatWorksheet(db,users.manager,id,{version:w.version,...FIGURES})),code('not_permitted'),'only the preparer edits the draft');
  assert.throws(()=>tx(()=>saveVatWorksheet(db,users.employee,id,{version:w.version+3,...FIGURES})),code('stale_version'));
  // رقم في الورقة لا يقابله رقم في الدفتر: الفرق يظهر، ولا تُقفل الورقة قبل تفسيره.
  assert.throws(()=>tx(()=>saveVatWorksheet(db,users.employee,id,{version:w.version,...FIGURES,sales_standard:'1000.00',output_vat:'150.00'})),code('invalid_text'));
  w=tx(()=>saveVatWorksheet(db,users.employee,id,{version:w.version,...FIGURES,sales_standard:'1000.00',output_vat:'150.00',reconciliation_note:'فواتير مصطنعة لم تُرحَّل بعد إلى الدفتر، مرفقة بكشف يدوي'}));
  assert.equal(w.variance_minor,115000,'the gap is the sum of the line differences, shown and not hidden');
  assert.equal(w.figures.net,15000);
  assert.ok(w.reconciliation.some(l=>l.difference_minor===100000));
  assert.throws(()=>tx(()=>vatWorksheetAction(db,users.employee,id,'review_worksheet',{version:w.version,note:'أراجع ما أعددته بنفسي'})),code('action_unavailable'));
  assert.ok(vatBoard(db,users.manager).inbox.some(x=>x.id===id&&x.actions.includes('review_worksheet')),'the reviewer is told a worksheet awaits them');
  tx(()=>vatWorksheetAction(db,users.manager,id,'review_worksheet',{version:w.version,note:'راجعت الكشف اليدوي مقابل الدفتر وقبلت التسوية'}));
  w=getVatWorksheet(db,users.employee,id);
  assert.equal(w.status,'reviewed');assert.equal(w.reviewed_by,'manager');
  assert.throws(()=>tx(()=>saveVatWorksheet(db,users.employee,id,{version:w.version,...FIGURES})),code('not_draft'));
  assert.throws(()=>db.prepare('UPDATE vat_worksheets SET output_vat_minor=1,version=version+1 WHERE id=?').run(id),/corrected by a new revision/);
  tx(()=>vatWorksheetAction(db,users.manager,id,'record_filing',{version:w.version,filing_reference:'SYN-RET-1',filing_evidence:'قدّمه المختص الضريبي المصطنع وحُفظ الإيصال في ملف الالتزامات'}));
  w=getVatWorksheet(db,users.employee,id);
  assert.equal(w.status,'filed');assert.deepEqual(w.actions,['revise_worksheet']);
  const second=tx(()=>vatWorksheetAction(db,users.employee,id,'revise_worksheet',{version:w.version,note:'ورد كشف إضافي يغيّر أرقام الفترة'})).id;
  assert.equal(getVatWorksheet(db,users.employee,second).revision,2);
  assert.equal(getVatWorksheet(db,users.employee,id).status,'filed','the filed revision stays until the new one is filed');
  let next=tx(()=>saveVatWorksheet(db,users.employee,second,{...FIGURES,version:1,sales_standard:'1200.00',output_vat:'180.00',reconciliation_note:'كشف إضافي مصطنع لم يُرحَّل بعد إلى الدفتر'}));
  tx(()=>vatWorksheetAction(db,users.manager,second,'review_worksheet',{version:next.version,note:'راجعت الكشف الإضافي المصطنع وقبلت التسوية'}));
  next=getVatWorksheet(db,users.manager,second);
  tx(()=>vatWorksheetAction(db,users.manager,second,'record_filing',{version:next.version,filing_reference:'SYN-RET-2',filing_evidence:'قدّم المختص النسخة الثانية وحُفظ إيصالها في ملف الالتزامات'}));
  assert.equal(getVatWorksheet(db,users.employee,id).status,'superseded','the older filed revision is kept, marked as replaced, never rewritten');
  assert.equal(getVatWorksheet(db,users.employee,second).status,'filed');
  assert.ok(verifyAudit(db));
});

test('vat worksheet: figures come from the ledger, unverified input vat never enters the worksheet, and the CSV boxes are named by the user',t=>{
  const {db,users,tx}=fixture(t);
  ledgerSource(db);
  ledgerRow(db,{claim:'cl1',sequence:1,chain:1,net:100000,vat:15000,supply_date:'2026-05-10'});
  ledgerRow(db,{claim:'cl2',sequence:2,chain:2,category:'zero_rated',net:50000,vat:0,supply_date:'2026-05-20'});
  ledgerRow(db,{claim:'cl1',sequence:1,chain:3,kind:'credit_note',net:20000,vat:3000,supply_date:'2026-06-01',original:db.prepare("SELECT id FROM tax_invoices WHERE kind='invoice' AND sequence=1").get().id});
  rate(db,users,tx);
  const id=tx(()=>createVatWorksheet(db,users.employee,PERIOD)).id;
  let w=getVatWorksheet(db,users.employee,id);
  assert.equal(w.ledger.sales_standard_minor,80000,'a credit note reduces the period, it does not add to it');
  assert.equal(w.ledger.output_vat_minor,12000);
  assert.equal(w.ledger.sales_zero_rated_minor,50000);
  assert.equal(w.ledger.input_vat_available,false,'no supplier tax invoice has been verified: no number, and not a zero');
  assert.equal(w.expected_output_vat_minor,0);
  assert.equal(w.rate.percent,'15.00');
  // ضريبة مدخلات لم يتحقق منها أحد لا تدخل الورقة إطلاقًا.
  assert.throws(()=>tx(()=>saveVatWorksheet(db,users.employee,id,{version:w.version,...FIGURES,input_vat:'10.00',reconciliation_note:'أحاول إدخال مدخلات لم يتحقق منها أحد'})),code('unverified_input_vat'));
  assert.equal(vatBoard(db,users.employee).pending_input_vat.count,0);
  assert.match(vatBoard(db,users.employee).pending_input_vat.note,/لا تدخل ورقة العمل/);
  w=tx(()=>saveVatWorksheet(db,users.employee,id,{...FIGURES,version:w.version,sales_standard:'800.00',output_vat:'120.00',sales_zero_rated:'500.00'}));
  assert.equal(w.variance_minor,0,'a worksheet that matches the ledger line by line carries no gap');
  assert.equal(w.expected_output_vat_minor,12000,'the period rate is a review check, not a filed figure');
  tx(()=>nameExportBoxes(db,users.employee,{boxes:[{line_key:'sales_standard',box_label:'خانة يسميها المستخدم 1'},{line_key:'output_vat',box_label:'خانة يسميها المستخدم 2'}]}));
  const file=exportVatWorksheet(db,users.employee,id),text=file.content.toString('utf8');
  assert.match(file.filename,/^vat-worksheet-2026-04-01-2026-06-30-r1\.csv$/);
  assert.ok(text.includes('خانة يسميها المستخدم 1'));
  assert.ok(text.includes(DISCLAIMER));
  assert.match(text,/التعيين على المستخدم والمختص/,'the export never claims to know an official form’s boxes');
  assert.ok(verifyAudit(db));
});

test('withholding: the rate comes from a dated confirmed setting at the payment date, the classifier is recorded by name, and whoever records it does not document its remittance',t=>{
  const {db,users,tx}=fixture(t);
  const board=withholdingBoard(db,users.employee);
  assert.deepEqual(board.confirmed_rates,[]);
  assert.match(board.warning,/يحددها المختص الضريبي/);
  const early=rate(db,users,tx,{kind:'withholding',category:'خدمة فنية',label:'استقطاع خدمة فنية',percent:'5',effective_from:'2026-01-01'});
  const later=rate(db,users,tx,{kind:'withholding',category:'خدمة فنية',label:'استقطاع خدمة فنية (محدّث)',percent:'10',effective_from:'2026-08-01'});
  const entry={payment_order_id:null,beneficiary_name:'منصة إعلانات غير مقيمة مصطنعة',beneficiary_country:'IE',service_kind:'خدمة فنية كما صنفها المختص',payment_date:'2026-05-15',amount:'1000.00',
    rate_setting_id:early,remittance_due_date:'2026-06-10',due_date_basis:'مهلة أكدها المختص الضريبي المصطنع بخطابه المحفوظ',classified_by_name:'مختص ضريبي مصطنع',classified_on:'2026-05-14',
    classification_note:'صنّفها المختص خدمة فنية وحدد نسبتها وأثر الاتفاقية في خطابه',treaty_note:'لا اتفاقية مطبقة بحسب المختص'};
  assert.throws(()=>tx(()=>recordWithholding(db,users.manager,entry)),code('not_permitted'));
  assert.throws(()=>tx(()=>recordWithholding(db,users.employee,{...entry,classification_note:'قصير'})),code('invalid_text'),'a classification without its author and basis is refused');
  assert.throws(()=>tx(()=>recordWithholding(db,users.employee,{...entry,rate_setting_id:later})),code('rate_not_effective'),'the rate of the payment date applies, not today’s');
  const id=tx(()=>recordWithholding(db,users.employee,entry)).id;
  const recorded=withholdingBoard(db,users.employee).entries[0];
  assert.equal(recorded.withheld_minor,5000);assert.equal(recorded.percent,'5.00');assert.equal(recorded.status,'recorded');
  assert.deepEqual(recorded.actions,[],'the person who recorded it is offered no remittance action');
  assert.ok(withholdingBoard(db,users.manager).inbox.some(x=>x.id===id));
  assert.throws(()=>tx(()=>withholdingAction(db,users.employee,id,'record_remittance',{version:recorded.version,remitted_on:'2026-06-01',remittance_reference:'SYN-1',remittance_evidence:'أوثق توريد ما سجلته بنفسي'})),code('action_unavailable'));
  assert.throws(()=>tx(()=>withholdingAction(db,users.manager,id,'record_remittance',{version:recorded.version,remitted_on:'2026-05-01',remittance_reference:'SYN-1',remittance_evidence:'تاريخ توريد يسبق الدفعة نفسها'})),code('remitted_on'));
  tx(()=>withholdingAction(db,users.manager,id,'record_remittance',{version:recorded.version,remitted_on:'2026-06-08',remittance_reference:'SYN-WHT-1',remittance_evidence:'إيصال توريد مصطنع محفوظ في ملف الالتزامات'}));
  const after=withholdingBoard(db,users.manager).entries[0];
  assert.equal(after.status,'remitted');assert.equal(after.remitted_by,'manager');assert.deepEqual(after.actions,[]);
  assert.equal(withholdingBoard(db,users.manager).totals.due_minor,0);
  assert.throws(()=>db.prepare("UPDATE withholding_entries SET withheld_minor=1,version=version+1 WHERE id=?").run(id),/documented once/);
  assert.equal(withholdingBoard(db,users.external).entries.length,0,'another tenant sees no entry');
  assert.ok(verifyAudit(db));
});

test('zakat worksheet: the platform names no line and computes no pool, and the specialist’s worksheet is approved by someone other than its preparer',t=>{
  const {db,users,tx}=fixture(t);
  const id=tx(()=>createZakatWorksheet(db,users.employee,{fiscal_year:'2026',specialist_name:'مختص زكاة مصطنع',basis_note:'بنود يسميها المختص في خطابه المصطنع المحفوظ'})).id;
  const board=()=>vatBoard(db,users.employee).zakat_worksheets[0];
  let z=board();
  assert.equal(z.line_count,0,'the platform starts the worksheet empty and assumes no line');
  assert.match(z.note,/لا تحسب وعاء الزكاة ولا تفترض بنوده/);
  assert.equal(z.total_minor,undefined,'no pool is computed anywhere');
  assert.throws(()=>tx(()=>saveZakatLines(db,users.manager,id,{version:z.version,lines:[{label:'بند',amount:'1',source_note:''}]})),code('not_permitted'));
  tx(()=>saveZakatLines(db,users.employee,id,{version:z.version,lines:[{label:'بند يسميه المختص 1',amount:'',source_note:'مصدر مصطنع'},{label:'بند يسميه المختص 2',amount:'-250.00',source_note:''}]}));
  z=board();
  assert.equal(z.line_count,2);assert.equal(z.empty_lines,1,'a line stays empty until the specialist fills it');
  assert.equal(z.lines[1].amount_minor,-25000,'a deduction line keeps its sign as the specialist entered it');
  assert.throws(()=>tx(()=>zakatAction(db,users.manager,id,'review_zakat',{version:z.version,note:'أعتمد ورقة فيها بند بلا مبلغ'})),code('lines_incomplete'));
  tx(()=>saveZakatLines(db,users.employee,id,{version:z.version,lines:[{label:'بند يسميه المختص 1',amount:'1000.00',source_note:'مصدر مصطنع'},{label:'بند يسميه المختص 2',amount:'-250.00',source_note:''}]}));
  z=board();
  assert.throws(()=>tx(()=>zakatAction(db,users.employee,id,'review_zakat',{version:z.version,note:'أعتمد ما أعددته بنفسي'})),code('action_unavailable'));
  tx(()=>zakatAction(db,users.manager,id,'review_zakat',{version:z.version,note:'اعتمدت البنود كما سماها المختص الضريبي'}));
  z=board();
  assert.equal(z.status,'reviewed');assert.equal(z.reviewed_by,'manager');
  assert.throws(()=>tx(()=>saveZakatLines(db,users.employee,id,{version:z.version,lines:[{label:'تعديل صامت',amount:'1',source_note:''}]})),code('not_draft'));
  assert.throws(()=>db.prepare("UPDATE zakat_worksheet_lines SET amount_minor=1 WHERE worksheet_id=?").run(id),/draft worksheet only/);
  const next=tx(()=>zakatAction(db,users.employee,id,'revise_zakat',{version:z.version,note:'ورد تعديل من المختص على البنود'})).id;
  assert.equal(db.prepare('SELECT status FROM zakat_worksheets WHERE id=?').get(id).status,'superseded');
  assert.equal(db.prepare('SELECT revision FROM zakat_worksheets WHERE id=?').get(next).revision,2);
  assert.ok(verifyAudit(db));
});

test('both screens render for the preparer and the reviewer, every offered button opens a usable form, and each screen states it is a worksheet and not a return',t=>{
  const {db,users,tx}=fixture(t);
  const e=value=>String(value??'').replace(/[&<>"']/g,c=>`&#${c.charCodeAt(0)};`);
  const worksheet=tx(()=>createVatWorksheet(db,users.employee,PERIOD)).id;
  tx(()=>saveVatWorksheet(db,users.employee,worksheet,{...FIGURES,version:1,sales_standard:'1000.00',output_vat:'150.00',reconciliation_note:'كشف يدوي مصطنع لم يُرحَّل بعد إلى الدفتر'}));
  tx(()=>createZakatWorksheet(db,users.employee,{fiscal_year:'2026',specialist_name:'مختص زكاة مصطنع',basis_note:'بنود يسميها المختص في خطابه المصطنع'}));
  const rateId=rate(db,users,tx,{kind:'withholding',category:'خدمة فنية',label:'استقطاع خدمة فنية',percent:'5'});
  tx(()=>recordWithholding(db,users.employee,{payment_order_id:null,beneficiary_name:'مستفيد غير مقيم مصطنع',beneficiary_country:'IE',service_kind:'خدمة فنية كما صنفها المختص',payment_date:'2026-05-15',amount:'1000.00',
    rate_setting_id:rateId,remittance_due_date:'2026-06-10',due_date_basis:'مهلة أكدها المختص الضريبي المصطنع بخطابه',classified_by_name:'مختص ضريبي مصطنع',classified_on:'2026-05-14',classification_note:'تصنيف مصطنع أفتى به المختص بخطابه',treaty_note:''}));
  const problems=[];
  for(const [key,ui,load] of [['vat-worksheet',vatWorksheetUI,vatBoard],['withholding',withholdingUI,withholdingBoard]])
    for(const who of ['employee','manager']){
      const data=load(db,users[who]),buttons=[],button=(action,id,label)=>{buttons.push([action,id]);return `<button>${e(label)}</button>`;};
      const html=ui.render(data,{e,button,money}),text=html.replace(/<[^>]+>/g,' ');
      if(/\bundefined\b|\bNaN\b|\[object /.test(text))problems.push(`${key}/${who}: ${text.match(/\bundefined\b|\bNaN\b|\[object /)[0]}`);
      if(!text.includes('ورقة عمل للمراجعة، وليست إقرارًا'))problems.push(`${key}/${who}: the screen does not say it is a worksheet, not a return`);
      if(/style=|<script/.test(html))problems.push(`${key}/${who}: inline style or script breaks the CSP`);
      for(const [action,id] of buttons){
        try{
          const spec=ui.form(action,id,data);
          if(!spec||typeof spec.title!=='string'||!Array.isArray(spec.fields)||typeof spec.toPayload!=='function'||!spec.endpoint)problems.push(`${key}/${who}/${action}: incomplete form spec`);
          else if(/\bundefined\b/.test(spec.title+operationFields(spec.fields,e).replace(/<[^>]+>/g,' ')))problems.push(`${key}/${who}/${action}: form shows undefined`);
        }catch(error){problems.push(`${key}/${who}/${action}: ${error.message}`);}
      }
      if(!buttons.length)problems.push(`${key}/${who}: no action offered at all`);
    }
  assert.deepEqual(problems,[]);
});
