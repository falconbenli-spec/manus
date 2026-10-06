import { AlertCircle, Home } from "lucide-react";
import { useLocation } from "wouter";

export default function NotFound() {
  const [, setLocation] = useLocation();

  return (
    <div
      className="min-h-screen flex flex-col items-center justify-center"
      style={{ background: 'hsl(var(--background))', fontFamily: 'Alexandria' }}
    >
      <div className="text-center space-y-4 max-w-md px-6">
        <div
          className="flex items-center justify-center mx-auto rounded-2xl"
          style={{ width: '80px', height: '80px', background: 'hsl(165 69% 39% / 0.12)', color: '#1FA98C' }}
        >
          <AlertCircle size={36} />
        </div>
        <div style={{ fontFamily: 'Alexandria', fontWeight: 900, fontSize: '64px', color: '#1FA98C', lineHeight: 1 }}>
          404
        </div>
        <div style={{ fontFamily: 'Alexandria', fontWeight: 700, fontSize: '20px', color: 'hsl(var(--foreground))' }}>
          الصفحة غير موجودة
        </div>
        <p style={{ fontFamily: 'Alexandria', fontSize: '14px', color: 'hsl(var(--muted-foreground))', lineHeight: 1.6 }}>
          عذراً، الصفحة التي تبحث عنها غير موجودة أو تم نقلها.
        </p>
        <button
          className="btn-brand flex items-center gap-2 mx-auto"
          onClick={() => setLocation("/")}
        >
          <Home size={16} />
          <span>العودة للرئيسية</span>
        </button>
      </div>
    </div>
  );
}
