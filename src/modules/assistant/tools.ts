import "server-only";
import { db } from "@/lib/db";
import { bookingService } from "@/modules/bookings/service";
import { financeService } from "@/modules/finance/service";
import { inventoryService } from "@/modules/inventory/service";
import { salesAnalytics, serviceAnalytics, customerAnalytics, revenueAnalytics, inventoryAnalytics, monthlyServiceAnalytics, brandAnalytics } from "@/modules/analytics/service";

export interface AssistantCtx {
  orgId: string;
  branchId: string | null;
  role: string;
  lang: string;
}

export interface Guide {
  title: string;
  steps: string[];
}

/** Curated how-to guides (neutral English; the LLM localizes into the reply language). */
export const GUIDES: Record<"invoice" | "create-job" | "checkin", Guide> = {
  invoice: {
    title: "Create an invoice / record a payment",
    steps: [
      "Open a service job (Workshop → Jobs → a job). The invoice is issued automatically when the job is Completed.",
      "See all customer invoices in Workshop → Finance → Invoices.",
      "To record a payment: open the job (or the Invoices row) → payment panel → enter the amount and method (CASH / CARD / ONLINE / EWALLET) → Save. It auto-closes once fully paid.",
      "Download / print the invoice as PDF from the payment panel or the Invoices page.",
    ],
  },
  "create-job": {
    title: "Create a service / repair job",
    steps: [
      "Workshop → Jobs → Create Service Job (or Create Repair Job).",
      "Pick the customer + motorcycle, the service type (for REPAIR add parts & labour), and the mechanic.",
      "Save — the job appears on the board. Assign a mechanic to start work.",
    ],
  },
  checkin: {
    title: "Check in a booking",
    steps: [
      "Workshop → Bookings → open a confirmed booking → Check In.",
      "For SERVICE: a job (and a quotation for customer approval) is generated automatically.",
      "For REPAIR: after check-in, use Create Repair Job in the Bookings page and build the parts + labour.",
      "Send the quotation for customer approval before assigning a mechanic.",
    ],
  },
};

export interface ToolResult { context: string; }

/** sen → "RM 1,234.56" (pre-formatted so the model never does sen→RM math). */
function formatRM(sen: number): string {
  return "RM " + (sen / 100).toLocaleString("en-MY", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** Compact a {label,value}[] into "label=value, ..." (top N). */
function compact(arr: { label: string; value: number }[], n = 5): string {
  return arr.slice(0, n).map((x) => x.label + "=" + x.value).join(", ");
}

export async function runTool(kind: string, ctx: AssistantCtx): Promise<ToolResult> {
  switch (kind) {
    case "booking_today": {
      const s = await bookingService.stats();
      return { context: "todayBookings=" + s.today + "; requested=" + s.requested + "; confirmed=" + s.confirmed };
    }
    case "revenue_today": {
      const d = await financeService.dashboard();
      // Pre-format the RM value so the model never does sen→RM math (it hallucinated before).
      const rm = "RM " + (d.revenue / 100).toLocaleString("en-MY", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      return { context: "todayRevenue=" + rm + " (" + d.revenue + " sen); todayInvoiceCount=" + d.count };
    }
    case "customers_count": {
      const n = await db.customer.count({ where: ctx.orgId ? { organisationId: ctx.orgId } : {} });
      return { context: "totalCustomers=" + n };
    }
    case "jobs_overview": {
      const where = ctx.branchId ? { branchId: ctx.branchId } : {};
      const active = await db.serviceJob.count({ where: { ...where, status: { notIn: ["COMPLETED", "CANCELLED"] } } });
      const done = await db.serviceJob.count({ where: { ...where, status: "COMPLETED" } });
      return { context: "activeJobs=" + active + "; completedJobs=" + done };
    }
    case "stock_alerts": {
      const where = ctx.branchId ? { branchId: ctx.branchId } : {};
      const low = await db.inventory.count({ where: { ...where, quantity: { lte: 3 } } });
      return { context: "lowStockItems=" + low };
    }
    case "reminders_due": {
      const due = await db.serviceReminder.count({ where: { status: { in: ["DUE", "OVERDUE"] } } });
      return { context: "dueReminders=" + due };
    }
    case "check_ins": {
      const where = ctx.branchId ? { branchId: ctx.branchId, status: "CHECKED_IN" as const } : { status: "CHECKED_IN" as const };
      const n = await db.booking.count({ where });
      return { context: "checkedInBookings=" + n };
    }
    case "parts_count": {
      const where = ctx.branchId ? { branchId: ctx.branchId } : {};
      const agg = await db.inventory.aggregate({ where, _sum: { quantity: true } });
      const units = agg._sum.quantity ?? 0;
      const skus = await db.product.count();
      return { context: "totalPartsUnits=" + units + "; productSkuCount=" + skus };
    }
    case "month_earnings": {
      const d = await financeService.periodDashboard("month", undefined, undefined);
      return { context: "monthRevenue=" + formatRM(d.revenue) + " (" + d.revenue + " sen); monthInvoiceCount=" + d.count };
    }
    case "dead_stock_value": {
      const bid = ctx.branchId || (await db.branch.findFirst({ where: { isMain: true }, select: { id: true } }))?.id;
      const valSen = bid ? await inventoryService.deadStockValue(bid) : 0;
      return { context: "deadStockValue=" + formatRM(valSen) + " (" + valSen + " sen)" };
    }
    case "overdue_customers": {
      const rows = await db.serviceReminder.findMany({ where: { status: { in: ["OVERDUE", "DUE"] } }, distinct: ["customerId"], select: { customerId: true } });
      return { context: "overdueCustomers=" + rows.length };
    }
    case "average_rating": {
      const agg = await db.review.aggregate({ where: { status: { in: ["SUBMITTED", "PUBLISHED"] }, rating: { not: null } }, _avg: { rating: true } });
      const avg = agg._avg.rating ? (Math.round(agg._avg.rating * 10) / 10).toFixed(1) : "0.0";
      return { context: "averageRating=" + avg };
    }
    case "analytics_service": {
      const s = await serviceAnalytics(ctx.orgId, 30);
      return { context: "serviceAnalytics30d: bookings=" + s.total + "; completed=" + s.completed + "; cancelled=" + s.cancelled + "; noShow=" + s.noShow + "; throughput=" + s.throughput + "; avgCompletionDays=" + s.avgCompletionDays + "; waitingParts=" + s.waitingParts + "; topServices=" + compact(s.topServices) + "; workload=" + compact(s.technicianWorkload) };
    }
    case "analytics_revenue": {
      const r = await revenueAnalytics(ctx.orgId, 30);
      return { context: "revenue30d=" + formatRM(r.total) + "; prev30d=" + formatRM(r.prevTotal) + "; pctChange=" + r.pctChange + "%; avgPerCustomer=" + formatRM(r.avgPerCustomer) + "; repeatRevenue=" + formatRM(r.repeatRevenue) + "; topServiceTypes=" + compact(r.byServiceType) + "; topCustomers=" + compact(r.perCustomer) };
    }
    case "analytics_customers": {
      const c = await customerAnalytics(ctx.orgId, 30);
      return { context: "customerAnalytics: total=" + c.total + "; new=" + c.new + "; repeat=" + c.repeat + "; retentionRate=" + c.retentionRate + "%; avgServiceFrequency=" + c.avgServiceFrequency + "; members=" + c.members + "; referrals=" + c.referrals + "; inactive=" + c.inactive };
    }
    case "analytics_monthly_services": {
      const m = await monthlyServiceAnalytics(ctx.orgId, 12);
      return { context: "monthlyServices=" + m.map((x) => x.key + "(" + x.count + " jobs/" + x.vehicles + " bikes)").join(", ") };
    }
    case "analytics_brand": {
      const b = await brandAnalytics(ctx.orgId, 365);
      return { context: "brands365d=" + b.slice(0, 6).map((x) => x.brand + "(jobs=" + x.count + ",vehicles=" + x.vehicles + ",share=" + x.share + "%,salesSen=" + x.salesSen + ")").join(", ") };
    }
    case "analytics_inventory": {
      const i = await inventoryAnalytics(ctx.orgId);
      return { context: "inventoryAnalytics: totalItems=" + i.totalItems + "; lowStock=" + i.lowStock + "; outOfStock=" + i.outOfStock + "; totalQty=" + i.totalQty + "; movements=" + i.movements };
    }
    case "analytics_sales": {
      const s = await salesAnalytics(ctx.orgId, 30);
      return { context: "salesAnalytics30d: leads=" + s.total + "; won=" + s.won + "; lost=" + s.lost + "; conversionRate=" + s.conversionRate + "%; staleLeads=" + s.stale + "; topSources=" + compact(s.bySource) + "; topSalespeople=" + compact(s.bySalesperson) + "; topModels=" + compact(s.byModel) };
    }
    case "analytics_overview": {
      const [svc, rev, cust] = await Promise.all([serviceAnalytics(ctx.orgId, 30), revenueAnalytics(ctx.orgId, 30), customerAnalytics(ctx.orgId, 30)]);
      const brand = await brandAnalytics(ctx.orgId, 365);
      return { context: "overview30d: bookings=" + svc.total + "; completed=" + svc.completed + "; revenue=" + formatRM(rev.total) + "; pctChange=" + rev.pctChange + "%; customers=" + cust.total + "; repeat=" + cust.repeat + "; retention=" + cust.retentionRate + "%; topBrand=" + (brand[0] ? brand[0].brand : "n/a") };
    }
    default:
      return { context: "" };
  }
}