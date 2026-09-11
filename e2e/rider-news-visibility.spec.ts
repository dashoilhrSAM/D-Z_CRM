import { test, expect } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { BASE_URL, setPersona, settle, dismissGuide } from "./helpers";

/**
 * The reported bug, from the rider's side: a poster the workshop switched off was still
 * reaching them. The promotions page ignored the toggle, and the News feed links to it as
 * "view all", so the leak was one tap away.
 */
const db = new PrismaClient({ datasources: { db: { url: "file:./e2e.db" } } });

test("a poster switched off in the workshop is not offered to riders", async ({ page, context }) => {
  const branch = await db.branch.findFirstOrThrow({ select: { id: true } });
  const stamp = Date.now();
  const onTitle = "E2E ON-NEWS POSTER " + stamp;
  const offTitle = "E2E OFF-NEWS POSTER " + stamp;

  await db.marketingAsset.createMany({
    data: [
      { branchId: branch.id, title: onTitle, type: "POSTER", month: "2026-09", published: true },
      { branchId: branch.id, title: offTitle, type: "POSTER", month: "2026-09", published: false },
    ],
  });

  await setPersona(context, "CUSTOMER");
  await page.goto(BASE_URL + "/rider/promotions");
  await settle(page);

  // The published one proves the page is actually rendering posters — otherwise the absence of
  // the other would prove nothing.
  await expect(page.getByText(onTitle)).toBeVisible();
  await expect(page.getByText(offTitle)).toHaveCount(0);

  await db.marketingAsset.deleteMany({ where: { title: { in: [onTitle, offTitle] } } });
});

test("the home page's special offers card opens the News page", async ({ page, context }) => {
  await setPersona(context, "CUSTOMER");
  await page.goto(BASE_URL + "/rider/home");
  await settle(page);
  await dismissGuide(page); // the walkthrough tip sits over the top of the page

  // The card is a preview of the offers; tapping it opens the News page (not the promotions list).
  const offers = page.getByTestId("home-offers");
  await expect(offers).toBeVisible();
  await expect(offers).toHaveAttribute("href", "/rider/service-history");
  await offers.click();
  await expect(page).toHaveURL(/\/rider\/service-history$/);
});

test("the News feed and the promotions page agree on what is visible", async ({ page, context }) => {
  // Its own hidden poster. The seed has none, and a check over an empty list passes without
  // proving anything — which is exactly how the original leak survived review.
  const branch = await db.branch.findFirstOrThrow({ select: { id: true } });
  const hiddenTitle = "E2E HIDDEN POSTER " + Date.now();
  await db.marketingAsset.create({
    data: { branchId: branch.id, title: hiddenTitle, type: "POSTER", month: "2026-09", published: false },
  });
  await setPersona(context, "CUSTOMER");

  await page.goto(BASE_URL + "/rider/service-history");
  await settle(page);
  const newsText = await page.locator("body").innerText();

  await page.goto(BASE_URL + "/rider/promotions");
  await settle(page);
  const promosText = await page.locator("body").innerText();

  // Every unpublished poster in the database must be absent from both.
  const hidden = await db.marketingAsset.findMany({ where: { published: false }, select: { title: true } });
  console.log("unpublished posters in the seed:", hidden.length);
  expect(hidden.length, "no hidden poster to check — this test would prove nothing").toBeGreaterThan(0);
  for (const h of hidden) {
    expect(newsText, "leaked into the News feed: " + h.title).not.toContain(h.title);
    expect(promosText, "leaked into the promotions page: " + h.title).not.toContain(h.title);
  }

  // And the visible one is on both, so "absent" means filtered rather than the page being empty.
  const shown = await db.marketingAsset.findFirstOrThrow({ where: { published: true, type: "POSTER" }, select: { title: true } });
  expect(promosText, "the promotions page rendered no posters at all").toContain(shown.title);

  await db.marketingAsset.deleteMany({ where: { title: hiddenTitle } });
});
