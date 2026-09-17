---
date: 2026-09-17
title: manager 拿到跟 owner 一样的后台功能——但数据仍限本店（把一根谓词拆成两根）
branch: feat/manager-owner-parity
---

## 改动

owner 的要求是一句话：「让 manager 拥有跟 owner 一样的权限去做管理」。
先说侦察结论——**这句话在代码里的落点跟字面不太一样**：

- **权限矩阵那条线今天已经是平的**：`ROLE_MODULES.MANAGER` 早就有 `"*": [view, create, edit, export]`，
  persona 也映射到 OWNER，后台每个页面他都看得到。矩阵里唯一缺的是 `delete`，
  而 `requireStaffManager("delete")` **全项目定义了却从未被调用** —— 加不加今天是空操作。
- **manager 真正被挡住的是「范围」**：设置页按 `isOrgLevelRole` 判断，他只能拿到本店那一行，
  看不到组织资料、考勤政策、服务目录、审计日志、集成。

所以真正的改动是**把一根被复用的谓词拆成两根**：

```
isOrgLevelRole(role)       = 数据范围：看得见、管得着**几家店**   → 只 org 级（MANAGER 仍然不是）
canManageOrgSettings(role) = 功能开关：能不能用总部级后台功能      → org 级 + MANAGER
```

为什么不直接把 MANAGER 塞进 `ORG_LEVEL_ROLES`（一行就"对齐"了）：那会**一次放开三件事**，
而 owner 明确只要第一件的一部分：

1. 看到所有分店的数据 ← 不想要
2. `staff-policy.ts` 的两条红线同时失效（分行级不能碰总部账号、不能授予总部角色）← 等于开自提权路径
3. 能改别店的店名/城市（门店身份，不只是运营细节）← 不想要

### 具体给了什么 / 没给什么

| 能力 | 改动前 | 现在 |
|---|---|---|
| 组织资料（名称/电话/地址/税号/时区/币种） | 仅 org 级 | **org 级 + MANAGER** |
| 考勤政策（拍照/定位必填、围栏半径、精度上限） | 仅 org 级 | **org 级 + MANAGER** |
| 服务目录（新增/改价/上下架/删除） | 仅 org 级 | **org 级 + MANAGER** |
| 审计日志入口 | 仅 org 级 | **org 级 + MANAGER**（并按分行收窄，见下） |
| 集成入口 | 仅 org 级 | **org 级 + MANAGER** |
| 改本店运营细节（电话/地址/营业时间/容量/坐标） | MANAGER 可以 | 不变 |
| 看/改**别的**分店 | 不行 | **仍然不行** |
| 改店名/城市、新增分行 | 仅 org 级 | **仍然仅 org 级** |
| 能管本店员工（含改角色） | 可以 | 不变，红线不变 |
| 造 OWNER/SUPER_ADMIN 账号、改总部账号 | 不行 | **仍然不行** |
| Developer（权限矩阵编辑器） | 仅 OWNER/SUPER_ADMIN | **仍然仅此二者** |

最后一条是刻意的：Developer 页能改「角色×模块」矩阵，也就是**给自己加权限**。
「后台功能对齐」到这一页为止——把提权入口也交出去，前面所有红线都白设。

### 顺带修掉的两个坑

1. **矩阵里的死代码**：`MANAGER` 那格原来还写着 `FINANCE: ["view","export"]` / `SETTINGS` / `USERS` 三行。
   `defaultAllowed()` **见到 `"*"` 就立刻 return**，模块级条目永远不会被读 —— 那三行看起来在限制经理不能改财务，
   实际通配早就把 create/edit 给出去了。删掉并留注释说明这个"影子"规则
   （同样的影子也存在于 SALES_MANAGER / SERVICE_MANAGER / PARTS_MANAGER 的模块清单上，
   但那些是**既有行为**，动它们等于**收回**权限，是另一件事，本轮刻意没碰）。
2. **审计日志页原本没有任何自店校验**：它只是被侧边栏藏起来，URL 直接打开就能读到全组织的审计。
   现在按 `scopedBranchId` 收窄（org 级看全部，其余看本店），顺带把"任何登录员工都能开 URL 看全组织审计"堵上。

## 影响

- **对老板**：不必再为了让经理干活把 OWNER 账号借出去。经理能自己改政策、改服务价、看审计。
- **对经理**：设置页从"只有本店一格"变成完整的后台；但他看不到别家店，也造不出老板账号。
- **对分行隔离**：没动。`scopedBranchId` / `applyBranchScope` 一行未改，MANAGER 仍锁在本店。
- **对既有测试**：`tests/attendance.test.ts` 有一条第 2026-09-15 写的源码守卫断言
  `updateAttendancePolicy` 里有 `auth.orgLevel`——这次的谓词换名把它**正确地**弄红了。
  已改成断言「必须是 `auth.backOffice` 或 `auth.orgLevel` 这两个受控谓词之一」，
  这样它守的是**规则**（不能退化成谁都能改），而不是某个谓词当时的拼写。
- **数据库**：零 schema 改动。

## 交接说明

- **验证**（都以 MANAGER 身份在真浏览器里走过，不是只看单测）：
  - 设置页出现 Organisation profile / Closed-lost reasons / QR / Branches / Attendance policy / Service catalogue
    与集成、审计日志入口；**没有** Developer 入口；**没有**「Add branch」表单。
  - 分行列表只有 **1 行**（本店）——数据范围确实没放开。
  - 点「编辑分行」：门店身份显示为只读文本 `D&Z Smart Workshop · Petaling Jaya`，**没有名字输入框**。
  - **真写了一次考勤政策**（以 MANAger 身份点掉「必须拍照」并保存）→ 数据库 `attendancePhotoRequired` 1→0，
    并落下一条 `ATTENDANCE_POLICY` 审计；随后**改回 1**（已核对复原）。
    这是"功能真的给了"而不是"页面渲染出来了"的证据。
  - `/workshop/settings/developer` → MANAGER 被 redirect 回 `/workshop/settings`。
  - `pnpm exec tsc --noEmit` 0；`pnpm test` **527 通过 / 39 文件**（main 522，新增 5 条守卫）；lint 0 error。
- **新增守卫**（`tests/role-matrix.test.ts`，5 条）把这次最容易走偏的地方钉死：
  矩阵逐模块逐动作 MANAGER ≡ OWNER；MANAGER 那格**只能写 `"*"`**（死代码不许回来）；
  MANAGER **仍不是 org 级**（防有人"顺手"把它加进 ORG_LEVEL_ROLES）；两个谓词是两条轴；
  红线还在（manager 造不出 OWNER、碰不到别店的人、碰不到总部账号）。
  **反向验证**：把矩阵改回 main 的旧版，前两条**失败**（2 failed / 7 passed），恢复后 9/9 通过。
- **刻意没做**（要的话都是一句话的事，但都超出「数据仍限本店」的口径）：
  服务目录价格是全组织共用的，改它等于动所有分店的报价——我按"后台功能"给了；
  如果 owner 认为价格该留在总部，把它也从 `backOffice` 挪回 `orgLevel` 即可（`settings.ts` 四处）。
