// Workshop navigation registry — single source of truth for department views.
// Owner: full access. Counter staff: front-desk (bookings/customers/jobs/inventory
// view/AI). Mechanic: own jobs (board/jobs/checklists/KPI). The sidebar renders
// exactly what the current persona is entitled to see.

import type { LucideIcon } from "lucide-react";
import {
  LayoutDashboard, Users, UserCheck, BellRing, CalendarClock, Wrench, ClipboardList, ListChecks, Package,
  Store, Megaphone, MessageSquare, Star, Users2, Gauge, Boxes, AlertTriangle, Archive, RefreshCw,
  ShoppingCart, Truck, Wallet, Sparkles, Settings, Filter, Kanban, Timer, ListTodo, Bike, Bell, Upload, Plug, ShieldCheck, ReceiptText, Clock,
} from "lucide-react";
// 工作台导航分组（从真实 Role 映射，生产权限模型——非 demo）。
export type WorkshopPersona = "OWNER" | "COUNTER_STAFF" | "MECHANIC" | "CUSTOMER";

export interface NavChild {
  key: string;
  label: string;
  /** i18n dictionary key (nav.*) — sidebar translates when lang != en */
  labelKey?: string;
  href: string;
  icon: LucideIcon;
  /** Personas that may see this child. Absent = all workshop personas. */
  access?: WorkshopPersona[];
  /** Permission module (permissions.ts MODULES). Role-based filtering: view allowed → visible. */
  module?: string;
}

export interface NavSection {
  section: string | null;
  items: NavChild[];
}

const WORKSHOP_PERSONAS: WorkshopPersona[] = ["OWNER", "COUNTER_STAFF", "MECHANIC"];

export function isWorkshopAccess(p: WorkshopPersona): boolean {
  return (WORKSHOP_PERSONAS as readonly string[]).includes(p);
}

export function personaSees(p: WorkshopPersona, access?: WorkshopPersona[]): boolean {
  if (access === undefined) return isWorkshopAccess(p);
  return (access as readonly string[]).includes(p);
}

export const NAV_SECTIONS: readonly NavSection[] = [
  {
    section: null,
    items: [{ key: "dashboard", label: "Dashboard", labelKey: "nav.dashboard", href: "/workshop/dashboard", icon: LayoutDashboard }],
  },
  {
    section: "SALES",
    items: [
      { key: "leads", label: "Leads", labelKey: "nav.leads", href: "/workshop/leads", icon: Filter, module: "LEADS", access: ["OWNER", "COUNTER_STAFF"] },
      { key: "pipeline", label: "Pipeline", labelKey: "nav.pipeline", href: "/workshop/pipeline", icon: Kanban, module: "PIPELINE", access: ["OWNER", "COUNTER_STAFF"] },
      { key: "test-rides", label: "Test Rides", labelKey: "nav.test-rides", href: "/workshop/test-rides", icon: Timer, module: "TEST_RIDES", access: ["OWNER", "COUNTER_STAFF"] },
    ],
  },
  {
    section: null,
    items: [{ key: "tasks", label: "Tasks", labelKey: "nav.tasks", href: "/workshop/tasks", icon: ListTodo, module: "TASKS", access: ["OWNER", "COUNTER_STAFF", "MECHANIC"] }],
  },
  {
    section: "CRM AUTOMATION",
    items: [
      { key: "automations", label: "Automations", labelKey: "nav.automations", href: "/workshop/automations", icon: Sparkles, module: "AUTOMATIONS", access: ["OWNER"] },
      { key: "templates", label: "Message Templates", labelKey: "nav.templates", href: "/workshop/messaging/templates", icon: MessageSquare, module: "MESSAGING", access: ["OWNER", "COUNTER_STAFF"] },
      { key: "loyalty", label: "Loyalty & Referrals", labelKey: "nav.loyalty", href: "/workshop/loyalty", icon: Star, module: "LOYALTY", access: ["OWNER", "COUNTER_STAFF"] },
      { key: "analytics", label: "Analytics", labelKey: "nav.analytics", href: "/workshop/analytics", icon: Gauge, module: "ANALYTICS", access: ["OWNER"] },
      { key: "notifications", label: "Notifications", labelKey: "nav.notifications", href: "/workshop/notifications", icon: Bell, access: ["OWNER", "COUNTER_STAFF", "MECHANIC"] },
      { key: "import", label: "CSV Import", labelKey: "nav.import", href: "/workshop/import", icon: Upload, access: ["OWNER"] },
      { key: "integrations", label: "Integrations", labelKey: "nav.integrations", href: "/workshop/integrations", icon: Plug, module: "INTEGRATIONS", access: ["OWNER"] },
      { key: "audit-logs", label: "Audit Logs", labelKey: "nav.audit-logs", href: "/workshop/settings/audit-logs", icon: ShieldCheck, access: ["OWNER"] },
    ],
  },
  {
    section: "CUSTOMERS",
    items: [
      { key: "customers", label: "Customers", labelKey: "nav.customers", href: "/workshop/customers", icon: Users, module: "CUSTOMERS", access: ["OWNER", "COUNTER_STAFF"] },
      { key: "motorcycles", label: "Motorcycles", labelKey: "nav.motorcycles", href: "/workshop/motorcycles", icon: Bike, module: "MOTORCYCLES", access: ["OWNER", "COUNTER_STAFF"] },
      { key: "return-list", label: "Customer Return List", labelKey: "nav.return-list", href: "/workshop/crm/return-list", icon: UserCheck, module: "CUSTOMERS", access: ["OWNER", "COUNTER_STAFF"] },
      { key: "reminders", label: "Service Reminders", labelKey: "nav.reminders", href: "/workshop/crm/reminders", icon: BellRing, module: "REMINDERS", access: ["OWNER", "COUNTER_STAFF"] },
    ],
  },
  {
    section: "WORKSHOP",
    items: [
      { key: "bookings", label: "Bookings", labelKey: "nav.bookings", href: "/workshop/bookings", icon: CalendarClock, module: "BOOKINGS", access: ["OWNER", "COUNTER_STAFF"] },
      { key: "jobs", label: "Service Jobs", labelKey: "nav.jobs", href: "/workshop/jobs", icon: Wrench, module: "JOB_CARDS", access: ["OWNER", "COUNTER_STAFF", "MECHANIC"] },
      { key: "mechanic", label: "Mechanic Board", labelKey: "nav.mechanic", href: "/workshop/mechanic", icon: ClipboardList, module: "JOB_CARDS", access: ["OWNER", "MECHANIC"] },
      { key: "checklists", label: "Checklists", labelKey: "nav.checklists", href: "/workshop/checklists", icon: ListChecks, module: "JOB_CARDS", access: ["OWNER", "MECHANIC"] },
      { key: "packages", label: "Service Packages", labelKey: "nav.packages", href: "/workshop/packages", icon: Package, module: "WORKSHOP", access: ["OWNER", "COUNTER_STAFF"] },
    ],
  },
  {
    section: "MARKETING",
    items: [
      { key: "calendar", label: "Promotion Calendar", labelKey: "nav.calendar", href: "/workshop/marketing/calendar", icon: Store, module: "CAMPAIGNS", access: ["OWNER"] },
      { key: "posters", label: "Poster Library", labelKey: "nav.posters", href: "/workshop/marketing/posters", icon: Megaphone, module: "CAMPAIGNS", access: ["OWNER"] },
      { key: "scripts", label: "Reels Script Bank", labelKey: "nav.scripts", href: "/workshop/marketing/scripts", icon: MessageSquare, module: "CAMPAIGNS", access: ["OWNER"] },
      { key: "reviews", label: "Reviews", labelKey: "nav.reviews", href: "/workshop/marketing/reviews", icon: Star, module: "CAMPAIGNS", access: ["OWNER"] },
    ],
  },
  {
    section: "STAFF",
    items: [
      { key: "staff", label: "Staff", labelKey: "nav.staff", href: "/workshop/staff", icon: Users2, module: "USERS", access: ["OWNER", "MECHANIC"] },
      { key: "kpi", label: "KPI Board", labelKey: "nav.kpi", href: "/workshop/staff/kpi", icon: Gauge, module: "TECHNICIANS", access: ["OWNER", "MECHANIC"] },
      { key: "settlements", label: "Settlements", labelKey: "nav.settlements", href: "/workshop/settlements", icon: Wallet, module: "TECHNICIANS", access: ["OWNER", "MECHANIC"] },
      { key: "attendance", label: "Attendance", labelKey: "nav.attendance", href: "/workshop/attendance", icon: Clock, module: "TECHNICIANS", access: ["OWNER", "MECHANIC"] },
    ],
  },
  {
    section: "INVENTORY",
    items: [
      { key: "products", label: "Products", labelKey: "nav.products", href: "/workshop/inventory/products", icon: Boxes, module: "PARTS", access: ["OWNER", "COUNTER_STAFF"] },
      { key: "stock", label: "Stock", labelKey: "nav.stock", href: "/workshop/inventory/stock", icon: Package, module: "INVENTORY", access: ["OWNER", "COUNTER_STAFF"] },
      { key: "alerts", label: "Stock Alerts", labelKey: "nav.alerts", href: "/workshop/inventory/alerts", icon: AlertTriangle, module: "INVENTORY", access: ["OWNER"] },
      { key: "dead-stock", label: "Dead Stock", labelKey: "nav.dead-stock", href: "/workshop/inventory/dead-stock", icon: Archive, module: "INVENTORY", access: ["OWNER"] },
      { key: "reorder", label: "Reorder", labelKey: "nav.reorder", href: "/workshop/inventory/reorder", icon: RefreshCw, module: "INVENTORY", access: ["OWNER"] },
      { key: "purchase-orders", label: "Purchase Orders", labelKey: "nav.purchase-orders", href: "/workshop/inventory/purchase-orders", icon: ShoppingCart, module: "INVENTORY", access: ["OWNER"] },
      { key: "suppliers", label: "Suppliers", labelKey: "nav.suppliers", href: "/workshop/inventory/suppliers", icon: Truck, module: "INVENTORY", access: ["OWNER"] },
    ],
  },
  {
    section: "FINANCE",
    items: [
      { key: "profit", label: "Profit Dashboard", labelKey: "nav.profit", href: "/workshop/finance/profit", icon: Wallet, module: "FINANCE", access: ["OWNER"] },
      { key: "invoices", label: "Invoices", labelKey: "nav.invoices", href: "/workshop/finance/invoices", icon: ReceiptText, module: "FINANCE", access: ["OWNER"] },
    ],
  },
  {
    section: "AI CENTRE",
    items: [{ key: "ai", label: "Today's Recommendations", labelKey: "nav.ai", href: "/workshop/ai", icon: Sparkles, module: "AI", access: ["OWNER", "COUNTER_STAFF"] }],
  },
  {
    section: null,
    items: [{ key: "settings", label: "Settings", labelKey: "nav.settings", href: "/workshop/settings", icon: Settings, module: "SETTINGS", access: ["OWNER"] }],
  },
];

/** Sections the current persona is entitled to see (empty groups dropped). */
export function navForPersona(persona: WorkshopPersona): NavSection[] {
  return NAV_SECTIONS.map((g) => ({
    section: g.section,
    items: g.items.filter((i) => personaSees(persona, i.access)),
  })).filter((g) => g.items.length > 0);
}

/** 按真实角色（Role）过滤导航：module 有 view 权限才显示；无 module 标注的项退回 persona 过滤。 */
export function navForRole(role: string, persona: WorkshopPersona): NavSection[] {
  return NAV_SECTIONS.map((g) => ({
    section: g.section,
    items: g.items.filter((i) => {
      if (!personaSees(persona, i.access)) return false;
      if (!i.module) return true; // 未标注 module（如 Notifications/Import）→ persona 过滤已够
      return moduleAllowed(role, i.module);
    }),
  })).filter((g) => g.items.length > 0);
}

/** 同步的 module→view 判定（与 permissions.ts DEFAULT_MATRIX 一致，避免 server-only 依赖）。 */
export function moduleAllowed(role: string, module: string): boolean {
  const M = DEFAULT_VIEW_MATRIX as Record<string, string[] | "*">;
  const r = M[role];
  if (!r) return false;
  if (r === "*") return true;
  return (r as string[]).includes(module);
}

/** 精简视图矩阵：role → 可 view 的 module 列表（从 permissions.ts 提炼）。 */
const DEFAULT_VIEW_MATRIX: Record<string, string[] | "*"> = {
  SUPER_ADMIN: "*", OWNER: "*", HEAD_OFFICE_ADMIN: "*",
  MANAGER: "*",
  SALES_MANAGER: "*",
  SALES_ADVISOR: ["LEADS", "PIPELINE", "TEST_RIDES", "TASKS", "CUSTOMERS", "MOTORCYCLES", "DASHBOARD"],
  SERVICE_MANAGER: "*",
  SERVICE_ADVISOR: ["BOOKINGS", "WORKSHOP", "JOB_CARDS", "CUSTOMERS", "MOTORCYCLES", "REMINDERS", "DASHBOARD"],
  COUNTER_STAFF: ["DASHBOARD", "CUSTOMERS", "BOOKINGS", "JOB_CARDS", "WORKSHOP", "INVENTORY", "AI"],
  CUSTOMER_SERVICE: ["DASHBOARD", "CUSTOMERS", "BOOKINGS", "REMINDERS", "TASKS", "MESSAGING", "LOYALTY"],
  MECHANIC: ["DASHBOARD", "WORKSHOP", "JOB_CARDS", "TECHNICIANS", "INVENTORY", "PARTS"],
  PARTS_MANAGER: "*",
  INVENTORY: ["PARTS", "INVENTORY", "DASHBOARD"],
  MARKETING: ["CAMPAIGNS", "LOYALTY", "REFERRALS", "CUSTOMERS", "ANALYTICS", "AI", "DASHBOARD"],
  ACCOUNTING: ["FINANCE", "REPORTS", "ANALYTICS", "DASHBOARD"],
  AUDITOR: "*",
};

/** Flat list of accessible hrefs for a persona — used for URL-level gating. */
export function accessibleHrefs(persona: WorkshopPersona): string[] {
  return navForPersona(persona).flatMap((g) => g.items.map((i) => i.href));
}
