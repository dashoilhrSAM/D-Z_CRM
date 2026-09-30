/**
 * 业务数据清空 —— **按租户收窄的唯一定义**。
 *
 * 为什么要有这个文件
 * ------------------
 * `src/actions/developer.ts` 原本在一个事务里对 40 张表循环 `deleteMany({})`。
 * 单租户下这看不出问题；一旦库里有第二家门店，**任何一家的 owner 点一下
 * 「清空业务数据」，所有租户的业务数据一起没**，而且不可逆 —— 审计行只记录了
 * 操作者自己的 orgId，事后连删除范围都对不上（2026-09-30 多租户审计发现）。
 *
 * 所以删除顺序与「每张表怎么收窄到当前租户」必须写在同一处：
 * 分开放就会漂移 —— 加了一张表只改了顺序、忘了改作用域，正是这类 bug 的典型形态。
 *
 * 这张表同时也是 schema 的一面镜子：**47 个模型没有 organisationId**，
 * 只能经关系收窄。哪些表走哪条路径必须逐条写清楚，不能靠猜。
 *
 * 不变量（由 `tests/business-data-scope.test.ts` 断言）：
 *   ① 每一项的 where 都把删除限制在一个 organisationId 内；
 *   ② 没有任何一项退化成空 where。
 */

export interface BusinessTableScope {
  /** Prisma 模型名（PascalCase）；访问器名由 camelCase 推导。 */
  model: string;
  /** 生成该表在当前租户内的删除条件。**绝不允许返回 `{}`。** */
  where: (organisationId: string) => Record<string, unknown>;
  /** 收窄路径的类型（便于人工核对与生成说明）。 */
  via: "organisationId" | "branch" | "job" | "invoice" | "customer" | "user" | "lead" | "account" | "payout" | "purchaseOrder" | "rule" | "execution";
}

/** 有 organisationId 列：直接收窄。 */
const org = (model: string): BusinessTableScope => ({
  model,
  via: "organisationId",
  where: (organisationId) => ({ organisationId }),
});

/** 有 branch → Branch.organisationId：经分行收窄。 */
const viaBranch = (model: string): BusinessTableScope => ({
  model,
  via: "branch",
  where: (organisationId) => ({ branch: { organisationId } }),
});

/** 无 org、无 branch，经父行收窄。 */
const via = (model: string, path: string, field: string, kind: BusinessTableScope["via"]): BusinessTableScope => {
  const parts = path.split(".");
  return {
    model,
    via: kind,
    where: (organisationId) => {
      // 逐层包成嵌套关系过滤：job.branch.organisationId → { job: { branch: { organisationId } } }
      let node: Record<string, unknown> = { [field]: organisationId };
      for (let i = parts.length - 1; i >= 0; i--) node = { [parts[i]]: node };
      return node;
    },
  };
};

/**
 * 清空顺序：**先子后父**（CustomerApproval 引用 InspectionFinding，须在其前）。
 * 顺序与原 `developer.ts` 的 BUSINESS_TABLES 逐字一致 —— 本文件只补作用域，不动顺序。
 */
export const BUSINESS_DATA_DELETE_ORDER: readonly BusinessTableScope[] = [
  via("ChecklistExecutionItem", "execution.job.branch", "organisationId", "execution"),
  via("ChecklistExecution", "job.branch", "organisationId", "job"),
  via("ServiceJobPart", "job.branch", "organisationId", "job"),
  via("ServiceJobItem", "job.branch", "organisationId", "job"),
  via("CustomerApproval", "job.branch", "organisationId", "job"),
  via("InspectionFinding", "job.branch", "organisationId", "job"),
  via("JobStatusHistory", "job.branch", "organisationId", "job"),
  org("ServiceHistory"),
  via("InvoiceItem", "invoice.branch", "organisationId", "invoice"),
  via("Payment", "invoice.branch", "organisationId", "invoice"),
  via("StaffPayoutPayment", "payout.user", "organisationId", "payout"),
  via("PurchaseOrderItem", "purchaseOrder.branch", "organisationId", "purchaseOrder"),
  via("RewardRedemption", "account", "organisationId", "account"),
  via("LoyaltyTransaction", "account", "organisationId", "account"),
  via("LeadActivity", "lead", "organisationId", "lead"),
  viaBranch("StockMovement"),
  // Attendance 有 branchId 但**没有 branch 关系**（schema 里是裸标量），只能经 user 收窄。
  via("Attendance", "user", "organisationId", "user"),
  org("Message"),
  // Notification 同时有 branch 与 user；用 branch 与其余分行级数据保持一致。
  viaBranch("Notification"),
  viaBranch("Review"),
  org("TestRide"),
  org("Task"),
  org("Referral"),
  // StaffPayout **既无 organisationId 也无 branchId**，只有 userId。
  via("StaffPayout", "user", "organisationId", "user"),
  viaBranch("Campaign"),
  viaBranch("MarketingAsset"),
  viaBranch("ContentScript"),
  viaBranch("PurchaseOrder"),
  viaBranch("Booking"),
  viaBranch("ServiceJob"),
  viaBranch("Invoice"),
  via("ServiceReminder", "customer", "organisationId", "customer"),
  org("Lead"),
  org("LoyaltyAccount"),
  via("CustomerAddress", "customer", "organisationId", "customer"),
  via("CustomerConsent", "customer", "organisationId", "customer"),
  via("CustomerAuthProfile", "customer", "organisationId", "customer"),
  org("Attachment"),
  via("AutomationExecution", "rule", "organisationId", "rule"),
  // Motorcycle 既无 organisationId 也无 branchId，只有 customerId。
  via("Motorcycle", "customer", "organisationId", "customer"),
  org("Customer"),
] as const;

/** 模型名 → Prisma client 访问器（PascalCase → camelCase）。 */
export function accessorFor(model: string): string {
  return model[0].toLowerCase() + model.slice(1);
}
