// 骑手改号 / 柜台重置密码的**源码级护栏**。
//
// 为什么用读源码而不是跑行为：这两处的风险来自"某个动作**没有做**某件事"——
//   · 个人资料不再直接写 phone（否则"给新号码发验证码"那套流程能被一行输入绕过）；
//   · 发码/验码必须用**非持久化** client（用 cookie client 会把骑手的登录态换成临时手机账号）；
//   · 柜台重置必须先确认目标不是**员工账号**（否则这条"骑手重置"的路就是拿员工账号的后门）。
// 这类"缺失"很难用集成测试覆盖（要真跑 Supabase + 浏览器），但它们**能被文本断言钉住**：
// 一旦有人把这几行删掉，测试立刻变红。
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

/** 取某个导出函数的函数体（到下一个 export 为止），用于"这个函数里必须/不得出现 X"的断言。 */
function bodyOf(source: string, fnName: string): string {
  const start = source.indexOf("export async function " + fnName);
  if (start < 0) throw new Error("找不到函数：" + fnName);
  const rest = source.slice(start + 10);
  const next = rest.indexOf("export async function ");
  return next < 0 ? rest : rest.slice(0, next);
}

describe("骑手改号", () => {
  it("个人资料更新**不再**直接写手机号（旧写法让改号验证形同虚设）", () => {
    const src = read("src/actions/rider-profile.ts");
    expect(src).not.toMatch(/phone:\s*input\.phone/);
    expect(src, "必须显式拒绝改号并指路，而不是静默忽略").toContain("To change your phone number");
  });

  it("发码与验码都用非持久化 client（用 cookie client 会顶掉骑手自己的登录态）", () => {
    const src = read("src/actions/rider-settings.ts");
    expect(src).toContain("persistSession: false");
    for (const fn of ["requestRiderPhoneChange", "verifyRiderPhoneChange"]) {
      const body = bodyOf(src, fn);
      expect(body, fn + " 不得使用 cookie client（会替换浏览器里的 session）").not.toContain("await createClient()");
      expect(body, fn + " 必须走 ephemeralAuth()").toContain("ephemeralAuth()");
    }
  });

  it("验码通过后必须走 preparePhoneIdentity（号码归属判定只有一份实现）", () => {
    const body = bodyOf(read("src/actions/rider-settings.ts"), "verifyRiderPhoneChange");
    expect(body).toContain("preparePhoneIdentity");
  });
});

describe("柜台重置骑手密码", () => {
  const body = bodyOf(read("src/actions/workshop.ts"), "resetRiderPassword");

  it("走权限矩阵（CUSTOMERS edit），不是手写角色清单", () => {
    expect(body).toContain('"CUSTOMERS"');
    expect(body).toContain('"edit"');
  });

  it("**必须**先确认目标账号不是员工账号（否则是绕过员工权限的后门）", () => {
    expect(body).toContain("db.user.findFirst");
    expect(body).toContain("staff account");
  });

  it("密码只回显一次，且绝不写进审计", () => {
    expect(body).toContain("generateTempPassword");
    // 只看 audit 调用本身（return 里回显密码给柜台是对的，不该被这条断言误伤）。
    const fromAudit = body.slice(body.indexOf("await audit("));
    const auditCall = fromAudit.slice(0, fromAudit.indexOf("});") + 3);
    expect(auditCall, "审计是长期留存的，密码不能进去").not.toMatch(/password\s*:/);
    expect(auditCall, "但「是否自动生成」这类事实要记").toContain("generated");
  });
});
