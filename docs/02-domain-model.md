# Aplena 领域模型

## 1. 聚合边界

```text
Settings ─┐
ExchangeRate ──> MonthInitialization ──> MonthlyItem
PlanItem ─┘                                │
                                          └── ActualEntry

PlanItem + ExchangeRate ───> BudgetProjection
MonthlyItem + ActualEntry ──> Analytics
```

月度计划快照是历史计划事实；实际条目是执行事实。分析是只读投影，不形成额外聚合或持久化副本。

## 2. 值对象

### 2.1 `YearMonth`

- IPC 规范形式：`YYYY-MM`；
- 数据库锚点：`YYYY-MM-01`；
- 支持下一月、月份差、首日、末日和将锚点日夹到月末；
- 只用于月度选择和聚合，不替代日级业务日期。

### 2.2 `CalendarDate`

- 规范形式：`YYYY-MM-DD`；
- 严格校验公历日期和闰年；
- 用于计划开始/结束日、计划支付日和实际发生日；
- 不经本地时区或 UTC 转换，避免日期漂移。

### 2.3 `Amount`

- 非负；权威精度两位小数；
- 领域与数据库缩放因子为 100；
- 输入超过两位小数直接拒绝，不静默舍入；
- 计算使用 `Decimal`，只在最终本位币结果处 `ROUND_HALF_UP`；
- IPC 使用固定两位十进制字符串，禁止浮点数。

### 2.4 `SignedAmount`

仅表示从条目派生的净实际和偏差，允许负值。用户不会直接输入负金额。

### 2.5 `ExchangeRate`

- 八位小数，缩放因子 100,000,000；
- 必须大于零；
- 表示 1 单位原币对应多少本位币；
- 本位币对自身必须为 1。

## 3. 枚举

### 3.1 类别与方向

| `Category` | 中文 | `FlowType` |
|---|---|---|
| `FIXED_INCOME` | 固定收入 | `INCOME` |
| `VARIABLE_INCOME` | 浮动收入 | `INCOME` |
| `ESSENTIAL_EXPENSE` | 必要支出 | `EXPENSE` |
| `FIXED_COMMITMENT_EXPENSE` | 固定承诺支出 | `EXPENSE` |
| `DISCRETIONARY_BUDGET` | 自主性预算 | `EXPENSE` |

收支方向由类别派生，不允许单独编辑。

### 3.2 计入模式

- `AMORTIZED`：有效月份均计入月均金额；
- `PAYMENT`：从原始开始日锚定，每隔周期月在计划支付日计入完整金额。

### 3.3 月度项目来源

- `PLANNED`：正式计划快照；
- `ACTUAL_ONLY`：计划外月份实际事实的零计划容器。

### 3.4 条目效果与来源

- `INCREASE` / `DECREASE`：增加或减少项目实际净额；
- `USER` / `AUTOMATIC` / `MIGRATED_AGGREGATE`：用户、自动或旧版聚合迁移条目。

## 4. 实体

### 4.1 `Settings`

| 字段 | 约束 |
|---|---|
| `base_currency` | 已定义币种，汇率为 1 |

存在任何月度快照或专项预算后不能切换本位币。

### 4.2 `PlanItem`

| 字段 | 约束 |
|---|---|
| `id` | UUID |
| `name` | NFKC 规范化、去首尾空格后非空且唯一 |
| `category` | 固定类别 |
| `amount` | 非负两位金额 |
| `currency` | 已定义币种 |
| `period_months` | 正整数 |
| `start_date` | 必填日级日期 |
| `end_date` | 可空，不早于开始日 |
| `recognition_mode` | `AMORTIZED` / `PAYMENT` |
| `note` | 可空 |

### 4.3 `MonthlyItem`

| 字段 | 语义 |
|---|---|
| `source_plan_item_id` | 可空；删除计划时脱离而非级联删除 |
| `source_special_project_id` / `source_special_allocation_id` | 专项来源；分配可空，均限制删除 |
| `month` | 月初锚点 |
| 快照名称/类别/方向/模式 | 创建时冻结 |
| `item_source` | `PLANNED` / `ACTUAL_ONLY` |
| `item_origin` | `PLAN_LINKED` / `MANUAL` / `SPECIAL_PROJECT` |
| `scheduled_date` | 仅正式 PAYMENT 快照有值 |
| `planned_amount` | 已完成汇率与周期计算的本位币金额 |
| `currency` | 创建时的本位币 |
| `note` | 月度备注 |

`actual_amount`、条目数、偏差和完成率是查询投影，不是持久化字段。月度类目没有确认或完成状态。

### 4.4 `ActualEntry`

| 字段 | 约束 |
|---|---|
| `id` | UUID |
| `monthly_item_id` | 必填外键 |
| `occurred_on` | 日级日期且与月度项目同月 |
| `effect` | `INCREASE` / `DECREASE` |
| `amount` | 严格大于零的两位金额 |
| `origin` | `USER` / `AUTOMATIC` / `MIGRATED_AGGREGATE` |
| `detail_group` | 可空明细组，不替代财务类别 |
| `note` | 可空 |

```text
derived_actual = SUM(INCREASE.amount) - SUM(DECREASE.amount)
```

派生实际允许为负。迁移条目不可编辑或删除。

### 4.5 自动策略与发生槽

`AutomaticEntryPolicy` 按计划 ID 保存开关和本次开启的起始月份。缺省关闭，关闭再开启也只从下月开始。`AutomaticPolicyVersion` 按规则 UUID 与生效月冻结规则元数据、原币完整支付金额、币种、周期和首次支付日；未来版本可更新，当前版本保持不变。

`AutomaticOccurrence` 按规则 UUID 与月份唯一。状态为 `POSTED`、`CONFLICT`、`SKIPPED`、`DELETED` 或 `FAILED`。已完成、跳过及删除均消费发生槽；失败可重试，冲突只能由明确动作处理。实际与发生槽在同一事务形成，实际编辑不修改槽的支付身份。

### 4.6 `SpecialProject` 与 `SpecialAllocation`

专项保存名称、总预算、本位币、归档标记及备注。总预算不等于月度预算；月分配明确指定月份、三类支出之一和非负金额。分配合计不能超过总预算，实际超支可保存。

同一专项、月份、类别只有一个 `SPECIAL_PROJECT` 月度容器。分配创建正式 `PLANNED` 快照，无分配实际创建 `ACTUAL_ONLY`；后续允许的分配可原位提升，保留 ID 和实际。专项使用 `AMORTIZED` 作为无支付日的存储标记，但金额直接取月分配，不执行周期均摊公式。

专项实际仍为 `ActualEntry`，项目归属从月度父项派生，没有副本。未分配预算为总预算减分配合计；净剩余预算为总预算减实际净支出。归档不删除事实，也不把未分配池自动分摊或滚动。

## 5. 计入规则

### 5.1 AMORTIZED 日级交集

```text
effective(month) =
  start_date <= month_last_day
  AND (end_date IS NULL OR end_date >= month_first_day)
```

有效时：

```text
planned = ROUND_HALF_UP(amount × rate ÷ period_months, 2)
```

同一月只生成完整月均值，不按天数比例折算。

### 5.2 PAYMENT 原始日锚点

令 `month_offset` 为开始月份到目标月份的整月差：

```text
candidate = month_offset >= 0
            AND month_offset % period_months = 0
scheduled_date = target_month.clamp_day(start_date.day)
recognized = candidate
             AND scheduled_date >= start_date
             AND (end_date IS NULL OR scheduled_date <= end_date)
```

有效时：

```text
planned = ROUND_HALF_UP(amount × rate, 2)
```

每月都从原始 `start_date.day` 计算，不能把 2 月夹短后的日期当成新锚点。

## 6. 初始化用例

输入：月份、确认标记、可选临时汇率覆盖。输出：新增、保留、排除数量和警告。

事务内：

1. 锁定初始化操作并读取计划；
2. 找出既有正式快照和仅实际快照；
3. 预先解析所有必要汇率，缺失则整体失败；
4. 为可计入计划创建快照；
5. 遇到同来源、同月 `ACTUAL_ONLY` 时原位提升；
6. 唯一键和事务保证并发及重复执行幂等。

原位提升不改变月度项目 ID，也不删除实际条目。

## 7. 实际条目用例

### 7.1 全局添加

用户选择已有长期计划和月份：

- 已有月度项目：直接写入条目；
- 没有月度项目且计划仍存在：先确保 `ACTUAL_ONLY`，再写条目；
- 计划已结束：允许并提示迟到事实；
- 计划已删除或快照已脱离来源：拒绝新条目。

用户也可不选择长期计划，直接创建 `MANUAL + ACTUAL_ONLY` 临时类目。它允许新增实际条目并参与实际汇总，但不计算计划偏差；这与计划删除后留下的 `PLAN_LINKED` 脱离快照是不同来源。临时类目可以连同其实际条目一起删除，预算快照不能通过该入口删除。

### 7.2 上下文添加

从月度项目卡片进入时，项目固定不可改。支出显示“支出/退款”，收入显示“收入/冲减”。

### 7.3 编辑与删除

允许编辑、删除 `USER` 和 `AUTOMATIC` 条目；禁止把条目改挂其他月度项目。领域层验证日期与月份，数据库触发器再次防守。删除自动关联实际会在同一事务保留 `DELETED` 发生槽。

## 8. 实际存在性

- 条目数为 0 时，`actual_amount` 为 `null`；
- 条目数大于 0 时，`actual_amount` 为增加条目减去减少条目的净额；
- 净额可以是零或负数；
- 类目不具有待处理、已确认或已完成状态，也没有单项或批量确认命令。

## 9. 分析投影

- 计划汇总包含 `PLANNED` 和零计划的 `ACTUAL_ONLY`；
- 实际汇总只使用有条目的项目；
- 退款减少实际支出，冲减减少实际收入；
- 项目、类别、月度、历史趋势和重要偏差均从同一查询口径派生；
- 除数为零时比例为 `null`，不得输出 NaN 或无穷大。

下月预算投影读取下一个自然月有效的周期规则及汇率，以月度等价金额计算：

```text
projected_income = stable_income + variable_income
projected_expenses = essential_expenses + fixed_commitments + discretionary_budget
projected_savings = projected_income - projected_expenses
projected_savings_rate = projected_savings / projected_income
```

`projected_savings` 使用带符号金额并保留负缺口；收入为零时储蓄率为 `null`。投影不持久化，也不读取独立储蓄目标。

支出类别及合计加入专项在下月的明确分配金额。周期月均支出与专项月分配分别返回，专项总预算与未分配额度不进入投影。自动实际也不进入预算投影。

## 10. 不变量

1. 月度快照币种等于创建时本位币；
2. 同一来源计划、同一月份最多一个月度项目；
3. `ACTUAL_ONLY` 的计划额为零且无支付日；
4. 正式 PAYMENT 快照必须有支付日，正式 AMORTIZED 快照不得有；
5. 实际条目日期与所属月一致且金额为正；
6. 用户不可修改系统快照字段或迁移条目；
7. 删除长期计划不删除历史快照与条目；
8. 只有无计划来源的 `MANUAL + ACTUAL_ONLY` 临时类目可由用户删除，删除与其条目在同一事务完成；
9. 所有权威金额在分精度内表达，派生净额可带符号。

## 11. 应用服务接口

主要命令：

- 设置/汇率/长期计划 CRUD 与计划预览；
- `preview_month`、`initialize_month`、自动当前月初始化；
- `list_monthly_items`、`update_monthly_note`；
- `ensure_actual_only_monthly_item`；
- `create_manual_monthly_item`、`delete_manual_monthly_item`；
- `list/create/update/delete_actual_entry`；
- 月度、历史与下月预算投影查询。

所有金额跨 IPC 使用字符串，错误返回稳定错误码、可选字段名和本地化消息键。
