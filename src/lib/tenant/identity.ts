/**
 * 认证身份 → 业务身份的解析（P3）。
 *
 * 背景：`User.authId` / `Customer.authId` 是**全局唯一**的，所以"同一个人在两家店
 * 各有一个客户档案"在数据模型上表达不出来。而 `AuthLink` 把"一个 auth 账号"与
 * "他在某一家店的业务身份"拆成了两件事：
 *
 *   一个自然人 = 一个 Supabase auth 账号（邮箱/手机在项目内唯一，这是 Supabase 的现实）
 *   他在 N 家店   = N 条 AuthLink + N 个业务主体
 *
 * **跨店共享的是登录凭证，不是客户数据** —— 这才是"每个 workshop 独立、customer 不共用"
 * 的正确形状。两家店的客户档案互不可见，同一个人要在两家店各留一次资料。
 *
 * 两条解析路径，对应两个不同的场景：
 *   · `identityInTenant(authId, orgId)` —— **已知门店**时用。登录页带上门店、或骑手扫码进来。
 *   · `identitiesForAuthUser(authId)`   —— **不知道门店**时用。邮箱在多家店都有账号，
 *     这时必须**列出来让人选**，绝不静默挑一个（静默挑第一个是这类系统最典型的串店 bug）。
 */
import { db } from "@/lib/db";

export type LinkKind = "STAFF" | "CUSTOMER";

export interface ResolvedIdentity {
  authId: string;
  organisationId: string;
  kind: LinkKind;
  /** kind=STAFF 时是 User.id */
  userId: string | null;
  /** kind=CUSTOMER 时是 Customer.id */
  customerId: string | null;
}

function toResolved(row: {
  authId: string;
  organisationId: string;
  kind: string;
  userId: string | null;
  customerId: string | null;
}): ResolvedIdentity {
  return {
    authId: row.authId,
    organisationId: row.organisationId,
    // 数据库里是自由字符串（加了唯一键约束但没加枚举），这里收窄成两类
    kind: row.kind === "STAFF" ? "STAFF" : "CUSTOMER",
    userId: row.userId,
    customerId: row.customerId,
  };
}

/**
 * 已知门店：这个 auth 账号**在本店**是谁。查不到返回 null。
 * 调用方拿到 null 应当拒绝，而不是回退到"跨店找唯一一条"——那正是串店的入口。
 */
export async function identityInTenant(authId: string, organisationId: string): Promise<ResolvedIdentity | null> {
  if (!authId || !organisationId) return null;
  const row = await db.authLink.findUnique({
    where: { authId_organisationId: { authId, organisationId } },
  });
  return row ? toResolved(row) : null;
}

/**
 * 不知道门店：这个 auth 账号在**哪几家店**有身份。
 * 返回 0 条 → 还没被邀请/注册；1 条 → 可以直接进；≥2 条 → **必须让用户选**。
 */
export async function identitiesForAuthUser(authId: string): Promise<ResolvedIdentity[]> {
  if (!authId) return [];
  const rows = await db.authLink.findMany({ where: { authId }, orderBy: { createdAt: "asc" } });
  return rows.map(toResolved);
}

/**
 * 是否需要让用户选门店。把"≥2 条"这个判断单独拿出来，
 * 是为了让调用方一眼看到**这是必须处理的正常情况**，而不是可以忽略的边界。
 */
export async function needsTenantChoice(authId: string): Promise<boolean> {
  return (await identitiesForAuthUser(authId)).length > 1;
}

/**
 * 建立/更新一条映射（幂等）。
 *
 * 用在两处：开通员工账号、骑手注册或扫码绑定门店。
 * 用 upsert 而不是 create —— 重复登录/重复绑定不该报错，也不该产生第二条。
 */
export async function linkIdentity(input: {
  authId: string;
  organisationId: string;
  kind: LinkKind;
  userId?: string | null;
  customerId?: string | null;
}): Promise<ResolvedIdentity> {
  const { authId, organisationId, kind } = input;
  if (!authId || !organisationId) throw new Error("linkIdentity: authId 与 organisationId 都必填");
  if (kind === "STAFF" && !input.userId) throw new Error("linkIdentity: STAFF 必须给 userId");
  if (kind === "CUSTOMER" && !input.customerId) throw new Error("linkIdentity: CUSTOMER 必须给 customerId");
  const row = await db.authLink.upsert({
    where: { authId_organisationId: { authId, organisationId } },
    create: {
      authId,
      organisationId,
      kind,
      userId: input.userId ?? null,
      customerId: input.customerId ?? null,
    },
    update: {
      kind,
      userId: input.userId ?? null,
      customerId: input.customerId ?? null,
    },
  });
  return toResolved(row);
}

/**
 * 员工账号的租户映射 —— **建 User、或给 User 绑上 authId 时必须调用**（幂等）。
 *
 * 为什么包一层而不直接在调用点写 `linkIdentity({kind: "STAFF"})`：
 * `kind` 与 `userId`/`customerId` 的搭配是易错处（给错就产出一条指向空用户的身份，
 * 而且它**不会报错**，只会让解析链在将来返回一个假身份）。包一层之后，
 * 调用点只需要回答"哪个人、哪家店"。
 *
 * ⚠️ 这张表是「这个 auth 账号属于哪几家店」的**唯一事实来源**（P3b 第 3 步的解析链读它）。
 * 漏写一条不会当场出错 —— 老账号因为 P3a 回填过所以照常登录，只有**新建**的账号
 * 将来会登不进去。所以每一处写 `User.authId` 的地方都必须配一条。
 */
export async function linkStaffIdentity(input: { authId: string; organisationId: string; userId: string }) {
  return linkIdentity({ authId: input.authId, organisationId: input.organisationId, kind: "STAFF", userId: input.userId, customerId: null });
}

/**
 * 骑手账号的租户映射 —— **建 Customer、或认领/绑定 authId 时必须调用**（幂等）。
 * 同 `linkStaffIdentity`：漏写 = 这个骑手将来登不进去。
 */
export async function linkCustomerIdentity(input: { authId: string; organisationId: string; customerId: string }) {
  return linkIdentity({ authId: input.authId, organisationId: input.organisationId, kind: "CUSTOMER", userId: null, customerId: input.customerId });
}
