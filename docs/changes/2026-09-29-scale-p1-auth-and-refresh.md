---
date: 2026-09-29
title: 容量 P1：鉴权改本地验签（去掉每请求两次 GoTrue）、自动刷新加抖动
branch: perf/scale-p1-auth-cache
---

## 改动

P0（PR #92）解决的是「已经坏了」的三件事；这一版解决的是「规模一上来就炸」的两件。

### 1. 每请求两次 Auth 网络调用 → 本地验签（3 处热点，不是一个）

原来每个请求要走 auth.getUser() 两到三次，而**它每次都打一次 GoTrue**：

| 文件 | 触发频率 |
| --- | --- |
| src/lib/supabase/middleware.ts | 每个请求 |
| src/lib/session-user.ts | 每个页面 / 每个 Server Action |
| src/lib/rider-customer.ts | rider 端每个页面（**这条是原报告漏掉的第三处**） |

按 T3（500 家门店）的模型是 **8,570 万次/月**；而 Supabase 的 /auth/v1/user
默认**按 IP 限流 30 次/5 分钟**，且请求全部来自同一小撮 Vercel 出口 IP ——
这是「规模一上来就 429、且报错与真实原因无关」的典型形态。

改成 getClaims()：本项目的 /auth/v1/.well-known/jwks.json 返回 **ES256(P-256)**
非对称公钥，所以 supabase-js 用 WebCrypto **在本地验签**，JWKS 缓存在函数实例里，
稳态下零网络往返。若将来改用对称密钥，库会自动退回一次服务端校验（行为不变）。

新增 src/lib/auth/request-identity.ts（零依赖，claims → 身份，edge 与 node 共用）
与 src/lib/supabase/identity.ts（node 侧**唯一**一处向 Auth 要身份的代码）。
session-user.ts 另加 React cache() 做请求级去重（同一渲染里 layout + page 只解析一次）。

### 2. 自动刷新加 ±20% 抖动

T3 下自动刷新占全部渲染的 **67%**（90 万次/天），而这 90 万次**全落在整秒上**
（大家开门时同时打开页面）→ 尖峰叠加。现在两处消费者（工作台刷新控件、机修端）
共用 src/lib/refresh-policy.ts 的 jitteredDelayMs()，用**自我重排的 setTimeout**
（不是 setInterval —— 固定周期会让抖动退化成固定相位）。

**刻意没有**把间隔从 30 秒改成 120 秒：那会真的降低柜台与机修的实时性，是业务取舍
（报告里算过可省约 45% 的 Vercel 账单），由老板按门店体验决定，不写进源码常量。

## 影响

- 每次页面渲染少 1-3 次跨太平洋的 Auth 往返（P0 已经把函数挪到新加坡，这次把
  剩下的 Auth 调用也变成纯本地）。
- GoTrue 按 IP 限流的风险消失（不再有每请求的 /auth/v1/user 调用）。
- 自动刷新的**平均间隔不变**（30 秒还是 30 秒，用户感觉不到），峰值时刻被打散。

## 交接说明

- **真实浏览器验证过**（不是只看测试绿）：本地 :3002 用 ManagerDemo 真登录 →
  /workshop/dashboard、/workshop/jobs、/workshop/customers 均正常，
  右上角显示 "MD Manager Demo · MANAGER"（证明 claims → authId → DB 整条链通）；
  未登录分支也复验：API → 401 JSON、/workshop/* → 307 去 login、/rider/* → 307 去 rider login。
- **抖动是用 110 秒实测量出来的**：刷新间隔 30.1s / 33.4s，平均 31.8s，
  且 110 秒内持续重排（不是只响一次）。踩到的坑：router.refresh() 的信号是
  **请求头 RSC: 1 + 无 next-router-prefetch + 打到当前路由**，不是 URL 里的 _rsc
  （我第一版探针按 URL 判，得到「零刷新」的假阴性；而且一次刷新会产生 2 个 RSC 请求，
  量间隔时必须先把 3 秒内的请求并成一次）。
- 登录/改密码流程（src/actions/auth-supabase.ts）**故意没改**：那是凭据流程，
  需要服务端权威校验，且不在热路径上。tests/auth-identity.test.ts 用白名单把这条
  写成断言 —— 新增第四处热路径 getUser 会让它红。
- 测试 854 → 861（新增 tests/auth-identity.test.ts 6 条、tests/refresh-policy.test.ts 7 条）。
- 未做（下一版）：参考数据缓存（unstable_cache + tag）——报告里的 P1 第三项。
