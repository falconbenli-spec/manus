import { type ReactNode } from "react";
import { Link } from "wouter";
import { Moon, Sun, ShieldCheck } from "lucide-react";
import { BrandMark } from "@/components/BrandLogo";
import { useTheme } from "@/contexts/ThemeContext";
import AtharScene from "@/components/experience/AtharScene";

type AuthShellProps = {
  mode: "admin" | "employee";
  children: ReactNode;
  checking?: boolean;
};
export default function AuthShell({
  mode,
  children,
  checking = false,
}: AuthShellProps) {
  const { theme, toggleTheme } = useTheme();
  const employee = mode === "employee";
  return (
    <main className="people-auth" dir="rtl">
      <section
        className="people-auth-panel"
        aria-label={employee ? "بوابة الموظف" : "دخول الإدارة"}
      >
        <header className="people-auth-masthead">
          <div className="people-wordmark">
            <BrandMark height={32} />
            <span>منصة رأس المال البشري</span>
          </div>
          <button
            type="button"
            className="people-icon-button"
            onClick={toggleTheme}
            aria-label={
              theme === "dark" ? "تفعيل الوضع النهاري" : "تفعيل الوضع الليلي"
            }
          >
            {theme === "dark" ? <Sun size={18} /> : <Moon size={18} />}
          </button>
        </header>
        <div className="people-auth-mobile-art">
          <AtharScene compact />
          <strong>التميّز يبدأ من الإنسان.</strong>
        </div>
        <div className="people-auth-body">
          <nav className="people-auth-switch" aria-label="نوع تسجيل الدخول">
            <Link
              href="/employee-portal/login"
              className={employee ? "is-current" : ""}
              aria-current={employee ? "page" : undefined}
            >
              بوابة الموظف
            </Link>
            <Link
              href="/login"
              className={!employee ? "is-current" : ""}
              aria-current={!employee ? "page" : undefined}
            >
              دخول الإدارة
            </Link>
          </nav>
          <div className="people-auth-intro">
            <h1>{checking ? "لحظة، ونكون معك." : "أهلًا بك في 3,6T."}</h1>
            <p>
              {checking
                ? "جارٍ التحقق من جلستك الحالية."
                : employee
                  ? "مساحتك ليوم أوضح، وخطوة جديدة في رحلتك معنا."
                  : "كل ما تحتاجه للاهتمام بفريقك، ومتابعة أثره."}
            </p>
          </div>
          {children}
          <p className="people-auth-help">
            {employee
              ? "للحصول على بيانات الدخول، تواصل مع فريق رأس المال البشري."
              : "استخدم بريدك المعتمد للوصول إلى حساب الإدارة."}
          </p>
        </div>
        <footer className="people-auth-footer">
          <span dir="ltr">People36t © {new Date().getFullYear()}</span>
          <span>
            <ShieldCheck size={14} aria-hidden="true" /> وصول آمن
          </span>
        </footer>
      </section>
      <aside className="people-auth-art" aria-label="التميّز يبدأ من الإنسان">
        <AtharScene />
        <div className="athar-art-heading">
          <p>معًا، نصنع ما نفخر به.</p>
          <h2>
            التميّز يبدأ
            <br />
            من الإنسان.
          </h2>
        </div>
        <div className="athar-art-footer">
          <span>الإنجاز. الشمولية. الإبداع. الجودة. الاعتزاز.</span>
          <p>مساحة عمل لصُنّاع الأثر.</p>
        </div>
      </aside>
    </main>
  );
}
