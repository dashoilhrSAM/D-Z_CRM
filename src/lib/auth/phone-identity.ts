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

/** 同一号码命中的**全部**客户档案。Customer.phone 没有唯一约束，重复号会造成"登进哪一个"的歧义，
 *  所以调用方要显式拒绝（让人去后台合并），不要静默挑第一个。 */
export async function customersByPhone(local: string) {
  const key = matchKey(normalizePhoneLoose(local));
  if (!key) return [];
  const candidates = await db.customer.findMany({
    where: { phone: { not: null } },
    select: { id: true, phone: true, authId: true, name: true, email: true, gender: true },
  });
  return candidates.filter((c) => matchKey(c.phone) === key);
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
