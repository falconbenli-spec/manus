import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb } from '../app/db.mjs';
import { installServiceCatalog, catalogServices, companyDepartments } from '../app/service-catalog.mjs';

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  if(process.env.NODE_ENV==='production')throw new Error('Synthetic catalog expansion is disabled in production.');
  const db=openDb(resolve(process.env.LOCAL_DB_PATH||'work/local.sqlite'));
  try{
    const created=installServiceCatalog(db);
    console.log(`Departments: ${created.departments} added, ${created.renamed} renamed, ${created.retired} archived (of ${companyDepartments.length} approved). Synthetic heads touched: ${created.heads}. Services: ${created.services} added, ${created.moved} moved to a new department, ${created.revised} revised as a new version. Section placements updated: ${created.sections}.`);
  }finally{db.close();}
}
