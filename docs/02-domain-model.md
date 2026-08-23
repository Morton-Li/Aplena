# PFCM 领域模型

## 1. 模型边界

PFCM 是 Aplena 内唯一权威的财务语义层。它负责：

- 长期计划合法性；
- 月度计划是否应计入及其金额；
- 月度快照的幂等生成；
- 计划与实际聚合；
- 财务承载能力；
- 金额、月份和零分母规则。

React 只展示领域结果并收集输入。数据库约束负责阻止无效状态落盘，但不替代领域服务。

## 2. 固定枚举

### 2.1 Category

| 代码 | 中文标签 | FlowType |
|---|---|---|
| `FIXED_INCOME` | 固定收入 | `INCOME` |
| `VARIABLE_INCOME` | 浮动收入 | `INCOME` |
| `ESSENTIAL_EXPENSE` | 必要支出 | `EXPENSE` |
| `FIXED_COMMITMENT_EXPENSE` | 固定承诺支出 | `EXPENSE` |
| `DISCRETIONARY_BUDGET` | 自主性预算 | `EXPENSE` |

### 2.2 RecognitionMode

- `AMORTIZED`：有效区间内每个月计入月均金额。
- `PAYMENT`：只在从首次计入月份开始的周期锚点月份计入完整金额。

`FlowType` 和 `RecognitionMode` 都不可由用户扩展。标签可以国际化，但枚举代码和语义不变。

## 3. 值对象

### 3.1 YearMonth

- 只含年份和月份；
- 构造时拒绝无效月份；
- 支持比较、加月、计算整月差和取得下月；
- 持久化为当月第一天 `YYYY-MM-01`；
- 不通过 UTC 时间戳推导月份。

`months_between(a, b)` 对 `b >= a` 返回从 a 到 b 的非负整月差。例如 2026-01 到
2026-04 为 3。

### 3.2 CurrencyCode

- 三位大写 ASCII 代码；
- 必须存在于汇率表；
- 不在 MVP 中维护完整 ISO 4217 元数据。

### 3.3 Amount

- 非负；
- 权威精度为小数点后四位；
- 数据库存储为放大 10,000 倍的整数；
- 运算使用十进制类型；
- 只在运算链结束时执行一次 `ROUND_HALF_UP`。

### 3.4 ExchangeRate

- 表示一单位该币种对应的本位币数量；
- 严格大于零；
- 权威精度为小数点后八位；
- 本位币汇率必须精确为 1。

### 3.5 SavingsRate

- 使用 0–10,000 基点表示 0%–100%；
- 财务承载计算时转换为十进制比例；
- 不允许负值或超过 100%。

## 4. 实体

### 4.1 Settings

单例实体：

| 字段 | 语义 |
|---|---|
| `target_month` | Dashboard 和月度操作的默认月份 |
| `base_currency_code` | 月度快照统一币种 |
| `minimum_savings_rate_bp` | 承载能力的最低储蓄底线 |

不变量：

- 本位币必须有汇率且汇率为 1；
- 任意 `MonthlyItem` 存在后，本位币不可改变；
- 目标月份始终归一化到月初。

### 4.2 ExchangeRate

以 `currency_code` 为自然主键，保存当前汇率和更新时间。不保存历史汇率。删除被长期计划、
设置或月度快照引用的币种时必须拒绝。

### 4.3 PlanItem

聚合根，使用用户不可见的 UUID。

| 字段 | 规则 |
|---|---|
| `id` | 稳定 UUID，创建后不变 |
| `name` | 规范化后非空且全局唯一 |
| `category` | 固定 Category |
| `planned_amount` | 原币非负金额 |
| `currency_code` | 已定义币种 |
| `period_months` | 大于零的正整数 |
| `recognition_mode` | `AMORTIZED` 或 `PAYMENT` |
| `start_month` | 首次均摊或首次支付月份 |
| `end_month` | 可空，且不得早于开始月份 |
| `note` | 可空用户文本 |

`flow_type` 由类别派生，不作为 PlanItem 的独立可变状态。停止项目是设置 `end_month`，不增加
Enabled 标志。

### 4.4 MonthlyItem

历史事实实体，使用用户不可见的 UUID。

| 字段 | 规则 |
|---|---|
| `id` | 稳定 UUID |
| `source_plan_item_id` | 来源 PlanItem，可在来源删除后变为空 |
| `month` | 月份锚点 |
| `snapshot_name` | 生成时复制的项目名称 |
| `category` | 生成时复制 |
| `flow_type` | 生成时复制，并与类别一致 |
| `recognition_mode` | 生成时复制 |
| `planned_amount` | 已完成周期和汇率转换的本位币金额 |
| `actual_amount` | 可空；空与零有不同语义 |
| `currency_code` | 生成时的本位币 |
| `note` | 月度备注，不与长期计划备注联动 |

`source_plan_item_id + month` 在来源存在期间唯一。删除来源使用 `ON DELETE SET NULL`，不级联
删除快照。系统不提供任意创建无来源 MonthlyItem 的普通入口。

## 5. 领域服务

### 5.1 计入判断

```text
is_effective(item, month) =
  item.start_month <= month
  AND (item.end_month IS NULL OR month <= item.end_month)

should_recognize(item, month) =
  is_effective(item, month)
  AND (
    item.mode == AMORTIZED
    OR months_between(item.start_month, month) % item.period_months == 0
  )
```

### 5.2 月度计划金额

```text
converted = planned_amount × exchange_rate

AMORTIZED: round_half_up(converted ÷ period_months, 4)
PAYMENT:   round_half_up(converted, 4)
```

汇率、本位币和金额在事务开始后读取，事务结束前保持同一一致性视图。

### 5.3 月均等价金额

财务承载能力不调用 `should_recognize`，只对目标月份有效的长期计划执行：

```text
monthly_equivalent =
  round_half_up(planned_amount × exchange_rate ÷ period_months, 4)
```

因此 `PAYMENT` 年付固定承诺在每个月都以十二分之一进入承载能力，而月度 Dashboard 仍只在
支付月出现整笔金额。

### 5.4 月度初始化

命令：

```text
ensure_month_initialized(month, trigger, optional_rate_overrides)
  -> InitializationResult
```

`trigger` 为 `APP_START`、`PLAN_CREATED`、`EXPLICIT_FUTURE` 或 `EXPLICIT_BACKFILL`。

`InitializationResult`：

```text
month
created_count
skipped_count
excluded_count
created_item_ids
warnings
```

语义：

- 自动触发只允许当前自然月；
- 显式未来初始化要求用户确认；
- 显式历史补录要求展示汇率风险；
- 所有插入位于一个事务；
- 任一应生成项目失败则整体失败；
- 冲突等价于已生成，只跳过不更新；
- 零个应计项目是成功结果，不创建月份标记实体。

### 5.5 实际金额确认

单项更新只改变 `actual_amount` 和 `note`。批量确认命令只执行：

```text
actual_amount = planned_amount WHERE actual_amount IS NULL
```

不得覆盖用户已经录入的零或非零实际金额。

### 5.6 聚合和比率

查询按 `[month, next_month)` 聚合，虽然当前存储已规范化为月初，也不依赖格式化日期字符串
相等。

```text
variance = actual - planned
net_balance = income - expense
savings_rate = net_balance / income
```

收入偏差和支出偏差由展示层使用不同文案。所有分母为零的比率返回显式 `None/N/A`。

### 5.7 财务承载能力

对目标月份有效的计划按月均金额聚合：

```text
S = FIXED_INCOME
N = ESSENTIAL_EXPENSE
C = FIXED_COMMITMENT_EXPENSE
D = DISCRETIONARY_BUDGET
r = minimum_savings_rate

preserved_discretionary_capacity = max(0, S × (1-r) - N - C - D)
maximum_adjustable_capacity      = max(0, S × (1-r) - N - C)
fixed_commitment_ratio           = C / S,          S != 0
basic_obligation_coverage        = S / (N + C),    N + C != 0
```

浮动收入单独返回，不进入上述 S。

## 6. 命令边界

建议的应用命令：

- `get_settings`、`update_settings`
- `list_exchange_rates`、`upsert_exchange_rate`、`delete_exchange_rate`
- `list_plan_items`、`create_plan_item`、`update_plan_item`、`stop_plan_item`、`delete_plan_item`
- `ensure_month_initialized`、`preview_month_backfill`、`reset_unstarted_month`
- `list_monthly_items`、`update_monthly_actual`、`confirm_unset_actuals`
- `get_month_dashboard`、`get_history_trends`、`get_structure_analysis`
- `get_financial_capacity`
- `export_backup`、`inspect_backup`、`restore_backup`、`export_csv`

前端不能取得任意 SQL 执行能力，也不能提交由前端计算完成的 Dashboard 汇总结果。

## 7. 查询模型

查询 DTO 与持久化实体分离，但不是新的数据表：

- `MonthlyDashboard`
- `CategorySummary`
- `MonthlyTrendPoint`
- `ItemShare`
- `ActualCoverage`
- `FinancialCapacity`

查询 DTO 中所有金额通过 IPC 传递十进制字符串。比率使用可空的基点或十进制字符串；空值
表示数学上或业务上不可定义。

## 8. 失败模型

领域错误至少区分：

- 输入验证失败；
- 名称冲突；
- 币种或汇率缺失；
- 本位币已锁定；
- 历史或未来初始化需要显式确认；
- 月度快照冲突（按跳过处理，不是致命错误）；
- 已有实际数据，不能重建月份；
- 备份版本不兼容；
- 数据库事务或迁移失败。

用户提示必须说明可以采取的下一步，不展示原始 SQL、文件路径或敏感数据。

## 9. 关键性质测试

领域实现至少覆盖：

- 任意合法周期的支付月份序列；
- 月付、季度、半年、年付和一次性结束区间；
- 月份跨年计算；
- 汇率乘法、周期除法和一次最终舍入；
- 同一来源同月初始化的幂等性；
- 项目改名后仍按来源 ID 跳过；
- PlanItem、ExchangeRate 变动不改变既有 MonthlyItem；
- NULL 实际与零实际的聚合区别；
- 所有零分母结果；
- PAYMENT 项目仍进入月均承载能力；
- 当前月、历史补录和未来初始化的触发权限。
