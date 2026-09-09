"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Users, Wrench, UserCog } from "lucide-react";
import { cn } from "@/lib/utils";
import { StatusBadge } from "@/components/shared/status-badge";
import { fmtKM } from "@/lib/format";
import { assignMechanic } from "@/actions/workshop";
import { useLang } from "@/components/shared/language-context";
import { t } from "@/lib/i18n";

export interface BoardJob {
  id: string;
  jobNumber: string;
  status: string;
  mileage: number;
  packageName: string | null;
  pendingApprovals: number;
  mechanicId: string | null;
  quotationApproved: boolean;
  motorcycle: { brand: string; model: string; plate: string };
  customer: { name: string };
  isToday: boolean;
}

export interface MechanicSummary {
  id: string;         // "unassigned" for no mechanic
  name: string;
  jobs: BoardJob[];   // active jobs
  todayCount: number;
  approvals: number;
  ready: number;
}

export function MechanicBoard({ mechanics, initialMechanicId, ownerView, allMechanics = [] }: {
  mechanics: MechanicSummary[];
  initialMechanicId: string;
  ownerView: boolean;
  allMechanics?: { id: string; name: string; branchName?: string | null }[];
}) {
  const router = useRouter();
  const lang = useLang();
  const [pending, start] = useTransition();
  const [selected, setSelected] = useState(initialMechanicId || mechanics[0]?.id || "unassigned");
  const current = mechanics.find((m) => m.id === selected) ?? mechanics[0];

  /** Assign / re-assign a job's mechanic from the per-job dropdown (owner view). */
  const reassign = (jobId: string, mechanicId: string) =>
    start(async () => {
      await assignMechanic(jobId, mechanicId || null);
      router.refresh();
    });

  return (
    <div className="max-w-2xl mx-auto space-y-5">
      {/* mechanic switcher cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
        {mechanics.map((m) => {
          const active = m.id === current?.id;
          return (
            <button
              key={m.id}
              type="button"
              onClick={() => setSelected(m.id)}
              className={cn(
                "rounded-2xl border p-3.5 text-left transition-colors",
                active ? "border-primary bg-primary/5 ring-2 ring-primary/20" : "bg-card hover:border-primary/40"
              )}
            >
              <div className="flex items-center gap-2">
                <div className={cn("h-8 w-8 shrink-0 rounded-full flex items-center justify-center", active ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground")}>
                  <Users className="h-4 w-4" />
                </div>
                <div className="min-w-0">
                  <div className={cn("text-sm font-semibold truncate", active ? "text-primary" : "")}>{m.name}</div>
                  <div className="text-[11px] text-muted-foreground">{m.todayCount} today · {m.jobs.length} active</div>
                </div>
              </div>
              {(m.approvals > 0 || m.ready > 0) && (
                <div className="mt-2 flex gap-2 text-[10px] font-medium">
                  {m.approvals > 0 && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-amber-700 dark:text-amber-300">⏳ {m.approvals}</span>}
                  {m.ready > 0 && <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-emerald-700 dark:text-emerald-300">✓ {m.ready} ready</span>}
                </div>
              )}
            </button>
          );
        })}
      </div>

      {/* selected mechanic's summary + jobs */}
      <div className="dz-panel p-5">
        <div className="flex items-center gap-2">
          <Wrench className="h-4 w-4 text-primary" />
          <span className="font-semibold">{current?.name}</span>
          <span className="text-xs text-muted-foreground">— {current?.jobs.length} active job{(current?.jobs.length ?? 0) !== 1 ? "s" : ""}</span>
          <div className="flex-1" />
          <div className="flex gap-3 text-xs text-muted-foreground">
            <span><span className="font-semibold text-amber-600 dark:text-amber-300">{current?.approvals ?? 0}</span> approvals</span>
            <span><span className="font-semibold text-emerald-600 dark:text-emerald-300">{current?.ready ?? 0}</span> ready</span>
          </div>
        </div>
      </div>

      <div className="space-y-3">
        {(current?.jobs ?? []).map((j) => (
          <div key={j.id} className="dz-panel p-4 hover:border-primary/40 transition-colors">
            <Link href={"/workshop/mechanic/jobs/" + j.id} className="block">
              <div className="flex items-center justify-between">
                <span className="font-mono text-xs font-semibold">#{j.jobNumber}</span>
                <StatusBadge kind="job" value={j.status} />
              </div>
              <div className="mt-2 font-semibold">{j.motorcycle.brand} {j.motorcycle.model}</div>
              <div className="text-xs text-muted-foreground mt-0.5">{j.motorcycle.plate} · {j.customer.name}</div>
              <div className="mt-1.5 text-xs font-medium">{fmtKM(j.mileage)}{j.packageName ? " · " + j.packageName : ""}</div>
              {j.pendingApprovals > 0 && <div className="mt-2 text-xs font-semibold text-amber-600 dark:text-amber-300">⏳ {j.pendingApprovals} customer approval pending</div>}
              {!j.quotationApproved && <div className="mt-2 text-xs font-semibold text-primary dark:text-primary">📄 {t("ws.mech.quote-pending", lang)}</div>}
            </Link>
            {ownerView && (
              <div className="mt-3 flex items-center gap-2 border-t border-border/60 pt-2.5">
                <UserCog className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                <select
                  value={j.mechanicId ?? ""}
                  disabled={pending || !j.quotationApproved}
                  onChange={(e) => reassign(j.id, e.target.value)}
                  className="h-7 flex-1 rounded-md border bg-background px-2 text-xs outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
                  aria-label={"Assign mechanic for " + j.jobNumber}
                >
                  <option value="">{t("ws.mech.unassigned", lang)}</option>
                  {allMechanics.map((m) => (
                    <option key={m.id} value={m.id}>{m.name}{m.branchName ? " · " + m.branchName : ""}</option>
                  ))}
                </select>
              </div>
            )}
          </div>
        ))}
        {(current?.jobs.length ?? 0) === 0 && <p className="text-sm text-muted-foreground text-center py-10">No active jobs for {current?.name}.</p>}
      </div>

      {ownerView && <p className="text-center text-[11px] text-muted-foreground">Owner view — switch mechanic to see their tasks.</p>}
    </div>
  );
}
