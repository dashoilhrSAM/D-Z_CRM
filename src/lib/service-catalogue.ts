// 注意：这里**故意不加** import "server-only" —— 本模块要被 seed（src/lib/seed-core.ts）
// 与运维脚本（scripts/commission/sync-service-catalogue.ts）直接 import，而 server-only 在
// 非 Next 打包环境下会直接抛错。它与 lib/db.ts 同属数据层，不属于"绝不能进客户端"的那一类。
import { db } from "@/lib/db";
import { SERVICE_CATALOG } from "@/lib/service-catalog";

// P0b：**把服务目录统一成一份**。
//
// 现状（实测）：柜台实际在卖的服务来自源码里的 SERVICE_CATALOG（12 项，带稳定 key），
// 而管理员/AI 看到的是数据库的 ServiceType 表（8 行，code 与 priceSen 全空），两者粒度还不一样
// （DB 的 "Brake Service" vs 源码的 "Brake Pad Replacement" + "Brake Fluid Flush"）。
// 结果就是"列出每一个服务来配佣金"没有一份完整清单可列 —— 缺一项就意味着那项服务配不了佣金。
//
// 这个模块是**唯一的桥**：按 code 幂等对齐两边（code 有唯一约束兜底，不会造出重复行）。
// 决策（老板 2026-09-23）：**全部保留** —— 源码 12 项 + 数据库独有的 6 项 = 18 项，
// 历史工单里的旧名字仍然对得上，合并留到以后再说（合并不可逆，多几个可选项没有代价）。

/** 只存在于数据库、源码目录里没有的服务：给固定 code，让它们也能被佣金规则引用。 */
export const LEGACY_SERVICE_CODES: Record<string, string> = {
  "General Service": "GENERAL_SERVICE",
  "Major Service": "MAJOR_SERVICE",
  "Brake Service": "BRAKE_SERVICE",
  "Electrical Check": "ELECTRICAL_CHECK",
  "Full Inspection": "FULL_INSPECTION",
  "Engine Tune-up": "ENGINE_TUNEUP",
};

export interface CatalogueSyncResult {
  created: number;
  coded: number;
  priced: number;
  total: number;
}

/**
 * 把源码目录与数据库 ServiceType 对齐（幂等，可重复执行）。
 *
 * 规则：
 *  · 先按 code 找；找不到再按"同名且没有 code"找（存量 8 行就是这种），绝不按名字新建重复行；
 *  · 价格只在**为空**时用目录默认值补上 —— 管理员手工设过的价格永远不被覆盖；
 *  · 数据库独有的那 6 项按 LEGACY_SERVICE_CODES 补 code（保留，不删不改名）。
 */
export async function syncServiceCatalogue(): Promise<CatalogueSyncResult> {
  const org = await db.organisation.findFirst({ select: { id: true } });
  if (!org) throw new Error("No organisation");

  let created = 0;
  let coded = 0;
  let priced = 0;

  for (const c of SERVICE_CATALOG) {
    const byCode = await db.serviceType.findUnique({
      where: { organisationId_code: { organisationId: org.id, code: c.key } },
      select: { id: true, code: true, priceSen: true, category: true },
    });
    const row =
      byCode ??
      (await db.serviceType.findFirst({
        where: { organisationId: org.id, name: c.label, code: null },
        select: { id: true, code: true, priceSen: true, category: true },
      }));

    if (!row) {
      await db.serviceType.create({
        data: { organisationId: org.id, name: c.label, code: c.key, priceSen: c.defaultPriceSen, category: c.family },
      });
      created++;
      continue;
    }

    const data: { code?: string; priceSen?: number; category?: string } = {};
    if (row.code !== c.key) {
      data.code = c.key;
      coded++;
    }
    if (row.priceSen == null) {
      data.priceSen = c.defaultPriceSen;
      priced++;
    }
    if (!row.category) data.category = c.family;
    if (Object.keys(data).length > 0) {
      await db.serviceType.update({ where: { id: row.id }, data });
    }
  }

  for (const [name, code] of Object.entries(LEGACY_SERVICE_CODES)) {
    const row = await db.serviceType.findFirst({
      where: { organisationId: org.id, name, code: null },
      select: { id: true },
    });
    if (row) {
      await db.serviceType.update({ where: { id: row.id }, data: { code } });
      coded++;
    }
  }

  const total = await db.serviceType.count({ where: { organisationId: org.id } });
  return { created, coded, priced, total };
}

/** 源码目录里、在数据库里找不到对应 ServiceType 的项（对齐的漂移检查）。 */
export async function catalogueDrift(): Promise<{ key: string; label: string }[]> {
  const rows = await db.serviceType.findMany({ select: { code: true, name: true } });
  const codes = new Set(rows.map((r) => (r.code ?? "").toLowerCase()));
  const names = new Set(rows.map((r) => r.name.trim().toLowerCase()));
  return SERVICE_CATALOG.filter((c) => !codes.has(c.key.toLowerCase()) && !names.has(c.label.trim().toLowerCase()))
    .map((c) => ({ key: c.key, label: c.label }));
}
