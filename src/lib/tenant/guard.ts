/**
 * 租户守卫（P2）—— 把"隔离靠每个调用点记得写"变成"忘了写就会被抓出来"。
 *
 * 两种模式，用途不同：
 *
 *  1. **审计模式（TENANT_GUARD=report|throw）**：挂在一个**普通 Client 上**，
 *     只**检查**每条查询有没有带租户条件，不注入任何东西。
 *     它的价值在于：跑一遍已有的 913 条单测 + e2e，就能拿到**真实的**未收窄查询清单 ——
 *     不是静态猜"哪些像没收窄"，而是看代码实际发了什么查询。
 *     `pnpm test` 时带上 TENANT_GUARD=report 即可。
 *
 *  2. **强制模式（scopedDb(orgId)）**：给一个**已绑定租户**的 Client，
 *     自动注入租户条件，并在拿不到租户时**抛错**（fail-closed）。
 *     这是新代码/改造后代码应该用的入口；迁移是增量的，见文件末尾说明。
 *
 * 判定依据是 `scope-map.ts` —— 每张表怎么到达租户在那里有唯一定义，
 * 且有 12 条对账测试保证它不漂移。这里只做"args 里有没有这个键"的机械检查。
 */
import { appendFileSync } from "node:fs";
import type { PrismaClient } from "@prisma/client";
import { TENANT_SCOPE } from "./scope-map";

/** 需要带租户条件的操作（读与写都要）。 */
const SCOPED_OPS = new Set([
  "findMany", "findFirst", "findFirstOrThrow", "count", "aggregate", "groupBy",
  "updateMany", "deleteMany",
]);
/** 只能吃唯一键、因此**结构上无法**表达租户条件的操作 —— 单独一类。 */
const UNIQUE_ONLY_OPS = new Set(["findUnique", "findUniqueOrThrow"]);
/** 写入：租户值必须出现在 data 里，否则这一行逃出唯一约束（NULL 不受约束）。 */
const CREATE_OPS = new Set(["create", "createMany"]);
/** update/delete 的 where 允许非唯一过滤（Prisma 5+），所以能带租户条件。 */
const WRITE_BY_WHERE_OPS = new Set(["update", "delete", "upsert"]);

export type ViolationKind = "missing-tenant" | "unique-lookup" | "missing-tenant-on-create";

export interface Violation {
  kind: ViolationKind;
  model: string;
  operation: string;
  /** 触发这次查询的**调用点**（从栈里挑第一条业务代码）——没有它这份清单没法改。 */
  at?: string;
}

/**
 * 从栈里挑出第一条**业务代码**行（跳过 Prisma 运行时与 node_modules）。
 * 没有它，审计只能告诉你"Customer.findMany 没带租户"，却不告诉你**是哪一行**写的。
 */
function callerFromStack(): string | undefined {
  const lines = (new Error().stack ?? "").split("\n").slice(2);
  for (const l of lines) {
    if (l.includes("node_modules") || l.includes("node:")) continue;
    const m = l.match(/\((.*?):(\d+):(\d+)\)/) ?? l.match(/at (.*?):(\d+):(\d+)/);
    if (!m) continue;
    const file = m[1].replace(process.cwd() + "/", "");
    if (file.includes("tenant/guard.ts")) continue;
    return file + ":" + m[2];
  }
  return undefined;
}

/** 进程内累计（审计模式用；测试结束打印）。 */
export const violations: Violation[] = [];

/** 该模型在 where/data 里应该出现的租户键；null = 不属任何租户（shared/none）。 */
export function tenantKeyFor(model: string): string | null {
  const entry = TENANT_SCOPE[model];
  if (!entry) return null;
  if (entry.kind === "none" || entry.kind === "shared") return null;
  return entry.kind === "column" ? "organisationId" : entry.path[0];
}

/**
 * 在 where 里深度找租户键。
 *
 * **要进任意嵌套对象**，不能只看 AND/OR/NOT：复合唯一键会把租户名塞在键名里 ——
 * `findUnique({ where: { organisationId_year: { organisationId, year } } })` 是完全合规的
 * 租户内查询，但只在顶层找 `organisationId` 会把它误判成"没带租户条件"。
 * 第一版就是这么误报的（InvoiceCounter.findUnique × 18 全是假阳性）。
 *
 * 递归时**不进数组以外的叶子**（字符串/日期等），避免在值里瞎找。
 */
export function whereHasTenant(where: unknown, key: string): boolean {
  if (Array.isArray(where)) return where.some((x) => whereHasTenant(x, key));
  if (!where || typeof where !== "object") return false;
  const obj = where as Record<string, unknown>;
  if (key in obj) return true;
  for (const v of Object.values(obj)) {
    if (v && typeof v === "object" && whereHasTenant(v, key)) return true;
  }
  return false;
}

/** 在 data 里找租户值（含嵌套 create 的 data；createMany 是数组）。 */
function dataHasTenant(data: unknown, key: string): boolean {
  if (Array.isArray(data)) return data.every((d) => dataHasTenant(d, key));
  if (!data || typeof data !== "object") return false;
  return key in (data as Record<string, unknown>);
}

/** 检查一次操作。返回 null = 通过。 */
export function inspectOperation(model: string, operation: string, args: unknown): Violation | null {
  const key = tenantKeyFor(model);
  if (!key) return null; // 共享/无租户模型

  const a = (args ?? {}) as Record<string, unknown>;

  if (SCOPED_OPS.has(operation)) {
    return whereHasTenant(a.where, key) ? null : { kind: "missing-tenant", model, operation };
  }
  if (WRITE_BY_WHERE_OPS.has(operation)) {
    // upsert 还要求 create 分支带上租户值
    if (!whereHasTenant(a.where, key)) return { kind: "missing-tenant", model, operation };
    if (operation === "upsert" && !dataHasTenant(a.create, key)) {
      return { kind: "missing-tenant-on-create", model, operation };
    }
    return null;
  }
  if (CREATE_OPS.has(operation)) {
    return dataHasTenant(a.data, key) ? null : { kind: "missing-tenant-on-create", model, operation };
  }
  if (UNIQUE_ONLY_OPS.has(operation)) {
    // findUnique 的 where **只能吃唯一键**。所以分两种：
    //   · 复合唯一键里嵌了租户（organisationId_year / organisationId_sku …）→ 合规，放行；
    //   · 只按 id / plate / sku 等裸唯一键查 → 结构上写不出租户条件，
    //     这正是 IDOR 的经典来源（拿一个 id 直接查，不问它属于谁）。
    //     单独归一类：修法不是"补条件"，而是改成 findFirst 或经关系收窄。
    return whereHasTenant(a.where, key) ? null : { kind: "unique-lookup", model, operation };
  }
  return null;
}

/** 审计模式的开关与行为。 */
export function guardMode(): "off" | "report" | "throw" {
  const v = process.env.TENANT_GUARD;
  return v === "report" || v === "throw" ? v : "off";
}

/**
 * 审计结果落盘。
 *
 * 为什么必须落盘而不是留在内存里：vitest 默认对每个测试文件做模块隔离，
 * 每个文件一个独立的模块图与 worker —— 内存里的 `violations` 数组**互相看不见**。
 * 第一版就是这么写的，跑完 913 条测试一个字都没输出（看着像"零违规"，
 * 其实是汇总根本没被调用到）。落盘后由 scripts/tenant-guard-audit.mjs 聚合。
 */
const GUARD_FILE = process.env.TENANT_GUARD_FILE ?? ".tenant-guard.jsonl";

/**
 * 每条违规**即时**落盘。
 *
 * 为什么不攒到最后统一写：第一版用 `process.on("exit")` 收尾，在 vitest 的 worker 里
 * **根本不触发** —— 于是审计跑完一个字都没写，而聚合脚本把它读成"零违规"。
 * 一件"什么都没做"的探针看起来和"一切正常"完全一样，这正是本项目反复踩的坑。
 * 违规量是几十条级别，同步追加完全可以接受。
 *
 * 另外：写失败**必须吵**（下面 console.error），不许空 catch。
 */
function persist(v: Violation) {
  try {
    appendFileSync(GUARD_FILE, JSON.stringify(v) + "\n");
  } catch (e) {
    console.error("[tenant-guard] 审计结果写盘失败（本次审计无效）:", (e as Error).message);
  }
}

/** 给审计模式用的 Prisma 扩展：只检查，不改写。 */
export function auditExtension() {
  return {
    name: "tenant-audit",
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }: {
          model: string; operation: string; args: unknown; query: (a: unknown) => Promise<unknown>;
        }) {
          const v = inspectOperation(model, operation, args);
          if (v) {
            v.at = callerFromStack();
            violations.push(v);
            persist(v);
            if (guardMode() === "throw") {
              throw new Error(
                "TENANT_GUARD: " + v.kind + " — " + v.model + "." + v.operation +
                  "（未带租户条件；见 src/lib/tenant/scope-map.ts 的路径定义）",
              );
            }
          }
          return query(args);
        },
      },
    },
  };
}

/** 审计结果的汇总打印（测试收尾时调用）。 */
export function summarizeViolations(): string {
  if (violations.length === 0) return "租户守卫：未发现未收窄的查询 ✅";
  const byKind = new Map<string, number>();
  const byModelOp = new Map<string, number>();
  for (const v of violations) {
    byKind.set(v.kind, (byKind.get(v.kind) ?? 0) + 1);
    const k = v.model + "." + v.operation;
    byModelOp.set(k, (byModelOp.get(k) ?? 0) + 1);
  }
  const top = [...byModelOp.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15);
  return [
    "租户守卫：共 " + violations.length + " 次未收窄的查询",
    "  按类型：" + [...byKind.entries()].map(([k, n]) => k + "=" + n).join(", "),
    "  按 模型.操作 高频项：",
    ...top.map(([k, n]) => "    " + k + " × " + n),
  ].join("\n");
}

/* ------------------------------------------------------------------ */
/* 强制模式                                                            */
/* ------------------------------------------------------------------ */

type AnyClient = PrismaClient;

/**
 * 绑定租户的 Client：读/写自动带上租户条件，写操作自动补租户值。
 *
 * 为什么需要它（而不是给 42 张表铺 organisationId）：见 scope-map.ts 顶部说明 ——
 * 嵌套写入不触发钩子，铺了也没人写；关系路径是精确的且不需要人记得写。
 *
 * 未登记的模型：**抛错**（fail-closed）。要跨租户跑系统任务请用 `systemDb(reason)`。
 */
export function scopedDb(prisma: AnyClient, organisationId: string) {
  if (!organisationId) throw new Error("scopedDb: 需要 organisationId（空值会让隔离静默失效）");
  return prisma.$extends({
    name: "tenant-scope",
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }: {
          model: string; operation: string; args: Record<string, unknown>; query: (a: unknown) => Promise<unknown>;
        }) {
          const key = tenantKeyFor(model);
          if (!key) return query(args); // 共享/无租户模型，原样放行
          const next = { ...args };
          if (SCOPED_OPS.has(operation) || WRITE_BY_WHERE_OPS.has(operation)) {
            next.where = { AND: [next.where ?? {}, { [key]: organisationId }] };
          }
          if (CREATE_OPS.has(operation) || operation === "upsert") {
            const target = operation === "upsert" ? "create" : "data";
            const payload = next[target];
            next[target] = Array.isArray(payload)
              ? payload.map((d) => ({ ...(d as object), [key]: organisationId }))
              : { ...((payload ?? {}) as object), [key]: organisationId };
          }
          if (UNIQUE_ONLY_OPS.has(operation)) {
            // findUnique 的 where 写不出租户条件 —— 直接拒绝，逼调用方改成 findFirst。
            // 这条错误信息要能直接告诉人怎么改，否则下一个人只会绕过去。
            throw new Error(
              "scopedDb: " + model + ".findUnique 无法表达租户条件，请改用 findFirst({ where: { id, " +
                key + ": ... } })（或经关系收窄）",
            );
          }
          return query(next);
        },
      },
    },
  });
}
