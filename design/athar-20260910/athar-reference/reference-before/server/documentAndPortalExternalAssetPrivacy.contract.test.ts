import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.resolve(import.meta.dirname, "..");
const salaryDocuments = fs.readFileSync(path.join(root, "client/src/lib/salaryDocuments.ts"), "utf8");
const server = fs.readFileSync(path.join(root, "server/index.ts"), "utf8");
const portalTemplate = fs.readFileSync(path.join(root, "server/portal-app.html"), "utf8");

describe("document and portal external-asset privacy contract", () => {
  it("keeps employee payslip rendering independent from Google Fonts", () => {
    expect(salaryDocuments).toContain("font-family:Tahoma,Arial,system-ui,sans-serif");
    expect(salaryDocuments).not.toContain("fonts.googleapis.com");
    expect(salaryDocuments).not.toContain("fonts.gstatic.com");
  });

  it("keeps the standalone employee portal CSP limited to same-origin assets and connections", () => {
    const portalCsp = server.slice(server.indexOf('app.get("/api/employee/app"'), server.indexOf('app.post("/api/employee/portal-login"'));
    expect(portalCsp).toContain("font-src 'self' data:");
    expect(portalCsp).toContain("img-src 'self' data: blob:");
    expect(portalCsp).toContain("connect-src 'self'");
    expect(portalCsp).not.toMatch(/fonts\.googleapis\.com|fonts\.gstatic\.com|maps\.googleapis\.com|img-src 'self' data: https:/);
  });

  it("does not load Google Fonts from the standalone employee portal template", () => {
    expect(portalTemplate).not.toMatch(/fonts\.googleapis\.com|fonts\.gstatic\.com/);
    expect(portalTemplate).toContain("font-family:Tahoma,Arial,system-ui,sans-serif");
  });
});
