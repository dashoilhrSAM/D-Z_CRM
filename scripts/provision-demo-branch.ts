/* eslint-disable no-console */
// D&Z — 开通 demo/testing 分行（严格隔离版）
// 用法：node --env-file=.env node_modules/.bin/tsx scripts/provision-demo-branch.ts
// 幂等：branch 按名称查重；staff 按 email 查重；auth 账号邮箱已存在则复用。
// 只建一间 testing 分行：按名称唯一（DEMO_BRANCH_NAME）守卫。
// 生产环境默认拒绝（与 seed 一致），除非 PROVISION_ALLOWED=1。
import { PrismaClient } from "@prisma/client";
import { createClient } from "@supabase/supabase-js";

if (process.env.NODE_ENV === "production" && process.env.PROVISION_ALLOWED !== "1") {
  console.error("Refusing to provision in production (NODE_ENV=production). Set PROVISION_ALLOWED=1 to override.");
  process.exit(1);
}

const prisma = new PrismaClient();

const DEMO_BRANCH_NAME = process.env.DEMO_BRANCH_NAME ?? "D&Z Testing Branch";
const DEMO_CITY = process.env.DEMO_BRANCH_CITY ?? "Subang Jaya";
const SLOT_TIMES = ["09:00", "11:00", "14:00", "16:00"];
const SLOT_DAYS = Number(process.env.SLOT_DAYS ?? 7);
const MAX_BOOKINGS = Number(process.env.MAX_BOOKINGS ?? 2);

/** 测试分行员工清单（可随时改；email+password 生成登录账号，均挂在 testing branch）。
 * 注意（严格隔离）：ORG_LEVEL 角色 = SUPER_ADMIN / OWNER / HEAD_OFFICE_ADMIN —— 它们看全部份。
 * 因此隔离的 testing 分行只用 branch 级角色（MANAGER/COUNTER_STAFF/SERVICE_MANAGER/MECHANIC/...），
 * 不要给 testing 分行配 OWNER，否则该账号会看到全 org 数据。 */
const STAFF = [
  { name: "Testing Manager", role: "MANAGER", email: "test.manager@dz.my", password: "Dashoil@!789" },
  { name: "Testing Counter", role: "COUNTER_STAFF", email: "test.counter@dz.my", password: "Dashoil@!789" },
  { name: "Testing Service Mgr", role: "SERVICE_MANAGER", email: "test.servicemgr@dz.my", password: "Dashoil@!789" },
  { name: "Testing Mechanic 1", role: "MECHANIC", email: "test.mech1@dz.my", password: "Dashoil@!789" },
  { name: "Testing Mechanic 2", role: "MECHANIC", email: "test.mech2@dz.my", password: "Dashoil@!789" },
];

/** 确保 Supabase auth 账号存在，返回 authId（已存在则复用）。 */
async function ensureAuthUser(supabase: any, email: string, password: string, name: string): Promise<string | null> {
  const { data, error } = await supabase.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { name } });
  if (!error && data?.user) return data.user.id;
  // 邮箱已注册 → 找回已有 auth id，实现幂等
  try {
    const { data: ld } = await supabase.auth.admin.listUsers();
    const found = ld?.users?.find((u: { email?: string }) => u.email?.toLowerCase() === email.toLowerCase());
    if (found) return found.id;
  } catch { /* ignore */ }
  console.warn("  " + email + ": auth unavailable (" + (error?.message ?? "unknown") + ")");
  return null;
}

async function main() {
  const org = await prisma.organisation.findFirst();
  if (!org) throw new Error("No organisation found — seed the database first.");

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );

  // 1) Branch（按名称唯一，保证仅一间 testing 分行）
  let branch = await prisma.branch.findFirst({ where: { organisationId: org.id, name: DEMO_BRANCH_NAME } });
  let createdBranch = false;
  if (!branch) {
    branch = await prisma.branch.create({
      data: {
        organisationId: org.id,
        name: DEMO_BRANCH_NAME,
        city: DEMO_CITY,
        phone: "03-1234 5678",
        address: "Lot 123, Jalan Test, " + DEMO_CITY,
        isMain: false,
        operatingHours: JSON.stringify({ mon: "09:00-19:00", tue: "09:00-19:00", wed: "09:00-19:00", thu: "09:00-19:00", fri: "09:00-19:00", sat: "09:00-18:00", sun: "Closed" }),
        appointmentCapacity: MAX_BOOKINGS,
      },
    });
    createdBranch = true;
  }
  console.log("[branch] " + (createdBranch ? "CREATED" : "EXISTS") + " · " + branch.name + " (" + branch.id + ")");

  // 2) Appointment slots（幂等：唯一键 [branchId,date,startTime]）
  let slotCount = 0;
  for (let d = 0; d < SLOT_DAYS; d++) {
    const date = new Date(Date.now() + d * 86400000);
    date.setUTCHours(0, 0, 0, 0);
    for (const startTime of SLOT_TIMES) {
      const exists = await prisma.appointmentSlot.findUnique({ where: { branchId_date_startTime: { branchId: branch.id, date, startTime } } });
      if (!exists) {
        await prisma.appointmentSlot.create({ data: { branchId: branch.id, date, startTime, maxBookings: MAX_BOOKINGS } });
        slotCount++;
      }
    }
  }
  console.log("[slots] created " + slotCount + " (existing skipped)");

  // 3) Staff（按 email 幂等；auth 账号复用）
  const report: string[] = [];
  for (const s of STAFF) {
    let user = await prisma.user.findFirst({ where: { organisationId: org.id, email: s.email } });
    if (user) { report.push(s.email + " (exists)"); continue; }
    const authId = await ensureAuthUser(supabase, s.email, s.password, s.name);
    user = await prisma.user.create({
      data: { organisationId: org.id, branchId: branch.id, name: s.name, role: s.role as never, email: s.email, active: true, authId },
    });
    report.push(s.email + " (created, branch=" + (user.branchId === branch.id ? "testing" : "?") + ", auth=" + (authId ? "yes" : "no") + ")");
  }
  console.log("[staff] " + report.join(" · "));
  console.log("DONE · testing branch: " + branch.id);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());