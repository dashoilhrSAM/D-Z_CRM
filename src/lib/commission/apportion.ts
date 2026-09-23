// 佣金口径的纯函数层（无 IO，可单测）。
//
// 这一层只回答三件事，每件都曾被"拍脑袋实现"坑过：
//  ① 发票折扣怎么分摊到行（佣金基数 = **客户实付**，不是原价）；
//  ② 哪些行参与计提（拒绝行、免费行不参与）；
//  ③ 计提落在哪个结算窗口（自然月，MYT —— 不是服务器时区）。

/**
 * 把发票折扣按行分摊。返回每行应承担的折扣额（与 lineTotalsSen 等长）。
 *
 * 为什么按**行占比**分摊而不是平均分：佣金是按行算的，折扣若平均分，
 * 便宜的行会被分到不成比例的折扣，甚至出现"这行折扣比它自己的金额还大"（净额为负）。
 * 尾差（除不尽的分）归**最大的一行**：它最不容易因四舍五入变成负数，也最容易解释。
 *
 * 单行承担额**上限是该行自己的金额**（净额不会变负）。
 */
export function splitDiscountToLines(lineTotalsSen: readonly number[], discountSen: number): number[] {
  const totals = lineTotalsSen.map((v) => Math.max(0, Math.round(v)));
  const subtotal = totals.reduce((s, v) => s + v, 0);
  const discount = Math.max(0, Math.round(discountSen));
  if (discount === 0 || subtotal === 0) return totals.map(() => 0);
  // 折扣大于等于小计（极端：全免）→ 每行承担自己的全部金额，净额归零
  if (discount >= subtotal) return totals.slice();

  const shares = totals.map((t) => Math.floor((discount * t) / subtotal));
  let remainder = discount - shares.reduce((s, v) => s + v, 0);
  // 尾差给最大行（并列时取下标最小者，保证同输入同输出）
  let idx = 0;
  for (let i = 1; i < totals.length; i++) if (totals[i] > totals[idx]) idx = i;
  while (remainder > 0 && totals.length > 0) {
    if (shares[idx] < totals[idx]) {
      shares[idx] += 1;
      remainder -= 1;
    } else {
      // 最大行已到上限，找下一个还有余量的行
      const next = shares.findIndex((s, i) => s < totals[i]);
      if (next === -1) break;
      shares[next] += 1;
      remainder -= 1;
    }
  }
  return shares;
}

/** 行的折后净额（佣金基数）。 */
export function netLineSen(lineTotalSen: number, shareOfDiscountSen: number): number {
  return Math.max(0, Math.round(lineTotalSen) - Math.max(0, Math.round(shareOfDiscountSen)));
}

/** 参与计提的行：拒单的不算，**免费行/保修行也不算**（不计佣也不计件 —— 老板决定 4）。 */
export function isBillableLine(line: { status?: string | null; unitPriceSen: number }): boolean {
  if (line.status === "DECLINED") return false;
  return Math.round(line.unitPriceSen) > 0;
}

/**
 * 结算窗口键：**自然月，按 MYT（Asia/Kuala_Lumpur）**。
 *
 * 不能用 toISOString().slice(0,7)：服务器在 UTC 上跑，MYT 比 UTC 早 8 小时，
 * 于是"9 月 30 日 23:00 MYT"在 UTC 是 9 月 30 日 15:00（同月，没事），
 * 但"10 月 1 日 02:00 MYT"在 UTC 是 **9 月 30 日 18:00** —— 会被算进上个月，
 * 技师在月初干的活跑进上月结算窗口，且完全静默。
 */
export function windowKeyOf(at: Date, timeZone: string = "Asia/Kuala_Lumpur"): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit" }).formatToParts(at);
  const y = parts.find((p) => p.type === "year")?.value ?? "0000";
  const m = parts.find((p) => p.type === "month")?.value ?? "00";
  return y + "-" + m;
}
