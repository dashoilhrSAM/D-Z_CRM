/**
 * 「这次请求属于哪家店」——**入口级**租户解析（注册、补全资料、短信验证码）。
 *
 * 为什么必须单独有这个文件：P3b 施工前，注册路径里"哪家店"的答案是
 *   `db.organisation.findFirst({ orderBy: { name: "asc" } })`
 * —— 两家店并存时这是**按字母序抛硬币**。这不是理论风险，本地就是活的：
 * dev.db 里 10 家组织有 9 家是测试残留的空壳（0 门店 / 0 客户 / 0 工单），
 * 按名字排序胜出的正是 `BULK-blkmueyf5dv`，于是本地注册会进一家空壳店。
 *
 * 三级来源，顺序不可调换：
 *   ① **显式 slug**（`/t/<slug>` 路由 —— P3b 第 4 步接上；本文件先把入口留好）
 *   ② **签名**的 `dz_tenant` cookie（用户上次选过的店；见 active-tenant.ts，客户端改不动）
 *   ③ 兜底：平台里**恰好只有一家在运营的门店**时用它（今天生产/单店就是这个形状）
 *
 * 三者都不成立就**拒绝**，绝不猜。多店并存时"没有指明门店的注册"本身没有正确答案，
 * 静默挑一家是这类系统最典型的串店 bug —— 与 identity.ts 里
 * "≥2 条时必须让用户选，绝不静默挑一个"是同一条规则。
 *
 * ⚠️ 这里只回答"注册到哪家店"。它**不**回答"这个人有权进哪家店"——那是 AuthLink 的事
 * （identity.ts），两者不能互相代替。
 */
import { db } from "@/lib/db";
import { readActiveTenant, type ActiveTenant } from "@/lib/tenant/active-tenant";

export type EntryTenantSource = "slug" | "cookie" | "sole";

export interface EntryTenant {
  organisationId: string;
  slug: string | null;
  source: EntryTenantSource;
}

export type EntryTenantFailure = "NO_TENANT" | "AMBIGUOUS" | "UNKNOWN_SLUG" | "SUSPENDED";

export type EntryTenantResult =
  | ({ ok: true } & EntryTenant)
  | { ok: false; code: EntryTenantFailure; error: string };

/** 组织是否在运营。SUSPENDED 一律拒绝；未知取值按"不在运营"处理（fail-closed）。 */
function isOperating(status: string): boolean {
  return status === "ACTIVE" || status === "TRIAL";
}

/** 候选门店：`hasBranch` = 它底下确实有一家门店记录（Branch 是租户的 1:1 门店）。 */
export interface TenantCandidate {
  id: string;
  slug: string | null;
  status: string;
  hasBranch: boolean;
}

export type SoleTenantPick =
  | { ok: true; tenant: TenantCandidate }
  | { ok: false; reason: "NONE" | "MANY" };

/**
 * 纯判定：从候选里挑出**唯一**可以兜底的门店。
 *
 * 两步是有意分开的：
 *   ① 优先只在"确实有门店记录"的运营组织中找唯一一家 —— 测试残留的空壳组织
 *      （只有 Organisation 行、没有 Branch）不该参与兜底，否则单店部署会被它们变成"多店"。
 *   ② 一家有门店的组织都没有时，才退回"运营组织恰好一家"。
 * 任何一步出现 ≥2 家都返回 MANY —— 那时只能让用户走 `/t/<slug>`，不许猜。
 */
export function pickSoleTenant(candidates: TenantCandidate[]): SoleTenantPick {
  const operating = candidates.filter((c) => isOperating(c.status));
  const withBranch = operating.filter((c) => c.hasBranch);
  if (withBranch.length === 1) return { ok: true, tenant: withBranch[0] };
  if (withBranch.length === 0 && operating.length === 1) return { ok: true, tenant: operating[0] };
  return { ok: false, reason: operating.length === 0 ? "NONE" : "MANY" };
}

const MESSAGES: Record<EntryTenantFailure, string> = {
  NO_TENANT: "No workshop is set up yet — please contact the workshop.",
  AMBIGUOUS:
    "We could not tell which workshop this sign-up belongs to. Please open your workshop's own link and try again.",
  UNKNOWN_SLUG: "This workshop link is not valid.",
  SUSPENDED: "This workshop is not accepting sign-ups right now.",
};

function fail(code: EntryTenantFailure): EntryTenantResult {
  return { ok: false, code, error: MESSAGES[code] };
}

/**
 * 可测的解析主体：cookie 值由调用方传入（`readActiveTenant()` 依赖请求上下文，
 * 在测试里调不了 —— 把 IO 与判定分开，测的才是真逻辑）。
 */
export async function resolveEntryTenantFor(input: {
  slug?: string | null;
  cookieTenant?: ActiveTenant | null;
}): Promise<EntryTenantResult> {
  const slug = input.slug?.trim();
  if (slug) {
    const org = await db.organisation.findUnique({ where: { slug }, select: { id: true, slug: true, status: true } });
    if (!org) return fail("UNKNOWN_SLUG");
    if (!isOperating(org.status)) return fail("SUSPENDED");
    return { ok: true, organisationId: org.id, slug: org.slug, source: "slug" };
  }

  const cookieOrgId = input.cookieTenant?.organisationId;
  if (cookieOrgId) {
    const org = await db.organisation.findUnique({
      where: { id: cookieOrgId },
      select: { id: true, slug: true, status: true },
    });
    // 组织被停用 → 明确拒绝，不要"顺手"把人注册到别家店去
    if (org && !isOperating(org.status)) return fail("SUSPENDED");
    // 组织已不存在（cookie 早于删除）→ 当作没选过，继续走兜底
    if (org) return { ok: true, organisationId: org.id, slug: org.slug, source: "cookie" };
  }

  const rows = await db.organisation.findMany({
    where: { status: { in: ["ACTIVE", "TRIAL"] } },
    select: { id: true, slug: true, status: true, branches: { select: { id: true }, take: 1 } },
    orderBy: { createdAt: "asc" },
  });
  const pick = pickSoleTenant(
    rows.map((r) => ({ id: r.id, slug: r.slug, status: r.status, hasBranch: r.branches.length > 0 })),
  );
  if (!pick.ok) return fail(pick.reason === "NONE" ? "NO_TENANT" : "AMBIGUOUS");
  return { ok: true, organisationId: pick.tenant.id, slug: pick.tenant.slug, source: "sole" };
}

/**
 * 生产入口：读签名 cookie 后委托给 `resolveEntryTenantFor`。
 * `slug` 由将来的 `/t/<slug>` 路由传入（P3b 第 4 步），今天传 null。
 */
export async function resolveEntryTenant(input?: { slug?: string | null }): Promise<EntryTenantResult> {
  return resolveEntryTenantFor({ slug: input?.slug, cookieTenant: await readActiveTenant() });
}
