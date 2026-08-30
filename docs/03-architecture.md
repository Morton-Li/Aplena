# Aplena 架构设计

## 1. 技术栈

- macOS 桌面壳：Tauri 2；
- 后端：Rust；
- 数据库：SQLite、SQLx、WAL；
- 前端：React、TypeScript、Vite；
- 服务端状态：TanStack Query；
- 精确计算：Rust `Decimal` 与缩放整数；
- 测试：Rust 单元/集成测试、Vitest、Testing Library。

应用是本地优先单用户桌面软件，不需要服务器、账号系统或网络同步。

## 2. 代码分层

```text
crates/pfcm-domain
  纯领域类型、日期/金额规则、计入与承载公式

src-tauri/src/application
  DTO、用例编排、分析投影、稳定错误协议

src-tauri/src/infrastructure
  SQLite、迁移、Store、备份恢复、CSV 与文件保护

src-tauri/src/lib.rs
  Tauri 命令注册、应用启动、隔离冒烟入口保护

src
  React 页面、查询缓存、交互和展示
```

依赖方向：

```text
React -> Tauri IPC -> Application -> Domain
                           |
                           v
                     Infrastructure
```

领域层不依赖 Tauri、SQLite、WebView、文件系统或当前时间。

## 3. 权威计算边界

Rust 后端是金额、日期计入、偏差、比例和承载能力的唯一权威实现。前端只验证显而易见的输入形状、调用命令、展示结果，不复制财务公式。

金额协议：

- 输入与输出是十进制字符串；
- 金额最多两位，汇率最多八位；
- 数据库金额为分的 `INTEGER`；
- 所有乘除在十进制中进行，最终金额只舍入一次；
- 实际净额和偏差可以是带符号字符串。

日期协议：

- 月份为 `YYYY-MM`；
- 业务日期为 `YYYY-MM-DD`；
- 日期类型不经过 JavaScript Date/UTC 序列化；
- PAYMENT 支付日由 Rust 以原始开始日锚点计算。

## 4. 持久化与派生数据

持久化五张核心业务表：

```text
settings
exchange_rates
plan_items
monthly_items
actual_entries
```

以下内容不建表：月度报告、Dashboard、趋势、分类结构、项目排名、偏差榜、实际总额。查询通过 `monthly_items LEFT JOIN actual_entries` 聚合，并在应用层生成统一分析 DTO。

这保证条目变更后查询缓存失效即可刷新所有视图，无需“重新生成报表”。

## 5. 月度初始化架构

### 5.1 自动边界

启动时只自动初始化当前自然月。创建或更新计划后也只自动补齐当前自然月。读取历史或未来月份绝不隐式写入。

### 5.2 显式边界

未来初始化与历史补录经过两步：

1. `preview_month` 只读返回方向、候选、排除、既有项、缺少币种、支付日和警告；
2. `initialize_month` 要求确认，并在一个事务中写入全部快照。

历史补录的临时汇率只存在于命令输入，不写回汇率表。

### 5.3 并发和原位提升

应用服务用操作门协调初始化、备份和恢复；数据库唯一键防止同来源同月重复。初始化在连接事务中读取实际仅项目 ID，并使用带条件的 UPSERT 将 `ACTUAL_ONLY` 原位提升为 `PLANNED`。如果任何汇率或写入失败，整月不发生部分提交。

## 6. 实际条目架构

前端提供两条入口：

- 月度卡片上下文入口，月度项目固定；
- 全局入口默认直接创建 `MANUAL` 月度项目并记录实际；用户也可选择关联长期计划，目标月没有快照时调用 `ensure_actual_only_monthly_item`。

应用服务验证 UUID、日期、效果、金额、月度项目创建来源、来源计划状态和禁止改挂。手动月度项目无需计划引用，已删除计划留下的脱离快照仍拒绝新增条目。Store 写入后，SQLite 触发器清除确认时间。日期同月约束也由触发器防守，避免绕过服务层写入污染数据。

条目查询按日期和 UUID 稳定排序。迁移来源条目允许读取但 Store 拒绝更新和删除。

## 7. 查询与缓存

前端 Query Key 至少区分：

- 设置、汇率、计划；
- 月份预览与月度项目；
- 某月度项目的实际条目；
- 目标月分析、历史分析、承载能力；
- 现有月份列表和启动状态。

条目 CRUD 或确认后同时失效月度项目、该项目条目、目标月分析、历史分析和月份列表。计划变更还失效预览及承载能力。

## 8. IPC 命令面

命令按职责分组：

```text
settings / exchange rates / plan items
preview_plan_item / get_financial_capacity
preview_month / initialize_month / get_startup_status
list_monthly_items / update_monthly_note
create_manual_monthly_item
ensure_actual_only_monthly_item
list_actual_entries / create_actual_entry
update_actual_entry / delete_actual_entry
confirm_monthly_item / confirm_monthly_actuals
get_month_analytics / get_history_analytics
create_backup / inspect_backup / restore_backup / export_csv
```

DTO 不暴露内部缩放整数。错误结构包含 `error_code`、可空 `field`、`message_key` 和安全参数；数据库路径、SQL、堆栈或原始系统错误不进入 UI。

## 9. SQLite 生命周期

启动流程：

1. 解析应用数据目录；冒烟模式只接受系统临时目录下已经存在的子目录；
2. 确保目录和数据库/WAL/SHM 权限为当前用户私有；
3. 检查数据库 schema 是否比应用新；
4. 若存在待执行迁移，先生成并校验恢复点；
5. 顺序运行嵌入式追加迁移；
6. 启用 foreign keys、WAL 和同步策略；
7. 启动当前自然月自动初始化。

本项目不修改已经发布的迁移。schema 3 通过重建表完成日级日期、分精度和实际条目转换；schema 4 追加 `item_origin`，把手动月度项目与计划关联或计划删除后脱离的快照明确区分。

## 10. 备份、恢复和导出

`.aplena` 是 ZIP 容器，包含数据库快照和 JSON manifest。当前格式 2 描述应用版本、schema、SHA-256、大小、五表摘要和创建时间。

检查恢复：

1. 防路径穿越、符号链接、重复文件、压缩炸弹和记录数异常；
2. 校验 manifest 与数据库摘要；
3. 格式 1 旧库在隔离副本中执行当前迁移；
4. 完整验证五表、索引、触发器、外键和业务不变量；
5. 返回绑定文件指纹、一次性 token 和对比摘要；
6. 用户输入确认短语后，串行恢复并先创建当前库恢复点；
7. 原子替换；失败回滚原库。

CSV 是人类可读导出，包含五张表。字符串执行 RFC 4180 引号和公式注入防护；金额固定两位，汇率固定八位。它不用于恢复。

## 11. 安全边界

- CSP 和 Tauri capability 最小化；
- 无 shell、网络、任意文件系统插件权限；
- 文件选择与保存通过受限对话框；
- 数据库和备份路径不通过 IPC 暴露；
- SQL 参数绑定，用户文本不拼接查询；
- 恢复输入视为不可信文件；
- 真实应用冒烟必须设置隔离临时数据目录。

数据库加密仍是独立发布门，详见 ADR 0006；当前本地数据保护依赖 OS 账户、文件权限、FileVault 建议和备份安全说明。

## 12. 测试策略

### 12.1 领域层

验证两位输入、溢出、闰年、日级交集、1 月 31 日锚点、结束日、退款导致负净额、状态机和承载公式。

### 12.2 应用与数据库层

验证迁移、WAL、事务回滚、并发幂等、快照不可变、条目 CRUD、确认重开、仅实际原位提升、已删除计划拒绝、分析口径和本位币锁。

### 12.3 数据保护层

验证五表往返、并发备份、旧格式 1 前向恢复、恢复点、校验和、一次性 token、路径攻击、压缩炸弹、记录上限、CSV 稳定性和公式注入防护。

### 12.4 前端

验证默认设置直达应用、无计划手动月度录入、两种计划模式、日级录入、实际四状态、退款/冲减、只读净额、计划外实际入口、月份浏览、显式初始化、分析展示和恢复确认。

### 12.5 发布级验证

除类型、Lint、单元测试和构建外，发布候选必须完成 Tauri release `.app` 构建，并以系统临时目录下的隔离 `APLENA_SMOKE_DATA_DIR` 启动真实应用，检查关键页面和数据写读；禁止连接真实用户数据库。
