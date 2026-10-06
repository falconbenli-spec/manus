import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.resolve(import.meta.dirname, "..");
const routes = fs.readFileSync(path.join(root, "server", "servicesRoutes.ts"), "utf8");
const page = fs.readFileSync(path.join(root, "client", "src", "pages", "WorkRequests.tsx"), "utf8");
const app = fs.readFileSync(path.join(root, "client", "src", "App.tsx"), "utf8");
const layout = fs.readFileSync(path.join(root, "client", "src", "components", "layout", "MainLayout.tsx"), "utf8");

describe("work request route contract", () => {
  it("derives an employee request owner from the server session and filters employee reads", () => {
    expect(routes).toContain("createdById: String(session.userId)");
    expect(routes).toContain("createdByName: String(session.name || session.userId)");
    expect(routes).toContain("createdById: String(session.userId)");
    expect(routes).toContain("createdById: String(session.userId)");
    expect(routes).toContain("createdById: String(session.userId)");
    expect(routes).toContain("createdById: String(session.userId)");
  });

  it("derives the sender department from the authenticated session", () => {
    expect(routes).toContain('const fromDept = String(session.department || "").trim();');
    expect(routes).toContain("لا يمكن تحديد الإدارة المرسلة من الجلسة");
    expect(routes).toContain("fromDept,");
    expect(routes).not.toContain("fromDept: req.body.fromDept,");
  });

  it("limits manager reads and updates to work requests linked to their department", () => {
    expect(routes).toContain('session?.role === "manager"');
    expect(routes).toContain('dept: managerDept || "__no_department__"');
    expect(routes).toContain("existing.fromDept !== managerDept && existing.toDept !== managerDept");
    expect(routes).toContain("لا تملك صلاحية تعديل هذا الطلب");
  });

  it("permits a delivery rating only from the original requester after completion", () => {
    expect(routes).toContain('r.post("/work-requests/:id/rating", requireMinRole("employee")');
    expect(routes).toContain('existing.createdById !== String(session.userId)');
    expect(routes).toContain('existing.status !== "completed"');
    expect(routes).toContain('existing.rating !== null');
    expect(routes).toContain('rating: req.body.rating');
    expect(routes).toContain('auditAction("RATE_WORK_REQUEST"');
    expect(page).toContain('detailRequest.createdById === user?.id');
    expect(page).toContain('handleRatingSubmit(detailRequest.id)');
  });

  it("creates a private in-app notification for the requester when the status changes", () => {
    expect(routes).toContain('import { createNotification } from "./notificationsDb.js"');
    expect(routes).toContain('userId: existing.createdById');
    expect(routes).toContain('title: "تحديث على طلب أعمال"');
    expect(routes).toContain('actionUrl: "/work-requests"');
    expect(routes).toContain('metadata: { workRequestId: existing.id, status: req.body.status }');
    expect(routes).toContain('Work request status notification could not be saved');
  });

  it("uses the persistent work-request statuses in the administrative interface", () => {
    expect(page).toContain('"pending_approval"');
    expect(page).toContain('handleStatusChange(req.id, "pending_approval")');
    expect(page).toContain('value={form.assigneeId}');
    expect(page).toContain('value={emp.employeeId}');
  });

  it("ships the Kanban, list filters, and registered navigation entry", () => {
    expect(page).toContain('const [viewMode, setViewMode]');
    expect(page).toContain('setViewMode("kanban")');
    expect(page).toContain('setViewMode("list")');
    expect(page).toContain('value={filterDept}');
    expect(page).toContain('value={filterStatus}');
    expect(page).toContain('value={filterPriority}');
    expect(page).toContain('<KanbanColumn');
    expect(page).toContain('<table');
    expect(app).toContain('path="/work-requests"');
    expect(layout).toContain('path: "/work-requests"');
  });

  it("calculates the operational report from the requests already scoped by the server", () => {
    expect(page).toContain('const report = useMemo');
    expect(page).toContain('averageCompletionDays');
    expect(page).toContain('completionRate');
    expect(page).toContain('counts[request.toDept]');
    expect(page).toContain('تقرير نطاق الطلبات');
    expect(page).toContain('يعكس هذا التقرير الطلبات المتاحة لك فقط');
    expect(page).toContain('الطلبات حسب الإدارة المستقبلة');
  });

  it("checks server responses before reporting successful work-request changes", () => {
    expect(page).toContain('const getApiError = async (response: Response, fallback: string)');
    expect(page).toContain('if (!res.ok) throw new Error(await getApiError(res, "تعذر تحديث الطلب"));');
    expect(page).toContain('if (!res.ok) throw new Error(await getApiError(res, "تعذر إنشاء الطلب"));');
    expect(page).toContain('if (!res.ok) throw new Error(await getApiError(res, "فشل تحديث الحالة"));');
    expect(page).toContain('if (!res.ok) throw new Error(await getApiError(res, "فشل حذف الطلب"));');
    expect(page).toContain('toast.error(error instanceof Error ? error.message : "فشل تحميل الطلبات")');
  });
});
