import { randomUUID } from 'node:crypto';
import { fail } from './auth.mjs';
import { can } from './access.mjs';
import { clientFor, memberClients } from './agency.mjs';

// ما تشترك فيه وحدتا خط الفرص والتقديرات. ملف ثالث صغير حتى لا تستورد إحداهما الأخرى.
export const id=()=>randomUUID();
export const today=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Riyadh',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
export const daysBetween=(from,to)=>Math.round((Date.parse(to+'T00:00:00Z')-Date.parse(from+'T00:00:00Z'))/86400000);
export const nameOf=(db,userId)=>userId?db.prepare('SELECT name FROM users WHERE id=?').get(userId)?.name??null:null;
export function writing(db){if(!db.isTransaction)fail(500,'transaction_required','تتطلب الكتابة معاملة قاعدة بيانات');}

// التصريح القائم commercial.use بمجاله (إدارة الحساب)، ثم عزل فريق حساب العميل من وحدة الوكالة.
export function seller(db,supplied){
  const clients=memberClients(db,supplied),u=db.prepare('SELECT * FROM users WHERE id=? AND tenant_id=? AND active=1').get(supplied.id,supplied.tenant_id);
  if(!can(db,u,'commercial.use',u.department_id))fail(403,'not_permitted','هذه الشاشة لحامل تصريح المبيعات والتسليم');
  return {u,clients};
}
export function sellerClient(db,supplied,clientId){
  const {u}=seller(db,supplied);
  return {u,c:clientFor(db,u,clientId).c};
}

// المبالغ نص عشري بمنزلتين يتحول إلى هللات صحيحة؛ لا أعداد عشرية عائمة في أي حساب.
export function money(value,label,{zero=false,max=999999999999}={}){
  if(typeof value!=='string'||!/^(0|[1-9]\d{0,9})(\.\d{1,2})?$/.test(value))fail(400,'invalid_money',`${label}: مبلغ بالريال بمنزلتين عشريتين كحد أقصى`);
  const [whole,fraction='']=value.split('.'),minor=Number(BigInt(whole)*100n+BigInt(fraction.padEnd(2,'0')));
  if(minor>max||(minor===0&&!zero))fail(400,'invalid_money',`${label}: ${minor?'تجاوز الحد المسموح':'مبلغ موجب'}`);
  return minor;
}
export const decimal=minor=>`${minor<0?'-':''}${Math.floor(Math.abs(minor)/100)}.${String(Math.abs(minor)%100).padStart(2,'0')}`;
export function code(value,label){
  const clean=typeof value==='string'?value.normalize('NFKC').trim().replace(/\s+/gu,'-').toUpperCase():'';
  if(!/^[A-Z0-9][A-Z0-9_-]{1,39}$/.test(clean))fail(400,'invalid_code',`${label}: أحرف لاتينية وأرقام وشرطة، من حرفين إلى أربعين`);
  return clean;
}
