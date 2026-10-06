# وثائق خارطة التطوير، منقولة من جلسة السحابة

هذه الوثائق كتبتها جلسة السحابة «منظومة الوكلاء المتخصصة»، ونُقلت إلى مستودع المنصة بطلب تركي الخضر (2535)، مسؤول تشغيل المنصة.

## الأصل

| البند | القيمة |
|---|---|
| المصدر | حزمة git باسم `g-agents-system-setup.bundle` سلّمها تركي |
| بصمة الحزمة SHA-256 | `1531f58de065c1543da5da6f8bf696d0f0661928823d9af29832396e02654ec4` |
| الفرع | `claude/agents-system-setup-r8oe6a` |
| الالتزام | `bc48da8ccf76acc9035d4820efafa7e569d52c80`، بتاريخ 2026-09-25 14:17 UTC |
| فحص الحزمة | `git bundle verify`: «The bundle records a complete history» |
| تاريخ النقل | 2026-09-25 |
| طريقة النقل | نسخ كما هو بالبايت، وتحقق كل ملف بـ`cmp`. لم يُعدَّل حرف |

مستودع السحابة الأصلي `turki-stack/g` خرج من المتناول نهائيًا بإغلاق حساب GitHub المالك، كما في `DECISIONS_FROM_CLOUD.md`. فالحزمة هي النسخة المرجعية الوحيدة. ونسختها الكاملة للقراءة فقط في `~/3-6T-archive/g` على جهاز المالك، خارج هذا المستودع. ولا يُدمج منها كود في المنصة.

## مواضع الملفات

المسارات داخل الوثائق تشير إلى تخطيط مستودع السحابة. هذا الجدول يترجمها:

| في مستودع السحابة | هنا |
|---|---|
| `docs/platform/roadmap/DEVELOPMENT_ROADMAP.md` | `DEVELOPMENT_ROADMAP.md`، وهي الخطة المعتمدة بالترتيب الصارم |
| `docs/platform/roadmap/TECH_ROADMAP.md` | `TECH_ROADMAP.md` |
| `docs/platform/roadmap/PRODUCT_ROADMAP.md` | `PRODUCT_ROADMAP.md` |
| `docs/platform/roadmap/SECURITY_PRIORITIES.md` | `SECURITY_PRIORITIES.md` |
| `docs/platform/roadmap/CRITIQUE.md` | `CRITIQUE.md` |
| `docs/platform/roadmap/INSTRUCTIONS_M0_M2.md` | `INSTRUCTIONS_M0_M2.md` |
| `docs/platform/roadmap/INSTRUCTIONS_ADDENDUM_SHAPE.md` | `INSTRUCTIONS_ADDENDUM_SHAPE.md` |
| `docs/platform/roadmap/INSTRUCTIONS_RESEND_20260925.md` | `INSTRUCTIONS_RESEND_20260925.md`، وفيه التعليمات كاملة مجمّعة |
| `docs/platform/business/ACCOUNTANT_QUESTIONS.md` | `business/ACCOUNTANT_QUESTIONS.md` |
| `docs/platform/business/OWNERS_FORM.md` | `business/OWNERS_FORM.md` |
| `docs/platform/business/PDPL_DRAFT_PACK.md` | `business/PDPL_DRAFT_PACK.md` |
| `docs/platform/ALIGNMENT_PLAN.md` | `ALIGNMENT_PLAN.md` |
| `docs/agents/DECISIONS.md` | `DECISIONS_FROM_CLOUD.md` |

## كيف تُقرأ

- **وثائق مرجعية.** سجل قرارات المنصة المعتمد هو `docs/decisions.md`. و`DECISIONS_FROM_CLOUD.md` سجل الجلسة السحابية كما هو.
- **مراجع `ملف:سطر`** فيها من جرد 24 سبتمبر، والمنصة تغيّرت بعده. يُتحقق من كل مرجع قبل العمل به.
- **إن تعارض شيء فيها مع ما نُفّذ في المنصة،** يُعرض التعارض على تركي ولا يُحسم بالوثيقة.
- **لم يُنقل:** منظومة الوكلاء والمهارات، وبقية ملفات `docs/platform/` في مستودع السحابة.
