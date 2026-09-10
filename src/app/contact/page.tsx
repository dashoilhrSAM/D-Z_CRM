import { Bike, Phone, Mail, MapPin, Clock, MessageCircle, Send } from "lucide-react";
import { db } from "@/lib/db";
import { EnquiryForm } from "@/components/public/enquiry-form";
import { getLang } from "@/lib/get-lang";
import { t } from "@/lib/i18n";

export const dynamic = "force-dynamic";

export default async function ContactPage({ searchParams }: { searchParams: Promise<{ model?: string; campaign?: string }> }) {
  const lang = await getLang();
  const sp = await searchParams;
  const org = await db.organisation.findFirst();
  const branches = await db.branch.findMany({ where: { organisationId: org!.id } });
  const hours = org?.operatingHours ? (JSON.parse(org.operatingHours) as Record<string, string>) : null;
  const wa = "https://wa.me/60" + (org?.contactPhone?.replace(/\D/g, "").slice(1) ?? "123456789");

  return (
    <main className="min-h-screen bg-muted/30">
      <header className="border-b bg-background">
        <div className="mx-auto max-w-4xl px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2 font-bold text-lg">
            {org?.logo ? <img src={org.logo} className="h-8 w-8 rounded" alt="" /> : <Bike className="h-6 w-6 text-primary" />}
            {org?.name ?? "D&Z Motors"}
          </div>
          <a href={wa} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 rounded-md bg-emerald-600 text-white px-3 py-1.5 text-sm font-medium">
            <MessageCircle className="h-4 w-4" /> WhatsApp
          </a>
        </div>
      </header>

      <div className="mx-auto max-w-4xl px-4 py-6 grid md:grid-cols-2 gap-6">
        <div className="space-y-5">
          <div>
            <h1 className="text-3xl font-bold">{t("contact.title", lang)}</h1>
            <p className="text-muted-foreground mt-1">{t("contact.subtitle", lang)}</p>
          </div>
          <div className="rounded-xl border bg-card p-4 space-y-3 text-sm">
            {org?.contactPhone && <div className="flex items-center gap-2"><Phone className="h-4 w-4 text-muted-foreground" />{org.contactPhone}</div>}
            {org?.contactEmail && <div className="flex items-center gap-2"><Mail className="h-4 w-4 text-muted-foreground" />{org.contactEmail}</div>}
            {org?.address && <div className="flex items-center gap-2"><MapPin className="h-4 w-4 text-muted-foreground" />{org.address}</div>}
            {hours && (
              <div className="flex items-start gap-2"><Clock className="h-4 w-4 text-muted-foreground mt-0.5" />
                <div>
                  {Object.entries(hours).map(([d, h]) => <div key={d} className="text-xs"><span className="capitalize font-medium">{d}</span>: {h}</div>)}
                </div>
              </div>
            )}
          </div>
          <div className="rounded-xl border bg-card p-4">
            <h3 className="font-semibold text-sm mb-2">{t("contact.branches_title", lang)}</h3>
            <ul className="space-y-2 text-sm">
              {branches.map((b) => (
                <li key={b.id} className="flex items-center justify-between">
                  <span>{b.name} · {b.city}</span>
                  <span className="text-xs text-muted-foreground">{b.phone ?? "—"}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
        <EnquiryForm defaultModel={sp.model} campaignId={sp.campaign} branches={branches.map((b) => ({ id: b.id, label: b.name + " · " + b.city }))} />
      </div>
    </main>
  );
}
