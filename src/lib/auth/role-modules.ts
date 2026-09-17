/**
 * 角色 → 模块 → 允许的动作。**唯一定义**。
 *
 * 为什么单独成文件：这张矩阵有两个消费方——服务端的授权判定（permissions.ts，带 DB 覆盖）
 * 和**客户端**的侧边栏过滤（nav-registry.ts）。nav-registry 被 "use client" 的 sidebar 引用，
 * 不能 import 带 server-only/db 的 permissions.ts，于是它**自己抄了一份视图矩阵**。
 * 2026-09-15 那份副本漂移了：给 ATTENDANCE 加权限时只改了 permissions.ts，
 * 结果柜台/销售同事在侧边栏里根本看不到「考勤」（只有 OWNER 这种通配角色看得到）。
 * 现在两边都读这一个文件，副本删掉。
 *
 * 本文件必须保持**无副作用、无依赖**（客户端也会打进 bundle）。
 */

export type PermissionAction = "view" | "create" | "edit" | "delete" | "export";

export const ROLE_MODULES: Record<string, Record<string, PermissionAction[]>> = {
  SUPER_ADMIN: { "*": ["view", "create", "edit", "delete", "export"] },
  OWNER: { "*": ["view", "create", "edit", "delete", "export"] },
  HEAD_OFFICE_ADMIN: { "*": ["view", "create", "edit", "delete", "export"] },
  /**
   * MANAGER = 后台功能与 OWNER 完全对齐（2026-09-17 owner 要求「manager 拥有跟 owner 一样的权限去做管理」）。
   *
   * ⚠️ 这里**只能**写 `"*"`，因为 `defaultAllowed()` 一见到 `"*"` 就立刻 return——
   * 同一角色下的**模块级条目永远不会被读**。原来这里还写着
   * `FINANCE: ["view","export"]` / `SETTINGS` / `USERS` 三行，那是**死代码**：
   * 看起来在限制经理不能改财务，实际上通配早就把 create/edit 给出去了。
   * 留着比删掉更危险（下一个人会照着它做判断），所以删掉并留这条说明。
   * （同样的"影子"也存在于 SALES_MANAGER / SERVICE_MANAGER / PARTS_MANAGER 的模块清单上——
   *  那些是**既有行为**，动它们等于**收回**权限，是另一件事，本轮刻意不碰。）
   *
   * 这条只管「能不能做这个动作」，**不管「看得见哪几家店」**——后者是 branch-scope 的
   * `isOrgLevelRole`，MANAGER 仍然不是 org 级（数据限本店）。
   */
  MANAGER: { "*": ["view", "create", "edit", "delete", "export"] },
  SALES_MANAGER: {
    "*": ["view", "export"],
    // HRM: 销售团队的考勤（本店的更正由销售经理批）
    ATTENDANCE: ["view", "create", "edit"],
    LEADS: ["view", "create", "edit", "delete", "export"],
    PIPELINE: ["view", "create", "edit"],
    TEST_RIDES: ["view", "create", "edit"],
    TASKS: ["view", "create", "edit", "delete"],
    CUSTOMERS: ["view", "create", "edit"],
    ANALYTICS: ["view", "export"],
    REPORTS: ["view", "export"],
  },
  SALES_ADVISOR: {
    // HRM: 销售顾问自己打卡（拍照 + 定位）
    ATTENDANCE: ["view", "create"],
    LEADS: ["view", "create", "edit"],
    PIPELINE: ["view", "create", "edit"],
    TEST_RIDES: ["view", "create", "edit"],
    TASKS: ["view", "create", "edit"],
    CUSTOMERS: ["view", "create", "edit"],
    MOTORCYCLES: ["view", "create", "edit"],
    DASHBOARD: ["view"],
  },
  SERVICE_MANAGER: {
    "*": ["view", "export"],
    ATTENDANCE: ["view", "create", "edit"],
    BOOKINGS: ["view", "create", "edit", "delete"],
    WORKSHOP: ["view", "create", "edit"],
    JOB_CARDS: ["view", "create", "edit", "delete"],
    TECHNICIANS: ["view", "create", "edit"],
    REMINDERS: ["view", "create", "edit"],
    PARTS: ["view"],
    ANALYTICS: ["view", "export"],
  },
  SERVICE_ADVISOR: {
    ATTENDANCE: ["view", "create"],
    BOOKINGS: ["view", "create", "edit"],
    WORKSHOP: ["view", "create", "edit"],
    JOB_CARDS: ["view", "create", "edit"],
    CUSTOMERS: ["view", "create", "edit"],
    MOTORCYCLES: ["view", "create", "edit"],
    REMINDERS: ["view", "edit"],
    DASHBOARD: ["view"],
  },
  COUNTER_STAFF: {
    DASHBOARD: ["view"],
    ATTENDANCE: ["view", "create"],
    CUSTOMERS: ["view", "create", "edit"],
    BOOKINGS: ["view", "create", "edit"],
    JOB_CARDS: ["view", "create", "edit"],
    WORKSHOP: ["view"],
    INVENTORY: ["view"],
    AI: ["view"],
  },
  CUSTOMER_SERVICE: {
    DASHBOARD: ["view"],
    ATTENDANCE: ["view", "create"],
    CUSTOMERS: ["view", "create", "edit"],
    BOOKINGS: ["view", "create", "edit"],
    REMINDERS: ["view", "create", "edit"],
    TASKS: ["view", "create", "edit"],
    MESSAGING: ["view", "create"],
    LOYALTY: ["view", "edit"],
  },
  MECHANIC: {
    DASHBOARD: ["view"],
    ATTENDANCE: ["view", "create"],
    WORKSHOP: ["view", "edit"],
    JOB_CARDS: ["view", "edit"],
    TECHNICIANS: ["view"],
    INVENTORY: ["view"],
    PARTS: ["view"],
  },
  PARTS_MANAGER: {
    "*": ["view", "export"],
    ATTENDANCE: ["view", "create"],
    PARTS: ["view", "create", "edit", "delete"],
    INVENTORY: ["view", "create", "edit", "delete", "export"],
    BRANCHES: ["view"],
    ANALYTICS: ["view", "export"],
  },
  INVENTORY: {
    ATTENDANCE: ["view", "create"],
    PARTS: ["view", "create", "edit"],
    INVENTORY: ["view", "create", "edit", "export"],
    DASHBOARD: ["view"],
  },
  MARKETING: {
    ATTENDANCE: ["view", "create"],
    CAMPAIGNS: ["view", "create", "edit", "delete"],
    LOYALTY: ["view", "edit"],
    REFERRALS: ["view"],
    CUSTOMERS: ["view"],
    ANALYTICS: ["view", "export"],
    AI: ["view"],
    DASHBOARD: ["view"],
  },
  ACCOUNTING: {
    ATTENDANCE: ["view", "create"],
    FINANCE: ["view", "create", "edit", "export"],
    REPORTS: ["view", "export"],
    ANALYTICS: ["view", "export"],
    INVOICES: ["view", "create", "edit"],
    DASHBOARD: ["view"],
  },
  AUDITOR: {
    "*": ["view", "export"],
    USERS: ["view"],
    SETTINGS: ["view"],
  },
};
