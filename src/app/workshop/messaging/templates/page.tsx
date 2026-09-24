import { db } from "@/lib/db";
import { TemplateManager } from "@/components/workshop/template-manager";
import { getLang } from "@/lib/get-lang";
import { t } from "@/lib/i18n";
import { MessagingStatusNote } from "@/components/workshop/messaging-status-note";

export const dynamic = "force-dynamic";

export default async function TemplatesPage() {
  const lang = await getLang();
  const org = await db.organisation.findFirst();
  const templates = await db.messageTemplate.findMany({ where: { organisationId: org!.id }, orderBy: { createdAt: "desc" } });
  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold">{t("msg.page-title", lang)}</h1>
        <p className="text-sm text-muted-foreground">{t("msg.placeholders-label", lang)} {"{name}"} {"{service}"} {"{bike}"} {"{branch}"} {"{date}"} {"{time}"} {"{ref}"} {"{link}"} {"{invoice}"} {"{total}"}</p>
      </div>
      <TemplateManager />
      {/* 消息还没接通时把话说清楚：现在点发送不会真的发到客户手机 */}
      <MessagingStatusNote />

      <div className="rounded-xl border bg-card overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
            <tr><th className="px-3 py-2.5 font-medium">{t("msg.col-name", lang)}</th><th className="px-3 py-2.5 font-medium">{t("msg.col-channel", lang)}</th><th className="px-3 py-2.5 font-medium">{t("msg.col-body", lang)}</th><th className="px-3 py-2.5 font-medium">{t("msg.col-active", lang)}</th></tr>
          </thead>
          <tbody>
            {templates.map((t) => (
              <tr key={t.id} className="border-t">
                <td className="px-3 py-2.5 font-medium">{t.name}</td>
                <td className="px-3 py-2.5 text-xs">{t.channel}</td>
                <td className="px-3 py-2.5 text-xs text-muted-foreground max-w-md truncate">{t.body}</td>
                <td className="px-3 py-2.5 text-xs">{t.active ? "✓" : "—"}</td>
              </tr>
            ))}
            {templates.length === 0 && <tr><td colSpan={4} className="px-3 py-8 text-center text-sm text-muted-foreground">{t("msg.empty", lang)}</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
