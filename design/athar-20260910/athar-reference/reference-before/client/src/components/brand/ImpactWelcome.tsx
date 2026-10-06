import type { ReactNode } from 'react';
import ImpactScene from './ImpactScene';
export default function ImpactWelcome({ stats }: { stats: { label: string; value: ReactNode }[] }) {
  return <section className="people-welcome" aria-label="نظرة سريعة على رأس المال البشري">
    <div className="people-welcome-art" aria-hidden="true"><ImpactScene compact /></div>
    <div className="people-welcome-kicker">PEOPLE. PURPOSE. IMPACT.</div>
    <h2>أشخاص يصنعون الأثر.</h2>
    <p>نظرة سريعة على رأس المال البشري، والإجراءات التي تحتاج إلى انتباهك.</p>
    <div className="people-welcome-stats">{stats.map(item => <div key={item.label}><strong>{item.value}</strong><span>{item.label}</span></div>)}</div>
  </section>;
}
