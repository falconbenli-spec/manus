import {randomUUID} from 'node:crypto';
import {audit,now} from './db.mjs';
import {fail} from './auth.mjs';
import {financeCapabilities} from './finance.mjs';
import {resolveCostCenter} from './cost-centres.mjs';
import * as v from './validation.mjs';
import { MAX_FINANCE_AUTHORITY_DAYS, authorityCapDays } from './authority-limits.mjs';
import { refuse } from './refusal.mjs';
import { purchaseCommitment } from './procurement-guards.mjs';

const dateToday=()=>new Date(Date.now()+10800000).toISOString().slice(0,10);
const center=value=>v.text(value,'مرجع مركز التكلفة',120).normalize('NFKC').trim().replace(/\s+/gu,' ').toUpperCase();
function current(db,u){const row=u&&db.prepare('SELECT * FROM users WHERE id=? AND tenant_id=? AND active=1').get(u.id,u.tenant_id);if(!row)fail(403,'forbidden','الحساب غير متاح');return row;}
function tx(db){if(!db.isTransaction)fail(500,'transaction_required','يلزم تنفيذ تغيير المخصص داخل معاملة');}
function owner(db,u,id){return u.role==='manager'&&!!db.prepare('SELECT 1 FROM projects p JOIN project_members m ON m.project_id=p.id AND m.user_id=p.created_by WHERE p.id=? AND p.tenant_id=? AND p.created_by=?').get(id,u.tenant_id,u.id);}
export function hasProjectFinanceAccess(db,supplied,projectId){
 let u;try{u=current(db,supplied);}catch(e){if(e.code==='forbidden')return false;throw e;}
 if(!financeCapabilities(db,u).includes('read'))return false;
 const time=now();return db.prepare('SELECT * FROM project_finance_grants WHERE tenant_id=? AND project_id=? AND user_id=? AND granted_role=? AND granted_department_id=? AND revoked_at IS NULL AND starts_at<=? AND ends_at>?').all(u.tenant_id,projectId,u.id,u.role,u.department_id,time,time).some(g=>{const grantor=db.prepare('SELECT * FROM users WHERE id=? AND tenant_id=? AND active=1').get(g.granted_by,u.tenant_id);return grantor&&owner(db,grantor,projectId);});
}
export function listFinanceProjects(db,u){u=current(db,u);return db.prepare('SELECT id,name FROM projects WHERE tenant_id=? ORDER BY name,id').all(u.tenant_id).filter(p=>hasProjectFinanceAccess(db,u,p.id));}
export function grantProjectFinanceAccess(db,supplied,projectId,input){
 tx(db);const u=current(db,supplied);v.object(input,['user_id','ends_at','reason']);
 if(!owner(db,u,projectId))fail(403,'project_scope_denied','منشئ المشروع المدير وحده يحدد نطاق المالية');
 const target=db.prepare('SELECT * FROM users WHERE id=? AND tenant_id=? AND active=1').get(typeof input.user_id==='string'?input.user_id:'',u.tenant_id);
 if(!target||target.id===u.id||!financeCapabilities(db,target).includes('read'))fail(400,'invalid_finance_user','اختر حسابًا ماليًا آخر ذا تصريح حالي');
 const time=now(),end=input.ends_at;if(typeof end!=='string'||!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(end)||!Number.isFinite(Date.parse(end))||new Date(end).toISOString()!==end||end<=time)fail(400,'invalid_interval','يلزم تاريخ انتهاء UTC صالح في المستقبل');
 // ولا نطاق بلا نهاية عملية: النطاق المالي للمشروع مؤقت بطبيعته، وكان يقبل 2099 فيصير دائمًا بلا مراجعة.
 // الأفق المالي نفسه (MAX_FINANCE_AUTHORITY_DAYS في finance-grants.mjs) — مقيس من التفويضات السارية، يمنع التاريخ المنسيّ.
 const scopeCap=authorityCapDays(db,u.tenant_id,'finance_authority_max_days',MAX_FINANCE_AUTHORITY_DAYS);
 if(Date.parse(end)-Date.parse(time)>scopeCap*86400000)fail(400,'invalid_interval',`أقصى مدة للنطاق المالي ${scopeCap} يومًا. النطاق الدائم صلاحية لا نطاق`);
 if(db.prepare('SELECT 1 FROM project_finance_grants WHERE project_id=? AND user_id=? AND revoked_at IS NULL AND ends_at>?').get(projectId,target.id,time))fail(409,'overlapping_grant','يوجد نطاق مالي غير منتهٍ لهذا المستخدم');
 const id=randomUUID(),reason=v.text(input.reason,'سبب منح النطاق',3000,3);
 db.prepare('INSERT INTO project_finance_grants VALUES(?,?,?,?,?,?,?,?,?,?,NULL,NULL,1,?)').run(id,u.tenant_id,projectId,target.id,target.role,target.department_id,u.id,time,end,reason,time);
 audit(db,u,'project_finance_scope',id,'grant',{}, {project_id:projectId,user_id:target.id,ends_at:end},reason);return getProjectFinanceGrant(db,u,id);
}
export function getProjectFinanceGrant(db,supplied,id){const u=current(db,supplied),r=db.prepare('SELECT * FROM project_finance_grants WHERE id=? AND tenant_id=?').get(id,u.tenant_id);if(!r||(!owner(db,u,r.project_id)&&r.user_id!==u.id))fail(404,'not_found','النطاق غير متاح');return r;}
export function revokeProjectFinanceAccess(db,supplied,id,input){tx(db);const u=current(db,supplied),r=getProjectFinanceGrant(db,u,id);v.object(input,['version','reason']);v.version(input.version,r.version);if(!owner(db,u,r.project_id))fail(403,'project_scope_denied','منشئ المشروع المدير وحده يسحب النطاق');if(r.revoked_at)fail(409,'already_revoked','النطاق مسحوب');const reason=v.text(input.reason,'سبب السحب',3000,3);db.prepare('UPDATE project_finance_grants SET revoked_at=?,revocation_reason=?,version=version+1 WHERE id=?').run(now(),reason,id);audit(db,u,'project_finance_scope',id,'revoke',{}, {project_id:r.project_id,user_id:r.user_id},reason);return getProjectFinanceGrant(db,u,id);}
function financial(db,u,projectId,action='read'){if(!hasProjectFinanceAccess(db,u,projectId))fail(404,'not_found','المخصص خارج نطاقك المالي');if(!financeCapabilities(db,u).includes(action))fail(403,'financial_action_denied','التصريح المالي لا يجيز هذا الفعل');}
function amount(value){if(typeof value!=='string'||!/^(0|[1-9]\d{0,10})(\.\d{1,2})?$/.test(value))fail(400,'invalid_money','أدخل قيمة عشرية بمنزلتين كحد أقصى');const [a,b='']=value.split('.'),n=BigInt(a)*100n+BigInt(b.padEnd(2,'0'));if(n<1n||n>1000000000000n)fail(400,'invalid_money','المخصص خارج الحد العددي');return Number(n);}
function fields(input){const valid_from=v.date(input.valid_from),valid_until=v.date(input.valid_until);if(valid_until<valid_from)fail(400,'invalid_interval','نهاية المخصص تسبق بدايته');return {cap_minor:amount(input.cap_amount),valid_from,valid_until,evidence:v.text(input.evidence,'دليل المخصص',3000,3)};}
// الاستخدام مشتق من المستندات لا مخزَّن (الترحيل 169): الحجز من صفوف الحجز، والالتزام والاستهلاك والتحرر لكل طلب أمره معتمد من
// purchaseCommitment (app/procurement-guards.mjs) — المطابقة تستهلك، والإقفال على المستلم والمرتجع النهائي يحرران، والإلغاء يعيد.
// فالمتاح = السقف − المحجوز − الملتزم به − المستهلك، ولا رقم يُكتب في صف فيبقى بعد أن يتغير ما تحته. matched_minor اسمٌ قديم للمستهلك.
// أرقام المخصص من منظور واحد يقرؤه كل من يعرضها (شاشة المخصصات وتقريرا R12 وR33): المحجوز، والملتزم الباقي من كل أمر بعد ما
// استُهلك منه بالمطابقة وما تحرّر بالإقفال القصير (الترحيل 169)، والمستهلك، والمتحرر.
export const budgetUsage=(db,id)=>usage(db,id);
function usage(db,id){
 const rows=db.prepare("SELECT status,COALESCE(SUM(amount_minor),0) AS amount FROM project_budget_reservations WHERE budget_id=? GROUP BY status").all(id);const n=s=>rows.find(r=>r.status===s)?.amount??0;
 let committed=0,consumed=0,released=n('released');
 for(const r of db.prepare("SELECT purchase_id FROM project_budget_reservations WHERE budget_id=? AND status='committed'").all(id)){const c=purchaseCommitment(db,r.purchase_id);committed+=c.committed_minor;consumed+=c.consumed_minor;released+=c.released_minor;}
 return {reserved_minor:n('reserved'),committed_minor:committed,consumed_minor:consumed,released_minor:released,used_minor:n('reserved')+committed+consumed,matched_minor:consumed};
}
function get(db,u,id){const b=db.prepare('SELECT * FROM project_budgets WHERE id=? AND tenant_id=?').get(id,u.tenant_id);if(!b)fail(404,'not_found','المخصص غير متاح');financial(db,u,b.project_id);return b;}
function actions(db,u,b){const a=[],caps=financeCapabilities(db,u);if(caps.includes('prepare')){if(b.status==='draft'&&b.prepared_by===u.id)a.push('edit','submit');if(['active','rejected'].includes(b.status))a.push('revise');}if(caps.includes('approve')){if(b.status==='pending'&&b.prepared_by!==u.id)a.push('approve','return','reject');if(b.status==='active'&&b.prepared_by!==u.id)a.push('close');}return a;}
export function getBudget(db,supplied,id){const u=current(db,supplied),b=get(db,u,id),used=usage(db,id);return {...b,...used,available_minor:b.cap_minor-used.used_minor,allowed_actions:actions(db,u,b),history:db.prepare('SELECT * FROM project_budget_versions WHERE budget_id=? ORDER BY version').all(id).map(r=>({...r,snapshot:JSON.parse(r.snapshot)}))};}
export function listBudgets(db,supplied){const u=current(db,supplied),projects=listFinanceProjects(db,u),owned=db.prepare('SELECT id,name FROM projects WHERE tenant_id=?').all(u.tenant_id).filter(p=>owner(db,u,p.id));return {user_id:u.id,permissions:financeCapabilities(db,u),projects,owned_projects:owned,finance_users:owned.length?db.prepare('SELECT id,name FROM users WHERE tenant_id=? AND active=1 AND id<>?').all(u.tenant_id,u.id).filter(t=>financeCapabilities(db,{...t,tenant_id:u.tenant_id}).includes('read')):[],grants:db.prepare('SELECT * FROM project_finance_grants WHERE tenant_id=? ORDER BY created_at DESC').all(u.tenant_id).filter(g=>owned.some(p=>p.id===g.project_id)||g.user_id===u.id).map(g=>({...g,can_revoke:!g.revoked_at&&owned.some(p=>p.id===g.project_id)})),budgets:db.prepare('SELECT id,project_id FROM project_budgets WHERE tenant_id=? ORDER BY created_at DESC').all(u.tenant_id).filter(b=>projects.some(p=>p.id===b.project_id)).map(b=>getBudget(db,u,b.id)),generated_at:now()};}
function snapshot(db,u,b,action,note=''){db.prepare('INSERT INTO project_budget_versions VALUES(?,?,?,?,?,?)').run(b.id,b.version,action,u.id,JSON.stringify({...b,...usage(db,b.id)}),now());audit(db,u,'project_budget',b.id,action,{}, {version:b.version,revision:b.revision,status:b.status,cap_minor:b.cap_minor},note);}
// المخصص يحمل معرّف مركز التكلفة كما يحمله طلب الشراء (الترحيل 134): الطرفان يشيران إلى الصفّ نفسه في
// finance_cost_centers، فلا يبقى تطابقهما رهن كتابة حرفية متطابقة. والنصّ يبقى كما كُتب، والمعرّف NULL حين
// لا يُحلّ — فلا يُخمَّن مركز.
export function createBudget(db,supplied,input){tx(db);const u=current(db,supplied);v.object(input,['project_id','cost_center','currency','cap_amount','valid_from','valid_until','evidence']);financial(db,u,input.project_id,'prepare');if(input.currency!=='SAR')fail(400,'invalid_currency','المخصص بعملة SAR');const c=center(input.cost_center),resolved=resolveCostCenter(db,u.tenant_id,input.cost_center);if(db.prepare('SELECT 1 FROM project_budgets WHERE project_id=? AND cost_center=?').get(input.project_id,c))fail(409,'duplicate_budget','عدّل نسخة المخصص الموجود بدل إنشاء مخصص موازٍ');const f=fields(input),id=randomUUID(),time=now();db.prepare('INSERT INTO project_budgets(id,tenant_id,project_id,cost_center,currency,cap_minor,valid_from,valid_until,evidence,prepared_by,approved_by,status,revision,version,created_at,updated_at,cost_center_id) VALUES(?,?,?,?,?,?,?,?,?,?,NULL,\'draft\',1,1,?,?,?)').run(id,u.tenant_id,input.project_id,c,'SAR',f.cap_minor,f.valid_from,f.valid_until,f.evidence,u.id,time,time,resolved.id);snapshot(db,u,get(db,u,id),'create');return getBudget(db,u,id);}
export function budgetAction(db,supplied,id,action,input){
 tx(db);const u=current(db,supplied),b=get(db,u,id);v.object(input,['version',...(['edit','revise'].includes(action)?['cap_amount','valid_from','valid_until','evidence']:['note'])]);v.version(input.version,b.version);if(!actions(db,u,b).includes(action))fail(403,'transition_denied','لا يجيز دورك أو حالة المخصص هذا الإجراء');const time=now();let note='';
 if(['edit','revise'].includes(action)){const f=fields(input);db.prepare("UPDATE project_budgets SET cap_minor=?,valid_from=?,valid_until=?,evidence=?,prepared_by=?,approved_by=NULL,status='draft',revision=revision+?,version=version+1,updated_at=? WHERE id=?").run(f.cap_minor,f.valid_from,f.valid_until,f.evidence,u.id,action==='revise'?1:0,time,id);}
 else {note=v.text(input.note,'دليل إجراء المخصص',3000,3);if(action==='approve'){
 const used=usage(db,id);if(b.cap_minor<used.used_minor)fail(409,'budget_below_commitments','لا يمكن اعتماد سقف أقل من الحجوزات والالتزامات');
 if(db.prepare("SELECT 1 FROM project_budget_reservations r JOIN procurement_purchases p ON p.id=r.purchase_id WHERE r.budget_id=? AND r.status<>'released' AND (p.due_date<? OR p.due_date>?)").get(id,b.valid_from,b.valid_until))fail(409,'budget_date_conflict','الفترة الجديدة تستبعد احتياجًا محجوزًا');
 }
 if(['approve','return','reject'].includes(action))db.prepare('INSERT INTO project_budget_decisions VALUES(?,?,?,?,?,?,?)').run(id,b.revision,u.id,action,JSON.stringify(b),note,time);
 if(action==='close'&&usage(db,id).reserved_minor)fail(409,'reserved_budget','عالج الحجوزات المفتوحة قبل الإقفال');
 const status={submit:'pending',approve:'active',return:'draft',reject:'rejected',close:'closed'}[action];
 db.prepare('UPDATE project_budgets SET status=?,approved_by=?,revision=revision+?,version=version+1,updated_at=? WHERE id=?').run(status,action==='approve'?u.id:b.approved_by,action==='return'?1:0,time,id);
 }
 snapshot(db,u,get(db,u,id),action,note);return getBudget(db,u,id);
}
// مطابقة المخصص بالطلب: بالمعرّف أولًا حين يحمله الطرفان، وبالنصّ المطبَّع حين لا يحمله أحدهما — وهو
// سلوك ما قبل الترحيل 134 بالحرف. الفهرس الفريد project_budgets_center_id يمنع مخصصين لمشروع واحد على
// المركز نفسه، فمطابقة المعرّف لا تختار بين اثنين. وطلبٌ بلا معرّف يسلك الطريق القديم كما كان تمامًا.
function budgetOf(db,p){
  if(p.cost_center_id){
    const byId=db.prepare('SELECT * FROM project_budgets WHERE project_id=? AND tenant_id=? AND cost_center_id=?').get(p.project_id,p.tenant_id,p.cost_center_id);
    if(byId)return byId;
  }
  return db.prepare('SELECT * FROM project_budgets WHERE project_id=? AND tenant_id=? AND cost_center=?').get(p.project_id,p.tenant_id,center(p.cost_center));
}
function usableBudget(db,p){const b=budgetOf(db,p);const today=dateToday();if(!b||b.status!=='active'||today<b.valid_from||today>b.valid_until||p.due_date<b.valid_from||p.due_date>b.valid_until)fail(409,'project_budget_required','يلزم مخصص مشروع معتمد وساري لنفس مركز التكلفة وموعد الاحتياج');const reviewer=db.prepare('SELECT * FROM users WHERE id=? AND tenant_id=? AND active=1').get(b.approved_by,b.tenant_id);if(!reviewer||!hasProjectFinanceAccess(db,reviewer,b.project_id)||!financeCapabilities(db,reviewer).includes('approve'))fail(409,'budget_authority_changed','تغير تفويض معتمد المخصص؛ يلزم تصحيح النطاق ومراجعة المخصص');return b;}
export function reservePurchaseBudget(db,supplied,p,minor){tx(db);const u=current(db,supplied),b=usableBudget(db,p);if(db.prepare('SELECT 1 FROM project_budget_reservations WHERE purchase_id=?').get(p.id))fail(409,'already_reserved','يوجد حجز لهذا الطلب');if(BigInt(usage(db,b.id).used_minor)+BigInt(minor)>BigInt(b.cap_minor))fail(409,'project_budget_exceeded','الترسية تتجاوز المتاح من مخصص المشروع المشترك');const time=now();db.prepare("INSERT INTO project_budget_reservations VALUES(?,?,?,?,'reserved',?,?,?,1)").run(p.id,b.id,b.revision,minor,u.id,time,time);audit(db,u,'project_budget',b.id,'reserve_purchase',{}, {purchase_id:p.id,amount_minor:minor,revision:b.revision});}
export function commitPurchaseBudget(db,supplied,p,minor){tx(db);const u=current(db,supplied),b=usableBudget(db,p),r=db.prepare('SELECT * FROM project_budget_reservations WHERE purchase_id=?').get(p.id);if(!r){reservePurchaseBudget(db,u,p,minor);return commitPurchaseBudget(db,u,p,minor);}if(r.budget_id!==b.id||r.status!=='reserved'||r.amount_minor!==minor)fail(409,'reservation_mismatch','الحجز لا يطابق قيمة الأمر');db.prepare("UPDATE project_budget_reservations SET status='committed',version=version+1,updated_at=? WHERE purchase_id=?").run(now(),p.id);audit(db,u,'project_budget',b.id,'commit_purchase',{}, {purchase_id:p.id,amount_minor:minor});}
export function releasePurchaseBudget(db,supplied,p){tx(db);const r=db.prepare('SELECT * FROM project_budget_reservations WHERE purchase_id=?').get(p.id);if(!r)return;if(r.status!=='reserved')fail(409,'committed_budget','لا يحرر التزام أمر معتمد بإلغاء الاحتياج');db.prepare("UPDATE project_budget_reservations SET status='released',version=version+1,updated_at=? WHERE purchase_id=?").run(now(),p.id);audit(db,current(db,supplied),'project_budget',r.budget_id,'release_purchase',{}, {purchase_id:p.id,amount_minor:r.amount_minor});}
export function purchaseBudgetState(db,p){const r=db.prepare('SELECT budget_id,budget_revision,amount_minor,status FROM project_budget_reservations WHERE purchase_id=?').get(p.id);return r??null;}
// حارس الزيادة: يُقرأ الاستخدام قبل كتابةٍ تستهلك (مطابقة بفرق مقبول، إشعار مدين)، ثم يُسأل بعدها. الرفض حين ترفع الكتابة
// الاستخدام فوق السقف — والمعاملة كلها تُلغى. ما لا يرفع الاستخدام (أو طلب بلا حجز) لا يُسأل عنه.
export function budgetGuard(db,p){
 const r=db.prepare('SELECT budget_id FROM project_budget_reservations WHERE purchase_id=?').get(p.id);if(!r)return ()=>{};
 const b=db.prepare('SELECT * FROM project_budgets WHERE id=?').get(r.budget_id),before=usage(db,b.id).used_minor;
 const riyal=minor=>(minor/100).toFixed(2);
 // allowance: ما يُنتظر رجوعه بإشعار دائن مطلوب (طلب إشعار على الفرق) لا يُحسب زيادةً على المخصص.
 return (what,allowance=0)=>{const after=usage(db,b.id).used_minor-allowance;if(after>before&&after>b.cap_minor)refuse(409,'project_budget_exceeded',{what:`${what}: يرفع استخدام مخصص المشروع إلى ${riyal(after)} ريال فوق سقفه ${riyal(b.cap_minor)} ريال`,
  missing:[{document:'مراجعة سقف مخصص المشروع (revise) واعتمادها من مراجع مستقل',why:'الفرق فوق سعر الأمر يُصرف من مخصص المشروع نفسه، والسقف ما يتسع له',owner:'المالية — معدّ المخصص ومراجعه في نطاق المشروع',owner_role:'finance'}],
  next:'ارفع سقف المخصص بمراجعة معتمدة، أو اطلب من المورد إشعارًا دائنًا بالفرق بدل قبوله'});};
}
// حركة الالتزام في سجل تدقيق المخصص: ما كان للطلب وما صار (ملتزم به، مستهلك، متحرر)، فيُقرأ في سجل المخصص متى استُهلك وتحرر.
export function recordCommitmentMovement(db,supplied,p,action,before){
 const r=db.prepare("SELECT budget_id FROM project_budget_reservations WHERE purchase_id=? AND status='committed'").get(p.id);if(!r||!before)return;
 const after=purchaseCommitment(db,p.id);
 if(after.committed_minor===before.committed_minor&&after.consumed_minor===before.consumed_minor&&after.released_minor===before.released_minor)return;
 audit(db,current(db,supplied),'project_budget',r.budget_id,action,{committed_minor:before.committed_minor,consumed_minor:before.consumed_minor,released_minor:before.released_minor},
  {purchase_id:p.id,committed_minor:after.committed_minor,consumed_minor:after.consumed_minor,released_minor:after.released_minor});
}
export const commitmentOf=(db,purchaseId)=>db.prepare("SELECT 1 FROM project_budget_reservations WHERE purchase_id=? AND status='committed'").get(purchaseId)?purchaseCommitment(db,purchaseId):null;
