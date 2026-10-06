import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { REQUEST_STATUSES,REQUEST_STATUS,REQUEST_STATUS_AR,MODULE_STATUS_MAP,ROLE_NAMES,ROLE_NAMES_AR,BANNED_STATUS_PHRASES,statusName,statusTone,canonicalStatus,roleName } from '../app/static/vocabulary.mjs';
import { STATUS_WORDS } from '../app/my-requests.mjs';
import { countStatusLiterals,loadBaseline } from '../scripts/quality-ratchet.mjs';

// القاموس الواحد (م0 «السور»): عبارة واحدة لكل حالة، وحالات الوحدات مطابَقة على الثماني وعبارتها بجوارها، ولا نسخة باقية فيما أملكه.
const source=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');

test('vocabulary: eight request statuses, one Arabic and one English phrase each, and no phrase serves two statuses',()=>{
  assert.deepEqual([...REQUEST_STATUSES],['draft','pending','returned','approved','in_progress','completed','rejected','cancelled']);
  assert.deepEqual(Object.keys(REQUEST_STATUS),[...REQUEST_STATUSES]);
  for(const status of REQUEST_STATUSES){
    const [ar,en]=REQUEST_STATUS[status];
    assert.ok(/[؀-ۿ]/.test(ar)&&ar.trim()===ar,`${status}: عبارة عربية`);
    assert.ok(/^[A-Za-z ]+$/.test(en),`${status}: English phrase`);
    assert.equal(statusName(status),ar);assert.equal(statusName(status,'en'),en);assert.equal(REQUEST_STATUS_AR[status],ar);
    assert.equal(statusTone(status),status,'لون الشارة هو اسم الحالة في style.css');
  }
  assert.equal(new Set(REQUEST_STATUSES.map(s=>REQUEST_STATUS[s][0])).size,8,'لا عبارة عربية لحالتين');
  assert.equal(new Set(REQUEST_STATUSES.map(s=>REQUEST_STATUS[s][1])).size,8,'no English phrase for two statuses');
  // الاختيار الموثّق في docs/implementation/handoff/wave0-guard-rails.md.
  assert.equal(statusName('pending'),'بانتظار الاعتماد');assert.equal(statusName('returned'),'معاد للتعديل');assert.equal(statusName('approved'),'معتمد');
  assert.throws(()=>{REQUEST_STATUS.pending[0]='قيد الاعتماد';},TypeError,'القاموس مجمَّد: لا تُغيَّر عبارة من شاشة');
});

test('vocabulary: a status outside the eight is shown as it is, never dressed as another',()=>{
  assert.equal(statusName('pending_authority'),'pending_authority');
  assert.equal(statusName(undefined),'');assert.equal(statusTone('whatever'),'');
  assert.equal(statusName('constructor'),'constructor','مفاتيح النموذج الأولي ليست حالات');
});

test('vocabulary: the banned phrases are not canonical, and the ungrammatical hybrid is among them',()=>{
  assert.ok(BANNED_STATUS_PHRASES.includes('قيد بانتظار الاعتماد'));
  const canonical=new Set(Object.values(REQUEST_STATUS_AR));
  for(const phrase of BANNED_STATUS_PHRASES)assert.equal(canonical.has(phrase),false,phrase);
  assert.equal(canonical.has('قيد الاعتماد'),false,'العبارة القديمة لحالة pending ليست في القاموس');
});

test('vocabulary: every module status maps onto one of the eight and keeps the module\'s own phrase beside it',()=>{
  // كل عبارة وحدة مأخوذة من ملف الوحدة نفسه لا مخترعة هنا: تُطلب حرفيًا في مصدرها.
  const home={leave:['app/static/leave-ui.mjs'],expense:['app/expenses.mjs'],custody:['app/expenses.mjs'],letter:['app/letters.mjs'],hr_case:['app/hr-cases.mjs'],
    attendance_correction:['app/static/attendance-ui.mjs'],training:['app/talent.mjs'],resignation:['app/resignations.mjs'],travel:['app/travel.mjs'],benefit:['app/benefits-portal.mjs']};
  for(const [module,map] of Object.entries(MODULE_STATUS_MAP)){
    for(const [moduleStatus,entry] of Object.entries(map)){
      assert.ok(REQUEST_STATUSES.includes(entry.status),`${module}.${moduleStatus} → ${entry.status}`);
      assert.ok(entry.phrase&&entry.phrase.trim()===entry.phrase,`${module}.${moduleStatus} phrase`);
      if(home[module])assert.ok(home[module].some(file=>source(file).includes(`'${entry.phrase}'`)),`«${entry.phrase}» (${module}.${moduleStatus}) ليست في ${home[module].join(' أو ')}`);
    }
  }
  assert.deepEqual(canonicalStatus('leave','pending_manager'),{status:'pending',name:'بانتظار الاعتماد',module_phrase:'بانتظار المدير'});
  assert.deepEqual(canonicalStatus('custody','issued','en'),{status:'in_progress',name:'In progress',module_phrase:'مصروفة وقيد التسوية'});
  // حالة لا تعرفها الخريطة تعود كما هي بلا عبارة وحدة.
  assert.deepEqual(canonicalStatus('leave','invented'),{status:'invented',name:'invented',module_phrase:null});
  assert.deepEqual(canonicalStatus('nowhere','pending'),{status:'pending',name:'بانتظار الاعتماد',module_phrase:null});
});

test('vocabulary: a leave waiting for the authority holder is «pending» in «طلباتي», not a raw key',()=>{
  // عيب كامن وُجد أثناء الترحيل: خريطة الإجازات المحلية في app/my-requests.mjs لم تحمل pending_authority (وهي حالة حقيقية في app/leave.mjs)،
  // فكانت الحالة الموحدة لإجازة عند صاحب الصلاحية تخرج «pending_authority» نصًا خامًا.
  assert.ok(source('app/leave.mjs').includes('pending_authority'));
  assert.equal(canonicalStatus('leave','pending_authority').status,'pending');
  assert.ok(!/const leaveStatus=|const leaveNames=/.test(source('app/my-requests.mjs')),'الخريطتان المحليتان ذهبتا');
});

test('vocabulary: the journal entry badge no longer repeats «قيد», and the ambiguous phrase is gone',()=>{
  const j=MODULE_STATUS_MAP.journal;
  assert.deepEqual(Object.keys(j),['draft','pending','approved','posted','rejected']);
  assert.equal(j.pending.phrase,'بانتظار الاعتماد');assert.equal(j.posted.status,'completed');
  for(const entry of Object.values(j))assert.ok(!entry.phrase.startsWith('قيد '),entry.phrase);
  assert.ok(!source('app/static/statements-ui.mjs').includes('قيد بانتظار الاعتماد'));
});

test('vocabulary: six account roles, one name each',()=>{
  assert.deepEqual(Object.keys(ROLE_NAMES).sort(),['admin','employee','hr','it','manager','pm']);
  assert.equal(roleName('manager'),'مدير فريق');assert.equal(roleName('admin','en'),'Platform administrator');assert.equal(roleName('ghost'),'ghost');
  assert.equal(ROLE_NAMES_AR.hr,'الموارد البشرية');
});

test('vocabulary: the server and the browser read the same dictionary, and the files I own hold no copy',()=>{
  assert.equal(STATUS_WORDS,REQUEST_STATUS,'«طلباتي» تحمل القاموس نفسه لا نسخة منه');
  for(const file of ['app/my-requests.mjs','app/notices.mjs','app/static/app.mjs','app/static/home-ui.mjs','app/static/executive-ui.mjs','app/static/portal-ui.mjs','app/static/request-transparency-ui.mjs','app/static/statements-ui.mjs'])
    assert.equal(countStatusLiterals(source(file)),0,`${file} ما زال يحمل عبارة حالة أو خريطة محلية`);
  // نص الإشعار يقول كلمة الحالة كما تقولها الشارة.
  assert.match(source('app/notices.mjs'),/الحالة: \$\{S\.pending\}\./);
});

test('vocabulary: what is still outside the dictionary is only what the handoff lists',()=>{
  // app/home.mjs تملكها الموجة الأولى (STATUS_NAMES وعبارتها). app/receivables.mjs: «قيد الاعتماد» اسم شريحة أعمار مستحقات يثبّته اختبارها.
  const holdouts=new Set(['app/home.mjs','app/receivables.mjs']);
  for(const file of Object.keys(loadBaseline().status_literals))assert.ok(holdouts.has(file),`${file} يحمل عبارة حالة خارج القاموس وليس في قائمة التسليم`);
});
