// Marketing system end-to-end (P1-P5).
// Covers the surfaces the unit tests cannot: the campaign editor with its segment
// builder, the overview landing page, and the promo auto-apply switch.
import { test, expect } from "@playwright/test";
import { BASE_URL, setPersona, settle } from "./helpers";

const MARKETING_ROUTES = [
  "/workshop/marketing",
  "/workshop/marketing/calendar",
  "/workshop/marketing/posters",
  "/workshop/marketing/scripts",
  "/workshop/marketing/reviews",
];

test.describe("marketing routes", () => {
  for (const route of MARKETING_ROUTES) {
    test("renders " + route, async ({ browser }) => {
      const ctx = await browser.newContext();
      const page = await ctx.newPage();
      await setPersona(ctx, "OWNER");
      const res = await page.goto(BASE_URL + route);
      expect(res?.status()).toBe(200);
      await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible();
      await ctx.close();
    });
  }
});

test.describe("marketing overview", () => {
  test("shows the roll-up figures", async ({ browser }) => {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await setPersona(ctx, "OWNER");
    await page.goto(BASE_URL + "/workshop/marketing");
    await expect(page.locator('[data-tut="marketing-overview"]')).toBeVisible();
    // the four KPI cards link through to the calendar
    await expect(page.getByRole("link", { name: /campaigns/i }).first()).toBeVisible();
    await ctx.close();
  });
});

test.describe("campaign editor", () => {
  test("creates a campaign with the segment builder available", async ({ browser }) => {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await setPersona(ctx, "OWNER");
    await page.goto(BASE_URL + "/workshop/marketing/calendar");

    const name = "E2E Campaign " + Date.now();
    await page.getByRole("button", { name: /new campaign/i }).first().click();
    await page.locator('[data-testid="campaign-name"]').fill(name);

    // the segment builder replaced the old 5-option audience dropdown
    await expect(page.locator('[data-testid="segment-add"]')).toBeVisible();

    const start = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
    await page.locator('[data-testid="campaign-start"]').fill(start);
    await page.locator('[data-testid="campaign-submit"]').click();
    await settle(page);
    await page.reload();

    await expect(page.getByText(name)).toBeVisible();
    await ctx.close();
  });

  test("previews the audience size for a rule set", async ({ browser }) => {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await setPersona(ctx, "OWNER");
    await page.goto(BASE_URL + "/workshop/marketing/calendar");

    await page.getByRole("button", { name: /new campaign/i }).first().click();
    // no conditions yet — still counts reachable customers
    await page.locator('[data-testid="segment-preview"]').click();
    await expect(page.locator('[data-testid="segment-reach"]')).toBeVisible({ timeout: 15000 });
    await ctx.close();
  });
});

test.describe("promo auto-apply switch", () => {
  test("flips the setting and persists it", async ({ browser }) => {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await setPersona(ctx, "OWNER");
    await page.goto(BASE_URL + "/workshop/marketing/calendar");

    const toggle = page.locator('[data-testid="promo-auto-apply"]');
    await expect(toggle).toBeVisible();
    const before = await toggle.getAttribute("aria-checked");

    await toggle.click();
    await settle(page);
    await page.reload();
    const after = await page.locator('[data-testid="promo-auto-apply"]').getAttribute("aria-checked");
    expect(after).not.toBe(before);

    // restore so the run leaves the demo database as it found it
    await page.locator('[data-testid="promo-auto-apply"]').click();
    await settle(page);
    await page.reload();
    await expect(page.locator('[data-testid="promo-auto-apply"]')).toHaveAttribute("aria-checked", before!);
    await ctx.close();
  });
});
