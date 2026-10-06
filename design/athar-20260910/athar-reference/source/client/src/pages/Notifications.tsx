/**
 * Notifications Center — مركز الإشعارات الذكية
 * Backend-powered smart notifications with categories, read/unread, and filters
 */
import { useState, useEffect, useMemo, useCallback } from "react";
import { useAuth } from "../contexts/AuthContext";
import {
  Bell, Check, CheckCheck, Trash2, Filter, Clock,
  Calendar, DollarSign, Award, FileText, Users, AlertCircle,
  MessageSquare, TrendingUp, Settings, X, BellOff, RefreshCw,
  Zap, ShieldAlert
} from "lucide-react";
import { toast } from "sonner";
import { ErrorState } from "@/components/feedback/AsyncState";

interface Notification {
  id: number;
  user_id: string;
  type: "info" | "success" | "warning" | "action";
  category: string;
  title: string;
  message: string;
  is_read: boolean;
  action_url?: string;
  metadata?: string;
  created_at: string;
}

const CATEGORY_CONFIG: Record<string, { icon: any; color: string; label: string }> = {
  leave: { icon: Calendar, color: "#6366f1", label: "الإجازات" },
  attendance: { icon: Clock, color: "#f59e0b", label: "الحضور" },
  payroll: { icon: DollarSign, color: "#10b981", label: "الرواتب" },
  recognition: { icon: Award, color: "#8b5cf6", label: "التقدير" },
  task: { icon: FileText, color: "#3b82f6", label: "المهام" },
  system: { icon: Settings, color: "#6b7280", label: "النظام" },
  performance: { icon: TrendingUp, color: "#ef4444", label: "الأداء" },
  general: { icon: Bell, color: "hsl(var(--primary))", label: "عام" },
  contract: { icon: ShieldAlert, color: "#f97316", label: "العقود" },
};

export default function Notifications() {
  const { user } = useAuth();
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [filter, setFilter] = useState<"all" | "unread" | "read">("all");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError,setLoadError]=useState(false);

  const fetchNotifications = useCallback(async () => {
    try {
      const res = await fetch("/api/hcm/notifications?limit=100", { credentials: "include" });
      if (!res.ok) throw new Error('unavailable');
      const data = await res.json();
      if (!Array.isArray(data)) throw new Error('invalid response');
      setNotifications(data); setLoadError(false);
    } catch {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchNotifications();
    // Auto-refresh every 60 seconds
    const interval = setInterval(fetchNotifications, 60_000);
    return () => clearInterval(interval);
  }, [fetchNotifications]);

  const handleMarkAsRead = async (id: number) => {
    try {
      const response = await fetch("/api/hcm/notifications/mark-read", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ notificationId: id }),
      });
      if (!response.ok) throw new Error("update failed");
      setNotifications(prev => prev.map(n => n.id === id ? { ...n, is_read: true } : n));
    } catch (err) {
      toast.error("تعذّر حفظ التغيير. حاول مرة أخرى.");
    }
  };

  const handleMarkAllAsRead = async () => {
    try {
      const response = await fetch("/api/hcm/notifications/mark-all-read", {
        method: "POST",
        credentials: "include",
      });
      if (!response.ok) throw new Error("update failed");
      setNotifications(prev => prev.map(n => ({ ...n, is_read: true })));
      toast.success("تم تعليم جميع الإشعارات كمقروءة");
    } catch (err) {
      toast.error("تعذّر حفظ التغيير. حاول مرة أخرى.");
    }
  };

  const handleDelete = async (id: number) => {
    try {
      const response = await fetch(`/api/hcm/notifications?id=${id}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!response.ok) throw new Error("update failed");
      setNotifications(prev => prev.filter(n => n.id !== id));
      toast.success("تم حذف الإشعار");
    } catch (err) {
      toast.error("تعذّر حفظ التغيير. حاول مرة أخرى.");
    }
  };

  const handleRunSmart = async () => {
    setRefreshing(true);
    try {
      const res = await fetch("/api/hcm/notifications/run-smart", {
        method: "POST",
        credentials: "include",
      });
      if (res.ok) {
        const data = await res.json();
        if (data.total > 0) {
          toast.success(`تم إنشاء ${data.total} إشعار ذكي جديد`);
        } else {
          toast.info("لا توجد تنبيهات جديدة حالياً");
        }
        await fetchNotifications();
      }
    } catch (err) {
      toast.error("خطأ في تشغيل الإشعارات الذكية");
    } finally {
      setRefreshing(false);
    }
  };

  const filteredNotifications = useMemo(() => {
    let filtered = notifications;
    if (filter === "unread") filtered = filtered.filter(n => !n.is_read);
    if (filter === "read") filtered = filtered.filter(n => n.is_read);
    if (categoryFilter) filtered = filtered.filter(n => n.category === categoryFilter);
    return filtered;
  }, [notifications, filter, categoryFilter]);

  const unreadCount = notifications.filter(n => !n.is_read).length;

  const getTypeStyles = (type: string) => {
    switch (type) {
      case "success": return { bg: "rgba(16,185,129,0.08)", border: "rgba(16,185,129,0.25)", dot: "#10b981" };
      case "warning": return { bg: "rgba(245,158,11,0.08)", border: "rgba(245,158,11,0.25)", dot: "#f59e0b" };
      case "action": return { bg: "rgba(239,68,68,0.08)", border: "rgba(239,68,68,0.25)", dot: "#ef4444" };
      default: return { bg: "hsl(var(--card))", border: "hsl(var(--border))", dot: "hsl(var(--primary))" };
    }
  };

  if (loading) {
    return (
      <div className="space-y-4 animate-fade-in">
        <div className="flex items-center justify-center py-20">
          <div className="animate-spin rounded-full h-8 w-8 border-2 border-t-transparent" style={{ borderColor: "hsl(var(--primary))", borderTopColor: "transparent" }} />
        </div>
      </div>
    );
  }

  if(loadError) return <ErrorState title="تعذّر تحميل الإشعارات" message="لم نتمكن من جلب الإشعارات. حاول مرة أخرى." onRetry={fetchNotifications}/>;

  return (
    <div className="space-y-4 animate-fade-in">
      {/* Header */}
      <div
        className="flex items-center justify-between px-5 py-4 rounded-xl"
        style={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))" }}
      >
        <div className="flex items-center gap-3">
          <div className="icon-teal-lg relative">
            <Bell size={22} />
            {unreadCount > 0 && (
              <span
                className="absolute -top-1 -right-1 w-5 h-5 rounded-full flex items-center justify-center"
                style={{ background: "#ef4444", fontSize: "10px", color: "#fff", fontWeight: 700 }}
              >
                {unreadCount}
              </span>
            )}
          </div>
          <div>
            <h1 style={{ fontFamily: "Alexandria", fontWeight: 800, fontSize: "16px", color: "hsl(var(--foreground))" }}>
              مركز الإشعارات الذكية
            </h1>
            <p style={{ fontFamily: "Alexandria", fontSize: "12px", color: "hsl(var(--muted-foreground))" }}>
              {unreadCount > 0 ? `لديك ${unreadCount} إشعار غير مقروء` : "لا توجد إشعارات جديدة"}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {/* Run Smart Notifications Button */}
          <button
            onClick={handleRunSmart}
            disabled={refreshing}
            className="btn-brand"
            style={{ opacity: refreshing ? 0.6 : 1 }}
            title="تشغيل الإشعارات الذكية"
          >
            <Zap size={16} className={refreshing ? "animate-spin" : ""} />
            <span>فحص ذكي</span>
          </button>
          {unreadCount > 0 && (
            <button onClick={handleMarkAllAsRead} className="btn-brand">
              <CheckCheck size={16} />
              <span>قراءة الكل</span>
            </button>
          )}
        </div>
      </div>

      {/* Smart Alerts Summary */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {[
          { label: "تنبيهات العقود", icon: ShieldAlert, color: "#f97316", count: notifications.filter(n => n.category === "contract" && !n.is_read).length },
          { label: "تنبيهات الحضور", icon: Clock, color: "#f59e0b", count: notifications.filter(n => n.category === "attendance" && !n.is_read).length },
          { label: "المهام المتأخرة", icon: FileText, color: "#3b82f6", count: notifications.filter(n => n.category === "task" && !n.is_read).length },
        ].map((item, i) => (
          <div
            key={i}
            className="flex items-center gap-3 px-4 py-3 rounded-xl"
            style={{ background: "hsl(var(--card))", border: `1px solid ${item.color}30` }}
          >
            <div
              className="w-9 h-9 rounded-lg flex items-center justify-center"
              style={{ background: `${item.color}15` }}
            >
              <item.icon size={18} style={{ color: item.color }} />
            </div>
            <div>
              <div style={{ fontFamily: "Alexandria", fontSize: "11px", color: "hsl(var(--muted-foreground))" }}>{item.label}</div>
              <div style={{ fontFamily: "Alexandria", fontWeight: 800, fontSize: "18px", color: item.count > 0 ? item.color : "hsl(var(--muted-foreground))" }}>
                {item.count}
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="flex gap-2 flex-wrap">
        {[
          { id: "all" as const, label: "الكل" },
          { id: "unread" as const, label: `غير مقروء (${unreadCount})` },
          { id: "read" as const, label: "مقروء" },
        ].map(f => (
          <button
            key={f.id}
            onClick={() => setFilter(f.id)}
            className="px-3 py-1.5 rounded-lg transition-all"
            style={{
              background: filter === f.id ? "hsl(var(--primary) / 0.15)" : "hsl(var(--muted))",
              border: `1px solid ${filter === f.id ? "hsl(var(--primary) / 0.40)" : "hsl(var(--border))"}`,
              color: filter === f.id ? "hsl(var(--primary))" : "hsl(var(--muted-foreground))",
              fontFamily: "Alexandria",
              fontSize: "12px",
              fontWeight: 600,
            }}
          >
            {f.label}
          </button>
        ))}
        <select
          value={categoryFilter}
          onChange={e => setCategoryFilter(e.target.value)}
          className="px-3 py-1.5 rounded-lg outline-none"
          style={{ background: "hsl(var(--input))", border: "1px solid hsl(var(--border))", fontFamily: "Alexandria", fontSize: "12px", color: "hsl(var(--foreground))" }}
        >
          <option value="">جميع الفئات</option>
          {Object.entries(CATEGORY_CONFIG).map(([key, cfg]) => (
            <option key={key} value={key}>{cfg.label}</option>
          ))}
        </select>
      </div>

      {/* Notifications List */}
      <div className="space-y-2">
        {filteredNotifications.length === 0 ? (
          <div className="text-center py-12 rounded-xl" style={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))" }}>
            <BellOff size={40} style={{ color: "hsl(var(--border))", margin: "0 auto 12px" }} />
            <p style={{ fontFamily: "Alexandria", fontSize: "14px", color: "hsl(var(--muted-foreground))" }}>
              {filter === "unread" ? "لا توجد إشعارات غير مقروءة" : "لا توجد إشعارات"}
            </p>
            <p style={{ fontFamily: "Alexandria", fontSize: "12px", color: "hsl(var(--muted-foreground))", marginTop: "8px" }}>
              اضغط "فحص ذكي" لتوليد تنبيهات تلقائية
            </p>
          </div>
        ) : (
          filteredNotifications.map((notif, i) => {
            const typeStyles = getTypeStyles(notif.type);
            const catConfig = CATEGORY_CONFIG[notif.category] || CATEGORY_CONFIG.general;
            const CatIcon = catConfig?.icon || Bell;
            return (
              <div
                key={notif.id}
                onClick={() => !notif.is_read && handleMarkAsRead(notif.id)}
                className="flex items-start gap-3 rounded-xl px-4 py-3 cursor-pointer transition-all hover:scale-[1.005] animate-fade-in-up"
                style={{
                  background: typeStyles.bg,
                  border: `1px solid ${typeStyles.border}`,
                  opacity: notif.is_read ? 0.7 : 1,
                  animationDelay: `${i * 30}ms`,
                }}
              >
                {/* Unread dot */}
                {!notif.is_read && (
                  <div className="w-2 h-2 rounded-full mt-2 flex-shrink-0 animate-pulse-teal" style={{ background: typeStyles.dot }} />
                )}
                {/* Icon */}
                <div
                  className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0"
                  style={{ background: `${catConfig?.color}15` }}
                >
                  <CatIcon size={16} style={{ color: catConfig?.color }} />
                </div>
                {/* Content */}
                <div className="flex-1 min-w-0">
                  <h4 style={{ fontFamily: "Alexandria", fontWeight: 700, fontSize: "13px", color: "hsl(var(--foreground))", marginBottom: "2px" }}>
                    {notif.title}
                  </h4>
                  <p style={{ fontFamily: "Alexandria", fontSize: "12px", color: "hsl(var(--muted-foreground))", lineHeight: 1.6 }}>
                    {notif.message}
                  </p>
                  <span style={{ fontFamily: "Alexandria", fontSize: "10px", color: "hsl(var(--muted-foreground))", marginTop: "4px", display: "block" }}>
                    {getTimeAgo(notif.created_at)}
                  </span>
                </div>
                {/* Actions */}
                <button
                  onClick={(e) => { e.stopPropagation(); handleDelete(notif.id); }}
                  className="p-1.5 rounded-lg hover:bg-red-500/10 transition-all flex-shrink-0"
                >
                  <X size={14} style={{ color: "hsl(var(--muted-foreground))" }} />
                </button>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

function getTimeAgo(dateStr: string): string {
  const timestamp = new Date(dateStr).getTime();
  const diff = Date.now() - timestamp;
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return "الآن";
  if (minutes < 60) return `منذ ${minutes} دقيقة`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `منذ ${hours} ساعة`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `منذ ${days} يوم`;
  if (days < 30) return `منذ ${Math.floor(days / 7)} أسبوع`;
  return `منذ ${Math.floor(days / 30)} شهر`;
}
