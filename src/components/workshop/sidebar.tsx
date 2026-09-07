"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { cn } from "@/lib/utils";
import { SignOutButton } from "@/components/workshop/sign-out-button";
import { AppBrandIcon } from "@/components/shared/app-brand-icon";
import {
  LayoutDashboard, Filter, Kanban, Timer, ListTodo, Sparkles, MessageSquare, Star, Gauge, Bell, Upload,
  Plug, ShieldCheck, Users, Bike, UserCheck, BellRing, CalendarClock, Wrench, ClipboardList, ListChecks,
  Package, Store, Megaphone, Users2, Wallet, Clock, Boxes, AlertTriangle, Archive, RefreshCw,
  ShoppingCart, Truck, Settings, type LucideIcon,
} from "lucide-react";
import { navForPersona, type WorkshopPersona } from "@/lib/nav-registry";
import type { NavSectionData } from "@/lib/nav-perms";
import { t, type Lang } from "@/lib/i18n";

/** key → 图标（client 内部映射——server 传的导航不含组件引用）。 */
const ICONS: Record<string, LucideIcon> = {
  dashboard: LayoutDashboard, leads: Filter, pipeline: Kanban, "test-rides": Timer, tasks: ListTodo,
  automations: Sparkles, templates: MessageSquare, loyalty: Star, analytics: Gauge, notifications: Bell,
  import: Upload, integrations: Plug, "audit-logs": ShieldCheck, customers: Users, motorcycles: Bike,
  "return-list": UserCheck, reminders: BellRing, bookings: CalendarClock, jobs: Wrench, mechanic: ClipboardList,
  checklists: ListChecks, packages: Package, calendar: Store, posters: Megaphone, scripts: MessageSquare,
  reviews: Star, staff: Users2, kpi: Gauge, settlements: Wallet, attendance: Clock, products: Boxes,
  stock: Package, alerts: AlertTriangle, "dead-stock": Archive, reorder: RefreshCw, "purchase-orders": ShoppingCart,
  suppliers: Truck, profit: Wallet, ai: Sparkles, settings: Settings,
};

export interface SidebarUser {
  id: string;
  name: string;
  roleLabel: string;
  initials: string;
}

/** Map a section label (e.g. "AI CENTRE") to its i18n key. */
function sectionKey(section: string): string {
  const map: Record<string, string> = { "AI CENTRE": "sec.ai", "CUSTOMERS": "sec.customers", "WORKSHOP": "sec.workshop", "MARKETING": "sec.marketing", "STAFF": "sec.staff", "INVENTORY": "sec.inventory", "FINANCE": "sec.finance" };
  return map[section] ?? "sec." + section.toLowerCase();
}

/** Active if the pathname equals the nav href or lives under it (detail pages highlight their section). */
function isActive(pathname: string, href: string): boolean {
  if (pathname === href) return true;
  if (href === "/workshop/dashboard") return pathname === href; // exact only, avoid over-matching
  return pathname.startsWith(href + "/");
}

export function Sidebar({ persona, role, sections, user, branchLabel, lang = "en" }: { persona: WorkshopPersona; role?: string; sections?: NavSectionData[]; user?: SidebarUser | null; branchLabel?: string; lang?: Lang }) {
  const pathname = usePathname();
  const [expanded, setExpanded] = useState(false);
  // 有真实 role → 使用 server 已按权限矩阵（含 DB 覆盖）过滤的 sections；否则退回 persona 过滤
  const sectionsFinal = role ? sections ?? navForPersona(persona) : navForPersona(persona);

  if (sectionsFinal.length === 0) return null;

  return (
    <aside
      style={{ viewTransitionName: "dz-header" }}
      onMouseEnter={() => setExpanded(true)}
      onMouseLeave={() => setExpanded(false)}
      className={cn(
        "hidden lg:flex shrink-0 flex-col border-r bg-sidebar text-sidebar-foreground h-screen sticky top-0 overflow-y-auto transition-all duration-200",
        expanded ? "w-52" : "w-14"
      )}
    >
      <Link href="/workshop/dashboard" className={cn("flex items-center h-16 border-b border-sidebar-border", expanded ? "gap-2.5 px-5 mt-3 mb-4" : "gap-0 justify-center mt-3 mb-3")}>
        <div className="h-8 w-8 shrink-0 rounded-xl bg-sidebar-primary text-sidebar-primary-foreground flex items-center justify-center">
          <AppBrandIcon app="workshop" className="h-5 w-5" />
        </div>
        <div className={cn("leading-tight overflow-hidden whitespace-nowrap transition-opacity duration-200", expanded ? "opacity-100" : "opacity-0 w-0")}>
          <div className="font-bold text-sm">D&Z WORKSHOP OS</div>
          <div className="text-[10px] text-sidebar-foreground/60">{branchLabel ?? "D&Z Workshop"}</div>
        </div>
      </Link>
      {user && (
        <div className={cn("flex items-center h-16 border-b border-sidebar-border", expanded ? "gap-3 px-5 mb-4" : "gap-0 justify-center mb-3")}>
          <div className="h-9 w-9 shrink-0 rounded-full bg-sidebar-primary/20 text-sidebar-foreground flex items-center justify-center text-xs font-semibold">
            {user.initials}
          </div>
          <div className={cn("leading-tight overflow-hidden whitespace-nowrap transition-opacity duration-200 min-w-0", expanded ? "opacity-100" : "opacity-0 w-0")}>
            <div className="font-semibold text-sm truncate">{user.name}</div>
            <div className="text-[11px] text-sidebar-foreground/60 truncate">{user.roleLabel}</div>
          </div>
        </div>
      )}
      <nav className={cn("flex-1 pb-4", expanded ? "pt-0 px-3 space-y-5" : "pt-0 px-2 space-y-2")}>
        {sectionsFinal.map((group, gi) => (
          <div key={gi}>
            {group.section && expanded && <div className="px-2 mb-1.5 text-[10px] font-semibold tracking-wider text-sidebar-foreground/40">{t(sectionKey(group.section), lang)}</div>}
            <div className="space-y-0.5">
              {group.items.map((item) => {
                const active = isActive(pathname, item.href);
                const label = item.labelKey ? t(item.labelKey, lang) : item.label;
                const Icon = ICONS[item.key] ?? Wrench;
                return (
                  <Link
                    key={item.key}
                    href={item.href}
                    transitionTypes={["nav-forward"]}
                    aria-current={active ? "page" : undefined}
                    title={expanded ? undefined : item.label}
                    className={cn(
                      "relative flex items-center rounded-lg text-[13px] font-medium transition-all duration-300 ease-spring",
                      expanded ? "gap-2.5 px-2.5 py-1.5" : "gap-0 justify-center px-0 py-2",
                      active
                        ? "bg-sidebar-primary text-sidebar-primary-foreground font-semibold shadow-[0_6px_20px_-6px_oklch(0.62_0.19_45_/_0.6)]"
                        : "text-sidebar-foreground/75 hover:bg-sidebar-accent/60 hover:text-sidebar-foreground"
                    )}
                  >
                    {active && <span className={cn("absolute top-1/2 -translate-y-1/2 h-3.5 w-1 rounded-full bg-sidebar-primary-foreground/80", expanded ? "left-1" : "left-0.5")} aria-hidden />}
                    <Icon className="h-5 w-5 shrink-0" />
                    <span className={cn("truncate transition-opacity duration-200", expanded ? "opacity-100" : "opacity-0 w-0")}>{label}</span>
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </nav>
      <div className={cn("py-3 border-t border-sidebar-border space-y-1", expanded ? "px-2.5" : "px-1")}>
        <SignOutButton expanded={expanded} />
        <div className={cn("text-[11px] text-sidebar-foreground/50", expanded ? "px-2.5 text-left" : "text-center")}>
          {expanded ? "D&Z PLATFORM · v0.1" : "v0.1"}
        </div>
      </div>
    </aside>
  );
}