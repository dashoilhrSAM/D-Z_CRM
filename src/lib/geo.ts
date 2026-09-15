/**
 * 地理计算（纯函数，无 IO）。
 *
 * 打卡要不要判「在店里」，取决于两个数字：与门店的距离、以及定位本身的精度。
 * 两个都由**服务端**算——客户端报上来的经纬度只是原始读数，判定权不在它手里。
 */

export interface LatLng {
  lat: number;
  lng: number;
}

const EARTH_RADIUS_M = 6371008.8; // IUGG 平均半径

const toRad = (deg: number) => (deg * Math.PI) / 180;

/** 两个坐标之间的球面距离（米）。Haversine——门店尺度（几十米~几十公里）足够精确。 */
export function haversineMeters(a: LatLng, b: LatLng): number {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * 坐标是否像个真实读数。
 * 注意 (0,0) 在几内亚湾——是「没有定位」最经典的伪装值（有些浏览器/模拟器会报 0,0），
 * 所以这里明确把它当作无效，而不是当作「离门店很远」。
 */
export function isValidLatLng(lat: unknown, lng: unknown): lat is number {
  if (typeof lat !== "number" || typeof lng !== "number") return false;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return false;
  if (lat === 0 && lng === 0) return false;
  return true;
}
