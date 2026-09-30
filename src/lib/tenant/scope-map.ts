/**
 * 租户作用域地图 —— **"这个模型的这一行属于哪家店"的唯一定义**。
 *
 * 为什么需要它（而不是给 40 张表都铺一列 organisationId）
 * ------------------------------------------------------
 * 项目里 83 个模型只有 40 个带 organisationId，其余要经关系才能到达租户。
 * P2 的强制层（`scopedDb`）必须知道**每一张表怎么收窄**，否则它只能：
 *   · 对没有列的表放行 → 隔离漏了；或
 *   · 对没有列的表一律拒绝 → 功能全坏。
 *
 * 铺一列是另一条路，但代价被低估了：复合唯一键在 SQLite/PostgreSQL 上**都不约束
 * organisationId 为 NULL 的行**，而**嵌套写入**（`job.create({ data: { items: { create: [...] } } })`）
 * 不会触发 Prisma 扩展的 create 钩子 —— 于是那些列大概率长期是 NULL，
 * 却让代码看起来"已经有租户列了"。**关系路径是精确的，且不需要任何人记得去写。**
 * 所以：**有路径就用路径；没有路径才补列或补关系**（P1b 给 ServicePackage / Attendance /
 * AttendanceCorrection 补的正是缺失的关系，而不是再加字段）。
 *
 * 这张表是**手工核对**的，不是 BFS 自动推导出来的 —— 自动推导会选错父表：
 * 例如 ServiceJobPart 既能经 `job` 也能经 `product` 到达租户，BFS 可能选 product，
 * 于是"这一行属于哪家店"变成"这个零件属于哪家店"，两者可以不一致。
 * `tests/tenant-scope-map.test.ts` 会逐条把这里的路径拿去和 schema 对账，
 * 并断言**没有任何模型被漏掉**（新增模型却忘了登记 → 测试红）。
 */

export type ScopeEntry =
  /** 模型自己有 organisationId 列，直接过滤。 */
  | { kind: "column"; note?: string }
  /** 经关系到达一个带 organisationId 的模型；path 是逐跳的关系字段名。 */
  | { kind: "relation"; path: readonly string[]; note?: string }
  /** 平台共享的参考数据（organisationId 可空 = 全局行），租户只读。 */
  | { kind: "shared"; note: string }
  /** 有意不属任何租户 —— 必须写明理由，否则就是漏了。 */
  | { kind: "none"; reason: string };

/** 模型名 → 作用域。键必须覆盖 schema.prisma 里的每一个模型。 */
export const TENANT_SCOPE: Record<string, ScopeEntry> = {
  // ============ 租户自身 ============
  Organisation: { kind: "none", reason: "租户本身，不是租户的数据；按 id 过滤" },

  // ============ 有 organisationId 列（40 个）============
  Attachment: { kind: "column" },
  AuditLog: { kind: "column" },
  AutomationRule: { kind: "column" },
  Branch: { kind: "column" },
  BrandProfile: { kind: "shared", note: "品牌资料：organisationId 可空 = 全局行，租户可建覆盖行" },
  BulkImportSession: { kind: "column" },
  CommissionClaim: { kind: "column" },
  CommissionLedger: { kind: "column" },
  CommissionRule: { kind: "column" },
  CommissionTierSet: { kind: "column" },
  Customer: { kind: "column" },
  Document: { kind: "column" },
  IntegrationConfig: { kind: "column" },
  Invoice: { kind: "column" },
  InvoiceCounter: { kind: "column", note: "复合主键 [organisationId, year]" },
  Lead: { kind: "column" },
  LeadSource: { kind: "column" },
  LeadStage: { kind: "column" },
  LoyaltyAccount: { kind: "column" },
  LoyaltyTier: { kind: "column" },
  Message: { kind: "column" },
  MessageTemplate: { kind: "column" },
  Motorcycle: { kind: "column" },
  Occasion: { kind: "shared", note: "节日/日历：organisationId 可空 = 全国共享行" },
  Permission: { kind: "column" },
  Product: { kind: "column" },
  PromoProduct: { kind: "column" },
  Referral: { kind: "column" },
  Reward: { kind: "column" },
  RoleConfig: { kind: "column" },
  ScheduledMessage: { kind: "column" },
  ServiceHistory: { kind: "column" },
  ServiceJob: { kind: "column" },
  ServiceType: { kind: "column" },
  Supplier: { kind: "column" },
  Task: { kind: "column" },
  TestRide: { kind: "column" },
  TrendTopic: { kind: "shared", note: "营销趋势：organisationId 可空 = 全国共享行" },
  User: { kind: "column" },
  ChecklistTemplate: { kind: "column" },

  // ============ 经关系到达租户（39 个）============
  // 每条都刻意选了**语义上正确的父行**，不是"能走通就行"的那条。
  AppointmentSlot: { kind: "relation", path: ["branch"] },
  Attendance: { kind: "relation", path: ["user"], note: "只有 user 一条路；branchId 是裸标量（P1b 已补关系但值可能为空）" },
  AttendanceCorrection: { kind: "relation", path: ["punch", "user"] },
  AttendancePunch: { kind: "relation", path: ["user"] },
  AttendanceReview: { kind: "relation", path: ["punch", "user"] },
  AutomationExecution: { kind: "relation", path: ["rule"] },
  Booking: { kind: "relation", path: ["branch"], note: "也有 customer/motorcycle 路径，但门店是权威来源" },
  Campaign: { kind: "relation", path: ["branch"] },
  ChecklistExecution: { kind: "relation", path: ["job"] },
  ChecklistExecutionItem: { kind: "relation", path: ["execution", "job"] },
  ChecklistItem: { kind: "relation", path: ["template"] },
  CommissionTier: { kind: "relation", path: ["tierSet"] },
  ContentScript: { kind: "relation", path: ["branch"] },
  CustomerAddress: { kind: "relation", path: ["customer"] },
  CustomerApproval: { kind: "relation", path: ["job"] },
  CustomerAuthProfile: { kind: "relation", path: ["customer"] },
  CustomerConsent: { kind: "relation", path: ["customer"] },
  InspectionFinding: { kind: "relation", path: ["job"] },
  Inventory: { kind: "relation", path: ["branch"], note: "也有 product 路径；库存按门店算，不按零件归属算" },
  InventoryLocation: { kind: "relation", path: ["branch"] },
  InvoiceItem: { kind: "relation", path: ["invoice"] },
  JobStatusHistory: { kind: "relation", path: ["job"] },
  LeadActivity: { kind: "relation", path: ["lead"] },
  LoyaltyTransaction: { kind: "relation", path: ["account"] },
  MarketingAsset: { kind: "relation", path: ["branch"] },
  Notification: { kind: "relation", path: ["branch"], note: "也有 user/customer 路径；通知是发给门店的（列表页就是按分行取的）" },
  Payment: { kind: "relation", path: ["invoice"] },
  PurchaseOrder: { kind: "relation", path: ["branch"] },
  PurchaseOrderItem: { kind: "relation", path: ["purchaseOrder", "branch"] },
  Quotation: { kind: "relation", path: ["job"] },
  RewardRedemption: { kind: "relation", path: ["account"], note: "也有 reward 路径；兑换记在账户上" },
  Review: { kind: "relation", path: ["branch"] },
  ServiceJobItem: { kind: "relation", path: ["job"], note: "也有 product/serviceType 路径；工单行属于工单" },
  ServiceJobPart: { kind: "relation", path: ["job"], note: "**不要用 product 路径** —— 那会把「这行属于哪家店」变成「这个零件属于哪家店」" },
  ServiceJobPhoto: { kind: "relation", path: ["job"] },
  ServicePackage: { kind: "relation", path: ["branch"] },
  ServicePackageItem: { kind: "relation", path: ["package", "branch"] },
  ServiceReminder: { kind: "relation", path: ["customer"] },
  StaffPayout: { kind: "relation", path: ["user"], note: "无 org 无 branch，只有 user 一条路" },
  StaffPayoutPayment: { kind: "relation", path: ["payout", "user"] },
  StockMovement: { kind: "relation", path: ["branch"] },

  // ============ 有意不属任何租户 ============
  OtpAttempt: {
    kind: "none",
    reason: "登录前的手机验证码：那时还不知道（也不该知道）这个人属于哪家店；表里只有手机号哈希与限流信息",
  },
};

/** 需要收窄的全部模型（不含 none/shared）。P2 的强制层按此判断"这张表要不要带租户条件"。 */
export function tenantScopedModels(): string[] {
  return Object.entries(TENANT_SCOPE)
    .filter(([, v]) => v.kind === "column" || v.kind === "relation")
    .map(([k]) => k);
}

/**
 * 生成某模型在给定租户下的 Prisma `where` 片段。
 * 返回 `null` 表示该模型**有意不属任何租户**（调用方自行决定放行策略，不要默认放行）。
 */
export function tenantWhere(model: string, organisationId: string): Record<string, unknown> | null {
  const entry = TENANT_SCOPE[model];
  if (!entry) throw new Error("TENANT_SCOPE 未登记模型：" + model);
  if (entry.kind === "none" || entry.kind === "shared") return null;
  if (entry.kind === "column") return { organisationId };
  // 逐层包成嵌套关系过滤：["branch"] → { branch: { organisationId } }
  let node: Record<string, unknown> = { organisationId };
  for (let i = entry.path.length - 1; i >= 0; i--) node = { [entry.path[i]]: node };
  return node;
}
