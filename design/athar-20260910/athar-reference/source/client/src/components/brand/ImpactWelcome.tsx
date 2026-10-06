import type { ReactNode } from "react";
import AtharScene from "@/components/experience/AtharScene";
import { useAuth } from "@/contexts/AuthContext";
export default function ImpactWelcome({
  stats,
}: {
  stats: { label: string; value: ReactNode }[];
}) {
  const { user } = useAuth();
  const date = new Intl.DateTimeFormat("ar-SA-u-ca-gregory", {
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(new Date());
  return (
    <section className="people-welcome" aria-label="موجز رأس المال البشري">
      <div className="people-welcome-copy">
        <time dateTime={new Date().toISOString().slice(0, 10)}>{date}</time>
        <h2>
          أهلًا {user?.name?.split(" ")[0] || "بك"}،<br />
          يومك، بوضوح.
        </h2>
        <p>ما يحتاج اهتمامك اليوم، ومساحة لكل أثر قادم.</p>
      </div>
      <div className="people-welcome-art">
        <AtharScene compact />
        <span>
          نصنع الأثر
          <br />
          معًا.
        </span>
      </div>
      <div className="people-welcome-stats">
        {stats.map((item) => (
          <div key={item.label}>
            <strong>{item.value}</strong>
            <span>{item.label}</span>
          </div>
        ))}
      </div>
    </section>
  );
}
