/**
 * OrgChart - الهيكل التنظيمي
 * Professional interactive organizational chart with company branding
 * Structure:
 *   CEO (عبدالرحمن الخليفة)
 *   ├── صالح الربيعان (نائب الرئيس للنمو) → all operational departments
 *   └── بشاير الشدوخي (مستشار تنفيذي) → HR + exec support staff
 */
import { useEffect, useState, useRef } from "react";
import {
  Building2,
  ChevronDown,
  ChevronUp,
  Users,
  User,
  Briefcase,
  ZoomIn,
  ZoomOut,
  Maximize2,
  FoldVertical,
  UnfoldVertical,
  Search,
  X,
} from "lucide-react";

// ─── Types ───────────────────────────────────────────────────────────────────
interface OrgNode {
  id: string;
  name: string;
  title: string;
  department: string;
  level: number;
  children: OrgNode[];
  employeeCount?: number;
  isExpanded?: boolean;
  isSmall?: boolean; // For office manager small card
  isVP?: boolean; // For VP-level nodes
  isAside?: boolean; // For nodes positioned beside (not under) the parent
  asideNode?: OrgNode; // Node to display beside this node
}

export function findDepartmentHead(employees: any[]) {
  return employees.find((employee) => employee.jobTitle.includes("مدير إدارة") || employee.jobTitle.includes("مدير ادارة"))
    || employees.find((employee) => /^مدير\s+(?!أول\b)/.test(employee.jobTitle))
    || employees.find((employee) => employee.jobTitle.includes("مدير"));
}

export function findCreativeDepartmentHead(employees: any[]) {
  return employees.find((employee) => employee.jobTitle.includes("مدير الاستراتيجية الإبداعية"))
    || findDepartmentHead(employees);
}

const departmentAliases: Record<string, string[]> = {
  "التسويق الرقمي": ["التسويق الرقمي", "الترويج الرقمي"],
  "الإبداع": ["الإبداع", "الإبداعية"],
  "الإنتاج": ["الإنتاج", "الإنتاج المرئي"],
  "التسويق": ["التسويق"],
  "العلاقات العامة": ["العلاقات العامة"],
  "الأعمال": ["الأعمال"],
  "رأس المال البشري": ["رأس المال البشري"],
  "التواصل الداخلي": ["التواصل الداخلي"],
};
const peoplePrimary = "hsl(var(--primary))";

export function isInDepartment(employee: { department?: string }, department: string) {
  return (departmentAliases[department] ?? [department]).includes(employee.department ?? "");
}

// ─── Build the org tree from employee data ───────────────────────────────────
function buildOrgTree(employeesData: any[]): OrgNode {
  const ceo = employeesData.find((e: any) => e.jobTitle === "الرئيس التنفيذي");
  const fahadHarbi = employeesData.find((e: any) => e.nameAr.includes("فهد") && e.nameAr.includes("حربي"));
  const salehRubaian = employeesData.find((e: any) => e.nameAr.includes("صالح") && e.nameAr.includes("ربيعان"));
  const bashayerShadookhi = employeesData.find((e: any) => e.nameAr.includes("بشاير") && e.nameAr.includes("شدوخي"));

  // Employees under Bashayer (exec support + HR)
  const abdulrahmanAlAbdulaziz = employeesData.find((e: any) => e.nameAr.includes("عبدالرحمن") && e.nameAr.includes("آل عبدالعزيز"));
  const faresHawas = employeesData.find((e: any) => e.nameAr.includes("فارس") && e.nameAr.includes("حواس"));
  const batoolHumaidi = employeesData.find((e: any) => e.nameAr.includes("بتول") && e.nameAr.includes("الحميدي"));

  // Finance Department employees (under Bashayer)
  const nawafOtaibi = employeesData.find((e: any) => e.nameAr.includes("نواف") && e.nameAr.includes("عتيبي"));
  const saeedHaddal = employeesData.find((e: any) => e.nameAr.includes("سعيد") && e.nameAr.includes("حدال"));

  // HR Department employees (under Bashayer)
  const hrEmployees = employeesData.filter((e: any) => 
    isInDepartment(e, "رأس المال البشري") && e.nameAr !== bashayerShadookhi?.nameAr
  );

  // Departments under Saleh Al-Rubaian
  const operationalDepts = [
    { name: "التسويق الرقمي" },
    { name: "الإبداع" },
    { name: "الإنتاج" },
    { name: "التسويق" },
    { name: "العلاقات العامة" },
    { name: "الأعمال" },
  ];

  // IDs to exclude from departments (moved to other places in the org chart)
  const excludedEmployeeIds = [nawafOtaibi?.employeeId, saeedHaddal?.employeeId, batoolHumaidi?.employeeId].filter(Boolean);

  // Special handling for الإبداع department
  const creativityEmployees = employeesData.filter((e: any) => 
    isInDepartment(e, "الإبداع") && !excludedEmployeeIds.includes(e.employeeId)
  );
  const creativityHead = findCreativeDepartmentHead(creativityEmployees);
  
  // عبدالله بوقس - مدير الفنون - المصممين يرجعون له
  const abdullahBuqus = creativityEmployees.find((e: any) => e.nameAr.includes("بوقس"));
  const designers = creativityEmployees.filter((e: any) => 
    e.jobTitle.includes("تصميم") && e.employeeId !== abdullahBuqus?.employeeId
  );
  
  const designerNodes: OrgNode[] = designers.map((m: any) => ({
    id: m.employeeId,
    name: m.nameAr,
    title: m.jobTitle,
    department: "الإبداع",
    level: getLevel(m.jobTitle),
    children: [],
  }));
  
  const buqusNode: OrgNode = {
    id: abdullahBuqus?.employeeId || "buqus",
    name: abdullahBuqus?.nameAr || "عبدالله بوقس",
    title: abdullahBuqus?.jobTitle || "مدير الفنون",
    department: "الإبداع",
    level: 7,
    children: designerNodes,
    isExpanded: false,
  };
  
  // باقي موظفين الإبداع (غير المصممين وغير بوقس)
  const otherCreativityMembers = creativityEmployees.filter((e: any) => 
    !e.jobTitle.includes("تصميم")
      && e.employeeId !== abdullahBuqus?.employeeId
      && e.employeeId !== creativityHead?.employeeId
  );
  
  const otherCreativityNodes: OrgNode[] = otherCreativityMembers.map((m: any) => ({
    id: m.employeeId,
    name: m.nameAr,
    title: m.jobTitle,
    department: "الإبداع",
    level: getLevel(m.jobTitle),
    children: [],
  }));
  
  // The approved master-sheet holder is the department head; never present a
  // vacancy label where an active employee record supplies the actual title.
  const creativityDeptNode: OrgNode = {
    id: creativityHead?.employeeId || "creativity-dept",
    name: creativityHead?.nameAr || "الإبداع",
    title: creativityHead?.jobTitle || "لم يتم تعيين مدير",
    department: "الإبداع",
    level: 7,
    children: [buqusNode, ...otherCreativityNodes],
    employeeCount: creativityEmployees.length,
    isExpanded: false,
  };

  // Other departments (excluding الإبداع which is handled separately)
  const otherOperationalDepts = operationalDepts.filter(d => d.name !== "الإبداع");
  
  const deptNodes: OrgNode[] = otherOperationalDepts.map((dept) => {
    const deptEmployees = employeesData.filter((e: any) => 
      isInDepartment(e, dept.name) && !excludedEmployeeIds.includes(e.employeeId)
    );
    const head = findDepartmentHead(deptEmployees);
    const members = deptEmployees.filter((e: any) => e.employeeId !== head?.employeeId);

    const memberNodes: OrgNode[] = members.map((m: any) => ({
      id: m.employeeId,
      name: m.nameAr,
      title: m.jobTitle,
      department: dept.name,
      level: getLevel(m.jobTitle),
      children: [],
    }));

    return {
      id: head?.employeeId || `dept-${dept.name}`,
      name: head?.nameAr || dept.name,
      title: head?.jobTitle || "لم يتم تعيين مدير",
      department: dept.name,
      level: 7,
      children: memberNodes,
      employeeCount: deptEmployees.length,
      isExpanded: false,
    };
  });
  
  // Add creativity department node to the list
  deptNodes.splice(1, 0, creativityDeptNode);

  // HR Department node (under Bashayer)
  const hrHead = findDepartmentHead(hrEmployees);
  const hrMembers = hrEmployees.filter((e: any) => e.employeeId !== hrHead?.employeeId);

  const hrNode: OrgNode = {
    id: hrHead?.employeeId || "hr-dept",
    name: hrHead?.nameAr || "رأس المال البشري",
    title: hrHead?.jobTitle || "لم يتم تعيين مدير",
    department: "رأس المال البشري",
    level: 7,
    children: hrMembers.map((m: any) => ({
      id: m.employeeId,
      name: m.nameAr,
      title: m.jobTitle,
      department: "رأس المال البشري",
      level: getLevel(m.jobTitle),
      children: [],
    })),
    employeeCount: hrEmployees.length,
    isExpanded: false,
  };

  // Finance Department node (under Bashayer)
  const financeMembers: OrgNode[] = [];
  if (nawafOtaibi) {
    financeMembers.push({
      id: nawafOtaibi.employeeId,
      name: nawafOtaibi.nameAr,
      title: nawafOtaibi.jobTitle,
      department: "الإدارة المالية",
      level: getLevel(nawafOtaibi.jobTitle),
      children: [],
    });
  }
  if (saeedHaddal) {
    financeMembers.push({
      id: saeedHaddal.employeeId,
      name: saeedHaddal.nameAr,
      title: saeedHaddal.jobTitle,
      department: "الإدارة المالية",
      level: getLevel(saeedHaddal.jobTitle),
      children: [],
    });
  }

  const financeNode: OrgNode = {
    id: "finance-dept",
    name: "الإدارة المالية",
    title: "الإدارة المالية",
    department: "الإدارة المالية",
    level: 7,
    children: financeMembers,
    employeeCount: financeMembers.length,
    isExpanded: false,
  };

  // Bashayer's direct reports (exec support staff + HR + Finance)
  const bashayerChildren: OrgNode[] = [];
  
  if (abdulrahmanAlAbdulaziz) {
    bashayerChildren.push({
      id: abdulrahmanAlAbdulaziz.employeeId,
      name: abdulrahmanAlAbdulaziz.nameAr,
      title: abdulrahmanAlAbdulaziz.jobTitle,
      department: "الإدارة التنفيذية",
      level: getLevel(abdulrahmanAlAbdulaziz.jobTitle),
      children: [],
    });
  }
  if (faresHawas) {
    bashayerChildren.push({
      id: faresHawas.employeeId,
      name: faresHawas.nameAr,
      title: faresHawas.jobTitle,
      department: "الإدارة التنفيذية",
      level: getLevel(faresHawas.jobTitle),
      children: [],
    });
  }
  if (batoolHumaidi) {
    bashayerChildren.push({
      id: batoolHumaidi.employeeId,
      name: batoolHumaidi.nameAr,
      title: batoolHumaidi.jobTitle,
      department: "الإدارة التنفيذية",
      level: getLevel(batoolHumaidi.jobTitle),
      children: [],
    });
  }
  // Internal Communications Department (التواصل الداخلي) - under Bashayer
  const internalCommsEmployees = employeesData.filter((e: any) => 
    isInDepartment(e, "التواصل الداخلي")
  );
  const internalCommsHead = findDepartmentHead(internalCommsEmployees);
  const internalCommsMembers = internalCommsEmployees.filter((e: any) => e.employeeId !== internalCommsHead?.employeeId);
  
  const internalCommsNode: OrgNode = {
    id: internalCommsHead?.employeeId || "internal-comms",
    name: internalCommsHead?.nameAr || "التواصل الداخلي",
    title: internalCommsHead?.jobTitle || "لم يتم تعيين مدير",
    department: "التواصل الداخلي",
    level: 7,
    children: internalCommsMembers.map((m: any) => ({
      id: m.employeeId,
      name: m.nameAr,
      title: m.jobTitle,
      department: "التواصل الداخلي",
      level: getLevel(m.jobTitle),
      children: [],
    })),
    employeeCount: internalCommsEmployees.length,
    isExpanded: false,
  };

  bashayerChildren.push(hrNode);
  bashayerChildren.push(financeNode);

  // Bashayer node
  const bashayerNode: OrgNode = {
    id: bashayerShadookhi?.employeeId || "bashayer",
    name: bashayerShadookhi?.nameAr || "بشاير الشدوخي",
    title: bashayerShadookhi?.jobTitle || "مستشار تنفيذي",
    department: "الإدارة التنفيذية",
    level: 10,
    children: bashayerChildren,
    employeeCount: bashayerChildren.length + hrMembers.length,
    isExpanded: true,
    isVP: true,
  };

  // Saleh Al-Rubaian node (VP Growth) with operational departments
  const salehNode: OrgNode = {
    id: salehRubaian?.employeeId || "saleh",
    name: salehRubaian?.nameAr || "صالح الربيعان",
    title: salehRubaian?.jobTitle || "نائب الرئيس للنمو",
    department: "الإدارة التنفيذية",
    level: 11,
    children: [...deptNodes, internalCommsNode],
    employeeCount: deptNodes.reduce((sum, d) => sum + (d.employeeCount || 0), 0) + (internalCommsNode.employeeCount || 0),
    isExpanded: true,
    isVP: true,
  };

  // CEO node - Saleh and Bashayer are direct reports
  const ceoNode: OrgNode = {
    id: ceo?.employeeId || "ceo",
    name: ceo?.nameAr || "الرئيس التنفيذي",
    title: ceo?.jobTitle || "الرئيس التنفيذي",
    department: "الإدارة التنفيذية",
    level: 13,
    children: [salehNode, bashayerNode],
    employeeCount: employeesData.length,
    isExpanded: true,
  };

  return ceoNode;
}

function getLevel(title: string): number {
  if (title.includes("رئيس تنفيذي")) return 13;
  if (title.includes("مدير عام")) return 11;
  if (title.includes("نائب الرئيس")) return 11;
  if (title.includes("مستشار")) return 10;
  if (title.includes("مدير أول")) return 8;
  if (title.includes("مدير إدارة") || title.includes("مدير ادارة")) return 7;
  if (title.includes("مدير")) return 7;
  if (title.includes("مساعد مدير")) return 6;
  if (title.includes("أخصائي أول")) return 5;
  if (title.includes("اخصائي أول")) return 5;
  if (title.includes("أخصائي")) return 4;
  if (title.includes("مسؤول أول")) return 3;
  if (title.includes("مسؤول")) return 2;
  return 1;
}

function getLevelColor(level: number): string {
  if (level >= 11) return "#D4AF37"; // Gold for C-suite
  if (level >= 9) return "#C9A227"; // Darker gold for senior execs
  if (level >= 7) return peoplePrimary; // People36t primary for managers
  if (level >= 5) return "#2E86AB"; // Blue for senior specialists
  return "#5E6C84"; // Gray for others
}

function getLevelBg(level: number): string {
  if (level >= 11) return "rgba(212,175,55,0.12)";
  if (level >= 9) return "rgba(201,162,39,0.10)";
  if (level >= 7) return "hsl(165 69% 39% / 0.10)";
  if (level >= 5) return "rgba(46,134,171,0.08)";
  return "rgba(94,108,132,0.06)";
}

// ─── OrgNode Card Component ──────────────────────────────────────────────────
function OrgNodeCard({
  node,
  onToggle,
  depth = 0,
}: {
  node: OrgNode;
  onToggle: (id: string) => void;
  depth?: number;
}) {
  const hasChildren = node.children.length > 0;
  const color = getLevelColor(node.level);
  const bgColor = getLevelBg(node.level);
  const isRoot = depth === 0;
  const isSmall = node.isSmall;

  // Small card for office manager
  if (isSmall) {
    return (
      <div className="flex flex-col items-center">
        {depth > 0 && (
          <div
            style={{
              width: "2px",
              height: "20px",
              background: color,
            }}
          />
        )}
        <div
          className="rounded-lg border px-3 py-2 text-center"
          style={{
            background: "rgba(94,108,132,0.08)",
            borderColor: "rgba(94,108,132,0.25)",
            minWidth: "120px",
          }}
        >
          <div className="text-xs font-bold" style={{ color: "hsl(var(--foreground))", fontSize: "11px" }}>
            {node.name}
          </div>
          <div className="text-xs" style={{ color: "#5E6C84", fontSize: "10px" }}>
            {node.title}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center">
      {/* Connection line from parent */}
      {depth > 0 && (
        <div
          style={{
            width: "2px",
            height: "24px",
            background: color,
          }}
        />
      )}

      {/* CEO + Aside Node (Fahad beside CEO) */}
      {node.asideNode ? (
        <div className="flex items-center gap-4">
          {/* Aside node (Fahad) on the right side */}
          <div className="flex items-center gap-3">
            <div
              className="rounded-lg border px-3 py-2 text-center"
              style={{
                background: "rgba(94,108,132,0.08)",
                borderColor: "rgba(94,108,132,0.25)",
                minWidth: "120px",
              }}
            >
              <div className="text-xs font-bold" style={{ color: "hsl(var(--foreground))", fontSize: "11px" }}>
                {node.asideNode.name}
              </div>
              <div className="text-xs" style={{ color: "#5E6C84", fontSize: "10px" }}>
                {node.asideNode.title}
              </div>
            </div>
            {/* Horizontal dashed connector */}
            <div
              style={{
                width: "40px",
                height: "2px",
                borderTop: "2px dashed rgba(94,108,132,0.4)",
              }}
            />
          </div>
          {/* Main CEO Card */}
          <div
            className="relative rounded-2xl border transition-all duration-300 hover:scale-[1.02] cursor-pointer"
            style={{
              background: "hsl(var(--card))",
              borderColor: `${color}33`,
              padding: "20px 28px",
              minWidth: "260px",
              boxShadow: `0 4px 20px ${color}11, inset 0 1px 0 ${color}22`,
            }}
            onClick={() => hasChildren && onToggle(node.id)}
          >
            <div
              className="absolute inset-0 rounded-2xl"
              style={{
                background: "transparent",
                pointerEvents: "none",
              }}
            />
            <div className="relative flex flex-col items-center text-center gap-1">
              <div
                className="rounded-full flex items-center justify-center mb-2"
                style={{
                  width: "48px",
                  height: "48px",
                  background: `${color}22`,
                  border: `2px solid ${color}55`,
                }}
              >
                <Building2 size={22} style={{ color }} />
              </div>
              <div
                className="font-bold text-sm leading-tight"
                style={{ color: "hsl(var(--foreground))", fontSize: "15px" }}
              >
                {node.name}
              </div>
              <div
                className="text-xs leading-tight"
                style={{ color, fontWeight: 600, opacity: 0.9 }}
              >
                {node.title}
              </div>
              {node.employeeCount && node.employeeCount > 1 && (
                <div
                  className="mt-1 flex items-center gap-1 text-xs"
                  style={{ color: "hsl(var(--muted-foreground))" }}
                >
                  <Users size={10} />
                  <span>{node.employeeCount} موظف</span>
                </div>
              )}
              {hasChildren && (
                <div
                  className="mt-2 rounded-full flex items-center justify-center"
                  style={{
                    width: "22px",
                    height: "22px",
                    background: `${color}20`,
                    border: `1px solid ${color}44`,
                  }}
                >
                  {node.isExpanded ? (
                    <ChevronUp size={12} style={{ color }} />
                  ) : (
                    <ChevronDown size={12} style={{ color }} />
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      ) : (
      /* Regular Node Card */
      <div
        className="relative rounded-2xl border transition-all duration-300 hover:scale-[1.02] cursor-pointer"
        style={{
          background: isRoot
            ? "hsl(var(--card))"
            : node.isVP
            ? "hsl(var(--muted))"
            : bgColor,
          borderColor: `${color}33`,
          padding: isRoot ? "20px 28px" : node.isVP ? "16px 24px" : "14px 20px",
          minWidth: isRoot ? "260px" : node.isVP ? "230px" : "200px",
          boxShadow: `0 4px 20px ${color}11, inset 0 1px 0 ${color}22`,
        }}
        onClick={() => hasChildren && onToggle(node.id)}
      >
        {/* Glow effect for root & VP */}
        {(isRoot || node.isVP) && (
          <div
            className="absolute inset-0 rounded-2xl"
            style={{
              background: "transparent",
              pointerEvents: "none",
            }}
          />
        )}

        <div className="relative flex flex-col items-center text-center gap-1">
          {/* Avatar circle */}
          <div
            className="rounded-full flex items-center justify-center mb-2"
            style={{
              width: isRoot ? "48px" : node.isVP ? "42px" : "36px",
              height: isRoot ? "48px" : node.isVP ? "42px" : "36px",
              background: `${color}22`,
              border: `2px solid ${color}55`,
            }}
          >
            {isRoot ? (
              <Building2 size={22} style={{ color }} />
            ) : hasChildren ? (
              <Users size={16} style={{ color }} />
            ) : (
              <User size={14} style={{ color }} />
            )}
          </div>

          {/* Name */}
          <div
            className="font-bold text-sm leading-tight"
            style={{ color: "hsl(var(--foreground))", fontSize: isRoot ? "15px" : node.isVP ? "14px" : "13px" }}
          >
            {node.name}
          </div>

          {/* Title */}
          <div
            className="text-xs leading-tight"
            style={{ color, fontWeight: 600, opacity: 0.9 }}
          >
            {node.title}
          </div>

          {/* Department badge */}
          {depth > 1 && !node.isVP && (
            <div
              className="mt-1 px-2 py-0.5 rounded-full text-xs"
              style={{ background: `${color}15`, color: `${color}cc`, fontSize: "10px" }}
            >
              {node.department}
            </div>
          )}

          {/* Employee count */}
          {node.employeeCount && node.employeeCount > 1 && (
            <div
              className="mt-1 flex items-center gap-1 text-xs"
              style={{ color: "hsl(var(--muted-foreground))" }}
            >
              <Users size={10} />
              <span>{node.employeeCount} موظف</span>
            </div>
          )}

          {/* Expand/Collapse indicator */}
          {hasChildren && (
            <div
              className="mt-2 rounded-full flex items-center justify-center"
              style={{
                width: "22px",
                height: "22px",
                background: `${color}20`,
                border: `1px solid ${color}44`,
              }}
            >
              {node.isExpanded ? (
                <ChevronUp size={12} style={{ color }} />
              ) : (
                <ChevronDown size={12} style={{ color }} />
              )}
            </div>
          )}
        </div>
      </div>
      )}

      {/* Children */}
      {hasChildren && node.isExpanded && (
        <>
          {/* Vertical line down */}
          <div
            style={{
              width: "2px",
              height: "24px",
              background: color,
            }}
          />

          {/* Horizontal connector */}
          {node.children.length > 1 && (
            <div
              style={{
                height: "2px",
                width: `${Math.min(node.children.length * 240, 900)}px`,
                maxWidth: "90vw",
                background: `${color}66`,
              }}
            />
          )}

          {/* Children nodes */}
          <div
            className="flex flex-wrap justify-center gap-4 mt-0"
            style={{ maxWidth: "100%" }}
          >
            {node.children.map((child) => (
              <OrgNodeCard
                key={child.id}
                node={child}
                onToggle={onToggle}
                depth={depth + 1}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// ─── Department Summary Card ─────────────────────────────────────────────────
function DeptSummaryCard({ dept, count, head }: { dept: string; count: number; head: string }) {
  return (
    <div
      className="rounded-xl p-3 border transition-all hover:border-opacity-60"
      style={{
        background: "hsl(165 69% 39% / 0.05)",
        borderColor: "hsl(165 69% 39% / 0.15)",
      }}
    >
      <div className="flex items-center gap-2 mb-1">
        <Briefcase size={14} style={{ color: peoplePrimary }} />
        <span className="font-bold text-xs" style={{ color: "hsl(var(--foreground))" }}>
          {dept}
        </span>
      </div>
      <div className="text-xs" style={{ color: "hsl(var(--muted-foreground))" }}>
        {head}
      </div>
      <div className="text-xs mt-1" style={{ color: peoplePrimary }}>
        {count} موظف
      </div>
    </div>
  );
}

// ─── Main Component ──────────────────────────────────────────────────────────
export default function OrgChart() {
  const [employeesData, setEmployeesData] = useState<any[]>([]);
  const [orgTree, setOrgTree] = useState<OrgNode>(() => buildOrgTree([]));
  const [zoom, setZoom] = useState(0.85);
  const [searchTerm, setSearchTerm] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let active = true;
    fetch("/api/hcm/employees", { credentials: "include" })
      .then(async (response) => {
        if (!response.ok) throw new Error("Unable to load organization data");
        return response.json();
      })
      .then((records: any[]) => {
        if (!active) return;
        const employees = (Array.isArray(records) ? records : []).map((employee) => ({
          employeeId: String(employee.employee_id || employee.employeeId || ""),
          nameAr: String(employee.name_ar || employee.nameAr || ""),
          nameEn: String(employee.name_en || employee.nameEn || ""),
          jobTitle: String(employee.job_title || employee.jobTitle || ""),
          department: String(employee.department || employee.department_en || ""),
        }));
        setEmployeesData(employees);
        setOrgTree(buildOrgTree(employees));
      })
      .catch(() => {
        if (!active) return;
        setEmployeesData([]);
        setOrgTree(buildOrgTree([]));
      });
    return () => {
      active = false;
    };
  }, []);

  const normalizedSearch = searchTerm.trim().toLocaleLowerCase("ar-SA");
  const searchResults = normalizedSearch
    ? employeesData.filter((employee: any) =>
        [employee.nameAr, employee.nameEn, employee.department, employee.jobTitle]
          .filter(Boolean)
          .some((value) => String(value).toLocaleLowerCase("ar-SA").includes(normalizedSearch)),
      )
    : [];

  // Toggle expand/collapse
  const toggleNode = (id: string) => {
    setOrgTree((prev) => toggleNodeById(prev, id));
  };

  function toggleNodeById(node: OrgNode, id: string): OrgNode {
    if (node.id === id) {
      return { ...node, isExpanded: !node.isExpanded };
    }
    return {
      ...node,
      children: node.children.map((child) => toggleNodeById(child, id)),
    };
  }

  // Expand all nodes
  function expandAllNodes(node: OrgNode): OrgNode {
    return {
      ...node,
      isExpanded: node.children.length > 0 ? true : node.isExpanded,
      children: node.children.map((child) => expandAllNodes(child)),
    };
  }

  // Collapse all nodes (keep CEO expanded)
  function collapseAllNodes(node: OrgNode, isRoot = true): OrgNode {
    return {
      ...node,
      isExpanded: isRoot ? true : false,
      children: node.children.map((child) => collapseAllNodes(child, false)),
    };
  }

  const expandAll = () => {
    setOrgTree((prev) => expandAllNodes(prev));
  };

  const collapseAll = () => {
    setOrgTree((prev) => collapseAllNodes(prev));
  };

  // Department summary data
  const deptSummary = [
    { dept: "الإدارة التنفيذية", count: 6, head: "الرئيس التنفيذي" },
    { dept: "التسويق الرقمي", count: 9, head: "مدير إدارة التسويق الرقمي" },
    { dept: "الإبداع", count: 11, head: "مدير الاستراتيجية الإبداعية" },
    { dept: "الإنتاج", count: 6, head: "مدير الإنتاج المرئي" },
    { dept: "التسويق", count: 7, head: "مدير أول حسابات" },
    { dept: "العلاقات العامة", count: 5, head: "مدير العلاقات الإعلامية" },
    { dept: "الأعمال", count: 5, head: "مدير إدارة الأعمال" },
    { dept: "رأس المال البشري", count: 5, head: "مدير رأس المال البشري" },
  ];

  return (
    <div
      className="min-h-screen"
      dir="rtl"
      style={{ background: "hsl(var(--background))", fontFamily: "Alexandria, system-ui, sans-serif" }}
    >
      {/* Header */}
      <div
        className="px-6 py-4 flex items-center justify-between sticky top-0 z-10"
        style={{
          borderBottom: "1px solid hsl(var(--muted))",
          background: "hsl(var(--background))",
          backdropFilter: "blur(10px)",
        }}
      >
        <div className="flex items-center gap-3">
          <div
            className="rounded-xl flex items-center justify-center"
            style={{ width: "40px", height: "40px", background: "hsl(165 69% 39% / 0.15)" }}
          >
            <Building2 size={20} style={{ color: "#1FA98C" }} />
          </div>
          <div>
            <h1
              className="text-xl font-black"
              style={{ color: "hsl(var(--foreground))" }}
            >
              الهيكل التنظيمي
            </h1>
            <p className="text-xs" style={{ color: "hsl(var(--muted-foreground))" }}>
              3.6T Comms — Organizational Chart
            </p>
          </div>
        </div>

        {/* Zoom Controls */}
        <div className="flex items-center gap-2">
          <button
            onClick={() => setZoom((z) => Math.max(0.4, z - 0.1))}
            className="rounded-lg p-2 transition-all hover:opacity-80"
            style={{ background: "hsl(165 69% 39% / 0.10)", color: "#1FA98C" }}
          >
            <ZoomOut size={16} />
          </button>
          <span className="text-xs font-bold" style={{ color: "hsl(var(--muted-foreground))", minWidth: "40px", textAlign: "center" }}>
            {Math.round(zoom * 100)}%
          </span>
          <button
            onClick={() => setZoom((z) => Math.min(1.5, z + 0.1))}
            className="rounded-lg p-2 transition-all hover:opacity-80"
            style={{ background: "hsl(165 69% 39% / 0.10)", color: "#1FA98C" }}
          >
            <ZoomIn size={16} />
          </button>
          <button
            onClick={() => setZoom(0.85)}
            className="rounded-lg p-2 transition-all hover:opacity-80"
            style={{ background: "hsl(165 69% 39% / 0.10)", color: "#1FA98C" }}
          >
            <Maximize2 size={16} />
          </button>
          <div style={{ width: "1px", height: "20px", background: "hsl(var(--border))" }} />
          <button
            onClick={expandAll}
            className="rounded-lg p-2 transition-all hover:opacity-80 flex items-center gap-1"
            style={{ background: "hsl(165 69% 39% / 0.10)", color: "#1FA98C" }}
            title="توسيع الكل"
          >
            <UnfoldVertical size={16} />
            <span className="text-xs hidden sm:inline">توسيع</span>
          </button>
          <button
            onClick={collapseAll}
            className="rounded-lg p-2 transition-all hover:opacity-80 flex items-center gap-1"
            style={{ background: "hsl(165 69% 39% / 0.10)", color: "#1FA98C" }}
            title="طي الكل"
          >
            <FoldVertical size={16} />
            <span className="text-xs hidden sm:inline">طي</span>
          </button>
        </div>
      </div>

      {/* Stats Bar */}
      <div
        className="px-6 py-3 flex items-center gap-6 overflow-x-auto"
        style={{ borderBottom: "1px solid hsl(var(--card))" }}
      >
        <div className="flex items-center gap-2">
          <Users size={14} style={{ color: "#1FA98C" }} />
          <span className="text-xs font-bold" style={{ color: "hsl(var(--muted-foreground))" }}>
            {employeesData.length} موظف
          </span>
        </div>
        <div className="flex items-center gap-2">
          <Building2 size={14} style={{ color: "#D4AF37" }} />
          <span className="text-xs font-bold" style={{ color: "hsl(var(--muted-foreground))" }}>
            8 إدارات
          </span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full" style={{ background: "#D4AF37" }} />
          <span className="text-xs" style={{ color: "hsl(var(--muted-foreground))" }}>قيادة عليا</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full" style={{ background: "#C9A227" }} />
          <span className="text-xs" style={{ color: "hsl(var(--muted-foreground))" }}>نواب الرئيس</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full" style={{ background: "#1FA98C" }} />
          <span className="text-xs" style={{ color: "hsl(var(--muted-foreground))" }}>مدراء</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full" style={{ background: "#2E86AB" }} />
          <span className="text-xs" style={{ color: "hsl(var(--muted-foreground))" }}>أخصائيون</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full" style={{ background: "#5E6C84" }} />
          <span className="text-xs" style={{ color: "hsl(var(--muted-foreground))" }}>مسؤولون</span>
        </div>
      </div>

      <div className="px-6 pt-4">
        <div className="relative max-w-2xl mx-auto">
          <Search className="absolute right-3 top-1/2 -translate-y-1/2" size={17} style={{ color: "#1FA98C" }} />
          <input
            value={searchTerm}
            onChange={(event) => setSearchTerm(event.target.value)}
            placeholder="ابحث بالاسم أو الإدارة أو المسمى الوظيفي"
            aria-label="البحث في الهيكل التنظيمي"
            className="w-full rounded-xl py-3 pr-10 pl-10 text-sm outline-none"
            style={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", color: "hsl(var(--foreground))" }}
          />
          {searchTerm && (
            <button
              type="button"
              onClick={() => setSearchTerm("")}
              aria-label="مسح البحث"
              className="absolute left-3 top-1/2 -translate-y-1/2 rounded p-1"
              style={{ color: "hsl(var(--muted-foreground))" }}
            >
              <X size={16} />
            </button>
          )}
        </div>
        {searchTerm && (
          <div className="max-w-2xl mx-auto mt-3" aria-live="polite" data-testid="org-chart-search-results">
            {searchResults.length > 0 ? (
              <div className="grid sm:grid-cols-2 gap-2">
                {searchResults.map((employee: any) => (
                  <div key={employee.employeeId} className="rounded-xl px-4 py-3 border" style={{ background: "hsl(var(--card))", borderColor: "hsl(var(--border))" }}>
                    <p className="font-bold text-sm" style={{ color: "hsl(var(--foreground))" }}>{employee.nameAr}</p>
                    <p className="text-xs mt-1" style={{ color: "#1FA98C" }}>{employee.jobTitle}</p>
                    <p className="text-xs mt-1" style={{ color: "hsl(var(--muted-foreground))" }}>{employee.department}</p>
                  </div>
                ))}
              </div>
            ) : (
              <p className="rounded-xl px-4 py-3 text-sm" style={{ background: "hsl(var(--card))", color: "hsl(var(--muted-foreground))" }}>لا توجد نتائج مطابقة للبحث.</p>
            )}
          </div>
        )}
      </div>

      {/* Department Summary Grid */}
      <div className="px-6 py-4">
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-2">
          {deptSummary.map((d) => (
            <DeptSummaryCard key={d.dept} {...d} />
          ))}
        </div>
      </div>

      {/* Org Chart Canvas */}
      <div
        ref={containerRef}
        className="overflow-auto px-4 pb-12"
        style={{ minHeight: "calc(100vh - 280px)" }}
      >
        <div
          className="flex justify-center py-8 transition-transform duration-300"
          style={{
            transform: `scale(${zoom})`,
            transformOrigin: "top center",
            minWidth: "fit-content",
          }}
        >
          <OrgNodeCard node={orgTree} onToggle={toggleNode} depth={0} />
        </div>
      </div>

      {/* Footer hint */}
      <div
        className="fixed bottom-4 left-1/2 -translate-x-1/2 px-4 py-2 rounded-full text-xs"
        style={{
          background: "hsl(165 69% 39% / 0.10)",
          color: "hsl(var(--muted-foreground))",
          border: "1px solid hsl(165 69% 39% / 0.20)",
          backdropFilter: "blur(10px)",
        }}
      >
        اضغط على أي قسم لعرض/إخفاء الموظفين
      </div>
    </div>
  );
}
