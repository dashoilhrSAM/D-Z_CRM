/**
 * SOP 照片策略 —— 一处定义，客户端与服务端共用。
 *
 * 为什么需要这个文件（2026-09-29 容量评估实测）：
 *   生产 dz-assets/job-photos 实测 75 张照片：平均 2.65 MB、中位 2.72 MB、
 *   p90 3.31 MB、最大 4.3 MB。SOP-001 每单 5 张 → 每单约 13 MB。
 *   500 家门店（7,500 单/天）＝ 97 GB/天、12 个月 34 TB，且照片永不删除。
 *   压缩到长边 1600px 后单张约 0.3-0.4 MB（约 1/8）。
 *
 * 另一条硬约束：Vercel Functions 的**请求体上限是 4.5 MB**
 * （超出直接 413 FUNCTION_PAYLOAD_TOO_LARGE，路由处理函数根本不会执行，
 *  线上实测最大一张 4.3 MB —— 已经贴在悬崖边上）。所以：
 *   ① 客户端先压到远低于上限再上传（真正的修法）；
 *   ② 服务端护栏必须**低于** 4.5 MB —— 落在两线之间的请求才能被我们自己
 *      用一句人话拒绝，而不是被平台静默杀掉。
 *
 * 本文件必须保持零依赖：客户端组件会 import 它，引入任何服务端模块都会把
 * server-only 代码打进浏览器包（tsc 与 vitest 都看不见这类越界）。
 */

/** 长边上限（px）。1600 足够看清刮痕/里程表，也够打印。 */
export const SOP_PHOTO_MAX_EDGE = 1600;

/** JPEG 质量：0.8 是肉眼几乎无差别与体积的常见折点。 */
export const SOP_PHOTO_QUALITY = 0.8;

/** Vercel 平台的请求体硬上限（事实，不是护栏，别用它做判断）。 */
export const PLATFORM_REQUEST_BODY_LIMIT_BYTES = Math.round(4.5 * 1024 * 1024);

/** 我们自己接受的单张照片上限：必须明显低于平台上限，见文件头。 */
export const MAX_PHOTO_UPLOAD_BYTES = 4 * 1024 * 1024;

/**
 * 等比缩放到长边不超过 maxEdge；**不放大**（放大只会变大变糊）。
 * 非法输入返回 0x0，由调用方决定回退到原图。
 */
export function scaledDimensions(
  width: number,
  height: number,
  maxEdge: number = SOP_PHOTO_MAX_EDGE,
): { width: number; height: number } {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return { width: 0, height: 0 };
  }
  const longest = Math.max(width, height);
  if (longest <= maxEdge) return { width: Math.round(width), height: Math.round(height) };
  const scale = maxEdge / longest;
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

/** 服务端拒绝时的人话（带真实体积，便于技师自己判断要不要重拍）。 */
export function oversizePhotoMessage(bytes: number): string {
  const mb = (bytes / 1024 / 1024).toFixed(1);
  return "Photo too large (" + mb + " MB). Max " + MAX_PHOTO_UPLOAD_BYTES / 1024 / 1024 + " MB.";
}
