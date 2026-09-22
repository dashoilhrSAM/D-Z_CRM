// 手机号归一化工具（Rider 手机登录/注册用）
// 存储格式（Customer.phone）：现兼容本地 "013-125 2832" 与国际 "+60131252832"，匹配时统一归一化。

/** 可用国家区号（注册/登录选择，默认马来西亚）。 */
export const COUNTRY_CODES = [
  { code: "+60", label: "Malaysia +60" },
  { code: "+65", label: "Singapore +65" },
  { code: "+62", label: "Indonesia +62" },
  { code: "+66", label: "Thailand +66" },
  { code: "+63", label: "Philippines +63" },
  { code: "+86", label: "China +86" },
  { code: "+44", label: "UK +44" },
  { code: "+1", label: "US/CA +1" },
] as const;

/** 只提取数字（去 +、空格、- 等分隔符）。任意位数。 */
export function digitsOnly(input: string): string {
  return input.replace(/[^\d]/g, "");
}

/**
 * 组合区号 + 本地号 → E.164。任一部分为空则 ""。
 *
 * 三种输入都要正确（2026-09 修正，此前只有第二种是对的）：
 *  ① 本地习惯写法："+60" + "013-125 2832" → **+60131252832**（马来本地号转国际必须去掉前导 0，
 *     旧实现给出 "+600131252832"：多一位、不是合法 E.164，Supabase 收不了、也匹配不上任何客户）；
 *  ② 直接粘贴国际格式："+60" + "+60131252832" / "60131252832" → +60131252832（旧实现给出 "+6060..."）；
 *  ③ 不含前导 0 的国家号写法："+60" + "12 345 6789" → +60123456789（占位符示范的写法，一直是对的）。
 */
export function combinePhone(countryCode: string, local: string): string {
  const cc = digitsOnly(countryCode);
  const l = digitsOnly(local);
  if (!cc || !l) return "";
  // ① 输入本身已经是国际格式（带 +）
  if (local.trim().startsWith("+")) return "+" + l;
  // ② 输入已经带国家码（不带 +）——只在位数明显超过国家码时才这样认定，
  //    否则 "+1" + "4155552671" 会被误判成"已带国家码"。
  if (l.startsWith(cc) && l.length >= cc.length + 7) return "+" + l;
  // ③ 本地写法：去掉前导 0 再拼国家码
  return "+" + cc + l.replace(/^0+/, "");
}

/**
 * 宽松归一化（用户输入，可任意格式，只要含数字）→ 本地比较键。
 * 马来（+60/60 前缀、11 位）转本地 10 位；其他保持数字。空返回 ""。
 */
export function normalizePhoneLoose(input: string): string {
  const d = digitsOnly(input);
  if (!d) return "";
  if ((d.startsWith("60") || d.startsWith("160")) && d.length === 11) return "0" + d.slice(2);
  return d;
}

/** 存储值 → 比较键（本地 "013-125 2832" 或 "+60131252832" 均归一化到本地 10 位，用于匹配）。 */
export function matchKey(phone: string | null | undefined): string {
  if (!phone) return "";
  const d = digitsOnly(phone);
  if (d.startsWith("60") && d.length === 11) return "0" + d.slice(2);
  return d;
}

/** 严格马来格式校验（兼容测试/旧逻辑：01x + 10 位）；非马来格式返回 ""。 */
export function normalizePhone(input: string): string {
  const raw = input.trim().replace(/[^\d+]/g, "");
  if (!raw) return "";
  let d = raw.startsWith("+") ? raw.slice(1) : raw;
  if (d.startsWith("60") && d.length === 11) d = "0" + d.slice(2);
  if (/^01\d{8}$/.test(d)) return d;
  return "";
}

/** 存储值 → 本地 10 位（"013-125 2832" → "0131252832"；"+60131252832" → "0131252832"）。 */
export function phoneDigits(phone: string | null | undefined): string {
  if (!phone) return "";
  let d = phone.replace(/[^\d+]/g, "").replace(/^\+/, "");
  if (d.startsWith("60") && d.length === 11) d = "0" + d.slice(2);
  return d;
}

/** 本地 10 位 → E.164（0131252832 → +60131252832），供 Supabase phone 登录。 */
export function toE164(local: string): string {
  return "+60" + local.slice(1);
}

/** 本地 10 位 → 存储格式（0131252832 → "013-125 2832"，与 seed Customer.phone 一致）。 */
export function fmtStoredPhone(local: string): string {
  return local.slice(0, 3) + "-" + local.slice(3, 6) + " " + local.slice(6);
}

/** archive value -> E.164 for WhatsApp Graph API `to` */
export function toE164ForWhatsApp(phone: string | null | undefined): string {
  if (!phone) return "";
  const raw = phone.trim();
  if (/^\+[1-9]\d{7,14}$/.test(raw)) return raw;
  const d = digitsOnly(raw);
  if (!d) return raw;
  if (/^01\d{8}$/.test(d)) return "+60" + d.slice(1);
  if (d.startsWith("60") && d.length === 11) return "+" + d;
  return "+" + d;
}
