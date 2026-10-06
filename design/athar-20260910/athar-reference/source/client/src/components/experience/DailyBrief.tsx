import { useEffect, useState } from "react";
import { Link } from "wouter";
import { ClipboardList, ArrowLeft, Send, RefreshCw } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
type Item = {
  id: string | number;
  title: string;
  detail: string;
  due?: number;
};
type Group = { items: Item[]; loading: boolean; error: boolean };
const initial: Group = { items: [], loading: true, error: false };
export default function DailyBrief() {
  const { user } = useAuth();
  const [tasks, setTasks] = useState<Group>(initial),
    [requests, setRequests] = useState<Group>(initial),
    [version, setVersion] = useState(0);
  useEffect(() => {
    const abort = new AbortController();
    const read = async (
      path: string,
      map: (data: any[]) => Item[],
      set: (state: Group) => void,
    ) => {
      set(initial);
      try {
        const response = await fetch(path, {
          credentials: "include",
          signal: abort.signal,
        });
        if (!response.ok) throw Error();
        const data = await response.json();
        if (!Array.isArray(data)) throw Error();
        set({ items: map(data), loading: false, error: false });
      } catch {
        if (!abort.signal.aborted)
          set({ items: [], loading: false, error: true });
      }
    };
    const sort = (a: Item, b: Item) =>
      (a.due || Infinity) - (b.due || Infinity);
    void read(
      "/api/tasks/items",
      (data) =>
        data
          .filter(
            (t) =>
              !["منجز", "مكتمل", "completed", "cancelled"].includes(t.status),
          )
          .map((t) => ({
            id: t.id,
            title: t.task_name || "مهمة",
            detail: [
              t.status,
              t.due_date ? `التسليم: ${String(t.due_date).slice(0, 10)}` : "",
            ]
              .filter(Boolean)
              .join(" · "),
            due: Date.parse(t.due_date) || undefined,
          }))
          .sort(sort)
          .slice(0, 3),
      setTasks,
    );
    void read(
      "/api/services/work-requests",
      (data) =>
        data
          .filter(
            (r) => !["completed", "rejected", "cancelled"].includes(r.status),
          )
          .map((r) => ({
            id: r.id,
            title: r.title,
            detail: [
              r.toDept,
              (
                {
                  new: "جديد",
                  reviewing: "قيد المراجعة",
                  in_progress: "قيد التنفيذ",
                  pending_approval: "بانتظار الاعتماد",
                } as Record<string, string>
              )[r.status],
            ]
              .filter(Boolean)
              .join(" · "),
            due: r.dueDate || undefined,
          }))
          .sort(sort)
          .slice(0, 3),
      setRequests,
    );
    return () => abort.abort();
  }, [user?.id, version]);
  return (
    <section className="daily-brief" aria-label="موجز يومك">
      {[
        {
          title: "مهام للمتابعة",
          href: "/my-tasks",
          icon: ClipboardList,
          state: tasks,
        },
        {
          title: "طلبات قيد العمل",
          href: "/work-requests",
          icon: Send,
          state: requests,
        },
      ].map(({ title, href, icon: Icon, state }) => (
        <div className="daily-brief__group" key={href}>
          <div className="daily-brief__heading">
            <h3>{title}</h3>
            <Link href={href}>
              عرض الكل <ArrowLeft size={13} />
            </Link>
          </div>
          {state.loading ? (
            <p className="daily-brief__empty" role="status">
              جارٍ تجهيز موجزك…
            </p>
          ) : state.error ? (
            <div className="daily-brief__empty" role="status">
              تعذّر تحميل هذا الجزء من الموجز.
              <button
                className="block mt-2 text-primary"
                onClick={() => setVersion((v) => v + 1)}
              >
                <RefreshCw size={12} className="inline ml-1" />
                إعادة المحاولة
              </button>
            </div>
          ) : state.items.length ? (
            state.items.map((item) => (
              <Link href={href} className="daily-brief__row" key={item.id}>
                <span>
                  <Icon size={15} />
                </span>
                <div>
                  <strong>{item.title}</strong>
                  <small>{item.detail}</small>
                </div>
                <ArrowLeft size={13} aria-hidden="true" />
              </Link>
            ))
          ) : (
            <p className="daily-brief__empty">
              لا توجد عناصر مفتوحة ضمن نطاقك حاليًا.
            </p>
          )}
        </div>
      ))}
    </section>
  );
}
