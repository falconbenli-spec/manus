# واجهة HTTP المحلية

كل المسارات عدا ملفات الواجهة المحددة وPOST /api/login تتطلب Cookie جلسة HttpOnly/SameSite=Strict. كل تغيير يتطلب x-csrf-token؛ JSON فقط، وحد أقصى لحجم المحتوى. لا CORS. تُفحص Host وOrigin. Cookie غير Secure على HTTP المحلي فقط؛ الإنتاج معطل.

| الطريقة والمسار | الوظيفة |
| --- | --- |
| POST /api/login، POST /api/logout، GET /api/me | بدء الجلسة وإنهاؤها وقراءة الهوية |
| GET /api/catalog، POST /api/catalog | دليل الخدمات وإضافة نسخة لمسؤول المنصة |
| GET /api/requests?q=&status=، POST /api/requests | بحث مأذون وإنشاء مسودة |
| GET /api/requests/:id، PATCH /api/requests/:id | تفاصيل أو تعديل مسودة/معاد |
| POST /api/requests/:id/submit | تقديم نسخة ثابتة |
| POST /api/requests/:id/approve أو return أو reject | قرار من صاحب الخطوة الحالية |
| POST /api/requests/:id/cancel أو claim أو complete | إلغاء أو استلام أو إكمال بحسب الحالة والدور |
| POST /api/requests/:id/attachments | رفع JSON باسم ومحتوى base64 إلى مسودة مأذونة |
| GET /api/attachments/:id | تنزيل بعد تحقق صلاحية الطلب، كملف تنزيل مع CSP sandbox |
| GET/POST /api/projects | مشاريع العضوية وإنشاء مشروع للفريق المباشر |
| POST /api/projects/:id/tasks | إسناد مهمة بعضوية صحيحة |
| POST /api/tasks/:id/complete | إكمال من المكلف مع version وevidence |
| GET /api/notifications، POST /api/notifications/:id/read | إشعارات مأذونة دون نصوص محتوى حساسة |
| GET /api/team، GET /api/departments | فريق مباشر وإدارات الكيان |
| GET /api/requirements | رموز وقبول وحالات سجل النطاق المربوط بالكيان |
| GET /api/integrations | حالة عدم الاتصال وعدد الأحداث المحجوبة للأدوار المخولة |

طلبات التعديل والانتقال والرفع تتضمن version الحالية. القرارات والإكمال تتضمن note؛ الإعادة والرفض والإكمال تحتاج سببًا من ثلاثة أحرف على الأقل. لا يقبل الخادم requester_id أو tenant_id أو approver_id أو status من العميل.

الإنشاء يتطلب Idempotency-Key بطول 16–100 من الحروف والأرقام وشرطة أو شرطة سفلية. تحتفظ الواجهة بالمفتاح لإعادة المحاولة دون تغيير المحتوى. الرد يعيد الحالة الحالية للسجل بعد إعادة التحقق من الوصول؛ لا يحفظ استجابة قديمة تتجاوز التفويض.

الأخطاء: 400 للمدخل، 401 للجلسة، 403 للفعل الممنوع، 404 للسجل الغائب أو غير المتاح، 409 للنسخة القديمة أو التعارض، 413 للحجم، 415 لنوع المحتوى، 429 لمحاولات الدخول. لا تعاد التفاصيل الداخلية للخطأ.

## حزم العمليات

| الطريقة والمسار | الوظيفة |
| --- | --- |
| GET /api/overview | تجميع القرارات ومهام التهيئة وفق الوصول الحالي |
| GET/POST /api/delegations، POST /api/delegations/:id/revoke | تفويض الخدمة المؤقت وإلغاؤه |
| GET/POST /api/commercial، POST /api/commercial/:id/:action | عميل وتأهيل وعرض واتفاق ومشروع وتسليم وتغيير |
| GET/POST /api/procurement، POST /api/procurement/:id/:action | طلب شراء وعروض وترسية وأمر واستلام ومطابقة |
| GET /api/leave، POST /api/leave/openings، POST /api/leave/requests | الأرصدة وافتتاحها وطلبات الإجازة |
| POST /api/leave/requests/:id/:action | قرار الإجازة وإعادتها وإلغاؤها وإعادة تقديمها |
| GET /api/people، POST /api/people/requisitions | نطاق التوظيف والاحتياج |
| POST /api/people/:id/:action، POST /api/people/tasks/:id/complete | مرشح وتقييم ومقترح وتهيئة |
| GET/POST /api/studio، POST /api/studio/:id/:action | موجز وأصول ومخرجات ومراجعة وبيان تسليم |
| GET /api/finance | المراجع والقيود والأستاذ وميزان المراجعة والمستحقات المخولة |
| POST /api/finance/accounts أو cost_centers أو periods | إنشاء مرجع مالي بتصريح صريح |
| POST /api/finance/:kind/:id/:action | تفعيل أو تعطيل الحساب أو المركز، وإغلاق الفترة |
| POST /api/finance/journals، POST /api/finance/from-payable | قيد يدوي أو مستند إلى مستحق مطابق |
| POST /api/finance/journals/:id/:action | edit، submit، return، approve، reject، post، reverse |

كل كتابة داخل معاملة واحدة وبهوية أعيد التحقق منها بعد استقبال الجسم. الإنشاءات الأساسية تستخدم Idempotency-Key؛ الانتقالات تستخدم version. حقول كل فعل وحدوده في وحدته app/ ووثيقة الحزمة المطابقة؛ لا تقبل الحقول الزائدة أو حالة من العميل. الإضافة المالية تحتاج تصريحًا صريحًا، ولا يمنحه دور admin أو تفويض طلب داخلي.

المبالغ والكمية التجارية ترسل كنص عشري عند طلب الوحدة ذلك، دون تقريب عائم. القيد المالي عملته SAR؛ تقاريره لجميع الفترات المرحلة محليًا. لا تمثل هذه المسارات خدمات دفع أو إصدار فواتير رسمية.
