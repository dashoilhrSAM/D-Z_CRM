import { db } from "@/lib/db";
import type { Prisma } from "@prisma/client";
import { audit } from "@/lib/auth/audit";
import { cellToValue, sameValue, type RowPlan } from "./diff";
import { SHEETS, type SheetDef } from "./sheets";
import { PRODUCTS_SHEET, PACKAGES_SHEET, PACKAGE_ITEMS_SHEET, CAMPAIGNS_SHEET, SUPPLIERS_SHEET, SERVICE_TYPES_SHEET, MOTORCYCLES_SHEET, CUSTOMERS_SHEET, normalizePlate, normalizePhone } from "./sheets";

/**
 * 应用已确认的差异（P2）。
 *
 * 与"安全"有关、且**不能照直觉写**的几处：
 *
 * ① **有历史引用的零件不删，改成停用**。工单行、库存、库存流水都指向 Product；
 *    硬删会被外键挡住 —— 而这不是异常，是业务事实：历史单据提过它，就不能把它抹掉。
 * ② **用"先查引用再决定"而不是"试着删、失败再改"**。PostgreSQL 里事务中一条语句失败会让**整个事务作废**，
 *    后面那句 update 会直接报 current transaction is aborted —— 本地 SQLite 不会这样，
 *    所以那种写法能在本地全绿、到生产才坏。
 * ③ **整份文件一个事务**：任何一张 sheet 有一行出错就全不写。
 *    "改了一半"比"什么都没改"难收拾得多 —— 而且用户看不出改到了哪里。
 */

export interface ApplySummary {
  created: number;
  updated: number;
  deleted: number;
  /** 有历史引用因而改成停用的 */
  deactivated: number;
  skipped: number;
  /**
   * **预览过期被拒**的行：你看预览之后，别人改了同一条。
   * 这时不能盲目覆盖 —— 逐行拒绝并说清楚（老板 2026-09-23 确认的口径）。
   */
  stale: number;
}

function emptySummary(): ApplySummary {
  return { created: 0, updated: 0, deleted: 0, deactivated: 0, skipped: 0, stale: 0 };
}

export async function applyPlans(input: {
  organisationId: string;
  /** 文件里写的分店（套餐/促销落这个分店） */
  branchId: string;
  userId: string;
  sessionBranchId: string | null;
  plans: RowPlan[];
  /** 界面里「就地修改」的原始值：键是 "sheet#行号"，值是 { 字段: 原始输入 } */
  edits?: Record<string, Record<string, unknown>>;
  /** 通知里显示的来源（一般是上传的文件名） */
  sourceLabel?: string;
}): Promise<
  { ok: true; summary: Record<string, ApplySummary>; refused: { sheet: string; key: string; fields: string[] }[] }
  | { ok: false; error: string }
> {
  const bad = input.plans.filter((p) => p.action === "error");
  if (bad.length) {
    return { ok: false, error: bad.length + " row(s) have errors — nothing was written" };
  }

  const branch = await db.branch.findUnique({ where: { id: input.branchId }, select: { organisationId: true } });
  if (!branch || branch.organisationId !== input.organisationId) {
    return { ok: false, error: "The branch in this file is not in your organisation" };
  }

  const [suppliers, products, packages, customers, motorcycles] = await Promise.all([
    db.supplier.findMany({ where: { organisationId: input.organisationId }, select: { id: true, name: true } }),
    db.product.findMany({ where: { organisationId: input.organisationId }, select: { id: true, sku: true } }),
    db.servicePackage.findMany({ where: { branchId: input.branchId }, select: { id: true, name: true } }),
    // 车主按**归一化后的手机号**匹配（生产里 +60/0/破折号三种写法并存，见 sheets.ts 的 normalizePhone）
    db.customer.findMany({ where: { organisationId: input.organisationId }, select: { id: true, phone: true, email: true, name: true } }),
    // 车辆按**归一化后的车牌**匹配（空格与大小写不统一）
    db.motorcycle.findMany({ where: { customer: { organisationId: input.organisationId } }, select: { id: true, plate: true } }),
  ]);
  const supplierIdByName = new Map(suppliers.map((s) => [s.name.trim().toLowerCase(), s.id]));
  const productIdBySku = new Map(products.map((p) => [p.sku.trim().toLowerCase(), p.id]));
  const packageIdByName = new Map(packages.map((p) => [p.name.trim().toLowerCase(), p.id]));
  const customerIdByPhone = new Map(customers.filter((c) => c.phone).map((c) => [normalizePhone(c.phone as string), c.id]));
  const customerIdByEmail = new Map(customers.filter((c) => c.email).map((c) => [(c.email as string).trim().toLowerCase(), c.id]));
  const customerNameById = new Map(customers.map((c) => [c.id, c.name]));
  const motorcycleIdByPlate = new Map(motorcycles.map((m) => [normalizePlate(m.plate), m.id]));

  const summary: Record<string, ApplySummary> = {};
  const bucket = (sheet: string) => (summary[sheet] ??= emptySummary());
  /** 因为「预览过期」被拒的行 —— 回报给界面，让人知道哪几条没写成 */
  const refused: { sheet: string; key: string; fields: string[] }[] = [];

  try {
    await db.$transaction(async (tx) => {
      // **客户先处理**：这样同一份工作簿里可以「先建客户、再挂他的车」——
      // 否则车辆行的车主查找用的是导入前的地图，找不到刚建出来的客户。
      const ordered = [...input.plans].sort((a, b) => sheetPriority(a.sheet) - sheetPriority(b.sheet));
      for (const plan of ordered) {
        if (plan.action === "skip") {
          bucket(plan.sheet).skipped += 1;
          continue;
        }
        // **服务端复验**：值必须重新过一遍列定义（界面里改过的也要），不通过就整行拒绝
        const def = SHEETS.find((s) => s.key === plan.sheet);
        let effective = plan;
        if (def) {
          // ① 界面里的「就地修改」以原始值传回 → 解析成库里的形态
          const rawEdits = input.edits?.[plan.sheet + "#" + plan.rowNumber] ?? {};
          const cleanedEdits: Record<string, unknown> = {};
          for (const [field, value] of Object.entries(rawEdits)) {
            if (typeof value === "string" && value.trim() === "") continue;   // 留空＝不动
            cleanedEdits[field] = value;
          }
          const parsed = coerceEdits(def, cleanedEdits);
          const values = { ...plan.values, ...parsed.values };
          // ② 复验合并后的值（含客户端可能篡改的部分）
          const errors = [...parsed.errors, ...validateCoercedValues(def, values)];
          if (errors.length > 0) {
            refused.push({ sheet: plan.sheet, key: plan.key, fields: errors });
            continue;
          }
          effective = { ...plan, values };
        }
        // **预览过期检测**：你看预览之后有人改了同一条 → 拒绝这一行，而不是把别人的改动盖掉
        if (plan.action === "update" || plan.action === "delete") {
          const { stale } = await staleFields(tx, effective, input.organisationId, input.branchId);
          if (stale.length > 0) {
            bucket(plan.sheet).stale += 1;
            refused.push({ sheet: plan.sheet, key: plan.key, fields: stale });
            continue;
          }
        }
        if (plan.sheet === PRODUCTS_SHEET.key) await applyProduct(tx, effective, input, supplierIdByName, bucket(plan.sheet));
        else if (plan.sheet === PACKAGES_SHEET.key) await applyPackage(tx, effective, input, bucket(plan.sheet));
        else if (plan.sheet === PACKAGE_ITEMS_SHEET.key) await applyPackageItem(tx, effective, input, productIdBySku, packageIdByName, bucket(plan.sheet));
        else if (plan.sheet === CAMPAIGNS_SHEET.key) await applyCampaign(tx, effective, input, bucket(plan.sheet));
        else if (plan.sheet === SUPPLIERS_SHEET.key) await applySupplier(tx, effective, input, bucket(plan.sheet));
        else if (plan.sheet === SERVICE_TYPES_SHEET.key) await applyServiceType(tx, effective, input, bucket(plan.sheet));
        else if (plan.sheet === MOTORCYCLES_SHEET.key) await applyMotorcycle(tx, effective, input, customerIdByPhone, motorcycleIdByPlate, bucket(plan.sheet));
        else if (plan.sheet === CUSTOMERS_SHEET.key) await applyCustomer(tx, effective, input, customerIdByPhone, customerIdByEmail, customerNameById, bucket(plan.sheet));
        else throw new Error("Unknown sheet: " + plan.sheet);
      }
    });
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }

  await audit({
    organisationId: input.organisationId,
    branchId: input.branchId,
    userId: input.userId,
    action: "BULK_IMPORT_APPLY",
    entity: "Setup",
    after: { summary, rows: input.plans.length, fileBranchId: input.branchId },
  });

  // **应用完成通知**：放在事务提交**之后**（写数据是正事，通知失败了也绝不能回滚它），
  // 所以失败被吞掉。为什么需要它：大文件应用要跑一会儿，老板很可能切去做别的，
  // 只在界面上闪一下的提示帮不了他 —— 站内通知能让他回头看到结果。
  const totals = Object.values(summary).reduce(
    (a, s) => ({
      created: a.created + s.created,
      updated: a.updated + s.updated,
      deleted: a.deleted + s.deleted,
    }),
    { created: 0, updated: 0, deleted: 0 },
  );
  await db.notification
    .create({
      data: {
        userId: input.userId,
        branchId: input.branchId,
        type: "BULK_IMPORT_APPLIED",
        title: "Batch setup applied: " + (input.sourceLabel ?? "setup workbook"),
        body:
          "+" + totals.created + " new · ~" + totals.updated + " changed · -" + totals.deleted + " removed" +
          (refused.length > 0
            ? " · " + refused.length + " row(s) refused (changed by someone else first)"
            : ""),
        link: "/workshop/setup",
      },
    })
    .catch(() => {});

  return { ok: true, summary, refused };
}

/**
 * 预览过期检测：把计划里记的**旧值**与数据库**此刻**的值逐字段比。
 * 不一致 = 你看预览之后有人改了同一条 → 拒绝这一行（而不是把别人的改动盖掉）。
 */
/**
 * **服务端复验**：界面里改过的值也要重新按列定义校验一次。
 * 客户端只负责传「值 + 批准与否」，能不能写、写成什么类型由这里说了算 ——
 * 一次被篡改的请求不该能绕开枚举白名单或把金额写成文字。
 */
/**
 * 复验**计划里已经是归一化形态的值**（分/Date/枚举规范值/布尔）。
 *
 * 注意与「界面传回来的原始编辑值」的区别：后者要过 cellToValue 解析
 * （"12.50" 是 RM、要乘 100），而计划里的值已经是 sen —— 再解析一次会把它当元，金额直接错 100 倍。
 * 这两件事**必须分开**，混淆过一次（测试立刻抓到了）。
 */
function validateCoercedValues(def: SheetDef, values: Record<string, unknown>): string[] {
  const errors: string[] = [];
  for (const col of def.columns) {
    const v = values[col.field];
    if (v === undefined) continue;
    if (col.type === "money" || col.type === "int") {
      if (typeof v !== "number" || !Number.isFinite(v) || v < 0) errors.push(col.header + ": expected a number");
    } else if (col.type === "bool") {
      if (typeof v !== "boolean") errors.push(col.header + ": expected true/false");
    } else if (col.type === "enum") {
      const allowed = [...new Set(Object.values(col.enumMap ?? {}))];
      if (typeof v !== "string" || !allowed.includes(v)) errors.push(col.header + ": unknown value (" + String(v) + ")");
    } else if (col.type === "date") {
      if (!(v instanceof Date) && typeof v !== "string") errors.push(col.header + ": expected a date");
    } else if (typeof v !== "string") {
      errors.push(col.header + ": expected text");
    }
  }
  return errors;
}

/** 界面传回来的**原始编辑值**（Excel 语义：金额是 RM、日期是 YYYY-MM-DD）→ 归一化 */
function coerceEdits(def: SheetDef, raw: Record<string, unknown>): { values: Record<string, unknown>; errors: string[] } {
  const out: Record<string, unknown> = {};
  const errors: string[] = [];
  for (const [field, value] of Object.entries(raw)) {
    const col = def.columns.find((c) => c.field === field);
    if (!col) {
      errors.push("Unknown column: " + field);
      continue;
    }
    const res = cellToValue(col, value);
    if (!res.ok) errors.push(col.header + ": " + res.error);
    else if (res.value !== undefined) out[field] = res.value;
  }
  return { values: out, errors };
}

async function staleFields(
  tx: Tx,
  plan: RowPlan,
  organisationId: string,
  branchId: string,
): Promise<{ stale: string[] }> {
  if (plan.changes.length === 0) return { stale: [] };
  let current: Record<string, unknown> | null = null;
  if (plan.sheet === PRODUCTS_SHEET.key) {
    current = await tx.product.findUnique({ where: { sku: plan.key } }) as never;
  } else if (plan.sheet === PACKAGES_SHEET.key) {
    current = await tx.servicePackage.findFirst({ where: { branchId, name: plan.key } }) as never;
  } else if (plan.sheet === PACKAGE_ITEMS_SHEET.key) {
    const [pkgName, itemName] = plan.key.split(" / ");
    const pkg = await tx.servicePackage.findFirst({ where: { branchId, name: pkgName }, select: { id: true } });
    if (pkg) {
      const item = await tx.servicePackageItem.findFirst({ where: { packageId: pkg.id, name: itemName } });
      current = item ? { ...item, packageName: pkgName, itemName: item.name } : null;
    }
  } else if (plan.sheet === CAMPAIGNS_SHEET.key) {
    current = await tx.campaign.findFirst({ where: { branchId, name: plan.key } }) as never;
  } else if (plan.sheet === SUPPLIERS_SHEET.key) {
    current = await tx.supplier.findFirst({ where: { organisationId, name: plan.key } }) as never;
  } else if (plan.sheet === SERVICE_TYPES_SHEET.key) {
    current = await tx.serviceType.findFirst({ where: { organisationId, code: plan.key } }) as never;
  } else if (plan.sheet === MOTORCYCLES_SHEET.key) {
    const all = await tx.motorcycle.findMany({ where: { customer: { organisationId } } });
    current = (all.find((m) => normalizePlate(m.plate) === normalizePlate(plan.key)) ?? null) as never;
  }
  if (!current) return { stale: [] };   // 行已经不在了：由各自的 apply 分支去报"已不存在"
  const row = current as Record<string, unknown>;
  return { stale: plan.changes.filter((c) => !sameValue(row[c.field], c.from)).map((c) => c.field) };
}

type Tx = Prisma.TransactionClient;

async function applyProduct(
  tx: Tx,
  plan: RowPlan,
  input: { organisationId: string; userId: string },
  supplierIdByName: Map<string, string>,
  out: ApplySummary,
) {
  const data: Record<string, unknown> = {};
  for (const [field, value] of Object.entries(plan.values)) {
    if (field === "supplierName") continue;
    data[field] = value;
  }
  if (typeof plan.values.supplierName === "string" && plan.values.supplierName.trim() !== "") {
    const id = supplierIdByName.get(String(plan.values.supplierName).trim().toLowerCase());
    if (!id) throw new Error("Unknown supplier: " + plan.values.supplierName + " (add it under Suppliers first)");
    data.supplierId = id;
  }

  if (plan.action === "create") {
    await tx.product.create({
      data: {
        organisationId: input.organisationId,
        name: plan.key,
        sellPriceSen: 0,
        costPriceSen: 0,
        ...data,
        sku: plan.key,
      } as never,
    });
    out.created += 1;
  } else if (plan.action === "update") {
    await tx.product.update({ where: { sku: plan.key }, data: data as never });
    out.updated += 1;
  } else if (plan.action === "delete") {
    const product = await tx.product.findUnique({ where: { sku: plan.key }, select: { id: true } });
    if (!product) {
      out.skipped += 1;
      return;
    }
    const [jobItems, inventories, movements] = await Promise.all([
      tx.serviceJobItem.count({ where: { productId: product.id } }),
      tx.inventory.count({ where: { productId: product.id } }),
      tx.stockMovement.count({ where: { productId: product.id } }),
    ]);
    if (jobItems + inventories + movements > 0) {
      await tx.product.update({ where: { id: product.id }, data: { active: false } });
      out.deactivated += 1;
    } else {
      await tx.product.delete({ where: { id: product.id } });
      out.deleted += 1;
    }
  }
}

async function applyPackage(
  tx: Tx,
  plan: RowPlan,
  input: { branchId: string },
  out: ApplySummary,
) {
  const data: Record<string, unknown> = { ...plan.values };
  delete data.name;
  if (plan.action === "create") {
    await tx.servicePackage.create({
      data: {
        branchId: input.branchId,
        name: plan.key,
        tier: (data.tier as never) ?? "GOOD",
        priceSen: Number(data.priceSen ?? 0),
        ...data,
      } as never,
    });
    out.created += 1;
  } else if (plan.action === "update") {
    // ServicePackage 没有 (branchId, name) 唯一键 —— 只能 findFirst 再按 id 更新
    const found = await tx.servicePackage.findFirst({ where: { branchId: input.branchId, name: plan.key }, select: { id: true } });
    if (!found) throw new Error("Package no longer exists in this branch: " + plan.key);
    await tx.servicePackage.update({ where: { id: found.id }, data: data as never });
    out.updated += 1;
  } else if (plan.action === "delete") {
    const pkg = await tx.servicePackage.findFirst({ where: { branchId: input.branchId, name: plan.key }, select: { id: true } });
    if (!pkg) {
      out.skipped += 1;
      return;
    }
    // 工单/预约指着套餐就不能删（先查，不靠外键异常 —— 见文件头 ②）
    const used = await tx.serviceJob.count({ where: { servicePackageId: pkg.id } })
      + await tx.booking.count({ where: { servicePackageId: pkg.id } });
    if (used > 0) throw new Error("Package is used by jobs or bookings and cannot be deleted: " + plan.key);
    await tx.servicePackageItem.deleteMany({ where: { packageId: pkg.id } });
    await tx.servicePackage.delete({ where: { id: pkg.id } });
    out.deleted += 1;
  }
}

async function applyPackageItem(
  tx: Tx,
  plan: RowPlan,
  input: { branchId: string },
  productIdBySku: Map<string, string>,
  packageIdByName: Map<string, string>,
  out: ApplySummary,
) {
  // 键形如 "套餐名 / 项目名"（删除行没有 values，所以两种来源都要支持）。
  // 优先用**字段值**，只有删除行才回退到拆键 —— 拆键依赖顺序，容易错（实测错过一次）。
  const [keyPackageName, keyItemName] = plan.key.split(" / ");
  const packageName = String(plan.values.packageName ?? keyPackageName ?? "").trim();
  const itemName = String(plan.values.itemName ?? keyItemName ?? "").trim();
  const packageId = packageIdByName.get(packageName.toLowerCase());
  if (!packageId) throw new Error("Unknown package in this branch: " + packageName);

  const data: Record<string, unknown> = {};
  for (const [field, value] of Object.entries(plan.values)) {
    if (field === "packageName" || field === "productSku") continue;
    data[field] = value;
  }
  if (typeof plan.values.productSku === "string" && plan.values.productSku.trim() !== "") {
    const pid = productIdBySku.get(String(plan.values.productSku).trim().toLowerCase());
    if (!pid) throw new Error("Unknown product SKU: " + plan.values.productSku);
    data.productId = pid;
  }

  const existing = await tx.servicePackageItem.findFirst({
    where: { packageId, name: itemName },
    select: { id: true },
  });

  if (plan.action === "delete") {
    if (!existing) {
      out.skipped += 1;
      return;
    }
    await tx.servicePackageItem.delete({ where: { id: existing.id } });
    out.deleted += 1;
    return;
  }
  if (plan.action === "create") {
    await tx.servicePackageItem.create({
      data: {
        packageId,
        name: itemName,
        kind: (data.kind as never) ?? "SERVICE",
        ...data,
      } as never,
    });
    out.created += 1;
    return;
  }
  if (plan.action === "update") {
    if (!existing) throw new Error("Package item no longer exists: " + plan.key);
    await tx.servicePackageItem.update({ where: { id: existing.id }, data: data as never });
    out.updated += 1;
  }
}

/**
 * 处理顺序：**客户 → 车辆 → 其它**。
 * 客户必须先建，否则同一份工作簿里「新建客户 + 挂他的车」会因车主查不到而失败。
 */
function sheetPriority(sheet: string): number {
  if (sheet === CUSTOMERS_SHEET.key) return 0;
  if (sheet === MOTORCYCLES_SHEET.key) return 1;
  return 2;
}

async function applyCustomer(
  tx: Tx,
  plan: RowPlan,
  input: { organisationId: string; branchId: string },
  customerIdByPhone: Map<string, string>,
  customerIdByEmail: Map<string, string>,
  customerNameById: Map<string, string>,
  out: ApplySummary,
) {
  const phone = String(plan.values.phone ?? plan.key).trim();
  const existingId = customerIdByPhone.get(normalizePhone(phone));
  const email = plan.values.email === undefined ? undefined : String(plan.values.email).trim();
  const emailKey = email ? email.toLowerCase() : "";

  // 邮箱**不做键**（夫妻/公司共用一个邮箱是现实的），但也不能两个人共用：
  // 撞上别人的邮箱就报错，**不自动合并** —— 自动合并会在"换号写错一次"时并错人。
  if (emailKey) {
    const owner = customerIdByEmail.get(emailKey);
    if (owner && owner !== existingId) {
      throw new Error(
        "Email " + email + " already belongs to " + (customerNameById.get(owner) ?? "another customer") +
        " — if they really share it, leave the Email cell blank",
      );
    }
  }

  const data: Record<string, unknown> = {};
  for (const [field, value] of Object.entries(plan.values)) {
    // 手机号是键：不参与数据改写（与 diff 里"键字段是身份不是数据"同一条规则）
    if (field === "phone") continue;
    data[field] = value;
  }

  if (plan.action === "create") {
    const created = await tx.customer.create({
      data: {
        organisationId: input.organisationId,
        branchId: input.branchId,
        name: String(plan.values.name ?? ""),
        phone,
        ...data,
      } as never,
      select: { id: true },
    });
    // **建完立刻更新映射**，同一份文件里后面的车辆行才挂得上这位新客户
    customerIdByPhone.set(normalizePhone(phone), created.id);
    if (emailKey) customerIdByEmail.set(emailKey, created.id);
    customerNameById.set(created.id, String(plan.values.name ?? ""));
    out.created += 1;
  } else if (plan.action === "update") {
    if (!existingId) throw new Error("Customer no longer exists: " + phone);
    await tx.customer.update({ where: { id: existingId }, data: data as never });
    if (emailKey) customerIdByEmail.set(emailKey, existingId);
    out.updated += 1;
  } else if (plan.action === "delete") {
    if (!existingId) {
      out.skipped += 1;
      return;
    }
    // 有历史就不能删 —— 先查引用再决定（见文件头 ②）
    const [vehicles, jobs, bookings, invoices] = await Promise.all([
      tx.motorcycle.count({ where: { customerId: existingId } }),
      tx.serviceJob.count({ where: { customerId: existingId } }),
      tx.booking.count({ where: { customerId: existingId } }),
      tx.invoice.count({ where: { customerId: existingId } }),
    ]);
    const used = vehicles + jobs + bookings + invoices;
    if (used > 0) {
      throw new Error("Customer has " + used + " vehicle(s)/job(s)/booking(s)/invoice(s) and cannot be deleted: " + phone);
    }
    await tx.customer.delete({ where: { id: existingId } });
    out.deleted += 1;
  }
}

async function applyMotorcycle(
  tx: Tx,
  plan: RowPlan,
  input: { organisationId: string },
  customerIdByPhone: Map<string, string>,
  motorcycleIdByPlate: Map<string, string>,
  out: ApplySummary,
) {
  const data: Record<string, unknown> = {};
  for (const [field, value] of Object.entries(plan.values)) {
    if (field === "customerPhone" || field === "plate") continue;
    data[field] = value;
  }
  // 车主：按手机号找。找不到**报错而不新建** —— 车辆表不是建客户的地方，
  // 从车辆名单凭空建客户是产生重复客户最典型的方式（客户表还没做，判重规则也没抽出来）。
  const phone = String(plan.values.customerPhone ?? "").trim();
  const customerId = phone ? customerIdByPhone.get(normalizePhone(phone)) : undefined;
  if (phone && !customerId) {
    throw new Error("No customer with phone " + phone + " — add the customer first (vehicles do not create customers)");
  }
  const existingId = motorcycleIdByPlate.get(normalizePlate(plan.key));

  if (plan.action === "create") {
    if (!customerId) throw new Error("Customer phone is required for a new vehicle: " + plan.key);
    await tx.motorcycle.create({
      data: {
        customerId,
        plate: String(plan.values.plate ?? plan.key),
        brand: String(plan.values.brand ?? ""),
        model: String(plan.values.model ?? ""),
        year: Number(plan.values.year ?? new Date().getFullYear()),
        type: (data.type as never) ?? "UNDERBONE",
        ...data,
      } as never,
    });
    out.created += 1;
  } else if (plan.action === "update") {
    if (!existingId) throw new Error("Vehicle no longer exists: " + plan.key);
    if (customerId) data.customerId = customerId;
    await tx.motorcycle.update({ where: { id: existingId }, data: data as never });
    out.updated += 1;
  } else if (plan.action === "delete") {
    if (!existingId) {
      out.skipped += 1;
      return;
    }
    // 有历史（工单/预约）就不能删 —— 先查引用再决定（见文件头 ②）
    const used = await tx.serviceJob.count({ where: { motorcycleId: existingId } })
      + await tx.booking.count({ where: { motorcycleId: existingId } });
    if (used > 0) throw new Error("Vehicle has " + used + " job(s) or booking(s) and cannot be deleted: " + plan.key);
    await tx.motorcycle.delete({ where: { id: existingId } });
    out.deleted += 1;
  }
}

async function applySupplier(
  tx: Tx,
  plan: RowPlan,
  input: { organisationId: string; branchId: string },
  out: ApplySummary,
) {
  const data: Record<string, unknown> = { ...plan.values };
  delete data.name;
  if (plan.action === "create") {
    await tx.supplier.create({ data: { organisationId: input.organisationId, name: plan.key, ...data } as never });
    out.created += 1;
  } else if (plan.action === "update") {
    const found = await tx.supplier.findFirst({ where: { organisationId: input.organisationId, name: plan.key }, select: { id: true } });
    if (!found) throw new Error("Supplier no longer exists: " + plan.key);
    await tx.supplier.update({ where: { id: found.id }, data: data as never });
    out.updated += 1;
  } else if (plan.action === "delete") {
    const found = await tx.supplier.findFirst({ where: { organisationId: input.organisationId, name: plan.key }, select: { id: true } });
    if (!found) {
      out.skipped += 1;
      return;
    }
    // 供应商没有"停用"字段，被引用时不能删 —— 先查引用再决定（见文件头 ②）
    const used = await tx.product.count({ where: { supplierId: found.id } })
      + await tx.purchaseOrder.count({ where: { supplierId: found.id } });
    if (used > 0) throw new Error("Supplier is used by " + used + " part(s) or purchase order(s) and cannot be deleted: " + plan.key);
    await tx.supplier.delete({ where: { id: found.id } });
    out.deleted += 1;
  }
}

/**
 * 服务目录：**只改，不建、不删**。
 * 服务是代码定义的（src/lib/service-catalog.ts 同步进库）；从 Excel 造一个新 code
 * 会得到一个柜台根本看不到的服务 —— 那种"数据库里有、前台没有"的东西最难查。
 */
async function applyServiceType(
  tx: Tx,
  plan: RowPlan,
  input: { organisationId: string },
  out: ApplySummary,
) {
  const found = await tx.serviceType.findFirst({ where: { organisationId: input.organisationId, code: plan.key }, select: { id: true } });
  if (!found) throw new Error("Unknown service code: " + plan.key + " (services come from the app catalogue)");
  if (plan.action === "delete") throw new Error("Services cannot be deleted from a workbook: " + plan.key);
  const data: Record<string, unknown> = {};
  for (const [field, value] of Object.entries(plan.values)) {
    if (field === "code") continue;
    data[field] = value;
  }
  await tx.serviceType.update({ where: { id: found.id }, data: data as never });
  out.updated += 1;
}

async function applyCampaign(
  tx: Tx,
  plan: RowPlan,
  input: { branchId: string },
  out: ApplySummary,
) {
  const data: Record<string, unknown> = { ...plan.values };
  delete data.name;
  if (plan.action === "create") {
    await tx.campaign.create({
      data: {
        branchId: input.branchId,
        name: plan.key,
        type: (data.type as never) ?? "RETURN",
        status: (data.status as never) ?? "ACTIVE",
        startDate: (data.startDate as Date) ?? new Date(),
        ...data,
      } as never,
    });
    out.created += 1;
  } else if (plan.action === "update") {
    const found = await tx.campaign.findFirst({ where: { branchId: input.branchId, name: plan.key }, select: { id: true } });
    if (!found) throw new Error("Campaign no longer exists: " + plan.key);
    await tx.campaign.update({ where: { id: found.id }, data: data as never });
    out.updated += 1;
  } else if (plan.action === "delete") {
    const found = await tx.campaign.findFirst({ where: { branchId: input.branchId, name: plan.key }, select: { id: true } });
    if (!found) {
      out.skipped += 1;
      return;
    }
    const used = await tx.booking.count({ where: { campaignId: found.id } }) + await tx.lead.count({ where: { campaignId: found.id } });
    if (used > 0) throw new Error("Campaign has bookings or leads and cannot be deleted: " + plan.key);
    await tx.campaign.delete({ where: { id: found.id } });
    out.deleted += 1;
  }
}
