// جرد قراءة فقط: يطابق سجل النماذج المحلي مع مصادر Drive المرصودة في 3 أكتوبر 2026.
import { fileURLToPath } from 'node:url';
import { DRIVE_FORMS_AUDIT } from '../app/forms-source-audit.mjs';
import { formsInventory, WAVE1 } from './forms-inventory.mjs';

export function driveFormsAudit(){
  const inventory=formsInventory();
  const observed=new Map(DRIVE_FORMS_AUDIT.canonical_sources.map(x=>[x.code,x]));
  const wave1=WAVE1.map(code=>{
    const row=inventory.rows.find(x=>x.short_code===code);
    const source=observed.get(code);
    return {code:`MOD-${code}`,platform:row?.platform??'missing_from_register',catalogue_key:row?.catalogue_key??null,
      drive_status:source?.status??'not_observed',drive_file:source?.file??null,drive_id:source?.id??null};
  });
  return {audit:DRIVE_FORMS_AUDIT,inventory:inventory.totals,wave1,
    checks:{wave1_complete:wave1.every(x=>x.platform==='built'),
      source_files:wave1.filter(x=>x.drive_status==='readable').length,
      source_gaps:wave1.filter(x=>x.drive_status!=='readable').map(x=>x.code),
      required_unbuilt:inventory.rows.filter(x=>x.required_by_workflow&&x.platform==='not_built').map(x=>x.code)}};
}

if(process.argv[1]===fileURLToPath(import.meta.url))console.log(JSON.stringify(driveFormsAudit(),null,2));
