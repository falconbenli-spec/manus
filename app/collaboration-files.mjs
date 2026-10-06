import { randomUUID } from 'node:crypto';
import { audit, hash, now } from './db.mjs';
import { fail } from './auth.mjs';
import * as v from './validation.mjs';
import { collaborationActor } from './collaboration-access.mjs';

const SIGNATURES=[['application/pdf',Buffer.from('%PDF-')],['image/png',Buffer.from([137,80,78,71,13,10,26,10])],['image/jpeg',Buffer.from([0xFF,0xD8,0xFF])]];
function writing(db){if(!db.isTransaction)fail(500,'transaction_required','تعديل ملفات مساحة العمل يحتاج معاملة قاعدة بيانات');}
function access(db,u,spaceId,action='space.files'){
  const actor=collaborationActor(db,u,spaceId);if(!actor.capabilities.includes(action))fail(403,'space_forbidden','ملفات مساحة العمل غير متاحة لك');return actor;
}
function folder(db,spaceId,id){if(id===undefined||id===null)return null;const row=db.prepare('SELECT * FROM workspace_folders WHERE id=? AND space_id=?').get(id,spaceId);if(!row)fail(404,'folder_not_found','المجلد غير متاح؛ اختر مجلدًا ظاهرًا في مساحة العمل');return row;}
function filename(value){
  const clean=v.text(value,'اسم الملف',120);
  if([...clean].some(ch=>ch.charCodeAt(0)<32||ch.charCodeAt(0)===127||ch==='/'||ch==='\\')||clean.includes('..'))fail(400,'filename','اسم الملف غير صالح؛ استخدم اسمًا بلا مسار أو محارف تحكم');
  return clean;
}
function bytes(value){
  if(typeof value!=='string'||value.length>2800000||!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value))fail(400,'content','ترميز الملف غير صالح؛ أعد اختيار ملف صالح من جهازك');
  const data=Buffer.from(value,'base64');if(data.length<1||data.length>2097152)fail(413,'file_size','الحد الأقصى للملف 2 ميغابايت');
  const media=SIGNATURES.find(([,signature])=>data.subarray(0,signature.length).equals(signature))?.[0];if(!media)fail(400,'file_type','الأنواع المسموحة: PDF وPNG وJPEG بتوقيع محتوى مطابق');
  return {data,media,digest:hash(data)};
}
function fileMeta(db,row){
  const version=db.prepare('SELECT id,version,filename,media_type,size,digest,scan_state,uploaded_by,created_at FROM workspace_file_versions WHERE file_id=? AND version=?').get(row.id,row.current_version);
  return {...row,id:row.id,record_version:row.version,current_version:row.current_version,file_version_id:version?.id,
    filename:version?.filename,media_type:version?.media_type,size:version?.size,digest:version?.digest,scan_state:version?.scan_state,
    uploaded_by:version?.uploaded_by,version_created_at:version?.created_at};
}
function activity(db,u,spaceId,type,id,action,details={}){db.prepare(`INSERT INTO space_activity(tenant_id,space_id,actor_id,entity_type,entity_id,action,details_json,created_at)
  VALUES(?,?,?,?,?,?,?,?)`).run(u.tenant_id,spaceId,u.id,type,id,action,JSON.stringify(details),now());}

export function filesBoard(db,u,spaceId){
  access(db,u,spaceId);
  const folders=db.prepare('SELECT * FROM workspace_folders WHERE space_id=? ORDER BY name,id').all(spaceId).map(row=>({...row}));
  const documents=db.prepare(`SELECT d.*,r.digest,r.authored_by,r.created_at AS revision_created_at
    FROM workspace_documents d LEFT JOIN workspace_document_revisions r ON r.document_id=d.id AND r.revision=d.current_revision
    WHERE d.space_id=? ORDER BY d.updated_at DESC,d.id`).all(spaceId).map(row=>({...row}));
  const files=db.prepare('SELECT * FROM workspace_files WHERE space_id=? ORDER BY updated_at DESC,id').all(spaceId).map(row=>fileMeta(db,row));
  return {folders,documents,files};
}

export function createFolder(db,u,spaceId,input){
  writing(db);access(db,u,spaceId);v.object(input,['name','parent_id']);folder(db,spaceId,input.parent_id);
  const id=randomUUID(),stamp=now();db.prepare(`INSERT INTO workspace_folders(id,tenant_id,space_id,parent_id,name,created_by,created_at)
    VALUES(?,?,?,?,?,?,?)`).run(id,u.tenant_id,spaceId,input.parent_id??null,v.text(input.name,'اسم المجلد',100),u.id,stamp);
  activity(db,u,spaceId,'folder',id,'folder.created',{});return db.prepare('SELECT * FROM workspace_folders WHERE id=?').get(id);
}

export function createDocument(db,u,spaceId,input){
  writing(db);access(db,u,spaceId);v.object(input,['folder_id','title','body']);folder(db,spaceId,input.folder_id);
  const id=randomUUID(),stamp=now(),body=v.text(input.body,'محتوى المستند',100000,1),digest=hash(body);
  db.prepare(`INSERT INTO workspace_documents(id,tenant_id,space_id,folder_id,title,current_revision,created_by,created_at,updated_at)
    VALUES(?,?,?,?,?,1,?,?,?)`).run(id,u.tenant_id,spaceId,input.folder_id??null,v.text(input.title,'عنوان المستند',180,2),u.id,stamp,stamp);
  db.prepare(`INSERT INTO workspace_document_revisions(id,tenant_id,document_id,revision,body,digest,authored_by,created_at)
    VALUES(?,?,?,?,?,?,?,?)`).run(randomUUID(),u.tenant_id,id,1,body,digest,u.id,stamp);
  activity(db,u,spaceId,'document',id,'document.created',{revision:1,digest});
  return db.prepare('SELECT * FROM workspace_documents WHERE id=?').get(id);
}

export function saveDocumentRevision(db,u,spaceId,documentId,input){
  writing(db);access(db,u,spaceId);v.object(input,['version','body','note','title']);
  const doc=db.prepare('SELECT * FROM workspace_documents WHERE id=? AND space_id=?').get(documentId,spaceId);if(!doc)fail(404,'document_not_found','المستند غير متاح؛ حدّث قائمة المستندات ثم حاول مرة أخرى');v.version(input.version,doc.version);
  const body=v.text(input.body,'محتوى المستند',100000,1),digest=hash(body),revision=doc.current_revision+1,stamp=now();
  if(db.prepare('SELECT 1 FROM workspace_document_revisions WHERE document_id=? AND digest=?').get(doc.id,digest))fail(409,'duplicate_revision','هذه النسخة محفوظة من قبل؛ عدّل المحتوى قبل حفظ نسخة جديدة');
  db.prepare(`INSERT INTO workspace_document_revisions(id,tenant_id,document_id,revision,body,digest,note,authored_by,created_at)
    VALUES(?,?,?,?,?,?,?,?,?)`).run(randomUUID(),u.tenant_id,doc.id,revision,body,digest,input.note?v.text(input.note,'ملاحظة النسخة',500):'',u.id,stamp);
  db.prepare('UPDATE workspace_documents SET title=?,current_revision=?,version=version+1,updated_at=? WHERE id=?')
    .run(input.title===undefined?doc.title:v.text(input.title,'عنوان المستند',180,2),revision,stamp,doc.id);
  activity(db,u,spaceId,'document',doc.id,'document.revised',{revision,digest});return db.prepare('SELECT * FROM workspace_documents WHERE id=?').get(doc.id);
}

export function uploadWorkspaceFile(db,u,spaceId,input){
  writing(db);access(db,u,spaceId);v.object(input,['folder_id','label','filename','content','replaces_id']);folder(db,spaceId,input.folder_id);
  const parsed=bytes(input.content),stamp=now();let file,version;
  if(input.replaces_id){
    file=db.prepare('SELECT * FROM workspace_files WHERE id=? AND space_id=?').get(input.replaces_id,spaceId);if(!file)fail(404,'file_not_found','الملف غير متاح؛ حدّث قائمة الملفات ثم حاول مرة أخرى');
    version=file.current_version+1;if(db.prepare('SELECT 1 FROM workspace_file_versions WHERE file_id=? AND digest=?').get(file.id,parsed.digest))fail(409,'duplicate_file','هذه النسخة مرفوعة من قبل؛ اختر نسخة مختلفة قبل الرفع');
    db.prepare('UPDATE workspace_files SET label=?,folder_id=?,current_version=?,version=version+1,updated_at=? WHERE id=?')
      .run(v.text(input.label,'وصف الملف',180,2),input.folder_id??file.folder_id,version,stamp,file.id);
  }else{
    file={id:randomUUID()};version=1;db.prepare(`INSERT INTO workspace_files(id,tenant_id,space_id,folder_id,label,current_version,created_by,created_at,updated_at)
      VALUES(?,?,?,?,?,1,?,?,?)`).run(file.id,u.tenant_id,spaceId,input.folder_id??null,v.text(input.label,'وصف الملف',180,2),u.id,stamp,stamp);
  }
  const versionId=randomUUID(),scanState=process.env.WORKSPACE_FILE_SCANNER==='clean'?'clean':'unavailable';
  db.prepare(`INSERT INTO workspace_file_versions(id,tenant_id,file_id,version,filename,media_type,size,digest,content,scan_state,uploaded_by,created_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`).run(versionId,u.tenant_id,file.id,version,filename(input.filename),parsed.media,parsed.data.length,parsed.digest,parsed.data,scanState,u.id,stamp);
  activity(db,u,spaceId,'file',file.id,'file.version_uploaded',{version,digest:parsed.digest,scan_state:scanState});
  audit(db,u,'workspace_file',file.id,'file.version_uploaded',{}, {space_id:spaceId,version,digest:parsed.digest,size:parsed.data.length,scan_state:scanState});
  return fileMeta(db,db.prepare('SELECT * FROM workspace_files WHERE id=?').get(file.id));
}

function evidenceEntity(db,spaceId,type,id){
  if(type==='space_task')return db.prepare('SELECT 1 FROM space_tasks WHERE id=? AND space_id=?').get(id,spaceId);
  if(type==='project_task')return db.prepare(`SELECT 1 FROM tasks t JOIN collaboration_spaces s ON s.target_kind='project' AND s.target_id=t.project_id WHERE t.id=? AND s.id=?`).get(id,spaceId);
  if(type==='topic')return db.prepare('SELECT 1 FROM workspace_topics WHERE id=? AND space_id=?').get(id,spaceId);
  if(type==='event')return db.prepare('SELECT 1 FROM workspace_events WHERE id=? AND space_id=?').get(id,spaceId);
  return null;
}
export function publishFileAsEvidence(db,u,spaceId,fileId,input){
  writing(db);access(db,u,spaceId);v.object(input,['version','entity_type','entity_id','label']);
  const file=db.prepare('SELECT * FROM workspace_files WHERE id=? AND space_id=?').get(fileId,spaceId);if(!file)fail(404,'file_not_found','الملف غير متاح؛ حدّث قائمة الملفات ثم حاول مرة أخرى');
  if(!Number.isInteger(input.version)||input.version<1||input.version>file.current_version)fail(409,'file_version','نسخة الملف غير موجودة؛ اختر نسخة ظاهرة في سجل الملف');
  if(!evidenceEntity(db,spaceId,input.entity_type,input.entity_id))fail(404,'evidence_target','سجل الدليل غير متاح؛ افتح السجل من مساحة العمل ثم حاول مرة أخرى');
  const version=db.prepare('SELECT * FROM workspace_file_versions WHERE file_id=? AND version=?').get(file.id,input.version),id=randomUUID(),stamp=now();
  db.prepare(`INSERT INTO workspace_evidence_links(id,tenant_id,space_id,entity_type,entity_id,source_type,source_id,source_version,digest,label,published_by,published_at)
    VALUES(?,?,?,?,?,'file',?,?,?,?,?,?)`).run(id,u.tenant_id,spaceId,input.entity_type,input.entity_id,file.id,version.version,version.digest,v.text(input.label,'اسم الدليل',180,2),u.id,stamp);
  activity(db,u,spaceId,'evidence',id,'evidence.published',{entity_type:input.entity_type,entity_id:input.entity_id,file_id:file.id,version:version.version,digest:version.digest});
  audit(db,u,'workspace_evidence',id,'evidence.published',{}, {space_id:spaceId,entity_type:input.entity_type,entity_id:input.entity_id,digest:version.digest});
  return db.prepare('SELECT * FROM workspace_evidence_links WHERE id=?').get(id);
}

export function downloadWorkspaceFile(db,u,spaceId,fileId,{version=null,allow_unavailable=false}={}){
  access(db,u,spaceId);const file=db.prepare('SELECT * FROM workspace_files WHERE id=? AND space_id=?').get(fileId,spaceId);if(!file)fail(404,'file_not_found','الملف غير متاح؛ حدّث قائمة الملفات ثم حاول مرة أخرى');
  const selected=version??file.current_version,row=db.prepare('SELECT * FROM workspace_file_versions WHERE file_id=? AND version=?').get(file.id,selected);if(!row)fail(404,'file_version','نسخة الملف غير متاحة؛ اختر نسخة ظاهرة في سجل الملف');
  if(row.scan_state==='blocked')fail(409,'file_blocked','حُجب الملف بعد الفحص الأمني');
  if(row.scan_state==='pending')fail(409,'scan_pending','فحص الملف لم يكتمل بعد؛ انتظر اكتمال الفحص قبل التنزيل');
  if(row.scan_state==='unavailable'&&!(allow_unavailable&&process.env.NODE_ENV!=='production'))fail(409,'scan_unavailable','فحص الملفات غير متصل؛ لا يمكن تنزيله بوصفه آمنًا');
  const content=Buffer.from(row.content);if(hash(content)!==row.digest)fail(409,'file_corrupted','بصمة الملف لا تطابق محتواه');
  audit(db,u,'workspace_file',file.id,'file.downloaded',{}, {space_id:spaceId,version:selected,digest:row.digest,scan_state:row.scan_state});
  return {filename:row.filename,media_type:row.media_type,content,digest:row.digest,version:selected,scan_state:row.scan_state};
}
