import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync,mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {pathToFileURL} from 'node:url';

const root=process.argv[2];
assert.ok(root);
const {openDb,hash,transaction}=await import(pathToFileURL(join(root,'app/db.mjs')));
const {seed}=await import(pathToFileURL(join(root,'scripts/seed.mjs')));
const {setPersonalAppearance,setCompanyAppearance,effectiveAppearance}=await import(pathToFileURL(join(root,'app/preferences.mjs')));
const dir=mkdtempSync(join(tmpdir(),'36t-riwaq-reopen-')),file=join(dir,'synthetic.sqlite');
let db;
try {
  db=new DatabaseSync(file);db.exec('PRAGMA foreign_keys=ON');
  const schema=readFileSync(join(root,'app/schema.sql'),'utf8');
  db.exec(schema);db.prepare('INSERT INTO schema_migrations VALUES(1,?)').run(hash(schema));
  for(const f of readdirSync(join(root,'app/migrations')).filter(f=>/^\d{3}-.+\.sql$/.test(f)).sort()){
    const v=Number(f.slice(0,3));if(v>=143)continue;
    const sql=readFileSync(join(root,'app/migrations',f),'utf8');
    transaction(db,()=>{db.exec(sql);db.prepare('INSERT INTO schema_migrations VALUES(?,?)').run(v,hash(sql));});
  }
  seed(db,'synthetic-riwaq-file-reopen-only');
  const getUser=id=>db.prepare('SELECT * FROM users WHERE id=?').get(id);
  transaction(db,()=>setCompanyAppearance(db,getUser('admin'),{design:'slate',theme:'light',locked:false,reason:'اختبار مصطنع لحفظ إعداد المظهر أثناء الترقية'}));
  transaction(db,()=>setPersonalAppearance(db,getUser('employee'),{design:'classic',theme:'dark'}));
  const rows=()=>({company:db.prepare('SELECT * FROM appearance_settings ORDER BY tenant_id').all(),personal:db.prepare('SELECT * FROM user_appearance ORDER BY user_id').all()});
  const before=rows();db.close();db=null;
  db=openDb(file);
  assert.deepEqual(rows(),before);
  assert.equal(db.prepare('PRAGMA foreign_key_check').all().length,0);
  transaction(db,()=>setPersonalAppearance(db,getUser('employee'),{design:'riwaq',theme:'light'}));
  db.close();db=null;
  db=openDb(file);
  assert.equal(effectiveAppearance(db,getUser('employee')).design,'riwaq');
  assert.equal(effectiveAppearance(db,getUser('employee')).theme,'light');
  assert.deepEqual(rows().company,before.company);
  assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check,'ok');
  assert.equal(db.prepare('PRAGMA foreign_key_check').all().length,0);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM schema_migrations WHERE version=143').get().n,1);
  console.log(JSON.stringify({node:process.version,execPath:process.execPath,synthetic:true,migration:143,previousRowsPreserved:true,physicalCloseAndReopen:true,riwaqPersisted:true,companySettingsPreserved:true,integrity:'ok',foreignKeyViolations:0}));
} finally {try{db?.close();}finally{rmSync(dir,{recursive:true,force:true});}}
