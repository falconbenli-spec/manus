import { Loader2 } from 'lucide-react';
export function LoadingState({ title, message, className = '' }: { title: string; message?: string; className?: string }) {
  return <div className={`flex items-center gap-4 rounded-xl border bg-card p-6 ${className}`} role="status" aria-live="polite"><Loader2 className="people-spinner shrink-0 text-primary" size={22} aria-hidden="true" /><div><p className="text-sm font-bold">{title}</p>{message && <p className="mt-2 text-xs leading-6 text-muted-foreground">{message}</p>}</div></div>;
}
