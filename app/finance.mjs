import { randomUUID } from 'node:crypto';
import { audit, now } from './db.mjs';
import { fail } from './auth.mjs';
import * as v from './validation.mjs';
import { viewingAs } from './request-context.mjs';
import { refuse } from './refusal.mjs';

const MAX_MINOR = 1_000_000_000_000;
const referenceTables = {accounts:'finance_accounts',cost_centers:'finance_cost_centers',periods:'finance_periods'};
const journalFields = ['period_id','entry_date','description','evidence','currency','source_reference','lines'];
function transactionRequired(db) {
  if (!db.isTransaction) fail(500,'transaction_required','تتطلب الكتابة المالية معاملة قاعدة بيانات');
}
function currentActor(db,supplied) {
  const u = supplied && db.prepare('SELECT id,tenant_id,role,active FROM users WHERE id=? AND tenant_id=? AND active=1').get(supplied.id,supplied.tenant_id);
  if (!u || !['employee','manager','pm'].includes(u.role)) fail(403,'financial_access_denied','لا يوجد تصريح مالي صالح لهذا الحساب');
  // «جرّب كمستخدم»: التفويض المالي منحٌ، والمنح كلها تسقط أثناء التجربة. الدفتر المالي مغلق تحت أي دور مختار.
  if (viewingAs(u)) fail(403,'financial_access_denied','التفويض المالي لا يعمل أثناء «جرّب كمستخدم»: أنهِ التجربة من الشريط الأحمر ثم افتح الشاشة بحسابك');
  const time = now();
  u.permissions = [...new Set(db.prepare('SELECT action FROM finance_grants WHERE tenant_id=? AND user_id=? AND granted_role=? AND revoked_at IS NULL AND valid_from<=? AND valid_until>?').all(u.tenant_id,u.id,u.role,time,time).map(g=>g.action))];
  if (!u.permissions.includes('read')) fail(403,'financial_access_denied','لا يوجد تصريح قراءة مالية صالح');
  return u;
}
function requireAction(u,action) {
  if (!u.permissions.includes(action)) fail(403,'financial_action_denied','لا يوجد تفويض مالي صالح لهذا الفعل');
}
export function financeCapabilities(db,u){
  try{return currentActor(db,u).permissions;}catch(error){if(error.code==='financial_access_denied')return [];throw error;}
}
function amount(value) {
  if (typeof value!=='string' || !/^(0|[1-9]\d{0,10})(\.\d{1,2})?$/.test(value)) fail(400,'invalid_money','أدخل مبلغًا عشريًا بمنزلتين كحد أقصى');
  const [whole,fraction=''] = value.split('.');
  const minor = BigInt(whole)*100n+BigInt(fraction.padEnd(2,'0'));
  if (minor>BigInt(MAX_MINOR)) fail(400,'invalid_money','المبلغ يتجاوز الحد العددي المحلي');
  return Number(minor);
}
const decimal = minor => `${Math.floor(minor/100)}.${String(minor%100).padStart(2,'0')}`;
const ref = (value,label='مرجع المصدر') => v.text(value,label,180).normalize('NFKC').trim().replace(/\s+/gu,' ').toUpperCase();
function scopeRow(db,u,table,id) {
  const row = typeof id==='string' && db.prepare(`SELECT * FROM ${table} WHERE id=? AND tenant_id=?`).get(id,u.tenant_id);
  if (!row) fail(404,'not_found','السجل المالي غير متاح');
  return row;
}
function openPeriod(db,u,id,date) {
  const period = scopeRow(db,u,'finance_periods',id);
  if (period.status!=='open') fail(409,'period_closed','الفترة المحاسبية مقفلة');
  if (date<period.starts_on || date>period.ends_on) fail(400,'date_outside_period','تاريخ القيد خارج الفترة المختارة');
  return period;
}
function cleanLines(db,u,lines) {
  if (!Array.isArray(lines)||lines.length<2||lines.length>50) fail(400,'invalid_lines','القيد يحتاج من سطرين إلى خمسين سطرًا');
  let debits=0n,credits=0n;
  const clean = lines.map((line,index)=>{
    v.object(line,['account_id','cost_center_id','debit','credit','memo']);
    const account = scopeRow(db,u,'finance_accounts',line.account_id),center = scopeRow(db,u,'finance_cost_centers',line.cost_center_id);
    if (!account.active||!center.active||account.currency!=='SAR') fail(409,'inactive_reference','الحساب أو مركز التكلفة غير نشط');
    const debit_minor=amount(line.debit),credit_minor=amount(line.credit);
    if ((debit_minor>0)===(credit_minor>0)) fail(400,'invalid_line_side','كل سطر يحمل مبلغًا في جانب واحد فقط');
    debits+=BigInt(debit_minor);credits+=BigInt(credit_minor);
    return {position:index+1,account_id:account.id,cost_center_id:center.id,debit_minor,credit_minor,memo:v.text(line.memo,'وصف السطر',500)};
  });
  if (debits!==credits || debits===0n) fail(409,'unbalanced_journal','مجموع المدين لا يساوي مجموع الدائن');
  if (debits>BigInt(MAX_MINOR)) fail(400,'invalid_money','مجموع القيد يتجاوز الحد العددي المحلي');
  return clean;
}
function sourceInvariant(db,j,lines) {
  // قيد مولَّد من مستند مصدر: سطوره تساوي ما حُسب من المستند، ولا تُعدل يدويًا.
  const sourced = db.prepare('SELECT expected_lines FROM finance_source_links WHERE journal_id=?').get(j.id);
  if (j.source_kind==='procurement_payable') {
    const link = db.prepare('SELECT * FROM finance_payable_links WHERE journal_id=?').get(j.id);
    const debit = lines.reduce((n,l)=>n+BigInt(l.debit_minor),0n);
    // قيد المستحق بمساريه يحفظ إجمالي المستحق. المسار اليدوي القديم سطران؛ وقيد «فاتورة مورد مطابقة» سطوره من المستند نفسه
    // (صافٍ لكل مركز، وضريبة مدخلات، والتزام بالإجمالي) ويحرسها فحص السطور المتوقعة تحت.
    if (!link || debit!==BigInt(link.amount_minor) || (!sourced && lines.length!==2)) fail(409,'source_mismatch','القيد يجب أن يحافظ على قيمة المستحق المصدر');
    if (!sourced) {
      const debitLine=lines.find(l=>l.debit_minor>0),creditLine=lines.find(l=>l.credit_minor>0);
      const debitAccount=db.prepare('SELECT account_type FROM finance_accounts WHERE id=?').get(debitLine.account_id);
      const creditAccount=db.prepare('SELECT account_type FROM finance_accounts WHERE id=?').get(creditLine.account_id);
      if (!['asset','expense'].includes(debitAccount.account_type)||creditAccount.account_type!=='liability') fail(409,'source_accounts','قيد المستحق يحتاج حساب تكلفة أو أصل مدين وحساب التزام دائن');
    }
  }
  if (sourced) {
    const expected = JSON.parse(sourced.expected_lines);
    if (expected.length!==lines.length || expected.some((e,i)=>e.account_id!==lines[i].account_id || e.debit_minor!==lines[i].debit_minor || e.credit_minor!==lines[i].credit_minor)) fail(409,'source_mismatch','سطور القيد تتبع المستند المصدر ولا تُعدل يدويًا. صحح المستند أو اعكس القيد');
  }
  if (j.source_kind==='reversal') {
    const original=db.prepare('SELECT * FROM finance_lines WHERE journal_id=? ORDER BY position').all(j.source_id);
    if (original.length!==lines.length || original.some((l,i)=>l.account_id!==lines[i].account_id || l.cost_center_id!==lines[i].cost_center_id || l.debit_minor!==lines[i].credit_minor || l.credit_minor!==lines[i].debit_minor)) fail(409,'reversal_mismatch','سطور العكس يجب أن تقابل سطور القيد الأصلي تمامًا');
  }
}
function cleanJournal(db,u,input) {
  if (input.currency!=='SAR') fail(400,'invalid_currency','العملة المحلية المهيأة هي SAR');
  const entry_date=v.date(input.entry_date);
  const period=openPeriod(db,u,input.period_id,entry_date);
  return {period_id:period.id,entry_date,description:v.text(input.description,'وصف القيد',1000,3),evidence:v.text(input.evidence,'دليل القيد',3000,3),currency:'SAR',source_reference:ref(input.source_reference),lines:cleanLines(db,u,input.lines)};
}
function replaceLines(db,j,lines) {
  db.prepare('DELETE FROM finance_lines WHERE journal_id=?').run(j.id);
  const insert=db.prepare('INSERT INTO finance_lines VALUES(?,?,?,?,?,?,?,?)');
  for(const l of lines) insert.run(j.id,j.tenant_id,l.position,l.account_id,l.cost_center_id,l.debit_minor,l.credit_minor,l.memo);
}
function snapshot(db,j) {
  return {...j,lines:db.prepare('SELECT * FROM finance_lines WHERE journal_id=? ORDER BY position').all(j.id),
    decisions:db.prepare('SELECT * FROM finance_decisions WHERE journal_id=? ORDER BY revision').all(j.id),
    posting:db.prepare('SELECT * FROM finance_postings WHERE journal_id=?').get(j.id)??null,
    reversal:db.prepare('SELECT r.*,j.status AS reversal_status FROM finance_reversals r JOIN finance_journals j ON j.id=r.reversal_journal_id WHERE r.original_journal_id=?').get(j.id)??null};
}
function actionsFor(u,j) {
  const actions=[],own=j.prepared_by===u.id;
  if(own&&j.status==='draft'&&u.permissions.includes('prepare')) actions.push('edit','submit');
  if(!own&&j.status==='pending'&&u.permissions.includes('approve')) actions.push('return','approve','reject');
  if(!own&&j.status==='approved'&&u.permissions.includes('post')) actions.push('post');
  if(!own&&j.status==='posted'&&u.permissions.includes('reverse')&&u.permissions.includes('prepare')) actions.push('reverse');
  return actions;
}
function journalDetail(db,u,j) {
  const state=snapshot(db,j);
  return {...state,allowed_actions:actionsFor(u,j).filter(a=>a!=='reverse'||!state.reversal),
    history:db.prepare('SELECT version,actor_id,action,snapshot,created_at FROM finance_versions WHERE journal_id=? ORDER BY version').all(j.id).map(h=>({...h,snapshot:JSON.parse(h.snapshot)}))};
}
function versionAndAudit(db,u,j,action,before={},reason='') {
  db.prepare('INSERT INTO finance_versions VALUES(?,?,?,?,?,?)').run(j.id,j.version,u.id,action,JSON.stringify(snapshot(db,j)),now());
  audit(db,u,'finance_journal',j.id,action,before,{status:j.status,version:j.version,revision:j.revision},reason);
}
function insertJournal(db,u,clean,sourceKind,sourceId) {
  if(db.prepare('SELECT 1 FROM finance_journals WHERE tenant_id=? AND source_kind=? AND source_id=?').get(u.tenant_id,sourceKind,sourceId)) fail(409,'duplicate_source','المصدر مرتبط بقيد محفوظ بالفعل');
  const id=randomUUID(),time=now();
  db.prepare('INSERT INTO finance_journals(id,tenant_id,period_id,entry_date,description,evidence,currency,source_kind,source_id,source_reference,prepared_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)').run(id,u.tenant_id,clean.period_id,clean.entry_date,clean.description,clean.evidence,clean.currency,sourceKind,sourceId,clean.source_reference,u.id,time,time);
  const j=scopeRow(db,u,'finance_journals',id);replaceLines(db,j,clean.lines);return j;
}

export function createFinanceReference(db,supplied,kind,input) {
  transactionRequired(db);const u=currentActor(db,supplied);requireAction(u,'configure');
  if(!Object.hasOwn(referenceTables,kind)) fail(400,'invalid_reference_kind','نوع السجل المالي غير متاح');
  const id=randomUUID(),time=now();
  if(kind==='accounts') {
    v.object(input,['code','name','account_type','currency']);
    const code=ref(input.code,'رمز الحساب');
    if(input.currency!=='SAR') fail(400,'invalid_currency','العملة المحلية المهيأة هي SAR');
    if(!['asset','liability','equity','income','expense'].includes(input.account_type)) fail(400,'account_type','نوع الحساب غير صالح');
    if(db.prepare('SELECT 1 FROM finance_accounts WHERE tenant_id=? AND code=?').get(u.tenant_id,code)) fail(409,'duplicate_reference','رمز الحساب مسجل');
    db.prepare('INSERT INTO finance_accounts(id,tenant_id,code,name,account_type,currency,created_by,created_at) VALUES(?,?,?,?,?,?,?,?)').run(id,u.tenant_id,code,v.text(input.name,'اسم الحساب',180),input.account_type,'SAR',u.id,time);
  } else if(kind==='cost_centers') {
    v.object(input,['code','name']);const code=ref(input.code,'رمز مركز التكلفة');
    if(db.prepare('SELECT 1 FROM finance_cost_centers WHERE tenant_id=? AND code=?').get(u.tenant_id,code)) fail(409,'duplicate_reference','رمز مركز التكلفة مسجل');
    db.prepare('INSERT INTO finance_cost_centers(id,tenant_id,code,name,created_by,created_at) VALUES(?,?,?,?,?,?)').run(id,u.tenant_id,code,v.text(input.name,'اسم مركز التكلفة',180),u.id,time);
  } else {
    v.object(input,['name','starts_on','ends_on']);const start=v.date(input.starts_on),end=v.date(input.ends_on);
    if(end<start) fail(400,'date_order','نهاية الفترة تسبق بدايتها');
    if(db.prepare('SELECT 1 FROM finance_periods WHERE tenant_id=? AND starts_on<=? AND ends_on>=?').get(u.tenant_id,end,start)) fail(409,'period_overlap','الفترة تتداخل مع فترة محفوظة');
    db.prepare('INSERT INTO finance_periods(id,tenant_id,name,starts_on,ends_on,created_by,created_at) VALUES(?,?,?,?,?,?,?)').run(id,u.tenant_id,v.text(input.name,'اسم الفترة',180),start,end,u.id,time);
  }
  const result=scopeRow(db,u,referenceTables[kind],id);audit(db,u,'finance_'+kind,id,'created',{},result);return result;
}

export function financeReferenceAction(db,supplied,kind,id,action,input) {
  transactionRequired(db);const u=currentActor(db,supplied);requireAction(u,'configure');
  if(!Object.hasOwn(referenceTables,kind)) fail(400,'invalid_reference_kind','نوع السجل المالي غير متاح');
  v.object(input,['version','note']);const row=scopeRow(db,u,referenceTables[kind],id);v.version(input.version,row.version);const note=v.text(input.note,'دليل تغيير الحالة',3000,3);
  if(kind==='periods') {
    // فتح الفترة المقفلة مضبوط بمسار واحد (الترحيل 168): طلبٌ مسبَّب في «الإقفال الشهري» يعتمده شخص ثالث بسلطة الدفتر، فتنفتح
    // الفترة بسجل فتحٍ يحفظ من أقفلها ومتى. وإعادة إقفالها هي اعتماد الإقفال هناك بفحوصه، لا إقفالٌ مباشر من هنا.
    if(action==='reopen'&&row.status==='closed'){
      const bound=db.prepare('SELECT period_key FROM close_periods WHERE finance_period_id=? AND tenant_id=?').get(row.id,u.tenant_id);
      refuse(409,'period_reopen_controlled',{what:`الفترة المحاسبية «${row.name}» مقفلة، وما تنفتح من الدفتر مباشرة`,
        missing:[bound?{document:`طلب فتح مسبَّب لإقفال ${bound.period_key} في «الإقفال الشهري»`,why:'فتح فترة مقفلة يغيّر أرقامًا اعتُمدت، فيمرّ بسبب مكتوب وقرار شخص ثالث غير اللي أقفل وغير اللي طلب، وبموعد لإعادة إقفالها',owner:'المالية — من يحمل تصريح إدارة الإقفال الشهري',owner_role:'finance'}
          :{document:'فترة محاسبية مربوطة بإقفال شهري',why:'هذه الفترة أُقفلت من الدفتر مباشرة وما لها إقفال شهري مربوط، والفتح المضبوط يمرّ بقائمة الإقفال وحدها',owner:'مالك إجراء الإقفال — قرار فتح فترة أُقفلت خارج قائمة الإقفال',owner_role:'finance'}],
        next:bound?`افتح «الإقفال الشهري» واطلب فتح إقفال ${bound.period_key}؛ إذا اعتمده شخص ثالث انفتحت الفترة المحاسبية معه`:'ما لها مسار فتح اليوم: القرار عند مالك إجراء الإقفال'});
    }
    if(action==='close'&&row.status==='open'&&db.prepare("SELECT 1 FROM finance_period_reopenings WHERE period_id=? AND status='approved' AND reclosed_at IS NULL").get(row.id))
      refuse(409,'period_reclose_controlled',{what:`الفترة المحاسبية «${row.name}» منفتحة بفتحٍ معتمد، وإعادة إقفالها ما تصير من الدفتر مباشرة`,
        missing:[{document:'اعتماد الإقفال الشهري من جديد',why:'إعادة الإقفال تمرّ بفحوص الإقفال نفسها التي مرّ بها الإقفال الأول',owner:'المالية — من يحمل تصريح إدارة الإقفال الشهري',owner_role:'finance'}],
        next:'افتح «الإقفال الشهري» واعتمد إقفال الشهر؛ الاعتماد يشغّل الفحوص ثم يقفل الفترة'});
    if(action!=='close'||row.status!=='open') fail(403,'transition_denied','لا يمكن إعادة فتح الفترة أو تكرار إقفالها');
    db.prepare("UPDATE finance_periods SET status='closed',version=version+1,closed_by=?,close_evidence=?,closed_at=? WHERE id=?").run(u.id,note,now(),id);
  } else {
    if(!['activate','deactivate'].includes(action)||(action==='activate')===Boolean(row.active)) fail(403,'transition_denied','الحالة المالية لا تسمح بهذا الفعل');
    db.prepare(`UPDATE ${referenceTables[kind]} SET active=?,version=version+1 WHERE id=?`).run(action==='activate'?1:0,id);
  }
  const result=scopeRow(db,u,referenceTables[kind],id);audit(db,u,'finance_'+kind,id,action,{version:row.version,active:row.active,status:row.status},{version:result.version,active:result.active,status:result.status},note);return result;
}

export function createJournal(db,supplied,input) {
  transactionRequired(db);const u=currentActor(db,supplied);requireAction(u,'prepare');v.object(input,journalFields);
  const clean=cleanJournal(db,u,input),j=insertJournal(db,u,clean,'manual',clean.source_reference);
  versionAndAudit(db,u,j,'created');return journalDetail(db,u,j);
}

// قيد من مستند تشغيلي (فاتورة، إشعار، قبض، مسير): مسودة يعدها مخول ثم تمر بالاعتماد والترحيل المستقلين كأي قيد.
// payable: قيد «فاتورة مورد مطابقة» هو قيد المستحق نفسه — هويته (procurement_payable، معرّف المستحق) ورابطه في finance_payable_links
// كما كان يكتبهما المسار اليدوي — فيراه كل قارئ قائم (المشتريات، قائمة إقفال المشروع، هذا الدفتر) بلا تعديل، ولا يُبنى للمستحق قيدٌ ثانٍ.
export function createSourcedJournal(db,supplied,{sourceKind,sourceId,period_id,entry_date,description,evidence,source_reference,lines,payable=null}) {
  transactionRequired(db);const u=currentActor(db,supplied);requireAction(u,'prepare');
  if(db.prepare('SELECT 1 FROM finance_source_links WHERE source_kind=? AND source_id=?').get(sourceKind,sourceId)) fail(409,'duplicate_source','للمستند قيد محفوظ بالفعل؛ لا يُرحَّل مرتين');
  const clean=cleanJournal(db,u,{period_id,entry_date,description,evidence,currency:'SAR',source_reference,lines});
  const j=payable?insertJournal(db,u,clean,'procurement_payable',payable.id):insertJournal(db,u,clean,'manual',`${sourceKind}:${sourceId}`);
  if(payable) db.prepare('INSERT INTO finance_payable_links VALUES(?,?,?,?,?,?,?)').run(payable.id,j.id,payable.amount_minor,payable.currency,u.id,clean.evidence,now());
  db.prepare('INSERT INTO finance_source_links VALUES(?,?,?,?,?,?,?)').run(sourceKind,sourceId,u.tenant_id,j.id,JSON.stringify(clean.lines.map(l=>({account_id:l.account_id,debit_minor:l.debit_minor,credit_minor:l.credit_minor}))),u.id,now());
  sourceInvariant(db,j,clean.lines);versionAndAudit(db,u,j,'created_from_'+sourceKind);return journalDetail(db,u,j);
}

// المسار اليدوي لقيد المستحق مغلق لقيد جديد (الحزمة 3). كان يقيّد إجمالي الفاتورة على حسابين يختارهما المُعدّ ومركز تكلفة
// واحد، بلا ضريبة مدخلات ولا توزيع على مخصصات البنود، وبجانب مصدرٍ ثانٍ للمستحق نفسه يصير المستحق الواحد قابلًا للقيد مرتين.
// القيود القديمة منه تبقى مقروءة كما هي (listFinance.eligible_payables، والمشتريات، وقائمة إقفال المشروع)، ويُعدّ القيد الجديد
// من «القوائم المالية والترحيل» بنوع «فاتورة مورد مطابقة» (app/ledger.mjs). المسار في الخادم باقٍ ويعيد هذا الرفض.
export function createJournalFromPayable(db,supplied) {
  transactionRequired(db);const u=currentActor(db,supplied);requireAction(u,'prepare');
  refuse(409,'payable_source_moved',{what:'قيد المستحق ما عاد يتجهز من هنا: هذا المسار كان يقيّد إجمالي الفاتورة على حساب ومركز واحد بلا ضريبة مدخلات',
    missing:[{document:'قيد «فاتورة مورد مطابقة» من أرقام المستند نفسه',why:'ينبني صافيًا لكل مركز تكلفة، وضريبة مدخلات متحقَّق منها، والتزامًا بإجمالي الفاتورة — ومستحقٌ واحد له قيد واحد',owner:'المالية — من يحمل تفويض الإعداد المالي',owner_role:'finance'}],
    next:'افتح «القوائم المالية والترحيل» وجهّز قيد فاتورة المورد من «مستندات وترحيلها». القيود القديمة من هذا المسار تبقى مقروءة كما هي'});
}

export function journalAction(db,supplied,id,action,input) {
  transactionRequired(db);const u=currentActor(db,supplied),j=scopeRow(db,u,'finance_journals',id);
  const fields=action==='edit'?journalFields:action==='reverse'?['period_id','entry_date','reason','evidence']:['note'];
  v.object(input,['version',...fields]);v.version(input.version,j.version);
  if(!['edit','submit','return','approve','reject','post','reverse'].includes(action)) fail(400,'invalid_action','الفعل المالي غير متاح');
  if(!actionsFor(u,j).includes(action)) fail(403,'transition_denied','لا يسمح التفويض أو حالة القيد أو استقلال الفاعل بهذا الإجراء');
  if(action==='reverse') {
    if(db.prepare('SELECT 1 FROM finance_reversals WHERE original_journal_id=?').get(j.id)) fail(409,'duplicate_reversal','يوجد قيد عكس محفوظ لهذا المصدر');
    const reason=v.text(input.reason,'سبب العكس',3000,3),sourceLines=db.prepare('SELECT * FROM finance_lines WHERE journal_id=? ORDER BY position').all(j.id);
    const clean=cleanJournal(db,u,{period_id:input.period_id,entry_date:input.entry_date,description:`عكس: ${j.description}`.slice(0,1000),evidence:input.evidence,currency:j.currency,source_reference:`REV/${j.id}`,lines:sourceLines.map(l=>({account_id:l.account_id,cost_center_id:l.cost_center_id,debit:decimal(l.credit_minor),credit:decimal(l.debit_minor),memo:l.memo}))});
    const reversal=insertJournal(db,u,clean,'reversal',j.id);
    db.prepare('INSERT INTO finance_reversals VALUES(?,?,?,?,?)').run(j.id,reversal.id,u.id,reason,now());
    sourceInvariant(db,reversal,clean.lines);versionAndAudit(db,u,reversal,'reversal_created',{source_journal_id:j.id},reason);return journalDetail(db,u,reversal);
  }
  if(action==='edit') {
    const clean=cleanJournal(db,u,input);
    if(clean.source_reference!==j.source_reference) fail(409,'source_immutable','مرجع المصدر ثابت؛ يمكن تعديل وصف القيد والدليل');
    sourceInvariant(db,j,clean.lines);replaceLines(db,j,clean.lines);
    db.prepare('UPDATE finance_journals SET period_id=?,entry_date=?,description=?,evidence=?,version=version+1,updated_at=? WHERE id=?').run(clean.period_id,clean.entry_date,clean.description,clean.evidence,now(),j.id);
  } else {
    const note=v.text(input.note,'دليل الإجراء المالي',3000,3);
    const state={submit:'pending',return:'draft',approve:'approved',reject:'rejected',post:'posted'}[action];
    if(['submit','approve','post'].includes(action)) {
      openPeriod(db,u,j.period_id,j.entry_date);
      const lines=db.prepare('SELECT * FROM finance_lines WHERE journal_id=? ORDER BY position').all(j.id);
      cleanLines(db,u,lines.map(l=>({account_id:l.account_id,cost_center_id:l.cost_center_id,debit:decimal(l.debit_minor),credit:decimal(l.credit_minor),memo:l.memo})));sourceInvariant(db,j,lines);
    }
    if(['return','approve','reject'].includes(action)) db.prepare('INSERT INTO finance_decisions VALUES(?,?,?,?,?,?,?,?)').run(randomUUID(),j.id,j.revision,{return:'returned',approve:'approved',reject:'rejected'}[action],u.id,note,j.version+1,now());
    if(action==='post') {
      const approval=db.prepare("SELECT * FROM finance_decisions WHERE journal_id=? AND revision=? AND decision='approved'").get(j.id,j.revision);
      const approvedUser=approval&&db.prepare('SELECT id,tenant_id FROM users WHERE id=?').get(approval.actor_id);
      let currentApproval=false;
      try {currentApproval=!!approvedUser&&currentActor(db,approvedUser).permissions.includes('approve');} catch(error) {if(!error.code)throw error;}
      if(!currentApproval) fail(403,'approval_authority_revoked','صلاحية المعتمد سُحبت؛ تعذر الترحيل');
      db.prepare('INSERT INTO finance_postings VALUES(?,?,?,?,?)').run(j.id,u.id,note,j.version+1,now());
    }
    db.prepare('UPDATE finance_journals SET status=?,revision=revision+?,version=version+1,updated_at=? WHERE id=?').run(state,action==='submit'?1:0,now(),j.id);
  }
  const result=scopeRow(db,u,'finance_journals',j.id);versionAndAudit(db,u,result,action,{status:j.status,version:j.version,revision:j.revision},input.note??'');return journalDetail(db,u,result);
}

// عبارات حالة الدفع نفسها في app/procurement.mjs (PAYMENT_STATUS_NAMES): تُكتب هنا لأن الدفتر ورقة لا تستورد المشتريات
// (المشتريات ← محاور المشروع ← هذا الملف، فالاستيراد العكسي دورة). المصدر الحقيقي للحالة واحد: payment_orders.
const PAYMENT_NAMES={not_paid:'غير مدفوع',payment_pending:'أمر دفع بانتظار الاعتماد',payment_approved:'أمر دفع معتمد لم يُنفَّذ بعد',partially_paid:'مدفوع جزئيًا',paid:'مدفوع'};
function safeReportNumber(value) {
  if(value>BigInt(Number.MAX_SAFE_INTEGER)||value<BigInt(Number.MIN_SAFE_INTEGER)) fail(409,'report_overflow','تجاوز التقرير حد الحساب المحلي؛ يلزم تجميع بنطاق أصغر');
  return Number(value);
}
export function listFinance(db,supplied) {
  const u=currentActor(db,supplied),accounts=db.prepare('SELECT * FROM finance_accounts WHERE tenant_id=? ORDER BY code').all(u.tenant_id);
  const ledgerRows=db.prepare("SELECT l.*,j.entry_date,j.description,j.source_reference,j.source_kind,j.source_id,p.posted_at,p.posted_by FROM finance_lines l JOIN finance_journals j ON j.id=l.journal_id JOIN finance_postings p ON p.journal_id=j.id WHERE j.tenant_id=? AND j.status='posted' ORDER BY j.entry_date,p.posted_at,j.id,l.position").all(u.tenant_id);
  const sums=new Map(accounts.map(a=>[a.id,{debit:0n,credit:0n,running:0n}]));
  const ledger=ledgerRows.map(l=>{const s=sums.get(l.account_id);s.debit+=BigInt(l.debit_minor);s.credit+=BigInt(l.credit_minor);s.running+=BigInt(l.debit_minor)-BigInt(l.credit_minor);return {...l,running_balance_minor:safeReportNumber(s.running)};});
  let totalDebit=0n,totalCredit=0n,balanceDebit=0n,balanceCredit=0n;
  const trialRows=accounts.map(a=>{const s=sums.get(a.id),balance=s.debit-s.credit;totalDebit+=s.debit;totalCredit+=s.credit;if(balance>0n)balanceDebit+=balance;else balanceCredit-=balance;return {account_id:a.id,code:a.code,name:a.name,account_type:a.account_type,debit_minor:safeReportNumber(s.debit),credit_minor:safeReportNumber(s.credit),balance_debit_minor:safeReportNumber(balance>0n?balance:0n),balance_credit_minor:safeReportNumber(balance<0n?-balance:0n)};});
  // حالة الدفع لكل مستحق من أوامر دفعه (payment_orders) لا نصًّا ثابتًا: كان التقرير كله يقول «not_paid» ولو نُفّذ الدفع في البنك.
  // حالة دفع المستحق من رؤية payable_balances (الحزمة 3) لا من payment_orders.payable_id: الأمر المجمّع يحمل مستحقاته في سطوره،
  // والتحويل الراجع ليس دفعًا، والإشعار الدائن ينقص المطلوب. القراءة القديمة كانت تقول «غير مدفوع» لمستحق دُفع في أمر مجمّع.
  const eligible_payables=u.permissions.includes('source_procurement')?db.prepare("SELECT p.id,p.amount_minor,p.currency,i.supplier_key,i.supplier_reference,l.journal_id,j.status AS journal_status,CASE WHEN j.status='posted' AND rj.status='posted' THEN 'reversed_locally' WHEN j.status='posted' THEN 'posted_locally' ELSE 'not_posted' END AS posting_status,b.adjusted_minor,b.paid_minor,b.returned_minor,b.pending_minor,b.approved_minor FROM procurement_payables p JOIN procurement_invoices i ON i.id=p.invoice_id JOIN payable_balances b ON b.payable_id=p.id LEFT JOIN finance_payable_links l ON l.payable_id=p.id LEFT JOIN finance_journals j ON j.id=l.journal_id LEFT JOIN finance_reversals r ON r.original_journal_id=j.id LEFT JOIN finance_journals rj ON rj.id=r.reversal_journal_id WHERE i.tenant_id=? ORDER BY p.created_at").all(u.tenant_id)
    .map(({pending_minor,approved_minor,...p})=>{const payment_status=p.adjusted_minor>0&&p.paid_minor>=p.adjusted_minor?'paid':p.paid_minor>0?'partially_paid':approved_minor>0?'payment_approved':pending_minor>0?'payment_pending':'not_paid';return {...p,payment_status,payment_status_name:PAYMENT_NAMES[payment_status]};}):[];
  return {accounts,cost_centers:db.prepare('SELECT * FROM finance_cost_centers WHERE tenant_id=? ORDER BY code').all(u.tenant_id),periods:db.prepare('SELECT * FROM finance_periods WHERE tenant_id=? ORDER BY starts_on DESC').all(u.tenant_id),
    journals:db.prepare('SELECT * FROM finance_journals WHERE tenant_id=? ORDER BY created_at DESC,id').all(u.tenant_id).map(j=>journalDetail(db,u,j)),
    trial_balance:{rows:trialRows,total_debit_minor:safeReportNumber(totalDebit),total_credit_minor:safeReportNumber(totalCredit),balance_debit_minor:safeReportNumber(balanceDebit),balance_credit_minor:safeReportNumber(balanceCredit),is_balanced:totalDebit===totalCredit},ledger,eligible_payables,permissions:u.permissions,user_id:u.id,currency:'SAR',generated_at:now(),report_source:'finance_journals.status=posted + finance_postings + finance_lines',report_period:'all_posted_dates',external_posting_status:'not_configured'};
}
