import { randomUUID } from 'node:crypto';
import { audit, now } from './db.mjs';
import { fail } from './auth.mjs';
import * as v from './validation.mjs';
import { financeCapabilities } from './finance.mjs';

// الأصول الثابتة والإهلاك بالقسط الثابت. الأصل يسجله شخص ويعتمده آخر، وإهلاك الشهر يُحسب مرة واحدة ولا يُعدل.
export const ASSET_CATEGORIES=[['devices','أجهزة وحواسيب'],['cameras_production','كاميرات ومعدات إنتاج'],['furniture','أثاث وتجهيزات'],['vehicles','مركبات'],['software','برمجيات وتراخيص'],['other','أخرى']].map(([key,name])=>({key,name}));
const riyadhToday=()=>new Date(Date.now()+3*3600000).toISOString().slice(0,10);
const id=()=>randomUUID();
function actor(db,supplied,action='read'){
  const u=supplied&&db.prepare('SELECT id,tenant_id,role,active FROM users WHERE id=? AND tenant_id=? AND active=1').get(supplied.id,supplied.tenant_id);
  if(!u)fail(403,'assets_access_denied','الحساب غير متاح');u.permissions=financeCapabilities(db,u);
  if(!u.permissions.includes(action))fail(403,'assets_access_denied','لا يوجد تفويض مالي صالح لهذا الإجراء');return u;
}
function writing(db){if(!db.isTransaction)fail(500,'transaction_required','تتطلب الكتابة معاملة قاعدة بيانات');}
function money(value,label,allowZero=false){
  if(typeof value!=='string'||!/^(?:0|[1-9]\d{0,9})(?:\.\d{1,2})?$/.test(value))fail(400,'invalid_money',`${label}: مبلغ بخانتين عشريتين كحد أقصى`);
  const [whole,fraction='']=value.split('.'),minor=Number(BigInt(whole)*100n+BigInt(fraction.padEnd(2,'0')));
  if(minor<0||(!allowZero&&minor===0))fail(400,'invalid_money',`${label}: مبلغ موجب`);return minor;
}
const monthsBetween=(from,to)=>(Number(to.slice(0,4))-Number(from.slice(0,4)))*12+Number(to.slice(5,7))-Number(from.slice(5,7));
// قسط الشهر: (التكلفة − الخردة) ÷ العمر، ويحمل الشهر الأخير فرق التقريب. يبدأ من الشهر التالي للاقتناء.
export function monthlyDepreciation(asset,month,accumulated){
  const index=monthsBetween(asset.acquired_on.slice(0,7),month);
  if(index<1||index>asset.useful_months)return 0;
  const base=asset.cost_minor-asset.salvage_minor,each=Math.floor(base/asset.useful_months);
  return index===asset.useful_months?base-accumulated:each;
}
const accumulatedFor=(db,assetId)=>db.prepare('SELECT COALESCE(SUM(amount_minor),0) AS n FROM depreciation_lines WHERE asset_id=?').get(assetId).n;

export function assetsBoard(db,supplied){
  const u=actor(db,supplied),name=userId=>userId?db.prepare('SELECT name FROM users WHERE id=?').get(userId)?.name??null:null;
  const assets=db.prepare('SELECT * FROM fixed_assets WHERE tenant_id=? ORDER BY created_at DESC').all(u.tenant_id).map(a=>{
    const accumulated=accumulatedFor(db,a.id),actions=[];
    if(a.status==='pending'&&a.recorded_by!==u.id&&u.permissions.includes('approve'))actions.push('approve_asset','reject_asset');
    if(a.status==='active'&&u.permissions.includes('approve'))actions.push('dispose_asset');
    return {...a,category_name:ASSET_CATEGORIES.find(c=>c.key===a.category).name,custodian_name:name(a.custodian_id),recorded_by_name:name(a.recorded_by),accumulated_minor:accumulated,net_book_minor:a.cost_minor-accumulated,actions};
  });
  const runs=db.prepare('SELECT * FROM depreciation_runs WHERE tenant_id=? ORDER BY month DESC').all(u.tenant_id);
  const active=assets.filter(a=>a.status==='active');
  return {today:riyadhToday(),user_id:u.id,permissions:u.permissions,categories:ASSET_CATEGORIES,assets,runs,
    custodians:db.prepare("SELECT id,name FROM users WHERE tenant_id=? AND active=1 AND role<>'admin' ORDER BY name").all(u.tenant_id),
    totals:{cost_minor:active.reduce((n,a)=>n+a.cost_minor,0),accumulated_minor:active.reduce((n,a)=>n+a.accumulated_minor,0),net_book_minor:active.reduce((n,a)=>n+a.net_book_minor,0),count:active.length}};
}
export function registerAsset(db,supplied,input){
  writing(db);const u=actor(db,supplied,'prepare');
  v.object(input,['name','category','acquired_on','cost','salvage','useful_months','custodian_id','location','evidence']);
  if(!ASSET_CATEGORIES.some(c=>c.key===input.category))fail(400,'category','اختر فئة الأصل');
  const acquired=v.date(input.acquired_on);if(acquired>riyadhToday())fail(400,'acquired_on','تاريخ الاقتناء لا يكون مستقبليًا');
  const cost=money(input.cost,'التكلفة'),salvage=input.salvage?money(input.salvage,'قيمة الخردة',true):0;
  if(salvage>=cost)fail(400,'salvage','قيمة الخردة أقل من التكلفة');
  if(!Number.isInteger(input.useful_months)||input.useful_months<1||input.useful_months>600)fail(400,'useful_months','العمر الإنتاجي بالأشهر من 1 إلى 600');
  if(input.custodian_id&&!db.prepare('SELECT 1 FROM users WHERE id=? AND tenant_id=? AND active=1').get(input.custodian_id,u.tenant_id))fail(400,'custodian','المسؤول عن الأصل غير متاح');
// الرقم من أعلى رقم مستعمل لا من عدد الصفوف: العدّ يفترض تتابعًا بلا فجوة ولا شيء يفرضه.
// اليوم لا فجوة (حارس منع الحذف قائم ونطاق العدّ يطابق القيد الفريد) فالنتيجتان واحدة؛ لكن أول مسار
// استيراد أو ترحيل بيانات يُدخل رقمًا خارج التتابع يجعل العدّ يعيد رقمًا مستعملًا فيسقط الإدراج أمام المستخدم.
  const assetId=id(),time=now(),code='FA-'+String(db.prepare("SELECT COALESCE(MAX(CAST(substr(code,4) AS INTEGER)),0)+1 AS n FROM fixed_assets WHERE tenant_id=? AND code LIKE 'FA-%'").get(u.tenant_id).n).padStart(4,'0');
  db.prepare("INSERT INTO fixed_assets(id,tenant_id,code,name,category,acquired_on,cost_minor,salvage_minor,useful_months,custodian_id,location,evidence,status,recorded_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,'pending',?,?,?)").run(assetId,u.tenant_id,code,v.text(input.name,'اسم الأصل',180,3),input.category,acquired,cost,salvage,input.useful_months,input.custodian_id||null,input.location?v.text(input.location,'الموقع',180):'',v.text(input.evidence,'مرجع فاتورة الشراء وسياسة العمر الإنتاجي',2000,10),u.id,time,time);
  audit(db,u,'fixed_asset',assetId,'asset.registered',{}, {code,cost_minor:cost});
  return {id:assetId};
}
export function assetAction(db,supplied,assetId,action,input){
  writing(db);const u=actor(db,supplied,'approve');
  const fields={approve_asset:['note'],reject_asset:['note'],dispose_asset:['disposed_on','note']}[action];
  if(!fields)fail(404,'not_found','الإجراء غير متاح');
  v.object(input,['version',...fields]);
  const a=assetsBoard(db,u).assets.find(x=>x.id===assetId);
  if(!a)fail(404,'not_found','الأصل غير متاح');
  v.version(input.version,a.version);
  if(!a.actions.includes(action))fail(409,'action_unavailable','الإجراء غير متاح في حالة الأصل الحالية أو لصلاحيتك');
  const time=now(),note=v.text(input.note,'أساس القرار',2000,action==='approve_asset'?3:10);
  if(action==='approve_asset')db.prepare("UPDATE fixed_assets SET status='active',approved_by=?,approved_at=?,version=version+1,updated_at=? WHERE id=?").run(u.id,time,time,a.id);
  if(action==='reject_asset')db.prepare("UPDATE fixed_assets SET status='rejected',disposal_note=?,version=version+1,updated_at=? WHERE id=?").run(note,time,a.id);
  if(action==='dispose_asset'){const on=v.date(input.disposed_on);if(on>riyadhToday()||on<a.acquired_on)fail(400,'disposed_on','تاريخ الاستبعاد بين الاقتناء واليوم');db.prepare("UPDATE fixed_assets SET status='disposed',disposed_on=?,disposal_note=?,version=version+1,updated_at=? WHERE id=?").run(on,note,time,a.id);}
  audit(db,u,'fixed_asset',a.id,'asset.'+action,{status:a.status},{version:a.version+1},note);
  return assetsBoard(db,u).assets.find(x=>x.id===a.id);
}
export function runDepreciation(db,supplied,input){
  writing(db);const u=actor(db,supplied,'prepare');
  v.object(input,['month']);
  if(typeof input.month!=='string'||!/^\d{4}-(0[1-9]|1[0-2])$/.test(input.month))fail(400,'invalid_month','الشهر بصيغة 2026-09');
  if(input.month>riyadhToday().slice(0,7))fail(400,'future_month','لا يُحسب إهلاك شهر لم يبدأ');
  if(db.prepare('SELECT 1 FROM depreciation_runs WHERE tenant_id=? AND month=?').get(u.tenant_id,input.month))fail(409,'run_exists','حُسب إهلاك هذا الشهر');
  // لا فجوات: لا يُحسب شهر قبل أن تُحسب الأشهر السابقة التي تستحق إهلاكًا.
  const lines=[];
  for(const asset of db.prepare("SELECT * FROM fixed_assets WHERE tenant_id=? AND status IN ('active','disposed') AND approved_by IS NOT NULL").all(u.tenant_id)){
    if(asset.disposed_on&&asset.disposed_on.slice(0,7)<input.month)continue;
    const accumulated=accumulatedFor(db,asset.id),index=monthsBetween(asset.acquired_on.slice(0,7),input.month),counted=db.prepare('SELECT COUNT(*) AS n FROM depreciation_lines WHERE asset_id=?').get(asset.id).n;
    if(index>=1&&index<=asset.useful_months&&counted<index-1)fail(409,'earlier_month_missing',`احسب إهلاك الأشهر السابقة أولًا: الأصل ${asset.code} ينقصه ${index-1-counted} شهر`);
    const amount=monthlyDepreciation(asset,input.month,accumulated);
    if(amount>0)lines.push([asset.id,amount]);
  }
  if(!lines.length)fail(409,'nothing_to_depreciate','لا أصل يستحق إهلاكًا في هذا الشهر');
  const runId=id(),total=lines.reduce((n,l)=>n+l[1],0);
  db.prepare('INSERT INTO depreciation_runs VALUES(?,?,?,?,?,?)').run(runId,u.tenant_id,input.month,total,u.id,now());
  for(const [assetId,amount] of lines)db.prepare('INSERT INTO depreciation_lines VALUES(?,?,?)').run(runId,assetId,amount);
  audit(db,u,'depreciation_run',runId,'depreciation.computed',{}, {month:input.month,total_minor:total,assets:lines.length});
  return {id:runId,month:input.month,total_minor:total,assets:lines.length};
}
