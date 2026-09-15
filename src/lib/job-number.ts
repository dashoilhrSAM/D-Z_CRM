/**
 * 工单号（DZ####）的**唯一定义**。
 *
 * 生成工单号此前有两份各自 max+1 的实现（`PrismaJobRepository.nextJobNumber` 与
 * `bookingService.checkIn` 里内联的那份），两份犯的是同一个错：把 jobNumber 当**字符串**
 * 排序取"最大号"。
 *
 *  1. 字符串序里 DZ9999 排在 DZ10000 **之后**（'9' > '1'），于是系统认定最大号是 DZ9999，
 *     下一个发出 DZ10000 —— 而那个号已经存在，`jobNumber @unique` 必然拒绝。
 *     这不是"并发才偶发"：**四位数用完的那一天起，每一次建单都失败**，而且重试算出的
 *     还是同一个号，不会自愈（本地可确定性复现，见 scripts/perf/repro-races.ts 场景 D）。
 *  2. 号码里混进别的格式时（例如压测数据造出的 PERF900299），`replace(/\D/g, "")` 会把
 *     前缀一起剥掉参与比较，算出 DZ900300 这种凭空跳号——号码来源不该被无关格式影响。
 *
 * 所以：按**数值**取最大，且只认严格符合 `DZ<十进制数>` 的行；其余格式一律不当号码看。
 *
 * 并发那一半没法靠条件更新解决（编号是序列，不是计数器字段），由唯一约束当裁判：
 * 两笔同时算号会算出同一个号，插入时输的那笔重算再来 —— `retryOnJobNumberConflict`。
 */
import type { Prisma, PrismaClient } from "@prisma/client";

export const JOB_NUMBER_PREFIX = "DZ";
/** 历史起点：库里的号从 DZ1024 开始（seed 与线上一致），空库也从这里发。 */
export const FIRST_JOB_NUMBER = 1024;
/** 撞号重试次数。并发抢同一号时，输的那笔重算一次基本就过；3 次是给异常调度留的余量。 */
export const JOB_NUMBER_ATTEMPTS = 3;

const JOB_NUMBER_PATTERN = /^DZ(\d+)$/;

/**
 * 严格解析：只认 `DZ<十进制数>`。
 * 其它格式（历史遗留、导入数据、压测前缀）返回 null —— 宁可忽略，也不要把它们折算成号码。
 */
export function parseJobNumber(value: string): number | null {
  const matched = JOB_NUMBER_PATTERN.exec(value.trim());
  if (!matched) return null;
  const n = Number.parseInt(matched[1], 10);
  return Number.isSafeInteger(n) ? n : null;
}

export function formatJobNumber(n: number): string {
  return JOB_NUMBER_PREFIX + n;
}

/** 下一个工单号：按数值取最大（不是按字符串）。 */
export function nextJobNumberFrom(existing: Iterable<string>): string {
  let max = FIRST_JOB_NUMBER - 1;
  for (const raw of existing) {
    const n = parseJobNumber(raw);
    if (n !== null && n > max) max = n;
  }
  return formatJobNumber(max + 1);
}

type DbLike = PrismaClient | Prisma.TransactionClient;

/**
 * 分配下一个工单号。
 *
 * 只取 jobNumber 一列（不带 include）—— 号码的最大值只能看全表，谁也替不了。
 * 代价是每次建单扫一遍号码列；量级参考压测档（35k 工单 ≈ 几百 KB），
 * 若将来这一列成为瓶颈，升级路径是换成一张真正的计数器表（一次 increment 即出号）。
 */
export async function allocateJobNumber(client: DbLike): Promise<string> {
  const rows = await client.serviceJob.findMany({ select: { jobNumber: true } });
  return nextJobNumberFrom(rows.map((row) => row.jobNumber));
}

/**
 * 这次失败是不是"工单号撞了"（并发下两笔算出同一个号）。
 *
 * 只认 P2002 且 target 指向 jobNumber；Prisma 没给出 target 时按撞号处理——
 * 重试整笔是一个失败即回滚的操作，多试一次无害，而漏判会让柜台看到报错。
 * 其它唯一约束（例如 Booking.jobId / Quotation.jobId）不会带 jobNumber，因此不会被误重试。
 */
export function isJobNumberConflict(error: unknown): boolean {
  const e = error as { code?: unknown; meta?: { target?: unknown } } | null;
  if (!e || typeof e !== "object" || e.code !== "P2002") return false;
  const target = e.meta?.target;
  if (target === undefined || target === null) return true;
  const fields = Array.isArray(target) ? target : [target];
  return fields.some((f) => String(f).includes("jobNumber"));
}

/**
 * 跑一个"算号 → 落库"的动作，撞号就重算重来。
 *
 * 传的是闭包而不是数据，因为两条建单路径的形状不同：柜台建单是 repo.create，
 * 预约 check-in 要另起一个事务（算号与插入必须在同一个事务里）。
 */
export async function retryOnJobNumberConflict<T>(run: () => Promise<T>): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= JOB_NUMBER_ATTEMPTS; attempt++) {
    try {
      return await run();
    } catch (error) {
      if (!isJobNumberConflict(error)) throw error;
      lastError = error;
    }
  }
  throw lastError;
}
