import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb, transaction } from '../app/db.mjs';
import { prepareRamadanDraft, ramadanPolicyDraft } from '../app/attendance-rules.mjs';
import { RAMADAN_1448 } from '../app/attendance-policy.mjs';

// مسودة ساعات رمضان 1448هـ (م73(2) وم74(2)، ص 25 من النسخة الموقعة) على قاعدة بيانات محددة، بهوية موظف الموارد البشرية المخول الذي يشغّل
// الأمر باسمه. الأمر لا يقبل المسودة ولا يستطيع: القبول لمدير الموارد البشرية من شاشة «العقود والسياسات»، وهو غير المُعد (قاعدة الشخصين).
// الاستعمال:  LOCAL_DB_PATH=work/local.sqlite node scripts/prepare-ramadan-1448-draft.mjs --as <اسم المستخدم> [--from 2027-02-08 --to 2027-03-08 --start 09:00 --end 15:00]
// الوكيل لا يشغّله على قاعدة حية: من يشغّله إنسان يسمّي نفسه، ويُسجَّل في التدقيق باسمه.
export function prepareOnDatabase(db,{username,ramadan={}}){
  if(typeof username!=='string'||!username.trim())throw new Error('Name the preparer: --as <username>. The draft is written under a person, never under the script.');
  const user=db.prepare('SELECT * FROM users WHERE username=? AND active=1').get(username.trim());
  if(!user)throw new Error(`No active account with username «${username}».`);
  const preview=ramadanPolicyDraft(db,user.tenant_id,undefined,ramadan);
  if(!preview)throw new Error('No accepted working-time policy to copy from. Prepare and accept the base policy first.');
  const result=transaction(db,()=>prepareRamadanDraft(db,user,{ramadan}));
  return {...result,prepared_by:user.id,base_title:preview.base_title,daily_minutes:preview.daily_minutes,weekly_minutes:preview.weekly_minutes};
}
function argument(name){const at=process.argv.indexOf(name);return at>0&&process.argv[at+1]&&!process.argv[at+1].startsWith('--')?process.argv[at+1]:undefined;}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const db=openDb(resolve(process.env.LOCAL_DB_PATH||'work/local.sqlite'));
  try{
    const ramadan=Object.fromEntries([['from',argument('--from')],['to',argument('--to')],['start',argument('--start')],['end',argument('--end')]].filter(([,value])=>value!==undefined));
    const out=prepareOnDatabase(db,{username:argument('--as'),ramadan});
    console.log(`Draft ${out.id} prepared by ${out.prepared_by} from «${out.base_title}»: Ramadan ${out.ramadan.from} → ${out.ramadan.to}, ${out.ramadan.start}–${out.ramadan.end} (${out.daily_minutes/60} h/day, ${out.weekly_minutes/60} h/week).`);
    console.log(`Provisional window (${RAMADAN_1448.hijri}); the HR manager accepts or rejects it in «العقود والسياسات». Nothing applies before that.`);
  }finally{db.close();}
}
