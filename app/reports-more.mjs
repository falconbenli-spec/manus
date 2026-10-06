import { now } from './db.mjs';
import { can, holds } from './access.mjs';
import { financeCapabilities } from './finance.mjs';
import { statements } from './ledger.mjs';
import { budgetUsage } from './budgets.mjs';
import { closeChecks } from './close-checklist.mjs';
import { memberClients } from './agency.mjs';
import { clockFor, holidaySet } from './work-calendar.mjs';
import { CHANNELS } from './campaigns.mjs';
import { liveSpend, spendTotals, planInForce } from './media-spend-ledger.mjs';

// بقية مكتبة التقارير. كل تقرير يقرأ سجلات المنصة لحظة الطلب ويصرّح بما لا يغطيه.
// ما يعتمد على مصدر غير موجود في المنصة (منصات الإعلان، سجل أهداف، سجل مخاطر) لا يُبنى هنا بأرقام مفترضة.
const riyadhDate=iso=>new Date(Date.parse(iso)+3*3600000).toISOString().slice(0,10);
const days=(from,to)=>Math.round((Date.parse(to)-Date.parse(from))/86400000);
const sar=minor=>Math.round(Number(minor))/100;
const round1=n=>n===null||n===undefined?null:Math.round(n*10)/10;
const finance=(db,u)=>financeCapabilities(db,u).includes('read');
const exec=(db,u)=>can(db,u,'executive.view');
const execOrManager=(db,u)=>exec(db,u)||u.role==='manager';
const hrView=(db,u)=>can(db,u,'employees.view')||holds(db,u,'hr.performance.manage');
// تقارير المشتريات على مستوى الشركة لحاملي تصاريح الموردين فقط؛ حق طلب الشراء وحده لا يكشف ترسيات الآخرين.
const procurementView=(db,u)=>['vendors.view','vendors.manage','vendors.assess'].some(k=>can(db,u,k));
function accounts(db,u){try{return memberClients(db,u);}catch(error){if(error.status===403)return [];throw error;}}
const accountTeam=(db,u)=>accounts(db,u).length>0;
const clientName=c=>c.trade_name||c.legal_name;
const marks=list=>list.map(()=>'?').join(',');
const OPEN_REQUEST="('pending','approved','in_progress','returned')";

export const MORE_REPORTS=[
  {key:'R01',group:'الإدارة العليا',title:'نبض الشركة التنفيذي',definition:'لقطة واحدة لأهم أعداد التشغيل اليوم: الطلبات والمهام والحملات والمشتريات والموظفون، والمؤشرات المالية لمن يحمل تفويضًا ماليًا.',source:'requests + tasks + campaigns + content_items + scope_events + procurement_purchases + users + ar_claim_collection + payable_balances',allowed:exec,
    run(db,u,{from,to}){
      const n=(sql,...args)=>db.prepare(sql).get(u.tenant_id,...args).n,rows=[];
      const add=(area,metric,value,note='')=>rows.push({area,metric,value,note});
      add('الخدمات','طلبات مفتوحة الآن',n(`SELECT COUNT(*) AS n FROM requests WHERE tenant_id=? AND status IN ${OPEN_REQUEST}`));
      add('الخدمات','طلبات اكتملت في الفترة',n("SELECT COUNT(*) AS n FROM requests WHERE tenant_id=? AND status='completed' AND date(updated_at,'+3 hours') BETWEEN ? AND ?",from,to));
      add('المشاريع','مهام فات موعدها',n("SELECT COUNT(*) AS n FROM tasks t JOIN projects p ON p.id=t.project_id WHERE p.tenant_id=? AND t.status<>'completed' AND t.due_date<?",to));
      add('الحملات','حملات نشطة',n("SELECT COUNT(*) AS n FROM campaigns WHERE tenant_id=? AND status='live'"));
      add('الحملات','بنود محتوى فات موعدها',n("SELECT COUNT(*) AS n FROM content_items WHERE tenant_id=? AND status NOT IN ('published','cancelled') AND planned_date<?",to));
      add('الحسابات','طلبات خارج النطاق بلا قرار',n('SELECT COUNT(*) AS n FROM scope_events e JOIN scope_baselines b ON b.id=e.baseline_id WHERE b.tenant_id=? AND e.over_scope=1 AND e.disposition IS NULL'));
      add('المشتريات','طلبات شراء قيد التنفيذ',n("SELECT COUNT(*) AS n FROM procurement_purchases WHERE tenant_id=? AND status IN ('sourcing','awarded','ordered','part_received')"));
      add('المشتريات','شراء طارئ تأخرت مراجعته',n("SELECT COUNT(*) AS n FROM procurement_emergencies WHERE tenant_id=? AND status='approved' AND reviewed_by IS NULL AND review_due<?",to));
      add('الموظفون','موظفون نشطون',n("SELECT COUNT(*) AS n FROM users WHERE tenant_id=? AND active=1 AND role<>'admin'"));
      add('الموظفون','تقييمات أداء لم تكتمل',n("SELECT COUNT(*) AS n FROM performance_reviews WHERE tenant_id=? AND status IN ('self','manager','submitted')"));
      if(finance(db,u)){
        // الرصيدان من الرؤيتين اللتين تفرضهما قيود القاعدة: ar_claim_collection (الصافي بعد الإشعارات الدائنة ناقص المؤكد غير
        // المرتد والمخصص) وpayable_balances (المطابق والتسويات ناقص المحوَّل غير الراجع). كان النبض يطرح كل قبض مؤكد من القيمة
        // الأصلية، ويعدّ المستحق «مدفوعًا» إن كان عليه أمر منفّذ واحد ولو دُفع ربعه أو رجع التحويل.
        const receivable=db.prepare("SELECT COALESCE(SUM(MAX(s.net_minor-s.received_minor-s.allocated_minor,0)),0) AS n FROM ar_claims c JOIN ar_claim_collection s ON s.claim_id=c.id WHERE c.tenant_id=? AND c.status='approved'").get(u.tenant_id).n;
        add('المالية','رصيد ذمم العملاء (ريال)',sar(receivable),'الاستحقاقات المعتمدة بعد الإشعارات الدائنة ناقص المحصَّل (القبض اللي ما ارتد والمخصص من القبض على الحساب)');
        add('المالية','مستحقات موردين مطابقة غير مدفوعة (ريال)',sar(db.prepare('SELECT COALESCE(SUM(MAX(b.outstanding_minor,0)),0) AS n FROM payable_balances b WHERE b.tenant_id=?').get(u.tenant_id).n),'المطابق بعد التسويات ناقص المحوَّل اللي ما رجع');
      }
      return {columns:[['area','المجال','text'],['metric','المؤشر','text'],['value','القيمة','number'],['note','ملاحظة','text']],rows,notes:[finance(db,u)?'المؤشرات المالية من مستندات المنصة، لا من كشف بنكي.':'المؤشرات المالية مخفية: تظهر لمن يحمل تفويضًا ماليًا.','أعداد «الآن» لحظية ولا تتأثر بالفترة.']};
    }},
  {key:'R04',group:'الإدارة العليا',title:'الربحية والمركز المالي',definition:'إيرادات ومصروفات الفترة وصافيها من القيود المرحّلة، وأرصدة الأصول والالتزامات في نهايتها.',source:'finance_journals + finance_lines (المرحّل فقط)',allowed:finance,
    run(db,u,{from,to}){
      const s=statements(db,u,{from,to}),rows=[];
      const push=(section,list)=>list.forEach(a=>rows.push({section,code:a.code,name:a.name,amount:sar(a.amount_minor)}));
      push('إيرادات',s.income_statement.income);push('مصروفات',s.income_statement.expenses);rows.push({section:'صافي الفترة',code:'',name:'الإيرادات ناقص المصروفات',amount:sar(s.income_statement.net_minor)});
      push('أصول',s.balance_sheet.assets);push('التزامات',s.balance_sheet.liabilities);push('حقوق ملكية',s.balance_sheet.equity);
      return {columns:[['section','القسم','text'],['code','الحساب','text'],['name','الاسم','text'],['amount','المبلغ (ريال)','money']],rows,totals:{amount:sar(s.income_statement.net_minor)},
        notes:[s.balance_sheet.balanced?'المركز المالي متوازن.':'تنبيه: المركز المالي غير متوازن؛ راجع القيود.',`مستندات صدرت ولم يُرحَّل قيدها: ${s.unposted}. لا تظهر في هذه الأرقام.`,'لا توقعات ولا تدفقات نقدية متوقعة: تحتاج خطة تحصيل وصرف غير مبنية.']};
    }},
  {key:'R06',group:'الإدارات والخدمات',title:'أداء الإدارات في خدمة الطلبات',definition:'الطلبات التي تعالجها كل إدارة في الفترة: الوارد والمكتمل والمفتوح ومتوسط أيام الإنجاز.',source:'requests.handling_department_id',allowed:execOrManager,
    run(db,u,{from,to}){
      const scoped=!exec(db,u);
      const rows=db.prepare(`SELECT d.name AS department,COUNT(*) AS received,SUM(r.status='completed') AS completed,SUM(r.status IN ${OPEN_REQUEST}) AS open,SUM(r.status='returned') AS returned,AVG(CASE WHEN r.status='completed' THEN julianday(r.updated_at)-julianday(r.created_at) END) AS avg_days FROM requests r JOIN services s ON s.id=r.service_id JOIN departments d ON d.id=COALESCE(r.handling_department_id,s.department_id) AND d.tenant_id=r.tenant_id WHERE r.tenant_id=? AND r.status<>'draft' AND date(r.created_at,'+3 hours') BETWEEN ? AND ? ${scoped?'AND d.id=?':''} GROUP BY d.id ORDER BY received DESC`).all(...(scoped?[u.tenant_id,from,to,u.department_id]:[u.tenant_id,from,to]));
      return {columns:[['department','الإدارة','text'],['received','الوارد','number'],['completed','المكتمل','number'],['open','المفتوح','number'],['returned','معاد لصاحبه','number'],['avg_days','متوسط أيام الإنجاز','number']],rows:rows.map(r=>({...r,avg_days:round1(r.avg_days)})),notes:[scoped?'النطاق: إدارتك فقط.':'النطاق: كل الإدارات.','الإدارة هي المعالِجة بعد أي تحويل، لا مالكة الخدمة الأصلية.']};
    }},
  {key:'R08',group:'الإدارات والخدمات',title:'الطلبات المنتظرة وأعمارها',definition:'الطلبات المفتوحة الآن لكل خدمة: عددها، وعمر أقدمها، وكم منها تجاوز الزمن المستهدف.',source:'requests + service_directory.target_days',allowed:execOrManager,
    run(db,u,{to}){
      const scoped=!exec(db,u);
      const rows=db.prepare(`SELECT s.code,s.name_ar AS name,d.name AS department,COALESCE(sd.target_days,0) AS target,r.created_at,r.id,r.status,r.tenant_id FROM requests r JOIN services s ON s.id=r.service_id JOIN departments d ON d.id=s.department_id AND d.tenant_id=s.tenant_id LEFT JOIN service_directory sd ON sd.tenant_id=s.tenant_id AND sd.service_code=s.code WHERE r.tenant_id=? AND r.status IN ${OPEN_REQUEST} ${scoped?'AND s.department_id=?':''}`).all(...(scoped?[u.tenant_id,u.department_id]:[u.tenant_id]));
      const groups=new Map(),holidays=holidaySet(db,u.tenant_id);for(const r of rows){const g=groups.get(r.code)??{code:r.code,name:r.name,department:r.department,target:r.target||null,open:0,oldest_days:0,waiting_requester:0,oldest_return_days:0,beyond_target:0};const age=days(riyadhDate(r.created_at),to),clock=clockFor(db,r,r.target,holidays,to);g.open++;g.oldest_days=Math.max(g.oldest_days,age);if(clock.paused_since){g.waiting_requester++;g.oldest_return_days=Math.max(g.oldest_return_days,clock.paused_days??0);}if(clock.overdue)g.beyond_target++;groups.set(r.code,g);}
      return {columns:[['code','الرمز','text'],['name','الخدمة','text'],['department','الإدارة','text'],['open','مفتوح','number'],['oldest_days','عمر الأقدم بالأيام','number'],['target','المستهدف (أيام عمل)','number'],['waiting_requester','بانتظار صاحب الطلب','number'],['oldest_return_days','أقدم انتظار عند صاحبه (أيام عمل)','number'],['beyond_target','تجاوز المستهدف','number']],rows:[...groups.values()].sort((a,b)=>b.beyond_target-a.beyond_target||b.oldest_days-a.oldest_days),notes:['عمر الأقدم تقويمي حتى نهاية الفترة.','تجاوز المستهدف يُحسب بأيام العمل (الأحد–الخميس دون العطل المعتمدة)، ولا يُحسب على الإدارة وقت انتظار صاحب الطلب بعد الإرجاع.','الطلب المعاد يبقى معدودًا وله عمر: «أقدم انتظار عند صاحبه» أيام العمل منذ إعادة أقدم طلب لم يردّ صاحبه، ولو كانت الخدمة بلا زمن مستهدف.']};
    }},
  {key:'R09',group:'الإدارات والخدمات',title:'الجودة وإعادة العمل',definition:'مؤشرات إعادة العمل من سجلات المنصة: إعادات الاستوديو، جولات تعديل المحتوى، وجولات المراجعة التي تجاوزت العقد.',source:'studio_reviews + content_items.revision_count + scope_events',allowed:execOrManager,
    run(db,u,{from,to}){
      const studio=db.prepare("SELECT COUNT(*) AS total,SUM(r.decision='returned') AS returned FROM studio_reviews r JOIN studio_submissions s ON s.id=r.submission_id JOIN studio_workspaces w ON w.id=s.studio_id WHERE w.tenant_id=? AND date(r.reviewed_at,'+3 hours') BETWEEN ? AND ?").get(u.tenant_id,from,to);
      const content=db.prepare('SELECT COUNT(*) AS items,COALESCE(SUM(revision_count),0) AS rounds,SUM(revision_count>=2) AS heavy FROM content_items WHERE tenant_id=? AND date(created_at,\'+3 hours\') BETWEEN ? AND ?').get(u.tenant_id,from,to);
      const scope=db.prepare("SELECT COUNT(*) AS n FROM scope_events e JOIN scope_baselines b ON b.id=e.baseline_id WHERE b.tenant_id=? AND e.kind='revision' AND e.over_scope=1 AND date(e.created_at,'+3 hours') BETWEEN ? AND ?").get(u.tenant_id,from,to).n;
      const requests=db.prepare("SELECT COUNT(*) AS n FROM audit_events WHERE tenant_id=? AND entity_type='request' AND action LIKE '%return%' AND date(created_at,'+3 hours') BETWEEN ? AND ?").get(u.tenant_id,from,to).n;
      return {columns:[['source','المصدر','text'],['measure','المقياس','text'],['value','القيمة','number'],['base','من أصل','number']],rows:[
        {source:'الاستوديو',measure:'مراجعات انتهت بإعادة',value:studio.returned??0,base:studio.total},{source:'تقويم المحتوى',measure:'جولات تعديل',value:content.rounds,base:content.items},{source:'تقويم المحتوى',measure:'بنود بجولتين أو أكثر',value:content.heavy??0,base:content.items},
        {source:'حارس النطاق',measure:'جولات مراجعة تجاوزت العقد',value:scope,base:null},{source:'الطلبات',measure:'إعادات لصاحب الطلب',value:requests,base:null}],
        notes:['لا تُسجل ساعات إعادة العمل، فلا تكلفة لها هنا.','الأرقام على مستوى الشركة؛ لا تُنسب لموظف.']};
    }},
  {key:'R11',group:'المشاريع والموارد',title:'تقدم المشاريع ومهامها',definition:'كل مشروع أنت عضو فيه: مهامه المكتملة والمتأخرة وأقرب موعد قائم.',source:'projects + project_members + tasks',allowed:(db,u)=>u.role!=='admin'||exec(db,u),
    run(db,u,{to}){
      const all=exec(db,u);
      const rows=db.prepare(`SELECT p.id,p.name FROM projects p WHERE p.tenant_id=? ${all?'':'AND EXISTS(SELECT 1 FROM project_members m WHERE m.project_id=p.id AND m.user_id=?)'} ORDER BY p.created_at DESC LIMIT 300`).all(...(all?[u.tenant_id]:[u.tenant_id,u.id])).map(p=>{
        const t=db.prepare("SELECT COUNT(*) AS total,SUM(status='completed') AS done,SUM(status<>'completed' AND due_date<?) AS late,MIN(CASE WHEN status<>'completed' THEN due_date END) AS next_due FROM tasks WHERE project_id=?").get(to,p.id);
        return {project:p.name,total:t.total,done:t.done??0,late:t.late??0,progress:t.total?Math.round((t.done??0)*100/t.total):null,next_due:t.next_due??''};});
      return {columns:[['project','المشروع','text'],['total','المهام','number'],['done','مكتملة','number'],['late','متأخرة','number'],['progress','الإنجاز %','number'],['next_due','أقرب موعد قائم','text']],rows,notes:[all?'النطاق: كل المشاريع.':'النطاق: مشاريعك فقط.','الإنجاز بعدد المهام لا بوزنها؛ لا مراحل ولا معالم بعد.']};
    }},
  {key:'R12',group:'المشاريع والموارد',title:'مخصصات المشاريع: المخطط والمحجوز والملتزم',definition:'كل مخصص مشروع معتمد: سقفه وما حُجز بترسية وما التُزم به بأمر شراء وما بقي.',source:'project_budgets + project_budget_reservations',allowed:finance,
    run(db,u){
      const rows=db.prepare("SELECT b.id,p.name AS project,b.cost_center,b.cap_minor,b.valid_until,b.status FROM project_budgets b JOIN projects p ON p.id=b.project_id WHERE b.tenant_id=? ORDER BY p.name,b.cost_center").all(u.tenant_id).map(b=>{
        // من منظور المخصص الواحد (budgetUsage): الملتزم ما بقي من الأمر بعد المستهلك والمتحرر، لا مبلغ الأمر كاملًا كما كان يُجمع.
        const r=budgetUsage(db,b.id);
        return {project:b.project,cost_center:b.cost_center,status:b.status,cap:sar(b.cap_minor),reserved:sar(r.reserved_minor),committed:sar(r.committed_minor),consumed:sar(r.consumed_minor),released:sar(r.released_minor),remaining:sar(b.cap_minor-r.used_minor),used:b.cap_minor?Math.round(r.used_minor*100/b.cap_minor):0,valid_until:b.valid_until};});
      return {columns:[['project','المشروع','text'],['cost_center','مركز التكلفة','text'],['status','الحالة','text'],['cap','السقف','money'],['reserved','محجوز','money'],['committed','ملتزم','money'],['consumed','مستهلك','money'],['released','متحرر','money'],['remaining','المتبقي','money'],['used','المستخدم %','number'],['valid_until','صالح حتى','text']],rows,notes:['لا يشمل تكلفة ساعات العمل ولا «المتوقع عند الإكمال».','الحالة لحظية ولا تتأثر بالفترة.']};
    }},
  {key:'R14',group:'المشاريع والموارد',title:'ساعات العمل حسب المشروع',definition:'الساعات المسجلة في الفترة لكل مشروع: القابل للفوترة وغير القابل، والمعتمد منها.',source:'time_entries',allowed:(db,u)=>exec(db,u)||['manager','pm'].includes(u.role),
    run(db,u,{from,to}){
      const all=exec(db,u);
      const rows=db.prepare(`SELECT p.name AS project,SUM(t.minutes) AS minutes,SUM(CASE WHEN t.billable=1 THEN t.minutes ELSE 0 END) AS billable,SUM(CASE WHEN t.status='approved' THEN t.minutes ELSE 0 END) AS approved,COUNT(DISTINCT t.user_id) AS people FROM time_entries t JOIN projects p ON p.id=t.project_id WHERE t.tenant_id=? AND t.work_date BETWEEN ? AND ? ${all?'':'AND (t.user_id=? OR t.user_id IN (SELECT id FROM users WHERE manager_id=?))'} GROUP BY p.id ORDER BY minutes DESC`).all(...(all?[u.tenant_id,from,to]:[u.tenant_id,from,to,u.id,u.id]));
      const h=m=>Math.round(m/6)/10;
      return {columns:[['project','المشروع','text'],['hours','الساعات','number'],['billable','قابلة للفوترة','number'],['billable_share','نسبتها %','number'],['approved','معتمدة','number'],['people','عدد المسجلين','number']],rows:rows.map(r=>({project:r.project,hours:h(r.minutes),billable:h(r.billable),billable_share:r.minutes?Math.round(r.billable*100/r.minutes):0,approved:h(r.approved),people:r.people})),notes:[all?'النطاق: كل الشركة.':'النطاق: ساعاتك وساعات فريقك المباشر.','لا تكلفة ساعة معتمدة، فلا يُحسب مبلغ.']};
    }},
  {key:'R15',group:'المشاريع والموارد',title:'إقفال الحملات وما تعلمناه',definition:'الحملات المقفلة في الفترة مع بلوغ مؤشراتها والدرس المسجل عند الإقفال.',source:'campaigns.learning + campaign_entries',allowed:accountTeam,
    run(db,u,{from,to}){
      const clients=accounts(db,u),byId=new Map(clients.map(c=>[c.id,c]));
      const rows=clients.length?db.prepare(`SELECT * FROM campaigns WHERE client_id IN (${marks(clients)}) AND status='completed' AND date(closed_at,'+3 hours') BETWEEN ? AND ? ORDER BY closed_at DESC`).all(...clients.map(c=>c.id),from,to).map(c=>{
        const targets=JSON.parse(c.targets),hit=targets.filter(t=>campaignActual(db,c.id,t.metric)>=t.target).length;
        return {client:clientName(byId.get(c.client_id)),campaign:c.name,closed:riyadhDate(c.closed_at),targets:targets.length,targets_met:hit,learning:c.learning};}):[];
      return {columns:[['client','العميل','text'],['campaign','الحملة','text'],['closed','أُقفلت','text'],['targets','المؤشرات','number'],['targets_met','تحقق منها','number'],['learning','ما تعلمناه','text']],rows,notes:['النطاق: حسابات العملاء التي أنت في فريقها.','المشاريع غير الحملات لا إقفال لها بدروس بعد.']};
    }},
  {key:'R16',group:'المبيعات والحسابات',title:'مسار الفرص التجارية',definition:'الفرص بحسب مرحلتها الحالية، وما دخل منها في الفترة.',source:'commercial_cases',allowed:(db,u)=>can(db,u,'commercial.use')||exec(db,u),
    run(db,u,{from,to}){
      const names={lead:'عميل محتمل',qualification_pending:'تأهيل بانتظار القرار',qualification_rejected:'تأهيل مرفوض',qualified:'مؤهل',quote_draft:'عرض قيد الإعداد',quote_pending:'عرض بانتظار الاعتماد',quote_rejected:'عرض مرفوض داخليًا',quote_approved:'عرض معتمد',lost:'خسرناها',withdrawn:'سحبناها',contracted:'تعاقد',project_active:'مشروع قائم'};
      const all=exec(db,u);
      const rows=db.prepare(`SELECT status,COUNT(*) AS total,SUM(date(created_at,'+3 hours') BETWEEN ? AND ?) AS entered FROM commercial_cases WHERE tenant_id=? ${all?'':'AND (owner_id=? OR department_id=?)'} GROUP BY status`).all(...(all?[from,to,u.tenant_id]:[from,to,u.tenant_id,u.id,u.department_id]));
      const order=Object.keys(names);
      return {columns:[['stage','المرحلة','text'],['total','الفرص الآن','number'],['entered','دخلت في الفترة','number']],rows:rows.sort((a,b)=>order.indexOf(a.status)-order.indexOf(b.status)).map(r=>({stage:names[r.status]??r.status,total:r.total,entered:r.entered??0})),notes:['لا احتمالات فوز ولا قيمة متوقعة: تحتاج مراحل واحتمالات معتمدة من الإدارة.']};
    }},
  {key:'R17',group:'المبيعات والحسابات',title:'العروض ونتائجها',definition:'الفرص التي صدر لها عرض: عدد نسخ العرض، وهل انتهت بتعاقد.',source:'commercial_quotes + commercial_contracts',allowed:(db,u)=>can(db,u,'commercial.use')||exec(db,u),
    run(db,u,{from,to}){
      const all=exec(db,u);
      const rows=db.prepare(`SELECT k.name,k.status,COUNT(q.id) AS revisions,MIN(q.created_at) AS first_quote,EXISTS(SELECT 1 FROM commercial_contracts c WHERE c.case_id=k.id) AS contracted,(SELECT r.name FROM pipeline_loss_reasons r WHERE r.id=k.closed_reason_id AND r.tenant_id=k.tenant_id) AS loss_reason FROM commercial_cases k JOIN commercial_quotes q ON q.case_id=k.id WHERE k.tenant_id=? ${all?'':'AND (k.owner_id=? OR k.department_id=?)'} GROUP BY k.id HAVING date(first_quote,'+3 hours') BETWEEN ? AND ? ORDER BY first_quote DESC`).all(...(all?[u.tenant_id,from,to]:[u.tenant_id,u.id,u.department_id,from,to]));
      const won=rows.filter(r=>r.contracted).length;
      return {columns:[['name','الفرصة','text'],['first_quote','أول عرض','text'],['revisions','نسخ العرض','number'],['outcome','النتيجة','text']],rows:rows.map(r=>({name:r.name,first_quote:riyadhDate(r.first_quote),revisions:r.revisions,outcome:r.contracted?'تعاقد':r.status==='lost'?`خسرناها${r.loss_reason?` — ${r.loss_reason}`:''}`:r.status==='withdrawn'?`سحبناها${r.loss_reason?` — ${r.loss_reason}`:''}`:r.status==='quote_rejected'?'رُفض داخليًا':'قائم'})),totals:{revisions:rows.reduce((n,r)=>n+r.revisions,0)},
        notes:[`تعاقد ${won} من ${rows.length} فرصة صدر لها عرض في الفترة.`]};
    }},
  {key:'R19',group:'المبيعات والحسابات',title:'استهلاك العقود والتغييرات',definition:'رصيد كل اشتراك شهري وما استُهلك منه، وما سُجل خارج خطوط الأساس وكيف بُت فيه.',source:'retainers + retainer_usage + scope_baselines + scope_events',allowed:accountTeam,
    run(db,u,{from,to}){
      const clients=accounts(db,u),rows=[];
      for(const c of clients){
        for(const r of db.prepare('SELECT * FROM retainers WHERE client_id=? AND period_month BETWEEN ? AND ? ORDER BY period_month').all(c.id,from.slice(0,7),to.slice(0,7)))
          for(const a of JSON.parse(r.allowances)){const used=db.prepare('SELECT COALESCE(SUM(quantity),0) AS n FROM retainer_usage WHERE retainer_id=? AND deliverable_type=?').get(r.id,a.type).n;rows.push({client:clientName(c),contract:`${r.name} · ${r.period_month}`,item:a.type,allowed:a.quantity,used,remaining:a.quantity-used,note:used>a.quantity?'تجاوز الرصيد':''});}
        for(const b of db.prepare('SELECT * FROM scope_baselines WHERE client_id=?').all(c.id)){
          const e=db.prepare("SELECT SUM(over_scope=1) AS over,SUM(disposition='absorbed') AS absorbed,SUM(disposition='change_request') AS changes,SUM(over_scope=1 AND disposition IS NULL) AS open FROM scope_events WHERE baseline_id=? AND date(created_at,'+3 hours') BETWEEN ? AND ?").get(b.id,from,to);
          rows.push({client:clientName(c),contract:b.name,item:'أحداث خارج النطاق',allowed:null,used:e.over??0,remaining:null,note:`تحملنا ${e.absorbed??0} · طلبات تغيير ${e.changes??0} · بلا قرار ${e.open??0}`});
        }
      }
      return {columns:[['client','العميل','text'],['contract','العقد أو الاشتراك','text'],['item','البند','text'],['allowed','المتاح','number'],['used','المستهلك','number'],['remaining','المتبقي','number'],['note','ملاحظة','text']],rows,notes:['النطاق: حسابات العملاء التي أنت في فريقها.']};
    }},
  {key:'R20',group:'المبيعات والحسابات',title:'مكونات صحة الحساب',definition:'مؤشرات كل حساب عميل جنبًا إلى جنب دون درجة مركبة: محتوى متأخر، طلبات خارج النطاق، حملات نشطة، وتجاوز اشتراك.',source:'content_items + scope_events + campaigns + retainer_usage',allowed:accountTeam,
    run(db,u,{to}){
      const rows=accounts(db,u).map(c=>({client:clientName(c),
        live_campaigns:db.prepare("SELECT COUNT(*) AS n FROM campaigns WHERE client_id=? AND status='live'").get(c.id).n,
        late_content:db.prepare("SELECT COUNT(*) AS n FROM content_items WHERE client_id=? AND status NOT IN ('published','cancelled') AND planned_date<?").get(c.id,to).n,
        waiting_client:db.prepare("SELECT COUNT(*) AS n FROM content_items WHERE client_id=? AND status='client_review'").get(c.id).n,
        open_scope:db.prepare('SELECT COUNT(*) AS n FROM scope_events e JOIN scope_baselines b ON b.id=e.baseline_id WHERE b.client_id=? AND e.over_scope=1 AND e.disposition IS NULL').get(c.id).n,
        absorbed:db.prepare("SELECT COUNT(*) AS n FROM scope_events e JOIN scope_baselines b ON b.id=e.baseline_id WHERE b.client_id=? AND e.disposition='absorbed'").get(c.id).n,
        overage:db.prepare("SELECT COUNT(*) AS n FROM retainer_usage x JOIN retainers r ON r.id=x.retainer_id WHERE r.client_id=? AND x.overage_note<>''").get(c.id).n}));
      return {columns:[['client','العميل','text'],['live_campaigns','حملات نشطة','number'],['late_content','محتوى فات موعده','number'],['waiting_client','بانتظار العميل','number'],['open_scope','خارج النطاق بلا قرار','number'],['absorbed','تحملناه دون مقابل','number'],['overage','تجاوزات اشتراك','number']],rows,
        notes:['لا درجة صحة مركبة: الأوزان قرار إدارة لم يُعتمد، فتُعرض المكونات كما هي.','لا يشمل رضا العميل ولا التحصيل: الأول غير مقيس، والثاني يظهر لحاملي التفويض المالي في R31.']};
    }},
  {key:'R21',group:'الحملات والإبداع',title:'أداء الحملات مقابل مستهدفاتها',definition:'كل مؤشر معتمد لكل حملة: المستهدف والمتحقق ونسبة البلوغ، من القيود المدخلة يدويًا بمصادرها.',source:'campaigns.targets + campaign_entries (إدخال يدوي)',allowed:accountTeam,
    run(db,u,{from,to}){
      const clients=accounts(db,u),byId=new Map(clients.map(c=>[c.id,c])),rows=[];
      if(clients.length)for(const c of db.prepare(`SELECT * FROM campaigns WHERE client_id IN (${marks(clients)}) AND status IN ('live','paused','completed') AND start_date<=? AND end_date>=? ORDER BY start_date DESC`).all(...clients.map(x=>x.id),to,from))
        for(const t of JSON.parse(c.targets)){const actual=campaignActual(db,c.id,t.metric);rows.push({client:clientName(byId.get(c.client_id)),campaign:c.name,metric:t.metric,unit:t.unit,target:t.target,actual,attainment:Math.round(actual*100/t.target)});}
      return {columns:[['client','العميل','text'],['campaign','الحملة','text'],['metric','المؤشر','text'],['unit','الوحدة','text'],['target','المستهدف','number'],['actual','المتحقق','number'],['attainment','البلوغ %','number']],rows,notes:['الأرقام مدخلة يدويًا من لوحات المنصات مع مصدر كل قيد؛ ليست قراءة آلية من منصات الإعلان.','المتحقق تراكمي لكامل الحملة لا للفترة وحدها.']};
    }},
  // R22 يقرأ سجل الصرف الإعلامي وحده (الحزمة 4، DOMAIN-2، الترحيل 192)، بشرط تقرير العميل نفسه (app/media-spend-ledger.mjs).
  // كان يجمع قيود «صرف» شاشة الحملة (campaign_entries)، فيقرأ المدير رقمًا ويخرج للعميل من السجل رقمٌ ثانٍ للحملة نفسها.
  {key:'R22',group:'الحملات والإبداع',title:'الميزانية الإعلامية واستهلاكها',definition:'ميزانية كل حملة وخطة صرفها المعتمدة، وما انصرف منها في الفترة ومن بدايتها بحسب القناة، ونسبة الصرف من المخطط مقابل نسبة الزمن اللي مضى — من سجل الصرف الإعلامي وحده.',
    source:'campaigns.media_budget_minor + media_plans/media_plan_lines (الخطة المعتمدة) + media_spend_entries (الساري: ما تصحّح ولا انلغت دفعته)',allowed:accountTeam,
    run(db,u,{from,to}){
      const clients=accounts(db,u),byId=new Map(clients.map(c=>[c.id,c])),rows=[],sum={budget:0,planned:0,spent:0,spent_to_date:0};
      const channel=key=>CHANNELS.find(c=>c.key===key)?.name??key,amount=minor=>(minor/100).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});
      if(clients.length)for(const c of db.prepare(`SELECT * FROM campaigns WHERE client_id IN (${marks(clients)}) AND status IN ('live','paused','completed') AND start_date<=? AND end_date>=? ORDER BY start_date DESC`).all(...clients.map(x=>x.id),to,from)){
        const plan=planInForce(db,c.id),length=Math.max(1,days(c.start_date,c.end_date)+1),elapsed=Math.min(length,Math.max(0,days(c.start_date,to)+1));
        const base={client:clientName(byId.get(c.client_id)),campaign:c.name,budget:sar(c.media_budget_minor),time_share:Math.round(elapsed*100/length)};
        sum.budget+=c.media_budget_minor;
        // بلا خطة معتمدة لا سجل صرف بعد: الخانة فاضية، لا صفر ولا رقم شاشة الحملة.
        if(!plan){rows.push({...base,plan:'بلا خطة صرف معتمدة',planned:null,spent:null,spent_to_date:null,spent_share:null,by_channel:''});continue;}
        const period=spendTotals(liveSpend(db,c.id,{from,to})),toDate=spendTotals(liveSpend(db,c.id,{to}));
        sum.planned+=plan.planned_minor;sum.spent+=period.total_minor;sum.spent_to_date+=toDate.total_minor;
        rows.push({...base,plan:`النسخة ${plan.revision}`,planned:sar(plan.planned_minor),spent:sar(period.total_minor),spent_to_date:sar(toDate.total_minor),
          spent_share:plan.planned_minor?Math.round(toDate.total_minor*100/plan.planned_minor):null,by_channel:period.by_channel.map(x=>`${channel(x.channel)}: ${amount(x.amount_minor)}`).join(' · ')});
      }
      return {columns:[['client','العميل','text'],['campaign','الحملة','text'],['plan','خطة الصرف المعتمدة','text'],['budget','ميزانية العميل','money'],['planned','المخطط','money'],['spent','المصروف في الفترة','money'],
          ['spent_to_date','المصروف لين نهاية الفترة','money'],['spent_share','الصرف % من المخطط','number'],['time_share','الزمن %','number'],['by_channel','بحسب القناة في الفترة','text']],
        rows,totals:Object.fromEntries(Object.entries(sum).map(([k,n])=>[k,sar(n)])),
        notes:['الصرف من سجل الصرف الإعلامي وحده: السطر اللي ما تصحّح ولا انلغت دفعة استيراده. وهو نفسه اللي تعرضه شاشة الصرف الإعلامي وقسم الصرف في تقرير العميل للفترة نفسها.',
          '«المصروف في الفترة» بتاريخ الصرف بين بداية الفترة ونهايتها، و«لين نهاية الفترة» من بداية الحملة. نسبة الصرف من مخطط الخطة المعتمدة، والزمن من بداية الحملة لين نهاية الفترة.',
          'الحملة اللي ما لها خطة صرف معتمدة يطلع صرفها فاضي مو صفر: سجل الصرف يبدأ من اعتماد الخطة، وقيود «صرف» المكتوبة في شاشة الحملة ما تدخل هنا.',
          'النطاق: حسابات العملاء اللي أنت في فريقها.']};
    }},
  {key:'R24',group:'الحملات والإبداع',title:'الإنتاج والمراجعات والتسليمات',definition:'مساحات الاستوديو: مخرجاتها، ومراجعاتها في الفترة وما أُعيد منها، وحزم التسليم الصادرة والمقبولة.',source:'studio_workspaces + studio_outputs + studio_reviews + studio_packages + studio_acceptances',allowed:(db,u)=>can(db,u,'studio.use')||exec(db,u),
    run(db,u,{from,to}){
      const all=exec(db,u);
      const rows=db.prepare(`SELECT w.id,w.title,w.status FROM studio_workspaces w WHERE w.tenant_id=? ${all?'':'AND (w.owner_id=? OR w.reviewer_id=?)'} ORDER BY w.updated_at DESC LIMIT 300`).all(...(all?[u.tenant_id]:[u.tenant_id,u.id,u.id])).map(w=>{
        const reviews=db.prepare('SELECT COUNT(*) AS total,SUM(r.decision=\'returned\') AS returned FROM studio_reviews r JOIN studio_submissions s ON s.id=r.submission_id WHERE s.studio_id=? AND date(r.reviewed_at,\'+3 hours\') BETWEEN ? AND ?').get(w.id,from,to);
        return {workspace:w.title,status:w.status,outputs:db.prepare('SELECT COUNT(*) AS n FROM studio_outputs WHERE studio_id=?').get(w.id).n,approved_outputs:db.prepare("SELECT COUNT(*) AS n FROM studio_outputs WHERE studio_id=? AND status='approved'").get(w.id).n,reviews:reviews.total,returned:reviews.returned??0,
          packages:db.prepare('SELECT COUNT(*) AS n FROM studio_packages WHERE studio_id=?').get(w.id).n,accepted:db.prepare('SELECT COUNT(*) AS n FROM studio_acceptances a JOIN studio_packages p ON p.id=a.package_id WHERE p.studio_id=?').get(w.id).n};});
      return {columns:[['workspace','مساحة العمل','text'],['status','الحالة','text'],['outputs','المخرجات','number'],['approved_outputs','معتمدة داخليًا','number'],['reviews','مراجعات في الفترة','number'],['returned','أُعيدت','number'],['packages','حزم تسليم','number'],['accepted','مقبولة','number']],rows,notes:[all?'النطاق: كل المساحات.':'النطاق: المساحات التي تملكها أو تراجعها.']};
    }},
  {key:'R25',group:'الحملات والإبداع',title:'حقوق الأصول وانتهاؤها',definition:'الأصول المسجلة في الاستوديو بحقوقها: صاحب الحق ومدته وقنواته، وما انتهى أو ينتهي خلال تسعين يومًا.',source:'studio_assets',allowed:(db,u)=>can(db,u,'studio.use')||exec(db,u),
    run(db,u,{to}){
      const all=exec(db,u),soon=new Date(Date.parse(to)+90*86400000).toISOString().slice(0,10);
      const rows=db.prepare(`SELECT a.name,a.rights_holder,a.valid_from,a.valid_until,a.channels,w.title FROM studio_assets a JOIN studio_workspaces w ON w.id=a.studio_id WHERE w.tenant_id=? ${all?'':'AND (w.owner_id=? OR w.reviewer_id=?)'} ORDER BY a.valid_until`).all(...(all?[u.tenant_id]:[u.tenant_id,u.id,u.id]));
      const list=value=>{try{const parsed=JSON.parse(value);return Array.isArray(parsed)?parsed.join('، '):String(value);}catch{return String(value);}};
      return {columns:[['asset','الأصل','text'],['workspace','مساحة العمل','text'],['holder','صاحب الحق','text'],['valid_until','ينتهي','text'],['state','الحالة','text'],['channels','القنوات','text']],rows:rows.map(a=>({asset:a.name,workspace:a.title,holder:a.rights_holder,valid_until:a.valid_until,state:a.valid_until<to?'انتهى الحق':a.valid_until<=soon?'ينتهي خلال 90 يومًا':'ساري',channels:list(a.channels)})),notes:['لا يعرف التقرير أين استُخدم الأصل خارج المنصة؛ يعرف مدة الحق المسجلة فقط.']};
    }},
  {key:'R27',group:'المشتريات والموردون',title:'مقارنة العروض وقرارات الترسية',definition:'طلبات الشراء التي رُسيت في الفترة: عدد عروضها، وأقلها، والمختار، وهل كانت طارئة.',source:'procurement_quotes + procurement_awards + procurement_emergencies',allowed:procurementView,
    run(db,u,{from,to}){
      const rows=db.prepare("SELECT p.id,p.title,a.quote_id,a.note,a.created_at,x.name AS approver FROM procurement_awards a JOIN procurement_purchases p ON p.id=a.purchase_id JOIN users x ON x.id=a.approved_by WHERE p.tenant_id=? AND date(a.created_at,'+3 hours') BETWEEN ? AND ? ORDER BY a.created_at DESC").all(u.tenant_id,from,to).map(a=>{
        const quotes=db.prepare('SELECT id,supplier_name,total_minor FROM procurement_quotes WHERE purchase_id=?').all(a.id),chosen=quotes.find(q=>q.id===a.quote_id),lowest=Math.min(...quotes.map(q=>q.total_minor));
        return {purchase:a.title,awarded:riyadhDate(a.created_at),quotes:quotes.length,lowest:sar(lowest),chosen_supplier:chosen.supplier_name,chosen:sar(chosen.total_minor),above_lowest:sar(chosen.total_minor-lowest),emergency:db.prepare("SELECT 1 FROM procurement_emergencies WHERE purchase_id=? AND status='approved'").get(a.id)?'طارئ':'',approver:a.approver,basis:a.note};});
      return {columns:[['purchase','الطلب','text'],['awarded','الترسية','text'],['quotes','العروض','number'],['lowest','أقل عرض','money'],['chosen_supplier','المختار','text'],['chosen','قيمته','money'],['above_lowest','فوق الأقل','money'],['emergency','طارئ','text'],['approver','المعتمد','text'],['basis','المبرر','text']],rows,notes:['الاختيار فوق الأقل ليس مخالفة بذاته؛ مبرره في العمود الأخير.']};
    }},
  {key:'R30',group:'المشتريات والموردون',title:'الأوامر والاستلام والمطابقة',definition:'كل أمر شراء قائم أو أُنجز في الفترة: المطلوب والمستلم والمفوتر والمطابَق، وما بينها من فروق.',source:'procurement_orders + procurement_receipts + procurement_invoices + procurement_payables',allowed:(db,u)=>procurementView(db,u)||finance(db,u),
    run(db,u,{from,to}){
      const rows=db.prepare("SELECT p.id,p.title,p.status,o.supplier_name,o.quantity,o.total_minor,o.delivery_date FROM procurement_orders o JOIN procurement_purchases p ON p.id=o.purchase_id WHERE p.tenant_id=? AND date(o.created_at,'+3 hours')<=? AND (p.status IN ('ordered','part_received') OR date(p.updated_at,'+3 hours')>=?) ORDER BY o.created_at DESC").all(u.tenant_id,to,from).map(o=>{
        const q=(table,column='quantity')=>db.prepare(`SELECT COALESCE(SUM(${column}),0) AS n FROM ${table} WHERE purchase_id=?`).get(o.id).n,received=q('procurement_receipts'),invoiced=q('procurement_invoices'),matched=q('procurement_payables','amount_minor');
        const changes=db.prepare("SELECT kind,new_delivery_date FROM procurement_order_changes WHERE purchase_id=? AND status='approved' ORDER BY decided_at").all(o.id),due=changes.filter(c=>c.kind==='delivery_date').at(-1)?.new_delivery_date??o.delivery_date,closed=changes.some(c=>c.kind==='close_short');
        return {purchase:o.title,supplier:o.supplier_name,ordered:o.quantity,received,invoiced,order_value:sar(o.total_minor),matched:sar(matched),due,flag:closed?'أُقفل على المستلم':received<o.quantity&&due<to?'تأخر التسليم':invoiced>received?'فوترة تسبق الاستلام':''};});
      return {columns:[['purchase','الطلب','text'],['supplier','المورد','text'],['ordered','المطلوب','number'],['received','المستلم','number'],['invoiced','المفوتر','number'],['order_value','قيمة الأمر','money'],['matched','المطابَق','money'],['due','موعد التسليم الساري','text'],['flag','تنبيه','text']],rows,notes:['لا سماحات فروق معتمدة: المطابقة تشترط تطابقًا تامًا مع سعر الأمر.']};
    }},
  {key:'R33',group:'المالية',title:'المخصصات بحسب مركز التكلفة',definition:'مجموع سقوف المخصصات المعتمدة وما استُخدم منها لكل مركز تكلفة.',source:'project_budgets + project_budget_reservations',allowed:finance,
    run(db,u){
      // المستخدم من منظور المخصص الواحد (budgetUsage): المحجوز والملتزم الباقي والمستهلك، والمتحرر ليس مستخدمًا.
      const groups=new Map();
      // المخصص الساري حالته 'active' (القيد: draft وpending وactive وrejected وclosed)؛ «approved» ليست حالة، فكان التقرير فارغًا دائمًا.
      for(const b of db.prepare("SELECT id,cost_center,cap_minor FROM project_budgets WHERE tenant_id=? AND status='active'").all(u.tenant_id)){
        const g=groups.get(b.cost_center)??{cost_center:b.cost_center,budgets:0,cap:0,used:0};g.budgets++;g.cap+=b.cap_minor;g.used+=budgetUsage(db,b.id).used_minor;groups.set(b.cost_center,g);}
      const rows=[...groups.values()].sort((a,b)=>b.cap-a.cap);
      return {columns:[['cost_center','مركز التكلفة','text'],['budgets','مخصصات','number'],['cap','السقف','money'],['used','المستخدم','money'],['remaining','المتبقي','money'],['used_share','المستخدم %','number']],rows:rows.map(r=>({cost_center:r.cost_center,budgets:r.budgets,cap:sar(r.cap),used:sar(r.used),remaining:sar(r.cap-r.used),used_share:r.cap?Math.round(r.used*100/r.cap):0})),totals:{cap:sar(rows.reduce((n,r)=>n+r.cap,0)),used:sar(rows.reduce((n,r)=>n+r.used,0))},notes:['المخصصات على مستوى المشاريع؛ لا موازنات إدارات سنوية في المنصة بعد.']};
    }},
  {key:'R35',group:'المالية',title:'حزمة الإقفال: ما يمنع إقفال الفترة',definition:'الفحوص نفسها التي يشغّلها اعتماد الإقفال الشهري، محسوبة لحظة الطلب: القيود اللي ما ترحّلت، والمستندات بلا قيد مرحّل، والحسابات البنكية بلا تسوية معتمدة، وفروق الحسابات الرقابية؛ ومعها الفترات المنتهية المفتوحة وتوازن المركز المالي.',
    source:'close-checklist closeChecks (القيود + المستندات + التسوية البنكية + الحسابات الرقابية) + finance_periods + finance_account_mappings',allowed:finance,
    run(db,u,{from,to}){
      // كانت الحزمة تحسب بطريقتها: القيد المرفوض «غير مرحّل» للأبد، والمستحقات والحسابات البنكية والحسابات الرقابية خارجها، وسطرٌ يقول
      // إن المنصة بلا مطابقة بنكية. صارت تقرأ closeChecks نفسها التي ترفض اعتماد الإقفال، فما يمنع الإقفال هنا هو ما يمنعه هناك.
      const s=statements(db,u,{from,to}),rows=[];
      const add=(check,item,detail,{date='',amount=null,owner='',blocking=true}={})=>rows.push({check,item,detail,date,amount,owner,blocking:blocking?'نعم':'لا'});
      for(const p of db.prepare("SELECT name,starts_on,ends_on FROM finance_periods WHERE tenant_id=? AND status='open' AND ends_on<? ORDER BY starts_on").all(u.tenant_id,to))
        add('فترة انتهت ولم تُقفل',p.name,`${p.starts_on} إلى ${p.ends_on}`,{date:p.ends_on,owner:'المالية — من يحمل تصريح إدارة الإقفال الشهري'});
      // الإقفال المفتوح لشهر نهاية الفترة، إن وُجد، يحمل تفسيرات فروق الحسابات الرقابية المكتوبة عليه.
      const close=db.prepare('SELECT id,finance_period_id FROM close_periods WHERE tenant_id=? AND period_key=?').get(u.tenant_id,to.slice(0,7));
      const checks=closeChecks(db,u.tenant_id,{from,to,finance_period_id:close?.finance_period_id??null,period_id:close?.id??null});
      for(const c of checks.checks)for(const i of c.items){
        if(c.key==='journals')add('قيد ما ترحّل',i.status_name,`${i.reference} بتاريخ ${i.date}`,{date:i.date,owner:c.owner});
        else if(c.key==='sources')add('مستند بلا قيد مرحّل',i.source_name,i.reference,{date:i.date,amount:sar(i.amount_minor),owner:c.owner});
        else if(c.key==='bank')add('حساب بنكي بلا تسوية معتمدة',`الحساب ${i.label} (${i.gl_code})`,i.last_reconciled_to?`آخر تسوية معتمدة لين ${i.last_reconciled_to}، والمطلوب ${to}`:`ما له تسوية معتمدة، والمطلوب ${to}`,{date:to,owner:c.owner});
        else add('فرق حساب رقابي',`${i.purpose_name}: ${i.reason_name}`,i.explained?`${i.label??''} — مفسَّر: ${i.explanation.text}`:(i.label??i.text),
          {date:i.date??to,amount:sar(i.amount_minor),owner:c.owner,blocking:!i.passed});
      }
      add('توازن المركز المالي',s.balance_sheet.balanced?'متوازن':'غير متوازن',`أصول ${sar(s.balance_sheet.total_assets_minor)} · التزامات وحقوق ${sar(s.balance_sheet.total_liabilities_equity_minor)}`,{date:to,blocking:!s.balance_sheet.balanced,owner:'المالية — من يحمل تفويض اعتماد القيود وترحيلها'});
      if(s.pending_mappings.length)add('ربط محاسبي بانتظار الاعتماد',`${s.pending_mappings.length} ربط`,s.pending_mappings.map(m=>`${m.purpose} ← ${m.code}`).join('، '),{owner:'المالية — من يحمل تفويض الاعتماد'});
      return {columns:[['check','الفحص','text'],['item','البند','text'],['detail','التفصيل','text'],['date','التاريخ','text'],['amount','المبلغ','money'],['owner','مالكه','text'],['blocking','يمنع الإقفال','text']],rows,
        notes:['الفحوص نفسها التي يشغّلها اعتماد الإقفال الشهري ويرفض بها، محسوبة لحظة الطلب لا منسوخة.','التسوية البنكية مطلوبة لكل حساب بنكي نشط تحرّك في الدفتر أو له كشف لين نهاية الفترة.','فرق الحساب الرقابي المفسَّر كتابةً على إقفال شهره لا يمنع الإقفال، ويبقى في الحزمة بتفسيره.']};
    }},
  {key:'R38',group:'الموظفون والتشغيل',title:'التوظيف والتهيئة والتدريب',definition:'الاحتياجات الوظيفية ومرشحوها، ومهام التهيئة المفتوحة، وساعات التدريب المكتملة في الفترة.',source:'people_requisitions + people_candidates + people_onboarding_tasks + training_records',allowed:(db,u)=>can(db,u,'people.manage')||hrView(db,u),
    run(db,u,{from,to}){
      const rows=db.prepare('SELECT id,title,status,target_date FROM people_requisitions WHERE tenant_id=? ORDER BY created_at DESC LIMIT 200').all(u.tenant_id).map(r=>{const c=db.prepare("SELECT COUNT(*) AS total,SUM(status IN ('accepted','onboarding','completed')) AS hired,SUM(status='rejected') AS rejected FROM people_candidates WHERE requisition_id=?").get(r.id);return {kind:'احتياج وظيفي',item:r.title,state:r.status,a:c.total,b:c.hired??0,c:c.rejected??0,detail:`المستهدف ${r.target_date}`};});
      const onboarding=db.prepare("SELECT COUNT(*) AS open,SUM(due_date<?) AS late FROM people_onboarding_tasks WHERE tenant_id=? AND status='open'").get(to,u.tenant_id);
      rows.push({kind:'التهيئة',item:'مهام تهيئة مفتوحة',state:'',a:onboarding.open,b:onboarding.late??0,c:null,detail:'العمود الثاني: المتأخر منها'});
      const training=db.prepare("SELECT kind,COUNT(*) AS n,SUM(hours) AS hours,COUNT(DISTINCT user_id) AS people FROM training_records WHERE tenant_id=? AND status='completed' AND end_date BETWEEN ? AND ? GROUP BY kind").all(u.tenant_id,from,to);
      for(const t of training)rows.push({kind:'تدريب مكتمل',item:t.kind,state:'',a:t.n,b:t.hours,c:t.people,detail:'سجلات · ساعات · موظفون'});
      return {columns:[['kind','النوع','text'],['item','البند','text'],['state','الحالة','text'],['a','العدد','number'],['b','الثاني','number'],['c','الثالث','number'],['detail','معنى الأعمدة','text']],rows,notes:['للاحتياج الوظيفي: العدد = المرشحون، الثاني = المقبولون، الثالث = المرفوضون.','بيانات المرشحين الشخصية لا تظهر في هذا التقرير.']};
    }},
  {key:'R39',group:'الموظفون والتشغيل',title:'سجل الأصول الثابتة وقيمتها الدفترية',definition:'كل أصل معتمد: تكلفته ومجمع إهلاكه وقيمته الدفترية وعهدته ومكانه.',source:'fixed_assets + depreciation_lines',allowed:finance,
    run(db,u){
      const rows=db.prepare("SELECT a.*,x.name AS custodian,(SELECT COALESCE(SUM(l.amount_minor),0) FROM depreciation_lines l WHERE l.asset_id=a.id) AS accumulated FROM fixed_assets a LEFT JOIN users x ON x.id=a.custodian_id WHERE a.tenant_id=? AND a.status IN ('active','disposed') ORDER BY a.code").all(u.tenant_id);
      return {columns:[['code','الرقم','text'],['name','الأصل','text'],['category','الفئة','text'],['acquired_on','تاريخ الاقتناء','text'],['cost','التكلفة','money'],['accumulated','مجمع الإهلاك','money'],['book_value','القيمة الدفترية','money'],['custodian','العهدة','text'],['location','المكان','text'],['status','الحالة','text']],
        rows:rows.map(a=>({code:a.code,name:a.name,category:a.category,acquired_on:a.acquired_on,cost:sar(a.cost_minor),accumulated:sar(a.accumulated),book_value:sar(a.cost_minor-a.accumulated),custodian:a.custodian??'',location:a.location,status:a.status==='active'?'قائم':'مستبعد'})),totals:{cost:sar(rows.reduce((n,a)=>n+a.cost_minor,0)),book_value:sar(rows.reduce((n,a)=>n+a.cost_minor-a.accumulated,0))},notes:['لا يشمل التراخيص والاشتراكات البرمجية: لا سجل لها في المنصة بعد.']};
    }},
  {key:'R40',group:'الموظفون والتشغيل',title:'تبنّي المنصة بحسب المجال',definition:'عدد العمليات المسجلة في سجل التدقيق في الفترة لكل مجال، وعدد المستخدمين الذين نفذوها.',source:'audit_events',allowed:(db,u)=>exec(db,u)||can(db,u,'accounts.manage'),
    run(db,u,{from,to}){
      const rows=db.prepare("SELECT entity_type,COUNT(*) AS events,COUNT(DISTINCT actor_id) AS people,MAX(created_at) AS last FROM audit_events WHERE tenant_id=? AND date(created_at,'+3 hours') BETWEEN ? AND ? AND entity_type NOT IN ('session','synthetic_fixture') GROUP BY entity_type ORDER BY events DESC").all(u.tenant_id,from,to);
      const active=db.prepare("SELECT COUNT(*) AS n FROM users WHERE tenant_id=? AND active=1 AND role<>'admin'").get(u.tenant_id).n;
      return {columns:[['area','المجال','text'],['events','العمليات','number'],['people','المستخدمون','number'],['share','من الموظفين %','number'],['last','آخر عملية','text']],rows:rows.map(r=>({area:r.entity_type,events:r.events,people:r.people,share:active?Math.round(r.people*100/active):0,last:riyadhDate(r.last)})),notes:['العدد عمليات كتابة مسجلة في سجل التدقيق، لا مشاهدات. التكاملات الخارجية كلها غير متصلة؛ انظر شاشة حالة التكاملات.','لا يُعرض نشاط موظف بعينه.']};
    }}
];
function campaignActual(db,campaignId,metric){
  return db.prepare("SELECT COALESCE(SUM(e.value),0) AS n FROM campaign_entries e WHERE e.campaign_id=? AND e.kind='result' AND e.metric=? AND NOT EXISTS(SELECT 1 FROM campaign_entries x WHERE x.corrects_id=e.id)").get(campaignId,metric).n;
}
