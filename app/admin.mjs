import { randomBytes } from 'node:crypto';
import { audit, now } from './db.mjs';
import { fail, passwordHash, passwordPolicy } from './auth.mjs';
import * as v from './validation.mjs';
import { returnDepartedWork } from './request-assignment.mjs';

// Account administration for a tenant. Admins manage identities and routing; they still cannot read other people's transactions.
const roles=['employee','manager','hr','it','pm'];
const routingRoles=['department_manager','hr','it','pm'];
const usernamePattern=/^[a-z0-9][a-z0-9._-]{2,39}$/;
const departmentPattern=/^[a-z][a-z0-9-]{1,39}$/;
function requireAdmin(db,u){
  const current=db.prepare("SELECT * FROM users WHERE id=? AND tenant_id=? AND active=1 AND role='admin'").get(u?.id,u?.tenant_id);
  if(!current)fail(403,'forbidden','إدارة الحسابات لمسؤول المنصة وبس');
  return current;
}
const department=(db,u,id)=>{const d=db.prepare('SELECT * FROM departments WHERE id=? AND tenant_id=? AND active=1').get(id,u.tenant_id);if(!d)fail(400,'department','ما لقينا الإدارة، ولا هي مؤرشفة');return d;};
function checkManager(db,u,managerId,departmentId,selfId){
  if(managerId===null||managerId===undefined||managerId==='')return null;
  if(managerId===selfId)fail(400,'manager','ما ينفع الموظف يكون مدير نفسه');
  const m=db.prepare("SELECT * FROM users WHERE id=? AND tenant_id=? AND active=1 AND role='manager'").get(managerId,u.tenant_id);
  if(!m)fail(400,'manager','المدير المباشر لازم يكون حساب نشط ودوره مدير');
  if(m.department_id!==departmentId)fail(400,'manager','المدير المباشر لازم يكون من نفس الإدارة عشان يمشي مسار الاعتماد');
  let cursor=m,guard=0;
  while(cursor?.manager_id&&guard++<50){if(cursor.manager_id===selfId)fail(400,'manager','التسلسل الإداري يطلع حلقة تدور على نفسها');cursor=db.prepare('SELECT id,manager_id FROM users WHERE id=?').get(cursor.manager_id);}
  return m.id;
}
const accountView=r=>({id:r.id,username:r.username,name:r.name,role:r.role,department_id:r.department_id,manager_id:r.manager_id,active:!!r.active,must_change_password:!!r.must_change_password});

// إعادة اشتقاق مستوى الإدارة بعد تغيير الدور (ترحيل 130). يُكتب assigned_by=NULL لأن الصف الجديد مشتقٌّ من
// الدور لا قرارُ شخص — فتقول المصفوفة عنه «مشتق من دوره» بالحقيقة لا بالادعاء. حساب إدارة المنصة بلا مستوى
// إدارة فيُحذف صفه. وقاعدة «لا يُقرأ جدول من جداول 130 والمفتاح مطفأ» محفوظة: هذه كتابةٌ في مسار إداري
// لا قراءةٌ في مسار قرار، وأثرها صفر ما دام المفتاح مطفأً. الجدول قد لا يكون موجودًا على قاعدة أُوقفت عند
// ترحيل أقدم، وغيابه وحده يُتجاوَز كما يتجاوزه access.levelsEnabled — وما سواه يُرفع.
function rederiveLevel(db,actor,userId,previousRole,nextRole){
  const target=db.prepare('SELECT id,tenant_id,role FROM users WHERE id=?').get(userId);
  const level=nextRole==='admin'?null:nextRole==='manager'?'department_manager':'employee';
  try{
    const before=db.prepare('SELECT level FROM user_permission_levels WHERE tenant_id=? AND user_id=?').get(target.tenant_id,userId)?.level??null;
    if(before===level)return;
    if(level===null)db.prepare('DELETE FROM user_permission_levels WHERE tenant_id=? AND user_id=?').run(target.tenant_id,userId);
    else db.prepare(`INSERT INTO user_permission_levels(tenant_id,user_id,level,assigned_by,assigned_at) VALUES(?,?,?,NULL,?)
      ON CONFLICT(tenant_id,user_id) DO UPDATE SET level=excluded.level,assigned_by=NULL,assigned_at=excluded.assigned_at`).run(target.tenant_id,userId,level,now());
    audit(db,actor,'access',userId,'access.level_rederived',{level:before,role:previousRole},{level,role:nextRole},'تغيّر دور الحساب، فأُعيد اشتقاق مستوى إدارته من الدور الجديد');
  }catch(error){
    if(db.prepare("SELECT 1 FROM sqlite_schema WHERE type='table' AND name='user_permission_levels'").get())throw error;
  }
}

export function adminDirectory(db,supplied){
  const u=requireAdmin(db,supplied);
  const users=db.prepare('SELECT * FROM users WHERE tenant_id=? ORDER BY active DESC,department_id,name').all(u.tenant_id).map(accountView);
  const departments=db.prepare('SELECT id,name,sector,active FROM departments WHERE tenant_id=? ORDER BY active DESC,sector,name').all(u.tenant_id).map(d=>({...d,active:!!d.active,members:users.filter(x=>x.department_id===d.id&&x.active).length,managers:users.filter(x=>x.department_id===d.id&&x.active&&x.role==='manager').length}));
  const routing=db.prepare('SELECT department_id,step_role,user_id FROM department_routing WHERE tenant_id=?').all(u.tenant_id);
  const services=db.prepare('SELECT department_id,approval_policy FROM services s WHERE tenant_id=? AND active=1 AND version=(SELECT MAX(version) FROM services n WHERE n.tenant_id=s.tenant_id AND n.code=s.code)').all(u.tenant_id);
  // A routing gap is a department service step with zero or several candidates and no assignment.
  const gaps=[];
  for(const d of departments.filter(d=>d.active))for(const role of routingRoles){
    if(!services.some(s=>s.department_id===d.id&&JSON.parse(s.approval_policy).steps.includes(role)))continue;
    if(routing.some(r=>r.department_id===d.id&&r.step_role===role))continue;
    const candidates=users.filter(x=>x.active&&x.department_id===d.id&&x.role===(role==='department_manager'?'manager':role)).length;
    if(candidates!==1)gaps.push({department_id:d.id,step_role:role,candidates});
  }
  return {users,departments,routing,gaps,roles,routing_roles:routingRoles};
}

function insertAccount(db,u,row,password){
  const username=v.text(row.username,'اسم المستخدم',40,3).toLowerCase();
  if(!usernamePattern.test(username))fail(400,'username',`اسم المستخدم مو صحيح: ${username}`);
  if(db.prepare('SELECT 1 FROM users WHERE username=? OR id=?').get(username,username))fail(409,'username_taken',`اسم المستخدم هذا مأخوذ من قبل: ${username}`);
  const name=v.text(row.name,'الاسم',150,2);
  if(!roles.includes(row.role))fail(400,'role',`الدور مو صحيح للحساب ${username}`);
  department(db,u,row.department_id);
  db.prepare('INSERT INTO users(id,tenant_id,department_id,username,name,password_hash,role,manager_id,must_change_password) VALUES(?,?,?,?,?,?,?,?,1)').run(username,u.tenant_id,row.department_id,username,name,password,row.role,null);
  return username;
}
export function createAccount(db,supplied,input){
  const u=requireAdmin(db,supplied);
  v.object(input,['username','name','role','department_id','manager_id','temporary_password']);
  const id=insertAccount(db,u,input,passwordHash(passwordPolicy(input.temporary_password,input.username)));
  const manager=checkManager(db,u,input.manager_id,input.department_id,id);
  if(manager)db.prepare('UPDATE users SET manager_id=? WHERE id=?').run(manager,id);
  audit(db,u,'user',id,'user.created',{}, {role:input.role,department_id:input.department_id,manager_id:manager});
  return accountView(db.prepare('SELECT * FROM users WHERE id=?').get(id));
}

// CSV columns: username,name,department_id,role,manager_username. Managers may appear later in the same file.
export function parseAccountsCsv(text){
  if(typeof text!=='string'||!text.trim()||text.length>200000)fail(400,'csv','الصق ملف CSV بحجم معقول');
  const lines=text.replace(/^﻿/,'').split(/\r?\n/).map(l=>l.trim()).filter(Boolean);
  const header=lines[0].split(',').map(h=>h.trim().toLowerCase());
  const expected=['username','name','department_id','role','manager_username'];
  const hasHeader=expected.every((h,i)=>header[i]===h);
  const rows=(hasHeader?lines.slice(1):lines).map((line,i)=>{
    const cells=line.split(',').map(c=>c.trim());
    if(cells.length<4||cells.length>5)fail(400,'csv',`السطر ${i+1+(hasHeader?1:0)}: لازم 4 ولا 5 أعمدة`);
    return {username:cells[0],name:cells[1],department_id:cells[2],role:cells[3],manager_username:(cells[4]||'').toLowerCase()};
  });
  if(!rows.length||rows.length>1000)fail(400,'csv','لازم من سطر واحد لين 1000 سطر');
  return rows;
}
// كلمة مؤقتة لحسابٍ واحد، من عشوائية التشفير لا من نمط يُخمَّن.
// الأبجدية بلا 0/O ولا 1/l/I: تُملى وتُنسخ بلا لبس. وطولها 14 محرفًا من 30 رمزًا ≈ 68 بت.
// وتمرّ بـpasswordPolicy مع اسم الحساب كما يمرّ المسار الفردي، فلا تتساهل قاعدةٌ حيث تشدّد أخرى.
const TEMP_ALPHABET='abcdefghjkmnpqrstuvwxyz23456789';
function temporaryPasswordFor(username){
  const bytes=randomBytes(14);
  const password=[...bytes].map(b=>TEMP_ALPHABET[b%TEMP_ALPHABET.length]).join('');
  return passwordPolicy(password,username);
}

export function importAccounts(db,supplied,input){
  const u=requireAdmin(db,supplied);
  // الحقل القديم `temporary_password` كان كلمةً واحدةً لكل الحسابات. صار لكل حساب سرُّه، فلم يعد
  // مطلوبًا؛ ويُقبل إن أُرسل من شاشة قديمة ويُهمل، فلا ينكسر استيراد جارٍ على نسخة أقدم من الواجهة.
  v.object(input,['csv','temporary_password']);
  const rows=parseAccountsCsv(input.csv);
  const seen=new Set();
  for(const r of rows){const key=String(r.username).toLowerCase();if(seen.has(key))fail(400,'csv',`الاسم هذا مكرر في الملف: ${key}`);seen.add(key);}
  // العيب الذي أُغلق هنا (29 سبتمبر 2026): كانت البصمة تُحسب مرة وتُكتب على كل صف، فكل الحسابات
  // المستوردة تشترك في كلمة واحدة. وكل مستورَد يعرفها — هي كلمته — فيدخل بها حساب أي زميل لم يغيّر
  // كلمته بعد، ويضع له كلمة جديدة، فيصير كل فعل تالٍ مسجَّلًا في التدقيق باسم الضحية.
  const passwords=rows.map(r=>temporaryPasswordFor(String(r.username).toLowerCase()));
  const ids=rows.map((r,i)=>insertAccount(db,u,r,passwordHash(passwords[i])));
  rows.forEach((r,i)=>{
    const manager=checkManager(db,u,r.manager_username||null,r.department_id,ids[i]);
    if(manager)db.prepare('UPDATE users SET manager_id=? WHERE id=?').run(manager,ids[i]);
  });
  audit(db,u,'user','import','user.imported',{}, {count:ids.length});
  // الكلمات تُعاد مرة واحدة لمن أجرى الاستيراد ليسلّمها لأصحابها، ولا تُخزَّن ولا تُكتب في التدقيق.
  return {created:ids.length,usernames:ids,
    credentials:ids.map((id,i)=>({username:id,temporary_password:passwords[i]}))};
}

export function updateAccount(db,supplied,id,input){
  const u=requireAdmin(db,supplied);
  v.object(input,['name','role','department_id','manager_id','active']);
  const current=db.prepare('SELECT * FROM users WHERE id=? AND tenant_id=?').get(id,u.tenant_id);
  if(!current)fail(404,'not_found','ما لقينا الحساب هذا');
  if(current.role==='admin')fail(403,'forbidden','حساب مسؤول المنصة ما يتعدّل من هذي الشاشة');
  const next={name:input.name===undefined?current.name:v.text(input.name,'الاسم',150,2),role:input.role??current.role,department_id:input.department_id??current.department_id,active:input.active===undefined?!!current.active:input.active};
  if(!roles.includes(next.role))fail(400,'role','الدور هذا مو صحيح');
  if(typeof next.active!=='boolean')fail(400,'active','حالة الحساب هذي مو صحيحة');
  department(db,u,next.department_id);
  const managerInput=input.manager_id===undefined?(next.department_id===current.department_id?current.manager_id:null):input.manager_id;
  const manager=checkManager(db,u,managerInput,next.department_id,id);
  const reports=db.prepare('SELECT COUNT(*) AS n FROM users WHERE manager_id=? AND active=1').get(id).n;
  if(reports&&(next.role!=='manager'||!next.active||next.department_id!==current.department_id))fail(409,'has_reports',`للحساب ${reports} موظفين يتبعونه — انقلهم لمدير ثاني الأول`);
  if(db.prepare('SELECT 1 FROM department_routing WHERE user_id=?').get(id)&&(!next.active||next.role!==current.role||next.department_id!==current.department_id))fail(409,'routing_assigned','الحساب معيّن معتمد لإدارة — غيّر التعيين الأول');
  // الحارس بعد تحقّقات العمل وقبل أول كتابة. بعدها لأن «له تابعون» و«معيّن معتمدًا لإدارة» رفضان أوضح
  // لمن يقرأ، فلا يبتلعهما شرطٌ تقني. وقبلها لأن الإيقاف يُوقِف الحساب ويحذف جلساته ويعيد عمله إلى طابور
  // إدارته، وهذه واحدة لا ثلاث: كان الشرط `&& db.isTransaction` عند آخر خطوة تخطّيًا صامتًا — يقع الإيقاف
  // وتُحذف الجلسات ولا يعود العمل، بلا أن يعلم أحد. والنداء المباشر لبقية التعديلات يبقى كما كان،
  // والخادم يلفّ كل POST في معاملة أصلًا فلا يتغير شيء عنده.
  if(current.active&&next.active===false&&!db.isTransaction)
    fail(500,'transaction_required','إيقاف الحساب يجري داخل معاملة واحدة: يُوقَف الحساب ويعود عمله إلى طابور إدارته معًا، أو لا يقع شيء');
  db.prepare('UPDATE users SET name=?,role=?,department_id=?,manager_id=?,active=? WHERE id=?').run(next.name,next.role,next.department_id,manager,next.active?1:0,id);
  if(next.role!==current.role||next.department_id!==current.department_id||!next.active)db.prepare('DELETE FROM sessions WHERE user_id=?').run(id);
  audit(db,u,'user',id,'user.updated',accountView(current),{...next,manager_id:manager});
  // مستوى الإدارة (ترحيل 130) لا يعيش بعد الدور الذي اشتُق منه. كان صف user_permission_levels يبقى كما هو
  // عند تغيير الدور، فيُبقي على مديرٍ خُفِّض إلى موظف ثمانيةَ عشر تصريحًا يسحبها التخفيض اليوم — والصف
  // لا يُرى من المصفوفة أصلًا لأن matrix تعرض المستوى لا الدور. فيُعاد اشتقاقه هنا في المعاملة نفسها،
  // بحدث تدقيق خاص به يسمّي ما كان وما صار، ويُترك للمالك أن يسند مستوى آخر صراحةً من المصفوفة إن أراد.
  if(next.role!==current.role)rederiveLevel(db,u,id,current.role,next.role);
  // الموجة 2، العطب 8: إيقاف الحساب يعيد ما يباشره إلى طابور إدارته وينقل قرار خطواته المعلقة، في المعاملة نفسها، ويُخبَر مدير الإدارة.
  // كان الإيقاف محروسًا بالتابعين وتعيين المعتمد فقط، فيبقى الطلب «قيد التنفيذ» عند حساب لا يدخل أحدٌ به.
  //
  // وكان الشرط `&& db.isTransaction` **تخطّيًا صامتًا** لا حارسًا: خارج معاملة يُوقَف الحساب وتُحذف جلساته
  // ويُكتب حدث التدقيق، ثم لا يعود عمله — بلا أن يعلم أحد، حتى يلتقطه التشغيل اليومي. فالإيقاف يقع نصفين.
  // صار شرطًا يُرفض: الحارس عند الإيقاف وحده، فالنداء المباشر الموثّق لبقية التعديلات يبقى كما كان،
  // وما يحتاج ذرّية يحصل عليها أو يُرفض بنصّه. والخادم يلفّ كل POST في معاملة أصلًا، فلا يتغير شيء عنده.
  if(current.active&&!next.active)returnDepartedWork(db,{userId:id,actor:u,auditor:u});
  return accountView(db.prepare('SELECT * FROM users WHERE id=?').get(id));
}

export function resetAccountPassword(db,supplied,id,input){
  const u=requireAdmin(db,supplied);
  v.object(input,['temporary_password']);
  const current=db.prepare('SELECT * FROM users WHERE id=? AND tenant_id=?').get(id,u.tenant_id);
  if(!current||current.id===u.id)fail(404,'not_found','الحساب هذا ما ينعاد تعيينه');
  if(current.role==='admin'&&u.admin_level!=='super')fail(403,'admin_reset_forbidden','إعادة تعيين حساب إداري تبي أدمن أول');
  db.prepare('UPDATE users SET password_hash=?,must_change_password=1 WHERE id=?').run(passwordHash(passwordPolicy(input.temporary_password,current.username)),id);
  db.prepare('DELETE FROM sessions WHERE user_id=?').run(id);
  audit(db,u,'user',id,'user.password_reset',{}, {must_change_password:true});
  return accountView(db.prepare('SELECT * FROM users WHERE id=?').get(id));
}

export function saveDepartment(db,supplied,input,existingId=null){
  const u=requireAdmin(db,supplied);
  v.object(input,existingId?['name']:['id','name']);
  const name=v.text(input.name,'اسم الإدارة',120,2);
  if(existingId){
    const d=department(db,u,existingId);
    db.prepare('UPDATE departments SET name=? WHERE id=?').run(name,d.id);
    audit(db,u,'department',d.id,'department.renamed',{name:d.name},{name});
    return {id:d.id,name};
  }
  const id=v.text(input.id,'معرف الإدارة',40,2).toLowerCase();
  if(!departmentPattern.test(id))fail(400,'department_id','المعرّف حروف إنجليزية صغيرة وأرقام وشرطة وبس');
  if(db.prepare('SELECT 1 FROM departments WHERE id=?').get(id))fail(409,'department_taken','معرّف الإدارة هذا مأخوذ من قبل');
  db.prepare('INSERT INTO departments(id,tenant_id,name) VALUES(?,?,?)').run(id,u.tenant_id,name);
  audit(db,u,'department',id,'department.created',{}, {name});
  return {id,name};
}

export function assignRouting(db,supplied,input){
  const u=requireAdmin(db,supplied);
  v.object(input,['department_id','step_role','user_id']);
  const d=department(db,u,input.department_id);
  if(!routingRoles.includes(input.step_role))fail(400,'step_role','خطوة الاعتماد هذي مو صحيحة');
  const before=db.prepare('SELECT user_id FROM department_routing WHERE department_id=? AND step_role=?').get(d.id,input.step_role)??{};
  if(input.user_id===null||input.user_id===''){
    db.prepare('DELETE FROM department_routing WHERE department_id=? AND step_role=?').run(d.id,input.step_role);
    audit(db,u,'department',d.id,'routing.cleared',before,{step_role:input.step_role});
    return {department_id:d.id,step_role:input.step_role,user_id:null};
  }
  const role=input.step_role==='department_manager'?'manager':input.step_role;
  const target=db.prepare('SELECT * FROM users WHERE id=? AND tenant_id=? AND active=1').get(input.user_id,u.tenant_id);
  if(!target||target.department_id!==d.id||target.role!==role)fail(400,'routing_user','المعتمد لازم يكون حساب نشط من الإدارة وبالدور المطلوب');
  db.prepare('INSERT INTO department_routing VALUES(?,?,?,?,?,?) ON CONFLICT(department_id,step_role) DO UPDATE SET user_id=excluded.user_id,assigned_by=excluded.assigned_by,assigned_at=excluded.assigned_at').run(u.tenant_id,d.id,input.step_role,target.id,u.id,now());
  audit(db,u,'department',d.id,'routing.assigned',before,{step_role:input.step_role,user_id:target.id});
  return {department_id:d.id,step_role:input.step_role,user_id:target.id};
}
