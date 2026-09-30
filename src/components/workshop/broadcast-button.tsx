"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { broadcastCampaign } from "@/actions/marketing";
import { useLang } from "@/components/shared/language-context";
import { t, tpl } from "@/lib/i18n";

export interface BroadcastStats { sent: number; delivered: number; failed: number; }

export function BroadcastButton({ campaignId, stats }: { campaignId: string; stats: BroadcastStats }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState("");
  const lang = useLang();

  const send = () =>
    start(async () => {
      const r = await broadcastCampaign({ campaignId, message: message || undefined });
      // 被服务端拒绝时（未登录 / 无权限 / 不是本组织的 campaign）不能报成功：
      // 旧版这里无条件 toast.success，于是"没发出去"看起来跟"发出去了"一样。
      if (!r.ok) {
        toast.error(t("toast.failed", lang));
        return;
      }
      setOpen(false);
      router.refresh();
      toast.success(tpl("broadcast.toast-sent", lang, { n: r.sent }));
    });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger className="inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-[11px] font-medium hover:bg-muted">
        <Send className="h-3 w-3" /> {t("broadcast.button", lang)}{stats.sent > 0 ? " (" + stats.sent + ")" : ""}
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("broadcast.dialog-title", lang)}</DialogTitle>
          <DialogDescription>{t("broadcast.dialog-desc", lang)}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <div>
            <Label>{t("broadcast.message-label", lang)}</Label>
            <Input value={message} onChange={(e) => setMessage(e.target.value)} placeholder={t("broadcast.message-placeholder", lang)} className="mt-1.5" />
          </div>
          {stats.sent > 0 && (
            <p className="text-xs text-muted-foreground">
              {tpl("broadcast.prev-sent", lang, { n: stats.sent })}
              {stats.delivered > 0 ? " (" + stats.delivered + " " + t("broadcast.delivered", lang) + (stats.failed > 0 ? ", " + stats.failed + " " + t("broadcast.failed", lang) : "") + ")" : ""}
              {" — " + t("broadcast.re-broadcast", lang)}
            </p>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>{t("common.cancel", lang)}</Button>
          <Button disabled={pending} onClick={send}><Send className="h-3.5 w-3.5 mr-1.5" /> {pending ? t("broadcast.sending", lang) : t("broadcast.send", lang)}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
