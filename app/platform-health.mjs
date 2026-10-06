import { require as requireAccess } from './access.mjs';
import { integrationReadiness } from './integration-readiness.mjs';

const STATES=new Set(['healthy','warning','failed','unknown']);
const HOUR=3600000;

const number=value=>Number(value??0);
const iso=value=>{
  if(!value)return null;
  const date=new Date(value);
  return Number.isNaN(date.valueOf())?null:date.toISOString();
};
const check=(state,checkedAt,evidence,note)=>({
  state:STATES.has(state)?state:'unknown',
  checked_at:iso(checkedAt),
  evidence:evidence&&typeof evidence==='object'&&!Array.isArray(evidence)?evidence:{},
  note:String(note??'')
});

function independent(value,{now,maxAgeHours=24,healthyNote='الفحص حديث ومثبت',unknownNote='لا يوجد فحص مستقل حديث'}={}){
  if(!value||typeof value!=='object')return check('unknown',null,{},unknownNote);
  const checkedAt=iso(value.checked_at??value.at);
  const evidence=value.evidence&&typeof value.evidence==='object'&&!Array.isArray(value.evidence)?value.evidence:
    Object.fromEntries(['age_hours','expected','actual','count'].filter(key=>value[key]!==undefined).map(key=>[key,value[key]]));
  if(value.ok===false||value.state==='failed')return check('failed',checkedAt,evidence,value.note??'سجّل الفحص فشلًا يحتاج معالجة');
  if(!checkedAt)return check('unknown',null,evidence,value.note??unknownNote);
  const age=(new Date(now).valueOf()-new Date(checkedAt).valueOf())/HOUR;
  if(!Number.isFinite(age)||age<0||age>maxAgeHours)return check('warning',checkedAt,{...evidence,age_hours:Number.isFinite(age)?Math.round(age*10)/10:null},value.note??'الفحص موجود لكنه أقدم من حد الاعتماد');
  if(value.ok!==true&&value.state!=='healthy')return check('unknown',checkedAt,evidence,value.note??unknownNote);
  return check('healthy',checkedAt,evidence,value.note??healthyNote);
}

function buildCheck(build,now){
  if(!build||typeof build!=='object')return check('unknown',null,{},'لم تصل بصمة الإصدار إلى عملية الخادم');
  const evidence={
    commit:/^[0-9a-f]{40}$/.test(String(build.commit??''))?build.commit:null,
    source_digest:/^[0-9a-f]{64}$/.test(String(build.source_digest??''))?build.source_digest:null,
    files:Number.isInteger(build.files)&&build.files>=0?build.files:null
  };
  const complete=evidence.source_digest!==null&&evidence.files!==null;
  const computed=iso(build.computed_at);
  if(!complete||!computed)return check('unknown',computed,evidence,'بصمة الإصدار غير مكتملة');
  const age=(new Date(now).valueOf()-new Date(computed).valueOf())/HOUR;
  return check(age>=0&&age<=24?'healthy':'warning',computed,evidence,age>=0&&age<=24?'بصمة الكود حُسبت عند إقلاع العملية':'بصمة الكود أقدم من حد الاعتماد التشغيلي');
}

export function platformHealth(db,user,{build=null,checks={},now=new Date().toISOString()}={}){
  requireAccess(db,user,'platform.flags');
  const generated=iso(now)??new Date().toISOString(),today=generated.slice(0,10),tenant=user.tenant_id;

  const migration=db.prepare('SELECT MAX(version) AS latest,COUNT(*) AS applied FROM schema_migrations').get();
  const queue=db.prepare(`SELECT COUNT(*) AS total,
    SUM(CASE WHEN status='queued' THEN 1 ELSE 0 END) AS queued,
    SUM(CASE WHEN status='running' THEN 1 ELSE 0 END) AS running,
    SUM(CASE WHEN status='dead' THEN 1 ELSE 0 END) AS dead,
    SUM(CASE WHEN status IN ('queued','running') AND due_at<? THEN 1 ELSE 0 END) AS overdue
    FROM jobs WHERE tenant_id=?`).get(generated,tenant);
  const flags=db.prepare(`SELECT COUNT(*) AS total,
    SUM(CASE WHEN status='live' AND enabled=1 AND expires_on>=? THEN 1 ELSE 0 END) AS enabled,
    SUM(CASE WHEN status='live' AND enabled=1 AND expires_on<? THEN 1 ELSE 0 END) AS expired_enabled
    FROM feature_flags WHERE tenant_id=?`).get(today,today,tenant);
  const ai=db.prepare(`SELECT COUNT(*) AS total,
    SUM(CASE WHEN status='active' THEN 1 ELSE 0 END) AS active,
    SUM(CASE WHEN status='proposed' THEN 1 ELSE 0 END) AS proposed,
    SUM(CASE WHEN status='active' AND next_review_on<? THEN 1 ELSE 0 END) AS overdue_reviews
    FROM ai_assets WHERE tenant_id=?`).get(today,tenant);
  const reviews=db.prepare(`SELECT COUNT(*) AS total,
    SUM(CASE WHEN status='open' THEN 1 ELSE 0 END) AS open,
    SUM(CASE WHEN status='open' AND due_on<? THEN 1 ELSE 0 END) AS overdue,
    MAX(COALESCE(closed_at,opened_at)) AS last_activity
    FROM access_review_campaigns WHERE tenant_id=?`).get(today,tenant);
  const readiness=integrationReadiness(db,user);
  const connectionCounts=readiness.connections.reduce((out,row)=>(out[row.status]=(out[row.status]??0)+1,out),{});
  const metrics=db.prepare(`SELECT
    (SELECT COUNT(*) FROM executive_metric_definitions WHERE tenant_id=?) AS definitions,
    (SELECT COUNT(*) FROM executive_metric_observations WHERE tenant_id=?) AS observations,
    (SELECT COUNT(*) FROM executive_metric_definitions d WHERE d.tenant_id=? AND NOT EXISTS(
      SELECT 1 FROM executive_metric_observations o WHERE o.tenant_id=d.tenant_id AND o.metric_key=d.key AND o.definition_version=d.version
    )) AS without_observation`).get(tenant,tenant,tenant);

  const queueEvidence={total:number(queue.total),queued:number(queue.queued),running:number(queue.running),dead:number(queue.dead),overdue:number(queue.overdue)};
  const flagEvidence={total:number(flags.total),enabled:number(flags.enabled),expired_enabled:number(flags.expired_enabled)};
  const aiEvidence={total:number(ai.total),active:number(ai.active),proposed:number(ai.proposed),overdue_reviews:number(ai.overdue_reviews)};
  const reviewEvidence={total:number(reviews.total),open:number(reviews.open),overdue:number(reviews.overdue)};
  const integrationEvidence={active:number(connectionCounts.active),blocked:number(connectionCounts.blocked),simulated:number(connectionCounts.simulated),sandbox_ready:number(connectionCounts['sandbox-ready'])};
  const metricEvidence={definitions:number(metrics.definitions),observations:number(metrics.observations),without_observation:number(metrics.without_observation)};

  return {
    generated_at:generated,
    build:buildCheck(build,generated),
    database:{
      migration:check(migration.latest?'healthy':'failed',generated,{latest:number(migration.latest),applied:number(migration.applied)},migration.latest?'قاعدة البيانات عند آخر ترحيل مطبق في هذه العملية':'لا توجد ترحيلات مطبقة'),
      schema:independent(checks.schema,{now:generated,healthyNote:'بصمة المخطط مطابقة للفحص المستقل'}),
      backup:independent(checks.backup,{now:generated,maxAgeHours:24,healthyNote:'دليل النسخ الاحتياطي حديث'})
    },
    jobs:{
      queue:check(queueEvidence.dead?'failed':queueEvidence.overdue?'warning':'healthy',generated,queueEvidence,queueEvidence.dead?'توجد مهام وصلت إلى نهاية محاولاتها':queueEvidence.overdue?'توجد مهام تشغيلية متأخرة':'لا توجد مهام ميتة أو متأخرة'),
      feature_flags:check(flagEvidence.expired_enabled?'warning':'healthy',generated,flagEvidence,flagEvidence.expired_enabled?'توجد أعلام مفعلة بعد تاريخ انتهائها':'أعلام الميزات ضمن مددها')
    },
    security:{
      audit_chain:independent(checks.audit,{now:generated,maxAgeHours:24,healthyNote:'سلسلة التدقيق اجتازت فحصًا حديثًا'}),
      ai_inventory:check(aiEvidence.overdue_reviews?'failed':aiEvidence.proposed?'warning':aiEvidence.total?'healthy':'warning',generated,aiEvidence,
        aiEvidence.overdue_reviews?'توجد مراجعات ذكاء اصطناعي متأخرة':aiEvidence.proposed?'توجد أصول بانتظار التقييم':aiEvidence.total?'الجرد قائم ولا توجد مراجعة متأخرة':'جرد مساعدي الذكاء الاصطناعي لم يبدأ')
    },
    access_reviews:{
      campaign:check(reviewEvidence.overdue?'failed':reviewEvidence.open?'healthy':'warning',generated,reviewEvidence,
        reviewEvidence.overdue?'حملة مراجعة صلاحيات تجاوزت موعدها':reviewEvidence.open?'توجد حملة مراجعة صلاحيات مفتوحة':'لا توجد حملة مراجعة صلاحيات مفتوحة')
    },
    integrations:{
      connections:check(integrationEvidence.blocked||integrationEvidence.simulated||integrationEvidence.sandbox_ready?'warning':'healthy',generated,integrationEvidence,
        integrationEvidence.active===readiness.connections.length?'كل التكاملات مثبتة باتصال فعلي':'بعض التكاملات محاكاة أو موقوفة أو بانتظار إثبات مستقل')
    },
    data_quality:{
      executive_metrics:check(metricEvidence.without_observation?'warning':'healthy',generated,metricEvidence,
        metricEvidence.without_observation?'توجد تعريفات مؤشرات بلا رصد مؤرخ':'لكل تعريف مؤشر رصد مؤرخ')
    }
  };
}
