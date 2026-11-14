# 数据库与迁移

当前迁移版本为 **schema 9**，以 [`src-tauri/migrations`](../src-tauri/migrations) 的有序 SQL 为准。本文描述最新逻辑结构；产品语义见[产品与使用](product.md)，金额与事务规则见[架构与领域](architecture.md)。

## 存储协议与表索引

SQLite 使用 STRICT 表、外键及 WAL。金额以分为单位存入 64 位 `INTEGER`，汇率以 `100_000_000` 缩放；对外均为十进制字符串。UUID 为文本，业务日期为 `YYYY-MM-DD`，月份存月初锚点，审计时间为 UTC 文本。

| 分组 | 表 |
|---|---|
| 设置与规则 | `settings`、`exchange_rates`、`plan_items` |
| 月度事实 | `monthly_items`、`actual_entries` |
| 专项 | `special_projects`、`special_allocations` |
| 自动入账 | `automatic_entry_policies`、`automatic_policy_versions`、`automatic_occurrences` |
| 借贷 | `loans`、`loan_schedule_versions`、`loan_installments`、`loan_payments`、`loan_payment_allocations`、`loan_monthly_items`、`loan_actual_links`、`loan_advances` |
| 独立运行偏好 | `software_update_preferences` |

最新结构共 19 张应用表，另有 SQLx 自有 `_sqlx_migrations` 和两张本金视图。总览、月报、年报、余额、逾期、净实际和下月预算均为查询投影，不建业务副本。

以下只列字段与关键保护，不复制每条 SQL。除特别注明外，业务实体有 `id`，可变记录有 `created_at` / `updated_at`；精确列与索引应查看对应迁移。

## 设置、汇率与周期规则

### `settings`

单行 `id = 1`。`base_currency_code` 引用汇率表，`auto_update_exchange_rates` 为 0/1、默认 0。插入/更新触发器要求本位币汇率为 1。存在任何月度项目、专项或借贷时禁止切换本位币。

### `exchange_rates`

| 字段 | 约束或用途 |
|---|---|
| `currency_code` | 三位大写 ASCII 主键 |
| `rate_scaled` | 正整数，一单位原币对应多少本位币 |
| `source` | `BASE_CURRENCY` / `ECB_REFERENCE` / `MANUAL` |
| `observed_on` | 可空，参考或手动观察日期 |
| `rebased_from_currency` / `rebased_on` | schema 9 增加，成对为空或成对存在；标记切换本位币产生的折算依据 |
| `updated_at` | 最近更新 |

折算汇率以 `MANUAL` 保存，`observed_on` 为空，折算日独立保存，不能冒充官方观察日。手动更新或导入官方汇率替换折算依据。本位币汇率不能改离 1；币种被引用时禁止删除。

### `plan_items`

保存 `name`、`category`、`planned_amount_scaled`、`currency_code`、`period_months`、`recognition_mode`、`start_date`、可空 `end_date` / `note`。名称非空且唯一；金额非负；月周期正整数；结束日期不得早于开始日。

类别限定五类，模式限定 `AMORTIZED` / `PAYMENT`，币种外键限制更新/删除。应用先做名称 NFKC 规范化，数据库唯一键兜底。有效日期及类别有查询索引。

## 月度快照与实际

### `monthly_items`

| 字段组 | 字段与语义 |
|---|---|
| 身份/月份 | `id`、`month`；月份为合法月初 |
| 规则来源 | 可空 `source_plan_item_id`，删除规则时 `SET NULL`，保留历史 |
| 专项来源 | 可空 `source_special_project_id` / `source_special_allocation_id`，均限制删除 |
| 冻结计划 | `snapshot_name`、`category`、`flow_type`、`recognition_mode`、`planned_amount_scaled`、`currency_code`、可空 `scheduled_date` |
| 来源分类 | `item_source` 为 `PLANNED` / `ACTUAL_ONLY`；`item_origin` 为 `PLAN_LINKED` / `MANUAL` / `SPECIAL_PROJECT` |
| 月度备注 | 可空 `note` |

关键唯一键与约束：

```text
UNIQUE(source_plan_item_id, month)
UNIQUE(source_special_project_id, month, category)
UNIQUE(source_special_allocation_id)

ACTUAL_ONLY → 计划额为 0，支付日为空
MANUAL → 无规则来源，且为 ACTUAL_ONLY
PLANNED + AMORTIZED → 无支付日
PLANNED + PAYMENT → 有同月支付日
SPECIAL_PROJECT → 有专项来源、无规则来源、支出、AMORTIZED、无支付日
SPECIAL_PROJECT + PLANNED → 有月分配来源
```

类别必须与方向一致。插入时币种必须与设置一致。专项正式快照必须匹配月分配的项目、月份、类别及金额，形成后冻结相关计划字段。其他规则快照的冻结也由应用写入边界保证，不能据此认为任意 SQL 更新都会被触发器拒绝。

索引覆盖月份、月份+类别+方向、来源规则和专项+月份。借贷月度容器通过 `loan_monthly_items` 识别，不增加新的 `item_origin` 枚举。

### `actual_entries`

| 字段 | 约束或用途 |
|---|---|
| `monthly_item_id` | 必填，外键限制删除 |
| `occurred_on` | 合法日期，插入/更新触发器要求与父项目同月 |
| `effect` | `INCREASE` / `DECREASE` |
| `amount_scaled` | 换算后的本位币金额，严格为正 |
| `source_amount_scaled` / `source_currency_code` | 原币正金额与币种外键 |
| `exchange_rate_scaled` | 当次正汇率快照 |
| `exchange_rate_source` | `BASE_CURRENCY` / `ECB_REFERENCE` / `MANUAL` / `MIGRATED_BASE` |
| `exchange_rate_observed_on` | 非空日期，旧协议中的快照日期字段 |
| `exchange_rate_rebased_from_currency` / `exchange_rate_rebased_on` | schema 9 增加，成对保存折算来源与日期 |
| `origin` | `USER` / `AUTOMATIC` / `MIGRATED_AGGREGATE` |
| `detail_group` / `note` | 可空，明细组不替代财务类别 |

折算快照以 `MANUAL` 保存，旧非空日期列填折算日，另用新增字段明确其语义。插入触发器要求折算币种、汇率、来源本位币与折算日匹配当前已保存依据；后续汇率变化不改旧实际。

索引覆盖月度项目+日期+ID、发生日期。应用禁止改挂月度项目及修改迁移条目。借贷触发器另行保护受管实际；删除自动关联实际则留下 `DELETED` 发生槽。

### 净实际查询

`monthly_items` 不存在 `actual_amount_scaled` 或确认状态列。Store 使用 `LEFT JOIN` 聚合：

```sql
CASE WHEN COUNT(e.id) > 0 THEN
  SUM(CASE e.effect WHEN 'INCREASE' THEN e.amount_scaled ELSE -e.amount_scaled END)
ELSE NULL END AS derived_actual_amount_scaled
```

同时返回条目数。零条目与净额为零不能混同，净实际允许负数。

## 专项

| 表 | 核心字段与保护 |
|---|---|
| `special_projects` | `name`、非负 `total_budget_scaled`、`currency_code`、0/1 `archived`、`note`；插入币种等于本位币 |
| `special_allocations` | `project_id`、`month`、三类支出之一的 `category`、非负 `amount_scaled`；`UNIQUE(project_id, month, category)` |

项目/分配引用限制删除。被月度快照引用的分配，不能变更项目、月份、类别、金额；外键也阻止删除。应用在事务中校验分配合计不超过总预算。归档不删除事实。实际通过月度父项归属专项，不存第二份条目。

## 自动入账

| 表 | 身份与内容 |
|---|---|
| `automatic_entry_policies` | 主键 `plan_item_id`，保存开关 `enabled`、可空 `enabled_from_month` 及审计时间；无行代表关闭，开启必须有生效月；规则删除时级联删除 |
| `automatic_policy_versions` | `id`、可空 `plan_item_id`、稳定 `rule_key`、`effective_month`、冻结规则名/类别/模式/有效期、完整原币 `amount_scaled`、币种、周期、`first_date`、备注与创建时间；`UNIQUE(rule_key, effective_month)` |
| `automatic_occurrences` | `id`、`rule_key`、`month`、`state`、`policy_version_id`、同月 `occurred_on`、可空 `actual_entry_id` / `monthly_item_id` / `error_code` 与审计时间 |

发生槽 `UNIQUE(rule_key, month)`，`actual_entry_id` 也唯一。状态为 `POSTED`、`CONFLICT`、`SKIPPED`、`DELETED`、`FAILED`。版本与月度容器引用限制删除；规则删除只使版本来源置空，保留审计身份。

当前版本冻结、未来版本更新由应用维护。实际删除触发器把关联槽置为 `DELETED`、清空关联及错误，即使关联的是冲突处理后选中的手动实际也一样。幂等与重试语义见[架构与领域](architecture.md)。

## 借贷

| 表 | 核心字段与用途 |
|---|---|
| `loans` | 名称、对方、`BORROWED` / `LENT`、本位币、正数初始本金、跟踪开始日、`opening_only`、归档及备注 |
| `loan_schedule_versions` | `loan_id`、日/月/季/年 `frequency`、`interval_count`、`MANUAL` / `EQUAL_PRINCIPAL` / `ANNUITY`、文本每期利率及说明 |
| `loan_installments` | 合同、版本、期次位置、到期日、本金/利息/费用、`superseded`；版本内位置唯一 |
| `loan_payments` | 稳定请求 `id`、合同、实际日、本金/利息/费用、备注与更新时间 |
| `loan_payment_allocations` | 收付、可空期次、本金/利息/费用；付款删除时级联删除分配 |
| `loan_monthly_items` | `monthly_item_id` 主键、合同、月份；`UNIQUE(loan_id, month)`，归集利息费用 |
| `loan_actual_links` | `payment_id` 主键、唯一 `actual_entry_id`，收付与月度实际一对一 |
| `loan_advances` | 合同、实际日期、正数追加本金、备注与审计时间 |

分期/收付/分配的各组成金额非负且至少一项为正。版本/期次/实际关联外键限制删除，应用在事务内维护关联。触发器保护合同归属、本位币锁、受管实际与日终本金余额；分配合计、期次上限及乐观并发由应用校验。

schema 8 的两张视图统一读取本金：

- `loan_principal_movements`：初始本金、正追加、负归还，期初余额标记 `is_cash = 0`。
- `loan_daily_principal_balances`：按合同、发生日累加本金。还款以及追加编辑/删除若造成任一日终余额为负则拒绝。

余额、逾期、结清及计划核对状态都派生计算，不以手工字段保存。

## 软件更新偏好

`software_update_preferences` 为独立单行表 `id = 1`，`auto_check_updates` 默认 1，与财务设置的自动汇率偏好无关。`last_checked_at` / `last_check_status` 必须同时为空或同时存在；结果为 `UP_TO_DATE`、`UPDATE_AVAILABLE`、`FAILED`。

下载进度、待安装包和重启状态不持久化，重开后重新检查。

## 迁移链与兼容边界

| 迁移 | 作用 |
|---|---|
| [`0001_initial_release.sql`](../src-tauri/migrations/0001_initial_release.sql) | 正式基线，压缩早期预发布演进；仍包含后来被移除的完整状态与下月目标 |
| [`0002_remove_monthly_item_status.sql`](../src-tauri/migrations/0002_remove_monthly_item_status.sql) | 删除完整状态列及条目变更重开触发器 |
| [`0003_remove_next_month_goal.sql`](../src-tauri/migrations/0003_remove_next_month_goal.sql) | 删除下月目标表及旧目标数据 |
| [`0004_add_automatic_rate_refresh.sql`](../src-tauri/migrations/0004_add_automatic_rate_refresh.sql) | 自动更新汇率偏好 |
| [`0005_add_software_update_preferences.sql`](../src-tauri/migrations/0005_add_software_update_preferences.sql) | 独立软件更新偏好 |
| [`0006_budget_specials.sql`](../src-tauri/migrations/0006_budget_specials.sql) | 重建月度/实际子表并保留事实，增加专项、自动入账、来源和明细组 |
| [`0007_loans.sql`](../src-tauri/migrations/0007_loans.sql) | 双向借贷七表与保护触发器 |
| [`0008_loan_advances.sql`](../src-tauri/migrations/0008_loan_advances.sql) | 追加本金、统一本金视图、日终余额保护 |
| [`0009_exchange_rate_derivations.sql`](../src-tauri/migrations/0009_exchange_rate_derivations.sql) | 汇率与实际快照的折算来源/日期 |

新库顺序运行 1–9；已有正式库顺序追加未运行迁移，SQLx 校验已运行迁移的校验和。已发布 SQL 不可改写，只能追加新迁移。

[`database.rs`](../src-tauri/src/infrastructure/database.rs) 在运行迁移前读取成功版本最大值：高于当前支持版本时返回 `FutureSchema`。旧预发布六步链与正式基线不是同一条链，当前不能只凭版本号判定兼容；它会因已有迁移校验和不匹配被拒绝。禁止手改 `_sqlx_migrations` 来绕过检查。

冻结的预发布结构和 schema 5 数据夹具位于 [`src-tauri/tests/fixtures`](../src-tauri/tests/fixtures)，迁移回归位于 [`persistence_tests.rs`](../src-tauri/src/application/persistence_tests.rs)。旧库一次性转换需隔离副本、显式映射和逐项核对，操作边界见[开发、构建与发行](development.md)。应用没有内置导入、备份或恢复入口。
