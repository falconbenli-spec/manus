import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { Eye, EyeOff, ArrowLeft, Loader2 } from "lucide-react";
import AuthShell from "@/components/brand/AuthShell";
import { useAuth } from "@/contexts/AuthContext";
export default function Login() {
  const { login } = useAuth();
  const [, setLocation] = useLocation();
  const [emailInput, setEmailInput] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!emailInput || !password) {
      setError("يرجى إدخال البريد الإلكتروني وكلمة المرور");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const identifier = emailInput.trim();
      const resp = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ identifier, password }),
      });
      const data = await resp.json();
      if (resp.ok && data.success) {
        const restored = await login();
        if (restored) setLocation("/");
        else setError("تعذّر استعادة جلسة الدخول. يرجى المحاولة مرة أخرى.");
      } else {
        setError(data.error || "بيانات الدخول غير صحيحة");
      }
    } catch {
      setError("حدث خطأ في الاتصال. يرجى المحاولة مرة أخرى.");
    }
    setLoading(false);
  };

  return <AuthShell mode="admin">
    <form className="people-form" onSubmit={handleLogin} aria-label="تسجيل دخول الإدارة" aria-busy={loading}>
      <div className="people-field">
        <label htmlFor="admin-email">البريد الإلكتروني</label>
        <input id="admin-email" name="email" type="email" value={emailInput} onChange={e => { setEmailInput(e.target.value); setError(""); }} placeholder="name@360.sa" autoComplete="email" dir="ltr" disabled={loading} aria-invalid={Boolean(error)} aria-describedby={error ? "admin-login-error" : undefined} />
      </div>
      <div className="people-field">
        <label htmlFor="admin-password">كلمة المرور</label>
        <div className="people-password">
          <input id="admin-password" name="password" type={showPassword ? "text" : "password"} value={password} onChange={e => { setPassword(e.target.value); setError(""); }} placeholder="أدخل كلمة المرور" autoComplete="current-password" disabled={loading} aria-invalid={Boolean(error)} aria-describedby={error ? "admin-login-error" : undefined} />
          <button type="button" onClick={() => setShowPassword(v => !v)} disabled={loading} aria-label={showPassword ? "إخفاء كلمة المرور" : "إظهار كلمة المرور"} aria-pressed={showPassword}>{showPassword ? <EyeOff size={18} aria-hidden="true" /> : <Eye size={18} aria-hidden="true" />}</button>
        </div>
      </div>
      {error && <div className="people-error" id="admin-login-error" role="alert">{error}</div>}
      <button type="submit" disabled={loading} className="people-submit"><span>{loading ? "جارٍ تسجيل الدخول…" : "تسجيل الدخول"}</span>{loading ? <Loader2 size={18} className="people-spinner" aria-hidden="true" /> : <ArrowLeft size={18} aria-hidden="true" />}</button>
    </form>
  </AuthShell>;
}
