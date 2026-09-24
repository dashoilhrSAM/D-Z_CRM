// 文档通路 P0。
//
// 这一期老板给的验收标准是：**上传后，未授权访问该文件必须失败**。
// 所以测试的重点不是"能上传"，而是**权限矩阵的每一条边界**：
// 跨组织、跨分行、无模块权限、以及"上传者本人"这条特别的例外。
//
// 另外钉住两条纯规则：上传校验（类型/大小）与保留期 —— 它们将来会被 Excel 导入复用（P2）。
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const saved = { databaseUrl: process.env.DATABASE_URL };
const tag = "doc" + Date.now().toString(36);

let db: typeof import("@/lib/db")["db"];
let service: typeof import("@/modules/documents/service");
let validate: typeof import("@/lib/documents/validate");

let orgA = "", orgB = "";
let branchA1 = "", branchA2 = "";
let ownerA = "", ownerB = "", managerA1 = "", managerA2 = "", mechA1 = "";
let customerA = "";
const docIds: string[] = [];
const keys: string[] = [];

const PDF = { fileName: "ic.pdf", mimeType: "application/pdf", sizeBytes: 1024 };

function user(id: string, role: string, organisationId: string, branchId: string | null) {
  return { id, role, organisationId, branchId };
}

beforeAll(async () => {
  process.env.DATABASE_URL = saved.databaseUrl ?? "file:./dev.db";
  ({ db } = await import("@/lib/db"));
  service = await import("@/modules/documents/service");
  validate = await import("@/lib/documents/validate");

  const a = await db.organisation.create({ data: { name: "DOC-A-" + tag } });
  const b = await db.organisation.create({ data: { name: "DOC-B-" + tag } });
  orgA = a.id; orgB = b.id;
  const a1 = await db.branch.create({ data: { organisationId: a.id, name: "Doc A1", city: "Petaling Jaya" } });
  const a2 = await db.branch.create({ data: { organisationId: a.id, name: "Doc A2", city: "Klang" } });
  branchA1 = a1.id; branchA2 = a2.id;

  const mk = async (org: string, branch: string | null, role: "OWNER" | "MANAGER" | "MECHANIC", name: string) =>
    (await db.user.create({
      // 注意保留数字：原来写的是 [^a-z]（连数字也去掉），于是 DocMgrA1 / DocMgrA2
      // 会生成**同一个邮箱** —— 以前只是悄悄建出两行（正是生产上那个重复身份的微缩版），
      // 加了邮箱唯一约束之后它立刻暴露了。
      data: { organisationId: org, branchId: branch, name, email: name.toLowerCase().replace(/[^a-z0-9]/g, "") + "-" + tag + "@dsh.test", role },
    })).id;

  ownerA = await mk(orgA, branchA1, "OWNER", "DocOwnerA");
  ownerB = await mk(orgB, null, "OWNER", "DocOwnerB");
  managerA1 = await mk(orgA, branchA1, "MANAGER", "DocMgrA1");
  managerA2 = await mk(orgA, branchA2, "MANAGER", "DocMgrA2");
  mechA1 = await mk(orgA, branchA1, "MECHANIC", "DocMechA1");

  customerA = (await db.customer.create({ data: { organisationId: orgA, name: "Doc Customer " + tag } })).id;
});

afterAll(async () => {
  // 顺序要紧：审计行挂着 organisation 外键，不先删就删不掉组织（第一次跑就是这么红的）
  await db.auditLog.deleteMany({ where: { organisationId: { in: [orgA, orgB] } } });
  // 通知挂着 user 外键（到期扫描会给 org 级账号发通知）——不先删就删不掉用户
  await db.notification.deleteMany({ where: { userId: { in: [ownerA, ownerB, managerA1, managerA2, mechA1] } } });
  await db.document.deleteMany({ where: { organisationId: { in: [orgA, orgB] } } });
  await db.user.deleteMany({ where: { organisationId: { in: [orgA, orgB] } } });
  await db.customer.deleteMany({ where: { organisationId: { in: [orgA, orgB] } } });
  await db.branch.deleteMany({ where: { organisationId: { in: [orgA, orgB] } } });
  await db.organisation.deleteMany({ where: { id: { in: [orgA, orgB] } } });
  // 本地 provider 会把字节真的写进 ./storage —— 测试要自己收拾干净
  for (const k of keys) {
    const p = path.join(process.cwd(), "storage", k);
    try { fs.unlinkSync(p); } catch { /* 已经不在就算了 */ }
  }
});

async function upload(orgId: string, branchId: string | null, by: string, kind = "CUSTOMER_ID" as const) {
  const bytes = new TextEncoder().encode("PDF-ish content " + Math.random());
  const res = await service.createDocument({
    organisationId: orgId, branchId, uploadedById: by, kind,
    link: { customerId: orgId === orgA ? customerA : null },
    fileName: PDF.fileName, mimeType: PDF.mimeType, bytes,
  });
  if (!res.ok) throw new Error("upload failed: " + res.error);
  docIds.push(res.id);
  const row = await db.document.findUnique({ where: { id: res.id } });
  if (row) keys.push(row.storageKey);
  return res.id;
}

describe("上传校验（纯规则）", () => {
  it("接受 PDF / JPG，拒绝 svg 与 html（这两类在浏览器里是代码）", () => {
    expect(validate.validateDocumentUpload(PDF).ok).toBe(true);
    expect(validate.validateDocumentUpload({ ...PDF, mimeType: "image/jpeg" }).ok).toBe(true);
    expect(validate.validateDocumentUpload({ ...PDF, mimeType: "image/svg+xml" }).ok).toBe(false);
    expect(validate.validateDocumentUpload({ ...PDF, mimeType: "text/html" }).ok).toBe(false);
  });

  it("超过 20MB 拒绝，空文件拒绝", () => {
    expect(validate.validateDocumentUpload({ ...PDF, sizeBytes: validate.MAX_DOCUMENT_BYTES + 1 }).ok).toBe(false);
    expect(validate.validateDocumentUpload({ ...PDF, sizeBytes: 0 }).ok).toBe(false);
  });

  it("保留期：财务单据 7 年、客户证件 12 个月、算得出到期日", () => {
    expect(validate.retentionMonthsFor("INVOICE")).toBe(84);
    expect(validate.retentionMonthsFor("CUSTOMER_ID")).toBe(12);
    const from = new Date("2026-01-15T00:00:00Z");
    expect(validate.retainUntilFor("INVOICE", from)!.toISOString().slice(0, 7)).toBe("2033-01");
  });

  it("文档挂在谁身上决定看哪个模块的权限", () => {
    expect(validate.moduleForDocumentLink({ customerId: "c" })).toBe("CUSTOMERS");
    expect(validate.moduleForDocumentLink({ jobId: "j" })).toBe("JOB_CARDS");
    expect(validate.moduleForDocumentLink({ invoiceId: "i" })).toBe("FINANCE");
  });
});

describe("上传落库：只存私有键，不存 URL", () => {
  it("建出 UPLOADED 行、storageKey 是私有前缀、有 sha256 与到期日", async () => {
    const id = await upload(orgA, branchA1, managerA1);
    const row = (await db.document.findUnique({ where: { id } }))!;
    expect(row.status).toBe("UPLOADED");
    expect(row.storageKey.startsWith("private/")).toBe(true);
    expect(row.storageKey).not.toContain("http");
    expect(row.sha256).toHaveLength(64);
    expect(row.retainUntil).not.toBeNull();
    // 文件真的在本地 provider 的私有区里（P0 的存储位置要求）
    expect(fs.existsSync(path.join(process.cwd(), "storage", row.storageKey))).toBe(true);
  });

  it("同一份内容重复上传会得到相同的 sha256（将来做去重靠它）", async () => {
    const bytes = new TextEncoder().encode("identical");
    expect(service.sha256Hex(bytes)).toBe(service.sha256Hex(bytes));
  });
});

describe("**权限：未授权访问必须失败**（本期验收标准）", () => {
  it("跨组织：B 组织的 OWNER 看不了 A 组织的文档", async () => {
    const id = await upload(orgA, branchA1, managerA1);
    const row = (await db.document.findUnique({ where: { id } }))!;
    expect(await service.canAccessDocument(user(ownerB, "OWNER", orgB, null), row)).toBe(false);
  });

  it("上传者本人可以看（哪怕他没有该模块的权限）", async () => {
    const id = await upload(orgA, branchA1, mechA1);
    const row = (await db.document.findUnique({ where: { id } }))!;
    expect(await service.canAccessDocument(user(mechA1, "MECHANIC", orgA, branchA1), row)).toBe(true);
  });

  it("同分行 + 有模块权限 → 可以；**跨分行 → 不可以**", async () => {
    const id = await upload(orgA, branchA1, managerA1);
    const row = (await db.document.findUnique({ where: { id } }))!;
    // 换个上传者视角：把记录的上传者当成别人，模拟"不是我传的"
    const other = { ...row, uploadedById: ownerA };
    expect(await service.canAccessDocument(user(managerA1, "MANAGER", orgA, branchA1), other)).toBe(true);
    expect(await service.canAccessDocument(user(managerA2, "MANAGER", orgA, branchA2), other)).toBe(false);
  });

  it("org 级角色跨分行可以看；无模块权限的机修看不了别人的文档", async () => {
    const id = await upload(orgA, branchA1, managerA1);
    const row = (await db.document.findUnique({ where: { id } }))!;
    const other = { ...row, uploadedById: ownerA };
    expect(await service.canAccessDocument(user(ownerA, "OWNER", orgA, branchA1), other)).toBe(true);
    expect(await service.canAccessDocument(user(mechA1, "MECHANIC", orgA, branchA1), other)).toBe(false);
  });
});

describe("状态与删除", () => {
  it("审核后状态变成 VERIFIED 并留下审核人与时间", async () => {
    const id = await upload(orgA, branchA1, managerA1);
    const res = await service.decideDocument({ id, user: user(managerA1, "MANAGER", orgA, branchA1), approve: true, note: "看过了" });
    expect(res.ok).toBe(true);
    const row = (await db.document.findUnique({ where: { id } }))!;
    expect(row.status).toBe("VERIFIED");
    expect(row.verifiedById).toBe(managerA1);
    expect(row.verifiedAt).not.toBeNull();
  });

  it("软删后默认列表查不到，但行还在（审计要留得下来）", async () => {
    const id = await upload(orgA, branchA1, managerA1);
    await service.softDeleteDocument({ id, user: user(ownerA, "OWNER", orgA, branchA1) });
    const visible = await service.listDocuments({ organisationId: orgA, link: { customerId: customerA } });
    expect(visible.some((d) => d.id === id)).toBe(false);
    const row = await db.document.findUnique({ where: { id } });
    expect(row).not.toBeNull();
    expect(row!.status).toBe("DELETED");
  });
});

describe("到期规则（P1，纯函数）", () => {
  const now = new Date("2026-09-23T00:00:00Z");
  const base = { status: "UPLOADED", legalHold: false, deletedAt: null };

  it("过了到期日 → EXPIRE；30 天内 → WARN；还早 → NONE", () => {
    expect(validate.expiryDecision({ ...base, retainUntil: new Date("2026-09-01T00:00:00Z") }, now)).toBe("EXPIRE");
    expect(validate.expiryDecision({ ...base, retainUntil: new Date("2026-10-10T00:00:00Z") }, now)).toBe("WARN");
    expect(validate.expiryDecision({ ...base, retainUntil: new Date("2027-09-01T00:00:00Z") }, now)).toBe("NONE");
    expect(validate.expiryDecision({ ...base, retainUntil: null }, now)).toBe("NONE");
  });

  it("**legalHold 永不自动过期**（争议/审计期间，自动动它就是毁证据）", () => {
    expect(validate.expiryDecision({ ...base, legalHold: true, retainUntil: new Date("2026-01-01T00:00:00Z") }, now)).toBe("NONE");
  });

  it("已软删 / 已归档 / 已过期的**不重复处理**（否则每次 cron 都会改一遍 updatedAt）", () => {
    const past = new Date("2026-01-01T00:00:00Z");
    expect(validate.expiryDecision({ ...base, deletedAt: now, retainUntil: past }, now)).toBe("NONE");
    expect(validate.expiryDecision({ ...base, status: "EXPIRED", retainUntil: past }, now)).toBe("NONE");
    expect(validate.expiryDecision({ ...base, status: "ARCHIVED", retainUntil: past }, now)).toBe("NONE");
  });
});

describe("到期扫描（P1，会写库）", () => {
  async function seedDoc(opts: { retainUntil: Date; legalHold?: boolean; status?: string }) {
    const row = await db.document.create({
      data: {
        organisationId: orgA, branchId: branchA1, kind: "CUSTOMER_ID", status: opts.status ?? "UPLOADED",
        storageKey: "private/documents/" + orgA + "/" + Math.random().toString(36).slice(2),
        fileName: "expiry-" + Math.random().toString(36).slice(2) + ".pdf", mimeType: "application/pdf",
        sizeBytes: 100, sha256: "x".repeat(64), uploadedById: managerA1, customerId: customerA,
        retainUntil: opts.retainUntil, legalHold: opts.legalHold ?? false,
      },
    });
    docIds.push(row.id);
    return row.id;
  }

  it("把到期的标成 EXPIRED 并通知 org 级账号；**legalHold 的原封不动**", async () => {
    const now = new Date("2026-09-23T00:00:00Z");
    const due = await seedDoc({ retainUntil: new Date("2026-09-01T00:00:00Z") });
    const held = await seedDoc({ retainUntil: new Date("2026-09-01T00:00:00Z"), legalHold: true });
    const fresh = await seedDoc({ retainUntil: new Date("2027-09-01T00:00:00Z") });

    await db.notification.deleteMany({ where: { type: "DOCUMENT_EXPIRED" } });
    const res = await service.expireDueDocuments({ organisationId: orgA, now });

    expect(res.expired).toBe(1);
    expect((await db.document.findUnique({ where: { id: due } }))!.status).toBe("EXPIRED");
    expect((await db.document.findUnique({ where: { id: held } }))!.status).toBe("UPLOADED");
    expect((await db.document.findUnique({ where: { id: fresh } }))!.status).toBe("UPLOADED");
    // 通知发给了 org 级账号（OWNER），而不是每个员工
    const notes = await db.notification.findMany({ where: { type: "DOCUMENT_EXPIRED" } });
    expect(notes.length).toBeGreaterThan(0);
    expect(notes.every((n) => n.userId === ownerA)).toBe(true);
    await db.notification.deleteMany({ where: { type: "DOCUMENT_EXPIRED" } });
  });

  it("重复跑不会把已 EXPIRED 的再处理一遍（幂等）", async () => {
    const now = new Date("2026-09-23T00:00:00Z");
    const res = await service.expireDueDocuments({ organisationId: orgA, now });
    expect(res.expired).toBe(0);
  });
});
