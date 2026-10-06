import { openDb, transaction } from '../app/db.mjs';
import { seed } from '../scripts/seed.mjs';
import { createRequest, transition, catalog } from '../app/workflow.mjs';
import { grantAccess } from '../app/access.mjs';
import { closeWithEvidence } from '../app/request-closure.mjs';

// مساعد اختبارات request-transparency: كل البيانات مصطنعة من seed التجريبي، على قاعدة بالذاكرة فقط.
export const code=value=>error=>error.code===value;
export const DELIVERED='تجريبي: أُعيد ضبط حساب البريد وجُرّب الدخول مع صاحبة الطلب بنجاح';
const PAYLOADS={'IT-SUPPORT':{issue:'تجريبي: تعذر الدخول إلى البريد',impact:'يؤخر العمل'},'HR-LETTER':{purpose:'تجريبي: خطاب تعريف',recipient:'جهة تجريبية'},
  'CREATIVE-BRIEF':{objective:'تجريبي: هدف التكليف',deliverable:'تجريبي: تصميم واحد',due_date:'2099-01-05'}};

export function fixture(t,name){
  const db=openDb(':memory:');seed(db,`synthetic-${name}`);t.after(()=>db.close());
  const users=Object.fromEntries(db.prepare('SELECT * FROM users').all().map(u=>[u.id,u])),tx=f=>transaction(db,f);
  const version=id=>db.prepare('SELECT version FROM requests WHERE id=?').get(id).version;
  const act=(user,id,action,note='')=>tx(()=>transition(db,users[user],id,action,{version:version(id),note}));
  const draft=(service='IT-SUPPORT',requester='employee',payload=PAYLOADS[service])=>tx(()=>createRequest(db,users[requester],
    {service_id:catalog(db,users[requester]).find(s=>s.code===service).id,title:`تجريبي: طلب ${service}`,payload})).id;
  const submitted=(service,requester)=>{const id=draft(service,requester);act(requester??'employee',id,'submit');return id;};
  // IT-SUPPORT: اعتماد المدير ثم مباشرة منفذ الدعم. يعيد طلبًا قيد التنفيذ جاهزًا للإغلاق.
  const inProgress=(requester='employee')=>{const id=submitted('IT-SUPPORT',requester);act('manager',id,'approve','تجريبي: موافق');act('it',id,'claim');return id;};
  const closed=requester=>{const id=inProgress(requester);tx(()=>closeWithEvidence(db,users.it,id,{version:version(id),delivered:DELIVERED}));return id;};
  const grantInsight=user=>tx(()=>grantAccess(db,users.admin,{user_id:user,capability:'executive.view',department_id:'',note:'تجريبي: منح لوحة القياس للاختبار'}));
  return {db,users,tx,version,act,draft,submitted,inProgress,closed,grantInsight};
}
