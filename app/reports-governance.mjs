import { can } from './access.mjs';
import { INITIATIVE_STATUS } from './governance.mjs';

// تقارير سجلات الحوكمة الثلاثة. تقرأ ما أدخله أصحابه ولا تشتق منه ما لم يُدخل:
// لا نسبة إنجاز من عدد المهام، ولا درجة خطر خارج المقياس الذي عرّفه صاحب الإجراء، ولا أثر قرار تقيسه المنصة.
const sar=minor=>minor===null||minor===undefined?null:Math.round(Number(minor))/100;
const exec=(db,u)=>can(db,u,'executive.view');
const objectivesView=(db,u)=>exec(db,u)||can(db,u,'governance.objectives.manage');
const risksView=(db,u)=>exec(db,u)||can(db,u,'governance.risks.manage');
const decisionsView=(db,u)=>exec(db,u)||can(db,u,'governance.decisions.record');
// الدرجة = الاحتمال × الأثر بقيم المقياس المعرَّف، والنطاق اسم يعطيه صاحب الإجراء لمدى من الدرجات.
const bandsOf=(db,tenantId)=>db.prepare('SELECT label,min_score,max_score FROM governance_risk_bands WHERE tenant_id=? ORDER BY min_score').all(tenantId);
const bandFor=(bands,score)=>bands.find(b=>score>=b.min_score&&score<=b.max_score)?.label??'';

export const GOVERNANCE_REPORTS=[
  {key:'R02',group:'الإدارة العليا',title:'الأهداف والمبادرات',
    definition:'أهداف الإدارات التي تتقاطع فترتها مع الفترة المطلوبة، ومبادراتها بحالتها ومالكها وموعدها وميزانيتها، ولكل مؤشر خط أساسه ومستهدفه وآخر قياس مسجَّل بتاريخه ومصدره.',
    source:'governance_objectives + governance_initiatives + governance_indicators + governance_measurements',
    allowed:objectivesView,
    run(db,u,{from,to}){
      const rows=[];
      const objectives=db.prepare('SELECT o.*,d.name AS department FROM governance_objectives o JOIN departments d ON d.id=o.department_id AND d.tenant_id=o.tenant_id WHERE o.tenant_id=? AND o.period_from<=? AND o.period_to>=? ORDER BY d.name,o.period_from,o.title').all(u.tenant_id,to,from);
      for(const objective of objectives){
        const owner=db.prepare('SELECT name FROM users WHERE id=?').get(objective.owner_id)?.name??'';
        const initiatives=db.prepare('SELECT * FROM governance_initiatives WHERE objective_id=? ORDER BY due_date,title').all(objective.id);
        if(!initiatives.length){
          rows.push({department:objective.department,objective:objective.title,objective_owner:owner,initiative:'—',status:'لا مبادرة مسجلة',owner:'',due_date:'',budget:null,
            indicator:'—',unit:'',baseline:null,target:null,latest:null,measured_on:'',measurement_source:''});
          continue;
        }
        for(const initiative of initiatives){
          const base={department:objective.department,objective:objective.title,objective_owner:owner,initiative:initiative.title,status:INITIATIVE_STATUS[initiative.status],
            owner:db.prepare('SELECT name FROM users WHERE id=?').get(initiative.owner_id)?.name??'',due_date:initiative.due_date,budget:sar(initiative.budget_minor)};
          const indicators=db.prepare('SELECT * FROM governance_indicators WHERE initiative_id=? ORDER BY title').all(initiative.id);
          if(!indicators.length){rows.push({...base,indicator:'—',unit:'',baseline:null,target:null,latest:null,measured_on:'',measurement_source:''});continue;}
          for(const indicator of indicators){
            // القياس المعتمد هو الحي (غير المصحَّح) الأحدث حتى نهاية الفترة، لا آخر رقم كُتب في السجل.
            const latest=db.prepare('SELECT m.*,x.name AS who FROM governance_measurements m JOIN users x ON x.id=m.recorded_by WHERE m.indicator_id=? AND m.measured_on<=? AND NOT EXISTS(SELECT 1 FROM governance_measurements c WHERE c.corrects_id=m.id) ORDER BY m.measured_on DESC,m.recorded_at DESC LIMIT 1').get(indicator.id,to);
            rows.push({...base,indicator:indicator.title,unit:indicator.unit,baseline:indicator.baseline_value,target:indicator.target_value,
              latest:latest?latest.value:null,measured_on:latest?latest.measured_on:'',
              measurement_source:latest?`${latest.source} — ${latest.who}`:`المصدر المعلن: ${indicator.measurement_source} (لم يُسجل قياس بعد)`});
          }
        }
      }
      return {columns:[['department','الإدارة','text'],['objective','الهدف','text'],['objective_owner','مالك الهدف','text'],['initiative','المبادرة','text'],['status','حالة المبادرة','text'],['owner','مالك المبادرة','text'],['due_date','الموعد','text'],['budget','الميزانية (ريال)','money'],['indicator','المؤشر','text'],['unit','وحدة القياس','text'],['baseline','خط الأساس','number'],['target','المستهدف','number'],['latest','آخر قياس','number'],['measured_on','تاريخ القياس','text'],['measurement_source','مصدر القياس ومن أدخله','text']],
        rows,
        notes:['لا نسبة إنجاز في هذا التقرير. المنصة لا تشتق نسبة من عدد المهام؛ ما تراه هو القياس الفعلي مقابل المستهدف.',
          'خانة «آخر قياس» فارغة تعني أن أحدًا لم يسجل قياسًا حتى نهاية الفترة، ولا تعني صفرًا.',
          'القياس المسجَّل لا يُعدَّل؛ ما يظهر هنا هو القياس الحي بعد استبعاد ما صُحح بقياس لاحق.',
          'الميزانية رقم مخطط أدخله صاحب المبادرة، وليست إنفاقًا فعليًا ولا مطابقة مع الدفتر المالي.']};
    }},

  {key:'R03',group:'الإدارة العليا',title:'محفظة المشاريع والمخاطر',
    definition:'كل مشروع ومبادرة قائمة في المحفظة، وما عليه من مهام مفتوحة ومتأخرة، وما رُبط به من مخاطر مفتوحة وأعلى درجة فيها وما تجاوز تاريخ مراجعته.',
    source:'projects + tasks + governance_initiatives + governance_risks + governance_risk_bands',
    allowed:(db,u)=>risksView(db,u)||objectivesView(db,u),
    run(db,u,{to}){
      const bands=bandsOf(db,u.tenant_id),rows=[];
      const openRisks=db.prepare("SELECT * FROM governance_risks WHERE tenant_id=? AND status='open'").all(u.tenant_id);
      const linked=(type,recordId)=>openRisks.filter(r=>r.link_type===type&&r.link_id===recordId);
      const summarise=list=>{
        const scores=list.map(r=>r.likelihood_value*r.impact_value),top=scores.length?Math.max(...scores):null;
        return {risks_open:list.length,top_score:top,top_band:top===null?'':bandFor(bands,top),
          review_overdue:list.filter(r=>r.next_review_on<to).length,
          accepted:list.filter(r=>r.response==='accept').length,awaiting_acceptance:list.filter(r=>r.response==='accept_proposed').length};
      };
      for(const project of db.prepare('SELECT * FROM projects WHERE tenant_id=? ORDER BY name').all(u.tenant_id)){
        const tasks=db.prepare("SELECT COUNT(*) AS total,SUM(status<>'completed') AS open,SUM(status<>'completed' AND due_date<?) AS late FROM tasks WHERE project_id=?").get(to,project.id);
        rows.push({kind:'مشروع',name:project.name,owner:db.prepare('SELECT name FROM users WHERE id=?').get(project.created_by)?.name??'',state:'',due_date:'',
          tasks_open:tasks.open??0,tasks_late:tasks.late??0,...summarise(linked('project',project.id))});
      }
      for(const initiative of db.prepare("SELECT i.*,o.title AS objective FROM governance_initiatives i JOIN governance_objectives o ON o.id=i.objective_id WHERE i.tenant_id=? AND i.status NOT IN ('cancelled') ORDER BY i.due_date").all(u.tenant_id)){
        rows.push({kind:'مبادرة',name:`${initiative.title} (${initiative.objective})`,owner:db.prepare('SELECT name FROM users WHERE id=?').get(initiative.owner_id)?.name??'',
          state:INITIATIVE_STATUS[initiative.status],due_date:initiative.due_date,tasks_open:null,tasks_late:null,...summarise(linked('initiative',initiative.id))});
      }
      const unlinked=openRisks.filter(r=>!r.link_id),obligationRisks=openRisks.filter(r=>r.link_type==='obligation');
      return {columns:[['kind','النوع','text'],['name','الاسم','text'],['owner','المالك','text'],['state','الحالة','text'],['due_date','الموعد','text'],['tasks_open','مهام مفتوحة','number'],['tasks_late','مهام فات موعدها','number'],['risks_open','مخاطر مفتوحة مرتبطة','number'],['top_score','أعلى درجة خطر','number'],['top_band','نطاقها','text'],['review_overdue','مخاطر تجاوزت مراجعتها','number'],['accepted','مقبولة باعتماد','number'],['awaiting_acceptance','قبول بانتظار اعتماد','number']],
        rows,
        totals:{risks_open:openRisks.length,review_overdue:openRisks.filter(r=>r.next_review_on<to).length},
        notes:[`مخاطر مفتوحة غير مرتبطة بمشروع ولا مبادرة: ${unlinked.length}${obligationRisks.length?`، ومنها ${obligationRisks.length} مرتبط بالتزام نظامي فلا يظهر في صفوف هذا الجدول`:''}. لا تظهر في صفوف الجدول ولا تعني أنها أقل أهمية.`,
          bands.length?'النطاق اسم يعطيه صاحب الإجراء لمدى من الدرجات؛ لا تعني درجة عالية هنا شيئًا خارج المقياس الذي عرّفه.':'لم تُعرَّف نطاقات الدرجة بعد، فالعمود «نطاقها» فارغ. الدرجة عدد لا معنى له وحده.',
          'المشاريع بلا مراحل ولا خط أساس زمني في المنصة: عمودا «الحالة» و«الموعد» فارغان للمشاريع لأن المنصة لا تحفظ لها موعدًا ولا حالة صحة. المهام وحدها ما يُقاس.',
          'المهام المتأخرة والمخاطر التي تجاوزت مراجعتها محسوبة حتى نهاية الفترة المختارة لا حتى اليوم؛ اختر فترة تنتهي اليوم إن أردت الصورة اللحظية.']};
    }},

  {key:'R05',group:'الإدارة العليا',title:'قرارات الإدارة وتتبّع أثرها',
    definition:'القرارات المسجَّلة في الفترة بمن اتخذها ومرجعها والأثر الذي كتبه متخذها، وهل عُدل عنها بقرار لاحق، وما نشأ عنها من التزامات وحالتها.',
    source:'governance_decisions + governance_commitments + governance_minutes',
    allowed:decisionsView,
    run(db,u,{from,to}){
      const decisions=db.prepare('SELECT d.*,x.name AS decided_by_name FROM governance_decisions d JOIN users x ON x.id=d.decided_by WHERE d.tenant_id=? AND d.decided_on BETWEEN ? AND ? ORDER BY d.decided_on DESC,d.recorded_at DESC').all(u.tenant_id,from,to);
      const rows=decisions.map(d=>{
        const commitments=db.prepare('SELECT status,due_date FROM governance_commitments WHERE decision_id=?').all(d.id);
        const reversal=db.prepare('SELECT title,decided_on FROM governance_decisions WHERE reverses_id=? ORDER BY decided_on LIMIT 1').get(d.id);
        const minute=d.minute_id?db.prepare('SELECT title,status FROM governance_minutes WHERE id=?').get(d.minute_id):null;
        return {decided_on:d.decided_on,title:d.title,decided_by:d.decided_by_name,impact:d.impact,
          reference:[d.reference,minute?`محضر: ${minute.title}${minute.status==='approved'?' (معتمد)':' (مسودة)'}`:''].filter(Boolean).join(' · '),
          reversed:reversal?`نعم — ${reversal.title} بتاريخ ${reversal.decided_on}`:'لا',
          commitments:commitments.length,done:commitments.filter(c=>c.status==='done').length,
          open:commitments.filter(c=>c.status==='open').length,late:commitments.filter(c=>c.status==='open'&&c.due_date<to).length,
          cancelled:commitments.filter(c=>c.status==='cancelled').length};
      });
      const orphan=db.prepare("SELECT COUNT(*) AS n FROM governance_commitments WHERE tenant_id=? AND decision_id IS NULL AND status='open'").get(u.tenant_id).n;
      return {columns:[['decided_on','تاريخ القرار','text'],['title','القرار','text'],['decided_by','من اتخذه','text'],['impact','الأثر كما كتبه متخذه','text'],['reference','المرجع','text'],['reversed','عُدل عنه','text'],['commitments','التزامات ناشئة','number'],['done','منجزة بدليل','number'],['open','مفتوحة','number'],['late','فات موعدها','number'],['cancelled','ملغاة','number']],
        rows,
        totals:{commitments:rows.reduce((n,r)=>n+r.commitments,0),late:rows.reduce((n,r)=>n+r.late,0)},
        notes:['القرار المسجَّل لا يُعدَّل؛ العدول عنه قرار جديد يشير إليه ويبقى الأصل ظاهرًا في سجله.',
          '«الأثر» نصٌّ كتبه متخذ القرار وقت اتخاذه. المنصة لا تقيس الأثر المتحقق ولا تربطه بأي رقم تلقائيًا؛ تتبّع الأثر هنا هو تتبّع الالتزامات الناشئة فقط.',
          `التزامات مفتوحة ناشئة عن محاضر دون قرار مسجَّل: ${orphan}. لا تظهر في صفوف هذا الجدول.`,
          '«فات موعدها» محسوب حتى نهاية الفترة المختارة لا حتى اليوم.',
          'السياق والبدائل التي نُظر فيها محفوظة في سجل القرارات ولا تُصدَّر هنا اختصارًا؛ تُقرأ في شاشة السجل.']};
    }}
];
