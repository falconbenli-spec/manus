/**
 * Learning & Development - HCM Platform
 * Full CRUD: add/edit/delete courses and certificates
 */
import { useState, useMemo } from "react";
import { BookOpen, Inbox, Plus, Trash2, Edit2, X, Check, Award, Users, Download, Brain } from "lucide-react";
import { LearningHubContent } from "./LearningHub";
import { exportTraining } from "@/lib/excelExport";
import PageTemplate from "@/components/layout/PageTemplate";
import { useEmployees } from "@/contexts/EmployeeContext";
import { toast } from "sonner";

interface Course {
  id: number; title: string; category: string; provider: string;
  duration: string; level: string; enrolledCount: number; status: string;
}
interface Certificate {
  id: number; employeeId: string; employeeName: string; courseName: string;
  provider: string; issueDate: string; expiryDate: string;
}

const thS: React.CSSProperties = { padding:"10px 12px",textAlign:"right",fontFamily:"Alexandria",fontSize:"11px",fontWeight:700,color:"hsl(0 0% 50%)",whiteSpace:"nowrap",borderBottom:"1px solid hsl(0 0% 26%)",background:"hsl(0 0% 18%)" };
const tdS: React.CSSProperties = { padding:"10px 12px",textAlign:"right",fontFamily:"Alexandria",fontSize:"12px",color:"hsl(0 0% 80%)",borderBottom:"1px solid hsl(0 0% 20%)" };

let nextCourseId = 1;
let nextCertId = 1;

const categories = ['تقني', 'إداري', 'قيادي', 'مهاري', 'سلامة', 'مالي', 'أخرى'];
const levels = ['مبتدئ', 'متوسط', 'متقدم'];
const peoplePrimary = "hsl(var(--primary))";

function CourseModal({ course, onSave, onClose }: { course?: Course; onSave: (c: Course) => void; onClose: () => void }) {
  const [form, setForm] = useState<Omit<Course,'id'>>({
    title: course?.title || '', category: course?.category || 'تقني',
    provider: course?.provider || '', duration: course?.duration || '',
    level: course?.level || 'متوسط', enrolledCount: course?.enrolledCount || 0,
    status: course?.status || 'نشط',
  });
  const set = (k: keyof typeof form, v: string | number) => setForm(p => ({ ...p, [k]: v }));
  function save() {
    if (!form.title.trim()) { toast.error("يرجى إدخال اسم الدورة"); return; }
    onSave({ id: course?.id ?? nextCourseId++, ...form });
  }
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.7)' }}>
      <div className="rounded-2xl p-6 w-full max-w-md" style={{ background: 'hsl(0 0% 18%)', border: '1px solid hsl(0 0% 28%)', direction: 'rtl' }}>
        <div className="flex items-center justify-between mb-5">
          <h3 style={{ fontFamily: 'Alexandria', fontWeight: 800, fontSize: '16px', color: peoplePrimary }}>{course ? 'تعديل دورة' : 'إضافة دورة جديدة'}</h3>
          <button onClick={onClose}><X size={18} color="hsl(0 0% 55%)" /></button>
        </div>
        <div className="flex flex-col gap-3">
          {[['title','اسم الدورة *'],['provider','الجهة المقدمة'],['duration','المدة (مثال: 3 أيام)']].map(([k,label]) => (
            <div key={k}>
              <label style={{ fontFamily:'Alexandria',fontSize:'12px',color:'hsl(0 0% 60%)',display:'block',marginBottom:'4px' }}>{label}</label>
              <input value={(form as any)[k]} onChange={e => set(k as any, e.target.value)}
                style={{ width:'100%',padding:'8px 12px',borderRadius:'8px',background:'hsl(0 0% 26%)',border:'1px solid hsl(0 0% 33%)',color:'hsl(0 0% 88%)',fontFamily:'Alexandria',fontSize:'13px',outline:'none' }} />
            </div>
          ))}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label style={{ fontFamily:'Alexandria',fontSize:'12px',color:'hsl(0 0% 60%)',display:'block',marginBottom:'4px' }}>التصنيف</label>
              <select value={form.category} onChange={e => set('category', e.target.value)}
                style={{ width:'100%',padding:'8px 12px',borderRadius:'8px',background:'hsl(0 0% 26%)',border:'1px solid hsl(0 0% 33%)',color:'hsl(0 0% 88%)',fontFamily:'Alexandria',fontSize:'13px',outline:'none' }}>
                {categories.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div>
              <label style={{ fontFamily:'Alexandria',fontSize:'12px',color:'hsl(0 0% 60%)',display:'block',marginBottom:'4px' }}>المستوى</label>
              <select value={form.level} onChange={e => set('level', e.target.value)}
                style={{ width:'100%',padding:'8px 12px',borderRadius:'8px',background:'hsl(0 0% 26%)',border:'1px solid hsl(0 0% 33%)',color:'hsl(0 0% 88%)',fontFamily:'Alexandria',fontSize:'13px',outline:'none' }}>
                {levels.map(l => <option key={l} value={l}>{l}</option>)}
              </select>
            </div>
          </div>
          <div className="flex gap-3 mt-2">
            <button className="btn-brand flex-1 flex items-center justify-center gap-2" onClick={save}><Check size={14}/><span>حفظ</span></button>
            <button onClick={onClose} className="flex-1 rounded-lg py-2 text-sm font-semibold" style={{ fontFamily:'Alexandria',background:'hsl(0 0% 26%)',border:'1px solid hsl(0 0% 33%)',color:'hsl(0 0% 70%)' }}>إلغاء</button>
          </div>
        </div>
      </div>
    </div>
  );
}

function CertModal({ cert, employees, courses, onSave, onClose }: { cert?: Certificate; employees: {employeeId:string;nameAr:string}[]; courses: Course[]; onSave: (c: Certificate) => void; onClose: () => void }) {
  const [form, setForm] = useState<Omit<Certificate,'id'>>({
    employeeId: cert?.employeeId || employees[0]?.employeeId || '',
    employeeName: cert?.employeeName || employees[0]?.nameAr || '',
    courseName: cert?.courseName || courses[0]?.title || '',
    provider: cert?.provider || '', issueDate: cert?.issueDate || new Date().toISOString().slice(0,10),
    expiryDate: cert?.expiryDate || '',
  });
  const set = (k: keyof typeof form, v: string) => setForm(p => ({ ...p, [k]: v }));
  function selectEmp(id: string) {
    const emp = employees.find(e => e.employeeId === id);
    setForm(p => ({ ...p, employeeId: id, employeeName: emp?.nameAr || '' }));
  }
  function save() {
    if (!form.employeeId || !form.courseName.trim()) { toast.error("يرجى ملء الحقول المطلوبة"); return; }
    onSave({ id: cert?.id ?? nextCertId++, ...form });
  }
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.7)' }}>
      <div className="rounded-2xl p-6 w-full max-w-md" style={{ background: 'hsl(0 0% 18%)', border: '1px solid hsl(0 0% 28%)', direction: 'rtl' }}>
        <div className="flex items-center justify-between mb-5">
          <h3 style={{ fontFamily: 'Alexandria', fontWeight: 800, fontSize: '16px', color: peoplePrimary }}>{cert ? 'تعديل شهادة' : 'إضافة شهادة'}</h3>
          <button onClick={onClose}><X size={18} color="hsl(0 0% 55%)" /></button>
        </div>
        <div className="flex flex-col gap-3">
          <div>
            <label style={{ fontFamily:'Alexandria',fontSize:'12px',color:'hsl(0 0% 60%)',display:'block',marginBottom:'4px' }}>الموظف *</label>
            <select value={form.employeeId} onChange={e => selectEmp(e.target.value)}
              style={{ width:'100%',padding:'8px 12px',borderRadius:'8px',background:'hsl(0 0% 26%)',border:'1px solid hsl(0 0% 33%)',color:'hsl(0 0% 88%)',fontFamily:'Alexandria',fontSize:'13px',outline:'none' }}>
              {employees.map(e => <option key={e.employeeId} value={e.employeeId}>{e.nameAr}</option>)}
            </select>
          </div>
          <div>
            <label style={{ fontFamily:'Alexandria',fontSize:'12px',color:'hsl(0 0% 60%)',display:'block',marginBottom:'4px' }}>اسم الدورة / الشهادة *</label>
            <input value={form.courseName} onChange={e => set('courseName', e.target.value)}
              style={{ width:'100%',padding:'8px 12px',borderRadius:'8px',background:'hsl(0 0% 26%)',border:'1px solid hsl(0 0% 33%)',color:'hsl(0 0% 88%)',fontFamily:'Alexandria',fontSize:'13px',outline:'none' }} />
          </div>
          <div>
            <label style={{ fontFamily:'Alexandria',fontSize:'12px',color:'hsl(0 0% 60%)',display:'block',marginBottom:'4px' }}>الجهة المانحة</label>
            <input value={form.provider} onChange={e => set('provider', e.target.value)}
              style={{ width:'100%',padding:'8px 12px',borderRadius:'8px',background:'hsl(0 0% 26%)',border:'1px solid hsl(0 0% 33%)',color:'hsl(0 0% 88%)',fontFamily:'Alexandria',fontSize:'13px',outline:'none' }} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label style={{ fontFamily:'Alexandria',fontSize:'12px',color:'hsl(0 0% 60%)',display:'block',marginBottom:'4px' }}>تاريخ الإصدار</label>
              <input type="date" value={form.issueDate} onChange={e => set('issueDate', e.target.value)}
                style={{ width:'100%',padding:'8px 12px',borderRadius:'8px',background:'hsl(0 0% 26%)',border:'1px solid hsl(0 0% 33%)',color:'hsl(0 0% 88%)',fontFamily:'Alexandria',fontSize:'13px',outline:'none' }} />
            </div>
            <div>
              <label style={{ fontFamily:'Alexandria',fontSize:'12px',color:'hsl(0 0% 60%)',display:'block',marginBottom:'4px' }}>تاريخ الانتهاء</label>
              <input type="date" value={form.expiryDate} onChange={e => set('expiryDate', e.target.value)}
                style={{ width:'100%',padding:'8px 12px',borderRadius:'8px',background:'hsl(0 0% 26%)',border:'1px solid hsl(0 0% 33%)',color:'hsl(0 0% 88%)',fontFamily:'Alexandria',fontSize:'13px',outline:'none' }} />
            </div>
          </div>
          <div className="flex gap-3 mt-2">
            <button className="btn-brand flex-1 flex items-center justify-center gap-2" onClick={save}><Check size={14}/><span>حفظ</span></button>
            <button onClick={onClose} className="flex-1 rounded-lg py-2 text-sm font-semibold" style={{ fontFamily:'Alexandria',background:'hsl(0 0% 26%)',border:'1px solid hsl(0 0% 33%)',color:'hsl(0 0% 70%)' }}>إلغاء</button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function Learning() {
  const { employees } = useEmployees();
  const [activeTab, setActiveTab] = useState<"catalog" | "certificates" | "hub">("catalog");
  const [courses, setCourses] = useState<Course[]>([]);
  const [certs, setCerts] = useState<Certificate[]>([]);
  const [showCourseModal, setShowCourseModal] = useState(false);
  const [showCertModal, setShowCertModal] = useState(false);
  const [editCourse, setEditCourse] = useState<Course | undefined>();
  const [editCert, setEditCert] = useState<Certificate | undefined>();

  const totalEnrolled = useMemo(() => courses.reduce((s,c) => s + c.enrolledCount, 0), [courses]);

  function saveCourse(c: Course) {
    setCourses(prev => prev.some(x => x.id === c.id) ? prev.map(x => x.id === c.id ? c : x) : [c, ...prev]);
    toast.success(editCourse ? "تم تحديث الدورة" : "تمت إضافة الدورة بنجاح");
    setShowCourseModal(false); setEditCourse(undefined);
  }
  function deleteCourse(id: number) {
    setCourses(prev => prev.filter(c => c.id !== id));
    toast.success("تم حذف الدورة");
  }
  function saveCert(c: Certificate) {
    setCerts(prev => prev.some(x => x.id === c.id) ? prev.map(x => x.id === c.id ? c : x) : [c, ...prev]);
    toast.success(editCert ? "تم تحديث الشهادة" : "تمت إضافة الشهادة بنجاح");
    setShowCertModal(false); setEditCert(undefined);
  }
  function deleteCert(id: number) {
    setCerts(prev => prev.filter(c => c.id !== id));
    toast.success("تم حذف الشهادة");
  }

  const levelColors: Record<string, string> = { 'مبتدئ': '#10B981', 'متوسط': '#F59E0B', 'متقدم': '#EF4444' };

  return (
    <PageTemplate
      title="التدريب والتطوير"
      subtitle="إدارة برامج التدريب والتعلم المستمر"
      icon={BookOpen}
      stats={[
        { label: "دورات متاحة", value: String(courses.length), color: peoplePrimary },
        { label: "موظفون مسجلون", value: String(totalEnrolled), color: "hsl(165 60% 55%)" },
        { label: "شهادات مُصدرة", value: String(certs.length), color: "#F59E0B" },
        { label: "تصنيفات", value: String(new Set(courses.map(c=>c.category)).size), color: "#8B5CF6" },
      ]}
      actions={
        <div className="flex gap-2">
          <button className="btn-brand flex items-center gap-2" onClick={() => { setEditCourse(undefined); setShowCourseModal(true); }}>
            <BookOpen size={14} /><span>إضافة دورة</span>
          </button>
          <button className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-semibold"
            style={{ fontFamily: 'Alexandria', background: 'hsl(0 0% 26%)', border: '1px solid hsl(0 0% 28%)', color: 'hsl(0 0% 75%)' }}
            onClick={() => { setEditCert(undefined); setShowCertModal(true); }}>
            <Award size={14} /><span>إضافة شهادة</span>
          </button>
          <button className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-semibold"
            style={{ fontFamily: 'Alexandria', background: 'hsl(0 0% 26%)', border: '1px solid hsl(0 0% 28%)', color: 'hsl(0 0% 75%)' }}
            onClick={() => exportTraining(courses)}>
            <Download size={14} /><span>تصدير Excel</span>
          </button>
        </div>
      }
    >
      {/* Tabs */}
      <div className="flex items-center gap-1 p-1 rounded-lg w-fit" style={{ background: 'hsl(0 0% 18%)', border: '1px solid hsl(0 0% 24%)' }}>
        {[{ key: "catalog", label: "كتالوج الدورات" }, { key: "certificates", label: "الشهادات" }, { key: "hub", label: "مركز التعلم" }].map(tab => (
          <button key={tab.key} onClick={() => setActiveTab(tab.key as any)}
            className="px-4 py-2 rounded-md text-sm font-semibold transition-all"
            style={{ fontFamily: 'Alexandria', background: activeTab === tab.key ? peoplePrimary : 'transparent', color: activeTab === tab.key ? 'white' : 'hsl(0 0% 60%)' }}>
            {tab.label}
          </button>
        ))}
      </div>

      {/* Courses */}
      {activeTab === "catalog" && (
        courses.length === 0 ? (
          <div className="card-brand rounded-xl p-6 flex flex-col items-center justify-center gap-3 py-16">
            <Inbox size={32} color="#1FA98C" style={{ opacity: 0.5 }} />
            <p style={{ fontFamily:'Alexandria',fontWeight:700,fontSize:'14px',color:'hsl(0 0% 55%)' }}>لا توجد دورات تدريبية بعد</p>
            <button className="btn-brand flex items-center gap-2 mt-2" onClick={() => { setEditCourse(undefined); setShowCourseModal(true); }}>
              <Plus size={14}/><span>إضافة دورة</span>
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {courses.map(c => (
              <div key={c.id} className="card-brand rounded-xl p-4 flex flex-col gap-3">
                <div className="flex items-start justify-between">
                  <div>
                    <p style={{ fontFamily:'Alexandria',fontWeight:800,fontSize:'14px',color:'hsl(0 0% 88%)' }}>{c.title}</p>
                    <p style={{ fontFamily:'Alexandria',fontSize:'12px',color:'hsl(0 0% 55%)',marginTop:'2px' }}>{c.provider}</p>
                  </div>
                  <div className="flex gap-1">
                    <button onClick={() => { setEditCourse(c); setShowCourseModal(true); }} style={{ padding:'4px 8px',borderRadius:'6px',background:'rgba(59,130,246,0.12)',color:'#3B82F6',border:'none',cursor:'pointer' }}><Edit2 size={12}/></button>
                    <button onClick={() => deleteCourse(c.id)} style={{ padding:'4px 8px',borderRadius:'6px',background:'rgba(239,68,68,0.12)',color:'#EF4444',border:'none',cursor:'pointer' }}><Trash2 size={12}/></button>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <span style={{ fontFamily:'Alexandria',fontSize:'11px',padding:'3px 10px',borderRadius:'20px',background:'hsl(165 69% 39% / 0.12)',color:'#1FA98C' }}>{c.category}</span>
                  <span style={{ fontFamily:'Alexandria',fontSize:'11px',padding:'3px 10px',borderRadius:'20px',background:`${levelColors[c.level]||'#888'}20`,color:levelColors[c.level]||'#888' }}>{c.level}</span>
                  {c.duration && <span style={{ fontFamily:'Alexandria',fontSize:'11px',padding:'3px 10px',borderRadius:'20px',background:'rgba(139,92,246,0.12)',color:'#8B5CF6' }}>{c.duration}</span>}
                </div>
                <div className="flex items-center gap-2">
                  <Users size={12} color="hsl(0 0% 50%)" />
                  <span style={{ fontFamily:'Alexandria',fontSize:'11px',color:'hsl(0 0% 55%)' }}>{c.enrolledCount} مسجل</span>
                </div>
              </div>
            ))}
          </div>
        )
      )}

      {/* Certificates */}
      {activeTab === "certificates" && (
        <div className="card-brand rounded-xl overflow-hidden">
          {certs.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 gap-3">
              <Inbox size={32} color="#1FA98C" style={{ opacity: 0.5 }} />
              <p style={{ fontFamily:'Alexandria',fontWeight:700,fontSize:'14px',color:'hsl(0 0% 55%)' }}>لا توجد شهادات مُصدرة بعد</p>
              <button className="btn-brand flex items-center gap-2 mt-2" onClick={() => { setEditCert(undefined); setShowCertModal(true); }}>
                <Plus size={14}/><span>إضافة شهادة</span>
              </button>
            </div>
          ) : (
            <table className="data-table">
              <thead>
                <tr>
                  <th style={thS}>الموظف</th>
                  <th style={thS}>الشهادة</th>
                  <th style={thS}>الجهة المانحة</th>
                  <th style={thS}>تاريخ الإصدار</th>
                  <th style={thS}>تاريخ الانتهاء</th>
                  <th style={thS}>الإجراءات</th>
                </tr>
              </thead>
              <tbody>
                {certs.map(c => (
                  <tr key={c.id}>
                    <td style={{ ...tdS, fontWeight: 700 }}>{c.employeeName}</td>
                    <td style={{ ...tdS, color:'#1FA98C',fontWeight:600 }}>{c.courseName}</td>
                    <td style={{ ...tdS, color:'hsl(0 0% 65%)' }}>{c.provider}</td>
                    <td style={{ ...tdS, color:'hsl(0 0% 60%)' }}>{c.issueDate}</td>
                    <td style={{ ...tdS, color: c.expiryDate ? 'hsl(0 0% 60%)' : 'hsl(0 0% 40%)' }}>{c.expiryDate || '—'}</td>
                    <td style={tdS}>
                      <div className="flex gap-2">
                        <button onClick={() => { setEditCert(c); setShowCertModal(true); }} style={{ padding:'4px 8px',borderRadius:'6px',background:'rgba(59,130,246,0.12)',color:'#3B82F6',border:'none',cursor:'pointer' }}><Edit2 size={12}/></button>
                        <button onClick={() => deleteCert(c.id)} style={{ padding:'4px 8px',borderRadius:'6px',background:'rgba(239,68,68,0.12)',color:'#EF4444',border:'none',cursor:'pointer' }}><Trash2 size={12}/></button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* Learning Hub Tab */}
      {activeTab === "hub" && (
        <LearningHubContent />
      )}

      {showCourseModal && <CourseModal course={editCourse} onSave={saveCourse} onClose={() => { setShowCourseModal(false); setEditCourse(undefined); }} />}
      {showCertModal && <CertModal cert={editCert} employees={employees} courses={courses} onSave={saveCert} onClose={() => { setShowCertModal(false); setEditCert(undefined); }} />}
    </PageTemplate>
  );
}
