import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const loginPage = fs.readFileSync(
  path.resolve(import.meta.dirname, "../client/src/pages/Login.tsx"),
  "utf8",
);

describe("separated login UI contract", () => {
  it("keeps the administration form limited to email authentication", () => {
    expect(loginPage).toContain("البريد الإلكتروني");
    expect(loginPage).toContain('type="email"');
    expect(loginPage).toContain('autoComplete="email"');
  });

  it("sends an employee identifier to the independent employee portal instead", () => {
    const shell = fs.readFileSync(path.resolve(import.meta.dirname, "../client/src/components/brand/AuthShell.tsx"), "utf8");
    expect(loginPage).toContain('<AuthShell mode="admin"');
    expect(shell).toContain('href="/employee-portal/login"');
    expect(shell).toContain('بوابة الموظف');
    expect(loginPage).not.toContain("example@360.sa أو 2353");
  });
});
