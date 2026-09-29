#!/usr/bin/env node
/**
 * capacity-model.mjs — D&Z CRM 容量模型（100/300/500 dealers）
 *
 * 用法：node scripts/perf/capacity-model.mjs [jobsPerDealerPerDay]
 *
 * 目的：把「每 dealer 每月的 Vercel / Supabase 成本与负载」算出来，而不是靠感觉。
 * 报告：docs/CAPACITY_AND_UPGRADE_PLAN.md（本脚本产出的数字即是那份报告的表）。
 *
 * 关键假设全部集中在 ASSUMPTIONS，改这里即可重算；输入依据写在行内注释里。
 */
const TIERS = [
  { name: 'T1', dealers: 100, mech: 500, ws: 200 },
  { name: 'T2', dealers: 300, mech: 1500, ws: 600 },
  { name: 'T3', dealers: 500, mech: 2500, ws: 1000 },
];

const ASSUMPTIONS = {
  jobsPerDealerDay: 15,      // 5 机修 x 3 单/天
  photoMB: 2.65,             // 生产实测 75 张：avg 2.65MB / p90 3.31 / max 4.3
  photosPerJob: 5,           // SOP-001
  punchKB: 120,              // 考勤自拍已压缩到 720px q0.85
  punchesPerStaffDay: 2,
  refreshSec: 30,            // refresh-controls.tsx:11 AUTO_REFRESH_MS
  wsHrsOpen: 6, mechHrsOpen: 6,
  wsBoardShare: 0.5, mechBoardShare: 0.3,   // 多少比例的员工整天开着看板
  wsViewsDay: 80, mechViewsDay: 50,
  riderViewsSession: 8, riderShareOfCustomers: 0.2,
  customersPerDealer: 300,
  actionsPerView: 0.25,
  qRender: 6, qAction: 12, qApi: 3,          // 每次渲染 6 条 SQL（无 unstable_cache）
  cpuRenderMs: 40, cpuActionMs: 80,          // 实测校准位
  wallRenderS: 0.45, wallActionS: 0.8,
  memGB: 2,                                  // Fluid compute 默认 2GB/1vCPU
  rscKB: 80, assetsPerSession: 20, sessionsDomShare: 0.6,
};

const RATES = {
  sin1: { cpu: 0.16, mem: 0.0133, cdn: 2.60, transfer: 0.16 },
  iad1: { cpu: 0.128, mem: 0.0106, cdn: 2.00, transfer: 0.15 },
};
const STORAGE_PER_GB_MO = 0.0213;
const EGRESS_CACHED = 0.03;

const M = 1e6, GB = 1e9, K = 1e3;
const f = (n, d = 0) => Number(n).toLocaleString('en-US', { maximumFractionDigits: d });

function model(tier, p) {
  const jobs = tier.dealers * p.jobsPerDealerDay;
  const customers = tier.dealers * p.customersPerDealer;
  const riders = Math.round(customers * p.riderShareOfCustomers);
  const refreshPerWs = Math.round(3600 / p.refreshSec * p.wsHrsOpen);
  const refreshPerMech = Math.round(3600 / p.refreshSec * p.mechHrsOpen);
  const boardWs = tier.ws * p.wsBoardShare * refreshPerWs;
  const boardMech = tier.mech * p.mechBoardShare * refreshPerMech;
  const vWs = tier.ws * p.wsViewsDay, vMech = tier.mech * p.mechViewsDay, vRider = riders * p.riderViewsSession;
  const renders = boardWs + boardMech + vWs + vMech + vRider;
  const actions = (vWs + vMech + vRider) * p.actionsPerView;
  const photoUploads = jobs * p.photosPerJob, apiCalls = jobs * 2;
  const invocations = renders + actions + photoUploads + apiCalls;
  const queries = renders * p.qRender + actions * p.qAction + apiCalls * p.qApi;
  const authCalls = renders * 2 + actions * 1.5;             // middleware + getSessionUser
  const sessions = Math.round((tier.ws + tier.mech) * p.sessionsDomShare) + riders;
  const cdnReqs = invocations + sessions * p.assetsPerSession;
  const transferGB = (renders * p.rscKB * K + actions * 40 * K) / GB;
  const cpuHours = (renders * p.cpuRenderMs + actions * p.cpuActionMs) / 1000 / 3600;
  const memGBhr = (renders * p.wallRenderS + actions * p.wallActionS) * p.memGB / 3600;
  const photoGBday = jobs * p.photosPerJob * p.photoMB / 1024;
  const egressGBday = jobs * 2 * p.photosPerJob * p.photoMB / 1024;   // 拍一次 + 看一次
  const qpsBiz = queries / (10 * 3600);
  return { jobs, renders, boardShare: (boardWs + boardMech) / renders, invocations, queries, authCalls,
    cdnReqs, transferGB, cpuHours, memGBhr, photoGBday, egressGBday, photoUp: photoUploads,
    qpsBiz, peakQps: qpsBiz * 1.5 };
}

const vercel = (r, R) => {
  const cpu = r.cpuHours * 30 * R.cpu, mem = r.memGBhr * 30 * R.mem;
  const cdn = r.cdnReqs * 30 / M * R.cdn, tr = r.transferGB * 30 * R.transfer;
  return { cpu, mem, cdn, tr, total: cpu + mem + cdn + tr };
};

const jobsArg = Number(process.argv[2]);
const P = Object.assign({}, ASSUMPTIONS, jobsArg ? { jobsPerDealerDay: jobsArg } : {});

console.log('=== D&Z capacity model · jobs/dealer/day = ' + P.jobsPerDealerDay + ' · photo ' + P.photoMB + 'MB x ' + P.photosPerJob + ' ===\n');
console.log('Tier | jobs/day | renders/day | auto-refresh share | invocations/day | SQL/day | Auth/day | peakQPS');
for (const t of TIERS) {
  const r = model(t, P);
  console.log([t.name, f(r.jobs), f(r.renders), Math.round(r.boardShare * 100) + '%', f(r.invocations), f(r.queries), f(r.authCalls), '~' + f(r.peakQps)].join(' | '));
}
console.log('\nTier | Vercel(sin1) | Vercel(iad1) | photos GB/day | photos TB/12mo | storage $/mo@12mo | egress $/mo(cached)');
for (const t of TIERS) {
  const r = model(t, P);
  const vs = vercel(r, RATES.sin1), vi = vercel(r, RATES.iad1);
  const tb12 = r.photoGBday * 30 * 12 / 1024;
  console.log([t.name, '$' + f(vs.total), '$' + f(vi.total), f(r.photoGBday, 1), f(tb12, 1),
    '$' + f(r.photoGBday * 30 * 12 * STORAGE_PER_GB_MO), '$' + f(r.egressGBday * 30 * EGRESS_CACHED)].join(' | '));
}
console.log('\n=== 修复后（刷新 120s + 照片压到 0.35MB）===');
const FIXED = Object.assign({}, P, { refreshSec: 120, photoMB: 0.35 });
for (const t of TIERS) {
  const a = model(t, P), b = model(t, FIXED);
  const va = vercel(a, RATES.sin1), vb = vercel(b, RATES.sin1);
  console.log([t.name, 'inv ' + f(a.invocations) + ' -> ' + f(b.invocations),
    'Vercel $' + f(va.total) + ' -> $' + f(vb.total) + ' (-' + Math.round((1 - vb.total / va.total) * 100) + '%)',
    'photo GB/day ' + f(a.photoGBday, 1) + ' -> ' + f(b.photoGBday, 1) + ' (-' + Math.round((1 - b.photoGBday / a.photoGBday) * 100) + '%)'].join(' | '));
}
console.log('\n=== DB 增长（40 行/单，含索引约 250B/行）===');
for (const t of TIERS) {
  const rowsMo = t.dealers * P.jobsPerDealerDay * 40 * 30;
  console.log(t.name + ' | rows/day ' + f(t.dealers * P.jobsPerDealerDay * 40) + ' | rows/3yr ' + f(rowsMo * 36 / M) + 'M | db ~' + f(rowsMo * 36 * 250 / GB, 1) + 'GB');
}
