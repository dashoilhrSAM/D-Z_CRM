/**
 * 零件搜索（产品页用）。
 *
 * 抽成纯函数的原因很实际：搜索最容易出的 bug 不是「搜不到」，而是
 * **空搜索把整张表搜没了** —— 那种情况下界面看起来像「没有零件」，
 * 而不是「搜索条件没写对」。所以这里有一条明确的规则 + 测试盯着它。
 */

export interface SearchableProduct {
  name: string;
  sku: string;
  brand?: string | null;
  category?: string | null;
  manufacturerPartNo?: string | null;
}

/** 拆成词：空格分开，全部命中才算匹配（搜 "oil filter" 不会把只含 oil 的也带出来） */
export function queryTerms(query: string): string[] {
  return query.trim().toLowerCase().split(/\s+/).filter(Boolean);
}

export function matchesProductQuery(p: SearchableProduct, query: string): boolean {
  const terms = queryTerms(query);
  if (terms.length === 0) return true;   // 空查询 = 不过滤（**不是**全部隐藏）
  const haystack = [p.name, p.sku, p.brand, p.category, p.manufacturerPartNo]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return terms.every((term) => haystack.includes(term));
}

export function filterProducts<T extends SearchableProduct>(products: T[], query: string): T[] {
  const terms = queryTerms(query);
  if (terms.length === 0) return products;
  return products.filter((p) => matchesProductQuery(p, query));
}
