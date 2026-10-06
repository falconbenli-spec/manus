import { randomUUID } from 'node:crypto';
import { integrationStatus } from './integration-readiness.mjs';
import { audit, now, hash } from './db.mjs';
import { fail } from './auth.mjs';
import * as v from './validation.mjs';
import { unseal } from './crypto-fields.mjs';
import { riyadhDateOf } from './riyadh-time.mjs';
import { refuse } from './refusal.mjs';
import { staff, need, writing, riyadhToday, monthRange, bankState, identityDocument, onDutyEmployees, contractInForce, runLines, runFor } from './wage-basis.mjs';
// P4-HR-5: الشهر الموازي يدفعه النظام السابق (الترحيل 176). سطر واحد في كل مسار مال: app/payroll-parallel-guard.mjs.
import { assertPlatformPays, parallelBlocker } from './payroll-parallel-guard.mjs';

// ملف حماية الأجور. المنصة لا تعرف مواصفة الملف ولا تتصل بأي جهة ولا ترفع شيئًا:
// المواصفة يدخلها مدير الموارد البشرية من حساب المنشأة لدى الجهة، والملف يُبنى من تعريفها، والرفع يدوي.
export const SCREEN_NOTE='صيغة الملف يدخلها مدير الموارد البشرية من حساب المنشأة لدى الجهة. المنصة لا تعرف المواصفة ولا تتصل بأي جهة، والرفع يدوي.';
export const LAYOUTS=[['delimited','أعمدة يفصلها فاصل'],['fixed','أعمدة بأطوال ثابتة']].map(([key,name])=>({key,name}));
export const ENCODINGS=[['utf-8','UTF-8'],['utf-8-bom','UTF-8 مع علامة الترتيب (BOM)']].map(([key,name])=>({key,name}));
export const LINE_ENDINGS=[['crlf','CRLF'],['lf','LF']].map(([key,name])=>({key,name}));
export const PADS=[['right','يمين القيمة'],['left','يسار القيمة']].map(([key,name])=>({key,name}));
export const PAD_CHARS=[['space','مسافة'],['zero','صفر']].map(([key,name])=>({key,name}));

// ما تستطيع المنصة أن تملأ به عمودًا. ما ليس في هذه القائمة لا تعرفه المنصة ويُترك فارغًا أو يُدخل قيمة ثابتة.
export const WPS_SOURCE_FIELDS=[
  {key:'employee_id',name:'معرّف الموظف في المنصة',type:'text'},
  {key:'employee_name',name:'اسم الموظف',type:'text'},
  {key:'identity_reference',name:'مرجع الهوية أو الإقامة',type:'text',caution:'المنصة لا تخزن رقم الهوية كاملًا، بل مرجعًا مختصرًا. عمود يطلب الرقم الكامل لا تستطيع المنصة ملأه.'},
  {key:'identity_expires_on',name:'انتهاء الهوية أو الإقامة',type:'date'},
  {key:'iban',name:'آيبان حساب الراتب المتحقق منه',type:'text'},
  {key:'bank_name',name:'اسم البنك',type:'text'},
  {key:'net_amount',name:'صافي الاستحقاق',type:'amount'},
  {key:'gross_amount',name:'إجمالي الاستحقاق',type:'amount'},
  {key:'basic_amount',name:'الأساسي المصروف في الشهر',type:'amount'},
  {key:'housing_amount',name:'بدل السكن المصروف',type:'amount'},
  {key:'transport_amount',name:'بدل النقل المصروف',type:'amount'},
  {key:'other_allowance_amount',name:'البدل الآخر المصروف',type:'amount'},
  {key:'additions_amount',name:'الإضافات المعتمدة',type:'amount'},
  {key:'deductions_amount',name:'مجموع الخصومات والاستقطاعات',type:'amount'},
  {key:'unpaid_days',name:'عدد أيام الغياب غير المدفوع',type:'number'},
  {key:'month',name:'شهر المسير',type:'month'},
  {key:'month_start',name:'أول الشهر',type:'date'},
  {key:'month_end',name:'آخر الشهر',type:'date'},
  {key:'contract_start',name:'بداية العقد الساري',type:'date'},
  {key:'constant',name:'قيمة ثابتة يدخلها مدخل المواصفة',type:'text'},
  {key:'blank',name:'عمود يُترك فارغًا',type:'text'}
];
const sourceByKey=new Map(WPS_SOURCE_FIELDS.map(f=>[f.key,f]));
const COLUMN_TYPES=[...new Set(WPS_SOURCE_FIELDS.map(f=>f.type))];
const id=()=>randomUUID();
const amount=minor=>(minor/100).toFixed(2);
const componentPaid=(line,component)=>line.earnings.filter(l=>l.component===component).reduce((n,l)=>n+l.amount_minor,0);
const unpaidDays=line=>(line.basis.parts??[]).reduce((n,part)=>n+(part.unpaid_dates?.length??0),0);

// ── تعريف الصيغة: بيانات يتحقق منها الخادم شكلًا، ولا يفترض عمودًا ولا ترتيبًا ولا طولًا ──────────────
function cleanColumns(input,layout){
  if(!Array.isArray(input)||!input.length||input.length>60)fail(400,'columns','أدخل أعمدة الملف كما هي في مواصفة الجهة');
  const positions=new Set();
  const columns=input.map(raw=>{
    const c=v.object(raw,['name','position','length','type','source','required','value','pad','pad_char']);
    const source=sourceByKey.get(c.source);
    if(!source)fail(400,'column_source',`المصدر غير معروف للمنصة: ${String(c.source).slice(0,40)}`);
    if(c.type!==source.type)fail(400,'column_type',`نوع العمود «${String(c.name).slice(0,40)}» لا يطابق نوع مصدره (${source.type})`);
    if(!COLUMN_TYPES.includes(c.type))fail(400,'column_type','نوع العمود غير معروف');
    if(!Number.isInteger(c.position)||c.position<1||c.position>input.length)fail(400,'column_position','ترتيب العمود رقم متسلسل من 1');
    if(positions.has(c.position))fail(400,'column_position','ترتيب العمود مكرر');
    positions.add(c.position);
    const length=c.length===null||c.length===undefined||c.length===''?null:c.length;
    if(length!==null&&(!Number.isInteger(length)||length<1||length>200))fail(400,'column_length','طول العمود عدد صحيح بين 1 و200');
    if(layout==='fixed'&&length===null)fail(400,'column_length','الملف بأطوال ثابتة: لكل عمود طوله كما في المواصفة');
    const pad=c.pad??'right',padChar=c.pad_char??'space';
    if(!PADS.some(p=>p.key===pad)||!PAD_CHARS.some(p=>p.key===padChar))fail(400,'column_pad','جهة التعبئة أو حرفها غير صالح');
    if(CONTROL_CHARACTER.test(String(c.name??''))||(c.source==='constant'&&CONTROL_CHARACTER.test(String(c.value??''))))
      fail(400,'control_character','اسم العمود أو قيمته الثابتة بلا سطر جديد أو جدولة أو محرف تحكم');
    return {name:v.text(c.name,'اسم العمود',60,1),position:c.position,length,type:c.type,source:c.source,
      required:c.required===true,value:c.source==='constant'?v.text(c.value,'القيمة الثابتة',120,1):'',pad,pad_char:padChar};
  }).sort((a,b)=>a.position-b.position);
  if(columns.some((c,index)=>c.position!==index+1))fail(400,'column_position','ترتيب الأعمدة من 1 إلى عددها دون فجوة');
  return columns;
}
function formatView(db,u,row){
  const name=userId=>userId?db.prepare('SELECT name FROM users WHERE id=?').get(userId)?.name??null:null,actions=[];
  if(row.status==='draft'&&row.recorded_by!==u.id&&u.caps.includes('payroll.approve'))actions.push('confirm_format','reject_format');
  if(row.status==='draft'&&row.recorded_by===u.id&&u.caps.includes('payroll.prepare'))actions.push('withdraw_format');
  if(row.status==='active'&&u.caps.includes('payroll.approve'))actions.push('retire_format');
  return {...row,columns:JSON.parse(row.columns),include_header:!!row.include_header,recorded_by_name:name(row.recorded_by),confirmed_by_name:name(row.confirmed_by),
    status_name:{draft:'مسودة بانتظار تأكيد المواصفة',active:'مؤكدة وسارية',rejected:'مرفوضة',retired:'متقاعدة'}[row.status],actions};
}
export const activeFormat=(db,tenantId)=>db.prepare("SELECT * FROM wps_file_formats WHERE tenant_id=? AND status='active' ORDER BY confirmed_at DESC LIMIT 1").get(tenantId)??null;

export function recordFileFormat(db,supplied,input){
  writing(db);
  const u=staff(db,supplied);need(u,'payroll.prepare','إدخال مواصفة الملف لمن يعد الرواتب، ويؤكدها شخص آخر');
  v.object(input,['bank_name','format_label','layout','delimiter','encoding','line_ending','include_header','columns','spec_source','spec_confirmed_on']);
  if(!LAYOUTS.some(l=>l.key===input.layout))fail(400,'layout','اختر شكل الملف كما في المواصفة');
  if(!ENCODINGS.some(e=>e.key===input.encoding))fail(400,'encoding','المنصة تنتج UTF-8 فقط. إن طلبت الجهة ترميزًا آخر فالتحويل خارج المنصة');
  if(!LINE_ENDINGS.some(l=>l.key===input.line_ending))fail(400,'line_ending','اختر نهاية السطر كما في المواصفة');
  const delimiter=input.layout==='delimited'?v.text(input.delimiter,'الفاصل',4,1):'';
  if(delimiter.includes('\n')||delimiter.includes('\r'))fail(400,'delimiter','الفاصل محرف واحد أو رمز قصير، لا سطر جديد');
  const bank=v.text(input.bank_name,'البنك أو الجهة المستقبِلة',180,2);
  const columns=cleanColumns(input.columns,input.layout);
  const confirmedOn=v.date(input.spec_confirmed_on);
  if(confirmedOn>riyadhToday())fail(400,'spec_confirmed_on','تاريخ تأكيد المواصفة لا يكون في المستقبل');
  if(db.prepare("SELECT 1 FROM wps_file_formats WHERE tenant_id=? AND bank_name=? AND status='draft'").get(u.tenant_id,bank))fail(409,'draft_exists','لهذا البنك مسودة مواصفة بانتظار التأكيد');
  const revision=(db.prepare('SELECT MAX(revision) AS n FROM wps_file_formats WHERE tenant_id=? AND bank_name=?').get(u.tenant_id,bank).n??0)+1;
  const formatId=id(),time=now();
  db.prepare("INSERT INTO wps_file_formats(id,tenant_id,bank_name,format_label,revision,layout,delimiter,encoding,line_ending,include_header,columns,spec_source,spec_confirmed_on,status,recorded_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,'draft',?,?,?)")
    .run(formatId,u.tenant_id,bank,v.text(input.format_label,'اسم الصيغة وإصدارها',180,2),revision,input.layout,delimiter,input.encoding,input.line_ending,input.include_header===true?1:0,
      JSON.stringify(columns),v.text(input.spec_source,'من أين أُخذت المواصفة حرفيًا',2000,10),confirmedOn,u.id,time,time);
  audit(db,u,'wps_file_format',formatId,'wps_format.recorded',{},{bank_name:bank,revision,columns:columns.length});
  return {id:formatId};
}
export function decideFileFormat(db,supplied,formatId,decision,input){
  writing(db);
  const u=staff(db,supplied);
  if(!['confirm','reject','retire','withdraw'].includes(decision))fail(404,'not_found','الإجراء غير متاح');
  v.object(input,['version','note']);
  const row=typeof formatId==='string'&&db.prepare('SELECT * FROM wps_file_formats WHERE id=? AND tenant_id=?').get(formatId,u.tenant_id);
  if(!row)fail(404,'not_found','المواصفة غير متاحة');
  v.version(input.version,row.version);
  const view=formatView(db,u,row),action={confirm:'confirm_format',reject:'reject_format',retire:'retire_format',withdraw:'withdraw_format'}[decision];
  if(!view.actions.includes(action))fail(409,'action_unavailable','الإجراء غير متاح في حالة المواصفة الحالية أو لصلاحيتك. من أدخل المواصفة لا يؤكدها');
  const time=now();
  if(decision==='withdraw'){
    db.prepare('DELETE FROM wps_file_formats WHERE id=?').run(row.id);
    audit(db,u,'wps_file_format',row.id,'wps_format.withdrawn',{status:'draft'},{withdrawn:true},v.text(input.note,'سبب السحب',2000,10));
    return {id:row.id,status:'withdrawn'};
  }
  if(decision==='confirm'){
    const live=db.prepare("SELECT * FROM wps_file_formats WHERE tenant_id=? AND bank_name=? AND status='active'").get(u.tenant_id,row.bank_name);
    // المؤكدة لا تُعدَّل: النسخة الجديدة تحل محلها وتبقى القديمة متقاعدة في السجل.
    if(live)db.prepare("UPDATE wps_file_formats SET status='retired',version=version+1,updated_at=? WHERE id=?").run(time,live.id);
  }
  const status={confirm:'active',reject:'rejected',retire:'retired'}[decision];
  const note=v.text(input.note,decision==='confirm'?'ما الذي طابقته مع حساب المنشأة لدى الجهة':'سبب القرار',2000,10);
  if(decision==='retire')db.prepare('UPDATE wps_file_formats SET status=?,decision_note=?,version=version+1,updated_at=? WHERE id=?').run(status,note,time,row.id);
  else db.prepare('UPDATE wps_file_formats SET status=?,confirmed_by=?,confirmed_at=?,decision_note=?,version=version+1,updated_at=? WHERE id=?').run(status,u.id,time,note,time,row.id);
  audit(db,u,'wps_file_format',row.id,'wps_format.'+status,{status:row.status},{status});
  return {id:row.id,status};
}

// ── بناء الملف من التعريف وحده: لا اسم عمود ولا ترتيب ولا طول مكتوب في الكود ──────────────────────
// محرف تحكم داخل خلية (سطر جديد، رجوع، جدولة، NUL…) يكسر السطر في ملف يُقرأ سطرًا سطرًا ويسمح بحقن سطر دفع
// كامل بآيبان ومبلغ من خارج المسير. لا تُهرَّب هذه المحارف ولا تُحذف بصمت: وجودها يمنع التصدير حتى يُصحَّح البيان.
// فواصل الأسطر في يونيكود (U+0085 وU+2028 وU+2029) تُعامل مثلها لأن بعض القارئات تكسر السطر عندها.
export const CONTROL_CHARACTER=/[\r\n\t\x00-\x1f\x7f\u0085\u2028\u2029]/;
const LINE_BREAK=/\r\n|[\r\n\u0085\u2028\u2029]/g;
const guardFormula=text=>/^[=+\-@\t\r]/.test(text)?`'${text}`:text;
function delimitedCell(text,delimiter){
  if(CONTROL_CHARACTER.test(text))fail(409,'control_character','خلية فيها محرف تحكم (سطر جديد أو جدولة أو ما شابه) لا تدخل ملف الأجور');
  const safe=guardFormula(text);
  return safe.includes(delimiter)||safe.includes('"')?`"${safe.replace(/"/g,'""')}"`:safe;
}
function fixedCell(text,column){
  if(CONTROL_CHARACTER.test(text))fail(409,'control_character','خلية فيها محرف تحكم (سطر جديد أو جدولة أو ما شابه) لا تدخل ملف الأجور');
  const filler=column.pad_char==='zero'?'0':' ';
  return column.pad==='left'?text.padStart(column.length,filler):text.padEnd(column.length,filler);
}
// عدد الأسطر في الملف الناتج = سطور المسير (+ سطر العناوين). أي فرق يعني أن خلية كسرت سطرًا، فلا يخرج الملف.
export function wageFileLineCount(content){
  const body=content.startsWith('\ufeff')?content.slice(1):content;
  return (body.match(LINE_BREAK)??[]).length;
}
export function buildWageFile(definition,matrix){
  const columns=definition.columns,ending=definition.line_ending==='lf'?'\n':'\r\n';
  const line=cells=>definition.layout==='fixed'?cells.map((text,index)=>fixedCell(text,columns[index])).join(''):cells.map(text=>delimitedCell(text,definition.delimiter)).join(definition.delimiter);
  const rows=[...(definition.include_header?[columns.map(c=>c.name)]:[]),...matrix].map(line);
  const content=(definition.encoding==='utf-8-bom'?'\ufeff':'')+rows.join(ending)+ending;
  const expected=matrix.length+(definition.include_header?1:0);
  if(wageFileLineCount(content)!==expected)fail(409,'line_count_mismatch',`عدد أسطر الملف ${wageFileLineCount(content)} لا يساوي عدد سطوره المتوقع ${expected}. لا يخرج ملف انكسر فيه سطر`);
  return content;
}
function cellValue(column,context){
  const {line,range,bank,identity,contract}=context;
  const text=(()=>{switch(column.source){
    case 'employee_id':return line.user_id;
    case 'employee_name':return line.employee_name;
    case 'identity_reference':return identity?.reference??'';
    case 'identity_expires_on':return identity?.expires_on??'';
    case 'iban':return bank?unseal(bank.iban):'';
    case 'bank_name':return bank?.bank_name??'';
    case 'net_amount':return amount(line.net_minor);
    case 'gross_amount':return amount(line.gross_minor+line.additions_minor);
    case 'basic_amount':return amount(componentPaid(line,'basic'));
    case 'housing_amount':return amount(componentPaid(line,'housing'));
    case 'transport_amount':return amount(componentPaid(line,'transport'));
    case 'other_allowance_amount':return amount(componentPaid(line,'other_allowance'));
    case 'additions_amount':return amount(line.additions_minor);
    case 'deductions_amount':return amount(line.unpaid_absence_minor+line.social_insurance_minor+line.advance_minor+line.other_deductions_minor);
    case 'unpaid_days':return String(unpaidDays(line));
    case 'month':return range.month;
    case 'month_start':return range.from;
    case 'month_end':return range.to;
    case 'contract_start':return contract?.start_date??'';
    case 'constant':return column.value;
    default:return '';
  }})();
  return String(text);
}

// ── التحويل والرفع (الحزمة 4، P4-HR-4، D7، الترحيل 175) ──────────────────────────────────────────────
// البنك يأخذ ملف التحويل (دفع المسير المعتمد)، والجهة تأخذ نسخة الامتثال هذه من السطور نفسها: تُصدَّر من التحويل المعتمد بمجموعه،
// وتُرفع مرة واحدة للمسير. كان الملف لا يرتبط بتحويل، وكل تصدير للمسير يستطيع أن يوثّق رفعًا.
export const liveTransfer=(db,run)=>db.prepare("SELECT * FROM payroll_payments WHERE run_id=? AND status IN ('approved','executed') ORDER BY created_at DESC LIMIT 1").get(run.id)??null;
export const recordedUpload=(db,runId)=>db.prepare('SELECT id,uploaded_on,upload_reference FROM wps_exports WHERE run_id=? AND uploaded_on IS NOT NULL').get(runId)??null;

// ── الفحوص قبل التصدير: تكشف قبل الرفع ما يُرفض بعده. الجسيم يمنع التصدير، وغيره ينبّه ─────────────
function plan(db,tenantId,run,format){
  const range=monthRange(run.month),lines=runLines(db,run.id),blocking=[],warnings=[],info=[];
  const definition=format?{...format,columns:JSON.parse(format.columns),include_header:!!format.include_header}:null;
  const add=(bucket,key,title,detail,employees=[])=>bucket.push({key,level:bucket===blocking?'blocking':bucket===warnings?'warn':'info',title,detail,employees});
  {const shadow=parallelBlocker(db,tenantId,run.month);if(shadow)add(blocking,shadow.key,shadow.title,shadow.detail);}
  if(!definition){
    add(blocking,'format_missing','لا توجد مواصفة ملف مؤكدة',`${SCREEN_NOTE} لا يُبنى ملف بلا تعريف مؤكد.`);
    return {range,lines,rows:[],matrix:[],total:0,blocking,warnings,info,definition:null};
  }
  add(info,'format_provenance',`المواصفة: ${definition.format_label} — ${definition.bank_name} (نسخة ${definition.revision})`,
    `مصدرها كما كتبه مُدخلها: ${definition.spec_source}. تاريخ تأكيدها ${definition.spec_confirmed_on}. راجعها في حساب المنشأة قبل كل رفع؛ المنصة لا تعرف تغيّرها.`);
  if(definition.columns.some(c=>c.source==='identity_reference'))
    add(warnings,'identity_not_stored','عمود الهوية يُملأ بمرجع مختصر لا برقم كامل','المنصة لا تخزن أرقام الهوية أو الإقامة كاملة. إن كانت الجهة تطلب الرقم الكامل فأكمله خارج المنصة قبل الرفع.');

  const groups=new Map(),push=(key,line)=>{if(!groups.has(key))groups.set(key,[]);groups.get(key).push({id:line.user_id,name:line.employee_name});};
  const matrix=[],rows=[],controlColumns=new Set();let total=0,longValue=null,emptyRequired=null;
  for(const line of lines){
    const {verified,pending}=bankState(db,line.user_id,run.month),identity=identityDocument(db,line.user_id),contract=contractInForce(db,line.user_id,range);
    if(!verified&&!pending)push('missing_bank',line);
    if(!verified&&pending)push('unverified_bank',line);
    if(!identity)push('missing_identity',line);
    else if(identity.expires_on<=range.to)push('expired_identity',line);
    if(line.net_minor<=0)push(line.variance_note?'non_positive_net_explained':'non_positive_net',line);
    if(!contract)push('in_run_not_employed',line);
    else if(!line.employee_active)push('inactive_but_paid',line);
    if(line.net_minor<=0||!verified)continue;
    const cells=definition.columns.map(column=>{
      const text=cellValue(column,{line,range,bank:verified,identity,contract});
      if(CONTROL_CHARACTER.test(text)){push('control_character',line);controlColumns.add(column.name);}
      if(column.required&&!text.trim())emptyRequired={column:column.name,employee:line.employee_name};
      if(column.length!==null&&text.length>column.length)longValue={column:column.name,employee:line.employee_name,length:text.length,max:column.length};
      return text;
    });
    matrix.push(cells);rows.push({user_id:line.user_id,employee_name:line.employee_name,net_minor:line.net_minor});total+=line.net_minor;
  }
  const onDuty=onDutyEmployees(db,tenantId,range),inRun=new Set(lines.map(l=>l.user_id));
  const absent=onDuty.filter(person=>!inRun.has(person.id));
  const named=key=>groups.get(key)??[];
  if(named('missing_bank').length)add(blocking,'missing_bank','موظف في المسير بلا حساب بنكي مسجل','لا يُقبل سطر بلا آيبان. سجّل الحساب من شاشة حركات الرواتب وتحقق منه قبل التصدير.',named('missing_bank'));
  if(named('unverified_bank').length)add(blocking,'unverified_bank','حساب بنكي مسجل ولم يتحقق منه أحد','التحقق من ملكية الحساب يكون بشخص غير من سجله. الصيغة الصحيحة لا تثبت الملكية.',named('unverified_bank'));
  if(named('missing_identity').length)add(blocking,'missing_identity','موظف بلا هوية أو إقامة مسجلة في سجله الوظيفي','عمود الهوية لا يُملأ من فراغ، والجهة ترفض السطر. سجّل الوثيقة في السجل الوظيفي.',named('missing_identity'));
  if(named('expired_identity').length)add(warnings,'expired_identity','وثيقة هوية أو إقامة منتهية قبل نهاية الشهر','قد تُرفض عند الرفع. جدّد الوثيقة وسجّل البديل في السجل الوظيفي.',named('expired_identity'));
  if(named('non_positive_net').length)add(blocking,'non_positive_net','صافي صفر أو أقل بلا سبب مسجل','اكتب سبب الصافي في تبرير فرق السطر أثناء مراجعة المسير، أو صحّح المسير قبل التصدير.',named('non_positive_net'));
  if(named('non_positive_net_explained').length)add(warnings,'non_positive_net_explained','صافي صفر بسبب مسجل — لا يظهر في الملف','السطر خارج الملف لأن لا مبلغ يُحوَّل. تأكد أن الجهة لا تحتاج تسجيله بصفر.',named('non_positive_net_explained'));
  if(named('in_run_not_employed').length)add(blocking,'in_run_not_employed','في المسير وليس على رأس العمل','لا عقد يغطي أي يوم من الشهر. راجع السطر قبل أن يصبح أجرًا مسجلًا لغير موظف.',named('in_run_not_employed'));
  if(named('inactive_but_paid').length)add(warnings,'inactive_but_paid','حساب موقوف وله استحقاق في الشهر','غالبًا شهر نهاية الخدمة. تأكد من التسوية النهائية ومن أن الجهة تنتظر هذا السطر.',named('inactive_but_paid'));
  if(absent.length)add(blocking,'on_duty_not_in_run','على رأس العمل وليس في المسير','موظف بعقد يغطي الشهر بلا سطر في المسير؛ غيابه عن الملف هو ما يُرصد على المنشأة.',absent);
  if(emptyRequired)add(blocking,'required_column_empty',`عمود إلزامي في المواصفة بلا قيمة: ${emptyRequired.column}`,`أول حالة: ${emptyRequired.employee}. المنصة لا تخترع قيمة لعمود لا تعرفه.`);
  if(longValue)add(blocking,'value_too_long',`قيمة أطول من طول العمود: ${longValue.column}`,`${longValue.employee}: ${longValue.length} محرفًا والمواصفة ${longValue.max}. صحّح البيان أو راجع الطول في حساب المنشأة.`);
  if(named('control_character').length)add(blocking,'control_character',`محرف تحكم داخل خلية: ${[...controlColumns].join('، ')}`,
    'سطر جديد أو رجوع أو جدولة أو محرف تحكم آخر داخل بيان (اسم البنك أو الاسم أو قيمة ثابتة) يكسر السطر في ملف يُقرأ سطرًا سطرًا، وقد يُدخل سطر دفع لم يعتمده أحد. صحّح البيان في مصدره ثم أعد الفحوص؛ المنصة لا تحذفه بصمت.',
    [...new Map(named('control_character').map(e=>[e.id,e])).values()]);
  if(definition.include_header&&definition.columns.some(c=>CONTROL_CHARACTER.test(c.name)))
    add(blocking,'control_character_header','محرف تحكم في اسم عمود من أعمدة المواصفة','أعد إدخال المواصفة بأسماء أعمدة بلا سطر جديد أو جدولة.');
  if(!matrix.length)add(blocking,'empty_file','لا سطر واحد يدخل الملف','لا يُرفع ملف فارغ. عالج ما سبق حتى يصبح لكل مستحق سطر.');
  if(!blocking.some(c=>c.key.startsWith('control_character'))&&matrix.length){
    const expected=matrix.length+(definition.include_header?1:0);
    let produced=null;try{buildWageFile(definition,matrix);produced=expected;}catch(error){if(error.code!=='line_count_mismatch'&&error.code!=='control_character')throw error;produced=-1;}
    if(produced!==expected)add(blocking,'line_count_mismatch','عدد أسطر الملف لا يساوي عدد سطور المسير',`المتوقع ${expected} سطرًا (${matrix.length} مستحقًا${definition.include_header?' وسطر العناوين':''}). لا يُرفع ملف انكسر فيه سطر.`);
  }
  if(total!==run.net_minor)add(blocking,'total_mismatch','مجموع الملف لا يساوي مجموع المسير المعتمد',`الملف ${amount(total)} والمسير ${amount(run.net_minor)} ريال. الفرق ${amount(run.net_minor-total)}؛ لا يُرفع ملف لا يطابق ما اعتُمد.`);
  // D7: النسخة تُصدَّر من التحويل المعتمد بمجموعه، وتُرفع مرة واحدة للمسير.
  const transfer=liveTransfer(db,run),uploaded=recordedUpload(db,run.id);
  if(!transfer)add(blocking,'transfer_not_approved','ما فيه تحويل معتمد لهالمسير','ملف حماية الأجور نسخة امتثال من تحويل المسير المعتمد: يُعدّ التحويل ويعتمده زميل من «حركات الرواتب والتسويات» (بعد ترحيل قيد المسير)، وبعدها يتصدّر الملف.');
  else if(transfer.amount_minor!==run.net_minor)add(blocking,'transfer_total_mismatch','مجموع التحويل المعتمد غير مجموع المسير',`التحويل ${amount(transfer.amount_minor)} والمسير ${amount(run.net_minor)} ريال؛ النسخة والتحويل من السطور نفسها أو لا تخرج.`);
  if(uploaded)add(blocking,'already_uploaded','ملف هالمسير مرفوع من قبل',`انرفع يوم ${uploaded.uploaded_on} بمرجع ${uploaded.upload_reference}. الرفع مرة واحدة للمسير؛ والتصحيح بعده أثر رجعي في شهر لاحق.`);
  return {range,lines,rows,matrix,total,blocking,warnings,info,definition,transfer};
}

export function preExportChecks(db,supplied,runId){
  const u=staff(db,supplied),run=runFor(db,u.tenant_id,runId);
  if(!run||run.status!=='approved')fail(404,'not_found','فحوص ما قبل التصدير لمسير معتمد');
  const result=plan(db,u.tenant_id,run,activeFormat(db,u.tenant_id));
  return {run_id:run.id,month:run.month,note:SCREEN_NOTE,blocking:result.blocking,warnings:result.warnings,info:result.info,
    can_export:!result.blocking.length,rows:result.rows.length,file_total_minor:result.total,run_total_minor:run.net_minor};
}

export function prepareWageFile(db,supplied,input){
  writing(db);
  const u=staff(db,supplied);need(u,'payroll.prepare','تصدير ملف الأجور لمن يعد الرواتب');
  v.object(input,['run_id']);
  const run=runFor(db,u.tenant_id,input.run_id);
  if(!run||run.status!=='approved')fail(404,'not_found','التصدير لمسير معتمد فقط');
  assertPlatformPays(db,u.tenant_id,run.month,'wps');
  const format=activeFormat(db,u.tenant_id),result=plan(db,u.tenant_id,run,format);
  if(result.blocking.length)fail(409,'export_blocked',`لا يُصدَّر الملف قبل معالجة ما يمنعه: ${result.blocking.map(c=>c.title).join('؛ ')}`);
  const content=buildWageFile(result.definition,result.matrix),exportId=id();
  db.prepare('INSERT INTO wps_exports(id,tenant_id,run_id,format_id,month,headcount,total_minor,run_total_minor,file_digest,checks,warning_count,exported_by,created_at,payment_id) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
    .run(exportId,u.tenant_id,run.id,format.id,run.month,result.matrix.length,result.total,run.net_minor,hash(content),
      JSON.stringify([...result.blocking,...result.warnings,...result.info]),result.warnings.length,u.id,now(),result.transfer.id);
  audit(db,u,'wps_export',exportId,'wps_export.prepared',{},{month:run.month,headcount:result.matrix.length,format_id:format.id,warnings:result.warnings.length,payment_id:result.transfer.id});
  return {id:exportId};
}
// الملف يُبنى عند التنزيل ولا يُخزَّن؛ بصمته محفوظة ليُكتشف أي تغير في البيانات بين التصدير والتنزيل.
export function wageFileContent(db,supplied,exportId){
  const u=staff(db,supplied);
  const row=typeof exportId==='string'&&db.prepare('SELECT * FROM wps_exports WHERE id=? AND tenant_id=?').get(exportId,u.tenant_id);
  if(!row)fail(404,'not_found','التصدير غير متاح');
  const run=runFor(db,u.tenant_id,row.run_id),format=db.prepare('SELECT * FROM wps_file_formats WHERE id=?').get(row.format_id);
  const result=plan(db,u.tenant_id,run,format),content=buildWageFile(result.definition,result.matrix);
  if(hash(content)!==row.file_digest)fail(409,'file_changed','تغيرت بيانات الموظفين بعد التصدير. صدّر الملف من جديد وأعد الفحوص');
  audit(db,u,'wps_export',row.id,'wps_export.file_downloaded',{},{month:row.month,simulated:true});
  // الحزمة 3: حماية الأجور محاكاة حتى يوجد وصول معتمد (app/integration-readiness.mjs، جهة «مدد»). الملف المسلَّم يقول ذلك في أول
  // سطر وفي اسمه — سطرٌ خارج المواصفة عمدًا فلا يُرفع كما هو ويُحسب رفعًا — وبعده الملف كما عرّفته المواصفة بحرفه. البصمة المحفوظة
  // بصمة ملف المواصفة بلا العلامة، فمقارنة التغيّر لا تتأثر.
  const ending=format.line_ending==='lf'?'\n':'\r\n',marker='SIMULATED — ملف محاكاة من المنصة ما يُرفع لجهة ولا يُعدّ رفعًا';
  const marked=content.startsWith('\ufeff')?`\ufeff${marker}${ending}${content.slice(1)}`:`${marker}${ending}${content}`;
  return {filename:`wage-protection-${row.month}-SIMULATED.${format.layout==='fixed'?'txt':'csv'}`,content:marked,simulated:true,integration_status:integrationStatus('mudad')};
}
export function recordManualUpload(db,supplied,exportId,input){
  writing(db);
  const u=staff(db,supplied);
  if(!u.caps.includes('payroll.review')&&!u.caps.includes('payroll.approve'))fail(403,'not_permitted','توثيق الرفع اليدوي لمن يراجع المسير أو يعتمده');
  v.object(input,['version','uploaded_on','reference','note']);
  const row=typeof exportId==='string'&&db.prepare('SELECT * FROM wps_exports WHERE id=? AND tenant_id=?').get(exportId,u.tenant_id);
  if(!row)fail(404,'not_found','التصدير غير متاح');
  v.version(input.version,row.version);
  if(row.uploaded_on)fail(409,'already_recorded','سبق توثيق رفع هذا الملف');
  if(row.exported_by===u.id)fail(409,'separation_of_duties','من صدّر الملف لا يوثق رفعه');
  // D7 (الترحيل 175): رفعٌ واحد للمسير، ولمسير معتمد غير منعكس وتحويله الحي.
  const other=recordedUpload(db,row.run_id),run=runFor(db,u.tenant_id,row.run_id);
  if(other)refuse(409,'run_already_uploaded',{what:`ملف مسير ${row.month} مرفوع من قبل يوم ${other.uploaded_on} بمرجع ${other.upload_reference}`,
    missing:[{document:'رفعٌ واحد موثّق للمسير',why:'الجهة تسجّل الأجر مرة للشهر؛ رفعان لمسير واحد يتركان رقمين لا يُعرف أيهما المعتمد',owner:'مراجع الرواتب أو معتمدها',owner_role:'payroll.review'}],
    next:'هالتصدير يبقى في السجل بلا رفع؛ والتصحيح بعد الرفع أثر رجعي في شهر لاحق'});
  if(run?.status!=='approved'||(row.payment_id&&!['approved','executed'].includes(db.prepare('SELECT status FROM payroll_payments WHERE id=?').get(row.payment_id)?.status)))
    refuse(409,'export_not_live',{what:`ملف مسير ${row.month} ما عاد يمثّل مسيرًا معتمدًا وتحويلًا حيًّا${run?.status==='reversed'?': المسير انعكس':': تحويله انلغى'}`,
      missing:[{document:'تصدير جديد من المسير المصحَّح وتحويله المعتمد',why:'ما يُرفع للجهة إلا ملفٌ يطابق ما سيُصرف فعلًا',owner:'مُعد الرواتب',owner_role:'payroll.prepare'}],
      next:'صدّر الملف من جديد بعد اعتماد المسير المصحَّح وتحويله'});
  const uploaded=v.date(input.uploaded_on);
  // يوم التصدير بتوقيت الرياض: created_at طابع UTC، وأول عشرة أحرف منه تسبق يوم الرياض بيوم بين 00:00 و03:00.
  if(uploaded<riyadhDateOf(row.created_at)||uploaded>riyadhToday())fail(400,'uploaded_on','تاريخ الرفع بين تاريخ التصدير واليوم');
  db.prepare('UPDATE wps_exports SET uploaded_on=?,upload_reference=?,upload_note=?,upload_recorded_by=?,upload_recorded_at=?,version=version+1 WHERE id=?')
    .run(uploaded,v.text(input.reference,'مرجع الرفع لدى الجهة أو البنك',120,3),v.text(input.note,'ما الذي رُفع وأين وما نتيجته الظاهرة',2000,10),u.id,now(),row.id);
  audit(db,u,'wps_export',row.id,'wps_export.upload_recorded',{uploaded:false},{uploaded_on:uploaded});
  return {id:row.id,uploaded_on:uploaded};
}

export function wpsBoard(db,supplied){
  const u=staff(db,supplied),today=riyadhToday();
  const name=userId=>userId?db.prepare('SELECT name FROM users WHERE id=?').get(userId)?.name??null:null;
  const formats=db.prepare('SELECT * FROM wps_file_formats WHERE tenant_id=? ORDER BY created_at DESC').all(u.tenant_id).map(row=>formatView(db,u,row));
  const format=activeFormat(db,u.tenant_id);
  const runs=db.prepare("SELECT * FROM payroll_runs WHERE tenant_id=? AND status='approved' ORDER BY month DESC LIMIT 6").all(u.tenant_id).map(run=>{
    const result=plan(db,u.tenant_id,run,format),blocked=result.blocking.length>0;
    return {id:run.id,month:run.month,net_minor:run.net_minor,headcount:run.headcount,file_total_minor:result.total,rows:result.matrix.length,
      blocking:result.blocking,warnings:result.warnings,info:result.info,can_export:!blocked,
      actions:!blocked&&u.caps.includes('payroll.prepare')?['export_wage_file']:[]};
  });
  const exports=db.prepare('SELECT e.*,f.bank_name,f.format_label,f.revision FROM wps_exports e JOIN wps_file_formats f ON f.id=e.format_id WHERE e.tenant_id=? ORDER BY e.created_at DESC LIMIT 60').all(u.tenant_id)
    .map(row=>{
      // التوثيق يُعرض حيث يقبله الخادم وحده: تصديرٌ لم يُرفع، لمسير معتمد لم يُرفع ملفه بعد، وتحويله حي (D7).
      const run=runFor(db,u.tenant_id,row.run_id),live=run?.status==='approved'&&(!row.payment_id||['approved','executed'].includes(db.prepare('SELECT status FROM payroll_payments WHERE id=?').get(row.payment_id)?.status));
      const open=!row.uploaded_on&&live&&!recordedUpload(db,row.run_id);
      return {...row,checks:JSON.parse(row.checks),exported_by_name:name(row.exported_by),upload_recorded_by_name:name(row.upload_recorded_by),run_status:run?.status??null,
        actions:open&&row.exported_by!==u.id&&(u.caps.includes('payroll.review')||u.caps.includes('payroll.approve'))?['record_upload']:[]};
    });
  return {today,user_id:u.id,permissions:u.caps,note:SCREEN_NOTE,
    layouts:LAYOUTS,encodings:ENCODINGS,line_endings:LINE_ENDINGS,pads:PADS,pad_chars:PAD_CHARS,source_fields:WPS_SOURCE_FIELDS,
    formats,active_format_id:format?.id??null,runs,exports,
    limits:'المنصة تنتج نصًا بترميز UTF-8 فقط، ولا ترفع الملف ولا تقرأ رد الجهة. ما لا تعرفه المنصة يُترك فارغًا أو يُدخل قيمة ثابتة في المواصفة.'};
}
