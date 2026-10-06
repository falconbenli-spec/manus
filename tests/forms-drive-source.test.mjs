import test from 'node:test';
import assert from 'node:assert/strict';
import { openDb, transaction } from '../app/db.mjs';
import { seed } from '../scripts/seed.mjs';
import { grantAccess } from '../app/access.mjs';
import { installCatalogue, formsBoard } from '../app/forms.mjs';
import { DRIVE_FORMS_AUDIT } from '../app/forms-source-audit.mjs';
import { driveFormsAudit } from '../scripts/drive-forms-audit.mjs';
import { formsUI } from '../app/static/forms-ui.mjs';

function fixture(t){
  const db=openDb(':memory:');seed(db,'synthetic-drive-sources');t.after(()=>db.close());
  const users=Object.fromEntries(db.prepare('SELECT * FROM users').all().map(u=>[u.id,u]));
  transaction(db,()=>grantAccess(db,users.admin,{user_id:'manager',capability:'forms.accept',note:'مالك نماذج للاختبار'}));
  transaction(db,()=>installCatalogue(db,'36t'));
  return {db,users};
}

test('Drive source audit reconciles every wave-one form without inventing the missing PR-06 source',()=>{
  const result=driveFormsAudit();
  assert.equal(result.wave1.length,24);
  assert.equal(new Set(result.wave1.map(x=>x.code)).size,24);
  assert.equal(result.checks.wave1_complete,true);
  assert.equal(result.checks.source_files,23);
  assert.deepEqual(result.checks.source_gaps,['MOD-PR-06']);
  assert.deepEqual(result.checks.required_unbuilt,['MOD-PR-07']);
  const ids=DRIVE_FORMS_AUDIT.canonical_sources.map(x=>x.id).filter(Boolean);
  assert.equal(new Set(ids).size,ids.length,'كل ملف مصدر مقروء مسجل مرة واحدة');
  assert.ok(DRIVE_FORMS_AUDIT.canonical_sources.every(x=>!String(x.file).startsWith('~$')),'لا ملف قفل مؤقت مصدر حاكم');
});

test('Drive readiness is visible to the forms owner, hidden from ordinary fillers, and rendered with the blockers',t=>{
  const {db,users}=fixture(t);
  const owner=formsBoard(db,users.manager),filler=formsBoard(db,users.employee);
  assert.equal(owner.source_audit.coverage.wave1_built,24);
  assert.equal(filler.source_audit,null);
  const html=formsUI.render(owner,{e:x=>String(x),button:()=>''});
  assert.match(html,/تدقيق مصادر Google Drive/);
  assert.match(html,/MOD-PR-07/);
  assert.match(html,/TECH-PROPOSAL-QA/);
  assert.doesNotMatch(html,/~\$/);
});
