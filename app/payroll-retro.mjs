import { randomUUID } from 'node:crypto';
import { audit, now } from './db.mjs';
import { fail } from './auth.mjs';
import * as v from './validation.mjs';
import { currentUser } from './delegations.mjs';
import { holds } from './access.mjs';
import { baseLines } from './payroll.mjs';
import { proposeAdjustment } from './payroll-extras.mjs';
// P4-HR-5: الشهر الموازي يدفعه النظام السابق (الترحيل 176). سطر واحد في كل مسار مال: app/payroll-parallel-guard.mjs.
import { isParallelMonth } from './payroll-parallel-guard.mjs';

// الأثر الرجعي: يقارن ما صُرف في كل مسير معتمد بما تستحقه العقود والغياب المعتمد كما هي اليوم.
// لا يعدل مسيرًا مقفلًا ولا يصرف شيئًا بنفسه؛ يقترح حركة في شهر لاحق يعتمدها حامل تصريح الاعتماد.
const CAPS=['payroll.prepare','payroll.review','payroll.approve'];
const LOOKBACK_RUNS=12;
function staff(db,supplied){const u=currentUser(db,supplied);if(!u)fail(403,'forbidden','الحساب غير متاح');u.caps=CAPS.filter(key=>holds(db,u,key));if(!u.caps.length)fail(403,'not_permitted','هذه الشاشة لحاملي تصريح الرواتب الصريح');return u;}
function monthRange(month){const [year,m]=month.split('-').map(Number),days=new Date(Date.UTC(year,m,0)).getUTCDate();return {from:`${month}-01`,to:`${month}-${String(days).padStart(2,'0')}`,days};}
// الأثر الرجعي يقارن ما صُرف بما تستحقه العقود والغياب. أما الاشتراك فيدخل المقارنة بشرط واحد: أن تكون القاعدة
// وحالة الموظف يوم اعتُمد الشهر هي القاعدة والحالة اللتين يُعاد الاحتساب بهما اليوم. فقبولُ قاعدة التأمينات بعد اعتماد
// شهر، أو سحبُ استثناء، كان يُظهر فرق اشتراك على أنه فرق أجر «بلا سبب» ويعرضه حركةً تُصرف — وهو ليس أجرًا ولا يُصرف
// بحركة راتب؛ تصحيح الاشتراكات قرار تسوية مستقل لم تبنِ المنصة له مسارًا.
const insuranceKey=line=>{const basis=line?(typeof line.basis==='string'?JSON.parse(line.basis):line.basis):null;
  const i=basis?.insurance;return i?`${i.method}:${i.policy_id??''}:${i.case??''}`:'';};
const base=(line,withInsurance)=>line?line.gross_minor-line.unpaid_absence_minor-(withInsurance?line.social_insurance_minor:0):0;
const decimal=minor=>`${Math.floor(minor/100)}.${String(minor%100).padStart(2,'0')}`;

export function retroCandidates(db,supplied){
  const u=staff(db,supplied),out=[];
  const runs=db.prepare("SELECT * FROM payroll_runs WHERE tenant_id=? AND status='approved' ORDER BY month DESC LIMIT ?").all(u.tenant_id,LOOKBACK_RUNS);
  for(const run of runs){
    if(isParallelMonth(db,u.tenant_id,run.month))continue;
    const params=JSON.parse(db.prepare('SELECT parameters FROM hr_policies WHERE id=?').get(run.cycle_policy_id).parameters),expected=baseLines(db,u.tenant_id,monthRange(run.month),params);
    const paid=new Map(db.prepare('SELECT * FROM payroll_lines WHERE run_id=?').all(run.id).map(l=>[l.user_id,l]));
    for(const userId of new Set([...expected.keys(),...paid.keys()])){
      const sameInsurance=insuranceKey(expected.get(userId))===insuranceKey(paid.get(userId));
      const due=base(expected.get(userId),sameInsurance),was=base(paid.get(userId),sameInsurance);
      // ما سبق اقتراحه لهذا الشهر يُطرح ما لم تُرفض حركته.
      const handled=db.prepare("SELECT COALESCE(SUM(r.difference_minor),0) AS n FROM payroll_retro r JOIN payroll_adjustments a ON a.id=r.adjustment_id WHERE r.user_id=? AND r.source_month=? AND a.status<>'rejected'").get(userId,run.month).n;
      const difference=due-was-handled;
      if(!difference)continue;
      const person=db.prepare('SELECT name,active FROM users WHERE id=?').get(userId);
      out.push({key:`${run.month}:${userId}`,user_id:userId,employee_name:person.name,active:!!person.active,source_month:run.month,source_run_id:run.id,paid_minor:was,due_minor:due,already_proposed_minor:handled,difference_minor:difference,
        insurance_compared:sameInsurance,
        reasons:[...(expected.get(userId)&&paid.get(userId)&&expected.get(userId).contract_id!==paid.get(userId).contract_id?['عقد مختلف عن المعتمد وقت المسير']:[]),...(expected.get(userId)?.unpaid_absence_minor!==paid.get(userId)?.unpaid_absence_minor?['تغير الغياب غير المدفوع المعتمد']:[]),...(!paid.get(userId)?['لم يكن في المسير']:[]),...(!expected.get(userId)?['لا عقد يغطي الشهر الآن']:[]),...(sameInsurance?[]:['تغيّرت قاعدة التأمينات أو حالة الموظف بعد اعتماد الشهر، فاشتراكه خارج هذه المقارنة ويُسوّى بقرار مستقل'])],
        can_propose:u.caps.includes('payroll.prepare')&&userId!==u.id&&!!person.active});
    }
  }
  return {candidates:out,history:db.prepare('SELECT r.*,a.status AS adjustment_status,a.month AS target_month,x.name AS employee_name FROM payroll_retro r JOIN payroll_adjustments a ON a.id=r.adjustment_id JOIN users x ON x.id=r.user_id WHERE r.tenant_id=? ORDER BY r.created_at DESC LIMIT 100').all(u.tenant_id).map(r=>({...r,basis:JSON.parse(r.basis)})),
    rule:`يُقارن آخر ${LOOKBACK_RUNS} مسيرًا معتمدًا. الفرق الموجب يُقترح بدلًا لمرة واحدة والسالب خصمًا، وكلاهما يحتاج اعتماد شخص آخر قبل دخول المسير.`};
}

export function proposeRetro(db,supplied,input){
  if(!db.isTransaction)fail(500,'transaction_required','تتطلب الكتابة معاملة قاعدة بيانات');
  const u=staff(db,supplied);
  if(!u.caps.includes('payroll.prepare'))fail(403,'not_permitted','اقتراح الأثر الرجعي لمُعد الرواتب');
  v.object(input,['user_id','source_month','target_month','expected_difference','note']);
  const candidate=retroCandidates(db,u).candidates.find(c=>c.user_id===input.user_id&&c.source_month===input.source_month);
  if(!candidate)fail(409,'no_difference','لا فرق قائم لهذا الموظف في هذا الشهر');
  // المبلغ يُحتسب في الخادم؛ ما يرسله المستخدم تأكيد لما رآه فقط، فإن تغير الفرق يُعاد التحميل.
  if(input.expected_difference!==candidate.difference_minor)fail(409,'stale_difference','تغير الفرق منذ فتح الشاشة. أعد التحميل');
  if(typeof input.target_month!=='string'||input.target_month<=candidate.source_month)fail(400,'target_month','شهر الصرف بعد شهر المصدر');
  const positive=candidate.difference_minor>0;
  // م51 (ص 19): استرداد ما صُرف بالزيادة ليس من الحالات الست المستثناة (ليس قرضًا ولا حكمًا قضائيًا)، فيُقترح خصمًا بموافقة العامل الخطية يقرّها بهويته
  // قبل الاعتماد. قراءة مباشرة للنص، والمالك يستطيع أن يقرر غيرها (سؤال مفتوح في وثيقة التسليم).
  const adjustment=proposeAdjustment(db,u,{user_id:candidate.user_id,kind:positive?'allowance':'deduction',month:input.target_month,amount:decimal(Math.abs(candidate.difference_minor)),
    reason:`أثر رجعي لشهر ${candidate.source_month}: المستحق ${decimal(candidate.due_minor)} والمصروف ${decimal(candidate.paid_minor)}. ${v.text(input.note,'سبب الفرق وسنده',1000,10)}`},
    positive?{}:{basis:{kind:'consent',reference:`استرداد مصروف بالزيادة عن شهر ${candidate.source_month}؛ ليس من حالات م51 الست فيلزمه إقرار العامل`}});
  const retroId=randomUUID();
  db.prepare('INSERT INTO payroll_retro VALUES(?,?,?,?,?,?,?,?,?,?)').run(retroId,u.tenant_id,candidate.user_id,candidate.source_month,candidate.source_run_id,candidate.difference_minor,adjustment.id,JSON.stringify({paid_minor:candidate.paid_minor,due_minor:candidate.due_minor,already_proposed_minor:candidate.already_proposed_minor,reasons:candidate.reasons}),u.id,now());
  audit(db,u,'payroll_retro',retroId,'retro.proposed',{}, {user_id:candidate.user_id,source_month:candidate.source_month,difference_minor:candidate.difference_minor});
  return {id:retroId,adjustment_id:adjustment.id,difference_minor:candidate.difference_minor};
}
