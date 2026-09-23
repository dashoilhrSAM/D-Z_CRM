import { createHash, randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import { storageProvider } from "@/providers";
import { PRIVATE_OBJECT_PREFIX, isPrivateObjectKey } from "@/providers/types";
import { can, isHeadOfficeRole } from "@/lib/auth/permissions";
import { audit } from "@/lib/auth/audit";
import { moduleForDocumentLink, retainUntilFor, type DocumentKind } from "@/lib/documents/validate";

/**
 * 文档通路（P0）—— 唯一写入者。
 *
 * 三条不变量：
 *  ① **只存 storageKey，不存 URL**：文件在私有桶里，读取一律经 /api/documents/[id]/file 鉴权。
 *  ② **跨组织一律拒绝**，然后是"上传者本人 / 有该模块 view 权限 + 分行匹配（org 级角色看全部）"。
 *  ③ 上传与台账同一思路：**先建行再传文件**，文件传失败就把行删掉 —— 宁可没有记录，
 *     也不要留下一条指向不存在文件的记录（那种记录会让人以为文件丢了）。
 */

export interface DocumentLink {
  customerId?: string | null;
  motorcycleId?: string | null;
  leadId?: string | null;
  bookingId?: string | null;
  jobId?: string | null;
  invoiceId?: string | null;
  purchaseOrderId?: string | null;
  supplierId?: string | null;
}

export interface DocumentUser {
  id: string;
  role: string;
  organisationId: string;
  branchId: string | null;
}

/** 私有对象键：private/ 前缀是 putPrivate 的前置条件（见 providers/types.ts）。 */
export function documentStorageKey(organisationId: string, documentId: string): string {
  return PRIVATE_OBJECT_PREFIX + "documents/" + organisationId + "/" + documentId;
}

export function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export async function createDocument(input: {
  organisationId: string;
  branchId: string | null;
  uploadedById: string;
  kind: DocumentKind;
  link: DocumentLink;
  fileName: string;
  mimeType: string;
  bytes: Uint8Array;
}): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  // id 自己生成：storageKey 要在写库时就有值（否则得先写行、再改键，多一次写）
  const id = randomUUID();
  const storageKey = documentStorageKey(input.organisationId, id);
  if (!isPrivateObjectKey(storageKey)) return { ok: false, error: "Internal: key must be private" };

  const now = new Date();
  await db.document.create({
    data: {
      id,
      organisationId: input.organisationId,
      branchId: input.branchId,
      kind: input.kind,
      status: "UPLOADED",
      storageKey,
      fileName: input.fileName,
      mimeType: input.mimeType,
      sizeBytes: input.bytes.byteLength,
      sha256: sha256Hex(input.bytes),
      customerId: input.link.customerId ?? null,
      motorcycleId: input.link.motorcycleId ?? null,
      leadId: input.link.leadId ?? null,
      bookingId: input.link.bookingId ?? null,
      jobId: input.link.jobId ?? null,
      invoiceId: input.link.invoiceId ?? null,
      purchaseOrderId: input.link.purchaseOrderId ?? null,
      supplierId: input.link.supplierId ?? null,
      uploadedById: input.uploadedById,
      uploadedAt: now,
      retainUntil: retainUntilFor(input.kind, now),
    },
  });

  try {
    await storageProvider.putPrivate(storageKey, input.bytes, input.mimeType);
  } catch (e) {
    // 补偿：文件没传上去就不该留一条记录（宁可没有记录，也不要"记录在、文件不在"）
    await db.document.delete({ where: { id } }).catch(() => null);
    throw e;
  }

  await audit({
    organisationId: input.organisationId,
    branchId: input.branchId,
    userId: input.uploadedById,
    action: "DOCUMENT_UPLOAD",
    entity: "Document",
    entityId: id,
    after: { kind: input.kind, fileName: input.fileName, sizeBytes: input.bytes.byteLength, link: input.link },
  });
  return { ok: true, id };
}

/** 按关联对象列文档（页面用）。默认不返回已软删的。 */
export async function listDocuments(where: {
  organisationId: string;
  link: DocumentLink;
  includeDeleted?: boolean;
}) {
  const { organisationId, link, includeDeleted } = where;
  return db.document.findMany({
    where: {
      organisationId,
      ...(includeDeleted ? {} : { deletedAt: null }),
      ...(link.customerId ? { customerId: link.customerId } : {}),
      ...(link.motorcycleId ? { motorcycleId: link.motorcycleId } : {}),
      ...(link.jobId ? { jobId: link.jobId } : {}),
      ...(link.invoiceId ? { invoiceId: link.invoiceId } : {}),
      ...(link.leadId ? { leadId: link.leadId } : {}),
      ...(link.bookingId ? { bookingId: link.bookingId } : {}),
      ...(link.purchaseOrderId ? { purchaseOrderId: link.purchaseOrderId } : {}),
      ...(link.supplierId ? { supplierId: link.supplierId } : {}),
    },
    orderBy: { uploadedAt: "desc" },
    take: 100,
  });
}

/**
 * 能不能看这份文档。
 * 顺序刻意：跨组织先拒（任何理由都不能越过组织边界），再看本人，再看模块权限 + 分行。
 */
export async function canAccessDocument(user: DocumentUser, doc: {
  organisationId: string;
  branchId: string | null;
  uploadedById: string | null;
} & DocumentLink): Promise<boolean> {
  if (doc.organisationId !== user.organisationId) return false;
  if (doc.uploadedById && doc.uploadedById === user.id) return true;
  // 变量名不叫 module：Next 有 lint 规则禁止（它是打包期的保留名）
  const permissionModule = moduleForDocumentLink(doc);
  const seesModule = await can({ id: user.id, role: user.role as never, organisationId: user.organisationId }, permissionModule, "view");
  if (!seesModule) return false;
  if (isHeadOfficeRole(user.role)) return true;
  return doc.branchId !== null && doc.branchId === user.branchId;
}

/** 审核（VERIFIED / REJECTED）。留痕：谁、何时、为什么。 */
export async function decideDocument(input: {
  id: string;
  user: DocumentUser;
  approve: boolean;
  note?: string | null;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const doc = await db.document.findUnique({ where: { id: input.id } });
  if (!doc || doc.organisationId !== input.user.organisationId) return { ok: false, error: "Not found" };
  if (!(await canAccessDocument(input.user, doc))) return { ok: false, error: "Not allowed" };

  const status = input.approve ? "VERIFIED" : "REJECTED";
  await db.document.update({
    where: { id: doc.id },
    data: { status, verifiedById: input.user.id, verifiedAt: new Date(), verifyNote: input.note ?? null },
  });
  await audit({
    organisationId: doc.organisationId, branchId: doc.branchId, userId: input.user.id,
    action: "DOCUMENT_VERIFY", entity: "Document", entityId: doc.id,
    before: { status: doc.status }, after: { status },
  });
  return { ok: true };
}

/** 软删（只有 OWNER 能删，见 actions）。文件本身留到保留期清理，先让它不可见。 */
export async function softDeleteDocument(input: {
  id: string;
  user: DocumentUser;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const doc = await db.document.findUnique({ where: { id: input.id } });
  if (!doc || doc.organisationId !== input.user.organisationId) return { ok: false, error: "Not found" };
  if (!(await canAccessDocument(input.user, doc))) return { ok: false, error: "Not allowed" };
  await db.document.update({ where: { id: doc.id }, data: { status: "DELETED", deletedAt: new Date() } });
  await audit({
    organisationId: doc.organisationId, branchId: doc.branchId, userId: input.user.id,
    action: "DOCUMENT_DELETE", entity: "Document", entityId: doc.id,
    before: { status: doc.status, fileName: doc.fileName }, after: { status: "DELETED" },
  });
  return { ok: true };
}

/** 读取内容（下载路由用）。这里**不做**权限判定 —— 由调用方先 canAccessDocument，避免两套规则。 */
export async function readDocumentBytes(doc: { id: string; storageKey: string }) {
  if (!isPrivateObjectKey(doc.storageKey)) return null;
  return storageProvider.getPrivate(doc.storageKey);
}
