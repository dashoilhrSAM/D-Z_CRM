import Link from "next/link";
import { platformService } from "@/modules/platform/service";
import { requirePlatformAdmin } from "@/lib/platform/guard";
import { deleteTemplateAction, saveTemplateFromTenantAction } from "@/app/platform/actions";

export const dynamic = "force-dynamic";

/**
 * 开通模板库（P4 第三块）。
 *
 * 两条来源：**自定义（从某家店导出的，表里）在前、内置（代码里的）在后** ——
 * 与开新店时的解析顺序一致：免得"列表里看到的"和"实际会用到的"不是同一个。
 */
export default async function PlatformTemplatesPage({ searchParams }: { searchParams: Promise<{ err?: string; ok?: string }> }) {
  const { err, ok } = await searchParams;
  await requirePlatformAdmin();
  const [templates, tenants] = await Promise.all([platformService.listTemplates(), platformService.listTenants()]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-lg font-semibold">开通模板（{templates.length}）</h1>
        <p className="text-sm text-muted-foreground">
          开新店时套用哪套默认配置。内置模板写死在代码里；自定义模板是**从某家店导出来的**——
          开到第五家店时，把已经调好的那家复制过去最省事。
        </p>
      </div>

      {err && <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">操作未生效：{err}</p>}
      {ok && <p className="rounded-md border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-700">{ok}</p>}

      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
            <tr>
              <th className="px-3 py-2">key</th>
              <th className="px-3 py-2">名称</th>
              <th className="px-3 py-2">来源</th>
              <th className="px-3 py-2 text-right">服务</th>
              <th className="px-3 py-2 text-right">来源</th>
              <th className="px-3 py-2 text-right">阶段</th>
              <th className="px-3 py-2 text-right">模板</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {templates.map((t) => (
              <tr key={t.key} className="border-t">
                <td className="px-3 py-2 font-mono text-xs">{t.key}</td>
                <td className="px-3 py-2">
                  <div className="font-medium">{t.name}</div>
                  {t.description && <div className="text-xs text-muted-foreground">{t.description}</div>}
                </td>
                <td className="px-3 py-2 text-xs">
                  <span className={t.source === "custom" ? "text-emerald-600" : "text-muted-foreground"}>
                    {t.source === "custom" ? "自定义" : "内置"}
                  </span>
                </td>
                <td className="px-3 py-2 text-right tabular-nums">{t.counts.serviceTypes}</td>
                <td className="px-3 py-2 text-right tabular-nums">{t.counts.leadSources}</td>
                <td className="px-3 py-2 text-right tabular-nums">{t.counts.leadStages}</td>
                <td className="px-3 py-2 text-right tabular-nums">{t.counts.messageTemplates}</td>
                <td className="px-3 py-2 text-right">
                  {t.source === "custom" ? (
                    <form action={deleteTemplateAction}>
                      <input type="hidden" name="key" value={t.key} />
                      <button type="submit" className="rounded-md border border-destructive px-2 py-1 text-xs text-destructive">删除</button>
                    </form>
                  ) : (
                    <span className="text-xs text-muted-foreground">—</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <section className="max-w-xl space-y-3 rounded-lg border p-4">
        <h2 className="text-sm font-semibold">从一家店导出模板</h2>
        <p className="text-xs text-muted-foreground">
          只搬**配置**（服务目录 / 线索来源与阶段 / 消息模板），不搬业务数据 —— 模板不是备份。
          导出后到「开新店」里就能选它。
        </p>
        <form action={saveTemplateFromTenantAction} className="space-y-2">
          <select name="organisationId" required className="w-full rounded-md border bg-background px-3 py-2 text-sm">
            {tenants.map((t) => (
              <option key={t.id} value={t.id}>{t.name}{t.slug ? "（" + t.slug + "）" : ""}</option>
            ))}
          </select>
          <input name="key" required placeholder="模板 key（如 kl-bike-standard）" className="w-full rounded-md border bg-background px-3 py-2 font-mono text-sm" />
          <input name="name" required placeholder="模板名（如 KL 门店标准配置）" className="w-full rounded-md border bg-background px-3 py-2 text-sm" />
          <input name="description" placeholder="说明（可选）" className="w-full rounded-md border bg-background px-3 py-2 text-sm" />
          <button type="submit" className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground">保存为模板</button>
        </form>
      </section>

      <p className="text-xs text-muted-foreground">
        开新店：<Link href="/platform/new" className="text-primary hover:underline">/platform/new</Link>
      </p>
    </div>
  );
}
