/**
 * Performance Management - HCM Platform
 * Design: People36t theme tokens, Alexandria font, RTL
 * Data: protected /api/hcm/performance records scoped by the active session
 */
import { useState, useMemo, useEffect } from "react";
import { BarChart2, Search, Award, Target, TrendingUp, Users, Edit2, Trash2, X, Check, Download } from "lucide-react";
import { PerformanceImprovementPlans } from "@/components/performance/PerformanceImprovementPlans";
import { OneOnOneMeetings } from "@/components/performance/OneOnOneMeetings";
import PageTemplate from "@/components/layout/PageTemplate";
import { toast } from "sonner";
import { exportPerformance } from "@/lib/excelExport";

interface PerfRecord {
  employeeId: string; nameAr: string; department: string; jobTitle: string;
  reviewPeriod: string; score: number; rating: string;
  goalsCompleted: number; goalsPending: number; status: string;
}

const peoplePrimary = "hsl(var(--primary))";

function EditModal({ record, onSave, onClose }: { record: PerfRecord; onSave: (r: PerfRecord) => void; onClose: () => void }) {
  const [form, setForm] = useState({ ...record });
  const set = (k: keyof PerfRecord, v: string | number) => setForm(p => ({ ...p, [k]: v }));
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.7)' }}>
      <div className="rounded-2xl p-6 w-full max-w-md" style={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', direction: 'rtl' }}>
        <div className="flex items-center justify-between mb-5">
          <h3 style={{ fontFamily: 'Alexandria', fontWeight: 800, fontSize: '16px', color: peoplePrimary }}>تعديل تقييم: {record.nameAr}</h3>
          <button onClick={onClose}><X size={18} color="hsl(var(--muted-foreground))" /></button>
        </div>
        <div className="flex flex-col gap-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label style={{ fontFamily:'Alexandria',fontSize:'12px',color:'hsl(var(--muted-foreground))',display:'block',marginBottom:'4px' }}>الدرجة (0-100)</label>
              <input type="number" min={0} max={100} value={form.score} onChange={e => set('score', Number(e.target.value))}
                style={{ width:'100%',padding:'8px 12px',borderRadius:'8px',background:'hsl(var(--border))',border:'1px solid hsl(var(--border))',color:'hsl(var(--foreground))',fontFamily:'Alexandria',fontSize:'13px',outline:'none' }} />
            </div>
            <div>
              <label style={{ fontFamily:'Alexandria',fontSize:'12px',color:'hsl(var(--muted-foreground))',display:'block',marginBottom:'4px' }}>التقييم</label>
              <select value={form.rating} onChange={e => set('rating', e.target.value)}
                style={{ width:'100%',padding:'8px 12px',borderRadius:'8px',background:'hsl(var(--border))',border:'1px solid hsl(var(--border))',color:'hsl(var(--foreground))',fontFamily:'Alexandria',fontSize:'13px',outline:'none' }}>
                {['ممتاز','جيد جداً','جيد','مقبول','يحتاج تحسين'].map(r => <option key={r} value={r}>{r}</option>)}
              </select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label style={{ fontFamily:'Alexandria',fontSize:'12px',color:'hsl(var(--muted-foreground))',display:'block',marginBottom:'4px' }}>أهداف منجزة</label>
              <input type="number" min={0} value={form.goalsCompleted} onChange={e => set('goalsCompleted', Number(e.target.value))}
                style={{ width:'100%',padding:'8px 12px',borderRadius:'8px',background:'hsl(var(--border))',border:'1px solid hsl(var(--border))',color:'hsl(var(--foreground))',fontFamily:'Alexandria',fontSize:'13px',outline:'none' }} />
            </div>
            <div>
              <label style={{ fontFamily:'Alexandria',fontSize:'12px',color:'hsl(var(--muted-foreground))',display:'block',marginBottom:'4px' }}>أهداف معلقة</label>
              <input type="number" min={0} value={form.goalsPending} onChange={e => set('goalsPending', Number(e.target.value))}
                style={{ width:'100%',padding:'8px 12px',borderRadius:'8px',background:'hsl(var(--border))',border:'1px solid hsl(var(--border))',color:'hsl(var(--foreground))',fontFamily:'Alexandria',fontSize:'13px',outline:'none' }} />
            </div>
          </div>
          <div>
            <label style={{ fontFamily:'Alexandria',fontSize:'12px',color:'hsl(var(--muted-foreground))',display:'block',marginBottom:'4px' }}>الحالة</label>
            <select value={form.status} onChange={e => set('status', e.target.value)}
              style={{ width:'100%',padding:'8px 12px',borderRadius:'8px',background:'hsl(var(--border))',border:'1px solid hsl(var(--border))',color:'hsl(var(--foreground))',fontFamily:'Alexandria',fontSize:'13px',outline:'none' }}>
              {['مكتمل','قيد المراجعة','معلق'].map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div className="flex gap-3 mt-2">
            <button className="btn-brand flex-1 flex items-center justify-center gap-2" onClick={() => onSave(form)}><Check size={14}/><span>حفظ</span></button>
            <button onClick={onClose} className="flex-1 rounded-lg py-2 text-sm font-semibold" style={{ fontFamily:'Alexandria',background:'hsl(var(--border))',border:'1px solid hsl(var(--border))',color:'hsl(var(--muted-foreground))' }}>إلغاء</button>
          </div>
        </div>
      </div>
    </div>
  );
}
const ratingColors: Record<string, { color: string; bg: string }> = {
  "ممتاز":       { color: peoplePrimary, bg: "hsl(var(--primary) / .12)" },
  "جيد جداً":    { color: "hsl(165 60% 55%)", bg: "rgba(27,201,158,0.12)" },
  "جيد":         { color: "#3B82F6", bg: "rgba(59,130,246,0.12)" },
  "مقبول":       { color: "#F59E0B", bg: "rgba(245,158,11,0.12)" },
  "يحتاج تحسين": { color: "#EF4444", bg: "rgba(239,68,68,0.12)" },
};
const thS: React.CSSProperties = { padding:"10px 12px",textAlign:"right",fontFamily:"Alexandria",fontSize:"11px",fontWeight:700,color:"hsl(var(--muted-foreground))",whiteSpace:"nowrap",borderBottom:"1px solid hsl(var(--border))",background:"hsl(var(--card))" };
const tdS: React.CSSProperties = { padding:"10px 12px",textAlign:"right",fontFamily:"Alexandria",fontSize:"12px",color:"hsl(var(--foreground))",borderBottom:"1px solid hsl(var(--card))" };

export default function Performance() {
  const [data, setData] = useState<PerfRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [filterRating, setFilterRating] = useState("الكل");
  const [filterDept, setFilterDept] = useState("الكل");
  const [activeTab, setActiveTab] = useState<"overview"|"reviews"|"pip"|"meetings">("overview");
  const [editRecord, setEditRecord] = useState<PerfRecord | null>(null);

  useEffect(() => {
    fetch("/api/hcm/performance", { credentials: "include" })
      .then(r => r.ok ? r.json() : [])
      .then(d => {
        const mappedData = d.map((item: any) => ({
          employeeId: item.employee_id || item.employeeId,
          nameAr: item.name_ar || item.nameAr,
          department: item.department_en || item.department,
          jobTitle: item.job_title || item.jobTitle,
          reviewPeriod: item.review_period || item.reviewPeriod,
          score: item.score,
          rating: item.rating,
          goalsCompleted: item.goals_completed || item.goalsCompleted,
          goalsPending: item.goals_pending || item.goalsPending,
          status: item.status
        }));
        setData(mappedData);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  async function saveEdit(updated: PerfRecord) {
    try {
      const response = await fetch("/api/hcm/performance", {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          employeeId: updated.employeeId,
          reviewPeriod: updated.reviewPeriod,
          score: updated.score,
          rating: updated.rating,
          goalsCompleted: updated.goalsCompleted,
          goalsPending: updated.goalsPending,
          status: updated.status,
        }),
      });
      if (!response.ok) throw new Error("تعذر حفظ التقييم");
      setData(prev => prev.map(r => r.employeeId === updated.employeeId && r.reviewPeriod === updated.reviewPeriod ? updated : r));
      setEditRecord(null);
      toast.success("تم حفظ التقييم في السجل المعتمد");
    } catch {
      toast.error("تعذر حفظ التقييم. لم يتم إجراء أي تعديل محلي.");
    }
  }
  function deleteRecord(id: string) {
    void id;
    toast.error("حذف التقييمات يتطلب مساراً إدارياً معتمداً.");
  }

  const departments = useMemo(() => ["الكل",...Array.from(new Set(data.map(r=>r.department))).sort()], [data]);
  const filtered = useMemo(() => {
    let rows = [...data];
    if (search.trim()) { const q=search.trim().toLowerCase(); rows=rows.filter(r=>r.nameAr.includes(q)||r.department.includes(q)); }
    if (filterRating!=="الكل") rows=rows.filter(r=>r.rating===filterRating);
    if (filterDept!=="الكل") rows=rows.filter(r=>r.department===filterDept);
    return rows;
  },[data, search,filterRating,filterDept]);

  const kpis = useMemo(()=>({
    avgScore: data.length ? Math.round(data.reduce((s,r)=>s+r.score,0)/data.length) : 0,
    excellent: data.filter(r=>r.rating==="ممتاز").length,
    needsImprovement: data.filter(r=>r.rating==="يحتاج تحسين").length,
    completed: data.filter(r=>r.status==="مكتمل").length,
    totalGoalsCompleted: data.reduce((s,r)=>s+r.goalsCompleted,0),
  }),[data]);

  const ratingDist = useMemo(()=>{
    const ratings = ["ممتاز","جيد جداً","جيد","مقبول","يحتاج تحسين"];
    return ratings.map(r=>({ rating:r, count:data.filter(d=>d.rating===r).length, pct: data.length ? Math.round(data.filter(d=>d.rating===r).length/data.length*100) : 0 }));
  },[data]);

  const departmentKpis = useMemo(() => Object.values(data.reduce<Record<string, { department: string; employees: number; totalScore: number; completed: number; goalsCompleted: number }>>((groups, record) => {
    const department = record.department || "غير محددة";
    const group = groups[department] || { department, employees: 0, totalScore: 0, completed: 0, goalsCompleted: 0 };
    group.employees += 1;
    group.totalScore += record.score || 0;
    group.completed += record.status === "مكتمل" ? 1 : 0;
    group.goalsCompleted += record.goalsCompleted || 0;
    groups[department] = group;
    return groups;
  }, {})).map((group) => ({ ...group, averageScore: Math.round(group.totalScore / group.employees) })).sort((a, b) => b.averageScore - a.averageScore), [data]);

  if (loading) {
    return (
      <PageTemplate title="الأداء والتقييم" subtitle="جاري التحميل..." icon={BarChart2}>
        <div className="flex items-center justify-center h-64">
          <div className="text-brand">جاري تحميل البيانات...</div>
        </div>
      </PageTemplate>
    );
  }

  return (
    <PageTemplate title="الأداء والتقييم" subtitle={`تقييمات الربع الأول 2026 — ${data.length} موظف`} icon={BarChart2}
      stats={[
        {label:"متوسط الأداء",value:`${kpis.avgScore}%`,color:peoplePrimary},
        {label:"تقييمات مكتملة",value:String(kpis.completed),color:"#10B981"},
        {label:"تقييم ممتاز",value:String(kpis.excellent),color:"hsl(165 60% 55%)"},
        {label:"يحتاج تحسين",value:String(kpis.needsImprovement),color:"#EF4444"},
      ]}
      actions={<div className="flex items-center gap-2"><button className="btn-brand flex items-center gap-2" onClick={() => setActiveTab("reviews")}><Check size={14}/><span>عرض التقييمات المعتمدة</span></button><button className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-semibold" style={{fontFamily:'Alexandria',background:'hsl(165 69% 39% / 0.15)',color:'#1FA98C',border:'1px solid hsl(165 69% 39% / 0.30)'}} onClick={() => { exportPerformance(filtered); toast.success('جارٍ تحميل ملف Excel...'); }}><Download size={14}/><span>تصدير</span></button></div>}
    >
      <div style={{display:"flex",gap:"6px",marginBottom:"16px",direction:"rtl"}}>
{(["overview","reviews","pip","meetings"] as const).map(tab=> (
          <button key={tab} onClick={()=>setActiveTab(tab)}
            style={{padding:"7px 16px",borderRadius:"8px",fontFamily:"Alexandria",fontSize:"12px",fontWeight:700,
              background:activeTab===tab?peoplePrimary:"hsl(var(--muted))",
              border:`1px solid ${activeTab===tab?peoplePrimary:"hsl(var(--border))"}`,
              color:activeTab===tab?"white":"hsl(var(--muted-foreground))",cursor:"pointer",transition:"all 0.15s"}}>
            {tab==="overview" ? "نظرة عامة" : tab==="reviews" ? `التقييمات (${data.length})` : tab==="pip" ? "خطط التحسين" : "اجتماعات 1:1"}
          </button>
        ))}
      </div>

      {activeTab==="overview" && (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
            {[
              {label:"متوسط درجة الأداء",value:`${kpis.avgScore}/100`,icon:TrendingUp,color:peoplePrimary},
              {label:"أهداف منجزة",value:String(kpis.totalGoalsCompleted),icon:Target,color:"#8B5CF6"},
              {label:"تقييم ممتاز",value:String(kpis.excellent),icon:Award,color:"hsl(165 60% 55%)"},
              {label:"إجمالي الموظفين",value:String(data.length),icon:Users,color:"#3B82F6"},
            ].map((k,i)=>{const Icon=k.icon;return(
              <div key={k.label} className="stat-card animate-fade-in-up" style={{animationDelay:`${i*60}ms`,opacity:0}}>
                <div className="flex items-start justify-between mb-2">
                  <div style={{width:"36px",height:"36px",borderRadius:"10px",background:`${k.color}22`,display:"flex",alignItems:"center",justifyContent:"center"}}><Icon size={17} color={k.color}/></div>
                </div>
                <div style={{fontFamily:"Alexandria",fontWeight:800,fontSize:"15px",color:k.color}}>{k.value}</div>
                <div style={{fontFamily:"Alexandria",fontSize:"11px",color:"hsl(var(--muted-foreground))",marginTop:"2px"}}>{k.label}</div>
              </div>
            );})}
          </div>
          <div className="card-brand rounded-xl p-5">
            <div className="section-title">توزيع التقييمات</div>
            <div style={{display:"flex",flexDirection:"column",gap:"12px",direction:"rtl"}}>
              {ratingDist.map(({rating,count,pct})=>{
                const rc = ratingColors[rating]||{color:"#888",bg:"rgba(128,128,128,0.1)"};
                return(
                  <div key={rating} style={{display:"flex",alignItems:"center",gap:"12px"}}>
                    <span style={{fontFamily:"Alexandria",fontSize:"12px",fontWeight:600,color:rc.color,minWidth:"90px"}}>{rating}</span>
                    <div style={{flex:1,height:"8px",borderRadius:"4px",background:"hsl(var(--border))",overflow:"hidden"}}>
                      <div style={{width:`${pct}%`,height:"100%",borderRadius:"4px",background:rc.color,transition:"width 0.6s ease"}}/>
                    </div>
                    <span style={{fontFamily:"Alexandria",fontSize:"11px",color:"hsl(var(--muted-foreground))",minWidth:"80px",textAlign:"left"}}>{count} موظف ({pct}%)</span>
                  </div>
                );
              })}
            </div>
          </div>
          <div className="card-brand rounded-xl p-5 mt-5" style={{ direction: "rtl" }}>
            <div className="section-title">مؤشرات الأداء حسب الإدارة</div>
            {departmentKpis.length === 0 ? <p style={{ fontFamily: "Alexandria", fontSize: 12, color: "hsl(var(--muted-foreground))" }}>لا توجد سجلات أداء متاحة ضمن نطاق الصلاحية.</p> : <div style={{ overflowX: "auto" }}><table style={{ width: "100%", borderCollapse: "collapse" }}><thead><tr>{["الإدارة", "الموظفون", "متوسط الأداء", "تقييمات مكتملة", "أهداف منجزة"].map((heading) => <th key={heading} style={thS}>{heading}</th>)}</tr></thead><tbody>{departmentKpis.map((department) => <tr key={department.department}><td style={{ ...tdS, fontWeight: 700 }}>{department.department}</td><td style={tdS}>{department.employees}</td><td style={{ ...tdS, color: department.averageScore >= 75 ? "#1FA98C" : department.averageScore >= 50 ? "#F59E0B" : "#EF4444", fontWeight: 800 }}>{department.averageScore}/100</td><td style={tdS}>{department.completed}</td><td style={tdS}>{department.goalsCompleted}</td></tr>)}</tbody></table></div>}
          </div>
        </>
      )}

      {activeTab==="reviews" && (
        <>
          {data.length === 0 && (
            <div style={{textAlign:"center",padding:"60px 20px",color:"hsl(var(--muted-foreground))",fontFamily:"Alexandria"}}>
              <BarChart2 size={48} style={{margin:"0 auto 16px",opacity:0.3}} />
              <div style={{fontSize:"16px",fontWeight:700,marginBottom:"8px"}}>لا توجد تقييمات بعد</div>
              <div style={{fontSize:"13px"}}>سيتم عرض التقييمات هنا بعد إدخال البيانات</div>
            </div>
          )}
          {data.length > 0 && (
            <>
            <div style={{display:"flex",gap:"10px",marginBottom:"16px",flexWrap:"wrap",direction:"rtl"}}>
            <div style={{display:"flex",alignItems:"center",gap:"8px",background:"hsl(var(--card))",border:"1px solid hsl(var(--muted))",borderRadius:"8px",padding:"6px 12px",flex:1,minWidth:"200px"}}>
              <Search size={14} color="hsl(var(--muted-foreground))"/>
              <input type="text" value={search} onChange={e=>setSearch(e.target.value)} placeholder="بحث بالاسم أو القسم..."
                style={{background:"none",border:"none",outline:"none",fontFamily:"Alexandria",fontSize:"12px",color:"hsl(var(--muted-foreground))",direction:"rtl",width:"100%"}}/>
            </div>
            <select value={filterRating} onChange={e=>setFilterRating(e.target.value)}
              style={{background:"hsl(var(--card))",border:"1px solid hsl(var(--muted))",borderRadius:"8px",padding:"6px 12px",fontFamily:"Alexandria",fontSize:"12px",color:"hsl(var(--muted-foreground))",direction:"rtl"}}>
              {["الكل","ممتاز","جيد جداً","جيد","مقبول","يحتاج تحسين"].map(r=><option key={r} value={r}>{r}</option>)}
            </select>
            <select value={filterDept} onChange={e=>setFilterDept(e.target.value)}
              style={{background:"hsl(var(--card))",border:"1px solid hsl(var(--muted))",borderRadius:"8px",padding:"6px 12px",fontFamily:"Alexandria",fontSize:"12px",color:"hsl(var(--muted-foreground))",direction:"rtl",maxWidth:"200px"}}>
              {departments.map(d=><option key={d} value={d}>{d}</option>)}
            </select>
          </div>
          <div className="card-brand rounded-xl overflow-hidden">
            <div style={{overflowX:"auto"}}>
              <table style={{width:"100%",borderCollapse:"collapse",direction:"rtl"}}>
                <thead><tr>{["الرقم","الاسم","القسم","المسمى","الدرجة","التقييم","أهداف منجزة","أهداف معلقة","الحالة","الإجراءات"].map(h=><th key={h} style={thS}>{h}</th>)}</tr></thead>
                <tbody>
                  {filtered.map((r,idx)=>{
                    const rc=ratingColors[r.rating]||{color:"#888",bg:"rgba(128,128,128,0.1)"};
                    const statusC = r.status==="مكتمل" ? {color:"#1FA98C",bg:"hsl(165 69% 39% / 0.12)"} : {color:"#F59E0B",bg:"rgba(245,158,11,0.12)"};
                    return(
                      <tr key={r.employeeId} style={{background:idx%2===0?"transparent":"hsl(var(--card))"}}>
                        <td style={{...tdS,color:"#1FA98C",fontWeight:700}}>{r.employeeId}</td>
                        <td style={{...tdS,fontWeight:600,whiteSpace:"nowrap"}}>{r.nameAr}</td>
                        <td style={{...tdS,fontSize:"11px",color:"hsl(var(--muted-foreground))"}}>{r.department}</td>
                        <td style={{...tdS,fontSize:"11px",color:"hsl(var(--muted-foreground))",maxWidth:"150px",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{r.jobTitle}</td>
                        <td style={{...tdS,fontWeight:800}}>
                          <div style={{display:"flex",alignItems:"center",gap:"6px"}}>
                            <div style={{flex:1,height:"6px",borderRadius:"3px",background:"hsl(var(--border))",overflow:"hidden",minWidth:"50px"}}>
                              <div style={{width:`${r.score}%`,height:"100%",borderRadius:"3px",background:rc.color}}/>
                            </div>
                            <span style={{color:rc.color,fontSize:"11px",fontWeight:700,minWidth:"30px"}}>{r.score}</span>
                          </div>
                        </td>
                        <td style={tdS}><span style={{fontFamily:"Alexandria",fontSize:"11px",fontWeight:700,color:rc.color,background:rc.bg,padding:"3px 10px",borderRadius:"20px"}}>{r.rating}</span></td>
                        <td style={{...tdS,color:"#1FA98C",fontWeight:700,textAlign:"center"}}>{r.goalsCompleted}</td>
                        <td style={{...tdS,color:"#F59E0B",textAlign:"center"}}>{r.goalsPending}</td>
                        <td style={tdS}><span style={{fontFamily:"Alexandria",fontSize:"11px",fontWeight:700,color:statusC.color,background:statusC.bg,padding:"3px 10px",borderRadius:"20px"}}>{r.status}</span></td>
                        <td style={tdS}>
                          <div style={{display:'flex',gap:'6px'}}>
                            <button onClick={() => setEditRecord(r)} style={{padding:'4px 8px',borderRadius:'6px',background:'rgba(59,130,246,0.12)',color:'#3B82F6',border:'none',cursor:'pointer'}}><Edit2 size={12}/></button>
                            <button onClick={() => deleteRecord(r.employeeId)} style={{padding:'4px 8px',borderRadius:'6px',background:'rgba(239,68,68,0.12)',color:'#EF4444',border:'none',cursor:'pointer'}}><Trash2 size={12}/></button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
            </>
          )}
        </>
      )}
      {activeTab==="pip" && <PerformanceImprovementPlans />}
      {activeTab==="meetings" && <OneOnOneMeetings />}
      {editRecord && <EditModal record={editRecord} onSave={saveEdit} onClose={() => setEditRecord(null)} />}
    </PageTemplate>
  );
}
