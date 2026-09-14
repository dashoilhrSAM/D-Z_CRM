// 员工/角色管理的判定规则（纯函数矩阵）。
//
// 这些规则以前是 src/actions/workshop.ts 里的一个手写数组：
//   STAFF_MANAGER_ROLES = ["SUPER_ADMIN", "OWNER", "HEAD_OFFICE_ADMIN", "MANAGER", "MECHANIC"]
// 而 src/lib/auth/permissions.ts 里**已经有一份权限矩阵**（同一件事的第二处定义），
// 矩阵里 MECHANIC 根本没有 USERS 权限。后果（2026-09-14 审计）：机修也过得了那道门，
// 门后又 data.role = input.role 直接落库 —— 一条调用把自己变成 SUPER_ADMIN。
//
// 现在"能不能做这件事"问矩阵，"能对谁做、能改成什么"问这里的纯函数。行为断言而不是源码断言。
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { canManageTarget, canAssignRole, canToggleActive, canResetPassword, VALID_ROLES } from "@/lib/auth/staff-policy";
import { defaultAllowed } from "@/lib/auth/permissions";

const owner = { userId: "u-owner", role: "OWNER", branchId: null };
const klManager = { userId: "u-mgr", role: "MANAGER", branchId: "kl" };
const klMechanic = { userId: "u-mech", role: "MECHANIC", branchId: "kl" };
const klStaff = { id: "s-kl", role: "COUNTER_STAFF", branchId: "kl" };
const otherStaff = { id: "s-other", role: "COUNTER_STAFF", branchId: "pg" };
const otherOwner = { id: "u-owner2", role: "OWNER", branchId: null };

describe("角色授予：红线是角色高度与自提权", () => {
  it("谁都不能改自己的角色（自提权 = 一条调用换整个组织）", () => {
    expect(canAssignRole(owner, { id: owner.userId }, "SUPER_ADMIN").ok).toBe(false);
    expect(canAssignRole(klManager, { id: klManager.userId }, "OWNER").ok).toBe(false);
    expect(canAssignRole(klMechanic, { id: klMechanic.userId }, "SUPER_ADMIN").ok).toBe(false);
  });

  it("分行级不能凭空造出 org 级账号（否则经理一发调用就多一个 OWNER）", () => {
    for (const r of ["SUPER_ADMIN", "OWNER", "HEAD_OFFICE_ADMIN"]) {
      const v = canAssignRole(klManager, null, r);
      expect(v.ok, r + " 不该被分行级授予").toBe(false);
    }
  });

  it("分行级可以正常管本店的分行级角色（矩阵里 MANAGER 确实有 USERS:create/edit）", () => {
    for (const r of ["MECHANIC", "COUNTER_STAFF", "SERVICE_ADVISOR"]) {
      expect(canAssignRole(klManager, otherStaff, r).ok, r).toBe(true);
    }
  });

  it("org 级可以授予任意合法角色", () => {
    expect(canAssignRole(owner, otherStaff, "OWNER").ok).toBe(true);
    expect(canAssignRole(owner, otherStaff, "MECHANIC").ok).toBe(true);
  });

  it("乱写的角色名一律拒绝（白名单来自 Prisma 枚举）", () => {
    expect(canAssignRole(owner, otherStaff, "GOD").ok).toBe(false);
    expect(canAssignRole(owner, otherStaff, "").ok).toBe(false);
    expect(VALID_ROLES).toContain("SUPER_ADMIN");
    expect(VALID_ROLES).toContain("MECHANIC");
  });
});

describe("管辖范围：分行归属与总部账号", () => {
  it("分行级只能管本店的人", () => {
    expect(canManageTarget(klManager, klStaff).ok).toBe(true);
    const v = canManageTarget(klManager, otherStaff);
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.reason).toMatch(/branch/i);
  });

  it("分行级碰不到总部账号（不能停用/改密老板）", () => {
    for (const fn of [canManageTarget, canToggleActive, canResetPassword]) {
      const v = fn(klManager, otherOwner);
      expect(v.ok, fn.name).toBe(false);
    }
  });

  it("org 级看全部份", () => {
    expect(canManageTarget(owner, klStaff).ok).toBe(true);
    expect(canManageTarget(owner, otherOwner).ok).toBe(true);
  });

  it("分行级账号若 misconfig 没有 branchId，一律拒绝（不能因为字段为空就放行）", () => {
    const broken = { userId: "u-x", role: "MANAGER", branchId: null };
    expect(canManageTarget(broken, klStaff).ok).toBe(false);
  });
});

describe("停用与重置密码", () => {
  it("不能停用自己（防自锁）", () => {
    expect(canToggleActive(owner, { id: owner.userId, role: "OWNER", branchId: null }).ok).toBe(false);
  });
  it("重置别人的密码要过同一套管辖范围（重置 = 用别人的身份登录）", () => {
    expect(canResetPassword(klManager, klStaff).ok).toBe(true);
    expect(canResetPassword(klManager, otherStaff).ok).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 接线：动作必须真的把判定接上，而不是又散回去。
describe("接线：写路径真的用了矩阵与策略", () => {
  const read = (p: string) => readFileSync(path.join(process.cwd(), p), "utf8");
  const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  /**
   * 取单个 server action 的函数体（签名 → 下一个顶层 export）。
   * 必须逐函数断言：第一版用"整个文件里出现过某字符串"，结果旧代码也能通过——
   * 因为同文件里别的函数有 getSessionUser，断言等于在测别的东西。
   */
  const fnBody = (src: string, name: string): string => {
    const start = src.indexOf("export async function " + name);
    if (start < 0) return "";
    const next = src.indexOf("\nexport ", start + 10);
    return src.slice(start, next < 0 ? undefined : next);
  };

  it("权限矩阵自己说了：机修没有 USERS 权限，经理有", () => {
    expect(defaultAllowed("MECHANIC", "USERS", "edit")).toBe(false);
    expect(defaultAllowed("MECHANIC", "USERS", "create")).toBe(false);
    expect(defaultAllowed("MANAGER", "USERS", "edit")).toBe(true);
    expect(defaultAllowed("OWNER", "USERS", "edit")).toBe(true);
  });

  it("staff 管理不再用手写的角色清单", () => {
    const src = strip(read("src/actions/workshop.ts"));
    // 旧写法：与矩阵并存的第二处定义，且把 MECHANIC 也放了进去。
    expect(src, "手写角色清单必须消失").not.toMatch(/STAFF_MANAGER_ROLES/);
    expect(src, "改为问权限矩阵").toMatch(/can\([\s\S]{0,200}"USERS"/);
  });

  it("四个员工管理动作逐个过了策略判定（逐函数断言，不看整文件）", () => {
    const src = read("src/actions/workshop.ts");
    const expects: [string, string][] = [
      ["toggleStaffActive", "canToggleActive("],
      ["updateStaff", "canManageTarget("],
      ["updateStaff", "canAssignRole("],
      ["resetStaffPassword", "canResetPassword("],
      ["createStaff", "canAssignRole("],
    ];
    for (const [fn, needle] of expects) {
      const body = fnBody(src, fn);
      expect(body, fn + " 找不到函数体（断言会空跑）").not.toBe("");
      expect(body, fn + " 必须调用 " + needle).toContain(needle);
      expect(body, fn + " 必须过需要会话的门禁").toContain("requireStaffManager(");
    }
  });

  it("发票与薪资的资金写入逐函数都有门禁与分行校验", () => {
    const inv = strip(read("src/actions/invoices.ts"));
    for (const fn of ["settleInvoices", "addInvoicePayment"]) {
      const body = fnBody(inv, fn);
      expect(body, fn + " 找不到函数体").not.toBe("");
      expect(body, fn + " 必须有身份门禁").toContain("requireMoneyWrite()");
    }
    expect(fnBody(inv, "settleInvoices"), "结清必须按分行过滤").toMatch(/another branch/);
    expect(fnBody(inv, "addInvoicePayment"), "收款必须按分行过滤").toMatch(/another branch/);

    const pay = strip(read("src/actions/payouts.ts"));
    for (const fn of ["settlePayouts", "addPayoutPayment"]) {
      const body = fnBody(pay, fn);
      expect(body, fn + " 找不到函数体").not.toBe("");
      expect(body, fn + " 必须有身份门禁").toContain("requirePayoutWrite()");
      expect(body, fn + " 必须按分行过滤").toMatch(/another branch/);
    }
  });
});

