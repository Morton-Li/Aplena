# Aplena 数据库设计

## 1. 设计状态与范围

本文定义并解释 SQLite 逻辑结构和约束。该结构现已由
`src-tauri/migrations/0001_initial.sql` 转化为可执行、受测试的版本化 SQL migration。

唯一持久化业务表为：

- `exchange_rates`
- `settings`
- `plan_items`
- `monthly_items`

SQLx 自身的 migration 元数据表属于基础设施，不是业务实体。Dashboard、Monthly Report、
历史趋势和分析不建立表。

## 2. 存储约定

```text
AMOUNT_SCALE = 10,000       // 小数点后四位
RATE_SCALE   = 100,000,000  // 小数点后八位
```

- 金额列使用 SQLite `INTEGER`，值为金额乘 `AMOUNT_SCALE` 后的 64 位整数；
- 汇率列使用 `INTEGER`，值为汇率乘 `RATE_SCALE` 后的 64 位整数；
- 任何乘除先在 Rust 十进制类型中完成，最后一次 `ROUND_HALF_UP` 到四位；
- UUID 使用规范的小写连字符文本；
- 月份使用 `YYYY-MM-01`；
- 时间戳使用 UTC ISO 8601 文本，仅用于技术审计，不参与月份判断；
- 所有业务表使用 `STRICT`；
- 每个连接启用 `PRAGMA foreign_keys = ON`；
- 应用数据库启用 WAL，并配置有限的 busy timeout。

## 3. `exchange_rates`

| 字段 | SQLite 类型 | 空值 | 约束 |
|---|---|---:|---|
| `currency_code` | TEXT | 否 | 主键，三位大写 ASCII |
| `rate_scaled` | INTEGER | 否 | 大于零 |
| `updated_at` | TEXT | 否 | UTC ISO 8601 |

逻辑 DDL：

```sql
CREATE TABLE exchange_rates (
  currency_code TEXT PRIMARY KEY
    CHECK (
      length(currency_code) = 3
      AND currency_code GLOB '[A-Z][A-Z][A-Z]'
    ),
  rate_scaled INTEGER NOT NULL CHECK (rate_scaled > 0),
  updated_at TEXT NOT NULL
) STRICT;
```

币种代码创建后不可修改。被设置、计划或快照引用时，外键拒绝删除。

## 4. `settings`

单例表，仅允许 `id = 1`。

| 字段 | SQLite 类型 | 空值 | 约束 |
|---|---|---:|---|
| `id` | INTEGER | 否 | 主键且必须为 1 |
| `target_month` | TEXT | 否 | 合法月初日期 |
| `base_currency_code` | TEXT | 否 | 引用汇率，删除/改码拒绝 |
| `minimum_savings_rate_bp` | INTEGER | 否 | 0–10,000 |
| `created_at` | TEXT | 否 | UTC ISO 8601 |
| `updated_at` | TEXT | 否 | UTC ISO 8601 |

逻辑 DDL：

```sql
CREATE TABLE settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  target_month TEXT NOT NULL
    CHECK (
      date(target_month) IS NOT NULL
      AND date(target_month) = target_month
      AND substr(target_month, 9, 2) = '01'
    ),
  base_currency_code TEXT NOT NULL
    REFERENCES exchange_rates(currency_code)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  minimum_savings_rate_bp INTEGER NOT NULL
    CHECK (minimum_savings_rate_bp BETWEEN 0 AND 10000),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;
```

跨表规则由应用服务和数据库触发器双重保护：

- 插入/更新 Settings 时，本位币的 `rate_scaled` 必须等于 `RATE_SCALE`；
- 任意 MonthlyItem 存在后，禁止改变 `base_currency_code`；
- 当前本位币的汇率不得改成非 1。

这些触发器在 `monthly_items` 建立后的迁移中创建；实际错误消息使用稳定错误代码映射，不把
原始触发器字符串直接展示给用户。

## 5. `plan_items`

| 字段 | SQLite 类型 | 空值 | 约束 |
|---|---|---:|---|
| `id` | TEXT | 否 | UUID 主键 |
| `name` | TEXT | 否 | 规范化后非空且唯一 |
| `category` | TEXT | 否 | 五种固定代码 |
| `planned_amount_scaled` | INTEGER | 否 | 非负 |
| `currency_code` | TEXT | 否 | 引用汇率，删除/改码拒绝 |
| `period_months` | INTEGER | 否 | 正整数 |
| `recognition_mode` | TEXT | 否 | `AMORTIZED`/`PAYMENT` |
| `start_month` | TEXT | 否 | 合法月初日期 |
| `end_month` | TEXT | 是 | 合法月初且不早于开始月份 |
| `note` | TEXT | 是 | 用户备注 |
| `created_at` | TEXT | 否 | UTC ISO 8601 |
| `updated_at` | TEXT | 否 | UTC ISO 8601 |

逻辑 DDL：

```sql
CREATE TABLE plan_items (
  id TEXT PRIMARY KEY CHECK (length(id) = 36),
  name TEXT NOT NULL UNIQUE CHECK (length(trim(name)) > 0),
  category TEXT NOT NULL CHECK (category IN (
    'FIXED_INCOME',
    'VARIABLE_INCOME',
    'ESSENTIAL_EXPENSE',
    'FIXED_COMMITMENT_EXPENSE',
    'DISCRETIONARY_BUDGET'
  )),
  planned_amount_scaled INTEGER NOT NULL
    CHECK (planned_amount_scaled >= 0),
  currency_code TEXT NOT NULL
    REFERENCES exchange_rates(currency_code)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  period_months INTEGER NOT NULL CHECK (period_months > 0),
  recognition_mode TEXT NOT NULL
    CHECK (recognition_mode IN ('AMORTIZED', 'PAYMENT')),
  start_month TEXT NOT NULL
    CHECK (
      date(start_month) IS NOT NULL
      AND date(start_month) = start_month
      AND substr(start_month, 9, 2) = '01'
    ),
  end_month TEXT
    CHECK (
      end_month IS NULL
      OR (
        date(end_month) IS NOT NULL
        AND date(end_month) = end_month
        AND substr(end_month, 9, 2) = '01'
        AND end_month >= start_month
      )
    ),
  note TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;
```

应用保存名称前执行 Unicode NFKC 规范化和 trim，再依赖 `UNIQUE(name)` 做最终保护。MVP 不
支持绕过应用直接写库，因此不额外增加用户不可见的名称键列。

索引：

```sql
CREATE INDEX idx_plan_items_active_months
ON plan_items(start_month, end_month);

CREATE INDEX idx_plan_items_category
ON plan_items(category);
```

## 6. `monthly_items`

| 字段 | SQLite 类型 | 空值 | 约束 |
|---|---|---:|---|
| `id` | TEXT | 否 | UUID 主键 |
| `source_plan_item_id` | TEXT | 是 | 引用计划，删除来源时置空 |
| `month` | TEXT | 否 | 合法月初日期 |
| `snapshot_name` | TEXT | 否 | 生成时复制且非空 |
| `category` | TEXT | 否 | 固定代码 |
| `flow_type` | TEXT | 否 | `INCOME`/`EXPENSE`，与类别一致 |
| `recognition_mode` | TEXT | 否 | 生成时复制 |
| `planned_amount_scaled` | INTEGER | 否 | 非负本位币金额 |
| `actual_amount_scaled` | INTEGER | 是 | 空为未录，非空时非负 |
| `currency_code` | TEXT | 否 | 生成时的本位币 |
| `note` | TEXT | 是 | 月度备注 |
| `created_at` | TEXT | 否 | UTC ISO 8601 |
| `updated_at` | TEXT | 否 | UTC ISO 8601 |

逻辑 DDL：

```sql
CREATE TABLE monthly_items (
  id TEXT PRIMARY KEY CHECK (length(id) = 36),
  source_plan_item_id TEXT
    REFERENCES plan_items(id)
    ON UPDATE RESTRICT ON DELETE SET NULL,
  month TEXT NOT NULL
    CHECK (
      date(month) IS NOT NULL
      AND date(month) = month
      AND substr(month, 9, 2) = '01'
    ),
  snapshot_name TEXT NOT NULL CHECK (length(trim(snapshot_name)) > 0),
  category TEXT NOT NULL CHECK (category IN (
    'FIXED_INCOME',
    'VARIABLE_INCOME',
    'ESSENTIAL_EXPENSE',
    'FIXED_COMMITMENT_EXPENSE',
    'DISCRETIONARY_BUDGET'
  )),
  flow_type TEXT NOT NULL CHECK (flow_type IN ('INCOME', 'EXPENSE')),
  recognition_mode TEXT NOT NULL
    CHECK (recognition_mode IN ('AMORTIZED', 'PAYMENT')),
  planned_amount_scaled INTEGER NOT NULL
    CHECK (planned_amount_scaled >= 0),
  actual_amount_scaled INTEGER
    CHECK (actual_amount_scaled IS NULL OR actual_amount_scaled >= 0),
  currency_code TEXT NOT NULL
    REFERENCES exchange_rates(currency_code)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  note TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (source_plan_item_id, month),
  CHECK (
    (category IN ('FIXED_INCOME', 'VARIABLE_INCOME') AND flow_type = 'INCOME')
    OR
    (category IN (
      'ESSENTIAL_EXPENSE',
      'FIXED_COMMITMENT_EXPENSE',
      'DISCRETIONARY_BUDGET'
    ) AND flow_type = 'EXPENSE')
  )
) STRICT;
```

所有系统生成记录最初都有非空 `source_plan_item_id`；它只有在用户显式删除来源计划后才
因 `ON DELETE SET NULL` 变空。普通产品流程不允许直接创建无来源月度项目。

索引：

```sql
CREATE INDEX idx_monthly_items_month
ON monthly_items(month);

CREATE INDEX idx_monthly_items_month_category_flow
ON monthly_items(month, category, flow_type);

CREATE INDEX idx_monthly_items_actual_coverage
ON monthly_items(month, actual_amount_scaled);
```

唯一约束已经为 `source_plan_item_id` 的幂等查找提供索引，不重复创建相同前缀索引。

## 7. 删除和更正行为

| 操作 | 数据库行为 | 产品行为 |
|---|---|---|
| 删除被引用币种 | `RESTRICT` | 提示先处理引用；不自动换币 |
| 删除 PlanItem | MonthlyItem 来源置空 | 二次确认；历史名称和金额保留 |
| 停止 PlanItem | 更新 `end_month` | 推荐路径，不删除历史或当前快照 |
| 删除 MonthlyItem | 无级联 | 仅限受控的“重置未开始月份”事务 |
| 修改系统快照字段 | DB 类型约束但不区分调用方 | IPC 不暴露普通编辑命令 |
| 修改实际金额 | 允许 NULL 或非负整数 | 普通月度编辑入口 |

重置月份前要求该月全部 `actual_amount_scaled IS NULL`，创建恢复点后在单一事务中按明确月份
删除；不能用删除再初始化作为一般同步机制。

## 8. 查询约定

月份过滤统一使用：

```sql
WHERE month >= :month_start
  AND month < :next_month_start
```

实际金额聚合需同时返回完整度：

```text
total_items
entered_items = COUNT(actual_amount_scaled IS NOT NULL)
planned_total
entered_actual_total
```

SQL 对缩放整数进行 `SUM`。储蓄率、完成率、偏差解释和承载能力由 Rust 查询服务完成，
零分母返回空值。缺失类别由查询 DTO 补零，不为此创建类别汇总行。

建议使用 CTE 在一个一致性读取中返回 Dashboard 所需收入、支出、覆盖率和分类数据。趋势
查询按月份分组，并携带每月实际完整度，使 UI 可以区分暂定值和最终值。

## 9. 自动初始化事务

事务级伪代码：

```text
BEGIN IMMEDIATE
  read Settings
  read applicable PlanItems
  read required ExchangeRates or explicit backfill overrides
  validate every item that should be recognized
  calculate every snapshot in Rust
  for each snapshot:
    INSERT ... ON CONFLICT(source_plan_item_id, month) DO NOTHING
  count created/skipped/excluded
COMMIT
```

验证发生在首次插入之前。缺失汇率等错误不允许形成部分月份。`ON CONFLICT DO NOTHING` 只
允许指定幂等约束，不能吞掉其他约束错误。

## 10. 迁移原则

1. 使用 SQLx 版本化、只向前的 migrations；
2. 已发布 migration 永不修改，只追加新版本；
3. SQL 文件统一 LF，由 `.gitattributes` 在实现阶段约束；
4. 每次升级前创建一致性恢复点；
5. 迁移在事务中执行，失败时保持旧 schema 和数据；
6. 破坏性变更采用新表、复制校验、切换和删除旧表的显式步骤；
7. 针对上一正式版本和全新数据库分别测试；
8. 恢复流程先在临时数据库运行迁移和完整性检查；
9. 不用运行时 ORM 自动同步 schema；
10. 数据库版本、备份格式版本和应用版本分别管理。

当前迁移链：

- `0001_initial.sql`：四张 STRICT 业务表、约束、触发器和基础索引；
- `0002_monthly_source_index.sql`：只追加 `monthly_items(source_plan_item_id)` 索引，加速来源
  历史计数、删除脱钩和恢复校验；不新增实体或事实来源。

启动先读取 `_sqlx_migrations`。全新数据库直接迁移；已是最新版本不生成冗余备份；存在待执行
迁移时先用一致快照生成版本化 `.aplena` 恢复点。恢复点失败即停止启动，迁移校验或事务失败
也不把失败状态宣称为可用数据库。

## 11. 数据库验收证据

持久化阶段与后续发布门禁必须通过自动测试证明：

- STRICT、外键和所有 CHECK 实际生效；
- 非月初日期、非法类别/方向组合和负金额无法插入；
- NULL 实际和零实际可以分别查询；
- 项目改名不改变来源 UUID 的幂等结果；
- 删除来源后历史快照仍可查询；
- 本位币锁定和本位币汇率为 1 的跨表规则不能绕过；
- 自动初始化全成功或全回滚；
- 聚合结果不会因重复调用翻倍；
- checkpoint 后的一致性备份可以恢复；
- schema 中不存在派生统计表。
