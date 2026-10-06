import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { readFileSync } from 'node:fs';
import { openDb, transaction, verifyAudit } from '../app/db.mjs';
import { seed } from '../scripts/seed.mjs';
import { createApp } from '../app/server.mjs';
import { DESIGNS, THEMES, FALLBACK, companyAppearance, effectiveAppearance, appearanceView, setPersonalAppearance, setCompanyAppearance } from '../app/preferences.mjs';
import { appearanceUI, PALETTES } from '../app/static/appearance-ui.mjs';
import { operationModules, operationFields } from '../app/static/operations.mjs';

// المظهر (DESIGNS-ADDENDUM §هـ.9): الحسم الثلاثي، القفل، الرفض، التدقيق، عزل المستأجر، الحمولة، الملفات الثابتة، وسلامة ما ترسمه الشاشة.
const code=value=>error=>error.code===value;
const PASSWORD='synthetic-appearance';
const REASON='توحيد مظهر المنصة في بيئة الاختبار المصطنعة';
const e=value=>String(value??'').replace(/[&<>"']/g,c=>`&#${c.charCodeAt(0)};`);
function fixture(t){
  const db=openDb(':memory:');seed(db,PASSWORD);t.after(()=>db.close());
  // أدمن ثانٍ غير «الأول»، وأدمن أول للكيان المعزول: الأول لرفض 403، والثاني لعزل افتراضي الشركة بين الكيانين.
  const hash=db.prepare("SELECT password_hash FROM users WHERE id='admin'").get().password_hash;
  db.prepare("INSERT INTO users(id,tenant_id,department_id,username,name,password_hash,role,manager_id) VALUES('scoped-admin','36t','ops','scoped-admin','أدمن نطاق مصطنع',?,'admin',NULL)").run(hash);
  db.prepare("UPDATE users SET admin_level='scoped' WHERE id='scoped-admin'").run();
  db.prepare("INSERT INTO users(id,tenant_id,department_id,username,name,password_hash,role,manager_id) VALUES('external-admin','isolated','other','external-admin','أدمن الكيان المعزول',?,'admin',NULL)").run(hash);
  db.prepare("UPDATE users SET admin_level='super' WHERE id='external-admin'").run();
  const users=Object.fromEntries(db.prepare('SELECT * FROM users').all().map(u=>[u.id,u]));
  const tx=run=>transaction(db,run);
  const personal=(who,input)=>tx(()=>setPersonalAppearance(db,users[who],input));
  const company=(who,input)=>tx(()=>setCompanyAppearance(db,users[who],input));
  const audits=()=>db.prepare("SELECT * FROM audit_events WHERE entity_type='appearance' ORDER BY seq").all();
  return {db,users,tx,personal,company,audits};
}

test('defaults: with no rows every user resolves to depth/dark, unlocked, source default — never auto',t=>{
  const {db,users}=fixture(t);
  assert.deepEqual(FALLBACK,{design:'depth',theme:'dark'});assert.deepEqual(DESIGNS,['depth','classic','void','field','slate','studio','riwaq','yawm','markaz','classicplus']);assert.deepEqual(THEMES,['auto','dark','light']);
  for(const who of ['employee','manager','hr','it','admin','external'])assert.deepEqual(effectiveAppearance(db,users[who]),{design:'depth',theme:'dark',locked:false,source:'default'},who);
  assert.deepEqual(companyAppearance(db,'36t'),{design:'depth',theme:'dark',locked:false,version:0,updated_at:null,updated_by_name:null});
  const view=appearanceView(db,users.employee);
  assert.equal(view.personal,null);assert.equal(view.can_manage,false);assert.equal(appearanceView(db,users.admin).can_manage,true);assert.equal(appearanceView(db,users['scoped-admin']).can_manage,false);
  assert.deepEqual(view.designs.map(d=>[d.key,d.name,d.latin]),[['depth','كوكبة 360','Constellation 360'],['classicplus','الكلاسيكي المطوّر','الكلاسيكي المطوّر'],['classic','الكلاسيكي','Classic'],['void','الفراغ','VOID'],['field','الحقل 77','FIELD 77'],['studio','مدار 360','مدار 360'],['slate','الفحمي','SLATE'],['riwaq','الرواق','RIWAQ'],['yawm','اليوم','YAWM'],['markaz','مركز الأثر','IMPACT CENTRE']]);
  assert.ok(view.designs.every(d=>typeof d.description==='string'&&d.description.length>20));
  assert.deepEqual(view.themes.map(x=>x.key),['dark','light','auto']);
});

test('resolution order: personal choice, then company default, then depth/dark; reset returns to the company default',t=>{
  const {db,users,personal,company}=fixture(t);
  assert.deepEqual(company('admin',{design:'slate',theme:'light',locked:false,reason:REASON}),{appearance:{design:'slate',theme:'light',locked:false,source:'company'}});
  assert.deepEqual(effectiveAppearance(db,users.employee),{design:'slate',theme:'light',locked:false,source:'company'});
  assert.deepEqual(personal('employee',{design:'field',theme:'auto'}),{appearance:{design:'field',theme:'auto',locked:false,source:'personal'}});
  assert.deepEqual(effectiveAppearance(db,users.employee),{design:'field',theme:'auto',locked:false,source:'personal'});
  assert.deepEqual(effectiveAppearance(db,users.manager),{design:'slate',theme:'light',locked:false,source:'company'},'one user\'s choice never moves another user');
  // الحفظ الثاني يحدّث الصف نفسه ويرفع رقم إصداره.
  personal('employee',{design:'void',theme:'light'});
  assert.deepEqual(db.prepare("SELECT design,theme,version,tenant_id FROM user_appearance WHERE user_id='employee'").all().map(r=>({...r})),[{design:'void',theme:'light',version:2,tenant_id:'36t'}]);
  const view=appearanceView(db,users.employee);
  assert.equal(view.personal.design,'void');assert.equal(view.personal.theme,'light');assert.match(view.personal.updated_at,/^\d{4}-\d{2}-\d{2}T/);
  assert.equal(view.company.updated_by_name,null,'an employee does not see who set the default');assert.equal(appearanceView(db,users.admin).company.updated_by_name,users.admin.name);
  assert.deepEqual(personal('employee',{reset:true}),{appearance:{design:'slate',theme:'light',locked:false,source:'company'}});
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM user_appearance WHERE user_id='employee'").get().n,0);
  assert.deepEqual(personal('employee',{reset:true}).appearance.source,'company','reset with nothing saved is harmless');
});

test('lock: the personal row is ignored but kept, the personal save is refused in clear Arabic, and the choice returns when the lock lifts',t=>{
  const {db,users,personal,company}=fixture(t);
  personal('employee',{design:'field',theme:'light'});
  company('admin',{design:'slate',theme:'dark',locked:true,reason:REASON});
  assert.deepEqual(effectiveAppearance(db,users.employee),{design:'slate',theme:'dark',locked:true,source:'company'});
  assert.equal(db.prepare("SELECT design FROM user_appearance WHERE user_id='employee'").get().design,'field','the lock does not delete the personal row');
  assert.throws(()=>personal('employee',{design:'void',theme:'dark'}),error=>error.code==='appearance_locked'&&error.status===409&&error.message==='المظهر موحّد من إدارة المنصة');
  assert.throws(()=>personal('employee',{reset:true}),code('appearance_locked'));
  assert.throws(()=>personal('admin',{design:'void',theme:'dark'}),code('appearance_locked'),'the lock binds the super admin\'s personal choice too');
  assert.equal(db.prepare("SELECT design FROM user_appearance WHERE user_id='employee'").get().design,'field','a refused save changes nothing');
  assert.equal(appearanceView(db,users.employee).personal.design,'field');
  company('admin',{design:'slate',theme:'dark',locked:false,reason:REASON});
  assert.deepEqual(effectiveAppearance(db,users.employee),{design:'field',theme:'light',locked:false,source:'personal'});
});

test('invalid values are refused: unknown design or theme, extra or missing keys, wrong types, short reason, stale version, no change',t=>{
  const {db,users,personal,company}=fixture(t);
  for(const bad of [null,undefined,'void',[],{}, {design:'void'},{theme:'dark'},{design:'neon',theme:'dark'},{design:'void',theme:'sepia'},{design:'VOID',theme:'dark'},{design:'void',theme:'dark',extra:1},{design:'void',theme:'dark',reset:true},{reset:false},{reset:'true'},{reset:true,design:'void'},{design:['void'],theme:'dark'}])
    assert.throws(()=>personal('employee',bad),code('invalid_fields'),JSON.stringify(bad));
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM user_appearance').get().n,0);
  const good={design:'field',theme:'dark',locked:false,reason:REASON};
  for(const bad of [null,[],{}, {...good,design:'neon'},{...good,theme:'sepia'},{...good,locked:1},{...good,locked:'1'},{...good,reason:'قصير'},{...good,reason:'         x         '},{...good,reason:undefined},{...good,reason:'س'.repeat(1001)},{...good,extra:true},{...good,version:'0'},{...good,version:1.5},{design:'field',theme:'dark',reason:REASON}])
    assert.throws(()=>company('admin',bad),code('invalid_fields'),JSON.stringify(bad));
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM appearance_settings').get().n,0);
  // الرقم التفاؤلي: 0 قبل أول حفظ، ثم يزيد مع كل تغيير؛ الرقم القديم يُرفض.
  assert.throws(()=>company('admin',{...good,version:3}),code('stale_version'));
  company('admin',{...good,version:0});
  assert.equal(companyAppearance(db,'36t').version,1);
  assert.throws(()=>company('admin',{...good,design:'slate',version:0}),code('stale_version'));
  assert.throws(()=>company('admin',{...good,version:1}),code('no_change'));
  company('admin',{...good,design:'slate',version:1});
  assert.equal(companyAppearance(db,'36t').version,2);assert.equal(companyAppearance(db,'36t').design,'slate');
  // قاعدة البيانات نفسها ترفض ما يتجاوز الوحدة.
  assert.throws(()=>db.prepare("UPDATE appearance_settings SET design='neon' WHERE tenant_id='36t'").run(),/CHECK/);
  assert.throws(()=>db.prepare("INSERT INTO user_appearance(user_id,tenant_id,design,theme,updated_at) VALUES('employee','36t','void','sepia','2026-01-01T00:00:00.000Z')").run(),/CHECK/);
  assert.ok(users.employee);
});

test('only the super admin sets the company default, inside a transaction, with a written reason — and every change is audited with before and after',t=>{
  const {db,users,personal,company,audits}=fixture(t);
  const input={design:'field',theme:'dark',locked:false,reason:REASON};
  for(const who of ['employee','manager','hr','it','scoped-admin'])assert.throws(()=>company(who,input),error=>error.code==='forbidden'&&error.status===403,who);
  assert.throws(()=>setCompanyAppearance(db,users.admin,input),code('transaction_required'));
  assert.throws(()=>setPersonalAppearance(db,users.employee,{design:'void',theme:'dark'}),code('transaction_required'));
  assert.equal(audits().length,0);
  company('admin',input);company('admin',{...input,theme:'light',locked:true,reason:`  ${REASON}  `});
  const rows=audits();
  assert.deepEqual(rows.map(r=>[r.tenant_id,r.actor_id,r.entity_id,r.action,r.reason]),[['36t','admin','36t','appearance.company_default',REASON],['36t','admin','36t','appearance.company_default',REASON]]);
  assert.deepEqual(JSON.parse(rows[0].before_json),{});assert.deepEqual(JSON.parse(rows[0].after_json),{design:'field',theme:'dark',locked:false});
  assert.deepEqual(JSON.parse(rows[1].before_json),{design:'field',theme:'dark',locked:false});assert.deepEqual(JSON.parse(rows[1].after_json),{design:'field',theme:'light',locked:true});
  // الحفظ الشخصي لا يكتب سطر تدقيق (تبديل الوضع كان سيُغرق السلسلة)، والسلسلة كلها سليمة.
  company('admin',{...input,locked:false});personal('manager',{reset:true});personal('employee',{design:'slate',theme:'auto'});personal('employee',{design:'slate',theme:'dark'});personal('employee',{reset:true});
  assert.equal(audits().length,3);assert.equal(db.prepare("SELECT COUNT(*) AS n FROM audit_events WHERE actor_id='employee'").get().n,0);
  assert.equal(verifyAudit(db),true);
  // فشل داخل المعاملة لا يترك أثرًا: لا صف ولا سطر تدقيق.
  const before=JSON.stringify(companyAppearance(db,'36t'));
  assert.throws(()=>transaction(db,()=>{setCompanyAppearance(db,users.admin,{...input,design:'slate'});throw Object.assign(Error('later failure'),{code:'later'});}),code('later'));
  assert.equal(JSON.stringify(companyAppearance(db,'36t')),before);assert.equal(audits().length,3);assert.equal(verifyAudit(db),true);
});

test('tenant isolation: a company default, a lock and a personal choice in one tenant never reach the other',t=>{
  const {db,users,personal,company,audits}=fixture(t);
  company('admin',{design:'field',theme:'light',locked:true,reason:REASON});
  assert.deepEqual(effectiveAppearance(db,users.external),{design:'depth',theme:'dark',locked:false,source:'default'});
  assert.equal(companyAppearance(db,'isolated').version,0);
  assert.deepEqual(personal('external',{design:'slate',theme:'auto'}).appearance,{design:'slate',theme:'auto',locked:false,source:'personal'},'a lock in 36t does not bind the isolated tenant');
  company('external-admin',{design:'slate',theme:'dark',locked:false,reason:REASON});
  assert.deepEqual(companyAppearance(db,'36t'),{...companyAppearance(db,'36t'),design:'field',theme:'light',locked:true,version:1});
  assert.deepEqual(effectiveAppearance(db,users.employee),{design:'field',theme:'light',locked:true,source:'company'});
  assert.deepEqual(audits().map(r=>[r.tenant_id,r.actor_id,r.entity_id]),[['36t','admin','36t'],['isolated','external-admin','isolated']]);
  // صف شخصي يحمل كيانًا غير كيان صاحبه (لا تكتبه الوحدة أبدًا) لا يُقرأ: كل استعلام مقيّد بالكيان.
  db.prepare("INSERT INTO user_appearance(user_id,tenant_id,design,theme,updated_at) VALUES('manager','isolated','slate','light','2026-01-01T00:00:00.000Z')").run();
  company('admin',{design:'field',theme:'light',locked:false,reason:REASON});
  assert.deepEqual(effectiveAppearance(db,users.manager),{design:'field',theme:'light',locked:false,source:'company'});
  assert.equal(appearanceView(db,users.manager).personal,null);
  assert.equal(appearanceView(db,users.external).company.design,'slate');assert.equal(appearanceView(db,users.employee).company.design,'field');
  assert.equal(verifyAudit(db),true);
});

test('HTTP: the three routes, CSRF, the payload field on /api/login and /api/me, and the two static files',async t=>{
  const {db}=fixture(t);
  const server=createApp(db);server.listen(0,'127.0.0.1');await once(server,'listening');
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  const base=`http://127.0.0.1:${server.address().port}`;
  const signIn=async username=>{
    const response=await fetch(base+'/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username,password:PASSWORD})});assert.equal(response.status,200,username);
    const body=await response.json(),cookie=response.headers.get('set-cookie').split(';')[0];
    const call=async(path,method='GET',payload,csrf=body.csrf)=>{const r=await fetch(base+'/api'+path,{method,headers:{cookie,...(method==='GET'?{}:{'Content-Type':'application/json','X-CSRF-Token':csrf})},...(method==='GET'?{}:{body:JSON.stringify(payload)})});return {status:r.status,body:await r.json()};};
    return {user:body.user,call};
  };
  const employee=await signIn('employee'),admin=await signIn('admin'),scoped=await signIn('scoped-admin');
  assert.deepEqual(employee.user.appearance,{design:'depth',theme:'dark',locked:false,source:'default'},'/api/login carries the four-field appearance');
  assert.deepEqual((await employee.call('/me')).body.user.appearance,{design:'depth',theme:'dark',locked:false,source:'default'});
  const unauthenticated=await fetch(base+'/api/appearance');assert.equal(unauthenticated.status,401);await unauthenticated.arrayBuffer();
  const view=await employee.call('/appearance');assert.equal(view.status,200);
  assert.deepEqual(Object.keys(view.body).sort(),['appearance','can_manage','company','designs','personal','themes']);assert.equal(view.body.can_manage,false);
  const saved=await employee.call('/account/appearance','POST',{design:'field',theme:'light'});
  assert.equal(saved.status,201);assert.deepEqual(saved.body,{appearance:{design:'field',theme:'light',locked:false,source:'personal'}});
  assert.deepEqual((await employee.call('/me')).body.user.appearance,saved.body.appearance,'the choice follows the account, not the device');
  assert.deepEqual((await signIn('employee')).user.appearance,saved.body.appearance,'a fresh login on another device starts from the saved look');
  assert.equal((await employee.call('/account/appearance','POST',{design:'field',theme:'light'},'wrong-token')).status,403);
  const invalid=await employee.call('/account/appearance','POST',{design:'neon',theme:'light'});assert.equal(invalid.status,400);assert.equal(invalid.body.error.code,'invalid_fields');
  assert.equal((await employee.call('/account/appearance','POST',{design:'void',theme:'dark',extra:1})).status,400);
  const company={design:'slate',theme:'dark',locked:true,reason:REASON,version:0};
  for(const session of [employee,scoped]){const refused=await session.call('/admin/appearance','POST',company);assert.equal(refused.status,403);assert.equal(refused.body.error.code,'forbidden');}
  assert.equal((await admin.call('/admin/appearance','POST',{...company,reason:'قصير'})).status,400);
  const set=await admin.call('/admin/appearance','POST',company);
  assert.equal(set.status,201);assert.deepEqual(set.body,{appearance:{design:'slate',theme:'dark',locked:true,source:'company'}});
  const locked=await employee.call('/account/appearance','POST',{design:'void',theme:'dark'});
  assert.equal(locked.status,409);assert.deepEqual(locked.body.error,{code:'appearance_locked',message:'المظهر موحّد من إدارة المنصة'});
  assert.deepEqual((await employee.call('/me')).body.user.appearance,{design:'slate',theme:'dark',locked:true,source:'company'});
  assert.equal((await employee.call('/appearance')).body.personal.design,'field');
  assert.equal((await admin.call('/admin/appearance','POST',{...company,locked:false,version:0})).status,409,'a stale version is refused');
  assert.equal((await admin.call('/admin/appearance','POST',{...company,locked:false,version:1})).status,201);
  assert.deepEqual((await employee.call('/me')).body.user.appearance,saved.body.appearance);
  assert.equal(verifyAudit(db),true);
  // الملفان الثابتان: القائمة البيضاء في الخادم، والنوع text/javascript. tests/static-modules.test.mjs لا يلتقط theme-boot.js لأن امتداده .js.
  for(const path of ['/theme-boot.js','/appearance-ui.mjs']){
    const response=await fetch(base+path),text=await response.text();
    assert.equal(response.status,200,path);assert.match(response.headers.get('content-type'),/^text\/javascript/,path);assert.ok(text.length>100,path);
    assert.match(response.headers.get('content-security-policy'),/script-src 'self'/);
  }
  assert.match(readFileSync(new URL('../app/static/index.html',import.meta.url),'utf8'),/<script src="\/theme-boot\.js"><\/script>/,'index.html loads the boot script that the whitelist serves');
});

test('the screen: renders for employee and super admin, locked and unlocked, inside the strict CSP, and every offered button opens a valid form',t=>{
  const {db,users,personal,company}=fixture(t);
  assert.equal(operationModules.appearance,appearanceUI);
  assert.equal(appearanceUI.title,'المظهر');assert.equal(typeof appearanceUI.description,'string');
  const destructive=/(^|_)(reject|cancel|delete|remove|revoke|withdraw|void|terminate|suspend|archive|drop|decline)(_|$)|^(رفض|إلغاء|حذف|سحب|إزالة|إيقاف|إنهاء|إبطال|استبعاد|أرشفة)/;
  const draw=who=>{
    const data=appearanceView(db,users[who]),buttons=[],button=(action,id,label)=>{buttons.push([action,id,label]);return `<button>${e(label)}</button>`;};
    const html=appearanceUI.render(data,{e,button});
    assert.doesNotMatch(html,/style\s*=|<style|<script|\son[a-z]+\s*=|href\s*=|<image|<foreignObject|javascript:/i,who);
    assert.doesNotMatch(html.replace(/<[^>]+>/g,' '),/\bundefined\b|\bNaN\b|\[object /,who);
    // لا صنف جديد: كل صنف في الناتج من عقد الأصناف القائم.
    for(const m of html.matchAll(/class="([^"]+)"/g))for(const name of m[1].split(/\s+/))assert.ok(['panel','panel-body','vn-head','vn-alert','vn-grid','vn-block','badge','ltr','subtle','operation-actions'].includes(name),`unexpected class ${name}`);
    const previews=[...html.matchAll(/<svg [^>]*>/g)];
    // العدد مشتق من DESIGNS: معاينة داكنة وفاتحة لكل تصميم. رقمٌ محفور كان يجعل كل مظهر جديد تعديلَ اختبار.
    assert.equal(previews.length,DESIGNS.length*2,'لكل تصميم معاينة داكنة وأخرى فاتحة');
    for(const [svg] of previews){assert.match(svg,/role="img"/);assert.match(svg,/aria-label="[^"]{5,}"/);assert.match(svg,/viewBox="0 0 156 104" width="156" height="104"/);}
    assert.equal((html.match(/M5\.11 0h8\.62L7\.4 10H0z/g)??[]).length,DESIGNS.length*2*6,'ست فواصل في كل معاينة');
    assert.doesNotMatch(html,/#16A08[0-9A-F]/i,'the brand turquoise is written through its one token, never as a HEX');
    assert.match(html,/fill="var\(--brand-turquoise\)"/);
    for(const [action,id,label] of buttons){
      const spec=appearanceUI.form(action,id,data);
      assert.ok(typeof spec.title==='string'&&Array.isArray(spec.fields)&&typeof spec.toPayload==='function'&&spec.endpoint,`${who}/${action}`);
      assert.doesNotMatch(action,destructive);assert.doesNotMatch(spec.title,destructive);assert.doesNotMatch(spec.submit,destructive);assert.doesNotMatch(label,destructive);
      assert.doesNotMatch(operationFields(spec.fields,e),/style\s*=|<script|\bundefined\b/);
    }
    return {data,html,buttons};
  };
  // غير مقفل، بلا اختيار: سبعة أزرار تصميم وثلاثة أزرار وضع، ولا زر عودة؛ «الحالي» على «كوكبة 360» وحده.
  let employee=draw('employee');
  assert.deepEqual(employee.buttons.map(b=>b[0]+':'+b[1]),['choose:depth','choose:classicplus','choose:classic','choose:void','choose:field','choose:studio','choose:slate','choose:riwaq','choose:yawm','choose:markaz','choose:depth:dark','choose:depth:light','choose:depth:auto']);
  assert.equal((employee.html.match(/class="badge"/g)??[]).length,1);assert.match(employee.html,/افتراضي المنصة/);
  assert.equal((employee.html.match(/stroke-width="3"/g)??[]).length,1,'exactly one preview is framed as the active look');
  const choose=appearanceUI.form('choose','void',employee.data);
  assert.deepEqual(choose.fields.map(f=>[f.name,f.type,f.value]),[['design','select','void'],['theme','select','dark']],'the field names design and theme are a contract with the live preview in app.mjs');
  assert.deepEqual(choose.toPayload({design:'field',theme:'auto',stray:'x'}),{design:'field',theme:'auto'});
  assert.equal(appearanceUI.form('choose','slate:light',employee.data).fields[1].value,'light');
  for(const bad of ['neon','void:sepia','',undefined,'void:darkx'])assert.throws(()=>appearanceUI.form('choose',bad,employee.data),/الإجراء غير متاح/,String(bad));
  assert.throws(()=>appearanceUI.form('company','',employee.data),/الإجراء غير متاح/);assert.throws(()=>appearanceUI.form('choose_void','',employee.data),/الإجراء غير متاح/);
  // اختيار شخصي: يظهر زر العودة، و«يتبع الجهاز» لا يضع إطارًا على أي معاينة.
  personal('employee',{design:'field',theme:'auto'});employee=draw('employee');
  assert.ok(employee.buttons.some(b=>b[0]==='reset'));assert.match(employee.html,/اختيارك/);assert.equal((employee.html.match(/stroke-width="3"/g)??[]).length,0);
  assert.deepEqual(appearanceUI.form('reset','',employee.data).toPayload({}),{reset:true});
  // الأدمن الأول: كتلة افتراضي الشركة ونموذجها يحمل رقم الإصدار.
  let admin=draw('admin');
  assert.ok(admin.buttons.some(b=>b[0]==='company'));assert.match(admin.html,/افتراضي الشركة/);
  const form=appearanceUI.form('company','',admin.data);
  assert.deepEqual(form.fields.map(f=>f.name),['design','theme','locked','reason']);
  assert.deepEqual(form.toPayload({design:'slate',theme:'dark',locked:'1',reason:REASON}),{design:'slate',theme:'dark',locked:true,reason:REASON,version:0});
  // مقفل: تنبيه صريح، ولا زر اختيار شخصي ولا عودة لأحد؛ الأدمن الأول يبقى له زر افتراضي الشركة وحده.
  company('admin',form.toPayload({design:'slate',theme:'dark',locked:'1',reason:REASON}));
  employee=draw('employee');admin=draw('admin');
  assert.match(employee.html,/class="vn-alert"/);assert.match(employee.html,/المظهر موحّد من إدارة المنصة/);assert.match(employee.html,/اختيارك الشخصي محفوظ/);
  assert.deepEqual(employee.buttons,[]);assert.deepEqual(admin.buttons.map(b=>b[0]),['company']);
  assert.throws(()=>appearanceUI.form('choose','void',employee.data),/الإجراء غير متاح/);assert.throws(()=>appearanceUI.form('reset','',employee.data),/الإجراء غير متاح/);
  assert.equal(appearanceUI.form('company','',admin.data).toPayload({design:'void',theme:'dark',locked:'0',reason:REASON}).version,1);
});

test('migration 095: depth and classic join the allowed designs, depth becomes the default, neon is still refused, and existing rows survive unchanged',t=>{
  const {db,users}=fixture(t);
  const read=name=>readFileSync(new URL(`../app/migrations/${name}`,import.meta.url),'utf8');
  // على قاعدة جديدة: 095 طُبّقت، والقيود الجديدة فاعلة.
  assert.ok(db.prepare('SELECT 1 FROM schema_migrations WHERE version=95').get(),'095 is applied by openDb');
  for(const design of ['depth','classic'])db.prepare("INSERT INTO user_appearance(user_id,tenant_id,design,theme,updated_at) VALUES(?,?,?,'dark','2026-01-01T00:00:00.000Z') ON CONFLICT(user_id) DO UPDATE SET design=excluded.design").run('employee','36t',design);
  assert.equal(db.prepare("SELECT design FROM user_appearance WHERE user_id='employee'").get().design,'classic');
  assert.throws(()=>db.prepare("UPDATE user_appearance SET design='neon' WHERE user_id='employee'").run(),/CHECK/);
  db.prepare("INSERT INTO appearance_settings(tenant_id,updated_by,updated_at) VALUES('36t','admin','2026-01-01T00:00:00.000Z')").run();
  assert.equal(db.prepare("SELECT design FROM appearance_settings WHERE tenant_id='36t'").get().design,'depth','a company row created without a design defaults to depth');
  assert.throws(()=>db.prepare("UPDATE appearance_settings SET design='neon' WHERE tenant_id='36t'").run(),/CHECK/);
  assert.ok(db.prepare("SELECT 1 FROM sqlite_master WHERE type='index' AND name='user_appearance_tenant' AND tbl_name='user_appearance'").get(),'the 094 index is recreated on the rebuilt table');
  // على قاعدة كانت على 094 بصفوف قائمة: يُعاد الجدولان إلى شكل 094، ثم تُطبَّق 095 كما يطبّقها openDb (معاملة، والمفاتيح الأجنبية مفعّلة).
  transaction(db,()=>{db.exec('DROP TABLE appearance_settings; DROP TABLE user_appearance;');db.exec(read('094-user-preferences.sql'));});
  assert.throws(()=>db.prepare("INSERT INTO user_appearance(user_id,tenant_id,design,theme,updated_at) VALUES('hr','36t','depth','dark','2026-01-01T00:00:00.000Z')").run(),/CHECK/,'094 alone refuses depth');
  db.prepare("INSERT INTO appearance_settings(tenant_id,design,theme,locked,version,updated_by,updated_at) VALUES('36t','void','light',1,4,'admin','2026-02-02T00:00:00.000Z')").run();
  db.prepare("INSERT INTO user_appearance(user_id,tenant_id,design,theme,version,updated_at) VALUES('employee','36t','void','auto',3,'2026-03-03T00:00:00.000Z'),('manager','36t','slate','light',1,'2026-03-04T00:00:00.000Z')").run();
  const snapshot=()=>({company:db.prepare('SELECT * FROM appearance_settings ORDER BY tenant_id').all().map(r=>({...r})),personal:db.prepare('SELECT * FROM user_appearance ORDER BY user_id').all().map(r=>({...r}))});
  const before=snapshot();
  assert.equal(db.prepare('PRAGMA foreign_keys').get().foreign_keys,1);
  transaction(db,()=>db.exec(read('095-appearance-depth.sql')));
  assert.deepEqual(snapshot(),before,'every existing row, void included, survives 095 unchanged');
  assert.deepEqual(effectiveAppearance(db,users.employee),{design:'void',theme:'light',locked:true,source:'company'});
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE name LIKE '%\\_v1' ESCAPE '\\' AND (tbl_name LIKE 'appearance%' OR tbl_name LIKE 'user_appearance%')").get().n,0,'no leftover _v1 table');
  db.prepare("UPDATE user_appearance SET design='depth' WHERE user_id='employee'").run();
  assert.throws(()=>db.prepare("UPDATE user_appearance SET design='neon' WHERE user_id='manager'").run(),/CHECK/);
  assert.throws(()=>db.prepare("UPDATE appearance_settings SET design='neon'").run(),/CHECK/);
  assert.equal(db.prepare("SELECT design FROM user_appearance WHERE user_id='manager'").get().design,'slate');
});

test('the client mirrors: the boot script and app.mjs fall back to depth, list the five designs, and the picker actions stay clear of the destructive tone',()=>{
  // القائمتان تُشتقّان من DESIGNS لا تُكتبان بحروفهما: مظهرٌ ثامن يُضاف إلى الخادم ويُنسى في مرآة العميل
  // كان يمرّ من هنا بصمت، وصفّ محفور باليد يجعل كل إضافة تعديلَ اختبارٍ بدل أن تكون فحصًا.
  const list=DESIGNS.map(d=>`'${d}'`).join(',');
  const boot=readFileSync(new URL('../app/static/theme-boot.js',import.meta.url),'utf8');
  assert.ok(boot.includes(`var D=[${list}],T=['auto','dark','light'],d='depth',t='dark';`),'مرآة الإقلاع تسرد التصاميم نفسها بترتيبها');
  const app=readFileSync(new URL('../app/static/app.mjs',import.meta.url),'utf8');
  assert.ok(app.includes(`const DESIGNS=[${list}]`),'قائمة الواجهة تساوي قائمة الخادم');assert.match(app,/if\(!DESIGNS\.includes\(design\)\)design='depth';/);
  const destructive=new RegExp(app.match(/const destructive=\/(.+)\/;/)[1]);
  for(const action of ['design','pick-design'])assert.doesNotMatch(action,destructive,action);
  assert.ok(destructive.test('void'),'the regex this guards against still carries void');
  assert.match(app,/data-action="pick-design" data-value="\$\{key\}"/,'the design key travels in data-value only');
  assert.doesNotMatch(app,/data-action="(?:design|pick-design)"[^>]*style=/);
  // الصفحة لا تنهار أمام تصميم لا تعرفه الواجهة: المعاينة ترسم بلوحة depth.
  const data={appearance:{design:'aurora',theme:'dark',locked:false,source:'default'},company:{design:'aurora',theme:'dark',locked:false,version:0,updated_at:null,updated_by_name:null},personal:null,can_manage:false,designs:[{key:'aurora',name:'مستقبلي',latin:'AURORA',description:'تصميم أحدث من هذه الواجهة'}],themes:[{key:'dark',name:'داكن'},{key:'light',name:'فاتح'},{key:'auto',name:'يتبع الجهاز'}]};
  const html=appearanceUI.render(data,{e,button:()=>''});
  // يُعرف السقوط إلى «كوكبة 360» بأرضها في لوحة المعاينة نفسها، لا بقيمةٍ محفورة هنا: صُحّحت المعاينة (1 أكتوبر) إلى
  // فراغها الأسود الحقيقي، وكانت هذه السطر تحفر الأرض الفيروزية القديمة #04100E.
  assert.equal((html.match(/<svg /g)??[]).length,2);assert.ok(html.includes(`fill="${PALETTES.depth.dark.ground}"`));
});

test('مدار: يحفظ الترحيل المظهر السابق والقفل ويقبل الاختيار الشخصي الجديد',t=>{
  const {db,users,personal,company}=fixture(t);
  personal('employee',{design:'classic',theme:'auto'});
  company('admin',{design:'depth',theme:'dark',locked:true,reason:REASON});
  const snapshot=()=>({company:db.prepare('SELECT * FROM appearance_settings').all(),personal:db.prepare('SELECT * FROM user_appearance').all()});
  const before=snapshot();
  transaction(db,()=>db.exec(readFileSync(new URL('../app/migrations/120-appearance-studio.sql',import.meta.url),'utf8')));
  assert.deepEqual(snapshot(),before);
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);
  assert.throws(()=>personal('employee',{design:'studio',theme:'light'}),code('appearance_locked'));
  company('admin',{design:'depth',theme:'dark',locked:false,reason:REASON});
  personal('employee',{design:'studio',theme:'light'});
  assert.equal(effectiveAppearance(db,users.employee).design,'studio');
  personal('employee',{design:'classic',theme:'auto'});
  assert.equal(effectiveAppearance(db,users.employee).design,'classic');
});
