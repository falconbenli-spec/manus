import { type ReactNode } from "react";
import { Link } from "wouter";
import { Moon, Sun, ArrowUpLeft, ShieldCheck } from "lucide-react";
import { BrandMark } from "@/components/BrandLogo";
import { useTheme } from "@/contexts/ThemeContext";
import ImpactScene from "./ImpactScene";

type AuthShellProps = { mode: "admin" | "employee"; children: ReactNode; checking?: boolean };

export default function AuthShell({ mode, children, checking = false }: AuthShellProps) {
  const { theme, toggleTheme } = useTheme();
  const employee = mode === "employee";
  return (
    <main className="people-auth" dir="rtl">
      <section className="people-auth-panel" aria-label={employee ? "بوابة الموظف" : "دخول الإدارة"}>
        <header className="people-auth-masthead">
          <div className="people-wordmark"><BrandMark height={32} /><span>منصة رأس المال البشري</span></div>
          <button type="button" className="people-icon-button" onClick={toggleTheme} aria-label={theme === "dark" ? "تفعيل الوضع النهاري" : "تفعيل الوضع الليلي"}>
            {theme === "dark" ? <Sun size={19} /> : <Moon size={19} />}
          </button>
        </header>
        <div className="people-auth-mobile-art"><ImpactScene compact /></div>
        <div className="people-auth-body">
          <nav className="people-auth-switch" aria-label="نوع تسجيل الدخول">
            <Link href="/employee-portal/login" className={employee ? "is-current" : ""} aria-current={employee ? "page" : undefined}>بوابة الموظف</Link>
            <Link href="/login" className={!employee ? "is-current" : ""} aria-current={!employee ? "page" : undefined}>دخول الإدارة</Link>
          </nav>
          <div className="people-auth-intro">
            <p className="people-eyebrow"><span /> {employee ? "مساحتك، كل يوم" : "الأشخاص أولًا"}</p>
            <h1>{checking ? "لحظة، ونكون معك." : "أهلًا بعودتك."}</h1>
            <p>{checking ? "جارٍ التحقق من جلستك الحالية." : employee ? "يوم عمل أوضح. وكل ما يخصّك في مكان واحد." : "رؤية أوضح لفريقك. ومساحة لكل إنجاز جديد."}</p>
          </div>
          {children}
          <p className="people-auth-help">{employee ? "للحصول على بيانات الدخول، تواصل مع إدارة الموارد البشرية." : "استخدم بريدك المعتمد للوصول إلى حساب الإدارة."}</p>
        </div>
        <footer className="people-auth-footer"><span dir="ltr">People36t © {new Date().getFullYear()}</span><span><ShieldCheck size={14} aria-hidden="true" /> وصول آمن</span></footer>
      </section>
      <aside className="people-auth-art" aria-label="هنا يبدأ الأثر">
        <ImpactScene />
        <div className="people-art-top"><span dir="ltr">PEOPLE. PURPOSE. IMPACT.</span><ArrowUpLeft size={22} aria-hidden="true" /></div>
        <div className="people-art-caption"><span className="people-art-index" dir="ltr">01 — A SHARED PURPOSE</span><h2>هنا يبدأ <em>الأثر.</em></h2><p>نصنع الفرق معًا، ويبدأ كل إنجاز بأشخاصه.</p></div>
        <div className="people-art-bottom"><span>مساحة للأشخاص. واتساع للطموح.</span><span dir="ltr">3,6T — PEOPLE</span></div>
      </aside>
    </main>
  );
}
