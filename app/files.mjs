import { randomUUID } from 'node:crypto';
import { audit, now, hash } from './db.mjs';
import { fail } from './auth.mjs';
import * as v from './validation.mjs';
import { currentUser } from './delegations.mjs';
import { holds } from './access.mjs';
import { getVendor } from './vendors.mjs';
import { getApproval } from './client-approvals.mjs';
import { getContract } from './hr-contracts.mjs';
import { getClaim } from './expenses.mjs';
import { caseFileAccess } from './discipline.mjs';
import { getLeaveRequest } from './leave.mjs';
import { proofFileAccess } from './influencers.mjs';

// ملفات الوثائق والأدلة. من لا يرى السجل لا يرى ملفاته؛ والملف المقيد (إثبات حساب بنكي) لحامل تصريح التحقق المالي فقط.
// النوع يُحدد من توقيع المحتوى لا من الامتداد، والملف لا يُعدل ولا يُحذف بعد رفعه.
const SIGNATURES=[['application/pdf',Buffer.from('%PDF-')],['image/png',Buffer.from([137,80,78,71,13,10,26,10])],['image/jpeg',Buffer.from([0xFF,0xD8,0xFF])]];
const ENTITIES={
  vendor:(db,u,id)=>{const x=getVendor(db,u,id);return {canUpload:x.actions.includes('add_document'),canRestricted:holds(db,u,'vendors.bank')};},
  external_approval:(db,u,id)=>{const x=getApproval(db,u,id);return {canUpload:x.recorded_by===u.id&&x.status!=='withdrawn',canRestricted:false};},
  employment_contract:(db,u,id)=>{const x=getContract(db,u,id);return {canUpload:!x.own&&holds(db,u,'hr.contracts.manage'),canRestricted:false};},
  expense_claim:(db,u,id)=>{const x=getClaim(db,u,id);return {canUpload:x.own&&x.status==='submitted',canRestricted:false};},
  // أدلة قضية الانضباط (ترحيل 097): يراها صاحب الشأن والموارد البشرية والمسجِّل، ويرفعها المسجِّل أو الموارد البشرية والقضية مفتوحة.
  discipline_case:(db,u,id)=>caseFileAccess(db,u,id),
  // مستند طلب الإجازة (ترحيل 098): يرفعه صاحب الطلب ما دام قائمًا، ويراه من يرى الطلب (المدير وصاحب الصلاحية وخدمات الموظف).
  leave_request:(db,u,id)=>{const x=getLeaveRequest(db,u,id);return {canUpload:x.can_attach,canRestricted:false};},
  // لقطة إثبات نشر المؤثر (ترحيل 189): يراها من يدير المؤثرين في فريق حساب العميل، ويرفعها مسجّل الإثبات قبل التحقق منه.
  influencer_proof:(db,u,id)=>proofFileAccess(db,u,id)
};
function actor(db,supplied){const u=currentUser(db,supplied);if(!u)fail(403,'forbidden','الحساب غير متاح');return u;}
function entityAccess(db,u,type,id){if(!Object.hasOwn(ENTITIES,type)||typeof id!=='string')fail(404,'not_found','السجل غير متاح');return ENTITIES[type](db,u,id);}
const meta=f=>({id:f.id,label:f.label,filename:f.filename,media_type:f.media_type,size:f.size,restricted:!!f.restricted,uploaded_by_name:f.uploaded_by_name,created_at:f.created_at});

export function listFiles(db,supplied,type,entityId){
  const u=actor(db,supplied),access=entityAccess(db,u,type,entityId);
  const rows=db.prepare('SELECT f.*,x.name AS uploaded_by_name FROM stored_files f JOIN users x ON x.id=f.uploaded_by WHERE f.tenant_id=? AND f.entity_type=? AND f.entity_id=? ORDER BY f.created_at').all(u.tenant_id,type,entityId);
  return {can_upload:access.canUpload,files:rows.map(f=>({...meta(f),downloadable:!f.restricted||access.canRestricted}))};
}
// فهرس ملفات عدة سجلات من نوع واحد؛ السجل الذي لا يراه المستخدم يُحذف من النتيجة بصمت.
export function filesIndex(db,supplied,type,ids){
  if(!Array.isArray(ids)||ids.length>80||ids.some(x=>typeof x!=='string'||!/^[a-f0-9-]{36}$/.test(x)))fail(400,'invalid_fields','معرّفات السجلات غير صالحة');
  const index={};
  for(const id of new Set(ids)){try{index[id]=listFiles(db,supplied,type,id);}catch(error){if(![403,404].includes(error.status))throw error;}}
  return {entity_type:type,index};
}
export function uploadFile(db,supplied,input){
  if(!db.isTransaction)fail(500,'transaction_required','يتطلب رفع الملف معاملة');
  const u=actor(db,supplied);
  v.object(input,['entity_type','entity_id','label','filename','content','restricted']);
  const access=entityAccess(db,u,input.entity_type,input.entity_id);
  if(!access.canUpload)fail(403,'not_permitted','رفع الملفات على هذا السجل خارج صلاحيتك أو حالته');
  const filename=v.text(input.filename,'اسم الملف',120);
  if([...filename].some(ch=>ch.charCodeAt(0)<32||ch.charCodeAt(0)===127||ch==='/'||ch==='\\')||filename.includes('..'))fail(400,'filename','اسم الملف غير صالح');
  if(typeof input.content!=='string'||input.content.length>2800000||!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(input.content))fail(400,'content','ترميز الملف غير صالح');
  const data=Buffer.from(input.content,'base64');
  if(data.length<1||data.length>2097152)fail(413,'file_size','الحد الأقصى للملف 2 ميغابايت');
  const media=SIGNATURES.find(([,signature])=>data.subarray(0,signature.length).equals(signature))?.[0];
  if(!media)fail(400,'file_type','الأنواع المسموحة: PDF وPNG وJPEG بتوقيع محتوى مطابق');
  const digest=hash(data);
  if(db.prepare('SELECT 1 FROM stored_files WHERE tenant_id=? AND entity_type=? AND entity_id=? AND digest=?').get(u.tenant_id,input.entity_type,input.entity_id,digest))fail(409,'duplicate_file','هذا الملف مرفوع على السجل نفسه');
  const fileId=randomUUID(),restricted=input.restricted===true&&input.entity_type==='vendor'?1:0;
  db.prepare('INSERT INTO stored_files VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)').run(fileId,u.tenant_id,input.entity_type,input.entity_id,v.text(input.label,'وصف الملف',180,3),filename,media,data.length,digest,data,restricted,u.id,now());
  audit(db,u,'file',fileId,'file.uploaded',{}, {entity_type:input.entity_type,entity_id:input.entity_id,size:data.length,restricted:!!restricted});
  return {id:fileId};
}
export function downloadFile(db,supplied,fileId){
  const u=actor(db,supplied),f=typeof fileId==='string'&&db.prepare('SELECT * FROM stored_files WHERE id=? AND tenant_id=?').get(fileId,u.tenant_id);
  if(!f)fail(404,'not_found','الملف غير متاح');
  const access=entityAccess(db,u,f.entity_type,f.entity_id);
  if(f.restricted&&!access.canRestricted)fail(404,'not_found','الملف غير متاح');
  if(hash(Buffer.from(f.content))!==f.digest)fail(409,'file_corrupted','بصمة الملف لا تطابق محتواه');
  audit(db,u,'file',f.id,'file.downloaded',{}, {entity_type:f.entity_type});
  return {filename:f.filename,media_type:f.media_type,content:Buffer.from(f.content)};
}
