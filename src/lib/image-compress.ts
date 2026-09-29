import {
  SOP_PHOTO_MAX_EDGE,
  SOP_PHOTO_QUALITY,
  scaledDimensions,
} from "./photo-policy";

/**
 * 浏览器端照片压缩（SOP 照片上传前调用）。
 *
 * 设计原则：**绝不因为压缩失败而阻断上传**。任何异常都退回原文件，
 * 由服务端护栏兜底 —— 一个拍不到照片的技师，比一张略大的照片严重得多。
 * 但成功压缩时，体积通常降到原来的 1/8（实测 2.65 MB → 约 0.35 MB）。
 */

export interface CompressResult {
  /** 真正要上传的文件（压缩成功则是新文件，否则就是原文件）。 */
  file: File;
  originalBytes: number;
  bytes: number;
  compressed: boolean;
}

interface Decoded {
  source: CanvasImageSource;
  width: number;
  height: number;
  release: () => void;
}

/** 把文件名换成 .jpg（canvas 只能输出 JPEG/PNG/WebP，统一走 JPEG）。 */
function jpegName(name: string): string {
  const dot = name.lastIndexOf(".");
  const base = dot > 0 ? name.slice(0, dot) : name;
  return base + ".jpg";
}

async function decode(file: File): Promise<Decoded | null> {
  if (typeof createImageBitmap === "function") {
    try {
      const bitmap = await createImageBitmap(file);
      return { source: bitmap, width: bitmap.width, height: bitmap.height, release: () => bitmap.close() };
    } catch {
      // 部分浏览器对 HEIC / 超大图会抛，落回 img 解码路径
    }
  }
  const url = URL.createObjectURL(file);
  const img = await new Promise<HTMLImageElement | null>((resolve) => {
    const el = new Image();
    el.onload = () => resolve(el);
    el.onerror = () => resolve(null);
    el.src = url;
  });
  if (!img) {
    URL.revokeObjectURL(url);
    return null;
  }
  return { source: img, width: img.naturalWidth, height: img.naturalHeight, release: () => URL.revokeObjectURL(url) };
}

function encode(source: CanvasImageSource, width: number, height: number): Promise<Blob | null> {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return Promise.resolve(null);
  ctx.drawImage(source, 0, 0, width, height);
  return new Promise((resolve) => canvas.toBlob((blob) => resolve(blob), "image/jpeg", SOP_PHOTO_QUALITY));
}

export async function compressImageForUpload(file: File): Promise<CompressResult> {
  const originalBytes = file.size;
  const passthrough: CompressResult = { file, originalBytes, bytes: originalBytes, compressed: false };
  try {
    if (!file.type.startsWith("image/")) return passthrough;
    // 矢量与动图过 canvas 会坏掉（SVG 位图化、GIF 只剩第一帧），原样放行
    if (/svg|gif/i.test(file.type)) return passthrough;

    const decoded = await decode(file);
    if (!decoded) return passthrough;
    try {
      const { width, height } = scaledDimensions(decoded.width, decoded.height, SOP_PHOTO_MAX_EDGE);
      if (width < 1 || height < 1) return passthrough;
      const blob = await encode(decoded.source, width, height);
      if (!blob) return passthrough;
      // 压缩没收益（原图本来就小）就用原图，别做无谓的二次编码
      if (blob.size >= originalBytes) return passthrough;
      return {
        file: new File([blob], jpegName(file.name), { type: "image/jpeg" }),
        originalBytes,
        bytes: blob.size,
        compressed: true,
      };
    } finally {
      decoded.release();
    }
  } catch {
    return passthrough;
  }
}
