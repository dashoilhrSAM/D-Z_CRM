import Link from "next/link";
import { notFound } from "next/navigation";
import { UserRound } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PageHeader } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { Money } from "@/components/shared/money";
import { CustomerActions } from "@/components/workshop/customer-actions";
import { customerService } from "@/modules/customers/service";
import { customerTimeline } from "@/modules/customers/timeline";
import { AttachmentUpload } from "@/components/workshop/attachment-upload";
import { db } from "@/lib/db";
import { fmtDate, fmtKM, fmtDateTime } from "@/lib/format";
import { formatRM } from "@/lib/money";
import { getLang } from "@/lib/get-lang";
import { t, tpl } from "@/lib/i18n";

export default async function CustomerPassportPage({ params }: { params: Promise<{ id: string }> }) {
  const lang = await getLang();
  const { id } = await params;
  const passport = await customerService.getPassport(id);
  if (!passport) notFound();
  const { customer, motorcycles, stats, jobs, oilHistory, tyres, messages, reminders } = passport;
  const [timeline, loyalty, consent, attachments, referralCount] = await Promise.all([
    customerTimeline(id),
    db.loyaltyAccount.findUnique({ where: { customerId: id }, include: { tier: true } }),
    db.customerConsent.findUnique({ where: { customerId: id } }),
    db.attachment.findMany({ where: { relatedType: "CUSTOMER", relatedId: id }, orderBy: { createdAt: "desc" }, take: 20 }),
    db.referral.count({ where: { referringCustomerId: id } }),
  ]);

  return (
    <div>
      <PageHeader title={customer.name} subtitle={(customer.phone ?? "") + (customer.email ? " · " + customer.email : "")} backHref="/workshop/customers" />

      {/* header card */}
      <div className="dz-panel p-5 md:p-6">
        <div className="flex flex-wrap items-start gap-6">
          <div className="flex-1 min-w-52">
            <div className="flex items-center gap-2">
              <span className="inline-flex h-7 w-7 items-center justify-center rounded-lg bg-primary/10 text-primary"><UserRound className="h-4 w-4" /></span>
              <h2 className="font-semibold">{t("rider.passport", lang)}</h2>
            </div>
            <div className="mt-3 grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="rounded-xl bg-muted/50 p-3">
                <div className="text-[11px] text-muted-foreground">{t("ws.cust.since", lang)}</div>
                <div className="mt-0.5 font-semibold">{customer.joinedAt.getFullYear()}</div>
              </div>
              <div className="rounded-xl bg-muted/50 p-3">
                <div className="text-[11px] text-muted-foreground">{t("ws.customers.col-visits", lang)}</div>
                <div className="mt-0.5 font-semibold tabular-nums">{stats.visits}</div>
              </div>
              <div className="rounded-xl bg-muted/50 p-3">
                <div className="text-[11px] text-muted-foreground">{t("ws.customers.col-lifetime-spend", lang)}</div>
                <div className="mt-0.5 font-semibold tabular-nums"><Money sen={stats.lifetimeSpend} /></div>
              </div>
              <div className="rounded-xl bg-muted/50 p-3">
                <div className="text-[11px] text-muted-foreground">{t("rider.last-service", lang)}</div>
                <div className="mt-0.5 font-semibold">{stats.lastServiceLabel}</div>
              </div>
            </div>
            {(loyalty || customer.tags || consent || referralCount > 0) && (
              <div className="mt-4 flex flex-wrap gap-2 text-xs border-t pt-3">
                {loyalty && (
                  <span className="rounded-full bg-primary/10 text-primary px-2.5 py-1 font-medium">
                    {loyalty.tier?.name ?? t("ws.cust.member", lang)} · {loyalty.pointsBalance} pts
                  </span>
                )}
                {referralCount > 0 && (
                  <span className="rounded-full bg-muted px-2.5 py-1">{tpl("ws.cust.referrals-made", lang, { n: referralCount })}</span>
                )}
                {customer.tags?.split(",").map((tg) => tg.trim()).filter(Boolean).map((tg) => (
                  <span key={tg} className="rounded-full bg-accent px-2.5 py-1">{tg}</span>
                ))}
                {consent && (
                  <span className={"rounded-full px-2.5 py-1 " + (consent.marketingOptIn ? "bg-emerald-500/15 text-emerald-600" : "bg-muted text-muted-foreground")}>
                    {t(consent.marketingOptIn ? "ws.cust.mkt-optin" : "ws.cust.mkt-optout", lang)} · {tpl("ws.cust.prefers", lang, { channel: consent.communicationPreference.toLowerCase() })}
                  </span>
                )}
              </div>
            )}
          </div>
          <CustomerActions customerId={customer.id} motorcycleId={motorcycles[0]?.id ?? ""} nextServiceMileage={stats.nextServiceMileage} hasLogin={!!customer.authId} />
        </div>
      </div>

      {/* motorcycles */}
      <div className="mt-5 grid sm:grid-cols-2 gap-3">
        {motorcycles.map((m) => (
          <div key={m.id} className="dz-panel p-4 transition-colors hover:border-primary/30">
            <div className="flex items-center justify-between">
              <div>
                <div className="font-semibold">{m.brand} {m.model}</div>
                <div className="text-sm text-muted-foreground">{m.year} · {m.plate}{m.color ? " · " + m.color : ""}</div>
              </div>
              <div className="text-right">
                <div className="text-xs text-muted-foreground">{t("ws.jobs.col-mileage", lang)}</div>
                <div className="font-bold tabular-nums">{fmtKM(m.currentMileage)}</div>
              </div>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
              <div className="rounded-lg bg-muted/50 p-2.5">
                <div className="text-muted-foreground">{t("rider.last-service", lang)}</div>
                <div className="font-semibold mt-0.5">{m.lastServiceDate ? fmtDate(m.lastServiceDate) : "—"} {m.lastServiceMileage != null ? "· " + fmtKM(m.lastServiceMileage) : ""}</div>
              </div>
              <div className="rounded-lg bg-muted/50 p-2.5">
                <div className="text-muted-foreground">{t("rider.next-service", lang)}</div>
                <div className="font-semibold mt-0.5">{m.nextServiceMileage ? fmtKM(m.nextServiceMileage) : "—"} {m.nextServiceEstDate ? t("ws.cust.est", lang).replace("{date}", fmtDate(m.nextServiceEstDate)) : ""}</div>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* FILE-001..010: attachments */}
      <div className="mt-5 rounded-2xl border bg-card p-4">
        <div className="flex items-center justify-between mb-2">
          <h3 className="font-semibold text-sm">{t("ws.cust.attachments", lang)}</h3>
          <AttachmentUpload customerId={id} />
        </div>
        {attachments.length === 0 ? (
          <p className="text-xs text-muted-foreground">{t("ws.cust.no-attachments", lang)}</p>
        ) : (
          <ul className="space-y-1.5">
            {attachments.map((a) => (
              <li key={a.id} className="flex items-center justify-between text-xs">
                <a href={a.url} target="_blank" rel="noreferrer" className="text-primary hover:underline">{a.fileName}</a>
                <span className="text-muted-foreground/60">{a.mimeType ?? ""} · {a.sizeBytes ? Math.round(a.sizeBytes / 1024) + " KB" : ""}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* tabs */}
      <Tabs defaultValue="overview" className="mt-6">
        <TabsList className="flex-wrap h-auto">
          <TabsTrigger value="overview">{t("ws.cust.tab-overview", lang)}</TabsTrigger>
          <TabsTrigger value="history">{t("rider.service-history", lang)}</TabsTrigger>
          <TabsTrigger value="oil">{t("ws.cust.tab-oil", lang)}</TabsTrigger>
          <TabsTrigger value="tyres">{t("ws.cust.tab-tyres", lang)}</TabsTrigger>
          <TabsTrigger value="spending">{t("ws.cust.tab-spending", lang)}</TabsTrigger>
          <TabsTrigger value="messages">{t("rider.messages", lang)}</TabsTrigger>
          <TabsTrigger value="notes">{t("ws.cust.tab-notes", lang)}</TabsTrigger>
          <TabsTrigger value="timeline">{t("ws.cust.tab-timeline", lang)}</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="mt-4">
          <div className="rounded-2xl border bg-card p-5">
            <h3 className="font-semibold mb-3">{t("ws.cust.summary-title", lang)}</h3>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm">
              <div><div className="text-xs text-muted-foreground">{t("rider.last-service", lang)}</div><div className="font-semibold mt-0.5">{stats.lastServiceLabel}</div></div>
              <div><div className="text-xs text-muted-foreground">{t("ws.cust.last-mileage", lang)}</div><div className="font-semibold mt-0.5">{fmtKM(stats.lastServiceMileage)}</div></div>
              <div><div className="text-xs text-muted-foreground">{t("rider.next-service", lang)}</div><div className="font-semibold mt-0.5">{fmtKM(stats.nextServiceMileage)}</div></div>
              <div><div className="text-xs text-muted-foreground">{t("ws.cust.estimated", lang)}</div><div className="font-semibold mt-0.5">{stats.nextServiceEstDate ? fmtDate(stats.nextServiceEstDate) : "—"}</div></div>
            </div>
            {reminders.length > 0 && (
              <div className="mt-4 border-t pt-4">
                <h4 className="text-sm font-semibold mb-2">{t("ws.cust.reminders", lang)}</h4>
                <div className="space-y-2">
                  {reminders.filter((r) => !r.closedAt).map((r) => (
                    <div key={r.id} className="flex items-center justify-between text-sm">
                      <span>{r.lastServiceMileage.toLocaleString()} km → <strong>{r.nextServiceMileage.toLocaleString()} km</strong></span>
                      <StatusBadge kind="reminder" value={r.status} />
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </TabsContent>

        <TabsContent value="history" className="mt-4">
          <div className="rounded-2xl border bg-card overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="border-b bg-muted/40 text-left text-xs text-muted-foreground">
                  <th className="px-4 py-2.5 font-medium">{t("ws.jobs.col-job", lang)}</th><th className="px-4 py-2.5 font-medium">{t("common.date", lang)}</th>
                  <th className="px-4 py-2.5 font-medium">{t("ws.jobs.col-mileage", lang)}</th><th className="px-4 py-2.5 font-medium">{t("rider.service", lang)}</th>
                  <th className="px-4 py-2.5 font-medium">{t("ws.cust.col-items", lang)}</th><th className="px-4 py-2.5 font-medium">{t("common.total", lang)}</th>
                </tr></thead>
                <tbody>
                  {jobs.map((j) => (
                    <tr key={j.id} className="border-b last:border-0">
                      <td className="px-4 py-2.5 font-mono text-xs font-semibold"><Link className="hover:text-primary" href={"/workshop/jobs/" + j.id}>{j.jobNumber}</Link></td>
                      <td className="px-4 py-2.5">{fmtDate(j.completedAt)}</td>
                      <td className="px-4 py-2.5 tabular-nums">{fmtKM(j.mileage)}</td>
                      <td className="px-4 py-2.5 font-medium">{j.packageName}</td>
                      <td className="px-4 py-2.5 text-xs text-muted-foreground max-w-52 truncate">{[...j.items, ...j.parts].join(", ")}</td>
                      <td className="px-4 py-2.5 font-semibold tabular-nums"><Money sen={j.totalSen} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </TabsContent>

        <TabsContent value="oil" className="mt-4">
          <div className="rounded-2xl border bg-card p-5">
            <h3 className="font-semibold mb-3">{t("ws.cust.oil-title", lang)}</h3>
            {oilHistory.length === 0 ? <p className="text-sm text-muted-foreground">{t("ws.cust.oil-empty", lang)}</p> : (
              <div className="space-y-2">
                {oilHistory.map((o, i) => (
                  <div key={i} className="flex justify-between text-sm border-b last:border-0 pb-2">
                    <span>{fmtDate(o.at)}</span><span className="tabular-nums">{fmtKM(o.mileage)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </TabsContent>

        <TabsContent value="tyres" className="mt-4">
          <div className="rounded-2xl border bg-card p-5">
            <h3 className="font-semibold mb-3">{t("ws.cust.tyres-title", lang)}</h3>
            {tyres.length === 0 ? <p className="text-sm text-muted-foreground">{t("ws.cust.tyres-empty", lang)}</p> : (
              <div className="space-y-2">{tyres.map((t, i) => (
                <div key={i} className="flex justify-between text-sm border-b last:border-0 pb-2"><span>{fmtDate(t.at)}</span><span className="tabular-nums">{fmtKM(t.mileage)}</span></div>
              ))}</div>
            )}
          </div>
        </TabsContent>

        <TabsContent value="spending" className="mt-4">
          <div className="rounded-2xl border bg-card p-5">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-semibold">{t("ws.cust.tab-spending", lang)}</h3>
              <div className="text-sm text-muted-foreground">{t("rider.lifetime", lang)} <strong className="text-foreground tabular-nums">{formatRM(stats.lifetimeSpend)}</strong></div>
            </div>
            <div className="space-y-2">
              {jobs.map((j) => (
                <div key={j.id} className="flex justify-between text-sm border-b last:border-0 pb-2">
                  <span>{fmtDate(j.completedAt)} · {j.jobNumber}</span>
                  <span className="tabular-nums font-medium">{formatRM(j.totalSen)}</span>
                </div>
              ))}
            </div>
          </div>
        </TabsContent>

        <TabsContent value="messages" className="mt-4">
          <div className="rounded-2xl border bg-card p-5">
            <h3 className="font-semibold mb-3">{t("ws.cust.msg-title", lang)}</h3>
            {messages.length === 0 ? <p className="text-sm text-muted-foreground">{t("ws.cust.msg-empty", lang)}</p> : (
              <div className="space-y-3">
                {messages.map((m) => (
                  <div key={m.id} className="text-sm">
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <span className="font-semibold uppercase">{m.channel}</span>·{fmtDateTime(m.createdAt)} · {m.direction}
                    </div>
                    <p className="mt-0.5">{m.body}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </TabsContent>

        <TabsContent value="notes" className="mt-4">
          <div className="rounded-2xl border bg-card p-5">
            <h3 className="font-semibold mb-3">{t("ws.cust.notes-title", lang)}</h3>
            <p className="text-sm whitespace-pre-wrap">{customer.internalNotes ?? customer.notes ?? t("ws.cust.notes-empty", lang)}</p>
            {customer.notes && <p className="mt-3 text-xs text-muted-foreground border-t pt-3">{t("ws.cust.customer-note", lang).replace("{notes}", customer.notes)}</p>}
          </div>
        </TabsContent>

        <TabsContent value="timeline" className="mt-4">
          <div className="rounded-2xl border bg-card p-5">
            <h3 className="font-semibold mb-4">{t("ws.cust.timeline-title", lang)}</h3>
            {timeline.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("ws.cust.no-events", lang)}</p>
            ) : (
              <ol className="relative border-l border-border ml-2 space-y-5">
                {timeline.map((ev, i) => (
                  <li key={i} className="ml-4">
                    <span className="absolute -left-[5px] mt-1.5 h-2.5 w-2.5 rounded-full bg-primary/60" />
                    <div className="flex flex-wrap items-baseline gap-2">
                      <span className="font-medium text-sm">{ev.title}</span>
                      <span className="text-[11px] text-muted-foreground">{fmtDateTime(ev.time)}</span>
                    </div>
                    {ev.detail && <p className="text-xs text-muted-foreground mt-0.5">{ev.detail}</p>}
                    {ev.ref?.href && <Link className="text-xs text-primary hover:underline" href={ev.ref.href}>{ev.ref.label}</Link>}
                  </li>
                ))}
              </ol>
            )}
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
