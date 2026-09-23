// The schema sync script is the thing standing between a schema change and another
// site-wide outage, so its schema parser and DDL generator are covered here.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { parseSchema, ddlFor, resolveUrl, isTransactionPooler, sessionPoolerUrl } from "../scripts/sync-prod-schema.mjs";

const schemaSrc = readFileSync(path.join(process.cwd(), "prisma/schema.pg.prisma"), "utf8");
const models = parseSchema(schemaSrc) as Record<string, { column: string; type: string; optional: boolean; ddlDefault: string | null }[]>;

describe("parseSchema", () => {
  it("finds the real models", () => {
    expect(Object.keys(models)).toContain("Campaign");
    expect(Object.keys(models)).toContain("Booking");
    expect(Object.keys(models)).toContain("Organisation");
  });

  it("maps Prisma scalars to postgres types", () => {
    expect(models.Campaign.find((f) => f.column === "audienceRules")).toMatchObject({ type: "JSONB", optional: true });
    expect(models.Campaign.find((f) => f.column === "pointsBonus")).toMatchObject({ type: "INTEGER", optional: true });
    expect(models.Booking.find((f) => f.column === "promoDiscountSen")).toMatchObject({ type: "INTEGER", optional: false, ddlDefault: "0" });
    expect(models.Booking.find((f) => f.column === "promoSnapshot")).toMatchObject({ type: "JSONB", optional: true });
    expect(models.Organisation.find((f) => f.column === "promoAutoApply")).toMatchObject({ type: "BOOLEAN", optional: false, ddlDefault: "true" });
  });

  it("skips relation fields and lists (they are not columns)", () => {
    expect(models.Booking.some((f) => f.column === "branch")).toBe(false);
    expect(models.Campaign.some((f) => f.column === "bookings")).toBe(false);
  });

  it("skips @ignore fields so an unmanaged production-only column is never dropped", () => {
    // Organisation.qrEnabled exists only in the production database. It is marked
    // @ignore precisely so the sync never emits a DROP for it.
    expect(models.Organisation.some((f) => f.column === "qrEnabled")).toBe(false);
  });
});

describe("ddlFor", () => {
  it("generates the exact additive DDL for the columns that broke production", () => {
    const { stmts } = ddlFor([
      "Campaign.audienceRules", "Campaign.pointsBonus", "Booking.promoDiscountSen",
      "Booking.promoSnapshot", "Lead.campaignId", "Organisation.promoAutoApply",
    ], models);
    expect(stmts).toContain('ALTER TABLE "Organisation" ADD COLUMN IF NOT EXISTS "promoAutoApply" BOOLEAN NOT NULL DEFAULT true;');
    expect(stmts).toContain('ALTER TABLE "Booking" ADD COLUMN IF NOT EXISTS "promoDiscountSen" INTEGER NOT NULL DEFAULT 0;');
    expect(stmts).toContain('ALTER TABLE "Campaign" ADD COLUMN IF NOT EXISTS "audienceRules" JSONB;');
    expect(stmts.every((s: string) => s.includes("IF NOT EXISTS"))).toBe(true);
  });

  it("flags a required column with no default for backfill instead of inventing one", () => {
    const { stmts, notes } = ddlFor(["ServiceJob.mileage"], models);
    expect(stmts[0]).not.toContain("NOT NULL");
    expect(notes.join(" ")).toContain("backfill");
  });
});

/**
 * The build hung for 45 minutes on a database call that never returned, twice, on a
 * project whose builds normally take 90 seconds. These cover the two decisions that stop
 * it happening again: which url migrations are given, and whether a hang is even
 * possible.
 */
/**
 * 2026-09-23：DATABASE_URL 是 Supavisor 的**事务池**时，migrate 命令会挂到 120s 超时，
 * 连续三次把生产构建弄红。会话端点与它同主机、同用户、同密码、同库，只有端口不同，
 * 所以脚本现在自己推导一次。下面钉住这个推导：**改对了要能推导出来，不该推导的要老实返回 null**
 * （后者同样重要 —— 对自建 pgbouncer 或非 Supavisor 主机瞎猜端口，只会换来又一次超时）。
 */
describe("sessionPoolerUrl", () => {
  it("把 Supavisor 事务池改成会话端点（端口 6543 → 5432，其余原样）", () => {
    const pooled = "postgresql://postgres.abcdefghij:p%40ss@aws-0-ap-southeast-1.pooler.supabase.com:6543/postgres?pgbouncer=true";
    expect(sessionPoolerUrl(pooled)).toBe(
      "postgresql://postgres.abcdefghij:p%40ss@aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres",
    );
  });

  it("**带密码**的 URL 必须认得出来（自己的正则曾写死 @，于是带密码的全部漏掉）", () => {
    const withPassword = "postgresql://postgres.abcdefghij:secret@aws-0-ap-southeast-1.pooler.supabase.com:6543/postgres";
    expect(sessionPoolerUrl(withPassword)).toBe(
      "postgresql://postgres.abcdefghij:secret@aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres",
    );
  });

  it("密码里的 % 原样保留，不做任何重新编码（二次编码会造成 P1000「密码错」的假象）", () => {
    const pooled = "postgresql://postgres.abcdefghij:a%2Fb%25c@aws-0-ap-southeast-1.pooler.supabase.com:6543/postgres";
    expect(sessionPoolerUrl(pooled)).toContain(":a%2Fb%25c@");
  });

  it("已经是会话端点（5432）的 URL 不做任何事", () => {
    const session = "postgresql://postgres.abcdefghij:pw@aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres";
    expect(sessionPoolerUrl(session)).toBeNull();
  });

  it("非 Supavisor 主机返回 null（自建 pgbouncer 的 5432 未必是会话池，不能瞎猜）", () => {
    expect(sessionPoolerUrl("postgresql://u:p@my-pgbouncer.internal:6543/db?pgbouncer=true")).toBeNull();
  });

  it("用户名里没有 project ref 返回 null（Supavisor 的租户写在用户名里，缺了就无法定位）", () => {
    expect(sessionPoolerUrl("postgresql://postgres:pw@aws-0-ap-southeast-1.pooler.supabase.com:6543/postgres")).toBeNull();
  });
});

describe("resolveUrl", () => {
  it("prefers an explicit diagnostic url above everything", () => {
    expect(resolveUrl({ DRIFT_CHECK_URL: "postgres://x", DIRECT_URL: "postgres://y", DATABASE_URL: "postgres://z" }))
      .toEqual({ url: "postgres://x", source: "DRIFT_CHECK_URL" });
  });

  it("prefers the direct url over the pooled one, which is the whole point", () => {
    // Prisma migrate commands need a real session and will hang on a pooler.
    expect(resolveUrl({ DIRECT_URL: "postgres://direct", DATABASE_URL: "postgres://pooled" }))
      .toEqual({ url: "postgres://direct", source: "DIRECT_URL" });
  });

  it("falls back to DATABASE_URL when no direct url is configured", () => {
    expect(resolveUrl({ DATABASE_URL: "postgres://only" })).toEqual({ url: "postgres://only", source: "DATABASE_URL" });
  });

  it("skips a local sqlite build entirely, so a dev machine can never reach production", () => {
    expect(resolveUrl({ DATABASE_URL: "file:./dev.db" }).url).toBe("");
    expect(resolveUrl({}).url).toBe("");
  });
});

describe("isTransactionPooler", () => {
  it("recognises the shapes that make migrate hang", () => {
    expect(isTransactionPooler("postgresql://u:p@db.x.supabase.co:6543/postgres")).toBe(true);
    expect(isTransactionPooler("postgresql://u:p@db.x.supabase.co:5432/postgres?pgbouncer=true")).toBe(true);
  });

  it("does NOT flag the Supavisor session pooler — it is the only address that works from Vercel", () => {
    // 旧实现把 pooler.supabase.com 一概判为 pooled，于是警告"请改用直连地址"。
    // 2026-09-17 实测：直连主机只有 AAAA（IPv6-only），Vercel 构建只有 IPv4 → 连不上；
    // 而这条会话池地址 migrate diff exit=0、CREATE/DROP 探针都成功。
    // 把人从唯一能用的地址劝走，比不警告更糟。
    expect(isTransactionPooler("postgresql://u:p@aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres")).toBe(false);
  });

  it("leaves a direct connection alone", () => {
    expect(isTransactionPooler("postgresql://u:p@db.dukbfgqbrprivnzcsrlh.supabase.co:5432/postgres")).toBe(false);
  });
});

