// 角色权限矩阵：**一份定义，两个消费方**。
//
// 背景（2026-09-15 真实 bug）：这张矩阵有两个读者——服务端的授权判定
// （src/lib/auth/permissions.ts，带 DB 覆盖）和客户端的侧边栏过滤
// （src/lib/nav-registry.ts，被 "use client" 的 sidebar 引用，不能 import 带
// server-only/db 的 permissions.ts）。于是 nav-registry 里**手抄了一份视图矩阵**。
// 给考勤加权限时只改了 permissions.ts，抄件没跟——柜台/销售同事的侧边栏里
// 「考勤」压根不出现（只有通配角色 OWNER 看得到），而页面本身是能打开的：
// 症状是「功能在，但没人找得到」。
//
// 现在两边都读 src/lib/auth/role-modules.ts。这里的守卫保证：
//  1. 手抄件不许回来（源码守卫，反向验证过会失败）；
//  2. 两个消费方确实都在读那一份；
//  3. 逐角色逐模块，导航的 view 判定与授权判定一致。
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { ROLE_MODULES } from "@/lib/auth/role-modules";
import { moduleAllowed } from "@/lib/nav-registry";
import { defaultAllowed, MODULES } from "@/lib/auth/permissions";
import { isOrgLevelRole, canManageOrgSettings, scopedBranchId } from "@/lib/branch-scope";
import { canAssignRole, canManageTarget } from "@/lib/auth/staff-policy";

const read = (p: string) => readFileSync(path.join(process.cwd(), p), "utf8");

describe("权限矩阵只有一份定义", () => {
  it("nav-registry 里不许再出现手抄的视图矩阵", () => {
    const nav = read("src/lib/nav-registry.ts");
    expect(nav, "手抄的 DEFAULT_VIEW_MATRIX 又回来了").not.toContain("DEFAULT_VIEW_MATRIX");
    // 也不许用别的方式再抄一遍（角色名后面直接跟模块数组）
    expect(nav, "nav-registry 里又在给角色列模块清单").not.toMatch(/COUNTER_STAFF:\s*\[/);
    expect(nav, "nav-registry 里又在给角色列模块清单").not.toMatch(/MECHANIC:\s*\[/);
  });

  it("两个消费方都读同一份 role-modules", () => {
    expect(read("src/lib/nav-registry.ts")).toContain('from "@/lib/auth/role-modules"');
    expect(read("src/lib/auth/permissions.ts")).toContain('from "@/lib/auth/role-modules"');
    // permissions.ts 不再自带矩阵（它只做 DB 覆盖 + 判定）
    expect(read("src/lib/auth/permissions.ts")).not.toMatch(/const DEFAULT_MATRIX/);
  });

  it("考勤这条具体回归：柜台同事必须能从导航走进考勤", () => {
    expect(moduleAllowed("COUNTER_STAFF", "ATTENDANCE"), "柜台看不到考勤 = 这个 bug 复发").toBe(true);
    expect(defaultAllowed("COUNTER_STAFF", "ATTENDANCE", "view")).toBe(true);
    // 销售顾问同为前线收银/销售角色，也要能打卡
    expect(moduleAllowed("SALES_ADVISOR", "ATTENDANCE")).toBe(true);
  });

  it("逐角色逐模块：导航的 view 判定与授权判定一致", () => {
    // 收敛成一份定义之后这条在结构上必然成立——留着是因为它挡住的是
    // "有人再引入第三条路径"（比如某个页面自己判角色），而不是今天的漂移。
    const roles = Object.keys(ROLE_MODULES);
    expect(roles.length, "矩阵读不到角色（守卫会空跑）").toBeGreaterThan(10);
    const mismatches: string[] = [];
    for (const role of roles) {
      for (const m of MODULES) {
        if (moduleAllowed(role, m) !== defaultAllowed(role, m, "view")) mismatches.push(role + "/" + m);
      }
    }
    expect(mismatches, "导航与授权判定不一致：" + mismatches.join(", ")).toEqual([]);
  });
});

/**
 * MANAGER 与 OWNER 的**后台功能**对齐（2026-09-17 owner 要求）。
 *
 * 这次改动最容易走偏的地方是：把 MANAGER 直接塞进 ORG_LEVEL_ROLES 就"跟 owner 一样"了——
 * 那会一次放开三件事（看所有分店、staff-policy 两条红线失效、能改别店店名）。
 * 所以这里把「功能对齐了」「范围没动」「红线还在」三件事分别钉死。
 */
describe("MANAGER 与 OWNER 的后台功能对齐（数据范围不动）", () => {
  const ACTIONS = ["view", "create", "edit", "delete", "export"] as const;

  it("矩阵层面逐模块逐动作完全一致", () => {
    const mismatches: string[] = [];
    for (const m of MODULES) {
      for (const a of ACTIONS) {
        if (defaultAllowed("MANAGER", m, a) !== defaultAllowed("OWNER", m, a)) mismatches.push(m + "/" + a);
      }
    }
    expect(mismatches, "MANAGER 与 OWNER 的权限漂移了：" + mismatches.join(", ")).toEqual([]);
    // 防空跑：至少确认一个动作真的被比较过
    expect(defaultAllowed("OWNER", "FINANCE", "delete"), "比较本身没生效").toBe(true);
  });

  it("MANAGER 这一格只能写 '*'——写模块级条目是死代码（通配先 return）", () => {
    const entry = ROLE_MODULES.MANAGER ?? {};
    expect(
      Object.keys(entry),
      "MANAGER 又出现了模块级条目。defaultAllowed() 见到 '*' 就立刻 return，那些行永远不会被读——" +
        "看起来在限制经理，实际什么都没限制，只会误导下一个读矩阵的人。",
    ).toEqual(["*"]);
  });

  it("数据范围没动：MANAGER 仍不是 org 级，锁在本店", () => {
    expect(isOrgLevelRole("MANAGER"), "MANAGER 被提升成 org 级 = 能看/改所有分店，这次**不**要这个").toBe(false);
    expect(scopedBranchId({ role: "MANAGER", branchId: "b1" }), "分行级必须锁在本店").toBe("b1");
    expect(scopedBranchId({ role: "OWNER", branchId: "b1" }), "org 级才看全部").toBeNull();
  });

  it("两个谓词是两条轴：功能可以给，范围不给", () => {
    expect(canManageOrgSettings("MANAGER"), "MANAGER 要用得了总部级后台功能").toBe(true);
    expect(canManageOrgSettings("COUNTER_STAFF")).toBe(false);
    expect(canManageOrgSettings("MECHANIC")).toBe(false);
    for (const r of ["OWNER", "SUPER_ADMIN", "HEAD_OFFICE_ADMIN"]) {
      expect(isOrgLevelRole(r)).toBe(true);
      expect(canManageOrgSettings(r)).toBe(true);
    }
  });

  it("红线还在：manager 能管本店的人，但造不出 OWNER、也碰不到总部账号", () => {
    const actor = { userId: "u1", role: "MANAGER", branchId: "b1" };
    expect(canAssignRole(actor, null, "OWNER").ok, "manager 能造 OWNER 账号 = 自提权路径").toBe(false);
    expect(canAssignRole(actor, null, "SUPER_ADMIN").ok).toBe(false);
    expect(canAssignRole(actor, null, "MECHANIC").ok, "本店普通角色要能授予").toBe(true);
    expect(canManageTarget(actor, { id: "u9", role: "OWNER", branchId: "b1" }).ok).toBe(false);
    expect(canManageTarget(actor, { id: "u9", role: "MECHANIC", branchId: "b1" }).ok).toBe(true);
    expect(canManageTarget(actor, { id: "u9", role: "MECHANIC", branchId: "b2" }).ok, "别店的人管不到").toBe(false);
  });
});
