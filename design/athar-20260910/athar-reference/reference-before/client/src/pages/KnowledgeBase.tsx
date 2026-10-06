/**
 * Knowledge Base — قاعدة المعرفة
 * Internal wiki, FAQ, knowledge sharing
 */
import { useEffect, useState, useMemo } from "react";
import {
  BookOpen, Search, Plus, FolderOpen, FileText, Star,
  Clock, Eye, ThumbsUp, MessageSquare, Tag, ChevronLeft,
  X, Edit2, Bookmark, CheckCircle2
} from "lucide-react";
import { toast } from "sonner";

interface Article {
  id: string;
  title: string;
  content: string;
  category: string;
  tags: string[];
  author: string;
  authorDept: string;
  views: number;
  likes: number;
  createdAt: number;
  updatedAt: number;
  pinned?: boolean;
}

const CATEGORIES = [
  { id: "policies", label: "السياسات والإجراءات", icon: "📋", color: "#6366f1" },
  { id: "guides", label: "أدلة العمل", icon: "📖", color: "hsl(var(--primary))" },
  { id: "faq", label: "الأسئلة الشائعة", icon: "❓", color: "#f59e0b" },
  { id: "tech", label: "التقنية والأنظمة", icon: "💻", color: "#3b82f6" },
  { id: "onboarding", label: "دليل الموظف الجديد", icon: "🎯", color: "#8b5cf6" },
  { id: "lessons", label: "الدروس المستفادة", icon: "💡", color: "#10b981" },
];
const peoplePrimary = "hsl(var(--primary))";
const peoplePrimarySoft = "hsl(var(--primary) / 0.15)";
const cardSurface = "hsl(var(--card))";
const mutedSurface = "hsl(var(--muted))";
const borderColor = "hsl(var(--border))";
const foreground = "hsl(var(--foreground))";
const mutedText = "hsl(var(--muted-foreground))";

export default function KnowledgeBase() {
  const [articles, setArticles] = useState<Article[]>([]);
  const [isLoadingPolicies, setIsLoadingPolicies] = useState(true);
  const [acknowledgedPolicyIds, setAcknowledgedPolicyIds] = useState<Record<string, boolean>>({});
  const [isAcknowledging, setIsAcknowledging] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("");
  const [selectedArticle, setSelectedArticle] = useState<Article | null>(null);
  const [showNewForm, setShowNewForm] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newContent, setNewContent] = useState("");
  const [newCategory, setNewCategory] = useState("");
  const [newTags, setNewTags] = useState("");

  useEffect(() => {
    let active = true;
    fetch("/api/knowledge/policies", { credentials: "include" })
      .then(async (response) => {
        if (!response.ok) throw new Error("Unable to load policies");
        const payload = await response.json();
        return Array.isArray(payload.policies) ? payload.policies : [];
      })
      .then((policies) => {
        if (!active) return;
        setArticles(policies.map((policy: any): Article => ({
          id: String(policy.id),
          title: String(policy.title || ""),
          content: String(policy.content || ""),
          category: String(policy.category || "policies"),
          tags: [],
          author: "",
          authorDept: "",
          views: 0,
          likes: 0,
          createdAt: new Date(policy.created_at || Date.now()).getTime(),
          updatedAt: new Date(policy.updated_at || policy.published_date || Date.now()).getTime(),
        })));
      })
      .catch(() => {
        if (active) setArticles([]);
      })
      .finally(() => {
        if (active) setIsLoadingPolicies(false);
      });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!selectedArticle) return;
    let active = true;
    fetch(`/api/knowledge/policies/${encodeURIComponent(selectedArticle.id)}/acknowledgment`, { credentials: "include" })
      .then(async (response) => {
        if (!response.ok) throw new Error("Unable to load acknowledgment status");
        return response.json();
      })
      .then((payload) => {
        if (active) setAcknowledgedPolicyIds((current) => ({ ...current, [selectedArticle.id]: Boolean(payload.acknowledged) }));
      })
      .catch(() => {
        if (active) setAcknowledgedPolicyIds((current) => ({ ...current, [selectedArticle.id]: false }));
      });
    return () => { active = false; };
  }, [selectedArticle]);

  const handleAcknowledgePolicy = async (policyId: string) => {
    setIsAcknowledging(true);
    try {
      const response = await fetch(`/api/knowledge/policies/${encodeURIComponent(policyId)}/acknowledgments`, {
        method: "POST",
        credentials: "include",
      });
      if (!response.ok) throw new Error("Unable to acknowledge policy");
      setAcknowledgedPolicyIds((current) => ({ ...current, [policyId]: true }));
      toast.success("تم تسجيل إقرارك بالسياسة");
    } catch {
      toast.error("تعذر تسجيل الإقرار. حاول مرة أخرى.");
    } finally {
      setIsAcknowledging(false);
    }
  };

  const filteredArticles = useMemo(() => {
    let filtered = articles;
    if (selectedCategory) filtered = filtered.filter(a => a.category === selectedCategory);
    if (searchTerm) {
      const term = searchTerm.toLowerCase();
      filtered = filtered.filter(a =>
        a.title.includes(term) || a.content.includes(term) || a.tags.some(t => t.includes(term))
      );
    }
    return filtered.sort((a, b) => {
      if (a.pinned && !b.pinned) return -1;
      if (!a.pinned && b.pinned) return 1;
      return b.updatedAt - a.updatedAt;
    });
  }, [articles, searchTerm, selectedCategory]);

  const [editArticle, setEditArticle] = useState<Article | null>(null);

  const openEdit = (article: Article) => {
    setEditArticle(article);
    setNewTitle(article.title);
    setNewContent(article.content);
    setNewCategory(article.category);
    setNewTags(article.tags.join(", "));
    setShowNewForm(true);
  };

  const handleCreateArticle = async () => {
    if (!newTitle.trim() || !newContent.trim() || !newCategory) {
      toast.error("يرجى تعبئة جميع الحقول");
      return;
    }
    try {
      const isEditing = Boolean(editArticle);
      const response = await fetch(isEditing ? `/api/admin/knowledge/policies/${encodeURIComponent(editArticle!.id)}` : "/api/admin/knowledge/policies", {
        method: isEditing ? "PUT" : "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: newTitle.trim(),
          content: newContent.trim(),
          category: newCategory,
          is_published: true,
        }),
      });
      if (!response.ok) {
        if (response.status === 401 || response.status === 403) throw new Error("forbidden");
        throw new Error("publish_failed");
      }
      const payload = await response.json();
      const updatedArticle: Article = {
        id: isEditing ? editArticle!.id : String(payload.id),
        title: newTitle.trim(),
        content: newContent.trim(),
        category: newCategory,
        tags: newTags.split(",").map((tag) => tag.trim()).filter(Boolean),
        author: editArticle?.author || "",
        authorDept: editArticle?.authorDept || "",
        views: editArticle?.views || 0,
        likes: editArticle?.likes || 0,
        createdAt: editArticle?.createdAt || Date.now(),
        updatedAt: Date.now(),
      };
      setArticles((current) => isEditing
        ? current.map((article) => article.id === updatedArticle.id ? updatedArticle : article)
        : [updatedArticle, ...current]);
      if (isEditing) setAcknowledgedPolicyIds((current) => ({ ...current, [updatedArticle.id]: false }));
      setShowNewForm(false);
      setEditArticle(null);
      setNewTitle("");
      setNewContent("");
      setNewCategory("");
      setNewTags("");
      toast.success(isEditing ? "تم تحديث السياسة خادمياً وإعادة طلب الإقرار." : "تم نشر السياسة عبر السجل الخادمي.");
    } catch (error) {
      toast.error(error instanceof Error && error.message === "forbidden" ? "النشر متاح للمالك أو المدير الإداري فقط." : "تعذر نشر السياسة. لم يتم إنشاء أي سجل محلي.");
    }
  };

  const handleDeleteArticle = async (id: string) => {
    if (!confirm("هل أنت متأكد من حذف هذه السياسة؟ سيُحذف إقرارها المرتبط فقط.")) return;
    try {
      const response = await fetch(`/api/admin/knowledge/policies/${encodeURIComponent(id)}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!response.ok) {
        if (response.status === 401 || response.status === 403) throw new Error("forbidden");
        throw new Error("delete_failed");
      }
      setArticles((current) => current.filter((article) => article.id !== id));
      setAcknowledgedPolicyIds((current) => {
        const { [id]: _removed, ...remaining } = current;
        return remaining;
      });
      if (selectedArticle?.id === id) setSelectedArticle(null);
      toast.success("تم حذف السياسة خادمياً.");
    } catch (error) {
      toast.error(error instanceof Error && error.message === "forbidden" ? "الحذف متاح للمالك أو المدير الإداري فقط." : "تعذر حذف السياسة. لم يُنفذ أي حذف محلي.");
    }
  };

  if (selectedArticle) {
    return (
      <div className="space-y-4 animate-fade-in">
        <div className="flex items-center justify-between">
          <button
            onClick={() => setSelectedArticle(null)}
            className="flex items-center gap-2 px-3 py-1.5 rounded-lg transition-all hover:bg-[hsl(0 0% 23%)]"
            style={{ fontFamily: "Alexandria", fontSize: "13px", color: peoplePrimary }}
          >
            <ChevronLeft size={16} />
            العودة للقائمة
          </button>
          <div className="flex gap-2">
            <button onClick={() => { openEdit(selectedArticle); setSelectedArticle(null); }} className="flex items-center gap-1 px-3 py-1.5 rounded-lg transition-all hover:bg-[hsl(0 0% 23%)]" style={{ fontFamily: "Alexandria", fontSize: "13px", color: peoplePrimary }}>
              <Edit2 size={14} />
              تعديل
            </button>
            <button onClick={() => handleDeleteArticle(selectedArticle.id)} className="flex items-center gap-1 px-3 py-1.5 rounded-lg transition-all hover:bg-red-500/10" style={{ fontFamily: "Alexandria", fontSize: "13px", color: "#ef4444" }}>
              <X size={14} />
              حذف
            </button>
          </div>
        </div>
        <div
          className="rounded-xl p-6"
          style={{ background: "hsl(0 0% 19%)", border: "1px solid hsl(0 0% 27%)" }}
        >
          <h1 style={{ fontFamily: "Alexandria", fontWeight: 800, fontSize: "20px", color: "hsl(0 0% 92%)", marginBottom: "12px" }}>
            {selectedArticle.title}
          </h1>
          <div className="flex items-center gap-4 mb-4 flex-wrap">
            <span style={{ fontFamily: "Alexandria", fontSize: "12px", color: "hsl(0 0% 55%)" }}>
              ✍️ {selectedArticle.author} — {selectedArticle.authorDept}
            </span>
            <span style={{ fontFamily: "Alexandria", fontSize: "12px", color: "hsl(0 0% 55%)" }}>
              👁️ {selectedArticle.views} مشاهدة
            </span>
            <span style={{ fontFamily: "Alexandria", fontSize: "12px", color: "hsl(0 0% 55%)" }}>
              👍 {selectedArticle.likes} إعجاب
            </span>
          </div>
          <div className="flex gap-2 mb-4 flex-wrap">
            {selectedArticle.tags.map(tag => (
              <span key={tag} className="badge-teal">{tag}</span>
            ))}
          </div>
          <div
            className="prose prose-invert max-w-none"
            style={{ fontFamily: "Alexandria", fontSize: "14px", color: "hsl(0 0% 80%)", lineHeight: 2 }}
          >
            {selectedArticle.content.split("\n").map((line, i) => {
              if (line.startsWith("## ")) return <h2 key={i} style={{ fontFamily: "Alexandria", fontWeight: 700, fontSize: "16px", color: peoplePrimary, marginTop: "20px", marginBottom: "8px" }}>{line.replace("## ", "")}</h2>;
              if (line.startsWith("### ")) return <h3 key={i} style={{ fontFamily: "Alexandria", fontWeight: 700, fontSize: "14px", color: "hsl(0 0% 88%)", marginTop: "12px", marginBottom: "4px" }}>{line.replace("### ", "")}</h3>;
              if (line.startsWith("- ")) return <li key={i} style={{ marginRight: "16px", marginBottom: "4px" }}>{line.replace("- ", "")}</li>;
              if (line.match(/^\d+\./)) return <li key={i} style={{ marginRight: "16px", marginBottom: "4px" }}>{line.replace(/^\d+\.\s*/, "")}</li>;
              if (line.trim() === "") return <br key={i} />;
              return <p key={i} style={{ marginBottom: "8px" }}>{line}</p>;
            })}
          </div>
          <div className="mt-6 rounded-xl p-4 flex flex-wrap items-center justify-between gap-3" style={{ background: mutedSurface, border: `1px solid ${borderColor}` }}>
            <div className="flex items-center gap-2" style={{ color: acknowledgedPolicyIds[selectedArticle.id] ? peoplePrimary : mutedText, fontFamily: "Alexandria", fontSize: "13px" }}>
              <CheckCircle2 size={18} />
              <span>{acknowledgedPolicyIds[selectedArticle.id] ? "تم تسجيل إقرارك بهذه السياسة" : "سجّل إقرارك بعد قراءة السياسة"}</span>
            </div>
            {!acknowledgedPolicyIds[selectedArticle.id] && (
              <button onClick={() => handleAcknowledgePolicy(selectedArticle.id)} disabled={isAcknowledging} className="btn-brand disabled:opacity-60">
                <CheckCircle2 size={15} />
                <span>{isAcknowledging ? "جارٍ التسجيل…" : "أقرّ بالاطلاع"}</span>
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4 animate-fade-in">
      {/* Header */}
      <div
        className="flex items-center justify-between px-5 py-4 rounded-xl"
        style={{ background: "hsl(0 0% 19%)", border: "1px solid hsl(0 0% 27%)" }}
      >
        <div className="flex items-center gap-3">
          <div className="icon-teal-lg">
            <BookOpen size={22} />
          </div>
          <div>
            <h1 style={{ fontFamily: "Alexandria", fontWeight: 800, fontSize: "16px", color: "hsl(0 0% 92%)" }}>
              قاعدة المعرفة
            </h1>
            <p style={{ fontFamily: "Alexandria", fontSize: "12px", color: "hsl(0 0% 55%)" }}>
              ويكي الشركة الداخلي • {articles.length} مقال
            </p>
          </div>
        </div>
        <button onClick={() => setShowNewForm(true)} className="btn-brand">
          <Plus size={16} />
          <span>مقال جديد</span>
        </button>
      </div>

      {/* Search */}
      <div className="relative">
        <Search size={16} style={{ position: "absolute", right: "14px", top: "50%", transform: "translateY(-50%)", color: "hsl(0 0% 45%)" }} />
        <input
          value={searchTerm}
          onChange={e => setSearchTerm(e.target.value)}
          placeholder="ابحث في قاعدة المعرفة..."
          className="w-full pr-11 pl-4 py-3 rounded-xl outline-none"
          style={{ background: "hsl(0 0% 19%)", border: "1px solid hsl(0 0% 27%)", fontFamily: "Alexandria", fontSize: "14px", color: "hsl(0 0% 88%)" }}
        />
      </div>

      {/* Categories */}
      <div className="flex gap-2 flex-wrap">
        <button
          onClick={() => setSelectedCategory("")}
          className="px-3 py-1.5 rounded-lg transition-all"
          style={{
            background: !selectedCategory ? peoplePrimarySoft : mutedSurface,
            border: `1px solid ${!selectedCategory ? "hsl(var(--primary) / 0.40)" : borderColor}`,
            color: !selectedCategory ? peoplePrimary : mutedText,
            fontFamily: "Alexandria",
            fontSize: "12px",
            fontWeight: 600,
          }}
        >
          الكل
        </button>
        {CATEGORIES.map(cat => (
          <button
            key={cat.id}
            onClick={() => setSelectedCategory(cat.id)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg transition-all"
            style={{
              background: selectedCategory === cat.id ? peoplePrimarySoft : mutedSurface,
              border: `1px solid ${selectedCategory === cat.id ? "hsl(var(--primary) / 0.40)" : borderColor}`,
              color: selectedCategory === cat.id ? peoplePrimary : mutedText,
              fontFamily: "Alexandria",
              fontSize: "12px",
              fontWeight: 600,
            }}
          >
            <span>{cat.icon}</span>
            {cat.label}
          </button>
        ))}
      </div>

      {/* Articles Grid */}
      {isLoadingPolicies && (
        <div className="rounded-xl p-8 text-center" style={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))" }}>
          <BookOpen size={28} className="mx-auto mb-3 animate-pulse" style={{ color: peoplePrimary }} />
          <p style={{ fontFamily: "Alexandria", fontSize: "13px", color: "hsl(var(--muted-foreground))" }}>جارٍ تحميل السياسات المنشورة…</p>
        </div>
      )}
      {!isLoadingPolicies && filteredArticles.length === 0 && (
        <div className="rounded-xl p-8 text-center" style={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))" }}>
          <BookOpen size={28} className="mx-auto mb-3" style={{ color: peoplePrimary }} />
          <h2 style={{ fontFamily: "Alexandria", fontWeight: 700, fontSize: "15px", color: "hsl(var(--foreground))" }}>لا توجد مقالات منشورة حالياً</h2>
          <p style={{ fontFamily: "Alexandria", fontSize: "13px", color: "hsl(var(--muted-foreground))", marginTop: "8px" }}>تظهر المقالات هنا بعد حفظها عبر سجل خادمي محمي.</p>
        </div>
      )}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {filteredArticles.map((article, i) => {
          const cat = CATEGORIES.find(c => c.id === article.category);
          return (
            <div
              key={article.id}
              onClick={() => setSelectedArticle(article)}
              className="rounded-xl p-4 cursor-pointer transition-all hover:scale-[1.01] animate-fade-in-up"
              style={{
                background: cardSurface,
                border: `1px solid ${article.pinned ? "hsl(var(--primary) / 0.30)" : borderColor}`,
                animationDelay: `${i * 40}ms`,
                opacity: 0,
              }}
            >
              <div className="flex items-start justify-between mb-2">
                <div className="flex items-center gap-2">
                  <span>{cat?.icon}</span>
                  <span style={{ fontFamily: "Alexandria", fontSize: "11px", color: cat?.color, fontWeight: 600 }}>{cat?.label}</span>
                </div>
                {article.pinned && <Bookmark size={14} style={{ color: peoplePrimary }} />}
              </div>
              <h3 style={{ fontFamily: "Alexandria", fontWeight: 700, fontSize: "14px", color: "hsl(0 0% 88%)", marginBottom: "6px" }}>
                {article.title}
              </h3>
              <p style={{ fontFamily: "Alexandria", fontSize: "12px", color: "hsl(0 0% 55%)", lineHeight: 1.5, marginBottom: "8px" }}>
                {article.content.replace(/[#*\-]/g, "").substring(0, 100)}...
              </p>
              <div className="flex items-center justify-between">
                <span style={{ fontFamily: "Alexandria", fontSize: "11px", color: "hsl(0 0% 45%)" }}>
                  {article.author}
                </span>
                <div className="flex items-center gap-3">
                  <span style={{ fontFamily: "Alexandria", fontSize: "11px", color: "hsl(0 0% 45%)" }}>👁️ {article.views}</span>
                  <span style={{ fontFamily: "Alexandria", fontSize: "11px", color: "hsl(0 0% 45%)" }}>👍 {article.likes}</span>
                  <button onClick={(e) => { e.stopPropagation(); openEdit(article); }} className="p-1 rounded hover:bg-white/10 transition-colors" title="تعديل">
                    <Edit2 size={12} className="text-gray-400" />
                  </button>
                  <button onClick={(e) => { e.stopPropagation(); handleDeleteArticle(article.id); }} className="p-1 rounded hover:bg-red-500/10 transition-colors" title="حذف">
                    <X size={12} className="text-red-400" />
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* New Article Modal */}
      {showNewForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: "rgba(0,0,0,0.6)" }}>
          <div
            className="w-full max-w-lg rounded-xl p-6 animate-fade-in-up max-h-[80vh] overflow-y-auto"
            style={{ background: "hsl(0 0% 19%)", border: "1px solid hsl(0 0% 27%)" }}
          >
            <div className="flex items-center justify-between mb-5">
              <h3 style={{ fontFamily: "Alexandria", fontWeight: 700, fontSize: "16px", color: "hsl(0 0% 92%)" }}>
                {editArticle ? "تعديل المقال ✏️" : "مقال جديد 📝"}
              </h3>
              <button onClick={() => { setShowNewForm(false); setEditArticle(null); setNewTitle(''); setNewContent(''); setNewCategory(''); setNewTags(''); }} className="p-1 rounded-lg hover:bg-[hsl(0 0% 25%)]">
                <X size={18} style={{ color: "hsl(0 0% 55%)" }} />
              </button>
            </div>
            <div className="space-y-4">
              <input
                value={newTitle}
                onChange={e => setNewTitle(e.target.value)}
                placeholder="عنوان المقال"
                className="w-full px-3 py-2.5 rounded-lg outline-none"
                style={{ background: "hsl(0 0% 23%)", border: "1px solid hsl(0 0% 31%)", fontFamily: "Alexandria", fontSize: "13px", color: "hsl(0 0% 88%)" }}
              />
              <select
                value={newCategory}
                onChange={e => setNewCategory(e.target.value)}
                className="w-full px-3 py-2.5 rounded-lg outline-none"
                style={{ background: "hsl(0 0% 23%)", border: "1px solid hsl(0 0% 31%)", fontFamily: "Alexandria", fontSize: "13px", color: "hsl(0 0% 88%)" }}
              >
                <option value="">اختر التصنيف</option>
                {CATEGORIES.map(c => <option key={c.id} value={c.id}>{c.icon} {c.label}</option>)}
              </select>
              <textarea
                value={newContent}
                onChange={e => setNewContent(e.target.value)}
                placeholder="محتوى المقال (يدعم Markdown)"
                rows={8}
                className="w-full px-3 py-2.5 rounded-lg outline-none resize-none"
                style={{ background: "hsl(0 0% 23%)", border: "1px solid hsl(0 0% 31%)", fontFamily: "Alexandria", fontSize: "13px", color: "hsl(0 0% 88%)", lineHeight: 1.7 }}
              />
              <input
                value={newTags}
                onChange={e => setNewTags(e.target.value)}
                placeholder="الوسوم (مفصولة بفاصلة)"
                className="w-full px-3 py-2.5 rounded-lg outline-none"
                style={{ background: "hsl(0 0% 23%)", border: "1px solid hsl(0 0% 31%)", fontFamily: "Alexandria", fontSize: "13px", color: "hsl(0 0% 88%)" }}
              />
              <button onClick={handleCreateArticle} className="btn-brand w-full justify-center py-2.5">
                <FileText size={16} />
                <span>{editArticle ? "حفظ التعديلات" : "نشر المقال"}</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
