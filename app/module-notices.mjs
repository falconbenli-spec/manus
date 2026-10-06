import { notifySubject, dayName } from './notices.mjs';
import { holds } from './access.mjs';
import { deliverSubject, recordUndeliverable } from './notice-recipients.mjs';

// إشعارات وحدات الموارد البشرية التي لم تكن تُشعر أحدًا (تكملة B6 وB7): التدريب، وتقييم الأداء، وكشوف الوقت،
// والمهام الرسمية، والعمل الإضافي، والغياب غير المدفوع، وإعداد الخطاب وإلغاؤه. كل دالة تُستدعى بسطر واحد من وحدتها
// داخل معاملة الفعل نفسه. القاعدة كما في notices.mjs: لا مبلغ ولا درجة تقييم ولا رقم هوية ولا ملاحظة المعتمد الحرة،
// ولا يُشعر أحد بفعله هو. السبب يُقرأ في الشاشة.
const person=(db,userId)=>userId?db.prepare('SELECT id,name,manager_id,tenant_id FROM users WHERE id=?').get(userId)??null:null;
function send(db,userId,actorId,notice){if(!userId||userId===actorId)return;notifySubject(db,{...notice,userId});}
// الموجة 2، العطب 10: إشعار «ينتظر قرارك» الموجَّه إلى مدير صاحب السجل كان يسقط صامتًا حين لا مدير له أو حين أُوقف حساب مديره —
// و25 من 28 موظفًا بلا مدير مباشر. صار يمر بسُلَّم المستلمين (app/notice-recipients.mjs): المدير، فمدير الإدارة، فمرجع تصعيدها،
// وإلا صفٌّ في «بلا مستلم» يراه من يدير الهيكل. ومن وصله بغير الطريق الأول يقرأ في الإشعار لماذا وصله.
function toManager(db,subjectUserId,actorId,notice){
  const subject=person(db,subjectUserId);if(!subject)return;
  if(subject.manager_id===actorId)return; // المدير نفسه هو الفاعل: لا يُشعَر بفعله، ولا يُبحث له عن بديل
  deliverSubject(db,{...notice,tenantId:subject.tenant_id,userId:subject.manager_id??null,aboutUserId:subjectUserId,actorId});
}
function toPerson(db,userId,subjectUserId,actorId,notice){
  if(userId&&userId===actorId)return;
  const subject=person(db,subjectUserId);if(!subject)return send(db,userId,actorId,notice);
  deliverSubject(db,{...notice,tenantId:subject.tenant_id,userId:userId??null,aboutUserId:subjectUserId,actorId});
}
// قرار ينتظر حاملي تصريح: إن لم يحمله أحد أصلًا فلا أحد سيعلم أن قرارًا ينتظر. يُسجَّل «بلا مستلم» باسم التصريح الناقص.
function toHolders(db,tenantId,userIds,actorId,notice,what){
  for(const userId of userIds)send(db,userId,actorId,notice);
  if(!userIds.length)recordUndeliverable(db,{tenantId,kind:notice.kind,subjectKind:notice.subjectKind,subjectId:notice.subjectId,tried:[{step:'capability_holders',outcome:`لا حساب نشطًا يحمل ${what}`}],
    reason:`لا أحد يحمل ${what}، فقرار ينتظر ولا يعلم به أحد`});
  return userIds.length;
}
const holdersOf=(db,tenantId,capability)=>db.prepare("SELECT * FROM users WHERE tenant_id=? AND active=1 AND role<>'admin' ORDER BY id").all(tenantId).filter(x=>holds(db,x,capability)).map(x=>x.id);

/* ───── التدريب ───── */
export function trainingNotice(db,actor,event,t){
  const base={subjectKind:'training',subjectId:t.id},where='التفاصيل في «التدريب والتطوير».';
  if(event==='requested'){
    if(t.user_id!==actor.id)return send(db,t.user_id,actor.id,{...base,kind:'training_requested_for_you',title:`طُلب لك تدريب: ${t.title}`,body:`بانتظار القرار. ${where}`});
    return toManager(db,t.user_id,actor.id,{...base,kind:'training_decision_needed',title:`طلب تدريب ينتظر قرارك: ${person(db,t.user_id)?.name??''}`,body:'افتح «التدريب والتطوير» لاعتماده أو رفضه.'});
  }
  if(event==='approve')return send(db,t.user_id,actor.id,{...base,kind:'training_approved',title:`اعتُمد طلب التدريب: ${t.title}`,body:'بعد إكماله سجّل مرجع الشهادة أو إثبات الحضور.'});
  if(event==='reject')return send(db,t.user_id,actor.id,{...base,kind:'training_rejected',title:`رُفض طلب التدريب: ${t.title}`,body:`سبب القرار مكتوب في السجل. ${where}`});
}

/* ───── تقييم الأداء ───── */
// الدرجة لا تظهر في أي إشعار: يُقرأ التقييم في شاشته.
export function performanceNotice(db,actor,event,r){
  const base={subjectKind:'performance_review',subjectId:r.id},name=person(db,r.user_id)?.name??'';
  if(event==='submit_self'||event==='skip_self')return toPerson(db,r.reviewer_id,r.user_id,actor.id,{...base,kind:'performance_manager_needed',title:`تقييم أداء ينتظر تقييمك: ${name}`,body:'افتح «تقييم الأداء» لتقييم كل معيار بدليله.'});
  if(event==='appeal'){toHolders(db,r.tenant_id,holdersOf(db,r.tenant_id,'hr.performance.calibrate'),actor.id,{...base,kind:'performance_appeal_needed',title:'تظلم على تقييم أداء ينتظر القرار',body:'افتح «تقييم الأداء» لقراءة التظلم والبت فيه.'},'تصريح معايرة تقييم الأداء');return;}
  if(event==='decide_appeal')return send(db,r.user_id,actor.id,{...base,kind:'performance_appeal_decided',title:'صدر قرار تظلمك على تقييم الأداء',body:'القرار وأساسه في «تقييم الأداء».'});
  if(event==='exclude_review')return send(db,r.user_id,actor.id,{...base,kind:'performance_excluded',title:'استُبعد تقييم أدائك من الدورة الحالية',body:'السبب مكتوب في «تقييم الأداء».'});
}
export function cycleNotice(db,actor,event,cycleId){
  const rows=db.prepare("SELECT * FROM performance_reviews WHERE cycle_id=? AND status<>'excluded'").all(cycleId);
  for(const r of rows){
    const base={subjectKind:'performance_review',subjectId:r.id};
    if(event==='open')send(db,r.user_id,actor.id,{...base,kind:'performance_self_needed',title:'بدأت دورة تقييم الأداء: قيّم نفسك',body:'افتح «تقييم الأداء» لكتابة تقييمك الذاتي، ثم يقيّمك مديرك.'});
    if(event==='release')send(db,r.user_id,actor.id,{...base,kind:'performance_released',title:'صدرت نتيجة تقييم أدائك',body:'اقرأها في «تقييم الأداء»، ثم أقرّ باطلاعك أو تظلّم في مهلته.'});
  }
}

/* ───── كشوف الوقت ───── */
export function timesheetNotice(db,actor,event,p){
  const base={subjectKind:'timesheet',subjectId:p.id},week=`أسبوع ${dayName(p.week_start)}`;
  if(event==='submitted')return toManager(db,p.user_id,actor.id,{...base,kind:'timesheet_decision_needed',title:`كشف ساعات ينتظر اعتمادك: ${person(db,p.user_id)?.name??''} — ${week}`,body:'افتح «اعتماد الساعات» لاعتماده أو إعادته.'});
  if(event==='approve')return send(db,p.user_id,actor.id,{...base,kind:'timesheet_approved',title:`اعتُمد كشف ساعاتك: ${week}`,body:'قرار الفوترة لكل إدخال في «كشفي الأسبوعي».'});
  if(event==='return')return send(db,p.user_id,actor.id,{...base,kind:'timesheet_returned',title:`أُعيد إليك كشف ساعاتك: ${week}`,body:'اقرأ سبب الإعادة في «كشفي الأسبوعي» ثم عدّله وأرسله.'});
}

/* ───── الحضور: المهام الرسمية والعمل الإضافي والغياب غير المدفوع ───── */
const range=(from,to)=>from===to?`يوم ${dayName(from)}`:`من ${dayName(from)} إلى ${dayName(to)}`;
export function missionNotice(db,actor,event,m){
  const base={subjectKind:'work_mission',subjectId:m.id};
  if(event==='requested')return toManager(db,m.user_id,actor.id,{...base,kind:'mission_decision_needed',title:`مهمة عمل تنتظر قرارك: ${person(db,m.user_id)?.name??''} ${range(m.from_date,m.to_date)}`,body:'افتح «الحضور والانصراف» لاعتمادها أو رفضها.'});
  if(event==='approved')return send(db,m.user_id,actor.id,{...base,kind:'mission_approved',title:`اعتُمدت مهمة العمل ${range(m.from_date,m.to_date)}`,body:'تظهر أيامها في سجل حضورك «مهمة عمل معتمدة».'});
  if(event==='rejected')return send(db,m.user_id,actor.id,{...base,kind:'mission_rejected',title:`رُفضت مهمة العمل ${range(m.from_date,m.to_date)}`,body:'أساس القرار في «حضوري».'});
}
export function overtimeNotice(db,actor,event,o){
  const base={subjectKind:'overtime_request',subjectId:o.id}; /* integration: the same subject kind as the attendance-rules (099) decision notices */
  if(event==='requested')return toManager(db,o.user_id,actor.id,{...base,kind:'overtime_decision_needed',title:`عمل إضافي ينتظر قرارك: ${person(db,o.user_id)?.name??''} يوم ${dayName(o.work_date)}`,body:'افتح «الحضور والانصراف» لاعتماده أو رفضه.'});
  if(event==='approved')return send(db,o.user_id,actor.id,{...base,kind:'overtime_approved',title:`اعتُمد العمل الإضافي ليوم ${dayName(o.work_date)}`,body:'يدخل المسير بقرار مستقل من مُعد الرواتب.'});
  if(event==='rejected')return send(db,o.user_id,actor.id,{...base,kind:'overtime_rejected',title:`رُفض العمل الإضافي ليوم ${dayName(o.work_date)}`,body:'أساس القرار في «حضوري».'});
}
export function absenceNotice(db,actor,event,a){
  const base={subjectKind:'attendance_absence',subjectId:a.id},day=dayName(a.work_date);
  if(event==='proposed')return send(db,a.user_id,actor.id,{...base,kind:'absence_statement_needed',title:`اقتُرح تسجيل غياب غير مدفوع ليوم ${day}`,body:'قدّم إفادتك من «حضوري» قبل القرار. يُعتمد دونها بعد ثلاثة أيام.'});
  if(event==='confirmed')return send(db,a.user_id,actor.id,{...base,kind:'absence_confirmed',title:`اعتُمد غياب غير مدفوع ليوم ${day}`,body:'أساس القرار في «حضوري».'});
  if(event==='dismissed')return send(db,a.user_id,actor.id,{...base,kind:'absence_dismissed',title:`أُسقط اقتراح الغياب ليوم ${day}`,body:'لن يُخصم هذا اليوم.'});
}

/* ───── الاستقالة والانتداب (الترحيل 102) ───── */
// فجوة تسليم الدمج §5: الوحدتان لم تكونا تُشعران أحدًا. الموضوعان `resignation` و`travel_decision` يمران بقاعدة
// شكل الترحيل 099، وفئة البريد (الترحيل 100) تُكتب صراحة: ما ينتظر قرارًا في «approvals» وما يخص صاحب السجل في «my_requests».
// لا يحمل الإشعار سبب الاستقالة ولا ملاحظة صاحب الصلاحية ولا مبلغ البدل ولا مبرر التأجيل: تُقرأ كلها في شاشتها.
const capabilityHolders=(db,tenantId,capability,exclude=[])=>capability?holdersOf(db,tenantId,capability).filter(id=>!exclude.includes(id)):[];
// من يقرر في الاستقالة: مدير الإدارة المخاطَب بالخطاب، وحاملو صلاحية القبول من سياسة الاستقالة المقبولة أو مسودتها.
function resignationDeciders(db,r,capability){
  const out=new Set();
  if(r.addressed_to)out.add(r.addressed_to);
  for(const id of capabilityHolders(db,r.tenant_id,capability))out.add(id);
  return [...out];
}
export function resignationNotice(db,actor,event,r,{deemed_on:deemedOn=null,capability=null}={}){
  const base={subjectKind:'resignation',subjectId:r.id},mine={...base,category:'my_requests'},decide={...base,category:'approvals'};
  const employee=r.user_id,who=person(db,employee)?.name??'';
  const where='التفاصيل في «الاستقالة».';
  if(event==='submitted'){
    // إشعار الاستلام يصل مقدّمها نفسه، كما يصل «استلمنا طلبك» مقدّم طلب الخدمة: هو الوحيد المستثنى من قاعدة «لا يُشعر أحد بفعله هو».
    notifySubject(db,{...mine,userId:employee,kind:'resignation_submitted',title:'استلمنا خطاب استقالتك',
      body:deemedOn?`وصلت إلى مدير إدارتك ونسخة إلى الموارد البشرية. تُعد مقبولة حكمًا في ${dayName(deemedOn)} إن لم يصدر قرار قبلها.`:`وصلت إلى مدير إدارتك ونسخة إلى الموارد البشرية. ${where}`});
    toHolders(db,r.tenant_id,resignationDeciders(db,r,capability),actor.id,{...decide,kind:'resignation_decision_needed',title:`استقالة تنتظر قرارك: ${who}`,body:'افتح «الاستقالة» لقبولها، أو لتأجيل قبولها لمصلحة العمل بسبب مكتوب.'},'صلاحية قبول الاستقالة ولا مدير إدارة مخاطَبًا بها');
    return;
  }
  if(event==='accepted')return send(db,employee,actor.id,{...mine,kind:'resignation_accepted',title:'قُبلت استقالتك',
    body:r.last_working_day?`آخر يوم عمل ${dayName(r.last_working_day)}${r.notice_waived?' (بالإعفاء من فترة الإشعار)':''}. ${where}`:where});
  if(event==='deferred')return send(db,employee,actor.id,{...mine,kind:'resignation_deferred',title:'أُجِّل قبول استقالتك لمصلحة العمل',
    body:`${r.deferred_until?`حتى ${dayName(r.deferred_until)}. `:''}سبب التأجيل مكتوب في «الاستقالة» (م34/2).`});
  if(event==='deemed_accepted'){
    // لا فاعل هنا: المدة هي التي مضت، والمهمة في الطابور تعمل بحساب من أدرجها (قد يكون صاحب الاستقالة نفسه).
    // فلا تُطبَّق قاعدة «لا يُشعر أحد بفعله هو»؛ الطرفان يُخبَران.
    notifySubject(db,{...mine,userId:employee,kind:'resignation_deemed_accepted',title:'عُدّت استقالتك مقبولة حكمًا بمضي المدة',
      body:`مضت المدة دون قرار، فعُدّت مقبولة في ${dayName(r.accepted_on??deemedOn)} (م34/1). ${where}`});
    for(const userId of resignationDeciders(db,r,capability))
      if(userId!==employee)notifySubject(db,{...mine,userId,kind:'resignation_deemed_accepted',title:`عُدّت استقالة ${who} مقبولة حكمًا بمضي المدة`,body:`افتح «الاستقالة» لتحديد آخر يوم عمل. ${where}`});
    return;
  }
  if(event==='last_day_set')return send(db,employee,actor.id,{...mine,kind:'resignation_last_day_set',title:'حُدد آخر يوم عمل لك',
    body:`${r.last_working_day?`${dayName(r.last_working_day)}${r.notice_waived?' (بالإعفاء من فترة الإشعار)':''}. `:''}${where}`});
  if(event==='withdrawn')for(const userId of resignationDeciders(db,r,capability))
    send(db,userId,actor.id,{...mine,kind:'resignation_withdrawn',title:`سُحبت استقالة ${who}`,body:`لم يعد عليها قرار منتظر. ${where}`});
}
// D-12: القبول كان يُشعر حاملي صلاحية القبول وحدهم، وهم في التهيئة المسلَّمة غير من يفتح حزمة المغادرة.
// فالمخاطَب لا يستطيع الفعل، ومن يستطيعه لا يُخاطَب، وفشل فتح الحزمة يُكتب في ملاحظة لا تظهر في أي شاشة.
// الإشعار يذهب الآن إلى حامل تصريح التوظيف والتهيئة (people.manage) — صاحب الفعل — ويقول أي الحالتين وقعت.
// الفاعل نفسه يُستثنى كالعادة، فمن فتح الحزمة بيده لا يُذكَّر بفتحها. لا سبب استقالة ولا مبلغ في النص.
export function offboardingNotice(db,actor,r,{bundle_id:bundleId=null,note=''}={}){
  const base={subjectKind:'resignation',subjectId:r.id,category:'approvals'},who=person(db,r.user_id)?.name??'';
  const holders=capabilityHolders(db,r.tenant_id,'people.manage',[r.user_id]);
  for(const userId of holders){
    if(bundleId)send(db,userId,actor.id,{...base,kind:'offboarding_opened',title:`فُتحت حزمة مغادرة: ${who}`,
      body:'افتح «رحلة الموظف» لإسناد خطواتها وإغلاق بنود إخلاء الطرف بأدلتها. التسوية النهائية لا تُعتمد قبل إغلاقها.'});
    else send(db,userId,actor.id,{...base,kind:'offboarding_blocked',title:`لم تُفتح حزمة مغادرة: ${who}`,
      body:`قُبلت الاستقالة ولم تُفتح الحزمة${note?`: ${note}`:''}. افتح «الاستقالة» واستعمل «فتح حزمة المغادرة» بعد معالجة السبب.`});
  }
  return holders.length;
}
export function travelNotice(db,actor,event,t,{days=null,capability=null}={}){
  const base={subjectKind:'travel_decision',subjectId:t.id},mine={...base,category:'my_requests'},decide={...base,category:'approvals'};
  const who=person(db,t.user_id)?.name??'',when=range(t.start_date,t.end_date),where='التفاصيل في «الانتداب».';
  const deciders=capabilityHolders(db,t.tenant_id,capability,[t.user_id]);
  if(event==='proposed'){
    send(db,t.user_id,actor.id,{...mine,kind:'travel_proposed',title:`اقتُرح انتدابك إلى ${t.destination} ${when}`,body:`بانتظار قرار صاحب الصلاحية. ${where}`});
    toHolders(db,t.tenant_id,deciders,actor.id,{...decide,kind:'travel_decision_needed',title:`انتداب ينتظر قرارك: ${who} إلى ${t.destination} ${when}`,body:'افتح «الانتداب» لإكمال الدرجة والسكن والتنقل ثم اعتماده أو رفضه.'},'صلاحية اعتماد الانتداب');
    return;
  }
  // البدل لا يُذكر مبلغًا: حركة راتب مقترحة يعتمدها معتمد الرواتب، وتُقرأ في الشاشة.
  if(event==='approved')return send(db,t.user_id,actor.id,{...mine,kind:'travel_approved',title:`اعتُمد انتدابك إلى ${t.destination} ${when}`,
    body:'بدل الانتداب — إن استحق — حركة راتب مقترحة يعتمدها معتمد الرواتب. التأشيرات والرسوم تُطالب بها كمصروفات بمستنداتها.'});
  if(event==='rejected')return send(db,t.user_id,actor.id,{...mine,kind:'travel_rejected',title:`رُفض اقتراح انتدابك إلى ${t.destination}`,body:`سبب القرار مكتوب في السجل. ${where}`});
  if(event==='cancelled')return send(db,t.user_id,actor.id,{...mine,kind:'travel_cancelled',title:`أُلغي اقتراح انتدابك إلى ${t.destination}`,body:where});
  if(event==='extension_requested'){
    for(const userId of deciders)
      send(db,userId,actor.id,{...decide,kind:'travel_extension_needed',title:`تمديد انتداب ينتظر قرارك: ${who} ${days} يوم`,body:'افتح «الانتداب» لقراءة ما أُنجز من المهمة قبل القرار (م64/1).'});
    if(actor.id!==t.user_id)send(db,t.user_id,actor.id,{...mine,kind:'travel_extension_requested',title:`طُلب تمديد انتدابك ${days} يوم`,body:`بانتظار قرار صاحب الصلاحية. ${where}`});
    return;
  }
  if(event==='extension_approved')return send(db,t.user_id,actor.id,{...mine,kind:'travel_extension_approved',title:`مُدد انتدابك ${days} يوم حتى ${dayName(t.end_date)}`,
    body:'بدل التمديد — إن استحق — حركة راتب مقترحة يعتمدها معتمد الرواتب.'});
  if(event==='extension_rejected')return send(db,t.user_id,actor.id,{...mine,kind:'travel_extension_rejected',title:`رُفض تمديد انتدابك ${days} يوم`,body:`سبب القرار مكتوب في السجل. ${where}`});
}

/* ───── تسوية نهاية الخدمة (D-15) ───── */
// المغادر كان لا يُخبَر بشيء عن أكبر دفعة في تاريخه مع الشركة. يُخبَر الآن، وبالمهلة النظامية وعدّادها (م50/2).
// المبالغ لا تدخل نص الإشعار — قاعدة notices.mjs، والبريد ينقل عنوانه — بل تُقرأ كاملة في «الرواتب والقسائم»:
// المكافأة، وقراءة م36/2 المطبقة، وبدل الإجازة، والمحسوم، والصافي. الإشعار يقول إنها صدرت وإلى متى مهلتها.
export function settlementNotice(db,actor,s,{dues_due_on:duesDueOn=null,days_left:daysLeft=null}={}){
  const base={subjectKind:'service_settlement',subjectId:s.id,category:'my_requests'};
  const deadline=duesDueOn?`المهلة النظامية لصرف مستحقاتك تنتهي في ${dayName(duesDueOn)}${Number.isInteger(daysLeft)?` (${daysLeft>=0?`باقٍ ${daysLeft} يوم`:`مضى عليها ${-daysLeft} يوم`})`:''} (م50/2). `:'';
  // صاحبها يُخبَر ولو كان المعتمد هو من أدرج القرار: القاعدة «لا يُشعر أحد بفعله هو» لا تنطبق — التسوية تُعد وتُعتمد عن غيره.
  notifySubject(db,{...base,userId:s.user_id,kind:'settlement_approved',title:'اعتُمدت تسوية نهاية خدمتك',
    body:`${deadline}افتح «الرواتب والقسائم» لقراءة المكافأة وقراءة م36/2 المطبقة وبدل الإجازة والمحسوم والصافي.`});
}

/* ───── الخطابات: الإعداد والإلغاء ───── */
export function letterNotice(db,actor,event,r,typeName,reference=null){
  const base={subjectKind:'letter_request',subjectId:r.id};
  if(event==='prepared')return send(db,r.user_id,actor.id,{...base,kind:'letter_prepared',title:`أُعدّ خطابك: ${typeName}`,body:'بانتظار الإصدار والاعتماد. سيصلك إشعار عند صدوره.'});
  if(event==='request_cancelled')return send(db,r.user_id,actor.id,{...base,kind:'letter_request_cancelled',title:`أُلغي طلب الخطاب: ${typeName}`,body:'السبب مكتوب في «خطاباتي».'});
  if(event==='letter_cancelled')return send(db,r.user_id,actor.id,{...base,kind:'letter_cancelled',title:`أُلغي خطابك الصادر: ${typeName}`,body:`${reference?`المرجع ${reference}. `:''}لم يعد رمز التحقق منه صالحًا. السبب في «خطاباتي».`});
}
