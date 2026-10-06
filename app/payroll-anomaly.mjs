import { audit, now, hash } from './db.mjs';
import { fail } from './auth.mjs';
import * as v from './validation.mjs';
import { unseal } from './crypto-fields.mjs';
import { staff, need, writing, riyadhToday, monthRange, runLines, runFor } from './wage-basis.mjs';

// كشف شذوذ المسير: فحوص حتمية بقواعد مكتوبة، لا نموذج لغوي ولا ترجيح. تُعرض للمراجع والمعتمد قبل قرارهم.
// كل نتيجة استشارية لا مانعة: لا تغيّر رقمًا ولا تمنع إجراءً، وتقول سببها ومن تخصه.
export const BOARD_NOTE='فحوص استشارية لا مانعة، بقواعد حتمية يحددها المستخدم بعتباته. لا تغيّر المنصة رقمًا في المسير ولا تمنع اعتماده؛ القرار للمراجع والمعتمد.';
export const THRESHOLD_NOTE='العتبات فارغة حتى يدخلها صاحبها بسندها. الفحص بلا عتبة لا يعمل ويقول ذلك، ولا تفترض المنصة نسبة ولا مبلغًا.';
const deductionsOf=line=>line.unpaid_absence_minor+line.social_insurance_minor+line.advance_minor+line.other_deductions_minor;
const payableOf=line=>line.gross_minor+line.additions_minor;
const overtimeOf=line=>line.adjustments.filter(a=>a.kind==='overtime').reduce((n,a)=>n+a.amount_minor,0);
const monthlyComponents=line=>new Map(line.earnings.map(l=>[l.component,l.monthly_minor??l.amount_minor]));
const person=line=>({id:line.user_id,name:line.employee_name,line_id:line.id});

export const anomalySettings=(db,tenantId)=>db.prepare('SELECT * FROM payroll_anomaly_settings WHERE tenant_id=?').get(tenantId)??null;

export function saveAnomalySettings(db,supplied,input){
  writing(db);
  const u=staff(db,supplied);need(u,'payroll.approve','تحديد عتبات كشف الشذوذ لمعتمد الرواتب');
  v.object(input,['version','variance_bp','variance_amount','deduction_ratio_bp','overtime_factor_bp','basis']);
  const optional=(value,label,min,max)=>{
    if(value===null||value===undefined||value==='')return null;
    if(!Number.isInteger(value)||value<min||value>max)fail(400,'threshold',`${label}: عدد صحيح بين ${min} و${max}`);
    return value;
  };
  const varianceBp=optional(input.variance_bp,'نسبة الفرق عن الشهر السابق بنقاط الأساس',1,100000);
  const deductionBp=optional(input.deduction_ratio_bp,'نسبة الخصم من الإجمالي بنقاط الأساس',1,10000);
  const overtimeBp=optional(input.overtime_factor_bp,'معامل العمل الإضافي بنقاط الأساس',10000,1000000);
  let varianceAmount=null;
  if(input.variance_amount!==null&&input.variance_amount!==undefined&&input.variance_amount!==''){
    if(typeof input.variance_amount!=='string'||!/^(?:0|[1-9]\d{0,7})(?:\.\d{1,2})?$/.test(input.variance_amount))fail(400,'threshold','مبلغ الفرق: مبلغ بخانتين عشريتين كحد أقصى');
    const [whole,fraction='']=input.variance_amount.split('.');varianceAmount=Number(BigInt(whole)*100n+BigInt(fraction.padEnd(2,'0')));
    if(varianceAmount<=0)fail(400,'threshold','مبلغ الفرق: مبلغ موجب');
  }
  const basis=v.text(input.basis,'سند العتبات ومن قررها',2000,10),current=anomalySettings(db,u.tenant_id),time=now();
  if(current){
    v.version(input.version,current.version);
    db.prepare('UPDATE payroll_anomaly_settings SET variance_bp=?,variance_amount_minor=?,deduction_ratio_bp=?,overtime_factor_bp=?,basis=?,version=version+1,updated_by=?,updated_at=? WHERE tenant_id=?')
      .run(varianceBp,varianceAmount,deductionBp,overtimeBp,basis,u.id,time,u.tenant_id);
  }else{
    db.prepare('INSERT INTO payroll_anomaly_settings(tenant_id,variance_bp,variance_amount_minor,deduction_ratio_bp,overtime_factor_bp,basis,updated_by,updated_at) VALUES(?,?,?,?,?,?,?,?)')
      .run(u.tenant_id,varianceBp,varianceAmount,deductionBp,overtimeBp,basis,u.id,time);
  }
  audit(db,u,'payroll_anomaly_settings',u.tenant_id,'payroll_anomaly.thresholds_set',current?{version:current.version}:{},{variance_bp:varianceBp,variance_amount_minor:varianceAmount,deduction_ratio_bp:deductionBp,overtime_factor_bp:overtimeBp});
  return {tenant_id:u.tenant_id,version:(current?.version??0)+1};
}

// حسابان بنكيان متطابقان لموظفين مختلفين: أهم فحص احتيال في المسير كله. المقارنة على بصمة الرقم في الذاكرة،
// ولا يخرج الآيبان كاملًا من هذه الدالة إطلاقًا — أربع خانات أخيرة واسم البنك فقط.
export function duplicateBankAccounts(db,tenantId){
  const rows=db.prepare("SELECT b.id,b.user_id,b.bank_name,b.iban,b.iban_last4,x.name FROM employee_bank_accounts b JOIN users x ON x.id=b.user_id WHERE b.tenant_id=? AND b.status='verified'").all(tenantId);
  const groups=new Map();
  for(const row of rows){
    const key=hash(unseal(row.iban));
    if(!groups.has(key))groups.set(key,[]);
    groups.get(key).push({id:row.user_id,name:row.name,bank_name:row.bank_name,iban_last4:row.iban_last4,account_id:row.id});
  }
  return [...groups.values()].filter(group=>new Set(group.map(a=>a.id)).size>1);
}

export function runAnomalies(db,tenantId,run){
  const range=monthRange(run.month),lines=runLines(db,run.id),settings=anomalySettings(db,tenantId),findings=[];
  const add=(level,key,title,detail,employees=[],extra={})=>findings.push({key,level,title,detail,employees,...extra});
  const previous=db.prepare("SELECT * FROM payroll_runs WHERE tenant_id=? AND status='approved' AND month<? ORDER BY month DESC LIMIT 1").get(tenantId,run.month)??null;
  const previousLines=previous?runLines(db,previous.id):[],previousBy=new Map(previousLines.map(l=>[l.user_id,l]));
  const historyRuns=db.prepare("SELECT id,month FROM payroll_runs WHERE tenant_id=? AND status='approved' AND month<? ORDER BY month DESC LIMIT 6").all(tenantId,run.month);
  const history=new Map();
  for(const past of historyRuns)for(const line of runLines(db,past.id)){
    if(!history.has(line.user_id))history.set(line.user_id,[]);
    history.get(line.user_id).push({month:past.month,line});
  }

  // 1) تكرار رقم حساب بنكي بين موظفين مختلفين.
  for(const group of duplicateBankAccounts(db,tenantId))
    add('attention','duplicate_bank_account','حساب بنكي واحد لأكثر من موظف',
      `${group.map(a=>a.name).join('، ')} — ${group[0].bank_name} ينتهي بـ ${group[0].iban_last4}. تحقق من كل واحد منهم بقناة مستقلة قبل أي تحويل.`,
      group.map(a=>({id:a.id,name:a.name,account_id:a.account_id})),{critical:true,link:{entity:'employee_bank_accounts',ids:group.map(a=>a.account_id)}});

  // 2) الفرق عن الشهر السابق بعتبة المستخدم.
  if(!settings||(settings.variance_bp===null&&settings.variance_amount_minor===null))
    add('info','variance_threshold_not_set','فحص الفرق عن الشهر السابق لا يعمل: لا عتبة محددة',THRESHOLD_NOTE);
  else if(previous){
    const moved=lines.filter(line=>{
      const before=previousBy.get(line.user_id);if(!before)return false;
      const difference=Math.abs(line.net_minor-before.net_minor);
      const byAmount=settings.variance_amount_minor!==null&&difference>=settings.variance_amount_minor;
      const byRatio=settings.variance_bp!==null&&before.net_minor>0&&difference*10000>=settings.variance_bp*before.net_minor;
      return byAmount||byRatio;
    });
    if(moved.length)add('attention','variance_over_threshold',`${moved.length} صافي تجاوز فرقه عن ${previous.month} العتبة المحددة`,
      `العتبة: ${settings.variance_bp!==null?`${(settings.variance_bp/100).toFixed(2)}%`:'—'}${settings.variance_amount_minor!==null?` أو ${(settings.variance_amount_minor/100).toFixed(2)} ريال`:''}. سند العتبة: ${settings.basis}`,
      moved.map(line=>({...person(line),net_minor:line.net_minor,previous_net_minor:previousBy.get(line.user_id).net_minor})),{link:{entity:'payroll_lines',ids:moved.map(l=>l.id)}});
  }

  // 3) دخول موظف المسير لأول مرة، أو اختفاؤه منه.
  if(previous){
    const fresh=lines.filter(line=>!previousBy.has(line.user_id));
    if(fresh.length)add('attention','first_time_in_run',`${fresh.length} موظف في المسير لأول مرة`,`لم يكن في مسير ${previous.month}. متوقع لمن باشر حديثًا، ويستحق نظرة إن لم يكن كذلك.`,fresh.map(person),{link:{entity:'payroll_lines',ids:fresh.map(l=>l.id)}});
    const gone=previousLines.filter(line=>!lines.some(l=>l.user_id===line.user_id));
    if(gone.length)add('attention','disappeared_from_run',`${gone.length} موظف اختفى من المسير`,`كان في مسير ${previous.month} وليس في هذا الشهر. تأكد من انتهاء العقد أو من أن سطره لم يسقط سهوًا.`,gone.map(person),{link:{entity:'payroll_lines',ids:gone.map(l=>l.id)}});
  }

  // 4) بدل ثابت كان يُصرف وانقطع بلا سبب مسجل في تبرير السطر.
  const stopped=[];
  for(const line of lines){
    const before=previousBy.get(line.user_id);if(!before||line.variance_note)continue;
    const now_=monthlyComponents(line);
    for(const [component,amount] of monthlyComponents(before))if(amount>0&&!(now_.get(component)>0))stopped.push({...person(line),component,previous_minor:amount});
  }
  if(stopped.length)add('attention','allowance_stopped',`${stopped.length} بدل كان يُصرف وانقطع بلا سبب مسجل`,
    'البند كان في عقد الشهر السابق وليس في هذا الشهر، ولا تبرير مكتوب على السطر. اكتب السبب أثناء المراجعة أو راجع تعديل العقد.',stopped,{link:{entity:'payroll_lines',ids:stopped.map(s=>s.line_id)}});

  // 5) صافي سالب أو صفر.
  const empty=lines.filter(line=>line.net_minor<=0);
  if(empty.length)add('attention','non_positive_net',`${empty.length} سطر صافيه صفر أو أقل`,'لا مبلغ يُحوَّل لهذا الموظف هذا الشهر. تأكد أن ذلك مقصود وموثق.',empty.map(person),{link:{entity:'payroll_lines',ids:empty.map(l=>l.id)}});

  // 6) خصم يتجاوز نسبة من الإجمالي.
  if(!settings||settings.deduction_ratio_bp===null)add('info','deduction_threshold_not_set','فحص نسبة الخصم لا يعمل: لا عتبة محددة',THRESHOLD_NOTE);
  else{
    const heavy=lines.filter(line=>payableOf(line)>0&&deductionsOf(line)*10000>settings.deduction_ratio_bp*payableOf(line));
    if(heavy.length)add('attention','deduction_over_ratio',`${heavy.length} سطر خصمه يتجاوز ${(settings.deduction_ratio_bp/100).toFixed(2)}% من إجماليه`,
      `سند العتبة: ${settings.basis}`,heavy.map(line=>({...person(line),deductions_minor:deductionsOf(line),payable_minor:payableOf(line)})),{link:{entity:'payroll_lines',ids:heavy.map(l=>l.id)}});
  }

  // 7) عمل إضافي شاذ مقارنة بتاريخ الموظف في المسيرات المعتمدة السابقة.
  const withOvertime=lines.filter(line=>overtimeOf(line)>0);
  const noHistory=withOvertime.filter(line=>!(history.get(line.user_id)??[]).some(h=>overtimeOf(h.line)>0));
  if(noHistory.length)add('attention','overtime_without_history',`${noHistory.length} عمل إضافي أول مرة لهذا الموظف`,
    `لا عمل إضافي له في آخر ${historyRuns.length} مسير معتمد. تأكد من اعتماد الساعات ومن أساس احتسابها.`,
    noHistory.map(line=>({...person(line),overtime_minor:overtimeOf(line)})),{link:{entity:'payroll_lines',ids:noHistory.map(l=>l.id)}});
  if(!settings||settings.overtime_factor_bp===null)add('info','overtime_threshold_not_set','فحص شذوذ العمل الإضافي بالمقارنة بالتاريخ لا يعمل: لا معامل محدد',THRESHOLD_NOTE);
  else{
    const spikes=withOvertime.map(line=>{
      const past=(history.get(line.user_id)??[]).map(h=>overtimeOf(h.line)).filter(n=>n>0);
      if(!past.length)return null;
      const ceiling=Math.max(...past)*settings.overtime_factor_bp/10000;
      return overtimeOf(line)>ceiling?{...person(line),overtime_minor:overtimeOf(line),highest_before_minor:Math.max(...past)}:null;
    }).filter(Boolean);
    if(spikes.length)add('attention','overtime_outlier',`${spikes.length} عمل إضافي تجاوز أعلى شهر سابق للموظف بمعامل ${(settings.overtime_factor_bp/10000).toFixed(2)}`,
      `سند المعامل: ${settings.basis}`,spikes,{link:{entity:'payroll_lines',ids:spikes.map(s=>s.line_id)}});
  }

  return {run_id:run.id,month:run.month,status:run.status,range,advisory:true,note:BOARD_NOTE,
    compared_with:previous?previous.month:null,history_months:historyRuns.map(r=>r.month),
    findings:findings.sort((a,b)=>(b.critical?1:0)-(a.critical?1:0)||(a.level==='info'?1:0)-(b.level==='info'?1:0)),
    counts:{attention:findings.filter(f=>f.level==='attention').length,info:findings.filter(f=>f.level==='info').length}};
}

export function runAnomalyReport(db,supplied,runId){
  const u=staff(db,supplied),run=runFor(db,u.tenant_id,runId);
  if(!run||run.status==='cancelled')fail(404,'not_found','المسير غير متاح');
  return runAnomalies(db,u.tenant_id,run);
}

export function anomalyBoard(db,supplied){
  const u=staff(db,supplied),today=riyadhToday();
  const settings=anomalySettings(db,u.tenant_id);
  const open=db.prepare("SELECT * FROM payroll_runs WHERE tenant_id=? AND status IN ('draft','in_review','reviewed') ORDER BY month DESC").all(u.tenant_id);
  const lastApproved=db.prepare("SELECT * FROM payroll_runs WHERE tenant_id=? AND status='approved' ORDER BY month DESC LIMIT 1").all(u.tenant_id);
  const runs=[...open,...lastApproved].map(run=>runAnomalies(db,u.tenant_id,run));
  return {today,user_id:u.id,permissions:u.caps,note:BOARD_NOTE,threshold_note:THRESHOLD_NOTE,
    settings:settings?{...settings,updated_by_name:db.prepare('SELECT name FROM users WHERE id=?').get(settings.updated_by)?.name??null}:null,
    can_set_thresholds:u.caps.includes('payroll.approve'),runs,
    rule:'القواعد حتمية: فرق يتجاوز عتبة، أول ظهور أو اختفاء، بدل انقطع، صافي غير موجب، خصم يتجاوز نسبة، تكرار حساب بنكي، عمل إضافي يتجاوز تاريخ الموظف.'};
}
