import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(resolve(process.cwd(), "client/src/index.css"), "utf8");
const app = readFileSync(resolve(process.cwd(), "client/src/App.tsx"), "utf8");
const layout = readFileSync(resolve(process.cwd(), "client/src/components/layout/MainLayout.tsx"), "utf8");
const pageTemplate = readFileSync(resolve(process.cwd(), "client/src/components/layout/PageTemplate.tsx"), "utf8");
const states = readFileSync(resolve(process.cwd(), "client/src/components/feedback/AsyncState.tsx"), "utf8");
const bee = readFileSync(resolve(process.cwd(), "client/public/bee-scene.js"), "utf8");
const beeReact = readFileSync(resolve(process.cwd(), "client/src/components/BeeScene.tsx"), "utf8");
const portal = readFileSync(resolve(process.cwd(), "server/portal-app.html"), "utf8");
const fontFiles = [
  "client/public/brand/fonts/Alexandria-Regular.ttf",
  "client/public/brand/fonts/Alexandria-Light.ttf",
  "client/public/brand/fonts/Alexandria-Bold.ttf",
];

describe("3,6T redesign UI contract", () => {
  it("keeps the bilingual-safe RTL design tokens and reduced-motion policy", () => {
    expect(css).toContain("--primary: 168 71% 36%");
    expect(css).toContain("--background: 168 9% 9%");
    expect(css).toContain("direction: rtl");
    expect(css).toContain("prefers-reduced-motion: reduce");
  });

  it("provides shared async states and keyboard focus affordances", () => {
    expect(states).toContain("export function LoadingState");
    expect(states).toContain("export function EmptyState");
    expect(states).toContain("export function ErrorState");
    expect(states).toContain("export function SuccessState");
    expect(css).toContain(".async-state");
    expect(css).toContain(".sr-only-focusable:focus");
  });

  it("keeps global navigation searchable and exposes the main content landmark", () => {
    expect(layout).toContain('aria-label="البحث في المنصة"');
    expect(layout).toContain('id="main-content"');
    expect(layout).toContain('aria-label="أقسام المنصة"');
  });

  it("uses one shared BeeScene engine in React and the actual employee portal", () => {
    expect(bee).toContain("People36tBeeScene");
    expect(bee).toContain("prefers-reduced-motion");
    expect(bee).toContain("IntersectionObserver");
    expect(bee).toContain("pointerdown");
    expect(beeReact).toContain("/bee-scene.js");
    expect(portal).toContain('src="/bee-scene.js"');
    expect(portal).toContain('id="portal-bee-canvas"');
    expect(portal).toContain("People36tBeeScene.mount");
    expect(portal).toContain("url('/brand/fonts/Alexandria-Regular.ttf')");
    for (const file of fontFiles) expect(readFileSync(resolve(process.cwd(), file)).byteLength).toBeGreaterThan(100_000);
    expect(portal).toContain('for="emp-id"');
    expect(portal).toContain('for="emp-pass"');
  });

  it("applies shared page semantics and a truthful route loading state", () => {
    expect(pageTemplate).toContain('data-page-template');
    expect(pageTemplate).toContain('role="toolbar"');
    expect(app).toContain("<LoadingState title=\"جارٍ تحميل الوحدة\"");
  });
});
