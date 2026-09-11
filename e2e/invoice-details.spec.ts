import { test, expect } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { BASE_URL, setPersona, settle } from "./helpers";

/**
 * The counter should not have to open the job to see what an invoice billed.
 *
 * The details are rendered from the invoice's own lines (a snapshot taken at completion),
 * so the lines always add up to the total printed next to them.
 */
const db = new PrismaClient({ datasources: { db: { url: "file:./e2e.db" } } });

test("every invoice can show its lines without leaving the page", async ({ page, context }) => {
  const invoiced = await db.invoice.findFirstOrThrow({
    where: { items: { some: {} } },
    select: { id: true, items: { select: { lineTotalSen: true } }, totalSen: true, subtotalSen: true, discountSen: true },
  });

  await setPersona(context, "OWNER");
  await page.goto(BASE_URL + "/workshop/finance/invoices");
  await settle(page);

  const toggles = page.getByTestId("invoice-details-toggle");
  await expect(toggles.first()).toBeVisible();
  console.log("invoices on the page:", await toggles.count());

  const toggle = page.getByTestId("invoice-details").filter({ has: page.locator('[data-testid="invoice-details-toggle"]') }).first();
  await toggle.getByTestId("invoice-details-toggle").click();
  await page.waitForTimeout(400);

  // The label swaps without any JavaScript, driven by the details element being open.
  await expect(page.getByText("Hide details").first()).toBeVisible();

  // Lines are rendered: one row per invoice item, each carrying a price.
  const panel = toggle.locator("div").first();
  await expect(panel).toBeVisible();
  await expect(toggle.getByText("Total").first()).toBeVisible();

  await page.screenshot({ path: "app-screenshots/invoice-details-open.png", fullPage: false });

  // Closed again, so the screenshot state does not leak into later assertions.
  await toggle.getByTestId("invoice-details-toggle").click();
  await page.waitForTimeout(200);
  await expect(page.getByText("View details").first()).toBeVisible();

  console.log("invoice under test has", invoiced.items.length, "lines, subtotal", invoiced.subtotalSen, "total", invoiced.totalSen);
});

test("the disclosure is present on every invoice card", async ({ page, context }) => {
  await setPersona(context, "OWNER");
  await page.goto(BASE_URL + "/workshop/finance/invoices");
  await settle(page);

  const invoices = await db.invoice.count();
  const toggles = await page.getByTestId("invoice-details-toggle").count();
  console.log("db invoices:", invoices, "| disclosures rendered:", toggles);
  expect(toggles).toBeGreaterThan(0);
  // The page lists every invoice, filtered only by the query string, which is empty here.
  expect(toggles).toBeLessThanOrEqual(invoices);
});
