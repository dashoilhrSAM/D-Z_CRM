// 并发竞态的结构性守卫。
//
// 这些洞的共同点：**本地测试永远抓不到**。
//  - 时段超卖：实测（scripts/perf/repro-races.ts）容量 3 的时段上 10 个并发预约全部成功。
//  - 库存丢失更新：Prisma + sqlite 的交互事务把并发串行化了，本地跑一百遍都是对的；
//    而在生产 PG（READ COMMITTED）下"读 current → 写 current-qty"是标准的丢失更新。
// 所以这里不靠并发复现（那需要 DB 与调度运气），而是守住**写法**：
// 能原子更新的地方不许再出现"先读后写"。
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const read = (p: string) => readFileSync(path.join(process.cwd(), p), "utf8");
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
/**
 * 取函数体：从 name 起，到"顶格两空格闭合花括号"那一行为止。
 * 注意必须用 /\n  \}\n/ 而不是 indexOf("\n  }")：后者会被**多行参数列表**里的
 * "\n  }) {" 提前命中，把函数体截断在签名处（第一版就是这么让断言失败/空跑的）。
 */
const fnBody = (src: string, name: string): string => {
  const start = src.indexOf(name);
  if (start < 0) return "";
  const end = src.slice(start).search(/\n  \}\n/);
  return end < 0 ? src.slice(start) : src.slice(start, start + end);
};

describe("库存：增量与条件更新，不再先读后写", () => {
  const inv = strip(read("src/modules/inventory/service.ts"));

  it("扣库存走条件原子更新，失败才回读一次报错", () => {
    const body = fnBody(inv, "private async deductStockTx");
    expect(body, "deductStockTx 找不到（断言会空跑）").not.toBe("");
    expect(body).toContain("deductInventory(");
    // 旧写法：读 current → 写 current - qty
    expect(body, "不许再读出来算完再写回").not.toMatch(/upsertInventory\([^)]*current - qty/);
  });

  it("入库与调拨用增量，不再把读到的值加完写回", () => {
    expect(fnBody(inv, "private async addStockTx")).toContain("addInventory(");
    const transfer = fnBody(inv, "async transferStock");
    expect(transfer).toContain("addInventory(");
    expect(transfer, "调拨调入方也要增量").not.toMatch(/upsertInventory\([^)]*current \+ qty/);
  });

  it("仓库层真的有这两个原子方法（条件在 SQL 里）", () => {
    const repo = strip(read("src/repositories/prisma/inventory.repository.ts"));
    expect(repo).toContain("deductInventory(");
    expect(repo).toMatch(/quantity: \{ gte: qty \}/);
    expect(repo).toMatch(/quantity: \{ decrement: qty \}/);
    expect(repo).toMatch(/quantity: \{ increment: delta \}/);
    const iface = read("src/modules/inventory/repository.ts");
    expect(iface).toContain("deductInventory");
    expect(iface).toContain("addInventory");
  });
});

describe("时段容量：检查与占用是同一条语句，且取消/改期会释放", () => {
  const bk = strip(read("src/modules/bookings/service.ts"));

  it("占位是条件更新 + 受影响行数判定", () => {
    const claim = fnBody(bk, "private async claimSeat");
    expect(claim, "claimSeat 找不到").not.toBe("");
    expect(claim).toMatch(/bookedCount: \{ lt: slot\.maxBookings \}/);
    expect(claim).toMatch(/bookedCount: \{ increment: 1 \}/);
    expect(claim, "抢不到必须抛 SLOT_FULL").toContain("SLOT_FULL");
  });

  it("建单用 claimSeat，且建单失败会把名额放回去", () => {
    const create = fnBody(bk, "async create(input");
    expect(create).toContain("claimSeat(");
    expect(create, "失败要补偿释放，否则一次失败永久吃一个名额").toContain("releaseSeatById(claimedSlotId)");
    // 旧的"建完单再 increment"必须消失（那正是超卖的来源）
    expect(create, "不许再在建单之后单独 increment").not.toMatch(/data: \{ bookedCount: \{ increment: 1 \} \}/);
  });

  it("取消/爽约/改期换时段会释放旧名额，且只在状态真的变化时释放", () => {
    const tr = fnBody(bk, "async transition(");
    expect(tr).toContain("releaseSeat(");
    expect(tr, "重复取消不许把计数减到负数（真实占用会被减掉）").toContain("before.status !== status");
    expect(tr).toContain('"CANCELLED"');
    expect(tr).toContain('"NO_SHOW"');
  });
});
