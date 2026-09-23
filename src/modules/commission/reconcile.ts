import { db } from "@/lib/db";
import { isBillableLine, windowKeyOf } from "@/lib/commission/apportion";
import { periodWindow } from "@/lib/period";

// 佣金对账（P4）：设计稿 §4.5 的三条不变量，做成**可复用的报告**。
//
// 为什么要有它：佣金算错不会报错，只会**静默地**给人错的数字。所以需要一张"最后一道网"，
// 定期回答三个问题：每一条计费行都有归属吗？佣金有没有超过营业额？台账和结算对不对得上？
//
// 为什么抽成模块而不是留在脚本里：脚本只有跑它的人看得见，而设计稿要求**不成立时页面上要有横幅**
// （"不给'就这样付了'的机会"）。同一条规则必须在脚本与页面之间**只实现一次** ——
// 两处各写一遍判定，迟早会出现"脚本说没事、页面说有事"。

const rm = (sen: number) => "RM " + (sen / 100).toFixed(2);

export interface WindowStat {
  windowKey: string;
  baseSen: number;
  adjustSen: number;
  revenueSen: number;
  invoiceCount: number;
  ratioPct: number | null;
}

export interface PayoutDrift {
  windowKey: string;
  userName: string;
  ledgerSen: number;
  payoutSen: number;
  diffSen: number;
  status: string;
  /** LEGACY = 该周期没有台账（P2 之前的历史），不属于"算错" */
  kind: "MATCH" | "DRIFT" | "LEGACY";
}

export interface ReconciliationResult {
  ok: boolean;
  hardFailures: string[];
  /** 需要人看一眼但**不判红**的事（狼来了比漏报更糟：真正的缺口会被淹没） */
  notes: string[];
  windows: WindowStat[];
  payoutDrift: PayoutDrift[];
  stats: {
    billableLines: number;
    historicalLines: number;
    historicalJobs: string[];
    duplicated: string[];
    pending: string[];
    uncovered: string[];
    ambiguousCount: number;
    adjustmentCount: number;
  };
}

/**
 * 跑一次对账。opts.windowKey 只影响"佣金 ≤ 营业额"这一节的展示范围（其余不变量是全量检查）。
 */
export async function runCommissionReconciliation(
  opts: { windowKey?: string | null; organisationId?: string | null } = {},
): Promise<ReconciliationResult> {
  const hardFailures: string[] = [];
  const notes: string[] = [];
  // **必须能按组织过滤**：页面上的横幅只看本组织 —— 否则别人的数据混进来会让横幅假红
  // （写这条时是全量测试先发现的：单跑这个文件没事，和别的测试一起跑就红，
  //   因为那些测试的 2026-09 台账与发票也算进了同一个窗口）。
  const orgId = opts.organisationId ?? null;

  const jobs = await db.serviceJob.findMany({
    where: { status: "COMPLETED", ...(orgId ? { branch: { organisationId: orgId } } : {}) },
    include: { items: true, invoice: true, mechanic: { select: { name: true } } },
    orderBy: { completedAt: "desc" },
  });
  const ledger = await db.commissionLedger.findMany({ where: orgId ? { organisationId: orgId } : {} });

  // ── 不变量 2：每条计费行有且只有一条 BASE（或有明确的豁免原因）─────────────────
  const byItem = new Map<string, typeof ledger>();
  for (const row of ledger) {
    if (!row.jobItemId) continue;
    byItem.set(row.jobItemId, [...(byItem.get(row.jobItemId) ?? []), row]);
  }
  let billableLines = 0;
  let historicalLines = 0;
  const historicalJobs: string[] = [];
  const duplicated: string[] = [];
  const pending: string[] = [];
  const uncovered: string[] = [];
  const jobHasLedger = new Set(ledger.map((r) => r.jobId).filter((v): v is string => !!v));
  for (const job of jobs) {
    // **历史工单**（这单在台账里一行都没有）与"配置缺口"是两件事：P2 之前完工的单子本来没有台账，
    // 而设计稿明确"历史不重算"。混在一起报会让报告天天红着，真正的缺口反而被淹没。
    const billable = job.items.filter(isBillableLine);
    if (!jobHasLedger.has(job.id)) {
      historicalLines += billable.length;
      if (billable.length && historicalJobs.length < 5) historicalJobs.push(job.jobNumber);
      continue;
    }
    for (const item of billable) {
      billableLines += 1;
      const rows = byItem.get(item.id) ?? [];
      const bases = rows.filter((r) => r.kind === "BASE");
      if (bases.length > 1) duplicated.push(job.jobNumber + " / " + item.description + " (" + bases.length + " 条 BASE)");
      if (rows.some((r) => r.kind === "PENDING")) pending.push(job.jobNumber + " / " + item.description + " → " + rm(item.lineTotalSen));
      else if (bases.length === 0) uncovered.push(job.jobNumber + " / " + item.description + " (" + rm(item.lineTotalSen) + ")");
    }
  }
  if (duplicated.length) {
    hardFailures.push("同一计费行出现多条 BASE：" + duplicated.slice(0, 5).join("; "));
  }
  if (pending.length) {
    notes.push(pending.length + " 条计费行尚未归属（完工时未指派技师）——请补指派后重算，否则这笔钱没人拿");
  }

  // ── 不变量 3：每个窗口的佣金 ≤ 该窗口发票收入 ────────────────────────────────
  const windows: WindowStat[] = [];
  const windowKeys = [...new Set(ledger.map((r) => r.windowKey))].sort();
  for (const w of windowKeys) {
    if (opts.windowKey && w !== opts.windowKey) continue;
    const baseSen = ledger.filter((r) => r.windowKey === w && r.kind === "BASE").reduce((s, r) => s + r.amountSen, 0);
    const adjustSen = ledger.filter((r) => r.windowKey === w && (r.kind === "ADJUSTMENT" || r.kind === "REVERSAL")).reduce((s, r) => s + r.amountSen, 0);
    const [y, m] = w.split("-").map(Number);
    const from = new Date(Date.UTC(y, m - 1, 1));
    const to = new Date(Date.UTC(m === 12 ? y + 1 : y, m === 12 ? 0 : m, 1));
    const inv = await db.invoice.aggregate({
      where: { issuedAt: { gte: from, lt: to }, ...(orgId ? { branch: { organisationId: orgId } } : {}) },
      _sum: { totalSen: true },
      _count: true,
    });
    const revenueSen = inv._sum.totalSen ?? 0;
    windows.push({
      windowKey: w, baseSen, adjustSen, revenueSen, invoiceCount: inv._count,
      ratioPct: revenueSen > 0 ? (baseSen / revenueSen) * 100 : null,
    });
    if (revenueSen > 0 && baseSen > revenueSen) {
      hardFailures.push(w + " 的佣金（" + rm(baseSen) + "）超过了该窗口发票收入（" + rm(revenueSen) + "）");
    }
  }

  // ── 不变量 1：台账 == 结算（P4 之后这条才真正成立）───────────────────────────
  //
  // 取数口径必须与**结算**一致：按 earnedAt 落在周期内（迟到的计提落当前窗口），
  // 而不是按窗口键去匹配 —— 后者会把"上月工单本月完工"这笔漏掉，然后报一个假红。
  const payouts = await db.staffPayout.findMany({
    where: orgId ? { user: { organisationId: orgId } } : {},
    include: { user: { select: { name: true } } },
  });
  const payoutDrift: PayoutDrift[] = [];
  for (const p of payouts) {
    const period = (p.period === "day" || p.period === "week" ? p.period : "month") as "day" | "week" | "month";
    const { start, end } = periodWindow(period, p.periodStart);
    const rows = ledger.filter((r) => r.userId === p.userId && r.earnedAt >= start && r.earnedAt < end);
    const amountRows = rows.filter((r) => r.kind === "BASE" || r.kind === "TIER_BONUS" || r.kind === "ADJUSTMENT" || r.kind === "REVERSAL");
    const ledgerSen = amountRows.reduce((s, r) => s + (r.kind === "REVERSAL" ? -r.amountSen : r.amountSen), 0);
    const windowKey = windowKeyOf(start);
    if (amountRows.length === 0) {
      // 该周期没有台账：P2 之前的历史工资单就是这个样子，**不是算错**（结算用的是旧口径并留了痕）
      payoutDrift.push({ windowKey, userName: p.user.name, ledgerSen: 0, payoutSen: p.commissionSen, diffSen: -p.commissionSen, status: p.status, kind: "LEGACY" });
      continue;
    }
    const diffSen = ledgerSen - p.commissionSen;
    if (diffSen === 0) {
      payoutDrift.push({ windowKey, userName: p.user.name, ledgerSen, payoutSen: p.commissionSen, diffSen: 0, status: p.status, kind: "MATCH" });
    } else if (p.status === "PAID") {
      // **已付款的工资单不允许改**（改了就和银行流水对不上）。差额不是"待修的错"，
      // 而是"下期要补/扣的调整" —— 所以这里记 note 而不是判红，否则报告会永远红着。
      payoutDrift.push({ windowKey, userName: p.user.name, ledgerSen, payoutSen: p.commissionSen, diffSen, status: p.status, kind: "DRIFT" });
      notes.push(windowKey + " " + p.user.name + "：已付款金额与台账差 " + rm(diffSen) + "（已冻结，应在下一期做调整而不是改历史）");
    } else {
      payoutDrift.push({ windowKey, userName: p.user.name, ledgerSen, payoutSen: p.commissionSen, diffSen, status: p.status, kind: "DRIFT" });
      hardFailures.push(windowKey + " " + p.user.name + "：台账 " + rm(ledgerSen) + " ≠ 工资单 " + rm(p.commissionSen) + "（未付款，可以直接重算）");
    }
  }

  // ── 需要人工复核的台账行 ────────────────────────────────────────────────
  const ambiguousCount = ledger.filter((r) => (r.reason ?? "").includes("AMBIGUOUS")).length;
  const adjustmentCount = ledger.filter((r) => r.kind === "ADJUSTMENT" || r.kind === "REVERSAL").length;
  if (ambiguousCount > 0) notes.push(ambiguousCount + " 条台账行在计提时有多条规则同时生效（AMBIGUOUS），请复核规则窗口是否重叠");

  return {
    ok: hardFailures.length === 0,
    hardFailures,
    notes,
    windows,
    payoutDrift,
    stats: { billableLines, historicalLines, historicalJobs, duplicated, pending, uncovered, ambiguousCount, adjustmentCount },
  };
}
