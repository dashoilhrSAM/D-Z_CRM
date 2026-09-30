/**
 * AI 回复草稿生成（本地 Ollama via n8n Webhook）
 *
 * 非侵入式接入：新工单创建后异步调用本地 AI 生成"给客户的回复草稿"，
 * 存入 Message 表（direction=OUT, channel=SYSTEM, status=QUEUED，不实际发送）。
 *
 * 开关：环境变量 AI_DRAFT_WEBHOOK_URL（指向 n8n Webhook，如
 *   http://host.docker.internal:5678/webhook/local-ai）
 * 未配置时静默跳过，不影响主流程；网络失败也不抛错。
 */

import { db } from "@/lib/db";

const WEBHOOK_URL = process.env.AI_DRAFT_WEBHOOK_URL ?? "";

export interface AiDraftResult {
  ok: boolean;
  draft?: string;
  skipped?: boolean;
}

export async function generateAiReplyDraft(jobId: string): Promise<AiDraftResult> {
  if (!WEBHOOK_URL) return { ok: false, skipped: true };

  try {
    // 读取工单 + 客户 + 摩托车信息，构造给 AI 的上下文
    const job = await db.serviceJob.findUnique({
      where: { id: jobId },
      include: {
        customer: { select: { name: true, phone: true } },
        motorcycle: { select: { model: true, plate: true, currentMileage: true, year: true } },
        branch: { select: { organisationId: true } },
      },
    });
    if (!job) return { ok: false, skipped: true };

    const prompt = [
      `你是 D&Z 摩托车维修店的前台。客户 ${job.customer.name}` +
        (job.customer.phone ? `（电话 ${job.customer.phone}）` : "") +
        ` 的车辆 ${job.motorcycle.model}（${job.motorcycle.year} 年）` +
        (job.motorcycle.plate ? `，车牌 ${job.motorcycle.plate}` : "") +
        `，当前里程 ${job.motorcycle.currentMileage} km。`,
      `工单号：${job.jobNumber}，类型：${job.type}，状态：${job.status}。`,
      job.customerRequest ? `客户诉求：${job.customerRequest}` : "客户未填写具体诉求。",
      "请用中文生成一段发给客户的简短回复草稿（确认收到车辆、说明下一步安排、语气专业友好）。",
      "只输出草稿正文，不要加标题或前后缀。",
    ].join("\n");

    const res = await fetch(WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt }),
      signal: AbortSignal.timeout(120_000),
    });
    if (!res.ok) return { ok: false };

    const data = (await res.json()) as { response?: string };
    const draft = (data.response ?? "").trim();
    if (!draft) return { ok: false };

    // 存为草稿消息（不发送）
    await db.message.create({
      data: {
        organisationId: job.branch?.organisationId ?? "",
        branchId: job.branchId,
        customerId: job.customerId,
        jobId: job.id,
        direction: "OUT",
        channel: "SYSTEM",
        body: `[AI 草稿] ${draft}`,
        status: "QUEUED",
        referenceType: "AI_DRAFT",
        referenceId: job.jobNumber,
      },
    });
    return { ok: true, draft };
  } catch {
    // 本地 AI 不可用不影响工单创建主流程
    return { ok: false };
  }
}
