import { describe, expect, it } from "vitest";

describe("机修接单按钮的状态判定（老板反馈「点了 accept 之后还是 accept」）", () => {
  it("**照片不满 5 张 → 显示还差几张**（不是显示接单，更不是静默失败）", async () => {
    const { jobStartState } = await import("@/lib/job-start-state");
    expect(jobStartState({ status: "WAITING", photoCount: 0, quotationApproved: null })).toBe("needs-photos");
    expect(jobStartState({ status: "WAITING", photoCount: 4, quotationApproved: true })).toBe("needs-photos");
    // 照片优先：即使报价已确认，也要先把照片拍齐
    expect(jobStartState({ status: "WAITING", photoCount: 3, quotationApproved: true })).toBe("needs-photos");
  });

  it("照片齐了但报价未确认 → 显示等客户（不是显示接单然后失败）", async () => {
    const { jobStartState } = await import("@/lib/job-start-state");
    expect(jobStartState({ status: "WAITING", photoCount: 5, quotationApproved: false })).toBe("needs-quotation");
  });

  it("两道都过了才是真正的接单；已经在干的工单不显示接单", async () => {
    const { jobStartState } = await import("@/lib/job-start-state");
    expect(jobStartState({ status: "WAITING", photoCount: 5, quotationApproved: true })).toBe("ready");
    expect(jobStartState({ status: "WAITING", photoCount: 5, quotationApproved: null })).toBe("ready");
    for (const s of ["IN_PROGRESS", "QC_CHECK", "READY", "COMPLETED"]) {
      expect(jobStartState({ status: s, photoCount: 0, quotationApproved: null }), s + " 不该再显示接单").toBe("not-waiting");
    }
  });
});

describe("零件搜索（产品页）", () => {
  const parts = [
    { name: "Yamalube 10W-40", sku: "OIL-001", brand: "Yamaha", category: "Oil", manufacturerPartNo: "90793-AD001" },
    { name: "Oil Filter", sku: "FLT-002", brand: "Honda", category: "Filter", manufacturerPartNo: null },
    { name: "Spark Plug", sku: "PLG-003", brand: "NGK", category: "Ignition", manufacturerPartNo: "94702-001" },
  ];

  it("按名字 / SKU / 品牌 / 分类 / 原厂编号都能搜到，且大小写不敏感", async () => {
    const { filterProducts } = await import("@/lib/product-search");
    expect(filterProducts(parts, "spark").map((p) => p.sku)).toEqual(["PLG-003"]);
    expect(filterProducts(parts, "flt-002").map((p) => p.sku)).toEqual(["FLT-002"]);
    expect(filterProducts(parts, "ngk").map((p) => p.sku)).toEqual(["PLG-003"]);
    expect(filterProducts(parts, "ignition").map((p) => p.sku)).toEqual(["PLG-003"]);
    expect(filterProducts(parts, "94702").map((p) => p.sku)).toEqual(["PLG-003"]);
  });

  it("多个词要**全部命中**（搜 oil filter 不会把只有 oil 的也带出来）", async () => {
    const { filterProducts } = await import("@/lib/product-search");
    expect(filterProducts(parts, "oil").map((p) => p.sku)).toEqual(["OIL-001", "FLT-002"]);
    expect(filterProducts(parts, "oil filter").map((p) => p.sku)).toEqual(["FLT-002"]);
  });

  it("**空搜索必须返回全部**（搜索最容易出的 bug 就是把整张表搜没了）", async () => {
    const { filterProducts } = await import("@/lib/product-search");
    expect(filterProducts(parts, "").length).toBe(3);
    expect(filterProducts(parts, "   ").length).toBe(3);
    // 反向：真的搜不到时必须是 0，否则说明过滤根本没生效
    expect(filterProducts(parts, "zzz-nothing").length).toBe(0);
  });
});
