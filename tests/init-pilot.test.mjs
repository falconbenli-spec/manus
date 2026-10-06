import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { openDb } from '../app/db.mjs';
import { login } from '../app/auth.mjs';
import { initPilot } from '../scripts/init-pilot.mjs';

test('clean pilot database: the full structure and service catalogue with only the first admin active, a forced password change, no demo transactions, and no overwrite',t=>{
  const dir=mkdtempSync(join(tmpdir(),'36t-pilot-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
  const path=join(dir,'pilot.sqlite'),summary=initPilot(path,'synthetic-pilot-password-1');
  assert.equal(summary.active_users,1);assert.ok(summary.services>=140,'the whole catalogue is installed');assert.ok(summary.departments>=15);assert.equal(summary.requests,0);assert.equal(summary.audit_ok,true);
  assert.throws(()=>initPilot(path,'synthetic-pilot-password-2'),/Refusing to overwrite/);
  const db=openDb(path);t.after(()=>db.close());
  for(const table of ['vendors','clients','campaigns','payroll_runs','tax_invoices','expense_claims'])assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n,0,table);
  const result=login(db,'admin','synthetic-pilot-password-1','127.0.0.1');
  assert.equal(result.user.must_change_password,true);
  assert.throws(()=>login(db,'manager','synthetic-pilot-password-1','127.0.0.1'),error=>error.status===401,'synthetic accounts cannot sign in');
});
