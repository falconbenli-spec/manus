import { randomUUID } from 'node:crypto';
import { audit, now } from './db.mjs';
import { fail } from './auth.mjs';
import * as v from './validation.mjs';
import { activeEmployeePage, personAssignment, personName } from './people-read.mjs';
import { refuse } from './refusal.mjs';

const item=(category,axis,question,indicator,priority)=>({category,axis,question,indicator,priority});
const COMMON=[
  item('الهوية والاكتمال','بيانات الغلاف','هل يتضمن الغلاف اسم الجهة المستهدفة واسم العرض وتاريخًا أو إصدارًا صحيحًا؟','الغلاف خالٍ من الأخطاء أو بيانات عميل آخر.','حرج'),
  item('الهوية والاكتمال','الفهرس وترتيب الأقسام','هل يعكس جدول المحتويات الأقسام الفعلية وتسلسلها؟','كل عنوان في الفهرس يقود إلى قسم موجود.','متوسطة'),
  item('الهوية والاكتمال','اتساق الهوية','هل تستخدم الشرائح الهوية والشعارات والألوان والخطوط نفسها بصورة متسقة؟','لا توجد شعارات قديمة أو صور منخفضة الدقة أو شرائح خارج القالب.','متوسطة'),
  item('فهم الاحتياج','ملخص الاحتياج','هل يعرض المقترح فهمًا دقيقًا لتحدي العميل واحتياجه؟','ملخص واضح للمشكلة والفرصة والسياق.','حرج'),
  item('فهم الاحتياج','مواءمة النطاق','هل يغطي المقترح كامل نطاق العمل المطلوب دون افتراضات غير معلنة؟','ربط ظاهر بين المتطلبات والاستجابة.','حرج'),
  item('فهم الاحتياج','الأهداف ومؤشرات النجاح','هل تم تعريف أهداف قابلة للقياس ومؤشرات نجاح واقعية؟','أهداف محددة ومؤشرات مخرجات أو نتائج.','عالية'),
  item('الحل والمنهجية','القيمة المقترحة','هل يوضح العرض القيمة المضافة والتميّز بصورة مقنعة ومناسبة للعميل؟','تميّز مرتبط باحتياج العميل وليس وصفًا عامًا فقط.','عالية'),
  item('الحل والمنهجية','منهجية التنفيذ','هل منهجية التنفيذ متدرجة ومنطقية وتشرح كيف سيُنجز العمل؟','مراحل واضحة تشمل التخطيط والتنفيذ والمراجعة والإقفال.','حرج'),
  item('الحل والمنهجية','المخرجات ومعايير القبول','هل لكل مرحلة مخرجات محددة وطريقة مراجعة أو قبول؟','مخرجات قابلة للتحقق ودورات اعتماد واضحة.','حرج'),
  item('الحل والمنهجية','الافتراضات والاعتمادات','هل الافتراضات والاعتمادات والقيود موضحة؟','تحديد المدخلات المطلوبة من العميل وما يؤثر في الجدول.','عالية'),
  item('إدارة المشروع','الجدول الزمني','هل الجدول الزمني قابل للتنفيذ ويربط المراحل بالمعالم والمخرجات؟','تواريخ أو مدد منطقية ومعالم قرار ظاهرة.','حرج'),
  item('إدارة المشروع','الحوكمة ومسار القرار','هل يحدد العرض آلية الحوكمة والاجتماعات ومسار التصعيد؟','مسؤوليات مراجعة واعتماد وتصعيد محددة.','عالية'),
  item('إدارة المشروع','المخاطر والمعالجة','هل يحدد المخاطر الرئيسة وخطة التخفيف أو الاستجابة؟','مخاطر تنفيذية وتشغيلية وخطة معالجة.','عالية'),
  item('الفريق والخبرة','فريق العمل','هل يغطي الفريق الأدوار المطلوبة والخبرات ذات الصلة وتوافر الأعضاء؟','أدوار ومسؤوليات وسير ذاتية أو خبرات مرتبطة بالنطاق.','حرج'),
  item('الفريق والخبرة','نماذج الأعمال','هل ترتبط دراسات الحالة بالنطاق وتعرض نتيجة أو أثرًا يمكن التحقق منه؟','أمثلة ملائمة وبيانات أو روابط تعمل عند توفرها.','عالية'),
  item('الجودة والامتثال','سلامة اللغة','هل اللغة العربية دقيقة ومهنية وخالية من الأخطاء والصياغات العامة؟','مراجعة لغوية وتناسق للمصطلحات والأرقام.','متوسطة'),
  item('الجودة والامتثال','المصادر والروابط','هل الروابط والملاحق والمراجع والأرقام قابلة للتحقق؟','اختبار الروابط وإحالة واضحة للمصادر.','متوسطة'),
  item('الإغلاق','الخطوة التالية','هل يوضح العرض الإجراء المطلوب من العميل والخطوات التالية ونقطة التواصل؟','دعوة واضحة للاعتماد أو الاجتماع أو بدء العمل.','متوسطة')
];
const PRIVATE=[
  item('القطاع الخاص','ملاءمة السوق والعميل','هل تم تخصيص العرض لطبيعة أعمال العميل والقطاع والسوق التنافسي؟','إشارات مباشرة إلى العميل وقطاعه واحتياجاته.','حرج'),
  item('القطاع الخاص','الأثر التجاري','هل يوضح العرض الأثر التجاري المتوقع مثل النمو أو الكفاءة أو تجربة العميل؟','نتائج تجارية أو مؤشرات قابلة للقياس.','عالية'),
  item('القطاع الخاص','مرونة الحل','هل يوضح العرض بدائل أو مراحل قابلة للتوسع وفق أولويات العميل؟','خيارات أو وحدات عمل متدرجة عند الحاجة.','متوسطة'),
  item('القطاع الخاص','نموذج التسليم','هل يوضح انتقال العمل من فريق المشروع إلى التشغيل أو العميل؟','خطة تسليم أو تمكين أو تدريب أو توثيق.','عالية'),
  item('القطاع الخاص','خبرة القطاع','هل تتضمن الأمثلة خبرة مماثلة في القطاع الخاص أو سوق العميل؟','دراسات حالة مناسبة لا أمثلة عامة فقط.','عالية'),
  item('القطاع الخاص','تجربة العميل','هل تبيّن المنهجية نقاط التواصل والإبلاغ وتجربة العميل أثناء التنفيذ؟','خطة اجتماعات وتقارير ومسؤول اتصال.','متوسطة'),
  item('القطاع الخاص','النتائج السريعة','هل يوضح العرض إنجازات أو مكاسب مبكرة يمكن تحقيقها؟','معالم قصيرة المدى ذات أثر ملموس.','متوسطة'),
  item('القطاع الخاص','الجاهزية التجارية','هل تم فصل أي افتراضات أو خيارات تجارية عن الاستجابة الفنية بوضوح؟','لا توجد تعارضات بين الحل الفني والشروط أو الخيارات المقترحة.','متوسطة'),
  item('القطاع الخاص','مرحلة الاكتشاف','هل يوضح العرض خطة جمع المعلومات الأولية عبر اجتماعات أو ورش مع العميل؟','تحديد مصادر المعلومات وأصحاب المصلحة ومخرجات الاكتشاف.','عالية'),
  item('القطاع الخاص','تحليل السوق والجمهور','هل يتضمن العرض تقييمًا للوضع الراهن للسوق والجمهور وتحديات التواصل؟','تحليل موثق للسوق أو الفئات أو منهج واضح لإجرائه.','عالية'),
  item('القطاع الخاص','تقييم القدرات والأداء','هل يحدد العرض آلية لتقييم القدرات الداخلية والأداء الحالي؟','معايير تقييم ومصادر بيانات ومخرجات متوقعة.','متوسطة'),
  item('القطاع الخاص','تحليل الفجوات','هل يربط العرض تحليل الفجوات والتحديات بالحل المقترح؟','فجوات محددة مع استجابة أو أولوية معالجة لكل فجوة.','عالية')
];
const GOVERNMENT=[
  item('الجهات الحكومية','مرجع نطاق العمل','هل تتم الإشارة بوضوح إلى نطاق العمل أو المتطلبات أو وثائق الطرح ذات الصلة؟','جدول مواءمة أو إحالات مباشرة للمتطلبات.','حرج'),
  item('الجهات الحكومية','تغطية المتطلبات','هل تم تغطية كل متطلب فني ومخرج مطلوب دون فجوات؟','مصفوفة امتثال أو تحقق بندي.','حرج'),
  item('الجهات الحكومية','الحوكمة الرسمية','هل تحدد الحوكمة اللجان ومسارات الاعتماد والتقارير الدورية؟','هيكل حوكمة وتكرار اجتماعات وصلاحيات قرار.','حرج'),
  item('الجهات الحكومية','إدارة أصحاب المصلحة','هل يعالج العرض تعدد أصحاب المصلحة وآلية التواصل والتصعيد؟','خريطة أصحاب مصلحة ومسؤوليات واضحة.','عالية'),
  item('الجهات الحكومية','الالتزام والسرية','هل يوضح التعامل مع السرية وملكية البيانات والمحتوى والمتطلبات النظامية المنطبقة؟','ضوابط أو التزامات محددة مع إحالة للمراجعة المختصة عند الحاجة.','حرج'),
  item('الجهات الحكومية','استمرارية الأعمال','هل يتضمن العرض ترتيبات الاستمرارية وخطة للتعامل مع التأخير أو المخاطر؟','بدائل موارد وخطة استجابة وتصعيد.','عالية'),
  item('الجهات الحكومية','مستوى الخدمة','هل تم تعريف مستوى الخدمة ومواعيد الاستجابة والتقارير عند ارتباطها بالنطاق؟','مؤشرات استجابة وقياس وإبلاغ.','عالية'),
  item('الجهات الحكومية','إدارة المعرفة','هل يوضح العرض التوثيق ونقل المعرفة وتسليم الملفات للجهة؟','مستودع وثائق وخطة تدريب أو تسليم.','عالية'),
  item('الجهات الحكومية','تأهيل الفريق','هل يوضح مؤهلات الفريق ومدى ملاءمته للخبرات المطلوبة؟','أدوار مع خبرة مثبتة وشهادات أو نماذج عند الحاجة.','حرج'),
  item('الجهات الحكومية','خبرات ذات صلة','هل ترتبط نماذج الأعمال بالجهات الحكومية أو الفعاليات والمشاريع الكبيرة ذات العلاقة؟','أمثلة قريبة من حجم وتعقيد نطاق الجهة.','عالية'),
  item('الجهات الحكومية','خطة الانتقال والتسليم','هل يوضح العرض آلية الانتقال من البدء إلى التنفيذ ثم الإقفال والتسليم؟','بوابات مراحل وتسليمات واعتمادات.','عالية'),
  item('الجهات الحكومية','إدارة التغيير','هل يحدد العرض آلية اعتماد التغييرات في النطاق أو الجدول أو المخرجات؟','نموذج طلب تغيير وسلطة اعتماد وأثر زمني.','عالية'),
  item('الجهات الحكومية','التقارير التنفيذية','هل تتضمن التقارير المقترحة مؤشرات أداء ومخاطر وقرارات مطلوبة؟','قالب تقرير دوري واضح ومختصر.','متوسطة'),
  item('الجهات الحكومية','الملاحق والوثائق','هل الملاحق والإقرارات والوثائق المطلوبة مذكورة ومرفقة أو مبيّن سبب عدم انطباقها؟','قائمة ملاحق مكتملة ومتسقة.','حرج'),
  item('الجهات الحكومية','دورة الخدمة','هل يوضح العرض تسلسل استلام الطلب ثم تنفيذه ثم تدقيقه وجودته ثم تسليمه للجهة؟','مسار تشغيلي صريح مع مسؤول لكل مرحلة.','حرج'),
  item('الجهات الحكومية','اجتماع البدء','هل يحدد العرض اجتماعًا أوليًا لمناقشة أهداف المشروع ومرئيات الجهة؟','هدف الاجتماع ومخرجاته والحضور المتوقع.','عالية'),
  item('الجهات الحكومية','نقطة التواصل','هل يعين العرض نقطة تواصل واضحة بين فريق العميل وفريق التنفيذ؟','اسم دور أو آلية اتصال ومسؤولية متابعة ظاهرة.','عالية'),
  item('الجهات الحكومية','اكتشاف متطلبات الإدارات','هل يوضح العرض آلية زيارات أو جلسات مع الأقسام المعنية لفهم المتطلبات؟','خطة جمع متطلبات أو ورش أو زيارات ومخرجات موثقة.','عالية'),
  item('الجهات الحكومية','اجتماعات المراجعة','هل يوضح العرض دورية اجتماعات مراجعة الأعمال وتطويرها؟','تكرار الاجتماعات والحضور ومحضر القرارات أو الإجراءات.','متوسطة'),
  item('الجهات الحكومية','التقارير الدورية','هل يحدد العرض تقريرًا دوريًا عن الإنجاز والقضايا والخيارات أو الأفكار المستقبلية؟','قالب تقرير ومحتويات واضحة ومسار اعتماد.','متوسطة')
];

export const proposalDefinitions=type=>{
  if(!['private','government'].includes(type))fail(400,'proposal_type','اختر قطاعًا خاصًا أو جهة حكومية');
  return [...COMMON,...(type==='private'?PRIVATE:GOVERNMENT)].map((row,index)=>({...row,item_no:index+1}));
};
const optional=(value,label,max=3000)=>value===undefined||value===null||String(value).trim()===''?'':v.text(value,label,max).trim();
const requireTransaction=db=>{if(!db.isTransaction)fail(500,'transaction_required','كتابة مراجعة العرض الفني تحتاج معاملة قاعدة بيانات');};
const installed=db=>!!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='technical_proposal_checklists'").get();
export const proposalGateRequired=(db,tenant)=>installed(db)&&db.prepare('SELECT required FROM technical_proposal_policies WHERE tenant_id=?').get(tenant)?.required===1;
export const proposalQuoteReady=(db,tenant,quoteId)=>!proposalGateRequired(db,tenant)||!!db.prepare("SELECT 1 FROM technical_proposal_checklists WHERE quote_id=? AND status='approved'").get(quoteId);

const reviewOf=(db,id)=>{
  const row=db.prepare('SELECT * FROM technical_proposal_reviews WHERE checklist_id=?').get(id)??null;
  return row?{...row,reviewed_by_name:personName(db,row.reviewed_by),items:db.prepare('SELECT * FROM technical_proposal_review_items WHERE review_id=? ORDER BY rowid').all(row.id)}:null;
};
const snapshot=(db,row)=>({...row,submitted_by_name:personName(db,row.submitted_by),items:db.prepare('SELECT * FROM technical_proposal_items WHERE checklist_id=? ORDER BY item_no').all(row.id),review:reviewOf(db,row.id)});
export const checklistsForQuote=(db,quoteId)=>installed(db)?db.prepare('SELECT * FROM technical_proposal_checklists WHERE quote_id=? ORDER BY revision DESC').all(quoteId).map(row=>snapshot(db,row)):[];
export const currentProposalChecklist=(db,quoteId)=>{if(!installed(db))return null;const row=db.prepare("SELECT * FROM technical_proposal_checklists WHERE quote_id=? ORDER BY CASE status WHEN 'approved' THEN 0 WHEN 'pending_epmo' THEN 1 ELSE 2 END,revision DESC LIMIT 1").get(quoteId);return row?snapshot(db,row):null;};

export function proposalActionsForCase(db,u,c){
  if(!installed(db))return [];
  if(u.id!==c.owner_id||c.status!=='quote_draft'||!c.current_quote_id)return [];
  const latest=db.prepare('SELECT status FROM technical_proposal_checklists WHERE quote_id=? ORDER BY revision DESC LIMIT 1').get(c.current_quote_id);
  return !latest||latest.status==='changes_required'?['submit_private_proposal_checklist','submit_government_proposal_checklist']:[];
}

export function proposalReviewBoard(db,supplied){
  let reviewers=[];
  try{const u=epmoActor(db,supplied);reviewers=activeEmployeePage(db,u.tenant_id,{limit:500});}catch(error){if(error.code!=='epmo_review_denied')throw error;}
  return {queue:listProposalReviewQueue(db,supplied),reviewers,definitions:{private:proposalDefinitions('private'),government:proposalDefinitions('government')}};
}

export function submitProposalChecklist(db,u,c,input){
  requireTransaction(db);
  v.object(input,['case_version','proposal_type','items']);v.version(input.case_version,c.version);
  if(u.id!==c.owner_id||c.status!=='quote_draft'||!c.current_quote_id)fail(403,'proposal_checklist_denied','يرفع القائمة مالك العرض وهو في حالة المسودة');
  const quote=db.prepare('SELECT * FROM commercial_quotes WHERE id=? AND case_id=?').get(c.current_quote_id,c.id);
  if(!quote)refuse(409,'quote_required',{what:'لا تُقدَّم قائمة العرض الفني من دون نسخة عرض محفوظة',missing:[{document:'نسخة العرض الحالية',owner:'مالك ملف العميل'}],next:'احفظ العرض ثم افتح قائمة المراجعة لنفس النسخة'});
  if(db.prepare("SELECT 1 FROM technical_proposal_checklists WHERE quote_id=? AND status IN ('pending_epmo','approved')").get(quote.id))fail(409,'proposal_checklist_active','قائمة العرض تنتظر EPMO أو معتمدة أصلًا');
  const definitions=proposalDefinitions(input.proposal_type);
  if(!Array.isArray(input.items)||input.items.length!==definitions.length)fail(400,'proposal_items','أرفق دليلًا لكل بند في القائمة');
  const byNo=new Map(definitions.map(row=>[row.item_no,row])),seen=new Set(),clean=input.items.map(value=>{
    v.object(value,['item_no','evidence','author_note']);const definition=byNo.get(value.item_no);
    if(!definition||seen.has(value.item_no))fail(400,'proposal_items','القائمة فيها بند ناقص أو مكرر أو غير تابع لنوع العرض');
    seen.add(value.item_no);return {definition,evidence:v.text(value.evidence,`دليل البند ${value.item_no}`,3000,3),author_note:optional(value.author_note,`ملاحظة البند ${value.item_no}`)};
  });
  const id=randomUUID(),time=now(),revision=Number(db.prepare('SELECT COALESCE(MAX(revision),0)+1 AS n FROM technical_proposal_checklists WHERE quote_id=?').get(quote.id).n);
  db.prepare("INSERT INTO technical_proposal_checklists(id,tenant_id,case_id,quote_id,revision,proposal_type,status,source_reference,submitted_by,submitted_at) VALUES(?,?,?,?,?,?,'pending_epmo','قائمة تحقق لمراجعة العروض الفنية.xlsx',?,?)")
    .run(id,c.tenant_id,c.id,quote.id,revision,input.proposal_type,u.id,time);
  const insert=db.prepare('INSERT INTO technical_proposal_items(id,checklist_id,quote_id,item_no,category,axis,question,review_indicator,priority,evidence,author_note,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)');
  for(const row of clean){const d=row.definition;insert.run(randomUUID(),id,quote.id,d.item_no,d.category,d.axis,d.question,d.indicator,d.priority,row.evidence,row.author_note,time);}
  audit(db,u,'technical_proposal',id,'proposal_checklist.submitted',{}, {case_id:c.id,quote_id:quote.id,revision,proposal_type:input.proposal_type,item_count:clean.length},'قائمة تحقق لمراجعة العروض الفنية.xlsx');
  return snapshot(db,db.prepare('SELECT * FROM technical_proposal_checklists WHERE id=?').get(id));
}

const epmoActor=(db,supplied)=>{
  const u=supplied&&personAssignment(db,supplied.tenant_id,supplied.id);
  if(!u?.active||u.department_id!=='epmo'||!['employee','manager','pm'].includes(u.role))refuse(403,'epmo_review_denied',{what:'مراجعة العرض الفني محصورة في فريق EPMO المهيأ',missing:[{document:'حساب EPMO نشط',owner:'مسؤول المنصة'}],next:'افتح المراجعة بحساب EPMO المخول'});return u;
};
export function listProposalReviewQueue(db,supplied){
  if(!installed(db))return [];
  let u;try{u=epmoActor(db,supplied);}catch(error){if(error.code==='epmo_review_denied')return [];throw error;}
  return db.prepare("SELECT * FROM technical_proposal_checklists WHERE tenant_id=? ORDER BY CASE status WHEN 'pending_epmo' THEN 0 ELSE 1 END,submitted_at DESC LIMIT 200").all(u.tenant_id).map(row=>{
    const view=snapshot(db,row),commercial=db.prepare('SELECT name FROM commercial_cases WHERE id=?').get(row.case_id);
    return {...view,client_name:commercial?.name??'',actions:row.status==='pending_epmo'?['review_proposal_checklist']:[]};
  });
}

export function reviewProposalChecklist(db,supplied,id,input){
  requireTransaction(db);const u=epmoActor(db,supplied);
  v.object(input,['decision','note','items']);
  if(!['approved','changes_required'].includes(input.decision))refuse(400,'proposal_decision',{what:'قيمة قرار EPMO لا تطابق القرارات المتاحة',next:'اختر اعتماد القائمة أو إعادتها لمعالجة الفجوات'});
  const row=typeof id==='string'&&db.prepare('SELECT * FROM technical_proposal_checklists WHERE id=? AND tenant_id=?').get(id,u.tenant_id);
  if(!row)refuse(404,'not_found',{what:'قائمة العرض الفني المطلوبة غير موجودة ضمن كيانك',next:'أعد تحميل طابور EPMO وافتح قائمة ظاهرة فيه'});if(row.status!=='pending_epmo')fail(409,'proposal_review_closed','اتخذ EPMO قراره على هذا الإصدار');
  const c=db.prepare('SELECT * FROM commercial_cases WHERE id=? AND tenant_id=?').get(row.case_id,u.tenant_id);
  if([row.submitted_by,c.owner_id].includes(u.id))fail(409,'proposal_review_independence','مراجع EPMO لازم يكون مختلفًا عن معد العرض');
  const source=db.prepare('SELECT * FROM technical_proposal_items WHERE checklist_id=? ORDER BY item_no').all(row.id);
  if(!Array.isArray(input.items)||input.items.length!==source.length)refuse(400,'proposal_review_items',{what:'مراجعة EPMO لم تشمل كل بنود القائمة مرة واحدة',missing:[{document:'نتيجة مراجعة لكل بند',owner:'مراجع EPMO'}],next:'أكمل البنود الظاهرة من دون حذف أو تكرار'});
  const byId=new Map(source.map(item=>[item.id,item])),seen=new Set(),clean=input.items.map(value=>{
    v.object(value,['item_id','result','epmo_note','responsible_user_id','due_on']);const line=typeof value.item_id==='string'&&byId.get(value.item_id);
    if(!line||seen.has(line.id))fail(400,'proposal_review_items','المراجعة فيها بند ناقص أو مكرر أو غير تابع للقائمة');seen.add(line.id);
    if(!['passed','gap','not_applicable'].includes(value.result))refuse(400,'proposal_review_result',{what:`نتيجة البند ${line.item_no} لا تطابق نتائج المراجعة المتاحة`,next:'اختر مستوفى أو فجوة أو لا ينطبق'});
    const note=optional(value.epmo_note,'ملاحظة EPMO');let responsible=null,due=null;
    if(value.result==='not_applicable'&&note.length<3)fail(400,'proposal_review_note','عدم الانطباق يحتاج سببًا مكتوبًا');
    if(value.result==='gap'){
      const assignee=typeof value.responsible_user_id==='string'&&personAssignment(db,u.tenant_id,value.responsible_user_id);
      responsible=assignee?.active?assignee.id:null;
      if(!responsible)fail(400,'proposal_responsible','الفجوة تحتاج مسؤول إجراء نشطًا');due=v.date(value.due_on);if(note.length<3)refuse(400,'proposal_review_note',{what:`الفجوة في البند ${line.item_no} بلا وصف يوضح ما يلزم`,missing:[{document:'ملاحظة فجوة واضحة',owner:'مراجع EPMO'}],next:'اكتب سبب الفجوة والإجراء المطلوب قبل إعادة العرض'});
    }
    return {line,result:value.result,note,responsible,due};
  });
  if(input.decision==='approved'&&clean.some(item=>item.result==='gap'))fail(409,'proposal_gaps_open','ما يعتمد العرض وفيه فجوة مفتوحة');
  const note=v.text(input.note,'خلاصة مراجعة EPMO',3000,3),reviewId=randomUUID(),time=now();
  const insert=db.prepare('INSERT INTO technical_proposal_review_items(id,review_id,checklist_id,item_id,result,epmo_note,responsible_user_id,due_on,created_at) VALUES(?,?,?,?,?,?,?,?,?)');
  for(const item of clean)insert.run(randomUUID(),reviewId,row.id,item.line.id,item.result,item.note,item.responsible,item.due,time);
  db.prepare('INSERT INTO technical_proposal_reviews(id,tenant_id,checklist_id,quote_id,decision,note,reviewed_by,reviewed_at) VALUES(?,?,?,?,?,?,?,?)').run(reviewId,u.tenant_id,row.id,row.quote_id,input.decision,note,u.id,time);
  audit(db,u,'technical_proposal',row.id,'proposal_checklist.reviewed',{status:'pending_epmo'}, {status:input.decision,review_id:reviewId,gaps:clean.filter(item=>item.result==='gap').length},note);
  return snapshot(db,db.prepare('SELECT * FROM technical_proposal_checklists WHERE id=?').get(row.id));
}

export function assertProposalChecklistApproved(db,c,quoteId){
  if(!proposalGateRequired(db,c.tenant_id))return null;
  const row=db.prepare("SELECT * FROM technical_proposal_checklists WHERE quote_id=? AND status='approved' ORDER BY revision DESC LIMIT 1").get(quoteId);
  if(!row)fail(409,'proposal_checklist_required','تقديم العرض ينتظر قائمة التدقيق الفنية المعتمدة من EPMO لنفس نسخة العرض');
  return row;
}
