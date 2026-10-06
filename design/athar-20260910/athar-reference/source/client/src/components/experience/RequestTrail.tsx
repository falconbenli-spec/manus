const stages = [
  ["new", "جديد"],
  ["reviewing", "المراجعة"],
  ["in_progress", "التنفيذ"],
  ["pending_approval", "الاعتماد"],
  ["completed", "مكتمل"],
] as const;
export default function RequestTrail({ status }: { status: string }) {
  const terminal = status === "rejected" || status === "cancelled";
  return (
    <section className="athar-trail" aria-label="سطر الأثر، حالة الطلب">
      <p>حالة الطلب الآن</p>
      {terminal ? (
        <div className="athar-trail__terminal">
          {status === "rejected" ? "الطلب مرفوض" : "الطلب ملغي"}
        </div>
      ) : (
        <ol>
          {stages.map(([key, label]) => (
            <li key={key} aria-current={status === key ? "step" : undefined}>
              <span aria-hidden="true" />
              {label}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
