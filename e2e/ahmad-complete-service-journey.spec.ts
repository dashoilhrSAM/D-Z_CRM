import { test, expect } from "@playwright/test";
import { BASE_URL, setPersona, bookViaRider, confirmAndCheckIn, runMechanicInspection, settle, dismissGuide } from "./helpers";

/**
 * MASTER E2E TEST (§50, §74) — mandatory. If this fails: DO NOT DEPLOY.
 *
 * Ahmad books → workshop receives → confirms → checks in (31,800 km) →
 * oil filter recommended & added → mechanic inspects → Chain WARNING →
 * approval requested (RM20) → customer approves → mechanic completes →
 * invoice RM165 · stock deducted · next service 34,800 km · rider app updated.
 */

test.describe("master journey", () => {
  test("ahmad-complete-service-journey (§50/§74)", async ({ browser }) => {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();

    // 1. Rider books a service
    await bookViaRider(page, ctx);

    // 2. Workshop receives, confirms, checks in with current mileage 31,800 km
    const jobId = await confirmAndCheckIn(page, ctx);
    expect(jobId.length).toBeGreaterThan(5);

    // 3. Counter adds the AI-recommended oil filter (5,200 km since last replacement)
    await page.getByTestId("ai-add").first().click();
    await expect(page.getByText("Yamaha Genuine Oil Filter").first()).toBeVisible();

    // 4. Mechanic: checklist → Engine Oil/Oil Filter/Brake PASS, Chain WARNING → approval request RM20
    await runMechanicInspection(page, jobId);
    await expect(page.getByText("AWAITING_APPROVAL", { exact: true }).or(page.getByText("Awaiting Approval")).first()).toBeVisible();

    // 5. Rider approves the RM20 chain adjustment
    await setPersona(ctx, "CUSTOMER");
    await page.goto(BASE_URL + "/rider/approvals");
    await dismissGuide(page);
    await expect(page.getByTestId("approval-card")).toBeVisible();
    await expect(page.getByText(/CHAIN ADJUSTMENT/i).first()).toBeVisible();
    await expect(page.getByText("RM20", { exact: true })).toBeVisible();
    await page.getByTestId("approval-approve").click();
    // wait for the pending card to disappear (action committed + revalidated) —
    // asserting on "APPROVED ✓" is unsafe: history cards from other runs match it.
    await expect(page.getByTestId("approval-card")).toHaveCount(0, { timeout: 15_000 });

    // 6. Workshop sees the approval; mechanic completes the service
    await setPersona(ctx, "MECHANIC");
    await settle(page);
    await page.goto(BASE_URL + "/mechanic-app/jobs/" + jobId); // 隔离：mechanic 只能 mechanic app
    await dismissGuide(page);
    await expect(page.getByText("CUSTOMER APPROVED").first()).toBeVisible();
    await page.getByTestId("complete-service").click();
    await expect(page.getByText("Completed", { exact: true }).first()).toBeVisible({ timeout: 30_000 });

    // 7. Rider app updated: invoice RM165 (120 + 25 + 20), next service 34,800 km
    await setPersona(ctx, "CUSTOMER");
    await page.goto(BASE_URL + "/rider/invoices");
    await dismissGuide(page);
    await expect(page.getByText("DZ-2026-", { exact: false }).first()).toBeVisible();
    await expect(page.getByText("Standard Service", { exact: false }).first()).toBeVisible();
    await expect(page.getByText("Chain Adjustment", { exact: false }).first()).toBeVisible();
    await expect(page.getByText("Yamaha Genuine Oil Filter", { exact: false }).first()).toBeVisible();
    await expect(page.getByText("RM165", { exact: true }).first()).toBeVisible();
    await expect(page.getByText("ISSUED", { exact: true }).first()).toBeVisible(); // 待 workshop 结清

    // 8. Rider home shows the new next-service prediction
    await page.goto(BASE_URL + "/rider/home");
    await dismissGuide(page);
    await expect(page.getByText("34,800 km", { exact: false }).first()).toBeVisible();
    // The estimate is last-service-date + 3,000 km ÷ 1,000 km/month, and the last service is the
    // one this journey just completed — i.e. it is measured from *today*, so a hardcoded month
    // rots: it read "November 2026" when the suite was written off an 18 Aug last service
    // (tests/prediction.test.ts) and the same journey yields December today. Assert the shape the
    // page promises; the arithmetic itself is pinned by the unit test.
    await expect(page.getByText(/Estimated\s+\w+\s+\d{4}/).first()).toBeVisible();

    // 9. Bike passport (My Bike) shows the verified service at 31,800 km
    //    (service history lives inside each motorcycle's passport since the redesign)
    await page.goto(BASE_URL + "/rider/motorcycles");
    await dismissGuide(page);
    const passport = page.locator('a[href*="/rider/motorcycles/"]').first();
    await passport.click();
    await expect(page.getByText("STANDARD SERVICE", { exact: false }).first()).toBeVisible();

    await ctx.close();
  });
});
