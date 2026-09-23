"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { getRiderCustomer } from "@/lib/rider-customer";
import { createClient } from "@/lib/supabase/server";
import { parsePrefs, type NotificationPrefs } from "@/lib/rider-prefs";
import { fmtStoredPhone, normalizePhoneLoose } from "@/lib/phone";
import { isAllowedPhone, maskPhone, normalizeToE164 } from "@/lib/otp";
import { sameMsisdn } from "@/lib/auth/phone-login";
import { customersByPhone, preparePhoneIdentity } from "@/lib/auth/phone-identity";
import { clientIpHash, otpRateCheck } from "@/lib/otp-rate";
import { markOtpVerified } from "@/lib/otp-attempt";

/**
 * 更新当前 rider 的通知偏好（authId 守卫，只能改自己）。
 */
export async function updateRiderNotificationPrefs(input: Partial<NotificationPrefs>) {
  const customer = await getRiderCustomer();
  if (!customer) return { ok: false as const, error: "Not signed in" };

  const next = { ...parsePrefs(customer.notificationPrefs), ...input };
  await db.customer.update({
    where: { id: customer.id },
    data: { notificationPrefs: next },
  });
  revalidatePath("/", "layout");
  return { ok: true as const };
}

/**
 * 更换密码（Settings → Security）：先用当前密码校验身份，再更新 Supabase 密码。
 * 改密后当前 session 保持，其他设备 session 失效（Supabase 行为）。
 */
export async function changeRiderPassword(input: { currentPassword: string; newPassword: string }) {
  const customer = await getRiderCustomer();
  if (!customer) return { ok: false as const, error: "Not signed in" };
  if (!customer.email) return { ok: false as const, error: "No email on file — contact the workshop." };

  const newPassword = input.newPassword;
  if (newPassword.length < 8) return { ok: false as const, error: "New password must be at least 8 characters." };

  const supabase = await createClient();
  // 校验当前密码（signInWithPassword 也会刷新当前 session）
  const { error: verifyErr } = await supabase.auth.signInWithPassword({
    email: customer.email,
    password: input.currentPassword,
  });
  if (verifyErr) return { ok: false as const, error: "Current password is incorrect." };

  const { error } = await supabase.auth.updateUser({ password: newPassword });
  if (error) return { ok: false as const, error: error.message };
  return { ok: true as const };
}

// ============================================================================
// 手机号更换 / 绑定（Settings → 手机号）
// ============================================================================
//
// 与登录流程共用同一套判定与执行（lib/auth/phone-identity + phone-login），差别只在"验谁的码"：
//   · 登录：验证的是他要登进去的那个号码；
//   · 改号：验证的是**新号码**——这才算证明"新号码归他"。
//
// 两个必须踩准的点：
//  ① 发码/验码要用**非持久化**的 auth client。Supabase 的手机验证码会给新号码建一个临时账号，
//     若用 cookie client，骑手验证完就会被换成那个临时账号（等于登录态被顶掉）——所以下面用
//     ephemeralAuth()。验证通过后临时账号由 preparePhoneIdentity 当"孤儿"清理掉。
//  ② 新号码若已属于**别的客户**，直接拒绝：不给任何人"把号挪走"的机会（判定在纯函数里，有单测）。

/** 非持久化的服务端 auth client（只用来收发验证码，绝不动浏览器里的 session）。 */
async function ephemeralAuth() {
  const { createClient } = await import("@supabase/supabase-js");
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false } },
  );
}

/** 给**新号码**发一个验证码（证明它归当前骑手所有）。 */
export async function requestRiderPhoneChange(input: { countryCode?: string; phone: string }) {
  const customer = await getRiderCustomer();
  if (!customer) return { ok: false as const, error: "Not signed in" };
  if (!customer.authId) {
    return { ok: false as const, error: "Your account has no login yet — please contact the workshop." };
  }

  const cc = input.countryCode?.trim() || "+60";
  const e164 = normalizeToE164(cc, input.phone);
  if (!e164) return { ok: false as const, error: "Enter a valid phone number." };
  if (!isAllowedPhone(e164)) {
    return { ok: false as const, error: "SMS codes are currently sent to Malaysian numbers (+60) only." };
  }
  if (sameMsisdn(customer.phone, e164)) {
    return { ok: false as const, error: "This is already your current number." };
  }

  // 新号码不能挂在别的客户档案上（Customer.phone 无唯一约束，命中多个也一并拒绝）。
  const owners = await customersByPhone(normalizePhoneLoose(e164));
  if (owners.some((c) => c.id !== customer.id)) {
    return { ok: false as const, error: "This number is already used by another customer — please contact the workshop." };
  }

  // 限流先于一切写操作：这一步会改 Supabase 里的身份，不该被滥用触发。
  const ipHash = await clientIpHash();
  const rate = await otpRateCheck(e164, ipHash);
  if (!rate.allow) return { ok: false as const, error: rate.message };

  const attempt = await db.otpAttempt.create({
    data: { phoneE164: e164, purpose: "CHANGE", ipHash, status: "REQUESTED" },
  });

  const sb = await ephemeralAuth();
  const { error } = await sb.auth.signInWithOtp({
    phone: e164,
    options: { shouldCreateUser: true },
  });
  if (error) {
    await db.otpAttempt.update({
      where: { id: attempt.id },
      data: { status: "FAILED", error: error.message.slice(0, 200) },
    });
    return { ok: false as const, error: error.message };
  }
  return { ok: true as const, masked: maskPhone(e164) };
}

/** 校验新号码的验证码；通过后把号码挂到**他本人的**账号上并更新客户档案。 */
export async function verifyRiderPhoneChange(input: {
  countryCode?: string;
  phone: string;
  token: string;
}) {
  const customer = await getRiderCustomer();
  if (!customer) return { ok: false as const, error: "Not signed in" };
  if (!customer.authId) {
    return { ok: false as const, error: "Your account has no login yet — please contact the workshop." };
  }

  const cc = input.countryCode?.trim() || "+60";
  const e164 = normalizeToE164(cc, input.phone);
  if (!e164) return { ok: false as const, error: "Enter a valid phone number." };
  const token = input.token.trim();
  if (!/^\d{4,8}$/.test(token)) return { ok: false as const, error: "Enter the code from the SMS." };

  const sb = await ephemeralAuth();
  const { error } = await sb.auth.verifyOtp({ phone: e164, token, type: "sms" });
  if (error) return { ok: false as const, error: error.message };

  // 号码归属：孤儿（上面临时建出来的那个）会被清掉，别人的账号绝不触碰。
  const prepared = await preparePhoneIdentity(e164, { id: customer.id, authId: customer.authId });
  if (!prepared.ok) return { ok: false as const, error: prepared.error };
  if (prepared.shouldCreateUser) {
    // 兜底：走到这里说明他的账号在那个号码上不存在，宁可拒绝也不要建出第二个身份。
    return { ok: false as const, error: "Could not link this number — please contact the workshop." };
  }

  const before = customer.phone;
  await db.customer.update({ where: { id: customer.id }, data: { phone: fmtStoredPhone(normalizePhoneLoose(e164)) } });
  await db.customerAuthProfile.upsert({
    where: { customerId: customer.id },
    create: { customerId: customer.id, phoneVerified: true },
    update: { phoneVerified: true },
  });
  await markOtpVerified(e164);
  revalidatePath("/", "layout");
  return { ok: true as const, phone: maskPhone(e164), before };
}
