import { ProvisionTenantForm } from "@/components/platform/provision-tenant-form";
import { platformService } from "@/modules/platform/service";
import { requirePlatformAdmin } from "@/lib/platform/guard";

export const dynamic = "force-dynamic";

/** 开新店（P4）。守卫在 layout；真正的授权判定在 action 里再做一次。 */
export default async function PlatformNewTenantPage() {
  await requirePlatformAdmin();
  const templates = (await platformService.listTemplates()).map((t) => ({
    key: t.key, name: t.name, source: t.source, counts: t.counts,
  }));
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-semibold">开新店</h1>
        <p className="text-sm text-muted-foreground">一次开通会建齐租户、门店、店主账号、归属关系与默认配置。</p>
      </div>
      <ProvisionTenantForm templates={templates} />
    </div>
  );
}
