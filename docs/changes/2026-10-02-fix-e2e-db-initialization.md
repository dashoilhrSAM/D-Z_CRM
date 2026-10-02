---
date: 2026-10-02
title: E2E 删除测试库后先重建空 SQLite 文件，再迁移
branch: codex/fix-e2e-db-initialization
---

## 改动

`e2e/global-setup.ts` 清理旧库后创建空 `prisma/e2e.db`，再执行 `prisma migrate deploy`。
文件使用 `wx` 创建；清理错误不再吞掉，避免旧数据残留时继续播种。
新增真实临时文件回归检查，验证迁移前数据库存在、内容为空且旧 journal 已清除。
## 影响

复现时默认 Playwright 命令在初始化阶段退出：Schema engine error。
直接调用 schema-engine 检查得到 P1003（数据库不存在）；创建空库后迁移可执行。
仅影响测试初始化，无业务源码、schema、迁移或依赖变更。
## 交接说明

回归检查在旧实现上失败（迁移前文件不存在），修复后通过。
运行时使用 `PATH="/Users/Jun/.dsh/runtime/node/bin:$PATH"`，避免 ChatGPT 内置 Node 的原生依赖签名限制。
全量验证：tsc 0 错误；lint 0 error / 830 个既有 warnings；Vitest 1103/1103（99 文件）；
build 通过；默认 `pnpm exec playwright test --project=desktop-chromium` 55/55（5.1 分钟）。
构建后重启三服务，workshop/rider 返回 200。CI E2E 所需的四个 Secrets 仍未配置。
