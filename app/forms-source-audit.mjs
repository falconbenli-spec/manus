// جرد مصادر النماذج في مجلد Google Drive الذي حدده المالك في 3 أكتوبر 2026.
// لا يحمل بيانات موظفين أو عملاء، ولا يقرأ Drive وقت التشغيل. الروابط مراجع للقوالب فقط.
// المصدر المقروء هو العنوان والكود داخل النموذج؛ اسم الملف أو المجلد لا يحسم الهوية عند تعارضهما.

export const DRIVE_FORMS_AUDIT=Object.freeze({
  audited_on:'2026-10-03',
  root_url:'https://drive.google.com/drive/folders/1goNlHLt5ZLFTdqauSZKKcjTzQ_4kj9yx',
  unified_index:{
    id:'1ZgyWtFzawO_o7HEkBVLOtjTjIUzfmQHu',
    name:'نماذج_آلية_العمل_المالية.xlsx',
    url:'https://drive.google.com/file/d/1ZgyWtFzawO_o7HEkBVLOtjTjIUzfmQHu/view',
    modified_at:'2026-09-07T08:50:33.000Z',
    records:41,
    note:'فهرس موحد من 41 نموذجًا ومستندًا؛ ليس 41 خدمة مستقلة.'
  },
  coverage:{
    source_register:65,
    wave1:24,
    wave1_built:24,
    wave1_readable_sources:23,
    wave1_missing_source:1,
    generic_catalogue:32,
    specialised_documents:18,
    later_models_not_built:39,
    later_models_with_readable_source:10,
    later_models_waiting_for_source:29
  },
  canonical_sources:[
    ['BD-01','FORM-BD-QUALIFY','1iYJRF4vLEC3hXIgGhSk5TyDk5qGvZQJr','MOD-BD-01_تأهيل_العميل_المحتمل.docx'],
    ['BD-04','FORM-BD-HANDOVER','11Aqyxe6XcaYrPc7seR2LRPpngsTXfIZa','MOD-BD-04_محضر_تسليم_المشروع.docx'],
    ['PM-01','FORM-PM-RECEIPT','11uv7TS5tNEL0K9DIbDzl2KdDp4kfnghs','MOD-PM-01_محضر_استلام_المشروع.docx'],
    ['PM-02','FORM-PM-KICKOFF','1jDIy12v27PlBTUNpujGPtuLMmBDWpLmp','MOD-PM-02_محضر_Kickoff_مع_العميل.docx'],
    // اسم الملف يقول «التقرير الأسبوعي»، لكن العنوان والمتن المقروءان يقولان MOD-PM-03 طلب التعديل.
    ['PM-03','FORM-PM-CHANGE','1cBr9E50I7ZOMEbBprNJ6gJDBV1dXt70Z','MOD-PM-03_التقرير_الأسبوعي.docx'],
    ['CR-01','FORM-CR-BRIEF','1qMJXVIGQsjJMhuNJZCuGOgHd1Ll5y39X','MOD-CR-01_Creative_Brief.docx'],
    ['CR-02','FORM-CR-CONCEPT','1BWZr35la4_ggaz_eW8bG1VZibnvZDh3Q','MOD-CR-02_موافقة_الفكرة.docx'],
    ['PROD-01','FORM-PROD-BRIEF','1qiq22OWgrsdakaasVBxoyd2fXudpl1YC','MOD-VD-01_Production_Brief.docx'],
    ['PROD-02','FORM-PROD-SCRIPT','1wc93jf98iFiziIZoqQHQGxQZ5DRNtr-M','MOD-VD-02_اعتماد_السكريبت.docx'],
    ['AD-01','FORM-AD-REQUEST','1E96COrYZCdgC0a07JpkJo4SkKgvlA6SW','MOD-AD-01_طلب_الحملة_v2.docx'],
    ['AD-02','FORM-AD-MEDIAPLAN','1wQ3xnlgx4tyjvWMNLpS-kACccMAY3H0V','MOD-AD-02_Media_Plan.docx'],
    ['AD-03','FORM-AD-SETUP','1hnSkL1crKgC83UhR2EskZiKfc_8GxlV-','MOD-AD-03_Setup_Checklist.docx'],
    ['DS-01','FORM-DS-BRIEF','10EB4V8rBo7ZL8duF_OATDQDHekWGT7_I','MOD-DS-01_Design_Brief.docx'],
    ['DS-02','FORM-DS-QA','16Iu3so2HaX43srxO6c4lgYAAruxizge8','MOD-DS-02_QA_Checklist.docx'],
    ['DS-03','FORM-DS-REVISIONS','1vLcHbTt5jz9mPrv3-Oz5kQZ5MLx-3WxM','MOD-DS-03_سجل_التعديلات.docx'],
    // اسم الملف والمجلد مضللان؛ المتن المقروء يحمل MOD-PR-01 وحقول حملة المؤثرين.
    ['PR-01','FORM-PR-CAMPAIGN','1mU39r1Xww0edNiBP9wMsSsOmPO--YirS','MOD-AD-01_Campaign_Request.docx'],
    ['PR-02','FORM-PR-INFLUENCERS','1ngmFGEOj30-YBfIQlU_8_Ddkb55MS5Rd','MOD-PR-02_اعتماد_المؤثرين.docx'],
    ['PR-03','FORM-PR-CONTRACT','1-8nkDge8cQGuuNO1b6z-kVmln7GRAeSu','MOD-PR-03_عقد_المؤثر.docx'],
    ['PR-04','FORM-PR-BRIEFING','1enkqbqf7nVJibJroezDAEe-sKxDTL4EJ','MOD-PR-04_Briefing_Document.docx'],
    ['PR-05','FORM-PR-RELEASE','1QKXXDt67otwLlZV2w7jFyVVWzgdoTGj7','MOD-PR-05_البيان_الصحفي.docx'],
    ['PR-06','FORM-PR-PERFORMANCE',null,null],
    ['PR-08','FORM-PR-BUDGET','1TNd18MJHWZeZG4wLGsNcxepBtNnbRPbo','MOD-PR-08_اعتماد_الميزانية.docx'],
    ['CW-01','FORM-CW-BRIEF','1814RuCZesyTSOK6cAHAYbGJRa1y_eyYf','MOD-CW-01_نموذج_طلب_المحتوى.docx'],
    // الملف في مجلد الإنتاج واسمه VD-02؛ المتن المقروء يحمل MOD-CW-02 ودليل أسلوب العميل.
    ['CW-02','FORM-CW-STYLE','19Th7ZPMHa4kP1cPV7jOUgMxbkKgFGK26','MOD-VD-02_Style_Guide.docx']
  ].map(([code,form_key,id,file])=>Object.freeze({code,form_key,id,file,
    status:id?'readable':'missing_source',url:id?`https://drive.google.com/file/d/${id}/view`:null})),
  blockers:[
    {code:'MOD-PR-07',name:'خطة إدارة الأزمة الإعلامية',kind:'required_missing_source',
      effect:'مطلوب في سجل النماذج، ولا يوجد له ملف مصدر أو تعريف قابل للاعتماد؛ لا يجوز اختراع حقوله.'},
    {code:'PR-06',name:'تقرير أداء العلاقات العامة',kind:'built_waiting_source',
      effect:'التعريف موجود كمسودة، لكن لا ملف مصدر له في المجلد؛ لا يصبح تعريفًا مقبولًا قبل اعتماد مالكه.'},
    {code:'F-03/F-04',name:'طلب عرض السعر والتحقق المالي',kind:'specialised_partial',
      effect:'المشتريات والتسعير والمطابقة موجودة كوحدات متخصصة، لكن النموذج المقروء الجديد لم يتحول إلى سجل RFQ مستقل بحقول F-03 وF-04.'},
    {code:'TECH-PROPOSAL-QA',name:'قائمة تحقق مراجعة العروض الفنية',kind:'not_integrated',
      effect:'المصدر كامل ومقروء، لكنه ليس نموذجًا إلكترونيًا مرتبطًا بعرض ومراجع وإقفال ملاحظات داخل المنصة.'}
  ],
  hygiene:[
    {kind:'archive_versions',count:6,item:'ملفات SLA',action:'اختيار نسخة حاكمة واحدة بعد اعتماد المالك؛ نسخة «بعد تعديل المشتريات» تختلف فعليًا في صفوف المشتريات.'},
    {kind:'temporary_files',count:3,item:'ملفات Excel تبدأ بـ ~$ في مجلد KPIs',action:'لا تُستورد ولا تُعرض؛ ملفات قفل مؤقتة وليست مصادر.'},
    {kind:'language_variants',count:12,item:'نسخ عربية وإنجليزية للنموذج نفسه',action:'تعريف إلكتروني واحد متعدد اللغة، لا خدمتان.'},
    {kind:'historical_reports',count:null,item:'تقارير أسبوعية ونسخ داخل مجلد duplictaed',action:'أدلة تاريخية لا قوالب خدمات؛ تحفظ في الأرشيف ولا تدخل كخدمات.'},
    {kind:'visual_references',count:9,item:'صور شاشة لحزم MOD',action:'مراجع شكلية فقط؛ لا تُعامل كنماذج مستقلة.'}
  ],
  report_file:'docs/product/workflow/DRIVE-FORMS-READINESS-20261003.md'
});

export function driveFormsSummary(){
  const a=DRIVE_FORMS_AUDIT,c=a.coverage;
  return {
    audited_on:a.audited_on,root_url:a.root_url,unified_index:a.unified_index,coverage:{...c},
    blockers:a.blockers.map(x=>({...x})),hygiene:a.hygiene.map(x=>({...x})),report_file:a.report_file
  };
}
