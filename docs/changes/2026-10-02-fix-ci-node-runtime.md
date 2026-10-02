---
date: 2026-10-02
title: CI 使用支持 Supabase 原生 WebSocket 的 Node 24
branch: codex/fix-ci-node-runtime
---

## 改动

CI 的 quality、e2e、build 三个 job 从 Node 20 统一到 Node 24。
新增真实 Supabase 客户端初始化检查，提前暴露运行环境不支持原生 WebSocket 的问题。

## 影响

四个 Secrets 添加后，main 的 CI run 36953018959 attempt 2 已读取配置；
quality 和 build 通过，E2E 的 link-auth 在创建 Supabase 客户端时失败：
Node.js detected but native WebSocket not found。
当前 Supabase Realtime 依赖声明 Node >=22；此前本机 Node 24 验证无法暴露 CI Node 20 的差异。

## 交接说明

同一客户端初始化命令及新增回归测试在 Node 20.20.2 上复现 CI 错误；Node 24 下相关 4 条回归测试通过。
验证：全量单测 1106/1106（99 文件）；tsc 0 错误；lint 0 error / 830 个既有 warnings；build 通过。
build 后重启三个本地服务，desktop-chromium 55/55（5.3 分钟）。
凭据由用户添加，本次不修改 Secrets 或应用业务逻辑。
