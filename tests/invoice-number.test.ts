// 发票号分配（2026-09-23 修的真 bug；2026-09-30 P1b 改成按租户一条序列）。
//
// 原来的写法是 count(该年发票) + 1：两个并发完工事务读到同一个 count，第二张发票撞唯一键，
// **整个完工事务回滚**（发票 / 收款 / 库存扣减 / 佣金 / 服务提醒一起没了）。
// 这个失败是在并行跑全量测试时偶发暴露的（10 轮里第 6 轮），单跑永远看不到。
//
// 这里钉的是**契约**，不是竞态本身：本地 sqlite 在 Prisma 交互事务下是串行的，
// 真实竞态复现不出来（本项目已有明文教训）。所以断言"唯一 + 单调 + 从不回退"，
// 而原子性由实现保证（INSERT ... ON CONFLICT DO UPDATE 的 value = value + 1）。
//
// 2026-09-30（P1b）新增第 4 条契约：**两家店的序列互不影响**。
// 这是 InvoiceCounter 主键从 `year` 改成 `[organisationId, year]` 的验收点，也是本轮唯一
// 不能只改一半的地方 —— 只把"回看最大号"按租户收窄而计数器仍是全局的，
// 会把全局序列建到另一家的 max 之下，那家随后取号撞自己已有的号 → 同样是完工事务回滚。
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import os from "node:os";

const saved = { databaseUrl: process.env.DATABASE_URL };
const tag = "inv" + Date.now().toString(36);
/**
 * 并发度：`min(5, 本机可用 CPU 数)`，下限 2。
 *
 * 为什么要跟着机器走：Prisma 在 SQLite 上跑**交互事务**时，并发数一旦超过查询引擎的
 * worker 线程数就会把引擎自己锁死 —— 全部请求 P1008（连持锁的那个也一起失败），
 * 上游 issue：prisma/orm#29870「concurrent interactive transactions deadlock the query
 * engine at N > worker threads」。本机 15 核跑 5 个没事，GitHub 的 2 核 runner 上必红：
 * 那是 runner 的能力问题，不是这段代码的问题（2026-09-30 CI 实测，连红两轮）。
 *
 * 下限保 2：**两个并发就足以让"各读到同一个 count"的实现重号**（见文件头那个真 bug），
 * 所以守卫没有被削弱 —— 只是不再要求机器能同时跑 5 个交互事务。
 */
const CONCURRENCY = Math.max(2, Math.min(5, os.availableParallelism?.() ?? os.cpus().length));
// **合成年份**：避免与并行跑的其它测试文件（完工链路）互相推进计数器。
// 全量跑第一次就是这么红的：单独跑绿、并行跑红，正是"共享状态"的典型症状。
const YEAR = 2099;
const PREFIX = "DZ-" + YEAR + "-";

let db: typeof import("@/lib/db")["db"];
let nextInvoiceNumber: typeof import("@/services/completion")["nextInvoiceNumber"];

/** 一个租户的完整夹具（组织 + 分行 + 客户 + 车辆）。 */
interface Tenant {
  orgId: string;
  branchId: string;
  customerId: string;
  motoId: string;
}
const tenants: Tenant[] = [];
const jobIds: string[] = [];
const invoiceIds: string[] = [];

async function makeTenant(label: string, plate: string): Promise<Tenant> {
  const org = await db.organisation.create({ data: { name: "INVNUM-" + label + "-" + tag, slug: "invnum-" + label + "-" + tag } });
  const branch = await db.branch.create({ data: { organisationId: org.id, name: "Inv Branch " + label, city: "Petaling Jaya" } });
  const customer = await db.customer.create({ data: { organisationId: org.id, name: "Inv Customer " + label + " " + tag } });
  const moto = await db.motorcycle.create({
    data: { organisationId: org.id, customerId: customer.id, plate, brand: "Test", model: "Inv Bike", year: 2019, currentMileage: 1000 },
  });
  const t = { orgId: org.id, branchId: branch.id, customerId: customer.id, motoId: moto.id };
  tenants.push(t);
  return t;
}

/** 造一张工单（发票要挂在它上面）。 */
async function makeJob(t: Tenant, n: number) {
  const job = await db.serviceJob.create({
    data: {
      organisationId: t.orgId,
      jobNumber: "INV-" + tag + "-" + n, branchId: t.branchId, customerId: t.customerId, motorcycleId: t.motoId,
      mileage: 1000 + n, status: "COMPLETED", completedAt: new Date(),
    },
  });
  jobIds.push(job.id);
  return job.id;
}

/** 直接造一张已有发票，用来模拟"这一年已经有号了"。 */
async function seedInvoice(t: Tenant, seq: number) {
  const inv = await db.invoice.create({
    data: {
      organisationId: t.orgId,
      branchId: t.branchId, customerId: t.customerId, jobId: await makeJob(t, seq), invoiceNumber: PREFIX + String(seq).padStart(5, "0"),
      subtotalSen: 1000, discountSen: 0, totalSen: 1000, status: "ISSUED",
    },
  });
  invoiceIds.push(inv.id);
  return inv;
}

/** 在真事务里取一个号（与完工流程用的是同一个函数）。 */
async function allocate(t: Tenant): Promise<string> {
  return db.$transaction((tx) => nextInvoiceNumber(tx, YEAR, t.orgId));
}

let A: Tenant;
let B: Tenant;

beforeAll(async () => {
  process.env.DATABASE_URL = saved.databaseUrl ?? "file:./dev.db";
  ({ db } = await import("@/lib/db"));
  ({ nextInvoiceNumber } = await import("@/services/completion"));
  A = await makeTenant("a", ("IA" + tag.slice(-5)).toUpperCase());
  B = await makeTenant("b", ("IB" + tag.slice(-5)).toUpperCase());
});

afterAll(async () => {
  await db.invoice.deleteMany({ where: { id: { in: invoiceIds } } });
  await db.invoice.deleteMany({ where: { invoiceNumber: { startsWith: "DZ-" + YEAR + "-" } } });
  await db.invoice.deleteMany({ where: { jobId: { in: jobIds } } });
  for (const id of jobIds) {
    await db.serviceJobItem.deleteMany({ where: { jobId: id } });
    await db.serviceJobPart.deleteMany({ where: { jobId: id } });
    await db.commissionLedger.deleteMany({ where: { jobId: id } });
    await db.jobStatusHistory.deleteMany({ where: { jobId: id } });
    await db.serviceJob.delete({ where: { id } });
  }
  // 计数器只清这个**合成年份**（真实年份的属于本地/生产使用，不能碰），
  // 且必须在删掉测试发票之后清，否则别的使用会从错误的号继续。
  await db.invoiceCounter.deleteMany({ where: { year: YEAR } });
  for (const t of tenants) {
    await db.motorcycle.deleteMany({ where: { organisationId: t.orgId } });
    await db.customer.deleteMany({ where: { organisationId: t.orgId } });
    await db.branch.deleteMany({ where: { organisationId: t.orgId } });
    await db.organisation.delete({ where: { id: t.orgId } });
  }
});

describe("发票号：唯一、单调、从不回退", () => {
  it("这一年已经有 DZ-YYYY-00007 → 下一个号必须从 8 接上（不从 1 重开）", async () => {
    await seedInvoice(A, 7);
    const next = await allocate(A);
    expect(next).toBe(PREFIX + "00008");
  });

  it("**并发取号不重号**（这正是原来 count+1 会撞唯一键的场景）", async () => {
    const got = await Promise.all(Array.from({ length: CONCURRENCY }, () => allocate(A)));
    expect(new Set(got).size).toBe(CONCURRENCY); // 号互不相同
    for (const n of got) expect(n.startsWith(PREFIX)).toBe(true);
  });

  it("顺序取号严格递增，且号码补零（字符串排序 = 数值排序）", async () => {
    const a = await allocate(A);
    const b = await allocate(A);
    const seq = (s: string) => parseInt(s.slice(PREFIX.length), 10);
    expect(seq(b)).toBe(seq(a) + 1);
    expect(b.slice(PREFIX.length)).toHaveLength(5);
  });

  it("删掉一张发票**不会**让号码回退（count 会变小，这曾是第二个隐患）", async () => {
    const before = await allocate(A);
    const victim = await seedInvoice(A, 99999); // 造一张大号再删掉
    await db.invoice.delete({ where: { id: victim.id } });
    const after = await allocate(A);
    const seq = (s: string) => parseInt(s.slice(PREFIX.length), 10);
    expect(seq(after)).toBeGreaterThan(seq(before));
  });
});

describe("发票号：按租户各一条序列（P1b）", () => {
  it("B 店从**自己**的最大号起步，不受 A 店已经发到多少影响", async () => {
    // 对照组：A 店这一年已经发出去很多号（上面几条推进过），B 店一张都没有。
    const aMax = await db.invoice.findFirst({
      where: { organisationId: A.orgId, invoiceNumber: { startsWith: PREFIX } },
      orderBy: { invoiceNumber: "desc" }, select: { invoiceNumber: true },
    });
    expect(aMax, "对照组：A 店当年已有发票").toBeTruthy();
    expect(await db.invoice.count({ where: { organisationId: B.orgId, invoiceNumber: { startsWith: PREFIX } } })).toBe(0);

    // B 店的第一张应当是 00001 —— 如果计数器还是全局的，这里会拿到 A 店的下一个号。
    await seedInvoice(B, 3);
    const next = await allocate(B);
    expect(next).toBe(PREFIX + "00004");
  });

  it("两家店各自独立递增，取号互不干扰", async () => {
    const a1 = await allocate(A);
    const b1 = await allocate(B);
    const a2 = await allocate(A);
    const b2 = await allocate(B);
    const seq = (s: string) => parseInt(s.slice(PREFIX.length), 10);
    expect(seq(a2)).toBe(seq(a1) + 1);
    expect(seq(b2)).toBe(seq(b1) + 1);
    // 交叉取号不会让任一家的序列跳号
    expect(b1).not.toBe(a1);
  });

  it("计数器按 (租户, 年份) 落行", async () => {
    const rows = await db.invoiceCounter.findMany({ where: { year: YEAR, organisationId: { in: [A.orgId, B.orgId] } } });
    expect(rows.length, "两家店各一条计数器行").toBe(2);
    for (const r of rows) expect(r.value).toBeGreaterThan(0);
  });
});
