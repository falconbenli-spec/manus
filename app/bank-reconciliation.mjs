import { randomUUID } from 'node:crypto';
import { audit, now, hash } from './db.mjs';
import { fail } from './auth.mjs';
import { refuse } from './refusal.mjs';
import * as v from './validation.mjs';
import { currentUser } from './delegations.mjs';
import { can } from './access.mjs';
import { registerSourceKind } from './ledger-sources.mjs';
import { personName } from './people-read.mjs';

// المطابقة البنكية. الاستيراد ملف يرفعه المحاسب: لا اتصال بأي بنك ولا مصرفية مفتوحة.
// النظام يقترح ويشرح سبب اقتراحه نصًا، والإقرار بشري دائمًا، ومن يُعِدّ لا يعتمد.
// لا يُنشأ قيد محاسبي آليًا: الحركة المصنّفة رسومًا أو عائدًا تصير مستندًا ينتظر قيدًا (bank_line) يُعِدّه المحاسب
// من «القوائم المالية والترحيل»، ويعتمده ويرحّله غيره كأي قيد.
//
// المطابقة (الترحيل 168): سطرٌ بسجل، أو سطرٌ واحد بعدة سجلات (group: تحويل مجمّع)، أو عدة سطور بسجل واحد (split: قبضٌ وصل
// على دفعات) — بمجموعين متساويين بالهللة. والعضو سجل منصة نهائي أو قيد يدوي مرحّل على حساب البنك نفسه في الدفتر.
// كثيرٌ بكثير ليس مطابقة: يُطابَق كل جزء بجزئه.
export const SOURCE_KINDS={
  supplier_payment:{name:'دفعة مورد منفذة',direction:'out'},
  ar_receipt:{name:'قبض مؤكد من عميل',direction:'in'},
  payroll_payment:{name:'دفع مسير رواتب منفذ',direction:'out'},
  expense_reimbursement:{name:'تعويض مصروف موظف',direction:'out'},
  custody_issue:{name:'صرف عهدة',direction:'out'},
  custody_return:{name:'إعادة متبقي عهدة',direction:'in'},
  // الحزمة 3: نقدٌ يحرّك البنك وكان خارج الجدول. المرتجع مبلغه ما دخل الحساب فعلًا لا مبلغ الأمر.
  advance_receipt:{name:'قبض دفعة مقدمة',direction:'in'},
  advance_reversal:{name:'ارتداد دفعة مقدمة',direction:'out'},
  supplier_payment_return:{name:'مرتجع دفعة مورد',direction:'in'},
  // الترحيل 171: نقد التحصيل (الترحيل 170). ارتداد القبض والارتداد على الحساب مالٌ خرج، والقبض على الحساب مالٌ دخل.
  ar_receipt_reversal:{name:'ارتداد قبض من عميل',direction:'out'},
  ar_account_receipt:{name:'قبض على حساب عميل',direction:'in'},
  ar_account_reversal:{name:'ارتداد قبض على حساب عميل',direction:'out'}
};
const JOURNAL_NAME='قيد يدوي على حساب البنك';
export const UNMATCHED_REASONS={bank_fee:'رسوم بنكية',interest:'فائدة أو عائد',account_transfer:'تحويل بين حسابات المنشأة',unknown:'غير معروف — يحتاج بحثًا'};
// التصنيف الذي يصير قيدًا من السطر نفسه، وغرضه في الدفتر. التحويل بين حسابات المنشأة يُطابَق بقيده اليدوي، والمجهول يُبحث.
export const JOURNALIZED_REASONS=Object.freeze({bank_fee:'bank_charges',interest:'interest_income'});
export const DATE_FORMATS={'YYYY-MM-DD':'٢٠٢٦-٠٩-٣٠','DD/MM/YYYY':'٣٠/٠٩/٢٠٢٦','DD-MM-YYYY':'٣٠-٠٩-٢٠٢٦','MM/DD/YYYY':'٠٩/٣٠/٢٠٢٦'};
export const DELIMITERS={comma:{name:'فاصلة ,',char:','},semicolon:{name:'فاصلة منقوطة ;',char:';'},tab:{name:'مسافة جدولة (Tab)',char:'\t'},pipe:{name:'شرطة رأسية |',char:'|'}};
export const COLUMN_KEYS=[
  {key:'date',label:'التاريخ',required:true},{key:'description',label:'الوصف',required:true},{key:'reference',label:'المرجع',required:false},
  {key:'debit',label:'مدين (مبلغ خارج من الحساب)',required:false},{key:'credit',label:'دائن (مبلغ داخل إلى الحساب)',required:false},
  {key:'amount',label:'مبلغ بعمود واحد (سالب = خارج)',required:false},{key:'balance',label:'الرصيد بعد الحركة',required:false}
];
// نافذة فرق التاريخ المقبولة في الاقتراح: تفاوت تشغيلي بين تاريخ السجل وتاريخ ظهوره في البنك، لا مهلة نظامية.
const DEFAULT_WINDOW_DAYS=5;
const MAX_ROWS=5000,MAX_FILE_CHARS=2000000,MAX_MINOR=1000000000000;
const today=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Riyadh'}).format(new Date());
const id=()=>randomUUID();
const decimal=minor=>`${minor<0?'-':''}${Math.floor(Math.abs(minor)/100)}.${String(Math.abs(minor)%100).padStart(2,'0')}`;
const days=(a,b)=>Math.round((Date.parse(b)-Date.parse(a))/86400000);

function actor(db,supplied){const c=currentUser(db,supplied);if(!c)fail(403,'forbidden','الحساب غير متاح');return c;}
function writing(db){if(!db.isTransaction)fail(500,'transaction_required','تتطلب كتابة المطابقة البنكية معاملة قاعدة بيانات');}
function preparer(db,u){if(!can(db,u,'bank.reconcile'))fail(403,'not_permitted','إعداد المطابقة البنكية لحامل تصريحها');}
function approver(db,u){if(!can(db,u,'bank.reconcile.approve'))fail(403,'not_permitted','اعتماد المطابقة البنكية لحامل تصريحه');}
const userName=personName;

// أرقام عربية وفواصل آلاف ومسميات عملة تأتي من ملفات البنوك كما هي؛ تُطبَّع قبل القراءة.
function digits(value){
  return String(value??'').normalize('NFKC').replace(/[٠-٩۰-۹]/gu,c=>{
    const code=c.codePointAt(0);return String(code>=0x06F0?code-0x06F0:code-0x0660);
  });
}
const normalizeRef=value=>digits(value).toUpperCase().replace(/[^0-9A-Zء-ي]/gu,'');

function money(raw,label,{signed=false,optional=false}={}){
  let text=digits(raw).trim();
  if(!text)return optional?null:fail(400,'invalid_money',`${label}: مبلغ مفقود`);
  let negative=false;
  if(/^\(.*\)$/u.test(text)){negative=true;text=text.slice(1,-1);}
  text=text.replace(/[\s,٬ ]/gu,'').replace(/(?:SAR|SR|ر\.س|ريال)/giu,'').trim();
  if(text.startsWith('-')){negative=true;text=text.slice(1);}
  if(text.startsWith('+'))text=text.slice(1);
  if(!text)return optional?null:fail(400,'invalid_money',`${label}: مبلغ مفقود`);
  if(!/^\d{1,12}(?:\.\d{1,2})?$/u.test(text))fail(400,'invalid_money',`${label}: مبلغ غير صالح «${String(raw).slice(0,40)}»`);
  const [whole,fraction='']=text.split('.'),minor=Number(BigInt(whole)*100n+BigInt(fraction.padEnd(2,'0')));
  if(minor>MAX_MINOR)fail(400,'invalid_money',`${label}: المبلغ يتجاوز الحد المحلي`);
  if(negative&&!signed)fail(400,'invalid_money',`${label}: لا يقبل مبلغًا سالبًا`);
  return negative?-minor:minor;
}
function parseDate(raw,format,label){
  const text=digits(raw).trim().replace(/\s+/gu,'');
  const patterns={'YYYY-MM-DD':/^(\d{4})-(\d{1,2})-(\d{1,2})$/u,'DD/MM/YYYY':/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/u,'DD-MM-YYYY':/^(\d{1,2})-(\d{1,2})-(\d{4})$/u,'MM/DD/YYYY':/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/u};
  const m=patterns[format]?.exec(text);
  if(!m)fail(400,'invalid_date',`${label}: التاريخ «${String(raw).slice(0,40)}» لا يطابق الصيغة ${format}`);
  const [year,month,day]=format==='YYYY-MM-DD'?[m[1],m[2],m[3]]:format==='MM/DD/YYYY'?[m[3],m[1],m[2]]:[m[3],m[2],m[1]];
  return v.date(`${year}-${month.padStart(2,'0')}-${day.padStart(2,'0')}`);
}
// قارئ CSV بسيط يحترم الاقتباس المزدوج وسطور CRLF. لا مكتبات خارجية في المشروع.
export function parseCsv(text,delimiter){
  const rows=[];let row=[],field='',quoted=false,started=false;
  for(let i=0;i<text.length;i++){
    const c=text[i];
    if(quoted){
      if(c!=='"'){field+=c;continue;}
      if(text[i+1]==='"'){field+='"';i++;continue;}
      quoted=false;continue;
    }
    if(c==='"'&&!started){quoted=true;started=true;continue;}
    if(c===delimiter){row.push(field);field='';started=false;continue;}
    if(c==='\r')continue;
    if(c==='\n'){row.push(field);rows.push(row);row=[];field='';started=false;continue;}
    field+=c;started=true;
  }
  if(started||field!==''||row.length){row.push(field);rows.push(row);}
  return rows.filter(r=>r.some(cell=>cell.trim()!==''));
}

function scoped(db,u,table,rowId,message){
  const row=typeof rowId==='string'&&db.prepare(`SELECT * FROM ${table} WHERE id=? AND tenant_id=?`).get(rowId,u.tenant_id);
  if(!row)fail(404,'not_found',message);
  return row;
}

// ==== سجلات المنصة التي تمس النقد. هذه وحدها ما يُطابَق به، ولا يُخترع سجل من الكشف. ====
export function cashRecords(db,tenantId,from,to){
  const q=(sql,...args)=>db.prepare(sql).all(tenantId,...args);
  const rows=[
    ...q("SELECT o.id,o.executed_on AS date,o.bank_reference AS reference,x.legal_name AS party,o.amount_minor FROM payment_orders o JOIN vendors x ON x.id=o.vendor_id WHERE o.tenant_id=? AND o.status='executed' AND o.executed_on BETWEEN ? AND ?",from,to).map(r=>({...r,source_kind:'supplier_payment'})),
    ...q("SELECT id,received_on AS date,reference,payer AS party,CAST(amount_minor AS INTEGER) AS amount_minor FROM ar_receipts WHERE tenant_id=? AND status='confirmed' AND received_on BETWEEN ? AND ?",from,to).map(r=>({...r,source_kind:'ar_receipt'})),
    ...q("SELECT p.id,p.executed_on AS date,p.bank_reference AS reference,'مسير رواتب '||r.month AS party,p.amount_minor FROM payroll_payments p JOIN payroll_runs r ON r.id=p.run_id WHERE p.tenant_id=? AND p.status='executed' AND p.executed_on BETWEEN ? AND ?",from,to).map(r=>({...r,source_kind:'payroll_payment'})),
    ...q("SELECT c.id,c.reimbursed_on AS date,c.reimbursement_reference AS reference,x.name AS party,c.amount_minor FROM expense_claims c JOIN users x ON x.id=c.claimant_id WHERE c.tenant_id=? AND c.status='reimbursed' AND c.reimbursed_on BETWEEN ? AND ?",from,to).map(r=>({...r,source_kind:'expense_reimbursement'})),
    ...q("SELECT c.id,c.issued_on AS date,c.issue_reference AS reference,x.name AS party,c.amount_minor FROM custodies c JOIN users x ON x.id=c.holder_id WHERE c.tenant_id=? AND c.status IN ('issued','closed') AND c.issued_on BETWEEN ? AND ?",from,to).map(r=>({...r,source_kind:'custody_issue'})),
    ...q("SELECT c.id,date(c.closed_at,'+3 hours') AS date,c.return_reference AS reference,x.name AS party,c.returned_minor AS amount_minor FROM custodies c JOIN users x ON x.id=c.holder_id WHERE c.tenant_id=? AND c.status='closed' AND c.returned_minor>0 AND date(c.closed_at,'+3 hours') BETWEEN ? AND ?",from,to).map(r=>({...r,source_kind:'custody_return'})),
    // المرتجع مال راجع للحساب بمبلغ ما قيّده البنك فعلًا (credited_minor)، والفرق عن الأمر رسوم يحملها قيد المرتجع.
    ...q("SELECT r.id,r.returned_on AS date,r.bank_reference AS reference,x.legal_name AS party,r.credited_minor AS amount_minor FROM payment_returns r JOIN payment_orders o ON o.id=r.order_id JOIN vendors x ON x.id=o.vendor_id WHERE r.tenant_id=? AND r.returned_on BETWEEN ? AND ?",from,to).map(r=>({...r,source_kind:'supplier_payment_return'})),
    // المرجع كما يقرؤه الدفتر في قيدها (app/ledger.mjs): مرجع الحوالة، وإلا ADV- بأول معرّفها. والارتداد بيوم الرياض.
    ...q("SELECT a.id,a.received_on AS date,COALESCE(a.receipt_reference,'ADV-'||substr(a.id,1,8)) AS reference,c.legal_name AS party,a.paid_minor AS amount_minor FROM advance_invoices a JOIN clients c ON c.id=a.client_id WHERE a.tenant_id=? AND a.status='paid' AND a.received_on BETWEEN ? AND ?",from,to).map(r=>({...r,source_kind:'advance_receipt'})),
    ...q("SELECT r.id,date(r.reversed_at,'+3 hours') AS date,'ADV-REV-'||substr(r.id,1,8) AS reference,c.legal_name AS party,r.amount_minor FROM advance_reversals r JOIN advance_invoices a ON a.id=r.advance_id JOIN clients c ON c.id=a.client_id WHERE r.tenant_id=? AND date(r.reversed_at,'+3 hours') BETWEEN ? AND ?",from,to).map(r=>({...r,source_kind:'advance_reversal'})),
    // نقد التحصيل بالمرجع والتاريخ كما يقيّدهما الدفتر (app/receivables.mjs): الارتداد بتاريخ أثره في البنك (effective_on)
    // ومرجعه REV- ومرجع القبض، والقبض على الحساب بمرجعه وتاريخ وصوله. المعتمد وحده والمؤكد وحده: ما لم يُقرَّر ليس مالًا تحرّك.
    ...q("SELECT a.id,a.effective_on AS date,substr('REV-'||r.reference,1,170) AS reference,r.payer AS party,CAST(a.amount_minor AS INTEGER) AS amount_minor FROM ar_adjustments a JOIN ar_receipts r ON r.id=a.receipt_id WHERE r.tenant_id=? AND a.kind='receipt_reversal' AND a.status='approved' AND a.effective_on BETWEEN ? AND ?",from,to).map(r=>({...r,source_kind:'ar_receipt_reversal'})),
    ...q("SELECT id,received_on AS date,reference,payer AS party,CAST(amount_minor AS INTEGER) AS amount_minor FROM ar_account_receipts WHERE tenant_id=? AND status='confirmed' AND received_on BETWEEN ? AND ?",from,to).map(r=>({...r,source_kind:'ar_account_receipt'})),
    ...q("SELECT v.id,v.effective_on AS date,substr('REV-'||x.reference,1,170) AS reference,x.payer AS party,CAST(v.amount_minor AS INTEGER) AS amount_minor FROM ar_account_reversals v JOIN ar_account_receipts x ON x.id=v.account_receipt_id WHERE v.tenant_id=? AND v.status='approved' AND v.effective_on BETWEEN ? AND ?",from,to).map(r=>({...r,source_kind:'ar_account_reversal'}))
  ];
  return rows.map(r=>({source_kind:r.source_kind,source_id:r.id,source_name:SOURCE_KINDS[r.source_kind].name,direction:SOURCE_KINDS[r.source_kind].direction,
    date:r.date,reference:r.reference??'',party:r.party??'',amount_minor:Number(r.amount_minor)})).sort((a,b)=>a.date.localeCompare(b.date));
}
// القيد الذي يملكه مستند (رابط المصدر، أو رابط المستحق القديم) أو يعكس قيدًا يملكه مستند: هذا قيد مستند لا قيد يدوي.
function ownedJournals(db,tenantId){
  const owned=new Set(db.prepare('SELECT journal_id FROM finance_source_links WHERE tenant_id=?').all(tenantId).map(r=>r.journal_id));
  for(const r of db.prepare('SELECT l.journal_id FROM finance_payable_links l JOIN finance_journals j ON j.id=l.journal_id WHERE j.tenant_id=?').all(tenantId))owned.add(r.journal_id);
  for(const r of db.prepare('SELECT x.original_journal_id,x.reversal_journal_id FROM finance_reversals x JOIN finance_journals j ON j.id=x.original_journal_id WHERE j.tenant_id=?').all(tenantId))
    if(owned.has(r.original_journal_id))owned.add(r.reversal_journal_id);
  return owned;
}
// القيود اليدوية المرحّلة على حساب البنك في الدفتر، بأثرها الصافي عليه: إيداع رأس مال، تحويل بين حسابين، رسوم رُحّلت يدويًا.
// هذه حركات دفترية لا مستند لها في المنصة، فتُطابَق بسطر الكشف مباشرة، وما لم يُطابَق منها بندٌ دفتري لم يظهر في البنك.
// مفتاح القيد بحسابه البنكي: قيد التحويل بين حسابين للمنشأة حركةٌ في كشف كل واحد منهما، فيُطابَق في كل كشف مرة.
// account: {id, gl_account_id} — الحساب البنكي وحسابه في الدفتر.
export function bankJournals(db,tenantId,account,from,to){
  const owned=ownedJournals(db,tenantId),glAccountId=account?.gl_account_id;
  if(!glAccountId)return [];
  return db.prepare(`SELECT j.id,j.entry_date,j.source_reference,j.description,SUM(l.debit_minor)-SUM(l.credit_minor) AS net FROM finance_lines l JOIN finance_journals j ON j.id=l.journal_id
      WHERE j.tenant_id=? AND j.status='posted' AND l.account_id=? AND j.entry_date BETWEEN ? AND ? GROUP BY j.id ORDER BY j.entry_date,j.id`).all(tenantId,glAccountId,from,to)
    .filter(j=>j.net!==0&&!owned.has(j.id))
    .map(j=>({source_kind:'journal',source_id:j.id,journal_id:j.id,bank_account_id:account.id,key:`journal:${j.id}@${account.id}`,source_name:JOURNAL_NAME,
      direction:j.net>0?'in':'out',date:j.entry_date,reference:j.source_reference,party:j.description,amount_minor:Math.abs(j.net)}));
}
// السجل الذي رُحّل قيده فعلًا هو وحده الذي يظهر في رصيد الدفتر؛ ما لم يُرحّل ليس في الدفتر ولا في البنك.
function postedSourceKeys(db,tenantId){
  return new Set(db.prepare("SELECT l.source_kind,l.source_id FROM finance_source_links l JOIN finance_journals j ON j.id=l.journal_id WHERE l.tenant_id=? AND j.status='posted'").all(tenantId).map(r=>`${r.source_kind}:${r.source_id}`));
}
function liveMatches(db,tenantId){
  return db.prepare("SELECT * FROM bank_matches WHERE tenant_id=? AND status<>'rejected'").all(tenantId);
}
// أعضاء المطابقات القائمة (مقترحة أو معتمدة) بمفتاح واحد: السطر بمعرّفه، والسجل بنوعه ومعرّفه، والقيد بـjournal:معرّفه.
const memberKey=i=>i.side==='line'?`line:${i.transaction_id}`:i.side==='journal'?`journal:${i.journal_id}@${i.bank_account_id}`:`${i.source_kind}:${i.source_id}`;
// مفتاح العضو من السجل نفسه: القيد اليدوي بمفتاحه وحسابه، والسجل بنوعه ومعرّفه.
const keyOf=r=>r.key??`${r.source_kind}:${r.source_id}`;
function liveItems(db,tenantId,{approved=false}={}){
  return db.prepare(`SELECT b.*,m.status AS match_status,m.kind AS match_kind FROM bank_match_items b JOIN bank_matches m ON m.id=b.match_id WHERE b.tenant_id=? AND b.live=1 ${approved?"AND m.status='approved'":''}`).all(tenantId);
}
const takenKeys=(db,tenantId,options)=>new Set(liveItems(db,tenantId,options).filter(i=>i.side!=='line').map(memberKey));
// مطابقة كل سطر: رأسها وأعضاؤها. السطر في split عضوٌ في مطابقة رأسها سطرٌ آخر، فالخريطة من البنود لا من الرأس.
function lineMatches(db,tenantId){
  const heads=new Map(liveMatches(db,tenantId).map(m=>[m.id,{...m,items:[]}])),byLine=new Map();
  for(const i of db.prepare('SELECT * FROM bank_match_items WHERE tenant_id=? AND live=1 ORDER BY match_id,position').all(tenantId)){
    const m=heads.get(i.match_id);if(!m)continue;
    m.items.push(i);if(i.side==='line')byLine.set(i.transaction_id,m);
  }
  return byLine;
}
// هوكٌ لقارئ التتبّع في الدفتر (app/ledger.mjs bankMatchesOf يقرأ الرأس وحده): مطابقات مستندٍ بعينه من بنودها، فيرى
// السجل في مطابقة مجمّعة ويرى كل سطور المطابقة المجزّأة. الشكل نفسه الذي يعيده الدفتر اليوم.
export function bankMatchesForSource(db,tenantId,kind,id){
  const side=kind==='journal'?"b.side='journal' AND b.journal_id=?":"b.side='record' AND b.source_kind=? AND b.source_id=?";
  return db.prepare(`SELECT m.id,m.status,m.shape,m.prepared_by,m.decided_by,m.decided_at,m.prepared_at,b.amount_minor FROM bank_match_items b JOIN bank_matches m ON m.id=b.match_id
      WHERE b.tenant_id=? AND ${side} ORDER BY m.prepared_at`).all(tenantId,...(kind==='journal'?[id]:[kind,id]))
    .flatMap(m=>db.prepare("SELECT t.id,t.txn_date,t.reference,t.description FROM bank_match_items b JOIN bank_transactions t ON t.id=b.transaction_id WHERE b.match_id=? AND b.side='line' ORDER BY b.position").all(m.id)
      .map(t=>({match_id:m.id,transaction_id:t.id,status:m.status,shape:m.shape,amount_minor:m.amount_minor,txn_date:t.txn_date,reference:t.reference,description:t.description,
        prepared_by:m.prepared_by,prepared_by_name:personName(db,m.prepared_by),decided_by:m.decided_by,decided_by_name:personName(db,m.decided_by),decided_at:m.decided_at,source_kind:kind,source_id:id})));
}

// ==== الاقتراح: مرشحون بدرجة ثقة وسبب مكتوب لكل واحد. لا يعتمد النظام شيئًا بنفسه. ====
function scoreCandidate(txn,record,windowDays){
  const reasons=[],direction=txn.credit_minor>0?'in':'out',amount=txn.debit_minor+txn.credit_minor;
  if(record.direction!==direction)return null;
  let score=0;
  const exact=record.amount_minor===amount;
  if(exact){score+=45;reasons.push(`المبلغ مطابق تمامًا: ${decimal(amount)} ريال`);}
  else reasons.push(`المبلغ مختلف: الحركة ${decimal(amount)} والسجل ${decimal(record.amount_minor)} ريال`);
  const gap=Math.abs(days(record.date,txn.txn_date));
  if(gap===0){score+=25;reasons.push('التاريخ مطابق لتاريخ السجل');}
  else if(gap<=windowDays){score+=15;reasons.push(`فرق التاريخ ${gap} يوم، ضمن نافذة ${windowDays} أيام`);}
  else reasons.push(`فرق التاريخ ${gap} يوم، خارج نافذة ${windowDays} أيام`);
  const ref=normalizeRef(record.reference),line=normalizeRef(`${txn.reference} ${txn.description}`);
  const referenceHit=!!ref&&ref.length>=4&&line.includes(ref);
  if(referenceHit){score+=25;reasons.push(`مرجع السجل «${record.reference}» يظهر في مرجع الحركة أو وصفها`);}
  else if(ref)reasons.push(`مرجع السجل «${record.reference}» لا يظهر في نص الحركة`);
  const party=String(record.party||'').split(/\s+/u).filter(w=>w.length>=3);
  const partyHit=party.some(word=>normalizeRef(txn.description).includes(normalizeRef(word)));
  if(partyHit){score+=10;reasons.push(`اسم الطرف «${record.party}» يظهر في وصف الحركة`);}
  if(!exact&&!referenceHit)return null;
  return {...record,score:Math.min(100,score),reasons,
    summary:`${record.source_name} بتاريخ ${record.date}${record.reference?` — مرجع ${record.reference}`:''}${record.party?` — ${record.party}`:''}`};
}
export function suggestMatches(db,supplied,transactionId,input={}){
  const u=actor(db,supplied);preparer(db,u);
  v.object(input,['window_days']);
  const windowDays=input.window_days===undefined?DEFAULT_WINDOW_DAYS:input.window_days;
  if(!Number.isInteger(windowDays)||windowDays<0||windowDays>30)fail(400,'window_days','نافذة التاريخ من صفر إلى ثلاثين يومًا');
  const txn=scoped(db,u,'bank_transactions',transactionId,'الحركة البنكية غير متاحة');
  return {transaction:txn,window_days:windowDays,candidates:candidatesFor(db,u,txn,windowDays),
    note:'اقتراح لا قرار: الدرجة والسبب للمساعدة فقط، والمطابقة لا تُسجَّل إلا بإقرار بشري ثم اعتماد شخص آخر.'};
}
const shift=(date,delta)=>new Date(Date.parse(date)+delta*86400000).toISOString().slice(0,10);
const accountOf=(db,bankAccountId)=>db.prepare('SELECT id,gl_account_id FROM bank_accounts WHERE id=?').get(bankAccountId);
function candidatesFor(db,u,txn,windowDays=DEFAULT_WINDOW_DAYS,context){
  const from=shift(txn.txn_date,-windowDays),to=shift(txn.txn_date,windowDays);
  const taken=context?.taken??takenKeys(db,u.tenant_id);
  const records=context?.records?.filter(r=>r.date>=from&&r.date<=to)??cashRecords(db,u.tenant_id,from,to);
  const journals=context?.journals?.filter(j=>j.date>=from&&j.date<=to)??bankJournals(db,u.tenant_id,accountOf(db,txn.bank_account_id),from,to);
  return [...records,...journals].filter(r=>!taken.has(keyOf(r))).map(r=>scoreCandidate(txn,r,windowDays)).filter(Boolean)
    .sort((a,b)=>b.score-a.score||a.date.localeCompare(b.date)).slice(0,5);
}
function ruleHints(db,tenantId,description){
  const text=digits(description).toLowerCase();
  return db.prepare('SELECT r.*,a.code AS account_code,a.name AS account_name,p.name AS project_name FROM bank_rules r LEFT JOIN finance_accounts a ON a.id=r.suggested_account_id LEFT JOIN projects p ON p.id=r.suggested_project_id WHERE r.tenant_id=? AND r.active=1').all(tenantId)
    .filter(r=>text.includes(digits(r.pattern).toLowerCase()))
    .map(r=>({id:r.id,pattern:r.pattern,account_code:r.account_code,account_name:r.account_name,project_name:r.project_name,note:r.note,
      text:`قاعدة «${r.pattern}»: ${r.account_code?`تقترح الحساب ${r.account_code} ${r.account_name}`:''}${r.account_code&&r.project_name?' و':''}${r.project_name?`المشروع ${r.project_name}`:''} — اقتراح فقط، لا ترحيل`}));
}

// ==== الحسابات البنكية وملفات تعيين الأعمدة ====
export function createBankAccount(db,supplied,input){
  writing(db);const u=actor(db,supplied);preparer(db,u);
  v.object(input,['label','bank_name','account_tail','gl_account_id']);
  const tail=digits(input.account_tail).trim();
  if(!/^\d{4}$/u.test(tail))fail(400,'account_tail','آخر أربعة أرقام من رقم الحساب فقط. لا تُدخل رقم الحساب كاملًا ولا الآيبان');
  const account=scoped(db,u,'finance_accounts',input.gl_account_id,'حساب الدفتر غير متاح');
  if(account.account_type!=='asset'||!account.active)fail(409,'account_type','حساب البنك في الدفتر يجب أن يكون حساب أصول نشطًا');
  if(db.prepare('SELECT 1 FROM bank_accounts WHERE tenant_id=? AND gl_account_id=? AND active=1').get(u.tenant_id,account.id))fail(409,'duplicate_gl_account','لهذا الحساب في الدفتر حساب بنكي مسجل');
  const rowId=id(),time=now(),label=v.text(input.label,'اسم الحساب البنكي',160,3);
  db.prepare('INSERT INTO bank_accounts(id,tenant_id,label,bank_name,account_tail,gl_account_id,created_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)').run(rowId,u.tenant_id,label,v.text(input.bank_name,'اسم البنك',160,2),tail,account.id,u.id,time,time);
  audit(db,u,'bank_account',rowId,'bank_account.created',{}, {label,gl_account:account.code,account_tail:tail});
  return {id:rowId};
}
export function saveImportProfile(db,supplied,input){
  writing(db);const u=actor(db,supplied);preparer(db,u);
  v.object(input,['bank_account_id','name','delimiter','date_format','header_rows','columns']);
  const account=scoped(db,u,'bank_accounts',input.bank_account_id,'الحساب البنكي غير متاح');
  if(!Object.hasOwn(DELIMITERS,input.delimiter))fail(400,'delimiter','اختر الفاصل بين الأعمدة');
  if(!Object.hasOwn(DATE_FORMATS,input.date_format))fail(400,'date_format','اختر صيغة التاريخ كما تظهر في ملف البنك');
  if(!Number.isInteger(input.header_rows)||input.header_rows<0||input.header_rows>20)fail(400,'header_rows','عدد أسطر الترويسة من صفر إلى عشرين');
  const columns=cleanColumns(input.columns,input.header_rows);
  const rowId=id(),time=now(),name=v.text(input.name,'اسم ملف التعريف',160,3);
  db.prepare('INSERT INTO bank_import_profiles(id,tenant_id,bank_account_id,name,delimiter,date_format,header_rows,columns,created_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(rowId,u.tenant_id,account.id,name,input.delimiter,input.date_format,input.header_rows,JSON.stringify(columns),u.id,time,time);
  audit(db,u,'bank_import_profile',rowId,'bank_profile.created',{}, {bank_account_id:account.id,name,columns});
  return {id:rowId};
}
function cleanColumns(columns,headerRows){
  v.object(columns,COLUMN_KEYS.map(c=>c.key));
  const clean={};
  for(const {key,label} of COLUMN_KEYS){
    const value=columns[key];
    if(value===undefined||value===null||value==='')continue;
    if(typeof value==='number'){
      if(!Number.isInteger(value)||value<0||value>200)fail(400,'invalid_column',`${label}: رقم العمود من صفر إلى مئتين`);
      clean[key]=value;continue;
    }
    clean[key]=v.text(value,`عمود ${label}`,120,1);
    if(!headerRows)fail(400,'header_required',`${label}: تعيين العمود باسمه يحتاج ملفًا بترويسة. اختر رقم العمود بدل اسمه`);
  }
  if(!clean.date||!clean.description)fail(400,'columns_required','يلزم تعيين عمودَي التاريخ والوصف على الأقل');
  if(!((clean.debit!==undefined&&clean.credit!==undefined)||clean.amount!==undefined))fail(400,'columns_required','عيّن عمودَي «مدين» و«دائن» معًا، أو عمود مبلغ واحد بإشارة');
  return clean;
}
export function deactivateProfile(db,supplied,profileId,input){
  writing(db);const u=actor(db,supplied);preparer(db,u);
  v.object(input,['version','note']);
  const profile=scoped(db,u,'bank_import_profiles',profileId,'ملف التعريف غير متاح');
  v.version(input.version,profile.version);
  if(!profile.active)fail(409,'already_inactive','ملف التعريف موقوف');
  db.prepare('UPDATE bank_import_profiles SET active=0,version=version+1,updated_at=? WHERE id=?').run(now(),profile.id);
  audit(db,u,'bank_import_profile',profile.id,'bank_profile.deactivated',{active:1},{active:0},v.text(input.note,'سبب الإيقاف',1000,5));
  return {id:profile.id};
}

// ==== الاستيراد: ملف واحد، بصمة واحدة، دفعة واحدة. ====
export function importStatement(db,supplied,input){
  writing(db);const u=actor(db,supplied);preparer(db,u);
  v.object(input,['profile_id','file_name','content','period_start','period_end','opening_balance','closing_balance']);
  const profile=scoped(db,u,'bank_import_profiles',input.profile_id,'ملف تعريف الأعمدة غير متاح');
  if(!profile.active)fail(409,'profile_inactive','ملف التعريف موقوف. اختر ملفًا ساريًا');
  const account=scoped(db,u,'bank_accounts',profile.bank_account_id,'الحساب البنكي غير متاح');
  if(!account.active)fail(409,'account_inactive','الحساب البنكي موقوف');
  if(typeof input.content!=='string'||!input.content.trim())fail(400,'empty_file','الملف فارغ');
  if(input.content.length>MAX_FILE_CHARS)fail(400,'file_too_large','حجم الملف يتجاوز الحد المحلي. قسّمه إلى فترات أقصر');
  const periodStart=v.date(input.period_start),periodEnd=v.date(input.period_end);
  if(periodEnd<periodStart)fail(400,'date_order','نهاية فترة الكشف تسبق بدايتها');
  if(periodEnd>today())fail(400,'future_period','فترة الكشف لا تمتد إلى المستقبل');
  const opening=money(input.opening_balance,'الرصيد الافتتاحي في الكشف',{signed:true});
  const closing=money(input.closing_balance,'الرصيد الختامي في الكشف',{signed:true});
  const digest=hash(input.content);
  const twin=db.prepare('SELECT id,file_name,imported_at,status FROM bank_statement_imports WHERE tenant_id=? AND file_digest=?').get(u.tenant_id,digest);
  if(twin)fail(409,'duplicate_file',`محتوى الملف نفسه مستورد سابقًا باسم «${twin.file_name}» بتاريخ ${twin.imported_at.slice(0,10)}`);
  const rows=readRows(input.content,profile,periodStart,periodEnd);
  // ضابط سلامة الملف: افتتاحي + صافي الحركات = ختامي. اختلافه يعني ملفًا ناقصًا أو أعمدة معكوسة.
  const net=rows.reduce((n,r)=>n+r.credit_minor-r.debit_minor,0);
  if(opening+net!==closing)fail(409,'statement_out_of_balance',`الرصيد الافتتاحي ${decimal(opening)} + صافي الحركات ${decimal(net)} = ${decimal(opening+net)}، ولا يساوي الرصيد الختامي ${decimal(closing)}. راجع الملف وتعيين الأعمدة`);
  const importId=id(),time=now();
  db.prepare('INSERT INTO bank_statement_imports(id,tenant_id,bank_account_id,profile_id,file_name,file_digest,period_start,period_end,opening_balance_minor,closing_balance_minor,row_count,imported_by,imported_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)').run(importId,u.tenant_id,account.id,profile.id,v.text(input.file_name,'اسم الملف',260,3),digest,periodStart,periodEnd,opening,closing,rows.length,u.id,time);
  const insert=db.prepare('INSERT INTO bank_transactions(id,tenant_id,import_id,bank_account_id,line_no,txn_date,description,reference,debit_minor,credit_minor,balance_minor,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)');
  for(const row of rows)insert.run(id(),u.tenant_id,importId,account.id,row.line_no,row.txn_date,row.description,row.reference,row.debit_minor,row.credit_minor,row.balance_minor,time);
  audit(db,u,'bank_import',importId,'bank_import.created',{}, {bank_account_id:account.id,file_digest:digest,period_start:periodStart,period_end:periodEnd,row_count:rows.length,closing_balance_minor:closing});
  return {id:importId,row_count:rows.length};
}
function readRows(content,profile,periodStart,periodEnd){
  const columns=JSON.parse(profile.columns),table=parseCsv(content.replace(/^﻿/u,''),DELIMITERS[profile.delimiter].char);
  if(!table.length)fail(400,'empty_file','لا سطور في الملف');
  const header=profile.header_rows?table[0].map(c=>digits(c).trim().toLowerCase()):null;
  const at=(row,key)=>{
    const spec=columns[key];
    if(spec===undefined)return undefined;
    if(typeof spec==='number')return row[spec];
    const index=header?.indexOf(digits(spec).trim().toLowerCase())??-1;
    if(index<0)fail(400,'column_missing',`عمود «${spec}» غير موجود في ترويسة الملف`);
    return row[index];
  };
  const body=table.slice(profile.header_rows);
  if(!body.length)fail(400,'empty_file','لا سطور حركات بعد الترويسة');
  if(body.length>MAX_ROWS)fail(400,'too_many_rows',`عدد الحركات يتجاوز ${MAX_ROWS}. قسّم الكشف إلى فترات أقصر`);
  return body.map((row,index)=>{
    const lineNo=index+1,label=`السطر ${lineNo}`;
    const txnDate=parseDate(at(row,'date'),profile.date_format,label);
    if(txnDate<periodStart||txnDate>periodEnd)fail(400,'date_outside_period',`${label}: تاريخ الحركة ${txnDate} خارج فترة الكشف المعلنة`);
    let debit=0,credit=0;
    if(columns.amount!==undefined){
      const signed=money(at(row,'amount'),`${label}: المبلغ`,{signed:true});
      if(signed===0)fail(400,'zero_amount',`${label}: حركة بمبلغ صفر`);
      if(signed<0)debit=-signed;else credit=signed;
    }else{
      debit=money(at(row,'debit'),`${label}: مدين`,{optional:true})??0;
      credit=money(at(row,'credit'),`${label}: دائن`,{optional:true})??0;
      if(debit&&credit)fail(400,'both_sides',`${label}: الحركة لها مبلغ في المدين والدائن معًا`);
      if(!debit&&!credit)fail(400,'zero_amount',`${label}: حركة بلا مبلغ`);
    }
    return {line_no:lineNo,txn_date:txnDate,
      description:v.text(String(at(row,'description')??'').replace(/\s+/gu,' '),`${label}: الوصف`,500,1),
      reference:String(at(row,'reference')??'').replace(/\s+/gu,' ').trim().slice(0,180),
      debit_minor:debit,credit_minor:credit,balance_minor:money(at(row,'balance'),`${label}: الرصيد`,{signed:true,optional:true})};
  });
}
export function cancelImport(db,supplied,importId,input){
  writing(db);const u=actor(db,supplied);preparer(db,u);
  v.object(input,['version','reason']);
  const batch=scoped(db,u,'bank_statement_imports',importId,'الدفعة غير متاحة');
  v.version(input.version,batch.version);
  if(batch.status!=='active')fail(409,'already_cancelled','الدفعة ملغاة');
  // المطابقة تُقرأ من أعضائها لا من رأسها: سطرٌ في مطابقة مجزّأة رأسها سطرٌ من دفعة أخرى هو على هذه الدفعة أيضًا.
  const onBatch=status=>db.prepare("SELECT COUNT(DISTINCT m.id) AS n FROM bank_match_items b JOIN bank_matches m ON m.id=b.match_id JOIN bank_transactions t ON t.id=b.transaction_id WHERE t.import_id=? AND b.side='line' AND m.status=?").get(batch.id,status).n;
  if(onBatch('approved'))fail(409,'match_approved','اعتُمدت مطابقة على هذه الدفعة. التصحيح بدفعة لاحقة لا بإلغاء ما بُني عليه قرار');
  // لا تُسحب دفعة من تحت معتمد ينظر في مطابقاتها: يبتّ فيها أولًا، ولا يُلغى مقترح أحد بصمت.
  const open=onBatch('proposed');
  if(open)fail(409,'matches_pending',`${open} مطابقة مقترحة على هذه الدفعة بانتظار قرار. يبتّ فيها المعتمد قبل إلغاء الدفعة`);
  const reason=v.text(input.reason,'سبب الإلغاء',2000,10),time=now();
  db.prepare("UPDATE bank_statement_imports SET status='cancelled',cancelled_by=?,cancelled_at=?,cancel_reason=?,version=version+1 WHERE id=?").run(u.id,time,reason,batch.id);
  audit(db,u,'bank_import',batch.id,'bank_import.cancelled',{status:'active'},{status:'cancelled'},reason);
  return {id:batch.id,status:'cancelled'};
}

// ==== المطابقة: يقترحها إنسان بعد أن يقرأ سبب الاقتراح، ويعتمدها إنسان آخر. ====
const MATCH_OWNER={owner:'المالية — من يحمل تصريح إعداد المطابقة البنكية',owner_role:'finance'};
// الشكل من العدد: سطر بعضو (single)، سطر بأعضاء (group)، سطور بعضو (split). كثيرٌ بكثير يُرفض.
const shapeOf=(lines,members)=>lines>1&&members>1?null:lines>1?'split':members>1?'group':'single';
// أعضاء المطابقة كما هي الآن: السجل نهائي في المنصة، والقيد اليدوي مرحّل على حساب البنك نفسه. ما لم يعد كذلك يُرفض باسمه.
function resolveMembers(db,u,wanted,account){
  const records=cashRecords(db,u.tenant_id,'0000-01-01','9999-12-31'),journals=bankJournals(db,u.tenant_id,account,'0000-01-01','9999-12-31');
  return wanted.map(w=>{
    if(!w||typeof w!=='object'||Array.isArray(w))fail(400,'invalid_fields','عضو المطابقة سجلٌ بنوعه ومعرّفه أو قيدٌ بمعرّفه');
    v.object(w,['source_kind','source_id','journal_id']);
    if(w.journal_id!==undefined&&w.journal_id!==null){
      const j=journals.find(x=>x.journal_id===w.journal_id);
      if(!j)refuse(409,'journal_not_matchable',{what:'القيد المختار ما ينطابق بسطر الكشف: لازم يكون قيدًا يدويًا مرحّلًا على حساب هذا البنك في الدفتر',
        missing:[{document:`قيد يدوي مرحّل يمسّ الحساب ${account.label} في الدفتر`,why:'المسودة ما دخلت الدفتر بعد، وقيد المستند يُطابَق بمستنده، وقيدٌ على حساب ثانٍ ما هو حركة هذا البنك',...MATCH_OWNER}],
        next:'رحّل القيد أولًا، أو طابق السطر بمستنده إن كان للقيد مستند في المنصة'});
      return j;
    }
    if(!Object.hasOwn(SOURCE_KINDS,w.source_kind))fail(400,'source_kind','نوع السجل غير مدعوم');
    const r=records.find(x=>x.source_kind===w.source_kind&&x.source_id===w.source_id);
    if(!r)fail(404,'source_not_found','السجل غير متاح أو لم يبلغ حالته النهائية (منفذ، مؤكد، معتمد)');
    return r;
  });
}
export function proposeMatch(db,supplied,input){
  writing(db);const u=actor(db,supplied);preparer(db,u);
  v.object(input,['transaction_id','transaction_ids','kind','source_kind','source_id','journal_id','members','unmatched_reason','rationale']);
  if(!['record','unmatched'].includes(input.kind))fail(400,'kind','اختر: مطابقة بسجل، أو تصنيف حركة بلا سجل');
  const ids=input.transaction_ids===undefined||input.transaction_ids===null?[input.transaction_id]:input.transaction_ids;
  if(!Array.isArray(ids)||!ids.length||ids.length>50)refuse(400,'match_shape',{what:'المطابقة تحتاج سطر كشف واحدًا على الأقل، وخمسين على الأكثر',next:'اختر سطور الكشف اللي تطابقها'});
  if(new Set(ids).size!==ids.length)refuse(400,'duplicate_member',{what:'سطر الكشف نفسه مكرر في المطابقة',next:'اختر كل سطر مرة وحدة'});
  const txns=ids.map(rowId=>scoped(db,u,'bank_transactions',rowId,'الحركة البنكية غير متاحة'));
  for(const txn of txns){
    if(db.prepare('SELECT status FROM bank_statement_imports WHERE id=?').get(txn.import_id).status!=='active')fail(409,'batch_cancelled','دفعة هذه الحركة ملغاة');
    if(db.prepare("SELECT 1 FROM bank_match_items WHERE transaction_id=? AND side='line' AND live=1").get(txn.id))fail(409,'match_exists','للحركة مطابقة قائمة أو معتمدة');
  }
  if(new Set(txns.map(t=>t.bank_account_id)).size>1)refuse(409,'lines_accounts',{what:'سطور المطابقة الواحدة من حسابين بنكيين مختلفين',next:'طابق سطور كل حساب بنكي وحدها'});
  const direction=txns[0].credit_minor>0?'in':'out';
  if(txns.some(t=>(t.credit_minor>0?'in':'out')!==direction))fail(409,'direction_mismatch','سطور المطابقة الواحدة في اتجاه واحد: كلها داخلة أو كلها خارجة');
  const account=db.prepare('SELECT * FROM bank_accounts WHERE id=?').get(txns[0].bank_account_id);
  const lineSum=txns.reduce((n,t)=>n+t.debit_minor+t.credit_minor,0),rationale=v.text(input.rationale,'سبب المطابقة كما تكتبه للمعتمد',2000,10);
  let members=[],reason=null,score=0,shape='single';
  if(input.kind==='unmatched'){
    if(txns.length!==1)refuse(400,'match_shape',{what:'التصنيف بلا سجل لسطر واحد',next:'صنّف كل سطر وحده بسببه'});
    if(!Object.hasOwn(UNMATCHED_REASONS,input.unmatched_reason))fail(400,'unmatched_reason','اختر سبب عدم وجود سجل مقابل');
    reason=input.unmatched_reason;
  }else{
    const wanted=input.members!==undefined&&input.members!==null?input.members
      :input.journal_id!==undefined&&input.journal_id!==null?[{journal_id:input.journal_id}]:[{source_kind:input.source_kind,source_id:input.source_id}];
    if(!Array.isArray(wanted)||!wanted.length||wanted.length>50)refuse(400,'match_shape',{what:'المطابقة بسجل تحتاج سجلًّا أو قيدًا واحدًا على الأقل، وخمسين على الأكثر',next:'اختر السجلات أو القيود اللي تطابق السطر'});
    members=resolveMembers(db,u,wanted,account);
    if(new Set(members.map(keyOf)).size!==members.length)refuse(400,'duplicate_member',{what:'السجل نفسه مكرر في المطابقة، والمجموع ما ينحسب بسجل مرتين',next:'اختر كل سجل مرة وحدة'});
    shape=shapeOf(txns.length,members.length);
    if(!shape)refuse(400,'match_shape',{what:`${txns.length} سطور بـ${members.length} سجلات مطابقة كثيرٍ بكثير، وما تنقرأ: أي سطر يسوّي أي سجل؟`,
      next:'طابق السطر الواحد بسجلاته (مجمّعة)، أو السجل الواحد بسطوره (مجزّأة)، كل واحدة وحدها'});
    for(const r of members)if(r.direction!==direction)fail(409,'direction_mismatch','اتجاه السجل يخالف اتجاه الحركة البنكية');
    const taken=takenKeys(db,u.tenant_id);
    for(const r of members)if(taken.has(keyOf(r)))fail(409,'source_taken','السجل مطابق بحركة أخرى');
    const memberSum=members.reduce((n,r)=>n+r.amount_minor,0);
    if(memberSum!==lineSum)refuse(409,'amount_mismatch',{what:`المطابقة ما تتوازن: ${txns.length>1?`مجموع السطور ${decimal(lineSum)}`:`مبلغ الحركة ${decimal(lineSum)}`} و${members.length>1?`مجموع السجلات ${decimal(memberSum)}`:`مبلغ السجل ${decimal(memberSum)}`} ريال`,
      missing:[{document:'مجموعان متساويان بالهللة',why:'المطابقة تقول إن هذا المال هو ذاك المال، فلا يبقى منه شيء بلا تفسير',...MATCH_OWNER}],
      next:'لو التحويل الواحد يجمع أكثر من سجل فطابقه بها كلها، ولو وصل السجل على أكثر من حركة فاختر حركاته كلها؛ والفرق الصغير رسوم تُصنّف بسطرها'});
    if(shape==='single')score=candidatesFor(db,u,txns[0]).find(c=>keyOf(c)===keyOf(members[0]))?.score??0;
  }
  // الرأس يحمل السجل حين يكون سجلًّا واحدًا من المنصة (single وsplit)، فيقرؤه كل قارئ قديم للرأس كما كان.
  const head=members.length===1&&members[0].source_kind!=='journal'?members[0]:null;
  const matchId=id(),time=now();
  db.prepare('INSERT INTO bank_matches(id,tenant_id,transaction_id,kind,shape,source_kind,source_id,unmatched_reason,amount_minor,rationale,suggested_score,prepared_by,prepared_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)')
    .run(matchId,u.tenant_id,txns[0].id,input.kind,shape,head?.source_kind??null,head?.source_id??null,reason,lineSum,rationale,score,u.id,time);
  const item=db.prepare('INSERT INTO bank_match_items(match_id,tenant_id,bank_account_id,position,side,transaction_id,source_kind,source_id,journal_id,amount_minor,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)');
  let position=0;
  for(const t of txns)item.run(matchId,u.tenant_id,account.id,++position,'line',t.id,null,null,null,t.debit_minor+t.credit_minor,time);
  for(const r of members)r.source_kind==='journal'?item.run(matchId,u.tenant_id,account.id,++position,'journal',null,null,null,r.journal_id,r.amount_minor,time)
    :item.run(matchId,u.tenant_id,account.id,++position,'record',null,r.source_kind,r.source_id,null,r.amount_minor,time);
  audit(db,u,'bank_match',matchId,'bank_match.proposed',{}, {transaction_ids:txns.map(t=>t.id),kind:input.kind,shape,members:members.map(r=>({source_kind:r.source_kind,source_id:r.source_id,amount_minor:r.amount_minor})),unmatched_reason:reason,amount_minor:lineSum});
  return {id:matchId,shape};
}
export function decideMatch(db,supplied,matchId,decision,input){
  writing(db);const u=actor(db,supplied);approver(db,u);
  v.object(input,['version','note']);
  if(!['approve','reject'].includes(decision))fail(404,'not_found','القرار غير متاح');
  const match=scoped(db,u,'bank_matches',matchId,'المطابقة غير متاحة');
  v.version(input.version,match.version);
  if(match.status!=='proposed')fail(409,'already_decided','قُرر في هذه المطابقة');
  if(match.prepared_by===u.id)fail(403,'self_approval','من أعدّ المطابقة لا يعتمدها ولا يرفضها');
  if(decision==='approve'&&match.kind==='record'){
    // الاعتماد على أعضاء ما زالوا كما كانوا لحظة الإعداد: السجل نهائي، والقيد مرحّل على حساب البنك نفسه.
    const account=db.prepare('SELECT b.* FROM bank_accounts b JOIN bank_transactions t ON t.bank_account_id=b.id WHERE t.id=?').get(match.transaction_id);
    const wanted=db.prepare("SELECT * FROM bank_match_items WHERE match_id=? AND side<>'line' ORDER BY position").all(match.id).map(i=>i.side==='journal'?{journal_id:i.journal_id}:{source_kind:i.source_kind,source_id:i.source_id});
    const current=resolveMembers(db,u,wanted,account),recorded=db.prepare("SELECT amount_minor FROM bank_match_items WHERE match_id=? AND side<>'line' ORDER BY position").all(match.id);
    if(current.some((r,i)=>r.amount_minor!==recorded[i].amount_minor))refuse(409,'match_stale',{what:'تغيّر مبلغ سجل في المطابقة بعد إعدادها، فما تُعتمد على رقم قديم',next:'ارفضها بسببها ويعيد المُعدّ إعدادها على الأرقام الحالية'});
  }
  const status=decision==='approve'?'approved':'rejected',note=v.text(input.note,'أساس القرار',2000,decision==='approve'?3:10);
  db.prepare('UPDATE bank_matches SET status=?,decided_by=?,decided_at=?,decision_note=?,version=version+1 WHERE id=?').run(status,u.id,now(),note,match.id);
  audit(db,u,'bank_match',match.id,'bank_match.'+status,{status:'proposed'},{status,shape:match.shape},note);
  return {id:match.id,status};
}

// ==== قواعد المطابقة: تقترح ولا ترحّل. ====
export function createRule(db,supplied,input){
  writing(db);const u=actor(db,supplied);preparer(db,u);
  v.object(input,['pattern','suggested_account_id','suggested_project_id','note']);
  const pattern=v.text(input.pattern,'النمط في وصف الحركة',160,3);
  const account=input.suggested_account_id?scoped(db,u,'finance_accounts',input.suggested_account_id,'الحساب المقترح غير متاح'):null;
  const project=input.suggested_project_id?scoped(db,u,'projects',input.suggested_project_id,'المشروع المقترح غير متاح'):null;
  if(!account&&!project)fail(400,'suggestion_required','القاعدة تقترح حسابًا أو مشروعًا على الأقل');
  if(db.prepare('SELECT 1 FROM bank_rules WHERE tenant_id=? AND pattern=?').get(u.tenant_id,pattern))fail(409,'duplicate_rule','النمط مسجل في قاعدة أخرى');
  const rowId=id(),time=now();
  db.prepare('INSERT INTO bank_rules(id,tenant_id,pattern,suggested_account_id,suggested_project_id,note,owner_id,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)').run(rowId,u.tenant_id,pattern,account?.id??null,project?.id??null,v.text(input.note,'ما الذي تعنيه القاعدة ومن يملكها',1500,10),u.id,time,time);
  audit(db,u,'bank_rule',rowId,'bank_rule.created',{}, {pattern,account_id:account?.id??null,project_id:project?.id??null});
  return {id:rowId};
}
export function deactivateRule(db,supplied,ruleId,input){
  writing(db);const u=actor(db,supplied);preparer(db,u);
  v.object(input,['version','note']);
  const rule=scoped(db,u,'bank_rules',ruleId,'القاعدة غير متاحة');
  v.version(input.version,rule.version);
  if(!rule.active)fail(409,'already_inactive','القاعدة موقوفة');
  db.prepare('UPDATE bank_rules SET active=0,version=version+1,updated_at=? WHERE id=?').run(now(),rule.id);
  audit(db,u,'bank_rule',rule.id,'bank_rule.deactivated',{active:1},{active:0},v.text(input.note,'سبب الإيقاف',1000,5));
  return {id:rule.id};
}

// ==== تسوية الفترة ====
// قيود سطور الكشف المصنّفة (bank_line) بحالتها وعكسها: السطر المصنّف رسومًا أو عائدًا ورُحّل قيده صار في الدفتر كما هو في البنك.
function lineJournals(db,tenantId){
  return new Map(db.prepare(`SELECT l.source_id AS transaction_id,j.id,j.status,j.entry_date,
      (SELECT r.entry_date FROM finance_reversals x JOIN finance_journals r ON r.id=x.reversal_journal_id WHERE x.original_journal_id=j.id AND r.status='posted') AS reversed_on
    FROM finance_source_links l JOIN finance_journals j ON j.id=l.journal_id WHERE l.tenant_id=? AND l.source_kind='bank_line'`).all(tenantId).map(r=>[r.transaction_id,r]));
}
export function reconciliationStatement(db,supplied,input={}){
  const u=actor(db,supplied);
  if(!can(db,u,'bank.reconcile')&&!can(db,u,'bank.reconcile.approve'))fail(403,'not_permitted','المطابقة البنكية لحامل تصريحها');
  v.object(input,['bank_account_id','period_start','period_end']);
  const account=scoped(db,u,'bank_accounts',input.bank_account_id,'الحساب البنكي غير متاح');
  const from=v.date(input.period_start),to=v.date(input.period_end);
  if(to<from)fail(400,'date_order','نهاية الفترة تسبق بدايتها');
  const batches=db.prepare("SELECT * FROM bank_statement_imports WHERE tenant_id=? AND bank_account_id=? AND status='active' AND period_end>=? AND period_start<=? ORDER BY period_end DESC,imported_at DESC").all(u.tenant_id,account.id,from,to);
  if(!batches.length)fail(409,'no_statement','لا كشف بنكي مستورد يغطي هذه الفترة. استورد الكشف أولًا');
  const closingBatch=batches[0];
  const txns=db.prepare("SELECT t.* FROM bank_transactions t JOIN bank_statement_imports i ON i.id=t.import_id WHERE t.tenant_id=? AND t.bank_account_id=? AND i.status='active' AND t.txn_date BETWEEN ? AND ? ORDER BY t.txn_date,t.line_no").all(u.tenant_id,account.id,from,to);
  const matches=lineMatches(db,u.tenant_id),journals=lineJournals(db,u.tenant_id);
  const decided=t=>{const m=matches.get(t.id);return m&&m.status==='approved'?m:null;};
  const undecided=txns.filter(t=>!decided(t));
  // المصنّف الذي رُحّل قيده ولم ينعكس حتى نهاية الفترة ليس فرقًا: هو في الدفتر كما هو في البنك.
  const classified=txns.map(t=>({t,m:decided(t)})).filter(x=>x.m&&x.m.kind==='unmatched').map(x=>{
    const j=journals.get(x.t.id)??null,reconciled=!!j&&j.status==='posted'&&j.entry_date<=to&&!(j.reversed_on&&j.reversed_on<=to);
    return {...x,j,reconciled};
  });
  const unmatchedBank=classified.filter(x=>!x.reconciled).reduce((n,x)=>n+x.t.credit_minor-x.t.debit_minor,0);
  const posted=postedSourceKeys(db,u.tenant_id),taken=takenKeys(db,u.tenant_id,{approved:true});
  const outstanding=[...cashRecords(db,u.tenant_id,from,to).filter(r=>posted.has(keyOf(r))&&!taken.has(keyOf(r))),
    ...bankJournals(db,u.tenant_id,account,from,to).filter(j=>!taken.has(keyOf(j)))].sort((a,b)=>a.date.localeCompare(b.date));
  const unmatchedBook=outstanding.reduce((n,r)=>n+(r.direction==='in'?r.amount_minor:-r.amount_minor),0);
  const book=db.prepare("SELECT COALESCE(SUM(l.debit_minor-l.credit_minor),0) AS n FROM finance_lines l JOIN finance_journals j ON j.id=l.journal_id WHERE j.tenant_id=? AND j.status='posted' AND l.account_id=? AND j.entry_date<=?").get(u.tenant_id,account.gl_account_id,to).n;
  const expected=closingBatch.closing_balance_minor-unmatchedBank+unmatchedBook,difference=expected-book;
  const inBook=classified.filter(x=>x.reconciled).length;
  return {bank_account:{...account,gl_account:db.prepare('SELECT code,name FROM finance_accounts WHERE id=?').get(account.gl_account_id)},
    period_start:from,period_end:to,
    statement:{import_id:closingBatch.id,file_name:closingBatch.file_name,covers_from:closingBatch.period_start,covers_to:closingBatch.period_end,
      closing_balance_minor:closingBatch.closing_balance_minor,batch_count:batches.length,
      covers_whole_period:closingBatch.period_end===to,
      note:closingBatch.period_end===to?'الرصيد الختامي من كشف ينتهي بنهاية الفترة':`تنبيه: أحدث كشف مستورد ينتهي في ${closingBatch.period_end} لا في ${to}؛ الرصيد الختامي المستخدم هو رصيد ذلك التاريخ`},
    statement_closing_minor:closingBatch.closing_balance_minor,unmatched_bank_minor:unmatchedBank,unmatched_book_minor:unmatchedBook,
    expected_book_minor:expected,book_balance_minor:book,difference_minor:difference,
    formula:`رصيد البنك الختامي ${decimal(closingBatch.closing_balance_minor)} − حركات بنكية غير مطابقة ${decimal(unmatchedBank)} + سجلات مرحّلة لم تظهر في البنك ${decimal(unmatchedBook)} = رصيد الدفتر المتوقع ${decimal(expected)}. رصيد الدفتر الفعلي ${decimal(book)}. الفرق ${decimal(difference)}.${inBook?` ${inBook} حركة مصنّفة رُحّل قيدها فهي في الدفتر ولا تُطرح.`:''}`,
    transaction_count:txns.length,undecided_count:undecided.length,
    undecided:undecided.map(t=>({id:t.id,txn_date:t.txn_date,description:t.description,reference:t.reference,debit_minor:t.debit_minor,credit_minor:t.credit_minor})),
    classified:classified.map(x=>({id:x.t.id,txn_date:x.t.txn_date,description:x.t.description,reason:x.m.unmatched_reason,reason_name:UNMATCHED_REASONS[x.m.unmatched_reason],debit_minor:x.t.debit_minor,credit_minor:x.t.credit_minor,
      journal_id:x.j?.id??null,journal_status:x.j?.status??null,reversed:!!x.j?.reversed_on,reconciled:x.reconciled})),
    outstanding,
    can_prepare:can(db,u,'bank.reconcile')&&!undecided.length,
    blocked_reason:undecided.length?`${undecided.length} حركة بنكية بلا قرار معتمد: طابقها بسجل أو صنّفها بسبب قبل إعداد التسوية`:null,
    book_basis:'رصيد الدفتر من القيود المرحّلة فقط على حساب البنك في الدفتر. مستند لم يُرحّل قيده ليس في الدفتر ولا يظهر في الفرق، والقيد اليدوي المرحّل على الحساب إما مطابق بسطره أو بندٌ لم يظهر في البنك.',
    note:'الاستيراد يدوي بملف يرفعه المحاسب؛ لا اتصال بأي بنك ولا مصرفية مفتوحة. الفرق يُعرض كما هو، ولا يُقفل باعتماد إلا بصفر أو بتفسير مكتوب مسجّل.'};
}
export function prepareReconciliation(db,supplied,input){
  writing(db);const u=actor(db,supplied);preparer(db,u);
  v.object(input,['bank_account_id','period_start','period_end','explanation']);
  const s=reconciliationStatement(db,u,{bank_account_id:input.bank_account_id,period_start:input.period_start,period_end:input.period_end});
  if(s.undecided_count)fail(409,'transactions_undecided',s.blocked_reason);
  const previous=db.prepare("SELECT period_end FROM bank_reconciliations WHERE tenant_id=? AND bank_account_id=? AND status='approved' ORDER BY period_end DESC LIMIT 1").get(u.tenant_id,s.bank_account.id);
  if(previous&&s.period_start<=previous.period_end)fail(409,'period_overlap',`آخر تسوية معتمدة تنتهي في ${previous.period_end}. ابدأ الفترة بعدها`);
  if(db.prepare("SELECT 1 FROM bank_reconciliations WHERE tenant_id=? AND bank_account_id=? AND period_end=? AND status<>'cancelled'").get(u.tenant_id,s.bank_account.id,s.period_end))fail(409,'reconciliation_exists','توجد تسوية قائمة لهذه الفترة');
  let explanation='';
  if(s.difference_minor){
    // الفرق بلا تفسير مكتوب فرق مخفي: لا يُحفظ ولا يُعتمد.
    if(typeof input.explanation!=='string'||input.explanation.trim().length<20)fail(400,'explanation_required',`الفرق ${decimal(s.difference_minor)} غير صفري: اكتب تفسيره المسجّل (20 حرفًا على الأقل) قبل الحفظ`);
    explanation=v.text(input.explanation,'تفسير الفرق',3000,20);
  }
  const rowId=id(),time=now();
  const snapshot={formula:s.formula,statement:s.statement,classified:s.classified,outstanding:s.outstanding,transaction_count:s.transaction_count,book_basis:s.book_basis};
  db.prepare('INSERT INTO bank_reconciliations(id,tenant_id,bank_account_id,period_start,period_end,statement_closing_minor,unmatched_bank_minor,unmatched_book_minor,expected_book_minor,book_balance_minor,difference_minor,snapshot,explanation,prepared_by,prepared_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(rowId,u.tenant_id,s.bank_account.id,s.period_start,s.period_end,s.statement_closing_minor,s.unmatched_bank_minor,s.unmatched_book_minor,s.expected_book_minor,s.book_balance_minor,s.difference_minor,JSON.stringify(snapshot),explanation,u.id,time);
  audit(db,u,'bank_reconciliation',rowId,'reconciliation.prepared',{}, {bank_account_id:s.bank_account.id,period_end:s.period_end,difference_minor:s.difference_minor},explanation);
  return {id:rowId,difference_minor:s.difference_minor};
}
export function approveReconciliation(db,supplied,reconciliationId,input){
  writing(db);const u=actor(db,supplied);approver(db,u);
  v.object(input,['version','note']);
  const row=scoped(db,u,'bank_reconciliations',reconciliationId,'التسوية غير متاحة');
  v.version(input.version,row.version);
  if(row.status!=='draft')fail(409,'not_draft','التسوية معتمدة أو ملغاة. التصحيح بتسوية لاحقة');
  if(row.prepared_by===u.id)fail(403,'self_approval','من أعدّ التسوية لا يعتمدها');
  if(row.difference_minor&&row.explanation.trim().length<20)fail(409,'explanation_required','لا تُعتمد تسوية بفرق غير صفري بلا تفسير مكتوب مسجّل');
  // الاعتماد على أرقام لم تعد صحيحة اعتماد على لا شيء: يُعاد الحساب قبل القفل.
  const fresh=reconciliationStatement(db,u,{bank_account_id:row.bank_account_id,period_start:row.period_start,period_end:row.period_end});
  if(fresh.difference_minor!==row.difference_minor||fresh.book_balance_minor!==row.book_balance_minor||fresh.statement_closing_minor!==row.statement_closing_minor||fresh.undecided_count)
    fail(409,'statement_changed','تغيرت أرقام الفترة بعد إعداد التسوية. ألغِ هذه التسوية وأعد إعدادها على الأرقام الحالية');
  db.prepare("UPDATE bank_reconciliations SET status='approved',approved_by=?,approved_at=?,approval_note=?,version=version+1 WHERE id=?").run(u.id,now(),v.text(input.note,'ما الذي راجعته قبل الاعتماد',2000,3),row.id);
  audit(db,u,'bank_reconciliation',row.id,'reconciliation.approved',{status:'draft'},{status:'approved',difference_minor:row.difference_minor});
  return {id:row.id,status:'approved'};
}
export function cancelReconciliation(db,supplied,reconciliationId,input){
  writing(db);const u=actor(db,supplied);preparer(db,u);
  v.object(input,['version','note']);
  const row=scoped(db,u,'bank_reconciliations',reconciliationId,'التسوية غير متاحة');
  v.version(input.version,row.version);
  if(row.status!=='draft')fail(409,'not_draft','التسوية المعتمدة مقفلة؛ التصحيح بتسوية لاحقة');
  if(row.prepared_by!==u.id)fail(403,'not_preparer','إلغاء المسودة لمن أعدّها');
  db.prepare("UPDATE bank_reconciliations SET status='cancelled',version=version+1 WHERE id=?").run(row.id);
  audit(db,u,'bank_reconciliation',row.id,'reconciliation.cancelled',{status:'draft'},{status:'cancelled'},v.text(input.note,'سبب الإلغاء',2000,5));
  return {id:row.id,status:'cancelled'};
}

// ==== لوحة القراءة ====
const SHAPE_NAMES=Object.freeze({single:'سطر بسجل',group:'سطر واحد بعدة سجلات',split:'عدة سطور بسجل واحد'});
export function bankBoard(db,supplied,input={}){
  const u=actor(db,supplied);
  const prepare=can(db,u,'bank.reconcile'),approve=can(db,u,'bank.reconcile.approve');
  if(!prepare&&!approve)fail(403,'not_permitted','المطابقة البنكية لحامل تصريحها');
  v.object(input,['bank_account_id']);
  const accounts=db.prepare('SELECT b.*,a.code AS gl_code,a.name AS gl_name FROM bank_accounts b JOIN finance_accounts a ON a.id=b.gl_account_id WHERE b.tenant_id=? ORDER BY b.label').all(u.tenant_id);
  const selected=(input.bank_account_id?accounts.find(a=>a.id===input.bank_account_id):accounts.find(a=>a.active))??accounts[0]??null;
  const profiles=db.prepare('SELECT * FROM bank_import_profiles WHERE tenant_id=? ORDER BY name').all(u.tenant_id).map(p=>({...p,active:!!p.active,columns:JSON.parse(p.columns),
    delimiter_name:DELIMITERS[p.delimiter].name,created_by_name:userName(db,p.created_by),actions:prepare&&p.active?['deactivate_profile']:[]}));
  const imports=selected?db.prepare('SELECT * FROM bank_statement_imports WHERE tenant_id=? AND bank_account_id=? ORDER BY period_end DESC,imported_at DESC LIMIT 40').all(u.tenant_id,selected.id).map(i=>({...i,
    imported_by_name:userName(db,i.imported_by),cancelled_by_name:userName(db,i.cancelled_by),
    approved_matches:db.prepare("SELECT COUNT(DISTINCT m.id) AS n FROM bank_match_items b JOIN bank_matches m ON m.id=b.match_id JOIN bank_transactions t ON t.id=b.transaction_id WHERE t.import_id=? AND b.side='line' AND m.status='approved'").get(i.id).n,
    actions:prepare&&i.status==='active'?['cancel_import']:[]})):[];
  const matches=lineMatches(db,u.tenant_id),journals=lineJournals(db,u.tenant_id);
  const txns=selected?db.prepare("SELECT t.* FROM bank_transactions t JOIN bank_statement_imports i ON i.id=t.import_id WHERE t.tenant_id=? AND t.bank_account_id=? AND i.status='active' ORDER BY t.txn_date DESC,t.line_no DESC LIMIT 300").all(u.tenant_id,selected.id):[];
  const records=selected?cashRecords(db,u.tenant_id,'0000-01-01','9999-12-31'):[];
  const bookJournals=selected?bankJournals(db,u.tenant_id,selected,'0000-01-01','9999-12-31'):[];
  const taken=takenKeys(db,u.tenant_id),named=new Map([...records,...bookJournals].map(r=>[keyOf(r),r]));
  const memberView=i=>{const r=named.get(memberKey(i));
    return {side:i.side,source_kind:i.side==='journal'?'journal':i.source_kind,source_id:i.side==='journal'?i.journal_id:i.source_id,amount_minor:i.amount_minor,
      source_name:i.side==='journal'?JOURNAL_NAME:SOURCE_KINDS[i.source_kind].name,reference:r?.reference??'',date:r?.date??null,party:r?.party??''};};
  const lineView=i=>{const t=db.prepare('SELECT txn_date,description,reference FROM bank_transactions WHERE id=?').get(i.transaction_id);return {transaction_id:i.transaction_id,amount_minor:i.amount_minor,...t};};
  const transactions=txns.map(t=>{
    const m=matches.get(t.id)??null,actions=[];
    const suggestions=!m&&prepare?candidatesFor(db,u,t,DEFAULT_WINDOW_DAYS,{records,journals:bookJournals,taken}):[];
    // لا يُعرض زر مطابقة بسجل بلا مرشح واحد على الأقل؛ الحركة بلا مرشح تُصنَّف بسبب، أو تُطابق مجمّعة أو مجزّأة.
    if(!m&&prepare&&suggestions.length)actions.push('propose_match');
    if(!m&&prepare)actions.push('group_match','split_match','classify_unmatched');
    if(m&&m.status==='proposed'&&approve&&m.prepared_by!==u.id)actions.push('approve_match','reject_match');
    const j=m&&m.kind==='unmatched'&&m.status==='approved'&&Object.hasOwn(JOURNALIZED_REASONS,m.unmatched_reason)?journals.get(t.id)??null:null;
    return {...t,direction:t.credit_minor>0?'in':'out',amount_minor:t.debit_minor+t.credit_minor,
      match:m?{...m,items:undefined,shape_name:SHAPE_NAMES[m.shape],source_name:m.source_kind?SOURCE_KINDS[m.source_kind].name:null,reason_name:m.unmatched_reason?UNMATCHED_REASONS[m.unmatched_reason]:null,
        members:m.items.filter(i=>i.side!=='line').map(memberView),lines:m.items.filter(i=>i.side==='line').map(lineView),
        prepared_by_name:userName(db,m.prepared_by),decided_by_name:userName(db,m.decided_by)}:null,
      // السطر المصنّف رسومًا أو عائدًا مستندٌ ينتظر قيده (bank_line): حالته من الدفتر لا من هذه الشاشة.
      bank_line:m&&m.kind==='unmatched'&&m.status==='approved'&&Object.hasOwn(JOURNALIZED_REASONS,m.unmatched_reason)?{journal_id:j?.id??null,journal_status:j?.status??null,reversed:!!j?.reversed_on}:null,
      state:m?(m.status==='approved'?(m.kind==='record'?'matched':'classified'):'proposed'):'open',
      suggestions,rule_hints:ruleHints(db,u.tenant_id,t.description),actions};
  });
  const pending=[...new Map(transactions.filter(t=>t.match&&t.match.status==='proposed').map(t=>[t.match.id,t])).values()];
  // ما يُختار في المطابقة المجمّعة والمجزّأة: سجلات الحساب وقيوده غير المطابقة، وسطوره المفتوحة.
  const openMembers=[...records,...bookJournals].filter(r=>!taken.has(keyOf(r))).map(r=>({key:keyOf(r),source_kind:r.source_kind,source_id:r.source_id,source_name:r.source_name,direction:r.direction,date:r.date,reference:r.reference,party:r.party,amount_minor:r.amount_minor}));
  const reconciliations=db.prepare('SELECT * FROM bank_reconciliations WHERE tenant_id=? ORDER BY period_end DESC,prepared_at DESC LIMIT 30').all(u.tenant_id).map(r=>({...r,snapshot:JSON.parse(r.snapshot),
    prepared_by_name:userName(db,r.prepared_by),approved_by_name:userName(db,r.approved_by),bank_account_label:accounts.find(a=>a.id===r.bank_account_id)?.label??'',
    actions:[...(r.status==='draft'&&approve&&r.prepared_by!==u.id?['approve_reconciliation']:[]),...(r.status==='draft'&&prepare&&r.prepared_by===u.id?['cancel_reconciliation']:[])]}));
  const rules=db.prepare('SELECT r.*,a.code AS account_code,a.name AS account_name,p.name AS project_name FROM bank_rules r LEFT JOIN finance_accounts a ON a.id=r.suggested_account_id LEFT JOIN projects p ON p.id=r.suggested_project_id WHERE r.tenant_id=? ORDER BY r.active DESC,r.pattern').all(u.tenant_id)
    .map(r=>({...r,active:!!r.active,owner_name:userName(db,r.owner_id),actions:prepare&&r.active?['deactivate_rule']:[]}));
  const inbox=[
    ...pending.map(t=>({id:t.match.id,title:`مطابقة بانتظار الاعتماد — ${t.description.slice(0,60)}${t.match.shape==='single'?'':` (${t.match.shape_name})`}`,due_date:t.txn_date,created_at:t.match.prepared_at,actions:t.actions.includes('approve_match')?['approve_match']:[]})).filter(i=>i.actions.length),
    ...reconciliations.filter(r=>r.actions.includes('approve_reconciliation')).map(r=>({id:r.id,title:`تسوية بنكية بانتظار الاعتماد — ${r.bank_account_label} حتى ${r.period_end}`,due_date:r.period_end,created_at:r.prepared_at,actions:['approve_reconciliation']}))
  ];
  return {today:today(),currency:'SAR',user_id:u.id,can_prepare:prepare,can_approve:approve,
    accounts:accounts.map(a=>({...a,active:!!a.active})),selected_account_id:selected?.id??null,profiles,imports,transactions,reconciliations,rules,inbox,
    open_members:openMembers,
    source_kinds:SOURCE_KINDS,unmatched_reasons:UNMATCHED_REASONS,journalized_reasons:JOURNALIZED_REASONS,shape_names:SHAPE_NAMES,date_formats:DATE_FORMATS,delimiters:DELIMITERS,column_keys:COLUMN_KEYS,window_days:DEFAULT_WINDOW_DAYS,
    ledger_accounts:db.prepare("SELECT id,code,name,account_type FROM finance_accounts WHERE tenant_id=? AND active=1 ORDER BY code").all(u.tenant_id),
    projects:db.prepare('SELECT id,name FROM projects WHERE tenant_id=? ORDER BY name').all(u.tenant_id),
    unmatched_count:transactions.filter(t=>t.state==='open').length,pending_count:pending.length,
    note:'الاستيراد يدوي بملف يرفعه المحاسب؛ لا اتصال بأي بنك ولا مصرفية مفتوحة (Open Banking) ولا تغذية تلقائية. '+
      'الحركة المستوردة لا تُعدَّل إطلاقًا؛ التصحيح بإلغاء الدفعة كاملة قبل اعتماد أي مطابقة عليها. '+
      'النظام يقترح ويشرح سبب اقتراحه، والمطابقة لا تُسجَّل إلا بإقرار بشري، ومن يُعِدّها لا يعتمدها. '+
      'لا يُنشأ قيد محاسبي آليًا: الحركة بلا سجل مقابل تُصنَّف بسبب، والرسوم والعائد منها تنتظر قيدًا يُعِدّه المحاسب في الدفتر ويمر باعتماده المستقل.'};
}

/* ───── سطر الكشف المصنّف مصدرًا للدفتر (الحزمة 3) ───── */
// السطر المصنّف رسومًا أو عائدًا واعتُمد تصنيفه صار مستندًا نهائيًا ينتظر قيدًا: جانب البنك على حساب هذا الحساب البنكي نفسه
// في الدفتر (bank_accounts.gl_account_id) لا على غرض «البنك» العام — للمنشأة أكثر من حساب بنكي، وتسوية كل واحد تقرأ حسابه.
// ومركز التكلفة لسطر البنك مركزُ ربط الغرض المقابل، فالقيد كله على مركز واحد. لا يستورد الدفتر: الدفتر يستورد هذا الملف.
const mappingCentre=(db,tenantId,purpose,date)=>db.prepare('SELECT cost_center_id FROM finance_account_mappings WHERE tenant_id=? AND purpose=? AND approved_by IS NOT NULL AND effective_from<=? ORDER BY effective_from DESC,approved_at DESC LIMIT 1').get(tenantId,purpose,date)?.cost_center_id??null;
function classifiedLine(db,tenantId,transactionId){
  if(typeof transactionId!=='string')return null;
  return db.prepare(`SELECT t.*,a.gl_account_id,a.label AS account_label,m.id AS match_id,m.status AS match_status,m.unmatched_reason,m.rationale,m.prepared_by,m.prepared_at,m.decided_by,m.decided_at,m.decision_note
    FROM bank_transactions t JOIN bank_accounts a ON a.id=t.bank_account_id LEFT JOIN bank_matches m ON m.transaction_id=t.id AND m.kind='unmatched' AND m.status<>'rejected'
    WHERE t.id=? AND t.tenant_id=?`).get(transactionId,tenantId)??null;
}
const lineReference=x=>(x.reference||`BANK-${x.txn_date}-${x.line_no}`).slice(0,170);
const classifiedLines=(db,tenantId)=>db.prepare(`SELECT t.id,t.txn_date,t.reference,t.line_no,t.debit_minor,t.credit_minor FROM bank_matches m JOIN bank_transactions t ON t.id=m.transaction_id
  WHERE m.tenant_id=? AND m.kind='unmatched' AND m.status='approved' AND m.unmatched_reason IN (${Object.keys(JOURNALIZED_REASONS).map(k=>`'${k}'`).join(',')})`).all(tenantId);
registerSourceKind({key:'bank_line',name:'سطر كشف مصنّف (رسوم أو عائد)',module:'bank-reconciliation',bank:'cash',
  build(db,u,id){
    const x=classifiedLine(db,u.tenant_id,id);
    if(!x||x.match_status!=='approved'||!Object.hasOwn(JOURNALIZED_REASONS,x.unmatched_reason))return null;
    const purpose=JOURNALIZED_REASONS[x.unmatched_reason],amount=x.debit_minor+x.credit_minor,inflow=x.credit_minor>0;
    const bankSide={account_id:x.gl_account_id,cost_center_id:mappingCentre(db,u.tenant_id,purpose,x.txn_date),debit_minor:inflow?amount:0,credit_minor:inflow?0:amount,memo:inflow?`داخل إلى ${x.account_label}`:`خارج من ${x.account_label}`};
    const counter={purpose,debit_minor:inflow?0:amount,credit_minor:inflow?amount:0,memo:UNMATCHED_REASONS[x.unmatched_reason]};
    return {date:x.txn_date,reference:lineReference(x),description:`${UNMATCHED_REASONS[x.unmatched_reason]} — ${x.description}`.slice(0,900),lines:inflow?[bankSide,counter]:[counter,bankSide]};
  },
  pending:(db,tenantId)=>classifiedLines(db,tenantId).map(x=>({source_id:x.id,reference:lineReference(x),amount_minor:x.debit_minor+x.credit_minor,date:x.txn_date})),
  document:(db,tenantId,id)=>{const x=classifiedLine(db,tenantId,id);return x&&{reference:lineReference(x),date:x.txn_date,amount_minor:x.debit_minor+x.credit_minor,status:x.match_status??'open',
    description:`${x.unmatched_reason?UNMATCHED_REASONS[x.unmatched_reason]:'سطر كشف بلا تصنيف'} — ${x.description}`};},
  approvals:(db,tenantId,id)=>{const x=classifiedLine(db,tenantId,id);if(!x?.match_id)return [];
    return [{role:'صنّف السطر',actor_id:x.prepared_by,at:x.prepared_at,note:x.rationale},...(x.decided_by?[{role:'اعتمد التصنيف',actor_id:x.decided_by,at:x.decided_at,note:x.decision_note}]:[])];}});
