import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { Eye, EyeOff, ArrowLeft, Loader2 } from "lucide-react";
import AuthShell from "@/components/brand/AuthShell";
export default function EmployeePortalLogin() {
  const [, setLocation] = useLocation();
  const [employeeId, setEmployeeId] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [checking, setChecking] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch("/api/employee/portal-me", { credentials: "include" })
      .then(r => r.json())
      .then(data => {
        if (data?.employee) setLocation("/employee-portal");
      })
      .catch(() => {})
      .finally(() => setChecking(false));
  }, [setLocation]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!employeeId.trim() || !password) {
      setError("يرجى إدخال رقم الموظف وكلمة المرور");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/employee/portal-login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ employeeId: employeeId.trim(), password }),
      });
      const data = await res.json();
      if (res.ok && data.success) setLocation("/employee-portal");
      else setError(data.error || "بيانات غير صحيحة");
    } catch {
      setError("تعذّر الاتصال بالسيرفر، يرجى المحاولة مجدداً");
    } finally {
      setLoading(false);
    }
  };

  if (checking) return <AuthShell mode="employee" checking><div className="people-auth-loading" role="status"><Loader2 size={20} className="people-spinner" aria-hidden="true" /> جارٍ تجهيز بوابة الموظف…</div></AuthShell>;

  return <AuthShell mode="employee">
    <form className="people-form" onSubmit={handleLogin} aria-label="تسجيل دخول الموظف" aria-busy={loading}>
      <div className="people-field">
        <label htmlFor="employee-id">رقم الموظف</label>
        <input id="employee-id" name="employeeId" type="text" value={employeeId} onChange={e => { setEmployeeId(e.target.value); setError(""); }} placeholder="أدخل رقمك الوظيفي" autoComplete="username" inputMode="numeric" disabled={loading} aria-invalid={Boolean(error)} aria-describedby={error ? "employee-login-error" : undefined} />
      </div>
      <div className="people-field">
        <label htmlFor="employee-password">كلمة المرور</label>
        <div className="people-password">
          <input id="employee-password" name="password" type={showPassword ? "text" : "password"} value={password} onChange={e => { setPassword(e.target.value); setError(""); }} placeholder="أدخل كلمة المرور" autoComplete="current-password" disabled={loading} aria-invalid={Boolean(error)} aria-describedby={error ? "employee-login-error" : undefined} />
          <button type="button" onClick={() => setShowPassword(v => !v)} disabled={loading} aria-label={showPassword ? "إخفاء كلمة المرور" : "إظهار كلمة المرور"} aria-pressed={showPassword}>{showPassword ? <EyeOff size={18} aria-hidden="true" /> : <Eye size={18} aria-hidden="true" />}</button>
        </div>
      </div>
      {error && <div className="people-error" id="employee-login-error" role="alert">{error}</div>}
      <button type="submit" disabled={loading} className="people-submit"><span>{loading ? "جارٍ تسجيل الدخول…" : "تسجيل الدخول"}</span>{loading ? <Loader2 size={18} className="people-spinner" aria-hidden="true" /> : <ArrowLeft size={18} aria-hidden="true" />}</button>
    </form>
  </AuthShell>;
}
