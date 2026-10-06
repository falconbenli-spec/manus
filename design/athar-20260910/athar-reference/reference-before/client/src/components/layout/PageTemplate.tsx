/**
 * PageTemplate - Shared layout for all HCM sections
 * Brand: Turquoise #1FA98C, Charcoal #262626
 * Font: Alexandria
 */
import { ReactNode } from "react";
import { LucideIcon } from "lucide-react";
import GeometricPattern from "@/components/GeometricPattern";

interface StatItem {
  label: string;
  value: string;
  color?: string;
  icon?: LucideIcon;
}

interface PageTemplateProps {
  title: string;
  subtitle?: string;
  icon: LucideIcon;
  stats?: StatItem[];
  actions?: ReactNode;
  children: ReactNode;
}

export default function PageTemplate({ title, subtitle, icon: Icon, stats, actions, children }: PageTemplateProps) {
  return (
    <div className="page-shell space-y-5 animate-fade-in" role="region" aria-label={title} data-page-template>
      {/* Page header with brand pattern accent */}
      <div
        className="page-header surface-card flex items-start justify-between gap-4 rounded-2xl px-5 py-5"
        style={{ position: 'relative', overflow: 'hidden', minHeight: '92px' }}
      >
        <div className="brand-pattern" style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: '180px', overflow: 'hidden', opacity: 0.38 }}>
          <GeometricPattern className="w-full h-full" side="right" />
        </div>
        <div className="flex items-center gap-3 relative z-[1]">
          <div className="icon-teal-lg">
            <Icon size={20} />
          </div>
          <div>
            <h1 className="text-xl font-extrabold leading-tight" style={{ color: 'hsl(var(--foreground))' }}>
              {title}
            </h1>
            {subtitle && (
              <p className="mt-1 text-xs" style={{ color: 'hsl(var(--muted-foreground))' }}>
                {subtitle}
              </p>
            )}
          </div>
        </div>
        {actions && <div className="relative z-[1] flex shrink-0 items-center gap-2 max-sm:flex-wrap" role="toolbar" aria-label={`إجراءات ${title}`}>{actions}</div>}
      </div>

      {/* Stats row */}
      {stats && stats.length > 0 && (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4" aria-label={`مؤشرات ${title}`}>
          {stats.map((stat, i) => {
            const StatIcon = stat.icon;
            return (
              <div
                key={stat.label}
                className="stat-card interactive-glow animate-fade-in-up p-4"
                style={{ animationDelay: `${i * 60}ms`, opacity: 0 }}
              >
                <div className="flex items-center gap-2 mb-2">
                  {StatIcon && (
                    <div style={{ color: stat.color || 'hsl(var(--primary))' }}>
                      <StatIcon size={14} />
                    </div>
                  )}
                  <span style={{ fontSize: '12px', color: 'hsl(var(--muted-foreground))' }}>
                    {stat.label}
                  </span>
                </div>
                <div style={{ fontWeight: 800, fontSize: '22px', color: stat.color || 'hsl(var(--primary))' }}>
                  {stat.value}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Main content */}
      {children}
    </div>
  );
}
