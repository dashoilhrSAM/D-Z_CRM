/**
 * QR deep-link 生成（QR-001..003）。
 * 所有 QR 编码为应用内 deep link，扫码方打开后按 path 路由到对应页。
 * 单页同时承载三个角色（workshop 扫码取车/取人、rider 扫码绑定门店）。
 * 注意：无 server-only——被 client 组件（qr-settings）与 server 组件共用。
 */
export const QR_PATHS = {
  motorcycle: "/qr/motorcycle/",   // 后接 Motorcycle.id
  rider: "/qr/rider/",             // 后接 Customer.id
  workshop: "/qr/workshop/",       // 后接 Organisation.id
} as const;

export function motorcycleQrUrl(motorcycleId: string): string {
  const base = process.env.NEXT_PUBLIC_BASE_URL ?? "http://localhost:3002";
  return base + QR_PATHS.motorcycle + motorcycleId;
}

export function riderQrUrl(customerId: string): string {
  const base = process.env.NEXT_PUBLIC_BASE_URL ?? "http://localhost:3002";
  return base + QR_PATHS.rider + customerId;
}

export function workshopQrUrl(orgId: string, branchId?: string): string {
  const base = process.env.NEXT_PUBLIC_BASE_URL ?? "http://localhost:3002";
  return base + QR_PATHS.workshop + orgId + (branchId ? "?branch=" + encodeURIComponent(branchId) : "");
}