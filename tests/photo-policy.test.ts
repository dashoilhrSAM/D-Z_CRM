// SOP 照片策略：压缩目标 + 护栏取值 + 「守卫还在不在」的结构断言。
//
// 为什么有这些测试（2026-09-29 容量评估）：
//   生产实测 75 张照片平均 2.65 MB，SOP 每单 5 张；而 Vercel 的请求体上限是
//   4.5 MB —— 线上实测最大一张已经 4.3 MB。也就是说「照片太大」不是将来的风险，
//   是已经贴在悬崖边上：超限的请求会被平台以 413 拒掉，**路由处理函数根本不执行**，
//   技师看到的是一句和大小毫无关系的报错。
//
// 三条断言各自能失败：
//   ① 缩放数学错了 → 尺寸断言红；
//   ② 有人把护栏提到平台上限之上 → 不变量断言红（这是我们唯一能自己发现的方式）；
//   ③ 有人把压缩从上传路径里删掉 → 结构断言红。
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  MAX_PHOTO_UPLOAD_BYTES,
  PLATFORM_REQUEST_BODY_LIMIT_BYTES,
  SOP_PHOTO_MAX_EDGE,
  oversizePhotoMessage,
  scaledDimensions,
} from "@/lib/photo-policy";

const root = process.cwd();
const read = (p: string) => readFileSync(path.join(root, p), "utf8");

describe("scaledDimensions", () => {
  it("横图按长边等比缩放", () => {
    expect(scaledDimensions(4000, 3000)).toEqual({ width: 1600, height: 1200 });
  });

  it("竖图按长边等比缩放（手机实拍大多是竖图）", () => {
    expect(scaledDimensions(3000, 4000)).toEqual({ width: 1200, height: 1600 });
  });

  it("长边已在阈值内时原样返回，绝不放大", () => {
    expect(scaledDimensions(800, 600)).toEqual({ width: 800, height: 600 });
    expect(scaledDimensions(1600, 900)).toEqual({ width: 1600, height: 900 });
  });

  it("极端长条图不会把短边压到 0", () => {
    const r = scaledDimensions(8000, 3, SOP_PHOTO_MAX_EDGE);
    expect(r.width).toBe(1600);
    expect(r.height).toBeGreaterThanOrEqual(1);
  });

  it("非法尺寸返回 0x0，交给调用方回退原图", () => {
    expect(scaledDimensions(0, 100)).toEqual({ width: 0, height: 0 });
    expect(scaledDimensions(Number.NaN, 100)).toEqual({ width: 0, height: 0 });
  });
});

describe("上传护栏", () => {
  it("护栏必须严格低于 Vercel 的 4.5 MB 请求体上限", () => {
    // 这条断言的意义：护栏若提到平台上限之上，落在两线之间的照片会被平台
    // 直接 413 掉、我们的路由跑不到，用户拿不到任何可读的错误。
    expect(MAX_PHOTO_UPLOAD_BYTES).toBeLessThan(PLATFORM_REQUEST_BODY_LIMIT_BYTES);
    // 也不能低到把正常照片挡在门外（压缩后约 0.35 MB，留足余量）
    expect(MAX_PHOTO_UPLOAD_BYTES).toBeGreaterThanOrEqual(2 * 1024 * 1024);
  });

  it("拒绝文案带真实体积，而不是一句笼统的失败", () => {
    const msg = oversizePhotoMessage(Math.round(4.2 * 1024 * 1024));
    expect(msg).toContain("4.2 MB");
    expect(msg).toContain("4 MB");
  });
});

describe("结构：压缩必须留在上传路径里", () => {
  const capture = read("src/components/mechanic/sop-photo-capture.tsx");

  it("技师拍照组件先压缩再上传", () => {
    expect(capture).toContain("compressImageForUpload(");
    // 上传的是压缩后的文件，不是原始 file
    expect(capture).toContain('fd.append("file", prepared.file)');
  });

  it("服务端护栏用的是共享常量，不是散落的字面量", () => {
    const route = read("src/app/api/jobs/[id]/photos/route.ts");
    expect(route).toContain("MAX_PHOTO_UPLOAD_BYTES");
    expect(route).not.toContain("8 * 1024 * 1024");
  });
});
