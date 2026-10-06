import { currentUser } from './delegations.mjs';
import { retroCandidates } from './payroll-retro.mjs';
import { ruleChecks } from './payroll-rules.mjs';
import { tenantLots } from './leave-compensatory.mjs';

// فحص ما قبل المسير: تنبيهات يراها المُعد والمراجع والمعتمد على بطاقة المسير قبل قرارهم.
// استشارية لا مانعة: القرار للإنسان، لكن لا يصح أن يمر المسير دون أن يرى ما قد يغيّره.
const range=month=>{const [y,m]=month.split('-').map(Number),days=new Date(Date.UTC(y,m,0)).getUTCDate();return {from:`${month}-01`,to:`${month}-${String(days).padStart(2,'0')}`};};
export function preRunChecks(db,supplied,run){
  const u=currentUser(db,supplied);if(!u||!run||!['draft','in_review','reviewed'].includes(run.status))return [];
  const {from,to}=range(run.month),out=[],names=rows=>rows.map(r=>r.name).slice(0,8).join('، ')+(rows.length>8?'…':'');
  const add=(level,title,detail)=>out.push({level,title,detail});
  const inRun=db.prepare('SELECT l.user_id,x.name FROM payroll_lines l JOIN users x ON x.id=l.user_id WHERE l.run_id=?').all(run.id),ids=inRun.map(r=>r.user_id),marks=ids.map(()=>'?').join(',')||"''";
  const pendingAdjust=db.prepare("SELECT COUNT(*) AS n FROM payroll_adjustments WHERE tenant_id=? AND month=? AND status='proposed'").get(u.tenant_id,run.month).n;
  if(pendingAdjust)add('warn',`${pendingAdjust} حركة راتب مقترحة لهذا الشهر لم يُبت فيها`,'ما لم يُعتمد قبل اعتماد المسير لا يدخله.');
  const pendingAdvance=db.prepare("SELECT COUNT(*) AS n FROM salary_advances WHERE tenant_id=? AND status='proposed'").get(u.tenant_id).n;
  if(pendingAdvance)add('info',`${pendingAdvance} سلفة مقترحة لم يُبت فيها`,'');
  // الحزمة 4 (P4-HR-3، الترحيل 174): قسط سلفة يُسترد هالشهر وصرفها ما انسجّل — يُسترد من الموظف ما لا يثبت في الدفتر أنه انصرف له.
  const undisbursed=db.prepare("SELECT COUNT(DISTINCT a.id) AS n FROM payroll_adjustments x JOIN salary_advances a ON a.id=x.advance_id WHERE x.tenant_id=? AND x.month=? AND x.status='approved' AND a.disbursed_on IS NULL").get(u.tenant_id,run.month).n;
  if(undisbursed)add('warn',`${undisbursed} سلفة تُسترد أقساطها هالشهر وصرفها ما انسجّل`,'يسجّل صرفها مراجع الرواتب من «حركات الرواتب والتسويات» بتاريخه ومرجعه البنكي، وبعدها يقوم قيدها في الدفتر.');
  const absences=db.prepare("SELECT COUNT(*) AS n FROM attendance_absences WHERE tenant_id=? AND status='proposed' AND work_date BETWEEN ? AND ?").get(u.tenant_id,from,to).n;
  if(absences)add('warn',`${absences} غياب مقترح في الشهر لم يُقرر`,'اعتماده بعد المسير يولّد أثرًا رجعيًا.');
  const corrections=db.prepare("SELECT COUNT(*) AS n FROM attendance_corrections WHERE tenant_id=? AND status='pending' AND work_date BETWEEN ? AND ?").get(u.tenant_id,from,to).n;
  if(corrections)add('info',`${corrections} طلب تصحيح حضور معلق في الشهر`,'');
  // ما اختار صاحبه الإجازة التعويضية لا يُحوَّل إلى المسير أبدًا (ترحيل 099)، فلا يُعد «لم يُحوَّل»: كان تنبيهًا دائمًا بلا فعل يرفعه.
  const overtime=db.prepare("SELECT COUNT(*) AS n,COALESCE(SUM(minutes),0) AS minutes FROM overtime_requests WHERE tenant_id=? AND status='approved' AND compensation='pay' AND adjustment_id IS NULL AND work_date BETWEEN ? AND ?").get(u.tenant_id,from,to);
  if(overtime.n)add('warn',`${overtime.n} طلب عمل إضافي معتمد (${(overtime.minutes/60).toFixed(1)} ساعة) لم يُحوَّل إلى المسير`,'يحوّله مُعد الرواتب من شاشة الحضور بمبلغ وأساس احتساب.');
  // الرصيد التعويضي المستحق الصرف يُعد بالاشتقاق نفسه الذي يقرؤه طابور مُعد الرواتب (lotsOf): ما انقضت مهلته فعلًا حتى اليوم أو انتهت خدمة صاحبه،
  // وفيه باقٍ غير محجوز. كان يُعد «انقضت مهلته» كل قيد تنقضي مهلته قبل آخر الشهر، فيوجّه المُعد إلى طابور لا يعرضه وإحالة تُرفض.
  const today=new Date(Date.now()+3*3600000).toISOString().slice(0,10),lots=tenantLots(db,u.tenant_id,today),due=lots.filter(l=>l.due).length;
  if(due)add('warn',`${due} رصيد إجازة تعويضية مستحق الصرف (انقضت مهلته أو انتهت خدمة صاحبه) ولم يُحل إلى المسير`,'يحيله مُعد الرواتب من شاشة الحضور ← «أرصدة تعويضية مستحقة الصرف»؛ لا يسقط بمضي المدة (اللائحة التنفيذية م22 مكرر).');
  const expiring=lots.filter(l=>!l.due&&l.remaining_minutes>0&&l.expires_on>=from&&l.expires_on<=to).length;
  if(expiring)add('info',`${expiring} رصيد إجازة تعويضية تنقضي مهلته خلال هذا الشهر`,'ما زال إجازةً ممكنة لصاحبه حتى مهلته، فلا يُحال الآن؛ ما يبقى منه بعدها يظهر في «أرصدة تعويضية مستحقة الصرف».');
  // حركة معتمدة لهذا الشهر لا سطر لصاحبها في المسير (لا عقد له يتقاطع مع الشهر، كمن انتهت خدمته قبله): لا يدفعها هذا المسير ولا غيره.
  const orphans=run.status==='draft'?db.prepare(`SELECT a.id,x.name FROM payroll_adjustments a JOIN users x ON x.id=a.user_id WHERE a.tenant_id=? AND a.month=? AND a.status='approved' AND a.run_id IS NULL AND a.user_id NOT IN (${marks}) ORDER BY x.name`).all(u.tenant_id,run.month,...ids):[];
  if(orphans.length)add('warn',`${orphans.length} حركة راتب معتمدة لهذا الشهر لا سطر لأصحابها في المسير`,`${names(orphans)}. المسير يحمل سطرًا لمن له عقد يتقاطع مع الشهر فقط؛ حركة من انتهت خدمته تُحال إلى مسير شهر انتهائها أو تُحمل على مخالصته.`);
  const noBank=ids.length?db.prepare(`SELECT x.name FROM users x WHERE x.id IN (${marks}) AND NOT EXISTS(SELECT 1 FROM employee_bank_accounts b WHERE b.user_id=x.id AND b.status='verified' AND b.effective_month<=?) ORDER BY x.name`).all(...ids,run.month):[];
  if(noBank.length)add('warn',`${noBank.length} موظف في المسير بلا حساب راتب متحقق منه`,`${names(noBank)}. لن يُعد ملف التحويل قبل التحقق.`);
  const changedBank=ids.length?db.prepare(`SELECT DISTINCT x.name FROM employee_bank_accounts b JOIN users x ON x.id=b.user_id WHERE b.user_id IN (${marks}) AND b.status='verified' AND b.effective_month=?`).all(...ids,run.month):[];
  if(changedBank.length)add('warn','حساب راتب يبدأ سريانه هذا الشهر',`${names(changedBank)}. تأكد من الموظف نفسه عبر قناة مستقلة قبل أول تحويل.`);
  const ending=ids.length?db.prepare(`SELECT x.name FROM employment_contracts c JOIN users x ON x.id=c.user_id WHERE c.user_id IN (${marks}) AND COALESCE(c.ended_on,c.end_date) BETWEEN ? AND ? ORDER BY x.name`).all(...ids,from,to):[];
  if(ending.length)add('info',`${ending.length} عقد ينتهي خلال الشهر`,`${names(ending)}. راجع نسبة الاستحقاق والتسوية النهائية.`);
  const expired=ids.length?db.prepare(`SELECT DISTINCT x.name FROM employee_documents d JOIN users x ON x.id=d.user_id WHERE d.user_id IN (${marks}) AND d.replaced_by IS NULL AND d.expires_on IS NOT NULL AND d.expires_on<=? ORDER BY x.name`).all(...ids,to):[];
  if(expired.length)add('warn',`${expired.length} موظف له وثيقة منتهية أو تنتهي قبل نهاية الشهر`,names(expired));
  let retro=[];try{retro=retroCandidates(db,u).candidates;}catch(error){if(!error.status)throw error;}
  if(retro.length)add('info',`${retro.length} فرق أثر رجعي قائم من مسيرات سابقة`,'يُقترح من شاشة حركات الرواتب.');
  // قواعد اللائحة (م48، م51، م67، م116): «block» يمنع إرسال المسير واعتماده في payroll.mjs.
  for(const c of ruleChecks(db,u.tenant_id,run))out.push(c);
  return out;
}
