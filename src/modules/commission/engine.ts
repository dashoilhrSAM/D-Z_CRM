import type { Prisma } from "@prisma/client";
import { isBillableLine, netLineSen, splitDiscountToLines, windowKeyOf } from "@/lib/commission/apportion";
import { resolveCommissionRule, type CommissionRuleLike } from "@/lib/commission/resolve";

// 佣金计提引擎（P2）—— **唯一写入者**。
//
// 设计稿 §4 定的三条：
//  ① 计提时点 = 工单完工（completion.ts 里已经写发票与付款的地方），且与完工在**同一个事务**里：
//     要么活干完+账单+佣金一起成立，要么都不成立 —— 不存在"活干完了但佣金没计"的中间态。
//  ② 幂等的核心是**数据库唯一键** (jobItemId, kind)，不是代码自觉：完工流程被重试（双击/网络/补偿任务）
//     时第二条插不进去，被吞掉并计入 skipped。
//  ③ **没指派技师不许静默算 0**（那是技师少拿钱还没人知道）：写 kind=PENDING 的行（金额 0 + 原因），
//     进入"待归属"清单；工头补指派后重跑本函数会补上正式 BASE 行（PENDING 行保留作历史痕迹）。

/** 引擎需要的最小事务接口（完工事务里的 tx，或测试里的 PrismaClient）。 */
export type CommissionTx = Pick<Prisma.TransactionClient, "serviceJob" | "commissionRule" | "commissionLedger" | "organisation">;

export interface AccrualSummary {
  /** 写入的正式计提行数（kind=BASE） */
  based: number;
  /** 因没有规则覆盖而留下的 LEGACY 痕迹行数（金额 0） */
  legacy: number;
  /** 因未指派技师而留下的 PENDING 行数（金额 0） */
  pending: number;
  /** 因唯一键已存在而跳过的行数（重跑会看到它 > 0，这是幂等的证据） */
  skipped: number;
  /** 本次计提金额合计（sen） */
  totalSen: number;
}

const EMPTY: AccrualSummary = { based: 0, legacy: 0, pending: 0, skipped: 0, totalSen: 0 };

/**
 * 为一个已完工（已有发票）的工单计提佣金。
 * 幂等：重复调用不会产生第二条 (jobItemId, kind)。
 */
export async function accrueForJob(
  tx: CommissionTx,
  jobId: string,
  opts: { at?: Date; actorUserId?: string | null } = {},
): Promise<AccrualSummary> {
  const job = await tx.serviceJob.findUnique({
    where: { id: jobId },
    include: { items: true, parts: true, invoice: true, branch: true },
  });
  if (!job) throw new Error("Job not found: " + jobId);
  // 完工之前没有发票 = 还没有"成交价"，不计提（计提时点就是完工）
  if (!job.invoice) return { ...EMPTY };

  const invoice = job.invoice;
  const earnedAt = opts.at ?? invoice.issuedAt ?? new Date();
  const windowKey = windowKeyOf(earnedAt);
  const organisationId = job.branch.organisationId;

  const [org, rulesRaw] = await Promise.all([
    tx.organisation.findUnique({ where: { id: organisationId }, select: { commissionOnGross: true } }),
    tx.commissionRule.findMany({ where: { organisationId, active: true } }),
  ]);

  const rules: CommissionRuleLike[] = rulesRaw.map((r) => ({
    id: r.id, scope: r.scope, targetKey: r.targetKey, basis: r.basis, value: r.value,
    valuePercent: r.valuePercent, valueFixedSen: r.valueFixedSen,
    effectiveFrom: r.effectiveFrom, effectiveTo: r.effectiveTo, priority: r.priority, active: r.active,
  }));

  // ① 佣金基数 = **客户实付**：把发票折扣（促销 + 柜台手工）按行分摊到**全部计费行**
  //    （含零件行，因为折扣是对整张账单给的），再取服务行应承担的份额。
  //    老板若选择按原价算（Organisation.commissionOnGross），就完全不分摊。
  const acceptedItems = job.items.filter((i) => i.status !== "DECLINED");
  const acceptedParts = job.parts.filter((p) => p.status !== "DECLINED");
  const billable = acceptedItems.filter(isBillableLine);
  const allBilledTotals = [
    ...acceptedItems.map((i) => i.lineTotalSen),
    ...acceptedParts.map((p) => p.lineTotalSen),
  ];
  // 口径开关由业务方在页面决定（本项目约定：营收相关行为不写死源码常量）：
  //  · 默认 false = 佣金按**客户实付**算；
  //  · true = 按原价算（不看折扣）——老板若认为"折扣是店的成本、不该由技师承担"就打开它。
  const discountTotal = org?.commissionOnGross ? 0 : invoice.discountSen + invoice.manualDiscountSen;
  const shares = splitDiscountToLines(allBilledTotals, discountTotal);
  // 服务行在 allBilledTotals 里排在最前，所以它们的份额就是 shares 的前 acceptedItems.length 个
  const itemShareOf = (itemId: string) => {
    const idx = acceptedItems.findIndex((i) => i.id === itemId);
    return idx >= 0 ? shares[idx] ?? 0 : 0;
  };

  const summary: AccrualSummary = { ...EMPTY };
  const rows: {
    jobItemId: string; kind: string; amountSen: number; basis: string; baseSen: number; qty: number;
    ruleId: string | null; ruleSnapshot: string | null; reason: string | null;
  }[] = [];

  for (const item of billable) {
    const baseSen = netLineSen(item.lineTotalSen, itemShareOf(item.id));
    const res = resolveCommissionRule(
      {
        productId: item.productId, serviceTypeId: item.serviceTypeId, packageId: item.packageId,
        baseSen, qty: item.quantity,
      },
      rules,
      earnedAt,
    );
    if (!res.ok) {
      // 没有任何规则覆盖这一行 → 留一条金额 0 的 LEGACY 痕迹（钱仍由旧的人员级结算路径付，
      // 所以这里是 0 而不是"猜一个数"），并让它出现在对账报告的"未覆盖"清单里。
      rows.push({
        jobItemId: item.id, kind: "LEGACY", amountSen: 0, basis: "LEGACY", baseSen, qty: item.quantity,
        ruleId: null, ruleSnapshot: null, reason: "no commission rule covers this line — legacy per-staff settlement still applies",
      });
      continue;
    }
    if (!job.mechanicId) {
      rows.push({
        jobItemId: item.id, kind: "PENDING", amountSen: 0, basis: res.rule.basis, baseSen, qty: item.quantity,
        ruleId: res.rule.id, ruleSnapshot: null, reason: "no mechanic assigned on completion",
      });
      continue;
    }
    rows.push({
      jobItemId: item.id, kind: "BASE", amountSen: res.amountSen, basis: res.rule.basis, baseSen, qty: item.quantity,
      ruleId: res.rule.id,
      // 规则快照：事后改规则不影响历史（与促销"报价即承诺"同一套原则）
      ruleSnapshot: JSON.stringify({
        scope: res.rule.scope, targetKey: res.rule.targetKey, basis: res.rule.basis,
        value: res.rule.value, valuePercent: res.rule.valuePercent, valueFixedSen: res.rule.valueFixedSen,
        matchedBy: res.matchedBy,
      }),
      reason: res.ambiguous ? "AMBIGUOUS: several rules were in force at this moment" : null,
    });
  }

  for (const r of rows) {
    try {
      await tx.commissionLedger.create({
        data: {
          organisationId, branchId: job.branchId, userId: job.mechanicId ?? "UNASSIGNED",
          jobId: job.id, jobItemId: r.jobItemId, invoiceId: invoice.id,
          kind: r.kind, amountSen: r.amountSen, basis: r.basis, baseSen: r.baseSen, qty: r.qty,
          ruleId: r.ruleId, ruleSnapshot: r.ruleSnapshot, reason: r.reason,
          actorUserId: opts.actorUserId ?? null, earnedAt, windowKey,
        },
      });
      if (r.kind === "BASE") {
        summary.based += 1;
        summary.totalSen += r.amountSen;
      } else if (r.kind === "PENDING") summary.pending += 1;
      else summary.legacy += 1;
    } catch (e) {
      // P2002 = 唯一键冲突 = 这一行已经计提过（重跑/双击）——这正是幂等生效的样子
      if (e && typeof e === "object" && "code" in e && (e as { code?: string }).code === "P2002") {
        summary.skipped += 1;
        continue;
      }
      throw e;
    }
  }

  return summary;
}
