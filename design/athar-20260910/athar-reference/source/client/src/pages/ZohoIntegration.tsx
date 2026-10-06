/**
 * Zoho People Integration Page
 * Design: Dark theme matching HCM platform — teal accent, Alexandria font
 * Allows connecting/disconnecting Zoho People and viewing synced data + sync log
 */

import { useState, useEffect, useCallback } from "react";
import {
  RefreshCw, Link2, Link2Off, CheckCircle2, XCircle,
  Users, Clock, CalendarDays, Loader2, ExternalLink,
  AlertTriangle, History, Play, BellRing, Key, Bug
} from "lucide-react";
import { toast } from "sonner";

interface ZohoStatus { connected: boolean; }

interface SyncData {
  attendance?: any;
  leaveRequests?: any;
  leaveBalance?: any;
  syncedAt?: string;
  error?: string;
}

interface SyncLogEntry {
  id: string;
  startedAt: string;
  finishedAt: string;
  status: "success" | "failed" | "skipped";
  attendanceCount: number;
  leaveRequestsCount: number;
  leaveBalanceCount: number;
  error?: string;
  triggeredBy: "auto" | "manual";
}

interface ZohoCutoverReadiness {
  canDisconnect: boolean;
  requirements: {
    completedArchive: boolean;
    archiveVerified: boolean;
    backupVerified: boolean;
    restoreTested: boolean;
  };
}

export default function ZohoIntegration() {
  const [status, setStatus] = useState<ZohoStatus | null>(null);
  const [syncData, setSyncData] = useState<SyncData | null>(null);
  const [syncLog, setSyncLog] = useState<SyncLogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [tokenInfo, setTokenInfo] = useState<any>(null);
  const [showToken, setShowToken] = useState(false);
  const [debugInfo, setDebugInfo] = useState<any>(null);
  const [showDebug, setShowDebug] = useState(false);
  const [showManualToken, setShowManualToken] = useState(false);
  const [manualToken, setManualToken] = useState("");
  const [savingToken, setSavingToken] = useState(false);
  const [cutoverReadiness, setCutoverReadiness] = useState<ZohoCutoverReadiness | null>(null);

  const handleShowToken = async () => {
    try {
      const res = await fetch("/api/zoho/token-info", { credentials: "include" });
      if (res.status === 403) {
        toast.error("ليس لديك صلاحية عرض الـ Refresh Token");
        return;
      }
      if (res.status === 401) {
        toast.error("انتهت جلستك. يرجى تسجيل الدخول مجدداً.");
        return;
      }
      const data = await res.json();
      setTokenInfo(data);
      setShowToken(true);
    } catch {
      toast.error("تعذّر جلب معلومات التوكن");
    }
  };

  const handleSaveManualToken = async () => {
    if (!manualToken.trim() || manualToken.trim().length < 10) {
      toast.error("الـ Refresh Token غير صالح");
      return;
    }
    setSavingToken(true);
    try {
      const res = await fetch("/api/zoho/set-token", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refresh_token: manualToken.trim() }),
      });
      const data = await res.json();
      if (data.success) {
        toast.success("تم حفظ الـ Refresh Token بنجاح! جارٍ التحقق من الاتصال...");
        setManualToken("");
        setShowManualToken(false);
        await checkStatus();
      } else {
        toast.error(data.error || "فشل حفظ الـ Refresh Token");
      }
    } catch {
      toast.error("حدث خطأ أثناء حفظ الـ Refresh Token");
    } finally {
      setSavingToken(false);
    }
  };

  const handleDebug = async () => {
    try {
      const res = await fetch("/api/zoho/debug", { credentials: "include" });
      const data = await res.json();
      setDebugInfo(data);
      setShowDebug(true);
    } catch {
      toast.error("تعذّر جلب معلومات التشخيص");
    }
  };

  const checkStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/zoho/status", { credentials: "include" });
      const data = await res.json();
      setStatus(data);
    } catch {
      setStatus({ connected: false });
    } finally {
      setLoading(false);
    }
  }, []);

  const loadCutoverReadiness = useCallback(async () => {
    try {
      const res = await fetch("/api/zoho/cutover-readiness", { credentials: "include" });
      if (!res.ok) return;
      setCutoverReadiness(await res.json());
    } catch {
      setCutoverReadiness(null);
    }
  }, []);

  const loadSyncLog = useCallback(async () => {
    try {
      const res = await fetch("/api/zoho/sync/log", { credentials: "include" });
      const data = await res.json();
      if (data.success) setSyncLog(data.log || []);
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    checkStatus();
    loadSyncLog();
    loadCutoverReadiness();

    const handler = (e: MessageEvent) => {
      if (e.origin !== window.location.origin) return;
      if (e.data?.zoho === "success") {
        toast.success("تم الربط مع Zoho People بنجاح!");
        setConnecting(false);
        checkStatus();
      } else if (e.data?.zoho === "error") {
        toast.error(`فشل الربط: ${e.data.msg || "خطأ غير معروف"}`);
        setConnecting(false);
      }
    };
    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, [checkStatus, loadSyncLog, loadCutoverReadiness]);

  const handleConnect = async () => {
    setConnecting(true);
    try {
      // Fetch the Zoho OAuth URL from the server (authenticated endpoint)
      const res = await fetch(`/api/zoho/auth-url?openerOrigin=${encodeURIComponent(window.location.origin)}`, { credentials: "include" });
      if (!res.ok) {
        if (res.status === 401) {
          toast.error("انتهت جلستك. يرجى تسجيل الدخول مجدداً.");
        } else {
          toast.error("تعذّر الحصول على رابط الربط. حاول مرة أخرى.");
        }
        setConnecting(false);
        return;
      }
      const data = await res.json();
      if (!data.url) {
        toast.error("رابط Zoho غير متاح. تحقق من إعدادات ZOHO_CLIENT_ID.");
        setConnecting(false);
        return;
      }
      // Open the Zoho OAuth URL directly in a popup
      const popup = window.open(data.url, "zoho-oauth", "width=600,height=700,scrollbars=yes,resizable=yes");
      if (!popup) {
        toast.error("يرجى السماح بفتح النوافذ المنبثقة في المتصفح");
        setConnecting(false);
      }
    } catch (err: any) {
      toast.error("حدث خطأ: " + (err?.message || "خطأ غير معروف"));
      setConnecting(false);
    }
  };

  const handleDisconnect = async () => {
    const readinessRes = await fetch("/api/zoho/cutover-readiness", { credentials: "include" });
    if (readinessRes.status === 403) {
      toast.error("قطع Zoho محصور بمالك المنصة بعد اعتماد الاستعادة");
      return;
    }
    const readiness = await readinessRes.json();
    if (!readinessRes.ok || !readiness.canDisconnect) {
      toast.error("لا يمكن قطع Zoho قبل اعتماد الأرشيف والنسخة واختبار الاستعادة");
      return;
    }
    if (!confirm("هل أنت متأكد من قطع الربط مع Zoho People؟")) return;
    try {
      const res = await fetch("/api/zoho/disconnect", { method: "POST", credentials: "include" });
      if (!res.ok) throw new Error("قطع الربط غير متاح");
      setStatus({ connected: false });
      setSyncData(null);
      toast.success("تم قطع الربط مع Zoho People");
    } catch {
      toast.error("حدث خطأ أثناء قطع الربط");
    }
  };

  const handleSync = async () => {
    setSyncing(true);
    try {
      // Use the new /run endpoint that logs results
      const res = await fetch("/api/zoho/sync/run", { method: "POST", credentials: "include" });
      const data = await res.json();
      if (data.success) {
        // Also fetch the full summary for stats display
        const summaryRes = await fetch("/api/zoho/sync", { credentials: "include" });
        const summary = await summaryRes.json();
        if (summary.success) setSyncData(summary);
        await loadSyncLog();
        toast.success("تمت المزامنة بنجاح!");
      } else {
        toast.error(data.entry?.error || data.error || "فشلت المزامنة");
        await loadSyncLog();
      }
    } catch (err: any) {
      toast.error("فشلت المزامنة: " + err?.message);
    } finally {
      setSyncing(false);
    }
  };

  const formatTime = (iso?: string) => {
    if (!iso) return "—";
    return new Date(iso).toLocaleString("ar-SA-u-ca-gregory", {
      year: "numeric", month: "short", day: "numeric",
      hour: "2-digit", minute: "2-digit"
    });
  };

  const formatDuration = (start: string, end: string) => {
    const ms = new Date(end).getTime() - new Date(start).getTime();
    if (ms < 1000) return `${ms}ms`;
    return `${(ms / 1000).toFixed(1)}s`;
  };

  const getRecordCount = (data: any): number => {
    if (!data || data.error) return 0;
    if (Array.isArray(data)) return data.length;
    if (data.response?.result) return Array.isArray(data.response.result) ? data.response.result.length : 1;
    if (data.data) return Array.isArray(data.data) ? data.data.length : 1;
    return 0;
  };

  const statusConfig = {
    success: { label: "ناجح", color: "#1FA98C", bg: "hsl(165 69% 39% / 0.12)", icon: "✅" },
    failed: { label: "فشل", color: "#EF4444", bg: "rgba(239,68,68,0.1)", icon: "❌" },
    skipped: { label: "تم التخطي", color: "#F59E0B", bg: "rgba(245,158,11,0.1)", icon: "⏭️" },
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="animate-spin text-[#1FA98C]" size={32} />
      </div>
    );
  }

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6" dir="rtl">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-black" style={{ fontFamily: "Alexandria", color: "hsl(var(--foreground))" }}>
          ربط Zoho People
        </h1>
        <p className="text-sm mt-1" style={{ color: "hsl(var(--muted-foreground))" }}>
          مزامنة تلقائية يومية للحضور والانصراف والإجازات — كل يوم الساعة 7:00 صباحاً
        </p>
      </div>

      {/* Auto-sync info banner */}
      <div
        className="rounded-xl p-4 flex items-center gap-3"
        style={{ background: "hsl(165 69% 39% / 0.08)", border: "1px solid hsl(165 69% 39% / 0.20)" }}
      >
        <BellRing size={18} className="text-[#1FA98C] shrink-0" />
        <div>
          <p className="text-sm font-semibold text-[#1FA98C]">المزامنة التلقائية مفعّلة</p>
          <p className="text-xs mt-0.5" style={{ color: "hsl(var(--muted-foreground))" }}>
            يتم جلب البيانات تلقائياً كل يوم الساعة <strong>7:00 صباحاً</strong> بتوقيت المملكة العربية السعودية
          </p>
        </div>
      </div>

      {/* Connection Card */}
      <div
        className="rounded-2xl p-6 border"
        style={{
          background: "hsl(var(--card))",
          borderColor: status?.connected ? "hsl(165 69% 39% / 0.30)" : "rgba(255,255,255,0.06)"
        }}
      >
        <div className="flex items-center justify-between flex-wrap gap-4">
          <div className="flex items-center gap-4">
            <div
              className="w-14 h-14 rounded-xl flex items-center justify-center text-white font-black text-lg"
              style={{ background: "#E42527" }}
            >
              Z
            </div>
            <div>
              <div className="font-bold text-lg" style={{ fontFamily: "Alexandria", color: "hsl(var(--foreground))" }}>
                Zoho People
              </div>
              <div className="flex items-center gap-2 mt-1">
                {status?.connected ? (
                  <>
                    <CheckCircle2 size={14} className="text-[#1FA98C]" />
                    <span className="text-sm text-[#1FA98C] font-semibold">متصل</span>
                  </>
                ) : (
                  <>
                    <XCircle size={14} style={{ color: "hsl(var(--muted-foreground))" }} />
                    <span className="text-sm" style={{ color: "hsl(var(--muted-foreground))" }}>غير متصل</span>
                  </>
                )}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {status?.connected ? (
              <>
                <button
                  onClick={handleSync}
                  disabled={syncing}
                  className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-bold transition-all"
                  style={{ background: "hsl(165 69% 39% / 0.15)", color: "#1FA98C", border: "1px solid hsl(165 69% 39% / 0.30)" }}
                >
                  <Play size={14} className={syncing ? "hidden" : ""} />
                  <RefreshCw size={14} className={syncing ? "animate-spin" : "hidden"} />
                  {syncing ? "جارٍ المزامنة..." : "مزامنة يدوية"}
                </button>
                <button
                  onClick={handleShowToken}
                  className="flex items-center gap-2 px-3 py-2 rounded-xl text-sm font-bold transition-all"
                  style={{ background: "rgba(234,179,8,0.1)", color: "#EAB308", border: "1px solid rgba(234,179,8,0.2)" }}
                  title="عرض Refresh Token لحفظه في Secrets"
                >
                  <Key size={14} />
                  Refresh Token
                </button>
                <button
                  onClick={handleDebug}
                  className="flex items-center gap-2 px-3 py-2 rounded-xl text-sm font-bold transition-all"
                  style={{ background: "rgba(99,102,241,0.1)", color: "#818CF8", border: "1px solid rgba(99,102,241,0.2)" }}
                  title="تشخيص مشاكل المزامنة"
                >
                  <Bug size={14} />
                  تشخيص
                </button>
                <button
                  onClick={handleDisconnect}
                  className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-bold transition-all"
                  style={{ background: "rgba(239,68,68,0.1)", color: "#EF4444", border: "1px solid rgba(239,68,68,0.2)" }}
                >
                  <Link2Off size={15} />
                  قطع الربط
                </button>
              </>
            ) : (
              <button
                onClick={handleConnect}
                disabled={connecting}
                className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-bold transition-all"
                style={{ background: "#1FA98C", color: "#fff" }}
              >
                {connecting ? <Loader2 size={15} className="animate-spin" /> : <Link2 size={15} />}
                {connecting ? "جارٍ الربط..." : "ربط Zoho People"}
              </button>
            )}
          </div>
        </div>

        {/* Scopes */}
        <div className="mt-4 pt-4" style={{ borderTop: "1px solid rgba(255,255,255,0.06)" }}>
          <p className="text-xs mb-2" style={{ color: "hsl(var(--muted-foreground))" }}>الصلاحيات المطلوبة:</p>
          <div className="flex flex-wrap gap-2">
            {["حضور وانصراف", "طلبات الإجازات", "أرصدة الإجازات", "بيانات الموظفين"].map((scope) => (
              <span
                key={scope}
                className="text-xs px-2.5 py-1 rounded-full"
                style={{ background: "hsl(165 69% 39% / 0.10)", color: "#1FA98C", border: "1px solid hsl(165 69% 39% / 0.20)" }}
              >
                {scope}
              </span>
            ))}
          </div>
        </div>

        {cutoverReadiness && !cutoverReadiness.canDisconnect && (
          <div
            className="mt-4 rounded-xl p-3 text-xs"
            style={{ background: "rgba(245,158,11,0.08)", border: "1px solid rgba(245,158,11,0.22)", color: "hsl(var(--muted-foreground))" }}
          >
            <p className="font-bold text-amber-400 mb-1">الحماية قبل قطع Zoho مفعّلة</p>
            <p>
              يلزم اكتمال الأرشيف ({cutoverReadiness.requirements.completedArchive ? "✓" : "—"}),
              واعتماد النسخة ({cutoverReadiness.requirements.backupVerified ? "✓" : "—"}),
              واختبار الاستعادة ({cutoverReadiness.requirements.restoreTested ? "✓" : "—"}) قبل إتاحة القطع.
            </p>
            <details className="mt-3 rounded-lg p-2" style={{ background: "rgba(0,0,0,0.16)" }}>
              <summary className="cursor-pointer font-semibold text-amber-300">عرض خطوات القبول المؤسسي</summary>
              <ol className="mt-2 list-decimal space-y-1 pr-4 leading-5">
                <li>راجِع اكتمال الأرشيف التاريخي وبيانات التحقق.</li>
                <li>نزّل نسخة مملوكة واحفظها في تخزين المؤسسة المقيّد.</li>
                <li>استعد النسخة في بيئة منفصلة واختبر الدخول والحضور والإجازات.</li>
                <li>وثّق نتيجة الاختبار للمالك؛ لا يتم قطع Zoho تلقائياً.</li>
              </ol>
            </details>
          </div>
        )}
      </div>

      {/* Not connected guide */}
      {!status?.connected && (
        <div className="flex flex-col gap-3">
          <div
            className="rounded-xl p-4 flex items-start gap-3"
            style={{ background: "rgba(245,158,11,0.08)", border: "1px solid rgba(245,158,11,0.2)" }}
          >
            <AlertTriangle size={18} className="text-amber-400 mt-0.5 shrink-0" />
            <div className="flex-1">
              <p className="text-sm font-semibold text-amber-400">كيفية الربط</p>
              <p className="text-xs mt-1" style={{ color: "hsl(var(--muted-foreground))", lineHeight: 1.8 }}>
                1. اضغط على زر "ربط Zoho People" أعلاه<br />
                2. سيفتح نافذة تسجيل دخول Zoho<br />
                3. سجّل الدخول بحساب Zoho People الخاص بمنظمتك<br />
                4. اقبل الصلاحيات المطلوبة<br />
                5. ستعود تلقائياً وتبدأ المزامنة
              </p>
              <button
                onClick={() => setShowManualToken(!showManualToken)}
                className="mt-3 text-xs flex items-center gap-1.5"
                style={{ color: "#EAB308" }}
              >
                <Key size={12} />
                لديك Refresh Token مسبقاً؟ أدخله هنا
              </button>
              {showManualToken && (
                <div className="mt-3 flex flex-col gap-2">
                  <input
                    type="text"
                    value={manualToken}
                    onChange={e => setManualToken(e.target.value)}
                    placeholder="أدخل الـ Refresh Token هنا..."
                    className="w-full rounded-lg px-3 py-2 text-xs font-mono"
                    style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(234,179,8,0.3)", color: "hsl(var(--foreground))", outline: "none" }}
                    dir="ltr"
                  />
                  <button
                    onClick={handleSaveManualToken}
                    disabled={savingToken || !manualToken.trim()}
                    className="flex items-center justify-center gap-2 px-4 py-2 rounded-lg text-xs font-bold transition-all"
                    style={{ background: savingToken || !manualToken.trim() ? "rgba(234,179,8,0.2)" : "rgba(234,179,8,0.8)", color: "#000", cursor: savingToken || !manualToken.trim() ? "not-allowed" : "pointer" }}
                  >
                    {savingToken ? <Loader2 size={12} className="animate-spin" /> : <Key size={12} />}
                    {savingToken ? "جارٍ الحفظ..." : "حفظ الـ Refresh Token"}
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Sync Stats */}
      {status?.connected && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {[
            { icon: Clock, label: "سجلات الحضور", count: syncData ? getRecordCount(syncData.attendance) : null, color: "#1FA98C", bg: "hsl(165 69% 39% / 0.10)" },
            { icon: CalendarDays, label: "طلبات الإجازات", count: syncData ? getRecordCount(syncData.leaveRequests) : null, color: "#6366F1", bg: "rgba(99,102,241,0.1)" },
            { icon: Users, label: "أرصدة الإجازات", count: syncData ? getRecordCount(syncData.leaveBalance) : null, color: "#F59E0B", bg: "rgba(245,158,11,0.1)" },
          ].map((item) => (
            <div key={item.label} className="rounded-xl p-5" style={{ background: "hsl(var(--card))", border: "1px solid rgba(255,255,255,0.06)" }}>
              <div className="flex items-center gap-3 mb-3">
                <div className="w-9 h-9 rounded-lg flex items-center justify-center" style={{ background: item.bg }}>
                  <item.icon size={18} style={{ color: item.color }} />
                </div>
                <span className="text-sm font-semibold" style={{ fontFamily: "Alexandria", color: "hsl(var(--muted-foreground))" }}>{item.label}</span>
              </div>
              <div className="text-3xl font-black" style={{ fontFamily: "Alexandria", color: item.count !== null ? item.color : "hsl(var(--muted-foreground))" }}>
                {item.count !== null ? item.count : "—"}
              </div>
              <div className="text-xs mt-1" style={{ color: "hsl(var(--muted-foreground))" }}>
                {item.count !== null ? "سجل مزامن" : "لم تتم المزامنة بعد"}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Last sync + open Zoho */}
      {syncData?.syncedAt && (
        <div className="rounded-xl p-4 flex items-center justify-between" style={{ background: "hsl(var(--card))", border: "1px solid rgba(255,255,255,0.06)" }}>
          <div className="flex items-center gap-2">
            <CheckCircle2 size={16} className="text-[#1FA98C]" />
            <span className="text-sm" style={{ color: "hsl(var(--muted-foreground))" }}>
              آخر مزامنة: <strong>{formatTime(syncData.syncedAt)}</strong>
            </span>
          </div>
          <a href="https://people.zoho.com" target="_blank" rel="noopener noreferrer" className="flex items-center gap-1.5 text-xs" style={{ color: "#1FA98C" }}>
            <ExternalLink size={13} />
            فتح Zoho People
          </a>
        </div>
      )}

      {/* Sync Log */}
      <div className="rounded-2xl overflow-hidden" style={{ background: "hsl(var(--card))", border: "1px solid rgba(255,255,255,0.06)" }}>
        <div className="flex items-center justify-between px-5 py-4" style={{ borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
          <div className="flex items-center gap-2">
            <History size={16} style={{ color: "#1FA98C" }} />
            <span className="font-bold text-sm" style={{ fontFamily: "Alexandria", color: "hsl(var(--foreground))" }}>
              سجل المزامنات
            </span>
            {syncLog.length > 0 && (
              <span className="text-xs px-2 py-0.5 rounded-full" style={{ background: "hsl(165 69% 39% / 0.15)", color: "#1FA98C" }}>
                {syncLog.length}
              </span>
            )}
          </div>
          <button
            onClick={loadSyncLog}
            className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg transition-all"
            style={{ background: "rgba(255,255,255,0.05)", color: "hsl(var(--muted-foreground))" }}
          >
            <RefreshCw size={12} />
            تحديث
          </button>
        </div>

        {syncLog.length === 0 ? (
          <div className="py-10 text-center">
            <History size={28} style={{ color: "hsl(var(--border))", margin: "0 auto 8px" }} />
            <p className="text-sm" style={{ color: "hsl(var(--muted-foreground))" }}>لا توجد مزامنات سابقة</p>
            <p className="text-xs mt-1" style={{ color: "hsl(var(--border))" }}>ستظهر هنا بعد أول مزامنة</p>
          </div>
        ) : (
          <div className="divide-y" style={{ borderColor: "rgba(255,255,255,0.04)" }}>
            {syncLog.map((entry) => {
              const cfg = statusConfig[entry.status];
              return (
                <div key={entry.id} className="flex items-center gap-4 px-5 py-3.5">
                  {/* Status badge */}
                  <div
                    className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold shrink-0"
                    style={{ background: cfg.bg, color: cfg.color }}
                  >
                    <span>{cfg.icon}</span>
                    <span>{cfg.label}</span>
                  </div>

                  {/* Time */}
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-semibold" style={{ color: "hsl(var(--muted-foreground))" }}>
                      {formatTime(entry.startedAt)}
                    </div>
                    <div className="text-xs mt-0.5" style={{ color: "hsl(var(--muted-foreground))" }}>
                      {entry.triggeredBy === "auto" ? "🕖 تلقائي" : "👆 يدوي"} · مدة: {formatDuration(entry.startedAt, entry.finishedAt)}
                    </div>
                  </div>

                  {/* Counts */}
                  {entry.status === "success" && (
                    <div className="flex items-center gap-3 text-xs" style={{ color: "hsl(var(--muted-foreground))" }}>
                      <span title="الحضور"><Clock size={12} className="inline ml-1" />{entry.attendanceCount}</span>
                      <span title="الإجازات"><CalendarDays size={12} className="inline ml-1" />{entry.leaveRequestsCount}</span>
                      <span title="الأرصدة"><Users size={12} className="inline ml-1" />{entry.leaveBalanceCount}</span>
                    </div>
                  )}

                  {/* Error */}
                  {entry.error && (
                    <div className="text-xs max-w-48 truncate" style={{ color: "#EF4444" }} title={entry.error}>
                      {entry.error}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Token Info Modal */}
      {showToken && tokenInfo && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: "rgba(0,0,0,0.7)" }}
          onClick={() => setShowToken(false)}
        >
          <div
            className="rounded-2xl p-6 max-w-lg w-full"
            style={{ background: "hsl(var(--background))", border: "1px solid rgba(234,179,8,0.3)" }}
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center gap-2 mb-4">
              <Key size={18} style={{ color: "#EAB308" }} />
              <span className="font-bold text-lg" style={{ fontFamily: "Alexandria", color: "hsl(var(--foreground))" }}>Refresh Token</span>
            </div>
            {tokenInfo.connected ? (
              <>
                <p className="text-sm mb-3" style={{ color: "hsl(var(--muted-foreground))" }}>
                  انسخ هذا الـ Refresh Token واحفظه في <strong style={{ color: "#EAB308" }}>Manus Secrets</strong> باسم <code style={{ color: "#1FA98C" }}>ZOHO_REFRESH_TOKEN</code> لضمان بقاء الاتصال بعد كل نشر.
                </p>
                <div
                  className="rounded-xl p-3 text-xs font-mono break-all cursor-pointer select-all"
                  style={{ background: "rgba(234,179,8,0.08)", color: "#EAB308", border: "1px solid rgba(234,179,8,0.2)" }}
                  onClick={() => { navigator.clipboard.writeText(tokenInfo.refresh_token); toast.success("تم نسخ التوكن!"); }}
                >
                  {tokenInfo.refresh_token}
                </div>
                <p className="text-xs mt-2" style={{ color: "hsl(var(--muted-foreground))" }}>اضغط على التوكن لنسخه تلقائياً</p>
              </>
            ) : (
              <p style={{ color: "#EF4444" }}>لا يوجد توكن محفوظ حالياً. قم بربط Zoho أولاً.</p>
            )}
            <button
              onClick={() => setShowToken(false)}
              className="mt-4 px-4 py-2 rounded-xl text-sm font-bold"
              style={{ background: "rgba(255,255,255,0.08)", color: "hsl(var(--foreground))" }}
            >إغلاق</button>
          </div>
        </div>
      )}

      {/* Debug Modal */}
      {showDebug && debugInfo && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: "rgba(0,0,0,0.7)" }}
          onClick={() => setShowDebug(false)}
        >
          <div
            className="rounded-2xl p-6 max-w-2xl w-full max-h-[80vh] overflow-y-auto"
            style={{ background: "hsl(var(--background))", border: "1px solid rgba(99,102,241,0.3)" }}
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center gap-2 mb-4">
              <Bug size={18} style={{ color: "#818CF8" }} />
              <span className="font-bold text-lg" style={{ fontFamily: "Alexandria", color: "hsl(var(--foreground))" }}>تشخيص المزامنة</span>
            </div>
            <div className="space-y-3 text-sm">
              <div className="flex justify-between">
                <span style={{ color: "hsl(var(--muted-foreground))" }}>حالة الاتصال:</span>
                <span style={{ color: debugInfo.connected ? "#1FA98C" : "#EF4444" }}>{debugInfo.connected ? "متصل ✓" : "غير متصل ✗"}</span>
              </div>
              <div className="flex justify-between">
                <span style={{ color: "hsl(var(--muted-foreground))" }}>نطاق الإجازات:</span>
                <span style={{ color: "hsl(var(--muted-foreground))" }}>{debugInfo.leaveFrom} → {debugInfo.leaveTo}</span>
              </div>
              {debugInfo.leaveError && (
                <div className="rounded-xl p-3" style={{ background: "rgba(239,68,68,0.1)", color: "#EF4444" }}>
                  <strong>خطأ:</strong> {debugInfo.leaveError}
                </div>
              )}
              {debugInfo.leaveRawKeys && (
                <div>
                  <p style={{ color: "hsl(var(--muted-foreground))" }}>مفاتيح الاستجابة من Zoho:</p>
                  <code className="text-xs" style={{ color: "#1FA98C" }}>{debugInfo.leaveRawKeys.join(", ")}</code>
                </div>
              )}
              {debugInfo.leaveRawSample && (
                <div>
                  <p style={{ color: "hsl(var(--muted-foreground))" }}>عينة من البيانات:</p>
                  <pre className="text-xs overflow-x-auto rounded-xl p-3 mt-1" style={{ background: "rgba(255,255,255,0.04)", color: "hsl(var(--muted-foreground))" }}>{debugInfo.leaveRawSample}</pre>
                </div>
              )}
              {!debugInfo.connected && (
                <div className="rounded-xl p-3" style={{ background: "rgba(239,68,68,0.08)", color: "#EF4444" }}>
                  Zoho غير متصل. قم بربط Zoho أولاً من الزر أعلاه.
                </div>
              )}
            </div>
            <button
              onClick={() => setShowDebug(false)}
              className="mt-4 px-4 py-2 rounded-xl text-sm font-bold"
              style={{ background: "rgba(255,255,255,0.08)", color: "hsl(var(--foreground))" }}
            >إغلاق</button>
          </div>
        </div>
      )}
    </div>
  );
}
