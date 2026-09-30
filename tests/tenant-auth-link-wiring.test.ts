// P3b 第 3 步的前置守卫：**凡写 authId，必须同时写 AuthLink**。
//
// 背景（2026-09-30 发现）：`AuthLink` 是「这个 auth 账号属于哪几家店」的唯一事实来源，
// P3b 第 3 步的解析链（`identitiesForAuthUser` / `identityInTenant`）读的就是它。
// 但全仓**只有** `scripts/backfill-tenant-columns.ts` 在写它 —— 业务代码一处都没写。
// 今天漂移是 0（P3a 回填过），所以看不出任何问题；可从现在起每新建一个员工或骑手
// 都会漏一条，而第 3 步上线后**新账号**会直接登不进去 —— 老账号因为回填过反而正常，
// 这种"新数据坏、老数据好"的形状最容易被误判成偶发故障。
//
// 两道守卫：
//   ① 行为：两个接线函数写出来的记录，正好能被第 3 步的解析链读出来（含"一人两店"）；
//   ② 结构：**生成式**扫描 src/ —— 任何一个"在写 authId"的调用点，同文件必须有对应接线。
//      不写死文件名单：新加一条绑定路径却忘了接线时，它会红。带正向对照（扫不到站点也红），
//      否则正则失效会伪装成"全部通过"（本项目反复踩过的假绿）。
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { db } from "@/lib/db";
import { linkStaffIdentity, linkCustomerIdentity, identitiesForAuthUser, identityInTenant, needsTenantChoice } from "@/lib/tenant/identity";

const ORG_A = "test_wire_org_a";
const ORG_B = "test_wire_org_b";
const STAFF_AUTH = "test-wire-staff-auth";
const RIDER_AUTH = "test-wire-rider-auth";

let staffId = "";
let custA = "";

async function cleanup() {
  await db.authLink.deleteMany({ where: { organisationId: { in: [ORG_A, ORG_B] } } });
  await db.customer.deleteMany({ where: { organisationId: { in: [ORG_A, ORG_B] } } });
  await db.user.deleteMany({ where: { organisationId: { in: [ORG_A, ORG_B] } } });
  await db.organisation.deleteMany({ where: { id: { in: [ORG_A, ORG_B] } } });
}

beforeAll(async () => {
  await cleanup();
  const tag = Date.now().toString(36);
  await db.organisation.create({ data: { id: ORG_A, name: "Wire A", slug: "wire-a-" + tag } });
  await db.organisation.create({ data: { id: ORG_B, name: "Wire B", slug: "wire-b-" + tag } });
  staffId = (await db.user.create({ data: { organisationId: ORG_A, name: "Wire Staff", email: "wire." + tag + "@example.com", role: "MECHANIC", authId: STAFF_AUTH } })).id;
  custA = (await db.customer.create({ data: { organisationId: ORG_B, name: "Wire Rider", authId: RIDER_AUTH } })).id;
});

afterAll(cleanup);

describe("① 行为：接线写出来的记录，正好是解析链要读的", () => {
  it("员工接线 → identityInTenant 解析到本店、kind=STAFF、带 userId", async () => {
    await linkStaffIdentity({ authId: STAFF_AUTH, organisationId: ORG_A, userId: staffId });
    const id = await identityInTenant(STAFF_AUTH, ORG_A);
    expect(id).toMatchObject({ authId: STAFF_AUTH, organisationId: ORG_A, kind: "STAFF", userId: staffId, customerId: null });
  });

  it("骑手接线 → kind=CUSTOMER、带 customerId", async () => {
    await linkCustomerIdentity({ authId: RIDER_AUTH, organisationId: ORG_B, customerId: custA });
    const id = await identityInTenant(RIDER_AUTH, ORG_B);
    expect(id).toMatchObject({ organisationId: ORG_B, kind: "CUSTOMER", customerId: custA, userId: null });
  });

  it("幂等：重复接线只留一条（登录/认领会被调用很多次）", async () => {
    await linkCustomerIdentity({ authId: RIDER_AUTH, organisationId: ORG_B, customerId: custA });
    await linkCustomerIdentity({ authId: RIDER_AUTH, organisationId: ORG_B, customerId: custA });
    expect(await db.authLink.count({ where: { authId: RIDER_AUTH, organisationId: ORG_B } })).toBe(1);
  });

  it("**同一个人两家店**：一个 authId 两条映射，且 needsTenantChoice 为真（第 3 步的验收点）", async () => {
    // 同一个人既是 A 店员工、又是 B 店骑手 —— 这正是 P3b 要表达的形状
    await linkStaffIdentity({ authId: STAFF_AUTH, organisationId: ORG_B, userId: staffId });
    expect((await identityInTenant(STAFF_AUTH, ORG_A))?.organisationId).toBe(ORG_A);
    expect((await identityInTenant(STAFF_AUTH, ORG_B))?.organisationId).toBe(ORG_B);
    expect(await needsTenantChoice(STAFF_AUTH)).toBe(true);
    expect((await identitiesForAuthUser(STAFF_AUTH)).length).toBe(2);
  });

  it("负面对照：没接线就查不到（这条证明上面的断言不是因为「随便写点什么都能解析」）", async () => {
    expect(await identityInTenant("test-wire-never-linked", ORG_A)).toBeNull();
    expect(await needsTenantChoice("test-wire-never-linked")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// ② 结构：生成式扫描 src/ —— 写 authId 的调用点必须配接线
// ---------------------------------------------------------------------------

const root = process.cwd();
/** 只看代码不看注释：注释里写着旧写法会让守卫误报（本项目踩过）。 */
const stripComments = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(path.join(root, dir))) {
    const rel = path.join(dir, entry);
    if (statSync(path.join(root, rel)).isDirectory()) walk(rel, out);
    else if (/\.tsx?$/.test(entry)) out.push(rel);
  }
  return out;
}

/** 取出这个调用括号里的实参文本（配对括号，够用且不引入 parser 依赖）。 */
function callArgs(src: string, openParen: number): string {
  let depth = 0;
  for (let i = openParen; i < src.length; i++) {
    const ch = src[i];
    if (ch === "(") depth++;
    else if (ch === ")") {
      depth--;
      if (depth === 0) return src.slice(openParen + 1, i);
    }
  }
  return src.slice(openParen + 1);
}

/** 在这些调用里，实参包含 authId 的才算"绑定站点"。 */
const WRITE_CALLS = [
  { re: /db\.user\.create\(/g, wrapper: "linkStaffIdentity(", what: "建员工" },
  { re: /db\.user\.upsert\(/g, wrapper: "linkStaffIdentity(", what: "建/更新员工" },
  { re: /db\.user\.update\(/g, wrapper: "linkStaffIdentity(", what: "更新员工" },
  { re: /db\.customer\.create\(/g, wrapper: "linkCustomerIdentity(", what: "建客户档案" },
  { re: /db\.customer\.upsert\(/g, wrapper: "linkCustomerIdentity(", what: "建/更新客户档案" },
  { re: /db\.customer\.update\(/g, wrapper: "linkCustomerIdentity(", what: "更新客户档案" },
] as const;

interface Site { file: string; what: string; wrapper: string; fn: string; snippet: string }

/** 把文件切成「顶层函数块」——函数级比文件级准得多：新加一个函数来绑 authId 却忘了接线会红。 */
function chunksOf(src: string): { name: string; start: number; end: number }[] {
  const lines = src.split("\n");
  const heads: { name: string; line: number }[] = [];
  const HEAD = /^(?:export\s+)?(?:async\s+)?function\s+(\w+)|^export\s+const\s+(\w+)\s*=\s*async|^const\s+(\w+)\s*=\s*async/;
  let offset = 0;
  for (const line of lines) {
    const m = HEAD.exec(line);
    if (m) heads.push({ name: m[1] ?? m[2] ?? m[3], line: offset });
    offset += line.length + 1;
  }
  return heads.map((h, i) => ({ name: h.name, start: h.line, end: i + 1 < heads.length ? heads[i + 1].line : src.length }));
}

function findBindingSites(): Site[] {
  const sites: Site[] = [];
  for (const file of walk("src")) {
    const src = stripComments(readFileSync(path.join(root, file), "utf8"));
    const chunks = chunksOf(src);
    for (const { re, wrapper, what } of WRITE_CALLS) {
      re.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = re.exec(src)) !== null) {
        const args = callArgs(src, m.index + m[0].length - 1);
        // `authId:`（显式赋值）/ `authId,`（简写）/ `authId }`（简写结尾）
        if (/authId\s*[:,}]/.test(args)) {
          const fn = chunks.find((c) => m!.index >= c.start && m!.index < c.end)?.name ?? "(顶层)";
          sites.push({ file, what, wrapper, fn, snippet: args.replace(/\s+/g, " ").slice(0, 80) });
        }
      }
    }
  }
  return sites;
}

describe("② 结构：写 authId 的调用点必须同时写 AuthLink", () => {
  const sites = findBindingSites();

  it("正向对照：扫描确实找到了绑定站点（否则下面的断言只是空跑 = 假绿）", () => {
    expect(sites.length, "一个绑定站点都没扫到 —— 正则或调用写法变了，守卫已经失效").toBeGreaterThanOrEqual(3);
  });

  it("每个站点**所在的函数**里都必须出现对应的接线调用", () => {
    const missing = sites.filter((s) => {
      const src = stripComments(readFileSync(path.join(root, s.file), "utf8"));
      const chunk = chunksOf(src).find((c) => c.name === s.fn);
      // (顶层) 的情况退化成整文件检查 —— 至少不要静默放过
      const scope = chunk ? src.slice(chunk.start, chunk.end) : src;
      return !scope.includes(s.wrapper);
    });
    expect(
      missing.map((s) => s.file + " → " + s.fn + "()：" + s.what + " 写了 authId，但该函数里没有 " + s.wrapper + "（片段：" + s.snippet + "）"),
      "这些地方绑了 authId 却没写 AuthLink 映射：第 3 步上线后**新**账号会登不进去（老账号因回填过而正常，最难查）",
    ).toEqual([]);
  });
});

describe("③ e2e 脚本：给 e2e.db 造的账号也必须补映射", () => {
  // e2e/global-setup.ts 每次都 wipe + migrate + seed，AuthLink 因此是空的，
  // 而 e2e/link-auth.ts 会给 User/Customer 绑真实 Supabase 的 authId ——
  // 不补映射，等第 3 步解析链上线，e2e 会整片登录失败（看起来像"应用坏了"）。
  const src = stripComments(readFileSync(path.join(root, "e2e/link-auth.ts"), "utf8"));

  it("确实在绑 authId（正向对照）", () => {
    expect(src).toContain("data: { authId }");
  });

  it("同时写 AuthLink，且 STAFF / CUSTOMER 两种 kind 都有", () => {
    expect(src).toContain("authLink.upsert(");
    expect(src).toContain('kind: "STAFF"');
    expect(src).toContain('kind: "CUSTOMER"');
  });
});
