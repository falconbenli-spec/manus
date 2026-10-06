import test from 'node:test';
import assert from 'node:assert/strict';
import { openDb, transaction, verifyAudit } from '../app/db.mjs';
import { seed } from '../scripts/seed.mjs';
import { grantAccess } from '../app/access.mjs';
import { createClient } from '../app/agency.mjs';
import { contractsRegisterBoard, createContract, updateContract, contractAction, recordAmendment, amendmentAction,
  addObligation, obligationAction, setAlertSettings, contractAlerts } from '../app/contracts-register.mjs';
import { contractsRegisterUI } from '../app/static/contracts-register-ui.mjs';
import { operationFields, money } from '../app/static/operations.mjs';

const code=value=>error=>error.code===value;
const today=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Riyadh'}).format(new Date());
const addDays=(date,n)=>new Date(Date.parse(date+'T00:00:00Z')+n*86400000).toISOString().slice(0,10);

function fixture(t){
  const db=openDb(':memory:');seed(db,'synthetic-contracts-register');t.after(()=>db.close());
  // مدير في الكيان المعزول: يحمل تصريح العرض بحكم دوره، فيثبت أن العزل ليس نتيجة نقص تصريح.
  db.exec("INSERT INTO users(id,tenant_id,department_id,username,name,password_hash,role,manager_id) VALUES('lead-x','isolated','other','lead-x','مدير الكيان المعزول','unused','manager',NULL)");
  const users=Object.fromEntries(db.prepare('SELECT * FROM users').all().map(u=>[u.id,u])),tx=f=>transaction(db,f);
  tx(()=>grantAccess(db,users.admin,{user_id:'it',capability:'contracts.register.manage',department_id:null,note:'أمين سجل العقود التجريبي'}));
  const clientId=tx(()=>createClient(db,users.manager,{legal_name:'شركة العميل التجريبية للتجارة',trade_name:'العميل التجريبي',sector:'تجزئة',status:'active'})).id;
  db.exec(`INSERT INTO vendors(id,tenant_id,code,supplier_key,legal_name,entity_type,country,categories,data_source,status,registered_by,created_at,updated_at)
    VALUES('vendor-1','36t','V-0001','VENDOR1','مزود البرمجيات التجريبي','company','SA','["software"]','إدخال تجريبي','approved','it','2026-01-01T00:00:00Z','2026-01-01T00:00:00Z')`);
  const base=(over={})=>({party_kind:'client',client_id:clientId,vendor_id:null,party_name:'',contract_type:'master_services',
    subject:'اتفاقية إطارية لخدمات تسويقية تجريبية',start_date:addDays(today(),-30),end_date:addDays(today(),300),value:'120000.00',
    auto_renew:false,notice_days:null,renewal_note:'',scope_baseline_id:null,owner_id:'manager',
    original_location:'خزانة العقود — ملف تجريبي رقم 1',signed_for_company:'مدير الفريق التجريبي',signed_for_party:'ممثل العميل التجريبي',
    signed_on:addDays(today(),-31),...over});
  const view=(who,id)=>contractsRegisterBoard(db,users[who]).contracts.find(c=>c.id===id);
  const activate=(id,note='أقر بملكية هذا العقد ومطابقة بياناته للأصل الموقّع')=>tx(()=>contractAction(db,users.manager,id,'activate_contract',{version:view('manager',id).version,note}));
  return {db,users,tx,clientId,base,view,activate};
}

test('contracts register: the recorder is never the owner, a contract in force is amended by a numbered annex and never edited, and the annex only bites once its named approver confirms it',t=>{
  const {db,users,tx,base,view,activate}=fixture(t);
  assert.throws(()=>tx(()=>createContract(db,users.manager,base())),code('not_permitted'),'registering needs the register capability, not a seat at the table');
  assert.throws(()=>tx(()=>createContract(db,users.it,base({owner_id:'it'}))),code('separation_of_duties'));
  assert.throws(()=>tx(()=>createContract(db,users.it,base({auto_renew:true,notice_days:null}))),code('notice_days'),'auto renewal without a known notice period is a trap, not a record');
  assert.throws(()=>tx(()=>createContract(db,users.it,base({end_date:addDays(today(),-60)}))),code('end_date'));

  const contractId=tx(()=>createContract(db,users.it,base({signed_on:''}))).id;
  assert.throws(()=>contractsRegisterBoard(db,users.outsider),code('not_permitted'),'a contract register is not open reading');
  assert.equal(contractsRegisterBoard(db,users['lead-x']).contracts.length,0,'another tenant sees nothing, capability or not');
  assert.equal(view('manager',contractId).state,'draft');
  assert.throws(()=>tx(()=>contractAction(db,users.it,contractId,'activate_contract',{version:1,note:'من سجّل العقد يقرّ سريانه'})),code('action_unavailable'));
  assert.throws(()=>tx(()=>contractAction(db,users.manager,contractId,'activate_contract',{version:1,note:'أقر بملكية هذا العقد قبل توثيق توقيعه'})),code('signature_missing'));

  tx(()=>updateContract(db,users.it,contractId,{...base({signed_on:addDays(today(),-31)}),version:view('it',contractId).version}));
  assert.throws(()=>tx(()=>updateContract(db,users.it,contractId,{...base(),version:99})),code('stale_version'));
  activate(contractId);
  const active=view('manager',contractId);
  assert.equal(active.state,'in_force');assert.equal(active.activated_by_name,users.manager.name);assert.equal(active.effective_value_minor,12000000);

  assert.throws(()=>tx(()=>updateContract(db,users.it,contractId,{...base(),version:active.version})),code('contract_in_force'));
  assert.throws(()=>db.prepare("UPDATE contract_records SET subject='تعديل صامت',version=version+1 WHERE id=?").run(contractId),/amended by a numbered annex/);

  assert.throws(()=>tx(()=>recordAmendment(db,users.it,contractId,{signed_on:today(),subject:'تمديد المدة وزيادة القيمة',value_delta:'10000.00',new_end_date:addDays(today(),400),original_location:'خزانة العقود — ملحق 1',approved_by:'it'})),code('separation_of_duties'));
  assert.throws(()=>tx(()=>recordAmendment(db,users.it,contractId,{signed_on:today(),subject:'تمديد المدة',value_delta:'',new_end_date:addDays(today(),100),original_location:'خزانة العقود — ملحق 1',approved_by:'manager'})),code('new_end_date'),'an annex that shortens nothing and extends nothing has no effect on the term');
  const amendmentId=tx(()=>recordAmendment(db,users.it,contractId,{signed_on:today(),subject:'تمديد المدة مئة يوم وزيادة القيمة',value_delta:'10000.00',new_end_date:addDays(today(),400),original_location:'خزانة العقود — ملحق 1',approved_by:'manager'})).id;
  const recorded=view('manager',contractId);
  assert.equal(recorded.effective_value_minor,12000000,'an annex changes nothing before its approver confirms it');
  assert.equal(recorded.effective_end_date,addDays(today(),300));
  assert.throws(()=>tx(()=>amendmentAction(db,users.it,amendmentId,'confirm_amendment',{note:'من سجّل الملحق يؤكده بنفسه'})),code('not_found'));

  tx(()=>amendmentAction(db,users.manager,amendmentId,'confirm_amendment',{note:'اطلعت على أصل الملحق الموقّع وأعتمد أثره'}));
  const amended=view('manager',contractId);
  assert.equal(amended.effective_value_minor,13000000);assert.equal(amended.effective_end_date,addDays(today(),400));
  assert.equal(amended.end_date,addDays(today(),300),'the signed term stays as signed; the annex carries the change');
  assert.throws(()=>tx(()=>amendmentAction(db,users.manager,amendmentId,'confirm_amendment',{note:'تأكيد مكرر للملحق نفسه'})),code('not_found'));
  assert.throws(()=>db.prepare("UPDATE contract_amendments SET value_delta_minor=1 WHERE id=?").run(amendmentId),/confirmed once and never rewritten/);
  assert.ok(verifyAudit(db));
});

test('contracts register: no alert exists until the owner enters the lead times, and the non-renewal notice deadline outranks the expiry date',t=>{
  const {db,users,tx,base,view,activate}=fixture(t);
  const renewing=tx(()=>createContract(db,users.it,base({end_date:addDays(today(),40),auto_renew:true,notice_days:30,renewal_note:'يتجدد سنويًا ما لم يُشعر أحد الطرفين قبل ثلاثين يومًا'}))).id;
  const ending=tx(()=>createContract(db,users.it,base({party_kind:'vendor',client_id:null,vendor_id:'vendor-1',contract_type:'software_license',
    subject:'ترخيص أداة تصميم تجريبية',end_date:addDays(today(),5),value:'9000.00',original_location:'خزانة العقود — ملف تجريبي 2'}))).id;
  activate(renewing);activate(ending);

  assert.equal(view('manager',renewing).alert,null,'the platform does not invent a lead time');
  const quiet=contractAlerts(db,users.manager);
  assert.equal(quiet.alerts_configured,false);assert.deepEqual(quiet.contracts,[]);assert.match(quiet.note,/لم تُضبط مهل التنبيه/);
  assert.throws(()=>tx(()=>setAlertSettings(db,users.manager,{expiry_lead_days:10,notice_lead_days:14,obligation_lead_days:7,basis:'قرار المالك المصطنع',version:null})),code('not_permitted'));
  assert.throws(()=>tx(()=>setAlertSettings(db,users.it,{expiry_lead_days:0,notice_lead_days:14,obligation_lead_days:7,basis:'مهلة صفرية غير مقبولة',version:null})),code('expiry_lead_days'));
  tx(()=>setAlertSettings(db,users.it,{expiry_lead_days:10,notice_lead_days:14,obligation_lead_days:7,basis:'أقرها مالك الشركة في اجتماع التشغيل المصطنع بتاريخ اليوم',version:null}));

  const notice=view('manager',renewing).alert,expiry=view('manager',ending).alert;
  assert.equal(notice.kind,'notice_due');assert.equal(notice.due_date,addDays(today(),10));
  assert.equal(expiry.kind,'expiry');
  assert.ok(notice.priority<expiry.priority,'missing the notice date renews the contract against the company; an expiry can still be handled');
  const alerts=contractAlerts(db,users.manager);
  assert.equal(alerts.contracts[0].id,renewing,'the notice deadline comes first in the decisions box');
  for(const item of alerts.contracts)assert.ok(item.id&&item.title&&item.created_at&&item.actions.length,'every row carries what the decisions box reads');

  assert.throws(()=>tx(()=>contractAction(db,users.manager,renewing,'decide_renewal',{decision:'do_not_renew',notice_reference:'',note:'قررنا عدم التجديد ولم نرسل شيئًا'})),code('notice_reference'),'the platform sends no notice: without its reference the decision is empty');
  assert.throws(()=>tx(()=>contractAction(db,users.employee,renewing,'decide_renewal',{decision:'renew',notice_reference:'',note:'قرار من غير مالك العقد'})),code('not_permitted'));
  tx(()=>contractAction(db,users.manager,renewing,'decide_renewal',{decision:'do_not_renew',notice_reference:'خطاب تجريبي رقم 12 بتاريخ اليوم',note:'قررنا عدم التجديد وأرسلنا الإشعار بالبريد المسجل'}));
  assert.equal(view('manager',renewing).alert,null,'a recorded decision closes the alert');
  assert.throws(()=>tx(()=>contractAction(db,users.manager,renewing,'decide_renewal',{decision:'renew',notice_reference:'',note:'قرار ثانٍ لنفس الدورة'})),code('action_unavailable'));

  // مهلة إشعار فاتت: العقد يتجدد رغمًا عن الشركة، والتنبيه يبقى أعلى أولوية حتى يُسجَّل قرار.
  const missed=tx(()=>createContract(db,users.it,base({start_date:addDays(today(),-300),end_date:addDays(today(),10),auto_renew:true,notice_days:30,
    original_location:'خزانة العقود — ملف تجريبي 3'}))).id;
  activate(missed);
  const late=view('manager',missed).alert;
  assert.equal(late.kind,'notice_missed');assert.equal(late.priority,1);
  assert.equal(contractAlerts(db,users.manager).contracts[0].id,missed);
  assert.ok(verifyAudit(db));
});

test('contract obligations are entered by a human clause by clause, and the evidence is verified by someone other than whoever completed it',t=>{
  const {db,users,tx,base,view,activate}=fixture(t);
  const contractId=tx(()=>createContract(db,users.it,base())).id;
  activate(contractId);
  tx(()=>setAlertSettings(db,users.it,{expiry_lead_days:10,notice_lead_days:14,obligation_lead_days:7,basis:'أقرها مالك الشركة في اجتماع التشغيل المصطنع',version:null}));

  const obligation={category:'report',title:'تقرير أداء ربعي للعميل',clause_reference:'6/2',detail:'يلتزم الطرف الأول بتقرير أداء ربعي',
    owner_id:'employee',cadence:'quarterly',first_due_date:addDays(today(),-1),evidence_expected:'رابط التقرير المرسل وتاريخ إرساله'};
  assert.throws(()=>tx(()=>addObligation(db,users.manager,contractId,obligation)),code('not_permitted'));
  assert.throws(()=>tx(()=>addObligation(db,users.it,contractId,{...obligation,first_due_date:addDays(today(),400)})),code('first_due_date'));
  const obligationId=tx(()=>addObligation(db,users.it,contractId,obligation)).id;
  assert.throws(()=>tx(()=>addObligation(db,users.it,contractId,obligation)),code('duplicate_obligation'));
  assert.throws(()=>db.prepare(`INSERT INTO contract_obligations(id,tenant_id,contract_id,category,title,clause_reference,owner_id,cadence,first_due_date,evidence_expected,extraction,entered_by,created_at,updated_at)
    SELECT 'auto-1',tenant_id,contract_id,category,'بند مستخرج آليًا من نص العقد',clause_reference,owner_id,cadence,first_due_date,evidence_expected,'auto',entered_by,created_at,updated_at FROM contract_obligations WHERE id=?`).run(obligationId),
    /CHECK|constraint/i,'nothing but a human reading the clause can put an obligation in this register');

  const read=who=>contractsRegisterBoard(db,users[who]).contracts.find(c=>c.id===contractId).obligations.find(o=>o.id===obligationId);
  assert.equal(read('employee').state,'overdue','the owner of a clause reaches the register even without the reading capability');
  assert.equal(read('manager').entered_by_name,users.it.name);
  assert.deepEqual(contractAlerts(db,users.employee).obligations.map(o=>o.actions[0]),['complete_obligation']);

  assert.throws(()=>tx(()=>obligationAction(db,users.manager,obligationId,'complete_obligation',{evidence_reference:'مرجع تجريبي من غير المالك'})),code('invalid_state'));
  tx(()=>obligationAction(db,users.employee,obligationId,'complete_obligation',{evidence_reference:'أُرسل التقرير التجريبي بالبريد ومحفوظ في مجلد العميل'}));
  assert.throws(()=>tx(()=>obligationAction(db,users.employee,obligationId,'verify_obligation',{note:'أتحقق من دليلي بنفسي'})),code('invalid_state'));
  assert.deepEqual(contractAlerts(db,users.manager).obligations.map(o=>o.actions[0]),['verify_obligation']);
  tx(()=>obligationAction(db,users.manager,obligationId,'verify_obligation',{note:'اطلعت على التقرير المرسل وتاريخ إرساله'}));

  const verified=read('manager');
  assert.equal(verified.fulfilments[0].verified_by_name,users.manager.name);
  assert.ok(verified.occurrences>1&&verified.current_due_date>verified.fulfilments[0].period,'documenting one quarter opens the next, it does not close the clause');
  assert.equal(verified.state,'scheduled');
  assert.throws(()=>db.prepare("UPDATE contract_obligation_fulfilments SET evidence_reference='دليل آخر' WHERE obligation_id=?").run(obligationId),/verified once and never rewritten/);
  assert.throws(()=>tx(()=>obligationAction(db,users.it,obligationId,'deactivate_obligation',{version:99,note:'إيقاف بنسخة قديمة'})),code('stale_version'));
  tx(()=>obligationAction(db,users.it,obligationId,'deactivate_obligation',{version:verified.version,note:'البند انتهى بانتهاء مرحلة المشروع التجريبية'}));
  assert.equal(read('manager').active,false);
  assert.ok(verifyAudit(db));
});

// ترسم الشاشة لكل دور من بيانات الخادم نفسها، ويُفتح نموذج كل زر عرضته: يلتقط هذا حقلًا مفقودًا في الحمولة أو نموذجًا يرمي عند فتحه.
const escape=value=>String(value??'').replace(/[&<>"']/g,c=>`&#${c.charCodeAt(0)};`);
test('the contracts register screen renders for every role that reaches it and every button it offers opens a valid form',t=>{
  const {db,users,tx,base,view,activate}=fixture(t);
  const contractId=tx(()=>createContract(db,users.it,base({auto_renew:true,notice_days:30,end_date:addDays(today(),40),renewal_note:'يتجدد سنويًا ما لم يُشعر أحد الطرفين'}))).id;
  activate(contractId);
  tx(()=>setAlertSettings(db,users.it,{expiry_lead_days:10,notice_lead_days:14,obligation_lead_days:7,basis:'أقرها مالك الشركة في اجتماع التشغيل المصطنع',version:null}));
  tx(()=>addObligation(db,users.it,contractId,{category:'insurance',title:'شهادة تأمين سارية طوال المدة',clause_reference:'9/1',detail:'',
    owner_id:'employee',cadence:'yearly',first_due_date:addDays(today(),3),evidence_expected:'صورة الوثيقة السارية ومكان حفظها'}));
  tx(()=>recordAmendment(db,users.it,contractId,{signed_on:today(),subject:'زيادة نطاق العمل وقيمته',value_delta:'5000.00',new_end_date:'',
    original_location:'خزانة العقود — ملحق تجريبي',approved_by:'manager'}));
  const draftId=tx(()=>createContract(db,users.it,base({subject:'عقد مستقل تجريبي لكتابة المحتوى',party_kind:'freelancer',client_id:null,party_name:'كاتب محتوى تجريبي',
    original_location:'خزانة العقود — ملف تجريبي 9'}))).id;
  assert.equal(view('it',draftId).state,'draft');

  const problems=[];let screens=0,forms=0;
  for(const who of ['it','manager','employee']){
    const data=contractsRegisterBoard(db,users[who]),buttons=[];
    const button=(action,id,label)=>{buttons.push([action,id]);return `<button>${escape(label)}</button>`;};
    const html=contractsRegisterUI.render(data,{e:escape,button,money});screens++;
    const text=html.replace(/<[^>]+>/g,' ');
    if(/\bundefined\b|\bNaN\b|\[object /.test(text))problems.push(`${who}: rendered text contains ${text.match(/\bundefined\b|\bNaN\b|\[object /)[0]}`);
    if(/ style="| <script/i.test(html))problems.push(`${who}: inline style or script breaks the content security policy`);
    for(const [action,id] of buttons){
      try{
        const spec=contractsRegisterUI.form(action,id,data);forms++;
        if(!spec||typeof spec.title!=='string'||!Array.isArray(spec.fields)||typeof spec.toPayload!=='function'||!spec.endpoint)problems.push(`${who}/${action}: incomplete form spec`);
        else if(/\bundefined\b/.test(spec.title+operationFields(spec.fields,escape).replace(/<[^>]+>/g,' ')))problems.push(`${who}/${action}: form shows undefined`);
      }catch(error){problems.push(`${who}/${action}: form ${error.message}`);}
    }
  }
  assert.deepEqual(problems,[]);
  assert.equal(screens,3);assert.ok(forms>10,`opened ${forms} forms`);
  assert.throws(()=>contractsRegisterUI.form('activate_contract',draftId,contractsRegisterBoard(db,users.employee)),/غير متاح/,'a form never opens for an action the board did not offer');
});
