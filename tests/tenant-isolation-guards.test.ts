// 租户作用域的静态守卫（P0 起步，P2 扩成完整防线）。
//
// 这个文件是什么、为什么长这样
// ---------------------------
// 2026-09-30 多租户审计的结论是：这个项目的隔离**全靠每处查询手写 organisationId**，
// 而代码里没有任何机制保证"下次也会写"。842 处 Prisma 调用里已经有 47 个模型根本没有
// organisationId 列、231 处按裸 id 取值、78 处 `organisation.findFirst()`（= "库里第一家公司"）。
//
// 已有一个先例：`tests/automation-multi-org.test.ts` 用"grep 源码禁止某个模式"锁住了
// scan.ts / reminders.ts 里的 findFirst。这个文件把那套做法**推广到全项目**，
// 并且用一个**棘轮（ratchet）**处理存量：总数只许降不许升。
//   · 每修一处，就把 BUDGET 调小 —— 修过的地方不会再反弹；
//   · 新写的代码如果又用 findFirst，总数上升，测试立刻红。
// 这样不必等 P2 的强制层上线，止血期就能防回归。
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";

const root = process.cwd();
const read = (p: string) => readFileSync(path.join(root, p), "utf8");

/**
 * 去掉注释再断言 —— 注释里会引用旧写法，不剥就会误报（本项目已踩过两次）。
 *
 * ⚠️ **必须先剥行注释、再剥块注释**，顺序反了会吃掉代码：
 * `src/app/invoice/[id]/page.tsx` 的说明注释里写了路径 `/invoice/*`，那个星号斜杠会被
 * 当成块注释的开头，一路吞到下一个块注释结束符（也就是 JSX 里的 Header 注释）——
 * 中间那段 findFirst 查询整段消失，断言就误报"没有按租户收窄"。
 * 2026-09-30 这条测试第一次跑是红的，原因在这里，不在被断言的代码里。
 * 前置的 `[^:]` 是为了不误伤 `https://` 这类字符串。
 */
const stripComments = (src: string) =>
  src.replace(/(^|[^:])\/\/[^\n]*/g, "$1").replace(/\/\*[\s\S]*?\*\//g, "");

/**
 * `organisation.findFirst()` 的存量上限。
 * **只许调小。** 每修掉一处就把这个数字减掉相应数量（并与实际值一起提交）。
 * P2 的目标是把它降到 0 并用 lint 规则替代。
 */
const FIND_FIRST_BUDGET = 78;

function sourceFiles(): string[] {
  return execFileSync("bash", ["-lc", "grep -rl 'organisation' src --include=*.ts --include=*.tsx"], {
    encoding: "utf8",
    cwd: root,
  })
    .trim()
    .split("\n")
    .filter(Boolean);
}

describe("棘轮：organisation.findFirst() 只许降不许升", () => {
  it("总量不超过预算（新写的代码不许再引入 '库里第一家公司'）", () => {
    const hits: { file: string; count: number }[] = [];
    let total = 0;
    for (const f of sourceFiles()) {
      const n = (stripComments(read(f)).match(/organisation\.findFirst\(/g) ?? []).length;
      if (n > 0) {
        total += n;
        hits.push({ file: f, count: n });
      }
    }
    const worst = hits.sort((a, b) => b.count - a.count).slice(0, 10).map((h) => `  ${h.count}  ${h.file}`).join("\n");
    expect(total, "当前 " + total + " 处，预算 " + FIND_FIRST_BUDGET + "。修好了请把预算调小；新引入的请改成 session.orgId。\n" + worst)
      .toBeLessThanOrEqual(FIND_FIRST_BUDGET);
  });
});

describe("P0 已修的点不得回退", () => {
  it("/api/export 用会话里的租户，不再 findFirst（否则谁导出都是第一家店的客户+成本价）", () => {
    const src = stripComments(read("src/app/api/export/route.ts"));
    expect(src, "导出必须用会话租户").toContain("auth.session.orgId");
    expect(src, "不许退回 findFirst").not.toMatch(/organisation\.findFirst\(/);
  });

  it("/api/attendance/export 用会话里的租户（这张表是全员行踪明细）", () => {
    const src = stripComments(read("src/app/api/attendance/export/route.ts"));
    expect(src).toContain("session.orgId");
    expect(src).not.toMatch(/organisation\.findFirst\(/);
  });

  it("发票打印页：发票必须按租户收窄，抬头取本租户", () => {
    const src = stripComments(read("src/app/invoice/[id]/page.tsx"));
    // 关键：不能是按裸 id 的 findUnique —— 那正是跨租户读发票的入口
    expect(src, "发票查询必须带 branch.organisationId").toMatch(/invoice\.findFirst\(\{[\s\S]*?branch:\s*\{\s*organisationId/);
    expect(src, "抬头只许取本租户").toContain("db.organisation.findUnique({ where: { id: session.orgId } })");
    expect(src).not.toMatch(/organisation\.findFirst\(/);
  });

  it("报价打印页：工单归属不是本租户就 404，抬头取本租户", () => {
    const src = stripComments(read("src/app/quotation/[id]/page.tsx"));
    expect(src, "必须有归属判定").toMatch(/detail\.branch\?\.organisationId !== session\.orgId/);
    expect(src, "抬头只许取本租户").toContain("db.organisation.findUnique({ where: { id: session.orgId } })");
    expect(src).not.toMatch(/organisation\.findFirst\(/);
  });

  it("resetRiderPassword：按 id 取客户时必须同时比对 organisationId", () => {
    // 这是跨租户账号接管：这个函数会用 service role 直接改那个账号的密码。
    const src = stripComments(read("src/actions/workshop.ts"));
    const fn = src.slice(src.indexOf("export async function resetRiderPassword"));
    const body = fn.slice(0, fn.indexOf("\nexport async function", 10) === -1 ? fn.length : fn.indexOf("\nexport async function", 10));
    expect(body, "取客户必须带 organisationId").toMatch(/customer\.findFirst\(\{[\s\S]*?organisationId:\s*session\.orgId/);
    expect(body, "不许退回按裸 id 的 findUnique").not.toMatch(/customer\.findUnique\(/);
  });

  it("middleware matcher 覆盖打印页与扫码页", () => {
    const src = read("src/middleware.ts");
    const matcher = src.slice(src.indexOf("matcher:"));
    for (const p of ["/invoice/:path*", "/quotation/:path*", "/qr/:path*"]) {
      expect(matcher, "matcher 缺少 " + p).toContain(p);
    }
  });

  it("清空业务数据不得退回无参 deleteMany（不可逆）", () => {
    const src = stripComments(read("src/actions/developer.ts"));
    expect(src).not.toMatch(/deleteMany\(\{\s*\}\s*\)/);
    expect(src).toMatch(/deleteMany\(\{\s*where:/);
  });
});

describe("P1a：新加租户列的四个模型，写入时必须带上 organisationId", () => {
  // 为什么这条守卫比它看起来重要：
  // 复合唯一键 `@@unique([organisationId, plate])` 在 SQLite 与 PostgreSQL 上**都不约束
  // organisationId 为 NULL 的行**（NULL 互不相等）。所以只要有一条写入路径没填这一列，
  // 那一行就完全逃出唯一性约束 —— 约束"加上了"，对它却不生效，而且不报任何错。
  // 这种失效没有任何运行时症状（同店两张同号发票照样能存进去），只能靠静态守卫钉住。
  // organisation.create 也在这里看着：slug 是平台台/备份命名/日志的键，
  // 新组织漏了它，运维侧就认不出这家店（P4 开通流程强依赖）。
  const TENANT_MODELS = ["motorcycle", "serviceJob", "invoice", "checklistTemplate", "organisation"];

  it("src/ 下每个 create 调用附近都出现 organisationId", () => {
    const files = execFileSync("bash", ["-lc", "grep -rl '\\.create(' src --include=*.ts --include=*.tsx"], {
      encoding: "utf8",
      cwd: root,
    })
      .trim()
      .split("\n")
      .filter(Boolean);

    const offenders: string[] = [];
    for (const f of files) {
      const lines = stripComments(read(f)).split("\n");
      lines.forEach((line, i) => {
        for (const model of TENANT_MODELS) {
          if (!new RegExp("\\b" + model + "\\.create\\(").test(line)) continue;
          // 允许跨行：往后看 12 行
          const window = lines.slice(i, i + 13).join("\n");
          // organisation 建的是租户本身，要的是 slug；其余四个要的是 organisationId
          const needed = model === "organisation" ? "slug" : "organisationId";
          if (!window.includes(needed)) {
            offenders.push(f + ":" + (i + 1) + " → " + model + ".create 未写 " + needed);
          }
        }
      });
    }
    expect(offenders, "这些写入点会让新行逃出租户内唯一约束：\n" + offenders.join("\n")).toEqual([]);
  });
});
