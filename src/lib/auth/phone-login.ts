// 手机号 → 账号归属的**纯判定**（无 IO，可单测）。
//
// 背景（2026-09-23 线上实测）：Supabase 的手机验证码默认会给新号码**新建一个独立身份**。
// 因此当客户已经有邮箱账号时（Customer.authId 指向一个 email 用户），如果他改用手机号登录，
// Supabase 会造出第二个 auth 用户——同一个人两个账号，而 Customer.authId 只能指向其中一个。
//
// 我最初的应对是"已有邮箱账号就拒绝手机登录"，结果是把三个真实客户挡在门外（线上实测：
// Ahmad / JYTest / Muhammad 全被拒）。正确的做法是在**发码之前**把号码挂到他已有的账号上：
//   admin.updateUserById(authId, { phone, phone_confirm: true })   // 不会发短信
// 之后 signInWithOtp / verifyOtp 命中的就是他本人，邮箱与密码登录也照旧可用。
//
// 本文件只回答"该怎么挂"，不碰网络：判定与实际调用分开，规则才可被测试钉住。
// 三种情况：
//   ① 客户还没绑定账号（authId 为空）→ 让 Supabase 建/找一个手机账号，验码后再认领档案；
//   ② 号码当前挂在他自己的账号上（或没人占用）→ 直接挂到他账号上；
//   ③ 号码被**别人**的账号占着 → 分两种：那是个孤儿账号（没有任何客户指向它）就删掉它再挂；
//      若它已被另一个客户绑定，就**不能动**（那是别人的账号），报冲突让人工处理。

export type PhoneLoginPlan =
  | { action: "attach"; authUserId: string; deleteOrphanAuthUserId?: string }
  | { action: "create" }
  | { action: "conflict"; reason: "phone-held-by-another-customer" };

export interface PhoneLoginInput {
  /** 该手机号对应客户已绑定的 auth 用户（Customer.authId），没有则 null */
  customerAuthId: string | null;
  /** 当前在 Supabase 里占着这个号码的 auth 用户，没有则 null */
  phoneHolderAuthId: string | null;
  /** 占用者是否已经被**另一个**客户绑定 */
  holderBelongsToAnotherCustomer: boolean;
}

export function planPhoneLogin(input: PhoneLoginInput): PhoneLoginPlan {
  const { customerAuthId, phoneHolderAuthId, holderBelongsToAnotherCustomer } = input;

  // ① 老客尚未绑定账号：走"建号 + 验码后认领"的老路
  if (!customerAuthId) return { action: "create" };

  // ② 没人占，或占的就是他自己的账号
  if (!phoneHolderAuthId || phoneHolderAuthId === customerAuthId) {
    return { action: "attach", authUserId: customerAuthId };
  }

  // ③ 号码在别人的账号上
  if (holderBelongsToAnotherCustomer) {
    return { action: "conflict", reason: "phone-held-by-another-customer" };
  }
  // 孤儿账号（早期手机登录流程留下的，没有任何客户指向它）→ 删掉再挂到他账号上。
  // 不删的话 Supabase 会因为号码唯一而拒绝把号码挂到他账号上。
  return { action: "attach", authUserId: customerAuthId, deleteOrphanAuthUserId: phoneHolderAuthId };
}

/** 用户的手机号在 Supabase 里可能存成 "60111111111"（不带 +），这里统一成纯数字比较。 */
export function sameMsisdn(a: string | null | undefined, b: string | null | undefined): boolean {
  const da = (a ?? "").replace(/\D/g, "");
  const db = (b ?? "").replace(/\D/g, "");
  if (!da || !db) return false;
  // 马来号码的两种常见写法（60… 与 0…）视为同一个：60 + 9/10 位 ↔ 0 + 9/10 位
  const canon = (d: string) => (d.startsWith("60") && d.length >= 11 ? "0" + d.slice(2) : d);
  return canon(da) === canon(db);
}
