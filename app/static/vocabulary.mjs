// القاموس الواحد (م0 «السور»): عبارة واحدة لكل حالة طلب، وخريطة من حالات كل وحدة إلى الحالات الثماني، وأسماء الأدوار.
// وحدة نقية بلا DOM وبلا استيراد: يقرؤها الخادم (app/my-requests.mjs) والمتصفح (app.mjs وkit.mjs والشاشات) من المصدر نفسه.
// القاعدة: لا تُكتب عبارة حالة في شاشة ولا في وحدة خادم. من احتاج عبارة أخذها من هنا، ومسنّنة scripts/check.mjs تعدّ ما بقي خارجه
// ولا تسمح للعدّ أن يرتفع. سبب اختيار كل عبارة مكتوب بجوارها، وموثّق في docs/implementation/handoff/wave0-guard-rails.md.
//
// ── اللهجة (قرار المالك) ──────────────────────────────────────────────────────────────────────
// المنصة تتكلم نجدي دارج: كلام زميل يشرح لك من المكتب اللي جنبك، لا نص رسمي مكتوب. والعبارة تبقى قاطعة في الفلوس
// والتواريخ والاعتماد والرفض — لهجة واضحة لا لهجة مايعة.
// وحدُّ اللهجة: **نص النظام لا يُترجم.** ما كان منقولًا من لائحة العمل الموقّعة أو من نظام العمل — كلام المادة نفسه
// ورقمها («م77»، «نظام العمل م116») — يبقى بحرفه، لأن إعادة صياغته تُخرجه من كونه اقتباسًا وهو سبب حجّيته. جملة المنصة
// **عن** المادة لهجة، وكلام المادة نفسه لا. ليس في هذا الملف نص مادة، فحدُّ اللهجة فيه ليس النظام بل الاختبارات.
//
// والحالات الثماني نفسها مقفلة عمليًا، ويُرفع أمرها للمالك لأن فتحها قرارُه لا قرار هذه الجولة:
//   pending «بانتظار الاعتماد» وreturned «معاد للتعديل» وapproved «معتمد» تثبّتها tests/vocabulary.test.mjs بحرفها،
//   وin_progress «قيد التنفيذ» تثبّتها tests/kit.test.mjs، و«قُدّم» و«ينتظر ردك» و«انقضى لعدم الرد» تثبّتها
//   tests/catalog-interaction.test.mjs وtests/returned-lifecycle.test.mjs. والثلاث الباقيات مقفلة بسبب ثانٍ:
//   عبارة الوحدة تُطبع بجوار عبارة القاموس ما لم تطابقها، فتغيير «مكتمل» أو «ملغى» هنا وحدهما يطبع «خلص مكتمل».
// واللهجة نزلت حيث تنفع فعلًا: جمل الرفض والحالات الفارغة والخطوة التالية في الوحدات، لا كلمة الشارة الواحدة.

// الحالات الثماني بترتيب رحلة الطلب. الترتيب مقصود: تُبنى منه قوائم التصفية.
export const REQUEST_STATUSES=Object.freeze(['draft','pending','returned','approved','in_progress','completed','rejected','cancelled']);

// [العبارة العربية، العبارة الإنجليزية]. الصيغة محايدة تجاه القارئ: يقرؤها صاحب الطلب ومعتمده ومنفّذه والمدير بالنص نفسه،
// فلا ضمير مخاطَب فيها («معاد إليك» تصح لصاحب الطلب وحده وتكذب على كل قارئ غيره).
export const REQUEST_STATUS=Object.freeze({
  draft:Object.freeze(['مسودة','Draft']),
  // «بانتظار الاعتماد» لا «قيد الاعتماد»: هي عبارة 41 موضعًا في الوحدات مقابل 11، وهي ترجمة النص الإنجليزي المعتمد أصلًا في كل النسخ
  // (Awaiting approval)، وتقول لصاحب الطلب إن طلبه عند شخص فيتابعه. و«قيد» تلتبس بالقيد المحاسبي، ومن التباسها وُلدت «قيد بانتظار الاعتماد».
  pending:Object.freeze(['بانتظار الاعتماد','Awaiting approval']),
  returned:Object.freeze(['معاد للتعديل','Returned']),
  // «معتمد» وحدها: العبارة نفسها تُكتب على خطوة الاعتماد في مسار الطلب، و«معتمد بانتظار التنفيذ» لا تصح على خطوة.
  // ما ينتظره الطلب بعد اعتماده يقوله سطر «المنتظر» في شاشة «أين طلباتي»، لا شارة الحالة.
  approved:Object.freeze(['معتمد','Approved']),
  in_progress:Object.freeze(['قيد التنفيذ','In progress']),
  // «خلص» أقرب لكلام الناس من «مكتمل»، لكن «مكتمل» تبقى: عبارة المزايا (app/benefits-portal.mjs) مثبَّتة بحرفها في
  // tests/module-fixes-employee.test.mjs، فلو تغيّرت هذه وحدها لطبعت الشارة «خلص مكتمل». و«مسودة» و«مرفوض» منطوقتان
  // أصلًا فلا تُمسّان: اللهجة ليست تغييرًا لأجل التغيير.
  completed:Object.freeze(['مكتمل','Completed']),
  rejected:Object.freeze(['مرفوض','Rejected']),
  // «ملغى» باقية: صيغة الكلام «ملغي» تفرق عنها بحرف واحد لا يسمعه القارئ، وعبارات الوحدات التي تقول «ملغى» بجوارها
  // تعيش في ملفات شاشات خارج نطاق هذه الجولة (app/static/leave-ui.mjs)، فتغييرها هنا وحده يطبع «ملغي ملغى» في الشارة.
  cancelled:Object.freeze(['ملغى','Cancelled'])
});

// لون الشارة لكل حالة، من أصناف style.css القائمة (badge pending/approved/rejected…): الحالة نفسها اسم الصنف، فلا خريطة ألوان ثانية.
export const statusTone=status=>Object.hasOwn(REQUEST_STATUS,status)?status:'';

// عبارة الحالة بلغة الواجهة. حالة خارج الثماني تعود كما هي ولا تُخفى: ظهور مفتاح خام في الشاشة عيب يُرى فيُصلح، لا خطأ يُبتلع.
export function statusName(status,lang='ar'){
  const pair=Object.hasOwn(REQUEST_STATUS,status)?REQUEST_STATUS[status]:null;
  return pair?pair[lang==='ar'?0:1]:String(status??'');
}
// الخريطة العربية وحدها، لوحدات الخادم التي تحمل status_name نصًا واحدًا.
export const REQUEST_STATUS_AR=Object.freeze(Object.fromEntries(REQUEST_STATUSES.map(s=>[s,REQUEST_STATUS[s][0]])));

// حالات كل وحدة على الحالات الثماني، وعبارة الوحدة نفسها بجوارها. مصدر المطابقة ما كانت «طلباتي» (app/my-requests.mjs) تحمله
// في إحدى عشرة خريطة محلية، ومصدر العبارات قواميس الوحدات نفسها في الخادم. الحالة الموحدة تجيب «أين طلبي؟» بكلمة واحدة في كل الشاشات،
// وعبارة الوحدة تُبقي ما تعرفه الوحدة وحدها (عند من هو: المدير أم المالية) ظاهرًا بجوارها ولا تُمحى.
const m=(status,phrase)=>Object.freeze({status,phrase});
export const MODULE_STATUS_MAP=Object.freeze({
  leave:Object.freeze({pending_manager:m('pending','بانتظار المدير'),pending_authority:m('pending','بانتظار صاحب الصلاحية'),pending_hr:m('pending','بانتظار خدمات الموظف'),
    returned:m('returned','معاد للتعديل'),approved:m('approved','معتمد'),rejected:m('rejected','مرفوض'),cancelled:m('cancelled','ملغى')}),
  expense:Object.freeze({submitted:m('pending','بانتظار المدير المباشر'),manager_approved:m('pending','بانتظار المالية'),finance_approved:m('approved','معتمدة — بانتظار التعويض'),
    reimbursed:m('completed','عُوضت'),rejected:m('rejected','مرفوضة')}),
  custody:Object.freeze({requested:m('pending','بانتظار اعتماد المالية'),approved:m('approved','معتمدة — لم تُصرف بعد'),issued:m('in_progress','مصروفة وقيد التسوية'),
    closed:m('completed','مقفلة'),rejected:m('rejected','مرفوضة')}),
  letter:Object.freeze({requested:m('pending','مطلوب'),prepared:m('in_progress','مُعدّ بانتظار الإصدار'),issued:m('completed','صادر'),rejected:m('rejected','مرفوض'),cancelled:m('cancelled','ملغى الطلب')}),
  hr_case:Object.freeze({open:m('pending','لم تُسند بعد'),assigned:m('in_progress','قيد المعالجة'),closed:m('completed','مغلقة')}),
  attendance_correction:Object.freeze({pending:m('pending','بانتظار القرار'),approved:m('approved','معتمد'),rejected:m('rejected','مرفوض')}),
  training:Object.freeze({requested:m('pending','بانتظار القرار'),approved:m('approved','معتمد'),rejected:m('rejected','مرفوض'),completed:m('completed','مكتمل'),cancelled:m('cancelled','ملغى')}),
  resignation:Object.freeze({submitted:m('pending','مقدمة بانتظار الرد'),deferred:m('pending','مؤجل قبولها لمصلحة العمل'),accepted:m('approved','مقبولة'),
    deemed_accepted:m('approved','مقبولة حكمًا بمضي المدة'),withdrawn:m('cancelled','مسحوبة')}),
  travel:Object.freeze({proposed:m('pending','مقترح بانتظار قرار صاحب الصلاحية'),approved:m('approved','قرار انتداب معتمد'),rejected:m('rejected','مرفوض'),cancelled:m('cancelled','ملغى')}),
  benefit:Object.freeze({pending_hr:m('pending','بانتظار الموارد البشرية'),pending_finance:m('pending','بانتظار التأكيد المالي'),completed:m('completed','مكتمل'),
    rejected:m('rejected','مرفوض'),withdrawn:m('cancelled','مسحوب')}),
  // القيد المحاسبي: «قيد» هنا اسم السجل لا أداة الحال، فلا تُكرَّر في شارته. «مرحّل» بعد الاعتماد هو اكتمال القيد.
  journal:Object.freeze({draft:m('draft','مسودة'),pending:m('pending','بانتظار الاعتماد'),approved:m('approved','معتمد بانتظار الترحيل'),posted:m('completed','مرحّل'),rejected:m('rejected','مرفوض')}),
  // عقد الموظف (app/hr-contracts.mjs): «ساري» هي عبارة الوحدة لعقدٍ اعتُمد ويسري، و«منتهٍ» لعقدٍ أدّى مدته.
  // العبارتان تبقيان بجوار الحالة الموحدة، فشارة العقد في أي شاشة تقول الاثنتين ولا تُعيد اختراع إحداهما محليًا.
  contract:Object.freeze({draft:m('draft','مسودة'),pending:m('pending','بانتظار الاعتماد'),active:m('approved','ساري'),
    ended:m('completed','منتهٍ'),rejected:m('rejected','مرفوض')}),
  // طلب الشراء (app/procurement.mjs): الحالات الثماني مقفلة بقيد CHECK في الترحيل 005، وكل واحدة تقابل
  // حالة من الثماني مقابلةً صادقة. «مُرسى» انتظارُ اعتماد الأمر الداخلي، فهي pending لا in_progress.
  purchase:Object.freeze({draft:m('draft','مسودة'),sourcing:m('in_progress','جمع العروض'),awarded:m('pending','بانتظار اعتماد الأمر الداخلي'),
    // «وصل بعضه»/«وصل كله» لا «مستلَم جزئيًا»/«مستلَم بالكامل»: عبارتا الاستلام تعيشان في هذا الملف وحده، فاللهجة تنزل
    // عليهما بلا أن تفترق عن شاشة تملكها جولة أخرى — وهو الشرط الذي منع بقية عبارات الوحدات من التحوّل هنا.
    ordered:m('in_progress','صدر أمر داخلي'),part_received:m('in_progress','وصل بعضه'),received:m('completed','وصل كله'),
    rejected:m('rejected','مرفوض'),cancelled:m('cancelled','ملغى')}),
  // ملف المورد (app/vendors.mjs). ثلاث حالات لا تُقابَل عمدًا — «موقوف» و«بحاجة لإعادة تأهيل» و«مدموج في ملف
  // آخر» — لأن أيًّا من الثماني لا يقولها بصدق، والقاعدة في هذا الملف أن الحالة التي لا تعرفها الخريطة تعود
  // كما هي ولا تُلبَّس حالة أخرى. عباراتها تعيش في قائمة الحالات المُدارة (vendors.vendor_status).
  vendor:Object.freeze({draft:m('draft','مسودة تسجيل'),in_review:m('pending','قيد التأهيل'),approved:m('approved','معتمد'),
    conditional:m('approved','معتمد بشروط'),rejected:m('rejected','مرفوض')}),
  // أمر الدفع (app/payables.mjs): اكتمال الأمر تحويلٌ صار في البنك **وسجّله موظف يدويًا** — المنصة لا تتصل ببنك ولا تحوّل
  // (الترحيل 166، البند 6 في العقد)، فالعبارة تقول من شهد لا أن المنصة دفعت. و«معتمد» ليس دفعًا.
  payment_order:Object.freeze({pending:m('pending','بانتظار الاعتماد'),approved:m('approved','معتمد — لم يُنفذ في البنك بعد'),
    executed:m('completed','انحوّل في البنك — مسجّل يدويًا'),rejected:m('rejected','مرفوض'),cancelled:m('cancelled','ملغى')}),
  // المسير الموازي (app/payroll-parallel.mjs، الترحيل 176): الشهر المعلن جارٍ ما دام النظام السابق يدفعه والمنصة تقارن،
  // ودفعة النظام السابق تنتظر شخصًا ثانيًا يؤكدها، والانتقال يكتمل بتأكيد معتمد ثانٍ.
  parallel_month:Object.freeze({declared:m('in_progress','شهر موازٍ — النظام السابق يدفعه'),withdrawn:m('cancelled','مسحوب')}),
  legacy_batch:Object.freeze({imported:m('pending','تنتظر تأكيد شخص ثاني'),confirmed:m('approved','مؤكدة'),rejected:m('rejected','مرفوضة'),withdrawn:m('cancelled','مسحوبة')}),
  cutover:Object.freeze({proposed:m('pending','ينتظر تأكيد معتمد ثاني'),confirmed:m('completed','المنصة تدفع'),rejected:m('rejected','مرفوض')})
});

// حالة وحدة ← {status: إحدى الثماني، name: عبارتها الموحدة، module_phrase: عبارة الوحدة}. حالة لا تعرفها الخريطة تعود كما هي
// بلا عبارة وحدة، فيراها من يقرأ الشاشة ولا تُلبَّس حالة أخرى.
export function canonicalStatus(module,moduleStatus,lang='ar'){
  const entry=Object.hasOwn(MODULE_STATUS_MAP,module)&&Object.hasOwn(MODULE_STATUS_MAP[module],moduleStatus)?MODULE_STATUS_MAP[module][moduleStatus]:null;
  const status=entry?entry.status:moduleStatus;
  return {status,name:statusName(status,lang),module_phrase:entry?entry.phrase:null};
}

// ── مراحل الطالب السبع (مركز الخدمات، الدفعة الثالثة) ─────────────────────────────────────────────
// طبقةُ عرضٍ ثالثة فوق الطبقتين القائمتين (حالات الوحدات ← الثماني ← هذه السبع)، لا خريطةٌ رابعة محلية: ما يقرؤه
// صاحب الطلب حين يسأل «أين طلبي؟» بكلمة واحدة، ويُجمَّع به في «طلباتي» ويُرسم به خطّ المحطّات. الحالات الثماني تبقى
// كما هي على الشارة (ui.statusBadge): المرحلة طبقة ثانية فوقها لا بديلٌ عنها.
// قراران للمالك حُسما هنا بالافتراض المكتوب حتى يقول غيره:
//   (أ) `draft` لا بيت لها في السبع، فتبتلعها «ينتظر ردك» مع `returned` — وهو ما تفعله «طلباتي» منذ بُنيت.
//   (ب) «ملغى» كلمةٌ واحدة، والمنقضي لعدم الرد يُقال بجوارها عبارةَ وحدةٍ (LAPSED_PHRASE) لا حالةً ثامنة: الفرق يهمّ
//       صاحب الطلب فيُقال، والحالة لا تتضاعف. و«قيد الموافقة» لا تُستعمل: القاموس يرفض «قيد» لحالة الانتظار.
// «قُدّم» مرحلةٌ سابعة لا تُطابق حالةً بعينها: هي أول محطّة في خطّ السير، وتُعبَر لحظة التقديم.
export const REQUESTER_STAGES=Object.freeze({
  submitted:Object.freeze(['قُدّم','Submitted']),
  awaiting:REQUEST_STATUS.pending,
  needs_you:Object.freeze(['ينتظر ردك','Waiting for you']),
  executing:REQUEST_STATUS.in_progress,
  completed:REQUEST_STATUS.completed,
  rejected:REQUEST_STATUS.rejected,
  cancelled:REQUEST_STATUS.cancelled
});
export const LAPSED_PHRASE='انقضى لعدم الرد';
// الحالات الثماني على المراحل: خريطةٌ واحدة تُقرأ من هنا وحده. حالة خارج الثماني تعود مفتاحًا خامًا لا يُخفى.
const STAGE_OF=Object.freeze({draft:'needs_you',returned:'needs_you',pending:'awaiting',approved:'executing',in_progress:'executing',
  completed:'completed',rejected:'rejected',cancelled:'cancelled'});
export function stageOf(status,{lapsed=false,lang='ar'}={}){
  const stage=Object.hasOwn(STAGE_OF,status)?STAGE_OF[status]:String(status??'');
  const pair=Object.hasOwn(REQUESTER_STAGES,stage)?REQUESTER_STAGES[stage]:null;
  return {stage,name:pair?pair[lang==='ar'?0:1]:stage,name_ar:pair?pair[0]:stage,name_en:pair?pair[1]:stage,
    module_phrase:stage==='cancelled'&&lapsed?LAPSED_PHRASE:null};
}
// خطّ السير: خمس محطّات ثابتة يراها صاحب الطلب قبل أن يبدأ الطلب وبعده — وهو الفرق بين «خطّ زمني» و«تتبّع طرد».
// «معتمد» محطّةٌ بكلمة الحالة نفسها (REQUEST_STATUS.approved)؛ والأربع الباقيات مراحل.
export const TIMELINE_STATIONS=Object.freeze(['submitted','awaiting','approved','executing','completed']);
export function stationName(key,lang='ar'){
  const pair=key==='approved'?REQUEST_STATUS.approved:Object.hasOwn(REQUESTER_STAGES,key)?REQUESTER_STAGES[key]:null;
  return pair?pair[lang==='ar'?0:1]:String(key??'');
}

// أدوار الحساب الستة كما يراها صاحبها في الفهرس. أدوار خطوات الاعتماد («اعتماد المدير المباشر»…) مفهوم آخر وتبقى في وحداتها.
export const ROLE_NAMES=Object.freeze({
  employee:Object.freeze(['موظف','Employee']),manager:Object.freeze(['مدير فريق','Team manager']),hr:Object.freeze(['الموارد البشرية','Human resources']),
  it:Object.freeze(['تقنية المعلومات','Information technology']),pm:Object.freeze(['مدير مشروع','Project manager']),admin:Object.freeze(['مسؤول المنصة','Platform administrator'])
});
export const ROLE_NAMES_AR=Object.freeze(Object.fromEntries(Object.entries(ROLE_NAMES).map(([role,pair])=>[role,pair[0]])));
export function roleName(role,lang='ar'){
  const pair=Object.hasOwn(ROLE_NAMES,role)?ROLE_NAMES[role]:null;
  return pair?pair[lang==='ar'?0:1]:String(role??'');
}

// عبارات ممنوعة خارج هذا الملف، تعدّها المسنّنة. كل عبارة هنا صيغة ثانية لحالة لها عبارة معتمدة أعلاه، أو صيغة ملتبسة.
// «قيد الاعتماد» ليست هنا عمدًا: تبقى في النسخ التي تملكها الموجة الأولى حتى تُدمج، وتُعدّ ضمن «خرائط الحالات المحلية» لا ضمن الممنوع.
export const BANNED_STATUS_PHRASES=Object.freeze(['قيد بانتظار الاعتماد','معاد إليك','معتمد بانتظار التنفيذ']);
