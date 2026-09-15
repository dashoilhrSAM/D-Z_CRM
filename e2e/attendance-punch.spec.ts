import { expect, test, type Page } from "@playwright/test";
import { BASE_URL, dismissGuide, settle, setPersona } from "./helpers";

/**
 * 考勤打卡（HRM P1）——真拍照、真定位、真落库。
 *
 * 刻意不用假桩：
 *  · 摄像头：Chromium 的 --use-fake-device-for-media-stream（见 playwright.config.ts）。
 *    没有它，打卡弹窗只会停在"正在启动摄像头"，测的等于空壳。
 *  · 定位：context 直接授予 geolocation 权限并给一个吉隆坡坐标。
 *
 * 断言对应六件真实的事：
 *  1. 打卡能成，并**留下一张能从鉴权路由读到的照片**（照片真的存进去了）。
 *  2. 那串照片在**公开出口**上取不到 —— "员工自拍不外泄"唯一可证伪的检查。
 *  3. 服务端会拒绝重复上班卡（旧实现用 upsert，会把早上那次的时间覆盖掉）。
 *  4. 下班卡也能打（状态机是双向的，不是只进不出）。
 *  5. **地点直接显示在行上**（距门店多少米）——不用悬停就能看到，老板要的是扫一眼。
 *  6. 点证据条打开**详情弹窗**（照片 + 时间 + 地点），右上角 X 关得掉。
 */

/** 页面上的证据条（点开是详情弹窗）。 */
const chip = (page: Page) => page.locator('[data-testid^="punch-chip-"]');

/** 走一遍打卡弹窗：打开 → 等摄像头 ready → 提交 → 等弹窗关闭。 */
async function punch(page: Page, kind: "IN" | "OUT") {
  await page.getByTestId(kind === "IN" ? "attendance-check-in" : "attendance-check-out").click();
  await expect(page.getByTestId("attendance-camera")).toBeVisible();
  const submit = page.getByTestId("attendance-submit");
  await expect(submit, "合成摄像头就该让按钮可用；一直不可用说明 getUserMedia 没跑通").toBeEnabled({ timeout: 20_000 });
  await submit.click();
  await expect(page.getByTestId("attendance-camera")).toBeHidden({ timeout: 20_000 });
  await settle(page);
}

// 打卡点与门店坐标取同一个位置，后面那条用例才能断言"判定为在店内"。
const SHOP = { latitude: 3.139, longitude: 101.6869 };

test.describe("attendance: photo + location punch", () => {
  /**
   * 先由 OWNER 把门店坐标填进去（走真实的设置界面，不是直接改库）。
   * 没有坐标时所有打卡都是 NO_GEOFENCE（配置缺口），
   * 所以"在店内算通过""在店外算越界"这两条判定在浏览器里就永远测不到——这条补上。
   */
  test("owner sets the branch coordinates in settings", async ({ browser }) => {
    const context = await browser.newContext();
    await setPersona(context, "OWNER");
    const page = await context.newPage();
    await page.goto(BASE_URL + "/workshop/settings");
    await dismissGuide(page);

    // 政策面板要真的渲染出来（这几个开关决定判定结果）
    await expect(page.getByTestId("attendance-policy")).toBeVisible();

    await page.getByTestId("branch-edit").first().click();
    await page.getByTestId("branch-latitude").fill(String(SHOP.latitude));
    await page.getByTestId("branch-longitude").fill(String(SHOP.longitude));
    // 用带 testid 的保存按钮：页面上还有组织资料表单的 Save，取 first() 会存错东西
    await page.getByTestId("branch-save").click();
    await settle(page);
    await page.reload();
    await dismissGuide(page);

    await expect(page.getByTestId("branch-edit").first()).toBeVisible();
    await page.getByTestId("branch-edit").first().click();
    await expect(page.getByTestId("branch-latitude"), "坐标必须真的存下来了").toHaveValue(String(SHOP.latitude));
    await context.close();
  });

  test("counter staff punches in with evidence, and the photo is not public", async ({ browser }) => {
    const context = await browser.newContext({
      permissions: ["geolocation"],
      geolocation: SHOP,
    });
    await setPersona(context, "COUNTER_STAFF");
    const page = await context.newPage();

    await page.goto(BASE_URL + "/workshop/attendance");
    await dismissGuide(page);
    await expect(page.getByRole("heading", { name: /attendance/i }).first()).toBeVisible();

    // 0) 幂等：上一轮若留下"在岗"状态，先下班——测试自己收拾自己的摊子，
    //    否则重跑（CI retries）会在第一步就撞上"已经上班了"。
    if (await page.getByTestId("attendance-check-out").count()) await punch(page, "OUT");

    const evidence = chip(page);
    const before = await evidence.count();

    // 1) 上班打卡：摄像头 ready + 定位到手 + 提交成功
    await page.getByTestId("attendance-check-in").click();
    await expect(page.getByTestId("attendance-camera")).toBeVisible();
    const submit = page.getByTestId("attendance-submit");
    await expect(submit).toBeEnabled({ timeout: 20_000 });
    await expect(page.getByTestId("attendance-geo"), "已授予定位权限，这里必须是拿到了坐标").toContainText(/Location captured/i, { timeout: 20_000 });
    await submit.click();
    await expect(page.getByTestId("attendance-camera")).toBeHidden({ timeout: 20_000 });
    await settle(page);

    // 打卡后按钮应该翻面成"下班卡"——状态机真的往前走了
    await expect(page.getByTestId("attendance-check-out")).toBeVisible({ timeout: 20_000 });
    await expect(evidence.first()).toBeVisible({ timeout: 20_000 });
    expect(await evidence.count(), "一笔打卡应产生一条可点开的证据").toBe(before + 1);

    // 5) 地点必须**显示在行上**（不是藏在 title 里）：门店坐标已在前一条用例里填好、
    //    打卡点就在门店上，所以这里应当算出距离而不是"未取到定位"。
    await expect(
      page.locator('[data-testid^="attendance-row-location-"]').filter({ hasText: /m from/i }).first(),
      "行上要直接显示打卡地点（距门店多少米），不能只藏在 title 里",
    ).toBeVisible({ timeout: 20_000 });

    // 2) 照片：本人能从鉴权路由读到，且不许有公开缓存
    const punchId = await evidence.last().getAttribute("data-punch-id");
    expect(punchId, "证据条要带打卡 id，弹窗与照片路由都靠它").toBeTruthy();
    const photoRes = await page.request.get(BASE_URL + "/api/attendance/photo/" + punchId);
    expect(photoRes.status(), "本人读自己的考勤照片应当 200").toBe(200);
    expect(photoRes.headers()["content-type"] ?? "", "必须真的是图片").toContain("image/");
    expect(photoRes.headers()["cache-control"] ?? "", "员工照片不许有公开缓存").toContain("no-store");

    // 3) 公开出口必须取不到私有对象（前缀一出现就该 404）
    const publicLeak = await page.request.get(BASE_URL + "/api/storage/private/attendance/probe.jpg");
    expect(publicLeak.status(), "私有对象绝不能从公开的 /api/storage 读出").toBe(404);

    // 4) 服务端拒绝重复上班卡（绕过 UI 直接打接口——UI 已经翻面，测的是服务端那条不变量）
    const dup = await page.request.post(BASE_URL + "/api/attendance/punch", {
      multipart: { kind: "IN", photo: { name: "dup.jpg", mimeType: "image/jpeg", buffer: Buffer.from("dup") } },
    });
    expect(dup.status(), "重复上班卡必须是 409").toBe(409);
    expect((await dup.json()).code).toBe("ALREADY_IN");
    await page.reload();
    await dismissGuide(page);
    await settle(page);
    expect(await chip(page).count(), "被拒的那次不该新增明细").toBe(before + 1);

    // 6) 详情弹窗：照片 + 时间 + 地点，右上角 X 必须关得掉
    await chip(page).last().click();
    const dialog = page.getByTestId("punch-detail");
    await expect(dialog, "点证据条应当弹出详情窗口").toBeVisible({ timeout: 10_000 });
    await expect(dialog.getByTestId("punch-detail-photo").locator("img")).toHaveAttribute("src", /\/api\/attendance\/photo\//);
    await expect(dialog.getByTestId("punch-detail-time"), "弹窗要有时间").not.toBeEmpty();
    await expect(dialog.getByTestId("punch-detail-location"), "弹窗要有地点").toContainText(/\d+\.\d+|no location|未取到定位/i);
    // 照片在弹窗里真的加载出来了（不是坏图标）。
    // 用 expect.poll 而不是"读一次 evaluate"：图片是异步取的，读一次必然撞上竞态——
    // 第一次就是这么红的，而照片其实好得很。
    await expect
      .poll(
        async () => dialog.getByTestId("punch-detail-photo").locator("img").evaluate((el) => (el as HTMLImageElement).naturalWidth),
        { timeout: 20_000, message: "弹窗里的照片应当真的加载成功（naturalWidth > 0）" },
      )
      .toBeGreaterThan(0);
    await page.getByTestId("punch-detail-close").click();
    await expect(dialog, "点 X 应当关闭弹窗").toBeHidden({ timeout: 10_000 });

    // 7) 下班打卡也要能打（留一个干净状态给下一次运行）
    await punch(page, "OUT");
    await expect(page.getByTestId("attendance-check-in"), "下班后按钮翻回上班卡").toBeVisible({ timeout: 20_000 });

    await context.close();
  });
});
