/**
 * PrivacyConsent.tsx — PDPL Privacy Notice, Consent Management & Data Subject Rights
 * Implements:
 * - Privacy notice display (Arabic, aligned with Saudi PDPL)
 * - Electronic consent mechanism
 * - Data Subject Access Request (DSAR) submission
 * - Consent history view
 */
import { useState } from "react";
import { Shield, FileText, CheckCircle2, Clock, AlertTriangle, Send, Eye, Download, Trash2, Edit3 } from "lucide-react";
import { useConsent, useDsar } from "@/hooks/useHcmData";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";

const peoplePrimary = "hsl(var(--primary))";
const peoplePrimarySoft = "hsl(var(--primary) / 0.12)";
const cardSurface = "hsl(var(--card))";
const mutedSurface = "hsl(var(--muted))";
const borderColor = "hsl(var(--border))";
const foreground = "hsl(var(--foreground))";
const mutedText = "hsl(var(--muted-foreground))";

// ── Privacy Notice Content (PDPL-compliant) ──────────────────────────────────
const PRIVACY_NOTICE = {
  version: "1.0",
  lastUpdated: "2025-02-01",
  sections: [
    {
      title: "نطاق الإشعار",
      content: "يوضح هذا الإشعار كيفية جمع ومعالجة وحماية البيانات الشخصية للموظفين في شركة ثري سكستي ديجري ماركتنج (3,6T) وفقاً لنظام حماية البيانات الشخصية (PDPL) في المملكة العربية السعودية."
    },
    {
      title: "البيانات المجمعة",
      content: "نقوم بجمع ومعالجة البيانات التالية: الاسم الكامل، رقم الهوية الوطنية، تاريخ الميلاد، الجنسية، الحالة الاجتماعية، المؤهل العلمي، المسمى الوظيفي، بيانات الحضور والانصراف، بيانات الرواتب والتأمينات، تقييمات الأداء، وبيانات الإجازات."
    },
    {
      title: "أغراض المعالجة",
      content: "تتم معالجة بياناتك الشخصية للأغراض التالية: إدارة عقد العمل وعلاقة التوظيف، احتساب الرواتب والمستحقات، إدارة الحضور والإجازات، تقييم الأداء والتطوير المهني، الامتثال للأنظمة واللوائح الحكومية (التأمينات الاجتماعية، مكتب العمل)، وتحسين بيئة العمل."
    },
    {
      title: "الأساس القانوني",
      content: "تستند معالجة بياناتك إلى: تنفيذ عقد العمل (المادة 6 من PDPL)، الالتزام بالمتطلبات النظامية (نظام العمل، التأمينات الاجتماعية)، والمصلحة المشروعة لصاحب العمل في إدارة الموارد البشرية بكفاءة."
    },
    {
      title: "مدة الاحتفاظ",
      content: "يتم الاحتفاظ ببياناتك طوال فترة علاقة العمل، ولمدة 5 سنوات بعد انتهاء العلاقة التعاقدية وفقاً لمتطلبات نظام العمل السعودي. بعد انتهاء مدة الاحتفاظ، يتم حذف البيانات أو إخفاء هويتها بشكل لا رجعة فيه."
    },
    {
      title: "حقوقك",
      content: "بموجب نظام حماية البيانات الشخصية، يحق لك: الاطلاع على بياناتك الشخصية، طلب تصحيح البيانات غير الدقيقة، طلب حذف البيانات (مع مراعاة الالتزامات القانونية)، طلب نقل البيانات إلى جهة أخرى، والاعتراض على المعالجة في حالات محددة."
    },
    {
      title: "أمن البيانات",
      content: "نطبق إجراءات أمنية تقنية وتنظيمية لحماية بياناتك، تشمل: التشفير أثناء النقل والتخزين، التحكم في الوصول بناءً على الأدوار، تسجيل جميع عمليات الوصول، والنسخ الاحتياطي المنتظم."
    },
    {
      title: "الإفصاح لأطراف ثالثة",
      content: "لا يتم مشاركة بياناتك مع أطراف ثالثة إلا في الحالات التالية: الجهات الحكومية (التأمينات الاجتماعية، مكتب العمل) بموجب التزام قانوني، ومقدمي الخدمات المعتمدين (مثل نظام الرواتب) بموجب اتفاقيات حماية بيانات."
    },
    {
      title: "التواصل",
      content: "لأي استفسارات تتعلق بخصوصية بياناتك أو لممارسة حقوقك، يمكنك التواصل مع قسم الموارد البشرية أو تقديم طلب عبر نظام حقوق أصحاب البيانات أدناه."
    },
  ]
};

// ── DSAR Request Types ───────────────────────────────────────────────────────
const DSAR_TYPES = [
  { value: "access", label: "طلب الاطلاع على البيانات", icon: Eye, description: "الحصول على نسخة من جميع بياناتك الشخصية المحفوظة" },
  { value: "correction", label: "طلب تصحيح البيانات", icon: Edit3, description: "تصحيح بيانات شخصية غير دقيقة أو غير مكتملة" },
  { value: "deletion", label: "طلب حذف البيانات", icon: Trash2, description: "حذف بياناتك الشخصية (مع مراعاة الالتزامات القانونية)" },
  { value: "portability", label: "طلب نقل البيانات", icon: Download, description: "الحصول على بياناتك بصيغة قابلة للقراءة الآلية" },
];

const STATUS_LABELS: Record<string, { label: string; color: string; icon: any }> = {
  pending: { label: "قيد الانتظار", color: "#F59E0B", icon: Clock },
  in_progress: { label: "قيد المعالجة", color: "#3B82F6", icon: Clock },
  completed: { label: "مكتمل", color: "#22C55E", icon: CheckCircle2 },
  rejected: { label: "مرفوض", color: "#EF4444", icon: AlertTriangle },
};

export default function PrivacyConsent() {
  const { user } = useAuth();
  const { consent, loading: consentLoading, giveConsent, revokeConsent } = useConsent();
  const { data: dsarRequests, loading: dsarLoading, createRequest, updateRequest } = useDsar();
  const [activeTab, setActiveTab] = useState<"notice" | "consent" | "rights" | "admin">("notice");
  const [dsarType, setDsarType] = useState("");
  const [dsarDescription, setDsarDescription] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const isAdmin = user?.role === "owner" || user?.role === "admin";

  const handleGiveConsent = async () => {
    try {
      setSubmitting(true);
      await giveConsent("data_processing", PRIVACY_NOTICE.version);
      toast.success("تم تسجيل موافقتك بنجاح");
    } catch {
      toast.error("حدث خطأ أثناء تسجيل الموافقة");
    } finally {
      setSubmitting(false);
    }
  };

  const handleRevokeConsent = async () => {
    if (!confirm("هل أنت متأكد من سحب موافقتك؟ قد يؤثر ذلك على بعض الخدمات.")) return;
    try {
      setSubmitting(true);
      await revokeConsent("data_processing", PRIVACY_NOTICE.version);
      toast.success("تم سحب الموافقة");
    } catch {
      toast.error("حدث خطأ أثناء سحب الموافقة");
    } finally {
      setSubmitting(false);
    }
  };

  const handleSubmitDsar = async () => {
    if (!dsarType) { toast.error("يرجى اختيار نوع الطلب"); return; }
    if (!dsarDescription.trim()) { toast.error("يرجى وصف طلبك"); return; }
    try {
      setSubmitting(true);
      await createRequest(dsarType, dsarDescription);
      toast.success("تم تقديم طلبك بنجاح. سيتم الرد خلال 30 يوماً.");
      setDsarType("");
      setDsarDescription("");
    } catch {
      toast.error("حدث خطأ أثناء تقديم الطلب");
    } finally {
      setSubmitting(false);
    }
  };

  const handleUpdateDsar = async (id: number, status: string, notes?: string) => {
    try {
      await updateRequest(id, status, notes);
      toast.success("تم تحديث حالة الطلب");
    } catch {
      toast.error("حدث خطأ أثناء التحديث");
    }
  };

  const tabs = [
    { id: "notice" as const, label: "إشعار الخصوصية", icon: FileText },
    { id: "consent" as const, label: "الموافقة الإلكترونية", icon: CheckCircle2 },
    { id: "rights" as const, label: "حقوق البيانات", icon: Shield },
    ...(isAdmin ? [{ id: "admin" as const, label: "إدارة الطلبات", icon: Clock }] : []),
  ];

  return (
    <div className="p-6 space-y-6" style={{ fontFamily: "Alexandria, system-ui, sans-serif" }}>
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <div style={{ width: 48, height: 48, borderRadius: 12, background: peoplePrimarySoft, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <Shield size={24} style={{ color: peoplePrimary }} />
        </div>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 800, color: foreground }}>الخصوصية وحماية البيانات</h1>
          <p style={{ fontSize: 13, color: mutedText }}>إدارة موافقتك وحقوقك وفقاً لنظام حماية البيانات الشخصية (PDPL)</p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 flex-wrap" style={{ borderBottom: `1px solid ${borderColor}`, paddingBottom: 8 }}>
        {tabs.map(tab => {
          const Icon = tab.icon;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className="flex items-center gap-2 px-4 py-2 rounded-lg transition-colors"
              style={{
                background: activeTab === tab.id ? peoplePrimarySoft : "transparent",
                color: activeTab === tab.id ? peoplePrimary : mutedText,
                border: "none",
                cursor: "pointer",
                fontSize: 13,
                fontWeight: activeTab === tab.id ? 700 : 500,
                fontFamily: "Alexandria",
              }}
            >
              <Icon size={16} />
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* Tab Content */}
      {activeTab === "notice" && (
        <div className="space-y-4">
          <div style={{ background: cardSurface, borderRadius: 12, padding: 24, border: `1px solid ${borderColor}` }}>
            <div className="flex items-center justify-between mb-4">
              <h2 style={{ fontSize: 18, fontWeight: 700, color: peoplePrimary }}>إشعار الخصوصية</h2>
              <span style={{ fontSize: 11, color: mutedText, background: mutedSurface, padding: "4px 10px", borderRadius: 6 }}>
                الإصدار {PRIVACY_NOTICE.version} — آخر تحديث: {PRIVACY_NOTICE.lastUpdated}
              </span>
            </div>
            <div className="space-y-5">
              {PRIVACY_NOTICE.sections.map((section, idx) => (
                <div key={idx}>
                  <h3 style={{ fontSize: 14, fontWeight: 700, color: foreground, marginBottom: 6 }}>
                    {idx + 1}. {section.title}
                  </h3>
                  <p style={{ fontSize: 13, color: mutedText, lineHeight: 1.8, textAlign: "justify" }}>
                    {section.content}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {activeTab === "consent" && (
        <div className="space-y-4">
          {/* Current consent status */}
          <div style={{ background: cardSurface, borderRadius: 12, padding: 24, border: `1px solid ${borderColor}` }}>
            <h2 style={{ fontSize: 16, fontWeight: 700, color: foreground, marginBottom: 16 }}>حالة الموافقة</h2>
            
            {consentLoading ? (
              <div style={{ textAlign: "center", padding: 20, color: "hsl(var(--muted-foreground))" }}>جاري التحميل...</div>
            ) : (
              <>
                <div className="flex items-center gap-3 mb-6" style={{ padding: 16, borderRadius: 10, background: consent?.hasActiveConsent ? "rgba(34,197,94,0.08)" : "rgba(245,158,11,0.08)", border: `1px solid ${consent?.hasActiveConsent ? "rgba(34,197,94,0.3)" : "rgba(245,158,11,0.3)"}` }}>
                  {consent?.hasActiveConsent ? (
                    <CheckCircle2 size={24} style={{ color: "#22C55E" }} />
                  ) : (
                    <AlertTriangle size={24} style={{ color: "#F59E0B" }} />
                  )}
                  <div>
                    <p style={{ fontSize: 14, fontWeight: 700, color: consent?.hasActiveConsent ? "#22C55E" : "#F59E0B" }}>
                      {consent?.hasActiveConsent ? "الموافقة نشطة" : "لم يتم تسجيل الموافقة بعد"}
                    </p>
                    <p style={{ fontSize: 12, color: "hsl(var(--muted-foreground))" }}>
                      {consent?.hasActiveConsent
                        ? "لقد وافقت على سياسة معالجة البيانات الشخصية"
                        : "يرجى مراجعة إشعار الخصوصية وتسجيل موافقتك"}
                    </p>
                  </div>
                </div>

                {/* Consent action */}
                <div style={{ background: mutedSurface, borderRadius: 10, padding: 20, border: `1px solid ${borderColor}` }}>
                  <p style={{ fontSize: 13, color: mutedText, lineHeight: 1.8, marginBottom: 16 }}>
                    بالنقر على "أوافق"، أقر بأنني قرأت وفهمت إشعار الخصوصية أعلاه، وأوافق على معالجة بياناتي الشخصية للأغراض المذكورة فيه. يمكنني سحب موافقتي في أي وقت.
                  </p>
                  <div className="flex gap-3">
                    {!consent?.hasActiveConsent ? (
                      <button
                        onClick={handleGiveConsent}
                        disabled={submitting}
                        style={{
                          background: peoplePrimary, color: "hsl(var(--primary-foreground))", border: "none", borderRadius: 8,
                          padding: "10px 24px", fontSize: 14, fontWeight: 700, fontFamily: "Alexandria",
                          cursor: submitting ? "not-allowed" : "pointer", opacity: submitting ? 0.6 : 1,
                        }}
                      >
                        <span className="flex items-center gap-2">
                          <CheckCircle2 size={16} />
                          أوافق على معالجة بياناتي
                        </span>
                      </button>
                    ) : (
                      <button
                        onClick={handleRevokeConsent}
                        disabled={submitting}
                        style={{
                          background: "transparent", color: "#EF4444", border: "1px solid #EF4444", borderRadius: 8,
                          padding: "10px 24px", fontSize: 14, fontWeight: 600, fontFamily: "Alexandria",
                          cursor: submitting ? "not-allowed" : "pointer", opacity: submitting ? 0.6 : 1,
                        }}
                      >
                        سحب الموافقة
                      </button>
                    )}
                  </div>
                </div>

                {/* Consent history */}
                {consent?.consents && consent.consents.length > 0 && (
                  <div style={{ marginTop: 20 }}>
                    <h3 style={{ fontSize: 14, fontWeight: 700, color: foreground, marginBottom: 10 }}>سجل الموافقات</h3>
                    <div className="space-y-2">
                      {consent.consents.map((c: any, idx: number) => (
                        <div key={idx} className="flex items-center justify-between" style={{ padding: "8px 12px", borderRadius: 8, background: "hsl(var(--background))", fontSize: 12 }}>
                          <span style={{ color: c.consented ? "#22C55E" : "#EF4444" }}>
                            {c.consented ? "✓ موافقة" : "✗ سحب موافقة"}
                          </span>
                          <span style={{ color: "hsl(var(--muted-foreground))" }}>
                            {c.consented_at ? new Date(c.consented_at).toLocaleString("ar-SA-u-ca-gregory") : "—"}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}

      {activeTab === "rights" && (
        <div className="space-y-4">
          {/* DSAR submission form */}
          <div style={{ background: cardSurface, borderRadius: 12, padding: 24, border: `1px solid ${borderColor}` }}>
            <h2 style={{ fontSize: 16, fontWeight: 700, color: foreground, marginBottom: 6 }}>تقديم طلب حقوق البيانات</h2>
            <p style={{ fontSize: 12, color: mutedText, marginBottom: 20 }}>
              يحق لك ممارسة حقوقك بموجب نظام حماية البيانات الشخصية. سيتم الرد على طلبك خلال 30 يوماً كحد أقصى.
            </p>

            {/* Request type selection */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-4">
              {DSAR_TYPES.map(type => {
                const Icon = type.icon;
                return (
                  <button
                    key={type.value}
                    onClick={() => setDsarType(type.value)}
                    className="text-right p-4 rounded-lg transition-all"
                    style={{
                      background: dsarType === type.value ? peoplePrimarySoft : mutedSurface,
                      border: `1px solid ${dsarType === type.value ? peoplePrimary : borderColor}`,
                      cursor: "pointer",
                    }}
                  >
                    <div className="flex items-center gap-2 mb-1">
                      <Icon size={16} style={{ color: dsarType === type.value ? peoplePrimary : mutedText }} />
                      <span style={{ fontSize: 13, fontWeight: 700, color: dsarType === type.value ? peoplePrimary : foreground }}>
                        {type.label}
                      </span>
                    </div>
                    <p style={{ fontSize: 11, color: "hsl(var(--muted-foreground))", margin: 0 }}>{type.description}</p>
                  </button>
                );
              })}
            </div>

            {/* Description */}
            <div style={{ marginBottom: 16 }}>
              <label style={{ fontSize: 12, fontWeight: 600, color: "hsl(var(--muted-foreground))", display: "block", marginBottom: 6 }}>
                وصف الطلب *
              </label>
              <textarea
                value={dsarDescription}
                onChange={e => setDsarDescription(e.target.value)}
                placeholder="اشرح طلبك بالتفصيل..."
                rows={4}
                style={{
                  width: "100%", background: "hsl(var(--background))", border: "1px solid hsl(var(--border))",
                  borderRadius: 8, padding: 12, fontSize: 13, color: "hsl(var(--foreground))",
                  fontFamily: "Alexandria", resize: "vertical", direction: "rtl",
                }}
              />
            </div>

            <button
              onClick={handleSubmitDsar}
              disabled={submitting || !dsarType || !dsarDescription.trim()}
              style={{
                background: peoplePrimary, color: "hsl(var(--primary-foreground))", border: "none", borderRadius: 8,
                padding: "10px 24px", fontSize: 14, fontWeight: 700, fontFamily: "Alexandria",
                cursor: (submitting || !dsarType || !dsarDescription.trim()) ? "not-allowed" : "pointer",
                opacity: (submitting || !dsarType || !dsarDescription.trim()) ? 0.5 : 1,
              }}
            >
              <span className="flex items-center gap-2">
                <Send size={16} />
                تقديم الطلب
              </span>
            </button>
          </div>

          {/* My requests history */}
          <div style={{ background: "hsl(var(--card))", borderRadius: 12, padding: 24, border: "1px solid hsl(var(--border))" }}>
            <h2 style={{ fontSize: 16, fontWeight: 700, color: "hsl(var(--foreground))", marginBottom: 16 }}>طلباتي السابقة</h2>
            {dsarLoading ? (
              <div style={{ textAlign: "center", padding: 20, color: "hsl(var(--muted-foreground))" }}>جاري التحميل...</div>
            ) : !dsarRequests || dsarRequests.length === 0 ? (
              <div style={{ textAlign: "center", padding: 30, color: "hsl(var(--muted-foreground))" }}>
                <Shield size={32} style={{ margin: "0 auto 8px", opacity: 0.4 }} />
                <p>لا توجد طلبات سابقة</p>
              </div>
            ) : (
              <div className="space-y-3">
                {dsarRequests.map((req: any) => {
                  const status = STATUS_LABELS[req.status] || STATUS_LABELS.pending;
                  const StatusIcon = status.icon;
                  const typeInfo = DSAR_TYPES.find(t => t.value === req.request_type);
                  return (
                    <div key={req.id} style={{ padding: 14, borderRadius: 10, background: "hsl(var(--background))", border: "1px solid hsl(var(--muted))" }}>
                      <div className="flex items-center justify-between mb-2">
                        <span style={{ fontSize: 13, fontWeight: 700, color: "hsl(var(--foreground))" }}>
                          {typeInfo?.label || req.request_type}
                        </span>
                        <span className="flex items-center gap-1" style={{ fontSize: 11, color: status.color }}>
                          <StatusIcon size={12} />
                          {status.label}
                        </span>
                      </div>
                      <p style={{ fontSize: 12, color: "hsl(var(--muted-foreground))", margin: "4px 0" }}>{req.description}</p>
                      <div className="flex items-center justify-between" style={{ marginTop: 8 }}>
                        <span style={{ fontSize: 10, color: "hsl(var(--muted-foreground))" }}>
                          {req.requested_at ? new Date(req.requested_at).toLocaleString("ar-SA-u-ca-gregory") : ""}
                        </span>
                        {req.response_notes && (
                          <span style={{ fontSize: 11, color: "hsl(var(--muted-foreground))" }}>الرد: {req.response_notes}</span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {activeTab === "admin" && isAdmin && (
        <div className="space-y-4">
          <div style={{ background: "hsl(var(--card))", borderRadius: 12, padding: 24, border: "1px solid hsl(var(--border))" }}>
            <h2 style={{ fontSize: 16, fontWeight: 700, color: "hsl(var(--foreground))", marginBottom: 16 }}>إدارة طلبات حقوق البيانات</h2>
            <p style={{ fontSize: 12, color: "hsl(var(--muted-foreground))", marginBottom: 16 }}>
              يجب الرد على جميع الطلبات خلال 30 يوماً وفقاً لنظام PDPL.
            </p>
            {dsarLoading ? (
              <div style={{ textAlign: "center", padding: 20, color: "hsl(var(--muted-foreground))" }}>جاري التحميل...</div>
            ) : !dsarRequests || dsarRequests.length === 0 ? (
              <div style={{ textAlign: "center", padding: 30, color: "hsl(var(--muted-foreground))" }}>
                <CheckCircle2 size={32} style={{ margin: "0 auto 8px", opacity: 0.4 }} />
                <p>لا توجد طلبات معلقة</p>
              </div>
            ) : (
              <div className="space-y-3">
                {dsarRequests.map((req: any) => {
                  const status = STATUS_LABELS[req.status] || STATUS_LABELS.pending;
                  const StatusIcon = status.icon;
                  const typeInfo = DSAR_TYPES.find(t => t.value === req.request_type);
                  return (
                    <div key={req.id} style={{ padding: 16, borderRadius: 10, background: "hsl(var(--background))", border: "1px solid hsl(var(--muted))" }}>
                      <div className="flex items-center justify-between mb-2">
                        <div>
                          <span style={{ fontSize: 13, fontWeight: 700, color: "hsl(var(--foreground))" }}>
                            {typeInfo?.label || req.request_type}
                          </span>
                          <span style={{ fontSize: 11, color: "hsl(var(--muted-foreground))", marginRight: 8 }}>
                            — الموظف: {req.employee_id}
                          </span>
                        </div>
                        <span className="flex items-center gap-1" style={{ fontSize: 11, color: status.color }}>
                          <StatusIcon size={12} />
                          {status.label}
                        </span>
                      </div>
                      <p style={{ fontSize: 12, color: "hsl(var(--muted-foreground))", margin: "4px 0" }}>{req.description}</p>
                      {req.status === "pending" && (
                        <div className="flex gap-2 mt-3">
                          <button
                            onClick={() => handleUpdateDsar(req.id, "in_progress", "جاري المعالجة")}
                            style={{ background: "#3B82F6", color: "white", border: "none", borderRadius: 6, padding: "6px 14px", fontSize: 11, fontWeight: 600, fontFamily: "Alexandria", cursor: "pointer" }}
                          >
                            بدء المعالجة
                          </button>
                          <button
                            onClick={() => {
                              const notes = prompt("ملاحظات الرد:");
                              if (notes) handleUpdateDsar(req.id, "completed", notes);
                            }}
                            style={{ background: "#22C55E", color: "white", border: "none", borderRadius: 6, padding: "6px 14px", fontSize: 11, fontWeight: 600, fontFamily: "Alexandria", cursor: "pointer" }}
                          >
                            إكمال
                          </button>
                          <button
                            onClick={() => {
                              const notes = prompt("سبب الرفض:");
                              if (notes) handleUpdateDsar(req.id, "rejected", notes);
                            }}
                            style={{ background: "#EF4444", color: "white", border: "none", borderRadius: 6, padding: "6px 14px", fontSize: 11, fontWeight: 600, fontFamily: "Alexandria", cursor: "pointer" }}
                          >
                            رفض
                          </button>
                        </div>
                      )}
                      {req.status === "in_progress" && (
                        <div className="flex gap-2 mt-3">
                          <button
                            onClick={() => {
                              const notes = prompt("ملاحظات الإكمال:");
                              if (notes) handleUpdateDsar(req.id, "completed", notes);
                            }}
                            style={{ background: "#22C55E", color: "white", border: "none", borderRadius: 6, padding: "6px 14px", fontSize: 11, fontWeight: 600, fontFamily: "Alexandria", cursor: "pointer" }}
                          >
                            إكمال الطلب
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
