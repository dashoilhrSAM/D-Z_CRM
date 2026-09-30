import "server-only";
import { db } from "@/lib/db";
import { matchKey, normalizePhoneLoose } from "@/lib/phone";
import { sameMsisdn, planPhoneLogin } from "@/lib/auth/phone-login";

// 手机号 → 账号归属的**执行侧**（判定侧是纯函数，见 lib/auth/phone-login.ts）。
//
// 为什么要独立成模块：这段逻辑有两个使用方——
//   ① 手机验证码注册/登录（actions/auth-supabase.ts）；
//   ② 骑手自助更换手机号（actions/rider-settings.ts）。
// 而 actions/*.ts 是 "use server" 文件，**里面导出的每个函数都会变成客户端可调用的 server action**
// —— 把 preparePhoneIdentity 从那里导出，等于给全世界一个"把任意号码挂到任意账号上"的接口。
// 所以执行逻辑必须住在普通 lib 模块里，由两个 action 各自引用同一份实现。

/** Service-role admin client（建号/查号/挂载号码用，server-only）。 */
export async function createAdminClient() {
  const { createClient } = await import("@supabase/supabase-js");
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );
}

/** 客户档案上"判断归属够用"的字段（两个匹配函数共用，避免两份 select 漂移）。 */
const CUSTOMER_MATCH_SELECT = {
  id: true,
  organisationId: true,
  branchId: true,
  phone: true,
  authId: true,
  name: true,
  email: true,
  gender: true,
};

/**
 * 同一号码在**本租户内**命中的全部客户档案。Customer.phone 没有唯一约束，重复号会造成
 * "登进哪一个"的歧义，所以调用方要显式拒绝（让人去后台合并），不要静默挑第一个。
 *
 * ⚠️ `organisationId` 是**必需参数**，不是可选过滤器 —— 这是刻意的：
 * 一旦松开 `Customer.authId` 全局唯一（P3b 第 2 步），"没有租户条件的手机匹配"
 * 就等于"在 B 店注册可以认领 A 店同号码的客户档案"（隐患 ②，见 MULTI_TENANT_PLAN §P3b）。
 * 做成必需参数后，漏掉租户的调用点会被 `tsc` 拦住，而不是靠人记得写。
 */
export async function customersByPhone(organisationId: string, local: string) {
  if (!organisationId) return [];
  const key = matchKey(normalizePhoneLoose(local));
  if (!key) return [];
  const candidates = await db.customer.findMany({
    where: { organisationId, phone: { not: null } },
    select: CUSTOMER_MATCH_SELECT,
  });
  return candidates.filter((c) => matchKey(c.phone) === key);
}

/**
 * ⚠️ **跨租户**的号码匹配 —— 只允许**登录入口**调用（今天全仓只有 `signInWithPassword` 一处）。
 *
 * 为什么登录还敢用跨租户匹配：这一步只回答"这个号码在哪儿"，随后仍要密码/验证码，
 * 且**不绑定任何档案**。P3b 第 3/4 步会把登录也收到解析链 + 多店选择器上，
 * 那时这个函数就该删掉 —— 所以它必须有一个显眼的名字，
 * 免得有人顺手在注册路径上用它（那正是隐患 ②）。
 */
export async function customersByPhoneAnyTenant(local: string) {
  const key = matchKey(normalizePhoneLoose(local));
  if (!key) return [];
  const candidates = await db.customer.findMany({
    where: { phone: { not: null } },
    select: CUSTOMER_MATCH_SELECT,
  });
  return candidates.filter((c) => matchKey(c.phone) === key);
}

/**
 * 本租户内按邮箱找客户档案 —— 注册路径的**唯一**邮箱匹配入口。
 *
 * 与 `customersByPhone` 同理：租户条件必须是必需的。今天它安全只是因为
 * `Customer.authId` 全局唯一兜住了；唯一键一松，无租户条件的邮箱匹配就是跨店劫持。
 *
 * ⚠️ `Customer.email` **没有**任何唯一约束（同表的 `authId` / `qrToken` 才有），
 * 所以租户内也可能命中多条，这里按 `findFirst` 取第一条 —— 与改造前的语义一致。
 * 收成 `@@unique([organisationId, email])` 是 P3b 第 5 步的事。
 */
export async function customerByEmailInTenant(organisationId: string, email: string) {
  if (!organisationId || !email) return null;
  return db.customer.findFirst({
    where: { organisationId, email },
    select: CUSTOMER_MATCH_SELECT,
  });
}

/**
 * 在 Supabase 里按手机号找 auth 用户。
 *
 * GoTrue 的 admin API 没有"按手机号查用户"的接口（只吃 id），只能列出来本地比对。
 * 当前客户规模（几十个）完全够用；等用户量上千，应改成维护一张 phone → authUserId 的映射表。
 */
export async function authUserByMsisdn(
  admin: Awaited<ReturnType<typeof createAdminClient>>,
  e164: string,
) {
  const { data, error } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (error) return { error: error.message as string };
  return { user: data.users.find((u) => sameMsisdn(u.phone, e164)) ?? null };
}

/**
 * 让这个号码能在 Supabase 里登录进**客户已有的账号**。
 *
 * 为什么需要它：Supabase 的手机验证码会给新号码建独立身份；对已有账号的客户，那等于同一个人两个账号，
 * 而 Customer.authId 只能指向一个。做法是先把号码挂到他账号上
 * （updateUserById + phone_confirm:true，**不会发短信**）。
 *
 * 判定规则全在 lib/auth/phone-login.ts 的 planPhoneLogin（纯函数、有单测）；这里只执行：
 *  · create   → 让 Supabase 建/找手机账号（新号码，或老客尚未绑定账号）
 *  · attach   → 把号码挂到他账号上；若号码被**孤儿**账号占着，先删掉孤儿（否则号码唯一性会挡）
 *  · conflict → 号码已被**另一个客户**的账号绑定：绝不动别人的账号，报错让人工处理
 */
export async function preparePhoneIdentity(
  e164: string,
  existing: { id: string; authId: string | null } | null,
) {
  const admin = await createAdminClient();
  const found = await authUserByMsisdn(admin, e164);
  if (found.error) return { ok: false as const, error: found.error };
  const holder = found.user;
  const holderLinked = holder
    ? await db.customer.findUnique({ where: { authId: holder.id }, select: { id: true } })
    : null;
  const plan = planPhoneLogin({
    customerAuthId: existing?.authId ?? null,
    phoneHolderAuthId: holder?.id ?? null,
    holderBelongsToAnotherCustomer: !!holderLinked && holderLinked.id !== existing?.id,
  });

  if (plan.action === "create") return { ok: true as const, shouldCreateUser: true };
  if (plan.action === "conflict") {
    return { ok: false as const, error: "This phone number is already used by another account. Please contact the workshop." };
  }
  if (plan.deleteOrphanAuthUserId) {
    const { error } = await admin.auth.admin.deleteUser(plan.deleteOrphanAuthUserId);
    if (error) return { ok: false as const, error: "Could not release this phone number: " + error.message };
  }
  const { error: upErr } = await admin.auth.admin.updateUserById(plan.authUserId, {
    phone: e164,
    phone_confirm: true,
  });
  if (upErr) return { ok: false as const, error: "Could not link this phone number: " + upErr.message };
  return { ok: true as const, shouldCreateUser: false };
}
