import { test, expect } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { BASE_URL, setPersona, settle } from "./helpers";

/**
 * The studio kept only the current run in memory, so finished work that was safely in the
 * database looked lost. These cover the three ways back to it: reopen, export, and mark as
 * posted.
 */
const db = new PrismaClient({ datasources: { db: { url: "file:./e2e.db" } } });

let scriptId = "";
const TITLE = "E2E saved content — elak clutch slip";

test.beforeAll(async () => {
  // A finished script the panel can list. Seeded rather than generated: generating calls an
  // image model, and this test is about retrieving work, not producing it.
  const branch = await db.branch.findFirstOrThrow({ select: { id: true } });
  const script = await db.contentScript.create({
    data: {
      branchId: branch.id,
      title: TITLE,
      platform: "TIKTOK",
      hook: "Clutch basah selamat?",
      body: "Guna minyak JASO MA2.",
      status: "SELECTED",
      source: "AI",
      generatedAt: new Date(),
      expandedAt: new Date(),
      posterUrl: "/api/storage/e2e-poster.png",
      expandedJson: {
        caption: "Caption utama",
        hashtags: ["#dashoil", "#servis"],
        versions: [
          { platform: "TIKTOK", caption: "CAPTION-TIKTOK-E2E" },
          { platform: "INSTAGRAM", caption: "CAPTION-IG-E2E" },
        ],
        posterScene: "workshop bench",
        posterText: { headline: "Elak Clutch Slip", sub: "JASO MA2" },
        publishNote: "Post before the long weekend",
      } as never,
    },
    select: { id: true },
  });
  scriptId = script.id;
});

test("finished content can be reopened, exported and marked as posted", async ({ page, context }) => {
  await setPersona(context, "OWNER");
  await page.goto(BASE_URL + "/workshop/marketing/content");
  await settle(page);

  // A. it is listed, and clicking it brings the finished work back
  const row = page.getByTestId("saved-" + scriptId);
  await expect(row).toBeVisible();
  await expect(row).toContainText(TITLE);
  await row.click();
  await expect(page.getByText("CAPTION-TIKTOK-E2E")).toBeVisible();
  await expect(page.getByText("CAPTION-IG-E2E")).toBeVisible();
  await expect(page.getByText("#dashoil #servis")).toBeVisible();

  // B. one export, containing the captions and the poster reference
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByTestId("studio-export").click(),
  ]);
  const name = download.suggestedFilename();
  console.log("downloaded:", name);
  expect(name).toMatch(/^dz-content-.*\.md$/);
  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const c of stream) chunks.push(c as Buffer);
  const md = Buffer.concat(chunks).toString("utf8");
  expect(md).toContain("CAPTION-TIKTOK-E2E");
  expect(md).toContain("## Hashtags");
  expect(md).toContain("Elak Clutch Slip");
  expect(md).toContain("- Status: not posted yet");

  // C. marking it posted is written to the database, not just the screen
  await page.getByTestId("studio-mark-posted").click();
  await page.waitForTimeout(1500);
  const after = await db.contentScript.findUniqueOrThrow({ where: { id: scriptId }, select: { status: true, usedAt: true } });
  console.log("after marking:", JSON.stringify(after));
  expect(after.status).toBe("USED");
  expect(after.usedAt).not.toBeNull();

  // and the list reflects it without a reload
  await expect(page.getByTestId("saved-" + scriptId)).toContainText("Posted");
});

test("a candidate that was never expanded is not offered as saved content", async ({ page, context }) => {
  const branch = await db.branch.findFirstOrThrow({ select: { id: true } });
  const candidate = await db.contentScript.create({
    data: { branchId: branch.id, title: "E2E unfinished candidate", body: "draft", status: "CANDIDATE", source: "AI", generatedAt: new Date() },
    select: { id: true },
  });

  await setPersona(context, "OWNER");
  await page.goto(BASE_URL + "/workshop/marketing/content");
  await settle(page);

  // Reopening needs something to reopen. Listing a half-finished candidate here would make
  // the panel a second, worse script bank.
  await expect(page.getByTestId("saved-" + candidate.id)).toHaveCount(0);
  await db.contentScript.delete({ where: { id: candidate.id } });
});
