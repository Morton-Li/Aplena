# Aplena 数据库 Schema

当前正式 schema：2
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

六张核心业务表以外，SQLx 自有迁移表不属于业务模型。

## 2. `settings`

单行设置：

| 字段 | 类型 | 约束 |
|---|---|---|
| `id` | INTEGER | 固定 1 |
| `base_currency_code` | TEXT | 外键到汇率 |
| `created_at` / `updated_at` | TEXT | 非空 |

触发器保证本位币汇率为 1，并在已有月度项目后禁止切换本位币。

## 2.1 `next_month_goal`

单行前瞻目标：

| 字段 | 类型 | 约束 |
|---|---|---|
| `id` | INTEGER | 固定 1 |
| `target_month` | TEXT | 合法月初，由后端固定为下一个自然月 |
| `minimum_savings_rate_bp` | INTEGER | 0–10000 |
| `created_at` / `updated_at` | TEXT | 非空 |

该表不与 `monthly_items` 建外键，也不参与月度和历史分析；它只为下月承载力提供输入。

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
| `month` | TEXT | 否 | 月初锚点 |
| `snapshot_name` | TEXT | 否 | 冻结名称 |
| `category` | TEXT | 否 | 冻结类别 |
| `flow_type` | TEXT | 否 | 与类别一致 |
| `recognition_mode` | TEXT | 否 | 冻结模式 |
| `item_source` | TEXT | 否 | `PLANNED` / `ACTUAL_ONLY` |
| `item_origin` | TEXT | 否 | `PLAN_LINKED` / `MANUAL` |
| `scheduled_date` | TEXT | 是 | 同月日级支付日期 |
| `planned_amount_scaled` | INTEGER | 否 | 非负本位币分 |
| `currency_code` | TEXT | 否 | 创建时本位币 |
| `note` | TEXT | 是 | 月度备注 |
| `created_at` / `updated_at` | TEXT | 否 | 审计字段 |

核心约束：

```text
UNIQUE(source_plan_item_id, month)

ACTUAL_ONLY => planned_amount_scaled = 0 AND scheduled_date IS NULL
MANUAL => source_plan_item_id IS NULL AND item_source = ACTUAL_ONLY
PLANNED + AMORTIZED => scheduled_date IS NULL
PLANNED + PAYMENT => scheduled_date IS NOT NULL
```

类别与方向也有 CHECK。插入触发器要求月度币种等于设置中的本位币，并防止手动项目伪装成计划快照。

索引：月份、月份+类别+方向、来源计划。

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
| `origin` | TEXT | 否 | `USER` / `MIGRATED_AGGREGATE` |
| `note` | TEXT | 是 | 备注或迁移说明 |
| `created_at` / `updated_at` | TEXT | 否 | 审计字段 |

插入和更新触发器检查 `occurred_on` 与月度项目同月。

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

## 8. 写入矩阵

| 操作 | 可修改内容 | 保护 |
|---|---|---|
| 创建/编辑计划 | 计划字段 | 不反写历史快照 |
| 停止计划 | `end_date` | 历史保留 |
| 删除计划 | 删除计划、快照来源置空 | 快照/条目保留 |
| 初始化 | 新增正式快照 | 事务、唯一键、汇率完整 |
| 原位提升 | 仅实际快照变正式快照字段 | 条目、ID 保留 |
| 更新月度备注 | `note` | 快照计划字段只读 |
| 条目 CRUD | 用户条目字段 | 日期同月、正金额、禁止改挂 |
| 删除临时类目 | `MANUAL + ACTUAL_ONLY` 类目及其条目 | 事务、预算快照拒绝删除 |
| 分析 | 无写入 | 实时查询 |

## 9. 正式迁移基线

- `0001_initial_release.sql`：首个公开版的完整六表结构、7 个业务索引和 12 个触发器；
- `0002_remove_monthly_item_status.sql`：移除 `actual_confirmed_at` 及 3 个条目变更重开触发器，保留 9 个业务触发器；
- 新安装的 `_sqlx_migrations` 顺序记录 schema 1 与 schema 2；
- 基线不包含旧金额转换、临时表、过渡列或数据搬运语句；
- 正式发布后的变更只允许追加迁移，不再改写 schema 1。

预发布六段迁移的最终结构已冻结为测试夹具。自动测试先把 schema 2 变更应用到冻结夹具，再比较 `sqlite_schema`、列、类型、默认值、非空与主键、外键、索引列、触发器和 STRICT 属性；同时验证高版本预发布库会在不修改内容的前提下被拒绝。现有本地预发布数据必须遵循[独立换轨方案](08-pre-release-database-transition.md)，不能直接修改 `_sqlx_migrations`。

发现未来 schema 时拒绝启动，不做降级写入。任何正式迁移失败都会阻止应用进入业务流程。
