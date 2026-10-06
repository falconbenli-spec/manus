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
    expect(loginPage).toContain("هل لديك رقم موظف؟");
    expect(loginPage).toContain('setLocation("/employee-portal/login")');
    expect(loginPage).not.toContain("example@360.sa أو 2353");
  });
});
