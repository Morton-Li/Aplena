# Aplena 数据库 Schema

当前 schema：4
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
- `NULL` 确认时间与确认零有不同含义。

五张核心业务表以外，SQLx 自有迁移表不属于业务模型。

## 2. `settings`

单行设置：

| 字段 | 类型 | 约束 |
|---|---|---|
| `id` | INTEGER | 固定 1 |
| `target_month` | TEXT | 合法月初 |
| `base_currency_code` | TEXT | 外键到汇率 |
| `minimum_savings_rate_bp` | INTEGER | 0–10000 |
| `created_at` / `updated_at` | TEXT | 非空 |

触发器保证本位币汇率为 1，并在已有月度项目后禁止切换本位币。

## 3. `exchange_rates`

| 字段 | 类型 | 约束 |
|---|---|---|
| `currency_code` | TEXT | 三位大写 ASCII，主键 |
| `rate_scaled` | INTEGER | > 0 |
| `created_at` / `updated_at` | TEXT | 非空 |

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
| `actual_confirmed_at` | TEXT | 是 | 最终核对标记 |
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
| `origin` | TEXT | 否 | `USER` / `MIGRATED_AGGREGATE` |
| `note` | TEXT | 是 | 备注或迁移说明 |
| `created_at` / `updated_at` | TEXT | 否 | 审计字段 |

插入和更新触发器检查 `occurred_on` 与月度项目同月。插入、更新和删除触发器均把所属月度项目的 `actual_confirmed_at` 清空，并更新审计时间。

索引：月度项目+日期+ID、发生日期。

## 7. 查询投影

标准月度项目读取使用 `LEFT JOIN`：

```sql
CASE
  WHEN COUNT(e.id) > 0 OR m.actual_confirmed_at IS NOT NULL
  THEN COALESCE(SUM(
    CASE e.effect
      WHEN 'INCREASE' THEN e.amount_scaled
      ELSE -e.amount_scaled
    END
  ), 0)
  ELSE NULL
END AS derived_actual_amount_scaled
```

同时返回 `COUNT(e.id)`，应用层据此和确认时间推导 `MISSING`、`IN_PROGRESS`、`CONFIRMED_ZERO`、`FINAL`。

实际净额可为负，不能套用计划金额的非负约束。

## 8. 写入矩阵

| 操作 | 可修改内容 | 保护 |
|---|---|---|
| 创建/编辑计划 | 计划字段 | 不反写历史快照 |
| 停止计划 | `end_date` | 历史保留 |
| 删除计划 | 删除计划、快照来源置空 | 快照/条目保留 |
| 初始化 | 新增正式快照 | 事务、唯一键、汇率完整 |
| 原位提升 | 仅实际快照变正式快照字段 | 条目、ID、确认保留 |
| 更新月度备注 | `note` | 快照计划字段只读 |
| 条目 CRUD | 用户条目字段 | 日期同月、正金额、禁止改挂 |
| 确认 | `actual_confirmed_at` | 不创建条目或总额 |
| 分析 | 无写入 | 实时查询 |

## 9. 迁移链

- `0001_initial.sql`：最初四表模型；
- `0002_monthly_source_index.sql`：月度来源查询索引；
- `0003_actual_entries_daily_dates_cents.sql`：五表、日级日期、分精度与实际条目模型；
- `0004_manual_monthly_items.sql`：增加月度项目创建来源和手动项目约束。

已发布迁移不可编辑，只能追加。

### 9.1 schema 3 转换

迁移在单一 SQL 迁移事务中重建计划和月度表：

- 旧 `start_month` / `end_month` 作为相应日级日期保留；
- 旧金额从四位缩放整数转为分：

```text
cents = old_scaled / 100 + (old_scaled % 100 >= 50 ? 1 : 0)
```

旧数据为非负，因此该整数公式等价于 `ROUND_HALF_UP`，避免使用 SQLite `REAL` 及大整数乘法溢出。

- 旧月度实际为 `NULL`：不创建条目、不确认；
- 旧月度实际为 0：不创建虚假条目，写入确认时间；
- 旧月度实际大于 0 且舍入后至少 1 分：创建 `MIGRATED_AGGREGATE` 增加条目并确认；
- 旧正式 PAYMENT 快照的支付日取原月锚点，以保持历史可解释；
- 删除旧聚合实际列，创建实际条目表、索引和触发器。

发现未来 schema 时拒绝启动，不做降级写入。追加迁移由 SQLx 顺序执行；任何迁移失败都会阻止应用进入业务流程。
