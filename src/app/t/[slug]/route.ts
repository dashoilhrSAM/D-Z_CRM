import { NextResponse, type NextRequest } from "next/server";
import { readRequestIdentity } from "@/lib/supabase/identity";
import { planShopEntry } from "@/lib/tenant/entry-tenant";
import { setActiveTenant } from "@/lib/tenant/active-tenant";

/**
 * 门店专属链接 `/t/<slug>` —— 扫店门/名片上的链接就能直接进对的店。
 *
 * 为什么是 **route handler 而不是 page**：进店的动作是"签 `dz_tenant` cookie 然后跳走"，
 * 而 Server Component**不能写 cookie**（只有 action / route handler / middleware 能）。
 * 写成 page 就得先渲染一个"正在进入…"再靠 action 补签，多一跳还会闪一下。
 *
 * 决策全在 `planShopEntry`（可单测）；这里只做三件事：读身份、按决策签 cookie 或跳转。
 * ⚠️ 签名只发生在 `enter` 分支，而且 organisationId 来自**候选列表的匹配结果** ——
 * 绝不拿 URL 里的 slug 直接去签（见 active-tenant.ts 的不变式）。
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const identity = await readRequestIdentity();
  const plan = await planShopEntry(identity?.id ?? null, slug);

  if (plan.kind === "enter") {
    await setActiveTenant({ organisationId: plan.organisationId, slug: plan.slug });
    return NextResponse.redirect(new URL(plan.home, req.url));
  }

  if (plan.kind === "signin") {
    // 登录后回到这个链接（登录页消费 ?next=，见 lib/auth/next-path.ts 的开放重定向说明）
    const next = encodeURIComponent("/t/" + slug);
    return NextResponse.redirect(new URL(`/login?next=${next}`, req.url));
  }

  if (plan.kind === "not-a-member") {
    // 他在别家店有身份 → 让选择器说明情况；一家都没有 → 选择器会把他送去登录
    return NextResponse.redirect(new URL("/select-workshop?rejected=1", req.url));
  }

  // slug 不存在 / 门店停用：给它一个明确的 404，而不是含糊地跳去哪里
  return new NextResponse(
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Workshop not found</title>` +
      `<meta name="viewport" content="width=device-width,initial-scale=1"></head>` +
      `<body style="font-family:system-ui;display:flex;min-height:100vh;align-items:center;justify-content:center;margin:0">` +
      `<div style="max-width:26rem;padding:1.5rem;text-align:center">` +
      `<h1 style="font-size:1.15rem;margin:0 0 .5rem">This workshop link is not valid</h1>` +
      `<p style="color:#666;font-size:.9rem;margin:0 0 1rem">${escapeHtml(plan.error)}</p>` +
      `<a href="/login" style="font-size:.9rem">Go to sign in</a></div></body></html>`,
    { status: 404, headers: { "content-type": "text/html; charset=utf-8" } },
  );
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}
