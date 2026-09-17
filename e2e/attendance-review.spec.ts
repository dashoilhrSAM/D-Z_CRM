import { expect, test, type Page } from "@playwright/test";
import { BASE_URL, dismissGuide, settle, setPersona } from "./helpers";

/**
 * 考勤 P2：一段时间（区间报表 + CSV）与异常处置。
 *
 * 这里刻意**不**造"距离门店很远"的打卡：那要求先把门店坐标写进库，
 * 而坐标属于另一条用例的前置状态，跨 spec 依赖会让失败原因难以定位。
 * 改为**不给定位权限** —— 拿不到定位时 decideVerdict 先返回 NO_LOCATION（与门店配没配坐标无关），
 * 它是一个"要人看"的异常，正好是队列要处理的东西。
 *
 * 三条真实的事：
 *  1. 异常会**进队列**，不是一个没人能清掉的数字；
 *  2. 处置后队列清空，但**异常数不变** —— 原始记录与当日汇总都没有被改写；
 *  3. 导出带走的是全员行踪：界面藏了按钮不算门禁，**直接打接口也必须 403**。
 */

const chip = (page: Page) => page.locator('[data-testid^="punch-chip-"]');

/** 走一遍打卡弹窗（与 attendance-punch.spec.ts 同一套交互）。 */
async function punch(page: Page, kind: "IN" | "OUT") {
  await page.getByTestId(kind === "IN" ? "attendance-check-in" : "attendance-check-out").click();
  await expect(page.getByTestId("attendance-camera")).toBeVisible();
  const submit = page.getByTestId("attendance-submit");
  await expect(submit, "合成摄像头就该让按钮可用").toBeEnabled({ timeout: 20_000 });
  await submit.click();
  await expect(page.getByTestId("attendance-camera")).toBeHidden({ timeout: 20_000 });
  await settle(page);
}

/** 幂等开场：上一轮若留下"在岗"，先下班把它收干净（否则重跑会撞 ALREADY_IN）。 */
async function cleanState(page: Page) {
  if (await page.getByTestId("attendance-check-out").count()) await punch(page, "OUT");
}

test.describe("attendance P2: range report + flag review", () => {
  test("a punch without location lands in the review queue", async ({ browser }) => {
    // 注意：**不**授予 geolocation —— 这正是要测的那条路径
    const context = await browser.newContext();
    await setPersona(context, "OWNER");
    const page = await context.newPage();
    await page.goto(BASE_URL + "/workshop/attendance");
    await dismissGuide(page);
    await cleanState(page);

    await punch(page, "IN");

    // 1) 这一笔被标成异常，并且**出现在队列里**
    await expect(page.getByTestId("attendance-kpi-pending"), "待处置应当是 1").toHaveText("1", { timeout: 20_000 });
    const queue = page.getByTestId("attendance-review-queue");
    await expect(queue).toBeVisible();
    await expect(page.locator('[data-testid^="review-item-"]')).toHaveCount(1);
    await expect(page.locator('[data-testid^="review-item-"]').first(), "队列里要说清楚是哪一条判定").toContainText(
      /no location|未取到定位|tiada lokasi/i,
    );

    // 2) 队列是**全时段的工作队列**，不跟着上面的区间走。
    //    选一段不含今天的区间，这条异常必须还在（否则上周留下的异常永远没人看得见），
    //    并且被明确标成"区间外"——不然会被误读成"这段时间的异常"。
    const past = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);
    await page.goto(BASE_URL + "/workshop/attendance?preset=custom&from=" + past + "&to=" + past);
    await dismissGuide(page);
    await expect(page.locator('[data-testid^="review-item-"]'), "队列不该被所选区间过滤掉").toHaveCount(1, {
      timeout: 20_000,
    });
    await expect(page.locator('[data-testid^="review-outside-"]').first(), "不在区间内的项必须标出来").toBeVisible();
    await expect(page.getByTestId("attendance-kpi-pending"), "待处置是工作队列的量，与区间无关").toHaveText("1");

    await context.close();
  });

  test("a decision clears the queue but never rewrites the record", async ({ browser }) => {
    const context = await browser.newContext();
    await setPersona(context, "OWNER");
    const page = await context.newPage();
    await page.goto(BASE_URL + "/workshop/attendance");
    await dismissGuide(page);

    // 前提：上一条用例留下的那笔还在队列里（同文件内按顺序执行）
    const item = page.locator('[data-testid^="review-item-"]').first();
    await expect(item, "队列里应当还有上一条用例造出来的异常").toBeVisible({ timeout: 20_000 });
    const punchId = (await item.getAttribute("data-testid"))!.replace("review-item-", "");

    const exceptionsBefore = await page.getByTestId("attendance-kpi-exceptions").textContent();
    // 备注是可选的，但它是"为什么这么判"的唯一载体，必须能写进去
    await page.getByTestId("review-note-" + punchId).fill("Indoor — no GPS fix");
    await page.getByTestId("review-confirm-" + punchId).click();

    // 2) 队列清空、待处置归零
    await expect(page.getByTestId("attendance-queue-empty")).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId("attendance-kpi-pending")).toHaveText("0");

    // 3) **异常数不变**：处置是"人的看法"，不是改写事实。这条是 P2 的核心不变量。
    await expect(page.getByTestId("attendance-kpi-exceptions"), "处置不能抹掉异常记录").toHaveText(exceptionsBefore ?? "1");

    // 证据条上留下处置标记
    await expect(page.getByTestId("punch-review-" + punchId).first(), "处置结果要能在这笔打卡上看到").toBeVisible();

    // 4) 刷新后仍然是已处置（真的落库了，不是只是本地状态）
    await page.reload();
    await dismissGuide(page);
    await expect(page.getByTestId("attendance-queue-empty")).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId("attendance-kpi-pending")).toHaveText("0");
    await expect(page.getByTestId("punch-review-" + punchId).first()).toBeVisible();

    // 收拾：把这一轮的下班卡也打掉，并处置它，留给下一条用例一个干净前提
    await punch(page, "OUT");
    const next = page.locator('[data-testid^="review-item-"]').first();
    await expect(next).toBeVisible({ timeout: 20_000 });
    const nextId = (await next.getAttribute("data-testid"))!.replace("review-item-", "");
    await page.getByTestId("review-dismiss-" + nextId).click();
    await expect(page.getByTestId("attendance-queue-empty")).toBeVisible({ timeout: 20_000 });

    await context.close();
  });

  test("counter staff can see the queue but not decide", async ({ browser }) => {
    const context = await browser.newContext();
    await setPersona(context, "COUNTER_STAFF");
    const page = await context.newPage();
    await page.goto(BASE_URL + "/workshop/attendance");
    await dismissGuide(page);

    // 权限是 ATTENDANCE:view vs :edit —— 柜台能看这条队列，但没有判断按钮
    await expect(page.getByTestId("attendance-review-queue")).toBeVisible({ timeout: 20_000 });
    await expect(page.locator('[data-testid^="review-confirm-"]'), "柜台不该有处置按钮").toHaveCount(0);
    await expect(page.locator('[data-testid^="review-dismiss-"]')).toHaveCount(0);
    await expect(page.getByTestId("attendance-export"), "导出是带走全员行踪，柜台没有这个权限").toHaveCount(0);

    // 界面藏了按钮不等于门禁：直接打接口必须被拒
    const res = await page.request.get(BASE_URL + "/api/attendance/export?preset=month");
    expect(res.status(), "没有 export 权限的人直接请求导出必须 403").toBe(403);

    await context.close();
  });

  test("the month range reports staff-days, and the owner can export a private CSV", async ({ browser }) => {
    const context = await browser.newContext();
    await setPersona(context, "OWNER");
    const page = await context.newPage();
    await page.goto(BASE_URL + "/workshop/attendance");
    await dismissGuide(page);

    // 切到本月：区间走 URL，所以刷新后不该跳回"今天"
    await page.getByTestId("attendance-preset-month").click();
    await expect(page).toHaveURL(/preset=month/);
    await settle(page);

    const mine = page.locator('[data-testid^="attendance-row-"]').filter({ hasText: "Daniel Tan" }).first();
    await expect(mine, "报表里要有本人这一行").toBeVisible({ timeout: 20_000 });
    await expect(mine.locator('[data-testid^="attendance-summary-"]'), "行上要给出这段时间的出勤天与工时").toContainText(/\d+/, {
      timeout: 20_000,
    });
    await page.reload();
    await dismissGuide(page);
    await expect(page.getByTestId("attendance-preset-month"), "区间存在 URL 里，刷新不该跳回今天").toHaveAttribute("class", /bg-primary/);

    const exportLink = page.getByTestId("attendance-export");
    await expect(exportLink).toBeVisible();
    const href = await exportLink.getAttribute("href");
    expect(href, "导出要带上当前区间").toMatch(/from=\d{4}-\d{2}-\d{2}&to=\d{4}-\d{2}-\d{2}/);

    const res = await page.request.get(BASE_URL + href!);
    expect(res.status()).toBe(200);
    expect(res.headers()["content-type"] ?? "").toContain("text/csv");
    expect(res.headers()["cache-control"] ?? "", "报表含姓名与行踪，不许有公开缓存").toContain("no-store");
    const body = await res.text();
    expect(body, "第一行是表头").toContain("staff,role,branch,date,first_in,last_out,worked_minutes");
    expect(body, "要有本人的实际记录").toContain("Daniel Tan");
    // 时间是按组织时区渲染的 HH:MM，不是 ISO 串
    expect(body).toMatch(/,\d{2}:\d{2},/);

    await context.close();
  });
});
