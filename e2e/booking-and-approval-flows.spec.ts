import { test, expect } from "@playwright/test";
import { BASE_URL, setPersona, bookViaRider, confirmAndCheckIn, runMechanicInspection, ahmadBookingRow, dismissGuide } from "./helpers";

/** Ahmad's booking row filtered by a status badge text. */
const ahmadRowWithStatus = (page: import("@playwright/test").Page, status: string) =>
  page.getByTestId("booking-row").filter({ hasText: "Ahmad Danial" }).filter({ hasText: status }).first();

test.describe("§75 booking & approval flows", () => {
  test("booking cancellation: rider books → workshop cancels → rider sees Cancelled", async ({ browser }) => {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await bookViaRider(page, ctx);

    await setPersona(ctx, "OWNER");
    await page.goto(BASE_URL + "/workshop/bookings");
    await dismissGuide(page);
    await ahmadBookingRow(page, "Cancel").getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(ahmadRowWithStatus(page, "Cancelled")).toBeVisible();
    await page.waitForTimeout(800); // let the action's router.refresh settle before navigating (webkit race)

    await setPersona(ctx, "CUSTOMER");
    await page.goto(BASE_URL + "/rider/bookings");
    await dismissGuide(page);
    await expect(page.getByText("Cancelled").first()).toBeVisible();
    await ctx.close();
  });

  test("booking reschedule: confirm → reschedule → status RESCHEDULED", async ({ browser }) => {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await bookViaRider(page, ctx);

    await setPersona(ctx, "OWNER");
    await page.goto(BASE_URL + "/workshop/bookings");
    await dismissGuide(page);
    await ahmadBookingRow(page, "Confirm").getByRole("button", { name: "Confirm", exact: true }).click();
    await expect(ahmadRowWithStatus(page, "Confirmed")).toBeVisible();
    await ahmadBookingRow(page, "Reschedule").getByRole("button", { name: "Reschedule", exact: true }).click();
    await expect(ahmadRowWithStatus(page, "Rescheduled")).toBeVisible();
    await ctx.close();
  });

  test("repair decline: mechanic requests RM20 → customer declines → job shows DECLINED", async ({ browser }) => {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await bookViaRider(page, ctx);
    const jobId = await confirmAndCheckIn(page, ctx);
    await runMechanicInspection(page, jobId);

    await setPersona(ctx, "CUSTOMER");
    await page.goto(BASE_URL + "/rider/approvals");
    await dismissGuide(page);
    await expect(page.getByTestId("approval-card")).toBeVisible();
    await page.getByTestId("approval-decline").click();
    await expect(page.getByTestId("approval-card")).toHaveCount(0, { timeout: 15_000 });

    await setPersona(ctx, "MECHANIC");
    await page.goto(BASE_URL + "/mechanic-app/jobs/" + jobId); // 隔离：mechanic 只能 mechanic app
    await dismissGuide(page);
    await expect(page.getByText("CUSTOMER DECLINED").first()).toBeVisible();
    await ctx.close();
  });
});
