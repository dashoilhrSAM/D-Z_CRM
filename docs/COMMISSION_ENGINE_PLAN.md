# 佣金引擎重设计方案（SKU / 服务级 + 阶梯 + 自动化）

> 状态：**业务口径已定，设计已更新**（见下方「已确认的决定」）。本文件是设计稿，实现分 P0–P4 推进。
> 侦察日期：2026-09-23；基于 main@a0fc641 的实际代码与 schema。

## 已确认的业务决定（2026-09-23，来自老板）

| # | 决定 | 对设计的影响 |
| --- | --- | --- |
| 1 | **只有 mechanic 拿钱**（工头不抽成） | 台账受益人 = 工单的 mechanicId；不需要分成逻辑。**但工单没指派技师时不能静默丢钱**（见 §4.2 的待归属） |
| 2 | **基数 = 成交价** | 用行上的实际成交额（lineTotalSen）。发票层折扣是否按行分摊先扣，见下方「待确认 A」 |
| 3 | **计提时点 = 工单完工** | 与现有 completion 流程同点；退款/作废走反向冲正 |
| 4 | **免费/保修行既不计佣、也不计件** | 阶梯件数只数有金额的行（简化了边界） |
| 5 | **「卖 10 送 2」的"2"由 workshop 自定义** | 四种 rewardKind 全部做成可配（§3.1），UI 必须对每种给出人话解释 |
| 6 | **窗口按 MYT** | 默认 windowKind = MONTH，MYT 自然月切；同时保留可配（§3.2） |
| 7 | **阶梯范围也可自定义**（单 SKU / 分类 / 全店合计） | scope 做成可配，三种都必须能做（§3.1） |
| 8 | **需要组合规则**（如 5% + 每件 RM2） | basis 增加 COMBO（percent + fixed 同时、显式建模） |
| ➕ | **技师面板能看到自己适用的组合、看到进度、达标后去 claim** | 新增领取状态机与技师端界面（§3.4），阶梯奖励**不再自动入账** |

---

## 0. 现状（先说清楚今天是怎么算的）

| 事实 | 位置 | 含义 |
| --- | --- | --- |
| 佣金规则是**按人**的，不是按商品/服务 | Organisation.salaryRules（org 默认）+ User.commissionRules（个人覆盖） | 只有三种：per_job（每单固定 RM）、percent_sales（整单销售额 × %）、flat（忽略） |
| 计算函数 | src/modules/staff/service.ts 的 computeCommission | 输入是**整单销售额**与单数，**看不到行项目** |
| 工单层的数字常常是**人工填的** | ServiceJob.commissionSen（Int?）+ src/actions/settlements.ts 的 updateJobCommission | 工头在结算页手工改单值；null 才回退到上面的规则 |
| 结算 = 按周期聚合 | StaffPayout（unique [userId, period, periodStart]，UNPAID/PARTIAL/PAID）+ StaffPayoutPayment | 已有付款状态机与手动奖金，**这套可以保留** |
| 技师 App 显示 | src/app/mechanic-app/*：job.commissionSen ?? 1000 | **占位假数字**：没有佣金的行会显示 RM10，改版必须一并修掉 |

### 阻塞点（必须先解决，否则"按 SKU/服务配佣金"根本无法计算）

~~~prisma
model ServiceJobItem {   // 现在的样子
  description  String    // 只有文字描述
  kind         String    // SERVICE | FEE | ADDON
  quantity     Int
  unitPriceSen Int
  lineTotalSen Int
  status       ItemStatus
  source       ItemSource
}                        // ← 没有任何 productId / serviceTypeId
~~~

**工单行不连目录**，所以今天无法回答"这一行是哪个 SKU / 哪个服务"。InvoiceItem 同样只有 description。
而 ServicePackageItem **已经**有 productId（套餐行连着商品）——说明目录本身是齐的
（Product.sku 唯一、sellPriceSen、category；ServiceType.code / priceSen），缺的只是"工单行 → 目录"这一步落库。

**结论：第 0 期必须先补这个连接**，否则后面所有按 SKU/服务的规则都是空中楼阁。

---

## 1. 数据模型

### 1.1 前置改造（P0）：让工单行带上目录身份

~~~prisma
model ServiceJobItem {
  productId     String?      // 新增，可空（历史数据与自由文本行必须能存）
  product       Product?     @relation(fields: [productId], references: [id])
  serviceTypeId String?
  serviceType   ServiceType? @relation(fields: [serviceTypeId], references: [id])
  @@index([productId])
  @@index([serviceTypeId])
}
~~~

- **写入点**：工单项目创建（src/actions/workshop.ts 的 createMany）、套餐展开（从 ServicePackageItem.productId 带过来）、
  柜台加项（SERVICE/ADDON 选择器必须选到目录项，而不是自由文本）、审批转工单（APPROVAL）。
- **自由文本行**（今天的常态）保留：productId=null 且 serviceTypeId=null → 佣金回退"人员级旧规则"并标记 LEGACY。
- **历史回填**：脚本按 description 精确匹配 Product.name / ServiceType.name（大小写与空白归一），
  输出"能匹配 / 不能匹配"两张清单；**不猜**（匹配不上的留在 LEGACY，报告里可见）。
- **InvoiceItem** 同样补（发票是最终对账凭据），但 P0 可以只做工单侧，发票侧在 P2 一起。

### 1.2 规则表：CommissionRule（一条规则 = 一个作用域 + 一种算法）

~~~prisma
model CommissionRule {
  id             String   @id @default(cuid())
  organisationId String
  scope          String   // PRODUCT | SERVICE | CATEGORY | DEFAULT
  targetId       String?  // PRODUCT → Product.id；SERVICE → ServiceType.id；CATEGORY → 分类名；DEFAULT → null
  basis          String   // PERCENT | FIXED | COMBO   ← 枚举，单值（COMBO 是"显式组合"，不是两个字段都填）
  value          Int      // PERCENT → 百分点×100（5.25% = 525）；FIXED → sen；COMBO → 不用
  valuePercent   Int?     // 仅 COMBO：百分点×100
  valueFixedSen  Int?     // 仅 COMBO：每件固定额（sen）
  effectiveFrom  DateTime @default(now())
  effectiveTo    DateTime?
  priority       Int      @default(0)   // 同 scope 同 target 冲突时的兜底（越大越优先）
  note           String?
  active         Boolean  @default(true)
  createdBy      String?
  createdAt      DateTime @default(now())
  @@unique([organisationId, scope, targetId, effectiveFrom])
  @@index([organisationId, scope, active])
}
~~~

**为什么 basis 必须是枚举、而不是"百分比和固定额两个字段都填"**：两个字段都存在时，
"都设置了怎么办"就变成**运行时猜谜**，而金额算错是会计事故。改成枚举后"同时设置"在数据层**无法表达**——
这是最省事的防错方式（跨层级的优先级见第 2 节）。

### 1.3 阶梯表：CommissionTierSet + CommissionTier

~~~prisma
model CommissionTierSet {
  id             String   @id @default(cuid())
  organisationId String
  name           String                       // 如 "机油买十送二"
  scope          String                       // PRODUCT | SERVICE | CATEGORY | ALL
  targetId       String?
  windowKind     String                       // MONTH | PAY_CYCLE | ROLLING_30D
  countUnit      String   @default("ITEM_QTY") // ITEM_QTY | LINE_COUNT
  countFreeLines Boolean  @default(false)      // 免费/保修行是否计入件数（见第 10 节问题 4）
  rewardKind     String                       // ONE_OFF_FIXED | EXTRA_PER_UNIT_FIXED | STEP_PERCENT | FREE_UNIT_COMMISSION
  active         Boolean  @default(true)
  effectiveFrom  DateTime @default(now())
  effectiveTo    DateTime?
  tiers          CommissionTier[]
}

model CommissionTier {
  id           String @id @default(cuid())
  tierSetId    String
  tierSet      CommissionTierSet @relation(fields: [tierSetId], references: [id], onDelete: Cascade)
  thresholdQty Int    // 达到多少件触发（含）
  rewardValue  Int    // 按 rewardKind 解释：sen / 百分点×100 / 件数
  note         String?
  @@unique([tierSetId, thresholdQty])
}
~~~

**阶梯不做"计数器字段"**（见第 3、4 节）：达成件数一律**从台账推导**。

### 1.4 台账表：CommissionLedger（唯一真相，只追加）

~~~prisma
model CommissionLedger {
  id             String   @id @default(cuid())
  organisationId String
  branchId       String?
  userId         String                   // 受益人
  jobId          String?
  jobItemId      String?
  invoiceId      String?
  kind           String                   // BASE | TIER_BONUS | ADJUSTMENT | REVERSAL | LEGACY
  amountSen      Int                      // 可为负（冲正/调整）
  basis          String                   // PERCENT | FIXED | LEGACY | MANUAL
  baseSen        Int                      // 计算基数（行净额），便于解释
  ruleId         String?
  ruleSnapshot   String?                  // 规则内容快照：事后改规则不影响历史
  tierSetId      String?
  tierSnapshot   String?                  // 触发阶梯时的窗口件数/档位快照
  reason         String?                  // 人工调整/冲正的原因
  actorUserId    String?                  // 谁做的调整
  reversalOfId   String?                  // 冲正指向的原台账行
  earnedAt       DateTime                 // 计提时点（业务口径，决定落在哪个结算窗口）
  windowKey      String                   // 冗余窗口键，如 "2026-09"
  createdAt      DateTime @default(now())

  @@unique([jobItemId, kind])             // 幂等的核心：同一行同一类型只能有一条
  @@index([organisationId, userId, windowKey])
  @@index([jobId])
}
~~~

- **只追加，永不 UPDATE 金额**。改错 → 追加一条 ADJUSTMENT（带 reason），而不是改原值。
- ruleSnapshot / tierSnapshot = 沿用本项目**已验证的快照原则**（促销「报价即承诺」就是这么做：
  campaign 事后被改也不影响已报价的单）。佣金同理：**规则改了不能追溯改历史**。
- @@unique([jobItemId, kind]) 让"重复计提"在数据库层不可能发生（即使任务被重跑两次）。

---

## 2. 算法解析：谁赢（含"两个都设置了"）

解析链（从最具体到最兜底）：

~~~
工单行
 ├─ 1. 有 productId   → scope=PRODUCT  + targetId=productId  + active + 覆盖 earnedAt 的规则
 ├─ 2. 有 serviceTypeId → scope=SERVICE + targetId=serviceTypeId ...
 ├─ 3. 商品的 category  → scope=CATEGORY + targetId=category ...
 ├─ 4. 都没命中 → scope=DEFAULT
 └─ 5. 连 DEFAULT 都没有 → 回退人员级旧规则（computeCommission），台账标 LEGACY
~~~

三条铁律：

1. **命中即终止，不叠加**：第 1 层命中就用第 1 层，**不与第 3、4 层相加**。叠加会让"为什么是这个数"无法解释，
   而佣金是会被人拿计算器核对的数字。
2. **同一层里"百分比 vs 固定额"不会同时生效**：basis 是枚举（模型层做不到两个都填）。
   若同一层出现两条生效区间重叠的规则 → **取 effectiveFrom 最晚且已生效的那条**，
   并在管理页把它们标成冲突（第 6 节）。若仍并列（数据被手工改坏）→ 取 priority 大者，
   priority 相同则以 id 稳定排序，**并写一条告警进复核报告**（不允许静默择一）。
3. **组合佣金要显式建模**：若业务确实要"5% + 每件再给 RM2"，那不是"两个都设置"，
   而是 basis: COMBO + valuePercent + valueFixed 一条**明确**的规则。要不要这个能力见第 10 节问题 8。

**计算基数 = 成交价**（已定）。行上的 lineTotalSen 就是成交额；但**发票层的折扣/优惠发生在整单上**，
所以"成交价"要落到行金额，就必须把整单折扣**按行比例分摊**到行（否则同一次促销里，
打折的单与没打折的单佣金一样，等于佣金跑在收入前面）。分摊要纯函数 + 单测（尾差归到最大行，合计必须一致）。

**待确认 A**：促销折扣（promoDiscountSen）要不要计入分摊、从而减少佣金基数？
两种口径都说得通（"按客户实付" vs "促销是公司行为、不扣技师"），但必须有明确答案并且写在 UI 上。

---

## 3. 阶梯：结构、窗口、达成与重置

### 3.1 结构

- 一个 CommissionTierSet 绑定一个作用域（单个 SKU / 单个服务 / 一个分类 / 全店）；
- 内含若干档：thresholdQty（达到多少件）+ rewardValue；
- rewardKind 四种，**全部由 workshop 在界面上选**（决定 5：老板明确说"让 workshop 自定义"），
  所以每一种都要在 UI 上写清人话解释与一个算式示例：
  - ONE_OFF_FIXED：达成时一次性给 RM X；
  - EXTRA_PER_UNIT_FIXED：达成后**每一件**额外 +RM X（是否追溯已卖的前 10 件，由 retroactive 开关决定）；
  - STEP_PERCENT：达成后该窗口内**后续件**的百分比变成 Y%；
  - FREE_UNIT_COMMISSION：等价于"送 2 件的佣金" = 2 × 单件佣金，一次性计入。

### 3.2 窗口与重置

- windowKind：MONTH（自然月，按门店时区 MYT 切）/ PAY_CYCLE（跟着 StaffPayout 周期）/ ROLLING_30D（难解释，非必要不用）；
- **重置不是"跑定时任务清零"**，而是**窗口天然切换**：某件数 = 该窗口内台账行的件数之和。
  这样"重置任务漏跑导致多算/少算"这类经典事故**在架构上不存在**
  （对比：维护一个 currentQty 计数器再定时清零，一旦漏跑就算错）。
- 达成的**判定时点** = 每一件计提的那一刻，看**当时**窗口内已计提件数 + 本件（含）是否跨过 thresholdQty；
  跨档的那一件负责把奖励记进台账，tierSnapshot 记下"第 10 件，窗口 2026-09"。

### 3.3 并发下的"第 10 件归谁"（必须写进规则，否则会扯皮）

两单几乎同时完成（两个技师各卖 5 件，同一天到 10）：件数**从台账推导**，所以只需一个确定性排序：
**按 earnedAt 升序、id 升序**，排序后第 10 件那条台账负责记奖励。并且：

- 计提在同一事务里"插入台账 → 唯一键兜住重复"；
- 触发奖励的计算要**重读窗口计数**（而不是沿用之前读到的值），避免用陈旧计数判定；
- 两笔落在同一毫秒时排序仍确定（id 兜底），**结果可复现**；"为什么是这个数"面板会写明
  "你是窗口内第 10 件，奖励归你 / 你是第 11 件，奖励已归第 10 件"。

---

### 3.4 阶梯奖励的**领取**流程（技师面板：看组合 → 看进度 → 达标后 claim）

老板要求：技师面板能看到自己适用的组合、看到进度、达成后**去领取**奖励。
这意味着阶梯奖励**不是自动入账**，而是一个**由技师触发的状态机**：

~~~
① ACCRUED  —— 台账里已经攒够件数（由 BASE 台账推导，无计数器）
② CLAIMABLE —— 达成某档且**尚未领取** → 技师面板出现"可领取"卡片 + 进度条
③ CLAIMED  —— 技师点了"领取" → 生成一条 TIER_BONUS 台账（kind=TIER_CLAIM）
④ SETTLED  —— 该台账随窗口进入 StaffPayout，付款后变 PAID
~~~

数据模型（新增一张表，用来保证"可领取"这件事本身也可审计）：

~~~prisma
model CommissionClaim {
  id          String   @id @default(cuid())
  organisationId String
  userId      String                  // 技师
  tierSetId   String
  tierId      String                  // 具体哪一档
  windowKey   String                  // 归属窗口（如 "2026-09"）
  claimedQty  Int                     // 领取时的窗口件数快照（用于解释与争议）
  amountSen   Int                     // 领取时算出的奖励额（快照）
  ledgerId    String?                 // 生成的台账行
  claimedAt   DateTime @default(now())
  @@unique([userId, tierId, windowKey])   // ← 同一人同一档同一窗口只能领一次
}
~~~

三条必须定死的规则（前两条是设计建议，第三条见「待确认 B」）：

1. **可领取状态是推导出来的**，不是存出来的：窗口内该技师的有效件数 ≥ thresholdQty，
   且不存在对应的 CommissionClaim → 就是"可领取"。这样"已经领过"由唯一键保证，
   不存在"状态字段忘了改"的可能。
2. **领取是唯一入口**：TIER_BONUS 台账只能由 claim 生成（不像 BASE 那样在完工时自动写），
   于是"自动发放"和"手动领取"不会同时发生（这正是最容易打架的地方）。
3. **过期策略**（待确认 B）：
   - 方案甲（推荐，公平）：窗口结束后**未领取的自动补发**，计入下一期结算，并在面板标注"上期自动补发"。
     理由：奖励达成是既成事实，不该因为"忘了点按钮"而丢掉——那会产生无法解释的工资差异。
   - 方案乙（激励）：过期作废。好处是催技师看面板，坏处是要处理投诉与例外。

技师面板需要展示的内容：

- **我适用的组合**：列出命中的 CommissionTierSet（含 scope：单 SKU / 分类 / 全店），
  以及与它配套的基础规则（例如"机油 Motul 5100：5% + 每件 RM2"）；
- **进度**：`本窗口 7 / 10 件` 进度条 + "再 3 件触发"；
- **可领取**：卡片 + 领取按钮（点击后立即变成"已领取，将随本月结算发放"）；
- **历史**：往期已领取 / 已发放的阶梯奖励明细（与工资明细同源，避免两处数字）。

## 4. 自动化：一个写入者、一个真相、一条对账

### 4.1 计提时点（事件）

推荐 **工单完工**（completion.ts 里已经写发票与付款）作为计提事件，**而不是**发票收全款：

- 技师体感是"活干完就该算钱"；
- 改成"收到钱才算"要处理逾期未付、部分付款、坏账，复杂度高一量级；
- 但**冲正必须覆盖退款**：退款/作废时按原台账行追加 REVERSAL（负数），
  落到当期调整桶（推荐）或回退原窗口。

### 4.2 唯一写入者

~~~
commissionEngine.accrueForJob(jobId, { actorUserId? })
   ├─ 读工单行（含目录身份）
   ├─ 逐行解析规则（纯函数 resolveRule(line, rules, at)）
   ├─ 计算基数（折后净额分摊）
   ├─ 计件与阶梯判定（读窗口件数）
   └─ 事务内批量插入 CommissionLedger（唯一键兜住重复）
~~~

- **任何人不得再直接写 ServiceJob.commissionSen**：今天的 updateJobCommission 改成
  "写一条 ADJUSTMENT 台账 + 回填显示用汇总"，并写成**源码护栏测试**（与 tests/api-auth.test.ts 扫路由同一做派）。
- ServiceJob.commissionSen **降级为只读汇总**（由台账汇总回填），避免"两处都算"。
- **工单没指派技师怎么办**（决定 1 的边界）：完工时 mechanicId 为空 → **不许静默算 0**
  （那是技师少拿钱还没人知道），而是写一条 kind = PENDING 的台账（金额 0、reason = "no mechanic assigned"），
  进入"待归属"清单；工头补指派后**自动重算并冲掉 PENDING**（追加正式 BASE）。
  这条清单会出现在对账报告里，避免"活干了没人认领"长期沉积。

### 4.3 幂等与重复执行

- 唯一键 (jobItemId, kind)；
- 完工流程可能被重试（网络/双击/补偿任务），重跑只会命中唯一键冲突，被吞掉并记 debug 日志；
- 冲正/调整**永远是新行**，不 UPDATE。

### 4.4 期间锁与"迟到的计提"

- StaffPayout.status = PAID 即该窗口**锁定**；
- 锁定之后产生的台账（上月工单今天完工、或退款冲正）→ 落到**当前窗口**，
  标 reason: "late-accrual for 2026-08"，并出现在"跨期调整"报告里；
- 绝不修改已付款的 StaffPayout 金额（否则历史工资单与银行流水对不上）。

### 4.5 对账（"避免冲突"的最后一道网）

三个常驻不变量，做成**可定时跑的报告 + 测试**：

1. Σ ledger(window, user) == StaffPayout.commissionSen（同窗口同人）；
2. 每个已完成工单的每一行**有且只有一条** BASE（或有明确 LEGACY/豁免原因）；
3. Σ 所有人在一个窗口的 BASE ≤ 该窗口发票收入（防止"佣金超过营业额"这种离谱错误）。

一旦不成立 → 报告红、页面顶部横幅提示"结算数据待复核"，**不给"就这样付了"的机会**。

---

## 5. 防冲突清单（把 clash 逐条消掉）

| 风险 | 机制 |
| --- | --- |
| 同一行被计提两次（任务重试/双击） | 台账唯一键 (jobItemId, kind) |
| 规则事后被改，历史金额被追溯 | ruleSnapshot 快照；台账只追加 |
| 两个地方都在算佣金（新旧并存） | 唯一写入者 + 旧字段降级为汇总 + 源码护栏测试 |
| 阶梯计数器与台账漂移 | **不存计数器**，件数一律从台账推导 |
| 并发达档归属不清 | 确定性排序（earnedAt, id）+ 重读窗口计数 |
| 退款/作废后佣金照拿 | 追加 REVERSAL，永不 UPDATE 原行 |
| 已发工资的窗口被事后改动 | 期间锁 + 迟到计提落当期 + 跨期调整报告 |
| 多个技师协作一单 | 需**明确分摊策略**（问题 1）；未定义前强制由工头显式拆分（生成 ADJUSTMENT） |
| 折扣与佣金基数打架 | 折后净额按行分摊（纯函数 + 单测，尾差归最大行） |
| 规则重叠（同层两条同时生效） | 唯一键 + 管理页冲突标记 + 复核报告告警 |
| 保修行/免费行被算佣金 | countFreeLines 与"是否计提"分开配置（问题 4） |

---

## 6. 管理界面（要求 1 的"列表 + 管理"）

**页面：/workshop/commission（新）**

1. **总表**：一行一个 SKU + 一行一个 ServiceType，列：目录名、分类、售价、**当前生效规则**（% 或 RM）、
   规则来源（SKU 级 / 分类级 / 默认）、绑定阶梯、生效区间、状态。
2. **筛选**：未配置 / 已配置 / 分类 / 关键词；**默认把"未配置"排前面**（这是待办清单，不是报表）。
3. **批量操作**：勾选后套用同一规则；按分类批量套用；从另一个 SKU 复制；CSV 导入（沿用 public/csv-templates 做法）。
4. **冲突与重叠**：同一目标同时生效的规则高亮，并提供"停用旧的"一键操作。
5. **变更历史**：规则表带 createdBy/createdAt/effectiveFrom，每行可展开看"谁在什么时候改的"。
6. **模拟器**：输入"某工单明细"，立刻显示每行佣金与合计（写之前先看结果——最省事故的一块 UI）。

**新 SKU / 新服务怎么进入（要求 1 的最后一问）**：

- **不阻塞录入**：新建 Product/ServiceType 时若未配佣金，**继承** 分类级 → 默认级，并出现在"未配置"清单里；
  推荐"默认级必须存在"（初始化时强制配一条 DEFAULT），这样**任何新商品永远有一个可解释的数字**，
  不会出现"忘了配 → 佣金 0 元"的静默失败；
- 反向兜底：若连 DEFAULT 都没有，计提时**拒绝静默算 0**，改为"挂起 + 报告"
  （宁可让人看到"这单待复核"，也不要技师少拿钱还没人知道）。

---

## 7. 「为什么是这个数」面板（佣金系统的必需品）

每条台账行都能展开成一句话：

> 工单 #1234 第 2 行「Motul 5100 10W-40 ×2」，成交 RM 100.00，促销分摊 −RM 10.00 → 基数 RM 90.00；
> 命中 **SKU 级规则**（5%，生效于 2026-09-01）→ RM 4.50；
> 本行是窗口 2026-09 的第 10 件 → 触发阶梯「买十送二」→ 一次性 +RM 9.00。

没有这块，每次争议都要靠人翻数据库——这与本项目一贯做法一致（审计行 / 报价快照同一思路）。

---

## 8. 分期交付

| 期 | 内容 | 验收（可观测） |
| --- | --- | --- |
| **P0** | 工单行连目录（productId/serviceTypeId）+ 写入点接上 + 历史回填脚本 + "无法归属"报告 | 新工单 100% 带目录身份；报告给出历史行可/不可匹配清单；**页面无变化**（零风险） |
| **P1** | CommissionRule + 解析器（纯函数）+ 管理页 + 冲突检测 + 模拟器 | 解析器金用例矩阵全绿；管理页列出全部 SKU/服务与来源；冲突可见 |
| **P2** | CommissionLedger + 完工自动计提 + 幂等 + 对账报告 + 把"手工改佣金"改成调整台账 | 重跑计提不产生第二条；Σ台账 = 结算；每行可解释 |
| **P3** | 阶梯（tier set + 窗口推导 + 四种奖励 + 达档归属说明） | 边界（9/10/11 件）、并发达档、跨窗口重置都有测试 |
| **P4** | 结算整合（StaffPayout ← 台账）、期间锁、跨期调整、老板视图（佣金成本/占比） | 已付款窗口不可被改写；跨期调整单独列示 |

每期都是**可独立合并**的 PR（本项目惯例：feature branch → owner merge）。

---

## 9. 测试策略

- **纯函数优先**：resolveRule、splitDiscountToLines、evaluateTiers、windowKeyOf 全部无 IO，用金用例表（scope×basis×效力区间×折后）。
- **边界**：9/10/11 件；跨月最后一天；同一毫秒两单；退款后再买；lineTotalSen=0。
- **幂等**：连续调用两次 ⇒ 台账行数不变。
- **并发**：仿照仓库已有的 scripts/perf/repro-races.ts 做并发插入，断言唯一键与达档归属确定。
- **不变量测试**：随机生成若干工单 → 断言 Σ台账 = 结算金额，且每行恰好一条 BASE。
- **源码护栏**（既有做派）：禁止引擎之外的地方写 commissionSen；禁止删除台账唯一键。

---

## 10. 已定口径 与 剩余待定

**已定**（2026-09-23，见文件开头「已确认的业务决定」表）：只有 mechanic 拿钱；基数 = 成交价；工单完工计提；
免费/保修行既不计佣也不计件；奖励形态与阶梯范围**由 workshop 自选**；窗口按 MYT；**需要组合规则**；
阶梯奖励由技师在面板**领取**（§3.4）。

**剩余待确认 4 项**（都不阻塞 P0；B 影响 P3，A/C/D 只影响口径与文案）：

- **待确认 A**（§2 计佣基数）：促销折扣是否按行分摊、从而减少佣金基数？
  口径一 = 按客户实付（折扣摊到行）；口径二 = 促销是公司行为、不扣技师。**必须选一个并写在 UI 上**。
- **待确认 B**（§3.4 领取过期策略）：窗口结束后未领取的奖励——**自动补发**（推荐；避免"忘点按钮就少钱"，
  否则会产生无法解释的工资差异）还是**过期作废**（激励看面板，但要处理投诉与例外）？
- **待确认 C**：存量工单是否重算？推荐**不重算**（历史保留人工值、报告可查），
  因为追溯重算会让已发工资与银行流水对不上。
- **待确认 D**：佣金是否**按分行**统计与结算？（branch-scope 设施已有，但 User.branchId 与工单分行要一致）

---

## 11. 风险登记

| 风险 | 影响 | 缓解 |
| --- | --- | --- |
| 工单行自由文本历史数据多 | 无法按 SKU 归因 | P0 报告量化；未归因行走 LEGACY 规则，不假装准确 |
| 规则改动的"追溯预期" | 老板以为改了规则会把过去也算成新价 | 快照 + 变更历史 + 明确文案"规则自 X 日起生效，历史不变" |
| 阶梯被理解成"每月必须清零" | 会有人问"为什么上个月的 9 件不算" | 窗口件数在 UI 直接显示（"本窗口已 9 件，再 1 件触发"） |
| 佣金成本失控 | 阶梯 + 高比例叠加导致成本超过毛利 | P4 老板视图给出"佣金/毛利占比"，超阈值告警（阈值可配） |
| 与既有 promo 折扣打架 | 同一单两种口径 | P1 定死"折后净额"，并在对账里校验 |
