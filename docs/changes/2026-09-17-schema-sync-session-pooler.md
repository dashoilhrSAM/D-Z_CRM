---
date: 2026-09-17
title: 构建期同步的两处提示在把人往坑里推——直连地址在这个部署上是连不上的
branch: fix/schema-sync-pooler-warning
---

## 改动

**只改了提示语与一个判定函数，没有改任何同步逻辑。** 起因是 `docs/changes/2026-09-17-deploy-blocked-by-schema-verification.md`
那份诊断：`db.<ref>.supabase.co` 是 IPv6-only，Vercel 构建只有 IPv4，所以**直连地址在这个部署上根本连不通**。
而 `scripts/sync-prod-schema.mjs` 里有两处提示，恰好都在劝人改用直连地址：

1. **`looksPooled()` 把会话池与事务池一视同仁**：`/:6543\b/ || /pgbouncer=true/ || /pooler\.supabase\.com/`。
   最后那一条会把 **Supavisor 会话池**（`<region>.pooler.supabase.com:5432`，账号 `postgres.<ref>`）也判成"会让 migrate 挂住"，
   于是印出 "Set DIRECT_URL to the direct Supabase url"。
   实测：这条会话池地址 `migrate diff` **exit=0（1.9s）**、DDL 探针 CREATE/DROP 都成功——
   它**是**这个部署上唯一能用的地址。把人从唯一能用的地址劝走，比不警告更糟。
2. **fail-closed 那段提示**（2026-09-15 加的）写着 "Fix the connection (set DIRECT_URL to the direct Supabase url,
   port 5432, not the pooler)" —— 这次两次部署失败后，照着它做正好是错的。

### 具体改法

- `looksPooled` → **`isTransactionPooler`**：只认真正会让 migrate 挂住的形状（`:6543` / `pgbouncer=true`）。
  改名的理由：把 `pooler.supabase.com` 去掉之后，旧名字就在说谎了，而这个名字只有一个用途（印警告），改名成本为零。
- 警告文案改成指向**会话池**，并明确写出"不要改用 `db.<ref>.supabase.co`，那是 IPv6-only"。
- fail-closed 的提示同样改成指向会话池，并给出完整的连接串形状。
- 两处都留了注释写明 2026-09-17 的实测依据，避免下一个人又把它"修"回直连。

### 测试

`tests/schema-sync.test.ts` 的 `describe("looksPooled")` → `describe("isTransactionPooler")`，
并**把那条错断言改成对的**：旧测试断言
`looksPooled("postgresql://u:p@aws-0-ap.pooler.supabase.com:5432/postgres") === true`，
把「警告会话池」这个错误行为**固化了**。现在断言它是 `false`，注释里写明依据。
这是一次反向验证：新断言在旧实现上必然失败（旧实现返回 true）。

## 影响

- **对本次事故**：没有任何影响——DIRECT_URL 该换成什么，是环境变量的事，不依赖这个分支。
  这个分支解决的是"下一次有人照着构建日志里的提示去修，会不会又被带偏"。
- **对以后的部署**：构建日志里不该再出现劝人改用直连地址的话；真用了事务池（6543）时警告仍然照常出现，
  而且这次给的是**能用的**那条地址。
- 不改 schema、不改部署行为、不改任何连接参数的解析（`resolveUrl` 一字未动）。

## 交接说明

- **验证**：`pnpm exec tsc --noEmit` 0；`pnpm test` **522 通过 / 39 文件**、0 error；`grep -rn looksPooled scripts tests src` 无残留。
  另外实跑了两条路径证明改动生效且没有误伤：
  - 假 URL + `VERCEL_ENV=production` → 仍然 exit 1，但提示已改口（指向会话池，并写明别用直连）；
  - 会话池真地址 + `VERCEL_ENV=preview` → **不再触发那条误导警告**，正常 `inspected in 1.9s` 并列出待应用变更。
- **⚠️ 中途踩了一个本地坑（非本次改动引起，但会浪费一轮）**：跑 `pnpm test` 时红了一次，
  报 `the URL must start with the protocol 'postgresql://'`——本地**生成的 Prisma client 是 postgres 版**，
  而测试用的是 sqlite 的 `DATABASE_URL`。`pnpm exec prisma generate`（默认 schema = 本地 sqlite）即恢复，
  之后 522 全绿。**已排除 `prisma db execute`**（单独复现过，它不碰 client）；具体是哪条 pg-schema CLI 调用
  造成的**没有精确定位**。规则照旧：**跑过任何针对 `schema.pg.prisma` 的 prisma 命令之后，重新 `pnpm exec prisma generate`**。
- **没动 `docs/SETUP_AND_PREPARATION.md` §9**：那是冻结的历史台账，里面提到旧函数名 `looksPooled()` 属"当时的实况"，
  按约定不改历史条目；更正写在这里。
- **没动 HANDOFF**：同一天的两份诊断已经改过 HANDOFF（在同名的另一分支上），这个分支只碰脚本与测试，避免两边冲突。
