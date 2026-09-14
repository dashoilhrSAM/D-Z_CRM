---
date: 2026-09-14
title: 写路径授权（员工提权、发票与薪资的资金写入）
branch: fix/write-path-authorization
---

## 改动

审计发现的三条"内部人一步拿到权或钱"的路径。这次的核心不是补几个 if，而是**让写路径第一次真正使用项目已有的权限矩阵**。

### 关键背景：矩阵存在，但只用来过滤侧边栏

src/lib/auth/permissions.ts 里有完整的 RBAC 矩阵（角色 × 模块 × 动作，DB Permission 行可覆盖默认值）。

先纠正一个我一开始写错的说法（实测后改正）：矩阵**并不是**只用来过滤侧边栏。
src/app/workshop/layout.tsx:32-33 是真正的页面门禁 ——

    const allowed = await can({ id, role, organisationId }, navItem.module, "view");
    if (!allowed) redirect("/workshop/dashboard");

实测：柜台账号访问 /workshop/staff、/workshop/settlements、/workshop/finance/invoices 全部 307 回 dashboard。
所以**页面查看**这一层是被矩阵守住、而且守得对的。

真正的缺口在**动作层**：can() 全项目只被 layout（页面查看）与 developer.ts（编辑矩阵本身）调用，
**没有任何一个写操作（Server Action）问过矩阵**。于是"能不能做这件事"完全等同于"能不能打开那个页面"——
一旦拿到 action 的调用方式（页面 bundle 里有 action id），页面门禁就不再是边界。这就是本次要补的那一层。

### 一、员工管理：手写清单与矩阵并存，且互相矛盾

旧代码在 src/actions/workshop.ts 里写着：

    const STAFF_MANAGER_ROLES = ["SUPER_ADMIN", "OWNER", "HEAD_OFFICE_ADMIN", "MANAGER", "MECHANIC"];

而矩阵里 defaultAllowed("MECHANIC", "USERS", "edit") === false —— 机修根本没有 USERS 权限。
两者不一致的后果是实打实的：updateStaff 过了这道门后直接 data.role = input.role 落库，
**没有角色白名单、没有目标分行校验**；resetStaffPassword 只查目标 id 与 authId，
可以对任意账号（含 OWNER）用 Supabase admin 改密码；toggleStaffActive **一行会话检查都没有**。

改动：

1. **门禁改问矩阵**（新增 requireStaffManager()，内部调 can(user, "USERS", action)）。机修那个洞由此自动消失，
   而且"谁能管员工"重新变成业务可配置的事（Developer 设置里改），不再是散在源码里的一个数组。
2. **新增 src/lib/auth/staff-policy.ts（纯函数，可单测）**，管"能对谁做、能改成什么"：
   - canManageTarget：分行级只能管本店的人；**分行级碰不到 org 级账号**；分行级账号缺 branchId 时一律拒绝。
   - canAssignRole：**谁都不能改自己的角色**（自提权等于一条调用换掉整个组织）；分行级**不能授予 org 级角色**。
   - canToggleActive：不能停自己，沿用同一套管辖范围。
   - canResetPassword：重置别人的密码等于用别人的身份登录，同样受管辖范围限制。
3. 四个动作（createStaff / updateStaff / toggleStaffActive / resetStaffPassword）全部接入，并写 AuditLog。

**这里有一条我刻意没有收紧**：矩阵里 MANAGER 明确有 USERS: [view, create, edit] —— 分店经理管本店员工
是设计意图。所以线划在**角色高度**上，而不是"只有老板能管人"：分行级可以增删改**分行级**账号，
但造不出、也改不了总部级账号。若业务要求连这个也收紧，改矩阵即可，不用改代码。

### 二、发票资金写入：补身份 + 分行 + 审计，但**不动"谁能收钱"**

settleInvoices 与 addInvoicePayment 此前**没有任何身份与分行校验** —— 任何已登录员工都能把
任意分店的发票改成 PAID、或插入任意金额的收款。

**但这次我没有给它们加权限门槛**，因为 setInvoiceDiscount 上方的注释记录着 owner 的决定：

> "Anyone who can take a payment can do this — the owner's decision — so the control is the audit
> trail rather than a permission."

所以只补真正缺失的三件：身份（staff）、分行（scopedBranchId 与发票 branchId 比对）、审计。
要收紧成"只有财务能收钱"是**一行**的事：在矩阵里给角色开 FINANCE 权限，然后在这个 helper 里加 can(...)。
顺带修正返回值的语义：settled 现在返回**实际结清数**（旧版返回请求数，把本来就已 PAID 的也算进去了）。

### 三、薪资写入：沿用同文件已定的规则

agreePayout 早就写着 session.role === "MECHANIC" 就拒绝、提示 "Owner/manager access required"，
mechanicConfirmPayout 甚至检查了"这是不是你的 payout"—— 而 settlePayouts 与 addPayoutPayment
**一行校验都没有**，任何已登录员工（含机修自己）都能写任意金额的薪资。这次让这两个函数沿用同一条规则，
并按目标员工的分行做归属校验，写 AuditLog。

## 影响

- 机修不再是"能管员工"的角色；分行级账号不再能停用／改密／改角色到总部账号上；没人能改自己的角色。
- 发票与薪资的写入有了身份、分行与审计，且**不改变"谁能收钱／谁能发薪"这两条既有业务决定**。
- 附带修掉一个测试基建问题：server-only 在 vitest 里按浏览器条件解析会抛错，导致任何测试都无法
  import 服务端模块（第一个撞上的是 permissions.ts）。已加测试专用空替身 tests/stubs/server-only.ts，
  真实边界仍由 next build 保证。

## 交接说明

- **验证**：tsc 0；vitest **464 通过**（36 文件，新增 tests/staff-policy.test.ts 15 条）；build 通过；
  全量 e2e 见下。
- **反向验证 20/20**：用与测试**完全相同**的断言跑在 origin/main 上，20 条全部失败
  （含"旧清单里有 MECHANIC 而矩阵里没有"这条矛盾）。
- **踩到的自家坑（值得记）**：反向验证的第一版有 **2 条假通过** —— 一条是正则里竖线的作用域写宽了
  （匹配 "toggleStaffActive…requireStaffManager" **或者** 文件里任意位置的 getSessionUser），
  另一条是 indexOf 找注释返回 -1 时，切片的结束位置 -1 反而把**后面的函数**也带了进来。
  两者都让"守卫看起来有效"。已改为**逐函数提取函数体**再断言（fnBody），测试与反向脚本共用同一份逻辑。
  教训：反向验证不通过的守卫要修，**通过得太容易的守卫更要查**。
- **可达性（实测，未做端到端利用）**：middleware 把 MECHANIC 从 /workshop/* 重定向走；layout 的权限门禁
  又把没有 USERS:view 的角色（柜台／库存／营销）从 /workshop/staff 307 回 dashboard。实测确认过这两条。
  因此**修复前能真正走到这些动作的，是矩阵里拥有 USERS:view 的角色 —— 即 MANAGER 及以上**
  （经理在矩阵里有 USERS: [view, create, edit]）。也就是说旧的提权链是"经理把自己或别人提成 SUPER_ADMIN"。
  Server Action 无法用 curl 直接构造（action id 是构建期哈希），所以"没有页面权限的人能否绕开页面门禁直接
  调 action"这一点**本次未验证**；而这恰好是本次改动要消除的依赖 —— 校验现在写在动作内部，
  能不能打开页面不再决定能不能执行。
- **本批未做**：rider actions 的归属校验（IDOR）、库存／时段的原子化、工单号收敛 —— 属后续批次。
