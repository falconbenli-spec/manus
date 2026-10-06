import test from 'node:test';
import assert from 'node:assert/strict';
import { openDb, transaction } from '../app/db.mjs';
import { seed } from '../scripts/seed.mjs';
import { homeBoard } from '../app/home.mjs';
import { homeUI } from '../app/static/home-ui.mjs';
import { createRequest, transition, catalog } from '../app/workflow.mjs';

// موجز المالك (30 سبتمبر 2026) البند 2: «تحويل البطاقات إلى قوائم عمل حقيقية — يظهر داخل كل عنصر:
// الحالة، المسؤول، الموعد، المرحلة، والإجراء التالي». الخمسة كانت كلها في حمولة /home ولا تُرسم على الشاشة،
// فكانت البطاقة تقول عنوانًا وعمرًا ولا تقول لمن يفتحها ما عليه أن يفعل ولا متى ولا مع من.
// هذا الاختبار يثبّت الخمسة في الطرفين: أن الخادم يحملها، وأن HTML المرسومة تعرضها.
// ولا يقرأ المصدر بيانات شخص حقيقي: كل ما هنا من البذرة الاصطناعية.

const e=value=>String(value??'').replace(/[&<>"']/g,c=>`&#${c.charCodeAt(0)};`);
const render=data=>homeUI.render(data,{e,tr:(ar)=>ar,lang:'ar'});

function fixture(t){
  const db=openDb(':memory:');seed(db,'synthetic-work-facts');t.after(()=>db.close());
  const users=Object.fromEntries(db.prepare('SELECT * FROM users').all().map(u=>[u.id,u]));
  const service=code=>catalog(db,users.admin).find(s=>s.code===code);
  return {db,users,service};
}

test('بطاقات الرئيسية قوائم عمل: كل بطاقة تقول الحالة والمسؤول والموعد وسنده والمرحلة والإجراء التالي',t=>{
  const {db,users,service}=fixture(t);
  const letter=service('HR-LETTER');
  transaction(db,()=>{
    const created=createRequest(db,users.employee,{service_id:letter.id,title:'طلب خطاب اصطناعي',
      payload:{purpose:'فحص واجهة',recipient:'جهة اصطناعية'}});
    transition(db,users.employee,created.id,'submit',{version:created.version,note:''});
  });

  // (أ) طلبي أنا: «عند من هو الآن» و«ما المنتظر» و«ما أستطيع» من app/request-timeline.nextStep نفسها.
  const mine=homeBoard(db,users.employee);
  const row=mine.my_requests.find(r=>r.title==='طلب خطاب اصطناعي');
  assert.ok(row,'الطلب المقدَّم يظهر في طلباتي المفتوحة');
  assert.ok(row.step,'الصف يحمل خطوته التالية، لا عنوانًا وحالةً فقط');
  assert.match(row.step.with,/\S/,'«عند من» مسمّى لا فارغ');
  assert.match(row.step.awaiting,/قرار اعتماد/,'«ما المنتظر» قرار الاعتماد');
  assert.match(row.step.you_can,/تذكير المعتمد/,'«ما تستطيع» فعلٌ حقيقي لا نصيحة عامة');
  const mineHtml=render(mine);
  assert.match(mineHtml,/<dt>عند<\/dt>/,'الشاشة ترسم «عند»');
  assert.ok(mineHtml.includes(e(row.step.with)),'اسم من عنده الطلب مكتوب في البطاقة');
  assert.match(mineHtml,/<dt>التالي<\/dt>/,'الشاشة ترسم «التالي»');

  // (ب) ما ينتظر قراري: صاحب السجل، وموعده وسنده، والفعل المنتظر، وما يفتحه القرار.
  const manager=homeBoard(db,users.manager);
  const decision=manager.decisions.find(d=>d.source==='requests'&&d.title==='طلب خطاب اصطناعي');
  assert.ok(decision,'الطلب وصل إلى من يقرّر فيه');
  assert.equal(decision.owner_of_record,db.prepare('SELECT name FROM users WHERE id=?').get('employee').name,'المسؤول اسم صاحب الطلب');
  assert.match(String(decision.due_on),/^\d{4}-\d{2}-\d{2}$/,'للموعد تاريخ حقيقي');
  assert.ok(decision.due_basis,'وللموعد سندٌ مسمّى: تاريخٌ بلا سند يُقرأ وعدًا');
  assert.equal(decision.action_text,'قرار على طلب','الفعل المنتظر مكتوب بعينه');
  assert.match(decision.unblocks,/الخطوة التالية|بدء التنفيذ/,'البطاقة تقول ما الذي يفتحه قرارك');
  const managerHtml=render(manager);
  for(const label of ['صاحبه','الموعد','التالي'])assert.match(managerHtml,new RegExp(`<dt>${label}</dt>`),`الشاشة ترسم «${label}»`);
  assert.ok(managerHtml.includes(e(decision.unblocks)),'نص «ما الذي يفتحه القرار» مرسوم لا مطويّ في الحمولة');

  // (ج) ولا صفَّ لحقيقةٍ غائبة: «الموعد: —» أسوأ من غيابه، فلا اسم بلا قيمة.
  assert.equal(/<dt>[^<]*<\/dt><dd><\/dd>/.test(managerHtml),false,'لا زوج باسم وقيمة فارغة');
  assert.equal(/<dd>—<\/dd>/.test(managerHtml),false,'ولا شرطة مكان قيمة غائبة');
});

test('سند الموعد يُسمّى بلغة الشاشة، والزمن الذي لم يتبنّه أحد يُقال معه لا في حاشية تحته',t=>{
  const {db,users,service}=fixture(t);
  const letter=service('HR-LETTER');
  transaction(db,()=>{
    const created=createRequest(db,users.employee,{service_id:letter.id,title:'طلب خطاب ثانٍ',
      payload:{purpose:'فحص السند',recipient:'جهة اصطناعية'}});
    transition(db,users.employee,created.id,'submit',{version:created.version,note:''});
  });
  const manager=homeBoard(db,users.manager);
  const decision=manager.decisions.find(d=>d.title==='طلب خطاب ثانٍ');
  assert.equal(typeof decision.due_adopted,'boolean','العَلَم منطقيّ فيُقرأ في اللغتين — السبب نصٌّ عربيٌّ لا يُترجَم');
  const ar=render(manager);
  const en=homeUI.render(manager,{e,tr:(_ar,eng)=>eng,lang:'en'});
  assert.equal(/محسوب من مهلة الانتظار|الزمن المستهدف لخدمته|موعد السجل نفسه|موعد المهمة/.test(ar),true,'العربية تسمّي السند');
  // الجملة التي بناها الخادم بالعربية تُطوى في الإنجليزية ولا تُقحَم فيها؛ والاسم والتاريخ بيانات تبقى.
  assert.ok(ar.includes(e(decision.unblocks)),'العربية تعرض ما يفتحه القرار');
  assert.equal(en.includes(e(decision.unblocks)),false,'والإنجليزية لا تعرض الجملة العربية نفسها');
  assert.match(en,/<dt>Raised by<\/dt>/,'ويبقى للإنجليزية ما هو بيانات: صاحب السجل');
  assert.match(en,/<dt>Due<\/dt>/,'وموعده');
});
