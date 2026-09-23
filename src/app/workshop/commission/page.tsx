import { getSessionUser } from "@/lib/session-user";
import { can } from "@/lib/auth/permissions";
import { getLang } from "@/lib/get-lang";
import { t, tpl } from "@/lib/i18n";
import { listCommissionConfig } from "@/actions/commission";
import { CommissionConfigView } from "@/components/workshop/commission-config";
import { TierSetConfig } from "@/components/workshop/tier-set-config";
import { listCommissionTierSets } from "@/actions/commission-tiers";
import { listCommissionSwitches } from "@/actions/commission";
import { CommissionSwitches } from "@/components/workshop/commission-switches";
import { windowStatFor } from "@/modules/commission/reconcile";
import { windowKeyOf } from "@/lib/commission/apportion";
import { formatRM } from "@/lib/money";

export const dynamic = "force-dynamic";

/**
 * 佣金配置页（P1）。
 *
 * 一行一个 SKU / 一个服务 / 一个套餐 / 一个分类 + 默认级，显示当前生效规则与**来源层级**。
 * 没配的排在前面 —— 这是一张待办清单，不是报表。编辑权限由矩阵 TECHNICIANS/edit 决定
 * （OWNER/MANAGER 走通配；技师与服务顾问只读，与结算页同一批人可见）。
 */
export default async function CommissionPage() {
  const lang = await getLang();
  const session = await getSessionUser();
  const canEdit =
    session.kind === "staff" && !!session.user
      ? await can({ id: session.user.id, role: session.role as never, organisationId: session.orgId }, "TECHNICIANS", "edit")
      : false;

  const [data, tierData, costWindow, switches] = await Promise.all([
    listCommissionConfig(),
    listCommissionTierSets(),
    // 成本占比：佣金 ÷ 同期营收。**无台账也要显示**（生产上就是这么发现问题的：
    // 原来只在有台账时渲染，于是老板打开页面看不到任何变化）。
    windowStatFor({ organisationId: session.orgId, windowKey: windowKeyOf(new Date()) }).catch(() => null),
    // 两个业务开关（零件是否计佣 / 按原价还是实付）—— 钱怎么算由业务方决定，不写死代码
    listCommissionSwitches(),
  ]);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{t("comm.title", lang)}</h1>
        <p className="text-sm text-muted-foreground mt-1">{t("comm.subtitle", lang)}</p>
      </div>

      {switches.ok && canEdit && <CommissionSwitches initial={switches.switches} />}

      {costWindow && (
        <div className="rounded-2xl border bg-card p-4">
          <div className="text-xs text-muted-foreground">{tpl("comm.cost-title", lang, { window: costWindow.windowKey })}</div>
          <div className="mt-1 flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <span className="text-2xl font-bold">
              {costWindow.ratioPct === null ? "—" : costWindow.ratioPct.toFixed(1) + "%"}
            </span>
            <span className="text-sm text-muted-foreground">
              {tpl("comm.cost-line", lang, { commission: formatRM(costWindow.baseSen), revenue: formatRM(costWindow.revenueSen) })}
            </span>
          </div>
          {costWindow.baseSen === 0 && (
            <p className="mt-1 text-xs text-muted-foreground">{t("comm.cost-none", lang)}</p>
          )}
        </div>
      )}
      {!data.ok ? (
        <div className="rounded-2xl border bg-card p-4 text-sm text-destructive">{data.error}</div>
      ) : (
        <CommissionConfigView items={data.items} rules={data.rules} conflicts={data.conflicts} canEdit={canEdit} />
      )}

      {/* 阶梯组合（P3）：与基础规则同一页 —— "这单本来拿多少" 与 "卖够多少再拿多少" 是同一件事的两半 */}
      {tierData.ok && canEdit && <TierSetConfig items={tierData.items} catalogue={tierData.catalogue} />}
    </div>
  );
}
