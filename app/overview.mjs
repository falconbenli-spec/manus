import { listCommercial } from './commercial.mjs';
import { listProcurement } from './procurement.mjs';
import { listLeave } from './leave.mjs';
import { listRequests } from './workflow.mjs';
import { currentUser } from './delegations.mjs';
import { fail } from './auth.mjs';
import { listPeople } from './people.mjs';
import { listStudio } from './studio.mjs';
import { financeCapabilities,listFinance } from './finance.mjs';

export function overview(db,user){
  const u=currentUser(db,user);if(!u)fail(403,'inactive','الحساب غير نشط');
  if(u.role==='admin')return {decisions:[],totals:{requests:0,commercial:0,procurement:0,leave:0}};
  const requests=listRequests(db,u),commercial=listCommercial(db,u),procurement=listProcurement(db,u),leave=listLeave(db,u).requests;
  const people=listPeople(db,u),studio=['employee','manager','pm'].includes(u.role)?listStudio(db,u):[],finance=financeCapabilities(db,u).includes('read')?listFinance(db,u).journals:[];
  const decisions=[
    ...requests.filter(r=>r.needs_me).map(r=>({id:r.id,title:r.title,area:'الطلبات الداخلية',route:`request/${r.id}`})),
    ...commercial.filter(r=>r.allowed_actions.some(a=>a.startsWith('approve_')||a==='accept_delivery')).map(r=>({id:r.id,title:r.name,area:'المبيعات والتسليم',route:'commercial'})),
    ...procurement.filter(r=>(r.allowed_actions.includes('award')&&r.quotes.length>=2)||r.allowed_actions.includes('approve_order')||(r.allowed_actions.includes('match')&&r.invoices.some(i=>i.recorded_by!==u.id&&!r.payables.some(p=>p.invoice_id===i.id)))).map(r=>({id:r.id,title:r.title,area:'المشتريات',route:'procurement'})),
    ...leave.filter(r=>r.actions.includes('approve')).map(r=>({id:r.id,title:`إجازة ${r.employee_name} · ${r.start_date}`,area:'الإجازات',route:'leave'})),
    ...[...people.requisitions,...people.candidates].filter(r=>r.actions.some(a=>['approve_need','approve_offer','evaluate'].includes(a))).map(r=>({id:r.id,title:r.title||r.requisition_title,area:'التوظيف',route:'people'})),
    ...studio.filter(r=>r.allowed_actions.some(a=>a.startsWith('approve_')||a==='accept_package')).map(r=>({id:r.id,title:r.title,area:'الاستوديو',route:'studio'})),
    ...finance.filter(r=>r.allowed_actions.some(a=>['approve','post'].includes(a))).map(r=>({id:r.id,title:r.description,area:'المالية',route:'finance'}))
  ];
  return {decisions,onboarding_tasks:people.tasks.filter(t=>t.owner_id===u.id&&t.status!=='completed').map(t=>({id:t.id,title:t.title,due_date:t.due_date,route:'people'})),totals:{requests:requests.length,commercial:commercial.length,procurement:procurement.length,leave:leave.length,people:people.requisitions.length,studio:studio.length,finance:finance.length}};
}
