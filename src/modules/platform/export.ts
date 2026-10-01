/**
 * 按租户导出（P4 收尾）：把一家店的数据交给它自己。
 *
 * 三条原则：
 *  ① **导出不是 dump**。这是"把你的数据给你"，不是"可以拿回去恢复整个系统"的备份 ——
 *     所以平台侧的表（租户目录/审计/模板/墓碑）不在里面，登录凭据也不在（那在 Supabase）。
 *  ② **密钥类字段必须脱敏**。`User` 表里还留着历史遗留的 `passwordHash` / `mfaSecret` /
 *     `verifyToken` / `resetToken`，`IntegrationConfig` 里是各家 provider 的凭据 ——
 *     导出一份带着这些的 JSON，等于把一家店的全部钥匙抄送出去。
 *     这里用**列名清单 + 守卫测试**（`tests/platform-tenant-export.test.ts` 会扫 schema，
 *     出现新的疑似密钥列而没登记就红）。
 *  ③ **行范围的判定复用退租那份计划**：`PURGE_WHERE`（scope map 推出的"这家店的行在哪"）
 *     与导出要的是同一个东西 —— 两处各写一份必然漂移，而漂移的表现是"导出的数据不全"，
 *     不会报错。
 */
import { PURGE_ORDER, PURGE_WHERE } from "@/modules/platform/purge-plan.generated";

/** 导出时用固定串替换的值（保留字段本身，让人知道"这里有个字段、但内容不给"）。 */
export const REDACTED_PLACEHOLDER = "[redacted]";

/**
 * 需要脱敏的字段：`模型.字段` → 原因。
 * 加新条目时请同时更新守卫测试里的**允许清单**（`qrToken` 这类"公开印在二维码上的标识"不算密钥）。
 */
export const REDACTED_FIELDS: Record<string, string> = {
  "User.passwordHash": "密码哈希",
  "User.mfaSecret": "MFA 密钥（有了它就能生成你的动态口令）",
  "User.verifyToken": "邮箱验证令牌",
  "User.resetToken": "密码重置令牌",
  "User.resetTokenExpiresAt": "重置令牌的到期时间（没有令牌本身它毫无用处，但一起导出只会让人困惑）",
  "IntegrationConfig.configEncrypted": "第三方 provider 凭据",
};

/** 列名像密钥、但**有意不脱敏**的（公开印在门店二维码/骑手二维码上，属于运营数据）。 */
export const PUBLIC_TOKEN_FIELDS = ["Organisation.qrToken", "Customer.qrToken", "Motorcycle.qrToken"];

export interface TenantExport {
  meta: {
    slug: string | null;
    name: string;
    organisationId: string;
    exportedAt: string;
    /** 生成这个文件的口径：为什么"导出的行范围"与退租删除完全一致 */
    scope: string;
    redactedFields: string[];
    notes: string[];
  };
  tables: Record<string, unknown[]>;
  rowCount: number;
}

export function exportFilename(slug: string | null, at: Date): string {
  const stamp = at.toISOString().replace(/[:.]/g, "-").slice(0, 19);
  // 运维产物命名统一带 slug（平台台/备份/导出/日志都是同一个键）
  return "tenant-" + (slug ?? "no-slug") + "-" + stamp + ".json";
}

/** 按模型名取出该模型需要脱敏的字段名。 */
export function redactedFieldsFor(model: string): string[] {
  const prefix = model + ".";
  return Object.keys(REDACTED_FIELDS)
    .filter((k) => k.startsWith(prefix))
    .map((k) => k.slice(prefix.length));
}

/** 把一行里需要脱敏的字段替换成占位串（保留字段本身）。 */
export function redactRow(model: string, row: Record<string, unknown>): Record<string, unknown> {
  const fields = redactedFieldsFor(model);
  if (!fields.length) return row;
  const out = { ...row };
  for (const f of fields) if (f in out) out[f] = REDACTED_PLACEHOLDER;
  return out;
}

/** 导出涉及的模型（与退租同一份清单 —— 属于租户的每一张表）。 */
export const EXPORT_MODELS = PURGE_ORDER as readonly string[];
export { PURGE_WHERE as EXPORT_WHERE };
