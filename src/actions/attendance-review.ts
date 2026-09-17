"use server";
import { revalidatePath } from "next/cache";
import { getSessionUser } from "@/lib/session-user";
import { can, isHeadOfficeRole } from "@/lib/auth/permissions";
import { reviewPunch } from "@/modules/attendance/report";

/**
 * 异常打卡的处置（HRM P2）。
 *
 * 为什么这个文件不叫 src/actions/attendance.ts：那个路径被源码守卫钉成「必须不存在」
 * （旧实现用 upsert 写当天行、重复打卡会把早上那次覆盖掉，见 tests/attendance.test.ts）。
 * 与其放宽守卫，不如换个名字——一个禁止回归的断言比文件名的整齐重要。
 *
 * 权限：ATTENDANCE:edit（矩阵里 OWNER / MANAGER / SALES_MANAGER / SERVICE_MANAGER 有，
 * 柜台与技师没有）。**动作层必须自己校验**——页面门禁只管「能不能看这个模块」，
 * 不管「这个人能不能改这一行」。
 */
export interface ReviewActionResult {
  ok: boolean;
  /** 失败码：界面据此显示人话（不直接透传服务端英文，也不吞掉原因） */
  code?: string;
}

const FAIL_CODES = ["NOT_FOUND", "OUT_OF_SCOPE", "NOT_AN_EXCEPTION", "BAD_DECISION", "NOTE_TOO_LONG"] as const;

export async function reviewAttendancePunch(input: {
  punchId: string;
  decision: string;
  note?: string | null;
}): Promise<ReviewActionResult> {
  const session = await getSessionUser();
  if (session.kind !== "staff" || !session.user) return { ok: false, code: "UNAUTHORIZED" };

  // 角色/组织/分行都取会话顶层的字段：session.user 是 User | Customer 的联合类型，
  // 在上面取 .role 既过不了类型检查，也容易把 rider 当成员工。
  const allowed = await can(
    { id: session.user.id, role: session.role as never, organisationId: session.orgId },
    "ATTENDANCE",
    "edit",
  );
  if (!allowed) return { ok: false, code: "FORBIDDEN" };

  const res = await reviewPunch({
    actor: {
      id: session.user.id,
      organisationId: session.orgId,
      branchId: session.branchId ?? null,
      isOrgLevel: isHeadOfficeRole(session.role),
    },
    punchId: String(input.punchId ?? ""),
    decision: String(input.decision ?? ""),
    note: input.note ?? null,
  });

  if (!res.ok) {
    const code = (FAIL_CODES as readonly string[]).includes(res.code) ? res.code : "UNKNOWN";
    return { ok: false, code };
  }

  revalidatePath("/workshop/attendance");
  return { ok: true };
}
