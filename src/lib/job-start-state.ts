/**
 * 机修「接单 / 开工」按钮的状态判定。
 *
 * 起因（老板反馈）：点 accept order → 其实被两道门禁挡住（SOP-001 要拍齐 5 张照片、
 * QUOT-001 报价要客户确认），失败又被弹去拍照页；退出来后工单还是 WAITING，
 * 卡片**又一次显示 Accept order** —— 看起来像「接了但没接上」。
 *
 * 这个纯函数把「为什么现在还不能开工」说清楚，卡片照着显示：
 * 该拍照就显示还差几张，该等报价就明说等报价，两道都过了才是真正的 Accept order。
 * 抽成纯函数是为了能测 —— 这类「按钮点了没反应」的 bug 只有把规则写出来才防得住。
 */

export const REQUIRED_PHOTOS = 5;

export type JobStartState = "not-waiting" | "needs-photos" | "needs-quotation" | "ready";

export interface JobStartInput {
  status: string;
  /** 已拍的照片张数 */
  photoCount: number;
  /** 报价是否已确认；null＝这张工单没有报价要求（不受限） */
  quotationApproved: boolean | null;
}

export function jobStartState(input: JobStartInput): JobStartState {
  if (input.status !== "WAITING") return "not-waiting";
  // 先拍照后报价：照片是技师自己能做的，先告诉他差几张
  if (input.photoCount < REQUIRED_PHOTOS) return "needs-photos";
  if (input.quotationApproved === false) return "needs-quotation";
  return "ready";
}
