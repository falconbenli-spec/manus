// سجل الصرف الإعلامي: المصدر الواحد للصرف (الحزمة 4، DOMAIN-2، الترحيل 192).
// كان للصرف سجلّان: قيود «صرف» داخل الحملة (campaign_entries) يقرؤها R22 وشاشة الحملة، وسجل الصرف الإعلامي
// (media_spend_entries) يقرؤه تقرير العميل ولوحة الصرف؛ فيخرج للعميل رقمٌ ويقرأ المدير في R22 رقمًا ثانيًا للحملة نفسها.
// هنا التعريف الواحد للصرف الساري، ومنه تقرأ اللوحة وR22 وقسم الصرف في تقرير العميل وبلاطة الحملة، فالريال الواحد رقم واحد.
// وحدة بلا استيراد من وحدات المجال عمدًا: الحملات والصرف الإعلامي وتقارير العملاء ومكتبة التقارير كلها تستوردها بلا دوران.

// السطر الساري: ما لم يُصحَّح بسطر أحدث، وما لم تُلغَ دفعة استيراده. كل نسخ خطة الحملة داخلة: نسخة أحدث من الخطة لا تمحو ما صُرف قبلها.
// from وto يوما رياض شاملان على تاريخ الصرف نفسه (spend_date، لا لحظة الإدخال)؛ وغياب أحدهما يفتح ذلك الطرف.
export function liveSpend(db,campaignId,{from=null,to=null}={}){
  return db.prepare(`SELECT e.*,l.channel FROM media_spend_entries e JOIN media_plans p ON p.id=e.plan_id JOIN media_plan_lines l ON l.id=e.line_id
      LEFT JOIN media_spend_imports i ON i.id=e.import_id
    WHERE p.campaign_id=? AND (i.id IS NULL OR i.status='active') AND NOT EXISTS(SELECT 1 FROM media_spend_entries x WHERE x.corrects_id=e.id)
      AND (? IS NULL OR e.spend_date>=?) AND (? IS NULL OR e.spend_date<=?)
    ORDER BY e.spend_date,e.recorded_at,e.id`).all(campaignId,from,from,to,to);
}
// المجموع وتوزيعه على القنوات بترتيب أول ظهور، بالهللات.
export function spendTotals(entries){
  const byChannel=new Map();
  for(const e of entries)byChannel.set(e.channel,(byChannel.get(e.channel)??0)+e.amount_minor);
  return {total_minor:entries.reduce((n,e)=>n+e.amount_minor,0),by_channel:[...byChannel].map(([channel,amount_minor])=>({channel,amount_minor}))};
}
// خطة الصرف السارية للحملة ومجموع مخططها، أو null. متى وُجدت صار سجل الصرف الإعلامي هو الصرف، وشاشة الحملة لا تقبل قيد «صرف».
export function planInForce(db,campaignId){
  const plan=db.prepare("SELECT id,revision,budget_reference,approved_at FROM media_plans WHERE campaign_id=? AND status='approved'").get(campaignId);
  if(!plan)return null;
  return {...plan,planned_minor:db.prepare('SELECT COALESCE(SUM(planned_minor),0) AS n FROM media_plan_lines WHERE plan_id=?').get(plan.id).n};
}
