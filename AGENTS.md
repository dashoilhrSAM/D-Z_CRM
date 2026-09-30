<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

<!-- BEGIN:dz-platform-rules -->

# dz-platform 项目契约（D&Z 摩托车维修 CRM）

## 项目是什么
D&Z 摩托车维修店的 SaaS CRM：workshop（店内端 :3002）、rider（车主端 :3003）双应用，含工单、库存、考勤（HRM）、营销、财务、AI 助手等模块。生产：https://d-z-crm.vercel.app（push main 自动部署）。

## 技术栈
Next.js（App Router）+ TypeScript（strict）+ Prisma（本地 SQLite `dev.db` / `e2e.db`，生产 Supabase PostgreSQL）+ Tailwind CSS + shadcn/ui + Zod 校验 + Vitest（单元）+ Playwright（e2e）+ Sentry。包管理用 **pnpm**，不要用 npm/yarn。

## 基线命令（每次改动后必须验证）
- `pnpm exec tsc --noEmit` → 必须 **0 错误**
- `pnpm test` → Vitest 全绿（当前 913 通过 / 80 文件）
- `pnpm build` → 必须通过（改源码后必须 build → kickstart 服务 → 再跑 e2e）
- `pnpm exec playwright test --project=desktop-chromium` → 全绿（当前 55 通过）
- 改动前先跑相关测试，改动后跑全量；修复 bug 必须附带回归测试（vitest 或 playwright）

## 架构分层（严格遵循，勿绕过）
```
UI (Server/Client Components, src/app/)
   ↓
Application Service  src/modules/<domain>/service.ts  (业务逻辑，无 JSX)
   ↓
Repository interface src/modules/<domain>/repository.ts
   ↓
Adapter              src/repositories/prisma/*.repository.ts
   ↓
Database             Prisma (SQLite→PostgreSQL)
```
- 所有变更（mutation）走 **Next.js Server Actions**（`src/actions/*`），调用 service 后 `revalidatePath("/", "layout")`。
- 外部依赖（短信/通知/AI/存储/支付）只通过 `src/providers/*` 接口访问，业务模块不直接依赖具体实现。
- 金额计算遵循 `docs/ARCHITECTURE.md` §102 精度约定（钱用整数/分处理，勿用浮点）。
- 权限：`src/lib/auth/role-modules.ts` 是角色-模块矩阵唯一定义源，改权限先改这里。

## 数据库 / Schema 变更
- 改 schema 后：`pnpm exec prisma migrate dev` 生成迁移；**dev.db 与 e2e.db 都要**各跑 `DATABASE_URL="file:./<db>.db" pnpm exec prisma migrate deploy`，再重启对应服务。
- 带 schema 变更的部署前，先确认 Vercel `DIRECT_URL` 生效（Build Logs 搜 `schema-sync`）。
- 生产 schema 漂移检查：`DRIFT_CHECK_URL="$DST_DATABASE_URL" node scripts/sync-prod-schema.mjs --check`。

## 常用服务（本地）
- workshop :3002、rider :3003、e2e :3102。挂了用 `launchctl kickstart -k gui/$(id -u)/com.dz-platform.server`（rider/.e2e 换 label）。
- 主店坐标与门店身份收敛在 `src/lib/branch-info.ts`；业务日逻辑在 `src/lib/business-day.ts`；工单号序列在 `src/lib/job-number.ts`。

## AI 集成（一人公司体系）
- **新工单 → 本地 AI 回复草稿**：`src/lib/ai-reply-draft.ts` 的 `generateAiReplyDraft(jobId)` 在 `createJob` 成功后异步调用（fire-and-forget，未配置 `AI_DRAFT_WEBHOOK_URL` 时静默跳过，失败不影响主流程）。草稿写入 `Message` 表（direction OUT / channel SYSTEM / status QUEUED / referenceType AI_DRAFT / 正文带 `[AI 草稿]` 前缀，不实际发送）。
- 链路：CRM → n8n Webhook `http://host.docker.internal:5678/webhook/local-ai` → 宿主机 Ollama `qwen3:8b`。改 `.env` 的 `AI_DRAFT_WEBHOOK_URL` 可切换/关闭。
- **每日定时测试**：n8n 工作流「每日定时测试（全部项目）」（每日 09:00）→ 宿主机 test-runner `http://host.docker.internal:8787/run-all`（launchd 常驻 `com.dz.test-runner`）→ 报告写 `~/Documents/dz-automation/reports/daily-test-report-<date>.txt`。test-runner 白名单项目在 `~/Documents/dz-automation/test-runner.mjs` 的 `PROJECTS`，新增项目需登记。

## 文档
- 详细架构见 `docs/ARCHITECTURE.md`，接口见 `docs/API.md`，数据模型见 `docs/DATA_MODEL.md`。
- 变更记录写 `docs/changes/`（`pnpm new:change <名字>`），**不要**往 `docs/HANDOFF.md` 追加逐次改动。

## 协作方式
- 需要"换角色"时引用 The Agency 角色：如 `Use the Frontend Developer agent...`、`Use the Code Reviewer agent...`。
- 改 bug 流程：先复现/定位 → 写失败测试 → 修复 → 全量基线验证 → 提交。

<!-- END:dz-platform-rules -->
