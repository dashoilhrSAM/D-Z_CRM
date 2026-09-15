// D&Z constants.
//
// 2026-09-15 删掉了 ORG_NAME 与 BRANCHES：两者**零引用**（唯一的 "BRANCHES" 命中是权限矩阵里
// 同名的模块），而 BRANCHES 还宣称有三家门店在 Kuala Lumpur / Shah Alam / Johor Bahru——
// 与真实情况不符（主店在 Petaling Jaya）。真的分行在 DB 的 Branch 表里，
// 种子数据在 src/lib/seed-core.ts（那里带着主店真实地址）。

/** Standard service interval used for deterministic next-service prediction. */
export const DEFAULT_SERVICE_INTERVAL_KM = 3000;
/** Rough average riding pace used to estimate the next-service date. */
export const AVG_KM_PER_MONTH = 1000;

export const JOB_STATUS_ORDER = ["WAITING", "IN_PROGRESS", "AWAITING_APPROVAL", "READY", "COMPLETED", "CANCELLED"] as const;

export const BOOKING_STATUS_ORDER = ["REQUESTED", "CONFIRMED", "RESCHEDULED", "CHECKED_IN", "COMPLETED", "CANCELLED"] as const;
