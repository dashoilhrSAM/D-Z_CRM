import { z } from "zod";

/**
 * 开通模板（P4 第三块）：把"一家新店开出来长什么样"变成**数据**，而不是散在服务里的常量。
 *
 * 为什么值得做：开第一家店时默认配置是"差不多就行"，开到第五家时你会希望
 * **把已经调好的那家复制过去**（同一套服务目录、同一套线索阶段、同一些消息模板）。
 * 所以模板有两条来源：
 *   · 内置（`BUILTIN_TEMPLATES`，写死在代码里）：永远存在、可复现，新装一套系统也能开出门店；
 *   · 自定义（`TenantTemplate` 表）：**从某家店导出来**的，连锁开店时最省事。
 * 解析顺序：自定义 → 内置。**刻意不把内置也塞进库** —— 那样就有两份事实来源，
 * 改了代码而库里还是旧的（本项目在别处吃过这个亏）。
 */

/** 模板负载的形状。用 zod 校验：模板可能来自"某家店导出的 JSON"，是不可信输入。 */
export const templatePayloadSchema = z.object({
  serviceTypes: z
    .array(
      z.object({
        name: z.string().min(1).max(80),
        code: z.string().max(40).nullable().optional(),
        category: z.string().max(40).nullable().optional(),
        durationMin: z.number().int().min(0).max(1440).nullable().optional(),
        priceSen: z.number().int().min(0).nullable().optional(),
      }),
    )
    .max(200)
    .default([]),
  leadSources: z.array(z.object({ name: z.string().min(1).max(80) })).max(100).default([]),
  leadStages: z.array(z.object({ name: z.string().min(1).max(80), order: z.number().int().min(0).max(999).optional() })).max(100).default([]),
  messageTemplates: z
    .array(
      z.object({
        name: z.string().min(1).max(80),
        body: z.string().min(1).max(2000),
        channel: z.enum(["WHATSAPP", "SMS", "EMAIL", "APP"]).optional(),
        subject: z.string().max(200).nullable().optional(),
      }),
    )
    .max(100)
    .default([]),
});

export type TemplatePayload = z.infer<typeof templatePayloadSchema>;

export interface TemplateSummary {
  key: string;
  name: string;
  description: string | null;
  /** "builtin" = 代码里的；"custom" = 从某家店导出的 */
  source: "builtin" | "custom";
  counts: { serviceTypes: number; leadSources: number; leadStages: number; messageTemplates: number };
}

/** 模板 key：开新店时会传它，所以只允许小写字母数字与连字符。 */
export const TEMPLATE_KEY_PATTERN = /^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/;

/**
 * 内置模板。**注意它们不是"默认值"而是"一个具体的选择"** ——
 * 开通时不指定模板就用 `standard`，与之前散在服务里的默认配置完全一致（保持兼容）。
 */
export const BUILTIN_TEMPLATES: Record<string, { name: string; description: string; payload: TemplatePayload }> = {
  standard: {
    name: "标准摩托车维修店",
    description: "通用服务目录 + 常用线索来源与阶段 + 三条消息模板。不指定模板时的默认选择。",
    payload: {
      serviceTypes: [
        { name: "General Service", code: "SVC-GEN", category: "SERVICE", durationMin: 60, priceSen: 8000 },
        { name: "Engine Oil Change", code: "SVC-OIL", category: "SERVICE", durationMin: 30, priceSen: 4500 },
        { name: "Tyre Replace", code: "SVC-TYRE", category: "SERVICE", durationMin: 40, priceSen: 6000 },
        { name: "Full Inspection", code: "SVC-INSPECT", category: "SERVICE", durationMin: 45, priceSen: 3000 },
      ],
      leadSources: [{ name: "Walk-in" }, { name: "WhatsApp" }, { name: "Facebook" }, { name: "Referral" }, { name: "Phone" }],
      leadStages: [{ name: "New", order: 0 }, { name: "Contacted", order: 1 }, { name: "Quoted", order: 2 }, { name: "Won", order: 3 }, { name: "Lost", order: 4 }],
      messageTemplates: [
        { name: "Booking reminder", body: "Hi {{name}}, reminder for your appointment on {{date}} {{time}}. Reply to reschedule." },
        { name: "Job completed", body: "Hi {{name}}, your {{bike}} is ready for collection. Total {{amount}}." },
        { name: "Service due", body: "Hi {{name}}, your {{bike}} is due for service. Book here: {{link}}" },
      ],
    },
  },
  "dealer-only": {
    name: "只做销售（无维修工位）",
    description: "服务目录只留检测与上牌相关项，线索阶段同标准 —— 给纯卖车的经销商用。",
    payload: {
      serviceTypes: [
        { name: "Pre-delivery Inspection", code: "SVC-PDI", category: "SERVICE", durationMin: 45, priceSen: 5000 },
        { name: "Registration & Handover", code: "SVC-REG", category: "SERVICE", durationMin: 30, priceSen: 3000 },
      ],
      leadSources: [{ name: "Walk-in" }, { name: "Facebook" }, { name: "TikTok" }, { name: "Referral" }],
      leadStages: [{ name: "New", order: 0 }, { name: "Test ride booked", order: 1 }, { name: "Quoted", order: 2 }, { name: "Won", order: 3 }, { name: "Lost", order: 4 }],
      messageTemplates: [
        { name: "Test ride invite", body: "Hi {{name}}, your test ride is booked for {{date}} {{time}}." },
        { name: "Handover ready", body: "Hi {{name}}, your {{bike}} is ready for handover." },
      ],
    },
  },
};

export const DEFAULT_TEMPLATE_KEY = "standard";

/** 解析模板负载：自定义优先、内置兜底；找不到就返回 null（由调用方决定怎么报错）。 */
export function resolveBuiltinTemplate(key: string): TemplatePayload | null {
  const t = BUILTIN_TEMPLATES[key];
  return t ? safeParsePayload(t.payload) : null;
}

/**
 * 校验并规范化负载。**失败返回 null 而不是抛** —— 模板是数据，
 * 一条坏数据不该让整个列表页 500；调用方按"这个模板不可用"处理并说清楚。
 */
export function safeParsePayload(raw: unknown): TemplatePayload | null {
  const parsed = templatePayloadSchema.safeParse(raw);
  if (!parsed.success) return null;
  return {
    serviceTypes: parsed.data.serviceTypes,
    leadSources: parsed.data.leadSources,
    // 阶段没写顺序就按数组下标 —— 顺序对线索看板是真实的语义
    leadStages: parsed.data.leadStages.map((s, i) => ({ name: s.name, order: s.order ?? i })),
    messageTemplates: parsed.data.messageTemplates,
  };
}

/** 计数（列表页与详情页都要显示"这个模板会建出多少东西"）。 */
export function summarizePayload(payload: TemplatePayload) {
  return {
    serviceTypes: payload.serviceTypes.length,
    leadSources: payload.leadSources.length,
    leadStages: payload.leadStages.length,
    messageTemplates: payload.messageTemplates.length,
  };
}
