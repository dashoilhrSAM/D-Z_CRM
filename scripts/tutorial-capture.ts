import { chromium, type Page } from "@playwright/test";
import { mkdirSync } from "fs";
const APP = process.env.APP ?? "https://d-z-crm.vercel.app";
const ACCOUNTS: Record<string, any> = {
  owner: { email: "daniel.tan@dz.my", password: "Dashoil@!789", loginPath: "/login" },
  rider: { email: "ahmad.danial@dz.my", password: "Dashoil@!789", loginPath: "/rider/login" },
  mechanic: { email: "aizat.bin.ismail@dz.my", password: "Dashoil@!789", loginPath: "/login" },
};
const ROUTES: Record<string, { path: string; name: string }[]> = {
  workshop: [
    { path: "/workshop/dashboard", name: "dashboard" },
    { path: "/workshop/bookings", name: "bookings" },
    { path: "/workshop/bookings/slots", name: "bookings-slots" },
    { path: "/workshop/jobs", name: "jobs" },
    { path: "/workshop/customers", name: "customers" },
    { path: "/workshop/motorcycles", name: "motorcycles" },
    { path: "/workshop/packages", name: "packages" },
    { path: "/workshop/analytics", name: "analytics" },
    { path: "/workshop/loyalty", name: "loyalty" },
    { path: "/workshop/pipeline", name: "pipeline" },
    { path: "/workshop/leads", name: "leads" },
    { path: "/workshop/test-rides", name: "test-rides" },
    { path: "/workshop/automations", name: "automations" },
    { path: "/workshop/tasks", name: "tasks" },
    { path: "/workshop/notifications", name: "notifications" },
    { path: "/workshop/settlements", name: "settlements" },
    { path: "/workshop/finance/profit", name: "finance-profit" },
    { path: "/workshop/staff", name: "staff" },
    { path: "/workshop/staff/kpi", name: "staff-kpi" },
    { path: "/workshop/mechanic", name: "mechanic-board" },
    { path: "/workshop/checklists", name: "checklists" },
    { path: "/workshop/attendance", name: "attendance" },
    { path: "/workshop/inventory/products", name: "inventory-products" },
    { path: "/workshop/inventory/stock", name: "inventory-stock" },
    { path: "/workshop/inventory/alerts", name: "inventory-alerts" },
    { path: "/workshop/inventory/dead-stock", name: "inventory-dead-stock" },
    { path: "/workshop/inventory/reorder", name: "inventory-reorder" },
    { path: "/workshop/inventory/purchase-orders", name: "inventory-purchase-orders" },
    { path: "/workshop/inventory/suppliers", name: "inventory-suppliers" },
    { path: "/workshop/marketing/calendar", name: "marketing-calendar" },
    { path: "/workshop/marketing/posters", name: "marketing-posters" },
    { path: "/workshop/marketing/scripts", name: "marketing-scripts" },
    { path: "/workshop/marketing/reviews", name: "marketing-reviews" },
    { path: "/workshop/messaging/templates", name: "messaging-templates" },
    { path: "/workshop/crm/reminders", name: "crm-reminders" },
    { path: "/workshop/crm/return-list", name: "crm-return-list" },
    { path: "/workshop/integrations", name: "integrations" },
    { path: "/workshop/ai", name: "ai" },
    { path: "/workshop/setup", name: "bulk-setup" },
    { path: "/workshop/settings", name: "settings" },
    { path: "/workshop/settings/developer", name: "settings-developer" },
    { path: "/workshop/settings/audit-logs", name: "settings-audit-logs" },
  ],
  rider: [
    { path: "/rider/home", name: "home" },
    { path: "/rider/book", name: "book" },
    { path: "/rider/bookings", name: "bookings" },
    { path: "/rider/motorcycles", name: "motorcycles" },
    { path: "/rider/service-history", name: "service-history" },
    { path: "/rider/service-status", name: "service-status" },
    { path: "/rider/invoices", name: "invoices" },
    { path: "/rider/promotions", name: "promotions" },
    { path: "/rider/notifications", name: "notifications" },
    { path: "/rider/profile", name: "profile" },
    { path: "/rider/settings", name: "settings" },
    { path: "/rider/approvals", name: "approvals" },
  ],
  mechanic: [
    { path: "/mechanic-app", name: "home" },
    { path: "/mechanic-app/earnings", name: "earnings" },
    { path: "/mechanic-app/profile", name: "profile" },
    { path: "/mechanic-app/settings", name: "settings" },
  ],
};
async function login(page: Page, scope: string) {
  const accKey = scope === "workshop" ? "owner" : scope;
  const acc = ACCOUNTS[accKey];
  await page.goto(APP + acc.loginPath, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1500);
  if (scope === "rider") {
    const emailTab = page.locator('button', { hasText: 'Email' }).first();
    if (await emailTab.count()) { try { await emailTab.click(); } catch {} }
    await page.waitForTimeout(600);
  }
  const emailEl = page.locator('input[type="email"]').first();
  if (await emailEl.count()) await emailEl.fill(acc.email);
  const pwd = page.locator('input[type="password"]').first();
  await pwd.fill(acc.password);
  await pwd.press("Enter");
  await page.waitForTimeout(4500);
}
async function main() {
  const scope = process.argv[2] ?? "all";
  const scopes = scope === "all" ? Object.keys(ROUTES) : [scope];
  for (const s of scopes) {
    const dir = `tutorial-screens/${s}`;
    mkdirSync(dir, { recursive: true });
    const isPhone = s !== "workshop";
    const browser = await chromium.launch();
    const ctx = await browser.newContext({ viewport: isPhone ? { width: 390, height: 844 } : { width: 1440, height: 900 }, deviceScaleFactor: 2 });
    const page = await ctx.newPage();
    try {
      await login(page, s);
      for (const route of ROUTES[s]) {
        try {
          await page.goto(APP + route.path, { waitUntil: "load" });
          for (let attempt = 0; attempt < 3; attempt++) {
            await page.waitForTimeout(2200);
            const url = page.url();
            if (!/login|signup/.test(url)) break;
            await page.goto(APP + route.path, { waitUntil: "load" });
          }
          await page.waitForTimeout(2600);
          await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
          await page.waitForTimeout(700);
          await page.evaluate(() => window.scrollTo(0, 0));
          await page.waitForTimeout(400);
          if (/login|signup/.test(page.url())) { console.log(`[${s}] SKIP(login-redirect) ${route.name}`); continue; }
          await page.screenshot({ path: `${dir}/${route.name}.png`, fullPage: true });
          console.log(`[${s}] OK ${route.name}`);
        } catch (e) { console.log(`[${s}] ERR ${route.name}: ${(e as Error).message}`); }
      }
    } finally { await browser.close(); }
  }
}
main().catch((e) => { console.error("FATAL", e); process.exit(1); });
