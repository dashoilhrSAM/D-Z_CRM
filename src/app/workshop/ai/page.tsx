import Link from "next/link";
import { Sparkles } from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { AiDraftComposer } from "@/components/workshop/ai-draft-composer";
import { aiService } from "@/modules/ai/service";
import { db } from "@/lib/db";
import { getSessionUser } from "@/lib/session-user";
import { scopedBranchId } from "@/lib/branch-scope";
import { getLang } from "@/lib/get-lang";
import { t } from "@/lib/i18n";

export const dynamic = "force-dynamic";

export default async function AiCentrePage() {
  const lang = await getLang();
  // 分行作用域：branch 级用户看本分行洞察；org 级回退主店
  const session = await getSessionUser();
  const scopedId = scopedBranchId(session);
  const branch = scopedId
    ? await db.branch.findUnique({ where: { id: scopedId } })
    : await db.branch.findFirst({ where: { isMain: true } });
  const recs = await aiService.recommendations(branch?.id, lang);
  return (
    <div className="space-y-6">
      <PageHeader title={t("dash.ai-centre", lang)} subtitle={t("ws.ai.subtitle", lang)} />

      {/* AI-011/013..019: message drafts */}
      <div className="rounded-2xl border bg-card p-5">
        <h2 className="font-semibold mb-1 flex items-center gap-2"><Sparkles className="h-4 w-4 text-primary" /> {t("ws.ai.drafts-title", lang)}</h2>
        <p className="text-xs text-muted-foreground mb-4">{t("ws.ai.drafts-sub", lang)}</p>
        <AiDraftComposer />
      </div>

      {/* AI-020..027: business insights (rule-based) */}
      <div>
        <h2 className="font-semibold mb-3 flex items-center gap-2"><Sparkles className="h-4 w-4 text-primary" /> {t("ws.ai.insights-title", lang)}</h2>
        <div className="space-y-3">
        {recs.map((r, i) => (
          <Link key={i} href={r.href} className="group flex items-start gap-4 rounded-2xl border bg-card p-5 hover:border-primary/40 transition-colors">
            <div className={"h-10 w-10 shrink-0 rounded-xl flex items-center justify-center " + (r.tone === "danger" ? "bg-red-50 text-red-600 dark:bg-red-950/50 dark:text-red-300" : r.tone === "warn" ? "bg-amber-50 text-amber-600 dark:bg-amber-950/50 dark:text-amber-300" : "bg-primary/10 text-primary")}>
              <Sparkles className="h-5 w-5" />
            </div>
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <p className="font-semibold">{r.title}</p>
                <span className="rounded-full bg-violet-500/15 text-violet-600 dark:text-violet-400 text-[10px] px-2 py-0.5 font-semibold">AI</span>
              </div>
              <p className="text-sm text-muted-foreground mt-0.5">{r.detail}</p>
              <span className="mt-2 inline-block text-xs font-bold text-primary group-hover:underline">{r.action} →</span>
            </div>
          </Link>
        ))}
        {recs.length === 0 && (
          <div className="rounded-2xl border bg-card p-10 text-center text-sm text-muted-foreground">{t("ws.ai.no-recs", lang)}</div>
        )}
        </div>
      </div>
    </div>
  );
}
