"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { getSessionUser } from "@/lib/session-user";
import { scopedBranchId } from "@/lib/branch-scope";
import { audit } from "@/lib/auth/audit";
import { applyDiscount, parseDiscount, type DiscountRequest } from "@/modules/finance/invoice-discount";

/** 批量结清发票：ISSUED → PAID，应收 payment → PAID。 */
export async function settleInvoices(ids: string[]) {
  const list = ids.filter(Boolean);
  if (list.length === 0) return { ok: false as const, error: "No invoices selected" };
  for (const id of list) {
    const inv = await db.invoice.findUnique({ where: { id }, select: { id: true, status: true } });
    if (!inv || inv.status === "PAID") continue;
    await db.$transaction([
      // 结清应收（含 PAY_LATER/PENDING），保留原 method（PAY_LATER 不计入「已收」口径，避免重复计收）
      db.payment.updateMany({ where: { invoiceId: id, status: "PENDING" }, data: { status: "PAID" } }),
      db.invoice.update({ where: { id }, data: { status: "PAID", paidAt: new Date() } }),
    ]);
  }
  revalidatePath("/workshop/finance/invoices");
  revalidatePath("/rider/invoices");
  return { ok: true as const, settled: list.length };
}

/** Split payment：为发票添加一笔收款（部分/全额）；累计满额自动 PAID。 */
export async function addInvoicePayment(invoiceId: string, amountSen: number, method: string) {
  const inv = await db.invoice.findUnique({ where: { id: invoiceId }, select: { id: true, status: true, totalSen: true } });
  if (!inv || inv.status === "PAID") return { ok: false as const, error: "Invoice not found or already paid" };
  if (amountSen <= 0) return { ok: false as const, error: "Invalid amount" };

  // 录入真实收款（PAID）
  await db.payment.create({ data: { invoiceId, amountSen, method: method as never, status: "PAID", paidAt: new Date() } });
  // 累计已收(不计 PAY_LATER 应收占位) >= 总额 → 自动结清，并把完成时自动生成的 PAY_LATER/PENDING 应收一并关闭(标记 PAID)
  const paid = await db.payment.aggregate({ where: { invoiceId, status: "PAID", method: { not: "PAY_LATER" } }, _sum: { amountSen: true } });
  if ((paid._sum.amountSen ?? 0) >= inv.totalSen) {
    await db.$transaction([
      db.invoice.update({ where: { id: invoiceId }, data: { status: "PAID", paidAt: new Date() } }),
      db.payment.updateMany({ where: { invoiceId, method: "PAY_LATER", status: "PENDING" }, data: { status: "PAID" } }),
    ]);
  }
  revalidatePath("/workshop/finance/invoices");
  revalidatePath("/rider/invoices");
  return { ok: true as const };
}

/**
 * Set the checkout discount on an invoice, or clear it by passing null.
 *
 * Anyone who can take a payment can do this — the owner's decision — so the control is the
 * audit trail rather than a permission. Every change is written to AuditLog with the actor,
 * the type, what was typed, what it actually took off, and the reason.
 *
 * The arithmetic lives in modules/finance/invoice-discount.ts so the number stored here is
 * derived the same way the cashier previews it.
 */
export async function setInvoiceDiscount(input: {
  invoiceId: string;
  /** null clears an existing discount. */
  discount: { kind: string; value: number } | null;
  reason?: string | null;
}) {
  const session = await getSessionUser();
  if (session.kind !== "staff") return { ok: false as const, error: "Not signed in as staff." };

  const inv = await db.invoice.findUnique({
    where: { id: input.invoiceId },
    select: { id: true, invoiceNumber: true, status: true, branchId: true, subtotalSen: true, discountSen: true, taxSen: true, totalSen: true, manualDiscountSen: true, manualDiscountKind: true, manualDiscountValue: true, manualDiscountReason: true },
  });
  if (!inv) return { ok: false as const, error: "Invoice not found." };

  // Strict branch isolation, the same rule the invoice list uses: a branch-level user must
  // not be able to discount another branch's invoice by posting an id.
  const scope = scopedBranchId(session);
  if (scope && scope !== inv.branchId) return { ok: false as const, error: "This invoice belongs to another branch." };

  // A settled invoice is finished. Taking money off it now would be a refund, which is a
  // different operation with different consequences, and not something to do by accident.
  if (inv.status === "PAID") return { ok: false as const, error: "This invoice is already settled." };

  let request: DiscountRequest | null = null;
  if (input.discount) {
    const parsed = parseDiscount(input.discount.kind, input.discount.value);
    if (!parsed.ok) return { ok: false as const, error: parsed.error };
    request = parsed.request;
  }

  const bill = { subtotalSen: inv.subtotalSen, promoDiscountSen: inv.discountSen, taxSen: inv.taxSen };
  const { manualDiscountSen, totalSen } = applyDiscount(bill, request);

  // Money already collected is money the customer has handed over. A discount cannot take the
  // total below it — the difference would be owed back to the customer, not discounted.
  const paid = await db.payment.aggregate({
    where: { invoiceId: inv.id, status: "PAID", method: { not: "PAY_LATER" } },
    _sum: { amountSen: true },
  });
  const paidSen = paid._sum.amountSen ?? 0;
  if (totalSen < paidSen) {
    return { ok: false as const, error: "That discount would take the total below the " + (paidSen / 100).toFixed(2) + " already collected." };
  }

  const reason = input.reason?.trim() || null;
  await db.$transaction([
    db.invoice.update({
      where: { id: inv.id },
      data: {
        manualDiscountSen,
        manualDiscountKind: request?.kind ?? null,
        manualDiscountValue: request?.value ?? null,
        manualDiscountReason: request ? reason : null,
        manualDiscountAt: request ? new Date() : null,
        totalSen,
      },
    }),
    // completion.ts leaves a PAY_LATER/PENDING receivable for the original total. It is the
    // accounts-receivable placeholder, so it has to track the total or the books disagree.
    db.payment.updateMany({ where: { invoiceId: inv.id, method: "PAY_LATER", status: "PENDING" }, data: { amountSen: totalSen } }),
  ]);

  await audit({
    organisationId: session.orgId,
    branchId: inv.branchId,
    userId: session.user?.id ?? null,
    action: request ? "INVOICE_DISCOUNT_APPLIED" : "INVOICE_DISCOUNT_CLEARED",
    entity: "Invoice",
    entityId: inv.id,
    before: { totalSen: inv.totalSen, manualDiscountSen: inv.manualDiscountSen, kind: inv.manualDiscountKind, value: inv.manualDiscountValue, reason: inv.manualDiscountReason },
    after: { totalSen, manualDiscountSen, kind: request?.kind ?? null, value: request?.value ?? null, reason: request ? reason : null },
  });

  revalidatePath("/workshop/finance/invoices");
  revalidatePath("/rider/invoices");
  revalidatePath("/invoice/" + inv.id);
  return { ok: true as const, manualDiscountSen, totalSen, paidSen };
}
