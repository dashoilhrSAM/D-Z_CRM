// 文档的**纯规则**（可单测，不碰数据库）。
//
// 为什么单独一个文件：这些规则同时被三条路径用到 —— 上传（Server Action）、
// 下载（API 路由的鉴权判定）、以及将来的 Excel/批量导入（P2）。写在 action 里就等于三份实现。

/** 文档类型。加新类型时**必须**同时想清楚：保留期给多久、谁有权看。 */
export const DOCUMENT_KINDS = [
  "CUSTOMER_ID",      // 客户身份证 / 驾照
  "INSURANCE",        // 保险单
  "WARRANTY",         // 保修单
  "INVOICE",          // 发票（打印/扫描件）
  "QUOTE",            // 报价单
  "PURCHASE_ORDER",   // 采购单
  "SUPPLIER_DOC",     // 供应商文件（报价、对账单）
  "STAFF_DOC",        // 员工证件
  "PHOTO",            // 通用照片（工单照片走 ServiceJobPhoto，不在这里）
  "OTHER",
] as const;

export type DocumentKind = (typeof DOCUMENT_KINDS)[number];

export function isDocumentKind(v: string): v is DocumentKind {
  return (DOCUMENT_KINDS as readonly string[]).includes(v);
}

/** 单文件上限 20MB（老板确认）。手机拍的 PDF 通常 2-5MB。 */
export const MAX_DOCUMENT_BYTES = 20 * 1024 * 1024;

/**
 * 允许的类型白名单。
 * 刻意**不含** svg（可内嵌脚本）与 html（可钓鱼）—— 这两类"文档"在浏览器里是代码。
 */
export const ALLOWED_DOCUMENT_MIME = [
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document", // docx
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",       // xlsx
] as const;

export type UploadCheck = { ok: true } | { ok: false; error: string };

/** 上传前的校验：类型 + 大小 + 文件名。返回人话错误，直接能显示给柜台。 */
export function validateDocumentUpload(input: {
  fileName: string;
  mimeType: string;
  sizeBytes: number;
}): UploadCheck {
  const name = (input.fileName ?? "").trim();
  if (!name) return { ok: false, error: "File has no name" };
  if (name.length > 200) return { ok: false, error: "File name is too long (200 characters max)" };
  if (!(ALLOWED_DOCUMENT_MIME as readonly string[]).includes(input.mimeType)) {
    return { ok: false, error: "This file type is not allowed (PDF, JPG, PNG, WEBP, HEIC, DOCX, XLSX only)" };
  }
  const size = Math.round(input.sizeBytes);
  if (!Number.isFinite(size) || size <= 0) return { ok: false, error: "File is empty" };
  if (size > MAX_DOCUMENT_BYTES) {
    return { ok: false, error: "File is larger than 20MB" };
  }
  return { ok: true };
}

/**
 * 保留期（月）。null = 不自动删。
 *
 * 老板 2026-09-23 拍板：发票与收款 7 年、工单与照片 2 年、客户证件在关系结束后 1 年。
 * 「关系结束后」需要事件支撑，目前先用**上传后 12 个月**近似，等客户生命周期有了明确字段再改基准
 * —— 这里写清楚，免得以后有人以为它算错了。
 */
export function retentionMonthsFor(kind: DocumentKind): number | null {
  switch (kind) {
    case "INVOICE":
    case "QUOTE":
    case "PURCHASE_ORDER":
      return 84; // 7 年：财务单据（对账、审计、税务）
    case "CUSTOMER_ID":
    case "INSURANCE":
    case "WARRANTY":
      return 12; // 12 个月（近似"关系结束后 1 年"，见上）
    case "STAFF_DOC":
    case "SUPPLIER_DOC":
      return 24;
    case "PHOTO":
    case "OTHER":
      return 24;
    default:
      return null;
  }
}

/** 算出到期日；不自动删的类型返回 null。 */
export function retainUntilFor(kind: DocumentKind, from: Date): Date | null {
  const months = retentionMonthsFor(kind);
  if (months === null) return null;
  const d = new Date(from.getTime());
  d.setMonth(d.getMonth() + months);
  return d;
}

/** 到期前多少天开始提醒（老板批准的方案里写的是 30 天）。 */
export const EXPIRY_WARN_DAYS = 30;

export type ExpiryDecision = "EXPIRE" | "WARN" | "NONE";

/**
 * 到期判定（纯函数，可单测 —— 这是 P1 里最容易算错的一块）。
 *
 * 三条刻意的规则：
 *  ① **legalHold 永不自动过期**（争议/审计期间，自动删会毁证据）；
 *  ② 已软删的不再处理（它已经不可见了，再标一次只会制造噪声）；
 *  ③ ARRIVED 但已 ARCHIVED/EXPIRED 的不重复标（否则每次 cron 都会改一遍 updatedAt）。
 */
export function expiryDecision(
  doc: { status: string; retainUntil: Date | null; legalHold: boolean; deletedAt: Date | null },
  now: Date,
  warnDays = EXPIRY_WARN_DAYS,
): ExpiryDecision {
  if (doc.deletedAt) return "NONE";
  if (doc.legalHold) return "NONE";
  if (!doc.retainUntil) return "NONE";
  if (doc.status === "EXPIRED" || doc.status === "ARCHIVED" || doc.status === "DELETED") return "NONE";
  const at = doc.retainUntil.getTime();
  if (at <= now.getTime()) return "EXPIRE";
  if (at <= now.getTime() + warnDays * 24 * 60 * 60 * 1000) return "WARN";
  return "NONE";
}

/** 允许的下载/存取判定用到的模块：文档挂在谁身上，就看谁那个模块的权限。 */
export function moduleForDocumentLink(link: {
  customerId?: string | null;
  motorcycleId?: string | null;
  jobId?: string | null;
  invoiceId?: string | null;
  purchaseOrderId?: string | null;
  supplierId?: string | null;
  leadId?: string | null;
  bookingId?: string | null;
}): "CUSTOMERS" | "JOB_CARDS" | "FINANCE" | "PARTS" | "LEADS" | "BOOKINGS" {
  if (link.customerId || link.motorcycleId) return "CUSTOMERS";
  if (link.jobId) return "JOB_CARDS";
  if (link.invoiceId) return "FINANCE";
  if (link.purchaseOrderId || link.supplierId) return "PARTS";
  if (link.leadId) return "LEADS";
  if (link.bookingId) return "BOOKINGS";
  return "CUSTOMERS";
}
