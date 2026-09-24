import { Info } from "lucide-react";
import { getLang } from "@/lib/get-lang";
import { t } from "@/lib/i18n";
import { readMessagingStatus, receiptsConfigured } from "@/lib/messaging-status";

/**
 * 「消息现在不会真的发出去」的说明条。
 *
 * 服务端读环境变量判断 —— **配好 WhatsApp key 之后它自己就消失了** ✓，
 * 所以不需要任何人记得回来删掉这句话（写死的提示最后一定会变成错的 ✗）。
 */
export async function MessagingStatusNote() {
  const status = readMessagingStatus();
  if (status.live) return null;

  const lang = await getLang();
  return (
    <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm">
      <div className="flex items-start gap-2">
        <Info className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" />
        <div className="space-y-1">
          <p className="font-medium text-amber-900">{t("msgstatus.title", lang)}</p>
          <p className="text-amber-800">{t("msgstatus.body", lang)}</p>
          <p className="text-xs text-amber-800/80">
            {t("msgstatus.missing", lang) + " " + status.missing.join(" · ")}
            {receiptsConfigured() ? "" : "  ·  " + t("msgstatus.no-receipts", lang)}
          </p>
        </div>
      </div>
    </div>
  );
}
