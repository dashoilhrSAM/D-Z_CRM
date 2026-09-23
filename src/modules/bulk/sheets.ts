// 批量配置的工作簿定义（P2）。
//
// **列名沿用老板自己的模板**（docs/setup-templates/05_产品目录.xlsx、04_服务套餐.xlsx）——
// 那几张表他已经用着，另造一套只会让人困惑。中文列名与英文列名都在表头里。
//
// 每一 sheet 必须有**稳定键**（SKU / 套餐名）：没有键就无法判断"这一行是改哪一条"，
// 而"猜"在这件事上代价极高（一次猜错就是几百条数据写错位置）。

export const WORKBOOK_VERSION = 1;
/** 版本写在隐藏 sheet 里；不匹配就拒绝导入，而不是按错误的列去解析。 */
export const META_SHEET = "_meta";

export type FieldType = "text" | "int" | "money" | "bool" | "enum";

export interface ColumnDef {
  /** 英文表头（与模板一致） */
  header: string;
  /** 中文表头（与模板一致） */
  zh: string;
  /** 系统字段名 */
  field: string;
  type: FieldType;
  required?: boolean;
  /** enum 归一：模板里写 "Good"，系统存 "GOOD" */
  enumMap?: Record<string, string>;
  note?: string;
}

export interface SheetDef {
  key: string;
  /** sheet 名（与模板一致；解析时按前缀匹配，容忍老板改后缀） */
  title: string;
  keyField: string;
  keyHeader: string;
  columns: ColumnDef[];
  /** 是否允许整行删除（明细类不允许独立删，只能随主表走） */
  allowDelete: boolean;
}

const UNIT_NOTE = "unit / set / litre / piece / box";

export const PRODUCTS_SHEET: SheetDef = {
  key: "products",
  title: "产品目录 Products",
  keyField: "sku",
  keyHeader: "SKU",
  allowDelete: true,
  columns: [
    { header: "SKU", zh: "SKU", field: "sku", type: "text", required: true },
    { header: "Name", zh: "名称", field: "name", type: "text", required: true },
    { header: "Category", zh: "分类", field: "category", type: "text" },
    { header: "Brand", zh: "品牌", field: "brand", type: "text" },
    { header: "Unit", zh: "单位", field: "unit", type: "text", note: UNIT_NOTE },
    { header: "Sell Price", zh: "售价(RM)", field: "sellPriceSen", type: "money", required: true },
    { header: "Cost Price", zh: "成本(RM)", field: "costPriceSen", type: "money", required: true },
    { header: "Min Stock", zh: "最低库存", field: "minStock", type: "int" },
    { header: "Safety Stock", zh: "安全库存", field: "safetyStock", type: "int" },
    { header: "Lead Time", zh: "交期(天)", field: "leadTimeDays", type: "int" },
    { header: "Barcode", zh: "条码", field: "barcode", type: "text" },
    { header: "Part No", zh: "制造商料号", field: "manufacturerPartNo", type: "text" },
    { header: "Compatible Models", zh: "适配车型", field: "compatibleModels", type: "text" },
    { header: "Supplier", zh: "供应商", field: "supplierName", type: "text", note: "按供应商名称匹配；留空=不动" },
  ],
};

export const PACKAGES_SHEET: SheetDef = {
  key: "packages",
  title: "套餐主表 Packages",
  keyField: "name",
  keyHeader: "Package Name",
  allowDelete: true,
  columns: [
    { header: "Package Name", zh: "套餐名称", field: "name", type: "text", required: true },
    {
      header: "Tier", zh: "档位", field: "tier", type: "enum", required: true,
      enumMap: { good: "GOOD", better: "BETTER", best: "BEST", "好": "GOOD", "更好": "BETTER", "最好": "BEST" },
    },
    { header: "Price (RM)", zh: "价格(RM)", field: "priceSen", type: "money", required: true },
    { header: "Description", zh: "说明", field: "description", type: "text" },
    {
      header: "Best Value", zh: "最划算", field: "isBestValue", type: "bool",
      enumMap: { yes: "true", no: "false", "是": "true", "否": "false" },
    },
  ],
};

export const PACKAGE_ITEMS_SHEET: SheetDef = {
  key: "packageItems",
  title: "套餐明细 Items",
  keyField: "itemName",
  keyHeader: "Item Name",
  allowDelete: true,
  columns: [
    { header: "Package Name", zh: "套餐名称", field: "packageName", type: "text", required: true },
    { header: "Item Name", zh: "项目名称", field: "itemName", type: "text", required: true },
    {
      header: "Kind", zh: "类型", field: "kind", type: "enum", required: true,
      enumMap: { service: "SERVICE", part: "PART", "服务": "SERVICE", "配件": "PART" },
    },
    { header: "Product SKU", zh: "产品SKU", field: "productSku", type: "text", note: "Kind=Part 时必填" },
    { header: "Qty", zh: "默认数量", field: "defaultQty", type: "int" },
    { header: "Price (RM)", zh: "单价(RM)", field: "priceSen", type: "money" },
  ],
};

export const SHEETS: SheetDef[] = [PRODUCTS_SHEET, PACKAGES_SHEET, PACKAGE_ITEMS_SHEET];

export function sheetByKey(key: string): SheetDef | undefined {
  return SHEETS.find((s) => s.key === key);
}

/** 表头行：英文 + 中文并排，一眼能对上模板。 */
export function headerRow(def: SheetDef): string[] {
  return def.columns.map((c) => c.header);
}
export function headerRowZh(def: SheetDef): string[] {
  return def.columns.map((c) => c.zh);
}
