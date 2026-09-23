"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { getRiderCustomer } from "@/lib/rider-customer";

/**
 * Rider 编辑个人资料（Settings → Profile）。
 * 仅允许更新自己的记录（基于 Supabase authId 取当前顾客）。
 *
 * **手机号不在这里改**（2026-09-23 起）：它是账号的登录标识，改号必须先证明新号码归他所有，
 * 否则任何人都能把账号挪到自己控制的号码上。旧版本直接写 `phone` —— 于是"给新号码发验证码"
 * 那套流程可以被个人资料页一行输入绕过。现在：
 *   · 传入的 phone 与当前号码不一致 → 明确报错并指路（不是静默忽略，否则用户以为改成功了）；
 *   · 真正的改号走 requestRiderPhoneChange / verifyRiderPhoneChange（Settings → 手机号）。
 */
export async function updateRiderProfile(input: {
  name: string;
  phone?: string;
  email?: string;
  gender?: string;
  address?: string;
}) {
  const customer = await getRiderCustomer();
  if (!customer) return { ok: false as const, error: "Not signed in" };

  const name = input.name.trim();
  if (name.length < 2) return { ok: false as const, error: "Please enter your name." };
  const email = input.email?.trim().toLowerCase() || null;

  const phoneInput = input.phone?.trim() || "";
  if (phoneInput && phoneInput !== (customer.phone ?? "")) {
    return {
      ok: false as const,
      error: "To change your phone number, use the verification step below — it needs a code sent to the new number.",
    };
  }

  await db.customer.update({
    where: { id: customer.id },
    data: {
      name,
      email,
      gender: input.gender?.trim() || null,
      address: input.address?.trim() || null,
    },
  });
  revalidatePath("/", "layout");
  return { ok: true as const };
}
