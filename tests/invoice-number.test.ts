// 发票号分配（2026-09-23 修的真 bug）。
//
// 原来的写法是 count(该年发票) + 1：两个并发完工事务读到同一个 count，第二张发票撞唯一键，
// **整个完工事务回滚**（发票 / 收款 / 库存扣减 / 佣金 / 服务提醒一起没了）。
// 这个失败是在并行跑全量测试时偶发暴露的（10 轮里第 6 轮），单跑永远看不到。
//
// 这里钉的是**契约**，不是竞态本身：本地 sqlite 在 Prisma 交互事务下是串行的，
// 真实竞态复现不出来（本项目已有明文教训）。所以断言"唯一 + 单调 + 从不回退"，
// 而原子性由实现保证（INSERT ... ON CONFLICT DO UPDATE 的 value = value + 1）。
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const saved = { databaseUrl: process.env.DATABASE_URL };
const tag = "inv" + Date.now().toString(36);
// **合成年份**：计数器是按年份全局的（生产语义正确），而并行跑的其它测试文件
// （完工链路）也在推进当前年份的计数器 —— 用真实年份会让断言拿到被它们推进过的值。
// 全量跑第一次就是这么红的：单独跑绿、并行跑红，正是"共享状态"的典型症状。
const YEAR = 2099;
const PREFIX = "DZ-" + YEAR + "-";

let db: typeof import("@/lib/db")["db"];
let nextInvoiceNumber: typeof import("@/services/completion")["nextInvoiceNumber"];

let orgId = "";
let branchId = "";
let customerId = "";
let motoId = "";
const jobIds: string[] = [];
const invoiceIds: string[] = [];

/** 造一张工单（发票要挂在它上面）。 */
async function makeJob(n: number) {
  const job = await db.serviceJob.create({
    data: {
      jobNumber: "INV-" + tag + "-" + n, branchId, customerId, motorcycleId: motoId,
      mileage: 1000 + n, status: "COMPLETED", completedAt: new Date(),
    },
  });
  jobIds.push(job.id);
  return job.id;
}

/** 直接造一张已有发票，用来模拟"这一年已经有号了"。 */
async function seedInvoice(seq: number) {
  const inv = await db.invoice.create({
    data: {
      branchId, customerId, jobId: await makeJob(seq), invoiceNumber: PREFIX + String(seq).padStart(5, "0"),
      subtotalSen: 1000, discountSen: 0, totalSen: 1000, status: "ISSUED",
    },
  });
  invoiceIds.push(inv.id);
  return inv;
}

/** 在真事务里取一个号（与完工流程用的是同一个函数）。 */
async function allocate(): Promise<string> {
  return db.$transaction((tx) => nextInvoiceNumber(tx, YEAR));
}

beforeAll(async () => {
  process.env.DATABASE_URL = saved.databaseUrl ?? "file:./dev.db";
  ({ db } = await import("@/lib/db"));
  ({ nextInvoiceNumber } = await import("@/services/completion"));

  const org = await db.organisation.create({ data: { name: "INVNUM-" + tag } });
  orgId = org.id;
  const branch = await db.branch.create({ data: { organisationId: org.id, name: "Inv Branch", city: "Petaling Jaya" } });
  branchId = branch.id;
  const customer = await db.customer.create({ data: { organisationId: org.id, name: "Inv Customer " + tag } });
  customerId = customer.id;
  const moto = await db.motorcycle.create({ data: { customerId, plate: ("I" + tag.slice(-5)).toUpperCase(), brand: "Test", model: "Inv Bike", year: 2019, currentMileage: 1000 } });
  motoId = moto.id;
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
  // 计数器按年份：只清掉这个**合成年份**的行（真实年份的计数器属于本地/生产使用，不能碰），
  // 且必须在删掉测试发票之后清，否则别的使用会从错误的号继续。
  await db.invoiceCounter.deleteMany({ where: { year: YEAR } });
  await db.motorcycle.deleteMany({ where: { customerId } });
  await db.customer.deleteMany({ where: { organisationId: orgId } });
  await db.branch.deleteMany({ where: { organisationId: orgId } });
  await db.organisation.delete({ where: { id: orgId } });
});

describe("发票号：唯一、单调、从不回退", () => {
  it("这一年已经有 DZ-YYYY-00007 → 下一个号必须从 8 接上（不从 1 重开）", async () => {
    await seedInvoice(7);
    const next = await allocate();
    expect(next).toBe(PREFIX + "00008");
  });

  it("**并发取号不重号**（这正是原来 count+1 会撞唯一键的场景）", async () => {
    const got = await Promise.all([allocate(), allocate(), allocate(), allocate(), allocate()]);
    expect(new Set(got).size).toBe(5); // 5 个号互不相同
    for (const n of got) expect(n.startsWith(PREFIX)).toBe(true);
  });

  it("顺序取号严格递增，且号码补零（字符串排序 = 数值排序）", async () => {
    const a = await allocate();
    const b = await allocate();
    const seq = (s: string) => parseInt(s.slice(PREFIX.length), 10);
    expect(seq(b)).toBe(seq(a) + 1);
    expect(b.slice(PREFIX.length)).toHaveLength(5);
  });

  it("删掉一张发票**不会**让号码回退（count 会变小，这曾是第二个隐患）", async () => {
    const before = await allocate();
    const victim = await seedInvoice(99999); // 造一张大号再删掉
    await db.invoice.delete({ where: { id: victim.id } });
    const after = await allocate();
    const seq = (s: string) => parseInt(s.slice(PREFIX.length), 10);
    expect(seq(after)).toBeGreaterThan(seq(before));
  });
});
