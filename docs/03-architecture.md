# Aplena 技术架构

## 1. 架构目标

架构优先满足以下质量属性：

1. 历史快照不会被未来计划或汇率变化污染；
2. 财务计算精确、确定且可以通过纯领域测试验证；
3. 默认离线，用户数据不需要离开设备；
4. 单用户桌面场景下安装、备份和恢复简单；
5. 前端无法绕过业务规则直接修改数据库；
6. 首发 macOS，同时避免锁死后续 Windows；
7. 不为未来云同步提前引入服务器复杂度。

## 2. 总体结构

```text
┌──────────────── React + TypeScript ────────────────┐
│ 页面 / 表单 / 数据表格 / 图表 / 无障碍交互         │
│ TanStack Query：调用、缓存和失效；不计算权威财务值 │
└──────────────────────┬─────────────────────────────┘
                       │ typed Tauri commands
┌──────────────────────▼─────────────────────────────┐
│ Rust Application Layer                             │
│ 命令编排、事务、权限边界、DTO、错误翻译            │
├────────────────────────────────────────────────────┤
│ PFCM Domain                                        │
│ YearMonth / Decimal / 计入规则 / 聚合 / 承载能力   │
├────────────────────────────────────────────────────┤
│ Repository + Query Layer                           │
│ SQLx、版本化迁移、参数化 SQL、备份与恢复           │
└──────────────────────┬─────────────────────────────┘
                       │ in-process
┌──────────────────────▼─────────────────────────────┐
│ SQLite STRICT + foreign_keys + WAL                 │
│ Settings / ExchangeRate / PlanItem / MonthlyItem   │
└────────────────────────────────────────────────────┘
```

应用不运行本地 HTTP 服务器。React 通过 Tauri IPC 调用白名单业务命令；不启用任意 SQL、
Shell 或不受限文件系统能力。

## 3. 运行时职责

### 3.1 前端

前端负责：

- 路由、导航、表单和数据表格；
- 对用户输入做快速但非权威的 Zod 校验；
- 调用业务命令并展示结构化错误；
- 使用 TanStack Query 管理查询缓存和写入后的精确失效；
- 将后端提供的数据映射为 ECharts 图表；
- 金额格式化和业务语义文案。

前端不得：

- 直接打开 SQLite；
- 计算月度计划金额、汇率结果或承载能力并将其作为事实保存；
- 自行推断类别与收支方向；
- 使用 JavaScript `number` 承载权威金额；
- 把 Dashboard 聚合写回数据库。

金额 DTO 使用十进制字符串，例如 `"1200.0000"`。图表渲染需要数值时，只在确认安全
范围后创建仅用于显示的 `number`，不得回写。

### 3.2 Rust 应用层

应用层负责一个命令对应一个明确用例：

- 解析 DTO 和构造领域值对象；
- 打开并提交或回滚事务；
- 调用领域服务和 Repository；
- 将内部错误转换为稳定错误代码和可本地化参数；
- 返回页面需要的完整查询 DTO。

应用层不把数据库行直接暴露给 UI，也不接受前端提供的 `flow_type` 或聚合金额作为权威值。

### 3.3 PFCM 领域层

领域层尽量保持纯 Rust，不依赖 Tauri、SQLite 或 React。核心模块建议为：

```text
domain/
  amount
  currency
  year_month
  category
  recognition
  plan_item
  monthly_item
  capacity
  analytics
```

这样可以在没有数据库和窗口环境时完整验证月份边界、舍入、支付周期、零分母及承载公式。

### 3.4 Repository 与查询层

Repository 处理实体写入和按 ID 获取；查询层可以使用专门 SQL/CTE 直接返回 Dashboard DTO，
避免为了纯粹的读取场景重建完整聚合。

规则是：

- 参数化 SQL；
- 所有写入经应用服务；
- 聚合查询只读；
- 不建立会成为第二事实来源的统计表；
- 不在 SQL 中执行货币除法或汇率舍入；
- SQL 对缩放整数求和，Rust 负责比率和业务解释。

## 4. 前端模块

```text
ui/
  app-shell
  dashboard
  monthly-plan
  long-term-plan
  history
  analytics
  settings
  backup
shared/
  api
  forms
  formatting
  components
  charts
```

共享组件不包含领域常量副本。类别选项、收支方向和能力说明从稳定后端契约取得；中文标签
由 UI 国际化资源呈现。

## 5. IPC 契约

Tauri 命令按用例分组，不提供 `execute_sql` 一类通用入口。

关键约束：

- UUID、枚举代码和月份作为字符串传输；
- 金额和汇率作为十进制字符串传输；
- 比率使用可空字符串或基点；
- 所有命令返回稳定 `error_code`、字段路径和消息参数；
- 备注等用户文本不进入错误日志；
- DTO 使用独立版本，备份格式版本与 IPC 版本分离。

示例：

```text
create_plan_item(input) -> PlanItemView
ensure_month_initialized(input) -> InitializationResult
update_monthly_actual(input) -> MonthlyItemView
get_month_dashboard(month) -> MonthlyDashboard
get_financial_capacity(month) -> FinancialCapacity
```

## 6. 自动初始化时序

```text
App starts
  ↓
Open database → apply migrations → validate settings
  ↓
Resolve current local YearMonth
  ↓
ensure_month_initialized(current_month, APP_START)
  ↓ single write transaction
Read settings/rates/plans → validate all due items
  ↓
Calculate deterministic snapshot values
  ↓
Insert missing rows; conflicts become skipped
  ↓
Commit all or roll back all
  ↓
Invalidate month/dashboard/history/capacity queries
  ↓
Show non-blocking summary or actionable error
```

新建 PlanItem 后复用同一服务和事务规则。编辑 PlanItem 不调用同步或覆盖逻辑，因为既有快照
是独立事实。

历史补录先执行只读预览，展示将创建的项目、当前汇率或临时覆盖汇率、风险说明和冲突；
用户确认后才执行写事务。未来月份也使用预览确认，但不会显示“历史汇率”语义。

## 7. 一致性和并发

Aplena 是单用户本地应用，但仍可能发生重复点击、窗口重入或异步查询。保护层次为：

1. UI 在命令进行中禁用重复提交；
2. 应用服务将同一写用例放入一个事务；
3. `source_plan_item_id + month` 唯一约束提供最终幂等保护；
4. 冲突转换为 `skipped`，不执行更新；
5. TanStack Query 在成功提交后才失效相关缓存。

SQLite 启用 `foreign_keys = ON`、`journal_mode = WAL`、合理的 `busy_timeout`，并使用短事务。
备份前执行 checkpoint 或 SQLite 在线备份接口，不能只复制一个仍依赖 WAL 的裸数据库文件。

## 8. 安全边界

- Tauri capabilities 采用最小权限，只给主窗口所需的命令和受限文件选择能力；
- 默认不启用网络、Shell、全局文件系统或远程内容；
- 使用严格 CSP，不执行动态拼接脚本；
- SQL 只使用参数绑定；
- 日志记录错误代码、命令名和相关 UUID，不记录金额、备注或完整名称；
- 导出和恢复只能经系统文件选择器，并明确目标文件；
- 自动更新只有在发布基础设施、签名和回滚方案完成后启用。

公开发布前必须完成数据库静态加密的跨平台验证。首选方向为 SQLCipher，密钥由系统秘密
存储或 Tauri Stronghold 保存；Stronghold 只保存密钥，不等同于数据库加密。如果该组合
不能在 macOS 和 Windows 的签名构建中稳定工作，公开发布应被阻止，直到选定并验证替代
方案。

## 9. 备份与恢复

MVP 需要两种出口：

1. 完整 `.aplena` 备份：数据库一致性快照、格式版本、应用版本和校验和；
2. CSV 导出：长期计划和月度项目的人类可读数据，不作为无损恢复格式。

恢复流程：

1. 只读检查格式、版本、校验和、月份范围和记录数；
2. 展示预览并要求确认；
3. 为当前数据创建恢复点；
4. 在临时位置迁移并校验备份；
5. 原子替换或回滚；
6. 重启查询层并重新计算派生数据。

数据库迁移前自动创建恢复点。备份密码和加密方案必须经过专门安全审查，不能自行设计
密码算法。

## 10. 技术选择

| 层 | 选择 | 理由 |
|---|---|---|
| 桌面外壳 | Tauri 2 | 系统 WebView、Rust 后端、跨桌面平台和细粒度能力权限 |
| UI | React + TypeScript + Vite | 适合数据密集桌面界面，类型生态成熟，构建边界简单 |
| 表单 | React Hook Form + Zod | 表单状态与即时输入提示；后端仍是权威校验 |
| 查询状态 | TanStack Query | 命令后精确失效 Dashboard、历史和计划查询 |
| 样式与组件 | 版本控制的原生 CSS + 语义化 HTML | 当前规模下避免额外运行依赖，并保持视觉与无障碍细节可审计 |
| 图表 | Apache ECharts | 趋势、结构、横向排名和无障碍描述能力 |
| 后端 | Rust | 领域值对象、精确计算和 Tauri 原生边界 |
| 数据库 | SQLite STRICT + WAL | 单用户嵌入式数据、事务、备份和成熟文件格式 |
| 数据访问 | SQLx + SQL migrations | 参数化查询、事务和可版本化迁移；避免重量 ORM |
| 精确金额 | rust_decimal 或经验证等价物 | 避免二进制浮点，显式舍入模式 |

依赖版本在第二阶段初始化时根据锁文件固定，不在设计文档中写死容易过期的补丁版本。

## 11. 不采用的方案

### 云端 Web + PostgreSQL

MVP 没有同步或协作需求。服务器会引入账户、安全、部署、隐私和持续成本，不能改善核心
月度计划体验。

### Electron

可以实现产品，但会捆绑浏览器运行时，且仍需设计可信后端边界。当前团队基线优先选择
Tauri；如果后续 Rust 技能或平台兼容性验证失败，再通过 ADR 重新评估。

### React 直接使用 Tauri SQL 插件

会让 UI 获得过宽的数据写入能力，容易复制或绕过领域规则。Aplena 只通过 Rust 业务命令
访问 SQLx。

### 持久化 Monthly Report

它会成为需要同步更新的第二数据源，增加漂移和修复成本。使用索引良好的实时查询即可。

### 全栈框架或本地 HTTP API

离线单窗口应用不需要 SSR、服务进程或网络协议。Tauri 命令边界更小、更容易限制权限。

## 12. 测试分层

| 层 | 验证内容 |
|---|---|
| Rust 单元/性质测试 | 月份、周期、舍入、分类、能力和零分母 |
| SQLite 集成测试 | 迁移、约束、事务、幂等、删除和查询 |
| 前端单元测试 | 表单状态、空值、文案和格式化 |
| 组件测试 | 表格编辑、错误、批量确认和无障碍 |
| Playwright | 浏览器层核心用户流程，不依赖真实数据库时使用 mock command adapter |
| Tauri 端到端 | macOS 主流程、数据库和窗口集成；Windows 发布前增加对应验证 |
| 备份测试 | 一致性快照、损坏检测、版本迁移和恢复回滚 |

本地测试成功只证明对应范围；签名、自动更新、SQLCipher 和 Windows 行为需要各自的真实
构建证据。

## 13. 官方参考

- [Tauri 2：What is Tauri?](https://v2.tauri.app/start/)
- [Tauri：Capabilities](https://v2.tauri.app/security/capabilities/)
- [Tauri：Content Security Policy](https://v2.tauri.app/security/csp/)
- [SQLite：Datatypes](https://www.sqlite.org/datatype3.html)
- [SQLite：STRICT Tables](https://www.sqlite.org/stricttables.html)
- [SQLite：Transactions](https://www.sqlite.org/lang_transaction.html)
- [SQLx SQLite](https://docs.rs/sqlx/latest/sqlx/sqlite/)
- [React with TypeScript](https://react.dev/learn/typescript)
- [Apache ECharts](https://echarts.apache.org/en/)
