/**
 * Engagement - اندماج الموظفين
 * Brand: Teal #1FA98C, Charcoal #363636
 * Internal Communication Budget 2026 — ميزانية التواصل الداخلي V10-2
 * Sheet 1: 2026 Bgt  → 44 events
 * Sheet 2: مبادارات 2026 → 24 initiatives
 */
import { useState, useMemo, useEffect } from "react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, PieChart, Pie, Cell,
} from "recharts";
import {
  Calendar, DollarSign, Star, Tag, Search, X,
  ChevronDown, ChevronUp, Heart, Plus, User, Zap, FileText,
  Clock, MapPin, CheckCircle2, Lightbulb, Target, Trophy, Rocket,
} from "lucide-react";
import { toast } from "sonner";
import { exportEngagement } from "@/lib/excelExport";
import { Download } from "lucide-react";
import { EngagementHubContent } from "./EngagementHub";
import { SurveysContent } from "./Surveys";
const peoplePrimary = "hsl(var(--primary))";

// ─── Types ─────────────────────────────────────────────────────────────────────
interface Event {
  name: string;
  category: string;
  day: string;
  date: string;
  month: string;
  budget: number | null;
  description: string;
  activation: string;
  responsible: string;
  location: string;
  status: "مجدولة" | "جارية" | "منتهية";
}

interface Initiative {
  name: string;
  day: string;
  date: string;
  month: string;
  monthLabel: string;
  type: string;
  description: string;
  announcementContent?: string;
  awarenessContent?: string;
  simpleDescription?: string;
}

// ─── Events Data (from Excel Sheet 1: 2026 Bgt — 44 events) ──────────────────
const EVENTS_RAW: Event[] = [
  // يناير
  { name: "يوم الصحة العالمي", category: "C", day: "الخميس", date: "1 يناير 2026", month: "يناير", budget: null, description: "إحياء اليوم العالمي للصحة بتوعية الموظفين بأهمية الصحة الجسدية والنفسية.", activation: "نشر محتوى توعوي على قنوات التواصل الداخلي.", responsible: "إدارة رأس المال البشري", location: "عبر الإنترنت", status: "منتهية" },
  { name: "يوم البوب كورن", category: "C", day: "الاثنين", date: "19 يناير 2026", month: "يناير", budget: 800, description: "فعالية ترفيهية خفيفة لتعزيز روح الفريق وكسر الروتين اليومي.", activation: "إعداد محطة بوب كورن في منطقة الاستراحة وتوزيعه على جميع الموظفين.", responsible: "فريق اندماج الموظفين", location: "مكتب الرياض", status: "منتهية" },
  { name: "اليوم الدولي للتعليم", category: "C", day: "السبت", date: "24 يناير 2026", month: "يناير", budget: null, description: "إبراز أهمية التعليم المستمر والتطوير المهني.", activation: "نشر قصص نجاح الموظفين الذين طوروا مهاراتهم.", responsible: "إدارة التدريب والتطوير", location: "عبر الإنترنت", status: "منتهية" },
  // فبراير
  { name: "الغداء الشهري — فبراير", category: "B", day: "الاثنين", date: "5 فبراير 2026", month: "فبراير", budget: 3500, description: "غداء شهري يجمع جميع موظفي الشركة لتعزيز التواصل الاجتماعي.", activation: "حجز قاعة الاجتماعات الكبرى وتوفير وجبة غداء متنوعة.", responsible: "فريق اندماج الموظفين", location: "مقر الشركة", status: "منتهية" },
  { name: "يوم التأسيس السعودي", category: "C", day: "الأحد", date: "22 فبراير 2026", month: "فبراير", budget: 200, description: "الاحتفال بيوم التأسيس السعودي وتعزيز الانتماء الوطني.", activation: "نشر محتوى توعوي عن يوم التأسيس وتوزيع ملصقات وطنية.", responsible: "فريق اندماج الموظفين", location: "مقر الشركة", status: "منتهية" },
  { name: "بداية شهر رمضان المبارك (تقديري)", category: "B", day: "الخميس", date: "19 فبراير 2026", month: "فبراير", budget: 3000, description: "الترحيب بشهر رمضان المبارك وتهنئة الموظفين.", activation: "توزيع هدايا رمضانية وتزيين المكتب بالديكورات الرمضانية.", responsible: "إدارة رأس المال البشري", location: "مقر الشركة", status: "منتهية" },
  // مارس
  { name: "اليوم العالمي للمرأة", category: "B", day: "الأحد", date: "8 مارس 2026", month: "مارس", budget: 8000, description: "تكريم المرأة العاملة في الشركة والاحتفاء بإنجازاتها.", activation: "إقامة حفل تكريمي للموظفات وتوزيع هدايا خاصة.", responsible: "إدارة رأس المال البشري وفريق اندماج الموظفين", location: "قاعة الفعاليات", status: "منتهية" },
  { name: "يوم العلم السعودي", category: "C", day: "الأربعاء", date: "11 مارس 2026", month: "مارس", budget: 500, description: "إحياء يوم العلم السعودي وتعزيز الفخر الوطني.", activation: "نشر محتوى توعوي عن يوم العلم وتوزيع ملصقات وطنية.", responsible: "فريق اندماج الموظفين", location: "مقر الشركة", status: "منتهية" },
  // أبريل
  { name: "يوم الأرض", category: "C", day: "الخميس", date: "23 أبريل 2026", month: "أبريل", budget: null, description: "تعزيز الوعي البيئي بين الموظفين.", activation: "نشر محتوى بيئي توعوي.", responsible: "فريق الاستدامة", location: "عبر الإنترنت", status: "مجدولة" },
  { name: "الغداء الشهري — أبريل", category: "B", day: "الجمعة", date: "24 أبريل 2026", month: "أبريل", budget: 3500, description: "الغداء الشهري لشهر أبريل.", activation: "حجز قاعة الاجتماعات وتوفير وجبة غداء متنوعة.", responsible: "فريق اندماج الموظفين", location: "مقر الشركة", status: "مجدولة" },
  // مايو
  { name: "يوم العمال العالمي", category: "C", day: "الجمعة", date: "1 مايو 2026", month: "مايو", budget: null, description: "تكريم جهود الموظفين والاحتفاء بيوم العمال العالمي.", activation: "نشر رسالة تقدير من الإدارة العليا.", responsible: "الإدارة التنفيذية", location: "عبر الإنترنت", status: "مجدولة" },
  { name: "يوم الأسرة الدولي", category: "C", day: "الجمعة", date: "15 مايو 2026", month: "مايو", budget: null, description: "إبراز أهمية التوازن بين العمل والحياة الأسرية.", activation: "نشر محتوى عن أهمية الأسرة.", responsible: "إدارة رأس المال البشري", location: "عبر الإنترنت", status: "مجدولة" },
  { name: "الغداء الشهري — مايو", category: "B", day: "الاثنين", date: "25 مايو 2026", month: "مايو", budget: 3500, description: "الغداء الشهري لشهر مايو.", activation: "حجز قاعة الاجتماعات وتوفير وجبة غداء متنوعة.", responsible: "فريق اندماج الموظفين", location: "مقر الشركة", status: "مجدولة" },
  // يونيو
  { name: "يوم البيئة العالمي", category: "C", day: "السبت", date: "5 يونيو 2026", month: "يونيو", budget: null, description: "رفع الوعي البيئي وتشجيع الموظفين على الحفاظ على البيئة.", activation: "تنظيم حملة بيئية داخلية.", responsible: "فريق الاستدامة", location: "عبر الإنترنت", status: "مجدولة" },
  { name: "يوم الأب العالمي", category: "C", day: "الأحد", date: "21 يونيو 2026", month: "يونيو", budget: null, description: "تكريم الآباء العاملين في الشركة.", activation: "نشر رسائل تقدير للآباء الموظفين.", responsible: "إدارة رأس المال البشري", location: "عبر الإنترنت", status: "مجدولة" },
  { name: "الغداء الشهري — يونيو", category: "B", day: "الاثنين", date: "29 يونيو 2026", month: "يونيو", budget: 3500, description: "الغداء الشهري لشهر يونيو.", activation: "حجز قاعة الاجتماعات وتوفير وجبة غداء متنوعة.", responsible: "فريق اندماج الموظفين", location: "مقر الشركة", status: "مجدولة" },
  // يوليو
  { name: "يوم الصداقة العالمي", category: "C", day: "الأحد", date: "30 يوليو 2026", month: "يوليو", budget: null, description: "تعزيز روح الصداقة والزمالة بين الموظفين.", activation: "تنظيم نشاط ترفيهي جماعي.", responsible: "فريق اندماج الموظفين", location: "مقر الشركة", status: "مجدولة" },
  // أغسطس
  { name: "الغداء الشهري — أغسطس + يوم الشباب", category: "B", day: "الأربعاء", date: "12 أغسطس 2026", month: "أغسطس", budget: 3500, description: "الغداء الشهري مع الاحتفاء بيوم الشباب العالمي.", activation: "حجز قاعة الاجتماعات وتوفير وجبة غداء متنوعة مع برنامج خاص.", responsible: "فريق اندماج الموظفين", location: "مقر الشركة", status: "مجدولة" },
  { name: "اليوم العالمي للعمل الإنساني", category: "C", day: "الأربعاء", date: "19 أغسطس 2026", month: "أغسطس", budget: 300, description: "تعزيز قيم التطوع والعمل الإنساني.", activation: "نشر محتوى توعوي عن العمل الإنساني.", responsible: "فريق المسؤولية الاجتماعية", location: "عبر الإنترنت", status: "مجدولة" },
  { name: "اليوم العالمي للتصوير", category: "C", day: "الأربعاء", date: "19 أغسطس 2026", month: "أغسطس", budget: 300, description: "تشجيع الموظفين على التعبير الإبداعي من خلال التصوير.", activation: "مسابقة تصوير داخلية.", responsible: "فريق اندماج الموظفين", location: "مقر الشركة", status: "مجدولة" },
  // سبتمبر
  { name: "اليوم الوطني السعودي", category: "A", day: "الأربعاء", date: "23 سبتمبر 2026", month: "سبتمبر", budget: 45900, description: "الاحتفال الكبير باليوم الوطني السعودي بإقامة فعاليات وطنية ضخمة.", activation: "تنظيم حفل احتفالي كبير بالزي الوطني وعروض فنية وتوزيع هدايا وطنية.", responsible: "الإدارة التنفيذية وفريق اندماج الموظفين", location: "قاعة الفعاليات الكبرى", status: "مجدولة" },
  { name: "الغداء الشهري — سبتمبر", category: "B", day: "الأحد", date: "27 سبتمبر 2026", month: "سبتمبر", budget: 3500, description: "الغداء الشهري لشهر سبتمبر.", activation: "حجز قاعة الاجتماعات وتوفير وجبة غداء متنوعة.", responsible: "فريق اندماج الموظفين", location: "مقر الشركة", status: "مجدولة" },
  // أكتوبر
  { name: "شهر التوعية بسرطان الثدي", category: "C", day: "شهر أكتوبر كامل", date: "1 أكتوبر 2026", month: "أكتوبر", budget: 0, description: "حملة توعوية طوال شهر أكتوبر.", activation: "نشر محتوى توعوي يومي.", responsible: "فريق الصحة والسلامة", location: "عبر الإنترنت", status: "مجدولة" },
  { name: "يوم القهوة العالمي + القهوة السعودية", category: "C", day: "الخميس", date: "1 أكتوبر 2026", month: "أكتوبر", budget: 500, description: "الاحتفاء بيوم القهوة العالمي والقهوة السعودية.", activation: "إعداد محطة قهوة سعودية وعالمية.", responsible: "فريق اندماج الموظفين", location: "مقر الشركة", status: "مجدولة" },
  { name: "اليوم العالمي للصحة النفسية + الغداء الشهري", category: "C", day: "السبت", date: "10 أكتوبر 2026", month: "أكتوبر", budget: 2000, description: "التوعية بأهمية الصحة النفسية مع الغداء الشهري.", activation: "ورشة عمل عن الصحة النفسية مع وجبة غداء.", responsible: "فريق اندماج الموظفين", location: "مقر الشركة", status: "مجدولة" },
  { name: "يوم البيض", category: "C", day: "الأربعاء", date: "14 أكتوبر 2026", month: "أكتوبر", budget: 100, description: "فعالية ترفيهية خفيفة.", activation: "توزيع البيض المسلوق.", responsible: "فريق اندماج الموظفين", location: "مقر الشركة", status: "مجدولة" },
  { name: "اليوم العالمي للغذاء + الغداء الشهري", category: "C", day: "الجمعة", date: "16 أكتوبر 2026", month: "أكتوبر", budget: 500, description: "التوعية بأهمية الغذاء مع الغداء الشهري.", activation: "نشر نصائح غذائية مع وجبة غداء.", responsible: "فريق اندماج الموظفين", location: "مقر الشركة", status: "مجدولة" },
  { name: "يوم المدير العالمي", category: "C", day: "الجمعة", date: "16 أكتوبر 2026", month: "أكتوبر", budget: 400, description: "تكريم المدراء والقيادات.", activation: "نشر رسائل تقدير للمدراء.", responsible: "إدارة رأس المال البشري", location: "عبر الإنترنت", status: "مجدولة" },
  // نوفمبر
  { name: "شهر التوعية بسرطان البروستات (شهر الرجل)", category: "C", day: "شهر نوفمبر كامل", date: "1 نوفمبر 2026", month: "نوفمبر", budget: 100, description: "حملة توعوية طوال شهر نوفمبر.", activation: "نشر محتوى توعوي يومي.", responsible: "فريق الصحة والسلامة", location: "عبر الإنترنت", status: "مجدولة" },
  { name: "اليوم العالمي للرجل", category: "B", day: "الخميس", date: "19 نوفمبر 2026", month: "نوفمبر", budget: 5000, description: "الاحتفاء بيوم الرجل العالمي وتكريم الموظفين.", activation: "إقامة حفل تكريمي للموظفين الرجال.", responsible: "إدارة رأس المال البشري", location: "قاعة الفعاليات", status: "مجدولة" },
  { name: "اليوم العالمي للطفل + الغداء الشهري", category: "B", day: "الجمعة", date: "20 نوفمبر 2026", month: "نوفمبر", budget: 15000, description: "الاحتفاء بيوم الطفل العالمي مع الغداء الشهري.", activation: "فعالية عائلية مع وجبة غداء.", responsible: "فريق اندماج الموظفين", location: "مقر الشركة", status: "مجدولة" },
  { name: "يوم الأكل مع الأصدقاء", category: "C", day: "الأربعاء", date: "25 نوفمبر 2026", month: "نوفمبر", budget: 0, description: "تعزيز روح الصداقة والزمالة.", activation: "تشجيع الموظفين على تناول الغداء مع زملائهم.", responsible: "فريق اندماج الموظفين", location: "مقر الشركة", status: "مجدولة" },
  // ديسمبر
  { name: "اليوم العالمي لذوي الإعاقة", category: "C", day: "الخميس", date: "3 ديسمبر 2026", month: "ديسمبر", budget: 0, description: "تعزيز الوعي بحقوق ذوي الإعاقة وإبراز دورهم.", activation: "نشر محتوى توعوي.", responsible: "إدارة رأس المال البشري", location: "عبر الإنترنت", status: "مجدولة" },
  { name: "يوم الكوكيز", category: "C", day: "الجمعة", date: "4 ديسمبر 2026", month: "ديسمبر", budget: 0, description: "فعالية ترفيهية خفيفة.", activation: "توزيع الكوكيز.", responsible: "فريق اندماج الموظفين", location: "مقر الشركة", status: "مجدولة" },
  { name: "اليوم العالمي للتطوع", category: "C", day: "السبت", date: "5 ديسمبر 2026", month: "ديسمبر", budget: 0, description: "تشجيع الموظفين على التطوع.", activation: "تنظيم يوم تطوعي.", responsible: "فريق المسؤولية الاجتماعية", location: "خارج المكتب", status: "مجدولة" },
  { name: "اليوم العالمي لحقوق الإنسان", category: "C", day: "الخميس", date: "10 ديسمبر 2026", month: "ديسمبر", budget: 0, description: "تعزيز الوعي بحقوق الإنسان.", activation: "نشر محتوى توعوي.", responsible: "إدارة رأس المال البشري", location: "عبر الإنترنت", status: "مجدولة" },
  { name: "يوم النودلز + الغداء الشهري", category: "B", day: "الجمعة", date: "11 ديسمبر 2026", month: "ديسمبر", budget: 3000, description: "الغداء الشهري مع الاحتفاء بيوم النودلز.", activation: "وجبة نودلز مع الغداء الشهري.", responsible: "فريق اندماج الموظفين", location: "مقر الشركة", status: "مجدولة" },
  { name: "يوم الكب كيك العالمي", category: "C", day: "الثلاثاء", date: "15 ديسمبر 2026", month: "ديسمبر", budget: 500, description: "توزيع الكب كيك على الموظفين.", activation: "توزيع كب كيك مخصص بألوان الشركة.", responsible: "فريق اندماج الموظفين", location: "مقر الشركة", status: "مجدولة" },
  { name: "اليوم العالمي للغة العربية", category: "C", day: "الجمعة", date: "18 ديسمبر 2026", month: "ديسمبر", budget: 0, description: "الاحتفاء باللغة العربية.", activation: "نشر محتوى عن اللغة العربية.", responsible: "فريق اندماج الموظفين", location: "عبر الإنترنت", status: "مجدولة" },
];

// ─── Initiatives Data (from Excel Sheet 2: مبادارات 2026 — 24 initiatives) ───
const INITIATIVES_RAW: Initiative[] = [
  // يناير — JAN شهر التوعية
  { name: "شكر وإعلان وصيغة تشويقية عن مرحلة جديدة للشركة (إيميل أبو قصي)", day: "الخميس", date: "1 يناير 2026", month: "يناير", monthLabel: "JAN شهر التوعية", type: "إعلان", description: "إطلاق مرحلة جديدة للشركة برسالة تشويقية وشكر رسمي." },
  { name: "إعلان مبادرة موظف الشهر", day: "الأحد", date: "4 يناير 2026", month: "يناير", monthLabel: "JAN", type: "مبادرة شهرية", description: "إطلاق مبادرة موظف الشهر لتكريم المتميزين." },
  { name: "إعلان مبادرة CEO Cards (مفاجئة)", day: "الخميس", date: "1 أغسطس 2026", month: "أغسطس", monthLabel: "AUG", type: "مبادرة مفاجئة", description: "مبادرة بطاقات تقدير من الرئيس التنفيذي للموظفين المتميزين." },
  { name: "إعلان مبادرة Coffee With CEO (مفاجئة — غير محددة المدة)", day: "الخميس", date: "1 نوفمبر 2026", month: "نوفمبر", monthLabel: "NOV", type: "مبادرة مفاجئة", description: "جلسات قهوة مع الرئيس التنفيذي للموظفين." },
  { name: "إعلان مبادرة One to One (مفاجئة) شهرية — تاريخ محدد", day: "الأحد", date: "18 يناير 2026", month: "يناير", monthLabel: "JAN", type: "مبادرة شهرية", description: "لقاءات فردية شهرية بين القيادة والموظفين." },
  { name: "إعلان مبادرة صوتك مسموع (معلنة) — نموذج استبيان وتذكير", day: "الخميس", date: "22 يناير 2026", month: "يناير", monthLabel: "JAN", type: "مبادرة مستمرة", description: "قناة رسمية لاستقبال ملاحظات الموظفين وآرائهم." },
  { name: "إعلان مبادرة القيادة القريبة (خاصة)", day: "الأحد", date: "25 يناير 2026", month: "يناير", monthLabel: "JAN", type: "مبادرة خاصة", description: "مبادرة لتقريب القيادة من الموظفين في بيئة العمل." },
  // فبراير
  { name: "استبيان موظف الشهر + تفعيل الجودة", day: "الأحد", date: "1 فبراير 2026", month: "فبراير", monthLabel: "FEB", type: "استبيان", description: "استبيان شهري لاختيار موظف الشهر مع تفعيل قيمة الجودة." },
  { name: "إعلان موظف الشهر + تفعيل الجودة", day: "الخميس", date: "5 فبراير 2026", month: "فبراير", monthLabel: "FEB", type: "إعلان", description: "إعلان موظف الشهر مع تسليط الضوء على قيمة الجودة." },
  // مارس
  { name: "استبيان موظف الشهر + تفعيل الإبداع", day: "الأحد", date: "1 مارس 2026", month: "مارس", monthLabel: "MAR", type: "استبيان", description: "استبيان شهري مع تفعيل قيمة الإبداع." },
  { name: "إعلان موظف الشهر + تفعيل الإبداع", day: "الخميس", date: "5 مارس 2026", month: "مارس", monthLabel: "MAR", type: "إعلان", description: "إعلان موظف الشهر مع تسليط الضوء على قيمة الإبداع." },
  // أبريل
  { name: "استبيان موظف الشهر + تفعيل الشمولية", day: "الأربعاء", date: "1 أبريل 2026", month: "أبريل", monthLabel: "APR", type: "استبيان", description: "استبيان شهري مع تفعيل قيمة الشمولية." },
  { name: "إعلان موظف الشهر + تفعيل الشمولية", day: "الاثنين", date: "6 أبريل 2026", month: "أبريل", monthLabel: "APR", type: "إعلان", description: "إعلان موظف الشهر مع تسليط الضوء على قيمة الشمولية." },
  { name: "مبادرة Coffee With CEO", day: "الأحد", date: "12 أبريل 2026", month: "أبريل", monthLabel: "APR", type: "مبادرة مفاجئة", description: "جلسة قهوة مع الرئيس التنفيذي." },
  // مايو
  { name: "استبيان موظف الشهر + تفعيل الاعتزاز", day: "الأحد", date: "3 مايو 2026", month: "مايو", monthLabel: "MAY", type: "استبيان", description: "استبيان شهري مع تفعيل قيمة الاعتزاز." },
  { name: "إعلان موظف الشهر + تفعيل الاعتزاز", day: "الاثنين", date: "7 مايو 2026", month: "مايو", monthLabel: "MAY", type: "إعلان", description: "إعلان موظف الشهر مع تسليط الضوء على قيمة الاعتزاز." },
  { name: "مبادرة القيادة القريبة", day: "الخميس", date: "14 مايو 2026", month: "مايو", monthLabel: "MAY", type: "مبادرة خاصة", description: "جلسة القيادة القريبة الشهرية." },
  // يونيو
  { name: "استبيان موظف الشهر + تفعيل الإنجاز", day: "الاثنين", date: "1 يونيو 2026", month: "يونيو", monthLabel: "JUN", type: "استبيان", description: "استبيان شهري مع تفعيل قيمة الإنجاز." },
  { name: "إعلان موظف الشهر + تفعيل الإنجاز", day: "الاثنين", date: "7 يونيو 2026", month: "يونيو", monthLabel: "JUN", type: "إعلان", description: "إعلان موظف الشهر مع تسليط الضوء على قيمة الإنجاز." },
  // مستمرة
  { name: "مبادرة One to One", day: "", date: "يناير — ديسمبر 2026", month: "يناير", monthLabel: "مستمرة", type: "مبادرة شهرية", description: "لقاءات فردية شهرية مستمرة طوال العام بين القيادة والموظفين." },
];

const MONTHS_ORDER = ["يناير","فبراير","مارس","أبريل","مايو","يونيو","يوليو","أغسطس","سبتمبر","أكتوبر","نوفمبر","ديسمبر"];

const MONTH_MAP: Record<string, number> = {
  "يناير": 0, "فبراير": 1, "مارس": 2, "أبريل": 3, "مايو": 4, "يونيو": 5,
  "يوليو": 6, "أغسطس": 7, "سبتمبر": 8, "أكتوبر": 9, "نوفمبر": 10, "ديسمبر": 11,
};

function parseEventDate(dateStr: string): Date | null {
  const parts = dateStr.trim().split(' ');
  if (parts.length < 3) return null;
  const day = parseInt(parts[0]);
  const month = MONTH_MAP[parts[1]];
  const year = parseInt(parts[2]);
  if (isNaN(day) || month === undefined || isNaN(year)) return null;
  return new Date(year, month, day);
}

function getEventStatus(event: Event): "منتهية" | "جارية" | "مجدولة" {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const eventDate = parseEventDate(event.date);
  if (!eventDate) return event.status;
  const eventEnd = new Date(eventDate); eventEnd.setHours(23, 59, 59, 999);
  if (today > eventEnd) return "منتهية";
  if (today.toDateString() === eventDate.toDateString()) return "جارية";
  return "مجدولة";
}

function getInitiativeStatus(init: Initiative): "منتهية" | "جارية" | "مجدولة" {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const d = parseEventDate(init.date);
  if (!d) return "مجدولة";
  if (today > d) return "منتهية";
  if (today.toDateString() === d.toDateString()) return "جارية";
  return "مجدولة";
}

const CAT_CONFIG: Record<string, { label: string; color: string; bg: string }> = {
  A: { label: "مناسبة كبرى", color: "#F59E0B", bg: "#F59E0B18" },
  B: { label: "فعالية متوسطة", color: peoplePrimary, bg: "hsl(var(--primary) / .10)" },
  C: { label: "مناسبة توعوية", color: "#8B5CF6", bg: "#8B5CF618" },
};

const STATUS_CONFIG: Record<string, { color: string; bg: string; icon: any }> = {
  "منتهية":  { color: "#6B7280", bg: "#6B728018", icon: CheckCircle2 },
  "جارية":   { color: peoplePrimary, bg: "hsl(var(--primary) / .10)", icon: Zap },
  "مجدولة":  { color: "#3B82F6", bg: "#3B82F618", icon: Clock },
};

const INITIATIVE_TYPE_CONFIG: Record<string, { color: string; bg: string }> = {
  "إعلان":            { color: peoplePrimary, bg: "hsl(var(--primary) / .10)" },
  "مبادرة شهرية":    { color: "#3B82F6", bg: "#3B82F618" },
  "مبادرة مفاجئة":   { color: "#F59E0B", bg: "#F59E0B18" },
  "مبادرة مستمرة":   { color: "#8B5CF6", bg: "#8B5CF618" },
  "مبادرة خاصة":     { color: "#EC4899", bg: "#EC489918" },
  "استبيان":          { color: "hsl(165 60% 55%)", bg: "hsl(165 60% 55%)18" },
};

const CustomTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null;
  return (
    <div style={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: '10px', padding: '10px 14px', fontFamily: 'Alexandria', direction: 'rtl', boxShadow: '0 8px 24px #00000060' }}>
      <p style={{ color: peoplePrimary, fontSize: '12px', fontWeight: 700, marginBottom: '6px' }}>{label}</p>
      {payload.map((p: any, i: number) => (
        <p key={i} style={{ color: p.color, fontSize: '11px', marginBottom: '2px' }}>
          {p.name}: <strong>{typeof p.value === 'number' ? p.value.toLocaleString('ar-SA') : p.value}</strong>
          {p.name === 'الميزانية' ? ' ر.س' : ''}
        </p>
      ))}
    </div>
  );
};

// ─── Event Detail Modal ────────────────────────────────────────────────────────
function EventModal({ event, onClose }: { event: Event; onClose: () => void }) {
  const catCfg = CAT_CONFIG[event.category] || CAT_CONFIG.C;
  const dynamicStatus = getEventStatus(event);
  const statusCfg = STATUS_CONFIG[dynamicStatus] || STATUS_CONFIG["مجدولة"];
  const StatusIcon = statusCfg.icon;

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose]);

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '16px', background: 'hsl(var(--background) / 0.94)' }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: '16px', width: '100%', maxWidth: '560px', boxShadow: '0 24px 64px rgba(0,0,0,0.7)', direction: 'rtl', overflow: 'hidden', animation: 'modalIn 0.2s ease-out' }}>
        <div style={{ padding: '20px 24px 16px', borderBottom: '1px solid hsl(var(--border))', background: 'hsl(var(--card))' }}>
          <div className="flex items-start justify-between gap-3">
            <div style={{ flex: 1 }}>
              <div className="flex items-center gap-2 mb-2 flex-wrap">
                <span style={{ display: 'inline-block', padding: '3px 10px', borderRadius: '20px', background: catCfg.bg, border: `1px solid ${catCfg.color}40`, color: catCfg.color, fontSize: '10px', fontWeight: 700, fontFamily: 'Alexandria' }}>{catCfg.label}</span>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', padding: '3px 10px', borderRadius: '20px', background: statusCfg.bg, border: `1px solid ${statusCfg.color}40`, color: statusCfg.color, fontSize: '10px', fontWeight: 700, fontFamily: 'Alexandria' }}>
                  <StatusIcon size={10} />{dynamicStatus}
                </span>
              </div>
              <h2 style={{ fontFamily: 'Alexandria', fontWeight: 800, fontSize: '18px', color: 'hsl(var(--foreground))', lineHeight: 1.3 }}>{event.name}</h2>
            </div>
            <button onClick={onClose} style={{ background: 'hsl(var(--border))', border: 'none', borderRadius: '8px', width: '32px', height: '32px', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: 'hsl(var(--muted-foreground))', flexShrink: 0 }}>
              <X size={15} />
            </button>
          </div>
          <div className="flex flex-wrap gap-3 mt-3">
            {[
              { icon: Calendar, label: `${event.day}، ${event.date}`, color: peoplePrimary },
              { icon: MapPin, label: event.location, color: '#8B5CF6' },
              ...(event.budget ? [{ icon: DollarSign, label: `${event.budget.toLocaleString('ar-SA')} ر.س`, color: '#F59E0B' }] : []),
            ].map((item, i) => {
              const Icon = item.icon;
              return (
                <div key={i} className="flex items-center gap-1.5">
                  <Icon size={12} color={item.color} />
                  <span style={{ fontFamily: 'Alexandria', fontSize: '11px', color: 'hsl(var(--muted-foreground))' }}>{item.label}</span>
                </div>
              );
            })}
          </div>
        </div>
        <div style={{ padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {[
            { icon: FileText, color: '#1FA98C', bg: '#1FA98C20', title: 'وصف الفعالية', content: event.description },
            { icon: Zap, color: '#F59E0B', bg: '#F59E0B20', title: 'آلية التفعيل', content: event.activation },
          ].map((sec, i) => {
            const Icon = sec.icon;
            return (
              <div key={i}>
                {i > 0 && <div style={{ height: '1px', background: 'hsl(var(--border))', marginBottom: '16px' }} />}
                <div className="flex items-center gap-2 mb-2">
                  <div style={{ width: '26px', height: '26px', borderRadius: '7px', background: sec.bg, display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Icon size={13} color={sec.color} /></div>
                  <span style={{ fontFamily: 'Alexandria', fontWeight: 700, fontSize: '13px', color: 'hsl(var(--muted-foreground))' }}>{sec.title}</span>
                </div>
                <p style={{ fontFamily: 'Alexandria', fontSize: '13px', color: 'hsl(var(--muted-foreground))', lineHeight: 1.8, paddingRight: '34px' }}>{sec.content}</p>
              </div>
            );
          })}
          <div style={{ height: '1px', background: 'hsl(var(--border))' }} />
          <div>
            <div className="flex items-center gap-2 mb-2">
              <div style={{ width: '26px', height: '26px', borderRadius: '7px', background: '#8B5CF620', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><User size={13} color="#8B5CF6" /></div>
              <span style={{ fontFamily: 'Alexandria', fontWeight: 700, fontSize: '13px', color: 'hsl(var(--muted-foreground))' }}>الجهة المسؤولة</span>
            </div>
            <div style={{ paddingRight: '34px' }}>
              <span style={{ display: 'inline-block', padding: '5px 14px', borderRadius: '8px', background: '#8B5CF615', border: '1px solid #8B5CF630', color: '#8B5CF6', fontFamily: 'Alexandria', fontSize: '12px', fontWeight: 700 }}>{event.responsible}</span>
            </div>
          </div>
        </div>
        <div style={{ padding: '14px 24px', borderTop: '1px solid hsl(var(--border))', display: 'flex', justifyContent: 'flex-start' }}>
          <button onClick={onClose} style={{ padding: '8px 20px', borderRadius: '8px', background: 'hsl(var(--border))', border: '1px solid hsl(var(--border))', color: 'hsl(var(--muted-foreground))', fontFamily: 'Alexandria', fontSize: '12px', fontWeight: 600, cursor: 'pointer' }}>إغلاق</button>
        </div>
      </div>
      <style>{`@keyframes modalIn { from { opacity: 0; transform: scale(0.95) translateY(10px); } to { opacity: 1; transform: scale(1) translateY(0); } }`}</style>
    </div>
  );
}

// ─── Initiatives Tab (مبادرات 2026) ───────────────────────────────────────────
function InitiativesTab() {
  const [search, setSearch] = useState('');
  const [filterMonth, setFilterMonth] = useState('الكل');
  const [filterType, setFilterType] = useState('الكل');

  const allTypes = useMemo(() => Array.from(new Set(INITIATIVES_RAW.map(i => i.type))), []);

  const filtered = useMemo(() => {
    let list = [...INITIATIVES_RAW];
    const q = search.trim().toLowerCase();
    if (q) list = list.filter(i => i.name.toLowerCase().includes(q) || i.type.includes(q));
    if (filterMonth !== 'الكل') list = list.filter(i => i.month === filterMonth);
    if (filterType !== 'الكل') list = list.filter(i => i.type === filterType);
    return list;
  }, [search, filterMonth, filterType]);

  const monthGroups = useMemo(() => {
    const groups: Record<string, Initiative[]> = {};
    MONTHS_ORDER.forEach(m => {
      const items = filtered.filter(i => i.month === m);
      if (items.length > 0) groups[m] = items;
    });
    return groups;
  }, [filtered]);

  const typeStats = useMemo(() =>
    allTypes.map(t => ({ type: t, count: INITIATIVES_RAW.filter(i => i.type === t).length })),
  [allTypes]);

  return (
    <div className="space-y-5">
      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
        {typeStats.map((stat, i) => {
          const cfg = INITIATIVE_TYPE_CONFIG[stat.type] || { color: '#1FA98C', bg: '#1FA98C18' };
          return (
            <div key={i} style={{ background: 'hsl(var(--card))', border: `1px solid ${cfg.color}30`, borderRadius: '12px', padding: '14px 16px', fontFamily: 'Alexandria', direction: 'rtl' }}>
              <div style={{ fontSize: '22px', fontWeight: 800, color: cfg.color }}>{stat.count}</div>
              <div style={{ fontSize: '12px', color: 'hsl(var(--muted-foreground))', marginTop: '2px' }}>{stat.type}</div>
            </div>
          );
        })}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3">
        <div style={{ position: 'relative', flex: '1', minWidth: '200px' }}>
          <Search size={13} style={{ position: 'absolute', right: '10px', top: '50%', transform: 'translateY(-50%)', color: '#1FA98C', opacity: 0.7, pointerEvents: 'none' }} />
          <input type="text" value={search} onChange={e => setSearch(e.target.value)} placeholder="ابحث عن مبادرة..."
            style={{ width: '100%', padding: '8px 32px 8px 32px', background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: '8px', fontFamily: 'Alexandria', fontSize: '12px', color: 'hsl(var(--foreground))', outline: 'none', direction: 'rtl' }}
            onFocus={e => { e.target.style.borderColor = '#1FA98C'; }}
            onBlur={e => { e.target.style.borderColor = 'hsl(var(--border))'; }} />
          {search && (
            <button onClick={() => setSearch('')} style={{ position: 'absolute', left: '8px', top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: 'hsl(var(--muted-foreground))', display: 'flex' }}>
              <X size={12} />
            </button>
          )}
        </div>
        <select value={filterMonth} onChange={e => setFilterMonth(e.target.value)}
          style={{ padding: '8px 12px', background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: '8px', fontFamily: 'Alexandria', fontSize: '12px', color: 'hsl(var(--foreground))', outline: 'none', direction: 'rtl', cursor: 'pointer' }}>
          <option value="الكل">كل الأشهر</option>
          {MONTHS_ORDER.map(m => <option key={m} value={m}>{m}</option>)}
        </select>
        <select value={filterType} onChange={e => setFilterType(e.target.value)}
          style={{ padding: '8px 12px', background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: '8px', fontFamily: 'Alexandria', fontSize: '12px', color: 'hsl(var(--foreground))', outline: 'none', direction: 'rtl', cursor: 'pointer' }}>
          <option value="الكل">كل الأنواع</option>
          {allTypes.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
      </div>

      {/* Grouped by Month */}
      {Object.keys(monthGroups).length === 0 ? (
        <div style={{ textAlign: 'center', padding: '48px', fontFamily: 'Alexandria', fontSize: '14px', color: 'hsl(var(--muted-foreground))' }}>لا توجد مبادرات تطابق البحث</div>
      ) : (
        Object.entries(monthGroups).map(([month, items]) => (
          <div key={month} style={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: '14px', overflow: 'hidden' }}>
            <div style={{ padding: '12px 18px', background: 'hsl(var(--card))', borderBottom: '1px solid hsl(var(--border))', display: 'flex', alignItems: 'center', gap: '10px', direction: 'rtl' }}>
              <div style={{ width: '28px', height: '28px', borderRadius: '8px', background: '#1FA98C20', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <Calendar size={13} color="#1FA98C" />
              </div>
              <span style={{ fontFamily: 'Alexandria', fontWeight: 800, fontSize: '14px', color: '#1FA98C' }}>{month}</span>
              <span style={{ background: '#1FA98C20', color: '#1FA98C', borderRadius: '20px', padding: '2px 10px', fontSize: '11px', fontWeight: 700, fontFamily: 'Alexandria' }}>{items.length} مبادرة</span>
            </div>
            <div style={{ padding: '12px 18px', display: 'flex', flexDirection: 'column', gap: '10px', direction: 'rtl' }}>
              {items.map((init, idx) => {
                const typeCfg = INITIATIVE_TYPE_CONFIG[init.type] || { color: '#1FA98C', bg: '#1FA98C18' };
                const status = getInitiativeStatus(init);
                const statusCfg = STATUS_CONFIG[status];
                const StatusIcon = statusCfg.icon;
                return (
                  <div key={idx} style={{ background: 'hsl(var(--background))', border: '1px solid hsl(var(--muted))', borderRadius: '10px', padding: '12px 14px', display: 'flex', alignItems: 'flex-start', gap: '12px' }}>
                    <div style={{ width: '32px', height: '32px', borderRadius: '8px', background: typeCfg.bg, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginTop: '1px' }}>
                      <Target size={14} color={typeCfg.color} />
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div className="flex items-start justify-between gap-2 flex-wrap">
                        <span style={{ fontFamily: 'Alexandria', fontWeight: 700, fontSize: '13px', color: 'hsl(var(--foreground))', lineHeight: 1.4 }}>{init.name}</span>
                        <div className="flex items-center gap-2 flex-shrink-0">
                          <span style={{ display: 'inline-block', padding: '2px 8px', borderRadius: '20px', background: typeCfg.bg, border: `1px solid ${typeCfg.color}40`, color: typeCfg.color, fontSize: '10px', fontWeight: 700, fontFamily: 'Alexandria', whiteSpace: 'nowrap' }}>{init.type}</span>
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '3px', padding: '2px 8px', borderRadius: '20px', background: statusCfg.bg, border: `1px solid ${statusCfg.color}40`, color: statusCfg.color, fontSize: '10px', fontWeight: 700, fontFamily: 'Alexandria', whiteSpace: 'nowrap' }}>
                            <StatusIcon size={9} />{status}
                          </span>
                        </div>
                      </div>
                      <div className="flex items-center gap-3 mt-1.5 flex-wrap">
                        <span style={{ fontFamily: 'Alexandria', fontSize: '11px', color: 'hsl(var(--muted-foreground))', display: 'flex', alignItems: 'center', gap: '4px' }}>
                          <Calendar size={10} color="#1FA98C" />{init.day && `${init.day}، `}{init.date}
                        </span>
                      </div>
                      {init.description && (
                        <p style={{ fontFamily: 'Alexandria', fontSize: '11px', color: 'hsl(var(--muted-foreground))', marginTop: '6px', lineHeight: 1.6 }}>{init.description}</p>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ))
      )}
    </div>
  );
}

// ─── Add Event Modal ─────────────────────────────────────────────────────────
function AddEventModal({ onClose, onAdd }: { onClose: () => void; onAdd: (e: Event) => void }) {
  const [form, setForm] = useState({
    name: '', category: 'مناسبة وطنية', day: '', date: '', month: 'يناير',
    budget: '', description: '', activation: '', responsible: 'قسم الموارد البشرية',
    location: '', status: 'مجدولة' as Event['status'],
  });

  const inputStyle: React.CSSProperties = {
    width: '100%', padding: '8px 12px', borderRadius: '8px',
    background: 'hsl(var(--muted))', border: '1px solid hsl(var(--border))',
    color: 'hsl(var(--foreground))', fontFamily: 'Alexandria', fontSize: '13px', direction: 'rtl',
  };

  const save = () => {
    if (!form.name.trim() || !form.date.trim()) {
      toast.error('يرجى تعبئة اسم الفعالية والتاريخ');
      return;
    }
    onAdd({
      name: form.name,
      category: form.category,
      day: form.day || 'الأحد',
      date: form.date,
      month: form.month,
      budget: form.budget ? parseFloat(form.budget) : null,
      description: form.description,
      activation: form.activation,
      responsible: form.responsible,
      location: form.location,
      status: form.status,
    });
    toast.success(`تم إضافة الفعالية: ${form.name}`);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.7)', direction: 'rtl' }}>
      <div className="rounded-2xl p-6 w-full max-w-lg max-h-[90vh] overflow-y-auto" style={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--muted))' }}>
        <div className="flex items-center justify-between mb-5">
          <h3 style={{ fontFamily: 'Alexandria', fontWeight: 800, fontSize: '16px', color: 'hsl(var(--foreground))' }}>إضافة فعالية جديدة</h3>
          <button onClick={onClose} style={{ color: 'hsl(var(--muted-foreground))', cursor: 'pointer', background: 'none', border: 'none' }}><X size={18} /></button>
        </div>
        <div className="space-y-3">
          <div>
            <label style={{ fontFamily: 'Alexandria', fontSize: '12px', color: 'hsl(var(--muted-foreground))', display: 'block', marginBottom: '4px' }}>اسم الفعالية *</label>
            <input style={inputStyle} value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))} placeholder="مثال: يوم الموظف المثالي" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label style={{ fontFamily: 'Alexandria', fontSize: '12px', color: 'hsl(var(--muted-foreground))', display: 'block', marginBottom: '4px' }}>التاريخ *</label>
              <input type="date" style={inputStyle} value={form.date} onChange={e => setForm(p => ({ ...p, date: e.target.value }))} />
            </div>
            <div>
              <label style={{ fontFamily: 'Alexandria', fontSize: '12px', color: 'hsl(var(--muted-foreground))', display: 'block', marginBottom: '4px' }}>الشهر</label>
              <select style={inputStyle} value={form.month} onChange={e => setForm(p => ({ ...p, month: e.target.value }))}>
                {['يناير','فبراير','مارس','أبريل','مايو','يونيو','يوليو','أغسطس','سبتمبر','أكتوبر','نوفمبر','ديسمبر'].map(m => <option key={m} value={m}>{m}</option>)}
              </select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label style={{ fontFamily: 'Alexandria', fontSize: '12px', color: 'hsl(var(--muted-foreground))', display: 'block', marginBottom: '4px' }}>التصنيف</label>
              <select style={inputStyle} value={form.category} onChange={e => setForm(p => ({ ...p, category: e.target.value }))}>
                {Object.entries(CAT_CONFIG).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
              </select>
            </div>
            <div>
              <label style={{ fontFamily: 'Alexandria', fontSize: '12px', color: 'hsl(var(--muted-foreground))', display: 'block', marginBottom: '4px' }}>الحالة</label>
              <select style={inputStyle} value={form.status} onChange={e => setForm(p => ({ ...p, status: e.target.value as Event['status'] }))}>
                {['مجدولة','جارية','منتهية'].map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label style={{ fontFamily: 'Alexandria', fontSize: '12px', color: 'hsl(var(--muted-foreground))', display: 'block', marginBottom: '4px' }}>الميزانية (ر.س)</label>
              <input type="number" style={inputStyle} value={form.budget} onChange={e => setForm(p => ({ ...p, budget: e.target.value }))} placeholder="0" />
            </div>
            <div>
              <label style={{ fontFamily: 'Alexandria', fontSize: '12px', color: 'hsl(var(--muted-foreground))', display: 'block', marginBottom: '4px' }}>الموقع</label>
              <input style={inputStyle} value={form.location} onChange={e => setForm(p => ({ ...p, location: e.target.value }))} placeholder="مقر الشركة" />
            </div>
          </div>
          <div>
            <label style={{ fontFamily: 'Alexandria', fontSize: '12px', color: 'hsl(var(--muted-foreground))', display: 'block', marginBottom: '4px' }}>الجهة المسؤولة</label>
            <input style={inputStyle} value={form.responsible} onChange={e => setForm(p => ({ ...p, responsible: e.target.value }))} placeholder="قسم الموارد البشرية" />
          </div>
          <div>
            <label style={{ fontFamily: 'Alexandria', fontSize: '12px', color: 'hsl(var(--muted-foreground))', display: 'block', marginBottom: '4px' }}>الوصف</label>
            <textarea style={{ ...inputStyle, minHeight: '70px', resize: 'vertical' }} value={form.description} onChange={e => setForm(p => ({ ...p, description: e.target.value }))} placeholder="وصف مختصر للفعالية..." />
          </div>
        </div>
        <div className="flex gap-2 mt-5 justify-start">
          <button className="btn-brand" onClick={save}>حفظ الفعالية</button>
          <button onClick={onClose} style={{ padding: '8px 16px', borderRadius: '8px', background: 'hsl(var(--border))', border: '1px solid hsl(var(--border))', color: 'hsl(var(--muted-foreground))', fontFamily: 'Alexandria', fontSize: '13px', cursor: 'pointer' }}>إلغاء</button>
        </div>
      </div>
    </div>
  );
}

// ─── Main Component ────────────────────────────────────────────────────────────
export default function Engagement() {
  const [activeTab, setActiveTab] = useState<'events' | 'initiatives' | 'hub' | 'surveys'>('events');
  const [search, setSearch] = useState('');
  const [filterMonth, setFilterMonth] = useState('الكل');
  const [filterCat, setFilterCat] = useState('الكل');
  const [filterStatus, setFilterStatus] = useState('الكل');
  const [sortField, setSortField] = useState<'month' | 'budget' | 'name'>('month');
  const [sortAsc, setSortAsc] = useState(true);
  const [selectedEvent, setSelectedEvent] = useState<Event | null>(null);
  const [showAddEvent, setShowAddEvent] = useState(false);
  const [customEvents, setCustomEvents] = useState<Event[]>([]);

  const totalBudget = EVENTS_RAW.reduce((s, e) => s + (e.budget || 0), 0);
  const budgetedCount = EVENTS_RAW.filter(e => e.budget && e.budget > 0).length;
  const freeCount = EVENTS_RAW.filter(e => !e.budget || e.budget === 0).length;

  const monthlyData = useMemo(() =>
    MONTHS_ORDER.map(m => {
      const evts = EVENTS_RAW.filter(e => e.month === m);
      return { month: m, fullMonth: m, count: evts.length, budget: evts.reduce((s, e) => s + (e.budget || 0), 0) };
    }).filter(d => d.count > 0),
  []);

  const catData = useMemo(() =>
    Object.entries(CAT_CONFIG).map(([key, cfg]) => ({
      name: cfg.label, value: EVENTS_RAW.filter(e => e.category === key).length, color: cfg.color, key,
    })),
  []);

  const filtered = useMemo(() => {
    let list = [...EVENTS_RAW];
    const q = search.trim().toLowerCase();
    if (q) list = list.filter(e => e.name.toLowerCase().includes(q) || e.month.includes(q) || e.day.includes(q) || e.responsible.toLowerCase().includes(q));
    if (filterMonth !== 'الكل') list = list.filter(e => e.month === filterMonth);
    if (filterCat !== 'الكل') list = list.filter(e => e.category === filterCat);
    if (filterStatus !== 'الكل') list = list.filter(e => getEventStatus(e) === filterStatus);
    list.sort((a, b) => {
      let av: any, bv: any;
      if (sortField === 'month') { av = MONTHS_ORDER.indexOf(a.month); bv = MONTHS_ORDER.indexOf(b.month); }
      else if (sortField === 'budget') { av = a.budget || 0; bv = b.budget || 0; }
      else { av = a.name; bv = b.name; }
      return sortAsc ? (av > bv ? 1 : -1) : (av < bv ? 1 : -1);
    });
    return list;
  }, [search, filterMonth, filterCat, filterStatus, sortField, sortAsc]);

  const liveEvents = useMemo(() => EVENTS_RAW.filter(e => getEventStatus(e) === 'جارية'), []);

  const toggleSort = (field: typeof sortField) => {
    if (sortField === field) setSortAsc(p => !p);
    else { setSortField(field); setSortAsc(true); }
  };

  const SortBtn = ({ field }: { field: typeof sortField }) => (
    <span style={{ opacity: sortField === field ? 1 : 0.3, marginRight: '4px' }}>
      {sortField === field && sortAsc ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
    </span>
  );

  const filteredTotal = filtered.reduce((s, e) => s + (e.budget || 0), 0);

  const TABS = [
    { key: 'events', label: 'الفعاليات والمناسبات', icon: Calendar },
    { key: 'initiatives', label: 'مبادرات 2026', icon: Rocket },
    { key: 'hub', label: 'مركز الاندماج', icon: Heart },
    { key: 'surveys', label: 'الاستبيانات', icon: Star },
  ];

  const allEventsForDisplay = useMemo(() => [...EVENTS_RAW, ...customEvents], [customEvents]);

  return (
    <div className="space-y-6" style={{ direction: 'rtl' }}>
      {selectedEvent && <EventModal event={selectedEvent} onClose={() => setSelectedEvent(null)} />}
      {showAddEvent && <AddEventModal onClose={() => setShowAddEvent(false)} onAdd={(e) => { setCustomEvents(p => [...p, e]); setShowAddEvent(false); }} />}

      {/* ── Page Header ─────────────────────────────────────────────────── */}
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <div style={{ width: '36px', height: '36px', borderRadius: '10px', background: '#1FA98C20', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Heart size={18} color="#1FA98C" />
            </div>
            <h1 style={{ fontFamily: 'Alexandria', fontWeight: 800, fontSize: '20px', color: 'hsl(var(--foreground))' }}>اندماج الموظفين</h1>
          </div>
          <p style={{ fontFamily: 'Alexandria', fontSize: '13px', color: 'hsl(var(--muted-foreground))', paddingRight: '44px' }}>
            ميزانية التواصل الداخلي 2026 — خطة الفعاليات والمبادرات
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div style={{ background: 'hsl(var(--card))', border: '1px solid #1FA98C40', borderRadius: '10px', padding: '8px 16px', fontFamily: 'Alexandria', fontSize: '12px', color: '#1FA98C', fontWeight: 700 }}>
            الإجمالي: {totalBudget.toLocaleString('ar-SA')} ر.س
          </div>
          <button className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-semibold"
            style={{ fontFamily: 'Alexandria', background: 'hsl(var(--border))', border: '1px solid hsl(var(--border))', color: 'hsl(var(--muted-foreground))' }}
            onClick={() => { exportEngagement(filtered, INITIATIVES_RAW); toast.success('جارٍ تحميل ملف Excel...'); }}>
            <Download size={14} /><span>تصدير Excel</span>
          </button>
          <button className="btn-brand flex items-center gap-2" onClick={() => setShowAddEvent(true)}>
            <Plus size={14} /><span>فعالية جديدة</span>
          </button>
        </div>
      </div>

      {/* ── Tabs ────────────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', gap: '4px', background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: '12px', padding: '4px', width: 'fit-content' }}>
        {TABS.map(tab => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.key;
          return (
            <button key={tab.key} onClick={() => setActiveTab(tab.key as any)}
              style={{ display: 'flex', alignItems: 'center', gap: '7px', padding: '8px 18px', borderRadius: '9px', background: isActive ? '#1FA98C' : 'transparent', border: 'none', cursor: 'pointer', fontFamily: 'Alexandria', fontSize: '13px', fontWeight: 700, color: isActive ? '#fff' : 'hsl(var(--muted-foreground))', transition: 'all 0.2s' }}>
              <Icon size={14} />
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* ── Events Tab ─────────────────────────────────────────────────── */}
      {activeTab === 'events' && (
        <>
          {liveEvents.length > 0 && (
            <div style={{ background: 'hsl(var(--primary) / 0.10)', border: '1px solid #1FA98C50', borderRadius: '14px', padding: '14px 18px', fontFamily: 'Alexandria', direction: 'rtl', display: 'flex', alignItems: 'flex-start', gap: '14px' }}>
              <div style={{ position: 'relative', flexShrink: 0, marginTop: '3px' }}>
                <div style={{ width: '12px', height: '12px', borderRadius: '50%', background: '#1FA98C' }} />
                <div style={{ position: 'absolute', inset: '-4px', borderRadius: '50%', border: '2px solid #1FA98C', animation: 'ping 1.5s cubic-bezier(0,0,0.2,1) infinite', opacity: 0.6 }} />
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px', flexWrap: 'wrap' }}>
                  <span style={{ fontSize: '13px', fontWeight: 800, color: '#1FA98C' }}>⚡ فعاليات جارية الآن</span>
                  <span style={{ background: '#1FA98C30', color: '#1FA98C', borderRadius: '20px', padding: '2px 10px', fontSize: '11px', fontWeight: 700 }}>{liveEvents.length} {liveEvents.length === 1 ? 'فعالية' : 'فعاليات'}</span>
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                  {liveEvents.map((ev, i) => (
                    <button key={i} onClick={() => setSelectedEvent(ev)} style={{ background: 'hsl(var(--card))', border: '1px solid #1FA98C40', borderRadius: '8px', padding: '6px 14px', fontFamily: 'Alexandria', fontSize: '12px', fontWeight: 600, color: 'hsl(var(--foreground))', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#1FA98C', flexShrink: 0 }} />
                      {ev.name}
                      <span style={{ color: 'hsl(var(--muted-foreground))', fontSize: '10px' }}>{ev.date}</span>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* KPI Cards */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            {[
              { title: "إجمالي الفعاليات", value: EVENTS_RAW.length, sub: "فعالية في 2026", icon: Calendar, color: "#1FA98C" },
              { title: "إجمالي الميزانية", value: `${(totalBudget / 1000).toFixed(0)}K`, sub: "ريال سعودي", icon: DollarSign, color: "#F59E0B" },
              { title: "فعاليات مدفوعة", value: budgetedCount, sub: "بميزانية محددة", icon: Star, color: "#8B5CF6" },
              { title: "مناسبات توعوية", value: freeCount, sub: "بدون تكلفة مباشرة", icon: Tag, color: "hsl(165 60% 55%)" },
            ].map((card, i) => {
              const Icon = card.icon;
              return (
                <div key={i} className="stat-card animate-fade-in-up" style={{ animationDelay: `${i * 70}ms`, opacity: 0 }}>
                  <div style={{ width: '38px', height: '38px', borderRadius: '10px', background: `${card.color}20`, color: card.color, display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: '12px' }}>
                    <Icon size={17} />
                  </div>
                  <div style={{ fontFamily: 'Alexandria', fontWeight: 800, fontSize: '26px', color: 'hsl(var(--foreground))', lineHeight: 1 }}>{card.value}</div>
                  <div style={{ fontFamily: 'Alexandria', fontWeight: 600, fontSize: '12px', color: 'hsl(var(--muted-foreground))', marginTop: '4px' }}>{card.title}</div>
                  <div style={{ fontFamily: 'Alexandria', fontSize: '11px', color: 'hsl(var(--muted-foreground))', marginTop: '2px' }}>{card.sub}</div>
                </div>
              );
            })}
          </div>

          {/* Charts Row */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <div className="card-brand rounded-xl p-5 lg:col-span-2">
              <div className="section-title mb-4">توزيع الفعاليات والميزانية شهرياً</div>
              <ResponsiveContainer width="100%" height={230}>
                <BarChart data={monthlyData} margin={{ top: 5, right: 5, left: -20, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                  <XAxis dataKey="month" tick={{ fontFamily: 'Alexandria', fontSize: 9, fill: 'hsl(var(--muted-foreground))' }} axisLine={false} tickLine={false} interval={0} />
                  <YAxis yAxisId="left" tick={{ fontFamily: 'Alexandria', fontSize: 9, fill: 'hsl(var(--muted-foreground))' }} axisLine={false} tickLine={false} />
                  <YAxis yAxisId="right" orientation="right" tick={{ fontFamily: 'Alexandria', fontSize: 9, fill: 'hsl(var(--muted-foreground))' }} axisLine={false} tickLine={false} />
                  <Tooltip content={<CustomTooltip />} />
                  <Bar yAxisId="left" dataKey="count" name="عدد الفعاليات" fill="#1FA98C" radius={[4,4,0,0]} maxBarSize={24} />
                  <Bar yAxisId="right" dataKey="budget" name="الميزانية" fill="#F59E0B" radius={[4,4,0,0]} maxBarSize={24} opacity={0.8} />
                </BarChart>
              </ResponsiveContainer>
              <div className="flex items-center gap-5 mt-2 justify-center">
                {[{ color: '#1FA98C', label: 'عدد الفعاليات' }, { color: '#F59E0B', label: 'الميزانية (ر.س)' }].map((l, i) => (
                  <div key={i} className="flex items-center gap-1.5">
                    <div style={{ width: '10px', height: '10px', borderRadius: '2px', background: l.color }} />
                    <span style={{ fontFamily: 'Alexandria', fontSize: '11px', color: 'hsl(var(--muted-foreground))' }}>{l.label}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="card-brand rounded-xl p-5">
              <div className="section-title mb-4">توزيع الفئات</div>
              <ResponsiveContainer width="100%" height={160}>
                <PieChart>
                  <Pie data={catData} cx="50%" cy="50%" outerRadius={68} innerRadius={32} dataKey="value" nameKey="name" paddingAngle={3}>
                    {catData.map((entry, i) => <Cell key={i} fill={entry.color} />)}
                  </Pie>
                  <Tooltip content={<CustomTooltip />} />
                </PieChart>
              </ResponsiveContainer>
              <div className="space-y-2.5 mt-3">
                {catData.map(c => (
                  <div key={c.key} className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div style={{ width: '8px', height: '8px', borderRadius: '2px', background: c.color, flexShrink: 0 }} />
                      <span style={{ fontFamily: 'Alexandria', fontSize: '11px', color: 'hsl(var(--muted-foreground))' }}>{c.name}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <div style={{ width: '60px', height: '4px', borderRadius: '2px', background: 'hsl(var(--border))', overflow: 'hidden' }}>
                        <div style={{ width: `${(c.value / EVENTS_RAW.length) * 100}%`, height: '100%', background: c.color, borderRadius: '2px' }} />
                      </div>
                      <span style={{ fontFamily: 'Alexandria', fontSize: '12px', fontWeight: 700, color: c.color, minWidth: '20px', textAlign: 'left' }}>{c.value}</span>
                    </div>
                  </div>
                ))}
              </div>
              {/* Budget Classification */}
              <div style={{ marginTop: '20px', paddingTop: '16px', borderTop: '1px solid hsl(var(--border))' }}>
                <div style={{ fontFamily: 'Alexandria', fontSize: '11px', fontWeight: 700, color: 'hsl(var(--muted-foreground))', marginBottom: '10px' }}>تصنيف الميزانية</div>
                {[
                  { label: 'A — فعالية كبرى', range: '150,000 – 300,000 ر.س', color: '#F59E0B' },
                  { label: 'B — فعالية متوسطة', range: '3,000 – 25,000 ر.س', color: '#1FA98C' },
                  { label: 'C — فعالية صغيرة', range: '100 – 1,000 ر.س', color: '#8B5CF6' },
                ].map((item, i) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '6px' }}>
                    <span style={{ fontFamily: 'Alexandria', fontSize: '10px', color: item.color, fontWeight: 700 }}>{item.label}</span>
                    <span style={{ fontFamily: 'Alexandria', fontSize: '10px', color: 'hsl(var(--muted-foreground))' }}>{item.range}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Events Table */}
          <div className="card-brand rounded-xl p-5">
            <div className="flex items-center justify-between flex-wrap gap-3 mb-4">
              <div>
                <div className="section-title">جدول الفعاليات التفصيلي</div>
                <p style={{ fontFamily: 'Alexandria', fontSize: '11px', color: 'hsl(var(--muted-foreground))', marginTop: '2px' }}>انقر على أي فعالية لعرض تفاصيلها</p>
              </div>
              <span style={{ fontFamily: 'Alexandria', fontSize: '11px', color: 'hsl(var(--muted-foreground))' }}>{filtered.length} من {EVENTS_RAW.length} فعالية</span>
            </div>

            {/* Filters */}
            <div className="flex flex-wrap gap-3 mb-4">
              <div style={{ position: 'relative', flex: '1', minWidth: '200px' }}>
                <Search size={13} style={{ position: 'absolute', right: '10px', top: '50%', transform: 'translateY(-50%)', color: '#1FA98C', opacity: 0.7, pointerEvents: 'none' }} />
                <input type="text" value={search} onChange={e => setSearch(e.target.value)} placeholder="ابحث عن فعالية أو مسؤول..."
                  style={{ width: '100%', padding: '8px 32px 8px 32px', background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: '8px', fontFamily: 'Alexandria', fontSize: '12px', color: 'hsl(var(--foreground))', outline: 'none', direction: 'rtl', transition: 'border-color 0.2s' }}
                  onFocus={e => { e.target.style.borderColor = '#1FA98C'; }}
                  onBlur={e => { e.target.style.borderColor = 'hsl(var(--border))'; }} />
                {search && (
                  <button onClick={() => setSearch('')} style={{ position: 'absolute', left: '8px', top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: 'hsl(var(--muted-foreground))', display: 'flex' }}>
                    <X size={12} />
                  </button>
                )}
              </div>
              <select value={filterMonth} onChange={e => setFilterMonth(e.target.value)}
                style={{ padding: '8px 12px', background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: '8px', fontFamily: 'Alexandria', fontSize: '12px', color: 'hsl(var(--foreground))', outline: 'none', direction: 'rtl', cursor: 'pointer' }}>
                <option value="الكل">كل الأشهر</option>
                {MONTHS_ORDER.map(m => <option key={m} value={m}>{m}</option>)}
              </select>
              <select value={filterCat} onChange={e => setFilterCat(e.target.value)}
                style={{ padding: '8px 12px', background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: '8px', fontFamily: 'Alexandria', fontSize: '12px', color: 'hsl(var(--foreground))', outline: 'none', direction: 'rtl', cursor: 'pointer' }}>
                <option value="الكل">كل الفئات</option>
                {Object.entries(CAT_CONFIG).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
              </select>
              <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)}
                style={{ padding: '8px 12px', background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: '8px', fontFamily: 'Alexandria', fontSize: '12px', color: 'hsl(var(--foreground))', outline: 'none', direction: 'rtl', cursor: 'pointer' }}>
                <option value="الكل">كل الحالات</option>
                <option value="مجدولة">🔵 مجدولة</option>
                <option value="جارية">🟢 جارية</option>
                <option value="منتهية">⚪ منتهية</option>
              </select>
            </div>

            {/* Table */}
            <div style={{ overflowX: 'auto', borderRadius: '10px', border: '1px solid hsl(var(--border))' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: 'Alexandria', direction: 'rtl', minWidth: '680px' }}>
                <thead>
                  <tr style={{ background: 'hsl(var(--card))', borderBottom: '1px solid hsl(var(--muted))' }}>
                    <th style={{ padding: '11px 14px', textAlign: 'center', fontSize: '11px', fontWeight: 700, color: 'hsl(var(--muted-foreground))', width: '44px' }}>#</th>
                    <th onClick={() => toggleSort('name')} style={{ padding: '11px 14px', textAlign: 'right', fontSize: '11px', fontWeight: 700, color: 'hsl(var(--muted-foreground))', cursor: 'pointer', userSelect: 'none' }}>
                      <span className="flex items-center gap-1">اسم الفعالية <SortBtn field="name" /></span>
                    </th>
                    <th onClick={() => toggleSort('month')} style={{ padding: '11px 14px', textAlign: 'right', fontSize: '11px', fontWeight: 700, color: 'hsl(var(--muted-foreground))', cursor: 'pointer', userSelect: 'none', width: '90px' }}>
                      <span className="flex items-center gap-1">الشهر <SortBtn field="month" /></span>
                    </th>
                    <th style={{ padding: '11px 14px', textAlign: 'right', fontSize: '11px', fontWeight: 700, color: 'hsl(var(--muted-foreground))', width: '130px' }}>الفئة</th>
                    <th style={{ padding: '11px 14px', textAlign: 'right', fontSize: '11px', fontWeight: 700, color: 'hsl(var(--muted-foreground))', width: '100px' }}>الحالة</th>
                    <th onClick={() => toggleSort('budget')} style={{ padding: '11px 14px', textAlign: 'left', fontSize: '11px', fontWeight: 700, color: 'hsl(var(--muted-foreground))', cursor: 'pointer', userSelect: 'none', width: '120px' }}>
                      <span className="flex items-center gap-1 justify-end">الميزانية <SortBtn field="budget" /></span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((event, idx) => {
                    const catCfg = CAT_CONFIG[event.category] || CAT_CONFIG.C;
                    const dynamicStatus = getEventStatus(event);
                    const statusCfg = STATUS_CONFIG[dynamicStatus] || STATUS_CONFIG["مجدولة"];
                    const StatusIcon = statusCfg.icon;
                    return (
                      <tr key={idx} onClick={() => setSelectedEvent(event)}
                        style={{ borderBottom: '1px solid hsl(var(--muted))', cursor: 'pointer', transition: 'background 0.12s' }}
                        onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'hsl(var(--card))'; }}
                        onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = ''; }}>
                        <td style={{ padding: '10px 14px', fontSize: '11px', color: 'hsl(var(--muted-foreground))', textAlign: 'center' }}>{idx + 1}</td>
                        <td style={{ padding: '10px 14px' }}>
                          <div className="flex items-center gap-2">
                            <div style={{ width: '6px', height: '6px', borderRadius: '50%', background: catCfg.color, flexShrink: 0 }} />
                            <span style={{ fontSize: '13px', fontWeight: 600, color: 'hsl(var(--foreground))' }}>{event.name}</span>
                          </div>
                        </td>
                        <td style={{ padding: '10px 14px', fontSize: '12px', color: '#1FA98C', fontWeight: 600 }}>{event.month}</td>
                        <td style={{ padding: '10px 14px' }}>
                          <span style={{ display: 'inline-block', padding: '3px 10px', borderRadius: '20px', background: catCfg.bg, border: `1px solid ${catCfg.color}40`, color: catCfg.color, fontSize: '10px', fontWeight: 700, whiteSpace: 'nowrap' }}>
                            {catCfg.label}
                          </span>
                        </td>
                        <td style={{ padding: '10px 14px' }}>
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', padding: '3px 10px', borderRadius: '20px', background: statusCfg.bg, border: `1px solid ${statusCfg.color}40`, color: statusCfg.color, fontSize: '10px', fontWeight: 700, whiteSpace: 'nowrap' }}>
                            <StatusIcon size={9} />{dynamicStatus}
                          </span>
                        </td>
                        <td style={{ padding: '10px 14px', textAlign: 'left' }}>
                          {event.budget && event.budget > 0
                            ? <span style={{ fontSize: '12px', fontWeight: 700, color: '#F59E0B' }}>{event.budget.toLocaleString('ar-SA')} ر.س</span>
                            : <span style={{ fontSize: '11px', color: 'hsl(var(--border))' }}>—</span>
                          }
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr style={{ background: 'hsl(var(--card))', borderTop: '2px solid hsl(var(--border))' }}>
                    <td colSpan={5} style={{ padding: '11px 14px', fontSize: '12px', fontWeight: 700, color: 'hsl(var(--muted-foreground))' }}>
                      الإجمالي ({filtered.length} فعالية)
                    </td>
                    <td style={{ padding: '11px 14px', textAlign: 'left', fontSize: '13px', fontWeight: 800, color: '#F59E0B' }}>
                      {filteredTotal > 0 ? `${filteredTotal.toLocaleString('ar-SA')} ر.س` : '—'}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>

            {filtered.length === 0 && (
              <div style={{ textAlign: 'center', padding: '48px', fontFamily: 'Alexandria', fontSize: '14px', color: 'hsl(var(--muted-foreground))' }}>
                لا توجد فعاليات تطابق البحث
              </div>
            )}
          </div>

          {/* Budget Note */}
          <div style={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: '12px', padding: '14px 18px', fontFamily: 'Alexandria', direction: 'rtl', display: 'flex', gap: '12px', alignItems: 'flex-start' }}>
            <Trophy size={16} color="#F59E0B" style={{ flexShrink: 0, marginTop: '2px' }} />
            <div>
              <div style={{ fontSize: '12px', fontWeight: 700, color: '#F59E0B', marginBottom: '4px' }}>ملاحظة الميزانية</div>
              <p style={{ fontSize: '11px', color: 'hsl(var(--muted-foreground))', lineHeight: 1.7 }}>
                الإجمالي بدون يوم التأسيس: <strong style={{ color: 'hsl(var(--muted-foreground))' }}>106,900 ر.س</strong>
                {' '}— تم تحديد هذه الأرقام وفق خبرة بأسعار السوق، ويلتزم فريق التواصل الداخلي بعدم تجاوزها إلا بموافقة خطية مسبقة، مع السعي لخفض التكاليف لما فيه منفعة الشركة.
              </p>
            </div>
          </div>
        </>
      )}

      {/* ── Initiatives Tab (مبادرات 2026) ──────────────────────────────── */}
      {activeTab === 'initiatives' && (
        <div className="card-brand rounded-xl p-5">
          <div className="flex items-center gap-3 mb-5">
            <div style={{ width: '32px', height: '32px', borderRadius: '9px', background: '#1FA98C20', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Rocket size={15} color="#1FA98C" />
            </div>
            <div>
              <div className="section-title">مبادرات 2026</div>
              <p style={{ fontFamily: 'Alexandria', fontSize: '11px', color: 'hsl(var(--muted-foreground))', marginTop: '1px' }}>
                {INITIATIVES_RAW.length} مبادرة موزعة على مدار العام — من ورقة "مبادارات 2026"
              </p>
            </div>
          </div>
          <InitiativesTab />
        </div>
      )}

      {/* Engagement Hub Tab */}
      {activeTab === 'hub' && (
        <EngagementHubContent />
      )}

      {/* Surveys Tab */}
      {activeTab === 'surveys' && (
        <SurveysContent />
      )}
    </div>
  );
}
