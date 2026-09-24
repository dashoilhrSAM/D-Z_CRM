import { describe, expect, it } from "vitest";

describe("员工身份：邮箱归一化与重复判定（生产事故：同邮箱两条 User 行）", () => {
  it("归一化：去空格 + 小写；空值一律 null", async () => {
    const { normalizeEmail } = await import("@/lib/staff-identity");
    expect(normalizeEmail("  MechanicDemo@Gmail.com ")).toBe("mechanicdemo@gmail.com");
    expect(normalizeEmail("")).toBeNull();
    expect(normalizeEmail(null)).toBeNull();
    expect(normalizeEmail(undefined)).toBeNull();
  });

  it("**大小写不同也算同一个邮箱**（这正是事故的成因）", async () => {
    const { groupDuplicates } = await import("@/lib/staff-identity");
    const rows = [
      { id: "a", email: "MechanicDemo@gmail.com", authId: null },
      { id: "b", email: "mechanicdemo@gmail.com", authId: "auth-1" },
      { id: "c", email: "other@dz.my", authId: null },
      { id: "d", email: null, authId: null },
      { id: "e", email: null, authId: null },
    ];
    const groups = groupDuplicates(rows);
    expect(groups.length, "只有一组重复（空邮箱不算）").toBe(1);
    expect(groups[0].email).toBe("mechanicdemo@gmail.com");
    expect(groups[0].rows.map((r) => r.id).sort()).toEqual(["a", "b"]);
  });

  it("**保留已绑定登录的那一行**（那是大家真正登录进来的身份）", async () => {
    const { pickCanonicalRow } = await import("@/lib/staff-identity");
    const ghost = { id: "ghost", email: "MechanicDemo@gmail.com", authId: null, createdAt: "2026-01-01" };
    const bound = { id: "bound", email: "mechanicdemo@gmail.com", authId: "auth-1", createdAt: "2026-06-01" };
    expect(pickCanonicalRow([ghost, bound]).id, "有 authId 的优先，哪怕它更晚创建").toBe("bound");
    expect(pickCanonicalRow([bound, ghost]).id).toBe("bound");
  });

  it("两个都没绑定时：留 active 的，再不行留最早创建的", async () => {
    const { pickCanonicalRow } = await import("@/lib/staff-identity");
    const off = { id: "off", email: "x@dz.my", authId: null, active: false, createdAt: "2026-01-01" };
    const on = { id: "on", email: "x@dz.my", authId: null, active: true, createdAt: "2026-02-01" };
    expect(pickCanonicalRow([off, on]).id).toBe("on");
    const older = { id: "older", email: "x@dz.my", authId: null, active: true, createdAt: "2025-01-01" };
    expect(pickCanonicalRow([on, older]).id).toBe("older");
  });
});
