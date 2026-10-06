import { randomUUID } from 'node:crypto';
import { audit, now } from './db.mjs';
import { fail } from './auth.mjs';
import * as v from './validation.mjs';
import { refuse } from './refusal.mjs';
import { currentUser } from './delegations.mjs';
import { can } from './access.mjs';

// العلاقات العامة: دليل جهات الإعلام، قوائم منتقاة تُقفل باعتماد شخص آخر، مراسلات تُرسل يدويًا خارج المنصة وتُسجَّل هنا،
// وتغطية يدخلها إنسان بنبرة يقدرها هو. لا مزوّد بريد، ولا رصد إعلامي آلي، ولا حصة صوت، ولا قيمة إعلانية مكتسبة.
export const OUTLET_TYPES=[['digital','رقمي'],['print','مطبوع'],['broadcast','بث'],['podcast','بودكاست']].map(([key,name])=>({key,name}));
export const LANGUAGES=[['ar','العربية'],['en','الإنجليزية'],['both','العربية والإنجليزية']].map(([key,name])=>({key,name}));
// أساس معالجة بيانات شخصية لطرف خارجي. الوصف هنا تشغيلي لا قانوني؛ التكييف النظامي يعود لسجل معالجة البيانات.
export const LAWFUL_BASES=[['consent','موافقة صريحة من الشخص'],['public_professional_source','بيانات تواصل مهنية معلنة من الوسيلة'],['contract','علاقة تعاقدية قائمة'],['other','أساس آخر يُشرح في الملاحظة']].map(([key,name])=>({key,name}));
export const PITCH_STATES={sent:'أُرسلت',replied:'رُدّ عليها',declined:'رُفضت',published:'نُشرت'};
export const TONES={positive:'إيجابية',neutral:'محايدة',negative:'سلبية'};
const CONTACT_STATES={active:'نشط',archived:'مؤرشف'};
const id=()=>randomUUID();
const today=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Riyadh'}).format(new Date());
const name=(db,userId)=>userId?db.prepare('SELECT name FROM users WHERE id=?').get(userId)?.name??null:null;
const label=(list,key)=>list.find(x=>x.key===key)?.name??key;
function writing(db){if(!db.isTransaction)fail(500,'transaction_required','تتطلب الكتابة معاملة قاعدة بيانات');}
function actor(db,supplied){const c=currentUser(db,supplied);if(!c)fail(403,'forbidden','الحساب غير متاح');return c;}
// دليل جهات الإعلام بيانات شخصية لأطراف خارجية: لا يُفتح إلا لحامل تصريح العلاقات العامة.
function gate(db,supplied){const u=actor(db,supplied);if(!can(db,u,'pr.manage'))fail(403,'not_permitted','مساحة العلاقات العامة لحامل تصريحها. اطلبه من مسؤول الصلاحيات');return u;}
function versioned(row,input){if(!Number.isInteger(input?.version)||input.version!==row.version)fail(409,'stale_version','تغير السجل منذ فتحه. أعد التحميل');}
const pick=(list,key,field,text)=>{if(!list.some(x=>x.key===key))fail(400,field,text);return key;};
function optional(db,u,table,value,field,text){
  if(!value)return null;
  if(typeof value!=='string'||!db.prepare(`SELECT 1 FROM ${table} WHERE id=? AND tenant_id=?`).get(value,u.tenant_id))fail(400,field,text);
  return value;
}
function beats(input){
  if(!Array.isArray(input)||!input.length||input.length>8)fail(400,'beats','من مجال تغطية إلى ثمانية');
  const clean=input.map(b=>v.text(b,'مجال التغطية',80,2));
  if(new Set(clean).size!==clean.length)fail(400,'beats','مجال التغطية مكرر');
  return JSON.stringify(clean);
}

/* ───── جهات الإعلام ───── */
function contactRow(db,u,contactId){
  const row=typeof contactId==='string'&&db.prepare('SELECT * FROM media_contacts WHERE id=? AND tenant_id=?').get(contactId,u.tenant_id);
  if(!row)fail(404,'not_found','جهة الإعلام غير متاحة');
  return row;
}
function contactView(db,u,row){
  const pitches=db.prepare('SELECT status,sent_on FROM pr_pitches WHERE tenant_id=? AND contact_id=? ORDER BY sent_on DESC').all(u.tenant_id,row.id);
  const actions=row.status==='active'?['edit_contact','archive_contact']:['restore_contact'];
  return {...row,beats:JSON.parse(row.beats),outlet_type_name:label(OUTLET_TYPES,row.outlet_type),language_name:label(LANGUAGES,row.language),
    lawful_basis_name:label(LAWFUL_BASES,row.lawful_basis),status_name:CONTACT_STATES[row.status],created_by_name:name(db,row.created_by),
    pitch_count:pitches.length,last_pitch_on:pitches[0]?.sent_on??null,published_count:pitches.filter(p=>p.status==='published').length,
    coverage_count:db.prepare('SELECT COUNT(*) AS n FROM pr_coverage WHERE tenant_id=? AND contact_id=?').get(u.tenant_id,row.id).n,actions};
}
export function mediaContactsBoard(db,supplied){
  const u=gate(db,supplied);
  const rows=db.prepare('SELECT * FROM media_contacts WHERE tenant_id=? ORDER BY status,outlet,name LIMIT 500').all(u.tenant_id);
  return {today:today(),outlet_types:OUTLET_TYPES,languages:LANGUAGES,lawful_bases:LAWFUL_BASES,
    contacts:rows.map(r=>contactView(db,u,r)),
    note:'هذه بيانات شخصية لأشخاص خارج الشركة. لا تُفتح إلا لحامل تصريح العلاقات العامة، ولا تدخل أي تصدير عام، ولكل سجل أساس جمعه ومصدره وتاريخه. حذف بيانات شخص طلبٌ يُعالَج في سجل معالجة البيانات لا حذف صف من هنا.'};
}
const CONTACT_FIELDS=['name','role_title','outlet','outlet_type','beats','language','preferences','email','phone','lawful_basis','basis_note','collected_on','source'];
function cleanContact(input){
  const email=input.email?v.text(input.email,'البريد',180):'';
  if(email&&!/^[^@\s]+@[^@\s.]+\.[^@\s]+$/.test(email))fail(400,'email','البريد غير صالح');
  const collected=v.date(input.collected_on);
  if(collected>today())fail(400,'collected_on','تاريخ الجمع لا يكون مستقبليًا');
  return {name:v.text(input.name,'اسم الصحفي أو المحرر',180,3),role:input.role_title?v.text(input.role_title,'صفته',120):'',
    outlet:v.text(input.outlet,'الوسيلة',180,2),type:pick(OUTLET_TYPES,input.outlet_type,'outlet_type','نوع الوسيلة غير متاح'),
    beats:beats(input.beats),language:pick(LANGUAGES,input.language,'language','لغة التواصل غير متاحة'),
    preferences:input.preferences?v.text(input.preferences,'تفضيلاته',2000):'',email,phone:input.phone?v.text(input.phone,'الهاتف',40):'',
    basis:pick(LAWFUL_BASES,input.lawful_basis,'lawful_basis','أساس الجمع غير متاح'),basisNote:v.text(input.basis_note,'شرح أساس الجمع',1500,10),
    collected,source:v.text(input.source,'مصدر البيانات',300,3)};
}
export function createContact(db,supplied,input){
  writing(db);const u=gate(db,supplied);v.object(input,CONTACT_FIELDS);
  const f=cleanContact(input);
  if(db.prepare('SELECT 1 FROM media_contacts WHERE tenant_id=? AND name=? AND outlet=?').get(u.tenant_id,f.name,f.outlet))fail(409,'duplicate_contact','هذا الاسم مسجل لهذه الوسيلة');
  const contactId=id(),time=now();
  db.prepare("INSERT INTO media_contacts(id,tenant_id,name,role_title,outlet,outlet_type,beats,language,preferences,email,phone,lawful_basis,basis_note,collected_on,source,status,created_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'active',?,?,?)")
    .run(contactId,u.tenant_id,f.name,f.role,f.outlet,f.type,f.beats,f.language,f.preferences,f.email,f.phone,f.basis,f.basisNote,f.collected,f.source,u.id,time,time);
  // لا تُسجَّل بيانات التواصل في سجل التدقيق: الأثر يحفظ الفعل لا المحتوى الشخصي.
  audit(db,u,'media_contact',contactId,'pr.contact_created',{}, {outlet:f.outlet,lawful_basis:f.basis});
  return {id:contactId};
}
export function contactAction(db,supplied,contactId,action,input){
  writing(db);const u=gate(db,supplied),row=contactRow(db,u,contactId),view=contactView(db,u,row);
  const key={edit:'edit_contact',archive:'archive_contact',restore:'restore_contact'}[action];
  if(!key||!view.actions.includes(key))fail(409,'invalid_state','الإجراء غير متاح في حالة السجل');
  versioned(row,input);
  const time=now();
  if(action==='edit'){
    v.object(input,['version',...CONTACT_FIELDS]);const f=cleanContact(input);
    db.prepare('UPDATE media_contacts SET name=?,role_title=?,outlet=?,outlet_type=?,beats=?,language=?,preferences=?,email=?,phone=?,lawful_basis=?,basis_note=?,collected_on=?,source=?,version=version+1,updated_at=? WHERE id=?')
      .run(f.name,f.role,f.outlet,f.type,f.beats,f.language,f.preferences,f.email,f.phone,f.basis,f.basisNote,f.collected,f.source,time,row.id);
  }else if(action==='archive'){
    v.object(input,['version','note']);
    db.prepare("UPDATE media_contacts SET status='archived',archive_note=?,version=version+1,updated_at=? WHERE id=?").run(v.text(input.note,'سبب الأرشفة',600,5),time,row.id);
  }else{
    v.object(input,['version','note']);
    db.prepare("UPDATE media_contacts SET status='active',archive_note=?,version=version+1,updated_at=? WHERE id=?").run(v.text(input.note,'سبب الإعادة',600,5),time,row.id);
  }
  audit(db,u,'media_contact',row.id,'pr.contact_'+action,{status:row.status},{version:row.version+1});
  return {id:row.id};
}

/* ───── القوائم ───── */
function listRow(db,u,listId){
  const row=typeof listId==='string'&&db.prepare('SELECT * FROM media_lists WHERE id=? AND tenant_id=?').get(listId,u.tenant_id);
  if(!row)fail(404,'not_found','القائمة غير متاحة');
  return row;
}
function listView(db,u,row){
  const members=db.prepare('SELECT m.*,c.name,c.outlet,c.outlet_type,c.status AS contact_status FROM media_list_members m JOIN media_contacts c ON c.id=m.contact_id WHERE m.list_id=? ORDER BY c.outlet,c.name').all(row.id);
  const own=row.created_by===u.id,actions=[];
  if(row.status==='draft'&&own)actions.push('add_member','remove_member');
  if(row.status==='draft'&&!own&&members.length)actions.push('lock_list');
  return {...row,status_name:row.status==='locked'?'مقفلة':'مسودة',created_by_name:name(db,row.created_by),locked_by_name:name(db,row.locked_by),own,
    members:members.map(m=>({contact_id:m.contact_id,name:m.name,outlet:m.outlet,outlet_type_name:label(OUTLET_TYPES,m.outlet_type),archived:m.contact_status==='archived',note:m.note})),actions};
}
export function createList(db,supplied,input){
  writing(db);const u=gate(db,supplied);v.object(input,['name','purpose','client_id','campaign_id']);
  const title=v.text(input.name,'اسم القائمة',180,3);
  if(db.prepare('SELECT 1 FROM media_lists WHERE tenant_id=? AND name=?').get(u.tenant_id,title))fail(409,'duplicate_list','توجد قائمة بالاسم نفسه');
  const listId=id(),time=now();
  db.prepare("INSERT INTO media_lists(id,tenant_id,name,purpose,client_id,campaign_id,status,created_by,created_at,updated_at) VALUES(?,?,?,?,?,?,'draft',?,?,?)")
    .run(listId,u.tenant_id,title,v.text(input.purpose,'الغرض من القائمة',2000,10),optional(db,u,'clients',input.client_id,'client_id','العميل غير متاح'),optional(db,u,'campaigns',input.campaign_id,'campaign_id','الحملة غير متاحة'),u.id,time,time);
  audit(db,u,'media_list',listId,'pr.list_created',{}, {name:title});
  return {id:listId};
}
export function listAction(db,supplied,listId,action,input){
  writing(db);const u=gate(db,supplied),row=listRow(db,u,listId),view=listView(db,u,row);
  const key={add:'add_member',remove:'remove_member',lock:'lock_list'}[action];
  if(!key||!view.actions.includes(key))fail(409,'invalid_state',row.status==='locked'?'القائمة مقفلة. تُستبدل بقائمة جديدة ولا تُعدل':'الإجراء غير متاح لحسابك في حالة القائمة');
  versioned(row,input);
  const time=now();
  if(action==='add'){
    v.object(input,['version','contact_id','note']);
    const contact=contactRow(db,u,input.contact_id);
    if(contact.status!=='active')fail(409,'contact_archived','جهة مؤرشفة لا تُضاف إلى قائمة');
    if(view.members.some(m=>m.contact_id===contact.id))fail(409,'already_member','الجهة في القائمة');
    db.prepare('INSERT INTO media_list_members(list_id,contact_id,note,added_by,added_at) VALUES(?,?,?,?,?)').run(row.id,contact.id,input.note?v.text(input.note,'سبب اختياره',600):'',u.id,time);
  }else if(action==='remove'){
    v.object(input,['version','contact_id']);
    if(!view.members.some(m=>m.contact_id===input.contact_id))fail(404,'not_found','الجهة ليست في القائمة');
    db.prepare('DELETE FROM media_list_members WHERE list_id=? AND contact_id=?').run(row.id,input.contact_id);
  }else{
    v.object(input,['version','note']);
    db.prepare("UPDATE media_lists SET status='locked',locked_by=?,locked_at=?,lock_note=?,version=version+1,updated_at=? WHERE id=?").run(u.id,time,v.text(input.note,'أساس اعتماد القائمة',1500,10),time,row.id);
  }
  if(action!=='lock')db.prepare('UPDATE media_lists SET version=version+1,updated_at=? WHERE id=?').run(time,row.id);
  audit(db,u,'media_list',row.id,'pr.list_'+action,{status:row.status},{version:row.version+1});
  return {id:row.id};
}

/* ───── المراسلات ───── */
function pitchRow(db,u,pitchId){
  const row=typeof pitchId==='string'&&db.prepare('SELECT * FROM pr_pitches WHERE id=? AND tenant_id=?').get(pitchId,u.tenant_id);
  if(!row)fail(404,'not_found','المراسلة غير متاحة');
  return row;
}
function pitchView(db,u,row){
  const contact=db.prepare('SELECT name,outlet FROM media_contacts WHERE id=?').get(row.contact_id);
  return {...row,status_name:PITCH_STATES[row.status],contact_name:contact?.name??'',outlet:contact?.outlet??'',recorded_by_name:name(db,row.recorded_by),
    coverage_count:db.prepare('SELECT COUNT(*) AS n FROM pr_coverage WHERE pitch_id=?').get(row.id).n,
    actions:row.status==='sent'?['record_reply','record_decline','record_published']:row.status==='replied'?['record_decline','record_published']:[]};
}
export function createPitch(db,supplied,input){
  writing(db);const u=gate(db,supplied);
  v.object(input,['contact_id','list_id','client_id','campaign_id','subject','angle','sent_on','sent_via']);
  const contact=contactRow(db,u,input.contact_id);
  // PR-01: الجهة المؤرشفة (طلب عدم تواصل، أو تركت وسيلتها) لا تُسجَّل لها مراسلة جديدة؛ والرفض يقول ما يعيد التواصل ممكنًا.
  if(contact.status!=='active')refuse(409,'contact_archived',{what:`«${contact.name}» مؤرشفة، فما تنسجل لها مراسلة جديدة من المنصة`,
    missing:[{document:'إعادة الجهة نشطةً بسبب مكتوب',why:contact.archive_note?`سبب الأرشفة: ${contact.archive_note}`:'الجهة مؤرشفة',owner:'فريق العلاقات العامة',owner_role:'pr'}],
    next:'لا تراسلها؛ وإذا زال سبب الأرشفة فأعدها من «جهات الإعلام» بسببها، ثم سجّل المراسلة'});
  const sent=v.date(input.sent_on);if(sent>today())fail(400,'sent_on','تاريخ الإرسال لا يكون مستقبليًا');
  const listId=input.list_id?listRow(db,u,input.list_id).id:null;
  const pitchId=id(),time=now();
  db.prepare("INSERT INTO pr_pitches(id,tenant_id,contact_id,list_id,client_id,campaign_id,subject,angle,sent_on,sent_via,status,recorded_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,'sent',?,?,?)")
    .run(pitchId,u.tenant_id,contact.id,listId,optional(db,u,'clients',input.client_id,'client_id','العميل غير متاح'),optional(db,u,'campaigns',input.campaign_id,'campaign_id','الحملة غير متاحة'),
      v.text(input.subject,'موضوع المراسلة',200,3),v.text(input.angle,'الزاوية المطروحة',3000,10),sent,v.text(input.sent_via,'كيف أُرسلت (بريد الموظف، رسالة، لقاء)',200,3),u.id,time,time);
  audit(db,u,'pr_pitch',pitchId,'pr.pitch_recorded',{}, {contact_id:contact.id,sent_on:sent});
  return {id:pitchId};
}
export function pitchAction(db,supplied,pitchId,action,input){
  writing(db);const u=gate(db,supplied),row=pitchRow(db,u,pitchId),view=pitchView(db,u,row);
  const key={reply:'record_reply',decline:'record_decline',published:'record_published'}[action];
  if(!key||!view.actions.includes(key))fail(409,'invalid_state','الحالة لا تقبل هذا التسجيل');
  versioned(row,input);
  v.object(input,['version','outcome_on','note']);
  const on=v.date(input.outcome_on);
  if(on<row.sent_on||on>today())fail(400,'outcome_on','تاريخ الرد بين تاريخ الإرسال واليوم');
  const status={reply:'replied',decline:'declined',published:'published'}[action];
  db.prepare('UPDATE pr_pitches SET status=?,outcome_on=?,outcome_note=?,version=version+1,updated_at=? WHERE id=?')
    .run(status,on,v.text(input.note,'ما الذي جرى بالضبط',2000,5),now(),row.id);
  audit(db,u,'pr_pitch',row.id,'pr.pitch_'+action,{status:row.status},{status});
  return {id:row.id};
}

/* ───── التغطية ───── */
function coverageRow(db,u,coverageId){
  const row=typeof coverageId==='string'&&db.prepare('SELECT * FROM pr_coverage WHERE id=? AND tenant_id=?').get(coverageId,u.tenant_id);
  if(!row)fail(404,'not_found','التغطية غير متاحة');
  return row;
}
function coverageView(db,u,row){
  const client=row.client_id?db.prepare('SELECT trade_name,legal_name FROM clients WHERE id=?').get(row.client_id):null;
  return {...row,highlight:!!row.highlight,tone_name:TONES[row.tone],outlet_type_name:label(OUTLET_TYPES,row.outlet_type),
    recorded_by_name:name(db,row.recorded_by),client_name:client?client.trade_name||client.legal_name:null,
    campaign_name:row.campaign_id?db.prepare('SELECT name FROM campaigns WHERE id=?').get(row.campaign_id)?.name??null:null,
    actions:['edit_coverage']};
}
const COVERAGE_FIELDS=['pitch_id','contact_id','client_id','campaign_id','outlet','outlet_type','title','url','published_on','tone','tone_reason','highlight','highlight_reason','summary'];
function cleanCoverage(db,u,input){
  const url=v.text(input.url,'رابط التغطية',600,12);
  if(!/^https?:\/\/[^\s]+$/.test(url))fail(400,'url','الرابط يبدأ بـ http أو https');
  const on=v.date(input.published_on);if(on>today())fail(400,'published_on','تاريخ النشر لا يكون مستقبليًا');
  const highlight=input.highlight===true||input.highlight==='yes';
  return {outlet:v.text(input.outlet,'الوسيلة',180,2),type:pick(OUTLET_TYPES,input.outlet_type,'outlet_type','نوع الوسيلة غير متاح'),
    title:v.text(input.title,'عنوان التغطية',300,3),url,on,
    tone:Object.hasOwn(TONES,input.tone)?input.tone:fail(400,'tone','النبرة: إيجابية أو محايدة أو سلبية'),
    reason:v.text(input.tone_reason,'لماذا قدّرت النبرة هكذا',1500,10),
    highlight:highlight?1:0,highlightReason:highlight?v.text(input.highlight_reason,'لماذا هي من أبرز التغطيات',600,10):'',
    summary:input.summary?v.text(input.summary,'خلاصة ما ورد',3000):'',
    client:optional(db,u,'clients',input.client_id,'client_id','العميل غير متاح'),campaign:optional(db,u,'campaigns',input.campaign_id,'campaign_id','الحملة غير متاحة')};
}
export function createCoverage(db,supplied,input){
  writing(db);const u=gate(db,supplied);v.object(input,COVERAGE_FIELDS);
  const f=cleanCoverage(db,u,input);
  const pitch=input.pitch_id?pitchRow(db,u,input.pitch_id):null;
  const contactId=input.contact_id?contactRow(db,u,input.contact_id).id:pitch?.contact_id??null;
  if(db.prepare('SELECT 1 FROM pr_coverage WHERE tenant_id=? AND url=?').get(u.tenant_id,f.url))fail(409,'duplicate_coverage','هذا الرابط مسجل. التغطية لا تُحتسب مرتين');
  const coverageId=id(),time=now();
  db.prepare('INSERT INTO pr_coverage(id,tenant_id,pitch_id,contact_id,client_id,campaign_id,outlet,outlet_type,title,url,published_on,tone,tone_reason,highlight,highlight_reason,summary,recorded_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
    .run(coverageId,u.tenant_id,pitch?.id??null,contactId,f.client??pitch?.client_id??null,f.campaign??pitch?.campaign_id??null,f.outlet,f.type,f.title,f.url,f.on,f.tone,f.reason,f.highlight,f.highlightReason,f.summary,u.id,time,time);
  audit(db,u,'pr_coverage',coverageId,'pr.coverage_recorded',{}, {outlet:f.outlet,tone:f.tone});
  return {id:coverageId};
}
export function coverageAction(db,supplied,coverageId,action,input){
  writing(db);const u=gate(db,supplied),row=coverageRow(db,u,coverageId);
  if(action!=='edit')fail(404,'not_found','الإجراء غير متاح');
  versioned(row,input);
  v.object(input,['version',...COVERAGE_FIELDS.filter(k=>!['pitch_id','contact_id'].includes(k))]);
  const f=cleanCoverage(db,u,input);
  const clash=db.prepare('SELECT id FROM pr_coverage WHERE tenant_id=? AND url=?').get(u.tenant_id,f.url);
  if(clash&&clash.id!==row.id)fail(409,'duplicate_coverage','هذا الرابط مسجل لتغطية أخرى');
  db.prepare('UPDATE pr_coverage SET client_id=?,campaign_id=?,outlet=?,outlet_type=?,title=?,url=?,published_on=?,tone=?,tone_reason=?,highlight=?,highlight_reason=?,summary=?,version=version+1,updated_at=? WHERE id=?')
    .run(f.client,f.campaign,f.outlet,f.type,f.title,f.url,f.on,f.tone,f.reason,f.highlight,f.highlightReason,f.summary,now(),row.id);
  audit(db,u,'pr_coverage',row.id,'pr.coverage_edited',{tone:row.tone},{tone:f.tone});
  return {id:row.id};
}

/* ───── اللوحة والتقرير ───── */
// تقرير التغطية: عدّ وتوزيع وأبرز ما سجّله الإنسان. بلا قيمة إعلانية مكتسبة ولا حصة صوت ولا تحليل مشاعر آلي:
// كلها تحتاج منهجية معلنة أو اشتراكًا خارجيًا لا نملكه، وأي رقم منها سيكون اختراعًا.
export function coverageReport(db,supplied,filter={}){
  const u=gate(db,supplied);
  const clientId=filter.client_id?optional(db,u,'clients',filter.client_id,'client_id','العميل غير متاح'):null;
  const campaignId=filter.campaign_id?optional(db,u,'campaigns',filter.campaign_id,'campaign_id','الحملة غير متاحة'):null;
  const where=['tenant_id=?'],args=[u.tenant_id];
  if(clientId){where.push('client_id=?');args.push(clientId);}
  if(campaignId){where.push('campaign_id=?');args.push(campaignId);}
  const rows=db.prepare(`SELECT * FROM pr_coverage WHERE ${where.join(' AND ')} ORDER BY published_on DESC LIMIT 1000`).all(...args);
  const count=(keyOf,names)=>{const map=new Map();for(const r of rows)map.set(keyOf(r),(map.get(keyOf(r))??0)+1);
    return [...map].sort((a,b)=>b[1]-a[1]).map(([key,n])=>({key,name:names?names(key):key,count:n}));};
  const pitches=db.prepare(`SELECT status FROM pr_pitches WHERE tenant_id=?${clientId?' AND client_id=?':''}${campaignId?' AND campaign_id=?':''}`).all(u.tenant_id,...(clientId?[clientId]:[]),...(campaignId?[campaignId]:[]));
  return {today:today(),client_id:clientId,campaign_id:campaignId,total:rows.length,
    by_outlet:count(r=>r.outlet),by_type:count(r=>r.outlet_type,k=>label(OUTLET_TYPES,k)),by_tone:count(r=>r.tone,k=>TONES[k]),by_month:count(r=>r.published_on.slice(0,7)).sort((a,b)=>a.key<b.key?1:-1),
    highlights:rows.filter(r=>r.highlight).map(r=>({id:r.id,title:r.title,outlet:r.outlet,url:r.url,published_on:r.published_on,tone_name:TONES[r.tone],reason:r.highlight_reason})),
    pitches:{sent:pitches.length,replied:pitches.filter(p=>p.status==='replied').length,declined:pitches.filter(p=>p.status==='declined').length,published:pitches.filter(p=>p.status==='published').length},
    note:'عدّ وتوزيع لما أدخله الإنسان فقط. لا قيمة إعلانية مكتسبة ولا حصة صوت ولا تحليل مشاعر آلي: كل رقم منها يحتاج منهجية معلنة أو اشتراكًا خارجيًا لا نملكه.'};
}
export function prBoard(db,supplied,filter={}){
  const u=gate(db,supplied);
  const lists=db.prepare('SELECT * FROM media_lists WHERE tenant_id=? ORDER BY status,created_at DESC LIMIT 200').all(u.tenant_id).map(r=>listView(db,u,r));
  const pitches=db.prepare('SELECT * FROM pr_pitches WHERE tenant_id=? ORDER BY sent_on DESC,created_at DESC LIMIT 300').all(u.tenant_id).map(r=>pitchView(db,u,r));
  const coverage=db.prepare('SELECT * FROM pr_coverage WHERE tenant_id=? ORDER BY published_on DESC LIMIT 300').all(u.tenant_id).map(r=>coverageView(db,u,r));
  return {today:today(),user_id:u.id,outlet_types:OUTLET_TYPES,tones:TONES,pitch_states:PITCH_STATES,
    contacts:db.prepare("SELECT id,name,outlet FROM media_contacts WHERE tenant_id=? AND status='active' ORDER BY outlet,name LIMIT 500").all(u.tenant_id),
    clients:db.prepare('SELECT id,legal_name,trade_name FROM clients WHERE tenant_id=? ORDER BY legal_name LIMIT 300').all(u.tenant_id).map(c=>({id:c.id,name:c.trade_name||c.legal_name})),
    campaigns:db.prepare("SELECT id,name FROM campaigns WHERE tenant_id=? AND status NOT IN ('completed','cancelled') ORDER BY name LIMIT 300").all(u.tenant_id),
    lists,pitches,coverage,report:coverageReport(db,u,filter),
    note:'الإرسال يدوي خارج المنصة: لا مزوّد بريد موصول، والمنصة تسجل ما جرى فقط. النبرة تقدير من سجّل التغطية لا تحليل آلي، ولا رصد إعلامي آلي في هذه النسخة.'};
}
