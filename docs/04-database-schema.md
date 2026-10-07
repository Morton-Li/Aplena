# Aplena 数据库 Schema

当前正式 schema：6
数据库：SQLite STRICT tables + foreign keys + WAL

## 1. 存储约定

```text
AMOUNT_SCALE = 100
RATE_SCALE   = 100_000_000
```

- 金额列以分为单位存为 64 位 `INTEGER`；
- 汇率列以八位缩放整数存储；
- IPC 不暴露缩放整数；
- 日期为规范 `YYYY-MM-DD` 文本；月份为当月第一日；
- 时间戳为 UTC ISO 8601 文本；
- UUID 存为 36 字符文本；
- 没有实际条目时派生实际为 `NULL`，不能擅自解释为零。

schema 6 在原财务表之外新增专项、月分配及三张自动入账表。`software_update_preferences` 只保存软件更新运行偏好；SQLx 自有迁移表不属于业务模型。

## 2. `settings`

单行设置：

| 字段 | 类型 | 约束 |
|---|---|---|
| `id` | INTEGER | 固定 1 |
| `base_currency_code` | TEXT | 外键到汇率 |
| `auto_update_exchange_rates` | INTEGER | 0 / 1，默认 0 |
| `created_at` / `updated_at` | TEXT | 非空 |

触发器保证本位币汇率为 1，并在已有月度项目或专项预算后禁止切换本位币。

## 3. `exchange_rates`

| 字段 | 类型 | 约束 |
|---|---|---|
| `currency_code` | TEXT | 三位大写 ASCII，主键 |
| `rate_scaled` | INTEGER | > 0 |
| `updated_at` | TEXT | 非空 |
| `source` | TEXT | 非空；`BASE_CURRENCY` / `ECB_REFERENCE` / `MANUAL` |
| `observed_on` | TEXT | 可空；参考或手动汇率的观察日期 |

计划通过外键阻止删除仍被使用的币种。本位币汇率不能改离 1。

## 4. `plan_items`

| 字段 | 类型 | 可空 | 约束 |
|---|---|---:|---|
| `id` | TEXT | 否 | UUID 主键 |
| `name` | TEXT | 否 | 去空后非空，唯一 |
| `category` | TEXT | 否 | 五种固定代码 |
| `planned_amount_scaled` | INTEGER | 否 | >= 0，单位分 |
| `currency_code` | TEXT | 否 | 汇率外键，限制更新/删除 |
| `period_months` | INTEGER | 否 | > 0 |
| `recognition_mode` | TEXT | 否 | `AMORTIZED` / `PAYMENT` |
| `start_date` | TEXT | 否 | 合法日级日期 |
| `end_date` | TEXT | 是 | 合法且 >= 开始日 |
| `note` | TEXT | 是 | 用户备注 |
| `created_at` / `updated_at` | TEXT | 否 | 审计字段 |

索引：有效日期、类别。名称在应用层先 NFKC 规范化，数据库唯一约束是最终防线。

## 5. `monthly_items`

| 字段 | 类型 | 可空 | 语义 |
|---|---|---:|---|
| `id` | TEXT | 否 | UUID 主键，原位提升时保持 |
| `source_plan_item_id` | TEXT | 是 | 删除计划时 `SET NULL` |
| `source_special_project_id` | TEXT | 是 | 专项外键，限制删除 |
| `source_special_allocation_id` | TEXT | 是 | 已形成快照的分配外键，限制删除 |
| `month` | TEXT | 否 | 月初锚点 |
| `snapshot_name` | TEXT | 否 | 冻结名称 |
| `category` | TEXT | 否 | 冻结类别 |
| `flow_type` | TEXT | 否 | 与类别一致 |
| `recognition_mode` | TEXT | 否 | 冻结模式 |
| `item_source` | TEXT | 否 | `PLANNED` / `ACTUAL_ONLY` |
| `item_origin` | TEXT | 否 | `PLAN_LINKED` / `MANUAL` / `SPECIAL_PROJECT` |
| `scheduled_date` | TEXT | 是 | 同月日级支付日期 |
| `planned_amount_scaled` | INTEGER | 否 | 非负本位币分 |
| `currency_code` | TEXT | 否 | 创建时本位币 |
| `note` | TEXT | 是 | 月度备注 |
| `created_at` / `updated_at` | TEXT | 否 | 审计字段 |

核心约束：

```text
UNIQUE(source_plan_item_id, month)
UNIQUE(source_special_project_id, month, category)

ACTUAL_ONLY => planned_amount_scaled = 0 AND scheduled_date IS NULL
MANUAL => source_plan_item_id IS NULL AND item_source = ACTUAL_ONLY
SPECIAL_PROJECT => source_special_project_id IS NOT NULL AND source_plan_item_id IS NULL
SPECIAL_PROJECT + PLANNED => source_special_allocation_id IS NOT NULL
PLANNED + AMORTIZED => scheduled_date IS NULL
PLANNED + PAYMENT => scheduled_date IS NOT NULL
```

类别与方向也有 CHECK。插入触发器要求月度币种等于设置中的本位币，并防止手动项目伪装成计划快照。

索引：月份、月份+类别+方向、来源计划、专项+月份。专项正式快照必须与分配的项目、月份、类别和金额一致，且计划字段不可改写；专项的仅实际容器可在允许的分配生成时原位提升。

不存在 `actual_amount_scaled` 列；实际净额必须从条目聚合。

## 6. `actual_entries`

| 字段 | 类型 | 可空 | 约束 |
|---|---|---:|---|
| `id` | TEXT | 否 | UUID 主键 |
| `monthly_item_id` | TEXT | 否 | 月度项目外键，限制删除 |
| `occurred_on` | TEXT | 否 | 合法日级日期 |
| `effect` | TEXT | 否 | `INCREASE` / `DECREASE` |
| `amount_scaled` | INTEGER | 否 | > 0，单位分 |
| `source_amount_scaled` | INTEGER | 否 | > 0，录入币种金额，单位分 |
| `source_currency_code` | TEXT | 否 | 录入币种外键 |
| `exchange_rate_scaled` | INTEGER | 否 | > 0，录入时固化的八位汇率 |
| `exchange_rate_source` | TEXT | 否 | 本位币、ECB、手动或预发布迁移来源 |
| `exchange_rate_observed_on` | TEXT | 否 | 固化汇率的观察日期 |
| `origin` | TEXT | 否 | `USER` / `AUTOMATIC` / `MIGRATED_AGGREGATE` |
| `note` | TEXT | 是 | 备注或迁移说明 |
| `detail_group` | TEXT | 是 | 明细用途，不替代类别 |
| `created_at` / `updated_at` | TEXT | 否 | 审计字段 |

插入和更新触发器检查 `occurred_on` 与月度项目同月。

删除触发器及应用删除事务把关联自动发生槽置为 `DELETED`，即使该实际是冲突后关联的用户条目，也不会在以后检查时重建。

索引：月度项目+日期+ID、发生日期。

## 7. 查询投影

标准月度项目读取使用 `LEFT JOIN`：

```sql
CASE
  WHEN COUNT(e.id) > 0
  THEN SUM(
    CASE e.effect
      WHEN 'INCREASE' THEN e.amount_scaled
      ELSE -e.amount_scaled
    END
  )
  ELSE NULL
END AS derived_actual_amount_scaled
```

同时返回 `COUNT(e.id)`。应用层不再推导类目的确认或完成状态。

实际净额可为负，不能套用计划金额的非负约束。

## 8. `software_update_preferences`

独立单行设置，不混入财务 `settings`：

| 字段 | 类型 | 约束 |
|---|---|---|
| `id` | INTEGER | 固定 1 |
| `auto_check_updates` | INTEGER | 0 / 1，默认 1 |
| `last_checked_at` | TEXT | 可空 |
| `last_check_status` | TEXT | 可空；`UP_TO_DATE` / `UPDATE_AVAILABLE` / `FAILED` |
| `created_at` / `updated_at` | TEXT | 非空 |

上次检查时间与结果必须同时为空或同时存在。下载进度、待安装包和重启状态不持久化，应用重开后重新检查，避免把过期临时文件当作权威状态。

## 9. 写入矩阵

| 操作 | 可修改内容 | 保护 |
|---|---|---|
| 创建/编辑计划 | 计划字段 | 不反写历史快照 |
| 停止计划 | `end_date` | 历史保留 |
| 删除计划 | 删除计划、快照来源置空 | 快照/条目保留 |
| 初始化 | 新增正式快照 | 事务、唯一键、汇率完整 |
| 原位提升 | 仅实际快照变正式快照字段 | 条目、ID 保留 |
| 更新月度备注 | `note` | 快照计划字段只读 |
| 条目 CRUD | 用户条目字段 | 日期同月、正金额、禁止改挂 |
| 自动入账 | 自动实际、月度容器、发生槽 | 同事务、规则+月唯一、删除墓碑 |
| 专项预算/分配 | 项目头、未冻结未来分配 | 分配合计约束、快照冻结、固定本位币 |
| 删除临时类目 | `MANUAL + ACTUAL_ONLY` 类目及其条目 | 事务、预算快照拒绝删除 |
| 分析 | 无写入 | 实时查询 |
| 软件更新偏好/检查结果 | 独立单行表 | 不修改财务设置和业务表 |

## 10. 正式迁移基线

- `0001_initial_release.sql`：首个公开版的完整六表结构、7 个业务索引和 12 个触发器；
- `0002_remove_monthly_item_status.sql`：移除 `actual_confirmed_at` 及 3 个条目变更重开触发器，保留 9 个业务触发器；
- `0003_remove_next_month_goal.sql`：删除 `next_month_goal` 表及其中旧目标数据，当前业务结构为五张表；
- `0004_add_automatic_rate_refresh.sql`：在设置中保存启动时自动更新汇率偏好；
- `0005_add_software_update_preferences.sql`：新增独立软件更新偏好和最近检查结果；
- `0006_budget_specials.sql`：保留旧月度/实际记录并扩展来源、专项归属与明细组，新增专项及自动入账表和保护触发器；
- 新安装的 `_sqlx_migrations` 顺序记录 schema 1 至 schema 6；
- 基线不包含旧金额转换、临时表、过渡列或数据搬运语句；
- 正式发布后的变更只允许追加迁移，不再改写 schema 1。

预发布六段迁移的最终结构已冻结为测试夹具。自动测试先把 schema 2 至 schema 6 变更应用到冻结夹具，再比较财务结构，并单独验证偏好的默认值及 schema 5 财务事实升级后的完整性；同时验证高版本预发布库会在不修改内容的前提下被拒绝。现有本地预发布数据必须遵循[独立换轨方案](08-pre-release-database-transition.md)，不能直接修改 `_sqlx_migrations`。

发现未来 schema 时拒绝启动，不做降级写入。任何正式迁移失败都会阻止应用进入业务流程。

## 11. `special_projects` 与 `special_allocations`

项目列为 `id`、`name`、`total_budget_scaled`、`currency_code`、`archived`、`note` 和审计时间。总预算非负，归档标记为 0/1，本位币与设置一致。归档不删除记录，也不改变已有分配。

分配列为 `id`、`project_id`、`month`、`category`、`amount_scaled` 和审计时间。类别限定三类支出，金额非负，`UNIQUE(project_id, month, category)`。项目与分配外键限制删除；已被月度快照引用的分配不能改月份、类别、金额或项目归属。应用在写事务内验证分配合计不超过总预算。

## 12. `automatic_entry_policies`

按 `plan_item_id` 唯一，保存 `enabled`、`enabled_from_month` 和审计时间。没有行代表关闭；开启必须有规范月初生效月份。规则删除时策略级联删除，版本和已发生实际保留。

## 13. `automatic_policy_versions`

版本列为 `id`、可空 `plan_item_id`、稳定 `rule_key`、`effective_month`、`snapshot_name`、`category`、`recognition_mode`、`start_date`、`amount_scaled`、`currency_code`、`period_months`、`first_date`、可空 `end_date`、`note` 与创建时间。金额为完整单次原币额，周期正整数，`UNIQUE(rule_key, effective_month)`。规则删除时来源引用置空，版本仍可供发生记录审计；已经生效的版本不随规则修改更新。

## 14. `automatic_occurrences`

保存 `id`、`rule_key`、`month`、`state`、`policy_version_id`、`occurred_on`、可空 `actual_entry_id`、可空 `monthly_item_id`、可空 `error_code` 和审计时间。状态限定 `POSTED`、`CONFLICT`、`SKIPPED`、`DELETED`、`FAILED`。`UNIQUE(rule_key, month)` 是普通支付发生槽屏障，`actual_entry_id` 也唯一；发生日与槽月份相同。

实际删除时关联 ID 置空并留下墓碑；策略版本与月度容器引用限制删除。发生槽不使用金额或修改时间作身份，编辑金额、重复点击和重开不能绕过去重。失败允许重试；冲突须由关联、跳过或另建的显式动作解决。
