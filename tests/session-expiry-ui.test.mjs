import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
const source=readFileSync(new URL('../app/static/app.mjs',import.meta.url),'utf8');
const apiSource=source.slice(source.indexOf('async function api('),source.indexOf('\nfunction empty(',source.indexOf('async function api(')));
function harness(status,path='/policy-assistant/questions'){
  const calls=[];
  const context={me:{id:'employee'},csrf:'old-token',dialogEpoch:4,dialog:{open:true,close(){this.open=false;calls.push('close');}},fetch:async()=>({ok:status===200,status,text:async()=>JSON.stringify(status===200?{ok:true}:{error:{code:'unauthenticated',message:'انتهت الجلسة'}})}),tr:ar=>ar,toast:()=>{},loginView:()=>calls.push('login')};
  runInNewContext(apiSource+';this.run=()=>api('+JSON.stringify(path)+',"POST",{});',context);
  return {context,calls};
}
test('انتهاء الجلسة يغلق نموذج السؤال قبل إظهار تسجيل الدخول',async()=>{
  const {context,calls}=harness(401);
  await assert.rejects(context.run(),error=>error.code==='unauthenticated');
  assert.deepEqual(calls,['close','login']);
  assert.equal(context.dialog.open,false);
  assert.equal(context.me,null);
  assert.equal(context.csrf,null);
  assert.ok(context.dialogEpoch>4);
});
test('خطأ التحقق ونجاح الطلب لا يغلقان النموذج',async()=>{
  for(const status of [422,200]){
    const {context,calls}=harness(status);
    if(status===200)await context.run();else await assert.rejects(context.run());
    assert.deepEqual(calls,[]);
    assert.equal(context.dialog.open,true);
  }
});
