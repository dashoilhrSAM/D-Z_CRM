import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { RiderSignupForm } from "@/components/rider/signup-form";

/**
 * 门店专属注册入口 `/t/<slug>/signup`（P3b 第 4 步最后一块）。
 *
 * 为什么需要它：注册路径的"哪家店"以前只能靠"平台恰好一家在营门店"兜底
 * （隐患 ①：两家店时那是按字母序抛硬币）。有了这个入口，**门店写在链接里**，
 * 新客户注册直接落在对的店；多店并存时也不再需要拒绝。
 *
 * 判定复用 `planShopEntry` 之外的最小检查：slug 必须存在且在营 ——
 * 注册的人**还没有身份**，所以不能像 `/t/<slug>` 那样要求"他属于这家店"。
 */
export default async function ShopSignupPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const org = await db.organisation.findUnique({ where: { slug }, select: { status: true } });
  if (!org || (org.status !== "ACTIVE" && org.status !== "TRIAL")) notFound();
  return <RiderSignupForm tenantSlug={slug} />;
}
