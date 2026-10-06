// المسير الموازي والانتقال (الحزمة 4، P4-HR-5، الترحيل 176).
//
// شهور الموازاة تثبت المنصة بندًا بندًا قبل أن تدفع لأحد: النظام السابق يدفع الشهر وهو سجلّه (D10)، والمنصة تحسب الشهر نفسه
// بالاحتساب النقي نفسه الذي يكتب منه المسير سطوره (computeRunLines في app/payroll.mjs، ببصمة مدخلاته من الترحيل 173)، وتقارنه
// بدفعة من النظام السابق: ملف البنك المدفوع ومعه الكشف التفصيلي (D8)، يستوردهما مُعد الرواتب ويؤكدهما شخص ثانٍ.
// الفرق يُحفظ بندًا لموظف بالرقمين، ويفسّره شخص ثانٍ (لا من قارن ولا من استورد ولا صاحب الأجر) بسبب من قائمة يديرها المالك.
// والانتقال يقرره شخصان، ولا يُقترح حتى يعتمد المالك قيمتين ما لهما رقم في الكود (D9): حد الفروق غير المفسّرة في الشهر،
// وعدد الشهور الموازية المتتالية. الحارس الذي يمنع المنصة من دفع الشهر الموازي في app/payroll-parallel-guard.mjs.
import { randomUUID } from 'node:crypto';
import { audit, now, hash } from './db.mjs';
import { refuse, actorOrRefuse } from './refusal.mjs';
import { holds, capabilityHolders } from './access.mjs';
import * as v from './validation.mjs';
import { registerAdoption, adopted, registerOptionList, optionsFor, requireOption, optionLabel } from './options.mjs';
import { computeRunLines, INPUT_PARTS } from './payroll.mjs';
import { personName, personByUsername } from './people-read.mjs';
import { notifyMany, SUBJECT_LINKS } from './notices.mjs';
import { riyadhToday } from './riyadh-time.mjs';
import { canonicalStatus } from './static/vocabulary.mjs';
import { parallelMonth, isParallelMonth, assertPlatformPays, parallelBlocker, dropParallelMonths } from './payroll-parallel-guard.mjs';
export { parallelMonth, isParallelMonth, assertPlatformPays, parallelBlocker, dropParallelMonths };

const CAPS=['payroll.prepare','payroll.review','payroll.approve'];
const id=()=>randomUUID();
const OWNER={owner:'مدير رأس المال البشري — معتمد المسير',owner_role:'payroll.approve'};
const PREPARER={owner:'مُعد الرواتب',owner_role:'payroll.prepare'};
const SECOND={owner:'مراجع المسير أو معتمده — غير اللي قارن واللي استورد',owner_role:'payroll.review'};
const ACCESS={owner:'مسؤول الصلاحيات',owner_role:'admin'};

// الإشعار يفتح هذه الشاشة. يُسجَّل من الوحدة نفسها كما تسجّل app/vendors.mjs موضوعها.
Object.assign(SUBJECT_LINKS,{payroll_parallel:'#payroll-parallel'});

/* ───── قيمتا المالك (D9): مسجّلتان بلا رقم، وما دامتا كذلك لا شهر نظيف ولا انتقال ───── */
export const TOLERANCE='payroll.parallel.tolerance';
export const REQUIRED_MONTHS='payroll.parallel.required_months';
const DECIDER={owner:'مدير رأس المال البشري — من يحمل تصريح اعتماد المسير',owner_role:'payroll.approve',manage_capability:'payroll.approve',governance:'managed',shape:'object'};
registerAdoption({key:TOLERANCE,label:'حد الفروق غير المفسّرة في الشهر الموازي',module:'payroll',...DECIDER,default:{unexplained_max:null},
  basis:'ما قرّره أحد بعد، والمنصة ما تخترع حدًّا: حتى يقرّره المالك ويعتمده شخص ثانٍ ما ينحسب شهر موازٍ نظيفًا ولا ينقرر الانتقال. القيمة {"unexplained_max": عدد صحيح من 0}، والموصى به 0: كل فرق يتفسّر'});
registerAdoption({key:REQUIRED_MONTHS,label:'عدد الشهور الموازية المتتالية قبل الانتقال',module:'payroll',...DECIDER,default:{months:null},
  basis:'ما قرّره أحد بعد، والمنصة ما تخترع عددًا: حتى يقرّره المالك ويعتمده شخص ثانٍ ما ينقرر الانتقال. القيمة {"months": عدد صحيح من 1 إلى 12}، والموصى به 3'});
const whole=(value,min,max)=>{const n=typeof value==='string'&&/^\d{1,4}$/.test(value.trim())?Number(value.trim()):value;return Number.isInteger(n)&&n>=min&&n<=max?n:null;};
export function parallelValues(db,tenantId){
  const t=adopted(db,tenantId,TOLERANCE),m=adopted(db,tenantId,REQUIRED_MONTHS);
  const unexplained_max=t.source==='adopted'?whole(t.value?.unexplained_max,0,10000):null,months=m.source==='adopted'?whole(m.value?.months,1,12):null;
  // قيمة معتمدة لا تُقرأ عددًا صحيحًا في حدّه (سُجّلت نصًّا أو خارج الحد) لا تُخمَّن: تُعامل غير محددة ويُقال ذلك باسمه.
  return {tolerance:{decision:t,unexplained_max,set:unexplained_max!==null,invalid:t.source==='adopted'&&unexplained_max===null},
    required_months:{decision:m,months,set:months!==null,invalid:m.source==='adopted'&&months===null}};
}

// سبب الفرق: قائمة يديرها المالك. ما فيها «المنصة غلطانة»: فرقٌ سببه المنصة ما يتفسّر، يتصحّح مدخله أو قاعدته وتنعاد المقارنة.
export const CAUSE_LIST='payroll.parallel.cause';
registerOptionList({key:CAUSE_LIST,label:'سبب فرق المسير الموازي',module:'payroll',owner:OWNER.owner,owner_role:OWNER.owner_role,manage_capability:'payroll.approve',
  governance:'managed',columns:['payroll_parallel_explanations.cause'],
  defaults:[{value:'legacy_error',label:'غلط في النظام السابق — حساب المنصة هو الصحيح'},{value:'legacy_rounding',label:'تقريب في النظام السابق'},
    {value:'timing',label:'توقيت: البند نفسه في شهر ثاني عند أحد النظامين'},{value:'approved_rule',label:'قاعدة معتمدة في المنصة تختلف عن طريقة النظام السابق'},
    {value:'outside_payroll',label:'صرف أو خصم سوّاه النظام السابق برّا المسير'},{value:'other',label:'سبب ثاني ينكتب كامل'}],
  note:'ما فيه سبب «المنصة غلطانة»: الفرق اللي سببه المنصة ما يتفسّر — يتصحّح مدخله أو قاعدته وتنعاد المقارنة.'});

/* ───── البنود ───── */
export const COMPONENTS=Object.freeze([['presence','الوجود في المسير'],['basic','الراتب الأساسي'],['housing','بدل السكن'],['transport','بدل النقل'],
  ['other_allowance','بدل آخر'],['overtime','العمل الإضافي'],['other_additions','مكافآت وبدلات لمرة'],['absence_deduction','خصم الغياب'],
  ['gosi_employee','التأمينات — حصة الموظف'],['advance','أقساط السلف'],['other_deductions','خصومات أخرى'],['gosi_employer','التأمينات — حصة المنشأة']]
  .map(([key,name])=>Object.freeze({key,name})));
const COMPONENT_NAME=Object.fromEntries(COMPONENTS.map(c=>[c.key,c.name]));
const COMPARED=['basic','housing','transport','other_allowance','overtime','other_additions','absence_deduction','gosi_employee','advance','other_deductions','gosi_employer'];
const EARNINGS=['basic','housing','transport','other_allowance','overtime','other_additions'],DEDUCTIONS=['absence_deduction','gosi_employee','advance','other_deductions'];
// أعمدة الملفين كما يجهّزهما مُعد الرواتب من النظام السابق. عمود «employee» اسم دخول الموظف في المنصة.
export const BREAKDOWN_COLUMNS=Object.freeze(['employee',...EARNINGS,...DEDUCTIONS,'net']);
export const BANK_COLUMNS=Object.freeze(['employee','amount']);

/* ───── من يعمل هنا ───── */
function actor(db,supplied){const u=actorOrRefuse(db,supplied);u.caps=CAPS.filter(key=>holds(db,u,key));return u;}
function staff(db,supplied){
  const u=actor(db,supplied);
  if(!u.caps.length)refuse(403,'not_permitted',{what:'«المسير الموازي» لحاملي تصاريح الرواتب: فيه أجر كل موظف بندًا بندًا',
    missing:[{document:'تصريح إعداد المسير أو مراجعته أو اعتماده',why:'المقارنة تعرض أجور الموظفين بأسمائهم',...ACCESS}],next:'إذا شغلك في الرواتب اطلب التصريح من مسؤول الصلاحيات'});
  return u;
}
function need(u,keys,what){
  if(keys.some(k=>u.caps.includes(k)))return;
  refuse(403,'not_permitted',{what,missing:[{document:`تصريح ${keys.join(' أو ')}`,why:'كل خطوة في الموازي لصاحب تصريحها، والخطوة الثانية لغير صاحب الأولى',...ACCESS}],
    next:'اطلبها من زميل يحمل التصريح، أو اطلب التصريح من مسؤول الصلاحيات'});
}
function writing(db){if(!db.isTransaction)refuse(409,'transaction_required',{what:'ما انكتب شي: الكتابة برّا معاملة قاعدة بيانات',next:'نفّذ النداء داخل transaction(db,…) مثل بقية وحدات المنصة'});}
const MONTH=/^\d{4}-(0[1-9]|1[0-2])$/;
function monthValue(value){
  if(typeof value!=='string'||!MONTH.test(value))refuse(400,'invalid_month',{what:`الشهر «${String(value??'').slice(0,20)}» ما ينقرى`,next:'اكتب الشهر بصيغة 2026-06 (سنة-شهر)'});
  return value;
}
export const nextMonth=month=>{const [y,m]=month.split('-').map(Number);return m===12?`${y+1}-01`:`${y}-${String(m+1).padStart(2,'0')}`;};
const status=(module,key)=>({status:key,state:canonicalStatus(module,key).status,status_name:canonicalStatus(module,key).module_phrase??key});
const stale=()=>refuse(409,'stale_version',{what:'تغيّر السجل أثناء الحفظ، فما انكتب شي فوق التغيير',next:'حدّث الشاشة وأعد المحاولة على النسخة الجديدة'});
function separation(what,document){refuse(409,'separation_of_duties',{what,missing:[{document,why:'الشاهد على الرقم غير اللي جهّزه',...SECOND}],next:'اطلبها من زميل يحمل التصريح'});}

/* ───── ملفات النظام السابق: CSV منسوخ من الجدول أو ملصوق منه ───── */
// الفاصل من سطر العناوين (الجدولة حين يُلصق من برنامج الجداول، أو الفاصلة المنقوطة، أو الفاصلة)، والاقتباس بقاعدة RFC 4180.
function delimiterOf(line){const counts=[['\t',line.split('\t').length],[';',line.split(';').length],[',',line.split(',').length]].sort((a,b)=>b[1]-a[1]);return counts[0][1]>1?counts[0][0]:',';}
function records(text,delimiter){
  const out=[];let row=[],field='',quoted=false;
  for(let i=0;i<text.length;i++){
    const c=text[i];
    if(quoted){if(c==='"'&&text[i+1]==='"'){field+='"';i++;}else if(c==='"')quoted=false;else field+=c;continue;}
    if(c==='"'&&field==='')quoted=true;
    else if(c===delimiter){row.push(field);field='';}
    else if(c==='\n'){row.push(field);out.push(row);row=[];field='';}
    else field+=c;
  }
  if(field!==''||row.length){row.push(field);out.push(row);}
  return out;
}
// يعيد {header, rows:[{row, cell(column)}]} أو يضيف ملاحظة. السطر 1 سطر العناوين، فأول موظف في السطر 2.
function readTable(text,label,problems){
  if(typeof text!=='string'||!text.trim()){problems.push({where:label,text:'الملف فاضي',why:'الصق محتوى الملف كاملًا ومعه سطر العناوين'});return null;}
  if(text.length>1500000){problems.push({where:label,text:'الملف أكبر من المسموح',why:'الحد مليون ونصف حرف للملف الواحد'});return null;}
  const clean=text.replace(/^\uFEFF/,'').replace(/\r\n?/g,'\n'),table=records(clean,delimiterOf(clean.split('\n',1)[0]));
  const header=(table[0]??[]).map(h=>h.trim().toLowerCase()),rows=[];
  table.slice(1).forEach((cells,index)=>{if(cells.some(c=>c.trim()!==''))rows.push({row:index+2,cell:column=>{const at=header.indexOf(column);return at<0?'':String(cells[at]??'').trim();}});});
  return {header,rows};
}
// المبلغ بالريال إلى هللات: أرقام عربية أو لاتينية، وفاصل آلاف اختياري، وخانتان عشريتان كحد أقصى. الفارغ صفر إلا حيث يُطلب.
const latinDigits=s=>s.replace(/[٠-٩]/g,d=>String(d.charCodeAt(0)-0x660)).replace(/[۰-۹]/g,d=>String(d.charCodeAt(0)-0x6F0)).replace(/٫/g,'.').replace(/٬/g,',');
export function amountMinor(raw){
  let s=latinDigits(String(raw??'').trim());
  if(s==='')return 0;
  if(/^\d{1,3}(,\d{3})+(\.\d{1,2})?$/.test(s))s=s.replace(/,/g,'');
  if(!/^\d{1,9}(\.\d{1,2})?$/.test(s))return null;
  const [w,f='']=s.split('.');return Number(BigInt(w)*100n+BigInt(f.padEnd(2,'0')));
}
const riyal=minor=>`${minor<0?'-':''}${Math.floor(Math.abs(minor)/100)}.${String(Math.abs(minor)%100).padStart(2,'0')}`;
// الدفعة تُقرأ كاملة أو تُرفض كاملة، والرفض يسمّي كل سطر بملاحظته. لا سطر يُسقط بصمت ولا رقم يُخمَّن.
export function readLegacy(db,tenantId,breakdownText,bankText){
  const problems=[],add=(where,text,why)=>problems.push({where,text,why});
  const breakdown=readTable(breakdownText,'الكشف التفصيلي',problems),bank=readTable(bankText,'ملف البنك المدفوع',problems);
  if(breakdown){const gap=BREAKDOWN_COLUMNS.filter(c=>!breakdown.header.includes(c));if(gap.length)add('الكشف التفصيلي',`أعمدة ناقصة: ${gap.join('، ')}`,`سطر العناوين: ${BREAKDOWN_COLUMNS.join(',')} (وgosi_employer اختياري)`);}
  if(bank){const gap=BANK_COLUMNS.filter(c=>!bank.header.includes(c));if(gap.length)add('ملف البنك المدفوع',`أعمدة ناقصة: ${gap.join('، ')}`,'سطر العناوين فيه employee وamount على الأقل، وباقي أعمدة البنك تُترك ولا تُحفظ');}
  if(problems.length)return {problems};
  // seen: كل موظف له سطر في الكشف ولو رُدّ سطره بملاحظة، فلا يُقال عن سطر بنكه «ما له سطر في الكشف» فوق ملاحظته الحقيقية.
  const employer=breakdown.header.includes('gosi_employer'),lines=new Map(),paid=new Map(),seen=new Set();
  const who=(where,username)=>{
    const person=personByUsername(db,tenantId,username)??personByUsername(db,tenantId,username.toLowerCase());
    if(!person)add(where,`«${username||'فاضي'}»`,'اسم الدخول ما يطابق موظفًا في الكيان');
    return person;
  };
  for(const r of breakdown.rows){
    const where=`الكشف — السطر ${r.row}`,person=who(where,r.cell('employee'));
    if(!person)continue;
    if(seen.has(person.id)){add(where,person.name,'الموظف مكرر في الكشف');continue;}
    seen.add(person.id);
    const values={};let bad=false;
    for(const column of [...EARNINGS,...DEDUCTIONS,'net',...(employer?['gosi_employer']:[])]){
      const raw=r.cell(column);
      if(column==='net'&&raw===''){add(where,`${person.name}: الصافي فاضي`,'الصافي مطلوب لكل موظف، وهو اللي يُطابَق بملف البنك');bad=true;continue;}
      const minor=amountMinor(raw);
      if(minor===null){add(where,`${person.name}: «${raw}» في عمود ${column}`,'مبلغ موجب بالريال وخانتين عشريتين كحد أقصى، مثل 8000.00 — والخصم يُكتب موجبًا في عموده');bad=true;continue;}
      values[column]=minor;
    }
    if(bad)continue;
    const computed=EARNINGS.reduce((n,c)=>n+values[c],0)-DEDUCTIONS.reduce((n,c)=>n+values[c],0);
    if(computed!==values.net){add(where,`${person.name}: البنود ناقص الخصوم ${riyal(computed)} والصافي المكتوب ${riyal(values.net)}`,'الكشف يُقرأ بمعادلته: كل بند في عموده، والصافي حاصلها');continue;}
    lines.set(person.id,{row:r.row,user_id:person.id,name:person.name,...values,gosi_employer:employer?values.gosi_employer:null});
  }
  for(const r of bank.rows){
    const where=`ملف البنك — السطر ${r.row}`,person=who(where,r.cell('employee'));
    if(!person)continue;
    if(paid.has(person.id)){add(where,person.name,'الموظف مكرر في ملف البنك');continue;}
    const minor=amountMinor(r.cell('amount'));
    if(minor===null||r.cell('amount')===''){add(where,`${person.name}: «${r.cell('amount')}»`,'المبلغ المحوّل بالريال وخانتين عشريتين كحد أقصى');continue;}
    paid.set(person.id,{row:r.row,minor,name:person.name});
  }
  for(const [userId,line] of lines){
    const p=paid.get(userId);
    if(!p&&line.net>0)add('ملف البنك المدفوع',`${line.name}: صافيه في الكشف ${riyal(line.net)} وما له سطر في ملف البنك`,'ملف البنك هو اللي ينثبت به المدفوع، والكشف يفسّره');
    else if(p&&p.minor!==line.net)add(`ملف البنك — السطر ${p.row}`,`${line.name}: حوّل البنك ${riyal(p.minor)} والكشف يقول ${riyal(line.net)}`,'صحّح الكشف ليطابق ما انحوّل فعلًا: الفرق بند يُكتب في عموده');
  }
  for(const [userId,p] of paid)if(!seen.has(userId))add(`ملف البنك — السطر ${p.row}`,p.name,'في ملف البنك وما له سطر في الكشف التفصيلي');
  if(!problems.length&&!lines.size)add('الكشف التفصيلي','ما فيه ولا موظف','الدفعة لشهر دفعه النظام السابق، فيها موظف واحد على الأقل');
  return {problems,employer,lines:[...lines.values()].map(l=>({...l,paid:l.net}))};
}

/* ───── القراءة ───── */
const monthRow=(db,tenantId,monthId)=>typeof monthId==='string'?db.prepare('SELECT * FROM payroll_parallel_months WHERE id=? AND tenant_id=?').get(monthId,tenantId)??null:null;
const batchRow=(db,tenantId,batchId)=>typeof batchId==='string'?db.prepare('SELECT * FROM payroll_legacy_batches WHERE id=? AND tenant_id=?').get(batchId,tenantId)??null:null;
const liveBatch=(db,tenantId,month)=>db.prepare("SELECT * FROM payroll_legacy_batches WHERE tenant_id=? AND month=? AND status IN ('imported','confirmed')").get(tenantId,month)??null;
const latestComparison=(db,tenantId,month)=>db.prepare('SELECT * FROM payroll_parallel_comparisons WHERE tenant_id=? AND month=? ORDER BY compared_at DESC,rowid DESC LIMIT 1').get(tenantId,month)??null;
const confirmedCutover=(db,tenantId)=>db.prepare("SELECT * FROM payroll_cutovers WHERE tenant_id=? AND status='confirmed'").get(tenantId)??null;
const openCutover=(db,tenantId)=>db.prepare("SELECT * FROM payroll_cutovers WHERE tenant_id=? AND status IN ('proposed','confirmed')").get(tenantId)??null;
const declaredMonths=(db,tenantId)=>db.prepare("SELECT * FROM payroll_parallel_months WHERE tenant_id=? AND status='declared' ORDER BY month").all(tenantId);
const explanationOf=(db,batchId,d)=>db.prepare('SELECT * FROM payroll_parallel_explanations WHERE batch_id=? AND user_id=? AND component=? AND legacy_minor IS ? AND platform_minor IS ?')
  .get(batchId,d.user_id,d.component,d.legacy_minor,d.platform_minor)??null;
// ما فعلته المنصة في الشهر من مسارات المال: لا يصير الشهر موازيًا بعدها، لأن النظام السابق ما يدفع شهرًا دفعته المنصة.
function platformTouched(db,tenantId,month){
  const out=[];
  if(db.prepare("SELECT 1 FROM payroll_payments p JOIN payroll_runs r ON r.id=p.run_id WHERE r.tenant_id=? AND r.month=? AND p.status<>'cancelled'").get(tenantId,month))out.push('أعدّت دفع رواتبه');
  if(db.prepare('SELECT 1 FROM wps_exports WHERE tenant_id=? AND month=?').get(tenantId,month))out.push('صدّرت ملف حماية أجوره');
  if(db.prepare("SELECT 1 FROM finance_source_links l JOIN payroll_runs r ON r.id=l.source_id WHERE l.source_kind='payroll_run' AND r.tenant_id=? AND r.month=?").get(tenantId,month))out.push('قيّدت مسيره في الدفتر');
  return out;
}
// احتساب المنصة للشهر كما هو الآن: مع مسير الشهر القائم إن وُجد (فتُقرأ الحركات المربوطة به)، وإلا بلا مسير.
function platformComputation(db,tenantId,month){
  const run=db.prepare("SELECT id,cycle_policy_id FROM payroll_runs WHERE tenant_id=? AND month=? AND status<>'cancelled'").get(tenantId,month)??null;
  return {run,computed:computeRunLines(db,tenantId,month,{runId:run?.id??null,policyId:run?.cycle_policy_id??null})};
}
function platformComponents(line){
  const earned=keys=>line.earnings.filter(e=>keys.includes(e.component)).reduce((n,e)=>n+e.amount_minor,0);
  const moved=kinds=>line.adjustments.filter(a=>kinds.includes(a.kind)).reduce((n,a)=>n+a.amount_minor,0);
  return {basic:earned(['basic']),housing:earned(['housing']),transport:earned(['transport']),
    other_allowance:line.earnings.filter(e=>!['basic','housing','transport'].includes(e.component)).reduce((n,e)=>n+e.amount_minor,0),
    overtime:moved(['overtime']),other_additions:moved(['bonus','allowance']),absence_deduction:line.unpaid_absence_minor,gosi_employee:line.social_insurance_minor,
    advance:line.advance_minor,other_deductions:line.other_deductions_minor,gosi_employer:line.employer_insurance_minor??0,net:line.net_minor};
}
const legacyComponents=l=>({basic:l.basic_minor,housing:l.housing_minor,transport:l.transport_minor,other_allowance:l.other_allowance_minor,overtime:l.overtime_minor,
  other_additions:l.other_additions_minor,absence_deduction:l.absence_deduction_minor,gosi_employee:l.gosi_employee_minor,advance:l.advance_minor,
  other_deductions:l.other_deductions_minor,gosi_employer:l.gosi_employer_minor,net:l.net_minor});

// حال المقارنة الأخيرة: قائمة على المدخلات نفسها والدفعة المؤكدة نفسها (current)، أو تغيّر مدخل بعدها (stale)، أو تبدّلت
// الدفعة (superseded)، أو ما ينحسب الشهر أصلًا (uncomputable: لا سياسة دورة رواتب سارية فيه).
function comparisonState(db,tenantId,c,live){
  if(!live||live.status!=='confirmed'||live.id!==c.batch_id)return {state:'superseded',changed:[]};
  let computed;
  try{computed=platformComputation(db,tenantId,c.month).computed;}catch(error){if(!error.details?.refusal)throw error;return {state:'uncomputable',changed:[],problem:error.details.refusal.what};}
  if(computed.digest===c.inputs_digest)return {state:'current',changed:[],computed};
  const stored=JSON.parse(c.inputs_parts),changed=Object.keys(INPUT_PARTS).filter(key=>stored[key]!==computed.parts[key]).map(key=>({key,name:INPUT_PARTS[key]}));
  return {state:'stale',changed:changed.length?changed:[{key:'calculation',name:'بصمة الاحتساب نفسه'}],computed};
}
const MONTH_STATES=Object.freeze({clean:'نظيف: كل فرق مفسّر في حدود ما اعتمده المالك',no_batch:'ما انستوردت دفعة النظام السابق',batch_unconfirmed:'دفعة النظام السابق تنتظر تأكيد شخص ثاني',
  no_comparison:'ما انقارن بالدفعة المؤكدة',stale:'تغيّر مدخل بعد المقارنة — تنعاد',uncomputable:'ما ينحسب الشهر في المنصة',unexplained:'فيه فروق ما تفسّرت فوق الحد',
  tolerance_unset:'حد الفروق ما اعتمده المالك'});
const STATE_NEXT=Object.freeze({no_batch:['دفعة الشهر من النظام السابق: الكشف التفصيلي وملف البنك المدفوع','يستوردها مُعد الرواتب، ويؤكدها شخص ثاني',PREPARER],
  batch_unconfirmed:['تأكيد دفعة النظام السابق','شخص غير اللي استوردها يطابق مجموع ملف البنك مع كشف الحساب',SECOND],
  no_comparison:['مقارنة الشهر بالدفعة المؤكدة','المقارنة بندًا بندًا هي اللي تثبت الشهر',PREPARER],
  stale:['مقارنة جديدة على المدخلات الحالية','المقارنة القديمة تصف أرقامًا ما عادت أرقام الشهر',PREPARER],
  uncomputable:['سياسة دورة رواتب معتمدة سارية في الشهر','بدونها ما تحسب المنصة الشهر',OWNER],
  unexplained:['تفسير كل فرق فوق الحد المعتمد','الفرق اللي ما تفسّر يعني شي ما نفهمه في الشهر',SECOND]});

function differenceViews(db,u,c,batch,canExplain){
  return db.prepare('SELECT * FROM payroll_parallel_differences WHERE comparison_id=?').all(c.id).map(d=>{
    const x=explanationOf(db,c.batch_id,d);
    return {id:d.id,user_id:d.user_id,employee_name:personName(db,d.user_id),component:d.component,component_name:COMPONENT_NAME[d.component]??d.component,
      legacy_minor:d.legacy_minor,platform_minor:d.platform_minor,delta_minor:d.delta_minor,
      explanation:x?{cause:x.cause,cause_name:optionLabel(db,u.tenant_id,CAUSE_LIST,x.cause),note:x.note,explained_by_name:personName(db,x.explained_by),explained_at:x.explained_at}:null,
      actions:!x&&canExplain&&d.user_id!==u.id?['explain_parallel_difference']:[]};
  }).sort((a,b)=>String(a.employee_name).localeCompare(String(b.employee_name),'ar')||COMPARED.indexOf(a.component)-COMPARED.indexOf(b.component));
}
function batchView(db,u,b,{cutover=null}={}){
  const lines=db.prepare('SELECT * FROM payroll_legacy_lines WHERE batch_id=? ORDER BY row_number').all(b.id).map(l=>({user_id:l.user_id,employee_name:personName(db,l.user_id),row_number:l.row_number,...legacyComponents(l),paid:l.paid_minor}));
  const second=u.id!==b.imported_by,actions=[];
  if(b.status==='imported'&&second&&(u.caps.includes('payroll.review')||u.caps.includes('payroll.approve')))actions.push('confirm_legacy_batch','reject_legacy_batch');
  if(b.status==='confirmed'&&second&&u.caps.includes('payroll.approve')&&!cutover)actions.push('withdraw_legacy_batch');
  return {id:b.id,month:b.month,...status('legacy_batch',b.status),headcount:b.headcount,gross_minor:b.gross_minor,deductions_minor:b.deductions_minor,net_minor:b.net_minor,
    paid_minor:b.paid_minor,employer_share_included:!!b.employer_share_included,source_note:b.source_note,breakdown_digest:b.breakdown_digest,bank_digest:b.bank_digest,
    imported_by_name:personName(db,b.imported_by),imported_at:b.imported_at,decided_by_name:personName(db,b.decided_by),decided_at:b.decided_at,decision_note:b.decision_note,
    withdrawn_by_name:personName(db,b.withdrawn_by),withdrawn_at:b.withdrawn_at,withdrawal_note:b.withdrawal_note,version:b.version,lines,actions};
}
function monthView(db,u,m,values,cutover){
  const live=liveBatch(db,u.tenant_id,m.month),latest=latestComparison(db,u.tenant_id,m.month);
  const history=db.prepare("SELECT * FROM payroll_legacy_batches WHERE tenant_id=? AND month=? AND status IN ('rejected','withdrawn') ORDER BY imported_at DESC").all(u.tenant_id,m.month);
  let comparison=null;
  if(latest){
    const s=comparisonState(db,u.tenant_id,latest,live),batch=batchRow(db,u.tenant_id,latest.batch_id);
    const canExplain=s.state==='current'&&(u.caps.includes('payroll.review')||u.caps.includes('payroll.approve'))&&u.id!==latest.compared_by&&u.id!==batch.imported_by;
    const differences=differenceViews(db,u,latest,batch,canExplain);
    comparison={id:latest.id,compared_at:latest.compared_at,compared_by_name:personName(db,latest.compared_by),state:s.state,changed:s.changed,problem:s.problem??null,
      inputs_digest:latest.inputs_digest,legacy_headcount:latest.legacy_headcount,platform_headcount:latest.platform_headcount,legacy_net_minor:latest.legacy_net_minor,
      platform_net_minor:latest.platform_net_minor,difference_count:latest.difference_count,differences,unexplained:differences.filter(d=>!d.explanation).length,
      actions:differences.some(d=>d.actions.length)?['explain_parallel_difference']:[]};
  }
  const state=!live?'no_batch':live.status==='imported'?'batch_unconfirmed':!comparison||comparison.state==='superseded'?'no_comparison'
    :comparison.state!=='current'?comparison.state:!values.tolerance.set?'tolerance_unset':comparison.unexplained<=values.tolerance.unexplained_max?'clean':'unexplained';
  const actions=[];
  if(!live&&u.caps.includes('payroll.prepare'))actions.push('import_legacy_batch');
  // مقارنة ما ينحسب شهرها (لا سياسة دورة سارية) لا يُعرض زر إعادتها: الرفض نفسه يتكرر حتى تُعتمد السياسة.
  if(live?.status==='confirmed'&&u.caps.includes('payroll.prepare')&&(!comparison||!['current','uncomputable'].includes(comparison.state)))actions.push('run_parallel_comparison');
  if(!live&&u.caps.includes('payroll.approve')&&u.id!==m.declared_by&&!(cutover&&cutover.first_platform_month>m.month))actions.push('withdraw_parallel_month');
  return {id:m.id,month:m.month,...status('parallel_month',m.status),basis:m.basis,declared_by_name:personName(db,m.declared_by),declared_at:m.declared_at,version:m.version,
    batch:live?batchView(db,u,live,{cutover}):null,batch_history:history.map(b=>batchView(db,u,b,{cutover})),comparison,state,state_name:MONTH_STATES[state],clean:state==='clean',actions};
}

/* ───── الجاهزية: هل يقدر المالك ينقل الدفع إلى المنصة؟ ───── */
function readinessOf(db,u,values,views){
  const months=views??declaredMonths(db,u.tenant_id).map(m=>monthView(db,u,m,values,confirmedCutover(db,u.tenant_id))),blockers=[];
  if(!values.tolerance.set)blockers.push({doc_key:`value:${TOLERANCE}`,document:'حد الفروق غير المفسّرة في الشهر الموازي — قيمة يعتمدها المالك بشخصين',
    why:values.tolerance.invalid?'القيمة المعتمدة ما هي عدد صحيح من 0 — تُسجَّل من جديد ويعتمدها شخص ثانٍ':'بدونه ما ينقال إن شهرًا نظيف',...OWNER});
  if(!values.required_months.set)blockers.push({doc_key:`value:${REQUIRED_MONTHS}`,document:'عدد الشهور الموازية المتتالية قبل الانتقال — قيمة يعتمدها المالك بشخصين',
    why:values.required_months.invalid?'القيمة المعتمدة ما هي عدد صحيح من 1 إلى 12 — تُسجَّل من جديد ويعتمدها شخص ثانٍ':'بدونه ما ينقال متى تكفي الشهور',...OWNER});
  if(!months.length)blockers.push({doc_key:'months:none',document:'شهر موازٍ معلن واحد على الأقل',why:'الانتقال يقوم على شهور دفعها النظام السابق وحسبتها المنصة',...OWNER});
  for(const m of months){
    if(m.clean||m.state==='tolerance_unset')continue;
    const [document,why,owner]=STATE_NEXT[m.state];
    blockers.push({doc_key:`month:${m.month}`,document:`شهر ${m.month}: ${document}`,why:`${MONTH_STATES[m.state]} — ${why}`,...owner});
  }
  // الشهور المتتالية المنتهية بآخر شهر موازٍ: الانتقال بعد آخرها مباشرة.
  const streak=[];
  for(const m of [...months].reverse()){if(streak.length&&nextMonth(m.month)!==streak[0].month)break;streak.unshift(m);}
  if(values.required_months.set&&months.length&&streak.length<values.required_months.months)
    blockers.push({doc_key:'months:short',document:`${values.required_months.months} شهور موازية متتالية تنتهي بآخر شهر موازٍ — المتتالي الحين ${streak.length}`,
      why:'العدد اللي اعتمده المالك لإثبات المنصة قبل ما تدفع',...OWNER});
  const last=months.at(-1)?.month??null;
  return {ready:!blockers.length,unexplained_max:values.tolerance.unexplained_max,required_months:values.required_months.months,
    months:months.map(m=>({month:m.month,state:m.state,state_name:m.state_name,clean:m.clean,unexplained:m.comparison?.unexplained??null,differences:m.comparison?.difference_count??null})),
    streak:streak.map(m=>m.month),last_parallel_month:last,first_platform_month:last?nextMonth(last):null,blockers};
}
export function cutoverReadiness(db,supplied){
  const u=staff(db,supplied);
  return readinessOf(db,u,parallelValues(db,u.tenant_id));
}

/* ───── الإعلان والسحب ───── */
export function declareParallelMonth(db,supplied,input){
  writing(db);
  const u=staff(db,supplied);need(u,['payroll.approve'],'إعلان الشهر الموازي لمعتمد المسير');
  v.object(input,['month','basis']);
  const month=monthValue(input.month),basis=v.text(input.basis,'سند إعلان الشهر الموازي',2000,10);
  if(parallelMonth(db,u.tenant_id,month))refuse(409,'already_parallel',{what:`شهر ${month} معلن موازيًا من قبل`,next:'افتحه في «المسير الموازي»'});
  const cut=confirmedCutover(db,u.tenant_id);
  if(cut&&month>=cut.first_platform_month)refuse(409,'after_cutover',{what:`المنصة تدفع من ${cut.first_platform_month} بقرار انتقال مؤكد، فما ينعلن ${month} موازيًا`,
    missing:[{document:'قرار انتقال جديد — والمؤكد ما يُرجع عنه',why:'بعد الانتقال المنصة هي اللي تدفع وهي سجل الشهر',...OWNER}],next:'شهر قبل الانتقال ينعلن موازيًا إن دفعه النظام السابق فعلًا'});
  const touched=platformTouched(db,u.tenant_id,month);
  if(touched.length)refuse(409,'platform_paid',{what:`المنصة ${touched.join(' و')} لشهر ${month}، فما يصير موازيًا`,
    missing:[{document:'شهر ما دفعته المنصة ولا صدّرت ملفه ولا قيّدته',why:'الشهر الموازي يدفعه النظام السابق؛ وشهر دفعته المنصة دُفع مرة',...OWNER}],next:'الشهر هذا للمنصة؛ أعلن الشهر اللي يدفعه النظام السابق'});
  const monthId=id(),time=now();
  db.prepare("INSERT INTO payroll_parallel_months(id,tenant_id,month,basis,status,declared_by,declared_at) VALUES(?,?,?,?,'declared',?,?)").run(monthId,u.tenant_id,month,basis,u.id,time);
  audit(db,u,'payroll_parallel_month',monthId,'payroll_parallel.month_declared',{},{month},basis);
  return {id:monthId,month};
}
export function withdrawParallelMonth(db,supplied,monthId,input){
  writing(db);
  const u=staff(db,supplied);need(u,['payroll.approve'],'سحب إعلان الشهر الموازي لمعتمد المسير');
  v.object(input,['version','note']);
  const m=monthRow(db,u.tenant_id,monthId);
  if(!m||m.status!=='declared')refuse(404,'not_found',{what:'ما فيه شهر موازٍ معلن بهذا المعرّف',next:'افتح «المسير الموازي» واختر الشهر من قائمته'});
  v.version(input.version,m.version);
  if(m.declared_by===u.id)separation('اللي أعلن الشهر موازيًا ما يسحب إعلانه','سحب الإعلان بيد معتمد ثانٍ');
  const live=liveBatch(db,u.tenant_id,m.month),cut=confirmedCutover(db,u.tenant_id);
  if(live||(cut&&cut.first_platform_month>m.month))refuse(409,'parallel_month_paid',{what:`شهر ${m.month} دفعه النظام السابق${live?' وله دفعة منه':' وقرار الانتقال يغطيه'}، فيبقى موازيًا`,
    missing:[{document:live?'رفض دفعة النظام السابق أو سحبها بسبب مكتوب، إن كانت الدفعة نفسها غلط':'لا شي: الشهر قبل الانتقال دفعه النظام السابق',why:'سحب الإعلان يفتح الشهر لدفع المنصة، والنظام السابق دفعه',...OWNER}],
    next:'إن كان الإعلان غلط من أصله ولا دفع النظام السابق الشهر، تُرفض دفعته أولًا ثم يُسحب'});
  const note=v.text(input.note,'سبب سحب إعلان الشهر الموازي',2000,10);
  if(db.prepare("UPDATE payroll_parallel_months SET status='withdrawn',withdrawn_by=?,withdrawn_at=?,withdrawal_note=?,version=version+1 WHERE id=? AND version=?").run(u.id,now(),note,m.id,m.version).changes!==1)stale();
  audit(db,u,'payroll_parallel_month',m.id,'payroll_parallel.month_withdrawn',{status:'declared'},{status:'withdrawn',month:m.month},note);
  return {id:m.id,month:m.month,status:'withdrawn'};
}

/* ───── دفعة النظام السابق ───── */
const confirmers=(db,tenantId,exclude)=>[...new Set([...capabilityHolders(db,tenantId,'payroll.review'),...capabilityHolders(db,tenantId,'payroll.approve')].map(p=>p.id))].filter(x=>!exclude.includes(x));
export function importLegacyBatch(db,supplied,input){
  writing(db);
  const u=staff(db,supplied);need(u,['payroll.prepare'],'استيراد دفعة النظام السابق لمُعد الرواتب');
  v.object(input,['month','breakdown_csv','bank_csv','source_note']);
  const month=monthValue(input.month),declared=parallelMonth(db,u.tenant_id,month);
  if(!declared)refuse(409,'not_parallel_month',{what:`شهر ${month} مو معلن موازيًا، فما له دفعة من النظام السابق`,
    missing:[{document:`إعلان ${month} شهرًا موازيًا`,why:'دفعة النظام السابق مقياس الشهر الموازي وبس',...OWNER}],next:'يعلنه معتمد المسير من «المسير الموازي» أولًا'});
  const live=liveBatch(db,u.tenant_id,month);
  if(live)refuse(409,'batch_exists',{what:`لشهر ${month} دفعة ${live.status==='confirmed'?'مؤكدة':'تنتظر التأكيد'} من النظام السابق`,
    next:live.status==='confirmed'?'إن كانت غلط يسحبها معتمد ثاني بسبب مكتوب، وبعدها تنستورد الصحيحة':'يؤكدها شخص ثاني أو يرفضها بسببه، وبعد الرفض تنستورد الصحيحة'});
  const sourceNote=v.text(input.source_note,'وش الملفان ومن وين انأخذا',2000,10);
  const parsed=readLegacy(db,u.tenant_id,input.breakdown_csv,input.bank_csv);
  if(parsed.problems.length)refuse(400,'legacy_batch_invalid',{what:`ما انستوردت دفعة ${month}: ${parsed.problems.length} ملاحظة في الملفين`,
    missing:parsed.problems.slice(0,25).map(p=>({document:`${p.where}: ${p.text}`,why:p.why,owner:'مُعد الرواتب — اللي يجهّز ملفات النظام السابق',owner_role:'payroll.prepare'})),
    next:'صحّح الملفين من النظام السابق والصقهما من جديد. الدفعة تنستورد كاملة أو ما تنستورد'});
  const sum=keys=>parsed.lines.reduce((n,l)=>n+keys.reduce((k,c)=>k+l[c],0),0);
  const batchId=id(),time=now(),gross=sum(EARNINGS),deductions=sum(DEDUCTIONS),net=gross-deductions;
  const digest=text=>hash(String(text).replace(/^\uFEFF/,'').replace(/\r\n?/g,'\n'));
  db.prepare("INSERT INTO payroll_legacy_batches(id,tenant_id,parallel_month_id,month,source_note,breakdown_digest,bank_digest,employer_share_included,headcount,gross_minor,deductions_minor,net_minor,paid_minor,status,imported_by,imported_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,'imported',?,?)")
    .run(batchId,u.tenant_id,declared.id,month,sourceNote,digest(input.breakdown_csv),digest(input.bank_csv),parsed.employer?1:0,parsed.lines.length,gross,deductions,net,net,u.id,time);
  const insert=db.prepare('INSERT INTO payroll_legacy_lines(batch_id,user_id,row_number,basic_minor,housing_minor,transport_minor,other_allowance_minor,overtime_minor,other_additions_minor,absence_deduction_minor,gosi_employee_minor,advance_minor,other_deductions_minor,gosi_employer_minor,net_minor,paid_minor) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)');
  for(const l of parsed.lines)insert.run(batchId,l.user_id,l.row,l.basic,l.housing,l.transport,l.other_allowance,l.overtime,l.other_additions,l.absence_deduction,l.gosi_employee,l.advance,l.other_deductions,l.gosi_employer,l.net,l.paid);
  audit(db,u,'payroll_legacy_batch',batchId,'payroll_parallel.batch_imported',{},{month,headcount:parsed.lines.length,net_minor:net,employer_share_included:parsed.employer},sourceNote);
  notifyMany(db,confirmers(db,u.tenant_id,[u.id]),u.id,{kind:'legacy_batch_confirmation_needed',subjectKind:'payroll_parallel',subjectId:batchId,
    title:`دفعة النظام السابق لشهر ${month} تنتظر تأكيد شخص ثاني`,body:'افتح «المسير الموازي» وطابق مجموع ملف البنك مع كشف الحساب قبل التأكيد.'});
  return {id:batchId,month,headcount:parsed.lines.length};
}
export function decideLegacyBatch(db,supplied,batchId,decision,input){
  writing(db);
  const u=staff(db,supplied);
  if(!['confirm','reject','withdraw'].includes(decision))refuse(404,'not_found',{what:`ما فيه إجراء «${String(decision).slice(0,30)}» على دفعة النظام السابق`,next:'الإجراءات: confirm وreject وwithdraw'});
  v.object(input,['version','note']);
  const b=batchRow(db,u.tenant_id,batchId);
  if(!b)refuse(404,'not_found',{what:'ما فيه دفعة من النظام السابق بهذا المعرّف',next:'افتح «المسير الموازي» واختر الدفعة من شهرها'});
  v.version(input.version,b.version);
  if(b.imported_by===u.id)separation('اللي استورد الدفعة ما يؤكدها ولا يرفضها ولا يسحبها','قرار شخص ثاني يحمل تصريح مراجعة المسير أو اعتماده');
  need(u,decision==='withdraw'?['payroll.approve']:['payroll.review','payroll.approve'],decision==='withdraw'?'سحب دفعة مؤكدة لمعتمد المسير':'تأكيد دفعة النظام السابق أو رفضها لمراجع المسير أو معتمده');
  const expected=decision==='withdraw'?'confirmed':'imported';
  if(b.status!==expected)refuse(409,'batch_state',{what:`الدفعة ${status('legacy_batch',b.status).status_name}، فما ينفع عليها «${{confirm:'التأكيد',reject:'الرفض',withdraw:'السحب'}[decision]}»`,
    next:decision==='withdraw'?'السحب للدفعة المؤكدة وبس':'التأكيد والرفض للدفعة اللي تنتظر شخصًا ثانيًا'});
  if(decision==='withdraw'&&confirmedCutover(db,u.tenant_id))refuse(409,'after_cutover',{what:'بعد قرار الانتقال دفعات الشهور الموازية تاريخ، فما تنسحب',
    missing:[{document:'لا شي — الدفعة سجل ما دفعه النظام السابق',why:'الانتقال قام على هذه الدفعات',...OWNER}],next:'الخطأ في دفعة قديمة يُعالج بقرار تسوية مستقل'});
  const note=v.text(input.note,{confirm:'وش اللي طابقته (مجموع ملف البنك مع كشف الحساب)',reject:'سبب الرفض',withdraw:'سبب سحب الدفعة المؤكدة'}[decision],2000,10),time=now();
  const ok=decision==='withdraw'
    ?db.prepare("UPDATE payroll_legacy_batches SET status='withdrawn',withdrawn_by=?,withdrawn_at=?,withdrawal_note=?,version=version+1 WHERE id=? AND version=?").run(u.id,time,note,b.id,b.version).changes
    :db.prepare('UPDATE payroll_legacy_batches SET status=?,decided_by=?,decided_at=?,decision_note=?,version=version+1 WHERE id=? AND version=?').run(decision==='confirm'?'confirmed':'rejected',u.id,time,note,b.id,b.version).changes;
  if(ok!==1)stale();
  const after={confirm:'confirmed',reject:'rejected',withdraw:'withdrawn'}[decision];
  audit(db,u,'payroll_legacy_batch',b.id,`payroll_parallel.batch_${after}`,{status:b.status},{status:after,month:b.month},note);
  return batchView(db,u,batchRow(db,u.tenant_id,b.id),{cutover:confirmedCutover(db,u.tenant_id)});
}

/* ───── المقارنة ───── */
export function compareParallelMonth(db,supplied,input){
  writing(db);
  const u=staff(db,supplied);need(u,['payroll.prepare'],'المقارنة الموازية لمُعد الرواتب');
  v.object(input,['month']);
  const month=monthValue(input.month);
  if(!parallelMonth(db,u.tenant_id,month))refuse(409,'not_parallel_month',{what:`شهر ${month} مو معلن موازيًا، فما فيه ما يُقارن`,
    missing:[{document:`إعلان ${month} شهرًا موازيًا`,why:'المقارنة بدفعة النظام السابق اللي دفع الشهر',...OWNER}],next:'يعلنه معتمد المسير أولًا'});
  const batch=liveBatch(db,u.tenant_id,month);
  if(!batch||batch.status!=='confirmed')refuse(409,'batch_unconfirmed',{what:`ما فيه دفعة مؤكدة من النظام السابق لشهر ${month}`,
    missing:[{document:'دفعة النظام السابق مؤكدة بيد شخص ثاني',why:'المقارنة مقياسها ما دفعه النظام السابق فعلًا، والمؤكَّد وحده يصلح مقياسًا',...(batch?SECOND:PREPARER)}],
    next:batch?'يؤكدها شخص غير اللي استوردها':'يستوردها مُعد الرواتب ويؤكدها شخص ثاني'});
  const {run,computed}=platformComputation(db,u.tenant_id,month),latest=latestComparison(db,u.tenant_id,month);
  if(latest&&latest.batch_id===batch.id&&latest.inputs_digest===computed.digest)refuse(409,'comparison_current',{what:`مقارنة ${month} قائمة على المدخلات نفسها والدفعة نفسها`,
    next:'فسّر فروقها. المقارنة تنعاد لما يتغيّر مدخل أو تتبدّل الدفعة'});
  const legacy=new Map(db.prepare('SELECT * FROM payroll_legacy_lines WHERE batch_id=?').all(batch.id).map(l=>[l.user_id,l])),platform=new Map(computed.lines.map(l=>[l.user_id,l]));
  const differences=[];
  for(const userId of [...new Set([...legacy.keys(),...platform.keys()])].sort()){
    const L=legacy.get(userId),P=platform.get(userId);
    if(!L||!P){differences.push({user_id:userId,component:'presence',legacy_minor:L?L.net_minor:null,platform_minor:P?P.net_minor:null});continue;}
    const lc=legacyComponents(L),pc=platformComponents(P);
    for(const key of COMPARED){
      if(key==='gosi_employer'&&lc.gosi_employer===null)continue;
      if(lc[key]!==pc[key])differences.push({user_id:userId,component:key,legacy_minor:lc[key],platform_minor:pc[key]});
    }
  }
  const comparisonId=id(),time=now();
  db.prepare('INSERT INTO payroll_parallel_comparisons(id,tenant_id,month,batch_id,run_id,policy_id,inputs_digest,inputs_parts,legacy_headcount,platform_headcount,legacy_net_minor,platform_net_minor,difference_count,compared_by,compared_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
    .run(comparisonId,u.tenant_id,month,batch.id,run?.id??null,computed.policy_id,computed.digest,JSON.stringify(computed.parts),legacy.size,platform.size,batch.net_minor,computed.totals.net_minor,differences.length,u.id,time);
  const insert=db.prepare('INSERT INTO payroll_parallel_differences(id,comparison_id,tenant_id,user_id,component,legacy_minor,platform_minor,delta_minor) VALUES(?,?,?,?,?,?,?,?)');
  for(const d of differences)insert.run(id(),comparisonId,u.tenant_id,d.user_id,d.component,d.legacy_minor,d.platform_minor,(d.platform_minor??0)-(d.legacy_minor??0));
  const unexplained=differences.filter(d=>!explanationOf(db,batch.id,d)).length;
  audit(db,u,'payroll_parallel_comparison',comparisonId,'payroll_parallel.compared',{},{month,batch_id:batch.id,inputs_digest:computed.digest,differences:differences.length,unexplained});
  // من يقدر يفسّر يوصله إشعار بلا أرقام أجور: الشهر وعدد الفروق، والأرقام في الشاشة.
  if(unexplained)notifyMany(db,confirmers(db,u.tenant_id,[u.id,batch.imported_by]),u.id,{kind:'parallel_explanation_needed',subjectKind:'payroll_parallel',subjectId:comparisonId,
    title:`فروق ما تفسّرت في المسير الموازي لشهر ${month}: ${unexplained}`,body:'افتح «المسير الموازي» وفسّر كل فرق بسببه، أو يصحّح مُعد الرواتب مدخله وتنعاد المقارنة.'});
  return {id:comparisonId,month,inputs_digest:computed.digest,difference_count:differences.length,unexplained};
}
export function explainDifferences(db,supplied,comparisonId,input){
  writing(db);
  const u=staff(db,supplied);
  v.object(input,['difference_ids','cause','note']);
  const c=typeof comparisonId==='string'?db.prepare('SELECT * FROM payroll_parallel_comparisons WHERE id=? AND tenant_id=?').get(comparisonId,u.tenant_id):null;
  if(!c)refuse(404,'not_found',{what:'ما فيه مقارنة موازية بهذا المعرّف',next:'افتح «المسير الموازي» واختر الفروق من شهرها'});
  const batch=batchRow(db,u.tenant_id,c.batch_id),live=liveBatch(db,u.tenant_id,c.month),latest=latestComparison(db,u.tenant_id,c.month);
  if(u.id===c.compared_by)separation('اللي قارن الشهر ما يفسّر فروقه','تفسير من مراجع المسير أو معتمده غير اللي قارن');
  if(u.id===batch.imported_by)separation('اللي استورد دفعة النظام السابق ما يفسّر فروقها','تفسير من مراجع المسير أو معتمده غير اللي استورد');
  need(u,['payroll.review','payroll.approve'],'تفسير فروق المسير الموازي لمراجع المسير أو معتمده');
  if(latest.id!==c.id)refuse(409,'comparison_superseded',{what:`انعادت مقارنة ${c.month} بعد هذي، فالتفسير على الأحدث`,next:'حدّث الشاشة وفسّر فروق المقارنة الأخيرة'});
  const s=comparisonState(db,u.tenant_id,c,live);
  if(s.state!=='current')refuse(409,'comparison_stale',{what:`مقارنة ${c.month} ما عادت تصف الشهر: ${s.state==='stale'?`تغيّر ${s.changed.map(x=>x.name).join('، ')}`:'تبدّلت دفعة النظام السابق أو ما ينحسب الشهر'}`,
    missing:[{document:'مقارنة جديدة على المدخلات والدفعة الحالية',why:'التفسير لأرقام الشهر كما هي، لا كما كانت',...PREPARER}],next:'يعيد مُعد الرواتب المقارنة، وبعدها تُفسَّر فروقها'});
  const ids=input.difference_ids;
  if(!Array.isArray(ids)||!ids.length||ids.length>500||ids.some(x=>typeof x!=='string')||new Set(ids).size!==ids.length)
    refuse(400,'difference_ids',{what:'اختر الفروق اللي تفسّرها من القائمة',next:'فرق واحد على الأقل، وكل فرق مرة'});
  const cause=requireOption(db,u.tenant_id,CAUSE_LIST,input.cause,{field:'سبب الفرق'}),note=v.text(input.note,'تفسير الفرق وما يترتب عليه',2000,10),time=now();
  const rows=ids.map(x=>db.prepare('SELECT * FROM payroll_parallel_differences WHERE id=? AND comparison_id=?').get(x,c.id));
  if(rows.some(r=>!r))refuse(404,'not_found',{what:'فيه فرق مختار مو من هذي المقارنة',next:'حدّث الشاشة واختر الفروق من جديد'});
  const own=rows.find(r=>r.user_id===u.id);
  if(own)separation('ما يفسّر الموظف فرقًا في أجره','تفسير من مراجع المسير أو معتمده غير صاحب الأجر');
  const done=rows.filter(r=>explanationOf(db,c.batch_id,r));
  if(done.length)refuse(409,'already_explained',{what:`${done.length} من الفروق المختارة مفسّرة من قبل`,next:'اختر الفروق اللي ما تفسّرت بعد'});
  const insert=db.prepare('INSERT INTO payroll_parallel_explanations(id,tenant_id,difference_id,batch_id,user_id,component,legacy_minor,platform_minor,cause,note,explained_by,explained_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)');
  for(const r of rows){
    const explanationId=id();
    insert.run(explanationId,u.tenant_id,r.id,c.batch_id,r.user_id,r.component,r.legacy_minor,r.platform_minor,cause,note,u.id,time);
    audit(db,u,'payroll_parallel_explanation',explanationId,'payroll_parallel.difference_explained',{},{month:c.month,user_id:r.user_id,component:r.component,cause},note);
  }
  return {comparison_id:c.id,explained:rows.length};
}

/* ───── الانتقال ───── */
function cutoverView(db,u,c){
  const actions=c.status==='proposed'&&u.caps.includes('payroll.approve')&&u.id!==c.proposed_by?['confirm_cutover','reject_cutover']:[];
  return {id:c.id,first_platform_month:c.first_platform_month,last_parallel_month:c.last_parallel_month,...status('cutover',c.status),note:c.note,
    proposed_by_name:personName(db,c.proposed_by),proposed_at:c.proposed_at,decided_by_name:personName(db,c.decided_by),decided_at:c.decided_at,decision_note:c.decision_note,
    readiness:JSON.parse(c.readiness),version:c.version,actions};
}
export function recordCutover(db,supplied,input){
  writing(db);
  const u=staff(db,supplied);need(u,['payroll.approve'],'اقتراح الانتقال إلى المنصة لمعتمد المسير');
  v.object(input,['note']);
  const values=parallelValues(db,u.tenant_id),r=readinessOf(db,u,values);
  if(!values.tolerance.set||!values.required_months.set)refuse(409,'parallel_values_unadopted',{what:'ما ينقرر الانتقال قبل ما يعتمد المالك حد الفروق وعدد الشهور',
    missing:r.blockers.filter(b=>b.doc_key.startsWith('value:')),next:'يسجّل القيمة معتمد المسير ويعتمدها معتمد ثاني من «المسير الموازي» أو «الخيارات والقيم المعتمدة»'});
  if(!r.ready)refuse(409,'cutover_not_ready',{what:'الشهور الموازية ما اكتملت للانتقال',missing:r.blockers,next:'عالج كل بند ناقص، وبعدها يُقترح الانتقال'});
  const open=openCutover(db,u.tenant_id);
  if(open)refuse(409,'cutover_open',{what:open.status==='confirmed'?`الانتقال مؤكد من قبل: المنصة تدفع من ${open.first_platform_month}`:`فيه اقتراح انتقال من ${open.first_platform_month} ينتظر معتمدًا ثانيًا`,
    next:open.status==='confirmed'?'ما فيه انتقال ثاني':'يؤكده معتمد ثاني أو يرفضه بسببه'});
  const note=v.text(input.note,'سند الانتقال إلى المنصة',2000,10),cutoverId=id(),time=now();
  db.prepare("INSERT INTO payroll_cutovers(id,tenant_id,first_platform_month,last_parallel_month,readiness,note,status,proposed_by,proposed_at) VALUES(?,?,?,?,?,?,'proposed',?,?)")
    .run(cutoverId,u.tenant_id,r.first_platform_month,r.last_parallel_month,JSON.stringify({unexplained_max:r.unexplained_max,required_months:r.required_months,
      tolerance_adoption:values.tolerance.decision.adoption_id??null,months_adoption:values.required_months.decision.adoption_id??null,months:r.months,streak:r.streak}),note,u.id,time);
  audit(db,u,'payroll_cutover',cutoverId,'payroll_parallel.cutover_proposed',{},{first_platform_month:r.first_platform_month,last_parallel_month:r.last_parallel_month},note);
  notifyMany(db,capabilityHolders(db,u.tenant_id,'payroll.approve').map(p=>p.id),u.id,{kind:'cutover_confirmation_needed',subjectKind:'payroll_parallel',subjectId:cutoverId,
    title:`اقتراح الانتقال إلى المنصة من ${r.first_platform_month} ينتظر تأكيد معتمد ثاني`,body:'افتح «المسير الموازي» وراجع الشهور الموازية وتفسير فروقها قبل التأكيد.'});
  return {id:cutoverId,first_platform_month:r.first_platform_month,last_parallel_month:r.last_parallel_month};
}
export function decideCutover(db,supplied,cutoverId,decision,input){
  writing(db);
  const u=staff(db,supplied);need(u,['payroll.approve'],'تأكيد الانتقال أو رفضه لمعتمد المسير');
  if(!['confirm','reject'].includes(decision))refuse(404,'not_found',{what:`ما فيه إجراء «${String(decision).slice(0,30)}» على قرار الانتقال`,next:'الإجراءان: confirm وreject'});
  v.object(input,['version','note']);
  const c=typeof cutoverId==='string'?db.prepare("SELECT * FROM payroll_cutovers WHERE id=? AND tenant_id=?").get(cutoverId,u.tenant_id):null;
  if(!c||c.status!=='proposed')refuse(404,'not_found',{what:'ما فيه اقتراح انتقال ينتظر قرارًا بهذا المعرّف',next:'افتح «المسير الموازي» وشوف حال الانتقال'});
  v.version(input.version,c.version);
  if(c.proposed_by===u.id)separation('اللي اقترح الانتقال ما يؤكده ولا يرفضه','قرار معتمد ثاني يحمل تصريح اعتماد المسير');
  const note=v.text(input.note,decision==='confirm'?'وش اللي راجعته قبل التأكيد':'سبب رفض الانتقال',2000,10);
  if(decision==='confirm'){
    const r=readinessOf(db,u,parallelValues(db,u.tenant_id));
    if(!r.ready||r.last_parallel_month!==c.last_parallel_month)refuse(409,'cutover_not_ready',{what:'تغيّر حال الشهور الموازية بعد الاقتراح، فما ينأكد على ما كان',
      missing:r.blockers.length?r.blockers:[{document:`آخر شهر موازٍ الحين ${r.last_parallel_month} والاقتراح على ${c.last_parallel_month}`,why:'التأكيد على الحال الحاضرة',...OWNER}],
      next:'يُرفض هذا الاقتراح بسببه، ويُقترح من جديد على الحال الحاضرة'});
  }
  if(db.prepare('UPDATE payroll_cutovers SET status=?,decided_by=?,decided_at=?,decision_note=?,version=version+1 WHERE id=? AND version=?')
    .run(decision==='confirm'?'confirmed':'rejected',u.id,now(),note,c.id,c.version).changes!==1)stale();
  audit(db,u,'payroll_cutover',c.id,`payroll_parallel.cutover_${decision==='confirm'?'confirmed':'rejected'}`,{status:'proposed'},{status:decision==='confirm'?'confirmed':'rejected',first_platform_month:c.first_platform_month},note);
  return cutoverView(db,u,db.prepare('SELECT * FROM payroll_cutovers WHERE id=?').get(c.id));
}

/* ───── اللوحة ───── */
function valueView(db,u,key,decision,extra){
  const pending=db.prepare('SELECT id,value,effective_from,recorded_by,created_at FROM option_adoptions WHERE tenant_id=? AND key=? AND approved_by IS NULL ORDER BY created_at DESC').all(u.tenant_id,key)
    .map(r=>({id:r.id,value:JSON.parse(r.value),effective_from:r.effective_from,created_at:r.created_at,mine:r.recorded_by===u.id,recorded_by_name:personName(db,r.recorded_by),
      actions:r.recorded_by!==u.id&&u.caps.includes('payroll.approve')?['approve_parallel_value']:[]}));
  return {key,label:decision.label,source:decision.source,value:decision.value,effective_from:decision.effective_from,basis:decision.basis,...extra,pending,
    actions:u.caps.includes('payroll.approve')?['record_parallel_value']:[]};
}
export function parallelBoard(db,supplied){
  const u=staff(db,supplied),values=parallelValues(db,u.tenant_id),cutover=confirmedCutover(db,u.tenant_id);
  const views=declaredMonths(db,u.tenant_id).map(m=>monthView(db,u,m,values,cutover)),readiness=readinessOf(db,u,values,views);
  const withdrawn=db.prepare("SELECT * FROM payroll_parallel_months WHERE tenant_id=? AND status='withdrawn' ORDER BY month").all(u.tenant_id)
    .map(m=>({id:m.id,month:m.month,...status('parallel_month',m.status),basis:m.basis,withdrawn_at:m.withdrawn_at,withdrawal_note:m.withdrawal_note}));
  const cutovers=db.prepare('SELECT * FROM payroll_cutovers WHERE tenant_id=? ORDER BY proposed_at DESC').all(u.tenant_id).map(c=>cutoverView(db,u,c));
  const actions=[];
  if(u.caps.includes('payroll.approve'))actions.push('declare_parallel_month');
  if(readiness.ready&&u.caps.includes('payroll.approve')&&!openCutover(db,u.tenant_id))actions.push('propose_cutover');
  return {today:riyadhToday(),user_id:u.id,permissions:u.caps,
    note:'في الشهر الموازي النظام السابق هو اللي يدفع، والمنصة تحسب الشهر نفسه وتقارنه بندًا بندًا وموظفًا موظفًا. ما تدفع المنصة لأحد إلا بعد الشهور النظيفة اللي يقررها المالك، وبقرار شخصين.',
    values:{tolerance:valueView(db,u,TOLERANCE,values.tolerance.decision,{set:values.tolerance.set,unexplained_max:values.tolerance.unexplained_max}),
      required_months:valueView(db,u,REQUIRED_MONTHS,values.required_months.decision,{set:values.required_months.set,months:values.required_months.months})},
    readiness,months:views,withdrawn,cutovers,cutover:cutover?{first_platform_month:cutover.first_platform_month,last_parallel_month:cutover.last_parallel_month}:null,
    components:COMPONENTS,causes:optionsFor(db,u.tenant_id,CAUSE_LIST).options.map(o=>({value:o.value,label:o.label})),
    csv:{breakdown:BREAKDOWN_COLUMNS.join(','),bank:BANK_COLUMNS.join(','),optional:'gosi_employer'},actions};
}

// ما ينتظر قرار القارئ، لصندوق «بانتظار إجرائي»: دفعة تنتظر تأكيده، وفروق تنتظر تفسيره، واقتراح انتقال ينتظر تأكيده.
// بلا أرقام أجور في العناوين. واعتماد القيمتين يصل الصندوق من مصدر «الخيارات والقيم المعتمدة» فلا يُعدّ مرتين.
export function parallelAwaiting(db,supplied){
  const board=parallelBoard(db,supplied);
  return {parallel_batch_items:board.months.filter(m=>m.batch?.actions.includes('confirm_legacy_batch'))
      .map(m=>({id:m.batch.id,title:`دفعة النظام السابق لشهر ${m.month}`,created_at:m.batch.imported_at,actions:['confirm_legacy_batch']})),
    parallel_difference_items:board.months.filter(m=>m.comparison?.actions.includes('explain_parallel_difference'))
      .map(m=>({id:m.comparison.id,title:`فروق المسير الموازي لشهر ${m.month}: ${m.comparison.differences.filter(d=>d.actions.length).length} تنتظر تفسيرك`,created_at:m.comparison.compared_at,actions:['explain_parallel_difference']})),
    parallel_cutover_items:board.cutovers.filter(c=>c.actions.includes('confirm_cutover'))
      .map(c=>({id:c.id,title:`الانتقال إلى المنصة من ${c.first_platform_month}`,created_at:c.proposed_at,actions:['confirm_cutover']}))};
}
