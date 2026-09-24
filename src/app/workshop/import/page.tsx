import { redirect } from "next/navigation";

/**
 * 旧 CSV 导入入口 —— **已退役**（2026-09-24，老板批准）。
 *
 * 为什么退役：客户 / 零件 / 车辆这三个 CSV 入口各自有一套判重与归一化逻辑，
 * 与批量配置工作簿的规则**是两份实现**。两份实现意味着同一份数据走两条路会得到不同结果 ——
 * 这个项目为此吃过亏（「同一规则两份实现」是已知高发点）。
 *
 * 现在统一走 /workshop/setup：下载现状 → 在 Excel 里改 → 上传 → 逐条审 → 应用。
 * 这里保留一个**重定向**而不是 404，因为老板可能还存着旧链接、说明书里也可能印着它。
 */
export default function LegacyCsvImportPage() {
  redirect("/workshop/setup");
}
