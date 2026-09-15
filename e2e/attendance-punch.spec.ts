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
 * 断言对应四件真实的事：
 *  1. 打卡能成，并**留下一张能从鉴权路由读到的照片**（照片真的存进去了）。
 *  2. 那串照片在**公开出口**上取不到 —— "员工自拍不外泄"唯一可证伪的检查。
 *  3. 服务端会拒绝重复上班卡（旧实现用 upsert，会把早上那次的时间覆盖掉）。
 *  4. 下班卡也能打（状态机是双向的，不是只进不出）。
 */

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

test.describe("attendance: photo + location punch", () => {
  test("counter staff punches in with evidence, and the photo is not public", async ({ browser }) => {
    const context = await browser.newContext({
      permissions: ["geolocation"],
      geolocation: { latitude: 3.139, longitude: 101.6869 },
    });
    await setPersona(context, "COUNTER_STAFF");
    const page = await context.newPage();

    await page.goto(BASE_URL + "/workshop/attendance");
    await dismissGuide(page);
    await expect(page.getByRole("heading", { name: /attendance/i }).first()).toBeVisible();

    // 0) 幂等：上一轮若留下"在岗"状态，先下班——测试自己收拾自己的摊子，
    //    否则重跑（CI retries）会在第一步就撞上"已经上班了"。
    if (await page.getByTestId("attendance-check-out").count()) await punch(page, "OUT");

    const evidence = page.locator('a[href^="/api/attendance/photo/"]');
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

    // 2) 照片：本人能从鉴权路由读到，且不许有公开缓存
    const photoHref = await evidence.last().getAttribute("href");
    const photoRes = await page.request.get(BASE_URL + photoHref);
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
    expect(await page.locator('a[href^="/api/attendance/photo/"]').count(), "被拒的那次不该新增明细").toBe(before + 1);

    // 5) 下班打卡也要能打（留一个干净状态给下一次运行）
    await punch(page, "OUT");
    await expect(page.getByTestId("attendance-check-in"), "下班后按钮翻回上班卡").toBeVisible({ timeout: 20_000 });

    await context.close();
  });
});
