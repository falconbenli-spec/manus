import { fail } from './auth.mjs';
import { currentUser } from './delegations.mjs';
import { getRequest } from './workflow.mjs';
import { audit, now } from './db.mjs';
import * as v from './validation.mjs';

function actor(db,supplied){const u=currentUser(db,supplied);if(!u)fail(403,'inactive','الحساب غير نشط');return u;}
export function feedbackView(db,supplied,requestId){
  const u=actor(db,supplied),r=getRequest(db,u,requestId);
  if(r.requester_id!==u.id)return {can_rate:false,feedback:null};
  const feedback=db.prepare('SELECT rating,comment,created_at FROM request_feedback WHERE request_id=? AND tenant_id=?').get(r.id,u.tenant_id)??null;
  return {can_rate:r.status==='completed'&&!feedback,feedback};
}
export function recordFeedback(db,supplied,requestId,input){
  if(!db.isTransaction)fail(500,'transaction_required','يلزم حفظ التقييم داخل معاملة');
  const u=actor(db,supplied),r=getRequest(db,u,requestId);
  if(r.requester_id!==u.id)fail(403,'forbidden','التقييم متاح لصاحب الطلب فقط');
  v.object(input,['version','rating','comment']);
  if(r.status!=='completed')fail(409,'not_completed','يمكن التقييم بعد إنجاز الطلب فقط');
  if(input.version!==r.version)fail(409,'version_conflict','تغير الطلب؛ أعد تحميله قبل التقييم');
  if(!Number.isInteger(input.rating)||input.rating<1||input.rating>5)fail(400,'invalid_rating','التقييم عدد صحيح من 1 إلى 5');
  const comment=v.text(input.comment??'','الملاحظة',2000,input.rating<=2?3:0);
  const previous=db.prepare('SELECT * FROM request_feedback WHERE request_id=?').get(r.id);
  if(previous){
    if(previous.rating===input.rating&&previous.comment===comment)return feedbackView(db,u,r.id);
    fail(409,'already_rated','حُفظ التقييم ولا يمكن استبداله');
  }
  db.prepare('INSERT INTO request_feedback VALUES(?,?,?,?,?,?,?)').run(r.id,u.tenant_id,u.id,r.version,input.rating,comment,now());
  audit(db,u,'request',r.id,'service.feedback_recorded',{}, {rating:input.rating},'تقييم صاحب الطلب بعد الإنجاز');
  return feedbackView(db,u,r.id);
}
