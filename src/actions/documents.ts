"use server";

import { revalidatePath } from "next/cache";
import { getSessionUser } from "@/lib/session-user";
import { can } from "@/lib/auth/permissions";
import {
  isDocumentKind,
  moduleForDocumentLink,
  validateDocumentUpload,
  DOCUMENT_KINDS,
  MAX_DOCUMENT_BYTES,
} from "@/lib/documents/validate";
import {
  createDocument,
  decideDocument,
  softDeleteDocument,
  type DocumentLink,
  type DocumentUser,
} from "@/modules/documents/service";

/**
 * 文档的写入口（P0）。
 *
 * 权限按**文档挂在谁身上**决定（moduleForDocumentLink）：客户证件看 CUSTOMERS、工单看 JOB_CARDS……
 * 审核 = 该模块的 edit + MANAGER/org 级角色（老板 2026-09-23 拍板「manager 也可以」）；
 * 删除 = 只有 OWNER / SUPER_ADMIN（删的是别人的证件，门槛要最高）。
 */

const ORG_LEVEL = ["OWNER", "SUPER_ADMIN"];

function staffUser(session: Awaited<ReturnType<typeof getSessionUser>>): DocumentUser | null {
  if (session.kind !== "staff" || !session.user) return null;
  return { id: session.user.id, role: session.role as string, organisationId: session.orgId, branchId: session.branchId ?? null };
}

function otherRolesBlocked(role: string) {
  return !ORG_LEVEL.includes(role);
}

export async function uploadDocumentAction(
  formData: FormData,
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const session = await getSessionUser();
  const user = staffUser(session);
  if (!user) return { ok: false, error: "Not signed in" };

  const kind = String(formData.get("kind") ?? "");
  if (!isDocumentKind(kind)) return { ok: false, error: "Unknown document type" };

  const link: DocumentLink = {
    customerId: (formData.get("customerId") as string) || null,
    motorcycleId: (formData.get("motorcycleId") as string) || null,
    jobId: (formData.get("jobId") as string) || null,
    invoiceId: (formData.get("invoiceId") as string) || null,
    leadId: (formData.get("leadId") as string) || null,
    bookingId: (formData.get("bookingId") as string) || null,
    purchaseOrderId: (formData.get("purchaseOrderId") as string) || null,
    supplierId: (formData.get("supplierId") as string) || null,
  };
  if (!Object.values(link).some(Boolean)) return { ok: false, error: "A document must be attached to something" };

  const allowed = await can(
    { id: user.id, role: user.role as never, organisationId: user.organisationId },
    moduleForDocumentLink(link),
    "edit",
  );
  if (!allowed) return { ok: false, error: "No permission to add documents here" };

  const file = formData.get("file");
  if (!(file instanceof File)) return { ok: false, error: "No file" };
  const bytes = new Uint8Array(await file.arrayBuffer());

  const check = validateDocumentUpload({
    fileName: file.name,
    mimeType: file.type || "application/octet-stream",
    sizeBytes: bytes.byteLength,
  });
  if (!check.ok) return { ok: false, error: check.error };

  const res = await createDocument({
    organisationId: user.organisationId,
    branchId: session.branchId ?? null,
    uploadedById: user.id,
    kind,
    link,
    fileName: file.name,
    mimeType: file.type || "application/octet-stream",
    bytes,
  });
  if (res.ok) {
    revalidatePath("/workshop/customers");
    revalidatePath("/workshop/jobs");
  }
  return res;
}

export async function decideDocumentAction(input: {
  id: string;
  approve: boolean;
  note?: string | null;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const session = await getSessionUser();
  const user = staffUser(session);
  if (!user) return { ok: false, error: "Not signed in" };
  if (user.role === "MECHANIC") return { ok: false, error: "Not allowed" };
  const res = await decideDocument({ id: input.id, user, approve: input.approve, note: input.note ?? null });
  if (res.ok) revalidatePath("/workshop/customers");
  return res;
}

export async function deleteDocumentAction(input: { id: string }): Promise<{ ok: true } | { ok: false; error: string }> {
  const session = await getSessionUser();
  const user = staffUser(session);
  if (!user) return { ok: false, error: "Not signed in" };
  if (otherRolesBlocked(user.role)) return { ok: false, error: "Only the owner can delete documents" };
  const res = await softDeleteDocument({ id: input.id, user });
  if (res.ok) revalidatePath("/workshop/customers");
  return res;
}

/** 给界面用的常量（避免前后端两套白名单）。 */
export async function documentOptions() {
  return { kinds: DOCUMENT_KINDS, maxBytes: MAX_DOCUMENT_BYTES };
}
