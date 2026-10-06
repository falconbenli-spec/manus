import { ReactNode } from "react";
import { LucideIcon } from "lucide-react";
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
export default function PageTemplate({
  title,
  subtitle,
  icon: Icon,
  stats,
  actions,
  children,
}: PageTemplateProps) {
  return (
    <section className="page-shell" aria-label={title} data-page-template>
      <header className="section-masthead">
        <div className="section-masthead__copy">
          <Icon
            size={23}
            className="section-masthead__icon"
            aria-hidden="true"
          />
          <div>
            <h1>{title}</h1>
            {subtitle && <p>{subtitle}</p>}
          </div>
        </div>
        {actions && (
          <div
            className="section-masthead__actions"
            role="group"
            aria-label={`إجراءات ${title}`}
          >
            {actions}
          </div>
        )}
      </header>
      {stats && stats.length > 0 && (
        <div className="metric-strip" aria-label={`مؤشرات ${title}`}>
          {stats.map(({ label, value, icon: StatIcon }) => (
            <div className="metric-strip__item" key={label}>
              <span>
                {StatIcon && <StatIcon size={14} aria-hidden="true" />}
                {label}
              </span>
              <strong>{value}</strong>
            </div>
          ))}
        </div>
      )}
      <div className="section-content">{children}</div>
    </section>
  );
}
