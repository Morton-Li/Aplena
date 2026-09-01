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
  SQLite、迁移、Store 与数据库文件权限

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

持久化六张核心业务表：

```text
settings
next_month_goal
exchange_rates
plan_items
monthly_items
actual_entries
```

以下内容不建表：月度报告、Dashboard、趋势、分类结构、项目排名、偏差榜、实际总额。查询通过 `monthly_items LEFT JOIN actual_entries` 聚合，并在应用层生成统一分析 DTO。

这保证条目变更后查询缓存失效即可刷新所有视图，无需“重新生成报表”。

## 5. 月度初始化架构

### 5.1 自动边界

启动时只自动初始化当前自然月。创建或更新周期规则不会自动回填当前月；用户若确需补齐符合本月的规则，必须在月度执行中显式初始化。读取历史或未来月份绝不隐式写入。

### 5.2 显式边界

未来初始化与历史补录经过两步：

1. `preview_month` 只读返回方向、候选、排除、既有项、缺少币种、支付日和警告；
2. `initialize_month` 要求确认，并在一个事务中写入全部快照。

历史补录的临时汇率只存在于命令输入，不写回汇率表。

### 5.3 并发和原位提升

应用服务用操作门协调初始化；数据库唯一键防止同来源同月重复。初始化在连接事务中读取实际仅项目 ID，并使用带条件的 UPSERT 将 `ACTUAL_ONLY` 原位提升为 `PLANNED`。如果任何汇率或写入失败，整月不发生部分提交。

## 6. 实际条目架构

前端把临时类目创建和实际录入拆成两个步骤：

- 月度页全局入口只创建 `MANUAL + ACTUAL_ONLY` 临时类目；
- 选中月度类目后，从右侧详情抽屉添加或编辑实际条目，月度类目固定不可改挂。
- 历史报告只保存查询上下文，不复制报表数据；“调整该月数据”与项目级“调整条目”通过月份和月度项目 UUID 打开同一月度工作台，因此迟到录入仍复用同一套条目 CRUD、汇率快照与缓存失效逻辑。

应用服务验证 UUID、日期、效果、金额、月度项目创建来源、来源计划状态和禁止改挂。手动月度项目无需计划引用，已删除计划留下的脱离快照仍拒绝新增条目。日期同月约束也由 SQLite 触发器防守，避免绕过服务层写入污染数据。删除临时类目时，Store 在事务内验证 `MANUAL + ACTUAL_ONLY + 无计划来源`，再删除其条目和类目；预算快照不会被该命令删除。

条目查询按日期和 UUID 稳定排序。迁移来源条目允许读取但 Store 拒绝更新和删除。

## 7. 查询与缓存

前端 Query Key 至少区分：

- 设置、下月目标、汇率、周期规则；
- 月份预览与月度项目；
- 某月度项目的实际条目；
- 月度分析、历史分析、仅下月承载能力；
- 现有月份列表和启动状态。

条目 CRUD 或临时类目变更后同时失效月度项目、该项目条目、目标月分析、历史分析和月份列表。计划变更还失效预览及承载能力。

## 8. IPC 命令面

命令按职责分组：

```text
settings / exchange rates / plan items
get_next_month_goal / save_next_month_goal
preview_plan_item / get_financial_capacity
preview_month / initialize_month / get_startup_status
list_monthly_items / update_monthly_note
create_manual_monthly_item / delete_manual_monthly_item
ensure_actual_only_monthly_item
list_actual_entries / create_actual_entry
update_actual_entry / delete_actual_entry
get_month_analytics / get_history_analytics
```

DTO 不暴露内部缩放整数。错误结构包含 `error_code`、可空 `field`、`message_key` 和安全参数；数据库路径、SQL、堆栈或原始系统错误不进入 UI。

## 9. SQLite 生命周期

启动流程：

1. 解析应用数据目录；冒烟模式只接受系统临时目录下已经存在的子目录；
2. 确保目录和数据库/WAL/SHM 权限为当前用户私有；
3. 检查数据库 schema 是否比应用新；
4. 新安装运行嵌入式正式基线，后续版本顺序运行追加迁移；
5. 启用 foreign keys、WAL 和同步策略；
6. 启动当前自然月自动初始化。

首个公开版把尚未发布的六段演进迁移压缩为 `0001_initial_release.sql`。公开兼容性从 schema 1 开始；schema 2 追加移除类目状态字段与重开触发器。已发布迁移不可修改，只能追加。高于当前应用支持版本的数据库会在迁移前被拒绝，预发布库换轨必须使用隔离副本和显式数据复制流程。

## 10. 安全边界

- CSP 和 Tauri capability 最小化；
- 无 shell、网络、任意文件系统插件权限；
- 数据库路径不通过 IPC 暴露；
- SQL 参数绑定，用户文本不拼接查询；
- 真实应用冒烟必须设置隔离临时数据目录。

首个正式版明确接受未做静态加密的本地 SQLite；当前安全边界依赖 OS 账户、私有文件权限和 FileVault 建议，详见 ADR 0006。SQLCipher 与系统凭据存储保留为未来增强，不再作为首版发布硬门禁。

## 11. 测试策略

### 11.1 领域层

验证两位输入、溢出、闰年、日级交集、1 月 31 日锚点、结束日、退款导致负净额和承载公式。

### 11.2 应用与数据库层

验证 schema 1 到 schema 2 的追加迁移、旧预发布库无修改拒绝、WAL、事务回滚、并发幂等、快照不可变、条目 CRUD、临时类目事务删除及预算快照保护、仅实际原位提升、已删除计划拒绝、分析口径和本位币锁。

### 11.3 前端

验证默认设置直达应用、临时类目创建与删除、日级录入默认当日、退款/冲减、保存校验提示、只读净额、弹窗与抽屉共存、删除确认层级、历史报告直达月份/项目调整、月份浏览、显式初始化和分析展示。

### 11.4 发布级验证

除类型、Lint、单元测试和构建外，发布候选必须完成 Tauri release `.app` 构建，并以系统临时目录下的隔离 `APLENA_SMOKE_DATA_DIR` 启动真实应用，检查关键页面和数据写读；禁止连接真实用户数据库。
