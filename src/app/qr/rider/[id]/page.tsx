import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { User as UserIcon, Phone, Mail, Bike } from "lucide-react";
import { db } from "@/lib/db";
import { getRiderCustomer } from "@/lib/rider-customer";
import { getSessionUser } from "@/lib/session-user";
import { fmtKM, fmtDate } from "@/lib/format";
import { getLang } from "@/lib/get-lang";
import { t, tpl } from "@/lib/i18n";

export const dynamic = "force-dynamic";

/**
 * QR 落地页 B（QR-002 车主码）：扫码 → 个人全套资料。
 * Deep link：/qr/rider/<Customer.qrToken>
 *
 * 2026-09-30 越权修正（P0）：本页原先零鉴权、且用 `OR [{qrToken}, {id}]` 兜底 ——
 * id 是 cuid，按序枚举即可绕过不可枚举的 token，匿名读到顾客姓名/电话/邮箱。
 * 现在只认 qrToken。
 *
 * 两种合法读者（**不要退化成只剩骑手**：这张码本来是印给店里扫的）：
 *   ① 顾客本人；② **本租户的员工**（柜台扫码调档案）。令牌证明码是真的，租户归属证明有权看。
 */
export default async function QrRiderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const lang = await getLang();
  // 先要身份，再谈令牌：未登录直接去登录页（next 指回本页），连库都不查。
  // 去 /login 而不是 /rider/login —— 那个页面同时有员工与骑手两个 tab，
  // 而这张码的两类读者都会扫到它（2026-09-30：原先只跳骑手登录，会把员工挡在门外）。
  const [rider, session] = await Promise.all([getRiderCustomer(), getSessionUser()]);
  if (!rider && session.kind !== "staff") {
    redirect("/login?next=" + encodeURIComponent("/qr/rider/" + id));
  }
  // 只认 QR 编码的 qrToken（不可枚举）——原先的 OR [{qrToken}, {id}] 兜底让 token 的
  // 防护形同虚设：id 是 cuid，攻击者按序枚举即可绕过 token 拿到任意顾客的姓名/电话/邮箱。
  const customer = await db.customer.findFirst({
    where: { qrToken: id },
    include: { motorcycles: true },
  });
  // 归属校验：顾客本人，或本租户的员工。否则 404（不暴露该顾客是否存在）。
  const isSelf = !!rider && customer?.id === rider.id;
  const isOwnStaff = session.kind === "staff" && customer?.organisationId === session.orgId;
  if (!customer || (!isSelf && !isOwnStaff)) notFound();

  const serviceCount = await db.serviceJob.count({ where: { customerId: customer.id, status: "COMPLETED" } });
  const lastJob = await db.serviceJob.findFirst({ where: { customerId: customer.id, status: "COMPLETED" }, orderBy: { completedAt: "desc" } });

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-lg flex-col justify-center px-4 py-8">
      <div className="w-full rounded-3xl border bg-card p-6">
        <div className="flex items-center gap-3">
          <div className="h-12 w-12 rounded-2xl bg-primary/10 text-primary flex items-center justify-center"><UserIcon className="h-6 w-6" /></div>
          <div>
            <h1 className="text-lg font-bold">{customer.name}</h1>
            <p className="text-sm text-muted-foreground">{tpl("qr.rider-subtitle", lang, { date: fmtDate(customer.joinedAt) })}</p>
          </div>
        </div>

        <div className="mt-4 space-y-1.5 text-sm">
          {customer.phone && <div className="flex items-center gap-2 text-muted-foreground"><Phone className="h-4 w-4" /> <span className="font-medium text-foreground">{customer.phone}</span></div>}
          {customer.email && <div className="flex items-center gap-2 text-muted-foreground"><Mail className="h-4 w-4" /> <span className="font-medium text-foreground">{customer.email}</span></div>}
        </div>

        <div className="mt-5 grid grid-cols-3 gap-2">
          <div className="rounded-xl bg-muted/50 p-3 text-center">
            <div className="text-lg font-bold tabular-nums">{customer.motorcycles.length}</div>
            <div className="text-[10px] text-muted-foreground">{t("qr.bikes", lang)}</div>
          </div>
          <div className="rounded-xl bg-muted/50 p-3 text-center">
            <div className="text-lg font-bold tabular-nums">{serviceCount}</div>
            <div className="text-[10px] text-muted-foreground">{t("rider.profile-services", lang)}</div>
          </div>
          <div className="rounded-xl bg-muted/50 p-3 text-center">
            <div className="text-lg font-bold tabular-nums">{lastJob ? fmtDate(lastJob.completedAt) : "—"}</div>
            <div className="text-[10px] text-muted-foreground">{t("svc.last-service", lang)}</div>
          </div>
        </div>

        <div className="mt-5">
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-2">{t("qr.motorcycles-record", lang)}</div>
          <div className="space-y-2">
            {customer.motorcycles.map((m) => (
              <div key={m.id} className="flex items-center gap-3 rounded-xl border p-3">
                <div className="h-9 w-9 rounded-xl bg-primary/10 text-primary flex items-center justify-center"><Bike className="h-4 w-4" /></div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-semibold">{m.brand} {m.model}</div>
                  <div className="text-[11px] text-muted-foreground">{m.plate} · {m.year} · {fmtKM(m.currentMileage)}</div>
                </div>
                <Link href={"/qr/motorcycle/" + m.id} className="text-xs font-medium text-primary hover:underline">{t("ws.poster.view", lang)}</Link>
              </div>
            ))}
          </div>
        </div>

        <Link href={"/workshop/customers/" + customer.id} className="mt-5 flex w-full items-center justify-center gap-2 rounded-xl bg-primary py-3 text-sm font-semibold text-primary-foreground">
          {t("qr.open-workshop", lang)}
        </Link>
        <p className="mt-4 text-center text-[10px] text-muted-foreground">{tpl("qr.scan-rider", lang, { date: fmtDate(new Date()) })}</p>
      </div>
    </main>
  );
}
