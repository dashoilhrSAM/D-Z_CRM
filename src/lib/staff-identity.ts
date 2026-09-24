/**
 * 员工身份：邮箱归一化 + 同邮箱多行的判定。
 *
 * 起因（生产实测）：同一个邮箱出现了两条 User 行 ——
 * provision 脚本的「按 email 幂等」用的是**大小写敏感**的精确匹配，
 * 库里是 MechanicDemo@gmail.com、脚本里写 mechanicdemo@gmail.com → 查不到 → 又建一行 ✗。
 * 结果同一个技师的两张工单被拆到两个身份上，登录后只看得到其中一张。
 *
 * 两条防复发措施：
 *   1. 邮箱一律**小写存储**（归一化只在写入时做一次）；
 *   2. 查人要**忽略大小写**（老数据里已经有大写，不能只靠小写匹配）。
 */

export function normalizeEmail(email: string | null | undefined): string | null {
  const trimmed = (email ?? "").trim().toLowerCase();
  return trimmed.length > 0 ? trimmed : null;
}

export interface IdentityRow {
  id: string;
  email: string | null;
  authId: string | null;
  active?: boolean;
  createdAt?: Date | string | null;
}

/** 同一邮箱的两行以上归为一组（忽略大小写、忽略空邮箱） */
export function groupDuplicates<T extends IdentityRow>(rows: T[]): { email: string; rows: T[] }[] {
  const by = new Map<string, T[]>();
  for (const r of rows) {
    const key = normalizeEmail(r.email);
    if (!key) continue;
    by.set(key, [...(by.get(key) ?? []), r]);
  }
  return [...by.entries()]
    .filter(([, group]) => group.length > 1)
    .map(([email, group]) => ({ email, rows: group }));
}

/**
 * 保留哪一行：**优先留着已经绑定登录（authId）的那一行** ——
 * 它是大家实际登录进来的身份；其次留 active，最后留最早创建的那一行。
 * 其余的行是「幽灵行」，把它们的关联数据挪过来后删掉。
 */
export function pickCanonicalRow<T extends IdentityRow>(rows: T[]): T {
  const scored = [...rows].sort((a, b) => {
    const auth = (r: IdentityRow) => (r.authId ? 0 : 1);
    if (auth(a) !== auth(b)) return auth(a) - auth(b);
    const act = (r: IdentityRow) => (r.active === false ? 1 : 0);
    if (act(a) !== act(b)) return act(a) - act(b);
    const ta = a.createdAt ? new Date(a.createdAt).getTime() : Number.MAX_SAFE_INTEGER;
    const tb = b.createdAt ? new Date(b.createdAt).getTime() : Number.MAX_SAFE_INTEGER;
    return ta - tb;
  });
  return scored[0];
}
