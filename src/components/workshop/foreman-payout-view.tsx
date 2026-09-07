"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import { CheckSquare, ChevronDown, Square, Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { settlePayouts, agreePayout, addPayoutPayment } from "@/actions/payouts";
import { updateJobCommission, updateJobBonus, setPayoutBonus, updateMechanicCommissionRules } from "@/actions/settlements";
import { useLang } from "@/components/shared/language-context";
import { t, tpl } from "@/lib/i18n";
import { formatRM } from "@/lib/money";
import { fmtDate } from "@/lib/format";
import type { Lang } from "@/lib/i18n";

export interface DailyBill {
  date: Date;
  jobs: number;
  salesSen: number;
  baseSen: number;
  commissionSen: number;
  addonBonusSen: number;
  bonusSen: number;
  totalSen: number;
  payoutStatus: string | null;
  payoutId: string | null;
  paidSen: number;
  jobsList: { jobId: string; jobNumber: string; serviceType: string; plate: string; customer: string; salesSen: number; commissionSen: number; bonusSen: number }[];
}

export interface ForemanBill {
  id: string;
  name: string;
  totalJobs: number;
  totalSalesSen: number;
  totalSen: number;
  daily: DailyBill[];
  commissionRules: { commissionType: string; commissionValue: number; addonBonusSen: number } | null;
}

const METHODS = ["CASH", "BANK_TRANSFER", "EWALLET", "CARD"];

export function ForemanPayoutView({ foremen, lang, orgCommissionValue }: { foremen: ForemanBill[]; lang: Lang; orgCommissionValue: number }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [openForeman, setOpenForeman] = useState<string | null>(null);
  const [openDay, setOpenDay] = useState<string | null>(null);
  const [payFor, setPayFor] = useState<{ userId: string; name: string; date: Date; baseSen: number; commissionSen: number; addonBonusSen: number; totalSen: number; paidSen: number } | null>(null);
  const [agreeFor, setAgreeFor] = useState<{ payoutId: string; name: string; totalSen: number } | null>(null);
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState("CASH");
  const [agreeMethod, setAgreeMethod] = useState("CASH");
  // per-mechanic rules editor
  const [rulesFor, setRulesFor] = useState<{ userId: string; name: string; commissionType: string; commissionValue: string; addonBonus: string } | null>(null);
  // per-job commission buffer (key=jobId)
  const [jobComm, setJobComm] = useState<Record<string, string>>({});
  const [jobBonus, setJobBonus] = useState<Record<string, string>>({});
  // per-day bonus buffer (key = userId:date)
  const [bonusBuf, setBonusBuf] = useState<Record<string, string>>({});

  const key = (uid: string, date: Date) => uid + ":" + date.toISOString();
  const toggle = (k: string) => setSelected((prev) => { const next = new Set(prev); if (next.has(k)) next.delete(k); else next.add(k); return next; });

  const saveJobComm = (jobId: string) =>
    start(async () => {
      const v = jobComm[jobId];
      const r = await updateJobCommission(jobId, v === "" ? 1000 : Math.round(parseFloat(v || "0") * 100));
      if (r.ok) { setJobComm((p) => ({ ...p, [jobId]: "" })); toast.success(t("settle.save-mech", lang)); router.refresh(); }
      else toast.error(r.error);
    });
  const saveJobBonus = (jobId: string) =>
    start(async () => {
      const v = jobBonus[jobId];
      const r = await updateJobBonus(jobId, v === "" ? null : Math.round(parseFloat(v || "0") * 100));
      if (r.ok) { setJobBonus((p) => ({ ...p, [jobId]: "" })); toast.success(t("settle.save-mech", lang)); router.refresh(); }
      else toast.error(r.error);
    });
  const saveBonus = (userId: string, date: Date, commissionSen: number, addonBonusSen: number) =>
    start(async () => {
      const v = bonusBuf[key(userId, date)];
      const r = await setPayoutBonus(userId, "day", date, Math.round(parseFloat(v || "0") * 100), commissionSen, addonBonusSen);
      if (r.ok) { toast.success(t("payout.bonus", lang) + " ✓"); router.refresh(); }
      else toast.error(r.error);
    });

  const saveRules = () =>
    start(async () => {
      if (!rulesFor) return;
      const r = await updateMechanicCommissionRules(rulesFor.userId, {
        commissionType: rulesFor.commissionType as "per_job" | "percent_sales" | "flat",
        commissionValue: rulesFor.commissionType === "percent_sales" ? parseFloat(rulesFor.commissionValue || "0") : Math.round(parseFloat(rulesFor.commissionValue || "0") * 100),
        addonBonusSen: Math.round(parseFloat(rulesFor.addonBonus || "0") * 100),
      });
      if (r.ok) { toast.success(t("settle.save-mech", lang)); setRulesFor(null); router.refresh(); }
      else toast.error(r.error);
    });

  const payAll = () =>
    start(async () => {
      const items: { userId: string; period: string; periodStart: Date; baseSen: number; commissionSen: number; addonBonusSen: number; bonusSen: number; totalSen: number }[] = [];
      for (const f of foremen) for (const b of f.daily) {
        if (selected.has(key(f.id, b.date)) && b.totalSen > 0) {
          items.push({ userId: f.id, period: "day", periodStart: b.date, baseSen: b.baseSen, commissionSen: b.commissionSen, addonBonusSen: b.addonBonusSen, bonusSen: b.bonusSen, totalSen: b.totalSen });
        }
      }
      const r = await settlePayouts(items);
      if (r.ok) { toast.success(tpl("payout.paid-toast", lang, { n: r.settled })); setSelected(new Set()); router.refresh(); }
      else toast.error(r.error);
    });

  const doAgree = () => start(async () => { if (!agreeFor) return; const r = await agreePayout(agreeFor.payoutId, agreeMethod); if (r.ok) { toast.success("Payment confirmed — salary paid"); setAgreeFor(null); router.refresh(); } else toast.error(r.error); });

  const payOne = () => start(async () => { if (!payFor) return; const r = await addPayoutPayment({ userId: payFor.userId, period: "day", periodStart: payFor.date, baseSen: payFor.baseSen, commissionSen: payFor.commissionSen, addonBonusSen: payFor.addonBonusSen, totalSen: payFor.totalSen, amountSen: Math.round(parseFloat(amount || "0") * 100), method }); if (r.ok) { toast.success(t("payout.payment-added", lang)); setPayFor(null); setAmount(""); router.refresh(); } else toast.error(r.error); });

  const isDefault = (f: ForemanBill) => !f.commissionRules;

  return (
    <>
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <Button size="sm" disabled={selected.size === 0 || pending} onClick={payAll}><Wallet className="h-3.5 w-3.5 mr-1.5" />{tpl("payout.pay-selected", lang, { n: selected.size })}</Button>
        <span className="text-xs text-muted-foreground">{foremen.length} foremen</span>
      </div>

      <div className="space-y-2">
        {foremen.length === 0 && <div className="rounded-2xl border bg-card p-10 text-center text-sm text-muted-foreground">{t("settle.empty", lang)}</div>}
        {foremen.map((f) => {
          const isOpen = openForeman === f.id;
          return (
            <div key={f.id} className="rounded-2xl border bg-card overflow-hidden">
              <button type="button" onClick={() => setOpenForeman(isOpen ? null : f.id)} className="flex w-full items-center gap-3 p-4 text-left hover:bg-accent/40">
                <div className="h-10 w-10 shrink-0 rounded-xl bg-primary/10 text-primary flex items-center justify-center font-semibold">{f.name.split(" ").map((w) => w[0]).slice(0, 2).join("").toUpperCase()}</div>
                <div className="min-w-0 flex-1">
                  <div className="font-semibold">{f.name}<span className={"ml-2 rounded-full px-2 py-0.5 text-[10px] font-bold " + (isDefault(f) ? "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300" : "bg-primary/10 text-primary")}>{t("settle.mech-rules", lang)}</span></div>
                  <div className="text-xs text-muted-foreground">{f.totalJobs} jobs · {formatRM(f.totalSalesSen)}</div>
                </div>
                <div className="text-right">
                  <div className="text-sm font-bold tabular-nums text-primary">{formatRM(f.totalSen)}</div>
                  <div className="text-[10px] text-muted-foreground">{t("payout.total", lang)}</div>
                </div>
                <ChevronDown className={"h-4 w-4 text-muted-foreground transition-transform " + (isOpen ? "rotate-180" : "")} />
              </button>

              {isOpen && (
                <div className="border-t divide-y divide-border/60">
                  <div className="flex items-center justify-between px-4 py-2">
                    <span className="text-xs text-muted-foreground">{t("settle.per-mech-hint", lang)}</span>
                    <Button size="sm" variant="outline" onClick={() => setRulesFor({ userId: f.id, name: f.name, commissionType: f.commissionRules?.commissionType ?? "per_job", commissionValue: String((f.commissionRules?.commissionValue ?? orgCommissionValue) / 100), addonBonus: String((f.commissionRules?.addonBonusSen ?? 0) / 100) })}>{t("settle.mech-rules", lang)}</Button>
                  </div>
                  {f.daily.map((b) => {
                    const k = key(f.id, b.date);
                    const paid = b.payoutStatus === "PAID";
                    const partial = b.payoutStatus === "PARTIAL";
                    const dayOpen = openDay === k;
                    return (
                      <div key={k} className={paid ? "opacity-60" : ""}>
                        <div className="flex items-center gap-3 px-4 py-2.5">
                          <button type="button" onClick={() => toggle(k)} aria-label={t("foreman.select", lang)} className="shrink-0">{selected.has(k) ? <CheckSquare className="h-5 w-5 text-primary" /> : <Square className="h-5 w-5 text-muted-foreground/50" />}</button>
                          <button type="button" onClick={() => setOpenDay(dayOpen ? null : k)} className="flex min-w-0 flex-1 items-center gap-3 text-left">
                            <div className="min-w-0 flex-1">
                              <div className="text-sm font-medium">{fmtDate(b.date)} · {b.jobs} job{b.jobs > 1 ? "s" : ""}</div>
                              <div className="text-[11px] text-muted-foreground">{t("payout.commission", lang)} {formatRM(b.commissionSen)} · {t("payout.addon-short", lang)} {formatRM(b.addonBonusSen)} · {t("payout.bonus", lang)} {formatRM(b.bonusSen)}</div>
                            </div>
                            <div className="text-right">
                              <div className={"text-sm font-bold tabular-nums " + (paid ? "" : "text-primary")}>{formatRM(b.totalSen)}</div>
                              {partial && <div className="text-[10px] text-amber-600 dark:text-amber-400">{t("inv.remaining", lang)} {formatRM(b.totalSen - b.paidSen)}</div>}
                            </div>
                            <ChevronDown className={"h-3.5 w-3.5 text-muted-foreground transition-transform " + (dayOpen ? "rotate-180" : "")} />
                          </button>
                          <span className={"shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold " + (paid ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300" : b.payoutStatus === "MECHANIC_APPROVED" ? "bg-blue-100 text-blue-700 dark:bg-blue-950/60 dark:text-blue-300" : partial ? "bg-amber-100 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300" : "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300")}>{paid ? t("payout.paid", lang) : b.payoutStatus === "MECHANIC_APPROVED" ? "MECHANIC OK" : partial ? t("payout.partial", lang) : t("payout.unpaid", lang)}</span>
                          {!paid && b.payoutStatus === "MECHANIC_APPROVED" && b.payoutId && <Button size="sm" className="shrink-0" onClick={() => setAgreeFor({ payoutId: b.payoutId!, name: f.name, totalSen: b.totalSen })}>{t("payout.agree-pay", lang)}</Button>}
                          {!paid && b.payoutStatus !== "MECHANIC_APPROVED" && (
                            <Button size="sm" variant="outline" className="shrink-0" onClick={() => { setPayFor({ userId: f.id, name: f.name, date: b.date, baseSen: b.baseSen, commissionSen: b.commissionSen, addonBonusSen: b.addonBonusSen, totalSen: b.totalSen, paidSen: b.paidSen }); setAmount(String((b.totalSen - b.paidSen) / 100)); setMethod("CASH"); }}>{t("payout.pay", lang)}</Button>
                          )}
                        </div>
                        {dayOpen && (
                          <div className="mx-4 mb-2.5 rounded-xl bg-muted/40 p-2.5">
                            <div className="mb-1.5 flex items-center justify-between px-2 text-[11px] font-semibold text-muted-foreground">
                              <span>{t("payout.total", lang)}</span>
                              <span className="flex items-center gap-4">
                                <span className="inline-flex items-center gap-1">{t("payout.bonus", lang)} <Input inputMode="decimal" placeholder="0" value={bonusBuf[k] ?? ""} onChange={(e) => setBonusBuf((p) => ({ ...p, [k]: e.target.value }))} onBlur={() => saveBonus(f.id, b.date, b.commissionSen, b.addonBonusSen)} className="h-7 w-20 rounded-md border bg-background px-1.5 text-right text-xs tabular-nums" /></span>
                              </span>
                            </div>
                            {b.jobsList.length === 0 && <p className="text-[11px] text-muted-foreground px-1">{t("payout.no-jobs", lang)}</p>}
                            {b.jobsList.map((j) => (
                              <div key={j.jobId} className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-[11px] hover:bg-muted/70">
                                <Link href={"/workshop/jobs/" + j.jobId} className="flex items-center gap-2 flex-1 min-w-0"><span className="font-mono font-semibold text-primary">{j.jobNumber}</span><span className="font-medium">{j.plate}</span><span className="text-muted-foreground truncate">{j.customer}</span><span className="ml-auto font-bold tabular-nums">{formatRM(j.salesSen)}</span></Link>
                                <span className="text-muted-foreground">{t("settle.job-comm", lang)}</span>
                                <Input inputMode="decimal" placeholder="10" value={jobComm[j.jobId] ?? ""} onChange={(e) => setJobComm((p) => ({ ...p, [j.jobId]: e.target.value }))} onBlur={() => saveJobComm(j.jobId)} className="h-7 w-20 rounded-md border bg-background px-1.5 text-right text-xs tabular-nums" />
                                <span className="w-16 text-right tabular-nums font-semibold">{formatRM(j.commissionSen ?? 1000)}</span>
                                <span className="text-muted-foreground">{t("settle.job-bonus", lang)}</span>
                                <Input inputMode="decimal" placeholder="0" value={jobBonus[j.jobId] ?? ""} onChange={(e) => setJobBonus((p) => ({ ...p, [j.jobId]: e.target.value }))} onBlur={() => saveJobBonus(j.jobId)} className="h-7 w-20 rounded-md border bg-background px-1.5 text-right text-xs tabular-nums" />
                                <span className="w-16 text-right tabular-nums font-semibold text-emerald-600 dark:text-emerald-400">{formatRM(j.bonusSen)}</span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* per-mechanic commission rules dialog */}
      <Dialog open={!!rulesFor} onOpenChange={(o) => !o && setRulesFor(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>{t("settle.mech-rules", lang)} · {rulesFor?.name}</DialogTitle><DialogDescription>{t("settle.per-mech-hint", lang)}</DialogDescription></DialogHeader>
          {rulesFor && (
            <div className="space-y-3 py-2">
              <div className="grid grid-cols-2 gap-3">
                <div><Label>{t("settle.commission-type", lang)}</Label><select value={rulesFor.commissionType} onChange={(e) => setRulesFor({ ...rulesFor, commissionType: e.target.value })} className="mt-1.5 h-10 w-full rounded-lg border bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring"><option value="per_job">{t("settle.comm-per-job", lang)}</option><option value="percent_sales">{t("settle.comm-percent", lang)}</option><option value="flat">{t("settle.comm-flat", lang)}</option></select></div>
                <div><Label>{rulesFor.commissionType === "percent_sales" ? t("settle.commission-value", lang) + " (%)" : t("settle.commission-value", lang) + " (RM)"}</Label><Input inputMode="decimal" value={rulesFor.commissionValue} onChange={(e) => setRulesFor({ ...rulesFor, commissionValue: e.target.value })} className="mt-1.5" /></div>
              </div>
              <div><Label>{t("settle.addon-bonus", lang)}</Label><Input inputMode="decimal" value={rulesFor.addonBonus} onChange={(e) => setRulesFor({ ...rulesFor, addonBonus: e.target.value })} className="mt-1.5" /></div>
              <Button className="w-full" disabled={pending} onClick={saveRules}>{t("settle.save-mech", lang)}</Button>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={!!payFor} onOpenChange={(o) => !o && setPayFor(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>{t("payout.pay", lang)} · {payFor?.name} · {payFor ? fmtDate(payFor.date) : ""}</DialogTitle><DialogDescription>{t("payout.total", lang)} {payFor ? formatRM(payFor.totalSen) : ""}{payFor && payFor.paidSen > 0 ? " · " + t("inv.remaining", lang) + " " + formatRM(payFor.totalSen - payFor.paidSen) : ""}</DialogDescription></DialogHeader>
          <div className="space-y-3 py-2">
            <div><Label>{t("payout.amount", lang)}</Label><Input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} className="mt-1.5" /></div>
            <div><Label>{t("payout.method", lang)}</Label><select value={method} onChange={(e) => setMethod(e.target.value)} className="mt-1.5 h-10 w-full rounded-lg border bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring">{METHODS.map((m) => <option key={m} value={m}>{m}</option>)}</select></div>
            <Button className="w-full" disabled={pending || parseFloat(amount || "0") <= 0} onClick={payOne}>{t("payout.confirm", lang)}</Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={!!agreeFor} onOpenChange={(o) => !o && setAgreeFor(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Agree & pay salary · {agreeFor?.name}</DialogTitle><DialogDescription>Mechanic has approved — confirm to release {agreeFor ? formatRM(agreeFor.totalSen) : ""}</DialogDescription></DialogHeader>
          <div className="space-y-3 py-2">
            <div><Label>{t("payout.method", lang)}</Label><div className="mt-1.5 grid grid-cols-2 gap-2">{["CASH", "QR"].map((m) => (<button key={m} type="button" onClick={() => setAgreeMethod(m)} className={"rounded-xl border px-3 py-2.5 text-sm font-semibold transition-colors " + (agreeMethod === m ? "border-primary bg-primary text-primary-foreground" : "bg-card hover:bg-accent")}>{m === "CASH" ? "💵 " + t("payout.cash", lang) : "📱 QR"}</button>))}</div></div>
            <Button className="w-full" disabled={pending} onClick={doAgree}>Confirm — release salary</Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}