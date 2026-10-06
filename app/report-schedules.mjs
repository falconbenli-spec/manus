import { randomUUID } from 'node:crypto';
import { audit, now, transaction } from './db.mjs';
import { fail } from './auth.mjs';
import * as v from './validation.mjs';
import { currentUser } from './delegations.mjs';
import { reportsIndex, saveSnapshot } from './reports.mjs';

// جدولة داخلية فقط: تُنشئ لقطة مسودة للفترة المنتهية، ولا ترسل شيئًا خارج المنصة.
const riyadhToday=(time=Date.now())=>new Date(time+3*3600000).toISOString().slice(0,10);
const addDays=(date,n)=>new Date(Date.parse(date+'T00:00:00Z')+n*86400000).toISOString().slice(0,10);
const CADENCES={weekly:'أسبوعيًا — الأسبوع المنتهي (الأحد إلى السبت)',monthly:'شهريًا — الشهر المنتهي'};
// الفترة المنتهية قبل تاريخ التشغيل، وموعد التشغيل التالي.
export function duePeriod(cadence,runDate){
  if(cadence==='weekly'){const weekday=new Date(runDate+'T00:00:00Z').getUTCDay(),thisSunday=addDays(runDate,-weekday);return {from:addDays(thisSunday,-7),to:addDays(thisSunday,-1),next:addDays(thisSunday,7)};}
  const [y,m]=runDate.split('-').map(Number),first=`${runDate.slice(0,7)}-01`,previousEnd=addDays(first,-1),next=new Date(Date.UTC(y,m,1)).toISOString().slice(0,10);
  return {from:`${previousEnd.slice(0,7)}-01`,to:previousEnd,next};
}
function firstRun(cadence,today){return duePeriod(cadence,today).next;}
function actor(db,supplied){const u=currentUser(db,supplied);if(!u)fail(403,'forbidden','الحساب غير متاح');return u;}

export function schedulesFor(db,supplied){
  const u=actor(db,supplied),titles=new Map(reportsIndex(db,u).reports.map(r=>[r.key,r.title]));
  return {cadences:Object.entries(CADENCES).map(([key,name])=>({key,name})),
    schedules:db.prepare('SELECT * FROM report_schedules WHERE tenant_id=? AND owner_id=? ORDER BY active DESC,created_at DESC LIMIT 100').all(u.tenant_id,u.id).map(s=>({...s,active:!!s.active,title:titles.get(s.report_key)??s.report_key,cadence_name:CADENCES[s.cadence],actions:s.active?['stop_schedule']:[]}))};
}
export function createSchedule(db,supplied,input){
  if(!db.isTransaction)fail(500,'transaction_required','تتطلب الجدولة معاملة');
  const u=actor(db,supplied);v.object(input,['report_key','cadence']);
  if(!Object.hasOwn(CADENCES,input.cadence))fail(400,'cadence','اختر التكرار');
  if(!reportsIndex(db,u).reports.some(r=>r.key===input.report_key))fail(404,'not_found','التقرير غير متاح لك');
  if(db.prepare('SELECT 1 FROM report_schedules WHERE owner_id=? AND report_key=? AND cadence=? AND active=1').get(u.id,input.report_key,input.cadence))fail(409,'duplicate_schedule','لديك جدولة قائمة لهذا التقرير بالتكرار نفسه');
  const scheduleId=randomUUID();
  db.prepare('INSERT INTO report_schedules(id,tenant_id,report_key,cadence,owner_id,next_run,created_at) VALUES(?,?,?,?,?,?,?)').run(scheduleId,u.tenant_id,input.report_key,input.cadence,u.id,firstRun(input.cadence,riyadhToday()),now());
  audit(db,u,'report_schedule',scheduleId,'report.schedule_created',{}, {report:input.report_key,cadence:input.cadence});
  return {id:scheduleId};
}
export function stopSchedule(db,supplied,scheduleId,input){
  if(!db.isTransaction)fail(500,'transaction_required','تتطلب الجدولة معاملة');
  const u=actor(db,supplied);v.object(input,['reason']);
  const s=typeof scheduleId==='string'&&db.prepare('SELECT * FROM report_schedules WHERE id=? AND tenant_id=? AND owner_id=? AND active=1').get(scheduleId,u.tenant_id,u.id);
  if(!s)fail(404,'not_found','الجدولة غير متاحة');
  db.prepare('UPDATE report_schedules SET active=0,stopped_reason=? WHERE id=?').run(v.text(input.reason,'سبب الإيقاف',500,3),s.id);
  audit(db,u,'report_schedule',s.id,'report.schedule_stopped',{}, {});
  return {id:s.id};
}
// يُستدعى من مؤقّت الخادم. كل جدولة في معاملتها، والفترة الواحدة لا تُلتقط مرتين.
export function runDueSchedules(db,today=riyadhToday()){
  const results=[];
  for(const s of db.prepare('SELECT * FROM report_schedules WHERE active=1 AND next_run<=? ORDER BY next_run').all(today)){
    const period=duePeriod(s.cadence,today),owner=db.prepare('SELECT * FROM users WHERE id=? AND tenant_id=?').get(s.owner_id,s.tenant_id);
    transaction(db,()=>{
      if(db.prepare('SELECT 1 FROM report_schedule_runs WHERE schedule_id=? AND period_from=? AND period_to=?').get(s.id,period.from,period.to)){db.prepare('UPDATE report_schedules SET next_run=? WHERE id=?').run(period.next,s.id);return;}
      try{
        if(!owner?.active)fail(403,'forbidden','حساب صاحب الجدولة غير نشط');
        const snapshot=saveSnapshot(db,owner,s.report_key,{from:period.from,to:period.to});
        db.prepare("INSERT INTO report_schedule_runs VALUES(?,?,?,?,'snapshot','',?)").run(s.id,period.from,period.to,snapshot.id,now());
        db.prepare('UPDATE report_schedules SET next_run=?,last_run=? WHERE id=?').run(period.next,today,s.id);
        results.push({schedule_id:s.id,outcome:'snapshot',snapshot_id:snapshot.id});
      }catch(error){
        if(!error.status)throw error;
        db.prepare("INSERT INTO report_schedule_runs VALUES(?,?,?,NULL,'stopped',?,?)").run(s.id,period.from,period.to,error.message,now());
        db.prepare('UPDATE report_schedules SET active=0,stopped_reason=? WHERE id=?').run(`أوقفها النظام: ${error.message}`,s.id);
        results.push({schedule_id:s.id,outcome:'stopped',detail:error.message});
      }
    });
  }
  return results;
}
