#!/usr/bin/env tsx
/**
 * 建私有存储桶（HRM 考勤自拍等个人数据用）。
 * ==========================================
 * 为什么要有这个脚本：代码只能决定"往哪个桶写"，**桶的可见性是控制台/API 里的设置**。
 * 如果这个桶是 public，那 Supabase 会给每个对象一个
 *   https://<ref>.supabase.co/storage/v1/object/public/<bucket>/<key>
 * 的地址——拿到 URL 的人就能看到员工的照片和打卡位置。所以：
 *   1. 建桶时显式 public: false；
 *   2. **验证**它真的不是公开的（上传一个探针对象，用公开地址去取，必须失败）；
 *   3. 删掉探针。宁可脚本停下来报错，也不要嘴上说"应该没问题"。
 *
 * 幂等：已存在就不重建，但仍然会跑一遍私密性验证。
 * 用法：pnpm exec tsx scripts/provision-private-bucket.ts [--bucket dz-private]
 */
import { createClient } from "@supabase/supabase-js";
import * as path from "node:path";

try { process.loadEnvFile(path.join(process.cwd(), ".env")); } catch {}

const arg = (name: string, fallback: string) => {
  const i = process.argv.indexOf("--" + name);
  return i >= 0 ? (process.argv[i + 1] ?? fallback) : fallback;
};

const BUCKET = arg("bucket", process.env.STORAGE_PRIVATE_BUCKET ?? "dz-private");

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error("Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY in .env");
    process.exit(1);
  }
  const host = url.replace(/^https?:\/\//, "");
  console.log("project:", host);
  const sb = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });

  // 1) 现状
  const { data: before, error: listErr } = await sb.storage.listBuckets();
  if (listErr) { console.error("listBuckets failed:", listErr.message); process.exit(1); }
  console.log("\nexisting buckets:");
  for (const b of before ?? []) console.log("  -", b.name, "public=" + b.public, b.created_at ? "" : "");

  // 2) 建（幂等）
  const existing = (before ?? []).find((b) => b.name === BUCKET);
  if (existing) {
    console.log("\nbucket already exists:", BUCKET, "public=" + existing.public);
    if (existing.public) {
      console.log("→ it is PUBLIC; switching to private");
      const { error } = await sb.storage.updateBucket(BUCKET, { public: false });
      if (error) { console.error("updateBucket failed:", error.message); process.exit(1); }
    }
  } else {
    const { error } = await sb.storage.createBucket(BUCKET, { public: false });
    if (error) { console.error("createBucket failed:", error.message); process.exit(1); }
    console.log("\ncreated bucket:", BUCKET, "(public=false)");
  }

  // 3) 读回确认
  const { data: after } = await sb.storage.listBuckets();
  const created = (after ?? []).find((b) => b.name === BUCKET);
  if (!created) { console.error("bucket missing after creation"); process.exit(1); }
  console.log("verify: bucket", BUCKET, "public=" + created.public);
  if (created.public) { console.error("bucket is still public — refusing to report success"); process.exit(1); }

  // 4) 私密性验证（这才是有意义的断言）：探针对象走公开地址必须取不到
  const probe = "probe/privacy-check.txt";
  const { error: upErr } = await sb.storage.from(BUCKET).upload(probe, new TextEncoder().encode("privacy probe"), { contentType: "text/plain", upsert: true });
  if (upErr) { console.error("probe upload failed:", upErr.message); process.exit(1); }

  const publicUrl = url.replace(/\/$/, "") + "/storage/v1/object/public/" + BUCKET + "/" + probe;
  const publicRes = await fetch(publicUrl).catch(() => null);
  const publicStatus = publicRes ? publicRes.status : 0;
  console.log("probe public URL status:", publicStatus || "(no response)");

  const { data: authed, error: dlErr } = await sb.storage.from(BUCKET).download(probe);
  console.log("probe authenticated download:", dlErr ? "FAILED " + dlErr.message : "ok (" + (authed ? authed.size : 0) + " bytes)");

  await sb.storage.from(BUCKET).remove([probe]);

  if (publicStatus >= 200 && publicStatus < 300) {
    console.error("\n✗ the object is readable through the PUBLIC url — bucket is not private");
    process.exit(1);
  }
  if (dlErr || !authed) {
    console.error("\n✗ authenticated read failed — the app would not be able to serve attendance photos");
    process.exit(1);
  }
  console.log("\n✓ " + BUCKET + " is private: public URL rejected, authenticated read works, probe removed");
  console.log("next: set STORAGE_PRIVATE_BUCKET=" + BUCKET + " in Vercel env if you renamed it");
}

main().catch((e) => { console.error("provision failed:", e); process.exit(1); });
