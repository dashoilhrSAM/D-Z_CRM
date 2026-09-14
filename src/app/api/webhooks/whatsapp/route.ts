import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

/**
 * Meta WhatsApp Business Cloud API 投递回执 webhook（Messaging → 换真 的配套）。
 *
 * Meta Developers → WhatsApp → Configuration 配置：
 *   Callback URL = https://<domain>/api/webhooks/whatsapp
 *   Verify token = $WHATSAPP_VERIFY_TOKEN
 * 收到 statuses（sent/delivered/read/failed）后，按 Message.externalId 更新 Message.status。
 * 未配置 WHATSAPP_VERIFY_TOKEN 时 fail-safe：GET 403（无法验签）、POST 503（不落库）。
 *
 * 验签（2026-09-14 修正）：**只要配置了 WHATSAPP_APP_SECRET，签名就是必须的**。
 * 旧写法是 `if (SECRET && signature)` —— 攻击者只要**不发** x-hub-signature-256 头，
 * 整段验签就被跳过，于是任何人都能 POST 伪造 statuses，把任意 externalId 的消息状态改成
 * DELIVERED/FAILED，污染送达率与 MSG-020 失败记录。现在：缺头/不匹配一律 401，
 * 且用恒定时间比较（避免按字节比较的时序侧信道）。
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type WaStatus = "SENT" | "DELIVERED" | "READ" | "FAILED";

const STATUS_MAP: Record<string, WaStatus> = {
  sent: "SENT",
  delivered: "DELIVERED",
  read: "READ",
  failed: "FAILED",
  error: "FAILED",
};

export async function GET(req: NextRequest) {
  const token = process.env.WHATSAPP_VERIFY_TOKEN;
  if (!token) return new NextResponse("verify token not configured", { status: 403 });
  const mode = req.nextUrl.searchParams.get("hub.mode");
  const verifyToken = req.nextUrl.searchParams.get("hub.verify_token");
  const challenge = req.nextUrl.searchParams.get("hub.challenge");
  if (mode === "subscribe" && verifyToken === token && challenge) {
    return new NextResponse(challenge);
  }
  return new NextResponse("verification failed", { status: 403 });
}

/** 状态只能前进：Meta 会重试且不保证顺序，迟到的 sent 不许把已 READ 打回去。 */
const STATUS_RANK: Partial<Record<WaStatus, number>> = { SENT: 1, DELIVERED: 2, READ: 3 };

/** 用 where 条件表达"非降级"：写不进就不写，不需要先读一次（原子、且省一次查询）。 */
function downgradeGuard(mapped: WaStatus): { notIn?: WaStatus[] } {
  const rank = STATUS_RANK[mapped];
  if (!rank) return {}; // FAILED 等终态：任何时候都该记下来
  const higher = (Object.keys(STATUS_RANK) as WaStatus[]).filter((s) => (STATUS_RANK[s] ?? 0) > rank);
  return higher.length ? { notIn: higher } : {};
}

export async function POST(req: NextRequest) {
  const appSecret = process.env.WHATSAPP_APP_SECRET;
  if (!process.env.WHATSAPP_VERIFY_TOKEN || !appSecret) {
    // 不验签就不能收写入：宁可 503（能被监控看见）也不要 200 静默空转。
    return NextResponse.json({ ok: false, error: "whatsapp webhook is not configured" }, { status: 503 });
  }
  const raw = await req.text();
  const signature = req.headers.get("x-hub-signature-256");
  if (!signature) return NextResponse.json({ ok: false, error: "missing signature" }, { status: 401 });
  const crypto = (await import("crypto")).default;
  const expected = "sha256=" + crypto.createHmac("sha256", appSecret).update(raw).digest("hex");
  const sigBuf = Buffer.from(signature);
  const expBuf = Buffer.from(expected);
  if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
    return NextResponse.json({ ok: false, error: "bad signature" }, { status: 401 });
  }
  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    return NextResponse.json({ ok: false, error: "invalid json" }, { status: 400 });
  }
  type StatusRow = { id?: string; status?: string };
  type WaChange = { value?: { statuses?: StatusRow[] } };
  const entries = (payload as { entry?: { changes?: WaChange[] }[] }).entry ?? [];
  let updated = 0;
  for (const entry of entries) {
    for (const change of entry.changes ?? []) {
      for (const st of change.value?.statuses ?? []) {
        const id = st.id;
        const mapped = STATUS_MAP[st.status ?? ""];
        if (id && mapped) {
          const guard = downgradeGuard(mapped);
          const res = await db.message.updateMany({
            where: guard.notIn ? { externalId: id, status: { notIn: guard.notIn } } : { externalId: id },
            data: { status: mapped },
          });
          updated += res.count;
        }
      }
    }
  }
  return NextResponse.json({ ok: true, updated });
}
