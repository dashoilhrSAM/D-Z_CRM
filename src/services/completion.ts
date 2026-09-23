import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { jobService } from "@/modules/service-jobs/service";
import { inventoryService } from "@/modules/inventory/service";
import { crmService } from "@/modules/crm/service";
import { paymentProvider, messagingProvider, notificationProvider } from "@/providers";
import { messagingModule } from "@/modules/messaging/service";
import { promoDiscountForBill, readPromoSnapshot } from "@/modules/marketing/promo-resolve";
import { completionMessage } from "@/modules/messaging/completion-message";
import { DEFAULT_SERVICE_INTERVAL_KM, AVG_KM_PER_MONTH } from "@/lib/constants";
import { accrueForJob } from "@/modules/commission/engine";

const INVOICE_PREFIX = "DZ-";
/** 号码里的序号补零到 5 位 —— **必须补零**：invoiceNumber 是按字符串排序取最大号的，
 *  不补零会让 "9" 排在 "10" 之后（本项目在别处已经栽过一次同样的坑）。 */
const INVOICE_PAD = 5;

/**
 * 原子分配发票号（2026-09-23 修一个真 bug）。
 *
 * **原来是这样**：count(该年发票) + 1 —— 两个并发的完工事务会读到同一个 count，
 * 第二张发票撞 invoiceNumber 唯一键，**整个完工事务回滚**（发票、收款、库存扣减、佣金、
 * 服务提醒一起没了）。本项目早已写明「凡读出当前值 → 判断 → 写回，都必须原子写」，
 * 这里是漏网的一处，而且是资金单据。
 * count 还有第二个隐患：**删掉一张发票会让号码回退**、与既有发票重号。
 *
 * **现在**：一张按年份的计数器表，用 upsert 的 UPDATE 分支做 value = value + 1
 * （Postgres/SQLite 都编译成 INSERT ... ON CONFLICT DO UPDATE，是原子的），
 * 取号天然不重号、不需要重试；只有"计数器行第一次被创建"那一瞬间的并发会撞唯一键，
 * 重试一次即可（那时对方已经建好，走 UPDATE 分支）。
 *
 * 为什么按**年份全局**而不是按组织：invoiceNumber 是全局唯一键，按组织分号会跨组织重号。
 */
/** 导出是为了让测试能直接钉住"唯一 + 单调 + 不回退"这三条契约（本地 sqlite 复现不了真实竞态）。 */
export async function nextInvoiceNumber(tx: Prisma.TransactionClient, year: number): Promise<string> {
  const existing = await tx.invoiceCounter.findUnique({ where: { year } });
  // 只在计数器还不存在时回看既有发票：**从最大号起步，绝不回退**（新建表那天必须接得上）
  const start = existing ? existing.value : await maxIssuedInvoiceNumber(tx, year);
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const row = await tx.invoiceCounter.upsert({
        where: { year },
        create: { year, value: start + 1 },
        update: { value: { increment: 1 } },
      });
      return INVOICE_PREFIX + year + "-" + String(row.value).padStart(INVOICE_PAD, "0");
    } catch (e) {
      const code = e && typeof e === "object" && "code" in e ? (e as { code?: string }).code : null;
      if (code !== "P2002") throw e; // 唯一键冲突 = 别人刚建好计数器行，重试走 UPDATE
    }
  }
  throw new Error("Could not allocate an invoice number after 5 attempts");
}

/** 这一年已经发出去的最大号（没有就返回 0）。号码补零所以字符串排序等于数值排序。 */
async function maxIssuedInvoiceNumber(tx: Prisma.TransactionClient, year: number): Promise<number> {
  const prefix = INVOICE_PREFIX + year + "-";
  const last = await tx.invoice.findFirst({
    where: { invoiceNumber: { startsWith: prefix } },
    orderBy: { invoiceNumber: "desc" },
    select: { invoiceNumber: true },
  });
  if (!last) return 0;
  const n = parseInt(last.invoiceNumber.slice(prefix.length), 10);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

export interface CompletionResult {
  jobId: string;
  jobNumber: string;
  revenueSen: number;
  cogsSen: number;
  grossProfitSen: number;
  invoiceNumber: string;
  nextServiceMileage: number;
  nextServiceEstDate: Date;
  /** P2：本次完工计提的佣金合计（sen）。技师未指派时为 0，但台账会留下 PENDING 行。 */
  commissionAccruedSen: number;
}

/**
 * CompletionService — the transactional service-completion workflow (§27).
 * All steps run inside ONE database transaction. Idempotent: completing an
 * already-completed job is a no-op.
 */
export class CompletionService {
  async complete(jobId: string): Promise<CompletionResult> {
    const { result, notify } = await db.$transaction(async (tx) => {
      const job = await tx.serviceJob.findUnique({
        where: { id: jobId },
        include: {
          customer: true,
          motorcycle: true,
          items: true,
          parts: { include: { product: true } },
          approvals: true,
          invoice: true,
          // MKT-014: the campaign carries the promo discount snapshot and points bonus
          booking: { include: { campaign: true } },
        },
      });
      if (!job) throw new Error("Job not found");
      // The check-in path connects job.booking, but a job opened from a repair booking only sets
      // Booking.jobId — so look the booking up either way. The promo promise and the campaign's
      // points bonus both live on it, and missing it silently drops both.
      const booking = job.booking ?? (await tx.booking.findFirst({ where: { jobId: job.id }, include: { campaign: true } }));
      if (job.status === "COMPLETED") {
        if (!job.invoice) throw new Error("Completed job has no invoice — data error");
        // idempotent: return existing result (no notification for an already-completed job)
        // 佣金也一样："已完成"的工单不再计提，而是**读回台账里的实际数字**（不重算，
        // 否则重试路径会给出与台账不一致的金额）。
        const alreadyAccrued = await tx.commissionLedger.aggregate({
          where: { jobId: job.id, kind: "BASE" },
          _sum: { amountSen: true },
        });
        return {
          result: {
            jobId: job.id, jobNumber: job.jobNumber,
            revenueSen: job.invoice.totalSen, cogsSen: 0, grossProfitSen: 0,
            invoiceNumber: job.invoice.invoiceNumber,
            nextServiceMileage: job.motorcycle.nextServiceMileage ?? 0,
            nextServiceEstDate: job.motorcycle.nextServiceEstDate ?? new Date(),
            commissionAccruedSen: alreadyAccrued._sum.amountSen ?? 0,
          },
          notify: null,
        };
      }
      if (job.status === "CANCELLED") throw new Error("Cannot complete a cancelled job");

      // §103 mileage validation — never go backwards silently
      if (job.mileage < job.motorcycle.currentMileage) {
        throw new Error(
          "Mileage regression: recorded " + job.mileage.toLocaleString() + " km is below current " +
          job.motorcycle.currentMileage.toLocaleString() + " km. A privileged correction is required."
        );
      }

      const acceptedItems = job.items.filter((i) => i.status !== "DECLINED");
      const acceptedParts = job.parts.filter((p) => p.status !== "DECLINED");

      // 1. Deduct inventory for accepted parts + create stock movements (§34)
      const branchId = job.branchId;
      for (const part of acceptedParts) {
        await inventoryService.deductStock(branchId, part.productId, part.quantity, "Service Job " + job.jobNumber, job.id, tx);
      }

      // 2. Build the invoice
      const year = new Date().getFullYear();
      const invoiceNumber = await nextInvoiceNumber(tx, year);
      const subtotal = acceptedItems.reduce((s, i) => s + i.lineTotalSen, 0) + acceptedParts.reduce((s, p) => s + p.lineTotalSen, 0);
      const cogs = acceptedParts.reduce((s, p) => s + p.unitCostSen * p.quantity, 0);
      // MKT-017: honour the promotional discount the customer was quoted. The amount was fixed
      // when the lines were quoted (at booking, or at check-in for a booking without a package),
      // so the invoice takes exactly that off — never a percentage re-derived from the finished
      // bill, which would discount work that was added after the quote.
      const promo = readPromoSnapshot(booking?.promoSnapshot);
      const discountSen = promoDiscountForBill(promo, subtotal);
      const totalSen = subtotal - discountSen;
      const invoice = await tx.invoice.create({
        data: {
          branchId,
          customerId: job.customerId,
          jobId: job.id,
          invoiceNumber,
          status: "ISSUED", // 待 workshop 结清（invoices 页 tick 批量 / split 收款）
          issuedAt: new Date(),
          subtotalSen: subtotal,
          discountSen,
          totalSen,
        },
      });
      for (const i of acceptedItems) {
        if (i.unitPriceSen === 0) continue; // verified component lines are not billed separately
        await tx.invoiceItem.create({
          data: { invoiceId: invoice.id, description: i.description, quantity: i.quantity, unitPriceSen: i.unitPriceSen, lineTotalSen: i.lineTotalSen, source: i.kind === "PART" ? "PART" : "SERVICE" },
        });
      }
      for (const p of acceptedParts) {
        if (p.unitPriceSen === 0) continue; // packaged consumables (oil) are covered by the package line
        await tx.invoiceItem.create({
          data: { invoiceId: invoice.id, description: p.product.name, quantity: p.quantity, unitPriceSen: p.unitPriceSen, lineTotalSen: p.lineTotalSen, source: "PART" },
        });
      }
      // 应收记录（PAY_LATER PENDING）：由 workshop 在 invoices 页确认结清
      await tx.payment.create({ data: { invoiceId: invoice.id, amountSen: totalSen, method: "PAY_LATER", status: "PENDING", paidAt: new Date() } });

      // P2：佣金计提。必须在**同一个事务**里 —— 活干完、账单、佣金三者要么一起成立，
      // 要么都不成立，否则会出现"活干完了但佣金没计"的中间态（钱少给了还没人知道）。
      // 幂等由台账唯一键 (jobItemId, kind) 兜住：完工流程被重试时第二条插不进去。
      const accrual = await accrueForJob(tx, job.id, { at: invoice.issuedAt });

      // 3. Update motorcycle snapshot
      const nextMileage = job.mileage + DEFAULT_SERVICE_INTERVAL_KM;
      const nextDate = new Date(Date.now() + (DEFAULT_SERVICE_INTERVAL_KM / AVG_KM_PER_MONTH) * 30 * 86400000);
      await tx.motorcycle.update({
        where: { id: job.motorcycleId },
        data: {
          currentMileage: job.mileage,
          lastServiceDate: new Date(),
          lastServiceMileage: job.mileage,
          nextServiceMileage: nextMileage,
          nextServiceEstDate: nextDate,
        },
      });

      // 4. Close previous reminders, create the next-service reminder (§29)
      await tx.serviceReminder.updateMany({ where: { motorcycleId: job.motorcycleId, closedAt: null }, data: { closedAt: new Date() } });
      await tx.serviceReminder.create({
        data: {
          customerId: job.customerId,
          motorcycleId: job.motorcycleId,
          jobId: job.id,
          status: "UPCOMING",
          lastServiceMileage: job.mileage,
          intervalKm: DEFAULT_SERVICE_INTERVAL_KM,
          nextServiceMileage: nextMileage,
          estimatedDate: nextDate,
        },
      });

      // 5. Thank-you message + review request (§27.13-14) via providers
      // 5. Capture the completion WhatsApp message — delivered AFTER the transaction commits
      // via the real MessagingProvider (mock in dev / Meta in prod), so the provider call
      // never blocks or rolls back the core completion workflow.
      const notify = {
        customerId: job.customerId,
        orgId: job.customer.organisationId,
        branchId: job.branchId,
        // What the customer owes — the invoice total, not the subtotal: the promo discount
        // above is already on the bill, and the rider's invoice page shows the same number.
        body: completionMessage({ customerName: job.customer.name, totalSen, discountSen }),
        jobId: job.id,
        jobNumber: job.jobNumber,
      };
      await tx.review.create({
        data: { branchId, customerId: job.customerId, jobId: job.id, status: "REQUESTED", requestedAt: new Date(), source: "APP" },
      });
      await tx.notification.create({
        data: { customerId: job.customerId, branchId, title: "Your motorcycle is ready", body: job.jobNumber + " — ready for collection.", type: "JOB_READY" },
      });

      // 5.5 Service history — permanent, immutable record (HIST-001..018)
      await tx.serviceHistory.create({
        data: {
          organisationId: job.customer.organisationId,
          branchId: job.branchId,
          customerId: job.customerId,
          motorcycleId: job.motorcycleId,
          jobId: job.id,
          serviceDate: new Date(),
          mileage: job.mileage,
          serviceAdvisorId: null,
          technicianId: job.mechanicId,
          serviceItems: JSON.stringify(acceptedItems.filter((i) => i.kind !== "PART").map((i) => ({ description: i.description, quantity: i.quantity, lineTotalSen: i.lineTotalSen }))),
          partsUsed: JSON.stringify(acceptedParts.map((p) => ({ name: p.product.name, quantity: p.quantity, lineTotalSen: p.lineTotalSen }))),
          labour: JSON.stringify(acceptedItems.filter((i) => i.kind === "PART").map((i) => ({ description: i.description, quantity: i.quantity }))),
          totalSen, // net of the promo: the same money the invoice charges
          nextServiceMileage: nextMileage,
          nextServiceDate: nextDate,
        },
      });
      await tx.jobStatusHistory.create({
        data: { jobId: job.id, fromStatus: job.status, toStatus: "COMPLETED", changedAt: new Date() },
      });
      // LOY-017: award service-based loyalty points (1 pt per RM1 spent, rounded)
      // MKT-014: a campaign can top that up with a bonus for bookings it drove.
      try {
        const pts = Math.max(10, Math.round(subtotal / 100));
        const bonusPoints = Math.max(0, booking?.campaign?.pointsBonus ?? 0);
        const total = pts + bonusPoints;

        await tx.loyaltyAccount.upsert({
          where: { customerId: job.customerId },
          create: { organisationId: job.customer.organisationId, customerId: job.customerId, membershipId: "DZ-M-" + Date.now().toString(36).toUpperCase(), pointsBalance: total, totalEarned: total },
          update: { pointsBalance: { increment: total }, totalEarned: { increment: total } },
        });
        const acct = await tx.loyaltyAccount.findUnique({ where: { customerId: job.customerId } });
        if (acct) {
          await tx.loyaltyTransaction.create({
            data: { accountId: acct.id, type: "EARN", points: pts, balanceAfter: acct.pointsBalance, reason: "Service completed " + job.jobNumber, referenceType: "JOB", referenceId: job.id },
          });
          if (bonusPoints > 0) {
            await tx.loyaltyTransaction.create({
              data: {
                accountId: acct.id, type: "EARN", points: bonusPoints, balanceAfter: acct.pointsBalance,
                reason: "Campaign bonus — " + (booking?.campaign?.name ?? "promotion"),
                referenceType: "CAMPAIGN", referenceId: booking!.campaignId,
              },
            });
          }
          const tier = await tx.loyaltyTier.findFirst({ where: { organisationId: job.customer.organisationId, active: true, minPoints: { lte: acct.totalEarned } }, orderBy: { minPoints: "desc" } });
          if (tier) await tx.loyaltyAccount.update({ where: { id: acct.id }, data: { tierId: tier.id } });
        }
      } catch { /* loyalty must never break completion */ }

      // 6. Mark job completed + booking completed
      await tx.serviceJob.update({ where: { id: job.id }, data: { status: "COMPLETED", completedAt: new Date() } });
      if (booking?.id) {
        await tx.booking.update({ where: { id: booking.id }, data: { status: "COMPLETED" } });
      }

      // Revenue is what the customer is charged (net of the promo), so it agrees with the invoice
      // and with the idempotent path above; the promo itself is a marketing cost, on the invoice.
      const grossProfit = totalSen - cogs;
      return {
        result: {
          jobId: job.id, jobNumber: job.jobNumber, revenueSen: totalSen, cogsSen: cogs, grossProfitSen: grossProfit,
          invoiceNumber, nextServiceMileage: nextMileage, nextServiceEstDate: nextDate,
          commissionAccruedSen: accrual.totalSen,
        },
        notify,
      };
    }, { timeout: 60000 });

    // Post-commit side effects: deliver the completion WhatsApp message for real and run
    // SERVICE_COMPLETED automations. Wrapped so a messaging/automation failure never
    // breaks an already-completed job.
    if (notify) {
      try {
        await messagingModule.sendDirect({ customerId: notify.customerId, body: notify.body, jobId: notify.jobId, referenceType: "COMPLETION", branchId: notify.branchId });
      } catch { /* messaging must never break completion */ }
      try {
        const { automationModule } = await import("@/modules/automation/service");
        await automationModule.run(notify.orgId, "SERVICE_COMPLETED", { customerId: notify.customerId, jobId: notify.jobId, jobNumber: notify.jobNumber, dedupeKey: notify.jobId, branchId: notify.branchId });
      } catch { /* automation must never break completion */ }
    }
    return result;
  }
}

export const completionService = new CompletionService();
