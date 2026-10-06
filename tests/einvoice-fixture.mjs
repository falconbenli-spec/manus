import { randomUUID } from 'node:crypto';
import { openDb,transaction,now } from '../app/db.mjs';
import { seed } from '../scripts/seed.mjs';
import { createLead,commercialAction } from '../app/commercial.mjs';
import { createClaim,claimAction } from '../app/receivables.mjs';
// منذ الترحيل 182: الصفقة من ملف عميل، والعرض على عرض سعر العميل المقبول، والقبول يسمّي ممثل العميل المفوّض.
import { dealFor, boundQuote, approverFor, scheduleFor } from './proposal-fixture.mjs';
import { getInvoice,recordCompanyProfile,approveCompanyProfile,recordCustomerProfile,prepareInvoice,invoiceAction } from '../app/invoices.mjs';
import { EInvoiceGateway,setGateway,einvoiceBoard,assignChannel,attemptSubmission } from '../app/einvoice-gateway.mjs';

export const code=value=>error=>error.code===value;
export const address={building:'1234',street:'طريق مصطنع',district:'حي الاختبار',city:'الرياض',postal_code:'12345',country:'SA'};
// بيانات مصطنعة كلها «تجريبي»: عميل وعقد ببندين واستحقاقان، ثم فواتير تصدر عبر دورة الفاتورة القائمة دون تعديلها.
export function fixture(t,{buyerVat='310000000000003'}={}){
  const db=openDb(':memory:');seed(db,'synthetic-einvoice-gateway');t.after(()=>{setGateway(null);db.close();});
  const users=Object.fromEntries(db.prepare('SELECT id,tenant_id,department_id,role,manager_id FROM users').all().map(u=>[u.id,u]));
  for(const [who,actions] of [['employee',['read','prepare']],['manager',['read','approve']]])for(const action of actions)db.prepare('INSERT INTO finance_grants VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(randomUUID(),'36t',who,users[who].role,action,'2026-01-01T00:00:00.000Z','2099-01-01T00:00:00.000Z','admin','تفويض فوترة تجريبي',null,now());
  for(const [who,tenant] of [['employee','36t'],['manager','36t'],['external','isolated']])db.prepare('INSERT INTO access_grants(id,tenant_id,user_id,capability,note,granted_by,granted_at) VALUES(?,?,?,?,?,?,?)').run(randomUUID(),tenant,who,'einvoice.manage','منح تجريبي','admin',now());
  const act=(who,c,action,input={})=>transaction(db,()=>commercialAction(db,users[who],c.id,action,{version:c.version,...input}));
  let c=transaction(db,()=>dealFor(db,users.employee,{name:'عميل فوترة إلكترونية تجريبي',registration_number:'EINV-100',contact:'جهة تجريبية',source:'اختبار',sector:'تجريبي'}));
  c=act('employee',c,'qualify',{need:'مخرج تجريبي للفوترة',budget:'1000.00',currency:'SAR',timing:'2099-12-01',decision_maker:'ممثل عميل',service_fit:'مناسب للاختبار'});
  c=act('manager',c,'approve_qualification',{note:'تأهيل معتمد للاختبار'});
  const line=(description,price)=>({description,quantity:'1',unit_price:price,unit_cost:'5.00',discount:'0',tax_rate:'15',acceptance:'قبول المخرج بدليل',revisions:1});
  c=act('employee',c,'save_quote',boundQuote(db,c.id,{scope:'مخرجان تجريبيان',currency:'SAR',valid_until:'2099-12-01',lines:[line('حملة إطلاق تجريبية','100.00'),line('تقرير ختامي تجريبي','200.00')]}));
  c=act('employee',c,'submit_quote');c=act('manager',c,'approve_quote',{note:'عرض معتمد'});c=act('employee',c,'register_contract',{agreement_evidence:'اتفاق داخلي تجريبي موثق للاختبار',customer_representative:'ممثل تجريبي'});scheduleFor(db,c.id);c=act('manager',c,'create_project',{member_ids:[]});
  const claimFor=(lineIndex,amount)=>{
    c=act('employee',c,'submit_delivery',{line_index:lineIndex,evidence:'مرجع تسليم تجريبي للبند '+lineIndex});
    const delivery=c.deliveries.at(-1);
    c=act('manager',c,'accept_delivery',{delivery_id:delivery.id,note:'مطابق لمعيار القبول',acceptance_evidence:'مرجع قبول داخلي تجريبي',approver_id: approverFor(db, c.project_id)});
    let claim=transaction(db,()=>createClaim(db,users.employee,{delivery_id:delivery.id,amount,due_date:'2099-12-15',entitlement_evidence:'العقد والقبول يدعمان الاستحقاق التجريبي'}));
    claim=transaction(db,()=>claimAction(db,users.employee,claim.id,'submit',{version:claim.version}));
    return transaction(db,()=>claimAction(db,users.manager,claim.id,'approve',{version:claim.version,note:'استحقاق معتمد للاختبار'}));
  };
  const {id:sellerId}=transaction(db,()=>recordCompanyProfile(db,users.employee,{legal_name:'شركة 3,6T التجريبية',vat_number:'300000000000003',cr_number:'1010000001',address,effective_from:'2026-01-01'}));
  transaction(db,()=>approveCompanyProfile(db,users.manager,sellerId,{note:'طابقنا الشهادة الضريبية التجريبية'}));
  transaction(db,()=>recordCustomerProfile(db,users.employee,{case_id:c.id,legal_name:'شركة العميل التجريبية',vat_number:buyerVat,address,source:'شهادة ضريبية تجريبية أرسلها العميل'}));
  const step=(who,doc,action,input={})=>transaction(db,()=>invoiceAction(db,users[who],doc.id,action,{version:doc.version,...input}));
  const pending=claim=>step('employee',getInvoice(db,users.employee,transaction(db,()=>prepareInvoice(db,users.employee,{claim_id:claim.id,supply_date:'2026-09-01',vat_category:'standard'})).id),'submit');
  const issue=claim=>step('manager',pending(claim),'issue');
  const submissionOf=doc=>einvoiceBoard(db,users.manager).submissions.find(s=>s.document_id===doc.id);
  const channel=(doc,who='employee',key='clearance')=>{const s=submissionOf(doc);return transaction(db,()=>assignChannel(db,users[who],s.id,{version:s.version,channel:key,reason:'فاتورة لمنشأة مسجلة بحسب تصنيف المختص التجريبي'}));};
  const attempt=(s,who='manager')=>attemptSubmission(db,users[who],s.id,{version:s.version,note:'محاولة تجريبية للتحقق من سلوك الطابور'},transaction);
  return {db,users,claimFor,pending,issue,step,submissionOf,channel,attempt,caseId:()=>c.id};
}
// مزوّد اختبار: يرد بما في الطابور بالترتيب، ولا يتصل بشيء.
export class ScriptedGateway extends EInvoiceGateway{
  constructor(replies){super('scripted-test');this.replies=[...replies];this.calls=[];}
  next(operation,argument){this.calls.push({operation,argument});const reply=this.replies.shift();if(reply instanceof Error)throw reply;return reply;}
  async submitForClearance(document){return this.next('submitForClearance',document);}
  async reportSimplified(document){return this.next('reportSimplified',document);}
  async statusOf(reference){return this.next('statusOf',reference);}
}

