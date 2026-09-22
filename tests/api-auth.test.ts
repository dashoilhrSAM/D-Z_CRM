// API 层的门禁：默认拒绝、白名单显式、cron 不可 fail-open、webhook 验签不可绕过。
//
// 这个测试存在的理由（2026-09-14 审计实测）：src/middleware.ts 的 matcher 之前**不含 /api**，
// 于是 `curl /api/export?type=customers` 不带任何 Cookie 就能下载全组织客户 CSV
// （姓名/电话/邮箱），商品导出还带成本价；/api/upload 与 /api/import/* 可无鉴权写入。
//
// 断言都是"结构性"的：它们不测行为，而是确保**这个洞不会以同样的方式回来**——
// 新增一个 API 路由却忘了加门禁时，这条测试会红。
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (p: string) => readFileSync(path.join(root, p), "utf8");
/** 断言只看代码，不看注释——否则"注释里描述旧写法"会让守卫误报或漏报。 */
const stripComments = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

/** 不需要登录会话的 API —— 必须与 src/middleware.ts 的 API_PUBLIC 保持一致。 */
const PUBLIC_API_PREFIXES = ["api/webhooks", "api/storage", "api/cron", "api/hooks"];

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(path.join(root, dir))) {
    const rel = path.join(dir, entry);
    if (statSync(path.join(root, rel)).isDirectory()) walk(rel, out);
    else if (entry === "route.ts") out.push(rel);
  }
  return out;
}

describe("middleware 覆盖 API", () => {
  it("matcher 含 /api/:path* —— 少了它所有 API 都绕过门禁", () => {
    const src = read("src/middleware.ts");
    const matcher = src.slice(src.indexOf("matcher:"));
    expect(matcher, "matcher 必须包含 /api/:path*").toContain("/api/:path*");
  });

  it("API 的默认是拒绝：无用户即 401，且公开名单是显式的", () => {
    const src = read("src/middleware.ts");
    expect(src, "必须有显式的公开名单").toContain("API_PUBLIC");
    // 无 user 时必须返回 401，而不是放行（旧的 NextResponse.next() 行为）
    expect(src).toMatch(/if \(!user\)\s*\{[\s\S]*?status: 401/);
    expect(src, "骑手不算员工").toContain("CUSTOMER");
  });
});

describe("每个非公开 API 路由都有自己的门禁", () => {
  const files = walk("src/app/api");

  it("扫描到的路由数量合理（防止这个测试变成空跑）", () => {
    expect(files.length).toBeGreaterThanOrEqual(15);
  });

  it("除公开名单外，每个 route.ts 都调用 requireStaff()", () => {
    const missing = files.filter((f) => {
      const rel = f.replace(/^src[\\/]app[\\/]/, "").split(path.sep).join("/");
      if (PUBLIC_API_PREFIXES.some((p) => rel.startsWith(p))) return false;
      return !read(f).includes("requireStaff()");
    });
    expect(missing, "这些路由没有门禁：" + missing.join(", ")).toEqual([]);
  });

  it("公开名单里的路由靠别的机制鉴权，不能是裸的", () => {
    const cron = read("src/app/api/cron/reminders/route.ts");
    expect(cron, "cron 必须用 fail-closed 的密钥校验").toContain("requireCronSecret");
    const hook = read("src/app/api/webhooks/whatsapp/route.ts");
    expect(hook).toContain("timingSafeEqual");
  });

  it("Supabase SMS hook 用 Standard Webhooks 签名验签，且缺密钥即 503", () => {
    // 这个端点收到的是**明文验证码**，而在 middleware 里是公开路径：它唯一的防线就是验签。
    //
    // 2026-09-22 依 GoTrue 源码更正：Supabase 的 HTTP hook **不发 Authorization 头**，
    // 只发 webhook-id / webhook-timestamp / webhook-signature。第一版按 Bearer secret 写的实现
    // 会让每一次真实回调 401，而本地测试全绿——因为测试是自己构造请求头的。
    // 这条断言锁住"必须用签名方案"，防止有人再改回 Bearer。
    const smsHook = read("src/app/api/hooks/send-sms/route.ts");
    const verifier = stripComments(read("src/lib/standard-webhooks.ts"));
    expect(smsHook, "hook 必须走签名校验").toContain("requireSmsHookSignature");
    expect(smsHook, "不许退回 Bearer（GoTrue 不发这个头）").not.toContain("authorization");
    // 签名是对 body 字节做的：必须先 text() 拿到原始报文再验签，先 json() 就再也对不上。
    expect(smsHook, "必须先取原始报文再验签").toMatch(/await req\.text\(\)[\s\S]*?requireSmsHookSignature/);
    expect(verifier, "要用恒定时间比较").toContain("timingSafeEqual");
    expect(verifier, "要有时间戳容差，否则合法请求可被无限重放").toContain("stale_timestamp");
    expect(stripComments(read("src/lib/api-auth.ts")), "缺密钥/格式不对必须 503 而不是放行")
      .toMatch(/SMS_HOOK_SECRET is missing or not in[\s\S]*?status: 503/);
    expect(smsHook, "供应商失败必须返回非 2xx，不许假装已发送").toMatch(/result\.ok[\s\S]*?status: 503/);
  });

  it("验证码不许进日志（它等同于账号本身）", () => {
    const src = stripComments(read("src/app/api/hooks/send-sms/route.ts"));
    expect(src).not.toMatch(/console\.(log|error|warn)\([^;]*\botp\b/);
    // 反面：日志必须存在，否则"客户说没收到"时没有任何现场可查——
    // 一个把所有日志删掉的实现也能通过上面那条，这不是我们要的。
    expect(src).toMatch(/console\.(log|error)\(/);
  });
});

describe("cron 端点 fail-closed", () => {
  for (const f of ["src/app/api/cron/reminders/route.ts", "src/app/api/cron/marketing-calendar/route.ts"]) {
    it(f + " 不会在密钥缺失时放行", () => {
      // 断言必须只看**代码**：注释里会引用旧写法（"旧的 if (secret) 写法……"），
      // 不剥注释的话这条会匹配到自己的说明文字——第一版就是这么误报的。
      const src = stripComments(read(f));
      expect(src, "不许再用 if (secret) 的 fail-open 写法").not.toMatch(/if \(secret\)/);
      expect(src).toContain("requireCronSecret(req)");
    });
  }
});

describe("WhatsApp webhook 验签", () => {
  const src = () => read("src/app/api/webhooks/whatsapp/route.ts");

  it("签名不可通过『不发这个头』绕过", () => {
    // 旧写法 \`if (SECRET && signature)\`：攻击者只要省略 x-hub-signature-256 就跳过整段验签，
    // 于是任何人能 POST 伪造 statuses 把任意 externalId 改成 DELIVERED/FAILED。
    expect(src(), "签名校验不能与 signature 的存在性做与运算").not.toMatch(/APP_SECRET && signature/);
    expect(src()).toContain("missing signature");
  });

  it("用恒定时间比较，且未配置时返回 503 而不是静默 200", () => {
    expect(src()).toContain("timingSafeEqual");
    expect(src()).toMatch(/not configured[\s\S]*?status: 503/);
  });

  it("回执不会把状态往回写（Meta 会重试且不保证顺序）", () => {
    expect(src()).toContain("downgradeGuard");
  });
});
