/**
 * 旧 CSV 导入**已退役**（2026-09-24，老板批准）。
 *
 * 退役的理由不是旧入口不安全（它有 requireStaff），而是**规则两份实现**：
 * 客户 / 零件 / 车辆三个 CSV 入口各有自己的判重与归一化逻辑，
 * 与批量配置工作簿不是同一套 —— 同一份数据走两条路会得到不同结果，这个项目为此吃过亏。
 *
 * 这个测试文件的作用是**防止无意复活**：加了新入口、留了旧链接、把 API 加回来，都会在这里变红。
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const LEGACY_ROUTE = "/workshop/import";

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(name)) out.push(full);
  }
  return out;
}

describe("旧 CSV 导入退役", () => {
  it("三个旧 API 路由必须不存在（不许加回来）", () => {
    for (const kind of ["customers", "products", "motorcycles"]) {
      const p = join(ROOT, "src/app/api/import", kind, "route.ts");
      expect(existsSync(p), p + " 又出现了 —— 旧导入不该复活").toBe(false);
    }
  });

  it("旧页面必须**重定向**到批量配置（老板可能还存着旧链接）", () => {
    const p = join(ROOT, "src/app/workshop/import/page.tsx");
    expect(existsSync(p), "旧页面应当保留为一个重定向").toBe(true);
    const src = readFileSync(p, "utf8");
    expect(src).toContain('redirect("/workshop/setup")');
  });

  it("导航里不许再有指向旧路由的入口", async () => {
    const { NAV_SECTIONS } = await import("@/lib/nav-registry");
    const hrefs = NAV_SECTIONS.flatMap((s) => s.items).map((i) => i.href);
    expect(hrefs.filter((h) => h === LEGACY_ROUTE)).toEqual([]);
  });

  it("**反向**：导航里必须有新的批量配置入口（退役不能把入口也撤没了）", async () => {
    const { NAV_SECTIONS } = await import("@/lib/nav-registry");
    const hrefs = NAV_SECTIONS.flatMap((s) => s.items).map((i) => i.href);
    expect(hrefs).toContain("/workshop/setup");
  });

  it("全仓库（除重定向页自己）不许再链到旧路由", () => {
    const offenders: string[] = [];
    for (const dir of ["src", "scripts", "e2e"]) {
      const full = join(ROOT, dir);
      if (!existsSync(full)) continue;
      for (const file of walk(full)) {
        if (file.endsWith("app/workshop/import/page.tsx")) continue;
        if (readFileSync(file, "utf8").includes(LEGACY_ROUTE)) {
          offenders.push(file.replace(ROOT + "/", ""));
        }
      }
    }
    expect(offenders, "这些文件还在链旧入口：" + offenders.join(", ")).toEqual([]);
  });
});
