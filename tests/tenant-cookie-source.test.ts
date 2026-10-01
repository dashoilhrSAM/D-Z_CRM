// P3b 第 5 步：门店上下文的"来源唯一性"守卫。
//
// 为什么值得钉住：租户 cookie 是**安全边界**（它决定这次请求能看哪家店的数据），
// 而这类东西最危险的退化方式不是"写错"，是**又多了一个写入口**：
// 旧代码就有两个 —— `active-tenant.ts` 的签名 cookie（今天在用）
// 和 `rider-context.ts` 的 `dz_org`/`dz_branch`（既不签名、也没人读、还接受表单里的任意 id）。
// 第二个的存在让第一个看起来"已经有隔离了"，实际什么都没拦。
//
// 所以两条断言：
//   ① cookie 名字只有一处定义（别处出现 `"dz_tenant"` / `"dz_org"` / `"dz_branch"` 就红）；
//   ② 写门店 cookie 的调用点只有白名单里的那几个，且**都必须经过 `setActiveTenant`**
//      （它自己是"只签值、不判权限"，所以调用方必须从 AuthLink 候选里选）。
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
/** 只看代码不看注释：注释里出现旧 cookie 名（解释为什么删掉它）是**应该**的。 */
const stripComments = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(path.join(root, dir))) {
    const rel = path.join(dir, entry);
    if (statSync(path.join(root, rel)).isDirectory()) walk(rel, out);
    else if (/\.tsx?$/.test(entry)) out.push(rel);
  }
  return out;
}

const sources = walk("src").map((file) => ({ file, src: stripComments(readFileSync(path.join(root, file), "utf8")) }));

describe("① 租户 cookie 的名字只有一处定义", () => {
  it("`dz_tenant` 只在 active-tenant.ts 里出现（正向对照：那里确实有）", () => {
    const owners = sources.filter((s) => s.src.includes('"dz_tenant"')).map((s) => s.file);
    expect(owners).toEqual(["src/lib/tenant/active-tenant.ts"]);
  });

  it("**`dz_org` / `dz_branch` 已经彻底消失**（写了没人读、还接受客户端值的旧 cookie）", () => {
    const offenders = sources
      .filter((s) => s.src.includes("dz_org") || s.src.includes("dz_branch"))
      .map((s) => s.file);
    expect(offenders, "这些文件又在写/读那个不签名也没人读的门店 cookie").toEqual([]);
  });
});

describe("② 写门店 cookie 只有白名单里的入口，且都经过 setActiveTenant", () => {
  /** 定义处 + 两个合法入口：门店链接路由、选择器/QR 共用的 action。 */
  const ALLOWED = ["src/lib/tenant/active-tenant.ts", "src/app/t/[slug]/route.ts", "src/actions/tenant-context.ts"];

  it("setActiveTenant 的调用点只在白名单里", () => {
    const callers = sources.filter((s) => s.src.includes("setActiveTenant(")).map((s) => s.file);
    expect(callers.length, "一处都没找到 —— 正则失效或签名改名了，守卫形同虚设").toBeGreaterThanOrEqual(2);
    const offenders = callers.filter((f) => !ALLOWED.includes(f));
    expect(offenders, "新出现的写入口必须先进白名单并说明'它凭什么判断这个人能进这家店'").toEqual([]);
  });

  it("两个入口都从 AuthLink 候选里选（不变式的代码指纹）", () => {
    for (const file of ["src/app/t/[slug]/route.ts", "src/actions/tenant-context.ts"]) {
      const src = sources.find((s) => s.file === file)!.src;
      expect(src, file + " 没有校验'他确实有这家店的身份'").toMatch(/identitiesForAuthUser|planShopEntry/);
    }
  });
});
