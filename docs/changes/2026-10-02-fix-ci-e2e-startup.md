---
date: 2026-10-02
title: CI 在启动 Playwright webServer 前准备测试数据库
branch: codex/fix-ci-e2e-startup
---

## 改动

CI 的 webServer 命令先执行现有 global-setup，再启动 Next.js；CI 不再在服务启动后执行 globalSetup。
初始化脚本可直接执行，CI 完成迁移、播种、AuthLink 回填后直接返回，不调用本机 launchd 或等待服务。
CI 禁用已有服务复用。本地仍通过 globalSetup 重建测试库并重启 launchd 服务。
E2E 构建步骤传入两个 NEXT_PUBLIC_SUPABASE 配置，确保浏览器包构建时获得配置。
单测共用 dev.db，统一串行：并行验证时发现平台模板测试临时覆盖 standard，
使开店测试读到三项服务而非内置四项；单独/串行运行均通过，不改业务规则或降低断言。
## 影响

main 70a6e5d 的 CI run 36950224930 在 webServer 启动阶段反复报 P2021：Organisation 表不存在，
60 秒后超时，globalSetup 尚未执行。本地因已有服务和测试库，无法暴露这一启动顺序问题。
新增检查覆盖 CI 初始化不等待尚未存在的服务，以及启动前初始化、启动后不再删库的配置约束。
## 交接说明

两条新增回归检查在旧实现上失败，修复后通过。
验证：默认 pnpm test 1105/1105（99 文件）；tsc 0 错误；lint 0 error / 830 个既有 warnings；build 通过。
CI=true 模式先停掉 E2E 常驻服务，让 Playwright 初始化数据库并自行启动 Next.js：55/55（3.9 分钟）。
测试后恢复 launchd，默认 desktop-chromium 再跑 55/55（5.1 分钟）；三个本地服务均 200。
GitHub E2E 所需四个 Secrets 仍为空；本次不写入凭据。
