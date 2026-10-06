import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const appSource = readFileSync(resolve(process.cwd(), "client", "src", "App.tsx"), "utf8");

describe("lazy report routes contract", () => {
  it("loads report pages on demand while keeping a localized fallback", () => {
    expect(appSource).toContain('const ReportsCenter = lazy(() => import("./pages/ReportsCenter"));');
    expect(appSource).toContain('const DepartmentReports = lazy(() => import("./pages/DepartmentReports"));');
    expect(appSource).toContain("<Suspense fallback=");
    expect(appSource).toContain("جارٍ تحميل الوحدة");
  });
});
