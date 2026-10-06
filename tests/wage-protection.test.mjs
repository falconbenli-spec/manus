import test from 'node:test';
import assert from 'node:assert/strict';
import { transaction, verifyAudit } from '../app/db.mjs';
import { grantAccess } from '../app/access.mjs';
import { recordEmployeeBank, decideEmployeeBank } from '../app/payroll-extras.mjs';
import { wpsBoard, recordFileFormat, decideFileFormat, preExportChecks, prepareWageFile, wageFileContent, recordManualUpload, buildWageFile, activeFormat } from '../app/wage-protection.mjs';
import { riyadhToday } from '../app/wage-basis.mjs';
import { fixture, iban } from './wage-fixture.mjs';

const code=value=>error=>error.code===value;
const column=(position,name,source,type,extra={})=>({position,name,source,type,length:null,required:true,value:'',pad:'right',pad_char:'space',...extra});
const COLUMNS=[
  column(1,'EST_NO','constant','text',{value:'EST-TEST-1'}),
  column(2,'IBAN','iban','text',{length:24}),
  column(3,'EMP_NAME','employee_name','text'),
  column(4,'ID_REF','identity_reference','text',{required:false}),
  column(5,'NET','net_amount','amount'),
  column(6,'MONTH','month','month')
];
const definition=(extra={})=>({bank_name:'بنك تجريبي',format_label:'صيغة تجريبية v1',layout:'delimited',delimiter:',',encoding:'utf-8',line_ending:'crlf',include_header:true,
  columns:COLUMNS,spec_source:'قرأتها من شاشة مواصفة الملف في حساب المنشأة التجريبي بتاريخ اليوم',spec_confirmed_on:'2026-02-01',...extra});
const keys=list=>list.map(c=>c.key);

test('the wage file format is data the establishment account dictates: the recorder never confirms it, a confirmed definition is replaced by a new revision, and no column lives in the code',t=>{
  const {db,users,tx}=fixture(t);
  assert.throws(()=>wpsBoard(db,users.employee),code('not_permitted'),'wage protection is for explicit payroll permission holders');
  assert.throws(()=>tx(()=>recordFileFormat(db,users.reviewer,definition())),code('not_permitted'),'a reviewer does not enter the specification');
  const formatId=tx(()=>recordFileFormat(db,users.hr,definition())).id;
  const draft=wpsBoard(db,users.hr).formats.find(f=>f.id===formatId);
  assert.equal(draft.status,'draft');assert.equal(wpsBoard(db,users.hr).active_format_id,null);
  assert.deepEqual(draft.columns.map(c=>c.name),['EST_NO','IBAN','EMP_NAME','ID_REF','NET','MONTH'],'the columns are exactly what was entered');
  assert.throws(()=>tx(()=>decideFileFormat(db,users.hr,formatId,'confirm',{version:draft.version,note:'تأكيد من مدخل المواصفة نفسه'})),code('action_unavailable'));
  assert.throws(()=>tx(()=>decideFileFormat(db,users['hr-manager'],formatId,'confirm',{version:draft.version+5,note:'نسخة قديمة من الشاشة'})),code('stale_version'));
  tx(()=>decideFileFormat(db,users['hr-manager'],formatId,'confirm',{version:draft.version,note:'طابقت الأعمدة والأطوال مع حساب المنشأة التجريبي'}));
  assert.equal(activeFormat(db,'36t').id,formatId);
  assert.throws(()=>db.prepare("UPDATE wps_file_formats SET columns='[]',version=version+1 WHERE id=?").run(formatId),/replaced by a new revision/);
  assert.throws(()=>tx(()=>recordFileFormat(db,users.hr,definition({spec_confirmed_on:'2099-01-01'}))),code('spec_confirmed_on'));
  // نسخة ثانية للبنك نفسه: تحل محل الأولى عند تأكيدها وتبقى الأولى متقاعدة في السجل.
  const second=tx(()=>recordFileFormat(db,users.hr,definition({format_label:'صيغة تجريبية v2',columns:[...COLUMNS,column(7,'GROSS','gross_amount','amount')]}))).id;
  tx(()=>decideFileFormat(db,users['hr-manager'],second,'confirm',{version:1,note:'أضافت الجهة عمود الإجمالي في الإصدار الثاني'}));
  const board=wpsBoard(db,users.hr);
  assert.equal(board.active_format_id,second);
  assert.equal(board.formats.find(f=>f.id===formatId).status,'retired','the first revision is kept, not edited');
  assert.equal(board.formats.find(f=>f.id===second).revision,2);
  // تعريف كيان آخر لا يظهر ولا يُستخدم.
  db.prepare("INSERT INTO wps_file_formats(id,tenant_id,bank_name,format_label,revision,layout,delimiter,encoding,line_ending,include_header,columns,spec_source,spec_confirmed_on,status,recorded_by,confirmed_by,confirmed_at,created_at,updated_at) VALUES('iso','isolated','بنك معزول','صيغة معزولة',1,'delimited',',','utf-8','crlf',0,?,'مصدر تجريبي في كيان معزول','2026-01-01','active','external','admin','t','t','t')")
    .run(JSON.stringify([column(1,'A','employee_id','text')]));
  assert.equal(wpsBoard(db,users.hr).formats.some(f=>f.tenant_id!=='36t'),false);
  assert.equal(activeFormat(db,'36t').id,second);
  assert.ok(verifyAudit(db));
});

test('pre-export checks catch before the upload what would be rejected after it, and tell apart what blocks the file from what only warns',t=>{
  const {db,users,tx,contract,bank,document,approveRun,approvedTransfer}=fixture(t);
  contract('employee');contract('outsider',[{component:'basic',amount:'6000.00'},{component:'housing',amount:'1000.00'}]);
  const run=approveRun('2026-02');
  assert.equal(run.net_minor,1530000);
  const checks=()=>preExportChecks(db,users.hr,run.id);
  assert.deepEqual(keys(checks().blocking),['format_missing'],'no definition, no file');
  const formatId=tx(()=>recordFileFormat(db,users.hr,definition())).id;
  tx(()=>decideFileFormat(db,users['hr-manager'],formatId,'confirm',{version:1,note:'طابقت المواصفة مع حساب المنشأة التجريبي'}));
  const first=checks();
  assert.equal(first.can_export,false);
  assert.ok(keys(first.blocking).includes('missing_bank'));
  assert.ok(keys(first.blocking).includes('missing_identity'));
  assert.ok(keys(first.blocking).includes('total_mismatch'));
  assert.equal(first.blocking.find(c=>c.key==='missing_bank').employees.length,2);
  assert.throws(()=>tx(()=>prepareWageFile(db,users.hr,{run_id:run.id})),code('export_blocked'));
  // حساب مسجل لم يتحقق منه أحد ليس كحساب غير موجود.
  const pending=tx(()=>recordEmployeeBank(db,users.hr,{user_id:'employee',bank_name:'بنك تجريبي',iban:iban('80000000000000000021'),effective_month:'2026-01',evidence:'خطاب بنكي تجريبي باسم الموظفة'})).id;
  assert.ok(keys(checks().blocking).includes('unverified_bank'));
  tx(()=>decideEmployeeBank(db,users['hr-manager'],pending,'verify',{note:'طابقت الخطاب البنكي مع اسم الموظفة'}));
  bank('outsider','80000000000000000039');
  document('employee');document('outsider','2026-01-31');
  // الحزمة 4 (D7، الترحيل 175): نسخة حماية الأجور تُصدَّر من التحويل المعتمد بمجموعه، فهو آخر ما يمنع حتى يُعتمد.
  assert.deepEqual(keys(checks().blocking),['transfer_not_approved']);
  approvedTransfer(run);
  const ready=checks();
  assert.deepEqual(keys(ready.blocking),[],'everything that blocks is cleared');
  assert.deepEqual(keys(ready.warnings).sort(),['expired_identity','identity_not_stored'],'an expired document and a reference that is not a full number warn, they do not block');
  assert.equal(ready.can_export,true);assert.equal(ready.file_total_minor,run.net_minor);
  const exportId=tx(()=>prepareWageFile(db,users.hr,{run_id:run.id})).id;
  const file=wageFileContent(db,users.hr,exportId),lines=file.content.split('\r\n').filter(Boolean);
  // الحزمة 3: الملف المسلَّم يحمل سطر محاكاة أولًا (ما يُرفع لجهة ولا يُعدّ رفعًا)، وبعده الملف كما عرّفته المواصفة حرفًا بحرف.
  assert.match(lines[0],/^SIMULATED/,'the handed-out file says first that it is a simulation');
  assert.deepEqual([file.simulated,file.integration_status],[true,'simulated']);
  const rows=lines.slice(1);
  assert.equal(rows[0],'EST_NO,IBAN,EMP_NAME,ID_REF,NET,MONTH','after the marker, the header is the definition, nothing else');
  assert.equal(rows.length,3);
  assert.equal(rows[1].split(',').length,6,'no column the definition did not ask for');
  assert.ok(rows.some(r=>r.includes('9000.00'))&&rows.some(r=>r.includes('6300.00')));
  assert.ok(rows.slice(1).every(r=>r.startsWith('EST-TEST-1')),'a constant the specification carries, not the code');
  assert.equal(file.filename,'wage-protection-2026-02-SIMULATED.csv');
  // تغيّر حساب بنكي بعد التصدير: الملف لا يُسلَّم بصمة غير بصمته.
  const moved=tx(()=>recordEmployeeBank(db,users.hr,{user_id:'employee',bank_name:'بنك تجريبي آخر',iban:iban('80000000000000000047'),effective_month:'2026-02',evidence:'خطاب بنكي تجريبي جديد باسم الموظفة'})).id;
  tx(()=>decideEmployeeBank(db,users['hr-manager'],moved,'verify',{note:'طابقت الخطاب البنكي الجديد مع اسم الموظفة'}));
  assert.throws(()=>wageFileContent(db,users.hr,exportId),code('file_changed'));
  // موظف على رأس العمل وليس في المسير: أخطر ما يُرصد على المنشأة، ويمنع التصدير.
  contract('new-hire',[{component:'basic',amount:'5000.00'}],'2026-02-05');
  assert.ok(keys(preExportChecks(db,users.hr,run.id).blocking).includes('on_duty_not_in_run'));
  assert.ok(verifyAudit(db));
});

test('the manual upload is an admission a second person records once, because the platform neither uploads the file nor reads the authority reply',t=>{
  const {db,users,tx,contract,bank,document,approveRun,approvedTransfer}=fixture(t);
  contract('employee');bank('employee','80000000000000000021');document('employee');
  const run=approveRun('2026-02'),formatId=tx(()=>recordFileFormat(db,users.hr,definition())).id;
  tx(()=>decideFileFormat(db,users['hr-manager'],formatId,'confirm',{version:1,note:'طابقت المواصفة مع حساب المنشأة التجريبي'}));
  approvedTransfer(run);
  const exportId=tx(()=>prepareWageFile(db,users.hr,{run_id:run.id})).id;
  const upload={version:1,uploaded_on:riyadhToday(),reference:'REF-TEST-1',note:'رفعته يدويًا في بوابة المنشأة التجريبية واستلمت إشعارًا'};
  // من صدّر الملف لا يوثق رفعه ولو حمل التصريحين. (الحزمة 4: يُقاس قبل الرفع الأول، لأن المسير المرفوع ملفه ما يتصدّر له ملف ثانٍ.)
  tx(()=>grantAccess(db,users.admin,{user_id:'reviewer',capability:'payroll.prepare',note:'تصريح تجريبي إضافي'}));
  const own=tx(()=>prepareWageFile(db,users.reviewer,{run_id:run.id})).id;
  assert.throws(()=>tx(()=>recordManualUpload(db,users.reviewer,own,{...upload,reference:'REF-TEST-2'})),code('separation_of_duties'));
  assert.throws(()=>tx(()=>recordManualUpload(db,users.hr,exportId,upload)),code('not_permitted'),'the preparer does not close the loop alone');
  assert.throws(()=>tx(()=>recordManualUpload(db,users.reviewer,exportId,{...upload,uploaded_on:'2020-01-01'})),code('uploaded_on'));
  assert.throws(()=>tx(()=>recordManualUpload(db,users.reviewer,exportId,{...upload,version:9})),code('stale_version'));
  tx(()=>recordManualUpload(db,users.reviewer,exportId,upload));
  const recorded=wpsBoard(db,users.hr).exports.find(x=>x.id===exportId);
  assert.equal(recorded.uploaded_on,upload.uploaded_on);assert.equal(recorded.upload_recorded_by_name,users.reviewer.name);
  assert.deepEqual(recorded.actions,[],'an upload is recorded once');
  assert.throws(()=>tx(()=>recordManualUpload(db,users.reviewer,exportId,{...upload,version:2})),code('already_recorded'));
  assert.throws(()=>db.prepare("UPDATE wps_exports SET uploaded_on='2026-03-09',version=version+1 WHERE id=?").run(exportId),/recorded once/);
  // ورفعٌ واحد للمسير (الترحيل 175): التصدير الثاني يبقى في السجل بلا رفع، ولا يتصدّر بعد الرفع ملف جديد.
  assert.throws(()=>tx(()=>recordManualUpload(db,users['hr-manager'],own,{...upload,reference:'REF-TEST-3'})),code('run_already_uploaded'));
  assert.throws(()=>tx(()=>prepareWageFile(db,users.hr,{run_id:run.id})),code('export_blocked'));
  assert.ok(verifyAudit(db));
});

test('the file is assembled from the definition alone: fixed widths, the declared delimiter, and cells a spreadsheet cannot read as formulas',()=>{
  const fixed={layout:'fixed',delimiter:'',encoding:'utf-8',line_ending:'lf',include_header:false,columns:[
    column(1,'A','employee_id','text',{length:6}),
    column(2,'B','net_amount','amount',{length:10,pad:'left',pad_char:'zero'})
  ]};
  assert.equal(buildWageFile(fixed,[['emp1','9000.00']]),'emp1  0009000.00\n');
  const delimited={layout:'delimited',delimiter:'|',encoding:'utf-8-bom',line_ending:'crlf',include_header:true,columns:[column(1,'A','employee_name','text'),column(2,'B','bank_name','text')]};
  const out=buildWageFile(delimited,[['اسم, باسم','=SUM(1)']]);
  assert.ok(out.startsWith('﻿A|B\r\n'),'the header and the byte order mark the definition asked for');
  assert.equal(out.split('\r\n')[1],'اسم, باسم|\'=SUM(1)','a delimiter that is not a comma leaves commas alone, and a formula cell is neutralised');
  assert.equal(buildWageFile({...delimited,include_header:false},[['a|b','c"d']]).trim(),'"a|b"|"c""d"');
});
