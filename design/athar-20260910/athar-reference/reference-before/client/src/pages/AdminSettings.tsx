/**
 * Admin Settings — Full system settings with user management
 */
import { useState, useEffect, useRef } from "react";
import { useLocation } from "wouter";
import {
  Settings, Users, Lock, Bell, Globe, Database, Shield, Save,
  Inbox, Plus, Trash2, Edit2, X, Check, Key, Mail, Phone,
  RefreshCw, Download, Upload, AlertTriangle, CheckCircle,
  Wifi, Server, Clock, ToggleLeft, ToggleRight, MapPin, Navigation, Minus,
} from "lucide-react";
import { MapView } from "@/components/Map";
import PageTemplate from "@/components/layout/PageTemplate";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";

const peoplePrimary = "hsl(var(--primary))";
const peoplePrimarySoft = "hsl(var(--primary) / .15)";

// ─── Types ─────────────────────────────────────────────────────────────────────
interface SystemUser {
  id: string;
  name: string;
  email: string;
  role: string;
  status: "نشط" | "معطل";
  lastLogin: string;
}

const ROLES = [
  { id: 1, name: "مدير النظام", permissions: ["كل الصلاحيات"], color: "#EF4444" },
  { id: 2, name: "مدير رأس المال البشري", permissions: ["الموظفون", "الرواتب", "التقارير", "التوظيف"], color: peoplePrimary },
  { id: 3, name: "مشرف", permissions: ["الحضور", "الإجازات", "الأداء"], color: "#F59E0B" },
  { id: 4, name: "موظف", permissions: ["ملفه الشخصي", "طلبات الإجازة", "الراتب الخاص"], color: "#3B82F6" },
];

const settingsSections = [
  { key: "general", label: "الإعدادات العامة", icon: Settings },
  { key: "users", label: "المستخدمون والصلاحيات", icon: Users },
  { key: "security", label: "الأمان والخصوصية", icon: Lock },
  { key: "notifications", label: "الإشعارات", icon: Bell },
  { key: "geo", label: "النطاقات الجغرافية", icon: MapPin },
  { key: "exemptions", label: "استثناءات البصمة", icon: Shield },
  { key: "approvalChains", label: "سلسلة الموافقات", icon: CheckCircle },
  { key: "integrations", label: "التكاملات", icon: Globe },
  { key: "backup", label: "النسخ الاحتياطي", icon: Database },
];

// ─── Geo Locations Section ────────────────────────────────────────────────────
interface GeoLocation {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  radiusMeters: number;
  isActive: boolean;
  applicableServices: string;
  createdAt: number;
  updatedAt: number;
}

function GeoLocationsSection() {
  const [locations, setLocations] = useState<GeoLocation[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState({ name: '', latitude: 0, longitude: 0, radiusMeters: 200, isActive: true });
  const [saving, setSaving] = useState(false);
  const mapRef = useRef<google.maps.Map | null>(null);
  const circleRef = useRef<google.maps.Circle | null>(null);
  const markerRef = useRef<google.maps.marker.AdvancedMarkerElement | null>(null);

  const loadLocations = async () => {
    try {
      setLoading(true);
      const res = await fetch('/api/geo-locations', { credentials: 'include' });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      setLocations(Array.isArray(data) ? data : []);
    } catch (e: any) {
      toast.error('فشل تحميل المواقع: ' + e?.message);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { loadLocations(); }, []);

  const clearMapOverlays = () => {
    circleRef.current?.setMap(null);
    circleRef.current = null;
    if (markerRef.current) { markerRef.current.map = null; markerRef.current = null; }
  };

  const placeCircle = (lat: number, lng: number, radius: number) => {
    if (!mapRef.current) return;
    const center = { lat, lng };
    if (circleRef.current) {
      circleRef.current.setCenter(center);
      circleRef.current.setRadius(radius);
    } else {
      const circle = new window.google.maps.Circle({
        map: mapRef.current,
        center,
        radius,
        strokeColor: peoplePrimary,
        strokeOpacity: 0.9,
        strokeWeight: 2,
        fillColor: peoplePrimary,
        fillOpacity: 0.18,
        editable: true,
        draggable: true,
      });
      circle.addListener('radius_changed', () => {
        setForm(f => ({ ...f, radiusMeters: Math.round(circle.getRadius()) }));
      });
      circle.addListener('center_changed', () => {
        const c = circle.getCenter()!;
        const newLat = parseFloat(c.lat().toFixed(6));
        const newLng = parseFloat(c.lng().toFixed(6));
        setForm(f => ({ ...f, latitude: newLat, longitude: newLng }));
        if (markerRef.current) markerRef.current.position = { lat: newLat, lng: newLng };
      });
      circleRef.current = circle;
    }
    if (markerRef.current) {
      markerRef.current.position = center;
    } else {
      markerRef.current = new window.google.maps.marker.AdvancedMarkerElement({
        map: mapRef.current,
        position: center,
      });
    }
    mapRef.current.panTo(center);
  };

  const handleMapReady = (map: google.maps.Map) => {
    mapRef.current = map;
    map.addListener('click', (e: google.maps.MapMouseEvent) => {
      if (!e.latLng) return;
      const lat = parseFloat(e.latLng.lat().toFixed(6));
      const lng = parseFloat(e.latLng.lng().toFixed(6));
      setForm(f => {
        placeCircle(lat, lng, f.radiusMeters);
        return { ...f, latitude: lat, longitude: lng };
      });
    });
    if (form.latitude && form.longitude) {
      placeCircle(form.latitude, form.longitude, form.radiusMeters);
    }
  };

  const handleSave = async () => {
    if (!form.name || !form.latitude || !form.longitude) {
      toast.error('يرجى تعبئة اسم الموقع وتحديده على الخريطة');
      return;
    }
    setSaving(true);
    try {
      const body = {
        name: form.name,
        latitude: Number(form.latitude),
        longitude: Number(form.longitude),
        radiusMeters: Number(form.radiusMeters) || 200,
        isActive: form.isActive,
        applicableServices: '["attendance","time_tracker"]',
      };
      let res;
      if (editingId) {
        res = await fetch(`/api/geo-locations/${editingId}`, { method: 'PUT', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      } else {
        res = await fetch('/api/geo-locations', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      }
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'فشل الحفظ');
      }
      toast.success(editingId ? 'تم تحديث الموقع بنجاح' : 'تم إضافة الموقع بنجاح');
      setShowForm(false);
      setEditingId(null);
      setForm({ name: '', latitude: 0, longitude: 0, radiusMeters: 200, isActive: true });
      clearMapOverlays();
      mapRef.current = null;
      await loadLocations();
    } catch (e: any) {
      toast.error('حدث خطأ أثناء الحفظ: ' + e?.message);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string, name: string) => {
    if (!confirm(`هل تريد حذف الموقع "${name}"؟`)) return;
    try {
      const res = await fetch(`/api/geo-locations/${id}`, { method: 'DELETE', credentials: 'include' });
      if (!res.ok) throw new Error();
      toast.success('تم حذف الموقع');
      await loadLocations();
    } catch {
      toast.error('فشل حذف الموقع');
    }
  };

  const handleEdit = (loc: GeoLocation) => {
    clearMapOverlays();
    mapRef.current = null;
    setForm({ name: loc.name, latitude: loc.latitude, longitude: loc.longitude, radiusMeters: loc.radiusMeters, isActive: loc.isActive });
    setEditingId(loc.id);
    setShowForm(true);
  };

  const handleToggleActive = async (loc: GeoLocation) => {
    try {
      const res = await fetch(`/api/geo-locations/${loc.id}`, { method: 'PUT', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ isActive: !loc.isActive }) });
      if (!res.ok) throw new Error();
      toast.success(`تم ${!loc.isActive ? 'تفعيل' : 'تعطيل'} الموقع`);
      await loadLocations();
    } catch {
      toast.error('فشل تحديث الحالة');
    }
  };

  const handleGetCurrentLocation = () => {
    if (!navigator.geolocation) { toast.error('المتصفح لا يدعم تحديد الموقع'); return; }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const lat = parseFloat(pos.coords.latitude.toFixed(6));
        const lng = parseFloat(pos.coords.longitude.toFixed(6));
        setForm(f => ({ ...f, latitude: lat, longitude: lng }));
        placeCircle(lat, lng, form.radiusMeters);
        toast.success('تم تحديد موقعك الحالي');
      },
      () => toast.error('فشل تحديد الموقع. يرجى السماح بالوصول إلى الموقع الجغرافي')
    );
  };

  const geoInputStyle: React.CSSProperties = { fontFamily: 'Alexandria', background: 'hsl(0 0% 22%)', border: '1px solid hsl(0 0% 28%)', color: 'hsl(0 0% 88%)', direction: 'rtl', width: '100%', padding: '8px 12px', borderRadius: '8px', fontSize: '13px', outline: 'none' };

  return (
    <div className="space-y-4">
      {/* Locations List */}
      <div className="card-brand rounded-xl p-5">
        <div className="flex items-center justify-between mb-4">
          <div className="section-title" style={{ marginBottom: 0 }}>النطاقات الجغرافية للحضور</div>
          <button className="btn-brand flex items-center gap-2 px-3 py-2 text-sm" onClick={() => {
            clearMapOverlays(); mapRef.current = null;
            setShowForm(true); setEditingId(null);
            setForm({ name: '', latitude: 24.777044, longitude: 46.683644, radiusMeters: 200, isActive: true });
          }}>
            <Plus size={14} />إضافة موقع
          </button>
        </div>
        <p style={{ fontFamily: 'Alexandria', fontSize: '12px', color: 'hsl(0 0% 55%)', marginBottom: '12px' }}>
          حدد المواقع الجغرافية المسموح منها تسجيل الحضور. يُستخدم أول موقع نشط كنطاق افتراضي.
        </p>
        {loading ? (
          <div style={{ textAlign: 'center', padding: '20px', color: 'hsl(0 0% 55%)', fontFamily: 'Alexandria' }}>جارٍ التحميل...</div>
        ) : locations.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '20px', color: 'hsl(0 0% 55%)', fontFamily: 'Alexandria' }}>لا توجد مواقع مضافة بعد</div>
        ) : (
          <div className="space-y-2">
            {locations.map(loc => (
              <div key={loc.id} style={{ background: 'hsl(var(--muted))', borderRadius: '10px', padding: '12px 14px', border: `1px solid ${loc.isActive ? 'hsl(var(--primary) / .30)' : 'hsl(var(--border))'}` }}>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: loc.isActive ? peoplePrimary : 'hsl(var(--muted-foreground))' }} />
                    <div>
                      <div style={{ fontFamily: 'Alexandria', fontWeight: 700, fontSize: '14px', color: 'hsl(0 0% 88%)' }}>{loc.name}</div>
                      <div style={{ fontFamily: 'Alexandria', fontSize: '11px', color: 'hsl(0 0% 55%)', marginTop: '2px' }}>
                        نطاق: {loc.radiusMeters} م · {loc.latitude.toFixed(4)}, {loc.longitude.toFixed(4)}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="w-9 h-5 rounded-full relative cursor-pointer" style={{ background: loc.isActive ? peoplePrimary : 'hsl(var(--border))' }} onClick={() => handleToggleActive(loc)}>
                      <div className="absolute top-0.5 w-4 h-4 rounded-full" style={{ background: 'white', right: loc.isActive ? '2px' : 'auto', left: loc.isActive ? 'auto' : '2px', transition: 'all 0.2s' }} />
                    </div>
                    <button onClick={() => handleEdit(loc)} style={{ width: '30px', height: '30px', borderRadius: '8px', background: 'hsl(var(--muted))', border: '1px solid hsl(var(--border))', color: peoplePrimary, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}><Edit2 size={13} /></button>
                    <button onClick={() => handleDelete(loc.id, loc.name)} style={{ width: '30px', height: '30px', borderRadius: '8px', background: 'hsl(0 0% 26%)', border: '1px solid rgba(239,68,68,0.3)', color: '#EF4444', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}><Trash2 size={13} /></button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Add/Edit Form with Interactive Map */}
      {showForm && (
        <div className="card-brand rounded-xl p-5 space-y-4">
          <div className="flex items-center justify-between">
            <div className="section-title" style={{ marginBottom: 0 }}>{editingId ? 'تعديل الموقع' : 'إضافة موقع جديد'}</div>
            <button onClick={() => { setShowForm(false); setEditingId(null); clearMapOverlays(); mapRef.current = null; }} style={{ width: '28px', height: '28px', borderRadius: '6px', background: 'hsl(0 0% 26%)', border: '1px solid hsl(0 0% 33%)', color: 'hsl(0 0% 65%)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}><X size={14} /></button>
          </div>

          {/* Name */}
          <div>
            <label style={{ fontFamily: 'Alexandria', fontSize: '12px', color: 'hsl(0 0% 65%)', display: 'block', marginBottom: '4px' }}>اسم الموقع *</label>
            <input style={geoInputStyle} placeholder="مثال: مقر الشركة الرئيسي" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
          </div>

          {/* Interactive Map */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label style={{ fontFamily: 'Alexandria', fontSize: '12px', color: 'hsl(0 0% 65%)' }}>
                انقر على الخريطة لتحديد المركز، ثم اسحب حافة الدائرة لتغيير النطاق
              </label>
              <button onClick={handleGetCurrentLocation} className="flex items-center gap-1 px-2 py-1 rounded-lg text-xs" style={{ fontFamily: 'Alexandria', background: 'hsl(var(--primary) / .10)', border: '1px solid hsl(var(--primary) / .30)', color: peoplePrimary, cursor: 'pointer' }}>
                <Navigation size={12} />موقعي الحالي
              </button>
            </div>
            <div style={{ borderRadius: '10px', overflow: 'hidden', border: '1px solid hsl(var(--primary) / .30)', height: '320px' }}>
              <MapView
                initialCenter={{ lat: form.latitude || 24.777044, lng: form.longitude || 46.683644 }}
                initialZoom={16}
                onMapReady={handleMapReady}
              />
            </div>
          </div>

          {/* Radius Slider */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label style={{ fontFamily: 'Alexandria', fontSize: '12px', color: 'hsl(0 0% 65%)' }}>نطاق الحضور المسموح به</label>
              <span style={{ fontFamily: 'Alexandria', fontSize: '13px', fontWeight: 700, color: peoplePrimary }}>{form.radiusMeters} متر</span>
            </div>
            <div className="flex items-center gap-3">
              <button onClick={() => { const r = Math.max(50, form.radiusMeters - 25); setForm(f => ({ ...f, radiusMeters: r })); placeCircle(form.latitude, form.longitude, r); }} style={{ width: '28px', height: '28px', borderRadius: '6px', background: 'hsl(0 0% 26%)', border: '1px solid hsl(0 0% 33%)', color: 'hsl(0 0% 75%)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}><Minus size={12} /></button>
              <input
                type="range" min="50" max="2000" step="25"
                value={form.radiusMeters}
                onChange={e => { const r = Number(e.target.value); setForm(f => ({ ...f, radiusMeters: r })); placeCircle(form.latitude, form.longitude, r); }}
                style={{ flex: 1, accentColor: peoplePrimary }}
              />
              <button onClick={() => { const r = Math.min(2000, form.radiusMeters + 25); setForm(f => ({ ...f, radiusMeters: r })); placeCircle(form.latitude, form.longitude, r); }} style={{ width: '28px', height: '28px', borderRadius: '6px', background: 'hsl(0 0% 26%)', border: '1px solid hsl(0 0% 33%)', color: 'hsl(0 0% 75%)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}><Plus size={12} /></button>
            </div>
            <div className="flex justify-between mt-1">
              <span style={{ fontFamily: 'Alexandria', fontSize: '10px', color: 'hsl(0 0% 45%)' }}>50م (دقيق جداً)</span>
              <span style={{ fontFamily: 'Alexandria', fontSize: '10px', color: 'hsl(0 0% 45%)' }}>2000م (واسع)</span>
            </div>
          </div>

          {/* Coordinates display */}
          {(form.latitude !== 0 || form.longitude !== 0) && (
            <div style={{ background: 'hsl(0 0% 20%)', borderRadius: '8px', padding: '8px 12px', border: '1px solid hsl(0 0% 26%)' }}>
              <span style={{ fontFamily: 'Alexandria', fontSize: '11px', color: 'hsl(0 0% 55%)' }}>
                الإحداثيات: {Number(form.latitude).toFixed(6)}, {Number(form.longitude).toFixed(6)}
              </span>
            </div>
          )}

          {/* Active toggle */}
          <div className="flex items-center gap-3">
            <div className="w-10 h-5 rounded-full relative cursor-pointer" style={{ background: form.isActive ? peoplePrimary : 'hsl(var(--border))' }} onClick={() => setForm(f => ({ ...f, isActive: !f.isActive }))}>
              <div className="absolute top-0.5 w-4 h-4 rounded-full" style={{ background: 'white', right: form.isActive ? '2px' : 'auto', left: form.isActive ? 'auto' : '2px', transition: 'all 0.2s' }} />
            </div>
            <span style={{ fontFamily: 'Alexandria', fontSize: '13px', color: 'hsl(0 0% 75%)' }}>الموقع نشط</span>
          </div>

          {/* Actions */}
          <div className="flex gap-3 pt-1">
            <button className="btn-brand flex items-center gap-2 px-4 py-2" onClick={handleSave} disabled={saving}>
              <Check size={14} />{saving ? 'جارٍ الحفظ...' : 'حفظ الموقع'}
            </button>
            <button onClick={() => { setShowForm(false); setEditingId(null); clearMapOverlays(); mapRef.current = null; }} style={{ fontFamily: 'Alexandria', padding: '8px 16px', borderRadius: '8px', background: 'hsl(0 0% 26%)', color: 'hsl(0 0% 65%)', border: '1px solid hsl(0 0% 28%)', cursor: 'pointer', fontSize: '13px' }}>إلغاء</button>
          </div>
        </div>
      )}
    </div>
  );
}
const inputStyle: React.CSSProperties = {
  fontFamily: "Alexandria",
  background: "hsl(0 0% 22%)",
  border: "1px solid hsl(0 0% 28%)",
  color: "hsl(0 0% 88%)",
  direction: "rtl",
  width: "100%",
  padding: "8px 12px",
  borderRadius: "8px",
  fontSize: "13px",
  outline: "none",
};

// ─── Add User Modal ────────────────────────────────────────────────────────────
function AddUserModal({ onClose }: { onClose: () => void }) {
  const [form, setForm] = useState({ name: "", email: "", role: "موظف", status: "نشط" as "نشط" | "معطل" });

  const save = () => {
    if (!form.name.trim() || !form.email.trim()) { toast.error("يرجى تعبئة الاسم والبريد الإلكتروني"); return; }
    toast.error("تتطلب إضافة المستخدمين إدارة خادمية محمية. لم يتم إنشاء أي مستخدم محلي.");
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: "rgba(0,0,0,0.7)" }}>
      <div className="rounded-2xl p-6 w-full max-w-md" style={{ background: "hsl(0 0% 18%)", border: "1px solid hsl(0 0% 24%)", direction: "rtl" }}>
        <div className="flex items-center justify-between mb-5">
          <h3 style={{ fontFamily: "Alexandria", fontWeight: 800, fontSize: "16px", color: "hsl(0 0% 92%)" }}>إضافة مستخدم جديد</h3>
          <button onClick={onClose} style={{ color: "hsl(0 0% 50%)", cursor: "pointer" }}><X size={18} /></button>
        </div>
        <div className="space-y-3">
          <div>
            <label style={{ fontFamily: "Alexandria", fontSize: "12px", fontWeight: 600, color: "hsl(0 0% 65%)", display: "block", marginBottom: "5px" }}>الاسم الكامل *</label>
            <input style={inputStyle} value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))} placeholder="أدخل الاسم..." />
          </div>
          <div>
            <label style={{ fontFamily: "Alexandria", fontSize: "12px", fontWeight: 600, color: "hsl(0 0% 65%)", display: "block", marginBottom: "5px" }}>البريد الإلكتروني *</label>
            <input style={inputStyle} type="email" value={form.email} onChange={e => setForm(p => ({ ...p, email: e.target.value }))} placeholder="example@company.com" />
          </div>
          <div>
            <label style={{ fontFamily: "Alexandria", fontSize: "12px", fontWeight: 600, color: "hsl(0 0% 65%)", display: "block", marginBottom: "5px" }}>الدور الوظيفي</label>
            <select style={inputStyle} value={form.role} onChange={e => setForm(p => ({ ...p, role: e.target.value }))}>
              {ROLES.map(r => <option key={r.id} value={r.name}>{r.name}</option>)}
            </select>
          </div>
          <div>
            <label style={{ fontFamily: "Alexandria", fontSize: "12px", fontWeight: 600, color: "hsl(0 0% 65%)", display: "block", marginBottom: "5px" }}>الحالة</label>
            <select style={inputStyle} value={form.status} onChange={e => setForm(p => ({ ...p, status: e.target.value as "نشط" | "معطل" }))}>
              <option value="نشط">نشط</option>
              <option value="معطل">معطل</option>
            </select>
          </div>
        </div>
        <div className="flex gap-2 mt-5">
          <button className="btn-brand flex-1 flex items-center justify-center gap-2" onClick={save}><Check size={14} /><span>إضافة</span></button>
          <button className="flex-1 flex items-center justify-center gap-2 rounded-lg py-2 text-sm font-semibold" style={{ fontFamily: "Alexandria", background: "hsl(0 0% 26%)", color: "hsl(0 0% 65%)", border: "1px solid hsl(0 0% 28%)" }} onClick={onClose}><X size={14} /><span>إلغاء</span></button>
        </div>
      </div>
    </div>
  );
}

// ─── Attendance Exemptions Section ──────────────────────────────────────────────────────────────────────────────
interface ExemptEmployee {
  id: string;
  employeeId: string;
  employeeName: string;
  reason: string;
  createdAt: number;
  createdBy: string;
}

function AttendanceExemptionsSection() {
  const [exemptions, setExemptions] = useState<ExemptEmployee[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQ, setSearchQ] = useState('');
  const [employees, setEmployees] = useState<{id:string;name:string}[]>([]);
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ employeeId: '', employeeName: '', reason: '' });
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState<string|null>(null);
  const [empSearch, setEmpSearch] = useState('');
  const [showEmpDropdown, setShowEmpDropdown] = useState(false);

  const loadExemptions = async () => {
    try {
      setLoading(true);
      const res = await fetch('/api/admin/attendance-exemptions', { credentials: 'include' });
      const data = await res.json();
      setExemptions(Array.isArray(data) ? data : []);
    } catch { toast.error('فشل تحميل الاستثناءات'); }
    finally { setLoading(false); }
  };

  const loadEmployees = async () => {
    try {
      const res = await fetch('/api/hcm/employees', { credentials: 'include' });
      const data = await res.json();
      const list = Array.isArray(data) ? data : [];
      setEmployees(list.map((e: any) => ({
        id: e.employeeId || e.EmployeeID || e.id || '',
        name: e.nameAr || e.fullName || e.FullName || e.name || '',
      })));
    } catch { /* silent */ }
  };

  useEffect(() => { loadExemptions(); loadEmployees(); }, []);

  const handleAdd = async () => {
    if (!form.employeeId || !form.employeeName) { toast.error('اختر موظفاً'); return; }
    setSaving(true);
    try {
      const res = await fetch('/api/admin/attendance-exemptions', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ employeeId: form.employeeId, reason: form.reason || 'استثناء من البصمة' }),
      });
      if (!res.ok) throw new Error(await res.text());
      toast.success(`تم إضافة استثناء لـ ${form.employeeName}`);
      setShowAdd(false);
      setForm({ employeeId: '', employeeName: '', reason: '' });
      loadExemptions();
    } catch (e: any) { toast.error('فشل الحفظ: ' + e?.message); }
    finally { setSaving(false); }
  };

  const handleDelete = async (id: string, name: string) => {
    setDeleting(id);
    try {
      const res = await fetch(`/api/admin/attendance-exemptions/${id}`, { method: 'DELETE', credentials: 'include' });
      if (!res.ok) throw new Error(await res.text());
      toast.success(`تم حذف استثناء ${name}`);
      loadExemptions();
    } catch (e: any) { toast.error('فشل الحذف: ' + e?.message); }
    finally { setDeleting(null); }
  };

  const filtered = exemptions.filter(e =>
    e.employeeName.toLowerCase().includes(searchQ.toLowerCase()) ||
    e.employeeId.includes(searchQ)
  );

  const inputStyle = { fontFamily: 'Alexandria', fontSize: '13px', background: 'hsl(0 0% 22%)', border: '1px solid hsl(0 0% 28%)', borderRadius: '8px', padding: '8px 12px', color: 'hsl(0 0% 88%)', width: '100%', outline: 'none' };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="card-brand rounded-xl p-5">
        <div className="flex items-center justify-between mb-4">
          <div>
            <div className="section-title">استثناءات البصمة الجغرافية</div>
            <div style={{ fontFamily: 'Alexandria', fontSize: '12px', color: 'hsl(0 0% 55%)', marginTop: '4px' }}>
              الموظفون المدرجون هنا يمكنهم تسجيل الحضور من أي مكان دون التحقق من النطاق الجغرافي
            </div>
          </div>
          <button
            className="btn-brand flex items-center gap-2"
            onClick={() => setShowAdd(true)}
          >
            <Plus size={14} /><span>إضافة استثناء</span>
          </button>
        </div>

        {/* Search */}
        <input
          style={inputStyle}
          placeholder="بحث باسم الموظف أو رقم الموظف..."
          value={searchQ}
          onChange={e => setSearchQ(e.target.value)}
          className="mb-4"
        />

        {/* List */}
        {loading ? (
          <div style={{ textAlign: 'center', padding: '20px', color: 'hsl(0 0% 55%)', fontFamily: 'Alexandria' }}>جاري التحميل...</div>
        ) : filtered.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '20px', color: 'hsl(0 0% 55%)', fontFamily: 'Alexandria' }}>
            {exemptions.length === 0 ? 'لا يوجد استثناءات حتى الآن' : 'لا توجد نتائج للبحث'}
          </div>
        ) : (
          <div className="space-y-2">
            {filtered.map(ex => (
              <div key={ex.id} className="flex items-center justify-between p-3 rounded-xl"
                style={{ background: 'hsl(0 0% 22%)', border: '1px solid hsl(0 0% 28%)' }}>
                <div className="flex items-center gap-3">
                  <div style={{ width: '36px', height: '36px', borderRadius: '50%', background: peoplePrimarySoft, display: 'flex', alignItems: 'center', justifyContent: 'center', color: peoplePrimary, fontFamily: 'Alexandria', fontWeight: 700, fontSize: '13px' }}>
                    {ex.employeeName.charAt(0)}
                  </div>
                  <div>
                    <div style={{ fontFamily: 'Alexandria', fontWeight: 700, fontSize: '13px', color: 'hsl(0 0% 88%)' }}>{ex.employeeName}</div>
                    <div style={{ fontFamily: 'Alexandria', fontSize: '11px', color: 'hsl(0 0% 55%)' }}>رقم: {ex.employeeId} • {ex.reason}</div>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className="px-2 py-0.5 rounded-full text-xs" style={{ fontFamily: 'Alexandria', background: peoplePrimarySoft, color: peoplePrimary, fontWeight: 700 }}>مستثنى</span>
                  <button
                    onClick={() => handleDelete(ex.id, ex.employeeName)}
                    disabled={deleting === ex.id}
                    style={{ padding: '6px', borderRadius: '8px', background: 'rgba(239,68,68,0.1)', color: '#EF4444', border: 'none', cursor: 'pointer' }}
                  >
                    {deleting === ex.id ? <RefreshCw size={14} className="animate-spin" /> : <Trash2 size={14} />}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Add Modal */}
      {showAdd && (
        <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.7)' }}>
          <div className="card-brand rounded-2xl p-6 w-full max-w-md" style={{ background: 'hsl(0 0% 18%)' }}>
            <div className="flex items-center justify-between mb-5">
              <div style={{ fontFamily: 'Alexandria', fontWeight: 900, fontSize: '16px', color: 'hsl(0 0% 88%)' }}>إضافة استثناء من البصمة</div>
              <button onClick={() => setShowAdd(false)} style={{ color: 'hsl(0 0% 55%)', background: 'none', border: 'none', cursor: 'pointer' }}><X size={18} /></button>
            </div>
            <div className="space-y-4">
              <div style={{ position: 'relative' }}>
                <label style={{ fontFamily: 'Alexandria', fontSize: '12px', fontWeight: 600, color: 'hsl(0 0% 65%)', display: 'block', marginBottom: '5px' }}>الموظف</label>
                <input
                  style={{ ...inputStyle, cursor: 'text' }}
                  placeholder={form.employeeName || '— ابحث باسم الموظف أو رقمه —'}
                  value={empSearch}
                  onChange={e => {
                    setEmpSearch(e.target.value);
                    setShowEmpDropdown(true);
                    if (!e.target.value) setForm(p => ({ ...p, employeeId: '', employeeName: '' }));
                  }}
                  onFocus={() => setShowEmpDropdown(true)}
                  onBlur={() => setTimeout(() => setShowEmpDropdown(false), 200)}
                />
                {form.employeeName && !empSearch && (
                  <div style={{ marginTop: '4px', fontSize: '11px', color: peoplePrimary, fontFamily: 'Alexandria' }}>✓ {form.employeeName} ({form.employeeId})</div>
                )}
                {showEmpDropdown && (
                  <div style={{
                    position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 100,
                    background: 'hsl(0 0% 26%)',
                    border: '1px solid hsl(0 0% 33%)',
                    borderRadius: '8px', maxHeight: '200px', overflowY: 'auto',
                    boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
                    marginTop: '4px',
                  }}>
                    {employees
                      .filter(emp =>
                        !empSearch ||
                        emp.name.toLowerCase().includes(empSearch.toLowerCase()) ||
                        emp.id.includes(empSearch)
                      )
                      .slice(0, 50)
                      .map(emp => (
                        <div
                          key={emp.id}
                          onMouseDown={() => {
                            setForm(p => ({ ...p, employeeId: emp.id, employeeName: emp.name }));
                            setEmpSearch('');
                            setShowEmpDropdown(false);
                          }}
                          style={{
                            padding: '8px 12px', cursor: 'pointer',
                            fontFamily: 'Alexandria', fontSize: '13px',
                            color: 'hsl(0 0% 88%)',
                            borderBottom: '1px solid hsl(0 0% 26%)',
                          }}
                          onMouseEnter={e => (e.currentTarget.style.background = 'hsl(0 0% 26%)')}
                          onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                        >
                          {emp.name} <span style={{ color: 'hsl(0 0% 55%)', fontSize: '11px' }}>({emp.id})</span>
                        </div>
                      ))
                    }
                    {employees.filter(emp =>
                      !empSearch ||
                      emp.name.toLowerCase().includes(empSearch.toLowerCase()) ||
                      emp.id.includes(empSearch)
                    ).length === 0 && (
                      <div style={{ padding: '12px', textAlign: 'center', color: 'hsl(0 0% 55%)', fontFamily: 'Alexandria', fontSize: '13px' }}>لا توجد نتائج</div>
                    )}
                  </div>
                )}
              </div>
              <div>
                <label style={{ fontFamily: 'Alexandria', fontSize: '12px', fontWeight: 600, color: 'hsl(0 0% 65%)', display: 'block', marginBottom: '5px' }}>سبب الاستثناء</label>
                <input
                  style={inputStyle}
                  placeholder="مثال: مدير تنفيذي، عمل ميداني..."
                  value={form.reason}
                  onChange={e => setForm(p => ({ ...p, reason: e.target.value }))}
                />
              </div>
            </div>
            <div className="flex gap-2 mt-5">
              <button className="btn-brand flex-1 flex items-center justify-center gap-2" onClick={handleAdd} disabled={saving}>
                {saving ? <RefreshCw size={14} className="animate-spin" /> : <Check size={14} />}
                <span>حفظ</span>
              </button>
              <button className="flex-1 flex items-center justify-center gap-2 rounded-lg py-2 text-sm font-semibold"
                style={{ fontFamily: 'Alexandria', background: 'hsl(0 0% 26%)', color: 'hsl(0 0% 65%)', border: '1px solid hsl(0 0% 28%)' }}
                onClick={() => setShowAdd(false)}>
                <X size={14} /><span>إلغاء</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Approval Chains Section ────────────────────────────────────────────────────
const REQUEST_TYPES = [
  { key: 'leave', label: 'طلب إجازة' },
  { key: 'permission', label: 'طلب استئذان' },
  { key: 'delegation', label: 'طلب انتداب' },
  { key: 'overtime', label: 'طلب عمل إضافي' },
  { key: 'attendance_edit', label: 'طلب تعديل بصمة' },
  { key: 'salary_letter', label: 'طلب خطاب راتب' },
];

const APPROVER_TYPES = [
  { key: 'direct_manager', label: 'المدير المباشر' },
  { key: 'department_head', label: 'مدير الإدارة' },
  { key: 'hr', label: 'مدير رأس المال البشري' },
  { key: 'ceo', label: 'الرئيس التنفيذي' },
  { key: 'specific_employee', label: 'موظف محدد' },
];

interface ApprovalStep {
  id?: number;
  stepOrder: number;
  approverType: string;
  approverEmployeeId?: string;
  approverName?: string;
}

function ApprovalChainsSection() {
  const [chains, setChains] = useState<Record<string, ApprovalStep[]>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editingType, setEditingType] = useState<string | null>(null);
  const [editSteps, setEditSteps] = useState<ApprovalStep[]>([]);
  const [employees, setEmployees] = useState<any[]>([]);

  useEffect(() => {
    loadChains();
    loadEmployees();
  }, []);

  async function loadChains() {
    try {
      const res = await fetch('/api/approval-chains', { credentials: 'include' });
      const data = await res.json();
      if (data.success) setChains(data.chains || {});
    } catch (e) {
      toast.error('فشل تحميل سلاسل الموافقات');
    } finally {
      setLoading(false);
    }
  }

  async function loadEmployees() {
    try {
      const res = await fetch('/api/hcm/employees', { credentials: 'include' });
      const data = await res.json();
      const list = Array.isArray(data) ? data : [];
      setEmployees(list.map((employee: any) => ({
        ...employee,
        employeeId: employee.employeeId || employee.EmployeeID || employee.id || '',
        nameAr: employee.nameAr || employee.fullName || employee.FullName || employee.name || '',
      })));
    } catch (e) { /* ignore */ }
  }

  function startEdit(requestType: string) {
    const existing = chains[requestType] || [];
    if (existing.length === 0) {
      setEditSteps([
        { stepOrder: 1, approverType: 'direct_manager' },
        { stepOrder: 2, approverType: 'hr' },
      ]);
    } else {
      setEditSteps(existing.map(s => ({ ...s })));
    }
    setEditingType(requestType);
  }

  function addStep() {
    setEditSteps(prev => [...prev, { stepOrder: prev.length + 1, approverType: 'direct_manager' }]);
  }

  function removeStep(index: number) {
    setEditSteps(prev => prev.filter((_, i) => i !== index).map((s, i) => ({ ...s, stepOrder: i + 1 })));
  }

  function updateStep(index: number, field: string, value: string) {
    setEditSteps(prev => prev.map((s, i) => {
      if (i !== index) return s;
      const updated = { ...s, [field]: value };
      if (field === 'approverType' && value !== 'specific_employee') {
        delete updated.approverEmployeeId;
        delete updated.approverName;
      }
      if (field === 'approverEmployeeId') {
        const emp = employees.find(e => e.employeeId === value);
        updated.approverName = emp?.nameAr || '';
      }
      return updated;
    }));
  }

  async function saveChain() {
    if (!editingType) return;
    if (editSteps.length === 0) {
      toast.error('يجب إضافة خطوة واحدة على الأقل');
      return;
    }
    for (const step of editSteps) {
      if (step.approverType === 'specific_employee' && !step.approverEmployeeId) {
        toast.error('يجب اختيار الموظف لكل خطوة من نوع "موظف محدد"');
        return;
      }
    }
    setSaving(true);
    try {
      const res = await fetch('/api/approval-chains', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ requestType: editingType, steps: editSteps }),
      });
      const data = await res.json();
      if (data.success) {
        toast.success('تم حفظ سلسلة الموافقات بنجاح');
        setEditingType(null);
        loadChains();
      } else {
        toast.error(data.error || 'فشل حفظ السلسلة');
      }
    } catch (e) {
      toast.error('خطأ في الاتصال');
    } finally {
      setSaving(false);
    }
  }

  function getApproverLabel(step: ApprovalStep): string {
    const type = APPROVER_TYPES.find(t => t.key === step.approverType);
    if (step.approverType === 'specific_employee' && step.approverName) {
      return `${type?.label}: ${step.approverName}`;
    }
    return type?.label || step.approverType;
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <RefreshCw className="animate-spin" size={24} color={peoplePrimary} />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="card-brand rounded-xl p-5">
        <div className="section-title" style={{ marginBottom: '16px' }}>سلسلة الموافقات</div>
        <p style={{ fontFamily: 'Alexandria', fontSize: '12px', color: 'hsl(0 0% 55%)', marginBottom: '16px', lineHeight: 1.7 }}>
          حدد من يوافق على كل نوع من الطلبات وترتيب الموافقة. يمكنك إضافة أي عدد من الموافقين وتحديد موظفين محددين.
        </p>

        <div className="space-y-3">
          {REQUEST_TYPES.map(rt => {
            const chainSteps = chains[rt.key] || [];
            const isEditing = editingType === rt.key;

            return (
              <div key={rt.key} className="rounded-xl p-4" style={{ background: 'hsl(0 0% 18%)', border: '1px solid hsl(0 0% 24%)' }}>
                <div className="flex items-center justify-between mb-2">
                  <span style={{ fontFamily: 'Alexandria', fontWeight: 700, fontSize: '13px', color: 'hsl(0 0% 88%)' }}>{rt.label}</span>
                  {!isEditing && (
                    <button
                      onClick={() => startEdit(rt.key)}
                      className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all"
                      style={{ fontFamily: 'Alexandria', background: 'hsl(var(--primary) / .12)', color: peoplePrimary, border: '1px solid hsl(var(--primary) / .25)' }}
                    >
                      <Edit2 size={12} />
                      تعديل
                    </button>
                  )}
                </div>

                {!isEditing && chainSteps.length === 0 && (
                  <p style={{ fontFamily: 'Alexandria', fontSize: '11px', color: 'hsl(0 0% 45%)' }}>
                    لم يتم إعداد سلسلة موافقات — الافتراضي: المدير المباشر → HR
                  </p>
                )}

                {!isEditing && chainSteps.length > 0 && (
                  <div className="flex items-center gap-2 flex-wrap">
                    {chainSteps.sort((a, b) => a.stepOrder - b.stepOrder).map((step, idx) => (
                      <div key={idx} className="flex items-center gap-2">
                        <span className="px-2 py-1 rounded-lg text-xs" style={{ fontFamily: 'Alexandria', background: peoplePrimarySoft, color: peoplePrimary, fontWeight: 600 }}>
                          {step.stepOrder}. {getApproverLabel(step)}
                        </span>
                        {idx < chainSteps.length - 1 && <span style={{ color: 'hsl(0 0% 40%)' }}>→</span>}
                      </div>
                    ))}
                  </div>
                )}

                {isEditing && (
                  <div className="space-y-3 mt-3">
                    {editSteps.map((step, idx) => (
                      <div key={idx} className="flex items-center gap-2 p-3 rounded-lg" style={{ background: 'hsl(0 0% 14%)', border: '1px solid hsl(0 0% 22%)' }}>
                        <span style={{ fontFamily: 'Alexandria', fontSize: '12px', color: peoplePrimary, fontWeight: 700, minWidth: '24px' }}>{idx + 1}</span>
                        <select
                          value={step.approverType}
                          onChange={(e) => updateStep(idx, 'approverType', e.target.value)}
                          className="flex-1 px-3 py-2 rounded-lg text-xs"
                          style={{ fontFamily: 'Alexandria', background: 'hsl(0 0% 20%)', border: '1px solid hsl(0 0% 28%)', color: 'hsl(0 0% 85%)', direction: 'rtl' }}
                        >
                          {APPROVER_TYPES.map(at => (
                            <option key={at.key} value={at.key}>{at.label}</option>
                          ))}
                        </select>
                        {step.approverType === 'specific_employee' && (
                          <select
                            value={step.approverEmployeeId || ''}
                            onChange={(e) => updateStep(idx, 'approverEmployeeId', e.target.value)}
                            className="flex-1 px-3 py-2 rounded-lg text-xs"
                            style={{ fontFamily: 'Alexandria', background: 'hsl(0 0% 20%)', border: '1px solid hsl(0 0% 28%)', color: 'hsl(0 0% 85%)', direction: 'rtl' }}
                          >
                            <option value="">اختر الموظف...</option>
                            {employees.map(emp => (
                              <option key={emp.employeeId} value={emp.employeeId}>{emp.nameAr} - {emp.department}</option>
                            ))}
                          </select>
                        )}
                        <button onClick={() => removeStep(idx)} className="p-1.5 rounded-lg hover:bg-red-500/20 transition-colors">
                          <Trash2 size={14} color="#EF4444" />
                        </button>
                      </div>
                    ))}
                    <div className="flex items-center gap-2">
                      <button
                        onClick={addStep}
                        className="flex items-center gap-1 px-3 py-2 rounded-lg text-xs font-semibold transition-all"
                        style={{ fontFamily: 'Alexandria', background: 'hsl(0 0% 22%)', color: 'hsl(0 0% 70%)', border: '1px dashed hsl(0 0% 35%)' }}
                      >
                        <Plus size={12} />
                        إضافة خطوة
                      </button>
                      <div className="flex-1" />
                      <button
                        onClick={() => setEditingType(null)}
                        className="px-3 py-2 rounded-lg text-xs font-semibold"
                        style={{ fontFamily: 'Alexandria', background: 'hsl(0 0% 22%)', color: 'hsl(0 0% 60%)', border: '1px solid hsl(0 0% 30%)' }}
                      >
                        إلغاء
                      </button>
                      <button
                        onClick={saveChain}
                        disabled={saving}
                        className="flex items-center gap-1 px-4 py-2 rounded-lg text-xs font-semibold transition-all"
                        style={{ fontFamily: 'Alexandria', background: peoplePrimary, color: 'hsl(var(--primary-foreground))' }}
                      >
                        {saving ? <RefreshCw size={12} className="animate-spin" /> : <Save size={12} />}
                        حفظ
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ─── Main Component ──────────────────────────────────────────────────────────────────────────────
export default function AdminSettings() {
  const { user } = useAuth();
  const [, navigate] = useLocation();
  const [activeSection, setActiveSection] = useState("general");
  const [companyName, setCompanyName] = useState("شركة 3,6T");
  const [timezone, setTimezone] = useState("Asia/Riyadh");
  const [maintenanceMode, setMaintenanceMode] = useState(false);
  const [showAddUser, setShowAddUser] = useState(false);
  const [backupDownloading, setBackupDownloading] = useState(false);
  const [users, setUsers] = useState<SystemUser[]>([]);

  // Notification settings
  const [notifSettings, setNotifSettings] = useState({
    emailOnLeave: true,
    emailOnAttendance: false,
    emailOnContract: true,
    smsOnLeave: false,
    pushNotifications: true,
    weeklyDigest: true,
  });

  // Security settings
  const [secSettings, setSecSettings] = useState({
    twoFactor: true,
    sso: false,
    autoLock: true,
    sessionTimeout: true,
  });

  const deleteUser = (_id: string) => {
    toast.error("حذف المستخدم يحتاج مسار إدارة مستخدمين خادمي محمي. لم يُحذف أي مستخدم.");
  };
  const toggleUserStatus = (_id: string) => {
    toast.error("تغيير حالة المستخدم يحتاج مسار إدارة مستخدمين خادمي محمي. لم تتغير أي حالة.");
  };

  const handleBackupDownload = async () => {
    if (user?.role !== "owner") {
      toast.error("تنزيل النسخة الكاملة متاح لمالك المنصة فقط");
      return;
    }
    setBackupDownloading(true);
    try {
      const response = await fetch("/api/hcm/backup/export", { credentials: "include" });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || "تعذر إعداد النسخة الاحتياطية");
      }
      const blob = await response.blob();
      const link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      link.download = `نسخة_احتياطية_360_${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(link.href);
      toast.success("تم تنزيل النسخة الاحتياطية محلياً");
    } catch (error: any) {
      toast.error(error?.message || "فشل تنزيل النسخة الاحتياطية");
    } finally {
      setBackupDownloading(false);
    }
  };

  return (
    <PageTemplate
      title="الإعدادات والصلاحيات"
      subtitle="إدارة إعدادات النظام والمستخدمين والصلاحيات"
      icon={Settings}
      stats={[
        { label: "مستخدمو النظام", value: String(users.length), color: peoplePrimary },
        { label: "أدوار وظيفية", value: "4", color: "hsl(165 60% 55%)" },
        { label: "مستخدمون نشطون", value: String(users.filter(u => u.status === "نشط").length), color: "#F59E0B" },
        { label: "آخر نسخة احتياطية", value: "اليوم", color: "#8B5CF6" },
      ]}
    >
      {showAddUser && <AddUserModal onClose={() => setShowAddUser(false)} />}

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
        {/* Sidebar nav */}
        <div className="card-brand rounded-xl p-3">
          <div className="space-y-1">
            {settingsSections.map(section => {
              const Icon = section.icon;
              return (
                <button
                  key={section.key}
                  onClick={() => setActiveSection(section.key)}
                  className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all text-right"
                  style={{
                    fontFamily: "Alexandria",
                    fontWeight: activeSection === section.key ? 700 : 500,
                    fontSize: "13px",
                    background: activeSection === section.key ? "hsl(var(--primary) / .12)" : "transparent",
                    color: activeSection === section.key ? peoplePrimary : "hsl(var(--muted-foreground))",
                    borderRight: activeSection === section.key ? `3px solid ${peoplePrimary}` : "3px solid transparent",
                  }}
                >
                  <Icon size={15} />
                  {section.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* Content area */}
        <div className="lg:col-span-3 space-y-4">

          {/* ── General ── */}
          {activeSection === "general" && (
            <div className="card-brand rounded-xl p-5">
              <div className="section-title">الإعدادات العامة</div>
              <div className="space-y-4">
                <div>
                  <label style={{ fontFamily: "Alexandria", fontSize: "13px", fontWeight: 600, color: "hsl(0 0% 70%)", display: "block", marginBottom: "6px" }}>اسم الشركة / المنظمة</label>
                  <input type="text" value={companyName} readOnly style={{ ...inputStyle, opacity: 0.72, cursor: "not-allowed" }} title="يتطلب التعديل مسار إعدادات خادمي محمي" />
                </div>
                <div>
                  <label style={{ fontFamily: "Alexandria", fontSize: "13px", fontWeight: 600, color: "hsl(0 0% 70%)", display: "block", marginBottom: "6px" }}>المنطقة الزمنية</label>
                  <select value={timezone} disabled style={{ ...inputStyle, opacity: 0.72, cursor: "not-allowed" }} title="يتطلب التعديل مسار إعدادات خادمي محمي">
                    <option value="Asia/Riyadh">الرياض (UTC+3)</option>
                    <option value="Asia/Dubai">دبي (UTC+4)</option>
                    <option value="Africa/Cairo">القاهرة (UTC+2)</option>
                  </select>
                </div>
                <div className="flex items-center justify-between p-3 rounded-lg" style={{ background: "hsl(0 0% 22%)" }}>
                  <div>
                    <div style={{ fontFamily: "Alexandria", fontWeight: 600, fontSize: "13px", color: "hsl(0 0% 85%)" }}>وضع الصيانة</div>
                    <div style={{ fontFamily: "Alexandria", fontSize: "11px", color: "hsl(0 0% 50%)" }}>تعطيل الوصول مؤقتاً للمستخدمين</div>
                  </div>
                  <div
                    className="w-11 h-6 rounded-full relative cursor-not-allowed transition-all opacity-70"
                    style={{ background: maintenanceMode ? "#EF4444" : "hsl(0 0% 28%)" }}
                    onClick={() => toast.error("وضع الصيانة يحتاج مسار إعدادات خادمي محمي. لم تتغير حالة المنصة.")}
                  >
                    <div className="absolute top-1 w-4 h-4 rounded-full transition-all" style={{ background: "white", right: maintenanceMode ? "4px" : "auto", left: maintenanceMode ? "auto" : "4px" }} />
                  </div>
                </div>
                <button className="btn-brand flex items-center gap-2 opacity-70" onClick={() => toast.error("حفظ الإعدادات يحتاج مساراً خادمياً محمياً. لم تُحفظ أي تغييرات.")}>
                  <Save size={14} /><span>حفظ خادمي مطلوب</span>
                </button>
              </div>
            </div>
          )}

          {/* ── Users ── */}
          {activeSection === "users" && (
            <div className="space-y-4">
              {/* Roles */}
              <div className="card-brand rounded-xl p-5">
                <div className="flex items-center justify-between mb-4">
                  <div className="section-title" style={{ marginBottom: 0 }}>الأدوار والصلاحيات</div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  {ROLES.map(role => (
                    <div key={role.id} className="rounded-xl p-4" style={{ background: "hsl(0 0% 22%)", border: `1px solid ${role.color}30` }}>
                      <div className="flex items-center justify-between mb-2">
                        <span style={{ fontFamily: "Alexandria", fontWeight: 700, fontSize: "13px", color: "hsl(0 0% 90%)" }}>{role.name}</span>
                        <span style={{ fontFamily: "Alexandria", fontWeight: 800, fontSize: "16px", color: role.color }}>
                          {users.filter(u => u.role === role.name).length}
                        </span>
                      </div>
                      <div className="flex flex-wrap gap-1">
                        {role.permissions.slice(0, 3).map(p => (
                          <span key={p} className="px-1.5 py-0.5 rounded text-xs" style={{ fontFamily: "Alexandria", background: `${role.color}15`, color: role.color, fontSize: "10px" }}>{p}</span>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Users table */}
              <div className="card-brand rounded-xl overflow-hidden">
                <div className="flex items-center justify-between p-4" style={{ borderBottom: "1px solid hsl(0 0% 26%)" }}>
                  <div className="section-title" style={{ marginBottom: 0 }}>مستخدمو النظام ({users.length})</div>
                  <button className="btn-brand flex items-center gap-2 text-xs" onClick={() => setShowAddUser(true)}>
                    <Plus size={12} /><span>إضافة مستخدم</span>
                  </button>
                </div>
                <table className="data-table">
                  <thead>
                    <tr><th>المستخدم</th><th>الدور</th><th>آخر دخول</th><th>الحالة</th><th>الإجراءات</th></tr>
                  </thead>
                  <tbody>
                    {users.length === 0 ? (
                      <tr><td colSpan={5}>
                        <div className="flex flex-col items-center justify-center py-12 gap-3">
                          <Inbox size={22} color={peoplePrimary} />
                          <p style={{ fontFamily: "Alexandria", fontWeight: 700, fontSize: "13px", color: "hsl(0 0% 75%)" }}>لا يوجد مستخدمون بعد</p>
                        </div>
                      </td></tr>
                    ) : users.map(u => (
                      <tr key={u.id}>
                        <td>
                          <div>
                            <div style={{ fontFamily: "Alexandria", fontWeight: 700, fontSize: "13px", color: "hsl(0 0% 88%)" }}>{u.name}</div>
                            <div style={{ fontFamily: "Alexandria", fontSize: "11px", color: "hsl(0 0% 50%)" }}>{u.email}</div>
                          </div>
                        </td>
                        <td>
                          {(() => {
                            const role = ROLES.find(r => r.name === u.role);
                            return <span className="px-2 py-0.5 rounded-full text-xs" style={{ fontFamily: "Alexandria", background: role?.color === peoplePrimary ? peoplePrimarySoft : `${role?.color || peoplePrimary}20`, color: role?.color || peoplePrimary, fontWeight: 700 }}>{u.role}</span>;
                          })()}
                        </td>
                        <td style={{ fontFamily: "Alexandria", fontSize: "12px", color: "hsl(0 0% 65%)" }}>{u.lastLogin}</td>
                        <td>
                          <span className="px-2 py-0.5 rounded-full text-xs" style={{ fontFamily: "Alexandria", background: u.status === "نشط" ? peoplePrimarySoft : "rgba(239,68,68,0.15)", color: u.status === "نشط" ? peoplePrimary : "#EF4444", fontWeight: 700 }}>
                            {u.status}
                          </span>
                        </td>
                        <td>
                          <div className="flex items-center gap-2 justify-center">
                            <button onClick={() => toggleUserStatus(u.id)} title={u.status === "نشط" ? "تعطيل" : "تفعيل"}
                              style={{ color: u.status === "نشط" ? "#F59E0B" : peoplePrimary, cursor: "pointer" }}>
                              {u.status === "نشط" ? <ToggleRight size={16} /> : <ToggleLeft size={16} />}
                            </button>
                            <button onClick={() => deleteUser(u.id)} title="حذف" style={{ color: "#EF4444", cursor: "pointer" }}><Trash2 size={14} /></button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* ── Security ── */}
          {activeSection === "security" && (
            <div className="card-brand rounded-xl p-5">
              <div className="section-title">إعدادات الأمان</div>
              <div className="space-y-4">
                {[
                  { key: "twoFactor", label: "التحقق بخطوتين", desc: "إضافة طبقة حماية إضافية" },
                  { key: "sso", label: "تسجيل الدخول الموحد (SSO)", desc: "السماح بتسجيل الدخول عبر مزود هوية خارجي" },
                  { key: "autoLock", label: "قفل الحساب التلقائي", desc: "قفل الحساب بعد 5 محاولات فاشلة" },
                  { key: "sessionTimeout", label: "انتهاء صلاحية الجلسة", desc: "تسجيل الخروج التلقائي بعد 30 دقيقة" },
                ].map(setting => {
                  const enabled = secSettings[setting.key as keyof typeof secSettings];
                  return (
                    <div key={setting.key} className="flex items-center justify-between p-4 rounded-xl" style={{ background: "hsl(0 0% 22%)", border: "1px solid hsl(0 0% 26%)" }}>
                      <div className="flex items-center gap-3">
                        <div className="rounded-lg flex items-center justify-center" style={{ width: "36px", height: "36px", background: peoplePrimarySoft, color: peoplePrimary }}>
                          <Shield size={15} />
                        </div>
                        <div>
                          <div style={{ fontFamily: "Alexandria", fontWeight: 600, fontSize: "13px", color: "hsl(0 0% 88%)" }}>{setting.label}</div>
                          <div style={{ fontFamily: "Alexandria", fontSize: "11px", color: "hsl(0 0% 50%)" }}>{setting.desc}</div>
                        </div>
                      </div>
                      <div
                        className="w-11 h-6 rounded-full relative cursor-not-allowed transition-all opacity-70"
                        style={{ background: enabled ? peoplePrimary : "hsl(var(--border))" }}
                        onClick={() => {
                          toast.error(`${setting.label} يحتاج مسار إعدادات خادمي محمي. لم تتغير حالة الأمان.`);
                        }}
                      >
                        <div className="absolute top-1 w-4 h-4 rounded-full transition-all" style={{ background: "white", right: enabled ? "4px" : "auto", left: enabled ? "auto" : "4px" }} />
                      </div>
                    </div>
                  );
                })}
                <div className="p-4 rounded-xl" style={{ background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.2)" }}>
                  <div className="flex items-center gap-2 mb-2">
                    <Key size={14} color="#EF4444" />
                    <span style={{ fontFamily: "Alexandria", fontWeight: 700, fontSize: "13px", color: "#EF4444" }}>تغيير كلمة المرور الرئيسية</span>
                  </div>
                  <button className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold mt-1"
                    style={{ fontFamily: "Alexandria", background: "rgba(239,68,68,0.15)", color: "#EF4444", border: "1px solid rgba(239,68,68,0.3)" }}
                    onClick={() => toast.error("إعادة تعيين كلمة المرور تحتاج مساراً خادمياً محمياً. لم يُرسل أي بريد.")}>
                    <Mail size={13} /><span>إعادة تعيين خادمية مطلوبة</span>
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* ── Notifications ── */}
          {activeSection === "notifications" && (
            <div className="card-brand rounded-xl p-5">
              <div className="section-title">إعدادات الإشعارات</div>
              <div className="space-y-3">
                {[
                  { key: "emailOnLeave", label: "إشعار بريد إلكتروني عند طلب الإجازة", icon: Mail },
                  { key: "emailOnAttendance", label: "إشعار بريد إلكتروني عند التأخر", icon: Clock },
                  { key: "emailOnContract", label: "إشعار بريد إلكتروني عند انتهاء العقد", icon: AlertTriangle },
                  { key: "smsOnLeave", label: "إشعار SMS عند الموافقة على الإجازة", icon: Phone },
                  { key: "pushNotifications", label: "الإشعارات الفورية في المتصفح", icon: Bell },
                  { key: "weeklyDigest", label: "ملخص أسبوعي تلقائي كل إثنين", icon: RefreshCw },
                ].map(item => {
                  const enabled = notifSettings[item.key as keyof typeof notifSettings];
                  const Icon = item.icon;
                  return (
                    <div key={item.key} className="flex items-center justify-between p-3 rounded-xl" style={{ background: "hsl(0 0% 22%)", border: "1px solid hsl(0 0% 26%)" }}>
                      <div className="flex items-center gap-3">
                        <div style={{ width: "32px", height: "32px", borderRadius: "8px", background: "hsl(var(--primary) / .12)", display: "flex", alignItems: "center", justifyContent: "center", color: peoplePrimary }}>
                          <Icon size={14} />
                        </div>
                        <span style={{ fontFamily: "Alexandria", fontSize: "13px", fontWeight: 600, color: "hsl(0 0% 85%)" }}>{item.label}</span>
                      </div>
                      <div
                        className="w-11 h-6 rounded-full relative cursor-not-allowed transition-all opacity-70"
                        style={{ background: enabled ? peoplePrimary : "hsl(var(--border))" }}
                        onClick={() => {
                          toast.error(`${item.label} يحتاج مسار إعدادات خادمي محمي. لم تتغير حالة الإشعار.`);
                        }}
                      >
                        <div className="absolute top-1 w-4 h-4 rounded-full transition-all" style={{ background: "white", right: enabled ? "4px" : "auto", left: enabled ? "auto" : "4px" }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* ── Geo Locations ── */}
          {activeSection === "geo" && (
            <GeoLocationsSection />
          )}

                    {/* ── Attendance Exemptions ── */}
          {activeSection === "exemptions" && (
            <AttendanceExemptionsSection />
          )}

          {/* ── Approval Chains ── */}
          {activeSection === "approvalChains" && (
            <ApprovalChainsSection />
          )}

          {/* ── Integrations ── */}
          {activeSection === "integrations" && (
            <div className="space-y-4">
              <div className="card-brand rounded-xl p-5">
                <div className="section-title">التكاملات النشطة</div>
                <div className="space-y-3">
                  {[
                    { name: "Zoho People", desc: "مزامنة بيانات الموظفين والحضور والإجازات", status: "متصل", color: peoplePrimary, icon: Wifi, action: () => navigate("/zoho-integration") },
                    { name: "نظام الرواتب", desc: "تكامل مع نظام صرف الرواتب", status: "غير متصل", color: "#EF4444", icon: Server, action: () => toast.info("نظام الرواتب: يمكنك ربط نظام الرواتب عبر API. تواصل مع الدعم الفني لإعداد التكامل.") },
                    { name: "بريد الشركة", desc: "البريد الخارجي معطل حتى اعتماد مسار خادمي مخصص", status: "معطل", color: "#F59E0B", icon: Mail, action: () => toast.info("البريد الخارجي معطل عمداً لحماية بيانات الموظفين.") },
                  ].map(item => {
                    const Icon = item.icon;
                    return (
                      <div key={item.name} className="flex items-center justify-between p-4 rounded-xl" style={{ background: "hsl(0 0% 22%)", border: `1px solid ${item.color}30` }}>
                        <div className="flex items-center gap-3">
                          <div style={{ width: "40px", height: "40px", borderRadius: "10px", background: `${item.color}15`, display: "flex", alignItems: "center", justifyContent: "center", color: item.color }}>
                            <Icon size={18} />
                          </div>
                          <div>
                            <div style={{ fontFamily: "Alexandria", fontWeight: 700, fontSize: "13px", color: "hsl(0 0% 88%)" }}>{item.name}</div>
                            <div style={{ fontFamily: "Alexandria", fontSize: "11px", color: "hsl(0 0% 50%)" }}>{item.desc}</div>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="px-2 py-0.5 rounded-full text-xs" style={{ fontFamily: "Alexandria", background: `${item.color}20`, color: item.color, fontWeight: 700 }}>{item.status}</span>
                          <button className="px-3 py-1.5 rounded-lg text-xs font-semibold" style={{ fontFamily: "Alexandria", background: "hsl(0 0% 26%)", color: "hsl(0 0% 70%)", border: "1px solid hsl(0 0% 33%)" }}
                            onClick={item.action}>
                            إعدادات
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
              <div className="card-brand rounded-xl p-5">
                <div className="section-title">إضافة تكامل جديد</div>
                <div className="grid grid-cols-2 gap-3">
                  {[
                    { name: "SAP HR", desc: "نظام إدارة الموارد البشرية من SAP" },
                    { name: "Oracle HCM", desc: "نظام إدارة رأس المال البشري من Oracle" },
                    { name: "Microsoft Teams", desc: "تكامل مع منصة التواصل الداخلي" },
                    { name: "Slack", desc: "إشعارات وتنبيهات عبر Slack" },
                    { name: "Google Workspace", desc: "تكامل مع Google Calendar و Drive" },
                    { name: "Salesforce", desc: "تكامل مع بيانات العملاء" },
                  ].map(({ name, desc }) => (
                    <button key={name} className="flex items-center gap-2 p-3 rounded-xl text-sm font-semibold transition-all"
                      style={{ fontFamily: "Alexandria", background: "hsl(0 0% 22%)", border: "1px solid hsl(0 0% 26%)", color: "hsl(0 0% 70%)", textAlign: 'right', direction: 'rtl' }}
                      onClick={() => toast.info(`لإضافة ${name}: تواصل مع الدعم الفني لإعداد التكامل عبر API. ${desc}`, { duration: 4000 })}>
                      <Plus size={14} color={peoplePrimary} />{name}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* ── Backup ── */}
          {activeSection === "backup" && (
            <div className="space-y-4">
              <div className="card-brand rounded-xl p-5">
                <div className="section-title">النسخ الاحتياطي</div>
                <div className="space-y-3">
                  <div className="flex items-center justify-between p-4 rounded-xl" style={{ background: "hsl(var(--primary) / .08)", border: "1px solid hsl(var(--primary) / .20)" }}>
                    <div className="flex items-center gap-3">
                      <CheckCircle size={20} color={peoplePrimary} />
                      <div>
                        <div style={{ fontFamily: "Alexandria", fontWeight: 700, fontSize: "13px", color: "hsl(0 0% 88%)" }}>نسخة احتياطية يدوية وآمنة</div>
                        <div style={{ fontFamily: "Alexandria", fontSize: "11px", color: peoplePrimary }}>تُنزل محلياً ولا ترسل أي بيانات خارج المنصة</div>
                      </div>
                    </div>
                    <span className="px-2 py-0.5 rounded-full text-xs" style={{ fontFamily: "Alexandria", background: peoplePrimarySoft, color: peoplePrimary, fontWeight: 700 }}>مالك المنصة فقط</span>
                  </div>
                  <button className="btn-brand flex w-full items-center justify-center gap-2 py-3" onClick={handleBackupDownload} disabled={backupDownloading || user?.role !== "owner"}>
                    {backupDownloading ? <RefreshCw size={14} className="animate-spin" /> : <Download size={14} />}
                    <span>{backupDownloading ? "جارٍ إعداد النسخة..." : "تنزيل نسخة البيانات الكاملة"}</span>
                  </button>
                  {user?.role !== "owner" && <p style={{ fontFamily: "Alexandria", fontSize: "11px", color: "hsl(0 0% 55%)", textAlign: "center" }}>هذه العملية متاحة لمالك المنصة فقط لحماية بيانات الموظفين.</p>}
                </div>
              </div>
              <div className="card-brand rounded-xl p-5">
                <div className="section-title">نطاق النسخة</div>
                <p style={{ fontFamily: "Alexandria", fontSize: "12px", color: "hsl(0 0% 60%)", lineHeight: 1.9 }}>
                  تشمل النسخة سجلات الموظفين والرواتب والحضور والإجازات والأداء والمسار الوظيفي والامتثال والتهيئة وسجلات المهام. لا تشمل الجلسات أو كلمات المرور أو مفاتيح API أو توكنات Zoho.
                </p>
              </div>
            </div>
          )}
        </div>
      </div>
    </PageTemplate>
  );
}
