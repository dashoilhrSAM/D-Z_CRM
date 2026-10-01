import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { readRequestIdentity } from "@/lib/supabase/identity";
import { identitiesForAuthUser } from "@/lib/tenant/identity";
import { getLang } from "@/lib/get-lang";
import type { Lang } from "@/lib/i18n";
import { chooseWorkshop } from "@/actions/tenant-context";

/**
 * 多店选择器（P3b 第 4 步）。
 *
 * 什么时候会到这个页面：**同一个 auth 账号在两家以上店都有身份，而这次请求没有指定门店**。
 * 这时"该进哪家店"没有正确答案，只有用户知道 —— 所以三个端（workshop / rider /
 * mechanic-app）的布局在 `needsWorkshopChoice` 为真时都把人送到这里。
 *
 * 为什么单独一页而不是在布局里内联：它必须**离开**布局的守卫链（那些守卫都依赖
 * "当前门店"，而这里恰恰还没有门店），否则会自己把自己重定向成死循环。
 */
const COPY: Record<Lang, { title: string; sub: string; staff: string; customer: string; rejected: string }> = {
  en: {
    title: "Choose a workshop",
    sub: "This account belongs to more than one workshop. Pick the one you want to work in.",
    staff: "Staff",
    customer: "Customer",
    rejected: "That workshop is not one of your accounts — please pick from the list.",
  },
  zh: {
    title: "选择门店",
    sub: "这个账号属于多家门店，请选择这次要进入的一家。",
    staff: "员工",
    customer: "顾客",
    rejected: "那家店不在你的账号里，请从下面的列表选。",
  },
  ms: {
    title: "Pilih bengkel",
    sub: "Akaun ini dimiliki oleh lebih daripada satu bengkel. Pilih yang anda mahu masuk.",
    staff: "Staf",
    customer: "Pelanggan",
    rejected: "Bengkel itu bukan milik akaun anda — sila pilih daripada senarai.",
  },
};

export default async function SelectWorkshopPage({ searchParams }: { searchParams: Promise<{ rejected?: string }> }) {
  const identity = await readRequestIdentity();
  if (!identity) redirect("/login");

  const candidates = await identitiesForAuthUser(identity.id);
  // 一条身份都没有 = 还没有业务账号（或已被删除）→ 回登录入口，别在这里空转
  if (candidates.length === 0) redirect("/login");
  // 只有一家就不该走到这里（布局按"恰好一条"直接放行）；真到了也让他点一下进去
  const orgs = await db.organisation.findMany({
    where: { id: { in: candidates.map((c) => c.organisationId) } },
    select: { id: true, name: true, slug: true },
  });
  const nameOf = new Map(orgs.map((o) => [o.id, o]));

  const [lang, params] = await Promise.all([getLang(), searchParams]);
  const copy = COPY[lang];

  return (
    <div className="flex min-h-dvh items-center justify-center bg-muted/40 px-4">
      <div className="w-full max-w-sm rounded-2xl border bg-card p-6 shadow-xl shadow-black/5">
        <h1 className="text-xl font-bold tracking-tight">{copy.title}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{copy.sub}</p>
        {params?.rejected && (
          <p className="mt-3 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{copy.rejected}</p>
        )}
        <div className="mt-5 space-y-2">
          {candidates.map((c) => {
            const org = nameOf.get(c.organisationId);
            return (
              <form key={c.organisationId + c.kind} action={chooseWorkshop}>
                <input type="hidden" name="organisationId" value={c.organisationId} />
                <button
                  type="submit"
                  className="w-full rounded-lg border px-4 py-3 text-left text-sm font-medium transition-colors hover:bg-accent"
                >
                  <span className="block">{org?.name ?? c.organisationId}</span>
                  <span className="mt-0.5 block text-xs text-muted-foreground">
                    {c.kind === "STAFF" ? copy.staff : copy.customer}
                    {org?.slug ? " · " + org.slug : ""}
                  </span>
                </button>
              </form>
            );
          })}
        </div>
      </div>
    </div>
  );
}
