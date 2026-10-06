import {
  Loader2,
  CircleAlert,
  Inbox,
  LockKeyhole,
  RefreshCw,
} from "lucide-react";
export function LoadingState({
  title,
  message,
  className = "",
}: {
  title: string;
  message?: string;
  className?: string;
}) {
  return (
    <div
      className={`athar-state ${className}`}
      role="status"
      aria-live="polite"
    >
      <Loader2 className="people-spinner" size={23} aria-hidden="true" />
      <div>
        <h2>{title}</h2>
        {message && <p>{message}</p>}
      </div>
    </div>
  );
}
export function ErrorState({
  title = "تعذّر تحميل البيانات",
  message = "أعد المحاولة للمتابعة.",
  onRetry,
  className = "",
}: {
  title?: string;
  message?: string;
  onRetry?: () => void;
  className?: string;
}) {
  return (
    <div className={`athar-state athar-state--error ${className}`} role="alert">
      <CircleAlert size={23} aria-hidden="true" />
      <div>
        <h2>{title}</h2>
        <p>{message}</p>
        {onRetry && (
          <button type="button" className="btn-secondary" onClick={onRetry}>
            <RefreshCw size={14} aria-hidden="true" />
            إعادة المحاولة
          </button>
        )}
      </div>
    </div>
  );
}
export function EmptyState({
  title,
  message,
  restricted = false,
}: {
  title: string;
  message?: string;
  restricted?: boolean;
}) {
  const Icon = restricted ? LockKeyhole : Inbox;
  return (
    <div className="athar-state" role="status">
      <Icon size={23} aria-hidden="true" />
      <div>
        <h2>{title}</h2>
        {message && <p>{message}</p>}
      </div>
    </div>
  );
}
