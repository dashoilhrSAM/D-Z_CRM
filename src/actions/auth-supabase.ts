"use server";

import { headers } from "next/headers";
import { db } from "@/lib/db";
import { createClient } from "@/lib/supabase/server";
import { generateQrToken } from "@/lib/qr-token";
import { normalizePhoneLoose, combinePhone, digitsOnly, matchKey, phoneDigits, toE164, fmtStoredPhone } from "@/lib/phone";
import { evaluateOtpRate, isAllowedPhone, normalizeToE164, snapshotOtpUse } from "@/lib/otp";
import type { Customer } from "@prisma/client";

/** 业务身份（JWT claims）——A2 RLS 读取 request.jwt.claims 依赖这些字段。 */
export interface BizClaims {
  orgId: string;
  branchId: string;
  role: string;
  userId: string;
  customerId: string;
}

/** 登录后把业务身份写入 Supabase user_metadata（进 JWT claims）。 */
export async function injectBizClaims(authUserId: string) {
  const supabase = await createClient();
  // 先查员工，再查顾客（rider）
  const staff = await db.user.findUnique({ where: { authId: authUserId } });
  if (staff) {
    const claims: BizClaims = {
      orgId: staff.organisationId,
      branchId: staff.branchId ?? "",
      role: staff.role,
      userId: staff.id,
      customerId: "",
    };
    const { error } = await supabase.auth.updateUser({ data: claims });
    if (error) return { ok: false as const, error: error.message };
    return { ok: true as const, claims };
  }
  const rider = await db.customer.findUnique({ where: { authId: authUserId } });
  if (rider) {
    const claims: BizClaims = {
      orgId: rider.organisationId,
      branchId: rider.branchId ?? "",
      role: "CUSTOMER",
      userId: "",
      customerId: rider.id,
    };
    const { error } = await supabase.auth.updateUser({ data: claims });
    if (error) return { ok: false as const, error: error.message };
    return { ok: true as const, claims };
  }
  // auth 用户尚未关联业务账号——管理员需先绑定（A3.7 建测试用户时做）
  return { ok: false as const, error: "No D&Z account linked to this auth user." };
}

/** Service-role admin client（建号/查号/注入 claims 用，server-only）。 */
async function createAdminClient() {
  const { createClient } = await import("@supabase/supabase-js");
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );
}

/** 手机号 → Customer.phone（归一化匹配）→ authId。 */
async function customerByPhone(local: string): Promise<(Pick<Customer, "id" | "phone" | "authId" | "organisationId" | "branchId" | "gender"> & { email: string | null }) | null> {
  const candidates = await db.customer.findMany({ where: { phone: { not: null } }, select: { id: true, phone: true, authId: true, email: true, organisationId: true, branchId: true, gender: true } });
  return candidates.find((c) => matchKey(c.phone) === matchKey(normalizePhoneLoose(local))) ?? null;
}

/**
 * 登录：email（workshop/rider）或手机号（rider，identifier 二选一）。
 * - email：直接 signInWithPassword
 * - 手机号：Customer.phone → authId → auth email（兼容现有 email 账号）；phone-only 用户走 Supabase phone
 */
export async function signInWithPassword(input: { email?: string; identifier?: string; countryCode?: string; password: string }) {
  const supabase = await createClient();
  let email = input.email;
  let phone: string | undefined;

  const id = (input.identifier ?? "").trim();
  if (id) {
    if (id.includes("@")) {
      email = id.toLowerCase();
    } else {
      // 任意格式手机号（放宽）+ 可选区号；组合成 E.164 找号
      const cc = input.countryCode?.trim() || "+60";
      const full = combinePhone(cc, id);
      if (digitsOnly(full).length < 7) return { ok: false as const, error: "Invalid phone number — enter at least 7 digits." };
      const local = normalizePhoneLoose(full);
      const cust = await customerByPhone(local);
      if (!cust) return { ok: false as const, error: "No account found with this phone number — try signing up." };
      if (!cust.authId) return { ok: false as const, error: "No D&Z account linked to this phone." };
      const admin = await createAdminClient();
      const { data: au, error: auErr } = await admin.auth.admin.getUserById(cust.authId);
      if (auErr || !au.user) return { ok: false as const, error: "Could not resolve account — contact the workshop." };
      if (au.user.email) email = au.user.email;
      else phone = full; // phone-only 用户（需 Supabase Phone provider 开启）
    }
  }

  const { data, error } = email
    ? await supabase.auth.signInWithPassword({ email, password: input.password })
    : await supabase.auth.signInWithPassword({ phone: phone!, password: input.password });
  if (error) return { ok: false as const, error: error.message };
  if (!data.user) return { ok: false as const, error: "No user returned." };
  // 关联业务身份 → 注入 claims
  const linked = await injectBizClaims(data.user.id);
  if (!linked.ok) return { ok: false as const, error: linked.error };
  let hasBike = false;
  if (linked.claims.customerId) {
    hasBike = (await db.motorcycle.count({ where: { customerId: linked.claims.customerId } })) > 0;
  }
  return { ok: true as const, role: linked.claims.role, hasBike };
}

export async function signInWithOtp(input: { email: string }) {
  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithOtp({ email: input.email });
  if (error) return { ok: false as const, error: error.message };
  return { ok: true as const };
}

export async function verifyOtp(input: { email: string; token: string }) {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.verifyOtp({ email: input.email, token: input.token, type: "email" });
  if (error) return { ok: false as const, error: error.message };
  if (!data.user) return { ok: false as const, error: "No user returned." };
  const linked = await injectBizClaims(data.user.id);
  if (!linked.ok) return { ok: false as const, error: linked.error };
  let hasBike = false;
  if (linked.claims.customerId) {
    hasBike = (await db.motorcycle.count({ where: { customerId: linked.claims.customerId } })) > 0;
  }
  return { ok: true as const, role: linked.claims.role, hasBike };
}

/**
 * Rider 顾客自助注册：手机号必填 + 邮箱选填。
 * - 手机号：必填，归一化匹配老客 Customer.phone → 绑定 authId（老客注册）；无老客则新建 Customer。
 * - 邮箱：选填；填了用邮箱建 auth（登录双通道）；没填 → 老客有 email 用老客 email；否则 phone-only（登录需 Supabase Phone provider）。
 */
export async function signUpRider(input: { name: string; phone?: string; countryCode?: string; email?: string; gender?: string; password: string }) {
  const name = input.name.trim();
  const gender = input.gender === "M" || input.gender === "F" ? input.gender : null;
  if (name.length < 2) return { ok: false as const, error: "Please enter your name." };
  if (input.password.length < 8) return { ok: false as const, error: "Password must be at least 8 characters." };

  // 手机号：任意格式只要含数字（放宽）；区号默认 +60；组合成 E.164 完整号
  const cc = input.countryCode?.trim() || "+60";
  const fullPhone = combinePhone(cc, input.phone ?? "");
  if (digitsOnly(fullPhone).length < 7) return { ok: false as const, error: "Enter a valid phone number." };
  const phoneLocal = normalizePhoneLoose(fullPhone);
  // 邮箱选填（去空格小写；空则 undefined）
  let email = input.email?.trim().toLowerCase() || undefined;
  if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { ok: false as const, error: "Invalid email address." };

  const admin = await createAdminClient();

  // 老客匹配：手机号 → Customer.phone（老客注册，绑定 authId）
  const existing = await customerByPhone(phoneLocal);
  // 老客有 email 且本次未填 → 用老客 email 建 auth（保持双通道同一账号）
  if (!email && existing?.email) email = existing.email;
  // 重复检测
  if (email) {
    const dup = await db.customer.findFirst({ where: { email } });
    if (dup?.authId) return { ok: false as const, error: "An account with this email already exists — try signing in." };
  } else if (existing?.authId) {
    return { ok: false as const, error: "An account with this phone already exists — try signing in." };
  }

  // 测试域 / 开发环境：admin API 直建 + 自动确认（免 signUp 邮件限流、免点确认邮件）；phone 注册一律自动确认
  const isTestEmail = email ? /@dz\.my$/.test(email) || email.startsWith("test.") || email.startsWith("dztest") || email.startsWith("autoconf") : false;
  const wantAutoConfirm = process.env.NODE_ENV !== "production" || isTestEmail || !email;
  const phoneE164 = fullPhone; // 已有 E.164（combinePhone 结果），供 Supabase phone 登录/创建

  // 1. 建 auth 用户
  let authUserId: string | undefined;
  let autoSession = false;

  if (wantAutoConfirm) {
    const { data: ad, error: aErr } = email
      ? await admin.auth.admin.createUser({ email, password: input.password, email_confirm: true, user_metadata: { name } })
      : await admin.auth.admin.createUser({ phone: phoneE164, password: input.password, phone_confirm: true, user_metadata: { name } });
    if (aErr) {
      if (/already registered|already been registered|email.*exist|phone.*exist|phone number.*exist/i.test(aErr.message)) {
        return { ok: false as const, error: "An account with this " + (email ? "email" : "phone") + " already exists — try signing in." };
      }
      return { ok: false as const, error: aErr.message };
    }
    authUserId = ad.user.id;
    autoSession = true;
  } else {
    const supabase = await createClient();
    const { data, error } = await supabase.auth.signUp({
      email: email!,
      password: input.password,
      options: { data: { name } },
    });
    if (error) return { ok: false as const, error: error.message };
    authUserId = data.user?.id;
    autoSession = !!data.session;
    if (!authUserId) return { ok: false as const, error: "Sign-up failed — try again." };
  }

  // 2. 绑定 Customer：老客（phone/email 匹配）→ 绑 authId；新客 → 创建
  try {
    let customer = existing ?? (email ? await db.customer.findFirst({ where: { email } }) : null);
    if (!customer) {
      const org = await db.organisation.findFirst({ orderBy: { name: "asc" } });
      if (!org) return { ok: false as const, error: "No workshop organisation configured." };
      customer = await db.customer.create({
        data: { organisationId: org.id, name, email: email ?? null, phone: fullPhone || undefined, gender, authId: authUserId, qrToken: generateQrToken() },
      });
    } else if (!customer.authId) {
      customer = await db.customer.update({
        where: { id: customer.id },
        data: { authId: authUserId, ...(fullPhone && !customer.phone ? { phone: fullPhone } : {}), ...(email && !customer.email ? { email } : {}), ...(gender && !customer.gender ? { gender } : {}) },
      });
    }

    // 3. 注入 CUSTOMER claims（RLS 用）
    const claims: BizClaims = {
      orgId: customer.organisationId,
      branchId: customer.branchId ?? "",
      role: "CUSTOMER",
      userId: "",
      customerId: customer.id,
    };
    const { error: metaErr } = await admin.auth.admin.updateUserById(authUserId, { user_metadata: claims });
    if (metaErr) return { ok: false as const, error: "Account created but linking failed: " + metaErr.message };
  } catch (e) {
    return { ok: false as const, error: "Account created but profile setup failed: " + String((e as Error).message).slice(0, 120) };
  }

  // admin 建号无客户端 session——自动登录（密码登录建立 cookie session）
  if (autoSession) {
    const supabase = await createClient();
    const { error: signInErr } = email
      ? await supabase.auth.signInWithPassword({ email, password: input.password })
      : await supabase.auth.signInWithPassword({ phone: phoneE164!, password: input.password });
    if (signInErr) return { ok: true as const, emailConfirm: false, signInFailed: signInErr.message };
  }

  // 已自动确认（前端直接跳转）；非测试域（email confirm 开启）提示查邮件
  return { ok: true as const, emailConfirm: !autoSession };
}

export async function signOutSupabase() {
  const supabase = await createClient();
  await supabase.auth.signOut();
}

/** 当前 Supabase 用户（middleware 已刷新 session）。 */
export async function getSupabaseUser() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  return user;
}

// ============================================================================
// 手机验证码（OTP）注册 / 登录 —— rider 专用
// ============================================================================
//
// 链路：requestRiderPhoneOtp（限流 + 预写审计）→ Supabase 生成验证码 →
// Send SMS Hook（/api/hooks/send-sms）→ 我们的 SMS provider 真发 →
// verifyRiderPhoneOtp（验码 + 绑定/认领 Customer + 注入 claims）。
//
// 与密码登录的三点关键差异，都是刻意的：
//  ① **验证码是手机号归属的证明**，而密码不是。历史代码用 admin API 带 phone_confirm:true 建号，
//     等于"手机号从未被验证"就允许用它登录；OTP 之后 CustomerAuthProfile.phoneVerified 才第一次有真值。
//  ② **老客认领**：Customer.authId 为空的历史客户（seed 出来的那批），验证手机号即可把档案绑定到
//     自己的账号——这是 OTP 顺带解决的一个真实问题（他们今天没有任何登录方式）。
//  ③ 已有**邮箱账号**的客户不能用 OTP 登录：Supabase 的手机验证码会新建一个 auth 用户而不是合并身份，
//     那样同一个客户会同时存在两个账号。这种情况明确拒绝并引导用邮箱登录，不做静默合并。

/** 来源 IP 的哈希（加盐）。审计表里存哈希不存原文：那张表已经有手机号，
 *  再落一份原始 IP 就能直接拼出可画像的数据集，而限流只需要"是不是同一个人"。 */
async function clientIpHash(): Promise<string | null> {
  const h = await headers();
  const ip = (h.get("x-forwarded-for") ?? "").split(",")[0]?.trim() || h.get("x-real-ip") || "";
  if (!ip) return null;
  const crypto = (await import("node:crypto")).default;
  return crypto.createHash("sha256").update((process.env.AUTH_SECRET ?? "") + "|" + ip).digest("hex").slice(0, 32);
}

/** 读最近窗口内的事件时间戳 → 纯函数判定（判定逻辑在 lib/otp，可单测）。 */
async function otpRateCheck(phoneE164: string, ipHash: string | null) {
  const now = new Date();
  const dayAgo = new Date(now.getTime() - 24 * 3600 * 1000);
  const hourAgo = new Date(now.getTime() - 3600 * 1000);
  const [phoneRows, ipRows] = await Promise.all([
    db.otpAttempt.findMany({ where: { phoneE164, createdAt: { gte: dayAgo } }, select: { createdAt: true } }),
    ipHash
      ? db.otpAttempt.findMany({ where: { ipHash, createdAt: { gte: hourAgo } }, select: { createdAt: true } })
      : Promise.resolve([] as { createdAt: Date }[]),
  ]);
  return evaluateOtpRate(snapshotOtpUse(phoneRows.map((r) => r.createdAt), ipRows.map((r) => r.createdAt), now));
}

/**
 * 请求验证码。purpose 区分注册与登录，因为二者的前置条件不同：
 *  · LOGIN  —— 必须已存在这个号码的客户档案；且若该客户已有邮箱账号，直接拒绝（见文件头 ③）。
 *  · SIGNUP —— 号码已绑定账号时拒绝（提示去登录），否则允许建号。
 */
export async function requestRiderPhoneOtp(input: {
  phone: string;
  countryCode?: string;
  purpose: "LOGIN" | "SIGNUP";
}) {
  const cc = input.countryCode?.trim() || "+60";
  const e164 = normalizeToE164(cc, input.phone);
  if (!e164) return { ok: false as const, error: "Enter a valid phone number." };
  if (!isAllowedPhone(e164)) {
    return { ok: false as const, error: "SMS codes are currently sent to Malaysian numbers (+60) only." };
  }

  const existing = await customerByPhone(normalizePhoneLoose(e164));

  if (input.purpose === "LOGIN") {
    if (!existing) return { ok: false as const, error: "No account found with this phone number — try signing up." };
    if (existing.authId) {
      // 已有 Supabase 账号：只有它自己就绑着这个号码，才允许用验证码登录。
      const admin = await createAdminClient();
      const { data: au, error: auErr } = await admin.auth.admin.getUserById(existing.authId);
      if (auErr || !au.user) return { ok: false as const, error: "Could not resolve account — contact the workshop." };
      if (!au.user.phone) {
        return {
          ok: false as const,
          error: "This number belongs to an account that signs in with email. Please use the email tab, or contact the workshop.",
        };
      }
      if (au.user.phone !== e164) {
        return { ok: false as const, error: "This number is linked to a different login. Please contact the workshop." };
      }
    }
  } else if (existing?.authId) {
    return { ok: false as const, error: "An account with this phone already exists — try signing in." };
  }

  const ipHash = await clientIpHash();
  const rate = await otpRateCheck(e164, ipHash);
  if (!rate.allow) return { ok: false as const, error: rate.message };

  // 先写审计行（这就是限流的计数依据）：即使 Supabase 调用失败也留下痕迹。
  const attempt = await db.otpAttempt.create({
    data: { phoneE164: e164, purpose: input.purpose, ipHash, status: "REQUESTED" },
  });

  const supabase = await createClient();
  // 老客未绑定账号时 Supabase 里还没有这个用户，必须允许创建（下一步 verify 会把档案认领过来）。
  const shouldCreateUser = input.purpose === "SIGNUP" || !existing?.authId;
  const { error } = await supabase.auth.signInWithOtp({ phone: e164, options: { shouldCreateUser } });
  if (error) {
    await db.otpAttempt.update({
      where: { id: attempt.id },
      data: { status: "FAILED", error: error.message.slice(0, 200) },
    });
    return { ok: false as const, error: error.message };
  }
  return { ok: true as const };
}

/**
 * 校验验证码。成功即建立 session，然后：
 *  · 号码已属于某个客户档案 → 认领（authId 为空时绑定）或登录；
 *  · 号码全新 → 标记 needsProfile，由 UI 引导补全姓名（客户档案在补全时创建）。
 */
export async function verifyRiderPhoneOtp(input: { phone: string; countryCode?: string; token: string }) {
  const cc = input.countryCode?.trim() || "+60";
  const e164 = normalizeToE164(cc, input.phone);
  const token = input.token.trim();
  if (!e164) return { ok: false as const, error: "Enter a valid phone number." };
  if (!/^\d{4,8}$/.test(token)) return { ok: false as const, error: "Enter the code from the SMS." };

  const supabase = await createClient();
  const { data, error } = await supabase.auth.verifyOtp({ phone: e164, token, type: "sms" });
  if (error) return { ok: false as const, error: error.message };
  if (!data.user) return { ok: false as const, error: "No user returned." };

  await db.otpAttempt.updateMany({
    where: { phoneE164: e164, verifiedAt: null },
    data: { verifiedAt: new Date() },
  });

  const cust = await customerByPhone(normalizePhoneLoose(e164));

  if (!cust) {
    // 新号码：档案在"补全资料"那一步创建（此时才有姓名）。
    return { ok: true as const, needsProfile: true as const, role: "CUSTOMER" as const, hasBike: false };
  }

  if (cust.authId && cust.authId !== data.user.id) {
    // 号码属于另一个登录身份——不许静默改写绑定，否则等于把别人的客户档案挂到这个新账号上。
    await supabase.auth.signOut();
    return { ok: false as const, error: "This phone is linked to another login. Please contact the workshop." };
  }

  if (!cust.authId) {
    // 老客认领：验证码证明了号码归属，把历史档案绑到当前账号。
    await db.customer.update({ where: { id: cust.id }, data: { authId: data.user.id } });
  }
  await db.customerAuthProfile.upsert({
    where: { customerId: cust.id },
    create: { customerId: cust.id, phoneVerified: true },
    update: { phoneVerified: true },
  });

  const linked = await injectBizClaims(data.user.id);
  if (!linked.ok) return { ok: false as const, error: linked.error };
  const hasBike = (await db.motorcycle.count({ where: { customerId: cust.id } })) > 0;
  return { ok: true as const, needsProfile: false as const, role: linked.claims.role, hasBike };
}

/** 手机验证码注册的最后一步：补全姓名（可选性别/邮箱），创建或认领 Customer 档案。 */
export async function completeRiderPhoneSignup(input: { name: string; gender?: string; email?: string }) {
  const name = input.name.trim();
  const gender = input.gender === "M" || input.gender === "F" ? input.gender : null;
  const email = input.email?.trim().toLowerCase() || null;
  if (name.length < 2) return { ok: false as const, error: "Please enter your name." };
  if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return { ok: false as const, error: "Invalid email address." };
  }

  // 身份来自 session（验证码已验证过的那个账号），不接受客户端传入的手机号——
  // 否则任何人都能给别人的号码建档案。
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false as const, error: "Session expired — request a new code." };
  const phone = user.phone;
  if (!phone) return { ok: false as const, error: "This session has no verified phone number." };

  if (email) {
    const dup = await db.customer.findFirst({ where: { email } });
    if (dup && dup.authId && dup.authId !== user.id) {
      return { ok: false as const, error: "An account with this email already exists — try signing in." };
    }
  }

  try {
    let customer = await db.customer.findUnique({ where: { authId: user.id } });
    if (!customer) {
      const byPhone = await customerByPhone(normalizePhoneLoose(phone));
      if (byPhone?.authId && byPhone.authId !== user.id) {
        return { ok: false as const, error: "This phone is linked to another login. Please contact the workshop." };
      }
      if (byPhone) {
        customer = await db.customer.update({
          where: { id: byPhone.id },
          data: {
            authId: user.id,
            ...(byPhone.phone ? {} : { phone }),
            ...(email && !byPhone.email ? { email } : {}),
            ...(gender && !byPhone.gender ? { gender } : {}),
          },
        });
      } else {
        const org = await db.organisation.findFirst({ orderBy: { name: "asc" } });
        if (!org) return { ok: false as const, error: "No workshop organisation configured." };
        customer = await db.customer.create({
          data: {
            organisationId: org.id,
            name,
            phone,
            email,
            gender,
            authId: user.id,
            qrToken: generateQrToken(),
          },
        });
      }
    }
    await db.customerAuthProfile.upsert({
      where: { customerId: customer.id },
      create: { customerId: customer.id, phoneVerified: true },
      update: { phoneVerified: true },
    });
    const linked = await injectBizClaims(user.id);
    if (!linked.ok) return { ok: false as const, error: linked.error };
    return { ok: true as const, role: linked.claims.role, hasBike: false };
  } catch (e) {
    return { ok: false as const, error: "Profile setup failed: " + String((e as Error).message).slice(0, 120) };
  }
}