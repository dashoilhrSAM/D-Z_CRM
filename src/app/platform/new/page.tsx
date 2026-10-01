import { ProvisionTenantForm } from "@/components/platform/provision-tenant-form";

export const dynamic = "force-dynamic";

/** 开新店（P4）。守卫在 layout；真正的授权判定在 action 里再做一次。 */
export default function PlatformNewTenantPage() {
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-semibold">开新店</h1>
        <p className="text-sm text-muted-foreground">一次开通会建齐租户、门店、店主账号、归属关系与默认配置。</p>
      </div>
      <ProvisionTenantForm />
    </div>
  );
}
