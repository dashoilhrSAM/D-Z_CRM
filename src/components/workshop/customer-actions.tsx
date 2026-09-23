"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { MessageSquare, CalendarPlus, KeyRound, Copy, Check } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { sendReminder, resetRiderPassword } from "@/actions/workshop";
import { useLang } from "@/components/shared/language-context";
import { t } from "@/lib/i18n";

/**
 * 客户详情页的动作条（发送提醒 / 建工单 / **重置骑手登录密码**）。
 *
 * 重置密码是给"忘了密码又没有邮箱"的骑手用的兜底：那种账号自助找回走不通，只能柜台出手。
 * 新密码由服务端生成（见 lib/auth/temp-password.ts，剔除了 0/O、1/l 这类口述易错字符），
 * **只在本次响应里回显一次**，关掉就没了——所以这里要显眼提示"现在就告诉骑手"。
 */
export function CustomerActions({ customerId, motorcycleId, nextServiceMileage, hasLogin }: { customerId: string; motorcycleId: string; nextServiceMileage: number | null; hasLogin: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [issued, setIssued] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const lang = useLang();

  const resetPassword = () =>
    start(async () => {
      const r = await resetRiderPassword(customerId);
      if (r.ok) {
        setIssued(r.password);
        setCopied(false);
      } else {
        toast.error(r.error);
      }
    });

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="outline" disabled={pending || !nextServiceMileage}
          onClick={() => start(async () => { await sendReminder(customerId, motorcycleId, nextServiceMileage ?? 0); router.refresh(); toast.success(t("customer-action.toast-reminder", lang)); })}>
          <MessageSquare className="h-3.5 w-3.5 mr-1.5" /> {t("customer-action.send-reminder", lang)}
        </Button>
        <Button size="sm" variant="outline" onClick={() => router.push("/workshop/jobs/new?customer=" + customerId)}>
          <CalendarPlus className="h-3.5 w-3.5 mr-1.5" /> {t("customer-action.create-job", lang)}
        </Button>
        {hasLogin && (
          <Button size="sm" variant="outline" disabled={pending} onClick={resetPassword}>
            <KeyRound className="h-3.5 w-3.5 mr-1.5" /> {t("customer-action.reset-password", lang)}
          </Button>
        )}
      </div>

      {issued && (
        <div className="rounded-xl border border-amber-500/40 bg-amber-500/5 p-3">
          <p className="text-xs text-muted-foreground">{t("customer-action.reset-password-new", lang)}</p>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <code className="font-mono text-lg font-semibold tracking-wide">{issued}</code>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                void navigator.clipboard?.writeText(issued);
                setCopied(true);
              }}
            >
              {copied ? <Check className="h-3.5 w-3.5 mr-1" /> : <Copy className="h-3.5 w-3.5 mr-1" />}
              {copied ? t("customer-action.reset-password-copied", lang) : t("customer-action.copy", lang)}
            </Button>
          </div>
          <p className="mt-2 text-xs text-amber-600">{t("customer-action.reset-password-warn", lang)}</p>
        </div>
      )}
    </div>
  );
}
