import React, { createContext, useContext, useState, useCallback, ReactNode } from "react";

export type ActivityCategory =
  | "auth"        // login / logout
  | "employee"    // add / edit / delete employee
  | "leave"       // submit / approve / reject leave
  | "attendance"  // view / export attendance
  | "payroll"     // view / export payroll
  | "performance" // update performance
  | "compliance"  // view compliance
  | "report"      // export report
  | "settings"    // change settings
  | "system";     // system events

export type ActivitySeverity = "info" | "success" | "warning" | "error";

export interface ActivityLogEntry {
  id: string;
  timestamp: string;       // ISO string
  userId: string;
  userName: string;
  userRole: string;
  category: ActivityCategory;
  action: string;          // Short action label e.g. "تسجيل دخول"
  details: string;         // Full description
  severity: ActivitySeverity;
  metadata?: Record<string, string | number | boolean>; // optional extra data
}

interface ActivityLogContextType {
  logs: ActivityLogEntry[];
  logActivity: (
    entry: Omit<ActivityLogEntry, "id" | "timestamp">
  ) => void;
  clearLogs: () => void;
}

const MAX_LOGS = 500;

const ActivityLogContext = createContext<ActivityLogContextType | undefined>(undefined);

export function ActivityLogProvider({ children }: { children: ReactNode }) {
  const [logs, setLogs] = useState<ActivityLogEntry[]>([]);

  const logActivity = useCallback((entry: Omit<ActivityLogEntry, "id" | "timestamp">) => {
    const newEntry: ActivityLogEntry = {
      ...entry,
      id: `log-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      timestamp: new Date().toISOString(),
    };
    setLogs(prev => {
      const updated = [newEntry, ...prev].slice(0, MAX_LOGS);
      return updated;
    });
  }, []);

  const clearLogs = useCallback(() => {
    setLogs([]);
  }, []);

  return (
    <ActivityLogContext.Provider value={{ logs, logActivity, clearLogs }}>
      {children}
    </ActivityLogContext.Provider>
  );
}

export function useActivityLog() {
  const ctx = useContext(ActivityLogContext);
  if (!ctx) throw new Error("useActivityLog must be used within ActivityLogProvider");
  return ctx;
}

// ─── Category metadata ────────────────────────────────────────────────────────
export const CATEGORY_LABELS: Record<ActivityCategory, string> = {
  auth: "تسجيل الدخول / الخروج",
  employee: "إدارة الموظفين",
  leave: "الإجازات",
  attendance: "الحضور والانصراف",
  payroll: "الرواتب",
  performance: "الأداء",
  compliance: "الامتثال",
  report: "التقارير",
  settings: "الإعدادات",
  system: "النظام",
};

export const CATEGORY_COLORS: Record<ActivityCategory, string> = {
  auth: "#6366F1",
  employee: "#1FA98C",
  leave: "#F59E0B",
  attendance: "#3B82F6",
  payroll: "#10B981",
  performance: "#8B5CF6",
  compliance: "#EF4444",
  report: "#06B6D4",
  settings: "#64748B",
  system: "hsl(var(--muted-foreground))",
};

export const SEVERITY_COLORS: Record<ActivitySeverity, string> = {
  info: "#3B82F6",
  success: "#10B981",
  warning: "#F59E0B",
  error: "#EF4444",
};
