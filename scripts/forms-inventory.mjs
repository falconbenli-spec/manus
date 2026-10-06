// جرد آلي آمن للنماذج: قراءة فقط، لا يكتب في قاعدة بيانات ولا يحذف شيئًا.
// يقارن ثلاث قوائم: سجل المصادر (65 نموذجًا من فهارس ملفات MOD التسعة)، والموجة الأولى (24 نموذجًا)، وكتالوج المنصة.
// التشغيل: node scripts/forms-inventory.mjs [--json]
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { FORM_CATALOGUE, VERIFIED } from '../app/forms-catalogue.mjs';

export const REGISTER_PATH='docs/product/workflow/FORMS-SOURCE-REGISTER.json';
// الموجة الأولى كما حددها المالك (برومبت 28 سبتمبر): 24 نموذجًا في 8 إدارات. IC خارجها ولا يُحذف.
export const WAVE1=['BD-01','BD-04','PM-01','PM-02','PM-03','AD-01','AD-02','AD-03','CW-01','CW-02','CR-01','CR-02',
  'DS-01','DS-02','DS-03','PROD-01','PROD-02','PR-01','PR-02','PR-03','PR-04','PR-05','PR-06','PR-08'];

// نماذج مبنية خارج محرك النماذج بوحدة مخصصة، فلا تظهر في الكتالوج ولا تُعدّ «غير مبنية».
export const BUILT_ELSEWHERE={'MOD-BD-02':'app/pricing.mjs (ورقة التسعير)','MOD-BD-03':'app/pricing.mjs (استثناء الهامش)'};

export const loadRegister=(path=REGISTER_PATH)=>JSON.parse(readFileSync(path,'utf8'));

export function formsInventory(register=loadRegister(),catalogue=FORM_CATALOGUE){
  const byCode=new Map();
  for(const form of catalogue)for(const code of form.aliases.code){
    if(!byCode.has(code))byCode.set(code,[]);
    byCode.get(code).push(form.key);
  }
  const rows=register.forms.map(entry=>{
    const keys=byCode.get(entry.code)??[];
    const form=keys.length===1?catalogue.find(x=>x.key===keys[0]):null;
    return {code:entry.code,short_code:entry.short_code,department:entry.department,name_ar:entry.name_ar,
      wave1:WAVE1.includes(entry.short_code),upload_status:entry.upload_status,source_status:entry.source_status,
      required_by_workflow:entry.required_by_workflow,
      catalogue_key:form?.key??null,frm:form?.frm??null,catalogue_source_status:form?.source_status??null,
      // حالة المنصة: مبني (مسودة تعريف تنتظر قبول المالك) أو غير مبني. لا حالة «محذوف» في هذا الجرد.
      platform:form?'built':BUILT_ELSEWHERE[entry.code]?'built_elsewhere':'not_built',built_in:form?'app/forms-catalogue.mjs':BUILT_ELSEWHERE[entry.code]??null,ambiguous_match:keys.length>1?keys:null};
  });
  const registerCodes=new Set(register.forms.map(x=>x.code));
  // رموز مختصرة يحملها أكثر من نموذج في الكتالوج (MOD-01 مثلًا): تعارض تسمية يُسجَّل ولا يُحسم آليًا.
  const collisions=[...byCode].filter(([,keys])=>keys.length>1).map(([code,keys])=>({code,form_keys:keys}));
  const waveCodes=new Set(WAVE1.map(c=>`MOD-${c}`));
  return {
    totals:{register:rows.length,wave1:WAVE1.length,catalogue:catalogue.length,
      wave1_built:rows.filter(r=>r.wave1&&r.platform==='built').length,
      outside_wave:rows.filter(r=>!r.wave1).length,disabled:0,deleted:0},
    rows,
    wave1_missing_from_register:WAVE1.filter(c=>!registerCodes.has(`MOD-${c}`)),
    wave1_not_built:rows.filter(r=>r.wave1&&r.platform!=='built').map(r=>r.code),
    // «خارج السجل» تقيس نماذج ذلك السجل وحدها: نموذج موارد بشرية سنده جردُ مجلده لا هذا السجل،
    // فعدّه غائبًا عنه ليس نقصًا بل خلطُ مِسطرتين.
    catalogue_outside_register:catalogue.filter(form=>form.source_doc===VERIFIED&&!form.aliases.code.some(c=>registerCodes.has(c))).map(f=>f.key),
    catalogue_outside_wave:catalogue.filter(form=>!form.aliases.code.some(c=>waveCodes.has(c))).map(f=>f.key),
    pending_source:rows.filter(r=>r.source_status!=='مصدر متاح').map(r=>({code:r.code,status:r.source_status,wave1:r.wave1})),
    collisions
  };
}

if(process.argv[1]===fileURLToPath(import.meta.url)){
  const inventory=formsInventory();
  if(process.argv.includes('--json'))console.log(JSON.stringify(inventory,null,1));
  else{
    const t=inventory.totals;
    console.log(`سجل المصادر: ${t.register} · الموجة الأولى: ${t.wave1} (مبني ${t.wave1_built}) · الكتالوج: ${t.catalogue} · خارج الموجة: ${t.outside_wave} · موقوف: ${t.disabled} · محذوف: ${t.deleted}`);
    for(const r of inventory.rows)console.log([r.code,r.department,r.wave1?'موجة 1':BUILT_ELSEWHERE[r.code]?'نواة التسعير':'لاحقًا',r.platform==='built'?`مبني ${r.catalogue_key}`:r.platform==='built_elsewhere'?`مبني في ${r.built_in}`:'غير مبني',r.source_status].join(' | '));
    console.log('غير مبني من الموجة:',inventory.wave1_not_built.join(', ')||'لا شيء');
    console.log('تعارضات الرموز:',inventory.collisions.map(c=>`${c.code} → ${c.form_keys.join(' + ')}`).join(' ; ')||'لا شيء');
  }
}
