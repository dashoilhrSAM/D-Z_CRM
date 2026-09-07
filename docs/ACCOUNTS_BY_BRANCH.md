# D&Z Platform — Accounts by Branch

> 数据来源：**生产库**（Supabase PG）。`login=yes` = 已绑定 Supabase 认证、可直接登录；`login=no` = 未绑定登录账号。

## 通用
- 演示登录密码：**`Dashoil@!789`**（已确认：ManagerDemo、MechanicDemo、test.*@dz.my）
- `@dz.my` 员工已启用登录，但密码未在此记录；如需登录请在 Supabase 重置，或直接用已验证的 ManagerDemo / MechanicDemo / test.* 账号。
- 顾客（Rider）一般用手机号 + 密码登录，密码未记录。

## 1 · D&Z Smart Workshop（吉隆坡）— 主店
### 员工
| 姓名 | 邮箱 | 角色 | 登录 |
|---|---|---|---|
| Daniel Tan | daniel.tan@dz.my | OWNER | yes |
| CRM DO Owner | crm_do_owner@gmail.com | OWNER | yes |
| Manager Demo | ManagerDemo@gmail.com | MANAGER | yes（密码 Dashoil@!789） |
| Mei Ling Wong | mei.ling.wong@dz.my | COUNTER_STAFF | yes |
| MechanicDemo | MechanicDemo@gmail.com | MECHANIC | yes（密码 Dashoil@!789）※另同邮箱一条 login=no 重复 |
| Aizat bin Ismail | aizat.bin.ismail@dz.my | MECHANIC | yes |
| Hafiz bin Hassan | hafiz.bin.hassan@dz.my | MECHANIC | yes |
| Ravi a/l Kumar | ravi.a.l.kumar@dz.my | MECHANIC | yes |
| Wei Kit Tan | wei.kit.tan@dz.my | INVENTORY | yes |
| Priya a/p Lee | priya.a.p.lee@dz.my | MARKETING | yes |
### 顾客
| 姓名 | 手机 | 登录 |
|---|---|---|
| Ahmad Danial | 012-345 6789 | yes（数据最全） |

## 2 · D&Z Smart Workshop（Shah Alam）
**（当前无账号）**

## 3 · D&Z Smart Workshop（Johor Bahru）
### 顾客
| 姓名 | 手机 | 登录 |
|---|---|---|
| Muhammad binti Zain | 018-492 8009 | yes |

## 4 · D&Z Testing Branch（吉隆坡）— 测试分行（隔离）
> 分支级账号，登录后只见本分行数据（严格隔离）；密码 = 各自角色 +123（manager+123 / counter+123 / servicemgr+123 / mechanic+123）。
### 员工
| 姓名 | 邮箱 | 角色 | 登录 |
|---|---|---|---|
| Testing Manager | test.manager@dz.my | MANAGER | yes |
| Testing Service Mgr | test.servicemgr@dz.my | SERVICE_MANAGER | yes |
| Testing Counter | test.counter@dz.my | COUNTER_STAFF | yes |
| Testing Mechanic 1 | test.mech1@dz.my | MECHANIC | yes |
| Testing Mechanic 2 | test.mech2@dz.my | MECHANIC | yes |

## Org 级（未绑定分行，共享）
### 顾客
| 姓名 | 手机 | 邮箱 |
|---|---|---|
| JYTest | +601127322148 | jytest@gmail.com |

## 备注
- **分行隔离**：test.* 属 Testing Branch；ManagerDemo/MechanicDemo 属主店；Ahmad 属主店、Muhammad 属 JB（rider 可 org 级跨分行预约）。
- **重复**：MechanicDemo@gmail.com 有 2 条 User（其一 login=no，疑为历史残留）。
- **@dz.my 员工密码**未记录，演示建议用 ManagerDemo/MechanicDemo/test.*。