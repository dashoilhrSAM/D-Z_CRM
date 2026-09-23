// 源码护栏（P2）：把两条"只能有一个写入者"的规矩变成**会失败的测试**。
//
// 为什么要有这个：佣金最危险的失效方式不是算错，而是**两个地方都在算**——
// 台账说一个数、字段说另一个数、页面显示第三个数，谁都说不清哪个是真的。
// 设计稿 §9 明确要求"禁止引擎之外的地方写 commissionSen；禁止删除台账唯一键"，
// 所以这两条在这里被钉死（与 tests/api-auth.test.ts 扫 API 路由是同一做派）。
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

/** 递归列出 src 下的 ts/tsx（手写递归而不是 fs.globSync：后者在 Node 24 有运行时但类型定义里没有）。 */
function srcFiles(dir: string = path.join(process.cwd(), "src")): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...srcFiles(full));
    else if ((entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) && !entry.name.endsWith(".d.ts")) out.push(full);
  }
  return out;
}

const read = (f: string) => readFileSync(f, "utf8");
const rel = (f: string) => path.relative(process.cwd(), f);

describe("台账只能追加：没有任何地方 UPDATE / DELETE 它", () => {
  it("src/** 里不存在 commissionLedger.update / updateMany / delete / deleteMany", () => {
    const offenders: string[] = [];
    for (const file of srcFiles()) {
      const src = read(file);
      for (const bad of ["commissionLedger.update(", "commissionLedger.updateMany(", "commissionLedger.delete(", "commissionLedger.deleteMany("]) {
        if (src.includes(bad)) offenders.push(rel(file) + " → " + bad);
      }
    }
    expect(offenders, "台账是唯一真相且只追加：改错要追加 ADJUSTMENT/REVERSAL，不是改原值").toEqual([]);
  });

  it("schema 里台账的唯一键还在（删掉它等于放弃幂等）", () => {
    const schema = read(path.join(process.cwd(), "prisma/schema.prisma"));
    expect(schema).toContain("@@unique([jobItemId, kind])");
  });
});

describe("ServiceJob.commissionSen 只是显示用汇总，不能成为第二个真相", () => {
  it("src/** 里只有 settlements 一处写它，且那一处同时写台账 ADJUSTMENT", () => {
    const writers: string[] = [];
    for (const file of srcFiles()) {
      const src = read(file);
      if (!/serviceJob\.update\(/.test(src)) continue;
      // 只有"data 里带 commissionSen"才算写它
      const mentions = src.split("serviceJob.update(").some((chunk) => chunk.slice(0, 400).includes("commissionSen"));
      if (mentions) writers.push(rel(file));
    }
    expect(writers, "写 commissionSen 的地方应当只有一处（人工调整），其余走台账").toEqual(["src/actions/settlements.ts"]);
    const settlements = read(path.join(process.cwd(), "src/actions/settlements.ts"));
    expect(settlements, "人工调整必须留一条 ADJUSTMENT 台账，否则金额失去来源").toContain('kind: "ADJUSTMENT"');
  });

  it("计提引擎只写台账，不写 commissionSen", () => {
    const engine = read(path.join(process.cwd(), "src/modules/commission/engine.ts"));
    expect(engine).not.toContain("commissionSen");
    expect(engine).toContain("commissionLedger.create");
  });
});
