import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireStaff } from "@/lib/api-auth";
import { can } from "@/lib/auth/permissions";
import { scopedBranchId } from "@/lib/branch-scope";
import { safeTimezone } from "@/lib/business-day";
import { resolveRange } from "@/modules/attendance/range";
import { loadAttendanceReport } from "@/modules/attendance/report";

export const dynamic = "force-dynamic";

/**
 * 考勤 CSV 导出（HRM P2）—— 给财务算工资用的**按人按天**明细。
 *
 * 为什么单独一条路由而不是 Server Action：下载要的是浏览器原生的文件下载，
 * 走 fetch + Blob 反而要在客户端里再拼一次字符串（两处格式必然漂移）。
 *
 * 门禁有三层，缺一不可：
 *  1. requireStaff()——默认「必须登录且必须是员工」（骑手不算 staff）；
 *  2. ATTENDANCE:export——导出等于把全体员工的行踪带走，和"能看"不是一回事；
 *  3. 分行作用域——分行级角色只能导出本店，org 级才导全部。
 */
export async function GET(req: NextRequest) {
  const auth = await requireStaff();
  if ("response" in auth) return auth.response;
  const session = auth.session;
  // 角色/组织取会话顶层字段：session.user 是 User | Customer 的联合类型
  const scope = { id: session.user?.id ?? "", role: session.role as never, organisationId: session.orgId };

  if (!(await can(scope, "ATTENDANCE", "export"))) {
    return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  }

  const org = await db.organisation.findFirst();
  if (!org) return NextResponse.json({ ok: false, error: "No organisation" }, { status: 500 });

  const sp = req.nextUrl.searchParams;
  // **没有 preset 但给了区间 = custom。**
  //
  // 这一行修的是一个真实缺陷（2026-09-17 在生产上实测到）：页面的「导出 CSV」链接只带
  // from/to（见 attendance-range-picker 的 exportHref），而 resolveRange 的 preset 缺省是
  // "today"，**"today" 会忽略 from/to** —— 于是「导出本月」静默变成「导出今天」：
  // 前端选 2026-09 导出只拿到一行占位 "(no records in range)"，而同一页的 KPI 写着 2 人天。
  // 一个只给起止日期的入口，就该按起止日期取数。
  const preset = sp.get("preset") ?? (sp.get("from") || sp.get("to") ? "custom" : null);
  const range = resolveRange({
    preset,
    from: sp.get("from"),
    to: sp.get("to"),
    timezone: safeTimezone(org.timezone),
  });

  const report = await loadAttendanceReport(
    { organisationId: org.id, branchId: scopedBranchId({ role: session.role, branchId: session.branchId }) },
    range,
  );

  // 时间按**组织时区**渲染，不用服务器时区：本地 +8 与生产 Vercel UTC 会差 8 小时，
  // 同一份工资表在两处跑出不同的上班时间是不能接受的。
  const tz = safeTimezone(org.timezone);
  const hhmm = new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hour12: false });
  const at = (iso: string | null) => (iso ? hhmm.format(new Date(iso)) : "");

  const header = ["staff", "role", "branch", "date", "first_in", "last_out", "worked_minutes", "worked", "exceptions", "pending"];
  const lines = [header.join(",")];
  for (const s of report.staff) {
    for (const d of s.days) {
      lines.push(
        [
          s.name,
          s.role,
          s.branchName ?? "",
          d.dateKey,
          at(d.firstInAt),
          at(d.lastOutAt),
          String(d.workedMinutes),
          fmtMinutes(d.workedMinutes),
          String(d.exceptionCount),
          String(d.pendingCount),
        ].map(cell).join(","),
      );
    }
  }
  if (lines.length === 1) {
    // 区间内一条记录都没有：别给一个只有表头的空文件让人以为导出坏了
    lines.push([t_empty(), "", "", "", "", "", "0", "0m", "0", "0"].map(cell).join(","));
  }

  const filename = "attendance-" + range.fromKey + "_" + range.toKey + ".csv";
  return new NextResponse("\uFEFF" + lines.join("\r\n") + "\r\n", {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'attachment; filename="' + filename + '"',
      // 报表里有姓名与行踪，不能进任何中间缓存
      "Cache-Control": "private, no-store",
    },
  });
}

/** 空区间的占位行：让"没人打卡"与"导出坏了"看起来不一样。 */
function t_empty(): string {
  return "(no records in range)";
}

/** 分钟 → "7h 30m"（与界面同一口径，避免报表与 CSV 两处措辞漂移）。 */
function fmtMinutes(minutes: number): string {
  const m = Math.max(0, Math.round(minutes));
  const h = Math.floor(m / 60);
  const rest = m % 60;
  if (h === 0) return rest + "m";
  if (rest === 0) return h + "h";
  return h + "h " + rest + "m";
}

/** CSV 单元格：逗号/引号/换行都要包起来，否则名字里带逗号就能把整张表错位。 */
function cell(v: string): string {
  return /[",\r\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
}
