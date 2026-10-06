import { createHash, randomUUID } from 'node:crypto';
import { audit, now, hash, verifyAudit } from './db.mjs';
import { fail } from './auth.mjs';
import * as v from './validation.mjs';
import { refuse, actorOrRefuse } from './refusal.mjs';
import { can } from './access.mjs';
import { financeCapabilities } from './finance.mjs';
import { pendingSources, controlReconciliation } from './ledger.mjs';
import { sourceKind, sourceLinks } from './ledger-sources.mjs';

// حزمة تدقيق الفترة (الحزمة 3): ما يحتاجه مدقق ليفحص شهرًا بلا المنصة — القيود بسطورها وقراراتها وترحيلها وعكوسها، والمستندات
// المصدر ومن أعدّها واعتمدها ونفّذها وما سوّاها وما عكسها، والمطابقات والتسويات البنكية، والإقفال، ومطابقة الحسابات الرقابية،
// وقطعة سلسلة التدقيق (audit_events) التي تغطي الفترة. ملفٌ واحد ببصمة واحدة (SHA-256 على JSON مرتّب المفاتيح)، يُعاد
// استيراده فتُفحص بصمته وسلسلته بـverifyAuditPackage وحدها.
//
// السلسلة في المنصة واحدة لكل الكيانات (app/db.mjs audit): كل حدث يحمل بصمة الحدث قبله أيًّا كان كيانه. فالقطعة تُصدَّر كاملة
// الترتيب، والحدث الذي لا يخص سجلًّا في الحزمة — حدث كيان آخر، أو حدث موارد بشرية في الكيان نفسه — يُصدَّر بصمةً ورقم تسلسل
// بلا محتوى: تبقى السلسلة متصلة من طرفيها، ولا يخرج في حزمة مالية ما لا يخصها. والحدث الذي يخص سجلًّا فيها يُصدَّر كاملًا، فتُعاد
// بصمته من قيمه عند الاستيراد: تعديل حرف فيه يكسرها، وحذف حدث يكسر الحلقة التالية.
//
// التصدير لمن يقرأ الدفتر المالي ويحمل تصريح «تصدير حزمة التدقيق» معًا، والتصدير نفسه حدثٌ في السلسلة يسمّي بصمة ما خرج.
export const AUDIT_FORMAT='platform-audit-v1';
export const AUDIT_CAPABILITY='finance.audit.export';
const MAX_DAYS=366;
const riyadhDate=iso=>new Date(Date.parse(iso)+3*3600000).toISOString().slice(0,10);
const canonical=value=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(k=>[k,canonical(value[k])])):value;
export const packageDigest=body=>createHash('sha256').update(JSON.stringify(canonical(body))).digest('hex');
const EVENT_FIELDS=['tenant_id','actor_id','entity_type','entity_id','action','before_json','after_json','reason','created_at','policy_version','previous_hash'];

function actor(db,supplied){
  const u=actorOrRefuse(db,supplied);
  const reads=financeCapabilities(db,u).includes('read'),holds=can(db,u,AUDIT_CAPABILITY);
  if(!reads||!holds)refuse(403,'audit_export_denied',{what:'تصدير حزمة التدقيق لمن يقرأ الدفتر المالي ويحمل تصريح التدقيق معًا',
    missing:[...(reads?[]:[{document:'تفويض قراءة في الدفتر المالي',why:'الحزمة تحمل القيود والمستندات والمبالغ',owner:'مسؤول التفويضات المالية',owner_role:'finance'}]),
      ...(holds?[]:[{document:`تصريح «تصدير حزمة التدقيق» (${AUDIT_CAPABILITY})`,why:'الحزمة تُخرج من المنصة قيود الفترة ومستنداتها وسلسلة تدقيقها، فتُمنح لمن يدقق بيد ثانية',owner:'الأدمن الأول',owner_role:'admin'}])],
    next:'اطلب ما ينقصك ممن يملكه، ثم صدّر الحزمة من جديد'});
  return u;
}
function periodOf(input){
  v.object(input,['from','to','month']);
  let from,to;
  if(input.month!==undefined){
    if(typeof input.month!=='string'||!/^\d{4}-(0[1-9]|1[0-2])$/.test(input.month))refuse(400,'invalid_period',{what:'الشهر بصيغة 2026-09',next:'أرسل الشهر، أو تاريخي البداية والنهاية'});
    const [y,m]=input.month.split('-').map(Number);from=`${input.month}-01`;to=`${input.month}-${String(new Date(Date.UTC(y,m,0)).getUTCDate()).padStart(2,'0')}`;
  }else{from=v.date(input.from);to=v.date(input.to);}
  if(to<from)refuse(400,'date_order',{what:`نهاية الفترة ${to} قبل بدايتها ${from}`,next:'أرسل الفترة بتاريخ بدايتها ثم نهايتها'});
  if((Date.parse(to)-Date.parse(from))/86400000>MAX_DAYS)refuse(400,'period_too_long',{what:`الفترة أطول من ${MAX_DAYS} يومًا`,next:'صدّر كل سنة مالية أو شهر في حزمة'});
  return {from,to};
}

/* ───── محتوى الحزمة ───── */
function journalsOf(db,tenantId,from,to){
  const owners=new Map();
  for(const r of db.prepare('SELECT source_kind,source_id,journal_id FROM finance_source_links WHERE tenant_id=?').all(tenantId))owners.set(r.journal_id,{kind:r.source_kind,id:r.source_id});
  for(const r of db.prepare('SELECT l.payable_id,l.journal_id FROM finance_payable_links l JOIN finance_journals j ON j.id=l.journal_id WHERE j.tenant_id=?').all(tenantId))if(!owners.has(r.journal_id))owners.set(r.journal_id,{kind:'supplier_invoice',id:r.payable_id});
  return db.prepare('SELECT * FROM finance_journals WHERE tenant_id=? AND entry_date BETWEEN ? AND ? ORDER BY entry_date,created_at,id').all(tenantId,from,to).map(j=>({
    id:j.id,status:j.status,entry_date:j.entry_date,period_id:j.period_id,currency:j.currency,description:j.description,evidence:j.evidence,source_reference:j.source_reference,
    prepared_by:j.prepared_by,created_at:j.created_at,source:owners.get(j.id)??null,
    lines:db.prepare('SELECT l.position,a.code AS account_code,a.name AS account_name,a.account_type,c.code AS cost_center_code,l.debit_minor,l.credit_minor,l.memo FROM finance_lines l JOIN finance_accounts a ON a.id=l.account_id JOIN finance_cost_centers c ON c.id=l.cost_center_id WHERE l.journal_id=? ORDER BY l.position').all(j.id),
    decisions:db.prepare('SELECT decision,actor_id,note,revision,created_at FROM finance_decisions WHERE journal_id=? ORDER BY revision,created_at').all(j.id),
    posting:db.prepare('SELECT posted_by,note,posted_at FROM finance_postings WHERE journal_id=?').get(j.id)??null,
    reverses:db.prepare('SELECT original_journal_id FROM finance_reversals WHERE reversal_journal_id=?').get(j.id)?.original_journal_id??null,
    reversed_by:db.prepare('SELECT reversal_journal_id FROM finance_reversals WHERE original_journal_id=?').get(j.id)?.reversal_journal_id??null}));
}
const linkItems=(db,tenantId,kind,id,role)=>sourceLinks(kind,role).flatMap(l=>l.list(db,tenantId,id))
  .map(i=>({kind:i.kind,id:i.id,reference:i.reference??null,date:i.date??null,amount_minor:i.amount_minor??null,status:i.status??null,
    ...(i.applied_minor!==undefined?{applied_minor:i.applied_minor}:{}),...(i.settled_minor!==undefined?{settled_minor:i.settled_minor}:{})}));
function documentsOf(db,u,from,to){
  const journalIds=(kind,id)=>[...db.prepare('SELECT journal_id FROM finance_source_links WHERE source_kind=? AND source_id=? AND tenant_id=?').all(kind,id,u.tenant_id).map(r=>r.journal_id),
    ...(kind==='supplier_invoice'?db.prepare('SELECT l.journal_id FROM finance_payable_links l JOIN finance_journals j ON j.id=l.journal_id WHERE l.payable_id=? AND j.tenant_id=?').all(id,u.tenant_id).map(r=>r.journal_id):[])];
  return pendingSources(db,u).filter(s=>s.date>=from&&s.date<=to).sort((a,b)=>a.date.localeCompare(b.date)||a.source_kind.localeCompare(b.source_kind)||a.source_id.localeCompare(b.source_id)).map(s=>{
    const def=sourceKind(s.source_kind);
    return {kind:s.source_kind,kind_name:s.source_name,id:s.source_id,reference:s.reference,date:s.date,amount_minor:s.amount_minor,journal_status:s.journal_status,
      journal_ids:[...new Set(journalIds(s.source_kind,s.source_id))],document:def.document?.(db,u.tenant_id,s.source_id)??null,
      approvals:(def.approvals?.(db,u.tenant_id,s.source_id)??[]).map(a=>({role:a.role,actor_id:a.actor_id,at:a.at??null,note:a.note??null})),
      settles:linkItems(db,u.tenant_id,s.source_kind,s.source_id,'settles'),settlements:linkItems(db,u.tenant_id,s.source_kind,s.source_id,'settlement'),
      reversal_documents:linkItems(db,u.tenant_id,s.source_kind,s.source_id,'reversal')};
  });
}
function bankOf(db,tenantId,from,to){
  const reconciliations=db.prepare(`SELECT id,bank_account_id,period_start,period_end,statement_closing_minor,unmatched_bank_minor,unmatched_book_minor,expected_book_minor,book_balance_minor,difference_minor,
      explanation,status,prepared_by,prepared_at,approved_by,approved_at FROM bank_reconciliations WHERE tenant_id=? AND period_end BETWEEN ? AND ? ORDER BY period_end,prepared_at`).all(tenantId,from,to);
  const matches=db.prepare(`SELECT DISTINCT m.id,m.kind,m.shape,m.status,m.amount_minor,m.unmatched_reason,m.rationale,m.prepared_by,m.prepared_at,m.decided_by,m.decided_at,m.decision_note FROM bank_matches m
      JOIN bank_match_items b ON b.match_id=m.id AND b.side='line' JOIN bank_transactions t ON t.id=b.transaction_id WHERE m.tenant_id=? AND t.txn_date BETWEEN ? AND ? ORDER BY m.prepared_at,m.id`).all(tenantId,from,to)
    .map(m=>({...m,items:db.prepare('SELECT position,side,transaction_id,source_kind,source_id,journal_id,amount_minor,live FROM bank_match_items WHERE match_id=? ORDER BY position').all(m.id),
      lines:db.prepare("SELECT t.id,t.txn_date,t.reference,t.description,t.debit_minor,t.credit_minor FROM bank_match_items b JOIN bank_transactions t ON t.id=b.transaction_id WHERE b.match_id=? AND b.side='line' ORDER BY b.position").all(m.id)}));
  return {reconciliations,matches};
}
function closeOf(db,tenantId,from,to){
  const periods=db.prepare('SELECT id,name,starts_on,ends_on,status,closed_by,closed_at,close_evidence FROM finance_periods WHERE tenant_id=? AND ends_on>=? AND starts_on<=? ORDER BY starts_on').all(tenantId,from,to);
  const closes=db.prepare('SELECT id,period_key,finance_period_id,status,opened_by,approved_by,approved_at,approval_note,ledger_locked,reopen_count FROM close_periods WHERE tenant_id=? AND period_key BETWEEN ? AND ? ORDER BY period_key').all(tenantId,from.slice(0,7),to.slice(0,7));
  const reopenings=periods.length?db.prepare(`SELECT id,period_id,period_version,requested_by,reason,status,decided_by,decided_at,decision_note,reclose_due_on,reclosed_by,reclosed_at FROM finance_period_reopenings
      WHERE tenant_id=? AND period_id IN (${periods.map(()=>'?').join(',')}) ORDER BY created_at`).all(tenantId,...periods.map(p=>p.id)):[];
  return {finance_periods:periods,close_periods:closes,reopenings};
}
function trialBalance(db,tenantId,to){
  const rows=db.prepare(`SELECT a.code,a.name,a.account_type,COALESCE(SUM(l.debit_minor),0) AS debit_minor,COALESCE(SUM(l.credit_minor),0) AS credit_minor FROM finance_accounts a
      LEFT JOIN finance_lines l ON l.account_id=a.id AND l.journal_id IN (SELECT id FROM finance_journals WHERE tenant_id=? AND status='posted' AND entry_date<=?)
    WHERE a.tenant_id=? GROUP BY a.id ORDER BY a.code`).all(tenantId,to,tenantId).filter(r=>r.debit_minor||r.credit_minor);
  const debit=rows.reduce((n,r)=>n+r.debit_minor,0),credit=rows.reduce((n,r)=>n+r.credit_minor,0);
  return {as_of:to,rows,debit_minor:debit,credit_minor:credit,balanced:debit===credit};
}
// قطعة السلسلة: من أول حدث للكيان في الفترة إلى آخرها، كل حدث بترتيبه. الحدث الذي يخص سجلًّا في الحزمة كاملٌ بقيمه، وغيره بصمة.
function chainOf(db,tenantId,from,to,ids){
  const bounds=db.prepare("SELECT MIN(seq) AS first,MAX(seq) AS last FROM audit_events WHERE tenant_id=? AND date(created_at,'+3 hours') BETWEEN ? AND ?").get(tenantId,from,to);
  const head=db.prepare('SELECT seq,hash FROM audit_events ORDER BY seq DESC LIMIT 1').get()??null;
  if(bounds.first===null)return {anchor:null,events:[],head:head&&{seq:head.seq,hash:head.hash},live_chain_verified:verifyAudit(db)};
  const events=db.prepare('SELECT * FROM audit_events WHERE seq BETWEEN ? AND ? ORDER BY seq').all(bounds.first,bounds.last).map(e=>
    e.tenant_id===tenantId&&ids.has(e.entity_id)?{seq:e.seq,full:true,...Object.fromEntries(EVENT_FIELDS.map(k=>[k,e[k]])),hash:e.hash}:{seq:e.seq,full:false,previous_hash:e.previous_hash,hash:e.hash});
  return {anchor:events[0].previous_hash,events,head:head&&{seq:head.seq,hash:head.hash},live_chain_verified:verifyAudit(db)};
}

export function exportAuditPackage(db,supplied,input={}){
  if(!db.isTransaction)fail(500,'transaction_required','تصدير حزمة التدقيق يحتاج معاملة قاعدة بيانات، لأن التصدير نفسه يُسجَّل');
  const u=actor(db,supplied),{from,to}=periodOf(input),tenantId=u.tenant_id;
  const journals=journalsOf(db,tenantId,from,to),documents=documentsOf(db,u,from,to),bank=bankOf(db,tenantId,from,to),close=closeOf(db,tenantId,from,to);
  const journalSet=new Set(journals.map(j=>j.id));
  const reversals=db.prepare('SELECT x.original_journal_id,x.reversal_journal_id,x.requested_by,x.reason,x.created_at FROM finance_reversals x JOIN finance_journals j ON j.id=x.reversal_journal_id WHERE j.tenant_id=? ORDER BY x.created_at').all(tenantId)
    .filter(r=>journalSet.has(r.original_journal_id)||journalSet.has(r.reversal_journal_id));
  // ما تخصه الحزمة في السلسلة: سجلاتها بمعرّفاتها، ومعها ما يُسجَّل حدثه على سجلٍّ أعلى (الاستحقاق للفاتورة والقبض، والشراء والفاتورة للمستحق).
  const ids=new Set([...journalSet,...documents.map(d=>d.id),...bank.reconciliations.map(r=>r.id),...bank.matches.map(m=>m.id),
    ...close.finance_periods.map(p=>p.id),...close.close_periods.map(p=>p.id),...close.reopenings.map(r=>r.id)]);
  for(const d of documents){
    if(['tax_invoice','credit_note'].includes(d.kind)){const c=db.prepare('SELECT claim_id FROM tax_invoices WHERE id=?').get(d.id);if(c?.claim_id)ids.add(c.claim_id);}
    if(d.kind==='ar_receipt'){const c=db.prepare('SELECT claim_id FROM ar_receipts WHERE id=?').get(d.id);if(c?.claim_id)ids.add(c.claim_id);}
    if(d.kind==='supplier_invoice'){const y=db.prepare('SELECT purchase_id,invoice_id FROM procurement_payables WHERE id=?').get(d.id);if(y){ids.add(y.purchase_id);ids.add(y.invoice_id);}}
  }
  const body={format:AUDIT_FORMAT,generated_at:now(),generated_by:u.id,
    scope:{tenant_id:tenantId,from,to,currency:'SAR',basis:'القيود بتاريخ قيدها، والمستندات النهائية بتاريخها، والمطابقات بتاريخ سطر الكشف، والأحداث بيوم الرياض'},
    journals,documents,reversals,bank,close,controls:controlReconciliation(db,tenantId,to).controls.map(c=>({key:c.key,name:c.name,mapped:c.mapped,subledger_minor:c.subledger_minor,
      ledger_minor:c.ledger_minor,difference_minor:c.difference_minor,balanced:c.balanced,items:c.items.map(i=>({reason:i.reason,source_kind:i.source_kind,source_id:i.source_id,journal_id:i.journal_id,difference_minor:i.difference_minor}))})),
    trial_balance:trialBalance(db,tenantId,to),chain:chainOf(db,tenantId,from,to,ids),
    note:'ملفٌ داخلي من المنصة للتدقيق. البصمة على JSON مرتّب المفاتيح؛ الأحداث الكاملة تُعاد بصمتها من قيمها، والأحداث بلا محتوى حلقاتٌ تُبقي السلسلة متصلة. مقارنة «head» ببصمة آخر حدث في المنصة وقت الفحص تقول إن السلسلة لم تُكتب من جديد بعد التصدير.'};
  const digest=packageDigest(body),exportId=randomUUID();
  audit(db,u,'audit_export',exportId,'audit_export.exported',{},{from,to,digest,journals:journals.length,documents:documents.length,events:body.chain.events.length,
    full_events:body.chain.events.filter(e=>e.full).length});
  return {...body,digest};
}

/* ───── الفحص عند الاستيراد: بلا المنصة ───── */
// reseal: يعيد حساب البصمة قبل الفحص كما يفعل من عدّل الملف ثم ختمه من جديد، فيبقى فحص السلسلة وحده حكمًا.
export function verifyAuditPackage(pkg,{reseal=false}={}){
  const problems=[];
  if(!pkg||typeof pkg!=='object'||pkg.format!==AUDIT_FORMAT)return {ok:false,problems:[`not a ${AUDIT_FORMAT} package`],checked:{events:0,full_events:0,journals:0,documents:0}};
  const {digest,...body}=pkg;
  if(!reseal&&packageDigest(body)!==digest)problems.push('package digest does not match its body: the file was changed after export');
  let previous=pkg.chain?.anchor??null,lastSeq=null;
  for(const e of pkg.chain?.events??[]){
    if(lastSeq!==null&&e.seq!==lastSeq+1)problems.push(`seq ${e.seq}: the chain skips from seq ${lastSeq}`);
    if(e.previous_hash!==previous)problems.push(`seq ${e.seq}: its previous hash does not link to the event before it`);
    if(e.full&&hash(JSON.stringify(EVENT_FIELDS.map(k=>e[k])))!==e.hash)problems.push(`seq ${e.seq}: the event no longer hashes to itself`);
    previous=e.hash;lastSeq=e.seq;
  }
  for(const j of pkg.journals??[]){
    const net=(j.lines??[]).reduce((n,l)=>n+l.debit_minor-l.credit_minor,0);
    if(net!==0)problems.push(`journal ${j.id}: lines do not balance (${net})`);
  }
  if(pkg.trial_balance&&pkg.trial_balance.debit_minor!==pkg.trial_balance.credit_minor)problems.push('trial balance does not balance');
  return {ok:!problems.length,problems,checked:{events:(pkg.chain?.events??[]).length,full_events:(pkg.chain?.events??[]).filter(e=>e.full).length,journals:(pkg.journals??[]).length,documents:(pkg.documents??[]).length}};
}
